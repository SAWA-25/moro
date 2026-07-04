import React, { useMemo, useEffect, useLayoutEffect, useState, useRef } from 'react';
import { useOS, DEFAULT_WALLPAPER } from '../context/OSContext';
import { INSTALLED_APPS, DOCK_APPS } from '../constants';
import { isDevDebugAvailable, subscribeDevDebugAvailability } from '../utils/devDebug';
import AppIcon from '../components/os/AppIcon';
import { DB } from '../utils/db';
import { CharacterProfile, AppID, DailySchedule } from '../types';
import { ScheduleHomeWidget, ScheduleFullscreenViewer } from '../components/schedule/ScheduleHomeWidget';
import { loadScheduleLifeNotes, type ScheduleLifeNotesBySlot } from '../utils/scheduleLifeSync';
import { CHAR_LIFE_EVENT_UPDATED_EVENT, DAILY_SCHEDULE_UPDATED_EVENT } from '../utils/scheduleEvents';
import NowPlayingSquareWidget from '../components/os/NowPlayingSquareWidget';
import WeatherWidget from '../components/os/WeatherWidget';
import { isImageWallpaper, toWallpaperBackground } from '../utils/defaultWallpapers';
import { getLatestPrivateMessage, previewForMessage } from '../utils/messageNotifications';

// --- Isolated Components to prevent full re-renders ---

// 1. Clock Component (Consumes virtualTime)
const DesktopClock = React.memo(() => {
    const { virtualTime, openApp, lock } = useOS();

    const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const now = new Date();
    const dayName = days[now.getDay()];
    const monthName = months[now.getMonth()];
    const dateNum = now.getDate().toString().padStart(2, '0');

    const greeting = virtualTime.hours < 5 ? '夜深了，慢慢收束。'
        : virtualTime.hours < 12 ? '早安，先把心放稳。'
        : virtualTime.hours < 14 ? '午后小憩，喝口水吧。'
        : virtualTime.hours < 18 ? '今天也在向前。'
        : '晚风正好，辛苦了。';

    const hh = virtualTime.hours.toString().padStart(2, '0');
    const mm = virtualTime.minutes.toString().padStart(2, '0');

    return (
        <div className="moro-clock-card h-full w-full rounded-[2rem] px-4 py-4 relative overflow-hidden animate-rise-in select-none flex flex-col text-white">
            <div className="moro-clock-sheen absolute inset-0 pointer-events-none" />
            <div className="absolute inset-x-0 top-0 h-16 pointer-events-none opacity-80"
                style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.2), transparent)' }} />
            <div className="absolute right-0 top-0 bottom-0 w-[46%] pointer-events-none opacity-65"
                style={{
                    background: 'linear-gradient(155deg, rgba(125,211,252,0.36), rgba(244,114,182,0.2) 48%, rgba(250,204,21,0.16))',
                    clipPath: 'polygon(30% 0, 100% 0, 100% 100%, 0 100%)',
                }}
            />

            <div className="relative z-10 flex-1 flex flex-col">
                <div className="flex items-center justify-between gap-3">
                    <div className="label-mono text-[9px] font-bold opacity-75">MORO</div>
                    <button
                        onClick={lock}
                        className="w-8 h-8 shrink-0 rounded-full press-soft inline-flex items-center justify-center bg-white/16 border border-white/22 backdrop-blur-md"
                        aria-label="一键锁屏"
                    >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zM9 8V6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9z"/></svg>
                    </button>
                </div>

                <div className="mt-3">
                    <div className="moro-clock-time text-[2.7rem] leading-none font-black tabular-nums">
                        {hh}<span className="opacity-40 mx-0.5">:</span>{mm}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                        <span className="label-mono text-[11px] font-bold opacity-85">{monthName}</span>
                        <span className="h-px flex-1 bg-white/28" />
                        <span className="label-mono text-[11px] font-bold opacity-85">{dayName}</span>
                    </div>
                </div>

                <div className="mt-auto min-w-0 rounded-[1.25rem] border border-white/18 bg-white/13 backdrop-blur-md px-3.5 py-3">
                    <div className="flex items-end justify-between gap-3">
                        <div className="min-w-0">
                            <div className="text-[1.15rem] leading-none font-bold tabular-nums">
                                {dateNum}
                            </div>
                            <div className="moro-clock-greeting text-[11px] mt-1.5 opacity-80 font-medium truncate">{greeting}</div>
                        </div>
                        <button
                            onClick={() => openApp(AppID.Appearance)}
                            className="moro-palette-btn label-mono text-[9px] font-bold px-3 py-2 rounded-full press-soft shrink-0 bg-white/18 border border-white/24 backdrop-blur-md"
                        >
                            Tune
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
});

// 2. Character Widget (Consumes Character Data & Messages)
const CharacterWidget = React.memo(({
    char,
    unreadCount,
    lastMessage,
    onClick,
    contentColor
}: {
    char: CharacterProfile | null,
    unreadCount: number,
    lastMessage: string,
    onClick: () => void,
    contentColor: string
}) => {
    // Handwritten scrapbook chat preview: black chat button + small avatar bubble.
    return (
        <div className="h-full w-full group animate-rise-in" style={{ animationDelay: '60ms' }}>
             <div
                className="moro-character-card glass-card relative w-full h-full overflow-hidden rounded-[2rem] cursor-pointer press-soft"
                onClick={onClick}
                style={{ color: contentColor }}
             >
                 <div className="relative h-full flex items-center px-5 py-3 gap-4">
                     <div className="relative shrink-0">
                         <div className="w-[52px] h-[52px] rounded-full flex items-center justify-center transition-transform duration-500 group-hover:-rotate-6"
                             style={{ background: '#1c1b22', boxShadow: '0 12px 26px -12px rgba(28,27,34,0.6)' }}>
                             <svg width="24" height="24" viewBox="0 0 24 24" fill="#ffffff"><path d="M12 2C6.48 2 2 5.92 2 10.77c0 2.69 1.39 5.09 3.57 6.7-.1.86-.42 2.06-1.17 3.13-.14.2.02.48.26.44 1.78-.28 3.27-1.07 4.27-1.78.97.27 2 .42 3.07.42 5.52 0 10-3.92 10-8.91C22 5.92 17.52 2 12 2z"/></svg>
                         </div>
                         {unreadCount > 0 && (
                             <span className="absolute -top-0.5 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-[#f43f3f] text-white text-[10px] font-bold flex items-center justify-center border-2 border-white shadow-sm animate-pop-in">
                                 {unreadCount > 9 ? '9+' : unreadCount}
                             </span>
                         )}
                     </div>

                     <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                         <div className="flex items-center gap-2 min-w-0">
                             <span className="font-hand text-[17px] leading-none opacity-55 truncate">{char?.name || 'Letters'}</span>
                             {unreadCount === 0 && (
                                 <span className="w-1.5 h-1.5 shrink-0 rounded-full bg-emerald-400 animate-pulse" style={{ boxShadow: '0 0 6px #4ade80' }} />
                             )}
                         </div>
                         <div className="flex items-center gap-2 min-w-0">
                             <div className="w-7 h-7 shrink-0 rounded-full overflow-hidden bg-black/5" style={{ border: '1.5px solid rgba(236,233,226,0.9)' }}>
                                 {char ? (
                                     <img src={char.avatar} className="w-full h-full object-cover" alt="char" loading="lazy" />
                                 ) : <div className="w-full h-full bg-black/5 animate-pulse" />}
                             </div>
                             <div className="flex-1 min-w-0 px-3.5 py-1.5 rounded-full text-[11px] leading-snug truncate"
                                 style={{ background: 'rgba(43,41,51,0.05)', border: '1px solid rgba(43,41,51,0.04)' }}>
                                 {lastMessage}
                             </div>
                         </div>
                     </div>
                 </div>
             </div>
        </div>
    );
});

// 3. Polaroid image slot (free-position widget)
const DesktopPolaroidImage = React.memo(({ image, contentColor, onClick, caption = 'Polaroid', variant = 'portrait' }: {
    image?: string,
    contentColor: string,
    onClick: () => void,
    caption?: string,
    variant?: 'portrait' | 'wide',
}) => {
    return (
        <div
            onClick={onClick}
            className={`moro-polaroid-widget moro-polaroid-widget-${variant} group relative w-full h-full cursor-pointer animate-fade-in press-soft`}
            style={{ color: contentColor }}
        >
            <div className="moro-polaroid-paper relative h-full w-full overflow-hidden">
                <span className="moro-polaroid-tape tape-left" />
                <span className="moro-polaroid-tape tape-right" />
                <div className="moro-polaroid-print relative overflow-hidden">
                    {image ? (
                        <>
                            <img src={image} alt="" className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.035]" loading="lazy" />
                            <div className="absolute inset-0 pointer-events-none moro-polaroid-print-glaze" />
                        </>
                    ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-3 text-center">
                            <div className="moro-polaroid-placeholder-icon">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor" className="w-4 h-4 opacity-70">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
                                </svg>
                            </div>
                            <div className="text-[8.5px] label-mono font-bold opacity-60">Photo</div>
                            <div className="text-[9px] opacity-45 leading-tight">从外观里放一张桌面图</div>
                        </div>
                    )}
                </div>
                <div className="moro-polaroid-caption-row min-w-0">
                    <span className="truncate">{caption}</span>
                    <i />
                </div>
            </div>
        </div>
    );
});

const CALENDAR_WEEKDAYS = [
    { key: 'sun', label: 'S' },
    { key: 'mon', label: 'M' },
    { key: 'tue', label: 'T' },
    { key: 'wed', label: 'W' },
    { key: 'thu', label: 'T' },
    { key: 'fri', label: 'F' },
    { key: 'sat', label: 'S' },
] as const;

// (Calendar + Upcoming Events 小组件页已移除)

// --- Persist scroll page across remounts (e.g. returning from apps) ---
const DESK_ACTIVE_PAGE_KEY = 'moro_desktop_active_page_v5';
const loadLastPageIndex = (): number => {
    try {
        if (typeof sessionStorage === 'undefined') return 0;
        const raw = Number(sessionStorage.getItem(DESK_ACTIVE_PAGE_KEY) || 0);
        return Number.isFinite(raw) ? Math.max(0, Math.round(raw)) : 0;
    } catch { return 0; }
};
const persistLastPageIndex = (index: number) => {
    try {
        if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(DESK_ACTIVE_PAGE_KEY, String(Math.max(0, index)));
    } catch {}
};
let _lastPageIndex = loadLastPageIndex();

// --- 旧版桌面图标顺序（仅作首次迁移的默认 app 排序来源） ---
const APP_ORDER_KEY = 'moro_launcher_app_order';
const loadStoredAppOrder = (): string[] => {
    try {
        const raw = JSON.parse(localStorage.getItem(APP_ORDER_KEY) || '[]');
        return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
    } catch { return []; }
};

// --- 桌面统一布局：组件(widget) 和应用(app) 都是可拖拽的「桌面项」 ---
// 每页是 4 列 × 12 行的细粒度网格（app 图标占 1×2，时钟占 4×6 ……），
// 桌面项按持久化顺序 first-fit 装箱分页；拖拽改变顺序 → 重新装箱 → 位置完全自定义。
interface DeskItem {
    key: string;            // 'app:<appId>' | 'widget:<widgetId>'
    kind: 'app' | 'widget';
    id: string;
    w: number;              // 占用列数（1-4）
    h: number;              // 占用行数（12 行制）
}
interface PlacedItem { item: DeskItem; col: number; row: number; }
interface DeskLayoutCell { page: number; col: number; row: number; }

const PAGE_COLS = 4;
const PAGE_ROWS = 12;

const DESK_ORDER_KEY = 'moro_desktop_items_v1';
const loadStoredDeskOrder = (): string[] => {
    try {
        const raw = JSON.parse(localStorage.getItem(DESK_ORDER_KEY) || '[]');
        return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
    } catch { return []; }
};

const DESK_LAYOUT_KEY = 'moro_desktop_layout_v17_native_dense_schedule';
const loadStoredDeskLayout = (): Record<string, DeskLayoutCell> => {
    try {
        const raw = JSON.parse(localStorage.getItem(DESK_LAYOUT_KEY) || '{}');
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
        const out: Record<string, DeskLayoutCell> = {};
        for (const [key, value] of Object.entries(raw)) {
            if (!value || typeof value !== 'object') continue;
            const page = Math.max(0, Math.round(Number((value as any).page ?? 0)));
            const col = Math.max(0, Math.min(PAGE_COLS - 1, Math.round(Number((value as any).col ?? 0))));
            const row = Math.max(0, Math.min(PAGE_ROWS - 1, Math.round(Number((value as any).row ?? 0))));
            out[key] = { page, col, row };
        }
        return out;
    } catch { return {}; }
};

/** 首次使用（没存过布局）的默认顺序：复刻旧版「时钟+聊天卡+8 图标 / 日程+音乐+方图」分页 */
const buildDefaultKeys = (appKeys: string[], widgetKeys: Set<string>): string[] => {
    const mid = ['widget:schedule', 'widget:music', 'widget:image', 'widget:imgtl', 'widget:imgtr', 'widget:imgwide']
        .filter(k => widgetKeys.has(k));
    return ['widget:clock', 'widget:weather', 'widget:character', ...appKeys.slice(0, 8), ...mid, ...appKeys.slice(8)];
};

/** first-fit 装箱：按顺序放进当前页网格，放不下开新页（不回填旧页，保证顺序直觉） */
const packDeskPages = (items: DeskItem[]): PlacedItem[][] => {
    const pages: PlacedItem[][] = [];
    const grids: boolean[][][] = [];
    const addPage = () => {
        pages.push([]);
        grids.push(Array.from({ length: PAGE_ROWS }, () => Array(PAGE_COLS).fill(false)));
    };
    addPage();
    const tryPlace = (it: DeskItem): boolean => {
        const grid = grids[grids.length - 1];
        for (let r = 0; r <= PAGE_ROWS - it.h; r++) {
            for (let c = 0; c <= PAGE_COLS - it.w; c++) {
                let ok = true;
                for (let i = r; i < r + it.h && ok; i++)
                    for (let j = c; j < c + it.w && ok; j++)
                        if (grid[i][j]) ok = false;
                if (!ok) continue;
                for (let i = r; i < r + it.h; i++)
                    for (let j = c; j < c + it.w; j++)
                        grid[i][j] = true;
                pages[pages.length - 1].push({ item: it, col: c, row: r });
                return true;
            }
        }
        return false;
    };
    for (const it of items) {
        if (!tryPlace(it)) { addPage(); tryPlace(it); }
    }
    return pages;
};

const clampPlacement = (item: DeskItem, page: number, col: number, row: number): DeskLayoutCell => ({
    page: Math.max(0, Math.round(page)),
    col: Math.max(0, Math.min(PAGE_COLS - item.w, Math.round(col))),
    row: Math.max(0, Math.min(PAGE_ROWS - item.h, Math.round(row))),
});

const cellsOverlap = (a: DeskLayoutCell, aw: number, ah: number, b: DeskLayoutCell, bw: number, bh: number) => {
    if (a.page !== b.page) return false;
    return !(a.col + aw <= b.col || b.col + bw <= a.col || a.row + ah <= b.row || b.row + bh <= a.row);
};

const findFirstFreeSpot = (
    item: DeskItem,
    itemsByKey: Map<string, DeskItem>,
    layout: Record<string, DeskLayoutCell>,
    excludedKey?: string,
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
    const place = (key: string | undefined, page: number, col: number, row: number): boolean => {
        if (!key || layout[key]) return false;
        const item = itemsByKey.get(key);
        if (!item) return false;
        const desired = clampPlacement(item, page, col, row);
        let blocked = false;
        for (const [otherKey, otherPos] of Object.entries(layout)) {
            const otherItem = itemsByKey.get(otherKey);
            if (!otherItem) continue;
            if (cellsOverlap(desired, item.w, item.h, otherPos, otherItem.w, otherItem.h)) {
                blocked = true;
                break;
            }
        }
        if (!blocked) {
            layout[key] = desired;
            return true;
        }
        return false;
    };

    const appKeys = orderedKeys.filter(key => key.startsWith('app:'));
    const placeApp = (id: AppID, page: number, col: number, row: number) => {
        const key = `app:${id}`;
        if (appKeys.includes(key)) place(key, page, col, row);
    };

    place('widget:clock', 0, 0, 0);
    place('widget:schedule', 0, 0, 2);
    place('widget:music', 0, 0, 4);
    place('widget:image', 0, 2, 4);
    placeApp(AppID.Gallery, 0, 0, 7);
    placeApp(AppID.Music, 0, 1, 7);
    placeApp(AppID.HotNews, 0, 2, 7);
    placeApp(AppID.Appearance, 0, 3, 7);
    place('widget:character', 0, 0, 10);

    placeApp(AppID.Personas, 1, 0, 2);
    placeApp(AppID.Almanac, 1, 1, 2);
    placeApp(AppID.Room, 1, 0, 4);
    placeApp(AppID.Journal, 1, 1, 4);
    place('widget:weather', 1, 2, 2);
    place('widget:text', 1, 0, 6);
    placeApp(AppID.Study, 1, 2, 5);
    placeApp(AppID.Theater, 1, 3, 5);
    placeApp(AppID.Creative, 1, 2, 7);
    placeApp(AppID.LifeSim, 1, 3, 7);

    const pageThreeApps = [
        AppID.Worldbook,
        AppID.Presets,
        AppID.Regex,
        AppID.MemoryPalace,
        AppID.Bank,
        AppID.VRWorld,
        AppID.Takeout,
        AppID.Shop,
        AppID.Harem,
        AppID.Forum,
        AppID.DesktopPet,
        AppID.CoView,
        AppID.Manual,
    ];
    pageThreeApps.forEach((id, index) => {
        placeApp(id, 2, index % PAGE_COLS, Math.floor(index / PAGE_COLS) * 2);
    });

    for (const key of orderedKeys) {
        const item = itemsByKey.get(key);
        if (!item || layout[key]) continue;
        const pageStart = key.startsWith('app:')
            ? 2
            : (['widget:imgtl', 'widget:imgtr', 'widget:imgwide'].includes(key) ? 3 : 0);
        layout[key] = findFirstFreeSpot(item, itemsByKey, layout, key, pageStart);
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
                if (!otherItem) continue;
                if (cellsOverlap(desired, item.w, item.h, otherPos, otherItem.w, otherItem.h)) {
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

const layoutToPages = (items: DeskItem[], layout: Record<string, DeskLayoutCell>, orderedKeys: string[]): PlacedItem[][] => {
    const itemsByKey = new Map(items.map(item => [item.key, item]));
    const orderIndex = new Map(orderedKeys.map((key, index) => [key, index]));
    const maxPage = Math.max(0, ...Object.values(layout).map(cell => cell.page));
    const pages: PlacedItem[][] = Array.from({ length: maxPage + 1 }, () => []);
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

const WIDGET_LABELS: Record<string, string> = {
    clock: '时钟',
    weather: '天气',
    character: '絮语卡片',
    schedule: '日程',
    music: '音乐',
    image: '方图',
    imgtl: '小组件图',
    imgtr: '小组件图',
    imgwide: '宽幅图',
    text: '文字',
};

/** 文字小组件：桌面上一块可自定义文字的便签。轻点编辑（非编辑模式时），内容本地持久化。
 *  尺寸可在「主题 → 桌面小组件」里像别的组件一样改（横版/竖版/方形）。 */
const TEXT_WIDGET_KEY = 'moro_text_widget_v1';
const DesktopTextWidget: React.FC<{ contentColor: string; editMode: boolean }> = ({ contentColor, editMode }) => {
    const [text, setText] = useState<string>(() => {
        try { const v = localStorage.getItem(TEXT_WIDGET_KEY); return v != null ? v : '今日备忘\n把想留下的话写在这里'; } catch { return '今日备忘'; }
    });
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(text);
    const save = () => {
        setText(draft);
        try { localStorage.setItem(TEXT_WIDGET_KEY, draft); } catch { /* ignore */ }
        setEditing(false);
    };
    return (
        <>
            <button
                onClick={() => { if (!editMode) { setDraft(text); setEditing(true); } }}
                className="moro-widget-text moro-quote-widget w-full h-full px-4 py-3 flex flex-col justify-center text-left overflow-hidden active:scale-[0.98] transition-transform"
                style={{ color: contentColor }}
                aria-label="文字小组件"
            >
                <span className="moro-quote-mark">"</span>
                <span className="moro-quote-copy whitespace-pre-wrap break-words line-clamp-4">
                    {text || '轻点编辑'}
                </span>
                <span className="moro-quote-rule" />
            </button>
            {editing && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-6" style={{ background: 'rgba(20,18,28,0.5)', backdropFilter: 'blur(3px)' }} onClick={() => setEditing(false)}>
                    <div className="w-full max-w-sm bg-white rounded-3xl p-4 shadow-2xl" onClick={e => e.stopPropagation()}>
                        <div className="text-sm font-bold text-slate-800 mb-2">文字小组件</div>
                        <textarea
                            value={draft}
                            onChange={e => setDraft(e.target.value)}
                            rows={4}
                            autoFocus
                            placeholder="写点什么放在桌面上…（待办、暗号、给自己的话）"
                            className="w-full bg-slate-50 rounded-2xl p-3 text-sm text-slate-700 outline-none border border-slate-200 focus:border-violet-300 resize-none"
                        />
                        <div className="flex gap-2 mt-3">
                            <button onClick={() => setEditing(false)} className="flex-1 py-2.5 rounded-2xl bg-slate-100 text-slate-500 text-sm font-bold active:scale-95">取消</button>
                            <button onClick={save} className="flex-1 py-2.5 rounded-2xl bg-violet-500 text-white text-sm font-bold active:scale-95 shadow-lg">保存</button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

// --- Main Launcher ---

const Launcher: React.FC = () => {
  const { openApp, characters, activeCharacterId, theme, lastMsgTimestamp, isDataLoaded, unreadMessages } = useOS();

  // Local state for widget data to prevent context trashing
  const [widgetChar, setWidgetChar] = useState<CharacterProfile | null>(null);
  const [lastMessage, setLastMessage] = useState<string>('');
  const [scheduleData, setScheduleData] = useState<DailySchedule | null>(null);
  const [scheduleLifeNotes, setScheduleLifeNotes] = useState<ScheduleLifeNotesBySlot>({});
  const [scheduleCharId, setScheduleCharId] = useState<string | null>(null);
  const [scheduleViewerOpen, setScheduleViewerOpen] = useState(false);

  const [activePageIndex, setActivePageIndex] = useState(_lastPageIndex);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Mouse Drag Logic refs
  const isDragging = useRef(false);
  const startX = useRef(0);
  const scrollLeftRef = useRef(0);
  const dragMoved = useRef(0);

  // 跟随 DevDebug 可用性：prod 用户在设置页连点 5 下解锁后，CharCreatorDev 立刻出现；
  // 点「关闭」/ 刷新（prod 自动失效）也立刻消失。useMemo deps 没列 devDebugVisible
  // 会让它锁在 mount 时的初值。
  const [devDebugVisible, setDevDebugVisible] = useState(() => isDevDebugAvailable());
  useEffect(() => subscribeDevDebugAvailability(setDevDebugVisible), []);

  // --- 桌面项拖拽排序状态（app + widget 统一） ---
  const [deskOrder, setDeskOrder] = useState<string[]>(loadStoredDeskOrder);
  const [deskLayout, setDeskLayout] = useState<Record<string, DeskLayoutCell>>(loadStoredDeskLayout);
  const [editMode, setEditMode] = useState(false);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);
  const editModeRef = useRef(false);
  const draggingKeyRef = useRef<string | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const pressStartPos = useRef({ x: 0, y: 0 });
  const lastPointerPos = useRef({ x: 0, y: 0 });
  const dragEndAtRef = useRef(0);
  const lastFlipAt = useRef(0);
  const lastReorder = useRef({ id: '', t: 0 });
  const deskItemsRef = useRef<DeskItem[]>([]);
  const deskLayoutRef = useRef<Record<string, DeskLayoutCell>>({});
  const ghostElRef = useRef<HTMLDivElement | null>(null);
  const blockTouchRef = useRef<((ev: TouchEvent) => void) | null>(null);
  const dropTargetKeyRef = useRef<string | null>(null);
  const dragMode = theme.desktopDragMode || 'balanced';
  const editEffect = theme.desktopEditEffect || 'wiggle';
  const reorderThrottle = dragMode === 'snappy' ? 110 : dragMode === 'gentle' ? 280 : 180;
  const edgeFlipThreshold = dragMode === 'snappy' ? 56 : dragMode === 'gentle' ? 28 : 40;
  const edgeFlipDelay = dragMode === 'snappy' ? 360 : dragMode === 'gentle' ? 780 : 560;

  // 旧版仅 app 排序的持久化只作首次迁移用：统一布局存的是 DESK_ORDER_KEY
  const legacyAppOrder = useMemo(loadStoredAppOrder, []);

  const gridApps = useMemo(() => {
    const base = INSTALLED_APPS.filter(app =>
      !DOCK_APPS.includes(app.id)
      // 「捏脸·开发」仅在开发模式（右下角开发徽标可见或手动解锁时）显示
      && (app.id !== AppID.CharCreatorDev || devDebugVisible)
    );
    if (legacyAppOrder.length === 0) return base;
    // 旧排序在前，新增/未记录的 App 按默认顺序补在后面
    const ordered: typeof INSTALLED_APPS = [];
    for (const id of legacyAppOrder) {
        const app = base.find(a => a.id === id);
        if (app && !ordered.includes(app)) ordered.push(app);
    }
    for (const app of base) {
        if (!ordered.includes(app)) ordered.push(app);
    }
    return ordered;
  }, [devDebugVisible, legacyAppOrder]);

  // 桌面项全集（含尺寸）：固定五个组件 + 外观里设置过的小组件图 + 全部非 dock App。
  // theme.desktopWidgetPrefs（主题 → 桌面小组件）可隐藏组件、覆盖网格尺寸（横版/竖版/方形）。
  const deskItems = useMemo(() => {
    const lw = theme.launcherWidgets || {};
    const prefs = theme.desktopWidgetPrefs || {};
    const clampW = (n: number) => Math.max(1, Math.min(PAGE_COLS, Math.round(n)));
    const clampH = (n: number) => Math.max(1, Math.min(PAGE_ROWS, Math.round(n)));
    const widgetItems: DeskItem[] = ([
        // 参照手帐桌面设计稿：左半蓝色日期卡 + 右半天气卡（尺寸可在 主题 → 桌面小组件 覆盖）
        { key: 'widget:clock', kind: 'widget', id: 'clock', w: 4, h: 2 },
        { key: 'widget:weather', kind: 'widget', id: 'weather', w: 2, h: 2 },
        { key: 'widget:character', kind: 'widget', id: 'character', w: 4, h: 2 },
        { key: 'widget:schedule', kind: 'widget', id: 'schedule', w: 4, h: 2 },
        { key: 'widget:music', kind: 'widget', id: 'music', w: 2, h: 3 },
        { key: 'widget:image', kind: 'widget', id: 'image', w: 2, h: 3 },
        { key: 'widget:text', kind: 'widget', id: 'text', w: 2, h: 2 },
        ...(lw['tl'] ? [{ key: 'widget:imgtl', kind: 'widget' as const, id: 'imgtl', w: 2, h: 3 }] : []),
        ...(lw['tr'] ? [{ key: 'widget:imgtr', kind: 'widget' as const, id: 'imgtr', w: 2, h: 3 }] : []),
        ...(lw['wide'] ? [{ key: 'widget:imgwide', kind: 'widget' as const, id: 'imgwide', w: 4, h: 3 }] : []),
    ] as DeskItem[])
        .filter(it => !prefs[it.id]?.hidden)
        .map(it => {
            const p = prefs[it.id];
            if (!p) return it;
            return {
                ...it,
                w: p.w ? clampW(p.w) : it.w,
                h: p.h ? clampH(p.h) : it.h,
            };
        });
    const appItems: DeskItem[] = gridApps.map((a) => {
        return {
            key: `app:${a.id}`,
            kind: 'app',
            id: a.id,
            w: 1,
            h: 2,
        };
    });
    const byKey = new Map<string, DeskItem>();
    for (const it of [...widgetItems, ...appItems]) byKey.set(it.key, it);

    const ordered: DeskItem[] = [];
    for (const k of deskOrder) {
        const it = byKey.get(k);
        if (it) { ordered.push(it); byKey.delete(k); }
    }
    // 未入存档的项（新装 App / 新出现的组件）按默认顺序补位
    const defaults = buildDefaultKeys(appItems.map(i => i.key), new Set(widgetItems.map(i => i.key)));
    for (const k of defaults) {
        const it = byKey.get(k);
        if (it) { ordered.push(it); byKey.delete(k); }
    }
    for (const it of byKey.values()) ordered.push(it);
    return ordered;
  }, [gridApps, theme.launcherWidgets, theme.desktopWidgetPrefs, deskOrder]);

  // 小组件自定义 CSS（主题 → 桌面小组件）：拼接注入，配合 .moro-widget-<id> 钩子类生效
  const widgetCustomCss = useMemo(() => {
      const prefs = theme.desktopWidgetPrefs || {};
      return Object.values(prefs).map(p => p?.customCss || '').filter(Boolean).join('\n');
  }, [theme.desktopWidgetPrefs]);

  useEffect(() => { deskItemsRef.current = deskItems; }, [deskItems]);
  useEffect(() => { deskLayoutRef.current = deskLayout; }, [deskLayout]);
  useEffect(() => { editModeRef.current = editMode; }, [editMode]);
  useEffect(() => {
      if (deskOrder.length === 0) return;
      try { localStorage.setItem(DESK_ORDER_KEY, JSON.stringify(deskOrder)); } catch {}
  }, [deskOrder]);
  useEffect(() => {
      const keys = deskItems.map(item => item.key);
      const normalized = Object.keys(deskLayout).length > 0
          ? normalizeDeskLayout(deskItems, deskLayout, keys)
          : buildDefaultDeskLayout(deskItems, keys);
      const changed =
          keys.length !== Object.keys(deskLayout).length ||
          keys.some(key => {
              const a = deskLayout[key];
              const b = normalized[key];
              return !a || !b || a.page !== b.page || a.col !== b.col || a.row !== b.row;
          });
      if (changed) setDeskLayout(normalized);
  }, [deskItems, deskLayout]);
  useEffect(() => {
      try { localStorage.setItem(DESK_LAYOUT_KEY, JSON.stringify(deskLayout)); } catch {}
  }, [deskLayout]);

  const packedPages = useMemo(() => {
      const keys = deskItems.map(item => item.key);
      const baseLayout = Object.keys(deskLayout).length > 0
          ? normalizeDeskLayout(deskItems, deskLayout, keys)
          : buildDefaultDeskLayout(deskItems, keys);
      return layoutToPages(deskItems, baseLayout, keys);
  }, [deskItems, deskLayout]);
  const renderedPages = packedPages.length > 0 ? packedPages : [([] as PlacedItem[])];
  const totalPages = renderedPages.length;

  const beginItemDrag = React.useCallback((key: string, x: number, y: number) => {
      draggingKeyRef.current = key;
      setDraggingKey(key);
      lastPointerPos.current = { x, y };
      // 触屏：阻止本次手势触发页面横向滚动（React 的 touchmove 是 passive 的，必须挂原生监听）
      if (!blockTouchRef.current) {
          const blockTouch = (ev: TouchEvent) => { ev.preventDefault(); };
          window.addEventListener('touchmove', blockTouch, { passive: false });
          blockTouchRef.current = blockTouch;
      }
  }, []);

  const handleItemPointerDown = React.useCallback((key: string, e: React.PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      pressStartPos.current = { x: e.clientX, y: e.clientY };
      lastPointerPos.current = { x: e.clientX, y: e.clientY };
      if (editModeRef.current) {
          e.stopPropagation();
          beginItemDrag(key, e.clientX, e.clientY);
      } else {
          // 长按 450ms 进入编辑模式并直接拎起该项；中途移动超过阈值视为滑动翻页，取消长按
          if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
          longPressTimer.current = window.setTimeout(() => {
              longPressTimer.current = null;
              setEditMode(true);
              editModeRef.current = true;
              try { (navigator as any).vibrate?.(10); } catch {}
              beginItemDrag(key, lastPointerPos.current.x, lastPointerPos.current.y);
          }, 450);
      }
  }, [beginItemDrag]);

  const shouldSuppressIconClick = React.useCallback(
      () => editModeRef.current || Date.now() - dragEndAtRef.current < 250,
      []
  );

  // 拖拽中的全局指针跟踪：移动幽灵、命中其它桌面项时重排、贴边翻页（跨页移动）
  useEffect(() => {
      const onMove = (e: PointerEvent) => {
          lastPointerPos.current = { x: e.clientX, y: e.clientY };
          if (longPressTimer.current !== null) {
              const moved = Math.hypot(e.clientX - pressStartPos.current.x, e.clientY - pressStartPos.current.y);
              if (moved > 10) { window.clearTimeout(longPressTimer.current); longPressTimer.current = null; }
          }
          const dragKey = draggingKeyRef.current;
          if (!dragKey) return;
          if (ghostElRef.current) {
              ghostElRef.current.style.transform = `translate(${e.clientX}px, ${e.clientY}px) translate(-50%, -50%) scale(1.12)`;
          }
          const now = Date.now();
          const el = scrollContainerRef.current;
          if (el && now - lastReorder.current.t > reorderThrottle) {
              const rect = el.getBoundingClientRect();
              const pageWidth = el.clientWidth || rect.width || 1;
              const fallbackPage = Math.max(0, Math.floor((el.scrollLeft + Math.max(0, e.clientX - rect.left)) / pageWidth));
              const maxExistingPage = Math.max(0, ...Object.values(deskLayoutRef.current).map(cell => cell.page));
              const hitEl = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
              const pageEl = hitEl?.closest?.('[data-desk-page]') as HTMLElement | null;
              const gridEl = pageEl?.querySelector?.('[data-desk-grid]') as HTMLElement | null;
              let page = fallbackPage;
              let gridRect = rect;
              if (pageEl && gridEl) {
                  const parsed = Number(pageEl.dataset.deskPage ?? pageEl.dataset.pageIndex ?? fallbackPage);
                  page = Number.isFinite(parsed) ? Math.max(0, parsed) : fallbackPage;
                  gridRect = gridEl.getBoundingClientRect();
              }
              const isAtTrailingEdge = rect.right - e.clientX < edgeFlipThreshold
                  && Math.abs(el.scrollWidth - (el.scrollLeft + el.clientWidth)) < 2;
              if (isAtTrailingEdge && page >= maxExistingPage) {
                  page = maxExistingPage + 1;
              }
              const cellW = gridRect.width / PAGE_COLS;
              const cellH = gridRect.height / PAGE_ROWS;
              const item = deskItemsRef.current.find(it => it.key === dragKey);
              if (item && cellW > 0 && cellH > 0) {
                  const localX = Math.max(0, Math.min(gridRect.width - 1, e.clientX - gridRect.left));
                  const localY = Math.max(0, Math.min(gridRect.height - 1, e.clientY - gridRect.top));
                  const col = isAtTrailingEdge && page > maxExistingPage
                      ? 0
                      : Math.max(0, Math.min(PAGE_COLS - item.w, Math.floor(localX / cellW - item.w / 2 + 0.5)));
                  const row = Math.max(0, Math.min(PAGE_ROWS - item.h, Math.floor(localY / cellH - item.h / 2 + 0.5)));
                  const nextPos = clampPlacement(item, page, col, row);
                  const currentPos = deskLayoutRef.current[dragKey];
                  let nextLayout = deskLayoutRef.current;
                  if (!currentPos || currentPos.page !== nextPos.page || currentPos.col !== nextPos.col || currentPos.row !== nextPos.row) {
                      const itemsByKey = new Map(deskItemsRef.current.map(it => [it.key, it]));
                      nextLayout = { ...deskLayoutRef.current, [dragKey]: nextPos };
                      let displaced = true;
                      while (displaced) {
                          displaced = false;
                          for (const [otherKey, otherItem] of itemsByKey.entries()) {
                              if (otherKey === dragKey) continue;
                              const otherPos = nextLayout[otherKey];
                              if (!otherPos) continue;
                              if (cellsOverlap(nextPos, item.w, item.h, otherPos, otherItem.w, otherItem.h)) {
                                  nextLayout[otherKey] = findFirstFreeSpot(otherItem, itemsByKey, nextLayout, otherKey, otherPos.page);
                                  displaced = true;
                              }
                          }
                      }
                      deskLayoutRef.current = nextLayout;
                      lastReorder.current = { id: `${nextPos.page}:${nextPos.col}:${nextPos.row}`, t: now };
                      setDeskLayout(nextLayout);
                  }
                  let hoverKey: string | null = null;
                  const itemsByKey = new Map(deskItemsRef.current.map(it => [it.key, it]));
                  for (const [otherKey, otherItem] of itemsByKey.entries()) {
                      if (otherKey === dragKey) continue;
                      const otherPos = nextLayout[otherKey];
                      if (!otherPos) continue;
                      if (cellsOverlap(nextPos, item.w, item.h, otherPos, otherItem.w, otherItem.h)) {
                          hoverKey = otherKey;
                          break;
                      }
                  }
                  if (dropTargetKeyRef.current !== hoverKey) {
                      dropTargetKeyRef.current = hoverKey;
                      setDropTargetKey(hoverKey);
                  }
              }
          }
          if (el && now - lastFlipAt.current > edgeFlipDelay) {
              const rect = el.getBoundingClientRect();
              if (e.clientX - rect.left < edgeFlipThreshold && el.scrollLeft > 10) {
                  lastFlipAt.current = now;
                  el.scrollBy({ left: -el.clientWidth, behavior: 'smooth' });
              } else if (rect.right - e.clientX < edgeFlipThreshold) {
                  lastFlipAt.current = now;
                  el.scrollBy({ left: el.clientWidth, behavior: 'smooth' });
              }
          }
      };
      const onUp = () => {
          if (longPressTimer.current !== null) { window.clearTimeout(longPressTimer.current); longPressTimer.current = null; }
          if (draggingKeyRef.current) {
              draggingKeyRef.current = null;
              setDraggingKey(null);
              dropTargetKeyRef.current = null;
              setDropTargetKey(null);
              dragEndAtRef.current = Date.now();
          }
          if (blockTouchRef.current) { window.removeEventListener('touchmove', blockTouchRef.current); blockTouchRef.current = null; }
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      return () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onUp);
          if (blockTouchRef.current) { window.removeEventListener('touchmove', blockTouchRef.current); blockTouchRef.current = null; }
      };
  }, []);

  const dockAppsConfig = useMemo(() =>
    DOCK_APPS.map(id => INSTALLED_APPS.find(app => app.id === id)).filter(Boolean) as typeof INSTALLED_APPS,
    []
  );

  useEffect(() => {
      const maxIndex = Math.max(0, totalPages - 1);
      if (_lastPageIndex > maxIndex) _lastPageIndex = maxIndex;
      if (activePageIndex <= maxIndex) return;
      setActivePageIndex(maxIndex);
      const el = scrollContainerRef.current;
      if (el) el.scrollLeft = el.clientWidth * maxIndex;
  }, [activePageIndex, totalPages]);

  useEffect(() => {
      let cancelled = false;
      const loadData = async () => {
          // SAFEGUARD: If characters array is empty, reset widget char
          if (!characters || characters.length === 0) {
              setWidgetChar(null);
              setLastMessage('No Character Connected');
              return;
          }

          const unreadEntries = Object.entries(unreadMessages)
              .filter(([, count]) => (count || 0) > 0);
          const fallbackChar = characters.find(c => c.id === activeCharacterId) || characters[0];
          let targetChar = fallbackChar;
          let latestMessage: Awaited<ReturnType<typeof getLatestPrivateMessage>> | undefined;

          try {
              let best: { char: CharacterProfile; count: number; timestamp: number; message: typeof latestMessage } | null = null;
              for (const [charId, rawCount] of unreadEntries) {
                  const candidate = characters.find(c => c.id === charId);
                  if (!candidate) continue;
                  const message = await getLatestPrivateMessage(candidate.id);
                  const timestamp = message?.timestamp || 0;
                  const count = rawCount || 0;
                  if (!best || timestamp > best.timestamp || (timestamp === best.timestamp && count > best.count)) {
                      best = { char: candidate, count, timestamp, message };
                  }
              }
              if (best) {
                  targetChar = best.char;
                  latestMessage = best.message;
              }
              const last = latestMessage || await getLatestPrivateMessage(targetChar.id);
              if (cancelled) return;
              setWidgetChar(targetChar);
              setLastMessage(last ? previewForMessage(last, '[一封新信]') : (targetChar.description || "System Ready."));
          } catch (e) {
              console.error(e);
              if (!cancelled) {
                  setWidgetChar(targetChar);
                  setLastMessage(targetChar.description || "System Ready.");
              }
          }
      };

      if (isDataLoaded) {
          void loadData();
      }
      return () => { cancelled = true; };
  }, [activeCharacterId, lastMsgTimestamp, isDataLoaded, characters, unreadMessages]); // Trigger on characters change

  // Schedule widget data loading
  const scheduleChar = useMemo(() => {
      if (!characters || characters.length === 0) return null;
      if (scheduleCharId) return characters.find(c => c.id === scheduleCharId) || characters[0];
      return characters.find(c => c.id === activeCharacterId) || characters[0];
  }, [characters, scheduleCharId, activeCharacterId]);

  useEffect(() => {
      if (!scheduleChar || !isDataLoaded) {
          setScheduleData(null);
          setScheduleLifeNotes({});
          return;
      }
      let cancelled = false;
      const today = new Date().toISOString().split('T')[0];
      const load = async () => {
          const s = await DB.getDailySchedule(scheduleChar.id, today).catch(() => null);
          if (cancelled) return;
          setScheduleData(s);
          if (!s) {
              setScheduleLifeNotes({});
              return;
          }
          const notes = await loadScheduleLifeNotes(s);
          if (!cancelled) setScheduleLifeNotes(notes);
      };
      void load();
      const onScheduleUpdated = (e: Event) => {
          const detail = (e as CustomEvent<{ charId?: string; date?: string; deleted?: boolean }>).detail || {};
          if (detail.charId !== scheduleChar.id) return;
          if (detail.date && detail.date !== today) return;
          if (detail.deleted) {
              setScheduleData(null);
              setScheduleLifeNotes({});
              return;
          }
          void load();
      };
      const onLifeEventUpdated = (e: Event) => {
          const detail = (e as CustomEvent<{ charId?: string; scheduleDate?: string }>).detail || {};
          if (detail.charId !== scheduleChar.id) return;
          if (detail.scheduleDate && detail.scheduleDate !== today) return;
          void load();
      };
      window.addEventListener(DAILY_SCHEDULE_UPDATED_EVENT, onScheduleUpdated);
      window.addEventListener(CHAR_LIFE_EVENT_UPDATED_EVENT, onLifeEventUpdated);
      return () => {
          cancelled = true;
          window.removeEventListener(DAILY_SCHEDULE_UPDATED_EVENT, onScheduleUpdated);
          window.removeEventListener(CHAR_LIFE_EVENT_UPDATED_EVENT, onLifeEventUpdated);
      };
  }, [scheduleChar, isDataLoaded]);

  // Restore scroll position BEFORE paint to avoid visible flash/slide
  useLayoutEffect(() => {
      const el = scrollContainerRef.current;
      if (el && _lastPageIndex > 0) {
          // Temporarily disable smooth scroll so jump is instant
          el.style.scrollBehavior = 'auto';
          el.scrollLeft = el.clientWidth * _lastPageIndex;
          // Re-enable on next frame
          requestAnimationFrame(() => { el.style.scrollBehavior = 'smooth'; });
      }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleScroll = () => {
      if (scrollContainerRef.current) {
          const width = scrollContainerRef.current.clientWidth;
          const scrollLeft = scrollContainerRef.current.scrollLeft;
          const index = Math.max(0, Math.min(totalPages - 1, Math.round(scrollLeft / Math.max(1, width))));
          setActivePageIndex(index);
          _lastPageIndex = index; // Persist across remounts
          persistLastPageIndex(index);
      }
  };

  // --- Mouse Drag Handlers ---
  const handleMouseDown = (e: React.MouseEvent) => {
      if (!scrollContainerRef.current) return;
      // 编辑模式按住桌面项 = 拖项排序，不抢页面横向滚动
      if (draggingKeyRef.current) return;
      if (editModeRef.current && (e.target as HTMLElement | null)?.closest?.('[data-desk-item]')) return;
      isDragging.current = true;
      dragMoved.current = 0;
      startX.current = e.pageX - scrollContainerRef.current.offsetLeft;
      scrollLeftRef.current = scrollContainerRef.current.scrollLeft;

      // Disable snap and smooth scroll for direct control
      scrollContainerRef.current.style.scrollBehavior = 'auto';
      scrollContainerRef.current.style.scrollSnapType = 'none';
      scrollContainerRef.current.style.cursor = 'grabbing';
  };

  const handleMouseMove = (e: React.MouseEvent) => {
      if (draggingKeyRef.current) return;
      if (!isDragging.current || !scrollContainerRef.current) return;
      e.preventDefault();
      const x = e.pageX - scrollContainerRef.current.offsetLeft;
      const walk = (x - startX.current);
      scrollContainerRef.current.scrollLeft = scrollLeftRef.current - walk;

      dragMoved.current = Math.abs(x - startX.current);
  };

  const handleMouseUp = () => {
      if (!isDragging.current || !scrollContainerRef.current) return;
      isDragging.current = false;

      // Restore styles
      scrollContainerRef.current.style.scrollBehavior = 'smooth';
      scrollContainerRef.current.style.scrollSnapType = 'x mandatory';
      scrollContainerRef.current.style.cursor = 'grab';
  };

  const handleMouseLeave = () => {
      if (isDragging.current) handleMouseUp();
  };

  const handleClickCapture = (e: React.MouseEvent) => {
      if (dragMoved.current > 5) {
          e.stopPropagation();
          e.preventDefault();
      }
  };

  const contentColor = theme.contentColor || '#2b2933';
  const themeHue = Number.isFinite(theme.hue) ? theme.hue : 248;
  // 设了自定义壁纸时（图片或非默认底色），桌面让出自己那层不透明底色，
  // 把 PhoneShell 渲染在底下的壁纸透出来 —— 否则桌面壁纸设了却被盖住，看不见。
  const hasCustomWallpaper = !!theme.wallpaper && (theme.wallpaper !== DEFAULT_WALLPAPER || isImageWallpaper(theme.wallpaper));
  const desktopBackdropStyle: React.CSSProperties = {
      backgroundColor: '#f4f2ed',
      background: toWallpaperBackground(theme.wallpaper || DEFAULT_WALLPAPER),
      backgroundPosition: 'center',
      backgroundSize: 'cover',
      backgroundRepeat: 'no-repeat',
  };
  const dockStyle = theme.desktopDockStyle || 'glass';
  const dockShellStyle: React.CSSProperties =
      dockStyle === 'minimal' ? {
          background: 'transparent',
          border: '1px solid rgba(43,41,51,0.08)',
          boxShadow: 'none',
      } : dockStyle === 'solid' ? {
          background: 'rgba(43,41,51,0.92)',
          border: '1px solid rgba(255,255,255,0.06)',
          boxShadow: '0 18px 36px -24px rgba(20,18,28,0.6)',
      } : dockStyle === 'paper' ? {
          background: 'rgba(251,250,247,0.95)',
          border: '1px solid rgba(224,220,213,0.95)',
          boxShadow: '0 18px 36px -24px rgba(43,41,51,0.3)',
      } : {
          background: 'rgba(255,255,255,0.38)',
          border: '1px solid rgba(255,255,255,0.44)',
          boxShadow: '0 18px 36px -24px rgba(43,41,51,0.34)',
          backdropFilter: 'blur(16px)',
      };
  // 已迁移 App 外壳已收回到可见 viewport 底边，dock 仅需自留视觉间距，无需再 + safe-bottom
  // （否则会比 home 条上方多让 34px，dock 看起来悬空）。
  const launcherBottomInset = 'var(--moro-launcher-bottom-inset, 1.25rem)';

  const totalUnread = Object.values(unreadMessages).reduce((a, b) => a + b, 0);
  const widgetUnread = widgetChar && unreadMessages[widgetChar.id] ? unreadMessages[widgetChar.id] : 0;

  const draggingItem = draggingKey ? deskItems.find(i => i.key === draggingKey) : null;
  const draggingApp = draggingItem?.kind === 'app' ? gridApps.find(a => a.id === draggingItem.id) : null;

  // 渲染单个桌面项内容（位置由外层 grid 决定）
  const renderDeskItem = (item: DeskItem) => {
      if (item.kind === 'app') {
          const app = gridApps.find(a => a.id === item.id);
          if (!app) return null;
          return (
              <div className="w-full h-full flex items-center justify-center">
                  <AppIcon app={app} onClick={() => openApp(app.id)} size="md" />
              </div>
          );
      }
      switch (item.id) {
          case 'clock':
              return <DesktopClock />;
          case 'weather':
              return <WeatherWidget contentColor={contentColor} />;
          case 'character':
              return (
                  <CharacterWidget
                      char={widgetChar}
                      unreadCount={widgetUnread}
                      lastMessage={lastMessage}
                      onClick={() => openApp(AppID.Chat)}
                      contentColor={contentColor}
                  />
              );
          case 'schedule':
              return scheduleChar ? (
                  <div className="w-full h-full flex flex-col justify-center overflow-hidden">
                      <ScheduleHomeWidget
                          schedule={scheduleData}
                          lifeNotes={scheduleLifeNotes}
                          character={scheduleChar}
                          contentColor={contentColor}
                          onOpen={() => setScheduleViewerOpen(true)}
                      />
                  </div>
              ) : (
                  <div className="w-full h-full glass-card rounded-[1.75rem] flex items-center justify-center text-[10px] opacity-40" style={{ color: contentColor }}>
                      暂无角色日程
                  </div>
              );
          case 'music':
              return <NowPlayingSquareWidget contentColor={contentColor} />;
          case 'text':
              return <DesktopTextWidget contentColor={contentColor} editMode={editMode} />;
          case 'image':
              return (
                  <DesktopPolaroidImage
                      image={theme.launcherWidgets?.['dsq']}
                      contentColor={contentColor}
                      onClick={() => openApp(AppID.Appearance)}
                      caption=""
                  />
              );
          case 'imgtl':
          case 'imgtr':
          case 'imgwide': {
              const slot = item.id === 'imgtl' ? 'tl' : item.id === 'imgtr' ? 'tr' : 'wide';
              const src = theme.launcherWidgets?.[slot];
              if (!src) return null;
              return (
                  <DesktopPolaroidImage
                      image={src}
                      contentColor={contentColor}
                      onClick={() => openApp(AppID.Appearance)}
                      caption={item.id === 'imgwide' ? 'Gallery memo' : 'Pocket shot'}
                      variant={item.id === 'imgwide' ? 'wide' : 'portrait'}
                  />
              );
          }
          default:
              return null;
      }
  };

  return (
    <div
      className="moro-desktop-root h-full w-full flex flex-col relative z-10 overflow-hidden font-sans select-none isolate"
      data-has-wallpaper={hasCustomWallpaper ? 'true' : undefined}
      style={{
        ...desktopBackdropStyle,
        color: contentColor,
        '--moro-desktop-hue': themeHue,
        backfaceVisibility: 'hidden',
        WebkitBackfaceVisibility: 'hidden',
      } as React.CSSProperties}
    >

      {/* 小组件自定义 CSS（主题 → 桌面小组件，.moro-widget-* 钩子类） */}
      {widgetCustomCss && <style>{widgetCustomCss}</style>}

      {/* 编辑模式：项目抖动动画 + 「完成」按钮 */}
      {editMode && (
        <>
          <style>{`
            @keyframes iconJiggle{0%{transform:rotate(-1.6deg)}50%{transform:rotate(1.6deg)}100%{transform:rotate(-1.6deg)}}
            @keyframes iconBreathe{0%{transform:scale(1)}50%{transform:scale(1.028)}100%{transform:scale(1)}}
            .animate-icon-jiggle{animation:iconJiggle .55s ease-in-out infinite}
            .animate-icon-breathe{animation:iconBreathe 1.2s ease-in-out infinite}
          `}</style>
          <button
            onClick={() => setEditMode(false)}
            className="absolute right-5 z-40 px-5 py-2 rounded-full text-white text-xs font-bold shadow-lg press-soft animate-pop-in"
            style={{ top: 'calc(var(--chrome-top) + 0.75rem)', background: '#2c2a35', boxShadow: '0 10px 24px -10px rgba(44,42,53,0.6)' }}
          >完成</button>
        </>
      )}

      {/* 拖拽中的幽灵：跟随指针，位置由全局 pointermove 直接写 DOM（不触发重渲染） */}
      {draggingItem && (
        <div
          ref={(el) => {
              ghostElRef.current = el;
              if (el) el.style.transform = `translate(${lastPointerPos.current.x}px, ${lastPointerPos.current.y}px) translate(-50%, -50%) scale(1.12)`;
          }}
          className="fixed left-0 top-0 z-[90] pointer-events-none opacity-95 drop-shadow-[0_18px_30px_rgba(20,18,28,0.22)]"
        >
          {draggingApp ? (
              <AppIcon app={draggingApp} onClick={() => {}} hideLabel size="md" />
          ) : (
              <div className="px-4 py-2.5 rounded-2xl glass-card text-xs font-bold shadow-xl border border-white/40" style={{ color: contentColor }}>
                  {WIDGET_LABELS[draggingItem.id] || '组件'}
              </div>
          )}
        </div>
      )}

      <div className="moro-desktop-atmosphere absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute inset-0 moro-desktop-mesh" />
          <div className="moro-theme-watermarks absolute inset-0">
              <span>MoroPhone</span>
              <span>Shining</span>
              <span>CosmicLove</span>
              <span>Finne</span>
              <span>Memory</span>
              <span>Polaroid</span>
          </div>
          <div className="moro-theme-sparkles absolute inset-0">
              <span className="moro-star s1" />
              <span className="moro-star s2" />
              <span className="moro-star s3" />
              <span className="moro-star s4" />
              <span className="moro-star s5" />
              <span className="moro-star s6" />
              <span className="moro-star s7" />
          </div>
          {!hasCustomWallpaper && (
              <div className="moro-theme-collage absolute inset-0">
                  <span className="moro-polaroid-deco deco-a"><i /></span>
                  <span className="moro-polaroid-deco deco-b"><i /></span>
                  <span className="moro-vinyl-deco" />
                  <span className="moro-soft-sticker sticker-a" />
                  <span className="moro-soft-sticker sticker-b" />
              </div>
          )}
      </div>

      {/* Scrollable Content Layer */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onClickCapture={handleClickCapture}
        className="moro-desktop-scroll relative z-10 flex-1 min-h-0 flex overflow-x-auto overflow-y-hidden snap-x snap-mandatory no-scrollbar cursor-grab active:cursor-grabbing"
        style={{
            backgroundColor: 'rgba(244,242,237,0.001)',
            scrollBehavior: 'smooth',
            overscrollBehaviorX: 'none',
            overscrollBehaviorY: 'none',
            touchAction: 'pan-x',
            willChange: 'scroll-position',
            transform: 'translate3d(0,0,0)',
            WebkitOverflowScrolling: 'touch',
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
            contain: 'layout paint style',
            isolation: 'isolate',
        }}
      >
          {/* Render Desk Pages（统一网格：组件 + 图标按装箱位置摆放，全部可拖拽） */}
          {renderedPages.map((placed, idx) => (
              <div
                key={idx}
                data-desk-page={idx}
                data-page-index={idx}
                className="moro-desktop-page w-full flex-shrink-0 snap-center snap-always px-5 pt-[calc(var(--chrome-top)+2.35rem)] pb-7 h-full relative overflow-hidden"
                style={{
                    paddingLeft: 'var(--moro-desktop-page-x, 1.25rem)',
                    paddingRight: 'var(--moro-desktop-page-x, 1.25rem)',
                    paddingTop: 'var(--moro-desktop-page-top, calc(var(--chrome-top) + 2.35rem))',
                    paddingBottom: 'var(--moro-desktop-page-bottom, 1.75rem)',
                    backgroundColor: 'rgba(244,242,237,0.001)',
                    transform: 'translate3d(0,0,0)',
                    backfaceVisibility: 'hidden',
                    WebkitBackfaceVisibility: 'hidden',
                    contain: 'layout paint style',
                }}
              >
                  {/* Free-positioned Desktop Decorations 保持挂在第 3 页（z-20 浮在网格之上，不挡点击） */}
                  {idx === 2 && theme.desktopDecorations && theme.desktopDecorations.length > 0 && (
                      <div className="absolute inset-0 pointer-events-none overflow-hidden z-20">
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
                                      filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.15))',
                                  }}
                              />
                          ))}
                      </div>
                  )}

                  <div
                      data-desk-grid="true"
                      className="moro-desktop-grid w-full h-full grid grid-cols-4 gap-x-3 gap-y-3"
                      style={{
                          gridTemplateRows: `repeat(${PAGE_ROWS}, minmax(0, 1fr))`,
                          columnGap: 'var(--moro-desktop-grid-gap-x, 0.75rem)',
                          rowGap: 'var(--moro-desktop-grid-gap-y, 0.75rem)',
                      }}
                  >
                      {placed.map(({ item, col, row }, itemIndex) => (
                          <div
                              key={item.key}
                              data-desk-item={item.key}
                              className={`moro-desk-item relative min-w-0 min-h-0 transition-[transform,opacity,filter,box-shadow] duration-200 will-change-transform ${item.kind === 'app' ? 'moro-desk-app-cell' : ''} ${item.kind === 'widget' ? `moro-widget-${item.id}` : ''} ${editMode && item.kind === 'app' && editEffect === 'wiggle' ? 'animate-icon-jiggle' : ''} ${editMode && item.kind === 'app' && editEffect === 'breathe' ? 'animate-icon-breathe' : ''} ${draggingKey === item.key ? 'opacity-25 scale-[0.97]' : ''} ${dropTargetKey === item.key ? 'scale-[1.02] z-10' : ''}`}
                              style={{
                                  gridColumn: `${col + 1} / span ${item.w}`,
                                  gridRow: `${row + 1} / span ${item.h}`,
                                  animationDelay: `${Math.min(260, itemIndex * 24)}ms`,
                                  boxShadow: dropTargetKey === item.key ? '0 0 0 2px rgba(255,255,255,0.62), 0 16px 28px -18px rgba(16,22,34,0.45)' : undefined,
                                  filter: dropTargetKey === item.key ? 'saturate(1.04)' : undefined,
                                  ...(editMode ? { touchAction: 'none' as const } : {}),
                              }}
                              onPointerDown={(e) => handleItemPointerDown(item.key, e)}
                              onContextMenu={editMode ? (e) => e.preventDefault() : undefined}
                              onClickCapture={(e) => {
                                  if (shouldSuppressIconClick()) { e.preventDefault(); e.stopPropagation(); }
                              }}
                          >
                              {renderDeskItem(item)}
                          </div>
                      ))}
                  </div>
              </div>
          ))}

      </div>

      {/* Page Indicators */}
      <div
          className="absolute left-0 w-full flex justify-center gap-2 pointer-events-none z-20"
          style={{ bottom: `calc(${launcherBottomInset} + 5.5rem)` }}
      >
          {Array.from({ length: totalPages }).map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all duration-300 ${activePageIndex === i ? 'w-4 opacity-100' : 'w-1.5 opacity-40'}`}
                style={{ backgroundColor: contentColor }}
              ></div>
          ))}
      </div>

      {/* Floating Dock - Updated Margin and Safe Area handling */}
      <div
           className="mt-auto flex justify-center w-full px-4 relative z-30"
           style={{ paddingBottom: launcherBottomInset }}
      >
           <div
             className="moro-dock glass-pill rounded-full px-8 py-3.5 flex gap-7 sm:gap-10 items-center mx-auto max-w-full justify-between overflow-x-auto no-scrollbar transform-gpu transition-[background,border-color,box-shadow] duration-300"
             style={{
                 ...dockShellStyle,
                 gap: 'var(--moro-dock-gap, 1.75rem)',
                 paddingLeft: 'var(--moro-dock-pad-x, 2rem)',
                 paddingRight: 'var(--moro-dock-pad-x, 2rem)',
                 paddingTop: 'var(--moro-dock-pad-y, 0.875rem)',
                 paddingBottom: 'var(--moro-dock-pad-y, 0.875rem)',
             }}
            >
               {dockAppsConfig.map(app => (
                   <div key={app.id} className="relative">
                        <AppIcon app={app} onClick={() => openApp(app.id)} variant="dock" size="md" />
                        {app.id === AppID.GroupChat && totalUnread > 0 && (
                            <div className="absolute -top-1 -right-1.5 w-5 h-5 bg-[#f43f3f] rounded-full text-white text-[9px] flex items-center justify-center border-2 border-white shadow-sm font-bold pointer-events-none animate-pop-in">
                                {totalUnread > 9 ? '9+' : totalUnread}
                            </div>
                        )}
                   </div>
               ))}
           </div>
      </div>

      <ScheduleFullscreenViewer
          open={scheduleViewerOpen}
          onClose={() => setScheduleViewerOpen(false)}
          characters={characters}
          activeCharId={scheduleChar?.id || null}
          onSwitchCharacter={(id) => setScheduleCharId(id)}
          schedule={scheduleData}
          lifeNotes={scheduleLifeNotes}
          activeCharacter={scheduleChar}
          contentColor={contentColor}
      />

    </div>
  );
};

export default Launcher;
