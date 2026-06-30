import React, { useState, useEffect, useRef, useLayoutEffect, useMemo, useCallback } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { AppID, Message, MessageType, MemoryFragment, Emoji, EmojiCategory, DailySchedule, ScheduleSlot, CharacterProfile, UserProfile, TakeoutOrder, PrivateChatArchive, PrivateChatArchiveMessage, SocialPost, CollectionItem, PhoneLockState, ScreenPeekCard, ChatAlarm, ChatAlarmChannel, ChatAlarmKind } from '../types';
import { setTakeoutIntent, buildTakeoutCardMeta } from '../utils/takeout';
import { nextAppealDelayMs } from '../utils/unblockAppeal';
import { applyAffectionEval, sanitizeRelationshipUpdate, buildRelationshipState, isRelationshipStage, defaultRelationship, STAGE_DEFAULT_LABEL, canPropose as canProposeNow, createMarriageState } from '../utils/relationship';
import ProposalOverlay from '../components/chat/ProposalOverlay';
import { processImage } from '../utils/file';
import { safeFetchJson, safeResponseJson, extractContent } from '../utils/safeApi';
import { generateDailyScheduleForChar, isScheduleFeatureOn, reconcileScheduleWithChat, chatHasScheduleSignal } from '../utils/scheduleGenerator';
import { runRecenter, RECENTER_DEFAULT_TURNS, type RecenterResult } from '../utils/recenter';
import { proposalResultHint, innerVoicePromptBody, phoneLockAttemptPromptBody, phoneLockChatPromptBody, parallelReplyPromptBody } from '../utils/laiwangPrompts';
import { isAuxApiOn, resolveAuxApi } from '../utils/auxApi';
import { resolveMemoryPalaceAuxConfigs } from '../utils/memoryPalace/auxConfig';
import { formatMessageWithTime } from '../utils/messageFormat';
import { XhsMcpClient, extractNotesFromMcpData, normalizeNote } from '../utils/xhsMcpClient';
import { isMcdConfigured } from '../utils/mcdMcpClient';
import { isMcdActivatedInMessages, MCD_ACTIVATE_TRIGGER, MCD_DEACTIVATE_TRIGGER } from '../utils/mcdToolBridge';
import MessageItem from '../components/chat/MessageItem';
import CharacterProfilePage from '../components/character/CharacterProfilePage';
import CheckPhone from './CheckPhone';
import CameraApp from './CameraApp';
import CharPhoneCheckOverlay from '../components/chat/CharPhoneCheckOverlay';
import OfflineModeModal from '../components/chat/OfflineModeModal';
import UserActionSelectorModal from '../components/chat/UserActionSelectorModal';
import { OFFLINE_START_EVENT, consumeOfflinePending, hasOfflineSession } from '../utils/offlineMode';
import { CHAR_PHONE_CHECK_EVENT, consumePhoneCheckPending } from '../utils/charPhoneCheck';
import { CHAR_WITHDRAW_EVENT } from '../utils/messageWithdraw';
import { toggleReaction, CHAR_REACT_EVENT } from '../utils/messageReactions';
import { CHAR_PAT_EVENT, DEFAULT_PAT_SUFFIX } from '../utils/patSuffix';
import { CHAR_USER_REMARK_EVENT, type UserRemarkEventDetail } from '../utils/userRemarkSystem';
import { CHAR_AVATAR_FROM_USER_IMAGE_EVENT, type CharAvatarEventDetail } from '../utils/charAvatarSystem';
import { applyRegexToText, REGEX_SCRIPTS_UPDATED_EVENT } from '../utils/regex/store';
import { regex_placement } from '../utils/regex/engine';
import { ChatParser } from '../utils/chatParser';
import McdMiniApp from '../components/mcd/McdMiniApp';
import { PRESET_THEMES, DEFAULT_ARCHIVE_PROMPTS } from '../components/chat/ChatConstants';
import ChatHeader from '../components/chat/ChatHeaderShell';
import CharacterEntryTransition from '../components/chat/CharacterEntryTransition';
import ChatInputArea from '../components/chat/ChatInputArea';
import ConvoSettingsPanel from '../components/chat/ConvoSettingsPanel';
import TabloidModal from '../components/chat/TabloidModal';
import ChatModals from '../components/chat/ChatModals';
import Modal, { ScrapBtn, ScrapRowBtn, ScrapNote, ScrapInput, ScrapTextarea, ScrapChip, INK, INK_SOFT } from '../components/chat/ScrapModal';
import JournalSheet, { SealBtn, LinedInput, LinedArea, NoteStrip } from '../components/chat/JournalSheet';
import { MONO_STACK, SERIF_STACK, CUTE_STACK } from '../components/handbook/paper';
import { PhoneSlash } from '@phosphor-icons/react';
import ProactiveSettingsModal from '../components/chat/ProactiveSettingsModal';
import LifeRecapModal, { countUnseenCatchup, markLifeRecapSeen } from '../components/chat/LifeRecapModal';
import ThinkingChainSettingsModal from '../components/chat/ThinkingChainSettingsModal';
import FriendVerifyModal from '../components/chat/FriendVerifyModal';
import PhoneLockExitUnlockSheet from '../components/chat/PhoneLockExitUnlockSheet';
import { queueManualDeepLink, scrollToManualAnchor, useManualDeepLink } from '../utils/manualDeepLink';
import { useChatAI } from '../hooks/useChatAI';
import { synthesizeSpeechDetailed, cleanTextForTts } from '../utils/minimaxTts';
import { resolveMiniMaxApiKey } from '../utils/minimaxApiKey';
import { isInstantConfigReady, loadInstantConfig } from '../utils/instantPushClient';
import { ContextBuilder } from '../utils/context';
import { substituteMacros } from '../utils/macros';
import { PersonaRuntime } from '../utils/personas';
import { generateImage, IMAGE_GEN_MODEL_KEY, DEFAULT_IMAGE_GEN_MODEL } from '../utils/imageGen';
import { InnerVoiceEntry } from '../types';
import { createPhoneLockState, evaluatePhoneLockSubmission, sanitizePhoneLockPasscode } from '../utils/phoneLock';
import { generateXunjiScreenlifeRun } from '../utils/xunji';
import { FORUM_PENDING_CHAT_SHARE_KEY, forumShareAutoReplyHint, normalizeForumSharePendingPayload } from '../utils/forum';
import { getNotifyPermission, requestNotifyPermission } from '../utils/browserNotify';
import {
    CHAT_ALARM_WEEKDAYS,
    EVERYDAY_WEEKDAYS,
    WORKDAY_WEEKDAYS,
    alarmChannelLabel,
    alarmKindLabel,
    makeChatAlarm,
    prepareAlarmForSave,
    weekdayLabel,
} from '../utils/chatAlarms';

const VOICE_LANG_LABELS: Record<string, string> = { en: 'English', ja: '日本語', ko: '한국어', fr: 'Français', es: 'Español' };
type InstantToolUiStatus = {
    charId: string;
    phase: 'running' | 'continuing' | 'done' | 'failed';
    text: string;
    sessionId?: string;
    updatedAt?: number;
};

const PRIVATE_CHAT_ARCHIVE_EXPORT_TYPE = 'moro_private_chat_archive';
const PARALLEL_REPLY_ENABLED_KEY = 'moro_parallel_reply_enabled_v1';
const PARALLEL_REPLY_TARGETS_KEY = 'moro_parallel_reply_targets_v1';
const KNOWN_MESSAGE_TYPES = new Set<MessageType>([
    'text', 'image', 'emoji', 'interaction', 'transfer', 'system', 'social_card', 'forum_card', 'chat_forward',
    'screen_peek_card', 'xhs_card', 'twitter_card', 'score_card', 'music_card', 'mcd_card', 'html_card', 'news_card', 'vr_card',
    'trpg_card', 'location', 'voice', 'call_log', 'takeout_card', 'proposal_card', 'poll_card',
    'relay_card', 'checkin_card', 'gift_card',
]);

const clipForPreview = (text: string, limit = 160) => {
    const clean = (text || '').replace(/\s+/g, ' ').trim();
    return clean.length > limit ? `${clean.slice(0, limit)}…` : clean;
};

const screenPeekHash = (value: string): number => {
    let h = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
        h ^= value.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
};

const screenPeekClock = (ts: number) => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const buildScreenPeekPhoneScreen = (
    run: Awaited<ReturnType<typeof generateXunjiScreenlifeRun>>,
    char: CharacterProfile,
    userProfile: UserProfile,
    now: number,
): NonNullable<ScreenPeekCard['screen']> => {
    const seed = screenPeekHash(`${char.id}_${now}_${run.title}_${run.narrative}`);
    const text = [
        run.title,
        run.narrative,
        ...(run.appUsage || []).map(a => a.appName),
        ...(run.browsed || []).map(b => `${b.appName} ${b.title} ${b.summary}`),
        ...(run.notes || []).map(n => n.text),
        ...(run.chats || []).map(c => `${c.target} ${c.summary}`),
    ].join(' ');
    const latestApp = [...(run.appUsage || [])].sort((a, b) => b.endedAt - a.endedAt)[0];
    const latestBrowse = [...(run.browsed || [])].sort((a, b) => b.time - a.time)[0];
    const chosenAppName = (latestApp?.appName || latestBrowse?.appName || '').trim();
    const normalizeApp = (value?: string) => (value || '').trim().toLowerCase();
    const sameApp = (appName?: string) => {
        const a = normalizeApp(appName);
        const b = normalizeApp(chosenAppName);
        return !!a && !!b && (a === b || a.includes(b) || b.includes(a));
    };
    const scopedBrowsed = chosenAppName
        ? (run.browsed || []).filter(item => sameApp(item.appName))
        : (run.browsed || []);
    const activeBrowsed = scopedBrowsed;
    const topBrowse = activeBrowsed[seed % Math.max(1, activeBrowsed.length)] || activeBrowsed[0];
    const topChat = run.chats?.[seed % Math.max(1, run.chats.length)] || run.chats?.[0];
    const topNote = run.notes?.[seed % Math.max(1, run.notes.length)] || run.notes?.[0];
    const hasChosenSurface = !!chosenAppName || activeBrowsed.length > 0;
    const scopedText = (hasChosenSurface ? [
        chosenAppName,
        latestApp?.appName,
        latestApp?.category,
        latestApp?.note,
        ...activeBrowsed.map(b => `${b.appName} ${b.title} ${b.summary}`),
        ...(chosenAppName && /备忘|便签|memo|note/i.test(chosenAppName) ? (run.notes || []).map(n => n.text) : []),
        ...(chosenAppName && /微信|QQ|消息|聊天|私信|DM/i.test(chosenAppName) ? (run.chats || []).map(c => `${c.target} ${c.summary}`) : []),
    ] : [
        run.title,
        run.narrative,
        ...(run.appUsage || []).map(a => a.appName),
        ...(run.browsed || []).map(b => `${b.appName} ${b.title} ${b.summary}`),
        ...(run.notes || []).map(n => n.text),
        ...(run.chats || []).map(c => `${c.target} ${c.summary}`),
    ]).join(' ');
    const batteryLevel = 18 + (seed % 76);
    const base = {
        timeText: screenPeekClock(now),
        batteryLevel,
        avatar: char.avatar,
    };
    const rowFromBrowse = (item: NonNullable<typeof topBrowse>, index: number) => ({
        id: item.id || `peek-row-${index}`,
        title: item.title || item.appName || '刚刚停留的页面',
        subtitle: item.appName,
        body: clipForPreview(item.summary || run.narrative, 90),
        meta: screenPeekClock(item.time || now),
        badge: index === 0 ? '正在看' : undefined,
    });
    const scopedRows = (fallback: any[] = []) => (activeBrowsed.length ? activeBrowsed : fallback)
        .slice(0, 6)
        .map((item, index) => rowFromBrowse(item, index));
    const foodTabsForApp = (appName: string) => {
        if (/下厨房|菜谱|厨房/.test(appName)) return ['菜谱', '菜单', '作品', '食材', '课堂'];
        if (/大众点评|点评|探店/.test(appName)) return ['收藏', '店铺', '笔记', '榜单', '足迹'];
        if (/美团|饿了么|外卖|点单/.test(appName)) return ['店铺', '商品', '红包', '订单', '评价'];
        if (/小红书|红书/.test(appName)) return ['笔记', '收藏', '专辑', '关注', '附近'];
        return ['收藏', '内容', '最近', '分类', '更多'];
    };
    const appOnlyText = `${chosenAppName} ${latestApp?.category || ''}`;
    const currentAction = latestApp?.note || topBrowse?.summary || '';

    if (/日历|日程|提醒|calendar/i.test(appOnlyText)) {
        const focus = clipForPreview(currentAction || '正在查看今天接下来的安排。', 80);
        return {
            ...base,
            appKind: 'calendar',
            appName: chosenAppName || '日历',
            title: '今天',
            subtitle: undefined,
            action: focus,
            layout: 'day',
            rows: [
                { id: 'peek-calendar-now', title: focus, body: '当前停留在这条日程附近。', meta: screenPeekClock(now) },
                { id: 'peek-calendar-next', title: '稍后', body: '还有一段空白时间，像是在犹豫要不要补上安排。', meta: screenPeekClock(now + 45 * 60 * 1000) },
                { id: 'peek-calendar-night', title: '晚上', body: `${char.name} 把页面停在今天，没有切到其它软件。`, meta: screenPeekClock(now + 3 * 60 * 60 * 1000) },
            ],
        };
    }

    if (/浏览器|safari|chrome|edge|网页|资讯|browser/i.test(appOnlyText)) {
        const rows = scopedRows();
        const first = rows[0];
        return {
            ...base,
            appKind: 'browser',
            appName: chosenAppName || topBrowse?.appName || '浏览器',
            title: first?.title || latestApp?.note || '新标签页',
            subtitle: undefined,
            action: currentAction || '浏览器停在当前页面。',
            layout: first ? 'article' : 'search',
            url: first ? `${(chosenAppName || 'moro').toLowerCase().replace(/\s+/g, '')}.local` : 'search',
            rows: rows.length ? rows : [{ id: 'peek-browser-current', title: latestApp?.note || '新标签页', body: '页面没有露出其它 App 的内容。', meta: screenPeekClock(now) }],
        };
    }

    if (/小红书|红书|微博|推特|朋友圈|动态|社交/.test(scopedText)) {
        const rows = scopedRows([topBrowse].filter(Boolean) as any[]);
        return {
            ...base,
            appKind: 'social',
            appName: chosenAppName || topBrowse?.appName || latestApp?.appName || '动态',
            title: topBrowse?.title || '正在浏览',
            subtitle: chosenAppName || topBrowse?.appName || '刚刚停留的页面',
            rows: rows.length ? rows : [{ id: 'peek-social-empty', title: run.title, body: run.narrative, meta: '刚刚' }],
        };
    }

    if (/外卖|饭|菜|餐|店|菜单|美食|厨房|点评|探店|点单/.test(appOnlyText) || (/外卖|饭|菜|餐|店|菜单|美食|厨房|点评|探店|点单/.test(scopedText) && activeBrowsed.length > 0)) {
        const appName = chosenAppName || topBrowse?.appName || latestApp?.appName || '收藏';
        const tabs = foodTabsForApp(appName);
        const rows = scopedRows([topBrowse].filter(Boolean) as any[])
            .map((item, index) => ({
                ...item,
                subtitle: item.subtitle || appName,
                badge: index === 0 ? '正在看' : item.badge,
            }));
        const isRecipeApp = /下厨房|菜谱|厨房/.test(appName);
        const isReviewApp = /大众点评|点评|探店/.test(appName);
        const fallbackRecipes = isRecipeApp ? [
            { title: '红仁虾仁蒸蛋', subtitle: appName, body: topBrowse?.summary || run.narrative, meta: '刚刚' },
            { title: '海鲜粥', subtitle: appName, body: '步骤页停在中段，像是刚刚对着食材又确认了一遍。', meta: '03:30' },
            { title: '草莓塔', subtitle: appName, body: '成品图停在屏幕中间，页面还没划走。', meta: '03:45' },
        ] : isReviewApp ? [
            { title: '巷口小馆', subtitle: appName, body: topBrowse?.summary || run.narrative, meta: '刚刚' },
            { title: '夜里还亮着的咖啡店', subtitle: appName, body: '店铺收藏页停在评分和评论摘要上。', meta: '03:30' },
            { title: '周末想去的甜品店', subtitle: appName, body: '相册第一张图还露在页面上。', meta: '03:45' },
        ] : [
            { title: '常点的店铺', subtitle: appName, body: topBrowse?.summary || run.narrative, meta: '刚刚' },
            { title: '热卖套餐', subtitle: appName, body: '商品卡停在加购按钮旁边。', meta: '03:30' },
            { title: '收藏店铺', subtitle: appName, body: '配送时间和优惠券还显示在列表里。', meta: '03:45' },
        ];
        for (let i = rows.length; i < 4; i += 1) {
            const fallback = fallbackRecipes[i % fallbackRecipes.length];
            rows.push({
                id: `peek-food-fallback-${i}`,
                title: fallback.title,
                subtitle: fallback.subtitle,
                body: fallback.body,
                meta: fallback.meta,
                badge: i === 0 ? '正在看' : undefined,
            });
        }
        return {
            ...base,
            appKind: 'takeout',
            appName,
            title: topBrowse?.title || (/美团|饿了么|外卖/.test(appName) ? '店铺' : /大众点评|点评|探店/.test(appName) ? '附近探店' : appName),
            subtitle: undefined,
            tabs,
            activeTab: tabs[0],
            action: currentAction || topBrowse?.summary || run.narrative,
            layout: /收藏/.test(`${topBrowse?.title || ''} ${currentAction}`) ? 'favorite' : /美团|饿了么|外卖/.test(appName) ? 'store' : 'feed',
            rows,
        };
    }

    if (/备忘|便签|待办|记|memo|note/i.test(scopedText) || (!topBrowse && topNote)) {
        const notes = (run.notes?.length ? run.notes : [topNote].filter(Boolean) as any[])
            .slice(0, 6)
            .map((note, index) => ({
                id: note.id || `peek-note-${index}`,
                text: note.text || '有一句没写完的备忘。',
                meta: screenPeekClock(note.time || now),
            }));
        return {
            ...base,
            appKind: 'notes',
            appName: latestApp?.appName || '备忘录',
            title: '备忘录',
            subtitle: '刚刚还停在这里',
            notes,
        };
    }

    if (/相册|照片|图片|图库|拍照/.test(scopedText)) {
        const rows = (run.moments?.length ? run.moments : [])
            .slice(0, 6)
            .map((moment, index) => ({
                id: moment.id || `peek-gallery-${index}`,
                title: moment.title || '最近照片',
                body: clipForPreview(moment.body || '', 70),
                meta: screenPeekClock(moment.time || now),
            }));
        return {
            ...base,
            appKind: 'gallery',
            appName: latestApp?.appName || '相册',
            title: '最近项目',
            subtitle: '照片和截图',
            rows: rows.length ? rows : [{ id: 'peek-gallery-empty', title: '最近截图', body: run.narrative, meta: '刚刚' }],
        };
    }

    if (/地图|导航|位置|路线|通勤|天气|附近|街区|地铁|公交|打车/.test(scopedText)) {
        const rows = scopedRows([topBrowse].filter(Boolean) as any[]);
        return {
            ...base,
            appKind: 'map',
            appName: chosenAppName || latestApp?.appName || topBrowse?.appName || '地图',
            title: topBrowse?.title || '附近',
            subtitle: topBrowse?.summary || '刚刚停留在地图页面',
            rows: rows.length ? rows : [{ id: 'peek-map-empty', title: '当前位置附近', body: run.narrative, meta: '刚刚' }],
        };
    }

    if (/音乐|歌|播放|歌单/.test(scopedText)) {
        return {
            ...base,
            appKind: 'music',
            appName: chosenAppName || latestApp?.appName || '音乐',
            title: '正在播放',
            subtitle: topBrowse?.title || '循环到一半的歌',
            hero: {
                title: topBrowse?.title || '一首没舍得切走的歌',
                subtitle: topBrowse?.summary || run.socialInference?.mood || run.narrative,
            },
        };
    }

    if (/微信|QQ|消息|聊天|私信|絮语|DM/i.test(scopedText) || (topChat && seed % 3 !== 1 && !chosenAppName)) {
        const rawLines = [
            topChat?.summary,
            ...(topChat?.messages || []),
        ].filter(Boolean) as string[];
        const messages = rawLines.slice(0, 7).map((line, index) => ({
            id: `peek-msg-${index}`,
            side: (index === 0 ? 'center' : index % 3 === 0 ? 'right' : 'left') as 'left' | 'right' | 'center',
            text: clipForPreview(line, 80),
            senderName: index % 3 === 0 ? char.name : topChat?.target,
        }));
        return {
            ...base,
            appKind: 'chat',
            appName: chosenAppName || latestApp?.appName || '聊天',
            title: topChat?.target || userProfile.name || '聊天',
            subtitle: '刚刚亮着的会话',
            contactName: topChat?.target || userProfile.name,
            contactAvatar: userProfile.avatar,
            messages: messages.length ? messages : [{ id: 'peek-msg-empty', side: 'left', text: run.narrative, senderName: topChat?.target }],
        };
    }

    const rows = scopedRows();
    if (chosenAppName) {
        return {
            ...base,
            appKind: 'app',
            appName: chosenAppName,
            title: latestApp?.note || topBrowse?.title || chosenAppName,
            subtitle: undefined,
            action: currentAction || run.narrative,
            layout: 'generic',
            rows: rows.length ? rows : [{ id: 'peek-app-current', title: latestApp?.note || chosenAppName, body: run.narrative, meta: screenPeekClock(now) }],
        };
    }

    return {
        ...base,
        appKind: /小红书|微博|推特|朋友圈|动态|社交/.test(scopedText) ? 'social' : 'app',
        appName: chosenAppName || topBrowse?.appName || latestApp?.appName || '浏览器',
        title: topBrowse?.title || '正在浏览',
        subtitle: chosenAppName || topBrowse?.appName || '刚刚停留的页面',
        action: currentAction || run.narrative,
        layout: 'generic',
        rows: rows.length ? rows : [{ id: 'peek-row-empty', title: run.title, body: run.narrative, meta: '刚刚' }],
    };
};

const makePhoneLockCode = () => '';

const PHONE_LOCK_PRESETS = {
    miss: {
        label: '自定义锁机',
        hint: '只有口令正确才会自动解锁，题目用于交流和提示',
        note: (userName: string) => `${userName} 锁住了你的手机。先看完提示，再回答题目或答出口令。`,
        questions: (_userName: string) => [],
    },
    night: {
        label: '晚安锁',
        hint: '适合异地恋睡前小闹钟',
        note: (userName: string) => `${userName} 给你上了晚安锁。乖乖报备，解开就去休息。`,
        questions: (userName: string) => [
            '现在几点了，还不睡的理由是什么？',
            `给 ${userName} 留一句晚安。`,
            '明天醒来第一件想做什么？',
        ],
    },
    focus: {
        label: '专注锁',
        hint: '像远程陪伴学习/工作小锁',
        note: (userName: string) => `${userName} 暂时锁住了你的手机。先把注意力收回来，再解锁。`,
        questions: (_userName: string) => [
            '你现在最该先做完哪件事？',
            '手机放下后，你准备专注多久？',
            '给自己一句别分心的提醒。',
        ],
    },
} as const;

type PhoneLockPresetId = keyof typeof PHONE_LOCK_PRESETS;
type PhoneLockPhase = 'setup' | 'locked' | 'unlocked';
type PhoneLockScreenPhase = 'idle' | 'thinking' | 'choosing' | 'answered' | 'reaction' | 'chat';

interface PhoneLockQuestionForm {
    stem: string;
    optionA: string;
    optionB: string;
}

interface PhoneLockAttempt {
    passcodeInput: string;
    answers: string[];
    wantsUnlock: boolean;
    reply: string;
    mood: string;
    unlocked?: boolean;
    unlockReason?: 'passcode' | 'question' | 'both' | 'none';
    completedQuestionId?: string;
}

interface PhoneLockChatLine {
    id: string;
    speaker: 'user' | 'char' | 'system';
    text: string;
    at: number;
}

const makeEmptyPhoneLockQuestion = (): PhoneLockQuestionForm => ({ stem: '', optionA: '', optionB: '' });

const TypewriterText: React.FC<{
    text: string;
    className?: string;
    style?: React.CSSProperties;
    speed?: number;
    revealKey?: string | number;
    forceDone?: boolean;
    onDone?: () => void;
}> = ({ text, className, style, speed = 24, revealKey, forceDone, onDone }) => {
    const [visible, setVisible] = useState(forceDone ? text.length : 0);
    const onDoneRef = useRef(onDone);

    useEffect(() => {
        onDoneRef.current = onDone;
    }, [onDone]);

    useEffect(() => {
        if (forceDone) {
            setVisible(text.length);
            onDoneRef.current?.();
            return;
        }
        setVisible(0);
        if (!text) {
            onDoneRef.current?.();
            return;
        }
        let i = 0;
        const timer = window.setInterval(() => {
            i += 1;
            setVisible(i);
            if (i >= text.length) {
                window.clearInterval(timer);
                onDoneRef.current?.();
            }
        }, speed);
        return () => window.clearInterval(timer);
    }, [text, speed, revealKey, forceDone]);

    return <span className={className} style={style}>{text.slice(0, visible)}</span>;
};

const phoneLockResultLabel = (reason?: PhoneLockAttempt['unlockReason']) => {
    if (reason === 'both') return '口令和题目都通过';
    if (reason === 'passcode') return '口令正确';
    if (reason === 'question') return '题目已答但口令未过';
    return '仍未解锁';
};

const messageKindLabel = (m: Message): string => {
    if (m.type === 'image') return '图片';
    if (m.type === 'emoji') return '表情';
    if (m.type === 'voice') return '语音';
    if (m.type === 'location') return '位置';
    if (m.type === 'transfer') return '转账/红包';
    return '消息';
};

const isImageUrlLike = (value: string): boolean => /^data:image\//i.test(value || '') || /^https?:\/\/.+\.(?:png|jpe?g|gif|webp|avif)(?:[?#].*)?$/i.test(value || '');

const makePrivateChatArchiveId = () => `pchat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const cloneArchiveValue = <T,>(value: T): T => {
    if (value === undefined || value === null) return value;
    try {
        return structuredClone(value);
    } catch {
        try { return JSON.parse(JSON.stringify(value)); } catch { return value; }
    }
};

const privateChatFileBaseName = (name: string) => {
    const raw = (name || '导入聊天').replace(/\.[^.]+$/, '').trim();
    return raw || '导入聊天';
};

const formatPrivateChatTitleTime = (ts: number) => {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const privateChatPreview = (text: string, max = 44) => {
    const normalized = (text || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return '';
    return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
};

const asMessageType = (raw: any): MessageType => {
    return KNOWN_MESSAGE_TYPES.has(raw) ? raw as MessageType : 'text';
};

const toPrivateChatMessages = (source: Message[], charId: string): PrivateChatArchiveMessage[] => {
    return (source || [])
        .filter(m => !m.groupId && m.metadata?.source !== 'date' && m.metadata?.source !== 'call')
        .map(m => ({
            originalId: m.id,
            charId,
            role: m.role,
            type: asMessageType(m.type),
            content: m.content || '',
            timestamp: typeof m.timestamp === 'number' ? m.timestamp : Date.now(),
            metadata: cloneArchiveValue(m.metadata),
            replyTo: m.replyTo ? cloneArchiveValue(m.replyTo) : undefined,
        }));
};

const derivePrivateChatArchiveMeta = (messages: PrivateChatArchiveMessage[], fallbackTitle: string) => {
    const sorted = [...messages].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    const lastText = [...sorted].reverse().find(m => (m.content || '').trim());
    const firstText = sorted.find(m => m.role !== 'system' && (m.content || '').trim()) || lastText;
    const titleFromText = firstText ? privateChatPreview(firstText.content, 18) : '';
    const title = titleFromText || fallbackTitle;
    return {
        title,
        messageCount: messages.length,
        lastMessagePreview: lastText ? privateChatPreview(lastText.content, 52) : '',
        updatedAt: lastText?.timestamp || Date.now(),
    };
};

const normalizeLooseChatMessages = (
    rawMessages: any[],
    char: CharacterProfile,
    source: PrivateChatArchive['source'],
): PrivateChatArchiveMessage[] => {
    const now = Date.now();
    return rawMessages
        .map((raw, index): PrivateChatArchiveMessage | null => {
            if (!raw || typeof raw !== 'object') return null;
            if ((raw as any).chat_metadata || (raw as any).user_name || (raw as any).character_name) return null;
            const content = String(raw.content ?? raw.mes ?? raw.message ?? raw.text ?? '').trim();
            const extra = raw.extra && typeof raw.extra === 'object' ? raw.extra : undefined;
            const role: PrivateChatArchiveMessage['role'] =
                raw.role === 'system' || raw.is_system ? 'system'
                : raw.role === 'assistant' || raw.role === 'char' || raw.is_user === false ? 'assistant'
                : raw.role === 'user' || raw.is_user === true ? 'user'
                : raw.name && String(raw.name).trim() === char.name ? 'assistant'
                : 'user';
            const parsedTs = (() => {
                if (typeof raw.timestamp === 'number') return raw.timestamp;
                if (typeof raw.createdAt === 'number') return raw.createdAt;
                if (typeof raw.send_date === 'number') return raw.send_date;
                const dateText = raw.send_date || raw.timestamp || raw.createdAt || raw.date;
                if (dateText) {
                    const parsed = Date.parse(String(dateText));
                    if (Number.isFinite(parsed)) return parsed;
                }
                return now + index;
            })();
            if (!content && !extra?.image && !raw.image) return null;
            return {
                originalId: typeof raw.id === 'number' ? raw.id : undefined,
                charId: char.id,
                role,
                type: asMessageType(raw.type),
                content,
                timestamp: parsedTs,
                metadata: {
                    ...(raw.metadata && typeof raw.metadata === 'object' ? cloneArchiveValue(raw.metadata) : {}),
                    ...(extra ? { sillyTavernExtra: cloneArchiveValue(extra) } : {}),
                    ...(source ? { importedArchiveSource: source } : {}),
                },
                replyTo: raw.replyTo ? cloneArchiveValue(raw.replyTo) : undefined,
            };
        })
        .filter(Boolean) as PrivateChatArchiveMessage[];
};

const parsePrivateChatArchiveImport = (fileName: string, rawText: string, char: CharacterProfile): PrivateChatArchive => {
    const fallbackTitle = privateChatFileBaseName(fileName);
    const build = (
        messages: PrivateChatArchiveMessage[],
        source: PrivateChatArchive['source'],
        title?: string,
        createdAt?: number,
        updatedAt?: number,
    ): PrivateChatArchive => {
        const now = Date.now();
        const meta = derivePrivateChatArchiveMeta(messages, title || fallbackTitle || `新聊天 ${formatPrivateChatTitleTime(now)}`);
        return {
            id: makePrivateChatArchiveId(),
            charId: char.id,
            title: (title || meta.title || fallbackTitle).slice(0, 80),
            pinned: false,
            createdAt: createdAt || messages[0]?.timestamp || now,
            updatedAt: updatedAt || meta.updatedAt || now,
            messageCount: messages.length,
            lastMessagePreview: meta.lastMessagePreview,
            messages,
            source,
        };
    };

    const trimmed = rawText.trim();
    if (!trimmed) throw new Error('文件里没有可导入的聊天记录');

    // SillyTavern JSONL：每行一个消息/元数据对象，首行通常也以 "{" 开头。
    if (trimmed.includes('\n')) {
        try {
            const rows = trimmed.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => JSON.parse(line));
            if (rows.length > 1) {
                const messages = normalizeLooseChatMessages(rows, char, 'sillytavern');
                if (messages.length) {
                    const metaRow = rows.find((r: any) => r?.chat_metadata || r?.character_name || r?.user_name);
                    return build(messages, 'sillytavern', metaRow?.chat_metadata?.title || fallbackTitle);
                }
            }
        } catch { /* 不是 JSONL，继续尝试普通 JSON */ }
    }

    const parsed = JSON.parse(trimmed);
    if (parsed?.type === PRIVATE_CHAT_ARCHIVE_EXPORT_TYPE && parsed.archive) {
        const sourceMessages = Array.isArray(parsed.archive.messages) ? parsed.archive.messages : [];
        const messages = normalizeLooseChatMessages(sourceMessages, char, 'moro');
        return build(messages, 'moro', parsed.archive.title || fallbackTitle, parsed.archive.createdAt, parsed.archive.updatedAt);
    }
    if (parsed?.type === 'moro_chat_export' && Array.isArray(parsed.messages)) {
        const messages = normalizeLooseChatMessages(parsed.messages, char, 'moro');
        return build(messages, 'moro', parsed.title || parsed.character?.name || fallbackTitle);
    }
    if (Array.isArray(parsed)) {
        const messages = normalizeLooseChatMessages(parsed, char, 'sillytavern');
        if (!messages.length) throw new Error('没有识别到可导入消息');
        return build(messages, 'sillytavern', fallbackTitle);
    }
    if (Array.isArray(parsed?.messages)) {
        const source = parsed.type?.toString?.().includes('silly') ? 'sillytavern' : 'moro';
        const messages = normalizeLooseChatMessages(parsed.messages, char, source);
        if (!messages.length) throw new Error('没有识别到可导入消息');
        return build(messages, source, parsed.title || parsed.name || fallbackTitle, parsed.createdAt, parsed.updatedAt);
    }

    throw new Error('暂时不认识这个聊天记录格式');
};

const Chat: React.FC = () => {
    const { characters, activeCharacterId, setActiveCharacterId, updateCharacter, apiConfig, auxApiConfig, apiPresets, addApiPreset, closeApp, openApp, activeApp, customThemes, addToast, showError, userProfile, updateUserProfile, adjustUserBalance, lastMsgTimestamp, groups, clearUnread, realtimeConfig, memoryPalaceConfig, syncEmotionApiToAllCharacters, theme: osTheme, proactiveComposingChars } = useOS();
    const isProactiveComposing = !!(activeCharacterId && proactiveComposingChars[activeCharacterId]);

    // 记忆宫殿高水位（用于清空聊天时的安全检查）
    const getMemoryPalaceHWM = useCallback(async (charId: string): Promise<number> => {
        try {
            const { getMemoryPalaceHighWaterMark } = await import('../utils/memoryPalace/pipeline');
            return getMemoryPalaceHighWaterMark(charId);
        } catch { return 0; }
    }, []);
    const [messages, setMessages] = useState<Message[]>([]);
    const [revealedAssistantIds, setRevealedAssistantIds] = useState<Set<number>>(() => new Set());
    const [poppingMessageIds, setPoppingMessageIds] = useState<Set<number>>(() => new Set());
    // 行动选择器：点最后一轮 user 头像后弹出（生成可编辑的「接下来说点啥」选项）。纯手动，无开关。
    const [showActionSelector, setShowActionSelector] = useState(false);
    // Instant Push 路径："准备中"三个点 = 消息正在拼接+发送; 消失 = SSE POST 已排进
    // 浏览器网络栈. 页面关闭时会主动 abort SSE, 让 worker 尽量走 Web Push fallback。
    const [instantSendingActive, setInstantSendingActive] = useState(false);
    const [instantToolStatus, setInstantToolStatus] = useState<InstantToolUiStatus | null>(null);
    const [totalMsgCount, setTotalMsgCount] = useState(0);
    const [visibleCount, setVisibleCount] = useState(30);
    const [windowedFocusMsgId, setWindowedFocusMsgId] = useState<number | null>(null);
    const [flashMsgId, setFlashMsgId] = useState<number | null>(null);
    // 角色切换/进入时的缓入开关：先 false（透明），下一帧转 true，靠 CSS transition 平滑淡入。
    // 初值 false 让首次打开也是淡入、且不会有"先显示再变透明"的闪烁。
    // 角色切换「登场」过场是否显示。切换/进入角色时由 useLayoutEffect 在绘制前置真，覆盖住加载、避免闪到新聊天。
    const [showEntry, setShowEntry] = useState(false);
    const WINDOW_RADIUS = 25;
    const [input, setInput] = useState('');
    const [showPanel, setShowPanel] = useState<'none' | 'actions' | 'emojis'>('none');
    
    // Emoji State
    const [emojis, setEmojis] = useState<Emoji[]>([]);
    const [categories, setCategories] = useState<EmojiCategory[]>([]);
    const [activeCategory, setActiveCategory] = useState<string>('default');
    const [newCategoryName, setNewCategoryName] = useState('');

    const scrollRef = useRef<HTMLDivElement>(null);
    const lastMsgIdRef = useRef<number | null>(null);
    const scrollThrottleRef = useRef(0);
    const visibleCountRef = useRef(30);
    const activeCharIdRef = useRef(activeCharacterId);
    const charRef = useRef<typeof char>(null as any);
    const revealTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
    const revealKnownIdsRef = useRef<Set<number>>(new Set());
    const revealHydratedRef = useRef(false);

    // Reply Logic
    const [replyTarget, setReplyTarget] = useState<Message | null>(null);

    const [modalType, setModalType] = useState<'none' | 'transfer' | 'emoji-import' | 'chat-settings' | 'message-options' | 'edit-message' | 'delete-emoji' | 'delete-category' | 'add-category' | 'history-manager' | 'archive-settings' | 'prompt-editor' | 'category-options' | 'category-visibility' | 'schedule' | 'tabloid'>('none');
    const [scheduleData, setScheduleData] = useState<DailySchedule | null>(null);
    const [isScheduleGenerating, setIsScheduleGenerating] = useState(false);
    // 收款弹窗：角色发来的转账 / 红包，点开后让用户选择是否收下
    const [claimTarget, setClaimTarget] = useState<Message | null>(null);
    const [claimRevealed, setClaimRevealed] = useState(false); // 收款弹窗领取确认前后两态
    const [claimPwInput, setClaimPwInput] = useState(''); // 口令红包：领取前要先答对的口令
    // 日程锚点协调：记上次协调对应的「角色:末条消息id」签名，避免同一批消息重复触发
    const lastReconcileSigRef = useRef<string>('');
    // 回神：自我校准结果弹窗 + 进行中状态
    const [recenterResult, setRecenterResult] = useState<RecenterResult | null>(null);
    const [isRecentering, setIsRecentering] = useState(false);
    const [allHistoryMessages, setAllHistoryMessages] = useState<Message[]>([]);
    const [privateChatArchives, setPrivateChatArchives] = useState<PrivateChatArchive[]>([]);
    const [transferAmt, setTransferAmt] = useState('');
    const [transferMode, setTransferMode] = useState<'transfer' | 'redpacket'>('transfer');
    const [transferNote, setTransferNote] = useState('');
    const [transferPassword, setTransferPassword] = useState(''); // 口令红包：填了即口令红包
    // 外卖订单小票详情弹窗（点开聊天里的外卖卡片看具体内容）
    const [takeoutCardTarget, setTakeoutCardTarget] = useState<Message | null>(null);
    const [takeoutCardOrder, setTakeoutCardOrder] = useState<TakeoutOrder | null>(null);
    // 求婚：浪漫求婚界面目标卡 + 主动发起求婚的撰写弹窗
    const [proposalTarget, setProposalTarget] = useState<Message | null>(null);
    const [showProposeCompose, setShowProposeCompose] = useState(false);
    const [proposeVow, setProposeVow] = useState('');
    const [proposalBusy, setProposalBusy] = useState(false);

    // 角色主页（微信好友资料页风格，单击消息头像进入）
    const [showCharProfile, setShowCharProfile] = useState(false);

    // ── 拉黑系统 ──
    // 回到聊天界面时弹一次「你已将对方拉黑」提示（按角色记忆，解除后重置）
    const [showUserBlockNotice, setShowUserBlockNotice] = useState(false);
    // 角色给用户换备注弹窗（点开看动机）
    const [remarkChangeNotice, setRemarkChangeNotice] = useState<{ remark: string; motivation?: string } | null>(null);
    const [remarkMotivationOpen, setRemarkMotivationOpen] = useState(false);
    const userBlockNoticeShownRef = useRef<string | null>(null);
    // 被角色拉黑后重新发送好友验证
    const [showFriendVerify, setShowFriendVerify] = useState(false);

    // ── 查岗（双向）──
    // 用户查角色手机：+ 号面板入口，内嵌 CheckPhone（原桌面独立 App）
    const [showCheckPhone, setShowCheckPhone] = useState(false);
    // 相机：用 TA 的手机拍下此刻给 TA 看（+ 号面板「拍张照」）
    const [showCamera, setShowCamera] = useState(false);
    // 角色查用户手机：「允许 char 看手机」开启时角色主动发起的全屏覆盖层
    const [charPhoneCheckActive, setCharPhoneCheckActive] = useState(false);

    // ── 线下模式 ──「自动线下」开启 + 角色输出 [[OFFLINE_START]] 时弹出
    const [showOfflineMode, setShowOfflineMode] = useState(false);

    // 位置分享 modal
    const [showLocationModal, setShowLocationModal] = useState(false);
    const [locationName, setLocationName] = useState('');
    const [locationDetail, setLocationDetail] = useState('');

    // AI 画图 modal
    const [showImageGenModal, setShowImageGenModal] = useState(false);
    const [imageGenPrompt, setImageGenPrompt] = useState('');
    const [imageGenModel, setImageGenModel] = useState<string>(() => {
        try { return localStorage.getItem(IMAGE_GEN_MODEL_KEY) || DEFAULT_IMAGE_GEN_MODEL; } catch { return DEFAULT_IMAGE_GEN_MODEL; }
    });
    const [isGeneratingImage, setIsGeneratingImage] = useState(false);
    const [imageGenPreview, setImageGenPreview] = useState<string | null>(null);

    // 偷看心声 modal（角色不知情：结果不写进聊天上下文，仅存 inner_voices）
    const [showInnerVoiceModal, setShowInnerVoiceModal] = useState(false);
    const [innerVoiceLoading, setInnerVoiceLoading] = useState(false);
    const [innerVoiceCurrent, setInnerVoiceCurrent] = useState<InnerVoiceEntry | null>(null);
    const [innerVoiceHistory, setInnerVoiceHistory] = useState<InnerVoiceEntry[]>([]);
    const [emojiImportText, setEmojiImportText] = useState('');
    const [settingsContextLimit, setSettingsContextLimit] = useState(500);
    const [settingsHtmlModeCustomPrompt, setSettingsHtmlModeCustomPrompt] = useState('');
    const [preserveContext, setPreserveContext] = useState(true);
    const [isVectorizing, setIsVectorizing] = useState(false);
    const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
    const [selectedEmoji, setSelectedEmoji] = useState<Emoji | null>(null);
    const [selectedCategory, setSelectedCategory] = useState<EmojiCategory | null>(null); // For deletion modal
    const [editContent, setEditContent] = useState('');
    const [isSummarizing, setIsSummarizing] = useState(false);
    const [archiveProgress, setArchiveProgress] = useState('');
    const [showProactiveModal, setShowProactiveModal] = useState(false);
    const [showLifeRecapModal, setShowLifeRecapModal] = useState(false);
    // 离线自主生活·回看横幅：用户回来时若角色攒了未看过的离线事件，顶部提示「TA 经历了 N 件事」
    const [lifeRecapBanner, setLifeRecapBanner] = useState(0);
    const [showThinkingChainModal, setShowThinkingChainModal] = useState(false);
    const [showAlarmModal, setShowAlarmModal] = useState(false);
    const [chatAlarms, setChatAlarms] = useState<ChatAlarm[]>([]);
    const [alarmDraft, setAlarmDraft] = useState<ChatAlarm | null>(null);
    const [alarmSaving, setAlarmSaving] = useState(false);
    const [alarmLoading, setAlarmLoading] = useState(false);

    // ── 语音通话（聊天内发起，角色按人设决定接不接）──
    const [voiceCallPhase, setVoiceCallPhase] = useState<'none' | 'dialing' | 'rejected'>('none');
    const voiceCallCancelRef = useRef(false);

    // ── 系统命令 modal：用户以系统身份下达最高优先级指令 ──
    const [showSystemCmdModal, setShowSystemCmdModal] = useState(false);
    const [systemCmdInput, setSystemCmdInput] = useState('');

    // ── 并发回复：用户发给当前角色后，系统内部让选中的其它私聊同时各自生成一条 ──
    const [showParallelReplyModal, setShowParallelReplyModal] = useState(false);
    const [parallelReplyEnabled, setParallelReplyEnabled] = useState(() => {
        try { return localStorage.getItem(PARALLEL_REPLY_ENABLED_KEY) === 'true'; } catch { return false; }
    });
    const [parallelReplyTargetIds, setParallelReplyTargetIds] = useState<Set<string>>(() => {
        try {
            const parsed = JSON.parse(localStorage.getItem(PARALLEL_REPLY_TARGETS_KEY) || '[]');
            return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []);
        } catch {
            return new Set();
        }
    });
    const [parallelReplyBusyIds, setParallelReplyBusyIds] = useState<Set<string>>(new Set());

    // ── 锁机：回形针里的独立情侣互动。用户远程锁住 TA 的手机，输入/答题由角色完成。──
    const [showPhoneLockModal, setShowPhoneLockModal] = useState(false);
    const [phoneLockPreset, setPhoneLockPreset] = useState<PhoneLockPresetId>('miss');
    const [phoneLockNote, setPhoneLockNote] = useState('');
    const [phoneLockCode, setPhoneLockCode] = useState(() => makePhoneLockCode());
    const [phoneLockQuestions, setPhoneLockQuestions] = useState<PhoneLockQuestionForm[]>([makeEmptyPhoneLockQuestion()]);
    const [phoneLockAttempt, setPhoneLockAttempt] = useState<PhoneLockAttempt | null>(null);
    const [phoneLockRunning, setPhoneLockRunning] = useState(false);
    const [phoneLockPhase, setPhoneLockPhase] = useState<PhoneLockPhase>('setup');
    const [phoneLockChat, setPhoneLockChat] = useState<PhoneLockChatLine[]>([]);
    const [phoneLockChatInput, setPhoneLockChatInput] = useState('');
    const [phoneLockChatBusy, setPhoneLockChatBusy] = useState(false);
    const [phoneLockScreenOpen, setPhoneLockScreenOpen] = useState(false);
    const [phoneLockScreenPhase, setPhoneLockScreenPhase] = useState<PhoneLockScreenPhase>('idle');
    const [phoneLockScreenIndex, setPhoneLockScreenIndex] = useState(0);
    const [phoneLockSelectedOption, setPhoneLockSelectedOption] = useState<'A' | 'B' | null>(null);
    const [phoneLockSameScreenChat, setPhoneLockSameScreenChat] = useState(true);
    const [phoneLockTypingDone, setPhoneLockTypingDone] = useState(false);
    const [phoneLockSkipTyping, setPhoneLockSkipTyping] = useState(false);
    const [phoneLockExitSheetOpen, setPhoneLockExitSheetOpen] = useState(false);
    const [phoneLockExitCode, setPhoneLockExitCode] = useState('');
    const [phoneLockExitError, setPhoneLockExitError] = useState('');
    const [phoneLockExitBusy, setPhoneLockExitBusy] = useState(false);

    // Archive Prompts State
    const [archivePrompts, setArchivePrompts] = useState<{id: string, name: string, content: string}[]>(DEFAULT_ARCHIVE_PROMPTS);
    const [selectedPromptId, setSelectedPromptId] = useState<string>('preset_rational');
    const [editingPrompt, setEditingPrompt] = useState<{id: string, name: string, content: string} | null>(null);

    // --- Multi-Select State ---
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedMsgIds, setSelectedMsgIds] = useState<Set<number>>(new Set());
    // 思维链是 metadata.thinkingChain，没有独立 id，所以用宿主消息 id 作为键，
    // 与 selectedMsgIds 并行存在 —— 只勾思维链时只清 metadata，宿主消息保留。
    const [selectedThinkingMsgIds, setSelectedThinkingMsgIds] = useState<Set<number>>(new Set());

    // --- Translation State (per-character) ---
    const [translationEnabled, setTranslationEnabled] = useState(() => {
        try { return JSON.parse(localStorage.getItem(`chat_translate_enabled_${activeCharacterId}`) || 'false'); } catch { return false; }
    });
    const [translateSourceLang, setTranslateSourceLang] = useState(() => {
        // Fallback to legacy global key so existing users don't lose their setting on upgrade.
        return localStorage.getItem(`chat_translate_source_lang_${activeCharacterId}`)
            || localStorage.getItem('chat_translate_source_lang')
            || '日本語';
    });
    const [translateTargetLang, setTranslateTargetLang] = useState(() => {
        return localStorage.getItem(`chat_translate_lang_${activeCharacterId}`)
            || localStorage.getItem('chat_translate_lang')
            || '中文';
    });
    // Which messages are currently showing "译" version (toggle state only, no API calls)
    const [showingTargetIds, setShowingTargetIds] = useState<Set<number>>(new Set());

    const char = characters.find(c => c.id === activeCharacterId) || characters[0];
    charRef.current = char; // Keep ref in sync for async callbacks
    const parallelReplyTargets = useMemo(
        () => characters.filter(c => c.id !== activeCharacterId && parallelReplyTargetIds.has(c.id)),
        [characters, activeCharacterId, parallelReplyTargetIds],
    );

    const makeAlarmDraftFor = useCallback((kind: ChatAlarmKind): ChatAlarm | null => {
        if (!char) return null;
        return makeChatAlarm({
            charId: char.id,
            kind,
            label: kind === 'sleep' ? '睡觉督促' : kind === 'wake' ? '起床叫醒' : '提醒',
            timeHHmm: kind === 'sleep' ? '23:30' : '07:30',
            weekdays: EVERYDAY_WEEKDAYS,
            channel: 'auto',
        });
    }, [char?.id]);

    const notifyChatAlarmsUpdated = useCallback((charId: string) => {
        window.dispatchEvent(new CustomEvent('chat-alarms-updated', { detail: { charId } }));
    }, []);

    const refreshChatAlarms = useCallback(async (charId = activeCharacterId) => {
        if (!charId) {
            setChatAlarms([]);
            return [] as ChatAlarm[];
        }
        setAlarmLoading(true);
        try {
            const rows = await DB.getChatAlarmsByCharId(charId);
            if (activeCharIdRef.current === charId) setChatAlarms(rows);
            return rows;
        } catch (e) {
            console.warn('[ChatAlarm] load failed', e);
            if (activeCharIdRef.current === charId) setChatAlarms([]);
            return [] as ChatAlarm[];
        } finally {
            if (activeCharIdRef.current === charId) setAlarmLoading(false);
        }
    }, [activeCharacterId]);

    const openAlarmManager = useCallback(() => {
        if (!char) return;
        setShowPanel('none');
        setShowAlarmModal(true);
        setAlarmDraft(prev => (prev?.charId === char.id ? prev : makeAlarmDraftFor('sleep')));
        void refreshChatAlarms(char.id);
    }, [char?.id, makeAlarmDraftFor, refreshChatAlarms]);

    useManualDeepLink(AppID.Chat, useCallback((target) => {
        if (!activeCharacterId || !characters.some(c => c.id === activeCharacterId)) {
            queueManualDeepLink({
                appId: AppID.GroupChat,
                route: 'tab:contacts',
                anchorId: 'manual-chathub-contacts',
                payload: { tab: 'contacts' },
            });
            openApp(AppID.GroupChat);
            return;
        }
        if (target.route === 'chat-settings') {
            setModalType('chat-settings');
            window.setTimeout(() => {
                if (!scrollToManualAnchor(target.anchorId)) scrollToManualAnchor('manual-chat-settings-root');
            }, 260);
        } else if (target.route === 'chat-alarm') {
            openAlarmManager();
            window.setTimeout(() => {
                if (!scrollToManualAnchor(target.anchorId)) scrollToManualAnchor('manual-chat-alarm-root');
            }, 260);
        }
    }, [activeCharacterId, characters, openApp, openAlarmManager]), { enabled: activeApp === AppID.Chat });

    useEffect(() => {
        if (!showAlarmModal || !activeCharacterId) return;
        setAlarmDraft(prev => (prev?.charId === activeCharacterId ? prev : makeAlarmDraftFor('sleep')));
        void refreshChatAlarms(activeCharacterId);
    }, [showAlarmModal, activeCharacterId, makeAlarmDraftFor, refreshChatAlarms]);

    const updateAlarmDraft = (patch: Partial<ChatAlarm>) => {
        setAlarmDraft(prev => prev ? { ...prev, ...patch, updatedAt: Date.now() } : prev);
    };

    const setAlarmDraftKind = (kind: ChatAlarmKind) => {
        const fallback = makeAlarmDraftFor(kind);
        if (!fallback) return;
        setAlarmDraft(prev => {
            if (!prev || prev.charId !== fallback.charId) return fallback;
            return {
                ...prev,
                kind,
                label: prev.label || fallback.label,
                timeHHmm: kind === 'sleep' ? '23:30' : kind === 'wake' && prev.kind === 'sleep' ? '07:30' : prev.timeHHmm,
                updatedAt: Date.now(),
            };
        });
    };

    const toggleAlarmDraftWeekday = (day: number) => {
        setAlarmDraft(prev => {
            if (!prev) return prev;
            const set = new Set(prev.weekdays || EVERYDAY_WEEKDAYS);
            if (set.has(day)) set.delete(day);
            else set.add(day);
            const weekdays = set.size ? Array.from(set).sort((a, b) => a - b) : [...EVERYDAY_WEEKDAYS];
            return { ...prev, weekdays, updatedAt: Date.now() };
        });
    };

    const saveAlarmDraft = async () => {
        if (!char || !alarmDraft || alarmSaving) return;
        setAlarmSaving(true);
        try {
            const saved = prepareAlarmForSave({
                ...alarmDraft,
                charId: char.id,
                label: (alarmDraft.label || alarmKindLabel(alarmDraft.kind)).trim(),
            });
            await DB.saveChatAlarm(saved);
            setAlarmDraft(saved);
            await refreshChatAlarms(char.id);
            notifyChatAlarmsUpdated(char.id);
            const perm = getNotifyPermission();
            if (perm === 'default') void requestNotifyPermission();
            addToast(`${saved.label} 已设好`, 'success');
        } catch (e: any) {
            addToast(e?.message || '闹钟保存失败', 'error');
        } finally {
            setAlarmSaving(false);
        }
    };

    const toggleChatAlarmEnabled = async (alarm: ChatAlarm) => {
        try {
            const saved = prepareAlarmForSave({ ...alarm, enabled: !alarm.enabled });
            await DB.saveChatAlarm(saved);
            await refreshChatAlarms(saved.charId);
            notifyChatAlarmsUpdated(saved.charId);
            addToast(saved.enabled ? '闹钟已开启' : '闹钟已暂停', saved.enabled ? 'success' : 'info');
        } catch (e: any) {
            addToast(e?.message || '闹钟更新失败', 'error');
        }
    };

    const deleteChatAlarm = async (alarm: ChatAlarm) => {
        try {
            await DB.deleteChatAlarm(alarm.id);
            await refreshChatAlarms(alarm.charId);
            notifyChatAlarmsUpdated(alarm.charId);
            if (alarmDraft?.id === alarm.id) setAlarmDraft(makeAlarmDraftFor(alarm.kind));
            addToast('闹钟已删除', 'info');
        } catch (e: any) {
            addToast(e?.message || '闹钟删除失败', 'error');
        }
    };

    const formatAlarmNextAt = (alarm: ChatAlarm) => {
        if (!alarm.enabled || !alarm.nextAt) return '已暂停';
        return new Date(alarm.nextAt).toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        });
    };

    useEffect(() => {
        try { localStorage.setItem(PARALLEL_REPLY_ENABLED_KEY, parallelReplyEnabled ? 'true' : 'false'); } catch { /* ignore */ }
    }, [parallelReplyEnabled]);

    useEffect(() => {
        const liveIds = new Set(characters.map(c => c.id));
        let changed = false;
        const next = new Set<string>();
        parallelReplyTargetIds.forEach(id => {
            if (liveIds.has(id)) next.add(id);
            else changed = true;
        });
        if (changed) setParallelReplyTargetIds(next);
        try { localStorage.setItem(PARALLEL_REPLY_TARGETS_KEY, JSON.stringify(Array.from(changed ? next : parallelReplyTargetIds))); } catch { /* ignore */ }
    }, [characters, parallelReplyTargetIds]);

    const toggleParallelReplyTarget = (id: string) => {
        setParallelReplyTargetIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const runParallelRepliesForTargets = async (sourceChar: CharacterProfile, userText: string) => {
        const trimmed = userText.trim();
        if (!trimmed || !parallelReplyEnabled || parallelReplyTargets.length === 0) return;
        const replyApi = resolveAuxApi(auxApiConfig, apiConfig);
        if (!replyApi.baseUrl || !replyApi.apiKey || !replyApi.model) {
            addToast('并发回复需要先在「文具盒」配置 API', 'info');
            return;
        }

        const targets = parallelReplyTargets
            .filter(target => target.id !== sourceChar.id)
            .filter(target => !target.blacklisted && !target.charBlock?.active);
        if (!targets.length) return;

        const clearBusy = (targetId: string) => {
            setParallelReplyBusyIds(prev => {
                const next = new Set(prev);
                next.delete(targetId);
                return next;
            });
        };

        setParallelReplyBusyIds(prev => {
            const next = new Set(prev);
            targets.forEach(target => next.add(target.id));
            return next;
        });

        const fanoutMessageIds = new Map<string, number>();
        let fanoutFailCount = 0;
        const fanoutAt = Date.now();
        for (let i = 0; i < targets.length; i += 1) {
            const target = targets[i];
            try {
                const id = await DB.saveMessage({
                    charId: target.id,
                    role: 'user',
                    type: 'text',
                    content: trimmed,
                    timestamp: fanoutAt + i,
                    metadata: {
                        msgStatus: 'sent',
                        parallelReplyFanout: true,
                        sourceCharId: sourceChar.id,
                        sourceCharName: sourceChar.name,
                    },
                } as any);
                fanoutMessageIds.set(target.id, id);
            } catch (err) {
                fanoutFailCount += 1;
                clearBusy(target.id);
                console.warn('[ParallelReply] fanout failed:', target.name, err);
            }
        }

        const deliverableTargets = targets.filter(target => fanoutMessageIds.has(target.id));
        if (!deliverableTargets.length) {
            addToast('并发消息暂时没能送达其它私聊', 'error');
            return;
        }

        const runOneTargetReply = async (target: CharacterProfile): Promise<'sent' | 'empty'> => {
            const fanoutMessageId = fanoutMessageIds.get(target.id);
            try {
                const recentMessages = await DB.getRecentMessagesByCharId(target.id, target.contextLimit || 80);
                const recent = recentMessages
                    .slice(-24)
                    .map(m => formatMessageWithTime(m, target.name, userProfile.name || '我', formatTime))
                    .join('\n');
                const prompt = `${ContextBuilder.buildCoreContext(target, userProfile, true)}

${parallelReplyPromptBody({
                    userName: userProfile.name || '用户',
                    charName: target.name,
                    sourceCharName: sourceChar.name,
                    userText: trimmed,
                    recent,
                })}`;
                const data = await safeFetchJson(`${replyApi.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${replyApi.apiKey}` },
                    body: JSON.stringify({
                        model: replyApi.model,
                        messages: [{ role: 'user', content: prompt }],
                        temperature: 0.85,
                        max_tokens: 800,
                        stream: false,
                    }),
                }, 1, 45000, {
                    appId: AppID.Chat,
                    appName: '絮语',
                    charId: target.id,
                    charName: target.name,
                    purpose: '并发回复',
                    apiRole: isAuxApiOn(auxApiConfig) ? 'aux' : 'main',
                });
                const cleaned = ChatParser.sanitize((extractContent(data) || '').trim());
                if (!ChatParser.hasDisplayContent(cleaned)) return 'empty';
                const chunks = ChatParser.chunkTextByBubbleMode(cleaned, target.convoSettings?.bubbleStyleMode)
                    .map(chunk => ChatParser.sanitize(chunk).trim())
                    .filter(chunk => ChatParser.hasDisplayContent(chunk));
                if (!chunks.length) return 'empty';
                for (const chunk of chunks) {
                    await DB.saveMessage({
                        charId: target.id,
                        role: 'assistant',
                        type: 'text',
                        content: chunk,
                        metadata: {
                            parallelReply: true,
                            sourceCharId: sourceChar.id,
                            sourceCharName: sourceChar.name,
                            sourceUserText: trimmed.slice(0, 200),
                        },
                    } as any);
                }
                if (fanoutMessageId) await DB.setMessagesStatus([fanoutMessageId], 'read');
                window.dispatchEvent(new CustomEvent('proactive-message-sent', {
                    detail: {
                        charId: target.id,
                        charName: target.name,
                        body: chunks.join(' ').replace(/\s+/g, ' ').trim().slice(0, 120),
                        bodies: chunks.slice(0, 8),
                        count: chunks.length,
                        avatarUrl: target.avatar,
                    },
                }));
                return 'sent';
            } catch (err) {
                if (fanoutMessageId) await DB.setMessagesStatus([fanoutMessageId], 'failed');
                console.warn('[ParallelReply] failed:', target.name, err);
                throw err;
            } finally {
                clearBusy(target.id);
            }
        };

        const results: Array<PromiseSettledResult<'sent' | 'empty'>> = [];
        for (const target of deliverableTargets) {
            try {
                const value = await runOneTargetReply(target);
                results.push({ status: 'fulfilled', value });
            } catch (reason) {
                results.push({ status: 'rejected', reason });
            }
        }
        const okCount = results.filter(result => result.status === 'fulfilled' && result.value === 'sent').length;
        const failCount = fanoutFailCount + results.filter(result => result.status === 'rejected').length;

        if (okCount > 0) addToast(`并发回复已送达 ${okCount} 个私聊`, 'success');
        if (okCount === 0 && failCount > 0) addToast('并发回复暂时没生成出来', 'error');
    };

    // ── 正则脚本：全局脚本变更时刷新显示层（displayMessages 依赖 regexVersion 重算）──
    const [regexVersion, setRegexVersion] = useState(0);
    useEffect(() => {
        const bump = () => setRegexVersion(v => v + 1);
        window.addEventListener(REGEX_SCRIPTS_UPDATED_EVENT, bump);
        return () => window.removeEventListener(REGEX_SCRIPTS_UPDATED_EVENT, bump);
    }, []);

    // ── 拉黑状态（双向） ──
    const userBlockedChar = !!char?.blacklisted;      // 用户拉黑了角色
    const charBlockedUser = !!char?.charBlock?.active; // 角色拉黑了用户

    // 回到聊天界面（角色资料/朋友设置收起后）弹一次「已拉黑」提示
    useEffect(() => {
        if (!char) return;
        if (char.blacklisted && !showCharProfile && userBlockNoticeShownRef.current !== char.id) {
            userBlockNoticeShownRef.current = char.id;
            setShowUserBlockNotice(true);
        }
        if (!char.blacklisted && userBlockNoticeShownRef.current === char.id) {
            userBlockNoticeShownRef.current = null;
        }
    }, [char?.id, char?.blacklisted, showCharProfile]);

    // 从角色 App（朋友资料 → 设置朋友资料）返回时重新打开角色主页：
    // 返回键只回上一个页面，而不是直接落回聊天消息列表
    useEffect(() => {
        try {
            const target = localStorage.getItem('moro_chat_reopen_profile');
            if (!target) return;
            localStorage.removeItem('moro_chat_reopen_profile');
            if (target === activeCharacterId) setShowCharProfile(true);
        } catch { /* ignore */ }
    }, [activeCharacterId]);

    // ── 开场白选择（SillyTavern first_mes / alternate_greetings 移植）──
    // 空聊天 + 角色带开场白时，在消息区显示一条可左右切换的预览气泡；
    // 点「以这条开场白开始」或直接发第一条消息时，把当前选中的开场白
    // 作为 assistant 消息落库（宏在此刻按当前用户名替换）。
    const [greetingIdx, setGreetingIdx] = useState(0);
    // 首次加载完成前不显示选择器，避免角色切换瞬间（totalMsgCount 还是 0）闪一下
    const [historyLoaded, setHistoryLoaded] = useState(false);
    const greetingOptions = useMemo(() => {
        const opts = [char?.firstMes, ...(char?.alternateGreetings || [])];
        return opts.map(g => (g || '').trim()).filter(Boolean);
    }, [char?.firstMes, char?.alternateGreetings]);
    const greetingPickerActive = !!char && historyLoaded && totalMsgCount === 0 && messages.length === 0 && greetingOptions.length > 0;
    // handleSendText 经 useCallback 持有旧闭包，用 ref 取实时值
    const greetingPickerRef = useRef({ active: false, idx: 0 });
    greetingPickerRef.current = { active: greetingPickerActive, idx: greetingIdx };

    const clearMessageRevealTimers = useCallback(() => {
        revealTimersRef.current.forEach(timer => clearTimeout(timer));
        revealTimersRef.current = [];
    }, []);

    const markMessagePop = useCallback((msgId: number) => {
        setPoppingMessageIds(prev => {
            const next = new Set(prev);
            next.add(msgId);
            return next;
        });
        const timer = setTimeout(() => {
            setPoppingMessageIds(prev => {
                if (!prev.has(msgId)) return prev;
                const next = new Set(prev);
                next.delete(msgId);
                return next;
            });
        }, 900);
        revealTimersRef.current.push(timer);
    }, []);

    useEffect(() => () => clearMessageRevealTimers(), [clearMessageRevealTimers]);

    useEffect(() => {
        clearMessageRevealTimers();
        revealKnownIdsRef.current = new Set();
        revealHydratedRef.current = false;
        setRevealedAssistantIds(new Set());
        setPoppingMessageIds(new Set());
    }, [activeCharacterId, clearMessageRevealTimers]);

    useEffect(() => {
        const currentIds = new Set(messages.map(m => m.id));
        const currentAssistantIds = messages.filter(m => m.role === 'assistant').map(m => m.id);

        if (!historyLoaded || windowedFocusMsgId !== null || selectionMode) {
            clearMessageRevealTimers();
            revealKnownIdsRef.current = currentIds;
            revealHydratedRef.current = historyLoaded;
            setPoppingMessageIds(new Set());
            setRevealedAssistantIds(new Set(currentAssistantIds));
            return;
        }

        if (!revealHydratedRef.current) {
            revealKnownIdsRef.current = currentIds;
            revealHydratedRef.current = true;
            setPoppingMessageIds(new Set());
            setRevealedAssistantIds(new Set(currentAssistantIds));
            return;
        }

        const knownIds = revealKnownIdsRef.current;
        const maxKnownId = knownIds.size ? Math.max(...Array.from(knownIds)) : 0;
        const historyAssistantIds = new Set(
            messages
                .filter(m => m.role === 'assistant' && !knownIds.has(m.id) && m.id <= maxKnownId)
                .map(m => m.id)
        );
        const freshAssistantMessages = messages.filter(m => m.role === 'assistant' && !knownIds.has(m.id) && m.id > maxKnownId);
        revealKnownIdsRef.current = currentIds;

        setRevealedAssistantIds(prev => {
            const next = new Set<number>();
            currentAssistantIds.forEach(id => {
                if (prev.has(id) || historyAssistantIds.has(id)) next.add(id);
            });
            return next;
        });

        if (!freshAssistantMessages.length) return;

        let delay = 140;
        freshAssistantMessages.forEach(msg => {
            const timer = setTimeout(() => {
                setRevealedAssistantIds(prev => {
                    if (prev.has(msg.id)) return prev;
                    const next = new Set(prev);
                    next.add(msg.id);
                    return next;
                });
                markMessagePop(msg.id);
                if (!selectionMode && windowedFocusMsgId === null) {
                    requestAnimationFrame(() => {
                        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
                    });
                }
            }, delay);
            revealTimersRef.current.push(timer);
            const textLength = typeof msg.content === 'string' ? msg.content.length : 0;
            delay += Math.min(1250, 520 + Math.min(620, textLength * 7));
        });
    }, [messages, historyLoaded, windowedFocusMsgId, selectionMode, clearMessageRevealTimers, markMessagePop]);

    const greetingMacroCtx = { charName: char?.name || '角色', userName: (userProfile?.name || '').trim() || '用户' };

    const commitGreeting = async (): Promise<void> => {
        const { active, idx } = greetingPickerRef.current;
        const currentChar = charRef.current;
        if (!active || !currentChar) return;
        const opts = [currentChar.firstMes, ...(currentChar.alternateGreetings || [])]
            .map(g => (g || '').trim()).filter(Boolean);
        if (opts.length === 0) return;
        const chosen = opts[Math.min(idx, opts.length - 1)];
        const content = substituteMacros(chosen, {
            charName: currentChar.name || '角色',
            userName: (userProfile?.name || '').trim() || '用户',
        });
        await DB.saveMessage({
            charId: currentChar.id,
            role: 'assistant',
            type: 'text',
            content,
            metadata: { greeting: true, greetingIndex: Math.min(idx, opts.length - 1) },
        });
        greetingPickerRef.current = { active: false, idx: 0 };
    };
    const currentThemeId = char?.bubbleStyle || 'default';
    const activeTheme = useMemo(() => {
        const fallback = PRESET_THEMES.default;
        const found = customThemes.find(t => t.id === currentThemeId) || PRESET_THEMES[currentThemeId] || fallback;
        // Defensive: legacy/imported themes may be missing `user` or `ai`, which would
        // crash MessageItem when reading styleConfig.borderRadius. Fill from default.
        return {
            ...found,
            user: { ...fallback.user, ...(found.user || {}) },
            ai: { ...fallback.ai, ...(found.ai || {}) },
        };
    }, [currentThemeId, customThemes]);
    const draftKey = `chat_draft_${activeCharacterId}`;

    // Filter categories and emojis by active character's visibility (used for both AI prompt and UI)
    const visibleCategories = useMemo(() => categories.filter(cat => {
        if (!cat.allowedCharacterIds || cat.allowedCharacterIds.length === 0) return true;
        return cat.allowedCharacterIds.includes(activeCharacterId);
    }), [categories, activeCharacterId]);

    const aiVisibleEmojis = useMemo(() => {
        const hiddenIds = new Set(categories.filter(c => !visibleCategories.some(vc => vc.id === c.id)).map(c => c.id));
        if (hiddenIds.size === 0) return emojis;
        return emojis.filter(e => !e.categoryId || !hiddenIds.has(e.categoryId));
    }, [emojis, categories, visibleCategories]);




    // 小程序快照 ref: MiniApp 状态变化时塞进来, useChatAI 在 build system prompt 时读取并注入
    const mcdMiniAppRef = useRef<import('../utils/mcdToolBridge').McdMiniAppSnapshot | undefined>(undefined);

    // --- Initialize Hook ---
    const { isTyping, streamingText, recallStatus, searchStatus, diaryStatus, emotionStatus, memoryPalaceStatus, memoryPalaceResult, setMemoryPalaceResult, lastDigestResult, setLastDigestResult, lastTokenUsage, tokenBreakdown, setLastTokenUsage, triggerAI, startProactiveChat, stopProactiveChat, isProactiveActive } = useChatAI({
        char,
        userProfile,
        apiConfig,
        auxApiConfig,
        groups,
        emojis: aiVisibleEmojis,
        categories: visibleCategories,
        addToast,
        showError,
        setMessages,
        realtimeConfig,
        translationConfig: translationEnabled
            ? { enabled: true, sourceLang: translateSourceLang, targetLang: translateTargetLang, style: char?.convoSettings?.translateStyle }
            : undefined,
        memoryPalaceConfig,
        mcdMiniAppRef,
        updateCharacter,
    });

    // --- Voice TTS for chat messages ---
    interface VoiceData { url: string; originalText: string; spokenText?: string; lang?: string; }
    // Persisted shape (IndexedDB assets store). `blob` is the raw audio;
    // `remoteUrl` is the fallback when fetching the MiniMax CDN blob was blocked by CORS.
    interface StoredVoice { blob?: Blob; remoteUrl?: string; originalText: string; spokenText?: string; lang?: string; }
    const voiceAssetKey = (msgId: number) => `voice_msg_${msgId}`;
    const [voiceDataMap, setVoiceDataMap] = useState<Record<number, VoiceData>>({});
    const [voiceLoading, setVoiceLoading] = useState<Set<number>>(new Set());
    const [playingMsgId, setPlayingMsgId] = useState<number | null>(null);
    const chatAudioRef = useRef<HTMLAudioElement | null>(null);
    const prevIsTypingRef = useRef(false);
    // Track blob: URLs we created so we can revoke them on character switch / unmount.
    const voiceBlobUrlsRef = useRef<Set<string>>(new Set());
    // We warn the user at most once (per character) that MiniMax voice isn't configured —
    // a character can produce many <语音> messages and we don't want to spam toasts.
    const minimaxWarnedRef = useRef(false);

    /** Whether this character can synthesize real voice (MiniMax key + a voice profile). */
    const isMinimaxReady = useCallback(() => {
        const vp = char.voiceProfile;
        const hasVoiceProfile = !!(vp?.voiceId || (vp?.timberWeights && vp.timberWeights.length > 0));
        return hasVoiceProfile && !!resolveMiniMaxApiKey(apiConfig);
    }, [char, apiConfig]);

    const persistVoice = async (msgId: number, url: string, blob: Blob | null, originalText: string, spokenText: string | undefined, lang: string | undefined) => {
        try {
            const stored: StoredVoice = blob
                ? { blob, originalText, spokenText, lang }
                : { remoteUrl: url, originalText, spokenText, lang };
            await DB.saveAssetRaw(voiceAssetKey(msgId), stored);
        } catch (e) {
            console.warn('[Chat] persist voice failed', e);
        }
    };

    /** Drop in-memory + on-disk voice data for the given message ids. */
    const discardVoiceForMessages = (ids: Iterable<number>) => {
        const idList = Array.from(ids);
        if (!idList.length) return;
        setVoiceDataMap(prev => {
            let changed = false;
            const next = { ...prev };
            for (const id of idList) {
                const entry = next[id];
                if (!entry) continue;
                if (entry.url && entry.url.startsWith('blob:')) {
                    try { URL.revokeObjectURL(entry.url); } catch { /* ignore */ }
                    voiceBlobUrlsRef.current.delete(entry.url);
                }
                delete next[id];
                changed = true;
            }
            return changed ? next : prev;
        });
        // Best-effort: remove persisted entries so they don't reappear on next load.
        for (const id of idList) {
            DB.deleteAsset(voiceAssetKey(id)).catch(() => { /* ignore */ });
        }
    };

    const clearCharacterContextLocalState = (charId: string, opts?: { keepCouplePartner?: boolean }) => {
        try {
            const exact = new Set([
                `moro_last_autonomous_catchup_${charId}`,
                `instant_tool_status_${charId}`,
            ]);
            const jsonByCharIdKeys = [
                'moro_takeout_intent_v1',
                'proactive_schedules',
                'proactive_last_fire_map',
            ];
            const prefixes = [
                `moro_life_recap_seen_${charId}`,
                `moro_life_catchup_lock_${charId}`,
                `moro_proactive_last_${charId}`,
                `moro_proactive_next_${charId}`,
            ];
            const toRemove: string[] = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && (exact.has(key) || prefixes.some(p => key.startsWith(p)))) toRemove.push(key);
            }
            for (const key of toRemove) localStorage.removeItem(key);
            for (const key of jsonByCharIdKeys) {
                const raw = localStorage.getItem(key);
                if (!raw) continue;
                try {
                    const parsed = JSON.parse(raw);
                    if (parsed?.recipientCharId === charId) {
                        localStorage.removeItem(key);
                    } else if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed[charId] !== undefined) {
                        delete parsed[charId];
                        if (Object.keys(parsed).length > 0) localStorage.setItem(key, JSON.stringify(parsed));
                        else localStorage.removeItem(key);
                    }
                } catch { /* ignore malformed local state */ }
            }
            if (!opts?.keepCouplePartner && localStorage.getItem('moro_couple_partner_id') === charId) {
                localStorage.removeItem('moro_couple_partner_id');
            }
        } catch { /* ignore */ }
    };

    const handlePlayVoice = (msgId: number) => {
        const data = voiceDataMap[msgId];
        if (!data) {
            // No voice data yet — trigger TTS generation (e.g. placeholder voice bar clicked)
            const msg = messages.find(m => m.id === msgId);
            if (msg) handleManualTts(msg, false);
            return;
        }
        if (!chatAudioRef.current) chatAudioRef.current = new Audio();
        const audio = chatAudioRef.current;
        if (playingMsgId === msgId) {
            audio.pause();
            setPlayingMsgId(null);
            return;
        }
        audio.src = data.url;
        audio.onended = () => setPlayingMsgId(null);
        audio.play().catch(() => {});
        setPlayingMsgId(msgId);
    };

    // 稳定的播放回调：用 ref 持有最新闭包，引用永不变 —— 避免每条消息每次渲染都新建箭头函数，
    // 否则 MessageItem 的 React.memo 会被击穿（30 条重组件每次都全量重渲染 = 进入聊天卡顿主因之一）。
    const handlePlayVoiceRef = useRef(handlePlayVoice);
    handlePlayVoiceRef.current = handlePlayVoice;
    const onPlayVoiceStable = useCallback((id: number) => handlePlayVoiceRef.current(id), []);

    /** Extract <语音>...</语音> tag content from a message, if present */
    const extractVoiceTag = (content: string): string | null => {
        const match = content.match(/<[语語]音>([\s\S]*?)<\/[语語]音>/);
        return match ? match[1].trim() : null;
    };

    const handleManualTts = async (msg: Message, autoTriggered = false) => {
        if (voiceDataMap[msg.id] || voiceLoading.has(msg.id)) return;

        // Check if message contains a <语音> tag (AI chose to send voice)
        const voiceTagContent = extractVoiceTag(msg.content);

        // Auto-TTS: only generate voice when AI explicitly used <语音> tag
        if (autoTriggered && !voiceTagContent) return;

        // MiniMax not configured for this character: don't attempt synthesis (it would
        // throw and surface an error toast on every message / every tap). Instead remind
        // the user just once — the <语音> bubble still shows its 转文字 button so the
        // text stays readable, matching real voice messages.
        if (!isMinimaxReady()) {
            if (!autoTriggered && !minimaxWarnedRef.current) {
                minimaxWarnedRef.current = true;
                addToast('该角色未配置 MiniMax 语音，无法播放真实语音，可点「转文字」查看内容', 'info');
            }
            return;
        }

        setVoiceLoading(prev => new Set(prev).add(msg.id));
        try {
            let spokenText: string;
            let originalText: string;
            const voiceLang = char.chatVoiceLang || '';

            if (voiceTagContent) {
                // AI already provided the spoken text (possibly translated) in <语音> tag
                spokenText = cleanTextForTts(`<语音>${voiceTagContent}</语音>`);
                // originalText = text OUTSIDE the voice tag (the display/Chinese text)
                const textOutsideTag = msg.content.replace(/<[语語]音>[\s\S]*?<\/[语語]音>/g, '').trim();
                originalText = textOutsideTag ? cleanTextForTts(textOutsideTag) : '';
                // If voice lang is set and no Chinese text outside the tag, translate spoken text back to Chinese
                if (voiceLang && !originalText && spokenText) {
                    try {
                        const transApi = resolveAuxApi(auxApiConfig, apiConfig);
                        const transRes = await fetch(`${transApi.baseUrl}/chat/completions`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${transApi.apiKey}` },
                            body: JSON.stringify({
                                model: transApi.model,
                                messages: [{ role: 'system', content: '把以下内容翻译成中文。只输出翻译结果，不要任何解释。' }, { role: 'user', content: spokenText }],
                                temperature: 0.3,
                            }),
                        });
                        const transData = await transRes.json();
                        const chineseText = transData?.choices?.[0]?.message?.content?.trim();
                        if (chineseText) originalText = chineseText;
                    } catch { /* keep originalText empty */ }
                }
            } else {
                // Manual TTS (long-press): no <语音> tag.
                // Bilingual messages already contain both a target-language side (before
                // %%BILINGUAL%%) and a Chinese side (after). When the char's voice language
                // matches the message's target language we reuse those halves directly —
                // translating again would just echo the target language back and produce
                // two identical foreign-language lines in the expanded voice bar.
                const bilingualIdx = msg.content.toLowerCase().indexOf('%%bilingual%%');
                const hasBilingual = bilingualIdx !== -1;
                if (hasBilingual && voiceLang) {
                    const langAText = cleanTextForTts(msg.content.substring(0, bilingualIdx));
                    const langBText = cleanTextForTts(msg.content.substring(bilingualIdx + '%%BILINGUAL%%'.length));
                    if (!langAText || langAText.length < 2) return;
                    spokenText = langAText;
                    originalText = langBText || '';
                } else {
                    originalText = cleanTextForTts(msg.content);
                    if (!originalText || originalText.length < 2) return;
                    spokenText = originalText;
                    if (voiceLang) {
                        const langLabel = VOICE_LANG_LABELS[voiceLang] || voiceLang;
                        try {
                            const transApi = resolveAuxApi(auxApiConfig, apiConfig);
                            const transRes = await fetch(`${transApi.baseUrl}/chat/completions`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${transApi.apiKey}` },
                                body: JSON.stringify({
                                    model: transApi.model,
                                    messages: [{ role: 'system', content: `Translate the following text to ${langLabel}. Output ONLY the translation, nothing else.` }, { role: 'user', content: originalText }],
                                    temperature: 0.3,
                                }),
                            });
                            const transData = await transRes.json();
                            const translated = transData?.choices?.[0]?.message?.content?.trim();
                            if (translated) spokenText = translated;
                        } catch { /* use original */ }
                    }
                }
            }

            if (!spokenText || spokenText.length < 2) return;

            const { url: blobUrl, blob } = await synthesizeSpeechDetailed(spokenText, char, apiConfig, {
                languageBoost: voiceLang || undefined,
                groupId: apiConfig.minimaxGroupId || undefined,
            });
            if (blobUrl.startsWith('blob:')) voiceBlobUrlsRef.current.add(blobUrl);
            const storedSpokenText = voiceTagContent ? spokenText : (voiceLang ? spokenText : undefined);
            const storedLang = voiceLang || undefined;
            setVoiceDataMap(prev => ({ ...prev, [msg.id]: { url: blobUrl, originalText, spokenText: storedSpokenText, lang: storedLang } }));
            // Persist so the voice bar survives leaving and re-entering the chat.
            persistVoice(msg.id, blobUrl, blob, originalText, storedSpokenText, storedLang);
            // Auto-play
            if (!chatAudioRef.current) chatAudioRef.current = new Audio();
            chatAudioRef.current.src = blobUrl;
            chatAudioRef.current.onended = () => setPlayingMsgId(null);
            chatAudioRef.current.play().catch(() => {});
            setPlayingMsgId(msg.id);
        } catch (err: any) {
            addToast(`语音生成失败: ${err?.message || '未知错误'}`, 'error');
        } finally {
            setVoiceLoading(prev => { const next = new Set(prev); next.delete(msg.id); return next; });
        }
    };

    // --- Auto-TTS: when chatVoiceEnabled, auto-generate voice when AI uses <语音> tag ---
    // Scans ALL recent assistant messages (not just the last one) because chunkText
    // may split a single AI response into multiple messages, and the <语音> tag could
    // end up in any chunk — not necessarily the final one.
    useEffect(() => {
        const wasTyping = prevIsTypingRef.current;
        prevIsTypingRef.current = isTyping;
        // Only trigger when AI just finished typing (wasTyping → !isTyping)
        if (!wasTyping || isTyping) return;
        if (!char.chatVoiceEnabled) return;
        const voiceProfile = char.voiceProfile;
        if (!voiceProfile?.voiceId && (!voiceProfile?.timberWeights || voiceProfile.timberWeights.length === 0)) return;
        // Scan recent assistant messages for unprocessed <语音> tags
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            // Stop scanning once we hit a non-assistant message (end of current AI response batch)
            if (msg.role !== 'assistant') break;
            if (msg.type !== 'text') continue;
            if (voiceDataMap[msg.id] || voiceLoading.has(msg.id)) continue;
            handleManualTts(msg, true);
        }
    }, [isTyping]); // eslint-disable-line react-hooks/exhaustive-deps

    const canReroll = !isTyping && messages.length > 0 && messages[messages.length - 1].role === 'assistant';

    // --- Translation: pure frontend toggle (no API calls, bilingual data is already in message content) ---
    const handleTranslateToggle = useCallback((msgId: number) => {
        setShowingTargetIds(prev => {
            const next = new Set(prev);
            if (next.has(msgId)) next.delete(msgId);
            else next.add(msgId);
            return next;
        });
    }, []);

    const loadEmojiData = async () => {
        await DB.initializeEmojiData();
        const [es, cats] = await Promise.all([DB.getEmojis(), DB.getEmojiCategories()]);
        setEmojis(es);
        setCategories(cats);
        if (activeCategory !== 'default' && !cats.some(c => c.id === activeCategory)) {
            setActiveCategory('default');
        }
    };

    // Hydrate voice data from IndexedDB for currently visible messages.
    // Voice URLs are stored as blob: URLs that become invalid whenever the
    // component unmounts — persisting the raw blob and rebuilding the URL on
    // mount is what keeps previously-generated voice bars alive across
    // chat entries.
    useEffect(() => {
        if (!messages.length) return;
        const map = voiceDataMap;
        const toFetch = messages.filter(m => m.id && m.type === 'text' && m.role !== 'user' && !map[m.id]);
        if (!toFetch.length) return;
        let cancelled = false;
        (async () => {
            const updates: Record<number, VoiceData> = {};
            for (const m of toFetch) {
                try {
                    const stored = await DB.getAssetRaw(voiceAssetKey(m.id)) as StoredVoice | null;
                    if (!stored) continue;
                    let url: string | null = null;
                    if (stored.blob instanceof Blob) {
                        url = URL.createObjectURL(stored.blob);
                        voiceBlobUrlsRef.current.add(url);
                    } else if (stored.remoteUrl) {
                        url = stored.remoteUrl;
                    }
                    if (!url) continue;
                    updates[m.id] = { url, originalText: stored.originalText || '', spokenText: stored.spokenText, lang: stored.lang };
                } catch { /* ignore single-message hydration errors */ }
            }
            if (cancelled || !Object.keys(updates).length) return;
            setVoiceDataMap(prev => ({ ...updates, ...prev }));
        })();
        return () => { cancelled = true; };
    }, [messages]);

    // Revoke blob URLs when switching characters / unmounting to avoid leaks.
    useEffect(() => {
        // Reset the "MiniMax not configured" warning so each character gets one reminder.
        minimaxWarnedRef.current = false;
        const urls = voiceBlobUrlsRef.current;
        return () => {
            urls.forEach(u => { try { URL.revokeObjectURL(u); } catch { /* ignore */ } });
            urls.clear();
        };
    }, [activeCharacterId]);

    // How many messages to load per batch (initial load + each "load more" click)
    const LOAD_BATCH_SIZE = 30;

    const reloadMessages = useCallback(async (requestedVisibleCount: number) => {
        if (!activeCharacterId) return;

        const charIdAtStart = activeCharacterId;
        // 只用倒序游标取「最近 N 条」（含少量缓冲，抵消 date/call 消息被过滤后条数变少），
        // 不再 getAll 全量反序列化 —— 图片多/消息多的账号原本要把整段历史（含内联图片）一次性读进
        // 内存才显示 30 条，首次打开会卡好几秒。totalCount 走 index.count，不反序列化、极廉价。
        const fetchLimit = requestedVisibleCount >= 100000 ? requestedVisibleCount : requestedVisibleCount + 16;
        const applyResult = (recent: Message[], totalCount: number) => {
            // 不在视觉层过滤 hideBeforeMessageId —— 用户能往上滚回看，
            // 上下文截断仅作用于发给 LLM 的 prompt（在 chatPrompts.ts 里处理）。
            const chatScopeMsgs = recent
                .filter(m => m.metadata?.source !== 'date' && m.metadata?.source !== 'call');
            setTotalMsgCount(totalCount);
            setMessages(chatScopeMsgs.slice(-requestedVisibleCount));
            setHistoryLoaded(true);
        };
        try {
            const { messages: recent, totalCount } = await DB.getRecentMessagesWithCount(activeCharacterId, fetchLimit);
            // Guard against stale async results: if the user switched characters
            // while the DB query was in flight, discard this result.
            if (activeCharIdRef.current !== charIdAtStart) return;
            applyResult(recent, totalCount);
        } catch (e) {
            // DB read failed — retry once after a short delay
            if (activeCharIdRef.current !== charIdAtStart) return;
            await new Promise(r => setTimeout(r, 200));
            if (activeCharIdRef.current !== charIdAtStart) return;
            try {
                const { messages: recent, totalCount } = await DB.getRecentMessagesWithCount(activeCharacterId, fetchLimit);
                if (activeCharIdRef.current !== charIdAtStart) return;
                applyResult(recent, totalCount);
            } catch { /* give up silently */ }
        }
    }, [activeCharacterId]);

    useEffect(() => {
        if (activeCharacterId) {
            // Update ref BEFORE any async work so stale reloadMessages calls
            // from a previous character can detect the switch and bail out.
            activeCharIdRef.current = activeCharacterId;

            // Clear messages immediately to prevent showing stale chat from previous character
            setMessages([]);
            setTotalMsgCount(0);
            setHistoryLoaded(false);
            setGreetingIdx(0);
            // Reset voice map — stale blob: URLs from the previous char are revoked
            // by the cleanup effect and must not be reused against new messages.
            setVoiceDataMap({});
            setPlayingMsgId(null);
            if (chatAudioRef.current) { try { chatAudioRef.current.pause(); } catch { /* ignore */ } }

            reloadMessages(LOAD_BATCH_SIZE);
            loadEmojiData();
            const savedDraft = localStorage.getItem(draftKey);
            setInput(savedDraft || '');
            if (char) {
                setSettingsContextLimit(char.contextLimit || 500);
                setSettingsHtmlModeCustomPrompt((char as any).htmlModeCustomPrompt || '');
            }
            // Per-character translation toggle + language pair
            try {
                setTranslationEnabled(JSON.parse(localStorage.getItem(`chat_translate_enabled_${activeCharacterId}`) || 'false'));
            } catch { setTranslationEnabled(false); }
            setTranslateSourceLang(
                localStorage.getItem(`chat_translate_source_lang_${activeCharacterId}`)
                || localStorage.getItem('chat_translate_source_lang')
                || '日本語'
            );
            setTranslateTargetLang(
                localStorage.getItem(`chat_translate_lang_${activeCharacterId}`)
                || localStorage.getItem('chat_translate_lang')
                || '中文'
            );
            setVisibleCount(30);
            visibleCountRef.current = 30;
            lastMsgIdRef.current = null;
            scrollThrottleRef.current = 0;
            setLastTokenUsage(null);
            setReplyTarget(null);
            setSelectionMode(false);
            setSelectedMsgIds(new Set());
            setShowingTargetIds(new Set());
            setWindowedFocusMsgId(null);
            setFlashMsgId(null);
            try {
                const rawToolStatus = localStorage.getItem(`instant_tool_status_${activeCharacterId}`);
                const parsed = rawToolStatus ? JSON.parse(rawToolStatus) as InstantToolUiStatus : null;
                const fresh = parsed?.updatedAt && Date.now() - parsed.updatedAt < 2 * 60_000;
                setInstantToolStatus(fresh && parsed.phase !== 'done' ? parsed : null);
            } catch {
                setInstantToolStatus(null);
            }
        }
    }, [activeCharacterId, reloadMessages]);

    useEffect(() => {
        if (activeApp === AppID.Chat && activeCharacterId) {
            clearUnread(activeCharacterId);
        }
    }, [activeApp, activeCharacterId, clearUnread]);

    // 进入/切换角色时触发「登场」过场。useLayoutEffect 在浏览器绘制前置真，
    // 让过场层先盖住，避免一帧闪到新角色的空聊天界面。
    useLayoutEffect(() => {
        if (activeCharacterId) setShowEntry(true);
        setShowCharProfile(false); // 切角色时收起上一个角色的主页
    }, [activeCharacterId]);

    // 人设自动切换（SillyTavern 角色绑定 / 默认人设语义）：进入某个角色的聊天时，
    // 若该角色绑定了人设（或无绑定但设了默认人设）且与当前激活的不同，自动切换 ——
    // 名字/头像/描述写入档案，气泡与 prompt 全链路即时生效。
    useEffect(() => {
        if (!activeCharacterId) return;
        let cancelled = false;
        PersonaRuntime.resolveForConnection({ type: 'character', id: activeCharacterId }).then(persona => {
            if (cancelled || !persona) return;
            PersonaRuntime.setActiveId(persona.id);
            const updates: Partial<typeof userProfile> = { name: persona.name, bio: persona.description };
            if (persona.avatar) updates.avatar = persona.avatar;
            updateUserProfile(updates);
            addToast(`已切换人设：${persona.name}`, 'info');
        }).catch(() => { /* 人设解析失败不拦聊天 */ });
        return () => { cancelled = true; };
    }, [activeCharacterId]);

    useEffect(() => {
        let clearTimer: ReturnType<typeof setTimeout> | null = null;
        const handler = (e: Event) => {
            const detail = (e as CustomEvent<InstantToolUiStatus>).detail;
            if (!detail?.charId || detail.charId !== activeCharIdRef.current) return;

            setInstantToolStatus(detail);
            if (clearTimer) {
                clearTimeout(clearTimer);
                clearTimer = null;
            }
            if (detail.phase === 'done' || detail.phase === 'failed') {
                clearTimer = setTimeout(() => {
                    setInstantToolStatus((prev) => (
                        prev?.sessionId && detail.sessionId && prev.sessionId !== detail.sessionId ? prev : null
                    ));
                    clearTimer = null;
                }, detail.phase === 'failed' ? 8000 : 5000);
            }
        };
        const receivedHandler = (e: Event) => {
            const detail = (e as CustomEvent<{ charId?: string }>).detail;
            if (detail?.charId && detail.charId !== activeCharIdRef.current) return;
            try {
                const charId = detail?.charId || activeCharIdRef.current;
                if (charId) localStorage.removeItem(`instant_tool_status_${charId}`);
            } catch { /* ignore */ }
            setInstantToolStatus(null);
        };
        window.addEventListener('instant-tool-status', handler);
        window.addEventListener('active-msg-received', receivedHandler);
        return () => {
            window.removeEventListener('instant-tool-status', handler);
            window.removeEventListener('active-msg-received', receivedHandler);
            if (clearTimer) clearTimeout(clearTimer);
        };
    }, []);

    // Auto-generate daily schedule (fire-and-forget on chat load) + 今日作息每 24 小时自动更新一次
    // 总开关关闭时完全跳过：不查询 DB、不调用副 API、不跑兜底
    // 刷新策略：① 进聊天时若缓存作息已存在但 generatedAt 距今 ≥24h，自动重算；
    //          ② 未过期则按差额挂一个一次性定时器，聊天长开也能到点自动刷新。
    useEffect(() => {
        if (!char || !apiConfig.apiKey) return;
        if (!isScheduleFeatureOn(char)) {
            setScheduleData(null);
            return;
        }
        const SCHEDULE_TTL_MS = 24 * 60 * 60 * 1000;
        const targetChar = char;
        const today = new Date().toISOString().split('T')[0];
        let cancelled = false;
        let refreshTimer: ReturnType<typeof setTimeout> | null = null;
        DB.getDailySchedule(targetChar.id, today).then(existing => {
            if (cancelled) return;
            if (!existing) {
                // Generate in background, don't block chat
                generateDailySchedule(targetChar, false);
                return;
            }
            const age = Date.now() - (existing.generatedAt || 0);
            if (age >= SCHEDULE_TTL_MS) {
                // 距上次生成已满 24 小时：自动重算一份新作息（强制重生成）
                generateDailySchedule(targetChar, true);
            } else {
                setScheduleData(existing);
                // 聊天保持打开时，到 24 小时整点再自动刷新一次
                refreshTimer = setTimeout(() => {
                    if (!cancelled) generateDailySchedule(targetChar, true);
                }, SCHEDULE_TTL_MS - age);
            }
        }).catch(() => {});
        return () => {
            cancelled = true;
            if (refreshTimer) clearTimeout(refreshTimer);
        };
    }, [activeCharacterId, char?.scheduleFeatureEnabled]);

    // 日程锚点：聊天里出现约定/变更时，自动协调今天的日程（让 char 的日程既自治、又随聊天对齐）
    // 「主动调整日程」需开启副 API（用户预期：开副 API 才让 TA 后台跑这件杂活）。
    // 廉价信号闸（chatHasScheduleSignal）+ 每角色 8 分钟冷却，控制成本，不每轮都调。
    useEffect(() => {
        if (!char || !isScheduleFeatureOn(char)) return;
        if (!isAuxApiOn(auxApiConfig)) return;                 // 未开副 API：不主动协调（仍可手动看/生成日程）
        if (!scheduleData || isTyping) return;                 // 还没今日日程 / 回复进行中：先不打扰
        if (messages.length === 0 || !chatHasScheduleSignal(messages)) return;

        const lastMsgId = messages[messages.length - 1]?.id ?? 0;
        const sig = `${char.id}:${lastMsgId}`;
        if (lastReconcileSigRef.current === sig) return;       // 同一批消息不重复触发

        const COOLDOWN_MS = 8 * 60 * 1000;
        const key = `schedule_reconcile_at_${char.id}`;
        let last = 0;
        try { last = Number(localStorage.getItem(key) || '0'); } catch { /* ignore */ }
        if (Date.now() - last < COOLDOWN_MS) return;

        lastReconcileSigRef.current = sig;
        try { localStorage.setItem(key, String(Date.now())); } catch { /* ignore */ }

        const targetCharId = char.id;
        const curChar = char;
        const curSchedule = scheduleData;
        const auxApi = resolveAuxApi(auxApiConfig, apiConfig);
        let cancelled = false;
        (async () => {
            try {
                const recent = await DB.getRecentMessagesByCharId(targetCharId, 50);
                const updated = await reconcileScheduleWithChat(curChar, userProfile, curSchedule, recent, auxApi);
                if (!cancelled && updated) setScheduleData(updated);
            } catch (e) {
                console.warn('[Schedule/Reconcile] effect failed:', e);
            }
        })();
        return () => { cancelled = true; };
    }, [messages, char?.id, scheduleData?.id, isTyping, auxApiConfig]);

    // Load all messages when history-manager modal opens
    useEffect(() => {
        if (modalType === 'history-manager' && activeCharacterId) {
            DB.getMessagesByCharId(activeCharacterId, true).then(allMsgs => {
                const filtered = allMsgs
                    .filter(m => m.metadata?.source !== 'date' && m.metadata?.source !== 'call');
                setAllHistoryMessages(filtered);
            });
        }
    }, [modalType, activeCharacterId]);

    const refreshPrivateChatArchives = useCallback(async (charId = activeCharacterId) => {
        if (!charId) {
            setPrivateChatArchives([]);
            return [];
        }
        try {
            const rows = await DB.getPrivateChatArchives(charId);
            if (activeCharIdRef.current === charId) setPrivateChatArchives(rows);
            return rows;
        } catch (e) {
            console.warn('[Chat] load private chat archives failed', e);
            if (activeCharIdRef.current === charId) setPrivateChatArchives([]);
            return [];
        }
    }, [activeCharacterId]);

    useEffect(() => {
        refreshPrivateChatArchives(activeCharacterId);
    }, [activeCharacterId, refreshPrivateChatArchives]);

    useEffect(() => {
        const savedPrompts = localStorage.getItem('chat_archive_prompts');
        if (savedPrompts) {
            try {
                const parsed = JSON.parse(savedPrompts);
                const merged = [...DEFAULT_ARCHIVE_PROMPTS, ...parsed.filter((p: any) => !p.id.startsWith('preset_'))];
                setArchivePrompts(merged);
            } catch(e) {}
        }
        const savedId = localStorage.getItem('chat_active_archive_prompt_id');
        if (savedId && archivePrompts.some(p => p.id === savedId)) setSelectedPromptId(savedId);
    }, []);

    useEffect(() => {
        if (activeCharacterId && lastMsgTimestamp > 0) {
            reloadMessages(visibleCountRef.current);
            if (activeApp === AppID.Chat) {
                clearUnread(activeCharacterId);
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clearUnread is stable (useCallback with []), omit to prevent stale-dep lint noise
    }, [lastMsgTimestamp, activeCharacterId, activeApp, reloadMessages, clearUnread]);

    useEffect(() => {
        visibleCountRef.current = visibleCount;
    }, [visibleCount]);

    // （旧的"首次自动归档 banner"已移除，自动归档改为用户在神经链接里显式 opt-in）

    // buff 同步已上移到 OSContext 的 App 级 'emotion-updated' 监听 (无条件按事件 charId 更新内存,
    // 不再受"当前是否开着该角色聊天页"限制). 之前这里有个 `charId === activeCharacterId` 守卫的
    // handler, 导致 instant 模式下用户不在该角色页时 buff 回不到前端 (只落 DB), 故移除, 同时
    // 避免和 OSContext 双写.

    // 人格抢救（角色分析弹窗）已整体移除：进聊天不再自动跑认知风格检测，也不再弹窗。

    const handleInputChange = (val: string) => {
        setInput(val);
        if (val.trim()) localStorage.setItem(draftKey, val);
        else localStorage.removeItem(draftKey);
    };

    useLayoutEffect(() => {
        if (!scrollRef.current || selectionMode) return;
        const currentLastId = messages.length > 0 ? messages[messages.length - 1].id : null;
        // Only auto-scroll when a new message is appended (ID changes),
        // not when loading older history or updating existing messages in-place.
        // windowed 模式下用户在翻旧消息，不要被新消息打断滚走。
        if (currentLastId !== lastMsgIdRef.current) {
            if (windowedFocusMsgId === null) {
                scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            }
            lastMsgIdRef.current = currentLastId;
        }
    }, [messages, activeCharacterId, selectionMode, windowedFocusMsgId]);

    useEffect(() => {
        if (isTyping && scrollRef.current && !selectionMode && windowedFocusMsgId === null) {
            const now = Date.now();
            if (now - scrollThrottleRef.current > 150) {
                scrollThrottleRef.current = now;
                scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
            }
        }
    }, [messages, isTyping, streamingText, recallStatus, searchStatus, diaryStatus, selectionMode, windowedFocusMsgId]);

    const formatTime = (ts: number) => {
        return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    };

    // --- Actions ---

    const handleSendText = async (customContent?: string, customType?: MessageType, metadata?: any) => {
        if (!char || (!input.trim() && !customContent)) return;

        // 拉黑拦截：任意一方拉黑期间私聊都发不出去
        if (char.charBlock?.active) {
            addToast('你已被对方拉黑，消息无法送达', 'error');
            return;
        }
        if (char.blacklisted) {
            addToast(`你已将 ${char.name} 拉黑，无法发送消息`, 'error');
            return;
        }

        let text = customContent || input.trim();
        const type = customType || 'text';

        // 正则脚本（用户输入，改写消息原文）：全局 + 角色局部脚本中勾选「用户输入」
        // 且非仅显示/仅提示词的脚本在落库前生效（同 ST USER_INPUT placement）
        if (type === 'text' && text) {
            text = applyRegexToText(text, regex_placement.USER_INPUT, { char, userName: userProfile?.name });
        }

        // 发消息隐含"回到当前聊天"——退出 windowed 旧消息浏览模式
        if (windowedFocusMsgId !== null) {
            setWindowedFocusMsgId(null);
            setFlashMsgId(null);
        }

        // 用户手打"麦请求"三个字 → 等价于点击麦克风按钮 (拉起麦当劳菜单)
        // 不落库, 跟按钮点击行为完全一致, 避免出现"banner 在但菜单没拉起"的诡异状态
        if (!customContent && type === 'text' && text === MCD_ACTIVATE_TRIGGER) {
            setInput(''); localStorage.removeItem(draftKey);
            if (!isMcdConfigured()) {
                addToast('请先到 文具盒 → 麦当劳 启用并填入 MCP Token', 'info');
                return;
            }
            setMcdAppOpen(true);
            setShowPanel('none');
            return;
        }

        if (!customContent) { setInput(''); localStorage.removeItem(draftKey); }
        
        if (type === 'image') {
            const recentChat = messages.slice(-10).map(m => {
                const sender = m.role === 'user' ? userProfile.name : char.name;
                return `${sender}: ${m.content.substring(0, 100)}`;
            });
            await DB.saveGalleryImage({
                id: `img-${Date.now()}-${Math.random()}`,
                charId: char.id,
                url: text,
                timestamp: Date.now(),
                savedDate: new Date().toISOString().split('T')[0],
                chatContext: recentChat
            });
            addToast('图片已保存至相册', 'info');
        }

        // 开场白选择器还开着时直接发消息 = 以当前选中的开场白开场（同 ST：
        // 开场白本来就是聊天的第一条消息，用户回复即确认了当前 swipe 到的那条）
        if (greetingPickerRef.current.active) {
            try { await commitGreeting(); } catch (e) { console.warn('[Greeting] 开场白落库失败:', e); }
        }

        // Telegram 式回执：用户消息落库即「已发出」（单勾），角色回复成功后升级为「已读」（双勾）
        const msgPayload: any = {
            charId: char.id,
            role: 'user',
            type,
            content: text,
            metadata: { ...(metadata || {}), ...(type === 'image' ? { charAvatarCandidate: true } : {}), msgStatus: 'sent' },
        };

        if (replyTarget) {
            msgPayload.replyTo = {
                id: replyTarget.id,
                content: replyTarget.content,
                name: replyTarget.role === 'user' ? '我' : char.name
            };
            setReplyTarget(null);
        }

        const savedUserMsgId = await DB.saveMessage(msgPayload);

        // Detect XHS link in user text and create xhs_card via MCP
        if (type === 'text') {
            const xhsUrlMatch = text.match(/xiaohongshu\.com\/(?:discovery\/item|explore)\/([a-f0-9]{24})/);
            const mcpUrl = realtimeConfig?.xhsMcpConfig?.serverUrl;
            if (xhsUrlMatch && mcpUrl && realtimeConfig?.xhsMcpConfig?.enabled) {
                const noteUrl = `https://www.xiaohongshu.com/explore/${xhsUrlMatch[1]}`;
                try {
                    const result = await XhsMcpClient.getNoteDetail(mcpUrl, noteUrl);
                    if (result.success && result.data) {
                        const note = normalizeNote(result.data);
                        await DB.saveMessage({
                            charId: char.id,
                            role: 'user',
                            type: 'xhs_card',
                            content: note.title || '小红书笔记',
                            metadata: { xhsNote: note }
                        });
                    }
                } catch (e) {
                    console.warn('XHS link fetch via MCP failed:', e);
                }
            }
        }

        await reloadMessages(visibleCountRef.current);
        setShowPanel('none');

        if (!customContent && type === 'text') {
            void runParallelRepliesForTargets(char, text);
        }

        // Instant Push 模式：发完文本自动触发 AI（响应在 worker 端跑、后台 push 回写聊天页）。
        // 本地模式仍维持手动触发以保留现有 UX。triggerAI 内部会从 DB 拉完整历史，
        // 闭包里的 messages 还没包含刚写入的 user msg 也没关系。
        // 仅文本消息触发；image / xhs_card 等卡片消息不触发，与本地手动行为对齐。
        // autoTriggerOnSend gate：instant ready 也只在用户显式开启"发送后自动触发"时才自动回复，
        // 否则保留手动 ⚡（避免"启用 instant = 自动回复"的反直觉强绑定）。
        const instantCfg = loadInstantConfig();
        if (type === 'text' && isInstantConfigReady(instantCfg) && instantCfg.autoTriggerOnSend) {
            // 上一轮还在跑时直接跳过：triggerAI 内部会因 isTyping=true 静默 reject，
            // 提前 guard 避免点亮"准备中"指示灯后没人来清，UI 灯被卡住。
            if (isTyping) return;
            // 标记"准备中"三个点：拼接+发送期间显示，SSE POST 入队 (onInstantPosted) 后清除。
            setInstantSendingActive(true);
            triggerAI(messages, undefined, () => setInstantSendingActive(false));
        }
    };

    // 顶栏 ⚡ 手动触发。instant 模式下给"上一条 assistant 之后的所有 user 消息"打上"准备中"
    // 三个点（从写入 DB 到 SSE POST 入队之间），由 onInstantPosted 清除 ——
    // 与 autoTriggerOnSend 自动路径的指示器行为一致。本地模式无此指示器，直接 triggerAI。
    const handleManualTrigger = () => {
        // 拉黑期间不触发 AI 回复（双向都无法继续私聊）
        if (char && (char.blacklisted || char.charBlock?.active)) {
            addToast(char.charBlock?.active ? '你已被对方拉黑' : '你已将对方拉黑，无法继续私聊', 'error');
            return;
        }
        // 同上：上一轮还在跑时 triggerAI 会静默 reject，提前挡掉避免指示灯卡死。
        if (isTyping) return;
        if (!isInstantConfigReady()) { triggerAI(messages); return; }
        // instantSendingActive 驱动 header "发送中…" 徽章 (拼接+发送窗口). 消息上的三个小圆点
        // 另走纯前端判定 (isTyping && 最后一条消息), 见渲染处.
        setInstantSendingActive(true);
        triggerAI(messages, undefined, () => setInstantSendingActive(false));
    };

    const handleReroll = async () => {
        if (isTyping || messages.length === 0) return;

        const lastMsg = messages[messages.length - 1];
        if (lastMsg.role !== 'assistant') return;

        const toDeleteIds: number[] = [];
        let index = messages.length - 1;
        while (index >= 0 && messages[index].role === 'assistant') {
            toDeleteIds.push(messages[index].id);
            index--;
        }

        if (toDeleteIds.length === 0) return;

        await DB.deleteMessages(toDeleteIds);
        discardVoiceForMessages(toDeleteIds);
        const newHistory = messages.slice(0, index + 1);
        setMessages(newHistory);
        addToast('回溯对话中...', 'info');

        triggerAI(newHistory);
    };

    const handleImageSelect = async (file: File) => {
        try {
            const base64 = await processImage(file, { maxWidth: 600, quality: 0.6, forceJpeg: true });
            setShowPanel('none');
            await handleSendText(base64, 'image');
        } catch (err: any) {
            addToast(err.message || '图片处理失败', 'error');
        }
    };

    // 查岗·把翻到的内容塞进剧情：从 CheckPhone 里点「拿去对峙」时，关掉查岗浮层并以
    // 用户口吻把这条证据抛进聊天，触发角色当场解释 / 狡辩 / 评价（content 已在 CheckPhone 侧框好）。
    const handlePhoneConfront = (text: string) => {
        if (!text?.trim()) return;
        setShowCheckPhone(false);
        void handleSendText(text.trim(), 'text', { phoneConfront: true });
    };

    // ── 拉黑模式「看看 TA 在做什么」：用户仍无法私聊，但落一条引导 system 消息后
    //    触发角色生成此刻的动态（发现被拉黑的反应 / 把对话框当备忘录 / 试图挽回等，按人设）──
    const handlePeekBlockedChar = async () => {
        if (!char || isTyping) return;
        setShowUserBlockNotice(false);
        await DB.saveMessage({
            charId: char.id,
            role: 'system',
            type: 'text',
            content: `[拉黑观察] ${userProfile.name} 在拉黑「${char.name}」期间悄悄点开了对话框，想看看 TA 在做什么。请以「${char.name}」的身份生成 TA 此刻发出的消息：可能 TA 本想正常发消息却发现自己被拉黑、可能把这个发不出去的对话框当成备忘录/树洞自言自语、可能在尝试挽回、也可能赌气或装作无所谓——完全按 TA 的人设来。TA 并不知道 ${userProfile.name} 看得到这些。`,
            metadata: { blockPeek: true },
        } as any);
        await reloadMessages(visibleCountRef.current);
        triggerAI(messages);
    };

    // ── 收款流程：角色发来的转账 / 红包，点开卡片 → 弹窗让用户选择是否收下 ──
    const handleClaimRequest = useCallback((m: Message) => {
        const meta: any = m.metadata || {};
        const expired = meta.status === 'expired' || (typeof meta.expiresAt === 'number' && meta.status === 'pending' && Date.now() > meta.expiresAt);
        if (meta.status === 'claimed' || meta.status === 'declined' || expired) return;
        setClaimRevealed(false);
        setClaimTarget(m);
    }, []);

    const handleAcceptTransfer = async () => {
        const m = claimTarget;
        if (!m) return;
        const amt = Math.abs(parseFloat(String(m.metadata?.amount))) || 0;
        setClaimTarget(null);
        if (amt > 0) adjustUserBalance(+amt, {
            note: `${char?.name || '角色'}发来的${m.metadata?.kind === 'redpacket' ? '红包' : '转账'}`,
            category: 'transfer',
            kind: m.metadata?.kind === 'redpacket' ? 'chat-redpacket-in' : 'chat-transfer-in',
            sourceApp: '聊天',
            sourceId: m.id != null ? String(m.id) : char?.id,
            relatedEntityId: char?.id,
            createdBy: 'character',
        }); // 收到的钱进入用户钱包余额
        await DB.updateMessageMetadata(m.id, (prev: any) => ({ ...(prev || {}), status: 'claimed', claimedAt: Date.now() }));
        await reloadMessages(visibleCountRef.current);
        addToast(`收下了 ¥${Math.round(amt)} · 已进入钱包`, 'success');
    };

    const handleDeclineTransfer = async () => {
        const m = claimTarget;
        if (!m) return;
        setClaimTarget(null);
        await DB.updateMessageMetadata(m.id, (prev: any) => ({ ...(prev || {}), status: 'declined', declinedAt: Date.now() }));
        await reloadMessages(visibleCountRef.current);
        addToast('没有收下', 'info');
    };

    // ── 外卖订单小票：点开看具体内容（载入实时订单） ──
    const handleOpenTakeoutCard = useCallback(async (m: Message) => {
        setTakeoutCardTarget(m);
        setTakeoutCardOrder(null);
        const oid = m.metadata?.takeoutOrderId || m.metadata?.takeout?.takeoutOrderId;
        if (oid) {
            try {
                const all = await DB.getTakeoutOrders();
                setTakeoutCardOrder(all.find(o => o.id === oid) || null);
            } catch { /* ignore */ }
        }
    }, []);

    // ── 求婚 / 订婚 ──
    const finalizeEngagement = async (proposalBy: 'user' | 'char', vow: string) => {
        if (!char) return;
        // 用本地日期（与情侣空间 todayYmd / loveDays 的本地解析口径一致）。toISOString() 取的是 UTC
        // 日期，在负时区深夜订婚会比本地日期早/晚一天，导致相恋天数 / 婚期倒计时 off-by-one。
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const rel = buildRelationshipState(char.relationship, 'engaged', STAGE_DEFAULT_LABEL.engaged, '求婚成功');
        const marriage = createMarriageState(proposalBy, proposalBy === 'user' ? (userProfile.name || '我') : char.name);
        updateCharacter(char.id, { relationship: rel, marriage, affection: 100 });
        try { await DB.saveAnniversary({ id: `engage-${char.id}`, title: `和 ${char.name} 订婚`, date: today, charId: char.id } as any); } catch { /* ignore */ }
        try { await DB.saveCalendarMark({ id: `engage-${char.id}-${Date.now().toString(36)}`, date: today, text: `💍 和 ${char.name} 订婚了`, author: 'user', charId: char.id, emoji: '💍', createdAt: Date.now() } as any); } catch { /* ignore */ }
        void vow;
    };

    // 角色对「用户求婚」的决定（专用一次性调用，不走常规对话管线）
    const decideCharProposal = async (vow: string): Promise<{ accept: boolean; reply: string }> => {
        const fallback = { accept: true, reply: `我愿意……${userProfile.name || '你'}，我愿意和你在一起。` };
        if (!char || !apiConfig.baseUrl || !apiConfig.apiKey) return fallback;
        try {
            const context = ContextBuilder.buildCoreContext(char, userProfile, true);
            const allMsgs = await DB.getMessagesByCharId(char.id);
            const recent = allMsgs.slice(-24).map(m => formatMessageWithTime(m, char.name, userProfile.name, formatTime)).join('\n');
            const prompt = `${context}

### [最近的对话]
${recent || '（你们相处了很久）'}

### [Task: 回应求婚]
此刻，${userProfile.name || '对方'} 向你求婚了，对你说："${vow}"
你对 ${userProfile.name || '对方'} 已满怀深情（好感已满）。是否答应仍取决于你的人设、价值观与你们的剧情——深爱时通常会答应；但若你的人设确有顾虑（还没准备好 / 现实阻碍 / 性格使然），也可以婉拒。请以「${char.name}」第一人称真实地回应。

只输出一个 JSON（不要 markdown 代码块、不要多余解释）：
{"accept": true 或 false, "reply": "你此刻对 ${userProfile.name || '对方'} 说的话（30-120字，带情绪与动作）"}`;
            const res = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify({ model: apiConfig.model, messages: [{ role: 'user', content: prompt }], temperature: 0.9 }),
            });
            if (!res.ok) throw new Error();
            const data = await safeResponseJson(res);
            const content = (extractContent(data) || '').trim();
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                const reply = typeof parsed.reply === 'string' && parsed.reply.trim() ? parsed.reply.trim() : fallback.reply;
                return { accept: parsed.accept !== false, reply };
            }
            return { accept: true, reply: content || fallback.reply };
        } catch {
            return fallback;
        }
    };

    // 用户主动求婚：生成求婚小卡 → 打开浪漫界面 → 角色给出回应
    const sendUserProposal = async () => {
        if (!char) return;
        if (!canProposeNow(char)) { addToast('还没到能求婚的时候哦（需满好感且感情到位）', 'info'); return; }
        const vow = proposeVow.trim() || `${char.name}，愿意和我一直走下去，步入婚姻吗？`;
        setShowProposeCompose(false);
        setProposeVow('');
        const meta = { proposal: { from: 'user', vow, status: 'pending', at: Date.now() } };
        const id = await DB.saveMessage({ charId: char.id, role: 'user', type: 'proposal_card', content: '[求婚]', metadata: meta } as any);
        await reloadMessages(visibleCountRef.current);
        const saved = { id, charId: char.id, role: 'user', type: 'proposal_card', content: '[求婚]', timestamp: Date.now(), metadata: meta } as Message;
        setProposalTarget(saved);
        setProposalBusy(true);
        try {
            const decision = await decideCharProposal(vow);
            const status = decision.accept ? 'accepted' : 'declined';
            const newMeta = { proposal: { ...meta.proposal, status, reply: decision.reply } };
            await DB.updateMessageMetadata(id, (prev: any) => ({ ...(prev || {}), proposal: { ...(prev?.proposal || {}), status, reply: decision.reply } }));
            if (decision.reply) await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'text', content: decision.reply } as any);
            if (decision.accept) await finalizeEngagement('user', vow);
            await reloadMessages(visibleCountRef.current);
            setProposalTarget({ ...saved, metadata: newMeta });
        } catch {
            addToast('求婚没能送出去…再试一次', 'error');
        } finally {
            setProposalBusy(false);
        }
    };

    const handleOpenProposal = useCallback((m: Message) => {
        setProposalTarget(m);
    }, []);

    // 用户回应「角色的求婚」
    const respondToCharProposal = async (accept: boolean) => {
        const m = proposalTarget;
        if (!m || !char) return;
        const vow = m.metadata?.proposal?.vow || '';
        setProposalBusy(true);
        try {
            const status = accept ? 'accepted' : 'declined';
            await DB.updateMessageMetadata(m.id, (prev: any) => ({ ...(prev || {}), proposal: { ...(prev?.proposal || {}), status } }));
            if (accept) await finalizeEngagement('char', vow);
            const hint = proposalResultHint(userProfile.name || '对方', accept);
            await DB.saveMessage({ charId: char.id, role: 'user', type: 'text', content: hint, metadata: { proactiveHint: true, hidden: true } } as any);
            await reloadMessages(visibleCountRef.current);
            setProposalTarget({ ...m, metadata: { ...(m.metadata || {}), proposal: { ...(m.metadata?.proposal || {}), status } } });
            void triggerAI(messages);
        } finally {
            setProposalBusy(false);
        }
    };

    // ── 过期检测：进入聊天时扫描角色发来、超过 24h 未领的转账 / 红包 →
    //    标记 expired，并落一条 system 提示让角色对「钱没被领」做出反应（角色会有反应）──
    const expiryScanLockRef = useRef(false);
    useEffect(() => {
        if (!char || isTyping || expiryScanLockRef.current) return;
        if (char.charBlock?.active || char.blacklisted) return;
        if (!apiConfig?.apiKey || !apiConfig?.baseUrl) return; // 没配 API 时只靠 UI 时间判定显示「已过期」，反应延后到配好后再触发
        const now = Date.now();
        const expired = messages.filter(m =>
            m.role === 'assistant' && m.type === 'transfer' &&
            m.metadata?.status === 'pending' &&
            typeof m.metadata?.expiresAt === 'number' && now > m.metadata.expiresAt
        );
        if (expired.length === 0) return;
        expiryScanLockRef.current = true;
        (async () => {
            try {
                for (const m of expired) {
                    await DB.updateMessageMetadata(m.id, (prev: any) => ({ ...(prev || {}), status: 'expired' }));
                }
                const summary = expired.map(m => `${m.metadata?.kind === 'redpacket' ? '红包' : '转账'}（¥${m.metadata?.amount}）`).join('、');
                await DB.saveMessage({
                    charId: char.id,
                    role: 'system',
                    type: 'text',
                    content: `[红包过期] 你之前发给 ${userProfile.name} 的${summary}，超过 24 小时一直没被领取，已经自动退回、过期了。请以「${char.name}」的身份，按你的人设对「钱没被收下」这件事做出自然反应（失落、打趣、关心 TA 是不是没看到、赌气或装作无所谓都行），不要复述本提示。`,
                    metadata: { transferExpired: true },
                } as any);
                await reloadMessages(visibleCountRef.current);
                triggerAI(messages);
            } finally {
                expiryScanLockRef.current = false;
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messages, char, isTyping]);

    // ── 角色主动查用户手机：「允许 char 看手机」开启时，AI 回复落定后小概率发起（带冷却）──
    const CHAR_PHONE_CHECK_COOLDOWN_MS = 6 * 60 * 60 * 1000;
    const phoneCheckPrevTypingRef = useRef(false);
    useEffect(() => {
        const wasTyping = phoneCheckPrevTypingRef.current;
        phoneCheckPrevTypingRef.current = isTyping;
        if (!wasTyping || isTyping) return; // 仅在 AI 刚回复完的下降沿判定
        if (!char?.convoSettings?.allowPhoneBrowse) return; // 设置关闭则角色绝不发起
        if (charPhoneCheckActive || showOfflineMode || showCheckPhone || showCharProfile) return;
        if (char.blacklisted || char.charBlock?.active) return;
        if (!apiConfig?.apiKey || !apiConfig?.baseUrl) return;
        const cooldownKey = `moro_char_phone_check_last_${char.id}`;
        let last = 0;
        try { last = Number(localStorage.getItem(cooldownKey) || 0); } catch { /* ignore */ }
        if (Date.now() - last < CHAR_PHONE_CHECK_COOLDOWN_MS) return;
        if (Math.random() > 0.15) return;
        try { localStorage.setItem(cooldownKey, String(Date.now())); } catch { /* ignore */ }
        const timer = setTimeout(() => setCharPhoneCheckActive(true), 1500);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isTyping]);

    // 查岗结束：记录已由覆盖层落库进上下文，这里刷新消息并让角色主动发消息收尾
    const handleCharPhoneCheckEnd = (exitMode: 'consent' | 'questions' | 'forced' | 'finished') => {
        setCharPhoneCheckActive(false);
        // 查岗刚结束：刷新冷却时间戳，避免下一轮（概率路径或残留指令）立刻又发起查岗。
        try { if (char?.id) localStorage.setItem(`moro_char_phone_check_last_${char.id}`, String(Date.now())); } catch { /* ignore */ }
        void reloadMessages(visibleCountRef.current);
        addToast(exitMode === 'forced' ? `你抢回了手机，${char?.name} 好像有话要说…` : `${char?.name} 把手机还给了你`, 'info');
        setTimeout(() => { triggerAI(messages); }, 800);
    };

    // ── 线下模式：监听 [[OFFLINE_START]] 广播（applyAssistantPostProcessing 剥离指令后发出）──
    useEffect(() => {
        const handler = (e: Event) => {
            const d = (e as CustomEvent).detail as { charId?: string };
            if (!d?.charId || d.charId !== activeCharIdRef.current) return;
            consumeOfflinePending(d.charId); // 事件路径直接弹，吃掉 pending 防止下次重复弹
            setShowOfflineMode(true);
        };
        window.addEventListener(OFFLINE_START_EVENT, handler);
        return () => window.removeEventListener(OFFLINE_START_EVENT, handler);
    }, []);

    // ── 角色查用户手机：监听 [[CHECK_PHONE]] 广播（系统命令指示角色发起，
    //    applyAssistantPostProcessing 剥离指令后发出）──
    useEffect(() => {
        const handler = (e: Event) => {
            const d = (e as CustomEvent).detail as { charId?: string };
            if (!d?.charId || d.charId !== activeCharIdRef.current) return;
            consumePhoneCheckPending(d.charId); // 事件路径直接弹，吃掉 pending 防止下次重复弹
            setCharPhoneCheckActive(true);
        };
        window.addEventListener(CHAR_PHONE_CHECK_EVENT, handler);
        return () => window.removeEventListener(CHAR_PHONE_CHECK_EVENT, handler);
    }, []);

    // ── 角色撤回自己上一条消息：监听 [[WITHDRAW]] 广播，把该角色最近一条未撤回的 assistant
    //    消息标为已撤回（原文留 metadata.recalledContent 供用户点提示偷看）。事件在本轮回复
    //    落库前发出，setMessages(prev=>) 拿到的 prev 即"撤回前"列表，末尾 assistant = 角色上一句。──
    useEffect(() => {
        const handler = (e: Event) => {
            const d = (e as CustomEvent).detail as { charId?: string };
            if (!d?.charId || d.charId !== activeCharIdRef.current) return;
            setMessages(prev => {
                for (let i = prev.length - 1; i >= 0; i--) {
                    const mm = prev[i];
                    if (mm.role === 'assistant' && mm.type !== 'system' && !mm.metadata?.recalled
                        && typeof mm.content === 'string' && mm.content.trim()) {
                        const original = mm.content;
                        const recalledAt = Date.now();
                        void DB.updateMessageMetadata(mm.id, (p: any) => ({ ...(p || {}), recalled: true, recalledContent: original, recalledAt }));
                        return prev.map((x, j) => j === i
                            ? { ...x, metadata: { ...(x.metadata || {}), recalled: true, recalledContent: original, recalledAt } }
                            : x);
                    }
                }
                return prev;
            });
        };
        window.addEventListener(CHAR_WITHDRAW_EVENT, handler);
        return () => window.removeEventListener(CHAR_WITHDRAW_EVENT, handler);
    }, []);

    // ── 角色给用户消息贴表情：监听 [[REACT: 表情]] 广播，把该表情加到用户最近一条消息上。──
    useEffect(() => {
        const handler = (e: Event) => {
            const d = (e as CustomEvent).detail as { charId?: string; emoji?: string };
            if (!d?.charId || d.charId !== activeCharIdRef.current || !d.emoji) return;
            setMessages(prev => {
                for (let i = prev.length - 1; i >= 0; i--) {
                    const mm = prev[i];
                    if (mm.role === 'user' && mm.type !== 'system') {
                        const next = toggleReaction(mm.metadata?.reactions, d.emoji!, d.charId!);
                        void DB.updateMessageMetadata(mm.id, (p: any) => ({ ...(p || {}), reactions: next }));
                        return prev.map((x, j) => j === i ? { ...x, metadata: { ...(x.metadata || {}), reactions: next } } : x);
                    }
                }
                return prev;
            });
        };
        window.addEventListener(CHAR_REACT_EVENT, handler);
        return () => window.removeEventListener(CHAR_REACT_EVENT, handler);
    }, []);

    // ── 角色拍用户：监听 [[PAT]] 广播，落一条 interaction 消息「角色 拍了拍 你 的<用户后缀>」。──
    useEffect(() => {
        const handler = (e: Event) => {
            const d = (e as CustomEvent).detail as { charId?: string };
            if (!d?.charId || d.charId !== activeCharIdRef.current) return;
            const suffix = userProfile.patSuffix || DEFAULT_PAT_SUFFIX;
            void (async () => {
                await DB.saveMessage({ charId: d.charId!, role: 'assistant', type: 'interaction', content: `[拍了拍 ${userProfile.name || '你'}]`, metadata: { patSuffix: suffix } } as any);
                reloadMessages(visibleCountRef.current);
            })();
        };
        window.addEventListener(CHAR_PAT_EVENT, handler);
        return () => window.removeEventListener(CHAR_PAT_EVENT, handler);
    }, [userProfile, reloadMessages]);

    // ── 角色给用户换备注：监听 [[SET_USER_REMARK]] 广播，弹「换备注」弹窗（点开看动机）──
    useEffect(() => {
        const handler = (e: Event) => {
            const d = (e as CustomEvent).detail as Partial<UserRemarkEventDetail>;
            if (!d?.charId || d.charId !== activeCharIdRef.current || !d.remark) return;
            setRemarkMotivationOpen(false);
            setRemarkChangeNotice({ remark: d.remark, motivation: d.motivation });
        };
        window.addEventListener(CHAR_USER_REMARK_EVENT, handler);
        return () => window.removeEventListener(CHAR_USER_REMARK_EVENT, handler);
    }, []);

    // ── 角色自主把用户刚发的图片设为自己的头像：[[SET_CHAR_AVATAR_FROM_LAST_IMAGE]] ──
    useEffect(() => {
        const handler = (e: Event) => {
            const d = (e as CustomEvent).detail as Partial<CharAvatarEventDetail>;
            if (!d?.charId || d.charId !== activeCharIdRef.current) return;
            void (async () => {
                try {
                    const liveChar = charRef.current;
                    if (!liveChar?.convoSettings?.allowCharAvatarFromUserImage) return;
                    const recent = await DB.getRecentMessagesByCharId(d.charId!, 80);
                    const target = [...recent].reverse().find(m =>
                        m.role === 'user' &&
                        m.type === 'image' &&
                        typeof m.content === 'string' &&
                        (m.metadata?.charAvatarCandidate || isImageUrlLike(m.content))
                    );
                    if (!target) {
                        addToast('没找到刚才那张头像候选图', 'info');
                        return;
                    }
                    const reason = d.reason?.trim();
                    await updateCharacter(d.charId!, {
                        avatar: target.content,
                        convoSettings: {
                            ...(liveChar.convoSettings || {}),
                            charAvatarOverride: target.content,
                        },
                    });
                    await DB.saveMessage({
                        charId: d.charId!,
                        role: 'system',
                        type: 'text',
                        content: `「${liveChar?.name || 'TA'}」把你刚发的图片设成了自己的头像${reason ? `：${reason}` : ''}`,
                        metadata: { charAvatarChanged: true, sourceMessageId: target.id, reason },
                    } as any);
                    await reloadMessages(visibleCountRef.current);
                    addToast(`${liveChar?.name || 'TA'} 换上了自己的新头像`, 'success');
                } catch (err) {
                    console.warn('[Chat] set char avatar from image failed', err);
                    addToast('头像更换失败', 'error');
                }
            })();
        };
        window.addEventListener(CHAR_AVATAR_FROM_USER_IMAGE_EVENT, handler);
        return () => window.removeEventListener(CHAR_AVATAR_FROM_USER_IMAGE_EVENT, handler);
    }, [addToast, reloadMessages, updateCharacter]);

    // 进入/切换角色时兜底：有 pending（事件发出时不在本聊天页）或未结束的线下会话则恢复弹窗
    useEffect(() => {
        if (!activeCharacterId) return;
        if (consumeOfflinePending(activeCharacterId) || hasOfflineSession(activeCharacterId)) {
            setShowOfflineMode(true);
        } else {
            setShowOfflineMode(false);
        }
        setShowCheckPhone(false);
        // 查岗 pending 兜底：系统命令触发时用户不在本聊天页的情况
        setCharPhoneCheckActive(consumePhoneCheckPending(activeCharacterId));
    }, [activeCharacterId]);

    // 线下模式结束：情景已合成 system 消息落库，刷新后让角色主动发消息收尾
    const handleOfflineEnd = () => {
        setShowOfflineMode(false);
        void reloadMessages(visibleCountRef.current);
        addToast('线下模式已结束，回到线上聊天', 'info');
        setTimeout(() => { triggerAI(messages); }, 800);
    };

    // ── 已读回执：聊天页打开着时实时翻转双勾（Telegram 式）──
    //  · 角色消息：用户正在看 → 标记为已读（清未读态）。
    //  · 用户消息：其后只要出现过角色消息（= 角色已回复 = 已读），就把「已发出」升级为
    //    「已读」。这一步覆盖所有回复路径——并发回复(useChatAI)、后台 instant push、主动
    //    消息——保证不论角色的回复怎么来的，打开着的聊天页里用户消息的双勾都实时翻转，
    //    而不是只在本端 useChatAI 走完同步流程时才更新。
    useEffect(() => {
        if (!char) return;
        const assistantUnread = messages.filter(m => m.role === 'assistant' && !m.groupId && m.metadata?.msgStatus !== 'read');
        let lastAssistantIdx = -1;
        for (let i = messages.length - 1; i >= 0; i--) {
            const mm = messages[i];
            if (mm.role === 'assistant' && !mm.groupId) { lastAssistantIdx = i; break; }
        }
        // 仅升级「排在最后一条角色消息之前、状态为 sent」的用户消息（之后新发的待回复消息不动）
        const userToRead = lastAssistantIdx < 0 ? [] : messages
            .slice(0, lastAssistantIdx)
            .filter(m => m.role === 'user' && !m.groupId && m.metadata?.msgStatus === 'sent');
        if (assistantUnread.length === 0 && userToRead.length === 0) return;
        const idSet = new Set<number>([...assistantUnread.map(m => m.id), ...userToRead.map(m => m.id)]);
        let cancelled = false;
        void (async () => {
            try {
                await DB.setMessagesStatus([...idSet], 'read');
                if (cancelled) return;
                setMessages(prev => prev.map(m => idSet.has(m.id)
                    ? { ...m, metadata: { ...(m.metadata || {}), msgStatus: 'read' } }
                    : m));
            } catch { /* 回执写入失败不影响消息本体 */ }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messages, char?.id]);

    // ── 解除拉黑申诉：角色被拉黑后发来求解封验证消息，用户在此同意 / 拒绝 ──
    const acceptUnblockAppeal = async (msgId: number) => {
        if (!char) return;
        const now = Date.now();
        await DB.updateMessageMetadata(msgId, (prev: any) => ({ ...(prev || {}), unblockAppeal: { ...(prev?.unblockAppeal || {}), status: 'accepted' } }));
        await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `你同意了「${char.name}」的解除拉黑申请，你们可以继续聊天了`, timestamp: now });
        await updateCharacter(char.id, {
            blacklisted: false, blacklistedAt: undefined,
            unblockAppeal: { active: false, awaiting: false, nextAt: 0, rejectedCount: char.unblockAppeal?.rejectedCount || 0 },
        });
        addToast(`已解除对 ${char.name} 的拉黑`, 'success');
        await reloadMessages(visibleCountRef.current);
    };
    const rejectUnblockAppeal = async (msgId: number) => {
        if (!char) return;
        const rejectedCount = (char.unblockAppeal?.rejectedCount || 0) + 1;
        await DB.updateMessageMetadata(msgId, (prev: any) => ({ ...(prev || {}), unblockAppeal: { ...(prev?.unblockAppeal || {}), status: 'rejected' } }));
        // 拒绝 → 解除 awaiting、排下一次申诉时间，角色到点会再发，直到用户同意
        await updateCharacter(char.id, {
            unblockAppeal: { active: true, awaiting: false, rejectedCount, nextAt: Date.now() + nextAppealDelayMs(rejectedCount) },
        });
        addToast('已拒绝。对方可能过会儿还会再来申请', 'info');
        await reloadMessages(visibleCountRef.current);
    };

    // ── 语音通话：用户主动拨打 → 角色按人设 + 当前剧情决定接不接 → 接通则跳转电话 App ──
    const startVoiceCall = async () => {
        if (!char) return;
        if (char.blacklisted || char.charBlock?.active) {
            addToast(char.charBlock?.active ? '你已被对方拉黑，无法拨打' : '你已将对方拉黑，无法拨打', 'error');
            return;
        }
        // 来电「接不接」是聊天以外的辅助决策 → 走副 API（未配置时回退主 API）
        const callApi = resolveAuxApi(auxApiConfig, apiConfig);
        if (!callApi.baseUrl || !callApi.apiKey) { addToast('请先在「文具盒」里配置 API', 'error'); return; }
        setShowPanel('none');
        voiceCallCancelRef.current = false;
        setVoiceCallPhase('dialing');
        try {
            const context = ContextBuilder.buildCoreContext(char, userProfile, true);
            const allMsgs = await DB.getMessagesByCharId(char.id);
            const recent = allMsgs.slice(-30).map(m => formatMessageWithTime(m, char.name, userProfile.name, formatTime)).join('\n');
            const prompt = `${context}

### [最近的对话]
${recent || '（你们还没怎么聊过）'}

### [Task: 来电决策]
${userProfile.name} 此刻正在给你拨语音电话。根据你的人设、你们当前的关系与剧情走向、以及你此刻可能正在做的事，决定接还是不接——完全按你自己的性格来，不用迎合。
只输出一行 JSON，不要任何其他内容：{"answer": true 或 false, "reason": "你做这个决定时的内心想法（一句话）"}`;
            // 决策请求与最短响铃时间并行：让"正在呼叫"至少停留一会儿，更像真的在拨号
            const minRing = new Promise(r => setTimeout(r, 2500));
            const response = await fetch(`${callApi.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${callApi.apiKey}` },
                body: JSON.stringify({
                    model: callApi.model,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.9,
                }),
            });
            if (!response.ok) throw new Error(`API ${response.status}`);
            const data = await safeResponseJson(response);
            await minRing;
            if (voiceCallCancelRef.current) return;
            const raw = (extractContent(data) || '').trim();
            let answer = true;
            let reason = '';
            try {
                const jsonMatch = raw.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    answer = parsed.answer !== false;
                    reason = String(parsed.reason || '').slice(0, 120);
                }
            } catch { /* 解析失败按接听处理 */ }
            if (answer) {
                setVoiceCallPhase('none');
                // 电话 App 拨号握手键：CallApp 挂载时读取并直接选中该角色接通
                try { sessionStorage.setItem('moro_phone_dial_char_id', char.id); } catch { /* ignore */ }
                openApp(AppID.Call);
            } else {
                await DB.saveMessage({
                    charId: char.id,
                    role: 'user',
                    type: 'call_log',
                    content: '对方未接听',
                    metadata: { callDirection: 'outgoing', callOutcome: 'declined', declineReason: reason, msgStatus: 'sent' },
                } as any);
                // 让角色按人设决定要不要为没接电话发消息解释（也可以只回一句很短的，或语气敷衍——都按人设）
                await DB.saveMessage({
                    charId: char.id,
                    role: 'system',
                    type: 'text',
                    content: `[语音通话] ${userProfile.name} 刚刚给「${char.name}」拨了语音电话，但「${char.name}」没有接（TA 当时的内心想法：${reason || '现在不太方便接'}）。请以「${char.name}」的身份决定接下来的反应：可以发消息解释为什么没接、可以含糊带过、可以发一句很短的话、也可以表现得若无其事——完全按 TA 的人设和此刻的心情来。`,
                    metadata: { proactiveHint: true, hidden: true },
                } as any);
                setVoiceCallPhase('rejected');
                await reloadMessages(visibleCountRef.current);
                setTimeout(() => setVoiceCallPhase('none'), 2000);
                setTimeout(() => { triggerAI(messages); }, 600);
            }
        } catch (e: any) {
            if (!voiceCallCancelRef.current) {
                setVoiceCallPhase('none');
                addToast(`呼叫失败：${e?.message || '未知错误'}`, 'error');
            }
        }
    };

    const cancelVoiceCall = async () => {
        voiceCallCancelRef.current = true;
        setVoiceCallPhase('none');
        if (!char) return;
        await DB.saveMessage({
            charId: char.id,
            role: 'user',
            type: 'call_log',
            content: '已取消',
            metadata: { callDirection: 'outgoing', callOutcome: 'cancelled', msgStatus: 'sent' },
        } as any);
        await reloadMessages(visibleCountRef.current);
    };

    // ── 系统命令：用户以系统身份下达最高优先级指令，发出后立即触发角色执行 ──
    const handleSendSystemCommand = async () => {
        const cmd = systemCmdInput.trim();
        if (!char || !cmd) return;
        if (isTyping) { addToast('角色正在回复中，稍等片刻再下达命令', 'info'); return; }
        setShowSystemCmdModal(false);
        setSystemCmdInput('');
        await DB.saveMessage({
            charId: char.id,
            role: 'system',
            type: 'text',
            content: `[系统命令] ${cmd}`,
            metadata: { systemCommand: true },
        } as any);
        await reloadMessages(visibleCountRef.current);
        triggerAI(messages);
    };

    const resetPhoneLockSession = () => {
        setPhoneLockAttempt(null);
        setPhoneLockRunning(false);
        setPhoneLockPhase('setup');
        setPhoneLockChat([]);
        setPhoneLockChatInput('');
        setPhoneLockChatBusy(false);
        setPhoneLockScreenPhase('idle');
        setPhoneLockScreenIndex(0);
        setPhoneLockSelectedOption(null);
        setPhoneLockTypingDone(false);
        setPhoneLockSkipTyping(false);
        setPhoneLockExitSheetOpen(false);
        setPhoneLockExitCode('');
        setPhoneLockExitError('');
        setPhoneLockExitBusy(false);
    };

    const getPhoneLockQuestionForms = () => {
        const cleaned = phoneLockQuestions
            .map(q => ({
                stem: q.stem.replace(/\s+/g, ' ').trim().slice(0, 160),
                optionA: q.optionA.replace(/\s+/g, ' ').trim().slice(0, 80),
                optionB: q.optionB.replace(/\s+/g, ' ').trim().slice(0, 80),
            }))
            .filter(q => q.stem);
        return cleaned.slice(0, 3);
    };

    const getPhoneLockQuestions = () => getPhoneLockQuestionForms().map(q => {
        const opts = q.optionA && q.optionB ? `A. ${q.optionA} / B. ${q.optionB}` : '';
        return opts ? `${q.stem}（${opts}）` : q.stem;
    });

    const inferPhoneLockChoice = (answer: string | undefined, q: PhoneLockQuestionForm): 'A' | 'B' | null => {
        if (!q.optionA.trim() || !q.optionB.trim()) return null;
        const text = (answer || '').trim().toLowerCase();
        if (!text) return null;
        if (/^a\b|选a|选 a|答案a|答案 a|option a/i.test(text)) return 'A';
        if (/^b\b|选b|选 b|答案b|答案 b|option b/i.test(text)) return 'B';
        const a = q.optionA.trim().toLowerCase();
        const b = q.optionB.trim().toLowerCase();
        if (a && text.includes(a)) return 'A';
        if (b && text.includes(b)) return 'B';
        return null;
    };

    const updatePhoneLockQuestion = (index: number, patch: Partial<PhoneLockQuestionForm>) => {
        setPhoneLockQuestions(prev => prev.map((q, i) => i === index ? { ...q, ...patch } : q));
        resetPhoneLockSession();
    };

    const advancePhoneLockScreen = () => {
        if (!phoneLockScreenOpen || phoneLockRunning || phoneLockChatBusy) return;
        if (!phoneLockTypingDone) {
            setPhoneLockSkipTyping(true);
            return;
        }
        if (phoneLockScreenPhase === 'answered') {
            setPhoneLockTypingDone(false);
            setPhoneLockSkipTyping(false);
            setPhoneLockScreenPhase('reaction');
            return;
        }
        if (phoneLockScreenPhase === 'reaction') {
            if (phoneLockSameScreenChat && phoneLockAttempt) setPhoneLockScreenPhase('chat');
            else setPhoneLockScreenOpen(false);
        }
    };

    const savePhoneLockToCharacter = async (lock: PhoneLockState) => {
        if (!char) return;
        await updateCharacter(char.id, {
            phoneState: { records: char.phoneState?.records || [], ...char.phoneState, lock },
        });
    };

    const requestPhoneLockExit = () => {
        if (phoneLockRunning || phoneLockChatBusy) {
            addToast(`${char?.name || 'TA'} 还在输入，等一下再离开`, 'info');
            return;
        }
        setPhoneLockExitCode('');
        setPhoneLockExitError('');
        setPhoneLockExitSheetOpen(true);
    };

    const cancelPhoneLockExit = () => {
        if (phoneLockExitBusy) return;
        setPhoneLockExitSheetOpen(false);
        setPhoneLockExitCode('');
        setPhoneLockExitError('');
    };

    const submitPhoneLockExit = async () => {
        const liveChar = charRef.current;
        const liveLock = liveChar?.phoneState?.lock;
        if (!liveChar || !liveLock) {
            setPhoneLockScreenOpen(false);
            setPhoneLockExitSheetOpen(false);
            return;
        }
        if (!liveLock.passcode) {
            setPhoneLockExitError('这次没有设置口令答案，锁屏无法被题目解开。');
            return;
        }
        const passcodeInput = sanitizePhoneLockPasscode(phoneLockExitCode);
        if (!passcodeInput) {
            setPhoneLockExitError('先代 Ta 输入口令。');
            return;
        }
        setPhoneLockExitBusy(true);
        setPhoneLockExitError('');
        const evaluated = evaluatePhoneLockSubmission(liveLock, {
            passcodeInput,
            answers: [],
            reply: `${liveChar.name} 由退出口令解锁离开。`,
            mood: '想先回到密谈',
        });
        if (!evaluated.unlocked) {
            setPhoneLockExitBusy(false);
            setPhoneLockExitError('口令不对，Ta 还解不开。');
            return;
        }
        const now = Date.now();
        await updateCharacter(liveChar.id, {
            phoneState: { records: liveChar.phoneState?.records || [], ...liveChar.phoneState, lock: evaluated.nextLock },
        });
        setPhoneLockAttempt(prev => ({
            passcodeInput,
            answers: prev?.answers || [],
            wantsUnlock: true,
            reply: prev?.reply || `${liveChar.name} 输对口令，锁屏退回密谈。`,
            mood: prev?.mood || '终于松了口气',
            unlocked: true,
            unlockReason: evaluated.reason,
            completedQuestionId: evaluated.completedQuestionId,
        }));
        setPhoneLockPhase('unlocked');
        setPhoneLockChat(prev => [
            ...prev,
            { id: `sys-exit-${now}`, speaker: 'system', text: `${liveChar.name} 口令正确，解锁离开。`, at: now },
        ]);
        setPhoneLockExitBusy(false);
        setPhoneLockExitSheetOpen(false);
        setPhoneLockExitCode('');
        setPhoneLockScreenOpen(false);
        addToast(`${liveChar.name} 口令正确，已回到密谈`, 'success');
    };

    const runPhoneLock = async () => {
        if (!char || phoneLockRunning) return;
        const preset = PHONE_LOCK_PRESETS[phoneLockPreset];
        const userName = userProfile.name || '我';
        const passcode = sanitizePhoneLockPasscode(phoneLockCode);
        const note = phoneLockNote.trim();
        const questionForms = getPhoneLockQuestionForms();
        if (!passcode) {
            addToast('先设置一个口令答案，题目不能单独解锁', 'info');
            return;
        }
        const questions = getPhoneLockQuestions();
        const lock = createPhoneLockState({ ownerUserName: userName, charName: char.name, note, passcode, questions });
        setPhoneLockCode(passcode);
        setPhoneLockAttempt(null);
        setPhoneLockPhase('locked');
        setShowPhoneLockModal(false);
        setPhoneLockScreenOpen(true);
        setPhoneLockScreenPhase('thinking');
        setPhoneLockScreenIndex(0);
        setPhoneLockSelectedOption(null);
        setPhoneLockTypingDone(false);
        setPhoneLockSkipTyping(false);
        setPhoneLockChat([
            { id: `sys-${Date.now()}`, speaker: 'system', text: `${userName} 已远程锁住 ${char.name} 的手机。`, at: Date.now() },
        ]);
        setPhoneLockRunning(true);
        await savePhoneLockToCharacter(lock);

        const fallback: PhoneLockAttempt = {
            passcodeInput: '',
            answers: questions.map(q => q.includes('晚安') ? '晚安，别担心，我会好好休息。' : q.includes('专注') || q.includes('做完') ? '我先把眼前最该做的事做完。' : `想你，也想被你这样管一下。`),
            wantsUnlock: true,
            reply: `你还真把我手机锁了啊……题我写了，但口令我还没猜出来。你要不要给我一点更像你的提示？`,
            mood: '有点被逗到，也在等你松口',
        };

        let attempt = fallback;
        try {
            const lockApi = resolveAuxApi(auxApiConfig, apiConfig);
            if (lockApi.baseUrl && lockApi.apiKey) {
                const context = ContextBuilder.buildCoreContext(char, userProfile, true);
                const recent = messages.slice(-30).map(m => formatMessageWithTime(m, char.name, userName, formatTime)).join('\n');
                const prompt = `${context}\n\n${phoneLockAttemptPromptBody({
                    userName,
                    charName: char.name,
                    recent,
                    presetLabel: preset.label,
                    presetHint: preset.hint,
                    note,
                    questions,
                })}`;
                const res = await fetch(`${lockApi.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${lockApi.apiKey}` },
                    body: JSON.stringify({ model: lockApi.model, messages: [{ role: 'user', content: prompt }], temperature: 0.92 }),
                });
                if (!res.ok) throw new Error(`API ${res.status}`);
                let raw = (extractContent(await safeResponseJson(res)) || '').trim();
                raw = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
                const s = raw.indexOf('{'); const e = raw.lastIndexOf('}');
                if (s >= 0 && e > s) raw = raw.slice(s, e + 1);
                const parsed = JSON.parse(raw);
                attempt = {
                    passcodeInput: typeof parsed.passcodeInput === 'string' ? sanitizePhoneLockPasscode(parsed.passcodeInput) : '',
                    answers: Array.isArray(parsed.answers) ? parsed.answers.slice(0, questions.length).map((a: any) => String(a || '').slice(0, 180)) : fallback.answers,
                    wantsUnlock: parsed.wantsUnlock ?? parsed.unlocked ?? true,
                    reply: typeof parsed.reply === 'string' && parsed.reply.trim() ? parsed.reply.trim().slice(0, 220) : fallback.reply,
                    mood: typeof parsed.mood === 'string' && parsed.mood.trim() ? parsed.mood.trim().slice(0, 80) : fallback.mood,
                };
                while (attempt.answers.length < questions.length) attempt.answers.push('');
            }
        } catch (e) {
            console.warn('[Chat] phone lock failed, using fallback:', e);
        }

        const evaluated = evaluatePhoneLockSubmission(lock, {
            passcodeInput: attempt.passcodeInput,
            answers: attempt.answers,
            reply: attempt.reply,
            mood: attempt.mood,
        });
        const finalAttempt: PhoneLockAttempt = {
            ...attempt,
            passcodeInput: sanitizePhoneLockPasscode(attempt.passcodeInput),
            answers: attempt.answers.slice(0, questions.length),
            unlocked: evaluated.unlocked,
            unlockReason: evaluated.reason,
            completedQuestionId: evaluated.completedQuestionId,
        };
        setPhoneLockAttempt(finalAttempt);
        setPhoneLockPhase(evaluated.unlocked ? 'unlocked' : 'locked');
        const answeredIndex = Math.max(0, finalAttempt.answers.findIndex((answer, i) => !!questionForms[i] && !!answer.trim()));
        const answeredQuestion = questionForms[answeredIndex] || questionForms[0];
        const hasBinaryOptions = !!answeredQuestion?.optionA.trim() && !!answeredQuestion?.optionB.trim();
        const choice = hasBinaryOptions
            ? (inferPhoneLockChoice(finalAttempt.answers[answeredIndex], answeredQuestion) || (Math.random() > 0.5 ? 'A' : 'B'))
            : null;
        setPhoneLockScreenIndex(answeredIndex);
        setPhoneLockSelectedOption(choice);
        setPhoneLockTypingDone(false);
        setPhoneLockSkipTyping(false);
        setPhoneLockScreenPhase('choosing');
        window.setTimeout(() => {
            setPhoneLockTypingDone(false);
            setPhoneLockSkipTyping(false);
            setPhoneLockScreenPhase('answered');
        }, 900);
        await savePhoneLockToCharacter(evaluated.nextLock);
        setPhoneLockChat(prev => [
            ...prev,
            { id: `sys-${Date.now()}`, speaker: 'system', text: evaluated.unlocked ? `${char.name} ${phoneLockResultLabel(evaluated.reason)}，手机自动解锁。` : `${char.name} 口令未通过，手机继续黑屏锁住。`, at: Date.now() },
            { id: `char-${Date.now()}`, speaker: 'char', text: finalAttempt.reply, at: Date.now() },
        ]);
        try {
            await DB.saveMessage({
                charId: char.id,
                role: 'system',
                type: 'text',
                content: `[锁机记录] ${userName} 通过回形针里的「锁机」远程锁住了 ${char.name} 的手机。\n模式：${preset.label}\n锁屏留言：${note}\n口令答案：${passcode || '（未设置）'}\n${char.name} 在口令框输入：「${finalAttempt.passcodeInput || '（没输）'}」\n${questions.map((q, i) => `问：${q}\n${char.name} 的输入：${finalAttempt.answers[i] || '（空）'}`).join('\n')}\n系统判定：${evaluated.unlocked ? `${phoneLockResultLabel(evaluated.reason)}，自动解锁` : '口令未通过，题目作答不解锁，继续锁住'}。\n${char.name} 当时的心情：${finalAttempt.mood}`,
                metadata: { phoneLock: true, phoneLockPreset, phoneLockUnlocked: evaluated.unlocked, unlockBy: evaluated.reason },
            } as any);
            await DB.saveMessage({
                charId: char.id,
                role: 'assistant',
                type: 'text',
                content: finalAttempt.reply,
                metadata: { phoneLockReply: true, phoneLockUnlocked: evaluated.unlocked, unlockBy: evaluated.reason },
            } as any);
            await reloadMessages(visibleCountRef.current);
            addToast(evaluated.unlocked ? `${char.name} ${phoneLockResultLabel(evaluated.reason)}，已自动解锁` : `${char.name} 还没解开，手机继续锁着`, evaluated.unlocked ? 'success' : 'info');
        } catch (e) {
            console.warn('[Chat] save phone lock result failed:', e);
            addToast('锁机记录保存失败', 'error');
        }
        setPhoneLockRunning(false);
    };

    const sendPhoneLockChat = async () => {
        if (!char || phoneLockChatBusy) return;
        const text = phoneLockChatInput.trim();
        if (!text) return;
        const userName = userProfile.name || '我';
        const preset = PHONE_LOCK_PRESETS[phoneLockPreset];
        const note = phoneLockNote.trim() || preset.note(userName);
        const questions = getPhoneLockQuestions();
        const nextUserLine: PhoneLockChatLine = { id: `user-${Date.now()}`, speaker: 'user', text, at: Date.now() };
        const history = [...phoneLockChat, nextUserLine];
        setPhoneLockChat(history);
        setPhoneLockChatInput('');
        setPhoneLockChatBusy(true);

        let reply = phoneLockPhase === 'unlocked'
            ? '手机已经解开了，我看见你发的了。刚才黑屏那一下是真的有点突然。'
            : '我还在锁屏这里，看得见你的消息。你说吧，我在听。';
        try {
            const chatApi = resolveAuxApi(auxApiConfig, apiConfig);
            if (chatApi.baseUrl && chatApi.apiKey) {
                const context = ContextBuilder.buildCoreContext(char, userProfile, true);
                const attemptText = phoneLockAttempt
                    ? `你刚才提交的口令：${phoneLockAttempt.passcodeInput || '（没输）'}\n你刚才写的答案：${phoneLockAttempt.answers.map((a, i) => `${i + 1}. ${a || '（空）'}`).join(' / ')}\n现在状态：${phoneLockAttempt.unlocked ? `已自动解锁（${phoneLockResultLabel(phoneLockAttempt.unlockReason)}）` : '仍被黑屏锁住。'}`
                    : '你还没提交口令和答案。';
                const historyText = history.map(line => `${line.speaker === 'user' ? userName : line.speaker === 'char' ? char.name : '系统'}：${line.text}`).join('\n');
                const prompt = `${context}\n\n${phoneLockChatPromptBody({
                    userName,
                    charName: char.name,
                    presetLabel: preset.label,
                    note,
                    questions,
                    attemptText,
                    historyText,
                })}`;
                const res = await fetch(`${chatApi.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${chatApi.apiKey}` },
                    body: JSON.stringify({ model: chatApi.model, messages: [{ role: 'user', content: prompt }], temperature: 0.9 }),
                });
                if (!res.ok) throw new Error(`API ${res.status}`);
                reply = (extractContent(await safeResponseJson(res)) || '').replace(/```/g, '').trim().slice(0, 180) || reply;
            }
        } catch (e) {
            console.warn('[Chat] phone lock chat failed:', e);
        } finally {
            setPhoneLockChat(prev => [...prev, { id: `char-${Date.now()}`, speaker: 'char', text: reply, at: Date.now() }]);
            setPhoneLockChatBusy(false);
        }
    };

    // 离线自主生活·回看横幅：进入角色时算「未看过的离线事件」数；并实时接收补齐事件。
    useEffect(() => {
        if (!activeCharacterId) { setLifeRecapBanner(0); return; }
        let alive = true;
        countUnseenCatchup(activeCharacterId).then(n => { if (alive) setLifeRecapBanner(n); }).catch(() => {});
        const onCatchup = (e: Event) => {
            const detail = (e as CustomEvent).detail as { charId?: string };
            if (detail?.charId === activeCharacterId) {
                countUnseenCatchup(activeCharacterId).then(n => { if (alive) setLifeRecapBanner(n); }).catch(() => {});
            }
        };
        window.addEventListener('autonomous-life-catchup', onCatchup);
        return () => { alive = false; window.removeEventListener('autonomous-life-catchup', onCatchup); };
    }, [activeCharacterId]);

    // 回神：让角色暂停、第一人称审视最近哪里跑偏，再悄悄校准回来。
    // 用主 API（角色自己的声音）。结果存进 char.recenterCalibration（注入后续几轮）+ 弹窗给用户看独白。
    const handleRecenter = async () => {
        if (!char) return;
        if (isRecentering) { addToast('TA 正在回神，稍等一下…', 'info'); return; }
        if (!apiConfig.apiKey) { addToast('请先在「文具盒」里配置 API', 'error'); return; }
        setIsRecentering(true);
        try {
            const recent = await DB.getRecentMessagesByCharId(char.id, 60);
            if (recent.length < 2) { addToast('还没聊几句，先聊一会儿再回神吧', 'info'); return; }
            const result = await runRecenter(char, userProfile, recent, apiConfig);
            if (!result) { addToast('回神了一下，TA 觉得最近还好，没什么要调的', 'info'); return; }
            // 写入校准（注入后续 RECENTER_DEFAULT_TURNS 轮 AI 回复）
            await updateCharacter(char.id, {
                recenterCalibration: {
                    note: result.calibration || '回到本来的语气和分寸，别一味讨好、别套模板。',
                    monologue: result.monologue,
                    drift: result.drift,
                    createdAt: Date.now(),
                    turnsLeft: RECENTER_DEFAULT_TURNS,
                },
            });
            setRecenterResult(result);
        } catch (e: any) {
            console.warn('🫧 [Recenter] handler failed:', e?.message || e);
            addToast('回神失败了，待会儿再试试', 'error');
        } finally {
            setIsRecentering(false);
        }
    };

    const handleScreenPeek = async () => {
        if (!char) return;
        if (isTyping) { addToast('等 TA 这句说完再窥屏吧', 'info'); return; }
        setShowPanel('none');
        addToast('正在生成 TA 此刻的手机屏幕…', 'info');
        try {
            const now = Date.now();
            const displayName = char.convoSettings?.remarkName?.trim() || char.name;
            const run = await generateXunjiScreenlifeRun({
                char,
                api: resolveAuxApi(auxApiConfig, apiConfig),
                rangeStart: now - 30 * 60 * 1000,
                rangeEnd: now,
                density: 'light',
                writeBack: false,
                seed: `${char.id}_${now}_screen_peek`,
            });
            await DB.saveXunjiRun(run);
            const screen = buildScreenPeekPhoneScreen(run, char, userProfile, now);
            const card: ScreenPeekCard = {
                id: `screen-peek-${run.id}`,
                charId: char.id,
                charName: displayName,
                generatedAt: now,
                title: run.title || `${displayName} 的手机屏幕`,
                narrative: run.narrative,
                screen,
                chats: run.chats || [],
                browsed: run.browsed || [],
                notes: run.notes || [],
                moments: run.moments,
                sourceRunId: run.id,
            };
            await DB.saveMessage({
                charId: char.id,
                role: 'assistant',
                type: 'screen_peek_card',
                content: JSON.stringify(card),
                metadata: { screenPeek: card, excludeFromContext: true },
            } as any);
            await reloadMessages(visibleCountRef.current);
            addToast('窥屏截图已生成', 'success');
        } catch (err: any) {
            showError('窥屏生成失败', err?.message || String(err));
        }
    };

    const handlePanelAction = (type: string, payload?: any) => {
        switch (type) {
            case 'transfer': setModalType('transfer'); break;
            case 'poke': handleSendText('[戳一戳]', 'interaction'); break;
            case 'trigger-ai': handleManualTrigger(); break;
            case 'archive': setModalType('archive-settings'); break;
            case 'settings': setModalType('chat-settings'); break;
            case 'emoji-import': setModalType('emoji-import'); break;
            case 'send-emoji': if (payload) handleSendText(payload.url, 'emoji'); break;
            case 'delete-emoji-req': setSelectedEmoji(payload); setModalType('delete-emoji'); break;
            case 'add-category': setModalType('add-category'); break;
            case 'select-category': setActiveCategory(payload); break;
            case 'category-options': setSelectedCategory(payload); setModalType('category-options'); break;
            case 'delete-category-req': setSelectedCategory(payload); setModalType('delete-category'); break;
            case 'proactive': setShowProactiveModal(true); break;
            case 'alarm': openAlarmManager(); break;
            case 'life-recap': setShowPanel('none'); setShowLifeRecapModal(true); setLifeRecapBanner(0); break;
            case 'emotion': setModalType('schedule'); break; // 情绪已并入日程，打开同一 modal
            case 'schedule': setModalType('schedule'); break;
            case 'mcd-not-configured':
                addToast('请先到 文具盒 → 麦当劳 启用并填入 MCP Token', 'info');
                break;
            case 'mcd-request':
                setMcdAppOpen(true);
                break;
            case 'mcd-end':
                handleSendText(MCD_DEACTIVATE_TRIGGER, 'text', { mcdDeactivate: true });
                break;
            case 'thinking-settings': {
                // 「展示思考」按钮 → 打开思考链设置 modal（开关 / 卡片风格 / 配色 / 追加提示词）
                if (!char) break;
                setShowThinkingChainModal(true);
                break;
            }
            case 'check-phone': setShowPanel('none'); setShowCheckPhone(true); break;
            case 'screen-peek': void handleScreenPeek(); break;
            case 'phone-lock':
                setShowPanel('none');
                setPhoneLockAttempt(null);
                setPhoneLockRunning(false);
                setPhoneLockPhase('setup');
                setPhoneLockChat([]);
                setPhoneLockChatInput('');
                setPhoneLockChatBusy(false);
                setPhoneLockCode(prev => prev || makePhoneLockCode());
                setShowPhoneLockModal(true);
                break;
            case 'camera': setShowPanel('none'); setShowCamera(true); break;
            case 'recenter': setShowPanel('none'); handleRecenter(); break;
            case 'location': setShowPanel('none'); setShowLocationModal(true); break;
            case 'image-gen': setShowPanel('none'); setShowImageGenModal(true); break;
            case 'voice-record-denied': addToast('无法访问麦克风，请检查浏览器权限', 'error'); break;
            case 'voice-call': void startVoiceCall(); break;
            case 'video-call':
                setShowPanel('none');
                openApp(AppID.VideoCall);
                break;
            case 'parallel-reply':
                setShowPanel('none');
                setShowParallelReplyModal(true);
                break;
            case 'system-command': setShowPanel('none'); setShowSystemCmdModal(true); break;
            case 'takeout': {
                // 回形针「点外卖」：带着「给当前角色点」的意图跳到外卖 App
                if (!char) break;
                setShowPanel('none');
                setTakeoutIntent({ recipientCharId: char.id, recipientName: char.name });
                openApp(AppID.Takeout);
                break;
            }
            case 'propose': {
                if (!char) break;
                if (!canProposeNow(char)) {
                    addToast('求婚需要满好感 100、且感情走到想更进一步时才行哦', 'info');
                    break;
                }
                setShowPanel('none');
                setProposeVow('');
                setShowProposeCompose(true);
                break;
            }
            case 'offline-date': {
                // 用户主动发起线下模式（原「见面」App 并入此处）：直接打开线下场景窗口，
                // OfflineModeModal 没有进行中的会话时会自动生成见面开场；与角色 [[OFFLINE_START]]
                // 自动触发（聊天设置「自动线下」）共用同一套线下模式与上下文落库。
                if (!char) break;
                if (char.blacklisted || char.charBlock?.active) { addToast('拉黑期间无法见面', 'error'); break; }
                setShowPanel('none');
                setShowOfflineMode(true);
                break;
            }
        }
    };

    // 群聊「回形针」深链：群聊里对某成员发起单聊专属功能（拨过去 / 翻手机 / 回个神 / 今日作息…）时，
    // ChatHub 把动作名写进 localStorage 再深链跳到该成员单聊，这里读出来复用 handlePanelAction 执行。
    useEffect(() => {
        let action: string | null = null;
        try { action = localStorage.getItem('moro_chat_pending_action'); } catch { /* ignore */ }
        if (!action) return;
        try { localStorage.removeItem('moro_chat_pending_action'); } catch { /* ignore */ }
        const t = setTimeout(() => handlePanelAction(action!), 80);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeCharacterId]);

    useEffect(() => {
        if (!activeCharacterId || !char) return;
        let raw: string | null = null;
        try { raw = localStorage.getItem(FORUM_PENDING_CHAT_SHARE_KEY); } catch { /* ignore */ }
        if (!raw) return;

        let parsed: any = null;
        try { parsed = JSON.parse(raw); } catch {
            try { localStorage.removeItem(FORUM_PENDING_CHAT_SHARE_KEY); } catch { /* ignore */ }
            return;
        }
        if (!parsed || parsed.targetKind === 'group' || parsed.groupId) return;

        const payload = normalizeForumSharePendingPayload(parsed, { validCharIds: characters.map(c => c.id) });
        if (!payload) {
            try { localStorage.removeItem(FORUM_PENDING_CHAT_SHARE_KEY); } catch { /* ignore */ }
            return;
        }
        if (payload.targetId !== activeCharacterId) return;

        let cancelled = false;
        (async () => {
            try {
                try { localStorage.removeItem(FORUM_PENDING_CHAT_SHARE_KEY); } catch { /* ignore */ }
                const isCharShare = payload.shareMode === 'char_to_user';
                const snapshot = { ...payload.snapshot, shareMode: payload.shareMode };
                await DB.saveMessage({
                    charId: activeCharacterId,
                    role: isCharShare ? 'assistant' : 'user',
                    type: 'forum_card',
                    content: isCharShare ? '[分享的茶话亭帖子]' : '[转发的茶话亭帖子]',
                    metadata: {
                        forumPost: snapshot,
                        forumShareMode: payload.shareMode,
                        forumShareId: payload.id,
                    },
                } as any);
                await DB.saveMessage({
                    charId: activeCharacterId,
                    role: 'user',
                    type: 'text',
                    content: forumShareAutoReplyHint(payload, char.name),
                    metadata: { proactiveHint: true, hidden: true, forumShareAutoReply: true, forumShareId: payload.id },
                } as any);
                const fresh = await DB.getRecentMessagesByCharId(activeCharacterId, char.contextLimit || 80);
                if (!cancelled) {
                    await reloadMessages(visibleCountRef.current);
                    triggerAI(fresh);
                    addToast(isCharShare ? `${char.name} 把茶话亭帖子转给了你` : `已转发茶话亭帖子给 ${char.name}`, 'success');
                }
            } catch (err: any) {
                if (!cancelled) addToast(`茶话亭转发失败：${err?.message || err}`, 'error');
            }
        })();
        return () => { cancelled = true; };
    }, [activeCharacterId, char, characters, reloadMessages, triggerAI, addToast]);

    // --- 语音消息：录音结束后落库发送（转写文字进 metadata，AI 上下文可读）---
    const handleSendVoice = async (audio: string, durationSec: number, transcript: string) => {
        await handleSendText('[语音消息]', 'voice', { voiceAudio: audio, durationSec, transcript });
    };

    // --- 位置分享 ---
    const handleSendLocation = async () => {
        const name = locationName.trim();
        if (!name) { addToast('填一下地点名称', 'info'); return; }
        await handleSendText(name, 'location', { address: locationDetail.trim() });
        setShowLocationModal(false);
        setLocationName('');
        setLocationDetail('');
    };

    // --- AI 画图：生成 → 预览 → 确认发送（发送走 image 通道，自动存相册）---
    const handleGenerateImage = async () => {
        const prompt = imageGenPrompt.trim();
        if (!prompt) { addToast('描述一下想画什么', 'info'); return; }
        setIsGeneratingImage(true);
        try {
            try { localStorage.setItem(IMAGE_GEN_MODEL_KEY, imageGenModel.trim()); } catch {}
            const dataUri = await generateImage(prompt, apiConfig, imageGenModel);
            setImageGenPreview(dataUri);
        } catch (e: any) {
            showError('AI 画图失败', e?.message || String(e));
        } finally {
            setIsGeneratingImage(false);
        }
    };
    const handleSendGeneratedImage = async () => {
        if (!imageGenPreview) return;
        await handleSendText(imageGenPreview, 'image', { aiGenerated: true, genPrompt: imageGenPrompt.trim() });
        setShowImageGenModal(false);
        setImageGenPreview(null);
        setImageGenPrompt('');
    };

    // --- 偷看心声（入口：顶栏角色头像）：用完整人设 + 最近对话生成角色"没说出口的
    //     内心独白"，同一轮顺带评估「当前心情」与「好感值」（落在 char 上）。
    //     独白只存 inner_voices，不进聊天上下文 —— 角色"不知道"被偷看过。 ---
    const tryOpenInnerVoice = () => {
        // 会话设置「心声手记」开关：关闭后不可偷看心声
        if (char?.convoSettings?.innerVoiceEnabled === false) {
            addToast('心声手记已在聊天设置中关闭', 'info');
            return;
        }
        openInnerVoiceModal();
    };
    const openInnerVoiceModal = async () => {
        setShowInnerVoiceModal(true);
        setInnerVoiceCurrent(null);
        if (activeCharacterId) {
            try { setInnerVoiceHistory(await DB.getInnerVoicesByCharId(activeCharacterId)); } catch { setInnerVoiceHistory([]); }
        }
        generateInnerVoice();
    };
    const generateInnerVoice = async () => {
        if (!char || innerVoiceLoading) return;
        if (!apiConfig.baseUrl || !apiConfig.apiKey) { addToast('请先在「文具盒」里配置 API', 'error'); return; }
        setInnerVoiceLoading(true);
        try {
            try {
                const { injectMemoryPalace } = await import('../utils/memoryPalace/pipeline');
                await injectMemoryPalace(char);
            } catch { /* 记忆宫殿未启用时跳过 */ }
            const context = ContextBuilder.buildCoreContext(char, userProfile, true);
            const allMsgs = await DB.getMessagesByCharId(char.id);
            const recent = allMsgs.slice(-30).map(m => formatMessageWithTime(m, char.name, userProfile.name, formatTime)).join('\n');
            const currentAffection = typeof char.affection === 'number' ? Math.round(char.affection) : null;
            const curRel = char.relationship;
            const relLine = curRel ? `你和用户当前的关系是「${curRel.label}」（${curRel.stage}）。` : '你和用户还没有明确的关系定位。';
            // 任务块文案见 utils/laiwangPrompts.ts → [9] 偷看心声
            const fullPrompt = `${context}\n\n${innerVoicePromptBody({
                charName: char.name,
                recent,
                currentAffection,
                relLine,
                curStage: curRel?.stage || 'friend',
                curLabel: curRel?.label || '朋友',
            })}`;
            const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify({
                    model: apiConfig.model,
                    messages: [{ role: 'user', content: fullPrompt }],
                    temperature: 0.9,
                }),
            });
            if (!response.ok) throw new Error(`API ${response.status}`);
            const data = await safeResponseJson(response);
            const content = (extractContent(data) || '').trim();
            if (!content) throw new Error('返回为空');

            // 解析 JSON（模型偶尔包代码块/夹杂文字时取首个 {...}）；解析失败则整段当独白，
            // 心情/好感保持原值不动 —— 独白永远不能因为格式问题丢失
            let voice = content;
            let moodPatch: CharacterProfile['currentMood'] | undefined;
            let affectionPatch: number | undefined;
            let relationshipPatch: CharacterProfile['relationship'] | undefined;
            try {
                const jsonMatch = content.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    if (typeof parsed.voice === 'string' && parsed.voice.trim()) {
                        voice = parsed.voice.trim();
                        const moodLabel = typeof parsed.mood?.label === 'string' ? parsed.mood.label.trim() : '';
                        if (moodLabel) {
                            moodPatch = {
                                label: moodLabel.slice(0, 12),
                                emoji: typeof parsed.mood?.emoji === 'string' ? parsed.mood.emoji.trim().slice(0, 4) : undefined,
                                updatedAt: Date.now(),
                            };
                        }
                        const decisive = parsed.decisive === true;
                        const aff = Number(parsed.affection);
                        // 好感经加减框架收敛：日常微调、决定性事件才大幅波动
                        if (Number.isFinite(aff)) affectionPatch = applyAffectionEval(char.affection, aff, { decisive });
                        // 关系：经收敛函数防止无理跳变（lover/ex/engaged/married 受限）
                        const effAff = affectionPatch ?? char.affection;
                        const propStage = parsed.relationship?.stage;
                        if (isRelationshipStage(propStage)) {
                            const sane = sanitizeRelationshipUpdate(char.relationship, propStage, parsed.relationship?.label, effAff, { decisive });
                            if (sane) relationshipPatch = buildRelationshipState(char.relationship, sane.stage, sane.label, decisive ? '决定性事件' : '日常评估');
                        }
                    }
                }
            } catch { /* 按纯文本独白兜底 */ }

            const entry: InnerVoiceEntry = {
                id: `iv-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
                charId: char.id,
                content: voice,
                timestamp: Date.now(),
            };
            await DB.saveInnerVoice(entry);
            setInnerVoiceCurrent(entry);
            setInnerVoiceHistory(prev => [entry, ...prev]);

            if (moodPatch || affectionPatch !== undefined || relationshipPatch) {
                const patch: Partial<CharacterProfile> = {};
                if (moodPatch) patch.currentMood = moodPatch;
                if (affectionPatch !== undefined) patch.affection = affectionPatch;
                if (relationshipPatch) patch.relationship = relationshipPatch;
                updateCharacter(char.id, patch);
            }
        } catch (e: any) {
            showError('偷看失败', e?.message || String(e));
        } finally {
            setInnerVoiceLoading(false);
        }
    };

    // 当前会话麦请求是否激活 (从消息历史推导, 无新存储)
    const mcdActivated = useMemo(() => isMcdActivatedInMessages(messages), [messages]);
    const [mcdAppOpen, setMcdAppOpen] = useState(false);
    // mcdMiniAppRef 声明在文件靠前 (传给 useChatAI), 这里仅占位
    const mcdConfiguredFlag = useMemo(() => isMcdConfigured(), [showPanel, mcdActivated]);

    // 用户在菜单卡里点"发送给角色"时, 把购物车作为 user 消息插入
    const handleMcdSendCart = useCallback(async (items: import('../components/chat/McdCard').McdCartItem[]) => {
        if (!char || !items.length) return;
        const summary = items.map(i => `${i.name}×${i.qty}`).join('、');
        const total = items.reduce((s, c) => {
            const p = typeof c.price === 'string' ? parseFloat(c.price) : (typeof c.price === 'number' ? c.price : 0);
            return s + (isFinite(p) ? p * c.qty : 0);
        }, 0);
        const totalStr = total > 0 ? ` 共¥${total.toFixed(2)}` : '';
        const content = `想要下单：${summary}${totalStr}`;
        await DB.saveMessage({
            charId: char.id,
            role: 'user',
            type: 'mcd_card',
            content,
            metadata: { mcdCardKind: 'cart', mcdCartItems: items },
        } as any);
        await reloadMessages(visibleCountRef.current);
    }, [char, reloadMessages]);

    // 用户在菜单卡某条单品上点 💭 → 立即把这条扔给角色让 ta 评价 (候选状态, 不进购物车)
    const handleMcdCandidate = useCallback(async (item: import('../components/chat/McdCard').McdCartItem) => {
        if (!char || !item) return;
        const priceStr = typeof item.price === 'number' ? ` ¥${item.price}` : (typeof item.price === 'string' && item.price ? ` ¥${item.price}` : '');
        const content = `「${item.name}」${priceStr}—— 这个怎么样？`;
        await DB.saveMessage({
            charId: char.id,
            role: 'user',
            type: 'mcd_card',
            content,
            metadata: { mcdCardKind: 'candidate', mcdCandidate: item },
        } as any);
        await reloadMessages(visibleCountRef.current);
    }, [char, reloadMessages]);

    // 小程序内输入 → 直接保存 user 消息 + 立即触发 AI (主聊天 handleSendText 不自动触发,
    // 那是设计上的"手动 ⚡ 触发"流程, 但小程序里用户预期发完就有回复, 跳过那个步骤)。
    // 走完整 pipeline: useChatAI 在 build prompt 时会读 mcdMiniAppRef 注入小程序状态。
    const handleMcdMiniAppSend = useCallback(async (text: string) => {
        if (!char || !text.trim() || isTyping) return;
        const trimmed = text.trim();
        await DB.saveMessage({
            charId: char.id,
            role: 'user',
            type: 'text',
            content: trimmed,
            metadata: { fromMcdMiniApp: true },
        } as any);
        const recent = await DB.getRecentMessagesByCharId(char.id, 200);
        setMessages(recent);
        triggerAI(recent);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [char, isTyping, triggerAI]);

    // 小程序状态实时同步到 ref, 让下次 send 走主 pipeline 时能注入到 system prompt
    const handleMcdMiniAppStateChange = useCallback((state: import('../utils/mcdToolBridge').McdMiniAppSnapshot) => {
        mcdMiniAppRef.current = state;
    }, []);

    // 小程序里"敲定"购物车 → 把购物车转成 cart 卡 (复用现有渲染), 之后 Phase 2
    // 会在这里挂 calculate-price + create-order。当前先让 char 看到购物车评论。
    const handleMcdAppConfirm = useCallback(async (
        cart: import('../components/mcd/McdMiniApp').CartLine[],
        ctx: import('../components/mcd/McdMiniApp').OrderContext,
    ) => {
        if (!char || !cart.length) return;
        const items: import('../components/chat/McdCard').McdCartItem[] = cart.map(l => ({
            code: l.code,
            name: l.name,
            price: l.price,
            qty: l.qty,
        }));
        const summary = items.map(i => `${i.name}×${i.qty}`).join('、');
        const total = items.reduce((s, c) => {
            const p = typeof c.price === 'string' ? parseFloat(c.price) : (typeof c.price === 'number' ? c.price : 0);
            return s + (isFinite(p) ? p * c.qty : 0);
        }, 0);
        const totalStr = total > 0 ? ` 共¥${total.toFixed(2)}` : '';
        const where = ctx.orderType === 2
            ? `外送至 ${ctx.addressLabel || ctx.addressId}`
            : `到店取餐 (${ctx.storeName || ctx.storeCode})`;
        const content = `${where} · ${summary}${totalStr}`;
        await DB.saveMessage({
            charId: char.id,
            role: 'user',
            type: 'mcd_card',
            content,
            metadata: {
                mcdCardKind: 'cart',
                mcdCartItems: items,
                mcdOrderContext: ctx,
            },
        } as any);
        await reloadMessages(visibleCountRef.current);
    }, [char, reloadMessages]);

    // --- Schedule Handlers ---
    const loadSchedule = async () => {
        if (!char) return;
        if (!isScheduleFeatureOn(char)) { setScheduleData(null); return; }
        const today = new Date().toISOString().split('T')[0];
        const s = await DB.getDailySchedule(char.id, today);
        setScheduleData(s);
    };

    // Load schedule when modal opens
    React.useEffect(() => {
        if (modalType === 'schedule') loadSchedule();
    }, [modalType]);

    const handleScheduleEdit = async (index: number, slot: ScheduleSlot) => {
        if (!scheduleData) return;
        const newSlots = [...scheduleData.slots];
        newSlots[index] = slot;
        const updated = { ...scheduleData, slots: newSlots };
        setScheduleData(updated);
        await DB.saveDailySchedule(updated);
    };

    const handleScheduleDelete = async (index: number) => {
        if (!scheduleData) return;
        const newSlots = scheduleData.slots.filter((_, i) => i !== index);
        const updated = { ...scheduleData, slots: newSlots };
        setScheduleData(updated);
        await DB.saveDailySchedule(updated);
    };

    const handleScheduleCoverChange = async (dataUrl: string) => {
        if (!scheduleData) return;
        const updated = { ...scheduleData, coverImage: dataUrl };
        setScheduleData(updated);
        await DB.saveDailySchedule(updated);
    };

    const generateDailySchedule = async (targetChar: typeof char, forceRegenerate: boolean = false) => {
        if (!targetChar || isScheduleGenerating) return;
        setIsScheduleGenerating(true);
        try {
            const result = await generateDailyScheduleForChar(targetChar, userProfile, resolveAuxApi(auxApiConfig, apiConfig), forceRegenerate);
            if (result) setScheduleData(result);
        } catch (e) {
            console.error('[Schedule] Generation error:', e);
        } finally {
            setIsScheduleGenerating(false);
        }
    };

    const handleScheduleStyleChange = async (style: 'lifestyle' | 'mindful') => {
        if (!char) return;
        // 与情绪/意识流强制同步：启用日程时自动启用情绪感知
        const prevEmotion = char.emotionConfig;
        const nextEmotion = { ...(prevEmotion || {}), enabled: true };
        updateCharacter(char.id, { scheduleStyle: style, emotionConfig: nextEmotion });
        // Force regenerate with new style — use updated char object
        const updatedChar = { ...char, scheduleStyle: style, emotionConfig: nextEmotion };
        if (!isScheduleFeatureOn(updatedChar)) return;
        setIsScheduleGenerating(true);
        try {
            const result = await generateDailyScheduleForChar(updatedChar, userProfile, resolveAuxApi(auxApiConfig, apiConfig), true);
            if (result) setScheduleData(result);
        } catch (e) {
            console.error('[Schedule] Regeneration after style change failed:', e);
        } finally {
            setIsScheduleGenerating(false);
        }
    };

    // 日程 / 情绪 buff 总开关
    // 关闭：清空前台 scheduleData，同时清空可能已缓存的 buff 注入（防止继续污染下一轮 prompt）
    // 打开：若还没生成今日日程，立即生成一次
    const handleToggleScheduleFeature = async () => {
        if (!char) return;
        const nextEnabled = !isScheduleFeatureOn(char);
        const patch: any = { scheduleFeatureEnabled: nextEnabled };
        if (nextEnabled) {
            // 与 handleScheduleStyleChange 对齐：开日程 = 同步开情绪/意识流。
            // 旧逻辑下，新角色的 emotionConfig 从未初始化（undefined），
            // 仅切总开关而不点风格时，emotionConfig?.enabled 始终落 false，
            // 副 API 闸门 (isScheduleFeatureOn && emotionConfig?.enabled) 永远过不去。
            patch.emotionConfig = { ...(char.emotionConfig || {}), enabled: true };
        } else {
            // 关闭时顺手把 buff 注入清空，避免上一轮残留继续注入
            patch.buffInjection = '';
            patch.activeBuffs = [];
        }
        updateCharacter(char.id, patch);
        if (!nextEnabled) {
            setScheduleData(null);
            addToast('日程与情绪已关闭', 'info');
            return;
        }
        addToast('日程与情绪已开启', 'success');
        // 打开后立刻尝试生成（若今日未生成且已选风格）
        const updatedChar = { ...char, ...patch };
        if (updatedChar.scheduleStyle) {
            const today = new Date().toISOString().split('T')[0];
            const existing = await DB.getDailySchedule(char.id, today).catch(() => null);
            if (existing) {
                setScheduleData(existing);
            } else {
                generateDailySchedule(updatedChar, false);
            }
        }
    };

    // --- Modal Handlers ---

    const handleAddCategory = async () => {
        if (!newCategoryName.trim()) {
             addToast('先给这页贴纸起个名字吧', 'error');
             return;
        }
        const newCat = { id: `cat-${Date.now()}`, name: newCategoryName.trim() };
        await DB.saveEmojiCategory(newCat);
        await loadEmojiData();
        setActiveCategory(newCat.id);
        setModalType('none');
        setNewCategoryName('');
        addToast('新的一页建好了', 'success');
    };

    const handleImportEmoji = async () => {
        if (!emojiImportText.trim()) return;
        const lines = emojiImportText.split('\n');
        const targetCatId = activeCategory === 'default' ? undefined : activeCategory;

        for (const line of lines) {
            const parts = line.split('--');
            if (parts.length >= 2) {
                const name = parts[0].trim();
                // 第三段（如果最后一段不是 URL）当作描述：名字--URL--描述。
                // URL 自身可能含 "--"，所以从尾部判断：最后一段不以协议/data: 开头才算描述。
                let urlParts = parts.slice(1);
                let description = '';
                if (urlParts.length > 1) {
                    const last = urlParts[urlParts.length - 1].trim();
                    if (last && !/^(https?:|data:|\/\/)/i.test(last) && !/\.(png|jpe?g|gif|webp)$/i.test(last)) {
                        description = last;
                        urlParts = urlParts.slice(0, -1);
                    }
                }
                const url = urlParts.join('--').trim();
                if (name && url) {
                    await DB.saveEmoji(name, url, targetCatId, description || undefined);
                }
            }
        }
        await loadEmojiData();
        setModalType('none');
        setEmojiImportText('');
        addToast('贴纸收集好了', 'success');
    };

    const handleDeleteCategory = async () => {
        if (!selectedCategory) return;
        await DB.deleteEmojiCategory(selectedCategory.id);
        await loadEmojiData();
        setActiveCategory('default');
        setModalType('none');
        setSelectedCategory(null);
        addToast('这个表情分组已删除', 'success');
    };

    const handleSaveCategoryVisibility = async (categoryId: string, allowedCharacterIds: string[] | undefined) => {
        const cat = categories.find(c => c.id === categoryId);
        if (!cat) return;
        await DB.saveEmojiCategory({ ...cat, allowedCharacterIds });
        await loadEmojiData();
        setSelectedCategory(null);
        addToast(allowedCharacterIds ? `已设置 ${allowedCharacterIds.length} 个角色可见` : '已设为所有角色可见', 'success');
    };

    const handleSavePrompt = () => {
        if (!editingPrompt || !editingPrompt.name.trim() || !editingPrompt.content.trim()) {
            addToast('请填写完整', 'error');
            return;
        }
        setArchivePrompts(prev => {
            let next;
            if (prev.some(p => p.id === editingPrompt.id)) {
                next = prev.map(p => p.id === editingPrompt.id ? editingPrompt : p);
            } else {
                next = [...prev, editingPrompt];
            }
            const customOnly = next.filter(p => !p.id.startsWith('preset_'));
            localStorage.setItem('chat_archive_prompts', JSON.stringify(customOnly));
            return next;
        });
        setSelectedPromptId(editingPrompt.id);
        setModalType('archive-settings');
        setEditingPrompt(null);
    };

    const handleDeletePrompt = (id: string) => {
        if (id.startsWith('preset_')) {
            addToast('默认预设不可删除', 'error');
            return;
        }
        setArchivePrompts(prev => {
            const next = prev.filter(p => p.id !== id);
            const customOnly = next.filter(p => !p.id.startsWith('preset_'));
            localStorage.setItem('chat_archive_prompts', JSON.stringify(customOnly));
            return next;
        });
        if (selectedPromptId === id) setSelectedPromptId('preset_rational');
        addToast('预设已删除', 'success');
    };

    const createNewPrompt = () => {
        setEditingPrompt({ id: `custom_${Date.now()}`, name: '新预设', content: DEFAULT_ARCHIVE_PROMPTS[0].content });
        setModalType('prompt-editor');
    };

    const editSelectedPrompt = () => {
        const p = archivePrompts.find(a => a.id === selectedPromptId);
        if (!p) return;
        if (p.id.startsWith('preset_')) {
            setEditingPrompt({ id: `custom_${Date.now()}`, name: `${p.name} (Copy)`, content: p.content });
        } else {
            setEditingPrompt({ ...p });
        }
        setModalType('prompt-editor');
    };

    const handleBgUpload = async (file: File) => {
        try {
            const dataUrl = await processImage(file, { skipCompression: true });
            updateCharacter(char.id, { chatBackground: dataUrl });
            addToast('聊天背景已更新', 'success');
        } catch(err: any) {
            addToast(err.message, 'error');
        }
    };

    const resetPrivateChatUi = (nextMessages: Message[] = []) => {
        clearMessageRevealTimers();
        setMessages(nextMessages.slice(-LOAD_BATCH_SIZE));
        setAllHistoryMessages([]);
        setTotalMsgCount(nextMessages.length);
        setHistoryLoaded(true);
        setVisibleCount(LOAD_BATCH_SIZE);
        visibleCountRef.current = LOAD_BATCH_SIZE;
        setReplyTarget(null);
        setSelectionMode(false);
        setSelectedMsgIds(new Set());
        setSelectedThinkingMsgIds(new Set());
        setSelectedMessage(null);
        setWindowedFocusMsgId(null);
        setFlashMsgId(null);
        setShowPanel('none');
        setShowActionSelector(false);
        setInput('');
        try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
        setInstantToolStatus(null);
        setLastTokenUsage(null);
        setPlayingMsgId(null);
        if (chatAudioRef.current) {
            try { chatAudioRef.current.pause(); } catch { /* ignore */ }
        }
        lastMsgIdRef.current = nextMessages.length ? nextMessages[nextMessages.length - 1].id : null;
        revealKnownIdsRef.current = new Set(nextMessages.map(m => m.id));
        revealHydratedRef.current = true;
        setPoppingMessageIds(new Set());
        setRevealedAssistantIds(new Set(nextMessages.filter(m => m.role === 'assistant').map(m => m.id)));
    };

    const saveCurrentPrivateChatArchive = async (opts: { activateIfCreated?: boolean } = {}): Promise<PrivateChatArchive | null> => {
        if (!char) return null;
        const allMessages = await DB.getMessagesByCharId(char.id, true);
        const snapshot = toPrivateChatMessages(allMessages, char.id);
        const existing = char.activePrivateChatId ? await DB.getPrivateChatArchive(char.activePrivateChatId).catch(() => undefined) : undefined;
        if (!existing && snapshot.length === 0) return null;

        const now = Date.now();
        const meta = derivePrivateChatArchiveMeta(snapshot, `新聊天 ${formatPrivateChatTitleTime(now)}`);
        const archive: PrivateChatArchive = {
            id: existing?.id || makePrivateChatArchiveId(),
            charId: char.id,
            title: (existing?.title?.trim() || meta.title || `新聊天 ${formatPrivateChatTitleTime(now)}`).slice(0, 80),
            pinned: existing?.pinned,
            createdAt: existing?.createdAt || snapshot[0]?.timestamp || now,
            updatedAt: snapshot.length ? (meta.updatedAt || now) : now,
            messageCount: snapshot.length,
            lastMessagePreview: meta.lastMessagePreview,
            messages: snapshot,
            source: existing?.source || 'moro',
        };
        await DB.savePrivateChatArchive(archive);
        if (!existing && opts.activateIfCreated) {
            await updateCharacter(char.id, { activePrivateChatId: archive.id });
        }
        await refreshPrivateChatArchives(char.id);
        return archive;
    };

    const handleOpenChatSettings = () => {
        setModalType('chat-settings');
        saveCurrentPrivateChatArchive({ activateIfCreated: true }).catch(e => {
            console.warn('[Chat] snapshot before settings failed', e);
        });
    };

    const handleNewPrivateChat = async () => {
        if (!char) return;
        if (isTyping) {
            addToast('等 TA 这句说完再新开一页吧', 'info');
            return;
        }
        try {
            await saveCurrentPrivateChatArchive();
            const currentIds = (await DB.getMessagesByCharId(char.id, true)).map(m => m.id);
            await DB.clearMessages(char.id);
            discardVoiceForMessages(currentIds);
            const now = Date.now();
            const archive: PrivateChatArchive = {
                id: makePrivateChatArchiveId(),
                charId: char.id,
                title: `新聊天 ${formatPrivateChatTitleTime(now)}`,
                pinned: false,
                createdAt: now,
                updatedAt: now,
                messageCount: 0,
                lastMessagePreview: '',
                messages: [],
                source: 'moro',
            };
            await DB.savePrivateChatArchive(archive);
            try { localStorage.removeItem(`mp_lastMsgId_${char.id}`); } catch { /* ignore */ }
            await updateCharacter(char.id, {
                activePrivateChatId: archive.id,
                hideBeforeMessageId: undefined,
                memoryPalaceInjection: undefined,
            });
            resetPrivateChatUi([]);
            await refreshPrivateChatArchives(char.id);
            addToast('已开启一页新的私聊', 'success');
        } catch (e: any) {
            addToast(e?.message || '新建私聊失败', 'error');
        }
    };

    const handleSwitchPrivateChat = async (archiveId: string) => {
        if (!char) return;
        if (isTyping) {
            addToast('等 TA 这句说完再切换记录吧', 'info');
            return;
        }
        try {
            if (archiveId === char.activePrivateChatId) {
                await saveCurrentPrivateChatArchive({ activateIfCreated: true });
                addToast('当前私聊已保存', 'success');
                return;
            }
            await saveCurrentPrivateChatArchive();
            const archive = await DB.getPrivateChatArchive(archiveId);
            if (!archive || archive.charId !== char.id) {
                addToast('这份私聊档案不见了', 'error');
                await refreshPrivateChatArchives(char.id);
                return;
            }

            const currentIds = (await DB.getMessagesByCharId(char.id, true)).map(m => m.id);
            await DB.clearMessages(char.id);
            discardVoiceForMessages(currentIds);

            const idMap = new Map<number, number>();
            const restored: Message[] = [];
            const ordered = [...(archive.messages || [])].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
            for (const src of ordered) {
                const replyTo = src.replyTo ? {
                    id: (src.replyTo.id !== undefined && idMap.has(src.replyTo.id)) ? idMap.get(src.replyTo.id)! : (src.replyTo.id || 0),
                    content: src.replyTo.content,
                    name: src.replyTo.name,
                } : undefined;
                const metadata = cloneArchiveValue(src.metadata);
                const newId = await DB.saveMessage({
                    charId: char.id,
                    role: src.role,
                    type: asMessageType(src.type),
                    content: src.content || '',
                    timestamp: src.timestamp || Date.now(),
                    metadata,
                    replyTo,
                });
                if (typeof src.originalId === 'number') idMap.set(src.originalId, newId);
                restored.push({
                    id: newId,
                    charId: char.id,
                    role: src.role,
                    type: asMessageType(src.type),
                    content: src.content || '',
                    timestamp: src.timestamp || Date.now(),
                    metadata,
                    replyTo,
                });
            }

            try { localStorage.removeItem(`mp_lastMsgId_${char.id}`); } catch { /* ignore */ }
            await updateCharacter(char.id, {
                activePrivateChatId: archive.id,
                hideBeforeMessageId: undefined,
                memoryPalaceInjection: undefined,
            });
            resetPrivateChatUi(restored);
            await refreshPrivateChatArchives(char.id);
            addToast(`已打开「${archive.title}」`, 'success');
        } catch (e: any) {
            addToast(e?.message || '切换私聊失败', 'error');
        }
    };

    const handleRenamePrivateChat = async (archiveId: string, title: string) => {
        if (!char) return;
        const nextTitle = title.trim().slice(0, 80);
        if (!nextTitle) return;
        try {
            const archive = archiveId === char.activePrivateChatId
                ? await saveCurrentPrivateChatArchive({ activateIfCreated: true })
                : await DB.getPrivateChatArchive(archiveId);
            if (!archive) return;
            await DB.savePrivateChatArchive({ ...archive, title: nextTitle, updatedAt: Date.now() });
            await refreshPrivateChatArchives(char.id);
            addToast('私聊标题已改好', 'success');
        } catch (e: any) {
            addToast(e?.message || '改名失败', 'error');
        }
    };

    const handleTogglePinPrivateChat = async (archiveId: string) => {
        if (!char) return;
        try {
            const archive = archiveId === char.activePrivateChatId
                ? await saveCurrentPrivateChatArchive({ activateIfCreated: true })
                : await DB.getPrivateChatArchive(archiveId);
            if (!archive) return;
            await DB.savePrivateChatArchive({ ...archive, pinned: !archive.pinned, updatedAt: Date.now() });
            await refreshPrivateChatArchives(char.id);
        } catch (e: any) {
            addToast(e?.message || '置顶失败', 'error');
        }
    };

    const handleDeletePrivateChat = async (archiveId: string) => {
        if (!char) return;
        const archive = await DB.getPrivateChatArchive(archiveId).catch(() => undefined);
        const ok = confirm(`确定删除「${archive?.title || '这份私聊'}」吗？删除后不会影响角色卡，但聊天记录本身会消失。`);
        if (!ok) return;
        try {
            await DB.deletePrivateChatArchive(archiveId);
            if (archiveId === char.activePrivateChatId) {
                const currentIds = (await DB.getMessagesByCharId(char.id, true)).map(m => m.id);
                await DB.clearMessages(char.id);
                discardVoiceForMessages(currentIds);
                try { localStorage.removeItem(`mp_lastMsgId_${char.id}`); } catch { /* ignore */ }
                await updateCharacter(char.id, {
                    activePrivateChatId: undefined,
                    hideBeforeMessageId: undefined,
                    memoryPalaceInjection: undefined,
                });
                resetPrivateChatUi([]);
            }
            await refreshPrivateChatArchives(char.id);
            addToast('私聊档案已删除', 'success');
        } catch (e: any) {
            addToast(e?.message || '删除失败', 'error');
        }
    };

    const handleExportPrivateChat = async (archiveId: string) => {
        if (!char) return;
        try {
            const archive = archiveId === char.activePrivateChatId
                ? await saveCurrentPrivateChatArchive({ activateIfCreated: true })
                : await DB.getPrivateChatArchive(archiveId);
            if (!archive) {
                addToast('没有可导出的私聊档案', 'info');
                return;
            }
            const data = {
                type: PRIVATE_CHAT_ARCHIVE_EXPORT_TYPE,
                exportedAt: new Date().toISOString(),
                character: { id: char.id, name: char.name },
                archive,
            };
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const cleanTitle = archive.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || 'private_chat';
            a.href = url;
            a.download = `moro_private_${char.name}_${cleanTitle}_${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 5000);
            addToast('私聊档案已导出', 'success');
        } catch (e: any) {
            addToast(e?.message || '导出失败', 'error');
        }
    };

    const handleImportPrivateChat = async (file: File) => {
        if (!char) return;
        try {
            const text = await file.text();
            const archive = parsePrivateChatArchiveImport(file.name, text, char);
            await DB.savePrivateChatArchive(archive);
            await refreshPrivateChatArchives(char.id);
            addToast(`已导入「${archive.title}」`, 'success');
        } catch (e: any) {
            addToast(e?.message || '导入失败，请确认文件格式', 'error');
        }
    };

    const saveSettings = () => {
        updateCharacter(char.id, {
            contextLimit: settingsContextLimit,
            htmlModeCustomPrompt: settingsHtmlModeCustomPrompt,
        } as any);
        setModalType('none');
        addToast('设置已保存', 'success');
    };

    const handleClearHistory = async () => {
        if (!char) return;

        // 记忆宫殿安全检查：保留最近 10 条时仍保护未处理消息；全量清除语义是重置角色上下文。
        if (preserveContext && char.memoryPalaceEnabled) {
            const hwm = await getMemoryPalaceHWM(char.id);
            const allMessages = await DB.getMessagesByCharId(char.id, true);
            const textMessages = allMessages.filter(m => m.type === 'text' && m.content?.trim());
            const unprocessedCount = textMessages.filter(m => m.id > hwm).length;

            if (unprocessedCount > 0) {
                // 有未处理的消息，弹出选择对话框
                const processedMsgs = allMessages.filter(m => m.id <= hwm);
                const choice = confirm(
                    `⚠️ 回忆标本馆提醒\n\n` +
                    `当前有 ${unprocessedCount} 条聊天记录尚未被回忆标本馆处理（向量化）。\n` +
                    `直接清空会导致这些记录永久丢失，无法被角色记住。\n\n` +
                    `点击「确定」→ 仅删除已被回忆标本馆处理过的记录（安全）\n` +
                    `点击「取消」→ 取消清空操作\n\n` +
                    `（看不懂在问什么的话就点确定）`
                );

                if (!choice) {
                    return; // 用户取消
                }

                // 安全删除：只删除高水位之前的消息
                if (processedMsgs.length === 0) {
                    addToast('没有已处理的记录可以删除', 'info');
                    return;
                }
                const processedIds = processedMsgs.map(m => m.id);
                await DB.deleteMessages(processedIds);
                discardVoiceForMessages(processedIds);
                const remaining = allMessages.filter(m => m.id > hwm);
                setMessages(remaining.slice(-200));
                setTotalMsgCount(remaining.length);
                setVisibleCount(LOAD_BATCH_SIZE);
                visibleCountRef.current = LOAD_BATCH_SIZE;
                addToast(`已安全清理 ${processedMsgs.length} 条已处理记录，保留 ${remaining.length} 条未处理记录`, 'success');
                setModalType('none');
                return;
            }
        }

        // 原有逻辑（无记忆宫殿 or 所有消息已处理）
        if (preserveContext) {
            const allMessages = await DB.getMessagesByCharId(char.id, true);
            const toKeep = allMessages.slice(-10);
            const toKeepIds = new Set(toKeep.map(m => m.id));
            const toDelete = allMessages.filter(m => !toKeepIds.has(m.id));
            if (toDelete.length === 0) {
                addToast('消息太少，无需清理', 'info');
                return;
            }
            const toDeleteIds = toDelete.map(m => m.id);
            await DB.deleteMessages(toDeleteIds);
            discardVoiceForMessages(toDeleteIds);
            setMessages(toKeep);
            setTotalMsgCount(toKeep.length);
            setVisibleCount(LOAD_BATCH_SIZE);
            visibleCountRef.current = LOAD_BATCH_SIZE;
            addToast(`已清理 ${toDelete.length} 条历史，保留最近10条`, 'success');
        } else {
            const allIds = (await DB.getMessagesByCharId(char.id, true)).map(m => m.id);
            await DB.clearMessages(char.id);
            discardVoiceForMessages(allIds);
            setMessages([]);
            setTotalMsgCount(0);
            setVisibleCount(LOAD_BATCH_SIZE);
            visibleCountRef.current = LOAD_BATCH_SIZE;
            const [{ clearMemoryPalaceForChar }, { notifyTakeoutUpdated }] = await Promise.all([
                import('../utils/memoryPalace/db'),
                import('../utils/takeout'),
            ]);
            await Promise.all([
                DB.deleteDailySchedulesByChar(char.id),
                DB.deleteLifeEventsForChar(char.id),
                DB.deleteSocialPostsByChar(char.id),
                DB.deleteXhsFeedPostsByCharId(char.id),
                DB.deleteTwitterDataByCharId(char.id),
                DB.deleteTakeoutOrdersByCharId(char.id),
                DB.deleteInnerVoicesByCharId(char.id),
                DB.deleteScheduledMessagesByCharId(char.id),
                DB.deletePhoneCallLogsByCharId(char.id),
                DB.deleteDiariesByCharId(char.id),
                DB.deleteAnniversariesByCharId(char.id),
                DB.deleteCalendarMarksByCharId(char.id),
                DB.deleteGalleryImagesByCharId(char.id),
                DB.deleteCharLedgerEntriesByCharId(char.id),
                DB.deleteRoomTodosByCharId(char.id),
                DB.deleteRoomNotesByCharId(char.id),
                DB.deleteExchangeDiaryBooksByCharId(char.id),
                DB.deleteTalkSessionsByCharId(char.id),
                DB.deleteGuidebookSessionsByCharId(char.id),
                DB.deleteCollectionItemsByCharId(char.id),
                DB.removeLifeSimCharacterContext(char.id),
                DB.clearXhsActivities(char.id),
                clearMemoryPalaceForChar(char.id),
            ]);
            clearCharacterContextLocalState(char.id);
            notifyTakeoutUpdated();
            await updateCharacter(char.id, {
                memories: [],
                refinedMemories: {},
                activeMemoryMonths: [],
                memos: [],
                selfInsights: [],
                lifeProfile: undefined,
                recenterCalibration: undefined,
                memoryPalaceInjection: undefined,
                hideBeforeMessageId: undefined,
                currentMood: undefined,
                affection: undefined,
                relationship: undefined,
                marriage: undefined,
                activeBuffs: [],
                buffInjection: '',
                coupleSpace: undefined,
                shopReceipts: [],
                shopCart: [],
                generatedTabloids: {},
                guidebookInsights: [],
                savedDateState: undefined,
                specialMomentRecords: undefined,
                savedRoomState: undefined,
                lastRoomDate: undefined,
                phoneState: undefined,
            });
            setScheduleData(null);
            setInnerVoiceHistory([]);
            setInnerVoiceCurrent(null);
            setTakeoutCardTarget(null);
            setTakeoutCardOrder(null);
            addToast('已清空角色上下文，仅保留角色设定', 'success');
        }
        setModalType('none');
    };

    const handleClearChatContextOnly = async () => {
        if (!char) return;

        const allIds = (await DB.getMessagesByCharId(char.id, true)).map(m => m.id);
        await DB.clearMessages(char.id);
        discardVoiceForMessages(allIds);
        setMessages([]);
        setAllHistoryMessages([]);
        setTotalMsgCount(0);
        setHistoryLoaded(true);
        setVisibleCount(LOAD_BATCH_SIZE);
        visibleCountRef.current = LOAD_BATCH_SIZE;
        setReplyTarget(null);
        setSelectionMode(false);
        setSelectedMsgIds(new Set());
        setSelectedThinkingMsgIds(new Set());
        setSelectedMessage(null);
        setSelectedEmoji(null);
        setSelectedCategory(null);
        setShowPanel('none');
        setShowActionSelector(false);
        setWindowedFocusMsgId(null);
        setFlashMsgId(null);
        setScheduleData(null);
        setInnerVoiceHistory([]);
        setInnerVoiceCurrent(null);
        setTakeoutCardTarget(null);
        setTakeoutCardOrder(null);
        setClaimTarget(null);
        setClaimRevealed(false);
        setClaimPwInput('');
        setProposalTarget(null);
        setShowProposeCompose(false);
        setProposeVow('');
        setProposalBusy(false);
        setInstantToolStatus(null);
        setLastTokenUsage(null);
        if (chatAudioRef.current) {
            try { chatAudioRef.current.pause(); } catch { /* ignore */ }
        }
        await updateCharacter(char.id, {
            memoryPalaceInjection: undefined,
            hideBeforeMessageId: undefined,
            recenterCalibration: undefined,
            activeBuffs: [],
            buffInjection: '',
        });
        clearCharacterContextLocalState(char.id, { keepCouplePartner: true });
        setModalType('none');
        addToast('已清空絮语 app 内上下文，仅保留角色设定', 'success');
    };

    const handleForceVectorize = async () => {
        if (!char || !char.memoryPalaceEnabled || isVectorizing) return;
        const { embedding: mpEmb, llm: mpLLM } = resolveMemoryPalaceAuxConfigs(auxApiConfig, memoryPalaceConfig);
        if (!mpEmb || !mpLLM) {
            addToast('请先在文具盒开启并填好副 API', 'error');
            return;
        }

        setIsVectorizing(true);
        setModalType('none');
        addToast('🏰 开始向量化所有聊天记录...', 'info');

        try {
            const { processNewMessages, getMemoryPalaceHighWaterMark, mergePalaceFragmentsIntoMemories } = await import('../utils/memoryPalace/pipeline');
            const BATCH_PROCESS_RATIO = 0.85;
            const BATCH_SIZE = 170; // 200 * 0.85
            let totalProcessed = 0;
            let round = 0;
            const MAX_ROUNDS = 50; // 安全上限
            // 每轮合并进来的 palace MemoryFragment；全部处理完后一次性 updateCharacter
            let accumulatedMemories = char.memories ? [...char.memories] : [];
            let latestHideBefore = char.hideBeforeMessageId;

            while (round < MAX_ROUNDS) {
                round++;
                const hwm = getMemoryPalaceHighWaterMark(char.id);
                const allMessages = await DB.getMessagesByCharId(char.id, true);
                const textMessages = allMessages
                    .filter(m => m.type === 'text' && m.content?.trim())
                    .sort((a, b) => a.id - b.id);

                // 计算未处理的消息
                const unprocessed = textMessages.filter(m => m.id > hwm);
                if (unprocessed.length < 10) break; // 剩余太少，停止

                // 取一批处理
                const batch = unprocessed.slice(0, BATCH_SIZE);
                console.log(`🏰 [ForceVectorize] 第 ${round} 轮：处理 ${batch.length} 条消息（hwm=${hwm}，剩余 ${unprocessed.length}）`);

                const pipelineResult = await processNewMessages(batch, char.id, char.name, mpEmb, mpLLM, userProfile?.name || '', true);

                // 软跳过：缓冲区还没到阈值 / 热区还没被挤出 / 已有任务在跑 —— 不是 LLM 失败
                if (pipelineResult?.skipReason) {
                    if (pipelineResult.skipReason !== 'lock') {
                        addToast('当前聊天不足以触发总结，请保持这个状态聊天~', 'info');
                    }
                    break;
                }

                totalProcessed += batch.length;

                // 累积自动归档，统一在循环结束后 updateCharacter
                // 避免每轮 setState 触发 char 对象重建进而 dep 失效
                // 仅在 char.autoArchiveEnabled 开启时累积；未开启则 palace 仍向量化，但不推 hideBefore
                if (pipelineResult?.autoArchive && (char as any).autoArchiveEnabled) {
                    accumulatedMemories = mergePalaceFragmentsIntoMemories(
                        accumulatedMemories,
                        pipelineResult.autoArchive.fragments,
                    );
                    latestHideBefore = pipelineResult.autoArchive.hideBeforeMessageId;
                }

                // 检查高水位是否前进了（如果没前进说明 LLM 失败了）
                const newHwm = getMemoryPalaceHighWaterMark(char.id);
                if (newHwm <= hwm) {
                    addToast('⚠️ 处理中断：LLM 提取失败，请检查副 API 配置', 'error');
                    break;
                }
            }

            // 隐藏线追平到向量高水位：覆盖「关闭期推进了 hwm 但 hide 被冻结」的历史空档。
            // 只要全自动记忆开着，即便本轮没有新批次也把 hide 追平到 hwm（之前的消息都已向量化）。
            if ((char as any).autoArchiveEnabled) {
                const hwmFinal = getMemoryPalaceHighWaterMark(char.id);
                if (hwmFinal > (latestHideBefore || 0)) latestHideBefore = hwmFinal;
            }

            // 循环结束后把累积的自动归档一次性写回角色
            if (latestHideBefore !== char.hideBeforeMessageId || accumulatedMemories.length !== (char.memories?.length || 0)) {
                updateCharacter(char.id, {
                    memories: accumulatedMemories,
                    hideBeforeMessageId: latestHideBefore,
                } as any);
            }

            if (totalProcessed > 0) {
                addToast(`✅ 向量化完成：${round} 轮处理了约 ${totalProcessed} 条消息`, 'success');
            } else {
                addToast('所有聊天记录都已处理完毕，无需操作', 'info');
            }
        } catch (e: any) {
            addToast(`❌ 向量化失败：${e.message}`, 'error');
        } finally {
            setIsVectorizing(false);
        }
    };

    const handleSetHistoryStart = (messageId: number | undefined) => {
        updateCharacter(char.id, { hideBeforeMessageId: messageId });
        setModalType('none');
        addToast(messageId ? '已隐藏历史消息' : '已恢复全部历史记录', 'success');
    };

    // 跳转到旧消息：加载全量到 messages，再用 windowedFocusMsgId 把 displayMessages
    // 收窄到目标周围 51 条。"回到当前聊天"会把 visibleCount 重置回 30。
    const handleJumpToMessageInChat = async (messageId: number) => {
        if (!activeCharacterId) return;
        setModalType('none');
        const LARGE = 999999;
        visibleCountRef.current = LARGE;
        setVisibleCount(LARGE);
        await reloadMessages(LARGE);
        setWindowedFocusMsgId(messageId);
        setFlashMsgId(messageId);
        // 等下一帧让目标节点挂上 DOM 再滚
        requestAnimationFrame(() => {
            const el = document.getElementById(`chat-msg-${messageId}`);
            el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        window.setTimeout(() => setFlashMsgId(null), 2200);
    };

    const handleBackToCurrent = async () => {
        setWindowedFocusMsgId(null);
        setFlashMsgId(null);
        visibleCountRef.current = 30;
        setVisibleCount(30);
        await reloadMessages(30);
        requestAnimationFrame(() => {
            scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
        });
    };

    const handleFullArchive = async () => {
        // 整理归档（把聊天记录批量总结成档案）属「聊天以外」的辅助任务：走副 API（未配置副 API 时回退主 API）
        const archiveApi = resolveAuxApi(auxApiConfig, apiConfig);
        if (!archiveApi.apiKey || !char) {
            addToast('请先配置 API Key', 'error');
            return;
        }
        const allMessages = await DB.getMessagesByCharId(char.id, true);
        const msgsByDate: Record<string, Message[]> = {};
        allMessages
        .filter(m => !char.hideBeforeMessageId || m.id >= char.hideBeforeMessageId)
        .forEach(m => {
            const d = new Date(m.timestamp);
            const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            if (!msgsByDate[dateStr]) msgsByDate[dateStr] = [];
            msgsByDate[dateStr].push(m);
        });

        const datesToProcess = Object.keys(msgsByDate).sort();
        if (datesToProcess.length === 0) {
            addToast('聊天记录为空，无法归档', 'info');
            return;
        }

        setIsSummarizing(true);
        setShowPanel('none');
        setArchiveProgress(`准备归档 ${datesToProcess.length} 天...`);
        addToast(`开始归档 ${datesToProcess.length} 天聊天记录`, 'info');

        try {
            let processedCount = 0;
            const newMemories: MemoryFragment[] = [];
            const templateObj = archivePrompts.find(p => p.id === selectedPromptId) || DEFAULT_ARCHIVE_PROMPTS[0];
            const template = templateObj.content;

            for (let idx = 0; idx < datesToProcess.length; idx++) {
                const dateStr = datesToProcess[idx];
                setArchiveProgress(`归档中 ${dateStr} (${idx + 1}/${datesToProcess.length})`);
                const dayMsgs = msgsByDate[dateStr];
                const rawLog = dayMsgs
                    .map(m => formatMessageWithTime(m, char.name, userProfile.name, formatTime))
                    .join('\n');
                
                let prompt = template;
                prompt = prompt.replace(/\$\{dateStr\}/g, dateStr);
                prompt = prompt.replace(/\$\{char\.name\}/g, char.name);
                prompt = prompt.replace(/\$\{userProfile\.name\}/g, userProfile.name);
                prompt = prompt.replace(/\$\{rawLog.*?\}/g, rawLog.substring(0, 200000));

                const response = await fetch(`${archiveApi.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${archiveApi.apiKey}` },
                    body: JSON.stringify({
                        model: archiveApi.model,
                        messages: [{ role: "user", content: prompt }],
                        temperature: 0.5,
                        max_tokens: 8000
                    })
                });

                if (!response.ok) throw new Error(`API Error on ${dateStr}`);
                const data = await safeResponseJson(response);
                let summary = extractContent(data);
                summary = summary.replace(/^["']|["']$/g, '').trim();

                if (summary) {
                    newMemories.push({ id: `mem-${Date.now()}-${idx}`, date: dateStr, summary: summary, mood: 'archive' });
                    processedCount++;
                }
                await new Promise(r => setTimeout(r, 500));
            }

            const total = datesToProcess.length;

            if (processedCount === 0) {
                addToast(`归档失败：${total} 天均未生成摘要（请检查 API/模型）`, 'error');
                setModalType('none');
            } else {
                const finalMemories = [...(char.memories || []), ...newMemories];

                // 关键修复：全量归档成功后把 hideBeforeMessageId 推到"倒数第 reserve 条"的位置。
                // 不推的话下次再点归档，hideBefore 过滤没作用，之前已归档的几天会被重总结一遍，
                // 往 char.memories 里堆重复条目。保留最近 max(100, 15%) 条不隐藏（和 palace
                // auto-archive 的 hot-zone 概念对齐），这样聊天 UI 不会突然空掉。
                //
                // 部分失败时不推 hideBefore —— 那几天的原消息没写进 MemoryFragment，推了
                // 就真的读不到了。用户下次重试归档会把失败的那几天补上。
                let newHideBefore = char.hideBeforeMessageId;
                let reservedCount = 0;
                let hiddenCount = 0;
                if (processedCount === total) {
                    const allArchivedMsgs: Message[] = [];
                    for (const d of datesToProcess) allArchivedMsgs.push(...msgsByDate[d]);
                    allArchivedMsgs.sort((a, b) => a.id - b.id);
                    const RESERVE = Math.max(100, Math.ceil(allArchivedMsgs.length * 0.15));
                    if (allArchivedMsgs.length > RESERVE) {
                        const candidate = allArchivedMsgs[allArchivedMsgs.length - RESERVE].id;
                        // 只前进不后退
                        if (!char.hideBeforeMessageId || candidate > char.hideBeforeMessageId) {
                            newHideBefore = candidate;
                            reservedCount = RESERVE;
                            hiddenCount = allArchivedMsgs.length - RESERVE;
                        }
                    }
                }

                const updates: Partial<typeof char> = { memories: finalMemories };
                if (newHideBefore !== char.hideBeforeMessageId) {
                    (updates as any).hideBeforeMessageId = newHideBefore;
                }
                updateCharacter(char.id, updates as any);

                const hideStr = hiddenCount > 0
                    ? `（已隐藏 ${hiddenCount} 条旧消息，保留最近 ${reservedCount} 条可见）`
                    : '';
                if (processedCount < total) {
                    addToast(`归档完成：${processedCount}/${total} 天成功（部分失败，下次再点会补上）`, 'info');
                } else {
                    addToast(`归档完成：成功归档 ${processedCount} 天${hideStr}`, 'success');
                }
                setModalType('none');
            }

        } catch (e: any) {
            addToast(`归档中断: ${e.message}`, 'error');
        } finally {
            setIsSummarizing(false);
            setArchiveProgress('');
        }
    };

    // --- Message Management ---
    const handleDeleteMessage = async () => {
        if (!selectedMessage) return;
        const deletedId = selectedMessage.id;
        await DB.deleteMessage(deletedId);
        discardVoiceForMessages([deletedId]);
        setMessages(prev => prev.filter(m => m.id !== deletedId));
        setTotalMsgCount(prev => Math.max(0, prev - 1));
        setModalType('none');
        setSelectedMessage(null);
        addToast('消息已删除', 'success');
    };

    const confirmEditMessage = async () => {
        if (!selectedMessage) return;
        await DB.updateMessage(selectedMessage.id, editContent);
        setMessages(prev => prev.map(m => m.id === selectedMessage.id ? { ...m, content: editContent } : m));
        setModalType('none');
        setSelectedMessage(null);
        addToast('消息已修改', 'success');
    };

    const handleReplyMessage = () => {
        if (!selectedMessage) return;
        setReplyTarget({
            ...selectedMessage,
            metadata: { ...selectedMessage.metadata, senderName: selectedMessage.role === 'user' ? '我' : char.name }
        });
        setModalType('none');
    };

    // 左滑气泡触发引用：直接拿到该条消息设为回复目标（与长按菜单的「引用/回复」同效）
    const handleSwipeReply = useCallback((msg: Message) => {
        setReplyTarget({
            ...msg,
            metadata: { ...msg.metadata, senderName: msg.role === 'user' ? '我' : char.name }
        });
    }, [char.name]);

    const handleCopyMessage = () => {
        if (!selectedMessage) return;
        navigator.clipboard.writeText(selectedMessage.content);
        setModalType('none');
        setSelectedMessage(null);
        addToast('已复制到剪贴板', 'success');
    };

    const handleCollectMessage = async () => {
        if (!selectedMessage || !char) return;
        const target = selectedMessage;
        const sender = target.role === 'user' ? (userProfile.name || '我') : char.name;
        const kind = messageKindLabel(target);
        const sourceId = `${char.id}:${target.id}`;
        const excerpt = target.type === 'image'
            ? '[图片]'
            : target.type === 'text'
              ? clipForPreview(target.content, 180)
              : `[${kind}] ${clipForPreview(target.content, 120)}`;
        const item: CollectionItem = {
            id: `chat:${sourceId}`,
            sourceType: 'chat',
            sourceId,
            title: `${sender} 的${kind}`,
            subtitle: `来往 · ${char.name} · ${new Date(target.timestamp || Date.now()).toLocaleString()}`,
            excerpt,
            charIds: [char.id],
            cover: target.type === 'image' && isImageUrlLike(target.content) ? target.content : '💬',
            collectedAt: Date.now(),
        };
        try {
            await DB.saveCollectionItem(item);
            await DB.updateMessageMetadata(target.id, (prev: any) => ({ ...(prev || {}), collectedAt: item.collectedAt }));
            setMessages(prev => prev.map(m => m.id === target.id ? { ...m, metadata: { ...(m.metadata || {}), collectedAt: item.collectedAt } } : m));
            addToast('已收进典藏馆', 'success');
        } catch (err) {
            console.warn('[Chat] collect message failed', err);
            addToast('收录失败', 'error');
        } finally {
            setModalType('none');
            setSelectedMessage(null);
        }
    };

    const handlePostMessageToMoments = async () => {
        if (!selectedMessage || !char) return;
        const target = selectedMessage;
        if (target.role === 'system') return;
        const kind = messageKindLabel(target);
        const sender = target.role === 'user' ? (userProfile.name || '我') : char.name;
        const images = target.type === 'image' && isImageUrlLike(target.content) ? [target.content] : [];
        const rawText = target.type === 'text'
            ? clipForPreview(target.content, 240)
            : images.length > 0
              ? '分享了一张聊天里的图片'
              : clipForPreview(target.content || `[${kind}]`, 160);
        const content = target.role === 'user'
            ? `转发了 ${sender} 的${kind}${rawText ? `：\n${rawText}` : ''}`
            : rawText;
        const post: SocialPost = {
            id: `moment-chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            authorName: char.name,
            authorAvatar: char.avatar,
            title: '',
            content,
            images,
            likes: 0,
            isCollected: false,
            isLiked: false,
            comments: [],
            timestamp: Date.now(),
            tags: ['聊天转发'],
            authorType: 'character',
            authorCharId: char.id,
            likedBy: [],
            repostOf: {
                postId: `chat-message-${target.id}`,
                authorName: sender,
                content: target.type === 'text' ? target.content : `[${kind}]`,
                images: images.length > 0 ? images : undefined,
            },
            visibility: 'public',
        };
        try {
            await DB.saveSocialPost(post);
            await DB.saveMessage({
                charId: char.id,
                role: 'system',
                type: 'text',
                content: `「${char.name}」把这条${kind}转发到了此刻`,
                metadata: { momentPostId: post.id, forwardedMessageId: target.id },
            } as any);
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('character-moment-posted', {
                    detail: {
                        charId: char.id,
                        charName: char.name,
                        body: images.length > 0 ? '发了一张聊天图片到此刻' : '发了一条聊天转发到此刻',
                        avatarUrl: char.avatar,
                        postId: post.id,
                    },
                }));
            }
            await reloadMessages(visibleCountRef.current);
            addToast('已让 TA 发到此刻', 'success');
        } catch (err) {
            console.warn('[Chat] post message to moments failed', err);
            addToast('发到此刻失败', 'error');
        } finally {
            setModalType('none');
            setSelectedMessage(null);
        }
    };

    // 撤回消息（QQ/微信语义）：原文存进 metadata.recalledContent 供「重新编辑」，
    // 气泡变成"你撤回了一条消息"，发给角色的上下文只剩"撤回了一条消息"（看不到原文）。
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

    // 表情回应（QQ/微信 tap-to-react）：切换 'user' 对某条消息某表情的回应，落 metadata.reactions。
    const reactToMessage = useCallback(async (target: Message, emoji: string) => {
        if (!target) return;
        const next = toggleReaction(target.metadata?.reactions, emoji, 'user');
        await DB.updateMessageMetadata(target.id, (prev: any) => ({ ...(prev || {}), reactions: next }));
        setMessages(prev => prev.map(m => m.id === target.id ? { ...m, metadata: { ...(m.metadata || {}), reactions: next } } : m));
    }, []);

    // 长按菜单选表情：回应当前选中消息并关闭菜单
    const handleReactMessage = (emoji: string) => {
        if (!selectedMessage) return;
        void reactToMessage(selectedMessage, emoji);
        setModalType('none');
        setSelectedMessage(null);
    };

    // 点已有回应小药丸：切换自己的回应
    const handleReactToggle = useCallback((m: Message, emoji: string) => { void reactToMessage(m, emoji); }, [reactToMessage]);

    // 「重新编辑」：把撤回的原文还原回输入框（微信式）。已有草稿则换行追加，不直接覆盖。
    const handleReeditRecalled = useCallback((m: Message) => {
        const text = (m.metadata?.recalledContent ?? '').toString();
        if (!text) return;
        setInput(prev => {
            const next = prev.trim() ? `${prev}\n${text}` : text;
            localStorage.setItem(draftKey, next);
            return next;
        });
        addToast('已还原到输入框', 'info');
    }, [draftKey]);

    const handleDeleteEmoji = async () => {
        if (!selectedEmoji) return;
        const emojisToDelete = Array.isArray(selectedEmoji) ? selectedEmoji : [selectedEmoji];
        try {
            await Promise.all(emojisToDelete.map(emoji => DB.deleteEmoji(emoji.name)));
            addToast(Array.isArray(selectedEmoji) ? `撕下了 ${selectedEmoji.length} 张贴纸` : '贴纸撕下来了', 'success');
        } catch (err) {
            console.error('Failed to delete emojis:', err);
            addToast('贴纸没撕下来，再试一次', 'error');
        } finally {
            await loadEmojiData();
            setModalType('none');
            setSelectedEmoji(null);
        }
    };

    // --- Batch Selection ---
    const handleEnterSelectionMode = () => {
        if (selectedMessage) {
            setSelectedMsgIds(new Set([selectedMessage.id]));
            setSelectionMode(true);
            setModalType('none');
            setSelectedMessage(null);
        }
    };

    const toggleMessageSelection = useCallback((id: number) => {
        setSelectedMsgIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const toggleThinkingSelection = useCallback((id: number) => {
        setSelectedThinkingMsgIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    // Memoized callbacks for MessageItem to avoid busting React.memo
    const handleMessageLongPress = useCallback((msg: Message) => {
        setSelectedMessage(msg);
        setModalType('message-options');
    }, []);

    const handleBatchDelete = async () => {
        const msgIdsToDelete = new Set<number>(selectedMsgIds);
        // 思维链单独勾选、但宿主消息没选 -> 只清 metadata.thinkingChain，保留消息
        const thinkingIdsToClear = new Set<number>();
        selectedThinkingMsgIds.forEach(id => {
            if (!msgIdsToDelete.has(id)) thinkingIdsToClear.add(id);
        });
        if (msgIdsToDelete.size === 0 && thinkingIdsToClear.size === 0) return;

        // 删消息时，如果它身上的思维链没被勾选，就尝试迁移到同一轮里下一条 assistant 消息上，
        // 让"只想删第一条输出，但想留思维链"成立
        const sorted = [...messages].sort((a, b) => a.id - b.id);
        const idxById = new Map<number, number>();
        sorted.forEach((m, i) => idxById.set(m.id, i));
        const migrations: { targetId: number; chain: string }[] = [];
        msgIdsToDelete.forEach(id => {
            const msg = messages.find(x => x.id === id);
            const chain = msg?.metadata?.thinkingChain;
            if (!msg || !chain) return;
            if (selectedThinkingMsgIds.has(id)) return; // 用户主动连思维链一起删
            const startIdx = idxById.get(id);
            if (startIdx == null) return;
            for (let i = startIdx + 1; i < sorted.length; i++) {
                const next = sorted[i];
                if (next.role !== 'assistant') break; // 出了这一轮，没法挂靠了
                if (msgIdsToDelete.has(next.id)) continue;
                migrations.push({ targetId: next.id, chain: String(chain) });
                break;
            }
        });

        for (const mig of migrations) {
            await DB.updateMessageMetadata(mig.targetId, (prev) => ({ ...(prev || {}), thinkingChain: mig.chain }));
        }
        for (const id of thinkingIdsToClear) {
            await DB.updateMessageMetadata(id, (prev) => {
                if (!prev || !('thinkingChain' in prev)) return prev;
                const { thinkingChain, ...rest } = prev;
                return rest;
            });
        }
        const ids = Array.from(msgIdsToDelete);
        if (ids.length > 0) {
            await DB.deleteMessages(ids);
            discardVoiceForMessages(ids);
        }

        const migMap = new Map(migrations.map(m => [m.targetId, m.chain]));
        setMessages(prev => prev
            .filter(m => !msgIdsToDelete.has(m.id))
            .map(m => {
                if (migMap.has(m.id)) {
                    return { ...m, metadata: { ...(m.metadata || {}), thinkingChain: migMap.get(m.id) } };
                }
                if (thinkingIdsToClear.has(m.id) && m.metadata?.thinkingChain) {
                    const { thinkingChain, ...rest } = m.metadata;
                    return { ...m, metadata: rest };
                }
                return m;
            })
        );
        setTotalMsgCount(prev => Math.max(0, prev - msgIdsToDelete.size));

        const parts: string[] = [];
        if (msgIdsToDelete.size > 0) parts.push(`已删除 ${msgIdsToDelete.size} 条消息`);
        if (thinkingIdsToClear.size > 0) parts.push(`已清除 ${thinkingIdsToClear.size} 条思维链`);
        addToast(parts.join('，'), 'success');

        setSelectionMode(false);
        setSelectedMsgIds(new Set());
        setSelectedThinkingMsgIds(new Set());
    };

    // --- Forward Chat Records ---
    const [showForwardModal, setShowForwardModal] = useState(false);

    const handleForwardSelected = () => {
        if (selectedMsgIds.size === 0) return;
        setShowForwardModal(true);
    };

    // 单条转发（QQ/微信式「转发」）：从长按菜单直接把这一条转给别的角色，
    // 复用多选转发的同一套选人 + chat_forward 落卡逻辑（只是只勾这一条）。
    const handleForwardSingle = () => {
        if (!selectedMessage) return;
        setSelectedMsgIds(new Set([selectedMessage.id]));
        setModalType('none');
        setSelectedMessage(null);
        setShowForwardModal(true);
    };

    const handleForwardToCharacter = async (targetCharId: string) => {
        if (!char) return;
        const selectedMsgs = messages
            .filter(m => selectedMsgIds.has(m.id))
            .sort((a, b) => a.id - b.id);

        if (selectedMsgs.length === 0) return;

        // Build preview text (first few messages)
        const previewLines = selectedMsgs.slice(0, 4).map(m => {
            const sender = m.role === 'user' ? userProfile.name : char.name;
            const text = m.type === 'text' ? m.content.slice(0, 30) : `[${m.type === 'image' ? '图片' : m.type === 'emoji' ? '表情' : m.type}]`;
            return `${sender}: ${text}`;
        });
        if (selectedMsgs.length > 4) previewLines.push(`... 共 ${selectedMsgs.length} 条消息`);

        const forwardData = {
            fromUserName: userProfile.name,
            fromCharName: char.name,
            count: selectedMsgs.length,
            preview: previewLines,
            messages: selectedMsgs.map(m => ({
                role: m.role,
                type: m.type,
                content: m.content,
                timestamp: m.timestamp || Date.now()
            }))
        };

        // Save forward card to target character's chat
        await DB.saveMessage({
            charId: targetCharId,
            role: 'user',
            type: 'chat_forward' as MessageType,
            content: JSON.stringify(forwardData),
        });

        // Also save a copy in the current chat so the user can see what they forwarded
        const targetChar = characters.find(c => c.id === targetCharId);
        if (char.id !== targetCharId) {
            await DB.saveMessage({
                charId: char.id,
                role: 'system',
                type: 'text' as MessageType,
                content: `[转发了 ${selectedMsgs.length} 条聊天记录给 ${targetChar?.name || ''}]`,
            });
            // Refresh messages to show the forwarding system message
            reloadMessages(visibleCountRef.current);
        }

        addToast(`已转发 ${selectedMsgs.length} 条记录给 ${targetChar?.name || ''}`, 'success');
        setShowForwardModal(false);
        setSelectionMode(false);
        setSelectedMsgIds(new Set());
    };

    // hideBeforeMessageId 不在视觉层过滤：用户依旧能往上翻到旧消息，只是 LLM 拉不到。
    // 真正想从聊天记录里抹掉，应该走"删除"。
    // windowed 模式：定位到旧消息时只渲染目标周围 51 条，避免 DOM 卡爆。
    const displayMessages = useMemo(() => {
        // 正则脚本显示层（markdownOnly）：只改气泡渲染内容，不改写消息原文。
        // 在传给 MessageItem 之前替换 content，memo 比较 msg.content 即可正确失效。
        // depth 同 ST 语义（0 = 最后一条），让 minDepth/maxDepth 的显示层脚本按深度生效。
        const withDisplayRegex = (list: Message[]): Message[] => list.map((m, idx) => {
            if (m.type !== 'text' || m.role === 'system' || typeof m.content !== 'string' || !m.content) return m;
            const placement = m.role === 'user' ? regex_placement.USER_INPUT : regex_placement.AI_OUTPUT;
            const out = applyRegexToText(m.content, placement, {
                char, userName: userProfile?.name, isMarkdown: true, depth: list.length - 1 - idx,
            });
            return out === m.content ? m : { ...m, content: out };
        });
        const base = messages
            .filter(m => m.metadata?.source !== 'date' && m.metadata?.source !== 'call')
            .filter(m => !m.metadata?.proactiveHint);
        if (windowedFocusMsgId !== null) {
            const idx = base.findIndex(m => m.id === windowedFocusMsgId);
            if (idx >= 0) {
                const start = Math.max(0, idx - WINDOW_RADIUS);
                const end = Math.min(base.length, idx + WINDOW_RADIUS + 1);
                return withDisplayRegex(base.slice(start, end));
            }
        }
        return withDisplayRegex(base.slice(-visibleCount));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messages, char?.id, char?.regexScripts, visibleCount, windowedFocusMsgId, regexVersion]);

    const renderMessages = useMemo(() => {
        if (windowedFocusMsgId !== null || selectionMode) return displayMessages;
        return displayMessages.filter(m => m.role !== 'assistant' || revealedAssistantIds.has(m.id));
    }, [displayMessages, revealedAssistantIds, windowedFocusMsgId, selectionMode]);

    const collapsedCount = Math.max(0, totalMsgCount - displayMessages.length);

    // 行动选择器入口：最后一条 user 消息的 id（点它的头像可生成「接下来说点啥」选项）。
    const lastUserMsgId = useMemo(() => {
        for (let i = renderMessages.length - 1; i >= 0; i--) {
            if (renderMessages[i].role === 'user') return renderMessages[i].id;
        }
        return null;
    }, [renderMessages]);

    // 稳定的思维链配置对象：只在角色/样式变化时重建，避免每次渲染新建对象击穿 MessageItem.memo。
    const thinkingChainOptions = useMemo(() => ({
        styleId: (char as any)?.thinkingChainStyle || 'echo',
        customColors: (char as any)?.thinkingChainCustomColors,
        onOpenSettings: () => setShowThinkingChainModal(true),
    }), [(char as any)?.thinkingChainStyle, (char as any)?.thinkingChainCustomColors]);

    // Reset active category if it becomes invisible for the current character
    useEffect(() => {
        if (activeCategory !== 'default' && visibleCategories.length > 0 && !visibleCategories.some(c => c.id === activeCategory)) {
            setActiveCategory('default');
        }
    }, [visibleCategories, activeCategory]);

    // Build a set of hidden category IDs for quick lookup
    const hiddenCategoryIds = useMemo(() => {
        const visible = new Set(visibleCategories.map(c => c.id));
        return new Set(categories.filter(c => !visible.has(c.id)).map(c => c.id));
    }, [categories, visibleCategories]);

    // Memoize filtered emojis for ChatInputArea
    const filteredEmojis = useMemo(() => emojis.filter(e => {
        // Exclude emojis from hidden categories
        if (e.categoryId && hiddenCategoryIds.has(e.categoryId)) return false;
        if (activeCategory === 'default') return !e.categoryId || e.categoryId === 'default';
        return e.categoryId === activeCategory;
    }), [emojis, activeCategory, hiddenCategoryIds]);

    // 全量可见表情（只排除隐藏分类，不按当前分类切）——表情面板搜索时跨分类匹配
    const allVisibleEmojis = useMemo(() => emojis.filter(e => !(e.categoryId && hiddenCategoryIds.has(e.categoryId))), [emojis, hiddenCategoryIds]);

    // Memoize ChatInputArea callbacks
    const handleSendCallback = useCallback(
        () => handleSendText(),
        [char, input, replyTarget, parallelReplyEnabled, parallelReplyTargets, auxApiConfig, apiConfig, userProfile],
    );

    // ── 会话设置（聊天设置面板）派生值：备注名 / 头像覆盖 / 时间戳等 ──
    const convo = char?.convoSettings;
    const displayCharName = convo?.remarkName?.trim() || char?.name || '';
    const displayCharAvatar = convo?.charAvatarOverride || char?.avatar || '';
    const displayUserAvatar = convo?.userAvatarOverride || userProfile.avatar;
    const headerChar = useMemo(
        () => (char && (displayCharName !== char.name || displayCharAvatar !== char.avatar))
            ? { ...char, name: displayCharName, avatar: displayCharAvatar }
            : char,
        [char, displayCharName, displayCharAvatar]
    );
    // 表情分类条数统计（会话设置「表情分类总览」用）
    const emojiCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const e of emojis) {
            const k = e.categoryId || 'default';
            counts[k] = (counts[k] || 0) + 1;
        }
        return counts;
    }, [emojis]);

    // 导出聊天记录（会话设置 06 数据）
    const handleExportChat = () => {
        if (!char) return;
        try {
            const source = (allHistoryMessages && allHistoryMessages.length > 0) ? allHistoryMessages : messages;
            const data = {
                type: 'moro_chat_export',
                character: { id: char.id, name: char.name },
                exportedAt: new Date().toISOString(),
                count: source.length,
                messages: source,
            };
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `moro_chat_${char.name}_${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 5000);
            addToast('聊天记录已导出', 'success');
        } catch {
            addToast('导出失败', 'error');
        }
    };
    // 兜底：正常情况下 OSContext 启动时一定会保底一个角色，char 不该为空。
    // 但若 init 期间某个 store 读取失败（数据其实还在 IndexedDB 里），characters 可能暂时为空，
    // 此时下面 char.chatBackground 会直接抛 "undefined is not an object" 把整个 App 崩到错误页。
    // 这里给个温和空态，避免硬崩，也好让用户能退回桌面/重启恢复。
    if (!char) {
        return (
            <div className="flex flex-col items-center justify-center h-full bg-[#f1f5f9] text-center px-8 gap-3">
                <div className="text-4xl">💤</div>
                <div className="text-slate-600 text-sm font-medium">暂时没有可用的角色</div>
                <div className="text-slate-400 text-xs leading-relaxed">数据可能未加载完成。请退回桌面后重新进入；若仍为空，重启应用即可恢复。</div>
                <button onClick={closeApp} className="mt-2 px-4 py-2 rounded-full bg-slate-800 text-white text-xs">返回桌面</button>
            </div>
        );
    }

    const chatChromeStyle = osTheme.chatChromeStyle || 'soft';
    const chatBackgroundStyle = osTheme.chatBackgroundStyle || 'plain';
    const chatRootClass =
        chatChromeStyle === 'pixel'
            ? 'flex flex-col h-full bg-[#efe1cf] overflow-hidden relative font-sans transition-[background-image,background-color] duration-500'
            : chatChromeStyle === 'flat'
              ? 'flex flex-col h-full bg-white overflow-hidden relative font-sans transition-[background-image,background-color] duration-500'
              : chatChromeStyle === 'floating'
                ? 'flex flex-col h-full bg-[#eef2ff] overflow-hidden relative font-sans transition-[background-image,background-color] duration-500'
                : 'flex flex-col h-full bg-[#ededed] overflow-hidden relative font-sans transition-[background-image,background-color] duration-500';
    const chatRootStyle: React.CSSProperties = char.chatBackground
        ? {
            backgroundImage: `url(${char.chatBackground})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
        }
        : chatBackgroundStyle === 'grid'
          ? {
              backgroundColor: chatChromeStyle === 'pixel' ? '#efe1cf' : '#f8fafc',
              backgroundImage:
                  'linear-gradient(rgba(148,163,184,0.14) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.14) 1px, transparent 1px)',
              backgroundSize: '20px 20px',
            }
          : chatBackgroundStyle === 'paper'
            ? {
                backgroundColor: chatChromeStyle === 'pixel' ? '#f4e8d9' : '#f9f7f2',
                backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(148,163,184,0.12) 1px, transparent 0)',
                backgroundSize: '16px 16px',
              }
            : chatBackgroundStyle === 'mesh'
              ? {
                  backgroundColor: '#f8fafc',
                  backgroundImage:
                      'radial-gradient(circle at 15% 20%, rgba(59,130,246,0.18), transparent 28%), radial-gradient(circle at 85% 15%, rgba(244,114,182,0.18), transparent 24%), radial-gradient(circle at 60% 75%, rgba(45,212,191,0.18), transparent 26%)',
                }
              : {
                  backgroundImage: 'none',
                };
    // 进入/切换的过场由 CharacterEntryTransition 覆盖层负责，根容器不再自己做淡入。
    const finalRootClass = chatRootClass;
    const finalRootStyle = chatRootStyle;
    const chatAvatarSizeClass = osTheme.chatAvatarSize === 'small' ? 'w-7 h-7' : osTheme.chatAvatarSize === 'large' ? 'w-12 h-12' : 'w-9 h-9';
    const chatAvatarRadiusClass = osTheme.chatAvatarShape === 'square' ? 'rounded-sm' : osTheme.chatAvatarShape === 'rounded' ? 'rounded-xl' : 'rounded-full';
    const chatPendingAvatarClass = `${chatAvatarSizeClass} ${chatAvatarRadiusClass} object-cover`;

    return (
        <div
            className={`moro-chat-root moro-laiwang ${finalRootClass}`}
            style={finalRootStyle}
        >
             {/* 白框自定义 CSS：仅保留全局外观设置，作用于 .moro-chat-* 各零件。 */}
             {osTheme.chatChromeCustomCss && <style>{osTheme.chatChromeCustomCss}</style>}
             {/* 会话设置「背景图」：顶栏背景 / 底部输入栏背景，走 .moro-chat-* 白框钩子注入 */}
             {(convo?.headerBgImage || convo?.inputBarImage) && (
               <style>{[
                   convo?.headerBgImage ? `.moro-chat-header{background-image:url(${convo.headerBgImage}) !important;background-size:cover !important;background-position:center !important;}` : '',
                   convo?.inputBarImage ? `.moro-chat-inputbar{background-image:url(${convo.inputBarImage}) !important;background-size:cover !important;background-position:center !important;}` : '',
               ].filter(Boolean).join('\n')}</style>
             )}
             {/* 守护样式（注在用户 CSS 之后）：保证返回键永远可见可点 —— 防止坏 CSS 把它隐藏/变透明/拦截点击，
                 让用户在样式写崩时仍能退出聊天（再去「外观→聊天界面→一键还原」清掉坏 CSS）。不锁位置，正常挪位仍可用。 */}
             {osTheme.chatChromeCustomCss && (
               <style>{`.moro-chat-back{visibility:visible!important;opacity:1!important;pointer-events:auto!important;}`}</style>
             )}
             {/* 角色「登场」过场：切换/进入时以 ta 的头像氛围铺底登场，再推进穿过进入聊天。key 切换即重放。 */}
             {showEntry && char && (
               <CharacterEntryTransition
                 key={activeCharacterId}
                 name={displayCharName}
                 avatar={displayCharAvatar}
                 onDone={() => setShowEntry(false)}
               />
             )}

             {activeTheme.customCss && <style>{activeTheme.customCss}</style>}


             {/* 记忆整理中 — 顶部浮动胶囊（不阻塞交互，轻量无 backdrop-filter） */}
             {memoryPalaceStatus && (
                 <div
                     className="absolute top-[76px] left-1/2 z-[150] animate-fade-in"
                     style={{
                         transform: 'translateX(-50%)',
                         pointerEvents: 'none',
                         willChange: 'transform, opacity',
                     }}
                 >
                     <div
                         className="flex items-center gap-2.5 pl-2.5 pr-3.5 py-2 max-w-[18rem]"
                         style={{
                             background: 'rgba(255,255,255,0.88)',
                             borderRadius: 999,
                             border: '1px solid rgba(99,102,241,0.18)',
                             boxShadow: '0 6px 18px -6px rgba(15,23,42,0.22)',
                         }}
                     >
                         <span
                             className="shrink-0 inline-block w-3.5 h-3.5 rounded-full border-2 border-slate-200 animate-spin"
                             style={{ borderTopColor: '#6366f1', animationDuration: '0.9s' }}
                         />
                         <span className="text-[11px] font-semibold text-slate-700 whitespace-nowrap">
                             {char?.name || '角色'}正在沉思
                         </span>
                         <span className="text-[10px] text-slate-400 truncate">{memoryPalaceStatus}</span>
                     </div>
                 </div>
             )}


             {/* 记忆整理结果 — 弹窗（高级感） */}
             {memoryPalaceResult && (
                 <div
                     className="absolute inset-0 z-[200] flex items-center justify-center p-4 animate-fade-in"
                     style={{
                         pointerEvents: 'all',
                         background: 'rgba(15,23,42,0.55)',
                     }}
                     onClick={() => setMemoryPalaceResult(null)}
                 >
                     <div
                         className="w-full max-w-sm max-h-[82vh] overflow-hidden flex flex-col relative"
                         style={{
                             background: 'linear-gradient(160deg, #ffffff 0%, #f8fafc 100%)',
                             borderRadius: 28,
                             border: '1px solid rgba(148,163,184,0.18)',
                             boxShadow: '0 20px 50px -20px rgba(15,23,42,0.35)',
                         }}
                         onClick={(e) => e.stopPropagation()}
                     >
                         <div
                             className="absolute top-0 left-0 right-0 h-[2px] pointer-events-none"
                             style={{ background: 'linear-gradient(90deg, transparent, #6366f1, #a5b4fc, #6366f1, transparent)' }}
                         />
                         <div className="px-6 pt-7 pb-4 text-center">
                             <div
                                 className="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center mb-3"
                                 style={{
                                     background: 'linear-gradient(135deg, rgba(99,102,241,0.12), rgba(129,140,248,0.06))',
                                     border: '1px solid rgba(99,102,241,0.15)',
                                 }}
                             >
                                 <span style={{ fontSize: 26 }}>🗂️</span>
                             </div>
                             <div className="text-[10px] tracking-[0.25em] uppercase font-semibold" style={{ color: '#6366f1' }}>Memory Palace</div>
                             <p className="text-[17px] font-bold mt-1" style={{ color: '#0f172a' }}>记忆整理完成</p>
                             <p className="text-[11px] text-slate-400 mt-1">
                                 新增 {memoryPalaceResult.stored} 条 · 去重跳过 {memoryPalaceResult.skipped} 条
                                 {memoryPalaceResult.batches.length > 1 && ` · ${memoryPalaceResult.batches.length} 批`}
                             </p>
                             {memoryPalaceResult.batches.some(b => !b.ok) && (
                                 <p className="text-[10px] text-red-500 mt-1">
                                     {memoryPalaceResult.batches.filter(b => !b.ok).map(b => `batch ${b.index} 失败`).join(', ')}
                                 </p>
                             )}
                         </div>
                         <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-2 no-scrollbar">
                             {memoryPalaceResult.memories.map((m, i) => {
                                 const roomMeta: Record<string, { label: string; color: string }> = {
                                     living_room: { label: '客厅', color: '#f59e0b' },
                                     bedroom: { label: '卧室', color: '#8b5cf6' },
                                     study: { label: '书房', color: '#0ea5e9' },
                                     user_room: { label: '用户房间', color: '#d8a5b7' },
                                     self_room: { label: '自我房间', color: '#10b981' },
                                     attic: { label: '阁楼', color: '#6366f1' },
                                     windowsill: { label: '窗台', color: '#14b8a6' },
                                 };
                                 const meta = roomMeta[m.room] || { label: m.room, color: '#64748b' };
                                 return (
                                     <div
                                         key={i}
                                         className="p-3 rounded-2xl"
                                         style={{
                                             background: 'rgba(255,255,255,0.75)',
                                             border: `1px solid ${meta.color}22`,
                                             boxShadow: `0 2px 8px ${meta.color}14, inset 0 1px 0 rgba(255,255,255,0.8)`,
                                         }}
                                     >
                                         <div className="flex items-center gap-2 mb-1.5">
                                             <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                                                 style={{ background: `${meta.color}18`, color: meta.color }}
                                             >
                                                 {meta.label}
                                             </span>
                                             <span className="text-[10px] text-slate-400">{m.mood}</span>
                                             <span className="text-[10px] font-bold ml-auto" style={{ color: '#f59e0b' }}>{'★'.repeat(Math.min(m.importance, 5))}</span>
                                         </div>
                                         <p className="text-[12px] text-slate-700 leading-relaxed">{m.content}</p>
                                         {m.tags.length > 0 && (
                                             <div className="flex gap-1 mt-2 flex-wrap">
                                                 {m.tags.map((t, j) => (
                                                     <span key={j} className="text-[9px] px-1.5 py-0.5 rounded-full"
                                                         style={{ background: 'rgba(148,163,184,0.15)', color: '#64748b' }}
                                                     >{t}</span>
                                                 ))}
                                             </div>
                                         )}
                                     </div>
                                 );
                             })}
                             {memoryPalaceResult.memories.length === 0 && (
                                 <p className="text-center text-xs text-slate-400 py-4">本次未提取到新记忆</p>
                             )}
                         </div>
                         <div className="px-6 pb-6 pt-2">
                             <button
                                 onClick={() => setMemoryPalaceResult(null)}
                                 className="w-full py-3 text-white text-[13px] font-bold rounded-2xl active:scale-[0.98] transition-transform"
                                 style={{
                                     background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
                                     boxShadow: '0 6px 18px -6px rgba(79,70,229,0.5)',
                                 }}
                             >
                                 确认
                             </button>
                         </div>
                     </div>
                 </div>
             )}

             {/* 语音通话拨号中覆盖层：呼叫 → 角色决策 → 接通跳电话 App / 未接听 */}
             {voiceCallPhase !== 'none' && char && (
                <div
                    className="fixed inset-0 z-[120] flex flex-col items-center justify-center animate-fade-in"
                    style={{
                        backgroundColor: '#fbf2ee',
                        backgroundImage: 'radial-gradient(rgba(242,157,176,0.2) 1.2px, transparent 1.2px)',
                        backgroundSize: '18px 18px',
                    }}
                >
                    <div className="text-[9px] font-bold tracking-[0.4em] uppercase mb-8 select-none" style={{ ...MONO_STACK, color: voiceCallPhase === 'dialing' ? '#d18ba0' : '#b3a3ad' }}>
                        {voiceCallPhase === 'dialing' ? '☎ Calling — Hold On' : '☎ No Answer Today'}
                    </div>
                    <div className="relative mb-7">
                        {voiceCallPhase === 'dialing' && (
                            <>
                                <span className="absolute -inset-3 rounded-[18px] border-2 animate-ping" style={{ borderColor: 'rgba(216,165,183,0.45)' }} />
                                <span className="absolute -inset-6 rounded-[22px] border animate-ping" style={{ borderColor: 'rgba(216,165,183,0.28)', animationDelay: '0.4s' }} />
                                <span className="absolute -inset-9 rounded-[26px] border animate-ping" style={{ borderColor: 'rgba(216,165,183,0.14)', animationDelay: '0.8s' }} />
                            </>
                        )}
                        {/* 淡色拍立得相框 */}
                        <div className="relative bg-white p-2 pb-7 rounded-[8px]" style={{ border: '1px solid #eed6df', boxShadow: '0 12px 28px -18px rgba(122,90,114,0.38)' }}>
                            <img src={char.avatar} className="relative w-24 h-24 object-cover" alt={char.name} />
                            <span className="absolute bottom-1.5 left-0 right-0 text-center text-[9px] select-none" style={{ ...MONO_STACK, color: '#a892a3' }}>
                                {voiceCallPhase === 'dialing' ? 'ring ring…' : 'missed'}
                            </span>
                        </div>
                    </div>
                    <div className="text-xl font-bold mb-1.5" style={{ ...SERIF_STACK, color: '#3d2f3d' }}>{char.name}</div>
                    <div className="text-[13px] mb-12" style={{ color: '#7a5a72' }}>
                        {voiceCallPhase === 'dialing' ? '铃声已经响过去了，等 TA 把听筒拿起来…' : '这回 TA 没接到，晚点再拨一次吧'}
                    </div>
                    {voiceCallPhase === 'dialing' && (
                        <button
                            onClick={() => { void cancelVoiceCall(); }}
                            className="w-16 h-16 rounded-full flex items-center justify-center active:translate-y-[2px] active:shadow-none transition-all"
                            style={{ background: '#d8a5b7', color: '#fffdfa', border: '1.5px solid #c98ba0', boxShadow: '0 12px 24px -16px rgba(122,90,114,0.55)' }}
                            aria-label="挂断这通呼叫"
                        >
                            <PhoneSlash className="w-7 h-7" weight="fill" />
                        </button>
                    )}
                </div>
             )}

             {/* 锁机：设置面板。真正锁住后进入下面的全屏黑屏脚本层。 */}
             {showPhoneLockModal && char && (() => {
                const questionForms = getPhoneLockQuestionForms();
                const fieldLabelStyle: React.CSSProperties = { ...MONO_STACK, color: INK_SOFT };
                const softPanelStyle: React.CSSProperties = { background: '#fffdfa', border: '1px solid #eed6df', boxShadow: '0 10px 24px -20px rgba(122,90,114,0.34)' };
                return (
                    <JournalSheet
                        open={showPhoneLockModal}
                        title="锁住 Ta 的手机"
                        en="PHONE LOCK"
                        sub="把一张只给 Ta 看的小纸条贴到黑屏上"
                        tape="rose"
                        pattern="plain"
                        paper="plain"
                        tall
                        zClass="z-[140]"
                        onClose={() => { if (!phoneLockRunning) setShowPhoneLockModal(false); }}
                        footer={<>
                            <SealBtn kind="ghost" onClick={() => setShowPhoneLockModal(false)} disabled={phoneLockRunning}>取消</SealBtn>
                            <SealBtn kind="rose" onClick={() => { void runPhoneLock(); }} disabled={phoneLockRunning || !sanitizePhoneLockPasscode(phoneLockCode)}>
                                {phoneLockRunning ? `${char.name} 正在输入...` : '开始锁屏'}
                            </SealBtn>
                        </>}
                    >
                        <div className="space-y-4">
                            <div className="flex items-center gap-3 rounded-[20px] px-3 py-3" style={{ background: '#fff4f7', border: '1px solid #eed6df' }}>
                                <div className="-rotate-2 shrink-0 bg-white p-1.5 pb-5 rounded-[6px] shadow-[0_10px_20px_-16px_rgba(122,90,114,0.45)] border border-[#f0dce4] relative">
                                    <img src={char.avatar} className="w-16 h-16 object-cover rounded-[4px]" alt="" />
                                    <span className="absolute bottom-1.5 left-1.5 right-1.5 text-center text-[8.5px] truncate" style={{ ...MONO_STACK, color: INK_SOFT }}>
                                        {char.name}
                                    </span>
                                </div>
                                <div className="min-w-0">
                                    <div className="text-[12px] font-black" style={{ color: INK }}>锁屏小题</div>
                                    <div className="mt-1 text-[11px] leading-relaxed" style={{ color: INK_SOFT }}>
                                        题干你来写；A/B 两边都填时，Ta 会自己选一项。题目只用来交流，只有口令答对才会解锁。
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-3">
                                {phoneLockQuestions.map((q, i) => (
                                    <div key={i} className="rounded-[18px] px-3.5 py-3.5 space-y-3" style={softPanelStyle}>
                                        <div className="flex items-center justify-between">
                                            <div className="text-[13px] font-black" style={{ color: INK }}>第 {i + 1} 题</div>
                                            <div className="text-[8.5px] tracking-[0.22em] uppercase" style={fieldLabelStyle}>QUESTION</div>
                                        </div>
                                        <textarea
                                            rows={3}
                                            value={q.stem}
                                            onChange={e => updatePhoneLockQuestion(i, { stem: e.target.value })}
                                            placeholder="写给 Ta 的题目"
                                            className="w-full rounded-[16px] px-3 py-2.5 text-[13px] leading-relaxed resize-none outline-none placeholder:text-slate-400"
                                            style={{ background: '#fff', border: '1px solid #e8cbd6', color: INK, boxShadow: 'inset 0 1px 2px rgba(38,38,38,0.03)', caretColor: '#d8a5b7' }}
                                        />
                                        <div className="grid grid-cols-2 gap-3">
                                            <LinedInput
                                                value={q.optionA}
                                                onChange={e => updatePhoneLockQuestion(i, { optionA: e.target.value })}
                                                placeholder="A 可选"
                                            />
                                            <LinedInput
                                                value={q.optionB}
                                                onChange={e => updatePhoneLockQuestion(i, { optionB: e.target.value })}
                                                placeholder="B 可选"
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <div className="text-[9px] tracking-[0.22em] uppercase mb-1.5" style={fieldLabelStyle}>ANSWER</div>
                                    <LinedInput
                                        value={phoneLockCode}
                                        onChange={e => { setPhoneLockCode(sanitizePhoneLockPasscode(e.target.value)); resetPhoneLockSession(); }}
                                        placeholder="口令答案"
                                    />
                                </div>
                                <div>
                                    <div className="text-[9px] tracking-[0.22em] uppercase mb-1.5" style={fieldLabelStyle}>CLUE</div>
                                    <LinedInput
                                        value={phoneLockNote}
                                        onChange={e => { setPhoneLockNote(e.target.value); resetPhoneLockSession(); }}
                                        placeholder="口令提示"
                                    />
                                </div>
                            </div>

                            <div className="flex items-center justify-between gap-3 pt-1">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setPhoneLockQuestions(prev => [...prev, makeEmptyPhoneLockQuestion()].slice(0, 3));
                                        resetPhoneLockSession();
                                    }}
                                    disabled={phoneLockQuestions.length >= 3}
                                    className="px-4 py-2.5 rounded-full text-[12px] font-bold active:scale-95 disabled:opacity-35"
                                    style={{ background: '#fffdfa', border: '1px solid #eed6df', color: INK }}
                                >再加一题</button>

                                <button
                                    type="button"
                                    onClick={() => setPhoneLockSameScreenChat(v => !v)}
                                    className="inline-flex items-center gap-2 rounded-full px-2.5 py-1.5 active:scale-95"
                                    style={{ background: phoneLockSameScreenChat ? '#fff4f7' : '#fffdfa', border: '1px solid #eed6df', color: INK }}
                                >
                                    <span className="relative w-[42px] h-[24px] rounded-full transition-colors" style={{ background: phoneLockSameScreenChat ? '#d8a5b7' : '#ebe7e2' }}>
                                        <span className="absolute top-[3px] w-[18px] h-[18px] rounded-full bg-white transition-all" style={{ left: phoneLockSameScreenChat ? 21 : 3, boxShadow: '0 2px 6px rgba(38,38,38,0.18)' }} />
                                    </span>
                                    <span className="text-[12px] font-black">题后同屏聊</span>
                                </button>
                            </div>
                        </div>
                    </JournalSheet>
                );
             })()}

             {/* 锁机：全屏黑屏脚本层。角色自行选题，用户点屏继续；等待回应时可直接同屏输入。 */}
             {phoneLockScreenOpen && char && (() => {
                const questionForms = getPhoneLockQuestionForms();
                const currentQuestion = questionForms[Math.min(phoneLockScreenIndex, questionForms.length - 1)] || questionForms[0];
                const currentAnswer = phoneLockAttempt?.answers[phoneLockScreenIndex] || '';
                const isChatMode = phoneLockScreenPhase === 'chat';
                const hasBinaryOptions = !!currentQuestion?.optionA.trim() && !!currentQuestion?.optionB.trim();
                const questionCount = Math.max(questionForms.length, 1);
                const questionProgress = `第 ${Math.min(phoneLockScreenIndex + 1, questionCount)} / ${questionCount} 题`;
                const passcodeAnswer = phoneLockAttempt?.passcodeInput || '';
                const isPasscodeOnly = !!phoneLockAttempt && (phoneLockAttempt.unlockReason === 'passcode') && !currentAnswer.trim();
                const typewriterKey = `${phoneLockScreenPhase}-${phoneLockScreenIndex}-${phoneLockSelectedOption || 'free'}-${phoneLockAttempt?.reply || ''}`;
                const markTypingDone = () => setPhoneLockTypingDone(true);
                const statusText = phoneLockRunning
                    ? 'ta 在选...'
                    : phoneLockScreenPhase === 'reaction'
                        ? '说完了'
                        : phoneLockScreenPhase === 'chat'
                            ? '同屏聊'
                            : phoneLockAttempt
                                ? '说完了'
                                : 'ta 在看...';
                const optionStyle = (key: 'A' | 'B'): React.CSSProperties => ({
                    background: phoneLockSelectedOption === key ? 'rgba(238,229,132,0.12)' : 'rgba(255,255,255,0.025)',
                    border: `1px solid ${phoneLockSelectedOption === key ? 'rgba(238,229,132,0.34)' : 'rgba(255,255,255,0.045)'}`,
                    color: phoneLockSelectedOption === key ? '#fff' : 'rgba(255,255,255,0.72)',
                    boxShadow: phoneLockSelectedOption === key ? '0 18px 38px -30px rgba(238,229,132,0.55)' : undefined,
                });
                return (
                    <div
                        className="fixed inset-0 z-[150] flex flex-col animate-fade-in"
                        style={{ background: '#202124', color: '#f5f5f5' }}
                        onClick={(e) => {
                            if ((e.target as HTMLElement).closest('[data-phone-lock-exit]')) return;
                            if ((e.target as HTMLElement).closest('[data-phone-lock-chat]')) return;
                            advancePhoneLockScreen();
                        }}
                    >
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); requestPhoneLockExit(); }}
                            className="absolute right-5 top-5 z-[2] px-4 py-2 rounded-full text-[12px] font-bold"
                            style={{ background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.06)', color: '#fff' }}
                        >试解锁</button>

                        <div className="pt-16 text-center shrink-0">
                            <img src={char.avatar} className="mx-auto w-16 h-16 rounded-2xl object-cover ring-1 ring-white/10 shadow-xl" alt="" />
                            <div className="mt-3 text-[24px] font-black leading-tight">{char.name}</div>
                            <div className="mt-2 text-[17px] tracking-[0.22em] text-white/45">{statusText}</div>
                            {!isChatMode && (
                                <div className="mt-4 text-[16px] tracking-[0.24em] text-white/42">{questionProgress}</div>
                            )}
                        </div>

                        <div className="flex-1 flex flex-col justify-center px-8 pb-24">
                            {phoneLockScreenPhase === 'reaction' || isChatMode ? (
                                <div className="text-center">
                                    {isPasscodeOnly ? (
                                        <div className="mx-auto max-w-[340px] rounded-[24px] px-5 py-5 text-left" style={{ background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(238,229,132,0.18)' }}>
                                            <div className="text-[11px] tracking-[0.22em] uppercase mb-2" style={{ color: '#d6cc7a' }}>口令提示</div>
                                            <div className="text-[24px] leading-snug font-serif text-white">
                                                <TypewriterText text={phoneLockNote.trim() || '没有提示，只能凭直觉猜。'} revealKey={`${typewriterKey}-clue`} forceDone={phoneLockSkipTyping} speed={28} />
                                            </div>
                                            <div className="mt-5 text-[11px] tracking-[0.22em] uppercase mb-2" style={{ color: 'rgba(255,255,255,0.48)' }}>TA 输入</div>
                                            <div className="text-[34px] leading-tight font-serif font-bold text-white">
                                                <TypewriterText text={passcodeAnswer || '（空）'} revealKey={`${typewriterKey}-pass`} forceDone={phoneLockSkipTyping} speed={30} onDone={markTypingDone} />
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="text-[40px] leading-tight font-serif font-bold tracking-wide">
                                            <TypewriterText
                                                text={phoneLockSelectedOption && hasBinaryOptions ? `${phoneLockSelectedOption}. ${phoneLockSelectedOption === 'A' ? currentQuestion.optionA : currentQuestion.optionB}` : (currentAnswer || phoneLockResultLabel(phoneLockAttempt?.unlockReason))}
                                                revealKey={`${typewriterKey}-answer`}
                                                forceDone={phoneLockSkipTyping}
                                                speed={30}
                                            />
                                        </div>
                                    )}
                                    <div className="mt-8 text-[18px] leading-[1.8] text-white/68 whitespace-pre-wrap">
                                        <TypewriterText
                                            text={phoneLockAttempt?.reply || '整屏回应已打完。点一下屏幕继续，进入同屏聊。'}
                                            revealKey={`${typewriterKey}-reply`}
                                            forceDone={phoneLockSkipTyping}
                                            speed={22}
                                            onDone={markTypingDone}
                                        />
                                    </div>
                                    {!isChatMode && (
                                        <div className="mt-14 inline-flex px-5 py-3 rounded-2xl text-[13px] text-white/80" style={{ background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.06)' }}>
                                            {phoneLockTypingDone ? '点一下屏幕继续' : '点一下跳过打字'}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="text-center">
                                    <div className="text-[34px] sm:text-[40px] leading-[1.35] font-serif font-bold whitespace-pre-wrap">
                                        <TypewriterText
                                            text={currentQuestion?.stem || '锁屏题目'}
                                            revealKey={`${typewriterKey}-question`}
                                            forceDone={phoneLockSkipTyping}
                                            speed={34}
                                        />
                                    </div>
                                    {hasBinaryOptions ? (
                                        <div className="mt-16 space-y-5 max-w-[300px] mx-auto">
                                            <div className="min-h-20 rounded-2xl flex items-center justify-center px-5 py-5 text-[24px] font-black leading-snug" style={optionStyle('A')}>
                                                <TypewriterText text={currentQuestion.optionA} revealKey={`${typewriterKey}-a`} forceDone={phoneLockSkipTyping} speed={24} />
                                            </div>
                                            <div className="min-h-20 rounded-2xl flex items-center justify-center px-5 py-5 text-[24px] font-black leading-snug" style={optionStyle('B')}>
                                                <TypewriterText text={currentQuestion.optionB} revealKey={`${typewriterKey}-b`} forceDone={phoneLockSkipTyping} speed={24} onDone={markTypingDone} />
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="mt-14 max-w-[320px] mx-auto rounded-[22px] px-5 py-5 text-[20px] leading-[1.7] font-serif whitespace-pre-wrap" style={{ background: 'rgba(255,255,255,0.032)', border: '1px solid rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.82)' }}>
                                            <TypewriterText
                                                text={phoneLockRunning ? `${char.name} 正在写答案...` : (currentAnswer || '等待 TA 写下答案')}
                                                revealKey={`${typewriterKey}-free`}
                                                forceDone={phoneLockSkipTyping}
                                                speed={26}
                                                onDone={markTypingDone}
                                            />
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {isChatMode && (
                            <div data-phone-lock-chat className="absolute left-0 right-0 bottom-0 px-5 pb-5 pt-3" style={{ background: 'linear-gradient(180deg, transparent, rgba(32,33,36,0.96) 20%)' }}>
                                <div className="max-h-40 overflow-y-auto no-scrollbar space-y-2 mb-3">
                                    {phoneLockChat.filter(line => line.speaker !== 'system').map(line => (
                                        <div key={line.id} className={`flex ${line.speaker === 'user' ? 'justify-end' : 'justify-start'}`}>
                                            <div className="max-w-[82%] px-4 py-2.5 rounded-2xl text-[13px] leading-relaxed"
                                                style={line.speaker === 'user'
                                                    ? { background: '#efe18a', color: '#202124' }
                                                    : { background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.07)', color: '#fff' }}
                                            >
                                                {line.text}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <div className="flex gap-2">
                                    <input
                                        value={phoneLockChatInput}
                                        onChange={e => setPhoneLockChatInput(e.target.value)}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter' && !e.shiftKey) {
                                                e.preventDefault();
                                                void sendPhoneLockChat();
                                            }
                                        }}
                                        placeholder={phoneLockChatBusy ? `${char.name} 正在回复...` : '直接在屏幕上回复 TA'}
                                        disabled={phoneLockChatBusy}
                                        className="flex-1 min-w-0 px-4 py-3 rounded-2xl text-[14px] outline-none disabled:opacity-50"
                                        style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff' }}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => { void sendPhoneLockChat(); }}
                                        disabled={!phoneLockChatInput.trim() || phoneLockChatBusy}
                                        className="shrink-0 px-4 rounded-2xl text-[13px] font-black active:scale-95 disabled:opacity-40"
                                        style={{ background: '#efe18a', color: '#202124' }}
                                    >发送</button>
                                </div>
                            </div>
                        )}
                        <PhoneLockExitUnlockSheet
                            open={phoneLockExitSheetOpen}
                            charName={char.name}
                            clue={phoneLockNote.trim() || PHONE_LOCK_PRESETS[phoneLockPreset].note(userProfile.name || '我')}
                            value={phoneLockExitCode}
                            error={phoneLockExitError}
                            disabledReason={!phoneLockCode ? '这次没有设置口令答案，锁屏无法被题目解开。' : undefined}
                            busy={phoneLockExitBusy}
                            onChange={(value) => {
                                setPhoneLockExitCode(sanitizePhoneLockPasscode(value));
                                setPhoneLockExitError('');
                            }}
                            onCancel={cancelPhoneLockExit}
                            onSubmit={() => { void submitPhoneLockExit(); }}
                        />
                    </div>
                );
             })()}


             {/* 系统命令 Modal：用户以系统身份下达最高优先级指令 */}
             <JournalSheet
                open={showSystemCmdModal} title="系统指令" en="System Command" sub="发送一条最高优先级的聊天指令"
                tape="lavender" pattern="plain" paper="lined"
                onClose={() => setShowSystemCmdModal(false)}
                footer={<>
                    <SealBtn kind="ghost" onClick={() => setShowSystemCmdModal(false)}>取消</SealBtn>
                    <SealBtn kind="ink" onClick={() => { void handleSendSystemCommand(); }} disabled={!systemCmdInput.trim()}>发送指令</SealBtn>
                </>}
             >
                <div className="space-y-3">
                    <div className="relative rounded-[12px] pl-4 pr-3 py-3" style={{ background: '#fffdfa', border: '1px solid #eed6df' }}>
                        <div className="flex items-center gap-1.5 mb-1.5">
                            <span className="text-[8.5px] font-bold tracking-[0.25em] uppercase select-none" style={{ ...MONO_STACK, color: '#c98ba0' }}>System Command</span>
                        </div>
                        <textarea
                            value={systemCmdInput}
                            onChange={e => setSystemCmdInput(e.target.value)}
                            placeholder={`输入要立即生效的指令，比如：\n· 让${char?.name || '角色'}主动查看${userProfile?.name || '用户'}的手机\n· 暂停当前对话，补一段两人初遇\n· 接下来换成${char?.name || '角色'}第一人称回复`}
                            rows={4}
                            className="w-full bg-transparent placeholder:text-[#cfb8c4] text-[13px] resize-none outline-none leading-relaxed"
                            style={{ color: '#5a3140', caretColor: '#d8a5b7' }}
                            autoFocus
                        />
                    </div>
                    <NoteStrip tone="danger">系统指令优先级最高，会覆盖角色设定和此前上下文，请确认后再发送。</NoteStrip>
                </div>
             </JournalSheet>

             {/* 聊天闹钟：回形针 → 两个人的事 → 闹钟 */}
             <JournalSheet
                open={showAlarmModal}
                title="聊天闹钟"
                en="ALARM"
                sub={char ? `让 ${displayCharName || char.name} 到点叫你` : '睡觉、起床和自定义提醒'}
                tape="rose"
                pattern="plain"
                paper="lined"
                tall
                onClose={() => setShowAlarmModal(false)}
                footer={<>
                    <SealBtn kind="ghost" onClick={() => setShowAlarmModal(false)}>收好</SealBtn>
                    <SealBtn kind="rose" onClick={() => { void saveAlarmDraft(); }} disabled={!alarmDraft || alarmSaving}>
                        {alarmSaving ? '保存中...' : alarmDraft?.id && chatAlarms.some(a => a.id === alarmDraft.id) ? '保存修改' : '新增闹钟'}
                    </SealBtn>
                </>}
             >
                <div id="manual-chat-alarm-root" className="space-y-4">
                    <NoteStrip>
                        页面或 PWA 运行时会按点检查；浏览器完全关闭后不保证响铃。到点后会让角色在聊天里发一条适合语音化的提醒，APK 会同步排原生提醒。
                    </NoteStrip>

                    <div className="grid grid-cols-2 gap-2">
                        {([
                            { kind: 'sleep' as ChatAlarmKind, label: '睡觉督促', time: '23:30' },
                            { kind: 'wake' as ChatAlarmKind, label: '起床叫醒', time: '07:30' },
                        ]).map(preset => (
                            <button
                                key={preset.kind}
                                type="button"
                                onClick={() => {
                                    if (!char) return;
                                    setAlarmDraft(makeChatAlarm({
                                        charId: char.id,
                                        kind: preset.kind,
                                        label: preset.label,
                                        timeHHmm: preset.time,
                                        weekdays: EVERYDAY_WEEKDAYS,
                                        channel: 'auto',
                                    }));
                                }}
                                className="rounded-[18px] px-3 py-3 text-left active:scale-[0.98] transition-transform"
                                style={{ background: '#fffdfa', border: '1px solid #eed6df', color: INK }}
                            >
                                <div className="text-[13px] font-black">{preset.label}</div>
                                <div className="mt-1 text-[11px]" style={{ color: INK_SOFT }}>{preset.time} · 每天</div>
                            </button>
                        ))}
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <div className="text-[12px] font-black" style={{ color: INK }}>已有闹钟</div>
                            <button
                                type="button"
                                onClick={() => setAlarmDraft(makeAlarmDraftFor('custom'))}
                                className="px-3 py-1.5 rounded-full text-[11px] font-bold active:scale-95"
                                style={{ background: '#fff4f7', color: INK, border: '1px solid #eed6df' }}
                            >
                                自定义
                            </button>
                        </div>

                        {alarmLoading ? (
                            <ScrapNote center className="py-4">正在翻闹钟本...</ScrapNote>
                        ) : chatAlarms.length === 0 ? (
                            <ScrapNote center className="py-4">还没有闹钟。先用上面的睡觉/起床预设试一只。</ScrapNote>
                        ) : (
                            <div className="space-y-2 max-h-48 overflow-y-auto no-scrollbar pr-1">
                                {chatAlarms.map(alarm => {
                                    const selected = alarmDraft?.id === alarm.id;
                                    return (
                                        <div
                                            key={alarm.id}
                                            className="rounded-[18px] px-3 py-3"
                                            style={{
                                                background: selected ? '#fff4f7' : '#fffdfa',
                                                border: `1px solid ${selected ? '#d8a5b7' : '#eed6df'}`,
                                                color: INK,
                                            }}
                                        >
                                            <div className="flex items-start gap-2">
                                                <button type="button" onClick={() => setAlarmDraft(alarm)} className="flex-1 min-w-0 text-left">
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <span className="text-[16px] font-black tabular-nums">{alarm.timeHHmm}</span>
                                                        <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background: '#fff', color: INK_SOFT, border: '1px solid #eed6df' }}>
                                                            {alarmKindLabel(alarm.kind)}
                                                        </span>
                                                    </div>
                                                    <div className="mt-1 text-[12px] font-bold truncate">{alarm.label}</div>
                                                    <div className="mt-0.5 text-[10.5px] leading-snug" style={{ color: INK_SOFT }}>
                                                        {weekdayLabel(alarm.weekdays)} · {alarmChannelLabel(alarm.channel)} · {formatAlarmNextAt(alarm)}
                                                    </div>
                                                </button>
                                                <div className="flex flex-col gap-1 shrink-0">
                                                    <button
                                                        type="button"
                                                        onClick={() => { void toggleChatAlarmEnabled(alarm); }}
                                                        className="px-2.5 py-1 rounded-full text-[10px] font-black active:scale-95"
                                                        style={alarm.enabled ? { background: '#d8a5b7', color: '#fff' } : { background: '#fff', color: INK_SOFT, border: '1px solid #eed6df' }}
                                                    >
                                                        {alarm.enabled ? 'ON' : 'OFF'}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => { void deleteChatAlarm(alarm); }}
                                                        className="px-2.5 py-1 rounded-full text-[10px] font-black active:scale-95"
                                                        style={{ background: '#fff5f7', color: '#d4536f', border: '1px solid #f1c6d1' }}
                                                    >
                                                        删除
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {alarmDraft && (
                        <div className="space-y-3 rounded-[20px] px-3.5 py-3.5" style={{ background: '#fffdfa', border: '1px solid #eed6df' }}>
                            <div className="flex items-center justify-between gap-2">
                                <div className="text-[12px] font-black" style={{ color: INK }}>编辑闹钟</div>
                                <button
                                    type="button"
                                    onClick={() => updateAlarmDraft({ enabled: !alarmDraft.enabled })}
                                    className="px-3 py-1.5 rounded-full text-[11px] font-black active:scale-95"
                                    style={alarmDraft.enabled ? { background: '#d8a5b7', color: '#fff' } : { background: '#fff', color: INK_SOFT, border: '1px solid #eed6df' }}
                                >
                                    {alarmDraft.enabled ? '已开启' : '已暂停'}
                                </button>
                            </div>

                            <div className="flex flex-wrap gap-2">
                                {(['sleep', 'wake', 'custom'] as ChatAlarmKind[]).map(kind => (
                                    <ScrapChip key={kind} selected={alarmDraft.kind === kind} onClick={() => setAlarmDraftKind(kind)}>
                                        {alarmKindLabel(kind)}
                                    </ScrapChip>
                                ))}
                            </div>

                            <div className="grid grid-cols-[1fr_8.5rem] gap-3">
                                <LinedInput
                                    value={alarmDraft.label}
                                    onChange={e => updateAlarmDraft({ label: e.target.value })}
                                    placeholder="闹钟名称"
                                    maxLength={40}
                                    className="font-bold"
                                />
                                <LinedInput
                                    type="time"
                                    value={alarmDraft.timeHHmm}
                                    onChange={e => updateAlarmDraft({ timeHHmm: e.target.value })}
                                    className="font-black tabular-nums"
                                />
                            </div>

                            <div className="space-y-2">
                                <div className="flex flex-wrap gap-2">
                                    <ScrapChip selected={alarmDraft.weekdays.length === 7} onClick={() => updateAlarmDraft({ weekdays: [...EVERYDAY_WEEKDAYS] })}>每天</ScrapChip>
                                    <ScrapChip
                                        selected={alarmDraft.weekdays.length === 5 && WORKDAY_WEEKDAYS.every(d => alarmDraft.weekdays.includes(d))}
                                        onClick={() => updateAlarmDraft({ weekdays: [...WORKDAY_WEEKDAYS] })}
                                    >
                                        工作日
                                    </ScrapChip>
                                </div>
                                <div className="grid grid-cols-7 gap-1.5">
                                    {CHAT_ALARM_WEEKDAYS.map(day => {
                                        const selected = alarmDraft.weekdays.includes(day.value);
                                        return (
                                            <button
                                                key={day.value}
                                                type="button"
                                                onClick={() => toggleAlarmDraftWeekday(day.value)}
                                                className="h-9 rounded-full text-[11px] font-black active:scale-95"
                                                style={selected ? { background: '#d8a5b7', color: '#fff' } : { background: '#fff', color: INK_SOFT, border: '1px solid #eed6df' }}
                                            >
                                                {day.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="flex flex-wrap gap-2">
                                {(['auto', 'reminder', 'call'] as ChatAlarmChannel[]).map(channel => (
                                    <ScrapChip key={channel} selected={alarmDraft.channel === channel} onClick={() => updateAlarmDraft({ channel })}>
                                        {alarmChannelLabel(channel)}
                                    </ScrapChip>
                                ))}
                            </div>

                            <ScrapNote>
                                自动模式下，起床优先走语音来电；睡觉和自定义提醒走语音提醒气泡。后台或不可见时，来电会退回通知和未接提示。
                            </ScrapNote>
                        </div>
                    )}
                </div>
             </JournalSheet>

             {/* 位置分享 Modal */}
             <JournalSheet
                open={showLocationModal} title="落脚点" en="You Are Here" sub="给 TA 画张能找到你的小地图"
                tape="sky" pattern="dot" paper="grid"
                onClose={() => setShowLocationModal(false)}
                footer={<>
                    <SealBtn kind="ghost" onClick={() => setShowLocationModal(false)}>先不说</SealBtn>
                    <SealBtn kind="rose" onClick={handleSendLocation}>插上小旗寄出</SealBtn>
                </>}
             >
                <div className="space-y-3.5">
                    <div className="flex items-center gap-2">
                        <span aria-hidden className="text-[15px] leading-none" style={{ transform: 'rotate(-6deg)', display: 'inline-block' }}>🚩</span>
                        <span className="text-[8.5px] font-bold tracking-[0.25em] uppercase select-none" style={{ ...MONO_STACK, color: '#9bb3c4' }}>Mark The Spot</span>
                        <span aria-hidden className="flex-1 border-t" style={{ borderColor: 'rgba(216,165,183,0.35)' }} />
                    </div>
                    <LinedInput value={locationName} onChange={e => setLocationName(e.target.value)} placeholder="这儿叫什么（比如：江汉路口那家咖啡店）" maxLength={40} className="font-bold" autoFocus />
                    <LinedInput value={locationDetail} onChange={e => setLocationDetail(e.target.value)} placeholder="几楼几号、怎么找到你，空着也行" maxLength={80} />
                    <NoteStrip>TA 会收到一张插着小旗的位置卡片，一眼就知道你这会儿落在哪儿。</NoteStrip>
                </div>
             </JournalSheet>

             {/* AI 画图 Modal */}
             <JournalSheet
                open={showImageGenModal} title="随手画一张" en="Doodle Post" sub="把想看的画面讲出来，画好就寄"
                tape="lemon" pattern="star" paper="dot"
                onClose={() => { if (!isGeneratingImage) { setShowImageGenModal(false); setImageGenPreview(null); } }}
                footer={imageGenPreview
                    ? <>
                        <SealBtn kind="ghost" onClick={() => setImageGenPreview(null)}>不行，重画</SealBtn>
                        <SealBtn kind="rose" onClick={handleSendGeneratedImage}>就它了，寄出</SealBtn>
                    </>
                    : <SealBtn kind="rose" full onClick={handleGenerateImage} disabled={isGeneratingImage}>{isGeneratingImage ? '颜料还没干，等等…' : '开始画'}</SealBtn>}
             >
                <div className="space-y-3.5">
                    {imageGenPreview ? (
                        <div className="px-4 py-1">
                            {/* 刚生成的图片预览 */}
                            <div className="relative p-2 pb-8 rounded-[8px]" style={{ background: '#fffdfa', border: '1px solid #eed6df', boxShadow: '0 12px 28px -18px rgba(122,90,114,0.38)' }}>
                                <img src={imageGenPreview} className="w-full" alt="刚画好的一张" />
                                <div className="absolute bottom-2 left-3 right-3 flex items-center justify-between">
                                    <span className="text-[10px] font-bold" style={{ ...CUTE_STACK, color: INK }}>刚晾干的一张</span>
                                    <span className="text-[8px] tracking-[0.2em] uppercase select-none" style={{ ...MONO_STACK, color: INK_SOFT }}>fresh print</span>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <>
                            <LinedArea value={imageGenPrompt} onChange={e => setImageGenPrompt(e.target.value)} placeholder="想要什么画面，讲给画笔听（比如：雨停后的天台，水洼里漂着霓虹的影子）" rows={3} autoFocus />
                            <LinedInput value={imageGenModel} onChange={e => setImageGenModel(e.target.value)} tag="换支画笔（生图模型）" placeholder={`空着就用 ${DEFAULT_IMAGE_GEN_MODEL}`} style={{ fontSize: 12 }} />
                            <NoteStrip>画的请求走当前 API 的 /images/generations 端点，填的模型得会画画；寄出后相册里也会留一张底。</NoteStrip>
                        </>
                    )}
                </div>
             </JournalSheet>

             {/* 心声面板（入口：顶栏角色头像）：浅色信息卡 */}
             {showInnerVoiceModal && char && (
                <div
                    className="absolute inset-0 z-[220] flex items-center justify-center p-5 animate-fade-in"
                    style={{ background: 'rgba(20,20,28,0.45)', backdropFilter: 'blur(4px)' }}
                    onClick={() => setShowInnerVoiceModal(false)}
                >
                    <div
                        className="w-full max-w-sm rounded-[1.8rem] shadow-2xl flex flex-col max-h-[84vh] overflow-hidden animate-slide-up relative"
                        style={{ background: 'linear-gradient(180deg,#fffdfa,#fff4f7)', border: '1px solid #eed6df', color: '#5a3140' }}
                        onClick={e => e.stopPropagation()}
                    >
                        {/* 标题条：居中标题 + 左上关闭 */}
                        <div className="relative flex items-center justify-center px-6 pt-5 pb-1 shrink-0">
                            <button onClick={() => setShowInnerVoiceModal(false)} className="absolute left-4 p-1.5 rounded-full text-[#a892a3] hover:bg-white active:scale-95 transition-all" aria-label="关闭">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                            </button>
                            <div className="text-center">
                                <div className="text-[12px] font-mono font-bold tracking-[0.28em] uppercase" style={{ color: '#5a3140' }}>Inner&nbsp;Voice</div>
                                <div className="text-[9px] font-mono tracking-[0.2em] mt-0.5" style={{ color: '#a892a3' }}>Private Preview</div>
                            </div>
                        </div>

                        {/* 概览卡 */}
                        <div className="mx-5 mt-2 rounded-3xl border shadow-[0_12px_30px_-22px_rgba(122,90,114,0.42)] shrink-0" style={{ background: '#fffdfa', borderColor: '#eed6df' }}>
                            <div className="flex items-center justify-between px-5 pt-3.5">
                                <span className="text-[10px] font-bold tracking-[0.22em] uppercase" style={{ color: '#a892a3' }}>Profile</span>
                                <span className="text-[14px] font-bold tracking-widest truncate max-w-[60%]" style={{ color: '#5a3140' }}>{displayCharName}</span>
                                <span className="text-[10px] font-bold tracking-[0.22em] uppercase" style={{ color: '#a892a3' }}>Mood</span>
                            </div>
                            <div className="flex items-center gap-4 px-5 pt-3 pb-1">
                                <div className="shrink-0 p-[3px] rounded-full bg-white border-2 shadow-[0_8px_18px_-12px_rgba(122,90,114,0.45)]" style={{ borderColor: '#eed6df' }}>
                                    <img src={displayCharAvatar} className="w-[4.6rem] h-[4.6rem] rounded-full object-cover border-[3px] border-white" alt={displayCharName} />
                                </div>
                                {/* 统计行：好感 / 心声 / 心情 */}
                                <div className="flex-1 flex items-start justify-around text-center">
                                    <div>
                                        <div className="text-lg font-extrabold leading-tight" style={{ color: '#5a3140' }}>{typeof char.affection === 'number' ? Math.round(char.affection) : '—'}</div>
                                        <div className="text-[10px]" style={{ color: '#a892a3' }}>好感值</div>
                                    </div>
                                    <div>
                                        <div className="text-lg font-extrabold leading-tight" style={{ color: '#5a3140' }}>{innerVoiceHistory.length}</div>
                                        <div className="text-[10px]" style={{ color: '#a892a3' }}>记录</div>
                                    </div>
                                    <div>
                                        <div className="text-lg font-extrabold leading-tight" style={{ color: '#5a3140' }}>{char.currentMood?.emoji || '🤍'}</div>
                                        <div className="text-[10px]" style={{ color: '#a892a3' }}>{char.currentMood?.label || '心情'}</div>
                                    </div>
                                </div>
                            </div>
                            {/* 好感进度细线 */}
                            <div className="px-5 pt-1">
                                <div className="h-1 rounded-full overflow-hidden" style={{ background: '#f3e3e9' }}>
                                    <div className="h-full rounded-full transition-all duration-700" style={{ width: `${typeof char.affection === 'number' ? Math.max(0, Math.min(100, char.affection)) : 0}%`, background: '#d8a5b7' }} />
                                </div>
                            </div>
                            {/* 关系状态徽标（来往·关系系统）：由 AI 依好感/设定/剧情自动更新 */}
                            <div className="px-5 pt-2.5 flex items-center justify-center gap-1.5">
                                <span className="text-[11px]" style={{ color: '#a892a3' }}>你们的关系</span>
                                <span className="text-[12px] font-black px-2.5 py-0.5 rounded-full" style={{ background: '#fff4f7', color: '#5a3140', border: '1px solid #eed6df' }}>
                                    {char.marriage?.active ? '💍 ' : ''}{char.relationship?.label || '尚未明确'}
                                </span>
                            </div>
                            <div className="flex gap-2.5 px-5 py-3.5">
                                <button onClick={generateInnerVoice} disabled={innerVoiceLoading} className="flex-1 py-2.5 text-[13px] font-bold rounded-xl text-white active:scale-[0.98] transition-transform disabled:opacity-60" style={{ background: '#d8a5b7', boxShadow: '0 10px 22px -14px rgba(122,90,114,0.45)' }}>{innerVoiceLoading ? '生成中…' : '重新生成'}</button>
                                <button onClick={() => setShowInnerVoiceModal(false)} className="flex-1 py-2.5 text-[13px] font-bold rounded-xl active:scale-[0.98] transition-transform" style={{ background: '#fff4f7', color: '#5a3140', border: '1px solid #eed6df' }}>关闭</button>
                            </div>
                        </div>

                        {/* 心声内容（可滚动） */}
                        <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-6 space-y-3 pt-4 pb-2">
                            {innerVoiceLoading && !innerVoiceCurrent && (
                                <div className="flex flex-col items-center gap-2 py-8" style={{ color: '#a892a3' }}>
                                    <div className="w-6 h-6 border-2 rounded-full animate-spin" style={{ borderColor: '#eed6df', borderTopColor: '#d8a5b7' }} />
                                    <span className="text-xs">正在生成 {displayCharName} 的心声…</span>
                                </div>
                            )}
                            {innerVoiceCurrent && (
                                <div
                                    className="p-4 rounded-2xl rounded-tl-md shadow-md"
                                    style={{ background: '#fffdfa', color: '#5a3140', border: '1px solid #eed6df' }}
                                >
                                    <p className="text-[13px] leading-relaxed whitespace-pre-wrap">「{innerVoiceCurrent.content}」</p>
                                    <p className="text-[10px] mt-2 text-right font-mono" style={{ color: '#a892a3' }}>{new Date(innerVoiceCurrent.timestamp).toLocaleString('zh-CN')}</p>
                                </div>
                            )}
                            {innerVoiceHistory.filter(h => h.id !== innerVoiceCurrent?.id).length > 0 && (
                                <div className="space-y-2">
                                    <p className="text-[10px] font-bold uppercase tracking-wider px-1" style={{ color: '#a892a3' }}>历史记录</p>
                                    {innerVoiceHistory.filter(h => h.id !== innerVoiceCurrent?.id).slice(0, 10).map(h => (
                                        <div key={h.id} className="p-3 rounded-2xl rounded-tl-md border" style={{ background: '#fffdfa', borderColor: '#eed6df' }}>
                                            <p className="text-[12px] leading-relaxed whitespace-pre-wrap line-clamp-3" style={{ color: '#6f5360' }}>{h.content}</p>
                                            <p className="text-[9px] mt-1.5 text-right font-mono" style={{ color: '#a892a3' }}>{new Date(h.timestamp).toLocaleString('zh-CN')}</p>
                                        </div>
                                    ))}
                                </div>
                            )}
                            <p className="text-[10px] text-center pt-1 pb-3" style={{ color: '#a892a3' }}>{displayCharName} 不会知道你查看过，心声不会进入对话上下文。</p>
                        </div>
                    </div>
                </div>
             )}

             {/* 外卖订单小票详情：点开聊天里的外卖卡片看具体内容 */}
             {takeoutCardTarget && (() => {
                 const t: any = takeoutCardTarget.metadata?.takeout || (takeoutCardOrder ? buildTakeoutCardMeta(takeoutCardOrder, (id) => characters.find(c => c.id === id)?.name || '') : {});
                 const items: { name: string; qty: number; emoji?: string }[] = (takeoutCardOrder?.items as any) || t.items || [];
                 return (
                     <div className="absolute inset-0 z-[400] flex items-center justify-center bg-black/40 animate-fade-in p-6" onClick={() => { setTakeoutCardTarget(null); setTakeoutCardOrder(null); }}>
                         <div className="w-[min(84vw,330px)] bg-white rounded-3xl overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
                             <div className="px-5 py-3 flex items-center justify-between" style={{ background: '#fff4f7', borderBottom: '1px solid #eed6df' }}>
                                  <span className="text-[13px] font-black" style={{ color: '#5a3140' }}>🛵 外卖订单详情</span>
                                  <span className="text-[11px]" style={{ color: '#a892a3' }}>{t.payLabel || ''}</span>
                             </div>
                             <div className="px-5 pt-4 pb-2">
                                  <div className="text-[14px] font-black mb-2" style={{ color: '#5a3140' }}>{t.storeEmoji} {t.storeName}</div>
                                 <div className="space-y-1 mb-3">
                                     {items.map((it, i) => (
                                         <div key={i} className="flex items-center justify-between text-[13px]">
                                             <span className="text-slate-600">{it.emoji || '🍽️'} {it.name}</span>
                                             <span className="text-slate-400">×{it.qty}</span>
                                         </div>
                                     ))}
                                 </div>
                                  <div className="border-t pt-2.5 text-[12.5px] text-slate-500 space-y-1" style={{ borderColor: '#eed6df' }}>
                                      <div className="flex justify-between"><span>合计</span><span className="font-black text-[14px]" style={{ color: '#5a3140' }}>¥{t.total}</span></div>
                                     <div className="flex justify-between"><span>收货</span><span>{takeoutCardOrder?.address || t.recipientLabel}</span></div>
                                     {(takeoutCardOrder?.note || t.note) && <div className="flex justify-between"><span>备注</span><span className="text-right max-w-[60%] truncate">{takeoutCardOrder?.note || t.note}</span></div>}
                                 </div>
                             </div>
                             <div className="flex border-t border-slate-100">
                                 <button onClick={() => { setTakeoutCardTarget(null); setTakeoutCardOrder(null); }} className="flex-1 py-3.5 text-[14px] text-slate-500 font-medium active:bg-slate-50">合上</button>
                                  <button onClick={() => { setTakeoutCardTarget(null); setTakeoutCardOrder(null); openApp(AppID.Takeout); }} className="flex-1 py-3.5 text-[14px] font-bold border-l border-slate-100 active:bg-slate-50" style={{ color: '#5a3140' }}>查看进度</button>
                             </div>
                         </div>
                     </div>
                 );
             })()}

             {/* 主动求婚撰写弹窗 */}
             {showProposeCompose && char && (
                 <div className="absolute inset-0 z-[450] flex items-center justify-center bg-black/45 animate-fade-in p-6" onClick={() => setShowProposeCompose(false)}>
                     <div className="w-[min(84vw,330px)] bg-white rounded-3xl overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
                         <div className="px-6 pt-6 pb-4 text-center" style={{ background: 'linear-gradient(160deg,#fff5f7,#ffe3ec)' }}>
                             <div className="text-4xl mb-2">💍</div>
                             <div className="text-[16px] font-black" style={{ color: '#a83a5e' }}>向 {displayCharName} 求婚</div>
                             <div className="text-[12px] mt-1" style={{ color: '#b06a82' }}>写下你想对 TA 说的话</div>
                         </div>
                         <div className="px-5 py-4">
                             <textarea
                                 value={proposeVow}
                                 onChange={e => setProposeVow(e.target.value)}
                                 rows={3}
                                 placeholder={`${displayCharName}，愿意和我一直走下去，步入婚姻吗？`}
                                 className="w-full bg-rose-50/60 rounded-2xl px-3.5 py-3 text-[13px] outline-none resize-none border border-rose-100 focus:border-rose-300"
                             />
                         </div>
                         <div className="flex border-t border-slate-100">
                             <button onClick={() => setShowProposeCompose(false)} className="flex-1 py-3.5 text-[14px] text-slate-500 font-medium active:bg-slate-50">再想想</button>
                             <button onClick={() => void sendUserProposal()} className="flex-1 py-3.5 text-[15px] font-black border-l border-slate-100 active:bg-rose-50" style={{ color: '#c2557a' }}>送出求婚 💍</button>
                         </div>
                     </div>
                 </div>
             )}

             {/* 浪漫求婚界面 */}
             {proposalTarget && char && (
                 <ProposalOverlay
                     message={proposalTarget}
                     charName={displayCharName}
                     charAvatar={displayCharAvatar}
                     userName={userProfile.name || '我'}
                     busy={proposalBusy}
                     onRespond={(accept) => void respondToCharProposal(accept)}
                     onClose={() => setProposalTarget(null)}
                 />
             )}

             <ChatModals
                modalType={modalType} setModalType={setModalType}
                transferAmt={transferAmt} setTransferAmt={setTransferAmt}
                transferMode={transferMode} setTransferMode={setTransferMode}
                transferNote={transferNote} setTransferNote={setTransferNote}
                transferPassword={transferPassword} setTransferPassword={setTransferPassword}
                walletBalance={userProfile.balance || 0}
                emojiImportText={emojiImportText} setEmojiImportText={setEmojiImportText}
                settingsContextLimit={settingsContextLimit} setSettingsContextLimit={setSettingsContextLimit}
                preserveContext={preserveContext} setPreserveContext={setPreserveContext}
                editContent={editContent} setEditContent={setEditContent}
                archivePrompts={archivePrompts} selectedPromptId={selectedPromptId} setSelectedPromptId={(id: string) => {
                    setSelectedPromptId(id);
                    // 同步写 localStorage，让 palace extraction 的风格追加能读到最新选择
                    try { localStorage.setItem('chat_active_archive_prompt_id', id); } catch {}
                }}
                editingPrompt={editingPrompt} setEditingPrompt={setEditingPrompt} isSummarizing={isSummarizing} archiveProgress={archiveProgress}
                selectedMessage={selectedMessage} selectedEmoji={selectedEmoji} activeCharacter={char} messages={messages}
                allHistoryMessages={allHistoryMessages}
                
                newCategoryName={newCategoryName} setNewCategoryName={setNewCategoryName} onAddCategory={handleAddCategory}
                selectedCategory={selectedCategory}

                onTransfer={() => {
                    const amt = parseFloat(transferAmt);
                    if (!transferAmt || isNaN(amt) || amt <= 0) { setModalType('none'); setTransferNote(''); setTransferPassword(''); return; }
                    // 与钱包绑定：从存钱罐营业赚来的余额里扣，不足则拦下（弹窗不关，方便改数目）
                    const bal = userProfile.balance || 0;
                    if (amt > bal) {
                        addToast(`钱包只有 ¥${Math.round(bal)}，先去存钱罐营业赚点再寄吧`, 'error');
                        return;
                    }
                    const pw = transferPassword.trim();
                    const isPw = transferMode === 'redpacket' && !!pw;
                    adjustUserBalance(-amt, {
                        note: transferMode === 'redpacket' ? `发给 ${char.name} 的红包` : `转给 ${char.name} 的零花钱`,
                        category: 'transfer',
                        kind: transferMode === 'redpacket' ? 'chat-redpacket-out' : 'chat-transfer-out',
                        sourceApp: '聊天',
                        sourceId: char.id,
                        relatedEntityId: char.id,
                        createdBy: 'user',
                    });
                    handleSendText(
                        isPw ? `[口令红包]` : transferMode === 'redpacket' ? `[红包]` : `[转账]`,
                        'transfer',
                        { amount: transferAmt, ...(transferMode === 'redpacket' ? { kind: 'redpacket', note: transferNote.trim() || undefined, ...(isPw ? { rpType: 'password', password: pw } : {}) } : {}) }
                    );
                    addToast(isPw ? `口令红包已寄出 · 钱包 -¥${Math.round(amt)}` : transferMode === 'redpacket' ? `红包已寄出 · 钱包 -¥${Math.round(amt)}` : `零花钱已寄出 · 钱包 -¥${Math.round(amt)}`, 'success');
                    setModalType('none');
                    setTransferNote('');
                    setTransferPassword('');
                }}
                onImportEmoji={handleImportEmoji}
                onSaveSettings={saveSettings} onBgUpload={handleBgUpload} onRemoveBg={() => updateCharacter(char.id, { chatBackground: undefined })}
                onClearHistory={handleClearHistory} onClearChatContextOnly={handleClearChatContextOnly} onArchive={handleFullArchive}
                onCreatePrompt={createNewPrompt} onEditPrompt={editSelectedPrompt} onSavePrompt={handleSavePrompt} onDeletePrompt={handleDeletePrompt}
                onSetHistoryStart={handleSetHistoryStart} onJumpToMessageInChat={handleJumpToMessageInChat} onEnterSelectionMode={handleEnterSelectionMode}
                onReplyMessage={handleReplyMessage} onEditMessageStart={() => { if (selectedMessage) { setEditContent(selectedMessage.content); setModalType('edit-message'); } }}
                onConfirmEditMessage={confirmEditMessage} onDeleteMessage={handleDeleteMessage} onRecallMessage={handleRecallMessage} onForwardMessage={handleForwardSingle} onCollectMessage={handleCollectMessage} onPostMessageToMoments={handlePostMessageToMoments} onReactMessage={handleReactMessage} onCopyMessage={handleCopyMessage} onDeleteEmoji={handleDeleteEmoji} onDeleteCategory={handleDeleteCategory}
                allCharacters={characters} onSaveCategoryVisibility={handleSaveCategoryVisibility}
                translationEnabled={translationEnabled}
                onToggleTranslation={() => { const next = !translationEnabled; setTranslationEnabled(next); localStorage.setItem(`chat_translate_enabled_${activeCharacterId}`, JSON.stringify(next)); if (!next) { setShowingTargetIds(new Set()); } }}
                translateSourceLang={translateSourceLang}
                translateTargetLang={translateTargetLang}
                onSetTranslateSourceLang={(lang: string) => { setTranslateSourceLang(lang); localStorage.setItem(`chat_translate_source_lang_${activeCharacterId}`, lang); setShowingTargetIds(new Set()); }}
                onSetTranslateLang={(lang: string) => { setTranslateTargetLang(lang); localStorage.setItem(`chat_translate_lang_${activeCharacterId}`, lang); setShowingTargetIds(new Set()); }}
                xhsEnabled={!!char.xhsEnabled}
                onToggleXhs={() => updateCharacter(char.id, { xhsEnabled: !char.xhsEnabled })}
                timeAwarenessEnabled={char.timeAwarenessEnabled !== false}
                onToggleTimeAwareness={() => updateCharacter(char.id, { timeAwarenessEnabled: char.timeAwarenessEnabled === false })}
                htmlModeEnabled={(char as any).htmlModeEnabled !== false}
                onToggleHtmlMode={() => updateCharacter(char.id, { htmlModeEnabled: (char as any).htmlModeEnabled === false } as any)}
                htmlModeCustomPrompt={settingsHtmlModeCustomPrompt}
                setHtmlModeCustomPrompt={setSettingsHtmlModeCustomPrompt}
                chatVoiceEnabled={!!char.chatVoiceEnabled}
                onToggleChatVoice={() => updateCharacter(char.id, { chatVoiceEnabled: !char.chatVoiceEnabled })}
                chatVoiceLang={char.chatVoiceLang || ''}
                onSetChatVoiceLang={(lang: string) => updateCharacter(char.id, { chatVoiceLang: lang })}
                voiceAvailable={!!(char.voiceProfile?.voiceId || char.voiceProfile?.timberWeights?.length)}
                onGenerateVoice={selectedMessage ? () => handleManualTts(selectedMessage) : undefined}
                scheduleData={scheduleData}
                isScheduleGenerating={isScheduleGenerating}
                onScheduleEdit={handleScheduleEdit}
                onScheduleDelete={handleScheduleDelete}
                onScheduleReroll={() => generateDailySchedule(char, true)}
                onScheduleCoverChange={handleScheduleCoverChange}
                onScheduleStyleChange={handleScheduleStyleChange}
                isScheduleFeatureEnabled={isScheduleFeatureOn(char)}
                onToggleScheduleFeature={handleToggleScheduleFeature}
                isMemoryPalaceEnabled={!!char.memoryPalaceEnabled}
                isVectorizing={isVectorizing}
                onForceVectorize={handleForceVectorize}
                apiPresets={apiPresets}
                onAddApiPreset={addApiPreset}
                onSaveEmotion={(config) => {
                    // API 同步到所有角色，enabled 仅写到当前角色
                    syncEmotionApiToAllCharacters(config.api);
                    updateCharacter(char.id, {
                        emotionConfig: {
                            enabled: config.enabled,
                            ...(config.api && config.api.baseUrl ? { api: config.api } : {}),
                        },
                    });
                }}
                onClearBuffs={() => {
                    updateCharacter(char.id, { activeBuffs: [], buffInjection: '' });
                    addToast('情绪状态已清除', 'info');
                }}
             />
             
             <ChatHeader
                selectionMode={selectionMode}
                selectedCount={selectedMsgIds.size + Array.from(selectedThinkingMsgIds).filter(id => !selectedMsgIds.has(id)).length}
                onCancelSelection={() => { setSelectionMode(false); setSelectedMsgIds(new Set()); setSelectedThinkingMsgIds(new Set()); }}
                activeCharacter={headerChar}
                isTyping={isTyping}
                isSummarizing={isSummarizing}
                isEmotionEvaluating={emotionStatus === 'evaluating'}
                isInstantSending={instantSendingActive}
                isMemoryPalaceProcessing={!!memoryPalaceStatus}
                memoryPalaceStatusText={memoryPalaceStatus}
                lastTokenUsage={lastTokenUsage}
                tokenBreakdown={tokenBreakdown}
                onClose={() => openApp(AppID.GroupChat)}
                // 左上角头像 = 心声面板（心声 / 好感值 / 当前心情）；点角色名的「切换角色 / 信纸花样」弹窗已移除
                onAvatarClick={tryOpenInnerVoice}
                // 聊天设置移入右上角 ··· 内
                onOpenSettings={handleOpenChatSettings}
                onDeleteBuff={(buffId) => {
                    const currentBuffs = char.activeBuffs || [];
                    const newBuffs = currentBuffs.filter(b => b.id !== buffId);
                    const newInjection = '';
                    updateCharacter(char.id, { activeBuffs: newBuffs, buffInjection: newInjection });
                    addToast('已删除该情绪状态', 'info');
                }}
                // 默认风格对照参考设计：居中头像的浅色圆润顶栏（用户在「主题」里改过则尊重用户配置）
                headerStyle={osTheme.chatHeaderStyle || 'minimal'}
                avatarShape={osTheme.chatAvatarShape}
                headerAlign={osTheme.chatHeaderAlign || 'center'}
                headerDensity={osTheme.chatHeaderDensity}
                statusStyle={osTheme.chatStatusStyle || 'dot'}
                chromeStyle={osTheme.chatChromeStyle}
                hideBuffs={osTheme.chatHideHeaderBuffs}
                decorText={convo?.headerDecorText}
             />

            {/* 离线自主生活·回看横幅：用户离开期间角色攒了未看过的离线事件时提示，点开看时间线 */}
            {lifeRecapBanner > 0 && !selectionMode && (
                <button
                    type="button"
                    onClick={() => { if (activeCharacterId) markLifeRecapSeen(activeCharacterId); setLifeRecapBanner(0); setShowLifeRecapModal(true); }}
                    className="relative z-20 mx-3 mt-2 flex items-center gap-2 px-3 py-2 rounded-[12px] text-left transition active:scale-[0.99]"
                    style={{ background: 'linear-gradient(135deg, rgba(214,200,232,0.94), rgba(191,225,207,0.94))', boxShadow: '0 2px 8px rgba(140,120,170,0.25)' }}
                >
                    <span className="text-[15px]" aria-hidden>🌱</span>
                    <span className="flex-1 min-w-0 text-[11.5px] font-bold truncate" style={{ color: '#4a3a5c' }}>
                        {char?.name || 'TA'} 在你离开时经历了 {lifeRecapBanner} 件事
                    </span>
                    <span className="text-[10.5px] font-bold shrink-0 px-2 py-0.5 rounded-full" style={{ color: '#fff', background: 'rgba(122,90,114,0.55)' }}>看看 →</span>
                </button>
            )}

            {/* 会话设置「顶部贴边」：顶栏下方装饰横条（不占布局，浮在消息区顶部） */}
            {convo?.headerEdgeImage && (
                <div className="relative z-20 h-0 pointer-events-none">
                    <img src={convo.headerEdgeImage} alt="" className="absolute top-0 left-0 w-full h-6 object-cover" />
                </div>
            )}
            {/* 顶部装饰文案已移到 ChatHeaderShell（顶栏卡片上方居中小字，参考设计） */}

            {/* 认知消化结果弹窗 — 全屏玻璃拟态 */}
            {lastDigestResult && (() => {
                const r = lastDigestResult;
                const groups: Array<{
                    key: string;
                    label: string;
                    icon: string;
                    accent: string;       // base hue for chip/dot
                    items: Array<{ content: string; sub?: string }>;
                }> = [];
                if (r.resolved.length) groups.push({ key: 'resolved', label: '困惑化解', icon: '🕊️', accent: '#10b981', items: r.resolved.map(e => ({ content: e.content })) });
                if (r.deepened.length) groups.push({ key: 'deepened', label: '创伤加深', icon: '💢', accent: '#f43f5e', items: r.deepened.map(e => ({ content: e.content })) });
                if (r.internalized.length) groups.push({ key: 'internalized', label: '知识内化', icon: '🪞', accent: '#8b5cf6', items: r.internalized.map(e => ({ content: e.content })) });
                if (r.selfInsights.length) groups.push({ key: 'insights', label: '自我领悟', icon: '💡', accent: '#f59e0b', items: r.selfInsights.map(t => ({ content: t })) });
                if (r.selfConfused.length) groups.push({ key: 'confused', label: '新的自我困惑', icon: '🌀', accent: '#6366f1', items: r.selfConfused.map(e => ({ content: e.content })) });
                if (r.synthesizedUser.length) groups.push({ key: 'synth', label: '用户认知整合', icon: '👤', accent: '#0ea5e9', items: r.synthesizedUser.map(e => ({ content: e.content, sub: e.category })) });
                if (r.fulfilled.length) groups.push({ key: 'fulfilled', label: '期盼实现', icon: '✨', accent: '#22c55e', items: r.fulfilled.map(e => ({ content: e.content })) });
                if (r.disappointed.length) groups.push({ key: 'disappointed', label: '期盼落空', icon: '🍂', accent: '#94a3b8', items: r.disappointed.map(e => ({ content: e.content })) });
                if (r.faded.length) groups.push({ key: 'faded', label: '淡忘', icon: '🌫️', accent: '#cbd5e1', items: r.faded.map(e => ({ content: e.content })) });
                if (groups.length === 0) return null;
                return (
                    <div
                        className="absolute inset-0 z-[200] flex items-center justify-center p-4 animate-fade-in"
                        style={{
                            background: 'radial-gradient(ellipse at top, rgba(16,185,129,0.18), rgba(0,0,0,0.55))',
                            backdropFilter: 'blur(10px)',
                            WebkitBackdropFilter: 'blur(10px)',
                        }}
                        onClick={() => setLastDigestResult(null)}
                    >
                        <div
                            className="w-full max-w-sm max-h-[85vh] overflow-hidden flex flex-col relative"
                            style={{
                                background: 'linear-gradient(160deg, rgba(255,255,255,0.98) 0%, rgba(240,253,250,0.96) 100%)',
                                borderRadius: 28,
                                border: '1px solid rgba(255,255,255,0.7)',
                                boxShadow: '0 30px 80px -20px rgba(16,185,129,0.35), 0 10px 40px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.9)',
                            }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* 顶部光晕条 */}
                            <div
                                className="absolute top-0 left-0 right-0 h-1 pointer-events-none"
                                style={{ background: 'linear-gradient(90deg, transparent, #10b981, #6ee7b7, #10b981, transparent)' }}
                            />
                            {/* 头部 */}
                            <div className="px-6 pt-7 pb-4 text-center">
                                <div
                                    className="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center mb-3"
                                    style={{
                                        background: 'linear-gradient(135deg, rgba(16,185,129,0.15), rgba(52,211,153,0.08))',
                                        boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.9), 0 4px 16px rgba(16,185,129,0.2)',
                                    }}
                                >
                                    <span style={{ fontSize: 28 }}>🧠</span>
                                </div>
                                <div className="text-[11px] tracking-[0.2em] uppercase font-semibold" style={{ color: '#059669' }}>Cognitive Digest</div>
                                <div className="text-[17px] font-bold mt-1" style={{ color: '#0f172a' }}>{char.name} 完成了一次认知消化</div>
                                <div className="text-[11px] text-slate-400 mt-1">内心整理 · {groups.reduce((s, g) => s + g.items.length, 0)} 项变化</div>
                            </div>

                            {/* 内容列表 */}
                            <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-3 no-scrollbar">
                                {groups.map(g => (
                                    <div key={g.key}
                                        className="rounded-2xl overflow-hidden"
                                        style={{
                                            background: 'rgba(255,255,255,0.7)',
                                            border: `1px solid ${g.accent}22`,
                                            boxShadow: `0 2px 8px ${g.accent}14, inset 0 1px 0 rgba(255,255,255,0.8)`,
                                        }}
                                    >
                                        <div className="px-4 py-2.5 flex items-center gap-2"
                                            style={{ background: `linear-gradient(90deg, ${g.accent}18, transparent)` }}
                                        >
                                            <span style={{ fontSize: 14 }}>{g.icon}</span>
                                            <span className="text-[12px] font-bold" style={{ color: g.accent }}>{g.label}</span>
                                            <span className="text-[10px] font-bold ml-auto px-1.5 py-0.5 rounded-full"
                                                style={{ background: `${g.accent}22`, color: g.accent }}
                                            >{g.items.length}</span>
                                        </div>
                                        <div className="px-4 py-2 space-y-1.5">
                                            {g.items.slice(0, 3).map((it, i) => (
                                                <div key={i} className="text-[12px] leading-relaxed text-slate-700 flex gap-2">
                                                    <span className="shrink-0 mt-[7px] w-1 h-1 rounded-full" style={{ background: g.accent }} />
                                                    <span className="flex-1">
                                                        {it.sub && <span className="text-[10px] font-semibold mr-1.5 px-1.5 py-0.5 rounded" style={{ background: `${g.accent}18`, color: g.accent }}>{it.sub}</span>}
                                                        <span>{it.content.length > 80 ? it.content.slice(0, 80) + '…' : it.content}</span>
                                                    </span>
                                                </div>
                                            ))}
                                            {g.items.length > 3 && (
                                                <div className="text-[10px] text-slate-400 pl-3">还有 {g.items.length - 3} 条…</div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* 确认按钮 */}
                            <div className="px-6 pb-6 pt-2">
                                <button
                                    onClick={() => setLastDigestResult(null)}
                                    className="w-full py-3 text-white text-[13px] font-bold rounded-2xl active:scale-[0.98] transition-transform"
                                    style={{
                                        background: 'linear-gradient(135deg, #10b981, #059669)',
                                        boxShadow: '0 8px 24px -4px rgba(16,185,129,0.45), inset 0 1px 0 rgba(255,255,255,0.25)',
                                    }}
                                >
                                    放入心里
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* 回神进行中：轻量遮罩，告诉用户 TA 正在自我审视 */}
            {isRecentering && (
                <div
                    className="absolute inset-0 z-[200] flex items-center justify-center p-4 animate-fade-in"
                    style={{
                        background: 'radial-gradient(ellipse at center, rgba(99,102,241,0.16), rgba(0,0,0,0.5))',
                        backdropFilter: 'blur(8px)',
                        WebkitBackdropFilter: 'blur(8px)',
                    }}
                >
                    <div className="flex flex-col items-center gap-3">
                        <div
                            className="w-14 h-14 rounded-2xl flex items-center justify-center animate-pulse"
                            style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.2), rgba(129,140,248,0.1))' }}
                        >
                            <span style={{ fontSize: 26 }}>🫧</span>
                        </div>
                        <div className="text-[13px] font-semibold text-white/90 tracking-wide">{char.name} 正在回神…</div>
                        <div className="text-[11px] text-white/60">停下来，看看自己最近哪里偏了</div>
                    </div>
                </div>
            )}

            {/* 回神结果弹窗 — 第一人称内心独白（角色当着你的面意识到问题、悄悄调回去） */}
            {recenterResult && (
                <div
                    className="absolute inset-0 z-[200] flex items-center justify-center p-4 animate-fade-in"
                    style={{
                        background: 'radial-gradient(ellipse at top, rgba(99,102,241,0.2), rgba(0,0,0,0.55))',
                        backdropFilter: 'blur(10px)',
                        WebkitBackdropFilter: 'blur(10px)',
                    }}
                    onClick={() => setRecenterResult(null)}
                >
                    <div
                        className="w-full max-w-sm max-h-[85vh] overflow-hidden flex flex-col relative"
                        style={{
                            background: 'linear-gradient(160deg, rgba(255,255,255,0.98) 0%, rgba(238,242,255,0.96) 100%)',
                            borderRadius: 28,
                            border: '1px solid rgba(255,255,255,0.7)',
                            boxShadow: '0 30px 80px -20px rgba(99,102,241,0.35), 0 10px 40px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.9)',
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div
                            className="absolute top-0 left-0 right-0 h-1 pointer-events-none"
                            style={{ background: 'linear-gradient(90deg, transparent, #6366f1, #a5b4fc, #6366f1, transparent)' }}
                        />
                        {/* 头部 */}
                        <div className="px-6 pt-7 pb-3 text-center">
                            <div
                                className="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center mb-3"
                                style={{
                                    background: 'linear-gradient(135deg, rgba(99,102,241,0.15), rgba(129,140,248,0.08))',
                                    boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.9), 0 4px 16px rgba(99,102,241,0.2)',
                                }}
                            >
                                <span style={{ fontSize: 28 }}>🫧</span>
                            </div>
                            <div className="text-[11px] tracking-[0.2em] uppercase font-semibold" style={{ color: '#4f46e5' }}>Recenter · 回神</div>
                            <div className="text-[17px] font-bold mt-1" style={{ color: '#0f172a' }}>{char.name} 回了下神</div>
                        </div>

                        {/* 内容：第一人称独白 + 偏移点 */}
                        <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-3 no-scrollbar">
                            <div
                                className="rounded-2xl px-4 py-3.5"
                                style={{
                                    background: 'rgba(255,255,255,0.75)',
                                    border: '1px solid rgba(99,102,241,0.18)',
                                    boxShadow: '0 2px 8px rgba(99,102,241,0.1), inset 0 1px 0 rgba(255,255,255,0.8)',
                                }}
                            >
                                <div className="text-[14px] leading-relaxed text-slate-700 whitespace-pre-wrap">{recenterResult.monologue}</div>
                            </div>

                            {recenterResult.drift.length > 0 && (
                                <div
                                    className="rounded-2xl overflow-hidden"
                                    style={{ background: 'rgba(255,255,255,0.7)', border: '1px solid rgba(99,102,241,0.14)' }}
                                >
                                    <div className="px-4 py-2 flex items-center gap-2" style={{ background: 'linear-gradient(90deg, rgba(99,102,241,0.12), transparent)' }}>
                                        <span style={{ fontSize: 13 }}>🧭</span>
                                        <span className="text-[12px] font-bold" style={{ color: '#4f46e5' }}>察觉到的偏移</span>
                                    </div>
                                    <div className="px-4 py-2 space-y-1.5">
                                        {recenterResult.drift.map((d, i) => (
                                            <div key={i} className="text-[12px] leading-relaxed text-slate-600 flex gap-2">
                                                <span className="shrink-0 mt-[7px] w-1 h-1 rounded-full" style={{ background: '#6366f1' }} />
                                                <span className="flex-1">{d}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="text-[11px] text-slate-400 text-center px-2 leading-relaxed">
                                ta 已经悄悄把自己调回来了 · 接下来几句应该能感觉到
                            </div>
                        </div>

                        {/* 确认 */}
                        <div className="px-6 pb-6 pt-1">
                            <button
                                onClick={() => setRecenterResult(null)}
                                className="w-full py-3 text-white text-[13px] font-bold rounded-2xl active:scale-[0.98] transition-transform"
                                style={{
                                    background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
                                    boxShadow: '0 8px 24px -4px rgba(99,102,241,0.45), inset 0 1px 0 rgba(255,255,255,0.25)',
                                }}
                            >
                                嗯，继续聊
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 会话设置「角色立绘」：galgame 式半透明立绘，垫在消息气泡之下、背景之上 */}
            {convo?.spriteImage && (
                <img
                    src={convo.spriteImage}
                    alt=""
                    className="absolute bottom-0 right-0 max-h-[62%] max-w-[58%] object-contain pointer-events-none select-none opacity-95"
                    style={{ zIndex: 0 }}
                />
            )}
            <div ref={scrollRef} className="relative z-[1] flex-1 overflow-y-auto overflow-x-hidden pt-6 pb-6 no-scrollbar" style={{ backgroundImage: activeTheme.type === 'custom' && activeTheme.user.backgroundImage ? 'none' : undefined }}>
                {windowedFocusMsgId !== null && (
                    <div className="sticky top-0 z-20 flex justify-center pb-2 pointer-events-none">
                        <button onClick={handleBackToCurrent} className="pointer-events-auto px-4 py-2 bg-primary text-white rounded-full text-xs font-bold shadow-lg active:scale-95 transition-transform flex items-center gap-1.5">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor" className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 13.5 12 21m0 0-7.5-7.5M12 21V3" /></svg>
                            回到当前聊天
                        </button>
                    </div>
                )}
                {collapsedCount > 0 && windowedFocusMsgId === null && (
                    <div className="flex justify-center mb-6">
                        <button onClick={async () => {
                            const nextVisibleCount = visibleCount + LOAD_BATCH_SIZE;
                            visibleCountRef.current = nextVisibleCount;
                            setVisibleCount(nextVisibleCount);
                            await reloadMessages(nextVisibleCount);
                        }} className="px-4 py-2 bg-white/50 backdrop-blur-sm rounded-full text-xs text-slate-500 shadow-sm border border-white hover:bg-white transition-colors">加载历史消息 ({collapsedCount})</button>
                    </div>
                )}

                {/* 开场白选择器（空聊天 + 角色带开场白时）：预览气泡 + 左右切换（同 ST 开场白 swipe） */}
                {greetingPickerActive && !selectionMode && (
                    <div className="px-3 mb-4 animate-fade-in">
                        <div className="flex items-end gap-3">
                            <img src={char.avatar} className="w-9 h-9 rounded-full object-cover shadow-sm shrink-0" />
                            <div className="max-w-[78%] min-w-0">
                                <div className="bg-white/90 border border-white rounded-2xl rounded-bl-md px-4 py-3 shadow-sm text-sm text-slate-700 leading-relaxed whitespace-pre-wrap break-words">
                                    {substituteMacros(greetingOptions[Math.min(greetingIdx, greetingOptions.length - 1)], greetingMacroCtx)}
                                </div>
                                <div className="flex items-center gap-2 mt-2 pl-1 flex-wrap">
                                    {greetingOptions.length > 1 && (
                                        <div className="flex items-center gap-1.5 bg-white/60 rounded-full px-2 py-1 border border-white shadow-sm">
                                            <button
                                                onClick={() => setGreetingIdx(i => (i - 1 + greetingOptions.length) % greetingOptions.length)}
                                                className="p-1 rounded-full hover:bg-black/5 active:scale-90 transition-transform"
                                                title="上一条开场白"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor" className="w-3.5 h-3.5 text-slate-500"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
                                            </button>
                                            <span className="text-[10px] font-bold text-slate-500 tabular-nums select-none">
                                                {Math.min(greetingIdx, greetingOptions.length - 1) + 1} / {greetingOptions.length}
                                            </span>
                                            <button
                                                onClick={() => setGreetingIdx(i => (i + 1) % greetingOptions.length)}
                                                className="p-1 rounded-full hover:bg-black/5 active:scale-90 transition-transform"
                                                title="下一条开场白"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor" className="w-3.5 h-3.5 text-slate-500"><path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
                                            </button>
                                        </div>
                                    )}
                                    <button
                                        onClick={async () => {
                                            try {
                                                await commitGreeting();
                                                await reloadMessages(visibleCountRef.current);
                                            } catch (e: any) {
                                                addToast(e?.message || '开场白保存失败', 'error');
                                            }
                                        }}
                                        className="px-3 py-1.5 bg-primary text-white text-[10px] font-bold rounded-full shadow-sm shadow-primary/30 active:scale-95 transition-transform"
                                    >以这条开场白开始</button>
                                </div>
                                <p className="text-[10px] text-slate-400 mt-1.5 pl-1">
                                    {greetingOptions.length > 1 ? '左右切换选择开场白；' : ''}直接发消息也会以当前这条开场。
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                <style>{`
                    @keyframes chatAssistantPopIn {
                        0% { opacity: 0; transform: translateY(14px) scale(0.965); filter: blur(3px); }
                        58% { opacity: 1; transform: translateY(-1px) scale(1.01); filter: blur(0); }
                        100% { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
                    }
                    .chat-assistant-row-pop {
                        animation: chatAssistantPopIn 440ms cubic-bezier(0.18, 0.9, 0.22, 1) both;
                        transform-origin: left bottom;
                        will-change: transform, opacity;
                    }
                `}</style>

                {renderMessages.map((m, i) => {
                    const prevMessage = i > 0 ? renderMessages[i - 1] : null;
                    const nextMessage = i < renderMessages.length - 1 ? renderMessages[i + 1] : null;
                    const messageGroupGapMs = 30 * 60 * 1000;
                    const breaksWithPrevious =
                        !prevMessage ||
                        prevMessage.role !== m.role ||
                        Math.abs(m.timestamp - prevMessage.timestamp) > messageGroupGapMs;
                    const breaksWithNext =
                        !nextMessage ||
                        nextMessage.role !== m.role ||
                        Math.abs(nextMessage.timestamp - m.timestamp) > messageGroupGapMs;
                    // 时间分割线：会话开头或间隔超过 30 分钟时插入
                    const needsTimeDivider = m.role !== 'system' &&
                        (!prevMessage || Math.abs(m.timestamp - prevMessage.timestamp) > messageGroupGapMs);
                    const dividerLabel = (() => {
                        if (!needsTimeDivider) return '';
                        const d = new Date(m.timestamp);
                        const today = new Date();
                        const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
                        const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
                        const dayStr = sameDay(d, today) ? 'Today'
                            : sameDay(d, yesterday) ? 'Yesterday'
                            : d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
                        const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
                        return `${dayStr} ${timeStr}`;
                    })();
                    return (
                        <div
                            key={m.id || i}
                            id={`chat-msg-${m.id}`}
                            className={[
                                flashMsgId === m.id ? 'ring-2 ring-yellow-300 bg-yellow-50/40 rounded-2xl mx-2' : '',
                                poppingMessageIds.has(m.id) ? 'chat-assistant-row-pop' : '',
                                'transition-all duration-300',
                            ].filter(Boolean).join(' ')}
                        >
                        {needsTimeDivider && (
                            <div className="flex items-center justify-center gap-1.5 py-3 select-none">
                                <span className="text-[11px] opacity-60">🤍</span>
                                <span className="text-[11px] font-medium text-slate-400 tracking-wide">{dividerLabel}</span>
                                <span className="text-[11px] opacity-60">💬</span>
                            </div>
                        )}
                        <MessageItem
                            msg={m}
                            isFirstInGroup={breaksWithPrevious}
                            isLastInGroup={breaksWithNext}
                            activeTheme={activeTheme}
                            charAvatar={displayCharAvatar}
                            charName={displayCharName}
                            userAvatar={displayUserAvatar}
                            onLongPress={handleMessageLongPress}
                            onSwipeReply={handleSwipeReply}
                            onReeditRecalled={handleReeditRecalled}
                            onReactToggle={handleReactToggle}
                            selectionMode={selectionMode}
                            isSelected={selectedMsgIds.has(m.id)}
                            onToggleSelect={toggleMessageSelection}
                            isThinkingSelected={selectedThinkingMsgIds.has(m.id)}
                            onToggleThinkingSelect={toggleThinkingSelection}
                            translationEnabled={translationEnabled && m.type === 'text' && m.role === 'assistant'}
                            isShowingTarget={showingTargetIds.has(m.id)}
                            onTranslateToggle={handleTranslateToggle}
                            voiceData={voiceDataMap[m.id]}
                            voiceLoading={voiceLoading.has(m.id)}
                            isVoicePlaying={playingMsgId === m.id}
                            onPlayVoice={onPlayVoiceStable}
                            avatarShape={osTheme.chatAvatarShape}
                            avatarSize={osTheme.chatAvatarSize}
                            avatarMode={osTheme.chatAvatarMode}
                            bubbleVariant={osTheme.chatBubbleStyle || 'plain'}
                            messageSpacing={osTheme.chatMessageSpacing}
                            showTimestamp={convo?.hideTimestamp ? 'never' : osTheme.chatShowTimestamp}
                            isPending={false}
                            pendingIndicator={osTheme.chatPendingIndicator !== false}
                            onMcdSendCart={handleMcdSendCart}
                            onMcdCandidate={handleMcdCandidate}
                            thinkingChainOptions={thinkingChainOptions}
                            onAvatarClick={() => setShowCharProfile(true)}
                            onAvatarPoke={() => handleSendText(`[拍了拍 ${char.name}]`, 'interaction', { patSuffix: (char.patSuffix || '脑袋') })}
                            blockedMark={m.role === 'assistant' && userBlockedChar && !!char.blacklistedAt && m.timestamp >= char.blacklistedAt}
                            onClaimTransfer={handleClaimRequest}
                            onOpenTakeoutCard={handleOpenTakeoutCard}
                            onOpenProposal={handleOpenProposal}
                            isLastUserMsg={m.role === 'user' && m.id === lastUserMsgId}
                            onUserAvatarClick={() => setShowActionSelector(true)}
                        />
                        </div>
                    );
                })}
                
                {/* 纯前端「发送准备中」三个点: 不走 MessageItem (那条逐条路径实测渲染不出来), 直接挂在
                    消息列表末尾、靠右(用户侧). 跟 header「发送中」同源 instantSendingActive 一起亮灭.
                    原版精致观感 = 小号 (w-1) + 轻脉冲. 但原版用的 Tailwind 自定义类 animate-dot-pulse
                    CDN 没生成 (一换就消失), 原版色 slate-400/70 又太淡看不见. 解法: 自己写 inline @keyframes
                    (不依赖 CDN) 还原脉冲, 用实色 slate-400 (峰值满不透明) 保证看得见, 尺寸回到原版 w-1. */}
                {instantSendingActive && !selectionMode && (
                    <div className="flex justify-end px-3 -mt-1 -mb-4">
                        <style>{`@keyframes chatPendingDot{0%,80%,100%{opacity:.35;transform:scale(.8)}40%{opacity:1;transform:scale(1)}}`}</style>
                        <span className="inline-flex items-center gap-[3px] mr-12 select-none pointer-events-none" role="status" aria-label="发送准备中">
                            <span className="w-1 h-1 rounded-full bg-slate-400" style={{ animation: 'chatPendingDot 1.2s ease-in-out infinite' }} />
                            <span className="w-1 h-1 rounded-full bg-slate-400" style={{ animation: 'chatPendingDot 1.2s ease-in-out infinite', animationDelay: '0.2s' }} />
                            <span className="w-1 h-1 rounded-full bg-slate-400" style={{ animation: 'chatPendingDot 1.2s ease-in-out infinite', animationDelay: '0.4s' }} />
                        </span>
                    </div>
                )}

                {instantToolStatus && !selectionMode && (
                    <div className="flex items-end gap-3 px-3 mb-4 animate-fade-in">
                        <img src={char.avatar} className={chatPendingAvatarClass} />
                        <div className={`max-w-[78%] px-4 py-3 rounded-2xl shadow-sm border ${
                            instantToolStatus.phase === 'failed'
                                ? 'bg-rose-50 border-rose-100 text-rose-700'
                                : 'bg-white/95 border-white/70 text-slate-600'
                        }`}>
                            <div className="flex items-center gap-2 text-xs font-semibold leading-relaxed">
                                {instantToolStatus.phase === 'failed' ? (
                                    <span className="w-2 h-2 rounded-full bg-rose-400 shrink-0" />
                                ) : instantToolStatus.phase === 'done' ? (
                                    <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                                ) : (
                                    <svg className="animate-spin h-3 w-3 shrink-0 text-indigo-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                )}
                                <span>{instantToolStatus.text}</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* 流式输出预览：SSE 增量正文的打字机气泡，回复完成后由真实消息接管 */}
                {streamingText && !selectionMode && (
                    <div className="flex items-end gap-3 px-3 mb-6 animate-fade-in">
                        <img src={char.avatar} className={chatPendingAvatarClass} />
                        <div className="bg-white px-4 py-3 rounded-2xl shadow-sm max-w-[72%]">
                            <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap break-words">
                                {streamingText}
                                <span className="inline-block w-0.5 h-4 bg-slate-400 ml-0.5 align-text-bottom animate-pulse" />
                            </div>
                        </div>
                    </div>
                )}

                {(isTyping || recallStatus || searchStatus || diaryStatus || isProactiveComposing) && !selectionMode && !streamingText && (
                    <div className="flex items-end gap-3 px-3 mb-6 animate-fade-in">
                        <img src={char.avatar} className={chatPendingAvatarClass} />
                        <div className="bg-white px-4 py-3 rounded-2xl shadow-sm">
                            {isProactiveComposing && !isTyping && !recallStatus && !searchStatus && !diaryStatus ? (
                                <div className="flex items-center gap-2 text-xs text-teal-600 font-medium">
                                    <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                    {char.name} 在给你写消息…
                                </div>
                            ) : searchStatus ? (
                                <div className="flex items-center gap-2 text-xs text-emerald-500 font-medium">
                                    <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                    🔍 {searchStatus}
                                </div>
                            ) : recallStatus ? (
                                <div className="flex items-center gap-2 text-xs text-indigo-500 font-medium">
                                    <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                    {recallStatus}
                                </div>
                            ) : diaryStatus ? (
                                <div className="flex items-center gap-2 text-xs text-amber-600 font-medium">
                                    <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                    📖 {diaryStatus}
                                </div>
                            ) : (
                                <div className="flex gap-1"><div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"></div><div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-75"></div><div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-150"></div></div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* 会话设置「消息区贴边」：输入栏上方装饰横条 */}
            {convo?.msgEdgeImage && (
                <div className="relative z-20 h-0 pointer-events-none">
                    <img src={convo.msgEdgeImage} alt="" className="absolute bottom-0 left-0 w-full h-6 object-cover" />
                </div>
            )}

            {/* 会话设置「底部装饰文案」：消息列表下方 / 输入栏上方的居中小字（参考设计） */}
            {convo?.footerDecorText && !selectionMode && (
                <div className="moro-chat-footdecor shrink-0 z-20 flex justify-center items-center pt-0.5 pb-1.5 px-8">
                    <span className="text-[13px] font-bold text-slate-500 tracking-wide truncate max-w-full">{convo.footerDecorText}</span>
                </div>
            )}

            <div className="relative z-40">
                {mcdActivated && (
                    <div className="flex items-center justify-between px-4 py-1.5 bg-yellow-50 border-b border-yellow-200 text-xs">
                        <div className="flex items-center gap-1.5 text-yellow-700 font-bold">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse"/>
                            🍔 麦请求进行中
                        </div>
                        <button
                          onClick={() => handleSendText(MCD_DEACTIVATE_TRIGGER, 'text', { mcdDeactivate: true })}
                          className="px-2.5 py-0.5 bg-yellow-200/80 text-yellow-800 rounded-full text-[11px] font-bold active:scale-95"
                        >
                          结束
                        </button>
                    </div>
                )}
                {replyTarget && (
                    <div className="flex items-center justify-between px-4 py-2 bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
                        <div className="flex items-center gap-2 truncate"><span className="font-bold text-slate-700">正在回复:</span><span className="truncate max-w-[200px]">{replyTarget.content.length > 10 ? replyTarget.content.slice(0, 10) + '...' : replyTarget.content}</span></div>
                        <button onClick={() => setReplyTarget(null)} className="p-1 text-slate-400 hover:text-slate-600">×</button>
                    </div>
                )}

                {/* 拉黑状态横幅：双向拉黑期间盖在输入栏上方 */}
                {charBlockedUser && char && (
                    <div className="flex items-center justify-between gap-2 px-4 py-2.5 bg-red-50 border-b border-red-100 text-xs">
                        <div className="flex items-center gap-1.5 text-red-500 font-bold min-w-0">
                            <span className="w-4 h-4 rounded-full bg-[#fa5151] text-white text-[10px] flex items-center justify-center shrink-0">!</span>
                            <span className="truncate">你已被 {char.name} 拉黑，无法发送消息</span>
                        </div>
                        <button
                            onClick={() => setShowFriendVerify(true)}
                            className="px-2.5 py-1 bg-red-500 text-white rounded-full text-[11px] font-bold active:scale-95 shrink-0"
                        >
                            发送好友验证
                        </button>
                    </div>
                )}
                {!charBlockedUser && userBlockedChar && char && (() => {
                    // 有未处理的「解除拉黑申诉」→ 顶出同意/拒绝决定条；否则是普通拉黑提示条
                    const pendingAppeal = [...messages].reverse().find(m => m.metadata?.unblockAppeal?.status === 'pending');
                    if (pendingAppeal) {
                        return (
                            <div className="flex items-center justify-between gap-2 px-4 py-2.5 bg-amber-50 border-b border-amber-200 text-xs">
                                <span className="text-amber-700 font-bold truncate">{char.name} 申请解除拉黑，是否同意？</span>
                                <div className="flex gap-1.5 shrink-0">
                                    <button
                                        onClick={() => void rejectUnblockAppeal(pendingAppeal.id)}
                                        className="px-2.5 py-1 bg-white border border-amber-200 text-amber-600 rounded-full text-[11px] font-bold active:scale-95"
                                    >拒绝</button>
                                    <button
                                        onClick={() => void acceptUnblockAppeal(pendingAppeal.id)}
                                        className="px-2.5 py-1 bg-emerald-500 text-white rounded-full text-[11px] font-bold active:scale-95"
                                    >同意</button>
                                </div>
                            </div>
                        );
                    }
                    return (
                        <div className="flex items-center justify-between gap-2 px-4 py-2.5 bg-slate-100 border-b border-slate-200 text-xs">
                            <span className="text-slate-500 font-bold truncate">你已将 {char.name} 加入黑名单，无法发送消息</span>
                            <button
                                onClick={() => { updateCharacter(char.id, { blacklisted: false, blacklistedAt: undefined, unblockAppeal: { active: false, awaiting: false, nextAt: 0, rejectedCount: 0 } }); addToast(`已将 ${char.name} 移出黑名单`, 'success'); }}
                                className="px-2.5 py-1 bg-slate-600 text-white rounded-full text-[11px] font-bold active:scale-95 shrink-0"
                            >
                                解除拉黑
                            </button>
                        </div>
                    );
                })()}

                <ChatInputArea
                    input={input} setInput={handleInputChange}
                    isTyping={isTyping} selectionMode={selectionMode}
                    showPanel={showPanel} setShowPanel={setShowPanel}
                    onSend={handleSendCallback}
                    onDeleteSelected={handleBatchDelete}
                    onForwardSelected={handleForwardSelected}
                    selectedCount={selectedMsgIds.size + Array.from(selectedThinkingMsgIds).filter(id => !selectedMsgIds.has(id)).length}
                    emojis={filteredEmojis}
                    allEmojis={allVisibleEmojis}
                    onPanelAction={handlePanelAction}
                    onImageSelect={handleImageSelect}
                    onSendVoice={handleSendVoice}
                    isSummarizing={isSummarizing}
                    categories={visibleCategories}
                    activeCategory={activeCategory}
                    onReroll={handleReroll}
                    canReroll={canReroll}
                    isProactiveActive={isProactiveActive}
                    mcdConfigured={mcdConfiguredFlag}
                    mcdActivated={mcdActivated}
                    showThinkingChain={!!(char as any).showThinkingChain}
                    parallelReplyActive={parallelReplyEnabled && parallelReplyTargets.length > 0}
                    canPropose={!!char && canProposeNow(char)}
                    inputStyle={osTheme.chatInputStyle || 'rounded'}
                    sendButtonStyle={osTheme.chatSendButtonStyle}
                    chromeStyle={osTheme.chatChromeStyle}
                    inputPlaceholder={convo?.inputPlaceholderText}
                    inputAnimation={osTheme.chatInputAnimation}
                />
            </div>


            {/* 并发回复设置：内部同时生成其它私聊回复，不把角色塞进聊天列表 */}
            <Modal
                isOpen={showParallelReplyModal}
                title="并发回复"
                en="PARALLEL REPLIES"
                onClose={() => setShowParallelReplyModal(false)}
                footer={
                    <>
                        <ScrapBtn variant="paper" onClick={() => setShowParallelReplyModal(false)}>收好</ScrapBtn>
                        <ScrapBtn onClick={() => {
                            setParallelReplyEnabled(parallelReplyTargets.length > 0 ? true : parallelReplyEnabled);
                            setShowParallelReplyModal(false);
                        }}>完成</ScrapBtn>
                    </>
                }
            >
                <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3 p-3 rounded-2xl" style={{ background: '#fffdfa', border: `1px solid ${INK_SOFT}33` }}>
                        <div className="min-w-0">
                            <div className="text-sm font-black" style={{ color: INK }}>多角色并发回复</div>
                            <div className="text-[10.5px] leading-snug mt-0.5" style={{ color: INK_SOFT }}>
                                发给当前角色的下一条文字，会同时触发选中的私聊各自生成回复。
                            </div>
                        </div>
                        <ScrapChip selected={parallelReplyEnabled} onClick={() => setParallelReplyEnabled(v => !v)}>
                            {parallelReplyEnabled ? '已开启' : '已关闭'}
                        </ScrapChip>
                    </div>

                    <div className="space-y-2 max-h-64 overflow-y-auto no-scrollbar pr-1">
                        {characters.filter(c => c.id !== activeCharacterId).map(c => {
                            const selected = parallelReplyTargetIds.has(c.id);
                            const busy = parallelReplyBusyIds.has(c.id);
                            const blocked = !!(c.blacklisted || c.charBlock?.active);
                            return (
                                <button
                                    key={c.id}
                                    type="button"
                                    disabled={blocked}
                                    onClick={() => toggleParallelReplyTarget(c.id)}
                                    className="w-full flex items-center gap-3 p-3 rounded-2xl text-left active:scale-[0.98] transition-transform disabled:opacity-45"
                                    style={{
                                        background: selected ? '#fff4f7' : '#fffdfa',
                                        border: `1px solid ${selected ? '#d8a5b7' : '#eed6df'}`,
                                    }}
                                >
                                    <img src={c.convoSettings?.charAvatarOverride || c.avatar} className="w-10 h-10 rounded-full object-cover shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm font-bold truncate" style={{ color: INK }}>{c.convoSettings?.remarkName?.trim() || c.name}</div>
                                        <div className="text-[10.5px] truncate" style={{ color: INK_SOFT }}>
                                            {blocked ? '拉黑状态不可参与' : busy ? '并发生成中…' : selected ? '会并发生成回复' : '暂不参与并发'}
                                        </div>
                                    </div>
                                    <span
                                        className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-black shrink-0"
                                        style={selected ? { background: '#d8a5b7', color: '#fff' } : { background: '#fff', color: INK_SOFT, border: '1px solid #eed6df' }}
                                    >
                                        {selected ? '✓' : ''}
                                    </span>
                                </button>
                            );
                        })}
                        {characters.filter(c => c.id !== activeCharacterId).length === 0 && (
                            <ScrapNote center className="py-8">还没有别的私聊对象。</ScrapNote>
                        )}
                    </div>
                </div>
            </Modal>

            {/* Proactive Settings Modal */}
            {char && (
                <ProactiveSettingsModal
                    isOpen={showProactiveModal}
                    onClose={() => setShowProactiveModal(false)}
                    char={char}
                    isProactiveActive={isProactiveActive}
                    onSave={(config) => {
                        updateCharacter(char.id, { proactiveConfig: config });
                        if (config.enabled) {
                            startProactiveChat(config.intervalMinutes, config.randomMode);
                            addToast(
                                config.randomMode
                                    ? `已启动随机主动消息，${char.name} 会按自己的节奏找你`
                                    : `已启动主动消息，每 ${config.intervalMinutes >= 60 ? (config.intervalMinutes / 60) + ' 小时' : config.intervalMinutes + ' 分钟'}发送一次`,
                                'success'
                            );
                        } else {
                            stopProactiveChat();
                            addToast('已关闭主动消息', 'info');
                        }
                    }}
                    onStop={() => {
                        stopProactiveChat();
                        updateCharacter(char.id, { proactiveConfig: { ...char.proactiveConfig!, enabled: false } });
                        addToast('已停止主动消息', 'info');
                    }}
                />
            )}

            {/* 离线自主生活·日常回顾 Modal — 入口：加号面板「TA 的日常」/ 顶部回看横幅 */}
            {char && (
                <LifeRecapModal
                    isOpen={showLifeRecapModal}
                    onClose={() => setShowLifeRecapModal(false)}
                    char={char}
                />
            )}

            {/* 思考链设置 Modal — 入口：聊天加号面板「展示思考」按钮长按 / 思考链卡片右上齿轮 */}
            {char && (
                <ThinkingChainSettingsModal
                    isOpen={showThinkingChainModal}
                    onClose={() => setShowThinkingChainModal(false)}
                    value={{
                        enabled: !!(char as any).showThinkingChain,
                        styleId: ((char as any).thinkingChainStyle as any) || 'echo',
                        customColors: {
                            bg: (char as any).thinkingChainCustomColors?.bg || '#1f2937',
                            accent: (char as any).thinkingChainCustomColors?.accent || '#fbbf24',
                            text: (char as any).thinkingChainCustomColors?.text || '#f1f5f9',
                        },
                        customPrompt: (char as any).thinkingChainCustomPrompt || '',
                    }}
                    onChange={(next) => {
                        const patch: any = {};
                        if (next.enabled !== undefined) patch.showThinkingChain = next.enabled;
                        if (next.styleId !== undefined) patch.thinkingChainStyle = next.styleId;
                        if (next.customColors !== undefined) patch.thinkingChainCustomColors = next.customColors;
                        if (next.customPrompt !== undefined) patch.thinkingChainCustomPrompt = next.customPrompt;
                        if (Object.keys(patch).length) updateCharacter(char.id, patch as any);
                    }}
                />
            )}

            {/* 情绪设置已嵌入日程 Modal（与日程强制同步开/关），不再单独渲染 */}

            {/* 🍔 麦当劳小程序 - MCP 数据流按钮驱动, 协同聊天走主 pipeline (完整人设/记忆/日程) */}
            <McdMiniApp
                open={mcdAppOpen}
                onClose={() => setMcdAppOpen(false)}
                char={char}
                userProfile={userProfile}
                messages={messages}
                isTyping={isTyping}
                onSendMessage={handleMcdMiniAppSend}
                onStateChange={handleMcdMiniAppStateChange}
                onConfirmOrder={handleMcdAppConfirm}
            />


            {/* Forward Modal */}
            <Modal isOpen={showForwardModal} title="把这几页捎给谁" en="FORWARD" onClose={() => setShowForwardModal(false)}>
                <div className="space-y-2 max-h-64 overflow-y-auto no-scrollbar">
                    <ScrapNote className="mb-3">挑个人，把这几页转交过去（已选 {selectedMsgIds.size} 条）。</ScrapNote>
                    {characters.filter(c => c.id !== activeCharacterId).map(c => (
                        <ScrapRowBtn
                            key={c.id}
                            avatar={c.avatar}
                            onClick={() => handleForwardToCharacter(c.id)}
                            trailing={<span style={{ color: INK_SOFT }}>›</span>}
                        >
                            {c.name}
                        </ScrapRowBtn>
                    ))}
                    {characters.filter(c => c.id !== activeCharacterId).length === 0 && (
                        <ScrapNote center className="py-8">没有别的角色可以转交。</ScrapNote>
                    )}
                </div>
            </Modal>

            {/* 会话设置（聊天设置）全屏面板：右上角 ··· 进入 */}
            {modalType === 'chat-settings' && char && (
                <ConvoSettingsPanel
                    char={char}
                    onClose={() => setModalType('none')}
                    contextLimit={settingsContextLimit}
                    onContextLimitChange={setSettingsContextLimit}
                    translationEnabled={translationEnabled}
                    onToggleTranslation={() => {
                        const next = !translationEnabled;
                        setTranslationEnabled(next);
                        localStorage.setItem(`chat_translate_enabled_${activeCharacterId}`, JSON.stringify(next));
                        if (!next) setShowingTargetIds(new Set());
                    }}
                    translateSourceLang={translateSourceLang}
                    translateTargetLang={translateTargetLang}
                    onSetTranslateSourceLang={(lang: string) => { setTranslateSourceLang(lang); localStorage.setItem(`chat_translate_source_lang_${activeCharacterId}`, lang); setShowingTargetIds(new Set()); }}
                    onSetTranslateLang={(lang: string) => { setTranslateTargetLang(lang); localStorage.setItem(`chat_translate_lang_${activeCharacterId}`, lang); setShowingTargetIds(new Set()); }}
                    onOpenHistoryManager={() => setModalType('history-manager')}
                    onClearHistory={handleClearHistory}
                    onClearChatContextOnly={handleClearChatContextOnly}
                    preserveContext={preserveContext}
                    onTogglePreserveContext={() => setPreserveContext(!preserveContext)}
                    isVectorizing={isVectorizing}
                    onForceVectorize={handleForceVectorize}
                    onExportChat={handleExportChat}
                    messagesCount={(allHistoryMessages && allHistoryMessages.length > 0) ? allHistoryMessages.length : messages.length}
                    privateChatArchives={privateChatArchives}
                    activePrivateChatId={char.activePrivateChatId}
                    onNewPrivateChat={handleNewPrivateChat}
                    onSwitchPrivateChat={handleSwitchPrivateChat}
                    onRenamePrivateChat={handleRenamePrivateChat}
                    onTogglePinPrivateChat={handleTogglePinPrivateChat}
                    onDeletePrivateChat={handleDeletePrivateChat}
                    onExportPrivateChat={handleExportPrivateChat}
                    onImportPrivateChat={handleImportPrivateChat}
                    categories={categories}
                    emojiCounts={emojiCounts}
                    onSaveCategoryVisibility={handleSaveCategoryVisibility}
                    onBgUpload={handleBgUpload}
                    onRemoveBg={() => updateCharacter(char.id, { chatBackground: undefined })}
                    onOpenSchedule={() => setModalType('schedule')}
                    onOpenTabloid={() => setModalType('tabloid')}
                />
            )}

            {/* 回顾摘要（日回顾 / 周回顾 / 月回顾） */}
            {modalType === 'tabloid' && char && (
                <TabloidModal char={char} isOpen onClose={() => setModalType('none')} />
            )}

            {/* 角色主页（微信好友资料页风格）：单击消息头像进入；角色设置入口移到 ··· / 朋友资料 */}
            {showCharProfile && char && (
                <CharacterProfilePage
                    char={char}
                    onBack={() => setShowCharProfile(false)}
                    onSendMessage={() => setShowCharProfile(false)}
                    onVoiceCall={() => { setShowCharProfile(false); openApp(AppID.Call); }}
                    onVideoCall={() => { setShowCharProfile(false); openApp(AppID.VideoCall); }}
                    onOpenSettings={() => {
                        setShowCharProfile(false);
                        try {
                            localStorage.setItem('moro_character_open_target', char.id);
                            // 返回键回到聊天页而非桌面
                            localStorage.setItem('moro_character_return_app', AppID.Chat);
                            // 返回后重新展开角色主页：返回键只回上一个页面（角色设定 → 角色资料）
                            localStorage.setItem('moro_chat_reopen_profile', char.id);
                        } catch {}
                        openApp(AppID.Character);
                    }}
                    onOpenMoments={() => {
                        // 朋友圈已并入聊天枢纽标签页（独立朋友圈 App 已改造为小红书）
                        setShowCharProfile(false);
                        try { localStorage.setItem('moro_chathub_open_tab', 'moments'); } catch { /* ignore */ }
                        openApp(AppID.GroupChat);
                    }}
                    onDeleted={() => { setShowCharProfile(false); openApp(AppID.GroupChat); }}
                />
            )}

            {/* 「你已将对方拉黑」弹窗：回到聊天界面时提示一次 */}
            {showUserBlockNotice && char && (
                <div className="absolute inset-0 z-[400] flex items-center justify-center p-6 animate-fade-in" style={{ background: 'rgba(20,18,16,0.5)', backdropFilter: 'blur(3px)' }} onClick={() => setShowUserBlockNotice(false)}>
                    <div className="w-[min(80vw,300px)] rounded-2xl overflow-hidden animate-pop-in" style={{ background: 'linear-gradient(180deg,#fbf9f2,#f2efe4)', border: `1px solid ${INK_SOFT}66`, boxShadow: '0 30px 60px -24px rgba(20,18,14,0.6)', color: INK }} onClick={e => e.stopPropagation()}>
                        <div className="px-6 pt-6 pb-5 text-center">
                            <div className="w-10 h-10 mx-auto mb-3 rounded-full text-xl font-black flex items-center justify-center" style={{ background: INK, color: '#f6f3ec', backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.16) 0 5px, transparent 5px 10px)' }}>!</div>
                            <div className="text-[16px] font-black" style={{ color: INK }}>已拉黑 {char.name}</div>
                            <div className="text-[13px] mt-2 leading-relaxed" style={{ color: INK_SOFT }}>
                                你把 TA 加进了黑名单，暂时聊不了。TA 发来的消息照样显示，气泡旁会带个感叹号。
                                想解除就去「角色资料 → 朋友设置」。
                            </div>
                        </div>
                        <button
                            onClick={() => { void handlePeekBlockedChar(); }}
                            disabled={isTyping}
                            className="w-full py-3.5 text-[15px] font-black active:scale-[0.99] transition-transform disabled:opacity-50"
                            style={{ color: INK, borderTop: `1px dashed ${INK_SOFT}66` }}
                        >
                            看看 TA 在做什么
                        </button>
                        <button
                            onClick={() => setShowUserBlockNotice(false)}
                            className="w-full py-3.5 text-[15px] font-bold active:scale-[0.99] transition-transform"
                            style={{ color: INK_SOFT, borderTop: `1px dashed ${INK_SOFT}66` }}
                        >
                            知道了
                        </button>
                    </div>
                </div>
            )}

            {/* 收款弹窗：角色发来的转账 / 红包，用户选择是否收下（超 24h 自动过期） */}
            {claimTarget && char && (() => {
                const meta: any = claimTarget.metadata || {};
                const isRedpacket = meta.kind === 'redpacket';
                const amt = Math.abs(parseFloat(String(meta.amount))) || 0;
                const note = isRedpacket && typeof meta.note === 'string' && meta.note.trim() ? meta.note.trim() : '';
                const hair = '1px solid #eed6df';
                const isPassword = isRedpacket && meta.rpType === 'password';
                const closeModal = () => { setClaimTarget(null); setClaimRevealed(false); setClaimPwInput(''); };
                return (
                    <div className="absolute inset-0 z-[400] flex items-center justify-center p-6 animate-fade-in" style={{ background: 'rgba(20,18,16,0.5)', backdropFilter: 'blur(3px)' }} onClick={closeModal}>
                        <div
                            className="w-[min(84vw,330px)] relative rounded-[22px] overflow-hidden animate-pop-in"
                            onClick={e => e.stopPropagation()}
                            style={{ background: 'linear-gradient(180deg,#fffdfa,#fff4f7)', color: '#5a3140', boxShadow: '0 30px 60px -24px rgba(122,90,114,0.45)', border: '1px solid #eed6df' }}
                        >
                            <div className="px-7 pt-8 pb-6 text-center relative">
                                <div className="text-[9px] font-mono tracking-[0.28em] uppercase mb-2" style={{ color: '#a892a3' }}>{isRedpacket ? 'Red Packet' : 'Transfer'}</div>
                                <div className="text-[14px] font-bold">{displayCharName} 给你发送了{isRedpacket ? '红包' : '一笔转账'}</div>
                                {note && <div className="text-[12.5px] mt-1.5 italic" style={{ opacity: 0.8 }}>「{note}」</div>}
                                {!claimRevealed ? (
                                    isPassword ? (
                                        <div className="mt-4 space-y-2.5">
                                            <div className="text-[11px]" style={{ color: '#a892a3' }}>这是口令红包 · 输入正确口令后领取</div>
                                            <input
                                                value={claimPwInput}
                                                onChange={e => setClaimPwInput(e.target.value)}
                                                onKeyDown={e => { if (e.key === 'Enter') { const ok = !!claimPwInput.trim() && claimPwInput.trim().toLowerCase() === String(meta.password || '').trim().toLowerCase(); if (ok) { setClaimRevealed(true); setClaimPwInput(''); } else addToast('口令不对，再想想？', 'error'); } }}
                                                placeholder="在此输入口令"
                                                className="w-full px-3 py-2.5 rounded-xl text-center text-[14px] outline-none"
                                                style={{ background: '#fffdfa', color: '#5a3140', border: '1px solid #eed6df' }}
                                                autoFocus
                                            />
                                            <button
                                                onClick={() => { const ok = !!claimPwInput.trim() && claimPwInput.trim().toLowerCase() === String(meta.password || '').trim().toLowerCase(); if (ok) { setClaimRevealed(true); setClaimPwInput(''); } else addToast('口令不对，再想想？', 'error'); }}
                                                className="w-full py-2.5 rounded-xl text-[13px] font-bold active:scale-95 transition-transform"
                                                style={{ background: '#d8a5b7', color: '#fffdfa' }}
                                            >确认口令</button>
                                        </div>
                                    ) : (
                                    <button
                                        onClick={() => setClaimRevealed(true)}
                                        className="mt-5 mx-auto w-20 h-20 rounded-full flex flex-col items-center justify-center active:scale-90 transition-transform"
                                        style={{ background: '#d8a5b7', color: '#fffdfa', boxShadow: '0 0 0 5px rgba(216,165,183,0.18), 0 12px 24px -16px rgba(122,90,114,0.55)' }}
                                    >
                                        <span className="text-[22px] leading-none">{isRedpacket ? '¥' : '↥'}</span>
                                        <span className="text-[10px] font-bold mt-0.5">查看</span>
                                    </button>
                                    )
                                ) : (
                                    <div className="mt-4 animate-pop-in">
                                        <div className="flex items-end justify-center gap-1">
                                            <span className="text-[18px] font-bold pb-1.5" style={{ opacity: 0.6 }}>¥</span>
                                            <span className="text-[36px] font-black leading-none tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>{meta.amount}</span>
                                        </div>
                                        <div className="text-[10.5px] mt-2.5 leading-relaxed" style={{ opacity: 0.55 }}>收下后进入你的钱包余额 · 超过 24 小时不领自动退回</div>
                                    </div>
                                )}
                            </div>
                            {claimRevealed && (
                                <div className="flex" style={{ borderTop: hair }}>
                                    <button onClick={() => { void handleDeclineTransfer(); setClaimRevealed(false); }} className="flex-1 py-3.5 text-[14px] font-medium active:opacity-70" style={{ opacity: 0.62 }}>先不收</button>
                                    <button onClick={() => { void handleAcceptTransfer(); setClaimRevealed(false); }} className="flex-1 py-3.5 text-[14px] font-bold active:opacity-80" style={{ borderLeft: hair }}>收下 ¥{Math.round(amt)}</button>
                                </div>
                            )}
                        </div>
                    </div>
                );
            })()}

            {/* 「角色给你换备注」弹窗：点开看动机 */}
            {remarkChangeNotice && char && (
                <div className="absolute inset-0 z-[400] flex items-center justify-center p-6 animate-fade-in" style={{ background: 'rgba(20,18,16,0.5)', backdropFilter: 'blur(3px)' }} onClick={() => setRemarkChangeNotice(null)}>
                    <div className="w-[min(82vw,320px)] rounded-3xl overflow-hidden animate-pop-in" style={{ background: 'linear-gradient(180deg,#fbf9f2,#f2efe4)', border: `1px solid ${INK_SOFT}66`, boxShadow: '0 30px 60px -24px rgba(20,18,14,0.6)', color: INK }} onClick={e => e.stopPropagation()}>
                        <div className="px-6 pt-6 pb-5 text-center">
                            <img src={displayCharAvatar} className="w-12 h-12 mx-auto mb-3 rounded-full object-cover shadow" style={{ border: '2px solid #fbf9f2', outline: `1px solid ${INK_SOFT}66` }} alt="" />
                            <div className="text-[15px] font-black" style={{ color: INK }}>{displayCharName} 给你换了备注</div>
                            <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full" style={{ background: INK, color: '#f6f3ec' }}>
                                <span className="text-[11px]" style={{ color: '#cfc7b8' }}>现在叫你</span>
                                <span className="text-[14px] font-black">{remarkChangeNotice.remark}</span>
                            </div>
                            {remarkChangeNotice.motivation && (
                                remarkMotivationOpen ? (
                                    <div className="mt-4 rounded-2xl p-3.5 text-[13px] leading-relaxed text-left animate-fade-in" style={{ background: 'rgba(255,253,247,0.82)', border: `1px solid ${INK_SOFT}55`, outline: `1px dashed ${INK_SOFT}44`, outlineOffset: -4, color: INK }}>
                                        {remarkChangeNotice.motivation}
                                    </div>
                                ) : (
                                    <button
                                        onClick={() => setRemarkMotivationOpen(true)}
                                        className="mt-4 text-[12px] font-black active:scale-95 transition-transform"
                                        style={{ color: INK }}
                                    >
                                        TA 为什么这么改？ 💭
                                    </button>
                                )
                            )}
                        </div>
                        <button
                            onClick={() => setRemarkChangeNotice(null)}
                            className="w-full py-3.5 text-[15px] font-bold active:scale-[0.99] transition-transform"
                            style={{ color: INK_SOFT, borderTop: `1px dashed ${INK_SOFT}66` }}
                        >
                            知道了
                        </button>
                    </div>
                </div>
            )}

            {/* 查岗（用户 → 角色）：+ 号面板入口，内嵌原 CheckPhone */}
            {showCheckPhone && char && (
                <div className="absolute inset-0 z-[410]">
                    <CheckPhone initialCharId={char.id} onExit={() => setShowCheckPhone(false)} onConfront={handlePhoneConfront} />
                </div>
            )}

            {/* 相机：用 TA 的手机拍下此刻给 TA 看 */}
            {showCamera && char && (
                <CameraApp
                    charId={char.id}
                    onExit={() => setShowCamera(false)}
                    onSendToChat={(dataUrl) => { setShowCamera(false); void handleSendText(dataUrl, 'image'); }}
                />
            )}

            {/* 查岗（角色 → 用户）：界面变成用户桌面，角色自己翻看 + 想法框 */}
            {charPhoneCheckActive && char && (
                <CharPhoneCheckOverlay
                    char={char}
                    userProfile={userProfile}
                    characters={characters}
                    apiConfig={apiConfig}
                    updateCharacter={updateCharacter}
                    updateUserProfile={updateUserProfile}
                    addToast={addToast}
                    onEnd={handleCharPhoneCheckEnd}
                />
            )}

            {/* 线下模式弹窗：默认走副 API（与「线下功能默认走副 API」的约定一致，
                不与线上聊天抢同一根线、也省主 API 额度；副 API 没配则回退主 API） */}
            {showOfflineMode && char && (
                <OfflineModeModal
                    char={char}
                    userProfile={userProfile}
                    apiConfig={resolveAuxApi(auxApiConfig, apiConfig)}
                    addToast={addToast}
                    onEnd={handleOfflineEnd}
                />
            )}

            {/* 行动选择器：点最后一轮 user 头像后弹出 */}
            {showActionSelector && char && (
                <UserActionSelectorModal
                    char={char}
                    userProfile={userProfile}
                    recent={messages}
                    api={resolveAuxApi(auxApiConfig, apiConfig)}
                    addToast={addToast}
                    onClose={() => setShowActionSelector(false)}
                    onSend={(text) => { void handleSendText(text); }}
                />
            )}

            {/* 被角色拉黑后的好友验证 */}
            {char && (
                <FriendVerifyModal
                    char={char}
                    isOpen={showFriendVerify}
                    onClose={() => setShowFriendVerify(false)}
                    onAccepted={() => { void reloadMessages(visibleCountRef.current); }}
                />
            )}
        </div>
    );
};

export default Chat;
