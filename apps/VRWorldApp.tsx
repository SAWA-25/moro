import React, { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from 'react';
import { useOS } from '../context/OSContext';
import {
    ArrowLeft, Plus, Trash, BookOpen, Planet, Clock, Play, CaretRight, X,
    UploadSimple, PencilSimple, FlipHorizontal, CaretLeft, Sparkle,
    CircleNotch, TextAa, Palette, Pause, MusicNotes, Queue, Check, Gear,
    Camera, Shuffle, Sticker, Smiley, Confetti, Heart, Star, MagicWand,
    ArrowsClockwise, UsersThree, HandWaving, Scissors,
} from '@phosphor-icons/react';
import TheaterPanel from './theater/TheaterPanel';
import { CreatorIframe, type ChibiResult } from '../components/Like520Event';
import { useMusic, type Song } from '../context/MusicContext';
import { DB } from '../utils/db';
import { VRScheduler } from '../utils/vrWorld/scheduler';
import { VR_ROOMS, getRoom, VR_DEFAULT_INTERVAL_MIN } from '../utils/vrWorld/constants';
import { buildNovelAsync, groupAnnotationsBySeg, getBookmark } from '../utils/vrWorld/novel';
import { decodeBytes } from '../utils/vrWorld/decodeText';
import { stripLeakedAttrs } from '../utils/vrWorld/prompts';
import { PostOffice, MAX_LETTER_CHARS, exportIdentity, importIdentity, getAdminToken, setAdminToken, type RemoteReply, type RemoteLetterStat, type RemoteAdminLetter } from '../utils/vrWorld/postOffice';
import { getVRApi, setVRApi, getVRApiLog, clearVRApiLog, type VRApiCall } from '../utils/vrWorld/vrApi';
import { safeResponseJson } from '../utils/safeApi';

const genLocalId = (p: string) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

// 安全区单一来源：index.html :root 定义 --safe-top/--safe-bottom/--chrome-top，
// 由 utils/iosStandalone.ts 喂入 JS 探测值（iOS 全屏 PWA 下原生 env 偶发返回 0 时兜底）。
// 全屏浮层背景铺满屏幕，只用这些变量给顶/底「控件」让位。
const VR_TOP = 'var(--chrome-top)';                            // 安全区 + Moro 状态栏：全屏面板顶栏统一用它
const VR_SAFE_BOTTOM = 'var(--safe-bottom)';
const VR_ROOM_PANEL_TOP = 'calc(var(--chrome-top) + 3.75rem)'; // 房间内浮层从顶栏下方开始
// 底部额外留一点手势余量；iOS 全屏隐藏 home 条时也不让交互区贴着物理底边。
const VR_BOTTOM_TOUCH_GAP = '0.75rem';
// 底部内边距 / 贴底定位统一用它：base + 安全区 + 手势余量。
const vrBottomPad = (base: string) => `calc(${base} + ${VR_SAFE_BOTTOM} + ${VR_BOTTOM_TOUCH_GAP})`;

// ── 邮局寄信「日额度」：纯前端软计数，给后端减负（不追求精准，清数据会重置）──
// 从首封开始计时的滚动窗口，窗口内封顶、过期自动归零。两个额度各自独立。
// 投信：与后端对齐——5 封 / 5 小时（后端 PO_RATE_LETTERS=5、LETTERS_WINDOW_MS=5h，且按封数扣额度）。
const PO_SEND_QUOTA = { key: 'vr_po_send_quota', limit: 5, windowMs: 5 * 3600_000 };
// 回信：前端自定日额度（后端无每日上限，仅 60/分钟防刷；前端更严是安全方向）。
const PO_REPLY_QUOTA = { key: 'vr_po_reply_quota', limit: 20, windowMs: 24 * 3600_000 };
type QuotaCfg = { key: string; limit: number; windowMs: number };
const charLen = (s: string) => [...(s || '')].length;
const readQuota = (q: QuotaCfg): { windowStart: number; count: number } => {
    try {
        const raw = JSON.parse(localStorage.getItem(q.key) || 'null');
        if (raw && typeof raw.windowStart === 'number' && typeof raw.count === 'number'
            && Date.now() - raw.windowStart < q.windowMs) return raw;
    } catch { /* ignore */ }
    return { windowStart: 0, count: 0 };
};
const bumpQuota = (q: QuotaCfg, n: number) => {
    const cur = readQuota(q);
    const windowStart = cur.windowStart || Date.now();
    try { localStorage.setItem(q.key, JSON.stringify({ windowStart, count: cur.count + n })); } catch { /* ignore */ }
};
const quotaResetHours = (windowStart: number, windowMs: number) =>
    windowStart ? Math.max(1, Math.ceil((windowStart + windowMs - Date.now()) / 3600_000)) : Math.ceil(windowMs / 3600_000);

/** 气泡/动态里去掉开头多余的"自己名字"主语（角色播报本就该省略主语）。 */
const stripSelfName = (text: string | undefined, name: string | undefined): string => {
    if (!text) return '';
    if (!name) return text;
    const t = text.replace(/^\s+/, '');
    if (t.startsWith(name)) {
        const rest = t.slice(name.length).replace(/^[\s，,、：:·\-—]*/, '');
        if (rest) return rest;
    }
    return text;
};
import type { CharacterProfile, UserProfile, VRWorldNovel, VRNovelAnnotation, VRCardMeta, VRRoomId, VRMusicRoomState, CharPlaylistSong, VRGuestbookState, VRGuestbookMessage, VRLetter, ApiPreset, APIConfig, VRChibi } from '../types';

// ============ chibi 形象解析（vrState.chibi → 立绘 → 头像） ============
import { getChibi } from '../utils/vrWorld/chibi';

// ============ 页外 · 拼贴手账主题 ============
// 整套界面用一种语言：牛皮纸/卡纸 + 墨水手写字 + 胶带/便签/贴纸/邮戳。
// 全部颜色、字体、基元都收口在这里，组件只取用，不再各自硬编码深色太空风。
const HAND = `'LXGW WenKai','Kaiti SC','STKaiti','KaiTi','楷体','Noto Serif SC',serif`;
const PAPER = {
    page: '#ece2cd',     // 主页面：暖牛皮纸
    paper: '#fbf6ea',    // 干净卡纸
    cream: '#f6efdd',    // 微黄卡纸
    ink: '#3f3526',      // 墨色正文
    inkSoft: '#7c6f57',  // 次级墨
    inkFaint: '#a99d82', // 极淡墨
    line: '#d8caa9',     // 网格/分隔
    edge: '#c9b793',     // 卡片描边
    red: '#c0563f',      // 红印章/马克笔
    teal: '#2f8a80',     // 青绿点缀
};
// 便签纸随机色（拼贴感）
const NOTE_COLORS = ['#fff3c4', '#ffe1e7', '#d9edd7', '#d7e7f6', '#f1e3cf', '#eadff5', '#ffe9cc'];
// 胶带（washi tape）半透明色
const TAPE_COLORS = ['rgba(238,196,110,.66)', 'rgba(150,200,180,.6)', 'rgba(232,158,168,.55)', 'rgba(154,184,222,.55)', 'rgba(198,170,224,.55)'];
// 每个房间一套拼贴主题（胶带色 / emoji 贴纸 / 墨色 / 卡纸底）
const ROOM_THEME: Record<VRRoomId, { tape: string; sticker: string; ink: string; paper: string }> = {
    plaza:      { tape: 'rgba(198,164,228,.62)', sticker: '🎪', ink: '#5b3f7a', paper: '#efe4fb' },
    library:    { tape: 'rgba(224,180,110,.62)', sticker: '📖', ink: '#7a5326', paper: '#f6ecd6' },
    music:      { tape: 'rgba(232,150,170,.58)', sticker: '🎧', ink: '#9a3f5e', paper: '#fce3ea' },
    guestbook:  { tape: 'rgba(150,190,225,.6)',  sticker: '📌', ink: '#2f5f86', paper: '#e2eef9' },
    gym:        { tape: 'rgba(140,200,160,.6)',  sticker: '🎮', ink: '#2f6b46', paper: '#e1f0e3' },
    postoffice: { tape: 'rgba(212,182,132,.62)', sticker: '✉️', ink: '#7a5a2b', paper: '#f1e6cf' },
    theater:    { tape: 'rgba(206,150,200,.56)', sticker: '🎭', ink: '#6b3a66', paper: '#f1e0ee' },
};
const roomTheme = (id: VRRoomId) => ROOM_THEME[id] || ROOM_THEME.plaza;
// 由字符串确定性地取一个便签色 / 一个小倾角，让每张拼贴卡都歪一点、颜色各异
const seedNum = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffff; return h; };
const noteColor = (s: string) => NOTE_COLORS[seedNum(s) % NOTE_COLORS.length];
const tiltOf = (s: string, amp = 2.4) => (((seedNum(s) % 100) / 100) * 2 - 1) * amp; // -amp..amp 度
// 小人姿势 → 动画（世界房间里小人更生动；解析自 LLM 的 <姿势>）
const POSE_ANIM: Record<string, string> = {
    idle: 'vrfloat 3.4s ease-in-out infinite',
    bob: 'ywbob 1.8s ease-in-out infinite',
    wiggle: 'ywwiggle 1.1s ease-in-out infinite',
    jump: 'ywjump 0.9s ease-in-out infinite',
    spin: 'ywspin 2.4s linear infinite',
    nod: 'ywnod 1.4s ease-in-out infinite',
    dance: 'vrdance 0.9s ease-in-out infinite',
};
const poseAnim = (pose?: string, fallback = 'vrfloat 3.2s ease-in-out infinite') => (pose && POSE_ANIM[pose]) || fallback;
const POSE_LIST: { key: string; label: string }[] = [
    { key: 'idle', label: '随意' }, { key: 'bob', label: '轻晃' }, { key: 'wiggle', label: '扭扭' },
    { key: 'jump', label: '蹦跶' }, { key: 'spin', label: '转圈' }, { key: 'nod', label: '点头' },
];
const STICKER_CHOICES = ['', '⭐', '💛', '🌸', '🍬', '🎀', '☁️', '🔥', '🫧', '✨', '🍀', '🐾'];

// —— 拼贴基元 ——
// 一段胶带（washi tape），贴在卡片顶/角
const Tape: React.FC<{ color?: string; className?: string; style?: React.CSSProperties; w?: number }> = ({ color, className, style, w = 46 }) => (
    <span className={`pointer-events-none absolute ${className || ''}`} aria-hidden="true"
        style={{ width: w, height: 16, background: color || TAPE_COLORS[0], opacity: 0.92, boxShadow: '0 1px 2px rgba(0,0,0,.12)', ...style }} />
);
// 图钉
const Pin: React.FC<{ color?: string; className?: string; style?: React.CSSProperties }> = ({ color = PAPER.red, className, style }) => (
    <span className={`pointer-events-none absolute rounded-full ${className || ''}`} aria-hidden="true"
        style={{ width: 9, height: 9, background: `radial-gradient(circle at 35% 30%, #fff7, ${color})`, boxShadow: '0 1.5px 2px rgba(0,0,0,.35)', ...style }} />
);
// 一张拼贴卡纸（轻微歪斜 + 纸感阴影 + 描边）
const Card: React.FC<{ children: React.ReactNode; tilt?: number; color?: string; className?: string; style?: React.CSSProperties; onClick?: () => void }>
    = ({ children, tilt = 0, color, className, style, onClick }) => (
    <div onClick={onClick} className={`relative ${className || ''}`}
        style={{ background: color || PAPER.paper, border: `1px solid ${PAPER.edge}`, borderRadius: 10, transform: tilt ? `rotate(${tilt}deg)` : undefined, boxShadow: '0 3px 0 rgba(120,100,60,.10), 0 8px 18px rgba(80,64,30,.16)', ...style }}>
        {children}
    </div>
);
// 手写小标签（贴纸/便签标题）
const InkTag: React.FC<{ children: React.ReactNode; color?: string; className?: string; style?: React.CSSProperties }> = ({ children, color, className, style }) => (
    <span className={`inline-flex items-center px-2 py-0.5 text-[11px] ${className || ''}`}
        style={{ fontFamily: HAND, color: PAPER.ink, background: color || '#fff3c4', border: `1px solid ${PAPER.edge}`, borderRadius: 4, boxShadow: '0 1px 2px rgba(80,64,30,.18)', ...style }}>{children}</span>
);
// 缝线虚线分隔
const Stitch: React.FC<{ className?: string; color?: string }> = ({ className, color }) => (
    <div className={className} style={{ height: 0, borderTop: `1.5px dashed ${color || PAPER.line}` }} />
);
// 纸质按钮（实心马克笔块）
const InkBtn: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'ink' | 'red' | 'teal' | 'soft' }> = ({ tone = 'ink', className, style, children, ...rest }) => {
    const bg = tone === 'red' ? PAPER.red : tone === 'teal' ? PAPER.teal : tone === 'soft' ? '#fff3c4' : PAPER.ink;
    const fg = tone === 'soft' ? PAPER.ink : '#fbf3e0';
    return (
        <button {...rest} className={`active:translate-y-px transition-transform disabled:opacity-40 ${className || ''}`}
            style={{ fontFamily: HAND, background: bg, color: fg, border: `1px solid ${tone === 'soft' ? PAPER.edge : 'rgba(0,0,0,.18)'}`, borderRadius: 8, boxShadow: '0 2px 0 rgba(0,0,0,.18)', ...style }}>{children}</button>
    );
};

type Tab = 'world' | 'library' | 'settings' | 'api';

interface FeedItem {
    msgId: number; charId: string; charName: string; avatar: string;
    timestamp: number; meta: VRCardMeta; content: string;
    hidden: boolean; // 对 AI 上下文不可见（归档隐藏起点之前 / 记忆宫殿高水位之前）
}

// 每个房间的 chibi 站位（百分比坐标，底对齐）
const ROOM_SLOTS: Record<VRRoomId, { x: number; y: number }[]> = {
    plaza:     [{ x: 20, y: 72 }, { x: 38, y: 78 }, { x: 56, y: 74 }, { x: 74, y: 80 }, { x: 30, y: 64 }, { x: 50, y: 66 }, { x: 68, y: 62 }, { x: 84, y: 70 }],
    library:   [{ x: 24, y: 72 }, { x: 50, y: 78 }, { x: 74, y: 70 }, { x: 38, y: 64 }, { x: 62, y: 64 }],
    music:     [{ x: 30, y: 74 }, { x: 55, y: 78 }, { x: 72, y: 70 }, { x: 45, y: 66 }],
    guestbook: [{ x: 28, y: 76 }, { x: 52, y: 78 }, { x: 73, y: 74 }, { x: 40, y: 68 }],
    gym:       [{ x: 26, y: 74 }, { x: 50, y: 80 }, { x: 74, y: 74 }, { x: 38, y: 66 }, { x: 62, y: 66 }],
    postoffice:[{ x: 28, y: 76 }, { x: 52, y: 78 }, { x: 72, y: 72 }, { x: 42, y: 68 }],
    theater:   [{ x: 30, y: 80 }, { x: 70, y: 80 }, { x: 50, y: 84 }, { x: 40, y: 72 }, { x: 60, y: 72 }],
};

const IDLE_QUIPS: Record<VRRoomId, string[]> = {
    plaza: ['嗨呀～', '又见面啦', '今天也来报到', '谁要一起合影', '在广场上晃悠', '凑个热闹', '换了身新衣服', '比个耶✌️'],
    library: ['翻着书页…', '这本还挺好看', '嘘，安静', '又是看书的一天'],
    music: ['随节奏轻晃', '这首单曲循环', '戴上耳机', '调一下音量'],
    guestbook: ['写点什么呢', '路过留个名', '看看墙上的话', '嗯…'],
    gym: ['活动一下', '再来一组！', '伸个懒腰', '热身中'],
    postoffice: ['给谁写封信呢', '封口、寄出', '翻翻信格', '写点心里话'],
    theater: ['对台词…', '再走一遍', '背词中', '候场'],
};

const VRWorldApp: React.FC = () => {
    const { closeApp, characters, updateCharacter, addToast, registerBackHandler, userProfile, updateUserProfile, apiPresets, apiConfig } = useOS();
    const userName = userProfile?.name || '我';
    const [tab, setTab] = useState<Tab>('world');
    const [novels, setNovels] = useState<VRWorldNovel[]>([]);
    const [feed, setFeed] = useState<FeedItem[]>([]);
    const [poBadge, setPoBadge] = useState<{ toSend: number; toCollect: number }>({ toSend: 0, toCollect: 0 });
    const [loading, setLoading] = useState(true);

    // 邮局徽标：本地待寄出/待发送 + 后端待收取的回信（best-effort 探测）
    const refreshPoBadge = useCallback(async () => {
        try {
            const letters = await DB.getVRLetters();
            const toSend = letters.filter(l =>
                (l.box === 'outbox' && l.status === 'queued') ||
                (l.box === 'inbox' && l.replyStatus === 'queued')
            ).length;
            let toCollect = 0;
            const sentIds = new Set(letters.filter(l => l.box === 'outbox' && l.status === 'sent' && l.remoteId).map(l => l.remoteId!));
            if (sentIds.size > 0) {
                try {
                    const replies = await PostOffice.fetchReplies();
                    toCollect = new Set(replies.filter(r => sentIds.has(r.letter_id)).map(r => r.letter_id)).size;
                } catch { /* 离线/未配置：忽略，只显示本地待办 */ }
            }
            setPoBadge({ toSend, toCollect });
        } catch { /* ignore */ }
    }, []);

    const [enterRoom, setEnterRoom] = useState<VRRoomId | null>(null);
    const [readerNovel, setReaderNovel] = useState<VRWorldNovel | null>(null);
    const [readerJump, setReaderJump] = useState<{ novel: VRWorldNovel; seg: number } | null>(null);
    const [showUpload, setShowUpload] = useState(false);
    const [chibiEditChar, setChibiEditChar] = useState<CharacterProfile | null>(null);
    const [chibiEditUser, setChibiEditUser] = useState(false); // 用户本人捏 chibi
    // 启用流程：设定 chibi 后回调启用
    const [pendingEnable, setPendingEnable] = useState<string | null>(null);

    const loadNovels = useCallback(async () => setNovels(await DB.getVRNovels()), []);
    const loadFeed = useCallback(async () => {
        const items: FeedItem[] = [];
        for (const c of characters) {
            // 页外动态取数走 getVRCardsByCharId：全量捞该角色的 vr_card，不受"最近 N 条窗口"、
            // 记忆宫殿高水位线（mp_lastMsgId_<charId>）、归档隐藏起点（hideBeforeMessageId）影响。
            // 这些机制只管「LLM 上下文能不能看到」——而页外动态是用户自己的浏览界面，
            // 只要消息还在 IndexedDB 里就该一直能看到：
            //   · 记忆宫殿后台向量化推高水位 → 动态不该突然清零；
            //   · 角色记忆归档把旧聊天标记为"对 AI 隐藏" → 这些动态依旧存在，用户仍要能回看；
            //   · 聊天攒多了把旧 vr_card 挤出最近窗口 → 不该因此从动态流消失。
            // （清空聊天会真删消息，删掉就没了——那是预期行为，逻辑不变。）
            const msgs = await DB.getVRCardsByCharId(c.id);
            // 「对 AI 不可见」判定：归档隐藏起点（hideBeforeMessageId，m.id < 它即隐藏）
            // 或记忆宫殿高水位（mp_lastMsgId，m.id <= 它即被向量记忆替代）。
            // 两者都让 LLM 读不到原文——动态本身仍在，只是上下文看不到，UI 里暗显并标「已隐藏」。
            const hideBefore = (c as any).hideBeforeMessageId || 0;
            let mpHwm = 0;
            try { mpHwm = parseInt(localStorage.getItem(`mp_lastMsgId_${c.id}`) || '0', 10) || 0; } catch { /* ignore */ }
            const hiddenCut = Math.max(hideBefore - 1, mpHwm); // m.id <= hiddenCut ⇒ 对 AI 不可见
            for (const m of msgs) {
                // 用户在留言簿的发言会广播进每个角色的 vr_card（供 LLM 上下文用），
                // 但它不是"角色自己的动态"——不进动态流，也不当作 chibi 气泡。
                if (!m.metadata?.userBoardPost) {
                    items.push({ msgId: m.id, charId: c.id, charName: c.name, avatar: c.avatar, timestamp: m.timestamp, meta: m.metadata as VRCardMeta, content: m.content, hidden: m.id <= hiddenCut });
                }
            }
        }
        items.sort((a, b) => b.timestamp - a.timestamp);
        setFeed(items.slice(0, 50));
    }, [characters]);

    const reloadAll = useCallback(async () => {
        setLoading(true);
        await Promise.all([loadNovels(), loadFeed()]);
        setLoading(false);
    }, [loadNovels, loadFeed]);

    useEffect(() => { void reloadAll(); void refreshPoBadge(); }, [reloadAll, refreshPoBadge]);
    useEffect(() => {
        const handler = () => { void reloadAll(); void refreshPoBadge(); };
        window.addEventListener('vr-session-done', handler);
        return () => window.removeEventListener('vr-session-done', handler);
    }, [reloadAll, refreshPoBadge]);
    // 离开房间（可能在邮局操作过）后刷新徽标
    useEffect(() => { if (enterRoom === null) void refreshPoBadge(); }, [enterRoom, refreshPoBadge]);

    // 最近一条动态（按角色）
    const latestByChar = useMemo(() => {
        const map: Record<string, FeedItem> = {};
        for (const f of feed) if (!map[f.charId]) map[f.charId] = f;
        return map;
    }, [feed]);

    const occupantsByRoom = useMemo(() => {
        const map: Record<string, CharacterProfile[]> = {};
        for (const c of characters) {
            if (c.vrState?.enabled) {
                const room = c.vrState.currentRoom || 'library';
                (map[room] ||= []).push(c);
            }
        }
        // 用户本人接入页外且设了 chibi → 作为伪 occupant 站进自己挂着的房间
        const uv = userProfile?.vrState;
        if (uv?.enabled && uv.chibi?.img) {
            const room = uv.currentRoom || 'guestbook';
            const pseudo = { id: 'user', name: userName, avatar: userProfile?.avatar || '', vrState: { enabled: true, intervalMinutes: 0, currentRoom: room, chibi: uv.chibi } } as unknown as CharacterProfile;
            (map[room] ||= []).push(pseudo);
        }
        return map;
    }, [characters, userProfile, userName]);

    const enabledCount = characters.filter(c => c.vrState?.enabled).length;

    // 返回键：有弹层先关弹层（阅读器/房间/上传/捏人），而不是直接退回桌面
    useEffect(() => registerBackHandler(() => {
        if (chibiEditChar) { setChibiEditChar(null); setPendingEnable(null); return true; }
        if (chibiEditUser) { setChibiEditUser(false); return true; }
        if (showUpload) { setShowUpload(false); return true; }
        if (readerJump) { setReaderJump(null); return true; }
        if (readerNovel) { setReaderNovel(null); return true; }
        if (enterRoom) { setEnterRoom(null); return true; }
        return false; // 无弹层 → 交回默认（关闭 App）
    }), [registerBackHandler, chibiEditChar, chibiEditUser, showUpload, readerJump, readerNovel, enterRoom]);

    // 从动态/批注点回原文：peek 模式打开阅读器跳到该段，不动用户书签
    const jumpToAnnotation = useCallback((novelId: string | undefined, segIdx: number) => {
        if (!novelId) return;
        const n = novels.find(x => x.id === novelId);
        if (n) setReaderJump({ novel: n, seg: segIdx });
    }, [novels]);

    // 用户在留言簿发言：落墙 + 以小卡片广播给所有接入页外的角色私聊
    const onUserBoardPost = useCallback(async (content: string) => {
        const t = content.trim();
        if (!t) return;
        const board = (await DB.getVRGuestbook()) || { id: 'board', messages: [], updatedAt: Date.now() };
        const id = `gb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
        board.messages = [...board.messages, { id, authorId: 'user', authorName: userName, content: t, createdAt: Date.now() }].slice(-200);
        board.updatedAt = Date.now();
        await DB.saveVRGuestbook(board);
        const enabled = characters.filter(c => c.vrState?.enabled);
        for (const c of enabled) {
            await DB.saveMessage({
                charId: c.id, role: 'user', type: 'vr_card',
                content: `「页外 · 留言簿」${userName} 在留言墙上发了：${t}`,
                metadata: { vrCard: true, room: 'guestbook', userBoardPost: true, activity: `${userName} 在留言墙上发了：${t}`, boardPost: t },
            } as any);
        }
        addToast?.(enabled.length > 0 ? `已留言，并广播给 ${enabled.length} 位接入角色` : '已留言', 'success');
    }, [characters, userName, addToast]);

    // 用户更新自己的页外状态：以行为卡片广播给所有接入页外的角色（机制同留言簿发言）
    const onUserVRBroadcast = useCallback(async (room: VRRoomId, activity: string) => {
        const roomName = VR_ROOMS.find(r => r.id === room)?.name || '页外';
        const act = (activity || '').trim() || '在页外里挂机放空';
        const line = `${userName} 现在在「页外 · ${roomName}」：${act}`;
        const enabled = characters.filter(c => c.vrState?.enabled);
        for (const c of enabled) {
            await DB.saveMessage({
                charId: c.id, role: 'user', type: 'vr_card',
                content: `「页外 · ${roomName}」${line}`,
                metadata: { vrCard: true, room, userBoardPost: true, activity: line },
            } as any);
        }
        addToast?.(enabled.length > 0 ? `已更新状态，并广播给 ${enabled.length} 位接入角色` : '已更新页外状态', 'success');
    }, [characters, userName, addToast]);

    const onDeleteFeed = useCallback(async (msgId: number) => {
        await DB.deleteMessage(msgId);
        setFeed(prev => prev.filter(f => f.msgId !== msgId));
    }, []);
    const onDeleteFeedMany = useCallback(async (ids: number[]) => {
        if (ids.length === 0) return;
        await DB.deleteMessages(ids);
        const idSet = new Set(ids);
        setFeed(prev => prev.filter(f => !idSet.has(f.msgId)));
        addToast?.(`已删除 ${ids.length} 条页外动态`, 'success');
    }, [addToast]);

    // 启用某角色（带 chibi 设定门槛）
    const enableChar = (char: CharacterProfile) => {
        const interval = char.vrState?.intervalMinutes || VR_DEFAULT_INTERVAL_MIN;
        updateCharacter(char.id, { vrState: { ...(char.vrState || {}), enabled: true, intervalMinutes: interval } });
        VRScheduler.start(char.id, interval);
    };
    const requestEnable = (char: CharacterProfile) => {
        // 没设过专属 chibi → 先要求设定形象
        if (!char.vrState?.chibi?.img) {
            setPendingEnable(char.id);
            setChibiEditChar(char);
        } else {
            enableChar(char);
        }
    };

    return (
        <div className="h-full w-full flex flex-col relative overflow-hidden"
            style={{ color: PAPER.ink, background: PAPER.page }}>
            <VRStyleTag />
            {/* 纸张质感：网格 + 颗粒 + 暖角 */}
            <div className="pointer-events-none absolute inset-0" style={{
                backgroundImage: `linear-gradient(${PAPER.line}55 1px, transparent 1px), linear-gradient(90deg, ${PAPER.line}33 1px, transparent 1px)`,
                backgroundSize: '22px 22px', opacity: 0.5,
            }} />
            <div className="pointer-events-none absolute inset-0" style={{
                backgroundImage: 'radial-gradient(circle at 20% 18%, rgba(255,255,255,.5), transparent 40%), radial-gradient(circle at 86% 78%, rgba(150,120,70,.10), transparent 45%)',
            }} />
            {/* 飘动的小纸片/碎屑 */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <span className="absolute text-[18px]" style={{ top: '14%', left: '8%', animation: 'ywdrift 9s ease-in-out infinite', opacity: .5 }}>✦</span>
                <span className="absolute text-[14px]" style={{ top: '64%', right: '10%', animation: 'ywdrift 12s ease-in-out infinite reverse', opacity: .45 }}>✿</span>
                <span className="absolute text-[12px]" style={{ top: '40%', right: '20%', animation: 'ywdrift 11s ease-in-out infinite', opacity: .4 }}>★</span>
            </div>

            {/* 顶栏 —— 用 --chrome-top 让开安全区 + Moro 状态栏 */}
            <div className="relative flex items-center gap-2.5 px-4 pb-2 shrink-0 z-10" style={{ paddingTop: VR_TOP }}>
                <button onClick={closeApp} className="h-8 w-8 -ml-1 flex items-center justify-center rounded-lg active:translate-y-px"
                    style={{ background: PAPER.paper, border: `1px solid ${PAPER.edge}`, color: PAPER.ink, boxShadow: '0 2px 0 rgba(0,0,0,.12)' }}><ArrowLeft size={18} weight="bold" /></button>
                <div className="relative flex items-center gap-1.5 px-2 py-0.5" style={{ transform: 'rotate(-2deg)' }}>
                    <Tape color={TAPE_COLORS[0]} w={38} style={{ top: -7, left: 10, transform: 'rotate(-8deg)' }} />
                    <Scissors size={18} weight="bold" style={{ color: PAPER.red }} />
                    <span className="text-[25px] leading-none" style={{ fontFamily: HAND, fontWeight: 700, color: PAPER.ink, letterSpacing: '0.06em' }}>页外</span>
                </div>
                <span className="ml-auto text-[10.5px]" style={{ fontFamily: HAND, color: PAPER.inkSoft }}>
                    {enabledCount > 0 ? `${enabledCount} 个小人在场` : '还没人捏小人'}
                </span>
            </div>

            {/* Tab — washi 胶带索引页签 */}
            <div className="relative flex px-4 gap-2 shrink-0 z-10" style={{ marginBottom: -1 }}>
                {([['world', '世界', '🌎'], ['library', '书库', '📚'], ['settings', '接入', '🔌'], ['api', 'API', '⚙️']] as [Tab, string, string][]).map(([t, label, emo], i) => {
                    const on = tab === t;
                    return (
                        <button key={t} onClick={() => setTab(t)}
                            className="relative px-3 pt-1.5 pb-2 text-[13px] active:translate-y-px"
                            style={{
                                fontFamily: HAND, fontWeight: on ? 700 : 500,
                                color: on ? PAPER.ink : PAPER.inkFaint,
                                background: on ? PAPER.paper : 'transparent',
                                border: on ? `1px solid ${PAPER.edge}` : '1px solid transparent',
                                borderBottom: on ? `1px solid ${PAPER.paper}` : '1px solid transparent',
                                borderTopLeftRadius: 9, borderTopRightRadius: 9,
                                transform: `rotate(${on ? 0 : tiltOf(t, 2)}deg)`,
                            }}>
                            {on && <Tape color={TAPE_COLORS[(i + 1) % TAPE_COLORS.length]} w={30} style={{ top: -8, left: '50%', marginLeft: -15, transform: 'rotate(-4deg)' }} />}
                            <span className="mr-0.5">{emo}</span>{label}
                        </button>
                    );
                })}
                <div className="absolute bottom-0 left-2 right-2 h-px" style={{ background: PAPER.edge }} />
            </div>

            {/* 滚动容器不同于浮动 dock：滚到底时最后一条内容贴 viewport bottom = 屏幕底，必须 + safe-bottom 让位 home 条，否则翻页按钮被压（即原 #158 报的问题）。 */}
            <div className="relative flex-1 overflow-y-auto vr-reader-scroll px-4 z-10" style={{ paddingTop: '1rem', paddingBottom: `calc(1rem + ${VR_SAFE_BOTTOM})` }}>
                {loading ? (
                    <div className="text-center text-[13px] py-12" style={{ fontFamily: HAND, color: PAPER.inkSoft }}>正在翻开页外…</div>
                ) : tab === 'world' ? (
                    <WorldView occupantsByRoom={occupantsByRoom} feed={feed} novelCount={novels.length} poBadge={poBadge}
                        onEnterRoom={setEnterRoom} onGoLibrary={() => setTab('library')} onJump={jumpToAnnotation}
                        onDeleteFeed={onDeleteFeed} onDeleteFeedMany={onDeleteFeedMany} />
                ) : tab === 'library' ? (
                    <LibraryView novels={novels} characters={characters} onOpen={setReaderNovel}
                        onAdd={() => setShowUpload(true)}
                        onDelete={async (id) => { await DB.deleteVRNovel(id); await loadNovels(); addToast?.('已删除', 'success'); }} />
                ) : tab === 'settings' ? (
                    <div className="space-y-3">
                        <UserVRPanel userProfile={userProfile} updateUserProfile={updateUserProfile}
                            onEditChibi={() => setChibiEditUser(true)} onBroadcast={onUserVRBroadcast} addToast={addToast} />
                        <SettingsView characters={characters} updateCharacter={updateCharacter} addToast={addToast}
                            novelCount={novels.length} onReload={reloadAll}
                            onRequestEnable={requestEnable} onEditChibi={setChibiEditChar} />
                    </div>
                ) : (
                    <VRApiSettings apiPresets={apiPresets} chatApi={apiConfig} addToast={addToast} />
                )}
            </div>

            {/* 进入房间场景 */}
            {enterRoom && (
                <RoomScene roomId={enterRoom} occupants={occupantsByRoom[enterRoom] || []}
                    latestByChar={latestByChar} onClose={() => setEnterRoom(null)} onJump={jumpToAnnotation}
                    characters={characters} userName={userName} onUserBoardPost={onUserBoardPost} addToast={addToast}
                    userProfile={userProfile} updateCharacter={updateCharacter} updateUserProfile={updateUserProfile}
                    onDressUp={(c) => setChibiEditChar(c)} onDressUpUser={() => setChibiEditUser(true)} />
            )}
            {readerNovel && <ReaderModal novel={readerNovel} characters={characters} onClose={() => setReaderNovel(null)} />}
            {readerJump && <ReaderModal novel={readerJump.novel} characters={characters} initialSeg={readerJump.seg} peek onClose={() => setReaderJump(null)} />}
            {showUpload && (
                <UploadModal onClose={() => setShowUpload(false)}
                    onCommit={async (novel) => {
                        await DB.saveVRNovel(novel); await loadNovels(); setShowUpload(false);
                        addToast?.(`《${novel.title}》已上架（${novel.segments.length} 段）`, 'success');
                    }}
                    onError={(msg) => addToast?.(msg, 'error')} />
            )}
            {chibiEditChar && (
                <ChibiEditor char={chibiEditChar}
                    onClose={() => { setChibiEditChar(null); setPendingEnable(null); }}
                    onSave={(chibi, looks) => {
                        updateCharacter(chibiEditChar.id, { vrState: { ...(chibiEditChar.vrState || { enabled: false, intervalMinutes: VR_DEFAULT_INTERVAL_MIN }), chibi, chibiLooks: looks } });
                        const wasPending = pendingEnable === chibiEditChar.id;
                        const charSnap = chibiEditChar;
                        setChibiEditChar(null);
                        if (wasPending) {
                            setPendingEnable(null);
                            // 用最新 interval 启用
                            const interval = charSnap.vrState?.intervalMinutes || VR_DEFAULT_INTERVAL_MIN;
                            updateCharacter(charSnap.id, { vrState: { ...(charSnap.vrState || {}), chibi, chibiLooks: looks, enabled: true, intervalMinutes: interval } });
                            VRScheduler.start(charSnap.id, interval);
                            addToast?.(`${charSnap.name} 已接入页外`, 'success');
                        } else {
                            addToast?.('形象已更新', 'success');
                        }
                    }} />
            )}
            {chibiEditUser && (
                <UserChibiEditor userName={userName} existing={userProfile?.vrState?.chibi} existingLooks={userProfile?.vrState?.chibiLooks}
                    onClose={() => setChibiEditUser(false)}
                    onSave={(chibi, looks) => {
                        const uv = userProfile?.vrState;
                        updateUserProfile({ vrState: { ...(uv || {}), enabled: !!uv?.enabled, chibi, chibiLooks: looks, updatedAt: Date.now() } });
                        setChibiEditUser(false);
                        addToast?.('形象已更新', 'success');
                    }} />
            )}
        </div>
    );
};

// ============ 通用：拼贴纸感房间背景（纯 CSS，按房间取色）============
const RoomBackground: React.FC<{ roomId: VRRoomId; className?: string }> = ({ roomId, className }) => {
    // 一套统一的"贴在手账里的小场景"语言：牛皮纸底 + 房间色卡纸洗 + 网格 +
    // 一枚淡淡的大 emoji 贴纸 + 几条胶带，地面压一道纸边给小人让位。
    const th = roomTheme(roomId);
    return (
        <div className={`absolute inset-0 overflow-hidden ${className || ''}`} style={{ background: PAPER.cream }}>
            {/* 房间色卡纸洗 */}
            <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, ${th.paper} 0%, ${PAPER.cream} 60%, ${PAPER.page} 100%)` }} />
            {/* 网格纸纹 */}
            <div className="absolute inset-0" style={{
                backgroundImage: `linear-gradient(${PAPER.line}66 1px, transparent 1px), linear-gradient(90deg, ${PAPER.line}44 1px, transparent 1px)`,
                backgroundSize: '20px 20px', opacity: 0.5,
            }} />
            {/* 一枚大贴纸（房间符号），淡淡盖在中上方 */}
            <div className="absolute left-1/2 top-[20%] -translate-x-1/2 select-none" style={{ fontSize: 120, opacity: 0.16, filter: 'saturate(.7)' }}>{th.sticker}</div>
            {/* 角落几条胶带 */}
            <Tape color={th.tape} w={64} style={{ top: '8%', left: '-10px', transform: 'rotate(-24deg)' }} />
            <Tape color={TAPE_COLORS[2]} w={54} style={{ top: '6%', right: '-8px', transform: 'rotate(22deg)' }} />
            {/* 地面纸边：给小人投影一个落脚处 */}
            <div className="absolute left-0 right-0 bottom-0 h-[26%]" style={{ background: `linear-gradient(180deg, transparent, ${PAPER.edge}55 40%, ${PAPER.edge}88 100%)` }} />
            <div className="absolute left-0 right-0 bottom-0 h-[3px]" style={{ background: PAPER.edge }} />
            {/* 暗角（极淡，纸张边缘自然压暗） */}
            <div className="absolute inset-0" style={{ background: 'radial-gradient(120% 92% at 50% 40%, transparent 55%, rgba(120,96,50,0.14) 100%)' }} />
        </div>
    );
};

// ============ chibi 小人渲染（便签气泡 + 头顶贴纸 + 姿势动画 + 手账名牌）============
const Chibi: React.FC<{ char: CharacterProfile; bubble?: string; onTap?: () => void; size?: number; dance?: boolean }> = ({ char, bubble, onTap, size = 96, dance }) => {
    const c = getChibi(char);
    const sticker = char.vrState?.chibi?.sticker;
    const pose = char.vrState?.chibi?.pose;
    const anim = dance ? 'vrdance 0.9s ease-in-out infinite' : poseAnim(pose);
    return (
        <div className="absolute flex flex-col items-center" style={{ transform: 'translate(-50%, -100%)' }} onClick={onTap}>
            {bubble && (
                <div className="relative mb-1 max-w-[124px] px-2.5 py-1 text-[10.5px] leading-snug text-center"
                    style={{ fontFamily: HAND, color: PAPER.ink, background: '#fffaf0', border: `1px solid ${PAPER.edge}`, borderRadius: 9, boxShadow: '0 3px 8px rgba(80,60,30,.28)', transform: `rotate(${tiltOf(char.id, 2.2)}deg)` }}>
                    {bubble.length > 22 ? bubble.slice(0, 22) + '…' : bubble}
                    <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 rotate-45" style={{ background: '#fffaf0', borderRight: `1px solid ${PAPER.edge}`, borderBottom: `1px solid ${PAPER.edge}` }} />
                </div>
            )}
            <div className="relative" style={{ animation: anim, animationDelay: `${(char.id.charCodeAt(0) % 10) * 0.15}s` }}>
                {sticker && <span className="absolute -top-3 -right-1 text-[15px] z-10" style={{ animation: 'ywbob 2s ease-in-out infinite' }}>{sticker}</span>}
                {c.img ? (
                    <img src={c.img} alt={char.name}
                        style={{ height: size * c.scale, transform: `scaleX(${c.flip ? -1 : 1}) translateY(${c.offsetY}px)`, filter: 'drop-shadow(0 4px 5px rgba(90,70,40,.4))' }}
                        className="object-contain" />
                ) : (
                    <div className="rounded-full flex items-center justify-center font-bold"
                        style={{ width: size * 0.55, height: size * 0.55, background: noteColor(char.id), color: PAPER.ink, border: `1.5px solid ${PAPER.edge}`, fontFamily: HAND, fontSize: size * 0.24 }}>
                        {char.name.slice(0, 1)}
                    </div>
                )}
            </div>
            {/* 地面投影 */}
            <div className="rounded-[50%] -mt-1" style={{ width: size * 0.5, height: size * 0.12, background: 'radial-gradient(ellipse,rgba(90,70,40,.4),transparent)' }} />
            {/* 手账名牌 */}
            <div className="text-[9px] font-bold mt-0.5 px-1.5 py-px whitespace-nowrap" style={{ fontFamily: HAND, color: PAPER.ink, background: '#fff3c4', border: `1px solid ${PAPER.edge}`, borderRadius: 4 }}>{char.name}</div>
        </div>
    );
};

// ============ 通用：长按 hook + 确认弹窗（统一替代原生 confirm/alert） ============
const useLongPress = (onLong: () => void, ms = 500) => {
    const timer = useRef<number | null>(null);
    const [pressing, setPressing] = useState(false);
    const cancel = useCallback(() => { setPressing(false); if (timer.current) { clearTimeout(timer.current); timer.current = null; } }, []);
    const start = useCallback(() => { setPressing(true); timer.current = window.setTimeout(() => { setPressing(false); timer.current = null; onLong(); }, ms); }, [onLong, ms]);
    return { pressing, handlers: { onPointerDown: start, onPointerUp: cancel, onPointerLeave: cancel, onPointerCancel: cancel } };
};

const ConfirmDialog: React.FC<{
    open: boolean; title: string; message?: string;
    confirmText?: string; cancelText?: string;
    onConfirm: () => void; onCancel: () => void;
}> = ({ open, title, message, confirmText = '删除', cancelText = '取消', onConfirm, onCancel }) => {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center px-8 bg-black/40 backdrop-blur-sm" onClick={onCancel}>
            <div className="relative w-full max-w-[300px] p-4 text-center" onClick={e => e.stopPropagation()}
                style={{ background: PAPER.paper, border: `1px solid ${PAPER.edge}`, borderRadius: 12, boxShadow: '0 14px 40px rgba(60,44,20,.4)', transform: 'rotate(-1.2deg)' }}>
                <Tape color={TAPE_COLORS[2]} w={56} style={{ top: -9, left: '50%', marginLeft: -28, transform: 'rotate(-3deg)' }} />
                <div className="text-[15px]" style={{ fontFamily: HAND, fontWeight: 700, color: PAPER.ink }}>{title}</div>
                {message && <p className="text-[11.5px] mt-1.5 leading-relaxed whitespace-pre-wrap" style={{ color: PAPER.inkSoft }}>{message}</p>}
                <div className="flex gap-2 mt-4">
                    <InkBtn tone="soft" onClick={onCancel} className="flex-1 py-2 text-[12.5px]">{cancelText}</InkBtn>
                    <InkBtn tone="red" onClick={onConfirm} className="flex-1 py-2 text-[12.5px] font-semibold">{confirmText}</InkBtn>
                </div>
            </div>
        </div>
    );
};

// 长按弹出的动作菜单（编辑 / 删除等）
const ActionSheet: React.FC<{
    open: boolean; title?: string;
    actions: { label: string; onClick: () => void; danger?: boolean }[];
    onClose: () => void;
}> = ({ open, title, actions, onClose }) => {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-[300] flex items-end justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
            <div className="w-full max-w-md p-3" style={{ paddingBottom: vrBottomPad('0.75rem') }} onClick={e => e.stopPropagation()}>
                <div className="overflow-hidden" style={{ background: PAPER.paper, border: `1px solid ${PAPER.edge}`, borderRadius: 12, boxShadow: '0 -4px 20px rgba(80,60,30,.25)' }}>
                    {title && <div className="px-4 py-2.5 text-[11px] text-center whitespace-pre-wrap leading-snug" style={{ fontFamily: HAND, color: PAPER.inkSoft, borderBottom: `1.5px dashed ${PAPER.line}` }}>{title}</div>}
                    {actions.map((a, i) => (
                        <button key={i} onClick={() => { a.onClick(); }} className="w-full py-3 text-[13.5px] active:bg-black/5" style={{ fontFamily: HAND, color: a.danger ? PAPER.red : PAPER.ink, fontWeight: a.danger ? 700 : 500, borderTop: i > 0 ? `1.5px dashed ${PAPER.line}` : undefined }}>{a.label}</button>
                    ))}
                </div>
                <InkBtn tone="soft" onClick={onClose} className="w-full mt-2 py-3 text-[13.5px] font-medium" style={{ borderRadius: 12 }}>取消</InkBtn>
            </div>
        </div>
    );
};

// 分页列表（每页 perPage 条，超出翻页）
function PagedList<T>({ items, perPage, render }: { items: T[]; perPage: number; render: (it: T, idx: number) => React.ReactNode }) {
    const [p, setP] = useState(0);
    const total = Math.max(1, Math.ceil(items.length / perPage));
    const cur = Math.min(p, total - 1);
    const slice = items.slice(cur * perPage, cur * perPage + perPage);
    return (
        <>
            {slice.map(render)}
            {total > 1 && (
                <div className="flex items-center justify-center gap-3 mb-1">
                    <button onClick={() => setP(Math.max(0, cur - 1))} disabled={cur === 0} className="h-6 w-6 rounded-md flex items-center justify-center disabled:opacity-25 active:translate-y-px" style={{ color: PAPER.ink, background: PAPER.paper, border: `1px solid ${PAPER.edge}` }}><CaretLeft size={11} weight="bold" /></button>
                    <span className="text-[10px] tabular-nums" style={{ color: PAPER.inkSoft }}>{cur + 1}/{total}</span>
                    <button onClick={() => setP(Math.min(total - 1, cur + 1))} disabled={cur >= total - 1} className="h-6 w-6 rounded-md flex items-center justify-center disabled:opacity-25 active:translate-y-px" style={{ color: PAPER.ink, background: PAPER.paper, border: `1px solid ${PAPER.edge}` }}><CaretRight size={11} weight="bold" /></button>
                </div>
            )}
        </>
    );
}

// 待寄出信件行（长按弹出 编辑/删除）
const PendingLetterRow: React.FC<{ l: VRLetter; onMenu: (l: VRLetter) => void }> = ({ l, onMenu }) => {
    const { pressing, handlers } = useLongPress(() => onMenu(l), 500);
    const len = charLen(l.content);
    const over = len > MAX_LETTER_CHARS;
    return (
        <div {...handlers} className={`rounded-lg p-2 mb-1.5 text-[11.5px] transition-transform ${pressing ? 'scale-[0.98]' : ''}`}
            style={{ color: PAPER.ink, background: pressing ? '#ffe9cc' : '#fffdf6', border: `1px solid ${over ? PAPER.red : PAPER.edge}` }}>
            <div className="flex items-center gap-1.5 mb-0.5">
                <span className="font-bold text-[10.5px]" style={{ fontFamily: HAND, color: ROOM_THEME.postoffice.ink }}>{l.pen}</span>
                <span className="ml-auto text-[9px]" style={{ color: over ? PAPER.red : PAPER.inkFaint, fontWeight: over ? 700 : 400 }}>{over ? `${len}/${MAX_LETTER_CHARS} 超长·需精简` : '长按编辑/删除'}</span>
            </div>
            <p className="leading-snug whitespace-pre-wrap">{l.content}</p>
        </div>
    );
};

// 信件编辑弹窗
const LetterEditModal: React.FC<{ letter: VRLetter; onSave: (pen: string, content: string) => void; onCancel: () => void; title?: string }> = ({ letter, onSave, onCancel, title = '编辑这封信' }) => {
    const [pen, setPen] = useState(letter.pen);
    const [content, setContent] = useState(letter.content);
    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center px-6 bg-black/55 backdrop-blur-sm" onClick={onCancel}>
            <div className="w-full max-w-[340px] rounded-2xl p-4" onClick={e => e.stopPropagation()} style={{ background: PAPER.paper, border: `1px solid ${PAPER.edge}`, boxShadow: '0 14px 40px rgba(60,44,20,.4)' }}>
                <div className="text-[14px] mb-2.5" style={{ fontFamily: HAND, fontWeight: 700, color: PAPER.ink }}>✉️ {title}</div>
                <label className="text-[10px]" style={{ color: PAPER.inkSoft }}>笔名</label>
                <input value={pen} onChange={e => setPen(e.target.value)} className="w-full mt-1 mb-2.5 rounded-lg px-3 py-2 text-[12.5px] outline-none" style={{ fontFamily: HAND, color: PAPER.ink, background: '#fffdf6', border: `1px solid ${PAPER.edge}` }} />
                <label className="text-[10px] flex items-center" style={{ color: PAPER.inkSoft }}>正文<span className="ml-auto" style={{ color: charLen(content) > MAX_LETTER_CHARS ? PAPER.red : PAPER.inkFaint, fontWeight: charLen(content) > MAX_LETTER_CHARS ? 700 : 400 }}>{charLen(content)}/{MAX_LETTER_CHARS}</span></label>
                <textarea value={content} onChange={e => setContent(e.target.value)} rows={5} placeholder="写给陌生人的话——碎碎念、日记、困惑、执念都行…" className="w-full mt-1 rounded-lg px-3 py-2 text-[12.5px] outline-none resize-none vr-reader-scroll" style={{ fontFamily: HAND, color: PAPER.ink, background: '#fffdf6', border: `1px solid ${charLen(content) > MAX_LETTER_CHARS ? PAPER.red : PAPER.edge}` }} />
                <div className="flex gap-2 mt-3.5">
                    <InkBtn tone="soft" onClick={onCancel} className="flex-1 py-2 text-[12.5px]">取消</InkBtn>
                    <InkBtn tone="ink" onClick={() => onSave(pen, content)} disabled={!content.trim() || charLen(content) > MAX_LETTER_CHARS} className="flex-1 py-2 text-[12.5px] font-semibold">保存</InkBtn>
                </div>
            </div>
        </div>
    );
};

// 身份导出 / 导入弹窗：owner_id 是本地随机 UUID，换设备/清数据会丢失「我寄出的信」的归属，
// 这里给用户一个「带走身份」的口子。
const IdentityModal: React.FC<{ onImport: (code: string) => void; onClose: () => void }> = ({ onImport, onClose }) => {
    const code = exportIdentity();
    const [input, setInput] = useState('');
    const [copied, setCopied] = useState(false);
    const copy = async () => {
        try { await navigator.clipboard?.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
    };
    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center px-6 bg-black/55 backdrop-blur-sm" onClick={onClose}>
            <div className="w-full max-w-[340px] rounded-2xl p-4" onClick={e => e.stopPropagation()} style={{ background: PAPER.paper, border: `1px solid ${PAPER.edge}`, boxShadow: '0 14px 40px rgba(60,44,20,.4)' }}>
                <div className="text-[14px] mb-1" style={{ fontFamily: HAND, fontWeight: 700, color: PAPER.ink }}>🪪 邮局身份</div>
                <p className="text-[10px] leading-snug mb-2.5" style={{ color: PAPER.inkSoft }}>这串「身份码」代表你在邮局的匿名身份。复制保存，换设备或清数据后导入，就能找回「我寄出的信」和它们的归属。</p>
                <label className="text-[10px]" style={{ color: PAPER.inkSoft }}>我的身份码</label>
                <div className="flex gap-1.5 mt-1 mb-3">
                    <div className="flex-1 rounded-lg px-2.5 py-2 text-[10.5px] break-all leading-snug" style={{ color: PAPER.ink, background: PAPER.cream, border: `1px solid ${PAPER.edge}` }}>{code}</div>
                    <InkBtn tone="ink" onClick={copy} className="shrink-0 self-stretch px-3 text-[11px] font-semibold">{copied ? '已复制' : '复制'}</InkBtn>
                </div>
                <label className="text-[10px]" style={{ color: PAPER.inkSoft }}>导入身份码（换回旧身份）</label>
                <input value={input} onChange={e => setInput(e.target.value)} placeholder="粘贴 moropo.… 身份码" className="w-full mt-1 rounded-lg px-3 py-2 text-[11.5px] outline-none" style={{ fontFamily: HAND, color: PAPER.ink, background: '#fffdf6', border: `1px solid ${PAPER.edge}` }} />
                <div className="flex gap-2 mt-3.5">
                    <InkBtn tone="soft" onClick={onClose} className="flex-1 py-2 text-[12.5px]">关闭</InkBtn>
                    <InkBtn tone="ink" onClick={() => onImport(input)} disabled={!input.trim()} className="flex-1 py-2 text-[12.5px] font-semibold">导入</InkBtn>
                </div>
            </div>
        </div>
    );
};

// 后台：用 ADMIN_TOKEN 看后端「所有人」的信、按需删（点踩多的排在前）。token 仅存本机。
const AdminModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const [token, setToken] = useState(getAdminToken());
    const [letters, setLetters] = useState<RemoteAdminLetter[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState('');
    const [confirmId, setConfirmId] = useState<string | null>(null);
    const load = async () => {
        if (!token.trim()) { setErr('请先填入管理员 token'); return; }
        setLoading(true); setErr('');
        try { setAdminToken(token); setLetters(await PostOffice.adminList(token.trim(), 200)); }
        catch (e: any) { setErr(e?.message === 'unauthorized' ? 'token 不对' : ('拉取失败：' + (e?.message || '检查网络'))); setLetters(null); }
        finally { setLoading(false); }
    };
    const del = async (id: string) => {
        try { await PostOffice.adminDelete(token.trim(), [id]); setLetters(ls => (ls || []).filter(l => l.id !== id)); setConfirmId(null); }
        catch (e: any) { setErr('删除失败：' + (e?.message || '检查网络')); }
    };
    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center px-6 bg-black/55 backdrop-blur-sm" onClick={onClose}>
            <div className="w-full max-w-[400px] max-h-[82vh] flex flex-col rounded-2xl p-4" onClick={e => e.stopPropagation()} style={{ background: PAPER.paper, border: `1px solid ${PAPER.edge}`, boxShadow: '0 14px 40px rgba(60,44,20,.4)' }}>
                <div className="text-[14px] mb-1 shrink-0" style={{ fontFamily: HAND, fontWeight: 700, color: PAPER.ink }}>🗄️ 邮局后台</div>
                <p className="text-[10px] leading-snug mb-2.5 shrink-0" style={{ color: PAPER.inkSoft }}>用 worker 的 <b style={{ color: PAPER.red }}>ADMIN_TOKEN</b> 查看后端全部信件（按踩数、时间倒序，最多 200 条），可逐条删除。token 只存在本机。</p>
                <div className="flex gap-1.5 mb-3 shrink-0">
                    <input value={token} onChange={e => setToken(e.target.value)} type="password" placeholder="ADMIN_TOKEN" className="flex-1 rounded-lg px-3 py-2 text-[11.5px] outline-none" style={{ fontFamily: HAND, color: PAPER.ink, background: '#fffdf6', border: `1px solid ${PAPER.edge}` }} />
                    <InkBtn tone="ink" onClick={load} disabled={loading} className="shrink-0 px-3.5 text-[11px] font-semibold">{loading ? '…' : (letters ? '刷新' : '拉取')}</InkBtn>
                </div>
                {err && <div className="text-[10.5px] mb-2 shrink-0" style={{ color: PAPER.red }}>{err}</div>}
                <div className="flex-1 overflow-y-auto vr-reader-scroll -mx-1 px-1 min-h-0">
                    {letters && letters.length === 0 && <p className="text-[10.5px]" style={{ color: PAPER.inkSoft }}>后端目前没有信件。</p>}
                    {(letters || []).map(l => (
                        <div key={l.id} className="rounded-lg p-2 mb-1.5 text-[11px]" style={{ background: PAPER.cream, border: `1px solid ${PAPER.edge}` }}>
                            <div className="flex items-center gap-1.5 mb-1">
                                <span className="text-[9.5px]" style={{ color: ROOM_THEME.postoffice.ink }}>{l.pen || '匿名'}</span>
                                {l.dislikes > 0 && <span className="text-[8.5px] rounded-full px-1.5 leading-tight" style={{ color: PAPER.red, border: `1px solid ${PAPER.red}66` }}>踩 {l.dislikes}</span>}
                                <span className="ml-auto text-[8.5px]" style={{ color: PAPER.inkFaint }}>{new Date(l.created_at).toLocaleDateString()}</span>
                            </div>
                            <div className="leading-snug whitespace-pre-wrap mb-1" style={{ color: PAPER.ink }}>{l.content}</div>
                            <div className="flex items-center gap-2 text-[8.5px]" style={{ color: PAPER.inkFaint }}>
                                <span>赞{l.likes}</span><span>踩{l.dislikes}</span><span>读{l.views}</span><span>回{l.reply_count}</span>
                                {confirmId === l.id
                                    ? <button onClick={() => del(l.id)} className="ml-auto font-bold" style={{ color: PAPER.red }}>确定删除</button>
                                    : <button onClick={() => setConfirmId(l.id)} className="ml-auto" style={{ color: PAPER.inkSoft }}>删除</button>}
                            </div>
                        </div>
                    ))}
                    {!letters && !loading && <p className="text-[10.5px]" style={{ color: PAPER.inkFaint }}>填入 token 后点「拉取」。</p>}
                </div>
                <InkBtn tone="soft" onClick={onClose} className="mt-3 py-2 text-[12.5px] shrink-0">关闭</InkBtn>
            </div>
        </div>
    );
};

// 来信行（长按弹出：指定角色回 / 亲自回 / 删除）
const InboxLetterRow: React.FC<{ l: VRLetter; onMenu: (l: VRLetter) => void; onLike: (l: VRLetter) => void; onDislike: (l: VRLetter) => void }> = ({ l, onMenu, onLike, onDislike }) => {
    const { pressing, handlers } = useLongPress(() => onMenu(l), 500);
    const stop = (e: React.SyntheticEvent) => e.stopPropagation();
    return (
        <div {...handlers} className={`rounded-lg p-2 mb-1.5 text-[11px] leading-snug transition-transform ${pressing ? 'scale-[0.98]' : ''}`}
            style={{ color: PAPER.ink, background: pressing ? '#e2eef9' : '#fffdf6', border: `1px solid ${PAPER.edge}` }}>
            <div className="flex items-center gap-1.5 mb-0.5"><span className="font-bold text-[10.5px]" style={{ fontFamily: HAND, color: ROOM_THEME.guestbook.ink }}>{l.pen}</span></div>
            <ExpandText text={l.content} limit={90} />
            <div className="flex items-center gap-3 mt-1.5 text-[10px]">
                <span style={{ color: PAPER.inkFaint }}>阅 {l.views ?? 0}</span>
                <button onPointerDown={stop} onClick={e => { stop(e); onLike(l); }} style={{ color: l.myVote === 1 ? PAPER.red : PAPER.inkSoft, fontWeight: l.myVote === 1 ? 700 : 400 }}>赞 {l.likes ?? 0}</button>
                <button onPointerDown={stop} onClick={e => { stop(e); onDislike(l); }} style={{ color: l.myVote === -1 ? PAPER.red : PAPER.inkSoft, fontWeight: l.myVote === -1 ? 700 : 400 }} title="踩即举报">踩 {l.dislikes ?? 0}</button>
                <span className="ml-auto text-[9px]" style={{ color: PAPER.inkFaint }}>长按回信</span>
            </div>
        </div>
    );
};

// 亲自回信 / 编辑回信（不调用 LLM）
const ReplyComposeModal: React.FC<{ letter: VRLetter; defaultPen: string; initialContent?: string; title?: string; cta?: string; onSave: (pen: string, content: string) => void; onCancel: () => void }> = ({ letter, defaultPen, initialContent = '', title = '亲自回这封信', cta = '写好，排入待发送', onSave, onCancel }) => {
    const [pen, setPen] = useState(defaultPen);
    const [content, setContent] = useState(initialContent);
    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center px-6 bg-black/55 backdrop-blur-sm" onClick={onCancel}>
            <div className="w-full max-w-[340px] rounded-2xl p-4" onClick={e => e.stopPropagation()} style={{ background: PAPER.paper, border: `1px solid ${PAPER.edge}`, boxShadow: '0 14px 40px rgba(60,44,20,.4)' }}>
                <div className="text-[14px] mb-2" style={{ fontFamily: HAND, fontWeight: 700, color: PAPER.ink }}>✍️ {title}</div>
                <div className="rounded-lg px-3 py-2 mb-3 text-[10.5px] leading-snug max-h-24 overflow-y-auto vr-reader-scroll" style={{ color: PAPER.inkSoft, background: PAPER.cream, border: `1px solid ${PAPER.edge}` }}>
                    原信（{letter.pen}）：{letter.content}
                </div>
                <label className="text-[10px]" style={{ color: PAPER.inkSoft }}>你的笔名（寄出时匿名）</label>
                <input value={pen} onChange={e => setPen(e.target.value)} className="w-full mt-1 mb-2.5 rounded-lg px-3 py-2 text-[12.5px] outline-none" style={{ fontFamily: HAND, color: PAPER.ink, background: '#fffdf6', border: `1px solid ${PAPER.edge}` }} />
                <label className="text-[10px]" style={{ color: PAPER.inkSoft }}>回信正文</label>
                <textarea value={content} onChange={e => setContent(e.target.value)} rows={5} autoFocus placeholder="写下你想对这位陌生人说的话…"
                    className="w-full mt-1 rounded-lg px-3 py-2 text-[12.5px] outline-none resize-none vr-reader-scroll" style={{ fontFamily: HAND, color: PAPER.ink, background: '#fffdf6', border: `1px solid ${PAPER.edge}` }} />
                <div className="flex gap-2 mt-3.5">
                    <InkBtn tone="soft" onClick={onCancel} className="flex-1 py-2 text-[12.5px]">取消</InkBtn>
                    <InkBtn tone="ink" onClick={() => onSave(pen, content)} disabled={!content.trim()} className="flex-1 py-2 text-[12.5px] font-semibold">{cta}</InkBtn>
                </div>
            </div>
        </div>
    );
};

// ============ 世界视图 ============
const WorldView: React.FC<{
    occupantsByRoom: Record<string, CharacterProfile[]>;
    feed: FeedItem[]; novelCount: number;
    poBadge: { toSend: number; toCollect: number };
    onEnterRoom: (r: VRRoomId) => void; onGoLibrary: () => void;
    onJump: (novelId: string | undefined, segIdx: number) => void;
    onDeleteFeed: (msgId: number) => void; onDeleteFeedMany: (ids: number[]) => void;
}> = ({ occupantsByRoom, feed, novelCount, poBadge, onEnterRoom, onGoLibrary, onJump, onDeleteFeed, onDeleteFeedMany }) => {
    const FEED_PER_PAGE = 5;
    const [page, setPage] = useState(0);
    const totalPages = Math.max(1, Math.ceil(feed.length / FEED_PER_PAGE));
    const curPage = Math.min(page, totalPages - 1);
    const shown = feed.slice(curPage * FEED_PER_PAGE, curPage * FEED_PER_PAGE + FEED_PER_PAGE);
    const [confirmDel, setConfirmDel] = useState<FeedItem | null>(null);
    // 管理模式：多选删除（替代原「清空」）。选择跨页保留。
    const [manageMode, setManageMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [confirmBatch, setConfirmBatch] = useState(false);
    const exitManage = () => { setManageMode(false); setSelectedIds(new Set()); };
    const toggleSelect = (msgId: number) => setSelectedIds(prev => {
        const n = new Set(prev); n.has(msgId) ? n.delete(msgId) : n.add(msgId); return n;
    });
    const shownIds = shown.map(f => f.msgId);
    const allShownSelected = shownIds.length > 0 && shownIds.every(id => selectedIds.has(id));
    const toggleSelectPage = () => setSelectedIds(prev => {
        const n = new Set(prev);
        if (allShownSelected) shownIds.forEach(id => n.delete(id));
        else shownIds.forEach(id => n.add(id));
        return n;
    });
    // 房间分页：每页 6 间
    const ROOMS_PER_PAGE = 6;
    const [roomPage, setRoomPage] = useState(0);
    const roomTotalPages = Math.max(1, Math.ceil(VR_ROOMS.length / ROOMS_PER_PAGE));
    const curRoomPage = Math.min(roomPage, roomTotalPages - 1);
    const shownRooms = VR_ROOMS.slice(curRoomPage * ROOMS_PER_PAGE, curRoomPage * ROOMS_PER_PAGE + ROOMS_PER_PAGE);
    return (
    <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3.5 pt-1">
            {shownRooms.map((room, ri) => {
                const occupants = occupantsByRoom[room.id] || [];
                const th = roomTheme(room.id);
                return (
                    <button key={room.id} onClick={() => room.implemented && onEnterRoom(room.id)}
                        className={`relative h-40 text-left active:translate-y-px transition-transform ${room.implemented ? '' : 'opacity-80'}`}
                        style={{ background: PAPER.paper, border: `1px solid ${PAPER.edge}`, borderRadius: 10, boxShadow: '0 4px 0 rgba(120,100,60,.12), 0 9px 16px rgba(80,64,30,.18)', transform: `rotate(${tiltOf(room.id, 2)}deg)` }}>
                        {/* 拍立得照片窗 */}
                        <div className="absolute left-1.5 right-1.5 top-1.5 bottom-7 overflow-hidden rounded-[7px]" style={{ border: `1px solid ${PAPER.edge}` }}>
                            <RoomBackground roomId={room.id} />
                        </div>
                        {/* washi 胶带压住照片顶 */}
                        <Tape color={th.tape} w={48} style={{ top: -6, left: '50%', marginLeft: -24, transform: `rotate(${ri % 2 ? 5 : -5}deg)`, zIndex: 5 }} />
                        {/* 房间名手账标签 */}
                        <span className="absolute top-2 left-2 z-[6]" style={{ transform: 'rotate(-3deg)' }}>
                            <InkTag color={th.paper}><span style={{ color: th.ink }}>{th.sticker} {room.name}</span></InkTag>
                        </span>
                        {!room.implemented && <span className="absolute top-2 right-2 z-[6]"><InkTag color="#eee" style={{ fontSize: 8 }}>筹备中</InkTag></span>}
                        {room.id === 'postoffice' && (poBadge.toCollect > 0 || poBadge.toSend > 0) && (
                            <div className="absolute top-7 right-1.5 z-[6] flex flex-col items-end gap-1">
                                {poBadge.toCollect > 0 && <span className="text-[8.5px] font-bold px-1.5 py-0.5 leading-none rounded-sm" style={{ fontFamily: HAND, background: PAPER.red, color: '#fff', transform: 'rotate(5deg)' }}>{poBadge.toCollect} 封回信</span>}
                                {poBadge.toSend > 0 && <span className="text-[8.5px] font-bold px-1.5 py-0.5 leading-none rounded-sm" style={{ fontFamily: HAND, background: '#fff3c4', color: PAPER.ink, border: `1px solid ${PAPER.edge}` }}>{poBadge.toSend} 待寄</span>}
                            </div>
                        )}
                        {!room.implemented && (
                            <div className="absolute inset-x-0 top-[42%] flex items-center justify-center z-[6]">
                                <span className="text-[11px]" style={{ fontFamily: HAND, color: '#fff', background: 'rgba(90,70,40,.55)', padding: '2px 8px', borderRadius: 6 }}>蒸笼预热中…</span>
                            </div>
                        )}
                        {/* 底边：在场小人缩影 + 进入 */}
                        <div className="absolute bottom-1 left-2 right-2 flex items-end justify-between z-[6]">
                            <div className="flex -space-x-1.5">
                                {occupants.slice(0, 4).map(c => {
                                    const ch = getChibi(c);
                                    return ch.img
                                        ? <img key={c.id} src={ch.img} className="h-8 w-8 object-contain object-bottom" alt="" style={{ transform: `scaleX(${ch.flip ? -1 : 1})`, filter: 'drop-shadow(0 2px 2px rgba(90,70,40,.4))' }} />
                                        : <div key={c.id} className="h-6 w-6 rounded-full flex items-center justify-center text-[9px]" style={{ background: noteColor(c.id), color: PAPER.ink, border: `1px solid ${PAPER.edge}` }}>{c.name.slice(0, 1)}</div>;
                                })}
                            </div>
                            {room.implemented && <span className="text-[10px] font-bold flex items-center gap-0.5" style={{ fontFamily: HAND, color: th.ink }}>翻进去 <CaretRight size={10} weight="bold" /></span>}
                        </div>
                    </button>
                );
            })}
        </div>
        {roomTotalPages > 1 && (
            <div className="flex items-center justify-center gap-3 -mt-1">
                <button onClick={() => setRoomPage(p => Math.max(0, p - 1))} disabled={curRoomPage === 0}
                    className="h-7 w-7 rounded-md flex items-center justify-center disabled:opacity-25 active:translate-y-px" style={{ color: PAPER.ink, background: PAPER.paper, border: `1px solid ${PAPER.edge}` }}><CaretLeft size={13} weight="bold" /></button>
                <span className="text-[10.5px] tabular-nums" style={{ color: PAPER.inkSoft, fontFamily: HAND }}>{curRoomPage + 1} / {roomTotalPages}</span>
                <button onClick={() => setRoomPage(p => Math.min(roomTotalPages - 1, p + 1))} disabled={curRoomPage >= roomTotalPages - 1}
                    className="h-7 w-7 rounded-md flex items-center justify-center disabled:opacity-25 active:translate-y-px" style={{ color: PAPER.ink, background: PAPER.paper, border: `1px solid ${PAPER.edge}` }}><CaretRight size={13} weight="bold" /></button>
            </div>
        )}

        {novelCount === 0 && (
            <button onClick={onGoLibrary} className="w-full py-3 text-[12px] active:translate-y-px"
                style={{ fontFamily: HAND, color: PAPER.inkSoft, border: `1.5px dashed ${PAPER.edge}`, borderRadius: 10, background: PAPER.cream }}>
                📚 书库还空着 · 贴一本小说进去，角色就能在图书馆翻到它 →
            </button>
        )}

        <div>
            <div className="flex items-center gap-2 mb-3 mt-1">
                {feed.length > 0 && <span className="w-7 shrink-0" aria-hidden="true" />}
                <Stitch className="flex-1" />
                <span className="text-[13px] px-2" style={{ fontFamily: HAND, fontWeight: 700, color: PAPER.ink, transform: 'rotate(-1.5deg)' }}>✂ 贴回来的动态</span>
                <Stitch className="flex-1" />
                {feed.length > 0 && (
                    <button onClick={() => manageMode ? exitManage() : setManageMode(true)}
                        aria-label={manageMode ? '退出整理' : '整理动态'}
                        className="shrink-0 h-7 w-7 rounded-md flex items-center justify-center active:translate-y-px"
                        style={{ border: `1px solid ${PAPER.edge}`, background: manageMode ? PAPER.red : PAPER.paper, color: manageMode ? '#fff' : PAPER.ink }}>
                        {manageMode ? <X size={13} weight="bold" /> : <Scissors size={14} weight="bold" />}
                    </button>
                )}
            </div>
            {feed.length === 0 ? (
                <p className="text-[11px] py-5 text-center leading-relaxed" style={{ fontFamily: HAND, color: PAPER.inkSoft }}>这一页还空着。<br />去「接入」点亮角色，ta 们到点会自己溜进来贴动态。</p>
            ) : (
                <>
                    {totalPages > 1 && (
                        <div className="flex items-center justify-center gap-2 mb-3">
                            <InkBtn tone="soft" onClick={() => setPage(p => Math.max(0, Math.min(p, totalPages - 1) - 1))} disabled={curPage === 0}
                                className="h-8 pl-2 pr-3 flex items-center gap-1 text-[11px]"><CaretLeft size={12} weight="bold" />上一页</InkBtn>
                            <span className="text-[11px] tabular-nums min-w-[46px] text-center" style={{ color: PAPER.inkSoft, fontFamily: HAND }}>{curPage + 1} / {totalPages}</span>
                            <InkBtn tone="soft" onClick={() => setPage(p => Math.min(totalPages - 1, Math.min(p, totalPages - 1) + 1))} disabled={curPage >= totalPages - 1}
                                className="h-8 pl-3 pr-2 flex items-center gap-1 text-[11px]">下一页<CaretRight size={12} weight="bold" /></InkBtn>
                        </div>
                    )}
                    {manageMode ? (
                        <div className="flex items-center gap-2 mb-2.5 px-0.5">
                            <InkBtn tone="soft" onClick={toggleSelectPage} className="text-[11px] px-3 py-1.5">{allShownSelected ? '取消本页' : '选择本页'}</InkBtn>
                            <span className="text-[10.5px] tabular-nums" style={{ color: PAPER.inkSoft, fontFamily: HAND }}>已选 {selectedIds.size} 张</span>
                            <InkBtn tone="red" onClick={() => { if (selectedIds.size > 0) setConfirmBatch(true); }} disabled={selectedIds.size === 0}
                                className="ml-auto text-[11px] font-semibold px-4 py-1.5">撕掉{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}</InkBtn>
                        </div>
                    ) : (
                        <p className="text-[9px] text-center mb-2" style={{ color: PAPER.inkFaint, fontFamily: HAND }}>长按可撕掉一张 · 点剪刀可多选整理</p>
                    )}
                    <div className="space-y-2.5">
                        {shown.map(item => <FeedCard key={item.msgId} item={item} onJump={onJump} onRequestDelete={setConfirmDel}
                            manageMode={manageMode} selected={selectedIds.has(item.msgId)} onToggleSelect={toggleSelect} />)}
                    </div>
                </>
            )}
        </div>
        <ConfirmDialog open={!!confirmDel} title="删除这条动态？" message={confirmDel ? `${confirmDel.charName} 在${getRoom(confirmDel.meta.room).name}的这条记录将被移除。` : ''}
            onConfirm={() => { if (confirmDel) onDeleteFeed(confirmDel.msgId); setConfirmDel(null); }} onCancel={() => setConfirmDel(null)} />
        <ConfirmDialog open={confirmBatch} title={`删除选中的 ${selectedIds.size} 条动态？`} message="动态即聊天里的同一条卡片消息，删除后聊天记录里对应的卡片也会一并移除。"
            onConfirm={() => { onDeleteFeedMany(Array.from(selectedIds)); setSelectedIds(new Set()); setConfirmBatch(false); }} onCancel={() => setConfirmBatch(false)} />
    </div>
    );
};

// 单条动态卡片：非管理态长按删除；管理态点击多选。已隐藏（对 AI 不可见）的暗显并标「已隐藏」。
const FeedCard: React.FC<{ item: FeedItem; onJump: (novelId: string | undefined, segIdx: number) => void; onRequestDelete: (item: FeedItem) => void; manageMode?: boolean; selected?: boolean; onToggleSelect?: (msgId: number) => void }> = ({ item, onJump, onRequestDelete, manageMode, selected, onToggleSelect }) => {
    const room = getRoom(item.meta.room);
    const { pressing, handlers } = useLongPress(() => onRequestDelete(item), 550);
    const cardHandlers = manageMode ? { onClick: () => onToggleSelect?.(item.msgId) } : handlers;
    const th = roomTheme(item.meta.room);
    return (
        <div {...cardHandlers}
            className={`relative p-3 pl-3.5 flex gap-3 transition-transform ${pressing ? 'scale-[0.98]' : ''} ${manageMode ? 'cursor-pointer' : ''} ${item.hidden && !selected ? 'opacity-60' : ''}`}
            style={{ background: selected ? '#fff0c0' : pressing ? '#ffe1d6' : PAPER.paper, border: `1px solid ${selected ? PAPER.red : PAPER.edge}`, borderRadius: 9, boxShadow: '0 2px 0 rgba(120,100,60,.1), 0 6px 12px rgba(80,64,30,.14)', transform: `rotate(${tiltOf(String(item.msgId), 1.1)}deg)` }}>
            {/* 左侧房间色书脊 */}
            <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full" style={{ background: th.ink, opacity: .5 }} />
            <Tape color={th.tape} w={26} style={{ top: -7, right: 14, transform: 'rotate(8deg)' }} />
            {manageMode && (
                <div className="self-center shrink-0 h-5 w-5 rounded-md flex items-center justify-center" style={{ border: `1.5px solid ${selected ? PAPER.red : PAPER.edge}`, background: selected ? PAPER.red : 'transparent' }}>
                    {selected && <Check size={12} weight="bold" className="text-white" />}
                </div>
            )}
            {item.avatar ? <img src={item.avatar} className="h-8 w-8 rounded-full object-cover shrink-0" style={{ border: `1px solid ${PAPER.edge}` }} alt="" /> : <div className="h-8 w-8 rounded-full shrink-0" style={{ background: noteColor(item.charId), border: `1px solid ${PAPER.edge}` }} />}
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[11px]">
                    <span className="font-bold" style={{ fontFamily: HAND, color: PAPER.ink }}>{item.charName}</span>
                    <span style={{ fontFamily: HAND, color: th.ink }}>{th.sticker}{room.name}</span>
                    {item.hidden && <span className="text-[8px] px-1.5 py-[1px] leading-none shrink-0 rounded-sm" style={{ color: PAPER.inkSoft, border: `1px solid ${PAPER.edge}`, background: PAPER.cream }}>已收起</span>}
                    <span className="ml-auto text-[9px] shrink-0" style={{ color: PAPER.inkFaint }}>{new Date(item.timestamp).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <p className="text-[11.5px] mt-0.5 leading-snug" style={{ color: PAPER.ink }}>{stripSelfName(item.meta.activity, item.charName)}</p>
                {item.meta.behavior && <p className="text-[10.5px] mt-1 leading-snug" style={{ color: PAPER.teal }}>{stripSelfName(item.meta.behavior, item.charName)}</p>}
                {item.meta.annotationRefs && item.meta.annotationRefs.length > 0 ? (
                    <div className="mt-1 space-y-0.5">
                        {item.meta.annotationRefs.slice(0, 3).map((ref, i) => (
                            <button key={i} onClick={() => { if (manageMode) { onToggleSelect?.(item.msgId); return; } onJump(item.meta.novelId, ref.segIdx); }}
                                className="block w-full text-left text-[10.5px] pl-2 leading-snug active:opacity-60" style={{ color: PAPER.inkSoft, borderLeft: `2px solid ${PAPER.red}88` }}>
                                {stripLeakedAttrs(ref.text)} <span style={{ color: PAPER.red }}>↗原文</span>
                            </button>
                        ))}
                    </div>
                ) : item.meta.annotationExcerpts && item.meta.annotationExcerpts.length > 0 ? (
                    <div className="mt-1 space-y-0.5">
                        {item.meta.annotationExcerpts.slice(0, 2).map((ex, i) => (
                            <div key={i} className="text-[10.5px] pl-2 leading-snug" style={{ color: PAPER.inkSoft, borderLeft: `2px solid ${PAPER.edge}` }}>{stripLeakedAttrs(ex)}</div>
                        ))}
                    </div>
                ) : null}
                {item.meta.room === 'postoffice' && item.meta.letterExcerpt && (
                    <div className="mt-1 text-[10.5px] pl-2 leading-snug" style={{ color: PAPER.inkSoft, borderLeft: `2px solid ${PAPER.red}88`, fontStyle: 'italic' }}>
                        「{item.meta.letterExcerpt.length > 70 ? item.meta.letterExcerpt.slice(0, 70) + '…' : item.meta.letterExcerpt}」
                    </div>
                )}
            </div>
        </div>
    );
};

// 可展开全文（点击切换截断/完整）
const ExpandText: React.FC<{ text: string; limit?: number }> = ({ text, limit = 90 }) => {
    const [open, setOpen] = useState(false);
    const long = text.length > limit;
    return (
        <span onClick={() => long && setOpen(o => !o)} className={long ? 'cursor-pointer' : ''}>
            <span className="whitespace-pre-wrap">{open || !long ? text : text.slice(0, limit) + '…'}</span>
            {long && <span className="ml-1 text-[10px]" style={{ color: PAPER.red }}>{open ? '收起' : '展开全文'}</span>}
        </span>
    );
};

// ============ 邮局信件管理面板 ============
const PostOfficePanel: React.FC<{ addToast?: (m: string, t?: any) => void; characters: CharacterProfile[]; userName: string }> = ({ addToast, characters, userName }) => {
    const [letters, setLetters] = useState<VRLetter[]>([]);
    const [busy, setBusy] = useState<string | null>(null);
    const [menuFor, setMenuFor] = useState<VRLetter | null>(null);
    const [editing, setEditing] = useState<VRLetter | null>(null);
    const [confirmDel, setConfirmDel] = useState<VRLetter | null>(null);
    const [inboxMenu, setInboxMenu] = useState<VRLetter | null>(null);   // 来信长按菜单
    const [assignFor, setAssignFor] = useState<VRLetter | null>(null);   // 指定角色回信的选人面板
    const [replyFor, setReplyFor] = useState<VRLetter | null>(null);     // 亲自回信编辑器
    const [replyMenu, setReplyMenu] = useState<VRLetter | null>(null);   // 待发送回信的长按菜单
    const [editReplyFor, setEditReplyFor] = useState<VRLetter | null>(null); // 编辑待发送回信
    const [confirmReport, setConfirmReport] = useState<VRLetter | null>(null); // 点踩=举报二次确认
    const [identityOpen, setIdentityOpen] = useState(false);            // 身份导出/导入弹窗
    const [adminOpen, setAdminOpen] = useState(false);                  // 后台（看后端全部信件）弹窗
    const [composeNew, setComposeNew] = useState<VRLetter | null>(null); // 用户自己写新信的草稿
    const [myStats, setMyStats] = useState<Record<string, RemoteLetterStat>>({}); // 我寄出的信热度（按 remoteId）
    const [tab, setTab] = useState<'outbox' | 'reply' | 'replied' | 'inbox' | 'drift' | 'box'>('outbox'); // 左侧分类
    const [sentMenu, setSentMenu] = useState<VRLetter | null>(null);     // 已寄出信的管理菜单
    const [confirmDelSent, setConfirmDelSent] = useState<VRLetter | null>(null); // 删除已寄出信的确认
    const enabledChars = characters.filter(c => c.vrState?.enabled);

    const load = useCallback(async () => setLetters(await DB.getVRLetters()), []);
    const loadStats = useCallback(async () => {
        try {
            const stats = await PostOffice.fetchMyStats();
            const map: Record<string, RemoteLetterStat> = {};
            stats.forEach(s => { map[s.id] = s; });
            setMyStats(map);
        } catch { /* 离线/失败不影响其它功能 */ }
    }, []);
    useEffect(() => {
        void load(); void loadStats();
        const h = () => { void load(); void loadStats(); };
        window.addEventListener('vr-session-done', h);
        return () => window.removeEventListener('vr-session-done', h);
    }, [load, loadStats]);

    const outQueued = letters.filter(l => l.box === 'outbox' && l.status === 'queued');
    const replyQueued = letters.filter(l => l.box === 'inbox' && l.replyStatus === 'queued' && l.reply);
    const repliedSent = letters.filter(l => l.box === 'inbox' && l.replyStatus === 'sent' && l.reply);
    const inboxWaiting = letters.filter(l => l.box === 'inbox' && (l.replyStatus ?? 'none') === 'none');
    const sentAwaiting = letters.filter(l => l.box === 'outbox' && l.status === 'sent');
    const archived = letters.filter(l => l.box === 'outbox' && (l.status === 'archived' || l.status === 'sealed'));

    const sendOutbox = async () => {
        if (outQueued.length === 0) return;
        // A：正文超长就拦下，让用户先编辑精简，不静默截断
        const tooLong = outQueued.filter(l => charLen(l.content) > MAX_LETTER_CHARS);
        if (tooLong.length) { addToast?.(`有 ${tooLong.length} 封超过 ${MAX_LETTER_CHARS} 字，请长按编辑精简后再寄`, 'error'); return; }
        // B：前端日额度（给后端减负），额度不够就只寄能寄的那几封，其余留队列
        const q = readQuota(PO_SEND_QUOTA);
        const remaining = Math.max(0, PO_SEND_QUOTA.limit - q.count);
        if (remaining <= 0) { addToast?.(`寄信暂时到上限（${PO_SEND_QUOTA.limit} 封/${PO_SEND_QUOTA.windowMs / 3600_000} 小时），约 ${quotaResetHours(q.windowStart, PO_SEND_QUOTA.windowMs)} 小时后恢复`, 'info'); return; }
        const batch = outQueued.slice(0, remaining);
        const heldBack = outQueued.length - batch.length;
        setBusy('send');
        try {
            const ids = await PostOffice.uploadLetters(batch.map(l => ({ pen: l.pen, content: l.content })));
            await DB.saveVRLetters(batch.map((l, i) => ({ ...l, status: 'sent', remoteId: ids[i], sentAt: Date.now() })));
            bumpQuota(PO_SEND_QUOTA, batch.length);
            await load();
            addToast?.(heldBack > 0
                ? `已寄出 ${ids.length} 封，额度用完，还剩 ${heldBack} 封约 ${quotaResetHours(readQuota(PO_SEND_QUOTA).windowStart, PO_SEND_QUOTA.windowMs)} 小时后再寄`
                : `已寄出 ${ids.length} 封漂流信`, 'success');
        } catch (e: any) {
            const msg = /429|rate limit/i.test(e?.message || '')
                ? '后端每 5 小时限 5 封，刚寄太猛被挡了，待会儿再寄剩下的（信都还在队列）'
                : '寄出失败：' + (e?.message || '检查网络');
            addToast?.(msg, 'error');
        } finally { setBusy(null); }
    };
    const refreshInbox = async () => {
        setBusy('inbox');
        try {
            const n = 2 + Math.floor(Math.random() * 4); // 每次随机捞 2~5 封，别一次太猛
            const remote = await PostOffice.fetchInbox(n);
            const fresh: VRLetter[] = remote.map(r => ({ id: genLocalId('lt'), box: 'inbox', pen: r.pen, content: r.content, createdAt: r.created_at, remoteLetterId: r.id, replyStatus: 'none', fetchedAt: Date.now(), likes: r.likes ?? 0, dislikes: r.dislikes ?? 0, views: r.views ?? 0, myVote: 0 }));
            await DB.saveVRLetters(fresh);
            await load(); addToast?.(remote.length ? `收到 ${remote.length} 封陌生来信` : '暂时没有新的来信', 'info');
        } catch (e: any) { addToast?.('刷新失败：' + (e?.message || '检查网络'), 'error'); } finally { setBusy(null); }
    };
    const sendReplies = async () => {
        if (replyQueued.length === 0) return;
        // 前端日额度：每天最多 PO_REPLY_QUOTA.limit 封回信，额度不足只发能发的，其余留队列
        const q = readQuota(PO_REPLY_QUOTA);
        const remaining = Math.max(0, PO_REPLY_QUOTA.limit - q.count);
        if (remaining <= 0) { addToast?.(`今天已回满 ${PO_REPLY_QUOTA.limit} 封，约 ${quotaResetHours(q.windowStart, PO_REPLY_QUOTA.windowMs)} 小时后恢复`, 'info'); return; }
        const batch = replyQueued.slice(0, remaining);
        const heldBack = replyQueued.length - batch.length;
        setBusy('reply');
        try {
            const payload = batch.map(l => ({
                letterId: l.remoteLetterId!, pen: l.reply!.pen,
                content: l.reply!.userNote ? `${l.reply!.content}\n\n——\n${l.reply!.userNote}` : l.reply!.content,
            }));
            await PostOffice.uploadReplies(payload);
            bumpQuota(PO_REPLY_QUOTA, batch.length);
            await DB.saveVRLetters(batch.map(l => ({ ...l, replyStatus: 'sent' as const })));
            await load();
            addToast?.(heldBack > 0
                ? `已发出 ${payload.length} 封回信，今日额度用完，还剩 ${heldBack} 封约 ${quotaResetHours(readQuota(PO_REPLY_QUOTA).windowStart, PO_REPLY_QUOTA.windowMs)} 小时后再发`
                : `已发出 ${payload.length} 封回信`, heldBack > 0 ? 'info' : 'success');
        } catch (e: any) { addToast?.('发送失败：' + (e?.message || '检查网络'), 'error'); } finally { setBusy(null); }
    };
    const collectReplies = async () => {
        setBusy('collect');
        void loadStats();   // 顺手刷新「我寄出的信」赞/踩/浏览/回信数
        try {
            const replies = await PostOffice.fetchReplies();
            if (replies.length === 0) { addToast?.('还没有人回你的信', 'info'); setBusy(null); return; }
            const byLetter = new Map<string, RemoteReply[]>();
            replies.forEach(r => { const a = byLetter.get(r.letter_id) || []; a.push(r); byLetter.set(r.letter_id, a); });
            // 一封漂流信可能被多个陌生人捡到、陆续回信。所以这里"刷新"而不是"一次性领取后释放"：
            // 把后端当前的全部回复同步到本地（含已留档但还没被角色读封存的），不释放；
            // 等原作者角色逛到邮局读完、写下感触、封存时才释放后端（见 runSession）。
            const pending = letters.filter(l => l.box === 'outbox' && l.remoteId && (l.status === 'sent' || l.status === 'archived'));
            const updates: VRLetter[] = [];
            let newlyArchived = 0, addedReplies = 0;
            for (const l of pending) {
                const rs = byLetter.get(l.remoteId!);
                if (!rs || rs.length === 0) continue;
                const before = l.repliesReceived?.length || 0;
                if (rs.length > before || l.status === 'sent') {
                    if (l.status === 'sent') newlyArchived++;
                    addedReplies += Math.max(0, rs.length - before);
                    updates.push({ ...l, status: 'archived', repliesReceived: rs.map(x => ({ pen: x.pen, content: x.content, createdAt: x.created_at })) });
                }
            }
            if (updates.length) await DB.saveVRLetters(updates);
            await load();
            addToast?.(updates.length
                ? `收到回复（${newlyArchived ? `${newlyArchived} 封新留档` : '已更新'}${addedReplies ? ` · 新增 ${addedReplies} 条` : ''}），等角色去邮局读`
                : '回复还没匹配到你的信', 'success');
        } catch (e: any) { addToast?.('收取失败：' + (e?.message || '检查网络'), 'error'); } finally { setBusy(null); }
    };

    const setUserNote = async (l: VRLetter, note: string) => {
        const next = { ...l, reply: { ...l.reply!, userNote: note } };
        setLetters(prev => prev.map(x => x.id === l.id ? next : x));
        await DB.saveVRLetter(next);
    };
    const del = async (id: string) => { await DB.deleteVRLetter(id); await load(); };
    const saveEdit = async (pen: string, content: string) => {
        if (!editing) return;
        const next = { ...editing, pen: pen.trim() || editing.pen, content: content.trim() };
        await DB.saveVRLetter(next); setEditing(null); await load();
    };
    // 指定某角色去邮局回这封来信（走 LLM）
    const assignReply = (charId: string) => {
        if (!assignFor) return;
        VRScheduler.triggerNow(charId, 'postoffice', assignFor.id);
        const cname = enabledChars.find(c => c.id === charId)?.name;
        addToast?.(`${cname ?? '角色'} 正在去邮局回这封信…`, 'info');
        setAssignFor(null);
        setTimeout(() => void load(), 5000);
    };
    // 用户亲自回信（不调用 LLM），排入"待发送的回信"
    const saveManualReply = async (pen: string, content: string) => {
        if (!replyFor) return;
        const next: VRLetter = { ...replyFor, replyStatus: 'queued', reply: { charId: 'user', pen: pen.trim() || userName, content: content.trim(), createdAt: Date.now() } };
        await DB.saveVRLetter(next); setReplyFor(null); await load();
        addToast?.('回信已写好，去「待发送的回信」一键发送', 'success');
    };
    // 编辑一条待发送的回信（改笔名 / 正文）
    const saveReplyEdit = async (pen: string, content: string) => {
        if (!editReplyFor || !editReplyFor.reply) return;
        const next: VRLetter = { ...editReplyFor, reply: { ...editReplyFor.reply, pen: pen.trim() || editReplyFor.reply.pen, content: content.trim() } };
        await DB.saveVRLetter(next); setEditReplyFor(null); await load();
    };

    // 投票：点赞(1)/点踩=举报(-1)/撤销(0)。踩满阈值后端会删信 → 本地移除
    const doVote = async (l: VRLetter, vote: 1 | -1 | 0) => {
        if (!l.remoteLetterId) return;
        try {
            const r = await PostOffice.vote(l.remoteLetterId, vote);
            if (r.deleted) { await DB.deleteVRLetter(l.id); await load(); addToast?.('这封信被举报够数，已移除', 'info'); return; }
            await DB.saveVRLetter({ ...l, likes: r.likes, dislikes: r.dislikes, myVote: vote }); await load();
        } catch (e: any) { addToast?.('操作失败：' + (e?.message || '检查网络'), 'error'); }
    };
    const onLike = (l: VRLetter) => void doVote(l, l.myVote === 1 ? 0 : 1);
    const onDislike = (l: VRLetter) => { if (l.myVote === -1) void doVote(l, 0); else setConfirmReport(l); };

    // 用户自己从零写一封新漂流信 → 落「待寄出」队列
    const startCompose = () => setComposeNew({ id: genLocalId('lt'), box: 'outbox', pen: userName, content: '', createdAt: Date.now(), status: 'queued', charId: 'user' });
    const saveNewLetter = async (pen: string, content: string) => {
        if (!composeNew) return;
        await DB.saveVRLetter({ ...composeNew, pen: pen.trim() || userName, content: content.trim() });
        setComposeNew(null); await load();
        addToast?.('写好了，去「待寄出」一键寄出', 'success');
    };

    // 导入身份码
    const doImport = (code: string) => {
        if (importIdentity(code)) { addToast?.('身份已导入', 'success'); setIdentityOpen(false); void load(); void loadStats(); }
        else addToast?.('身份码无效（格式或校验位不对）', 'error');
    };

    // 作者停止传播：后端删（退出公共池、不再被陌生人抽到/回信），本地留档
    const stopDrift = async (l: VRLetter) => {
        if (!l.remoteId) { addToast?.('这封还没寄出', 'info'); return; }
        try { await PostOffice.release([l.remoteId]); await DB.saveVRLetter({ ...l, released: true }); await load(); addToast?.('已停止传播，本地仍留档', 'success'); }
        catch (e: any) { addToast?.('操作失败：' + (e?.message || '检查网络'), 'error'); }
    };
    // 作者删除已寄出的信：后端删 + 本地删
    const deleteSent = async (l: VRLetter) => {
        try { if (l.remoteId && !l.released) await PostOffice.release([l.remoteId]); await DB.deleteVRLetter(l.id); await load(); addToast?.('已删除', 'success'); }
        catch (e: any) { addToast?.('删除失败：' + (e?.message || '检查网络'), 'error'); }
    };

    // 「我寄出的信」的热度行（赞/踩/浏览/回信）；没数据就不显示
    const statLine = (remoteId?: string) => {
        const s = remoteId ? myStats[remoteId] : undefined;
        if (!s) return null;
        return <div className="text-[9.5px] text-[#a99d82] mt-1">赞 {s.likes}　踩 {s.dislikes}　阅 {s.views}　回 {s.reply_count}</div>;
    };

    return (
        <div className="absolute left-3 right-3 z-20 overflow-hidden flex flex-col"
            style={{ top: VR_ROOM_PANEL_TOP, bottom: vrBottomPad('0.75rem'), background: PAPER.paper, border: `1px solid ${PAPER.edge}`, borderRadius: 12, boxShadow: '0 8px 22px rgba(80,64,30,.3)' }}>
            {/* 动作行 */}
            <div className="flex items-center gap-1.5 px-3 py-2 shrink-0" style={{ borderBottom: `1.5px dashed ${PAPER.line}` }}>
                <span className="text-[12px] mr-auto" style={{ fontFamily: HAND, fontWeight: 700, color: ROOM_THEME.postoffice.ink }}>✉️ 邮局</span>
                <InkBtn tone="soft" onClick={refreshInbox} disabled={!!busy} className="text-[10.5px] px-2.5 py-1">{busy === 'inbox' ? '…' : '刷新收件箱'}</InkBtn>
                <InkBtn tone="soft" onClick={collectReplies} disabled={!!busy} className="text-[10.5px] px-2.5 py-1">{busy === 'collect' ? '…' : '收取回复'}</InkBtn>
                <InkBtn tone="soft" onClick={() => setIdentityOpen(true)} title="邮局身份导出/导入" className="text-[10.5px] px-2.5 py-1">身份</InkBtn>
                {/* 后台入口只在本地开发（vite dev）下出现；部署到网页后普通用户看不到。仍需 ADMIN_TOKEN 才能拉数据。 */}
                {import.meta.env.DEV && <InkBtn tone="soft" onClick={() => setAdminOpen(true)} title="后台：看后端全部信件（需 ADMIN_TOKEN，仅本地可见）" className="text-[10.5px] px-2.5 py-1">后台</InkBtn>}
            </div>

            <div className="flex-1 flex min-h-0">
                {/* 左侧分类栏 */}
                <div className="w-[76px] shrink-0 overflow-y-auto vr-reader-scroll py-2 px-1.5 space-y-1" style={{ borderRight: `1.5px dashed ${PAPER.line}` }}>
                    {([
                        { key: 'outbox', label: '待寄出', count: outQueued.length, tone: ROOM_THEME.postoffice.ink },
                        { key: 'reply', label: '待发送', count: replyQueued.length, tone: ROOM_THEME.postoffice.ink },
                        { key: 'replied', label: '已回', count: repliedSent.length, tone: PAPER.teal },
                        { key: 'inbox', label: '收件箱', count: inboxWaiting.length, tone: ROOM_THEME.guestbook.ink },
                        { key: 'drift', label: '漂流中', count: sentAwaiting.length, tone: ROOM_THEME.guestbook.ink },
                        { key: 'box', label: '信匣', count: archived.length, tone: PAPER.teal },
                    ] as const).map(t => {
                        const active = tab === t.key;
                        return (
                            <button key={t.key} onClick={() => setTab(t.key)}
                                className="w-full rounded-md px-1.5 py-2 text-left transition-colors"
                                style={{ background: active ? '#fff0c0' : 'transparent', border: `1px solid ${active ? PAPER.edge : 'transparent'}` }}>
                                <div className="flex items-center gap-1">
                                    <span className="h-2.5 w-[3px] rounded-full shrink-0" style={{ background: active ? t.tone : 'transparent' }} />
                                    <span className="text-[11px]" style={{ fontFamily: HAND, fontWeight: active ? 700 : 500, color: active ? PAPER.ink : PAPER.inkSoft }}>{t.label}</span>
                                </div>
                                {t.count > 0 && <div className="text-[9px] mt-0.5 pl-2" style={{ color: t.tone }}>{t.count}</div>}
                            </button>
                        );
                    })}
                </div>

                {/* 右侧正文 */}
                <div className="flex-1 min-w-0 overflow-y-auto vr-reader-scroll px-3 py-2.5">
                    {tab === 'outbox' && (() => {
                        const q = readQuota(PO_SEND_QUOTA);
                        const full = q.count >= PO_SEND_QUOTA.limit;
                        return (
                            <>
                                {/* 寄信额度：5 封/5 小时（与后端一致），常驻显示 */}
                                <div className="flex items-center justify-between gap-2 text-[10px] mb-2.5 px-2 py-1.5 rounded-lg" style={{ background: '#f6efdd' }}>
                                    <span className="text-[#7c6f57]">已寄 <b className={full ? 'text-[#c0563f]' : 'text-[#7a5a2b]'}>{q.count}</b><span className="text-[#a99d82]"> / {PO_SEND_QUOTA.limit}（每 {PO_SEND_QUOTA.windowMs / 3600_000} 小时）</span></span>
                                    {q.count > 0 && <span className="text-[#a99d82]">约 {quotaResetHours(q.windowStart, PO_SEND_QUOTA.windowMs)} 小时后{full ? '恢复' : '归零'}</span>}
                                </div>
                                {outQueued.length === 0 ? <p className="text-[10.5px] text-[#a99d82] leading-relaxed">角色在邮局写的漂流信会排在这里，你确认后一键寄出。也可以自己写一封。寄出时笔名会自动匿名。</p> : (
                                    <>
                                        <PagedList items={outQueued} perPage={6} render={l => <PendingLetterRow key={l.id} l={l} onMenu={setMenuFor} />} />
                                        <button onClick={sendOutbox} disabled={!!busy || full} className="w-full mt-1 rounded-full py-2 text-[12px] font-semibold text-[#fbf3e0] disabled:opacity-40" style={{ background: PAPER.ink }}>{busy === 'send' ? '寄出中…' : full ? `寄信已到上限（${PO_SEND_QUOTA.limit} 封/${PO_SEND_QUOTA.windowMs / 3600_000}h）` : `一键寄出（${outQueued.length}）`}</button>
                                    </>
                                )}
                                <button onClick={startCompose} className="w-full mt-1.5 rounded-full py-1.5 text-[11px] text-[#3f3526]" style={{ border: '1px solid #c9b793' }}>自己写一封新漂流信</button>
                            </>
                        );
                    })()}

                    {tab === 'reply' && (() => {
                        const rq = readQuota(PO_REPLY_QUOTA);
                        const full = rq.count >= PO_REPLY_QUOTA.limit;
                        return (
                            <>
                                {/* 回信日额度：常驻显示，用完锁发送 */}
                                <div className="flex items-center justify-between gap-2 text-[10px] mb-2.5 px-2 py-1.5 rounded-lg" style={{ background: '#f6efdd' }}>
                                    <span className="text-[#7c6f57]">今日已回 <b className={full ? 'text-[#c0563f]' : 'text-[#7a5a2b]'}>{rq.count}</b><span className="text-[#a99d82]"> / {PO_REPLY_QUOTA.limit}</span></span>
                                    {rq.count > 0 && <span className="text-[#a99d82]">约 {quotaResetHours(rq.windowStart, PO_REPLY_QUOTA.windowMs)} 小时后{full ? '恢复' : '归零'}</span>}
                                </div>
                                {replyQueued.length === 0 ? <p className="text-[10.5px] text-[#a99d82] leading-relaxed">你亲自写好、还没发出的回信会排在这里。</p> : (
                                    <>
                                        <PagedList items={replyQueued} perPage={6} render={l => (
                                            <div key={l.id} className="rounded-lg p-2 mb-1.5" style={{ background: '#f6efdd' }}>
                                                <div className="flex items-start gap-1.5 mb-1">
                                                    <p className="flex-1 min-w-0 text-[10.5px] text-[#7c6f57] leading-snug">原信（{l.pen}）：<ExpandText text={l.content} limit={80} /></p>
                                                    <button onClick={() => setReplyMenu(l)} className="shrink-0 text-[#a99d82] text-[14px] leading-none px-1 -mt-0.5 active:text-[#3f3526]">···</button>
                                                </div>
                                                <p className="text-[11.5px] text-[#3f3526] leading-snug whitespace-pre-wrap">回信（{l.reply!.pen}）：{l.reply!.content}</p>
                                                <input value={l.reply!.userNote || ''} onChange={e => setUserNote(l, e.target.value)} placeholder="想补充几句一起回？（选填）"
                                                    className="w-full mt-1.5 rounded-md bg-[#fffdf6] px-2 py-1 text-[11px] text-[#3f3526] placeholder-[#a99d82] outline-none" />
                                            </div>
                                        )} />
                                        <button onClick={sendReplies} disabled={!!busy || full} className="w-full mt-1 rounded-full py-2 text-[12px] font-semibold text-[#fbf3e0] disabled:opacity-40" style={{ background: PAPER.ink }}>{busy === 'reply' ? '发送中…' : full ? `今日已回满 ${PO_REPLY_QUOTA.limit} 封` : `一键发送回信（${replyQueued.length}）`}</button>
                                    </>
                                )}
                            </>
                        );
                    })()}

                    {tab === 'replied' && (
                        repliedSent.length === 0 ? <p className="text-[10.5px] text-[#a99d82] leading-relaxed">已经发出去的回信会归档在这里（连同原来的陌生来信）。本地留存，可随设备备份导出/导入。</p> : (
                            <PagedList items={repliedSent} perPage={6} render={l => (
                                <div key={l.id} className="rounded-lg p-2 mb-1.5" style={{ background: '#f6efdd' }}>
                                    <div className="flex items-center gap-1.5 mb-1">
                                        <span className="text-[#2f5f86] text-[9.5px]">来自 {l.pen}</span>
                                        <span className="text-[8px] text-[#2f8a80] border border-emerald-300/30 rounded-full px-1.5 leading-tight">已发出</span>
                                    </div>
                                    <p className="text-[10.5px] text-[#7c6f57] leading-snug mb-1">原信：<ExpandText text={l.content} limit={80} /></p>
                                    <p className="text-[11.5px] text-[#3f3526] leading-snug whitespace-pre-wrap pl-2 border-l-2 border-amber-300/40">回信（{l.reply!.pen}）：{l.reply!.content}{l.reply!.userNote ? `\n——\n${l.reply!.userNote}` : ''}</p>
                                </div>
                            )} />
                        )
                    )}

                    {tab === 'inbox' && (
                        inboxWaiting.length === 0 ? <p className="text-[10.5px] text-[#a99d82] leading-relaxed">点上方「刷新收件箱」捞陌生人寄来的信。收到后长按某封，指定角色去回、或你亲自回。</p> : (
                            <>
                                <p className="text-[9.5px] text-[#a99d82] mb-1.5 leading-snug">陌生人寄来的信。等角色逛到邮局会自己回，也可以<b className="text-[#2f5f86]">长按某封信</b>，指定角色去回、或你亲自回。</p>
                                <PagedList items={inboxWaiting} perPage={7} render={l => <InboxLetterRow key={l.id} l={l} onMenu={setInboxMenu} onLike={onLike} onDislike={onDislike} />} />
                            </>
                        )
                    )}

                    {tab === 'drift' && (
                        sentAwaiting.length === 0 ? <p className="text-[10.5px] text-[#a99d82] leading-relaxed">已寄出、还在等陌生人回信的漂流信会显示在这里。</p> : (
                            <PagedList items={sentAwaiting} perPage={7} render={l => (
                                <div key={l.id} className="rounded-lg p-2 mb-1.5 text-[11px]" style={{ background: '#f6efdd' }}>
                                    <div className="flex items-start gap-1.5">
                                        <div className="flex-1 min-w-0 text-[#3f3526] leading-snug"><ExpandText text={l.content} limit={70} /></div>
                                        <button onClick={() => setSentMenu(l)} className="shrink-0 text-[#a99d82] text-[14px] leading-none px-1 -mt-0.5 active:text-[#3f3526]">···</button>
                                    </div>
                                    {l.released && <span className="inline-block mt-1 text-[8px] text-[#a99d82] border border-[#c9b793] rounded-full px-1.5 leading-tight">已停止传播</span>}
                                    {statLine(l.remoteId)}
                                </div>
                            )} />
                        )
                    )}

                    {tab === 'box' && (
                        archived.length === 0 ? <p className="text-[10.5px] text-[#a99d82] leading-relaxed">收到陌生人回信、被角色读过封存的信会留档在这里。</p> : (
                            <PagedList items={archived} perPage={5} render={l => (
                                <div key={l.id} className="rounded-lg p-2 mb-1.5 text-[11px]" style={{ background: '#f6efdd' }}>
                                    <div className="flex items-center gap-1.5 mb-1">
                                        <span className="text-[#7a5a2b] text-[9.5px]">{l.pen}的信</span>
                                        {l.status === 'sealed' && <span className="text-[8px] text-[#7c6f57] border border-amber-300/30 rounded-full px-1.5 leading-tight">已封存</span>}
                                        {l.released && <span className="text-[8px] text-[#a99d82] border border-[#c9b793] rounded-full px-1.5 leading-tight">已停止传播</span>}
                                        <button onClick={() => setSentMenu(l)} className="ml-auto shrink-0 text-[#a99d82] text-[14px] leading-none px-1 active:text-[#3f3526]">···</button>
                                    </div>
                                    <div className="text-[#3f3526] leading-snug mb-1"><ExpandText text={l.content} limit={70} /></div>
                                    {statLine(l.remoteId)}
                                    {(l.repliesReceived || []).map((r, i) => (
                                        <div key={i} className="text-[11px] text-[#3f3526] pl-2 border-l-2 border-amber-300/40 leading-snug mt-1"><span className="font-bold">{r.pen}</span> 回：<ExpandText text={r.content} limit={120} /></div>
                                    ))}
                                    {l.reaction?.content && (
                                        <div className="text-[10.5px] text-[#2f8a80] mt-1.5 pl-2 border-l-2 border-pink-300/40 leading-snug">读后：{l.reaction.content}</div>
                                    )}
                                </div>
                            )} />
                        )
                    )}
                </div>
            </div>

            {/* 长按菜单 / 编辑 / 删除确认 */}
            <ActionSheet open={!!menuFor} title={menuFor ? `「${menuFor.pen}」的待寄信` : ''}
                actions={[
                    { label: '编辑', onClick: () => { setEditing(menuFor); setMenuFor(null); } },
                    { label: '删除', danger: true, onClick: () => { setConfirmDel(menuFor); setMenuFor(null); } },
                ]} onClose={() => setMenuFor(null)} />
            {editing && <LetterEditModal letter={editing} onSave={saveEdit} onCancel={() => setEditing(null)} />}
            <ConfirmDialog open={!!confirmDel} title="删除这封信？"
                message={confirmDel ? (confirmDel.box === 'inbox'
                    ? (confirmDel.replyStatus === 'queued' ? '这封陌生来信和你写好的回信都会被丢弃。' : '这封陌生来信将从本地删除。')
                    : '这封还没寄出的漂流信将被丢弃。') : ''}
                onConfirm={() => { if (confirmDel) void del(confirmDel.id); setConfirmDel(null); }} onCancel={() => setConfirmDel(null)} />

            {/* 已寄出信的作者管理：停止传播 / 删除 */}
            <ActionSheet open={!!sentMenu} title={sentMenu ? '管理这封已寄出的信' : ''}
                actions={[
                    ...(sentMenu && !sentMenu.released ? [{ label: '停止传播（退出公共池，本地留档）', onClick: () => { const l = sentMenu; setSentMenu(null); if (l) void stopDrift(l); } }] : []),
                    { label: '删除这封信（本地与后端都删）', danger: true, onClick: () => { setConfirmDelSent(sentMenu); setSentMenu(null); } },
                ]} onClose={() => setSentMenu(null)} />
            <ConfirmDialog open={!!confirmDelSent} title="删除这封信？" message="本地留档与公共池里的这封信都会被删除，相关回信也一并清除，不可恢复。"
                onConfirm={() => { if (confirmDelSent) void deleteSent(confirmDelSent); setConfirmDelSent(null); }} onCancel={() => setConfirmDelSent(null)} />

            {/* 来信长按菜单：指定角色回 / 亲自回 / 删除 */}
            <ActionSheet open={!!inboxMenu} title={inboxMenu ? `回「${inboxMenu.pen}」的来信` : ''}
                actions={[
                    { label: '指定角色去回（用 AI）', onClick: () => { if (enabledChars.length === 0) { addToast?.('先在「接入」里启用角色', 'info'); setInboxMenu(null); return; } setAssignFor(inboxMenu); setInboxMenu(null); } },
                    { label: '我亲自回（不用 AI）', onClick: () => { setReplyFor(inboxMenu); setInboxMenu(null); } },
                    { label: '删除这封来信', danger: true, onClick: () => { setConfirmDel(inboxMenu); setInboxMenu(null); } },
                ]} onClose={() => setInboxMenu(null)} />
            {/* 选哪个角色去回 */}
            <ActionSheet open={!!assignFor} title={assignFor ? `让谁去回「${assignFor.pen}」的信？` : ''}
                actions={enabledChars.map(c => ({ label: c.name, onClick: () => assignReply(c.id) }))}
                onClose={() => setAssignFor(null)} />
            {replyFor && <ReplyComposeModal letter={replyFor} defaultPen={userName} onSave={saveManualReply} onCancel={() => setReplyFor(null)} />}

            {/* 待发送回信：编辑 / 删除 */}
            <ActionSheet open={!!replyMenu} title={replyMenu ? `这条待发送的回信（回 ${replyMenu.pen}）` : ''}
                actions={[
                    { label: '编辑回信', onClick: () => { setEditReplyFor(replyMenu); setReplyMenu(null); } },
                    { label: '删除（连来信一起丢弃）', danger: true, onClick: () => { setConfirmDel(replyMenu); setReplyMenu(null); } },
                ]} onClose={() => setReplyMenu(null)} />
            {editReplyFor && editReplyFor.reply && <ReplyComposeModal letter={editReplyFor} defaultPen={editReplyFor.reply.pen} initialContent={editReplyFor.reply.content} title="编辑这条回信" cta="保存" onSave={saveReplyEdit} onCancel={() => setEditReplyFor(null)} />}

            {/* 投票=举报 二次确认 */}
            <ConfirmDialog open={!!confirmReport} title="点踩 = 举报这封信？" confirmText="确认举报"
                message="踩等于举报。一封信被 5 个不同设备举报会被自动删除，不可恢复。"
                onConfirm={() => { if (confirmReport) void doVote(confirmReport, -1); setConfirmReport(null); }} onCancel={() => setConfirmReport(null)} />
            {/* 用户自己写新漂流信 */}
            {composeNew && <LetterEditModal letter={composeNew} title="写一封新漂流信" onSave={saveNewLetter} onCancel={() => setComposeNew(null)} />}
            {/* 身份导出/导入 */}
            {identityOpen && <IdentityModal onImport={doImport} onClose={() => setIdentityOpen(false)} />}
            {/* 后台：看后端全部信件 */}
            {adminOpen && <AdminModal onClose={() => setAdminOpen(false)} />}
        </div>
    );
};

// ============ 房间场景（全屏） ============
const toSong = (s: CharPlaylistSong): Song => ({ id: s.id, name: s.name, artists: s.artists, album: s.album, albumPic: s.albumPic, duration: s.duration, fee: s.fee ?? 0 });

const POKE_LINES = ['嗨嗨！', '在呢在呢～', '看我看我', '今天也很可爱吧', '要一起合影吗', '嘿嘿', '戳我干嘛啦', '比个耶 ✌️', '抱抱～', '想你了哦'];
const RoomScene: React.FC<{
    roomId: VRRoomId; occupants: CharacterProfile[];
    latestByChar: Record<string, FeedItem>; onClose: () => void;
    onJump: (novelId: string | undefined, segIdx: number) => void;
    characters: CharacterProfile[];
    userName: string;
    onUserBoardPost: (content: string) => Promise<void>;
    addToast?: (m: string, t?: any) => void;
    userProfile?: UserProfile;
    updateCharacter: (id: string, updates: Partial<CharacterProfile>) => void;
    updateUserProfile: (u: Partial<UserProfile>) => void;
    onDressUp: (char: CharacterProfile) => void;
    onDressUpUser: () => void;
}> = ({ roomId, occupants, latestByChar, onClose, onJump, characters, userName, onUserBoardPost, addToast, userProfile, updateCharacter, updateUserProfile, onDressUp, onDressUpUser }) => {
    const room = getRoom(roomId);
    const th = roomTheme(roomId);
    const slots = ROOM_SLOTS[roomId];
    const isMusic = roomId === 'music';
    const isGuestbook = roomId === 'guestbook';
    const isPostOffice = roomId === 'postoffice';
    const isTheater = roomId === 'theater';
    const isPlaza = roomId === 'plaza';
    const [detail, setDetail] = useState<CharacterProfile | null>(null);
    const [musicState, setMusicState] = useState<VRMusicRoomState | null>(null);
    const [board, setBoard] = useState<VRGuestbookState | null>(null);
    const [postText, setPostText] = useState('');
    const [posting, setPosting] = useState(false);
    const [hideChibi, setHideChibi] = useState(false);  // 隐藏小人（留言簿等文字面板会被小人挡住时用）
    const [photoOpen, setPhotoOpen] = useState(false);   // 世界房间·合影
    const [pokes, setPokes] = useState<Record<string, string>>({}); // 逗 ta 说话：临时气泡（charId→台词）
    const music = useMusic();

    // 当前在场某个小人的"live"版本（角色取 characters，用户取 userProfile 伪对象）
    const liveOf = (c: CharacterProfile): CharacterProfile => c.id === 'user'
        ? ({ ...c, vrState: { ...(c.vrState || {} as any), chibi: userProfile?.vrState?.chibi } } as CharacterProfile)
        : (characters.find(x => x.id === c.id) || c);
    // 给某个小人改 chibi（姿势/贴纸等就地换装）。区分用户与角色。
    const patchChibi = (c: CharacterProfile, patch: Partial<NonNullable<CharacterProfile['vrState']>['chibi']>) => {
        if (c.id === 'user') {
            const uv = userProfile?.vrState;
            if (!uv?.chibi) { onDressUpUser(); return; }
            updateUserProfile({ vrState: { ...uv, enabled: !!uv.enabled, chibi: { ...uv.chibi, ...patch } } });
        } else {
            const live = characters.find(x => x.id === c.id) || c;
            if (!live.vrState?.chibi) { onDressUp(live); return; }
            updateCharacter(c.id, { vrState: { ...(live.vrState || {} as any), chibi: { ...live.vrState.chibi, ...patch } } });
        }
    };
    const dressUp = (c: CharacterProfile) => { if (c.id === 'user') onDressUpUser(); else onDressUp(liveOf(c)); setDetail(null); };
    // 逗 ta 说一句（临时气泡，2.6s 后消失）
    const poke = (c: CharacterProfile) => {
        const line = POKE_LINES[Math.floor(Math.random() * POKE_LINES.length)];
        setPokes(p => ({ ...p, [c.id]: line }));
        window.setTimeout(() => setPokes(p => { const n = { ...p }; delete n[c.id]; return n; }), 2600);
    };

    useEffect(() => {
        if (!isGuestbook) return;
        const load = async () => setBoard(await DB.getVRGuestbook());
        void load();
        const onDone = () => { void load(); };
        window.addEventListener('vr-session-done', onDone);
        return () => window.removeEventListener('vr-session-done', onDone);
    }, [isGuestbook]);

    const submitPost = async () => {
        const t = postText.trim();
        if (!t || posting) return;
        setPosting(true);
        try { await onUserBoardPost(t); setPostText(''); setBoard(await DB.getVRGuestbook()); }
        finally { setPosting(false); }
    };

    useEffect(() => {
        if (!isMusic) return;
        const load = async () => setMusicState(await DB.getVRMusicRoom());
        void load();
        const onDone = () => { void load(); };
        window.addEventListener('vr-session-done', onDone);
        return () => window.removeEventListener('vr-session-done', onDone);
    }, [isMusic]);

    const np = musicState?.nowPlaying;
    const npPlaying = !!np && music.current?.id === np.song.id && music.playing;
    // 记录是否由听歌房起播 —— 离开房间时只暂停"我们放的"那首，不动用户自己的音乐
    const startedRef = useRef(false);
    const musicRef = useRef(music);
    musicRef.current = music;
    const playNow = () => {
        if (!np) return;
        if (music.current?.id === np.song.id) music.togglePlay();
        else { music.playSong(toSong(np.song)); startedRef.current = true; }
    };
    // 音乐只在听歌房内播放：离开场景时若仍在放我们起播的歌，暂停它
    useEffect(() => () => {
        const m = musicRef.current;
        if (startedRef.current && m.playing && m.current?.id === musicState?.nowPlaying?.song.id) {
            m.togglePlay();
        }
    }, []);

    return (
        <div className="fixed inset-0 z-50 flex flex-col" style={{ background: PAPER.page }}>
            <VRStyleTag />
            <div className="relative flex-1 overflow-hidden">
                <RoomBackground roomId={roomId} />
                {/* 顶栏（纸条 + 胶带） */}
                <div className="absolute top-0 left-0 right-0 flex items-center gap-2 px-3 pb-3 z-[120]"
                    style={{ paddingTop: VR_TOP }}>
                    <button onClick={onClose} className="h-9 w-9 flex items-center justify-center rounded-lg active:translate-y-px" style={{ background: PAPER.paper, border: `1px solid ${PAPER.edge}`, color: PAPER.ink, boxShadow: '0 2px 0 rgba(0,0,0,.12)' }}><CaretLeft size={18} weight="bold" /></button>
                    <span className="relative px-2.5 py-1 text-[15px]" style={{ fontFamily: HAND, fontWeight: 700, color: th.ink, background: PAPER.paper, border: `1px solid ${PAPER.edge}`, borderRadius: 7, transform: 'rotate(-1.5deg)' }}>
                        <Tape color={th.tape} w={34} style={{ top: -7, left: 8, transform: 'rotate(-7deg)' }} />
                        {th.sticker} {room.name}
                    </span>
                    <div className="ml-auto flex items-center gap-1.5">
                        {isPlaza && occupants.length > 0 && (
                            <button onClick={() => setPhotoOpen(true)} className="flex items-center gap-1 text-[10.5px] px-2.5 py-1.5 rounded-lg active:translate-y-px" style={{ fontFamily: HAND, background: '#fff3c4', border: `1px solid ${PAPER.edge}`, color: PAPER.ink, boxShadow: '0 2px 0 rgba(0,0,0,.12)' }}>
                                <Camera size={13} weight="bold" /> 合影
                            </button>
                        )}
                        {occupants.length > 0 && (
                            <button onClick={() => setHideChibi(h => !h)} title={hideChibi ? '显示小人' : '隐藏小人（避免挡住文字）'}
                                className="text-[10.5px] px-2.5 py-1.5 rounded-lg active:translate-y-px" style={{ fontFamily: HAND, background: PAPER.paper, border: `1px solid ${PAPER.edge}`, color: PAPER.ink }}>
                                {hideChibi ? '显示' : '藏起小人'}
                            </button>
                        )}
                        <span className="text-[10px] px-1.5 py-1 rounded" style={{ fontFamily: HAND, color: PAPER.inkSoft, background: PAPER.cream, border: `1px solid ${PAPER.edge}` }}>{occupants.length} 在场</span>
                    </div>
                </div>

                {/* 听歌房：正在放 + 队列面板 */}
                {isMusic && (
                    <div className="absolute left-3 right-3 z-20" style={{ top: VR_ROOM_PANEL_TOP }}>
                        {np ? (
                            <div className="relative p-2.5 flex items-center gap-3"
                                style={{ background: PAPER.paper, border: `1px solid ${PAPER.edge}`, borderRadius: 12, boxShadow: '0 6px 16px rgba(80,64,30,.22)', transform: 'rotate(-1deg)' }}>
                                <Tape color={th.tape} w={40} style={{ top: -7, left: 18, transform: 'rotate(-6deg)' }} />
                                {np.song.albumPic
                                    ? <img src={np.song.albumPic} className="h-14 w-14 rounded-lg object-cover" style={{ border: `2px solid ${PAPER.edge}`, animation: npPlaying ? 'spin 8s linear infinite' : undefined }} alt="" />
                                    : <div className="h-14 w-14 rounded-lg flex items-center justify-center" style={{ background: th.paper, border: `2px solid ${PAPER.edge}` }}><MusicNotes size={22} weight="fill" style={{ color: th.ink }} /></div>}
                                <div className="flex-1 min-w-0">
                                    <div className="text-[9px] flex items-center gap-1" style={{ fontFamily: HAND, color: th.ink }}><MusicNotes size={9} weight="fill" /> 正在放 · {np.charName} 点的</div>
                                    <div className="text-[13px] font-bold truncate" style={{ fontFamily: HAND, color: PAPER.ink }}>{np.song.name}</div>
                                    <div className="text-[10.5px] truncate" style={{ color: PAPER.inkSoft }}>{np.song.artists}</div>
                                </div>
                                <button onClick={playNow} className="h-10 w-10 rounded-full flex items-center justify-center active:scale-90 transition-transform shrink-0" style={{ background: th.ink }}>
                                    {npPlaying ? <Pause size={18} weight="fill" className="text-white" /> : <Play size={18} weight="fill" className="text-white ml-0.5" />}
                                </button>
                            </div>
                        ) : (
                            <div className="relative p-3 text-center" style={{ background: PAPER.paper, border: `1px solid ${PAPER.edge}`, borderRadius: 12, boxShadow: '0 4px 12px rgba(80,64,30,.18)' }}>
                                <p className="text-[11px]" style={{ fontFamily: HAND, color: PAPER.ink }}>磁带机还空着。让有音乐人格的角色逛进来，ta 就会点一首。</p>
                                <p className="text-[9.5px] mt-1" style={{ color: PAPER.inkSoft }}>没有音乐人格？去「音乐」App 给角色生成一个网易云档案。</p>
                            </div>
                        )}
                        {musicState?.queue && musicState.queue.length > 0 && (
                            <div className="mt-1.5 flex items-center gap-1.5 px-2.5 py-1.5 overflow-x-auto no-scrollbar" style={{ background: PAPER.cream, border: `1px solid ${PAPER.edge}`, borderRadius: 8 }}>
                                <Queue size={12} weight="bold" className="shrink-0" style={{ color: th.ink }} />
                                {musicState.queue.slice(0, 6).map((q, i) => (
                                    <span key={i} className="text-[9.5px] whitespace-nowrap shrink-0" style={{ color: PAPER.inkSoft }}>《{q.song.name}》<span style={{ color: PAPER.inkFaint }}>·{q.charName}</span>{i < Math.min(5, musicState.queue.length - 1) ? ' ·' : ''}</span>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* 留言簿：版聊墙（DC 风：头像 + 连续消息成组，回复弱化） */}
                {isGuestbook && (() => {
                    const msgs = (board?.messages || []).slice(-80); // 超出只留最近的，旧的隐藏
                    // 连续同一作者（且非回复、间隔不久）合并为一组
                    const groups: VRGuestbookMessage[][] = [];
                    for (const m of msgs) {
                        const g = groups[groups.length - 1];
                        if (g && g[0].authorId === m.authorId && !m.replyToName && (m.createdAt - g[g.length - 1].createdAt) < 5 * 60 * 1000) g.push(m);
                        else groups.push([m]);
                    }
                    return (
                        <div className="absolute left-3 right-3 z-20 overflow-hidden flex flex-col"
                            style={{ top: VR_ROOM_PANEL_TOP, bottom: vrBottomPad('4rem'), background: PAPER.paper, border: `1px solid ${PAPER.edge}`, borderRadius: 12, boxShadow: '0 8px 22px rgba(80,64,30,.28)' }}>
                            <div className="px-3 py-2 text-[12px]" style={{ fontFamily: HAND, fontWeight: 700, color: th.ink, borderBottom: `1.5px dashed ${PAPER.line}` }}>📌 便签留言墙</div>
                            <div className="flex-1 overflow-y-auto vr-reader-scroll px-3 py-3 space-y-3">
                                {groups.length === 0 ? (
                                    <p className="text-[11px] text-center py-6" style={{ fontFamily: HAND, color: PAPER.inkSoft }}>这面墙还空着。贴上第一张便签，或等角色们来开帖。</p>
                                ) : groups.map(g => {
                                    const head = g[0];
                                    const isUser = head.authorId === 'user';
                                    const ch = isUser ? null : characters.find(c => c.id === head.authorId);
                                    const name = isUser ? head.authorName : (ch?.name || head.authorName);
                                    return (
                                        <div key={head.id} className="flex gap-2.5">
                                            {ch?.avatar
                                                ? <img src={ch.avatar} className="h-8 w-8 rounded-full object-cover shrink-0 mt-0.5" style={{ border: `1px solid ${PAPER.edge}` }} alt="" />
                                                : <div className="h-8 w-8 rounded-full shrink-0 mt-0.5 flex items-center justify-center text-[12px] font-bold" style={{ background: noteColor(head.authorId), color: PAPER.ink, border: `1px solid ${PAPER.edge}`, fontFamily: HAND }}>{name.slice(0, 1)}</div>}
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-baseline gap-1.5">
                                                    <span className="text-[12px] font-bold" style={{ fontFamily: HAND, color: isUser ? PAPER.red : PAPER.ink }}>{name}</span>
                                                    <span className="text-[8.5px] tabular-nums" style={{ color: PAPER.inkFaint }}>{new Date(head.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                                                </div>
                                                <div className="mt-1 space-y-1">
                                                    {g.map((m, mi) => (
                                                        <div key={m.id} className="text-[12.5px] leading-relaxed px-2.5 py-1.5 w-fit max-w-full" style={{ color: PAPER.ink, background: noteColor(head.authorId + mi), border: `1px solid ${PAPER.edge}`, borderRadius: 6, transform: `rotate(${tiltOf(m.id, 1.4)}deg)` }}>
                                                            {m.replyToName && <span className="text-[10px] mr-1" style={{ color: PAPER.red }}>↩{m.replyToName}</span>}
                                                            {m.content}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })()}

                {/* 邮局：信件管理面板 */}
                {isPostOffice && <PostOfficePanel addToast={addToast} characters={characters} userName={userName} />}

                {/* 剧院：话剧部门面板（投稿 / 编排 / 演出 / 历史） */}
                {isTheater && <TheaterPanel addToast={addToast} />}

                {/* chibi 站位（可隐藏，避免挡住留言墙等文字） */}
                {!hideChibi && occupants.map((c, i) => {
                    const slot = slots[i % slots.length];
                    const latest = latestByChar[c.id];
                    const idle = IDLE_QUIPS[roomId][i % IDLE_QUIPS[roomId].length];
                    const bubble = pokes[c.id] || (latest ? (stripSelfName(latest.meta.activity, c.name) || idle) : idle);
                    return (
                        <div key={c.id} className="absolute" style={{ left: `${slot.x}%`, top: `${slot.y}%`, zIndex: Math.round(slot.y) }}>
                            <Chibi char={liveOf(c)} bubble={bubble} size={isPlaza ? 96 : 104} dance={isMusic} onTap={() => { if (isPlaza) poke(c); setDetail(c); }} />
                        </div>
                    );
                })}
                {occupants.length === 0 && !isMusic && !isGuestbook && !isPostOffice && !isTheater && (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <p className="text-[12px] px-4 py-2 rounded-lg" style={{ fontFamily: HAND, color: PAPER.ink, background: PAPER.paper, border: `1px solid ${PAPER.edge}` }}>{isPlaza ? '广场上还没人。去「接入」捏几个小人来碰头吧。' : '这个房间还没有人。去「接入」启用角色吧。'}</p>
                    </div>
                )}

                {/* 留言簿：用户发言（广播给所有接入角色） */}
                {isGuestbook && (
                    <div className="absolute left-0 right-0 z-30 flex items-center gap-2 px-3 py-2.5"
                        style={{ bottom: vrBottomPad('0px'), background: `linear-gradient(0deg, ${PAPER.page}, transparent)` }}>
                        <input value={postText} onChange={e => setPostText(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') submitPost(); }}
                            placeholder={`以 ${userName} 的身份贴一张便签…`}
                            className="flex-1 rounded-lg px-4 py-2 text-[12.5px] outline-none"
                            style={{ fontFamily: HAND, color: PAPER.ink, background: PAPER.paper, border: `1px solid ${PAPER.edge}` }} />
                        <InkBtn tone="ink" onClick={submitPost} disabled={!postText.trim() || posting} className="h-9 px-4 text-[12px] font-semibold shrink-0">
                            {posting ? '…' : '贴上'}
                        </InkBtn>
                    </div>
                )}
            </div>

            {/* 角色活动详情 + 就地换装/摆姿势/贴纸/逗 ta（盖在 chibi 之上） */}
            {detail && (() => {
                const live = liveOf(detail);
                const cur = live.vrState?.chibi;
                const curPose = cur?.pose || 'idle';
                const cyclePose = () => { const idx = POSE_LIST.findIndex(p => p.key === curPose); patchChibi(detail, { pose: POSE_LIST[(idx + 1) % POSE_LIST.length].key }); };
                const cycleSticker = () => { const idx = STICKER_CHOICES.indexOf(cur?.sticker || ''); patchChibi(detail, { sticker: STICKER_CHOICES[(idx + 1) % STICKER_CHOICES.length] }); };
                return (
                <div className="absolute inset-0 flex items-end bg-black/40" style={{ zIndex: 200 }} onClick={() => setDetail(null)}>
                    <div className="w-full rounded-t-2xl p-4" style={{ background: PAPER.paper, borderTop: `2px solid ${PAPER.edge}`, paddingBottom: vrBottomPad('1rem') }} onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-2 mb-2.5">
                            {detail.avatar ? <img src={detail.avatar} className="h-9 w-9 rounded-full object-cover" style={{ border: `1px solid ${PAPER.edge}` }} alt="" /> : <div className="h-9 w-9 rounded-full" style={{ background: noteColor(detail.id), border: `1px solid ${PAPER.edge}` }} />}
                            <span className="font-bold text-[15px]" style={{ fontFamily: HAND, color: PAPER.ink }}>{detail.name}</span>
                            {detail.id === 'user' && <InkTag color="#d7e7f6" style={{ fontSize: 9 }}>就是你</InkTag>}
                            <button onClick={() => setDetail(null)} className="ml-auto h-7 w-7 flex items-center justify-center rounded-lg" style={{ background: PAPER.cream, border: `1px solid ${PAPER.edge}`, color: PAPER.ink }}><X size={16} weight="bold" /></button>
                        </div>
                        {/* 捏小人动作行 */}
                        <div className="flex flex-wrap gap-1.5 mb-3">
                            <InkBtn tone="soft" onClick={() => dressUp(detail)} className="text-[11px] px-2.5 py-1.5 flex items-center gap-1"><Scissors size={12} weight="bold" /> 换装</InkBtn>
                            <InkBtn tone="soft" onClick={cyclePose} className="text-[11px] px-2.5 py-1.5 flex items-center gap-1"><HandWaving size={12} weight="bold" /> 摆姿势 · {POSE_LIST.find(p => p.key === curPose)?.label}</InkBtn>
                            <InkBtn tone="soft" onClick={cycleSticker} className="text-[11px] px-2.5 py-1.5 flex items-center gap-1"><Sticker size={12} weight="bold" /> 贴纸 {cur?.sticker || '＋'}</InkBtn>
                            <InkBtn tone="soft" onClick={() => poke(detail)} className="text-[11px] px-2.5 py-1.5 flex items-center gap-1"><Smiley size={12} weight="bold" /> 逗ta</InkBtn>
                        </div>
                        {latestByChar[detail.id] ? (() => {
                            const m = latestByChar[detail.id].meta;
                            return (
                                <>
                                    <p className="text-[12.5px] leading-relaxed" style={{ color: PAPER.ink }}>{stripSelfName(m.activity, detail.name)}</p>
                                    {m.behavior && <p className="text-[11px] mt-1.5" style={{ color: PAPER.teal }}>{stripSelfName(m.behavior, detail.name)}</p>}
                                    {m.annotationRefs && m.annotationRefs.length > 0
                                        ? m.annotationRefs.map((ref, i) => (
                                            <button key={i} onClick={() => { onJump(m.novelId, ref.segIdx); setDetail(null); }}
                                                className="block w-full text-left mt-1.5 text-[11.5px] pl-2 leading-snug active:opacity-60" style={{ color: PAPER.inkSoft, borderLeft: `2px solid ${PAPER.red}88` }}>
                                                {stripLeakedAttrs(ref.text)} <span style={{ color: PAPER.red }}>↗原文</span>
                                            </button>
                                        ))
                                        : m.annotationExcerpts?.map((ex, i) => (
                                            <div key={i} className="mt-1.5 text-[11.5px] pl-2 leading-snug" style={{ color: PAPER.inkSoft, borderLeft: `2px solid ${PAPER.edge}` }}>{stripLeakedAttrs(ex)}</div>
                                        ))}
                                    <p className="text-[9px] mt-2" style={{ color: PAPER.inkFaint }}>{new Date(latestByChar[detail.id].timestamp).toLocaleString('zh-CN')}</p>
                                </>
                            );
                        })() : (
                            <p className="text-[12px]" style={{ color: PAPER.inkSoft }}>{isPlaza ? '点点 ta 逗两句，或给 ta 换装、摆个姿势～' : '还没有留下动态，等 ta 下一次登入吧。'}</p>
                        )}
                    </div>
                </div>
                );
            })()}

            {/* 世界房间 · 合影（拍立得） */}
            {photoOpen && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/55 px-4" style={{ zIndex: 240 }} onClick={() => setPhotoOpen(false)}>
                    <div className="relative w-full max-w-[340px] p-3 pb-10" onClick={e => e.stopPropagation()}
                        style={{ background: '#fffdf6', border: `1px solid ${PAPER.edge}`, borderRadius: 4, boxShadow: '0 18px 50px rgba(0,0,0,.5)', transform: 'rotate(-1.5deg)' }}>
                        <Tape color={th.tape} w={80} style={{ top: -12, left: '50%', marginLeft: -40, transform: 'rotate(-3deg)' }} />
                        <button onClick={() => setPhotoOpen(false)} className="absolute top-1 right-1 h-7 w-7 flex items-center justify-center rounded-lg z-10" style={{ background: PAPER.cream, border: `1px solid ${PAPER.edge}`, color: PAPER.ink }}><X size={15} weight="bold" /></button>
                        <div className="relative h-52 overflow-hidden rounded-[3px]" style={{ border: `1px solid ${PAPER.edge}` }}>
                            <RoomBackground roomId={roomId} />
                            <div className="absolute inset-x-0 bottom-1 flex items-end justify-center gap-0.5 px-2">
                                {occupants.slice(0, 8).map(c => {
                                    const ch = getChibi(liveOf(c));
                                    return ch.img
                                        ? <img key={c.id} src={ch.img} className="h-20 object-contain object-bottom" alt="" style={{ transform: `scaleX(${ch.flip ? -1 : 1})`, filter: 'drop-shadow(0 3px 3px rgba(90,70,40,.45))' }} />
                                        : <div key={c.id} className="h-10 w-10 rounded-full flex items-center justify-center text-[11px]" style={{ background: noteColor(c.id), color: PAPER.ink, border: `1px solid ${PAPER.edge}` }}>{c.name.slice(0, 1)}</div>;
                                })}
                            </div>
                        </div>
                        <div className="text-center text-[13px] mt-2" style={{ fontFamily: HAND, color: PAPER.ink }}>页外 · 世界房间合影 ☆</div>
                        <div className="text-center text-[9.5px]" style={{ fontFamily: HAND, color: PAPER.inkSoft }}>{new Date().toLocaleDateString('zh-CN')} · {occupants.length} 个小人 · 截图留念</div>
                    </div>
                </div>
            )}
        </div>
    );
};

// ============ 书库 ============
const LibraryView: React.FC<{
    novels: VRWorldNovel[]; characters: CharacterProfile[];
    onOpen: (n: VRWorldNovel) => void; onAdd: () => void; onDelete: (id: string) => void;
}> = ({ novels, characters, onOpen, onAdd, onDelete }) => (
    <div className="space-y-3">
        <InkBtn tone="ink" onClick={onAdd} className="w-full py-2.5 text-[13px] font-bold flex items-center justify-center gap-1.5" style={{ borderRadius: 10 }}>
            <Plus size={16} weight="bold" /> 贴一本小说进来（.txt）
        </InkBtn>
        {novels.length === 0 ? (
            <p className="text-[11px] py-6 text-center leading-relaxed" style={{ fontFamily: HAND, color: PAPER.inkSoft }}>书架还空着。贴进来的小说是所有角色共享的读物，每个角色各自留批注、各自记书签。</p>
        ) : novels.map(novel => {
            const readers = characters.filter(c => getBookmark(c.vrState?.novelBookmarks, novel.id) > 0);
            return (
                <div key={novel.id} className="relative p-3.5 pl-4" style={{ background: PAPER.paper, border: `1px solid ${PAPER.edge}`, borderRadius: 10, boxShadow: '0 3px 0 rgba(120,100,60,.1)', transform: `rotate(${tiltOf(novel.id, 0.8)}deg)` }}>
                    <span className="absolute left-0 top-3 bottom-3 w-[4px] rounded-full" style={{ background: ROOM_THEME.library.ink, opacity: .55 }} />
                    <Tape color={ROOM_THEME.library.tape} w={30} style={{ top: -7, right: 18, transform: 'rotate(7deg)' }} />
                    <div className="flex items-start gap-2">
                        <BookOpen size={18} weight="fill" className="mt-0.5 shrink-0" style={{ color: ROOM_THEME.library.ink }} />
                        <div className="flex-1 min-w-0">
                            <div className="text-[13px] font-bold truncate" style={{ fontFamily: HAND, color: PAPER.ink }}>{novel.title}</div>
                            {novel.author && <div className="text-[10px]" style={{ color: PAPER.inkSoft }}>{novel.author}</div>}
                            <div className="text-[10px] mt-0.5" style={{ color: PAPER.inkFaint }}>{novel.segments.length} 段 · {novel.totalChars.toLocaleString()} 字</div>
                        </div>
                        <button onClick={() => onDelete(novel.id)} className="p-1.5 rounded-md active:translate-y-px" style={{ color: PAPER.inkSoft }}><Trash size={15} /></button>
                    </div>
                    {readers.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {readers.map(c => {
                                const bm = getBookmark(c.vrState?.novelBookmarks, novel.id);
                                const pct = Math.round((bm / Math.max(1, novel.segments.length)) * 100);
                                return <span key={c.id} className="text-[9.5px] rounded-full px-2 py-0.5" style={{ fontFamily: HAND, color: PAPER.ink, background: PAPER.cream, border: `1px solid ${PAPER.edge}` }}>{c.name} {pct}%</span>;
                            })}
                        </div>
                    )}
                    <button onClick={() => onOpen(novel)} className="mt-2 text-[11px] font-semibold flex items-center gap-0.5 active:opacity-70" style={{ fontFamily: HAND, color: ROOM_THEME.library.ink }}>翻开读 / 看批注 <CaretRight size={12} weight="bold" /></button>
                </div>
            );
        })}
    </div>
);

// ============ 阅读器主题 ============
interface ReaderTheme { id: string; name: string; bg: string; paper: string; text: string; sub: string; accent: string; annBg: string; }
const READER_THEMES: ReaderTheme[] = [
    { id: 'paper', name: '纸白', bg: '#e9e3d6', paper: '#f7f3ea', text: '#322d25', sub: '#8a7f6c', accent: '#a0673b', annBg: '#efe7d4' },
    { id: 'sepia', name: '羊皮', bg: '#d8c6a3', paper: '#ece0c6', text: '#48381f', sub: '#917a52', accent: '#8a5a2b', annBg: '#e2d3b2' },
    { id: 'green', name: '护眼', bg: '#bcd4bc', paper: '#d6e8d4', text: '#26331f', sub: '#5d7350', accent: '#3f6b3a', annBg: '#cadfc6' },
    { id: 'night', name: '夜阅', bg: '#15161a', paper: '#1f2128', text: '#cfc9bd', sub: '#7d7869', accent: '#c0915a', annBg: '#262932' },
    { id: 'ink', name: '墨黑', bg: '#0a0a0e', paper: '#131319', text: '#b9b4ab', sub: '#6f6a78', accent: '#8b9bff', annBg: '#1a1a24' },
];
const FONT_SIZES = [13, 15, 17, 20];
const READER_THEME_KEY = 'vr_reader_theme';
const READER_FONT_KEY = 'vr_reader_font';
const READER_MODE_KEY = 'vr_reader_mode'; // 'page' | 'scroll'
// 用户书签（段索引，per-novel，独立于角色书签）
const userBmKey = (id: string) => `vr_user_bm_${id}`;
const readUserBm = (id: string): number => {
    const v = Number(localStorage.getItem(userBmKey(id)));
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
};
const writeUserBm = (id: string, idx: number) => {
    try { localStorage.setItem(userBmKey(id), String(Math.max(0, idx))); } catch { /* ignore */ }
};

// 单段渲染（翻页/滚动共用）
const SegBlock: React.FC<{
    seg: { idx: number; text: string }; anns: VRNovelAnnotation[];
    theme: ReaderTheme; fontSize: number; nameOf: (id: string) => string | undefined; highlight?: boolean;
}> = ({ seg, anns, theme, fontSize, nameOf, highlight }) => (
    <div data-seg={seg.idx} className="mb-5 rounded-lg transition-colors" style={highlight ? { background: `${theme.accent}1f`, boxShadow: `0 0 0 2px ${theme.accent}66`, padding: '8px 10px', margin: '0 -10px 20px' } : undefined}>
        <p className="whitespace-pre-wrap" style={{ color: theme.text, fontSize, lineHeight: 1.9, textIndent: '2em' }}>{seg.text}</p>
        {anns.map(a => (
            <div key={a.id} className="mt-2 ml-2 rounded-lg px-3 py-2" style={{ background: theme.annBg, borderLeft: `3px solid ${theme.accent}` }}>
                <span className="font-bold" style={{ color: theme.accent, fontSize: fontSize - 3 }}>{nameOf(a.authorId) || a.authorName}</span>
                {a.targetAnnotationId && <span style={{ color: theme.sub, fontSize: fontSize - 3 }}> 回应</span>}
                <span style={{ color: theme.text, fontSize: fontSize - 3 }}>：{stripLeakedAttrs(a.content)}</span>
            </div>
        ))}
    </div>
);

const ReaderModal: React.FC<{ novel: VRWorldNovel; characters: CharacterProfile[]; onClose: () => void; initialSeg?: number; peek?: boolean; }> = ({ novel, characters, onClose, initialSeg, peek }) => {
    const PAGE_SIZE = 8;
    const total = novel.segments.length;
    // peek（查看某条批注）时落在 initialSeg，且全程不写用户书签
    const initialBm = useMemo(() => {
        const base = (initialSeg != null) ? initialSeg : readUserBm(novel.id);
        return Math.min(Math.max(0, base), Math.max(0, total - 1));
    }, [novel.id, total, initialSeg]);

    const [annotations, setAnnotations] = useState<VRNovelAnnotation[]>([]);
    const [themeId, setThemeId] = useState<string>(() => localStorage.getItem(READER_THEME_KEY) || 'paper');
    const [fontSize, setFontSize] = useState<number>(() => Number(localStorage.getItem(READER_FONT_KEY)) || 15);
    const [mode, setMode] = useState<'page' | 'scroll'>(() => (localStorage.getItem(READER_MODE_KEY) === 'scroll' ? 'scroll' : 'page'));
    const [showCtl, setShowCtl] = useState(false);

    // 翻页态
    const [page, setPage] = useState(() => Math.floor(initialBm / PAGE_SIZE));
    // 滚动态：窗口 [winStart, winEnd)，初始落在书签处
    const [winStart, setWinStart] = useState(() => initialBm);
    const [winEnd, setWinEnd] = useState(() => Math.min(total, initialBm + 30));
    const [topSeg, setTopSeg] = useState(initialBm);

    const scrollRef = useRef<HTMLDivElement>(null);
    const prevHeightRef = useRef<number | null>(null);
    const bmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => { void (async () => setAnnotations(await DB.getVRAnnotations(novel.id)))(); }, [novel.id]);
    useEffect(() => { localStorage.setItem(READER_THEME_KEY, themeId); }, [themeId]);
    useEffect(() => { localStorage.setItem(READER_FONT_KEY, String(fontSize)); }, [fontSize]);

    // 翻页：换页存书签 + 回顶（peek 模式不写书签）
    useEffect(() => {
        if (mode !== 'page') return;
        if (!peek) writeUserBm(novel.id, page * PAGE_SIZE);
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }, [page, mode, novel.id, peek]);

    // 滚动：prepend 后补偿滚动位置，避免跳动
    useLayoutEffect(() => {
        if (prevHeightRef.current != null && scrollRef.current) {
            const el = scrollRef.current;
            el.scrollTop += el.scrollHeight - prevHeightRef.current;
            prevHeightRef.current = null;
        }
    }, [winStart]);

    const switchMode = (m: 'page' | 'scroll') => {
        if (m === mode) return;
        if (m === 'scroll') {
            const bm = page * PAGE_SIZE;
            setWinStart(bm); setWinEnd(Math.min(total, bm + 30)); setTopSeg(bm);
        } else {
            setPage(Math.floor(readUserBm(novel.id) / PAGE_SIZE));
        }
        setMode(m);
        localStorage.setItem(READER_MODE_KEY, m);
    };

    const onScroll = () => {
        const el = scrollRef.current;
        if (!el || mode !== 'scroll') return;
        // 触底加载更多
        if (el.scrollTop + el.clientHeight > el.scrollHeight - 900 && winEnd < total) {
            setWinEnd(e => Math.min(total, e + 20));
        }
        // 触顶往回加载
        if (el.scrollTop < 400 && winStart > 0) {
            prevHeightRef.current = el.scrollHeight;
            setWinStart(s => Math.max(0, s - 20));
        }
        // 节流存书签（取顶部首个可见段）
        if (bmTimerRef.current) return;
        bmTimerRef.current = setTimeout(() => {
            bmTimerRef.current = null;
            const cur = scrollRef.current;
            if (!cur) return;
            const top = cur.scrollTop;
            const nodes = cur.querySelectorAll<HTMLElement>('[data-seg]');
            for (const n of Array.from(nodes)) {
                if (n.offsetTop + n.offsetHeight > top + 4) {
                    const idx = Number(n.dataset.seg);
                    setTopSeg(idx); if (!peek) writeUserBm(novel.id, idx);
                    break;
                }
            }
        }, 300);
    };

    const theme = READER_THEMES.find(t => t.id === themeId) || READER_THEMES[0];
    const annBySeg = useMemo(() => groupAnnotationsBySeg(annotations), [annotations]);
    const nameOf = (id: string) => characters.find(c => c.id === id)?.name;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const renderSegs = mode === 'page'
        ? novel.segments.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
        : novel.segments.slice(winStart, winEnd);

    return (
        <div className="fixed inset-0 z-50 flex flex-col" style={{ background: theme.bg }}>
            {/* 顶栏 */}
            <div className="flex items-center gap-2 px-4 pb-2 shrink-0" style={{ borderBottom: `1px solid ${theme.accent}22`, paddingTop: VR_TOP }}>
                <button onClick={onClose} className="p-1.5 -ml-1.5 rounded-full active:bg-black/5" style={{ color: theme.text }}><X size={20} weight="bold" /></button>
                <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-bold truncate" style={{ color: theme.text }}>{novel.title}</div>
                    <div className="text-[10px]" style={{ color: theme.sub }}>
                        {mode === 'page'
                            ? `第 ${page * PAGE_SIZE + 1}~${Math.min((page + 1) * PAGE_SIZE, total)} 段 / 共 ${total} 段`
                            : `读到第 ${topSeg + 1} 段 / 共 ${total} 段 · ${Math.round((topSeg / Math.max(1, total)) * 100)}%`}
                    </div>
                </div>
                <button onClick={() => setShowCtl(s => !s)} className="p-1.5 rounded-full active:bg-black/5" style={{ color: theme.accent }}><Palette size={18} weight="bold" /></button>
            </div>

            {peek && (
                <div className="px-4 py-1.5 shrink-0 text-[11px] text-center" style={{ background: `${theme.accent}1a`, color: theme.accent }}>
                    正在查看批注位置 · 不会改动你的书签
                </div>
            )}

            {/* 控制条：主题 / 字号 / 模式 */}
            {showCtl && (
                <div className="px-4 py-2.5 shrink-0 space-y-2.5" style={{ background: theme.paper, borderBottom: `1px solid ${theme.accent}22` }}>
                    <div className="flex items-center gap-2">
                        <Palette size={14} style={{ color: theme.sub }} />
                        <div className="flex gap-1.5 flex-1">
                            {READER_THEMES.map(t => (
                                <button key={t.id} onClick={() => setThemeId(t.id)}
                                    className="flex-1 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold transition-all"
                                    style={{ background: t.paper, color: t.text, border: themeId === t.id ? `2px solid ${t.accent}` : `1px solid ${t.accent}33` }}>
                                    {t.name}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <TextAa size={14} style={{ color: theme.sub }} />
                        <div className="flex gap-1.5 flex-1">
                            {FONT_SIZES.map(fs => (
                                <button key={fs} onClick={() => setFontSize(fs)}
                                    className="w-9 h-7 rounded-lg font-bold transition-all"
                                    style={{ background: fontSize === fs ? theme.accent : 'transparent', color: fontSize === fs ? theme.paper : theme.sub, border: `1px solid ${theme.accent}44`, fontSize: Math.min(fs, 15) }}>
                                    A
                                </button>
                            ))}
                        </div>
                        {/* 模式切换 */}
                        <div className="flex gap-1.5">
                            {(['page', 'scroll'] as const).map(m => (
                                <button key={m} onClick={() => switchMode(m)}
                                    className="px-2.5 h-7 rounded-lg text-[11px] font-bold transition-all"
                                    style={{ background: mode === m ? theme.accent : 'transparent', color: mode === m ? theme.paper : theme.sub, border: `1px solid ${theme.accent}44` }}>
                                    {m === 'page' ? '翻页' : '滚动'}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="text-[10px] leading-snug pt-0.5" style={{ color: theme.sub }}>书里的批注都是角色自己留的；你可以翻看，暂时还不能亲自写批注。</div>
                </div>
            )}

            {/* 正文 */}
            <div ref={scrollRef} onScroll={mode === 'scroll' ? onScroll : undefined}
                className="flex-1 overflow-y-auto vr-reader-scroll px-5 py-4" style={{ background: theme.bg, fontFamily: `'Noto Serif SC','Songti SC','Noto Serif','Georgia',serif` }}>
                {mode === 'scroll' && winStart > 0 && (
                    <div className="text-center text-[10px] mb-3" style={{ color: theme.sub }}>—— 上滑加载更早内容 ——</div>
                )}
                {renderSegs.map(seg => (
                    <SegBlock key={seg.idx} seg={seg} anns={annBySeg.get(seg.idx) || []} theme={theme} fontSize={fontSize} nameOf={nameOf} highlight={peek && seg.idx === initialSeg} />
                ))}
            </div>

            {/* 底栏 */}
            {mode === 'page' ? (
                <div className="flex items-center justify-between px-5 py-2.5 shrink-0" style={{ background: theme.paper, borderTop: `1px solid ${theme.accent}22`, paddingBottom: vrBottomPad('0.625rem') }}>
                    <button disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))} className="text-[12px] disabled:opacity-30 font-semibold" style={{ color: theme.accent }}>‹ 上一页</button>
                    <span className="text-[11px]" style={{ color: theme.sub }}>{page + 1} / {totalPages}</span>
                    <button disabled={page >= totalPages - 1} onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} className="text-[12px] disabled:opacity-30 font-semibold" style={{ color: theme.accent }}>下一页 ›</button>
                </div>
            ) : (
                <div className="flex items-center justify-center gap-4 px-5 py-2 shrink-0" style={{ background: theme.paper, borderTop: `1px solid ${theme.accent}22`, paddingBottom: vrBottomPad('0.5rem') }}>
                    <button onClick={() => { setWinStart(0); setWinEnd(Math.min(total, 30)); setTopSeg(0); if (scrollRef.current) scrollRef.current.scrollTop = 0; }}
                        className="text-[11px] font-semibold" style={{ color: theme.accent }}>↑ 从头</button>
                    <span className="text-[10px]" style={{ color: theme.sub }}>滚动阅读 · 自动记录位置</span>
                </div>
            )}
        </div>
    );
};

// ============ 上传弹窗（支持大文件 .txt，内容不入 DOM） ============
const UploadModal: React.FC<{
    onClose: () => void;
    onCommit: (novel: VRWorldNovel) => Promise<void> | void;
    onError: (msg: string) => void;
}> = ({ onClose, onCommit, onError }) => {
    const [title, setTitle] = useState('');
    const [author, setAuthor] = useState('');
    const [summary, setSummary] = useState('');
    // 手动粘贴的小段文本走 state；大文件内容只存 ref，不进 textarea（否则 12MB 会冻 UI）
    const [pasteText, setPasteText] = useState('');
    const [fileInfo, setFileInfo] = useState<{ name: string; chars: number; preview: string; encoding: string } | null>(null);
    const fileContentRef = useRef<string>('');
    // 留着原始字节，手动换编码时无需重新读盘即可重解码
    const fileBufRef = useRef<ArrayBuffer | null>(null);
    const [chosenEncoding, setChosenEncoding] = useState<string>('auto');
    const fileRef = useRef<HTMLInputElement>(null);
    const [reading, setReading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState(0);

    // 用某个编码（auto = 自动识别）解码当前缓存的字节并刷新预览
    const applyDecode = (name: string, buf: ArrayBuffer, enc: string) => {
        const { text: content, encoding } = decodeBytes(buf, enc === 'auto' ? undefined : enc);
        fileContentRef.current = content;
        setFileInfo({
            name,
            chars: content.length,
            preview: content.slice(0, 300).replace(/\s+/g, ' ').trim(),
            encoding,
        });
    };

    const onFile = async (f: File | undefined) => {
        if (!f) return;
        setReading(true);
        try {
            const buf = await f.arrayBuffer();
            fileBufRef.current = buf;
            setChosenEncoding('auto');
            applyDecode(f.name, buf, 'auto');
            setPasteText(''); // 文件优先，清掉粘贴框
            if (!title.trim()) setTitle(f.name.replace(/\.(txt|text)$/i, ''));
        } catch (e) {
            console.error('[VRWorld] decode file failed', e);
            onError('文件读取失败');
        } finally {
            setReading(false);
        }
    };

    // 手动换编码（乱码时用）：拿缓存字节重新解码，不必再选一遍文件
    const redecode = (enc: string) => {
        const buf = fileBufRef.current;
        if (!buf || !fileInfo) return;
        setChosenEncoding(enc);
        applyDecode(fileInfo.name, buf, enc);
    };

    const clearFile = () => {
        fileContentRef.current = '';
        fileBufRef.current = null;
        setChosenEncoding('auto');
        setFileInfo(null);
        if (fileRef.current) fileRef.current.value = '';
    };

    const totalChars = fileInfo ? fileInfo.chars : pasteText.length;
    const canSave = !!title.trim() && totalChars > 0 && !busy;

    const handleSave = async () => {
        const content = fileInfo ? fileContentRef.current : pasteText;
        if (!title.trim() || !content) { onError('书名和正文都要填'); return; }
        setBusy(true);
        setProgress(0);
        try {
            // 让出一帧，先让"处理中"渲染出来
            await new Promise<void>(r => setTimeout(r));
            const novel = await buildNovelAsync(title, content, {
                author, summary,
                onProgress: (r) => setProgress(Math.round(r * 100)),
            });
            if (novel.segments.length === 0) { onError('正文是空的'); setBusy(false); return; }
            await onCommit(novel);
        } catch (e) {
            console.error('[VRWorld] build novel failed', e);
            onError('处理失败，文件可能太大或格式异常');
            setBusy(false);
        }
    };

    const inkInput = { fontFamily: HAND, color: PAPER.ink, background: '#fffdf6', border: `1px solid ${PAPER.edge}` } as React.CSSProperties;
    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45" onClick={busy ? undefined : onClose}>
            <div className="w-full max-w-md rounded-t-2xl p-4 max-h-[88vh] overflow-y-auto vr-reader-scroll" style={{ background: PAPER.paper, borderTop: `2px solid ${PAPER.edge}`, paddingBottom: vrBottomPad('1rem') }} onClick={e => e.stopPropagation()}>
                <div className="flex items-center mb-3">
                    <span className="text-[15px] font-bold" style={{ fontFamily: HAND, color: PAPER.ink }}>📚 贴一本小说进来</span>
                    {!busy && <button onClick={onClose} className="ml-auto h-7 w-7 flex items-center justify-center rounded-lg" style={{ background: PAPER.cream, border: `1px solid ${PAPER.edge}`, color: PAPER.ink }}><X size={16} weight="bold" /></button>}
                </div>

                <input ref={fileRef} type="file" accept=".txt,text/plain" className="hidden" onChange={e => onFile(e.target.files?.[0])} />
                {reading ? (
                    <div className="w-full py-5 mb-3 flex items-center justify-center gap-2" style={{ fontFamily: HAND, color: PAPER.ink, border: `1px dashed ${PAPER.edge}`, borderRadius: 10 }}>
                        <CircleNotch size={18} weight="bold" className="animate-spin" /> 读取并识别编码中…
                    </div>
                ) : fileInfo ? (
                    <div className="p-3 mb-3" style={{ background: PAPER.cream, border: `1px solid ${PAPER.edge}`, borderRadius: 10 }}>
                        <div className="flex items-center gap-2">
                            <BookOpen size={16} weight="fill" className="shrink-0" style={{ color: ROOM_THEME.library.ink }} />
                            <span className="text-[12.5px] font-semibold truncate flex-1" style={{ color: PAPER.ink }}>{fileInfo.name}</span>
                            <span className="text-[8.5px] rounded px-1 uppercase" style={{ color: PAPER.inkSoft, border: `1px solid ${PAPER.edge}` }}>{fileInfo.encoding}</span>
                            {!busy && <button onClick={clearFile} className="p-1" style={{ color: PAPER.inkSoft }}><X size={14} /></button>}
                        </div>
                        <div className="text-[10px] mt-1" style={{ color: PAPER.inkSoft }}>{fileInfo.chars.toLocaleString()} 字 · 预计 ~{Math.ceil(fileInfo.chars / 400).toLocaleString()} 段</div>
                        <p className="text-[10.5px] mt-1.5 leading-snug line-clamp-2" style={{ color: PAPER.inkSoft }}>{fileInfo.preview}…</p>
                        {!busy && (
                            <div className="flex items-center gap-1.5 mt-2">
                                <span className="text-[9.5px] shrink-0" style={{ color: PAPER.inkSoft }}>乱码？换编码</span>
                                <select value={chosenEncoding} onChange={e => redecode(e.target.value)}
                                    className="flex-1 text-[10px] rounded px-1.5 py-1 outline-none" style={{ color: PAPER.ink, background: '#fffdf6', border: `1px solid ${PAPER.edge}` }}>
                                    <option value="auto">自动识别</option>
                                    <option value="utf-8">UTF-8</option>
                                    <option value="gb18030">简体中文 · GB18030 / GBK</option>
                                    <option value="big5">繁体中文 · Big5</option>
                                    <option value="shift_jis">日文 · Shift_JIS</option>
                                    <option value="euc-jp">日文 · EUC-JP</option>
                                </select>
                            </div>
                        )}
                    </div>
                ) : (
                    <button onClick={() => fileRef.current?.click()}
                        className="w-full py-3 mb-3 text-[12.5px] flex items-center justify-center gap-2 active:translate-y-px" style={{ fontFamily: HAND, color: PAPER.ink, border: `1.5px dashed ${PAPER.edge}`, borderRadius: 10, background: PAPER.cream }}>
                        <UploadSimple size={16} weight="bold" /> 选个 .txt 文件（大文件也 OK）
                    </button>
                )}

                <div className="space-y-2.5">
                    <input value={title} onChange={e => setTitle(e.target.value)} placeholder="书名（必填）" className="w-full rounded-lg px-3 py-2 text-[13px] outline-none" style={inkInput} />
                    <input value={author} onChange={e => setAuthor(e.target.value)} placeholder="作者（选填）" className="w-full rounded-lg px-3 py-2 text-[13px] outline-none" style={inkInput} />
                    <input value={summary} onChange={e => setSummary(e.target.value)} placeholder="一句话简介（选填，喂给角色当背景）" className="w-full rounded-lg px-3 py-2 text-[13px] outline-none" style={inkInput} />
                    {!fileInfo && (
                        <>
                            <div className="text-[10px]" style={{ color: PAPER.inkSoft }}>或直接粘贴正文（小段文本用；大文件请走上面的文件选择）↓</div>
                            <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} placeholder="粘贴正文…" rows={6}
                                className="w-full rounded-lg px-3 py-2 text-[12.5px] outline-none leading-relaxed" style={inkInput} />
                        </>
                    )}
                    <div className="text-[10px]" style={{ color: PAPER.inkSoft }}>{totalChars.toLocaleString()} 字</div>
                </div>

                {busy ? (
                    <div className="mt-3">
                        <div className="h-2 rounded-full overflow-hidden" style={{ background: PAPER.cream, border: `1px solid ${PAPER.edge}` }}>
                            <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: PAPER.red }} />
                        </div>
                        <div className="text-[11px] text-center mt-1.5" style={{ fontFamily: HAND, color: PAPER.inkSoft }}>处理中… {progress}%（大文件需要点时间）</div>
                    </div>
                ) : (
                    <InkBtn tone="ink" onClick={handleSave} disabled={!canSave} className="w-full mt-3 py-2.5 text-[13px] font-bold" style={{ borderRadius: 10 }}>
                        贴上书架
                    </InkBtn>
                )}
            </div>
        </div>
    );
};

// ============ chibi 形象编辑器（复用特别时光的捏人系统） ============
type ChibiSave = { img: string; state?: any; scale: number; offsetY: number; flip: boolean; pose?: string; sticker?: string; name?: string };

// 捏小人工作台：捏人器 + 微调（大小/翻转/姿势/贴纸）+ 换装夹（多套形象一键切换）。角色与用户共用。
const ChibiAtelier: React.FC<{
    mode: 'char' | 'user';
    name: string;
    isMoro?: boolean;
    draftKey: string;
    existing?: VRChibi;
    existingLooks?: VRChibi[];
    blurb: string;
    saveLabel: string;
    onClose: () => void;
    onSave: (chibi: ChibiSave, looks: ChibiSave[]) => void;
}> = ({ mode, name, isMoro, draftKey, existing, existingLooks, blurb, saveLabel, onClose, onSave }) => {
    const [creating, setCreating] = useState<boolean>(!existing?.img);
    const [img, setImg] = useState<string>(existing?.img || '');
    const [state, setState] = useState<any>(existing?.state);
    const [scale, setScale] = useState<number>(existing?.scale ?? 1);
    const [offsetY, setOffsetY] = useState<number>(existing?.offsetY ?? 0);
    const [flip, setFlip] = useState<boolean>(!!existing?.flip);
    const [pose, setPose] = useState<string>(existing?.pose || 'idle');
    const [sticker, setSticker] = useState<string>(existing?.sticker || '');
    const [looks, setLooks] = useState<ChibiSave[]>((existingLooks || []).map(l => ({ img: l.img, state: l.state, scale: l.scale ?? 1, offsetY: l.offsetY ?? 0, flip: !!l.flip, pose: l.pose, sticker: l.sticker, name: l.name })));

    const presets = state?.selected || existing?.state?.selected || (isMoro ? { skin: 'skin_1', fronthair: 'fronthair_99', eyes: 'eyes_99' } : undefined);
    const cur = (): ChibiSave => ({ img, state, scale, offsetY, flip, pose, sticker });
    const onConfirm = (r: ChibiResult) => { setImg(r.transparentDataUrl); setState(r.state); setScale(1); setOffsetY(0); setFlip(false); setCreating(false); };
    const loadLook = (l: ChibiSave) => { setImg(l.img); setState(l.state); setScale(l.scale); setOffsetY(l.offsetY); setFlip(l.flip); setPose(l.pose || 'idle'); setSticker(l.sticker || ''); };
    const stashLook = () => { if (!img) return; setLooks(ls => [...ls.filter(l => l.img !== img), cur()].slice(-8)); };
    const dropLook = (i: number) => setLooks(ls => ls.filter((_, k) => k !== i));

    if (creating) {
        return (
            <div className="fixed inset-0 z-[60] flex flex-col" style={{ background: PAPER.page }}>
                <div className="flex items-center gap-2 px-4 pb-2 shrink-0" style={{ paddingTop: VR_TOP, borderBottom: `1.5px dashed ${PAPER.line}` }}>
                    <button onClick={() => existing?.img ? setCreating(false) : onClose()} className="h-8 w-8 flex items-center justify-center rounded-lg active:translate-y-px" style={{ background: PAPER.paper, border: `1px solid ${PAPER.edge}`, color: PAPER.ink }}><CaretLeft size={18} weight="bold" /></button>
                    <span className="text-[15px]" style={{ fontFamily: HAND, fontWeight: 700, color: PAPER.ink }}>✂ 捏 {name} 的小人</span>
                </div>
                <div className="flex-1 min-h-0">
                    <CreatorIframe mode={mode} charName={name} isMoro={isMoro} presets={presets}
                        draftKey={draftKey} title={`捏一个小人 · ${name}`} subtitle="页外 · 拼贴小人"
                        onConfirm={onConfirm} />
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/45" onClick={onClose}>
            <VRStyleTag />
            <div className="w-full max-w-md rounded-t-2xl p-4 max-h-[92vh] overflow-y-auto vr-reader-scroll" style={{ background: PAPER.paper, borderTop: `2px solid ${PAPER.edge}`, paddingBottom: vrBottomPad('1rem') }} onClick={e => e.stopPropagation()}>
                <div className="flex items-center mb-1">
                    <span className="text-[15px]" style={{ fontFamily: HAND, fontWeight: 700, color: PAPER.ink }}>{name} 的页外小人</span>
                    <button onClick={onClose} className="ml-auto h-7 w-7 flex items-center justify-center rounded-lg" style={{ background: PAPER.cream, border: `1px solid ${PAPER.edge}`, color: PAPER.ink }}><X size={16} weight="bold" /></button>
                </div>
                <p className="text-[10.5px] mb-3" style={{ color: PAPER.inkSoft }}>{blurb}</p>

                {/* 拍立得预览 */}
                <div className="relative h-48 mb-3 flex items-end justify-center overflow-hidden" style={{ background: '#fffdf6', border: `1px solid ${PAPER.edge}`, borderRadius: 8 }}>
                    <Tape color={TAPE_COLORS[0]} w={56} style={{ top: -8, left: '50%', marginLeft: -28, transform: 'rotate(-4deg)' }} />
                    <div className="absolute inset-0" style={{ backgroundImage: `linear-gradient(${PAPER.line}55 1px, transparent 1px), linear-gradient(90deg, ${PAPER.line}44 1px, transparent 1px)`, backgroundSize: '18px 18px', opacity: .5 }} />
                    {sticker && <span className="absolute top-3 right-4 text-[22px]" style={{ animation: 'ywbob 2s ease-in-out infinite' }}>{sticker}</span>}
                    {img && <img src={img} alt="" className="object-contain mb-3 relative" style={{ height: 140 * scale, transform: `scaleX(${flip ? -1 : 1}) translateY(${offsetY}px)`, filter: 'drop-shadow(0 4px 6px rgba(90,70,40,.4))', animation: poseAnim(pose) }} />}
                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-[50%]" style={{ width: 76, height: 16, background: 'radial-gradient(ellipse,rgba(90,70,40,.4),transparent)' }} />
                </div>

                <InkBtn tone="soft" onClick={() => setCreating(true)} className="w-full py-2 mb-3 text-[12px] flex items-center justify-center gap-1.5">
                    <PencilSimple size={14} weight="bold" /> 重新捏 / 改五官衣服
                </InkBtn>

                {/* 大小 + 翻转 */}
                <div className="flex items-center gap-2 mb-2.5">
                    <span className="text-[11px] flex items-center gap-1" style={{ color: PAPER.inkSoft }}><UploadSimple size={13} className="rotate-90" /> 大小</span>
                    <input type="range" min={0.5} max={1.6} step={0.05} value={scale} onChange={e => setScale(Number(e.target.value))} className="flex-1" style={{ accentColor: PAPER.red }} />
                    <button onClick={() => setFlip(f => !f)} className="text-[11px] px-2.5 py-1 rounded-md flex items-center gap-1" style={{ fontFamily: HAND, background: flip ? PAPER.red : PAPER.cream, color: flip ? '#fff' : PAPER.ink, border: `1px solid ${PAPER.edge}` }}><FlipHorizontal size={12} /> 翻转</button>
                </div>

                {/* 姿势 */}
                <div className="mb-2.5">
                    <div className="text-[10px] mb-1.5 flex items-center gap-1" style={{ fontFamily: HAND, color: PAPER.inkSoft }}><HandWaving size={12} weight="bold" /> 姿势（在世界里怎么动）</div>
                    <div className="flex flex-wrap gap-1.5">
                        {POSE_LIST.map(p => (
                            <button key={p.key} onClick={() => setPose(p.key)} className="text-[11px] px-2.5 py-1 rounded-md" style={{ fontFamily: HAND, background: pose === p.key ? PAPER.ink : PAPER.cream, color: pose === p.key ? '#fbf3e0' : PAPER.ink, border: `1px solid ${PAPER.edge}` }}>{p.label}</button>
                        ))}
                    </div>
                </div>

                {/* 贴纸 */}
                <div className="mb-3">
                    <div className="text-[10px] mb-1.5 flex items-center gap-1" style={{ fontFamily: HAND, color: PAPER.inkSoft }}><Sticker size={12} weight="bold" /> 头顶贴纸</div>
                    <div className="flex flex-wrap gap-1.5">
                        {STICKER_CHOICES.map((s, i) => (
                            <button key={i} onClick={() => setSticker(s)} className="h-7 w-7 flex items-center justify-center rounded-md text-[14px]" style={{ background: sticker === s ? '#fff0c0' : PAPER.cream, border: `1px solid ${sticker === s ? PAPER.red : PAPER.edge}` }}>{s || '∅'}</button>
                        ))}
                    </div>
                </div>

                {/* 换装夹：多套形象 */}
                <div className="mb-3 p-2.5" style={{ background: PAPER.cream, border: `1.5px dashed ${PAPER.edge}`, borderRadius: 8 }}>
                    <div className="flex items-center mb-1.5">
                        <span className="text-[11px]" style={{ fontFamily: HAND, fontWeight: 700, color: PAPER.ink }}>👗 换装夹 · 存多套随时换</span>
                        <InkBtn tone="soft" onClick={stashLook} disabled={!img} className="ml-auto text-[10.5px] px-2 py-1 flex items-center gap-1"><Plus size={11} weight="bold" /> 存当前</InkBtn>
                    </div>
                    {looks.length === 0 ? (
                        <p className="text-[10px]" style={{ color: PAPER.inkFaint }}>把现在这套存进夹子，捏好几套后点缩略图就能一键换。</p>
                    ) : (
                        <div className="flex flex-wrap gap-2">
                            {looks.map((l, i) => (
                                <div key={i} className="relative">
                                    <button onClick={() => loadLook(l)} className="h-14 w-12 flex items-end justify-center overflow-hidden rounded-md active:translate-y-px" style={{ background: '#fffdf6', border: `1px solid ${l.img === img ? PAPER.red : PAPER.edge}` }}>
                                        <img src={l.img} alt="" className="h-12 object-contain object-bottom" style={{ transform: `scaleX(${l.flip ? -1 : 1})` }} />
                                    </button>
                                    <button onClick={() => dropLook(i)} className="absolute -top-1.5 -right-1.5 h-4 w-4 flex items-center justify-center rounded-full" style={{ background: PAPER.red, color: '#fff' }}><X size={9} weight="bold" /></button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <InkBtn tone="ink" onClick={() => { if (img) onSave(cur(), looks); }} disabled={!img} className="w-full py-2.5 text-[13px] font-bold" style={{ borderRadius: 10 }}>
                    {saveLabel}
                </InkBtn>
            </div>
        </div>
    );
};

const ChibiEditor: React.FC<{
    char: CharacterProfile;
    onClose: () => void;
    onSave: (chibi: ChibiSave, looks: ChibiSave[]) => void;
}> = ({ char, onClose, onSave }) => (
    <ChibiAtelier mode="char" name={char.name} isMoro={false}
        draftKey={`vr_${char.id}`} existing={char.vrState?.chibi} existingLooks={char.vrState?.chibiLooks}
        blurb="这个小人会站在页外的各个房间里。能换五官衣服、挑姿势、贴贴纸，还能存好几套随时换。"
        saveLabel={`保存形象${char.vrState?.enabled ? '' : ' 并接入'}`}
        onClose={onClose} onSave={onSave} />
);

// ============ 用户本人捏 chibi（mode="user"，结构同角色 chibi） ============
const UserChibiEditor: React.FC<{
    userName: string;
    existing?: VRChibi;
    existingLooks?: VRChibi[];
    onClose: () => void;
    onSave: (chibi: ChibiSave, looks: ChibiSave[]) => void;
}> = ({ userName, existing, existingLooks, onClose, onSave }) => (
    <ChibiAtelier mode="user" name={userName}
        draftKey="vr_user" existing={existing} existingLooks={existingLooks}
        blurb="这个小人就是「你」在页外里的化身，会站在你挂着的房间里。能挑姿势、贴贴纸，还能存好几套随时换。"
        saveLabel="保存形象"
        onClose={onClose} onSave={onSave} />
);

// ============ 用户本人接入页外面板（捏 chibi / 选房间 / 写在干嘛 / 广播） ============
const USER_VR_PRESETS = ['在世界房间晃悠', '在看小说', '在自习 / 刷题', '在听歌单曲循环', '单纯挂机放空', '在写漂流信'];
const UserVRPanel: React.FC<{
    userProfile?: UserProfile;
    updateUserProfile: (u: Partial<UserProfile>) => void;
    onEditChibi: () => void;
    onBroadcast: (room: VRRoomId, activity: string) => Promise<void> | void;
    addToast?: (m: string, t?: any) => void;
}> = ({ userProfile, updateUserProfile, onEditChibi, onBroadcast, addToast }) => {
    const uv = userProfile?.vrState;
    const enabled = !!uv?.enabled;
    const chibi = uv?.chibi;
    const [room, setRoom] = useState<VRRoomId>(uv?.currentRoom || 'guestbook');
    const [activity, setActivity] = useState(uv?.activity || '');

    // userProfile 外部变化（如刚捏完 chibi）时同步本地草稿
    useEffect(() => { setRoom(uv?.currentRoom || 'guestbook'); setActivity(uv?.activity || ''); }, [uv?.currentRoom, uv?.activity]);

    const ROOMS: [VRRoomId, string][] = [['plaza', '世界房间'], ['library', '图书馆'], ['music', '听歌房'], ['guestbook', '留言簿'], ['gym', '娱乐室'], ['postoffice', '邮局']];

    const join = () => {
        if (!chibi?.img) { onEditChibi(); return; } // 没捏小人 → 先捏，再回来开接入
        updateUserProfile({ vrState: { ...(uv || {}), enabled: true, currentRoom: room, activity: activity.trim(), updatedAt: Date.now() } });
        addToast?.('你已接入页外', 'success');
    };
    const logout = () => {
        updateUserProfile({ vrState: { ...(uv || {}), enabled: false } });
        addToast?.('已从页外登出', 'success'); // 登出后角色聊天里的"你在页外"提示随之消失
    };
    const saveBroadcast = () => {
        updateUserProfile({ vrState: { ...(uv || {}), enabled: true, currentRoom: room, activity: activity.trim(), updatedAt: Date.now() } });
        void onBroadcast(room, activity.trim());
    };
    const Toggle = ({ on, onClick }: { on: boolean; onClick: () => void }) => (
        <button onClick={onClick} className="relative w-11 h-6 rounded-full transition-colors" style={{ background: on ? PAPER.red : '#d8ccaf', border: `1px solid ${PAPER.edge}` }}>
            <span className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full transition-transform" style={{ background: '#fffdf6', transform: on ? 'translateX(20px)' : 'none', boxShadow: '0 1px 2px rgba(0,0,0,.3)' }} />
        </button>
    );

    return (
        <div className="relative p-3.5" style={{ background: '#eef1f8', border: `1px solid ${PAPER.edge}`, borderRadius: 12, boxShadow: '0 3px 0 rgba(120,100,60,.1)' }}>
            <Tape color={TAPE_COLORS[3]} w={50} style={{ top: -8, left: 18, transform: 'rotate(-6deg)' }} />
            <div className="flex items-center gap-2.5">
                <button onClick={onEditChibi} className="relative h-12 w-12 rounded-lg overflow-hidden flex items-end justify-center shrink-0 active:translate-y-px" style={{ background: '#fffdf6', border: `1px solid ${PAPER.edge}` }}>
                    {chibi?.img ? <img src={chibi.img} className="h-11 object-contain object-bottom" style={{ transform: `scaleX(${chibi.flip ? -1 : 1})` }} alt="" /> : <span className="text-lg mb-2" style={{ color: PAPER.inkFaint }}>＋</span>}
                    <span className="absolute bottom-0 right-0 rounded-tl-md p-0.5" style={{ background: PAPER.red }}><PencilSimple size={9} weight="bold" className="text-white" /></span>
                </button>
                <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-bold truncate" style={{ fontFamily: HAND, color: PAPER.ink }}>就是你 · {userProfile?.name || '我'}</div>
                    <div className="text-[10px]" style={{ color: PAPER.inkSoft }}>{enabled ? '已接入页外 · 角色能看到你在这儿' : chibi?.img ? '已捏形象 · 未接入' : '捏个自己的小人，接入页外'}</div>
                </div>
                <Toggle on={enabled} onClick={enabled ? logout : join} />
            </div>
            {enabled && (
                <>
                    <div className="mt-3 text-[10px] mb-1.5" style={{ fontFamily: HAND, color: PAPER.inkSoft }}>你挂在哪个房间</div>
                    <div className="flex flex-wrap gap-1.5">
                        {ROOMS.map(([rid, label]) => (
                            <button key={rid} onClick={() => setRoom(rid)} className="text-[10.5px] rounded-md px-2.5 py-1" style={{ fontFamily: HAND, fontWeight: 600, background: room === rid ? PAPER.ink : '#fffdf6', color: room === rid ? '#fbf3e0' : PAPER.ink, border: `1px solid ${PAPER.edge}` }}>
                                {label}
                            </button>
                        ))}
                    </div>
                    <div className="mt-3 text-[10px] mb-1.5" style={{ fontFamily: HAND, color: PAPER.inkSoft }}>你在干嘛（角色会看到）</div>
                    <input value={activity} onChange={e => setActivity(e.target.value)}
                        placeholder="例：在世界房间晃悠 / 在看小说 / 单纯挂机…"
                        className="w-full rounded-lg px-3 py-2 text-[12.5px] outline-none" style={{ fontFamily: HAND, color: PAPER.ink, background: '#fffdf6', border: `1px solid ${PAPER.edge}` }} />
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {USER_VR_PRESETS.map(p => (
                            <button key={p} onClick={() => setActivity(p)} className="text-[10px] rounded-full px-2 py-0.5 active:translate-y-px" style={{ color: PAPER.inkSoft, background: '#fffdf6', border: `1px solid ${PAPER.edge}` }}>{p}</button>
                        ))}
                    </div>
                    <InkBtn tone="ink" onClick={saveBroadcast} className="mt-3 w-full py-2 text-[12.5px] font-bold" style={{ borderRadius: 10 }}>
                        保存并广播给所有角色
                    </InkBtn>
                    <p className="text-[9.5px] mt-2 leading-relaxed" style={{ color: PAPER.inkFaint }}>角色聊天里会知道"你此刻在页外做什么"，但已明确告知 ta：这只是虚拟空间挂机、你本人不一定在线，一切以聊天记录为准。</p>
                </>
            )}
        </div>
    );
};

// ============ 接入设置 ============
const INTERVAL_OPTIONS = [60, 120, 180, 360, 720];
const SettingsView: React.FC<{
    characters: CharacterProfile[];
    updateCharacter: (id: string, updates: Partial<CharacterProfile>) => void;
    addToast?: (msg: string, type?: any) => void;
    novelCount: number; onReload: () => void;
    onRequestEnable: (char: CharacterProfile) => void;
    onEditChibi: (char: CharacterProfile) => void;
}> = ({ characters, updateCharacter, addToast, novelCount, onReload, onRequestEnable, onEditChibi }) => {
    const [pickFor, setPickFor] = useState<CharacterProfile | null>(null);
    const go = (room?: VRRoomId) => {
        if (!pickFor) return;
        VRScheduler.triggerNow(pickFor.id, room);
        addToast?.(`${pickFor.name} 正在登入页外…`, 'info');
        setTimeout(onReload, 4000);
        setPickFor(null);
    };

    const disable = (char: CharacterProfile) => {
        updateCharacter(char.id, { vrState: { ...(char.vrState || { intervalMinutes: VR_DEFAULT_INTERVAL_MIN }), enabled: false } as any });
        VRScheduler.stop(char.id);
    };
    const setInterval = (char: CharacterProfile, minutes: number) => {
        updateCharacter(char.id, { vrState: { ...(char.vrState || {}), enabled: char.vrState?.enabled ?? true, intervalMinutes: minutes } });
        if (char.vrState?.enabled) VRScheduler.start(char.id, minutes);
    };

    return (
        <div className="space-y-3">
            <p className="text-[11px] leading-relaxed" style={{ color: PAPER.inkSoft }}>
                打开开关，角色就会按设定的间隔自己翻进「页外」溜达——碰头、读书、贴便签、写信。每次活动会剪成一张动态贴回 ta 的聊天，也会被记忆收进去。
                {novelCount === 0 && <span style={{ color: PAPER.red }}> 书库还空着，想用图书馆先去贴一本。</span>}
            </p>
            {characters.length === 0 && <p className="text-[11px] py-4 text-center" style={{ fontFamily: HAND, color: PAPER.inkSoft }}>还没有角色。</p>}
            {characters.map(char => {
                const st = char.vrState;
                const enabled = !!st?.enabled;
                const interval = st?.intervalMinutes || VR_DEFAULT_INTERVAL_MIN;
                const chibi = getChibi(char);
                return (
                    <div key={char.id} className="relative p-3.5" style={{ background: PAPER.paper, border: `1px solid ${PAPER.edge}`, borderRadius: 12, boxShadow: '0 3px 0 rgba(120,100,60,.1)', transform: `rotate(${tiltOf(char.id, 0.7)}deg)` }}>
                        <div className="flex items-center gap-2.5">
                            {/* chibi 缩略 */}
                            <button onClick={() => onEditChibi(char)} className="relative h-12 w-12 rounded-lg overflow-hidden flex items-end justify-center shrink-0 active:translate-y-px" style={{ background: '#fffdf6', border: `1px solid ${PAPER.edge}` }}>
                                {chibi.img ? <img src={chibi.img} className="h-11 object-contain object-bottom" style={{ transform: `scaleX(${chibi.flip ? -1 : 1})` }} alt="" /> : <span className="text-lg mb-2" style={{ color: PAPER.inkFaint }}>？</span>}
                                <span className="absolute bottom-0 right-0 rounded-tl-md p-0.5" style={{ background: PAPER.red }}><PencilSimple size={9} weight="bold" className="text-white" /></span>
                            </button>
                            <div className="flex-1 min-w-0">
                                <div className="text-[13px] font-bold truncate" style={{ fontFamily: HAND, color: PAPER.ink }}>{char.name}</div>
                                {enabled ? <div className="text-[10px]" style={{ color: PAPER.inkSoft }}>每 {interval >= 60 ? `${interval / 60} 小时` : `${interval} 分`}翻进去一次</div>
                                    : <div className="text-[10px]" style={{ color: PAPER.inkFaint }}>{chibi.isFallback ? '未捏小人 · 未接入' : '未接入'}</div>}
                            </div>
                            <button onClick={() => enabled ? disable(char) : onRequestEnable(char)}
                                className="relative w-11 h-6 rounded-full transition-colors" style={{ background: enabled ? PAPER.red : '#d8ccaf', border: `1px solid ${PAPER.edge}` }}>
                                <span className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full transition-transform" style={{ background: '#fffdf6', transform: enabled ? 'translateX(20px)' : 'none', boxShadow: '0 1px 2px rgba(0,0,0,.3)' }} />
                            </button>
                        </div>
                        {enabled && (
                            <>
                                <div className="flex flex-wrap gap-1.5 mt-2.5">
                                    {INTERVAL_OPTIONS.map(opt => (
                                        <button key={opt} onClick={() => setInterval(char, opt)} className="text-[10.5px] rounded-md px-2.5 py-1" style={{ fontFamily: HAND, fontWeight: 600, background: interval === opt ? PAPER.ink : '#fffdf6', color: interval === opt ? '#fbf3e0' : PAPER.ink, border: `1px solid ${PAPER.edge}` }}>
                                            {opt >= 60 ? `${opt / 60}h` : `${opt}min`}
                                        </button>
                                    ))}
                                </div>
                                <button onClick={() => setPickFor(char)} className="mt-2.5 text-[11px] font-semibold flex items-center gap-1 active:opacity-70" style={{ fontFamily: HAND, color: PAPER.red }}>
                                    <Play size={12} weight="fill" /> 让 ta 现在去逛一次
                                </button>
                            </>
                        )}
                    </div>
                );
            })}
            <ActionSheet open={!!pickFor} title={pickFor ? `让 ${pickFor.name} 现在翻去哪个房间？` : ''}
                actions={[
                    { label: '🎲 随机一个房间', onClick: () => go() },
                    { label: '🎪 世界房间 · 碰头合影', onClick: () => go('plaza') },
                    ...(novelCount > 0 ? [{ label: '📖 图书馆 · 读书写批注', onClick: () => go('library') }] : []),
                    { label: '🎭 剧院 · 写剧本投稿', onClick: () => go('theater') },
                    { label: '🎧 听歌房 · 点歌锐评', onClick: () => go('music') },
                    { label: '📌 留言簿 · 贴便签版聊', onClick: () => go('guestbook') },
                    { label: '🎮 娱乐室 · 放开玩', onClick: () => go('gym') },
                    { label: '✉️ 邮局 · 写漂流信', onClick: () => go('postoffice') },
                ]} onClose={() => setPickFor(null)} />
        </div>
    );
};

// ============ 页外 · API 设置 + 调用记录 ============
const VRApiSettings: React.FC<{ apiPresets: ApiPreset[]; chatApi: APIConfig; addToast?: (m: string, t?: any) => void }> = ({ apiPresets, chatApi, addToast }) => {
    const [vrApi, setVr] = useState<APIConfig | null>(null);
    const [log, setLog] = useState<VRApiCall[]>([]);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<string | null>(null);
    const [presetsOpen, setPresetsOpen] = useState(false);   // 折叠「保存的预设」长列表

    useEffect(() => {
        void getVRApi().then(setVr);
        void getVRApiLog().then(setLog);
        const h = () => { void getVRApiLog().then(setLog); };
        window.addEventListener('vr-api-log', h);
        return () => window.removeEventListener('vr-api-log', h);
    }, []);

    const follow = !vrApi?.baseUrl;
    const effective = follow ? chatApi : vrApi!;
    const sameAs = (c: APIConfig) => !follow && vrApi!.baseUrl === c.baseUrl && vrApi!.model === c.model && vrApi!.apiKey === c.apiKey;
    const host = (u?: string) => { try { return u ? new URL(u).host : '—'; } catch { return u || '—'; } };

    const choose = (cfg: APIConfig | null) => {
        void setVRApi(cfg); setVr(cfg); setTestResult(null);
        addToast?.(cfg ? '已切换页外 API' : '页外改为跟随聊天默认', 'success');
    };

    const test = async () => {
        const cfg = effective;
        if (!cfg?.baseUrl) { setTestResult('当前没有可用的 API'); return; }
        setTesting(true); setTestResult(null);
        try {
            const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey || 'sk-none'}` },
                body: JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 5, stream: false }),
            });
            if (res.ok) { const d = await safeResponseJson(res); const r = d.choices?.[0]?.message?.content || ''; setTestResult(`连接成功 — 模型回复:"${r.slice(0, 24)}"`); }
            else { const t = await res.text().catch(() => ''); setTestResult(`HTTP ${res.status}: ${t.slice(0, 80)}`); }
        } catch (e: any) { setTestResult(`连接失败: ${e.message}`); } finally { setTesting(false); }
    };

    const okCount = log.filter(l => l.ok).length;

    return (
        <div className="space-y-3">
            <p className="text-[11px] leading-relaxed" style={{ color: PAPER.inkSoft }}>
                页外里的角色会自主、按间隔翻进去触发模型调用，比较费 API。你可以在这里给页外<b style={{ color: PAPER.red }}>单独指定一份 API</b>（和「文具盒」里保存的预设共用同一批），不设则跟随聊天默认。
            </p>

            {/* 当前生效 */}
            <div className="relative p-3.5" style={{ background: PAPER.paper, border: `1px solid ${PAPER.edge}`, borderRadius: 12, boxShadow: '0 3px 0 rgba(120,100,60,.1)' }}>
                <Tape color={TAPE_COLORS[1]} w={44} style={{ top: -8, left: 16, transform: 'rotate(-5deg)' }} />
                <div className="text-[11px] mb-1.5" style={{ fontFamily: HAND, fontWeight: 700, color: PAPER.ink }}>📍 当前生效</div>
                <div className="text-[12.5px] font-semibold" style={{ color: PAPER.ink }}>{effective?.model || '未配置'}</div>
                <div className="text-[10px] mt-0.5" style={{ color: PAPER.inkSoft }}>{host(effective?.baseUrl)} · {follow ? '跟随聊天默认' : '页外独立'}</div>
                <InkBtn tone="soft" onClick={test} disabled={testing} className="mt-2.5 text-[11px] px-3 py-1.5 font-semibold">
                    {testing ? '测试中…' : '测试连接'}
                </InkBtn>
                {testResult && <div className="mt-2 text-[10.5px] px-2.5 py-1.5 rounded-lg leading-snug" style={{ color: testResult.startsWith('连接成功') ? PAPER.teal : PAPER.red, background: PAPER.cream, border: `1px solid ${PAPER.edge}` }}>{testResult}</div>}
            </div>

            {/* 选择 API */}
            <div>
                <div className="text-[11px] mb-1.5 px-0.5" style={{ fontFamily: HAND, fontWeight: 700, color: PAPER.ink }}>选择页外 API</div>
                <button onClick={() => choose(null)}
                    className="w-full flex items-center gap-2 p-3 mb-1.5 text-left active:translate-y-px"
                    style={{ background: follow ? '#fff0c0' : PAPER.paper, border: `1px solid ${follow ? PAPER.red : PAPER.edge}`, borderRadius: 10 }}>
                    <div className="flex-1 min-w-0">
                        <div className="text-[12px] font-semibold" style={{ color: PAPER.ink }}>跟随聊天默认</div>
                        <div className="text-[10px] truncate" style={{ color: PAPER.inkSoft }}>{chatApi?.model || '未配置'} · {host(chatApi?.baseUrl)}</div>
                    </div>
                    {follow && <span className="text-[10px] font-bold shrink-0" style={{ color: PAPER.red }}>✓ 使用中</span>}
                </button>
                {apiPresets.length === 0 ? (
                    <p className="text-[10.5px] px-1 py-1.5" style={{ color: PAPER.inkSoft }}>「文具盒」里还没有保存的 API 预设。去文具盒里保存几个模型，这里就能选。</p>
                ) : (() => {
                    const activePreset = apiPresets.find(p => sameAs(p.config));
                    const shown = presetsOpen ? apiPresets : (activePreset ? [activePreset] : []);
                    return (
                        <>
                            <button onClick={() => setPresetsOpen(o => !o)}
                                className="w-full flex items-center gap-2 px-2.5 py-1.5 mb-1.5 text-left active:translate-y-px"
                                style={{ border: `1px solid ${PAPER.edge}`, borderRadius: 8, background: PAPER.cream }}>
                                <span className="text-[10.5px]" style={{ color: PAPER.inkSoft }}>保存的预设</span>
                                <span className="text-[9.5px] rounded-full px-1.5 leading-tight" style={{ color: PAPER.ink, background: '#fff3c4', border: `1px solid ${PAPER.edge}` }}>{apiPresets.length}</span>
                                {!presetsOpen && activePreset && <span className="text-[9.5px] truncate" style={{ color: PAPER.red }}>当前 · {activePreset.name}</span>}
                                <span className="ml-auto text-[10px]" style={{ color: PAPER.inkSoft }}>{presetsOpen ? '收起' : '展开'}</span>
                            </button>
                            {shown.map(p => {
                                const on = sameAs(p.config);
                                return (
                                    <button key={p.id} onClick={() => choose(p.config)}
                                        className="w-full flex items-center gap-2 p-3 mb-1.5 text-left active:translate-y-px"
                                        style={{ background: on ? '#fff0c0' : PAPER.paper, border: `1px solid ${on ? PAPER.red : PAPER.edge}`, borderRadius: 10 }}>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-[12px] font-semibold truncate" style={{ color: PAPER.ink }}>{p.name}</div>
                                            <div className="text-[10px] truncate" style={{ color: PAPER.inkSoft }}>{p.config.model} · {host(p.config.baseUrl)}</div>
                                        </div>
                                        {on && <span className="text-[10px] font-bold shrink-0" style={{ color: PAPER.red }}>✓ 使用中</span>}
                                    </button>
                                );
                            })}
                        </>
                    );
                })()}
            </div>

            {/* 调用记录 */}
            <div className="p-3" style={{ background: PAPER.cream, border: `1px solid ${PAPER.edge}`, borderRadius: 12 }}>
                <div className="flex items-center gap-1.5 mb-2">
                    <span className="text-[11px]" style={{ fontFamily: HAND, fontWeight: 700, color: PAPER.ink }}>🧾 调用记录</span>
                    <span className="text-[9.5px] rounded-full px-1.5 leading-tight" style={{ color: PAPER.ink, background: '#fff3c4', border: `1px solid ${PAPER.edge}` }}>{log.length}{log.length ? ` · 成功${okCount}` : ''}</span>
                    {log.length > 0 && <button onClick={() => { void clearVRApiLog(); setLog([]); }} className="ml-auto text-[10px]" style={{ color: PAPER.red }}>清空</button>}
                </div>
                {log.length === 0 ? (
                    <p className="text-[10.5px] py-2 text-center" style={{ color: PAPER.inkSoft }}>还没有调用。角色每次翻进页外触发的模型调用都会记在这里，方便你对账。</p>
                ) : (
                    <div className="space-y-1">
                        {log.slice(0, 60).map((l, i) => (
                            <div key={i} className="flex items-center gap-2 text-[10.5px] py-1" style={{ borderBottom: i < Math.min(59, log.length - 1) ? `1px dashed ${PAPER.line}` : 'none' }}>
                                <span className="shrink-0" style={{ color: l.ok ? PAPER.teal : PAPER.red }}>{l.ok ? '●' : '○'}</span>
                                <span className="truncate" style={{ color: PAPER.ink }}>{l.charName || '—'}</span>
                                <span className="shrink-0" style={{ color: PAPER.inkFaint }}>{l.room ? getRoom(l.room as VRRoomId).name : ''}</span>
                                <span className="ml-auto shrink-0 tabular-nums" style={{ color: PAPER.inkFaint }}>{(l.ms / 1000).toFixed(1)}s</span>
                                <span className="shrink-0 tabular-nums w-[68px] text-right" style={{ color: PAPER.inkFaint }}>{new Date(l.ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

// ============ 动画关键帧 + 拼贴质感 ============
const VRStyleTag: React.FC = () => (
    <style>{`
        @keyframes vrfloat { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
        @keyframes vrwave { from { transform: scaleY(0.5); } to { transform: scaleY(1.05); } }
        @keyframes vrdance { 0%{transform:translateY(0) rotate(-5deg)} 25%{transform:translateY(-9px) rotate(3deg)} 50%{transform:translateY(0) rotate(5deg)} 75%{transform:translateY(-9px) rotate(-3deg)} 100%{transform:translateY(0) rotate(-5deg)} }
        @keyframes vraurora { 0%,100%{transform:translate(0,0) scale(1);opacity:.55} 50%{transform:translate(6%,4%) scale(1.12);opacity:.8} }
        @keyframes vrtwinkle { 0%,100%{opacity:.35} 50%{opacity:.7} }
        @keyframes ywbob { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-4px)} }
        @keyframes ywwiggle { 0%,100%{transform:rotate(-5deg)} 50%{transform:rotate(5deg)} }
        @keyframes ywjump { 0%,100%{transform:translateY(0)} 35%{transform:translateY(-14px)} 55%{transform:translateY(0)} }
        @keyframes ywspin { 0%{transform:rotateY(0)} 100%{transform:rotateY(360deg)} }
        @keyframes ywnod { 0%,100%{transform:rotate(0)} 50%{transform:rotate(8deg)} }
        @keyframes ywpop { 0%{transform:scale(.8);opacity:0} 60%{transform:scale(1.06)} 100%{transform:scale(1);opacity:1} }
        @keyframes ywdrift { 0%{transform:translateY(0) rotate(0)} 50%{transform:translateY(8px) rotate(8deg)} 100%{transform:translateY(0) rotate(0)} }
        .yw-scroll::-webkit-scrollbar { width: 7px; height: 7px; }
        .yw-scroll::-webkit-scrollbar-thumb { background: rgba(150,130,90,.4); border-radius: 6px; }
        .yw-scroll::-webkit-scrollbar-track { background: transparent; }
        .vr-reader-scroll::-webkit-scrollbar { width: 7px; height: 7px; }
        .vr-reader-scroll::-webkit-scrollbar-thumb { background: rgba(150,130,90,.4); border-radius: 6px; }
    `}</style>
);

export default VRWorldApp;
