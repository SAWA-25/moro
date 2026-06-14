/**
 * LifeSimApp — 街角 · 拼贴手账版
 * 核心体验：翻着手账看角色操控街坊邻里，制造街角Drama，离线回来发现整条街翻天覆地
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useOS } from '../context/OSContext';
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
import { extractJson, safeFetchJson } from '../utils/safeApi';
import { DB } from '../utils/db';
import { injectMemoryPalace } from '../utils/memoryPalace/pipeline';
import {
    Storefront, ArrowLeft, ArrowCounterClockwise, GearSix, Star,
    MaskHappy, UserPlus, Eye, UsersThree, ChatsCircle, HeartHalf, MapTrifold,
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
import WorldMap from './lifesim/WorldMap';
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

// ── API调用 ──────────────────────────────────────────────────────

const AI_MAX_RETRIES = 2;

async function callCharAI(
    apiConfig: { baseUrl: string; apiKey: string; model: string },
    systemPrompt: string
): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= AI_MAX_RETRIES; attempt++) {
        try {
            const data = await safeFetchJson(
                `${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                    body: JSON.stringify({
                        model: apiConfig.model,
                        messages: [{ role: 'user', content: systemPrompt }],
                        temperature: 0.85, max_tokens: 8192, stream: false,
                        response_format: { type: 'json_object' },
                    }),
                },
                2, 0, { appName: '街角', purpose: '剧情生成' }
            );
            return data?.choices?.[0]?.message?.content?.trim() || '';
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
    const { apiConfig, apiPresets, characters, userProfile, closeApp } = useOS();

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

    const [activeTab, setActiveTab] = useState<'npcs'|'drama'|'relations'>('npcs');
    const [actionPanel, setActionPanel] = useState<'none'|'stir'|'add'>('none');

    // ── 初始化 ──────────────────────────────────────────────────

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
        if (!state?.useIndependentApiConfig) return apiConfig;
        const override = state.independentApiConfig || {};
        return {
            ...apiConfig,
            baseUrl: override.baseUrl?.trim() || apiConfig.baseUrl,
            apiKey: override.apiKey?.trim() || apiConfig.apiKey,
            model: override.model?.trim() || apiConfig.model,
        };
    }, [apiConfig]);

    const buildMainPlotAction = useCallback(async (state: LifeSimState) => {
        if (!userProfile) return null;

        setProcessingMsg('主线编剧室正在加戏...');
        const fallback = buildFallbackWorldDramaDecision(state);
        const resolvedApiConfig = resolveLifeSimApiConfig(state);

        try {
            let decision = fallback;
            const canUseApi = !!(resolvedApiConfig?.baseUrl && resolvedApiConfig?.apiKey && resolvedApiConfig?.model);

            if (canUseApi) {
                const raw = await callCharAI(
                    { baseUrl: resolvedApiConfig.baseUrl, apiKey: resolvedApiConfig.apiKey, model: resolvedApiConfig.model },
                    buildWorldDramaPlannerPrompt(userProfile, state, state.actionLog)
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
        const canUseApi = !!(resolvedApiConfig?.baseUrl && resolvedApiConfig?.apiKey && resolvedApiConfig?.model);

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
                    const systemPrompt = buildCharTurnSystemPrompt(char, userProfile, chatHistory, s, s.actionLog);
                    const raw = await callCharAI(
                        { baseUrl: resolvedApiConfig.baseUrl, apiKey: resolvedApiConfig.apiKey, model: resolvedApiConfig.model },
                        systemPrompt
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
            const canUseApi = !!(userProfile && resolvedApiConfig?.baseUrl && resolvedApiConfig?.apiKey && resolvedApiConfig?.model);

            if (canUseApi && userProfile) {
                const raw = await callCharAI(
                    { baseUrl: resolvedApiConfig.baseUrl, apiKey: resolvedApiConfig.apiKey, model: resolvedApiConfig.model },
                    buildLifeSimSessionSummaryPrompt(userProfile, participantNames, gameState.actionLog)
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
    const topSafePadding = 'max(12px, env(safe-area-inset-top, 12px))';

    const TABS = [
        { id: 'npcs', label: '街坊', en: 'folks', Icon: UsersThree },
        { id: 'drama', label: '街谈', en: 'word on the street', Icon: ChatsCircle },
        { id: 'relations', label: '人情', en: 'ties', Icon: HeartHalf },
    ] as const;

    return (
        <div className="sj-app h-full w-full max-w-full flex flex-col overflow-hidden select-none"
            style={{ background: '#f4f2ed', overflowX: 'hidden' }}>

            <SJStyles accent={scrap.accent} tape={scrap.tape} tape2={scrap.tape2} />

            {/* ── 页眉：手写刊头 + 工具贴纸 + 蕾丝花边 ── */}
            <div className="flex-shrink-0 relative" style={{
                paddingTop: topSafePadding,
                background: 'linear-gradient(180deg, #fbfaf7, #f4f2ed)',
                borderBottom: '1px solid rgba(236,233,226,0.9)',
            }}>
                <div className="flex items-center gap-2 px-3 pt-2 pb-3" style={{ minHeight: 46 }}>
                    {/* 合上本子（返回） */}
                    <button onClick={closeApp} aria-label="返回"
                        className="scrap-btn-paper flex items-center justify-center flex-shrink-0"
                        style={{ width: 40, height: 40, touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}>
                        <ArrowLeft size={17} weight="bold" />
                    </button>

                    {/* 刊头 */}
                    <div className="flex-1 min-w-0 flex flex-col items-start leading-none pl-0.5">
                        <div className="flex items-baseline gap-1.5">
                            <span className="font-hand" style={{ fontSize: 33, fontWeight: 700, color: '#2b2933', letterSpacing: '0.06em' }}>街角</span>
                            <span className="sj-stamp" title={`${si.zh}`}>
                                <TwemojiImg emoji={si.emoji} size={11} />
                                <span style={{ fontSize: 8.5, fontWeight: 700, color: scrap.accent }}>{scrap.hanzi}</span>
                            </span>
                        </div>
                        <span className="label-mono" style={{ fontSize: 7.5, color: '#a79c8e', marginTop: 2 }}>street-corner journal</span>
                    </div>

                    {/* 工具贴纸：出门 / 设定 / 翻篇 */}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button onClick={() => setShowRoam(true)} title="出门逛逛"
                            className="scrap-btn-paper flex items-center justify-center"
                            style={{ width: 40, height: 40, touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}>
                            <MapTrifold size={16} weight="bold" />
                        </button>
                        <button onClick={() => setShowDate(true)} title="带 TA 去约会"
                            className="scrap-btn-paper flex items-center justify-center"
                            style={{ width: 40, height: 40, touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}>
                            <HeartHalf size={16} weight="bold" />
                        </button>
                        <button onClick={() => setShowSettings(true)} title="设定" className="scrap-btn-paper flex items-center justify-center relative"
                            style={{ width: 40, height: 40, touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}>
                            <GearSix size={16} weight="bold" />
                            <span style={{
                                position: 'absolute', right: -3, bottom: -3,
                                fontSize: 8, fontWeight: 700, color: 'white',
                                background: scrap.accent, borderRadius: 999, padding: '0 4px',
                                border: '1.5px solid #fbfaf7', minWidth: 15, textAlign: 'center',
                            }}>{participantChars.length}</span>
                        </button>
                        <button onClick={() => setShowResetDialog(true)} title="翻篇重开"
                            className="scrap-btn-paper flex items-center justify-center"
                            style={{ width: 40, height: 40, touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}>
                            <ArrowCounterClockwise size={16} weight="bold" />
                        </button>
                    </div>
                </div>

                {/* 季节 / 时辰 / 天气 小贴条 + 页码 */}
                <div className="flex items-center gap-1.5 px-3 pb-2 flex-wrap">
                    <span className="sj-chip"><TwemojiImg emoji={si.emoji} size={12} /> {si.zh}</span>
                    <span className="sj-chip"><TwemojiImg emoji={ti.emoji} size={12} /> {ti.zh}</span>
                    <span className="sj-chip"><TwemojiImg emoji={wi.emoji} size={12} /> {wi.zh}</span>
                    <span className="flex-1" />
                    <span className="label-mono" style={{ fontSize: 9, color: '#8b8996', letterSpacing: '0.12em' }}>
                        DAY {gameState.day ?? 1} · pg.{gameState.turnNumber}
                    </span>
                </div>
                <div className="lace-edge absolute left-0 right-0" style={{ bottom: -9 }} />
            </div>

            {/* ── 节日便签 ── */}
            {(todayFestival || festivalAnnounce) && (
                <div className="flex-shrink-0 mx-3 mt-3 px-3 py-1.5 relative tilt-r" style={{
                    background: scrap.tape2,
                    borderRadius: 4,
                    border: '1px dashed rgba(120,116,106,0.4)',
                    color: '#3f3a32', fontSize: 11, fontWeight: 700, textAlign: 'center',
                    fontFamily: 'var(--font-hand)',
                }}>
                    {todayFestival ? <><TwemojiImg emoji={todayFestival.emoji} size={13} /> {todayFestival.name}</> : festivalAnnounce}
                </div>
            )}

            {/* ── 地图：贴在手账里的街区照片 ── */}
            <figure className="sj-photo flex-shrink-0 mx-3 mt-3 tilt-l">
                <span className="sj-tape" style={{ top: -10, left: 24, transform: 'rotate(-5deg)', width: 64 }} />
                <span className="sj-tape" style={{ top: -10, right: 24, transform: 'rotate(4deg)', width: 64, background: scrap.tape2 }} />
                <div className="sj-photo-inner">
                    <WorldMap gameState={gameState} />
                </div>
                <figcaption className="flex items-center justify-between px-1 pt-1.5">
                    <span className="font-hand" style={{ fontSize: 14, color: '#2b2933' }}>{si.zh}日的街区</span>
                    <span className="label-mono" style={{ fontSize: 8, color: '#a79c8e' }}>year {gameState.year ?? 1}</span>
                </figcaption>
            </figure>

            {/* ── 街区热度（手绘热度条） ── */}
            <div className="flex items-center gap-2 mx-3 mt-2.5 px-1">
                <span className="font-hand" style={{ fontSize: 13, color: highTension ? '#b03a34' : '#2b2933', minWidth: 56, fontWeight: 700 }}>{chaosLabel}</span>
                <div className="flex-1 sj-heat-track">
                    <div className="sj-heat-fill" style={{
                        width: `${gameState.chaosLevel}%`,
                        background: highTension
                            ? 'repeating-linear-gradient(45deg, #d8625b, #d8625b 5px, #c44f48 5px, #c44f48 10px)'
                            : `repeating-linear-gradient(45deg, ${scrap.accent}, ${scrap.accent} 5px, ${scrap.accent}cc 5px, ${scrap.accent}cc 10px)`,
                    }} />
                </div>
                <span className="label-mono" style={{ fontSize: 9, color: '#8b8996', minWidth: 24, textAlign: 'right' }}>{gameState.chaosLevel}°</span>
            </div>

            {/* ── 回合状态便签 ── */}
            {(gameState.isProcessingCharTurn || isUserTurn) && (
                <div className="mx-3 mt-2 px-2.5 py-1 flex items-center gap-1.5" style={{
                    fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-hand)',
                    color: gameState.isProcessingCharTurn ? '#8b6bb8' : scrap.accent,
                    alignSelf: 'flex-start',
                    background: gameState.isProcessingCharTurn ? 'rgba(139,107,184,0.1)' : `${scrap.accent}1a`,
                    borderRadius: 999,
                    border: `1px dashed ${gameState.isProcessingCharTurn ? 'rgba(139,107,184,0.4)' : scrap.accent + '66'}`,
                }}>
                    {gameState.isProcessingCharTurn ? (
                        <><GearSix size={13} weight="bold" className="animate-spin" /> {processingMsg || '街坊们在琢磨…'}</>
                    ) : (
                        <><Star size={13} weight="fill" /> 轮到你落笔了</>
                    )}
                </div>
            )}

            {/* ── 出场角色贴纸条 ── */}
            {(participantChars.length > 0 || isMainPlotThinking) && (
                <div className="mx-3 mt-2 px-2 py-2 scrap-card" style={{ borderRadius: 12 }}>
                    <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                        {isMainPlotThinking && (
                            <div className="flex items-center gap-1.5 flex-shrink-0" style={{
                                padding: '4px 9px', borderRadius: 999,
                                border: '1px dashed rgba(176,116,66,0.5)',
                                background: 'rgba(176,116,66,0.12)',
                                color: '#9b6238', fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-hand)',
                            }}>
                                <span style={{ fontSize: 14 }}>🎬</span>
                                <span>主线编剧室</span>
                            </div>
                        )}

                        {participantChars.map(char => {
                            const isActive = gameState.isProcessingCharTurn && gameState.currentActorId === char.id;
                            return (
                                <div key={char.id} className="flex items-center gap-1.5 flex-shrink-0" style={{
                                    padding: '4px 9px', borderRadius: 999,
                                    border: isActive ? `1px dashed ${scrap.accent}` : '1px dashed rgba(167,162,151,0.5)',
                                    background: isActive ? `${scrap.accent}1f` : 'rgba(255,255,255,0.6)',
                                    color: isActive ? '#3f3a32' : '#8b8996',
                                    fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-hand)',
                                    transition: 'all 0.18s ease',
                                }}>
                                    <img src={char.avatar} alt={char.name} style={{
                                        width: 20, height: 20, borderRadius: 999, objectFit: 'cover',
                                        boxShadow: isActive ? `0 0 0 2px ${scrap.accent}55` : 'none',
                                    }} />
                                    <span>{char.name}</span>
                                    {isActive && <span style={{ width: 6, height: 6, borderRadius: '50%', background: scrap.accent }} />}
                                </div>
                            );
                        })}
                    </div>
                    {(activeThinkingChar || isMainPlotThinking) && (
                        <div style={{ marginTop: 5, fontSize: 11, color: '#a79c8e', fontFamily: 'var(--font-hand)' }}>
                            {isMainPlotThinking
                                ? processingMsg
                                : `${activeThinkingChar?.name || '角色'} 正在落笔，API 已开始调用`}
                        </div>
                    )}
                </div>
            )}

            {/* ── 内页：分栏笔记本 ── */}
            <div className="flex-1 flex flex-col mx-3 mt-2.5 mb-1 scrap-card overflow-hidden" style={{ minHeight: 0, minWidth: 0, borderRadius: 14 }}>
                {/* 索引页签 */}
                <div className="flex items-end gap-1 px-2 pt-2" style={{ borderBottom: '1px dashed rgba(167,162,151,0.5)' }}>
                    {TABS.map(({ id, label, Icon }) => {
                        const active = activeTab === id;
                        return (
                            <button key={id} onClick={() => setActiveTab(id as any)}
                                className="flex items-center gap-1.5 px-3 py-1.5"
                                style={{
                                    fontFamily: 'var(--font-hand)', fontSize: 14, fontWeight: 700,
                                    color: active ? '#fbfaf7' : '#8b8996',
                                    background: active ? scrap.accent : 'transparent',
                                    borderRadius: '10px 10px 0 0',
                                    border: active ? `1px solid ${scrap.accent}` : '1px solid transparent',
                                    borderBottom: 'none',
                                    marginBottom: -1,
                                    transition: 'all 0.15s',
                                }}>
                                <Icon size={13} weight="bold" /> {label}
                            </button>
                        );
                    })}
                    <span className="flex-1" />
                </div>
                <div className="flex-1 overflow-y-auto overflow-x-hidden no-scrollbar scrap-panel" style={{ minWidth: 0 }}>
                    {activeTab === 'npcs' && <NPCGrid gameState={gameState} onLongPressNpc={setEditingNpc} />}
                    {activeTab === 'drama' && <DramaFeed gameState={gameState} />}
                    {activeTab === 'relations' && <RelationsTab gameState={gameState} />}
                </div>
            </div>

            {/* ── 底部动作贴纸：搅局 / 拉人 / 吃瓜 ── */}
            {isUserTurn && (
                <div className="flex-shrink-0 grid grid-cols-3 gap-2 px-3 pb-2 pt-1"
                    style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom, 8px))' }}>
                    <button onClick={() => setActionPanel('stir')}
                        className="scrap-btn flex flex-col items-center justify-center gap-0.5 sj-action" style={{ padding: '9px 6px' }}>
                        <MaskHappy size={17} weight="bold" />
                        <span className="font-hand" style={{ fontSize: 13, fontWeight: 700 }}>搅局</span>
                    </button>
                    <button onClick={() => setActionPanel('add')}
                        className="scrap-btn flex flex-col items-center justify-center gap-0.5 sj-action" style={{ padding: '9px 6px', background: scrap.accent }}>
                        <UserPlus size={17} weight="bold" />
                        <span className="font-hand" style={{ fontSize: 13, fontWeight: 700 }}>拉人</span>
                    </button>
                    <button onClick={handleWatch}
                        className="scrap-btn-paper flex flex-col items-center justify-center gap-0.5 sj-action" style={{ padding: '9px 6px' }}>
                        <Eye size={17} weight="bold" />
                        <span className="font-hand" style={{ fontSize: 13, fontWeight: 700 }}>吃瓜</span>
                    </button>
                </div>
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
            color: #2b2933;
            --sj-accent: ${accent};
            --sj-tape: ${tape};
            --sj-tape2: ${tape2};
            background-image: radial-gradient(circle at 1px 1px, rgba(120,116,106,0.05) 1px, transparent 0);
            background-size: 16px 16px;
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
        /* 拍立得照片框 */
        .sj-app .sj-photo {
            position: relative;
            background: #fbfaf7;
            border: 1px solid rgba(236,233,226,0.95);
            border-radius: 6px;
            padding: 9px 9px 4px;
            box-shadow: 0 12px 26px -16px rgba(50,48,60,0.4);
        }
        .sj-app .sj-photo-inner {
            border-radius: 3px;
            overflow: hidden;
            border: 1px solid rgba(0,0,0,0.06);
            box-shadow: inset 0 0 0 1px rgba(255,255,255,0.4);
        }
        /* 热度条 */
        .sj-app .sj-heat-track {
            height: 10px; border-radius: 999px; overflow: hidden;
            background: rgba(120,116,106,0.1);
            border: 1px solid rgba(167,162,151,0.4);
        }
        .sj-app .sj-heat-fill {
            height: 100%; border-radius: 999px;
            transition: width 0.7s ease-out;
        }
        /* 底部动作贴纸轻微歪斜 */
        .sj-app .sj-action:nth-child(1) { rotate: -1.4deg; }
        .sj-app .sj-action:nth-child(3) { rotate: 1.4deg; }
        .sj-app .sj-action:active { transform: scale(0.96); }
    `}</style>
);

export default LifeSimApp;
