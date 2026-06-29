import React, { useEffect, useMemo, useState } from 'react';
import {
    ArrowClockwise, BookmarkSimple, Bell, CaretLeft, ChatCircle, CheckCircle, EnvelopeSimple, Export,
    GlobeHemisphereWest, Heart, House, ImageSquare, LinkSimple, MagnifyingGlass, MapPin, PaperPlaneTilt,
    PencilSimple, Repeat, Spinner, Translate, Trash, User, UserPlus, XLogo,
} from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import {
    AppID, MessageType, TwitterAccount, TwitterDMThread, TwitterNotification,
    TwitterProfile, TwitterReply, TwitterTweet,
} from '../types';
import { DB } from '../utils/db';
import { resolveAuxApi } from '../utils/auxApi';
import {
    TWITTER_BATCH_SIZE,
    TWITTER_TRANSLATION_TARGET_KEY,
    accountFromCharacter,
    appendTwitterDMMessage,
    buildTwitterAccounts,
    buildTwitterTrends,
    cacheTwitterContextSummary,
    createDMThread,
    createTwitterReply,
    createTwitterSearchRecord,
    createUserTweet,
    defaultTwitterProfile,
    fallbackTwitterTweets,
    generateTwitterAuthorReply,
    generateTwitterDMReply,
    generateTwitterReactions,
    generateTwitterSearchTweets,
    generateTwitterTimeline,
    getTwitterLocalTargetLang,
    getTwitterTranslationText,
    isSameTwitterLanguage,
    normalizeHandle,
    normalizeTwitterLang,
    searchTwitter,
    translateTwitterTextLocal,
    translateTwitterText,
    twitterTranslationLabel,
    twitterAccountIdFor,
} from '../utils/twitterFeed';

type Tab = 'home' | 'search' | 'notifications' | 'dms' | 'profile';
type FeedMode = 'forYou' | 'following';
type SearchPane = 'top' | 'latest' | 'people' | 'media';
type ProfilePane = 'posts' | 'replies' | 'media' | 'likes' | 'bookmarks';

const LANGS = [
    { id: '', label: '全部' },
    { id: 'zh-CN', label: '中文' },
    { id: 'en', label: 'EN' },
    { id: 'ja', label: '日本語' },
    { id: 'ko', label: '한국어' },
    { id: 'es', label: 'ES' },
    { id: 'fr', label: 'FR' },
];

const fmtCount = (n: number): string => {
    if (n >= 100000000) return `${(n / 100000000).toFixed(1)}亿`;
    if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return String(Math.max(0, Math.floor(n || 0)));
};

const fmtTime = (ts: number): string => {
    const diff = Date.now() - ts;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时`;
    const d = new Date(ts);
    return `${d.getMonth() + 1}月${d.getDate()}日`;
};

const shouldOfferTranslation = (sourceLang: string | undefined, targetLang: string): boolean =>
    !!sourceLang && !isSameTwitterLanguage(sourceLang, targetLang);

const Avatar: React.FC<{ name: string; src?: string; size?: number; onClick?: () => void }> = ({ name, src, size = 40, onClick }) => {
    const body = src
        ? <img src={src} className="rounded-full object-cover shrink-0 bg-[#eff3f4]" style={{ width: size, height: size }} alt="" />
        : <div className="rounded-full bg-[#0f1419] text-white flex items-center justify-center font-black shrink-0" style={{ width: size, height: size, fontSize: size * 0.42 }}>{name.slice(0, 1).toUpperCase()}</div>;
    if (!onClick) return body;
    return <button onClick={(e) => { e.stopPropagation(); onClick(); }} className="shrink-0 active:scale-95">{body}</button>;
};

const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="w-full h-full bg-white text-[#0f1419] flex flex-col overflow-hidden" style={{ fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
        {children}
    </div>
);

const IconButton: React.FC<{ title: string; onClick?: () => void; children: React.ReactNode; active?: boolean; disabled?: boolean }> = ({ title, onClick, children, active, disabled }) => (
    <button
        title={title}
        onClick={onClick}
        disabled={disabled}
        className="w-9 h-9 rounded-full flex items-center justify-center active:scale-95 transition disabled:opacity-40"
        style={{ color: active ? '#1d9bf0' : '#536471', background: active ? 'rgba(29,155,240,0.1)' : 'transparent' }}
    >
        {children}
    </button>
);

const Pill: React.FC<{ active?: boolean; children: React.ReactNode; onClick?: () => void }> = ({ active, children, onClick }) => (
    <button
        onClick={onClick}
        className="h-8 px-3 rounded-full border text-[12px] font-bold shrink-0"
        style={{ borderColor: active ? '#0f1419' : '#cfd9de', background: active ? '#0f1419' : '#fff', color: active ? '#fff' : '#536471' }}
    >
        {children}
    </button>
);

const TranslationBlock: React.FC<{ text?: string }> = ({ text }) => {
    if (!text) return null;
    return (
        <div className="mt-2 rounded-2xl bg-[#f7f9f9] border border-[#eff3f4] px-3 py-2">
            <div className="text-[11px] text-[#536471] mb-1">译文</div>
            <div className="text-[14px] leading-relaxed whitespace-pre-wrap break-words">{text}</div>
        </div>
    );
};

const SourceTweet: React.FC<{ tweet: TwitterTweet['sourceTweet']; onOpen?: () => void }> = ({ tweet, onOpen }) => {
    if (!tweet) return null;
    return (
        <button onClick={(e) => { e.stopPropagation(); onOpen?.(); }} className="w-full text-left rounded-2xl border border-[#cfd9de] px-3 py-2.5 mt-3 active:bg-[#f7f9f9]">
            <div className="text-[13px] font-bold truncate">{tweet.authorName} <span className="font-normal text-[#536471]">{tweet.authorHandle}</span></div>
            <div className="text-[13px] text-[#0f1419] line-clamp-3 whitespace-pre-wrap mt-1">{tweet.content}</div>
        </button>
    );
};

const AccountRow: React.FC<{ account: TwitterAccount; onOpen: () => void; onFollow?: () => void; onDM?: () => void }> = ({ account, onOpen, onFollow, onDM }) => (
    <button onClick={onOpen} className="w-full px-4 py-3 border-b border-[#eff3f4] text-left active:bg-[#f7f9f9]">
        <div className="flex gap-3">
            <Avatar name={account.displayName} src={account.avatar} />
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1 min-w-0">
                    <span className="font-black text-[15px] truncate">{account.displayName}</span>
                    {account.verified && <CheckCircle size={14} weight="fill" color="#1d9bf0" />}
                    <span className="text-[#536471] text-[13px] truncate">{account.handle}</span>
                </div>
                <div className="text-[13px] text-[#536471] line-clamp-2 mt-0.5">{account.bio || '这个账号还没有简介。'}</div>
                <div className="text-[12px] text-[#536471] mt-1">{fmtCount(account.followers)} followers {account.language ? `· ${account.language}` : ''}</div>
            </div>
            <div className="shrink-0 flex flex-col gap-2">
                {onFollow && <button onClick={(e) => { e.stopPropagation(); onFollow(); }} className="h-8 px-3 rounded-full bg-[#0f1419] text-white text-[12px] font-black">{account.followed ? 'Following' : 'Follow'}</button>}
                {onDM && <button onClick={(e) => { e.stopPropagation(); onDM(); }} className="h-8 w-8 rounded-full border border-[#cfd9de] flex items-center justify-center"><EnvelopeSimple size={16} /></button>}
            </div>
        </div>
    </button>
);

const TwitterApp: React.FC = () => {
    const { closeApp, apiConfig, auxApiConfig, characters, userProfile, addToast, setActiveCharacterId, openApp } = useOS();
    const feedApi = resolveAuxApi(auxApiConfig, apiConfig);
    const apiReady = !!feedApi?.baseUrl && !!feedApi?.model;

    const [tweets, setTweets] = useState<TwitterTweet[]>([]);
    const [notifications, setNotifications] = useState<TwitterNotification[]>([]);
    const [accounts, setAccounts] = useState<TwitterAccount[]>([]);
    const [profile, setProfile] = useState<TwitterProfile | null>(null);
    const [dmThreads, setDmThreads] = useState<TwitterDMThread[]>([]);
    const [searchRecords, setSearchRecords] = useState<{ id: string; query: string; resultCount?: number; createdAt: number }[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [busy, setBusy] = useState(false);
    const [tab, setTab] = useState<Tab>('home');
    const [mode, setMode] = useState<FeedMode>('forYou');
    const [searchPane, setSearchPane] = useState<SearchPane>('top');
    const [profilePane, setProfilePane] = useState<ProfilePane>('posts');
    const [detailId, setDetailId] = useState<string | null>(null);
    const [accountId, setAccountId] = useState<string | null>(null);
    const [activeDMId, setActiveDMId] = useState<string | null>(null);
    const [query, setQuery] = useState('');
    const [langFilter, setLangFilter] = useState('');
    const [mediaOnly, setMediaOnly] = useState(false);
    const [composeOpen, setComposeOpen] = useState(false);
    const [composeText, setComposeText] = useState('');
    const [replyTarget, setReplyTarget] = useState<TwitterTweet | null>(null);
    const [quoteTarget, setQuoteTarget] = useState<TwitterTweet | null>(null);
    const [shareTarget, setShareTarget] = useState<TwitterTweet | null>(null);
    const [dmShareTarget, setDmShareTarget] = useState<TwitterTweet | null>(null);
    const [selectedCharId, setSelectedCharId] = useState('');
    const [dmInput, setDmInput] = useState('');
    const [profileEditorOpen, setProfileEditorOpen] = useState(false);
    const [profileDraft, setProfileDraft] = useState<TwitterProfile | null>(null);
    const [translationTarget, setTranslationTarget] = useState(() => getTwitterLocalTargetLang());
    const [translationVisible, setTranslationVisible] = useState<Set<string>>(new Set());
    const [translationBusy, setTranslationBusy] = useState<Set<string>>(new Set());
    const [searchBusy, setSearchBusy] = useState(false);

    const detail = useMemo(() => tweets.find(t => t.id === detailId) || null, [tweets, detailId]);
    const selectedAccount = useMemo(() => accounts.find(a => a.id === accountId) || null, [accounts, accountId]);
    const activeDM = useMemo(() => dmThreads.find(t => t.id === activeDMId) || null, [dmThreads, activeDMId]);
    const trends = useMemo(() => buildTwitterTrends(tweets), [tweets]);
    const unread = notifications.filter(n => !n.read).length;
    const dmUnread = dmThreads.reduce((sum, t) => sum + (t.unreadCount || 0), 0);

    useEffect(() => {
        if (!profile?.language) return;
        setTranslationTarget(prev => prev || getTwitterLocalTargetLang(profile.language));
    }, [profile?.language]);

    const upsertAccounts = async (nextAccounts: TwitterAccount[]) => {
        const map = new Map(accounts.map(a => [a.id, a]));
        nextAccounts.forEach(a => map.set(a.id, { ...(map.get(a.id) || {}), ...a, updatedAt: Date.now() }));
        const merged = [...map.values()];
        setAccounts(merged);
        await DB.saveTwitterAccounts(nextAccounts).catch(() => undefined);
        return merged;
    };

    useEffect(() => {
        (async () => {
            const [storedTweets, storedNotifs, storedProfile, storedAccounts, storedDM, storedSearch] = await Promise.all([
                DB.getTwitterTweets().catch(() => []),
                DB.getTwitterNotifications().catch(() => []),
                DB.getTwitterProfile().catch(() => null),
                DB.getTwitterAccounts().catch(() => []),
                DB.getTwitterDMThreads().catch(() => []),
                DB.getTwitterSearchRecords().catch(() => []),
            ]);
            const nextProfile = storedProfile || defaultTwitterProfile(userProfile);
            if (!storedProfile) await DB.saveTwitterProfile(nextProfile).catch(() => undefined);
            const initialTweets = storedTweets.length ? storedTweets : fallbackTwitterTweets(characters, userProfile);
            if (!storedTweets.length) await DB.saveTwitterTweets(initialTweets).catch(() => undefined);
            const mergedAccounts = buildTwitterAccounts(characters, userProfile, nextProfile, storedAccounts, initialTweets);
            await DB.saveTwitterAccounts(mergedAccounts).catch(() => undefined);
            setProfile(nextProfile);
            setTweets(initialTweets);
            setAccounts(mergedAccounts);
            setNotifications(storedNotifs);
            setDmThreads(storedDM);
            setSearchRecords(storedSearch);
            cacheTwitterContextSummary(initialTweets, 12, storedDM);
            setLoaded(true);
            if (!storedTweets.length && apiReady) void refreshTimeline();
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const openAccountForTweet = (tweet: TwitterTweet) => {
        const id = tweet.accountId || twitterAccountIdFor(tweet.authorType, tweet.charId || tweet.authorHandle || tweet.authorName);
        let account = accounts.find(a => a.id === id);
        if (!account && tweet.authorType === 'character' && tweet.charId) {
            const char = characters.find(c => c.id === tweet.charId);
            if (char) account = accountFromCharacter(char);
        }
        if (!account) {
            account = {
                id,
                authorType: tweet.authorType,
                charId: tweet.charId,
                displayName: tweet.authorName,
                handle: tweet.authorHandle,
                avatar: tweet.authorAvatar,
                bio: tweet.authorBio,
                location: tweet.authorLocation,
                bannerColor: '#cfd9de',
                joinedAt: Date.now() - 90 * 86400000,
                language: tweet.language,
                country: tweet.country,
                followers: tweet.authorFollowers || 42,
                following: 30,
                verified: tweet.authorVerified,
                followed: tweet.authorType === 'character',
                updatedAt: Date.now(),
            };
            void upsertAccounts([account]);
        }
        setAccountId(account.id);
        setDetailId(null);
        setActiveDMId(null);
    };

    const patchTweet = (id: string, patch: Partial<TwitterTweet> | ((tweet: TwitterTweet) => Partial<TwitterTweet>)) => {
        setTweets(prev => {
            const nextTweets = prev.map(tweet => {
                if (tweet.id !== id) return tweet;
                const next = { ...tweet, ...(typeof patch === 'function' ? patch(tweet) : patch) };
                void DB.saveTwitterTweet(next);
                return next;
            });
            cacheTwitterContextSummary(nextTweets, 12, dmThreads);
            return nextTweets;
        });
    };

    const refreshTimeline = async () => {
        if (busy) return;
        if (!apiReady) {
            const fb = fallbackTwitterTweets(characters, userProfile, TWITTER_BATCH_SIZE);
            await DB.saveTwitterTweets(fb).catch(() => undefined);
            const nextAccounts = buildTwitterAccounts(characters, userProfile, profile, accounts, fb);
            await DB.saveTwitterAccounts(nextAccounts).catch(() => undefined);
            setAccounts(nextAccounts);
            setTweets(prev => { const next = [...fb, ...prev]; cacheTwitterContextSummary(next, 12, dmThreads); return next; });
            addToast('API 未配置，先刷新一批本地虚拟推文', 'info');
            return;
        }
        setBusy(true);
        try {
            const batch = await generateTwitterTimeline(feedApi, characters, userProfile, tweets, accounts);
            await DB.saveTwitterTweets(batch);
            const nextAccounts = buildTwitterAccounts(characters, userProfile, profile, accounts, batch);
            await DB.saveTwitterAccounts(nextAccounts);
            setAccounts(nextAccounts);
            setTweets(prev => { const next = [...batch, ...prev]; cacheTwitterContextSummary(next, 12, dmThreads); return next; });
            addToast(`刷新了 ${batch.length} 篇高质量推文`, 'success');
        } catch (e: any) {
            addToast(`推特刷新失败：${e?.message || '未知错误'}`, 'error');
        } finally {
            setBusy(false);
        }
    };

    const toggleLike = (tweet: TwitterTweet) => patchTweet(tweet.id, t => ({ liked: !t.liked, likes: Math.max(0, t.likes + (t.liked ? -1 : 1)) }));
    const toggleBookmark = (tweet: TwitterTweet) => patchTweet(tweet.id, t => ({ bookmarked: !t.bookmarked }));
    const toggleRetweet = (tweet: TwitterTweet) => patchTweet(tweet.id, t => ({ retweeted: !t.retweeted, retweets: Math.max(0, t.retweets + (t.retweeted ? -1 : 1)) }));

    const toggleAccountFollow = async (id: string) => {
        const account = accounts.find(a => a.id === id);
        if (!account) return;
        const next = { ...account, followed: !account.followed, followers: Math.max(0, account.followers + (account.followed ? -1 : 1)), updatedAt: Date.now() };
        setAccounts(prev => prev.map(a => a.id === id ? next : a));
        await DB.saveTwitterAccount(next).catch(() => undefined);
    };

    const openComposeFor = (tweet?: TwitterTweet, kind?: 'reply' | 'quote') => {
        setReplyTarget(kind === 'reply' ? tweet || null : null);
        setQuoteTarget(kind === 'quote' ? tweet || null : null);
        setComposeText('');
        setComposeOpen(true);
    };

    const submitCompose = async () => {
        const text = composeText.trim();
        if (!text) return;
        const target = replyTarget || quoteTarget;
        setComposeText('');
        setComposeOpen(false);
        setReplyTarget(null);
        setQuoteTarget(null);
        if (replyTarget) {
            const userReply = createTwitterReply(replyTarget, text, userProfile, profile);
            patchTweet(replyTarget.id, t => ({ replies: [...t.replies, userReply], replyCount: t.replyCount + 1 }));
            if (apiReady && replyTarget.authorType !== 'user') {
                try {
                    const authorChar = replyTarget.charId ? characters.find(c => c.id === replyTarget.charId) : undefined;
                    const account = accounts.find(a => a.id === replyTarget.accountId);
                    const aiReply = await generateTwitterAuthorReply(feedApi, replyTarget, text, userProfile, authorChar, account);
                    patchTweet(replyTarget.id, t => ({ replies: [...t.replies, aiReply], replyCount: t.replyCount + 1 }));
                } catch { /* quiet */ }
            }
            return;
        }
        const tweet = createUserTweet(text, userProfile, quoteTarget || undefined, undefined, profile);
        await DB.saveTwitterTweet(tweet);
        setTweets(prev => { const next = [tweet, ...prev]; cacheTwitterContextSummary(next, 12, dmThreads); return next; });
        if (target?.id) patchTweet(target.id, t => ({ quotes: t.quotes + 1 }));
        if (apiReady) {
            try {
                const result = await generateTwitterReactions(feedApi, tweet, characters, userProfile);
                const nextTweet = { ...tweet, ...result.patch };
                await DB.saveTwitterTweet(nextTweet);
                await DB.saveTwitterNotifications(result.notifications);
                setTweets(prev => { const next = prev.map(t => t.id === tweet.id ? nextTweet : t); cacheTwitterContextSummary(next, 12, dmThreads); return next; });
                setNotifications(prev => [...result.notifications, ...prev]);
            } catch { /* user tweet already saved */ }
        }
    };

    const translateTweet = async (tweet: TwitterTweet) => {
        const key = `tweet:${tweet.id}`;
        const targetLang = normalizeTwitterLang(translationTarget || getTwitterLocalTargetLang(profile?.language));
        if (getTwitterTranslationText(tweet.translations, targetLang)) {
            setTranslationVisible(prev => new Set(prev).add(key));
            return;
        }
        setTranslationBusy(prev => new Set(prev).add(key));
        let provider: 'ai' | 'fallback' = 'fallback';
        try {
            let text = '';
            if (apiReady) {
                try {
                    text = await translateTwitterText(feedApi, tweet.content, targetLang);
                    provider = 'ai';
                } catch {
                    provider = 'fallback';
                }
            }
            if (!text) {
                text = translateTwitterTextLocal(tweet.content, targetLang, tweet.language);
                provider = 'fallback';
            }
            patchTweet(tweet.id, { translations: { ...(tweet.translations || {}), [targetLang]: { targetLang, text, provider, translatedAt: Date.now() } } });
            setTranslationVisible(prev => new Set(prev).add(key));
            if (provider === 'fallback') addToast('已使用本地速译，不需要配置 API', 'info');
        } catch (e: any) {
            addToast(`翻译失败：${e?.message || e}`, 'error');
        } finally {
            setTranslationBusy(prev => { const next = new Set(prev); next.delete(key); return next; });
        }
    };

    const translateReply = async (tweet: TwitterTweet, reply: TwitterReply) => {
        const key = `reply:${reply.id}`;
        const targetLang = normalizeTwitterLang(translationTarget || getTwitterLocalTargetLang(profile?.language));
        if (getTwitterTranslationText(reply.translations, targetLang)) {
            setTranslationVisible(prev => new Set(prev).add(key));
            return;
        }
        setTranslationBusy(prev => new Set(prev).add(key));
        let provider: 'ai' | 'fallback' = 'fallback';
        try {
            let text = '';
            if (apiReady) {
                try {
                    text = await translateTwitterText(feedApi, reply.content, targetLang);
                    provider = 'ai';
                } catch {
                    provider = 'fallback';
                }
            }
            if (!text) {
                text = translateTwitterTextLocal(reply.content, targetLang, reply.language);
                provider = 'fallback';
            }
            patchTweet(tweet.id, t => ({
                replies: t.replies.map(r => r.id === reply.id ? {
                    ...r,
                    translations: { ...(r.translations || {}), [targetLang]: { targetLang, text, provider, translatedAt: Date.now() } },
                } : r),
            }));
            setTranslationVisible(prev => new Set(prev).add(key));
            if (provider === 'fallback') addToast('已使用本地速译，不需要配置 API', 'info');
        } catch (e: any) {
            addToast(`翻译失败：${e?.message || e}`, 'error');
        } finally {
            setTranslationBusy(prev => { const next = new Set(prev); next.delete(key); return next; });
        }
    };

    const runSearchExpansion = async () => {
        const q = query.trim();
        if (!q || searchBusy) return;
        const resultCount = searchTwitter(q, tweets, accounts, { language: langFilter || undefined, mediaOnly }).top.length;
        const rec = createTwitterSearchRecord(q, resultCount);
        setSearchRecords(prev => [rec, ...prev.filter(r => r.query !== q)].slice(0, 20));
        void DB.saveTwitterSearchRecord(rec);
        if (!apiReady) { addToast('搜索已记录；AI 补充需要 API', 'info'); return; }
        setSearchBusy(true);
        try {
            const batch = await generateTwitterSearchTweets(feedApi, q, characters, userProfile, tweets, accounts);
            await DB.saveTwitterTweets(batch);
            const nextAccounts = buildTwitterAccounts(characters, userProfile, profile, accounts, batch);
            await DB.saveTwitterAccounts(nextAccounts);
            setAccounts(nextAccounts);
            setTweets(prev => { const next = [...batch, ...prev]; cacheTwitterContextSummary(next, 12, dmThreads); return next; });
            addToast(`已为「${q}」补充 ${batch.length} 条相关推文`, 'success');
        } catch (e: any) {
            addToast(`搜索补充失败：${e?.message || e}`, 'error');
        } finally {
            setSearchBusy(false);
        }
    };

    const ensureDMThread = async (account: TwitterAccount): Promise<TwitterDMThread> => {
        let thread = dmThreads.find(t => t.accountId === account.id);
        if (!thread) {
            thread = createDMThread(account);
            setDmThreads(prev => [thread!, ...prev]);
            await DB.saveTwitterDMThread(thread).catch(() => undefined);
        }
        setTab('dms');
        setAccountId(null);
        setDetailId(null);
        setActiveDMId(thread.id);
        await DB.markTwitterDMThreadRead(thread.id).catch(() => undefined);
        setDmThreads(prev => prev.map(t => t.id === thread!.id ? { ...t, unreadCount: 0, messages: t.messages.map(m => ({ ...m, read: true })) } : t));
        return thread;
    };

    const sendDMToAccount = async (account: TwitterAccount, content: string, tweet?: TwitterTweet) => {
        if (account.authorType === 'user') return;
        const baseThread = await ensureDMThread(account);
        const userThread = appendTwitterDMMessage(baseThread, {
            senderType: 'user',
            content,
            tweetId: tweet?.id,
            tweetSnapshot: tweet ? {
                id: tweet.id,
                authorName: tweet.authorName,
                authorHandle: tweet.authorHandle,
                content: tweet.content,
                topics: tweet.topics,
                replyCount: tweet.replyCount,
                retweets: tweet.retweets,
                likes: tweet.likes,
                language: tweet.language,
            } : undefined,
            read: true,
            status: 'sent',
        });
        setDmThreads(prev => [userThread, ...prev.filter(t => t.id !== userThread.id)]);
        await DB.saveTwitterDMThread(userThread);
        cacheTwitterContextSummary(tweets, 12, [userThread, ...dmThreads.filter(t => t.id !== userThread.id)]);
        if (!apiReady) return;
        try {
            const ai = await generateTwitterDMReply(feedApi, account, userThread, tweet ? `转发了一条推文：${tweet.content}\n${content}` : content, characters, userProfile);
            const finalThread = appendTwitterDMMessage(userThread, ai);
            setDmThreads(prev => [finalThread, ...prev.filter(t => t.id !== finalThread.id)]);
            await DB.saveTwitterDMThread(finalThread);
            await DB.saveTwitterNotification({
                id: `${Date.now()}_${account.id}`,
                kind: 'dm',
                tweetId: '',
                actorType: account.authorType,
                actorName: account.displayName,
                actorHandle: account.handle,
                actorAvatar: account.avatar,
                actorCharId: account.charId,
                snippet: ai.content,
                createdAt: Date.now(),
                read: false,
            });
        } catch { /* sent message already saved */ }
    };

    const sendActiveDM = async () => {
        const text = dmInput.trim();
        if (!text || !activeDM) return;
        const account = accounts.find(a => a.id === activeDM.accountId);
        if (!account) return;
        setDmInput('');
        await sendDMToAccount(account, text);
    };

    const shareToChat = async () => {
        if (!shareTarget || !selectedCharId) return;
        await DB.saveMessage({
            charId: selectedCharId,
            role: 'user',
            type: 'twitter_card' as MessageType,
            content: '[转发的推文]',
            metadata: { tweet: shareTarget },
        } as any);
        const target = characters.find(c => c.id === selectedCharId);
        addToast(`已转发给 ${target?.name || '角色'}`, 'success');
        setShareTarget(null);
        setSelectedCharId('');
        if (target) {
            setActiveCharacterId(target.id);
            openApp(AppID.Chat);
        }
    };

    const saveProfile = async () => {
        if (!profileDraft) return;
        const next = { ...profileDraft, language: normalizeTwitterLang(profileDraft.language || 'zh-CN'), handle: normalizeHandle(profileDraft.displayName, profileDraft.handle), updatedAt: Date.now() };
        const nextTarget = normalizeTwitterLang(translationTarget || next.language || getTwitterLocalTargetLang(next.language));
        if (typeof localStorage !== 'undefined') localStorage.setItem(TWITTER_TRANSLATION_TARGET_KEY, nextTarget);
        setTranslationTarget(nextTarget);
        setProfile(next);
        setProfileEditorOpen(false);
        await DB.saveTwitterProfile(next);
        const account = { ...accounts.find(a => a.authorType === 'user'), ...buildTwitterAccounts(characters, userProfile, next, [], [])[0] };
        await upsertAccounts([account as TwitterAccount]);
        addToast('推特资料已保存', 'success');
    };

    const clearAll = async () => {
        await Promise.all([DB.clearTwitterTweets(), DB.clearTwitterNotifications()]);
        setTweets([]);
        setNotifications([]);
        cacheTwitterContextSummary([], 12, dmThreads);
        addToast('推特时间线已清空', 'info');
    };

    const feedTweets = useMemo(() => {
        const followed = new Set(accounts.filter(a => a.followed || a.authorType === 'user').map(a => a.id));
        return mode === 'following'
            ? tweets.filter(t => t.authorType === 'character' || t.authorType === 'user' || (t.accountId && followed.has(t.accountId)))
            : tweets;
    }, [tweets, accounts, mode]);

    const searchResults = useMemo(
        () => searchTwitter(query, tweets, accounts, { language: langFilter || undefined, mediaOnly }),
        [query, tweets, accounts, langFilter, mediaOnly],
    );

    const accountTweets = useMemo(() => {
        if (!selectedAccount) return [];
        return tweets.filter(t => t.accountId === selectedAccount.id || t.charId === selectedAccount.charId || t.authorHandle === selectedAccount.handle);
    }, [selectedAccount, tweets]);

    const myTweets = tweets.filter(t => t.authorType === 'user');
    const bookmarkedTweets = tweets.filter(t => t.bookmarked);
    const likedTweets = tweets.filter(t => t.liked);
    const mediaTweets = tweets.filter(t => t.authorType === 'user' && t.media?.length);

    const renderTranslateButton = (tweet: TwitterTweet, compact = false) => {
        const key = `tweet:${tweet.id}`;
        const visible = translationVisible.has(key);
        const busyKey = translationBusy.has(key);
        const targetLabel = twitterTranslationLabel(translationTarget);
        return (
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    if (visible) setTranslationVisible(prev => { const next = new Set(prev); next.delete(key); return next; });
                    else void translateTweet(tweet);
                }}
                className="mt-2 inline-flex items-center gap-1 text-[#1d9bf0] font-bold"
                style={{ fontSize: compact ? 12 : 13 }}
            >
                {busyKey ? <Spinner size={13} className="animate-spin" /> : <Translate size={13} />}
                {visible ? '查看原文' : `翻译成${targetLabel}`}
            </button>
        );
    };

    const renderTweetActions = (tweet: TwitterTweet, compact = false) => (
        <div className={`flex items-center justify-between ${compact ? 'mt-2' : 'mt-3'} text-[#536471]`}>
            <button onClick={(e) => { e.stopPropagation(); openComposeFor(tweet, 'reply'); }} className="flex items-center gap-1 text-[12px] min-w-0 hover:text-[#1d9bf0] active:scale-95"><ChatCircle size={compact ? 16 : 18} />{fmtCount(tweet.replyCount)}</button>
            <button onClick={(e) => { e.stopPropagation(); toggleRetweet(tweet); }} className={`flex items-center gap-1 text-[12px] hover:text-[#00ba7c] active:scale-95 ${tweet.retweeted ? 'text-[#00ba7c]' : ''}`}><Repeat size={compact ? 16 : 18} weight={tweet.retweeted ? 'bold' : 'regular'} />{fmtCount(tweet.retweets)}</button>
            <button onClick={(e) => { e.stopPropagation(); toggleLike(tweet); }} className={`flex items-center gap-1 text-[12px] hover:text-[#f91880] active:scale-95 ${tweet.liked ? 'text-[#f91880]' : ''}`}><Heart size={compact ? 16 : 18} weight={tweet.liked ? 'fill' : 'regular'} />{fmtCount(tweet.likes)}</button>
            <button onClick={(e) => { e.stopPropagation(); setDmShareTarget(tweet); }} className="text-[12px] hover:text-[#1d9bf0] active:scale-95"><EnvelopeSimple size={compact ? 16 : 18} /></button>
            <span className="text-[12px]">{fmtCount(tweet.views)}</span>
            <button onClick={(e) => { e.stopPropagation(); toggleBookmark(tweet); }} className={`active:scale-95 ${tweet.bookmarked ? 'text-[#1d9bf0]' : ''}`}><BookmarkSimple size={compact ? 16 : 18} weight={tweet.bookmarked ? 'fill' : 'regular'} /></button>
        </div>
    );

    const renderTweet = (tweet: TwitterTweet) => {
        const key = `tweet:${tweet.id}`;
        const translated = getTwitterTranslationText(tweet.translations, translationTarget);
        return (
            <article key={tweet.id} onClick={() => { setDetailId(tweet.id); setAccountId(null); setActiveDMId(null); }} className="px-4 py-3 border-b border-[#eff3f4] cursor-pointer active:bg-[#f7f9f9] transition-colors">
                <div className="flex gap-3 min-w-0">
                    <Avatar name={tweet.authorName} src={tweet.authorAvatar} onClick={() => openAccountForTweet(tweet)} />
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1 text-[14px] min-w-0">
                            <button onClick={(e) => { e.stopPropagation(); openAccountForTweet(tweet); }} className="font-black truncate hover:underline">{tweet.authorName}</button>
                            {tweet.authorVerified && <CheckCircle size={14} weight="fill" color="#1d9bf0" />}
                            {tweet.authorType === 'character' && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#e8f5fd] text-[#1d9bf0] font-bold">角色</span>}
                            <span className="text-[#536471] truncate">{tweet.authorHandle}</span>
                            <span className="text-[#536471] shrink-0">· {fmtTime(tweet.createdAt)}</span>
                        </div>
                        <div className="flex items-center gap-1 text-[11px] text-[#536471] mt-0.5">
                            {tweet.language && <><GlobeHemisphereWest size={12} />{tweet.language}</>}
                            {tweet.country && <span>· {tweet.country}</span>}
                        </div>
                        <div className="text-[14.5px] leading-relaxed whitespace-pre-wrap break-words line-clamp-6 mt-0.5">{tweet.content}</div>
                        {(shouldOfferTranslation(tweet.language, translationTarget) || translated) && renderTranslateButton(tweet, true)}
                        {translationVisible.has(key) && <TranslationBlock text={translated} />}
                        {tweet.topics.length > 0 && (
                            <div className="flex flex-wrap gap-x-2 gap-y-1 mt-1.5">
                                {tweet.topics.slice(0, 4).map(t => <button key={t} onClick={(e) => { e.stopPropagation(); setTab('search'); setQuery(t); }} className="text-[13px] text-[#1d9bf0]">#{t}</button>)}
                            </div>
                        )}
                        {tweet.media?.length ? (
                            <div className="rounded-2xl border border-[#cfd9de] overflow-hidden mt-3 min-h-[92px] flex items-center px-4 text-[13px] text-[#536471]" style={{ background: tweet.media[0].color || '#f7f9f9' }}>
                                <ImageSquare size={18} className="mr-2 shrink-0" />{tweet.media[0].alt || '图片 / 截图'}
                            </div>
                        ) : null}
                        <SourceTweet tweet={tweet.sourceTweet} onOpen={() => tweet.sourceTweetId && setDetailId(tweet.sourceTweetId)} />
                        {renderTweetActions(tweet, true)}
                    </div>
                </div>
            </article>
        );
    };

    const renderHeader = () => (
        <div className="shrink-0 bg-white/90 backdrop-blur border-b border-[#eff3f4]" style={{ paddingTop: 'var(--safe-top)' }}>
            <div className="h-12 px-3 flex items-center">
                <IconButton title="返回桌面" onClick={closeApp}><CaretLeft size={22} weight="bold" /></IconButton>
                <div className="mx-auto"><XLogo size={24} weight="fill" /></div>
                <IconButton title="清空时间线" onClick={clearAll}><Trash size={19} /></IconButton>
            </div>
            {tab === 'home' && !detailId && !accountId && !activeDMId && (
                <div className="flex h-11">
                    <button onClick={() => setMode('forYou')} className="flex-1 relative font-bold text-[14px]">For you{mode === 'forYou' && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-14 h-1 rounded-full bg-[#1d9bf0]" />}</button>
                    <button onClick={() => setMode('following')} className="flex-1 relative font-bold text-[14px]">Following{mode === 'following' && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-1 rounded-full bg-[#1d9bf0]" />}</button>
                </div>
            )}
        </div>
    );

    const renderDetail = (tweet: TwitterTweet) => {
        const translated = getTwitterTranslationText(tweet.translations, translationTarget);
        return (
            <Shell>
                <div className="shrink-0 border-b border-[#eff3f4] bg-white/90 backdrop-blur" style={{ paddingTop: 'var(--safe-top)' }}>
                    <div className="h-12 px-3 flex items-center gap-3">
                        <IconButton title="返回" onClick={() => setDetailId(null)}><CaretLeft size={22} weight="bold" /></IconButton>
                        <div className="font-black text-[18px]">推文</div>
                        <div className="ml-auto flex items-center">
                            <IconButton title="私信分享" onClick={() => setDmShareTarget(tweet)}><EnvelopeSimple size={20} /></IconButton>
                            <IconButton title="转发给角色" onClick={() => setShareTarget(tweet)}><Export size={20} /></IconButton>
                        </div>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto no-scrollbar">
                    <div className="px-4 py-4 border-b border-[#eff3f4]">
                        <div className="flex gap-3">
                            <Avatar name={tweet.authorName} src={tweet.authorAvatar} size={46} onClick={() => openAccountForTweet(tweet)} />
                            <button onClick={() => openAccountForTweet(tweet)} className="min-w-0 text-left">
                                <div className="font-black text-[16px] flex items-center gap-1">{tweet.authorName}{tweet.authorVerified && <CheckCircle size={15} weight="fill" color="#1d9bf0" />}</div>
                                <div className="text-[14px] text-[#536471]">{tweet.authorHandle}</div>
                            </button>
                        </div>
                        <div className="text-[19px] leading-relaxed whitespace-pre-wrap break-words mt-4">{tweet.content}</div>
                        {(shouldOfferTranslation(tweet.language, translationTarget) || translated) && renderTranslateButton(tweet)}
                        {translationVisible.has(`tweet:${tweet.id}`) && <TranslationBlock text={translated} />}
                        {tweet.topics.length > 0 && <div className="flex flex-wrap gap-2 mt-3">{tweet.topics.map(t => <button key={t} onClick={() => { setTab('search'); setQuery(t); setDetailId(null); }} className="text-[#1d9bf0]">#{t}</button>)}</div>}
                        {tweet.media?.length ? <div className="rounded-2xl border border-[#cfd9de] mt-4 p-4 text-[#536471]" style={{ background: tweet.media[0].color || '#f7f9f9' }}>{tweet.media[0].alt}</div> : null}
                        <SourceTweet tweet={tweet.sourceTweet} onOpen={() => tweet.sourceTweetId && setDetailId(tweet.sourceTweetId)} />
                        <div className="text-[14px] text-[#536471] mt-4 pb-4 border-b border-[#eff3f4]">{new Date(tweet.createdAt).toLocaleString('zh-CN')} · {fmtCount(tweet.views)} 次查看</div>
                        {renderTweetActions(tweet)}
                    </div>
                    <div className="px-4 py-3 border-b border-[#eff3f4] flex gap-3">
                        <Avatar name={profile?.displayName || userProfile.name} src={profile?.avatar || userProfile.avatar} size={36} />
                        <button onClick={() => openComposeFor(tweet, 'reply')} className="flex-1 text-left text-[#536471] text-[15px]">回复 {tweet.authorHandle}</button>
                    </div>
                    {tweet.replies.map(r => renderReply(tweet, r))}
                </div>
                {composeOpen && renderCompose()}
                {shareTarget && renderShareSheet()}
                {dmShareTarget && renderDMTweetSheet(dmShareTarget)}
            </Shell>
        );
    };

    const renderReply = (tweet: TwitterTweet, reply: TwitterReply) => {
        const key = `reply:${reply.id}`;
        const translated = getTwitterTranslationText(reply.translations, translationTarget);
        const account = accounts.find(a => a.id === reply.accountId);
        return (
            <div key={reply.id} className="px-4 py-3 border-b border-[#eff3f4] flex gap-3">
                <Avatar name={reply.authorName} src={reply.authorAvatar} size={36} onClick={account ? () => setAccountId(account.id) : undefined} />
                <div className="min-w-0 flex-1">
                    <div className="text-[14px]"><span className="font-black">{reply.authorName}</span> <span className="text-[#536471]">{reply.authorHandle} · {fmtTime(reply.createdAt)}</span></div>
                    <div className="text-[14.5px] leading-relaxed whitespace-pre-wrap">{reply.content}</div>
                    {(shouldOfferTranslation(reply.language, translationTarget) || translated) && (
                        <button onClick={() => translationVisible.has(key) ? setTranslationVisible(prev => { const next = new Set(prev); next.delete(key); return next; }) : void translateReply(tweet, reply)} className="mt-1 inline-flex items-center gap-1 text-[12px] text-[#1d9bf0] font-bold">
                            {translationBusy.has(key) ? <Spinner size={12} className="animate-spin" /> : <Translate size={12} />}{translationVisible.has(key) ? '查看原文' : `翻译成${twitterTranslationLabel(translationTarget)}`}
                        </button>
                    )}
                    {translationVisible.has(key) && <TranslationBlock text={translated} />}
                    <div className="text-[12px] text-[#536471] mt-2 flex items-center gap-1"><Heart size={14} />{fmtCount(reply.likes)}</div>
                </div>
            </div>
        );
    };

    const renderSearch = () => {
        const panes = [
            ['top', '热门'], ['latest', '最新'], ['people', '用户'], ['media', '媒体'],
        ] as const;
        const current = searchPane === 'latest' ? searchResults.latest : searchPane === 'media' ? searchResults.media : searchResults.top;
        return (
            <div className="flex-1 overflow-y-auto no-scrollbar">
                <div className="p-3 sticky top-0 bg-white z-10 border-b border-[#eff3f4]">
                    <div className="h-10 rounded-full bg-[#eff3f4] px-4 flex items-center gap-2">
                        <MagnifyingGlass size={18} color="#536471" />
                        <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void runSearchExpansion(); }} placeholder="搜索推特" className="flex-1 bg-transparent outline-none text-[14px]" />
                        {query && <button onClick={() => setQuery('')} className="text-[#536471] text-[12px]">清除</button>}
                    </div>
                    <div className="flex gap-2 mt-3 overflow-x-auto no-scrollbar">
                        {panes.map(([id, label]) => <Pill key={id} active={searchPane === id} onClick={() => setSearchPane(id)}>{label}</Pill>)}
                        <Pill active={mediaOnly} onClick={() => setMediaOnly(!mediaOnly)}>只看媒体</Pill>
                    </div>
                    <div className="flex gap-2 mt-2 overflow-x-auto no-scrollbar">
                        {LANGS.map(l => <Pill key={l.id || 'all'} active={langFilter === l.id} onClick={() => setLangFilter(l.id)}>{l.label}</Pill>)}
                    </div>
                </div>
                {!query.trim() && (
                    <>
                        {searchRecords.length > 0 && <div className="px-4 pt-4 pb-2 font-black text-[17px]">最近搜索</div>}
                        {searchRecords.slice(0, 6).map(r => <button key={r.id} onClick={() => setQuery(r.query)} className="w-full px-4 py-2.5 text-left text-[14px] border-b border-[#eff3f4]">{r.query}<span className="text-[#536471] ml-2">{r.resultCount || 0} results</span></button>)}
                        <div className="px-4 py-3 font-black text-[20px]">趋势</div>
                        {trends.map((tr, i) => (
                            <button key={tr.id} onClick={() => setQuery(tr.label)} className="w-full px-4 py-3 text-left active:bg-[#f7f9f9]">
                                <div className="text-[12px] text-[#536471]">虚拟趋势 · 第 {i + 1}</div>
                                <div className="font-black">#{tr.label}</div>
                                <div className="text-[12px] text-[#536471]">{fmtCount(tr.posts)} posts</div>
                            </button>
                        ))}
                    </>
                )}
                {query.trim() && (
                    <div className="px-4 py-3 border-b border-[#eff3f4] flex items-center justify-between gap-3">
                        <div className="text-[13px] text-[#536471]">找到 {searchResults.top.length} 条推文 / {searchResults.people.length} 个账号</div>
                        <button onClick={runSearchExpansion} disabled={searchBusy} className="h-9 px-4 rounded-full bg-[#0f1419] text-white text-[12px] font-black disabled:opacity-50 flex items-center gap-1">
                            {searchBusy ? <Spinner size={14} className="animate-spin" /> : <ArrowClockwise size={14} />}AI 补充
                        </button>
                    </div>
                )}
                {searchPane === 'people'
                    ? searchResults.people.map(a => <AccountRow key={a.id} account={a} onOpen={() => setAccountId(a.id)} onFollow={a.authorType !== 'user' ? () => void toggleAccountFollow(a.id) : undefined} onDM={a.authorType !== 'user' ? () => void ensureDMThread(a) : undefined} />)
                    : current.map(renderTweet)}
                {query.trim() && searchPane === 'people' && searchResults.people.length === 0 && <div className="text-center text-[#536471] text-[14px] pt-16">没有匹配账号</div>}
                {query.trim() && searchPane !== 'people' && current.length === 0 && <div className="text-center text-[#536471] text-[14px] pt-16">没有本地结果，可以点 AI 补充</div>}
            </div>
        );
    };

    const renderNotifications = () => (
        <div className="flex-1 overflow-y-auto no-scrollbar">
            <div className="px-4 py-3 border-b border-[#eff3f4] flex items-center justify-between">
                <div className="font-black text-[20px]">通知</div>
                <button onClick={() => { void DB.markTwitterNotificationsRead(); setNotifications(prev => prev.map(n => ({ ...n, read: true }))); }} className="text-[13px] text-[#1d9bf0] font-bold">全部已读</button>
            </div>
            {notifications.length === 0 && <div className="text-center text-[#536471] text-[14px] pt-20">还没有通知</div>}
            {notifications.map(n => (
                <button key={n.id} onClick={() => n.tweetId ? setDetailId(n.tweetId) : setTab('dms')} className={`w-full px-4 py-3 border-b border-[#eff3f4] text-left flex gap-3 ${n.read ? 'bg-white' : 'bg-[#f7fbff]'}`}>
                    <Avatar name={n.actorName} src={n.actorAvatar} size={36} />
                    <div className="min-w-0 flex-1">
                        <div className="text-[14px]"><b>{n.actorName}</b> {n.kind === 'reply' ? '回复了你' : n.kind === 'like' ? '喜欢了你的推文' : n.kind === 'quote' ? '引用了你' : n.kind === 'dm' ? '给你发了私信' : '转推了你'}</div>
                        <div className="text-[13px] text-[#536471] truncate">{n.snippet}</div>
                    </div>
                </button>
            ))}
        </div>
    );

    const renderDMs = () => {
        if (activeDM) {
            const account = accounts.find(a => a.id === activeDM.accountId);
            return (
                <div className="flex-1 min-h-0 flex flex-col">
                    <div className="h-13 px-3 py-2 border-b border-[#eff3f4] flex items-center gap-2">
                        <IconButton title="返回私信" onClick={() => setActiveDMId(null)}><CaretLeft size={20} /></IconButton>
                        <Avatar name={activeDM.accountName} src={activeDM.accountAvatar} size={34} />
                        <button onClick={() => account && setAccountId(account.id)} className="min-w-0 text-left">
                            <div className="font-black text-[14px] truncate">{activeDM.accountName}</div>
                            <div className="text-[12px] text-[#536471] truncate">{activeDM.accountHandle}</div>
                        </button>
                    </div>
                    <div className="flex-1 overflow-y-auto no-scrollbar px-3 py-3 space-y-3">
                        {activeDM.messages.length === 0 && <div className="text-center text-[#536471] text-[14px] pt-16">开始一段私信</div>}
                        {activeDM.messages.map(m => (
                            <div key={m.id} className={`flex ${m.senderType === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[82%] rounded-2xl px-3 py-2 text-[14px] leading-relaxed ${m.senderType === 'user' ? 'bg-[#1d9bf0] text-white rounded-br-md' : 'bg-[#eff3f4] text-[#0f1419] rounded-bl-md'}`}>
                                    {m.tweetSnapshot && (
                                        <button onClick={() => setDetailId(m.tweetSnapshot?.id || null)} className="w-full text-left rounded-xl bg-white/90 text-[#0f1419] px-2.5 py-2 mb-2">
                                            <div className="text-[11px] text-[#536471]">{m.tweetSnapshot.authorName} {m.tweetSnapshot.authorHandle}</div>
                                            <div className="text-[12px] line-clamp-3">{m.tweetSnapshot.content}</div>
                                        </button>
                                    )}
                                    <div className="whitespace-pre-wrap break-words">{m.content}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="shrink-0 border-t border-[#eff3f4] p-3 flex gap-2" style={{ paddingBottom: 'calc(var(--safe-bottom,0px) + 12px)' }}>
                        <input value={dmInput} onChange={e => setDmInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void sendActiveDM(); }} placeholder="发私信" className="flex-1 h-10 rounded-full bg-[#eff3f4] px-4 outline-none text-[14px]" />
                        <button onClick={sendActiveDM} disabled={!dmInput.trim()} className="w-10 h-10 rounded-full bg-[#1d9bf0] text-white flex items-center justify-center disabled:opacity-40"><PaperPlaneTilt size={18} weight="fill" /></button>
                    </div>
                </div>
            );
        }
        return (
            <div className="flex-1 overflow-y-auto no-scrollbar">
                <div className="px-4 py-3 border-b border-[#eff3f4]">
                    <div className="font-black text-[20px]">Messages</div>
                    <div className="text-[13px] text-[#536471] mt-1">给角色和虚拟账号发 X 私信</div>
                </div>
                {dmThreads.length === 0 && <div className="text-center text-[#536471] text-[14px] pt-20">还没有私信线程</div>}
                {dmThreads.map(t => (
                    <button key={t.id} onClick={() => { setActiveDMId(t.id); void DB.markTwitterDMThreadRead(t.id); }} className="w-full px-4 py-3 border-b border-[#eff3f4] flex gap-3 text-left active:bg-[#f7f9f9]">
                        <Avatar name={t.accountName} src={t.accountAvatar} />
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                                <span className="font-black text-[15px] truncate">{t.accountName}</span>
                                <span className="text-[#536471] text-[13px] truncate">{t.accountHandle}</span>
                                <span className="ml-auto text-[11px] text-[#536471]">{fmtTime(t.updatedAt)}</span>
                            </div>
                            <div className="text-[13px] text-[#536471] truncate mt-1">{t.lastMessage || '开始聊天'}</div>
                        </div>
                        {t.unreadCount > 0 && <span className="min-w-5 h-5 px-1 rounded-full bg-[#1d9bf0] text-white text-[10px] font-bold flex items-center justify-center">{t.unreadCount}</span>}
                    </button>
                ))}
                <div className="px-4 py-3 font-black text-[16px]">推荐私信</div>
                {accounts.filter(a => a.authorType !== 'user').slice(0, 8).map(a => <AccountRow key={a.id} account={a} onOpen={() => setAccountId(a.id)} onDM={() => void ensureDMThread(a)} />)}
            </div>
        );
    };

    const renderProfile = () => {
        const p = profile || defaultTwitterProfile(userProfile);
        const panes = [
            ['posts', 'Posts'], ['replies', 'Replies'], ['media', 'Media'], ['likes', 'Likes'], ['bookmarks', 'Bookmarks'],
        ] as const;
        const list = profilePane === 'bookmarks' ? bookmarkedTweets : profilePane === 'likes' ? likedTweets : profilePane === 'media' ? mediaTweets : myTweets;
        return (
            <div className="flex-1 overflow-y-auto no-scrollbar">
                <div className="h-28" style={{ background: p.bannerColor || '#cfd9de' }} />
                <div className="px-4 pb-4 border-b border-[#eff3f4]">
                    <div className="-mt-9 flex items-end justify-between">
                        <Avatar name={p.displayName} src={p.avatar} size={72} />
                        <button onClick={() => { setProfileDraft(p); setProfileEditorOpen(true); }} className="h-9 px-4 rounded-full border border-[#cfd9de] font-black text-[13px]">编辑资料</button>
                    </div>
                    <div className="font-black text-[21px] mt-2">{p.displayName}</div>
                    <div className="text-[#536471]">{p.handle}</div>
                    <div className="mt-3 text-[14px] whitespace-pre-wrap">{p.bio || '还没有个人简介'}</div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[13px] text-[#536471]">
                        {p.location && <span className="inline-flex items-center gap-1"><MapPin size={14} />{p.location}</span>}
                        {p.website && <span className="inline-flex items-center gap-1"><LinkSimple size={14} />{p.website}</span>}
                        <span>{fmtCount(p.following)} Following</span>
                        <span>{fmtCount(p.followers)} Followers</span>
                    </div>
                </div>
                <div className="h-11 flex border-b border-[#eff3f4] overflow-x-auto no-scrollbar">
                    {panes.map(([id, label]) => <button key={id} onClick={() => setProfilePane(id)} className="min-w-[84px] flex-1 relative font-bold text-[13px]">{label}{profilePane === id && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-10 h-1 rounded-full bg-[#1d9bf0]" />}</button>)}
                </div>
                {list.map(renderTweet)}
                {list.length === 0 && <div className="text-center text-[#536471] pt-16 text-[14px]">这里还没有内容</div>}
            </div>
        );
    };

    const renderAccountPage = (account: TwitterAccount) => {
        const list = accountTweets;
        return (
            <Shell>
                <div className="shrink-0 border-b border-[#eff3f4] bg-white/90 backdrop-blur" style={{ paddingTop: 'var(--safe-top)' }}>
                    <div className="h-12 px-3 flex items-center gap-3">
                        <IconButton title="返回" onClick={() => setAccountId(null)}><CaretLeft size={22} weight="bold" /></IconButton>
                        <div className="min-w-0">
                            <div className="font-black text-[17px] truncate">{account.displayName}</div>
                            <div className="text-[12px] text-[#536471]">{list.length} posts</div>
                        </div>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto no-scrollbar">
                    <div className="h-28" style={{ background: account.bannerColor || '#cfd9de' }} />
                    <div className="px-4 pb-4 border-b border-[#eff3f4]">
                        <div className="-mt-9 flex items-end justify-between">
                            <Avatar name={account.displayName} src={account.avatar} size={72} />
                            <div className="flex gap-2">
                                {account.authorType !== 'user' && <button onClick={() => void ensureDMThread(account)} className="h-9 w-9 rounded-full border border-[#cfd9de] flex items-center justify-center"><EnvelopeSimple size={18} /></button>}
                                {account.authorType !== 'user' && <button onClick={() => void toggleAccountFollow(account.id)} className="h-9 px-4 rounded-full bg-[#0f1419] text-white font-black text-[13px]">{account.followed ? 'Following' : 'Follow'}</button>}
                            </div>
                        </div>
                        <div className="font-black text-[21px] mt-2 flex items-center gap-1">{account.displayName}{account.verified && <CheckCircle size={17} weight="fill" color="#1d9bf0" />}</div>
                        <div className="text-[#536471]">{account.handle}</div>
                        <div className="mt-3 text-[14px] whitespace-pre-wrap">{account.bio || '这个账号还没有简介。'}</div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[13px] text-[#536471]">
                            {account.location && <span className="inline-flex items-center gap-1"><MapPin size={14} />{account.location}</span>}
                            {account.website && <span className="inline-flex items-center gap-1"><LinkSimple size={14} />{account.website}</span>}
                            {account.language && <span className="inline-flex items-center gap-1"><GlobeHemisphereWest size={14} />{account.language}</span>}
                            <span>{fmtCount(account.following)} Following</span>
                            <span>{fmtCount(account.followers)} Followers</span>
                        </div>
                        {account.interests?.length ? <div className="flex flex-wrap gap-2 mt-3">{account.interests.slice(0, 6).map(t => <span key={t} className="text-[12px] text-[#1d9bf0]">#{t}</span>)}</div> : null}
                    </div>
                    {list.map(renderTweet)}
                    {list.length === 0 && <div className="text-center text-[#536471] pt-16 text-[14px]">这个账号还没发过推</div>}
                </div>
                {dmShareTarget && renderDMTweetSheet(dmShareTarget)}
            </Shell>
        );
    };

    const renderMain = () => {
        if (tab === 'search') return renderSearch();
        if (tab === 'notifications') return renderNotifications();
        if (tab === 'dms') return renderDMs();
        if (tab === 'profile') return renderProfile();
        return (
            <div className="flex-1 overflow-y-auto no-scrollbar">
                {!loaded ? <div className="text-center text-[#536471] pt-20">加载时间线…</div> : feedTweets.length === 0 ? (
                    <div className="text-center text-[#536471] pt-20 px-8">
                        <XLogo size={38} className="mx-auto mb-4" />
                        <div className="font-black text-[#0f1419] text-[19px] mb-2">时间线空了</div>
                        <button onClick={refreshTimeline} className="mt-3 px-5 py-2 rounded-full bg-[#0f1419] text-white font-black">刷新至少 12 篇</button>
                    </div>
                ) : feedTweets.map(renderTweet)}
            </div>
        );
    };

    function renderCompose() {
        const target = replyTarget || quoteTarget;
        return (
            <div className="absolute inset-0 bg-white z-50 flex flex-col" style={{ paddingTop: 'var(--safe-top)' }}>
                <div className="h-12 px-3 flex items-center border-b border-[#eff3f4]">
                    <IconButton title="关闭" onClick={() => { setComposeOpen(false); setReplyTarget(null); setQuoteTarget(null); }}><CaretLeft size={22} weight="bold" /></IconButton>
                    <button onClick={submitCompose} disabled={!composeText.trim()} className="ml-auto px-5 py-2 rounded-full bg-[#1d9bf0] text-white text-[14px] font-black disabled:opacity-50">{replyTarget ? '回复' : '发推'}</button>
                </div>
                <div className="p-4 flex gap-3">
                    <Avatar name={profile?.displayName || userProfile.name} src={profile?.avatar || userProfile.avatar} />
                    <div className="flex-1 min-w-0">
                        {replyTarget && <div className="text-[13px] text-[#536471] mb-2">回复 {replyTarget.authorHandle}</div>}
                        <textarea value={composeText} onChange={e => setComposeText(e.target.value)} autoFocus placeholder={replyTarget ? '发布你的回复' : '有什么新鲜事？'} className="w-full min-h-[170px] resize-none outline-none text-[20px] leading-relaxed" />
                        {target && (
                            <div className="rounded-2xl border border-[#cfd9de] px-3 py-2 mt-3">
                                <div className="text-[13px] font-bold">{target.authorName} <span className="font-normal text-[#536471]">{target.authorHandle}</span></div>
                                <div className="text-[13px] line-clamp-4 whitespace-pre-wrap">{target.content}</div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    function renderShareSheet() {
        return (
            <div className="absolute inset-0 z-50 bg-black/30 flex items-end">
                <div className="w-full bg-white rounded-t-[24px] p-4" style={{ paddingBottom: 'calc(var(--safe-bottom, 0px) + 16px)' }}>
                    <div className="flex items-center justify-between mb-3">
                        <div className="font-black">转发给聊天角色</div>
                        <button onClick={() => setShareTarget(null)} className="text-[#536471]">关闭</button>
                    </div>
                    <div className="max-h-[42vh] overflow-y-auto no-scrollbar space-y-2">
                        {characters.map(c => (
                            <button key={c.id} onClick={() => setSelectedCharId(c.id)} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl text-left ${selectedCharId === c.id ? 'bg-[#e8f5fd]' : 'bg-[#f7f9f9]'}`}>
                                <Avatar name={c.name} src={c.avatar} size={36} />
                                <span className="font-bold">{c.name}</span>
                            </button>
                        ))}
                    </div>
                    <button onClick={shareToChat} disabled={!selectedCharId} className="w-full mt-4 h-11 rounded-full bg-[#0f1419] text-white font-black disabled:opacity-40">发送</button>
                </div>
            </div>
        );
    }

    function renderDMTweetSheet(tweet: TwitterTweet) {
        const dmAccounts = accounts.filter(a => a.authorType !== 'user');
        return (
            <div className="absolute inset-0 z-50 bg-black/30 flex items-end">
                <div className="w-full bg-white rounded-t-[24px] p-4" style={{ paddingBottom: 'calc(var(--safe-bottom, 0px) + 16px)' }}>
                    <div className="flex items-center justify-between mb-3">
                        <div className="font-black">私信分享推文</div>
                        <button onClick={() => setDmShareTarget(null)} className="text-[#536471]">关闭</button>
                    </div>
                    <div className="rounded-2xl border border-[#cfd9de] px-3 py-2 mb-3">
                        <div className="text-[12px] text-[#536471]">{tweet.authorName} {tweet.authorHandle}</div>
                        <div className="text-[13px] line-clamp-3">{tweet.content}</div>
                    </div>
                    <div className="max-h-[42vh] overflow-y-auto no-scrollbar space-y-2">
                        {dmAccounts.map(a => (
                            <button key={a.id} onClick={async () => { await sendDMToAccount(a, '把这条推文发给你看看。', tweet); setDmShareTarget(null); addToast(`已私信给 ${a.displayName}`, 'success'); }} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl text-left bg-[#f7f9f9]">
                                <Avatar name={a.displayName} src={a.avatar} size={36} />
                                <span className="font-bold min-w-0 truncate">{a.displayName}</span>
                                <span className="ml-auto text-[12px] text-[#536471]">{a.handle}</span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    function renderProfileEditor() {
        if (!profileDraft) return null;
        const field = (key: keyof TwitterProfile, label: string, placeholder = '') => (
            <label className="block">
                <span className="text-[11px] text-[#536471] font-bold">{label}</span>
                <input value={String(profileDraft[key] || '')} onChange={e => setProfileDraft({ ...profileDraft, [key]: e.target.value })} placeholder={placeholder} className="w-full h-10 border-b border-[#cfd9de] outline-none text-[15px]" />
            </label>
        );
        return (
            <div className="absolute inset-0 z-50 bg-white flex flex-col" style={{ paddingTop: 'var(--safe-top)' }}>
                <div className="h-12 px-3 flex items-center border-b border-[#eff3f4]">
                    <IconButton title="关闭" onClick={() => setProfileEditorOpen(false)}><CaretLeft size={22} /></IconButton>
                    <div className="font-black text-[17px]">编辑资料</div>
                    <button onClick={saveProfile} className="ml-auto h-9 px-4 rounded-full bg-[#0f1419] text-white font-black text-[13px]">保存</button>
                </div>
                <div className="flex-1 overflow-y-auto no-scrollbar p-4 space-y-4">
                    <div className="h-24 rounded-2xl" style={{ background: profileDraft.bannerColor || '#cfd9de' }} />
                    {field('displayName', '昵称')}
                    {field('handle', 'Handle', '@handle')}
                    <label className="block">
                        <span className="text-[11px] text-[#536471] font-bold">简介</span>
                        <textarea value={profileDraft.bio || ''} onChange={e => setProfileDraft({ ...profileDraft, bio: e.target.value })} className="w-full min-h-[80px] border-b border-[#cfd9de] outline-none text-[15px] resize-none" />
                    </label>
                    {field('avatar', '头像 URL')}
                    {field('bannerColor', '横幅颜色', '#cfd9de')}
                    {field('location', '位置')}
                    {field('website', '网站')}
                    {field('birthday', '生日')}
                    {field('language', '发推语言', 'zh-CN')}
                    {field('country', '国家 / 地区')}
                    <label className="block">
                        <span className="text-[11px] text-[#536471] font-bold">翻译目标语言</span>
                        <select
                            value={translationTarget}
                            onChange={e => {
                                const next = normalizeTwitterLang(e.target.value);
                                setTranslationTarget(next);
                                if (typeof localStorage !== 'undefined') localStorage.setItem(TWITTER_TRANSLATION_TARGET_KEY, next);
                            }}
                            className="w-full h-10 border-b border-[#cfd9de] outline-none text-[15px] bg-white"
                        >
                            {LANGS.filter(l => l.id).map(l => <option key={l.id} value={l.id}>{twitterTranslationLabel(l.id)}</option>)}
                            <option value="zh-TW">繁體中文</option>
                        </select>
                    </label>
                </div>
            </div>
        );
    }

    const nav = [
        ['home', House, '首页', 0],
        ['search', MagnifyingGlass, '搜索', 0],
        ['notifications', Bell, '通知', unread],
        ['dms', EnvelopeSimple, '私信', dmUnread],
        ['profile', User, '我的', 0],
    ] as const;

    if (detail) return renderDetail(detail);
    if (selectedAccount) return renderAccountPage(selectedAccount);

    return (
        <Shell>
            {renderHeader()}
            {renderMain()}
            <div className="shrink-0 border-t border-[#eff3f4] bg-white" style={{ paddingBottom: 'var(--safe-bottom)' }}>
                <div className="h-14 flex items-center justify-around">
                    {nav.map(([id, Icon, label, badge]) => (
                        <button key={id} onClick={() => { setTab(id as Tab); setDetailId(null); setAccountId(null); setActiveDMId(null); }} title={label} className="relative w-12 h-12 rounded-full flex items-center justify-center active:scale-95">
                            <Icon size={25} weight={tab === id ? 'fill' : 'regular'} color={tab === id ? '#0f1419' : '#536471'} />
                            {badge > 0 && <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-[#1d9bf0] text-white text-[9px] font-bold flex items-center justify-center">{badge}</span>}
                        </button>
                    ))}
                </div>
            </div>
            <button onClick={() => { setReplyTarget(null); setQuoteTarget(null); setComposeText(''); setComposeOpen(true); }} className="absolute right-5 bottom-[calc(var(--safe-bottom,0px)+72px)] w-14 h-14 rounded-full bg-[#1d9bf0] text-white flex items-center justify-center shadow-lg active:scale-95">
                <PencilSimple size={26} weight="bold" />
            </button>
            <button onClick={refreshTimeline} disabled={busy} title="刷新" className="absolute left-5 bottom-[calc(var(--safe-bottom,0px)+78px)] h-11 px-4 rounded-full bg-[#0f1419] text-white flex items-center gap-2 text-[13px] font-black shadow-lg active:scale-95 disabled:opacity-50">
                {busy ? <Spinner size={17} className="animate-spin" /> : <ArrowClockwise size={17} weight="bold" />} {busy ? '刷新中' : `刷新 ${TWITTER_BATCH_SIZE}`}
            </button>
            {composeOpen && renderCompose()}
            {shareTarget && renderShareSheet()}
            {dmShareTarget && renderDMTweetSheet(dmShareTarget)}
            {profileEditorOpen && renderProfileEditor()}
        </Shell>
    );
};

export default TwitterApp;
