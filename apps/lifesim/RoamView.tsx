/**
 * RoamView — 都市人生 · 漫游系统
 *
 * 进去就在一张城市地图上「闲逛」：点空白处移动、点 pin 和附近的人聊天、刷新换一批人，
 * 路上会冒出店铺和街头事件（今日足迹）。可以挑一个角色陪你一起逛街。陌生人也会主动来搭话。
 *
 * 设计取向：核心体验（地图/移动/遇见/事件/图鉴）有内置内容池，没配 API 也能玩；
 * 和陌生人/角色对话、街坊秘闻用 AI 生成（拿不到就回落到内置话术）。
 * 状态独立存 localStorage（moro_roam_v1），不动 LifeSimState，互不干扰。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { AppID } from '../../types';
import { safeFetchJson } from '../../utils/safeApi';
import {
    X, ArrowClockwise, Crosshair, Footprints, MapPin, Sparkle,
    PaperPlaneRight, UserPlus, BookOpen, ChatCircleDots, Eye, Storefront,
} from '@phosphor-icons/react';

// ── 内置内容池 ───────────────────────────────────────────────

const STREETS = ['梧桐路', '安宁巷', '静园巷', '春熙弄', '云栖街', '老城根', '河畔道', '槐荫里', '灯市口', '青石坊'];
const SUBPLACES = ['里口', '街角', '巷尾', '桥头', '路口', '后院', '天台', '河边'];

const STRANGER_NAMES = ['姜承基', '沈知夏', '陆时砚', '林又南', '苏鹿鸣', '周与白', '顾听澜', '夏目修', '阿木', '小满', '老郑', '阿May', '温迟', '宋星河', '叶安', '何洲'];
const STRANGER_BLURBS = ['迟到的旅人', '遛狗的老人', '抱猫的女孩', '写生的学生', '卖花的阿婆', '滑板少年', '加班的白领', '拎着吉他的人', '找猫的房东', '摆摊的占卜师', '送外卖的骑手', '晨跑的常客', '修表的师傅', '拍立得摄影师'];
const STRANGER_EMOJIS = ['🧳', '🐕', '🐈', '🎨', '💐', '🛹', '💼', '🎸', '🔑', '🔮', '🛵', '🏃', '⌚', '📷', '🧣', '☂️'];
const STRANGER_PERSONAS = [
    '一个刚下火车、对这座城还很陌生的旅人，说话带点新鲜和小心翼翼，会问路也会分享旅途见闻。',
    '街区里住了很多年的老住户，话不多但很有故事，喜欢念叨从前。',
    '附近美院的学生，正在写生，对色彩和光线很敏感，说话天马行空。',
    '在写字楼加班到现在的白领，疲惫但礼貌，偶尔自嘲，渴望一点松弛。',
    '抱着一只猫的女孩，安静温柔，话题总绕回小动物。',
    '街头卖唱/弹吉他的人，浪漫散漫，喜欢用歌词回话。',
];

const SHOP_POOL: Array<{ name: string; emoji: string; kind: string }> = [
    { name: '拐角咖啡', emoji: '☕', kind: '咖啡馆' },
    { name: '一碗面', emoji: '🍜', kind: '面馆' },
    { name: '旧光书店', emoji: '📚', kind: '旧书店' },
    { name: '春天花店', emoji: '🌸', kind: '花店' },
    { name: '叮当游戏厅', emoji: '🎮', kind: '游戏厅' },
    { name: '甜了个甜', emoji: '🍰', kind: '甜品店' },
    { name: '深夜食堂', emoji: '🏮', kind: '居酒屋' },
    { name: '猫之茶室', emoji: '🐱', kind: '猫咖' },
    { name: '光影旧影院', emoji: '🎬', kind: '旧影院' },
    { name: '调色盘', emoji: '🎨', kind: '画材店' },
];

interface RoamEvent { id: string; emoji: string; title: string; sub?: string; choices: Array<{ label: string; result: string; spawn?: boolean; secret?: boolean }>; }
const EVENT_POOL: RoamEvent[] = [
    { id: 'ev-radio', emoji: '📻', title: '广播突然插播一条寻物启事，描述的物品你刚见过。', sub: '迟到的旅人 出现在附近。', choices: [
        { label: '去看看', result: '你循着广播找过去，遇见了正满头大汗找东西的人。', spawn: true },
        { label: '继续走', result: '你假装没听见，把这桩小事留给了风。' },
    ]},
    { id: 'ev-cat', emoji: '🐈', title: '街角的猫打翻了花盆，蹲在碎瓷片里看你。', choices: [
        { label: '蹲下逗它', result: '猫蹭了蹭你的指尖，留下一根白毛和一点好心情。' },
        { label: '帮忙收拾', result: '你默默扶起花盆，店家探出头道了声谢。' },
    ]},
    { id: 'ev-balloon', emoji: '🎈', title: '路口有人在发免费气球，说今天是某个无名的纪念日。', choices: [
        { label: '要一个', result: '你拿了只氢气球，它一路替你打招呼。' },
        { label: '问问缘由', result: '对方神秘一笑，只说「你来了就算数」。', secret: true },
    ]},
    { id: 'ev-rain', emoji: '🌦️', title: '突然下起太阳雨，屋檐下挤了几个躲雨的人。', choices: [
        { label: '一起躲雨', result: '屋檐下短短几分钟，陌生人之间也聊起了天。', spawn: true },
        { label: '淋着走', result: '你迎着光走进雨里，整条街都亮晶晶的。' },
    ]},
    { id: 'ev-busker', emoji: '🎸', title: '路边艺人开始表演，吉他声把人群慢慢聚拢。', choices: [
        { label: '驻足听完', result: '一曲终了，你和旁边的人交换了一个「真好」的眼神。', spawn: true },
        { label: '投点零钱', result: '硬币落进琴盒，艺人对你眨了眨眼。' },
    ]},
    { id: 'ev-letter', emoji: '✉️', title: '长椅上躺着一封没署名的信，风把它翻到了你脚边。', choices: [
        { label: '拆开读', result: '信里只有一句话：「明天此处，老地方见。」', secret: true },
        { label: '放回原处', result: '你把信压回长椅，让它继续等它的人。' },
    ]},
    { id: 'ev-queue', emoji: '🍰', title: '限时打折的甜品店排起了长队，香味飘了半条街。', choices: [
        { label: '排队尝鲜', result: '半小时后，你捧着一块温热的舒芙蕾走出来。' },
        { label: '改天再来', result: '你记下了这家店，留作下次的念想。' },
    ]},
];

const SECRET_POOL = [
    '听说梧桐路尽头那家书店，老板会在你最需要的那天，把某本书摆到最显眼的位置。',
    '河畔道的猫咖里养着一只会算命的橘猫，蹭谁谁当天就走运。',
    '灯市口每到午夜会多出一盏没人点的灯，据说是给迷路的人留的。',
    '春熙弄的花店每周三会偷偷多送一支花，给那天看起来不太开心的人。',
    '老城根的修表师傅说，他能修好停摆的钟，却修不好等不到的人。',
    '青石坊的旧影院最后一排，永远空着一个座位，售票员从不卖。',
];

// ── 类型 ────────────────────────────────────────────────────

type Kind = 'known' | 'stranger';
interface RoamPerson { id: string; kind: Kind; charId?: string; name: string; emoji: string; avatar?: string; blurb: string; persona?: string; x: number; y: number; }
interface RoamMsg { id: string; role: 'user' | 'them'; text: string; at: number; }
interface RoamThread { personId: string; name: string; emoji: string; avatar?: string; kind: Kind; persona?: string; msgs: RoamMsg[]; lastAt: number; unread: boolean; }
interface RoamShop { id: string; name: string; emoji: string; kind: string; x: number; y: number; }
interface RoamFootprint { id: string; at: number; tag: string; title: string; detail?: string; place?: string; choice?: string; }
interface RoamSecret { id: string; at: number; text: string; place?: string; }
interface DexPerson { name: string; emoji: string; blurb: string; at: number; }
interface DexShop { name: string; emoji: string; kind: string; at: number; }
interface RoamState {
    userX: number; userY: number;
    street: string;
    nearby: RoamPerson[];
    shops: RoamShop[];
    threads: RoamThread[];
    footprints: RoamFootprint[];
    secrets: RoamSecret[];
    dexPeople: DexPerson[];
    dexShops: DexShop[];
    companionId?: string;
    activeEvent?: RoamEvent | null;
    eventPlace?: string;
    lastRefresh: number;
}

// ── 工具 ────────────────────────────────────────────────────

const ROAM_KEY = 'moro_roam_v1';
const genId = () => Math.random().toString(36).slice(2, 10);
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const rnd = (min: number, max: number) => Math.round(min + Math.random() * (max - min));
const fmtTime = (t: number) => new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

function loadRoam(): RoamState | null {
    try { const raw = localStorage.getItem(ROAM_KEY); return raw ? JSON.parse(raw) as RoamState : null; } catch { return null; }
}
function saveRoam(s: RoamState) {
    try {
        // 控制体积：聊天串各保留最近 40 条，足迹/秘闻各 60 条
        const trimmed: RoamState = {
            ...s,
            threads: s.threads.map(t => ({ ...t, msgs: t.msgs.slice(-40) })).slice(-30),
            footprints: s.footprints.slice(-60),
            secrets: s.secrets.slice(-60),
            dexPeople: s.dexPeople.slice(-200),
            dexShops: s.dexShops.slice(-200),
        };
        localStorage.setItem(ROAM_KEY, JSON.stringify(trimmed));
    } catch { /* 配额满就算了 */ }
}

function freshState(): RoamState {
    return {
        userX: 46, userY: 52, street: pick(STREETS),
        nearby: [], shops: [], threads: [], footprints: [], secrets: [],
        dexPeople: [], dexShops: [], lastRefresh: 0,
    };
}

function makeStranger(): RoamPerson {
    const i = Math.floor(Math.random() * STRANGER_BLURBS.length);
    return {
        id: 'sg-' + genId(), kind: 'stranger',
        name: pick(STRANGER_NAMES), emoji: STRANGER_EMOJIS[i] || '🙂',
        blurb: STRANGER_BLURBS[i], persona: pick(STRANGER_PERSONAS),
        x: rnd(12, 88), y: rnd(14, 80),
    };
}

// ── AI ──────────────────────────────────────────────────────

interface Api { baseUrl: string; apiKey: string; model: string; }
const apiReady = (a?: Api) => !!(a?.baseUrl && a?.apiKey && a?.model);

async function roamChatAI(api: Api, system: string, history: RoamMsg[]): Promise<string | null> {
    if (!apiReady(api)) return null;
    try {
        const messages = [
            { role: 'system', content: system },
            ...history.slice(-12).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text })),
        ];
        const data = await safeFetchJson(
            `${api.baseUrl.replace(/\/+$/, '')}/chat/completions`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api.apiKey}` },
                body: JSON.stringify({ model: api.model, messages, temperature: 0.9, max_tokens: 600, stream: false }),
            },
            2, 30000, { appName: '都市人生·漫游', purpose: '街头对话' },
        );
        const txt = data?.choices?.[0]?.message?.content?.trim();
        return txt ? txt.replace(/^\[.*?\]\s*/, '').slice(0, 500) : null;
    } catch { return null; }
}

// ── 子视图：遭遇聊天 ─────────────────────────────────────────

const EncounterChat: React.FC<{
    thread: RoamThread;
    userName: string;
    userAvatar: string;
    onSend: (text: string) => void;
    isReplying: boolean;
    onBack: () => void;
    onCollect: () => void;
    collected: boolean;
}> = ({ thread, userName, userAvatar, onSend, isReplying, onBack, onCollect, collected }) => {
    const [draft, setDraft] = useState('');
    const endRef = useRef<HTMLDivElement>(null);
    useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [thread.msgs.length, isReplying]);
    const submit = () => { const t = draft.trim(); if (!t) return; setDraft(''); onSend(t); };
    return (
        <div className="absolute inset-0 z-30 flex flex-col bg-[#f6f3ec]">
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-stone-200 bg-white/80 backdrop-blur-md shrink-0">
                <button onClick={onBack} className="p-1.5 -ml-1 rounded-full active:bg-black/5"><X size={18} weight="bold" className="text-stone-500" /></button>
                <div className="w-9 h-9 rounded-full bg-stone-100 flex items-center justify-center text-lg overflow-hidden">
                    {thread.avatar ? <img src={thread.avatar} className="w-full h-full object-cover" /> : <span>{thread.emoji}</span>}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-stone-800 truncate">{thread.name}</div>
                    <div className="text-[10px] text-stone-400">{thread.kind === 'stranger' ? '萍水相逢' : '熟人'}</div>
                </div>
                {thread.kind === 'stranger' && (
                    <button onClick={onCollect} disabled={collected} className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[11px] font-bold ${collected ? 'bg-stone-100 text-stone-400' : 'bg-rose-50 text-rose-500 active:scale-95'}`}>
                        <BookOpen size={13} weight="bold" /> {collected ? '已收录' : '记入图鉴'}
                    </button>
                )}
            </div>
            <div className="flex-1 overflow-y-auto no-scrollbar px-3 py-4 space-y-3">
                {thread.msgs.length === 0 && (
                    <div className="text-center text-[11px] text-stone-400 py-8">你们刚刚在街上相遇 · 说点什么吧</div>
                )}
                {thread.msgs.map(m => (
                    <div key={m.id} className={`flex items-end gap-2 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                        <div className="w-7 h-7 rounded-full bg-stone-100 flex items-center justify-center text-sm overflow-hidden shrink-0">
                            {m.role === 'user'
                                ? (userAvatar ? <img src={userAvatar} className="w-full h-full object-cover" /> : <span>🙂</span>)
                                : (thread.avatar ? <img src={thread.avatar} className="w-full h-full object-cover" /> : <span>{thread.emoji}</span>)}
                        </div>
                        <div className={`max-w-[72%] px-3 py-2 rounded-2xl text-[13px] leading-relaxed whitespace-pre-wrap ${m.role === 'user' ? 'bg-stone-800 text-white rounded-br-sm' : 'bg-white text-stone-800 rounded-bl-sm shadow-sm'}`}>
                            {m.text}
                        </div>
                    </div>
                ))}
                {isReplying && <div className="flex items-center gap-1.5 pl-9 text-stone-400 text-xs animate-pulse"><span>对方正在回复</span><span className="tracking-widest">···</span></div>}
                <div ref={endRef} />
            </div>
            <div className="shrink-0 p-2.5 border-t border-stone-200 bg-white/80 backdrop-blur-md flex items-center gap-2" style={{ paddingBottom: 'max(10px, env(safe-area-inset-bottom, 10px))' }}>
                <input
                    value={draft} onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') submit(); }}
                    placeholder={`和 ${thread.name} 说点什么…`}
                    className="flex-1 px-3.5 py-2.5 rounded-full bg-stone-100 text-[13px] outline-none focus:bg-white focus:ring-1 focus:ring-stone-300"
                />
                <button onClick={submit} disabled={isReplying || !draft.trim()} className="w-10 h-10 rounded-full bg-stone-800 text-white flex items-center justify-center disabled:opacity-40 active:scale-95">
                    <PaperPlaneRight size={17} weight="fill" />
                </button>
            </div>
        </div>
    );
};

// ── 主组件 ──────────────────────────────────────────────────

const TABS = [
    { id: 'stroll', label: '闲逛', Icon: Footprints },
    { id: 'nearby', label: '附近', Icon: MapPin },
    { id: 'msgs', label: '消息', Icon: ChatCircleDots },
    { id: 'secret', label: '秘闻', Icon: Eye },
    { id: 'dex', label: '图鉴', Icon: BookOpen },
] as const;
type TabId = typeof TABS[number]['id'];

const RoamView: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const { apiConfig, characters, userProfile, setActiveCharacterId, openApp, addToast } = useOS();
    const api = apiConfig as unknown as Api;

    const [state, setState] = useState<RoamState>(() => loadRoam() || freshState());
    const [tab, setTab] = useState<TabId>('stroll');
    const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
    const [replyingThreadId, setReplyingThreadId] = useState<string | null>(null);
    const [showCompanionPick, setShowCompanionPick] = useState(false);

    // 持久化
    useEffect(() => { saveRoam(state); }, [state]);

    // 首次进入若没人，铺一批
    useEffect(() => {
        if (state.nearby.length === 0) refresh(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const companion = useMemo(() => characters.find(c => c.id === state.companionId) || null, [characters, state.companionId]);

    const addFootprint = (fp: Omit<RoamFootprint, 'id' | 'at'>) =>
        setState(s => ({ ...s, footprints: [...s.footprints, { ...fp, id: genId(), at: Date.now() }] }));

    // 重新铺一批附近的人 + 店铺（refresh / 进入）
    function refresh(initial = false) {
        setState(s => {
            // 随机选 0~2 个已导入角色"也在附近"
            const knownPool = characters.slice().sort(() => Math.random() - 0.5).slice(0, Math.min(2, characters.length));
            const known: RoamPerson[] = knownPool.map(c => ({
                id: 'kn-' + c.id, kind: 'known', charId: c.id,
                name: c.convoSettings?.remarkName?.trim() || c.name, emoji: '🙂', avatar: c.avatar,
                blurb: '熟人', x: rnd(12, 88), y: rnd(14, 80),
            }));
            const strangers = Array.from({ length: rnd(2, 4) }, makeStranger);
            const shops = SHOP_POOL.slice().sort(() => Math.random() - 0.5).slice(0, rnd(2, 4)).map(sh => ({
                ...sh, id: 'sh-' + genId(), x: rnd(8, 90), y: rnd(10, 82),
            }));
            const street = pick(STREETS);
            return { ...s, nearby: [...known, ...strangers], shops, street, lastRefresh: Date.now() };
        });
        if (!initial) addToast('换了个街区，遇见新的人', 'info');
        // 一定概率：陌生人主动来搭话 + 街头事件
        setTimeout(() => { maybeStrangerInitiates(); maybeEvent(); }, 400);
    }

    // 陌生人主动发起聊天
    function maybeStrangerInitiates() {
        setState(s => {
            const candidates = s.nearby.filter(p => p.kind === 'stranger' && !s.threads.some(t => t.personId === p.id));
            if (candidates.length === 0 || Math.random() > 0.55) return s;
            const p = pick(candidates);
            const opener = pick([
                '欸，能问下这附近哪有好喝的咖啡吗？',
                '不好意思打扰一下…你是不是也常来这条街？',
                '诶你这边的天气，刚刚是不是下了点雨？',
                '这只猫一直跟着我，你说它是不是饿了？',
                '我有点迷路了，方便指个路吗？',
            ]);
            const thread: RoamThread = {
                personId: p.id, name: p.name, emoji: p.emoji, avatar: p.avatar, kind: p.kind, persona: p.persona,
                msgs: [{ id: genId(), role: 'them', text: opener, at: Date.now() }], lastAt: Date.now(), unread: true,
            };
            addToast(`${p.name} 在街上叫住了你`, 'info');
            return { ...s, threads: [thread, ...s.threads.filter(t => t.personId !== p.id)] };
        });
    }

    // 街头事件
    function maybeEvent() {
        setState(s => {
            if (s.activeEvent || Math.random() > 0.6) return s;
            return { ...s, activeEvent: pick(EVENT_POOL), eventPlace: `${pick(STREETS)} · ${pick(SUBPLACES)}` };
        });
    }

    // 选择事件分支
    function resolveEvent(choiceIdx: number) {
        setState(s => {
            const ev = s.activeEvent; if (!ev) return s;
            const choice = ev.choices[choiceIdx];
            const place = s.eventPlace;
            let next: RoamState = {
                ...s, activeEvent: null, eventPlace: undefined,
                footprints: [...s.footprints, { id: genId(), at: Date.now(), tag: '即兴', title: ev.title, detail: choice.result, place, choice: choice.label }],
            };
            if (choice.spawn) {
                const sg = makeStranger();
                next = { ...next, nearby: [...next.nearby, sg] };
            }
            if (choice.secret) {
                next = { ...next, secrets: [{ id: genId(), at: Date.now(), text: pick(SECRET_POOL), place }, ...next.secrets] };
            }
            return next;
        });
        if (companion) addToast(`${companion.name}：「${pick(['有意思。', '走吧走吧，跟上你。', '你总能撞见点故事。', '换我可不敢。'])}」`, 'info');
    }

    // 地图：点空白处移动
    const mapRef = useRef<HTMLDivElement>(null);
    const onMapTap = (e: React.MouseEvent) => {
        const box = mapRef.current?.getBoundingClientRect(); if (!box) return;
        const x = Math.max(4, Math.min(96, ((e.clientX - box.left) / box.width) * 100));
        const y = Math.max(6, Math.min(92, ((e.clientY - box.top) / box.height) * 100));
        setState(s => ({ ...s, userX: x, userY: y }));
        if (Math.random() < 0.25) setTimeout(maybeEvent, 200);
    };

    // 闲逛：随便走走
    const wander = () => {
        setState(s => ({ ...s, userX: rnd(10, 90), userY: rnd(12, 88), street: pick(STREETS) }));
        addFootprint({ tag: '漫步', title: '你信步走过几个街角', detail: pick(['风把梧桐叶吹了一地。', '远处有人在练萨克斯。', '一只猫从墙头跳下来。', '路灯次第亮起来了。']), place: `${pick(STREETS)} · ${pick(SUBPLACES)}` });
        setTimeout(() => { maybeStrangerInitiates(); maybeEvent(); }, 300);
    };

    // 打开与某人的聊天：熟人直接进真实聊天；陌生人进遭遇聊天
    function chatWith(p: RoamPerson) {
        if (p.kind === 'known' && p.charId) {
            setActiveCharacterId(p.charId);
            openApp(AppID.Chat);
            return;
        }
        setState(s => {
            if (s.threads.some(t => t.personId === p.id)) return s;
            const thread: RoamThread = { personId: p.id, name: p.name, emoji: p.emoji, avatar: p.avatar, kind: p.kind, persona: p.persona, msgs: [], lastAt: Date.now(), unread: false };
            return { ...s, threads: [thread, ...s.threads] };
        });
        setActiveThreadId(p.id);
        setState(s => ({ ...s, threads: s.threads.map(t => t.personId === p.id ? { ...t, unread: false } : t) }));
    }

    const openThread = (t: RoamThread) => {
        setActiveThreadId(t.personId);
        setState(s => ({ ...s, threads: s.threads.map(x => x.personId === t.personId ? { ...x, unread: false } : x) }));
    };

    // 发送消息给陌生人，AI 回复（回落到内置话术）
    async function sendInThread(personId: string, text: string) {
        const userMsg: RoamMsg = { id: genId(), role: 'user', text, at: Date.now() };
        setState(s => ({ ...s, threads: s.threads.map(t => t.personId === personId ? { ...t, msgs: [...t.msgs, userMsg], lastAt: Date.now() } : t) }));
        const thread = state.threads.find(t => t.personId === personId);
        const persona = thread?.persona || '一个城市里偶遇的路人，语气自然、口语化。';
        const history = [...(thread?.msgs || []), userMsg];
        setReplyingThreadId(personId);
        const system = `你正在扮演一个在城市街头与「${userProfile.name}」萍水相逢的人。人物设定：${persona}\n` +
            `场景：你们在${state.street}附近偶遇，正站在街边随意聊着。\n` +
            `要求：用第一人称、口语化中文回复，1~3 句，自然有生活感，符合人物身份。不要旁白、不要括号动作、不要重复对方的话。`;
        const reply = await roamChatAI(api, system, history);
        const text2 = reply || pick(['（笑）这倒是巧了。', '嗯…让我想想怎么说。', '你这么一说，还真有点意思。', '哈，难得遇到能聊两句的。']);
        const themMsg: RoamMsg = { id: genId(), role: 'them', text: text2, at: Date.now() };
        setReplyingThreadId(null);
        setState(s => ({ ...s, threads: s.threads.map(t => t.personId === personId ? { ...t, msgs: [...t.msgs, themMsg], lastAt: Date.now() } : t) }));
    }

    // 把陌生人记入图鉴
    function collectPerson(personId: string) {
        setState(s => {
            const p = s.nearby.find(x => x.id === personId) || s.threads.find(t => t.personId === personId);
            const name = (p as any)?.name; const emoji = (p as any)?.emoji || '🙂'; const blurb = (p as any)?.blurb || '萍水相逢';
            if (!name || s.dexPeople.some(d => d.name === name && d.blurb === blurb)) return s;
            return { ...s, dexPeople: [{ name, emoji, blurb, at: Date.now() }, ...s.dexPeople] };
        });
        addToast('已记入图鉴', 'success');
    }

    // 进店：记图鉴 + 足迹
    function visitShop(sh: RoamShop) {
        setState(s => ({
            ...s,
            footprints: [...s.footprints, { id: genId(), at: Date.now(), tag: '到店', title: `你走进了「${sh.name}」`, detail: pick(['店里放着旧唱片。', '老板记得你上次点的东西。', '靠窗的位置正好空着。', '一股暖香扑面而来。']), place: s.street }],
            dexShops: s.dexShops.some(d => d.name === sh.name) ? s.dexShops : [{ name: sh.name, emoji: sh.emoji, kind: sh.kind, at: Date.now() }, ...s.dexShops],
        }));
        if (companion) addToast(`${companion.name}：「${pick(['这家我喜欢。', '请客吗？', '坐会儿吧。', '闻起来不错。'])}」`, 'info');
        else addToast(`进了「${sh.name}」`, 'info');
    }

    // 打听秘闻
    function listenSecret() {
        setState(s => ({ ...s, secrets: [{ id: genId(), at: Date.now(), text: pick(SECRET_POOL), place: `${pick(STREETS)} · ${pick(SUBPLACES)}` }, ...s.secrets] }));
        addToast('你打听到一桩街坊秘闻', 'info');
    }

    const activeThread = state.threads.find(t => t.personId === activeThreadId) || null;
    const dexCount = state.dexPeople.length + state.dexShops.length;
    const unreadCount = state.threads.filter(t => t.unread).length;

    // ── 渲染 ──
    return (
        <div className="absolute inset-0 z-20 flex flex-col bg-[#f4f1ea] text-stone-800" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
            {/* 顶栏 */}
            <div className="flex items-center px-3 py-3 shrink-0">
                <button onClick={onClose} className="p-1.5 rounded-full active:bg-black/5"><X size={22} weight="bold" className="text-stone-600" /></button>
                <h1 className="flex-1 text-center text-lg font-bold tracking-widest">漫游</h1>
                <button onClick={() => refresh(false)} className="p-1.5 rounded-full active:bg-black/5"><ArrowClockwise size={20} weight="bold" className="text-stone-600" /></button>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar px-3 pb-4">
                {/* 地图卡片 */}
                <div className="relative rounded-2xl overflow-hidden shadow-sm border border-stone-200" style={{ height: 300 }}>
                    <div
                        ref={mapRef}
                        onClick={onMapTap}
                        className="absolute inset-0 cursor-pointer"
                        style={{
                            background: '#e9e3d6',
                            backgroundImage:
                                'linear-gradient(rgba(255,255,255,0.5) 2px, transparent 2px), linear-gradient(90deg, rgba(255,255,255,0.5) 2px, transparent 2px), linear-gradient(rgba(180,170,150,0.18) 1px, transparent 1px), linear-gradient(90deg, rgba(180,170,150,0.18) 1px, transparent 1px)',
                            backgroundSize: '56px 56px, 56px 56px, 18px 18px, 18px 18px',
                        }}
                    >
                        {/* 街区色块（公园/水域点缀） */}
                        <div className="absolute rounded-lg" style={{ left: '6%', top: '10%', width: '20%', height: '16%', background: 'rgba(150,190,150,0.35)' }} />
                        <div className="absolute rounded-lg" style={{ left: '70%', top: '60%', width: '22%', height: '20%', background: 'rgba(150,180,210,0.4)' }} />
                        <div className="absolute rounded-lg" style={{ left: '40%', top: '74%', width: '16%', height: '12%', background: 'rgba(150,190,150,0.3)' }} />

                        {/* 店铺 */}
                        {state.shops.map(sh => (
                            <button
                                key={sh.id}
                                onClick={e => { e.stopPropagation(); visitShop(sh); }}
                                className="absolute -translate-x-1/2 -translate-y-1/2 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-white/90 shadow-sm border border-stone-200 active:scale-90 transition-transform"
                                style={{ left: `${sh.x}%`, top: `${sh.y}%` }}
                            >
                                <span className="text-[13px] leading-none">{sh.emoji}</span>
                                <span className="text-[9px] font-bold text-stone-500 whitespace-nowrap">{sh.name}</span>
                            </button>
                        ))}

                        {/* 人物 pin */}
                        {state.nearby.map(p => (
                            <button
                                key={p.id}
                                onClick={e => { e.stopPropagation(); chatWith(p); }}
                                className="absolute -translate-x-1/2 -translate-y-full flex flex-col items-center active:scale-90 transition-transform"
                                style={{ left: `${p.x}%`, top: `${p.y}%` }}
                            >
                                <div className="flex items-center gap-1">
                                    <span className="relative flex items-center justify-center" style={{ width: 22, height: 30 }}>
                                        <span className="absolute inset-x-0 top-0 mx-auto rounded-full shadow" style={{ width: 22, height: 22, background: p.kind === 'known' ? '#3b82f6' : '#ef4444' }} />
                                        <span className="absolute" style={{ bottom: 1, left: '50%', transform: 'translateX(-50%) rotate(45deg)', width: 8, height: 8, background: p.kind === 'known' ? '#3b82f6' : '#ef4444' }} />
                                        <span className="absolute top-[3px] text-[11px] leading-none">{p.kind === 'known' && p.avatar ? '' : p.emoji}</span>
                                        {p.kind === 'known' && p.avatar && <img src={p.avatar} className="absolute top-[2px] rounded-full object-cover" style={{ width: 18, height: 18 }} />}
                                    </span>
                                    <span className="px-1.5 py-0.5 rounded-full bg-white/95 shadow-sm text-[9px] font-bold text-stone-600 whitespace-nowrap">{p.name}</span>
                                </div>
                            </button>
                        ))}

                        {/* 用户 + 同伴 */}
                        <div className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none" style={{ left: `${state.userX}%`, top: `${state.userY}%` }}>
                            <span className="absolute -inset-3 rounded-full animate-ping" style={{ background: 'rgba(59,130,246,0.18)' }} />
                            <span className="relative block w-4 h-4 rounded-full bg-blue-500 ring-2 ring-white shadow" />
                            {companion && (
                                <img src={companion.avatar} className="absolute -right-5 -top-1 w-6 h-6 rounded-full object-cover ring-2 ring-white shadow" />
                            )}
                        </div>
                    </div>

                    {/* 街名 pill */}
                    <div className="absolute top-2.5 left-2.5 right-12 flex">
                        <div className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-white/95 shadow-sm">
                            <MapPin size={13} weight="fill" className="text-red-500" />
                            <span className="text-[13px] font-bold text-stone-700 truncate">{state.street}</span>
                        </div>
                    </div>

                    {/* 操作提示 */}
                    <div className="absolute left-1/2 -translate-x-1/2 bottom-14 px-3 py-1 rounded-full bg-black/45 text-white text-[11px] font-medium whitespace-nowrap pointer-events-none">
                        点空白处移动 · 点 pin 聊天
                    </div>
                    {/* 随便走走 */}
                    <button onClick={wander} className="absolute left-1/2 -translate-x-1/2 bottom-3 flex items-center gap-2 px-5 py-2.5 rounded-full bg-stone-900 text-white text-sm font-bold shadow-lg active:scale-95 transition-transform">
                        <Footprints size={17} weight="bold" /> 随便走走
                    </button>
                    {/* 同伴 / 定位 */}
                    <button onClick={() => setShowCompanionPick(true)} className="absolute right-2.5 top-2.5 w-10 h-10 rounded-full bg-white/95 shadow flex items-center justify-center active:scale-90" title="一起逛街">
                        {companion ? <img src={companion.avatar} className="w-7 h-7 rounded-full object-cover" /> : <UserPlus size={18} weight="bold" className="text-stone-500" />}
                    </button>
                    <button onClick={() => setState(s => ({ ...s, userX: 46, userY: 52 }))} className="absolute right-2.5 bottom-3 w-10 h-10 rounded-full bg-white/95 shadow flex items-center justify-center active:scale-90" title="回到中心">
                        <Crosshair size={18} weight="bold" className="text-stone-500" />
                    </button>
                </div>

                {/* Tab 条 */}
                <div className="flex items-center gap-1 mt-3 bg-stone-200/60 rounded-2xl p-1">
                    {TABS.map(({ id, label }) => (
                        <button
                            key={id}
                            onClick={() => setTab(id)}
                            className={`relative flex-1 py-2 rounded-xl text-[12px] font-bold transition-colors ${tab === id ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500'}`}
                        >
                            {label}
                            {id === 'msgs' && unreadCount > 0 && <span className="absolute top-1 right-2 w-1.5 h-1.5 rounded-full bg-red-500" />}
                            {id === 'dex' && dexCount > 0 && <span className="ml-1 text-[9px] text-stone-400">{dexCount}</span>}
                        </button>
                    ))}
                </div>

                {/* Tab 内容 */}
                <div className="mt-3">
                    {tab === 'stroll' && (
                        <div>
                            <div className="flex items-center justify-between mb-2 px-1">
                                <span className="text-sm font-bold text-stone-700">今日足迹</span>
                                <span className="text-[11px] text-stone-400">{state.footprints.length}</span>
                            </div>
                            {state.footprints.length === 0 ? (
                                <div className="text-center text-stone-400 text-xs py-10">还没有足迹 · 去街上走走、点点 pin 吧</div>
                            ) : (
                                <div className="space-y-2.5">
                                    {state.footprints.slice().reverse().map(fp => (
                                        <div key={fp.id} className="bg-white rounded-2xl p-3.5 shadow-sm">
                                            <div className="flex items-center justify-between">
                                                <span className="text-[11px] font-bold text-sky-600">{fp.choice ? '选择' : fp.tag}</span>
                                                <span className="text-[11px] text-stone-400">{fmtTime(fp.at)}</span>
                                            </div>
                                            <div className="flex items-center gap-1 mt-1.5 text-[11px] text-stone-400">
                                                <Sparkle size={11} weight="fill" /> {fp.tag}
                                            </div>
                                            <p className="text-[14px] font-bold text-stone-800 mt-1 leading-snug">{fp.title}</p>
                                            {fp.detail && <p className="text-[12px] text-stone-500 mt-0.5 leading-snug">{fp.detail}</p>}
                                            {fp.choice && <p className="text-[12px] text-stone-500 mt-1.5">已选：{fp.choice}</p>}
                                            {fp.place && <p className="flex items-center gap-1 text-[11px] text-sky-500 mt-1.5"><MapPin size={11} weight="fill" /> {fp.place}</p>}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {tab === 'nearby' && (
                        <div className="space-y-2">
                            {state.nearby.length === 0 ? (
                                <div className="text-center text-stone-400 text-xs py-10">附近暂时没人 · 点右上角刷新</div>
                            ) : state.nearby.map(p => (
                                <div key={p.id} className="flex items-center gap-3 bg-white rounded-2xl p-3 shadow-sm">
                                    <div className="w-11 h-11 rounded-full bg-stone-100 flex items-center justify-center text-xl overflow-hidden shrink-0">
                                        {p.avatar ? <img src={p.avatar} className="w-full h-full object-cover" /> : <span>{p.emoji}</span>}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-sm font-bold text-stone-800 truncate">{p.name}</span>
                                            <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${p.kind === 'known' ? 'bg-blue-50 text-blue-500' : 'bg-rose-50 text-rose-500'}`}>{p.kind === 'known' ? '熟人' : '陌生人'}</span>
                                        </div>
                                        <div className="text-[12px] text-stone-400 truncate">{p.blurb}</div>
                                    </div>
                                    <button onClick={() => chatWith(p)} className="px-3.5 py-2 rounded-full bg-stone-800 text-white text-[12px] font-bold active:scale-95 shrink-0">
                                        {p.kind === 'known' ? '去聊天' : '打招呼'}
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {tab === 'msgs' && (
                        <div className="space-y-2">
                            {state.threads.length === 0 ? (
                                <div className="text-center text-stone-400 text-xs py-10">还没有对话 · 在街上和陌生人搭句话吧</div>
                            ) : state.threads.slice().sort((a, b) => b.lastAt - a.lastAt).map(t => {
                                const last = t.msgs[t.msgs.length - 1];
                                return (
                                    <button key={t.personId} onClick={() => openThread(t)} className="w-full flex items-center gap-3 bg-white rounded-2xl p-3 shadow-sm text-left active:scale-[0.99]">
                                        <div className="relative w-11 h-11 rounded-full bg-stone-100 flex items-center justify-center text-xl overflow-hidden shrink-0">
                                            {t.avatar ? <img src={t.avatar} className="w-full h-full object-cover" /> : <span>{t.emoji}</span>}
                                            {t.unread && <span className="absolute top-0 right-0 w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-white" />}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm font-bold text-stone-800 truncate">{t.name}</span>
                                                <span className="text-[10px] text-stone-400">{fmtTime(t.lastAt)}</span>
                                            </div>
                                            <div className="text-[12px] text-stone-400 truncate">{last ? (last.role === 'user' ? '我：' : '') + last.text : '打个招呼吧'}</div>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    {tab === 'secret' && (
                        <div>
                            <button onClick={listenSecret} className="w-full mb-3 py-2.5 rounded-2xl bg-stone-900 text-white text-sm font-bold active:scale-95 flex items-center justify-center gap-2">
                                <Eye size={16} weight="bold" /> 打听街坊秘闻
                            </button>
                            {state.secrets.length === 0 ? (
                                <div className="text-center text-stone-400 text-xs py-8">这片街区还没什么风声…</div>
                            ) : (
                                <div className="space-y-2.5">
                                    {state.secrets.map(sc => (
                                        <div key={sc.id} className="bg-gradient-to-br from-violet-50 to-white rounded-2xl p-3.5 shadow-sm border border-violet-100">
                                            <div className="flex items-center gap-1 text-[11px] text-violet-500 font-bold mb-1"><Sparkle size={11} weight="fill" /> 秘闻</div>
                                            <p className="text-[13px] text-stone-700 leading-relaxed">{sc.text}</p>
                                            {sc.place && <p className="flex items-center gap-1 text-[11px] text-violet-400 mt-1.5"><MapPin size={11} weight="fill" /> {sc.place}</p>}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {tab === 'dex' && (
                        <div className="space-y-4">
                            <div>
                                <div className="text-sm font-bold text-stone-700 mb-2 flex items-center gap-1.5"><ChatCircleDots size={15} weight="bold" /> 遇见的人（{state.dexPeople.length}）</div>
                                {state.dexPeople.length === 0 ? (
                                    <div className="text-stone-400 text-xs py-3 text-center">和陌生人聊得来时，点「记入图鉴」收藏 TA</div>
                                ) : (
                                    <div className="grid grid-cols-3 gap-2">
                                        {state.dexPeople.map((d, i) => (
                                            <div key={i} className="bg-white rounded-2xl p-2.5 shadow-sm flex flex-col items-center text-center">
                                                <div className="w-10 h-10 rounded-full bg-stone-100 flex items-center justify-center text-lg">{d.emoji}</div>
                                                <div className="text-[11px] font-bold text-stone-700 mt-1 truncate w-full">{d.name}</div>
                                                <div className="text-[9px] text-stone-400 truncate w-full">{d.blurb}</div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div>
                                <div className="text-sm font-bold text-stone-700 mb-2 flex items-center gap-1.5"><Storefront size={15} weight="bold" /> 逛过的店（{state.dexShops.length}）</div>
                                {state.dexShops.length === 0 ? (
                                    <div className="text-stone-400 text-xs py-3 text-center">点地图上的店铺进去逛逛，会收进这里</div>
                                ) : (
                                    <div className="grid grid-cols-3 gap-2">
                                        {state.dexShops.map((d, i) => (
                                            <div key={i} className="bg-white rounded-2xl p-2.5 shadow-sm flex flex-col items-center text-center">
                                                <div className="w-10 h-10 rounded-full bg-stone-100 flex items-center justify-center text-lg">{d.emoji}</div>
                                                <div className="text-[11px] font-bold text-stone-700 mt-1 truncate w-full">{d.name}</div>
                                                <div className="text-[9px] text-stone-400 truncate w-full">{d.kind}</div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* 街头事件弹层 */}
            {state.activeEvent && (
                <div className="absolute inset-0 z-30 flex items-end justify-center bg-black/40 animate-fade-in" onClick={() => setState(s => ({ ...s, activeEvent: null, eventPlace: undefined }))}>
                    <div className="w-full max-w-md bg-white rounded-t-3xl p-5 pb-8 shadow-2xl animate-slide-up" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-2 mb-3">
                            <span className="text-2xl">{state.activeEvent.emoji}</span>
                            <span className="text-[11px] font-bold text-sky-600">街头事件</span>
                            {state.eventPlace && <span className="ml-auto flex items-center gap-1 text-[11px] text-sky-500"><MapPin size={11} weight="fill" /> {state.eventPlace}</span>}
                        </div>
                        <p className="text-[15px] font-bold text-stone-800 leading-snug">{state.activeEvent.title}</p>
                        {state.activeEvent.sub && <p className="text-[12px] text-stone-500 mt-1">{state.activeEvent.sub}</p>}
                        <div className="mt-4 space-y-2">
                            {state.activeEvent.choices.map((c, i) => (
                                <button key={i} onClick={() => resolveEvent(i)} className="w-full py-3 rounded-2xl bg-stone-100 text-stone-800 font-bold text-sm active:scale-95 transition-transform hover:bg-stone-200">
                                    {c.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* 选同伴 */}
            {showCompanionPick && (
                <div className="absolute inset-0 z-30 flex items-end justify-center bg-black/40 animate-fade-in" onClick={() => setShowCompanionPick(false)}>
                    <div className="w-full max-w-md bg-white rounded-t-3xl p-5 pb-8 shadow-2xl animate-slide-up" onClick={e => e.stopPropagation()}>
                        <div className="text-center mb-3">
                            <div className="text-base font-bold text-stone-800">找个角色一起逛街</div>
                            <div className="text-[11px] text-stone-400 mt-0.5">TA 会陪你出现在地图上，对沿途的事搭两句话</div>
                        </div>
                        {state.companionId && (
                            <button onClick={() => { setState(s => ({ ...s, companionId: undefined })); setShowCompanionPick(false); addToast('已解散同伴', 'info'); }} className="w-full mb-3 py-2.5 rounded-2xl bg-stone-100 text-stone-500 font-bold text-sm">独自逛逛</button>
                        )}
                        {characters.length === 0 ? (
                            <div className="text-center text-stone-400 text-xs py-6">还没有可邀请的角色</div>
                        ) : (
                            <div className="grid grid-cols-4 gap-3 max-h-[44vh] overflow-y-auto no-scrollbar">
                                {characters.map(c => (
                                    <button key={c.id} onClick={() => { setState(s => ({ ...s, companionId: c.id })); setShowCompanionPick(false); addToast(`${c.name} 来陪你逛街了`, 'success'); }} className={`flex flex-col items-center gap-1.5 ${state.companionId === c.id ? 'opacity-100' : ''}`}>
                                        <img src={c.avatar} className={`w-[52px] h-[52px] rounded-full object-cover ${state.companionId === c.id ? 'ring-2 ring-stone-800' : 'ring-1 ring-stone-100'}`} />
                                        <span className="text-[10px] text-stone-600 truncate w-full text-center">{c.name}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* 遭遇聊天 */}
            {activeThread && (
                <EncounterChat
                    thread={activeThread}
                    userName={userProfile.name}
                    userAvatar={userProfile.avatar}
                    isReplying={replyingThreadId === activeThread.personId}
                    onSend={text => sendInThread(activeThread.personId, text)}
                    onBack={() => setActiveThreadId(null)}
                    onCollect={() => collectPerson(activeThread.personId)}
                    collected={state.dexPeople.some(d => d.name === activeThread.name)}
                />
            )}
        </div>
    );
};

export default RoamView;
