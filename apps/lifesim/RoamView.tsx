/**
 * RoamView — 街角 · 出门逛逛
 *
 * 进去就在一张手绘街区地图上「闲逛」：点空白处移动、点 pin 和附近的人聊天、刷新换一批人，
 * 路上会冒出店铺和街头事件（今日足迹）。可以挑一个角色陪你一起逛街。陌生人也会主动来搭话。
 *
 * 设计取向：核心体验（地图/移动/遇见/事件/图鉴）有内置内容池，没配 API 也能玩；
 * 和陌生人/角色对话、街坊秘闻用 AI 生成（拿不到就回落到内置话术）。
 * 状态独立存 localStorage（moro_roam_v1），不动 LifeSimState，互不干扰。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { AppID, CharacterProfile } from '../../types';
import { extractContent } from '../../utils/safeApi';
import { resolveAuxApi } from '../../utils/auxApi';
import { makeApiUsageMeta } from '../../utils/apiUsageCatalog';
import { callChatCompletion } from '../../utils/llmClient';
import {
    X, ArrowClockwise, Crosshair, Footprints, MapPin, Sparkle,
    PaperPlaneRight, UserPlus, BookOpen, ChatCircleDots, Eye, Storefront,
} from '@phosphor-icons/react';
import StreetMap, { MapNode, MapPoint, MapRoute, mapDistanceLabel } from './StreetMap';

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

// 拼贴手账配色
const INK = '#2b2933';
const PAPER = '#f4f2ed';
const KNOWN = '#5b8fa8';
const STRANGER = '#b03a34';

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

/** 字母头像兜底（同 OSContext.generateAvatar 风格），给没有头像的街角 NPC 用。 */
function roamAvatar(seed: string): string {
    const colors = ['FF9AA2', 'FFB7B2', 'FFDAC1', 'E2F0CB', 'B5EAD7', 'C7CEEA', 'e2e8f0', 'fcd34d', 'fca5a5'];
    const s = (seed || '?').trim() || '?';
    const color = colors[(s.charCodeAt(0) || 0) % colors.length];
    const letter = s.charAt(0).toUpperCase();
    return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23${color}"/><text x="50" y="55" font-family="sans-serif" font-weight="bold" font-size="50" text-anchor="middle" dy=".3em" fill="white" opacity="0.9">${letter}</text></svg>`;
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

interface Api { baseUrl: string; apiKey?: string; model: string; apiRole?: string; apiBinding?: string; }
const apiReady = (a?: Api) => !!(a?.baseUrl && a?.model);

async function roamChatAI(api: Api, system: string, history: RoamMsg[]): Promise<string | null> {
    if (!apiReady(api)) return null;
    try {
        const messages = [
            { role: 'system', content: system },
            ...history.slice(-12).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text })),
        ];
        const data = await callChatCompletion(api, {
            model: api.model,
            messages,
            temperature: 0.9,
            max_tokens: 600,
            stream: false,
        }, {
            timeoutMs: 30000,
            meta: makeApiUsageMeta('date.reply', { apiRole: api.apiRole || 'aux', apiBinding: api.apiBinding || '街角漫游街头对话' }),
        });
        const txt = (extractContent(data) || '').trim();
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
    onAddToContacts: () => void;
    inContacts: boolean;
}> = ({ thread, userName, userAvatar, onSend, isReplying, onBack, onCollect, collected, onAddToContacts, inContacts }) => {
    const [draft, setDraft] = useState('');
    const endRef = useRef<HTMLDivElement>(null);
    useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [thread.msgs.length, isReplying]);
    const submit = () => { const t = draft.trim(); if (!t) return; setDraft(''); onSend(t); };
    return (
        <div className="absolute inset-0 z-30 flex flex-col" style={{ background: PAPER }}>
            <div className="flex items-center gap-2 px-3 py-2.5 shrink-0" style={{ borderBottom: '1px dashed rgba(167,162,151,0.5)', background: 'rgba(251,250,247,0.85)' }}>
                <button onClick={onBack} className="scrap-btn-paper flex items-center justify-center" style={{ width: 32, height: 32 }}><X size={15} weight="bold" /></button>
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-lg overflow-hidden" style={{ background: '#fbfaf7', outline: '1px dashed rgba(167,162,151,0.5)', outlineOffset: -2 }}>
                    {thread.avatar ? <img src={thread.avatar} className="w-full h-full object-cover" /> : <span>{thread.emoji}</span>}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="font-hand truncate" style={{ fontSize: 16, fontWeight: 700, color: INK }}>{thread.name}</div>
                    <div className="font-hand" style={{ fontSize: 11, color: '#a79c8e' }}>{thread.kind === 'stranger' ? '萍水相逢' : '熟人'}</div>
                </div>
                {/* 加进往来：把这个街角偶遇的人变成可在名册里编辑人设的真实角色 */}
                {thread.kind !== 'known' && (
                    <button onClick={onAddToContacts} disabled={inContacts} className="flex items-center gap-1 px-2.5 py-1.5 rounded-full font-hand mr-1"
                        style={{
                            fontSize: 12, fontWeight: 700,
                            background: inContacts ? 'rgba(120,116,106,0.12)' : 'rgba(60,110,90,0.1)',
                            color: inContacts ? '#a79c8e' : '#3c6e5a',
                            border: `1px dashed ${inContacts ? 'rgba(167,162,151,0.5)' : 'rgba(60,110,90,0.4)'}`,
                        }}>
                        {inContacts ? '已在往来' : '加进往来'}
                    </button>
                )}
                {thread.kind === 'stranger' && (
                    <button onClick={onCollect} disabled={collected} className="flex items-center gap-1 px-2.5 py-1.5 rounded-full font-hand"
                        style={{
                            fontSize: 12, fontWeight: 700,
                            background: collected ? 'rgba(120,116,106,0.12)' : 'rgba(176,58,52,0.1)',
                            color: collected ? '#a79c8e' : STRANGER,
                            border: `1px dashed ${collected ? 'rgba(167,162,151,0.5)' : 'rgba(176,58,52,0.4)'}`,
                        }}>
                        <BookOpen size={13} weight="bold" /> {collected ? '已收录' : '记入图鉴'}
                    </button>
                )}
            </div>
            <div className="flex-1 overflow-y-auto no-scrollbar px-3 py-4 space-y-3 scrap-panel">
                {thread.msgs.length === 0 && (
                    <div className="text-center font-hand py-8" style={{ fontSize: 13, color: '#a79c8e' }}>你们刚刚在街上相遇 · 说点什么吧 ✎</div>
                )}
                {thread.msgs.map(m => (
                    <div key={m.id} className={`flex items-end gap-2 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-sm overflow-hidden shrink-0" style={{ background: '#fbfaf7', outline: '1px dashed rgba(167,162,151,0.5)', outlineOffset: -2 }}>
                            {m.role === 'user'
                                ? (userAvatar ? <img src={userAvatar} className="w-full h-full object-cover" /> : <span>🙂</span>)
                                : (thread.avatar ? <img src={thread.avatar} className="w-full h-full object-cover" /> : <span>{thread.emoji}</span>)}
                        </div>
                        <div className="max-w-[72%] px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap"
                            style={m.role === 'user'
                                ? { background: INK, color: '#fbfaf7', borderRadius: '16px 16px 4px 16px' }
                                : { background: '#fff', color: INK, borderRadius: '16px 16px 16px 4px', border: '1px solid rgba(236,233,226,0.95)', boxShadow: '0 4px 10px -8px rgba(50,48,60,0.4)' }}>
                            {m.text}
                        </div>
                    </div>
                ))}
                {isReplying && <div className="flex items-center gap-1.5 pl-9 font-hand animate-pulse" style={{ fontSize: 12, color: '#a79c8e' }}><span>对方正在回复</span><span className="tracking-widest">···</span></div>}
                <div ref={endRef} />
            </div>
            <div className="shrink-0 p-2.5 flex items-center gap-2" style={{ borderTop: '1px dashed rgba(167,162,151,0.5)', background: 'rgba(251,250,247,0.85)', paddingBottom: 'max(10px, env(safe-area-inset-bottom, 10px))' }}>
                <input
                    value={draft} onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') submit(); }}
                    placeholder={`和 ${thread.name} 说点什么…`}
                    className="flex-1 px-3.5 py-2.5 text-[13px] outline-none font-hand"
                    style={{ borderRadius: 999, background: '#fbfaf7', border: '1px solid rgba(236,233,226,0.95)', color: INK }}
                />
                <button onClick={submit} disabled={isReplying || !draft.trim()} className="w-10 h-10 rounded-full flex items-center justify-center disabled:opacity-40 active:scale-95" style={{ background: INK, color: '#fbfaf7' }}>
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
    const { apiConfig, auxApiConfig, characters, userProfile, setActiveCharacterId, openApp, addToast, importCharacter } = useOS();
    // 街角·出门逛逛属「聊天以外」的功能：走副 API（未配置副 API 时回退主 API）
    const api = { ...apiConfig, ...resolveAuxApi(auxApiConfig, apiConfig) } as unknown as Api;

    // 把街角偶遇的人「加进往来」：用其人设造一个真实角色（addedToChat→直接进往来），
    // 之后可在名册里改 TA 的人设。已有同名/同 id 角色则直接进聊天。
    const roamCharId = (personId: string) => `roam-${personId}`;
    const addPersonToContacts = async (thread: RoamThread) => {
        if (thread.kind === 'known') { addToast('TA 已经在你的往来里了', 'info'); return; }
        const id = roamCharId(thread.personId);
        if (characters.some(c => c.id === id)) {
            addToast(`${thread.name} 已在往来里`, 'info');
            setActiveCharacterId(id); openApp(AppID.Chat);
            return;
        }
        const newChar: CharacterProfile = {
            id, name: thread.name,
            avatar: thread.avatar || roamAvatar(thread.name),
            description: (thread.persona || thread.emoji + ' 在街角偶遇的人').trim(),
            systemPrompt: '',
            memories: [],
            contextLimit: 500,
            addedToChat: true,
            emotionConfig: { enabled: true },
        } as CharacterProfile;
        try {
            await importCharacter(newChar);
            addToast(`已把 ${thread.name} 加进往来，可在名册里改 TA 的人设`, 'success');
        } catch { addToast('加入往来失败，再试试', 'error'); }
    };

    // 按世界观生成一个街角 NPC（可单方面认识已有角色），落到附近并直接开聊
    async function spawnWorldviewNpc() {
        const wv = worldviewText.trim();
        if (!wv) { addToast('先写两句世界观吧（也可粘贴角色卡/世界书设定）', 'info'); return; }
        if (!apiReady(api)) { addToast('还没配置 API，去「文具盒」填好再来', 'error'); return; }
        setGenBusy(true);
        try {
            const charNames = characters.map(c => c.name).filter(Boolean).slice(0, 14);
            const sys = '你是为「街角漫游」造路人 NPC 的设定师。根据给定世界观，造一个贴合该世界、有血有肉的人。'
                + '只输出一个 JSON 对象：{"name":"中文名/称呼","emoji":"一个emoji","blurb":"一句话街头印象(不超过20字)","persona":"2~4句人物小传：身份、性格、说话风格","knows":["可空；从给的角色名里挑0~2个该NPC单方面认识的人"]}。不要任何多余文字、不要代码块。';
            const user = `世界观设定：\n${wv}\n\n`
                + (charNames.length ? `这个世界里已经存在这些人（该 NPC 可能「单方面认识」其中 0~2 个——TA 知道对方、对方却不认识 TA）：${charNames.join('、')}\n\n` : '')
                + '请生成一个会出现在这个世界街头的路人 NPC。';
            const data = await callChatCompletion(api, {
                model: api.model,
                messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
                temperature: 0.95,
                max_tokens: 600,
                stream: false,
            }, {
                timeoutMs: 30000,
                meta: makeApiUsageMeta('date.worldEngine', { apiRole: api.apiRole || 'aux', apiBinding: api.apiBinding || '街角漫游世界观 NPC 生成' }),
            });
            const raw: string = extractContent(data) || '';
            let obj: any = null;
            try { obj = JSON.parse(raw.replace(/```(?:json)?/gi, '').trim()); }
            catch { const a = raw.indexOf('{'), b = raw.lastIndexOf('}'); if (a >= 0 && b > a) { try { obj = JSON.parse(raw.slice(a, b + 1)); } catch { /* ignore */ } } }
            if (!obj?.name) throw new Error('生成结果无效，换个说法再试');
            const knows: string[] = Array.isArray(obj.knows) ? obj.knows.filter((n: any) => typeof n === 'string' && n.trim()) : [];
            const knowsLine = knows.length ? `\n（单方面认识：${knows.join('、')}——TA 知道这些人，但这些人未必认识 TA。）` : '';
            const person: RoamPerson = {
                id: 'wv-' + genId(), kind: 'stranger',
                name: String(obj.name).slice(0, 20), emoji: String(obj.emoji || '🙂').slice(0, 4),
                blurb: String(obj.blurb || '世界里的路人').slice(0, 30),
                persona: `${String(obj.persona || '').slice(0, 400)}${knowsLine}\n（出自世界观：${wv.slice(0, 120)}）`,
                x: rnd(12, 88), y: rnd(14, 80),
            };
            const opener = pick(['（注意到你）哦？新面孔。', '…你也是这个世界里的人吧。', '嗯，看你眼生。要聊两句吗？', '欸，你这个气场……有点意思。']);
            const thread: RoamThread = { personId: person.id, name: person.name, emoji: person.emoji, avatar: person.avatar, kind: 'stranger', persona: person.persona, msgs: [{ id: genId(), role: 'them', text: opener, at: Date.now() }], lastAt: Date.now(), unread: false };
            setState(s => ({ ...s, nearby: [person, ...s.nearby], threads: [thread, ...s.threads.filter(t => t.personId !== person.id)] }));
            setShowWorldviewGen(false);
            setActiveThreadId(person.id);
            addToast(`${person.name} 出现在了街角`, 'success');
        } catch (e: any) {
            addToast('招人失败：' + (e?.message || e), 'error');
        } finally { setGenBusy(false); }
    }

    const [state, setState] = useState<RoamState>(() => loadRoam() || freshState());
    const [tab, setTab] = useState<TabId>('stroll');
    const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
    const [replyingThreadId, setReplyingThreadId] = useState<string | null>(null);
    const [showCompanionPick, setShowCompanionPick] = useState(false);
    // 世界观招人：按用户写的世界观（或角色卡设定）生成一个贴合该世界的街角 NPC
    const [showWorldviewGen, setShowWorldviewGen] = useState(false);
    const [worldviewText, setWorldviewText] = useState('');
    const [genBusy, setGenBusy] = useState(false);
    const [selectedMapNodeId, setSelectedMapNodeId] = useState<string | null>(null);

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
    const onMapTap = (point: MapPoint) => {
        setSelectedMapNodeId(null);
        const x = Math.max(4, Math.min(96, point.x));
        const y = Math.max(6, Math.min(92, point.y));
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
    const userMapNode: MapNode = {
        id: 'roam-user',
        kind: 'user',
        label: userProfile.name || '我',
        sublabel: companion ? `和 ${companion.name} 一起` : '当前位置',
        avatar: userProfile.avatar,
        x: state.userX,
        y: state.userY,
        color: '#2563eb',
        badge: '我',
        active: true,
    };
    const shopNodes: MapNode[] = state.shops.map(shop => ({
        id: `shop-${shop.id}`,
        kind: 'shop',
        label: shop.name,
        sublabel: shop.kind,
        emoji: shop.emoji,
        x: shop.x,
        y: shop.y,
        color: '#0f8a6b',
    }));
    const personNodes: MapNode[] = state.nearby.map(person => ({
        id: `person-${person.id}`,
        kind: 'person',
        label: person.name,
        sublabel: person.blurb,
        emoji: person.kind === 'known' ? undefined : person.emoji,
        avatar: person.avatar,
        x: person.x,
        y: person.y,
        color: person.kind === 'known' ? KNOWN : STRANGER,
        badge: person.kind === 'known' ? '熟' : undefined,
    }));
    const eventNode: MapNode[] = state.activeEvent ? [{
        id: `event-${state.activeEvent.id}`,
        kind: 'event',
        label: state.activeEvent.title,
        sublabel: state.eventPlace || '街头事件',
        emoji: state.activeEvent.emoji,
        x: Math.min(92, state.userX + 13),
        y: Math.max(12, state.userY - 12),
        color: '#d97706',
        badge: '事件',
        active: true,
    }] : [];
    const mapNodes = [...shopNodes, ...personNodes, ...eventNode];
    const selectedMapNode = selectedMapNodeId ? mapNodes.find(node => node.id === selectedMapNodeId) || null : null;
    const selectedRoute: MapRoute[] = selectedMapNode ? [{
        id: `roam-route-${selectedMapNode.id}`,
        from: userMapNode,
        to: selectedMapNode,
        label: mapDistanceLabel(userMapNode, selectedMapNode),
        color: selectedMapNode.color,
        dashed: true,
    }] : [];

    // ── 渲染 ──
    return (
        <div className="absolute inset-0 z-20 flex min-h-0 flex-col" style={{ background: PAPER, color: INK, backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(120,116,106,0.05) 1px, transparent 0)', backgroundSize: '16px 16px' }}>
            <style>{`
                .roam-fade { animation: fadeIn 0.25s ease; }
                .roam-sheet { animation: slideUp 0.3s cubic-bezier(0.25,1,0.5,1); }
                .roam-map-control {
                    width: 38px;
                    height: 38px;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: 999px;
                    border: 1px solid rgba(226,232,240,0.96);
                    background: rgba(255,255,255,0.92);
                    color: #172033;
                    box-shadow: 0 12px 24px -22px rgba(15,23,42,0.8);
                }
                .roam-wander-button {
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    border: 0;
                    border-radius: 999px;
                    padding: 10px 18px;
                    background: #172033;
                    color: #fff;
                    font-size: 14px;
                    font-weight: 900;
                    box-shadow: 0 18px 34px -24px rgba(15,23,42,0.85);
                }
            `}</style>
            {/* 顶栏 */}
            <div className="flex items-center px-3 py-3 shrink-0 relative">
                <button onClick={onClose} className="scrap-btn-paper flex items-center justify-center" style={{ width: 38, height: 38 }}><X size={18} weight="bold" /></button>
                <h1 className="flex-1 text-center font-hand" style={{ fontSize: 24, fontWeight: 700, color: INK }}>出门逛逛</h1>
                <button onClick={() => setShowWorldviewGen(true)} className="scrap-btn-paper flex items-center justify-center mr-2" style={{ width: 38, height: 38 }} title="按世界观招一个人"><Sparkle size={17} weight="bold" /></button>
                <button onClick={() => refresh(false)} className="scrap-btn-paper flex items-center justify-center" style={{ width: 38, height: 38 }}><ArrowClockwise size={17} weight="bold" /></button>
                <div className="lace-edge absolute left-0 right-0" style={{ bottom: -9 }} />
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar px-3 pb-4 pt-2">
                <StreetMap
                    nodes={mapNodes}
                    user={userMapNode}
                    routes={selectedRoute}
                    selectedNodeId={selectedMapNodeId}
                    height={320}
                    title={state.street}
                    subtitle={selectedMapNode ? `${selectedMapNode.label} · ${selectedMapNode.sublabel || '附近'}` : '点空白处移动 · 点 pin 进店或聊天'}
                    onCanvasClick={onMapTap}
                    onNodeClick={(node, event) => {
                        event.stopPropagation();
                        setSelectedMapNodeId(node.id);
                        if (node.id.startsWith('shop-')) {
                            const shop = state.shops.find(item => `shop-${item.id}` === node.id);
                            if (shop) visitShop(shop);
                        } else if (node.id.startsWith('person-')) {
                            const person = state.nearby.find(item => `person-${item.id}` === node.id);
                            if (person) chatWith(person);
                        }
                    }}
                    topRight={
                        <div className="flex gap-2">
                            <button onClick={(event) => { event.stopPropagation(); setShowCompanionPick(true); }} className="roam-map-control" title="一起逛街">
                                {companion ? <img src={companion.avatar} className="w-6 h-6 rounded-full object-cover" /> : <UserPlus size={17} weight="bold" />}
                            </button>
                            <button onClick={(event) => { event.stopPropagation(); setState(s => ({ ...s, userX: 46, userY: 52 })); setSelectedMapNodeId(null); }} className="roam-map-control" title="回到中心">
                                <Crosshair size={17} weight="bold" />
                            </button>
                        </div>
                    }
                    bottomCenter={
                        <button onClick={(event) => { event.stopPropagation(); wander(); }} className="roam-wander-button">
                            <Footprints size={17} weight="bold" /> 随便走走
                        </button>
                    }
                />

                {/* Tab 条 */}
                <div className="flex items-center gap-1 mt-3 p-1 rounded-2xl" style={{ background: 'rgba(120,116,106,0.1)' }}>
                    {TABS.map(({ id, label }) => {
                        const active = tab === id;
                        return (
                            <button key={id} onClick={() => setTab(id)} className="relative flex-1 py-2 rounded-xl font-hand transition-colors"
                                style={{ fontSize: 13, fontWeight: 700, color: active ? '#fbfaf7' : '#8b8996', background: active ? INK : 'transparent' }}>
                                {label}
                                {id === 'msgs' && unreadCount > 0 && <span className="absolute top-1 right-2 w-1.5 h-1.5 rounded-full" style={{ background: STRANGER }} />}
                                {id === 'dex' && dexCount > 0 && <span className="ml-1 label-mono" style={{ fontSize: 8, color: active ? 'rgba(255,255,255,0.6)' : '#a79c8e' }}>{dexCount}</span>}
                            </button>
                        );
                    })}
                </div>

                {/* Tab 内容 */}
                <div className="mt-3">
                    {tab === 'stroll' && (
                        <div>
                            <div className="drawer-tag mb-2.5"><span>今日足迹</span><span className="label-mono ml-1" style={{ fontSize: 9, color: '#a79c8e', letterSpacing: '0.1em' }}>{state.footprints.length}</span></div>
                            {state.footprints.length === 0 ? (
                                <div className="text-center font-hand py-10" style={{ fontSize: 13, color: '#a79c8e' }}>还没有足迹 · 去街上走走、点点 pin 吧 ✎</div>
                            ) : (
                                <div className="space-y-2.5 scrap-list">
                                    {state.footprints.slice().reverse().map(fp => (
                                        <div key={fp.id} className="scrap-card relative" style={{ borderRadius: 12, padding: 13 }}>
                                            <div className="flex items-center justify-between">
                                                <span className="font-hand" style={{ fontSize: 12, fontWeight: 700, color: KNOWN }}>{fp.choice ? '选择' : fp.tag}</span>
                                                <span className="label-mono" style={{ fontSize: 9, color: '#bcb5a8' }}>{fmtTime(fp.at)}</span>
                                            </div>
                                            <div className="flex items-center gap-1 mt-1 font-hand" style={{ fontSize: 11, color: '#a79c8e' }}>
                                                <Sparkle size={11} weight="fill" /> {fp.tag}
                                            </div>
                                            <p className="font-hand mt-1 leading-snug" style={{ fontSize: 15, fontWeight: 700, color: INK }}>{fp.title}</p>
                                            {fp.detail && <p className="mt-0.5 leading-snug" style={{ fontSize: 12, color: '#6b665d' }}>{fp.detail}</p>}
                                            {fp.choice && <p className="font-hand mt-1.5" style={{ fontSize: 12, color: '#6b665d' }}>已选：{fp.choice}</p>}
                                            {fp.place && <p className="flex items-center gap-1 mt-1.5 font-hand" style={{ fontSize: 11, color: KNOWN }}><MapPin size={11} weight="fill" /> {fp.place}</p>}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {tab === 'nearby' && (
                        <div className="space-y-2 scrap-list">
                            {state.nearby.length === 0 ? (
                                <div className="text-center font-hand py-10" style={{ fontSize: 13, color: '#a79c8e' }}>附近暂时没人 · 点右上角刷新</div>
                            ) : state.nearby.map(p => (
                                <div key={p.id} className="scrap-card flex items-center gap-3" style={{ borderRadius: 12, padding: 11 }}>
                                    <div className="w-11 h-11 rounded-full flex items-center justify-center text-xl overflow-hidden shrink-0" style={{ background: '#fbfaf7', outline: '1px dashed rgba(167,162,151,0.5)', outlineOffset: -2 }}>
                                        {p.avatar ? <img src={p.avatar} className="w-full h-full object-cover" /> : <span>{p.emoji}</span>}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5">
                                            <span className="font-hand truncate" style={{ fontSize: 15, fontWeight: 700, color: INK }}>{p.name}</span>
                                            <span className="px-1.5 py-0.5 rounded-full" style={{ fontSize: 9, fontWeight: 700, background: p.kind === 'known' ? 'rgba(91,143,168,0.12)' : 'rgba(176,58,52,0.1)', color: p.kind === 'known' ? KNOWN : STRANGER }}>{p.kind === 'known' ? '熟人' : '陌生人'}</span>
                                        </div>
                                        <div className="font-hand truncate" style={{ fontSize: 12, color: '#a79c8e' }}>{p.blurb}</div>
                                    </div>
                                    <button onClick={() => chatWith(p)} className="scrap-btn font-hand shrink-0" style={{ padding: '7px 14px', fontSize: 12, fontWeight: 700 }}>
                                        {p.kind === 'known' ? '去聊天' : '打招呼'}
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {tab === 'msgs' && (
                        <div className="space-y-2 scrap-list">
                            {state.threads.length === 0 ? (
                                <div className="text-center font-hand py-10" style={{ fontSize: 13, color: '#a79c8e' }}>还没有对话 · 在街上和陌生人搭句话吧</div>
                            ) : state.threads.slice().sort((a, b) => b.lastAt - a.lastAt).map(t => {
                                const last = t.msgs[t.msgs.length - 1];
                                return (
                                    <button key={t.personId} onClick={() => openThread(t)} className="scrap-card press-soft w-full flex items-center gap-3 text-left" style={{ borderRadius: 12, padding: 11 }}>
                                        <div className="relative w-11 h-11 rounded-full flex items-center justify-center text-xl overflow-hidden shrink-0" style={{ background: '#fbfaf7', outline: '1px dashed rgba(167,162,151,0.5)', outlineOffset: -2 }}>
                                            {t.avatar ? <img src={t.avatar} className="w-full h-full object-cover" /> : <span>{t.emoji}</span>}
                                            {t.unread && <span className="absolute top-0 right-0 w-2.5 h-2.5 rounded-full ring-2 ring-white" style={{ background: STRANGER }} />}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between">
                                                <span className="font-hand truncate" style={{ fontSize: 15, fontWeight: 700, color: INK }}>{t.name}</span>
                                                <span className="label-mono" style={{ fontSize: 9, color: '#bcb5a8' }}>{fmtTime(t.lastAt)}</span>
                                            </div>
                                            <div className="truncate" style={{ fontSize: 12, color: '#a79c8e' }}>{last ? (last.role === 'user' ? '我：' : '') + last.text : '打个招呼吧'}</div>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    {tab === 'secret' && (
                        <div>
                            <button onClick={listenSecret} className="scrap-btn w-full mb-3 py-2.5 font-hand flex items-center justify-center gap-2" style={{ fontSize: 14, fontWeight: 700 }}>
                                <Eye size={16} weight="bold" /> 打听街坊秘闻
                            </button>
                            {state.secrets.length === 0 ? (
                                <div className="text-center font-hand py-8" style={{ fontSize: 13, color: '#a79c8e' }}>这片街区还没什么风声…</div>
                            ) : (
                                <div className="space-y-2.5 scrap-list">
                                    {state.secrets.map(sc => (
                                        <div key={sc.id} className="scrap-card relative" style={{ borderRadius: 12, padding: 13, borderLeft: '4px solid #9b5bb8' }}>
                                            <div className="flex items-center gap-1 font-hand mb-1" style={{ fontSize: 12, color: '#9b5bb8', fontWeight: 700 }}><Sparkle size={11} weight="fill" /> 秘闻</div>
                                            <p className="leading-relaxed" style={{ fontSize: 13, color: '#5c574f' }}>{sc.text}</p>
                                            {sc.place && <p className="flex items-center gap-1 font-hand mt-1.5" style={{ fontSize: 11, color: '#9b5bb8' }}><MapPin size={11} weight="fill" /> {sc.place}</p>}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {tab === 'dex' && (
                        <div className="space-y-4">
                            <div>
                                <div className="drawer-tag mb-2"><span>遇见的人</span><span className="label-mono ml-1" style={{ fontSize: 9, color: '#a79c8e' }}>{state.dexPeople.length}</span></div>
                                {state.dexPeople.length === 0 ? (
                                    <div className="font-hand py-3 text-center" style={{ fontSize: 12, color: '#a79c8e' }}>和陌生人聊得来时，点「记入图鉴」收藏 TA</div>
                                ) : (
                                    <div className="grid grid-cols-3 gap-2">
                                        {state.dexPeople.map((d, i) => (
                                            <div key={i} className="scrap-card flex flex-col items-center text-center" style={{ borderRadius: 12, padding: 10, rotate: i % 2 ? '1deg' : '-1deg' }}>
                                                <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg" style={{ background: '#fbfaf7', outline: '1px dashed rgba(167,162,151,0.5)', outlineOffset: -2 }}>{d.emoji}</div>
                                                <div className="font-hand mt-1 truncate w-full" style={{ fontSize: 12, fontWeight: 700, color: '#5c574f' }}>{d.name}</div>
                                                <div className="truncate w-full" style={{ fontSize: 9, color: '#a79c8e' }}>{d.blurb}</div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div>
                                <div className="drawer-tag mb-2"><span>逛过的店</span><span className="label-mono ml-1" style={{ fontSize: 9, color: '#a79c8e' }}>{state.dexShops.length}</span></div>
                                {state.dexShops.length === 0 ? (
                                    <div className="font-hand py-3 text-center" style={{ fontSize: 12, color: '#a79c8e' }}>点地图上的店铺进去逛逛，会收进这里</div>
                                ) : (
                                    <div className="grid grid-cols-3 gap-2">
                                        {state.dexShops.map((d, i) => (
                                            <div key={i} className="scrap-card flex flex-col items-center text-center" style={{ borderRadius: 12, padding: 10, rotate: i % 2 ? '-1deg' : '1deg' }}>
                                                <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg" style={{ background: '#fbfaf7', outline: '1px dashed rgba(167,162,151,0.5)', outlineOffset: -2 }}>{d.emoji}</div>
                                                <div className="font-hand mt-1 truncate w-full" style={{ fontSize: 12, fontWeight: 700, color: '#5c574f' }}>{d.name}</div>
                                                <div className="truncate w-full" style={{ fontSize: 9, color: '#a79c8e' }}>{d.kind}</div>
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
                <div className="absolute inset-0 z-30 flex items-end justify-center roam-fade" style={{ background: 'rgba(43,41,51,0.4)' }} onClick={() => setState(s => ({ ...s, activeEvent: null, eventPlace: undefined }))}>
                    <div className="roam-sheet scrap-card w-full max-w-md p-5 pb-8 relative" onClick={e => e.stopPropagation()} style={{ borderRadius: '24px 24px 0 0' }}>
                        <span style={{ position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%) rotate(-2deg)', width: 110, height: 18, background: 'rgba(120,180,210,0.4)', borderLeft: '1px dashed rgba(160,156,146,0.5)', borderRight: '1px dashed rgba(160,156,146,0.5)', pointerEvents: 'none' }} />
                        <div className="flex items-center gap-2 mb-3">
                            <span className="text-2xl">{state.activeEvent.emoji}</span>
                            <span className="font-hand" style={{ fontSize: 13, fontWeight: 700, color: KNOWN }}>街头事件</span>
                            {state.eventPlace && <span className="ml-auto flex items-center gap-1 font-hand" style={{ fontSize: 11, color: KNOWN }}><MapPin size={11} weight="fill" /> {state.eventPlace}</span>}
                        </div>
                        <p className="font-hand leading-snug" style={{ fontSize: 16, fontWeight: 700, color: INK }}>{state.activeEvent.title}</p>
                        {state.activeEvent.sub && <p className="mt-1" style={{ fontSize: 12, color: '#6b665d' }}>{state.activeEvent.sub}</p>}
                        <div className="mt-4 space-y-2">
                            {state.activeEvent.choices.map((c, i) => (
                                <button key={i} onClick={() => resolveEvent(i)} className="scrap-btn-paper press-soft w-full py-3 font-hand" style={{ fontSize: 14, fontWeight: 700 }}>
                                    {c.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* 选同伴 */}
            {showCompanionPick && (
                <div className="absolute inset-0 z-30 flex items-end justify-center roam-fade" style={{ background: 'rgba(43,41,51,0.4)' }} onClick={() => setShowCompanionPick(false)}>
                    <div className="roam-sheet scrap-card w-full max-w-md p-5 pb-8 relative" onClick={e => e.stopPropagation()} style={{ borderRadius: '24px 24px 0 0' }}>
                        <span style={{ position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%) rotate(-2deg)', width: 110, height: 18, background: 'rgba(255,255,255,0.6)', borderLeft: '1px dashed rgba(160,156,146,0.5)', borderRight: '1px dashed rgba(160,156,146,0.5)', pointerEvents: 'none' }} />
                        <div className="text-center mb-3">
                            <div className="font-hand" style={{ fontSize: 18, fontWeight: 700, color: INK }}>找个角色一起逛街</div>
                            <div className="font-hand mt-0.5" style={{ fontSize: 12, color: '#a79c8e' }}>TA 会陪你出现在地图上，对沿途的事搭两句话</div>
                        </div>
                        {state.companionId && (
                            <button onClick={() => { setState(s => ({ ...s, companionId: undefined })); setShowCompanionPick(false); addToast('已解散同伴', 'info'); }} className="scrap-btn-paper w-full mb-3 py-2.5 font-hand" style={{ fontSize: 14, fontWeight: 700, color: '#a79c8e' }}>独自逛逛</button>
                        )}
                        {characters.length === 0 ? (
                            <div className="text-center font-hand py-6" style={{ fontSize: 13, color: '#a79c8e' }}>还没有可邀请的角色</div>
                        ) : (
                            <div className="grid grid-cols-4 gap-3 max-h-[44vh] overflow-y-auto no-scrollbar">
                                {characters.map(c => (
                                    <button key={c.id} onClick={() => { setState(s => ({ ...s, companionId: c.id })); setShowCompanionPick(false); addToast(`${c.name} 来陪你逛街了`, 'success'); }} className="flex flex-col items-center gap-1.5">
                                        <img src={c.avatar} className="w-[52px] h-[52px] rounded-full object-cover" style={{ boxShadow: state.companionId === c.id ? `0 0 0 2px ${INK}` : '0 0 0 1px rgba(236,233,226,0.95)' }} />
                                        <span className="font-hand truncate w-full text-center" style={{ fontSize: 11, color: '#5c574f' }}>{c.name}</span>
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
                    onAddToContacts={() => addPersonToContacts(activeThread)}
                    inContacts={characters.some(c => c.id === roamCharId(activeThread.personId))}
                />
            )}

            {/* 世界观招人：按世界观/角色卡设定生成一个贴合该世界的街角 NPC */}
            {showWorldviewGen && (
                <div className="absolute inset-0 z-40 flex items-end justify-center" style={{ background: 'rgba(40,36,30,0.45)' }} onClick={() => !genBusy && setShowWorldviewGen(false)}>
                    <div className="roam-sheet w-full max-w-md rounded-t-[22px] p-4 pb-6" style={{ background: PAPER }} onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-2 mb-1">
                            <Sparkle size={18} weight="bold" color={INK} />
                            <div className="font-hand" style={{ fontSize: 17, fontWeight: 700, color: INK }}>按世界观招个人</div>
                        </div>
                        <div className="font-hand mb-2" style={{ fontSize: 12, color: '#a79c8e' }}>
                            写下（或粘贴）一段世界观/设定，系统会造一个贴合这个世界的路人。TA 可能单方面认识你已有的某个角色。
                        </div>
                        <textarea
                            value={worldviewText}
                            onChange={e => setWorldviewText(e.target.value)}
                            rows={5}
                            placeholder="例：这是一座永远在下雨的蒸汽都市，街上有靠贩卖记忆为生的人……"
                            className="w-full p-3 text-sm outline-none resize-none font-hand"
                            style={{ background: '#fbfaf7', border: '1px dashed rgba(167,162,151,0.6)', color: INK }}
                        />
                        <div className="flex gap-2 mt-3">
                            <button onClick={() => setShowWorldviewGen(false)} disabled={genBusy} className="scrap-btn-paper flex-1 py-2.5 font-hand" style={{ fontSize: 14, fontWeight: 700, color: '#a79c8e' }}>再想想</button>
                            <button onClick={() => void spawnWorldviewNpc()} disabled={genBusy} className="flex-1 py-2.5 font-hand rounded-xl" style={{ fontSize: 14, fontWeight: 700, color: '#f4f1e8', background: INK, opacity: genBusy ? 0.6 : 1 }}>
                                {genBusy ? '正在招人…' : '招一个'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default RoamView;
