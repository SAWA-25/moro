import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../../context/OSContext';
import {
    Sparkle, ListChecks, ChatsCircle, Fire, NotePencil, ArrowClockwise, PaperPlaneTilt,
    WechatLogo, Camera, Megaphone, ImagesSquare, Scroll, Trash, ClockCounterClockwise,
    UsersThree, User, ChatTeardropText, CheckCircle, Play,
} from '@phosphor-icons/react';
import { resolveAuxApi } from '../../utils/auxApi';
import { DB } from '../../utils/db';
import {
    inferQuestionCount, genNextQuestion, genCharAnswer, genCharComment, genExtraPiece, genFauxPiece,
    type ExtraKind, type FauxKind, type FauxResult,
} from '../../utils/theaterExtra';
import {
    bankQuizNames, getBankQuestions, isBankQuiz,
    instructionsForKind, pickInstruction, EXTRA_INSTRUCTIONS, type ExtraBankKind,
} from '../../utils/theaterExtraBank';
import { WeChatScreenshot, MomentsCard, XhsCard, ForumThread } from '../../components/theater/faux/FauxRenderers';
import {
    PaperShell, ScrapScroll, ScrapHeader, Polaroid, ScrapButton, PaperCard, Stamp,
    SectionTag, PaperDialog, INK, INK_SOFT,
} from '../ui/insScrapKit';
import type {
    CharacterProfile, TheaterQuizAnswer, TheaterQuizComment, TheaterQuizItem, TheaterQuizSession,
} from '../../types';

/**
 * 折子戏·番外（贰）：选一个角色一起做「番外」。
 *  - 问卷番外：可保存/续做的问卷房间，支持单角色或多角色，角色答、用户答、题内评论区继续聊；
 *  - 番外工坊 / 仿真图文：围绕角色一次性生成贴吧帖 / 聊天记录 / 热梗 / 微信朋友圈等主题番外。
 * 黑白拼贴手账皮肤（仿真图文渲染保留原样，模拟真 App 观感）。
 */

interface Props { onExit: () => void; }

type Mode = 'home' | 'quiz' | 'piece' | 'faux';
type QuizPlayMode = 'single' | 'multi';
type ExportKind = 'summary' | 'full';

const QUIZ_USER_ID = 'user';

// 题库里的问卷名排在前（带「题库」标），再接默认示例；去重。
const QUIZ_PRESETS = [...new Set([
    ...bankQuizNames(),
    '恋爱相性100问', 'MBTI 测试问卷', '性癖测试问卷50问', '价值观问卷', '无厘头问卷50题', '灵魂拷问36问',
])];

const FAUX_TABS: { kind: FauxKind; label: string; icon: React.ReactNode; hint: string; ph: string }[] = [
    { kind: 'wechat', label: '微信聊天', icon: <WechatLogo size={18} weight="fill" />, hint: '仿“捡手机”看到的、极真实接地气的 user×char 微信聊天记录', ph: '聊天关键词（如：深夜报备 / 吵架冷战 / 出差想你）' },
    { kind: 'moments', label: '朋友圈', icon: <Camera size={18} weight="bold" />, hint: '一条仿微信朋友圈，配图 + 点赞 + 评论，藏点两人的暗流', ph: '想发什么内容？（留空＝深扒两人近况）' },
    { kind: 'xhs', label: '小红书', icon: <ImagesSquare size={18} weight="bold" />, hint: '图文并茂的小红书笔记，标题党 + 话题 + 评论', ph: '笔记主题（如：深扒我对象 / 和 TA 的100件小事）' },
    { kind: 'forum', label: '匿名论坛', icon: <Megaphone size={18} weight="bold" />, hint: '匿名帖 + 多层跟帖吃瓜，深扒 char×user 的八卦', ph: '想开什么帖？（留空＝关于 TA 的瓜）' },
];

const PIECE_TABS: { kind: ExtraKind; label: string; icon: React.ReactNode; hint: string; ph: string }[] = [
    { kind: 'tieba', label: '贴吧帖', icon: <ChatsCircle size={18} weight="bold" />, hint: '以 TA 为话题的求助/讨论帖 + 网友回复', ph: '想发什么帖？（如：求助 TA 最近好奇怪 / 这角色到底什么来头）' },
    { kind: 'chatlog', label: '聊天记录', icon: <NotePencil size={18} weight="bold" />, hint: '围绕 TA 的一段群聊/对话截图文字稿', ph: '聊天背景（如：群里突然聊到 TA / 闺蜜八卦）' },
    { kind: 'meme', label: '热梗', icon: <Fire size={18} weight="bold" />, hint: '把 TA 套进当下流行梗里', ph: '想玩哪方面的梗？（留空＝TA 的性格名场面）' },
    { kind: 'custom', label: '自定义', icon: <Sparkle size={18} weight="bold" />, hint: '你说要什么番外，就写什么', ph: '描述你想要的番外…' },
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

const ExtraApp: React.FC<Props> = ({ onExit }) => {
    const { characters, apiConfig, auxApiConfig, userProfile, addToast } = useOS();
    const api = resolveAuxApi(auxApiConfig, apiConfig);
    const apiReady = !!(api.baseUrl && api.model);
    const userName = (userProfile?.name || '').trim() || '你';

    const [mode, setMode] = useState<Mode>('home');
    const [pickCharId, setPickCharId] = useState('');
    const char = characters.find(c => c.id === pickCharId);

    const [topic, setTopic] = useState('');
    const [busy, setBusy] = useState(false);
    const [busyLabel, setBusyLabel] = useState('');

    const [quizPlayMode, setQuizPlayMode] = useState<QuizPlayMode>('single');
    const [quizParticipantIds, setQuizParticipantIds] = useState<Set<string>>(new Set());
    const [quizHistory, setQuizHistory] = useState<TheaterQuizSession[]>([]);
    const [quizSession, setQuizSession] = useState<TheaterQuizSession | null>(null);
    const quizSessionRef = useRef<TheaterQuizSession | null>(null);
    const [quizInput, setQuizInput] = useState('');
    const [commentBusyIds, setCommentBusyIds] = useState<Set<string>>(new Set());
    const [exportOpen, setExportOpen] = useState(false);
    const [exportTargetId, setExportTargetId] = useState('');

    const [pieceKind, setPieceKind] = useState<ExtraKind>('tieba');
    const [piecePrompt, setPiecePrompt] = useState('');
    const [piece, setPiece] = useState('');

    const [fauxKind, setFauxKind] = useState<FauxKind>('wechat');
    const [fauxKeyword, setFauxKeyword] = useState('');
    const [fauxResult, setFauxResult] = useState<FauxResult | null>(null);

    useEffect(() => { quizSessionRef.current = quizSession; }, [quizSession]);

    const refreshQuizHistory = async () => {
        const list = await DB.getAllTheaterQuizSessions().catch(() => []);
        setQuizHistory(list);
    };

    useEffect(() => {
        if (mode === 'quiz') void refreshQuizHistory();
    }, [mode]);

    const participantChars = useMemo(
        () => characters.filter(c => quizParticipantIds.has(c.id)),
        [characters, quizParticipantIds],
    );

    const sessionChars = (s: TheaterQuizSession | null = quizSession) =>
        s ? s.participantIds.map(id => characters.find(c => c.id === id)).filter((c): c is CharacterProfile => !!c) : [];

    const touchSession = (s: TheaterQuizSession): TheaterQuizSession => ({ ...s, lastActiveAt: Date.now() });

    const commitQuizSession = async (next: TheaterQuizSession) => {
        const touched = touchSession(next);
        quizSessionRef.current = touched;
        setQuizSession(touched);
        setQuizHistory(prev => [touched, ...prev.filter(s => s.id !== touched.id)].sort((a, b) => b.lastActiveAt - a.lastActiveAt));
        await DB.saveTheaterQuizSession(touched);
        return touched;
    };

    const updateQuizSession = (updater: (s: TheaterQuizSession) => TheaterQuizSession): TheaterQuizSession | null => {
        const base = quizSessionRef.current;
        if (!base) return null;
        const next = touchSession(updater(base));
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
        const bank = getBankQuestions(base.topic);
        const q = await genNextQuestion({ api, topic: base.topic, index: itemIndex, total: base.total, asked, bankQuestions: bank ?? undefined });
        const item = makeQuestionItem(q, itemIndex + 1, charsForItem);
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

        const bank = getBankQuestions(t);
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
        quizSessionRef.current = s;
        setQuizSession(s);
        setQuizInput('');
        setExportTargetId(s.participantIds[0] || '');
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
            await commitQuizSession({ ...marked, status: 'finished', finishedAt: Date.now() });
            addToast('这份问卷做完啦', 'success');
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
        await commitQuizSession({ ...s, status: 'finished', finishedAt: Date.now() });
        addToast('已标记完成', 'success');
    };

    const formatQuizExport = (s: TheaterQuizSession, kind: ExportKind) => {
        const charsById = new Map(characters.map(c => [c.id, c]));
        const lines = [`【番外·${s.topic}】${kind === 'full' ? '完整问卷对话' : '问卷摘要'}`, ''];
        s.items.forEach((it, i) => {
            lines.push(`${i + 1}. ${it.question}`);
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

    const runFaux = async () => {
        if (!char) { addToast('先选一个角色', 'info'); return; }
        if (!apiReady) { addToast('还没配置 API，去「文具盒」填好再来', 'error'); return; }
        setBusy(true); setFauxResult(null);
        try {
            const out = await genFauxPiece({ api, kind: fauxKind, char, userProfile, keyword: fauxKeyword.trim() || undefined });
            setFauxResult(out);
        } catch (e: any) { addToast('生成失败：' + (e?.message || e), 'error'); } finally { setBusy(false); }
    };

    const exportFauxToChat = async () => {
        if (!char || !fauxResult) return;
        const tab = FAUX_TABS.find(t => t.kind === fauxKind);
        const summary = fauxResult.data ? JSON.stringify(fauxResult.data, null, 2) : fauxResult.fallbackText;
        try {
            await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `【番外·${tab?.label || ''}】\n${summary}`, timestamp: Date.now() });
            addToast(`已发到与 ${char.name} 的聊天`, 'success');
        } catch { addToast('发送失败', 'error'); }
    };

    const runPiece = async () => {
        if (!char) { addToast('先选一个角色', 'info'); return; }
        if (!apiReady) { addToast('还没配置 API，去「文具盒」填好再来', 'error'); return; }
        setBusy(true); setPiece('');
        try {
            const out = await genExtraPiece({ api, kind: pieceKind, char, userProfile, prompt: piecePrompt.trim() || undefined });
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
                <Page title="问卷番外" en="THE QUIZ" onBack={() => setMode('home')}>
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
                        <input value={topic} onChange={e => setTopic(e.target.value)} placeholder="如：恋爱相性100问 / 性癖测试50问 / MBTI"
                            className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={paperInput} />
                        <div className="flex flex-wrap gap-1.5">
                            {QUIZ_PRESETS.map(p => (
                                <button key={p} onClick={() => setTopic(p)} className="px-2.5 py-1 rounded-full text-[11px] font-bold active:scale-95 inline-flex items-center gap-1" style={tabStyle(false)}>
                                    {p}{isBankQuiz(p) && <span className="text-[8px] px-1 rounded-[3px]" style={{ background: '#1f1d1a', color: '#f6f3ec' }}>题库</span>}
                                </button>
                            ))}
                        </div>
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
                right={<button onClick={() => { setExportTargetId(quizSession.participantIds[0] || ''); setExportOpen(true); }} className="text-[11px] font-black px-3 py-1.5 rounded-full active:scale-95" style={{ background: '#1f1d1a', color: '#f6f3ec' }}>导出</button>}
            >
                <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(31,29,26,0.1)' }}>
                        <div className="h-full" style={{ width: `${progress}%`, background: '#1f1d1a' }} />
                    </div>
                    <span className="text-[11px] tabular-nums" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>{quizSession.currentIndex + 1}/{quizSession.total}</span>
                </div>

                {item && (
                    <>
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
                                            <button onClick={() => void generateCommentForChar(c.id)} disabled={commentBusyIds.has(c.id) || busy} className="mt-2 text-[11px] font-black active:scale-95 disabled:opacity-45 inline-flex items-center gap-1" style={{ color: i % 2 ? INK : 'rgba(246,243,236,0.78)' }}>
                                                <ChatTeardropText size={13} weight="bold" />{commentBusyIds.has(c.id) ? '正在接话…' : '让 TA 再说一句'}
                                            </button>
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
                            <SectionTag en="COMMENTS">本题评论区</SectionTag>
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
        const d = fauxResult?.data;
        return (
            <Page title="仿真图文" en="FAUX SCREENS" onBack={() => { setFauxResult(null); setMode('home'); }}>
                <CharPicker characters={characters} pickCharId={pickCharId} setPickCharId={setPickCharId} />
                <div className="grid grid-cols-4 gap-2">
                    {FAUX_TABS.map(t => (
                        <button key={t.kind} onClick={() => { setFauxKind(t.kind); setFauxResult(null); }} className="flex flex-col items-center gap-1 py-2.5 rounded-2xl transition-all active:scale-95" style={tabStyle(fauxKind === t.kind)}>
                            {t.icon}<span className="text-[10px] font-bold">{t.label}</span>
                        </button>
                    ))}
                </div>
                <div className="text-[11px] px-1" style={{ color: '#6b6558' }}>{tab.hint}</div>
                <textarea value={fauxKeyword} onChange={e => setFauxKeyword(e.target.value)} placeholder={tab.ph}
                    rows={2} className="w-full rounded-xl px-3 py-2.5 text-sm outline-none resize-none" style={paperInput} />
                <InstructionRow kind={fauxKind} onPick={setFauxKeyword} />
                <ScrapButton variant="ink" className="w-full py-2.5 text-sm" disabled={busy} onClick={() => void runFaux()}>{busy ? '生成中…' : '生成仿真图文'}</ScrapButton>

                {fauxResult && (
                    <div className="space-y-3">
                        {d && fauxKind === 'wechat' && <WeChatScreenshot data={d} charAvatar={char?.avatar} userAvatar={userProfile?.avatar} />}
                        {d && fauxKind === 'moments' && <MomentsCard data={d} avatar={char?.avatar} />}
                        {d && fauxKind === 'xhs' && <XhsCard data={d} />}
                        {d && fauxKind === 'forum' && <ForumThread data={d} />}
                        {!d && (
                            <PaperCard className="p-4 text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: '#3a362f' }}>
                                <div className="text-[10px] mb-1.5" style={{ color: INK_SOFT }}>（这次没解析成结构化，先看文字稿）</div>
                                {fauxResult.fallbackText}
                            </PaperCard>
                        )}
                        <div className="text-center text-[10px]" style={{ color: INK_SOFT }}>长按 / 用手机系统截屏即可保存这张图</div>
                        <div className="flex gap-2">
                            <ScrapButton variant="paper" className="flex-1 py-2 text-[12px]" onClick={() => void runFaux()} icon={<ArrowClockwise size={14} weight="bold" />}>再生成</ScrapButton>
                            <ScrapButton variant="ink" className="flex-1 py-2 text-[12px]" onClick={() => void exportFauxToChat()} icon={<PaperPlaneTilt size={14} weight="bold" />}>发到聊天</ScrapButton>
                        </div>
                    </div>
                )}
            </Page>
        );
    }

    // ============ 一次性番外 ============
    if (mode === 'piece') {
        const tab = PIECE_TABS.find(t => t.kind === pieceKind)!;
        return (
            <Page title="番外工坊" en="THE WORKSHOP" onBack={() => { setPiece(''); setMode('home'); }}>
                <CharPicker characters={characters} pickCharId={pickCharId} setPickCharId={setPickCharId} />
                <div className="grid grid-cols-4 gap-2">
                    {PIECE_TABS.map(t => (
                        <button key={t.kind} onClick={() => { setPieceKind(t.kind); setPiece(''); }} className="flex flex-col items-center gap-1 py-2.5 rounded-2xl transition-all active:scale-95" style={tabStyle(pieceKind === t.kind)}>
                            {t.icon}<span className="text-[10px] font-bold">{t.label}</span>
                        </button>
                    ))}
                </div>
                <div className="text-[11px] px-1" style={{ color: '#6b6558' }}>{tab.hint}</div>
                <textarea value={piecePrompt} onChange={e => setPiecePrompt(e.target.value)} placeholder={tab.ph}
                    rows={2} className="w-full rounded-xl px-3 py-2.5 text-sm outline-none resize-none" style={paperInput} />
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
        { mode: 'piece', name: '番外工坊', en: 'THE WORKSHOP', desc: '求助贴吧帖、群聊天记录、把 TA 套进热梗…围绕角色一键生成一段主题番外，可发回聊天。', Icon: ChatsCircle },
        { mode: 'faux', name: '仿真图文', en: 'FAUX SCREENS', desc: '仿“捡手机”的微信聊天、朋友圈、小红书、匿名论坛吃瓜帖——图文并茂深扒你和 TA，截屏即存。', Icon: ImagesSquare },
    ];
    return (
        <PaperShell>
            <ScrapHeader title="番外" en="SIDE LEAVES" onBack={onExit} backLabel="回戏单" />
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
