/**
 * LifeSimApp — 街角 · 地图版
 * 核心体验：在一张虚拟街区地图上观察角色、地点、关系和事件的长期变化。
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useOS } from '../context/OSContext';
import { resolveAuxApi } from '../utils/auxApi';
import {
    LifeSimState, SimAction, SimActionType, SimEventType,
    CharacterProfile, SimNPC,
} from '../types';
import {
    createNewLifeSimState, createNPC, applyAddNPC,
    applyTriggerEvent, settlePendingEffects, advanceTurn, checkGameOver,
    getChaosLabel, deepClone, migrateLifeSimState, advanceTimeOfDay,
    getTodayFestival, SEASON_INFO, TIME_INFO, WEATHER_INFO,
} from '../utils/lifeSimEngine';
import {
    buildCharTurnSystemPrompt, formatRecentChatForSim, buildUserActionDescription, CharDecision, normalizeCharDecision,
    buildWorldDramaPlannerPrompt, normalizeWorldDramaDecision, buildFallbackWorldDramaDecision,
} from '../utils/lifeSimPrompts';
import { materializeStoryAttachments } from '../utils/lifeSimStoryAttachments';
import { createLifeSimResetCardData } from '../utils/lifeSimChatCard';
import { buildFallbackLifeSimSessionSummary, buildLifeSimSessionSummaryPrompt } from '../utils/lifeSimSessionSummary';
import { getLifeSimToneEmoji } from '../utils/lifeSimTone';
// Offline simulation removed — random events didn't match the theme
import { extractContent, extractJson } from '../utils/safeApi';
import { makeApiUsageMeta } from '../utils/apiUsageCatalog';
import { callChatCompletion } from '../utils/llmClient';
import { DB } from '../utils/db';
import { injectMemoryPalace } from '../utils/memoryPalace/pipeline';
import { buildFullActiveUserSetting } from '../utils/characterPromptProfile';
import {
    Storefront, ArrowLeft, ArrowCounterClockwise, GearSix, Star,
    MaskHappy, UserPlus, Eye, UsersThree, ChatsCircle, HeartHalf, MapTrifold, Footprints,
} from '@phosphor-icons/react';

// Twemoji helper: converts an emoji string to a Twemoji CDN <img> tag
const TWEMOJI_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72';
function emojiToCodepoint(emoji: string): string {
    const codepoints: string[] = [];
    for (const cp of emoji) {
        const hex = cp.codePointAt(0)?.toString(16);
        if (hex && hex !== 'fe0f') codepoints.push(hex);
    }
    return codepoints.join('-');
}
function TwemojiImg({ emoji, size = 16, className = '' }: { emoji: string; size?: number; className?: string }) {
    const cp = emojiToCodepoint(emoji);
    return <img src={`${TWEMOJI_BASE}/${cp}.png`} alt={emoji} width={size} height={size} className={`inline-block ${className}`} style={{ verticalAlign: 'middle' }} draggable={false} />;
}

// 子组件
import StreetMap, { MapLayerMode, MapNode, MapPoint, MapRoute, mapDistanceLabel } from './lifesim/StreetMap';
import NPCGrid from './lifesim/NPCGrid';
import DramaFeed from './lifesim/DramaFeed';
import RelationsTab from './lifesim/RelationsTab';
import ActionPanel, { StirAction, AddNpcAction } from './lifesim/ActionPanel';
import NarrativeReplayOverlay from './lifesim/ReplayOverlay';
// OfflineRecapOverlay removed
import GameOverOverlay from './lifesim/GameOverOverlay';
import LifeSimSettingsPanel from './lifesim/LifeSimSettingsPanel';
import NPCEditorPanel from './lifesim/NPCEditorPanel';
import ResetCityDialog from './lifesim/ResetCityDialog';
import RoamView from './lifesim/RoamView';
import DateView from './lifesim/DateView';

// ── 常量 ────────────────────────────────────────────────────────

const CHAR_TURN_COUNT_RANGE = [1, 3] as const;
const MAIN_PLOT_WATCH_CHANCE = 0.45;
const genId = () => Math.random().toString(36).slice(2, 10);

// 季节胶带色：奶油纸基不变，只在胶带 / 印章 / 贴纸的点缀色上体现季节
const SEASON_SCRAP: Record<string, { accent: string; tape: string; tape2: string; hanzi: string }> = {
    spring: { accent: '#6f9b6a', tape: 'rgba(150,190,150,0.5)', tape2: 'rgba(196,220,176,0.55)', hanzi: '春' },
    summer: { accent: '#4f8bb0', tape: 'rgba(120,180,210,0.46)', tape2: 'rgba(176,210,228,0.55)', hanzi: '夏' },
    fall:   { accent: '#b07442', tape: 'rgba(205,150,95,0.46)', tape2: 'rgba(228,196,156,0.55)', hanzi: '秋' },
    winter: { accent: '#737da0', tape: 'rgba(150,160,190,0.46)', tape2: 'rgba(202,208,224,0.6)', hanzi: '冬' },
};

const USER_POINT: MapPoint = { x: 48, y: 58 };
const EVENT_ACCENTS: Record<string, string> = {
    fight: '#dc2626',
    party: '#d97706',
    gossip: '#7c3aed',
    romance: '#db2777',
    rivalry: '#ea580c',
    alliance: '#0284c7',
};

function hashSeed(seed: string): number {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
    return hash;
}

function clampMap(value: number, min = 7, max = 93): number {
    return Math.max(min, Math.min(max, value));
}

function jitterPoint(seed: string, origin: MapPoint, radius = 8): MapPoint {
    const hash = hashSeed(seed || 'moro');
    const angle = (hash % 360) * Math.PI / 180;
    const distance = 3 + ((hash >>> 8) % 100) / 100 * radius;
    return {
        x: clampMap(origin.x + Math.cos(angle) * distance),
        y: clampMap(origin.y + Math.sin(angle) * distance),
    };
}

function fallbackPoint(seed: string): MapPoint {
    const hash = hashSeed(seed || 'street');
    return {
        x: 12 + (hash % 76),
        y: 14 + ((hash >>> 8) % 70),
    };
}

function npcMapPoint(state: LifeSimState, npc: SimNPC): MapPoint {
    const family = npc.familyId ? state.families.find(item => item.id === npc.familyId) : null;
    if (family) return jitterPoint(npc.id, { x: family.homeX, y: family.homeY }, 7);
    return fallbackPoint(npc.id);
}

function latestActionForNode(state: LifeSimState, node: MapNode): SimAction | undefined {
    if (node.kind === 'event') return state.actionLog.find(action => `event-${action.id}` === node.id);
    if (node.kind === 'person') return state.actionLog.find(action => action.involvedNpcIds?.includes(node.id.replace(/^npc-/, '')));
    if (node.kind === 'family') {
        const familyId = node.id.replace(/^family-/, '');
        const memberIds = state.families.find(family => family.id === familyId)?.memberIds || [];
        return state.actionLog.find(action => action.involvedNpcIds?.some(id => memberIds.includes(id)));
    }
    return undefined;
}

// ── API调用 ──────────────────────────────────────────────────────

const AI_MAX_RETRIES = 2;

interface LifeSimApiConfig {
    baseUrl: string;
    apiKey?: string;
    model: string;
    apiRole?: string;
    apiBinding?: string;
}

async function callCharAI(
    apiConfig: LifeSimApiConfig,
    systemPrompt: string,
    usage: { featureId?: string; apiBinding?: string; charId?: string; charName?: string } = {}
): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= AI_MAX_RETRIES; attempt++) {
        try {
            const data = await callChatCompletion(apiConfig, {
                model: apiConfig.model,
                messages: [{ role: 'user', content: systemPrompt }],
                temperature: 0.85,
                max_tokens: 8192,
                stream: false,
                response_format: { type: 'json_object' },
            }, {
                meta: makeApiUsageMeta(usage.featureId || 'date.scene', {
                    charId: usage.charId,
                    charName: usage.charName,
                    apiRole: apiConfig.apiRole || 'aux',
                    apiBinding: apiConfig.apiBinding || usage.apiBinding || '街角剧情生成',
                }),
            });
            return (extractContent(data) || '').trim();
        } catch (e: any) {
            const isNetwork = e?.name === 'AbortError' || e?.message?.includes('fetch') || e?.message?.includes('network') || e?.message?.includes('aborted');
            lastError = e;

            if (isNetwork && attempt < AI_MAX_RETRIES) {
                const delay = (attempt + 1) * 2000;
                console.warn(`[LifeSim] AI请求失败(第${attempt + 1}次)，${delay / 1000}s后重试…`, e?.message);
                await new Promise(r => setTimeout(r, delay));
                continue;
            }
            throw lastError;
        }
    }
    throw lastError || new Error('AI请求失败');
}

// ── 主组件 ──────────────────────────────────────────────────────

const LifeSimApp: React.FC = () => {
    const { apiConfig, auxApiConfig, apiPresets, characters, userProfile, closeApp } = useOS();
    // 街角·LifeSim 属「聊天以外」的功能：未单独配置独立 API 时走副 API（再回退主 API）
    const auxApi = { ...apiConfig, ...resolveAuxApi(auxApiConfig, apiConfig) };

    const [gameState, setGameState] = useState<LifeSimState | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [showReplay, setShowReplay] = useState(false);
    const [replayIndex, setReplayIndex] = useState(0);
    const [processingMsg, setProcessingMsg] = useState('');
    const [showGameOver, setShowGameOver] = useState(false);
    const [festivalAnnounce, setFestivalAnnounce] = useState<string>('');
    const [showSettings, setShowSettings] = useState(false);
    const [showResetDialog, setShowResetDialog] = useState(false);
    const [editingNpc, setEditingNpc] = useState<SimNPC | null>(null);
    const [isResetting, setIsResetting] = useState(false);
    const [showRoam, setShowRoam] = useState(false);
    const [showDate, setShowDate] = useState(false);
    const [view, setView] = useState<'home' | 'map'>('home');
    const [mapLayer, setMapLayer] = useState<MapLayerMode>('info');
    const [selectedMapNodeId, setSelectedMapNodeId] = useState<string | null>(null);

    const [activeTab, setActiveTab] = useState<'npcs'|'drama'|'relations'>('npcs');
    const [actionPanel, setActionPanel] = useState<'none'|'stir'|'add'>('none');

    // ── 初始化 ──────────────────────────────────────────────────

    useEffect(() => {
        try {
            const raw = localStorage.getItem('moro_date_intent_v1');
            if (!raw) return;
            const intent = JSON.parse(raw);
            localStorage.removeItem('moro_date_intent_v1');
            if (intent?.from === 'couple') setShowDate(true);
        } catch { /* ignore */ }
    }, []);

    useEffect(() => {
        async function init() {
            setIsLoading(true);
            try {
                let saved = await DB.getLifeSimState();
                if (saved) {
                    saved = migrateLifeSimState(saved);
                    if (saved.isProcessingCharTurn) {
                        saved.isProcessingCharTurn = false;
                        saved.currentActorId = 'user';
                        saved.charQueue = [];
                    }
                    if (saved.replayPending && saved.replayPending.length > 0) {
                        saved.replayPending = [];
                    }

                    saved.lastActiveTimestamp = Date.now();
                    await DB.saveLifeSimState(saved);
                    setGameState(saved);
                } else {
                    const newState = createNewLifeSimState();
                    newState.lastActiveTimestamp = Date.now();
                    setGameState(newState);
                    await DB.saveLifeSimState(newState);
                }
            } finally {
                setIsLoading(false);
            }
        }
        init();
    }, []);

    const saveState = useCallback(async (s: LifeSimState) => {
        s.lastActiveTimestamp = Date.now();
        setGameState(s);
        await DB.saveLifeSimState(s);
    }, []);

    const resolveParticipantCharIds = useCallback((state: LifeSimState | null) => {
        const allIds = characters.filter(char => !!char.id).map(char => char.id);
        if (!state || state.participantCharIds === undefined) return allIds;
        const validIds = new Set(allIds);
        return state.participantCharIds.filter(id => validIds.has(id));
    }, [characters]);

    const getParticipatingCharacters = useCallback((state: LifeSimState | null) => {
        const allowedIds = new Set(resolveParticipantCharIds(state));
        return characters.filter(char => !!char.id && allowedIds.has(char.id));
    }, [characters, resolveParticipantCharIds]);

    const resolveLifeSimApiConfig = useCallback((state: LifeSimState | null | undefined) => {
        if (!state?.useIndependentApiConfig) return auxApi;
        const override = state.independentApiConfig || {};
        return {
            ...auxApi,
            baseUrl: override.baseUrl?.trim() || auxApi.baseUrl,
            apiKey: override.apiKey?.trim() || auxApi.apiKey,
            model: override.model?.trim() || auxApi.model,
            apiRole: 'custom',
            apiBinding: '街角独立 API',
        };
    }, [auxApi]);

    const buildMainPlotAction = useCallback(async (state: LifeSimState) => {
        if (!userProfile) return null;

        setProcessingMsg('主线编剧室正在加戏...');
        const fallback = buildFallbackWorldDramaDecision(state);
        const resolvedApiConfig = resolveLifeSimApiConfig(state);

        try {
            let decision = fallback;
            const canUseApi = !!(resolvedApiConfig?.baseUrl && resolvedApiConfig?.model);

            if (canUseApi) {
                const raw = await callCharAI(
                    resolvedApiConfig,
                    buildWorldDramaPlannerPrompt(userProfile, state, state.actionLog),
                    { featureId: 'date.worldEngine', apiBinding: '街角主线编剧' },
                );
                let rawJson = extractJson(raw);
                if (Array.isArray(rawJson)) rawJson = rawJson[0];
                const normalized = normalizeWorldDramaDecision(rawJson);
                decision = {
                    ...fallback,
                    ...normalized,
                    attachments: normalized.attachments.length > 0 ? normalized.attachments : fallback.attachments,
                };
            }

            const involvedNpcIds = decision.involvedNpcIds
                .filter(id => state.npcs.some(npc => npc.id === id))
                .slice(0, 4);
            const fallbackNpcIds = fallback.involvedNpcIds.slice(0, 4);
            const finalNpcIds = involvedNpcIds.length > 0 ? involvedNpcIds : fallbackNpcIds;
            const actionResult = applyTriggerEvent(
                state,
                decision.eventType,
                finalNpcIds,
                decision.eventDescription || fallback.eventDescription
            );

            const mainPlotAction: SimAction = {
                id: genId(),
                turnNumber: state.turnNumber,
                actor: '主线编剧室',
                actorAvatar: '🎬',
                actorId: 'story',
                type: 'TRIGGER_EVENT',
                headline: decision.headline || fallback.headline,
                description: decision.eventDescription || fallback.eventDescription,
                immediateResult: decision.immediateResult || actionResult.immediateResult,
                narrative: decision.narrative || fallback.narrative,
                reasoning: decision.narrative?.innerThought || fallback.narrative.innerThought,
                storyKind: 'main_plot',
                involvedNpcIds: finalNpcIds,
                attachments: materializeStoryAttachments(decision.attachments.length > 0 ? decision.attachments : fallback.attachments),
                timestamp: Date.now(),
            };

            return {
                newState: {
                    ...actionResult.newState,
                    actionLog: [...actionResult.newState.actionLog, mainPlotAction],
                },
                mainPlotAction,
            };
        } finally {
            setProcessingMsg('');
        }
    }, [resolveLifeSimApiConfig, userProfile]);

    // ── 结束回合 ────────────────────────────────────────────────

    const endTurn = useCallback(async () => {
        if (!gameState) return;

        // 1. 推进时间
        const { newState: s1, events, festival } = advanceTimeOfDay(gameState);
        let s = deepClone(s1);
        for (const ev of events) {
            const sysAction: SimAction = {
                id: genId(), turnNumber: s.turnNumber,
                actor: '时光', actorAvatar: '', actorId: 'system',
                type: 'DO_NOTHING', description: ev, immediateResult: ev, timestamp: Date.now(),
            };
            s.actionLog = [...s.actionLog, sysAction];
        }

        if (festival) {
            setFestivalAnnounce(`${festival.name}：${festival.description}`);
            setTimeout(() => setFestivalAnnounce(''), 4000);
        }

        // 2. NPC自主行为

        // 3. 结算待处理效果
        const settled = settlePendingEffects(s);
        s = settled.newState;
        for (const ev of settled.events) {
            const sysAction: SimAction = {
                id: genId(), turnNumber: s.turnNumber,
                actor: '连锁', actorAvatar: '', actorId: 'system',
                type: 'TRIGGER_EVENT', description: ev, immediateResult: ev, timestamp: Date.now(),
            };
            s.actionLog = [...s.actionLog, sysAction];
        }

        // 4. 检查游戏结束
        const { over, reason } = checkGameOver(s);
        if (over) {
            s.gameOver = true; s.gameOverReason = reason;
            await saveState(s); setShowGameOver(true); return;
        }

        // 5. 决定CHAR回合
        const participantIds = new Set(resolveParticipantCharIds(gameState));
        const availableChars = characters.filter(c => c.id && participantIds.has(c.id));
        const charCount = Math.floor(
            Math.random() * (CHAR_TURN_COUNT_RANGE[1] - CHAR_TURN_COUNT_RANGE[0] + 1)
        ) + CHAR_TURN_COUNT_RANGE[0];
        const shuffled = [...availableChars].sort(() => Math.random() - 0.5);
        const charQueue = shuffled.slice(0, charCount).map(c => c.id);
        s.charQueue = charQueue;
        s.currentActorId = charQueue[0] || 'user';
        s = advanceTurn(s);

        await saveState(s);
        setActionPanel('none');

        if (charQueue.length > 0) await runCharTurns(s);
    }, [gameState, characters, resolveParticipantCharIds, saveState]);

    const finalizeTurn = useCallback(async (
        baseState: LifeSimState,
        options?: {
            replaySeed?: SimAction[];
            skipCharTurns?: boolean;
            captureNonCharReplay?: boolean;
        }
    ) => {
        const replayActions: SimAction[] = [...(options?.replaySeed || [])];
        const captureReplay = !!options?.captureNonCharReplay;
        const pushReplay = (action: SimAction) => {
            if (captureReplay) replayActions.push(action);
        };

        const { newState: s1, events, festival } = advanceTimeOfDay(baseState);
        let s = deepClone(s1);

        for (const ev of events) {
            const sysAction: SimAction = {
                id: genId(), turnNumber: s.turnNumber,
                actor: '时光', actorAvatar: '', actorId: 'system',
                type: 'DO_NOTHING', description: ev, immediateResult: ev, storyKind: 'system', timestamp: Date.now(),
            };
            s.actionLog = [...s.actionLog, sysAction];
            pushReplay(sysAction);
        }

        if (festival) {
            setFestivalAnnounce(`${festival.name}：${festival.description}`);
            setTimeout(() => setFestivalAnnounce(''), 4000);
        }


        const settled = settlePendingEffects(s);
        s = settled.newState;
        for (const ev of settled.events) {
            const sysAction: SimAction = {
                id: genId(), turnNumber: s.turnNumber,
                actor: '连锁', actorAvatar: '', actorId: 'system',
                type: 'TRIGGER_EVENT', description: ev, immediateResult: ev, storyKind: 'system', timestamp: Date.now(),
            };
            s.actionLog = [...s.actionLog, sysAction];
            pushReplay(sysAction);
        }

        const { over, reason } = checkGameOver(s);
        if (over) {
            s.gameOver = true;
            s.gameOverReason = reason;
            s.replayPending = replayActions;
            await saveState(s);
            setActionPanel('none');
            if (replayActions.length > 0) { setShowReplay(true); setReplayIndex(0); }
            setShowGameOver(true);
            return { state: s, replayActions, shouldRunCharTurns: false };
        }

        if (options?.skipCharTurns) {
            s.charQueue = [];
            s.currentActorId = 'user';
            s = advanceTurn(s);
            s.replayPending = replayActions;
            await saveState(s);
            setActionPanel('none');
            if (replayActions.length > 0) { setShowReplay(true); setReplayIndex(0); }
            return { state: s, replayActions, shouldRunCharTurns: false };
        }

        const participantIds = new Set(resolveParticipantCharIds(baseState));
        const availableChars = characters.filter(c => c.id && participantIds.has(c.id));
        const charCount = Math.floor(
            Math.random() * (CHAR_TURN_COUNT_RANGE[1] - CHAR_TURN_COUNT_RANGE[0] + 1)
        ) + CHAR_TURN_COUNT_RANGE[0];
        const shuffled = [...availableChars].sort(() => Math.random() - 0.5);
        const charQueue = shuffled.slice(0, charCount).map(c => c.id);
        s.charQueue = charQueue;
        s.currentActorId = charQueue[0] || 'user';
        s = advanceTurn(s);

        if (charQueue.length === 0) {
            s.replayPending = replayActions;
            await saveState(s);
            setActionPanel('none');
            if (replayActions.length > 0) { setShowReplay(true); setReplayIndex(0); }
            return { state: s, replayActions, shouldRunCharTurns: false };
        }

        await saveState(s);
        setActionPanel('none');
        return { state: s, replayActions, shouldRunCharTurns: true };
    }, [characters, resolveParticipantCharIds, saveState]);

    // ── CHAR回合引擎 ──────────────────────────────────────────

    const runCharTurns = useCallback(async (initialState: LifeSimState, seededReplayActions: SimAction[] = []) => {
        if (!userProfile) return;
        let s = deepClone(initialState);
        const replayActions: SimAction[] = [...seededReplayActions];
        const resolvedApiConfig = resolveLifeSimApiConfig(initialState);
        const canUseApi = !!(resolvedApiConfig?.baseUrl && resolvedApiConfig?.model);

        for (const charId of s.charQueue) {
            const char = characters.find(c => c.id === charId);
            if (!char) continue;
            s.isProcessingCharTurn = true; s.currentActorId = charId;
            setProcessingMsg(`${char.name} 正在思考……`);
            await saveState(s);

            try {
                let rawJson: any = null;
                let decision: CharDecision;

                if (canUseApi) {
                    const rawMessages = await DB.getRecentMessagesByCharId(charId, 20);
                    const chatHistory = formatRecentChatForSim(
                        rawMessages as any, char.name, userProfile.name || '你', 20
                    );
                    await injectMemoryPalace(char, undefined, chatHistory || undefined);
                    const fullUserSetting = await buildFullActiveUserSetting(userProfile, { fallback: `用户名：${userProfile.name || '用户'}` });
                    const systemPrompt = buildCharTurnSystemPrompt(char, userProfile, chatHistory, s, s.actionLog, fullUserSetting);
                    const raw = await callCharAI(
                        resolvedApiConfig,
                        systemPrompt,
                        { featureId: 'date.scene', apiBinding: '街角角色回合', charId: char.id, charName: char.name },
                    );

                    rawJson = extractJson(raw);
                    if (Array.isArray(rawJson)) rawJson = rawJson[0];
                    decision = normalizeCharDecision(rawJson);

                    // 调试日志：查看每回合LLM的原始输出和解析结果
                    console.group(`[LifeSim] ${char.name} 的回合 (Turn ${s.turnNumber})`);
                    console.log('LLM原始输出:', raw);
                    console.log('extractJson结果:', rawJson);
                    console.log('normalize后决策:', JSON.stringify(decision, null, 2));
                    if (!rawJson) console.warn('JSON解析失败！LLM输出无法解析为JSON');
                    if (decision.action.type === 'DO_NOTHING' && rawJson?.type && rawJson.type !== 'DO_NOTHING')
                        console.warn('action type被fallback为DO_NOTHING，原始type:', rawJson.type);
                    console.groupEnd();
                } else {
                    decision = {
                        action: { type: 'DO_NOTHING' },
                        narrative: {
                            innerThought: `${char.name}决定先嗑着瓜子围观一轮，看看局面会不会自己炸开。`,
                            dialogue: '',
                            commentOnWorld: '没接上外部AI的时候，这条街也会自己慢慢酝酿戏剧。',
                            emotionalTone: 'amused',
                        },
                        reactionToUser: '你先继续折腾，我在旁边看戏。',
                    };
                }
                const actionResult = executeCharDecision(s, decision, char);
                s = actionResult.newState;

                const action: SimAction = {
                    id: genId(), turnNumber: s.turnNumber,
                    actor: char.name, actorAvatar: char.avatar, actorId: char.id,
                    type: decision.action.type as SimActionType,
                    description: buildCharActionDescription(char.name, decision),
                    immediateResult: actionResult.immediateResult,
                    narrative: decision.narrative || undefined,
                    reasoning: decision.narrative?.innerThought || undefined,
                    reactionToUser: decision.reactionToUser || undefined,
                    storyKind: 'character_drama',
                    timestamp: Date.now(),
                };
                s.actionLog = [...s.actionLog, action];
                replayActions.push(action);

                // 结算 pending effects
                const settled = settlePendingEffects(s);
                s = settled.newState;
                for (const ev of settled.events) {
                    const sysAction: SimAction = {
                        id: genId(), turnNumber: s.turnNumber,
                        actor: '系统', actorAvatar: '', actorId: 'system',
                        type: 'TRIGGER_EVENT', description: ev, immediateResult: ev, storyKind: 'system', timestamp: Date.now(),
                    };
                    s.actionLog = [...s.actionLog, sysAction];
                    replayActions.push(sysAction);
                }

                s = advanceTurn(s);
                const { over, reason } = checkGameOver(s);
                if (over) { s.gameOver = true; s.gameOverReason = reason; break; }

            } catch (e: any) {
                console.error(`[LifeSim] ${char.name} 回合异常:`, e?.message || e);
                const fallbackAction: SimAction = {
                    id: genId(), turnNumber: s.turnNumber,
                    actor: char.name, actorAvatar: char.avatar, actorId: char.id,
                    type: 'DO_NOTHING',
                    description: `${char.name}（因为某些原因）什么都没做，静静地看着局面发展。`,
                    immediateResult: '……', storyKind: 'character_drama', timestamp: Date.now(),
                };
                s.actionLog = [...s.actionLog, fallbackAction];
                replayActions.push(fallbackAction);
                s = advanceTurn(s);
            }
        }

        s.charQueue = []; s.isProcessingCharTurn = false; s.currentActorId = 'user';
        s.replayPending = replayActions;
        await saveState(s);
        setProcessingMsg('');
        if (replayActions.length > 0) { setShowReplay(true); setReplayIndex(0); }
        if (s.gameOver) setShowGameOver(true);
    }, [characters, resolveLifeSimApiConfig, saveState, userProfile]);

    // ── 用户行动：搅局 ──────────────────────────────────────────

    const handleStir = useCallback(async (action: StirAction) => {
        if (!gameState) return;
        const userActor = userProfile?.name || '你';
        const result = applyTriggerEvent(gameState, action.eventType, action.involvedNpcIds, action.eventDesc);
        const actionDesc = buildUserActionDescription('TRIGGER_EVENT', userActor, {
            eventType: action.eventType, eventDesc: action.eventDesc,
        });

        const simAction: SimAction = {
            id: genId(), turnNumber: gameState.turnNumber,
            actor: userActor, actorAvatar: userProfile?.avatar || '',
            actorId: 'user', type: 'TRIGGER_EVENT',
            description: actionDesc, immediateResult: result.immediateResult, timestamp: Date.now(),
        };
        let s = { ...result.newState, actionLog: [...result.newState.actionLog, simAction] };

        const { over, reason } = checkGameOver(s);
        if (over) {
            s.gameOver = true; s.gameOverReason = reason;
            await saveState(s); setShowGameOver(true); setActionPanel('none'); return;
        }

        const turnResult = await finalizeTurn(s);
        if (turnResult.shouldRunCharTurns) {
            await runCharTurns(turnResult.state, turnResult.replayActions);
        }
    }, [gameState, userProfile, finalizeTurn, runCharTurns]);

    // ── 用户行动：加人 ──────────────────────────────────────────

    const handleAddNpc = useCallback(async (action: AddNpcAction) => {
        if (!gameState) return;
        const userActor = userProfile?.name || '你';
        const npc = createNPC(action.name, action.emoji, action.personalities);
        const result = applyAddNPC(gameState, npc, action.familyId);
        const targetFamily = gameState.families.find(f => f.id === action.familyId);
        const actionDesc = buildUserActionDescription('ADD_NPC', userActor, {
            npcName: npc.name, npcEmoji: npc.emoji, npcPersonality: npc.personality,
            targetFamilyName: targetFamily?.name,
        });

        const simAction: SimAction = {
            id: genId(), turnNumber: gameState.turnNumber,
            actor: userActor, actorAvatar: userProfile?.avatar || '',
            actorId: 'user', type: 'ADD_NPC',
            description: actionDesc, immediateResult: result.immediateResult, timestamp: Date.now(),
        };
        let s = { ...result.newState, actionLog: [...result.newState.actionLog, simAction] };

        const turnResult = await finalizeTurn(s);
        if (turnResult.shouldRunCharTurns) {
            await runCharTurns(turnResult.state, turnResult.replayActions);
        }
    }, [gameState, userProfile, finalizeTurn, runCharTurns]);

    // ── 看戏（随机旁观角色戏 / 主线戏） ────────────────────────

    const handleWatch = useCallback(async () => {
        if (!gameState) return;

        const userActor = userProfile?.name || '你';
        const actionDesc = buildUserActionDescription('DO_NOTHING', userActor, {});
        const simAction: SimAction = {
            id: genId(), turnNumber: gameState.turnNumber,
            actor: userActor, actorAvatar: userProfile?.avatar || '',
            actorId: 'user', type: 'DO_NOTHING',
            description: actionDesc, immediateResult: '你选择了吃瓜围观……', timestamp: Date.now(),
        };
        const watchedState = { ...gameState, actionLog: [...gameState.actionLog, simAction] };

        if (Math.random() < MAIN_PLOT_WATCH_CHANCE) {
            const mainPlotResult = await buildMainPlotAction(watchedState);
            if (!mainPlotResult) {
                await saveState(watchedState);
                return;
            }

            let mainPlotState = mainPlotResult.newState;
            const immediateOutcome = checkGameOver(mainPlotState);
            if (immediateOutcome.over) {
                mainPlotState = {
                    ...mainPlotState,
                    gameOver: true,
                    gameOverReason: immediateOutcome.reason,
                    replayPending: [mainPlotResult.mainPlotAction],
                };
                await saveState(mainPlotState);
                setActionPanel('none');
                setShowReplay(true);
                setReplayIndex(0);
                setShowGameOver(true);
                return;
            }

            const turnResult = await finalizeTurn(mainPlotState, {
                replaySeed: [mainPlotResult.mainPlotAction],
                skipCharTurns: true,
                captureNonCharReplay: true,
            });

            if (turnResult.shouldRunCharTurns) {
                await runCharTurns(turnResult.state, turnResult.replayActions);
            }
            return;
        }

        const turnResult = await finalizeTurn(watchedState);
        if (turnResult.shouldRunCharTurns) {
            await runCharTurns(turnResult.state, turnResult.replayActions);
        }
    }, [gameState, userProfile, buildMainPlotAction, finalizeTurn, runCharTurns, saveState]);

    // ── CHAR决策执行 ──────────────────────────────────────────

    function executeCharDecision(state: LifeSimState, decision: CharDecision, char: CharacterProfile) {
        const act = decision.action;
        try {
            switch (act.type) {
                case 'ADD_NPC': {
                    const npc = createNPC(act.newNpcName || `${char.name}的小人`, act.newNpcEmoji || '', act.newNpcPersonality || ['神秘']);
                    const targetId = act.targetFamilyId && state.families.find(f => f.id === act.targetFamilyId) ? act.targetFamilyId : state.families[0]?.id;
                    if (!targetId) return { newState: state, immediateResult: '没有可用的家庭。' };
                    return applyAddNPC(state, npc, targetId);
                }
                case 'TRIGGER_EVENT': {
                    const involved = (act.involvedNpcIds || []).filter(id => state.npcs.find(n => n.id === id));
                    const fallback = state.npcs.slice(0, 2).map(n => n.id);
                    return applyTriggerEvent(state, act.eventType || 'gossip', involved.length ? involved : fallback, act.eventDescription || '发生了一些事');
                }
                default: return { newState: state, immediateResult: '……什么都没发生。' };
            }
        } catch { return { newState: state, immediateResult: '操作失败了，有点尴尬。' }; }
    }

    function buildCharActionDescription(charName: string, decision: CharDecision): string {
        const act = decision.action;
        const narr = decision.narrative;
        const toneEmoji = getLifeSimToneEmoji(narr?.emotionalTone);
        const tone = toneEmoji ? ` ${toneEmoji}` : '';
        switch (act.type) {
            case 'ADD_NPC': return `${charName}${tone}往本子里捏了个叫"${act.newNpcEmoji}${act.newNpcName}"的小人`;
            case 'TRIGGER_EVENT': return `${charName}${tone}在街角制造了${act.eventType}事件：${act.eventDescription || '…'}`;
            default: return `${charName}${tone}翻了翻手账，这页跳过了`;
        }
    }

    // ── 设置 / 编辑 / 结算重置 ────────────────────────────────

    const handleToggleParticipantChar = useCallback(async (charId: string) => {
        if (!gameState) return;
        const currentIds = resolveParticipantCharIds(gameState);
        const nextIds = currentIds.includes(charId)
            ? currentIds.filter(id => id !== charId)
            : [...currentIds, charId];
        await saveState({ ...gameState, participantCharIds: nextIds });
    }, [gameState, resolveParticipantCharIds, saveState]);

    const handleSelectAllParticipantChars = useCallback(async () => {
        if (!gameState) return;
        const nextIds = characters.filter(char => !!char.id).map(char => char.id);
        await saveState({ ...gameState, participantCharIds: nextIds });
    }, [characters, gameState, saveState]);

    const handleClearParticipantChars = useCallback(async () => {
        if (!gameState) return;
        await saveState({ ...gameState, participantCharIds: [] });
    }, [gameState, saveState]);

    const handleSaveLifeSimApiSettings = useCallback(async (payload: {
        enabled: boolean;
        config: { baseUrl: string; apiKey: string; model: string };
    }) => {
        if (!gameState) return;
        await saveState({
            ...gameState,
            useIndependentApiConfig: payload.enabled,
            independentApiConfig: {
                baseUrl: payload.config.baseUrl,
                apiKey: payload.config.apiKey,
                model: payload.config.model,
            },
        });
    }, [gameState, saveState]);

    const handleSaveNpcEdits = useCallback(async (updates: Partial<SimNPC>) => {
        if (!gameState || !editingNpc) return;
        const nextState: LifeSimState = {
            ...gameState,
            npcs: gameState.npcs.map(npc => (
                npc.id === editingNpc.id
                    ? { ...npc, ...updates, personality: updates.personality || npc.personality }
                    : npc
            )),
        };
        await saveState(nextState);
        setEditingNpc(null);
    }, [editingNpc, gameState, saveState]);

    const resetGame = useCallback(async (options?: {
        preserveParticipantCharIds?: string[];
        preserveUseIndependentApiConfig?: boolean;
        preserveIndependentApiConfig?: LifeSimState['independentApiConfig'];
    }) => {
        const newState = createNewLifeSimState();
        newState.lastActiveTimestamp = Date.now();
        if (options?.preserveParticipantCharIds) {
            newState.participantCharIds = [...options.preserveParticipantCharIds];
        }
        if (options?.preserveUseIndependentApiConfig !== undefined) {
            newState.useIndependentApiConfig = options.preserveUseIndependentApiConfig;
        }
        if (options?.preserveIndependentApiConfig) {
            newState.independentApiConfig = { ...options.preserveIndependentApiConfig };
        }
        setShowGameOver(false);
        setShowReplay(false);
        setActionPanel('none');
        setFestivalAnnounce('');
        setShowResetDialog(false);
        setShowSettings(false);
        setEditingNpc(null);
        await saveState(newState);
    }, [saveState]);

    const handleArchiveAndReset = useCallback(async () => {
        if (!gameState) return;

        const participantIds = resolveParticipantCharIds(gameState);
        const participantChars = getParticipatingCharacters(gameState);
        const participantNames = participantChars.map(char => char.name);
        const fallbackSummary = buildFallbackLifeSimSessionSummary(userProfile?.name || '用户', participantNames, gameState.actionLog).slice(0, 300);
        const mainPlots = gameState.actionLog.filter(action => action.storyKind === 'main_plot');
        const resolvedApiConfig = resolveLifeSimApiConfig(gameState);

        setIsResetting(true);
        setProcessingMsg('正在把这条街收进手账...');

        try {
            let summary = fallbackSummary;
            const canUseApi = !!(userProfile && resolvedApiConfig?.baseUrl && resolvedApiConfig?.model);

            if (canUseApi && userProfile) {
                const raw = await callCharAI(
                    resolvedApiConfig,
                    buildLifeSimSessionSummaryPrompt(userProfile, participantNames, gameState.actionLog),
                    { featureId: 'date.summary', apiBinding: '街角会话总结' },
                );
                let rawJson = extractJson(raw);
                if (Array.isArray(rawJson)) rawJson = rawJson[0];
                const aiSummary = String(rawJson?.summary || rawJson?.content || rawJson?.text || '').replace(/\s+/g, ' ').trim();
                if (aiSummary) summary = aiSummary.slice(0, 300);
            }

            for (const char of participantChars) {
                const cardData = createLifeSimResetCardData({
                    summary,
                    headline: mainPlots[0]?.headline || mainPlots[mainPlots.length - 1]?.headline,
                    userName: userProfile?.name || '用户',
                    participantNames,
                    charName: char.name,
                    charAvatar: char.avatar,
                    mainPlotCount: mainPlots.length,
                    turnCount: gameState.turnNumber,
                });

                await DB.saveMessage({
                    charId: char.id,
                    role: 'system',
                    type: 'score_card',
                    content: JSON.stringify(cardData),
                    metadata: { scoreCard: cardData, source: 'lifesim-reset' },
                });
            }

            await resetGame({
                preserveParticipantCharIds: participantIds,
                preserveUseIndependentApiConfig: gameState.useIndependentApiConfig,
                preserveIndependentApiConfig: gameState.independentApiConfig,
            });
        } finally {
            setIsResetting(false);
            setProcessingMsg('');
        }
    }, [gameState, getParticipatingCharacters, resetGame, resolveLifeSimApiConfig, resolveParticipantCharIds, userProfile]);

    const handleDirectReset = useCallback(async () => {
        if (!gameState) return;
        const participantIds = resolveParticipantCharIds(gameState);
        await resetGame({
            preserveParticipantCharIds: participantIds,
            preserveUseIndependentApiConfig: gameState.useIndependentApiConfig,
            preserveIndependentApiConfig: gameState.independentApiConfig,
        });
    }, [gameState, resetGame, resolveParticipantCharIds]);

    const nextReplay = () => {
        if (!gameState) return;
        if (replayIndex < (gameState.replayPending?.length ?? 0) - 1) {
            setReplayIndex(i => i + 1);
        } else {
            const s = { ...gameState, replayPending: [] };
            saveState(s); setShowReplay(false);
        }
    };

    // ── 渲染 ─────────────────────────────────────────────────

    if (isLoading) {
        return (
            <div className="sj-app h-full flex items-center justify-center" style={{ background: '#f4f2ed' }}>
                <SJStyles accent="#6f9b6a" tape="rgba(150,190,150,0.5)" tape2="rgba(196,220,176,0.55)" />
                <div className="scrap-card press-soft tilt-l relative" style={{ width: 200, padding: '26px 18px', borderRadius: 16, textAlign: 'center' }}>
                    <span className="sj-tape" style={{ top: -11, left: '50%', transform: 'translateX(-50%) rotate(-3deg)', width: 96 }} />
                    <Storefront size={34} weight="duotone" className="mx-auto" style={{ color: '#6f9b6a' }} />
                    <p className="font-hand" style={{ color: '#2b2933', fontSize: 20, marginTop: 8, fontWeight: 700 }}>正在翻开《街角》…</p>
                    <p className="label-mono" style={{ color: '#a79c8e', fontSize: 8, marginTop: 4 }}>opening the journal</p>
                </div>
            </div>
        );
    }

    if (!gameState) return null;

    const isUserTurn = gameState.currentActorId === 'user' && !gameState.isProcessingCharTurn;
    const { label: chaosLabel } = getChaosLabel(gameState.chaosLevel);
    const season = gameState.season ?? 'spring';
    const si = SEASON_INFO[season];
    const ti = TIME_INFO[gameState.timeOfDay ?? 'morning'];
    const wi = WEATHER_INFO[gameState.weather ?? 'sunny'];
    const todayFestival = getTodayFestival(gameState);
    const participantChars = getParticipatingCharacters(gameState);
    const activeThinkingChar = participantChars.find(char => char.id === gameState.currentActorId) || null;
    const isMainPlotThinking = !!processingMsg && !gameState.isProcessingCharTurn;
    const scrap = SEASON_SCRAP[season] || SEASON_SCRAP.spring;
    const highTension = gameState.chaosLevel > 70;
    const topSafePadding = '12px';

    const TABS = [
        { id: 'npcs', label: '街坊', en: 'folks', Icon: UsersThree },
        { id: 'drama', label: '街谈', en: 'word on the street', Icon: ChatsCircle },
        { id: 'relations', label: '人情', en: 'ties', Icon: HeartHalf },
    ] as const;

    const userNode: MapNode = {
        id: 'user',
        kind: 'user',
        label: userProfile?.name || '我',
        sublabel: '当前位置',
        avatar: userProfile?.avatar,
        x: USER_POINT.x,
        y: USER_POINT.y,
        color: '#2563eb',
        badge: '我',
        active: isUserTurn,
    };

    const familyNodes: MapNode[] = gameState.families.map(family => {
        const members = gameState.npcs.filter(npc => npc.familyId === family.id);
        const moodAvg = members.length ? Math.round(members.reduce((sum, npc) => sum + npc.mood, 0) / members.length) : 0;
        return {
            id: `family-${family.id}`,
            kind: 'family',
            label: family.name,
            sublabel: `${members.length} 位街坊 · 心情 ${moodAvg >= 0 ? '+' : ''}${moodAvg}`,
            emoji: family.emoji,
            x: family.homeX,
            y: family.homeY,
            color: members.length ? scrap.accent : '#94a3b8',
            badge: members.length ? `${members.length}` : '空',
            muted: members.length === 0,
        };
    });

    const npcNodes: MapNode[] = gameState.npcs.map(npc => {
        const point = npcMapPoint(gameState, npc);
        const hasTension = (npc.grudges?.length || 0) > 0;
        const hasCrush = (npc.crushes?.length || 0) > 0;
        return {
            id: `npc-${npc.id}`,
            kind: 'person',
            label: npc.name,
            sublabel: npc.personality.slice(0, 2).join(' / ') || '街坊',
            emoji: npc.emoji,
            x: point.x,
            y: point.y,
            color: hasTension ? '#dc2626' : hasCrush ? '#db2777' : '#475569',
            badge: hasTension ? '怨' : hasCrush ? '恋' : undefined,
            active: gameState.currentActorId === npc.id,
        };
    });

    const recentEventNodes: MapNode[] = gameState.actionLog.slice(-4).map((action, index): MapNode => {
        const involved = action.involvedNpcIds?.map(id => gameState.npcs.find(npc => npc.id === id)).filter(Boolean) as SimNPC[] | undefined;
        const base = involved?.[0] ? npcMapPoint(gameState, involved[0]) : fallbackPoint(action.id);
        const point = jitterPoint(`event-${action.id}`, base, 6);
        return {
            id: `event-${action.id}`,
            kind: 'event',
            label: action.headline || '街头事件',
            sublabel: `pg.${action.turnNumber}`,
            x: point.x,
            y: point.y,
            color: action.storyKind === 'main_plot' ? '#d97706' : EVENT_ACCENTS[action.type as string] || '#7c3aed',
            badge: action.storyKind === 'main_plot' ? '主线' : `${index + 1}`,
        };
    }).reverse();

    const thinkingNodes: MapNode[] = activeThinkingChar ? [{
        id: `actor-${activeThinkingChar.id}`,
        kind: 'person',
        label: activeThinkingChar.name,
        sublabel: '正在行动',
        avatar: activeThinkingChar.avatar,
        x: 55,
        y: 61,
        color: '#7c3aed',
        active: true,
    }] : [];

    const mapNodes = mapLayer === 'relations'
        ? [...npcNodes, ...recentEventNodes.slice(0, 2), ...thinkingNodes]
        : [...familyNodes, ...gameState.npcs.filter(npc => !npc.familyId).map(npc => npcNodes.find(node => node.id === `npc-${npc.id}`)!).filter(Boolean), ...recentEventNodes, ...thinkingNodes];

    const selectedMapNode = selectedMapNodeId
        ? [userNode, ...mapNodes, ...npcNodes, ...familyNodes].find(node => node.id === selectedMapNodeId) || null
        : null;

    const selectedRoute: MapRoute[] = selectedMapNode && selectedMapNode.id !== 'user'
        ? [{
            id: `route-${selectedMapNode.id}`,
            from: USER_POINT,
            to: selectedMapNode,
            label: mapDistanceLabel(USER_POINT, selectedMapNode),
            color: selectedMapNode.color || '#2563eb',
            dashed: true,
        }]
        : [];

    const relationRoutes: MapRoute[] = mapLayer === 'relations' ? gameState.npcs.flatMap(npc => {
        const from = npcMapPoint(gameState, npc);
        const routes: MapRoute[] = [];
        (npc.crushes || []).forEach(targetId => {
            const target = gameState.npcs.find(item => item.id === targetId);
            if (target) routes.push({ id: `crush-${npc.id}-${target.id}`, from, to: npcMapPoint(gameState, target), color: '#db2777', label: '暗恋', dashed: true });
        });
        (npc.grudges || []).forEach(targetId => {
            const target = gameState.npcs.find(item => item.id === targetId);
            if (target) routes.push({ id: `grudge-${npc.id}-${target.id}`, from, to: npcMapPoint(gameState, target), color: '#dc2626', label: '记仇', dashed: true });
        });
        return routes;
    }) : [];

    const selectedAction = selectedMapNode ? latestActionForNode(gameState, selectedMapNode) : undefined;
    const latestAction = gameState.actionLog[gameState.actionLog.length - 1] || null;
    const latestActionTitle = latestAction?.headline || latestAction?.description || '这条街正在等下一页';
    const mainPlotCount = gameState.actionLog.filter(action => action.storyKind === 'main_plot').length;
    const relationshipSignals = gameState.npcs.reduce((sum, npc) => sum + (npc.crushes?.length || 0) + (npc.grudges?.length || 0), 0);
    const readyApi = resolveLifeSimApiConfig(gameState);
    const apiReady = !!(readyApi?.baseUrl && readyApi?.model);
    const homeMapNodes = [...familyNodes.slice(0, 4), ...npcNodes.slice(0, 5), ...recentEventNodes.slice(0, 3), ...thinkingNodes];
    const recentHomeActions = [...gameState.actionLog].slice(-4).reverse();
    const homeStatusTitle = gameState.isProcessingCharTurn
        ? (processingMsg || '街坊们正在行动')
        : isUserTurn
            ? '轮到你给这条街落笔'
            : '街角正在更新';

    return (
        <div className={`sj-app sj-map-app ${view === 'home' ? 'sj-home-app' : ''} h-full w-full max-w-full flex flex-col overflow-hidden select-none`}>

            <SJStyles accent={scrap.accent} tape={scrap.tape} tape2={scrap.tape2} />

            <header className="sj-nav">
                <button onClick={closeApp} aria-label="返回" className="sj-icon-button">
                    <ArrowLeft size={18} weight="bold" />
                </button>
                <div className="sj-nav-title">
                    <div className="sj-nav-name">街角</div>
                    <div className="sj-nav-meta">
                        <span>{si.zh}</span><span>{ti.zh}</span><span>{wi.zh}</span><span>DAY {gameState.day ?? 1}</span>
                    </div>
                </div>
                <div className="sj-nav-tools">
                    <button onClick={() => setView(view === 'map' ? 'home' : 'map')} title={view === 'map' ? '街角首页' : '街区地图'} className="sj-icon-button">
                        {view === 'map' ? <Storefront size={18} weight="bold" /> : <MapTrifold size={18} weight="bold" />}
                    </button>
                    <button onClick={() => setShowRoam(true)} title="出门逛逛" className="sj-icon-button"><Footprints size={18} weight="bold" /></button>
                    <button onClick={() => setShowDate(true)} title="带 TA 去约会" className="sj-icon-button"><HeartHalf size={18} weight="bold" /></button>
                    <button onClick={() => setShowSettings(true)} title="设定" className="sj-icon-button with-count">
                        <GearSix size={18} weight="bold" />
                        <span>{participantChars.length}</span>
                    </button>
                    <button onClick={() => setShowResetDialog(true)} title="翻篇重开" className="sj-icon-button"><ArrowCounterClockwise size={18} weight="bold" /></button>
                </div>
            </header>

            {(todayFestival || festivalAnnounce) && (
                <div className="sj-alert">
                    {todayFestival ? <><TwemojiImg emoji={todayFestival.emoji} size={14} /> {todayFestival.name}</> : festivalAnnounce}
                </div>
            )}

            {view === 'home' ? (
                <main className="sj-home-shell no-scrollbar">
                    <section className="sj-home-status">
                        <div className="sj-home-status-copy">
                            <div className="sj-home-kicker">
                                <span>{si.zh}</span><span>{ti.zh}</span><span>{wi.zh}</span>
                            </div>
                            <h2>{homeStatusTitle}</h2>
                            <p>{latestActionTitle}</p>
                        </div>
                        <button
                            className="sj-home-primary"
                            onClick={() => {
                                setView('map');
                                setSelectedMapNodeId(null);
                            }}
                        >
                            <MapTrifold size={18} weight="bold" />
                            <span>街区地图</span>
                        </button>
                    </section>

                    <div className="sj-home-actions">
                        <button onClick={() => setView('map')} className="sj-action-tile is-primary">
                            <MapTrifold size={20} weight="bold" />
                            <b>街区</b>
                            <small>{gameState.npcs.length} 位街坊</small>
                        </button>
                        <button onClick={() => setShowRoam(true)} className="sj-action-tile">
                            <Footprints size={20} weight="bold" />
                            <b>漫游</b>
                            <small>足迹 {recentHomeActions.length}</small>
                        </button>
                        <button onClick={() => setShowDate(true)} className="sj-action-tile">
                            <HeartHalf size={20} weight="bold" />
                            <b>约会</b>
                            <small>{participantChars[0]?.name || '选择角色'}</small>
                        </button>
                        <button onClick={() => setShowSettings(true)} className="sj-action-tile">
                            <GearSix size={20} weight="bold" />
                            <b>设定</b>
                            <small>{participantChars.length} 位参与</small>
                        </button>
                    </div>

                    {(!participantChars.length || !apiReady) && (
                        <div className="sj-home-notice">
                            <div>
                                <b>{!participantChars.length ? '还没有参与角色' : '街角 API 未就绪'}</b>
                                <span>{!participantChars.length ? '选择几位角色后，街坊回合和约会会更完整。' : '可继续浏览本地内容；生成剧情前建议配好副 API 或独立 API。'}</span>
                            </div>
                            <button onClick={() => setShowSettings(true)}>{!participantChars.length ? '选角色' : '去设定'}</button>
                        </div>
                    )}

                    <section className="sj-home-section">
                        <div className="sj-section-head">
                            <span>街区脉搏</span>
                            <button onClick={() => setShowResetDialog(true)}>翻篇</button>
                        </div>
                        <div className="sj-metric-grid">
                            <div><b>{gameState.turnNumber}</b><span>页码</span></div>
                            <div><b>{gameState.chaosLevel}°</b><span>{chaosLabel}</span></div>
                            <div><b>{mainPlotCount}</b><span>主线</span></div>
                            <div><b>{relationshipSignals}</b><span>牵连</span></div>
                        </div>
                    </section>

                    <section className="sj-home-map-card">
                        <StreetMap
                            nodes={homeMapNodes}
                            user={userNode}
                            routes={relationRoutes.slice(0, 5)}
                            layer={mapLayer}
                            height={252}
                            title={`${si.zh}日的街区`}
                            subtitle={`${chaosLabel} · pg.${gameState.turnNumber}`}
                            onCanvasClick={() => setView('map')}
                            onNodeClick={(node, event) => {
                                event.stopPropagation();
                                setView('map');
                                setSelectedMapNodeId(node.id);
                                if (node.kind === 'event' || node.kind === 'worldline') setActiveTab('drama');
                                if (node.kind === 'person' || node.kind === 'family') setActiveTab('npcs');
                            }}
                            bottomCenter={
                                <button
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        setView('map');
                                    }}
                                    className="sj-map-preview-button"
                                >
                                    进入地图
                                </button>
                            }
                        />
                    </section>

                    <section className="sj-home-section">
                        <div className="sj-section-head">
                            <span>登场人物</span>
                            <button onClick={() => setShowSettings(true)}>调整</button>
                        </div>
                        {participantChars.length ? (
                            <div className="sj-avatar-strip">
                                {participantChars.slice(0, 8).map(char => (
                                    <button key={char.id} onClick={() => setShowDate(true)} title={`和 ${char.name} 约会`}>
                                        <img src={char.avatar} alt="" />
                                        <span>{char.name}</span>
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <p className="sj-empty-copy">还没有角色加入本局。</p>
                        )}
                    </section>

                    <section className="sj-home-section sj-home-feed">
                        <div className="sj-section-head">
                            <span>最近街谈</span>
                            <button onClick={() => { setView('map'); setActiveTab('drama'); }}>查看</button>
                        </div>
                        {recentHomeActions.length ? recentHomeActions.map(action => (
                            <button
                                key={action.id}
                                onClick={() => {
                                    setView('map');
                                    setActiveTab(action.storyKind === 'system' ? 'drama' : 'drama');
                                    setSelectedMapNodeId(`event-${action.id}`);
                                }}
                                className="sj-feed-line"
                            >
                                <span>{action.actorAvatar || '•'}</span>
                                <b>{action.headline || action.description}</b>
                                <small>pg.{action.turnNumber}</small>
                            </button>
                        )) : (
                            <p className="sj-empty-copy">还没有新街谈。</p>
                        )}
                    </section>
                </main>
            ) : (
                <>
            <main className="sj-map-stage">
                <StreetMap
                    nodes={mapNodes}
                    user={userNode}
                    routes={[...relationRoutes, ...selectedRoute]}
                    layer={mapLayer}
                    selectedNodeId={selectedMapNodeId}
                    height="100%"
                    title={`${si.zh}日的街区`}
                    subtitle={`${chaosLabel} · year ${gameState.year ?? 1} · pg.${gameState.turnNumber}`}
                    onCanvasClick={() => setSelectedMapNodeId(null)}
                    onNodeClick={(node, event) => {
                        event.stopPropagation();
                        setSelectedMapNodeId(node.id);
                        if (node.kind === 'event' || node.kind === 'worldline') setActiveTab('drama');
                        if (node.kind === 'person' || node.kind === 'family') setActiveTab('npcs');
                    }}
                    topRight={
                        <div className="sj-layer-toggle">
                            <button className={mapLayer === 'info' ? 'active' : ''} onClick={(event) => { event.stopPropagation(); setMapLayer('info'); }}>信息</button>
                            <button className={mapLayer === 'relations' ? 'active' : ''} onClick={(event) => { event.stopPropagation(); setMapLayer('relations'); setActiveTab('relations'); }}>关系</button>
                        </div>
                    }
                    bottomLeft={
                        <div className="sj-heat-pill">
                            <span>{chaosLabel}</span>
                            <b>{gameState.chaosLevel}°</b>
                        </div>
                    }
                    bottomCenter={
                        <div className="sj-map-hint">
                            {selectedMapNode ? `${selectedMapNode.label} · ${selectedMapNode.sublabel || '查看详情'}` : '点地图 pin 查看地点、街坊和事件'}
                        </div>
                    }
                />
            </main>

            <section className="sj-bottom-panel">
                <div className="sj-detail-row">
                    {selectedMapNode ? (
                        <div className="sj-selected-detail">
                            <div>
                                <div className="sj-detail-kicker">{selectedMapNode.kind === 'event' ? '最近事件' : selectedMapNode.kind === 'family' ? '地点' : '地图节点'}</div>
                                <div className="sj-detail-title">{selectedMapNode.label}</div>
                                <div className="sj-detail-copy">
                                    {selectedAction?.headline || selectedAction?.description || selectedMapNode.sublabel || '这处 pin 暂时没有更多记录。'}
                                </div>
                            </div>
                            <button onClick={() => setSelectedMapNodeId(null)} className="sj-text-button">收起</button>
                        </div>
                    ) : (
                        <div className="sj-selected-detail">
                            <div>
                                <div className="sj-detail-kicker">街区状态</div>
                                <div className="sj-detail-title">{gameState.isProcessingCharTurn ? (processingMsg || '街坊们在琢磨…') : isUserTurn ? '轮到你落笔了' : '街角正在更新'}</div>
                                <div className="sj-detail-copy">
                                    {participantChars.length > 0
                                        ? `本局有 ${participantChars.length} 位角色参与，地图会记录他们影响到的街坊关系。`
                                        : '还没有选择参与角色，去设定里挑几位角色加入这条街。'}
                                </div>
                            </div>
                            {gameState.isProcessingCharTurn ? <GearSix size={18} weight="bold" className="animate-spin" /> : <Star size={18} weight="fill" color={scrap.accent} />}
                        </div>
                    )}
                </div>

                <div className="sj-panel-tabs">
                    {TABS.map(({ id, label, Icon }) => {
                        const active = activeTab === id;
                        return (
                            <button key={id} onClick={() => setActiveTab(id as any)} className={active ? 'active' : ''}>
                                <Icon size={15} weight="bold" /> {label}
                            </button>
                        );
                    })}
                </div>
                <div className="sj-panel-content no-scrollbar">
                    {activeTab === 'npcs' && <NPCGrid gameState={gameState} onLongPressNpc={setEditingNpc} />}
                    {activeTab === 'drama' && <DramaFeed gameState={gameState} />}
                    {activeTab === 'relations' && <RelationsTab gameState={gameState} />}
                </div>
            </section>

            {isUserTurn && (
                <div className="sj-map-dock">
                    <button onClick={() => setActionPanel('stir')} title="搅局"><MaskHappy size={19} weight="bold" /><span>搅局</span></button>
                    <button onClick={() => setActionPanel('add')} title="拉人"><UserPlus size={19} weight="bold" /><span>拉人</span></button>
                    <button onClick={handleWatch} title="吃瓜"><Eye size={19} weight="bold" /><span>吃瓜</span></button>
                </div>
            )}
                </>
            )}

            {/* ── 行动面板 ── */}
            {actionPanel !== 'none' && isUserTurn && (
                <ActionPanel
                    gameState={gameState}
                    mode={actionPanel}
                    accent={scrap.accent}
                    onStir={handleStir}
                    onAdd={handleAddNpc}
                    onClose={() => setActionPanel('none')}
                />
            )}

            {showSettings && (
                <LifeSimSettingsPanel
                    characters={characters}
                    selectedCharIds={resolveParticipantCharIds(gameState)}
                    apiPresets={apiPresets}
                    useIndependentApiConfig={!!gameState.useIndependentApiConfig}
                    independentApiConfig={gameState.independentApiConfig}
                    onToggleChar={handleToggleParticipantChar}
                    onSelectAll={handleSelectAllParticipantChars}
                    onSelectNone={handleClearParticipantChars}
                    onSaveApiSettings={handleSaveLifeSimApiSettings}
                    onClose={() => setShowSettings(false)}
                />
            )}

            {editingNpc && (
                <NPCEditorPanel
                    npc={editingNpc}
                    onSave={handleSaveNpcEdits}
                    onClose={() => setEditingNpc(null)}
                />
            )}

            {showResetDialog && (
                <ResetCityDialog
                    participantCount={participantChars.length}
                    mainPlotCount={gameState.actionLog.filter(action => action.storyKind === 'main_plot').length}
                    processing={isResetting}
                    onCancel={() => setShowResetDialog(false)}
                    onArchiveAndReset={handleArchiveAndReset}
                    onDirectReset={handleDirectReset}
                />
            )}

            {/* ── 回放弹窗 ── */}
            {showReplay && gameState.replayPending && gameState.replayPending.length > 0 && (
                <NarrativeReplayOverlay
                    actions={gameState.replayPending}
                    currentIndex={replayIndex}
                    onNext={nextReplay}
                />
            )}

            {/* ── 游戏结束 ── */}
            {showGameOver && (
                <GameOverOverlay reason={gameState.gameOverReason} onRestart={resetGame} />
            )}

            {/* ── 漫游系统 ── */}
            {showRoam && <RoamView onClose={() => setShowRoam(false)} />}

            {/* ── 约会世界引擎 ── */}
            {showDate && <DateView onClose={() => setShowDate(false)} />}
        </div>
    );
};

// ── 街角 · 共享拼贴样式 ──────────────────────────────────────
const SJStyles: React.FC<{ accent: string; tape: string; tape2: string }> = ({ accent, tape, tape2 }) => (
    <style>{`
        .sj-app {
            color: #172033;
            --sj-accent: ${accent};
            --sj-tape: ${tape};
            --sj-tape2: ${tape2};
            background:
                linear-gradient(180deg, #f8fafc 0%, #eef2f4 52%, #f8fafc 100%);
        }
        .sj-map-app {
            position: relative;
            overflow-x: hidden;
            padding-bottom: 74px;
        }
        .sj-map-app .font-hand {
            font-family: inherit;
        }
        .sj-home-shell {
            flex: 1 1 auto;
            min-height: 0;
            overflow-y: auto;
            overflow-x: hidden;
            padding: 12px 12px max(18px, env(safe-area-inset-bottom, 0px));
        }
        .sj-home-status {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            align-items: stretch;
            gap: 10px;
            margin-bottom: 10px;
            padding: 14px;
            border-radius: 22px;
            background: rgba(255, 255, 255, 0.94);
            border: 1px solid rgba(226, 232, 240, 0.96);
            box-shadow: 0 18px 44px -34px rgba(15, 23, 42, 0.72);
        }
        .sj-home-status-copy {
            min-width: 0;
        }
        .sj-home-kicker {
            display: flex;
            align-items: center;
            gap: 5px;
            flex-wrap: wrap;
            color: #64748b;
            font-size: 10px;
            font-weight: 900;
        }
        .sj-home-kicker span {
            padding: 2px 7px;
            border-radius: 999px;
            background: #f1f5f9;
            border: 1px solid rgba(226, 232, 240, 0.96);
        }
        .sj-home-status h2 {
            margin: 9px 0 0;
            color: #0f172a;
            font-size: 22px;
            line-height: 1.18;
            font-weight: 950;
            overflow-wrap: anywhere;
        }
        .sj-home-status p {
            margin: 7px 0 0;
            color: #64748b;
            font-size: 12px;
            line-height: 1.55;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }
        .sj-home-primary {
            min-width: 84px;
            border: 0;
            border-radius: 18px;
            display: inline-flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 5px;
            background: #172033;
            color: #fff;
            font-size: 12px;
            font-weight: 900;
            box-shadow: 0 16px 28px -22px rgba(15, 23, 42, 0.9);
        }
        .sj-home-actions {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 8px;
            margin-bottom: 10px;
        }
        .sj-action-tile {
            min-width: 0;
            min-height: 82px;
            padding: 10px 6px;
            border-radius: 18px;
            border: 1px solid rgba(226, 232, 240, 0.96);
            background: rgba(255, 255, 255, 0.94);
            color: #172033;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 5px;
            box-shadow: 0 14px 28px -26px rgba(15, 23, 42, 0.7);
            touch-action: manipulation;
        }
        .sj-action-tile.is-primary {
            background: rgba(255, 255, 255, 0.98);
            border-color: var(--sj-accent);
            color: var(--sj-accent);
        }
        .sj-action-tile b {
            font-size: 13px;
            line-height: 1.1;
            font-weight: 950;
        }
        .sj-action-tile small {
            max-width: 100%;
            color: #64748b;
            font-size: 10px;
            font-weight: 800;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .sj-home-notice {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            margin-bottom: 10px;
            padding: 10px 12px;
            border-radius: 18px;
            background: rgba(255, 255, 255, 0.94);
            border: 1px solid rgba(226, 232, 240, 0.96);
            color: #334155;
        }
        .sj-home-notice div {
            display: flex;
            flex-direction: column;
            gap: 2px;
            min-width: 0;
        }
        .sj-home-notice b {
            color: #0f172a;
            font-size: 13px;
            font-weight: 950;
        }
        .sj-home-notice span {
            color: #64748b;
            font-size: 11px;
            line-height: 1.45;
        }
        .sj-home-notice button,
        .sj-section-head button,
        .sj-map-preview-button {
            flex: 0 0 auto;
            border: 0;
            border-radius: 999px;
            padding: 7px 11px;
            background: #172033;
            color: #fff;
            font-size: 12px;
            font-weight: 900;
        }
        .sj-home-section {
            margin-bottom: 10px;
            padding: 12px;
            border-radius: 20px;
            background: rgba(255, 255, 255, 0.94);
            border: 1px solid rgba(226, 232, 240, 0.96);
            box-shadow: 0 14px 30px -28px rgba(15, 23, 42, 0.64);
        }
        .sj-section-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            margin-bottom: 10px;
        }
        .sj-section-head span {
            color: #0f172a;
            font-size: 15px;
            font-weight: 950;
        }
        .sj-section-head button {
            background: #eef2f4;
            color: #475569;
        }
        .sj-metric-grid {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 8px;
        }
        .sj-metric-grid div {
            min-width: 0;
            padding: 10px 7px;
            border-radius: 16px;
            background: #f8fafc;
            border: 1px solid rgba(226, 232, 240, 0.9);
            text-align: center;
        }
        .sj-metric-grid b {
            display: block;
            color: var(--sj-accent);
            font-size: 18px;
            line-height: 1;
            font-weight: 950;
        }
        .sj-metric-grid span {
            display: block;
            margin-top: 5px;
            color: #64748b;
            font-size: 10px;
            font-weight: 900;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .sj-home-map-card {
            margin-bottom: 10px;
        }
        .sj-home-map-card .street-map {
            border-radius: 20px;
        }
        .sj-map-preview-button {
            padding: 8px 13px;
            box-shadow: 0 12px 24px -20px rgba(15, 23, 42, 0.85);
        }
        .sj-avatar-strip {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 8px;
        }
        .sj-avatar-strip button {
            min-width: 0;
            border: 1px solid rgba(226, 232, 240, 0.96);
            border-radius: 16px;
            padding: 8px 6px;
            background: #f8fafc;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 6px;
        }
        .sj-avatar-strip img {
            width: 42px;
            height: 42px;
            border-radius: 999px;
            object-fit: cover;
            box-shadow: 0 0 0 2px rgba(255,255,255,0.92);
        }
        .sj-avatar-strip span {
            max-width: 100%;
            color: #334155;
            font-size: 11px;
            font-weight: 900;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .sj-empty-copy {
            margin: 0;
            color: #64748b;
            font-size: 12px;
            line-height: 1.55;
        }
        .sj-home-feed {
            margin-bottom: 0;
        }
        .sj-feed-line {
            width: 100%;
            min-width: 0;
            margin-top: 7px;
            padding: 9px 10px;
            border-radius: 15px;
            border: 1px solid rgba(226, 232, 240, 0.96);
            background: #f8fafc;
            display: grid;
            grid-template-columns: 24px minmax(0, 1fr) auto;
            align-items: center;
            gap: 8px;
            text-align: left;
        }
        .sj-feed-line span {
            width: 24px;
            height: 24px;
            border-radius: 999px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            background: #fff;
            color: #64748b;
            font-size: 13px;
            overflow: hidden;
        }
        .sj-feed-line b {
            min-width: 0;
            color: #334155;
            font-size: 12px;
            line-height: 1.35;
            font-weight: 900;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .sj-feed-line small {
            color: #94a3b8;
            font-size: 10px;
            font-weight: 900;
        }
        .sj-nav {
            display: flex;
            align-items: center;
            gap: 10px;
            flex-shrink: 0;
            padding: calc(10px + env(safe-area-inset-top, 0px)) 12px 8px;
            background: rgba(248, 250, 252, 0.9);
            border-bottom: 1px solid rgba(226, 232, 240, 0.96);
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            z-index: 20;
        }
        .sj-nav-title {
            flex: 1;
            min-width: 0;
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        .sj-nav-name {
            font-size: 24px;
            font-weight: 900;
            line-height: 1;
            color: #0f172a;
        }
        .sj-nav-meta {
            display: flex;
            align-items: center;
            gap: 6px;
            min-width: 0;
            overflow-x: auto;
            color: #64748b;
            font-size: 11px;
            font-weight: 700;
            scrollbar-width: none;
        }
        .sj-nav-meta::-webkit-scrollbar { display: none; }
        .sj-nav-meta span {
            flex: 0 0 auto;
            padding: 2px 7px;
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.72);
            border: 1px solid rgba(226, 232, 240, 0.95);
        }
        .sj-nav-tools {
            display: flex;
            align-items: center;
            gap: 6px;
            flex: 0 0 auto;
        }
        .sj-icon-button {
            position: relative;
            width: 38px;
            height: 38px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border-radius: 999px;
            border: 1px solid rgba(203, 213, 225, 0.92);
            background: rgba(255, 255, 255, 0.9);
            color: #172033;
            box-shadow: 0 12px 26px -24px rgba(15, 23, 42, 0.7);
            touch-action: manipulation;
            transition: transform 0.15s ease, border-color 0.15s ease;
        }
        .sj-icon-button:active {
            transform: scale(0.94);
        }
        .sj-icon-button.with-count span {
            position: absolute;
            right: -2px;
            bottom: -2px;
            min-width: 16px;
            height: 16px;
            padding: 0 4px;
            border-radius: 999px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            background: var(--sj-accent);
            color: #fff;
            font-size: 9px;
            font-weight: 900;
            border: 2px solid #fff;
        }
        .sj-alert {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            margin: 8px 12px 0;
            flex-shrink: 0;
            padding: 7px 12px;
            border-radius: 14px;
            background: rgba(255,255,255,0.88);
            border: 1px solid rgba(226, 232, 240, 0.95);
            color: #334155;
            font-size: 12px;
            font-weight: 800;
            box-shadow: 0 12px 26px -24px rgba(15, 23, 42, 0.65);
        }
        .sj-map-stage {
            flex: 1 1 auto;
            min-height: 260px;
            padding: 10px 12px 8px;
        }
        .sj-layer-toggle {
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 4px;
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.9);
            border: 1px solid rgba(226, 232, 240, 0.96);
            box-shadow: 0 12px 24px -22px rgba(15, 23, 42, 0.8);
            pointer-events: auto;
        }
        .sj-layer-toggle button {
            border: 0;
            padding: 6px 10px;
            border-radius: 999px;
            background: transparent;
            color: #64748b;
            font-size: 12px;
            font-weight: 900;
        }
        .sj-layer-toggle button.active {
            color: #fff;
            background: #172033;
        }
        .sj-heat-pill,
        .sj-map-hint {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            max-width: min(310px, 78vw);
            padding: 7px 12px;
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.9);
            border: 1px solid rgba(226, 232, 240, 0.96);
            color: #334155;
            box-shadow: 0 12px 24px -22px rgba(15, 23, 42, 0.8);
            font-size: 12px;
            font-weight: 900;
        }
        .sj-map-hint {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .sj-heat-pill b {
            color: ${accent};
        }
        .sj-bottom-panel {
            flex: 0 0 min(42vh, 330px);
            min-height: 214px;
            margin: 0 12px 10px;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            border-radius: 22px;
            background: rgba(255, 255, 255, 0.94);
            border: 1px solid rgba(226, 232, 240, 0.96);
            box-shadow: 0 -18px 44px -34px rgba(15, 23, 42, 0.75);
        }
        .sj-detail-row {
            flex: 0 0 auto;
            padding: 10px 12px 8px;
            border-bottom: 1px solid rgba(226, 232, 240, 0.9);
        }
        .sj-selected-detail {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            min-width: 0;
        }
        .sj-detail-kicker {
            color: #64748b;
            font-size: 10px;
            font-weight: 900;
        }
        .sj-detail-title {
            margin-top: 2px;
            color: #0f172a;
            font-size: 16px;
            font-weight: 900;
            line-height: 1.25;
            overflow-wrap: anywhere;
        }
        .sj-detail-copy {
            margin-top: 3px;
            color: #64748b;
            font-size: 12px;
            line-height: 1.45;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }
        .sj-text-button {
            flex: 0 0 auto;
            border: 0;
            border-radius: 999px;
            padding: 7px 10px;
            background: #eef2f4;
            color: #475569;
            font-size: 12px;
            font-weight: 900;
        }
        .sj-panel-tabs {
            flex: 0 0 auto;
            display: flex;
            gap: 6px;
            padding: 8px 10px;
            background: rgba(248, 250, 252, 0.92);
            border-bottom: 1px solid rgba(226, 232, 240, 0.9);
        }
        .sj-panel-tabs button {
            flex: 1;
            min-width: 0;
            height: 34px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 5px;
            border: 1px solid transparent;
            border-radius: 999px;
            background: transparent;
            color: #64748b;
            font-size: 13px;
            font-weight: 900;
        }
        .sj-panel-tabs button.active {
            color: #fff;
            background: #172033;
            border-color: #172033;
        }
        .sj-panel-content {
            flex: 1;
            min-height: 0;
            overflow-y: auto;
            overflow-x: hidden;
            background: #f8fafc;
        }
        .sj-map-dock {
            position: absolute;
            left: 50%;
            bottom: max(10px, env(safe-area-inset-bottom, 0px));
            z-index: 35;
            transform: translateX(-50%);
            display: grid;
            grid-template-columns: repeat(3, minmax(62px, 1fr));
            gap: 7px;
            width: min(310px, calc(100% - 34px));
            padding: 7px;
            border-radius: 24px;
            background: rgba(15, 23, 42, 0.88);
            border: 1px solid rgba(255,255,255,0.16);
            box-shadow: 0 22px 36px -24px rgba(15,23,42,0.75);
            backdrop-filter: blur(18px);
            -webkit-backdrop-filter: blur(18px);
        }
        .sj-map-dock button {
            min-width: 0;
            border: 0;
            border-radius: 18px;
            padding: 8px 6px;
            display: inline-flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 2px;
            color: #fff;
            background: rgba(255,255,255,0.1);
            font-size: 11px;
            font-weight: 900;
        }
        .sj-map-dock button:active {
            transform: scale(0.96);
        }
        .sj-map-app .scrap-card {
            background: rgba(255,255,255,0.88) !important;
            border: 1px solid rgba(226,232,240,0.96) !important;
            outline: none !important;
            box-shadow: 0 12px 26px -24px rgba(15,23,42,0.55) !important;
        }
        .sj-map-app .scrap-btn,
        .sj-map-app .scrap-btn-paper {
            border-radius: 999px !important;
            border: 1px solid rgba(203,213,225,0.92) !important;
            background: rgba(255,255,255,0.92) !important;
            color: #172033 !important;
            outline: none !important;
            box-shadow: 0 12px 26px -24px rgba(15,23,42,0.65) !important;
        }
        /* 和纸胶带条 */
        .sj-app .sj-tape {
            position: absolute;
            height: 19px;
            background: var(--sj-tape);
            border-left: 1px dashed rgba(160,156,146,0.5);
            border-right: 1px dashed rgba(160,156,146,0.5);
            box-shadow: 0 1px 4px rgba(50,48,60,0.12);
            backdrop-filter: blur(1px);
            -webkit-backdrop-filter: blur(1px);
            z-index: 6;
            pointer-events: none;
        }
        /* 季节邮戳 */
        .sj-app .sj-stamp {
            display: inline-flex; align-items: center; gap: 2px;
            padding: 1px 5px;
            background: #fbfaf7;
            border-radius: 5px;
            outline: 1px dashed rgba(120,116,106,0.5);
            outline-offset: -2px;
            transform: rotate(-3deg);
        }
        /* 小贴条 chip */
        .sj-app .sj-chip {
            display: inline-flex; align-items: center; gap: 4px;
            padding: 2px 8px; border-radius: 999px;
            background: rgba(255,255,255,0.85);
            border: 1px solid rgba(236,233,226,0.95);
            outline: 1px dashed rgba(167,162,151,0.32);
            outline-offset: -3px;
            font-size: 11px; font-weight: 700; color: #5c574f;
            font-family: var(--font-hand);
        }
        @media (max-width: 430px) {
            .sj-nav { gap: 7px; padding-left: 9px; padding-right: 9px; }
            .sj-nav-name { font-size: 21px; }
            .sj-nav-tools { gap: 4px; }
            .sj-icon-button { width: 34px; height: 34px; }
            .sj-home-shell { padding-left: 9px; padding-right: 9px; }
            .sj-home-status { grid-template-columns: minmax(0, 1fr); }
            .sj-home-primary { min-height: 44px; flex-direction: row; }
            .sj-home-actions { grid-template-columns: repeat(2, minmax(0, 1fr)); }
            .sj-metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
            .sj-avatar-strip { grid-template-columns: repeat(3, minmax(0, 1fr)); }
            .sj-map-stage { padding-left: 9px; padding-right: 9px; }
            .sj-bottom-panel { margin-left: 9px; margin-right: 9px; flex-basis: min(44vh, 315px); }
        }
    `}</style>
);

export default LifeSimApp;
