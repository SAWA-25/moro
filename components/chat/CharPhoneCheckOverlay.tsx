import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AmbientSocialEntry, CharacterProfile, UserProfile, Message, SocialPost, GalleryImage, Anniversary, AppID, PhoneCallLog, Task, TakeoutOrder, OSTheme, TwitterTweet, TwitterDMThread, PhoneCheckSession, PhoneEvidenceRisk, AppConfig, XhsFeedPost } from '../../types';
import { DB } from '../../utils/db';
import { resolveCart, cartTotal, expandCart, makeOwnedItem, makeReceipt, formatPrice as fmtPrice } from '../../utils/shop';
import { extractContent } from '../../utils/safeApi';
import { blockCharacterByUser } from '../../utils/blockActions';
import { recordCharUnlockFail } from '../../utils/lockAttempts';
import { INSTALLED_APPS, DOCK_APPS } from '../../constants';
import { useOS } from '../../context/OSContext';
import AppIcon from '../os/AppIcon';
import { liveTakeoutStatus, STATUS_LABEL } from '../../utils/takeout';
import { isDevDebugAvailable } from '../../utils/devDebug';
import { getTwitterLocalTargetLang, getTwitterTranslationText } from '../../utils/twitterFeed';
import { toWallpaperBackground } from '../../utils/defaultWallpapers';
import { isNativeNotificationRuntime } from '../../utils/browserNotify';
import { callChatCompletion } from '../../utils/llmClient';
import { makeApiUsageMeta } from '../../utils/apiUsageCatalog';
import {
    buildPhoneCheckSessionSummary,
    createPhoneCheckSession,
    formatCharPhoneCheckVisibleRecord,
    makePhoneCheckAction,
    normalizePhoneCheckStep,
} from '../../utils/checkPhone';
import { charPhoneCheckScriptGuard } from '../../utils/laiwangPrompts';
import { buildFullActiveUserSetting, buildFullCharacterSetting } from '../../utils/characterPromptProfile';

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
    | 'map'
    | AppID
    | (string & {});

export interface ScriptAction {
    // reply/block/delete/ignore 作用在 chat-thread；post_moment 仅作用在 moments（絮语·此刻，代发动态）；
    // clear_cart 作用在 shop（帮用户清空购物车·代付）
    type: 'none' | 'reply' | 'block' | 'delete' | 'ignore' | 'post_moment' | 'clear_cart';
    content?: string;
}

export interface ScriptStep {
    app: StepApp;
    targetName?: string;
    thought: string;
    intent?: string;
    emotion?: string;
    risk?: PhoneEvidenceRisk;
    visibleClue?: string;
    actionReason?: string;
    action?: ScriptAction;
}

export interface CheckScript {
    steps: ScriptStep[];
    exitQuestions: string[];
    endHint?: string;
}

interface ContactSnap {
    id: string;
    source: 'formal' | 'ambient';
    kind: 'contact' | 'group';
    name: string;
    avatar?: string;
    label?: string;
    preview: string;
    lastAt: number;
    char?: CharacterProfile;
    ambient?: AmbientSocialEntry;
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
    apiConfig: { baseUrl: string; apiKey?: string; model: string; apiRole?: string; apiBinding?: string };
    updateCharacter: (id: string, updates: Partial<CharacterProfile>) => Promise<void> | void;
    updateUserProfile: (updates: Partial<UserProfile>) => void;
    addToast: (msg: string, type: 'info' | 'success' | 'error') => void;
    /** 结束（记录已落库）。exitMode 用于宿主提示文案 */
    onEnd: (exitMode: 'consent' | 'questions' | 'forced' | 'finished') => void;
}

const STEP_MS = 6500;            // 每一步停留时长（想法框阅读时间）
const TAP_MS = 950;              // 「点开 App」动画时长：先回桌面按图标，再进入页面
// 浏览步骤 → 桌面图标（点开动画里高亮哪个图标）
const BUILTIN_STEP_APPS = new Set<string>([
    'home',
    'chat-list',
    'chat-thread',
    'moments',
    'twitter',
    'schedule',
    'gallery',
    'music',
    'phone',
    'shop',
    'takeout',
    'wallet',
    'browser',
    'map',
]);

const APP_ID_SET = new Set<string>(INSTALLED_APPS.map(app => app.id));

const STATIC_STEP_ICON: Record<string, string> = {
    'chat-list': 'Chat',
    'chat-thread': 'Chat',
    moments: 'Chat',
    twitter: 'Twitter',
    schedule: 'Almanac',
    gallery: 'Gallery',
    music: 'Music',
    phone: 'Phone',
    shop: 'Shop',
    takeout: 'Takeout',
    wallet: 'Bank',
    browser: 'HotNews',
    map: 'Xunji',
    [AppID.GroupChat]: 'Chat',
    [AppID.Almanac]: 'Almanac',
    [AppID.Bank]: 'Bank',
    [AppID.HotNews]: 'HotNews',
};

const STATIC_STEP_LABEL: Record<string, string> = {
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
    [AppID.GroupChat]: '絮语',
    [AppID.Almanac]: '岁时记',
    [AppID.Bank]: '人生拟',
    [AppID.HotNews]: '热点',
};

const getStepAppConfig = (app?: StepApp | null): AppConfig | undefined =>
    app ? INSTALLED_APPS.find(item => item.id === app) : undefined;

const getStepIcon = (app?: StepApp | null): string | null =>
    app && app !== 'home' ? (STATIC_STEP_ICON[app] || getStepAppConfig(app)?.icon || null) : null;

const getStepLabel = (app?: StepApp | null): string =>
    app ? (STATIC_STEP_LABEL[app] || getStepAppConfig(app)?.name || String(app)) : '手机';

const normalizeScriptStepApp = (value: unknown): StepApp => {
    const app = String(value || '').trim();
    if (BUILTIN_STEP_APPS.has(app) || APP_ID_SET.has(app)) return app as StepApp;
    return 'home';
};

const normalizeScriptAction = (raw: unknown, app: StepApp): ScriptAction | undefined => {
    if (!raw || typeof raw !== 'object') return undefined;
    const obj = raw as Record<string, unknown>;
    let type = (['none', 'reply', 'block', 'delete', 'ignore', 'post_moment', 'clear_cart'].includes(String(obj.type))
        ? String(obj.type)
        : 'none') as ScriptAction['type'];
    if (type === 'post_moment' && app !== 'moments') type = 'none';
    if ((type === 'reply' || type === 'block' || type === 'delete' || type === 'ignore') && app !== 'chat-thread') type = 'none';
    return {
        type,
        content: typeof obj.content === 'string' ? obj.content.slice(0, 300) : undefined,
    };
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

interface PhoneCheckBrowseTarget {
    key: StepApp;
    label: string;
    icon: string;
    source: string;
}

const buildPhoneCheckBrowseTargets = (
    snapshot: UserDesktopSnapshot,
    dockApps: AppConfig[],
): PhoneCheckBrowseTarget[] => {
    const seen = new Set<string>();
    const targets: PhoneCheckBrowseTarget[] = [];
    const pushApp = (app: AppConfig | undefined, source: string) => {
        if (!app || seen.has(app.id)) return;
        seen.add(app.id);
        targets.push({ key: app.id as StepApp, label: app.name, icon: app.icon, source });
    };

    snapshot.pages.forEach((page, pageIndex) => {
        page.forEach(placed => {
            if (placed.item.kind !== 'app') return;
            pushApp(INSTALLED_APPS.find(app => app.id === placed.item.id), `桌面第 ${pageIndex + 1} 页`);
        });
    });
    dockApps.forEach(app => pushApp(app, 'Dock'));
    return targets;
};

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
    return {
        background: toWallpaperBackground(wallpaper, 'linear-gradient(160deg, #6d83b2 0%, #a4b0c8 55%, #d8c8b8 100%)'),
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
    };
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

export const safeParsePhoneCheckScript = (raw: string): CheckScript | null => {
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
        .map((s: any) => {
            const app = normalizeScriptStepApp(s.app);
            return {
                app,
                targetName: typeof s.targetName === 'string' ? s.targetName : undefined,
                thought: String(s.thought).slice(0, 300),
                intent: typeof s.intent === 'string' ? s.intent.slice(0, 80) : undefined,
                emotion: typeof s.emotion === 'string' ? s.emotion.slice(0, 40) : undefined,
                risk: (['normal', 'private', 'suspicious'].includes(String(s.risk || '').toLowerCase()) ? String(s.risk).toLowerCase() : undefined) as PhoneEvidenceRisk | undefined,
                visibleClue: typeof s.visibleClue === 'string' ? s.visibleClue.slice(0, 240) : undefined,
                actionReason: typeof s.actionReason === 'string' ? s.actionReason.slice(0, 240) : undefined,
                action: normalizeScriptAction(s.action, app),
            };
        });
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
    const nativeRuntime = isNativeNotificationRuntime();
    const desktopSnapshot = useMemo(() => buildUserDesktopSnapshot(theme), [theme]);
    const widgetCustomCss = useMemo(() => {
        const prefs = theme.desktopWidgetPrefs || {};
        return Object.values(prefs).map(p => p?.customCss || '').filter(Boolean).join('\n');
    }, [theme.desktopWidgetPrefs]);
    const dockApps = useMemo(
        () => DOCK_APPS.map(id => INSTALLED_APPS.find(a => a.id === id)).filter((a): a is typeof INSTALLED_APPS[number] => !!a),
        []
    );
    const desktopBrowseTargets = useMemo(
        () => buildPhoneCheckBrowseTargets(desktopSnapshot, dockApps),
        [desktopSnapshot, dockApps],
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
    const [xhsPosts, setXhsPosts] = useState<XhsFeedPost[]>([]);
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
    const archivedStepsRef = useRef<Set<number>>(new Set());
    const phoneCheckSessionRef = useRef<PhoneCheckSession | null>(null);
    const actionLogRef = useRef<string[]>([]);
    actionLogRef.current = actionLog;

    const savePhoneCheckSession = (updater: (prev: PhoneCheckSession) => PhoneCheckSession) => {
        const prev = phoneCheckSessionRef.current;
        if (!prev) return;
        const next = updater(prev);
        phoneCheckSessionRef.current = next;
        void DB.savePhoneCheckSession(next);
    };

    const recordSessionAction = (input: Parameters<typeof makePhoneCheckAction>[0]) => {
        savePhoneCheckSession(prev => ({
            ...prev,
            actions: [...prev.actions, makePhoneCheckAction(input)],
        }));
    };

    useEffect(() => {
        const session = createPhoneCheckSession({
            direction: 'char_to_user',
            charId: char.id,
            charName: char.name,
            userName: userProfile.name || '用户',
            mode: 'deep',
        });
        phoneCheckSessionRef.current = session;
        void DB.savePhoneCheckSession(session);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const llm = async (prompt: string, temperature = 0.9): Promise<string> => {
        const data = await callChatCompletion(apiConfig, {
            model: apiConfig.model,
            messages: [{ role: 'user', content: prompt }],
            temperature,
            stream: false,
        }, {
            meta: makeApiUsageMeta('checkPhone.generate', {
                charId: char.id,
                charName: char.name,
                apiRole: apiConfig.apiRole || 'aux',
                apiBinding: apiConfig.apiBinding || '反向查岗',
            }),
            presetMacros: { charName: char.name, userName: userProfile.name || '用户' },
        });
        return (extractContent(data) || '').trim();
    };

    const buildCharPhoneCheckRoleContext = useCallback(async () => {
        const fullUserSetting = await buildFullActiveUserSetting(userProfile, {
            fallback: `用户名：${userProfile.name || '用户'}`,
        });
        return [
            buildFullCharacterSetting(char, { includeMemos: true }),
            fullUserSetting,
        ].filter(Boolean).join('\n\n');
    }, [char, userProfile]);

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
                            id: c.id,
                            source: 'formal',
                            kind: 'contact',
                            name: c.name,
                            avatar: c.avatar,
                            char: c,
                            preview: lastVisible ? String(lastVisible.content || '').slice(0, 60) : '（暂无消息）',
                            lastAt: lastVisible?.timestamp || 0,
                        });
                    } catch {
                        snaps.push({
                            id: c.id,
                            source: 'formal',
                            kind: 'contact',
                            name: c.name,
                            avatar: c.avatar,
                            char: c,
                            preview: '（暂无消息）',
                            lastAt: 0,
                        });
                    }
                }
                if (userProfile.ambientSocialEnabled !== false) {
                    const ambientEntries = Array.isArray(userProfile.ambientSocial?.entries) ? userProfile.ambientSocial.entries : [];
                    for (const entry of ambientEntries) {
                        if (!entry || entry.hidden) continue;
                        if (entry.kind === 'contact' && entry.linkedCharId) continue;
                        if (entry.kind === 'group' && entry.linkedGroupId) continue;
                        const preview = String(entry.lastMessage || entry.note || '（社交圈联系人，暂无最近消息）').slice(0, 60);
                        snaps.push({
                            id: `ambient:${entry.id}`,
                            source: 'ambient',
                            kind: entry.kind,
                            name: entry.name,
                            avatar: entry.avatar,
                            label: entry.kind === 'group' ? '社交圈群聊' : (entry.relationLabel || '社交圈联系人'),
                            preview,
                            lastAt: entry.lastAt || entry.createdAt || 0,
                            ambient: entry,
                        });
                    }
                }
                snaps.sort((a, b) => b.lastAt - a.lastAt);
                if (cancelled) return;
                setContacts(snaps);

                // 最近活跃的几个对话给角色"翻记录"的素材
                const excerptTargets = snaps.filter(s => s.source === 'formal' && s.char && s.lastAt > 0).slice(0, 4);
                const excerpts: string[] = [];
                const locationSnaps: LocationSnap[] = [];
                for (const t of excerptTargets) {
                    try {
                        if (!t.char) continue;
                        const msgs = await DB.getRecentMessagesByCharId(t.char.id, 12);
                        msgs
                            .filter(m => m.type === 'location')
                            .slice(-2)
                            .forEach(m => locationSnaps.push({
                                source: t.char?.name || t.name,
                                title: String(m.content || '位置分享').slice(0, 50),
                                detail: typeof m.metadata?.address === 'string' ? m.metadata.address.slice(0, 80) : undefined,
                                at: m.timestamp || 0,
                            }));
                        const lines = msgs
                            .filter(m => m.role !== 'system' && typeof m.content === 'string')
                            .map(m => `${m.role === 'user' ? userProfile.name : t.name}: ${String(m.content).slice(0, 80)}`)
                            .join('\n');
                        if (lines) excerpts.push(`【与「${t.name}」的最近对话】\n${lines}`);
                    } catch { /* 单个对话取不到不阻塞 */ }
                }
                if (cancelled) return;

                // 朋友圈 / 相册 / 纪念日真实快照：页面展示 + 喂给脚本生成（想法贴真实内容）
                let momentsSnap: SocialPost[] = [];
                let xhsSnap: XhsFeedPost[] = [];
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
                    xhsSnap = (await DB.getXhsFeedPosts())
                        .sort((a, b) => b.createdAt - a.createdAt)
                        .slice(0, 8);
                } catch { /* ignore */ }
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
                setXhsPosts(xhsSnap);
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
                            : `天气使用${nativeRuntime ? '手机定位' : '浏览器定位'}`)
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
                const xhsBrief = xhsSnap
                    .map(p => `- ${p.author}：「${String(p.title || '').slice(0, 40)}」${String(p.body || '').slice(0, 70)}${p.tags?.length ? ` #${p.tags.slice(0, 3).join(' #')}` : ''}`)
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
                const targetHint = (target: PhoneCheckBrowseTarget): string => {
                    const key = String(target.key);
                    if (key === AppID.GroupChat || key === 'chat-list') return `可看聊天列表、群聊、联系人和此刻入口；当前列表里有 ${snaps.length} 个可见联系人/群聊，想深入某人对话时下一步用 "chat-thread"。`;
                    if (key === 'moments') return `絮语里的「此刻」动态子页；最近公开动态 ${momentsSnap.length} 条。只有动态本身触动动机时才看，不是默认查岗落点。`;
                    if (key === AppID.Social) return `见闻簿本地信息流；最近卡片 ${xhsSnap.length} 条${xhsSnap[0]?.title ? `，最新「${xhsSnap[0].title.slice(0, 28)}」` : ''}。`;
                    if (key === AppID.Twitter || key === 'twitter') return `推特时间线 ${twitterSnap.length} 条、私信 ${twitterDMSnap.length} 个。`;
                    if (key === AppID.Almanac || key === AppID.Schedule || key === 'schedule') return `岁时记/日程；纪念日 ${annivSnap.length} 条，待办 ${taskSnap.length} 条。`;
                    if (key === AppID.Gallery || key === 'gallery') return `相册；最近照片/截图 ${gallerySnap.length} 张。`;
                    if (key === AppID.Phone || key === 'phone') return `回声亭；通话记录 ${callSnap.length} 条。`;
                    if (key === AppID.Takeout || key === 'takeout') return `饭票；最近外卖/跑腿订单 ${takeoutSnap.length} 条。`;
                    if (key === AppID.Shop || key === 'shop') return resolveCart(userProfile.shopCart).length > 0 ? `心意铺；购物车有 ${resolveCart(userProfile.shopCart).length} 种商品，合计 ¥${fmtPrice(cartTotal(userProfile.shopCart))}。` : '心意铺；购物车是空的。';
                    if (key === AppID.Bank || key === 'wallet') return `人生拟/钱包；账户余额 ¥${fmtPrice(userProfile.balance || 0)}，购物小票 ${(userProfile.shopReceipts || []).length} 条。`;
                    if (key === AppID.HotNews || key === AppID.Browser || key === 'browser') return `热点/浏览；可看当前网页来源和热点平台，不能编真实浏览器后台历史。`;
                    if (key === AppID.Music || key === 'music') return '音乐；可看最近播放入口和音乐小组件痕迹，具体曲目没有快照时不要硬编。';
                    if (key === AppID.Xunji) return '循迹；可看近期屏幕生活痕迹入口，但不要把它写成全知监控报告。';
                    if (key === AppID.Health) return '健康；可看健康记录入口和设置痕迹，未给出具体数值时不要编医疗数据。';
                    if (key === 'map') return `地区/位置线索；目前有 ${nextRegionHints.length + locationSnaps.length} 条位置相关线索。`;
                    return `${target.label} 是用户真实桌面上的 App；可查看入口、最近状态、设置痕迹或与关系有关的本地线索，没有快照时不要凭空编造私密内容。`;
                };
                const desktopTargetBrief = desktopBrowseTargets
                    .map(target => `- "${target.key}" ${target.label}（${target.source}）：${targetHint(target)}`)
                    .join('\n');
                const exampleAppKey = desktopBrowseTargets.find(target => target.key !== AppID.GroupChat)?.key || desktopBrowseTargets[0]?.key || AppID.Gallery;

                const roleContext = await buildCharPhoneCheckRoleContext();
                const prompt = `### 任务
你在扮演角色「${char.name}」。此刻 TA 拿到了 ${userProfile.name}（TA 的聊天对象/亲密的人）的手机，正在查岗翻看。请按 TA 的人设生成一份"查岗浏览脚本"。

### 你的人设
${roleContext}

### ${userProfile.name} 手机里的聊天列表（按最近活跃排序）
${snaps.map(s => {
    const tag = s.source === 'ambient' ? `（${s.label || (s.kind === 'group' ? '社交圈群聊' : '社交圈联系人')}）` : (s.char?.id === char.id ? '（这是你自己和TA的对话）' : '');
    const memberText = s.ambient?.kind === 'group' && s.ambient.memberNames?.length ? `，成员：${s.ambient.memberNames.slice(0, 6).join('、')}` : '';
    return `- ${s.name}${tag}：最后一条「${s.preview}」${memberText}`;
}).join('\n')}

### 可翻看的对话记录节选
${excerpts.join('\n\n') || '（手机里几乎没有聊天记录）'}

### ${userProfile.name} 当前真实桌面 / Dock 可点开的 App
第一步必须是 "home"。之后请按用户真实桌面展开，从下面这些真实 App key 里挑选查看；不要固定去朋友圈，也不要每次都发动态。App 如果没有专门快照，只能写 TA 看到了入口、设置、最近状态或本地痕迹，不能凭空编不存在的隐私内容。
${desktopTargetBrief || '（桌面暂时没有可识别 App，只能停留在 home）'}

絮语内部子页（只有先看絮语或被聊天线索触动时使用）：
- "chat-thread" 某个联系人/群聊的聊天记录：targetName 必填，必须来自上面的聊天列表。
- "moments" 絮语里的「此刻」动态：只有动态线索本身触动查岗动机时才看，不是默认步骤。
- "map" 地区与位置线索：可由天气城市、外卖地址、位置分享或动态地点触发。

### 朋友圈最近的动态
${momentsBrief || '（朋友圈没什么动态）'}

### 见闻簿最近的卡片
${xhsBrief || '（见闻簿暂时没有卡片）'}

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
这次查岗必须围绕一个明确的情绪或剧情动机展开，例如怀疑、吃醋、担心、保护欲、被聊天线索刺到，或关系边界被触动；不能因为无聊、随便看看、系统允许、完成任务感或没话找话而查岗。每一步的 intent 都要能接住这个动机或从真实线索继续延伸，禁止写成“随便看看”“无聊”“系统允许”。
生成 4~7 步浏览动作。第一步必须是 "home"（刚拿到手机看桌面）。第二步以后优先使用「当前真实桌面 / Dock 可点开的 App」里的 key；如果要深入絮语对话再用 "chat-thread"，如果确实被动态触动才用 "moments"。
不要把「moments / 此刻 / 朋友圈」当成固定流程；一次查岗可以完全不看动态，也可以去看岁时记、相册、健康、饭票、见闻簿、热点、设置、剪影集、剪报夹等真实桌面 App。
每一步都要有 thought：${char.name} 看到当前页面时的真实想法（第一人称，30~80字，完全贴合人设——可以吃醋、好奇、欣慰、酸溜溜、占有欲，看到自己的对话框也会有感想）。
每一步还要写 intent / emotion / risk / visibleClue：
- intent：TA 点开这里的动机（如确认关系、找生活线索、吃醋、照顾、试探），必须具体，不要写“随便看看”“无聊”或“系统允许”。
- emotion：这一刻的情绪（1~3个词）。
- risk：normal / private / suspicious；涉及隐私、位置、钱、关系操作时至少 private，准备动手操作时通常 suspicious。
- visibleClue：TA 此刻真实看到的关键线索，必须来自上面的快照或对话节选，不要编真实设备外的新信息。
如果 action 不为 none，再写 actionReason：TA 为什么会按人设做这个越界动作。
${charPhoneCheckScriptGuard(char.name, userProfile.name || '用户')}
翻到任何 App 时，想法要针对上面给出的真实桌面、真实快照或入口状态来写，不要凭空编造内容。twitter 里包含国际时间线和私信概况，看到外文推文时可以提到语言或翻译痕迹。
chat-thread 步骤可以带 action：
- {"type":"reply","content":"…"} 代替 ${userProfile.name} 回复对方（content 是以 ${userProfile.name} 口吻发出的内容）
- {"type":"block"} 把这个联系人拉黑
- {"type":"delete"} 删掉这个好友
- {"type":"ignore"} 看完冷哼一声不动
moments（朋友圈）步骤可以带 action：
- {"type":"post_moment","content":"…"} 代替 ${userProfile.name} 发一条朋友圈（content 是以 ${userProfile.name} 口吻写的动态正文，30~80字）。这是罕见越界动作：只有当 TA 已经真的翻到 moments、且具体动态线索强烈刺激到 TA 时才可能发生；默认不要发，不能为了制造戏剧性或完成流程而发。
任意一步都可带 action（看到购物车有没结算的东西时）：
- {"type":"clear_cart"} 帮 ${userProfile.name} 把心意铺购物车清空（你替 TA 代付）。宠溺/大方/想讨好或心疼 TA 的角色才会这么做；小气、在闹脾气或购物车是空的时候绝不要用。
是否做这些动作、做哪种，严格按人设性格来：温柔克制的角色多半只看不动；占有欲、醋劲或保护欲强，且被具体线索刺激到时，才可能下手——回复别人、拉黑、极少数情况下替TA发动态、或大方地帮 TA 清空购物车。不要为了戏剧性乱来。
另外生成 exitQuestions：3 个问题。${userProfile.name} 想中途拿回手机时，${char.name} 会要求 TA 先回答这 3 个问题（按人设出题：可以是审问、撒娇、试探）。
endHint：一句话，描述 ${char.name} 翻完手机后的整体心情（用于之后 TA 主动发消息的语气基调）。

### 输出
只输出一个 JSON 对象，不要任何其它文字：
{"steps":[{"app":"home","thought":"…","intent":"…","emotion":"…","risk":"normal","visibleClue":"…"},{"app":"${exampleAppKey}","thought":"…","intent":"…","emotion":"…","risk":"private","visibleClue":"${getStepLabel(exampleAppKey)}里的真实线索…"},{"app":"chat-thread","targetName":"…","thought":"…","intent":"…","emotion":"…","risk":"suspicious","visibleClue":"…","actionReason":"…","action":{"type":"reply","content":"…"}}],"exitQuestions":["…","…","…"],"endHint":"…"}`;

                const raw = await llm(prompt);
                if (cancelled) return;
                const parsed = safeParsePhoneCheckScript(raw);
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
    const targetContact = useMemo(() => {
        if (!currentStep?.targetName) return null;
        const targetName = currentStep.targetName.trim();
        return contacts.find(c => c.name === targetName)
            || contacts.find(c => targetName && c.name.includes(targetName))
            || contacts.find(c => targetName && targetName.includes(c.name))
            || null;
    }, [currentStep, contacts]);

    useEffect(() => {
        if (phase !== 'browsing' || !currentStep || archivedStepsRef.current.has(stepIdx)) return;
        archivedStepsRef.current.add(stepIdx);
        const stepRecord = normalizePhoneCheckStep({
            at: Date.now(),
            app: currentStep.app,
            title: getStepLabel(currentStep.app),
            targetName: currentStep.targetName,
            thought: currentStep.thought,
            intent: currentStep.intent,
            emotion: currentStep.emotion,
            risk: currentStep.risk,
            visibleClue: currentStep.visibleClue,
            actionReason: currentStep.actionReason,
        });
        savePhoneCheckSession(prev => ({
            ...prev,
            steps: [...prev.steps, stepRecord],
            actions: [...prev.actions, makePhoneCheckAction({
                type: 'browse_step',
                label: currentStep.targetName ? `查看${getStepLabel(currentStep.app)}：${currentStep.targetName}` : `查看${getStepLabel(currentStep.app)}`,
                detail: currentStep.visibleClue || currentStep.thought,
                app: currentStep.app,
                targetName: currentStep.targetName,
                risk: currentStep.risk,
                riskDelta: currentStep.risk === 'suspicious' ? 0.1 : currentStep.risk === 'private' ? 0.05 : 0.01,
            })],
        }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase, stepIdx, currentStep]);

    const targetChar = useMemo(() => {
        if (targetContact?.char) return targetContact.char;
        if (!currentStep?.targetName) return null;
        return characters.find(c => c.name === currentStep.targetName)
            || characters.find(c => currentStep.targetName && c.name.includes(currentStep.targetName))
            || null;
    }, [currentStep, characters, targetContact]);

    // chat-thread 步骤：正式联系人拉真实对话；社交圈联系人展示影子快照
    useEffect(() => {
        if (!currentStep || currentStep.app !== 'chat-thread') { setThreadMsgs([]); return; }
        if (!targetChar && targetContact?.ambient) {
            const entry = targetContact.ambient;
            const now = Date.now();
            const faux: Message[] = [
                entry.note ? {
                    id: -1,
                    charId: `ambient:${entry.id}`,
                    role: 'system',
                    type: 'text',
                    content: entry.kind === 'group' && entry.memberNames?.length ? `${entry.note}\n成员：${entry.memberNames.join('、')}` : entry.note,
                    timestamp: entry.createdAt || now,
                } as Message : null,
                entry.lastMessage ? {
                    id: -2,
                    charId: `ambient:${entry.id}`,
                    role: 'assistant',
                    type: 'text',
                    content: entry.lastMessage,
                    timestamp: entry.lastAt || now,
                } as Message : null,
            ].filter(Boolean) as Message[];
            setThreadMsgs(faux.filter(m => m.role !== 'system' || !!m.content));
            return;
        }
        if (!targetChar) { setThreadMsgs([]); return; }
        let cancelled = false;
        DB.getRecentMessagesByCharId(targetChar.id, 40)
            .then(msgs => { if (!cancelled) setThreadMsgs(msgs.filter(m => m.role !== 'system')); })
            .catch(() => { if (!cancelled) setThreadMsgs([]); });
        return () => { cancelled = true; };
    }, [stepIdx, currentStep, targetChar, targetContact]);

    // 执行当前步骤的副作用动作（每步只执行一次）
    useEffect(() => {
        if (phase !== 'browsing' || !currentStep?.action || appliedStepsRef.current.has(stepIdx)) return;
        appliedStepsRef.current.add(stepIdx);
        const act = currentStep.action;
        const target = targetChar;
        const targetLabel = target?.name || targetContact?.name;
        const log = (line: string) => setActionLog(prev => [...prev, line]);
        const archiveAction = (type: Parameters<typeof makePhoneCheckAction>[0]['type'], label: string, detail?: string, metadata?: Record<string, any>) => {
            recordSessionAction({
                type,
                label,
                detail,
                targetName: targetLabel,
                app: currentStep.app,
                risk: type === 'char_ignore' ? 'normal' : type === 'char_clear_cart' ? 'private' : 'suspicious',
                metadata,
            });
        };
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
                    const line = `在与「${target.name}」的对话里，以${userProfile.name}的名义回复了：「${act.content}」`;
                    log(line);
                    archiveAction('char_reply', `替 ${userProfile.name} 回复 ${target.name}`, act.content, { targetCharId: target.id });
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
                        const line = `大方地帮 ${userProfile.name} 清空了心意铺购物车（${items.length}件，代付 ¥${fmtPrice(total)}）`;
                        log(line);
                        archiveAction('char_clear_cart', `帮 ${userProfile.name} 清空购物车`, line, { itemCount: items.length, total });
                    }
                } else if ((act.type === 'block' || act.type === 'delete') && target && target.id !== char.id) {
                    await blockCharacterByUser({ char: target, updateCharacter });
                    const line = act.type === 'block'
                        ? `把「${target.name}」拉黑了`
                        : `想把「${target.name}」删掉，最终把对方加入了黑名单（删好友按拉黑执行）`;
                    log(line);
                    archiveAction(act.type === 'block' ? 'char_block' : 'char_delete', act.type === 'block' ? `拉黑 ${target.name}` : `删除 ${target.name}`, line, { targetCharId: target.id });
                } else if (act.type === 'ignore' && target) {
                    const line = `看完了与「${target.name}」的对话，什么都没做`;
                    log(line);
                    archiveAction('char_ignore', `看完 ${target.name} 后无视`, line, { targetCharId: target.id });
                } else if ((act.type === 'reply' || act.type === 'block' || act.type === 'delete') && !target && targetLabel) {
                    const line = `看到了社交圈里的「${targetLabel}」，但这不是正式联系人，没有实际替你${act.type === 'reply' ? '回复' : '处理关系'}`;
                    log(line);
                    archiveAction('char_ignore', `社交圈联系人未实际操作：${targetLabel}`, line);
                } else if (act.type === 'ignore' && targetLabel) {
                    const line = `看完了与「${targetLabel}」的社交圈记录，什么都没做`;
                    log(line);
                    archiveAction('char_ignore', `看完社交圈记录后无视：${targetLabel}`, line);
                } else if (act.type === 'post_moment' && act.content && currentStep.app === 'moments') {
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
                    const line = `以${userProfile.name}的名义发了一条朋友圈：「${act.content}」`;
                    log(line);
                    archiveAction('char_post_moment', `替 ${userProfile.name} 发朋友圈`, act.content, { postId: newPost.id });
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
        const sameAppFamily = prevStep && getStepIcon(prevStep.app) === getStepIcon(currentStep.app);
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
                        : `看了${getStepLabel(s.app)}`;
                    return where;
                });
            const exitDesc = exitMode === 'finished' ? `${char.name} 自己翻完了，把手机还了回去。`
                : exitMode === 'consent' ? `${userProfile.name} 开口请求拿回手机，${char.name} 同意了。`
                : exitMode === 'questions' ? `${userProfile.name} 回答了 ${char.name} 出的三个问题，通过后拿回了手机。`
                : `${userProfile.name} 强行抢回了手机。`;
            const systemMessageId = await DB.saveMessage({
                charId: char.id,
                role: 'system',
                type: 'text',
                content: formatCharPhoneCheckVisibleRecord({
                    charName: char.name,
                    userName: userProfile.name || '用户',
                    browsed,
                    actions: actionLogRef.current,
                    exitDesc,
                    extra,
                }),
                metadata: { charPhoneCheck: true },
            } as any);
            savePhoneCheckSession(prev => {
                if (prev.status !== 'active') return prev;
                const endedAt = Date.now();
                const next: PhoneCheckSession = {
                    ...prev,
                    endedAt,
                    status: exitMode === 'forced' ? 'interrupted' : 'finished',
                    exitMode,
                    systemMessageId,
                    summary: buildPhoneCheckSessionSummary({
                        ...prev,
                        endedAt,
                        exitMode,
                        status: exitMode === 'forced' ? 'interrupted' : 'finished',
                        systemMessageId,
                    }, char.name, userProfile.name || '用户'),
                    actions: [...prev.actions, makePhoneCheckAction({
                        type: 'exit',
                        label: exitDesc,
                        detail: extra,
                        riskDelta: 0,
                        at: endedAt,
                    })],
                };
                void DB.prunePhoneCheckSessions(prev.charId);
                return next;
            });
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
            const roleContext = await buildCharPhoneCheckRoleContext();
            const raw = await llm(`你在扮演「${char.name}」（人设如下），正翻看 ${userProfile.name} 的手机看到一半，${userProfile.name} 开口想拿回手机。
${roleContext}
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
            const roleContext = await buildCharPhoneCheckRoleContext();
            const raw = await llm(`你在扮演「${char.name}」（人设如下），正翻看 ${userProfile.name} 的手机。TA 想拿回手机，你要求TA先回答你出的三个问题。现在TA答完了，按人设判断这些回答是否让你满意、愿意还手机。
${roleContext}
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

    const renderSocialApp = () => (
        <div className="flex-1 overflow-hidden flex flex-col bg-[#fff8f7]">
            {screenHeader('见闻簿', `${xhsPosts.length} 条最近卡片`)}
            <div className="flex-1 overflow-y-auto no-scrollbar p-3 space-y-2.5 pb-20">
                {xhsPosts.length === 0 && <div className="text-center text-xs text-slate-400 pt-14">（见闻簿暂时没有卡片）</div>}
                {xhsPosts.map(post => dataCard(
                    post.id,
                    post.title || `${post.author} 的卡片`,
                    <span>
                        <span className="font-bold text-rose-500">{post.author}</span>
                        <span> · {String(post.body || '').slice(0, 120)}</span>
                        {post.tags?.length > 0 && <span className="block mt-1 text-rose-400">#{post.tags.slice(0, 4).join(' #')}</span>}
                    </span>,
                    `${post.likes || 0}赞`
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

    const renderGenericApp = (appKey: StepApp) => {
        const appConfig = getStepAppConfig(appKey);
        const title = appConfig?.name || getStepLabel(appKey);
        const target = desktopBrowseTargets.find(item => item.key === appKey);
        const rows: Array<{ id: string; title: string; detail: React.ReactNode; meta?: React.ReactNode }> = [
            {
                id: 'source',
                title: '桌面来源',
                detail: target ? `${title} 在 ${target.source}，是用户真实桌面上的 App。` : '这是从用户手机入口打开的页面。',
            },
        ];
        if (currentStep?.visibleClue) {
            rows.push({ id: 'clue', title: '这一眼看到的线索', detail: currentStep.visibleClue });
        }
        if (appKey === AppID.Settings) {
            rows.push({ id: 'settings', title: '文具盒', detail: 'API、通知、外观、数据备份和本地开关入口。角色只能看到设置入口和公开标签，不会读取隐藏密钥。' });
        } else if (appKey === AppID.Personas) {
            rows.push({ id: 'personas', title: '剪影集', detail: `登场人物和用户人设入口。当前手机里可见 ${characters.length} 位角色档案。` });
        } else if (appKey === AppID.Worldbook) {
            rows.push({ id: 'worldbook', title: '剪报夹', detail: '世界书和剪报入口。这里能说明用户整理过哪些设定，但不能凭空展开未给出的条目正文。' });
        } else if (appKey === AppID.Presets) {
            rows.push({ id: 'presets', title: '活字盘', detail: '提示词预设和采样参数入口。查岗只能把它当作桌面痕迹，不把内部提示词当聊天内容复述。' });
        } else if (appKey === AppID.Regex) {
            rows.push({ id: 'regex', title: '补丁铺', detail: '正则脚本入口。能看见工具存在，不代表角色理解或泄露脚本细节。' });
        } else if (appKey === AppID.Appearance) {
            rows.push({ id: 'appearance', title: '拼贴册', detail: '主题、桌面、壁纸和小组件外观入口。当前壁纸和桌面布局已经展示在查岗首页。' });
        } else if (appKey === AppID.MemoryPalace) {
            rows.push({ id: 'memory', title: '回忆标本馆', detail: '长期记忆浏览入口。角色可以意识到这里有回忆管理，但不能在没有快照时编造具体记忆。' });
        } else if (appKey === AppID.Room) {
            rows.push({ id: 'room', title: '栖居志', detail: '像素小屋和同居生活入口。没有更多快照时，只能把它作为用户桌面上的生活 App 痕迹。' });
        } else if (appKey === AppID.Health) {
            rows.push({ id: 'health', title: '健康', detail: '健康记录入口。查岗脚本不能编造具体医疗或身体数据。', meta: '隐私' });
        } else if (appKey === AppID.Xunji) {
            rows.push({ id: 'xunji', title: '循迹', detail: 'Screenlife 与生活痕迹入口。它是整理线索的 App，不是全知监控后台。' });
        } else if (appKey === AppID.Manual) {
            rows.push({ id: 'manual', title: '说明书', detail: 'Moro 功能说明入口。角色能看到用户有翻说明书的入口，但不应把说明文案当成剧情证据。' });
        } else {
            rows.push({ id: 'generic', title: title, detail: '这个 App 没有专门查岗快照；只展示真实桌面入口和当前步骤给出的线索，避免编造不存在的数据。' });
        }

        return (
            <div className="flex-1 overflow-hidden flex flex-col bg-[#f8fafc]">
                {screenHeader(title, target ? target.source : '真实桌面 App')}
                <div className="flex-1 overflow-y-auto no-scrollbar p-3 space-y-2.5 pb-20">
                    {appConfig && (
                        <div className="bg-white rounded-2xl px-3.5 py-3 border border-slate-100 shadow-sm flex items-center gap-3">
                            <AppIcon app={appConfig} onClick={() => { /* preview only */ }} size="sm" />
                            <div className="min-w-0">
                                <div className="text-[13px] font-bold text-slate-700 truncate">{appConfig.name}</div>
                                <div className="text-[11px] text-slate-400 truncate">{target?.source || '真实桌面入口'}</div>
                            </div>
                        </div>
                    )}
                    {rows.map(row => dataCard(row.id, row.title, row.detail, row.meta))}
                </div>
            </div>
        );
    };

    const renderDesktopItem = (item: DeskItem, openingIcon: string | null, openingAppId?: string) => {
        if (item.kind === 'app') {
            const app = INSTALLED_APPS.find(a => a.id === item.id);
            if (!app) return null;
            const isTapped = openingAppId ? openingAppId === app.id : openingIcon === app.icon;
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
                ? (realtimeConfig.weatherMode === 'manual' ? realtimeConfig.weatherCity || '天气城市' : nativeRuntime ? '手机定位' : '浏览器定位')
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
        if (app === 'chat-list' || app === AppID.GroupChat) {
            return (
                <div className="flex-1 overflow-hidden flex flex-col">
                    <div className="px-5 pt-12 pb-3 text-[15px] font-bold text-slate-800 border-b border-slate-100 bg-white/90">絮语</div>
                    <div className="flex-1 overflow-y-auto no-scrollbar bg-white/80">
                        {contacts.map((c) => (
                            <div key={c.id} className={`px-4 py-3 flex items-center gap-3 border-b border-slate-50 ${targetContact?.id === c.id ? 'bg-amber-50' : ''}`}>
                                {c.avatar ? <img src={c.avatar} className="w-11 h-11 rounded-lg object-cover shrink-0" alt="" /> : <div className="w-11 h-11 rounded-lg bg-slate-200 shrink-0 flex items-center justify-center text-slate-500 text-sm font-bold">{c.name.slice(0, 1)}</div>}
                                <div className="flex-1 min-w-0">
                                    <div className="text-[14px] font-medium text-slate-800 truncate">{c.name}</div>
                                    <div className="text-[12px] text-slate-400 truncate">{c.label ? `${c.label} · ` : ''}{c.preview}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            );
        }
        if (app === 'chat-thread' && targetContact) {
            return (
                <div className="flex-1 overflow-hidden flex flex-col">
                    <div className="px-5 pt-12 pb-3 text-[15px] font-bold text-slate-800 border-b border-slate-100 bg-white/90 flex items-center gap-2">
                        {targetContact.avatar ? <img src={targetContact.avatar} className="w-6 h-6 rounded-md object-cover" alt="" /> : <div className="w-6 h-6 rounded-md bg-slate-200 flex items-center justify-center text-[10px] text-slate-500 font-bold">{targetContact.name.slice(0, 1)}</div>}
                        <span className="truncate">{targetContact.name}</span>
                        {targetContact.label && <span className="text-[10px] text-slate-400 font-normal shrink-0">{targetContact.label}</span>}
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
        if (app === AppID.Social) return renderSocialApp();
        if (app === 'twitter' || app === AppID.Twitter) return renderTwitterApp();
        if (app === 'schedule' || app === AppID.Almanac || app === AppID.Schedule) {
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
        if (app === 'gallery' || app === AppID.Gallery) {
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
        if (app === 'music' || app === AppID.Music) {
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
        if (app === 'phone' || app === AppID.Phone) return renderPhoneApp();
        if (app === 'shop' || app === AppID.Shop) return renderShopApp();
        if (app === 'takeout' || app === AppID.Takeout) return renderTakeoutApp();
        if (app === 'wallet' || app === AppID.Bank) return renderWalletApp();
        if (app === 'browser' || app === AppID.Browser || app === AppID.HotNews) return renderBrowserApp();
        if (app === 'map') return renderMapApp();
        if (getStepAppConfig(app)) return renderGenericApp(app);
        // home / finished / opening：用户实时真实的桌面（真壁纸 + 全部 App + dock；
        // opening 时高亮即将点开的图标）
        const openingIcon = getStepIcon(opening);
        const openingApp = getStepAppConfig(opening);
        const openingPageIndex = openingApp
            ? desktopSnapshot.pages.findIndex(page => page.some(({ item }) => item.kind === 'app' && item.id === openingApp.id))
            : -1;
        const visibleDesktopPageIndex = openingPageIndex >= 0 ? openingPageIndex : desktopSnapshot.activePage;
        const currentDesktopPage = desktopSnapshot.pages[visibleDesktopPageIndex] || desktopSnapshot.pages[0] || [];
        const tappedApp = openingApp || (openingIcon ? INSTALLED_APPS.find(a => a.icon === openingIcon) : null);
        return (
            <div className="flex-1 overflow-hidden flex flex-col relative" style={wallpaperBackground(theme.wallpaper)}>
                {widgetCustomCss && <style>{widgetCustomCss}</style>}
                <div className="text-white text-sm font-bold pt-16 pb-3 text-center shrink-0" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.45)' }}>
                    {userProfile.name} 的手机
                </div>
                <div className="relative flex-1 min-h-0 px-5 pb-2 pointer-events-none">
                    {visibleDesktopPageIndex === 2 && theme.desktopDecorations && theme.desktopDecorations.length > 0 && (
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
                                {renderDesktopItem(item, openingIcon, openingApp?.id)}
                            </div>
                        ))}
                    </div>
                </div>
                {desktopSnapshot.pages.length > 1 && (
                    <div className="shrink-0 flex justify-center gap-1.5 py-1">
                        {desktopSnapshot.pages.map((_, idx) => (
                            <span
                                key={idx}
                                className={`h-1.5 rounded-full transition-all ${idx === visibleDesktopPageIndex ? 'w-5 bg-white/85' : 'w-1.5 bg-white/45'}`}
                                style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.28)' }}
                            />
                        ))}
                    </div>
                )}
                {openingIcon && (
                    <div className="text-center text-white text-xs animate-fade-in pb-1" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.45)' }}>
                        {char.name} 点开了「{tappedApp?.name || getStepLabel(opening || 'home')}」…
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
                            <div key={a.id} className={`rounded-2xl transition-all ${openingApp?.id === a.id ? 'scale-90 ring-4 ring-white/70 bg-white/25' : ''}`}>
                                <AppIcon app={a} onClick={() => { /* 角色在翻手机：禁点 */ }} variant="dock" size="sm" />
                            </div>
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
                style={{ top: 'var(--cutout-top)' }}>
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
                        {(currentStep.emotion || currentStep.intent || currentStep.visibleClue) && (
                            <div className="mt-2 space-y-1 text-[10px] leading-relaxed opacity-70">
                                {(currentStep.emotion || currentStep.intent) && (
                                    <div>{[currentStep.emotion, currentStep.intent].filter(Boolean).join(' · ')}</div>
                                )}
                                {currentStep.visibleClue && <div className="line-clamp-2">线索：{currentStep.visibleClue}</div>}
                            </div>
                        )}
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
