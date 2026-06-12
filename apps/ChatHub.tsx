
import React, { useState, useEffect, useRef, useLayoutEffect, useMemo } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { AppID, Message, GroupProfile, CharacterProfile, MessageType, ChatTheme, MemoryFragment, EmojiCategory } from '../types';
import { safeResponseJson } from '../utils/safeApi';
import Modal from '../components/os/Modal';
import { ContextBuilder } from '../utils/context';
import { injectMemoryPalace } from '../utils/memoryPalace/pipeline';
import { processGroupNewMessages, deleteGroupMemoriesByGroupId } from '../utils/memoryPalace/groupPipeline';
import { processImage } from '../utils/file';
import { DEFAULT_ARCHIVE_PROMPTS } from '../components/chat/ChatConstants';
import { UsersThree, ChatsTeardrop, AddressBook, Planet, HandPointing, SpeakerSlash, Crown, GearSix } from '@phosphor-icons/react';
import MomentsFeed from '../components/moments/MomentsFeed';
import FriendVerifyModal from '../components/chat/FriendVerifyModal';

const TWEMOJI_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72';
const twemojiUrl = (codepoint: string) => `${TWEMOJI_BASE}/${codepoint}.png`;

// 复用 Chat.tsx 的高颜值样式逻辑，但针对群聊微调
const PRESET_THEME_GROUP: ChatTheme = {
    id: 'group_default', name: 'Group', type: 'preset',
    user: { textColor: '#ffffff', backgroundColor: '#8b5cf6', borderRadius: 18, opacity: 1 }, // Violet for User
    ai: { textColor: '#1e293b', backgroundColor: '#ffffff', borderRadius: 18, opacity: 1 }  // White for Others
};

// --- Sub-Component: Group Message Bubble ---
const GroupMessageItem = React.memo(({
    msg,
    isUser,
    char,
    userAvatar,
    onImageClick,
    selectionMode,
    isSelected,
    onToggleSelect,
    onLongPress,
    displayName,
    memberTitle,
    onAvatarClick,
    onAvatarPoke
}: {
    msg: Message,
    isUser: boolean,
    char?: CharacterProfile,
    userAvatar: string,
    onImageClick: (url: string) => void,
    selectionMode: boolean,
    isSelected: boolean,
    onToggleSelect: (id: number) => void,
    onLongPress: (id: number) => void,
    /** 群名片（成员在本群的昵称），不传则用角色名 */
    displayName?: string,
    /** 群主/管理员设置的头衔徽章 */
    memberTitle?: string,
    /** 单击成员头像：打开成员资料/角色设置 */
    onAvatarClick?: () => void,
    /** 双击成员头像：戳一戳 */
    onAvatarPoke?: () => void
}) => {
    const avatar = isUser ? userAvatar : char?.avatar;
    const name = isUser ? '我' : displayName || char?.name || '未知成员';
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const startPos = useRef({ x: 0, y: 0 });
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
        return (
            <div className="flex justify-center my-3 animate-fade-in" onClick={() => { if (selectionMode) onToggleSelect(msg.id); }}>
                <span className={`px-3 py-1 rounded-full bg-slate-200/70 text-slate-500 text-[10px] text-center leading-relaxed max-w-[85%] ${selectionMode && isSelected ? 'ring-2 ring-slate-400' : ''}`}>
                    {msg.content}
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
                    {isUser ? `我${msg.content.replace(/^\[|\]$/g, '')}` : msg.content.replace(/^\[|\]$/g, '')}
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

    // Special Content Renderers
    const renderContent = () => {
        switch (msg.type) {
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
                return <img src={msg.content} className="w-24 h-24 object-contain drop-shadow-sm hover:scale-110 transition-transform" />;
            case 'transfer':
                return (
                    <div className="w-60 bg-[#fb923c] text-white p-3 rounded-xl flex items-center gap-3 shadow-md relative overflow-hidden active:scale-95 transition-transform">
                        <div className="absolute -right-2 -top-2 text-white/20"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-16 h-16"><path d="M10.464 8.746c.227-.18.497-.311.786-.394v2.795a2.252 2.252 0 0 1-.786-.393c-.394-.313-.546-.681-.546-1.004 0-.324.152-.691.546-1.004ZM12.75 15.662v-2.824c.347.085.664.228.921.421.427.32.579.686.579.991 0 .305-.152.671-.579.991a2.534 2.534 0 0 1-.921.42Z" /><path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25ZM12.75 6a.75.75 0 0 0-1.5 0v.816a3.836 3.836 0 0 0-1.72.756c-.712.566-1.112 1.35-1.112 2.178 0 .829.4 1.612 1.113 2.178.502.4 1.102.647 1.719.756v2.978a2.536 2.536 0 0 1-.921-.421l-.879-.66a.75.75 0 0 0-.9 1.2l.879.66c.533.4 1.169.645 1.821.75V18a.75.75 0 0 0 1.5 0v-.81a4.124 4.124 0 0 0 1.821-.749c.745-.559 1.179-1.344 1.179-2.191 0-.847-.434-1.632-1.179-2.191a4.122 4.122 0 0 0-1.821-.75V8.354c.29.082.559.213.786.393l.415.33a.75.75 0 0 0 .933-1.175l-.415-.33a3.836 3.836 0 0 0-1.719-.755V6Z" clipRule="evenodd" /><path d="M2.25 18a.75.75 0 0 0 0 1.5c5.4 0 10.63.722 15.6 2.075 1.19.324 2.4-.558 2.4-1.82V18.75a.75.75 0 0 0-.75-.75H2.25Z" /></svg></div>
                        <div className="bg-white/20 p-2 rounded-full shrink-0"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path d="M12 7.5a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5Z" /><path fillRule="evenodd" d="M1.5 4.875C1.5 3.839 2.34 3 3.375 3h17.25c1.035 0 1.875.84 1.875 1.875v9.75c0 1.036-.84 1.875-1.875 1.875H3.375A1.875 1.875 0 0 1 1.5 14.625v-9.75ZM8.25 9.75a3.75 3.75 0 1 1 7.5 0 3.75 3.75 0 0 1-7.5 0ZM18.75 9a.75.75 0 0 0-.75.75v.008c0 .414.336.75.75.75h.008a.75.75 0 0 0 .75-.75V9.75a.75.75 0 0 0-.75-.75h-.008ZM4.5 9.75A.75.75 0 0 1 5.25 9h.008a.75.75 0 0 1 .75.75v.008a.75.75 0 0 1-.75-.75H5.25a.75.75 0 0 1-.75-.75V9.75Z" clipRule="evenodd" /><path d="M2.25 18a.75.75 0 0 0 0 1.5c5.4 0 10.63.722 15.6 2.075 1.19.324 2.4-.558 2.4-1.82V18.75a.75.75 0 0 0-.75-.75H2.25Z" /></svg></div>
                        <div className="z-10">
                            <div className="font-bold text-sm tracking-wide">红包 / 转账</div>
                            <div className="text-[10px] opacity-90">Moro Pay</div>
                        </div>
                    </div>
                );
            default:
                return (
                    <div className={`px-3.5 py-2 rounded-[18px] text-[15px] leading-relaxed shadow-sm whitespace-pre-wrap break-all ${isUser ? 'bg-[#2b2933] text-white rounded-tr-sm' : 'bg-white text-slate-700 rounded-tl-sm border border-slate-100'}`}>
                        {msg.content}
                    </div>
                );
        }
    };

    return (
        <div 
            className={`flex gap-3 mb-4 w-full animate-fade-in relative ${isUser ? 'justify-end' : 'justify-start'} ${selectionMode ? 'pl-8' : ''}`}
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
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${isSelected ? 'bg-[#2b2933] border-[#2b2933]' : 'border-slate-300 bg-white'}`}>
                        {isSelected && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>}
                    </div>
                </div>
            )}

            {!isUser && (
                <div className="flex flex-col items-center gap-1 shrink-0">
                    <img
                        src={avatar}
                        className={`w-9 h-9 rounded-full object-cover shadow-sm border border-white ${(onAvatarClick || onAvatarPoke) && !selectionMode ? 'cursor-pointer active:scale-90 transition-transform' : ''}`}
                        loading="lazy"
                        onClick={handleAvatarClick}
                    />
                </div>
            )}

            <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} max-w-[80%] ${selectionMode ? 'pointer-events-none' : ''}`}>
                {!isUser && (
                    <span className="text-[10px] text-slate-400 ml-1 mb-1 flex items-center gap-1">
                        {memberTitle && (
                            <span className="px-1 py-px rounded bg-amber-100 text-amber-600 border border-amber-200 text-[8px] font-bold leading-tight">{memberTitle}</span>
                        )}
                        {name}
                    </span>
                )}
                {renderContent()}
                <span className="text-[9px] text-slate-300 mt-1 px-1">{timeStr}</span>
            </div>

            {isUser && (
                <div className="flex flex-col items-center gap-1 shrink-0">
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
    const { closeApp, openApp, groups, createGroup, deleteGroup, updateGroup, characters, updateCharacter, setActiveCharacterId, apiConfig, addToast, userProfile, virtualTime } = useOS();
    const [view, setView] = useState<'list' | 'chat'>('list');
    const [hubTab, setHubTab] = useState<'chats' | 'contacts' | 'moments'>(() => {
        // 深链握手：角色主页「朋友圈」入口 → 聊天 App 朋友圈标签页（原独立朋友圈 App 已改造为小红书）
        try {
            if (localStorage.getItem('moro_chathub_open_tab') === 'moments') {
                localStorage.removeItem('moro_chathub_open_tab');
                return 'moments';
            }
        } catch { /* ignore */ }
        return 'chats';
    });
    const [activeGroup, setActiveGroup] = useState<GroupProfile | null>(null);
    // 朋友圈内层页面（发布页等）的返回拦截：返回键先关内层页面，而不是退出 App 回桌面
    const momentsBackRef = useRef<(() => boolean) | null>(null);
    // 聊天列表：单聊 + 群聊混排（按最后一条消息时间倒序）
    const [convos, setConvos] = useState<Array<{
        kind: 'char' | 'group';
        id: string;
        name: string;
        avatar?: string;
        last?: Message;
        dissolved?: boolean;
        memberCount?: number;
    }>>([]);
    // 成员资料页（点头像进入）
    const [profileMemberId, setProfileMemberId] = useState<string | null>(null);
    // 头衔编辑 / 禁言时长选择
    const [tempTitle, setTempTitle] = useState('');
    // 移除成员二次确认（第一次点变红，再点才执行）
    const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
    // 我的群名片编辑（设置弹窗里）
    const [tempMyNickname, setTempMyNickname] = useState('');
    // 群聊表情抽屉搜索
    const [emojiSearch, setEmojiSearch] = useState('');
    const [messages, setMessages] = useState<Message[]>([]);
    const [totalMsgCount, setTotalMsgCount] = useState(0);
    const [visibleCount, setVisibleCount] = useState(30);
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    /** 群记忆宫殿"提取中"状态文本——非空时显示顶部胶囊状态条 */
    const [groupPalaceStatus, setGroupPalaceStatus] = useState<string>('');

    // ref 出最新 characters，让 finally 里跑的群记忆宫殿能读到"用户刚关掉某个成员宫殿"
    // 的最新状态——闭包里的 characters 还是发消息那一刻捕获的旧值，会让关闭后还触发一次
    const charactersRef = useRef(characters);
    charactersRef.current = characters;

    // Token 统计 — 对齐私聊 ChatHeader 的 token badge
    const [lastTokenUsage, setLastTokenUsage] = useState<number | null>(null);
    const [tokenBreakdown, setTokenBreakdown] = useState<{ prompt: number; completion: number; total: number; msgCount: number; pass: string } | null>(null);
    
    // UI State
    const [showActions, setShowActions] = useState(false);
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [modalType, setModalType] = useState<'none' | 'create' | 'add-friend' | 'settings' | 'transfer' | 'member_select' | 'message-options' | 'edit-message' | 'member-profile' | 'set-title' | 'mute-member' | 'add-member'>('none');
    // 右上角 + 号弹出菜单（添加好友 / 创建群聊）
    const [showPlusMenu, setShowPlusMenu] = useState(false);
    // 加好友页选中「拉黑你的角色」→ 好友验证弹窗
    const [verifyCharId, setVerifyCharId] = useState<string | null>(null);
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
        try { return parseInt(localStorage.getItem('groupchat_context_limit') || '30'); } catch { return 30; }
    });
    
    // Selection Mode
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedMsgIds, setSelectedMsgIds] = useState<Set<number>>(new Set());

    // Data State
    const [emojis, setEmojis] = useState<{name: string, url: string, categoryId?: string}[]>([]);
    const [categories, setCategories] = useState<EmojiCategory[]>([]); // New
    
    // Create/Edit Group State
    const [tempGroupName, setTempGroupName] = useState('');
    const [tempPrivateContextCap, setTempPrivateContextCap] = useState<number>(80);
    const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
    // 创建群聊时指定群主（'user' 或任一已选成员）与管理员
    const [tempOwnerId, setTempOwnerId] = useState<string>('user');
    const [tempAdminIds, setTempAdminIds] = useState<Set<string>>(new Set());
    const [transferAmount, setTransferAmount] = useState('');
    
    // Refs
    const scrollRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const groupAvatarInputRef = useRef<HTMLInputElement>(null);

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

    // Initial Load
    useEffect(() => {
        if (activeGroup) {
            setVisibleCount(30);
            DB.getRecentGroupMessagesWithCount(activeGroup.id, 30).then(({ messages: msgs, totalCount }) => {
                setMessages(msgs);
                setTotalMsgCount(totalCount);
            });
            // Fetch emojis AND categories
            Promise.all([DB.getEmojis(), DB.getEmojiCategories()]).then(([es, cats]) => {
                setEmojis(es);
                setCategories(cats);
            });
        }
    }, [activeGroup]);

    // Auto Scroll
    useLayoutEffect(() => {
        if (scrollRef.current && !selectionMode) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages.length, activeGroup, showActions, showEmojiPicker, isTyping, selectionMode]);

    const displayMessages = useMemo(() => messages.slice(-visibleCount), [messages, visibleCount]);

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

    /** 更新群并同步本地 activeGroup（updateGroup 只更新全局 groups state） */
    const applyGroupUpdate = async (updates: Partial<GroupProfile>): Promise<GroupProfile | null> => {
        if (!activeGroup) return null;
        const updated = await updateGroup(activeGroup.id, updates);
        if (updated) setActiveGroup(updated);
        return updated;
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
    const openPrivateChat = (charId: string) => {
        setActiveCharacterId(charId);
        openApp(AppID.Chat);
    };

    // --- 聊天列表（单聊 + 群聊混排）---
    useEffect(() => {
        if (view !== 'list') return;
        let cancelled = false;
        (async () => {
            const items: typeof convos = [];
            for (const g of groups) {
                const { messages: last } = await DB.getRecentGroupMessagesWithCount(g.id, 1);
                items.push({
                    kind: 'group', id: g.id, name: g.name, avatar: g.avatar,
                    last: last[last.length - 1],
                    dissolved: !!g.dissolved,
                    memberCount: g.members.length,
                });
            }
            for (const c of characters) {
                const { messages: lastMsgs } = await DB.getRecentMessagesWithCount(c.id, 1);
                if (lastMsgs.length === 0) continue; // 没聊过的角色去「联系人」页找
                // 会话设置「备注名 / 会话头像」覆盖列表展示
                items.push({
                    kind: 'char', id: c.id,
                    name: c.convoSettings?.remarkName?.trim() || c.name,
                    avatar: c.convoSettings?.charAvatarOverride || c.avatar,
                    last: lastMsgs[lastMsgs.length - 1],
                });
            }
            items.sort((a, b) => (b.last?.timestamp || 0) - (a.last?.timestamp || 0));
            if (!cancelled) setConvos(items);
        })();
        return () => { cancelled = true; };
    }, [view, groups, characters]);

    /** 聊天列表里一条消息的预览文本 */
    const previewOf = (m?: Message): string => {
        if (!m) return '暂无消息';
        switch (m.type) {
            case 'image': return '[图片]';
            case 'emoji': return '[表情包]';
            case 'transfer': return '[红包]';
            case 'voice': return '[语音]';
            case 'interaction': return m.content || '[戳一戳]';
            case 'system': return m.content;
            default: {
                const t = typeof m.content === 'string' ? m.content : '';
                return /^(data:|https?:\/\/)/i.test(t.trim()) ? '[媒体]' : t.slice(0, 40);
            }
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

    const handleEnterSelectionMode = () => {
        if (selectedMessage) {
            setSelectedMsgIds(new Set([selectedMessage.id]));
            setSelectionMode(true);
            setModalType('none');
            setSelectedMessage(null);
        }
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

    const handleUpdateGroupInfo = async () => {
        if (!activeGroup) return;
        const newName = (tempGroupName || activeGroup.name).trim();
        const oldName = activeGroup.name;
        const oldMyNickname = activeGroup.memberNicknames?.['user'] || '';
        const newMyNickname = tempMyNickname.trim();

        const updatedGroup: GroupProfile = {
            ...activeGroup,
            name: newName,
            privateContextCap: tempPrivateContextCap,
            memberNicknames: { ...(activeGroup.memberNicknames || {}), user: newMyNickname },
        };
        if (!newMyNickname) delete updatedGroup.memberNicknames!['user'];
        await updateGroup(activeGroup.id, updatedGroup);
        setActiveGroup(updatedGroup);
        setModalType('none');

        // 群内系统通知：角色下一轮能从历史里"看到"这些变化
        if (newName !== oldName) {
            await postGroupNotice(activeGroup.id, `你将群名称修改为「${newName}」`);
        }
        if (newMyNickname !== oldMyNickname) {
            await postGroupNotice(activeGroup.id, newMyNickname ? `你将自己的群名片改为「${newMyNickname}」` : '你清除了自己的群名片');
        }
        addToast('群信息已更新', 'success');
    };

    // --- 成员管理：移除 / 头衔 / 禁言 / 戳一戳 ---

    const handleRemoveMember = async (charId: string) => {
        if (!activeGroup) return;
        const name = displayNameOf(activeGroup, charId);
        const updated = await applyGroupUpdate({ members: activeGroup.members.filter(id => id !== charId) });
        if (updated) {
            await postGroupNotice(activeGroup.id, `你将「${name}」移出了群聊`);
            setProfileMemberId(null);
            setModalType('none');
            addToast(`已移除 ${name}`, 'success');
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
        setProfileMemberId(null);
        setModalType('none');
        await handleSendMessage(`[戳了戳 ${name}]`, 'interaction', { targetCharId: charId });
    };

    const handleGroupAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !activeGroup) return;
        try {
            const base64 = await processImage(file);
            const updatedGroup = { ...activeGroup, avatar: base64 };
            await DB.saveGroup(updatedGroup);
            setActiveGroup(updatedGroup);
            addToast('群头像已修改', 'success');
        } catch (err: any) {
            addToast('图片处理失败', 'error');
        }
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

    // 解散 ≠ 删除：标记 dissolved，群保留在聊天列表显示"此群聊已被解散"，历史可回看（只读）
    const handleDissolveGroup = async (id: string) => {
        const updated = await updateGroup(id, { dissolved: true, dissolvedAt: Date.now() });
        if (updated) {
            await postGroupNotice(id, '你解散了该群聊');
            if (activeGroup?.id === id) setActiveGroup(updated);
            setModalType('none');
            setView('list');
            addToast('群聊已解散', 'success');
        }
    };

    // 彻底删除（聊天列表里对已解散的群提供）：清理群记忆后真删
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
        if (!activeGroup || !apiConfig.apiKey) {
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

                const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                    body: JSON.stringify({
                        model: apiConfig.model,
                        messages: [{ role: "user", content: prompt }],
                        temperature: 0.3
                    })
                });

                if (response.ok) {
                    const data = await safeResponseJson(response);
                    let content = data.choices[0].message.content.trim();
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

    const handleSendMessage = async (content: string, type: MessageType = 'text', metadata?: any) => {
        if (!activeGroup) return;
        
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

        // NOTE: No auto-trigger. User must click lightning button.
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

    // --- Logic: AI Director (The Core Logic) ---

    const triggerDirector = async (currentMsgs: Message[]) => {
        if (!activeGroup || !apiConfig.apiKey) return;
        if (activeGroup.dissolved) { addToast('该群聊已被解散', 'info'); return; }
        setIsTyping(true);

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
            const sharedScene = ContextBuilder.buildGroupSharedScene(groupMembers, userProfile);

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
                return `- ${m.name} (ID: ${m.id})${nick ? ` | 群名片:「${nick}」` : ''}${title ? ` | 头衔:「${title}」` : ''}${ownerStr}${mutedStr}`;
            }).join('\n');
            const userNick = activeGroup.memberNicknames?.['user'];
            const userRosterLine = `- ${userProfile.name}（用户）${userNick ? ` | 群名片:「${userNick}」` : ''}${ownerId === 'user' ? ' | 群主' : ''}`;

            let context = `【系统：群聊模拟器配置】
当前群名: "${activeGroup.name}"
当前系统时间: ${currentTimeStr}
时间流逝感知: ${timeGapInfo}

群成员花名册（群名片 = 成员在本群显示的昵称，可自己修改；头衔由群主/管理员授予）:
${userRosterLine}
${rosterLines}

${sharedScene.text}`;

            // 2. Inject Member Context (Strict Isolation via ContextBuilder)
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
                    headerOverride: `[Group Member Profile: ${member.name}]`,
                });
                // Get private gap string
                const privateGapInfo = await getPrivateTimeGap(member.id);

                const recentPrivate = privateMsgs.slice(-10).map(m => `[${m.role === 'user' ? '用户' : '我'}]: ${m.content.substring(0, 50)}`).join('\n');

                // Construct Detailed Profile Wrapper
                // CRITICAL FIX: Emphasize Private Context logic
                context += `
<<< 角色档案 START: ${member.name} (ID: ${member.id}) >>>
${coreContext}

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

            // 3. Group History (uses configurable context limit)
            // image 的 content 是 base64（processImage 压的 JPEG），emoji 是图床 URL——
            // 都不能当文本内联进 prompt：base64 图片会把群上下文撑爆，URL 则是纯噪声。
            // 卡片等富类型同理只留占位符。但导演要能"看见"图才能合理反应，所以仿照
            // 私聊 buildMessageHistory 的做法：把最近 N 张图片走结构化 image_url 字段
            // 附在 user 消息里，文本里用 [图片#k] 占位互相对齐。
            const recentMsgsWindow = currentMsgs.slice(-contextLimit);
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
                let name = '用户';
                if (m.role === 'assistant') {
                    name = characters.find(c => c.id === m.charId)?.name || '未知';
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
                    content = `[发红包: ${m.metadata?.amount}]`;
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
                if (emojis.length === 0) return '无';

                const memberIds = activeGroup?.members || [];
                // Filter categories: include if no restriction, or if at least one group member is allowed
                const visibleCats = categories.filter(c => {
                    if (!c.allowedCharacterIds || c.allowedCharacterIds.length === 0) return true;
                    return c.allowedCharacterIds.some(id => memberIds.includes(id));
                });
                const hiddenCatIds = new Set(categories.filter(c => !visibleCats.some(vc => vc.id === c.id)).map(c => c.id));
                const visibleEmojis = hiddenCatIds.size === 0 ? emojis : emojis.filter(e => !e.categoryId || !hiddenCatIds.has(e.categoryId));

                const grouped: Record<string, string[]> = {};
                const catMap: Record<string, string> = { 'default': '通用' };
                visibleCats.forEach(c => catMap[c.id] = c.name);

                visibleEmojis.forEach(e => {
                    const cid = e.categoryId || 'default';
                    if (!grouped[cid]) grouped[cid] = [];
                    grouped[cid].push(e.name);
                });

                return Object.entries(grouped).map(([cid, names]) => {
                    const cName = catMap[cid] || '其他';
                    return `${cName}: [${names.join(', ')}]`;
                }).join('; ');
            })();

            const prompt = `${context}

### 【AI 导演任务指令 (Director Mode)】
当前场景：大家正在群里聊天。
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
- **表情包**: 必须使用格式 \`[[SEND_EMOJI: 表情名称]]\`。**可用表情 (按分类)**: ${emojiContextStr}
- **气泡分段**: 在一条内容里用换行符分隔不同的气泡——一行一个气泡。短句多发几条 > 长句一坨。

#### 六点五、群事件感知与群名片
- 聊天记录里的 \`[系统通知]\` 是真实发生的群事件（群名称被修改、某人被禁言/解除禁言、被授予头衔、被移出群聊、有人改了群名片等）。角色应**自然地对这些事件做出反应**：吐槽新群名、恭喜拿到头衔、调侃被禁言的人、对成员被移除表示惊讶等——按各自性格来，也允许无视。
- **被【禁言中】标记的成员本轮严禁发言**——不要为该成员生成任何消息（包括表情包）。其他成员可以提到ta、调侃ta只能干瞪眼。
- **群名片**: 角色可以根据自己当下的心情或剧情发展修改自己的群名片，格式 \`[[SET_NICKNAME: 新群名片]]\`（可与一句发言放在同一条 content 里）。**低频使用**——只有真的有理由（心情变化、玩梗、重大剧情节点、跟风改名）才改，不要每轮都改。改完群里所有人都会看到系统通知。

#### 七、私聊感知（避免说错话）
- 检查每个角色的 [私聊空窗期]。如果某角色刚刚才私聊过用户，哪怕群里很冷清，也不能说"好久不见"或表现出疏离感。
- 但参考"对话质量"——不要因为私聊状态就给出套路化反应。

### 输出格式 (JSON Array)
[
  {
    "charId": "角色的ID",
    "content": "发言内容... (可以是文本、[[SEND_EMOJI: name]] 或 [[PRIVATE: content]])"
  },
  ...
]
`;

            // 当本轮有要附带的图片时，user 消息走结构化 content（text + image_url），
            // 否则保持原来的纯文本，避免对不支持多模态字段的端点产生兼容问题。
            const userMessageContent: any = attachedImages.length > 0
                ? [
                    { type: 'text', text: prompt },
                    ...attachedImages.map(img => ({ type: 'image_url', image_url: { url: img.url } })),
                  ]
                : prompt;
            const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify({
                    model: apiConfig.model,
                    messages: [{ role: "user", content: userMessageContent }],
                    temperature: 0.9, // High creativity for banter
                    max_tokens: 8000
                })
            });

            if (!response.ok) throw new Error('Director Failed');

            const data = await safeResponseJson(response);

            // Token 统计：从导演响应里读 usage（兼容 OpenAI 兼容接口的标准字段）
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

            let jsonStr = data.choices[0].message.content;
            
            jsonStr = jsonStr.replace(/```json/g, '').replace(/```/g, '').trim();
            const firstBracket = jsonStr.indexOf('[');
            const lastBracket = jsonStr.lastIndexOf(']');
            if (firstBracket !== -1 && lastBracket !== -1) {
                jsonStr = jsonStr.substring(firstBracket, lastBracket + 1);
            }

            let actions = [];
            try {
                actions = JSON.parse(jsonStr);
                if (!Array.isArray(actions)) actions = [];
            } catch (e) {
                console.error("Director Parse Error", jsonStr);
            }

            // Execute Actions with Splitting Logic
            // liveGroup：本轮执行期间的最新群状态（角色改群名片会就地更新，避免读到陈旧 state）
            let liveGroup: GroupProfile = activeGroup;
            let groupChanged = false;
            for (const action of actions) {
                const targetId = activeGroup.members.find(id => id === action.charId);
                if (!targetId) continue;
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
                    // 只取最后一个（一轮多次改名没意义）
                    const newNick = nickMatches[nickMatches.length - 1][1].trim().slice(0, 24);
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
                            content: `「${oldDisplay}」将自己的群名片改为「${newNick}」`,
                        } as any);
                        setMessages(await DB.getGroupMessages(liveGroup.id));
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
                    const visibleCats = categories.filter(c => {
                        if (!c.allowedCharacterIds || c.allowedCharacterIds.length === 0) return true;
                        return c.allowedCharacterIds.includes(targetId);
                    });
                    const hiddenCatIds = new Set(categories.filter(c => !visibleCats.some(vc => vc.id === c.id)).map(c => c.id));
                    if (hiddenCatIds.size === 0) return emojis;
                    return emojis.filter(e => !e.categoryId || !hiddenCatIds.has(e.categoryId));
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

                // 2. Text Splitting (Standard Chat Logic)
                // Remove the emoji tag if it was processed, or just clean up
                let textContent = action.content.replace(/\[\[SEND_EMOJI:.*?\]\]/g, '').trim();
                
                if (textContent) {
                    // Primary: split on line breaks
                    let chunks = textContent.split(/(?:\r\n|\r|\n|\u2028|\u2029)+/)
                        .map((c: string) => c.trim())
                        .filter((c: string) => c.length > 0);

                    // Fallback: split on spaces between CJK characters (中文里空格=AI想换行)
                    if (chunks.length <= 1 && textContent.trim().length > 50) {
                        // No lookbehind (?<=): iOS Safari <16.4 JSC doesn't support it; old
                        // devices throw "invalid group specifier name" at new RegExp. Capture the
                        // left char (full punct set) + zero-width lookahead on the right (Han only),
                        // mark split points with \x01, restore left char via $1. Left/right sets
                        // differ, so they can't be merged. Byte-equivalent (see lookbehindFree.test.ts).
                        const SPLIT = String.fromCharCode(1);
                        chunks = textContent
                            .replace(/([\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef\u2000-\u206f\u2e80-\u2eff\u3001-\u3003\u2018-\u201f\u300a-\u300f\uff01-\uff0f\uff1a-\uff20])\s+(?=[\u4e00-\u9fff\u3400-\u4dbf])/g, `$1${SPLIT}`)
                            .split(SPLIT)
                            .map((c: string) => c.trim())
                            .filter((c: string) => c.length > 0);
                    }

                    if (chunks.length === 0) chunks.push(textContent); // Fallback

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

        } catch (e: any) {
            console.error(e);
        } finally {
            setIsTyping(false);
            // 群记忆宫殿：fire-and-forget，水位线/阈值/异常都在内部 swallow，不影响主流程
            // groupMembers 在 try 块内声明，这里在 finally 重新解析
            if (activeGroup) {
                const groupForPalace = activeGroup;
                // 读 ref 拿最新 characters，否则群里有成员在回复中途被用户关掉 palace
                // 时，下面这一次还是会按"那时还有人启用"的旧状态去触发 LLM 提取
                const liveCharacters = charactersRef.current;
                const membersForPalace = liveCharacters.filter(c => groupForPalace.members.includes(c.id));
                const hasAnyEnabled = membersForPalace.some(m => m.memoryPalaceEnabled);
                if (hasAnyEnabled) {
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
                }
            }
        }
    };

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
            <div className="h-full w-full bg-[#faf9f6] scrap-panel flex flex-col font-light">
                {/* safe-top spacer 透明 + backdrop-blur，下方容器/list bubbles 透出+模糊（跟 iOS 系统 status bar 一致），避免 header 白 bg 在刘海下铺一条突兀白带 */}
                <div className="shrink-0 z-10 sticky top-0">
                    <div className="bg-transparent backdrop-blur-xl" style={{ height: 'var(--safe-top)' }} />
                    <div className="bg-white/70 backdrop-blur-md flex items-end pb-3 px-4 border-b border-white/40 h-20">
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
                    <span className="font-medium text-slate-700 text-lg tracking-wide pl-2">{hubTab === 'chats' ? '聊天' : hubTab === 'contacts' ? '联系人' : '此刻'}</span>
                    <div className="flex-1"></div>
                    {hubTab !== 'moments' && (
                        <div className="relative">
                            <button onClick={() => setShowPlusMenu(v => !v)} className="p-2 -mr-2 text-[#2b2933] scrap-btn-paper transition-colors" title="添加">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                            </button>
                            {showPlusMenu && (
                                <>
                                    {/* 点空白处收起菜单 */}
                                    <div className="fixed inset-0 z-40" onClick={() => setShowPlusMenu(false)} />
                                    <div className="absolute right-0 top-full mt-2 z-50 w-40 bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden animate-fade-in">
                                        <button
                                            onClick={() => { setShowPlusMenu(false); setModalType('add-friend'); }}
                                            className="w-full px-4 py-3 flex items-center gap-2.5 text-sm text-slate-700 hover:bg-[#f4f1ea] active:bg-[#ece7dc] transition-colors"
                                        >
                                            <AddressBook size={18} className="text-[#2b2933] shrink-0" />
                                            添加好友
                                        </button>
                                        <div className="h-px bg-slate-100 mx-3" />
                                        <button
                                            onClick={() => { setShowPlusMenu(false); setModalType('create'); setSelectedMembers(new Set()); setTempGroupName(''); setTempOwnerId('user'); setTempAdminIds(new Set()); }}
                                            className="w-full px-4 py-3 flex items-center gap-2.5 text-sm text-slate-700 hover:bg-[#f4f1ea] active:bg-[#ece7dc] transition-colors"
                                        >
                                            <UsersThree size={18} className="text-[#2b2933] shrink-0" />
                                            创建群聊
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
                    <div className="scrap-list flex-1 p-3 space-y-2 overflow-y-auto">
                        {convos.map(cv => {
                            if (cv.kind === 'group') {
                                const g = groups.find(x => x.id === cv.id);
                                return (
                                    <div
                                        key={`g-${cv.id}`}
                                        onClick={() => { if (g) { setActiveGroup(g); setView('chat'); } }}
                                        className={`scrap-card p-3.5 rounded-2xl flex items-center gap-3 active:scale-[0.98] transition-all cursor-pointer hover:bg-[#f7f4ee] ${cv.dissolved ? 'opacity-70' : ''}`}
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
                                                <span className={`font-bold truncate text-sm ${cv.dissolved ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{cv.name}</span>
                                                <UsersThree size={12} className="text-slate-300 shrink-0" />
                                                <span className="text-[9px] text-slate-300 shrink-0">{cv.memberCount}</span>
                                            </div>
                                            {cv.dissolved ? (
                                                <div className="text-[11px] text-red-400/80 mt-0.5 font-medium">此群聊已被解散</div>
                                            ) : (
                                                <div className="text-[11px] text-slate-400 mt-0.5 truncate">{previewOf(cv.last)}</div>
                                            )}
                                        </div>
                                        <div className="flex flex-col items-end gap-1 shrink-0">
                                            <span className="text-[9px] text-slate-300">{formatConvoTime(cv.last?.timestamp)}</span>
                                            {cv.dissolved && (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); handleDeleteGroup(cv.id); }}
                                                    className="text-[9px] px-2 py-0.5 rounded-full bg-red-50 text-red-400 border border-red-100 hover:bg-red-100"
                                                >删除</button>
                                            )}
                                        </div>
                                    </div>
                                );
                            }
                            return (
                                <div
                                    key={`c-${cv.id}`}
                                    onClick={() => openPrivateChat(cv.id)}
                                    className="scrap-card p-3.5 rounded-2xl flex items-center gap-3 active:scale-[0.98] transition-all cursor-pointer hover:bg-[#f7f4ee]"
                                >
                                    <img src={cv.avatar} className="w-12 h-12 rounded-full object-cover border border-slate-100 shadow-sm shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <div className="font-bold text-slate-700 truncate text-sm">{cv.name}</div>
                                        <div className="text-[11px] text-slate-400 mt-0.5 truncate">{previewOf(cv.last)}</div>
                                    </div>
                                    <span className="text-[9px] text-slate-300 shrink-0">{formatConvoTime(cv.last?.timestamp)}</span>
                                </div>
                            );
                        })}
                        {convos.length === 0 && (
                            <div className="text-center text-slate-400 text-xs py-10 flex flex-col items-center gap-2">
                                <ChatsTeardrop size={36} className="opacity-50" />
                                还没有任何会话。去「联系人」找个角色开聊，或点右上角创建群聊。
                            </div>
                        )}
                    </div>
                )}

                {/* ── 联系人 tab：全部角色 ── */}
                {hubTab === 'contacts' && (
                    <div className="scrap-list flex-1 p-3 space-y-2 overflow-y-auto">
                        {characters.map(c => (
                            <div key={c.id} onClick={() => openPrivateChat(c.id)} className="scrap-card p-3.5 rounded-2xl flex items-center gap-3 active:scale-[0.98] transition-all cursor-pointer hover:bg-[#f7f4ee]">
                                <img src={c.convoSettings?.charAvatarOverride || c.avatar} className="w-12 h-12 rounded-full object-cover border border-slate-100 shadow-sm shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <div className="font-bold text-slate-700 truncate text-sm">{c.convoSettings?.remarkName?.trim() || c.name}</div>
                                    {(c as any).bio && <div className="text-[11px] text-slate-400 mt-0.5 truncate">{(c as any).bio}</div>}
                                </div>
                                <button
                                    onClick={(e) => { e.stopPropagation(); openCharacterSettings(c.id); }}
                                    className="p-2 rounded-full text-slate-400 hover:text-[#2b2933] hover:bg-[#f4f1ea] transition-colors shrink-0"
                                    title="角色设置"
                                >
                                    <GearSix size={18} weight="bold" />
                                </button>
                            </div>
                        ))}
                        {characters.length === 0 && (
                            <div className="text-center text-slate-400 text-xs py-10">还没有角色</div>
                        )}
                    </div>
                )}

                {/* ── 朋友圈 tab：内嵌完整朋友圈（与独立 朋友圈 App 共用 MomentsFeed） ── */}
                {hubTab === 'moments' && (
                    <div className="flex-1 min-h-0 overflow-hidden">
                        <MomentsFeed embedded backHandlerRef={momentsBackRef} />
                    </div>
                )}

                {/* ── 底部导航：聊天 / 联系人 / 朋友圈 ── */}
                <div className="shrink-0 bg-white/85 backdrop-blur-md border-t border-dashed border-[#d9d4c8] pb-safe">
                    <div className="grid grid-cols-3">
                        <button onClick={() => setHubTab('chats')} className={`flex flex-col items-center gap-0.5 py-2.5 transition-colors ${hubTab === 'chats' ? 'text-[#2b2933]' : 'text-slate-400'}`}>
                            <ChatsTeardrop size={22} weight={hubTab === 'chats' ? 'fill' : 'regular'} />
                            <span className="text-[10px] font-bold">聊天</span>
                        </button>
                        <button onClick={() => setHubTab('contacts')} className={`flex flex-col items-center gap-0.5 py-2.5 transition-colors ${hubTab === 'contacts' ? 'text-[#2b2933]' : 'text-slate-400'}`}>
                            <AddressBook size={22} weight={hubTab === 'contacts' ? 'fill' : 'regular'} />
                            <span className="text-[10px] font-bold">联系人</span>
                        </button>
                        <button onClick={() => setHubTab('moments')} className={`flex flex-col items-center gap-0.5 py-2.5 transition-colors ${hubTab === 'moments' ? 'text-[#2b2933]' : 'text-slate-400'}`}>
                            <Planet size={22} weight={hubTab === 'moments' ? 'fill' : 'regular'} />
                            <span className="text-[10px] font-bold">此刻</span>
                        </button>
                    </div>
                </div>

                <Modal isOpen={modalType === 'create'} title="创建群聊" onClose={() => setModalType('none')} footer={<button onClick={handleCreateGroup} className="w-full py-3 bg-[#2b2933] text-white font-bold rounded-2xl shadow-lg shadow-slate-300/70">创建</button>}>
                    <div className="space-y-4">
                        <input value={tempGroupName} onChange={e => setTempGroupName(e.target.value)} placeholder="群聊名称" className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-slate-400/20 transition-all" />
                        <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block">选择成员</label>
                            <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto pr-1">
                                {characters.map(c => (
                                    <div key={c.id} onClick={() => toggleMemberSelection(c.id)} className={`flex flex-col items-center gap-1 p-2 rounded-xl border transition-all cursor-pointer ${selectedMembers.has(c.id) ? 'border-[#2b2933] bg-[#f4f1ea] ring-1 ring-[#2b2933]' : 'border-slate-100 bg-white hover:border-slate-300'}`}>
                                        <img src={c.avatar} className="w-10 h-10 rounded-full object-cover" />
                                        <span className="text-[9px] text-slate-600 truncate w-full text-center font-medium">{c.name}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block">群主</label>
                            <div className="flex flex-wrap gap-2">
                                <button
                                    onClick={() => setTempOwnerId('user')}
                                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${tempOwnerId === 'user' ? 'border-amber-400 bg-amber-50 text-amber-600 ring-1 ring-amber-400' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'}`}
                                >
                                    👑 我自己
                                </button>
                                {Array.from(selectedMembers).map(id => {
                                    const c = characters.find(ch => ch.id === id);
                                    if (!c) return null;
                                    return (
                                        <button
                                            key={id}
                                            onClick={() => {
                                                setTempOwnerId(id);
                                                // 群主天然有管理员权限，从管理员列表中移除
                                                if (tempAdminIds.has(id)) {
                                                    const admins = new Set(tempAdminIds);
                                                    admins.delete(id);
                                                    setTempAdminIds(admins);
                                                }
                                            }}
                                            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${tempOwnerId === id ? 'border-amber-400 bg-amber-50 text-amber-600 ring-1 ring-amber-400' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'}`}
                                        >
                                            {tempOwnerId === id ? '👑 ' : ''}{c.name}
                                        </button>
                                    );
                                })}
                            </div>
                            {selectedMembers.size === 0 && <p className="text-[10px] text-slate-300 mt-1.5">先选择成员，即可把任意角色设为群主</p>}
                        </div>
                        {selectedMembers.size > 0 && (
                            <div>
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block">管理员（可多选）</label>
                                <div className="flex flex-wrap gap-2">
                                    {Array.from(selectedMembers).filter(id => id !== tempOwnerId).map(id => {
                                        const c = characters.find(ch => ch.id === id);
                                        if (!c) return null;
                                        return (
                                            <button
                                                key={id}
                                                onClick={() => toggleAdminSelection(id)}
                                                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${tempAdminIds.has(id) ? 'border-[#2b2933] bg-[#f4f1ea] text-[#2b2933] ring-1 ring-[#2b2933]' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'}`}
                                            >
                                                {tempAdminIds.has(id) ? '🛡 ' : ''}{c.name}
                                            </button>
                                        );
                                    })}
                                    {Array.from(selectedMembers).filter(id => id !== tempOwnerId).length === 0 && (
                                        <p className="text-[10px] text-slate-300">没有可设为管理员的成员（群主天然拥有管理员权限）</p>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </Modal>

                {/* 添加好友：弹窗选择角色，直接进入与该角色的会话（不跳角色设置）。
                    把你拉黑的角色 → 需先发送好友验证，由 TA 决定是否拉回 */}
                <Modal isOpen={modalType === 'add-friend'} title="选择要添加的角色" onClose={() => setModalType('none')}>
                    <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
                        {characters.map(c => {
                            const blockedByChar = !!c.charBlock?.active;
                            return (
                                <button
                                    key={c.id}
                                    onClick={() => {
                                        setModalType('none');
                                        if (blockedByChar) setVerifyCharId(c.id);
                                        else openPrivateChat(c.id);
                                    }}
                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center gap-3 text-left hover:border-slate-400 hover:bg-[#f7f4ee] active:scale-[0.98] transition-all"
                                >
                                    <img src={c.avatar} className={`w-9 h-9 rounded-full object-cover shrink-0 ${blockedByChar ? 'grayscale' : ''}`} />
                                    <span className="text-sm text-slate-700 font-medium truncate flex-1">{c.name}</span>
                                    {blockedByChar && (
                                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-50 text-red-400 border border-red-100 font-bold shrink-0">已把你拉黑 · 需验证</span>
                                    )}
                                </button>
                            );
                        })}
                        {characters.length === 0 && (
                            <div className="text-center text-slate-400 text-xs py-8">还没有角色，先去「角色」App 创建一个吧</div>
                        )}
                    </div>
                </Modal>

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
        <div className="h-full w-full bg-[#f0f4f8] flex flex-col font-sans relative">
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
                            border: '1px solid rgba(139,92,246,0.22)',
                            boxShadow: '0 6px 18px -6px rgba(15,23,42,0.22)',
                        }}
                    >
                        <span
                            className="shrink-0 inline-block w-3.5 h-3.5 rounded-full border-2 border-slate-200 animate-spin"
                            style={{ borderTopColor: '#8b5cf6', animationDuration: '0.9s' }}
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
            <div className="bg-transparent backdrop-blur-xl" style={{ height: 'var(--safe-top)' }} />
            <div className="bg-white/80 backdrop-blur-xl px-5 flex items-end pb-4 border-b border-slate-200/60 shadow-sm h-24">
                {selectionMode ? (
                    <div className="flex items-center justify-between w-full">
                        <button onClick={() => { setSelectionMode(false); setSelectedMsgIds(new Set()); }} className="text-sm font-bold text-slate-500 px-2 py-1">取消</button>
                        <span className="text-sm font-bold text-slate-800">已选 {selectedMsgIds.size} 项</span>
                        <div className="w-10"></div>
                    </div>
                ) : (
                    <div className="flex items-center gap-3 w-full">
                        <button onClick={() => setView('list')} className="p-2 -ml-2 rounded-full hover:bg-slate-100 active:bg-slate-200 transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 text-slate-600"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
                        </button>
                        <div className="flex-1 min-w-0" onClick={() => { setTempGroupName(activeGroup?.name || ''); setTempPrivateContextCap(activeGroup?.privateContextCap ?? 80); setTempMyNickname(activeGroup?.memberNicknames?.['user'] || ''); setModalType('settings'); }}>
                            <h1 className="text-base font-bold text-slate-800 truncate flex items-center gap-1">
                                {activeGroup?.name}
                                {activeGroup?.dissolved && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-50 text-red-400 border border-red-100 font-bold shrink-0">已解散</span>}
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 text-slate-400"><path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" /></svg>
                            </h1>
                            <div className="flex items-center gap-2">
                                <p className="text-[10px] text-slate-500 font-medium">{activeGroup?.members.length} 成员</p>
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
                                className="p-2 rounded-full bg-slate-100 text-slate-500 hover:text-[#2b2933] transition-colors"
                                title="重新生成回复"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>
                            </button>
                        )}

                        {/* 群设置入口（原 + 面板里的「群设置」迁移到右上角；⚡手动触发已删除——空输入回车/发送即触发） */}
                        <button
                            onClick={() => {
                                setTempGroupName(activeGroup?.name || '');
                                setTempPrivateContextCap(activeGroup?.privateContextCap ?? 80);
                                setTempMyNickname(activeGroup?.memberNicknames?.['user'] || '');
                                setModalType('settings');
                            }}
                            className="p-2 rounded-full bg-slate-100 text-slate-500 hover:text-[#2b2933] transition-all active:scale-90"
                            title="群设置"
                        >
                            <GearSix size={20} weight="bold" />
                        </button>
                    </div>
                )}
            </div>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 no-scrollbar space-y-2 bg-[#f0f4f8]" ref={scrollRef}>
                {totalMsgCount > messages.length && activeGroup && (
                    <div className="flex justify-center mb-4">
                        <button onClick={async () => {
                            const { messages: moreMsgs, totalCount } = await DB.getRecentGroupMessagesWithCount(activeGroup.id, messages.length + 30);
                            setMessages(moreMsgs);
                            setTotalMsgCount(totalCount);
                            setVisibleCount(moreMsgs.length);
                        }} className="px-4 py-2 bg-white/50 backdrop-blur-sm rounded-full text-xs text-slate-500 shadow-sm border border-white hover:bg-white transition-colors">
                            加载历史消息 ({totalMsgCount - messages.length})
                        </button>
                    </div>
                )}
                {displayMessages.map((m, i) => {
                    const isUser = m.role === 'user';
                    const char = characters.find(c => c.id === m.charId);

                    return (
                        <GroupMessageItem
                            key={m.id || i}
                            msg={m}
                            isUser={isUser}
                            char={char}
                            userAvatar={userProfile.avatar}
                            onImageClick={(url) => window.open(url, '_blank')}
                            selectionMode={selectionMode}
                            isSelected={selectedMsgIds.has(m.id)}
                            onToggleSelect={toggleMessageSelection}
                            onLongPress={handleMessageLongPress}
                            displayName={char ? displayNameOf(activeGroup, char.id) : undefined}
                            memberTitle={char ? activeGroup?.memberTitles?.[char.id] : undefined}
                            onAvatarClick={char ? () => { setProfileMemberId(char.id); setTempTitle(activeGroup?.memberTitles?.[char.id] || ''); setConfirmRemoveId(null); setModalType('member-profile'); } : undefined}
                            onAvatarPoke={char ? () => handlePokeMember(char.id) : undefined}
                        />
                    );
                })}
                {isTyping && (
                    <div className="flex items-center gap-2 pl-4 py-2 animate-pulse opacity-70">
                        <div className="flex -space-x-1">
                            <div className="w-6 h-6 rounded-full bg-slate-300 border-2 border-white"></div>
                            <div className="w-6 h-6 rounded-full bg-slate-200 border-2 border-white"></div>
                        </div>
                        <span className="text-xs text-slate-400 font-medium">成员正在输入...</span>
                    </div>
                )}
            </div>

            {/* Redesigned Input Area (WeChat/iOS Style) */}
            <div className="bg-[#f0f2f5] border-t border-slate-200 pb-safe shrink-0 z-40 relative">
                {activeGroup?.dissolved ? (
                    <div className="p-4 text-center text-xs text-slate-400 font-medium">此群聊已被解散，仅可查看历史消息</div>
                ) : selectionMode ? (
                    <div className="p-3 flex justify-center bg-white">
                        <button 
                            onClick={deleteSelectedMessages} 
                            className="w-full py-3 bg-red-500 text-white font-bold rounded-xl shadow-lg active:scale-95 transition-transform flex items-center justify-center gap-2"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                            删除 ({selectedMsgIds.size})
                        </button>
                    </div>
                ) : (
                    <div className="p-2 flex items-end gap-2">
                        {/* Plus / Actions Button */}
                        <button 
                            onClick={() => { setShowActions(!showActions); setShowEmojiPicker(false); }}
                            className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-transform ${showActions ? 'bg-slate-300 rotate-45' : 'bg-transparent hover:bg-slate-200'}`}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-7 h-7 text-slate-600"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v6m3-3H9m12 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
                        </button>

                        {/* Input Field Container */}
                        <div className="flex-1 min-w-0 overflow-hidden bg-white rounded-xl flex items-end px-3 py-2 border border-slate-200 focus-within:border-slate-400 focus-within:ring-2 focus-within:ring-slate-200 transition-all">
                            <textarea 
                                rows={1} 
                                value={input} 
                                onChange={e => setInput(e.target.value)} 
                                onKeyDown={e => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        // 空输入回车 = 触发 AI 导演：发完消息后留空再按回车即可让成员们接话
                                        if (!input.trim()) {
                                            if (!isTyping) triggerDirector(messages);
                                            return;
                                        }
                                        handleSendMessage(input);
                                    }
                                }}
                                className="flex-1 min-w-0 bg-transparent text-[16px] outline-none resize-none max-h-28 text-slate-800 placeholder:text-slate-400 py-1"
                                placeholder="Message..." 
                                style={{ height: 'auto', minHeight: '24px' }} 
                            />
                            {/* Emoji Toggle inside input */}
                            <button 
                                onClick={() => { setShowEmojiPicker(!showEmojiPicker); setShowActions(false); }}
                                className="p-1 -mr-1 ml-1 text-slate-400 hover:text-yellow-500 transition-colors shrink-0"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M15.182 15.182a4.5 4.5 0 0 1-6.364 0M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75Zm-.375 0h.008v.015h-.008V9.75Zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75Zm-.375 0h.008v.015h-.008V9.75Z" /></svg>
                            </button>
                        </div>

                        {/* Send Button — 空输入时点击 = 触发 AI 导演让成员们接话（与空输入回车一致） */}
                        <button
                            onClick={() => {
                                if (!input.trim()) {
                                    if (!isTyping) triggerDirector(messages);
                                    return;
                                }
                                handleSendMessage(input);
                            }}
                            className={`h-9 px-4 shrink-0 rounded-xl font-bold text-sm shadow-md active:scale-95 transition-all ${input.trim() ? 'bg-[#2b2933] text-white' : 'bg-[#e7e2d8] text-[#6b6657]'}`}
                        >
                            发送
                        </button>
                    </div>
                )}

                {/* --- Action Drawer --- */}
                {showActions && (
                    <div className="h-64 bg-[#f0f2f5] border-t border-slate-200 p-6 animate-slide-up">
                        <div className="grid grid-cols-4 gap-6">
                            <button onClick={() => fileInputRef.current?.click()} className="flex flex-col items-center gap-2 group">
                                <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center shadow-sm border border-slate-200 group-active:scale-95 transition-transform">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-slate-600"><path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" /></svg>
                                </div>
                                <span className="text-xs text-slate-500">相册</span>
                            </button>
                            <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload} />

                            <button onClick={() => setModalType('transfer')} className="flex flex-col items-center gap-2 group">
                                <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center shadow-sm border border-slate-200 group-active:scale-95 transition-transform">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-orange-500"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
                                </div>
                                <span className="text-xs text-slate-500">红包</span>
                            </button>

                        </div>
                    </div>
                )}

                {/* --- Emoji Drawer --- */}
                {showEmojiPicker && (
                    <div className="h-64 bg-[#f0f2f5] border-t border-slate-200 animate-slide-up flex flex-col">
                        {/* 搜索：按名字/描述模糊匹配导入的表情包 */}
                        <div className="px-4 pt-3 pb-1 shrink-0">
                            <input
                                value={emojiSearch}
                                onChange={e => setEmojiSearch(e.target.value)}
                                placeholder="按名字或描述搜索表情…"
                                className="w-full px-3 py-1.5 text-xs rounded-full outline-none border bg-white border-slate-200 text-slate-700 placeholder:text-slate-400 focus:border-slate-400"
                            />
                        </div>
                        <div className="flex-1 p-4 pt-2 overflow-y-auto no-scrollbar">
                            <div className="grid grid-cols-5 gap-3">
                                {emojis.filter(e => {
                                    const term = emojiSearch.trim().toLowerCase();
                                    if (!term) return true;
                                    return e.name.toLowerCase().includes(term) || ((e as any).description || '').toLowerCase().includes(term);
                                }).map((e, i) => (
                                    <button key={i} onClick={() => handleSendMessage(e.url, 'emoji')} className="aspect-square bg-white rounded-xl p-2 border border-slate-200 shadow-sm active:scale-95 flex flex-col items-center justify-center" title={e.name}>
                                        <img src={e.url} className="w-full h-full object-contain pointer-events-none" />
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* --- Modals --- */}

            {/* Group Settings Modal */}
            <Modal isOpen={modalType === 'settings'} title="群组设置" onClose={() => setModalType('none')} footer={<button onClick={handleUpdateGroupInfo} className="w-full py-3 bg-[#2b2933] text-white font-bold rounded-2xl shadow-lg shadow-slate-300/70">保存修改</button>}>
                <div className="space-y-6">
                    {/* Header Info */}
                    <div className="flex justify-center">
                        <div onClick={() => groupAvatarInputRef.current?.click()} className="w-24 h-24 rounded-3xl bg-slate-100 border-2 border-dashed border-slate-300 flex items-center justify-center cursor-pointer overflow-hidden relative group hover:border-slate-400">
                            {activeGroup?.avatar ? <img src={activeGroup.avatar} className="w-full h-full object-cover opacity-90 group-hover:opacity-100" /> : <span className="text-xs text-slate-400 font-bold">更换头像</span>}
                            <div className="absolute inset-0 bg-black/20 hidden group-hover:flex items-center justify-center text-white"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z" /></svg></div>
                        </div>
                        <input type="file" ref={groupAvatarInputRef} className="hidden" accept="image/*" onChange={handleGroupAvatarUpload} />
                    </div>
                    <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block">群名称</label>
                        <input value={tempGroupName} onChange={e => setTempGroupName(e.target.value)} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:bg-white focus:border-slate-400 transition-all" />
                        <p className="text-[9px] text-slate-400 mt-1 leading-tight">修改后会在群里发系统通知，成员们都能"看到"群名变化。</p>
                    </div>

                    <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block">我的群名片</label>
                        <input value={tempMyNickname} onChange={e => setTempMyNickname(e.target.value)} placeholder={userProfile.name} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:bg-white focus:border-slate-400 transition-all" />
                        <p className="text-[9px] text-slate-400 mt-1 leading-tight">你在本群显示的昵称，留空则用默认名字。成员也会根据心情或剧情改自己的群名片。</p>
                    </div>

                    {/* 群成员管理：点成员进资料页（管理员可禁言/设头衔/移除） */}
                    <div className="pt-2 border-t border-slate-100">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block">群成员 ({activeGroup?.members.length})</label>
                        <div className="grid grid-cols-4 gap-2 max-h-40 overflow-y-auto pr-1">
                            {(activeGroup?.members || []).map(mid => {
                                const c = characters.find(ch => ch.id === mid);
                                if (!c) return null;
                                const muted = isMuted(activeGroup, mid);
                                return (
                                    <div
                                        key={mid}
                                        onClick={() => { setProfileMemberId(mid); setTempTitle(activeGroup?.memberTitles?.[mid] || ''); setConfirmRemoveId(null); setModalType('member-profile'); }}
                                        className="flex flex-col items-center gap-1 p-2 rounded-xl border border-slate-100 bg-white hover:border-slate-400 cursor-pointer transition-all relative"
                                    >
                                        <img src={c.avatar} className={`w-10 h-10 rounded-full object-cover ${muted ? 'grayscale opacity-60' : ''}`} />
                                        {muted && <SpeakerSlash size={12} weight="fill" className="absolute top-1.5 right-1.5 text-red-400" />}
                                        <span className="text-[9px] text-slate-600 truncate w-full text-center font-medium">{displayNameOf(activeGroup, mid)}</span>
                                    </div>
                                );
                            })}
                            {userCanManage(activeGroup) && !activeGroup?.dissolved && (
                                <div onClick={() => setModalType('add-member')} className="flex flex-col items-center justify-center gap-1 p-2 rounded-xl border-2 border-dashed border-slate-200 hover:border-slate-400 cursor-pointer transition-all text-slate-300 hover:text-slate-500">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-8 h-8"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                                    <span className="text-[9px] font-medium">添加</span>
                                </div>
                            )}
                        </div>
                        <p className="text-[9px] text-slate-400 mt-2 leading-tight">点击成员查看资料；聊天里点成员头像也能进入，双击头像可以戳一戳。</p>
                    </div>

                    {/* Context Limit */}
                    <div className="pt-2 border-t border-slate-100">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block">AI 上下文条数 ({contextLimit})</label>
                        <input type="range" min="20" max="5000" step="10" value={contextLimit} onChange={e => { const v = parseInt(e.target.value); setContextLimit(v); localStorage.setItem('groupchat_context_limit', String(v)); }} className="w-full h-2 bg-slate-200 rounded-full appearance-none accent-[#2b2933]" />
                        <div className="flex justify-between text-[10px] text-slate-400 mt-1"><span>20 (省流)</span><span>5000 (超长记忆)</span></div>
                        <p className="text-[9px] text-slate-400 mt-1 leading-tight">控制每次触发AI导演时发送的群聊历史消息数量。越多上下文越丰富，但消耗更多token。</p>
                    </div>

                    {/* Private Chat Group Context Cap */}
                    <div className="pt-2 border-t border-slate-100">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block">私聊里"近期群活动"取条数 ({tempPrivateContextCap})</label>
                        <input type="range" min="20" max="500" step="10" value={tempPrivateContextCap} onChange={e => setTempPrivateContextCap(parseInt(e.target.value))} className="w-full h-2 bg-slate-200 rounded-full appearance-none accent-[#2b2933]" />
                        <div className="flex justify-between text-[10px] text-slate-400 mt-1"><span>20 (省流)</span><span>500 (完整)</span></div>
                        <p className="text-[9px] text-slate-400 mt-1 leading-tight">本群成员在自己的私聊里，最多看到本群最近多少条消息作为"近期群活动"上下文。每个群独立配额，避免活跃群把安静群挤掉。</p>
                    </div>

                    {/* Memory & Context Management */}
                    <div className="pt-2 border-t border-slate-100">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 block">群聊记忆 (Neural Link)</label>

                        {/* Prompt Selection */}
                        <div className="bg-indigo-50/50 p-3 rounded-xl border border-indigo-100 mb-3">
                            <label className="text-[9px] font-bold text-indigo-400 uppercase mb-2 block">选择总结提示词</label>
                            <div className="flex flex-col gap-1.5">
                                {archivePrompts.map(p => (
                                    <div key={p.id} onClick={() => setSelectedPromptId(p.id)} className={`px-3 py-2 rounded-lg border cursor-pointer text-xs font-bold transition-all ${selectedPromptId === p.id ? 'bg-white border-indigo-400 text-indigo-700 shadow-sm' : 'bg-white/50 border-indigo-100 text-slate-500 hover:bg-white'}`}>
                                        {p.name}
                                    </div>
                                ))}
                            </div>
                            <p className="text-[8px] text-indigo-300 mt-2 leading-tight">提示词与聊天-归档共享，可在聊天设置中自定义。</p>
                        </div>

                        <button onClick={handleGroupSummary} disabled={isSummarizing} className="w-full py-3 bg-indigo-50 text-indigo-600 font-bold rounded-2xl border border-indigo-100 active:scale-95 transition-transform flex items-center justify-center gap-2 mb-2">
                            {isSummarizing ? (
                                <><div className="w-4 h-4 border-2 border-indigo-200 border-t-indigo-500 rounded-full animate-spin"></div><span className="text-xs">{summaryProgress || '处理中...'}</span></>
                            ) : (
                                <><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" /></svg> 生成总结并同步到全员记忆</>
                            )}
                        </button>
                        <p className="text-[9px] text-slate-400 leading-tight px-1">使用选中的提示词风格生成群聊总结，并作为记忆植入到所有群成员的大脑中。</p>
                    </div>

                    {/* Danger Zone */}
                    <div className="pt-2 border-t border-slate-100">
                        <label className="text-[10px] font-bold text-red-400 uppercase tracking-widest mb-3 block">危险区域</label>
                        
                        <div className="flex items-center gap-2 mb-3 cursor-pointer" onClick={() => setPreserveContext(!preserveContext)}>
                             <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-colors ${preserveContext ? 'bg-[#2b2933] border-[#2b2933]' : 'bg-slate-100 border-slate-300'}`}>
                                 {preserveContext && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>}
                             </div>
                             <span className="text-xs text-slate-600">清空时保留最后10条记录 (维持语境)</span>
                        </div>

                        <div className="flex gap-2">
                            <button onClick={handleClearHistory} className="flex-1 py-3 bg-red-50 text-red-500 font-bold rounded-2xl border border-red-100 active:scale-95 transition-transform flex items-center justify-center gap-2 text-xs">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                                清空聊天
                            </button>
                            <button onClick={() => { if(activeGroup) handleDissolveGroup(activeGroup.id); }} className="flex-1 py-3 text-white bg-red-500 hover:bg-red-600 rounded-2xl text-xs font-bold transition-colors shadow-lg shadow-red-200">解散群聊</button>
                        </div>
                    </div>
                </div>
            </Modal>

            {/* Message Options Modal */}
            <Modal isOpen={modalType === 'message-options'} title="消息操作" onClose={() => { setModalType('none'); setSelectedMessage(null); }}>
                <div className="space-y-3">
                    <button onClick={handleEnterSelectionMode} className="w-full py-3 bg-slate-50 text-slate-700 font-medium rounded-2xl active:bg-slate-100 transition-colors flex items-center justify-center gap-2">
                        多选 / 批量删除
                    </button>
                    {selectedMessage?.type === 'text' && (
                        <button onClick={handleCopyMessage} className="w-full py-3 bg-slate-50 text-slate-700 font-medium rounded-2xl active:bg-slate-100 transition-colors flex items-center justify-center gap-2">
                            复制文字
                        </button>
                    )}
                    {selectedMessage?.type === 'text' && (
                        <button onClick={handleStartEditMessage} className="w-full py-3 bg-slate-50 text-slate-700 font-medium rounded-2xl active:bg-slate-100 transition-colors flex items-center justify-center gap-2">
                            修改内容
                        </button>
                    )}
                    <button onClick={handleDeleteSingleMessage} className="w-full py-3 bg-red-50 text-red-500 font-medium rounded-2xl active:bg-red-100 transition-colors flex items-center justify-center gap-2">
                        删除消息
                    </button>
                </div>
            </Modal>

            {/* Edit Message Modal */}
            <Modal
                isOpen={modalType === 'edit-message'} title="编辑内容" onClose={() => { setModalType('none'); setSelectedMessage(null); }}
                footer={<><button onClick={() => { setModalType('none'); setSelectedMessage(null); }} className="flex-1 py-3 bg-slate-100 rounded-2xl">取消</button><button onClick={confirmEditMessage} className="flex-1 py-3 bg-primary text-white font-bold rounded-2xl">保存</button></>}
            >
                <textarea
                    value={editContent}
                    onChange={e => setEditContent(e.target.value)}
                    className="w-full h-32 bg-slate-100 rounded-2xl p-4 resize-none focus:ring-1 focus:ring-primary/20 transition-all text-sm leading-relaxed"
                />
            </Modal>

            {/* Transfer Modal */}
            <Modal isOpen={modalType === 'transfer'} title="发送红包" onClose={() => setModalType('none')} footer={<button onClick={() => { handleSendMessage(`[红包] ${transferAmount} Credits`, 'transfer', { amount: transferAmount }); setModalType('none'); }} className="w-full py-3 bg-orange-500 text-white font-bold rounded-2xl shadow-lg shadow-orange-200">塞进红包</button>}>
                <div className="space-y-4">
                    <div className="text-center py-4 animate-bounce"><img src={twemojiUrl('1f9e7')} alt="red envelope" className="w-12 h-12 mx-auto" /></div>
                    <input type="number" value={transferAmount} onChange={e => setTransferAmount(e.target.value)} placeholder="金额" className="w-full px-4 py-4 bg-slate-100 rounded-2xl text-center text-2xl font-bold outline-none text-slate-800 placeholder:text-slate-300" autoFocus />
                </div>
            </Modal>

            {/* 成员资料 Modal —— 点头像进入；管理员/群主多出禁言、头衔、移除 */}
            {(() => {
                const member = profileMemberId ? characters.find(c => c.id === profileMemberId) : null;
                if (!member) return (
                    <Modal isOpen={modalType === 'member-profile'} title="成员资料" onClose={() => { setModalType('none'); setProfileMemberId(null); }}>
                        <div className="text-center text-xs text-slate-400 py-6">成员不存在</div>
                    </Modal>
                );
                const nickname = activeGroup?.memberNicknames?.[member.id];
                const title = activeGroup?.memberTitles?.[member.id];
                const muted = isMuted(activeGroup, member.id);
                const mutedUntilTs = activeGroup?.mutedUntil?.[member.id];
                const canManage = userCanManage(activeGroup) && !activeGroup?.dissolved;
                return (
                    <Modal isOpen={modalType === 'member-profile'} title="成员资料" onClose={() => { setModalType('none'); setProfileMemberId(null); }}>
                        <div className="space-y-4">
                            <div className="flex flex-col items-center gap-2 py-2">
                                <img src={member.avatar} className={`w-20 h-20 rounded-3xl object-cover shadow-md border-2 border-white ${muted ? 'grayscale' : ''}`} />
                                <div className="flex items-center gap-1.5">
                                    {title && <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-600 border border-amber-200 text-[9px] font-bold flex items-center gap-0.5"><Crown size={9} weight="fill" />{title}</span>}
                                    <span className="font-bold text-slate-800 text-base">{nickname || member.name}</span>
                                </div>
                                {nickname && <span className="text-[10px] text-slate-400">角色名：{member.name}</span>}
                                {muted && mutedUntilTs && (
                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-50 text-red-400 border border-red-100 flex items-center gap-1">
                                        <SpeakerSlash size={10} weight="fill" />
                                        禁言中，至 {new Date(mutedUntilTs).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                )}
                            </div>

                            <div className="grid grid-cols-3 gap-2">
                                <button onClick={() => { setModalType('none'); setProfileMemberId(null); openPrivateChat(member.id); }} className="py-3 bg-[#f4f1ea] text-[#2b2933] font-bold rounded-2xl border border-[#e7e2d8] active:scale-95 transition-transform text-xs flex flex-col items-center gap-1">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" /></svg>
                                    发消息
                                </button>
                                <button onClick={() => handlePokeMember(member.id)} disabled={!!activeGroup?.dissolved} className="py-3 bg-sky-50 text-sky-600 font-bold rounded-2xl border border-sky-100 active:scale-95 transition-transform text-xs flex flex-col items-center gap-1 disabled:opacity-40">
                                    <HandPointing size={20} weight="bold" />
                                    戳一戳
                                </button>
                                <button onClick={() => { setModalType('none'); setProfileMemberId(null); openCharacterSettings(member.id); }} className="py-3 bg-slate-50 text-slate-600 font-bold rounded-2xl border border-slate-200 active:scale-95 transition-transform text-xs flex flex-col items-center gap-1">
                                    <GearSix size={20} weight="bold" />
                                    角色设置
                                </button>
                            </div>

                            {canManage && (
                                <div className="pt-3 border-t border-slate-100 space-y-2">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">管理操作（{isUserOwner(activeGroup) ? '群主' : '管理员'}）</label>
                                    <div className="grid grid-cols-2 gap-2">
                                        <button onClick={() => { setTempTitle(title || ''); setModalType('set-title'); }} className="py-2.5 bg-amber-50 text-amber-600 font-bold rounded-xl border border-amber-100 active:scale-95 transition-transform text-xs flex items-center justify-center gap-1.5">
                                            <Crown size={14} weight="bold" /> 设置头衔
                                        </button>
                                        <button onClick={() => setModalType('mute-member')} className="py-2.5 bg-orange-50 text-orange-600 font-bold rounded-xl border border-orange-100 active:scale-95 transition-transform text-xs flex items-center justify-center gap-1.5">
                                            <SpeakerSlash size={14} weight="bold" /> {muted ? '禁言管理' : '禁言此成员'}
                                        </button>
                                    </div>
                                    <button
                                        onClick={() => {
                                            if (confirmRemoveId === member.id) { handleRemoveMember(member.id); setConfirmRemoveId(null); }
                                            else setConfirmRemoveId(member.id);
                                        }}
                                        className={`w-full py-2.5 font-bold rounded-xl border active:scale-95 transition-all text-xs ${confirmRemoveId === member.id ? 'bg-red-500 text-white border-red-500 shadow-lg shadow-red-200' : 'bg-red-50 text-red-500 border-red-100'}`}
                                    >
                                        {confirmRemoveId === member.id ? '再点一次确认移除' : '移出群聊'}
                                    </button>
                                </div>
                            )}
                        </div>
                    </Modal>
                );
            })()}

            {/* 设置头衔 Modal */}
            <Modal
                isOpen={modalType === 'set-title'} title="设置头衔" onClose={() => setModalType('member-profile')}
                footer={<div className="flex gap-2 w-full">
                    <button onClick={() => { setTempTitle(''); }} className="flex-1 py-3 bg-slate-100 text-slate-500 font-bold rounded-2xl">清空</button>
                    <button onClick={handleSetTitle} className="flex-1 py-3 bg-amber-500 text-white font-bold rounded-2xl shadow-lg shadow-amber-200">保存</button>
                </div>}
            >
                <div className="space-y-3">
                    <p className="text-xs text-slate-400">头衔会显示在该成员名字旁边，群里所有人（包括角色自己）都能看到。清空保存即撤销头衔。</p>
                    <input value={tempTitle} onChange={e => setTempTitle(e.target.value)} maxLength={12} placeholder="例如：气氛担当 / 沙发王" className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:bg-white focus:border-amber-300 transition-all" autoFocus />
                </div>
            </Modal>

            {/* 添加成员 Modal */}
            <Modal isOpen={modalType === 'add-member'} title="添加成员" onClose={() => setModalType('settings')}>
                <div className="space-y-3">
                    {(() => {
                        const candidates = characters.filter(c => !activeGroup?.members.includes(c.id));
                        if (candidates.length === 0) return <p className="text-xs text-slate-400 text-center py-6">所有角色都已在群里</p>;
                        return (
                            <div className="grid grid-cols-4 gap-2 max-h-60 overflow-y-auto pr-1">
                                {candidates.map(c => (
                                    <div key={c.id} onClick={() => handleAddMember(c.id)} className="flex flex-col items-center gap-1 p-2 rounded-xl border border-slate-100 bg-white hover:border-slate-400 cursor-pointer transition-all">
                                        <img src={c.avatar} className="w-10 h-10 rounded-full object-cover" />
                                        <span className="text-[9px] text-slate-600 truncate w-full text-center font-medium">{c.name}</span>
                                    </div>
                                ))}
                            </div>
                        );
                    })()}
                </div>
            </Modal>

            {/* 禁言 Modal */}
            <Modal isOpen={modalType === 'mute-member'} title="禁言成员" onClose={() => setModalType('member-profile')}>
                <div className="space-y-3">
                    <p className="text-xs text-slate-400">禁言期间该成员不会在群里发言（AI 导演也会跳过ta），群里会发系统通知。</p>
                    <div className="grid grid-cols-2 gap-2">
                        {MUTE_OPTIONS.map(opt => (
                            <button key={opt.ms} onClick={() => handleMuteMember(opt.ms)} className="py-3 bg-orange-50 text-orange-600 font-bold rounded-xl border border-orange-100 active:scale-95 transition-transform text-xs">
                                {opt.label}
                            </button>
                        ))}
                    </div>
                    {profileMemberId && isMuted(activeGroup, profileMemberId) && (
                        <button onClick={() => handleMuteMember(null)} className="w-full py-3 bg-emerald-50 text-emerald-600 font-bold rounded-xl border border-emerald-100 active:scale-95 transition-transform text-xs">
                            解除禁言
                        </button>
                    )}
                </div>
            </Modal>

        </div>
    );
};

export default ChatHub;
