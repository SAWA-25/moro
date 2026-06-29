import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CharacterProfile, UserProfile, Message, SocialPost, GalleryImage, Anniversary, AppID, PhoneCallLog, Task, TakeoutOrder, OSTheme, TwitterTweet, TwitterDMThread } from '../../types';
import { DB } from '../../utils/db';
import { resolveCart, cartTotal, expandCart, makeOwnedItem, makeReceipt, formatPrice as fmtPrice } from '../../utils/shop';
import { safeResponseJson, extractContent } from '../../utils/safeApi';
import { initUnblockAppeal } from '../../utils/unblockAppeal';
import { recordCharUnlockFail } from '../../utils/lockAttempts';
import { INSTALLED_APPS, DOCK_APPS } from '../../constants';
import { useOS } from '../../context/OSContext';
import AppIcon from '../os/AppIcon';
import { liveTakeoutStatus, STATUS_LABEL } from '../../utils/takeout';
import { isDevDebugAvailable } from '../../utils/devDebug';
import { getTwitterLocalTargetLang, getTwitterTranslationText } from '../../utils/twitterFeed';

/**
 * 角色查岗用户手机（反向查岗）。
 *
 * 会话设置「允许 char 看手机」开启时，角色会在聊天间隙主动拿走用户的手机翻看：
 * 界面变成用户的桌面，由 AI 生成的"浏览脚本"驱动角色一步步点开 App（仿真人查
 * 手机/桌面远程画面），每一步左下角弹出角色此刻的想法框。在聊天 App 里角色能看到
 * 真实的消息列表与对话记录，并可按人设决定：代替用户回复 / 拉黑 / 删好友 / 无视。
 *
 * 用户可点右上角申请退出，但必须 征得对方同意 / 回答角色出的三个问题 / 强制退出
 * 才能解除。全程行为合成一条 system 消息进入上下文，结束后由宿主触发角色主动发消息。
 *
 * 注：脚本里的「删好友」出于数据安全实际执行的是拉黑（聊天记录与角色不真删），
 * 在记录里如实标注，角色行为语义不变。
 */

type StepApp =
    | 'home'
    | 'chat-list'
    | 'chat-thread'
    | 'moments'
    | 'twitter'
    | 'schedule'
    | 'gallery'
    | 'music'
    | 'phone'
    | 'shop'
    | 'takeout'
    | 'wallet'
    | 'browser'
    | 'map';

interface ScriptAction {
    // reply/block/delete/ignore 作用在 chat-thread；post_moment 作用在 moments（代发朋友圈）；
    // clear_cart 作用在 shop（帮用户清空购物车·代付）
    type: 'none' | 'reply' | 'block' | 'delete' | 'ignore' | 'post_moment' | 'clear_cart';
    content?: string;
}

interface ScriptStep {
    app: StepApp;
    targetName?: string;
    thought: string;
    action?: ScriptAction;
}

interface CheckScript {
    steps: ScriptStep[];
    exitQuestions: string[];
    endHint?: string;
}

interface ContactSnap {
    char: CharacterProfile;
    preview: string;
    lastAt: number;
}

interface LocationSnap {
    source: string;
    title: string;
    detail?: string;
    at: number;
}

interface CharPhoneCheckOverlayProps {
    char: CharacterProfile;            // 正在查岗的角色
    userProfile: UserProfile;
    characters: CharacterProfile[];    // 全部联系人（含 char 自己）
    apiConfig: { baseUrl: string; apiKey: string; model: string };
    updateCharacter: (id: string, updates: Partial<CharacterProfile>) => Promise<void> | void;
    updateUserProfile: (updates: Partial<UserProfile>) => void;
    addToast: (msg: string, type: 'info' | 'success' | 'error') => void;
    /** 结束（记录已落库）。exitMode 用于宿主提示文案 */
    onEnd: (exitMode: 'consent' | 'questions' | 'forced' | 'finished') => void;
}

const STEP_MS = 6500;            // 每一步停留时长（想法框阅读时间）
const TAP_MS = 950;              // 「点开 App」动画时长：先回桌面按图标，再进入页面
// 浏览步骤 → 桌面图标（点开动画里高亮哪个图标）
const STEP_ICON: Record<Exclude<StepApp, 'home'>, string> = {
    'chat-list': 'Chat',
    'chat-thread': 'Chat',
    'moments': 'Social',
    'twitter': 'Twitter',
    'schedule': 'Almanac',
    'gallery': 'Gallery',
    'music': 'Music',
    'phone': 'Phone',
    'shop': 'Shop',
    'takeout': 'Takeout',
    'wallet': 'Bank',
    'browser': 'HotNews',
    'map': 'Social',
};

const STEP_LABEL: Record<StepApp, string> = {
    home: '桌面',
    'chat-list': '聊天列表',
    'chat-thread': '聊天记录',
    moments: '此刻',
    twitter: '推特',
    schedule: '日程',
    gallery: '相册',
    music: '音乐',
    phone: '电话',
    shop: '心意铺',
    takeout: '饭票',
    wallet: '钱包',
    browser: '浏览',
    map: '地区',
};

// 与 Launcher 同源的桌面布局持久化 key：角色看到的就是用户真实排列的桌面
const DESK_ORDER_KEY = 'moro_desktop_items_v1';
const DESK_LAYOUT_KEY = 'moro_desktop_layout_v2';
const DESK_ACTIVE_PAGE_KEY = 'moro_desktop_active_page_v1';
const LEGACY_APP_ORDER_KEY = 'moro_launcher_app_order';
const PAGE_COLS = 4;
const PAGE_ROWS = 12;

interface DeskItem {
    key: string;
    kind: 'app' | 'widget';
    id: string;
    w: number;
    h: number;
}

interface PlacedDeskItem {
    item: DeskItem;
    col: number;
    row: number;
}

interface DeskLayoutCell {
    page: number;
    col: number;
    row: number;
}

interface UserDesktopSnapshot {
    pages: PlacedDeskItem[][];
    activePage: number;
}

const readStoredStringArray = (key: string): string[] => {
    try {
        if (typeof localStorage === 'undefined') return [];
        const raw = JSON.parse(localStorage.getItem(key) || '[]');
        return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
    } catch { return []; }
};

const loadStoredDeskOrder = () => readStoredStringArray(DESK_ORDER_KEY);
const loadStoredAppOrder = () => readStoredStringArray(LEGACY_APP_ORDER_KEY);

const loadStoredActiveDeskPage = (): number => {
    try {
        if (typeof sessionStorage === 'undefined') return 0;
        const n = Number(sessionStorage.getItem(DESK_ACTIVE_PAGE_KEY) || 0);
        return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
    } catch { return 0; }
};

const loadStoredDeskLayout = (): Record<string, DeskLayoutCell> => {
    try {
        if (typeof localStorage === 'undefined') return {};
        const raw = JSON.parse(localStorage.getItem(DESK_LAYOUT_KEY) || '{}');
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
        const out: Record<string, DeskLayoutCell> = {};
        for (const [key, value] of Object.entries(raw)) {
            if (!value || typeof value !== 'object') continue;
            out[key] = {
                page: Math.max(0, Math.round(Number((value as any).page ?? 0))),
                col: Math.max(0, Math.min(PAGE_COLS - 1, Math.round(Number((value as any).col ?? 0)))),
                row: Math.max(0, Math.min(PAGE_ROWS - 1, Math.round(Number((value as any).row ?? 0)))),
            };
        }
        return out;
    } catch { return {}; }
};

const loadUserDesktopApps = () => {
    const base = INSTALLED_APPS.filter(a =>
        !DOCK_APPS.includes(a.id) &&
        (a.id !== AppID.CharCreatorDev || isDevDebugAvailable())
    );
    const legacyIds = loadStoredAppOrder();
    const ordered: typeof INSTALLED_APPS = [];
    for (const id of legacyIds) {
        const app = base.find(a => a.id === id);
        if (app && !ordered.includes(app)) ordered.push(app);
    }
    for (const app of base) {
        if (!ordered.includes(app)) ordered.push(app);
    }
    return ordered;
};

const buildDefaultKeys = (appKeys: string[], widgetKeys: Set<string>): string[] => {
    const mid = ['widget:schedule', 'widget:music', 'widget:image', 'widget:imgtl', 'widget:imgtr', 'widget:imgwide']
        .filter(k => widgetKeys.has(k));
    return ['widget:clock', 'widget:weather', 'widget:character', ...appKeys.slice(0, 8), ...mid, ...appKeys.slice(8)];
};

const buildDesktopItems = (theme: OSTheme): DeskItem[] => {
    const desktopApps = loadUserDesktopApps();
    const lw = theme.launcherWidgets || {};
    const prefs = theme.desktopWidgetPrefs || {};
    const clampW = (n: number) => Math.max(1, Math.min(PAGE_COLS, Math.round(n)));
    const clampH = (n: number) => Math.max(1, Math.min(PAGE_ROWS, Math.round(n)));
    const widgetItems: DeskItem[] = ([
        { key: 'widget:clock', kind: 'widget', id: 'clock', w: 2, h: 6 },
        { key: 'widget:weather', kind: 'widget', id: 'weather', w: 2, h: 3 },
        { key: 'widget:character', kind: 'widget', id: 'character', w: 4, h: 2 },
        { key: 'widget:schedule', kind: 'widget', id: 'schedule', w: 4, h: 5 },
        { key: 'widget:music', kind: 'widget', id: 'music', w: 2, h: 4 },
        { key: 'widget:image', kind: 'widget', id: 'image', w: 2, h: 4 },
        { key: 'widget:text', kind: 'widget', id: 'text', w: 2, h: 2 },
        ...(lw['tl'] ? [{ key: 'widget:imgtl', kind: 'widget' as const, id: 'imgtl', w: 2, h: 4 }] : []),
        ...(lw['tr'] ? [{ key: 'widget:imgtr', kind: 'widget' as const, id: 'imgtr', w: 2, h: 4 }] : []),
        ...(lw['wide'] ? [{ key: 'widget:imgwide', kind: 'widget' as const, id: 'imgwide', w: 4, h: 3 }] : []),
    ] as DeskItem[])
        .filter(it => !prefs[it.id]?.hidden)
        .map(it => {
            const p = prefs[it.id];
            return p ? { ...it, w: p.w ? clampW(p.w) : it.w, h: p.h ? clampH(p.h) : it.h } : it;
        });
    const appItems: DeskItem[] = desktopApps.map(a => ({ key: `app:${a.id}`, kind: 'app', id: a.id, w: 1, h: 2 }));
    const byKey = new Map<string, DeskItem>();
    for (const it of [...widgetItems, ...appItems]) byKey.set(it.key, it);

    const ordered: DeskItem[] = [];
    for (const key of loadStoredDeskOrder()) {
        const item = byKey.get(key);
        if (item) {
            ordered.push(item);
            byKey.delete(key);
        }
    }
    const defaults = buildDefaultKeys(appItems.map(i => i.key), new Set(widgetItems.map(i => i.key)));
    for (const key of defaults) {
        const item = byKey.get(key);
        if (item) {
            ordered.push(item);
            byKey.delete(key);
        }
    }
    for (const item of byKey.values()) ordered.push(item);
    return ordered;
};

const cellsOverlap = (a: DeskLayoutCell, aw: number, ah: number, b: DeskLayoutCell, bw: number, bh: number) => (
    a.page === b.page &&
    a.col < b.col + bw &&
    a.col + aw > b.col &&
    a.row < b.row + bh &&
    a.row + ah > b.row
);

const clampPlacement = (item: DeskItem, page: number, col: number, row: number): DeskLayoutCell => ({
    page: Math.max(0, Math.round(page)),
    col: Math.max(0, Math.min(PAGE_COLS - item.w, Math.round(col))),
    row: Math.max(0, Math.min(PAGE_ROWS - item.h, Math.round(row))),
});

const findFirstFreeSpot = (
    item: DeskItem,
    itemsByKey: Map<string, DeskItem>,
    layout: Record<string, DeskLayoutCell>,
    excludedKey: string,
    pageStart = 0,
): DeskLayoutCell => {
    for (let page = Math.max(0, pageStart); page < Math.max(pageStart + 8, 24); page++) {
        for (let row = 0; row <= PAGE_ROWS - item.h; row++) {
            for (let col = 0; col <= PAGE_COLS - item.w; col++) {
                const candidate: DeskLayoutCell = { page, col, row };
                let blocked = false;
                for (const [otherKey, otherItem] of itemsByKey.entries()) {
                    if (otherKey === excludedKey) continue;
                    const otherPos = layout[otherKey];
                    if (!otherPos) continue;
                    if (cellsOverlap(candidate, item.w, item.h, otherPos, otherItem.w, otherItem.h)) {
                        blocked = true;
                        break;
                    }
                }
                if (!blocked) return candidate;
            }
        }
    }
    return { page: Math.max(0, pageStart), col: 0, row: 0 };
};

const buildDefaultDeskLayout = (items: DeskItem[], orderedKeys: string[]): Record<string, DeskLayoutCell> => {
    const itemsByKey = new Map(items.map(item => [item.key, item]));
    const layout: Record<string, DeskLayoutCell> = {};
    for (const key of orderedKeys) {
        const item = itemsByKey.get(key);
        if (!item) continue;
        layout[key] = findFirstFreeSpot(item, itemsByKey, layout, key, 0);
    }
    return layout;
};

const normalizeDeskLayout = (items: DeskItem[], stored: Record<string, DeskLayoutCell>, orderedKeys: string[]): Record<string, DeskLayoutCell> => {
    const itemsByKey = new Map(items.map(item => [item.key, item]));
    const next: Record<string, DeskLayoutCell> = {};
    for (const key of orderedKeys) {
        const item = itemsByKey.get(key);
        if (!item) continue;
        const raw = stored[key];
        const desired = raw ? clampPlacement(item, raw.page, raw.col, raw.row) : null;
        if (desired) {
            let blocked = false;
            for (const [otherKey, otherPos] of Object.entries(next)) {
                const otherItem = itemsByKey.get(otherKey);
                if (otherItem && cellsOverlap(desired, item.w, item.h, otherPos, otherItem.w, otherItem.h)) {
                    blocked = true;
                    break;
                }
            }
            if (!blocked) {
                next[key] = desired;
                continue;
            }
        }
        next[key] = findFirstFreeSpot(item, itemsByKey, next, key, desired?.page ?? 0);
    }
    return next;
};

const layoutToPages = (items: DeskItem[], layout: Record<string, DeskLayoutCell>, orderedKeys: string[]): PlacedDeskItem[][] => {
    const itemsByKey = new Map(items.map(item => [item.key, item]));
    const orderIndex = new Map(orderedKeys.map((key, index) => [key, index]));
    const maxPage = Math.max(0, ...Object.values(layout).map(cell => cell.page));
    const pages: PlacedDeskItem[][] = Array.from({ length: maxPage + 1 }, () => []);
    for (const [key, cell] of Object.entries(layout)) {
        const item = itemsByKey.get(key);
        if (!item) continue;
        if (!pages[cell.page]) pages[cell.page] = [];
        pages[cell.page].push({ item, col: cell.col, row: cell.row });
    }
    return pages.map(page =>
        page.sort((a, b) =>
            a.row - b.row ||
            a.col - b.col ||
            ((orderIndex.get(a.item.key) ?? 0) - (orderIndex.get(b.item.key) ?? 0))
        )
    );
};

const buildUserDesktopSnapshot = (theme: OSTheme): UserDesktopSnapshot => {
    const items = buildDesktopItems(theme);
    const keys = items.map(item => item.key);
    const storedLayout = loadStoredDeskLayout();
    const layout = Object.keys(storedLayout).length > 0
        ? normalizeDeskLayout(items, storedLayout, keys)
        : buildDefaultDeskLayout(items, keys);
    const pages = layoutToPages(items, layout, keys);
    const safePages = pages.length > 0 ? pages : [[]];
    const activePage = Math.max(0, Math.min(safePages.length - 1, loadStoredActiveDeskPage()));
    return { pages: safePages, activePage };
};

/** 壁纸值 → CSS background（与 PhoneShell 的处理一致：链接/dataURL 包 url()，渐变原样用） */
const wallpaperBackground = (wallpaper?: string): React.CSSProperties => {
    if (!wallpaper) return { background: 'linear-gradient(160deg, #6d83b2 0%, #a4b0c8 55%, #d8c8b8 100%)' };
    const isImage = wallpaper.startsWith('http') || wallpaper.startsWith('data:') || wallpaper.startsWith('blob:');
    return isImage
        ? { backgroundImage: `url(${wallpaper})`, backgroundSize: 'cover', backgroundPosition: 'center' }
        : { background: wallpaper };
};

const shortTime = (ts?: number): string => {
    if (!ts) return '';
    const d = new Date(ts);
    return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const uniqCompact = (items: string[], limit = 8): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of items) {
        const value = raw.replace(/\s+/g, ' ').trim();
        if (!value || seen.has(value)) continue;
        seen.add(value);
        out.push(value);
        if (out.length >= limit) break;
    }
    return out;
};

const callDirectionText: Record<PhoneCallLog['direction'], string> = {
    outgoing: '呼出',
    incoming: '接听',
    missed: '未接',
};

const safeParseScript = (raw: string): CheckScript | null => {
    const clean = (raw || '').replace(/```json/gi, '').replace(/```/g, '').trim();
    const tryParse = (s: string) => { try { return JSON.parse(s); } catch { return null; } };
    let obj = tryParse(clean);
    if (!obj) {
        const start = clean.indexOf('{');
        const end = clean.lastIndexOf('}');
        if (start >= 0 && end > start) obj = tryParse(clean.slice(start, end + 1));
    }
    if (!obj || !Array.isArray(obj.steps) || obj.steps.length === 0) return null;
    const steps: ScriptStep[] = obj.steps
        .filter((s: any) => s && typeof s.thought === 'string')
        .map((s: any) => ({
            app: ([
                'home',
                'chat-list',
                'chat-thread',
                'moments',
                'schedule',
                'gallery',
                'music',
                'phone',
                'shop',
                'takeout',
                'wallet',
                'browser',
                'map',
            ].includes(s.app) ? s.app : 'home') as StepApp,
            targetName: typeof s.targetName === 'string' ? s.targetName : undefined,
            thought: String(s.thought).slice(0, 300),
            action: s.action && typeof s.action === 'object'
                ? {
                    type: (['none', 'reply', 'block', 'delete', 'ignore', 'post_moment', 'clear_cart'].includes(s.action.type) ? s.action.type : 'none') as ScriptAction['type'],
                    content: typeof s.action.content === 'string' ? s.action.content.slice(0, 300) : undefined,
                }
                : undefined,
        }));
    const exitQuestions = (Array.isArray(obj.exitQuestions) ? obj.exitQuestions : [])
        .filter((q: any) => typeof q === 'string' && q.trim())
        .slice(0, 3);
    while (exitQuestions.length < 3) exitQuestions.push('你刚才有什么瞒着我的事吗？');
    return { steps: steps.slice(0, 8), exitQuestions, endHint: typeof obj.endHint === 'string' ? obj.endHint : undefined };
};

const CharPhoneCheckOverlay: React.FC<CharPhoneCheckOverlayProps> = ({
    char, userProfile, characters, apiConfig, updateCharacter, updateUserProfile, addToast, onEnd,
}) => {
    // 角色看到的是用户**实时真实**的桌面：真壁纸 + 真实安装的全部 App + 真实 dock
    const { theme, realtimeConfig } = useOS();
    const desktopSnapshot = useMemo(() => buildUserDesktopSnapshot(theme), [theme]);
    const widgetCustomCss = useMemo(() => {
        const prefs = theme.desktopWidgetPrefs || {};
        return Object.values(prefs).map(p => p?.customCss || '').filter(Boolean).join('\n');
    }, [theme.desktopWidgetPrefs]);
    const dockApps = useMemo(
        () => DOCK_APPS.map(id => INSTALLED_APPS.find(a => a.id === id)).filter((a): a is typeof INSTALLED_APPS[number] => !!a),
        []
    );
    const contentColor = theme.contentColor || '#5a3140';
    const [phase, setPhase] = useState<'loading' | 'browsing' | 'finished'>('loading');
    const [script, setScript] = useState<CheckScript | null>(null);
    const [stepIdx, setStepIdx] = useState(0);
    const [contacts, setContacts] = useState<ContactSnap[]>([]);
    const [threadMsgs, setThreadMsgs] = useState<Message[]>([]);
    const [actionLog, setActionLog] = useState<string[]>([]);
    // 手机里的真实数据快照（朋友圈 / 相册 / 纪念日）——角色翻到对应页面时展示
    const [moments, setMoments] = useState<SocialPost[]>([]);
    const [twitterTweets, setTwitterTweets] = useState<TwitterTweet[]>([]);
    const [twitterDMThreads, setTwitterDMThreads] = useState<TwitterDMThread[]>([]);
    const [galleryImgs, setGalleryImgs] = useState<GalleryImage[]>([]);
    const [annivs, setAnnivs] = useState<Anniversary[]>([]);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [callLogs, setCallLogs] = useState<PhoneCallLog[]>([]);
    const [takeoutOrders, setTakeoutOrders] = useState<TakeoutOrder[]>([]);
    const [locations, setLocations] = useState<LocationSnap[]>([]);
    const [regionHints, setRegionHints] = useState<string[]>([]);
    // 「点开 App」动画：非 null 时画面回到桌面、高亮目标图标（仿真人逐个点开）
    const [opening, setOpening] = useState<StepApp | null>(null);
    // 退出闸门
    const [exitOpen, setExitOpen] = useState(false);
    const [exitTab, setExitTab] = useState<'menu' | 'consent' | 'questions'>('menu');
    const [exitBusy, setExitBusy] = useState(false);
    const [consentReply, setConsentReply] = useState('');
    const [answers, setAnswers] = useState<string[]>(['', '', '']);
    const [judgeComment, setJudgeComment] = useState('');
    const endedRef = useRef(false);
    const appliedStepsRef = useRef<Set<number>>(new Set());
    const actionLogRef = useRef<string[]>([]);
    actionLogRef.current = actionLog;

    const llm = async (prompt: string, temperature = 0.9): Promise<string> => {
        const res = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
            body: JSON.stringify({ model: apiConfig.model, messages: [{ role: 'user', content: prompt }], temperature }),
        });
        if (!res.ok) throw new Error(`API ${res.status}`);
        return (extractContent(await safeResponseJson(res)) || '').trim();
    };

    const personaBlock = useMemo(() => [
        `名字: ${char.name}`,
        char.systemPrompt ? `人设: ${String(char.systemPrompt).slice(0, 1500)}` : '',
    ].filter(Boolean).join('\n'), [char]);

    // ── 启动：取联系人快照 + 生成浏览脚本 ──
    // 锁手机·双向试错：TA 拿你手机时有概率先输错一次密码（你回头会在锁屏看到提醒），再解锁翻看。
    useEffect(() => {
        if (Math.random() < 0.3) recordCharUnlockFail(char.name, char.id);
        // 仅在这次「拿起手机」时记一次
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const snaps: ContactSnap[] = [];
                for (const c of characters) {
                    try {
                        const recent = await DB.getRecentMessagesByCharId(c.id, 3);
                        const lastVisible = [...recent].reverse().find(m => m.role !== 'system');
                        snaps.push({
                            char: c,
                            preview: lastVisible ? String(lastVisible.content || '').slice(0, 60) : '（暂无消息）',
                            lastAt: lastVisible?.timestamp || 0,
                        });
                    } catch {
                        snaps.push({ char: c, preview: '（暂无消息）', lastAt: 0 });
                    }
                }
                snaps.sort((a, b) => b.lastAt - a.lastAt);
                if (cancelled) return;
                setContacts(snaps);

                // 最近活跃的几个对话给角色"翻记录"的素材
                const excerptTargets = snaps.filter(s => s.lastAt > 0).slice(0, 4);
                const excerpts: string[] = [];
                const locationSnaps: LocationSnap[] = [];
                for (const t of excerptTargets) {
                    try {
                        const msgs = await DB.getRecentMessagesByCharId(t.char.id, 12);
                        msgs
                            .filter(m => m.type === 'location')
                            .slice(-2)
                            .forEach(m => locationSnaps.push({
                                source: t.char.name,
                                title: String(m.content || '位置分享').slice(0, 50),
                                detail: typeof m.metadata?.address === 'string' ? m.metadata.address.slice(0, 80) : undefined,
                                at: m.timestamp || 0,
                            }));
                        const lines = msgs
                            .filter(m => m.role !== 'system' && typeof m.content === 'string')
                            .map(m => `${m.role === 'user' ? userProfile.name : t.char.name}: ${String(m.content).slice(0, 80)}`)
                            .join('\n');
                        if (lines) excerpts.push(`【与「${t.char.name}」的最近对话】\n${lines}`);
                    } catch { /* 单个对话取不到不阻塞 */ }
                }
                if (cancelled) return;

                // 朋友圈 / 相册 / 纪念日真实快照：页面展示 + 喂给脚本生成（想法贴真实内容）
                let momentsSnap: SocialPost[] = [];
                let twitterSnap: TwitterTweet[] = [];
                let twitterDMSnap: TwitterDMThread[] = [];
                let gallerySnap: GalleryImage[] = [];
                let annivSnap: Anniversary[] = [];
                let taskSnap: Task[] = [];
                let callSnap: PhoneCallLog[] = [];
                let takeoutSnap: TakeoutOrder[] = [];
                try {
                    momentsSnap = (await DB.getSocialPosts())
                        .filter(p => p.visibility !== 'private')
                        .sort((a, b) => b.timestamp - a.timestamp)
                        .slice(0, 6);
                } catch { /* 取不到不阻塞 */ }
                try {
                    twitterSnap = (await DB.getTwitterTweets())
                        .sort((a, b) => b.createdAt - a.createdAt)
                        .slice(0, 8);
                } catch { /* ignore */ }
                try {
                    twitterDMSnap = (await DB.getTwitterDMThreads())
                        .sort((a, b) => b.updatedAt - a.updatedAt)
                        .slice(0, 4);
                } catch { /* ignore */ }
                try {
                    gallerySnap = (await DB.getGalleryImages())
                        .sort((a, b) => b.timestamp - a.timestamp)
                        .slice(0, 9);
                } catch { /* ignore */ }
                try {
                    annivSnap = (await DB.getAllAnniversaries()).slice(0, 8);
                } catch { /* ignore */ }
                try {
                    taskSnap = (await DB.getAllTasks())
                        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
                        .slice(0, 8);
                } catch { /* ignore */ }
                try {
                    callSnap = (await DB.getAllPhoneCallLogs()).slice(0, 8);
                } catch { /* ignore */ }
                try {
                    takeoutSnap = (await DB.getTakeoutOrders())
                        .sort((a, b) => b.placedAt - a.placedAt)
                        .slice(0, 8);
                } catch { /* ignore */ }
                if (cancelled) return;
                setMoments(momentsSnap);
                setTwitterTweets(twitterSnap);
                setTwitterDMThreads(twitterDMSnap);
                setGalleryImgs(gallerySnap);
                setAnnivs(annivSnap);
                setTasks(taskSnap);
                setCallLogs(callSnap);
                setTakeoutOrders(takeoutSnap);
                const nextRegionHints = uniqCompact([
                    realtimeConfig.weatherEnabled
                        ? (realtimeConfig.weatherMode === 'manual' && realtimeConfig.weatherCity
                            ? `天气城市：${realtimeConfig.weatherCity}`
                            : '天气使用浏览器定位')
                        : '',
                    ...locationSnaps.map(l => `${l.title}${l.detail ? ` ${l.detail}` : ''}`),
                    ...momentsSnap.map(p => p.location ? `朋友圈位置：${p.location}` : ''),
                    ...takeoutSnap.map(o => o.address ? `外卖地址：${o.address}` : ''),
                ], 10);
                setLocations(locationSnaps.sort((a, b) => b.at - a.at).slice(0, 8));
                setRegionHints(nextRegionHints);

                const momentsBrief = momentsSnap
                    .map(p => `- ${p.authorName}：「${String(p.content || p.title || '').slice(0, 60)}」${p.location ? ` @${p.location}` : ''}${p.images?.length ? `（配图${p.images.length}张）` : ''}`)
                    .join('\n');
                const twitterBrief = twitterSnap
                    .map(t => `- ${t.authorName} ${t.authorHandle}${t.language ? ` [${t.language}]` : ''}${t.country ? ` ${t.country}` : ''}：「${String(t.content || '').slice(0, 90)}」${t.topics?.length ? ` #${t.topics.slice(0, 3).join(' #')}` : ''}`)
                    .join('\n');
                const twitterDMBrief = twitterDMSnap
                    .map(t => `- ${t.accountName} ${t.accountHandle}：${String(t.lastMessage || '').slice(0, 70)}${t.unreadCount ? `（未读${t.unreadCount}）` : ''}`)
                    .join('\n');
                const annivBrief = annivSnap
                    .map(a => `- ${a.date} ${a.title}`)
                    .join('\n');
                const taskBrief = taskSnap
                    .map(t => `- ${t.isCompleted ? '已完成' : '待办'}：${t.title}${t.deadline ? `（截止 ${t.deadline}）` : ''}`)
                    .join('\n');
                const callBrief = callSnap
                    .map(l => `- ${shortTime(l.timestamp)} ${callDirectionText[l.direction]} ${l.name} ${l.durationSec ? `${Math.round(l.durationSec / 60)}分钟` : ''}`)
                    .join('\n');
                const takeoutBrief = takeoutSnap
                    .map(o => `- ${o.storeName} ¥${fmtPrice(o.total)} ${STATUS_LABEL[liveTakeoutStatus(o)]}，地址：${o.address || '未写'}`)
                    .join('\n');
                const shopBrief = [
                    resolveCart(userProfile.shopCart).length > 0
                        ? `购物车：${resolveCart(userProfile.shopCart).map(({ item, qty }) => `${item.emoji}${item.name}×${qty}`).join('、')}，合计 ¥${fmtPrice(cartTotal(userProfile.shopCart))}`
                        : '购物车是空的',
                    (userProfile.shopOrders || []).length > 0
                        ? `最近订单：${(userProfile.shopOrders || []).slice(0, 3).map(o => `${o.items.map(it => `${it.emoji}${it.name}`).join('、')} ¥${fmtPrice(o.total)}`).join('；')}`
                        : '最近没有心意铺订单',
                    (userProfile.shopFootprints || []).length > 0
                        ? `最近浏览过 ${Math.min(userProfile.shopFootprints?.length || 0, 8)} 件商品`
                        : '',
                ].filter(Boolean).join('\n');
                const regionBrief = nextRegionHints.length
                    ? nextRegionHints.map(h => `- ${h}`).join('\n')
                    : '（没有明确地区线索，只能从聊天语境判断）';

                const prompt = `### 任务
你在扮演角色「${char.name}」。此刻 TA 拿到了 ${userProfile.name}（TA 的聊天对象/亲密的人）的手机，正在查岗翻看。请按 TA 的人设生成一份"查岗浏览脚本"。

### 你的人设
${personaBlock}

### ${userProfile.name} 手机里的聊天列表（按最近活跃排序）
${snaps.map(s => `- ${s.char.name}${s.char.id === char.id ? '（这是你自己和TA的对话）' : ''}：最后一条「${s.preview}」`).join('\n')}

### 可翻看的对话记录节选
${excerpts.join('\n\n') || '（手机里几乎没有聊天记录）'}

### 朋友圈最近的动态
${momentsBrief || '（朋友圈没什么动态）'}

### 推特最近的时间线
${twitterBrief || '（推特时间线暂时空着）'}

### 推特私信
${twitterDMBrief || '（没有推特私信）'}

### 日程里记着的纪念日
${annivBrief || '（日程是空的）'}

### 待办 / 日程事项
${taskBrief || '（没有待办事项）'}

### 相册
${gallerySnap.length > 0 ? `最近存了 ${gallerySnap.length} 张照片/聊天图` : '（相册几乎是空的）'}

### 电话记录
${callBrief || '（没有通话记录）'}

### 饭票外卖订单
${takeoutBrief || '（没有外卖订单）'}

### 心意铺 / 钱包
${shopBrief}

### 地区 / 位置线索
${regionBrief}

### ${userProfile.name} 的心意铺购物车（还没结算）
${resolveCart(userProfile.shopCart).length > 0
    ? resolveCart(userProfile.shopCart).map(({ item, qty }) => `- ${item.emoji}${item.name} ×${qty}`).join('\n') + `\n合计 ¥${fmtPrice(cartTotal(userProfile.shopCart))}`
    : '（购物车是空的）'}

### 要求
生成 4~7 步浏览动作。第一步必须是 "home"（刚拿到手机看桌面）。可用的 app：
- "home" 桌面
- "chat-list" 聊天列表 / "chat-thread" 点开某人的对话（targetName 填上面列表里的名字）
- "moments" 朋友圈 / "twitter" 推特 / "schedule" 日程 / "gallery" 相册 / "music" 音乐
- "phone" 电话记录 / "shop" 心意铺购物与购物车 / "takeout" 饭票外卖 / "wallet" 钱包收支 / "browser" 热点与浏览痕迹 / "map" 地区与位置线索
每一步都要有 thought：${char.name} 看到当前页面时的真实想法（第一人称，30~80字，完全贴合人设——可以吃醋、好奇、欣慰、酸溜溜、占有欲，看到自己的对话框也会有感想）。
翻到 moments / twitter / schedule / gallery / phone / shop / takeout / wallet / browser / map 时，想法要针对上面给出的真实快照来写，不要凭空编造内容。twitter 里包含国际时间线和私信概况，看到外文推文时可以提到语言或翻译痕迹。
chat-thread 步骤可以带 action：
- {"type":"reply","content":"…"} 代替 ${userProfile.name} 回复对方（content 是以 ${userProfile.name} 口吻发出的内容）
- {"type":"block"} 把这个联系人拉黑
- {"type":"delete"} 删掉这个好友
- {"type":"ignore"} 看完冷哼一声不动
moments（朋友圈）步骤可以带 action：
- {"type":"post_moment","content":"…"} 代替 ${userProfile.name} 发一条朋友圈（content 是以 ${userProfile.name} 口吻写的动态正文，30~80字；可以宣示主权、撒糖、调皮地替TA说点话，也可能阴阳怪气）
任意一步都可带 action（看到购物车有没结算的东西时）：
- {"type":"clear_cart"} 帮 ${userProfile.name} 把心意铺购物车清空（你替 TA 代付）。宠溺/大方/想讨好或心疼 TA 的角色才会这么做；小气、在闹脾气或购物车是空的时候绝不要用。
是否做这些动作、做哪种，严格按人设性格来：温柔的角色多半只看不动，占有欲强/醋劲大的角色才会下手——回复别人、拉黑、抢着替TA发朋友圈昭告关系、或大方地帮 TA 清空购物车。不要为了戏剧性乱来。
另外生成 exitQuestions：3 个问题。${userProfile.name} 想中途拿回手机时，${char.name} 会要求 TA 先回答这 3 个问题（按人设出题：可以是审问、撒娇、试探）。
endHint：一句话，描述 ${char.name} 翻完手机后的整体心情（用于之后 TA 主动发消息的语气基调）。

### 输出
只输出一个 JSON 对象，不要任何其它文字：
{"steps":[{"app":"home","thought":"…"},{"app":"chat-thread","targetName":"…","thought":"…","action":{"type":"reply","content":"…"}},{"app":"moments","thought":"…","action":{"type":"post_moment","content":"…"}}],"exitQuestions":["…","…","…"],"endHint":"…"}`;

                const raw = await llm(prompt);
                if (cancelled) return;
                const parsed = safeParseScript(raw);
                if (!parsed) throw new Error('浏览脚本解析失败');
                setScript(parsed);
                setPhase('browsing');
            } catch (e: any) {
                if (cancelled) return;
                addToast(`查岗启动失败：${e?.message || e}`, 'error');
                onEnd('forced');
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const currentStep = script?.steps[stepIdx] || null;
    const targetChar = useMemo(() => {
        if (!currentStep?.targetName) return null;
        return characters.find(c => c.name === currentStep.targetName)
            || characters.find(c => currentStep.targetName && c.name.includes(currentStep.targetName))
            || null;
    }, [currentStep, characters]);

    // chat-thread 步骤：拉真实对话记录展示
    useEffect(() => {
        if (!currentStep || currentStep.app !== 'chat-thread' || !targetChar) { setThreadMsgs([]); return; }
        let cancelled = false;
        DB.getRecentMessagesByCharId(targetChar.id, 40)
            .then(msgs => { if (!cancelled) setThreadMsgs(msgs.filter(m => m.role !== 'system')); })
            .catch(() => { if (!cancelled) setThreadMsgs([]); });
        return () => { cancelled = true; };
    }, [stepIdx, currentStep, targetChar]);

    // 执行当前步骤的副作用动作（每步只执行一次）
    useEffect(() => {
        if (phase !== 'browsing' || !currentStep?.action || appliedStepsRef.current.has(stepIdx)) return;
        appliedStepsRef.current.add(stepIdx);
        const act = currentStep.action;
        const target = targetChar;
        const log = (line: string) => setActionLog(prev => [...prev, line]);
        (async () => {
            try {
                if (act.type === 'reply' && target && act.content) {
                    await DB.saveMessage({
                        charId: target.id,
                        role: 'user',
                        type: 'text',
                        content: act.content,
                        metadata: { sentByCharPhoneCheck: char.id, sentByCharPhoneCheckName: char.name },
                    } as any);
                    log(`在与「${target.name}」的对话里，以${userProfile.name}的名义回复了：「${act.content}」`);
                } else if (act.type === 'clear_cart') {
                    // 帮用户清空心意铺购物车（角色代付）：整车进用户背包 + 双方小票
                    const items = expandCart(userProfile.shopCart);
                    if (items.length > 0) {
                        const total = cartTotal(userProfile.shopCart);
                        const owned = items.map(makeOwnedItem);
                        const userReceipts = items.map(it => makeReceipt(it, 'user', 'receive', char.id, char.name, '代付'));
                        const charReceipts = items.map(it => makeReceipt(it, 'char', 'gift', 'user', userProfile.name || '我', '代付'));
                        updateUserProfile({
                            shopInventory: [...owned, ...(userProfile.shopInventory || [])],
                            shopReceipts: [...userReceipts, ...(userProfile.shopReceipts || [])],
                            shopCart: [],
                        });
                        await updateCharacter(char.id, { shopReceipts: [...charReceipts, ...(char.shopReceipts || [])] });
                        log(`大方地帮 ${userProfile.name} 清空了心意铺购物车（${items.length}件，代付 ¥${fmtPrice(total)}）`);
                    }
                } else if ((act.type === 'block' || act.type === 'delete') && target && target.id !== char.id) {
                    await updateCharacter(target.id, { blacklisted: true, blacklistedAt: Date.now(), unblockAppeal: initUnblockAppeal() });
                    log(act.type === 'block'
                        ? `把「${target.name}」拉黑了`
                        : `想把「${target.name}」删掉，最终把对方加入了黑名单（删好友按拉黑执行）`);
                } else if (act.type === 'ignore' && target) {
                    log(`看完了与「${target.name}」的对话，什么都没做`);
                } else if (act.type === 'post_moment' && act.content) {
                    // 代发朋友圈：以用户名义贴一条公开动态（角色随后能在上下文里看到这条）
                    const newPost: SocialPost = {
                        id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
                        authorName: userProfile.name,
                        authorAvatar: userProfile.avatar,
                        title: '',
                        content: act.content,
                        images: [],
                        likes: 0,
                        isCollected: false,
                        isLiked: false,
                        comments: [],
                        timestamp: Date.now(),
                        tags: [],
                        authorType: 'user',
                        likedBy: [],
                        repostOf: null,
                        visibility: 'public',
                    };
                    await DB.saveSocialPost(newPost);
                    setMoments(prev => [newPost, ...prev]);
                    log(`以${userProfile.name}的名义发了一条朋友圈：「${act.content}」`);
                }
            } catch (e) {
                console.warn('[CharPhoneCheck] 执行动作失败:', e);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stepIdx, phase, currentStep]);

    // 「点开 App」动画：每步开始时先回到桌面、高亮目标图标 TAP_MS 后再进入页面，
    // 仿照真人查岗（参考桌面远程画面）逐个点开 App 的节奏
    useEffect(() => {
        if (phase !== 'browsing' || !currentStep || currentStep.app === 'home') { setOpening(null); return; }
        // 连续两步都在聊天 App 内（chat-list → chat-thread）不回桌面，直接页内切换
        const prevStep = stepIdx > 0 ? script?.steps[stepIdx - 1] : null;
        const sameAppFamily = prevStep && STEP_ICON[prevStep.app as Exclude<StepApp, 'home'>] === STEP_ICON[currentStep.app as Exclude<StepApp, 'home'>];
        if (sameAppFamily) { setOpening(null); return; }
        setOpening(currentStep.app);
        const t = setTimeout(() => setOpening(null), TAP_MS);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase, stepIdx]);

    // 自动推进
    useEffect(() => {
        if (phase !== 'browsing' || !script || exitOpen) return;
        const timer = setTimeout(() => {
            if (stepIdx < script.steps.length - 1) setStepIdx(i => i + 1);
            else setPhase('finished');
        }, STEP_MS);
        return () => clearTimeout(timer);
    }, [phase, stepIdx, script, exitOpen]);

    // ── 结束：合成记录落库 → 通知宿主 ──
    const finish = async (exitMode: 'consent' | 'questions' | 'forced' | 'finished', extra?: string) => {
        if (endedRef.current) return;
        endedRef.current = true;
        try {
            const browsed = (script?.steps || []).slice(0, Math.min(stepIdx + 1, script?.steps.length || 0))
                .map((s, i) => {
                    const where = s.app === 'chat-thread' && s.targetName
                        ? `点开了与「${s.targetName}」的对话`
                        : `看了${STEP_LABEL[s.app]}`;
                    return `${i + 1}. ${where}，心想：${s.thought}`;
                }).join('\n');
            const exitDesc = exitMode === 'finished' ? `${char.name} 自己翻完了，把手机还了回去。`
                : exitMode === 'consent' ? `${userProfile.name} 开口请求拿回手机，${char.name} 同意了。`
                : exitMode === 'questions' ? `${userProfile.name} 回答了 ${char.name} 出的三个问题，通过后拿回了手机。`
                : `${userProfile.name} 强行抢回了手机。`;
            const ops = actionLogRef.current.length ? `\n${char.name} 翻手机期间做的事：\n${actionLogRef.current.map(l => `- ${l}`).join('\n')}` : '';
            await DB.saveMessage({
                charId: char.id,
                role: 'system',
                type: 'text',
                content: `[查岗记录] 刚才 ${char.name} 拿走了 ${userProfile.name} 的手机翻看。\n${char.name} 的浏览过程与内心想法：\n${browsed || '（刚拿到就被打断了）'}${ops}\n${exitDesc}${extra ? `\n${extra}` : ''}${script?.endHint ? `\n${char.name} 此刻的心情基调：${script.endHint}` : ''}\n（这段经历你们双方都知情，接下来请 ${char.name} 主动就刚才看到的内容发消息。）`,
                metadata: { charPhoneCheck: true },
            } as any);
        } catch (e) {
            console.warn('[CharPhoneCheck] 记录落库失败:', e);
        }
        onEnd(exitMode);
    };

    // 翻完自动收尾
    useEffect(() => {
        if (phase === 'finished') {
            const t = setTimeout(() => { void finish('finished'); }, 2200);
            return () => clearTimeout(t);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase]);

    // ── 退出闸门 ──
    const askConsent = async () => {
        setExitBusy(true);
        setConsentReply('');
        try {
            const raw = await llm(`你在扮演「${char.name}」（人设如下），正翻看 ${userProfile.name} 的手机看到一半，${userProfile.name} 开口想拿回手机。
${personaBlock}
你翻到现在的想法：${(script?.steps || []).slice(0, stepIdx + 1).map(s => s.thought).join('；')}
按人设决定是否把手机还给TA。只输出 JSON：{"allow": true或false, "reply": "你对TA说的一句话（贴人设，30字内）"}`);
            const clean = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
            let obj: any = null;
            try { obj = JSON.parse(clean); } catch {
                const s = clean.indexOf('{'); const e = clean.lastIndexOf('}');
                if (s >= 0 && e > s) { try { obj = JSON.parse(clean.slice(s, e + 1)); } catch { /* ignore */ } }
            }
            const allow = !!obj?.allow;
            const reply = typeof obj?.reply === 'string' ? obj.reply : (allow ? '……好吧，还你。' : '不行，我还没看完。');
            setConsentReply(reply);
            if (allow) {
                setTimeout(() => { void finish('consent', `${char.name} 还手机时说：「${reply}」`); }, 1600);
            }
        } catch (e: any) {
            addToast(`请求失败：${e?.message || e}`, 'error');
        } finally {
            setExitBusy(false);
        }
    };

    const submitAnswers = async () => {
        if (answers.some(a => !a.trim())) { addToast('三个问题都要回答', 'info'); return; }
        setExitBusy(true);
        setJudgeComment('');
        try {
            const qs = script?.exitQuestions || [];
            const raw = await llm(`你在扮演「${char.name}」（人设如下），正翻看 ${userProfile.name} 的手机。TA 想拿回手机，你要求TA先回答你出的三个问题。现在TA答完了，按人设判断这些回答是否让你满意、愿意还手机。
${personaBlock}
${qs.map((q, i) => `问题${i + 1}：${q}\nTA的回答：${answers[i]}`).join('\n')}
只输出 JSON：{"pass": true或false, "comment": "你听完回答后对TA说的一句话（贴人设，40字内）"}`);
            const clean = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
            let obj: any = null;
            try { obj = JSON.parse(clean); } catch {
                const s = clean.indexOf('{'); const e = clean.lastIndexOf('}');
                if (s >= 0 && e > s) { try { obj = JSON.parse(clean.slice(s, e + 1)); } catch { /* ignore */ } }
            }
            const pass = !!obj?.pass;
            const comment = typeof obj?.comment === 'string' ? obj.comment : (pass ? '算你过关。' : '这答案我可不信。');
            setJudgeComment(comment);
            if (pass) {
                const qa = qs.map((q, i) => `问：${q} 答：${answers[i]}`).join('；');
                setTimeout(() => { void finish('questions', `问答内容：${qa}\n${char.name} 听完说：「${comment}」`); }, 1600);
            }
        } catch (e: any) {
            addToast(`提交失败：${e?.message || e}`, 'error');
        } finally {
            setExitBusy(false);
        }
    };

    const screenHeader = (title: string, sub?: string) => (
        <div className="px-5 pt-12 pb-3 text-slate-800 border-b border-slate-100 bg-white/90 backdrop-blur">
            <div className="text-[15px] font-bold">{title}</div>
            {sub && <div className="text-[10px] text-slate-400 mt-0.5 truncate">{sub}</div>}
        </div>
    );

    const dataCard = (key: React.Key, title: string, detail: React.ReactNode, meta?: React.ReactNode) => (
        <div key={key} className="bg-white rounded-2xl px-3.5 py-3 border border-slate-100 shadow-sm">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="text-[13px] font-bold text-slate-700 truncate">{title}</div>
                    <div className="text-[11px] text-slate-500 leading-relaxed mt-1">{detail}</div>
                </div>
                {meta && <div className="shrink-0 text-[10px] text-slate-400 font-mono">{meta}</div>}
            </div>
        </div>
    );

    const renderPhoneApp = () => (
        <div className="flex-1 overflow-hidden flex flex-col bg-slate-50">
            {screenHeader('回声亭', '最近通话')}
            <div className="flex-1 overflow-y-auto no-scrollbar p-3 space-y-2.5 pb-20">
                {callLogs.length === 0 && <div className="text-center text-xs text-slate-400 pt-14">（没有通话记录）</div>}
                {callLogs.map(log => dataCard(
                    log.id,
                    log.name,
                    <span>{callDirectionText[log.direction]} {log.number}{log.durationSec ? ` · ${Math.round(log.durationSec / 60)} 分钟` : ''}</span>,
                    shortTime(log.timestamp)
                ))}
            </div>
        </div>
    );

    const renderShopApp = () => {
        const cart = resolveCart(userProfile.shopCart);
        const orders = (userProfile.shopOrders || []).slice(0, 5);
        const inventory = (userProfile.shopInventory || []).slice(0, 6);
        return (
            <div className="flex-1 overflow-hidden flex flex-col bg-[#fff7fb]">
                {screenHeader('心意铺', cart.length ? `购物车 ¥${fmtPrice(cartTotal(userProfile.shopCart))}` : '购物车空空')}
                <div className="flex-1 overflow-y-auto no-scrollbar p-3 space-y-3 pb-20">
                    <div className="text-[10px] font-bold text-slate-400 px-1">购物车</div>
                    {cart.length === 0 && dataCard('empty-cart', '购物车', '暂时没有加购的礼物')}
                    {cart.map(({ item, qty }) => dataCard(`cart-${item.id}`, `${item.emoji} ${item.name}`, item.blurb, `×${qty}`))}
                    <div className="text-[10px] font-bold text-slate-400 px-1 pt-2">最近订单</div>
                    {orders.length === 0 && dataCard('empty-orders', '订单', '没有近期订单')}
                    {orders.map(order => dataCard(
                        order.id,
                        order.items.map(it => `${it.emoji}${it.name}`).join('、'),
                        `${order.receivedAt ? '已收货' : order.refundedAt ? '已退款' : '配送中'} · ${order.payerName || (order.paidBy === 'self' ? userProfile.name : '角色代付')}`,
                        `¥${fmtPrice(order.total)}`
                    ))}
                    {inventory.length > 0 && <div className="text-[10px] font-bold text-slate-400 px-1 pt-2">背包</div>}
                    {inventory.map(item => dataCard(item.uid, `${item.emoji} ${item.name}`, `买于 ${shortTime(item.boughtAt)}`, `¥${fmtPrice(item.price)}`))}
                </div>
            </div>
        );
    };

    const renderTakeoutApp = () => (
        <div className="flex-1 overflow-hidden flex flex-col bg-[#fffaf0]">
            {screenHeader('饭票', '外卖与跑腿订单')}
            <div className="flex-1 overflow-y-auto no-scrollbar p-3 space-y-2.5 pb-20">
                {takeoutOrders.length === 0 && <div className="text-center text-xs text-slate-400 pt-14">（没有外卖订单）</div>}
                {takeoutOrders.map(order => {
                    const status = liveTakeoutStatus(order);
                    return dataCard(
                        order.id,
                        `${order.storeEmoji || '🍱'} ${order.storeName}`,
                        <>
                            <span className="font-bold text-amber-600">{STATUS_LABEL[status]}</span>
                            <span> · {order.items.map(it => `${it.emoji || ''}${it.name}×${it.qty}`).join('、')}</span>
                            {order.address && <span className="block mt-1">地址：{order.address}</span>}
                        </>,
                        `¥${fmtPrice(order.total)}`
                    );
                })}
            </div>
        </div>
    );

    const renderWalletApp = () => (
        <div className="flex-1 overflow-hidden flex flex-col bg-[#f7fff8]">
            {screenHeader('钱包', `余额 ¥${fmtPrice(userProfile.balance || 0)}`)}
            <div className="flex-1 overflow-y-auto no-scrollbar p-3 space-y-2.5 pb-20">
                {dataCard('balance', '账户余额', '角色能看到你现在钱包里还有多少钱', `¥${fmtPrice(userProfile.balance || 0)}`)}
                {(userProfile.shopReceipts || []).slice(0, 8).map(r => dataCard(
                    r.id,
                    `${r.emoji} ${r.name}`,
                    `${r.action === 'buy' ? '购买' : r.action === 'gift' ? '送出' : '收到'} · ${r.counterpartName}${r.note ? ` · ${r.note}` : ''}`,
                    shortTime(r.at)
                ))}
                {(userProfile.shopReceipts || []).length === 0 && dataCard('empty-receipts', '小票', '还没有购物小票')}
            </div>
        </div>
    );

    const renderBrowserApp = () => (
        <div className="flex-1 overflow-hidden flex flex-col bg-[#f6fbff]">
            {screenHeader('浏览', '热点、搜索与公开痕迹')}
            <div className="flex-1 overflow-y-auto no-scrollbar p-3 space-y-2.5 pb-20">
                {dataCard('host', '当前设备网页', typeof window !== 'undefined' ? window.location.hostname || '本地页面' : '本地页面')}
                {dataCard('news', '热点来源', (realtimeConfig.newsPlatforms || []).length ? realtimeConfig.newsPlatforms!.join('、') : '未配置热点平台')}
                {moments.slice(0, 4).map(p => dataCard(
                    `m-${p.id}`,
                    `${p.authorName} 的公开动态`,
                    `${String(p.content || p.title || '').slice(0, 80)}${p.location ? ` · ${p.location}` : ''}`,
                    shortTime(p.timestamp)
                ))}
            </div>
        </div>
    );

    const renderTwitterApp = () => (
        <div className="flex-1 overflow-hidden flex flex-col bg-white">
            {screenHeader('推特', `${twitterTweets.length} 条最近推文 · ${twitterDMThreads.length} 个私信`)}
            <div className="flex-1 overflow-y-auto no-scrollbar pb-20">
                {twitterTweets.length === 0 && <div className="text-center text-xs text-slate-400 pt-12">（推特时间线是空的）</div>}
                {twitterDMThreads.length > 0 && (
                    <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
                        <div className="text-[10px] font-bold text-slate-400 mb-2">私信</div>
                        <div className="space-y-2">
                            {twitterDMThreads.map(t => (
                                <div key={t.id} className="bg-white rounded-2xl px-3 py-2 border border-slate-100 flex gap-2">
                                    {t.accountAvatar
                                        ? <img src={t.accountAvatar} className="w-8 h-8 rounded-full object-cover shrink-0" alt="" />
                                        : <div className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center text-[12px] font-black shrink-0">{t.accountName.slice(0, 1)}</div>}
                                    <div className="min-w-0 flex-1">
                                        <div className="text-[12px] truncate"><b>{t.accountName}</b> <span className="text-slate-400">{t.accountHandle}</span></div>
                                        <div className="text-[11px] text-slate-500 truncate">{t.lastMessage || '没有消息'}</div>
                                    </div>
                                    {t.unreadCount > 0 && <div className="w-4 h-4 rounded-full bg-sky-500 text-white text-[9px] font-bold flex items-center justify-center">{t.unreadCount}</div>}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                {twitterTweets.map(t => (
                    (() => {
                        const translated = getTwitterTranslationText(t.translations, getTwitterLocalTargetLang());
                        return (
                            <div key={t.id} className="px-4 py-3 border-b border-slate-100 flex gap-3">
                                {t.authorAvatar
                                    ? <img src={t.authorAvatar} className="w-9 h-9 rounded-full object-cover shrink-0" alt="" />
                                    : <div className="w-9 h-9 rounded-full bg-slate-900 text-white flex items-center justify-center text-[13px] font-black shrink-0">{t.authorName.slice(0, 1)}</div>}
                                <div className="min-w-0 flex-1">
                                    <div className="text-[12px] truncate"><b>{t.authorName}</b> <span className="text-slate-400">{t.authorHandle}</span></div>
                                    {(t.language || t.country) && <div className="text-[10px] text-slate-400 mt-0.5 truncate">{[t.language, t.country].filter(Boolean).join(' · ')}</div>}
                                    <div className="text-[12px] text-slate-700 leading-relaxed line-clamp-4 whitespace-pre-wrap mt-0.5">{t.content}</div>
                                    {translated && <div className="text-[11px] text-slate-500 leading-relaxed line-clamp-2 mt-1 bg-slate-50 rounded-xl px-2 py-1">译文：{translated}</div>}
                                    {t.topics?.length > 0 && <div className="text-[11px] text-sky-500 mt-1 truncate">#{t.topics.slice(0, 3).join(' #')}</div>}
                                    <div className="text-[10px] text-slate-400 mt-1">💬 {t.replyCount || 0}　↻ {t.retweets || 0}　♡ {t.likes || 0}</div>
                                </div>
                            </div>
                        );
                    })()
                ))}
            </div>
        </div>
    );

    const renderMapApp = () => (
        <div className="flex-1 overflow-hidden flex flex-col bg-[#f8fafc]">
            {screenHeader('地区', '位置线索')}
            <div className="flex-1 overflow-y-auto no-scrollbar p-3 space-y-2.5 pb-20">
                {regionHints.length === 0 && locations.length === 0 && <div className="text-center text-xs text-slate-400 pt-14">（没有明显位置线索）</div>}
                {regionHints.map((hint, i) => dataCard(`hint-${i}`, '地区线索', hint))}
                {locations.map(loc => dataCard(
                    `${loc.source}-${loc.at}-${loc.title}`,
                    loc.title,
                    `${loc.source}${loc.detail ? ` · ${loc.detail}` : ''}`,
                    shortTime(loc.at)
                ))}
            </div>
        </div>
    );

    const renderDesktopItem = (item: DeskItem, openingIcon: string | null) => {
        if (item.kind === 'app') {
            const app = INSTALLED_APPS.find(a => a.id === item.id);
            if (!app) return null;
            const isTapped = openingIcon === app.icon;
            return (
                <div className={`w-full h-full flex items-center justify-center transition-all duration-300 rounded-2xl ${isTapped ? 'scale-90 ring-4 ring-white/70 bg-white/30' : ''}`}>
                    <AppIcon app={app} onClick={() => { /* checking preview only */ }} size="md" />
                </div>
            );
        }

        const now = new Date();
        const dateText = `${now.getMonth() + 1}/${now.getDate()}`;
        const timeText = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        const widgetBase = 'w-full h-full rounded-[1.4rem] overflow-hidden border border-white/45 shadow-[0_16px_34px_-24px_rgba(15,23,42,0.65)] backdrop-blur-xl';
        const translucent: React.CSSProperties = {
            color: contentColor,
            background: 'linear-gradient(145deg, rgba(255,255,255,0.72), rgba(255,255,255,0.34))',
        };

        if (item.id === 'clock') {
            return (
                <div className={`${widgetBase} px-4 py-4 flex flex-col justify-between`} style={{
                    color: '#ffffff',
                    background: 'linear-gradient(160deg, rgba(55,83,129,0.94), rgba(111,137,180,0.84))',
                    textShadow: '0 1px 10px rgba(15,23,42,0.35)',
                }}>
                    <div className="text-[12px] label-mono font-bold opacity-80">TODAY</div>
                    <div>
                        <div className="text-[3.2rem] leading-none font-bold">{now.getDate()}</div>
                        <div className="text-[18px] font-semibold tabular-nums">{timeText}</div>
                    </div>
                    <div className="text-[11px] opacity-80">{dateText}</div>
                </div>
            );
        }
        if (item.id === 'weather') {
            const place = regionHints[0] || (realtimeConfig.weatherEnabled
                ? (realtimeConfig.weatherMode === 'manual' ? realtimeConfig.weatherCity || '天气城市' : '浏览器定位')
                : '天气未开启');
            return (
                <div className={`${widgetBase} px-3 py-3 flex flex-col justify-between`} style={translucent}>
                    <div className="text-[11px] font-bold opacity-55">天气</div>
                    <div className="text-[22px] font-semibold leading-none">--°</div>
                    <div className="text-[10px] leading-snug opacity-70 line-clamp-2">{place}</div>
                </div>
            );
        }
        if (item.id === 'character') {
            const last = contacts[0]?.preview || '最近没有新消息';
            return (
                <div className={`${widgetBase} px-4 py-3 flex items-center gap-3`} style={translucent}>
                    <img src={char.avatar} className="w-12 h-12 rounded-2xl object-cover shrink-0" alt="" />
                    <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-bold truncate">{char.name}</div>
                        <div className="text-[11px] opacity-60 truncate">{last}</div>
                    </div>
                </div>
            );
        }
        if (item.id === 'schedule') {
            const firstAnniv = annivs[0];
            const firstTask = tasks.find(t => !t.isCompleted) || tasks[0];
            return (
                <div className={`${widgetBase} px-4 py-3 flex flex-col gap-2`} style={translucent}>
                    <div className="text-[13px] font-bold">日程</div>
                    {firstAnniv ? (
                        <div className="rounded-2xl bg-white/48 px-3 py-2">
                            <div className="text-[10px] label-mono opacity-55">{firstAnniv.date}</div>
                            <div className="text-[12px] font-semibold truncate">{firstAnniv.title}</div>
                        </div>
                    ) : null}
                    {firstTask ? (
                        <div className="rounded-2xl bg-white/40 px-3 py-2">
                            <div className="text-[10px] opacity-55">{firstTask.isCompleted ? '已完成' : '待办'}</div>
                            <div className="text-[12px] font-semibold truncate">{firstTask.title}</div>
                        </div>
                    ) : null}
                    {!firstAnniv && !firstTask && <div className="text-[11px] opacity-55 mt-auto">今天暂时空着</div>}
                </div>
            );
        }
        if (item.id === 'music') {
            return (
                <div className={`${widgetBase} px-4 py-4 flex flex-col justify-between`} style={translucent}>
                    <div className="text-[11px] font-bold opacity-55">音乐</div>
                    <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl" style={{ background: '#fff4f7', color: '#5a3140', border: '1px solid #eed6df' }}>♪</div>
                    <div className="text-[10px] opacity-65 line-clamp-2">最近播放</div>
                </div>
            );
        }
        if (item.id === 'text') {
            return (
                <div className={`${widgetBase} px-4 py-3`} style={{
                    color: contentColor,
                    background: 'linear-gradient(145deg, rgba(255,250,221,0.92), rgba(255,255,255,0.56))',
                }}>
                    <div className="text-[12px] font-bold truncate">{theme.textWidget?.title || '便签'}</div>
                    <div className="text-[11px] leading-snug opacity-70 line-clamp-4 mt-1 whitespace-pre-wrap">
                        {theme.textWidget?.body || '没有写东西'}
                    </div>
                </div>
            );
        }
        if (item.id === 'image' || item.id === 'imgtl' || item.id === 'imgtr' || item.id === 'imgwide') {
            const slot = item.id === 'image' ? 'dsq' : item.id === 'imgtl' ? 'tl' : item.id === 'imgtr' ? 'tr' : 'wide';
            const src = theme.launcherWidgets?.[slot];
            return src ? (
                <div className="w-full h-full rounded-[1.4rem] overflow-hidden border border-white/35 shadow-[0_16px_34px_-24px_rgba(15,23,42,0.65)]">
                    <img src={src} className="w-full h-full object-cover" alt="" loading="lazy" />
                </div>
            ) : (
                <div className={`${widgetBase} flex items-center justify-center text-[11px] opacity-55`} style={translucent}>图片</div>
            );
        }
        return null;
    };

    // ── 各页面渲染 ──
    const renderScreen = () => {
        // 点开动画期间强制回到桌面（高亮目标图标）
        const app = phase === 'finished' ? 'home' : (opening ? 'home' : (currentStep?.app || 'home'));
        if (app === 'chat-list') {
            return (
                <div className="flex-1 overflow-hidden flex flex-col">
                    <div className="px-5 pt-12 pb-3 text-[15px] font-bold text-slate-800 border-b border-slate-100 bg-white/90">絮语</div>
                    <div className="flex-1 overflow-y-auto no-scrollbar bg-white/80">
                        {contacts.map(({ char: c, preview }) => (
                            <div key={c.id} className={`px-4 py-3 flex items-center gap-3 border-b border-slate-50 ${targetChar?.id === c.id ? 'bg-amber-50' : ''}`}>
                                <img src={c.avatar} className="w-11 h-11 rounded-lg object-cover shrink-0" alt="" />
                                <div className="flex-1 min-w-0">
                                    <div className="text-[14px] font-medium text-slate-800 truncate">{c.name}</div>
                                    <div className="text-[12px] text-slate-400 truncate">{preview}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            );
        }
        if (app === 'chat-thread' && targetChar) {
            return (
                <div className="flex-1 overflow-hidden flex flex-col">
                    <div className="px-5 pt-12 pb-3 text-[15px] font-bold text-slate-800 border-b border-slate-100 bg-white/90 flex items-center gap-2">
                        <img src={targetChar.avatar} className="w-6 h-6 rounded-md object-cover" alt="" />
                        {targetChar.name}
                    </div>
                    <div className="flex-1 overflow-y-auto no-scrollbar bg-[#f3f3f3] px-3 py-3 space-y-2">
                        {threadMsgs.length === 0 && <div className="text-center text-xs text-slate-400 pt-8">（没有聊天记录）</div>}
                        {threadMsgs.map(m => (
                            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[75%] px-3 py-2 rounded-xl text-[12px] leading-relaxed whitespace-pre-wrap break-words ${m.role === 'user' ? 'bg-[#95ec69] text-slate-800' : 'bg-white text-slate-700'}`}>
                                    {m.type === 'image' ? '[图片]' : m.type === 'emoji' ? '[表情]' : m.type === 'voice' ? '[语音]' : String(m.content || '').slice(0, 200)}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            );
        }
        if (app === 'moments') {
            return (
                <div className="flex-1 overflow-hidden flex flex-col">
                    <div className="px-5 pt-12 pb-3 text-[15px] font-bold text-slate-800 border-b border-slate-100 bg-white/90">此刻</div>
                    <div className="flex-1 overflow-y-auto no-scrollbar bg-white/80 px-4 py-3 space-y-4">
                        {moments.length === 0 && <div className="text-center text-xs text-slate-400 pt-10">（此刻空空如也）</div>}
                        {moments.map(p => (
                            <div key={p.id} className="border-b border-slate-50 pb-3">
                                <div className="flex items-center gap-2 mb-1.5">
                                    {p.authorAvatar
                                        ? <img src={p.authorAvatar} className="w-8 h-8 rounded-lg object-cover shrink-0" alt="" />
                                        : <div className="w-8 h-8 rounded-lg bg-slate-200 shrink-0" />}
                                    <span className="text-[13px] font-bold text-slate-700">{p.authorName}</span>
                                </div>
                                <div className="text-[12px] text-slate-600 leading-relaxed line-clamp-3 whitespace-pre-wrap">{p.content || p.title}</div>
                                {(p.images?.length || 0) > 0 && (
                                    <div className="flex gap-1.5 mt-2">
                                        {p.images.slice(0, 3).map((img, i) => (
                                            <img key={i} src={img} className="w-16 h-16 rounded-lg object-cover" alt="" loading="lazy" />
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            );
        }
        if (app === 'twitter') return renderTwitterApp();
        if (app === 'schedule') {
            return (
                <div className="flex-1 overflow-hidden flex flex-col">
                    <div className="px-5 pt-12 pb-3 text-[15px] font-bold text-slate-800 border-b border-slate-100 bg-white/90">日程</div>
                    <div className="flex-1 overflow-y-auto no-scrollbar bg-white/80 px-4 py-3 space-y-2">
                        {annivs.length === 0 && tasks.length === 0 && <div className="text-center text-xs text-slate-400 pt-10">（日程上什么都没记）</div>}
                        {annivs.map(a => (
                            <div key={a.id} className="flex items-center gap-3 bg-slate-50 rounded-xl px-3 py-2.5">
                                <div className="text-[11px] font-mono text-cyan-600 shrink-0">{a.date}</div>
                                <div className="text-[13px] text-slate-700 truncate">{a.title}</div>
                            </div>
                        ))}
                        {tasks.map(t => (
                            <div key={t.id} className="flex items-center gap-3 bg-white rounded-xl px-3 py-2.5 border border-slate-100">
                                <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${t.isCompleted ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                                <div className="min-w-0 flex-1">
                                    <div className="text-[13px] text-slate-700 truncate">{t.title}</div>
                                    {t.deadline && <div className="text-[10px] text-slate-400 mt-0.5">截止 {t.deadline}</div>}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            );
        }
        if (app === 'gallery') {
            return (
                <div className="flex-1 overflow-hidden flex flex-col">
                    <div className="px-5 pt-12 pb-3 text-[15px] font-bold text-slate-800 border-b border-slate-100 bg-white/90">相册</div>
                    <div className="flex-1 overflow-y-auto no-scrollbar bg-white/80 p-2">
                        {galleryImgs.length === 0 && <div className="text-center text-xs text-slate-400 pt-10">（相册里没有照片）</div>}
                        <div className="grid grid-cols-3 gap-1.5">
                            {galleryImgs.map(g => (
                                <img key={g.id} src={g.url} className="w-full aspect-square rounded-lg object-cover" alt="" loading="lazy" />
                            ))}
                        </div>
                    </div>
                </div>
            );
        }
        if (app === 'music') {
            return (
                <div className="flex-1 overflow-hidden flex flex-col">
                    <div className="px-5 pt-12 pb-3 text-[15px] font-bold text-slate-800 border-b border-slate-100 bg-white/90">音乐</div>
                    <div className="flex-1 bg-white/80 flex flex-col items-center justify-center gap-3 text-slate-400">
                        <div className="text-5xl">🎧</div>
                        <div className="text-xs">TA 在看你最近在听什么…</div>
                    </div>
                </div>
            );
        }
        if (app === 'phone') return renderPhoneApp();
        if (app === 'shop') return renderShopApp();
        if (app === 'takeout') return renderTakeoutApp();
        if (app === 'wallet') return renderWalletApp();
        if (app === 'browser') return renderBrowserApp();
        if (app === 'map') return renderMapApp();
        // home / finished / opening：用户实时真实的桌面（真壁纸 + 全部 App + dock；
        // opening 时高亮即将点开的图标）
        const openingIcon = opening && opening !== 'home' ? STEP_ICON[opening as Exclude<StepApp, 'home'>] : null;
        const currentDesktopPage = desktopSnapshot.pages[desktopSnapshot.activePage] || desktopSnapshot.pages[0] || [];
        const tappedApp = openingIcon ? INSTALLED_APPS.find(a => a.icon === openingIcon) : null;
        return (
            <div className="flex-1 overflow-hidden flex flex-col relative" style={wallpaperBackground(theme.wallpaper)}>
                {widgetCustomCss && <style>{widgetCustomCss}</style>}
                <div className="text-white text-sm font-bold pt-16 pb-3 text-center shrink-0" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.45)' }}>
                    {userProfile.name} 的手机
                </div>
                <div className="relative flex-1 min-h-0 px-5 pb-2 pointer-events-none">
                    {desktopSnapshot.activePage === 2 && theme.desktopDecorations && theme.desktopDecorations.length > 0 && (
                        <div className="absolute inset-0 overflow-hidden z-20">
                            {theme.desktopDecorations.map(deco => (
                                <img
                                    key={deco.id}
                                    src={deco.content}
                                    alt=""
                                    loading="lazy"
                                    className="absolute w-16 h-16 object-contain select-none"
                                    style={{
                                        left: `${deco.x}%`,
                                        top: `${deco.y}%`,
                                        transform: `translate(-50%, -50%) scale(${deco.scale}) rotate(${deco.rotation}deg)${deco.flip ? ' scaleX(-1)' : ''}`,
                                        opacity: deco.opacity,
                                        zIndex: deco.zIndex,
                                        filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.18))',
                                    }}
                                />
                            ))}
                        </div>
                    )}
                    <div
                        className="relative z-10 h-full grid grid-cols-4 gap-x-2 gap-y-2"
                        style={{ gridTemplateRows: `repeat(${PAGE_ROWS}, minmax(0, 1fr))` }}
                    >
                        {currentDesktopPage.map(({ item, col, row }) => (
                            <div
                                key={item.key}
                                className={`relative min-w-0 min-h-0 transition-[transform,opacity,filter] duration-300 ${item.kind === 'widget' ? `moro-widget-${item.id}` : ''}`}
                                style={{
                                    gridColumn: `${col + 1} / span ${item.w}`,
                                    gridRow: `${row + 1} / span ${item.h}`,
                                }}
                            >
                                {renderDesktopItem(item, openingIcon)}
                            </div>
                        ))}
                    </div>
                </div>
                {desktopSnapshot.pages.length > 1 && (
                    <div className="shrink-0 flex justify-center gap-1.5 py-1">
                        {desktopSnapshot.pages.map((_, idx) => (
                            <span
                                key={idx}
                                className={`h-1.5 rounded-full transition-all ${idx === desktopSnapshot.activePage ? 'w-5 bg-white/85' : 'w-1.5 bg-white/45'}`}
                                style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.28)' }}
                            />
                        ))}
                    </div>
                )}
                {openingIcon && (
                    <div className="text-center text-white text-xs animate-fade-in pb-1" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.45)' }}>
                        {char.name} 点开了「{tappedApp?.name || STEP_LABEL[opening || 'home']}」…
                    </div>
                )}
                {phase === 'finished' && (
                    <div className="text-center text-white text-sm font-medium animate-fade-in pb-1" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.45)' }}>
                        {char.name} 翻完了，把手机放回了原处…
                    </div>
                )}
                {/* 真实 dock（与桌面同款配置） */}
                <div className="shrink-0 flex justify-center px-4 pb-3">
                    <div className="glass-pill rounded-full px-4 py-2 flex gap-4 items-center max-w-full overflow-x-auto no-scrollbar">
                        {dockApps.map(a => (
                            <AppIcon key={a.id} app={a} onClick={() => { /* 角色在翻手机：禁点 */ }} variant="dock" size="sm" />
                        ))}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="absolute inset-0 z-[430] overflow-hidden animate-fade-in bg-black text-slate-900">
            <style>{`
                @keyframes phoneCheckScan { 0% { transform: translateY(-28%); opacity: 0; } 18% { opacity: .32; } 100% { transform: translateY(118%); opacity: 0; } }
                @keyframes phoneCheckTap { 0% { transform: translate(-50%, -50%) scale(.4); opacity: .85; } 100% { transform: translate(-50%, -50%) scale(2.25); opacity: 0; } }
                @keyframes phoneCheckGrip { 0%,100% { transform: translateY(0) rotate(var(--r)); } 50% { transform: translateY(-3px) rotate(var(--r)); } }
            `}</style>

            {/* 主屏：直接铺满用户当前手机画面。 */}
            {phase === 'loading' ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-white" style={wallpaperBackground(theme.wallpaper)}>
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
                    <div className="relative w-10 h-10 border-4 border-white/25 border-t-white rounded-full animate-spin" />
                    <div className="relative text-xs font-bold drop-shadow">{char.name} 拿起了你的手机，正在解锁…</div>
                </div>
            ) : (
                <div className="absolute inset-0 flex flex-col bg-slate-950">
                    {renderScreen()}
                </div>
            )}

            {/* 拿手机的手感：边缘暗角、手指遮挡、扫光和点按波纹。 */}
            <div className="pointer-events-none absolute inset-0 z-10">
                <div className="absolute inset-0" style={{ boxShadow: 'inset 0 0 46px rgba(0,0,0,0.34)' }} />
                <div className="absolute left-8 right-8 h-20 rounded-full bg-white/20 blur-2xl" style={{ top: '18%', animation: 'phoneCheckScan 3.2s ease-in-out infinite' }} />
                <div className="absolute -bottom-20 -left-10 w-40 h-44 rounded-[48%] bg-black/40 blur-xl" style={{ '--r': '-9deg', animation: 'phoneCheckGrip 4s ease-in-out infinite' } as React.CSSProperties} />
                <div className="absolute -bottom-20 -right-10 w-40 h-44 rounded-[48%] bg-black/40 blur-xl" style={{ '--r': '8deg', animation: 'phoneCheckGrip 4.4s ease-in-out infinite' } as React.CSSProperties} />
                {opening && (
                    <div className="absolute left-1/2 top-[58%] w-16 h-16 rounded-full border-2 border-white/80 bg-white/10" style={{ animation: 'phoneCheckTap 780ms ease-out both' }} />
                )}
            </div>

            {/* 顶部悬浮状态 + 退出申请。 */}
            <div className="absolute left-3 right-3 z-30 flex items-center justify-between pointer-events-none"
                style={{ top: 'max(10px, var(--safe-top))' }}>
                <div className="flex items-center gap-2 min-w-0">
                    <img src={char.avatar} className="w-7 h-7 rounded-full object-cover ring-2 ring-white shadow-sm shrink-0" alt="" />
                    <span className="text-xs font-bold text-white truncate px-3 py-2 rounded-full bg-black/40 backdrop-blur-xl shadow-lg">
                        {phase === 'loading' ? `${char.name} 拿走了你的手机…` : `${char.name} 正在看你的手机`}
                    </span>
                </div>
                {phase === 'browsing' && !endedRef.current && (
                    <button
                        onClick={() => { setExitOpen(true); setExitTab('menu'); setConsentReply(''); setJudgeComment(''); }}
                        className="pointer-events-auto shrink-0 px-3 py-2 rounded-full bg-white/90 text-slate-700 text-[11px] font-bold border border-white/70 shadow-[0_12px_24px_-14px_rgba(0,0,0,0.8)] active:scale-95 transition-all backdrop-blur-xl"
                    >
                        我想拿回手机
                    </button>
                )}
            </div>

            {/* 左下角想法框 */}
            {phase === 'browsing' && currentStep && (
                <div key={stepIdx} className="absolute left-3 bottom-6 max-w-[78%] z-30 animate-fade-in">
                    <div className="backdrop-blur rounded-2xl rounded-bl-md px-4 py-3 shadow-xl border" style={{ background: 'rgba(255,253,250,0.92)', color: '#5a3140', borderColor: '#eed6df' }}>
                        <div className="flex items-center gap-1.5 mb-1">
                            <img src={char.avatar} className="w-4 h-4 rounded-full object-cover" alt="" />
                            <span className="text-[9px] font-bold opacity-60 tracking-wider">{char.name} 的想法</span>
                        </div>
                        <div className="text-[12px] leading-relaxed">{currentStep.thought}</div>
                    </div>
                </div>
            )}

            {/* 退出闸门弹窗 */}
            {exitOpen && (
                <div className="absolute inset-0 z-40 flex items-center justify-center animate-fade-in p-6" style={{ background: 'rgba(20,20,28,0.4)', backdropFilter: 'blur(4px)' }}>
                    <div className="w-full max-w-[320px] bg-white rounded-[1.6rem] overflow-hidden shadow-2xl relative">
                        <div className="px-5 pt-5 pb-3 text-center">
                            <div className="text-[15px] font-bold" style={{ color: '#5a3140' }}>想拿回手机？</div>
                            <div className="text-[12px] text-slate-500 mt-1.5 leading-relaxed">
                                {char.name} 还没看完。你可以征求 TA 同意、回答 TA 的问题，或者……直接抢回来。
                            </div>
                        </div>

                        {exitTab === 'menu' && (
                            <div className="px-5 pb-5 space-y-2">
                                <button onClick={() => { setExitTab('consent'); void askConsent(); }} disabled={exitBusy}
                                    className="w-full py-2.5 rounded-2xl text-white text-[13px] font-bold shadow-lg active:scale-95 transition-all disabled:opacity-50" style={{ background: '#d8a5b7', boxShadow: '0 12px 24px -16px rgba(122,90,114,0.45)' }}>
                                    好声好气地要回来（征得同意）
                                </button>
                                <button onClick={() => setExitTab('questions')} disabled={exitBusy}
                                    className="w-full py-2.5 rounded-2xl bg-slate-100 text-slate-700 text-[13px] font-bold active:scale-95 transition-all disabled:opacity-50">
                                    回答 TA 的三个问题
                                </button>
                                <button onClick={() => { void finish('forced', `${userProfile.name} 一把抢回了手机，${char.name} 没看完。`); }} disabled={exitBusy}
                                    className="w-full py-2.5 rounded-2xl bg-white text-rose-500 text-[13px] font-bold border border-rose-200 active:scale-95 transition-all disabled:opacity-50">
                                    强制抢回（TA 会记住的）
                                </button>
                                <button onClick={() => setExitOpen(false)}
                                    className="w-full py-2 text-[12px] text-slate-400">算了，让 TA 继续看</button>
                            </div>
                        )}

                        {exitTab === 'consent' && (
                            <div className="px-5 pb-5 space-y-3">
                                {exitBusy ? (
                                    <div className="flex items-center justify-center gap-2 py-4 text-xs text-slate-400">
                                        <div className="w-4 h-4 border-2 border-slate-200 border-t-slate-500 rounded-full animate-spin" />
                                        {char.name} 在考虑…
                                    </div>
                                ) : consentReply ? (
                                    <div className="bg-slate-50 rounded-xl px-4 py-3 text-[13px] text-slate-700 leading-relaxed">
                                        {char.name}：「{consentReply}」
                                    </div>
                                ) : null}
                                {!exitBusy && consentReply && (
                                    <button onClick={() => { setExitTab('menu'); setConsentReply(''); }}
                                        className="w-full py-2 text-[12px] text-slate-400">TA 不同意…换个方式</button>
                                )}
                            </div>
                        )}

                        {exitTab === 'questions' && (
                            <div className="px-5 pb-5 space-y-3">
                                {(script?.exitQuestions || []).map((q, i) => (
                                    <div key={i}>
                                        <div className="text-[12px] font-medium text-slate-600 mb-1">{i + 1}. {q}</div>
                                        <input
                                            value={answers[i]}
                                            onChange={e => setAnswers(prev => prev.map((a, j) => j === i ? e.target.value : a))}
                                            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-[12px] outline-none focus:border-indigo-300"
                                            placeholder="你的回答…"
                                            disabled={exitBusy}
                                        />
                                    </div>
                                ))}
                                {judgeComment && (
                                    <div className="bg-slate-50 rounded-xl px-4 py-3 text-[13px] text-slate-700 leading-relaxed">
                                        {char.name}：「{judgeComment}」
                                    </div>
                                )}
                                <button onClick={() => void submitAnswers()} disabled={exitBusy}
                                    className="w-full py-2.5 rounded-2xl text-white text-[13px] font-bold shadow-lg active:scale-95 transition-all disabled:opacity-50" style={{ background: '#d8a5b7', boxShadow: '0 12px 24px -16px rgba(122,90,114,0.45)' }}>
                                    {exitBusy ? 'TA 在听…' : '交卷'}
                                </button>
                                <button onClick={() => { setExitTab('menu'); setJudgeComment(''); }}
                                    className="w-full py-1.5 text-[12px] text-slate-400">返回</button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default CharPhoneCheckOverlay;
