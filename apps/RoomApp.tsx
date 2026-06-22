
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { RoomItem, CharacterProfile, RoomTodo, RoomNote, DailySchedule } from '../types';
import ScheduleCard from '../components/schedule/ScheduleCard';
import { ContextBuilder } from '../utils/context';
import { injectMemoryPalace } from '../utils/memoryPalace/pipeline';
import { processImage } from '../utils/file';
import { safeResponseJson } from '../utils/safeApi';
import { resolveAuxApi } from '../utils/auxApi';
import { FURNITURE_ICONS } from '../utils/furnitureIcons';
import PixelHomeView from './pixelHome/PixelHomeView';

// --- 1. 免版权贴纸素材库 (Sticker Library) ---
// 使用手绘 SVG 图标替代 Twemoji，更精致的视觉体验
const ASSET_LIBRARY = {
    furniture: [
        { name: '床', image: FURNITURE_ICONS.bed, defaultScale: 1.5 },
        { name: '沙发', image: FURNITURE_ICONS.sofa, defaultScale: 1.4 },
        { name: '椅子', image: FURNITURE_ICONS.chair, defaultScale: 1.0 },
        { name: '马桶', image: FURNITURE_ICONS.toilet, defaultScale: 1.0 },
        { name: '浴缸', image: FURNITURE_ICONS.bathtub, defaultScale: 1.5 },
    ],
    decor: [
        { name: '盆栽', image: FURNITURE_ICONS.plant, defaultScale: 0.8 },
        { name: '电脑', image: FURNITURE_ICONS.computer, defaultScale: 0.8 },
        { name: '游戏机', image: FURNITURE_ICONS.gamepad, defaultScale: 0.6 },
        { name: '吉他', image: FURNITURE_ICONS.guitar, defaultScale: 1.0 },
        { name: '画', image: FURNITURE_ICONS.painting, defaultScale: 1.2 },
        { name: '书堆', image: FURNITURE_ICONS.books, defaultScale: 0.8 },
        { name: '台灯', image: FURNITURE_ICONS.lamp, defaultScale: 0.8 },
        { name: '垃圾桶', image: FURNITURE_ICONS.trash, defaultScale: 0.7 },
    ],
    food: [
        { name: '咖啡', image: FURNITURE_ICONS.coffee, defaultScale: 0.5 },
        { name: '蛋糕', image: FURNITURE_ICONS.cake, defaultScale: 0.6 },
        { name: '披萨', image: FURNITURE_ICONS.pizza, defaultScale: 0.8 },
    ]
};

// 预设背景图 —— 黑白拼贴手账配色：素纸 / 网格 / 墨色，全程无彩
const WALLPAPER_PRESETS = [
    { name: '米白信纸', value: 'radial-gradient(circle at 50% 40%, #fbf9f3 0%, #ece8dd 100%)' },
    { name: '点阵笔记', value: 'radial-gradient(#cfcabb 1.1px, #f6f3ea 1.1px) 0 0 / 16px 16px' },
    { name: '横线稿纸', value: 'repeating-linear-gradient(0deg, #f6f3ea 0px, #f6f3ea 21px, #d6d1c4 22px)' },
    { name: '墨夜', value: 'linear-gradient(to bottom, #2b2823 0%, #161410 100%)' },
    { name: '炭笔斜纹', value: 'repeating-linear-gradient(45deg, #efece2 0px, #efece2 9px, #e2ddcf 9px, #e2ddcf 18px)' },
];

const FLOOR_PRESETS = [
    { name: '牛皮纸地板', value: 'repeating-linear-gradient(90deg, #e7e2d4 0px, #e7e2d4 20px, #d8d2c1 21px)' },
    { name: '炭木地板', value: 'repeating-linear-gradient(90deg, #3a352c 0px, #3a352c 20px, #221f19 21px)' },
    { name: '黑白棋格', value: 'conic-gradient(from 90deg at 2px 2px, #0000 90deg, #c9c3b3 0) 0 0/30px 30px' },
    { name: '素麻地毯', value: '#cdc7b6' },
];

const DEFAULT_FURNITURE: RoomItem[] = [
    { id: 'desk', name: '书桌', type: 'furniture', image: ASSET_LIBRARY.furniture[1].image, x: 20, y: 55, scale: 1.2, rotation: 0, isInteractive: true, descriptionPrompt: '这里是书桌，可能乱糟糟的，也可能整整齐齐。' },
    { id: 'plant', name: '盆栽', type: 'decor', image: ASSET_LIBRARY.decor[0].image, x: 85, y: 40, scale: 0.8, rotation: 0, isInteractive: true, descriptionPrompt: '角落里的植物。' },
];

const FLOOR_HORIZON = 65; // Floor starts at 65% from top

interface ItemInteraction {
    description: string;
    reaction: string;
}

// --- Helper: Enhanced Markdown Renderer for Notebook ---
const renderInlineStyle = (text: string) => {
    // Regular Expression to match:
    // 1. **bold**
    // 2. ~~strikethrough~~
    // 3. *italic*
    // 4. `code`
    const parts = text.split(/(\*\*.*?\*\*|~~.*?~~|\*.*?\*|`.*?`)/g);
    
    return parts.map((part, i) => {
        // Bold —— 手账里用马克笔涂一道底
        if (part.startsWith('**') && part.endsWith('**')) {
            return <strong key={i} className="font-bold text-[#1c1a17] bg-[#1c1a17]/10 box-decoration-clone px-0.5">{part.slice(2, -2)}</strong>;
        }
        // Strikethrough
        if (part.startsWith('~~') && part.endsWith('~~')) {
            return <span key={i} className="line-through text-[#9b958a] opacity-80">{part.slice(2, -2)}</span>;
        }
        // Italic (single asterisk)
        if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
            return <em key={i} className="italic text-[#4a463e]">{part.slice(1, -1)}</em>;
        }
        // Inline Code
        if (part.startsWith('`') && part.endsWith('`')) {
             return <code key={i} className="bg-[#1c1a17] text-[#f6f3ea] px-1 text-xs font-mono break-all">{part.slice(1, -1)}</code>;
        }
        return part;
    });
};

const renderNotebookContent = (text: string) => {
    // Simple Markdown-ish parser
    const parts = text.split(/(```[\s\S]*?```)/g);
    return parts.map((part, index) => {
        if (part.startsWith('```') && part.endsWith('```')) {
            // Remove code block markers
            const firstLineBreak = part.indexOf('\n');
            let codeContent = part;
            if (firstLineBreak > -1 && firstLineBreak < 10) {
                 codeContent = part.substring(firstLineBreak + 1, part.length - 3);
            } else {
                 codeContent = part.substring(3, part.length - 3);
            }
            
            return (
                <div key={index} className="my-3 w-full max-w-full">
                    {/* Keep horizontal scroll for code blocks, don't wrap */}
                    <pre className="bg-[#1c1a17] text-[#f6f3ea] p-3 text-[10px] font-mono overflow-x-auto border-l-4 border-[#9b958a] whitespace-pre">
                        {codeContent}
                    </pre>
                </div>
            );
        }
        return (
            <div key={index} className="w-full">
                {part.split('\n').map((line, lineIdx) => {
                    const key = `${index}-${lineIdx}`;
                    const trimLine = line.trim();
                    
                    if (!trimLine) return <div key={key} className="h-2"></div>;

                    if (trimLine.startsWith('# ')) {
                        return <h3 key={key} className="text-xl font-bold text-[#1c1a17] mt-4 mb-2 pb-1 border-b-2 border-dashed border-[#1c1a17] break-words font-['Long_Cang']">{trimLine.substring(2)}</h3>;
                    }
                    if (trimLine.startsWith('## ')) {
                        return <h4 key={key} className="text-base font-bold text-[#1c1a17] mt-3 mb-1 border-l-4 border-[#1c1a17] pl-2 break-words font-['Long_Cang']">{trimLine.substring(3)}</h4>;
                    }
                    if (trimLine.startsWith('> ')) {
                        return <div key={key} className="pl-3 border-l-4 border-[#1c1a17] text-[#4a463e] italic my-2 py-1 bg-[#1c1a17]/[0.04] text-xs break-words">{trimLine.substring(2)}</div>;
                    }
                    if (trimLine.startsWith('- ') || trimLine.startsWith('• ')) {
                        return <div key={key} className="flex gap-2 my-1 pl-1 items-start"><span className="text-[#1c1a17] mt-0.5 shrink-0 font-bold">✦</span><span className="flex-1 break-words">{renderInlineStyle(trimLine.substring(2))}</span></div>;
                    }

                    if (trimLine.match(/^\[[ x]\]/)) {
                         const isChecked = trimLine.includes('[x]');
                         return (
                             <div key={key} className="flex gap-2 my-1 pl-1 items-center">
                                 <div className={`w-3.5 h-3.5 border-2 border-[#1c1a17] flex items-center justify-center shrink-0 ${isChecked ? 'bg-[#1c1a17]' : ''}`}>
                                     {isChecked && <svg className="w-2 h-2 text-[#f6f3ea]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} d="M5 13l4 4L19 7" /></svg>}
                                 </div>
                                 <span className={`flex-1 break-words ${isChecked ? 'line-through text-[#9b958a]' : 'text-[#2b2823]'}`}>{renderInlineStyle(trimLine.substring(3))}</span>
                             </div>
                         );
                    }

                    return <div key={key} className="min-h-[1.5em] my-0.5 leading-relaxed break-words text-justify">{renderInlineStyle(line)}</div>;
                })}
            </div>
        );
    });
};

// --- 黑白拼贴手账：视觉零件 ---------------------------------------------
// 全部用内联线描 SVG，墨色随 currentColor 走，保证纯黑白手绘质感。
const PAPER = '#f4f1e8'; // 主纸色（墨色统一用 #1c1a17，卡片用 #fbf9f3）

// 信纸点阵底纹（贴在整个 App 背景上）
const PAPER_GRID: React.CSSProperties = {
    backgroundColor: PAPER,
    backgroundImage: 'radial-gradient(rgba(28,26,23,0.10) 1px, transparent 1px)',
    backgroundSize: '18px 18px',
};

const Ico: React.FC<{ d?: string; size?: number; className?: string; children?: React.ReactNode; sw?: number }>
    = ({ d, size = 22, className = '', children, sw = 1.8 }) => (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
        strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" className={className}>
        {d ? <path d={d} /> : children}
    </svg>
);

const I = {
    back: (p: any) => <Ico {...p} d="M15 4.5 8 12l7 7.5" />,
    fwd: (p: any) => <Ico {...p} d="M9 4.5 16 12l-7 7.5" />,
    close: (p: any) => <Ico {...p} d="M6 6l12 12M18 6 6 18" />,
    plus: (p: any) => <Ico {...p} d="M12 5v14M5 12h14" />,
    check: (p: any) => <Ico {...p} d="M5 13l4 4L19 7" />,
    house: (p: any) => <Ico {...p}><path d="M3.5 11 12 4l8.5 7" /><path d="M5.5 9.7V20h13V9.7" /><path d="M10 20v-5h4v5" /></Ico>,
    pad: (p: any) => <Ico {...p}><rect x="2.5" y="7.5" width="19" height="9" rx="4.5" /><path d="M7 11v3M5.5 12.5h3M15.5 11.5h.01M18 13.5h.01" /></Ico>,
    refresh: (p: any) => <Ico {...p}><path d="M4 11a8 8 0 0 1 13.7-4.6L20 8.5" /><path d="M20 4v4.5h-4.5" /><path d="M20 13a8 8 0 0 1-13.7 4.6L4 15.5" /><path d="M4 20v-4.5h4.5" /></Ico>,
    pencil: (p: any) => <Ico {...p}><path d="M4 20l1-4L16 5l3 3L8 19l-4 1z" /><path d="M14 7l3 3" /></Ico>,
    trash: (p: any) => <Ico {...p}><path d="M4 7h16" /><path d="M9.5 7V4.5h5V7" /><path d="M6.5 7l1 12.5h9L17.5 7" /><path d="M10 10.5v6M14 10.5v6" /></Ico>,
    pin: (p: any) => <Ico {...p}><path d="M9 3.5h6l-1 5 3 3v2H7v-2l3-3-1-5z" /><path d="M12 13.5V21" /></Ico>,
    broom: (p: any) => <Ico {...p}><path d="M19 4 11 12" /><path d="M5 20s.5-4 3.5-7 6.5-1 6.5-1L11 8s-2 3.5-5 6.5S5 20 5 20z" /></Ico>,
    stack: (p: any) => <Ico {...p}><path d="M12 3.5 21 8l-9 4.5L3 8l9-4.5z" /><path d="M3 12l9 4.5L21 12" /><path d="M3 16l9 4.5L21 16" /></Ico>,
    star: (p: any) => <Ico {...p}><path d="M12 3.5v7M12 13.5v7M3.5 12h7M13.5 12h7M6.5 6.5l3 3M14.5 14.5l3 3M17.5 6.5l-3 3M9.5 14.5l-3 3" /></Ico>,
    wall: (p: any) => <Ico {...p}><rect x="3.5" y="4.5" width="17" height="15" rx="1.5" /><path d="M3.5 9.5h17M3.5 14.5h17M9 4.5v5M15 9.5v5M9 14.5v5" /></Ico>,
    floor: (p: any) => <Ico {...p}><rect x="3.5" y="3.5" width="17" height="17" rx="1.5" /><path d="M3.5 9h17M3.5 15h17M9 3.5v17M15 3.5v17" /></Ico>,
    gear: (p: any) => <Ico {...p}><circle cx="12" cy="12" r="3.3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></Ico>,
    cam: (p: any) => <Ico {...p}><path d="M3.5 8.5h3l1.5-2h6L15.5 8.5h5v11h-17z" /><circle cx="12" cy="13.5" r="3.3" /></Ico>,
    eye: (p: any) => <Ico {...p}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.6" /></Ico>,
    list: (p: any) => <Ico {...p}><path d="M4 6.5l1.5 1.5L8 5.5M11 7h9M4 12.5l1.5 1.5L8 11.5M11 13h9M4 18.5l1.5 1.5L8 17.5M11 19h9" /></Ico>,
    cal: (p: any) => <Ico {...p}><rect x="3.5" y="5" width="17" height="15" rx="1.5" /><path d="M3.5 9.5h17M8 3v4M16 3v4" /></Ico>,
    note: (p: any) => <Ico {...p}><path d="M6 3.5h9l4 4V20.5H6z" /><path d="M15 3.5v4h4M9 12h6M9 16h4" /></Ico>,
    link: (p: any) => <Ico {...p}><path d="M9 12h6M10 8.5H8a3.5 3.5 0 0 0 0 7h2M14 8.5h2a3.5 3.5 0 0 1 0 7h-2" /></Ico>,
};

// 和纸胶带：旋转的斜纹墨块，用来"贴"卡片角
const Washi: React.FC<{ className?: string }> = ({ className = '' }) => (
    <span className={`pointer-events-none absolute ${className}`}>
        <span className="block w-14 h-5 border border-[#1c1a17]/50"
            style={{ background: 'repeating-linear-gradient(45deg, rgba(28,26,23,0.22) 0 4px, transparent 4px 8px)' }} />
    </span>
);

// 圆形墨章
const Stamp: React.FC<{ text: string; className?: string }> = ({ text, className = '' }) => (
    <span className={`inline-flex items-center justify-center rounded-full border-2 border-[#1c1a17] text-[#1c1a17] font-label text-[8px] tracking-[0.15em] uppercase w-11 h-11 text-center leading-none -rotate-12 ${className}`}>
        {text}
    </span>
);

// 手账风弹窗（不复用全局 Modal，自带牛皮纸卡片 + 胶带标题）
const PaperModal: React.FC<{ isOpen: boolean; title: string; tag?: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }>
    = ({ isOpen, title, tag, onClose, children, footer }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-[400] flex items-center justify-center p-6 animate-fade-in">
            <div className="absolute inset-0 bg-[#1c1a17]/40" onClick={onClose} />
            <div className="relative w-full max-w-sm animate-slide-up" style={{ filter: 'drop-shadow(5px 6px 0 rgba(28,26,23,0.9))' }}>
                <div className="relative border-2 border-[#1c1a17] -rotate-[0.6deg]" style={PAPER_GRID}>
                    {/* 胶带封口 */}
                    <Washi className="-top-3 left-1/2 -translate-x-1/2 rotate-[2deg]" />
                    <div className="px-6 pt-6 pb-2 border-b-2 border-dashed border-[#1c1a17]/40">
                        {tag && <p className="font-label text-[9px] tracking-[0.3em] uppercase text-[#9b958a] mb-1">{tag}</p>}
                        <div className="flex items-center justify-between gap-3">
                            <h3 className="text-2xl font-bold text-[#1c1a17] font-['Long_Cang'] leading-none">{title}</h3>
                            <button onClick={onClose} className="text-[#1c1a17] active:scale-90 transition-transform shrink-0"><I.close size={20} /></button>
                        </div>
                    </div>
                    <div className="px-6 py-4 max-h-[58vh] overflow-y-auto no-scrollbar text-[#2b2823]">
                        {children}
                    </div>
                    {footer && <div className="px-6 pb-6 pt-1 flex gap-3">{footer}</div>}
                </div>
            </div>
        </div>
    );
};

const RoomApp: React.FC = () => {
    const { closeApp, characters, activeCharacterId, setActiveCharacterId, updateCharacter, apiConfig, auxApiConfig, addToast, userProfile } = useOS();
    // 小屋（街角·房间）属「聊天以外」的功能：走副 API（未配置副 API 时回退主 API）
    const auxApi = { ...apiConfig, ...resolveAuxApi(auxApiConfig, apiConfig) };
    
    // Core State
    const [viewState, setViewState] = useState<'select' | 'room' | 'pixelHome'>('select');
    const [homeTab, setHomeTab] = useState<'room' | 'pixelHome'>('room');
    const [mode, setMode] = useState<'view' | 'edit'>('view');
    const [items, setItems] = useState<RoomItem[]>([]);
    
    // Extended State
    const [todaysTodo, setTodaysTodo] = useState<RoomTodo | null>(null);
    const [newTodoText, setNewTodoText] = useState('');  // 今日清单·自主添条输入
    const [notebookEntries, setNotebookEntries] = useState<RoomNote[]>([]);
    const [showSidebar, setShowSidebar] = useState(false);
    const [activePanel, setActivePanel] = useState<'todo' | 'notebook' | 'schedule'>('todo');
    const [roomSchedule, setRoomSchedule] = useState<DailySchedule | null>(null);
    const [notebookPage, setNotebookPage] = useState(0);

    // UI State
    const [isInitializing, setIsInitializing] = useState(false);
    const [initStatusText, setInitStatusText] = useState('正在翻开居所手账…');
    const [showLibrary, setShowLibrary] = useState(false);
    const [showRefreshConfirm, setShowRefreshConfirm] = useState(false);
    const [showDevModal, setShowDevModal] = useState(false); // Developer Mode
    const [showSettingsModal, setShowSettingsModal] = useState(false); // New: Room Settings
    const [lastPrompt, setLastPrompt] = useState<string>(''); // Debug: Store last sent prompt
    
    // Actor & Room State
    const [actorState, setActorState] = useState({ x: 50, y: 75, action: 'idle' });
    const [aiBubble, setAiBubble] = useState<{text: string, visible: boolean}>({ text: '', visible: false });
    const [observationText, setObservationText] = useState('');
    const [roomDescriptions, setRoomDescriptions] = useState<Record<string, ItemInteraction>>({});
    
    // Edit Mode State
    const [draggingId, setDraggingId] = useState<string | null>(null);
    // Use Ref to store drag offset context
    const dragStartRef = useRef<{ startX: number, startY: number, initialItemX: number, initialItemY: number, width: number, height: number } | null>(null);
    const draggingIdRef = useRef<string | null>(null); // Non-reactive drag ID for perf
    const dragElementRef = useRef<HTMLElement | null>(null); // Direct DOM ref for dragged element
    const rafRef = useRef<number | null>(null); // requestAnimationFrame handle
    const pendingDragPos = useRef<{ x: number, y: number } | null>(null); // Pending drag position
    const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null); // Debounce DB writes
    const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
    const [isToolbarCollapsed, setIsToolbarCollapsed] = useState(false);
    const roomRef = useRef<HTMLDivElement>(null);
    
    // File Inputs
    const wallInputRef = useRef<HTMLInputElement>(null);
    const floorInputRef = useRef<HTMLInputElement>(null);
    const actorInputRef = useRef<HTMLInputElement>(null); 
    const customItemInputRef = useRef<HTMLInputElement>(null);

    const char = characters.find(c => c.id === activeCharacterId);

    // Custom Item Library State (new: unified with visibility)
    type CustomAsset = { id: string; name: string; image: string; defaultScale: number; description?: string; visibility: 'public' | 'character'; assignedCharIds?: string[] };
    const [allCustomAssets, setAllCustomAssets] = useState<CustomAsset[]>([]);
    const customAssets = useMemo(() => {
        if (!char) return allCustomAssets.filter(a => a.visibility === 'public');
        return allCustomAssets.filter(a => a.visibility === 'public' || (a.assignedCharIds && a.assignedCharIds.includes(char.id)));
    }, [allCustomAssets, char?.id]);
    const [showCustomModal, setShowCustomModal] = useState(false);
    const [customItemName, setCustomItemName] = useState('');
    const [customItemImage, setCustomItemImage] = useState('');
    const [customItemUrl, setCustomItemUrl] = useState('');
    const [customItemDescription, setCustomItemDescription] = useState('');

    // Asset Edit Modal State
    const [editingAsset, setEditingAsset] = useState<CustomAsset | null>(null);
    const [editName, setEditName] = useState('');
    const [editDescription, setEditDescription] = useState('');
    const [editImage, setEditImage] = useState('');
    const [editVisibility, setEditVisibility] = useState<'public' | 'character'>('public');
    const [editAssignedCharIds, setEditAssignedCharIds] = useState<string[]>([]);
    const assetLongPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // PERF: Cleanup rAF and debounce timers on unmount
    useEffect(() => {
        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
        };
    }, []);

    // Load custom assets from global DB (with migration from old format)
    useEffect(() => {
        const loadAssets = async () => {
            const dbData = await DB.getAsset('room_custom_assets_list');
            const lsData = localStorage.getItem('room_custom_assets');
            let assets: any[] = [];
            if (dbData) {
                try { assets = JSON.parse(dbData); } catch {}
            } else if (lsData) {
                try { assets = JSON.parse(lsData); localStorage.removeItem('room_custom_assets'); } catch {}
            }
            // 迁移旧格式：没有 id/visibility 的旧资产标记为公共
            let needsSave = false;
            const migrated = assets.map((a: any) => {
                if (!a.id || !a.visibility) {
                    needsSave = true;
                    return { ...a, id: a.id || `asset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, visibility: a.visibility || 'public' };
                }
                return a;
            });
            if (needsSave && migrated.length > 0) {
                await DB.saveAsset('room_custom_assets_list', JSON.stringify(migrated));
            }
            setAllCustomAssets(migrated);
        };
        loadAssets();
    }, []);

    // Helper: Get Virtual "Day" (Reset at 6 AM)
    const getVirtualDay = (): string => {
        const now = new Date();
        if (now.getHours() < 6) {
            now.setDate(now.getDate() - 1);
        }
        return now.toISOString().split('T')[0]; // YYYY-MM-DD
    };

    // Calculate Time Gap - Duplicated logic from other apps for self-containment
    const getTimeGapHint = (lastMsgTimestamp: number | undefined): string => {
        if (!lastMsgTimestamp) return '这是初次见面。';
        const now = Date.now();
        const diffMs = now - lastMsgTimestamp;
        const diffMins = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffHours / 24);

        if (diffMins < 5) return '你们刚刚还在聊天。';
        if (diffMins < 60) return `距离上次互动只有 ${diffMins} 分钟。`;
        if (diffHours < 24) return `距离上次互动已经过了 ${diffHours} 小时。`;
        return `距离上次互动已经过了 ${diffDays} 天。`;
    };

    // --- 1. Selection & Initialization ---

    const handleEnterRoom = async (c: CharacterProfile) => {
        setActiveCharacterId(c.id);
        setViewState('room');
        
        // Load Items: Priority -> Character Config > Generic Defaults
        let loadedItems = c.roomConfig?.items;

        if (!loadedItems || loadedItems.length === 0) {
            loadedItems = DEFAULT_FURNITURE;
        }
        
        setItems(loadedItems || []);
        
        const today = getVirtualDay();
        const hasCache = c.lastRoomDate === today && c.savedRoomState;

        if (hasCache && c.savedRoomState) {
            setRoomDescriptions(c.savedRoomState.items || {});
            setAiBubble({ text: c.savedRoomState.welcomeMessage || "...", visible: true });
            
            const existingTodo = await DB.getRoomTodo(c.id, today);
            const existingNotes = await DB.getRoomNotes(c.id);
            const existingSchedule = await DB.getDailySchedule(c.id, today);
            setTodaysTodo(existingTodo);
            setNotebookEntries(existingNotes.sort((a, b) => b.timestamp - a.timestamp));
            setRoomSchedule(existingSchedule);

            addToast('今天这一页，原样贴回来了', 'info');
        } else {
            initializeRoomState(c, loadedItems || []);
        }
    };

    const handleForceRefresh = () => {
        setShowRefreshConfirm(false);
        if (char) {
            initializeRoomState(char, items, true);
        }
    };

    // Fallback Initialization: Used when main generation fails due to Safety Block
    const initializeFallback = async (c: CharacterProfile) => {
        try {
            console.warn("Triggering Room Fallback Initialization");
            const baseContext = ContextBuilder.buildCoreContext(c, userProfile, false);
            const fallbackPrompt = `${baseContext}\n\nTask: User entered your room. Just say hello. JSON: { "welcomeMessage": "..." }`;
            
            const response = await fetch(`${auxApi.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auxApi.apiKey}` },
                body: JSON.stringify({ 
                    model: auxApi.model, 
                    messages: [{ role: "user", content: fallbackPrompt }], 
                    temperature: 0.5,
                    max_tokens: 8000 // Keep it tiny
                })
            });

            if (response.ok) {
                const data = await safeResponseJson(response);
                let content = data.choices?.[0]?.message?.content || '{"welcomeMessage": "..."}';
                content = content.replace(/```json/g, '').replace(/```/g, '').trim();
                
                try {
                    const res = JSON.parse(content);
                    const todayStr = getVirtualDay();
                    
                    setAiBubble({ text: res.welcomeMessage || "...", visible: true });
                    // Use generic descriptions for items in fallback mode
                    const fallbackItems: Record<string, any> = {};
                    items.forEach(i => { fallbackItems[i.id] = { description: `This is a ${i.name}.`, reaction: "..." }; });
                    setRoomDescriptions(fallbackItems);

                    updateCharacter(c.id, {
                        lastRoomDate: todayStr,
                        savedRoomState: {
                            actorStatus: "Idling...",
                            welcomeMessage: res.welcomeMessage || "...",
                            items: fallbackItems,
                            actorAction: 'idle'
                        }
                    });
                    addToast("信号不太好，先用便签顶上", "info");
                } catch (e) {
                    throw new Error("Fallback Parse Error");
                }
            }
        } catch (e) {
            console.error("Fallback Failed", e);
            setAiBubble({ text: "(...)", visible: true });
        } finally {
            setIsInitializing(false);
        }
    };

    const initializeRoomState = async (c: CharacterProfile, currentItems: RoomItem[], force: boolean = false) => {
        if (!auxApi.apiKey) return;

        setIsInitializing(true);
        const loadingTexts = [`正在替 ${c.name} 拂去桌上的灰…`, "正在把今天的心事贴进本子…", "正在裁剪一页新的居所…", "正在为每件物什写下注脚…"];
        let textIdx = 0;
        const textInterval = setInterval(() => {
            setInitStatusText(loadingTexts[textIdx % loadingTexts.length]);
            textIdx++;
        }, 1200);

        try {
            const todayStr = getVirtualDay();
            const now = new Date();
            const nowTimeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const nowDateStr = now.toLocaleDateString();
            
            let existingTodo = await DB.getRoomTodo(c.id, todayStr);
            const existingNotes = await DB.getRoomNotes(c.id);
            const existingSchedule = await DB.getDailySchedule(c.id, todayStr);
            setNotebookEntries(existingNotes.sort((a, b) => b.timestamp - a.timestamp));
            setRoomSchedule(existingSchedule);
            
            const shouldGenerateTodo = !existingTodo;
            if (existingTodo) {
                setTodaysTodo(existingTodo);
            }

            const recentMsgs = await DB.getMessagesByCharId(c.id);
            // Increased context from 20 to 50
            const chatContext = recentMsgs.slice(-50).map(m => {
                const role = m.role === 'user' ? '用户' : c.name;
                return `${role}: ${m.content.substring(0, 50)}`; 
            }).join('\n');

            // Time Gap Calculation
            const lastMsg = recentMsgs[recentMsgs.length - 1];
            const timeGapHint = getTimeGapHint(lastMsg?.timestamp);

            await injectMemoryPalace(c, recentMsgs);
            const baseContext = ContextBuilder.buildCoreContext(c, userProfile, true); // Keep Full Context
            
            // DEBUG FIX: Sanitize and truncate interactables context to prevent huge Base64 leakage
            const interactables = currentItems.filter(i => i.isInteractive).map(i => ({ 
                id: i.id, 
                name: i.name, 
                context: (i.descriptionPrompt || '').substring(0, 200) 
            }));

            let prompt = `${baseContext}

### [Environment Context - Critical]
**当前现实时间**: ${nowDateStr} ${nowTimeStr}
**与用户上次互动距离现在**: ${timeGapHint}
**最近互动记录 (Latest 50)**:
${chatContext}

### [Room Initialization - Batch Generation]
用户进入了**你的**房间。请一次性生成房间的状态、物品交互文本，以及（如果需要）你今天的计划和随笔。

### 1. 房间状态 (Status)
- **ActorStatus**: 你现在在房间里做什么？(请严格基于当前时间${nowTimeStr}和时间差${timeGapHint}来推断。如果是深夜可能在睡觉，如果很久没见可能在发呆。)
- **Welcome**: 看到用户进来，你第一句话说什么？(请结合时间差：如果很久没见，是惊讶、想念还是生气？)

### 2. 物品交互 (Items)
房间里有以下物品：
${JSON.stringify(interactables)}

请为**每一个**物品生成：
- **Description**: 旁白视角的物品外观/状态描写。
- **Reaction**: 当用户查看这个物品时，你(角色)的吐槽或反应。

### 3. [OPTIONAL] 今日待办清单 (Daily To-Do)
${!shouldGenerateTodo ? `(系统: 今日待办已存在，无需生成，请忽略此项)` : `(系统: 请生成 3-5 条你今天打算做的事。)`}

### 4. 记事簿随笔 (Notebook Entry)
请在你的私密记事簿上写点什么。
**要求**：
1. **风格多变**：可以是刚写的歌词、随笔感悟、心情记录、或者是一首短诗、一份购物清单。
2. **严禁代码**：**严禁**生成代码块(Code Blocks)或伪代码，除非你的核心设定明确是程序员。请像正常人写日记一样自然。
3. **格式丰富**：请积极使用 **Markdown** 格式让排版更有趣。
4. **内容新颖**：必须是新的内容，展示你作为独立个体的思考。

### 输出格式 (Strict JSON)
{
  "actorStatus": "...",
  "welcomeMessage": "...",
  "items": {
    "item_id": { "description": "...", "reaction": "..." }
  },
  ${shouldGenerateTodo ? `"todoList": ["task 1", "task 2"],` : ''}
  "notebookEntry": { "content": "markdown string...", "type": "thought" }
}
`;
            // DEBUG: Save prompt for inspection
            setLastPrompt(prompt);
            // CONSOLE LOG REMOVED FOR PRODUCTION CLEANUP

            // FIX: Add Safety Settings & Lower Temperature
            const response = await fetch(`${auxApi.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${auxApi.apiKey}` },
                body: JSON.stringify({ 
                    model: auxApi.model, 
                    messages: [{ role: "user", content: prompt }], 
                    temperature: 0.5, // Lower temp for stability
                    max_tokens: 8000,
                    // Safety Settings injection for Gemini-based proxies
                    safetySettings: [
                        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
                    ]
                })
            });

            if (response.ok) {
                const data = await safeResponseJson(response);
                let content = data.choices?.[0]?.message?.content || "";
                
                // CRITICAL FIX: Empty content check triggers fallback
                if (!content) {
                    throw new Error("AI returned empty response (Safety Block suspected).");
                }

                content = content.replace(/```json/g, '').replace(/```/g, '').trim();
                const firstBrace = content.indexOf('{');
                const lastBrace = content.lastIndexOf('}');
                if (firstBrace !== -1 && lastBrace !== -1) content = content.substring(firstBrace, lastBrace + 1);
                
                let result;
                try { result = JSON.parse(content); } catch (e) { throw new Error("JSON Parse Failed"); }
                
                setAiBubble({ text: result.welcomeMessage || "Welcome!", visible: true });
                if (result.items) setRoomDescriptions(result.items);

                updateCharacter(c.id, {
                    lastRoomDate: todayStr,
                    savedRoomState: {
                        actorStatus: result.actorStatus,
                        welcomeMessage: result.welcomeMessage,
                        items: result.items || {},
                        actorAction: 'idle'
                    }
                });

                // 2. Handle To-Do (Only if we requested it)
                if (shouldGenerateTodo && result.todoList && Array.isArray(result.todoList)) {
                    const newTodo: RoomTodo = {
                        id: `${c.id}_${todayStr}`,
                        charId: c.id,
                        date: todayStr,
                        items: result.todoList.map((t: string) => ({ text: t, done: false })),
                        generatedAt: Date.now()
                    };
                    await DB.saveRoomTodo(newTodo);
                    setTodaysTodo(newTodo);
                    
                    await DB.saveMessage({
                        charId: c.id,
                        role: 'system',
                        type: 'text',
                        content: `[系统: ${c.name} 制定了今日计划: ${result.todoList.join(', ')}]`
                    });
                }

                // 3. Handle Notebook
                if (result.notebookEntry) {
                    // Create message first to get ID
                    const msgContent = `[系统: ${c.name} 在记事本上写道: \n"${result.notebookEntry.content}"]`;
                    
                    const msgId = await DB.saveMessage({
                        charId: c.id,
                        role: 'system',
                        type: 'text',
                        content: msgContent
                    });

                    const newNote: RoomNote = {
                        id: `note-${Date.now()}`,
                        charId: c.id,
                        timestamp: Date.now(),
                        content: result.notebookEntry.content,
                        type: result.notebookEntry.type || 'thought',
                        relatedMessageId: msgId
                    };
                    await DB.saveRoomNote(newNote);
                    setNotebookEntries(prev => [newNote, ...prev]);
                }

            } else { throw new Error(`API Error ${response.status}`); }

        } catch (e: any) { 
            console.error("Room Init Failed, switching to Fallback", e); 
            // Trigger Fallback
            await initializeFallback(c);
        } finally { 
            clearInterval(textInterval); 
            setIsInitializing(false); 
        }
    };

    const handleLookAt = async (item: RoomItem, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        if (mode === 'edit') { setSelectedItemId(item.id); return; }
        if (!char) return;
        
        // Character Movement Constraint: Keep feet below horizon line
        // FIX: Place actor visually "In Front" of furniture (lower Y = closer to camera in 2.5D top-down)
        const targetY = Math.max(FLOOR_HORIZON, item.y + 5); 
        
        setActorState({ x: item.x, y: targetY, action: 'walk' });
        setTimeout(() => setActorState(prev => ({ ...prev, action: 'interact' })), 600);
        
        const cached = roomDescriptions[item.id] || roomDescriptions[item.name];
        if (cached) {
            setObservationText(cached.description);
            setAiBubble({ text: cached.reaction, visible: true });
            
            const contentToCheck = `[${userProfile.name}]在[${char.name}]的${item.name}上看到了：${cached.description}。[${char.name}]表示：${cached.reaction}`;
            const recentMsgs = await DB.getMessagesByCharId(char.id);
            const isDuplicate = recentMsgs.slice(-50).some(m => m.role === 'system' && m.content === contentToCheck);

            if (!isDuplicate) {
                try { 
                    await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: contentToCheck }); 
                } catch (err) {}
            }
        } else {
            setObservationText(`${item.name} 安安静静地待在原处。`);
            setAiBubble({ text: "（瞅——）", visible: true });
        }
    };

    const handlePokeActor = () => {
        if (mode === 'edit') { actorInputRef.current?.click(); return; }
        setActorState(prev => ({ ...prev, action: 'bounce' }));
        setTimeout(() => setActorState(prev => ({ ...prev, action: 'idle' })), 500);
        const thoughts = ["唔…？", "别戳啦——", "我在的我在的。", "盯着我看作甚？", "（出神中）"];
        setAiBubble({ text: thoughts[Math.floor(Math.random() * thoughts.length)], visible: true });
    };

    const handleToggleTodo = async (index: number) => {
        if (!todaysTodo) return;
        const newItems = [...todaysTodo.items];
        const nowDone = !newItems[index].done;
        newItems[index] = { ...newItems[index], done: nowDone };
        const newTodo = { ...todaysTodo, items: newItems };
        setTodaysTodo(newTodo);
        await DB.saveRoomTodo(newTodo);
        // 自动同步角色：用户帮 TA 把某条划掉时，往聊天落一条系统消息，让角色知道
        if (nowDone && char) {
            const uname = userProfile?.name || '用户';
            try {
                await DB.saveMessage({
                    charId: char.id, role: 'system', type: 'text',
                    content: `[系统: ${uname} 帮 ${char.name} 把今日清单里的「${newItems[index].text}」划掉了]`,
                });
            } catch { /* 同步失败不影响勾选 */ }
        }
    };

    // 自主勾画：用户给今日清单自己添一条，并同步给角色
    const handleAddTodo = async () => {
        const text = newTodoText.trim();
        if (!text || !char) return;
        const today = todaysTodo?.date || new Date().toISOString().split('T')[0];
        const base: RoomTodo = todaysTodo || { id: `${char.id}_${today}`, charId: char.id, date: today, items: [], generatedAt: Date.now() };
        const newTodo: RoomTodo = { ...base, items: [...base.items, { text, done: false, byUser: true }] };
        setTodaysTodo(newTodo);
        setNewTodoText('');
        await DB.saveRoomTodo(newTodo);
        const uname = userProfile?.name || '用户';
        try {
            await DB.saveMessage({
                charId: char.id, role: 'system', type: 'text',
                content: `[系统: ${uname} 给 ${char.name} 的今日清单添了一条：「${text}」，希望 TA 今天能做到]`,
            });
        } catch { /* 同步失败不影响添加 */ }
        addToast('加好了，已同步给 TA', 'success');
    };

    // --- Deletion Handlers (Point 5) ---
    const handleDeleteTodo = async (index: number) => {
        if (!todaysTodo) return;
        const newItems = todaysTodo.items.filter((_, i) => i !== index);
        const newTodo = { ...todaysTodo, items: newItems };
        setTodaysTodo(newTodo);
        await DB.saveRoomTodo(newTodo);
        addToast('这一条，撕掉了', 'success');
    };

    const handleDeleteNote = async (id: string) => {
        const note = notebookEntries.find(n => n.id === id);
        if (note && note.relatedMessageId) {
            await DB.deleteMessage(note.relatedMessageId);
        }
        await DB.deleteRoomNote(id);
        setNotebookEntries(prev => prev.filter(n => n.id !== id));
        addToast('这一页连同存根，一起碎掉了', 'success');
    };

    const handleStageClick = (e: React.MouseEvent) => {
        if (mode === 'edit') {
            setSelectedItemId(null);
            return;
        }
        // View mode: Move actor
        if (!roomRef.current) return;
        const rect = roomRef.current.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;
        
        // Constrain to floor: allow climbing a bit, but mostly keep below horizon
        const targetY = Math.max(FLOOR_HORIZON - 5, y);
        
        setActorState({
            x,
            y: targetY,
            action: 'walk'
        });
        setTimeout(() => setActorState(prev => ({ ...prev, action: 'idle' })), 600);
        
        // Clear bubbles
        setAiBubble({ text: '', visible: false });
        setObservationText('');
    };

    // --- Edit Logic ---
    const saveRoom = (newItems: RoomItem[]) => { setItems(newItems); if (char) { updateCharacter(char.id, { roomConfig: { ...char.roomConfig, items: newItems } }); } };
    
    // Updated addItem to accept description
    const addItem = (asset: {name: string, image: string, defaultScale: number, description?: string}, type: 'furniture' | 'decor') => { 
        const newItem: RoomItem = { 
            id: `item-${Date.now()}`, 
            name: asset.name, 
            type: type, 
            image: asset.image, 
            x: 50, 
            y: 50, 
            scale: asset.defaultScale, 
            rotation: 0, 
            isInteractive: true,
            descriptionPrompt: asset.description // New Field
        }; 
        saveRoom([...items, newItem]); 
        setShowLibrary(false); 
        addToast(`「${asset.name}」已贴进房间`, 'success');
    };

    // PERF: Update items in state immediately (visual), but debounce DB persistence
    const updateSelectedItem = (updates: Partial<RoomItem>) => {
        if (!selectedItemId) return;
        const newItems = items.map(i => i.id === selectedItemId ? { ...i, ...updates } : i);
        setItems(newItems); // Instant visual update
        // Debounce the DB write (300ms) - prevents IndexedDB thrashing from sliders
        if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
        saveDebounceRef.current = setTimeout(() => {
            if (char) {
                updateCharacter(char.id, { roomConfig: { ...char.roomConfig, items: newItems } });
            }
        }, 300);
    };
    const deleteSelectedItem = () => { if (!selectedItemId) return; saveRoom(items.filter(i => i.id !== selectedItemId)); setSelectedItemId(null); };
    const handleWallChange = (bg: string) => { if (char) updateCharacter(char.id, { roomConfig: { ...char.roomConfig, items, wallImage: bg } }); };
    const handleFloorChange = (bg: string) => { if (char) updateCharacter(char.id, { roomConfig: { ...char.roomConfig, items, floorImage: bg } }); };
    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, target: 'wall' | 'floor' | 'actor' | 'custom_item') => { 
        const file = e.target.files?.[0]; 
        if (file) { 
            try { 
                // Force high quality for custom item uploads
                const processOptions = target === 'custom_item' ? { quality: 1.0, maxWidth: 2048 } : undefined;
                const base64 = await processImage(file, processOptions); 
                
                if (target === 'wall') handleWallChange(base64); 
                if (target === 'floor') handleFloorChange(base64); 
                if (target === 'actor') { 
                    if (char) { 
                        const newSprites = { ...(char.sprites || {}), 'chibi': base64 }; 
                        updateCharacter(char.id, { sprites: newSprites }); 
                        addToast('居所里的身影换了新装', 'success');
                    } 
                } 
                if (target === 'custom_item') { 
                    setCustomItemImage(base64); 
                } 
            } catch (err: any) { 
                addToast(err.message, 'error'); 
            } 
        } 
    };
    
    // Custom Item Save
    // Helper: persist allCustomAssets to DB
    const persistAssets = async (assets: CustomAsset[]) => {
        setAllCustomAssets(assets);
        await DB.saveAsset('room_custom_assets_list', JSON.stringify(assets));
    };

    const saveCustomItem = async () => {
        const imageToUse = customItemUrl || customItemImage;
        if(!customItemName.trim() || !imageToUse) { addToast('还有空格没填满呢', 'error'); return; }

        addItem({
            name: customItemName,
            image: imageToUse,
            defaultScale: 1.0,
            description: customItemDescription || undefined
        }, 'furniture');

        const newAsset: CustomAsset = {
            id: `asset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: customItemName,
            image: imageToUse,
            defaultScale: 1.0,
            description: customItemDescription || undefined,
            visibility: 'public',
        };
        await persistAssets([...allCustomAssets, newAsset]);

        setShowCustomModal(false);
        setCustomItemName('');
        setCustomItemImage('');
        setCustomItemUrl('');
        setCustomItemDescription('');
    };

    // Long-press on custom asset → open edit modal
    const handleAssetTouchStart = (asset: CustomAsset) => {
        assetLongPressTimer.current = setTimeout(() => {
            setEditingAsset(asset);
            setEditName(asset.name);
            setEditDescription(asset.description || '');
            setEditImage(asset.image);
            setEditVisibility(asset.visibility);
            setEditAssignedCharIds(asset.assignedCharIds || []);
        }, 600);
    };

    const handleAssetTouchEnd = () => {
        if (assetLongPressTimer.current) {
            clearTimeout(assetLongPressTimer.current);
            assetLongPressTimer.current = null;
        }
    };

    const saveEditingAsset = async () => {
        if (!editingAsset) return;
        const updated = allCustomAssets.map(a => a.id === editingAsset.id ? {
            ...a,
            name: editName.trim() || a.name,
            description: editDescription || undefined,
            image: editImage || a.image,
            visibility: editVisibility,
            assignedCharIds: editVisibility === 'character' ? editAssignedCharIds : undefined,
        } : a);
        await persistAssets(updated);
        setEditingAsset(null);
        addToast('素材改好了', 'success');
    };

    const deleteEditingAsset = async () => {
        if (!editingAsset) return;
        const filtered = allCustomAssets.filter(a => a.id !== editingAsset.id);
        await persistAssets(filtered);
        setEditingAsset(null);
        addToast('素材撕掉了', 'success');
    };

    // New: Handle Background Config Update
    const updateBgConfig = (updates: Partial<CharacterProfile['roomConfig']>) => {
        if (!char) return;
        updateCharacter(char.id, {
            roomConfig: { ...char.roomConfig, ...updates, items } // Ensure items are preserved
        });
    };

    // --- PERF FIX: Direct DOM Dragging (bypasses React re-renders) ---
    // During drag: manipulate DOM directly via element.style
    // On drop: sync final position to React state once
    const handlePointerDown = (e: React.PointerEvent, id: string) => {
        if (mode !== 'edit') return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);

        const item = items.find(i => i.id === id);
        if (!item || !roomRef.current) return;

        const rect = roomRef.current.getBoundingClientRect();

        dragStartRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            initialItemX: item.x,
            initialItemY: item.y,
            width: rect.width,
            height: rect.height
        };

        // Store refs for direct DOM access (no React re-renders during drag)
        draggingIdRef.current = id;
        dragElementRef.current = e.currentTarget as HTMLElement;
        if (dragElementRef.current) {
            dragElementRef.current.style.transition = 'none';
            dragElementRef.current.style.zIndex = '100';
            dragElementRef.current.style.willChange = 'left, top';
        }

        setDraggingId(id);
        setSelectedItemId(id);
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        // Fast-path: skip entirely if not dragging (avoids any work on passive touch)
        if (!draggingIdRef.current || !dragStartRef.current) return;

        e.preventDefault();

        const { startX, startY, initialItemX, initialItemY, width, height } = dragStartRef.current;
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;

        const nextX = Math.max(0, Math.min(100, initialItemX + (deltaX / width) * 100));
        const nextY = Math.max(0, Math.min(100, initialItemY + (deltaY / height) * 100));

        // Store pending position
        pendingDragPos.current = { x: nextX, y: nextY };

        // Throttle DOM updates via requestAnimationFrame (once per frame, ~16ms)
        if (!rafRef.current) {
            rafRef.current = requestAnimationFrame(() => {
                if (dragElementRef.current && pendingDragPos.current) {
                    // Direct DOM manipulation - NO React re-render
                    dragElementRef.current.style.left = `${pendingDragPos.current.x}%`;
                    dragElementRef.current.style.top = `${pendingDragPos.current.y}%`;
                }
                rafRef.current = null;
            });
        }
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        if (!draggingIdRef.current) return;

        // Cancel any pending rAF
        if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }

        // Restore element styles
        if (dragElementRef.current) {
            dragElementRef.current.style.willChange = '';
            dragElementRef.current.style.transition = '';
            dragElementRef.current.style.zIndex = '';
        }

        // Sync final position to React state (only if moved)
        if (pendingDragPos.current) {
            const finalPos = pendingDragPos.current;
            const dragId = draggingIdRef.current;

            const newItems = items.map(item => item.id === dragId ? {
                ...item,
                x: finalPos.x,
                y: finalPos.y
            } : item);

            setItems(newItems);
            if (char) {
                updateCharacter(char.id, { roomConfig: { ...char.roomConfig, items: newItems } });
            }
        }

        // Cleanup all refs
        draggingIdRef.current = null;
        dragElementRef.current = null;
        pendingDragPos.current = null;
        dragStartRef.current = null;
        setDraggingId(null);
        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch(_) {}
    };

    // --- Renderers ---

    // PIXEL HOME SCREEN
    if (viewState === 'pixelHome' && char) {
        return (
            <PixelHomeView
                charId={char.id}
                charName={char.name}
                charAvatar={char.avatar}
                userName={userProfile?.name || '用户'}
                onBack={() => setViewState('select')}
            />
        );
    }

    // SELECT SCREEN —— 翻开目录页，挑一户人家
    if (viewState === 'select') {
        return (
            <div className="h-full w-full flex flex-col text-[#1c1a17]" style={PAPER_GRID}>
                <div className="pt-12 pb-4 px-5 shrink-0 border-b-2 border-[#1c1a17] bg-[#f4f1e8]/90 backdrop-blur-sm sticky top-0 z-20">
                    <div className="flex items-center justify-between h-10">
                        <button onClick={closeApp} className="flex items-center gap-1 active:scale-90 transition-transform">
                            <I.back size={20} /><span className="font-label text-[10px] tracking-[0.2em] uppercase">close</span>
                        </button>
                        <span className="font-label text-[9px] tracking-[0.3em] uppercase text-[#9b958a]">栖 · 居 · 志</span>
                    </div>
                    <div className="flex items-end justify-between mt-1">
                        <h1 className="text-4xl font-bold font-['Long_Cang'] leading-none">
                            {homeTab === 'room' ? '今天翻开谁的居所' : '今天逛谁的像素家园'}
                        </h1>
                    </div>
                    {/* Tab 切换 —— 两枚书签标签 */}
                    <div className="flex gap-3 mt-4">
                        {([
                            { key: 'room', label: '纸上居所', icon: I.house },
                            { key: 'pixelHome', label: '像素家园', icon: I.pad },
                        ] as const).map(t => {
                            const on = homeTab === t.key;
                            return (
                                <button key={t.key} onClick={() => setHomeTab(t.key)}
                                    className={`flex items-center gap-1.5 px-4 py-1.5 border-2 border-[#1c1a17] font-bold text-xs transition-all ${on ? 'bg-[#1c1a17] text-[#f4f1e8] shadow-[3px_3px_0_rgba(28,26,23,0.35)]' : 'bg-[#fbf9f3] text-[#1c1a17]'}`}>
                                    <t.icon size={16} />{t.label}
                                </button>
                            );
                        })}
                    </div>
                </div>
                <div className="p-5 grid grid-cols-2 gap-5 overflow-y-auto pb-24 no-scrollbar">
                    {characters.map((c, idx) => (
                        <div key={c.id} onClick={() => {
                            if (homeTab === 'pixelHome') { setActiveCharacterId(c.id); setViewState('pixelHome'); }
                            else { handleEnterRoom(c); }
                        }}
                            className="relative min-h-[170px] bg-[#fbf9f3] border-2 border-[#1c1a17] p-4 pt-6 flex flex-col items-center justify-center gap-3 cursor-pointer active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all shadow-[4px_4px_0_#1c1a17]"
                            style={{ transform: `rotate(${idx % 2 ? 1 : -1}deg)` }}>
                            {/* 角上的胶带 */}
                            <Washi className={`-top-2.5 ${idx % 2 ? 'right-4 rotate-6' : 'left-4 -rotate-6'}`} />
                            <div className="relative w-20 h-20">
                                <div className="w-full h-full border-2 border-[#1c1a17] overflow-hidden contrast-110 bg-[#ece8dd]">
                                    <img src={c.avatar} className="w-full h-full object-cover" />
                                </div>
                                <span className="absolute -bottom-2 -right-2 w-7 h-7 bg-[#1c1a17] text-[#f4f1e8] border-2 border-[#f4f1e8] flex items-center justify-center">
                                    {homeTab === 'pixelHome' ? <I.pad size={14} /> : <I.house size={14} />}
                                </span>
                            </div>
                            <span className="font-bold text-sm tracking-wide">{c.name}</span>
                            <span className="font-label text-[8px] tracking-[0.2em] uppercase text-[#9b958a]">No.{String(idx + 1).padStart(2, '0')}</span>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    // ROOM SCREEN
    // Use chibi sprite if available, else avatar. Fallback for Moro is injected via OSContext now.
    const actorImage = char?.sprites?.['chibi'] || char?.avatar;
    // PERF: Reduced from 3 drop-shadows to 1 simple shadow -- massive mobile GPU savings
    const stickerClass = "filter drop-shadow-[0_2px_4px_rgba(0,0,0,0.15)]";
    
    // Background Style Construction (Logic 1: Legacy String vs New Config)
    const getBgStyle = (img: string | undefined, scale: number | undefined, repeat: boolean | undefined) => {
        if (!img) return '';
        const isUrl = img.startsWith('http') || img.startsWith('data');
        const url = isUrl ? `url(${img})` : img; // If it's a CSS gradient, use it directly
        
        // If it's a gradient string (not URL), ignore scale params as they apply to background-size which works on gradients too, but repeat usually doesn't apply the same way.
        // Let's assume adjustments are mostly for Images.
        if (!isUrl) return url;

        // Apply Config
        const size = scale && scale > 0 ? `${scale}%` : 'cover'; // 0 = Cover
        const rep = repeat ? 'repeat' : 'no-repeat';
        const pos = 'center center';
        
        return `${url} ${pos} / ${size} ${rep}`;
    };

    const wallStyle = getBgStyle(char?.roomConfig?.wallImage, char?.roomConfig?.wallScale, char?.roomConfig?.wallRepeat) || WALLPAPER_PRESETS[0].value;
    const floorStyle = getBgStyle(char?.roomConfig?.floorImage, char?.roomConfig?.floorScale, char?.roomConfig?.floorRepeat) || FLOOR_PRESETS[0].value;

    // Merge Asset Libraries for Modal
    const displayLibrary: Record<string, any[]> = {
        ...ASSET_LIBRARY,
        custom: customAssets
    };

    // 贴纸抽屉的分类中文标签
    const CAT_LABELS: Record<string, string> = { furniture: '家具', decor: '摆设', food: '吃的', custom: '我的剪贴' };

    return (
        <div className="h-full w-full flex flex-col relative overflow-hidden font-sans select-none text-[#1c1a17]" style={PAPER_GRID}>

            {isInitializing && (
                <div className="absolute inset-0 z-[500] flex flex-col items-center justify-center animate-fade-in" style={PAPER_GRID}>
                    <div className="border-2 border-[#1c1a17] bg-[#fbf9f3] px-8 py-7 -rotate-2 shadow-[5px_5px_0_#1c1a17] relative">
                        <Washi className="-top-3 left-1/2 -translate-x-1/2 rotate-3" />
                        <div className="mb-3 animate-bounce flex justify-center text-[#1c1a17]"><I.house size={42} /></div>
                        <p className="text-sm font-bold text-[#1c1a17] font-['Long_Cang'] text-xl text-center">{initStatusText}</p>
                    </div>
                </div>
            )}

            {/* 舞台 —— 一张贴满剪报的居所内页 */}
            <div ref={roomRef} className="flex-1 relative overflow-hidden transition-all duration-500 touch-none" onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onClick={handleStageClick}>
                <div className="absolute top-0 left-0 w-full h-[65%] bg-center transition-all duration-500 z-0" style={{ background: wallStyle }}></div>
                <div className="absolute bottom-0 left-0 w-full h-[35%] bg-center transition-all duration-500 z-0" style={{ background: floorStyle }}></div>
                {/* 墙与地之间的折线 */}
                <div className="absolute top-[65%] w-full border-t-2 border-dashed border-[#1c1a17]/40 z-0 pointer-events-none"></div>
                <div className="absolute top-[65%] w-full h-6 bg-gradient-to-b from-[#1c1a17]/15 to-transparent pointer-events-none z-0"></div>
                {items.map(item => {
                    const isDragging = draggingId === item.id;
                    return (
                        <div
                            key={item.id}
                            onPointerDown={(e) => handlePointerDown(e, item.id)}
                            onClick={(e) => handleLookAt(item, e)}
                            className={`absolute origin-bottom-center ${stickerClass} ${mode === 'edit' ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : (item.isInteractive ? 'cursor-pointer active:scale-95' : '')} ${selectedItemId === item.id ? 'ring-2 ring-[#1c1a17] ring-offset-2 ring-offset-[#f4f1e8]' : ''} touch-none select-none`}
                            style={{
                                left: `${item.x}%`,
                                top: `${item.y}%`,
                                width: `${80 * item.scale}px`,
                                transform: `translate(-50%, -100%) rotate(${item.rotation}deg)`,
                                zIndex: isDragging ? 100 : Math.floor(item.y),
                                transition: isDragging ? 'none' : 'transform 0.2s ease-out',
                                willChange: isDragging ? 'left, top' : 'auto' // GPU layer only when needed
                            }}
                        >
                            <img src={item.image} className="w-full h-auto object-contain pointer-events-none select-none contrast-[1.05]" draggable={false} loading="lazy" />
                            {mode === 'edit' && selectedItemId === item.id && <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-[#1c1a17] text-[#f4f1e8] text-[9px] font-label tracking-widest px-2 py-0.5 whitespace-nowrap">选中</div>}
                        </div>
                    );
                })}

                {/* Character Actor - Z Index Boosted to simulate standing in front */}
                <div onClick={(e) => { e.stopPropagation(); handlePokeActor(); }} className={`absolute transition-[left,top] duration-[1000ms] ease-in-out origin-bottom-center ${stickerClass} cursor-pointer active:scale-95 group`} style={{ left: `${actorState.x}%`, top: `${actorState.y}%`, width: '120px', transform: `translate(-50%, -100%) scale(${actorState.action === 'walk' ? 1.05 : (actorState.action === 'bounce' ? 1.1 : 1)})`, zIndex: Math.floor(actorState.y) + 20 }}>
                    <img src={actorImage} className={`w-full h-full object-contain ${actorState.action === 'walk' ? 'animate-bounce' : ''}`} />
                    {mode === 'edit' && <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-[#1c1a17] text-[#f4f1e8] text-[9px] px-2 py-1 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 font-label tracking-widest"><I.cam size={12} /> 点我换装</div>}
                    {aiBubble.visible && (
                        <div className="absolute bottom-[110%] left-1/2 -translate-x-1/2 bg-[#fbf9f3] px-4 py-3 border-2 border-[#1c1a17] shadow-[3px_3px_0_#1c1a17] min-w-[120px] max-w-[300px] animate-pop-in z-50">
                            <p className="text-xs font-bold text-[#2b2823] leading-snug text-center break-words">{aiBubble.text}</p>
                            <span className="absolute -bottom-[7px] left-7 w-3 h-3 bg-[#fbf9f3] border-b-2 border-r-2 border-[#1c1a17] rotate-45"></span>
                            <button onClick={(e) => { e.stopPropagation(); setAiBubble({ ...aiBubble, visible: false }); }} className="absolute -top-2.5 -right-2.5 bg-[#1c1a17] text-[#f4f1e8] w-5 h-5 flex items-center justify-center border-2 border-[#f4f1e8]"><I.close size={11} /></button>
                        </div>
                    )}
                </div>
            </div>

            {/* 侧栏抽出标签 */}
            <button onClick={() => setShowSidebar(true)} className={`absolute right-0 top-1/2 -translate-y-1/2 bg-[#1c1a17] text-[#f4f1e8] py-4 px-2 border-2 border-r-0 border-[#1c1a17] transition-transform duration-300 z-[300] flex flex-col items-center gap-2 ${showSidebar ? 'translate-x-full' : 'translate-x-0'}`}>
                <I.back size={16} />
                <span className="font-label text-[9px] tracking-[0.2em]" style={{ writingMode: 'vertical-rl' }}>碎屑</span>
            </button>
            {showSidebar && <div className="absolute inset-0 z-[290] bg-[#1c1a17]/30" onClick={() => setShowSidebar(false)}></div>}
            <div className={`absolute right-0 top-0 bottom-0 w-3/4 max-w-sm border-l-2 border-[#1c1a17] z-[300] transition-transform duration-300 ease-out flex flex-col ${showSidebar ? 'translate-x-0' : 'translate-x-full'}`} style={PAPER_GRID}>
                <div className="px-5 pt-12 pb-3 border-b-2 border-[#1c1a17] flex justify-between items-end">
                    <div>
                        <p className="font-label text-[9px] tracking-[0.3em] uppercase text-[#9b958a]">scraps of the day</p>
                        <h3 className="text-3xl font-bold font-['Long_Cang'] leading-none">日子碎屑</h3>
                    </div>
                    <button onClick={() => setShowSidebar(false)} className="active:scale-90 transition-transform"><I.close size={22} /></button>
                </div>
                <div className="flex gap-2 px-4 py-3 border-b-2 border-dashed border-[#1c1a17]/40">
                    {([
                        { key: 'todo', label: '今日清单', icon: I.list },
                        { key: 'schedule', label: '作息', icon: I.cal },
                        { key: 'notebook', label: '私房随笔', icon: I.note },
                    ] as const).map(t => {
                        const on = activePanel === t.key;
                        return (
                            <button key={t.key} onClick={() => setActivePanel(t.key)}
                                className={`flex-1 py-2 flex flex-col items-center gap-1 border-2 border-[#1c1a17] text-[10px] font-bold transition-all ${on ? 'bg-[#1c1a17] text-[#f4f1e8] shadow-[2px_2px_0_rgba(28,26,23,0.3)]' : 'bg-[#fbf9f3] text-[#1c1a17]'}`}>
                                <t.icon size={16} />{t.label}
                            </button>
                        );
                    })}
                </div>

                <div className="flex-1 overflow-y-auto p-5 no-scrollbar">
                    {activePanel === 'todo' && (
                        <div className="space-y-5">
                            <div className="flex items-center justify-between">
                                <span className="font-label text-[10px] font-bold tracking-widest text-[#1c1a17]">{todaysTodo?.date || 'TODAY'}</span>
                                <span className="text-[10px] border-2 border-[#1c1a17] px-2 py-0.5 font-bold">划掉 {todaysTodo && todaysTodo.items.length ? Math.round((todaysTodo.items.filter(i=>i.done).length / todaysTodo.items.length)*100) : 0}%</span>
                            </div>
                            {todaysTodo ? <ul className="space-y-3">{todaysTodo.items.map((item, idx) => (
                                <li key={idx} className="flex items-start gap-3 group">
                                    <div onClick={() => handleToggleTodo(idx)} className={`mt-0.5 w-5 h-5 border-2 border-[#1c1a17] flex items-center justify-center transition-colors cursor-pointer ${item.done ? 'bg-[#1c1a17]' : 'bg-[#fbf9f3]'}`}>
                                        {item.done && <svg className="w-3 h-3 text-[#f4f1e8]" viewBox="0 0 20 20" fill="currentColor"><path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"/></svg>}
                                    </div>
                                    <span onClick={() => handleToggleTodo(idx)} className={`text-sm leading-relaxed transition-all flex-1 cursor-pointer ${item.done ? 'text-[#9b958a] line-through decoration-[#9b958a]' : 'text-[#2b2823] font-medium'}`}>{item.text}</span>
                                    <button onClick={() => handleDeleteTodo(idx)} className="text-[#9b958a] hover:text-[#1c1a17] px-1 opacity-0 group-hover:opacity-100 transition-opacity"><I.close size={14} /></button>
                                </li>
                            ))}</ul> : <div className="text-center py-10 text-[#9b958a] text-xs">正在列单子…</div>}
                            {/* 自主勾画：用户也能给清单添一条（同步给角色） */}
                            <div className="flex items-center gap-2 mt-2">
                                <input
                                    value={newTodoText}
                                    onChange={e => setNewTodoText(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') void handleAddTodo(); }}
                                    placeholder={`给 ${char?.name || 'TA'} 添一件今天想让 TA 做的事…`}
                                    className="flex-1 bg-[#fbf9f3] border-2 border-[#1c1a17] px-3 py-2 text-sm text-[#2b2823] outline-none placeholder:text-[#9b958a] shadow-[2px_2px_0_#1c1a17] focus:translate-x-[1px] focus:translate-y-[1px] focus:shadow-none transition-all"
                                />
                                <button onClick={() => void handleAddTodo()} disabled={!newTodoText.trim()} className="px-3 py-2 border-2 border-[#1c1a17] bg-[#1c1a17] text-[#f4f1e8] font-bold text-xs shadow-[2px_2px_0_#1c1a17] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all disabled:opacity-40">添一条</button>
                            </div>
                            <div className="mt-4 p-4 border-2 border-[#1c1a17] bg-[#fbf9f3] text-xs text-[#2b2823] leading-relaxed relative shadow-[3px_3px_0_#1c1a17]">
                                <span className="absolute -top-3 left-4 text-[#1c1a17]"><I.pin size={22} /></span>
                                这是 {char?.name} 今天给自己列的单子。你也能帮 TA 勾掉、或自己添一条——这些都会同步给 TA。
                            </div>
                        </div>
                    )}
                    {activePanel === 'schedule' && (
                        <div className="space-y-4">
                            <ScheduleCard
                                schedule={roomSchedule}
                                character={char || null}
                                compact={true}
                            />
                            {!roomSchedule && (
                                <p className="text-center text-xs text-[#9b958a] py-4">作息会在第一次聊天后自动排好</p>
                            )}
                        </div>
                    )}
                    {activePanel === 'notebook' && (
                        <div className="flex flex-col pb-4">
                            {notebookEntries.length > 0 ? (
                                <div className="relative bg-[#fbf9f3] border-2 border-[#1c1a17] shadow-[4px_4px_0_#1c1a17] p-6 min-h-[400px] flex flex-col"
                                    style={{ backgroundImage: 'radial-gradient(rgba(28,26,23,0.12) 1px, transparent 1px)', backgroundSize: '18px 18px' }}>
                                    {/* 装订线 */}
                                    <div className="absolute left-4 top-4 bottom-4 w-px border-l-2 border-dashed border-[#1c1a17]/50 pointer-events-none"></div>
                                    <div className="mb-4 ml-6 flex justify-between items-center text-[10px] text-[#9b958a] font-label border-b-2 border-dashed border-[#1c1a17]/40 pb-2">
                                        <span className="font-bold text-[#1c1a17]">PAGE.{String(notebookEntries.length - notebookPage).padStart(2,'0')}</span>
                                        <div className="flex gap-2 items-center">
                                            <span>{new Date(notebookEntries[notebookPage].timestamp).toLocaleString()}</span>
                                            <button onClick={() => handleDeleteNote(notebookEntries[notebookPage].id)} className="text-[#9b958a] hover:text-[#1c1a17] px-1" title="撕掉这页"><I.trash size={13} /></button>
                                        </div>
                                    </div>
                                    <div className="flex-1 ml-6 text-[#2b2823] text-sm whitespace-pre-wrap leading-relaxed">{renderNotebookContent(notebookEntries[notebookPage].content)}</div>
                                    <div className="mt-6 ml-6 flex justify-between items-center pt-4 border-t-2 border-dashed border-[#1c1a17]/40">
                                        <button disabled={notebookPage >= notebookEntries.length - 1} onClick={() => setNotebookPage(p => p + 1)} className="flex items-center gap-1 text-[#1c1a17] disabled:opacity-25 font-bold text-xs"><I.back size={14} />往前翻</button>
                                        <span className="text-[10px] text-[#9b958a] font-label">{notebookPage + 1} / {notebookEntries.length}</span>
                                        <button disabled={notebookPage <= 0} onClick={() => setNotebookPage(p => p - 1)} className="flex items-center gap-1 text-[#1c1a17] disabled:opacity-25 font-bold text-xs">往后翻<I.fwd size={14} /></button>
                                    </div>
                                </div>
                            ) : <div className="text-center py-10 text-[#9b958a] text-xs">本子还是空白的…</div>}
                        </div>
                    )}
                </div>
            </div>

            {/* 顶部操作条 */}
            <div className="absolute top-0 w-full pt-12 px-4 pb-2 flex justify-between z-30 pointer-events-none">
                <button onClick={() => setViewState('select')} className="bg-[#fbf9f3] border-2 border-[#1c1a17] p-2 shadow-[2px_2px_0_#1c1a17] pointer-events-auto active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all text-[#1c1a17]"><I.back size={20} /></button>
                <div className="flex gap-2 pointer-events-auto">
                    {mode === 'view' && (
                        <button onClick={() => setShowRefreshConfirm(true)} className="p-2 bg-[#fbf9f3] border-2 border-[#1c1a17] shadow-[2px_2px_0_#1c1a17] text-[#1c1a17] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all" title="重翻今天这一页">
                            <I.refresh size={20} />
                        </button>
                    )}
                    <button onClick={() => { setMode(mode === 'view' ? 'edit' : 'view'); setSelectedItemId(null); }} className={`px-4 py-2 border-2 border-[#1c1a17] font-bold text-xs shadow-[2px_2px_0_#1c1a17] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all flex items-center gap-1.5 ${mode === 'edit' ? 'bg-[#1c1a17] text-[#f4f1e8]' : 'bg-[#fbf9f3] text-[#1c1a17]'}`}>{mode === 'edit' ? <><I.check size={15} />贴好了</> : <><I.pencil size={15} />动手布置</>}</button>
                </div>
            </div>

            {/* 随手记下（底部） */}
            {observationText && mode === 'view' && (
                <div className="absolute bottom-6 left-4 right-4 bg-[#fbf9f3] border-2 border-[#1c1a17] p-5 shadow-[4px_4px_0_#1c1a17] z-[150] animate-slide-up -rotate-[0.6deg]">
                    <Washi className="-top-3 left-6 rotate-3" />
                    <div className="flex justify-between items-start mb-2">
                        <span className="flex items-center gap-1.5 font-label text-[10px] font-bold text-[#1c1a17] tracking-[0.2em] uppercase"><I.eye size={14} />随手记下</span>
                        <button onClick={() => setObservationText('')} className="text-[#9b958a] hover:text-[#1c1a17]"><I.close size={16} /></button>
                    </div>
                    <p className="text-sm text-[#2b2823] leading-relaxed font-medium text-justify">{observationText}</p>
                </div>
            )}

            {/* 布置工具条（可收起） */}
            {mode === 'edit' && (
                <div className={`absolute bottom-0 w-full border-t-2 border-[#1c1a17] z-[150] transition-transform duration-300 flex flex-col ${isToolbarCollapsed ? 'translate-y-[calc(100%-2.5rem)]' : ''}`} style={{ ...PAPER_GRID, maxHeight: isToolbarCollapsed ? 'auto' : '45vh' }}>
                    <div className="h-10 w-full flex items-center justify-center cursor-pointer border-b-2 border-dashed border-[#1c1a17]/40" onClick={() => setIsToolbarCollapsed(!isToolbarCollapsed)}><div className="w-12 h-1.5 bg-[#1c1a17]"></div></div>
                    <div className="p-4 overflow-y-auto flex-1">
                        {selectedItemId ? (
                            <div className="flex flex-col gap-3">
                                <div className="flex justify-between items-center"><span className="text-xs font-bold text-[#1c1a17] font-label tracking-widest">调整这张贴纸</span><button onClick={deleteSelectedItem} className="flex items-center gap-1 text-xs text-[#1c1a17] font-bold border-2 border-[#1c1a17] px-3 py-1"><I.trash size={13} />撕掉</button></div>
                                <div className="flex gap-4">
                                    <div className="flex-1"><label className="text-[10px] text-[#9b958a] font-label tracking-wider block mb-1">大小</label><input type="range" min="0.5" max="3" step="0.1" value={items.find(i => i.id === selectedItemId)?.scale || 1} onChange={(e) => updateSelectedItem({ scale: parseFloat(e.target.value) })} className="w-full h-1.5 bg-[#cdc7b6] rounded-none appearance-none cursor-pointer accent-[#1c1a17]" /></div>
                                    <div className="flex-1"><label className="text-[10px] text-[#9b958a] font-label tracking-wider block mb-1">歪斜</label><input type="range" min="-180" max="180" step="5" value={items.find(i => i.id === selectedItemId)?.rotation || 0} onChange={(e) => updateSelectedItem({ rotation: parseInt(e.target.value) })} className="w-full h-1.5 bg-[#cdc7b6] rounded-none appearance-none cursor-pointer accent-[#1c1a17]" /></div>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2">
                                    {([
                                        { onClick: () => setShowLibrary(true), icon: I.stack, label: '贴纸抽屉', dark: true },
                                        { onClick: () => setShowCustomModal(true), icon: I.star, label: '做新贴纸', dark: false },
                                        { onClick: () => wallInputRef.current?.click(), icon: I.wall, label: '换墙纸', dark: false },
                                        { onClick: () => floorInputRef.current?.click(), icon: I.floor, label: '换地板', dark: false },
                                        { onClick: () => setShowSettingsModal(true), icon: I.gear, label: '边边角角', dark: false },
                                    ] as const).map((b, i) => (
                                        <button key={i} onClick={b.onClick} className="flex flex-col items-center gap-1 shrink-0">
                                            <div className={`w-12 h-12 border-2 border-[#1c1a17] flex items-center justify-center shadow-[2px_2px_0_#1c1a17] ${b.dark ? 'bg-[#1c1a17] text-[#f4f1e8]' : 'bg-[#fbf9f3] text-[#1c1a17]'}`}><b.icon size={22} /></div>
                                            <span className="text-[10px] font-bold text-[#1c1a17]">{b.label}</span>
                                        </button>
                                    ))}
                                    <button onClick={() => setShowDevModal(true)} className="flex flex-col items-center gap-1 shrink-0"><div className="w-12 h-12 bg-[#1c1a17] text-[#f4f1e8] border-2 border-[#1c1a17] flex items-center justify-center shadow-[2px_2px_0_#1c1a17] font-mono font-bold">{'{ }'}</div><span className="text-[10px] font-bold text-[#1c1a17]">底稿</span></button>

                                    <input type="file" ref={wallInputRef} className="hidden" accept="image/*" onChange={(e) => handleImageUpload(e, 'wall')} />
                                    <input type="file" ref={floorInputRef} className="hidden" accept="image/*" onChange={(e) => handleImageUpload(e, 'floor')} />
                                    <input type="file" ref={actorInputRef} className="hidden" accept="image/*" onChange={(e) => handleImageUpload(e, 'actor')} />
                                </div>
                                <div><h4 className="text-[10px] font-bold text-[#1c1a17] mb-2 font-label tracking-[0.2em] uppercase">墙面 · 现成花样</h4><div className="flex gap-2 overflow-x-auto no-scrollbar">{WALLPAPER_PRESETS.map((wp, i) => <button key={i} onClick={() => handleWallChange(wp.value)} className="w-10 h-10 border-2 border-[#1c1a17] shrink-0" style={{ background: wp.value }}></button>)}</div></div>
                                <div><h4 className="text-[10px] font-bold text-[#1c1a17] mb-2 font-label tracking-[0.2em] uppercase">地板 · 现成花样</h4><div className="flex gap-2 overflow-x-auto no-scrollbar">{FLOOR_PRESETS.map((fp, i) => <button key={i} onClick={() => handleFloorChange(fp.value)} className="w-10 h-10 border-2 border-[#1c1a17] shrink-0" style={{ background: fp.value }}></button>)}</div></div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* 贴纸抽屉 */}
            <PaperModal isOpen={showLibrary} title="贴纸抽屉" tag="stickers · 往房间里贴" onClose={() => setShowLibrary(false)}>
                <div className="h-96 overflow-y-auto no-scrollbar">
                    {Object.entries(displayLibrary).map(([category, assets]) => (
                        assets && assets.length > 0 && (
                            <div key={category} className="mb-6">
                                <h4 className="text-xs font-bold text-[#1c1a17] tracking-widest mb-3 sticky top-0 py-2 z-10 flex justify-between items-center border-b-2 border-dashed border-[#1c1a17]/40" style={PAPER_GRID}>
                                    <span className="font-['Long_Cang'] text-lg">{CAT_LABELS[category] || category}</span>
                                    <span className="text-[9px] border-2 border-[#1c1a17] px-2 font-label">{assets.length}</span>
                                </h4>
                                <div className="grid grid-cols-4 gap-4">
                                    {assets.map((asset: any, i: number) => {
                                        const isCustom = category === 'custom';
                                        const handlers = isCustom ? {
                                            onTouchStart: () => handleAssetTouchStart(asset),
                                            onTouchEnd: handleAssetTouchEnd,
                                            onMouseDown: () => handleAssetTouchStart(asset),
                                            onMouseUp: handleAssetTouchEnd,
                                            onMouseLeave: handleAssetTouchEnd,
                                            onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); handleAssetTouchStart(asset); assetLongPressTimer.current && clearTimeout(assetLongPressTimer.current); setEditingAsset(asset); setEditName(asset.name); setEditDescription(asset.description || ''); setEditImage(asset.image); setEditVisibility(asset.visibility || 'public'); setEditAssignedCharIds(asset.assignedCharIds || []); }
                                        } : {};

                                        return (
                                            <button
                                                key={asset.id || i}
                                                onClick={() => addItem(asset, category === 'custom' ? 'furniture' : category as any)}
                                                className="flex flex-col items-center gap-1.5 group relative active:scale-95 transition-transform"
                                                {...handlers}
                                            >
                                                <div className="w-14 h-14 bg-[#fbf9f3] flex items-center justify-center border-2 border-[#1c1a17] overflow-hidden relative group-hover:shadow-[2px_2px_0_#1c1a17] transition-all">
                                                    <img src={asset.image} className="w-full h-full object-contain" />
                                                    {isCustom && asset.visibility === 'character' && <div className="absolute top-0 right-0 w-0 h-0 border-t-[12px] border-l-[12px] border-t-[#1c1a17] border-l-transparent" title="专属某人"></div>}
                                                </div>
                                                <span className="text-[10px] text-[#2b2823] truncate w-full text-center">{asset.name}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )
                    ))}
                </div>
            </PaperModal>

            {/* 改贴纸 */}
            <PaperModal isOpen={!!editingAsset} title="改一改这张贴纸" tag="edit" onClose={() => setEditingAsset(null)}
                footer={<div className="flex gap-3 w-full"><button onClick={deleteEditingAsset} className="px-4 py-3 border-2 border-[#1c1a17] text-[#1c1a17] font-bold text-xs flex items-center gap-1"><I.trash size={14} />撕掉</button><button onClick={saveEditingAsset} className="flex-1 py-3 bg-[#1c1a17] text-[#f4f1e8] border-2 border-[#1c1a17] font-bold text-xs">贴好</button></div>}
            >
                {editingAsset && (
                    <div className="space-y-3">
                        <div className="flex gap-3 items-start">
                            <img src={editImage} className="w-14 h-14 object-contain bg-[#fbf9f3] border-2 border-[#1c1a17] shrink-0" />
                            <div className="flex-1 space-y-2">
                                <div>
                                    <label className="text-[10px] font-bold text-[#9b958a] font-label tracking-wider block mb-1">名字</label>
                                    <input value={editName} onChange={e => setEditName(e.target.value)} className="w-full bg-[#fbf9f3] border-2 border-[#1c1a17] px-3 py-2 text-sm font-bold focus:outline-none" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-[#9b958a] font-label tracking-wider block mb-1">图片链接</label>
                                    <input value={editImage} onChange={e => setEditImage(e.target.value)} placeholder="https://..." className="w-full bg-[#fbf9f3] border-2 border-[#1c1a17] px-3 py-2 text-xs focus:outline-none" />
                                </div>
                            </div>
                        </div>
                        <div>
                            <label className="text-[10px] font-bold text-[#9b958a] font-label tracking-wider block mb-1">小注脚</label>
                            <input value={editDescription} onChange={e => setEditDescription(e.target.value)} placeholder="这是什么、长什么样…" className="w-full bg-[#fbf9f3] border-2 border-[#1c1a17] px-3 py-2 text-xs focus:outline-none" />
                        </div>
                        <div>
                            <label className="text-[10px] font-bold text-[#9b958a] font-label tracking-wider block mb-1">归到哪</label>
                            <div className="flex gap-2">
                                <button onClick={() => setEditVisibility('public')} className={`flex-1 py-2 text-xs font-bold border-2 border-[#1c1a17] transition-colors ${editVisibility === 'public' ? 'bg-[#1c1a17] text-[#f4f1e8]' : 'bg-[#fbf9f3] text-[#1c1a17]'}`}>大家共用</button>
                                <button onClick={() => setEditVisibility('character')} className={`flex-1 py-2 text-xs font-bold border-2 border-[#1c1a17] transition-colors ${editVisibility === 'character' ? 'bg-[#1c1a17] text-[#f4f1e8]' : 'bg-[#fbf9f3] text-[#1c1a17]'}`}>专属某人</button>
                            </div>
                        </div>
                        {editVisibility === 'character' && (
                            <div>
                                <label className="text-[10px] font-bold text-[#9b958a] font-label tracking-wider block mb-1">贴给谁（可多选）</label>
                                <div className="flex flex-wrap gap-2">
                                    {characters.map(c => (
                                        <button key={c.id} onClick={() => setEditAssignedCharIds(prev => prev.includes(c.id) ? prev.filter(id => id !== c.id) : [...prev, c.id])}
                                            className={`px-3 py-1.5 text-xs font-bold border-2 border-[#1c1a17] transition-colors ${editAssignedCharIds.includes(c.id) ? 'bg-[#1c1a17] text-[#f4f1e8]' : 'bg-[#fbf9f3] text-[#1c1a17]'}`}
                                        >
                                            {c.name}
                                        </button>
                                    ))}
                                </div>
                                {editAssignedCharIds.length === 0 && <p className="text-[9px] text-[#1c1a17] mt-1 font-bold">至少挑一个人吧</p>}
                            </div>
                        )}
                    </div>
                )}
            </PaperModal>

            {/* 做新贴纸 */}
            <PaperModal isOpen={showCustomModal} title="做一张新贴纸" tag="new sticker" onClose={() => setShowCustomModal(false)} footer={<button onClick={saveCustomItem} className="w-full py-3 bg-[#1c1a17] text-[#f4f1e8] border-2 border-[#1c1a17] font-bold flex items-center justify-center gap-1.5"><I.plus size={16} />贴进房间</button>}>
                <div className="space-y-4">
                    <div className="flex gap-4">
                        <div onClick={() => customItemInputRef.current?.click()} className="aspect-square w-24 bg-[#fbf9f3] border-2 border-dashed border-[#1c1a17] flex items-center justify-center cursor-pointer relative overflow-hidden shrink-0">
                            {customItemImage ? <img src={customItemImage} className="w-full h-full object-contain" /> : <span className="text-[#9b958a] text-xs flex flex-col items-center gap-1"><I.plus size={18} />贴图</span>}
                            <input type="file" ref={customItemInputRef} className="hidden" accept="image/*" onChange={(e) => handleImageUpload(e, 'custom_item')} />
                        </div>
                        <div className="flex-1 space-y-2">
                            <div>
                                <label className="text-[10px] font-bold text-[#9b958a] font-label tracking-wider block mb-1">图片链接（推荐图床）</label>
                                <input value={customItemUrl} onChange={e => setCustomItemUrl(e.target.value)} placeholder="https://..." className="w-full bg-[#fbf9f3] border-2 border-[#1c1a17] px-3 py-2 text-xs focus:outline-none" />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-[#9b958a] font-label tracking-wider block mb-1">叫什么</label>
                                <input value={customItemName} onChange={e => setCustomItemName(e.target.value)} placeholder="比如：懒人沙发" className="w-full bg-[#fbf9f3] border-2 border-[#1c1a17] px-3 py-2 text-sm focus:outline-none font-bold" />
                            </div>
                        </div>
                    </div>
                    <div>
                        <label className="text-[10px] font-bold text-[#9b958a] font-label tracking-wider block mb-1">小注脚（告诉 TA 这是啥）</label>
                        <input value={customItemDescription} onChange={e => setCustomItemDescription(e.target.value)} placeholder="比如：一个很软的沙发，坐上去就陷进去了。" className="w-full bg-[#fbf9f3] border-2 border-[#1c1a17] px-3 py-2 text-xs focus:outline-none" />
                        <p className="text-[9px] text-[#9b958a] mt-1">这段话会让 TA 知道这是什么、要怎么和它互动。</p>
                    </div>
                </div>
            </PaperModal>

            {/* 边边角角 · 设置 */}
            <PaperModal isOpen={showSettingsModal} title="房间的边边角角" tag="settings" onClose={() => setShowSettingsModal(false)}>
                <div className="space-y-6">
                    <div className="space-y-4">
                        <h4 className="text-xs font-bold text-[#1c1a17] font-label tracking-[0.2em] uppercase border-b-2 border-dashed border-[#1c1a17]/40 pb-2">背景微调</h4>
                        <div>
                            <div className="flex justify-between mb-1"><label className="text-xs font-bold text-[#2b2823]">墙纸大小</label><span className="text-[10px] text-[#9b958a] font-label">{char?.roomConfig?.wallScale ? `${char.roomConfig.wallScale}%` : '铺满（默认）'}</span></div>
                            <input type="range" min="0" max="200" step="10" value={char?.roomConfig?.wallScale || 0} onChange={e => updateBgConfig({ wallScale: parseInt(e.target.value) })} className="w-full h-1.5 bg-[#cdc7b6] appearance-none cursor-pointer accent-[#1c1a17]" />
                            <div className="flex items-center gap-2 mt-2">
                                <input type="checkbox" id="wallRepeat" checked={char?.roomConfig?.wallRepeat || false} onChange={e => updateBgConfig({ wallRepeat: e.target.checked })} className="accent-[#1c1a17] w-4 h-4" />
                                <label htmlFor="wallRepeat" className="text-xs text-[#2b2823]">平铺重复</label>
                            </div>
                        </div>
                        <div>
                            <div className="flex justify-between mb-1"><label className="text-xs font-bold text-[#2b2823]">地板大小</label><span className="text-[10px] text-[#9b958a] font-label">{char?.roomConfig?.floorScale ? `${char.roomConfig.floorScale}%` : '铺满（默认）'}</span></div>
                            <input type="range" min="0" max="200" step="10" value={char?.roomConfig?.floorScale || 0} onChange={e => updateBgConfig({ floorScale: parseInt(e.target.value) })} className="w-full h-1.5 bg-[#cdc7b6] appearance-none cursor-pointer accent-[#1c1a17]" />
                            <div className="flex items-center gap-2 mt-2">
                                <input type="checkbox" id="floorRepeat" checked={char?.roomConfig?.floorRepeat || false} onChange={e => updateBgConfig({ floorRepeat: e.target.checked })} className="accent-[#1c1a17] w-4 h-4" />
                                <label htmlFor="floorRepeat" className="text-xs text-[#2b2823]">平铺重复</label>
                            </div>
                        </div>
                    </div>

                </div>
            </PaperModal>

            {/* 重翻今天 */}
            <PaperModal isOpen={showRefreshConfirm} title="重翻今天？" tag="refresh" onClose={() => setShowRefreshConfirm(false)} footer={<div className="flex gap-3 w-full"><button onClick={() => setShowRefreshConfirm(false)} className="flex-1 py-3 bg-[#fbf9f3] text-[#1c1a17] border-2 border-[#1c1a17] font-bold">再想想</button><button onClick={handleForceRefresh} className="flex-1 py-3 bg-[#1c1a17] text-[#f4f1e8] border-2 border-[#1c1a17] font-bold">翻就翻！</button></div>}>
                <div className="text-center py-3 space-y-3">
                    <div className="flex justify-center"><Stamp text="06:00 RENEW" /></div>
                    <p className="text-base text-[#1c1a17] font-bold font-['Long_Cang'] text-xl">每天清晨六点，自动换上新一页</p>
                    <p className="text-xs text-[#9b958a] leading-relaxed">还没到点呢——确定要费点心力，现在就重新画一遍今天的居所吗？</p>
                </div>
            </PaperModal>

            {/* 底稿 · 开发者抽屉 */}
            <PaperModal
                isOpen={showDevModal}
                title="底稿抽屉"
                tag="dev tools"
                onClose={() => setShowDevModal(false)}
                footer={<button onClick={() => setShowDevModal(false)} className="w-full py-3 bg-[#fbf9f3] text-[#1c1a17] border-2 border-[#1c1a17] font-bold">合上</button>}
            >
                <div className="space-y-4">
                    <div>
                        <h4 className="text-[10px] font-bold text-[#1c1a17] font-label tracking-[0.2em] uppercase mb-2">布局数据 · JSON</h4>
                        <div className="bg-[#1c1a17] p-3 border-2 border-[#1c1a17] mb-2">
                            <pre className="text-[10px] text-[#f4f1e8] font-mono h-20 overflow-y-auto whitespace-pre-wrap select-all">
                                {JSON.stringify(items, null, 2)}
                            </pre>
                        </div>
                        <button onClick={() => { navigator.clipboard.writeText(JSON.stringify(items, null, 2)); addToast('布局已抄进剪贴板', 'success'); }} className="w-full py-2 bg-[#1c1a17] text-[#f4f1e8] text-xs font-bold border-2 border-[#1c1a17]">抄走布局</button>
                    </div>

                    <div>
                        <h4 className="text-[10px] font-bold text-[#1c1a17] font-label tracking-[0.2em] uppercase mb-2">Prompt · 调试</h4>
                        <div className="bg-[#1c1a17] p-3 border-2 border-[#1c1a17] mb-2">
                            <pre className="text-[10px] text-[#f4f1e8] font-mono h-20 overflow-y-auto whitespace-pre-wrap select-all">
                                {lastPrompt || "（还没有数据，先进一次房间吧）"}
                            </pre>
                        </div>
                        <button onClick={() => { if(lastPrompt) { navigator.clipboard.writeText(lastPrompt); addToast('Prompt 已抄进剪贴板', 'success'); } else addToast('本子上还没有 Prompt', 'error'); }} className="w-full py-2 bg-[#1c1a17] text-[#f4f1e8] text-xs font-bold border-2 border-[#1c1a17]">抄走 Prompt</button>
                        <p className="text-[9px] text-[#9b958a] mt-2 text-center">要是 TA 没说话，把这段 Prompt 抄出来，看看有没有混进乱码 / Base64。</p>
                    </div>
                </div>
            </PaperModal>

        </div>
    );
};

export default RoomApp;
