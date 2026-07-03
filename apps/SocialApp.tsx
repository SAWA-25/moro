import React, { useEffect, useMemo, useState } from 'react';
import {
    Binoculars,
    BookmarkSimple,
    Broom,
    CaretLeft,
    ChatCircle,
    HandWaving,
    Heart,
    HouseLine,
    MagnifyingGlass,
    MapPin,
    PaperPlaneTilt,
    PencilSimple,
    PlugsConnected,
    Plus,
    Scissors,
    Shuffle,
    Spinner,
    Stack,
    UserCircle,
    UsersThree,
    X,
} from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { AppID, CharacterProfile, XhsActivityRecord, XhsFeedCategory, XhsFeedPost } from '../types';
import { DB } from '../utils/db';
import {
    chooseXhsCoverUrl,
    classifyXhsFeedCategory,
    FEED_BATCH_SIZE,
    generateAuthorReply,
    generateCharacterLifePost,
    generateFeedBatch,
    XHS_FEED_CATEGORIES,
} from '../utils/xhsFeed';
import {
    DatingIntent,
    DatingProfile,
    DATING_INTENTS,
    datingProfileToAmbientContact,
    fallbackDatingProfiles,
    generateDatingBatch,
    generateDatingReply,
    intentMeta,
    isMatch,
} from '../utils/socialDating';
import { ambientSocialToCharacter } from '../utils/ambientSocial';
import { resolveAuxApi } from '../utils/auxApi';
import { makeApiUsageMeta } from '../utils/apiUsageCatalog';
import { queueManualDeepLink } from '../utils/manualDeepLink';
import { fetchModelList, testChatConnection } from '../utils/llmClient';
import {
    clearLocalApiOverride,
    isLocalApiOverrideComplete,
    loadLocalApiOverride,
    resolveScopedLocalApi,
    saveLocalApiOverride,
    type LocalApiOverrideConfig,
} from '../utils/localApiOverride';
import {
    accent,
    Chip,
    IconCircle,
    INK,
    INK_SOFT,
    InsButton,
    InsDialog,
    InsSheet,
    InsShell,
    StoryRing,
    SUNSET,
} from '../components/ui/insKit';

/**
 * 见闻簿 App —— 纯本地小红书式公开信息流。
 *
 * 四个入口：
 * - 见闻：瀑布流、本地发帖、剪藏、递给角色
 * - 熟人：按角色筛选，并让角色生成一条本地生活动态
 * - 收藏：收藏与剪藏集中回看
 * - 交友：附近的人卡片，匹配后可手动收为来往联系人
 */

const AC = 'rose' as const;
const A = accent(AC);

type MainMode = 'feed' | 'friends' | 'favorites' | 'meet';
type AuthorView = { kind: 'character' | 'user' | 'npc'; id?: string; name: string } | null;
type SavedDatingProfile = DatingProfile & { matched?: boolean; convertedCharId?: string };

const CATEGORY_LABELS: Record<XhsFeedCategory, string> = Object.fromEntries(XHS_FEED_CATEGORIES.map(c => [c.key, c.label])) as Record<XhsFeedCategory, string>;

const fmtCount = (n: number): string => (n >= 10000 ? `${(n / 10000).toFixed(1)}w` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

const fmtTime = (ts: number): string => {
    const diff = Date.now() - ts;
    if (diff < 60 * 1000) return '刚刚';
    if (diff < 3600 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 24 * 3600 * 1000) return `${Math.floor(diff / 3600000)} 小时前`;
    if (diff < 7 * 24 * 3600 * 1000) return `${Math.floor(diff / 86400000)} 天前`;
    const d = new Date(ts);
    return `${d.getMonth() + 1}-${d.getDate()}`;
};

const uid = (prefix: string): string => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const Avatar: React.FC<{ name: string; src?: string; size?: number }> = ({ name, src, size = 32 }) => {
    if (src) return <img src={src} style={{ width: size, height: size }} className="rounded-full object-cover shrink-0" alt="" />;
    return (
        <div
            style={{ width: size, height: size, background: SUNSET, fontSize: size * 0.42 }}
            className="rounded-full text-white flex items-center justify-center font-bold shrink-0 select-none"
        >
            {name.slice(0, 1)}
        </div>
    );
};

const postAuthorKind = (post: XhsFeedPost): string => {
    if (post.authorType === 'character') return '熟人';
    if (post.authorType === 'user') return post.source === 'clip' ? '剪藏' : '我';
    return '路人';
};

const sourceLabel = (post: XhsFeedPost): string => {
    if (post.source === 'character_life') return '近况';
    if (post.source === 'clip') return '剪藏';
    if (post.source === 'user') return '自发';
    return postAuthorKind(post);
};

const postCategory = (post: XhsFeedPost): XhsFeedCategory => post.category || classifyXhsFeedCategory(post.tags, post.title, post.body);

const toLocalXhsNote = (post: XhsFeedPost) => ({
    local: true,
    noteId: post.id,
    id: post.id,
    title: post.title,
    desc: post.body,
    author: post.author,
    coverUrl: post.coverUrl,
    likes: post.likes,
    type: 'note',
    source: '见闻簿',
    tags: post.tags,
    category: postCategory(post),
});

const AppHeader: React.FC<{ title: string; sub?: string; onBack: () => void; right?: React.ReactNode }> = ({ title, sub, onBack, right }) => (
    <div className="shrink-0 relative z-10">
        <div className="flex items-center gap-2.5 px-3.5 pt-2.5 pb-2.5">
            <IconCircle onClick={onBack} title="返回"><CaretLeft size={18} weight="bold" /></IconCircle>
            <div className="min-w-0 flex-1 leading-tight">
                <span className="text-[19px] font-extrabold tracking-tight" style={{ color: INK }}>{title}</span>
                {sub && <div className="text-[10.5px] mt-0.5 truncate" style={{ color: INK_SOFT }}>{sub}</div>}
            </div>
            {right}
        </div>
    </div>
);

const ModeTabs: React.FC<{ mode: MainMode; setMode: (m: MainMode) => void }> = ({ mode, setMode }) => {
    const tabs: Array<[MainMode, string, React.ReactNode]> = [
        ['feed', '见闻', <HouseLine className="w-4 h-4" weight="bold" />],
        ['friends', '熟人', <UsersThree className="w-4 h-4" weight="bold" />],
        ['favorites', '收藏', <BookmarkSimple className="w-4 h-4" weight="bold" />],
        ['meet', '交友', <Heart className="w-4 h-4" weight="bold" />],
    ];
    return (
        <div className="px-3 py-2 shrink-0">
            <div className="grid grid-cols-4 gap-1 p-1 rounded-full" style={{ background: '#efece7' }}>
                {tabs.map(([k, label, icon]) => (
                    <button
                        key={k}
                        onClick={() => setMode(k)}
                        className="min-w-0 h-8 rounded-full inline-flex items-center justify-center gap-1 text-[12px] font-bold transition-colors"
                        style={{
                            color: mode === k ? INK : INK_SOFT,
                            background: mode === k ? '#fff' : 'transparent',
                            boxShadow: mode === k ? '0 4px 12px -7px rgba(38,38,38,0.45)' : 'none',
                        }}
                    >
                        {icon}<span>{label}</span>
                    </button>
                ))}
            </div>
        </div>
    );
};

const PostCard: React.FC<{ post: XhsFeedPost; onClick: () => void }> = ({ post, onClick }) => {
    const category = postCategory(post);
    return (
        <button
            onClick={onClick}
            className="relative w-full text-left overflow-hidden bg-white press-soft mb-3 break-inside-avoid"
            style={{ borderRadius: 18, boxShadow: '0 1px 2px rgba(38,38,38,0.04), 0 14px 30px -22px rgba(38,38,38,0.28)' }}
        >
            <div className="absolute top-2 left-2 z-10 flex gap-1.5">
                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{ color: A.ink, background: 'rgba(255,255,255,0.9)' }}>{CATEGORY_LABELS[category]}</span>
                {post.faved && <span className="text-[9px] font-bold px-2 py-0.5 rounded-full text-white" style={{ background: '#f59e0b' }}>已藏</span>}
            </div>
            {post.coverUrl ? (
                <img
                    src={post.coverUrl}
                    className="w-full object-cover animate-photo-develop"
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    onError={(e: any) => { e.target.style.display = 'none'; }}
                    alt=""
                />
            ) : (
                <div className="w-full aspect-[3/4] flex items-center justify-center p-3.5" style={{ background: `linear-gradient(150deg, ${A.soft}, #f1eee9)` }}>
                    <span className="text-[14px] font-bold leading-relaxed line-clamp-6 text-center" style={{ color: '#5a5660', fontFamily: 'var(--font-hand)' }}>
                        {post.source === 'clip' ? `✂ ${post.title}` : post.body.slice(0, 72)}
                    </span>
                </div>
            )}
            <div className="px-2.5 pt-2 pb-2.5">
                <div className="text-[12.5px] font-bold leading-snug line-clamp-2" style={{ color: INK }}>{post.title}</div>
                <div className="flex items-center justify-between mt-2 gap-1">
                    <span className="inline-flex items-center gap-1.5 min-w-0 flex-1">
                        <Avatar name={post.author} src={post.authorAvatar} size={18} />
                        <span
                            className="text-[10.5px] truncate"
                            style={{ color: post.authorType === 'character' ? A.solid : INK_SOFT, fontWeight: post.authorType === 'character' ? 700 : 400 }}
                        >
                            {post.author}
                        </span>
                        <span className="text-[9px] shrink-0" style={{ color: '#bcb9b2' }}>{sourceLabel(post)}</span>
                    </span>
                    <span className="inline-flex items-center gap-0.5 text-[10.5px] shrink-0" style={{ color: post.liked ? A.solid : INK_SOFT, fontWeight: post.liked ? 700 : 400 }}>
                        <Heart className="w-3.5 h-3.5" weight={post.liked ? 'fill' : 'regular'} />{fmtCount(post.likes)}
                    </span>
                </div>
            </div>
        </button>
    );
};

const DatingCard: React.FC<{ p: DatingProfile; remaining: number; onAct: (a: 'skip' | 'like' | 'greet') => void }> = ({ p, remaining, onAct }) => {
    const im = intentMeta(p.intent);
    return (
        <div className="w-full max-w-[360px] flex flex-col animate-ins-card">
            <div className="relative bg-white overflow-hidden" style={{ borderRadius: 26, boxShadow: '0 1px 2px rgba(38,38,38,0.05), 0 28px 50px -26px rgba(38,38,38,0.4)' }}>
                <div className="relative w-full aspect-[4/5] overflow-hidden flex items-center justify-center" style={{ background: `linear-gradient(150deg, ${A.soft}, #f0eee8)` }}>
                    {p.avatar ? <img src={p.avatar} className="w-full h-full object-cover" referrerPolicy="no-referrer" alt="" /> : <span className="text-[88px] select-none">{p.emoji}</span>}
                    <div className="absolute top-3 left-3 flex items-center gap-1 text-white text-[10px] font-bold px-2.5 py-1 rounded-full" style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(6px)' }}><MapPin className="w-3 h-3" weight="fill" />{p.distanceKm}km</div>
                    {p.online && <div className="absolute top-3 right-3 flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full" style={{ background: 'rgba(255,255,255,0.9)', color: INK, backdropFilter: 'blur(6px)' }}><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />在线</div>}
                    <div className="absolute bottom-3 left-3 text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: 'rgba(255,255,255,0.92)', color: A.ink }}>{im.emoji} {im.label}</div>
                    {p.isChar && <div className="absolute bottom-3 right-3 text-white text-[10px] font-bold px-2.5 py-1 rounded-full" style={{ background: A.solid }}>熟人</div>}
                </div>
                <div className="px-4 pt-3 pb-3.5">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[17px] font-black" style={{ color: INK }}>{p.name}</span>
                        {p.age != null && <span className="text-[12px]" style={{ color: INK_SOFT }}>{p.age}</span>}
                        {p.gender && <span className="text-[10px] text-white px-1.5 py-0.5 rounded-full" style={{ background: A.solid }}>{p.gender}</span>}
                    </div>
                    {p.tags.length > 0 && <div className="flex flex-wrap gap-1.5 mt-2">{p.tags.map(t => <span key={t} className="text-[10.5px] px-2 py-0.5 rounded-full" style={{ color: A.ink, background: A.soft }}>{t}</span>)}</div>}
                    <div className="text-[13px] leading-relaxed whitespace-pre-wrap mt-2.5" style={{ color: '#4a4750' }}>{p.bio}</div>
                </div>
            </div>
            <div className="flex items-center justify-center gap-6 mt-5">
                <button onClick={() => onAct('skip')} className="rounded-full bg-white flex items-center justify-center press-soft" style={{ width: 52, height: 52, boxShadow: '0 8px 20px -10px rgba(38,38,38,0.35)' }} title="跳过"><X className="w-5 h-5" weight="bold" style={{ color: INK_SOFT }} /></button>
                <button onClick={() => onAct('greet')} className="rounded-full flex items-center justify-center press-soft text-white" style={{ width: 62, height: 62, background: INK, boxShadow: '0 12px 26px -10px rgba(38,38,38,0.6)' }} title="打招呼"><HandWaving className="w-7 h-7" weight="fill" /></button>
                <button onClick={() => onAct('like')} className="rounded-full flex items-center justify-center press-soft text-white" style={{ width: 52, height: 52, background: A.solid, boxShadow: `0 12px 26px -10px ${A.solid}` }} title="喜欢"><Heart className="w-5 h-5" weight="fill" /></button>
            </div>
            <div className="text-center text-[10.5px] mt-2.5" style={{ color: INK_SOFT }}>还有 {Math.max(0, remaining - 1)} 个待发现</div>
        </div>
    );
};

const SocialApp: React.FC = () => {
    const {
        closeApp,
        openApp,
        addToast,
        apiConfig,
        auxApiConfig,
        characters,
        userProfile,
        setActiveCharacterId,
        importCharacter,
    } = useOS();
    const [socialApiOverride, setSocialApiOverride] = useState<LocalApiOverrideConfig>(() => loadLocalApiOverride('social'));
    const feedApi = useMemo(
        () => resolveScopedLocalApi('social', auxApiConfig, apiConfig),
        [apiConfig, auxApiConfig, socialApiOverride],
    );
    const apiReady = !!feedApi?.baseUrl && !!feedApi?.model;
    const socialApiOverrideOn = isLocalApiOverrideComplete(socialApiOverride);

    const [posts, setPosts] = useState<XhsFeedPost[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [mode, setMode] = useState<MainMode>('feed');
    const [searchInput, setSearchInput] = useState('');
    const [keyword, setKeyword] = useState('');
    const [categoryFilter, setCategoryFilter] = useState<XhsFeedCategory | 'all'>('all');
    const [detailId, setDetailId] = useState<string | null>(null);
    const [authorView, setAuthorView] = useState<AuthorView>(null);
    const [commentInput, setCommentInput] = useState('');
    const [replying, setReplying] = useState(false);
    const [clipPost, setClipPost] = useState<XhsFeedPost | null>(null);
    const [clipNote, setClipNote] = useState('');
    const [sharePost, setSharePost] = useState<XhsFeedPost | null>(null);
    const [confirmClear, setConfirmClear] = useState(false);
    const [composeOpen, setComposeOpen] = useState(false);
    const [composeTitle, setComposeTitle] = useState('');
    const [composeBody, setComposeBody] = useState('');
    const [composeTags, setComposeTags] = useState('');
    const [composeCategory, setComposeCategory] = useState<XhsFeedCategory>('life');
    const [friendFilter, setFriendFilter] = useState<string>('all');
    const [friendGeneratingId, setFriendGeneratingId] = useState<string | null>(null);
    const [showSocialApiSheet, setShowSocialApiSheet] = useState(false);
    const [socialApiDraft, setSocialApiDraft] = useState<LocalApiOverrideConfig>(socialApiOverride);
    const [socialApiStatus, setSocialApiStatus] = useState('');
    const [testingSocialApi, setTestingSocialApi] = useState(false);
    const [fetchingSocialModels, setFetchingSocialModels] = useState(false);
    const [socialApiModels, setSocialApiModels] = useState<string[]>([]);
    const [showSocialApiModels, setShowSocialApiModels] = useState(false);

    const [dating, setDating] = useState<DatingProfile[]>([]);
    const [datingIdx, setDatingIdx] = useState(0);
    const [datingBusy, setDatingBusy] = useState(false);
    const [meetFilter, setMeetFilter] = useState<DatingIntent | 'all'>('all');
    const [greetInput, setGreetInput] = useState('');
    const [liked, setLiked] = useState<SavedDatingProfile[]>(() => {
        try { return JSON.parse(localStorage.getItem('moro_social_liked_v1') || '[]') || []; } catch { return []; }
    });
    const [showLiked, setShowLiked] = useState(false);
    const [greetCard, setGreetCard] = useState<{ p: DatingProfile; reply: string; busy: boolean; matched: boolean } | null>(null);
    const DATING_KEY = 'moro_social_dating_v1';
    const LIKED_KEY = 'moro_social_liked_v1';

    const detail = useMemo(() => posts.find(p => p.id === detailId) || null, [posts, detailId]);
    const favoritePosts = useMemo(() => posts.filter(p => p.faved || p.source === 'clip'), [posts]);

    useEffect(() => {
        (async () => {
            try {
                const stored = await DB.getXhsFeedPosts();
                setPosts(stored);
                setLoaded(true);
                if (stored.length === 0) void refreshFeed();
            } catch {
                setLoaded(true);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (mode !== 'meet' || dating.length) return;
        try {
            const cached = JSON.parse(localStorage.getItem(DATING_KEY) || 'null');
            if (Array.isArray(cached) && cached.length) { setDating(cached); return; }
        } catch { /* ignore */ }
        if (apiReady) void refreshDating(); else setDating(fallbackDatingProfiles(12));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode]);

    const setSocialApiDraftField = (field: keyof LocalApiOverrideConfig, value: string) => {
        setSocialApiDraft(prev => ({ ...prev, [field]: value }));
    };

    const openSocialApiSheet = () => {
        const saved = loadLocalApiOverride('social');
        setSocialApiOverride(saved);
        setSocialApiDraft(saved);
        setSocialApiStatus('');
        setShowSocialApiSheet(true);
    };

    const copyMainToSocialApi = () => {
        setSocialApiDraft({
            baseUrl: apiConfig.baseUrl || '',
            apiKey: apiConfig.apiKey || '',
            model: apiConfig.model || '',
        });
        setSocialApiStatus('已复制主 API，保存后生效');
    };

    const copyAuxToSocialApi = () => {
        const aux = resolveAuxApi(auxApiConfig, apiConfig);
        setSocialApiDraft({
            baseUrl: aux.baseUrl || '',
            apiKey: aux.apiKey || '',
            model: aux.model || '',
        });
        setSocialApiStatus('已复制副 API 当前线路，保存后生效');
    };

    const saveSocialApi = () => {
        try {
            const saved = saveLocalApiOverride('social', socialApiDraft);
            setSocialApiOverride(saved);
            setSocialApiDraft(saved);
            setSocialApiStatus(saved.baseUrl ? '见闻簿专用 API 已保存' : '见闻簿专用 API 已清除');
            addToast(saved.baseUrl ? '见闻簿会优先使用这条专用 API' : '见闻簿已回到文具盒副 API / 主 API', 'success');
        } catch (e: any) {
            const msg = e?.message || '保存失败';
            setSocialApiStatus(msg);
            addToast(msg, 'error');
        }
    };

    const clearSocialApi = () => {
        clearLocalApiOverride('social');
        const empty = loadLocalApiOverride('social');
        setSocialApiOverride(empty);
        setSocialApiDraft(empty);
        setSocialApiStatus('已清除，之后回退文具盒副 API / 主 API');
        addToast('见闻簿专用 API 已清除', 'success');
    };

    const testSocialApi = async () => {
        const baseUrl = socialApiDraft.baseUrl.trim();
        const model = socialApiDraft.model.trim();
        if (!baseUrl || !model) {
            setSocialApiStatus('测试前需要填写 Base URL 和模型名');
            return;
        }
        setTestingSocialApi(true);
        setSocialApiStatus('正在测试连接…');
        try {
            const reply = await testChatConnection(
                { baseUrl, apiKey: socialApiDraft.apiKey.trim(), model },
                {
                    stream: false,
                    meta: makeApiUsageMeta('social.generate', {
                        apiRole: 'custom',
                        apiBinding: '见闻簿专用 API',
                        isBackgroundTask: false,
                    }),
                },
            );
            setSocialApiStatus(`连接成功：${reply.slice(0, 30) || '模型已响应'}`);
        } catch (e: any) {
            setSocialApiStatus(`连接失败：${e?.message || '请检查地址、Key 和模型名'}`);
        } finally {
            setTestingSocialApi(false);
        }
    };

    const fetchSocialApiModels = async () => {
        const baseUrl = socialApiDraft.baseUrl.trim();
        if (!baseUrl) {
            setSocialApiStatus('拉取模型前需要填写 Base URL');
            addToast('请先填写见闻簿专用 API 的 Base URL', 'info');
            return;
        }
        setFetchingSocialModels(true);
        setSocialApiStatus('正在拉取模型列表…');
        try {
            const models = await fetchModelList(
                { baseUrl, apiKey: socialApiDraft.apiKey.trim() },
                {
                    meta: makeApiUsageMeta('social.dedicatedApi.fetchModels', {
                        apiRole: 'custom',
                        apiBinding: '见闻簿专用 API',
                        isBackgroundTask: false,
                    }),
                },
            );
            if (!models.length) {
                setSocialApiStatus('没有识别到模型列表，可以继续手动填写模型名');
                addToast('没有识别到模型列表，可以手动填写模型名', 'info');
                return;
            }
            setSocialApiModels(models);
            setShowSocialApiModels(true);
            setSocialApiDraft(prev => models.includes(prev.model.trim()) ? prev : { ...prev, model: models[0] });
            setSocialApiStatus(`已拉取 ${models.length} 个模型，选好后记得保存`);
            addToast(`已拉取 ${models.length} 个模型，请保存见闻簿专用 API`, 'success');
        } catch (e: any) {
            const msg = e?.message || '请检查地址和密钥';
            setSocialApiStatus(`拉取模型失败：${msg}`);
            addToast(`拉取模型失败：${msg}`, 'error');
        } finally {
            setFetchingSocialModels(false);
        }
    };

    const patchPost = (id: string, patch: Partial<XhsFeedPost> | ((p: XhsFeedPost) => Partial<XhsFeedPost>)) => {
        setPosts(prev => prev.map(p => {
            if (p.id !== id) return p;
            const next = { ...p, ...(typeof patch === 'function' ? patch(p) : patch) };
            void DB.saveXhsFeedPost(next);
            return next;
        }));
    };

    const refreshFeed = async () => {
        if (generating) return;
        if (!apiReady) { addToast('先去「文具盒」把 API（模型 / 地址）补上', 'error'); return; }
        setGenerating(true);
        try {
            const stock = await DB.getXhsStockImages().catch(() => []);
            const batch = await generateFeedBatch(feedApi, characters, userProfile, stock);
            await DB.saveXhsFeedPosts(batch);
            setPosts(prev => [...batch, ...prev]);
            addToast(`又剪了 ${batch.length} 张贴上`, 'success');
        } catch (e: any) {
            addToast(`没剪出来：${e?.message || '未知错误'}`, 'error');
        } finally {
            setGenerating(false);
        }
    };

    const submitCompose = async () => {
        const title = composeTitle.trim();
        const body = composeBody.trim();
        if (!title || !body) { addToast('标题和正文都要写一点', 'error'); return; }
        const tags = composeTags.split(/[,，\s#]+/).map(t => t.trim()).filter(Boolean).slice(0, 8);
        const stock = await DB.getXhsStockImages().catch(() => []);
        const used = new Set<string>();
        const post: XhsFeedPost = {
            id: uid('xhs_user'),
            authorType: 'user',
            author: userProfile.name || '我',
            authorAvatar: userProfile.avatar,
            title,
            body,
            tags: tags.length ? tags : [CATEGORY_LABELS[composeCategory]],
            coverUrl: chooseXhsCoverUrl(stock, tags, used),
            likes: 0,
            favs: 0,
            comments: [],
            createdAt: Date.now(),
            source: 'user',
            category: composeCategory,
        };
        await DB.saveXhsFeedPost(post);
        setPosts(prev => [post, ...prev]);
        setComposeOpen(false);
        setComposeTitle('');
        setComposeBody('');
        setComposeTags('');
        addToast('已贴进见闻簿', 'success');
    };

    const toggleLike = (p: XhsFeedPost) =>
        patchPost(p.id, cur => ({ liked: !cur.liked, likes: Math.max(0, cur.likes + (cur.liked ? -1 : 1)) }));

    const toggleFav = (p: XhsFeedPost) =>
        patchPost(p.id, cur => ({ faved: !cur.faved, favs: Math.max(0, cur.favs + (cur.faved ? -1 : 1)) }));

    const submitComment = async () => {
        const text = commentInput.trim();
        if (!text || !detail || replying) return;
        setCommentInput('');
        const userComment = {
            id: uid('xhs_cm'),
            author: userProfile.name || '我',
            isUser: true,
            content: text,
            likes: 0,
            timestamp: Date.now(),
        };
        patchPost(detail.id, cur => ({ comments: [...cur.comments, userComment] }));
        if (apiReady && detail.authorType !== 'user') {
            setReplying(true);
            try {
                const authorChar = detail.charId ? characters.find(c => c.id === detail.charId) : undefined;
                const reply = await generateAuthorReply(feedApi, detail, text, userProfile, authorChar);
                patchPost(detail.id, cur => ({ comments: [...cur.comments, reply] }));
            } catch { /* 回复失败不打扰 */ } finally {
                setReplying(false);
            }
        }
    };

    const submitClip = async () => {
        if (!clipPost) return;
        const src = clipPost;
        const repost: XhsFeedPost = {
            id: uid('xhs_clip'),
            authorType: 'user',
            author: userProfile.name || '我',
            authorAvatar: userProfile.avatar,
            title: `剪藏：${src.title}`,
            body: `${clipNote.trim() ? `${clipNote.trim()}\n\n` : ''}— 剪自 @${src.author}：${src.body}`,
            tags: src.tags,
            coverUrl: src.coverUrl,
            likes: 0,
            favs: 0,
            faved: true,
            comments: [],
            createdAt: Date.now(),
            repostOf: src.id,
            repostNote: clipNote.trim() || undefined,
            source: 'clip',
            category: postCategory(src),
        };
        await DB.saveXhsFeedPost(repost);
        setPosts(prev => [repost, ...prev]);
        setClipPost(null);
        setClipNote('');
        setDetailId(null);
        addToast('剪下来，贴进收藏页了', 'success');
    };

    const shareToCharacter = async (char: CharacterProfile) => {
        if (!sharePost) return;
        try {
            await DB.saveMessage({
                charId: char.id,
                role: 'user',
                type: 'xhs_card',
                content: `[转发的见闻：${sharePost.title}]`,
                metadata: { xhsNote: toLocalXhsNote(sharePost), source: 'social-app' },
            } as any);
            setSharePost(null);
            setActiveCharacterId(char.id);
            openApp(AppID.Chat);
            addToast(`已递给 ${char.convoSettings?.remarkName?.trim() || char.name}`, 'success');
        } catch {
            addToast('转发失败', 'error');
        }
    };

    const clearFeed = async () => {
        await DB.clearXhsFeedPosts().catch(() => undefined);
        setPosts([]);
        setConfirmClear(false);
        addToast('这一沓全撕掉了', 'info');
    };

    const openAuthor = (post: XhsFeedPost) => {
        setDetailId(null);
        setAuthorView({
            kind: post.authorType === 'character' ? 'character' : post.authorType === 'user' ? 'user' : 'npc',
            id: post.charId,
            name: post.author,
        });
    };

    const openChatWith = (charId?: string) => {
        if (!charId) return;
        setActiveCharacterId(charId);
        openApp(AppID.Chat);
    };

    const generateFriendPost = async (char: CharacterProfile) => {
        if (!apiReady) { addToast('先去「文具盒」把 API（模型 / 地址）补上', 'error'); return; }
        if (friendGeneratingId) return;
        setFriendGeneratingId(char.id);
        try {
            const stock = await DB.getXhsStockImages().catch(() => []);
            const post = await generateCharacterLifePost(feedApi, char, userProfile, stock);
            await DB.saveXhsFeedPost(post);
            const activity: XhsActivityRecord = {
                id: uid('xhs_local_activity'),
                characterId: char.id,
                timestamp: Date.now(),
                actionType: 'post',
                content: { title: post.title, body: post.body, tags: post.tags },
                thinking: `${char.name} 在见闻簿更新了一条本地近况。`,
                result: 'success',
                resultMessage: '已写入见闻簿（纯本地）',
            };
            await DB.saveXhsActivity(activity);
            setPosts(prev => [post, ...prev]);
            setMode('friends');
            setFriendFilter(char.id);
            addToast(`${char.name} 更新了一条近况`, 'success');
        } catch (e: any) {
            addToast(`没写出来：${e?.message || '未知错误'}`, 'error');
        } finally {
            setFriendGeneratingId(null);
        }
    };

    const refreshDating = async () => {
        if (datingBusy) return;
        if (!apiReady) { addToast('先去「文具盒」把 API（模型 / 地址）补上', 'error'); setDating(fallbackDatingProfiles(12)); setDatingIdx(0); return; }
        setDatingBusy(true);
        try {
            const batch = await generateDatingBatch(feedApi, characters, userProfile, 14);
            setDating(batch);
            setDatingIdx(0);
            try { localStorage.setItem(DATING_KEY, JSON.stringify(batch)); } catch { /* ignore */ }
            addToast(`发现 ${batch.length} 个附近的人`, 'success');
        } catch {
            setDating(fallbackDatingProfiles(12));
            setDatingIdx(0);
            addToast('没刷到新的人，先看看这些', 'error');
        } finally {
            setDatingBusy(false);
        }
    };

    const patchDating = (id: string, patch: Partial<DatingProfile>) =>
        setDating(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p));

    const saveLiked = (next: SavedDatingProfile[]) => {
        const kept = next.slice(0, 60);
        setLiked(kept);
        try { localStorage.setItem(LIKED_KEY, JSON.stringify(kept)); } catch { /* ignore */ }
    };

    const rememberDatingProfile = (entry: SavedDatingProfile) => {
        const existing = liked.find(l => l.id === entry.id);
        const merged: SavedDatingProfile = existing
            ? { ...existing, ...entry, matched: !!(existing.matched || entry.matched), greeted: !!(existing.greeted || entry.greeted) }
            : entry;
        saveLiked([merged, ...liked.filter(l => l.id !== entry.id)]);
    };

    const likeProfile = (p: DatingProfile) => {
        patchDating(p.id, { liked: true });
        const matched = isMatch(p);
        rememberDatingProfile({ ...p, liked: true, matched });
        addToast(matched ? `和 ${p.name} 匹配成功` : `已喜欢 ${p.name}`, 'success');
        setDatingIdx(i => i + 1);
    };

    const greetProfile = async (p: DatingProfile) => {
        patchDating(p.id, { greeted: true });
        const matched = isMatch(p);
        const greetedProfile = { ...p, greeted: true, matched };
        rememberDatingProfile(greetedProfile);
        setGreetCard({ p: greetedProfile, reply: '', busy: true, matched });
        setDatingIdx(i => i + 1);
        let reply = '';
        if (apiReady) {
            try { reply = await generateDatingReply(feedApi, p, userProfile, greetInput.trim() || undefined); } catch { /* fall to canned */ }
        }
        setGreetInput('');
        setGreetCard(cur => cur && cur.p.id === p.id ? { ...cur, reply: reply || '（对方暂时没回应，等等再试～）', busy: false } : cur);
    };

    const datingAct = (p: DatingProfile, act: 'skip' | 'like' | 'greet') => {
        if (act === 'like') likeProfile(p);
        else if (act === 'greet') void greetProfile(p);
        else setDatingIdx(i => i + 1);
    };

    const convertDatingToContact = async (p: SavedDatingProfile | DatingProfile) => {
        if (p.isChar) { openChatWith(p.charId); return; }
        const existing = (p as SavedDatingProfile).convertedCharId;
        if (existing) { openChatWith(existing); return; }
        try {
            const entry = datingProfileToAmbientContact(p, userProfile);
            const char = ambientSocialToCharacter(entry, userProfile.name || '我');
            await importCharacter(char);
            const next = liked.map(l => l.id === p.id ? { ...l, convertedCharId: char.id, greeted: true } : l);
            if (!next.some(l => l.id === p.id)) next.unshift({ ...p, convertedCharId: char.id, greeted: true });
            saveLiked(next);
            addToast(`已把 ${p.name} 收进来往`, 'success');
            openApp(AppID.Chat);
        } catch {
            addToast('收为联系人失败', 'error');
        }
    };

    const filteredPosts = useMemo(() => {
        const kw = keyword.trim().toLowerCase();
        let base = posts;
        if (mode === 'friends') {
            base = base.filter(p => p.authorType === 'character' && (friendFilter === 'all' || p.charId === friendFilter));
        } else if (mode === 'favorites') {
            base = favoritePosts;
        } else {
            base = posts;
        }
        if (categoryFilter !== 'all') base = base.filter(p => postCategory(p) === categoryFilter);
        if (!kw) return base;
        return base.filter(p =>
            p.title.toLowerCase().includes(kw) ||
            p.body.toLowerCase().includes(kw) ||
            p.author.toLowerCase().includes(kw) ||
            p.tags.some(t => t.toLowerCase().includes(kw)));
    }, [posts, mode, friendFilter, favoritePosts, categoryFilter, keyword]);

    const topicChips = useMemo(() => {
        const freq = new Map<string, number>();
        filteredPosts.forEach(p => p.tags.forEach(t => {
            const key = (t || '').trim();
            if (!key) return;
            freq.set(key, (freq.get(key) || 0) + 1);
        }));
        return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18).map(([t]) => t);
    }, [filteredPosts]);

    const [colA, colB] = useMemo(() => {
        const a: XhsFeedPost[] = []; const b: XhsFeedPost[] = [];
        filteredPosts.forEach((p, i) => (i % 2 === 0 ? a : b).push(p));
        return [a, b];
    }, [filteredPosts]);

    const renderPostGrid = (emptyTitle: string, emptyHint?: string) => (
        <div className="flex-1 overflow-y-auto no-scrollbar px-3 pt-2 pb-10 relative z-10">
            {!loaded ? (
                <div className="mt-16 text-center text-[12.5px]" style={{ color: INK_SOFT, fontFamily: 'var(--font-hand)' }}>翻箱倒柜中…</div>
            ) : filteredPosts.length === 0 && generating ? (
                <div className="mt-16 text-center text-[12.5px]" style={{ color: INK_SOFT, fontFamily: 'var(--font-hand)' }}>正在剪第一沓（熟人 + 路人）…</div>
            ) : filteredPosts.length === 0 ? (
                <div className="mt-10 mx-2 bg-white p-7 text-center" style={{ borderRadius: 24, boxShadow: '0 18px 40px -28px rgba(38,38,38,0.3)' }}>
                    <div className="text-4xl mb-3">✄</div>
                    <div className="text-[15px] font-extrabold mb-2" style={{ color: INK }}>{keyword ? `没找到「${keyword}」` : emptyTitle}</div>
                    {emptyHint && <div className="text-[12.5px] leading-relaxed mb-4" style={{ color: INK_SOFT }}>{emptyHint}</div>}
                    {mode === 'feed' && !keyword && (
                        <InsButton variant="gradient" onClick={() => apiReady ? void refreshFeed() : openApp(AppID.Settings)} className="px-6 py-2.5 text-[13px]">
                            {apiReady ? '剪一沓贴上' : '去文具盒'}
                        </InsButton>
                    )}
                </div>
            ) : (
                <div className="flex gap-3 items-start">
                    <div className="flex-1 min-w-0">{colA.map(p => <PostCard key={p.id} post={p} onClick={() => setDetailId(p.id)} />)}</div>
                    <div className="flex-1 min-w-0">{colB.map(p => <PostCard key={p.id} post={p} onClick={() => setDetailId(p.id)} />)}</div>
                </div>
            )}
        </div>
    );

    const renderSearchAndFilters = () => (
        <>
            <div className="flex items-center gap-2 px-3 pb-2 shrink-0 relative z-10">
                <div className="flex-1 flex items-center gap-2 px-3.5 py-2.5 min-w-0 rounded-full" style={{ background: '#fff', boxShadow: '0 1px 2px rgba(38,38,38,0.04)', border: '1px solid rgba(0,0,0,0.05)' }}>
                    <MagnifyingGlass className="w-4 h-4 shrink-0" weight="bold" style={{ color: INK_SOFT }} />
                    <input
                        value={searchInput}
                        onChange={e => { setSearchInput(e.target.value); setKeyword(e.target.value); }}
                        placeholder="搜见闻 / 找人 / 找标签…"
                        className="flex-1 bg-transparent text-[13px] outline-none min-w-0"
                        style={{ color: INK }}
                    />
                </div>
                {mode === 'feed' && (
                    <InsButton variant="solid" accent={AC} onClick={() => void refreshFeed()} disabled={generating} className="px-3 py-2.5 text-[12px]" title={`再剪 ${FEED_BATCH_SIZE} 张贴上`} icon={<Shuffle className={`w-4 h-4 ${generating ? 'animate-spin' : ''}`} weight="bold" />}>
                        {generating ? '生成中' : '翻新页'}
                    </InsButton>
                )}
                <IconCircle onClick={() => setComposeOpen(true)} title="发一条"><Plus className="w-4 h-4" weight="bold" /></IconCircle>
                <IconCircle onClick={() => setConfirmClear(true)} title="清空整簿"><Broom className="w-4 h-4" weight="bold" /></IconCircle>
            </div>
            <div className="flex items-center gap-2 px-3 pb-2 shrink-0 overflow-x-auto no-scrollbar relative z-10">
                <span className="text-[10px] font-bold shrink-0" style={{ color: INK_SOFT }}>分类</span>
                <Chip active={categoryFilter === 'all'} accent={AC} onClick={() => setCategoryFilter('all')}>全部</Chip>
                {XHS_FEED_CATEGORIES.map(c => (
                    <Chip key={c.key} active={categoryFilter === c.key} accent={AC} onClick={() => setCategoryFilter(c.key)}>{c.label}</Chip>
                ))}
            </div>
            {topicChips.length > 0 && (
                <div className="flex items-center gap-2 px-3 pb-2 shrink-0 overflow-x-auto no-scrollbar relative z-10">
                    <span className="text-[10px] font-bold shrink-0" style={{ color: INK_SOFT }}>话题</span>
                    {keyword && <Chip active accent={AC} onClick={() => { setKeyword(''); setSearchInput(''); }}>✕ 全部</Chip>}
                    {topicChips.map(t => {
                        const active = keyword.trim().toLowerCase() === t.toLowerCase();
                        return <Chip key={t} active={active} accent={AC} onClick={() => { const next = active ? '' : t; setKeyword(next); setSearchInput(next); }}>#{t}</Chip>;
                    })}
                </div>
            )}
        </>
    );

    if (authorView) {
        const authorPosts = posts.filter(p => {
            if (authorView.kind === 'character') return p.authorType === 'character' && p.charId === authorView.id;
            if (authorView.kind === 'user') return p.authorType === 'user';
            return p.authorType === 'npc' && p.author === authorView.name;
        });
        const char = authorView.id ? characters.find(c => c.id === authorView.id) : undefined;
        return (
            <InsShell accent={AC}>
                <AppHeader title={authorView.name} sub={`${authorPosts.length} 条见闻 · ${authorView.kind === 'character' ? '熟人主页' : authorView.kind === 'user' ? '我的主页' : '路人主页'}`} onBack={() => setAuthorView(null)}
                    right={authorView.kind === 'character' && char ? <InsButton variant="solid" accent={AC} onClick={() => openChatWith(char.id)} className="px-3 py-2 text-[12px]">去来往</InsButton> : <UserCircle className="w-8 h-8" style={{ color: A.solid }} weight="fill" />} />
                <div className="px-4 pb-3 relative z-10">
                    <div className="rounded-2xl bg-white p-3 flex items-center gap-3" style={{ boxShadow: '0 12px 30px -24px rgba(38,38,38,0.35)' }}>
                        <Avatar name={authorView.name} src={char?.avatar || authorPosts[0]?.authorAvatar} size={54} />
                        <div className="min-w-0 flex-1">
                            <div className="text-[15px] font-black" style={{ color: INK }}>{authorView.name}</div>
                            <div className="text-[11px] leading-relaxed mt-1" style={{ color: INK_SOFT }}>
                                {char?.socialProfile?.bio || char?.description || (authorView.kind === 'npc' ? '见闻簿里的本地路人作者。' : '见闻簿里的本地作者。')}
                            </div>
                        </div>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto no-scrollbar px-3 pb-10 relative z-10">
                    {authorPosts.length === 0 ? (
                        <div className="text-center text-[12.5px] mt-16" style={{ color: INK_SOFT }}>还没有留下见闻</div>
                    ) : (
                        <div className="flex gap-3 items-start">
                            <div className="flex-1 min-w-0">{authorPosts.filter((_, i) => i % 2 === 0).map(p => <PostCard key={p.id} post={p} onClick={() => setDetailId(p.id)} />)}</div>
                            <div className="flex-1 min-w-0">{authorPosts.filter((_, i) => i % 2 === 1).map(p => <PostCard key={p.id} post={p} onClick={() => setDetailId(p.id)} />)}</div>
                        </div>
                    )}
                </div>
            </InsShell>
        );
    }

    if (detail) {
        return (
            <InsShell accent={AC}>
                <AppHeader
                    title={detail.author}
                    sub={`${fmtTime(detail.createdAt)} · ${postAuthorKind(detail)} · ${CATEGORY_LABELS[postCategory(detail)]}`}
                    onBack={() => setDetailId(null)}
                    right={<button onClick={() => openAuthor(detail)} className="press-soft"><Avatar name={detail.author} src={detail.authorAvatar} size={36} /></button>}
                />

                <div className="flex-1 overflow-y-auto no-scrollbar pb-4 relative z-10">
                    {detail.coverUrl && <img src={detail.coverUrl} className="w-full object-cover animate-photo-develop" referrerPolicy="no-referrer" onError={(e: any) => { e.target.style.display = 'none'; }} alt="" />}
                    <div className="px-4 pt-3.5">
                        <div className="flex items-center gap-2 mb-2">
                            <button onClick={() => openAuthor(detail)} className="text-[11px] font-bold px-2.5 py-1 rounded-full press-soft" style={{ color: A.ink, background: A.soft }}>作者主页</button>
                            <span className="text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ color: INK_SOFT, background: '#f2efeb' }}>{sourceLabel(detail)}</span>
                        </div>
                        <div className="text-[18px] font-extrabold leading-snug" style={{ color: INK }}>{detail.title}</div>
                        <div className="text-[14px] leading-relaxed whitespace-pre-wrap mt-2.5" style={{ color: '#3f3c45' }}>{detail.body}</div>
                        {detail.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-3.5">
                                {detail.tags.map(t => (
                                    <button key={t} onClick={() => { setDetailId(null); setSearchInput(t); setKeyword(t); }} className="text-[12px] px-2.5 py-1 rounded-full font-medium press-soft" style={{ color: A.ink, background: A.soft }}>#{t}</button>
                                ))}
                            </div>
                        )}

                        <div className="text-[12.5px] font-bold mt-6 mb-3 flex items-center gap-1.5 pt-4" style={{ color: INK, borderTop: '1px solid rgba(0,0,0,0.06)' }}><ChatCircle className="w-4 h-4" weight="bold" style={{ color: A.solid }} />评论 {detail.comments.length}</div>
                        <div className="space-y-3.5">
                            {detail.comments.map(cm => (
                                <div key={cm.id} className="flex gap-2.5">
                                    <Avatar name={cm.author} src={(cm as any).avatar} size={30} />
                                    <div className="min-w-0 flex-1">
                                        <div className="text-[11px] flex items-center gap-1.5" style={{ color: INK_SOFT }}>
                                            <span>{cm.author}</span>
                                            {cm.isUser && <span className="text-[9px] text-white px-1.5 py-0.5 rounded-full" style={{ background: A.solid }}>我</span>}
                                            {!cm.isUser && cm.author === detail.author && <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ color: A.ink, background: A.soft }}>作者</span>}
                                        </div>
                                        <div className="text-[13.5px] leading-relaxed whitespace-pre-wrap mt-0.5" style={{ color: INK }}>{cm.content}</div>
                                        <div className="text-[10px] mt-1" style={{ color: '#bcb9b2' }}>{fmtTime(cm.timestamp)}{cm.likes > 0 ? ` · ${fmtCount(cm.likes)} 赞` : ''}</div>
                                    </div>
                                </div>
                            ))}
                            {replying && <div className="text-[11.5px] pl-10" style={{ color: INK_SOFT, fontFamily: 'var(--font-hand)' }}>{detail.author} 正在回复…</div>}
                            {detail.comments.length === 0 && !replying && <div className="text-[11.5px]" style={{ color: '#bcb9b2', fontFamily: 'var(--font-hand)' }}>还没人评论，来写第一条～</div>}
                        </div>
                    </div>
                </div>

                <div className="shrink-0 bg-white px-3 py-2.5 flex items-center gap-2 relative z-10" style={{ borderTop: '1px solid rgba(0,0,0,0.06)', paddingBottom: 'calc(var(--safe-bottom, 0px) + 10px)' }}>
                    <input
                        value={commentInput}
                        onChange={e => setCommentInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') void submitComment(); }}
                        placeholder="写条评论…"
                        className="flex-1 px-4 py-2.5 text-[13px] outline-none min-w-0 rounded-full"
                        style={{ background: '#f2efeb' }}
                    />
                    {commentInput.trim() ? (
                        <button onClick={() => void submitComment()} disabled={replying} className="w-10 h-10 flex items-center justify-center rounded-full text-white press-soft shrink-0 disabled:opacity-50" style={{ background: A.solid }}>
                            <PaperPlaneTilt className="w-5 h-5" weight="fill" />
                        </button>
                    ) : (
                        <>
                            <button onClick={() => toggleLike(detail)} className="inline-flex flex-col items-center gap-0.5 shrink-0 px-1 press-soft" style={{ color: detail.liked ? A.solid : INK_SOFT }}>
                                <Heart className="w-6 h-6" weight={detail.liked ? 'fill' : 'regular'} /><span className="text-[9px] font-bold">{fmtCount(detail.likes)}</span>
                            </button>
                            <button onClick={() => toggleFav(detail)} className="inline-flex flex-col items-center gap-0.5 shrink-0 px-1 press-soft" style={{ color: detail.faved ? '#f59e0b' : INK_SOFT }}>
                                <BookmarkSimple className="w-6 h-6" weight={detail.faved ? 'fill' : 'regular'} /><span className="text-[9px] font-bold">{fmtCount(detail.favs)}</span>
                            </button>
                            <button onClick={() => { setClipPost(detail); setClipNote(''); }} className="inline-flex flex-col items-center gap-0.5 shrink-0 px-1 press-soft" style={{ color: INK_SOFT }}>
                                <Scissors className="w-6 h-6" weight="regular" /><span className="text-[9px] font-bold">剪藏</span>
                            </button>
                            <button onClick={() => setSharePost(detail)} className="inline-flex flex-col items-center gap-0.5 shrink-0 px-1 press-soft" style={{ color: INK_SOFT }}>
                                <PaperPlaneTilt className="w-6 h-6" weight="regular" /><span className="text-[9px] font-bold">递给</span>
                            </button>
                        </>
                    )}
                </div>
            </InsShell>
        );
    }

    if (mode === 'meet') {
        const deck = meetFilter === 'all' ? dating : dating.filter(p => p.intent === meetFilter);
        const cur = deck[datingIdx];
        const remaining = deck.length - datingIdx;
        return (
            <InsShell accent={AC}>
                <AppHeader
                    title="发现"
                    sub="附近正在交友的人，各有各的目的"
                    onBack={closeApp}
                    right={
                        <div className="flex items-center gap-2">
                            <button onClick={() => setShowLiked(true)} title="我喜欢的" className="relative w-9 h-9 flex items-center justify-center rounded-full bg-white press-soft" style={{ color: A.solid, boxShadow: '0 4px 14px -6px rgba(38,38,38,0.28)' }}>
                                <Heart className="w-5 h-5" weight="fill" />
                                {liked.length > 0 && <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 text-white text-[9px] font-bold flex items-center justify-center rounded-full" style={{ background: A.solid }}>{liked.length}</span>}
                            </button>
                            <InsButton variant="solid" accent={AC} onClick={() => void refreshDating()} disabled={datingBusy} className="px-3 py-2 text-[12px]" icon={datingBusy ? <Spinner className="w-4 h-4 animate-spin" weight="bold" /> : <Shuffle className="w-4 h-4" weight="bold" />}>
                                {datingBusy ? '搜寻中' : '换一批'}
                            </InsButton>
                        </div>
                    }
                />
                <ModeTabs mode={mode} setMode={setMode} />
                <div className="flex items-center gap-2 px-3 pb-2 shrink-0 overflow-x-auto no-scrollbar relative z-10">
                    <Chip active={meetFilter === 'all'} accent={AC} onClick={() => { setMeetFilter('all'); setDatingIdx(0); }}>全部</Chip>
                    {DATING_INTENTS.map(it => (
                        <Chip key={it.key} active={meetFilter === it.key} accent={AC} onClick={() => { setMeetFilter(it.key); setDatingIdx(0); }}>{it.emoji} {it.label}</Chip>
                    ))}
                </div>
                <div className="px-4 pb-2 relative z-10">
                    <input
                        value={greetInput}
                        onChange={e => setGreetInput(e.target.value)}
                        placeholder="自定义一句打招呼，可留空"
                        className="w-full px-4 py-2.5 rounded-full text-[12.5px] outline-none"
                        style={{ background: '#fff', color: INK, border: '1px solid rgba(0,0,0,0.05)' }}
                    />
                </div>
                <div className="flex-1 overflow-y-auto no-scrollbar flex flex-col items-center justify-center px-4 py-5 relative z-10">
                    {datingBusy && dating.length === 0 ? (
                        <div className="text-[12.5px] flex items-center gap-2" style={{ color: INK_SOFT }}><Spinner className="w-4 h-4 animate-spin" />正在发现身边的人…</div>
                    ) : !cur ? (
                        <div className="text-center">
                            <div className="text-4xl mb-3">👀</div>
                            <div className="text-[15px] font-bold mb-4" style={{ color: INK }}>{meetFilter === 'all' ? '附近的人都看完啦' : '这类目的的人看完了'}</div>
                            <InsButton variant="solid" accent={AC} onClick={() => meetFilter === 'all' ? void refreshDating() : (setMeetFilter('all'), setDatingIdx(0))} className="px-5 py-2.5 text-[13px]">{meetFilter === 'all' ? '再发现一批' : '看看全部'}</InsButton>
                        </div>
                    ) : (
                        <DatingCard key={cur.id} p={cur} remaining={remaining} onAct={(a) => datingAct(cur, a)} />
                    )}
                </div>

                <InsSheet open={showLiked} title={`我喜欢的 · ${liked.length}`} onClose={() => setShowLiked(false)}>
                    <div className="max-h-[62vh] overflow-y-auto no-scrollbar space-y-2.5">
                        {liked.length === 0 ? <div className="text-center text-[12.5px] py-10" style={{ color: INK_SOFT, fontFamily: 'var(--font-hand)' }}>还没喜欢过谁，去发现几个吧～</div> : liked.map(l => (
                            <div key={l.id} className="flex items-center gap-3 p-2.5 rounded-2xl" style={{ background: '#f7f5f2' }}>
                                {l.avatar ? <img src={l.avatar} className="w-11 h-11 rounded-full object-cover shrink-0" alt="" /> : <span className="w-11 h-11 rounded-full flex items-center justify-center text-[22px] shrink-0" style={{ background: A.soft }}>{l.emoji}</span>}
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[13.5px] font-bold truncate" style={{ color: INK }}>{l.name}</span>
                                        {l.matched && <span className="text-[9px] text-white px-1.5 py-0.5 rounded-full shrink-0" style={{ background: A.solid }}>已匹配</span>}
                                        {!l.matched && l.greeted && <span className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0" style={{ color: A.ink, background: A.soft }}>已打招呼</span>}
                                        <span className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0" style={{ color: A.ink, background: A.soft }}>{intentMeta(l.intent).label}</span>
                                    </div>
                                    <div className="text-[11px] truncate mt-0.5" style={{ color: INK_SOFT }}>{l.bio}</div>
                                </div>
                                {(l.matched || l.greeted || l.isChar) && <InsButton variant="solid" accent={AC} onClick={() => void convertDatingToContact(l)} className="shrink-0 px-3 py-1.5 text-[11px]">{l.isChar || l.convertedCharId ? '去聊' : '收下'}</InsButton>}
                            </div>
                        ))}
                    </div>
                </InsSheet>

                <InsDialog open={!!greetCard} accent={AC} onClose={() => setGreetCard(null)}
                    actions={greetCard ? <>
                        <InsButton variant="soft" accent="slate" onClick={() => setGreetCard(null)} className="flex-1 py-2.5 text-[12px]">先这样</InsButton>
                        <InsButton variant="solid" accent={AC} onClick={() => void convertDatingToContact(greetCard.p)} disabled={greetCard.busy} className="flex-1 py-2.5 text-[12px]">{greetCard.p.isChar ? '进「来往」聊' : '收为联系人'}</InsButton>
                    </> : null}>
                    {greetCard && (
                        <div className="text-left">
                            <div className="flex items-center gap-2.5 mb-3">
                                {greetCard.p.avatar ? <img src={greetCard.p.avatar} className="w-11 h-11 rounded-full object-cover" alt="" /> : <span className="w-11 h-11 rounded-full flex items-center justify-center text-[24px]" style={{ background: A.soft }}>{greetCard.p.emoji}</span>}
                                <div className="min-w-0">
                                    <div className="text-[14px] font-bold flex items-center gap-1.5" style={{ color: INK }}>{greetCard.p.name}{greetCard.matched && <span className="text-[9px] text-white px-1.5 py-0.5 rounded-full" style={{ background: A.solid }}>匹配成功</span>}</div>
                                    <div className="text-[10px]" style={{ color: INK_SOFT }}>{intentMeta(greetCard.p.intent).emoji} {intentMeta(greetCard.p.intent).label} · {greetCard.p.distanceKm}km</div>
                                </div>
                            </div>
                            <div className="px-3.5 py-3 text-[13px] leading-relaxed min-h-[52px] flex items-center rounded-2xl" style={{ background: '#f7f5f2', color: INK }}>
                                {greetCard.busy ? <span className="flex items-center gap-1.5" style={{ color: INK_SOFT, fontFamily: 'var(--font-hand)' }}><Spinner className="w-3.5 h-3.5 animate-spin" />{greetCard.p.name} 正在回复…</span> : greetCard.reply}
                            </div>
                        </div>
                    )}
                </InsDialog>
            </InsShell>
        );
    }

    return (
        <InsShell accent={AC}>
            <AppHeader
                title="见闻簿"
                sub={mode === 'favorites' ? `收藏 ${favoritePosts.length} 张` : mode === 'friends' ? '熟人的公开近况' : posts.length > 0 ? `已贴 ${posts.length} 张卡片` : '一本贴满见闻的簿子'}
                onBack={closeApp}
                right={
                    <div className="flex items-center gap-2">
                        <IconCircle
                            onClick={openSocialApiSheet}
                            title={socialApiOverrideOn ? '见闻簿专用 API 已启用' : '见闻簿专用 API'}
                            tone={socialApiOverrideOn ? 'ink' : 'paper'}
                        >
                            <PlugsConnected className="w-4 h-4" weight={socialApiOverrideOn ? 'fill' : 'bold'} />
                        </IconCircle>
                        <IconCircle onClick={() => openApp(AppID.XhsStock)} title="素材堆（发帖备图）"><Stack className="w-4 h-4" weight="bold" /></IconCircle>
                        <IconCircle onClick={() => {
                            queueManualDeepLink({ appId: AppID.CoView, route: 'free_roam', anchorId: 'manual-coview-free-roam', payload: { tab: 'free_roam' } });
                            openApp(AppID.CoView);
                        }} title="出门转转（共览 / 自由活动）"><Binoculars className="w-4 h-4" weight="bold" /></IconCircle>
                    </div>
                }
            />
            <ModeTabs mode={mode} setMode={setMode} />

            {mode === 'friends' && (
                <div className="flex items-center gap-2 px-3 pb-2 shrink-0 overflow-x-auto no-scrollbar relative z-10">
                    <Chip active={friendFilter === 'all'} accent={AC} onClick={() => setFriendFilter('all')}>全部熟人</Chip>
                    {characters.map(c => (
                        <button
                            key={c.id}
                            onClick={() => setFriendFilter(c.id)}
                            className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold press-soft"
                            style={{ color: friendFilter === c.id ? '#fff' : A.ink, background: friendFilter === c.id ? A.solid : A.soft }}
                        >
                            <Avatar name={c.name} src={c.avatar} size={18} />{c.convoSettings?.remarkName?.trim() || c.name}
                        </button>
                    ))}
                </div>
            )}

            {renderSearchAndFilters()}

            {mode === 'friends' && (
                <div className="px-3 pb-2 shrink-0 relative z-10">
                    <div className="rounded-2xl bg-white p-3 flex items-center gap-2" style={{ boxShadow: '0 8px 22px -18px rgba(38,38,38,0.35)' }}>
                        <div className="min-w-0 flex-1">
                            <div className="text-[12px] font-bold" style={{ color: INK }}>让熟人更新近况</div>
                            <div className="text-[10.5px] mt-0.5 truncate" style={{ color: INK_SOFT }}>生成一条本地生活动态，同时写入自由活动记录</div>
                        </div>
                        <InsButton
                            variant="solid"
                            accent={AC}
                            disabled={!characters.length || !!friendGeneratingId}
                            onClick={() => {
                                const char = characters.find(c => c.id === friendFilter) || characters[0];
                                if (char) void generateFriendPost(char);
                            }}
                            className="px-3 py-2 text-[12px]"
                            icon={friendGeneratingId ? <Spinner className="w-4 h-4 animate-spin" /> : <PencilSimple className="w-4 h-4" weight="bold" />}
                        >
                            {friendGeneratingId ? '写着' : '更新'}
                        </InsButton>
                    </div>
                </div>
            )}

            {mode === 'favorites'
                ? renderPostGrid('还没有收藏', '点详情里的收藏，或把喜欢的卡片剪下来。')
                : mode === 'friends'
                    ? renderPostGrid(characters.length ? '熟人还没发见闻' : '还没有熟人', characters.length ? '可以点上面的“更新”，让某位熟人写一条本地近况。' : '先去剪影集创建角色。')
                    : renderPostGrid('簿子还是空白页', `点“翻新页”剪一沓贴上：熟人按性子发，路人补足生活气。${!apiReady ? '记得先去「文具盒」把 API 补上。' : ''}`)}

            <InsSheet
                open={showSocialApiSheet}
                title="见闻簿专用 API"
                onClose={() => setShowSocialApiSheet(false)}
                right={<span className="text-[10px] font-bold px-2 py-1 rounded-full" style={{ color: socialApiOverrideOn ? '#fff' : INK_SOFT, background: socialApiOverrideOn ? A.solid : '#f2efeb' }}>{socialApiOverrideOn ? '优先使用' : '未启用'}</span>}
            >
                <div className="space-y-3 text-left">
                    <div className="rounded-2xl p-3 text-[11px] leading-relaxed" style={{ background: A.soft, color: A.ink }}>
                        填完整后，见闻簿的翻新页、熟人近况、评论回复和交友会优先走这里；清除后自动回到文具盒副 API / 主 API。自由活动的真实平台 MCP 不受影响。
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                        <InsButton variant="soft" accent={AC} onClick={copyMainToSocialApi} className="py-2 text-[12px]">复制主 API</InsButton>
                        <InsButton variant="soft" accent={AC} onClick={copyAuxToSocialApi} className="py-2 text-[12px]">复制副 API</InsButton>
                        <InsButton variant="soft" accent={AC} onClick={() => void fetchSocialApiModels()} disabled={fetchingSocialModels} className="py-2 text-[12px]">
                            {fetchingSocialModels ? '拉取中' : '拉取模型'}
                        </InsButton>
                    </div>
                    <div>
                        <label className="text-[10px] font-bold" style={{ color: INK_SOFT }}>BASE URL · 接口地址</label>
                        <input
                            value={socialApiDraft.baseUrl}
                            onChange={e => setSocialApiDraftField('baseUrl', e.target.value)}
                            placeholder="https://your-api.example.com/v1"
                            className="mt-1 w-full px-3 py-2.5 rounded-2xl text-[13px] outline-none font-mono"
                            style={{ background: '#f2efeb', color: INK }}
                        />
                    </div>
                    <div>
                        <label className="text-[10px] font-bold" style={{ color: INK_SOFT }}>API KEY · 密钥</label>
                        <input
                            type="password"
                            value={socialApiDraft.apiKey}
                            onChange={e => setSocialApiDraftField('apiKey', e.target.value)}
                            placeholder="可留空，本地接口会自动用免鉴权兜底"
                            className="mt-1 w-full px-3 py-2.5 rounded-2xl text-[13px] outline-none font-mono"
                            style={{ background: '#f2efeb', color: INK }}
                        />
                    </div>
                    <div>
                        <label className="text-[10px] font-bold" style={{ color: INK_SOFT }}>MODEL · 模型名</label>
                        <input
                            value={socialApiDraft.model}
                            onChange={e => setSocialApiDraftField('model', e.target.value)}
                            placeholder="模型名"
                            className="mt-1 w-full px-3 py-2.5 rounded-2xl text-[13px] outline-none font-mono"
                            style={{ background: '#f2efeb', color: INK }}
                        />
                        {socialApiModels.length > 0 && (
                            <div className="mt-2 rounded-2xl overflow-hidden" style={{ background: '#f7f5f2', border: '1px solid rgba(38,38,38,0.08)' }}>
                                <button
                                    type="button"
                                    onClick={() => setShowSocialApiModels(v => !v)}
                                    className="w-full px-3 py-2 flex items-center justify-between text-[11px] font-bold"
                                    style={{ color: INK }}
                                >
                                    <span>已拉取 {socialApiModels.length} 个模型</span>
                                    <span>{showSocialApiModels ? '收起' : '选择'}</span>
                                </button>
                                {showSocialApiModels && (
                                    <div className="max-h-44 overflow-y-auto p-1.5 space-y-1">
                                        {socialApiModels.map(model => (
                                            <button
                                                key={model}
                                                type="button"
                                                onClick={() => {
                                                    setSocialApiDraftField('model', model);
                                                    setShowSocialApiModels(false);
                                                    setSocialApiStatus('已选择模型，保存后生效');
                                                }}
                                                className="w-full text-left px-2.5 py-1.5 rounded-xl text-[11px] font-mono break-all"
                                                style={{
                                                    background: socialApiDraft.model.trim() === model ? A.soft : 'transparent',
                                                    color: socialApiDraft.model.trim() === model ? A.ink : INK_SOFT,
                                                }}
                                            >
                                                {model}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    {socialApiStatus && (
                        <div className="rounded-2xl px-3 py-2 text-[11px] leading-relaxed" style={{ color: INK_SOFT, background: '#f7f5f2' }}>
                            {socialApiStatus}
                        </div>
                    )}
                    <div className="grid grid-cols-3 gap-2">
                        <InsButton variant="soft" accent="slate" onClick={() => void testSocialApi()} disabled={testingSocialApi} className="py-2.5 text-[12px]">
                            {testingSocialApi ? '测试中' : '测试'}
                        </InsButton>
                        <InsButton variant="soft" accent="slate" onClick={clearSocialApi} className="py-2.5 text-[12px]">清除</InsButton>
                        <InsButton variant="solid" accent={AC} onClick={saveSocialApi} className="py-2.5 text-[12px]">保存</InsButton>
                    </div>
                </div>
            </InsSheet>

            <InsDialog open={composeOpen} title="发一条" en="LOCAL POST" accent={AC} onClose={() => setComposeOpen(false)}
                actions={<>
                    <InsButton variant="soft" accent="slate" onClick={() => setComposeOpen(false)} className="flex-1 py-2.5 text-[13px]">先不发</InsButton>
                    <InsButton variant="solid" accent={AC} onClick={() => void submitCompose()} className="flex-1 py-2.5 text-[13px]">贴上去</InsButton>
                </>}>
                <div className="space-y-3 text-left">
                    <input value={composeTitle} onChange={e => setComposeTitle(e.target.value)} placeholder="标题" className="w-full px-3 py-2.5 text-[13px] rounded-2xl outline-none" style={{ background: '#f2efeb', color: INK }} />
                    <textarea value={composeBody} onChange={e => setComposeBody(e.target.value)} placeholder="写一点今天见到、听到、想到的事" className="w-full h-28 p-3 text-[13px] resize-none outline-none rounded-2xl" style={{ background: '#f2efeb', color: INK }} />
                    <input value={composeTags} onChange={e => setComposeTags(e.target.value)} placeholder="标签，用空格或逗号分隔" className="w-full px-3 py-2.5 text-[13px] rounded-2xl outline-none" style={{ background: '#f2efeb', color: INK }} />
                    <div className="flex flex-wrap gap-1.5">
                        {XHS_FEED_CATEGORIES.map(c => <Chip key={c.key} active={composeCategory === c.key} accent={AC} onClick={() => setComposeCategory(c.key)}>{c.label}</Chip>)}
                    </div>
                </div>
            </InsDialog>

            <InsDialog open={!!clipPost} title="剪下来" en="CLIP IT" accent={AC} onClose={() => setClipPost(null)}
                actions={<>
                    <InsButton variant="soft" accent="slate" onClick={() => setClipPost(null)} className="flex-1 py-2.5 text-[13px]">放回去</InsButton>
                    <InsButton variant="solid" accent={AC} onClick={() => void submitClip()} className="flex-1 py-2.5 text-[13px]">收进收藏</InsButton>
                </>}>
                {clipPost && (
                    <div className="text-left">
                        <div className="px-3 py-2.5 rounded-2xl text-[12px] line-clamp-2 mb-3" style={{ background: A.soft, color: A.ink }}>@{clipPost.author}：{clipPost.title}</div>
                        <textarea value={clipNote} onChange={e => setClipNote(e.target.value)} placeholder="想加一句评论？（可留空）" className="w-full h-20 p-3 text-[13px] resize-none outline-none rounded-2xl" style={{ background: '#f2efeb', color: INK }} />
                    </div>
                )}
            </InsDialog>

            <InsSheet open={!!sharePost} title="递给角色" onClose={() => setSharePost(null)}>
                {sharePost && (
                    <div className="mb-3 px-3.5 py-2.5 rounded-2xl flex items-start gap-2" style={{ background: A.soft }}>
                        <PaperPlaneTilt size={15} weight="fill" className="shrink-0 mt-0.5" style={{ color: A.solid }} />
                        <p className="text-[12.5px] line-clamp-2 leading-snug font-medium" style={{ color: A.ink }}>{sharePost.title}</p>
                    </div>
                )}
                {characters.length === 0 ? (
                    <div className="text-center text-xs py-8" style={{ color: INK_SOFT }}>还没有可转发的角色</div>
                ) : (
                    <div className="grid grid-cols-4 gap-x-3 gap-y-4 pt-1 pb-2 max-h-[46vh] overflow-y-auto no-scrollbar">
                        {characters.map(c => (
                            <button key={c.id} onClick={() => void shareToCharacter(c)} className="flex flex-col items-center gap-1.5 press-soft">
                                <StoryRing src={c.avatar} size={52} active fallback={(c.convoSettings?.remarkName?.trim() || c.name)?.charAt(0)} />
                                <span className="text-[10.5px] truncate w-full text-center font-medium" style={{ color: INK }}>{c.convoSettings?.remarkName?.trim() || c.name}</span>
                            </button>
                        ))}
                    </div>
                )}
            </InsSheet>

            <InsSheet open={showLiked} title={`我喜欢的 · ${liked.length}`} onClose={() => setShowLiked(false)}>
                <div className="max-h-[62vh] overflow-y-auto no-scrollbar space-y-2.5">
                    {liked.length === 0 ? <div className="text-center text-[12.5px] py-10" style={{ color: INK_SOFT, fontFamily: 'var(--font-hand)' }}>还没喜欢过谁，去发现几个吧～</div> : liked.map(l => (
                        <div key={l.id} className="flex items-center gap-3 p-2.5 rounded-2xl" style={{ background: '#f7f5f2' }}>
                            {l.avatar ? <img src={l.avatar} className="w-11 h-11 rounded-full object-cover shrink-0" alt="" /> : <span className="w-11 h-11 rounded-full flex items-center justify-center text-[22px] shrink-0" style={{ background: A.soft }}>{l.emoji}</span>}
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                    <span className="text-[13.5px] font-bold truncate" style={{ color: INK }}>{l.name}</span>
                                    {l.matched && <span className="text-[9px] text-white px-1.5 py-0.5 rounded-full shrink-0" style={{ background: A.solid }}>已匹配</span>}
                                    {!l.matched && l.greeted && <span className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0" style={{ color: A.ink, background: A.soft }}>已打招呼</span>}
                                    <span className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0" style={{ color: A.ink, background: A.soft }}>{intentMeta(l.intent).label}</span>
                                </div>
                                <div className="text-[11px] truncate mt-0.5" style={{ color: INK_SOFT }}>{l.bio}</div>
                            </div>
                            {(l.matched || l.greeted || l.isChar) && <InsButton variant="solid" accent={AC} onClick={() => void convertDatingToContact(l)} className="shrink-0 px-3 py-1.5 text-[11px]">{l.isChar || l.convertedCharId ? '去聊' : '收下'}</InsButton>}
                        </div>
                    ))}
                </div>
            </InsSheet>

            <InsDialog open={!!greetCard} accent={AC} onClose={() => setGreetCard(null)}
                actions={greetCard ? <>
                    <InsButton variant="soft" accent="slate" onClick={() => setGreetCard(null)} className="flex-1 py-2.5 text-[12px]">先这样</InsButton>
                    <InsButton variant="solid" accent={AC} onClick={() => void convertDatingToContact(greetCard.p)} disabled={greetCard.busy} className="flex-1 py-2.5 text-[12px]">{greetCard.p.isChar ? '进「来往」聊' : '收为联系人'}</InsButton>
                </> : null}>
                {greetCard && (
                    <div className="text-left">
                        <div className="flex items-center gap-2.5 mb-3">
                            {greetCard.p.avatar ? <img src={greetCard.p.avatar} className="w-11 h-11 rounded-full object-cover" alt="" /> : <span className="w-11 h-11 rounded-full flex items-center justify-center text-[24px]" style={{ background: A.soft }}>{greetCard.p.emoji}</span>}
                            <div className="min-w-0">
                                <div className="text-[14px] font-bold flex items-center gap-1.5" style={{ color: INK }}>{greetCard.p.name}{greetCard.matched && <span className="text-[9px] text-white px-1.5 py-0.5 rounded-full" style={{ background: A.solid }}>匹配成功</span>}</div>
                                <div className="text-[10px]" style={{ color: INK_SOFT }}>{intentMeta(greetCard.p.intent).emoji} {intentMeta(greetCard.p.intent).label} · {greetCard.p.distanceKm}km</div>
                            </div>
                        </div>
                        <div className="px-3.5 py-3 text-[13px] leading-relaxed min-h-[52px] flex items-center rounded-2xl" style={{ background: '#f7f5f2', color: INK }}>
                            {greetCard.busy ? <span className="flex items-center gap-1.5" style={{ color: INK_SOFT, fontFamily: 'var(--font-hand)' }}><Spinner className="w-3.5 h-3.5 animate-spin" />{greetCard.p.name} 正在回复…</span> : greetCard.reply}
                        </div>
                    </div>
                )}
            </InsDialog>

            <InsDialog open={confirmClear} title="清空整簿？" en="CLEAR ALL" accent={AC} onClose={() => setConfirmClear(false)}
                actions={<>
                    <InsButton variant="soft" accent="slate" onClick={() => setConfirmClear(false)} className="flex-1 py-2.5 text-[13px]">留着</InsButton>
                    <InsButton variant="solid" accent={AC} onClick={() => void clearFeed()} className="flex-1 py-2.5 text-[13px]">全部撕掉</InsButton>
                </>}>
                簿子里这一沓卡片会全部撕掉，没法再找回来。已经递给角色的聊天卡片不会跟着删除。
            </InsDialog>
        </InsShell>
    );
};

export default SocialApp;
