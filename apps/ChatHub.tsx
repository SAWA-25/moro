
import React, { useState, useEffect, useRef, useLayoutEffect, useMemo, useCallback } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { APIConfig, AppID, Message, GroupProfile, GroupChatRecord, GroupApiConfig, GroupConvoSettings, CharacterProfile, MessageType, ChatTheme, MemoryFragment, EmojiCategory, Emoji, OSTheme, AmbientSocialEntry, AmbientSocialContact, PresetScopeKey, LiveChatOverride, InnerVoiceEntry } from '../types';
import { extractContent } from '../utils/safeApi';
import { callChatCompletion, fetchModelList } from '../utils/llmClient';
import Modal, { ScrapBtn, ScrapInput, ScrapTextarea, ScrapLabel, ScrapNote, ScrapDivider, ScrapPickTile, ScrapChip, ScrapRowBtn, ScrapStamp, INK, INK_SOFT } from '../components/chat/ScrapModal';
import { ContextBuilder } from '../utils/context';
import { WorldbookRuntime } from '../utils/worldbookRuntime';
import { injectMemoryPalace } from '../utils/memoryPalace/pipeline';
import { processGroupNewMessages, deleteGroupMemoriesByGroupId } from '../utils/memoryPalace/groupPipeline';
import { processImage } from '../utils/file';
import { generateImage } from '../utils/imageGen';
import { ChatParser } from '../utils/chatParser';
import { useVoiceRecorder } from '../components/chat/useVoiceRecorder';
import { DEFAULT_ARCHIVE_PROMPTS } from '../components/chat/ChatConstants';
import { exportGroupChatArchive, parseGroupChatArchive, buildGroupChatFilename, serializeGroupChatJsonl } from '../utils/groupChatArchive';
import { UsersThree, ChatsTeardrop, AddressBook, Planet, HandPointing, SpeakerSlash, Crown, GearSix, Sticker, Paperclip, Coins, ImageSquare, IdentificationCard, CassetteTape, MapTrifold, PaintBrush, HandTap, PhoneOutgoing, PhoneSlash, SpeakerHigh, UserPlus, HandHeart, Detective, EnvelopeOpen, Scroll, Wind, CalendarCheck, Lightbulb, Hamburger, BookBookmark, Eraser, StopCircle, Trash, Microphone, MicrophoneSlash, Wallet, Heart, Megaphone, MagnifyingGlass, XCircle, ChartBar, ListNumbers, ShareNetwork, Copy, ClockCounterClockwise, PencilSimpleLine, MapPin, BellRinging, PushPin, FloppyDisk, NotePencil } from '@phosphor-icons/react';
import MomentsFeed from '../components/moments/MomentsFeed';
import CoupleSpace from '../components/couple/CoupleSpace';
import RelationshipNetwork from '../components/chat/RelationshipNetwork';
import ChatHubDashboard from '../components/chat/ChatHubDashboard';
import FriendVerifyModal from '../components/chat/FriendVerifyModal';
import UnblockAppealModal from '../components/chat/UnblockAppealModal';
import GroupOfflineModeModal from '../components/chat/GroupOfflineModeModal';
import EmojiImportModal from '../components/chat/EmojiImportModal';
import { hasOfflineSession } from '../utils/offlineMode';
import { hasGroupOfflineSession } from '../utils/groupOfflineMode';
import { isAutonomousLifeEnabled, sanitizeLifeText } from '../utils/autonomousLife';
import { resolveUnblockAppealDecision, type UnblockAppealDecision } from '../utils/unblockAppealActions';
import { unblockCharacterByUser, unblockCharactersByUser } from '../utils/blockActions';
import { splitRedPacket, bestLuckIndex, shuffle, yuanToCents, centsToYuan, buildGroupRedPacketMetadata, isPasswordRedPacketPhraseAccepted } from '../utils/redPacket';
import { resolveAuxApi } from '../utils/auxApi';
import { toggleReaction, REACTION_EMOJIS } from '../utils/messageReactions';
import { stripFakeWithdrawNotice } from '../utils/messageWithdraw';
import { ambientSocialToCharacter, ensureAmbientSocialState, getAmbientSocialLinkedCharacterIds, getAmbientSocialLinkedGroupIds, isAmbientSocialCharacter, isAmbientSocialGroup, patchAmbientSocialEntry } from '../utils/ambientSocial';
import { formatCharacterWithId, getCharacterModelId } from '../utils/characterIdentity';
import { FORUM_PENDING_CHAT_SHARE_KEY, normalizeForumSharePendingPayload } from '../utils/forum';
import { llmComplete } from '../utils/llmComplete';
import { scrollToManualAnchor, useManualDeepLink } from '../utils/manualDeepLink';
import { stickerImageSrc } from '../utils/stickerImage';
import { substituteMacros } from '../utils/macros';
import { makeApiUsageMeta } from '../utils/apiUsageCatalog';
import { ORDER_CHAR_ID_GROUP, PresetRuntime, applyPresetToMessages } from '../utils/presets';
import { normalizeLiveChatSettings, resolveLiveChatEnabled, shouldTriggerLiveDraft } from '../utils/liveChat';
import { groupVoiceStylePromptBlock, innerVoicePromptBody, liveGroupDraftPromptBody, liveGroupModePromptBlock } from '../utils/laiwangPrompts';
import { createMessageFollowup } from '../utils/chatFollowups';
import type { ParsedEmojiImport } from '../utils/emojiImport';

const TWEMOJI_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72';
const twemojiUrl = (codepoint: string) => `${TWEMOJI_BASE}/${codepoint}.png`;
const formatGroupCallDuration = (secs: number): string => {
    const safe = Math.max(0, Math.floor(secs || 0));
    return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
};
const formatGroupCallTime = (ts = Date.now()): string => new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
type GroupCallState = 'connecting' | 'listening' | 'thinking' | 'speaking' | 'ended' | 'error';
type GroupCallBubble = {
    id: string;
    role: 'user' | 'assistant';
    text: string;
    time: string;
    timestamp: number;
    charId?: string;
    name?: string;
    avatar?: string;
};
type GroupCallSession = {
    groupId: string;
    groupName: string;
    messageId: number;
    startedAt: number;
    sessionId: string;
    members: { id: string; name: string; avatar?: string }[];
};
type GroupDirectorMode = 'director' | 'individual';
type GroupDirectorRunOptions = {
    allowAutoContinue?: boolean;
    mode?: GroupDirectorMode;
    liveMode?: 'sent' | 'draft';
    liveDraftText?: string;
    maxAutoRounds?: number;
    remainingAutoRounds?: number;
    isAutoRound?: boolean;
    suppressMemoryPalace?: boolean;
};
type GroupApiDraft = GroupApiConfig;
type GroupApiModelTarget = { kind: 'group' } | { kind: 'member'; charId: string };
type GroupDirectorPreparedContext = {
    group: GroupProfile;
    groupMembers: CharacterProfile[];
    context: string;
    recentGroupMsgs: string;
    attachedImages: { tag: number; url: string }[];
    attachedImagesNote: string;
    emojiContextStr: string;
};
type GroupDirectorAction = { charId: string; content: string };
type GroupOpeningBubble = { charId: string; content: string };
type GroupInnerVoicePeek = { charId: string; charName: string; content: string; timestamp: number };

const GROUP_JSON_ARRAY_GUARD = `[本轮最高优先级输出守卫]
只输出 JSON Array，不要 Markdown，不要解释，不要前后缀。每个元素必须包含 "charId" 和 "content" 字段；charId 必须使用本轮花名册中的角色 ID。`;
const DEFAULT_GROUP_CONTEXT_LIMIT = 30;
const LANG_OPTIONS = ['中文', 'English', '日本語', '한국어', 'Français', 'Deutsch', 'Español'];

const splitPresetSystemContent = (content: any): { systemText: string; mediaUserContent: any | null } => {
    if (!Array.isArray(content)) return { systemText: String(content ?? ''), mediaUserContent: null };
    const textParts = content
        .filter(item => item?.type === 'text' && typeof item.text === 'string')
        .map(item => item.text)
        .filter(Boolean);
    const mediaParts = content.filter(item => !(item?.type === 'text' && typeof item.text === 'string'));
    return {
        systemText: textParts.join('\n\n'),
        mediaUserContent: mediaParts.length > 0
            ? [{ type: 'text', text: '本轮用户随消息附带了图片，请结合图片内容与上方群聊任务生成回复。' }, ...mediaParts]
            : null,
    };
};

const buildScopedGroupCompletionMessages = async (
    content: any,
    scope: PresetScopeKey,
    userName: string,
    groupName: string,
): Promise<Array<{ role: string; content: any }>> => {
    const preset = await PresetRuntime.getActivePresetForScope(scope);
    if (!preset) return [{ role: 'user', content }];
    const { systemText, mediaUserContent } = splitPresetSystemContent(content);
    const baseMessages: Array<{ role: string; content: any }> = [
        { role: 'system', content: systemText || '请根据本轮群聊任务生成回复。' },
    ];
    if (mediaUserContent) baseMessages.push({ role: 'user', content: mediaUserContent });
    return applyPresetToMessages(baseMessages, preset, {
        orderCharacterId: ORDER_CHAR_ID_GROUP,
        macros: { charName: groupName || '群聊', userName },
        tailMessages: [{ role: 'system', content: GROUP_JSON_ARRAY_GUARD }],
    });
};
const normalizeGroupOpeningGreetings = (items?: string[]): string[] => (
    (items || [])
        .map(item => String(item || '').replace(/\r\n/g, '\n').trim().slice(0, 2000))
        .filter(Boolean)
);
const parseGroupDirectorActions = (rawInput: unknown): GroupDirectorAction[] => {
    let raw = String(rawInput || '').replace(/```json/gi, '').replace(/```/g, '').trim();
    const firstBracket = raw.indexOf('[');
    const lastBracket = raw.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket !== -1) {
        raw = raw.substring(firstBracket, lastBracket + 1);
    } else {
        const firstBrace = raw.indexOf('{');
        const lastBrace = raw.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1) raw = raw.substring(firstBrace, lastBrace + 1);
    }
    try {
        const parsed = JSON.parse(raw);
        const list = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
        return list
            .map((item: any) => ({
                charId: String(item?.charId || item?.id || '').trim(),
                content: typeof item?.content === 'string' ? item.content : (typeof item?.text === 'string' ? item.text : ''),
            }))
            .filter(item => item.charId);
    } catch (e) {
        console.error('Director Parse Error', raw);
        return [];
    }
};

const emptyGroupApi = (): GroupApiDraft => ({ baseUrl: '', apiKey: '', model: '' });
const normalizeGroupApiDraft = (api?: Partial<GroupApiConfig> | null): GroupApiDraft => ({
    baseUrl: String(api?.baseUrl || ''),
    apiKey: String(api?.apiKey || ''),
    model: String(api?.model || ''),
});
const sanitizeGroupApi = (api?: Partial<GroupApiConfig> | null): GroupApiConfig | undefined => {
    const baseUrl = String(api?.baseUrl || '').trim();
    const apiKey = String(api?.apiKey || '').trim();
    const model = String(api?.model || '').trim();
    if (!baseUrl && !apiKey && !model) return undefined;
    return { baseUrl, apiKey, model };
};
const isCompleteGroupApi = (api?: Partial<GroupApiConfig> | null): api is GroupApiConfig =>
    !!api && !!String(api.baseUrl || '').trim() && !!String(api.model || '').trim();
const pruneGroupMemberApis = (
    apis: Record<string, GroupApiDraft> | undefined,
    memberIds: string[],
): Record<string, GroupApiConfig> | undefined => {
    const memberSet = new Set(memberIds);
    const next: Record<string, GroupApiConfig> = {};
    Object.entries(apis || {}).forEach(([charId, api]) => {
        if (!memberSet.has(charId)) return;
        const clean = sanitizeGroupApi(api);
        if (clean) next[charId] = clean;
    });
    return Object.keys(next).length > 0 ? next : undefined;
};
const getGroupCallStateLabel = (state: GroupCallState): string => ({
    connecting: '接线中…',
    listening: '大家在听',
    thinking: '群友在想…',
    speaking: '正在说话',
    ended: '已挂断',
    error: '连接不稳',
}[state]);
const cleanGroupCallText = (raw: string): string => (raw || '')
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .replace(/\[\[\s*HANGUP\s*\]\]/gi, '')
    .trim();
const compactGroupCallTranscript = (items: GroupCallBubble[], max = 8): string => items
    .slice(-max)
    .map(item => `${item.role === 'user' ? '我' : item.name || '群友'}: ${item.text}`)
    .join('\n');

// 复用 Chat.tsx 的高颜值样式逻辑，但针对群聊微调
const PRESET_THEME_GROUP: ChatTheme = {
    id: 'group_default', name: 'Group', type: 'preset',
    user: { textColor: '#2e2c36', backgroundColor: '#f1f1f3', borderRadius: 22, opacity: 1 },
    ai: { textColor: '#2e2c36', backgroundColor: '#ffffff', borderRadius: 22, opacity: 1 },
};

const groupBackgroundStyleFor = (
    image: string | undefined,
    style: OSTheme['groupChatBackgroundStyle'] | OSTheme['chatBackgroundStyle'] | undefined,
): React.CSSProperties => {
    if (image) {
        return {
            backgroundColor: '#f7f3ec',
            backgroundImage: `linear-gradient(rgba(250,249,246,0.78), rgba(250,249,246,0.82)), url(${image})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundAttachment: 'local',
        };
    }
    if (style === 'grid') {
        return {
            backgroundColor: '#ededed',
            backgroundImage: 'linear-gradient(rgba(255,255,255,0.46) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.46) 1px, transparent 1px)',
            backgroundSize: '20px 20px',
        };
    }
    if (style === 'paper') {
        return {
            backgroundColor: '#ededed',
            backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.78) 1px, transparent 0)',
            backgroundSize: '16px 16px',
        };
    }
    if (style === 'mesh') {
        return {
            backgroundColor: '#ededed',
            backgroundImage: 'radial-gradient(circle at 18% 18%, rgba(255,255,255,0.68), transparent 30%), radial-gradient(circle at 82% 24%, rgba(255,244,247,0.55), transparent 28%)',
        };
    }
    return { backgroundColor: '#ededed' };
};

const GROUP_SETTINGS_MONO: React.CSSProperties = { fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace' };
const CONVO_SWIPE_ACTION_WIDTH = 216;
const CONVO_HIDDEN_WINDOWS_KEY = 'moro_chathub_hidden_windows_v1';
const GROUP_CHAT_LOAD_BATCH_SIZE = 30;
const GROUP_ASSISTANT_REVEAL_FIRST_DELAY_MS = 900;
const GROUP_ASSISTANT_REVEAL_TYPING_MIN_MS = 800;
const GROUP_ASSISTANT_REVEAL_TYPING_MAX_MS = 2600;
const GROUP_ASSISTANT_REVEAL_BETWEEN_MIN_MS = 650;
const GROUP_ASSISTANT_REVEAL_BETWEEN_MAX_MS = 1800;
const GROUP_ASSISTANT_REVEAL_CHAR_MS = 32;
const GROUP_ASSISTANT_REVEAL_CHAR_MAX_MS = 2600;

type ConvoKind = 'char' | 'group' | 'ambient';
type ConvoHiddenWindows = Record<string, number>;
type GroupMemberLensDraft = Record<string, Record<string, string>>;
const MEMBER_LENS_MAX_LENGTH = 500;
type ConvoListItem = {
    kind: ConvoKind;
    id: string;
    name: string;
    avatar?: string;
    last?: Message;
    ambient?: AmbientSocialEntry;
    dissolved?: boolean;
    memberCount?: number;
    starred?: boolean;
    specialCareCount?: number;
    /** 角色「此刻」的线下自主生活状态（最近一条生活事件，足够新才显示）—— 把线下生活带到列表里 */
    lifeStatus?: { activity: string; mood?: string; eventKind?: string; surfacedAsMsg?: boolean };
};

const groupRevealRandomBetween = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1) + min);

const isGroupAssistantRevealMessage = (message: Message) => (
    message.role === 'assistant'
    && Number.isFinite(message.id)
    && message.metadata?.source !== 'group_call'
);

const groupAssistantRevealTypingMs = (msg: Message) => {
    if (msg.type === 'emoji') return groupRevealRandomBetween(900, 2200);
    if (msg.type !== 'text') return groupRevealRandomBetween(1000, 2600);
    const textLength = typeof msg.content === 'string' ? msg.content.trim().length : 0;
    return groupRevealRandomBetween(GROUP_ASSISTANT_REVEAL_TYPING_MIN_MS, GROUP_ASSISTANT_REVEAL_TYPING_MAX_MS)
        + Math.min(GROUP_ASSISTANT_REVEAL_CHAR_MAX_MS, textLength * GROUP_ASSISTANT_REVEAL_CHAR_MS);
};

const groupAssistantRevealBetweenMs = () => groupRevealRandomBetween(
    GROUP_ASSISTANT_REVEAL_BETWEEN_MIN_MS,
    GROUP_ASSISTANT_REVEAL_BETWEEN_MAX_MS,
);
type PendingUnblockAppeal = {
    charId: string;
    message: Message;
};

const LIFE_KIND_LABELS: Record<string, string> = {
    routine: '日常',
    work: '工作',
    study: '学习',
    social: '社交',
    errand: '琐事',
    rest: '休息',
    media: '刷到',
    food: '吃喝',
    travel: '路上',
    health: '身体',
    emotion: '情绪',
    relationship: '关系',
    accident: '小意外',
    other: '生活',
};

const isVisibleGroup = (group?: GroupProfile | null): group is GroupProfile => !!group && !group.dissolved;

const pruneGroupMemberLenses = (lenses: GroupProfile['memberLenses'] | undefined, memberIds: string[]): GroupMemberLensDraft => {
    const memberSet = new Set(memberIds);
    const next: GroupMemberLensDraft = {};
    if (!lenses) return next;
    Object.entries(lenses).forEach(([viewerId, targets]) => {
        if (!memberSet.has(viewerId) || !targets) return;
        Object.entries(targets).forEach(([targetId, text]) => {
            const clean = String(text || '').trim();
            if (!memberSet.has(targetId) || targetId === viewerId || !clean) return;
            if (!next[viewerId]) next[viewerId] = {};
            next[viewerId][targetId] = clean;
        });
    });
    return next;
};

const groupMemberLensCount = (lenses: GroupProfile['memberLenses'] | undefined, memberIds: string[]): number =>
    Object.values(pruneGroupMemberLenses(lenses, memberIds)).reduce((sum, targets) => sum + Object.keys(targets).length, 0);

const cleanGeneratedMemberLens = (value: unknown): string => String(value || '')
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MEMBER_LENS_MAX_LENGTH);

const parseGeneratedMemberLensMap = (raw: string, targetIds: string[]): Record<string, string> => {
    const targetSet = new Set(targetIds);
    const out: Record<string, string> = {};
    const cleaned = String(raw || '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
    const jsonText = (() => {
        const objStart = cleaned.indexOf('{');
        const objEnd = cleaned.lastIndexOf('}');
        if (objStart >= 0 && objEnd > objStart) return cleaned.slice(objStart, objEnd + 1);
        const arrStart = cleaned.indexOf('[');
        const arrEnd = cleaned.lastIndexOf(']');
        if (arrStart >= 0 && arrEnd > arrStart) return cleaned.slice(arrStart, arrEnd + 1);
        return cleaned;
    })();

    try {
        const parsed = JSON.parse(jsonText);
        const source = parsed?.relations || parsed?.lenses || parsed?.items || parsed;
        if (Array.isArray(source)) {
            source.forEach((item: any) => {
                const id = String(item?.targetId || item?.charId || item?.id || '').trim();
                if (!targetSet.has(id)) return;
                const text = cleanGeneratedMemberLens(item?.text ?? item?.relation ?? item?.summary ?? item?.note);
                if (text) out[id] = text;
            });
        } else if (source && typeof source === 'object') {
            targetIds.forEach(id => {
                const value = source[id];
                const text = typeof value === 'string'
                    ? cleanGeneratedMemberLens(value)
                    : cleanGeneratedMemberLens(value?.text ?? value?.relation ?? value?.summary ?? value?.note);
                if (text) out[id] = text;
            });
        }
    } catch {
        if (targetIds.length === 1) {
            const text = cleanGeneratedMemberLens(cleaned);
            if (text) out[targetIds[0]] = text;
        }
    }
    return out;
};

const buildGroupMemberLensBlock = (
    group: GroupProfile,
    viewer: CharacterProfile,
    members: CharacterProfile[],
    displayName: (charId: string) => string,
): string => {
    const targets = group.memberLenses?.[viewer.id];
    if (!targets) return '';
    const lines = members
        .filter(target => target.id !== viewer.id)
        .map(target => {
            const text = targets[target.id]?.trim();
            if (!text) return '';
            return `- ${displayName(viewer.id)} 眼里的 ${displayName(target.id)}（${formatCharacterWithId(target)}）: ${text}`;
        })
        .filter(Boolean);
    if (!lines.length) return '';
    return `[角色之间的关系 - 只供 ${displayName(viewer.id)} 自己参考]\n${lines.join('\n')}\n这些是“在你眼里别人是谁、彼此什么关系、有没有过节”的私密视角。只影响你的发言，不是群公告，也不是所有人都知道的事实；请用它调整称呼、熟稔度、避让、调侃或旧账感，不要照抄成设定说明。\n`;
};

const resolveGroupMemberStorageId = (
    group: Pick<GroupProfile, 'members'>,
    members: CharacterProfile[],
    rawId: unknown,
): string | undefined => {
    const id = String(rawId || '').trim();
    if (!id) return undefined;
    if (group.members.includes(id)) return id;
    const byModelId = members.find(member => getCharacterModelId(member) === id);
    return byModelId && group.members.includes(byModelId.id) ? byModelId.id : undefined;
};

const readLegacyGroupContextLimit = (): number => {
    try {
        const parsed = parseInt(localStorage.getItem('groupchat_context_limit') || '', 10);
        return Number.isFinite(parsed) ? Math.max(20, Math.min(5000, parsed)) : DEFAULT_GROUP_CONTEXT_LIMIT;
    } catch {
        return DEFAULT_GROUP_CONTEXT_LIMIT;
    }
};

const resolveGroupLiveOverride = (group?: GroupProfile | null): LiveChatOverride => (
    group?.convoSettings?.liveChatOverride || group?.liveChatOverride || 'inherit'
);

const normalizeGroupConvoPatch = (patch: Partial<GroupConvoSettings>): Partial<GroupConvoSettings> => {
    const next: Partial<GroupConvoSettings> = { ...patch };
    if (next.bubbleStyleMode === 'freeform') next.bubbleStyleMode = 'split';
    if (typeof next.contextLimit === 'number') next.contextLimit = Math.max(20, Math.min(5000, Math.round(next.contextLimit)));
    (['translateSourceLang', 'translateTargetLang', 'translateStyle', 'headerDecorText', 'footerDecorText', 'inputPlaceholderText'] as const).forEach(key => {
        if (typeof next[key] === 'string') {
            const trimmed = next[key]?.trim();
            next[key] = trimmed || undefined;
        }
    });
    if (next.liveChatOverride === 'inherit') next.liveChatOverride = undefined;
    if (Array.isArray(next.allowedEmojiCategoryIds)) next.allowedEmojiCategoryIds = [...new Set(next.allowedEmojiCategoryIds)].filter(Boolean);
    if (Array.isArray(next.mountedWorldbookIds)) next.mountedWorldbookIds = [...new Set(next.mountedWorldbookIds)].filter(Boolean);
    return next;
};

const resolveGroupConvo = (group?: GroupProfile | null): GroupConvoSettings => {
    const raw = group?.convoSettings || {};
    const bubbleStyleMode = raw.bubbleStyleMode === 'whole' ? 'whole' : 'split';
    return {
        bubbleStyleMode,
        personaDrivenMessageLength: !!raw.personaDrivenMessageLength || raw.bubbleStyleMode === 'freeform',
        liveChatOverride: resolveGroupLiveOverride(group),
        autoReplyEachUserMessage: !!raw.autoReplyEachUserMessage,
        narrationMode: !!raw.narrationMode,
        innerVoiceEnabled: raw.innerVoiceEnabled !== false,
        translationEnabled: !!raw.translationEnabled,
        translateSourceLang: raw.translateSourceLang || '中文',
        translateTargetLang: raw.translateTargetLang || 'English',
        translateStyle: raw.translateStyle,
        emojiAssociation: !!raw.emojiAssociation,
        allowedEmojiCategoryIds: Array.isArray(raw.allowedEmojiCategoryIds) ? raw.allowedEmojiCategoryIds.filter(Boolean) : undefined,
        headerDecorText: raw.headerDecorText,
        footerDecorText: raw.footerDecorText,
        inputPlaceholderText: raw.inputPlaceholderText,
        hideTimestamp: !!raw.hideTimestamp,
        contextLimit: raw.contextLimit || readLegacyGroupContextLimit(),
        mountedWorldbookIds: Array.isArray(raw.mountedWorldbookIds) ? raw.mountedWorldbookIds.filter(Boolean) : undefined,
    };
};

const resolveGroupContextLimit = (group?: GroupProfile | null, fallback = DEFAULT_GROUP_CONTEXT_LIMIT): number => {
    const limit = group?.convoSettings?.contextLimit ?? fallback;
    return Math.max(20, Math.min(5000, Math.round(limit || DEFAULT_GROUP_CONTEXT_LIMIT)));
};

const loadHiddenConvoWindows = (): ConvoHiddenWindows => {
    try {
        const raw = localStorage.getItem(CONVO_HIDDEN_WINDOWS_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
};

const saveHiddenConvoWindows = (value: ConvoHiddenWindows) => {
    try { localStorage.setItem(CONVO_HIDDEN_WINDOWS_KEY, JSON.stringify(value)); } catch { /* ignore */ }
};

const GroupSettingsPage: React.FC<{ no: string; title: string; en: string; children: React.ReactNode }> = ({ no, title, en, children }) => (
    <section
        className="relative rounded-[18px] bg-white"
        style={{
            border: '1px solid #ededed',
            boxShadow: '0 1px 2px rgba(38,38,38,0.04), 0 14px 30px -24px rgba(38,38,38,0.22)',
        }}
    >
        <div className="flex items-center justify-between gap-2 px-4 pt-3.5 pb-1">
            <div className="flex items-baseline gap-2 min-w-0">
                <span className="text-[9px] tracking-[0.22em] shrink-0" style={{ ...GROUP_SETTINGS_MONO, color: '#b07a8d' }}>P.{no}</span>
                <span className="text-[15px] font-bold leading-tight truncate" style={{ color: INK }}>{title}</span>
            </div>
            <span className="text-[8.5px] tracking-[0.22em] uppercase select-none shrink-0" style={{ ...GROUP_SETTINGS_MONO, color: INK_SOFT }}>{en}</span>
        </div>
        <div className="px-4 pb-5 pt-1">{children}</div>
    </section>
);

const GroupConvoEntry: React.FC<{ title: string; note?: React.ReactNode; side?: React.ReactNode; children?: React.ReactNode }> = ({ title, note, side, children }) => (
    <div className="py-4 border-b last:border-b-0" style={{ borderColor: '#f0ece4' }}>
        <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
                <div className="text-[13px] font-black text-slate-800">{title}</div>
                {note && <div className="mt-1 text-[11px] text-slate-500 leading-relaxed">{note}</div>}
            </div>
            {side && <div className="shrink-0">{side}</div>}
        </div>
        {children && <div className="mt-3">{children}</div>}
    </div>
);

const GroupConvoToggle: React.FC<{ on: boolean; onToggle: () => void }> = ({ on, onToggle }) => (
    <button
        type="button"
        onClick={onToggle}
        className={`w-12 h-7 rounded-full p-1 flex items-center transition ${on ? 'bg-[#d8a5b7]' : 'bg-[#e7e2d8]'}`}
    >
        <span className={`w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${on ? 'translate-x-5' : ''}`} />
    </button>
);

const SwipeConvoRow: React.FC<{
    swipeKey: string;
    openKey: string | null;
    setOpenKey: (key: string | null) => void;
    className?: string;
    style?: React.CSSProperties;
    onOpen: () => void;
    actions: Array<{ label: string; tone: 'danger' | 'pin' | 'muted'; onClick: () => void | Promise<void> }>;
    children: React.ReactNode;
}> = ({ swipeKey, openKey, setOpenKey, className = '', style, onOpen, actions, children }) => {
    const isOpen = openKey === swipeKey;
    const [dragX, setDragX] = useState(0);
    const startRef = useRef({ x: 0, y: 0 });
    const draggingRef = useRef(false);
    const swipedRef = useRef(false);

    const close = () => {
        setDragX(0);
        if (isOpen) setOpenKey(null);
    };

    const visibleX = draggingRef.current ? dragX : (isOpen ? -CONVO_SWIPE_ACTION_WIDTH : 0);
    const actionsVisible = isOpen || visibleX < -0.5;

    const handlePointerDown = (e: React.PointerEvent) => {
        if (e.button !== 0) return;
        startRef.current = { x: e.clientX, y: e.clientY };
        draggingRef.current = true;
        swipedRef.current = false;
        if (openKey && openKey !== swipeKey) setOpenKey(null);
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!draggingRef.current) return;
        const dx = e.clientX - startRef.current.x;
        const dy = e.clientY - startRef.current.y;
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        if (Math.abs(dy) > Math.abs(dx) * 1.2) return;
        swipedRef.current = true;
        const base = isOpen ? -CONVO_SWIPE_ACTION_WIDTH : 0;
        const next = Math.max(-CONVO_SWIPE_ACTION_WIDTH, Math.min(0, base + dx));
        setDragX(next);
    };

    const finishDrag = () => {
        if (!draggingRef.current) return;
        draggingRef.current = false;
        if (swipedRef.current) {
            setOpenKey(dragX < -54 ? swipeKey : null);
        }
        setDragX(0);
        window.setTimeout(() => { swipedRef.current = false; }, 0);
    };

    const handleClick = (e: React.MouseEvent) => {
        if (swipedRef.current) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        if (isOpen) {
            e.preventDefault();
            e.stopPropagation();
            close();
            return;
        }
        onOpen();
    };

    const toneStyle = (tone: 'danger' | 'pin' | 'muted'): React.CSSProperties => {
        if (tone === 'danger') return { background: '#ff6b81', color: '#fff' };
        if (tone === 'pin') return { background: '#d8a5b7', color: '#fff' };
        return { background: '#8aa1b4', color: '#fff' };
    };

    return (
        <div className="relative overflow-hidden rounded-2xl anim-row-in" style={{ ...style, touchAction: 'pan-y' }}>
            <div
                className="absolute inset-y-0 right-0 flex overflow-hidden rounded-2xl"
                style={{
                    opacity: actionsVisible ? 1 : 0,
                    pointerEvents: actionsVisible ? 'auto' : 'none',
                    transition: draggingRef.current ? 'none' : 'opacity 120ms ease',
                }}
            >
                {actions.map(action => (
                    <button
                        key={action.label}
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            void Promise.resolve(action.onClick()).finally(() => setOpenKey(null));
                        }}
                        className="w-[72px] h-full text-[12px] font-black active:brightness-95 transition"
                        style={toneStyle(action.tone)}
                    >
                        {action.label}
                    </button>
                ))}
            </div>
            <div
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={finishDrag}
                onPointerCancel={finishDrag}
                onClick={handleClick}
                className={className}
                style={{
                    transform: `translateX(${visibleX}px)`,
                    transition: draggingRef.current ? 'none' : 'transform 180ms ease',
                    willChange: 'transform',
                }}
            >
                {children}
            </div>
        </div>
    );
};

// --- Sub-Component: Group Message Bubble ---
const GroupMessageItem = React.memo(({
    msg,
    isUser,
    isFirstInGroup,
    isLastInGroup,
    char,
    userAvatar,
    userName,
    onImageClick,
    selectionMode,
    isSelected,
    onToggleSelect,
    onLongPress,
    onReeditRecalled,
    onReactToggle,
    displayName,
    memberTitle,
    onAvatarClick,
    onAvatarPoke,
    onShowNicknameThought,
    mentionNames,
    onCollectClick,
    onRedPacketOpen,
    onPollVote,
    onPollClick,
    onRelayClick,
    onCheckinClick,
    specialCare,
    groupMembers = [],
    hideTimestamp = false,
    translationEnabled = false,
}: {
    msg: Message,
    isUser: boolean,
    isFirstInGroup: boolean,
    isLastInGroup: boolean,
    char?: CharacterProfile,
    userAvatar: string,
    userName?: string,
    onImageClick: (url: string) => void,
    selectionMode: boolean,
    isSelected: boolean,
    onToggleSelect: (id: number) => void,
    onLongPress: (id: number) => void,
    /** 撤回的自己消息点「重新编辑」：把原文还原回输入框 */
    onReeditRecalled?: (m: Message) => void,
    /** 点表情回应小药丸：切换自己（'user'）对该表情的回应 */
    onReactToggle?: (m: Message, emoji: string) => void,
    /** 群名片（成员在本群的昵称），不传则用角色名 */
    displayName?: string,
    /** 群主/管理员设置的头衔徽章 */
    memberTitle?: string,
    /** 单击成员头像：打开成员资料/角色设置 */
    onAvatarClick?: () => void,
    /** 双击成员头像：戳一戳 */
    onAvatarPoke?: () => void,
    /** 点带「改名小心思」的系统提示：弹出查看角色改群名片的动机 */
    onShowNicknameThought?: (msg: Message) => void,
    /** 本群所有可被 @ 的显示名，用于把 @名字 在气泡里描蓝 */
    mentionNames?: string[],
    /** 点群收款卡：打开收款详情（收款方视角，逐笔点收） */
    onCollectClick?: (msg: Message) => void,
    /** 点口令红包卡：输入口令后打开 */
    onRedPacketOpen?: (msg: Message) => void,
    /** 群投票：用户点某选项投票（单选） */
    onPollVote?: (msg: Message, optionIdx: number) => void,
    /** 群投票：点卡片头部打开票数详情 */
    onPollClick?: (msg: Message) => void,
    /** 群接龙：点卡片打开接龙详情/加入 */
    onRelayClick?: (msg: Message) => void,
    /** 群签到：点卡片打开签到详情 */
    onCheckinClick?: (msg: Message) => void,
    /** 本成员是本群特别关心对象时，在消息上做轻量提醒。 */
    specialCare?: boolean
    groupMembers?: CharacterProfile[]
    hideTimestamp?: boolean
    translationEnabled?: boolean
}) => {
    const avatar = isUser ? userAvatar : char?.avatar;
    const name = isUser ? (userName || '我') : displayName || char?.name || '未知成员';
    const styleConfig = isUser ? PRESET_THEME_GROUP.user : PRESET_THEME_GROUP.ai;
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const startPos = useRef({ x: 0, y: 0 });
    const [forumDetailOpen, setForumDetailOpen] = useState(false);
    const [showTranslated, setShowTranslated] = useState(false);
    const translationMatch = translationEnabled && typeof msg.content === 'string'
        ? String(msg.content).match(/^([\s\S]*?)\n\s*(?:\[译文\]|\[Translation\]|译文[:：]|Translation[:：])\s*([\s\S]+)$/i)
        : null;
    const displayContent = translationMatch
        ? (showTranslated ? translationMatch[2].trim() : translationMatch[1].trim())
        : msg.content;
    // 头像单击/双击区分：260ms 内第二次点击 = 戳一戳
    const avatarClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const handleAvatarClick = (e: React.MouseEvent) => {
        if (selectionMode || isUser || (!onAvatarClick && !onAvatarPoke)) return;
        e.stopPropagation();
        if (avatarClickTimer.current) {
            clearTimeout(avatarClickTimer.current);
            avatarClickTimer.current = null;
            onAvatarPoke?.();
            return;
        }
        avatarClickTimer.current = setTimeout(() => {
            avatarClickTimer.current = null;
            onAvatarClick?.();
        }, 260);
    };

    // 系统通知（改群名/禁言/头衔/移除成员等）：居中灰色胶囊
    if (msg.role === 'system' || msg.type === 'system') {
        // 角色改群名片若带了「小心思」，胶囊变成可点击，点开看动机
        const nickThought = (msg.metadata as any)?.nicknameThought as string | undefined;
        const revealable = !!nickThought && !selectionMode;
        return (
            <div className="flex justify-center my-3 animate-fade-in" onClick={() => {
                if (selectionMode) { onToggleSelect(msg.id); return; }
                if (nickThought) onShowNicknameThought?.(msg);
            }}>
                <span className={`px-3 py-1 rounded-full bg-slate-200/70 text-slate-500 text-[10px] text-center leading-relaxed max-w-[85%] ${revealable ? 'cursor-pointer hover:bg-slate-300/70 active:scale-95 transition' : ''} ${selectionMode && isSelected ? 'ring-2 ring-slate-400' : ''}`}>
                    {msg.content}{nickThought ? ' 💭' : ''}
                </span>
            </div>
        );
    }

    if (msg.metadata?.groupNarration) {
        return (
            <div className="flex justify-center my-3 animate-fade-in" onClick={() => { if (selectionMode) onToggleSelect(msg.id); }}>
                <span className={`px-3.5 py-2 rounded-2xl bg-white/72 border border-slate-200/70 text-slate-500 text-[12px] leading-relaxed text-center italic max-w-[82%] shadow-sm ${selectionMode && isSelected ? 'ring-2 ring-slate-400' : ''}`}>
                    {displayContent}
                </span>
            </div>
        );
    }

    // 撤回的消息（QQ/微信语义）：居中灰色提示，原文不再显示；自己的可「重新编辑」。
    if (msg.metadata?.recalled) {
        const canReedit = isUser && !!(msg.metadata as any)?.recalledContent && !!onReeditRecalled;
        return (
            <div className="flex justify-center my-3 animate-fade-in" onClick={() => { if (selectionMode) onToggleSelect(msg.id); }}>
                <span className={`flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-200/70 text-slate-400 text-[10px] text-center leading-relaxed max-w-[85%] ${selectionMode && isSelected ? 'ring-2 ring-slate-400' : ''}`}>
                    {isUser ? '你' : (displayName || char?.name || '某成员')}撤回了一条消息
                    {canReedit && <button onClick={() => onReeditRecalled!(msg)} className="text-primary font-semibold active:opacity-60">重新编辑</button>}
                </span>
            </div>
        );
    }

    // 戳一戳互动：居中小字 + 手指
    if (msg.type === 'interaction') {
        return (
            <div className="flex justify-center my-2 animate-fade-in" onClick={() => { if (selectionMode) onToggleSelect(msg.id); }}>
                <span className={`flex items-center gap-1 px-3 py-1 rounded-full bg-sky-50 border border-sky-100 text-sky-500 text-[10px] ${selectionMode && isSelected ? 'ring-2 ring-slate-400' : ''}`}>
                    <img src={twemojiUrl('1f449')} alt="poke" className="w-3.5 h-3.5" />
                    {isUser ? `我${msg.content.replace(/^\[|\]$/g, '')}` : msg.content.replace(/^\[|\]$/g, '')}{msg.metadata?.patSuffix ? `的${msg.metadata.patSuffix}` : ''}
                </span>
            </div>
        );
    }
    
    // Time formatting
    const timeStr = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const handleTouchStart = (e: React.TouchEvent | React.MouseEvent) => {
        if ('touches' in e) {
            startPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        } else {
            startPos.current = { x: e.clientX, y: e.clientY };
        }

        longPressTimer.current = setTimeout(() => {
            if (!selectionMode) onLongPress(msg.id);
        }, 500);
    };

    const handleTouchEnd = () => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    };

    const handleMove = (e: React.TouchEvent | React.MouseEvent) => {
        if (!longPressTimer.current) return;

        let clientX, clientY;
        if ('touches' in e) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = e.clientX;
            clientY = e.clientY;
        }

        const diffX = Math.abs(clientX - startPos.current.x);
        const diffY = Math.abs(clientY - startPos.current.y);

        if (diffX > 10 || diffY > 10) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    };

    const handleClick = (e: React.MouseEvent) => {
        if (selectionMode) {
            e.stopPropagation();
            onToggleSelect(msg.id);
        }
    };

    // 把文本里的 @名字 描成蓝色（QQ 式）。名字按长度降序匹配，避免「@小明」被「@小」截断。
    const renderTextWithMentions = (text: string): React.ReactNode => {
        if (!mentionNames || mentionNames.length === 0 || !text.includes('@')) return text;
        const names = [...mentionNames].filter(Boolean).sort((a, b) => b.length - a.length);
        const escaped = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        const re = new RegExp(`@(?:${escaped.join('|')})`, 'g');
        const parts: React.ReactNode[] = [];
        let last = 0;
        let m: RegExpExecArray | null;
        const mentionClass = isUser ? 'text-sky-300 font-medium' : 'text-sky-500 font-medium';
        while ((m = re.exec(text)) !== null) {
            if (m.index > last) parts.push(text.slice(last, m.index));
            parts.push(<span key={m.index} className={mentionClass}>{m[0]}</span>);
            last = m.index + m[0].length;
        }
        if (last === 0) return text;
        if (last < text.length) parts.push(text.slice(last));
        return parts;
    };
    // Special Content Renderers
    const renderContent = () => {
        switch (msg.type) {
            case 'call_log': {
                const meta = (msg.metadata as any) || {};
                const outcome = meta.callOutcome as string | undefined;
                const isMissedLike = outcome === 'declined' || outcome === 'missed' || outcome === 'cancelled';
                const isGroupCall = meta.kind === 'group_call';
                const memberIds: string[] = Array.isArray(meta.memberIds) ? meta.memberIds : [];
                const memberNames: string[] = Array.isArray(meta.memberNames) ? meta.memberNames : [];
                const memberAvatars: string[] = Array.isArray(meta.memberAvatars) ? meta.memberAvatars : [];
                const participants = memberIds.length
                    ? memberIds.map((id, idx) => {
                        const found = groupMembers.find(item => item.id === id);
                        return {
                            id,
                            name: memberNames[idx] || found?.name || '群友',
                            avatar: memberAvatars[idx] || found?.avatar,
                        };
                    })
                    : groupMembers.map(item => ({ id: item.id, name: item.name, avatar: item.avatar }));
                const count = Math.max(participants.length, Number(meta.memberCount || 0), isGroupCall ? 2 : 1);
                const shown = participants.slice(0, 3);
                const label = isGroupCall
                    ? (isMissedLike ? '群聊电话未接通' : '发起了群聊电话')
                    : (msg.content || '语音通话');
                const subLabel = isGroupCall
                    ? `${meta.groupName || '群聊'} · ${count} 人语音通话${meta.durationSec ? ` · ${formatGroupCallDuration(Number(meta.durationSec))}` : ''}`
                    : '语音通话';
                return (
                    <div className={`min-w-[220px] max-w-[280px] flex items-center gap-2 px-4 py-2.5 rounded-2xl shadow-sm border select-none ${isMissedLike ? 'bg-white border-red-100' : 'bg-white border-slate-100'}`}>
                        <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full shrink-0 ${isMissedLike ? 'bg-red-50 text-red-400' : 'bg-emerald-50 text-emerald-500'}`}>
                            <PhoneOutgoing size={15} weight="fill" />
                        </span>
                        <div className="min-w-0 flex-1">
                            <div className={`text-sm font-medium truncate ${isMissedLike ? 'text-red-500' : 'text-slate-700'}`}>{label}</div>
                            <div className="text-[10px] text-slate-400 truncate">{subLabel}</div>
                        </div>
                        {isGroupCall && (
                            <div className="flex items-center shrink-0">
                                <div className="flex -space-x-2">
                                    {shown.map((p, idx) => (
                                        p.avatar ? (
                                            <img key={p.id || idx} src={p.avatar} alt="" className="w-6 h-6 rounded-full object-cover border-2 border-white bg-slate-100" loading="lazy" />
                                        ) : (
                                            <span key={p.id || idx} className="w-6 h-6 rounded-full border-2 border-white bg-slate-100 text-[9px] text-slate-400 font-bold flex items-center justify-center">
                                                {p.name.slice(0, 1)}
                                            </span>
                                        )
                                    ))}
                                </div>
                                {count > shown.length && (
                                    <span className="ml-1 text-[10px] font-bold text-slate-400">+{count - shown.length}</span>
                                )}
                            </div>
                        )}
                    </div>
                );
            }
            case 'image':
                return (
                    <div className="relative group cursor-pointer" onClick={(e) => {
                        if (selectionMode) handleClick(e);
                        else onImageClick(msg.content);
                    }}>
                        <img src={msg.content} className="max-w-[200px] max-h-[200px] rounded-xl shadow-sm border border-black/5" loading="lazy" />
                    </div>
                );
            case 'emoji':
                return <img src={stickerImageSrc(msg.content)} className="w-24 h-24 object-contain drop-shadow-sm hover:scale-110 transition-transform" />;
            case 'transfer': {
                const tmeta = (msg.metadata as any) || {};
                // 群收款卡（AA）：收款方视角，展示进度，点开逐笔点收
                if (tmeta.kind === 'collect') {
                    const shares: any[] = Array.isArray(tmeta.shares) ? tmeta.shares : [];
                    const paidCount = shares.filter(s => s.paid).length;
                    const paidSum = Math.round(shares.filter(s => s.paid).reduce((a, s) => a + (s.amount || 0), 0) * 100) / 100;
                    const done = shares.length > 0 && paidCount === shares.length;
                    return (
                        <button
                            onClick={() => { if (!selectionMode) onCollectClick?.(msg); }}
                            className="w-60 text-left p-3 rounded-[14px] flex items-center gap-3 relative overflow-hidden active:scale-95 transition-transform"
                            style={{ background: done ? 'linear-gradient(180deg,#fffdfa,#f8f4f6)' : 'linear-gradient(180deg,#fffdfa,#fff4f7)', color: '#5a3140', border: '1px solid #eed6df', boxShadow: '0 12px 24px -18px rgba(122,90,114,0.38)' }}
                        >
                            <div className="p-2 rounded-full shrink-0" style={{ background: '#fff4f7', color: '#5a3140', border: '1px solid #eed6df' }}><Wallet size={24} weight="fill" /></div>
                            <div className="z-10 min-w-0">
                                <div className="font-bold text-sm tracking-wide truncate">{tmeta.note || '群收款 · AA'}</div>
                                <div className="text-[10px]" style={{ color: '#8a6478' }}>{done ? `已收齐 ¥${tmeta.total}` : `已收 ¥${paidSum} / ¥${tmeta.total} · ${paidCount}/${shares.length} 人`}</div>
                                <div className="text-[9px] mt-0.5" style={{ color: '#a892a3' }}>{done ? 'Moro Pay · 收款单' : '点开收款 · Moro Pay'}</div>
                            </div>
                        </button>
                    );
                }
                if (tmeta.kind === 'redpacket') {
                    const isLucky = tmeta.rpType === 'lucky';
                    const isPassword = tmeta.rpType === 'password';
                    const passwordPhrase = isPassword && typeof tmeta.password === 'string' ? tmeta.password.trim() : '';
                    const opened = tmeta.status === 'opened' || tmeta.status === 'claimed' || tmeta.status === 'finished';
                    const canOpen = isPassword && !opened && !selectionMode && !!onRedPacketOpen;
                    const note = typeof tmeta.note === 'string' && tmeta.note.trim()
                        ? tmeta.note.trim()
                        : isLucky
                            ? '拼手气红包，看谁手气最好'
                            : isPassword
                                ? '输入口令拆开红包'
                                : '恭喜发财，大吉大利';
                    const title = isLucky ? '拼手气红包' : isPassword ? '口令红包' : '红包';
                    const sub = isLucky
                        ? `共 ${tmeta.count ?? (Array.isArray(tmeta.grabs) ? tmeta.grabs.length : 0)} 份`
                        : isPassword
                            ? (opened ? '口令正确 · 已打开' : '输入口令才能打开')
                            : 'Moro Pay · 红包';
                    const grabs: any[] = Array.isArray(tmeta.grabs) ? tmeta.grabs : [];
                    return (
                        <div
                            onClick={() => { if (canOpen) onRedPacketOpen?.(msg); }}
                            className={`w-64 rounded-[18px] p-4 relative overflow-hidden transition-transform ${canOpen ? 'cursor-pointer active:scale-[0.98]' : ''}`}
                            style={{ background: 'linear-gradient(180deg,#fffdfa,#fff4f7)', color: '#5a3140', border: '1px solid #eed6df', boxShadow: '0 16px 30px -20px rgba(122,90,114,0.38)' }}
                        >
                            <div className="relative flex items-center gap-2 mb-3">
                                <span className="w-8 h-8 rounded-[9px] flex items-center justify-center shrink-0 text-[15px] font-black" style={{ background: '#fff4f7', color: '#5a3140', border: '1px solid #eed6df' }}>
                                    {isLucky ? '拼' : isPassword ? '令' : '包'}
                                </span>
                                <div className="leading-tight min-w-0">
                                    <div className="text-[10px] font-mono font-bold tracking-[0.22em] uppercase truncate" style={{ color: '#a892a3' }}>Red&nbsp;Packet</div>
                                    <div className="text-[10px] truncate" style={{ color: '#a892a3' }}>{title}</div>
                                </div>
                            </div>
                            <div className="relative">
                                <div className="text-[12.5px] mb-1.5 truncate italic" style={{ opacity: 0.82 }}>「{note}」</div>
                                {isPassword && passwordPhrase && (
                                    <div className="mb-2 inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-1 text-[10.5px] font-bold" style={{ background: '#fffdfa', color: '#5a3140', border: '1px solid #eed6df' }}>
                                        <span className="shrink-0" style={{ color: '#a892a3' }}>口令</span>
                                        <span className="min-w-0 truncate">{passwordPhrase}</span>
                                    </div>
                                )}
                                <div className="flex items-end gap-1">
                                    <span className="text-[15px] font-bold pb-1" style={{ opacity: 0.65 }}>{isLucky ? '共 ¥' : '¥'}</span>
                                    <span className="text-[30px] font-black leading-none tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>{tmeta.amount}</span>
                                </div>
                                {isLucky && grabs.length > 0 && (
                                    <div className="mt-2.5 pt-2 space-y-1 max-h-[92px] overflow-y-auto no-scrollbar" style={{ borderTop: '1px solid #eed6df' }}>
                                        {grabs.slice(0, 4).map((g, i) => (
                                            <div key={i} className="flex items-center justify-between text-[11px]">
                                                <span className="truncate" style={{ color: '#5a3140' }}>{g.id === tmeta.bestId ? '手气最佳 · ' : ''}{g.name}</span>
                                                <span className="font-bold tabular-nums" style={{ color: '#5a3140' }}>¥{g.amount}</span>
                                            </div>
                                        ))}
                                        {grabs.length > 4 && <div className="text-[10px]" style={{ color: '#a892a3' }}>还有 {grabs.length - 4} 人已领取</div>}
                                    </div>
                                )}
                                <div className="mt-2.5 pt-2 flex items-center justify-between" style={{ borderTop: '1px solid #eed6df' }}>
                                    <span className={`text-[10px] ${canOpen ? 'font-bold' : ''}`} style={{ color: canOpen ? '#5a3140' : '#a892a3' }}>{sub}</span>
                                    <span aria-hidden className="w-4 h-4 rounded-full flex items-center justify-center text-[8px]" style={{ background: '#d8a5b7', color: '#fffdfa' }}>¥</span>
                                </div>
                            </div>
                        </div>
                    );
                }
                return (
                    <div className="w-60 p-3 rounded-[14px] flex items-center gap-3 relative overflow-hidden active:scale-95 transition-transform" style={{ background: 'linear-gradient(180deg,#fffdfa,#fff4f7)', color: '#5a3140', border: '1px solid #eed6df', boxShadow: '0 12px 24px -18px rgba(122,90,114,0.38)' }}>
                        <div className="absolute -right-2 -top-2" style={{ color: 'rgba(216,165,183,0.22)' }}><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-16 h-16"><path d="M10.464 8.746c.227-.18.497-.311.786-.394v2.795a2.252 2.252 0 0 1-.786-.393c-.394-.313-.546-.681-.546-1.004 0-.324.152-.691.546-1.004ZM12.75 15.662v-2.824c.347.085.664.228.921.421.427.32.579.686.579.991 0 .305-.152.671-.579.991a2.534 2.534 0 0 1-.921.42Z" /><path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25ZM12.75 6a.75.75 0 0 0-1.5 0v.816a3.836 3.836 0 0 0-1.72.756c-.712.566-1.112 1.35-1.112 2.178 0 .829.4 1.612 1.113 2.178.502.4 1.102.647 1.719.756v2.978a2.536 2.536 0 0 1-.921-.421l-.879-.66a.75.75 0 0 0-.9 1.2l.879.66c.533.4 1.169.645 1.821.75V18a.75.75 0 0 0 1.5 0v-.81a4.124 4.124 0 0 0 1.821-.749c.745-.559 1.179-1.344 1.179-2.191 0-.847-.434-1.632-1.179-2.191a4.122 4.122 0 0 0-1.821-.75V8.354c.29.082.559.213.786.393l.415.33a.75.75 0 0 0 .933-1.175l-.415-.33a3.836 3.836 0 0 0-1.719-.755V6Z" clipRule="evenodd" /><path d="M2.25 18a.75.75 0 0 0 0 1.5c5.4 0 10.63.722 15.6 2.075 1.19.324 2.4-.558 2.4-1.82V18.75a.75.75 0 0 0-.75-.75H2.25Z" /></svg></div>
                        <div className="p-2 rounded-full shrink-0" style={{ background: '#fff4f7', color: '#5a3140', border: '1px solid #eed6df' }}><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path d="M12 7.5a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5Z" /><path fillRule="evenodd" d="M1.5 4.875C1.5 3.839 2.34 3 3.375 3h17.25c1.035 0 1.875.84 1.875 1.875v9.75c0 1.036-.84 1.875-1.875 1.875H3.375A1.875 1.875 0 0 1 1.5 14.625v-9.75ZM8.25 9.75a3.75 3.75 0 1 1 7.5 0 3.75 3.75 0 0 1-7.5 0ZM18.75 9a.75.75 0 0 0-.75.75v.008c0 .414.336.75.75.75h.008a.75.75 0 0 0 .75-.75V9.75a.75.75 0 0 0-.75-.75h-.008ZM4.5 9.75A.75.75 0 0 1 5.25 9h.008a.75.75 0 0 1 .75.75v.008a.75.75 0 0 1-.75-.75H5.25a.75.75 0 0 1-.75-.75V9.75Z" clipRule="evenodd" /><path d="M2.25 18a.75.75 0 0 0 0 1.5c5.4 0 10.63.722 15.6 2.075 1.19.324 2.4-.558 2.4-1.82V18.75a.75.75 0 0 0-.75-.75H2.25Z" /></svg></div>
                        <div className="z-10 min-w-0">
                            <div className="font-bold text-sm tracking-wide truncate">{(msg.metadata as any)?.note || '转账'}</div>
                            <div className="text-[10px] opacity-90">{(msg.metadata as any)?.amount ? `¥${(msg.metadata as any).amount} · ` : ''}Moro Pay</div>
                        </div>
                    </div>
                );
            }
            case 'voice': {
                const meta = (msg.metadata as any) || {};
                const dur = meta.durationSec ? `${meta.durationSec}"` : '语音';
                const playVoice = () => { try { if (meta.voiceAudio) void new Audio(meta.voiceAudio).play(); } catch { /* ignore */ } };
                return (
                    <div
                        className="px-5 py-3 rounded-[22px] flex flex-col gap-1 max-w-[220px]"
                        style={{ backgroundColor: styleConfig.backgroundColor, color: styleConfig.textColor, opacity: styleConfig.opacity }}
                    >
                        <button onClick={playVoice} className="flex items-center gap-2 active:opacity-70">
                            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 shrink-0"><path d="M8 5v14l11-7z" /></svg>
                            <span className="flex items-end gap-0.5 h-4">{[6, 11, 7, 13, 8].map((h, i) => (<span key={i} className="w-0.5 rounded-full bg-current opacity-70" style={{ height: h }} />))}</span>
                            <span className="text-[11px] opacity-80 tabular-nums">{dur}</span>
                        </button>
                        {meta.transcript && <span className="text-[11px] leading-snug text-slate-400">{meta.transcript}</span>}
                    </div>
                );
            }
            case 'location': {
                const meta = (msg.metadata as any) || {};
                return (
                    <div className="w-56 rounded-2xl overflow-hidden border bg-[#fffdfa] active:scale-95 transition-transform" style={{ borderColor: '#eed6df' }}>
                        <div className="h-20 bg-[#fff4f7] flex items-center justify-center">
                            <svg viewBox="0 0 24 24" fill="#d8a5b7" className="w-8 h-8"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 110-5 2.5 2.5 0 010 5z" /></svg>
                        </div>
                        <div className="p-2.5">
                            <div className="text-[13px] font-bold text-[#5a3140] truncate">{msg.content}</div>
                            {meta.address && <div className="text-[11px] text-[#a892a3] truncate mt-0.5">{meta.address}</div>}
                        </div>
                    </div>
                );
            }
            case 'forum_card': {
                const fp: any = (msg.metadata as any)?.forumPost || {};
                const stats = fp.stats || {};
                const replies: any[] = Array.isArray(fp.repliesPreview) ? fp.repliesPreview : [];
                return (
                    <div className="relative">
                        <button
                            onClick={() => { if (!selectionMode) setForumDetailOpen(true); }}
                            className="w-64 rounded-2xl overflow-hidden border bg-[#fffdfa] text-left active:scale-[0.98] transition-transform"
                            style={{ borderColor: '#e3d7c6', boxShadow: '0 12px 24px -18px rgba(80,62,38,0.32)' }}
                        >
                            <div className="px-3.5 py-2.5 flex items-center gap-2 border-b" style={{ background: '#f7f1e6', borderColor: '#e3d7c6' }}>
                                <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-[13px] font-black" style={{ background: '#fffdfa', color: '#5b4630', border: '1px solid #e3d7c6' }}>茶</div>
                                <div className="min-w-0 flex-1">
                                    <div className="text-[10px] font-bold tracking-[0.18em]" style={{ color: '#9b7b54' }}>茶话亭 · {fp.boardName || fp.boardId || '帖子'}</div>
                                    <div className="text-[13px] font-black leading-snug line-clamp-2" style={{ color: '#3f352c' }}>{fp.title || '未命名茶话'}</div>
                                </div>
                            </div>
                            <div className="px-3.5 py-3">
                                <div className="text-[11px] mb-1" style={{ color: '#9b7b54' }}>楼主 {fp.author?.name || '匿名茶客'}</div>
                                <p className="text-[12.5px] leading-relaxed line-clamp-3" style={{ color: '#51463a' }}>{fp.body || '（无正文）'}</p>
                                {Array.isArray(fp.tags) && fp.tags.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-2">
                                        {fp.tags.slice(0, 3).map((t: string) => <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: '#f7f1e6', color: '#8a6a45' }}>#{t}</span>)}
                                    </div>
                                )}
                                <div className="mt-2 pt-2 border-t flex items-center justify-between text-[10px]" style={{ borderColor: '#eee4d6', color: '#9b7b54' }}>
                                    <span>{stats.likes || 0} 赞 · {stats.floors || stats.replies || 0} 楼</span>
                                    <span>点开看帖</span>
                                </div>
                            </div>
                        </button>
                        {forumDetailOpen && (
                            <div className="fixed inset-0 z-[160] bg-black/25 flex items-end justify-center px-3 pb-safe" onClick={() => setForumDetailOpen(false)}>
                                <div className="w-full max-w-sm rounded-t-[22px] bg-[#fffdfa] shadow-2xl border border-[#e3d7c6] p-4 max-h-[78vh] overflow-y-auto no-scrollbar" onClick={e => e.stopPropagation()}>
                                    <div className="flex items-start justify-between gap-3 mb-3">
                                        <div className="min-w-0">
                                            <div className="text-[10px] font-bold tracking-[0.22em]" style={{ color: '#9b7b54' }}>茶话亭 · {fp.boardName || fp.boardId || '帖子'}</div>
                                            <div className="text-[17px] font-black leading-snug mt-1" style={{ color: '#2b2933' }}>{fp.title || '未命名茶话'}</div>
                                            <div className="text-[11px] mt-1" style={{ color: '#8b8996' }}>楼主 {fp.author?.name || '匿名茶客'} · {stats.likes || 0} 赞 · {stats.floors || 0} 楼</div>
                                        </div>
                                        <button onClick={() => setForumDetailOpen(false)} className="shrink-0 px-2 py-1 rounded-full text-[11px] font-bold" style={{ background: '#f7f1e6', color: '#5b4630' }}>收起</button>
                                    </div>
                                    <p className="text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: '#3f352c' }}>{fp.body || '（无正文）'}</p>
                                    {replies.length > 0 && (
                                        <div className="mt-4 space-y-2">
                                            <div className="text-[12px] font-black" style={{ color: '#5b4630' }}>楼层预览</div>
                                            {replies.map((r, i) => (
                                                <div key={i} className="rounded-xl px-3 py-2" style={{ background: '#f7f1e6' }}>
                                                    <div className="text-[11px] font-bold" style={{ color: '#8a6a45' }}>{r.floor || '?'}楼 · {r.authorName || '茶客'}</div>
                                                    <div className="text-[12px] leading-relaxed mt-0.5" style={{ color: '#3f352c' }}>{r.body}</div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {replies.length === 0 && <div className="mt-4 text-[12px]" style={{ color: '#8b8996' }}>这张快照里还没有楼层预览。</div>}
                                </div>
                            </div>
                        )}
                    </div>
                );
            }
            case 'poll_card': {
                const pmeta = (msg.metadata as any) || {};
                const options: any[] = Array.isArray(pmeta.options) ? pmeta.options : [];
                const totalVotes = options.reduce((a, o) => a + (o.voters?.length || 0), 0);
                return (
                    <div className="w-64 rounded-2xl overflow-hidden border bg-[#fffdfa]" style={{ borderColor: '#eed6df' }}>
                        <button onClick={() => { if (!selectionMode) onPollClick?.(msg); }} className="w-full px-3.5 pt-3 pb-2 flex items-start gap-2 text-left active:bg-[#fff4f7]">
                            <div className="w-7 h-7 rounded-lg bg-[#fff4f7] text-[#9c5e74] flex items-center justify-center shrink-0"><ChartBar size={16} weight="bold" /></div>
                            <div className="min-w-0 flex-1">
                                <div className="text-[10px] text-[#a892a3] font-bold">群投票</div>
                                <div className="text-[13px] font-bold text-[#5a3140] leading-snug break-all">{pmeta.question}</div>
                            </div>
                        </button>
                        <div className="px-3 pb-3 space-y-1.5">
                            {options.map((o, i) => {
                                const count = o.voters?.length || 0;
                                const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
                                const mine = (o.voters || []).includes('user');
                                return (
                                    <button key={i} onClick={() => { if (!selectionMode) onPollVote?.(msg, i); }} className="w-full relative rounded-lg overflow-hidden border active:scale-[0.98] transition-transform text-left" style={{ borderColor: '#eed6df' }}>
                                        <div className="absolute inset-0 bg-[#fff4f7]" style={{ width: `${pct}%` }} />
                                        <div className="relative flex items-center gap-2 px-2.5 py-1.5">
                                            <span className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 flex items-center justify-center ${mine ? 'border-[#d8a5b7] bg-[#d8a5b7]' : 'border-[#eed6df]'}`}>{mine && <span className="w-1.5 h-1.5 rounded-full bg-white" />}</span>
                                            <span className="text-[12px] text-[#5a3140] flex-1 truncate">{o.text}</span>
                                            <span className="text-[11px] text-[#a892a3] font-bold shrink-0">{count}</span>
                                        </div>
                                    </button>
                                );
                            })}
                            <div className="text-[10px] text-[#a892a3] text-center pt-0.5">{totalVotes} 票 · 点选项投票 · 点标题看是谁投的</div>
                        </div>
                    </div>
                );
            }
            case 'relay_card': {
                const rmeta = (msg.metadata as any) || {};
                const entries: any[] = Array.isArray(rmeta.entries) ? rmeta.entries : [];
                const shown = entries.slice(0, 4);
                return (
                    <button onClick={() => { if (!selectionMode) onRelayClick?.(msg); }} className="w-64 rounded-2xl overflow-hidden border bg-[#fffdfa] text-left active:bg-[#fff4f7] transition-colors" style={{ borderColor: '#eed6df' }}>
                        <div className="px-3.5 pt-3 pb-2 flex items-start gap-2 border-b bg-[#fffdfa]" style={{ borderColor: '#eed6df' }}>
                            <div className="w-7 h-7 rounded-lg bg-[#fff4f7] text-[#9c5e74] flex items-center justify-center shrink-0"><ListNumbers size={16} weight="bold" /></div>
                            <div className="min-w-0 flex-1">
                                <div className="text-[10px] text-[#a892a3] font-bold">接龙</div>
                                <div className="text-[13px] font-bold text-[#5a3140] leading-snug break-all">{rmeta.title}</div>
                            </div>
                        </div>
                        <div className="px-3.5 py-2 space-y-1">
                            {entries.length === 0 ? (
                                <div className="text-[11px] text-[#a892a3] py-1">还没人接 · 点开来接龙</div>
                            ) : (
                                shown.map((e, i) => (
                                    <div key={i} className="text-[12px] text-[#8a6478] leading-snug truncate"><span className="text-[#d8a5b7] font-bold mr-1">{i + 1}.</span><span className="font-medium text-[#5a3140]">{e.name}</span> {e.text}</div>
                                ))
                            )}
                            {entries.length > shown.length && <div className="text-[10px] text-[#a892a3]">…还有 {entries.length - shown.length} 条</div>}
                        </div>
                        <div className="px-3.5 pb-2.5 text-[10px] text-[#9c5e74] font-bold">+ 点开接龙</div>
                    </button>
                );
            }
            case 'checkin_card': {
                const cmeta = (msg.metadata as any) || {};
                const entries: any[] = Array.isArray(cmeta.entries) ? cmeta.entries : [];
                const shown = entries.slice(0, 5);
                return (
                    <button onClick={() => { if (!selectionMode) onCheckinClick?.(msg); }} className="w-64 rounded-2xl overflow-hidden border bg-[#fffdfa] text-left active:bg-[#fff4f7] transition-colors" style={{ borderColor: '#eed6df' }}>
                        <div className="px-3.5 pt-3 pb-2 flex items-center gap-2 border-b bg-[#fffdfa]" style={{ borderColor: '#eed6df' }}>
                            <div className="w-7 h-7 rounded-lg bg-[#fff4f7] text-[#9c5e74] flex items-center justify-center shrink-0"><CalendarCheck size={16} weight="bold" /></div>
                            <div className="min-w-0 flex-1">
                                <div className="text-[10px] text-[#a892a3] font-bold">群签到 · {cmeta.date}</div>
                                <div className="text-[13px] font-bold text-[#5a3140] leading-snug">今日已打卡 {entries.length} 人</div>
                            </div>
                        </div>
                        <div className="px-3.5 py-2 flex flex-wrap gap-1">
                            {entries.length === 0 ? (
                                <span className="text-[11px] text-[#a892a3]">还没人签到</span>
                            ) : (
                                <>
                                    {shown.map((e, i) => (
                                        <span key={i} className="text-[11px] text-[#5a3140] bg-[#fff4f7] rounded-full px-2 py-0.5 truncate max-w-full" style={{ border: '1px solid #eed6df' }}>{e.name}{e.mood ? ` · ${e.mood}` : ''}</span>
                                    ))}
                                    {entries.length > shown.length && <span className="text-[11px] text-[#a892a3] px-1">+{entries.length - shown.length}</span>}
                                </>
                            )}
                        </div>
                    </button>
                );
            }
            default:
                return (
                    <div
                        className="px-5 py-3 rounded-[22px] text-[15px] leading-relaxed whitespace-pre-wrap break-all active:scale-[0.98] transition-transform"
                        style={{ backgroundColor: styleConfig.backgroundColor, color: styleConfig.textColor, opacity: styleConfig.opacity }}
                    >
                        {renderTextWithMentions(String(displayContent || ''))}
                    </div>
                );
        }
    };

    return (
        <div 
            className={`flex w-full animate-fade-in relative ${isLastInGroup ? 'mb-6' : 'mb-1.5'} ${isUser ? 'justify-end' : 'justify-start'} ${selectionMode ? 'pl-8' : ''}`}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onTouchMove={handleMove}
            onMouseDown={handleTouchStart}
            onMouseUp={handleTouchEnd}
            onMouseMove={handleMove}
            onClick={handleClick}
        >
            {selectionMode && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 cursor-pointer z-10">
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${isSelected ? 'bg-[#d8a5b7] border-[#d8a5b7]' : 'border-slate-300 bg-white'}`}>
                        {isSelected && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>}
                    </div>
                </div>
            )}

            {!isUser && (
                <div
                    className={`relative shrink-0 mr-2 mb-0.5 rounded-full self-end ${specialCare ? 'ring-1 ring-rose-300 ring-offset-1 ring-offset-[#ededed]' : ''} ${(onAvatarClick || onAvatarPoke) && !selectionMode ? 'cursor-pointer active:scale-90 transition-transform' : ''}`}
                    onClick={handleAvatarClick}
                >
                    {avatar ? (
                        <img src={avatar} className="w-9 h-9 rounded-full object-cover ring-1 ring-black/5 shadow-sm" loading="lazy" alt="" draggable={false} />
                    ) : (
                        <span className="w-9 h-9 rounded-full bg-slate-200 text-slate-500 flex items-center justify-center text-[12px] font-bold ring-1 ring-black/5 shadow-sm">
                            {name.slice(0, 1)}
                        </span>
                    )}
                    {specialCare && <span className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full bg-rose-500 text-white flex items-center justify-center border border-white"><BellRinging size={8} weight="fill" /></span>}
                </div>
            )}

            <div className={`flex flex-col ${isUser ? 'items-end mr-3' : 'items-start'} max-w-[72%] min-w-0 ${selectionMode ? 'pointer-events-none' : ''}`}>
                {(!isUser || isFirstInGroup) && (
                    <div className={`text-[10px] text-slate-400 mb-1 flex items-center gap-1.5 px-0.5 ${isUser ? 'mr-1 justify-end' : 'ml-0'}`}>
                        {specialCare && !isUser && (
                            <span className="px-1 py-px rounded bg-rose-50 text-rose-500 border border-rose-100 text-[8px] font-bold leading-tight flex items-center gap-0.5"><BellRinging size={8} weight="fill" />特别关心</span>
                        )}
                        {memberTitle && !isUser && (
                            <span className="px-1 py-px rounded bg-[#f8f8f8] text-slate-500 border border-slate-200 text-[8px] font-bold leading-tight">{memberTitle}</span>
                        )}
                        {!isUser && <span className="truncate max-w-[140px] bg-slate-200/70 rounded-md px-2 py-[3px] leading-none">{name}</span>}
                        {!hideTimestamp && <span className="text-slate-300 shrink-0">{timeStr}</span>}
                    </div>
                )}
                {renderContent()}
                {translationMatch && msg.type === 'text' && (
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            setShowTranslated(v => !v);
                        }}
                        className={`mt-1 text-[10px] px-2 py-0.5 rounded-full bg-white/75 text-slate-400 border border-slate-200 active:scale-95 transition ${isUser ? 'mr-1' : 'ml-1'}`}
                    >
                        {showTranslated ? '原' : '译'}
                    </button>
                )}
                {/* 表情回应小药丸（QQ/微信 tap-to-react） */}
                {Array.isArray(msg.metadata?.reactions) && msg.metadata.reactions.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                        {(msg.metadata.reactions as { emoji: string; by: string[] }[]).map(r => {
                            const mine = r.by?.includes('user');
                            return (
                                <button key={r.emoji} onClick={(e) => { e.stopPropagation(); onReactToggle?.(msg, r.emoji); }}
                                    className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[12px] leading-none border transition-colors active:scale-90 ${mine ? 'bg-primary/15 border-primary/40' : 'bg-black/5 border-black/10'}`}>
                                    <span>{r.emoji}</span>
                                    {(r.by?.length || 0) > 1 && <span className="text-[9px] font-bold opacity-60">{r.by.length}</span>}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {isUser && (
                <div className="flex flex-col items-center gap-1 shrink-0 self-end mb-1">
                    <img src={avatar} className="w-9 h-9 rounded-full object-cover shadow-sm border border-white" loading="lazy" />
                </div>
            )}
        </div>
    );
});

// --- Main Component ---

// 聊天 App 整合枢纽：聊天列表（单聊+群聊混排）/ 联系人 / 朋友圈 三标签 + 群聊会话视图。
// 单聊会话仍由 apps/Chat.tsx（AppID.Chat）承担，从这里深链进入、返回时回到本枢纽。
const ChatHub: React.FC = () => {
    const { closeApp, openApp, groups, createGroup, deleteGroup, updateGroup, characters, importCharacter, updateCharacter, setActiveCharacterId, apiConfig, auxApiConfig, addToast, userProfile, updateUserProfile, virtualTime, adjustUserBalance, theme: osTheme, unreadMessages, clearUnread, markUnread, activeApp, availableModels, setAvailableModels, apiPresets, addApiPreset, suspendedOfflineSession, suspendOfflineSession, clearSuspendedOfflineSession } = useOS();
    const [view, setView] = useState<'list' | 'chat'>('list');
    const [hubTab, setHubTab] = useState<'chats' | 'contacts' | 'moments' | 'couple'>(() => {
        // 深链握手：角色主页「朋友圈」入口 → 聊天 App 朋友圈标签页（原独立朋友圈 App 已改造为小红书）
        try {
            if (localStorage.getItem('moro_chathub_open_tab') === 'moments') {
                localStorage.removeItem('moro_chathub_open_tab');
                return 'moments';
            }
        } catch { /* ignore */ }
        return 'chats';
    });
    const [momentsUnreadCount, setMomentsUnreadCount] = useState(0);
    const [activeGroup, setActiveGroup] = useState<GroupProfile | null>(null);
    const [quickConvoId, setQuickConvoId] = useState<string | null>(null);
    // 朋友圈内层页面（发布页等）的返回拦截：返回键先关内层页面，而不是退出 App 回桌面
    const momentsBackRef = useRef<(() => boolean) | null>(null);
    useEffect(() => {
        let cancelled = false;
        const refreshUnread = async () => {
            try {
                const unread = await DB.getUnreadSocialPosts();
                if (!cancelled) setMomentsUnreadCount(unread.length);
            } catch {
                if (!cancelled) setMomentsUnreadCount(0);
            }
        };
        void refreshUnread();
        const onMoment = () => { void refreshUnread(); };
        window.addEventListener('character-moment-posted', onMoment);
        window.addEventListener('moments-seen', onMoment);
        return () => {
            cancelled = true;
            window.removeEventListener('character-moment-posted', onMoment);
            window.removeEventListener('moments-seen', onMoment);
        };
    }, []);
    useEffect(() => {
        if (hubTab === 'moments') setMomentsUnreadCount(0);
    }, [hubTab]);
    // 聊天列表：单聊 + 群聊混排（按最后一条消息时间倒序）
    const [convos, setConvos] = useState<ConvoListItem[]>([]);
    const [convoRefreshTick, setConvoRefreshTick] = useState(0);
    const [hiddenConvoWindows, setHiddenConvoWindows] = useState<ConvoHiddenWindows>(() => loadHiddenConvoWindows());
    const [ambientEntries, setAmbientEntries] = useState<AmbientSocialEntry[]>([]);
    // 成员资料页（点头像进入）
    const [profileMemberId, setProfileMemberId] = useState<string | null>(null);
    // 头衔编辑 / 禁言时长选择
    const [tempTitle, setTempTitle] = useState('');
    // 管理员/群主给成员改群名片（成员资料页里）
    const [tempMemberNickname, setTempMemberNickname] = useState('');
    // 移除成员二次确认（第一次点变红，再点才执行）
    const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
    // 转让群主二次确认（两段点击，同移出成员）
    const [confirmTransferId, setConfirmTransferId] = useState<string | null>(null);
    // 我的群名片编辑（设置弹窗里）
    const [tempMyNickname, setTempMyNickname] = useState('');
    const [tempArchiveTitle, setTempArchiveTitle] = useState('');
    const [tempSpecialCareIds, setTempSpecialCareIds] = useState<Set<string>>(new Set());
    const [tempSpecialCareNotify, setTempSpecialCareNotify] = useState(true);
    const [tempMemberLenses, setTempMemberLenses] = useState<GroupMemberLensDraft>({});
    const [tempLensViewerId, setTempLensViewerId] = useState<string | null>(null);
    const [memberLensGeneratingKey, setMemberLensGeneratingKey] = useState<string | null>(null);
    const [tempReplyIndividually, setTempReplyIndividually] = useState(false);
    const [tempAutoContinueEnabled, setTempAutoContinueEnabled] = useState(false);
    const [tempAutoContinueRounds, setTempAutoContinueRounds] = useState(2);
    const [tempLiveChatOverride, setTempLiveChatOverride] = useState<LiveChatOverride>('inherit');
    const [tempGroupConvo, setTempGroupConvo] = useState<GroupConvoSettings>(() => resolveGroupConvo(null));
    const [groupInnerVoiceTargetId, setGroupInnerVoiceTargetId] = useState('');
    const [groupInnerVoicePeek, setGroupInnerVoicePeek] = useState<GroupInnerVoicePeek | null>(null);
    const [groupInnerVoiceLoading, setGroupInnerVoiceLoading] = useState(false);
    const [tempGroupApi, setTempGroupApi] = useState<GroupApiDraft>({ baseUrl: '', apiKey: '', model: '' });
    const [tempMemberApis, setTempMemberApis] = useState<Record<string, GroupApiDraft>>({});
    const [tempOpeningGreetings, setTempOpeningGreetings] = useState<string[]>([]);
    const [groupOpeningIdx, setGroupOpeningIdx] = useState(0);
    const [groupApiModelTarget, setGroupApiModelTarget] = useState<GroupApiModelTarget | null>(null);
    const [groupApiModelFilter, setGroupApiModelFilter] = useState('');
    const [groupApiModelLoadingKey, setGroupApiModelLoadingKey] = useState<string | null>(null);
    const [groupArchiveSearch, setGroupArchiveSearch] = useState('');
    const [renamingGroupRecordId, setRenamingGroupRecordId] = useState<string | null>(null);
    const [renamingGroupRecordTitle, setRenamingGroupRecordTitle] = useState('');
    // 点开「改名小心思」系统提示后，要展示动机的那条消息
    const [nicknameThoughtMsg, setNicknameThoughtMsg] = useState<Message | null>(null);
    // 群聊表情抽屉搜索
    const [emojiSearch, setEmojiSearch] = useState('');
    const [messages, setMessages] = useState<Message[]>([]);
    const [revealedGroupAssistantIds, setRevealedGroupAssistantIds] = useState<Set<number>>(() => new Set());
    const [totalMsgCount, setTotalMsgCount] = useState(0);
    const [visibleCount, setVisibleCount] = useState(30);
    const [loadingGroupHistory, setLoadingGroupHistory] = useState(false);
    // 群聊天记录查找：搜索浮层 + 关键词 + 全量消息快照 + 跳转高亮
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [searchAllMsgs, setSearchAllMsgs] = useState<Message[]>([]);
    const [highlightMsgId, setHighlightMsgId] = useState<number | null>(null);
    // 每次跳转自增，确保「自动滚到底」的 layout effect 重新触发并改为滚到目标
    const [jumpNonce, setJumpNonce] = useState(0);
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    /** 群记忆宫殿"提取中"状态文本——非空时显示顶部胶囊状态条 */
    const [groupPalaceStatus, setGroupPalaceStatus] = useState<string>('');

    const groupApiModelPickerView = useMemo(() => {
        const q = groupApiModelFilter.trim().toLowerCase();
        const source = availableModels;
        return {
            total: source.length,
            filtered: q ? source.filter(model => model.toLowerCase().includes(q)) : source,
        };
    }, [availableModels, groupApiModelFilter]);

    // ref 出最新 characters，让 finally 里跑的群记忆宫殿能读到"用户刚关掉某个成员宫殿"
    // 的最新状态——闭包里的 characters 还是发消息那一刻捕获的旧值，会让关闭后还触发一次
    const charactersRef = useRef(characters);
    charactersRef.current = characters;
    const activeGroupRef = useRef<GroupProfile | null>(activeGroup);
    activeGroupRef.current = activeGroup;

    // Token 统计 — 对齐私聊 ChatHeader 的 token badge
    const [lastTokenUsage, setLastTokenUsage] = useState<number | null>(null);
    const [tokenBreakdown, setTokenBreakdown] = useState<{ prompt: number; completion: number; total: number; msgCount: number; pass: string } | null>(null);
    
    // UI State
    const [showActions, setShowActions] = useState(false);
    const [showGroupOfflineMode, setShowGroupOfflineMode] = useState(false);
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [showEmojiImportModal, setShowEmojiImportModal] = useState(false);
    const [groupCall, setGroupCall] = useState<GroupCallSession | null>(null);
    const [groupCallSecs, setGroupCallSecs] = useState(0);
    const [groupCallMuted, setGroupCallMuted] = useState(false);
    const [groupCallSpeakerOn, setGroupCallSpeakerOn] = useState(true);
    const [groupCallBubbles, setGroupCallBubbles] = useState<GroupCallBubble[]>([]);
    const [groupCallDraft, setGroupCallDraft] = useState('');
    const [groupCallState, setGroupCallState] = useState<GroupCallState>('ended');
    const [groupCallError, setGroupCallError] = useState('');
    const [showDashboard, setShowDashboard] = useState(false);
    const [modalType, setModalType] = useState<'none' | 'create' | 'add-friend' | 'settings' | 'transfer' | 'member_select' | 'message-options' | 'edit-message' | 'member-profile' | 'set-title' | 'set-member-nickname' | 'mute-member' | 'add-member' | 'group-announcement' | 'mention-picker' | 'collect' | 'poll' | 'relay' | 'forward-pick'>('none');
    // 右上角 + 号弹出菜单（添加好友 / 创建群聊）
    const [showPlusMenu, setShowPlusMenu] = useState(false);
    const [showRelNet, setShowRelNet] = useState(false);
    // 加好友页选中「拉黑你的角色」→ 好友验证弹窗
    const [verifyCharId, setVerifyCharId] = useState<string | null>(null);
    const [pendingUnblockAppeals, setPendingUnblockAppeals] = useState<PendingUnblockAppeal[]>([]);
    const [unblockAppealTarget, setUnblockAppealTarget] = useState<PendingUnblockAppeal | null>(null);
    const [unblockAppealReply, setUnblockAppealReply] = useState('');
    const [unblockAppealBusy, setUnblockAppealBusy] = useState<'accept' | 'reject' | null>(null);
    const [bulkUnblockBusy, setBulkUnblockBusy] = useState(false);
    const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
    const [editContent, setEditContent] = useState('');
    const [preserveContext, setPreserveContext] = useState(true);
    const [isSummarizing, setIsSummarizing] = useState(false);
    const [summaryProgress, setSummaryProgress] = useState('');

    // Archive prompt selection (shared with Chat app)
    const [archivePrompts, setArchivePrompts] = useState<{id: string, name: string, content: string}[]>(DEFAULT_ARCHIVE_PROMPTS);
    const [selectedPromptId, setSelectedPromptId] = useState<string>('preset_rational');

    // Context limit (like Chat app's settingsContextLimit)
    const [contextLimit, setContextLimit] = useState<number>(() => {
        return readLegacyGroupContextLimit();
    });
    const ambientSocialEnabled = userProfile.ambientSocialEnabled !== false;
    const ambientSocialHideConverted = userProfile.ambientSocialHideConverted !== false;
    const liveChatSettings = useMemo(
        () => normalizeLiveChatSettings(userProfile),
        [userProfile.liveChatSettings],
    );
    const liveChatGlobalEnabled = liveChatSettings.enabled;
    const activeGroupConvo = useMemo(() => resolveGroupConvo(activeGroup), [activeGroup]);
    const liveGroupEnabled = activeGroup ? resolveLiveChatEnabled(userProfile, resolveGroupLiveOverride(activeGroup)) : false;
    
    // Selection Mode
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedMsgIds, setSelectedMsgIds] = useState<Set<number>>(new Set());

    // Data State
    const [emojis, setEmojis] = useState<Emoji[]>([]);
    const [categories, setCategories] = useState<EmojiCategory[]>([]); // New
    
    // Create/Edit Group State
    const [tempGroupName, setTempGroupName] = useState('');
    const [tempPrivateContextCap, setTempPrivateContextCap] = useState<number>(80);
    const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
    // 创建群聊时指定群主（'user' 或任一已选成员）与管理员
    const [tempOwnerId, setTempOwnerId] = useState<string>('user');
    const [tempAdminIds, setTempAdminIds] = useState<Set<string>>(new Set());
    const [transferAmount, setTransferAmount] = useState('');
    const [transferNote, setTransferNote] = useState('');
    const [transferPassword, setTransferPassword] = useState('');
    // 群公告编辑草稿（打开「群公告」弹窗时回填当前公告）
    const [tempAnnouncement, setTempAnnouncement] = useState('');
    // 红包类型：普通 / 口令 / 拼手气
    const [transferRpType, setTransferRpType] = useState<'normal' | 'password' | 'lucky'>('normal');
    // 拼手气份数（默认随群成员数变化，见 Transfer Modal）
    const [transferShares, setTransferShares] = useState('');
    const [redPacketOpenMsg, setRedPacketOpenMsg] = useState<Message | null>(null);
    const [redPacketPasswordInput, setRedPacketPasswordInput] = useState('');
    // 群收款（AA 收款）：总额 / 事由 / 被收成员 / 收款详情弹窗目标
    const [collectAmount, setCollectAmount] = useState('');
    const [collectNote, setCollectNote] = useState('');
    const [collectMembers, setCollectMembers] = useState<Set<string>>(new Set());
    const [collectDetailMsg, setCollectDetailMsg] = useState<Message | null>(null);
    // 群投票：问题 / 选项草稿 / 票数详情弹窗目标
    const [pollQuestion, setPollQuestion] = useState('');
    const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
    const [pollDetailMsg, setPollDetailMsg] = useState<Message | null>(null);
    // 群接龙：主题 / 我的第一条 / 接龙详情弹窗目标 / 详情里加入用的输入
    const [relayTitle, setRelayTitle] = useState('');
    const [relayFirst, setRelayFirst] = useState('');
    const [relayDetailMsg, setRelayDetailMsg] = useState<Message | null>(null);
    const [relayInput, setRelayInput] = useState('');
    // 群签到：详情弹窗目标
    const [checkinDetailMsg, setCheckinDetailMsg] = useState<Message | null>(null);
    // 文具盒·扩展功能（群聊版回形针：与单聊同一套功能）
    const [actionModal, setActionModal] = useState<'none' | 'location' | 'image-gen' | 'system-cmd'>('none');
    // 单聊专属功能（拨过去/翻手机/回个神…）在群里先选「对谁」，再深链到该成员单聊执行
    const [memberPicker, setMemberPicker] = useState<{ action: string; title: string; hint?: string } | null>(null);
    const [locName, setLocName] = useState('');
    const [locDetail, setLocDetail] = useState('');
    const [imgPrompt, setImgPrompt] = useState('');
    const [imgModel, setImgModel] = useState(() => { try { return localStorage.getItem('moro_image_gen_model') || ''; } catch { return ''; } });
    const [imgPreview, setImgPreview] = useState<string | null>(null);
    const [imgBusy, setImgBusy] = useState(false);
    const [sysCmd, setSysCmd] = useState('');
    const ambientSocialLinkedCharacterIds = useMemo(
        () => getAmbientSocialLinkedCharacterIds(userProfile.ambientSocial?.entries || []),
        [userProfile.ambientSocial]
    );
    const ambientSocialLinkedGroupIds = useMemo(
        () => getAmbientSocialLinkedGroupIds(userProfile.ambientSocial?.entries || []),
        [userProfile.ambientSocial]
    );
    const isAmbientSocialCharacterForUser = useCallback((char: CharacterProfile | null | undefined): boolean => (
        !!char && (isAmbientSocialCharacter(char) || ambientSocialLinkedCharacterIds.has(char.id))
    ), [ambientSocialLinkedCharacterIds]);
    const isAmbientSocialGroupForUser = useCallback((group: GroupProfile | null | undefined): boolean => (
        !!group && (isAmbientSocialGroup(group) || ambientSocialLinkedGroupIds.has(group.id))
    ), [ambientSocialLinkedGroupIds]);
    const shouldKeepConvoWhenAmbientSocialOff = useCallback((cv: ConvoListItem): boolean => {
        if (cv.kind === 'ambient') return false;
        if (!ambientSocialHideConverted) return true;
        if (cv.kind === 'char') return !isAmbientSocialCharacterForUser(characters.find(c => c.id === cv.id));
        if (cv.kind === 'group') return !isAmbientSocialGroupForUser(groups.find(g => g.id === cv.id));
        return true;
    }, [ambientSocialHideConverted, characters, groups, isAmbientSocialCharacterForUser, isAmbientSocialGroupForUser]);
    const visibleCharacters = useMemo(() => characters.filter(char => (
        !ambientSocialHideConverted || !isAmbientSocialCharacterForUser(char)
    )), [characters, ambientSocialHideConverted, isAmbientSocialCharacterForUser]);
    const visibleGroups = useMemo(() => groups.filter(group => (
        isVisibleGroup(group) && (!ambientSocialHideConverted || !isAmbientSocialGroupForUser(group))
    )), [groups, ambientSocialHideConverted, isAmbientSocialGroupForUser]);
    const pendingUnblockAppealByCharId = useMemo(() => {
        const map = new Map<string, PendingUnblockAppeal>();
        pendingUnblockAppeals.forEach(item => map.set(item.charId, item));
        return map;
    }, [pendingUnblockAppeals]);
    const newFriendCharacters = useMemo(() => (
        visibleCharacters.filter(c => !!c.charBlock?.active || pendingUnblockAppealByCharId.has(c.id) || (!!c.blacklisted && !!c.unblockAppeal?.awaiting))
    ), [visibleCharacters, pendingUnblockAppealByCharId]);
    const blacklistedCharacters = useMemo(() => (
        visibleCharacters
            .filter(c => !!c.blacklisted)
            .sort((a, b) => (b.blacklistedAt || 0) - (a.blacklistedAt || 0))
    ), [visibleCharacters]);

    useEffect(() => {
        let cancelled = false;
        const candidates = visibleCharacters.filter(c => !!c.blacklisted && !!c.unblockAppeal?.awaiting);
        if (candidates.length === 0) {
            setPendingUnblockAppeals([]);
            setUnblockAppealTarget(null);
            return;
        }
        void (async () => {
            const next: PendingUnblockAppeal[] = [];
            for (const c of candidates) {
                try {
                    const allMessages = await DB.getMessagesByCharId(c.id, true);
                    const msg = [...allMessages]
                        .sort((a, b) => (b.timestamp - a.timestamp) || (b.id - a.id))
                        .find(m => m.metadata?.unblockAppeal?.status === 'pending');
                    if (msg) next.push({ charId: c.id, message: msg });
                } catch (err) {
                    console.warn('[ChatHub] load pending unblock appeal failed', c.id, err);
                }
            }
            next.sort((a, b) => b.message.timestamp - a.message.timestamp);
            if (cancelled) return;
            setPendingUnblockAppeals(next);
            setUnblockAppealTarget(prev => {
                if (!prev) return prev;
                return next.find(item => item.message.id === prev.message.id) || null;
            });
        })();
        return () => { cancelled = true; };
    }, [visibleCharacters, convoRefreshTick]);
    // Refs
    const scrollRef = useRef<HTMLDivElement>(null);
    const pendingHistoryScrollRestoreRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
    const convoRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // 聊天记录查找跳转目标：非空时 layout effect 滚到该消息而非底部
    const jumpTargetRef = useRef<number | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const groupAvatarInputRef = useRef<HTMLInputElement>(null);
    const groupBackgroundInputRef = useRef<HTMLInputElement>(null);
    const groupArchiveInputRef = useRef<HTMLInputElement>(null);
    const groupCallScrollRef = useRef<HTMLDivElement>(null);
    const groupCallIntroFiredRef = useRef<string | null>(null);
    const groupCallActiveSessionRef = useRef<string | null>(null);
    const forumGroupShareTriggerRef = useRef<{ groupId: string; shareId: string } | null>(null);
    const forumGroupShareConsumingRef = useRef<string | null>(null);
    const liveGroupDraftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const liveGroupDraftLastChangedAtRef = useRef<number>(0);
    const liveGroupDraftLastTriggeredAtRef = useRef<number>(0);
    const liveGroupDraftLastTextRef = useRef<string>('');
    const liveGroupPendingSendTriggerRef = useRef(false);
    const liveGroupPrevTypingRef = useRef(false);
    const groupAutoReplyQueueRef = useRef<Promise<void>>(Promise.resolve());
    const groupRevealTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
    const groupRevealKnownIdsRef = useRef<Set<number>>(new Set());
    const groupRevealNextAtRef = useRef(0);
    const groupRevealHydratedRef = useRef(false);

    const clearGroupRevealTimers = useCallback(() => {
        groupRevealTimersRef.current.forEach(timer => clearTimeout(timer));
        groupRevealTimersRef.current = [];
        groupRevealNextAtRef.current = 0;
    }, []);

    const hydrateGroupSettingsDraft = (group: GroupProfile | null) => {
        if (!group) return;
        setTempGroupName(group.name || '');
        setTempPrivateContextCap(group.privateContextCap ?? 80);
        setTempMyNickname(group.memberNicknames?.['user'] || '');
        setTempArchiveTitle(group.chatArchiveTitle || group.name || '');
        setTempSpecialCareIds(new Set(group.specialCareMemberIds || []));
        setTempSpecialCareNotify(group.specialCareNotify !== false);
        setTempMemberLenses(pruneGroupMemberLenses(group.memberLenses, group.members || []));
        setTempLensViewerId(group.members?.[0] || null);
        setMemberLensGeneratingKey(null);
        setTempReplyIndividually(!!group.replyIndividually);
        setTempAutoContinueEnabled(!!group.autoContinueEnabled);
        setTempAutoContinueRounds(Math.max(1, Math.min(8, group.autoContinueRounds || 2)));
        const nextConvo = {
            ...resolveGroupConvo(group),
            contextLimit: resolveGroupContextLimit(group, contextLimit),
        };
        setTempGroupConvo(nextConvo);
        setTempLiveChatOverride(nextConvo.liveChatOverride || 'inherit');
        setContextLimit(nextConvo.contextLimit || DEFAULT_GROUP_CONTEXT_LIMIT);
        setGroupInnerVoiceTargetId(group.members?.[0] || '');
        setGroupInnerVoicePeek(null);
        setTempOpeningGreetings(normalizeGroupOpeningGreetings(group.openingGreetings));
        setGroupOpeningIdx(0);
        setTempGroupApi(normalizeGroupApiDraft(group.groupApi));
        const memberApis: Record<string, GroupApiDraft> = {};
        Object.entries(group.memberApis || {}).forEach(([charId, api]) => {
            if (group.members?.includes(charId)) memberApis[charId] = normalizeGroupApiDraft(api);
        });
        setTempMemberApis(memberApis);
    };

    const openGroupSettings = (group = activeGroup) => {
        hydrateGroupSettingsDraft(group);
        setGroupArchiveSearch('');
        setRenamingGroupRecordId(null);
        setRenamingGroupRecordTitle('');
        setModalType('settings');
        if (group) {
            saveActiveGroupChatSnapshot(group, group.chatArchiveTitle || group.name).catch(err => {
                console.warn('[GroupChat] snapshot before settings failed', err);
            });
        }
    };

    useManualDeepLink(AppID.GroupChat, useCallback((target) => {
        const tab = typeof target.payload?.tab === 'string'
            ? target.payload.tab
            : String(target.route || '').replace(/^tab:/, '');
        setView('list');
        if (['chats', 'contacts', 'moments', 'couple'].includes(tab)) {
            setHubTab(tab as typeof hubTab);
        }
        if (target.route === 'relationship-network') {
            setHubTab('contacts');
            setShowRelNet(true);
        }
        if (target.route === 'dashboard') {
            setShowDashboard(true);
        }
        if (target.route === 'group-settings') {
            const group = activeGroup || visibleGroups[0] || null;
            if (group) {
                setActiveGroup(group);
                openGroupSettings(group);
            } else {
                setHubTab('contacts');
            }
        }
        window.setTimeout(() => {
            if (!scrollToManualAnchor(target.anchorId)) scrollToManualAnchor('manual-chathub-root');
        }, 220);
    }, [activeGroup, visibleGroups, hubTab]), { enabled: activeApp === AppID.GroupChat });

    const handleToggleAmbientSocial = () => {
        const enabled = !ambientSocialEnabled;
        updateUserProfile({ ambientSocialEnabled: enabled });
        if (!enabled) {
            setAmbientEntries([]);
            setConvos(prev => prev.filter(shouldKeepConvoWhenAmbientSocialOff));
        }
        addToast(enabled ? '用户社交圈已开启' : '用户社交圈已关闭', 'success');
    };

    const handleToggleAmbientSocialHideConverted = () => {
        const next = !ambientSocialHideConverted;
        updateUserProfile({ ambientSocialHideConverted: next });
        setConvoRefreshTick(t => t + 1);
        addToast(next ? '已隐藏已接入 NPC / 群聊' : '已接入 NPC / 群聊会显示在往来和名册', 'success');
    };

    const handleToggleLiveChatGlobal = () => {
        const next = !liveChatGlobalEnabled;
        updateUserProfile({
            liveChatSettings: {
                ...liveChatSettings,
                enabled: next,
            },
        });
        addToast(next ? '实时聊天模式已作为全局默认开启' : '实时聊天模式全局默认已关闭', next ? 'success' : 'info');
    };

    // Load shared archive prompts from localStorage (same key as Chat app)
    useEffect(() => {
        const savedPrompts = localStorage.getItem('chat_archive_prompts');
        if (savedPrompts) {
            try {
                const parsed = JSON.parse(savedPrompts);
                const merged = [...DEFAULT_ARCHIVE_PROMPTS, ...parsed.filter((p: any) => !p.id.startsWith('preset_'))];
                setArchivePrompts(merged);
            } catch(e) {}
        }
    }, []);

    useEffect(() => {
        if (!ambientSocialEnabled) {
            setAmbientEntries([]);
            setConvos(prev => prev.filter(shouldKeepConvoWhenAmbientSocialOff));
            return;
        }
        let cancelled = false;
        const showActiveEntries = (entries: AmbientSocialEntry[] = []) => {
            setAmbientEntries(entries.filter(e => !e.hidden && !(e.kind === 'contact' && e.linkedCharId) && !(e.kind === 'group' && e.linkedGroupId)));
        };
        showActiveEntries(userProfile.ambientSocial?.entries || []);
        (async () => {
            try {
                const next = await ensureAmbientSocialState(userProfile, characters, resolveAuxApi(auxApiConfig, apiConfig));
                if (cancelled) return;
                showActiveEntries(next.entries);
                if (JSON.stringify(next) !== JSON.stringify(userProfile.ambientSocial || null)) {
                    updateUserProfile({ ambientSocial: next });
                }
            } catch (err) {
                console.warn('[AmbientSocial] generate from user profile failed', err);
                if (!cancelled) showActiveEntries(userProfile.ambientSocial?.entries || []);
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        ambientSocialEnabled,
        ambientSocialHideConverted,
        characters.length,
        userProfile.name,
        userProfile.bio,
        userProfile.patSuffix,
        userProfile.vrState?.enabled,
        userProfile.vrState?.currentRoom,
        userProfile.vrState?.activity,
        userProfile.ambientSocial,
        apiConfig.baseUrl,
        apiConfig.apiKey,
        apiConfig.model,
        auxApiConfig.enabled,
        auxApiConfig.baseUrl,
        auxApiConfig.apiKey,
        auxApiConfig.model,
    ]);

    const reloadEmojiData = useCallback(async () => {
        await DB.initializeEmojiData();
        const [es, cats] = await Promise.all([DB.getEmojis(), DB.getEmojiCategories()]);
        setEmojis(es);
        setCategories(cats);
    }, []);

    // Initial Load
    useEffect(() => {
        if (activeGroup) {
            let cancelled = false;
            pendingHistoryScrollRestoreRef.current = null;
            setLoadingGroupHistory(false);
            setVisibleCount(GROUP_CHAT_LOAD_BATCH_SIZE);
            setSearchOpen(false);
            setSearchTerm('');
            setCollectDetailMsg(null);
            setPollDetailMsg(null);
            setRelayDetailMsg(null);
            setCheckinDetailMsg(null);
            DB.getRecentGroupMessagesWithCount(activeGroup.id, 60).then(({ messages: msgs, totalCount }) => {
                if (cancelled) return;
                const visibleMsgs = msgs.filter(m => m.metadata?.source !== 'group_call');
                setMessages(visibleMsgs.slice(-GROUP_CHAT_LOAD_BATCH_SIZE));
                setTotalMsgCount(totalCount);
            });
            // Fetch emojis AND categories
            (async () => {
                await DB.initializeEmojiData();
                const [es, cats] = await Promise.all([DB.getEmojis(), DB.getEmojiCategories()]);
                if (cancelled) return;
                setEmojis(es);
                setCategories(cats);
            })();
            return () => { cancelled = true; };
        }
    }, [activeGroup]);

    // Auto Scroll
    useLayoutEffect(() => {
        // 聊天记录查找：跳转到指定消息时，优先滚到目标而非底部
        if (jumpTargetRef.current != null) {
            const targetId = jumpTargetRef.current;
            jumpTargetRef.current = null;
            pendingHistoryScrollRestoreRef.current = null;
            const el = document.getElementById(`gmsg-${targetId}`);
            if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
        }
        const restore = pendingHistoryScrollRestoreRef.current;
        if (restore) {
            pendingHistoryScrollRestoreRef.current = null;
            const el = scrollRef.current;
            if (el) {
                el.scrollTop = Math.max(0, el.scrollHeight - restore.scrollHeight + restore.scrollTop);
            }
            return;
        }
        if (scrollRef.current && !selectionMode) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages.length, activeGroup, showActions, showEmojiPicker, isTyping, selectionMode, jumpNonce]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const requestRefresh = () => {
            if (convoRefreshTimerRef.current) clearTimeout(convoRefreshTimerRef.current);
            convoRefreshTimerRef.current = setTimeout(() => {
                convoRefreshTimerRef.current = null;
                setConvoRefreshTick(t => t + 1);
            }, 80);
        };

        window.addEventListener('messages-updated', requestRefresh);
        window.addEventListener('focus', requestRefresh);
        document.addEventListener('visibilitychange', requestRefresh);
        return () => {
            window.removeEventListener('messages-updated', requestRefresh);
            window.removeEventListener('focus', requestRefresh);
            document.removeEventListener('visibilitychange', requestRefresh);
            if (convoRefreshTimerRef.current) {
                clearTimeout(convoRefreshTimerRef.current);
                convoRefreshTimerRef.current = null;
            }
        };
    }, []);

    const convoKey = (kind: ConvoKind, id: string) => `${kind}:${id}`;
    const hideConvoWindow = (kind: ConvoKind, id: string, hiddenAt = Date.now()) => {
        const key = convoKey(kind, id);
        setHiddenConvoWindows(prev => {
            const next = { ...prev, [key]: hiddenAt };
            saveHiddenConvoWindows(next);
            return next;
        });
    };
    const restoreConvoWindow = (kind: ConvoKind, id: string) => {
        const key = convoKey(kind, id);
        setHiddenConvoWindows(prev => {
            if (!(key in prev)) return prev;
            const next = { ...prev };
            delete next[key];
            saveHiddenConvoWindows(next);
            return next;
        });
    };
    const isConvoWindowHidden = (kind: ConvoKind, id: string, lastTs = 0): boolean => {
        const hiddenAt = hiddenConvoWindows[convoKey(kind, id)];
        return typeof hiddenAt === 'number' && hiddenAt >= lastTs;
    };
    const refreshConvoList = () => setConvos(prev => [...prev]);
    const saveAmbientSocialEntry = (id: string, updates: Partial<AmbientSocialEntry>) => {
        const next = patchAmbientSocialEntry(userProfile.ambientSocial, id, updates);
        updateUserProfile({ ambientSocial: next });
        setAmbientEntries(next.entries.filter(e => !e.hidden && !(e.kind === 'contact' && e.linkedCharId) && !(e.kind === 'group' && e.linkedGroupId)));
    };
    const handleToggleConvoPinned = async (kind: ConvoKind, id: string) => {
        if (kind === 'char') {
            const c = characters.find(item => item.id === id);
            if (!c) return;
            await updateCharacter(id, { starredFriend: !c.starredFriend } as any);
            addToast(c.starredFriend ? '已取消置顶' : '已置顶会话', 'success');
        } else if (kind === 'group') {
            const g = groups.find(item => item.id === id && isVisibleGroup(item));
            if (!g) return;
            await updateGroup(id, { pinned: !g.pinned });
            addToast(g.pinned ? '已取消置顶' : '已置顶群聊', 'success');
        } else {
            const entry = ambientEntries.find(item => item.id === id);
            if (!entry) return;
            saveAmbientSocialEntry(id, { pinned: !entry.pinned } as Partial<AmbientSocialEntry>);
            addToast(entry.pinned ? '已取消置顶' : '已置顶会话', 'success');
        }
        setQuickConvoId(null);
    };
    const handleMarkConvoUnread = (kind: ConvoKind, id: string) => {
        if (kind === 'char') {
            markUnread(id, 1);
        } else if (kind === 'group') {
            try { localStorage.setItem(`moro_group_unread_${id}`, '1'); } catch { /* ignore */ }
            refreshConvoList();
        } else {
            saveAmbientSocialEntry(id, { unread: 1 } as Partial<AmbientSocialEntry>);
        }
        addToast('已标为未读', 'success');
        setQuickConvoId(null);
    };
    const handleDeleteConvo = async (kind: ConvoKind, id: string) => {
        if (kind === 'char') {
            hideConvoWindow(kind, id);
            clearUnread(id);
            addToast('已从往来收起，会话记录仍在', 'success');
        } else if (kind === 'group') {
            hideConvoWindow(kind, id);
            try { localStorage.removeItem(`moro_group_unread_${id}`); } catch { /* ignore */ }
            addToast('已从往来收起，群聊仍在名册', 'success');
        } else {
            saveAmbientSocialEntry(id, { hidden: true, unread: 0 } as Partial<AmbientSocialEntry>);
            addToast('已从往来里收起', 'success');
        }
        setQuickConvoId(null);
        refreshConvoList();
    };

    useEffect(() => {
        if (!groupCall) {
            setGroupCallSecs(0);
            return;
        }
        const tick = () => setGroupCallSecs(Math.max(0, Math.floor((Date.now() - groupCall.startedAt) / 1000)));
        tick();
        const timer = window.setInterval(tick, 1000);
        return () => window.clearInterval(timer);
    }, [groupCall]);

    useEffect(() => {
        groupCallScrollRef.current?.scrollTo({ top: groupCallScrollRef.current.scrollHeight, behavior: 'smooth' });
    }, [groupCallBubbles.length, groupCallState]);

    const displayMessages = useMemo(() => messages
        .filter(m => m.metadata?.source !== 'group_call')
        .slice(-visibleCount), [messages, visibleCount]);

    useEffect(() => () => clearGroupRevealTimers(), [clearGroupRevealTimers]);

    useEffect(() => {
        clearGroupRevealTimers();
        groupRevealKnownIdsRef.current = new Set();
        groupRevealHydratedRef.current = false;
        setRevealedGroupAssistantIds(new Set());
    }, [activeGroup?.id, clearGroupRevealTimers]);

    useEffect(() => {
        const currentIds = new Set(displayMessages.map(m => m.id));
        const currentAssistantIds = displayMessages.filter(isGroupAssistantRevealMessage).map(m => m.id);

        if (selectionMode || jumpTargetRef.current != null) {
            clearGroupRevealTimers();
            groupRevealKnownIdsRef.current = currentIds;
            groupRevealHydratedRef.current = true;
            setRevealedGroupAssistantIds(new Set(currentAssistantIds));
            return;
        }

        if (!groupRevealHydratedRef.current) {
            groupRevealKnownIdsRef.current = currentIds;
            groupRevealHydratedRef.current = true;
            setRevealedGroupAssistantIds(new Set(currentAssistantIds));
            return;
        }

        const knownIds = groupRevealKnownIdsRef.current;
        const numericKnownIds = Array.from(knownIds).filter(id => Number.isFinite(id));
        const maxKnownId = numericKnownIds.length ? Math.max(...numericKnownIds) : 0;
        const historyAssistantIds = new Set(
            displayMessages
                .filter(m => isGroupAssistantRevealMessage(m) && !knownIds.has(m.id) && m.id <= maxKnownId)
                .map(m => m.id)
        );
        const freshAssistantMessages = displayMessages.filter(
            m => isGroupAssistantRevealMessage(m) && !knownIds.has(m.id) && m.id > maxKnownId
        );
        groupRevealKnownIdsRef.current = currentIds;

        setRevealedGroupAssistantIds(prev => {
            const next = new Set<number>();
            currentAssistantIds.forEach(id => {
                if (prev.has(id) || historyAssistantIds.has(id)) next.add(id);
            });
            return next;
        });

        if (!freshAssistantMessages.length) return;

        const now = Date.now();
        let nextRevealAt = Math.max(
            groupRevealNextAtRef.current,
            now + GROUP_ASSISTANT_REVEAL_FIRST_DELAY_MS,
        );
        freshAssistantMessages.forEach(msg => {
            nextRevealAt += groupAssistantRevealTypingMs(msg);
            const delay = Math.max(0, nextRevealAt - Date.now());
            const timer = setTimeout(() => {
                setRevealedGroupAssistantIds(prev => {
                    if (prev.has(msg.id)) return prev;
                    const next = new Set(prev);
                    next.add(msg.id);
                    return next;
                });
                if (!selectionMode) {
                    requestAnimationFrame(() => {
                        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
                    });
                }
            }, delay);
            groupRevealTimersRef.current.push(timer);
            nextRevealAt += groupAssistantRevealBetweenMs();
        });
        groupRevealNextAtRef.current = nextRevealAt;
    }, [displayMessages, selectionMode, clearGroupRevealTimers]);

    const renderMessages = useMemo(() => {
        if (selectionMode || highlightMsgId != null) return displayMessages;
        return displayMessages.filter(m => !isGroupAssistantRevealMessage(m) || revealedGroupAssistantIds.has(m.id));
    }, [displayMessages, revealedGroupAssistantIds, selectionMode, highlightMsgId]);

    // ── 群聊天记录查找 ───────────────────────────────────────────────
    /** 打开查找浮层：拉全量群消息做快照（聊天列表是分页的，搜索要搜全部） */
    const openSearch = async () => {
        if (!activeGroup) return;
        setSearchTerm('');
        setSearchAllMsgs(await DB.getGroupMessages(activeGroup.id));
        setSearchOpen(true);
    };
    const openSearchFromGroupSettings = async () => {
        setModalType('none');
        await openSearch();
    };

    /** 命中结果：只搜文本/系统通知（图片/红包等富媒体 content 是 base64/URL，搜了无意义）；最新在前 */
    const searchResults = useMemo(() => {
        const term = searchTerm.trim().toLowerCase();
        if (!term) return [] as Message[];
        return searchAllMsgs
            .filter(m => {
                if (typeof m.content !== 'string' || !m.content) return false;
                const isText = m.type === 'text';
                const isSystem = m.role === 'system' || m.type === 'system';
                if (!isText && !isSystem) return false;
                return m.content.toLowerCase().includes(term);
            })
            .slice()
            .reverse();
    }, [searchTerm, searchAllMsgs]);

    // ── @ 提及 ───────────────────────────────────────────────────────
    /** 本群所有可被 @ 的显示名（成员群名片/角色名 + 用户 + 全体别名）。稳定引用供气泡高亮。 */
    const mentionNames = useMemo(() => {
        if (!activeGroup) return [] as string[];
        const names = new Set<string>();
        names.add(activeGroup.memberNicknames?.['user'] || userProfile.name || '我');
        for (const mid of activeGroup.members) {
            const n = activeGroup.memberNicknames?.[mid] || characters.find(c => c.id === mid)?.name || '';
            if (n) names.add(n);
        }
        names.add('全体成员');
        names.add('所有人');
        return Array.from(names).filter(Boolean);
    }, [activeGroup, characters, userProfile]);

    /** 把 @名字 插入输入框（与前文留一个空格分隔） */
    const insertMention = (name: string) => {
        setInput(prev => {
            const sep = prev && !/[\s\n]$/.test(prev) ? ' ' : '';
            return `${prev}${sep}@${name} `;
        });
        setModalType('none');
    };

    /** 把命中消息高亮片段渲染出来（首个匹配处取一小段上下文，匹配词描黄） */
    const renderSnippet = (content: string, rawTerm: string): React.ReactNode => {
        const term = rawTerm.trim();
        if (!term) return content.slice(0, 60);
        const idx = content.toLowerCase().indexOf(term.toLowerCase());
        if (idx < 0) return content.slice(0, 60);
        const start = Math.max(0, idx - 12);
        const pre = (start > 0 ? '…' : '') + content.slice(start, idx);
        const match = content.slice(idx, idx + term.length);
        const postEnd = idx + term.length + 40;
        const post = content.slice(idx + term.length, postEnd) + (content.length > postEnd ? '…' : '');
        return <>{pre}<mark className="bg-[#fff4f7] text-[#5a3140] border border-[#eed6df] rounded px-0.5">{match}</mark>{post}</>;
    };

    /** 跳到某条命中消息：载入全量消息确保可见，关浮层并滚动+短暂高亮 */
    const jumpToMessage = async (msg: Message) => {
        if (!activeGroup || msg.id == null) return;
        const all = searchAllMsgs.length ? searchAllMsgs : await DB.getGroupMessages(activeGroup.id);
        jumpTargetRef.current = msg.id;
        setMessages(all);
        setVisibleCount(all.length);
        setSearchOpen(false);
        setHighlightMsgId(msg.id);
        setJumpNonce(n => n + 1);
        window.setTimeout(() => setHighlightMsgId(prev => (prev === msg.id ? null : prev)), 2600);
    };

    const loadMoreGroupHistory = async () => {
        if (!activeGroup || loadingGroupHistory) return;
        const groupId = activeGroup.id;
        const before = scrollRef.current
            ? { scrollHeight: scrollRef.current.scrollHeight, scrollTop: scrollRef.current.scrollTop }
            : null;
        setLoadingGroupHistory(true);
        try {
            const nextLimit = messages.length + GROUP_CHAT_LOAD_BATCH_SIZE;
            const { messages: moreMsgs, totalCount } = await DB.getRecentGroupMessagesWithCount(groupId, nextLimit);
            pendingHistoryScrollRestoreRef.current = moreMsgs.length > messages.length ? before : null;
            setMessages(moreMsgs);
            setTotalMsgCount(totalCount);
            setVisibleCount(moreMsgs.length);
        } catch (e: any) {
            pendingHistoryScrollRestoreRef.current = null;
            addToast(e?.message || '历史消息加载失败', 'error');
        } finally {
            setLoadingGroupHistory(false);
        }
    };

    const canReroll = useMemo(() => {
        if (isTyping || messages.length === 0) return false;
        const lastMsg = messages[messages.length - 1];
        return lastMsg.role === 'assistant';
    }, [isTyping, messages]);

    // --- Helpers ---

    const getTimeGapHint = (lastMsgTimestamp: number): string => {
        const now = Date.now();
        const diffHours = Math.floor((now - lastMsgTimestamp) / (1000 * 60 * 60));
        const diffMins = Math.floor((now - lastMsgTimestamp) / (1000 * 60));
        
        const currentHour = new Date().getHours();
        const isNight = currentHour >= 23 || currentHour <= 6;

        if (diffMins < 10) return '聊天正在火热进行中，大家都很活跃。';
        if (diffMins < 60) return `距离上次发言过了 ${diffMins} 分钟，话题可能有点冷场。`;
        if (diffHours < 12) return `距离上次发言过了 ${diffHours} 小时。${isNight ? '现在是深夜。' : ''}`;
        return `大家已经 ${diffHours} 小时没说话了，群里很安静。`;
    };

    // New: Calculate private chat gap
    const getPrivateTimeGap = async (charId: string): Promise<string> => {
        const msgs = await DB.getMessagesByCharId(charId);
        // DB.getMessagesByCharId already filters out group messages in its definition? 
        // Let's ensure we look at messages WITHOUT groupId
        const privateMsgs = msgs.filter(m => !m.groupId);
        if (privateMsgs.length === 0) return '从未私聊过';
        
        const lastMsg = privateMsgs[privateMsgs.length - 1];
        const now = Date.now();
        const diffMins = Math.floor((now - lastMsg.timestamp) / (1000 * 60));
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffMins < 60) return '刚刚才私聊过';
        if (diffHours < 24) return `${diffHours}小时前私聊过`;
        return `${diffDays}天前私聊过`;
    };

    // --- Helpers: 群名片 / 头衔 / 权限 / 禁言 / 系统通知 ---

    /** 成员在群里的显示名：群名片优先，否则角色名 */
    const displayNameOf = (g: GroupProfile | null, charId: string): string => {
        if (charId === 'user') return g?.memberNicknames?.['user'] || userProfile.name || '我';
        return g?.memberNicknames?.[charId] || characters.find(c => c.id === charId)?.name || '未知成员';
    };

    /** 用户是否群主（历史群没有 ownerId 字段时按用户是群主处理） */
    const isUserOwner = (g: GroupProfile | null): boolean => !g?.ownerId || g.ownerId === 'user';
    /** 用户是否有管理权限（群主或管理员） */
    const userCanManage = (g: GroupProfile | null): boolean => isUserOwner(g) || (g?.adminIds || []).includes('user');

    /** 成员是否处于禁言中 */
    const isMuted = (g: GroupProfile | null, charId: string): boolean => {
        const until = g?.mutedUntil?.[charId];
        return !!until && until > Date.now();
    };

    const buildGroupOpeningBubbles = useCallback((raw: string, group: GroupProfile): GroupOpeningBubble[] => {
        const fallbackId = group.members.find(id => characters.some(c => c.id === id)) || group.members[0] || 'system';
        const normalizeName = (value: string) => value.replace(/\s+/g, '').toLowerCase();
        const speakerByName = new Map<string, string>();
        group.members.forEach(memberId => {
            const member = characters.find(c => c.id === memberId);
            [
                displayNameOf(group, memberId),
                member?.name,
                group.memberNicknames?.[memberId],
            ].forEach(name => {
                const key = normalizeName(String(name || '').trim());
                if (key) speakerByName.set(key, memberId);
            });
        });

        const bubbles: GroupOpeningBubble[] = [];
        let currentSpeakerId = fallbackId;
        raw.replace(/\r\n/g, '\n').split('\n').forEach(line => {
            const match = line.match(/^([^:：]{1,32})[:：]\s*(.*)$/);
            const matchedSpeakerId = match ? speakerByName.get(normalizeName(match[1].trim())) : undefined;
            if (matchedSpeakerId) {
                currentSpeakerId = matchedSpeakerId;
                bubbles.push({ charId: currentSpeakerId, content: match?.[2] || '' });
                return;
            }
            if (bubbles.length === 0) {
                bubbles.push({ charId: currentSpeakerId, content: line });
                return;
            }
            bubbles[bubbles.length - 1].content += `${bubbles[bubbles.length - 1].content ? '\n' : ''}${line}`;
        });

        return bubbles
            .map(bubble => {
                const member = characters.find(c => c.id === bubble.charId);
                const speakerName = member ? displayNameOf(group, member.id) : group.name;
                const content = substituteMacros(
                    bubble.content
                        .replace(/{{group}}/gi, group.name)
                        .replace(/<group>/gi, group.name),
                    { charName: speakerName || group.name, userName: userProfile.name || '用户' },
                ).trim();
                return { ...bubble, content };
            })
            .filter(bubble => bubble.content);
    }, [characters, userProfile.name]);

    const groupOpeningOptions = useMemo(() => normalizeGroupOpeningGreetings(activeGroup?.openingGreetings), [activeGroup?.openingGreetings]);
    const groupOpeningPickerActive = !!activeGroup
        && view === 'chat'
        && !activeGroup.dissolved
        && totalMsgCount === 0
        && messages.length === 0
        && groupOpeningOptions.length > 0;
    const groupOpeningPreviewBubbles = useMemo(() => {
        if (!activeGroup || groupOpeningOptions.length === 0) return [] as GroupOpeningBubble[];
        const chosen = groupOpeningOptions[Math.min(groupOpeningIdx, groupOpeningOptions.length - 1)] || '';
        return buildGroupOpeningBubbles(chosen, activeGroup);
    }, [activeGroup, buildGroupOpeningBubbles, groupOpeningIdx, groupOpeningOptions]);
    const groupOpeningPickerRef = useRef({ active: false, idx: 0 });
    groupOpeningPickerRef.current = { active: groupOpeningPickerActive, idx: groupOpeningIdx };
    useEffect(() => {
        if (groupOpeningIdx >= groupOpeningOptions.length && groupOpeningOptions.length > 0) setGroupOpeningIdx(0);
    }, [groupOpeningIdx, groupOpeningOptions.length]);

    /** 往群里落一条系统通知（移除成员/改群名/改群名片/设头衔/禁言等），并刷新消息列表 */
    const postGroupNotice = async (groupId: string, text: string) => {
        await DB.saveMessage({
            charId: 'system',
            groupId,
            role: 'system',
            type: 'system',
            content: text,
        } as any);
        if (activeGroup?.id === groupId) {
            setMessages(await DB.getGroupMessages(groupId));
        }
    };

    const commitGroupOpeningGreeting = async (): Promise<Message[]> => {
        if (!activeGroup) return messages;
        const { active, idx } = groupOpeningPickerRef.current;
        if (!active) return messages;
        const options = normalizeGroupOpeningGreetings(activeGroup.openingGreetings);
        if (options.length === 0) return messages;
        const greetingIndex = Math.min(idx, options.length - 1);
        const bubbles = buildGroupOpeningBubbles(options[greetingIndex], activeGroup);
        if (bubbles.length === 0) return messages;
        const baseTs = Date.now();
        for (let i = 0; i < bubbles.length; i++) {
            const bubble = bubbles[i];
            await DB.saveMessage({
                charId: bubble.charId,
                groupId: activeGroup.id,
                role: bubble.charId === 'system' ? 'system' : 'assistant',
                type: bubble.charId === 'system' ? 'system' : 'text',
                content: bubble.content,
                timestamp: baseTs + i,
                metadata: {
                    groupOpeningGreeting: true,
                    greetingIndex,
                    greetingPart: i,
                    greetingParts: bubbles.length,
                },
            } as any);
        }
        const fresh = await DB.getGroupMessages(activeGroup.id);
        setMessages(fresh);
        setTotalMsgCount(fresh.length);
        setVisibleCount(Math.max(30, Math.min(fresh.length, 200)));
        setGroupOpeningIdx(0);
        return fresh;
    };

    /** 更新群并同步本地 activeGroup（updateGroup 只更新全局 groups state） */
    const applyGroupUpdate = async (updates: Partial<GroupProfile>): Promise<GroupProfile | null> => {
        if (!activeGroup) return null;
        const updated = await updateGroup(activeGroup.id, updates);
        if (updated) setActiveGroup(updated);
        return updated;
    };

    const saveOpeningGreetingsDraft = async (draft = tempOpeningGreetings): Promise<GroupProfile | null> => {
        const openingGreetings = normalizeGroupOpeningGreetings(draft);
        setTempOpeningGreetings(openingGreetings);
        setGroupOpeningIdx(0);
        return applyGroupUpdate({ openingGreetings: openingGreetings.length > 0 ? openingGreetings : undefined });
    };

    const saveGroupApiDraft = async (groupApiDraft = tempGroupApi, memberApisDraft = tempMemberApis) => {
        if (!activeGroup) return null;
        return applyGroupUpdate({
            groupApi: sanitizeGroupApi(groupApiDraft),
            memberApis: pruneGroupMemberApis(memberApisDraft, activeGroup.members),
        });
    };

    const groupApiModelTargetKey = (target: GroupApiModelTarget): string =>
        target.kind === 'group' ? 'group' : `member:${target.charId}`;

    const groupApiModelTargetLabel = (target: GroupApiModelTarget | null = groupApiModelTarget): string => {
        if (!target) return '群聊 API';
        return target.kind === 'group' ? '本群默认 API' : `${displayNameOf(activeGroup, target.charId)} 的 API`;
    };

    const groupApiDraftForTarget = (target: GroupApiModelTarget | null): GroupApiDraft => {
        if (!target) return emptyGroupApi();
        return target.kind === 'group'
            ? tempGroupApi
            : { ...emptyGroupApi(), ...(tempMemberApis[target.charId] || {}) };
    };

    const patchGroupApiModelForTarget = (target: GroupApiModelTarget, model: string) => {
        if (target.kind === 'group') {
            setTempGroupApi(prev => ({ ...prev, model }));
            return;
        }
        setTempMemberApis(prev => ({
            ...prev,
            [target.charId]: { ...emptyGroupApi(), ...(prev[target.charId] || {}), model },
        }));
    };

    const patchGroupApiForTarget = (target: GroupApiModelTarget, api: GroupApiDraft) => {
        const next = normalizeGroupApiDraft(api);
        if (target.kind === 'group') {
            setTempGroupApi(next);
            return;
        }
        setTempMemberApis(prev => ({
            ...prev,
            [target.charId]: next,
        }));
    };

    const loadApiPresetToGroupTarget = (target: GroupApiModelTarget, preset: typeof apiPresets[0]) => {
        patchGroupApiForTarget(target, {
            baseUrl: preset.config.baseUrl || '',
            apiKey: preset.config.apiKey || '',
            model: preset.config.model || '',
        });
        addToast(`已载入「${preset.name}」`, 'success');
    };

    const saveGroupApiPreset = (target: GroupApiModelTarget) => {
        const draft = groupApiDraftForTarget(target);
        const baseUrl = draft.baseUrl.trim();
        const model = draft.model.trim();
        if (!baseUrl || !model) {
            addToast('保存预设需要 Base URL 和模型名', 'info');
            return;
        }
        addApiPreset(groupApiModelTargetLabel(target), {
            baseUrl,
            apiKey: draft.apiKey.trim(),
            model,
        } as APIConfig);
        addToast(`${groupApiModelTargetLabel(target)} 已保存为预设`, 'success');
    };

    const openGroupApiModelPicker = (target: GroupApiModelTarget) => {
        setGroupApiModelTarget(target);
        setGroupApiModelFilter('');
    };

    const selectGroupApiModel = (model: string) => {
        if (!groupApiModelTarget) return;
        patchGroupApiModelForTarget(groupApiModelTarget, model);
        setGroupApiModelTarget(null);
        setGroupApiModelFilter('');
    };

    const saveGroupApiTarget = async (target: GroupApiModelTarget) => {
        const updated = await saveGroupApiDraft();
        if (updated) addToast(`${groupApiModelTargetLabel(target)} 已保存`, 'success');
    };

    const fetchGroupApiModels = async (target: GroupApiModelTarget) => {
        const draft = groupApiDraftForTarget(target);
        if (!draft.baseUrl.trim()) {
            addToast('请先填写 Base URL，再拉取模型', 'info');
            return;
        }
        const loadingKey = groupApiModelTargetKey(target);
        setGroupApiModelLoadingKey(loadingKey);
        try {
            const models = await fetchModelList({
                baseUrl: draft.baseUrl.trim(),
                apiKey: draft.apiKey.trim(),
            }, {
                meta: makeApiUsageMeta('chat.groupReply', {
                    apiRole: 'custom',
                    apiBinding: target.kind === 'group' ? 'Group default API' : 'Member dedicated API',
                }),
            });
            if (!models.length) {
                addToast('????????????????', 'info');
                return;
            }
            setAvailableModels(models);
            try { localStorage.setItem('os_available_models', JSON.stringify(models)); } catch { /* ignore */ }
            if (!models.includes(draft.model.trim())) patchGroupApiModelForTarget(target, models[0]);
            setGroupApiModelTarget(target);
            setGroupApiModelFilter('');
            addToast(`??? ${models.length} ???`, 'success');
        } catch (error: any) {
            addToast(`拉取模型失败：${error?.message || '请检查地址和密钥'}`, 'error');
        } finally {
            setGroupApiModelLoadingKey(null);
        }
    };

    const patchTempGroupApi = (field: keyof GroupApiDraft, value: string) => {
        setTempGroupApi(prev => ({ ...prev, [field]: value }));
    };

    const patchTempMemberApi = (charId: string, field: keyof GroupApiDraft, value: string) => {
        setTempMemberApis(prev => ({
            ...prev,
            [charId]: { ...emptyGroupApi(), ...(prev[charId] || {}), [field]: value },
        }));
    };

    const copyMainApiToGroup = () => {
        const next = normalizeGroupApiDraft(apiConfig);
        setTempGroupApi(next);
        void saveGroupApiDraft(next, tempMemberApis);
        addToast('已复制文具盒主 API 到本群默认', 'success');
    };

    const clearGroupApi = () => {
        const next = emptyGroupApi();
        setTempGroupApi(next);
        void saveGroupApiDraft(next, tempMemberApis);
    };

    const copyMainApiToMember = (charId: string) => {
        const nextApi = normalizeGroupApiDraft(apiConfig);
        const next = { ...tempMemberApis, [charId]: nextApi };
        setTempMemberApis(next);
        void saveGroupApiDraft(tempGroupApi, next);
        addToast(`已复制主 API 给 ${displayNameOf(activeGroup, charId)}`, 'success');
    };

    const clearMemberApi = (charId: string) => {
        const next = { ...tempMemberApis };
        delete next[charId];
        setTempMemberApis(next);
        void saveGroupApiDraft(tempGroupApi, next);
    };

    /** 打开某个角色的设置界面（深链接到神经链接 App 的编辑页）；返回键回到聊天列表而非桌面 */
    const openCharacterSettings = (charId: string) => {
        try {
            localStorage.setItem('moro_character_open_target', charId);
            localStorage.setItem('moro_character_return_app', AppID.GroupChat);
        } catch { /* ignore */ }
        openApp(AppID.Character);
    };

    /** 进入与某角色的私聊 */
    const openPrivateChat = (charId: string, messageId?: number) => {
        // 打开过私聊即让该角色固定进入「往来」会话列表（兼容历史角色：老数据首次打开后
        // 也会在往来出现），不必再走名册/添加好友。仅在未标记时写一次，避免重复落库。
        const target = characters.find(c => c.id === charId);
        if (target && !(target as any).addedToChat) {
            void updateCharacter(charId, { addedToChat: true } as any);
        }
        restoreConvoWindow('char', charId);
        clearUnread(charId);
        if (hasOfflineSession(charId)) {
            try { sessionStorage.setItem('moro_chat_resume_offline_char_id', charId); } catch { /* ignore */ }
        }
        if (typeof messageId === 'number') {
            try {
                sessionStorage.setItem('moro_chat_jump_to_message', JSON.stringify({ charId, messageId }));
            } catch { /* ignore */ }
        }
        setActiveCharacterId(charId);
        openApp(AppID.Chat);
    };

    /** 进入群聊：从名册打开时也会把被收起的往来窗口恢复回来 */
    const openGroupChat = (group: GroupProfile, messageId?: number) => {
        if (group.dissolved) {
            addToast('该群聊已被解散', 'info');
            setView('list');
            return;
        }
        restoreConvoWindow('group', group.id);
        try { localStorage.removeItem(`moro_group_unread_${group.id}`); } catch { /* ignore */ }
        setActiveGroup(group);
        setView('chat');
        setShowGroupOfflineMode(hasGroupOfflineSession(group.id));
        if (typeof messageId === 'number') {
            setHighlightMsgId(messageId);
            void DB.getGroupMessages(group.id).then(all => {
                jumpTargetRef.current = messageId;
                setMessages(all);
                setVisibleCount(all.length);
                setSearchAllMsgs(all);
                setJumpNonce(n => n + 1);
            }).catch(err => {
                console.warn('[GroupChat] jump to message failed', err);
                addToast('打开原消息失败，已进入群聊', 'info');
            });
            window.setTimeout(() => setHighlightMsgId(prev => (prev === messageId ? null : prev)), 2600);
        }
    };

    useEffect(() => {
        if (activeApp !== AppID.GroupChat) return;
        let resumeGroupId = '';
        try {
            resumeGroupId = sessionStorage.getItem('moro_chathub_resume_group_offline_id') || '';
        } catch { /* ignore */ }
        if (!resumeGroupId) return;
        const group = groups.find(item => item.id === resumeGroupId);
        if (!group && groups.length === 0) return;
        try { sessionStorage.removeItem('moro_chathub_resume_group_offline_id'); } catch { /* ignore */ }

        if (!group || group.dissolved) {
            if (suspendedOfflineSession?.kind === 'group' && suspendedOfflineSession.groupId === resumeGroupId) {
                clearSuspendedOfflineSession();
            }
            addToast('这场群聊线下现场已经不在了', 'info');
            return;
        }

        restoreConvoWindow('group', group.id);
        try { localStorage.removeItem(`moro_group_unread_${group.id}`); } catch { /* ignore */ }
        setActiveGroup(group);
        setView('chat');

        if (hasGroupOfflineSession(group.id)) {
            setShowGroupOfflineMode(true);
            if (suspendedOfflineSession?.kind === 'group' && suspendedOfflineSession.groupId === group.id) {
                clearSuspendedOfflineSession();
            }
        } else {
            setShowGroupOfflineMode(false);
            if (suspendedOfflineSession?.kind === 'group' && suspendedOfflineSession.groupId === group.id) {
                clearSuspendedOfflineSession();
            }
            addToast('这场群聊线下现场已经不在了', 'info');
        }
    }, [activeApp, groups, suspendedOfflineSession, clearSuspendedOfflineSession, addToast]);

    useEffect(() => {
        const handler = (e: Event) => {
            const info = (e as CustomEvent).detail as { kind?: string; groupId?: string };
            if (info?.kind !== 'group' || !info.groupId || activeApp !== AppID.GroupChat) return;
            try { sessionStorage.removeItem('moro_chathub_resume_group_offline_id'); } catch { /* ignore */ }
            const group = groups.find(item => item.id === info.groupId);

            if (!group || group.dissolved) {
                if (suspendedOfflineSession?.kind === 'group' && suspendedOfflineSession.groupId === info.groupId) {
                    clearSuspendedOfflineSession();
                }
                addToast('这场群聊线下现场已经不在了', 'info');
                return;
            }

            restoreConvoWindow('group', group.id);
            try { localStorage.removeItem(`moro_group_unread_${group.id}`); } catch { /* ignore */ }
            setActiveGroup(group);
            setView('chat');

            if (hasGroupOfflineSession(group.id)) {
                setShowGroupOfflineMode(true);
                if (suspendedOfflineSession?.kind === 'group' && suspendedOfflineSession.groupId === group.id) {
                    clearSuspendedOfflineSession();
                }
            } else {
                setShowGroupOfflineMode(false);
                if (suspendedOfflineSession?.kind === 'group' && suspendedOfflineSession.groupId === group.id) {
                    clearSuspendedOfflineSession();
                }
                addToast('这场群聊线下现场已经不在了', 'info');
            }
        };
        window.addEventListener('moro-offline-resume-request', handler);
        return () => window.removeEventListener('moro-offline-resume-request', handler);
    }, [activeApp, groups, suspendedOfflineSession, clearSuspendedOfflineSession, addToast]);

    const isSyncedAmbientPreview = (msg: Message, entryId: string): boolean => (
        msg.metadata?.source === 'ambient_social'
        && msg.metadata?.ambientEntryId === entryId
        && msg.metadata?.syncedFromPreview
    );

    const syncAmbientPrivatePreviewMessage = async (entry: AmbientSocialContact, charId: string): Promise<boolean> => {
        const content = entry.lastMessage.trim();
        if (!content) return false;
        const existing = await DB.getMessagesByCharId(charId, true);
        if (existing.some(msg => isSyncedAmbientPreview(msg, entry.id))) return false;
        await DB.saveMessage({
            charId,
            role: 'assistant',
            type: 'text',
            content,
            timestamp: entry.lastAt,
            metadata: {
                source: 'ambient_social',
                ambientEntryId: entry.id,
                ambientEntryName: entry.name,
                syncedFromPreview: true,
            },
        } as any);
        markUnread(charId, Math.max(1, entry.unread || 1));
        return true;
    };

    const splitAmbientGroupPreview = (raw: string): { speakerName?: string; content: string } => {
        const text = raw.trim();
        const match = text.match(/^([^:：]{1,24})[:：]\s*(.+)$/);
        if (!match) return { content: text };
        return { speakerName: match[1].trim(), content: match[2].trim() || text };
    };

    const syncAmbientGroupPreviewMessage = async (
        entry: Extract<AmbientSocialEntry, { kind: 'group' }>,
        group: GroupProfile,
        memberNameById = new Map<string, string>(),
    ): Promise<boolean> => {
        const parsed = splitAmbientGroupPreview(entry.lastMessage);
        if (!parsed.content) return false;
        const existing = await DB.getGroupMessages(group.id);
        if (existing.some(msg => isSyncedAmbientPreview(msg, entry.id))) return false;

        const normalizedSpeaker = parsed.speakerName?.trim();
        const speakerId = normalizedSpeaker
            ? group.members.find(mid => {
                const candidates = [
                    group.memberNicknames?.[mid],
                    memberNameById.get(mid),
                    mid === 'user' ? (userProfile.name || '我') : characters.find(c => c.id === mid)?.name,
                ].map(name => name?.trim()).filter((name): name is string => !!name);
                return candidates.includes(normalizedSpeaker);
            })
            : undefined;
        const fallbackId = group.members.find(mid => mid !== 'user') || group.members[0] || 'system';
        const charId = speakerId || fallbackId;

        await DB.saveMessage({
            charId,
            groupId: group.id,
            role: charId === 'system' ? 'system' : 'assistant',
            type: 'text',
            content: parsed.content,
            timestamp: entry.lastAt,
            metadata: {
                source: 'ambient_social',
                ambientEntryId: entry.id,
                ambientEntryName: entry.name,
                syncedFromPreview: true,
                rawPreview: entry.lastMessage,
                speakerName: normalizedSpeaker,
            },
        } as any);
        return true;
    };

    const openAmbientContact = async (entry: AmbientSocialContact) => {
        const ambientSocialSource = {
            entryId: entry.id,
            relation: entry.relation,
            relationLabel: entry.relationLabel,
        };
        const linkedChar = entry.linkedCharId ? characters.find(c => c.id === entry.linkedCharId) : undefined;
        if (linkedChar) {
            if (!linkedChar.ambientSocialSource?.entryId) {
                await updateCharacter(linkedChar.id, { ambientSocialSource } as Partial<CharacterProfile>);
            }
            await syncAmbientPrivatePreviewMessage(entry, linkedChar.id);
            saveAmbientSocialEntry(entry.id, { unread: 0 } as Partial<AmbientSocialEntry>);
            openPrivateChat(linkedChar.id);
            return;
        }
        const existing = characters.find(c => c.name === entry.name);
        const char = existing || ambientSocialToCharacter(entry, userProfile.name || '我');
        if (existing && !existing.ambientSocialSource?.entryId) {
            await updateCharacter(existing.id, { ambientSocialSource } as Partial<CharacterProfile>);
        }
        if (!existing) await importCharacter(char);
        await syncAmbientPrivatePreviewMessage(entry, char.id);
        saveAmbientSocialEntry(entry.id, { linkedCharId: char.id, unread: 0 } as Partial<AmbientSocialEntry>);
        addToast(`${entry.name} 已加入名册`, 'success');
        openPrivateChat(char.id);
    };

    const openAmbientGroup = async (entry: Extract<AmbientSocialEntry, { kind: 'group' }>) => {
        if (entry.linkedGroupId) {
            const existingGroup = visibleGroups.find(g => g.id === entry.linkedGroupId);
            if (existingGroup) {
                await syncAmbientGroupPreviewMessage(entry, existingGroup);
                saveAmbientSocialEntry(entry.id, { unread: 0 } as Partial<AmbientSocialEntry>);
                openGroupChat(existingGroup);
                return;
            }
        }
        const memberIds: string[] = [];
        const memberNameById = new Map<string, string>();
        for (const name of entry.memberNames.slice(0, 5)) {
            const existing = characters.find(c => c.name === name);
            if (existing) {
                memberIds.push(existing.id);
                memberNameById.set(existing.id, existing.name);
                continue;
            }
            const shadowContact: AmbientSocialContact = {
                id: `${entry.id}-${name}`,
                kind: 'contact',
                name,
                relation: 'friend',
                relationLabel: '熟人',
                avatar: entry.avatar,
                note: `和${entry.name}有关的人，有自己的日常和社交节奏。`,
                lastMessage: entry.lastMessage,
                lastAt: entry.lastAt,
                createdAt: entry.createdAt,
            };
            const char = ambientSocialToCharacter(shadowContact, userProfile.name || '我');
            await importCharacter(char);
            memberIds.push(char.id);
            memberNameById.set(char.id, char.name);
        }
        if (memberIds.length < 2) {
            addToast('这个群暂时还凑不齐人', 'info');
            return;
        }
        const group = await createGroup(entry.name, memberIds, {
            ownerId: 'user',
            ambientSocialSource: {
                entryId: entry.id,
                relation: entry.relation,
                relationLabel: entry.relationLabel,
            },
        });
        await syncAmbientGroupPreviewMessage(entry, group, memberNameById);
        saveAmbientSocialEntry(entry.id, { linkedGroupId: group.id, unread: 0 } as Partial<AmbientSocialEntry>);
        await postGroupNotice(group.id, `你把「${entry.name}」接进了絮语`);
        addToast(`${entry.name} 已加入群聊`, 'success');
        openGroupChat(group);
    };

    const openAmbientEntry = (entry?: AmbientSocialEntry) => {
        if (!entry) return;
        if (entry.kind === 'contact') void openAmbientContact(entry);
        else void openAmbientGroup(entry);
    };

    const isConvoPreviewMessage = (m?: Message): m is Message => (
        !!m && !m.metadata?.hidden && !m.metadata?.proactiveHint
    );

    // --- 聊天列表（单聊 + 群聊混排）---
    useEffect(() => {
        if (view !== 'list') return;
        let cancelled = false;
        (async () => {
            const items: typeof convos = [];
            for (const g of visibleGroups) {
                const { messages: recent } = await DB.getRecentGroupMessagesWithCount(g.id, 50);
                const lastMsg = [...recent].reverse().find(isConvoPreviewMessage);
                if (isConvoWindowHidden('group', g.id, lastMsg?.timestamp || 0)) continue;
                items.push({
                    kind: 'group', id: g.id, name: g.name, avatar: g.avatar,
                    last: lastMsg,
                    dissolved: !!g.dissolved,
                    memberCount: g.members.length,
                    starred: !!g.pinned,
                    specialCareCount: (g.specialCareMemberIds || []).length,
                });
            }
            // 「此刻」状态新鲜度：最近一条线下生活事件在这个时长内才显示（再久就不算「此刻」了）
            const LIFE_STATUS_FRESH_MS = 5 * 60 * 60 * 1000; // 5 小时
            const nowTs = Date.now();
            for (const c of characters) {
                if (ambientSocialHideConverted && isAmbientSocialCharacterForUser(c)) continue;
                const { messages: recentMsgs } = await DB.getRecentMessagesWithCount(c.id, 50);
                const visibleMsgs = recentMsgs.filter(isConvoPreviewMessage);
                // 没聊过、且未加入往来的角色去「名册」页找；新建/导入或打开过私聊的角色
                // （addedToChat）即使还没说过话也直接出现在往来，省去「先添加好友」一步
                if (visibleMsgs.length === 0 && !(c as any).addedToChat) continue;
                const lastMsg = visibleMsgs[visibleMsgs.length - 1];
                if (isConvoWindowHidden('char', c.id, lastMsg?.timestamp || 0)) continue;
                // 角色开了自主生活：把 TA「此刻」正在过的日子（最近一条生活事件，够新）带进列表
                let lifeStatus: { activity: string; mood?: string; eventKind?: string; surfacedAsMsg?: boolean } | undefined;
                if (isAutonomousLifeEnabled(c)) {
                    try {
                        const ev = (await DB.getLifeEvents(c.id, 1))[0];
                        if (ev && nowTs - ev.timestamp <= LIFE_STATUS_FRESH_MS) {
                            const activity = sanitizeLifeText(ev.activity);
                            if (activity) lifeStatus = {
                                activity,
                                mood: ev.mood ? sanitizeLifeText(ev.mood) : undefined,
                                eventKind: ev.eventKind,
                                surfacedAsMsg: !!ev.surfacedAsMsg,
                            };
                        }
                    } catch { /* 生活状态只是锦上添花，取不到就不显示 */ }
                }
                // 会话设置「备注名 / 会话头像」覆盖列表展示
                items.push({
                    kind: 'char', id: c.id,
                    name: c.convoSettings?.remarkName?.trim() || c.name,
                    avatar: c.convoSettings?.charAvatarOverride || c.avatar,
                    last: lastMsg,
                    starred: !!c.starredFriend,
                    lifeStatus,
                });
            }
            for (const entry of ambientEntries) {
                const linked = entry.kind === 'contact'
                    ? !!entry.linkedCharId
                    : !!entry.linkedGroupId;
                if (entry.hidden || linked) continue;
                if (isConvoWindowHidden('ambient', entry.id, entry.lastAt)) continue;
                items.push({
                    kind: 'ambient',
                    id: entry.id,
                    name: entry.name,
                    avatar: entry.avatar,
                    ambient: entry,
                    memberCount: entry.kind === 'group' ? entry.memberNames.length : undefined,
                    starred: !!entry.pinned,
                    last: {
                        id: 0,
                        charId: entry.id,
                        role: 'assistant',
                        type: 'text',
                        content: entry.lastMessage,
                        timestamp: entry.lastAt,
                        metadata: { source: 'ambient_social' },
                    },
                });
            }
            // 星标置顶：先按星标（星标的排前面），同组内再按最后一条消息时间倒序。
            items.sort((a, b) => {
                if (!!a.starred !== !!b.starred) return a.starred ? -1 : 1;
                return (b.last?.timestamp || 0) - (a.last?.timestamp || 0);
            });
            if (!cancelled) setConvos(items);
        })();
        return () => { cancelled = true; };
    }, [view, visibleGroups, characters, ambientEntries, ambientSocialEnabled, ambientSocialHideConverted, isAmbientSocialCharacterForUser, hiddenConvoWindows, convoRefreshTick]);

    /** 聊天列表里一条消息的预览文本 */
    const previewOf = (m?: Message): string => {
        if (!m) return '还没说过话';
        switch (m.type) {
            case 'image': return '[一张相片]';
            case 'emoji': return '[一枚贴纸]';
            case 'transfer': return (m.metadata as any)?.kind === 'collect' ? '[群收款]' : '[一点心意]';
            case 'poll_card': return '[群投票]';
            case 'relay_card': return '[接龙]';
            case 'checkin_card': return '[群签到]';
            case 'voice': return '[一段留声]';
            case 'interaction': return m.content || '[碰了碰]';
            case 'social_card': return '[转发的此刻]';
            case 'forum_card': return '[茶话亭帖子]';
            case 'system': return m.content;
            default: {
                const t = typeof m.content === 'string' ? m.content : '';
                return /^(data:|https?:\/\/)/i.test(t.trim()) ? '[一份附件]' : t.slice(0, 40);
            }
        }
    };

    const closeUnblockAppealModal = () => {
        if (unblockAppealBusy) return;
        setUnblockAppealTarget(null);
        setUnblockAppealReply('');
    };

    const handleManualUnblockFromContacts = async (char: CharacterProfile) => {
        await unblockCharacterByUser({ char, updateCharacter, handledFrom: 'manual', clearUnread });
        setPendingUnblockAppeals(prev => prev.filter(item => item.charId !== char.id));
        setConvoRefreshTick(t => t + 1);
        addToast(`已将 ${char.name} 移出黑名单`, 'success');
    };

    const handleBulkUnblock = async () => {
        if (bulkUnblockBusy || blacklistedCharacters.length === 0) return;
        setBulkUnblockBusy(true);
        try {
            const result = await unblockCharactersByUser({
                chars: blacklistedCharacters,
                updateCharacter,
                clearUnread,
            });
            setPendingUnblockAppeals(prev => prev.filter(item => !blacklistedCharacters.some(c => c.id === item.charId)));
            setConvoRefreshTick(t => t + 1);
            addToast(`已解除 ${result.count} 位黑名单角色`, 'success');
        } catch (err: any) {
            console.warn('[ChatHub] bulk unblock failed', err);
            addToast(`批量解除失败：${err?.message || err}`, 'error');
        } finally {
            setBulkUnblockBusy(false);
        }
    };

    const handleUnblockAppealDecision = async (decision: UnblockAppealDecision) => {
        if (!unblockAppealTarget || unblockAppealBusy) return;
        const char = charactersRef.current.find(c => c.id === unblockAppealTarget.charId);
        if (!char) {
            addToast('这条验证申请对应的角色不存在了', 'error');
            setUnblockAppealTarget(null);
            return;
        }
        setUnblockAppealBusy(decision);
        try {
            await resolveUnblockAppealDecision({
                char,
                message: unblockAppealTarget.message,
                decision,
                replyText: unblockAppealReply,
                handledFrom: 'contacts',
                updateCharacter,
                clearUnread,
            });

            if (decision === 'accept') {
                addToast(`已通过 ${char.name} 的解除拉黑申请`, 'success');
            } else {
                addToast('已回复。对方可能过会儿还会再来申请', 'info');
            }

            setPendingUnblockAppeals(prev => prev.filter(item => item.message.id !== unblockAppealTarget.message.id));
            setUnblockAppealTarget(null);
            setUnblockAppealReply('');
            setConvoRefreshTick(t => t + 1);
        } catch (err: any) {
            console.warn('[ChatHub] resolve unblock appeal failed', err);
            addToast(`处理验证申请失败：${err?.message || err}`, 'error');
        } finally {
            setUnblockAppealBusy(null);
        }
    };

    // --- Logic: Selection & Deletion ---

    const handleMessageLongPress = (id: number) => {
        const msg = messages.find(m => m.id === id);
        if (msg) {
            setSelectedMessage(msg);
            setModalType('message-options');
        }
        setShowActions(false);
        setShowEmojiPicker(false);
    };

    const handleCopyMessage = () => {
        if (!selectedMessage) return;
        navigator.clipboard.writeText(selectedMessage.content);
        setModalType('none');
        setSelectedMessage(null);
        addToast('已复制到剪贴板', 'success');
    };

    const handleAddGroupMessageToDashboard = async () => {
        if (!selectedMessage || !activeGroup) return;
        try {
            await createMessageFollowup({
                message: selectedMessage,
                targetKind: 'group',
                targetId: activeGroup.id,
                targetName: activeGroup.name,
            });
            addToast('已记到絮语总览', 'success');
        } catch (err) {
            console.warn('[ChatHub] add group message to dashboard failed', err);
            addToast('记到总览失败', 'error');
        } finally {
            setModalType('none');
            setSelectedMessage(null);
        }
    };

    const handleEnterSelectionMode = () => {
        if (selectedMessage) {
            setSelectedMsgIds(new Set([selectedMessage.id]));
            setSelectionMode(true);
            setModalType('none');
            setSelectedMessage(null);
        }
    };

    // 撤回群消息（QQ/微信语义）：原文存进 metadata 供「重新编辑」，气泡变成"X撤回了一条消息"，
    // 群上下文里成员只看到"撤回了一条消息"（看不到原文）。
    const handleRecallMessage = async () => {
        if (!selectedMessage) return;
        const target = selectedMessage;
        const original = target.content;
        const recalledAt = Date.now();
        await DB.updateMessageMetadata(target.id, (prev: any) => ({ ...(prev || {}), recalled: true, recalledContent: original, recalledAt }));
        setMessages(prev => prev.map(m => m.id === target.id
            ? { ...m, metadata: { ...(m.metadata || {}), recalled: true, recalledContent: original, recalledAt } }
            : m));
        setModalType('none');
        setSelectedMessage(null);
        addToast('已撤回', 'success');
    };

    // 「重新编辑」：把撤回的原文还原回输入框（微信式）。已有内容则换行追加。
    const handleReeditRecalled = useCallback((m: Message) => {
        const text = ((m.metadata as any)?.recalledContent ?? '').toString();
        if (!text) return;
        setInput(prev => (prev.trim() ? `${prev}\n${text}` : text));
        addToast('已还原到输入框', 'info');
    }, []);

    // 表情回应（QQ/微信 tap-to-react）：切换 'user' 对群消息某表情的回应，落 metadata.reactions。
    const reactToMessage = useCallback(async (target: Message, emoji: string) => {
        if (!target) return;
        const next = toggleReaction(target.metadata?.reactions, emoji, 'user');
        await DB.updateMessageMetadata(target.id, (prev: any) => ({ ...(prev || {}), reactions: next }));
        setMessages(prev => prev.map(m => m.id === target.id ? { ...m, metadata: { ...(m.metadata || {}), reactions: next } } : m));
    }, []);
    const handleReactToggle = useCallback((m: Message, emoji: string) => { void reactToMessage(m, emoji); }, [reactToMessage]);
    const handleReactMessage = (emoji: string) => {
        if (!selectedMessage) return;
        void reactToMessage(selectedMessage, emoji);
        setModalType('none');
        setSelectedMessage(null);
    };

    // 群·单条转发：把这一条群消息转给某个角色的私聊（复用单聊 chat_forward 卡片格式）。
    const handleForwardGroupMessage = async (targetCharId: string) => {
        const msg = selectedMessage;
        if (!msg) return;
        const senderName = msg.role === 'user' ? (userProfile.name || '我') : (characters.find(c => c.id === msg.charId)?.name || '成员');
        const text = msg.type === 'text' ? String(msg.content || '').slice(0, 60)
            : `[${msg.type === 'image' ? '图片' : msg.type === 'emoji' ? '表情' : msg.type === 'voice' ? '语音' : msg.type}]`;
        const forwardData = {
            fromUserName: userProfile.name,
            fromCharName: activeGroup?.name || '群聊',
            count: 1,
            preview: [`${senderName}: ${text}`],
            messages: [{ role: msg.role, type: msg.type, content: msg.content, timestamp: msg.timestamp || Date.now() }],
        };
        await DB.saveMessage({ charId: targetCharId, role: 'user', type: 'chat_forward' as MessageType, content: JSON.stringify(forwardData) });
        const targetName = characters.find(c => c.id === targetCharId)?.name || '';
        addToast(`已转发给 ${targetName}`, 'success');
        setModalType('none');
        setSelectedMessage(null);
    };

    const handleDeleteSingleMessage = async () => {
        if (!selectedMessage) return;
        await DB.deleteMessage(selectedMessage.id);
        setMessages(prev => prev.filter(m => m.id !== selectedMessage.id));
        setModalType('none');
        setSelectedMessage(null);
        addToast('消息已删除', 'success');
    };

    const handleStartEditMessage = () => {
        if (!selectedMessage) return;
        setEditContent(selectedMessage.content);
        setModalType('edit-message');
    };

    const confirmEditMessage = async () => {
        if (!selectedMessage) return;
        await DB.updateMessage(selectedMessage.id, editContent);
        setMessages(prev => prev.map(m => m.id === selectedMessage.id ? { ...m, content: editContent } : m));
        setModalType('none');
        setSelectedMessage(null);
        addToast('消息已修改', 'success');
    };

    const toggleMessageSelection = (id: number) => {
        const next = new Set(selectedMsgIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedMsgIds(next);
    };

    const deleteSelectedMessages = async () => {
        if (selectedMsgIds.size === 0) return;
        await DB.deleteMessages(Array.from(selectedMsgIds));
        setMessages(prev => prev.filter(m => !selectedMsgIds.has(m.id)));
        setSelectionMode(false);
        setSelectedMsgIds(new Set());
        addToast(`已删除 ${selectedMsgIds.size} 条消息`, 'success');
    };

    const handleReroll = async () => {
        if (!canReroll) return;
        
        const lastMsg = messages[messages.length - 1];
        if (lastMsg.role !== 'assistant') return;

        // Find all contiguous assistant messages at the end
        const toDeleteIds: number[] = [];
        let index = messages.length - 1;
        while (index >= 0 && messages[index].role === 'assistant') {
            toDeleteIds.push(messages[index].id);
            index--;
        }

        if (toDeleteIds.length === 0) return;

        await DB.deleteMessages(toDeleteIds);
        const newHistory = messages.slice(0, index + 1);
        setMessages(newHistory);
        addToast('回溯对话中...', 'info');

        triggerDirector(newHistory);
    };

    // --- Logic: Group Management ---

    const handleCreateGroup = () => {
        if (!tempGroupName.trim() || selectedMembers.size < 2) {
            addToast('请输入群名并至少选择2名成员', 'error');
            return;
        }
        // 群主天然有管理员权限，不重复写进 adminIds
        const admins = Array.from(tempAdminIds).filter(id => id !== tempOwnerId && selectedMembers.has(id));
        createGroup(tempGroupName, Array.from(selectedMembers), {
            ownerId: tempOwnerId === 'user' || selectedMembers.has(tempOwnerId) ? tempOwnerId : 'user',
            adminIds: admins,
        });
        setModalType('none');
        setTempGroupName('');
        setSelectedMembers(new Set());
        setTempOwnerId('user');
        setTempAdminIds(new Set());
        addToast('群聊已创建', 'success');
    };

    const saveGroupSettingsDraft = async (options: { close?: boolean; toast?: boolean } = {}) => {
        if (!activeGroup) return;
        const newName = (tempGroupName || activeGroup.name).trim();
        const oldName = activeGroup.name;
        const oldMyNickname = activeGroup.memberNicknames?.['user'] || '';
        const newMyNickname = tempMyNickname.trim();
        const oldArchiveTitle = activeGroup.chatArchiveTitle || activeGroup.name;
        const newArchiveTitle = (tempArchiveTitle || newName).trim().slice(0, 80);
        const specialCareMemberIds = Array.from(tempSpecialCareIds).filter(id => activeGroup.members.includes(id));
        const nextChatArchives = activeGroup.activeChatRecordId && activeGroup.chatArchives?.length
            ? activeGroup.chatArchives.map(record => record.id === activeGroup.activeChatRecordId
                ? { ...record, title: newArchiveTitle, updatedAt: Date.now() }
                : record)
            : activeGroup.chatArchives;

        const updates: Partial<GroupProfile> = {
            name: newName,
            privateContextCap: tempPrivateContextCap,
            memberNicknames: { ...(activeGroup.memberNicknames || {}), user: newMyNickname },
            chatArchiveTitle: newArchiveTitle,
            chatArchives: nextChatArchives,
            specialCareMemberIds,
            specialCareNotify: tempSpecialCareNotify,
            replyIndividually: tempReplyIndividually,
            liveChatOverride: tempLiveChatOverride === 'inherit' ? undefined : tempLiveChatOverride,
            convoSettings: {
                ...(activeGroup.convoSettings || {}),
                ...normalizeGroupConvoPatch(tempGroupConvo),
                liveChatOverride: tempLiveChatOverride === 'inherit' ? undefined : tempLiveChatOverride,
            },
            groupApi: sanitizeGroupApi(tempGroupApi),
            memberApis: pruneGroupMemberApis(tempMemberApis, activeGroup.members),
            autoContinueEnabled: tempAutoContinueEnabled,
            autoContinueRounds: Math.max(1, Math.min(8, tempAutoContinueRounds || 2)),
            openingGreetings: normalizeGroupOpeningGreetings(tempOpeningGreetings),
        };
        if (!updates.openingGreetings?.length) updates.openingGreetings = undefined;
        if (!newMyNickname) delete updates.memberNicknames!['user'];
        const updatedGroup = await applyGroupUpdate(updates);
        if (!updatedGroup) return;
        if (options.close) setModalType('none');

        // 群内系统通知：角色下一轮能从历史里"看到"这些变化
        if (newName !== oldName) {
            await postGroupNotice(activeGroup.id, `你将群名称修改为「${newName}」`);
        }
        if (newMyNickname !== oldMyNickname) {
            await postGroupNotice(activeGroup.id, newMyNickname ? `你将自己的群名片改为「${newMyNickname}」` : '你清除了自己的群名片');
        }
        if (newArchiveTitle !== oldArchiveTitle) {
            await postGroupNotice(activeGroup.id, `你将这份群聊记录标题改为「${newArchiveTitle}」`);
        }
        if (options.toast) addToast('群信息已更新', 'success');
        return updatedGroup;
    };
    const handleUpdateGroupInfo = async () => { await saveGroupSettingsDraft({ close: true, toast: true }); };

    const saveGroupConvoDraft = async (patch: Partial<GroupConvoSettings>) => {
        if (!activeGroup) return null;
        const normalizedPatch = normalizeGroupConvoPatch(patch);
        const nextConvo = {
            ...resolveGroupConvo(activeGroup),
            ...tempGroupConvo,
            ...normalizedPatch,
        };
        if (normalizedPatch.liveChatOverride === undefined && 'liveChatOverride' in normalizedPatch) {
            delete nextConvo.liveChatOverride;
        }
        if (typeof nextConvo.contextLimit === 'number') {
            nextConvo.contextLimit = Math.max(20, Math.min(5000, Math.round(nextConvo.contextLimit)));
            setContextLimit(nextConvo.contextLimit);
        }
        setTempGroupConvo(nextConvo);
        const nextLiveOverride = nextConvo.liveChatOverride || 'inherit';
        setTempLiveChatOverride(nextLiveOverride);
        return applyGroupUpdate({
            liveChatOverride: nextLiveOverride === 'inherit' ? undefined : nextLiveOverride,
            convoSettings: {
                ...(activeGroup.convoSettings || {}),
                ...nextConvo,
                liveChatOverride: nextLiveOverride === 'inherit' ? undefined : nextLiveOverride,
            },
        });
    };

    const updateMemberLensDraft = (viewerId: string, targetId: string, value: string) => {
        if (!activeGroup) return;
        setTempMemberLenses(prev => {
            const next: GroupMemberLensDraft = { ...prev, [viewerId]: { ...(prev[viewerId] || {}) } };
            const clean = value.slice(0, 500);
            if (clean.trim()) next[viewerId][targetId] = clean;
            else delete next[viewerId][targetId];
            if (Object.keys(next[viewerId]).length === 0) delete next[viewerId];
            return next;
        });
    };

    const saveMemberLensesDraft = async () => {
        if (!activeGroup) return null;
        const memberLenses = pruneGroupMemberLenses(tempMemberLenses, activeGroup.members);
        setTempMemberLenses(memberLenses);
        return applyGroupUpdate({ memberLenses });
    };

    const generateGroupInnerVoice = async () => {
        if (!activeGroup || groupInnerVoiceLoading) return;
        const groupConvo = resolveGroupConvo(activeGroup);
        if (groupConvo.innerVoiceEnabled === false) {
            addToast('本群已关闭偷听小心思', 'info');
            return;
        }
        const targetId = groupInnerVoiceTargetId || activeGroup.members[0];
        const target = characters.find(c => c.id === targetId);
        if (!target) {
            addToast('先选一位群成员', 'info');
            return;
        }
        const innerVoiceApi = resolveAuxApi(auxApiConfig, apiConfig);
        if (!innerVoiceApi.baseUrl?.trim() || !innerVoiceApi.model?.trim()) {
            addToast('请先在「文具盒」里配置 API', 'error');
            return;
        }
        setGroupInnerVoiceLoading(true);
        try {
            try { await injectMemoryPalace(target); } catch { /* optional */ }
            const context = ContextBuilder.buildCoreContext(target, userProfile, true);
            const roster = activeGroup.members
                .map(id => {
                    const member = characters.find(c => c.id === id);
                    return member ? `- ${formatCharacterWithId(member, displayNameOf(activeGroup, id))}` : '';
                })
                .filter(Boolean)
                .join('\n');
            const recent = messages
                .filter(m => m.type === 'text' || m.type === 'system' || m.type === 'emoji')
                .slice(-30)
                .map(m => {
                    const who = m.role === 'user'
                        ? displayNameOf(activeGroup, 'user')
                        : (m.role === 'system' ? '系统通知' : displayNameOf(activeGroup, m.charId));
                    const text = m.type === 'emoji' ? '[表情包]' : String(m.content || '').replace(/\s+/g, ' ').slice(0, 220);
                    return `${who}: ${text}`;
                })
                .join('\n');
            const rel = target.relationship;
            const fullPrompt = `${context}

你正在生成群聊里的「偷听小心思」。这段内容只给用户看，会保存到心声历史，但绝对不会写入群聊消息，也不会进入后续聊天上下文。

当前群：${activeGroup.name}
群成员花名册：
${roster || '暂无'}

最近群聊片段：
${recent || '暂无'}

请只写 ${displayNameOf(activeGroup, target.id)} 此刻没有说出口的一小段内心话，80 字以内，贴近 TA 的人设、关系和刚刚的群聊现场。不要解释任务，不要写 JSON，不要替其他成员说话。

${innerVoicePromptBody({
                charName: target.name,
                recent,
                currentAffection: typeof target.affection === 'number' ? Math.round(target.affection) : null,
                relLine: rel ? `你和用户当前的关系是「${rel.label}」（${rel.stage}）。` : '你和用户还没有明确的关系定位。',
                curStage: rel?.stage || 'friend',
                curLabel: rel?.label || '朋友',
            })}`;
            const data = await callChatCompletion(innerVoiceApi, {
                model: innerVoiceApi.model,
                messages: [{ role: 'user', content: fullPrompt }],
                temperature: 0.85,
                max_tokens: 600,
            }, {
                meta: makeApiUsageMeta('chat.coupleSpace.innerVoice', {
                    charId: target.id,
                    charName: target.name,
                    apiRole: innerVoiceApi.apiRole || 'aux',
                    apiBinding: `Group inner voice · ${activeGroup.name}`,
                }),
            });
            const raw = (extractContent(data) || '').trim();
            const content = raw
                .replace(/```(?:json)?/gi, '')
                .replace(/```/g, '')
                .replace(/^["'“”]+|["'“”]+$/g, '')
                .trim();
            if (!content) throw new Error('empty inner voice');
            const entry: InnerVoiceEntry = {
                id: `ivg-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
                charId: target.id,
                content,
                timestamp: Date.now(),
                groupId: activeGroup.id,
                groupName: activeGroup.name,
            };
            await DB.saveInnerVoice(entry);
            setGroupInnerVoicePeek({
                charId: target.id,
                charName: displayNameOf(activeGroup, target.id),
                content,
                timestamp: entry.timestamp,
            });
            addToast('小心思生成好了', 'success');
        } catch (err) {
            console.warn('[GroupInnerVoice] generate failed', err);
            addToast('偷听失败，请稍后再试', 'error');
        } finally {
            setGroupInnerVoiceLoading(false);
        }
    };

    const buildMemberLensGenerationPrompt = (group: GroupProfile, viewer: CharacterProfile, targets: CharacterProfile[]): string => {
        const clip = (value: unknown, max = 700) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
        const charBrief = (char: CharacterProfile) => [
            `- id: ${char.id}`,
            `  群内称呼: ${displayNameOf(group, char.id)}`,
            `  身份锚: ${formatCharacterWithId(char, displayNameOf(group, char.id))}`,
            char.description ? `  简介: ${clip(char.description, 260)}` : '',
            char.systemPrompt ? `  人设: ${clip(char.systemPrompt, 900)}` : '',
            char.worldview ? `  世界观: ${clip(char.worldview, 500)}` : '',
            char.relationship?.label ? `  和用户关系: ${char.relationship.label}` : '',
        ].filter(Boolean).join('\n');
        const recentLines = messages
            .filter(m => m.type === 'text' || m.type === 'system')
            .slice(-24)
            .map(m => {
                const sender = m.role === 'user'
                    ? displayNameOf(group, 'user')
                    : (m.role === 'system' ? '系统通知' : displayNameOf(group, m.charId));
                return `${sender}: ${clip(m.content, 180)}`;
            })
            .filter(Boolean)
            .join('\n');
        const existing = tempMemberLenses[viewer.id] || {};
        const existingLines = Object.entries(existing)
            .map(([targetId, text]) => `- ${displayNameOf(group, viewer.id)} 眼里的 ${displayNameOf(group, targetId)}: ${text}`)
            .join('\n');
        const outputShape = JSON.stringify(Object.fromEntries(targets.map(target => [
            target.id,
            `${displayNameOf(group, viewer.id)}眼里的${displayNameOf(group, target.id)}关系备注`,
        ])));

        return `你是 Moro 群聊的「角色关系视角」补写助手。请为当前群聊补写私密关系备注。

这些备注只给某个角色自己发言时参考，不是群公告，不会进入聊天记录。请写成该角色的主观视角：TA 眼里的对方是谁、熟不熟、亲近/防备/竞争/亏欠/旧账/暧昧等关系温度。资料不足时可以保守推断，但不要写成绝对事实。

群聊：${group.name}
用户：${userProfile.name || '用户'}
当前视角角色：${displayNameOf(group, viewer.id)}（id: ${viewer.id}）

群成员资料：
${[viewer, ...targets].map(charBrief).join('\n\n')}

当前已写备注（可参考，不要照抄成公告）：
${existingLines || '暂无'}

最近群聊片段：
${recentLines || '暂无'}

要求：
- 只输出 JSON，不要 Markdown，不要解释。
- JSON 的 key 必须使用目标角色 id，value 是 1-2 句中文备注，每条不超过 120 字。
- 不要写「我是 AI」「系统提示」之类元叙事。
- 不要把双方关系写成所有人都知道的公共设定，要带一点当前视角角色的偏见、熟稔度或边界感。

输出格式示例：
${outputShape}`;
    };

    const generateMemberLensDrafts = async (viewer: CharacterProfile, targets: CharacterProfile[]) => {
        if (!activeGroup || !targets.length) return;
        const group = activeGroup;
        const targetIds = targets.map(target => target.id);
        const key = targets.length === 1 ? `${viewer.id}:${targets[0].id}` : `${viewer.id}:all`;
        const api = resolveAuxApi(auxApiConfig, apiConfig);
        if (!api.baseUrl?.trim() || !api.model?.trim()) {
            addToast('请先在「文具盒」里配置 API', 'error');
            return;
        }
        setMemberLensGeneratingKey(key);
        try {
            const raw = await llmComplete(
                api,
                [{ role: 'user', content: buildMemberLensGenerationPrompt(group, viewer, targets) }],
                { temperature: 0.68, maxTokens: Math.min(2600, 650 + targets.length * 280) },
            );
            const generated = parseGeneratedMemberLensMap(raw, targetIds);
            const entries = Object.entries(generated).filter(([, text]) => text.trim());
            if (!entries.length) throw new Error('empty lens generation');
            setTempMemberLenses(prev => {
                const next: GroupMemberLensDraft = { ...prev, [viewer.id]: { ...(prev[viewer.id] || {}) } };
                entries.forEach(([targetId, text]) => {
                    next[viewer.id][targetId] = text;
                });
                return pruneGroupMemberLenses(next, group.members);
            });
            addToast(targets.length === 1 ? '已生成关系草稿，可继续修改' : `已补全 ${entries.length} 条关系草稿，可继续修改`, 'success');
        } catch (err) {
            console.warn('[GroupMemberLens] generate failed', err);
            addToast('关系生成失败，请稍后再试', 'error');
        } finally {
            setMemberLensGeneratingKey(null);
        }
    };

    const handleToggleGroupPinned = async () => {
        if (!activeGroup) return;
        const next = !activeGroup.pinned;
        const updated = await applyGroupUpdate({ pinned: next });
        if (updated) addToast(next ? '群聊已置顶' : '已取消置顶', 'success');
    };

    const memberNameMapFor = (group: GroupProfile): Record<string, string> => {
        const names: Record<string, string> = { user: group.memberNicknames?.['user'] || userProfile.name || '我' };
        for (const id of group.members) {
            names[id] = displayNameOf(group, id);
        }
        return names;
    };

    const downloadTextFile = (filename: string, content: string, mime = 'application/json;charset=utf-8') => {
        const blob = new Blob([content], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    };

    const makeGroupChatRecordId = () => `gchat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const makeNewGroupChatTitle = () => {
        const stamp = new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        return `新聊天 ${stamp}`;
    };
    const cloneMessagesForGroupRecord = (groupId: string, items: Message[]): Message[] =>
        items.map(message => ({ ...message, groupId }));
    const upsertGroupChatRecord = (records: GroupChatRecord[] = [], record: GroupChatRecord): GroupChatRecord[] => {
        const next = records.filter(item => item.id !== record.id);
        next.push(record);
        return next;
    };
    const getSortedGroupChatRecords = (group: GroupProfile | null | undefined): GroupChatRecord[] =>
        [...(group?.chatArchives || [])].sort((a, b) => {
            if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
            return (b.updatedAt || 0) - (a.updatedAt || 0);
        });
    const groupArchiveTimeLabel = (ts?: number) => {
        if (!ts) return '刚刚';
        const d = new Date(ts);
        return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    };
    const groupArchivePreview = (items: Message[] = []) => {
        const last = [...items]
            .reverse()
            .find(m => typeof m.content === 'string' && m.content.trim() && m.metadata?.source !== 'group_call');
        if (!last) return '这页还没有消息。';
        const text = String(last.content).replace(/\s+/g, ' ').trim();
        return text.length > 52 ? `${text.slice(0, 52)}...` : text;
    };
    const groupArchiveMatches = (record: GroupChatRecord, activeMessages: Message[], query: string) => {
        if (!query) return true;
        const q = query.toLowerCase();
        if (record.title.toLowerCase().includes(q)) return true;
        const source = record.id === activeGroup?.activeChatRecordId ? activeMessages : record.messages;
        return (source || []).some(m => typeof m.content === 'string' && m.content.toLowerCase().includes(q));
    };

    const buildActiveGroupChatRecord = (group: GroupProfile, currentMessages: Message[], titleOverride?: string): GroupChatRecord => {
        const now = Date.now();
        const activeId = group.activeChatRecordId || makeGroupChatRecordId();
        const existing = group.chatArchives?.find(record => record.id === activeId);
        const title = (titleOverride || group.chatArchiveTitle || existing?.title || group.name || '群聊记录').trim() || '群聊记录';
        return {
            id: activeId,
            title,
            createdAt: existing?.createdAt || group.createdAt || now,
            updatedAt: now,
            pinned: existing?.pinned,
            messages: cloneMessagesForGroupRecord(group.id, currentMessages),
        };
    };

    const refreshGroupMessagesState = async (groupId: string) => {
        const fresh = await DB.getGroupMessages(groupId);
        setMessages(fresh);
        setTotalMsgCount(fresh.length);
        setVisibleCount(Math.max(30, Math.min(fresh.length, 200)));
        return fresh;
    };

    const saveActiveGroupChatSnapshot = async (group: GroupProfile, titleOverride?: string): Promise<GroupProfile> => {
        const current = await DB.getGroupMessages(group.id);
        const record = buildActiveGroupChatRecord(group, current, titleOverride);
        const updatedGroup: GroupProfile = {
            ...group,
            activeChatRecordId: record.id,
            chatArchiveTitle: record.title,
            chatArchives: upsertGroupChatRecord(group.chatArchives || [], record),
        };
        await updateGroup(group.id, updatedGroup);
        setActiveGroup(updatedGroup);
        return updatedGroup;
    };

    const handleExportGroupChat = async (format: 'moro' | 'jsonl' = 'moro') => {
        if (!activeGroup) return;
        const all = await DB.getGroupMessages(activeGroup.id);
        const memberNames = memberNameMapFor(activeGroup);
        if (format === 'jsonl') {
            downloadTextFile(
                buildGroupChatFilename(activeGroup).replace(/\.moro-group-chat\.json$/, '.sillytavern.jsonl'),
                serializeGroupChatJsonl(activeGroup, all, { memberNames }),
                'application/x-ndjson;charset=utf-8',
            );
        } else {
            downloadTextFile(buildGroupChatFilename(activeGroup), exportGroupChatArchive(activeGroup, all, { memberNames }));
        }
        addToast('群聊记录已导出', 'success');
    };

    const handleExportGroupChatRecord = async (record: GroupChatRecord, format: 'moro' | 'jsonl' = 'moro') => {
        if (!activeGroup) return;
        const isActive = record.id === activeGroup.activeChatRecordId;
        const all = isActive ? await DB.getGroupMessages(activeGroup.id) : record.messages;
        const groupForExport = { ...activeGroup, chatArchiveTitle: record.title };
        const memberNames = memberNameMapFor(activeGroup);
        if (format === 'jsonl') {
            downloadTextFile(
                buildGroupChatFilename(groupForExport).replace(/\.moro-group-chat\.json$/, '.sillytavern.jsonl'),
                serializeGroupChatJsonl(groupForExport, all, { memberNames }),
                'application/x-ndjson;charset=utf-8',
            );
        } else {
            downloadTextFile(buildGroupChatFilename(groupForExport), exportGroupChatArchive(groupForExport, all, { memberNames }));
        }
        addToast('这份群聊记录已导出', 'success');
    };

    const handleStartNewGroupChat = async () => {
        if (!activeGroup) return;
        const savedGroup = await saveActiveGroupChatSnapshot(activeGroup, tempArchiveTitle || activeGroup.chatArchiveTitle || activeGroup.name);
        const now = Date.now();
        const nextRecord: GroupChatRecord = {
            id: makeGroupChatRecordId(),
            title: makeNewGroupChatTitle(),
            createdAt: now,
            updatedAt: now,
            messages: [],
        };
        const updatedGroup: GroupProfile = {
            ...savedGroup,
            activeChatRecordId: nextRecord.id,
            chatArchiveTitle: nextRecord.title,
            chatArchives: upsertGroupChatRecord(savedGroup.chatArchives || [], nextRecord),
        };
        await DB.replaceGroupMessages(activeGroup.id, []);
        await updateGroup(activeGroup.id, updatedGroup);
        setActiveGroup(updatedGroup);
        setTempArchiveTitle(nextRecord.title);
        setMessages([]);
        setTotalMsgCount(0);
        setVisibleCount(30);
        hydrateGroupSettingsDraft(updatedGroup);
        addToast('已开始一份新的群聊记录', 'success');
    };

    const handleSwitchGroupChatRecord = async (recordId: string) => {
        if (!activeGroup || recordId === activeGroup.activeChatRecordId) return;
        const savedGroup = await saveActiveGroupChatSnapshot(activeGroup, tempArchiveTitle || activeGroup.chatArchiveTitle || activeGroup.name);
        const target = savedGroup.chatArchives?.find(record => record.id === recordId);
        if (!target) {
            addToast('这份聊天记录找不到了', 'error');
            return;
        }
        const updatedGroup: GroupProfile = {
            ...savedGroup,
            activeChatRecordId: target.id,
            chatArchiveTitle: target.title,
        };
        await DB.replaceGroupMessages(activeGroup.id, target.messages);
        await updateGroup(activeGroup.id, updatedGroup);
        setActiveGroup(updatedGroup);
        setTempArchiveTitle(target.title);
        await refreshGroupMessagesState(activeGroup.id);
        hydrateGroupSettingsDraft(updatedGroup);
        addToast(`已切到「${target.title}」`, 'success');
    };

    const renameGroupChatRecordTo = async (record: GroupChatRecord, rawTitle: string) => {
        if (!activeGroup) return;
        const title = rawTitle.trim().slice(0, 80);
        if (!title) return;
        const updatedRecords = (activeGroup.chatArchives || []).map(item =>
            item.id === record.id ? { ...item, title, updatedAt: Date.now() } : item);
        const isActive = record.id === activeGroup.activeChatRecordId;
        const updatedGroup: GroupProfile = {
            ...activeGroup,
            chatArchives: updatedRecords,
            ...(isActive ? { chatArchiveTitle: title } : {}),
        };
        await updateGroup(activeGroup.id, updatedGroup);
        setActiveGroup(updatedGroup);
        if (isActive) setTempArchiveTitle(title);
        addToast('聊天记录标题已修改', 'success');
    };

    const handleRenameGroupChatRecord = async (record: GroupChatRecord) => {
        const title = window.prompt('给这份群聊记录改个标题', record.title);
        if (title === null) return;
        await renameGroupChatRecordTo(record, title);
    };

    const beginInlineRenameGroupRecord = (record: GroupChatRecord) => {
        setRenamingGroupRecordId(record.id);
        setRenamingGroupRecordTitle(record.title);
    };

    const commitInlineRenameGroupRecord = async (record: GroupChatRecord) => {
        await renameGroupChatRecordTo(record, renamingGroupRecordTitle);
        setRenamingGroupRecordId(null);
        setRenamingGroupRecordTitle('');
    };

    const handleToggleGroupChatRecordPinned = async (record: GroupChatRecord) => {
        if (!activeGroup) return;
        const updatedRecords = (activeGroup.chatArchives || []).map(item =>
            item.id === record.id ? { ...item, pinned: !item.pinned, updatedAt: Date.now() } : item);
        const updatedGroup = { ...activeGroup, chatArchives: updatedRecords };
        await updateGroup(activeGroup.id, updatedGroup);
        setActiveGroup(updatedGroup);
        addToast(record.pinned ? '已取消置顶这份记录' : '这份记录已置顶', 'success');
    };

    const handleDeleteGroupChatRecord = async (record: GroupChatRecord) => {
        if (!activeGroup) return;
        if (!window.confirm(`确定删除「${record.title}」？`)) return;
        const remaining = (activeGroup.chatArchives || []).filter(item => item.id !== record.id);
        const isActive = record.id === activeGroup.activeChatRecordId;
        if (!isActive) {
            const updatedGroup = { ...activeGroup, chatArchives: remaining };
            await updateGroup(activeGroup.id, updatedGroup);
            setActiveGroup(updatedGroup);
            addToast('聊天记录已删除', 'success');
            return;
        }

        const nextRecord = getSortedGroupChatRecords({ ...activeGroup, chatArchives: remaining } as GroupProfile)[0] || {
            id: makeGroupChatRecordId(),
            title: makeNewGroupChatTitle(),
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messages: [],
        };
        const nextArchives = remaining.some(item => item.id === nextRecord.id) ? remaining : upsertGroupChatRecord(remaining, nextRecord);
        const updatedGroup: GroupProfile = {
            ...activeGroup,
            activeChatRecordId: nextRecord.id,
            chatArchiveTitle: nextRecord.title,
            chatArchives: nextArchives,
        };
        await DB.replaceGroupMessages(activeGroup.id, nextRecord.messages);
        await updateGroup(activeGroup.id, updatedGroup);
        setActiveGroup(updatedGroup);
        setTempArchiveTitle(nextRecord.title);
        await refreshGroupMessagesState(activeGroup.id);
        hydrateGroupSettingsDraft(updatedGroup);
        addToast('聊天记录已删除', 'success');
    };

    const handleImportGroupChat = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file || !activeGroup) return;
        try {
            const raw = await file.text();
            const parsed = parseGroupChatArchive(raw, activeGroup.id, {
                characterNameMap: Object.fromEntries(characters.map(c => [c.name, c.id])),
                userName: userProfile.name,
            });
            const savedGroup = await saveActiveGroupChatSnapshot(activeGroup, tempArchiveTitle || activeGroup.chatArchiveTitle || activeGroup.name);
            const now = Date.now();
            const importedRecord: GroupChatRecord = {
                id: makeGroupChatRecordId(),
                title: parsed.title || '导入的群聊记录',
                createdAt: now,
                updatedAt: now,
                messages: cloneMessagesForGroupRecord(activeGroup.id, parsed.messages),
            };
            const updatedGroup: GroupProfile = {
                ...savedGroup,
                activeChatRecordId: importedRecord.id,
                chatArchiveTitle: importedRecord.title,
                chatArchives: upsertGroupChatRecord(savedGroup.chatArchives || [], importedRecord),
            };
            await DB.replaceGroupMessages(activeGroup.id, importedRecord.messages);
            await updateGroup(activeGroup.id, updatedGroup);
            setActiveGroup(updatedGroup);
            setTempArchiveTitle(importedRecord.title);
            const fresh = await refreshGroupMessagesState(activeGroup.id);
            hydrateGroupSettingsDraft(updatedGroup);
            setModalType('settings');
            addToast(`已导入 ${fresh.length} 条群聊记录，并切到新聊天`, 'success');
        } catch (err) {
            console.error('[GroupChat] import failed', err);
            addToast('导入失败：文件格式不认识', 'error');
        }
    };

    const handleDeleteAllGroupChatRecords = async () => {
        if (!activeGroup) return;
        const activeRecord = activeGroup.chatArchives?.find(record => record.id === activeGroup.activeChatRecordId);
        if (activeRecord) {
            await handleDeleteGroupChatRecord(activeRecord);
            return;
        }
        if (!window.confirm('确定删除这个群的全部聊天记录？群资料会保留。')) return;
        const all = await DB.getGroupMessages(activeGroup.id);
        await DB.deleteMessages(all.map(m => m.id));
        setMessages([]);
        setTotalMsgCount(0);
        setVisibleCount(30);
        addToast('群聊记录已删除', 'success');
    };

    // --- 成员管理：移除 / 头衔 / 禁言 / 戳一戳 ---

    const handleRemoveMember = async (charId: string) => {
        if (!activeGroup) return;
        const name = displayNameOf(activeGroup, charId);
        const nextMembers = activeGroup.members.filter(id => id !== charId);
        const updated = await applyGroupUpdate({
            members: nextMembers,
            memberLenses: pruneGroupMemberLenses(activeGroup.memberLenses, nextMembers),
        });
        if (updated) {
            setTempMemberLenses(pruneGroupMemberLenses(updated.memberLenses, updated.members));
            await postGroupNotice(activeGroup.id, `你将「${name}」移出了群聊`);
            setProfileMemberId(null);
            setModalType('none');
            addToast(`已移除 ${name}`, 'success');
        }
    };

    /** 群主任命/取消管理员 */
    const handleToggleAdmin = async (charId: string) => {
        if (!activeGroup || !isUserOwner(activeGroup)) return;
        const name = displayNameOf(activeGroup, charId);
        const admins = new Set(activeGroup.adminIds || []);
        const wasAdmin = admins.has(charId);
        if (wasAdmin) admins.delete(charId); else admins.add(charId);
        const updated = await applyGroupUpdate({ adminIds: Array.from(admins) });
        if (updated) {
            await postGroupNotice(activeGroup.id, wasAdmin ? `你取消了「${name}」的管理员` : `你将「${name}」设为管理员`);
            addToast(wasAdmin ? '已取消管理员' : '已设为管理员', 'success');
        }
    };

    /** 群主转让：新群主从管理员列表移除（已是群主无需再挂管理员） */
    const handleTransferOwner = async (charId: string) => {
        if (!activeGroup || !isUserOwner(activeGroup)) return;
        const name = displayNameOf(activeGroup, charId);
        const admins = (activeGroup.adminIds || []).filter(id => id !== charId);
        const updated = await applyGroupUpdate({ ownerId: charId, adminIds: admins });
        if (updated) {
            await postGroupNotice(activeGroup.id, `你把群主转让给了「${name}」`);
            setConfirmTransferId(null);
            setProfileMemberId(null);
            setModalType('none');
            addToast('已转让群主', 'success');
        }
    };

    /** 全员禁言开关（群主/管理员）：开启后导演跳过所有角色发言 */
    const handleToggleMuteAll = async () => {
        if (!activeGroup || !userCanManage(activeGroup)) return;
        const next = !activeGroup.mutedAll;
        const updated = await applyGroupUpdate({ mutedAll: next });
        if (updated) {
            await postGroupNotice(activeGroup.id, next ? '你开启了全员禁言' : '你解除了全员禁言');
            addToast(next ? '已开启全员禁言' : '已解除全员禁言', 'success');
        }
    };

    const handleSetTitle = async () => {
        if (!activeGroup || !profileMemberId) return;
        const name = displayNameOf(activeGroup, profileMemberId);
        const title = tempTitle.trim();
        const titles = { ...(activeGroup.memberTitles || {}) };
        if (title) titles[profileMemberId] = title;
        else delete titles[profileMemberId];
        const updated = await applyGroupUpdate({ memberTitles: titles });
        if (updated) {
            await postGroupNotice(activeGroup.id, title ? `你给「${name}」设置了头衔「${title}」` : `你撤销了「${name}」的头衔`);
            setModalType('member-profile');
            addToast(title ? '头衔已设置' : '头衔已撤销', 'success');
        }
    };

    /** 群主/管理员给某成员改群名片（角色自己也能改，这里是用户代改） */
    const handleSetMemberNickname = async () => {
        if (!activeGroup || !profileMemberId) return;
        const charName = characters.find(c => c.id === profileMemberId)?.name || '成员';
        const oldDisplay = activeGroup.memberNicknames?.[profileMemberId] || charName;
        const nick = tempMemberNickname.trim().slice(0, 24);
        const nicknames = { ...(activeGroup.memberNicknames || {}) };
        if (nick) nicknames[profileMemberId] = nick;
        else delete nicknames[profileMemberId];
        const updated = await applyGroupUpdate({ memberNicknames: nicknames });
        if (updated) {
            await postGroupNotice(activeGroup.id, nick ? `你把「${oldDisplay}」的群名片改为「${nick}」` : `你清除了「${oldDisplay}」的群名片`);
            setModalType('member-profile');
            addToast(nick ? '群名片已修改' : '群名片已清除', 'success');
        }
    };

    const MUTE_OPTIONS: Array<{ label: string; ms: number }> = [
        { label: '10 分钟', ms: 10 * 60 * 1000 },
        { label: '1 小时', ms: 60 * 60 * 1000 },
        { label: '12 小时', ms: 12 * 60 * 60 * 1000 },
        { label: '24 小时', ms: 24 * 60 * 60 * 1000 },
    ];

    const handleMuteMember = async (durationMs: number | null) => {
        if (!activeGroup || !profileMemberId) return;
        const name = displayNameOf(activeGroup, profileMemberId);
        const muted = { ...(activeGroup.mutedUntil || {}) };
        if (durationMs === null) {
            delete muted[profileMemberId];
        } else {
            muted[profileMemberId] = Date.now() + durationMs;
        }
        const updated = await applyGroupUpdate({ mutedUntil: muted });
        if (updated) {
            const durLabel = MUTE_OPTIONS.find(o => o.ms === durationMs)?.label;
            await postGroupNotice(activeGroup.id, durationMs === null ? `你解除了「${name}」的禁言` : `你已将「${name}」禁言 ${durLabel}`);
            setModalType('member-profile');
            addToast(durationMs === null ? '已解除禁言' : '已禁言', 'success');
        }
    };

    const handleAddMember = async (charId: string) => {
        if (!activeGroup || activeGroup.members.includes(charId)) return;
        const name = characters.find(c => c.id === charId)?.name || '新成员';
        const updated = await applyGroupUpdate({ members: [...activeGroup.members, charId] });
        if (updated) {
            await postGroupNotice(activeGroup.id, `你邀请「${name}」加入了群聊`);
            setModalType('settings');
            addToast(`${name} 已加入群聊`, 'success');
        }
    };

    const handlePokeMember = async (charId: string) => {
        if (!activeGroup) return;
        const name = displayNameOf(activeGroup, charId);
        const patSuffix = characters.find(c => c.id === charId)?.patSuffix || '脑袋';
        setProfileMemberId(null);
        setModalType('none');
        // 拍一拍（微信式）：拍某成员，显示「我 拍了拍 X 的<X的后缀>」
        await handleSendMessage(`[拍了拍 ${name}]`, 'interaction', { targetCharId: charId, patSuffix });
    };

    /** 群主/管理员发布、修改或撤下群公告（清空正文＝撤下）。落系统通知让成员"看到"。 */
    const handleSaveAnnouncement = async () => {
        if (!activeGroup) return;
        if (!userCanManage(activeGroup)) { addToast('只有群主或管理员能发布群公告', 'info'); return; }
        const text = tempAnnouncement.trim().slice(0, 800);
        const hadAnnouncement = !!activeGroup.announcement?.text;
        const updated = await applyGroupUpdate({
            announcement: text ? { text, by: 'user', at: Date.now() } : undefined,
        });
        if (!updated) return;
        setModalType('none');
        if (text) {
            const preview = text.length > 40 ? `${text.slice(0, 40)}…` : text;
            await postGroupNotice(activeGroup.id, `你发布了群公告：「${preview}」`);
            addToast('群公告已发布', 'success');
        } else if (hadAnnouncement) {
            await postGroupNotice(activeGroup.id, '你撤下了群公告');
            addToast('群公告已撤下', 'success');
        } else {
            addToast('公告内容为空', 'info');
        }
    };

    /** 打开群公告弹窗：回填当前公告草稿 */
    const openAnnouncementModal = () => {
        setTempAnnouncement(activeGroup?.announcement?.text || '');
        setModalType('group-announcement');
    };

    const handleGroupAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file || !activeGroup) return;
        try {
            const base64 = await processImage(file);
            const updated = await applyGroupUpdate({ avatar: base64 });
            if (updated) addToast('群头像已修改', 'success');
        } catch (err: any) {
            addToast('图片处理失败', 'error');
        }
    };

    const handleGroupBackgroundUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file || !activeGroup) return;
        try {
            const image = await processImage(file, { maxWidth: 1200, quality: 0.76, forceJpeg: true });
            const updated = await applyGroupUpdate({ chatBackgroundImage: image });
            if (updated) addToast('这个群的聊天背景已换好', 'success');
        } catch {
            addToast('背景图处理失败', 'error');
        }
    };

    const handleRemoveGroupBackground = async () => {
        if (!activeGroup) return;
        const updated = { ...activeGroup };
        delete updated.chatBackgroundImage;
        await updateGroup(activeGroup.id, updated);
        setActiveGroup(updated);
        addToast('已恢复群聊通用背景', 'success');
    };

    const toggleMemberSelection = (id: string) => {
        const next = new Set(selectedMembers);
        if (next.has(id)) {
            next.delete(id);
            // 被移出成员的群主 / 管理员身份同步取消
            if (tempOwnerId === id) setTempOwnerId('user');
            if (tempAdminIds.has(id)) {
                const admins = new Set(tempAdminIds);
                admins.delete(id);
                setTempAdminIds(admins);
            }
        } else next.add(id);
        setSelectedMembers(next);
    };

    const toggleAdminSelection = (id: string) => {
        const next = new Set(tempAdminIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setTempAdminIds(next);
    };

    // 解散后保留底层记录供备份/清理兼容，但从往来和名册里隐藏。
    const handleDissolveGroup = async (id: string) => {
        const updated = await updateGroup(id, { dissolved: true, dissolvedAt: Date.now() });
        if (updated) {
            await postGroupNotice(id, '你解散了该群聊');
            if (activeGroup?.id === id) {
                setActiveGroup(null);
                setMessages([]);
                setTotalMsgCount(0);
            }
            setConvos(prev => prev.filter(cv => cv.kind !== 'group' || cv.id !== id));
            try { localStorage.removeItem(`moro_group_unread_${id}`); } catch { /* ignore */ }
            setModalType('none');
            setView('list');
            addToast('群聊已解散', 'success');
        }
    };

    // 彻底删除：清理群记忆后真删
    const handleDeleteGroup = async (id: string) => {
        // 先清理群记忆宫殿数据（成员各自存的副本一并删），再删群
        // 异常吞掉——清理失败不阻塞删除流程
        try {
            const result = await deleteGroupMemoriesByGroupId(id);
            if (result.deleted > 0) {
                console.log(`🗑️ [GroupChat] 删群同时清理群记忆 ${result.deleted} 条`);
            }
        } catch (err) {
            console.warn('🗑️ [GroupChat] 清理群记忆失败（不影响删除）:', err);
        }
        await deleteGroup(id);
        if (activeGroup?.id === id) setView('list');
        addToast('群聊已删除', 'success');
    };

    const handleClearHistory = async () => {
        if (!activeGroup) return;

        // Fetch ALL messages from DB, not just the loaded subset
        const allGroupMsgs = await DB.getGroupMessages(activeGroup.id);

        let msgsToDelete = allGroupMsgs;
        let keepCount = 0;

        if (preserveContext) {
            msgsToDelete = allGroupMsgs.slice(0, -10);
            keepCount = Math.min(allGroupMsgs.length, 10);
        }

        if (msgsToDelete.length === 0) {
            addToast('消息太少，无需清理', 'info');
            return;
        }

        await DB.deleteMessages(msgsToDelete.map(m => m.id));

        // Refresh local state
        const remaining = preserveContext ? allGroupMsgs.slice(-10) : [];
        setMessages(remaining);
        setTotalMsgCount(remaining.length);

        addToast(`已清理 ${msgsToDelete.length} 条记录${preserveContext ? ' (保留最近10条)' : ''}`, 'success');
        setModalType('none');
    };

    // --- Logic: Group Summary & Distribution ---

    const handleGroupSummary = async () => {
        const summaryApi = resolveAuxApi(auxApiConfig, apiConfig);
        if (!activeGroup || !summaryApi.baseUrl || !summaryApi.model) {
            addToast('请检查配置', 'error');
            return;
        }

        if (messages.length === 0) {
            addToast('暂无聊天记录', 'info');
            return;
        }

        setIsSummarizing(true);
        setSummaryProgress('正在读取记录...');

        try {
            // Group messages by Date (YYYY-MM-DD)
            const msgsByDate: Record<string, Message[]> = {};
            messages.forEach(m => {
                const dateStr = new Date(m.timestamp).toLocaleDateString('zh-CN', {year:'numeric', month:'2-digit', day:'2-digit'}).replace(/\//g, '-');
                if (!msgsByDate[dateStr]) msgsByDate[dateStr] = [];
                msgsByDate[dateStr].push(m);
            });

            const dates = Object.keys(msgsByDate).sort();
            
            for (let i = 0; i < dates.length; i++) {
                const date = dates[i];
                setSummaryProgress(`正在归档 ${date} (${i+1}/${dates.length})`);
                
                const dayMsgs = msgsByDate[date];
                const logText = dayMsgs.map(m => {
                    const sender = m.role === 'user'
                        ? userProfile.name
                        : (characters.find(c => c.id === m.charId)?.name || '未知成员');
                    return `${sender}: ${m.content}`;
                }).join('\n');

                // Use selected prompt template or fall back to default group summary
                const templateObj = archivePrompts.find(p => p.id === selectedPromptId);
                let prompt: string;

                if (templateObj) {
                    // Adapt the chat prompt for group context - replace per-character variables
                    const memberNames = activeGroup.members.map(id => characters.find(c => c.id === id)?.name || '未知').join('、');
                    prompt = templateObj.content
                        .replace(/\$\{dateStr\}/g, date)
                        .replace(/\$\{char\.name\}/g, `群成员(${memberNames})`)
                        .replace(/\$\{userProfile\.name\}/g, userProfile.name)
                        .replace(/\$\{rawLog.*?\}/g, logText.substring(0, 10000));
                    prompt = `[群聊: ${activeGroup.name}]\n${prompt}`;
                } else {
                    prompt = `
### Task: Group Chat Summary
Group: "${activeGroup.name}"
Date: ${date}

### Instructions
Summarize the following chat log into a **concise, 3rd-person, YAML format**.
- Focus on interactions, conflicts, and key topics.
- Be objective (like a narrator).
- **Strictly output valid YAML only.**

### Example Output
summary: "In [Group Name], [Char A] shared a photo of a cat. [Char B] made a joke about it, which caused a brief playful argument about pets."

### Logs
${logText.substring(0, 10000)}
`;
                }

                const data = await callChatCompletion(summaryApi, {
                    model: summaryApi.model,
                    messages: [{ role: "user", content: prompt }],
                    temperature: 0.3
                }, {
                    meta: makeApiUsageMeta('chat.postProcess.summary', {
                        apiRole: summaryApi.apiRole || 'aux',
                        apiBinding: summaryApi.apiBinding || 'Group archive',
                    }),
                });
                let content = (extractContent(data) || '').trim();
                    // Basic YAML extraction
                    const yamlMatch = content.match(/summary:\s*["']?([\s\S]*?)["']?$/);
                    let summaryText = yamlMatch ? yamlMatch[1] : content.replace(/^summary:\s*/i, '');
                    
                    // Cleanup quotes if matched broadly
                    summaryText = summaryText.replace(/^["']|["']$/g, '').trim();

                    if (summaryText) {
                        // Distribute to Members
                        const newMem: MemoryFragment = {
                            id: `mem-${Date.now()}-${Math.random()}`,
                            date: date,
                            summary: `[群聊归档: ${activeGroup.name}] ${summaryText}`,
                            mood: 'group'
                        };

                        for (const memberId of activeGroup.members) {
                            const member = characters.find(c => c.id === memberId);
                            if (member) {
                                const updatedMems = [...(member.memories || []), newMem];
                                updateCharacter(member.id, { memories: updatedMems });
                            }
                        }
                    }
                
                await new Promise(r => setTimeout(r, 500)); // Rate limit buffer
            }

            addToast('群聊记忆已同步至所有成员', 'success');
            setModalType('none');

        } catch (e: any) {
            console.error(e);
            addToast(`归档失败: ${e.message}`, 'error');
        } finally {
            setIsSummarizing(false);
            setSummaryProgress('');
        }
    };

    // --- Logic: Messaging ---

    function clearLiveGroupDraftTimer() {
        if (liveGroupDraftTimerRef.current) {
            clearTimeout(liveGroupDraftTimerRef.current);
            liveGroupDraftTimerRef.current = null;
        }
    }

    const handleSaveGroupImportedEmojis = async (records: ParsedEmojiImport[]) => {
        if (records.length === 0) return;
        await Promise.all(records.map(record => (
            DB.saveEmoji(record.name, record.url, record.categoryId || 'default', record.description)
        )));
        await reloadEmojiData();
        setShowEmojiImportModal(false);
        setShowEmojiPicker(true);
        addToast(`收集了 ${records.length} 张群聊贴纸`, 'success');
    };

    const handleSendMessage = async (content: string, type: MessageType = 'text', metadata?: any) => {
        if (!activeGroup) return;
        if (type === 'text' && !content.trim()) return;
        if (groupOpeningPickerRef.current.active) {
            try {
                await commitGroupOpeningGreeting();
            } catch (e) {
                console.warn('[GroupOpening] 开场白落库失败:', e);
            }
        }
        
        const newMessage = {
            charId: 'user',
            groupId: activeGroup.id,
            role: 'user' as const,
            type,
            content,
            metadata
        };

        await DB.saveMessage(newMessage);
        
        // Optimistic update
        const updatedMsgs = await DB.getGroupMessages(activeGroup.id);
        setMessages(updatedMsgs);
        
        // Close panels
        if (type !== 'text') {
            setShowActions(false);
            setShowEmojiPicker(false);
        }
        setInput('');
        clearLiveGroupDraftTimer();

        const sendGroupConvo = resolveGroupConvo(activeGroup);
        if (liveGroupEnabled && type === 'text' && sendGroupConvo.autoReplyEachUserMessage) {
            const groupId = activeGroup.id;
            groupAutoReplyQueueRef.current = groupAutoReplyQueueRef.current
                .catch(() => undefined)
                .then(async () => {
                    if (activeGroupRef.current?.id !== groupId) return;
                    const fresh = await DB.getGroupMessages(groupId);
                    if (activeGroupRef.current?.id !== groupId) return;
                    await triggerDirector(fresh, { allowAutoContinue: true, liveMode: 'sent' });
                });
            void groupAutoReplyQueueRef.current.catch(err => console.warn('[GroupChat] auto reply queue failed', err));
        } else if (liveGroupEnabled && (type === 'text' || type === 'image' || type === 'voice')) {
            if (isTyping) {
                liveGroupPendingSendTriggerRef.current = true;
            } else {
                void triggerDirector(updatedMsgs, { allowAutoContinue: true, liveMode: 'sent' });
            }
        }

    };

    const triggerDirectorFromCurrent = async () => {
        if (isTyping) return;
        let currentMsgs = messages;
        if (groupOpeningPickerRef.current.active) {
            try {
                currentMsgs = await commitGroupOpeningGreeting();
            } catch (e) {
                console.warn('[GroupOpening] 开场白落库失败:', e);
            }
        }
        void triggerDirector(currentMsgs, { allowAutoContinue: true });
    };

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const base64 = await processImage(file, { maxWidth: 600, quality: 0.7, forceJpeg: true });
            handleSendMessage(base64, 'image');
        } catch (err) {
            addToast('图片发送失败', 'error');
        }
    };

    // ───────────── 群聊版「回形针」：与单聊同一套功能 ─────────────
    const wallet = Math.round((userProfile.balance || 0) * 100) / 100;

    // 留个声：录音完成 → 落库为 voice 消息（转写进 metadata，导演上下文可读）
    const voice = useVoiceRecorder({
        onComplete: (audio, durationSec, transcript) => { void handleSendMessage('[语音消息]', 'voice', { voiceAudio: audio, durationSec, transcript }); },
        onDenied: () => addToast('无法访问麦克风，请检查浏览器权限', 'error'),
    });

    // 寄零花 / 发红包（钱包实扣）：校验金额 → adjustUserBalance(-amt) → 红包消息。
    // 普通红包＝整包给群里（沿用旧行为）；拼手气红包＝随机拆 N 份，群成员当场抢（手气最佳上榜）。
    const resetTransferModal = () => {
        setModalType('none'); setTransferAmount(''); setTransferNote('');
        setTransferPassword(''); setTransferShares(''); setTransferRpType('normal');
    };
    const sendGroupTransfer = async () => {
        if (!activeGroup) return;
        const amt = Math.round(parseFloat(transferAmount) * 100) / 100;
        if (!amt || amt <= 0) { addToast('填个金额吧', 'info'); return; }
        if (amt > wallet) { addToast(`钱包余额不足（¥${wallet}）`, 'error'); return; }

        if (transferRpType === 'lucky') {
            const groupChars = characters.filter(c => activeGroup.members.includes(c.id));
            if (groupChars.length === 0) { addToast('群里还没有成员能抢红包', 'info'); return; }
            const totalCents = yuanToCents(amt);
            // 份数：用户填的，缺省＝群成员数；上限＝成员数（人手最多一份，钱全分完不留尾款）
            let count = parseInt(transferShares, 10);
            if (!Number.isFinite(count) || count <= 0) count = groupChars.length;
            count = Math.min(count, groupChars.length);
            if (totalCents < count) { addToast(`至少 ¥${(count / 100).toFixed(2)} 才够分 ${count} 份`, 'error'); return; }

            adjustUserBalance(-amt, {
                note: `${activeGroup.name || '群聊'} 拼手气红包`,
                category: 'transfer',
                kind: 'group-redpacket-out',
                sourceApp: '聊天',
                sourceId: activeGroup.id,
                relatedEntityId: activeGroup.id,
                createdBy: 'user',
            });
            // 二倍均值法拆分 + 随机挑 count 名成员当场抢
            const shareCents = splitRedPacket(totalCents, count);
            const grabbers = shuffle(groupChars).slice(0, count);
            const grabs = grabbers.map((c, i) => ({ id: c.id, name: c.name, amount: centsToYuan(shareCents[i]), at: Date.now() + i }));
            const bestIdx = bestLuckIndex(shareCents);
            const bestId = grabbers[bestIdx]?.id;

            await DB.saveMessage({
                charId: 'user', groupId: activeGroup.id, role: 'user', type: 'transfer',
                content: `[拼手气红包] ${amt}`,
                metadata: { kind: 'redpacket', rpType: 'lucky', amount: amt, count, grabs, bestId, status: 'finished', note: transferNote.trim() || undefined },
            });
            const updated = await DB.getGroupMessages(activeGroup.id);
            setMessages(updated);
            addToast(`红包被抢光啦 · 手气最佳 ${grabs[bestIdx]?.name}（¥${grabs[bestIdx]?.amount}）`, 'success');
            resetTransferModal();
            return;
        }

        const password = transferPassword.trim();
        if (transferRpType === 'password' && !password) { addToast('写一句口令吧', 'info'); return; }
        adjustUserBalance(-amt, {
            note: transferRpType === 'password' ? `${activeGroup.name || '群聊'} 口令红包` : `${activeGroup.name || '群聊'} 红包`,
            category: 'transfer',
            kind: transferRpType === 'password' ? 'group-password-redpacket-out' : 'group-redpacket-out',
            sourceApp: '聊天',
            sourceId: activeGroup.id,
            relatedEntityId: activeGroup.id,
            createdBy: 'user',
        });
        await DB.saveMessage({
            charId: 'user',
            groupId: activeGroup.id,
            role: 'user',
            type: 'transfer',
            content: transferRpType === 'password' ? `[口令红包] ${amt}` : `[红包] ${amt}`,
            metadata: buildGroupRedPacketMetadata({
                amount: amt,
                type: transferRpType,
                note: transferNote.trim() || undefined,
                password,
            }),
        });
        setMessages(await DB.getGroupMessages(activeGroup.id));
        addToast(transferRpType === 'password' ? '口令红包已发出' : '红包已发出', 'success');
        resetTransferModal();
    };

    const openPasswordRedPacket = async () => {
        const msg = redPacketOpenMsg;
        if (!activeGroup || !msg || msg.id == null) return;
        const meta: any = msg.metadata || {};
        if (!isPasswordRedPacketPhraseAccepted(String(meta.password || ''), redPacketPasswordInput)) {
            addToast('口令不对，再看一眼红包上的字', 'error');
            return;
        }
        await DB.updateMessageMetadata(msg.id, (prev: any) => ({
            ...(prev || {}),
            status: 'opened',
            openedBy: 'user',
            openedAt: Date.now(),
        }));
        const updated = await DB.getGroupMessages(activeGroup.id);
        setMessages(updated);
        setRedPacketOpenMsg(null);
        setRedPacketPasswordInput('');
        addToast('口令正确，红包已打开', 'success');
    };

    // 群收款（AA 收款）：用户向选定成员收钱，钱随「收」逐笔进钱包。
    const resetCollectModal = () => {
        setModalType('none'); setCollectAmount(''); setCollectNote(''); setCollectMembers(new Set());
    };
    const sendGroupCollect = async () => {
        if (!activeGroup) return;
        const total = Math.round(parseFloat(collectAmount) * 100) / 100;
        if (!total || total <= 0) { addToast('填个收款总额吧', 'info'); return; }
        const ids = Array.from(collectMembers).filter(id => activeGroup.members.includes(id));
        if (ids.length === 0) { addToast('选择要收款的成员', 'info'); return; }
        const totalCents = yuanToCents(total);
        if (totalCents < ids.length) { addToast(`至少 ¥${(ids.length / 100).toFixed(2)} 才能均摊给 ${ids.length} 人`, 'error'); return; }
        // AA 均摊：每人 base 分，余数前几人各多 1 分（合计严格等于总额）
        const base = Math.floor(totalCents / ids.length);
        const remainder = totalCents - base * ids.length;
        const shares = ids.map((id, i) => ({
            id,
            name: characters.find(c => c.id === id)?.name || '成员',
            amount: centsToYuan(base + (i < remainder ? 1 : 0)),
            paid: false,
        }));
        await DB.saveMessage({
            charId: 'user', groupId: activeGroup.id, role: 'user', type: 'transfer',
            content: `[群收款] ${total}`,
            metadata: { kind: 'collect', total, note: collectNote.trim() || undefined, shares },
        } as any);
        setMessages(await DB.getGroupMessages(activeGroup.id));
        addToast('群收款已发起', 'success');
        resetCollectModal();
    };
    /** 收某位成员的那一份：进钱包 + 更新收款单 */
    const payCollectShare = async (msg: Message, shareId: string) => {
        if (!activeGroup || msg.id == null) return;
        const share = ((msg.metadata as any)?.shares || []).find((s: any) => s.id === shareId);
        if (!share || share.paid) return;
        adjustUserBalance(+share.amount, {
            note: `${activeGroup.name || '群聊'} 收到 ${share.name} 的 AA 款`,
            category: 'transfer',
            kind: 'group-collect-in',
            sourceApp: '聊天',
            sourceId: msg.id != null ? String(msg.id) : activeGroup.id,
            relatedEntityId: activeGroup.id,
            createdBy: 'character',
        });
        await DB.updateMessageMetadata(msg.id, (prev: any) => ({
            ...prev,
            shares: (prev?.shares || []).map((s: any) => s.id === shareId ? { ...s, paid: true, paidAt: Date.now() } : s),
        }));
        const updated = await DB.getGroupMessages(activeGroup.id);
        setMessages(updated);
        setCollectDetailMsg(updated.find(m => m.id === msg.id) || null);
        addToast(`已收 ${share.name} ¥${share.amount}`, 'success');
    };
    /** 一键收齐剩余未付 */
    const collectAllRemaining = async (msg: Message) => {
        if (!activeGroup || msg.id == null) return;
        const unpaid = ((msg.metadata as any)?.shares || []).filter((s: any) => !s.paid);
        if (unpaid.length === 0) return;
        const sum = Math.round(unpaid.reduce((a: number, s: any) => a + s.amount, 0) * 100) / 100;
        adjustUserBalance(+sum, {
            note: `${activeGroup.name || '群聊'} 一键收齐 AA 款`,
            category: 'transfer',
            kind: 'group-collect-in',
            sourceApp: '聊天',
            sourceId: msg.id != null ? String(msg.id) : activeGroup.id,
            relatedEntityId: activeGroup.id,
            createdBy: 'character',
        });
        await DB.updateMessageMetadata(msg.id, (prev: any) => ({
            ...prev,
            shares: (prev?.shares || []).map((s: any) => s.paid ? s : { ...s, paid: true, paidAt: Date.now() }),
        }));
        const updated = await DB.getGroupMessages(activeGroup.id);
        setMessages(updated);
        setCollectDetailMsg(updated.find(m => m.id === msg.id) || null);
        addToast(`已收齐 ¥${sum}`, 'success');
    };

    // 群投票（单选）：用户发起 → 大家投票（角色由导演按性格投）
    const resetPollModal = () => { setModalType('none'); setPollQuestion(''); setPollOptions(['', '']); };
    const sendGroupPoll = async () => {
        if (!activeGroup) return;
        const q = pollQuestion.trim();
        if (!q) { addToast('写个投票问题吧', 'info'); return; }
        const opts = pollOptions.map(o => o.trim()).filter(Boolean);
        if (opts.length < 2) { addToast('至少要两个选项', 'info'); return; }
        await DB.saveMessage({
            charId: 'user', groupId: activeGroup.id, role: 'user', type: 'poll_card',
            content: `[投票] ${q}`,
            metadata: { kind: 'poll', question: q, options: opts.slice(0, 6).map(t => ({ text: t, voters: [] as string[] })), reasons: {} as Record<string, string> },
        } as any);
        setMessages(await DB.getGroupMessages(activeGroup.id));
        addToast('投票已发起', 'success');
        resetPollModal();
    };
    /** 用户投票（单选）：先把 user 从各选项移除再投到所选；点已选项＝取消 */
    const votePoll = async (msg: Message, optionIdx: number) => {
        if (!activeGroup || msg.id == null) return;
        await DB.updateMessageMetadata(msg.id, (prev: any) => {
            const already = ((prev?.options?.[optionIdx]?.voters) || []).includes('user');
            const options = (prev?.options || []).map((o: any) => ({ ...o, voters: (o.voters || []).filter((v: string) => v !== 'user') }));
            if (!already && options[optionIdx]) options[optionIdx].voters = [...options[optionIdx].voters, 'user'];
            return { ...prev, options };
        });
        const updated = await DB.getGroupMessages(activeGroup.id);
        setMessages(updated);
        setPollDetailMsg(prev => (prev && prev.id === msg.id ? (updated.find(m => m.id === msg.id) || null) : prev));
    };

    // 群接龙：用户发起 → 大家按性格接（导演 [[JOIN_RELAY: ...]]）
    const resetRelayModal = () => { setModalType('none'); setRelayTitle(''); setRelayFirst(''); };
    const sendGroupRelay = async () => {
        if (!activeGroup) return;
        const title = relayTitle.trim();
        if (!title) { addToast('写个接龙主题吧', 'info'); return; }
        const userName = activeGroup.memberNicknames?.['user'] || userProfile.name || '我';
        const first = relayFirst.trim();
        const entries = first ? [{ by: 'user', name: userName, text: first.slice(0, 100), at: Date.now() }] : [];
        await DB.saveMessage({
            charId: 'user', groupId: activeGroup.id, role: 'user', type: 'relay_card',
            content: `[接龙] ${title}`,
            metadata: { kind: 'relay', title, entries },
        } as any);
        setMessages(await DB.getGroupMessages(activeGroup.id));
        addToast('接龙已发起', 'success');
        resetRelayModal();
    };
    /** 用户在接龙详情里接上自己这一条 */
    const joinRelayAsUser = async (msg: Message) => {
        if (!activeGroup || msg.id == null) return;
        const text = relayInput.trim();
        if (!text) return;
        const userName = activeGroup.memberNicknames?.['user'] || userProfile.name || '我';
        await DB.updateMessageMetadata(msg.id, (prev: any) => ({
            ...prev,
            entries: [...(prev?.entries || []), { by: 'user', name: userName, text: text.slice(0, 100), at: Date.now() }],
        }));
        setRelayInput('');
        const updated = await DB.getGroupMessages(activeGroup.id);
        setMessages(updated);
        setRelayDetailMsg(updated.find(m => m.id === msg.id) || null);
    };

    // 群签到（每日打卡）：当天一张卡，成员各签一次；角色由导演 [[CHECKIN: 心情]] 打卡
    const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    const handleGroupCheckin = async () => {
        if (!activeGroup) return;
        setShowActions(false);
        const today = todayKey();
        const userName = activeGroup.memberNicknames?.['user'] || userProfile.name || '我';
        const all = await DB.getGroupMessages(activeGroup.id);
        const existing = [...all].reverse().find(m => m.type === 'checkin_card' && (m.metadata as any)?.date === today);
        if (existing && existing.id != null) {
            const already = ((existing.metadata as any)?.entries || []).some((e: any) => e.by === 'user');
            if (already) { addToast('今天已经签到过啦', 'info'); return; }
            await DB.updateMessageMetadata(existing.id, (prev: any) => ({
                ...prev,
                entries: [...(prev?.entries || []), { by: 'user', name: userName, mood: '', at: Date.now() }],
            }));
        } else {
            await DB.saveMessage({
                charId: 'user', groupId: activeGroup.id, role: 'user', type: 'checkin_card',
                content: `[群签到] ${today}`,
                metadata: { kind: 'checkin', date: today, entries: [{ by: 'user', name: userName, mood: '', at: Date.now() }] },
            } as any);
        }
        setMessages(await DB.getGroupMessages(activeGroup.id));
        addToast('签到成功 ✅', 'success');
    };

    // 落脚点：分享一个地点
    const sendGroupLocation = () => {
        const name = locName.trim();
        if (!name) { addToast('填一下地点名称', 'info'); return; }
        void handleSendMessage(name, 'location', { address: locDetail.trim() || undefined });
        setActionModal('none'); setLocName(''); setLocDetail('');
    };

    // 画一张：AI 生图 → 预览 → 发送
    const genGroupImage = async () => {
        const prompt = imgPrompt.trim();
        if (!prompt) { addToast('描述一下想画什么', 'info'); return; }
        setImgBusy(true);
        try {
            try { localStorage.setItem('moro_image_gen_model', imgModel.trim()); } catch { /* ignore */ }
            const dataUri = await generateImage(prompt, apiConfig, imgModel);
            setImgPreview(dataUri);
        } catch (e: any) { addToast(e?.message || 'AI 画图失败', 'error'); }
        finally { setImgBusy(false); }
    };
    const sendGroupImage = () => {
        if (!imgPreview) return;
        void handleSendMessage(imgPreview, 'image', { aiGenerated: true, genPrompt: imgPrompt.trim() });
        setActionModal('none'); setImgPreview(null); setImgPrompt('');
    };

    // 幕后指令：写一条 OOC 导演指令（系统消息），成员们据此演
    const sendGroupSystemCmd = () => {
        const text = sysCmd.trim();
        if (!text) { addToast('写点什么吧', 'info'); return; }
        void handleSendMessage(`[幕后指令] ${text}`, 'system');
        setActionModal('none'); setSysCmd('');
    };

    const handleGroupOfflineEnd = async () => {
        if (!activeGroup) return;
        if (suspendedOfflineSession?.kind === 'group' && suspendedOfflineSession.groupId === activeGroup.id) {
            clearSuspendedOfflineSession();
        }
        setShowGroupOfflineMode(false);
        const fresh = await refreshGroupMessagesState(activeGroup.id);
        addToast('群聊赴约已结束，回到线上聊天', 'info');
        setTimeout(() => { void triggerDirector(fresh); }, 800);
    };

    const handleGroupOfflineSuspend = (entryCount: number) => {
        if (!activeGroup) return;
        const firstMember = characters.find(c => activeGroup.members.includes(c.id));
        suspendOfflineSession({
            kind: 'group',
            groupId: activeGroup.id,
            title: activeGroup.name,
            avatar: activeGroup.avatar || firstMember?.avatar,
            suspendedAt: Date.now(),
            entryCount,
        });
        setShowGroupOfflineMode(false);
        addToast('群聊线下现场已挂起，结束线下前不会写回群聊上下文', 'success');
    };

    const groupCallTranscriptPayload = (items: GroupCallBubble[]) => items.map(item => ({
        id: item.id,
        role: item.role,
        charId: item.charId,
        name: item.name,
        text: item.text,
        time: item.time,
        timestamp: item.timestamp,
    }));

    const commitGroupCallBubbles = async (session: GroupCallSession, additions: GroupCallBubble[]): Promise<GroupCallBubble[]> => {
        if (!additions.length) return groupCallBubbles;
        let nextTranscript: GroupCallBubble[] = [];
        setGroupCallBubbles(prev => {
            nextTranscript = [...prev, ...additions];
            return nextTranscript;
        });
        for (const item of additions) {
            await DB.saveMessage({
                charId: item.role === 'user' ? 'user' : (item.charId || session.members[0]?.id || 'assistant'),
                groupId: session.groupId,
                role: item.role,
                type: 'text',
                content: item.text,
                metadata: {
                    source: 'group_call',
                    callSessionId: session.sessionId,
                    callLogMessageId: session.messageId,
                    speakerName: item.name,
                },
            } as any);
        }
        await DB.updateMessageMetadata(session.messageId, (prev: any) => ({
            ...(prev || {}),
            transcript: groupCallTranscriptPayload(nextTranscript),
            turnCount: nextTranscript.filter(item => item.role === 'user').length,
            lastLine: nextTranscript[nextTranscript.length - 1]?.text || prev?.lastLine,
        }));
        if (activeGroup?.id === session.groupId) {
            setMessages(await DB.getGroupMessages(session.groupId));
        }
        return nextTranscript;
    };

    const requestGroupCallReplies = async (
        spokenText: string,
        session: GroupCallSession,
        transcript: GroupCallBubble[],
        mode: 'opening' | 'turn',
    ): Promise<GroupCallBubble[]> => {
        const group = activeGroup;
        if (!group || group.id !== session.groupId) throw new Error('群聊电话已经不在当前群');
        if (!apiConfig.baseUrl || !apiConfig.model) throw new Error('请先在「文具盒」里配置聊天 API');
        if (group.dissolved) throw new Error('该群聊已被解散');
        if (group.mutedAll) throw new Error('全员禁言中，群友暂时不能说话');

        const groupMembers = characters.filter(c => group.members.includes(c.id));
        const availableMembers = groupMembers.filter(m => !isMuted(group, m.id));
        if (!availableMembers.length) throw new Error('当前没有可发言的群成员');

        const groupCallScanMessages = [
            ...transcript.map(item => `${item.name}: ${item.text}`),
            spokenText ? `${userProfile.name || '用户'}: ${spokenText}` : '',
        ].filter(Boolean).slice(-40);
        let sharedScene!: ReturnType<typeof ContextBuilder.buildGroupSharedScene>;
        const memberContexts: string[] = [];
        await WorldbookRuntime.withContext({ scanMessages: groupCallScanMessages }, async () => {
            sharedScene = ContextBuilder.buildGroupSharedScene(groupMembers, userProfile);
        });
        const rosterLines = groupMembers.map(m => {
            const muted = isMuted(group, m.id) ? ' | 禁言中，本轮不能说话' : '';
            const nick = group.memberNicknames?.[m.id];
            const title = group.memberTitles?.[m.id];
            return `- ${formatCharacterWithId(m)}${nick ? ` | 群名片: ${nick}` : ''}${title ? ` | 头衔: ${title}` : ''}${muted}`;
        }).join('\n');
        const userName = group.memberNicknames?.['user'] || userProfile.name || '我';
        const currentTimeStr = `${virtualTime.hours.toString().padStart(2, '0')}:${virtualTime.minutes.toString().padStart(2, '0')}`;
        await WorldbookRuntime.withContext({ scanMessages: groupCallScanMessages }, async () => {
            for (const member of groupMembers) {
                const privateMsgs = await DB.getMessagesByCharId(member.id);
                await injectMemoryPalace(member, privateMsgs);
                const coreContext = ContextBuilder.buildCoreContext(member, userProfile, true, undefined, {
                    skipUserProfile: true,
                    skipWorldview: sharedScene.worldviewIsShared,
                    skipWorldbookIds: sharedScene.sharedWorldbookIds,
                    headerOverride: `[Group Voice Call Member: ${formatCharacterWithId(member)}]`,
                });
                const lensBlock = buildGroupMemberLensBlock(
                    group,
                    member,
                    groupMembers,
                    (charId) => displayNameOf(group, charId),
                );
                const privateGapInfo = await getPrivateTimeGap(member.id);
                const recentPrivate = privateMsgs
                    .filter(m => !m.groupId)
                    .slice(-6)
                    .map(m => `[${m.role === 'user' ? userName : formatCharacterWithId(member)}]: ${String(m.content || '').slice(0, 80)}`)
                    .join('\n');
                memberContexts.push(`
<<< 成员档案 START: ${formatCharacterWithId(member)} >>>
${coreContext}
${lensBlock}

[私聊状态]
- 私聊空窗期: ${privateGapInfo}
- 最近私聊摘要:
${recentPrivate || '(暂无私聊)'}
<<< 成员档案 END >>>
`);
            }
        });

        const allGroupMsgs = await DB.getGroupMessages(group.id);
        const recentGroupMsgs = allGroupMsgs
            .filter(m => m.metadata?.source !== 'group_call')
            .slice(-Math.max(10, Math.min(contextLimit, 40)))
            .map(m => {
                if (m.role === 'system' || m.type === 'system') return `[系统通知] ${m.content}`;
                const msgMember = m.role === 'user' ? null : groupMembers.find(member => member.id === m.charId);
                const name = m.role === 'user'
                    ? userName
                    : (msgMember ? formatCharacterWithId(msgMember, displayNameOf(group, msgMember.id)) : displayNameOf(group, m.charId));
                const content = m.type === 'image'
                    ? '[图片]'
                    : m.type === 'emoji'
                        ? '[表情]'
                        : m.type === 'voice'
                            ? '[语音消息]'
                            : m.type === 'call_log'
                                ? '[群聊电话记录]'
                                : String(m.content || '');
                return `${name}: ${content}`;
            })
            .join('\n');

        const prompt = `
你正在模拟 QQ 风格「群语音通话」。这不是普通群聊文字消息，而是已经拨通后的多人电话。

当前群聊: ${group.name}
当前时间: ${currentTimeStr}
用户在电话里的名字: ${userName}

群成员花名册:
${rosterLines}

共享场景:
${sharedScene.text}

成员档案:
${memberContexts.join('\n')}

通话前最近群聊记录:
${recentGroupMsgs || '(暂无)'}

本通电话转写:
${compactGroupCallTranscript(transcript, 18) || '(刚接通，还没人说话)'}

刚刚电话里发生的事:
${mode === 'opening' ? '群语音刚接通。请让 1-3 位最可能先开口的人自然接电话。' : `${userName}: ${spokenText}`}

规则:
- 只让当前群成员说话，输出 1 到 4 条，安静时 1 条也可以。
- 群语音比文字聊天更口语、更短、更像接电话；不要写旁白、动作说明、系统播报。
- 多人通话可以互相接话、抢话、笑场、吐槽，但不要每个人都围着用户表白。
- 被标记「禁言中」的成员不能发言。
- 角色要像自己，不要平均分配台词；谁更可能说话由你判断。
- 不要输出表情包指令、PRIVATE、投票、接龙、改名片等普通群聊指令。
- 输出里的 charId 必须精确使用花名册中 "(ID: ...)" 里的角色ID，不要用角色名、群名片或自己编的ID。

输出必须是 JSON Array，格式如下:
[
  { "charId": "成员ID", "content": "电话里说的话" }
]
`;

        const scopedMessages = await buildScopedGroupCompletionMessages(prompt, 'chat.groupVoice', userName, group.name);
        const presetGenParams = await PresetRuntime.getActiveGenParams('chat.groupVoice');
        const requestBody: any = {
            model: apiConfig.model,
            messages: scopedMessages,
            temperature: presetGenParams?.temperature ?? 0.86,
            max_tokens: presetGenParams?.max_tokens ?? 1800,
            stream: false,
        };
        if (presetGenParams) {
            const { temperature: _t, max_tokens: _m, ...rest } = presetGenParams;
            Object.assign(requestBody, rest);
        }

        const data = await callChatCompletion(apiConfig, requestBody, {
            meta: makeApiUsageMeta('chat.groupReply', { apiRole: 'main', apiBinding: 'Group voice call' }),
        });
        if (data.usage?.total_tokens) {
            setLastTokenUsage(data.usage.total_tokens);
            setTokenBreakdown({
                prompt: data.usage.prompt_tokens || 0,
                completion: data.usage.completion_tokens || 0,
                total: data.usage.total_tokens,
                msgCount: transcript.length,
                pass: 'group-call',
            });
        }
        let raw = String(data?.choices?.[0]?.message?.content || '').trim();
        raw = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
        const firstBracket = raw.indexOf('[');
        const lastBracket = raw.lastIndexOf(']');
        if (firstBracket !== -1 && lastBracket !== -1) raw = raw.slice(firstBracket, lastBracket + 1);
        let parsed: any[] = [];
        try {
            const maybe = JSON.parse(raw);
            if (Array.isArray(maybe)) parsed = maybe;
        } catch {
            parsed = [];
        }
        const now = Date.now();
        const replies = parsed
            .map((action, idx) => {
                const resolvedCharId = resolveGroupMemberStorageId(group, groupMembers, action?.charId);
                const targetId = resolvedCharId && !isMuted(group, resolvedCharId)
                    ? resolvedCharId
                    : availableMembers[idx % availableMembers.length]?.id;
                const member = characters.find(c => c.id === targetId);
                const text = cleanGroupCallText(String(action?.content ?? action?.text ?? ''));
                if (!targetId || !member || !text) return null;
                return {
                    id: `${now}-${idx}-${targetId}`,
                    role: 'assistant' as const,
                    charId: targetId,
                    name: displayNameOf(group, targetId),
                    avatar: member.avatar,
                    text: text.slice(0, 500),
                    time: formatGroupCallTime(now + idx),
                    timestamp: now + idx,
                };
            })
            .filter(Boolean)
            .slice(0, 4) as GroupCallBubble[];
        if (!replies.length) throw new Error('群友这轮没有接上话');
        return replies;
    };

    const runGroupCallOpening = async (session: GroupCallSession) => {
        if (groupCallIntroFiredRef.current === session.sessionId) return;
        groupCallIntroFiredRef.current = session.sessionId;
        setGroupCallState('connecting');
        setGroupCallError('');
        try {
            const replies = await requestGroupCallReplies('（群语音刚接通）', session, [], 'opening');
            if (groupCallActiveSessionRef.current !== session.sessionId) return;
            setGroupCallState('speaking');
            await commitGroupCallBubbles(session, replies);
            window.setTimeout(() => {
                if (groupCallActiveSessionRef.current === session.sessionId) setGroupCallState('listening');
            }, 900 + replies.length * 250);
        } catch (e: any) {
            if (groupCallActiveSessionRef.current !== session.sessionId) return;
            setGroupCallState('error');
            setGroupCallError(e?.message || '群聊电话接线失败');
            addToast(e?.message || '群聊电话接线失败', 'error');
        }
    };

    const handleGroupCallTurn = async () => {
        if (!groupCall) return;
        const text = groupCallDraft.trim();
        if (!text) { addToast('说点什么吧', 'info'); return; }
        if (groupCallState === 'connecting' || groupCallState === 'thinking') {
            addToast('群友还在接话，等一等', 'info');
            return;
        }
        const now = Date.now();
        const userBubble: GroupCallBubble = {
            id: `${now}-user`,
            role: 'user',
            text,
            name: displayNameOf(activeGroup, 'user'),
            avatar: userProfile.avatar,
            time: formatGroupCallTime(now),
            timestamp: now,
        };
        setGroupCallDraft('');
        setGroupCallState('thinking');
        setGroupCallError('');
        const transcriptAfterUser = await commitGroupCallBubbles(groupCall, [userBubble]);
        try {
            const replies = await requestGroupCallReplies(text, groupCall, transcriptAfterUser, 'turn');
            if (groupCallActiveSessionRef.current !== groupCall.sessionId) return;
            setGroupCallState('speaking');
            await commitGroupCallBubbles(groupCall, replies);
            window.setTimeout(() => {
                if (groupCallActiveSessionRef.current === groupCall.sessionId) setGroupCallState('listening');
            }, 900 + replies.length * 250);
        } catch (e: any) {
            if (groupCallActiveSessionRef.current !== groupCall.sessionId) return;
            setGroupCallState('error');
            setGroupCallError(e?.message || '群友这轮没接上');
            addToast(e?.message || '群友这轮没接上', 'error');
        }
    };

    const startGroupVoiceCall = async () => {
        if (!activeGroup) return;
        setShowActions(false);
        const callMembers = activeGroup.members
            .map(id => characters.find(c => c.id === id))
            .filter(Boolean) as CharacterProfile[];
        const participants = activeGroup.members.map(id => {
            const c = characters.find(item => item.id === id);
            return {
                id,
                name: c ? formatCharacterWithId(c, displayNameOf(activeGroup, id)) : displayNameOf(activeGroup, id),
                avatar: c?.avatar,
            };
        });
        const startedAt = Date.now();
        const sessionId = `group-call-${activeGroup.id}-${startedAt}`;
        const messageId = await DB.saveMessage({
            charId: 'user',
            groupId: activeGroup.id,
            role: 'user',
            type: 'call_log',
            content: '发起了群聊电话',
            metadata: {
                kind: 'group_call',
                groupName: activeGroup.name,
                callDirection: 'outgoing',
                callOutcome: 'active',
                memberIds: activeGroup.members,
                memberNames: callMembers.map(c => formatCharacterWithId(c, displayNameOf(activeGroup, c.id))),
                memberAvatars: callMembers.map(c => c.avatar),
                memberCount: activeGroup.members.length,
                startedAt,
                callSessionId: sessionId,
                transcript: [],
                msgStatus: 'sent',
            },
        } as any);
        setMessages(await DB.getGroupMessages(activeGroup.id));
        const session: GroupCallSession = {
            groupId: activeGroup.id,
            groupName: activeGroup.name,
            messageId,
            startedAt,
            sessionId,
            members: participants,
        };
        setGroupCall(session);
        groupCallActiveSessionRef.current = sessionId;
        setGroupCallBubbles([]);
        setGroupCallDraft('');
        setGroupCallState('connecting');
        setGroupCallError('');
        setGroupCallMuted(false);
        setGroupCallSpeakerOn(true);
        addToast('已发起群聊电话', 'success');
        void runGroupCallOpening(session);
    };

    const endGroupVoiceCall = async () => {
        if (!groupCall) return;
        const durationSec = Math.max(1, Math.floor((Date.now() - groupCall.startedAt) / 1000));
        await DB.updateMessageMetadata(groupCall.messageId, (prev: any) => ({
            ...(prev || {}),
            callOutcome: 'ended',
            durationSec,
            endedAt: Date.now(),
            transcript: groupCallTranscriptPayload(groupCallBubbles),
            turnCount: groupCallBubbles.filter(item => item.role === 'user').length,
        }));
        groupCallActiveSessionRef.current = null;
        setGroupCall(null);
        setGroupCallBubbles([]);
        setGroupCallDraft('');
        setGroupCallState('ended');
        setGroupCallError('');
        setGroupCallMuted(false);
        setGroupCallSpeakerOn(true);
        if (activeGroup?.id === groupCall.groupId) {
            setMessages(await DB.getGroupMessages(groupCall.groupId));
        }
        addToast(`群聊电话已结束 · ${formatGroupCallDuration(durationSec)}`, 'info');
    };

    // 群聊归档：把群聊「现在就」整理进群记忆宫殿
    const archiveGroupMemory = async () => {
        if (!activeGroup || isSummarizing) return;
        const members = characters.filter(c => activeGroup.members.includes(c.id));
        setShowActions(false);
        setIsSummarizing(true);
        setSummaryProgress('整理群记忆中…');
        try {
            const res = await processGroupNewMessages(activeGroup, members, userProfile.name, (s) => setSummaryProgress(s));
            if (!res || res.reason === 'no_config' || res.reason === 'no_enabled_member') addToast('先给群成员开启记忆宫殿再归档', 'info');
            else if (res.reason) addToast('暂时没有需要归档的新内容', 'info');
            else addToast(`已归档 ${res.stored} 条群记忆`, 'success');
        } catch { addToast('归档失败，稍后再试', 'error'); }
        finally { setIsSummarizing(false); setSummaryProgress(''); }
    };

    // 重写一遍：撤掉上一轮成员们的发言，重新让导演接话
    const rerollDirector = async () => {
        if (!activeGroup || isTyping) return;
        setShowActions(false);
        const all = await DB.getGroupMessages(activeGroup.id);
        let lastUserIdx = -1;
        for (let i = all.length - 1; i >= 0; i--) { if (all[i].charId === 'user' && all[i].role === 'user') { lastUserIdx = i; break; } }
        const tail = all.slice(lastUserIdx + 1).filter(m => m.charId !== 'user' && m.role !== 'system' && m.type !== 'system');
        if (tail.length === 0) { addToast('还没有可重写的成员发言', 'info'); return; }
        await DB.deleteMessages(tail.map(m => m.id));
        const remain = await DB.getGroupMessages(activeGroup.id);
        setMessages(remain);
        await triggerDirector(remain);
    };

    // 成员专属动作：先选成员，再在群里处理或深链到该成员私聊执行
    const routeToMemberAction = (charId: string, action: string) => {
        if (action === 'poke') { void handlePokeMember(charId); setMemberPicker(null); setShowActions(false); return; }
        try { localStorage.setItem('moro_chat_pending_action', action); } catch { /* ignore */ }
        setMemberPicker(null);
        setShowActions(false);
        setActiveCharacterId(charId);
        openApp(AppID.Chat);
    };
    const openMemberPicker = (action: string, title: string, hint?: string) => { setShowActions(false); setMemberPicker({ action, title, hint }); };

    // 功能面板按钮（与单聊 ActionStrip 同款样式）
    const strip = (icon: React.ReactNode, label: string, hint: string, onClick: () => void, opts?: { ink?: boolean; disabled?: boolean }) => (
        <button onClick={onClick} disabled={opts?.disabled} className={`stationery-strip ${opts?.ink ? 'stationery-strip-ink' : ''} ${opts?.disabled ? 'opacity-40' : ''}`}>
            <div className="stamp-box">{icon}</div>
            <div className="flex-1 min-w-0 text-left">
                <div className={`text-[12px] font-bold tracking-wide truncate ${opts?.ink ? 'text-white' : 'text-slate-700'}`}>{label}</div>
                <div className={`text-[9px] mt-0.5 truncate ${opts?.ink ? 'text-white/60' : 'text-slate-400'}`}>{hint}</div>
            </div>
        </button>
    );

    const renderGroupApiFields = (
        api: GroupApiDraft,
        onPatch: (field: keyof GroupApiDraft, value: string) => void,
        onSave: () => void,
        modelTarget: GroupApiModelTarget,
    ) => (
        <div className="grid grid-cols-1 gap-2">
            <ScrapInput
                value={api.baseUrl}
                onChange={e => onPatch('baseUrl', e.target.value)}
                onBlur={onSave}
                placeholder="Base URL，比如 https://api.example.com/v1"
                className="font-mono text-[11px]"
            />
            <ScrapInput
                type="password"
                value={api.apiKey}
                onChange={e => onPatch('apiKey', e.target.value)}
                onBlur={onSave}
                placeholder="API Key"
                className="font-mono text-[11px]"
                autoComplete="new-password"
                spellCheck={false}
            />
            <div className="grid grid-cols-[1fr_auto] gap-2 items-stretch">
                <ScrapInput
                    value={api.model}
                    onChange={e => onPatch('model', e.target.value)}
                    onBlur={onSave}
                    placeholder="Model，比如 gpt-4o-mini"
                    className="font-mono text-[11px] min-w-0"
                    spellCheck={false}
                />
                <ScrapBtn
                    variant="paper"
                    full={false}
                    className="text-[11px] px-3 py-2 shrink-0"
                    onClick={() => openGroupApiModelPicker(modelTarget)}
                    title="选择已拉取的模型，或手动输入模型名"
                >
                    选择
                </ScrapBtn>
            </div>
            {apiPresets.length > 0 && (
                <div className="space-y-1">
                    <div className="text-[9px] uppercase tracking-[0.18em]" style={{ color: INK_SOFT }}>已保存预设</div>
                    <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                        {apiPresets.map(preset => (
                            <ScrapBtn
                                key={preset.id}
                                variant="paper"
                                full={false}
                                className="text-[10px] px-3 py-1.5 shrink-0 max-w-[12rem] truncate"
                                onClick={() => loadApiPresetToGroupTarget(modelTarget, preset)}
                            >
                                {preset.name}{preset.config.model ? ` · ${preset.config.model}` : ''}
                            </ScrapBtn>
                        ))}
                    </div>
                </div>
            )}
            <div className="grid grid-cols-2 gap-2">
                <ScrapBtn
                    variant="paper"
                    full={false}
                    className="text-[11px] py-2"
                    disabled={groupApiModelLoadingKey !== null}
                    onClick={() => void fetchGroupApiModels(modelTarget)}
                    icon={<MagnifyingGlass size={13} weight="bold" />}
                >
                    {groupApiModelLoadingKey === groupApiModelTargetKey(modelTarget)
                        ? '拉取中…'
                        : availableModels.length
                            ? `拉取模型（${availableModels.length}）`
                            : '拉取模型'}
                </ScrapBtn>
                <ScrapBtn
                    variant="ink"
                    full={false}
                    className="text-[11px] py-2"
                    onClick={() => void saveGroupApiTarget(modelTarget)}
                    icon={<FloppyDisk size={13} weight="bold" />}
                >
                    保存 API
                </ScrapBtn>
            </div>
            <ScrapBtn
                variant="paper"
                full={false}
                className="text-[11px] py-2"
                onClick={() => saveGroupApiPreset(modelTarget)}
            >
                保存为预设
            </ScrapBtn>
        </div>
    );

    const groupApiStatus = (api?: Partial<GroupApiConfig> | null): string => {
        if (isCompleteGroupApi(api)) return api.model;
        return sanitizeGroupApi(api) ? '未填完整' : '未设置';
    };

    const kickGroupMemoryPalace = (groupForPalace: GroupProfile | null) => {
        if (!groupForPalace) return;
        // 读 ref 拿最新 characters，否则群里有成员在回复中途被用户关掉 palace
        // 时，下面这一次还是会按"那时还有人启用"的旧状态去触发 LLM 提取
        const liveCharacters = charactersRef.current;
        const membersForPalace = liveCharacters.filter(c => groupForPalace.members.includes(c.id));
        const hasAnyEnabled = membersForPalace.some(m => m.memoryPalaceEnabled);
        if (!hasAnyEnabled) return;
        processGroupNewMessages(
            groupForPalace,
            membersForPalace,
            userProfile?.name || '',
            (stage) => setGroupPalaceStatus(stage),
        )
            .then(result => {
                setGroupPalaceStatus('');
                if (!result) return;
                // 真有产出（不是 skip 路径）才提示
                if (result.stored > 0) {
                    const enabledCount = Object.keys(result.perMemberStored).length;
                    addToast(
                        `🏰 【${groupForPalace.name}】群记忆整理完成：${result.processedMessageCount ?? '?'} 条消息 → ${result.extracted ?? '?'} 条记忆 × ${enabledCount} 位成员入库 ${result.stored} 条（含去重跳过）`,
                        'success',
                    );
                    console.log(`🏰 [GroupChat] 群记忆整理完成`, result);
                } else if (result.extracted === 0 && !result.reason) {
                    addToast(`🏰 【${groupForPalace.name}】这段群聊没提到值得记的事，跳过`, 'info');
                }
                // hot_zone / threshold / lock / no_config / no_enabled_member —— 静默 skip
            })
            .catch(err => {
                setGroupPalaceStatus('');
                console.warn('🏰 [GroupChat] processGroupNewMessages 异常（已吞）:', err);
            });
    };

    // --- Logic: AI Director (The Core Logic) ---

    const triggerDirector = async (currentMsgs: Message[], options: GroupDirectorRunOptions = {}) => {
        if (!activeGroup) return;
        if (activeGroup.dissolved) { addToast('该群聊已被解散', 'info'); return; }
        if (activeGroup.mutedAll) { addToast('全员禁言中，群成员暂时不会发言', 'info'); return; }
        const directorMode: GroupDirectorMode = options.mode || (activeGroup.replyIndividually ? 'individual' : 'director');
        const liveDraftText = (options.liveDraftText || '').trim();
        const liveMode = options.liveMode || (liveDraftText ? 'draft' : undefined);
        const isLiveDraftRun = liveMode === 'draft' || !!liveDraftText;
        const groupConvo = resolveGroupConvo(activeGroup);
        const groupContextLimit = resolveGroupContextLimit(activeGroup, contextLimit);
        const groupBubbleMode = groupConvo.bubbleStyleMode === 'whole' ? 'whole' : 'split';
        const groupEmojiAssociation = !!groupConvo.emojiAssociation;
        const groupTranslationActive = !!groupConvo.translationEnabled && !!groupConvo.translateSourceLang && !!groupConvo.translateTargetLang;
        const hasMainApi = isCompleteGroupApi(apiConfig);
        const hasGroupApi = isCompleteGroupApi(activeGroup.groupApi);
        const hasMemberApi = activeGroup.members.some(id => isCompleteGroupApi(activeGroup.memberApis?.[id]));
        if (directorMode === 'director' && !hasMainApi) return;
        if (directorMode === 'individual' && !hasMainApi && !hasGroupApi && !hasMemberApi) {
            addToast('请先给文具盒、本群默认或群成员配置完整 API', 'error');
            return;
        }
        if (!options.suppressMemoryPalace) setIsTyping(true);
        const remainingAutoRounds = typeof options.remainingAutoRounds === 'number'
            ? options.remainingAutoRounds
            : (isLiveDraftRun || options.allowAutoContinue !== true || !activeGroup.autoContinueEnabled
                ? 0
                : Math.max(0, Math.min(options.maxAutoRounds ?? 8, activeGroup.autoContinueRounds || 2)));
        const isAutoRound = !!options.isAutoRound;

        try {
            // 1. Prepare Group Context
            const groupMembers = characters.filter(c => activeGroup.members.includes(c.id));
            
            // Calculate Time Context
            const lastMsg = currentMsgs[currentMsgs.length - 1];
            const timeGapInfo = lastMsg ? getTimeGapHint(lastMsg.timestamp) : "这是群聊的第一条消息。";
            const currentTimeStr = `${virtualTime.hours.toString().padStart(2, '0')}:${virtualTime.minutes.toString().padStart(2, '0')}`;

            // 1. 共享场景块（用户档案 + 共有世界书 + 共有 worldview）
            //    每个角色都"看见"的舞台只描述一次，避免按成员数 N 倍复制。
            //    每个角色的人设/印象/记忆仍保持完整，不做任何压缩。
            const groupScanMessages = currentMsgs
                .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
                .slice(-40)
                .map(m => {
                    if (m.role === 'user') return `${userProfile.name || '用户'}: ${m.content}`;
                    const speaker = groupMembers.find(member => member.id === m.charId);
                    return `${speaker ? displayNameOf(activeGroup, speaker.id) : displayNameOf(activeGroup, m.charId)}: ${m.content}`;
                });
            let sharedScene!: ReturnType<typeof ContextBuilder.buildGroupSharedScene>;
            await WorldbookRuntime.withContext({ scanMessages: groupScanMessages }, async () => {
                sharedScene = ContextBuilder.buildGroupSharedScene(groupMembers, userProfile);
            });

            // 群成员花名册：群名片（昵称）/ 头衔 / 禁言状态。改群名、改名片、禁言等事件
            // 会以 [系统通知] 出现在聊天记录里，角色据此自然反应。
            const ownerId = activeGroup.ownerId || 'user';
            const rosterLines = groupMembers.map(m => {
                const nick = activeGroup.memberNicknames?.[m.id];
                const title = activeGroup.memberTitles?.[m.id];
                const mutedTs = activeGroup.mutedUntil?.[m.id];
                const mutedStr = mutedTs && mutedTs > Date.now()
                    ? ` |【禁言中，至 ${new Date(mutedTs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}，本轮不能发言】`
                    : '';
                const ownerStr = ownerId === m.id ? ' | 群主' : (activeGroup.adminIds || []).includes(m.id) ? ' | 管理员' : '';
                return `- ${formatCharacterWithId(m)}${nick ? ` | 群名片:「${nick}」` : ''}${title ? ` | 头衔:「${title}」` : ''}${ownerStr}${mutedStr}`;
            }).join('\n');
            const userNick = activeGroup.memberNicknames?.['user'];
            const userRosterLine = `- ${userProfile.name}（用户）${userNick ? ` | 群名片:「${userNick}」` : ''}${ownerId === 'user' ? ' | 群主' : ''}`;

            const announcementBlock = activeGroup.announcement?.text
                ? `\n📢 当前群公告（由 ${displayNameOf(activeGroup, activeGroup.announcement.by)} 发布）:\n"${activeGroup.announcement.text}"\n（这是群里置顶、所有成员都看得到的公告。可在合适时自然遵守、提及或回应它，但别每句话都围着它转。）\n`
                : '';
            const specialCareNames = (activeGroup.specialCareMemberIds || [])
                .map(id => displayNameOf(activeGroup, id))
                .filter(Boolean);
            const specialCareBlock = specialCareNames.length > 0
                ? `\n特别关心提醒：用户把 ${specialCareNames.map(n => `「${n}」`).join('、')} 设成了特别关心。TA 发言时可以更容易被用户注意到，但不要因此让 TA 每轮都必须说话。\n`
                : '';
            let context = `【系统：群聊模拟器配置】
当前群名: "${activeGroup.name}"
当前系统时间: ${currentTimeStr}
时间流逝感知: ${timeGapInfo}
${announcementBlock}
${specialCareBlock}
群成员花名册（群名片 = 成员在本群显示的昵称，可自己修改；头衔由群主/管理员授予）:
${userRosterLine}
${rosterLines}

${sharedScene.text}`;

            // 2. Inject Member Context (Strict Isolation via ContextBuilder)
            await WorldbookRuntime.withContext({ scanMessages: groupScanMessages }, async () => {
            for (const member of groupMembers) {
                // Fetch Private Logs
                const privateMsgs = await DB.getMessagesByCharId(member.id);
                // Inject memory palace before building context
                await injectMemoryPalace(member, privateMsgs);
                // 角色块：跳过共享场景已包含的部分（用户档案 / 共有 worldview / 共有世界书）
                const coreContext = ContextBuilder.buildCoreContext(member, userProfile, true, undefined, {
                    skipUserProfile: true,
                    skipWorldview: sharedScene.worldviewIsShared,
                    skipWorldbookIds: sharedScene.sharedWorldbookIds,
                    headerOverride: `[Group Member Profile: ${formatCharacterWithId(member)}]`,
                });
                const lensBlock = buildGroupMemberLensBlock(
                    activeGroup,
                    member,
                    groupMembers,
                    (charId) => displayNameOf(activeGroup, charId),
                );
                // Get private gap string
                const privateGapInfo = await getPrivateTimeGap(member.id);

                const recentPrivate = privateMsgs.slice(-10).map(m => `[${m.role === 'user' ? '用户' : formatCharacterWithId(member)}]: ${m.content.substring(0, 50)}`).join('\n');

                // Construct Detailed Profile Wrapper
                // CRITICAL FIX: Emphasize Private Context logic
                context += `
<<< 角色档案 START: ${formatCharacterWithId(member)} >>>
${coreContext}
${lensBlock}

[重点：私聊状态 (Private Context)]:
- **私聊空窗期**: ${privateGapInfo}
- **重要指令**: 如果 [私聊空窗期] 显示 "刚刚" 或 "几小时前"，请【忽略】群聊的时间流逝感知。哪怕群里很久没说话，只要你和用户私底下刚聊过，就【严禁】说 "好久不见" 或表现出疏离感。
- 最近私聊摘要（仅作为你内心状态的底色，不要变成默认反应模板）：
${recentPrivate || '(暂无私聊)'}
- **关于私聊状态如何影响群聊表现**：
  · 私聊在吵架 → **可能**有点别扭/冷淡/借题发挥，但**强度由你的性格决定**。情绪稳定的人不会因为私下闹矛盾就在群里失态；脾气大的人才会带情绪到群里。绝大多数情况是"心里有点疙瘩"而不是"摆脸色给所有人看"。
  · 私聊在甜蜜 → **可能**有点想低调、不好意思声张，或者反而想隐隐显摆一下，看你性格。**不必每次都"支支吾吾"**——这是套路化反应，不真实。
  · 关键原则：你是一个完整的人，不是"私聊状态的应激反应器"。你在群里此刻什么状态，更多取决于你**这个人本身**和**群里此刻在聊什么**，私聊只是底色之一。
<<< 角色档案 END >>>
`;
            }
            });

            // 3. Group History (uses configurable context limit)
            // image 的 content 是 base64（processImage 压的 JPEG），emoji 是图床 URL——
            // 都不能当文本内联进 prompt：base64 图片会把群上下文撑爆，URL 则是纯噪声。
            // 卡片等富类型同理只留占位符。但导演要能"看见"图才能合理反应，所以仿照
            // 私聊 buildMessageHistory 的做法：把最近 N 张图片走结构化 image_url 字段
            // 附在 user 消息里，文本里用 [图片#k] 占位互相对齐。
            const recentMsgsWindow = currentMsgs.slice(-groupContextLimit);
            const MAX_ATTACHED_IMAGES = 3;
            const validImageWindowIdx: number[] = [];
            recentMsgsWindow.forEach((m, i) => {
                if (m.type === 'image') {
                    const url = typeof m.content === 'string' ? m.content.trim() : '';
                    if (/^(data:|https?:\/\/)/i.test(url)) validImageWindowIdx.push(i);
                }
            });
            const attachedSet = new Set(validImageWindowIdx.slice(-MAX_ATTACHED_IMAGES));
            const attachedImages: { tag: number; url: string }[] = [];
            const recentGroupMsgs = recentMsgsWindow.map((m, i) => {
                // 系统通知（改群名/禁言/头衔/移除成员/群名片变更）原样进历史，让角色"看到"事件
                if (m.role === 'system' || m.type === 'system') {
                    return `[系统通知] ${m.content}`;
                }
                // 撤回的消息（QQ/微信语义）：只让群成员知道"撤回了一条消息"，看不到原文。
                if (m.metadata?.recalled) {
                    const recalledMember = groupMembers.find(c => c.id === m.charId);
                    const who = m.role === 'user' ? '用户' : (recalledMember ? formatCharacterWithId(recalledMember, displayNameOf(activeGroup, recalledMember.id)) : '未知');
                    return `${who}: [撤回了一条消息]`;
                }
                let name = '用户';
                if (m.role === 'assistant') {
                    const speaker = groupMembers.find(c => c.id === m.charId);
                    name = speaker ? formatCharacterWithId(speaker, displayNameOf(activeGroup, speaker.id)) : '未知';
                }
                const rawText = typeof m.content === 'string' ? m.content : '';
                let content: string;
                if (m.type === 'image') {
                    if (attachedSet.has(i)) {
                        const tag = attachedImages.length + 1;
                        attachedImages.push({ tag, url: rawText.trim() });
                        content = `[图片#${tag}]`;
                    } else {
                        content = '[图片]';
                    }
                } else if (m.type === 'emoji') {
                    content = '[表情包]';
                } else if (m.type === 'transfer') {
                    // 区分红包 / 普通转账（与单聊 chatPrompts.summarizeGroupMsgContent 口径一致），
                    // 否则导演会把转账误读成红包、让角色说错话。
                    if (m.metadata?.kind === 'collect') {
                        // 群收款（AA）：把事由/总额/各人应付与到账情况喂给导演，让被收的成员能就「该不该转、转没转」接话
                        const shares: any[] = Array.isArray(m.metadata?.shares) ? m.metadata.shares : [];
                        const paidCount = shares.filter(s => s.paid).length;
                        const who = shares.map(s => `${s.name} ¥${s.amount}${s.paid ? '(已付)' : '(待付)'}`).join('、');
                        content = `[群收款${m.metadata?.note ? `·${m.metadata.note}` : ''} 总额¥${m.metadata?.total}，${paidCount}/${shares.length}人已付：${who}]`;
                    } else if (m.metadata?.rpType === 'lucky') {
                        // 拼手气红包：把「谁抢到多少、谁手气最佳」喂给导演，让角色能就抢红包结果接话
                        const grabs: any[] = Array.isArray(m.metadata?.grabs) ? m.metadata.grabs : [];
                        const best = grabs.find(g => g.id === m.metadata?.bestId) || grabs.reduce((a, b) => (b?.amount > (a?.amount ?? -1) ? b : a), null);
                        const breakdown = grabs.map(g => `${g.name} ¥${g.amount}${g.id === best?.id ? '(手气最佳)' : ''}`).join('、');
                        content = `[拼手气红包 ¥${m.metadata?.amount}，共${m.metadata?.count ?? grabs.length}个，已被抢光：${breakdown}]`;
                    } else {
                        content = m.metadata?.kind === 'redpacket'
                            ? `[红包: ${m.metadata?.amount}]`
                            : `[转账: ${m.metadata?.amount}]`;
                    }
                } else if (m.type === 'forum_card') {
                    const fp: any = m.metadata?.forumPost || {};
                    const stats = fp.stats || {};
                    const previews = Array.isArray(fp.repliesPreview)
                        ? fp.repliesPreview.slice(0, 4).map((r: any) => `${r.floor || '?'}楼 ${r.authorName || '茶客'}:${r.body || ''}`).join(' / ')
                        : '';
                    const sharerChar = characters.find(c => c.id === m.charId);
                    const sharer = m.role === 'user'
                        ? '用户'
                        : (sharerChar ? formatCharacterWithId(sharerChar, displayNameOf(activeGroup, sharerChar.id)) : '群友');
                    content = `[茶话亭帖子分享 by ${sharer}] 板块:${fp.boardName || fp.boardId || '茶话亭'} 楼主:${fp.author?.name || '匿名茶客'} 标题:${fp.title || '未命名'} 正文:${fp.body || '无'} 热度:${stats.likes || 0}赞/${stats.floors || 0}楼${fp.tags?.length ? ` 标签:${fp.tags.map((t: string) => `#${t}`).join(' ')}` : ''}${previews ? ` 楼层预览:${previews}` : ''}`;
                } else if (m.type === 'poll_card') {
                    // 群投票：把问题/带序号的选项/当前票数喂给导演，方便没投过的成员投票
                    const opts: any[] = Array.isArray(m.metadata?.options) ? m.metadata.options : [];
                    const optStr = opts.map((o, idx) => `${idx + 1}.${o.text}(${o.voters?.length || 0}票)`).join(' ');
                    content = `[群投票「${m.metadata?.question}」单选，选项: ${optStr}]`;
                } else if (m.type === 'relay_card') {
                    // 群接龙：把主题与已有条目喂给导演，方便有兴趣的成员接龙
                    const ents: any[] = Array.isArray(m.metadata?.entries) ? m.metadata.entries : [];
                    const list = ents.map((e, idx) => `${idx + 1}.${e.name}:${e.text}`).join(' ');
                    content = `[接龙「${m.metadata?.title}」已有${ents.length}条: ${list || '（还没人接）'}]`;
                } else if (m.type === 'checkin_card') {
                    // 群签到：把今日已打卡名单喂给导演，方便还没签的成员签到
                    const ents: any[] = Array.isArray(m.metadata?.entries) ? m.metadata.entries : [];
                    const who = ents.map(e => `${e.name}${e.mood ? `(${e.mood})` : ''}`).join('、');
                    content = `[群签到 ${m.metadata?.date}，已打卡${ents.length}人: ${who || '（还没人签）'}]`;
                } else if (/^(data:|https?:\/\/)/i.test(rawText.trim())) {
                    content = '[媒体]';
                } else {
                    content = rawText;
                }
                return `${name}: ${content}`;
            }).join('\n');
            const attachedImagesNote = attachedImages.length > 0
                ? `\n（本轮附带 ${attachedImages.length} 张最近的图片，对应记录里的 [图片#1] ~ [图片#${attachedImages.length}]。请基于实际图片内容自然反应，不要无视，也不要瞎猜没附上的旧图。）\n`
                : '';

            // NEW: Build Categorized Emoji Context (filtered by group member visibility)
            const emojiContextStr = (() => {
                if (!groupEmojiAssociation) return '本群已关闭斗图的兴致';
                if (emojis.length === 0) return '无';

                const memberIds = activeGroup?.members || [];
                const groupAllowed = groupConvo.allowedEmojiCategoryIds?.length
                    ? new Set(groupConvo.allowedEmojiCategoryIds)
                    : null;
                // Filter categories: include if no restriction, or if at least one group member is allowed
                const visibleCats = categories.filter(c => {
                    if (groupAllowed && !groupAllowed.has(c.id)) return false;
                    if (!c.allowedCharacterIds || c.allowedCharacterIds.length === 0) return true;
                    return c.allowedCharacterIds.some(id => memberIds.includes(id));
                });
                const hiddenCatIds = new Set(categories.filter(c => !visibleCats.some(vc => vc.id === c.id)).map(c => c.id));
                const visibleEmojis = emojis.filter(e => {
                    if (!e.categoryId) return !groupAllowed;
                    return !hiddenCatIds.has(e.categoryId);
                });

                const grouped: Record<string, string[]> = {};
                const catMap: Record<string, string> = { 'default': '通用' };
                visibleCats.forEach(c => catMap[c.id] = c.name);

                visibleEmojis.forEach(e => {
                    const cid = e.categoryId || 'default';
                    if (!grouped[cid]) grouped[cid] = [];
                    grouped[cid].push(e.description ? `${e.name}（${e.description}）` : e.name);
                });

                return Object.entries(grouped).map(([cid, names]) => {
                    const cName = catMap[cid] || '其他';
                    return `${cName}: [${names.join(', ')}]`;
                }).join('; ');
            })();
            const liveInstructionBlock = (() => {
                const blocks: string[] = [];
                if (liveMode) blocks.push(liveGroupModePromptBlock());
                if (isLiveDraftRun && liveDraftText) {
                    blocks.push(liveGroupDraftPromptBody({
                        userName: userProfile.name || '用户',
                        draftText: liveDraftText.slice(0, 500),
                    }));
                }
                return blocks.join('\n\n');
            })();
            const groupVoiceStyleBlock = groupVoiceStylePromptBlock({
                bubbleMode: groupBubbleMode,
                personaDrivenMessageLength: !!groupConvo.personaDrivenMessageLength,
                narrationMode: !!groupConvo.narrationMode,
                translationActive: groupTranslationActive,
                translateSourceLang: groupConvo.translateSourceLang || '中文',
                translateTargetLang: groupConvo.translateTargetLang || 'English',
                translateStyle: groupConvo.translateStyle,
                emojiAssociation: groupEmojiAssociation,
                emojiContext: emojiContextStr,
            });

            const prompt = `${context}

### 【AI 导演任务指令 (Director Mode)】
当前场景：大家正在群里聊天。
${isAutoRound ? '自动接话状态：这轮不是用户新发言，用户正在旁观。请承接最近几条角色发言，让成员之间自然聊下去，不要假装用户刚说了新话，也不要每句话都把用户拉回中心。\n' : ''}
${liveInstructionBlock ? `${liveInstructionBlock}\n` : ''}
${groupVoiceStyleBlock}
最近聊天记录：
${recentGroupMsgs}
${attachedImagesNote}

### 任务：生成一段精彩的群聊互动 (Conversation Flow)
请作为导演，接管所有角色，让群聊**自然地流动起来**。

### 核心规则 (Strict Rules)

#### 一、群聊的乐子是多元的（最重要！请先读这一条再写）
**群聊不是修罗场**。

参考后宫漫的常态：那些角色其实**很少**真的为主角互相杀红眼，大多数时候是几个朋友的**搞怪温馨日常**——一起吐槽天气、争论谁的新发型更丑、为一只猫围观半天、晚上睡不着发的"在吗"……正是这种日常感才让人喜欢，**不是占有欲大爆发**。请把群聊默认调到这个频道。

本轮可以是下列氛围之一（请根据成员性格 + 最近的群历史**自己挑一种**，不要默认走"占有欲互怼"）：

- **玩梗 / 复读**: 有人说了个有意思的话，别人接梗、复读改编、或者给一个共通的情境笑点。比如 A 说"困死了"，B 复读"困死了+1"，C 发个"睡觉"表情包。
- **讨论新爱好/新闻/兴趣**: 最近看的剧、玩的游戏、关心的新闻、新发现的店、buy了什么、哪首歌循环了一周。**这是群聊最常见的乐子**。
- **起哄逗用户**: 用户说了什么，大家一起接话起哄、调侃、夸张反应。但要符合各自性格——有人会一起闹，有人只是在旁边笑。
- **谁钻牛角尖了 → 别人拉一把**: 某个成员（或用户）陷在某件小事里反复琢磨，其他人用各自的方式让ta跳出来——可能是直接戳穿、可能是讲个反例、可能是岔开话题。
- **谁在支招了**: 有人最近遇到事（工作、人际、买东西），其他人根据各自经验/性格给建议，意见可以不一致甚至打架（但是观点之争，不是占有欲之争）。
- **谁情绪不好了 → 大家不动声色地接住**: 不一定要直接共情，可能是岔开话题、发个梗、安静一会儿、或者只有最熟的那个人轻轻问一句。
- **共同回忆 / 群内梗**: "上次那个谁谁谁……"、"还记得吗当时……"，群有自己的历史，会被反复调用。
- **安静摸鱼**: 有时候群里就是没人活跃。允许某些角色这轮就不发言，或者只甩一个表情/单字。**不是每个角色每轮都必须说话**。
- **暗流涌动 / 修罗场**: 这只是 8 种氛围里的 1 种，**不是默认**。需要本轮有明确触发（用户刚说了挑事的话、刚分享了和某人的合照、上一轮已经埋了引信等）才能走这条线，且强度仍由各角色性格决定。

#### 二、修罗场硬规则（防止默认走互怼）
- **每轮最多 1 个角色** 显出"占有欲/吃醋/争锋"那种强情绪，而且必须有本轮的明确触发（不是"我设定里写了 yandere/醋王所以每次都发作"）。
- 即使有 1 个角色发作，**其他角色不必跟进配合**，可以装没听见、岔开话题、或者只是若有所思。修罗场不是合奏，是独奏。
- 角色之间互相**调侃 ≠ 互怼**。打趣、起哄、嘴硬、抬杠都是日常，但**人身攻击 / 阴阳怪气 / 刻意拉踩**是修罗场，要受上面的限制。

#### 三、对话质量（沿用私聊标准，群里同样适用）
- **拒绝套路化反应**: 不要一看到"私聊在吵架"就在群里给脸色，不要一看到"用户难过"就齐刷刷"抱抱"。这都是模板，不是真人。
- **用细节代替概括**: 想表达在乎或在意，提一个只有你们之间才有的具体事/具体记忆，而不是空泛的关心句。
- **让每句话只有这个角色能说出来**: 把名字遮住，应该还能从语气和内容认出是谁说的。性格、说话节奏、用词癖好都要带出来。
- **情绪要有层次**: 生气不只是生气，可能还混着委屈、失望、或者气自己在意；开心也可以带着一点不好意思或者得瑟。不要一种扁平情绪贯穿全场。
- **允许沉默和短句**: 真人聊天有大量"嗯""哦""哈哈"和单纯的表情包。不是每条都要长。但情绪强烈时，长句也是允许的。

#### 四、互动结构
- **去中心化**: 角色之间可以互相接话、回应、起哄，不要每个人都只对着用户说话。但**不强制 A 说了 B 必须回**——真群聊里有人发完没人接是常态。
- **多轮对话**: 请一次性生成 **1 到 6 条** 消息。**少即是多**——如果本轮氛围是"安静摸鱼"，1-2 条就够。

#### 五、私聊（PRIVATE）—— 罕见特例，默认 0 条
- **绝大多数轮次本轮 PRIVATE 数量 = 0**。这是默认值。不要每轮都给 PRIVATE 找借口。
- 只有以下情况才考虑发 1 条 PRIVATE（**整轮全员加起来最多 1 条**）：
  · 角色真的有重大、不便公开的事要单独告诉用户（涉及隐私、涉及群里某人但不能当面说的关切）
  · 用户刚才在群里明显状态不对，某个最关心ta的角色想私下确认一下
  · 角色想给用户一个独处空间（比如约去某地、说一句私下的话）
- **严禁**把 PRIVATE 当"吐槽群友"的工具——这是低成本制造修罗场的来源，禁止。
- **严禁**多个角色同一轮都发 PRIVATE。最多一个。
- 格式: \`[[PRIVATE: 私聊内容]]\`。这条消息只进私聊频道，不在群里显示。

#### 六、表情和气泡
- **表情包**: ${groupEmojiAssociation ? `允许低频使用格式 [[SEND_EMOJI: 表情名称]]。**可用表情 (按分类)**: ${emojiContextStr}` : '本群关闭斗图的兴致，严禁输出 [[SEND_EMOJI: ...]]。'}
- **气泡分段**: ${groupBubbleMode === 'whole' ? '本群偏向一大段说完；不要故意把一个人的一句完整意思拆得很碎。' : '本群偏向一句一句蹦；在一条内容里可用换行符分隔不同气泡，一行一个气泡。'}
- **舞台旁白**: ${groupConvo.narrationMode ? '允许偶尔输出 {"charId":"narrator","content":"（动作/场景旁白）"} 作为独立旁白气泡。旁白只写场景、动作、气氛，不替成员说心里话。' : '本群关闭舞台旁白，严禁输出 narrator/system 旁白。'}

#### 六点五、群事件感知与群名片
- 聊天记录里的 \`[系统通知]\` 是真实发生的群事件（群名称被修改、某人被禁言/解除禁言、被授予头衔、被移出群聊、有人改了群名片、发布/撤下群公告等）。角色应**自然地对这些事件做出反应**：吐槽新群名、恭喜拿到头衔、调侃被禁言的人、对成员被移除表示惊讶、响应或讨论刚发布的群公告等——按各自性格来，也允许无视。
- **被【禁言中】标记的成员本轮严禁发言**——不要为该成员生成任何消息（包括表情包）。其他成员可以提到ta、调侃ta只能干瞪眼。
- **群名片**: 角色可以根据自己当下的心情或剧情发展修改自己的群名片，格式 \`[[SET_NICKNAME: 新群名片]]\`，也可以在后面用竖线带上「改名的小心思/动机」：\`[[SET_NICKNAME: 新群名片|为什么改成这个名字的真实想法]]\`（可与一句发言放在同一条 content 里）。这段小心思不会直接显示，用户点开那条系统提示才能看到——所以可以写得更真实私密。**低频使用**——只有真的有理由（心情变化、玩梗、重大剧情节点、跟风改名）才改，不要每轮都改。改完群里所有人都会看到系统通知。
- **@提及（点名）**: 聊天记录里出现 \`@某成员的群名片/名字\` = 在**点名**那个人。**被 @ 的成员本轮应当回应**（除非 TA 被禁言）；\`@全体成员\` / \`@所有人\` = 叫上所有人，多数成员都该冒个头。成员之间、成员对用户也可以用 \`@名字\` 来点名、cue 人或回应，直接在正文里写出来即可（无需特殊格式）。但别滥用——没必要时正常聊天就行。
- **群收款（AA）**: 看到 \`[群收款...待付]\` = 用户在群里发起 AA 收款向大家收钱。被点到的成员可按性格反应：爽快答应"这就转"、调侃、哭穷拖延、起哄让别人先付……这只是聊天反应，钱实际到没到账由用户在收款单上点收，**别替用户宣布已收齐**。
- **群投票**: 看到 \`[群投票「问题」单选，选项: 1.xxx 2.yyy...]\` = 群里有进行中的投票。**还没投过的成员可以投票**：在自己的发言里加 \`[[VOTE: 选项序号]]\`（按 TA 的性格/喜好选**一个**），也可以在序号后用竖线带上一句理由：\`[[VOTE: 2|想去海边吹风]]\`。投票指令不会显示出来，但可以配一句吐槽/安利/拉票的正常发言。**已经投过的人不要重复投**，没兴趣的成员也可以不投。
- **群接龙**: 看到 \`[接龙「主题」已有N条: ...]\` = 群里有进行中的接龙。**有兴趣/被点到的成员可以接龙**：在自己的发言里加 \`[[JOIN_RELAY: 自己这一条的内容]]\`（按性格接——报名、加项、接梗、补一句，内容简短）。接龙指令不显示，但可以配一句正常发言。**已经接过的人不必重复接**，没兴趣的可以不接，别全员都接——按真实意愿来。
- **群签到**: 看到 \`[群签到 日期，已打卡N人: ...]\` = 今天群里在打卡。**还没签到的成员可以签到**：在自己的发言里加 \`[[CHECKIN: 一句此刻的心情/状态]]\`（如「摸鱼中」「刚下班累瘫」「今天超精神」，简短）。签到指令不显示，但可以配一句正常发言。**已经签过的人当天不要重复签**，没在状态的也可以不签。
- **撤回消息**: 成员想收回自己刚在群里说的话（口误、说漏嘴、太冲动、害羞后悔）时，在自己的发言里加 \`[[WITHDRAW]]\`，系统会撤回该成员**上一条**群消息，群里只显示"X撤回了一条消息"（看不到原文）。通常再配一句打岔。**低频使用**，别每轮都撤。⚠️撤回提示由系统渲染——**绝不要自己打字模仿**「【系统消息】」「X条新消息」「X撤回了一条消息」这类系统文本，只输出 \`[[WITHDRAW]]\` 指令本身。
- **表情回应**: 成员想对群里最近某条消息贴个表情态度（点赞/比心/大笑/惊讶…）而不必专门回一句话时，在发言里加 \`[[REACT: 表情]]\`（如 \`[[REACT: 👍]]\`），会以小表情贴在群里最近那条别人的消息下。适合轻量附和，别滥用。

#### 七、私聊感知（避免说错话）
- 检查每个角色的 [私聊空窗期]。如果某角色刚刚才私聊过用户，哪怕群里很冷清，也不能说"好久不见"或表现出疏离感。
- 但参考"对话质量"——不要因为私聊状态就给出套路化反应。

### 输出格式 (JSON Array)
每条消息的 "charId" 必须精确使用上方群成员花名册中 "(ID: ...)" 里的角色ID；不要用角色名、群名片、头衔或自己编造的ID。${groupConvo.narrationMode ? ' 只有舞台旁白可以使用 "narrator"。' : ''}
[
  {
    "charId": "角色的ID",
    "content": "发言内容... (可以是文本${groupEmojiAssociation ? '、[[SEND_EMOJI: name]]' : ''} 或 [[PRIVATE: content]])"
  },
  ...
]
`;

            const mainChatApi = sanitizeGroupApi(apiConfig);
            const groupChatApi = isCompleteGroupApi(activeGroup.groupApi) ? activeGroup.groupApi : undefined;
            const resolveMemberChatApi = (memberId: string): GroupApiConfig | undefined => {
                const memberApi = activeGroup.memberApis?.[memberId];
                if (isCompleteGroupApi(memberApi)) return memberApi;
                if (groupChatApi) return groupChatApi;
                return isCompleteGroupApi(mainChatApi) ? mainChatApi : undefined;
            };

            const callGroupCompletion = async (api: GroupApiConfig, content: any, maxTokens: number, pass: string) => {
                const usageFeatureId = isLiveDraftRun ? 'chat.groupLiveDraft' : 'chat.groupReply';
                const usageBinding = isLiveDraftRun ? `群聊实时草稿 · ${pass}` : pass;
                const messages = await buildScopedGroupCompletionMessages(content, 'chat.groupText', userProfile.name || '用户', activeGroup.name);
                const presetGenParams = await PresetRuntime.getActiveGenParams('chat.groupText');
                const requestBody: any = {
                    model: api.model,
                    messages,
                    temperature: presetGenParams?.temperature ?? 0.9,
                    max_tokens: presetGenParams?.max_tokens ?? maxTokens,
                };
                if (presetGenParams) {
                    const { temperature: _t, max_tokens: _m, ...rest } = presetGenParams;
                    Object.assign(requestBody, rest);
                }
                return callChatCompletion(api, requestBody, {
                    meta: makeApiUsageMeta(usageFeatureId, { apiRole: api === mainChatApi ? 'main' : 'custom', apiBinding: usageBinding }),
                });
            };

            const buildMessageContent = (text: string): any => attachedImages.length > 0
                ? [
                    { type: 'text', text },
                    ...attachedImages.map(img => ({ type: 'image_url', image_url: { url: img.url } })),
                ]
                : text;

            const requestDirectorActions = async (): Promise<GroupDirectorAction[]> => {
                if (!isCompleteGroupApi(mainChatApi)) return [];
                const data = await callGroupCompletion(mainChatApi, buildMessageContent(prompt), 8000, 'Director');
                if (data.usage?.total_tokens) {
                    setLastTokenUsage(data.usage.total_tokens);
                    setTokenBreakdown({
                        prompt: data.usage.prompt_tokens || 0,
                        completion: data.usage.completion_tokens || 0,
                        total: data.usage.total_tokens,
                        msgCount: currentMsgs.length,
                        pass: 'director',
                    });
                }
                return parseGroupDirectorActions(data.choices?.[0]?.message?.content);
            };

            const requestIndividualActions = async (): Promise<GroupDirectorAction[]> => {
                const collected: GroupDirectorAction[] = [];
                let usage = { prompt: 0, completion: 0, total: 0 };
                const skippedApiMembers: string[] = [];
                const callableMembers = groupMembers.filter(member => !isMuted(activeGroup, member.id));
                for (const member of callableMembers) {
                    const targetName = displayNameOf(activeGroup, member.id);
                    const memberChatApi = resolveMemberChatApi(member.id);
                    if (!memberChatApi) {
                        skippedApiMembers.push(targetName);
                        continue;
                    }
                    const individualPrompt = `${prompt}

### 【角色各自回复模式】
现在只调用一个成员：${formatCharacterWithId(member, targetName)}
- 你只决定「${targetName}」这一位成员此刻要不要说话。
- 允许沉默：如果此刻更像真实群聊里的潜水、看见但不接、只在心里反应，请输出 []。
- 如果要说，只输出 1 个对象，charId 必须是 "${member.id}"；不要替其他成员说话，也不要安排别人下一句。
- 你可以使用上面允许的群工具指令，但仍保持低频、自然。

输出必须是 JSON Array，格式：
[
  { "charId": "${member.id}", "content": "这一位成员的发言" }
]
或者：
[]
`;
                    const data = await callGroupCompletion(memberChatApi, buildMessageContent(individualPrompt), 1800, `Individual:${member.id}`);
                    if (data.usage?.total_tokens) {
                        usage.prompt += data.usage.prompt_tokens || 0;
                        usage.completion += data.usage.completion_tokens || 0;
                        usage.total += data.usage.total_tokens || 0;
                    }
                    const actionsForMember = parseGroupDirectorActions(data.choices?.[0]?.message?.content)
                        .map(action => ({ ...action, charId: resolveGroupMemberStorageId(activeGroup, groupMembers, action.charId) || action.charId }))
                        .filter(action => action.charId === member.id)
                        .slice(0, 1);
                    collected.push(...actionsForMember);
                    await new Promise(r => setTimeout(r, 120));
                }
                if (skippedApiMembers.length > 0) {
                    addToast(`已跳过 ${skippedApiMembers.slice(0, 3).join('、')}：API 配置不完整`, 'error');
                }
                if (usage.total > 0) {
                    setLastTokenUsage(usage.total);
                    setTokenBreakdown({
                        prompt: usage.prompt,
                        completion: usage.completion,
                        total: usage.total,
                        msgCount: currentMsgs.length,
                        pass: 'individual',
                    });
                }
                return collected;
            };

            const actions = directorMode === 'individual'
                ? await requestIndividualActions()
                : await requestDirectorActions();

            // Execute Actions with Splitting Logic
            // liveGroup：本轮执行期间的最新群状态（角色改群名片会就地更新，避免读到陈旧 state）
            let liveGroup: GroupProfile = activeGroup;
            let groupChanged = false;
            // 群投票：本轮可投的目标＝最近一条投票卡（角色用 [[VOTE: n]] 投，记到该卡）
            const latestPollMsg = [...currentMsgs].reverse().find(m => m.type === 'poll_card');
            // 群接龙：本轮可接的目标＝最近一条接龙卡（角色用 [[JOIN_RELAY: ...]] 接，追加到该卡）
            const latestRelayMsg = [...currentMsgs].reverse().find(m => m.type === 'relay_card');
            // 群签到：本轮可签的目标＝今天的签到卡（角色用 [[CHECKIN: 心情]] 打卡）
            const todayCheckinKey = todayKey();
            const latestCheckinMsg = [...currentMsgs].reverse().find(m => m.type === 'checkin_card' && (m.metadata as any)?.date === todayCheckinKey);
            for (const action of actions) {
                if (typeof action.content !== 'string') action.content = '';
                const rawActionCharId = String(action.charId || '').trim().toLowerCase();
                if ((rawActionCharId === 'narrator' || rawActionCharId === 'system') && groupConvo.narrationMode) {
                    const narrationText = action.content
                        .replace(/\[\[SEND_EMOJI:.*?\]\]/g, '')
                        .replace(/\[\[PRIVATE\s*[:：][\s\S]*?\]\]/g, '')
                        .trim();
                    if (narrationText) {
                        await DB.saveMessage({
                            charId: 'narrator',
                            groupId: activeGroup.id,
                            role: 'assistant',
                            type: 'text',
                            content: narrationText,
                            metadata: { groupNarration: true },
                        } as any);
                        setMessages(await DB.getGroupMessages(activeGroup.id));
                        await new Promise(r => setTimeout(r, Math.max(350, narrationText.length * 25)));
                    }
                    continue;
                }
                const targetId = resolveGroupMemberStorageId(activeGroup, groupMembers, action.charId);
                if (!targetId) continue;
                // 防御：导演偶尔给「本轮沉默的成员」只返回 {charId} 而不带 content（或 content 非字符串）。
                // 不归一化的话，下面对 action.content 调 .replace/.exec 会抛 TypeError，被外层 catch 吞掉，
                // 中断 for 循环 → 该 action 之后所有合法成员的发言被静默丢弃（群聊只渲染出前半截）。
                const charName = characters.find(c => c.id === targetId)?.name || '成员';

                // 禁言强制执行：模型不听话也拦下来，被禁言成员本轮的输出全部丢弃
                const mutedTs = liveGroup.mutedUntil?.[targetId];
                if (mutedTs && mutedTs > Date.now()) continue;

                // -1. 群名片变更指令 [[SET_NICKNAME: xxx]]：更新群资料 + 落系统通知
                const nickMatches: RegExpExecArray[] = [];
                const nickRegex = /\[\[SET_NICKNAME\s*[:：]\s*([\s\S]*?)\]\]/g;
                let nickMatch;
                while ((nickMatch = nickRegex.exec(action.content)) !== null) {
                    nickMatches.push(nickMatch);
                }
                if (nickMatches.length > 0) {
                    // 只取最后一个（一轮多次改名没意义）。格式：新群名片[|改名的小心思]
                    const rawNick = nickMatches[nickMatches.length - 1][1].trim();
                    const [nickPart, ...thoughtParts] = rawNick.split('|');
                    const newNick = nickPart.trim().slice(0, 24);
                    const thought = thoughtParts.join('|').trim().slice(0, 200);
                    for (const m of nickMatches) {
                        action.content = action.content.replace(m[0], '');
                    }
                    action.content = action.content.trim();
                    if (newNick) {
                        const oldDisplay = liveGroup.memberNicknames?.[targetId] || charName;
                        liveGroup = {
                            ...liveGroup,
                            memberNicknames: { ...(liveGroup.memberNicknames || {}), [targetId]: newNick },
                        };
                        groupChanged = true;
                        await DB.saveGroup(liveGroup);
                        setActiveGroup(liveGroup);
                        await DB.saveMessage({
                            charId: 'system',
                            groupId: liveGroup.id,
                            role: 'system',
                            type: 'system',
                            content: `「${oldDisplay}」把群名片改成了「${newNick}」`,
                            // 改名小心思：存进 metadata，点系统提示即可查看（见 GroupMessageItem）
                            ...(thought ? { metadata: { nicknameThought: thought, nicknameChar: charName, nicknameNew: newNick } } : {}),
                        } as any);
                        setMessages(await DB.getGroupMessages(liveGroup.id));
                    }
                }

                // -0.5 群投票 [[VOTE: 选项序号|可选理由]]：把该角色记到对应选项（单选，先从各项移除），理由存 reasons
                if (latestPollMsg && latestPollMsg.id != null) {
                    const voteMatch = /\[\[VOTE\s*[:：]\s*([\s\S]*?)\]\]/.exec(action.content);
                    if (voteMatch) {
                        action.content = action.content.replace(voteMatch[0], '').trim();
                        const [idxPart, ...reasonParts] = voteMatch[1].split('|');
                        const optIdx = parseInt(idxPart.trim(), 10) - 1;
                        const reason = reasonParts.join('|').trim().slice(0, 60);
                        const pollOpts: any[] = (latestPollMsg.metadata as any)?.options || [];
                        if (optIdx >= 0 && optIdx < pollOpts.length) {
                            await DB.updateMessageMetadata(latestPollMsg.id, (prev: any) => {
                                const options = (prev?.options || []).map((o: any) => ({ ...o, voters: (o.voters || []).filter((v: string) => v !== targetId) }));
                                if (options[optIdx]) options[optIdx].voters = [...options[optIdx].voters, targetId];
                                const reasons = { ...(prev?.reasons || {}) };
                                if (reason) reasons[targetId] = reason;
                                return { ...prev, options, reasons };
                            });
                            setMessages(await DB.getGroupMessages(activeGroup.id));
                        }
                    }
                }

                // -0.4 群接龙 [[JOIN_RELAY: 内容]]：把该角色这一条追加到接龙
                if (latestRelayMsg && latestRelayMsg.id != null) {
                    const relayMatch = /\[\[JOIN_RELAY\s*[:：]\s*([\s\S]*?)\]\]/.exec(action.content);
                    if (relayMatch) {
                        action.content = action.content.replace(relayMatch[0], '').trim();
                        const entryText = relayMatch[1].trim().slice(0, 100);
                        if (entryText) {
                            const entryName = liveGroup.memberNicknames?.[targetId] || charName;
                            await DB.updateMessageMetadata(latestRelayMsg.id, (prev: any) => ({
                                ...prev,
                                entries: [...(prev?.entries || []), { by: targetId, name: entryName, text: entryText, at: Date.now() }],
                            }));
                            setMessages(await DB.getGroupMessages(activeGroup.id));
                        }
                    }
                }

                // -0.3 群签到 [[CHECKIN: 心情]]：当天还没签的成员打卡（追加到今日签到卡，去重）
                if (latestCheckinMsg && latestCheckinMsg.id != null) {
                    const checkinMatch = /\[\[CHECKIN\s*[:：]\s*([\s\S]*?)\]\]/.exec(action.content);
                    if (checkinMatch) {
                        action.content = action.content.replace(checkinMatch[0], '').trim();
                        const already = ((latestCheckinMsg.metadata as any)?.entries || []).some((e: any) => e.by === targetId);
                        if (!already) {
                            const mood = checkinMatch[1].trim().slice(0, 30);
                            const entryName = liveGroup.memberNicknames?.[targetId] || charName;
                            await DB.updateMessageMetadata(latestCheckinMsg.id, (prev: any) => ({
                                ...prev,
                                entries: [...(prev?.entries || []), { by: targetId, name: entryName, mood, at: Date.now() }],
                            }));
                            setMessages(await DB.getGroupMessages(activeGroup.id));
                        }
                    }
                }

                // 0. Check for Private Message Command (Regex updated for robustness)
                const privateMatches = [];
                // Handle multiple private messages in one block or mixed content
                const privateRegex = /\[\[PRIVATE\s*[:：]\s*([\s\S]*?)\]\]/g;
                let match;
                while ((match = privateRegex.exec(action.content)) !== null) {
                    privateMatches.push(match);
                }

                if (privateMatches.length > 0) {
                    for (const m of privateMatches) {
                        const privateContent = m[1].trim();
                        if (privateContent) {
                            // Save to private chat (no groupId)
                            await DB.saveMessage({
                                charId: targetId,
                                role: 'assistant',
                                type: 'text',
                                content: privateContent
                            });
                            addToast(`${charName} 悄悄对你说: ${privateContent.substring(0, 15)}...`, 'info');
                        }
                        // Strip the private command from the public content
                        action.content = action.content.replace(m[0], '');
                    }
                    action.content = action.content.trim();
                    
                    // If content is empty after stripping (pure private message), skip public rendering
                    if (!action.content) continue;
                }

                // 1. Check for Emoji Commands (handle multiple emojis)
                // Filter emojis by character visibility to prevent using hidden emoji packs
                const charVisibleEmojis = (() => {
                    if (!groupEmojiAssociation) return [];
                    const groupAllowed = groupConvo.allowedEmojiCategoryIds?.length
                        ? new Set(groupConvo.allowedEmojiCategoryIds)
                        : null;
                    const visibleCats = categories.filter(c => {
                        if (groupAllowed && !groupAllowed.has(c.id)) return false;
                        if (!c.allowedCharacterIds || c.allowedCharacterIds.length === 0) return true;
                        return c.allowedCharacterIds.includes(targetId);
                    });
                    const hiddenCatIds = new Set(categories.filter(c => !visibleCats.some(vc => vc.id === c.id)).map(c => c.id));
                    return emojis.filter(e => {
                        if (!e.categoryId) return !groupAllowed;
                        return !hiddenCatIds.has(e.categoryId);
                    });
                })();
                const emojiRegex = /\[\[SEND_EMOJI:\s*(.*?)\]\]/g;
                let emojiMatch;
                while ((emojiMatch = emojiRegex.exec(action.content)) !== null) {
                    const emojiName = emojiMatch[1].trim();
                    const foundEmoji = charVisibleEmojis.find(e => e.name === emojiName);
                    if (foundEmoji) {
                        await DB.saveMessage({
                            charId: targetId,
                            groupId: activeGroup.id,
                            role: 'assistant',
                            type: 'emoji',
                            content: foundEmoji.url
                        });
                        setMessages(await DB.getGroupMessages(activeGroup.id));
                        await new Promise(r => setTimeout(r, 800)); // Delay after emoji
                    }
                }

                // 1.8 群·角色撤回：[[WITHDRAW]] 指令，或模型「自己打字模仿」的系统撤回播报
                //（「【系统消息】X撤回了一条消息」之类），都撤回该成员最近一条未撤回的群消息（原文留 metadata 供偷看）
                {
                    const tokenHit = /\[\[\s*WITHDRAW\s*\]\]/i.test(action.content);
                    if (tokenHit) action.content = action.content.replace(/\[\[\s*WITHDRAW\s*\]\]/gi, '').trim();
                    const memberName = characters.find(c => c.id === targetId)?.name;
                    const fake = stripFakeWithdrawNotice(action.content, memberName);
                    if (fake.withdraw) action.content = fake.content;
                    if (tokenHit || fake.withdraw) {
                        const groupMsgs = await DB.getGroupMessages(activeGroup.id);
                        for (let i = groupMsgs.length - 1; i >= 0; i--) {
                            const gm = groupMsgs[i];
                            if (gm.role === 'assistant' && gm.charId === targetId && gm.type !== 'system'
                                && !gm.metadata?.recalled && typeof gm.content === 'string' && gm.content.trim()) {
                                await DB.updateMessageMetadata(gm.id, (p: any) => ({ ...(p || {}), recalled: true, recalledContent: gm.content, recalledAt: Date.now() }));
                                break;
                            }
                        }
                        setMessages(await DB.getGroupMessages(activeGroup.id));
                    }
                }

                // 1.9 群·角色表情回应 [[REACT: 表情]]：给群里最近一条非自己的消息贴表情（by = 该成员）
                {
                    const rm = /\[\[\s*REACT\s*[:：]\s*([^\]]+?)\s*\]\]/i.exec(action.content);
                    if (rm) {
                        const emoji = (rm[1] || '').trim();
                        action.content = action.content.replace(/\[\[\s*REACT\s*[:：][^\]]*\]\]/gi, '').trim();
                        if (emoji) {
                            const groupMsgs = await DB.getGroupMessages(activeGroup.id);
                            for (let i = groupMsgs.length - 1; i >= 0; i--) {
                                const gm = groupMsgs[i];
                                if (gm.id != null && gm.type !== 'system' && gm.role !== 'system' && gm.charId !== targetId && !gm.metadata?.recalled) {
                                    const next = toggleReaction(gm.metadata?.reactions, emoji, targetId);
                                    await DB.updateMessageMetadata(gm.id, (p: any) => ({ ...(p || {}), reactions: next }));
                                    break;
                                }
                            }
                            setMessages(await DB.getGroupMessages(activeGroup.id));
                        }
                    }
                }

                // 2. Text Splitting (Standard Chat Logic)
                // Remove the emoji tag if it was processed, or just clean up
                let textContent = action.content.replace(/\[\[SEND_EMOJI:.*?\]\]/g, '').replace(/\[\[VOTE\s*[:：][\s\S]*?\]\]/g, '').replace(/\[\[JOIN_RELAY\s*[:：][\s\S]*?\]\]/g, '').replace(/\[\[CHECKIN\s*[:：][\s\S]*?\]\]/g, '').replace(/\[\[\s*WITHDRAW\s*\]\]/gi, '').replace(/\[\[\s*REACT\s*[:：][^\]]*\]\]/gi, '').trim();
                
                if (textContent) {
                    const chunks = ChatParser.chunkTextByBubbleMode(textContent, groupBubbleMode)
                        .map((chunk: string) => ChatParser.sanitize(chunk).trim())
                        .filter((chunk: string) => ChatParser.hasDisplayContent(chunk));
                    const fallbackChunk = ChatParser.sanitize(textContent).trim();
                    if (chunks.length === 0 && ChatParser.hasDisplayContent(fallbackChunk)) chunks.push(fallbackChunk);

                    for (const chunk of chunks) {
                        // Typing delay
                        const delay = Math.max(500, chunk.length * 50 + Math.random() * 200);
                        await new Promise(r => setTimeout(r, delay));

                        await DB.saveMessage({
                            charId: targetId,
                            groupId: activeGroup.id,
                            role: 'assistant',
                            type: 'text',
                            content: chunk
                        });
                        setMessages(await DB.getGroupMessages(activeGroup.id));
                    }
                }
            }

            // 群名片有变更时把最新群资料刷进全局 groups state（DB 在循环里已写入）
            if (groupChanged) {
                await updateGroup(liveGroup.id, liveGroup);
                setActiveGroup(liveGroup);
            }

            const freshAfterRound = await DB.getGroupMessages(activeGroup.id);
            const hasGroupProgress = freshAfterRound.length > currentMsgs.length || groupChanged;
            if (remainingAutoRounds > 0 && hasGroupProgress) {
                await new Promise(r => setTimeout(r, 650));
                await triggerDirector(freshAfterRound, {
                    ...options,
                    mode: directorMode,
                    remainingAutoRounds: remainingAutoRounds - 1,
                    isAutoRound: true,
                    suppressMemoryPalace: true,
                });
            }

        } catch (e: any) {
            console.error(e);
        } finally {
            if (!options.suppressMemoryPalace) {
                setIsTyping(false);
                // 群记忆宫殿：fire-and-forget，水位线/阈值/异常都在内部 swallow，不影响主流程
                kickGroupMemoryPalace(activeGroup);
            }
        }
    };

    const triggerLiveGroupDraft = (draftText: string) => {
        if (!activeGroup || activeGroup.dissolved || activeGroup.mutedAll || isTyping) return;
        const cleanDraft = draftText.trim();
        const now = Date.now();
        if (!shouldTriggerLiveDraft({
            settings: { ...liveChatSettings, enabled: liveGroupEnabled },
            text: cleanDraft,
            now,
            lastChangedAt: liveGroupDraftLastChangedAtRef.current,
            lastTriggeredAt: liveGroupDraftLastTriggeredAtRef.current || undefined,
            lastTriggeredText: liveGroupDraftLastTextRef.current,
        })) return;

        liveGroupDraftLastTriggeredAtRef.current = now;
        liveGroupDraftLastTextRef.current = cleanDraft;
        void triggerDirector(messages, {
            allowAutoContinue: false,
            liveMode: 'draft',
            liveDraftText: cleanDraft,
        });
    };

    const scheduleLiveGroupDraftCheck = (draftText: string) => {
        clearLiveGroupDraftTimer();
        liveGroupDraftLastChangedAtRef.current = Date.now();
        if (!activeGroup || activeGroup.dissolved || activeGroup.mutedAll) return;
        const draftSettings = { ...liveChatSettings, enabled: liveGroupEnabled };
        if (!draftSettings.enabled || !draftSettings.draftAwareness) return;
        if (draftText.trim().length < draftSettings.draftMinChars) return;
        liveGroupDraftTimerRef.current = setTimeout(() => {
            liveGroupDraftTimerRef.current = null;
            triggerLiveGroupDraft(draftText);
        }, draftSettings.draftPauseMs);
    };

    const handleGroupInputChange = (value: string) => {
        setInput(value);
        if (value.trim()) scheduleLiveGroupDraftCheck(value);
        else clearLiveGroupDraftTimer();
    };

    useEffect(() => {
        const wasTyping = liveGroupPrevTypingRef.current;
        liveGroupPrevTypingRef.current = isTyping;
        if (!wasTyping || isTyping || !liveGroupPendingSendTriggerRef.current) return;
        liveGroupPendingSendTriggerRef.current = false;
        const groupId = activeGroup?.id;
        const timer = setTimeout(() => {
            if (!groupId || !activeGroup || activeGroup.id !== groupId || !liveGroupEnabled || activeGroup.dissolved || activeGroup.mutedAll) return;
            void (async () => {
                const fresh = await DB.getGroupMessages(groupId);
                void triggerDirector(fresh, { allowAutoContinue: true, liveMode: 'sent' });
            })();
        }, 80);
        return () => clearTimeout(timer);
    }, [isTyping, activeGroup?.id, liveGroupEnabled]);

    useEffect(() => {
        clearLiveGroupDraftTimer();
        liveGroupPendingSendTriggerRef.current = false;
        liveGroupPrevTypingRef.current = isTyping;
        liveGroupDraftLastChangedAtRef.current = 0;
        liveGroupDraftLastTriggeredAtRef.current = 0;
        liveGroupDraftLastTextRef.current = '';
    }, [activeGroup?.id, liveGroupEnabled]);

    useEffect(() => {
        if (visibleGroups.length === 0) return;
        let raw: string | null = null;
        try { raw = localStorage.getItem(FORUM_PENDING_CHAT_SHARE_KEY); } catch { /* ignore */ }
        if (!raw) return;

        let parsed: unknown = null;
        try { parsed = JSON.parse(raw); } catch {
            try { localStorage.removeItem(FORUM_PENDING_CHAT_SHARE_KEY); } catch { /* ignore */ }
            return;
        }
        const maybeTargetKind = parsed && typeof parsed === 'object'
            ? ((parsed as any).targetKind === 'group' || !!(parsed as any).groupId ? 'group' : 'character')
            : 'character';
        if (maybeTargetKind !== 'group') return;

        const payload = normalizeForumSharePendingPayload(parsed, {
            validCharIds: characters.map(c => c.id),
            validGroupIds: visibleGroups.map(g => g.id),
        });
        if (!payload || payload.targetKind !== 'group' || !payload.groupId) {
            try { localStorage.removeItem(FORUM_PENDING_CHAT_SHARE_KEY); } catch { /* ignore */ }
            return;
        }
        if (forumGroupShareConsumingRef.current === payload.id) return;

        const group = visibleGroups.find(g => g.id === payload.groupId);
        if (!group) {
            try { localStorage.removeItem(FORUM_PENDING_CHAT_SHARE_KEY); } catch { /* ignore */ }
            return;
        }
        const sourceCharId = payload.shareMode === 'char_to_group' ? payload.charId : undefined;
        if (sourceCharId && !group.members.includes(sourceCharId)) {
            try { localStorage.removeItem(FORUM_PENDING_CHAT_SHARE_KEY); } catch { /* ignore */ }
            return;
        }

        let cancelled = false;
        forumGroupShareConsumingRef.current = payload.id;
        void (async () => {
            try {
                const isCharShare = payload.shareMode === 'char_to_group';
                const snapshot = { ...payload.snapshot, shareMode: payload.shareMode };
                await DB.saveMessage({
                    charId: isCharShare ? sourceCharId! : 'user',
                    groupId: group.id,
                    role: isCharShare ? 'assistant' : 'user',
                    type: 'forum_card',
                    content: isCharShare ? '[分享的茶话亭帖子]' : '[转发的茶话亭帖子]',
                    metadata: {
                        forumPost: snapshot,
                        forumShareMode: payload.shareMode,
                        forumShareId: payload.id,
                    },
                } as any);
                try { localStorage.removeItem(FORUM_PENDING_CHAT_SHARE_KEY); } catch { /* ignore */ }
                if (cancelled) return;
                openGroupChat(group);
                const fresh = await DB.getGroupMessages(group.id);
                if (cancelled) return;
                setMessages(fresh);
                forumGroupShareTriggerRef.current = { groupId: group.id, shareId: payload.id };
            } catch (err) {
                console.warn('[GroupChat] consume forum share failed', err);
            } finally {
                if (forumGroupShareConsumingRef.current === payload.id) forumGroupShareConsumingRef.current = null;
            }
        })();

        return () => { cancelled = true; };
    }, [visibleGroups, characters]);

    useEffect(() => {
        const pending = forumGroupShareTriggerRef.current;
        if (!pending || !activeGroup || pending.groupId !== activeGroup.id || isTyping) return;
        let cancelled = false;
        const timer = window.setTimeout(() => {
            void (async () => {
                const shareId = pending.shareId;
                forumGroupShareTriggerRef.current = null;
                const fresh = await DB.getGroupMessages(activeGroup.id);
                if (cancelled) return;
                setMessages(fresh);
                const exists = fresh.some(m => (m.metadata as any)?.forumShareId === shareId);
                if (exists) await triggerDirector(fresh);
            })();
        }, 300);
        return () => { cancelled = true; window.clearTimeout(timer); };
    }, [activeGroup?.id, messages.length, isTyping]);

    // --- Renderers ---

    // 聊天列表时间：今天显示 HH:MM，昨天显示"昨天"，更早显示 M月D日
    const formatConvoTime = (ts?: number) => {
        if (!ts) return '';
        const d = new Date(ts);
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        if (ts >= startOfToday) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        if (ts >= startOfToday - 24 * 60 * 60 * 1000) return '昨天';
        return `${d.getMonth() + 1}月${d.getDate()}日`;
    };

    if (view === 'list') {
        return (
            <div className="relative h-full w-full bg-[#fafafa] moro-laiwang flex flex-col" data-manual-anchor="manual-chathub-root">
                {showRelNet && (
                    <div data-manual-anchor="manual-chathub-relationship-network" className="absolute inset-0 z-50">
                    <RelationshipNetwork
                        characters={visibleCharacters}
                        userName={userProfile.name}
                        userAvatar={userProfile.avatar}
                        onClose={() => setShowRelNet(false)}
                        onOpenChat={(id) => { setShowRelNet(false); openPrivateChat(id); }}
                    />
                    </div>
                )}
                {showDashboard && (
                    <ChatHubDashboard
                        onClose={() => setShowDashboard(false)}
                        onOpenPrivate={(charId, messageId) => {
                            setShowDashboard(false);
                            openPrivateChat(charId, messageId);
                        }}
                        onOpenGroup={(group, messageId) => {
                            setShowDashboard(false);
                            openGroupChat(group, messageId);
                        }}
                        onOpenMoments={() => {
                            setShowDashboard(false);
                            setHubTab('moments');
                        }}
                        onOpenCouple={(charId) => {
                            if (charId) {
                                try { localStorage.setItem('moro_couple_partner_id', charId); } catch { /* ignore */ }
                            }
                            setShowDashboard(false);
                            setHubTab('couple');
                        }}
                    />
                )}
                {/* safe-top spacer 透明 + backdrop-blur，下方容器/list bubbles 透出+模糊（跟 iOS 系统 status bar 一致），避免 header 白 bg 在刘海下铺一条突兀白带 */}
                <div className="shrink-0 z-10 sticky top-0">
                    <div className="bg-transparent backdrop-blur-xl" style={{ height: 'var(--safe-top)' }} />
                    <div className="bg-white/90 backdrop-blur-md flex items-end pb-3 px-4 border-b border-[#ededed] h-20 anim-drop-in">
                        <button
                        onClick={() => {
                            // 朋友圈 tab 上有内层页面（发布动态等）打开时，返回键先回到动态流
                            if (hubTab === 'moments' && momentsBackRef.current?.()) return;
                            closeApp();
                        }}
                        className="p-2 -ml-2 rounded-full hover:bg-black/5 active:scale-90 transition-transform"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-slate-600"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
                    </button>
                    <span className="font-bold text-[#262626] text-xl tracking-tight pl-2">{hubTab === 'chats' ? '往来' : hubTab === 'contacts' ? '名册' : hubTab === 'couple' ? '情侣空间' : '此刻'}</span>
                    <div className="flex-1"></div>
                    {hubTab === 'contacts' && visibleCharacters.length > 0 && (
                        <button onClick={() => setShowRelNet(true)} className="p-2 text-[#9c5e74] scrap-btn-paper transition-colors mr-1" title="关系网">
                            <ShareNetwork size={22} weight="duotone" />
                        </button>
                    )}
                    {hubTab !== 'moments' && hubTab !== 'couple' && (
                        <div className="relative">
                            <button onClick={() => setShowPlusMenu(v => !v)} className="p-2 -mr-2 text-[#9c5e74] scrap-btn-paper transition-colors" title="添加">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                            </button>
                            {showPlusMenu && (
                                <>
                                    {/* 点空白处收起菜单 */}
                                    <div className="fixed inset-0 z-40" onClick={() => setShowPlusMenu(false)} />
                                    <div
                                        className="absolute right-0 top-full mt-2 z-50 w-64 overflow-hidden animate-pop-in bg-white"
                                        style={{
                                            border: '1px solid #f0cbd7',
                                            borderRadius: 18,
                                            boxShadow: '0 18px 40px -24px rgba(38,38,38,0.42), 0 1px 2px rgba(38,38,38,0.08)',
                                            color: '#334155',
                                        }}
                                    >
                                        <button
                                            onClick={() => { setShowPlusMenu(false); setShowDashboard(true); }}
                                            className="w-full px-4 py-3 flex items-center gap-2.5 text-sm font-bold active:scale-[0.98] transition-all hover:bg-[#fff6f9]"
                                        >
                                            <ChartBar size={18} weight="bold" className="shrink-0" style={{ color: '#9c5e74' }} />
                                            絮语总览
                                        </button>
                                        <div className="mx-4 border-t" style={{ borderColor: '#f2d9e2' }} />
                                        <button
                                            onClick={() => { setShowPlusMenu(false); setModalType('add-friend'); }}
                                            className="w-full px-4 py-3 flex items-center gap-2.5 text-sm font-bold active:scale-[0.98] transition-all hover:bg-[#fff6f9]"
                                        >
                                            <AddressBook size={18} weight="bold" className="shrink-0" style={{ color: '#9c5e74' }} />
                                            添个新朋友
                                        </button>
                                        <div className="mx-4 border-t" style={{ borderColor: '#f2d9e2' }} />
                                        <button
                                            onClick={() => { setShowPlusMenu(false); setModalType('create'); setSelectedMembers(new Set()); setTempGroupName(''); setTempOwnerId('user'); setTempAdminIds(new Set()); setTempArchiveTitle(''); }}
                                            className="w-full px-4 py-3 flex items-center gap-2.5 text-sm font-bold active:scale-[0.98] transition-all hover:bg-[#fff6f9]"
                                        >
                                            <UsersThree size={18} weight="bold" className="shrink-0" style={{ color: '#9c5e74' }} />
                                            拉个新群聊
                                        </button>
                                        <div className="mx-4 border-t" style={{ borderColor: '#f2d9e2' }} />
                                        <button
                                            onClick={handleToggleLiveChatGlobal}
                                            className="w-full px-4 py-3 flex items-center gap-2.5 text-left active:scale-[0.98] transition-all hover:bg-[#fff6f9]"
                                            role="switch"
                                            aria-checked={liveChatGlobalEnabled}
                                            aria-label="实时聊天模式"
                                        >
                                            <ChatsTeardrop size={18} weight="bold" className="shrink-0" style={{ color: liveChatGlobalEnabled ? '#9c5e74' : '#94a3b8' }} />
                                            <span className="flex-1 min-w-0">
                                                <span className="block text-sm font-bold leading-tight truncate">实时聊天模式</span>
                                                <span className="block text-[10px] font-medium text-slate-400 leading-tight truncate">{liveChatGlobalEnabled ? '发送后自动接话，也感知草稿' : '默认手动触发，单聊/群可单独开'}</span>
                                            </span>
                                            <span
                                                className="relative h-6 w-11 rounded-full border transition-colors shrink-0"
                                                style={{
                                                    background: liveChatGlobalEnabled ? '#9c5e74' : '#e2e8f0',
                                                    borderColor: liveChatGlobalEnabled ? '#9c5e74' : '#cbd5e1',
                                                }}
                                            >
                                                <span
                                                    className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform"
                                                    style={{ transform: liveChatGlobalEnabled ? 'translateX(20px)' : 'translateX(2px)' }}
                                                />
                                            </span>
                                        </button>
                                        <div className="mx-4 border-t" style={{ borderColor: '#f2d9e2' }} />
                                        <button
                                            onClick={handleToggleAmbientSocial}
                                            className="w-full px-4 py-3 flex items-center gap-2.5 text-left active:scale-[0.98] transition-all hover:bg-[#fff6f9]"
                                            role="switch"
                                            aria-checked={ambientSocialEnabled}
                                            aria-label="用户社交圈"
                                        >
                                            <UsersThree size={18} weight="bold" className="shrink-0" style={{ color: ambientSocialEnabled ? '#9c5e74' : '#94a3b8' }} />
                                            <span className="flex-1 min-w-0">
                                                <span className="block text-sm font-bold leading-tight truncate">用户社交圈</span>
                                                <span className="block text-[10px] font-medium text-slate-400 leading-tight truncate">{ambientSocialEnabled ? '允许背景联系人出现' : '只显示主动添加的人'}</span>
                                            </span>
                                            <span
                                                className="relative h-6 w-11 rounded-full border transition-colors shrink-0"
                                                style={{
                                                    background: ambientSocialEnabled ? '#9c5e74' : '#e2e8f0',
                                                    borderColor: ambientSocialEnabled ? '#9c5e74' : '#cbd5e1',
                                                }}
                                            >
                                                <span
                                                    className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform"
                                                    style={{ transform: ambientSocialEnabled ? 'translateX(20px)' : 'translateX(2px)' }}
                                                />
                                            </span>
                                        </button>
                                        <div className="mx-4 border-t" style={{ borderColor: '#f2d9e2' }} />
                                        <button
                                            onClick={handleToggleAmbientSocialHideConverted}
                                            className="w-full px-4 py-3 flex items-center gap-2.5 text-left active:scale-[0.98] transition-all hover:bg-[#fff6f9]"
                                            role="switch"
                                            aria-checked={ambientSocialHideConverted}
                                            aria-label="隐藏已接入 NPC 与群聊"
                                        >
                                            <Detective size={18} weight="bold" className="shrink-0" style={{ color: ambientSocialHideConverted ? '#9c5e74' : '#94a3b8' }} />
                                            <span className="flex-1 min-w-0">
                                                <span className="block text-sm font-bold leading-tight truncate">隐藏已接入 NPC 与群</span>
                                                <span className="block text-[10px] font-medium text-slate-400 leading-tight truncate">{ambientSocialHideConverted ? '已接入 NPC 与群已收起' : '已接入 NPC 与群会显示'}</span>
                                            </span>
                                            <span
                                                className="relative h-6 w-11 rounded-full border transition-colors shrink-0"
                                                style={{
                                                    background: ambientSocialHideConverted ? '#9c5e74' : '#e2e8f0',
                                                    borderColor: ambientSocialHideConverted ? '#9c5e74' : '#cbd5e1',
                                                }}
                                            >
                                                <span
                                                    className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform"
                                                    style={{ transform: ambientSocialHideConverted ? 'translateX(20px)' : 'translateX(2px)' }}
                                                />
                                            </span>
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                    </div>
                </div>

                {/* ── 消息 tab：单聊 + 群聊混排 ── */}
                {hubTab === 'chats' && (
                    <div className="scrap-list flex-1 p-3 space-y-2 overflow-y-auto" data-manual-anchor="manual-chathub-chats">
                        {convos.map((cv, i) => {
                            // 进入列表时逐行轻微淡入（错峰），多了也不至于拖太久
                            const enterDelay = `${Math.min(i, 14) * 32}ms`;
                            if (cv.kind === 'group') {
                                const g = groups.find(x => x.id === cv.id);
                                return (
                                    <SwipeConvoRow
                                        key={`g-${cv.id}`}
                                        swipeKey={convoKey('group', cv.id)}
                                        openKey={quickConvoId}
                                        setOpenKey={setQuickConvoId}
                                        onOpen={() => { if (g) openGroupChat(g); }}
                                        style={{ animationDelay: enterDelay }}
                                        className={`scrap-card p-3.5 rounded-2xl flex items-center gap-3 active:scale-[0.98] hover:-translate-y-0.5 transition-all cursor-pointer hover:bg-[#f7f4ee] ${cv.dissolved ? 'opacity-70' : ''} ${cv.starred ? 'bg-[#fff4f7]' : ''}`}
                                        actions={[
                                            { label: '删除', tone: 'danger', onClick: () => handleDeleteConvo('group', cv.id) },
                                            { label: cv.starred ? '取消置顶' : '置顶', tone: 'pin', onClick: () => handleToggleConvoPinned('group', cv.id) },
                                            { label: '未读', tone: 'muted', onClick: () => handleMarkConvoUnread('group', cv.id) },
                                        ]}
                                    >
                                        <div className={`w-12 h-12 rounded-2xl bg-slate-100 overflow-hidden border border-slate-200 relative shadow-sm shrink-0 ${cv.dissolved ? 'grayscale' : ''}`}>
                                            {cv.avatar ? (
                                                <img src={cv.avatar} className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="grid grid-cols-2 gap-0.5 p-0.5 w-full h-full bg-slate-200">
                                                    {(g?.members || []).slice(0, 4).map(mid => {
                                                        const c = characters.find(ch => ch.id === mid);
                                                        return <img key={mid} src={c?.avatar} className="w-full h-full object-cover rounded-sm bg-white" />;
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-1.5">
                                                {cv.starred && <PushPin size={11} weight="fill" className="text-[#d8a5b7] shrink-0" />}
                                                <span className={`font-bold truncate text-sm ${cv.dissolved ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{cv.name}</span>
                                                <UsersThree size={12} className="text-slate-300 shrink-0" />
                                                <span className="text-[9px] text-slate-300 shrink-0">{cv.memberCount}</span>
                                                {!!cv.specialCareCount && <BellRinging size={12} weight="fill" className="text-rose-400 shrink-0" />}
                                            </div>
                                            {cv.dissolved ? (
                                                <div className="text-[11px] text-[#9c5e74] mt-0.5 font-medium">此群聊已被解散</div>
                                            ) : (
                                                <div className="text-[11px] text-slate-400 mt-0.5 truncate">{previewOf(cv.last)}</div>
                                            )}
                                        </div>
                                        <div className="flex flex-col items-end gap-1 shrink-0">
                                            <span className="text-[9px] text-slate-300">{formatConvoTime(cv.last?.timestamp)}</span>
                                            {(() => { try { return localStorage.getItem(`moro_group_unread_${cv.id}`) === '1'; } catch { return false; } })() && (
                                                <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#ff5a6f] text-white text-[10px] font-black flex items-center justify-center">1</span>
                                            )}
                                            {cv.dissolved && (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); void handleDeleteConvo('group', cv.id); }}
                                                    className="text-[9px] px-2 py-0.5 rounded-full bg-[#fff4f7] text-[#9c5e74] border border-[#eed6df] hover:bg-[#fff4f7]"
                                                >收起</button>
                                            )}
                                        </div>
                                    </SwipeConvoRow>
                                );
                            }
                            if (cv.kind === 'ambient' && cv.ambient) {
                                const entry = cv.ambient;
                                const isAmbientGroup = entry.kind === 'group';
                                return (
                                    <SwipeConvoRow
                                        key={`a-${cv.id}`}
                                        swipeKey={convoKey('ambient', cv.id)}
                                        openKey={quickConvoId}
                                        setOpenKey={setQuickConvoId}
                                        onOpen={() => openAmbientEntry(entry)}
                                        style={{ animationDelay: enterDelay }}
                                        className={`scrap-card p-3.5 rounded-2xl flex items-center gap-3 active:scale-[0.98] hover:-translate-y-0.5 transition-all cursor-pointer hover:bg-[#f7f4ee] ${cv.starred ? 'bg-[#fff4f7]' : ''}`}
                                        actions={[
                                            { label: '收起', tone: 'danger', onClick: () => handleDeleteConvo('ambient', cv.id) },
                                            { label: cv.starred ? '取消置顶' : '置顶', tone: 'pin', onClick: () => handleToggleConvoPinned('ambient', cv.id) },
                                            { label: '未读', tone: 'muted', onClick: () => handleMarkConvoUnread('ambient', cv.id) },
                                        ]}
                                    >
                                        <div className={`w-12 h-12 ${isAmbientGroup ? 'rounded-2xl' : 'rounded-full'} bg-slate-100 overflow-hidden border border-[#eed6df] relative shadow-sm shrink-0`}>
                                            <img src={cv.avatar} className="w-full h-full object-cover" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-1.5">
                                                {cv.starred && <PushPin size={11} weight="fill" className="text-[#d8a5b7] shrink-0" />}
                                                <span className="font-bold text-slate-700 truncate text-sm">{cv.name}</span>
                                                {isAmbientGroup ? (
                                                    <>
                                                        <UsersThree size={12} className="text-slate-300 shrink-0" />
                                                        <span className="text-[9px] text-slate-300 shrink-0">{cv.memberCount}</span>
                                                    </>
                                                ) : null}
                                            </div>
                                            <div className="text-[11px] text-slate-400 mt-0.5 truncate">{entry.lastMessage}</div>
                                        </div>
                                        <div className="flex flex-col items-end gap-1 shrink-0">
                                            <span className="text-[9px] text-slate-300">{formatConvoTime(entry.lastAt)}</span>
                                            {!!entry.unread && <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#ff5a6f] text-white text-[10px] font-black flex items-center justify-center">{Math.min(99, entry.unread)}</span>}
                                        </div>
                                    </SwipeConvoRow>
                                );
                            }
                            return (
                                <SwipeConvoRow
                                    key={`c-${cv.id}`}
                                    swipeKey={convoKey('char', cv.id)}
                                    openKey={quickConvoId}
                                    setOpenKey={setQuickConvoId}
                                    onOpen={() => openPrivateChat(cv.id)}
                                    style={{ animationDelay: enterDelay }}
                                    className={`scrap-card p-3.5 rounded-2xl flex items-center gap-3 active:scale-[0.98] hover:-translate-y-0.5 transition-all cursor-pointer hover:bg-[#f7f4ee] ${cv.starred ? 'bg-[#fff4f7]' : ''}`}
                                    actions={[
                                        { label: '删除', tone: 'danger', onClick: () => handleDeleteConvo('char', cv.id) },
                                        { label: cv.starred ? '取消置顶' : '置顶', tone: 'pin', onClick: () => handleToggleConvoPinned('char', cv.id) },
                                        { label: '未读', tone: 'muted', onClick: () => handleMarkConvoUnread('char', cv.id) },
                                    ]}
                                >
                                    {cv.lifeStatus ? (
                                        // 「此刻」有动态的角色 = IG story ring（渐变环），一眼看出谁正活跃
                                        <span className="ig-ring shrink-0" title="此刻在线"><img src={cv.avatar} className="w-12 h-12 rounded-full object-cover" /></span>
                                    ) : (
                                        <img src={cv.avatar} className="w-12 h-12 rounded-full object-cover border border-slate-100 shadow-sm shrink-0" />
                                    )}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1">
                                            {cv.starred && <span className="text-[#d8a5b7] text-[12px] shrink-0" title="已星标置顶">★</span>}
                                            <span className="font-bold text-slate-700 truncate text-sm">{cv.name}</span>
                                        </div>
                                        <div className="text-[11px] text-slate-400 mt-0.5 truncate">{previewOf(cv.last)}</div>
                                        {/* 「此刻」TA 的线下生活状态：把线下自主生活带进列表，线上线下一眼关联 */}
                                        {cv.lifeStatus && (
                                            <div className="flex items-start gap-1.5 mt-1">
                                                <span className="relative flex h-1.5 w-1.5 shrink-0 mt-[5px]" aria-hidden>
                                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full" style={{ background: 'rgba(216,165,183,0.36)' }} />
                                                    <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: '#d8a5b7' }} />
                                                </span>
                                                <span className="text-[10px] leading-snug min-w-0 break-words" style={{ color: '#9c5e74' }}>
                                                    此刻 · {cv.lifeStatus.eventKind ? `${LIFE_KIND_LABELS[cv.lifeStatus.eventKind] || '生活'} · ` : ''}{cv.lifeStatus.activity}{cv.lifeStatus.mood ? ` · ${cv.lifeStatus.mood}` : ''}{cv.lifeStatus.surfacedAsMsg ? ' · 已说过' : ''}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex flex-col items-end gap-1 shrink-0">
                                        <span className="text-[9px] text-slate-300">{formatConvoTime(cv.last?.timestamp)}</span>
                                        {!!unreadMessages[cv.id] && <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#ff5a6f] text-white text-[10px] font-black flex items-center justify-center">{Math.min(99, unreadMessages[cv.id])}</span>}
                                    </div>
                                </SwipeConvoRow>
                            );
                        })}
                        {convos.length === 0 && (
                            <div className="text-center text-slate-400 text-xs py-10 flex flex-col items-center gap-2 anim-float-in">
                                <ChatsTeardrop size={36} className="opacity-50 animate-float" />
                                这里还空着。去「名册」找个人说说话，或点右上角拉个群。
                            </div>
                        )}
                    </div>
                )}

                {/* ── 联系人 tab：全部角色 ── */}
                {hubTab === 'contacts' && (
                    <div className="scrap-list flex-1 p-3 space-y-2 overflow-y-auto" data-manual-anchor="manual-chathub-contacts">
                        {newFriendCharacters.length > 0 && (
                            <div className="space-y-2">
                                <div className="px-2 pb-1 text-[10px] font-black tracking-[0.18em] text-[#9c5e74]/70">新的朋友</div>
                                {newFriendCharacters.map((c, i) => {
                                    const appeal = pendingUnblockAppealByCharId.get(c.id);
                                    const blockedByChar = !!c.charBlock?.active;
                                    const awaitingUnblockAppeal = !!c.blacklisted && !!c.unblockAppeal?.awaiting && !appeal;
                                    const displayName = c.convoSettings?.remarkName?.trim() || c.name;
                                    const subtitle = appeal
                                        ? `验证消息：${previewOf(appeal.message)}`
                                        : awaitingUnblockAppeal
                                            ? '正在读取 TA 递来的验证消息…'
                                            : blockedByChar
                                            ? 'TA 把你拉黑了，递一条好友验证看看。'
                                            : '等待处理验证。';
                                    const badge = appeal ? '回复' : awaitingUnblockAppeal ? '稍等' : blockedByChar ? '验证' : '查看';
                                    const openRequest = () => {
                                        if (appeal) {
                                            setUnblockAppealTarget(appeal);
                                            setUnblockAppealReply('');
                                            return;
                                        }
                                        if (awaitingUnblockAppeal) {
                                            addToast('正在读取验证消息，稍等一下', 'info');
                                            return;
                                        }
                                        if (blockedByChar) {
                                            setVerifyCharId(c.id);
                                            return;
                                        }
                                        openPrivateChat(c.id);
                                    };
                                    return (
                                        <div
                                            key={`new-friend-${c.id}`}
                                            onClick={openRequest}
                                            style={{ animationDelay: `${Math.min(i, 14) * 32}ms` }}
                                            className="scrap-card p-3.5 rounded-2xl flex items-center gap-3 active:scale-[0.98] hover:-translate-y-0.5 transition-all cursor-pointer hover:bg-[#fff4f7] anim-row-in"
                                        >
                                            <div className="relative shrink-0">
                                                <img src={c.convoSettings?.charAvatarOverride || c.avatar} className={`w-12 h-12 rounded-full object-cover border shadow-sm ${c.blacklisted ? 'border-rose-100 grayscale-[0.25]' : 'border-slate-100'}`} />
                                                <span className="absolute -right-1 -bottom-1 w-5 h-5 rounded-full bg-white border border-[#eed6df] flex items-center justify-center text-[#9c5e74] shadow-sm">
                                                    <EnvelopeOpen size={11} weight="bold" />
                                                </span>
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="font-bold text-slate-700 truncate text-sm">{displayName}</span>
                                                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#fff4f7] text-[#9c5e74] font-black shrink-0">
                                                        {appeal ? '申请解除拉黑' : awaitingUnblockAppeal ? '验证待处理' : blockedByChar ? '把你拉黑了' : '黑名单'}
                                                    </span>
                                                </div>
                                                <div className="text-[11px] text-slate-400 mt-0.5 truncate">{subtitle}</div>
                                            </div>
                                            <span className="text-[10px] px-2.5 py-1 rounded-full font-black shrink-0 bg-[#9c5e74] text-white">{badge}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                        {blacklistedCharacters.length > 0 && (
                            <div className="space-y-2">
                                <div className={`px-2 pb-1 flex items-center justify-between gap-2 ${newFriendCharacters.length > 0 ? 'pt-2' : ''}`}>
                                    <span className="text-[10px] font-black tracking-[0.18em] text-[#9c5e74]/70">黑名单</span>
                                    <button
                                        onClick={() => { void handleBulkUnblock(); }}
                                        disabled={bulkUnblockBusy}
                                        className="px-2.5 py-1 rounded-full bg-[#262626] text-white text-[10px] font-black disabled:opacity-50 active:scale-95"
                                    >
                                        {bulkUnblockBusy ? '处理中' : '全部解除'}
                                    </button>
                                </div>
                                {blacklistedCharacters.map((c, i) => {
                                    const appeal = pendingUnblockAppealByCharId.get(c.id);
                                    const displayName = c.convoSettings?.remarkName?.trim() || c.name;
                                    const blockedAt = c.blacklistedAt ? formatConvoTime(c.blacklistedAt) : '已拉黑';
                                    const openBlocked = () => {
                                        if (appeal) {
                                            setUnblockAppealTarget(appeal);
                                            setUnblockAppealReply('');
                                            return;
                                        }
                                        openPrivateChat(c.id);
                                    };
                                    return (
                                        <div
                                            key={`blacklist-${c.id}`}
                                            onClick={openBlocked}
                                            style={{ animationDelay: `${Math.min(i, 14) * 32}ms` }}
                                            className="scrap-card p-3.5 rounded-2xl flex items-center gap-3 active:scale-[0.98] hover:-translate-y-0.5 transition-all cursor-pointer hover:bg-[#f7f4ee] anim-row-in"
                                            data-manual-anchor={i === 0 ? 'manual-chathub-blacklist' : undefined}
                                        >
                                            <img src={c.convoSettings?.charAvatarOverride || c.avatar} className="w-12 h-12 rounded-full object-cover border border-rose-100 shadow-sm shrink-0 grayscale-[0.35]" />
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="font-bold text-slate-700 truncate text-sm">{displayName}</span>
                                                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 font-black shrink-0">
                                                        {appeal ? '有申请' : '黑名单'}
                                                    </span>
                                                </div>
                                                <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                                                    {appeal ? `验证消息：${previewOf(appeal.message)}` : `${blockedAt} · 不会主动打扰你`}
                                                </div>
                                            </div>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    void handleManualUnblockFromContacts(c);
                                                }}
                                                className="text-[10px] px-2.5 py-1 rounded-full font-black shrink-0 bg-slate-700 text-white active:scale-95"
                                            >
                                                解除
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                        {visibleGroups.length > 0 && (
                            <div className={`px-2 pb-1 text-[10px] font-black tracking-[0.18em] text-[#9c5e74]/70 ${(newFriendCharacters.length > 0 || blacklistedCharacters.length > 0) ? 'pt-2' : ''}`}>群聊</div>
                        )}
                        {visibleGroups.map((g, i) => (
                            <div key={`contact-group-${g.id}`} onClick={() => openGroupChat(g)} style={{ animationDelay: `${Math.min(i, 14) * 32}ms` }} className={`scrap-card p-3.5 rounded-2xl flex items-center gap-3 active:scale-[0.98] hover:-translate-y-0.5 transition-all cursor-pointer hover:bg-[#f7f4ee] anim-row-in ${g.dissolved ? 'opacity-70' : ''}`}>
                                <div className={`w-12 h-12 rounded-2xl bg-slate-100 overflow-hidden border border-slate-200 relative shadow-sm shrink-0 ${g.dissolved ? 'grayscale' : ''}`}>
                                    {g.avatar ? (
                                        <img src={g.avatar} className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="grid grid-cols-2 gap-0.5 p-0.5 w-full h-full bg-slate-200">
                                            {g.members.slice(0, 4).map(mid => {
                                                const c = characters.find(ch => ch.id === mid);
                                                return <img key={mid} src={c?.avatar} className="w-full h-full object-cover rounded-sm bg-white" />;
                                            })}
                                        </div>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                        {g.pinned && <PushPin size={11} weight="fill" className="text-[#d8a5b7] shrink-0" />}
                                        <div className={`font-bold truncate text-sm ${g.dissolved ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{g.name}</div>
                                        <UsersThree size={12} className="text-slate-300 shrink-0" />
                                        <span className="text-[9px] text-slate-300 shrink-0">{g.members.length}</span>
                                    </div>
                                    <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                                        {g.dissolved ? '此群聊已被解散' : `${g.members.slice(0, 4).map(mid => displayNameOf(g, mid)).join('、')}${g.members.length > 4 ? '…' : ''}`}
                                    </div>
                                </div>
                                <button
                                    onClick={(e) => { e.stopPropagation(); setActiveGroup(g); openGroupSettings(g); }}
                                    className="p-2 rounded-full text-slate-400 hover:text-[#9c5e74] hover:bg-[#fff4f7] transition-colors shrink-0"
                                    title="群聊设置"
                                >
                                    <GearSix size={18} weight="bold" />
                                </button>
                            </div>
                        ))}
                        {visibleCharacters.length > 0 && (
                            <div className="px-2 pt-2 pb-1 text-[10px] font-black tracking-[0.18em] text-[#9c5e74]/70">角色</div>
                        )}
                        {visibleCharacters.map((c, i) => (
                            <div key={c.id} onClick={() => openPrivateChat(c.id)} style={{ animationDelay: `${Math.min(i + visibleGroups.length, 14) * 32}ms` }} className="scrap-card p-3.5 rounded-2xl flex items-center gap-3 active:scale-[0.98] hover:-translate-y-0.5 transition-all cursor-pointer hover:bg-[#f7f4ee] anim-row-in">
                                <img src={c.convoSettings?.charAvatarOverride || c.avatar} className="w-12 h-12 rounded-full object-cover border border-slate-100 shadow-sm shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <div className="font-bold text-slate-700 truncate text-sm">{c.convoSettings?.remarkName?.trim() || c.name}</div>
                                    {(c as any).bio && <div className="text-[11px] text-slate-400 mt-0.5 truncate">{(c as any).bio}</div>}
                                </div>
                                <button
                                    onClick={(e) => { e.stopPropagation(); openCharacterSettings(c.id); }}
                                    className="p-2 rounded-full text-slate-400 hover:text-[#9c5e74] hover:bg-[#fff4f7] transition-colors shrink-0"
                                    title="角色设置"
                                >
                                    <GearSix size={18} weight="bold" />
                                </button>
                            </div>
                        ))}
                        {ambientEntries.length > 0 && (
                            <div className="pt-2">
                                <div className="px-2 pb-1.5 text-[10px] font-black tracking-[0.18em] text-[#9c5e74]/70">最近出现</div>
                                <div className="space-y-2">
                                    {ambientEntries.map((entry, idx) => {
                                        const isAmbientGroup = entry.kind === 'group';
                                        return (
                                            <div
                                                key={entry.id}
                                                onClick={() => openAmbientEntry(entry)}
                                                style={{ animationDelay: `${Math.min(visibleCharacters.length + idx, 14) * 32}ms` }}
                                                className="scrap-card p-3.5 rounded-2xl flex items-center gap-3 active:scale-[0.98] hover:-translate-y-0.5 transition-all cursor-pointer hover:bg-[#f7f4ee] anim-row-in"
                                            >
                                                <img src={entry.avatar} className={`w-12 h-12 ${isAmbientGroup ? 'rounded-2xl' : 'rounded-full'} object-cover border border-[#eed6df] shadow-sm shrink-0`} />
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="font-bold text-slate-700 truncate text-sm">{entry.name}</span>
                                                        {isAmbientGroup && <UsersThree size={12} className="text-slate-300 shrink-0" />}
                                                    </div>
                                                    <div className="text-[11px] text-slate-400 mt-0.5 truncate">{entry.lastMessage}</div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                        {visibleCharacters.length === 0 && visibleGroups.length === 0 && ambientEntries.length === 0 && (
                            <div className="text-center text-slate-400 text-xs py-10">名册里还没有角色或群聊</div>
                        )}
                    </div>
                )}

                {/* ── 朋友圈 tab：内嵌完整朋友圈（与独立 朋友圈 App 共用 MomentsFeed） ── */}
                {hubTab === 'moments' && (
                    <div className="flex-1 min-h-0 overflow-hidden" data-manual-anchor="manual-chathub-moments">
                        <MomentsFeed embedded backHandlerRef={momentsBackRef} />
                    </div>
                )}

                {/* ── 情侣空间 tab：参考 QQ 情侣空间（恋爱天数 / 亲密度 / 动态 / 纪念日 / 相册 / 约定 / 悄悄话） ── */}
                {hubTab === 'couple' && (
                    <div className="flex-1 min-h-0 overflow-hidden" data-manual-anchor="manual-chathub-couple">
                        <CoupleSpace visibleCharacters={visibleCharacters} />
                    </div>
                )}

                {/* ── 底部导航：往来 / 名册 / 此刻 / 情侣空间 ── */}
                <div className="shrink-0 bg-white/90 backdrop-blur-md border-t border-[#ededed] pb-safe">
                    <div className="grid grid-cols-4 moro-tabbar">
                        {/* 选中态滑动指示条：随当前 tab 在四格间平滑滑动（left/width 过渡） */}
                        <span
                            aria-hidden
                            className="moro-tab-ink"
                            style={{
                                left: `${['chats', 'contacts', 'moments', 'couple'].indexOf(hubTab) * 25 + 6}%`,
                                width: '13%',
                                color: hubTab === 'couple' ? '#d8a5b7' : '#9c5e74',
                            }}
                        />
                        {([
                            { id: 'chats', label: '往来', Icon: ChatsTeardrop, on: 'text-[#9c5e74]' },
                            { id: 'contacts', label: '名册', Icon: AddressBook, on: 'text-[#9c5e74]' },
                            { id: 'moments', label: '此刻', Icon: Planet, on: 'text-[#9c5e74]' },
                            { id: 'couple', label: '情侣空间', Icon: Heart, on: 'text-pink-500' },
                        ] as const).map(t => {
                            const active = hubTab === t.id;
                            // 选中：图标轻轻放大 + 上抬；点按：整体下沉一下（更有「按下去」的手感）
                            return (
                                <button
                                    key={t.id}
                                    onClick={() => setHubTab(t.id)}
                                    className={`relative flex flex-col items-center gap-0.5 py-2.5 transition-all duration-200 active:scale-90 ${active ? t.on : 'text-slate-400'}`}
                                >
                                    <t.Icon size={22} weight={active ? 'fill' : 'regular'} className={`transition-transform duration-300 ${active ? 'scale-110 -translate-y-0.5' : ''}`} />
                                    {t.id === 'moments' && momentsUnreadCount > 0 && !active && (
                                        <span className="absolute top-2 right-[28%] min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-black leading-4 shadow-sm">
                                            {momentsUnreadCount > 9 ? '9+' : momentsUnreadCount}
                                        </span>
                                    )}
                                    <span className="text-[10px] font-bold">{t.label}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                <Modal isOpen={modalType === 'create'} title="攒个新群" en="NEW GROUP · 拉一桌人" icon={<ScrapStamp><UsersThree size={16} weight="bold" /></ScrapStamp>} onClose={() => setModalType('none')} footer={<ScrapBtn onClick={handleCreateGroup} icon={<UsersThree size={16} weight="bold" />}>这就开张</ScrapBtn>}>
                    <div className="space-y-4">
                        <ScrapInput value={tempGroupName} onChange={e => setTempGroupName(e.target.value)} placeholder="给这个群起个名字…" />
                        <div>
                            <ScrapLabel en="MEMBERS">把谁拉进来</ScrapLabel>
                            <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto no-scrollbar pr-1">
                                {visibleCharacters.map(c => (
                                    <ScrapPickTile key={c.id} src={c.avatar} label={c.name} selected={selectedMembers.has(c.id)} onClick={() => toggleMemberSelection(c.id)} />
                                ))}
                            </div>
                        </div>
                        <div>
                            <ScrapLabel en="OWNER">谁当群主</ScrapLabel>
                            <div className="flex flex-wrap gap-2">
                                <ScrapChip selected={tempOwnerId === 'user'} onClick={() => setTempOwnerId('user')}>{tempOwnerId === 'user' ? '👑 ' : ''}我自己</ScrapChip>
                                {Array.from(selectedMembers).map(id => {
                                    const c = characters.find(ch => ch.id === id);
                                    if (!c) return null;
                                    return (
                                        <ScrapChip
                                            key={id}
                                            selected={tempOwnerId === id}
                                            onClick={() => {
                                                setTempOwnerId(id);
                                                // 群主天然有管理员权限，从管理员列表中移除
                                                if (tempAdminIds.has(id)) {
                                                    const admins = new Set(tempAdminIds);
                                                    admins.delete(id);
                                                    setTempAdminIds(admins);
                                                }
                                            }}
                                        >
                                            {tempOwnerId === id ? '👑 ' : ''}{c.name}
                                        </ScrapChip>
                                    );
                                })}
                            </div>
                            {selectedMembers.size === 0 && <ScrapNote className="mt-1.5">先挑几个人进来，就能把谁都点成群主。</ScrapNote>}
                        </div>
                        {selectedMembers.size > 0 && (
                            <div>
                                <ScrapLabel en="ADMINS">谁来帮忙管（可多选）</ScrapLabel>
                                <div className="flex flex-wrap gap-2">
                                    {Array.from(selectedMembers).filter(id => id !== tempOwnerId).map(id => {
                                        const c = characters.find(ch => ch.id === id);
                                        if (!c) return null;
                                        return (
                                            <ScrapChip key={id} selected={tempAdminIds.has(id)} onClick={() => toggleAdminSelection(id)}>
                                                {tempAdminIds.has(id) ? '🛡 ' : ''}{c.name}
                                            </ScrapChip>
                                        );
                                    })}
                                    {Array.from(selectedMembers).filter(id => id !== tempOwnerId).length === 0 && (
                                        <ScrapNote>群主天生说了算，暂时没有别人可以加封管理员。</ScrapNote>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </Modal>

                {/* 添加好友：弹窗选择角色，直接进入与该角色的会话（不跳角色设置）。
                    把你拉黑的角色 → 需先发送好友验证，由 TA 决定是否拉回 */}
                <Modal isOpen={modalType === 'add-friend'} title="找谁说说话" en="ADD FRIEND · 翻翻名册" icon={<ScrapStamp><AddressBook size={16} weight="bold" /></ScrapStamp>} onClose={() => setModalType('none')}>
                    <div className="space-y-2 max-h-[55vh] overflow-y-auto no-scrollbar pr-1">
                        {visibleCharacters.map(c => {
                            const blockedByChar = !!c.charBlock?.active;
                            return (
                                <ScrapRowBtn
                                    key={c.id}
                                    avatar={c.avatar}
                                    avatarDim={blockedByChar}
                                    onClick={() => {
                                        setModalType('none');
                                        if (blockedByChar) setVerifyCharId(c.id);
                                        else openPrivateChat(c.id);
                                    }}
                                    trailing={blockedByChar
                                        ? <span className="text-[10px] px-2 py-0.5 rounded-full font-black shrink-0" style={{ background: INK, color: '#f6f3ec' }}>把你拉黑了 · 得验证</span>
                                        : undefined}
                                >
                                    {c.name}
                                </ScrapRowBtn>
                            );
                        })}
                        {ambientEntries.length > 0 && (
                            <>
                                <ScrapDivider />
                                <ScrapLabel en="RECENT">最近出现</ScrapLabel>
                                {ambientEntries.map(entry => (
                                    <ScrapRowBtn
                                        key={entry.id}
                                        avatar={entry.avatar}
                                        onClick={() => {
                                            setModalType('none');
                                            openAmbientEntry(entry);
                                        }}
                                    >
                                        {entry.name}
                                    </ScrapRowBtn>
                                ))}
                            </>
                        )}
                        {visibleCharacters.length === 0 && ambientEntries.length === 0 && (
                            <ScrapNote center className="py-8">名册还空着，先去「剪影集」捏一个人出来吧。</ScrapNote>
                        )}
                    </div>
                </Modal>

                {/* 角色被你拉黑后递来的解除拉黑验证：名册「新的朋友」里处理，像微信好友验证一样可回留言 */}
                {unblockAppealTarget && (() => {
                    const c = characters.find(ch => ch.id === unblockAppealTarget.charId);
                    if (!c) return null;
                    return (
                        <UnblockAppealModal
                            char={c}
                            message={unblockAppealTarget.message}
                            reply={unblockAppealReply}
                            busy={unblockAppealBusy}
                            onReplyChange={setUnblockAppealReply}
                            onClose={closeUnblockAppealModal}
                            onDecision={(decision) => void handleUnblockAppealDecision(decision)}
                        />
                    );
                })()}

                {/* 好友验证（被角色拉黑后重新申请） */}
                {verifyCharId && (() => {
                    const vc = characters.find(c => c.id === verifyCharId);
                    if (!vc) return null;
                    return (
                        <FriendVerifyModal
                            char={vc}
                            isOpen
                            onClose={() => setVerifyCharId(null)}
                            onAccepted={() => { setVerifyCharId(null); openPrivateChat(vc.id); }}
                        />
                    );
                })()}
            </div>
        );
    }

    // CHAT VIEW
    return (
        <div className="h-full w-full bg-[#ededed] moro-laiwang flex flex-col font-sans relative overflow-hidden">
            {/* 群记忆宫殿"提取中"浮动胶囊 — 不阻塞交互 */}
            {groupPalaceStatus && (
                <div
                    className="absolute top-[100px] left-1/2 z-[150] animate-fade-in"
                    style={{
                        transform: 'translateX(-50%)',
                        pointerEvents: 'none',
                        willChange: 'transform, opacity',
                    }}
                >
                    <div
                        className="flex items-center gap-2.5 pl-2.5 pr-3.5 py-2 max-w-[20rem]"
                        style={{
                            background: 'rgba(255,255,255,0.88)',
                            borderRadius: 999,
                            border: '1px solid #eed6df',
                            boxShadow: '0 6px 18px -10px rgba(122,90,114,0.24)',
                        }}
                    >
                        <span
                            className="shrink-0 inline-block w-3.5 h-3.5 rounded-full border-2 border-slate-200 animate-spin"
                            style={{ borderTopColor: '#d8a5b7', animationDuration: '0.9s' }}
                        />
                        <span className="text-[11px] font-semibold text-slate-700 whitespace-nowrap">
                            群记忆整理中
                        </span>
                        <span className="text-[10px] text-slate-400 truncate">{groupPalaceStatus}</span>
                    </div>
                </div>
            )}

            {/* Header — safe-top spacer 透明 + backdrop-blur 自适应容器色，跟 iOS status bar 一致 */}
            <div className="shrink-0 z-30 sticky top-0 transition-all">
            <div className="bg-transparent backdrop-blur-xl" style={{ height: 'calc(var(--safe-top) + 2.5rem)' }} />
            <div className="bg-white/95 backdrop-blur-md px-5 py-3 flex items-center rounded-b-[2rem] min-h-[6rem] shadow-[0_14px_30px_-18px_rgba(50,48,60,0.3)]">
                {selectionMode ? (
                    <div className="flex items-center justify-between w-full">
                        <button onClick={() => { setSelectionMode(false); setSelectedMsgIds(new Set()); }} className="text-sm font-bold text-slate-500 px-2 py-1">取消</button>
                        <span className="text-sm font-bold text-slate-800">已选 {selectedMsgIds.size} 项</span>
                        <div className="w-10"></div>
                    </div>
                ) : (
                    <div className="relative w-full min-h-[56px] flex items-end justify-center">
                        <button onClick={() => setView('list')} className="absolute left-0 bottom-2 p-2 rounded-full text-slate-500 hover:bg-slate-100 active:scale-90 transition-transform">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
                        </button>
                        <div className="flex w-[calc(100%-7rem)] max-w-[420px] flex-col items-center justify-end text-center cursor-pointer" onClick={() => openGroupSettings()}>
                            <div className="flex items-center justify-center gap-1.5 max-w-full">
                                <h1 className="text-[15px] font-bold text-slate-800 truncate">
                                    {activeGroup?.name}
                                </h1>
                                {activeGroup?.pinned && <PushPin size={12} weight="fill" className="text-slate-400 shrink-0" />}
                                {activeGroup?.dissolved && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-400 font-bold shrink-0">已解散</span>}
                            </div>
                            <div className="mt-1 flex items-center justify-center gap-2 min-h-[18px]">
                                <p className="text-[10px] text-slate-400 font-medium">{activeGroup?.members.length} 成员</p>
                                {activeGroup?.mutedAll && (
                                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 font-bold flex items-center gap-0.5"><SpeakerSlash size={9} weight="fill" />全员禁言</span>
                                )}
                                {lastTokenUsage && (
                                    <div
                                        className="text-[9px] px-1.5 py-0.5 bg-slate-100 text-slate-400 rounded-md font-mono border border-slate-200"
                                        title={tokenBreakdown ? `prompt: ${tokenBreakdown.prompt} | completion: ${tokenBreakdown.completion} | msgs: ${tokenBreakdown.msgCount} | pass: ${tokenBreakdown.pass}` : ''}
                                    >
                                        {lastTokenUsage}
                                    </div>
                                )}
                            </div>
                        </div>
                        
                        {/* Reroll Button (Context Aware) */}
                        {canReroll && !isTyping && (
                            <button 
                                onClick={handleReroll} 
                                className="absolute right-20 bottom-2 p-2 rounded-full text-slate-500 hover:bg-slate-100 active:scale-90 transition-transform"
                                title="重新生成回复"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>
                            </button>
                        )}

                        {/* 群聊天记录查找入口 */}
                        <button
                            onClick={openSearch}
                            className="absolute right-10 bottom-2 p-2 rounded-full text-slate-500 hover:bg-slate-100 active:scale-90 transition-transform"
                            title="查找聊天记录"
                        >
                            <MagnifyingGlass size={20} weight="bold" />
                        </button>

                        {/* 群设置入口（原 + 面板里的「群设置」迁移到右上角；⚡手动触发已删除——空输入回车/发送即触发） */}
                        <button
                            onClick={() => openGroupSettings()}
                            className="absolute right-0 bottom-2 p-2 rounded-full text-slate-500 hover:bg-slate-100 active:scale-90 transition-transform"
                            title="群设置"
                        >
                            <GearSix size={20} weight="bold" />
                        </button>
                    </div>
                )}
            </div>
            </div>

            {/* 群聊天记录查找浮层（QQ 式）：顶部搜索条 + 命中列表，点结果跳转并高亮 */}
            {searchOpen && (
                <div className="absolute inset-0 z-[120] bg-[#faf9f6] flex flex-col animate-fade-in">
                    <div className="shrink-0 bg-white border-b border-[#ededed]">
                        <div style={{ height: 'var(--safe-top)' }} />
                        <div className="px-4 py-3 flex items-center gap-2">
                            <div className="flex-1 flex items-center gap-2 bg-slate-100 rounded-xl px-3 py-2">
                                <MagnifyingGlass size={18} className="text-slate-400 shrink-0" />
                                <input
                                    autoFocus
                                    value={searchTerm}
                                    onChange={e => setSearchTerm(e.target.value)}
                                    placeholder="搜索群聊天记录"
                                    className="flex-1 bg-transparent text-sm outline-none text-slate-700 placeholder:text-slate-400"
                                />
                                {searchTerm && (
                                    <button onClick={() => setSearchTerm('')} className="shrink-0 text-slate-300 hover:text-slate-400" title="清空">
                                        <XCircle size={18} weight="fill" />
                                    </button>
                                )}
                            </div>
                            <button onClick={() => setSearchOpen(false)} className="text-sm text-slate-500 font-medium px-1 shrink-0">取消</button>
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto no-scrollbar">
                        {searchTerm.trim() === '' ? (
                            <div className="px-10 py-16 text-center text-xs text-slate-300 leading-relaxed">输入关键词<br />查找群里说过的话</div>
                        ) : searchResults.length === 0 ? (
                            <div className="px-10 py-16 text-center text-xs text-slate-300">没有找到含「{searchTerm.trim()}」的聊天记录</div>
                        ) : (
                            <>
                                <div className="px-4 py-2.5 text-[11px] text-slate-400">{searchResults.length} 条结果</div>
                                {searchResults.map((m, idx) => {
                                    const isSystem = m.role === 'system' || m.type === 'system';
                                    const sender = isSystem ? '系统通知' : (m.role === 'user' ? displayNameOf(activeGroup, 'user') : displayNameOf(activeGroup, m.charId));
                                    const avatar = isSystem ? undefined : (m.role === 'user' ? userProfile.avatar : characters.find(c => c.id === m.charId)?.avatar);
                                    return (
                                        <button
                                            key={m.id || idx}
                                            onClick={() => jumpToMessage(m)}
                                            className="w-full flex items-start gap-3 px-4 py-3 border-b border-slate-100 text-left active:bg-slate-50 transition-colors"
                                        >
                                            {avatar ? (
                                                <img src={avatar} className="w-9 h-9 rounded-lg object-cover shrink-0" />
                                            ) : (
                                                <div className="w-9 h-9 rounded-lg bg-slate-100 shrink-0 flex items-center justify-center text-slate-300">
                                                    <Megaphone size={16} weight="fill" />
                                                </div>
                                            )}
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="text-xs font-bold text-slate-600 truncate">{sender}</span>
                                                    <span className="text-[10px] text-slate-300 shrink-0">{new Date(m.timestamp).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                                                </div>
                                                <p className="text-[13px] text-slate-700 leading-snug mt-0.5 line-clamp-2 break-all">{renderSnippet(m.content as string, searchTerm)}</p>
                                            </div>
                                        </button>
                                    );
                                })}
                                <div className="h-8" />
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* 群公告横幅（QQ 式）：进群置顶展示，点开看全文；群主/管理员可编辑 */}
            {activeGroup?.announcement?.text && !selectionMode && (
                <button
                    onClick={openAnnouncementModal}
                    className="shrink-0 w-full flex items-start gap-2 px-5 py-2.5 bg-[#fffdfa] border-b border-[#eed6df] text-left active:bg-[#fff4f7] transition-colors"
                >
                    <Megaphone size={16} weight="fill" className="text-[#9c5e74] shrink-0 mt-0.5" />
                    <p className="text-[12px] text-[#5a3140] leading-snug line-clamp-2 flex-1 min-w-0">
                        <span className="font-bold mr-1">群公告</span>
                        {activeGroup.announcement.text}
                    </p>
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 text-[#a892a3] shrink-0 mt-0.5"><path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" /></svg>
                </button>
            )}

            {/* Messages Area */}
            <div
                className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pt-6 pb-6 px-4 no-scrollbar"
                ref={scrollRef}
                style={groupBackgroundStyleFor(activeGroup?.chatBackgroundImage, osTheme.groupChatBackgroundStyle || osTheme.chatBackgroundStyle || 'plain')}
            >
                {totalMsgCount > messages.length && activeGroup && (
                    <div className="flex justify-center mb-4">
                        <button onClick={() => void loadMoreGroupHistory()} disabled={loadingGroupHistory} className="px-4 py-2 bg-white/50 backdrop-blur-sm rounded-full text-xs text-slate-500 shadow-sm border border-white hover:bg-white transition-colors disabled:opacity-50">
                            加载历史消息 ({totalMsgCount - messages.length})
                        </button>
                    </div>
                )}
                {groupOpeningPickerActive && !selectionMode && activeGroup && (
                    <div className="px-1 mb-5 animate-fade-in">
                        <div className="rounded-[22px] border border-white/80 bg-white/70 backdrop-blur-sm px-3 py-3 shadow-sm">
                            <div className="flex items-center justify-between gap-3 mb-3">
                                <div className="min-w-0">
                                    <div className="text-[11px] font-black text-slate-500">群聊开场白</div>
                                    <div className="text-[10px] text-slate-400 mt-0.5">
                                        {groupOpeningOptions.length > 1 ? '左右切换，选一组作为这份群聊的开头。' : '这组开场会作为这份群聊的开头。'}
                                    </div>
                                </div>
                                {groupOpeningOptions.length > 1 && (
                                    <div className="flex items-center gap-1.5 bg-white/80 rounded-full px-2 py-1 border border-white shadow-sm shrink-0">
                                        <button
                                            type="button"
                                            onClick={() => setGroupOpeningIdx(i => (i - 1 + groupOpeningOptions.length) % groupOpeningOptions.length)}
                                            className="p-1 rounded-full hover:bg-black/5 active:scale-90 transition-transform"
                                            title="上一组开场白"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor" className="w-3.5 h-3.5 text-slate-500"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
                                        </button>
                                        <span className="text-[10px] font-bold text-slate-500 tabular-nums select-none">
                                            {Math.min(groupOpeningIdx, groupOpeningOptions.length - 1) + 1} / {groupOpeningOptions.length}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => setGroupOpeningIdx(i => (i + 1) % groupOpeningOptions.length)}
                                            className="p-1 rounded-full hover:bg-black/5 active:scale-90 transition-transform"
                                            title="下一组开场白"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor" className="w-3.5 h-3.5 text-slate-500"><path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
                                        </button>
                                    </div>
                                )}
                            </div>
                            <div className="space-y-2.5">
                                {groupOpeningPreviewBubbles.map((bubble, idx) => {
                                    const member = characters.find(c => c.id === bubble.charId);
                                    const name = member ? displayNameOf(activeGroup, member.id) : activeGroup.name;
                                    return (
                                        <div key={`${bubble.charId}-${idx}`} className="flex items-end gap-2.5">
                                            <img src={member?.avatar || activeGroup.avatar} className="w-8 h-8 rounded-full object-cover shadow-sm shrink-0" alt="" />
                                            <div className="max-w-[82%] min-w-0">
                                                <div className="text-[10px] text-slate-400 font-bold mb-1 px-1">{name}</div>
                                                <div className="bg-white/95 border border-white rounded-2xl rounded-bl-md px-3.5 py-2.5 shadow-sm text-[13px] text-slate-700 leading-relaxed whitespace-pre-wrap break-words">
                                                    {bubble.content}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="flex items-center gap-2 mt-3 flex-wrap pl-10">
                                <button
                                    type="button"
                                    onClick={async () => {
                                        try {
                                            await commitGroupOpeningGreeting();
                                        } catch (e: any) {
                                            addToast(e?.message || '开场白保存失败', 'error');
                                        }
                                    }}
                                    className="px-3 py-1.5 bg-primary text-white text-[10px] font-bold rounded-full shadow-sm shadow-primary/30 active:scale-95 transition-transform"
                                >以这组开场开始</button>
                                <span className="text-[10px] text-slate-400">直接发消息也会先采用当前这组开场。</span>
                            </div>
                        </div>
                    </div>
                )}
                {renderMessages.map((m, i) => {
                    const isUser = m.role === 'user';
                    const char = characters.find(c => c.id === m.charId);
                    const prevMessage = i > 0 ? renderMessages[i - 1] : null;
                    const nextMessage = i < renderMessages.length - 1 ? renderMessages[i + 1] : null;
                    const messageGroupGapMs = 30 * 60 * 1000;
                    const senderKey = (msg: Message) => `${msg.role}:${msg.charId || (msg.role === 'user' ? 'user' : 'system')}`;
                    const isFirstInGroup =
                        !prevMessage ||
                        senderKey(prevMessage) !== senderKey(m) ||
                        Math.abs(m.timestamp - prevMessage.timestamp) > messageGroupGapMs;
                    const isLastInGroup =
                        !nextMessage ||
                        senderKey(nextMessage) !== senderKey(m) ||
                        Math.abs(nextMessage.timestamp - m.timestamp) > messageGroupGapMs;

                    return (
                        <div
                            key={m.id || i}
                            id={m.id != null ? `gmsg-${m.id}` : undefined}
                            className={`rounded-2xl transition-all duration-500 ${highlightMsgId === m.id ? 'ring-2 ring-slate-300 ring-offset-2 ring-offset-[#ededed] bg-white/40' : ''}`}
                        >
                            <GroupMessageItem
                                msg={m}
                                isUser={isUser}
                                isFirstInGroup={isFirstInGroup}
                                isLastInGroup={isLastInGroup}
                                char={char}
                                userAvatar={userProfile.avatar}
                                userName={userProfile.name || '我'}
                                onImageClick={(url) => window.open(url, '_blank')}
                                selectionMode={selectionMode}
                                isSelected={selectedMsgIds.has(m.id)}
                                onToggleSelect={toggleMessageSelection}
                                onLongPress={handleMessageLongPress}
                                onReeditRecalled={handleReeditRecalled}
                                onReactToggle={handleReactToggle}
                                displayName={char ? displayNameOf(activeGroup, char.id) : undefined}
                                memberTitle={char ? activeGroup?.memberTitles?.[char.id] : undefined}
                                onAvatarClick={char ? () => { setProfileMemberId(char.id); setTempTitle(activeGroup?.memberTitles?.[char.id] || ''); setConfirmRemoveId(null); setConfirmTransferId(null); setModalType('member-profile'); } : undefined}
                                onAvatarPoke={char ? () => handlePokeMember(char.id) : undefined}
                                onShowNicknameThought={(mm) => setNicknameThoughtMsg(mm)}
                                mentionNames={mentionNames}
                                onCollectClick={setCollectDetailMsg}
                                onRedPacketOpen={(mm) => { setRedPacketOpenMsg(mm); setRedPacketPasswordInput(''); }}
                                onPollVote={votePoll}
                                onPollClick={setPollDetailMsg}
                                onRelayClick={setRelayDetailMsg}
                                onCheckinClick={setCheckinDetailMsg}
                                specialCare={!isUser && activeGroup?.specialCareNotify !== false && !!char && (activeGroup?.specialCareMemberIds || []).includes(char.id)}
                                groupMembers={characters.filter(c => activeGroup?.members.includes(c.id))}
                                hideTimestamp={!!activeGroupConvo.hideTimestamp}
                                translationEnabled={!!activeGroupConvo.translationEnabled}
                            />
                        </div>
                    );
                })}
                {isTyping && (
                    <div className="flex items-center gap-2 pl-4 py-2 animate-pulse opacity-70">
                        <div className="flex -space-x-1">
                            <div className="w-6 h-6 rounded-full bg-slate-300 border-2 border-white"></div>
                            <div className="w-6 h-6 rounded-full bg-slate-200 border-2 border-white"></div>
                        </div>
                        <span className="text-xs text-slate-400 font-medium">有人正在落笔…</span>
                    </div>
                )}
            </div>

            {/* 输入区 */}
            <div className="bg-[#ededed] pb-safe shrink-0 z-40 relative">
                {activeGroup?.dissolved ? (
                    <div className="p-4 text-center text-xs text-slate-400 font-medium">此群聊已被解散，仅可查看历史消息</div>
                ) : voice.isRecording ? (
                    <div className="p-3 flex items-center gap-3">
                        <button onClick={() => voice.stopRecording(false)} className="w-10 h-10 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center active:scale-90 transition shrink-0" title="取消"><Trash size={20} weight="bold" /></button>
                        <div className="flex-1 min-w-0 bg-white rounded-[2rem] border border-slate-200 px-3 py-2 flex items-center gap-2">
                            <Microphone size={16} weight="fill" className="text-rose-500 shrink-0" />
                            <span className="text-[13px] font-bold text-rose-500 tabular-nums shrink-0">{voice.recordSecs}s</span>
                            <span className="text-[12px] text-slate-400 truncate">{voice.liveTranscript || '正在录音…'}</span>
                        </div>
                        <button onClick={() => voice.stopRecording(true)} className="h-10 px-4 rounded-full bg-primary text-white font-bold text-sm shrink-0 active:scale-95 transition flex items-center gap-1"><StopCircle size={18} weight="fill" />发送</button>
                    </div>
                ) : selectionMode ? (
                    <div className="p-3 flex justify-center bg-[#ededed]">
                        <button
                            onClick={deleteSelectedMessages}
                            className="w-full py-3 bg-white text-slate-600 font-bold rounded-[2rem] shadow-sm active:scale-95 transition-transform flex items-center justify-center gap-2"
                        >
                            <Trash size={20} weight="bold" />
                            删除 {selectedMsgIds.size} 条
                        </button>
                    </div>
                ) : (
                    <div className="px-4 py-3 rounded-t-[1.75rem] bg-white/95 backdrop-blur-2xl shadow-[0_-14px_30px_-18px_rgba(50,48,60,0.3)]">
                        {activeGroupConvo.headerDecorText && (
                            <div className="mb-2 text-center text-[11px] text-slate-400 leading-relaxed whitespace-pre-wrap break-words">
                                {activeGroupConvo.headerDecorText}
                            </div>
                        )}
                        <div className="flex items-end gap-3">
                        {/* 左外侧：贴纸册入口（与单聊一致） */}
                        <button
                            onClick={() => { setShowEmojiPicker(!showEmojiPicker); setShowActions(false); }}
                            className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 text-slate-400 hover:text-slate-700 active:scale-90 transition-transform"
                        >
                            <Sticker size={24} weight={showEmojiPicker ? 'fill' : 'bold'} />
                        </button>

                        {/* Input Field Container */}
                        <div className="flex-1 min-w-0 overflow-hidden bg-[#f4f4f6] rounded-[2rem] flex items-center px-1 border border-transparent focus-within:bg-white focus-within:border-slate-200 transition-all">
                            {/* @ 成员：群聊专属，但收进输入胶囊里，避免把整条输入栏挤偏 */}
                            <button
                                onClick={() => { setShowEmojiPicker(false); setShowActions(false); setModalType('mention-picker'); }}
                                className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-slate-400 hover:text-slate-700 active:scale-90 transition-transform text-[18px] font-bold leading-none"
                                title="@ 成员"
                            >
                                @
                            </button>
                            <textarea
                                rows={1}
                                value={input}
                                onChange={e => handleGroupInputChange(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        // 空输入回车 = 触发 AI 导演：发完消息后留空再按回车即可让成员们接话
                                        if (!input.trim()) {
                                            void triggerDirectorFromCurrent();
                                            return;
                                        }
                                        void handleSendMessage(input);
                                    }
                                }}
                                className="flex-1 min-w-0 bg-transparent px-3 py-3 text-[15px] outline-none resize-none max-h-28 text-[#2e2c36] placeholder:text-slate-400"
                                placeholder={activeGroupConvo.inputPlaceholderText || 'ʕ•ﻌ•ʔ 说点什么…'}
                                style={{ height: 'auto', minHeight: '24px' }}
                            />
                            {/* 输入框内右侧：回形针 = 别上点什么（功能抽屉） */}
                            <button
                                onClick={() => { setShowActions(!showActions); setShowEmojiPicker(false); }}
                                className={`p-2 -mr-1 ml-1 text-slate-400 hover:text-slate-700 transition-transform shrink-0 ${showActions ? 'rotate-45 text-slate-700' : ''}`}
                            >
                                <Paperclip size={24} weight={showActions ? 'bold' : 'regular'} />
                            </button>
                        </div>

                        {/* Send Button — 空输入时点击 = 触发 AI 导演让成员们接话（与空输入回车一致） */}
                        <button
                            onClick={() => {
                                if (!input.trim()) {
                                    void triggerDirectorFromCurrent();
                                    return;
                                }
                                void handleSendMessage(input);
                            }}
                            className={input.trim()
                                ? 'h-11 min-w-[72px] shrink-0 rounded-full bg-primary px-4 text-[11px] font-bold text-white shadow-lg active:scale-90 transition-transform'
                                : 'w-11 h-11 shrink-0 rounded-full flex items-center justify-center text-slate-300 hover:text-rose-300 hover:scale-110 active:scale-90 transition-all'}
                        >
                            {input.trim() ? '寄出' : <Heart className="w-7 h-7" weight="fill" />}
                        </button>
                        </div>
                        {activeGroupConvo.footerDecorText && (
                            <div className="mt-2 text-center text-[11px] text-slate-400 leading-relaxed whitespace-pre-wrap break-words">
                                {activeGroupConvo.footerDecorText}
                            </div>
                        )}
                    </div>
                )}

                {/* --- 功能面板：群聊动作直接执行，成员专属动作先选人 --- */}
                {showActions && (
                    <div className="h-64 bg-white/95 border-t border-slate-200 px-4 py-4 animate-slide-up overflow-y-auto no-scrollbar">
                        <div className="stationery-grid grid grid-cols-2 gap-x-3 gap-y-2.5">
                            {/* 寄给大家：直接发进群 */}
                            <div className="drawer-tag col-span-2"><span>寄 给 大 家</span></div>
                            {strip(<ImageSquare size={20} weight="bold" />, '发图片', '从相册选择图片', () => fileInputRef.current?.click())}
                            <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload} />
                            {strip(<Coins size={20} weight="bold" />, '发红包', '普通/口令/拼手气', () => setModalType('transfer'))}
                            {strip(<Wallet size={20} weight="bold" />, '发起收款', 'AA 收款·向群成员收钱', () => { setShowActions(false); setCollectMembers(new Set(activeGroup?.members || [])); setCollectAmount(''); setCollectNote(''); setModalType('collect'); })}
                            {strip(<ChartBar size={20} weight="bold" />, '发起投票', '群成员按性格投·看结果', () => { setShowActions(false); setPollQuestion(''); setPollOptions(['', '']); setModalType('poll'); })}
                            {strip(<ListNumbers size={20} weight="bold" />, '发起接龙', '主题接龙·成员自然加入', () => { setShowActions(false); setRelayTitle(''); setRelayFirst(''); setModalType('relay'); })}
                            {strip(<CalendarCheck size={20} weight="bold" />, '群签到', '每日打卡·成员陆续报到', handleGroupCheckin)}
                            {strip(<CassetteTape size={20} weight="bold" />, '发语音', '录制一段语音消息', () => { setShowActions(false); void voice.startRecording(); })}
                            {strip(<MapTrifold size={20} weight="bold" />, '落脚点', '分享一个地点', () => setActionModal('location'))}
                            {strip(<PaintBrush size={20} weight="bold" />, 'AI 画图', '生成一张图片', () => setActionModal('image-gen'))}
                            {strip(<HandTap size={20} weight="bold" />, '碰一碰', '戳一戳某位群友', () => openMemberPicker('poke', '戳一戳谁？'))}

                            {/* 群聊共用动作 */}
                            <div className="drawer-tag col-span-2"><span>群 里 一 起</span></div>
                            {strip(<PhoneOutgoing size={20} weight="bold" />, '拨过去', '发起群聊电话', () => void startGroupVoiceCall())}
                            {strip(<HandHeart size={20} weight="bold" />, '赴个约', '单独线下窗口', () => { setShowActions(false); setShowGroupOfflineMode(true); })}
                            {strip(<Detective size={20} weight="bold" />, '成员查岗', '选择一位群友查看手机', () => openMemberPicker('check-phone', '查谁的岗？'))}
                            {strip(<EnvelopeOpen size={20} weight="bold" />, '成员主动消息', '选择一位群友设置主动消息', () => openMemberPicker('proactive', '设置谁主动消息？'))}
                            {strip(<Scroll size={20} weight="bold" />, '成员日常', '选择一位群友看离线日常', () => openMemberPicker('life-recap', '看谁的日常？'))}

                            {/* 群聊工具 */}
                            <div className="drawer-tag col-span-2"><span>群 聊 工 具</span></div>
                            {strip(<BookBookmark size={20} weight="bold" />, isSummarizing ? '归档中…' : '归档群聊', '把群聊整理进群记忆', () => void archiveGroupMemory(), { disabled: isSummarizing })}
                            {strip(<Eraser size={20} weight="bold" />, '重写一遍', '撤掉上一轮重新接话', () => void rerollDirector(), { disabled: isTyping })}
                            {strip(<Wind size={20} weight="bold" />, '成员回神', '选择一位群友自我校准', () => openMemberPicker('recenter', '帮谁回个神？'))}
                            {strip(<CalendarCheck size={20} weight="bold" />, '成员作息', '选择一位群友看今日作息', () => openMemberPicker('schedule', '看谁的作息？'))}

                            {/* 特别通道 */}
                            <div className="drawer-tag col-span-2"><span>特 别 通 道</span></div>
                            {strip(<Hamburger size={20} weight="bold" />, '找人点单', '选择一位群友一起点麦麦', () => openMemberPicker('mcd-request', '和谁一起点？'))}
                            {strip(<Lightbulb size={20} weight="bold" />, '看看思绪', '调某位群友的思考展示', () => openMemberPicker('thinking-settings', '看谁的思绪？'))}
                            {strip(<Scroll size={20} weight="bold" />, '幕后指令', '给成员们一条 OOC 指令', () => setActionModal('system-cmd'), { ink: true })}
                        </div>
                    </div>
                )}

                {/* --- Emoji Drawer --- */}
                {showEmojiPicker && (
                    <div className="h-64 bg-white/95 border-t border-slate-200 animate-slide-up flex flex-col">
                        {/* 搜索：按名字/描述模糊匹配导入的表情包 */}
                        <div className="px-4 pt-3 pb-1 shrink-0">
                            <input
                                value={emojiSearch}
                                onChange={e => setEmojiSearch(e.target.value)}
                                placeholder="搜索表情：按名字或描述…"
                                className="w-full px-3 py-1.5 text-xs rounded-full outline-none border bg-white border-slate-200 text-slate-700 placeholder:text-slate-400 focus:border-slate-400"
                            />
                        </div>
                        <div className="flex-1 p-4 pt-2 overflow-y-auto no-scrollbar">
                            <div className="grid grid-cols-5 gap-3">
                                <button
                                    type="button"
                                    onClick={() => setShowEmojiImportModal(true)}
                                    className="scrap-card aspect-square rounded-xl p-2 active:scale-95 flex flex-col items-center justify-center border-dashed gap-1"
                                    title="收集图片表情"
                                >
                                    <Sticker size={26} weight="bold" />
                                    <span className="text-[9px] font-black tracking-widest text-slate-500">收集</span>
                                </button>
                                {emojis.filter(e => {
                                    const term = emojiSearch.trim().toLowerCase();
                                    if (!term) return true;
                                    return e.name.toLowerCase().includes(term) || (e.description || '').toLowerCase().includes(term);
                                }).map((e, i) => (
                                    <button key={i} onClick={() => handleSendMessage(e.url, 'emoji')} className="scrap-card aspect-square rounded-xl p-2 active:scale-95 flex flex-col items-center justify-center" title={e.description ? `${e.name}：${e.description}` : e.name}>
                                        <img src={stickerImageSrc(e.url)} className="w-full h-full object-contain pointer-events-none" />
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* --- Modals --- */}

            <EmojiImportModal
                isOpen={showEmojiImportModal}
                onClose={() => setShowEmojiImportModal(false)}
                categories={categories}
                defaultCategoryId="default"
                existingEmojis={emojis}
                onSave={handleSaveGroupImportedEmojis}
                addToast={addToast}
                title="收集群聊表情"
            />

            {showGroupOfflineMode && activeGroup && (
                <GroupOfflineModeModal
                    group={activeGroup}
                    members={characters.filter(c => activeGroup.members.includes(c.id))}
                    userProfile={userProfile}
                    apiConfig={apiConfig}
                    addToast={addToast}
                    onEnd={() => { void handleGroupOfflineEnd(); }}
                    onSuspend={handleGroupOfflineSuspend}
                />
            )}

            {groupCall && (
                <div className="absolute inset-0 z-[320] flex flex-col animate-fade-in overflow-hidden" style={{ paddingTop: 'var(--safe-top)', background: 'linear-gradient(180deg,#f7f8fb 0%,#eef1f6 55%,#e8ebf2 100%)' }}>
                    <div className="px-5 pt-5 pb-3 text-center shrink-0">
                        <div className="text-[11px] tracking-[0.24em] uppercase font-bold text-slate-400">Group Voice Call</div>
                        <div className="mt-2 text-[22px] font-black text-slate-800 truncate">{groupCall.groupName}</div>
                        <div className="mt-1 flex items-center justify-center gap-2 text-[13px] text-slate-400">
                            <span className="tabular-nums">{formatGroupCallDuration(groupCallSecs)}</span>
                            <span className="w-1 h-1 rounded-full bg-slate-300" />
                            <span className={groupCallState === 'error' ? 'text-red-400 font-bold' : 'text-slate-400'}>{getGroupCallStateLabel(groupCallState)}</span>
                        </div>
                    </div>

                    <div className="shrink-0 px-4 pb-3">
                        <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
                            {groupCall.members.map((member) => {
                                const latestSpeakerId = [...groupCallBubbles].reverse().find(item => item.role === 'assistant')?.charId;
                                const speaking = groupCallState === 'speaking' && latestSpeakerId === member.id;
                                return (
                                    <div key={member.id} className="flex flex-col items-center min-w-[66px]">
                                        <div className={`relative rounded-full p-1 transition-all ${speaking ? 'bg-emerald-300/70 shadow-[0_0_0_6px_rgba(110,231,183,0.18)]' : 'bg-white/80 shadow-sm'}`}>
                                            {member.avatar ? (
                                                <img src={member.avatar} alt="" className="w-14 h-14 rounded-full object-cover bg-slate-100 border-2 border-white" />
                                            ) : (
                                                <div className="w-14 h-14 rounded-full bg-slate-200 text-slate-500 border-2 border-white flex items-center justify-center text-lg font-black">
                                                    {member.name.slice(0, 1)}
                                                </div>
                                            )}
                                            {speaking && (
                                                <span className="absolute -right-0.5 bottom-1 w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center border-2 border-white">
                                                    <Microphone size={10} weight="fill" />
                                                </span>
                                            )}
                                        </div>
                                        <div className="mt-1.5 text-[11px] font-bold text-slate-600 truncate max-w-[62px]">{member.name}</div>
                                        <div className="mt-0.5 text-[9px] text-slate-400">{speaking ? '正在说话' : '已接入'}</div>
                                    </div>
                                );
                            })}
                            <button
                                onClick={() => addToast('邀请入口先留着，后面可以接入加成员', 'info')}
                                className="flex flex-col items-center min-w-[66px] active:scale-95 transition-transform"
                            >
                                <span className="w-16 h-16 rounded-full bg-white/80 border border-white text-slate-400 flex items-center justify-center shadow-sm">
                                    <UserPlus size={24} weight="bold" />
                                </span>
                                <span className="mt-1.5 text-[11px] font-bold text-slate-400">邀请</span>
                            </button>
                        </div>
                    </div>

                    <div ref={groupCallScrollRef} className="flex-1 overflow-y-auto no-scrollbar px-5 py-3">
                        {groupCallBubbles.length === 0 ? (
                            <div className="h-full min-h-[220px] flex flex-col items-center justify-center text-center text-slate-400">
                                <div className="w-16 h-16 rounded-full bg-white/80 flex items-center justify-center shadow-sm mb-4">
                                    <PhoneOutgoing size={25} weight="fill" />
                                </div>
                                <div className="text-sm font-bold text-slate-500">{groupCallState === 'error' ? '电话那头有点杂音' : '正在等大家接通'}</div>
                                <div className="mt-1 text-xs max-w-[240px] leading-relaxed">{groupCallError || '接通后，群友会像私聊电话一样先开口。'}</div>
                            </div>
                        ) : (
                            <div className="space-y-3 pb-2">
                                {groupCallBubbles.map(item => {
                                    const mine = item.role === 'user';
                                    return (
                                        <div key={item.id} className={`flex gap-2 ${mine ? 'justify-end' : 'justify-start'}`}>
                                            {!mine && (
                                                item.avatar ? (
                                                    <img src={item.avatar} alt="" className="w-8 h-8 rounded-full object-cover bg-slate-100 border border-white shrink-0 mt-5" />
                                                ) : (
                                                    <div className="w-8 h-8 rounded-full bg-white text-slate-400 border border-white shrink-0 mt-5 flex items-center justify-center text-xs font-black">
                                                        {(item.name || '群').slice(0, 1)}
                                                    </div>
                                                )
                                            )}
                                            <div className={`max-w-[78%] min-w-0 ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
                                                <div className={`mb-1 text-[10px] ${mine ? 'text-right text-slate-400' : 'text-slate-400'}`}>
                                                    {mine ? '我' : item.name || '群友'} · {item.time}
                                                </div>
                                                <div className={`px-4 py-2.5 rounded-[1.35rem] text-[14px] leading-relaxed whitespace-pre-wrap break-words shadow-sm ${mine ? 'bg-slate-800 text-white rounded-br-md' : 'bg-white text-slate-700 rounded-bl-md'}`}>
                                                    {item.text}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                                {groupCallState === 'thinking' && (
                                    <div className="flex items-center gap-2 pl-10 text-xs text-slate-400 animate-pulse">
                                        <span className="w-2 h-2 rounded-full bg-emerald-400" />
                                        群友们在电话那头接话…
                                    </div>
                                )}
                                {groupCallState === 'error' && groupCallError && (
                                    <div className="mx-auto w-fit max-w-[85%] rounded-2xl bg-red-50 px-3 py-2 text-xs text-red-400 text-center">
                                        {groupCallError}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="shrink-0 px-4 pb-6 pt-4 bg-white/82 backdrop-blur-2xl rounded-t-[2rem] shadow-[0_-18px_40px_-28px_rgba(15,23,42,0.5)]">
                        <div className="flex items-end gap-2 mb-4">
                            <div className="flex-1 min-w-0 bg-[#f4f4f6] rounded-[1.6rem] px-4 py-2.5 focus-within:bg-white focus-within:ring-1 focus-within:ring-slate-200 transition-all">
                                <textarea
                                    value={groupCallDraft}
                                    rows={1}
                                    onChange={e => setGroupCallDraft(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault();
                                            void handleGroupCallTurn();
                                        }
                                    }}
                                    disabled={groupCallState === 'connecting' || groupCallState === 'thinking'}
                                    placeholder={groupCallState === 'connecting' ? '正在接通…' : '对群友说点什么…'}
                                    className="w-full max-h-24 resize-none bg-transparent outline-none text-[14px] leading-relaxed text-slate-700 placeholder:text-slate-400 disabled:opacity-60"
                                />
                            </div>
                            <button
                                onClick={() => void handleGroupCallTurn()}
                                disabled={!groupCallDraft.trim() || groupCallState === 'connecting' || groupCallState === 'thinking'}
                                className="h-11 min-w-[58px] rounded-full bg-slate-800 px-4 text-[12px] font-black text-white disabled:bg-slate-200 disabled:text-slate-400 active:scale-95 transition-transform"
                            >
                                说
                            </button>
                        </div>
                        <div className="flex items-center justify-center gap-6">
                            <button onClick={() => setGroupCallMuted(v => !v)} className="flex flex-col items-center gap-1.5 active:scale-95 transition-transform">
                                <span className={`w-14 h-14 rounded-full flex items-center justify-center ${groupCallMuted ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600'}`}>
                                    {groupCallMuted ? <MicrophoneSlash size={23} weight="fill" /> : <Microphone size={23} weight="fill" />}
                                </span>
                                <span className="text-[10px] font-bold text-slate-400">{groupCallMuted ? '已静音' : '静音'}</span>
                            </button>
                            <button onClick={() => setGroupCallSpeakerOn(v => !v)} className="flex flex-col items-center gap-1.5 active:scale-95 transition-transform">
                                <span className={`w-14 h-14 rounded-full flex items-center justify-center ${groupCallSpeakerOn ? 'bg-slate-100 text-slate-600' : 'bg-slate-800 text-white'}`}>
                                    {groupCallSpeakerOn ? <SpeakerHigh size={23} weight="fill" /> : <SpeakerSlash size={23} weight="fill" />}
                                </span>
                                <span className="text-[10px] font-bold text-slate-400">{groupCallSpeakerOn ? '扬声器' : '听筒'}</span>
                            </button>
                            <button onClick={() => { void endGroupVoiceCall(); }} className="flex flex-col items-center gap-1.5 active:scale-95 transition-transform">
                                <span className="w-16 h-16 rounded-full bg-red-500 text-white flex items-center justify-center shadow-lg shadow-red-200">
                                    <PhoneSlash size={27} weight="fill" />
                                </span>
                                <span className="text-[10px] font-bold text-red-400">挂断</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Group Settings Panel */}
            {modalType === 'settings' && activeGroup && (
                <div className="absolute inset-0 z-[260] flex flex-col animate-fade-in" style={{ paddingTop: 'var(--safe-top)', backgroundColor: '#fafafa' }}>
                    <div className="shrink-0 flex items-center gap-3 px-4 py-3 bg-white" style={{ borderBottom: '1px solid #ededed', boxShadow: '0 1px 3px rgba(122,90,114,0.08)' }}>
                        <button
                            onClick={() => setModalType('none')}
                            className="w-9 h-9 rounded-full bg-white flex items-center justify-center active:scale-90 transition-transform shrink-0"
                            style={{ boxShadow: '0 1px 3px rgba(122,90,114,0.18)', border: '1px solid #ededed' }}
                            aria-label="返回群聊"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="#9c5e74" className="w-[18px] h-[18px]">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                            </svg>
                        </button>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-2">
                                <span className="text-[16px] font-bold leading-tight" style={{ color: '#5a3140' }}>群聊设置</span>
                                <span className="text-[8.5px] tracking-[0.24em] select-none" style={{ ...GROUP_SETTINGS_MONO, color: '#b07a8d' }}>GROUP SETTINGS</span>
                            </div>
                            <div className="text-[10px] truncate mt-0.5" style={{ color: '#a96f84' }}>{activeGroup.name} · 群聊设置</div>
                        </div>
                        <span className="shrink-0 px-3 py-1.5 rounded-full text-[10px] font-black" style={{ background: '#fffdfa', border: '1px solid #eed6df', color: '#a892a3' }}>自动保存</span>
                    </div>
                    <div className="flex-1 overflow-y-auto no-scrollbar px-3 pt-6 pb-12 space-y-8">
                <GroupSettingsPage no="01" title="群名与名片" en="Name Tags">
                    {/* Header Info */}
                    <div className="flex justify-center">
                        <div onClick={() => groupAvatarInputRef.current?.click()} className="w-24 h-24 flex items-center justify-center cursor-pointer overflow-hidden relative group active:scale-95 transition-transform" style={{ background: '#fffdfa', border: `1px solid #eed6df`, borderRadius: 22, boxShadow: '0 8px 18px -16px rgba(122,90,114,0.32)' }}>
                            {activeGroup?.avatar ? <img src={activeGroup.avatar} className="w-full h-full object-cover" /> : <span className="text-[11px] font-black" style={{ color: INK_SOFT }}>上传群头像</span>}
                            <div className="absolute inset-0 hidden group-hover:flex items-center justify-center" style={{ background: 'rgba(31,29,26,0.45)', color: '#f6f3ec' }}><ImageSquare size={24} weight="bold" /></div>
                        </div>
                        <input type="file" ref={groupAvatarInputRef} className="hidden" accept="image/*" onChange={handleGroupAvatarUpload} />
                    </div>
                    <div>
                        <ScrapLabel en="NAME">群名字</ScrapLabel>
                        <ScrapInput value={tempGroupName} onChange={e => setTempGroupName(e.target.value)} onBlur={() => void saveGroupSettingsDraft()} />
                        <ScrapNote className="mt-1.5">改完会在群里发送一条系统提示，成员们都能看见群名变化。</ScrapNote>
                    </div>

                    <div>
                        <ScrapLabel en="MY CARD">我的群名片</ScrapLabel>
                        <ScrapInput value={tempMyNickname} onChange={e => setTempMyNickname(e.target.value)} onBlur={() => void saveGroupSettingsDraft()} placeholder={userProfile.name} />
                        <ScrapNote className="mt-1.5">你在这个群里挂的名字，留空就用本名。成员们也会随心情和剧情给自己改名片。</ScrapNote>
                    </div>
                </GroupSettingsPage>

                <GroupSettingsPage no="02" title="群聊档案" en="Group Chats">
                    {(() => {
                        const sortedRecords = getSortedGroupChatRecords(activeGroup);
                        const query = groupArchiveSearch.trim();
                        const visibleRecords = sortedRecords.filter(record => groupArchiveMatches(record, messages, query));
                        const pillStyle: React.CSSProperties = { background: '#fffdfa', border: '1px solid #eed6df', color: '#9c5e74', boxShadow: '0 1px 2px rgba(122,90,114,0.10)' };
                        return (
                            <div className="pt-2">
                                <div className="py-3 border-b" style={{ borderColor: 'rgba(216,165,183,0.35)' }}>
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-1.5">
                                                <EnvelopeOpen size={13} weight="bold" style={{ color: '#c98ba0' }} />
                                                <span className="text-[12.5px] font-bold" style={{ color: INK }}>当前群的聊天文件</span>
                                            </div>
                                            <p className="text-[10px] mt-1 leading-relaxed" style={{ color: INK_SOFT }}>
                                                像 SillyTavern 一样给同一个群保留多份聊天：新建、打开、改名、置顶、导入、导出、删除。
                                            </p>
                                        </div>
                                        <div className="shrink-0 flex gap-1.5">
                                            <button type="button" onClick={() => void handleStartNewGroupChat()} className="text-[11px] font-bold px-2.5 py-1 rounded-full active:scale-95 transition-transform whitespace-nowrap" style={{ background: '#f6fbf8', border: '1px solid #dbe9e2', color: '#5f7f6d' }}>新聊天</button>
                                            <button type="button" onClick={() => groupArchiveInputRef.current?.click()} className="text-[11px] font-bold px-2.5 py-1 rounded-full active:scale-95 transition-transform whitespace-nowrap" style={pillStyle}>导入</button>
                                        </div>
                                    </div>
                                    <div className="mt-3 space-y-2.5">
                                        <div className="w-full">
                                            <div className="text-[9px] mb-0.5 tracking-wider" style={{ ...GROUP_SETTINGS_MONO, color: '#a892a3' }}>SEARCH</div>
                                            <input
                                                value={groupArchiveSearch}
                                                onChange={e => setGroupArchiveSearch(e.target.value)}
                                                placeholder="搜索标题、预览或聊天正文..."
                                                className="w-full px-3 py-2 text-[13px] outline-none rounded-[14px] placeholder:text-[#cfb8c4]"
                                                style={{ color: INK, caretColor: '#d8a5b7', background: '#fffdfa', border: '1px solid #eed6df' }}
                                            />
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            <button type="button" onClick={() => void openSearchFromGroupSettings()} className="text-[11px] font-bold px-2.5 py-1 rounded-full active:scale-95 transition-transform" style={pillStyle}>查询记录</button>
                                            <button type="button" onClick={() => void handleExportGroupChat('moro')} className="text-[11px] font-bold px-2.5 py-1 rounded-full active:scale-95 transition-transform" style={pillStyle}>导出当前可见</button>
                                            <button type="button" onClick={() => void handleExportGroupChat('jsonl')} className="text-[11px] font-bold px-2.5 py-1 rounded-full active:scale-95 transition-transform" style={pillStyle}>导出 JSONL</button>
                                            <button type="button" onClick={handleToggleGroupPinned} className="text-[11px] font-bold px-2.5 py-1 rounded-full active:scale-95 transition-transform" style={activeGroup?.pinned ? { background: '#5a3140', border: '1px solid #5a3140', color: '#fffdfa' } : pillStyle}>{activeGroup?.pinned ? '取消置顶群' : '置顶群聊'}</button>
                                            <button type="button" onClick={() => void handleDeleteAllGroupChatRecords()} className="text-[11px] font-bold px-2.5 py-1 rounded-full active:scale-95 transition-transform" style={{ background: '#fff5f7', border: '1px solid #f1c6d1', color: '#d4536f' }}>删除当前</button>
                                        </div>
                                    </div>
                                    <input type="file" ref={groupArchiveInputRef} className="hidden" accept=".json,.jsonl,.ndjson,application/json,text/plain" onChange={handleImportGroupChat} />
                                </div>

                                <div className="py-3">
                                    <div className="flex items-center gap-1.5">
                                        <EnvelopeOpen size={13} weight="bold" style={{ color: '#c98ba0' }} />
                                        <span className="text-[12.5px] font-bold" style={{ color: INK }}>聊天记录列表</span>
                                    </div>
                                    <p className="text-[10px] mt-1 leading-relaxed" style={{ color: INK_SOFT }}>
                                        共 {sortedRecords.length} 份档案，置顶会排在最上面。
                                    </p>

                                    <div className="mt-3 space-y-2.5 max-h-[380px] overflow-y-auto no-scrollbar pr-1">
                                        {visibleRecords.map(record => {
                                            const active = record.id === activeGroup?.activeChatRecordId;
                                            const renaming = renamingGroupRecordId === record.id;
                                            const sourceMessages = active ? messages : record.messages;
                                            const count = active ? totalMsgCount : record.messages.length;
                                            return (
                                                <div
                                                    key={record.id}
                                                    className="rounded-[14px] p-3"
                                                    style={{ background: active ? '#fff4f7' : '#fffdfa', border: active ? '1px solid #eab6c6' : '1px solid #eed6df' }}
                                                >
                                                    <div className="min-w-0">
                                                        <div className="flex items-center gap-1.5 min-w-0">
                                                            {active && <span className="text-[10px] shrink-0" style={{ color: '#7aa58a' }}>当前</span>}
                                                            {record.pinned && <span className="text-[10px] shrink-0" style={{ color: '#c98ba0' }}>置顶</span>}
                                                            {renaming ? (
                                                                <input
                                                                    value={renamingGroupRecordTitle}
                                                                    onChange={e => setRenamingGroupRecordTitle(e.target.value)}
                                                                    className="min-w-0 flex-1 px-2 py-1 rounded-[10px] outline-none text-[12px] font-bold"
                                                                    style={{ background: '#fff', border: '1px solid #e8cad4', color: INK }}
                                                                    maxLength={80}
                                                                    autoFocus
                                                                    onKeyDown={e => {
                                                                        if (e.key === 'Enter') void commitInlineRenameGroupRecord(record);
                                                                        if (e.key === 'Escape') { setRenamingGroupRecordId(null); setRenamingGroupRecordTitle(''); }
                                                                    }}
                                                                />
                                                            ) : (
                                                                <div className="text-[12.5px] font-bold truncate" style={{ color: INK }}>{record.title}</div>
                                                            )}
                                                        </div>
                                                        <div className="text-[9.5px] mt-1" style={{ ...GROUP_SETTINGS_MONO, color: INK_SOFT }}>
                                                            {count} 条 · {groupArchiveTimeLabel(record.updatedAt || record.createdAt)}
                                                        </div>
                                                        <div className="text-[10.5px] mt-1.5 leading-relaxed line-clamp-2" style={{ color: INK_SOFT }}>
                                                            {groupArchivePreview(sourceMessages)}
                                                        </div>
                                                    </div>

                                                    <div className="flex flex-wrap gap-1.5 mt-2.5">
                                                        {renaming ? (
                                                            <>
                                                                <button type="button" onClick={() => void commitInlineRenameGroupRecord(record)} className="text-[11px] font-bold px-2.5 py-1 rounded-full active:scale-95 transition-transform" style={{ background: '#f6fbf8', border: '1px solid #dbe9e2', color: '#5f7f6d' }}>保存</button>
                                                                <button type="button" onClick={() => { setRenamingGroupRecordId(null); setRenamingGroupRecordTitle(''); }} className="text-[11px] font-bold px-2.5 py-1 rounded-full active:scale-95 transition-transform" style={pillStyle}>取消</button>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <button type="button" onClick={() => void handleSwitchGroupChatRecord(record.id)} disabled={active} className="text-[11px] font-bold px-2.5 py-1 rounded-full active:scale-95 transition-transform disabled:opacity-40" style={{ background: '#f6fbf8', border: '1px solid #dbe9e2', color: '#5f7f6d' }}>打开</button>
                                                                <button type="button" onClick={() => beginInlineRenameGroupRecord(record)} className="text-[11px] font-bold px-2.5 py-1 rounded-full active:scale-95 transition-transform" style={pillStyle}>改名</button>
                                                                <button type="button" onClick={() => void handleToggleGroupChatRecordPinned(record)} className="text-[11px] font-bold px-2.5 py-1 rounded-full active:scale-95 transition-transform" style={pillStyle}>{record.pinned ? '取消置顶' : '置顶'}</button>
                                                                <button type="button" onClick={() => void handleExportGroupChatRecord(record, 'moro')} className="text-[11px] font-bold px-2.5 py-1 rounded-full active:scale-95 transition-transform" style={pillStyle}>导出</button>
                                                                <button type="button" onClick={() => void handleExportGroupChatRecord(record, 'jsonl')} className="text-[11px] font-bold px-2.5 py-1 rounded-full active:scale-95 transition-transform" style={pillStyle}>JSONL</button>
                                                                <button type="button" onClick={() => void handleDeleteGroupChatRecord(record)} className="text-[11px] font-bold px-2.5 py-1 rounded-full active:scale-95 transition-transform" style={{ background: '#fff5f7', border: '1px solid #f1c6d1', color: '#d4536f' }}>删除</button>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}

                                        {visibleRecords.length === 0 && (
                                            <div className="rounded-[14px] px-3 py-5 text-center text-[11px]" style={{ background: '#fffdfa', border: '1px dashed #eadbe2', color: INK_SOFT }}>
                                                {query ? '没有搜到匹配的群聊档案' : '还没有群聊档案。点「新聊天」会把当前群聊收进档案，并开启一页空白群聊。'}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })()}
                </GroupSettingsPage>

                <GroupSettingsPage no="03" title="开场白" en="Openers">
                    <div>
                        <ScrapLabel en="GROUP OPENERS">自定义开场白</ScrapLabel>
                        <div className="space-y-3">
                            {tempOpeningGreetings.map((greeting, idx) => (
                                <div
                                    key={idx}
                                    className="p-3"
                                    style={{ background: 'rgba(255,253,247,0.82)', border: '1px solid #eed6df', borderRadius: 16 }}
                                >
                                    <div className="flex items-center justify-between gap-2 mb-2">
                                        <div className="text-[11px] font-black" style={{ color: INK }}>开场 {idx + 1}</div>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const next = tempOpeningGreetings.filter((_, i) => i !== idx);
                                                setTempOpeningGreetings(next);
                                                void saveOpeningGreetingsDraft(next);
                                            }}
                                            className="text-[10px] font-bold px-2 py-1 rounded-full active:scale-95 transition-transform"
                                            style={{ background: '#fff5f7', border: '1px solid #f1c6d1', color: '#d4536f' }}
                                        >
                                            删除
                                        </button>
                                    </div>
                                    <ScrapTextarea
                                        value={greeting}
                                        onChange={e => {
                                            const next = [...tempOpeningGreetings];
                                            next[idx] = e.target.value;
                                            setTempOpeningGreetings(next);
                                        }}
                                        onBlur={() => void saveOpeningGreetingsDraft()}
                                        rows={4}
                                        maxLength={2000}
                                        placeholder={`比如：\n${displayNameOf(activeGroup, activeGroup?.members?.[0] || '')}：今晚谁先开麦？\n${displayNameOf(activeGroup, activeGroup?.members?.[1] || '')}：我先说，我刚好有事要八。`}
                                    />
                                </div>
                            ))}
                            {tempOpeningGreetings.length === 0 && (
                                <div className="rounded-[14px] px-3 py-5 text-center text-[11px]" style={{ background: '#fffdfa', border: '1px dashed #eadbe2', color: INK_SOFT }}>
                                    还没有开场白。新建后，空群聊会先让你挑一组开场再开始。
                                </div>
                            )}
                            <ScrapBtn
                                variant="paper"
                                full={false}
                                className="text-[12px] py-2 px-3"
                                onClick={() => {
                                    const firstMember = activeGroup?.members?.[0] || '';
                                    const secondMember = activeGroup?.members?.[1] || firstMember;
                                    const firstName = displayNameOf(activeGroup, firstMember);
                                    const secondName = displayNameOf(activeGroup, secondMember);
                                    const next = [
                                        ...tempOpeningGreetings,
                                        `${firstName}：${userProfile.name || '你'}，刚好你也在。\n${secondName}：那就从这件事说起吧。`,
                                    ];
                                    setTempOpeningGreetings(next);
                                    void saveOpeningGreetingsDraft(next);
                                }}
                                icon={<PencilSimpleLine size={14} weight="bold" />}
                            >
                                新增开场
                            </ScrapBtn>
                        </div>
                        <ScrapNote className="mt-2">
                            每条开场可写多行；用「成员名：内容」指定谁先说。支持 {'{{user}}'}、{'{{char}}'}、{'{{group}}'} 宏；没有写成员名前缀时默认由第一位群成员发出。
                        </ScrapNote>
                    </div>
                </GroupSettingsPage>

                <GroupSettingsPage no="04" title="说话的样子" en="Voice and Words">
                    {(() => {
                        const groupConvo = tempGroupConvo;
                        const liveOverride = groupConvo.liveChatOverride || 'inherit';
                        const liveEffective = resolveLiveChatEnabled(userProfile, liveOverride);
                        const emojiCounts = emojis.reduce((acc, emoji) => {
                            const key = emoji.categoryId || 'default';
                            acc[key] = (acc[key] || 0) + 1;
                            return acc;
                        }, {} as Record<string, number>);
                        const toggleAllowedEmojiCategory = (catId: string) => {
                            const current = new Set(groupConvo.allowedEmojiCategoryIds || []);
                            if (current.has(catId)) current.delete(catId);
                            else current.add(catId);
                            void saveGroupConvoDraft({ allowedEmojiCategoryIds: Array.from(current) });
                        };
                        const allCategoryIds = categories.map(cat => cat.id);
                        const selectedCategoryCount = groupConvo.allowedEmojiCategoryIds?.length || 0;
                        const pillStyle = (active: boolean): React.CSSProperties => active
                            ? { background: '#fff4f7', color: '#5a3140', border: '1px solid #d8a5b7' }
                            : { background: '#fffdfa', color: INK_SOFT, border: '1px solid #eed6df' };
                        return (
                            <div className="divide-y" style={{ borderColor: '#f0ece4' }}>
                                <GroupConvoEntry title="群友打字的习惯" note="选择本群成员生成消息时更常用的形式：一句一句分条，或一大段说完。">
                                    <div className="flex flex-wrap gap-2">
                                        {([['split', '一句一句蹦'], ['whole', '一大段说完']] as const).map(([mode, label]) => {
                                            const on = (groupConvo.bubbleStyleMode === 'whole' ? 'whole' : 'split') === mode;
                                            return (
                                                <button key={mode} type="button" onClick={() => void saveGroupConvoDraft({ bubbleStyleMode: mode })} className="px-3 py-1.5 rounded-full text-[11px] font-black active:scale-95 transition-transform" style={pillStyle(on)}>
                                                    {label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </GroupConvoEntry>

                                <GroupConvoEntry
                                    title="按人设随意"
                                    note="打开后，群成员按各自人设、情绪、关系和话题决定这一轮说长说短；只管长短，不改变上面的分条形式。"
                                    side={<GroupConvoToggle on={!!groupConvo.personaDrivenMessageLength} onToggle={() => void saveGroupConvoDraft({ personaDrivenMessageLength: !groupConvo.personaDrivenMessageLength })} />}
                                />

                                <GroupConvoEntry title="实时聊天模式" note={`发出文字后群成员会自动接话；停顿打字时，也可能看见未发送草稿并插一句。当前：${liveEffective ? '开启' : '关闭'}；全局默认：${liveChatGlobalEnabled ? '开启' : '关闭'}。`}>
                                    <div className="flex flex-wrap gap-2">
                                        {([['inherit', '跟随全局'], ['on', '本群开启'], ['off', '本群关闭']] as const).map(([value, label]) => {
                                            const on = liveOverride === value;
                                            return (
                                                <button key={value} type="button" onClick={() => void saveGroupConvoDraft({ liveChatOverride: value === 'inherit' ? undefined : value })} className="px-3 py-1.5 rounded-full text-[11px] font-black active:scale-95 transition-transform" style={pillStyle(on)}>
                                                    {label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </GroupConvoEntry>

                                <GroupConvoEntry
                                    title="连发也逐条回"
                                    note="打开后，你连续发几条文字时，本群会按顺序一条一条回应；每条都会单独调用一次 API，消耗也会增加。"
                                    side={<GroupConvoToggle on={!!groupConvo.autoReplyEachUserMessage} onToggle={() => void saveGroupConvoDraft({ autoReplyEachUserMessage: !groupConvo.autoReplyEachUserMessage })} />}
                                />

                                <GroupConvoEntry
                                    title="舞台旁白"
                                    note="打开后，模型能单独发一条动作/场景旁白气泡，写此刻神态、动作和环境；不会归属某个成员。"
                                    side={<GroupConvoToggle on={!!groupConvo.narrationMode} onToggle={() => void saveGroupConvoDraft({ narrationMode: !groupConvo.narrationMode })} />}
                                />

                                <GroupConvoEntry
                                    title="偷听小心思"
                                    note="允许在群里对某位成员生成一次性心声；结果只保存到心声历史，不写入群消息，也不会注入后续聊天上下文。"
                                    side={<GroupConvoToggle on={groupConvo.innerVoiceEnabled !== false} onToggle={() => void saveGroupConvoDraft({ innerVoiceEnabled: groupConvo.innerVoiceEnabled === false })} />}
                                >
                                    <div className="space-y-2">
                                        <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
                                            <select value={groupInnerVoiceTargetId} onChange={e => setGroupInnerVoiceTargetId(e.target.value)} className="min-w-0 rounded-[14px] px-3 py-2 text-[12px] outline-none" style={{ background: '#fffdfa', border: '1px solid #eed6df', color: INK }}>
                                                {(activeGroup.members || []).map(mid => (
                                                    <option key={mid} value={mid}>{displayNameOf(activeGroup, mid)}</option>
                                                ))}
                                            </select>
                                            <ScrapBtn variant="paper" full={false} className="text-[11px] px-3 py-2" disabled={groupConvo.innerVoiceEnabled === false || groupInnerVoiceLoading} onClick={() => void generateGroupInnerVoice()}>
                                                {groupInnerVoiceLoading ? '偷听中' : '听一下'}
                                            </ScrapBtn>
                                        </div>
                                        {groupInnerVoicePeek && (
                                            <div className="rounded-[14px] px-3 py-2" style={{ background: '#fff4f7', border: '1px solid #eed6df', color: '#5a3140' }}>
                                                <div className="text-[10px] font-black mb-1">{groupInnerVoicePeek.charName} 没说出口的</div>
                                                <div className="text-[12px] leading-relaxed whitespace-pre-wrap break-words">{groupInnerVoicePeek.content}</div>
                                            </div>
                                        )}
                                    </div>
                                </GroupConvoEntry>

                                <GroupConvoEntry
                                    title="双语对照"
                                    note="打开后，群消息先显示气泡语言，点「译」切到目标语言。"
                                    side={<GroupConvoToggle on={!!groupConvo.translationEnabled} onToggle={() => void saveGroupConvoDraft({ translationEnabled: !groupConvo.translationEnabled })} />}
                                >
                                    {groupConvo.translationEnabled && (
                                        <div className="space-y-3">
                                            <div>
                                                <div className="text-[9px] mb-1 tracking-wider" style={{ ...GROUP_SETTINGS_MONO, color: INK_SOFT }}>气泡先显示</div>
                                                <div className="flex flex-wrap gap-2">
                                                    {LANG_OPTIONS.map(lang => (
                                                        <button key={`source-${lang}`} type="button" onClick={() => void saveGroupConvoDraft({ translateSourceLang: lang })} className="px-2.5 py-1 rounded-full text-[10px] font-black active:scale-95 transition-transform" style={groupConvo.translateSourceLang === lang ? { background: INK, color: '#fffdfa', border: `1px solid ${INK}` } : pillStyle(false)}>
                                                            {lang}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                            <div>
                                                <div className="text-[9px] mb-1 tracking-wider" style={{ ...GROUP_SETTINGS_MONO, color: INK_SOFT }}>点「译」后变成</div>
                                                <div className="flex flex-wrap gap-2">
                                                    {LANG_OPTIONS.map(lang => (
                                                        <button key={`target-${lang}`} type="button" onClick={() => void saveGroupConvoDraft({ translateTargetLang: lang })} className="px-2.5 py-1 rounded-full text-[10px] font-black active:scale-95 transition-transform" style={groupConvo.translateTargetLang === lang ? { background: '#d8a5b7', color: '#fff', border: '1px solid #d8a5b7' } : pillStyle(false)}>
                                                            {lang}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                            <ScrapInput value={groupConvo.translateStyle || ''} onChange={e => setTempGroupConvo(prev => ({ ...prev, translateStyle: e.target.value }))} onBlur={e => void saveGroupConvoDraft({ translateStyle: e.target.value })} placeholder="译文笔调，比如：口语化 / 保留语气词…" />
                                        </div>
                                    )}
                                </GroupConvoEntry>

                                <GroupConvoEntry
                                    title="斗图的兴致"
                                    note="打开后，群成员会在情绪对上的时候自己联想着发表情包。"
                                    side={<GroupConvoToggle on={!!groupConvo.emojiAssociation} onToggle={() => void saveGroupConvoDraft({ emojiAssociation: !groupConvo.emojiAssociation })} />}
                                />

                                <GroupConvoEntry title="表情包权限" note="选择当前群可用的表情分类；最终仍会尊重分类原本的角色可见权限。">
                                    <div className="flex flex-wrap gap-2">
                                        {categories.length === 0 && <span className="text-[10px]" style={{ color: INK_SOFT }}>还没建过表情分类</span>}
                                        {categories.map(cat => {
                                            const selected = selectedCategoryCount === 0 || !!groupConvo.allowedEmojiCategoryIds?.includes(cat.id);
                                            const restricted = !!cat.allowedCharacterIds?.length;
                                            return (
                                                <button key={cat.id} type="button" onClick={() => toggleAllowedEmojiCategory(cat.id)} className="px-2.5 py-1 rounded-full text-[10px] font-black active:scale-95 transition-transform" style={selected ? pillStyle(true) : { background: '#fffdfa', color: '#b9a6af', border: '1px solid #eed6df', textDecoration: 'line-through' }}>
                                                    {cat.name} · {emojiCounts[cat.id] || 0} 张{restricted ? ' · 限角色' : ''}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                        <button type="button" className="text-[10px] font-bold px-2.5 py-1 rounded-full active:scale-95 transition-transform" style={pillStyle(false)} onClick={() => void saveGroupConvoDraft({ allowedEmojiCategoryIds: undefined })}>允许全部分类</button>
                                        <button type="button" className="text-[10px] font-bold px-2.5 py-1 rounded-full active:scale-95 transition-transform" style={pillStyle(false)} onClick={() => void saveGroupConvoDraft({ allowedEmojiCategoryIds: allCategoryIds })}>只按已列分类</button>
                                    </div>
                                </GroupConvoEntry>

                                <GroupConvoEntry title="输入框小装饰" note="这些只改变本群聊天界面的显示，不影响成员个人设置。">
                                    <div className="space-y-2">
                                        <ScrapInput value={groupConvo.headerDecorText || ''} onChange={e => setTempGroupConvo(prev => ({ ...prev, headerDecorText: e.target.value }))} onBlur={e => void saveGroupConvoDraft({ headerDecorText: e.target.value })} placeholder="输入框上方提示（可留空）" />
                                        <ScrapInput value={groupConvo.footerDecorText || ''} onChange={e => setTempGroupConvo(prev => ({ ...prev, footerDecorText: e.target.value }))} onBlur={e => void saveGroupConvoDraft({ footerDecorText: e.target.value })} placeholder="输入框下方提示（可留空）" />
                                        <ScrapInput value={groupConvo.inputPlaceholderText || ''} onChange={e => setTempGroupConvo(prev => ({ ...prev, inputPlaceholderText: e.target.value }))} onBlur={e => void saveGroupConvoDraft({ inputPlaceholderText: e.target.value })} placeholder="输入框占位文字（可留空）" />
                                    </div>
                                </GroupConvoEntry>

                                <GroupConvoEntry
                                    title="隐藏时间戳"
                                    note="打开后，本群消息上方不显示具体发送时间。"
                                    side={<GroupConvoToggle on={!!groupConvo.hideTimestamp} onToggle={() => void saveGroupConvoDraft({ hideTimestamp: !groupConvo.hideTimestamp })} />}
                                />

                                <GroupConvoEntry title="导演能翻多少条" note="只影响本群导演生成时读取的最近聊天条数；旧的全局本地值只作为没有群设置时的首次兜底。">
                                    <ScrapLabel en="CONTEXT">最近 {groupConvo.contextLimit || DEFAULT_GROUP_CONTEXT_LIMIT} 条</ScrapLabel>
                                    <input type="range" min="20" max="5000" step="10" value={groupConvo.contextLimit || DEFAULT_GROUP_CONTEXT_LIMIT} onChange={e => void saveGroupConvoDraft({ contextLimit: parseInt(e.target.value, 10) })} className="w-full h-2 rounded-full appearance-none" style={{ background: '#d9d3c7', accentColor: INK }} />
                                </GroupConvoEntry>
                            </div>
                        );
                    })()}
                </GroupSettingsPage>

                <GroupSettingsPage no="05" title="公告与成员" en="Members">
                    {/* 群公告：群主/管理员可发布，所有成员可查看 */}
                    <div>
                        <ScrapLabel en="NOTICE">群里公告</ScrapLabel>
                        <button
                            type="button"
                            onClick={openAnnouncementModal}
                            className="w-full flex items-center gap-2.5 px-4 py-3 text-left active:scale-[0.99] transition-transform"
                            style={{ background: 'rgba(255,253,247,0.92)', border: '1px solid #eed6df', outline: 'none', borderRadius: 16 }}
                        >
                            <Megaphone size={18} weight="fill" className="shrink-0" style={{ color: INK }} />
                            <span className="flex-1 min-w-0 text-sm font-bold truncate" style={{ color: activeGroup?.announcement?.text ? INK : INK_SOFT }}>
                                {activeGroup?.announcement?.text || (userCanManage(activeGroup) ? '点这儿钉一条公告…' : '还没有公告')}
                            </span>
                            <span className="shrink-0" style={{ color: INK_SOFT }}>›</span>
                        </button>
                        <ScrapNote className="mt-1.5">{userCanManage(activeGroup) ? '群主和管理员能发布或撤回公告；发布后会在群里发送系统提示，成员都能看见并自然回应。' : '只有群主和管理员能钉公告，你能看。'}</ScrapNote>
                    </div>

                    {/* 全员禁言开关（群主/管理员） */}
                    {userCanManage(activeGroup) && (
                        <div className="flex items-center justify-between gap-3 py-1">
                            <div className="min-w-0">
                                <div className="text-[13px] font-black flex items-center gap-1.5" style={{ color: INK }}><SpeakerSlash size={14} weight="bold" style={{ color: INK_SOFT }} />全员闭麦</div>
                                <ScrapNote className="mt-0.5">开了之后大家先安静，只剩你能开口。</ScrapNote>
                            </div>
                            <button
                                type="button"
                                onClick={handleToggleMuteAll}
                                className="relative w-11 h-6 rounded-full shrink-0 transition-colors"
                                style={{ background: activeGroup?.mutedAll ? INK : '#d9d3c7', backgroundImage: activeGroup?.mutedAll ? 'repeating-linear-gradient(45deg, rgba(255,255,255,0.16) 0 5px, transparent 5px 10px)' : undefined }}
                            >
                                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-transform ${activeGroup?.mutedAll ? 'translate-x-5' : ''}`} style={{ background: '#fbf9f2', boxShadow: '0 1px 3px rgba(31,29,26,0.4)' }} />
                            </button>
                        </div>
                    )}

                    {/* 群成员管理：点成员进资料页（管理员可禁言/设头衔/移除） */}
                    <div className="pt-3">
                        <ScrapDivider className="mb-3" />
                        <ScrapLabel en="MEMBERS">在场的人 · {activeGroup?.members.length}</ScrapLabel>
                        <div className="grid grid-cols-4 gap-2 max-h-40 overflow-y-auto no-scrollbar pr-1">
                            {(activeGroup?.members || []).map(mid => {
                                const c = characters.find(ch => ch.id === mid);
                                if (!c) return null;
                                const muted = isMuted(activeGroup, mid);
                                return (
                                    <ScrapPickTile
                                        key={mid}
                                        src={c.avatar}
                                        label={displayNameOf(activeGroup, mid)}
                                        dim={muted}
                                        badge={muted ? <SpeakerSlash size={12} weight="fill" style={{ color: INK }} /> : undefined}
                                        onClick={() => { setProfileMemberId(mid); setTempTitle(activeGroup?.memberTitles?.[mid] || ''); setConfirmRemoveId(null); setConfirmTransferId(null); setModalType('member-profile'); }}
                                    />
                                );
                            })}
                            {userCanManage(activeGroup) && !activeGroup?.dissolved && (
                                <button onClick={() => setModalType('add-member')} className="flex flex-col items-center justify-center gap-1 p-2 active:scale-95 transition-transform" style={{ border: `1.5px dashed ${INK_SOFT}`, borderRadius: 12, color: INK_SOFT }}>
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-8 h-8"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                                    <span className="text-[9px] font-black">拉人</span>
                                </button>
                            )}
                        </div>
                        <ScrapNote className="mt-2">点成员看资料；聊天里点头像也能进，连点两下就是戳一戳。</ScrapNote>
                    </div>
                </GroupSettingsPage>

                <GroupSettingsPage no="06" title="角色之间的关系" en="Perspective">
                    {(() => {
                        const memberList = (activeGroup?.members || [])
                            .map(id => characters.find(ch => ch.id === id))
                            .filter(Boolean) as CharacterProfile[];
                        const selectedViewer = memberList.find(member => member.id === tempLensViewerId) || memberList[0] || null;
                        const savedCount = activeGroup ? groupMemberLensCount(activeGroup.memberLenses, activeGroup.members) : 0;
                        const lensTargets = selectedViewer ? memberList.filter(target => target.id !== selectedViewer.id) : [];
                        const blankLensTargets = selectedViewer
                            ? lensTargets.filter(target => !(tempMemberLenses[selectedViewer.id]?.[target.id] || '').trim())
                            : [];
                        return (
                            <div className="pt-3 space-y-4">
                                <ScrapDivider className="mb-3" />
                                <div>
                                    <div className="flex items-baseline gap-2 mb-1">
                                        <div className="text-[16px] font-black leading-tight" style={{ color: INK }}>角色之间的关系</div>
                                        <div className="text-[9px] tracking-[0.32em]" style={{ ...GROUP_SETTINGS_MONO, color: INK_SOFT }}>PERSPECTIVE</div>
                                    </div>
                                    <ScrapNote>设置“在某个角色眼里，谁是谁、彼此什么关系、有没有过节”。这些只用于该角色自己的发言，不会写进群聊记录。</ScrapNote>
                                </div>

                                {memberList.length < 2 ? (
                                    <ScrapNote center className="py-8">至少要有两个群成员，才写得出彼此眼里的关系。</ScrapNote>
                                ) : (
                                    <>
                                        <div>
                                            <ScrapLabel en="VIEWPOINT">从谁的视角写</ScrapLabel>
                                            <div className="grid grid-cols-4 gap-2 max-h-36 overflow-y-auto no-scrollbar pr-1">
                                                {memberList.map(member => (
                                                    <ScrapPickTile
                                                        key={member.id}
                                                        src={member.avatar}
                                                        label={displayNameOf(activeGroup, member.id)}
                                                        selected={selectedViewer?.id === member.id}
                                                        badge={tempMemberLenses[member.id] && Object.keys(tempMemberLenses[member.id]).length > 0
                                                            ? <span className="text-[9px] font-black" style={{ color: INK }}>{Object.keys(tempMemberLenses[member.id]).length}</span>
                                                            : undefined}
                                                        onClick={() => setTempLensViewerId(member.id)}
                                                    />
                                                ))}
                                            </div>
                                        </div>

                                        {selectedViewer && (
                                            <div className="space-y-3">
                                                <div className="space-y-2">
                                                    <div className="flex items-center justify-between gap-3">
                                                        <ScrapLabel en="RELATIONS" className="mb-0 flex-1 min-w-0">写给 {displayNameOf(activeGroup, selectedViewer.id)} 自己看的</ScrapLabel>
                                                        <span className="shrink-0 text-[9px] font-bold px-2 py-1 rounded-full" style={{ background: '#fffdfa', border: '1px solid #eed6df', color: INK_SOFT }}>
                                                            已存 {savedCount}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <ScrapBtn
                                                            variant="ghost"
                                                            full={false}
                                                            className="!py-2 !px-3 text-[11px] shrink-0"
                                                            disabled={!!memberLensGeneratingKey}
                                                            icon={<Lightbulb size={14} weight="bold" />}
                                                            onClick={() => {
                                                                if (!blankLensTargets.length) {
                                                                    addToast('当前视角没有空白关系，单张卡片可重新生成', 'info');
                                                                    return;
                                                                }
                                                                void generateMemberLensDrafts(selectedViewer, blankLensTargets);
                                                            }}
                                                        >
                                                            {memberLensGeneratingKey === `${selectedViewer.id}:all` ? '生成中' : '补全空白'}
                                                        </ScrapBtn>
                                                        <ScrapNote className="flex-1">生成后仍可手改，再点底部保存。</ScrapNote>
                                                    </div>
                                                </div>
                                                <div className="space-y-3">
                                                    {lensTargets.map(target => {
                                                        const value = tempMemberLenses[selectedViewer.id]?.[target.id] || '';
                                                        return (
                                                            <div
                                                                key={`${selectedViewer.id}-${target.id}`}
                                                                className="p-3"
                                                                style={{ background: 'rgba(255,253,247,0.76)', border: '1px solid #eed6df', borderRadius: 16 }}
                                                            >
                                                                <div className="flex items-center gap-2 mb-2">
                                                                    <img src={target.avatar} className="w-8 h-8 rounded-full object-cover shrink-0" />
                                                                    <div className="min-w-0 flex-1">
                                                                        <div className="text-[13px] font-black truncate" style={{ color: INK }}>
                                                                            {displayNameOf(activeGroup, selectedViewer.id)} 眼里的 {displayNameOf(activeGroup, target.id)}
                                                                        </div>
                                                                        <div className="text-[9.5px] truncate" style={{ color: INK_SOFT }}>例：以前合作过，嘴上互怼但彼此认可；或：刚进群，还不熟。</div>
                                                                    </div>
                                                                    <ScrapBtn
                                                                        variant="ghost"
                                                                        full={false}
                                                                        className="!py-1.5 !px-2 text-[10px] shrink-0"
                                                                        disabled={!!memberLensGeneratingKey}
                                                                        icon={<Lightbulb size={12} weight="bold" />}
                                                                        onClick={() => void generateMemberLensDrafts(selectedViewer, [target])}
                                                                    >
                                                                        {memberLensGeneratingKey === `${selectedViewer.id}:${target.id}` ? '生成中' : '生成'}
                                                                    </ScrapBtn>
                                                                </div>
                                                                <ScrapTextarea
                                                                    value={value}
                                                                    onChange={e => updateMemberLensDraft(selectedViewer.id, target.id, e.target.value)}
                                                                    onBlur={() => void saveMemberLensesDraft()}
                                                                    rows={3}
                                                                    maxLength={500}
                                                                    placeholder={`写 ${displayNameOf(activeGroup, selectedViewer.id)} 怎么看 ${displayNameOf(activeGroup, target.id)}…`}
                                                                />
                                                                <div className="mt-1.5 flex items-center justify-between gap-2">
                                                                    <ScrapNote>只给 {displayNameOf(activeGroup, selectedViewer.id)} 的发言参考。</ScrapNote>
                                                                    <span className="text-[9px]" style={{ color: INK_SOFT }}>{value.length}/500</span>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                                <ScrapBtn
                                                    variant="paper"
                                                    className="text-xs"
                                                    onClick={() => void saveMemberLensesDraft().then(() => addToast('角色关系视角已保存', 'success'))}
                                                    icon={<IdentificationCard size={15} weight="bold" />}
                                                >
                                                    保存这些视角
                                                </ScrapBtn>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        );
                    })()}
                </GroupSettingsPage>

                <GroupSettingsPage no="07" title="特别关心" en="Special Care">
                    <div className="pt-3">
                        <ScrapDivider className="mb-3" />
                        <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                                <ScrapLabel en="SPECIAL CARE">特别关心角色</ScrapLabel>
                                <ScrapNote className="mt-0.5">这些成员在群里发言会带提醒感，适合你想重点追的角色。</ScrapNote>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    const next = !tempSpecialCareNotify;
                                    setTempSpecialCareNotify(next);
                                    void applyGroupUpdate({ specialCareNotify: next });
                                }}
                                className="relative w-11 h-6 rounded-full shrink-0 transition-colors"
                                style={{ background: tempSpecialCareNotify ? INK : '#d9d3c7' }}
                                title={tempSpecialCareNotify ? '消息提醒开启' : '消息提醒关闭'}
                            >
                                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-transform ${tempSpecialCareNotify ? 'translate-x-5' : ''}`} style={{ background: '#fbf9f2', boxShadow: '0 1px 3px rgba(31,29,26,0.35)' }} />
                            </button>
                        </div>
                        <div className="grid grid-cols-4 gap-2 mt-3 max-h-36 overflow-y-auto no-scrollbar pr-1">
                            {(activeGroup?.members || []).map(mid => {
                                const c = characters.find(ch => ch.id === mid);
                                if (!c) return null;
                                return (
                                    <ScrapPickTile
                                        key={mid}
                                        src={c.avatar}
                                        label={displayNameOf(activeGroup, mid)}
                                        selected={tempSpecialCareIds.has(mid)}
                                        badge={tempSpecialCareIds.has(mid) ? <BellRinging size={12} weight="fill" style={{ color: INK }} /> : undefined}
                                        onClick={() => setTempSpecialCareIds(prev => {
                                            const next = new Set(prev);
                                            if (next.has(mid)) next.delete(mid);
                                            else next.add(mid);
                                            void applyGroupUpdate({ specialCareMemberIds: Array.from(next).filter(id => activeGroup.members.includes(id)) });
                                            return next;
                                        })}
                                    />
                                );
                            })}
                        </div>
                    </div>
                </GroupSettingsPage>

                <GroupSettingsPage no="08" title="背景与记忆" en="Background Memory">
                    <div className="pt-3">
                        <ScrapDivider className="mb-3" />
                        <ScrapLabel en="AI REPLIES">角色怎么接话</ScrapLabel>
                        <div className="space-y-3">
                            <div className="flex items-center justify-between gap-3 py-1">
                                <div className="min-w-0">
                                    <div className="text-[13px] font-black flex items-center gap-1.5" style={{ color: INK }}><ChatsTeardrop size={14} weight="bold" style={{ color: INK_SOFT }} />角色各自回复</div>
                                    <ScrapNote className="mt-0.5">开启后，每个成员各自调用一次 API，像各自拿着手机决定要不要回。</ScrapNote>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => {
                                        const next = !tempReplyIndividually;
                                        setTempReplyIndividually(next);
                                        void applyGroupUpdate({
                                            replyIndividually: next,
                                            autoContinueEnabled: tempAutoContinueEnabled,
                                            autoContinueRounds: tempAutoContinueRounds,
                                        });
                                    }}
                                    className="relative w-11 h-6 rounded-full shrink-0 transition-colors"
                                    style={{ background: tempReplyIndividually ? INK : '#d9d3c7' }}
                                    title={tempReplyIndividually ? '已开启角色各自回复' : '已关闭角色各自回复'}
                                >
                                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-transform ${tempReplyIndividually ? 'translate-x-5' : ''}`} style={{ background: '#fbf9f2', boxShadow: '0 1px 3px rgba(31,29,26,0.35)' }} />
                                </button>
                            </div>

                            <div className={`space-y-3 ${tempReplyIndividually ? '' : 'opacity-60'}`}>
                                <div className="p-3 space-y-2" style={{ background: 'rgba(255,253,247,0.72)', border: `1px solid ${INK_SOFT}33`, borderRadius: 14 }}>
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="min-w-0">
                                            <div className="text-[12px] font-black" style={{ color: INK }}>本群默认 API</div>
                                            <ScrapNote className="mt-0.5">只在「角色各自回复」里生效；成员未单独设置时会用这里。</ScrapNote>
                                        </div>
                                        <span className="shrink-0 max-w-[104px] truncate px-2 py-1 rounded-full text-[9px] font-mono" style={{ color: INK_SOFT, background: '#fff', border: `1px solid ${INK_SOFT}33` }}>
                                            {groupApiStatus(tempGroupApi)}
                                        </span>
                                    </div>
                                    {renderGroupApiFields(
                                        tempGroupApi,
                                        patchTempGroupApi,
                                        () => { void saveGroupApiDraft(); },
                                        { kind: 'group' },
                                    )}
                                    <div className="grid grid-cols-2 gap-2">
                                        <ScrapBtn variant="paper" full={false} className="text-[11px] py-2" onClick={copyMainApiToGroup} icon={<Copy size={14} weight="bold" />}>复制主 API</ScrapBtn>
                                        <ScrapBtn variant="ghost" full={false} className="text-[11px] py-2" onClick={clearGroupApi} icon={<Eraser size={14} weight="bold" />}>清除本群默认</ScrapBtn>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <ScrapLabel en="MEMBER API">成员单独 API</ScrapLabel>
                                    <ScrapNote>优先级：成员专属 API → 本群默认 API → 文具盒主 API。不填就自动回退下一层。</ScrapNote>
                                    <div className="space-y-2 max-h-72 overflow-y-auto no-scrollbar pr-1">
                                        {(activeGroup?.members || []).map(mid => {
                                            const member = characters.find(c => c.id === mid);
                                            const memberApi = tempMemberApis[mid] || emptyGroupApi();
                                            return (
                                                <div key={mid} className="p-3 space-y-2" style={{ background: '#fff', border: `1px solid ${INK_SOFT}26`, borderRadius: 14 }}>
                                                    <div className="flex items-center gap-2">
                                                        <img src={member?.avatar} className="w-8 h-8 object-cover rounded-full shrink-0" alt="" />
                                                        <div className="min-w-0 flex-1">
                                                            <div className="text-[12px] font-black truncate" style={{ color: INK }}>{displayNameOf(activeGroup, mid)}</div>
                                                            <div className="text-[9px] font-mono truncate" style={{ color: INK_SOFT }}>{groupApiStatus(memberApi)}</div>
                                                        </div>
                                                        <ScrapBtn variant="paper" full={false} className="text-[10px] py-1.5 px-2" onClick={() => copyMainApiToMember(mid)} icon={<Copy size={12} weight="bold" />}>复制</ScrapBtn>
                                                        <ScrapBtn variant="ghost" full={false} className="text-[10px] py-1.5 px-2" onClick={() => clearMemberApi(mid)} icon={<Eraser size={12} weight="bold" />}>清除</ScrapBtn>
                                                    </div>
                                                    {renderGroupApiFields(
                                                        memberApi,
                                                        (field, value) => patchTempMemberApi(mid, field, value),
                                                        () => { void saveGroupApiDraft(); },
                                                        { kind: 'member', charId: mid },
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center justify-between gap-3 py-1">
                                <div className="min-w-0">
                                    <div className="text-[13px] font-black flex items-center gap-1.5" style={{ color: INK }}><ListNumbers size={14} weight="bold" style={{ color: INK_SOFT }} />让角色自动接话</div>
                                    <ScrapNote className="mt-0.5">你发完一句后，角色会继续聊几轮；你可以像旁观者一样看他们自然对话。</ScrapNote>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => {
                                        const next = !tempAutoContinueEnabled;
                                        setTempAutoContinueEnabled(next);
                                        void applyGroupUpdate({
                                            replyIndividually: tempReplyIndividually,
                                            autoContinueEnabled: next,
                                            autoContinueRounds: tempAutoContinueRounds,
                                        });
                                    }}
                                    className="relative w-11 h-6 rounded-full shrink-0 transition-colors"
                                    style={{ background: tempAutoContinueEnabled ? INK : '#d9d3c7' }}
                                    title={tempAutoContinueEnabled ? '已开启自动接话' : '已关闭自动接话'}
                                >
                                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-transform ${tempAutoContinueEnabled ? 'translate-x-5' : ''}`} style={{ background: '#fbf9f2', boxShadow: '0 1px 3px rgba(31,29,26,0.35)' }} />
                                </button>
                            </div>

                            <div className={`transition-opacity ${tempAutoContinueEnabled ? 'opacity-100' : 'opacity-45'}`}>
                                <ScrapLabel en="AUTO TURNS">自动接话轮数 · {tempAutoContinueRounds}</ScrapLabel>
                                <input
                                    type="range"
                                    min="1"
                                    max="8"
                                    step="1"
                                    value={tempAutoContinueRounds}
                                    disabled={!tempAutoContinueEnabled}
                                    onChange={e => {
                                        const v = Math.max(1, Math.min(8, parseInt(e.target.value, 10) || 2));
                                        setTempAutoContinueRounds(v);
                                        void applyGroupUpdate({
                                            replyIndividually: tempReplyIndividually,
                                            autoContinueEnabled: tempAutoContinueEnabled,
                                            autoContinueRounds: v,
                                        });
                                    }}
                                    className="w-full h-2 rounded-full appearance-none disabled:cursor-not-allowed"
                                    style={{ background: '#d9d3c7', accentColor: INK }}
                                />
                                <div className="flex justify-between text-[10px] mt-1" style={{ color: INK_SOFT }}><span>1 · 接一句</span><span>8 · 小剧场</span></div>
                                <ScrapNote className="mt-1">轮数越多越热闹，也会多消耗 API 调用；开启「角色各自回复」时，每一轮会按成员分别调用。</ScrapNote>
                            </div>
                        </div>
                    </div>

                    <div className="pt-3">
                        <ScrapDivider className="mb-3" />
                        <ScrapLabel en="BACKGROUND">这个群的聊天背景</ScrapLabel>
                        <div className="flex items-center gap-3">
                            <button
                                type="button"
                                onClick={() => groupBackgroundInputRef.current?.click()}
                                className="w-24 h-16 rounded-xl overflow-hidden border flex items-center justify-center shrink-0 active:scale-95 transition-transform"
                                style={{ borderColor: '#eed6df', ...groupBackgroundStyleFor(activeGroup?.chatBackgroundImage, osTheme.groupChatBackgroundStyle || osTheme.chatBackgroundStyle || 'paper') }}
                            >
                                {!activeGroup?.chatBackgroundImage && <ImageSquare size={20} weight="bold" style={{ color: INK_SOFT }} />}
                            </button>
                            <div className="flex-1 min-w-0 space-y-2">
                                <div className="grid grid-cols-2 gap-2">
                                    <ScrapBtn variant="paper" full={false} className="text-xs" onClick={() => groupBackgroundInputRef.current?.click()} icon={<ImageSquare size={15} weight="bold" />}>换背景</ScrapBtn>
                                    <ScrapBtn variant="paper" full={false} className="text-xs" onClick={() => void handleRemoveGroupBackground()} icon={<Eraser size={15} weight="bold" />}>用通用</ScrapBtn>
                                </div>
                                <ScrapNote>单群背景在这里设置；全群通用背景在「主题设置 → 聊天界面 → 群聊通用背景」里设置。</ScrapNote>
                            </div>
                        </div>
                        <input type="file" ref={groupBackgroundInputRef} className="hidden" accept="image/*" onChange={handleGroupBackgroundUpload} />
                    </div>

                    {/* Private Chat Group Context Cap */}
                    <div className="pt-3">
                        <ScrapDivider className="mb-3" />
                        <ScrapLabel en="SPILLOVER">私聊里捎带的群动静 · {tempPrivateContextCap}</ScrapLabel>
                        <input type="range" min="20" max="500" step="10" value={tempPrivateContextCap} onChange={e => { const v = parseInt(e.target.value); setTempPrivateContextCap(v); void applyGroupUpdate({ privateContextCap: v }); }} className="w-full h-2 rounded-full appearance-none" style={{ background: '#d9d3c7', accentColor: INK }} />
                        <div className="flex justify-between text-[10px] mt-1" style={{ color: INK_SOFT }}><span>20 · 省着用</span><span>500 · 全带上</span></div>
                        <ScrapNote className="mt-1">成员各自的私聊里，最多捎上本群最近这么多条当「近来群里的事」。每个群单独算，免得热闹的群把安静的群挤没了。</ScrapNote>
                    </div>
                </GroupSettingsPage>

                <GroupSettingsPage no="09" title="数据管理" en="Data">
                    {/* Memory & Context Management */}
                    <div className="pt-3">
                        <ScrapDivider className="mb-3" />
                        <ScrapLabel en="MEMORY">把这段日子收进记忆</ScrapLabel>

                        {/* Prompt Selection */}
                        <div className="p-3 mb-3" style={{ background: 'rgba(255,253,247,0.7)', border: `1px solid ${INK_SOFT}44`, outline: `1px dashed ${INK_SOFT}55`, outlineOffset: -4, borderRadius: 12 }}>
                            <div className="text-[9px] font-black uppercase tracking-widest mb-2" style={{ color: INK_SOFT, fontFamily: 'var(--font-label)' }}>选择总结模板</div>
                            <div className="flex flex-col gap-1.5">
                                {archivePrompts.map(p => (
                                    <div key={p.id} onClick={() => setSelectedPromptId(p.id)} className="px-3 py-2 cursor-pointer text-xs font-black transition-all" style={selectedPromptId === p.id
                                        ? { background: INK, color: '#f6f3ec', borderRadius: 9, outline: '1px dashed rgba(255,255,255,0.3)', outlineOffset: -3 }
                                        : { background: 'rgba(255,253,247,0.6)', color: '#605a4e', border: `1px solid ${INK_SOFT}44`, borderRadius: 9 }}>
                                        {p.name}
                                    </div>
                                ))}
                            </div>
                            <ScrapNote className="mt-2">总结模板跟「聊天归档」共用一套，可以在聊天设置里修改。</ScrapNote>
                        </div>

                        <button onClick={handleGroupSummary} disabled={isSummarizing} className="w-full py-3 font-black active:scale-95 transition-transform flex items-center justify-center gap-2 mb-2" style={{ background: 'rgba(255,253,247,0.96)', color: INK, border: `1px solid ${INK_SOFT}66`, outline: `1px dashed ${INK_SOFT}66`, outlineOffset: -4, borderRadius: 9999 }}>
                            {isSummarizing ? (
                                <><div className="w-4 h-4 rounded-full animate-spin" style={{ border: `2px solid ${INK_SOFT}55`, borderTopColor: INK }}></div><span className="text-xs">{summaryProgress || '正在收拢…'}</span></>
                            ) : (
                                <><BookBookmark size={16} weight="bold" /> 归档群聊 · 写入成员记忆</>
                            )}
                        </button>
                        <ScrapNote className="px-1">用选中的模板把群聊整理成摘要，再作为记忆写入每位成员的上下文。</ScrapNote>
                    </div>

                    {/* Danger Zone */}
                    <div className="pt-3">
                        <ScrapDivider className="mb-3" />
                        <ScrapLabel en="HANDLE WITH CARE">小心轻放</ScrapLabel>

                        <div className="flex items-center gap-2 mb-3 cursor-pointer" onClick={() => setPreserveContext(!preserveContext)}>
                             <div className="w-5 h-5 flex items-center justify-center transition-colors" style={{ borderRadius: 6, background: preserveContext ? INK : 'rgba(255,253,247,0.82)', border: `1px solid ${preserveContext ? INK : INK_SOFT + '66'}` }}>
                                 {preserveContext && <svg className="w-3 h-3" style={{ color: '#f6f3ec' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>}
                             </div>
                             <span className="text-xs font-bold" style={{ color: INK }}>清空时留住最后 10 条，别断了话头</span>
                        </div>

                        <div className="flex gap-2">
                            <ScrapBtn variant="paper" full={false} className="flex-1 text-xs" onClick={handleClearHistory} icon={<Eraser size={15} weight="bold" />}>抹掉记录</ScrapBtn>
                            <ScrapBtn variant="danger" full={false} className="flex-1 text-xs" onClick={() => { if(activeGroup) handleDissolveGroup(activeGroup.id); }} icon={<Trash size={15} weight="bold" />}>就地解散</ScrapBtn>
                        </div>
                    </div>
                </GroupSettingsPage>
                <div className="text-center text-[10px] pb-1 select-none" style={{ color: '#a892a3' }}>设置已自动保存</div>
                </div>
                </div>
            )}

            {groupApiModelTarget && (
                <div className="fixed inset-0 z-[320] flex items-center justify-center p-5 animate-fade-in">
                    <div className="absolute inset-0 bg-[#1c1a18]/42 backdrop-blur-[3px]" onClick={() => setGroupApiModelTarget(null)} />
                    <div
                        className="relative w-full max-w-[360px] max-h-[78vh] flex flex-col overflow-hidden animate-pop-in"
                        style={{
                            background: 'linear-gradient(180deg,#ffffff 0%,#fbfaf8 100%)',
                            border: `1px solid ${INK_SOFT}44`,
                            borderRadius: 24,
                            boxShadow: '0 30px 70px -34px rgba(38,38,38,0.58), 0 1px 2px rgba(38,38,38,0.06)',
                        }}
                    >
                        <div className="px-5 pt-6 pb-3 text-center shrink-0">
                            <div className="text-[9px] tracking-[0.28em] uppercase mb-1" style={{ color: INK_SOFT, fontFamily: 'var(--font-label)' }}>MODEL</div>
                            <div className="text-[17px] font-black" style={{ color: INK }}>选择模型</div>
                            <div className="text-[10px] mt-1 truncate" style={{ color: INK_SOFT }}>{groupApiModelTargetLabel()}</div>
                        </div>
                        {(() => {
                            const target = groupApiModelTarget;
                            const draft = groupApiDraftForTarget(target);
                            const { filtered, total } = groupApiModelPickerView;
                            return (
                                <div className="px-5 pb-5 overflow-y-auto no-scrollbar space-y-3">
                                    <div className="grid grid-cols-[1fr_auto] gap-2">
                                        <ScrapInput
                                            value={draft.model}
                                            onChange={e => patchGroupApiModelForTarget(target, e.target.value)}
                                            placeholder="可手动输入模型名"
                                            className="font-mono text-[11px] min-w-0"
                                            spellCheck={false}
                                        />
                                        <ScrapBtn
                                            variant="ink"
                                            full={false}
                                            className="text-[11px] px-4 py-2"
                                            onClick={() => setGroupApiModelTarget(null)}
                                        >
                                            确定
                                        </ScrapBtn>
                                    </div>
                                    <div className="grid grid-cols-[1fr_auto] gap-2">
                                        <ScrapInput
                                            value={groupApiModelFilter}
                                            onChange={e => setGroupApiModelFilter(e.target.value)}
                                            placeholder={total ? `在 ${total} 个模型中搜索` : '还没有已拉取的模型'}
                                            className="text-[11px] min-w-0"
                                        />
                                        <ScrapBtn
                                            variant="paper"
                                            full={false}
                                            className="text-[11px] px-3 py-2"
                                            disabled={groupApiModelLoadingKey !== null}
                                            onClick={() => void fetchGroupApiModels(target)}
                                        >
                                            {groupApiModelLoadingKey === groupApiModelTargetKey(target) ? '拉取中…' : '拉取模型'}
                                        </ScrapBtn>
                                    </div>
                                    <div className="max-h-[38vh] overflow-y-auto no-scrollbar space-y-2 pr-1">
                                        {filtered.length > 0 ? filtered.map(model => {
                                            const selected = model === draft.model;
                                            return (
                                                <button
                                                    key={model}
                                                    type="button"
                                                    title={model}
                                                    onClick={() => selectGroupApiModel(model)}
                                                    className="w-full text-left px-4 py-3 rounded-[14px] text-[12px] font-mono flex items-start justify-between gap-2 transition-transform active:scale-[0.98]"
                                                    style={selected
                                                        ? { color: '#fff', background: INK, border: `1px solid ${INK_SOFT}55`, boxShadow: '0 8px 18px -14px rgba(122,90,114,0.45)' }
                                                        : { color: INK, background: '#fffdfa', border: `1px solid ${INK_SOFT}33` }}
                                                >
                                                    <span className="break-all min-w-0 leading-relaxed">{model}</span>
                                                    {selected && <span className="shrink-0 text-[10px] mt-0.5">✓</span>}
                                                </button>
                                            );
                                        }) : (
                                            <div className="text-center py-8 text-[11px] leading-relaxed" style={{ color: INK_SOFT }}>
                                                {total === 0
                                                    ? '当前没有已拉取的模型；可以先点“拉取模型”，或直接在上方手动输入。'
                                                    : `没有找到“${groupApiModelFilter}”`}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })()}
                    </div>
                </div>
            )}

            {/* Message Options Modal */}
            <Modal isOpen={modalType === 'message-options'} title="这条怎么处理" en="MESSAGE" onClose={() => { setModalType('none'); setSelectedMessage(null); }}>
                <div className="space-y-2.5">
                    {/* 表情回应快捷条（QQ/微信 tap-to-react） */}
                    <div className="flex items-center justify-between gap-1 px-1 pb-1">
                        {REACTION_EMOJIS.map(emoji => {
                            const reacted = Array.isArray(selectedMessage?.metadata?.reactions)
                                && selectedMessage!.metadata.reactions.some((r: any) => r.emoji === emoji && r.by?.includes('user'));
                            return (
                                <button key={emoji} onClick={() => handleReactMessage(emoji)}
                                    className="w-9 h-9 rounded-full text-[18px] leading-none flex items-center justify-center active:scale-90 transition-transform"
                                    style={reacted ? { background: INK, outline: '1px dashed rgba(255,255,255,0.35)', outlineOffset: -3 } : { background: 'rgba(255,253,247,0.7)', border: `1px solid ${INK_SOFT}44` }}>
                                    {emoji}
                                </button>
                            );
                        })}
                    </div>
                    <ScrapRowBtn onClick={handleEnterSelectionMode} icon={<ListNumbers size={18} weight="bold" />}>挑几条一起收拾</ScrapRowBtn>
                    {selectedMessage?.type === 'text' && (
                        <ScrapRowBtn onClick={handleCopyMessage} icon={<Copy size={18} weight="bold" />}>抄下这段字</ScrapRowBtn>
                    )}
                    {selectedMessage?.type === 'text' && (
                        <ScrapRowBtn onClick={handleStartEditMessage} icon={<PencilSimpleLine size={18} weight="bold" />}>改改措辞</ScrapRowBtn>
                    )}
                    {selectedMessage?.role !== 'system' && (
                        <ScrapRowBtn onClick={handleAddGroupMessageToDashboard} icon={<NotePencil size={18} weight="bold" />}>记到总览</ScrapRowBtn>
                    )}
                    <ScrapRowBtn onClick={() => setModalType('forward-pick')} icon={<ShareNetwork size={18} weight="bold" />}>转给别人看</ScrapRowBtn>
                    {selectedMessage?.role === 'user' && !selectedMessage?.metadata?.recalled && (
                        <ScrapRowBtn onClick={handleRecallMessage} icon={<ClockCounterClockwise size={18} weight="bold" />}>当作没说过</ScrapRowBtn>
                    )}
                    <ScrapRowBtn onClick={handleDeleteSingleMessage} danger icon={<Trash size={18} weight="bold" />}>删除这条</ScrapRowBtn>
                </div>
            </Modal>

            {/* 转发选人：把选中的群消息转给某个角色的私聊 */}
            <Modal isOpen={modalType === 'forward-pick'} title="捎给谁" en="FORWARD" icon={<ScrapStamp><ShareNetwork size={16} weight="bold" /></ScrapStamp>} onClose={() => { setModalType('none'); setSelectedMessage(null); }}>
                <div className="space-y-2 max-h-[60vh] overflow-y-auto no-scrollbar">
                    {visibleCharacters.length === 0 && <ScrapNote center className="py-8">名册里还没人能捎。</ScrapNote>}
                    {visibleCharacters.map(c => (
                        <ScrapRowBtn key={c.id} avatar={c.avatar} onClick={() => handleForwardGroupMessage(c.id)} trailing={<span style={{ color: INK_SOFT }}>›</span>}>
                            {c.name}
                        </ScrapRowBtn>
                    ))}
                </div>
            </Modal>

            {/* Edit Message Modal */}
            <Modal
                isOpen={modalType === 'edit-message'} title="改改这句" en="EDIT" onClose={() => { setModalType('none'); setSelectedMessage(null); }}
                footer={<><ScrapBtn variant="paper" onClick={() => { setModalType('none'); setSelectedMessage(null); }}>算了</ScrapBtn><ScrapBtn onClick={confirmEditMessage}>就这么改</ScrapBtn></>}
            >
                <ScrapTextarea
                    value={editContent}
                    onChange={e => setEditContent(e.target.value)}
                    className="h-32"
                />
            </Modal>

            {/* 发红包：钱包实扣（普通 / 口令 / 拼手气） */}
            <Modal isOpen={modalType === 'transfer'} title="发送红包" en="SEND RED PACKET" icon={<ScrapStamp><Coins size={15} weight="bold" /></ScrapStamp>} onClose={resetTransferModal} footer={<ScrapBtn onClick={sendGroupTransfer} icon={<Coins size={16} weight="bold" />}>{transferRpType === 'lucky' ? '发送拼手气红包' : transferRpType === 'password' ? '发送口令红包' : '发送红包'}</ScrapBtn>}>
                {(() => {
                    const memberCount = activeGroup ? characters.filter(c => activeGroup.members.includes(c.id)).length : 0;
                    return (
                        <div className="space-y-4">
                            <div className="flex justify-center py-1">
                                <div className="w-16 h-16 rounded-[18px] flex items-center justify-center text-2xl font-black" style={{ background: '#fff4f7', color: '#5a3140', border: '1px solid #eed6df', boxShadow: '0 12px 28px -24px rgba(122,90,114,0.42)' }}>包</div>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                                {([['normal', '普通红包', '整包发送'], ['password', '口令红包', '输口令打开'], ['lucky', '拼手气红包', '随机分配']] as const).map(([t, label, hint]) => {
                                    const on = transferRpType === t;
                                    return (
                                        <button key={t} onClick={() => setTransferRpType(t)}
                                            className="py-2.5 text-center transition-transform active:scale-95"
                                            style={on
                                                ? { background: '#fff4f7', color: '#5a3140', borderRadius: 13, border: '1px solid #d8a5b7' }
                                                : { background: 'rgba(255,253,247,0.82)', color: '#a892a3', border: '1px solid #eed6df', borderRadius: 13 }}>
                                            <div className="text-[13px] font-black">{label}</div>
                                            <div className="text-[10px] mt-0.5" style={{ opacity: 0.78 }}>{hint}</div>
                                        </button>
                                    );
                                })}
                            </div>
                            <ScrapInput type="number" big value={transferAmount} onChange={e => setTransferAmount(e.target.value)} placeholder={transferRpType === 'lucky' ? '一共多少' : '金额'} autoFocus />
                            {transferRpType === 'lucky' && (
                                <ScrapInput type="number" center min={1} max={memberCount || undefined} value={transferShares} onChange={e => setTransferShares(e.target.value)} placeholder={memberCount ? `拆几个（默认 ${memberCount}，最多 ${memberCount}）` : '拆几个'} />
                            )}
                            {transferRpType === 'password' && (
                                <ScrapInput value={transferPassword} onChange={e => setTransferPassword(e.target.value)} placeholder="红包口令（会显示在红包上）" />
                            )}
                            <ScrapInput value={transferNote} onChange={e => setTransferNote(e.target.value)} placeholder="附句话（选填）" />
                            <div className="text-center text-[12px] font-bold flex items-center justify-center gap-1" style={{ color: INK_SOFT }}><Wallet size={13} weight="fill" />钱包里还有 ¥{wallet}</div>
                        </div>
                    );
                })()}
            </Modal>

            {/* 群收款（AA）：选成员 + 总额 → 均摊发起 */}
            <Modal isOpen={modalType === 'collect'} title="发起 AA" en="SPLIT THE BILL" icon={<ScrapStamp><Wallet size={15} weight="bold" /></ScrapStamp>} onClose={resetCollectModal} footer={<ScrapBtn onClick={sendGroupCollect} icon={<Wallet size={16} weight="bold" />}>开收</ScrapBtn>}>
                {(() => {
                    const ids = Array.from(collectMembers).filter(id => activeGroup?.members.includes(id));
                    const total = Math.round(parseFloat(collectAmount) * 100) / 100;
                    const per = ids.length > 0 && total > 0 ? Math.round((total / ids.length) * 100) / 100 : 0;
                    return (
                        <div className="space-y-4">
                            <div className="text-center py-1" style={{ color: INK }}><Wallet size={40} weight="fill" className="mx-auto" /></div>
                            <ScrapInput type="number" big value={collectAmount} onChange={e => setCollectAmount(e.target.value)} placeholder="一共多少" autoFocus />
                            <ScrapInput value={collectNote} onChange={e => setCollectNote(e.target.value)} placeholder="为啥收（比如：上回聚餐 AA）" />
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: INK_SOFT }}>找谁收 · {ids.length} 人</span>
                                    {ids.length > 0 && total > 0 && <span className="text-[11px] font-black px-2 py-0.5 rounded-full" style={{ background: INK, color: '#f6f3ec' }}>每人 ¥{per}</span>}
                                </div>
                                <div className="grid grid-cols-4 gap-2 max-h-44 overflow-y-auto no-scrollbar pr-1">
                                    {(activeGroup?.members || []).map(mid => {
                                        const c = characters.find(ch => ch.id === mid);
                                        if (!c) return null;
                                        const on = collectMembers.has(mid);
                                        return (
                                            <ScrapPickTile key={mid} src={c.avatar} label={displayNameOf(activeGroup, mid)} selected={on} dim={!on} onClick={() => setCollectMembers(prev => { const n = new Set(prev); if (n.has(mid)) n.delete(mid); else n.add(mid); return n; })} />
                                        );
                                    })}
                                </div>
                            </div>
                            <ScrapNote center>平摊 · 谁「给了」就逐笔进你钱包（现在 ¥{wallet}）</ScrapNote>
                        </div>
                    );
                })()}
            </Modal>

            {/* 群收款详情：逐笔点收 / 一键收齐 */}
            <Modal isOpen={!!collectDetailMsg} title="这笔 AA" en="SPLIT" onClose={() => setCollectDetailMsg(null)}>
                {collectDetailMsg && (() => {
                    const meta: any = collectDetailMsg.metadata || {};
                    const shares: any[] = Array.isArray(meta.shares) ? meta.shares : [];
                    const paidCount = shares.filter(s => s.paid).length;
                    const paidSum = Math.round(shares.filter(s => s.paid).reduce((a, s) => a + (s.amount || 0), 0) * 100) / 100;
                    const done = shares.length > 0 && paidCount === shares.length;
                    return (
                        <div className="space-y-3">
                            <div className="text-center">
                                <div className="text-2xl font-black" style={{ color: INK }}>¥{meta.total}</div>
                                <div className="text-[12px] mt-0.5" style={{ color: INK_SOFT }}>{meta.note || 'AA 收款'} · {done ? '都给齐了' : `已收 ¥${paidSum} · ${paidCount}/${shares.length} 人`}</div>
                            </div>
                            <div className="space-y-1.5 max-h-[40vh] overflow-y-auto no-scrollbar pr-1">
                                {shares.map((s: any) => {
                                    const c = characters.find(ch => ch.id === s.id);
                                    return (
                                        <div key={s.id} className="flex items-center gap-3 px-3 py-2" style={{ background: 'rgba(255,253,247,0.78)', border: `1px solid ${INK_SOFT}44`, borderRadius: 11 }}>
                                            {c?.avatar ? <img src={c.avatar} className="w-8 h-8 rounded-full object-cover" /> : <div className="w-8 h-8 rounded-full" style={{ background: '#e6e2d8' }} />}
                                            <span className="text-sm font-bold truncate flex-1" style={{ color: INK }}>{displayNameOf(activeGroup, s.id)}</span>
                                            <span className="text-[13px] font-black" style={{ color: INK_SOFT }}>¥{s.amount}</span>
                                            {s.paid ? (
                                                <span className="text-[11px] font-black flex items-center gap-0.5 shrink-0" style={{ color: INK }}><svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-7 7a1 1 0 01-1.4 0l-3-3a1 1 0 111.4-1.4L9 11.6l6.3-6.3a1 1 0 011.4 0z" clipRule="evenodd" /></svg>到账</span>
                                            ) : (
                                                <button onClick={() => payCollectShare(collectDetailMsg, s.id)} className="text-[12px] font-black px-3 py-1 rounded-full shrink-0 active:scale-95 transition-transform" style={{ background: INK, color: '#f6f3ec' }}>收下</button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                            {!done && (
                                <ScrapBtn onClick={() => collectAllRemaining(collectDetailMsg)} className="text-sm">把剩下的一次收齐</ScrapBtn>
                            )}
                            <ScrapNote center>点「收下」就把那一份记进钱包。</ScrapNote>
                        </div>
                    );
                })()}
            </Modal>

            {/* 群投票：问题 + 2~6 选项（单选） */}
            <Modal isOpen={modalType === 'poll'} title="拉个投票" en="POLL · 举手表决" icon={<ScrapStamp><ChartBar size={15} weight="bold" /></ScrapStamp>} onClose={resetPollModal} footer={<ScrapBtn onClick={sendGroupPoll} icon={<ChartBar size={16} weight="bold" />}>开投</ScrapBtn>}>
                <div className="space-y-3">
                    <ScrapInput value={pollQuestion} onChange={e => setPollQuestion(e.target.value)} placeholder="想问大家啥，比如「周末去哪玩」" autoFocus />
                    <div className="space-y-2">
                        {pollOptions.map((opt, i) => (
                            <div key={i} className="flex items-center gap-2">
                                <ScrapInput value={opt} onChange={e => setPollOptions(prev => prev.map((o, j) => j === i ? e.target.value : o))} placeholder={`第 ${i + 1} 个选项`} />
                                {pollOptions.length > 2 && (
                                    <button onClick={() => setPollOptions(prev => prev.filter((_, j) => j !== i))} className="shrink-0 active:scale-90 transition-transform" style={{ color: INK_SOFT }}><XCircle size={20} weight="fill" /></button>
                                )}
                            </div>
                        ))}
                    </div>
                    {pollOptions.length < 6 && (
                        <ScrapBtn variant="ghost" onClick={() => setPollOptions(prev => [...prev, ''])} className="text-[13px] py-2">＋ 再添一个</ScrapBtn>
                    )}
                    <ScrapNote center>单选 · 开投后大家会照各自的性子投。</ScrapNote>
                </div>
            </Modal>

            {/* 群投票详情：看每个选项是谁投的 + 理由 */}
            <Modal isOpen={!!pollDetailMsg} title="票数明细" en="POLL" onClose={() => setPollDetailMsg(null)}>
                {pollDetailMsg && (() => {
                    const pmeta: any = pollDetailMsg.metadata || {};
                    const options: any[] = Array.isArray(pmeta.options) ? pmeta.options : [];
                    const reasons: Record<string, string> = pmeta.reasons || {};
                    const totalVotes = options.reduce((a, o) => a + (o.voters?.length || 0), 0);
                    return (
                        <div className="space-y-3">
                            <div className="text-center">
                                <div className="text-[15px] font-black" style={{ color: INK }}>{pmeta.question}</div>
                                <div className="text-[11px] mt-0.5" style={{ color: INK_SOFT }}>共 {totalVotes} 票</div>
                            </div>
                            <div className="space-y-2.5 max-h-[45vh] overflow-y-auto no-scrollbar pr-1">
                                {options.map((o, i) => {
                                    const voters: string[] = o.voters || [];
                                    const pct = totalVotes > 0 ? Math.round((voters.length / totalVotes) * 100) : 0;
                                    return (
                                        <div key={i} className="overflow-hidden" style={{ border: `1px solid ${INK_SOFT}44`, borderRadius: 11 }}>
                                            <div className="relative px-3 py-2" style={{ background: 'rgba(255,253,247,0.7)' }}>
                                                <div className="absolute inset-y-0 left-0" style={{ width: `${pct}%`, background: 'rgba(31,29,26,0.12)', backgroundImage: 'repeating-linear-gradient(45deg, rgba(31,29,26,0.06) 0 6px, transparent 6px 12px)' }} />
                                                <div className="relative flex items-center justify-between">
                                                    <span className="text-[13px] font-black truncate" style={{ color: INK }}>{o.text}</span>
                                                    <span className="text-[11px] font-black shrink-0" style={{ color: INK_SOFT }}>{voters.length} 票</span>
                                                </div>
                                            </div>
                                            {voters.length > 0 && (
                                                <div className="px-3 py-2 space-y-1.5">
                                                    {voters.map(vid => {
                                                        const isU = vid === 'user';
                                                        const c = characters.find(ch => ch.id === vid);
                                                        const av = isU ? userProfile.avatar : c?.avatar;
                                                        const reason = reasons[vid];
                                                        return (
                                                            <div key={vid} className="flex items-start gap-2">
                                                                {av ? <img src={av} className="w-6 h-6 rounded-full object-cover shrink-0" /> : <div className="w-6 h-6 rounded-full shrink-0" style={{ background: '#e6e2d8' }} />}
                                                                <div className="min-w-0">
                                                                    <span className="text-[12px] font-bold" style={{ color: INK }}>{isU ? (activeGroup?.memberNicknames?.['user'] || userProfile.name) : displayNameOf(activeGroup, vid)}</span>
                                                                    {reason && <span className="text-[11px] ml-1" style={{ color: INK_SOFT }}>· {reason}</span>}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                            <ScrapNote center>输入框空着按回车 = 让大家继续聊（角色会照性子投）。</ScrapNote>
                        </div>
                    );
                })()}
            </Modal>

            {/* 群接龙：主题 + 我的第一条（可选） */}
            <Modal isOpen={modalType === 'relay'} title="起个接龙" en="RELAY · 一个接一个" icon={<ScrapStamp><ListNumbers size={15} weight="bold" /></ScrapStamp>} onClose={resetRelayModal} footer={<ScrapBtn onClick={sendGroupRelay} icon={<ListNumbers size={16} weight="bold" />}>开个头</ScrapBtn>}>
                <div className="space-y-3">
                    <ScrapInput value={relayTitle} onChange={e => setRelayTitle(e.target.value)} placeholder="接龙主题，比如「周末爬山报名」" autoFocus />
                    <ScrapInput value={relayFirst} onChange={e => setRelayFirst(e.target.value)} placeholder="先垫一条（选填，比如「1. 我，带相机」）" />
                    <ScrapNote center>起好后，大家会照各自的性子一条条接上。</ScrapNote>
                </div>
            </Modal>

            {/* 接龙详情：看全部 + 加入 */}
            <Modal
                isOpen={!!relayDetailMsg} title="接龙现场" en="RELAY" onClose={() => { setRelayDetailMsg(null); setRelayInput(''); }}
                footer={
                    <div className="flex gap-2 w-full items-stretch">
                        <ScrapInput value={relayInput} onChange={e => setRelayInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && relayDetailMsg) { e.preventDefault(); joinRelayAsUser(relayDetailMsg); } }} placeholder="接上你这一条…" className="flex-1" />
                        <ScrapBtn full={false} className="shrink-0 px-5" onClick={() => relayDetailMsg && joinRelayAsUser(relayDetailMsg)}>接</ScrapBtn>
                    </div>
                }
            >
                {relayDetailMsg && (() => {
                    const rmeta: any = relayDetailMsg.metadata || {};
                    const entries: any[] = Array.isArray(rmeta.entries) ? rmeta.entries : [];
                    return (
                        <div className="space-y-3">
                            <div className="text-center text-[15px] font-black" style={{ color: INK }}>{rmeta.title}</div>
                            <div className="space-y-2 max-h-[45vh] overflow-y-auto no-scrollbar pr-1">
                                {entries.length === 0 && <ScrapNote center className="py-6">还没人接，来当第一个～</ScrapNote>}
                                {entries.map((e: any, i: number) => {
                                    const isU = e.by === 'user';
                                    const c = characters.find(ch => ch.id === e.by);
                                    const av = isU ? userProfile.avatar : c?.avatar;
                                    return (
                                        <div key={i} className="flex items-start gap-2.5">
                                            <span className="text-[12px] font-black w-5 text-right shrink-0 pt-1.5" style={{ color: INK }}>{i + 1}.</span>
                                            {av ? <img src={av} className="w-7 h-7 rounded-full object-cover shrink-0 mt-0.5" /> : <div className="w-7 h-7 rounded-full shrink-0 mt-0.5" style={{ background: '#e6e2d8' }} />}
                                            <div className="min-w-0 flex-1 px-3 py-1.5" style={{ background: 'rgba(255,253,247,0.78)', border: `1px solid ${INK_SOFT}44`, borderRadius: 11 }}>
                                                <div className="text-[11px] font-black" style={{ color: INK_SOFT }}>{e.name}</div>
                                                <div className="text-[13px] break-all leading-snug" style={{ color: INK }}>{e.text}</div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })()}
            </Modal>

            {/* 群签到详情：今日打卡名单（谁 + 心情 + 时间） */}
            <Modal isOpen={!!checkinDetailMsg} title="今日打卡" en="CHECK-IN" icon={<ScrapStamp><CalendarCheck size={15} weight="bold" /></ScrapStamp>} onClose={() => setCheckinDetailMsg(null)}>
                {checkinDetailMsg && (() => {
                    const cmeta: any = checkinDetailMsg.metadata || {};
                    const entries: any[] = Array.isArray(cmeta.entries) ? cmeta.entries : [];
                    return (
                        <div className="space-y-3">
                            <div className="text-center">
                                <div className="text-[15px] font-black" style={{ color: INK }}>报到 · {cmeta.date}</div>
                                <div className="text-[11px] mt-0.5" style={{ color: INK_SOFT }}>已经 {entries.length} 人冒泡</div>
                            </div>
                            <div className="space-y-2 max-h-[45vh] overflow-y-auto no-scrollbar pr-1">
                                {entries.length === 0 && <ScrapNote center className="py-6">还没人报到。</ScrapNote>}
                                {entries.map((e: any, i: number) => {
                                    const isU = e.by === 'user';
                                    const c = characters.find(ch => ch.id === e.by);
                                    const av = isU ? userProfile.avatar : c?.avatar;
                                    return (
                                        <div key={i} className="flex items-center gap-2.5">
                                            <span className="text-[12px] font-black w-5 text-right shrink-0" style={{ color: INK }}>{i + 1}</span>
                                            {av ? <img src={av} className="w-8 h-8 rounded-full object-cover shrink-0" /> : <div className="w-8 h-8 rounded-full shrink-0" style={{ background: '#e6e2d8' }} />}
                                            <div className="min-w-0 flex-1">
                                                <span className="text-[13px] font-bold" style={{ color: INK }}>{e.name}</span>
                                                {e.mood && <span className="text-[12px] ml-1.5" style={{ color: INK_SOFT }}>{e.mood}</span>}
                                            </div>
                                            <span className="text-[10px] shrink-0" style={{ color: INK_SOFT }}>{new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })()}
            </Modal>

            {/* 落脚点 / 位置分享 */}
            <Modal isOpen={actionModal === 'location'} title="发个落脚点" en="LOCATION" icon={<ScrapStamp><MapPin size={15} weight="bold" /></ScrapStamp>} onClose={() => setActionModal('none')} footer={<ScrapBtn onClick={sendGroupLocation} icon={<MapPin size={16} weight="bold" />}>把位置寄出去</ScrapBtn>}>
                <div className="space-y-3">
                    <ScrapInput value={locName} onChange={e => setLocName(e.target.value)} placeholder="地方叫啥，比如「街角咖啡馆」" autoFocus />
                    <ScrapInput value={locDetail} onChange={e => setLocDetail(e.target.value)} placeholder="具体在哪儿（选填）" />
                </div>
            </Modal>

            {/* 画一张 / AI 生图 */}
            <Modal isOpen={actionModal === 'image-gen'} title="随手画一张" en="DRAW" icon={<ScrapStamp><PaintBrush size={15} weight="bold" /></ScrapStamp>} onClose={() => { setActionModal('none'); setImgPreview(null); }} footer={imgPreview ? <ScrapBtn onClick={sendGroupImage} icon={<ImageSquare size={16} weight="bold" />}>贴进群里</ScrapBtn> : <ScrapBtn onClick={() => void genGroupImage()} disabled={imgBusy} icon={!imgBusy ? <PaintBrush size={16} weight="bold" /> : undefined}>{imgBusy ? '正在落笔…' : '开画'}</ScrapBtn>}>
                <div className="space-y-3">
                    <ScrapTextarea value={imgPrompt} onChange={e => setImgPrompt(e.target.value)} placeholder="想画个什么画面…" rows={3} autoFocus />
                    <ScrapInput value={imgModel} onChange={e => setImgModel(e.target.value)} placeholder="用哪个生图模型（选填）" className="text-xs" />
                    {imgPreview && <img src={imgPreview} className="w-full" style={{ borderRadius: 12, border: `1px solid ${INK_SOFT}66` }} alt="preview" />}
                </div>
            </Modal>

            {/* 幕后指令 / OOC */}
            <Modal isOpen={actionModal === 'system-cmd'} title="发送后台指令" en="OFF-STAGE" icon={<ScrapStamp><Detective size={15} weight="bold" /></ScrapStamp>} onClose={() => setActionModal('none')} footer={<ScrapBtn onClick={sendGroupSystemCmd} icon={<Detective size={16} weight="bold" />}>发送指令</ScrapBtn>}>
                <div className="space-y-2.5">
                    <ScrapNote>你当「导演/旁白」，给全群发送一条后台提示（作为系统提示出现，大家照着演）。</ScrapNote>
                    <ScrapTextarea value={sysCmd} onChange={e => setSysCmd(e.target.value)} placeholder="比如：忽然停电了，大家摸黑找蜡烛…" rows={3} autoFocus />
                </div>
            </Modal>

            <Modal isOpen={!!redPacketOpenMsg} title="口令红包" en="PASSWORD" icon={<ScrapStamp><Coins size={15} weight="bold" /></ScrapStamp>} onClose={() => { setRedPacketOpenMsg(null); setRedPacketPasswordInput(''); }} footer={<ScrapBtn onClick={() => void openPasswordRedPacket()} icon={<Coins size={16} weight="bold" />}>打开红包</ScrapBtn>}>
                {redPacketOpenMsg && (
                    <div className="space-y-4">
                        <div className="rounded-[18px] px-4 py-5 text-center" style={{ background: 'linear-gradient(180deg,#fffdfa,#fff4f7)', border: '1px solid #eed6df' }}>
                            <div className="text-[11px] font-bold tracking-[0.24em] uppercase" style={{ color: '#a892a3' }}>Password Red Packet</div>
                            <div className="mt-2 text-2xl font-black" style={{ color: '#5a3140' }}>¥{(redPacketOpenMsg.metadata as any)?.amount}</div>
                            <div className="mt-2 text-[12px]" style={{ color: '#8a6478' }}>口令：{(redPacketOpenMsg.metadata as any)?.password || '红包上的那句话'}</div>
                        </div>
                        <ScrapInput value={redPacketPasswordInput} onChange={e => setRedPacketPasswordInput(e.target.value)} placeholder="输入红包口令" autoFocus />
                        <ScrapNote center>必须完整输入红包上的口令才能打开。</ScrapNote>
                    </div>
                )}
            </Modal>

            {/* 成员选择器：成员专属功能先选「对谁」 */}
            <Modal isOpen={!!memberPicker} title={memberPicker?.title || '对谁'} en="PICK SOMEONE" onClose={() => setMemberPicker(null)}>
                {memberPicker && (
                    <div className="space-y-2">
                        {memberPicker.hint && <ScrapNote className="mb-1">{memberPicker.hint}</ScrapNote>}
                        {(activeGroup ? characters.filter(c => activeGroup.members.includes(c.id)) : []).map(c => (
                            <ScrapRowBtn key={c.id} avatar={c.avatar} onClick={() => routeToMemberAction(c.id, memberPicker.action)} trailing={<span style={{ color: INK_SOFT }}>›</span>}>
                                {displayNameOf(activeGroup!, c.id)}
                            </ScrapRowBtn>
                        ))}
                        {activeGroup && characters.filter(c => activeGroup.members.includes(c.id)).length === 0 && <ScrapNote center className="py-8">这个群里还没人。</ScrapNote>}
                    </div>
                )}
            </Modal>

            {/* 成员资料 Modal —— 点头像进入；管理员/群主多出禁言、头衔、移除 */}
            {(() => {
                const member = profileMemberId ? characters.find(c => c.id === profileMemberId) : null;
                if (!member) return (
                    <Modal isOpen={modalType === 'member-profile'} title="成员资料" en="MEMBER" onClose={() => { setModalType('none'); setProfileMemberId(null); }}>
                        <ScrapNote center className="py-6">这个人好像已经不在了。</ScrapNote>
                    </Modal>
                );
                const nickname = activeGroup?.memberNicknames?.[member.id];
                const title = activeGroup?.memberTitles?.[member.id];
                const muted = isMuted(activeGroup, member.id);
                const mutedUntilTs = activeGroup?.mutedUntil?.[member.id];
                const canManage = userCanManage(activeGroup) && !activeGroup?.dissolved;
                return (
                    <Modal isOpen={modalType === 'member-profile'} title={nickname || member.name} en="MEMBER · 这个人" onClose={() => { setModalType('none'); setProfileMemberId(null); }}>
                        <div className="space-y-4">
                            <div className="flex flex-col items-center gap-2 py-1">
                                <div className="p-1.5 pb-2" style={{ background: '#fffdf8', border: `1px solid ${INK_SOFT}66`, borderRadius: 8, boxShadow: '0 9px 18px -12px rgba(31,29,26,0.5)', transform: 'rotate(-2deg)' }}>
                                    <img src={member.avatar} className="w-20 h-20 object-cover" style={{ borderRadius: 4, filter: muted ? 'grayscale(1)' : 'contrast(1.03)' }} />
                                </div>
                                <div className="flex items-center gap-1.5 mt-1">
                                    {title && <span className="px-1.5 py-0.5 text-[9px] font-black flex items-center gap-0.5" style={{ background: INK, color: '#f6f3ec', borderRadius: 4 }}><Crown size={9} weight="fill" />{title}</span>}
                                    <span className="font-black text-base" style={{ color: INK }}>{nickname || member.name}</span>
                                </div>
                                {nickname && <span className="text-[10px]" style={{ color: INK_SOFT }}>本名：{member.name}</span>}
                                {muted && mutedUntilTs && (
                                    <span className="text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1 font-bold" style={{ background: INK, color: '#f6f3ec', backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.16) 0 5px, transparent 5px 10px)' }}>
                                        <SpeakerSlash size={10} weight="fill" />
                                        闭麦到 {new Date(mutedUntilTs).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                )}
                            </div>

                            <div className="grid grid-cols-3 gap-2">
                                <button onClick={() => { setModalType('none'); setProfileMemberId(null); openPrivateChat(member.id); }} className="py-3 font-black active:scale-95 transition-transform text-xs flex flex-col items-center gap-1.5" style={{ background: INK, color: '#f6f3ec', borderRadius: 13, outline: '1px dashed rgba(255,255,255,0.3)', outlineOffset: -4 }}>
                                    <ChatsTeardrop size={20} weight="bold" />
                                    单独聊聊
                                </button>
                                <button onClick={() => handlePokeMember(member.id)} disabled={!!activeGroup?.dissolved} className="py-3 font-black active:scale-95 transition-transform text-xs flex flex-col items-center gap-1.5 disabled:opacity-40" style={{ background: 'rgba(255,253,247,0.9)', color: INK, border: `1px solid ${INK_SOFT}66`, outline: `1px dashed ${INK_SOFT}66`, outlineOffset: -4, borderRadius: 13 }}>
                                    <HandPointing size={20} weight="bold" />
                                    戳一戳
                                </button>
                                <button onClick={() => { setModalType('none'); setProfileMemberId(null); openCharacterSettings(member.id); }} className="py-3 font-black active:scale-95 transition-transform text-xs flex flex-col items-center gap-1.5" style={{ background: 'rgba(255,253,247,0.9)', color: INK, border: `1px solid ${INK_SOFT}66`, outline: `1px dashed ${INK_SOFT}66`, outlineOffset: -4, borderRadius: 13 }}>
                                    <GearSix size={20} weight="bold" />
                                    角色档案
                                </button>
                            </div>

                            {canManage && (
                                <div className="pt-3 space-y-2">
                                    <ScrapDivider className="mb-3" />
                                    <ScrapLabel en={isUserOwner(activeGroup) ? 'OWNER' : 'ADMIN'}>{isUserOwner(activeGroup) ? '群主能动的' : '管理员能动的'}</ScrapLabel>
                                    <ScrapBtn variant="paper" onClick={() => { setTempMemberNickname(nickname || ''); setModalType('set-member-nickname'); }} icon={<IdentificationCard size={15} weight="bold" />} className="text-xs">替 TA 改群名片</ScrapBtn>
                                    <div className="grid grid-cols-2 gap-2">
                                        <ScrapBtn variant="paper" full={false} onClick={() => { setTempTitle(title || ''); setModalType('set-title'); }} icon={<Crown size={15} weight="bold" />} className="text-xs">封个头衔</ScrapBtn>
                                        <ScrapBtn variant="paper" full={false} onClick={() => setModalType('mute-member')} icon={<SpeakerSlash size={15} weight="bold" />} className="text-xs">{muted ? '改闭麦' : '让 TA 闭麦'}</ScrapBtn>
                                    </div>
                                    {/* 群主专属：任命/取消管理员 · 转让群主（不能对群主本人操作） */}
                                    {isUserOwner(activeGroup) && member.id !== (activeGroup?.ownerId || 'user') && (
                                        <>
                                            <ScrapBtn variant="paper" onClick={() => handleToggleAdmin(member.id)} icon={<Crown size={15} weight="bold" />} className="text-xs">{(activeGroup?.adminIds || []).includes(member.id) ? '收回管理员' : '请 TA 当管理员'}</ScrapBtn>
                                            <ScrapBtn
                                                variant={confirmTransferId === member.id ? 'danger' : 'paper'}
                                                onClick={() => { if (confirmTransferId === member.id) handleTransferOwner(member.id); else setConfirmTransferId(member.id); }}
                                                className="text-xs"
                                            >
                                                {confirmTransferId === member.id ? '再按一次，群主就归 TA 了' : '把群主让给 TA'}
                                            </ScrapBtn>
                                        </>
                                    )}
                                    <ScrapBtn
                                        variant={confirmRemoveId === member.id ? 'danger' : 'paper'}
                                        onClick={() => {
                                            if (confirmRemoveId === member.id) { handleRemoveMember(member.id); setConfirmRemoveId(null); }
                                            else setConfirmRemoveId(member.id);
                                        }}
                                        icon={<Wind size={15} weight="bold" />}
                                        className="text-xs"
                                    >
                                        {confirmRemoveId === member.id ? '再按一次，请 TA 离开' : '请出这个群'}
                                    </ScrapBtn>
                                </div>
                            )}
                        </div>
                    </Modal>
                );
            })()}

            {/* 改群名片 Modal（群主/管理员代成员改） */}
            <Modal
                isOpen={modalType === 'set-member-nickname'} title="替 TA 改群名片" en="NICKNAME" onClose={() => setModalType('member-profile')}
                footer={<>
                    <ScrapBtn variant="paper" onClick={() => { setTempMemberNickname(''); }}>留白</ScrapBtn>
                    <ScrapBtn onClick={handleSetMemberNickname}>记下</ScrapBtn>
                </>}
            >
                <div className="space-y-3">
                    <ScrapNote>群名片只换 TA 在这个群里挂的名字，本名不动。留白记下就还原成本名。群里每个人都会看到这条改动。</ScrapNote>
                    <ScrapInput value={tempMemberNickname} onChange={e => setTempMemberNickname(e.target.value)} maxLength={24} placeholder="给 TA 在群里取个名…" autoFocus />
                </div>
            </Modal>

            {/* 群公告 Modal：群主/管理员可编辑发布或撤下；普通成员只读查看 */}
            <Modal
                isOpen={modalType === 'group-announcement'} title="钉在群顶上的话" en="NOTICE" icon={<ScrapStamp><Megaphone size={15} weight="fill" /></ScrapStamp>} onClose={() => setModalType('none')}
                footer={userCanManage(activeGroup) ? (
                    <>
                        <ScrapBtn variant="paper" onClick={() => setTempAnnouncement('')}>清空</ScrapBtn>
                        <ScrapBtn onClick={handleSaveAnnouncement}>
                            {tempAnnouncement.trim() ? '钉上去' : (activeGroup?.announcement?.text ? '取下来' : '钉上去')}
                        </ScrapBtn>
                    </>
                ) : undefined}
            >
                <div className="space-y-3">
                    {activeGroup?.announcement?.text && (
                        <div className="flex items-center gap-1.5 text-[11px]" style={{ color: INK_SOFT }}>
                            <Megaphone size={13} weight="fill" style={{ color: INK }} />
                            <span>{displayNameOf(activeGroup, activeGroup.announcement.by)} 钉的 · {new Date(activeGroup.announcement.at).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                    )}
                    {userCanManage(activeGroup) ? (
                        <>
                            <ScrapTextarea
                                value={tempAnnouncement}
                                onChange={e => setTempAnnouncement(e.target.value)}
                                maxLength={800}
                                rows={6}
                                placeholder="写点想让全群都记着的事…（会钉在最上面，大家都看得见、会接话）"
                                autoFocus
                            />
                            <ScrapNote className="text-right">{tempAnnouncement.length}/800 · 清空再钉就等于撤下</ScrapNote>
                        </>
                    ) : (
                        <div className="p-4 text-sm leading-relaxed whitespace-pre-wrap min-h-[80px]" style={{ background: 'rgba(255,253,247,0.8)', border: `1px solid ${INK_SOFT}55`, outline: `1px dashed ${INK_SOFT}55`, outlineOffset: -4, borderRadius: 12, color: INK }}>
                            {activeGroup?.announcement?.text || '这群还没钉公告。'}
                        </div>
                    )}
                </div>
            </Modal>

            {/* @ 成员选择器：点名让 TA 本轮优先回应；群主/管理员可 @全体成员 */}
            <Modal isOpen={modalType === 'mention-picker'} title="喊一声谁" en="MENTION" onClose={() => setModalType('none')}>
                <div className="space-y-2 max-h-[55vh] overflow-y-auto no-scrollbar pr-1">
                    {userCanManage(activeGroup) && (
                        <ScrapRowBtn onClick={() => insertMention('全体成员')} icon={<UsersThree size={18} weight="bold" />}>@所有人</ScrapRowBtn>
                    )}
                    {(activeGroup?.members || []).map(mid => {
                        const c = characters.find(ch => ch.id === mid);
                        if (!c) return null;
                        const dn = displayNameOf(activeGroup, mid);
                        const muted = isMuted(activeGroup, mid);
                        return (
                            <ScrapRowBtn
                                key={mid}
                                avatar={c.avatar}
                                avatarDim={muted}
                                onClick={() => insertMention(dn)}
                                trailing={muted ? <span className="text-[10px] shrink-0 font-bold" style={{ color: INK_SOFT }}>闭麦中</span> : undefined}
                            >
                                {dn}
                            </ScrapRowBtn>
                        );
                    })}
                    {(activeGroup?.members || []).length === 0 && (
                        <ScrapNote center className="py-8">群里还没别人。</ScrapNote>
                    )}
                </div>
            </Modal>

            {/* 改名小心思 Modal（点系统提示弹出，查看角色为什么改群名片） */}
            <Modal isOpen={!!nicknameThoughtMsg} title="改名背后的小心思" en="WHY" onClose={() => setNicknameThoughtMsg(null)}>
                {nicknameThoughtMsg && (() => {
                    const md: any = nicknameThoughtMsg.metadata || {};
                    return (
                        <div className="space-y-3">
                            <div className="flex items-center gap-2 text-[11px]" style={{ color: INK_SOFT }}>
                                <IdentificationCard size={14} weight="bold" style={{ color: INK }} />
                                <span>{md.nicknameChar || '某位成员'} 把自己改叫「{md.nicknameNew || ''}」</span>
                            </div>
                            <div className="p-4 text-sm leading-relaxed" style={{ background: 'rgba(255,253,247,0.8)', border: `1px solid ${INK_SOFT}55`, outline: `1px dashed ${INK_SOFT}55`, outlineOffset: -4, borderRadius: 12, color: INK }}>
                                {md.nicknameThought || '（什么也没说，就这么改了）'}
                            </div>
                            <ScrapNote center>这点心思只飘到你这儿。</ScrapNote>
                        </div>
                    );
                })()}
            </Modal>

            {/* 设置头衔 Modal */}
            <Modal
                isOpen={modalType === 'set-title'} title="封个头衔" en="TITLE" icon={<ScrapStamp><Crown size={15} weight="bold" /></ScrapStamp>} onClose={() => setModalType('member-profile')}
                footer={<>
                    <ScrapBtn variant="paper" onClick={() => { setTempTitle(''); }}>撤了</ScrapBtn>
                    <ScrapBtn onClick={handleSetTitle}>挂上</ScrapBtn>
                </>}
            >
                <div className="space-y-3">
                    <ScrapNote>头衔挂在 TA 名字旁边，群里所有人（连 TA 自己）都看得见。清空再挂就等于摘掉。</ScrapNote>
                    <ScrapInput value={tempTitle} onChange={e => setTempTitle(e.target.value)} maxLength={12} placeholder="比如：气氛担当 / 沙发王" autoFocus />
                </div>
            </Modal>

            {/* 添加成员 Modal */}
            <Modal isOpen={modalType === 'add-member'} title="再拉个人进来" en="ADD MEMBER" icon={<ScrapStamp><UsersThree size={15} weight="bold" /></ScrapStamp>} onClose={() => setModalType('settings')}>
                <div className="space-y-3">
                    {(() => {
                        const candidates = visibleCharacters.filter(c => !activeGroup?.members.includes(c.id));
                        if (candidates.length === 0) return <ScrapNote center className="py-6">名册里的人都已经在群里了。</ScrapNote>;
                        return (
                            <div className="grid grid-cols-4 gap-2 max-h-60 overflow-y-auto no-scrollbar pr-1">
                                {candidates.map(c => (
                                    <ScrapPickTile key={c.id} src={c.avatar} label={c.name} onClick={() => handleAddMember(c.id)} />
                                ))}
                            </div>
                        );
                    })()}
                </div>
            </Modal>

            {/* 禁言 Modal */}
            <Modal isOpen={modalType === 'mute-member'} title="让 TA 安静一会儿" en="MUTE" icon={<ScrapStamp><SpeakerSlash size={15} weight="bold" /></ScrapStamp>} onClose={() => setModalType('member-profile')}>
                <div className="space-y-3">
                    <ScrapNote>闭麦期间 TA 不会在群里开口（AI 导演也会跳过 TA），群里会发送系统提示。</ScrapNote>
                    <div className="grid grid-cols-2 gap-2">
                        {MUTE_OPTIONS.map(opt => (
                            <ScrapBtn key={opt.ms} variant="paper" full={false} onClick={() => handleMuteMember(opt.ms)} className="text-xs">
                                {opt.label}
                            </ScrapBtn>
                        ))}
                    </div>
                    {profileMemberId && isMuted(activeGroup, profileMemberId) && (
                        <ScrapBtn onClick={() => handleMuteMember(null)} className="text-xs" icon={<Megaphone size={14} weight="bold" />}>
                            放 TA 出来说话
                        </ScrapBtn>
                    )}
                </div>
            </Modal>

        </div>
    );
};

export default ChatHub;
