import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../../context/OSContext';
import {
    Sparkle, ListChecks, ChatsCircle, Fire, NotePencil, ArrowClockwise, PaperPlaneTilt,
    WechatLogo, Camera, Megaphone, ImagesSquare, Scroll, Trash, ClockCounterClockwise,
    UsersThree, User, ChatTeardropText, CheckCircle, Play, MicrophoneStage, Presentation,
    Notebook, EnvelopeOpen, NewspaperClipping, CalendarDots, FileMagnifyingGlass, ClipboardText,
    PlugsConnected, FileArrowUp,
} from '@phosphor-icons/react';
import { resolveAuxApi } from '../../utils/auxApi';
import { makeApiUsageMeta } from '../../utils/apiUsageCatalog';
import { DB } from '../../utils/db';
import { fetchModelList, testChatConnection } from '../../utils/llmClient';
import {
    clearLocalApiOverride,
    isLocalApiOverrideComplete,
    loadLocalApiOverride,
    resolveScopedLocalApi,
    saveLocalApiOverride,
    type LocalApiOverrideConfig,
} from '../../utils/localApiOverride';
import {
    inferQuestionCount, genNextQuestion, genCharAnswer, genCharComment, genQuizHostNote, genCharPeerReview, genQuizResult,
    normalizeTheaterQuizSession, DEFAULT_THEATER_QUIZ_SETTINGS,
    genExtraPiece, genFauxPiece, formatFauxExport,
    type ExtraKind, type FauxKind, type FauxResult,
    type ExtraWorkshopTone, type ExtraWorkshopLength, type ExtraWorkshopPov,
} from '../../utils/theaterExtra';
import {
    bankQuizNames, bankQuizNamesByTag, bankQuizTags, getBankQuestions, isBankQuiz, quizBankMeta,
    instructionsForKind, pickInstruction, EXTRA_INSTRUCTIONS, type ExtraBankKind,
} from '../../utils/theaterExtraBank';
import { parseTheaterCustomLibraryJson } from '../../utils/theaterCustomLibrary';
import {
    WeChatScreenshot, MomentsCard, XhsCard, ForumThread,
    WeiboHotCard, QzoneCard, DoubanThread, CampusWallCard,
    MemoScreen, ScheduleScreen, ReceiptScreen, BrowserResults,
} from '../../components/theater/faux/FauxRenderers';
import {
    PaperShell, ScrapScroll, ScrapHeader, Polaroid, ScrapButton, PaperCard, Stamp,
    SectionTag, PaperDialog, INK, INK_SOFT,
} from '../ui/insScrapKit';
import type {
    CharacterProfile, TheaterFauxPiece, TheaterQuizAnswer, TheaterQuizComment, TheaterQuizItem, TheaterQuizSession,
    FauxWeChat, FauxMoments, FauxXhs, FauxForum,
    FauxWeibo, FauxQzone, FauxDouban, FauxCampus, FauxMemo, FauxSchedule, FauxReceipt, FauxBrowser,
    TheaterCustomLibraryItem, TheaterCustomPiecePreset, TheaterCustomQuizPreset,
} from '../../types';

/**
 * 折子戏·番外（贰）：选一个角色一起做「番外」。
 *  - 问卷番外：可保存/续做的问卷房间，支持单角色或多角色，角色答、用户答、题内评论区继续聊；
 *  - 番外工坊 / 仿真图文：围绕角色一次性生成贴吧帖 / 聊天记录 / 热梗 / 采访稿 / 日记 / 微信朋友圈 / 微博热搜 / QQ 空间 / 豆瓣小组等主题番外。
 * 黑白拼贴手账皮肤（仿真图文渲染保留原样，模拟真 App 观感）。
 */

interface Props { onExit: () => void; }

type Mode = 'home' | 'quiz' | 'piece' | 'faux';
type QuizPlayMode = 'single' | 'multi';
type ExportKind = 'summary' | 'full' | 'result';
type FauxGroup = 'social' | 'platform' | 'phone';

const QUIZ_USER_ID = 'user';

const QUIZ_FALLBACK_PRESETS = ['亲密边界30问', '暧昧拉扯36问', '价值观问卷', '无厘头问卷50题'];
const QUIZ_TAG_ALL = '全部';

const FAUX_GROUPS: { id: FauxGroup; label: string; en: string }[] = [
    { id: 'social', label: '社交截图', en: 'SOCIAL' },
    { id: 'platform', label: '内容平台', en: 'PLATFORM' },
    { id: 'phone', label: '手机证据', en: 'PHONE' },
];

const FAUX_TABS: { kind: FauxKind; group: FauxGroup; label: string; icon: React.ReactNode; hint: string; ph: string }[] = [
    { kind: 'wechat', group: 'social', label: '微信聊天', icon: <WechatLogo size={18} weight="fill" />, hint: '仿“捡手机”看到的、极真实接地气的 user×char 微信聊天记录', ph: '聊天关键词（如：深夜报备 / 吵架冷战 / 出差想你）' },
    { kind: 'moments', group: 'social', label: '朋友圈', icon: <Camera size={18} weight="bold" />, hint: '一条仿微信朋友圈，配图 + 点赞 + 评论，藏点两人的暗流', ph: '想发什么内容？（留空＝深扒两人近况）' },
    { kind: 'qzone', group: 'social', label: 'QQ空间', icon: <Sparkle size={18} weight="bold" />, hint: '怀旧空间动态，访客、点赞和评论里藏着心事', ph: '空间动态主题（如：TA 半夜发了一条看似普通的说说）' },
    { kind: 'campus', group: 'social', label: '校园墙', icon: <Megaphone size={18} weight="bold" />, hint: '匿名投稿 + 校园评论区，适合偶遇、表白墙和围观', ph: '校园墙主题（如：投稿偶遇 TA 和我在教学楼门口）' },
    { kind: 'xhs', group: 'platform', label: '小红书', icon: <ImagesSquare size={18} weight="bold" />, hint: '图文并茂的小红书笔记，标题党 + 话题 + 评论', ph: '笔记主题（如：深扒我对象 / 和 TA 的100件小事）' },
    { kind: 'forum', group: 'platform', label: '匿名论坛', icon: <Megaphone size={18} weight="bold" />, hint: '匿名帖 + 多层跟帖吃瓜，深扒 char×user 的八卦', ph: '想开什么帖？（留空＝关于 TA 的瓜）' },
    { kind: 'weibo', group: 'platform', label: '微博热搜', icon: <Fire size={18} weight="bold" />, hint: '热搜话题 + 微博正文 + 热评，适合公开吃瓜和事件发酵', ph: '热搜主题（如：TA 和我被路人拍到 / 某个名场面冲上热搜）' },
    { kind: 'douban', group: 'platform', label: '豆瓣小组', icon: <ChatsCircle size={18} weight="bold" />, hint: '克制的小组讨论，网友慢慢分析关系细节', ph: '小组帖子主题（如：大家帮我分析 TA 是不是在意我）' },
    { kind: 'memo', group: 'phone', label: '备忘录', icon: <Notebook size={18} weight="bold" />, hint: '手机备忘录截图，像私下写给自己的清单、草稿或证据', ph: '备忘录主题（如：TA 记下了关于我的几件小事）' },
    { kind: 'schedule', group: 'phone', label: '日程表', icon: <CalendarDots size={18} weight="bold" />, hint: '一天的日程或待办，时间安排里藏着关系线索', ph: '日程主题（如：TA 的某一天安排里全是和我有关的事）' },
    { kind: 'receipt', group: 'phone', label: '订单小票', icon: <ClipboardText size={18} weight="bold" />, hint: '订单、小票或外卖记录，像从手机里扒出的生活证据', ph: '订单主题（如：TA 偷偷给我点了一单很会的小东西）' },
    { kind: 'browser', group: 'phone', label: '搜索页', icon: <FileMagnifyingGlass size={18} weight="bold" />, hint: '浏览器搜索页，搜索词和结果暴露了没说出口的问题', ph: '搜索主题（如：TA 搜过“怎么自然地说想你”）' },
];

const PIECE_TABS: { kind: ExtraKind; label: string; icon: React.ReactNode; hint: string; ph: string }[] = [
    { kind: 'tieba', label: '贴吧帖', icon: <ChatsCircle size={18} weight="bold" />, hint: '以 TA 为话题的求助/讨论帖 + 网友回复', ph: '想发什么帖？（如：求助 TA 最近好奇怪 / 这角色到底什么来头）' },
    { kind: 'chatlog', label: '聊天记录', icon: <NotePencil size={18} weight="bold" />, hint: '围绕 TA 的一段群聊/对话截图文字稿', ph: '聊天背景（如：群里突然聊到 TA / 闺蜜八卦）' },
    { kind: 'meme', label: '热梗', icon: <Fire size={18} weight="bold" />, hint: '把 TA 套进当下流行梗里', ph: '想玩哪方面的梗？（留空＝TA 的性格名场面）' },
    { kind: 'interview', label: '采访稿', icon: <MicrophoneStage size={18} weight="bold" />, hint: '主持人追问 + 角色回答，适合访谈、拷问和人物专访', ph: '采访主题（如：谈谈你和我的关系 / 最近最不想承认的事）' },
    { kind: 'barrage', label: '弹幕实况', icon: <Presentation size={18} weight="bold" />, hint: '把名场面剪成直播/综艺片段，弹幕和后期字幕一起刷屏', ph: '实况主题（如：TA 被拍到偷偷吃醋 / 约会名场面）' },
    { kind: 'diary', label: '私密日记', icon: <Notebook size={18} weight="bold" />, hint: '像 TA 真正写给自己的日记或备忘录，琐碎、隐秘、有私心', ph: '日记主题（如：今天又被你看穿了 / 不该心软的）' },
    { kind: 'letter', label: '未寄信', icon: <EnvelopeOpen size={18} weight="bold" />, hint: '一封没发出去的信、邮件草稿或语音转文字', ph: '写给谁、因为什么没寄出？（留空＝写给你）' },
    { kind: 'tabloid', label: '小报', icon: <NewspaperClipping size={18} weight="bold" />, hint: '八卦小报 / 营销号图文，标题抓人、评论区热闹', ph: '想爆什么料？（如：路人拍到 TA 的反常细节）' },
    { kind: 'timeline', label: '时间线', icon: <CalendarDots size={18} weight="bold" />, hint: '把关系、事件或误会整理成节点年表，越看越有暗线', ph: '时间线主题（如：我们怎么一步步走到现在）' },
    { kind: 'script', label: '脚本', icon: <ClipboardText size={18} weight="bold" />, hint: '影视分镜式名场面，场景、动作、台词和停顿都写出来', ph: '想拍哪段名场面？（如：雨夜摊牌 / 电梯里没说出口）' },
    { kind: 'casefile', label: '档案', icon: <FileMagnifyingGlass size={18} weight="bold" />, hint: '一本正经的观察报告 / 研究档案，严肃格式里藏不住情绪', ph: '档案主题（如：TA 在我面前异常反应观察报告）' },
    { kind: 'custom', label: '自定义', icon: <Sparkle size={18} weight="bold" />, hint: '你说要什么番外，就写什么', ph: '描述你想要的番外…' },
];

const PIECE_TONE_OPTIONS: { id: ExtraWorkshopTone; label: string }[] = [
    { id: 'faithful', label: '原味' },
    { id: 'sweet', label: '甜' },
    { id: 'funny', label: '整活' },
    { id: 'angsty', label: '酸涩' },
    { id: 'suspense', label: '悬疑' },
];

const PIECE_LENGTH_OPTIONS: { id: ExtraWorkshopLength; label: string }[] = [
    { id: 'short', label: '短' },
    { id: 'medium', label: '标准' },
    { id: 'long', label: '长篇' },
];

const PIECE_POV_OPTIONS: { id: ExtraWorkshopPov; label: string }[] = [
    { id: 'auto', label: '自动' },
    { id: 'char', label: 'TA' },
    { id: 'user', label: '我' },
    { id: 'third', label: '第三' },
    { id: 'outsider', label: '旁观' },
];

const paperInput: React.CSSProperties = { background: 'rgba(255,253,247,0.85)', color: '#3a362f', border: '1px solid rgba(176,170,158,0.7)' };

// ⚠️ 下面这几个积木**必须放在组件外**：若放进 ExtraApp 体内，每次 render 都会生成新组件标识，
// React 会把 <Page> 整棵子树卸载重挂；useOS() 的 virtualTime 每秒一跳会导致子页一直闪屏。

const tabStyle = (on: boolean): React.CSSProperties => on
    ? { background: '#1f1d1a', color: '#f6f3ec', border: '1px solid #1f1d1a' }
    : { background: 'rgba(255,253,247,0.7)', color: '#5b554a', border: '1px solid rgba(176,170,158,0.65)' };

const Page: React.FC<{ title: string; en: string; onBack: () => void; backLabel?: string; right?: React.ReactNode; children: React.ReactNode }> = ({ title, en, onBack, backLabel = '返回', right, children }) => (
    <PaperShell>
        <ScrapHeader title={title} en={en} onBack={onBack} backLabel={backLabel} right={right} />
        <ScrapScroll className="px-5 pb-10 space-y-4 pt-1">{children}</ScrapScroll>
    </PaperShell>
);

const CharPicker: React.FC<{ characters: CharacterProfile[]; pickCharId: string; setPickCharId: (id: string) => void }> = ({ characters, pickCharId, setPickCharId }) => (
    <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1 px-0.5">
        {characters.length === 0 && <div className="text-xs py-2" style={{ color: INK_SOFT }}>还没有角色，先去创建一个吧</div>}
        {characters.map((c, i) => (
            <Polaroid key={c.id} src={c.avatar} caption={c.name} size={48} rotate={i % 2 ? 1.5 : -1.5} selected={pickCharId === c.id} onClick={() => setPickCharId(c.id)} />
        ))}
    </div>
);

const QuizParticipantPicker: React.FC<{
    characters: CharacterProfile[];
    selectedIds: Set<string>;
    playMode: QuizPlayMode;
    onToggle: (id: string) => void;
}> = ({ characters, selectedIds, playMode, onToggle }) => (
    <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1 px-0.5">
        {characters.length === 0 && <div className="text-xs py-2" style={{ color: INK_SOFT }}>还没有角色，先去创建一个吧</div>}
        {characters.map((c, i) => (
            <Polaroid
                key={c.id}
                src={c.avatar}
                caption={c.name}
                size={52}
                rotate={i % 2 ? 1.5 : -1.5}
                selected={selectedIds.has(c.id)}
                onClick={() => onToggle(c.id)}
            />
        ))}
        {playMode === 'multi' && characters.length > 0 && (
            <div className="shrink-0 flex items-center text-[10px] leading-relaxed max-w-[86px]" style={{ color: INK_SOFT }}>
                最多 6 位，第一位默认作为导出聊天对象
            </div>
        )}
    </div>
);

const InstructionRow: React.FC<{ kind: ExtraBankKind; onPick: (s: string) => void }> = ({ kind, onPick }) => {
    if (!EXTRA_INSTRUCTIONS.length) return null;
    const list = instructionsForKind(kind);
    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between">
                <span className="text-[10px] tracking-[0.18em]" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>指令库 · 你的文档</span>
                <button onClick={() => { const ins = pickInstruction(kind); if (ins) onPick(ins.instruction); }} className="text-[11px] font-bold active:scale-95" style={{ color: INK }}>随机挑一条</button>
            </div>
            {list.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {list.map((ins, i) => (
                        <button key={i} onClick={() => onPick(ins.instruction)} title={ins.instruction} className="px-2.5 py-1 rounded-full text-[11px] font-bold active:scale-95" style={tabStyle(false)}>{ins.label}</button>
                    ))}
                </div>
            )}
        </div>
    );
};

const genId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const shortDate = (ts: number) => new Date(ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const tabForFauxKind = (kind: FauxKind) => FAUX_TABS.find(t => t.kind === kind) || FAUX_TABS[0];

const renderFauxPreview = (kind: FauxKind, data: TheaterFauxPiece['data'], avatars: { charAvatar?: string; userAvatar?: string }) => {
    if (!data) return null;
    if (kind === 'wechat') return <WeChatScreenshot data={data as FauxWeChat} charAvatar={avatars.charAvatar} userAvatar={avatars.userAvatar} />;
    if (kind === 'moments') return <MomentsCard data={data as FauxMoments} avatar={avatars.charAvatar} />;
    if (kind === 'xhs') return <XhsCard data={data as FauxXhs} />;
    if (kind === 'forum') return <ForumThread data={data as FauxForum} />;
    if (kind === 'weibo') return <WeiboHotCard data={data as FauxWeibo} />;
    if (kind === 'qzone') return <QzoneCard data={data as FauxQzone} />;
    if (kind === 'douban') return <DoubanThread data={data as FauxDouban} />;
    if (kind === 'campus') return <CampusWallCard data={data as FauxCampus} />;
    if (kind === 'memo') return <MemoScreen data={data as FauxMemo} />;
    if (kind === 'schedule') return <ScheduleScreen data={data as FauxSchedule} />;
    if (kind === 'receipt') return <ReceiptScreen data={data as FauxReceipt} />;
    return <BrowserResults data={data as FauxBrowser} />;
};

const ExtraApp: React.FC<Props> = ({ onExit }) => {
    const { characters, apiConfig, auxApiConfig, userProfile, addToast } = useOS();
    const [theaterApiOverride, setTheaterApiOverride] = useState<LocalApiOverrideConfig>(() => loadLocalApiOverride('theaterExtra'));
    const api = useMemo(
        () => resolveScopedLocalApi('theaterExtra', auxApiConfig, apiConfig),
        [apiConfig, auxApiConfig, theaterApiOverride],
    );
    const apiReady = !!(api.baseUrl && api.model);
    const theaterApiOverrideOn = isLocalApiOverrideComplete(theaterApiOverride);
    const userName = (userProfile?.name || '').trim() || '你';

    const [mode, setMode] = useState<Mode>('home');
    const [pickCharId, setPickCharId] = useState('');
    const char = characters.find(c => c.id === pickCharId);
    const customLibraryInputRef = useRef<HTMLInputElement>(null);
    const [customLibrary, setCustomLibrary] = useState<TheaterCustomLibraryItem[]>([]);

    const [topic, setTopic] = useState('');
    const [busy, setBusy] = useState(false);
    const [busyLabel, setBusyLabel] = useState('');
    const [showTheaterApiDialog, setShowTheaterApiDialog] = useState(false);
    const [theaterApiDraft, setTheaterApiDraft] = useState<LocalApiOverrideConfig>(theaterApiOverride);
    const [theaterApiStatus, setTheaterApiStatus] = useState('');
    const [testingTheaterApi, setTestingTheaterApi] = useState(false);
    const [fetchingTheaterModels, setFetchingTheaterModels] = useState(false);
    const [theaterApiModels, setTheaterApiModels] = useState<string[]>([]);
    const [showTheaterApiModels, setShowTheaterApiModels] = useState(false);

    const [quizPlayMode, setQuizPlayMode] = useState<QuizPlayMode>('single');
    const [quizParticipantIds, setQuizParticipantIds] = useState<Set<string>>(new Set());
    const [quizTag, setQuizTag] = useState(QUIZ_TAG_ALL);
    const [quizHistory, setQuizHistory] = useState<TheaterQuizSession[]>([]);
    const [quizSession, setQuizSession] = useState<TheaterQuizSession | null>(null);
    const quizSessionRef = useRef<TheaterQuizSession | null>(null);
    const [quizInput, setQuizInput] = useState('');
    const [commentBusyIds, setCommentBusyIds] = useState<Set<string>>(new Set());
    const [exportOpen, setExportOpen] = useState(false);
    const [exportTargetId, setExportTargetId] = useState('');

    const [pieceKind, setPieceKind] = useState<ExtraKind>('tieba');
    const [piecePrompt, setPiecePrompt] = useState('');
    const [pieceTone, setPieceTone] = useState<ExtraWorkshopTone>('faithful');
    const [pieceLength, setPieceLength] = useState<ExtraWorkshopLength>('medium');
    const [piecePov, setPiecePov] = useState<ExtraWorkshopPov>('auto');
    const [piece, setPiece] = useState('');

    const [fauxKind, setFauxKind] = useState<FauxKind>('wechat');
    const [fauxKeyword, setFauxKeyword] = useState('');
    const [fauxResult, setFauxResult] = useState<FauxResult | null>(null);
    const [fauxHistory, setFauxHistory] = useState<TheaterFauxPiece[]>([]);
    const [fauxActivePiece, setFauxActivePiece] = useState<TheaterFauxPiece | null>(null);

    useEffect(() => { quizSessionRef.current = quizSession; }, [quizSession]);

    const refreshQuizHistory = async () => {
        const list = await DB.getAllTheaterQuizSessions().catch(() => []);
        setQuizHistory(list.map(normalizeTheaterQuizSession));
    };

    const refreshFauxHistory = async () => {
        const list = await DB.getAllTheaterFauxPieces().catch(() => []);
        setFauxHistory(list);
    };

    const refreshCustomLibrary = async () => {
        const list = await DB.getAllTheaterCustomLibraryItems().catch(() => []);
        setCustomLibrary(list);
    };

    useEffect(() => {
        void refreshCustomLibrary();
    }, []);

    useEffect(() => {
        if (mode === 'quiz') void refreshQuizHistory();
    }, [mode]);

    useEffect(() => {
        if (mode === 'faux') void refreshFauxHistory();
    }, [mode]);

    const setTheaterApiDraftField = (field: keyof LocalApiOverrideConfig, value: string) => {
        setTheaterApiDraft(prev => ({ ...prev, [field]: value }));
    };

    const openTheaterApiDialog = () => {
        const saved = loadLocalApiOverride('theaterExtra');
        setTheaterApiOverride(saved);
        setTheaterApiDraft(saved);
        setTheaterApiStatus('');
        setShowTheaterApiDialog(true);
    };

    const copyMainToTheaterApi = () => {
        setTheaterApiDraft({
            baseUrl: apiConfig.baseUrl || '',
            apiKey: apiConfig.apiKey || '',
            model: apiConfig.model || '',
        });
        setTheaterApiStatus('已复制主 API，保存后生效');
    };

    const copyAuxToTheaterApi = () => {
        const aux = resolveAuxApi(auxApiConfig, apiConfig);
        setTheaterApiDraft({
            baseUrl: aux.baseUrl || '',
            apiKey: aux.apiKey || '',
            model: aux.model || '',
        });
        setTheaterApiStatus('已复制副 API 当前线路，保存后生效');
    };

    const saveTheaterApi = () => {
        try {
            const saved = saveLocalApiOverride('theaterExtra', theaterApiDraft);
            setTheaterApiOverride(saved);
            setTheaterApiDraft(saved);
            setTheaterApiStatus(saved.baseUrl ? '折子戏番外专用 API 已保存' : '折子戏番外专用 API 已清除');
            addToast(saved.baseUrl ? '番外会优先使用这条专用 API' : '番外已回到文具盒副 API / 主 API', 'success');
        } catch (e: any) {
            const msg = e?.message || '保存失败';
            setTheaterApiStatus(msg);
            addToast(msg, 'error');
        }
    };

    const clearTheaterApi = () => {
        clearLocalApiOverride('theaterExtra');
        const empty = loadLocalApiOverride('theaterExtra');
        setTheaterApiOverride(empty);
        setTheaterApiDraft(empty);
        setTheaterApiStatus('已清除，之后回退文具盒副 API / 主 API');
        addToast('折子戏番外专用 API 已清除', 'success');
    };

    const testTheaterApi = async () => {
        const baseUrl = theaterApiDraft.baseUrl.trim();
        const model = theaterApiDraft.model.trim();
        if (!baseUrl || !model) {
            setTheaterApiStatus('测试前需要填写 Base URL 和模型名');
            return;
        }
        setTestingTheaterApi(true);
        setTheaterApiStatus('正在测试连接…');
        try {
            const reply = await testChatConnection(
                { baseUrl, apiKey: theaterApiDraft.apiKey.trim(), model },
                {
                    stream: false,
                    meta: makeApiUsageMeta('theater.extra', {
                        apiRole: 'custom',
                        apiBinding: '折子戏番外专用 API',
                        isBackgroundTask: false,
                    }),
                },
            );
            setTheaterApiStatus(`连接成功：${reply.slice(0, 30) || '模型已响应'}`);
        } catch (e: any) {
            setTheaterApiStatus(`连接失败：${e?.message || '请检查地址、Key 和模型名'}`);
        } finally {
            setTestingTheaterApi(false);
        }
    };

    const fetchTheaterApiModels = async () => {
        const baseUrl = theaterApiDraft.baseUrl.trim();
        if (!baseUrl) {
            setTheaterApiStatus('拉取模型前需要填写 Base URL');
            addToast('请先填写番外专用 API 的 Base URL', 'info');
            return;
        }
        setFetchingTheaterModels(true);
        setTheaterApiStatus('正在拉取模型列表…');
        try {
            const models = await fetchModelList(
                { baseUrl, apiKey: theaterApiDraft.apiKey.trim() },
                {
                    meta: makeApiUsageMeta('theater.extraApi.fetchModels', {
                        apiRole: 'custom',
                        apiBinding: '折子戏番外专用 API',
                        isBackgroundTask: false,
                    }),
                },
            );
            if (!models.length) {
                setTheaterApiStatus('没有识别到模型列表，可以继续手动填写模型名');
                addToast('没有识别到模型列表，可以手动填写模型名', 'info');
                return;
            }
            setTheaterApiModels(models);
            setShowTheaterApiModels(true);
            setTheaterApiDraft(prev => models.includes(prev.model.trim()) ? prev : { ...prev, model: models[0] });
            setTheaterApiStatus(`已拉取 ${models.length} 个模型，选好后记得保存`);
            addToast(`已拉取 ${models.length} 个模型，请保存番外专用 API`, 'success');
        } catch (e: any) {
            const msg = e?.message || '请检查地址和密钥';
            setTheaterApiStatus(`拉取模型失败：${msg}`);
            addToast(`拉取模型失败：${msg}`, 'error');
        } finally {
            setFetchingTheaterModels(false);
        }
    };

    const customPieces = useMemo(
        () => customLibrary.filter((item): item is TheaterCustomPiecePreset => item.kind === 'piece'),
        [customLibrary],
    );
    const customQuizzes = useMemo(
        () => customLibrary.filter((item): item is TheaterCustomQuizPreset => item.kind === 'quiz'),
        [customLibrary],
    );
    const customQuizForTopic = (name: string) => customQuizzes.find(q => q.title.trim() === name.trim());
    const customQuizTags = useMemo(() => [...new Set(customQuizzes.flatMap(q => q.tags || []))], [customQuizzes]);
    const quizTags = useMemo(() => [...new Set([QUIZ_TAG_ALL, ...bankQuizTags(), ...customQuizTags])], [customQuizTags]);
    const customQuizNamesByTag = useMemo(() => {
        if (!quizTag || quizTag === QUIZ_TAG_ALL) return customQuizzes.map(q => q.title);
        return customQuizzes.filter(q => (q.tags || []).includes(quizTag)).map(q => q.title);
    }, [customQuizzes, quizTag]);
    const quizPresets = useMemo(() => [...new Set([...customQuizNamesByTag, ...bankQuizNamesByTag(quizTag), ...QUIZ_FALLBACK_PRESETS])], [customQuizNamesByTag, quizTag]);
    const selectedQuizMeta = useMemo(() => {
        const t = topic.trim();
        const custom = customQuizForTopic(t);
        if (custom) {
            return {
                title: custom.title,
                tags: custom.tags || ['问卷'],
                description: custom.description || '你导入的自定义问卷，会按顺序出题。',
                recommendedParticipants: custom.recommendedParticipants || '1-6 位',
                questionCount: custom.questions.length,
                imported: true,
            };
        }
        return t && isBankQuiz(t) ? { ...quizBankMeta(t), imported: false } : null;
    }, [topic, customQuizzes]);
    const readTextFile = (file: File) => new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
        reader.readAsText(file);
    });
    const handleCustomLibraryImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const text = await readTextFile(file);
            const parsed = parseTheaterCustomLibraryJson(text, { sourceName: file.name });
            const existingById = new Map(customLibrary.map(item => [item.id, item]));
            const items = parsed.items.map(item => {
                const existing = existingById.get(item.id);
                return existing ? { ...item, createdAt: existing.createdAt } : item;
            });
            await DB.bulkSaveTheaterCustomLibraryItems(items);
            setCustomLibrary(prev => {
                const next = new Map(prev.map(item => [item.id, item]));
                items.forEach(item => next.set(item.id, item));
                return [...next.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
            });
            addToast(`已导入 ${parsed.pieceCount} 个小剧场、${parsed.quizCount} 份问卷`, 'success');
        } catch (err: any) {
            addToast(err?.message || '导入失败', 'error');
        } finally {
            e.target.value = '';
        }
    };
    const deleteCustomLibraryItem = async (item: TheaterCustomLibraryItem) => {
        try {
            await DB.deleteTheaterCustomLibraryItem(item.id);
            setCustomLibrary(prev => prev.filter(x => x.id !== item.id));
            if (item.kind === 'quiz' && topic.trim() === item.title) setTopic('');
            addToast(`已删除「${item.title}」`, 'success');
        } catch {
            addToast('删除失败', 'error');
        }
    };
    const customLibraryInput = (
        <input
            ref={customLibraryInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={handleCustomLibraryImport}
        />
    );
    const customLibraryImportButton = (
        <button
            onClick={() => customLibraryInputRef.current?.click()}
            title="导入自定义小剧场 / 问卷 JSON"
            className="shrink-0 w-9 h-9 rounded-full inline-flex items-center justify-center active:scale-95"
            style={{ background: '#fff', color: INK, border: '1px solid rgba(31,29,26,0.12)' }}
        >
            <FileArrowUp size={17} weight="bold" />
        </button>
    );
    const theaterApiButton = (
        <button
            onClick={openTheaterApiDialog}
            title={theaterApiOverrideOn ? '折子戏番外专用 API 已启用' : '折子戏番外专用 API'}
            className="shrink-0 w-9 h-9 rounded-full inline-flex items-center justify-center active:scale-95"
            style={theaterApiOverrideOn ? { background: INK, color: '#f6f3ec' } : { background: '#fff', color: INK, border: '1px solid rgba(31,29,26,0.12)' }}
        >
            <PlugsConnected size={17} weight={theaterApiOverrideOn ? 'fill' : 'bold'} />
        </button>
    );
    const theaterApiDialog = (
        <PaperDialog
            open={showTheaterApiDialog}
            onClose={() => setShowTheaterApiDialog(false)}
            title="番外专用 API"
            en="LOCAL API"
            actions={(
                <>
                    <ScrapButton variant="paper" className="flex-1 py-2 text-[12px]" disabled={testingTheaterApi} onClick={() => void testTheaterApi()}>
                        {testingTheaterApi ? '测试中' : '测试'}
                    </ScrapButton>
                    <ScrapButton variant="paper" className="flex-1 py-2 text-[12px]" onClick={clearTheaterApi}>清除</ScrapButton>
                    <ScrapButton variant="ink" className="flex-1 py-2 text-[12px]" onClick={saveTheaterApi}>保存</ScrapButton>
                </>
            )}
        >
            <div className="space-y-3 text-left">
                <div className="rounded-xl p-3 text-[11px] leading-relaxed" style={{ background: 'rgba(31,29,26,0.06)', color: '#5f594f' }}>
                    填完整后，问卷番外、番外工坊和仿真图文都会优先使用这里；清除后自动回到文具盒副 API / 主 API。
                </div>
                <div className="grid grid-cols-3 gap-2">
                    <ScrapButton variant="paper" className="py-2 text-[12px]" onClick={copyMainToTheaterApi}>复制主 API</ScrapButton>
                    <ScrapButton variant="paper" className="py-2 text-[12px]" onClick={copyAuxToTheaterApi}>复制副 API</ScrapButton>
                    <ScrapButton variant="paper" className="py-2 text-[12px]" disabled={fetchingTheaterModels} onClick={() => void fetchTheaterApiModels()}>
                        {fetchingTheaterModels ? '拉取中' : '拉取模型'}
                    </ScrapButton>
                </div>
                <div>
                    <label className="text-[10px] font-black" style={{ color: INK_SOFT }}>BASE URL · 接口地址</label>
                    <input
                        value={theaterApiDraft.baseUrl}
                        onChange={e => setTheaterApiDraftField('baseUrl', e.target.value)}
                        placeholder="https://your-api.example.com/v1"
                        className="mt-1 w-full rounded-xl px-3 py-2.5 text-sm outline-none font-mono"
                        style={paperInput}
                    />
                </div>
                <div>
                    <label className="text-[10px] font-black" style={{ color: INK_SOFT }}>API KEY · 密钥</label>
                    <input
                        type="password"
                        value={theaterApiDraft.apiKey}
                        onChange={e => setTheaterApiDraftField('apiKey', e.target.value)}
                        placeholder="可留空，本地接口会自动用免鉴权兜底"
                        className="mt-1 w-full rounded-xl px-3 py-2.5 text-sm outline-none font-mono"
                        style={paperInput}
                    />
                </div>
                <div>
                    <label className="text-[10px] font-black" style={{ color: INK_SOFT }}>MODEL · 模型名</label>
                    <input
                        value={theaterApiDraft.model}
                        onChange={e => setTheaterApiDraftField('model', e.target.value)}
                        placeholder="模型名"
                        className="mt-1 w-full rounded-xl px-3 py-2.5 text-sm outline-none font-mono"
                        style={paperInput}
                    />
                    {theaterApiModels.length > 0 && (
                        <div className="mt-2 rounded-xl overflow-hidden" style={{ background: 'rgba(255,253,247,0.72)', border: '1px solid rgba(176,170,158,0.55)' }}>
                            <button
                                type="button"
                                onClick={() => setShowTheaterApiModels(v => !v)}
                                className="w-full px-3 py-2 flex items-center justify-between text-[11px] font-black"
                                style={{ color: INK }}
                            >
                                <span>已拉取 {theaterApiModels.length} 个模型</span>
                                <span>{showTheaterApiModels ? '收起' : '选择'}</span>
                            </button>
                            {showTheaterApiModels && (
                                <div className="max-h-44 overflow-y-auto p-1.5 space-y-1">
                                    {theaterApiModels.map(model => (
                                        <button
                                            key={model}
                                            type="button"
                                            onClick={() => {
                                                setTheaterApiDraftField('model', model);
                                                setShowTheaterApiModels(false);
                                                setTheaterApiStatus('已选择模型，保存后生效');
                                            }}
                                            className="w-full text-left px-2.5 py-1.5 rounded-lg text-[11px] font-mono break-all"
                                            style={{
                                                background: theaterApiDraft.model.trim() === model ? 'rgba(31,29,26,0.1)' : 'transparent',
                                                color: theaterApiDraft.model.trim() === model ? INK : INK_SOFT,
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
                {theaterApiStatus && (
                    <div className="rounded-xl px-3 py-2 text-[11px] leading-relaxed" style={{ background: 'rgba(255,253,247,0.72)', border: '1px solid rgba(176,170,158,0.55)', color: '#5f594f' }}>
                        {theaterApiStatus}
                    </div>
                )}
            </div>
        </PaperDialog>
    );

    const participantChars = useMemo(
        () => characters.filter(c => quizParticipantIds.has(c.id)),
        [characters, quizParticipantIds],
    );

    const sessionChars = (s: TheaterQuizSession | null = quizSession) =>
        s ? s.participantIds.map(id => characters.find(c => c.id === id)).filter((c): c is CharacterProfile => !!c) : [];

    const touchSession = (s: TheaterQuizSession): TheaterQuizSession => ({ ...s, lastActiveAt: Date.now() });

    const commitQuizSession = async (next: TheaterQuizSession) => {
        const touched = normalizeTheaterQuizSession(touchSession(next));
        quizSessionRef.current = touched;
        setQuizSession(touched);
        setQuizHistory(prev => [touched, ...prev.filter(s => s.id !== touched.id)].sort((a, b) => b.lastActiveAt - a.lastActiveAt));
        await DB.saveTheaterQuizSession(touched);
        return touched;
    };

    const updateQuizSession = (updater: (s: TheaterQuizSession) => TheaterQuizSession): TheaterQuizSession | null => {
        const base = quizSessionRef.current;
        if (!base) return null;
        const next = normalizeTheaterQuizSession(touchSession(updater(base)));
        quizSessionRef.current = next;
        setQuizSession(next);
        setQuizHistory(prev => [next, ...prev.filter(s => s.id !== next.id)].sort((a, b) => b.lastActiveAt - a.lastActiveAt));
        void DB.saveTheaterQuizSession(next).catch(() => {});
        return next;
    };

    const toggleQuizParticipant = (id: string) => {
        setQuizParticipantIds(prev => {
            if (quizPlayMode === 'single') return new Set([id]);
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else if (next.size < 6) next.add(id);
            else addToast('多角色问卷最多 6 位', 'info');
            return next;
        });
        if (!pickCharId) setPickCharId(id);
    };

    const switchQuizPlayMode = (nextMode: QuizPlayMode) => {
        setQuizPlayMode(nextMode);
        setQuizParticipantIds(prev => {
            const arr = [...prev];
            if (nextMode === 'single') return new Set(arr.slice(0, 1));
            return new Set(arr.slice(0, 6));
        });
    };

    const userAnswerFor = (item?: TheaterQuizItem) => item?.answers[QUIZ_USER_ID]?.text || '';
    const charAnswerFor = (item: TheaterQuizItem, charId: string) => item.answers[charId]?.text || '';
    const isUserAnswered = (item?: TheaterQuizItem) => !!item && item.answers[QUIZ_USER_ID]?.status === 'done';
    const currentItem = quizSession?.items[quizSession.currentIndex];
    const currentChars = sessionChars();
    const hasPendingCharAnswer = !!currentItem && currentChars.some(c => currentItem.answers[c.id]?.status === 'pending');

    const makeUserAnswer = (text = '', status: TheaterQuizAnswer['status'] = 'pending'): TheaterQuizAnswer => ({
        speakerId: QUIZ_USER_ID,
        speakerName: userName,
        isUser: true,
        avatar: userProfile?.avatar,
        text,
        status,
        at: Date.now(),
    });

    const makeCharAnswer = (c: CharacterProfile, text = '', status: TheaterQuizAnswer['status'] = 'pending', error?: string): TheaterQuizAnswer => ({
        speakerId: c.id,
        speakerName: c.name,
        isUser: false,
        charId: c.id,
        avatar: c.avatar,
        text,
        status,
        error,
        at: Date.now(),
    });

    const makeQuestionItem = (question: string, no: number, charsForItem: CharacterProfile[]): TheaterQuizItem => {
        const answers: Record<string, TheaterQuizAnswer> = { [QUIZ_USER_ID]: makeUserAnswer('', 'pending') };
        charsForItem.forEach(c => { answers[c.id] = makeCharAnswer(c); });
        return { no, question, answers, comments: [], state: 'answering', at: Date.now() };
    };

    const appendComment = (s: TheaterQuizSession, itemIndex: number, comment: TheaterQuizComment): TheaterQuizSession => ({
        ...s,
        items: s.items.map((it, i) => i === itemIndex ? { ...it, comments: [...it.comments, comment], state: 'commenting' } : it),
    });

    const addCommentBusy = (id: string) => setCommentBusyIds(prev => new Set(prev).add(id));
    const removeCommentBusy = (id: string) => setCommentBusyIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
    });

    const generateAnswersForItem = async (sessionId: string, itemIndex: number, charsForItem: CharacterProfile[]) => {
        await Promise.all(charsForItem.map(async c => {
            updateQuizSession(s => s.id === sessionId ? {
                ...s,
                items: s.items.map((it, i) => i === itemIndex ? {
                    ...it,
                    answers: { ...it.answers, [c.id]: makeCharAnswer(c, '', 'pending') },
                } : it),
            } : s);
            try {
                const latest = quizSessionRef.current;
                const item = latest?.items[itemIndex];
                const answer = await genCharAnswer({ api, char: c, userProfile, topic: latest?.topic || topic, question: item?.question || '' });
                updateQuizSession(s => s.id === sessionId ? {
                    ...s,
                    items: s.items.map((it, i) => i === itemIndex ? {
                        ...it,
                        answers: { ...it.answers, [c.id]: makeCharAnswer(c, answer, 'done') },
                    } : it),
                } : s);
            } catch (e: any) {
                updateQuizSession(s => s.id === sessionId ? {
                    ...s,
                    items: s.items.map((it, i) => i === itemIndex ? {
                        ...it,
                        answers: { ...it.answers, [c.id]: makeCharAnswer(c, '（回答失败，点重试）', 'failed', e?.message || String(e)) },
                    } : it),
                } : s);
            }
        }));
    };

    const createNextQuizItem = async (base: TheaterQuizSession, itemIndex: number): Promise<TheaterQuizSession> => {
        const charsForItem = sessionChars(base);
        const asked = base.items.map(it => it.question);
        const bank = customQuizForTopic(base.topic)?.questions || getBankQuestions(base.topic);
        const q = await genNextQuestion({ api, topic: base.topic, index: itemIndex, total: base.total, asked, bankQuestions: bank ?? undefined });
        const item = makeQuestionItem(q, itemIndex + 1, charsForItem);
        if (base.settings?.hostEnabled) {
            try {
                item.hostNote = await genQuizHostNote({
                    api,
                    topic: base.topic,
                    index: itemIndex,
                    total: base.total,
                    question: q,
                    participantNames: [userName, ...charsForItem.map(c => c.name)],
                    previousQuestion: asked[asked.length - 1],
                });
            } catch {
                item.hostNote = itemIndex === 0 ? '主持人把第一张题卡推到桌中央，笑着等大家先露馅。' : '主持人轻轻敲了敲题卡，示意下一轮开始。';
            }
        }
        const next: TheaterQuizSession = {
            ...base,
            currentIndex: itemIndex,
            items: [...base.items, item],
            status: 'active',
        };
        await commitQuizSession(next);
        void generateAnswersForItem(next.id, itemIndex, charsForItem);
        return next;
    };

    const startQuiz = async () => {
        const selected = participantChars;
        const t = topic.trim();
        if (!t) { addToast('想做哪份问卷？写一个名字～', 'info'); return; }
        if (!selected.length) { addToast('先选一起答题的角色', 'info'); return; }
        if (!apiReady) { addToast('还没配置 API，去「文具盒」填好再来', 'error'); return; }
        if (selected.length > 6) { addToast('多角色问卷最多 6 位', 'info'); return; }

        const bank = customQuizForTopic(t)?.questions || getBankQuestions(t);
        const n = bank ? bank.length : inferQuestionCount(t);
        const now = Date.now();
        const titleNames = selected.slice(0, 2).map(c => c.name).join('、') + (selected.length > 2 ? `等 ${selected.length} 人` : '');
        const session: TheaterQuizSession = {
            id: genId('tq'),
            title: `${t} · ${titleNames}`,
            topic: t,
            status: 'active',
            participantIds: selected.map(c => c.id),
            currentIndex: 0,
            total: n,
            items: [],
            settings: { ...DEFAULT_THEATER_QUIZ_SETTINGS },
            createdAt: now,
            lastActiveAt: now,
        };
        setBusy(true);
        setBusyLabel('正在出第一题…');
        setQuizInput('');
        try {
            quizSessionRef.current = session;
            setQuizSession(session);
            await DB.saveTheaterQuizSession(session);
            await createNextQuizItem(session, 0);
        } catch (e: any) {
            addToast('出题失败：' + (e?.message || e), 'error');
            setQuizSession(null);
            quizSessionRef.current = null;
        } finally {
            setBusy(false);
            setBusyLabel('');
            void refreshQuizHistory();
        }
    };

    const resumeQuiz = (s: TheaterQuizSession) => {
        const normalized = normalizeTheaterQuizSession(s);
        quizSessionRef.current = normalized;
        setQuizSession(normalized);
        setQuizInput('');
        setExportTargetId(normalized.participantIds[0] || '');
    };

    const deleteQuiz = async (id: string) => {
        await DB.deleteTheaterQuizSession(id);
        setQuizHistory(prev => prev.filter(s => s.id !== id));
        if (quizSession?.id === id) setQuizSession(null);
    };

    const retryCharAnswer = async (charId: string) => {
        const s = quizSessionRef.current;
        const item = s?.items[s.currentIndex];
        const c = characters.find(x => x.id === charId);
        if (!s || !item || !c || busy) return;
        setBusy(true);
        setBusyLabel(`${c.name} 正在重答…`);
        try {
            updateQuizSession(cur => ({
                ...cur,
                items: cur.items.map((it, i) => i === cur.currentIndex ? {
                    ...it,
                    answers: { ...it.answers, [charId]: makeCharAnswer(c, '', 'pending') },
                } : it),
            }));
            const answer = await genCharAnswer({ api, char: c, userProfile, topic: s.topic, question: item.question });
            updateQuizSession(cur => ({
                ...cur,
                items: cur.items.map((it, i) => i === cur.currentIndex ? {
                    ...it,
                    answers: { ...it.answers, [charId]: makeCharAnswer(c, answer, 'done') },
                } : it),
            }));
        } catch (e: any) {
            addToast('重答失败：' + (e?.message || e), 'error');
            updateQuizSession(cur => ({
                ...cur,
                items: cur.items.map((it, i) => i === cur.currentIndex ? {
                    ...it,
                    answers: { ...it.answers, [charId]: makeCharAnswer(c, '（回答失败，点重试）', 'failed', e?.message || String(e)) },
                } : it),
            }));
        } finally {
            setBusy(false);
            setBusyLabel('');
        }
    };

    const generateCommentForChar = async (charId: string, userComment?: string, itemIndexArg?: number) => {
        const s = quizSessionRef.current;
        const itemIndex = itemIndexArg ?? s?.currentIndex ?? 0;
        const item = s?.items[itemIndex];
        const c = characters.find(x => x.id === charId);
        if (!s || !item || !c) return;
        addCommentBusy(charId);
        try {
            const latestSession = quizSessionRef.current;
            const latestItem = latestSession?.items[itemIndex] || item;
            const text = await genCharComment({
                api,
                char: c,
                userProfile,
                topic: latestSession?.topic || s.topic,
                question: latestItem.question,
                userAnswer: userAnswerFor(latestItem),
                charAnswer: charAnswerFor(latestItem, charId),
                recentComments: latestItem.comments.map(cm => ({ speakerName: cm.speakerName, text: cm.text })),
                userComment,
            });
            const comment: TheaterQuizComment = {
                id: genId('tqc'),
                speakerId: c.id,
                speakerName: c.name,
                isUser: false,
                charId: c.id,
                avatar: c.avatar,
                text,
                targetSpeakerId: QUIZ_USER_ID,
                at: Date.now(),
            };
            updateQuizSession(cur => appendComment(cur, itemIndex, comment));
        } catch (e: any) {
            const fallback: TheaterQuizComment = {
                id: genId('tqc'),
                speakerId: c.id,
                speakerName: c.name,
                isUser: false,
                charId: c.id,
                avatar: c.avatar,
                text: '我刚才卡了一下……这题我想再认真接一句，等会儿点我“再说一句”试试。',
                targetSpeakerId: QUIZ_USER_ID,
                at: Date.now(),
            };
            updateQuizSession(cur => appendComment(cur, itemIndex, fallback));
            addToast(`${c.name} 评论失败：${e?.message || e}`, 'error');
        } finally {
            removeCommentBusy(charId);
        }
    };

    const generatePeerReview = async (speakerId: string, targetId: string, itemIndexArg?: number) => {
        const s = quizSessionRef.current;
        const itemIndex = itemIndexArg ?? s?.currentIndex ?? 0;
        const item = s?.items[itemIndex];
        const speaker = characters.find(x => x.id === speakerId);
        if (!s || !item || !speaker || !s.settings?.peerReviewEnabled) return;
        const targetName = targetId === QUIZ_USER_ID
            ? userName
            : characters.find(x => x.id === targetId)?.name || item.answers[targetId]?.speakerName || '对方';
        const targetAnswer = targetId === QUIZ_USER_ID ? userAnswerFor(item) : charAnswerFor(item, targetId);
        addCommentBusy(speakerId);
        try {
            const latestSession = quizSessionRef.current;
            const latestItem = latestSession?.items[itemIndex] || item;
            const text = await genCharPeerReview({
                api,
                char: speaker,
                userProfile,
                topic: latestSession?.topic || s.topic,
                question: latestItem.question,
                speakerAnswer: charAnswerFor(latestItem, speakerId),
                targetName,
                targetAnswer,
                recentComments: latestItem.comments.map(cm => ({ speakerName: cm.speakerName, text: cm.text })),
            });
            const comment: TheaterQuizComment = {
                id: genId('tqc'),
                speakerId: speaker.id,
                speakerName: speaker.name,
                isUser: false,
                charId: speaker.id,
                avatar: speaker.avatar,
                text,
                targetSpeakerId: targetId,
                at: Date.now(),
            };
            updateQuizSession(cur => appendComment(cur, itemIndex, comment));
        } catch (e: any) {
            addToast(`${speaker.name} 互评失败：${e?.message || e}`, 'error');
        } finally {
            removeCommentBusy(speakerId);
        }
    };

    const generateAllPeerReviews = async () => {
        const s = quizSessionRef.current;
        const item = s?.items[s.currentIndex];
        if (!s || !item || busy || commentBusyIds.size > 0) return;
        const chars = sessionChars(s);
        if (!chars.length) return;
        await Promise.all(chars.map((c, i) => {
            const others = [QUIZ_USER_ID, ...chars.filter(x => x.id !== c.id).map(x => x.id)];
            const targetId = others[i % others.length] || QUIZ_USER_ID;
            return generatePeerReview(c.id, targetId, s.currentIndex);
        }));
    };

    const generateResultForSession = async (sessionArg?: TheaterQuizSession) => {
        const s = sessionArg || quizSessionRef.current;
        if (!s || !s.settings?.resultEnabled || !apiReady) return null;
        setBusy(true);
        setBusyLabel('正在生成画像报告…');
        try {
            const participantNamesById = Object.fromEntries(sessionChars(s).map(c => [c.id, c.name]));
            const result = await genQuizResult({ api, session: s, participantNamesById, userProfile });
            const next = await commitQuizSession({ ...s, result });
            return next.result || result;
        } catch (e: any) {
            addToast('画像报告生成失败，可稍后重试：' + (e?.message || e), 'error');
            return null;
        } finally {
            setBusy(false);
            setBusyLabel('');
        }
    };

    const submitUserAnswer = async (raw: string) => {
        const text = raw.trim();
        const s = quizSessionRef.current;
        if (!s || !currentItem || busy) return;
        setQuizInput('');
        const updated = updateQuizSession(cur => ({
            ...cur,
            items: cur.items.map((it, i) => i === cur.currentIndex ? {
                ...it,
                state: 'commenting',
                answers: { ...it.answers, [QUIZ_USER_ID]: makeUserAnswer(text, 'done') },
            } : it),
        }));
        const itemIndex = updated?.currentIndex ?? s.currentIndex;
        await Promise.all(sessionChars(updated || s).map(c => generateCommentForChar(c.id, undefined, itemIndex)));
    };

    const submitUserComment = async (raw: string) => {
        const text = raw.trim();
        const s = quizSessionRef.current;
        if (!s || !currentItem || busy) return;
        if (!text) { addToast('写点想评论的话再发送', 'info'); return; }
        setQuizInput('');
        const comment: TheaterQuizComment = {
            id: genId('tqc'),
            speakerId: QUIZ_USER_ID,
            speakerName: userName,
            isUser: true,
            avatar: userProfile?.avatar,
            text,
            at: Date.now(),
        };
        const updated = updateQuizSession(cur => appendComment(cur, cur.currentIndex, comment));
        const itemIndex = updated?.currentIndex ?? s.currentIndex;
        await Promise.all(sessionChars(updated || s).map(c => generateCommentForChar(c.id, text, itemIndex)));
    };

    const submitQuizInput = async () => {
        if (!quizSession || !currentItem) return;
        if (!isUserAnswered(currentItem)) await submitUserAnswer(quizInput);
        else await submitUserComment(quizInput);
    };

    const goNextQuestion = async () => {
        const s = quizSessionRef.current;
        if (!s || busy) return;
        const item = s.items[s.currentIndex];
        if (!item) return;
        if (!isUserAnswered(item)) addToast('这一题还没写答案，先帮你留空跳过', 'info');

        const marked: TheaterQuizSession = {
            ...s,
            items: s.items.map((it, i) => i === s.currentIndex ? {
                ...it,
                state: 'complete',
                completedAt: Date.now(),
                answers: {
                    ...it.answers,
                    [QUIZ_USER_ID]: it.answers[QUIZ_USER_ID]?.status === 'done' ? it.answers[QUIZ_USER_ID] : makeUserAnswer('', 'done'),
                },
            } : it),
        };

        if (s.currentIndex + 1 >= s.total) {
            const finished = await commitQuizSession({ ...marked, status: 'finished', finishedAt: Date.now() });
            addToast('这份问卷做完啦', 'success');
            void generateResultForSession(finished);
            return;
        }

        setBusy(true);
        setBusyLabel('正在出下一题…');
        setQuizInput('');
        try {
            const existingNext = marked.items[s.currentIndex + 1];
            if (existingNext) {
                await commitQuizSession({ ...marked, currentIndex: s.currentIndex + 1 });
            } else {
                await createNextQuizItem(marked, s.currentIndex + 1);
            }
        } catch (e: any) {
            addToast('出下一题失败：' + (e?.message || e), 'error');
            await commitQuizSession(marked);
        } finally {
            setBusy(false);
            setBusyLabel('');
        }
    };

    const finishQuizNow = async () => {
        const s = quizSessionRef.current;
        if (!s) return;
        const finished = await commitQuizSession({ ...s, status: 'finished', finishedAt: Date.now() });
        addToast('已标记完成', 'success');
        void generateResultForSession(finished);
    };

    const formatQuizExport = (s: TheaterQuizSession, kind: ExportKind) => {
        const charsById = new Map(characters.map(c => [c.id, c]));
        const resultLines = () => {
            if (!s.result) return ['（还没有画像报告）'];
            const r = s.result;
            return [
                `${r.title} · ${r.totalScore}/100`,
                r.summary,
                '',
                '维度：',
                ...r.dimensions.map(d => `  · ${d.label} ${d.score}/100：${d.summary}`),
                '',
                '亮点：',
                ...r.highlights.map(x => `  · ${x}`),
                '磨合点：',
                ...r.frictions.map(x => `  · ${x}`),
                '建议：',
                ...r.suggestions.map(x => `  · ${x}`),
            ];
        };
        if (kind === 'result') return [`【番外·${s.topic}】画像报告`, '', ...resultLines()].join('\n').trim();
        const lines = [`【番外·${s.topic}】${kind === 'full' ? '完整问卷对话' : '问卷摘要'}`, ''];
        if (s.result) lines.push(...resultLines(), '');
        s.items.forEach((it, i) => {
            lines.push(`${i + 1}. ${it.question}`);
            if (kind === 'full' && it.hostNote) lines.push(`  · 主持：${it.hostNote}`);
            lines.push(`  · ${userName}：${it.answers[QUIZ_USER_ID]?.text || '—'}`);
            s.participantIds.forEach(id => {
                const name = charsById.get(id)?.name || it.answers[id]?.speakerName || '角色';
                lines.push(`  · ${name}：${it.answers[id]?.text || '—'}`);
            });
            if (kind === 'full' && it.comments.length > 0) {
                lines.push('  · 评论区：');
                it.comments.forEach(cm => lines.push(`    ${cm.speakerName}：${cm.text}`));
            }
            lines.push('');
        });
        return lines.join('\n').trim();
    };

    const exportQuizToChat = async (kind: ExportKind) => {
        const s = quizSessionRef.current;
        if (!s) return;
        const targetId = exportTargetId || s.participantIds[0];
        const target = characters.find(c => c.id === targetId);
        if (!target) { addToast('没有可发送的目标角色', 'error'); return; }
        try {
            await DB.saveMessage({ charId: target.id, role: 'system', type: 'text', content: formatQuizExport(s, kind), timestamp: Date.now() });
            setExportOpen(false);
            addToast(`已发到与 ${target.name} 的聊天`, 'success');
        } catch {
            addToast('发送失败', 'error');
        }
    };

    const makeFauxPiece = (out: FauxResult, targetChar: CharacterProfile, keyword: string | undefined, kind: FauxKind): TheaterFauxPiece => {
        const now = Date.now();
        return {
            id: genId('tf'),
            kind,
            charId: targetChar.id,
            charName: targetChar.name,
            keyword: keyword?.trim() || undefined,
            data: out.data,
            fallbackText: out.fallbackText,
            createdAt: now,
            updatedAt: now,
        };
    };

    const runFaux = async (override?: { kind?: FauxKind; keyword?: string; charId?: string }) => {
        const targetKind = override?.kind || fauxKind;
        const targetKeyword = override?.keyword ?? fauxKeyword;
        const targetChar = characters.find(c => c.id === (override?.charId || pickCharId));
        if (!targetChar) { addToast('先选一个角色', 'info'); return; }
        if (!apiReady) { addToast('还没配置 API，去「文具盒」填好再来', 'error'); return; }
        setFauxKind(targetKind);
        setFauxKeyword(targetKeyword || '');
        setPickCharId(targetChar.id);
        setBusy(true); setFauxResult(null); setFauxActivePiece(null);
        try {
            const out = await genFauxPiece({ api, kind: targetKind, char: targetChar, userProfile, keyword: targetKeyword.trim() || undefined });
            const piece = makeFauxPiece(out, targetChar, targetKeyword, targetKind);
            await DB.saveTheaterFauxPiece(piece);
            setFauxResult(out);
            setFauxActivePiece(piece);
            setFauxHistory(prev => [piece, ...prev.filter(x => x.id !== piece.id)].sort((a, b) => b.createdAt - a.createdAt));
        } catch (e: any) { addToast('生成失败：' + (e?.message || e), 'error'); } finally { setBusy(false); }
    };

    const openFauxPiece = (piece: TheaterFauxPiece) => {
        setFauxKind(piece.kind);
        setFauxKeyword(piece.keyword || '');
        setPickCharId(piece.charId);
        setFauxResult({ kind: piece.kind, data: piece.data, fallbackText: piece.fallbackText });
        setFauxActivePiece(piece);
    };

    const deleteFauxPiece = async (id: string) => {
        try {
            await DB.deleteTheaterFauxPiece(id);
            setFauxHistory(prev => prev.filter(p => p.id !== id));
            if (fauxActivePiece?.id === id) {
                setFauxActivePiece(null);
                setFauxResult(null);
            }
            addToast('已删除这张仿真图文', 'success');
        } catch { addToast('删除失败', 'error'); }
    };

    const rerunFauxFrom = async (piece: TheaterFauxPiece) => {
        await runFaux({ kind: piece.kind, keyword: piece.keyword || '', charId: piece.charId });
    };

    const exportFauxToChat = async (piece = fauxActivePiece) => {
        const targetPiece = piece || (fauxResult && char ? makeFauxPiece(fauxResult, char, fauxKeyword, fauxKind) : null);
        if (!targetPiece) return;
        const target = characters.find(c => c.id === targetPiece.charId);
        if (!target) { addToast('没有可发送的目标角色', 'error'); return; }
        try {
            await DB.saveMessage({ charId: target.id, role: 'system', type: 'text', content: formatFauxExport(targetPiece), timestamp: Date.now() });
            addToast(`已发到与 ${target.name} 的聊天`, 'success');
        } catch { addToast('发送失败', 'error'); }
    };

    const runPiece = async () => {
        if (!char) { addToast('先选一个角色', 'info'); return; }
        if (!apiReady) { addToast('还没配置 API，去「文具盒」填好再来', 'error'); return; }
        setBusy(true); setPiece('');
        try {
            const out = await genExtraPiece({
                api,
                kind: pieceKind,
                char,
                userProfile,
                prompt: piecePrompt.trim() || undefined,
                options: { tone: pieceTone, length: pieceLength, pov: piecePov },
            });
            setPiece(out);
        } catch (e: any) { addToast('生成失败：' + (e?.message || e), 'error'); } finally { setBusy(false); }
    };

    const exportPieceToChat = async () => {
        if (!char || !piece) return;
        const tab = PIECE_TABS.find(t => t.kind === pieceKind);
        try {
            await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `【番外·${tab?.label || ''}】\n${piece}`, timestamp: Date.now() });
            addToast(`已发到与 ${char.name} 的聊天`, 'success');
        } catch { addToast('发送失败', 'error'); }
    };

    // ============ 问卷番外 ============
    if (mode === 'quiz') {
        if (!quizSession) {
            const selectedCount = quizParticipantIds.size;
            const canStart = selectedCount > 0 && !!topic.trim() && apiReady && !busy;
            return (
                <Page
                    title="问卷番外"
                    en="THE QUIZ"
                    onBack={() => setMode('home')}
                    right={<div className="flex items-center gap-2">{customLibraryImportButton}{theaterApiButton}</div>}
                >
                    {theaterApiDialog}
                    {customLibraryInput}
                    {!apiReady && (
                        <PaperCard tilt={-0.4} className="p-3 text-[12px]" style={{ color: '#7a3b2e' }}>
                            还没配置 API。去「文具盒」填好主/副 API，角色才能答题和评论。
                        </PaperCard>
                    )}

                    <PaperCard tilt={-0.5} className="p-4 space-y-3">
                        <SectionTag en="NEW">新问卷</SectionTag>
                        <div className="grid grid-cols-2 gap-2">
                            <button onClick={() => switchQuizPlayMode('single')} className="rounded-xl px-3 py-2.5 active:scale-95" style={tabStyle(quizPlayMode === 'single')}>
                                <User size={17} weight="bold" className="inline mr-1.5" />单角色
                            </button>
                            <button onClick={() => switchQuizPlayMode('multi')} className="rounded-xl px-3 py-2.5 active:scale-95" style={tabStyle(quizPlayMode === 'multi')}>
                                <UsersThree size={17} weight="bold" className="inline mr-1.5" />多角色
                            </button>
                        </div>
                        <QuizParticipantPicker characters={characters} selectedIds={quizParticipantIds} playMode={quizPlayMode} onToggle={toggleQuizParticipant} />
                        <PaperCard className="p-3 text-[11px] leading-relaxed" style={{ color: '#5f594f' }}>
                            默认访谈测试：主持人会转场，角色可互评追问，完成后生成娱乐向画像报告。
                        </PaperCard>
                        <input value={topic} onChange={e => setTopic(e.target.value)} placeholder="如：恋爱相性甜蜜问 / 亲密边界30问 / 无厘头问卷50题"
                            className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={paperInput} />
                        <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
                            {quizTags.map(tag => (
                                <button key={tag} onClick={() => setQuizTag(tag)} className="shrink-0 px-2.5 py-1 rounded-full text-[11px] font-bold active:scale-95" style={tabStyle(quizTag === tag)}>
                                    {tag}
                                </button>
                            ))}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {quizPresets.map(p => (
                                <button key={p} onClick={() => setTopic(p)} className="px-2.5 py-1 rounded-full text-[11px] font-bold active:scale-95 inline-flex items-center gap-1" style={tabStyle(false)}>
                                    {p}{customQuizForTopic(p) ? <span className="text-[8px] px-1 rounded-[3px]" style={{ background: '#1f1d1a', color: '#f6f3ec' }}>导入</span> : (isBankQuiz(p) && <span className="text-[8px] px-1 rounded-[3px]" style={{ background: '#1f1d1a', color: '#f6f3ec' }}>题库</span>)}
                                </button>
                            ))}
                        </div>
                        {selectedQuizMeta && (
                            <PaperCard tilt={0.25} className="p-3 space-y-1.5">
                                <div className="text-[12px] font-black" style={{ color: INK }}>{selectedQuizMeta.title}</div>
                                <div className="text-[11px] leading-relaxed" style={{ color: '#6b6558' }}>{selectedQuizMeta.description}</div>
                                <div className="flex flex-wrap gap-1.5 text-[10px]">
                                    <span className="px-2 py-0.5 rounded-full" style={{ background: '#1f1d1a', color: '#f6f3ec' }}>{selectedQuizMeta.questionCount} 题</span>
                                    {selectedQuizMeta.imported && <span className="px-2 py-0.5 rounded-full" style={{ background: '#1f1d1a', color: '#f6f3ec' }}>导入</span>}
                                    <span className="px-2 py-0.5 rounded-full" style={{ background: 'rgba(31,29,26,0.08)', color: INK }}>推荐 {selectedQuizMeta.recommendedParticipants}</span>
                                    {selectedQuizMeta.tags.map(tag => <span key={tag} className="px-2 py-0.5 rounded-full" style={{ background: 'rgba(31,29,26,0.08)', color: INK_SOFT }}>{tag}</span>)}
                                </div>
                            </PaperCard>
                        )}
                        {customQuizzes.length > 0 && (
                            <div className="space-y-2">
                                <SectionTag en="IMPORTED">导入问卷</SectionTag>
                                <div className="space-y-2">
                                    {customQuizzes.slice(0, 12).map(q => (
                                        <div key={q.id} className="rounded-xl px-3 py-2.5 flex items-center gap-2" style={{ background: 'rgba(255,253,247,0.72)', border: '1px solid rgba(176,170,158,0.55)' }}>
                                            <button onClick={() => setTopic(q.title)} className="flex-1 min-w-0 text-left active:scale-[0.99]">
                                                <div className="text-[12px] font-black truncate" style={{ color: INK }}>{q.title}</div>
                                                <div className="text-[10px] truncate" style={{ color: INK_SOFT }}>
                                                    {q.questions.length} 题{q.description ? ` · ${q.description}` : ''}
                                                </div>
                                            </button>
                                            <button onClick={() => void deleteCustomLibraryItem(q)} className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center active:scale-90" style={{ color: INK_SOFT }} title="删除导入问卷">
                                                <Trash size={14} weight="bold" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        <ScrapButton variant="ink" className="w-full py-2.5 text-sm" disabled={!canStart} onClick={() => void startQuiz()} icon={<Play size={15} weight="fill" />}>
                            {busy ? busyLabel || '准备中…' : `开始答题${selectedCount ? ` · ${selectedCount} 位` : ''}`}
                        </ScrapButton>
                    </PaperCard>

                    {quizHistory.length > 0 && (
                        <div className="space-y-3">
                            <SectionTag en="HISTORY">历史问卷</SectionTag>
                            {quizHistory.map((s, i) => (
                                <PaperCard key={s.id} tilt={i % 2 ? 0.4 : -0.4} className="px-3.5 py-3 flex items-center gap-3">
                                    <Stamp size={42}><ListChecks size={22} weight="duotone" /></Stamp>
                                    <button onClick={() => resumeQuiz(s)} className="flex-1 min-w-0 text-left">
                                        <div className="text-[13px] font-black truncate" style={{ color: INK }}>{s.title || s.topic}</div>
                                        <div className="text-[10.5px] truncate mt-0.5" style={{ color: INK_SOFT }}>
                                            {s.status === 'finished' ? '已完成' : '进行中'} · {s.participantIds.length} 位 · {s.items.length}/{s.total} 题 · {shortDate(s.lastActiveAt)}
                                        </div>
                                    </button>
                                    <button onClick={() => resumeQuiz(s)} className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center active:scale-90" style={{ color: INK }} title="继续">
                                        <ClockCounterClockwise size={16} weight="bold" />
                                    </button>
                                    <button onClick={() => void deleteQuiz(s.id)} className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center active:scale-90" style={{ color: INK_SOFT }} title="删除">
                                        <Trash size={15} weight="bold" />
                                    </button>
                                </PaperCard>
                            ))}
                        </div>
                    )}
                </Page>
            );
        }

        const item = currentItem;
        const progress = Math.min(100, Math.round(((quizSession.currentIndex + 1) / Math.max(1, quizSession.total)) * 100));
        const userAnswered = isUserAnswered(item);
        const canSend = !!item && !busy && !hasPendingCharAnswer && commentBusyIds.size === 0;
        const isFinished = quizSession.status === 'finished';
        return (
            <Page
                title="问卷番外"
                en={isFinished ? 'FINISHED' : `${quizSession.currentIndex + 1}/${quizSession.total}`}
                onBack={() => { setQuizSession(null); quizSessionRef.current = null; setQuizInput(''); void refreshQuizHistory(); }}
                backLabel="问卷册"
                right={(
                    <div className="flex items-center gap-2">
                        {theaterApiButton}
                        <button onClick={() => { setExportTargetId(quizSession.participantIds[0] || ''); setExportOpen(true); }} className="text-[11px] font-black px-3 py-1.5 rounded-full active:scale-95" style={{ background: '#1f1d1a', color: '#f6f3ec' }}>导出</button>
                    </div>
                )}
            >
                {theaterApiDialog}
                <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(31,29,26,0.1)' }}>
                        <div className="h-full" style={{ width: `${progress}%`, background: '#1f1d1a' }} />
                    </div>
                    <span className="text-[11px] tabular-nums" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>{quizSession.currentIndex + 1}/{quizSession.total}</span>
                </div>

                {item && (
                    <>
                        {item.hostNote && (
                            <PaperCard tilt={0.35} tape="sage" className="p-3 text-[12px] leading-relaxed" style={{ color: '#4f4a42' }}>
                                <span className="font-black">主持：</span>{item.hostNote}
                            </PaperCard>
                        )}
                        <PaperCard tilt={-0.4} className="p-4">
                            <div className="text-[10px] tracking-[0.2em] mb-1.5" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>Q{item.no} · {quizSession.topic}</div>
                            <div className="text-[15px] font-black leading-relaxed" style={{ color: INK }}>{item.question}</div>
                        </PaperCard>

                        <div className="grid grid-cols-1 gap-3">
                            {currentChars.map((c, i) => {
                                const ans = item.answers[c.id];
                                const pending = ans?.status === 'pending';
                                const failed = ans?.status === 'failed';
                                return (
                                    <div key={c.id} className="rounded-[14px] p-4" style={{
                                        background: i % 2 ? 'linear-gradient(180deg,#f9f6ee,#eee9dc)' : 'linear-gradient(180deg,#26231f,#1c1a17)',
                                        color: i % 2 ? INK : '#f3ecdf',
                                        border: '1px solid rgba(31,29,26,0.22)',
                                        outline: `1px dashed ${i % 2 ? 'rgba(150,144,132,0.45)' : 'rgba(246,243,236,0.2)'}`,
                                        outlineOffset: -5,
                                        transform: `rotate(${i % 2 ? -0.3 : 0.35}deg)`,
                                    }}>
                                        <div className="flex items-center justify-between mb-1.5">
                                            <div className="flex items-center gap-2 min-w-0">
                                                {c.avatar && <img src={c.avatar} className="w-6 h-6 rounded-full object-cover shrink-0" alt="" />}
                                                <span className="text-[12px] font-black truncate">{c.name} 的回答</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {failed && <button onClick={() => void retryCharAnswer(c.id)} disabled={busy} className="text-[10px] font-bold active:scale-95 disabled:opacity-40">重试</button>}
                                                <button onClick={() => void retryCharAnswer(c.id)} disabled={busy || pending} className="active:scale-90 disabled:opacity-40" title="让 TA 重答">
                                                    <ArrowClockwise size={15} weight="bold" />
                                                </button>
                                            </div>
                                        </div>
                                        <div className="text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: i % 2 ? '#3a362f' : 'rgba(246,243,236,0.9)' }}>
                                            {pending ? '思考中…' : (ans?.text || '……')}
                                        </div>
                                        {userAnswered && (
                                            <div className="mt-2 flex flex-wrap gap-2">
                                                <button onClick={() => void generateCommentForChar(c.id)} disabled={commentBusyIds.has(c.id) || busy} className="text-[11px] font-black active:scale-95 disabled:opacity-45 inline-flex items-center gap-1" style={{ color: i % 2 ? INK : 'rgba(246,243,236,0.78)' }}>
                                                    <ChatTeardropText size={13} weight="bold" />{commentBusyIds.has(c.id) ? '接话中…' : '回应我'}
                                                </button>
                                                {quizSession.settings?.peerReviewEnabled && currentChars.length > 1 && (
                                                    <button onClick={() => {
                                                        const target = currentChars.find(x => x.id !== c.id);
                                                        if (target) void generatePeerReview(c.id, target.id);
                                                    }} disabled={commentBusyIds.has(c.id) || busy} className="text-[11px] font-black active:scale-95 disabled:opacity-45 inline-flex items-center gap-1" style={{ color: i % 2 ? INK : 'rgba(246,243,236,0.78)' }}>
                                                        <UsersThree size={13} weight="bold" />回应 TA
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        <PaperCard tilt={0.35} className="p-4">
                            <div className="text-[12px] font-black mb-1.5 flex items-center gap-1.5" style={{ color: '#4a463e' }}>
                                {userAnswered ? <CheckCircle size={14} weight="fill" /> : null}{userName} 的回答
                            </div>
                            {userAnswered ? (
                                <div className="text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: '#3a362f' }}>{item.answers[QUIZ_USER_ID]?.text || '（跳过）'}</div>
                            ) : (
                                <div className="text-[12px]" style={{ color: INK_SOFT }}>写下答案后会进入本题评论区；不点下一题，就一直停在这里继续聊。</div>
                            )}
                        </PaperCard>

                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <SectionTag en="COMMENTS">本题评论区</SectionTag>
                                {userAnswered && quizSession.settings?.peerReviewEnabled && currentChars.length > 1 && (
                                    <button onClick={() => void generateAllPeerReviews()} disabled={busy || commentBusyIds.size > 0} className="text-[11px] font-black active:scale-95 disabled:opacity-40" style={{ color: INK }}>
                                        全员互评一轮
                                    </button>
                                )}
                            </div>
                            {item.comments.length === 0 ? (
                                <PaperCard className="p-3 text-[12px]" style={{ color: INK_SOFT }}>
                                    {userAnswered ? '角色正在想怎么评论，或者你可以先追一句。' : '提交你的答案后，评论区会打开。'}
                                </PaperCard>
                            ) : item.comments.map((cm, i) => (
                                <div key={cm.id} className={`flex gap-2 ${cm.isUser ? 'justify-end' : 'justify-start'}`}>
                                    {!cm.isUser && (cm.avatar ? <img src={cm.avatar} className="w-7 h-7 rounded-full object-cover shrink-0" alt="" /> : <div className="w-7 h-7 rounded-full shrink-0" style={{ background: '#e6e2d8' }} />)}
                                    <div className="max-w-[82%] px-3 py-2 text-[12.5px] leading-relaxed whitespace-pre-wrap" style={{
                                        background: cm.isUser ? '#1f1d1a' : 'rgba(255,253,247,0.92)',
                                        color: cm.isUser ? '#f6f3ec' : '#3a362f',
                                        border: cm.isUser ? 'none' : '1px solid rgba(176,170,158,0.7)',
                                        borderRadius: cm.isUser ? '14px 4px 14px 14px' : '4px 14px 14px 14px',
                                        transform: `rotate(${i % 2 ? 0.2 : -0.2}deg)`,
                                    }}>
                                        <div className="text-[10px] font-black mb-0.5" style={{ color: cm.isUser ? 'rgba(246,243,236,0.68)' : INK_SOFT }}>{cm.isUser ? userName : cm.speakerName}</div>
                                        {cm.text}
                                    </div>
                                    {cm.isUser && (cm.avatar ? <img src={cm.avatar} className="w-7 h-7 rounded-full object-cover shrink-0" alt="" /> : <div className="w-7 h-7 rounded-full shrink-0" style={{ background: '#e6e2d8' }} />)}
                                </div>
                            ))}
                        </div>

                        {!isFinished && (
                            <PaperCard className="p-3 space-y-2">
                                <textarea
                                    value={quizInput}
                                    onChange={e => setQuizInput(e.target.value)}
                                    rows={2}
                                    disabled={!canSend}
                                    placeholder={userAnswered ? '继续评论这一题…' : (hasPendingCharAnswer ? '等角色答完就能写你的答案…' : '写下你的答案…（可留空跳过）')}
                                    className="w-full rounded-xl px-3 py-2 text-sm outline-none resize-none disabled:opacity-60"
                                    style={paperInput}
                                />
                                <div className="grid grid-cols-2 gap-2">
                                    <ScrapButton variant="paper" className="py-2.5 text-[12px]" disabled={busy || commentBusyIds.size > 0} onClick={() => void goNextQuestion()}>
                                        {quizSession.currentIndex + 1 >= quizSession.total ? '完成问卷' : '下一题'}
                                    </ScrapButton>
                                    <ScrapButton variant="ink" className="py-2.5 text-[12px]" disabled={!canSend} onClick={() => void submitQuizInput()} icon={<PaperPlaneTilt size={14} weight="fill" />}>
                                        {userAnswered ? '发送评论' : '提交答案'}
                                    </ScrapButton>
                                </div>
                                <button onClick={() => void finishQuizNow()} className="w-full text-[10.5px] font-bold active:scale-95" style={{ color: INK_SOFT }}>先到这里，标记完成</button>
                            </PaperCard>
                        )}

                        {isFinished && (
                            <PaperCard tilt={-0.5} tape="ink" className="p-5 space-y-3 text-center">
                                <Sparkle size={30} weight="fill" className="mx-auto" style={{ color: INK }} />
                                <div className="text-lg font-black" style={{ color: INK }}>做完啦！</div>
                                <div className="text-[12px]" style={{ color: '#6b6558' }}>《{quizSession.topic}》已保存。可以回看、导出，也可以回问卷册再开一份。</div>
                                {quizSession.result ? (
                                    <div className="text-left rounded-xl p-3 space-y-2" style={{ background: 'rgba(255,253,247,0.72)', border: '1px solid rgba(176,170,158,0.62)' }}>
                                        <div className="flex items-start justify-between gap-2">
                                            <div>
                                                <div className="text-[13px] font-black" style={{ color: INK }}>{quizSession.result.title}</div>
                                                <div className="text-[11px] leading-relaxed mt-1" style={{ color: '#6b6558' }}>{quizSession.result.summary}</div>
                                            </div>
                                            <div className="shrink-0 text-[22px] font-black tabular-nums" style={{ color: INK }}>{quizSession.result.totalScore}</div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            {quizSession.result.dimensions.map(d => (
                                                <div key={d.key} className="rounded-lg p-2" style={{ background: 'rgba(31,29,26,0.06)' }}>
                                                    <div className="flex justify-between gap-2 text-[11px] font-black" style={{ color: INK }}>
                                                        <span>{d.label}</span><span>{d.score}</span>
                                                    </div>
                                                    <div className="text-[10.5px] leading-relaxed mt-0.5" style={{ color: INK_SOFT }}>{d.summary}</div>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="text-[11px] leading-relaxed" style={{ color: '#5f594f' }}>
                                            <span className="font-black">亮点：</span>{quizSession.result.highlights.slice(0, 3).join('；')}
                                        </div>
                                        <div className="text-[11px] leading-relaxed" style={{ color: '#5f594f' }}>
                                            <span className="font-black">建议：</span>{quizSession.result.suggestions.slice(0, 3).join('；')}
                                        </div>
                                    </div>
                                ) : (
                                    <ScrapButton variant="paper" className="w-full py-2.5 text-sm" disabled={busy || !apiReady} onClick={() => void generateResultForSession()} icon={<ArrowClockwise size={15} weight="bold" />}>
                                        {busy ? '生成画像中…' : '生成画像报告'}
                                    </ScrapButton>
                                )}
                                {quizSession.result && (
                                    <ScrapButton variant="paper" className="w-full py-2.5 text-sm" disabled={busy || !apiReady} onClick={() => void generateResultForSession()} icon={<ArrowClockwise size={15} weight="bold" />}>
                                        重新生成画像
                                    </ScrapButton>
                                )}
                                <ScrapButton variant="ink" className="w-full py-2.5 text-sm" onClick={() => setExportOpen(true)} icon={<PaperPlaneTilt size={16} weight="bold" />}>发到聊天</ScrapButton>
                            </PaperCard>
                        )}
                    </>
                )}

                {(busy || commentBusyIds.size > 0) && (
                    <div className="text-center text-[11px] py-1" style={{ color: INK_SOFT }}>
                        {busyLabel || '角色正在接话…'}
                    </div>
                )}

                <PaperDialog
                    open={exportOpen}
                    onClose={() => setExportOpen(false)}
                    title="发到聊天"
                    en="EXPORT"
                    actions={(
                        <>
                            <ScrapButton variant="paper" className="flex-1 py-2 text-[12px]" onClick={() => void exportQuizToChat('summary')}>简洁摘要</ScrapButton>
                            <ScrapButton variant="paper" className="flex-1 py-2 text-[12px]" onClick={() => void exportQuizToChat('result')}>画像报告</ScrapButton>
                            <ScrapButton variant="ink" className="flex-1 py-2 text-[12px]" onClick={() => void exportQuizToChat('full')}>完整对话</ScrapButton>
                        </>
                    )}
                >
                    <div className="space-y-2">
                        <div>选择要发送到哪位角色的单聊。</div>
                        <div className="flex gap-2 overflow-x-auto no-scrollbar py-1">
                            {sessionChars().map((c, i) => (
                                <Polaroid key={c.id} src={c.avatar} caption={c.name} size={42} rotate={i % 2 ? 1 : -1} selected={(exportTargetId || quizSession.participantIds[0]) === c.id} onClick={() => setExportTargetId(c.id)} />
                            ))}
                        </div>
                    </div>
                </PaperDialog>
            </Page>
        );
    }

    // ============ 仿真图文番外 ============
    if (mode === 'faux') {
        const tab = FAUX_TABS.find(t => t.kind === fauxKind)!;
        const previewKind = fauxActivePiece?.kind || fauxKind;
        const previewData = fauxActivePiece?.data ?? fauxResult?.data ?? null;
        const previewFallback = fauxActivePiece?.fallbackText ?? fauxResult?.fallbackText ?? '';
        const previewChar = characters.find(c => c.id === fauxActivePiece?.charId) || char;
        return (
            <Page title="仿真图文" en="FAUX SCREENS" onBack={() => { setFauxResult(null); setFauxActivePiece(null); setMode('home'); }} right={theaterApiButton}>
                {theaterApiDialog}
                <CharPicker characters={characters} pickCharId={pickCharId} setPickCharId={setPickCharId} />

                <div className="space-y-3">
                    {FAUX_GROUPS.map(group => (
                        <div key={group.id} className="space-y-2">
                            <SectionTag en={group.en}>{group.label}</SectionTag>
                            <div className="grid grid-cols-4 gap-2">
                                {FAUX_TABS.filter(t => t.group === group.id).map(t => (
                                    <button
                                        key={t.kind}
                                        onClick={() => { setFauxKind(t.kind); setFauxResult(null); setFauxActivePiece(null); }}
                                        className="min-h-[66px] flex flex-col items-center justify-center gap-1 py-2 rounded-2xl transition-all active:scale-95"
                                        style={tabStyle(fauxKind === t.kind)}
                                    >
                                        {t.icon}<span className="text-[10px] font-bold leading-tight text-center">{t.label}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>

                <div className="text-[11px] px-1" style={{ color: '#6b6558' }}>{tab.hint}</div>
                <textarea value={fauxKeyword} onChange={e => setFauxKeyword(e.target.value)} placeholder={tab.ph}
                    rows={2} className="w-full rounded-xl px-3 py-2.5 text-sm outline-none resize-none" style={paperInput} />
                <InstructionRow kind={fauxKind} onPick={setFauxKeyword} />
                <ScrapButton variant="ink" className="w-full py-2.5 text-sm" disabled={busy} onClick={() => void runFaux()}>{busy ? '生成中…' : '生成仿真图文'}</ScrapButton>

                {(fauxResult || fauxActivePiece) && (
                    <div className="space-y-3">
                        <div className="flex items-center justify-between px-1">
                            <SectionTag en="PREVIEW">当前预览</SectionTag>
                            {fauxActivePiece && (
                                <div className="text-[10px] font-bold" style={{ color: INK_SOFT }}>
                                    {tabForFauxKind(fauxActivePiece.kind).label} · {shortDate(fauxActivePiece.createdAt)}
                                </div>
                            )}
                        </div>
                        {renderFauxPreview(previewKind, previewData, { charAvatar: previewChar?.avatar, userAvatar: userProfile?.avatar })}
                        {!previewData && (
                            <PaperCard className="p-4 text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: '#3a362f' }}>
                                <div className="text-[10px] mb-1.5" style={{ color: INK_SOFT }}>（这次没解析成结构化，先看文字稿）</div>
                                {previewFallback}
                            </PaperCard>
                        )}
                        <div className="text-center text-[10px]" style={{ color: INK_SOFT }}>长按 / 用手机系统截屏即可保存这张图</div>
                        <div className="flex gap-2">
                            <ScrapButton variant="paper" className="flex-1 py-2 text-[12px]" onClick={() => void runFaux()} icon={<ArrowClockwise size={14} weight="bold" />}>再生成</ScrapButton>
                            <ScrapButton variant="ink" className="flex-1 py-2 text-[12px]" onClick={() => void exportFauxToChat()} icon={<PaperPlaneTilt size={14} weight="bold" />}>发到聊天</ScrapButton>
                        </div>
                    </div>
                )}

                <PaperCard tilt={0.35} className="p-3 space-y-3">
                    <div className="flex items-center justify-between">
                        <SectionTag en="HISTORY">最近生成</SectionTag>
                        <button onClick={() => void refreshFauxHistory()} className="text-[11px] font-black active:scale-95" style={{ color: INK }}>刷新</button>
                    </div>
                    {fauxHistory.length === 0 ? (
                        <div className="text-[12px] leading-relaxed" style={{ color: INK_SOFT }}>
                            生成后的仿真图文会自动保存在这里，可回看、再生成或发送到对应角色聊天。
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {fauxHistory.slice(0, 20).map(piece => {
                                const itemTab = tabForFauxKind(piece.kind);
                                return (
                                    <div key={piece.id} className="rounded-xl p-2.5 space-y-2" style={{ background: 'rgba(255,253,247,0.72)', border: '1px solid rgba(176,170,158,0.55)' }}>
                                        <button onClick={() => openFauxPiece(piece)} className="w-full text-left active:scale-[0.99]">
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="min-w-0">
                                                    <div className="text-[12px] font-black truncate" style={{ color: INK }}>{itemTab.label} · {piece.charName}</div>
                                                    <div className="text-[10px] truncate" style={{ color: INK_SOFT }}>{piece.keyword || '无关键词'} · {shortDate(piece.createdAt)}</div>
                                                </div>
                                                <span className="shrink-0">{itemTab.icon}</span>
                                            </div>
                                        </button>
                                        <div className="grid grid-cols-4 gap-1.5">
                                            <ScrapButton variant="paper" className="py-1.5 text-[10px]" onClick={() => openFauxPiece(piece)}>打开</ScrapButton>
                                            <ScrapButton variant="paper" className="py-1.5 text-[10px]" disabled={busy || !apiReady} onClick={() => void rerunFauxFrom(piece)} icon={<ArrowClockwise size={12} weight="bold" />}>再生成</ScrapButton>
                                            <ScrapButton variant="paper" className="py-1.5 text-[10px]" onClick={() => void exportFauxToChat(piece)} icon={<PaperPlaneTilt size={12} weight="bold" />}>发送</ScrapButton>
                                            <ScrapButton variant="paper" className="py-1.5 text-[10px]" onClick={() => void deleteFauxPiece(piece.id)} icon={<Trash size={12} weight="bold" />}>删除</ScrapButton>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </PaperCard>
            </Page>
        );
    }

    // ============ 一次性番外 ============
    if (mode === 'piece') {
        const tab = PIECE_TABS.find(t => t.kind === pieceKind)!;
        return (
            <Page
                title="番外工坊"
                en="THE WORKSHOP"
                onBack={() => { setPiece(''); setMode('home'); }}
                right={<div className="flex items-center gap-2">{customLibraryImportButton}{theaterApiButton}</div>}
            >
                {theaterApiDialog}
                {customLibraryInput}
                <CharPicker characters={characters} pickCharId={pickCharId} setPickCharId={setPickCharId} />
                <div className="grid grid-cols-4 gap-2">
                    {PIECE_TABS.map(t => (
                        <button key={t.kind} onClick={() => { setPieceKind(t.kind); setPiece(''); }} className="min-h-[66px] flex flex-col items-center justify-center gap-1 py-2 rounded-2xl transition-all active:scale-95" style={tabStyle(pieceKind === t.kind)}>
                            {t.icon}<span className="text-[10px] font-bold leading-tight text-center">{t.label}</span>
                        </button>
                    ))}
                </div>
                <div className="text-[11px] px-1" style={{ color: '#6b6558' }}>{tab.hint}</div>
                <PaperCard tilt={0.25} className="p-3 space-y-2">
                    <SectionTag en="TONE">工坊调味</SectionTag>
                    <div className="space-y-1.5">
                        <div className="text-[10px] font-black" style={{ color: INK_SOFT }}>风格</div>
                        <div className="grid grid-cols-5 gap-1.5">
                            {PIECE_TONE_OPTIONS.map(o => (
                                <button key={o.id} onClick={() => setPieceTone(o.id)} className="rounded-lg px-1 py-1.5 text-[10px] font-black active:scale-95" style={tabStyle(pieceTone === o.id)}>{o.label}</button>
                            ))}
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <div className="text-[10px] font-black" style={{ color: INK_SOFT }}>篇幅</div>
                        <div className="grid grid-cols-3 gap-1.5">
                            {PIECE_LENGTH_OPTIONS.map(o => (
                                <button key={o.id} onClick={() => setPieceLength(o.id)} className="rounded-lg px-1 py-1.5 text-[10px] font-black active:scale-95" style={tabStyle(pieceLength === o.id)}>{o.label}</button>
                            ))}
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <div className="text-[10px] font-black" style={{ color: INK_SOFT }}>视角</div>
                        <div className="grid grid-cols-5 gap-1.5">
                            {PIECE_POV_OPTIONS.map(o => (
                                <button key={o.id} onClick={() => setPiecePov(o.id)} className="rounded-lg px-1 py-1.5 text-[10px] font-black active:scale-95" style={tabStyle(piecePov === o.id)}>{o.label}</button>
                            ))}
                        </div>
                    </div>
                </PaperCard>
                {pieceKind === 'custom' && (
                    <PaperCard tilt={-0.25} className="p-3 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                            <SectionTag en="LIBRARY">小剧场库</SectionTag>
                            <button onClick={() => customLibraryInputRef.current?.click()} className="shrink-0 text-[11px] font-black inline-flex items-center gap-1 active:scale-95" style={{ color: INK }}>
                                <FileArrowUp size={13} weight="bold" />导入
                            </button>
                        </div>
                        {customPieces.length === 0 ? (
                            <div className="text-[11px] leading-relaxed" style={{ color: INK_SOFT }}>
                                导入 JSON 后，小剧场指令会出现在这里；点一下就能填入自定义番外。
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {customPieces.slice(0, 12).map(p => (
                                    <div key={p.id} className="rounded-xl px-3 py-2.5 flex items-center gap-2" style={{ background: 'rgba(255,253,247,0.72)', border: '1px solid rgba(176,170,158,0.55)' }}>
                                        <button onClick={() => setPiecePrompt(p.instruction)} className="flex-1 min-w-0 text-left active:scale-[0.99]">
                                            <div className="text-[12px] font-black truncate" style={{ color: INK }}>{p.title}</div>
                                            <div className="text-[10px] truncate" style={{ color: INK_SOFT }}>
                                                {(p.tags || []).join(' / ') || '小剧场'}{p.description ? ` · ${p.description}` : ''}
                                            </div>
                                        </button>
                                        <button onClick={() => void deleteCustomLibraryItem(p)} className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center active:scale-90" style={{ color: INK_SOFT }} title="删除导入小剧场">
                                            <Trash size={14} weight="bold" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </PaperCard>
                )}
                <textarea value={piecePrompt} onChange={e => setPiecePrompt(e.target.value)} placeholder={tab.ph}
                    rows={pieceKind === 'custom' ? 5 : 3} className="w-full rounded-xl px-3 py-2.5 text-sm outline-none resize-none" style={paperInput} />
                <InstructionRow kind={pieceKind} onPick={setPiecePrompt} />
                <ScrapButton variant="ink" className="w-full py-2.5 text-sm" disabled={busy} onClick={() => void runPiece()}>{busy ? '生成中…' : '生成番外'}</ScrapButton>
                {piece && (
                    <PaperCard tilt={-0.4} className="p-4 space-y-3">
                        <div className="text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: '#3a362f' }}>{piece}</div>
                        <div className="flex gap-2">
                            <ScrapButton variant="paper" className="flex-1 py-2 text-[12px]" onClick={() => void runPiece()} icon={<ArrowClockwise size={14} weight="bold" />}>再生成</ScrapButton>
                            <ScrapButton variant="ink" className="flex-1 py-2 text-[12px]" onClick={() => void exportPieceToChat()} icon={<PaperPlaneTilt size={14} weight="bold" />}>发到聊天</ScrapButton>
                        </div>
                    </PaperCard>
                )}
            </Page>
        );
    }

    // ============ 番外首页 ============
    const ENTRIES: { mode: Mode; name: string; en: string; desc: string; Icon: React.FC<any> }[] = [
        { mode: 'quiz', name: '问卷番外', en: 'THE QUIZ', desc: '单人或多人一起做问卷。角色先答，你提交答案后进入本题评论区，不点下一题就一直留在这里继续聊；历史可续做、可导出。', Icon: ListChecks },
        { mode: 'piece', name: '番外工坊', en: 'THE WORKSHOP', desc: '贴吧帖、群聊、热梗、采访、日记、未寄信、时间线、脚本和档案都能搓，还能调篇幅、视角和风格。', Icon: ChatsCircle },
        { mode: 'faux', name: '仿真图文', en: 'FAUX SCREENS', desc: '微信聊天、朋友圈、微博热搜、QQ 空间、备忘录、日程表、订单小票和搜索页都能仿真生成，历史可回看、再生成、发聊天。', Icon: ImagesSquare },
    ];
    return (
        <PaperShell>
            <ScrapHeader title="番外" en="SIDE LEAVES" onBack={onExit} backLabel="回戏单" right={theaterApiButton} />
            {theaterApiDialog}
            <ScrapScroll className="px-5 pb-10 space-y-4 pt-1">
                <PaperCard tilt={-0.8} tape="ink" className="px-6 py-6 overflow-hidden">
                    <div className="text-[9px] tracking-[0.36em] mb-1.5" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>SIDE LEAVES · 番 外 篇</div>
                    <div className="flex items-end gap-2">
                        <div className="text-[40px] leading-none font-black" style={{ color: INK }}>番外</div>
                        <Scroll size={24} weight="duotone" className="mb-1.5" style={{ color: INK }} />
                    </div>
                    <div className="text-[12px] mt-2.5 leading-relaxed" style={{ color: '#54504a' }}>挑个角色，一起做问卷、看 TA 上贴吧热搜、翻 TA 的聊天记录。</div>
                </PaperCard>

                {ENTRIES.map((e, i) => (
                    <PaperCard key={e.mode} tilt={i % 2 ? 0.6 : -0.6} tape={(['amber', 'sage', 'lilac'] as const)[i]} onClick={() => setMode(e.mode)} className="px-4 py-4 flex items-center gap-3.5">
                        <Stamp size={46}><e.Icon size={24} weight="duotone" /></Stamp>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-baseline gap-2">
                                <div className="text-[19px] font-black" style={{ color: INK }}>{e.name}</div>
                                <div className="text-[8px] tracking-[0.28em] uppercase" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>{e.en}</div>
                            </div>
                            <div className="text-[11px] mt-1 leading-relaxed" style={{ color: '#6b6558' }}>{e.desc}</div>
                        </div>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M9 6l6 6-6 6" /></svg>
                    </PaperCard>
                ))}
            </ScrapScroll>
        </PaperShell>
    );
};

export default ExtraApp;
