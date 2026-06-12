import React, { useMemo, useEffect, useLayoutEffect, useState, useRef } from 'react';
import { useOS } from '../context/OSContext';
import { INSTALLED_APPS, DOCK_APPS } from '../constants';
import { isDevDebugAvailable, subscribeDevDebugAvailability } from '../utils/devDebug';
import AppIcon from '../components/os/AppIcon';
import { DB } from '../utils/db';
import { CharacterProfile, Anniversary, AppID, DailySchedule } from '../types';
import { ScheduleHomeWidget, ScheduleFullscreenViewer } from '../components/schedule/ScheduleHomeWidget';
import NowPlayingSquareWidget from '../components/os/NowPlayingSquareWidget';

// --- Isolated Components to prevent full re-renders ---

// 1. Clock Component (Consumes virtualTime)
const DesktopClock = React.memo(() => {
    const { virtualTime, openApp, lock } = useOS();

    const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    const now = new Date();
    const dayName = days[now.getDay()];
    const dateNum = now.getDate().toString();

    // 治愈系问候（基于虚拟时间）
    const greeting = virtualTime.hours < 5 ? '夜深了，记得早点休息。'
        : virtualTime.hours < 12 ? '早安，新的一天慢慢来。'
        : virtualTime.hours < 14 ? '午后小憩，喝口水吧。'
        : virtualTime.hours < 18 ? '天天开心，万事顺意。'
        : '晚风正好，今天辛苦了。';

    const hh = virtualTime.hours.toString().padStart(2, '0');
    const mm = virtualTime.minutes.toString().padStart(2, '0');

    // 手帐拼贴日期卡（参照黑白手帐桌面）：天空蓝照片质感 + 大号日期 + 星期 + FOCUS 胶囊
    return (
        <div className="moro-clock-card h-full w-full rounded-[2rem] px-6 py-6 relative overflow-hidden animate-rise-in select-none flex flex-col text-white"
            style={{
                background: 'linear-gradient(168deg, #5d7eab 0%, #4a6a9b 42%, #3e5d8d 100%)',
                boxShadow: '0 20px 44px -20px rgba(52, 74, 110, 0.55)',
            }}>
            {/* 照片氛围：右侧"阳台白墙"色块 + 漂浮云影，模拟拍立得天空照 */}
            <div className="absolute inset-y-0 right-0 w-[38%] pointer-events-none opacity-90"
                style={{ background: 'linear-gradient(195deg, rgba(244,242,238,0.92) 0%, rgba(235,232,226,0.85) 55%, rgba(222,219,212,0.8) 100%)', clipPath: 'polygon(34% 0, 100% 0, 100% 100%, 12% 100%, 30% 52%)' }} />
            <div className="absolute top-6 right-[30%] w-28 h-28 rounded-full pointer-events-none animate-drift-slow"
                style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.28), transparent 70%)' }} />
            <div className="absolute bottom-2 -left-8 w-40 h-24 rounded-full pointer-events-none animate-breathe"
                style={{ background: 'radial-gradient(ellipse, rgba(255,255,255,0.18), transparent 70%)' }} />

            <div className="relative z-10 flex-1 flex flex-col">
                <div className="moro-clock-time text-[3.75rem] leading-none font-bold tracking-tight"
                    style={{ fontFamily: 'var(--font-hand)', textShadow: '0 2px 14px rgba(30,48,80,0.35)' }}>
                    {dateNum}
                </div>
                <div className="text-[13px] label-mono font-bold tracking-[0.3em] mt-1 opacity-95">{dayName}</div>

                <div className="mt-auto flex items-end justify-between gap-3">
                    <div className="min-w-0">
                        <div className="text-[22px] font-semibold leading-none tabular-nums" style={{ textShadow: '0 1px 10px rgba(30,48,80,0.3)' }}>
                            {hh}<span className="opacity-60 animate-pulse mx-0.5">:</span>{mm}
                        </div>
                        <div className="moro-clock-greeting text-[11px] mt-2 opacity-85 font-medium tracking-wide truncate">{greeting}</div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                        {/* 一键锁屏：只切换到锁屏界面，主动消息 / 推送 / 锁屏通知卡照常运行 */}
                        <button
                            onClick={lock}
                            className="w-9 h-9 rounded-full press-soft inline-flex items-center justify-center"
                            style={{ background: 'rgba(255,255,255,0.22)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.4)' }}
                            aria-label="一键锁屏"
                        >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zM9 8V6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9z"/></svg>
                        </button>
                        <button
                            onClick={() => openApp(AppID.Appearance)}
                            className="moro-palette-btn label-mono text-[10px] font-bold px-5 py-2.5 rounded-full press-soft"
                            style={{ background: 'rgba(255,255,255,0.24)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.45)', color: '#ffffff', textShadow: '0 1px 6px rgba(30,48,80,0.3)' }}
                        >
                            Focus
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
    // 手帐聊天预览卡（参照黑白手帐桌面）：黑色聊天圆钮 + 红色未读角标 + 头像/气泡式消息预览
    return (
        <div className="h-full w-full group animate-rise-in" style={{ animationDelay: '60ms' }}>
             <div
                className="moro-character-card glass-card relative w-full h-full overflow-hidden rounded-[2rem] cursor-pointer press-soft"
                onClick={onClick}
                style={{ color: contentColor }}
             >
                 <div className="relative h-full flex items-center px-5 py-3 gap-4">
                     {/* 黑色聊天圆钮 + 未读红点（仿 WeChat 小组件入口） */}
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

                     {/* 消息预览：手写体标签 + 灰底气泡里的最近一条 */}
                     <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                         <div className="flex items-center gap-2 min-w-0">
                             <span className="font-hand text-[17px] leading-none opacity-55 truncate">{char?.name || 'WeChat'}</span>
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

// 3. Square image slot (free-position widget)
const DesktopSquareImage = React.memo(({ image, contentColor, onClick }: {
    image?: string,
    contentColor: string,
    onClick: () => void,
}) => {
    return (
        <div
            onClick={onClick}
            className={`relative w-full h-full rounded-[1.75rem] overflow-hidden cursor-pointer animate-fade-in press-soft ${image ? '' : 'glass-card'}`}
            style={{ color: contentColor }}
        >
            {image ? (
                <img src={image} alt="" className="w-full h-full object-cover" loading="lazy" />
            ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-3 text-center">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center bg-white/60 border border-[#ececf2]">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor" className="w-4 h-4 opacity-70">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
                        </svg>
                    </div>
                    <div className="text-[8.5px] label-mono font-bold opacity-55">Add Image</div>
                    <div className="text-[8.5px] opacity-40 leading-tight">从 外观 · 启动器组件<br/>设置一张方图</div>
                </div>
            )}
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

// 4. Widget Page Component (Calendar + Events)
const WidgetsPage = React.memo(({ contentColor, openApp, anniversaries, characters }: any) => {
    const accentDot = '#2b2933'; // 墨色事件点，呼应黑白手帐配色
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const monthName = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][currentMonth];

    const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
    const getFirstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

    const totalDays = getDaysInMonth(currentYear, currentMonth);
    const startOffset = getFirstDayOfMonth(currentYear, currentMonth);

    const calendarDays = Array.from({ length: totalDays }, (_, i) => i + 1);
    const paddingDays = Array.from({ length: startOffset }, () => null);

    // --- Upcoming events: only today + future, soonest first (non-mutating), paginated ---
    const todayStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const upcomingEvents = useMemo(
        () => [...(anniversaries as any[])]
            .filter((a: any) => a.date >= todayStr)
            .sort((a: any, b: any) => a.date.localeCompare(b.date)),
        [anniversaries, todayStr]
    );
    const EVENTS_PER_PAGE = 4;
    const eventPageCount = Math.max(1, Math.ceil(upcomingEvents.length / EVENTS_PER_PAGE));
    const [eventPage, setEventPage] = useState(0);
    // Clamp the page if the list shrinks (e.g. an event passes / is removed)
    useEffect(() => {
        if (eventPage > eventPageCount - 1) setEventPage(eventPageCount - 1);
    }, [eventPageCount, eventPage]);
    const pagedEvents = upcomingEvents.slice(eventPage * EVENTS_PER_PAGE, eventPage * EVENTS_PER_PAGE + EVENTS_PER_PAGE);

    return (
        <div className="w-full flex-shrink-0 snap-center snap-always flex flex-col px-6 pt-24 pb-8 space-y-6 h-full overflow-y-auto no-scrollbar">
              <div className="moro-widget-card glass-card rounded-3xl p-6 animate-rise-in">
                  <div className="flex justify-between items-center mb-4" style={{ color: contentColor }}>
                      <h3 className="text-xl font-display-italic font-semibold tracking-wide">{monthName} <span className="label-mono text-[11px] font-bold opacity-50 align-middle ml-1">{currentYear}</span></h3>
                      <div onClick={() => openApp('schedule')} className="p-2 rounded-full cursor-pointer transition-colors bg-white/60 border border-[#ececf2] hover:bg-white press-soft">
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                      </div>
                  </div>

                  <div className="grid grid-cols-7 gap-y-3 gap-x-1 text-center mb-2">
                      {CALENDAR_WEEKDAYS.map(day => <div key={day.key} className="text-[10px] font-bold opacity-40" style={{ color: contentColor }}>{day.label}</div>)}
                  </div>

                  <div className="grid grid-cols-7 gap-y-2 gap-x-1 text-center">
                      {paddingDays.map((_, i) => <div key={`pad-${i}`} />)}
                      {calendarDays.map(day => {
                          const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                          const isToday = day === now.getDate();
                          const hasEvent = anniversaries.some((a: any) => a.date === dateStr);

                          return (
                              <div key={day} className="flex flex-col items-center justify-center h-8 relative">
                                  <div
                                    className={`w-8 h-8 flex items-center justify-center rounded-full text-sm font-medium ${isToday ? 'text-white font-bold shadow-lg' : 'opacity-80'}`}
                                    style={isToday ? { background: '#2c2a35' } : { color: contentColor }}
                                  >
                                      {day}
                                  </div>
                                  {hasEvent && <div className="w-1.5 h-1.5 rounded-full absolute bottom-0 shadow-sm" style={{ background: accentDot }}></div>}
                              </div>
                          );
                      })}
                  </div>
              </div>

              <div className="moro-widget-card glass-card rounded-3xl p-5 flex flex-col flex-1 min-h-[200px] animate-rise-in" style={{ animationDelay: '80ms' }}>
                  <div className="flex items-center justify-between mb-4">
                      <h3 className="text-[10px] font-bold opacity-60 label-mono flex items-center gap-2" style={{ color: contentColor }}>
                          <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: accentDot }}></span> Upcoming Events
                      </h3>
                      {eventPageCount > 1 && (
                          <div className="flex items-center gap-2 shrink-0" style={{ color: contentColor }}>
                              <button
                                  onClick={(e) => { e.stopPropagation(); setEventPage(p => Math.max(0, p - 1)); }}
                                  disabled={eventPage === 0}
                                  className="w-6 h-6 rounded-full bg-black/5 border border-[#ececf2] flex items-center justify-center disabled:opacity-25 hover:bg-black/10 transition-colors active:scale-90"
                                  aria-label="Previous events"
                              >
                                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
                              </button>
                              <span className="text-[10px] font-mono opacity-60 tabular-nums">{eventPage + 1}/{eventPageCount}</span>
                              <button
                                  onClick={(e) => { e.stopPropagation(); setEventPage(p => Math.min(eventPageCount - 1, p + 1)); }}
                                  disabled={eventPage >= eventPageCount - 1}
                                  className="w-6 h-6 rounded-full bg-black/5 border border-[#ececf2] flex items-center justify-center disabled:opacity-25 hover:bg-black/10 transition-colors active:scale-90"
                                  aria-label="Next events"
                              >
                                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
                              </button>
                          </div>
                      )}
                  </div>
                  <div className="space-y-3">
                      {upcomingEvents.length > 0 ? pagedEvents.map((anni: any) => (
                          <div key={anni.id} className="flex items-center gap-3 p-3 rounded-2xl bg-white/70 border border-[#f0ede6]">
                              <div className="w-10 h-10 shrink-0 rounded-xl flex flex-col items-center justify-center bg-[#f4f2ec] text-[#2b2933] border border-[#e7e4dc]">
                                  <span className="text-[9px] opacity-70">{anni.date.split('-')[1]}</span>
                                  <span className="text-sm font-bold leading-none">{anni.date.split('-')[2]}</span>
                              </div>
                              <div className="flex-1 min-w-0">
                                  <div className="text-sm font-bold truncate" style={{ color: contentColor }}>{anni.title}</div>
                                  <div className="text-[10px] opacity-50 truncate" style={{ color: contentColor }}>{characters.find((c: any) => c.id === anni.charId)?.name || 'Unknown'}</div>
                              </div>
                          </div>
                      )) : (
                          <div className="text-center opacity-30 text-xs py-8" style={{ color: contentColor }}>No upcoming events</div>
                      )}
                  </div>
              </div>
        </div>
    );
});

// --- Persist scroll page across remounts (e.g. returning from apps) ---
let _lastPageIndex = 0;

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

const PAGE_COLS = 4;
const PAGE_ROWS = 12;

const DESK_ORDER_KEY = 'moro_desktop_items_v1';
const loadStoredDeskOrder = (): string[] => {
    try {
        const raw = JSON.parse(localStorage.getItem(DESK_ORDER_KEY) || '[]');
        return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
    } catch { return []; }
};

/** 首次使用（没存过布局）的默认顺序：复刻旧版「时钟+聊天卡+8 图标 / 日程+音乐+方图」分页 */
const buildDefaultKeys = (appKeys: string[], widgetKeys: Set<string>): string[] => {
    const mid = ['widget:schedule', 'widget:music', 'widget:image', 'widget:imgtl', 'widget:imgtr', 'widget:imgwide']
        .filter(k => widgetKeys.has(k));
    return ['widget:clock', 'widget:character', ...appKeys.slice(0, 8), ...mid, ...appKeys.slice(8)];
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

const WIDGET_LABELS: Record<string, string> = {
    clock: '时钟',
    character: '聊天卡片',
    schedule: '日程',
    music: '音乐',
    image: '方图',
    imgtl: '小组件图',
    imgtr: '小组件图',
    imgwide: '宽幅图',
};

// --- Main Launcher ---

const Launcher: React.FC = () => {
  const { openApp, characters, activeCharacterId, theme, lastMsgTimestamp, isDataLoaded, unreadMessages } = useOS();

  // Local state for widget data to prevent context trashing
  const [widgetChar, setWidgetChar] = useState<CharacterProfile | null>(null);
  const [lastMessage, setLastMessage] = useState<string>('');
  const [anniversaries, setAnniversaries] = useState<Anniversary[]>([]);
  const [scheduleData, setScheduleData] = useState<DailySchedule | null>(null);
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
  const [editMode, setEditMode] = useState(false);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const editModeRef = useRef(false);
  const draggingKeyRef = useRef<string | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const pressStartPos = useRef({ x: 0, y: 0 });
  const lastPointerPos = useRef({ x: 0, y: 0 });
  const dragEndAtRef = useRef(0);
  const lastFlipAt = useRef(0);
  const lastReorder = useRef({ id: '', t: 0 });
  const deskItemsRef = useRef<DeskItem[]>([]);
  const ghostElRef = useRef<HTMLDivElement | null>(null);
  const blockTouchRef = useRef<((ev: TouchEvent) => void) | null>(null);

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

  // 桌面项全集（含尺寸）：固定五个组件 + 外观里设置过的小组件图 + 全部非 dock App
  const deskItems = useMemo(() => {
    const lw = theme.launcherWidgets || {};
    const widgetItems: DeskItem[] = [
        { key: 'widget:clock', kind: 'widget', id: 'clock', w: 4, h: 6 },
        { key: 'widget:character', kind: 'widget', id: 'character', w: 4, h: 2 },
        { key: 'widget:schedule', kind: 'widget', id: 'schedule', w: 4, h: 5 },
        { key: 'widget:music', kind: 'widget', id: 'music', w: 2, h: 4 },
        { key: 'widget:image', kind: 'widget', id: 'image', w: 2, h: 4 },
        ...(lw['tl'] ? [{ key: 'widget:imgtl', kind: 'widget' as const, id: 'imgtl', w: 2, h: 4 }] : []),
        ...(lw['tr'] ? [{ key: 'widget:imgtr', kind: 'widget' as const, id: 'imgtr', w: 2, h: 4 }] : []),
        ...(lw['wide'] ? [{ key: 'widget:imgwide', kind: 'widget' as const, id: 'imgwide', w: 4, h: 3 }] : []),
    ];
    const appItems: DeskItem[] = gridApps.map(a => ({ key: `app:${a.id}`, kind: 'app', id: a.id, w: 1, h: 2 }));
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
  }, [gridApps, theme.launcherWidgets, deskOrder]);

  useEffect(() => { deskItemsRef.current = deskItems; }, [deskItems]);
  useEffect(() => { editModeRef.current = editMode; }, [editMode]);
  useEffect(() => {
      if (deskOrder.length === 0) return;
      try { localStorage.setItem(DESK_ORDER_KEY, JSON.stringify(deskOrder)); } catch {}
  }, [deskOrder]);

  const packedPages = useMemo(() => packDeskPages(deskItems), [deskItems]);

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
          const hit = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest?.('[data-desk-item]') as HTMLElement | null;
          const targetKey = hit?.dataset?.deskItem;
          const now = Date.now();
          if (targetKey && targetKey !== dragKey && (lastReorder.current.id !== targetKey || now - lastReorder.current.t > 250)) {
              lastReorder.current = { id: targetKey, t: now };
              const cur = deskItemsRef.current.map(i => i.key);
              const from = cur.indexOf(dragKey);
              const to = cur.indexOf(targetKey);
              if (from >= 0 && to >= 0 && from !== to) {
                  const next = [...cur];
                  next.splice(to, 0, next.splice(from, 1)[0]);
                  setDeskOrder(next);
              }
          }
          const el = scrollContainerRef.current;
          if (el && now - lastFlipAt.current > 650) {
              const rect = el.getBoundingClientRect();
              if (e.clientX - rect.left < 36 && el.scrollLeft > 10) {
                  lastFlipAt.current = now;
                  el.scrollBy({ left: -el.clientWidth, behavior: 'smooth' });
              } else if (rect.right - e.clientX < 36) {
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

  // Total pages = Desk Pages + 1 Widget Page
  const totalPages = packedPages.length + 1;

  useEffect(() => {
      const loadData = async () => {
          // SAFEGUARD: If characters array is empty, reset widget char
          if (!characters || characters.length === 0) {
              setWidgetChar(null);
              setLastMessage('No Character Connected');
              setAnniversaries([]);
              return;
          }

          const targetChar = characters.find(c => c.id === activeCharacterId) || characters[0];
          setWidgetChar(targetChar);

          try {
              const [msgs, annis] = await Promise.all([
                  DB.getMessagesByCharId(targetChar.id),
                  DB.getAllAnniversaries()
              ]);

              if (msgs.length > 0) {
                  const visibleMsgs = msgs.filter(m => m.role !== 'system');
                  if (visibleMsgs.length > 0) {
                      const last = visibleMsgs[visibleMsgs.length - 1];
                      const cleanContent = last.content.replace(/\[.*?\]/g, '').trim();
                      setLastMessage(cleanContent || (last.type === 'image' ? '[图片]' : '[消息]'));
                  } else {
                      setLastMessage(targetChar.description || "System Ready.");
                  }
              } else {
                  setLastMessage(targetChar.description || "System Ready.");
              }
              setAnniversaries(annis);
          } catch (e) {
              console.error(e);
          }
      };

      if (isDataLoaded) {
          loadData();
      }
  }, [activeCharacterId, lastMsgTimestamp, isDataLoaded, characters]); // Trigger on characters change

  // Schedule widget data loading
  const scheduleChar = useMemo(() => {
      if (!characters || characters.length === 0) return null;
      if (scheduleCharId) return characters.find(c => c.id === scheduleCharId) || characters[0];
      return characters.find(c => c.id === activeCharacterId) || characters[0];
  }, [characters, scheduleCharId, activeCharacterId]);

  useEffect(() => {
      if (!scheduleChar || !isDataLoaded) return;
      const today = new Date().toISOString().split('T')[0];
      DB.getDailySchedule(scheduleChar.id, today).then(s => setScheduleData(s)).catch(() => {});
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
          const index = Math.round(scrollLeft / width);
          setActivePageIndex(index);
          _lastPageIndex = index; // Persist across remounts
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

      dragMoved.current = Math.abs(x - (startX.current + scrollContainerRef.current.offsetLeft));
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
  // 已迁移 App 外壳已收回到可见 viewport 底边，dock 仅需自留视觉间距，无需再 + safe-bottom
  // （否则会比 home 条上方多让 34px，dock 看起来悬空）。
  const launcherBottomInset = '1.25rem';

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
          case 'image':
              return (
                  <DesktopSquareImage
                      image={theme.launcherWidgets?.['dsq']}
                      contentColor={contentColor}
                      onClick={() => openApp(AppID.Appearance)}
                  />
              );
          case 'imgtl':
          case 'imgtr':
          case 'imgwide': {
              const slot = item.id === 'imgtl' ? 'tl' : item.id === 'imgtr' ? 'tr' : 'wide';
              const src = theme.launcherWidgets?.[slot];
              if (!src) return null;
              return (
                  <div className="w-full h-full rounded-2xl overflow-hidden shadow-md border border-white/20">
                      <img src={src} className="w-full h-full object-cover" alt="" loading="lazy" />
                  </div>
              );
          }
          default:
              return null;
      }
  };

  return (
    <div className="h-full w-full flex flex-col relative z-10 overflow-hidden font-sans select-none">

      {/* 编辑模式：项目抖动动画 + 「完成」按钮 */}
      {editMode && (
        <>
          <style>{`@keyframes iconJiggle{0%{transform:rotate(-1.6deg)}50%{transform:rotate(1.6deg)}100%{transform:rotate(-1.6deg)}}.animate-icon-jiggle{animation:iconJiggle .35s ease-in-out infinite}`}</style>
          <button
            onClick={() => setEditMode(false)}
            className="absolute right-5 z-40 px-5 py-2 rounded-full text-white text-xs font-bold shadow-lg press-soft animate-pop-in"
            style={{ top: 'calc(max(6px, var(--safe-top)) + 2.4rem)', background: '#2c2a35', boxShadow: '0 10px 24px -10px rgba(44,42,53,0.6)' }}
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
          className="fixed left-0 top-0 z-[90] pointer-events-none opacity-90"
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

      {/* 手帐纸面氛围背景：点点网纹（仿手帐内页）+ 极淡的暖白光斑（纯渐变，无 blur，低开销） */}
      <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-0 opacity-60" style={{
              backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(120,116,106,0.16) 1.2px, transparent 0)',
              backgroundSize: '17px 17px',
          }}></div>
          <div className="absolute -top-20 -right-20 w-80 h-80 rounded-full animate-drift-slow" style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.5) 0%, transparent 70%)' }}></div>
          <div className="absolute -bottom-20 -left-20 w-80 h-80 rounded-full animate-drift-slower" style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.4) 0%, transparent 70%)' }}></div>
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
        className="flex-1 flex overflow-x-auto snap-x snap-mandatory no-scrollbar cursor-grab active:cursor-grabbing"
        style={{
            scrollBehavior: 'smooth',
            overscrollBehaviorX: 'contain',
            overscrollBehaviorY: 'none',
            touchAction: 'pan-x pan-y',
            willChange: 'scroll-position',
            contain: 'layout paint',
            transform: 'translateZ(0)',
            WebkitOverflowScrolling: 'touch',
        }}
      >
          {/* Render Desk Pages（统一网格：组件 + 图标按装箱位置摆放，全部可拖拽） */}
          {packedPages.map((placed, idx) => (
              <div
                key={idx}
                className="w-full flex-shrink-0 snap-center snap-always px-6 pt-12 pb-8 h-full relative"
                style={{ contentVisibility: 'auto', contain: 'layout paint', transform: 'translateZ(0)' }}
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
                      className="w-full h-full grid grid-cols-4 gap-x-2 gap-y-2"
                      style={{ gridTemplateRows: `repeat(${PAGE_ROWS}, minmax(0, 1fr))` }}
                  >
                      {placed.map(({ item, col, row }) => (
                          <div
                              key={item.key}
                              data-desk-item={item.key}
                              className={`relative min-w-0 min-h-0 ${editMode ? 'animate-icon-jiggle' : ''} ${draggingKey === item.key ? 'opacity-30' : ''}`}
                              style={{
                                  gridColumn: `${col + 1} / span ${item.w}`,
                                  gridRow: `${row + 1} / span ${item.h}`,
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

          {/* Final Page: Widgets */}
          <WidgetsPage
            contentColor={contentColor}
            openApp={openApp}
            anniversaries={anniversaries}
            characters={characters}
          />

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
             className="moro-dock glass-pill rounded-full px-8 py-3.5 flex gap-7 sm:gap-10 items-center mx-auto max-w-full justify-between overflow-x-auto no-scrollbar transform-gpu"
           >
               {dockAppsConfig.map(app => (
                   <div key={app.id} className="relative">
                        <AppIcon app={app} onClick={() => openApp(app.id)} variant="dock" size="md" />
                        {app.id === 'chat' && totalUnread > 0 && (
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
          activeCharacter={scheduleChar}
          contentColor={contentColor}
      />

    </div>
  );
};

export default Launcher;
