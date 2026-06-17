import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CaretLeft, DotsThreeVertical, GearSix, List } from '@phosphor-icons/react';
import { CharacterBuff, CharacterProfile } from '../../types';

interface TokenBreakdown {
    prompt: number;
    completion: number;
    total: number;
    msgCount: number;
    pass: string;
}

interface ChatHeaderShellProps {
    selectionMode: boolean;
    selectedCount: number;
    onCancelSelection: () => void;
    activeCharacter: CharacterProfile;
    isTyping: boolean;
    isSummarizing: boolean;
    isEmotionEvaluating?: boolean;
    isInstantSending?: boolean;
    isMemoryPalaceProcessing?: boolean;
    memoryPalaceStatusText?: string;
    lastTokenUsage: number | null;
    tokenBreakdown?: TokenBreakdown | null;
    onClose: () => void;
    /** 右上角"聊天设置"入口（齿轮按钮，原 + 面板里的「设置」迁移至此）。传了才渲染。 */
    onOpenChatSettings?: () => void;
    /** 点角色名/信息区的回调。不传则角色名不可点（「切换角色 / 信纸花样」弹窗已移除）。 */
    onShowCharsPanel?: () => void;
    /** 左上角角色头像点击：打开「心声」面板（心声 / 好感值 / 当前心情）。 */
    onAvatarClick?: () => void;
    /** 右上角"角色设置"入口（⋮ 按钮）。传了才渲染。 */
    onOpenSettings?: () => void;
    onDeleteBuff?: (buffId: string) => void;
    /** 隐藏顶栏情绪 buff 栏（Appearance 里的「显示情绪栏」开关）。 */
    hideBuffs?: boolean;
    headerStyle?: 'default' | 'minimal' | 'gradient' | 'wechat' | 'telegram' | 'discord' | 'pixel';
    avatarShape?: 'circle' | 'rounded' | 'square';
    headerAlign?: 'left' | 'center';
    headerDensity?: 'compact' | 'default' | 'airy';
    statusStyle?: 'subtle' | 'pill' | 'dot';
    chromeStyle?: 'soft' | 'flat' | 'floating' | 'pixel';
    /** 最顶部装饰文案：显示在顶栏卡片上方的居中小字（会话设置「顶部装饰文案」） */
    decorText?: string;
    /** 动森彩蛋模式：头部换成木质草绿栏。 */
}

const COLLAPSED_BUFF_MIN = 1;
const COLLAPSED_BUFF_MAX = 3;

const normalizeIntensity = (n: number | undefined | null): 1 | 2 | 3 => {
    const parsed = Number.isFinite(n) ? Math.round(Number(n)) : 2;
    if (parsed <= 1) return 1;
    if (parsed >= 3) return 3;
    return 2;
};

const intensityDots = (n: number | undefined | null) => {
    const safe = normalizeIntensity(n);
    return '●'.repeat(safe) + '○'.repeat(3 - safe);
};

const ChatHeaderShell: React.FC<ChatHeaderShellProps> = ({
    selectionMode,
    selectedCount,
    onCancelSelection,
    activeCharacter,
    isEmotionEvaluating,
    isInstantSending,
    isMemoryPalaceProcessing,
    memoryPalaceStatusText,
    lastTokenUsage,
    tokenBreakdown,
    onClose,
    onOpenChatSettings,
    onShowCharsPanel,
    onAvatarClick,
    onOpenSettings,
    onDeleteBuff,
    hideBuffs = false,
    headerStyle = 'default',
    avatarShape = 'circle',
    headerAlign = 'left',
    headerDensity = 'default',
    statusStyle = 'subtle',
    chromeStyle = 'soft',
    decorText,
}) => {
    const buffs: CharacterBuff[] = hideBuffs ? [] : (activeCharacter.activeBuffs || []);
    const [openBuff, setOpenBuff] = useState<CharacterBuff | null>(null);
    const [isBuffListExpanded, setIsBuffListExpanded] = useState(false);
    const [confirmDeleteBuff, setConfirmDeleteBuff] = useState<CharacterBuff | null>(null);
    const [collapsedVisibleCount, setCollapsedVisibleCount] = useState(() => Math.min(COLLAPSED_BUFF_MAX, buffs.length));
    const cardRef = useRef<HTMLDivElement>(null);
    const buffPanelRef = useRef<HTMLDivElement>(null);
    const buffPreviewRef = useRef<HTMLDivElement>(null);
    const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const visibleBuffs = buffs.slice(0, collapsedVisibleCount);
    const hiddenBuffCount = Math.max(0, buffs.length - collapsedVisibleCount);

    const toggleBuff = (buff: CharacterBuff) => {
        setOpenBuff((prev) => (prev?.id === buff.id ? null : buff));
    };

    const handleLongPressStart = (buff: CharacterBuff) => {
        longPressTimerRef.current = setTimeout(() => {
            longPressTimerRef.current = null;
            setConfirmDeleteBuff(buff);
            setOpenBuff(null);
        }, 600);
    };

    const handleLongPressEnd = () => {
        if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
    };

    const handleConfirmDelete = () => {
        if (confirmDeleteBuff && onDeleteBuff) {
            onDeleteBuff(confirmDeleteBuff.id);
        }
        setConfirmDeleteBuff(null);
    };

    useEffect(() => {
        if (!openBuff && !isBuffListExpanded) return;
        const handler = (e: MouseEvent) => {
            const target = e.target as Node;
            const clickedInsideCard = !!cardRef.current?.contains(target);
            const clickedInsideBuffPanel = !!buffPanelRef.current?.contains(target);
            if (!clickedInsideCard && !clickedInsideBuffPanel) {
                setOpenBuff(null);
                setIsBuffListExpanded(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [openBuff, isBuffListExpanded]);

    // buff 的稳定签名：任何增删 / 改名 / 换 emoji 都会变，用它驱动「复位 → 收缩到刚好不溢出」。
    const buffSig = buffs.map((b) => `${b.id}:${b.label}:${b.emoji || ''}`).join('|');

    // 切角色 / buff 变化时收起展开态，并把可见数复位到最大（随后由下面的收缩逻辑收敛）。
    useEffect(() => {
        setIsBuffListExpanded(false);
        setOpenBuff(null);
        setCollapsedVisibleCount(Math.min(COLLAPSED_BUFF_MAX, buffs.length));
    }, [activeCharacter.id, buffSig]);

    // 顶栏宽度变化（旋转 / 分屏 / 自定义 CSS 重排）时复位可见数，重新测一遍。
    const [buffSizeTick, setBuffSizeTick] = useState(0);
    useEffect(() => {
        const node = buffPreviewRef.current;
        if (!node || typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(() => {
            setCollapsedVisibleCount(Math.min(COLLAPSED_BUFF_MAX, buffs.length));
            setBuffSizeTick((t) => t + 1);
        });
        ro.observe(node);
        return () => ro.disconnect();
    }, [buffs.length]);

    // 关键修复：用「真实渲染出来的那一行」的横向溢出来判断，而不是另测一行隐藏样本。
    // 自定义 CSS 只会撑大真实的 <button> 胶囊（.moro-chat-buffs button{padding…}），隐藏样本是 <span>
    // 不受影响 —— 旧逻辑因此会少算、留下溢出的胶囊。现在直接量真实行，逐步收到 1 个 + 「+N」，
    // 顶栏情绪栏既不会溢出，也不会在居中布局下被两端裁切。
    useLayoutEffect(() => {
        const node = buffPreviewRef.current;
        if (!node) return;
        if (node.scrollWidth - node.clientWidth > 1 && collapsedVisibleCount > COLLAPSED_BUFF_MIN) {
            setCollapsedVisibleCount((c) => Math.max(COLLAPSED_BUFF_MIN, c - 1));
        }
    }, [collapsedVisibleCount, buffSig, buffSizeTick]);

    const isDarkHeader = headerStyle === 'discord';
    const isPixelHeader = headerStyle === 'pixel';
    const useCenteredLayout = headerAlign === 'center';
    const isMinimalHeader = headerStyle === 'minimal';
    // 极简皮肤：居中头像下沉、压在白色顶栏下边缘（参考设计），并省去顶栏内角色名
    // （昵称改由消息气泡上方的标签承载；切到其它顶栏风格即恢复显示名字）
    const sinkAvatar = useCenteredLayout && isMinimalHeader;
    const avatarRadiusClass = avatarShape === 'square' ? 'rounded-sm' : avatarShape === 'rounded' ? 'rounded-xl' : 'rounded-full';
    const buffChipStyle = (buff: CharacterBuff): React.CSSProperties =>
        ({ color: buff.color || '#db2777', borderColor: `${buff.color || '#db2777'}40`, background: `${buff.color || '#db2777'}10` });

    const headerToneClass =
        headerStyle === 'gradient'
            ? 'bg-gradient-to-r from-primary/20 via-primary/10 to-white/80 backdrop-blur-xl border-b border-slate-200/60 shadow-sm'
            : headerStyle === 'minimal'
              // 默认顶栏（黑白手帐）：白色圆底卡片悬浮感 —— 大圆角下缘 + 柔影，无分割线
              ? 'bg-white/95 backdrop-blur-md rounded-b-[2rem] shadow-[0_14px_30px_-18px_rgba(50,48,60,0.3)]'
              : headerStyle === 'wechat'
                ? 'bg-[#f7f7f7]/95 backdrop-blur-md border-b border-black/5 shadow-none'
                : headerStyle === 'telegram'
                  ? 'bg-white/85 backdrop-blur-xl border-b border-sky-100 shadow-sm'
                  : headerStyle === 'discord'
                    ? 'bg-slate-900/95 backdrop-blur-xl border-b border-white/10 shadow-[0_10px_30px_rgba(15,23,42,0.35)]'
                    : headerStyle === 'pixel'
                      ? 'bg-[#c99872] border-b-[3px] border-[#7b5a40] shadow-[0_4px_0_rgba(123,90,64,0.25)]'
                      : chromeStyle === 'flat'
                        ? 'bg-white border-b border-slate-200 shadow-none'
                        : chromeStyle === 'floating'
                          ? 'bg-white/85 backdrop-blur-xl border-b border-white/70 shadow-sm'
                          : 'bg-white/80 backdrop-blur-xl border-b border-slate-200/60 shadow-sm';
    const headerBaseHeight = headerDensity === 'compact' ? '5rem' : headerDensity === 'airy' ? '7rem' : '6rem';
    // 两种对齐都用对称 py，让内容垂直居中（原标准布局只给 pb → 底贴、上方留白、整体不居中）。
    const headerDensityClass = headerDensity === 'compact' ? 'px-4 py-2' : headerDensity === 'airy' ? 'px-6 py-4' : 'px-5 py-3';
    // safe-top 已由外层 spacer 单独让位（见 return：透明 + backdrop-blur 的状态栏占位条），
    // header 主体不再把 --safe-top 算进高度（否则会让两次）；内容在 headerBaseHeight 内垂直居中。
    const headerSafeStyle: React.CSSProperties = { minHeight: headerBaseHeight };
    const primaryTextClass = isDarkHeader ? 'text-white' : isPixelHeader ? 'text-[#fff7ed]' : 'text-slate-800';
    const secondaryTextClass = isDarkHeader ? 'text-slate-400' : isPixelHeader ? 'text-[#f3ddc7]' : 'text-slate-400';
    // 顶栏图标按钮统一带按压回弹（active:scale）+ 过渡，手感更跟手。
    const pressFx = ' active:scale-90 transition-transform';
    const iconButtonClass = (isDarkHeader
        ? 'text-slate-200 hover:bg-white/10 rounded-full'
        : isPixelHeader
          ? 'text-[#fff7ed] hover:bg-[#f8f0e0]/20 rounded-[4px] border-2 border-[#8f674a] bg-[#f8f0e0]/10'
          : 'text-slate-500 hover:bg-slate-100 rounded-full') + pressFx;
    const actionButtonClass = (isDarkHeader
        ? 'text-sky-300 hover:bg-sky-400/10 rounded-full'
        : isPixelHeader
          ? 'text-[#fff7ed] hover:bg-[#f8f0e0]/20 rounded-[4px] border-2 border-[#8f674a] bg-[#f8f0e0]/10'
          : 'text-indigo-500 hover:bg-indigo-50 rounded-full') + pressFx;

    const onlineStatusNode = headerStyle === 'telegram'
        ? null
        : statusStyle === 'pill' ? (
            <div className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold border ${isDarkHeader ? 'bg-emerald-500/20 text-emerald-200 border-emerald-400/20' : isPixelHeader ? 'bg-[#fff7ed] text-[#8f674a] border-[#8f674a]/25' : 'bg-emerald-50 text-emerald-500 border-emerald-100'}`}>
                online
            </div>
        ) : statusStyle === 'dot' ? (
            <div className={`flex items-center gap-1 text-[10px] ${secondaryTextClass}`}>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span>Online</span>
            </div>
        ) : (
            <div className={`text-[10px] uppercase ${secondaryTextClass}`}>Online</div>
        );

    const renderBuffRow = (centered: boolean) => {
        if (buffs.length === 0) return null;
        return (
            <div className={`moro-chat-buffs relative w-full min-w-0 max-w-full ${centered ? 'flex justify-center' : ''}`}>
                <div
                    ref={buffPreviewRef}
                    className={`flex w-full min-w-0 max-w-full items-center gap-0.5 overflow-x-auto whitespace-nowrap pr-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${centered ? 'justify-center' : ''}`}
                >
                    {visibleBuffs.map((buff) => (
                        <button
                            key={buff.id}
                            onClick={(e) => { e.stopPropagation(); toggleBuff(buff); }}
                            onTouchStart={(e) => { e.stopPropagation(); handleLongPressStart(buff); }}
                            onTouchEnd={handleLongPressEnd}
                            onTouchCancel={handleLongPressEnd}
                            onMouseDown={(e) => { if (e.button === 0) handleLongPressStart(buff); }}
                            onMouseUp={handleLongPressEnd}
                            onMouseLeave={handleLongPressEnd}
                            className="shrink-0 max-w-[8.75rem] truncate text-[8px] leading-none px-1 py-[3px] rounded-[10px] font-bold border cursor-pointer transition-colors select-none"
                            style={buffChipStyle(buff)}
                            title={buff.label}
                        >
                            {buff.emoji ? `${buff.emoji} ` : ''}
                            {buff.label}
                        </button>
                    ))}
                    {hiddenBuffCount > 0 && (
                        <button
                            onClick={(e) => { e.stopPropagation(); setIsBuffListExpanded((prev) => !prev); }}
                            className="shrink-0 min-w-[22px] text-[8px] leading-none px-1 py-[3px] rounded-[10px] font-bold border transition-colors border-slate-300 text-slate-500 bg-slate-100/90 hover:bg-slate-200/80"
                            title="查看全部状态"
                        >
                            +{hiddenBuffCount}
                        </button>
                    )}
                </div>
            </div>
        );
    };

    const floatingStatusNodes = (lastTokenUsage || isInstantSending || isEmotionEvaluating || isMemoryPalaceProcessing) ? (
        <div className="absolute right-12 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-none">
            {lastTokenUsage && (
                <div className={`moro-chat-token text-[9px] px-1.5 py-0.5 rounded-md font-mono border ${isDarkHeader ? 'bg-slate-800 text-slate-300 border-white/10' : isPixelHeader ? 'bg-[#fff7ed] text-[#8f674a] border-[#8f674a]/20' : 'bg-slate-100/95 text-slate-400 border-slate-200'}`}>
                    {lastTokenUsage}
                </div>
            )}
            {isInstantSending && (
                <div className={`text-[9px] px-1.5 py-0.5 rounded-md font-semibold border animate-pulse ${isDarkHeader ? 'bg-sky-500/15 text-sky-200 border-sky-400/20' : isPixelHeader ? 'bg-[#eff6ff] text-[#1d4ed8] border-[#1d4ed8]/20' : 'bg-sky-50/95 text-sky-600 border-sky-200'}`}>
                    发送中…
                </div>
            )}
            {isEmotionEvaluating && (
                <div className={`text-[9px] px-1.5 py-0.5 rounded-md font-semibold border animate-pulse ${isDarkHeader ? 'bg-violet-500/15 text-violet-200 border-violet-400/20' : isPixelHeader ? 'bg-[#fff7ed] text-[#8f674a] border-[#8f674a]/20' : 'bg-violet-50/95 text-violet-500 border-violet-200'}`}>
                    情绪分析中
                </div>
            )}
            {isMemoryPalaceProcessing && (
                <div className={`text-[9px] px-1.5 py-0.5 rounded-md font-semibold border animate-pulse ${isDarkHeader ? 'bg-indigo-500/15 text-indigo-200 border-indigo-400/20' : isPixelHeader ? 'bg-[#f5f3ff] text-[#4338ca] border-[#4338ca]/20' : 'bg-indigo-50/95 text-indigo-600 border-indigo-200'}`}>
                    {memoryPalaceStatusText || '记忆整理中'}
                </div>
            )}
        </div>
    ) : null;

    // 头像点击 = 打开心声面板（与外层"打开角色列表"分离，stopPropagation 防止双触发）
    const handleAvatarClick = onAvatarClick
        ? (e: React.MouseEvent) => { e.stopPropagation(); onAvatarClick(); }
        : undefined;

    const renderCenteredInfo = () => {
        // 极简皮肤：只留一枚大头像，下沉到顶栏下边缘并叠出白卡之外（参考设计）；有情绪 buff 时把 buff 行放在头像上方的空白处，避免被下沉头像挤占。
        if (sinkAvatar) {
            return (
                <div className="relative w-full flex flex-col items-center justify-end">
                    {buffs.length > 0 && (
                        <div className="w-full mb-1">
                            {renderBuffRow(true)}
                        </div>
                    )}
                    <img
                        src={activeCharacter.avatar}
                        onClick={handleAvatarClick}
                        className={`moro-chat-avatar w-16 h-16 object-cover ${avatarRadiusClass} ring-[3px] ring-white shadow-[0_12px_26px_-8px_rgba(50,48,60,0.45)] translate-y-[26px] ${handleAvatarClick ? 'cursor-pointer active:scale-95 transition-transform' : ''}`}
                        alt="avatar"
                    />
                </div>
            );
        }
        return (
            <div className="flex w-full min-w-0 max-w-full flex-col items-center text-center">
                {/* 大头像居中（黑白手帐式）：白描边 + 柔影，是顶栏的视觉主角 */}
                <img src={activeCharacter.avatar} onClick={handleAvatarClick} className={`moro-chat-avatar w-14 h-14 object-cover ${avatarRadiusClass} ring-[3px] ring-white shadow-[0_10px_24px_-10px_rgba(50,48,60,0.4)] ${handleAvatarClick ? 'cursor-pointer active:scale-95 transition-transform' : ''}`} alt="avatar" />
                <div className={`moro-chat-name mt-1.5 text-[15px] font-bold ${primaryTextClass}`}>{activeCharacter.name}</div>
                {buffs.length > 0 && (
                    <div className="mt-1 min-h-[18px] w-full">
                        {renderBuffRow(true)}
                    </div>
                )}
            </div>
        );
    };

    const renderStandardInfo = () => (
        <>
            <img src={activeCharacter.avatar} onClick={handleAvatarClick} className={`moro-chat-avatar w-10 h-10 object-cover shadow-sm ${avatarRadiusClass} ${handleAvatarClick ? 'cursor-pointer active:scale-95 transition-transform' : ''}`} alt="avatar" />
            <div className="moro-chat-info flex-1 min-w-0 flex flex-col items-start text-left">
                <div className={`moro-chat-name font-bold ${primaryTextClass}`}>{activeCharacter.name}</div>
                <div className="moro-chat-status flex items-center gap-2 flex-wrap">
                    {onlineStatusNode}
                    {lastTokenUsage && (
                        <div className={`moro-chat-token text-[9px] px-1.5 py-0.5 rounded-md font-mono border ${isDarkHeader ? 'bg-slate-800 text-slate-300 border-white/10' : isPixelHeader ? 'bg-[#fff7ed] text-[#8f674a] border-[#8f674a]/20' : 'bg-slate-100 text-slate-400 border-slate-200'}`} title={tokenBreakdown ? `prompt: ${tokenBreakdown.prompt} | completion: ${tokenBreakdown.completion} | msgs: ${tokenBreakdown.msgCount} | pass: ${tokenBreakdown.pass}` : ''}>
                            {lastTokenUsage}
                        </div>
                    )}
                    {isInstantSending && (
                        <div className={`text-[9px] px-1.5 py-0.5 rounded-md font-semibold border animate-pulse ${isDarkHeader ? 'bg-sky-500/15 text-sky-200 border-sky-400/20' : isPixelHeader ? 'bg-[#eff6ff] text-[#1d4ed8] border-[#1d4ed8]/20' : 'bg-sky-50 text-sky-600 border-sky-200'}`}>
                            发送中…
                        </div>
                    )}
                    {isEmotionEvaluating && (
                        <div className={`text-[9px] px-1.5 py-0.5 rounded-md font-semibold border animate-pulse ${isDarkHeader ? 'bg-violet-500/15 text-violet-200 border-violet-400/20' : isPixelHeader ? 'bg-[#fff7ed] text-[#8f674a] border-[#8f674a]/20' : 'bg-violet-50 text-violet-500 border-violet-200'}`}>
                            情绪分析中
                        </div>
                    )}
                </div>
                {buffs.length > 0 && (
                    <div className="mt-1 w-full">
                        {renderBuffRow(false)}
                    </div>
                )}
            </div>
        </>
    );

    return (
        <div className="shrink-0 z-30 sticky top-0">
        {/* 顶部安全区 + 页眉小字：
            没有页眉小字时只铺一条 safe-top 占位（透明 + backdrop-blur 跟 iOS status bar 自适应）。
            有页眉小字时，下沉到「时间/电量」状态栏 + 居中的灵动岛（DynamicIsland，约 safe-top+26px、
            z-59）下方再画这行字 —— 这行字本身居中，正好在灵动岛正下方，光用 --chrome-top（safe-top+1.5rem）
            还会被灵动岛压住（这正是「页眉小字被遮挡」的根因）。所以这里多留到 safe-top+2.5rem 让它整段
            落到灵动岛底缘之下。 */}
        {decorText && !selectionMode ? (
            <div
                className="moro-chat-topdecor flex justify-center items-end pb-1 px-8 bg-transparent backdrop-blur-xl"
                style={{ paddingTop: 'calc(var(--safe-top) + 2.5rem)' }}
            >
                <span className={`text-[12px] font-bold tracking-wide truncate max-w-full ${isDarkHeader ? 'text-slate-300' : 'text-slate-500'}`}>{decorText}</span>
            </div>
        ) : (
            // 没有页眉小字时：居中布局（极简皮肤）也要给「灵动岛」让位——否则居中的情绪 buff /
            // 头像会顶到 safe-top+26px 的灵动岛底下（参考反馈图：buff 被灵动岛劈成左右两半）。
            // 与上面页眉小字同样下沉 2.5rem 到灵动岛底缘之下；左对齐布局内容在两侧、不压岛，保持 safe-top。
            <div className="bg-transparent backdrop-blur-xl" style={{ height: useCenteredLayout ? 'calc(var(--safe-top) + 2.5rem)' : 'var(--safe-top)' }} />
        )}
        {/* header 主体：moro-chat-header 钩子 + 内容垂直居中（items-center）；safe-top 已由上面 spacer 让位 */}
        <div className={`moro-chat-header ${headerDensityClass} flex items-center relative ${headerToneClass}`} style={headerSafeStyle}>
            {selectionMode ? (
                <div className="flex items-center justify-between w-full">
                    <button onClick={onCancelSelection} className={`text-sm font-bold px-2 py-1 ${secondaryTextClass}`}>取消</button>
                    <span className={`text-sm font-bold ${primaryTextClass}`}>已选 {selectedCount} 项</span>
                    <div className="w-10" />
                </div>
            ) : useCenteredLayout ? (
                <div className="relative w-full min-h-[56px] flex items-end justify-center">
                    <button onClick={onClose} className={`moro-chat-back absolute left-0 bottom-2 p-2 ${iconButtonClass}`}>
                        <CaretLeft className="w-5 h-5" weight="bold" />
                    </button>

                    {floatingStatusNodes}

                    <div
                        onClick={onShowCharsPanel}
                        className={`flex w-[calc(100%-7rem)] max-w-[420px] items-end justify-center ${onShowCharsPanel ? 'cursor-pointer' : ''}`}
                    >
                        {renderCenteredInfo()}
                    </div>

                    {onOpenChatSettings && (
                        <button onClick={onOpenChatSettings} className={`moro-chat-settings absolute ${onOpenSettings ? 'right-9' : 'right-0'} bottom-2 p-2 ${actionButtonClass}`} title="聊天设置">
                            <GearSix className="w-5 h-5" weight="bold" />
                        </button>
                    )}
                    {onOpenSettings && (
                        <button onClick={onOpenSettings} className={`moro-chat-settings absolute right-0 bottom-2 p-2 ${iconButtonClass}`} title="聊天设置">
                            {isMinimalHeader ? <List className="w-5 h-5" weight="bold" /> : <DotsThreeVertical className="w-5 h-5" weight="bold" />}
                        </button>
                    )}
                </div>
            ) : (
                <div className="flex items-center gap-3 w-full">
                    <button onClick={onClose} className={`moro-chat-back p-2 -ml-2 ${iconButtonClass}`}>
                        <CaretLeft className="w-5 h-5" weight="bold" />
                    </button>

                    <div onClick={onShowCharsPanel} className={`flex-1 min-w-0 flex items-center gap-3 ${onShowCharsPanel ? 'cursor-pointer' : ''}`}>
                        {renderStandardInfo()}
                    </div>

                    {onOpenChatSettings && (
                        <button onClick={onOpenChatSettings} className={`moro-chat-settings p-2 ml-auto ${actionButtonClass}`} title="聊天设置">
                            <GearSix className="w-5 h-5" weight="bold" />
                        </button>
                    )}
                    {onOpenSettings && (
                        <button onClick={onOpenSettings} className={`moro-chat-settings p-2 -mr-2 ${iconButtonClass}`} title="聊天设置">
                            {isMinimalHeader ? <List className="w-5 h-5" weight="bold" /> : <DotsThreeVertical className="w-5 h-5" weight="bold" />}
                        </button>
                    )}
                </div>
            )}

            {isBuffListExpanded && hiddenBuffCount > 0 && (
                <div ref={buffPanelRef} className="absolute top-full left-4 right-4 mt-1 bg-white rounded-xl shadow-lg border border-slate-200 p-3 z-40">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">全部状态</div>
                    <div className="max-h-36 overflow-y-auto pr-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        <div className="flex flex-wrap gap-1.5">
                            {buffs.map((buff) => (
                                <button
                                    key={`panel-${buff.id}`}
                                    onClick={(e) => { e.stopPropagation(); toggleBuff(buff); }}
                                    onTouchStart={(e) => { e.stopPropagation(); handleLongPressStart(buff); }}
                                    onTouchEnd={handleLongPressEnd}
                                    onTouchCancel={handleLongPressEnd}
                                    onMouseDown={(e) => { if (e.button === 0) handleLongPressStart(buff); }}
                                    onMouseUp={handleLongPressEnd}
                                    onMouseLeave={handleLongPressEnd}
                                    className="text-[10px] px-2 py-1 rounded-lg font-bold border cursor-pointer transition-colors select-none"
                                    style={buffChipStyle(buff)}
                                >
                                    {buff.emoji ? `${buff.emoji} ` : ''}
                                    {buff.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {openBuff && (
                <div ref={cardRef} className="absolute top-full left-4 right-4 mt-1 bg-white rounded-xl shadow-lg border border-slate-200 p-3 z-50">
                    <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-bold" style={{ color: openBuff.color || '#db2777' }}>
                                {openBuff.emoji ? `${openBuff.emoji} ` : ''}
                                {openBuff.label}
                            </span>
                            <div className="text-xs font-bold tracking-wide" style={{ color: openBuff.color || '#db2777' }}>
                                {intensityDots(openBuff.intensity)}{' '}
                                {normalizeIntensity(openBuff.intensity) === 1 ? '轻微' : normalizeIntensity(openBuff.intensity) === 2 ? '中等' : '强烈'}
                            </div>
                        </div>
                        <button onClick={() => setOpenBuff(null)} className="text-slate-300 hover:text-slate-500 text-lg leading-none px-1">
                            {'\u00d7'}
                        </button>
                    </div>
                    {openBuff.description ? (
                        <p className="text-sm text-slate-600 leading-relaxed">{openBuff.description}</p>
                    ) : (
                        <p className="text-xs text-slate-400 italic">暂无详情</p>
                    )}
                </div>
            )}

            {confirmDeleteBuff && typeof document !== 'undefined' && createPortal(
                <div className="moro-laiwang fixed inset-0 bg-slate-900/45 backdrop-blur-[1px] z-[100]" onClick={() => setConfirmDeleteBuff(null)}>
                    <div className="absolute left-1/2 top-1/2 w-[min(88vw,360px)] -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-white/40 bg-white/95 p-5 shadow-2xl shadow-slate-900/25" onClick={(e) => e.stopPropagation()}>
                        <div className="text-center mb-4">
                            <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-100 to-red-100 text-xl shadow-inner">
                                {confirmDeleteBuff.emoji || '🗑'}
                            </div>
                            <div className="font-bold text-slate-800 text-sm">删除情绪状态</div>
                            <div className="text-xs text-slate-500 mt-1 leading-relaxed">
                                确定要删除“{confirmDeleteBuff.label}”吗？
                                <br />
                                对应的提示也会一起移除。
                            </div>
                        </div>
                        <div className="flex gap-2.5">
                            <button
                                onClick={() => setConfirmDeleteBuff(null)}
                                className="flex-1 py-2.5 text-sm font-semibold text-slate-600 bg-slate-100 rounded-2xl hover:bg-slate-200 transition-colors"
                            >
                                取消
                            </button>
                            <button
                                onClick={handleConfirmDelete}
                                className="flex-1 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-rose-500 to-red-500 rounded-2xl hover:from-rose-600 hover:to-red-600 shadow-lg shadow-red-200/80 transition-all"
                            >
                                删除
                            </button>
                        </div>
                    </div>
                </div>,
                document.body,
            )}
        </div>
        </div>
    );
};

export default ChatHeaderShell;
