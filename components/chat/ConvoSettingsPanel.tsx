import React, { useMemo, useRef, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { CharacterProfile, ConvoSettings, EmojiCategory, AppID } from '../../types';
import { processImage } from '../../utils/file';
import { RINGTONE_PRESETS, playRingtone } from '../../utils/ringtone';
import { fetchMiniMaxVoices, MiniMaxVoiceItem } from '../../utils/minimaxVoice';
import { resolveMiniMaxApiKey } from '../../utils/minimaxApiKey';
import { isCharBlockDisabled, setCharBlockDisabled } from '../../utils/blockSystem';
import {
    PAPER_TONES, PAPERS, PaperKind, WashiTape, PAPER_SHADOW,
    MONO_STACK, SERIF_STACK, CUTE_STACK, tiltFor,
} from '../handbook/paper';

/**
 * 聊天手帐（会话设置）全屏面板 —— 手账风重构版。
 * 原 01~06 分区重排成 11 张「纸页」：
 *   P.01 名字与名片 / P.02 氛围布置 / P.03 记性 / P.04 说话的样子 / P.05 TA 的小日子
 *   P.06 相片角 / P.07 世界书夹页 / P.08 底纸与贴纸 / P.09 裁缝铺 / P.10 使用习惯 / P.11 收纳箱
 * 功能、数据流与持久化与旧版完全一致：会话专属配置写 char.convoSettings，
 * 老字段沿用原 per-char 持久化；所有更改即时保存。
 */

interface ConvoSettingsPanelProps {
    char: CharacterProfile;
    onClose: () => void;
    // 对话记忆（上下文条数）/ 系统日志 —— Chat 本地态 + char 字段双写
    contextLimit: number;
    onContextLimitChange: (v: number) => void;
    hideSysLogs: boolean;
    onToggleHideSysLogs: () => void;
    // 对照翻译（per-char localStorage，状态在 Chat）
    translationEnabled: boolean;
    onToggleTranslation: () => void;
    translateSourceLang?: string;
    translateTargetLang?: string;
    onSetTranslateSourceLang: (lang: string) => void;
    onSetTranslateLang: (lang: string) => void;
    // 历史 / 数据
    onOpenHistoryManager: () => void;
    onClearHistory: () => void;
    preserveContext: boolean;
    onTogglePreserveContext: () => void;
    isVectorizing?: boolean;
    onForceVectorize?: () => void;
    onExportChat: () => void;
    messagesCount: number;
    // 样式
    onOpenChromeCss: () => void;
    // 表情
    categories: EmojiCategory[];
    emojiCounts: Record<string, number>;
    onSaveCategoryVisibility: (categoryId: string, allowedCharacterIds: string[] | undefined) => void;
    // 消息区背景（沿用 char.chatBackground 的上传管线）
    onBgUpload: (file: File) => void;
    onRemoveBg: () => void;
}

// ── 手账 UI 原子 ──────────────────────────────────────────────────────────

/** 糖果开关：撕角矩形 + 缝线虚框，开 = 糖果色实底，滑钮是带小爱心的白贴纸 */
const CandyToggle: React.FC<{ on: boolean; onToggle: () => void; candy?: string }> = ({ on, onToggle, candy = '#f29db0' }) => (
    <button
        onClick={onToggle} role="switch" aria-checked={on}
        className="relative w-[52px] h-[26px] shrink-0 transition-all duration-300 active:scale-95"
        style={{
            background: on ? candy : '#fdf7f2',
            border: on ? '1.5px solid rgba(61,47,61,0.18)' : '1.5px dashed #dcc3cf',
            borderRadius: '8px 12px 9px 12px',
            boxShadow: on ? 'inset 0 1px 3px rgba(61,47,61,0.15)' : 'none',
        }}
    >
        <span className="absolute top-1/2 -translate-y-1/2 text-[8px] font-bold transition-opacity duration-300 pointer-events-none" style={{ ...MONO_STACK, left: 7, color: 'rgba(255,255,255,0.92)', opacity: on ? 1 : 0 }}>ON</span>
        <span className="absolute top-1/2 -translate-y-1/2 text-[8px] font-bold transition-opacity duration-300 pointer-events-none" style={{ ...MONO_STACK, right: 6, color: '#d8c2cd', opacity: on ? 0 : 1 }}>off</span>
        <span
            className="absolute top-1/2 -translate-y-1/2 w-[18px] h-[18px] bg-white flex items-center justify-center text-[9px] leading-none transition-all duration-300"
            style={{ left: on ? 29 : 3, borderRadius: '6px 8px 6px 8px', boxShadow: '0 1px 3px rgba(122,90,114,0.4)', color: on ? candy : '#e0ccd6' }}
        >♥</span>
    </button>
);

/** 标签贴纸：每张按文字种子微微歪一点，选中 = 糖果底，未选 = 白纸虚线框 */
const StickerChip: React.FC<{
    active: boolean; onClick: () => void; seed: string;
    candy?: string; strike?: boolean; title?: string; children: React.ReactNode;
}> = ({ active, onClick, seed, candy = '#fbb8c8', strike, title, children }) => (
    <button
        onClick={onClick} title={title}
        className={`px-2.5 py-1 text-[11px] font-bold transition-all active:scale-90 max-w-full truncate ${strike ? 'line-through' : ''}`}
        style={{
            transform: `rotate(${tiltFor(seed) * 0.55}deg)`,
            background: active ? candy : '#fffdfa',
            color: active ? '#5a3140' : '#a892a3',
            border: active ? '1px solid rgba(90,49,64,0.18)' : '1px dashed #ddc9d3',
            borderRadius: '5px 11px 6px 11px',
            boxShadow: active ? '0 1px 2px rgba(122,90,114,0.28)' : 'none',
            ...CUTE_STACK,
        }}
    >{children}</button>
);

/** 图钉小按钮：跳转 / 展开类动作统一用它 */
const PinButton: React.FC<{ onClick: () => void; children: React.ReactNode; disabled?: boolean; tone?: 'rose' | 'mint' }> = ({ onClick, children, disabled, tone = 'rose' }) => (
    <button
        onClick={onClick} disabled={disabled}
        className="text-[11px] font-bold px-2.5 py-1 rounded-full active:scale-95 transition-transform whitespace-nowrap disabled:opacity-40"
        style={tone === 'mint'
            ? { background: '#eefaf3', border: '1px solid #bfe1cf', color: '#3f7d5c', boxShadow: '0 1px 2px rgba(122,90,114,0.12)', ...CUTE_STACK }
            : { background: '#fffdfa', border: '1px solid #eed6df', color: '#b25e7a', boxShadow: '0 1px 2px rgba(122,90,114,0.15)', ...CUTE_STACK }}
    >{children}</button>
);

/** 横线手写输入：像直接写在本子的格线上 */
const LineInput: React.FC<{ value: string; onChange: (v: string) => void; placeholder?: string; tag?: string }> = ({ value, onChange, placeholder, tag }) => (
    <div className="w-full">
        {tag && <div className="text-[9px] mb-0.5 tracking-wider" style={{ ...MONO_STACK, color: '#a892a3' }}>{tag}</div>}
        <input
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
            className="w-full bg-transparent px-1 py-1.5 text-[13px] outline-none border-0 border-b border-dashed border-[#dcc3cf] focus:border-[#f29db0] placeholder:text-[#cfb8c4]"
            style={{ color: PAPER_TONES.ink, caretColor: '#f29db0' }}
        />
    </div>
);

type TapeProps = React.ComponentProps<typeof WashiTape>;

/** 纸页：一张带胶带标题、页码角标的手账纸 */
const Page: React.FC<{
    no: string; title: string; en: string;
    tape?: TapeProps['color']; pattern?: TapeProps['pattern']; paper?: PaperKind;
    children: React.ReactNode;
}> = ({ no, title, en, tape = 'rose', pattern = 'stripe', paper = 'plain', children }) => {
    const pk = PAPERS[paper];
    return (
        <section className="relative rounded-[14px]" style={{ background: pk.bg, ...pk.style, ...PAPER_SHADOW }}>
            <div className="absolute -top-3 left-4 z-10">
                <WashiTape color={tape} pattern={pattern} rotate={-2}>{title}</WashiTape>
            </div>
            <div className="flex justify-end px-4 pt-2.5">
                <span className="text-[8.5px] tracking-[0.22em] uppercase select-none" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>{en}</span>
            </div>
            <div className="px-4 pb-7 pt-1">{children}</div>
            <span className="absolute bottom-2 right-4 text-[9px] select-none" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>✂ P.{no}</span>
        </section>
    );
};

/** 条目：花朵记号 + 标题 + 旁注小字，条目间用缝线分隔 */
const Entry: React.FC<{ mark?: string; title: string; note?: string; side?: React.ReactNode; children?: React.ReactNode }> = ({ mark = '✿', title, note, side, children }) => (
    <div className="py-3 border-b border-dashed last:border-b-0" style={{ borderColor: 'rgba(122,90,114,0.18)' }}>
        <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                    <span className="text-[11px] leading-none" style={{ color: PAPER_TONES.accentBlush }}>{mark}</span>
                    <span className="text-[12.5px] font-bold" style={{ ...CUTE_STACK, color: PAPER_TONES.ink }}>{title}</span>
                </div>
                {note && <p className="text-[10px] mt-1 leading-relaxed" style={{ color: PAPER_TONES.inkSoft }}>{note}</p>}
            </div>
            {side && <div className="shrink-0 pt-0.5">{side}</div>}
        </div>
        {children && <div className="mt-2.5">{children}</div>}
    </div>
);

/** 拍立得相框：白边 + 顶部小胶带 + 底部手写标签，点击贴照片 */
const Polaroid: React.FC<{
    label: string; value?: string; hint?: string; aspect?: string;
    onChange: (dataUrl: string | undefined) => void;
}> = ({ label, value, hint, aspect = 'aspect-square', onChange }) => {
    const inputRef = useRef<HTMLInputElement>(null);
    return (
        <div style={{ transform: `rotate(${tiltFor(label) * 0.6}deg)` }}>
            <div className="bg-white p-1.5 rounded-[3px] relative" style={{ boxShadow: '0 2px 6px rgba(122,90,114,0.22)' }}>
                <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-8 h-3 pointer-events-none" style={{ background: 'rgba(251,184,200,0.7)', transform: 'rotate(-4deg)', clipPath: 'polygon(3% 0, 100% 8%, 97% 100%, 0 92%)' }} />
                <div
                    onClick={() => inputRef.current?.click()}
                    className={`${aspect} overflow-hidden flex items-center justify-center cursor-pointer`}
                    style={{ background: '#faf3f6', border: value ? 'none' : '1px dashed #e4cdd8' }}
                >
                    {value
                        ? <img src={value} className="w-full h-full object-cover" alt="" />
                        : <span className="text-[8.5px] text-center px-1.5 leading-relaxed" style={{ color: '#bfa8b8' }}>＋ 贴一张{hint ? <><br />{hint}</> : null}</span>}
                </div>
                <div className="flex items-center justify-between gap-1 pt-1">
                    <span className="text-[9px] font-bold truncate" style={{ ...CUTE_STACK, color: PAPER_TONES.inkSoft }}>{label}</span>
                    {value && <button onClick={() => onChange(undefined)} className="text-[8px] shrink-0" style={{ color: '#d4798f' }}>撕掉</button>}
                </div>
            </div>
            <input
                type="file" accept="image/*" ref={inputRef} className="hidden"
                onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    try { onChange(await processImage(f)); } catch { /* 压缩失败忽略 */ }
                    e.target.value = '';
                }}
            />
        </div>
    );
};

const REGION_PRESETS = ['中国大陆', '港澳台', '日本', '韩国', '北美', '欧洲', '东南亚'];
// callSprites 的存储键，不能改动（与生图 / 通话管线对齐）
const CALL_SPRITE_EMOTIONS = ['默认', '开心', '难过', '生气', '惊讶', '害羞', '冷淡', '撒娇'];
const LANG_OPTIONS = ['中文', 'English', '日本語', '한국어', 'Français', 'Español'];

const ConvoSettingsPanel: React.FC<ConvoSettingsPanelProps> = (props) => {
    const {
        char, onClose,
        contextLimit, onContextLimitChange, hideSysLogs, onToggleHideSysLogs,
        translationEnabled, onToggleTranslation, translateSourceLang, translateTargetLang,
        onSetTranslateSourceLang, onSetTranslateLang,
        onOpenHistoryManager, onClearHistory, preserveContext, onTogglePreserveContext,
        isVectorizing, onForceVectorize, onExportChat, messagesCount,
        onOpenChromeCss, categories, emojiCounts, onSaveCategoryVisibility,
        onBgUpload, onRemoveBg,
    } = props;
    const { updateCharacter, groups, worldbooks, characters, apiConfig, addToast, openApp } = useOS();

    const cs: ConvoSettings = char.convoSettings || {};
    const updateConvo = (patch: Partial<ConvoSettings>) => {
        updateCharacter(char.id, { convoSettings: { ...char.convoSettings, ...patch } });
    };

    const bgInputRef = useRef<HTMLInputElement>(null);

    // ── 拉黑保护（整体开关，localStorage 持久化，对所有会话生效） ──
    const [charBlockProtect, setCharBlockProtect] = useState(() => isCharBlockDisabled());

    // ── MiniMax 音色 ──
    const [voices, setVoices] = useState<MiniMaxVoiceItem[] | null>(null);
    const [voicesLoading, setVoicesLoading] = useState(false);
    const loadVoices = async () => {
        if (voices || voicesLoading) return;
        const key = resolveMiniMaxApiKey(apiConfig);
        if (!key) { addToast('先去「文具盒」里填好 MiniMax API Key 哦', 'error'); return; }
        setVoicesLoading(true);
        try {
            const r = await fetchMiniMaxVoices(key, 'all');
            setVoices([...(r.system_voice || []), ...(r.voice_cloning || []), ...(r.voice_generation || [])]);
        } catch (e: any) {
            addToast(e?.message || '嗓音名册没取回来，再试一次？', 'error');
        } finally { setVoicesLoading(false); }
    };

    // ── 记忆摘要展开 ──
    const [memoryOpen, setMemoryOpen] = useState(false);
    const refinedMonths = useMemo(
        () => Object.entries(char.refinedMemories || {}).sort((a, b) => b[0].localeCompare(a[0])),
        [char.refinedMemories]
    );

    // ── 世界书：按 category 分组（与世界书 App 联动，整本挂载/卸载） ──
    // 「卷册」= 一个 category 分组；全局卷（scope=global 的条目）自动注入所有会话，
    // 此处只选局部卷。绑定数据仍存 char.mountedWorldbooks（条目快照，注入时以注册表实况覆盖）。
    const WB_BIND_LIMIT = 8;
    const [wbSearch, setWbSearch] = useState('');
    const [wbListOpen, setWbListOpen] = useState(false);
    const bookCategories = useMemo(() => {
        const map = new Map<string, typeof worldbooks>();
        for (const b of worldbooks) {
            const c = b.category || '未分类设定 (General)';
            if (!map.has(c)) map.set(c, [] as any);
            (map.get(c) as any).push(b);
        }
        return Array.from(map.entries());
    }, [worldbooks]);
    const mountedIds = useMemo(() => new Set((char.mountedWorldbooks || []).map(b => b.id)), [char.mountedWorldbooks]);
    // 与世界书 App 实况同步的「已挂载」判定：只要本卷（分组）有任一条目在挂载列表里
    // 就算已挂载 —— 卷册语义是整本绑定，世界书 App 后续增删条目不改变绑定状态。
    // （旧版要求「全部条目都在挂载列表」，世界书 App 里新增一条就会让开关显示成
    //   未挂载、而注入仍在进行，开关与实际状态脱节。）
    const categoryMounted = (books: typeof worldbooks) => books.length > 0 && books.some(b => mountedIds.has(b.id));
    // 局部卷册：分组里至少有一条 scope 为 local（缺省即 local）的条目
    const localCategories = useMemo(
        () => bookCategories.filter(([, books]) => books.some(b => (b.scope || 'local') === 'local')),
        [bookCategories]
    );
    const mountedLocalCount = localCategories.filter(([, books]) => categoryMounted(books)).length;
    const toggleBookCategory = (category: string, books: typeof worldbooks) => {
        const current = char.mountedWorldbooks || [];
        if (categoryMounted(books)) {
            // 卸载整卷：live 条目 id + 快照里同分组的残留记录一并清掉
            const ids = new Set(books.map(b => b.id));
            updateCharacter(char.id, {
                mountedWorldbooks: current.filter(b => !ids.has(b.id) && (b.category || '未分类设定 (General)') !== category),
            });
            addToast(`《${category}》已从本子里取下`, 'info');
        } else {
            if (mountedLocalCount >= WB_BIND_LIMIT) {
                addToast(`本子最多夹 ${WB_BIND_LIMIT} 卷，先取下几卷再来`, 'error');
                return;
            }
            const additions = books
                .filter(b => !mountedIds.has(b.id))
                .map(b => ({ id: b.id, title: b.title, content: b.content, category: b.category, enabled: b.enabled }));
            updateCharacter(char.id, { mountedWorldbooks: [...current, ...additions] });
            addToast(`《${category}》已夹进本子（${additions.length} 条）`, 'success');
        }
    };
    const clearMountedWorldbooks = () => {
        if (!(char.mountedWorldbooks || []).length) return;
        updateCharacter(char.id, { mountedWorldbooks: [] });
        addToast('夹页全部取下了', 'info');
    };

    // ── 表情分类对本角色可用性 ──
    const categoryEnabledForChar = (cat: EmojiCategory) =>
        !cat.allowedCharacterIds || cat.allowedCharacterIds.includes(char.id);
    const toggleCategoryForChar = (cat: EmojiCategory) => {
        if (categoryEnabledForChar(cat)) {
            // 关闭：限定为「除本角色以外的所有角色」
            const others = (cat.allowedCharacterIds || characters.map(c => c.id)).filter(id => id !== char.id);
            onSaveCategoryVisibility(cat.id, others);
        } else {
            const next = [...(cat.allowedCharacterIds || []), char.id];
            // 如果恢复后涵盖了全部角色，回到 undefined（对所有人可见）
            onSaveCategoryVisibility(cat.id, next.length >= characters.length ? undefined : next);
        }
    };

    const memberGroups = useMemo(() => groups.filter(g => g.members.includes(char.id) && !g.dissolved), [groups, char.id]);
    const gmMode = cs.groupMemoryMode || 'all';

    const unlimitedContext = contextLimit >= 100000;
    const setContextLimit = (v: number) => {
        onContextLimitChange(v);
        updateCharacter(char.id, { contextLimit: v });
    };

    return (
        <div
            className="absolute inset-0 z-[260] flex flex-col animate-fade-in"
            style={{
                paddingTop: 'var(--safe-top)',
                backgroundColor: '#f6ecf1',
                backgroundImage: 'radial-gradient(rgba(242,157,176,0.16) 1.2px, transparent 1.2px)',
                backgroundSize: '18px 18px',
            }}
        >
            {/* 封面条（顶栏） */}
            <div
                className="shrink-0 flex items-center gap-3 px-3 py-3"
                style={{ background: 'linear-gradient(135deg, #fbd3de 0%, #f3e3f2 70%, #fdeee4 100%)', borderBottom: '1.5px dashed rgba(122,90,114,0.3)' }}
            >
                <button
                    onClick={onClose}
                    className="w-9 h-9 rounded-full bg-white flex items-center justify-center active:scale-90 transition-transform shrink-0"
                    style={{ boxShadow: '0 1px 3px rgba(122,90,114,0.3)', border: '1px dashed #eab6c6' }}
                    aria-label="合上手帐"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="#9c5e74" className="w-[18px] h-[18px]">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                    </svg>
                </button>
                <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                        <span className="text-[16px] font-bold leading-tight" style={{ ...SERIF_STACK, color: '#5a3140' }}>聊天手帐</span>
                        <span className="text-[8.5px] tracking-[0.24em] select-none" style={{ ...MONO_STACK, color: '#b07a8d' }}>CHAT NOTE</span>
                    </div>
                    <div className="text-[10px] truncate mt-0.5" style={{ color: '#a96f84' }}>{cs.remarkName || char.name} 的专页 · 落笔即存</div>
                </div>
                <span className="text-[18px] select-none shrink-0" style={{ transform: 'rotate(8deg)', opacity: 0.55 }} aria-hidden>✎</span>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar px-3 pt-6 pb-12 space-y-8">

                {/* ═══ P.01 名字与名片 ═══ */}
                <Page no="01" title="名字与名片" en="Name Tags" tape="rose" pattern="stripe" paper="lined">
                    <Entry mark="♡" title="给 TA 起的小名" note="写在这里的名字会出现在聊天顶栏和会话列表里；TA 的本名不会被改动。">
                        <LineInput
                            value={cs.remarkName || ''}
                            onChange={v => updateConvo({ remarkName: v || undefined })}
                            placeholder={char.name}
                        />
                    </Entry>

                    <Entry mark="♡" title="TA 叫我什么" note="TA 平日里对你的称呼，会写进提示词——以后 TA 就这么喊你。">
                        <LineInput
                            value={cs.userNickname || ''}
                            onChange={v => updateConvo({ userNickname: v || undefined })}
                            placeholder="比如：阿宝 / 小朋友 / 主人…"
                        />
                    </Entry>

                    <Entry mark="♡" title="TA 的名片" note="角色主页上的微信号、地区和签名都由你来填（不再交给 AI 编），空着就不展示。">
                        <div className="space-y-2.5">
                            <LineInput
                                tag="WECHAT ID"
                                value={char.socialProfile?.handle || ''}
                                onChange={v => updateCharacter(char.id, { socialProfile: { ...char.socialProfile, handle: v } })}
                                placeholder={`默认 moro_${char.id.slice(0, 10)}`}
                            />
                            <LineInput
                                tag="AREA"
                                value={char.socialProfile?.region || ''}
                                onChange={v => updateCharacter(char.id, { socialProfile: { handle: char.socialProfile?.handle || '', ...char.socialProfile, region: v || undefined } })}
                                placeholder="比如：安徽 亳州 / 日本 京都…"
                            />
                            <LineInput
                                tag="MOTTO"
                                value={char.socialProfile?.bio || ''}
                                onChange={v => updateCharacter(char.id, { socialProfile: { handle: char.socialProfile?.handle || '', ...char.socialProfile, bio: v || undefined } })}
                                placeholder="挂在 TA 主页上的一句话…"
                            />
                        </div>
                    </Entry>
                </Page>

                {/* ═══ P.02 氛围布置 ═══ */}
                <Page no="02" title="氛围布置" en="Mood Decor" tape="lemon" pattern="dot" paper="dot">
                    <Entry mark="✩" title="页眉小字" note="挂在聊天界面最顶端（顶栏卡片上方）的一句居中装饰话，纯粹好看用。">
                        <LineInput
                            value={cs.headerDecorText || ''}
                            onChange={v => updateConvo({ headerDecorText: v || undefined })}
                            placeholder="比如：보고 싶어…ㅠㅠ🖤 / 恋爱进行时"
                        />
                    </Entry>

                    <Entry mark="✩" title="页脚小字" note="垫在消息列表下方、输入栏上方的一句居中装饰话，同样只是装饰。">
                        <LineInput
                            value={cs.footerDecorText || ''}
                            onChange={v => updateConvo({ footerDecorText: v || undefined })}
                            placeholder="比如：小狗勾流眼泪TT / 今天也想见你"
                        />
                    </Entry>

                    <Entry mark="✩" title="输入框里的水印字" note="输入框空着的时候浮现的提示语（不填就是「说点什么…」）。">
                        <LineInput
                            value={cs.inputPlaceholderText || ''}
                            onChange={v => updateConvo({ inputPlaceholderText: v || undefined })}
                            placeholder="比如：( ʚಌɞ )삶의 조각들 / 说点什么…"
                        />
                    </Entry>

                    <Entry mark="✩" title="这本子的铃声" note="TA 来新消息时灵动岛横幅的提示音，点一下贴纸就能试听。">
                        <div className="flex flex-wrap gap-2">
                            {RINGTONE_PRESETS.map(p => (
                                <StickerChip
                                    key={p.id} seed={`ring-${p.id}`}
                                    active={(cs.ringtone || 'none') === p.id}
                                    onClick={() => { updateConvo({ ringtone: p.id as any }); playRingtone(p.id); }}
                                >{p.label}</StickerChip>
                            ))}
                        </div>
                    </Entry>

                    <Entry
                        mark="✩" title="把时间藏起来"
                        note="本会话不再显示消息时间（盖过全局外观设置）。"
                        side={<CandyToggle on={!!cs.hideTimestamp} onToggle={() => updateConvo({ hideTimestamp: !cs.hideTimestamp })} />}
                    />
                </Page>

                {/* ═══ P.03 记性 ═══ */}
                <Page no="03" title="记性" en="Memory" tape="sky" pattern="plain" paper="grid">
                    <Entry
                        mark="✦"
                        title={`随身记忆 · ${unlimitedContext ? '不设上限' : `最近 ${contextLimit} 条`}`}
                        note="每次对话随身携带的最近消息条数；更早的往事交给记忆摘要和回忆标本馆补全。"
                    >
                        <div className="flex items-center gap-2.5">
                            <input
                                type="range" min={20} max={5000} step={10}
                                value={Math.min(contextLimit, 5000)}
                                disabled={unlimitedContext}
                                onChange={e => setContextLimit(parseInt(e.target.value))}
                                className="flex-1 disabled:opacity-40"
                                style={{ accentColor: '#f29db0' }}
                            />
                            <StickerChip seed="不设上限" active={unlimitedContext} onClick={() => setContextLimit(unlimitedContext ? 500 : 100000)}>不设上限</StickerChip>
                        </div>
                    </Entry>

                    <Entry mark="✦" title="群里的事要不要带过来" note="单聊时把 TA 所在群聊的近期动静当作背景。选「都不带」的话，群里发生过什么这段单聊一概不知。">
                        <div className="flex flex-wrap gap-2">
                            <StickerChip seed="gm-all" active={gmMode === 'all'} onClick={() => updateConvo({ groupMemoryMode: 'all' })}>全都带上</StickerChip>
                            <StickerChip seed="gm-none" active={gmMode === 'none'} onClick={() => updateConvo({ groupMemoryMode: 'none' })}>都不带</StickerChip>
                            <StickerChip seed="gm-sel" active={gmMode === 'selected'} onClick={() => updateConvo({ groupMemoryMode: 'selected' })}>挑几个群</StickerChip>
                        </div>
                        {gmMode === 'selected' && (
                            <div className="flex flex-wrap gap-2 mt-2.5">
                                {memberGroups.length === 0 && <span className="text-[10px]" style={{ color: PAPER_TONES.inkFaint }}>TA 还没加进任何群聊</span>}
                                {memberGroups.map(g => {
                                    const on = (cs.linkedGroupIds || []).includes(g.id);
                                    return (
                                        <StickerChip key={g.id} seed={g.id} active={on} candy="#b9d3e0" onClick={() => {
                                            const cur = cs.linkedGroupIds || [];
                                            updateConvo({ linkedGroupIds: on ? cur.filter(id => id !== g.id) : [...cur, g.id] });
                                        }}>{g.name}</StickerChip>
                                    );
                                })}
                            </div>
                        )}
                    </Entry>

                    <Entry
                        mark="✦" title="往月的回忆册"
                        note="按月精炼出的长期记忆（记忆归档生成），每次聊天都会随身翻阅。"
                        side={
                            <PinButton onClick={() => setMemoryOpen(v => !v)}>
                                {refinedMonths.length} 本 · {memoryOpen ? '合上' : '翻开'}
                            </PinButton>
                        }
                    >
                        {memoryOpen && (
                            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                                {refinedMonths.length === 0 && (
                                    <p className="text-[10px]" style={{ color: PAPER_TONES.inkFaint }}>
                                        还没攒下回忆。在聊天里做一次「记忆归档」，月度小结就会被夹进这里。
                                    </p>
                                )}
                                {refinedMonths.map(([month, content]) => (
                                    <div key={month} className="rounded-[8px] p-2.5" style={{ background: '#fffdfa', border: '1px dashed #e4cdd8' }}>
                                        <div className="text-[9px] mb-1" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>{month}</div>
                                        <p className="text-[11px] leading-relaxed whitespace-pre-wrap line-clamp-4" style={{ color: PAPER_TONES.inkSoft }}>{content}</p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Entry>
                </Page>

                {/* ═══ P.04 说话的样子 ═══ */}
                <Page no="04" title="说话的样子" en="Voice and Words" tape="mint" pattern="stripe" paper="lined">
                    <Entry mark="❀" title="TA 打字的习惯" note="「一句一句蹦」像真人那样把话拆成几条短消息发；「一大段说完」则一条讲完。">
                        <div className="flex gap-2">
                            <StickerChip seed="bm-split" active={(cs.bubbleStyleMode || 'split') === 'split'} candy="#bfe1cf" onClick={() => updateConvo({ bubbleStyleMode: 'split' })}>一句一句蹦</StickerChip>
                            <StickerChip seed="bm-whole" active={cs.bubbleStyleMode === 'whole'} candy="#bfe1cf" onClick={() => updateConvo({ bubbleStyleMode: 'whole' })}>一大段说完</StickerChip>
                        </div>
                    </Entry>

                    <Entry
                        mark="❀" title="舞台旁白"
                        note="打开后 TA 能单独发一条（动作 / 场景）旁白泡泡，写写此刻的神态、动作和身边的环境。"
                        side={<CandyToggle on={!!cs.narrationMode} onToggle={() => updateConvo({ narrationMode: !cs.narrationMode })} />}
                    />

                    <Entry
                        mark="❀" title="偷听小心思"
                        note="「偷看心声」入口的总开关：能看到 TA 没说出口的内心话，这些不会被算进对话上下文。"
                        side={<CandyToggle on={cs.innerVoiceEnabled !== false} onToggle={() => updateConvo({ innerVoiceEnabled: cs.innerVoiceEnabled === false })} />}
                    />

                    <Entry
                        mark="❀" title="双语对照"
                        note="打开后 AI 消息先以「气泡语言」显示，点「译」再换成目标语言。"
                        side={<CandyToggle on={translationEnabled} onToggle={onToggleTranslation} />}
                    >
                        {translationEnabled && (
                            <div className="space-y-3">
                                <div>
                                    <div className="text-[9px] mb-1 tracking-wider" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>气泡先显示</div>
                                    <div className="flex flex-wrap gap-2">
                                        {LANG_OPTIONS.map(l => (
                                            <StickerChip key={`s-${l}`} seed={`s-${l}`} active={translateSourceLang === l} candy="#d6c8e8" onClick={() => onSetTranslateSourceLang(l)}>{l}</StickerChip>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[9px] mb-1 tracking-wider" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>点「译」后变成</div>
                                    <div className="flex flex-wrap gap-2">
                                        {LANG_OPTIONS.map(l => (
                                            <StickerChip key={`t-${l}`} seed={`t-${l}`} active={translateTargetLang === l} candy="#d6c8e8" onClick={() => onSetTranslateLang(l)}>{l}</StickerChip>
                                        ))}
                                    </div>
                                </div>
                                <LineInput
                                    tag="译文的笔调"
                                    value={cs.translateStyle || ''}
                                    onChange={v => updateConvo({ translateStyle: v || undefined })}
                                    placeholder="比如：口语化 / 文学腔 / 保留语气词…（会追加进翻译要求）"
                                />
                            </div>
                        )}
                    </Entry>

                    <Entry
                        mark="❀" title="斗图的兴致"
                        note="打开后 TA 会在情绪对上的时候，自己联想着发表情包。"
                        side={<CandyToggle on={!!cs.emojiAssociation} onToggle={() => updateConvo({ emojiAssociation: !cs.emojiAssociation })} />}
                    />

                    <Entry mark="❀" title="TA 能翻的表情抽屉" note="点一下分类贴纸，决定那个抽屉里的表情 TA 用不用得了。划线的就是对 TA 上了锁。">
                        <div className="flex flex-wrap gap-2">
                            {categories.length === 0 && <span className="text-[10px]" style={{ color: PAPER_TONES.inkFaint }}>还没建过表情分类</span>}
                            {categories.map(cat => {
                                const on = categoryEnabledForChar(cat);
                                return (
                                    <StickerChip key={cat.id} seed={cat.id} active={on} strike={!on} candy="#bfe1cf" onClick={() => toggleCategoryForChar(cat)}>
                                        {cat.name} · {emojiCounts[cat.id] || 0} 张
                                    </StickerChip>
                                );
                            })}
                        </div>
                    </Entry>

                    <Entry
                        mark="❀" title="TA 的嗓音（MiniMax）"
                        note={char.voiceProfile?.voiceId ? `现在用的是：${char.voiceProfile.voiceName || char.voiceProfile.voiceId}` : '还没挑过。语音条和音视频通话都会用这把嗓音。'}
                        side={!voices ? <PinButton onClick={loadVoices}>{voicesLoading ? '翻名册中…' : '挑个嗓音'}</PinButton> : undefined}
                    >
                        {voices && (
                            <select
                                value={char.voiceProfile?.voiceId || ''}
                                onChange={e => {
                                    const v = voices.find(x => x.voice_id === e.target.value);
                                    if (!v) return;
                                    updateCharacter(char.id, {
                                        voiceProfile: { ...char.voiceProfile, provider: 'minimax', voiceId: v.voice_id, voiceName: v.voice_name || v.voice_id },
                                    });
                                    addToast(`嗓音换成了 ${v.voice_name || v.voice_id}`, 'success');
                                }}
                                className="w-full px-3 py-2.5 text-[12px] outline-none rounded-[8px]"
                                style={{ background: '#fffdfa', border: '1px dashed #dcc3cf', color: PAPER_TONES.ink }}
                            >
                                <option value="">点这里挑一个嗓音…</option>
                                {voices.map(v => <option key={v.voice_id} value={v.voice_id}>{v.voice_name || v.voice_id}</option>)}
                            </select>
                        )}
                    </Entry>

                    <Entry
                        mark="❀" title="用语音条回你"
                        note="AI 回复自动配上一条语音（要先配好 MiniMax 和上面那把嗓音）。"
                        side={<CandyToggle candy="#8fceae" on={!!char.chatVoiceEnabled} onToggle={() => updateCharacter(char.id, { chatVoiceEnabled: !char.chatVoiceEnabled })} />}
                    >
                        {char.chatVoiceEnabled && (
                            <div className="flex flex-wrap gap-2">
                                {[{ v: '', l: '默认' }, { v: 'en', l: 'English' }, { v: 'ja', l: '日本語' }, { v: 'ko', l: '한국어' }, { v: 'fr', l: 'Français' }, { v: 'es', l: 'Español' }].map(o => (
                                    <StickerChip key={o.v} seed={`vl-${o.v}`} active={(char.chatVoiceLang || '') === o.v} candy="#bfe1cf" onClick={() => updateCharacter(char.id, { chatVoiceLang: o.v })}>{o.l}</StickerChip>
                                ))}
                            </div>
                        )}
                    </Entry>

                    <Entry
                        mark="❀" title="会做小卡片"
                        note="TA 会在合适的场景递来邀请函、票根、通知单这类可视化小卡片（默认开着）。"
                        side={<CandyToggle candy="#bfa3dd" on={char.htmlModeEnabled !== false} onToggle={() => updateCharacter(char.id, { htmlModeEnabled: char.htmlModeEnabled === false })} />}
                    >
                        {char.htmlModeEnabled !== false && (
                            <textarea
                                value={char.htmlModeCustomPrompt || ''}
                                onChange={e => updateCharacter(char.id, { htmlModeCustomPrompt: e.target.value })}
                                placeholder="想补充的叮嘱（会追加在内置提示词后面）…"
                                className="w-full h-20 rounded-[8px] p-3 text-[12px] resize-none outline-none placeholder:text-[#cfb8c4]"
                                style={{ background: '#fffdfa', border: '1px dashed #d8c3e6', color: PAPER_TONES.ink }}
                            />
                        )}
                    </Entry>
                </Page>

                {/* ═══ P.05 TA 的小日子 ═══ */}
                <Page no="05" title="TA 的小日子" en="Daily Life" tape="lavender" pattern="heart" paper="cream">
                    <Entry mark="☘" title="TA 住在哪儿" note="TA 生活的地方：作息、时差、天气、日常话题都会照着这片土地来。">
                        <div className="flex flex-wrap gap-2 mb-2.5">
                            {REGION_PRESETS.map(r => (
                                <StickerChip key={r} seed={`rg-${r}`} active={cs.region === r} candy="#d6c8e8" onClick={() => updateConvo({ region: cs.region === r ? undefined : r })}>{r}</StickerChip>
                            ))}
                        </div>
                        <LineInput
                            value={cs.region && !REGION_PRESETS.includes(cs.region) ? cs.region : ''}
                            onChange={v => updateConvo({ region: v || undefined })}
                            placeholder="或者自己写一个：「日本 京都」「重庆」…"
                        />
                    </Entry>

                    <Entry
                        mark="☘" title="TA 知道现在几点"
                        note="往提示词里塞「距上次聊天过了多久」这类线索，让 TA 对时间更敏感、贴着现实的钟点过日子。"
                        side={<CandyToggle on={char.timeAwarenessEnabled !== false} onToggle={() => updateCharacter(char.id, { timeAwarenessEnabled: char.timeAwarenessEnabled === false })} />}
                    />

                    <Entry
                        mark="☘" title="出门前看一眼世界"
                        note="TA 主动发消息前会先瞄一眼当下的时间、天气和热点，再自然地揉进话题（要先在「文具盒」里打开实时信息源）。"
                        side={<CandyToggle on={!!cs.proactiveLookup} onToggle={() => updateConvo({ proactiveLookup: !cs.proactiveLookup })} />}
                    />

                    <Entry
                        mark="☘" title="TA 会突然打电话来"
                        note="TA 主动找你时，会按人设和剧情自己决定要不要直接拨语音电话（主动消息在聊天界面下方 + 号面板里开启）。来电可接可挂，没接到会留一条未接记录。"
                        side={<CandyToggle on={!!cs.proactiveCallEnabled} onToggle={() => updateConvo({ proactiveCallEnabled: !cs.proactiveCallEnabled })} />}
                    />

                    <Entry mark="☘" title="TA 发朋友圈的勤快度" note="TA 自己更新朋友圈的频率。「看心情」全凭 TA 当下的情绪；TA 聊天时也会提起自己发过的动态。">
                        <div className="flex flex-wrap gap-2 items-center">
                            <StickerChip seed="mp-off" active={!cs.momentsAutoPost || cs.momentsAutoPost === 'off'} candy="#d6c8e8" onClick={() => updateConvo({ momentsAutoPost: 'off' })}>不发</StickerChip>
                            <StickerChip seed="mp-rnd" active={cs.momentsAutoPost === 'random'} candy="#d6c8e8" onClick={() => updateConvo({ momentsAutoPost: 'random' })}>看心情</StickerChip>
                            <StickerChip seed="mp-num" active={typeof cs.momentsAutoPost === 'number'} candy="#d6c8e8" onClick={() => updateConvo({ momentsAutoPost: typeof cs.momentsAutoPost === 'number' ? cs.momentsAutoPost : 24 })}>定个频率</StickerChip>
                            {typeof cs.momentsAutoPost === 'number' && (
                                <span className="inline-flex items-baseline gap-1">
                                    <input
                                        type="number" min={1}
                                        value={cs.momentsAutoPost}
                                        onChange={e => updateConvo({ momentsAutoPost: Math.max(1, parseInt(e.target.value) || 24) })}
                                        className="w-14 px-1 py-0.5 text-[12px] text-center bg-transparent outline-none border-0 border-b border-dashed border-[#dcc3cf] focus:border-[#f29db0]"
                                        style={{ color: PAPER_TONES.ink }}
                                    />
                                    <span className="text-[10px]" style={{ color: PAPER_TONES.inkSoft }}>小时一条</span>
                                </span>
                            )}
                        </div>
                    </Entry>

                    <Entry
                        mark="☘" title="把手机借给 TA 玩"
                        note="TA 会不定期主动拿走你的手机翻一翻（屏幕会变成你的桌面，TA 一边翻一边冒想法，甚至替你回消息、拉黑别人）。想中途拿回来，要么 TA 点头，要么答对 TA 出的三道题，要么硬抢。关着的话 TA 不会动你手机。"
                        side={<CandyToggle on={!!cs.allowPhoneBrowse} onToggle={() => updateConvo({ allowPhoneBrowse: !cs.allowPhoneBrowse })} />}
                    />

                    <Entry
                        mark="☘" title="聊着聊着就见面"
                        note="对话发展到要见面的情境时，TA 会自己进入线下模式：弹出现场小窗记录情景，你能在窗里说话、行动。退出后这段情景会进上下文，TA 还会主动发消息收个尾。关着则不会触发。"
                        side={<CandyToggle on={!!cs.autoOffline} onToggle={() => updateConvo({ autoOffline: !cs.autoOffline })} />}
                    />

                    <Entry
                        mark="☘" title="TA 也刷小红书"
                        note="TA 能在聊天里搜索、浏览、发帖、评论小红书（要先在全局配好 MCP 或 Cookie）。"
                        side={<CandyToggle candy="#f08a8a" on={!!char.xhsEnabled} onToggle={() => updateCharacter(char.id, { xhsEnabled: !char.xhsEnabled })} />}
                    />
                </Page>

                {/* ═══ P.06 相片角 ═══ */}
                <Page no="06" title="相片角" en="Photo Corner" tape="blush" pattern="plain" paper="plain">
                    <Entry mark="❅" title="贴在聊天角落的立绘" note="立绘会半透明地立在聊天界面右下角（galgame 那种感觉）；「生图底图」是 img2img / edits 用的参考图。">
                        <div className="grid grid-cols-3 gap-3">
                            <Polaroid label="这页的头像" aspect="aspect-square" value={cs.charAvatarOverride} hint="沿用角色头像" onChange={v => updateConvo({ charAvatarOverride: v })} />
                            <Polaroid label="立绘本体" aspect="aspect-square" value={cs.spriteImage} onChange={v => updateConvo({ spriteImage: v })} />
                            <Polaroid label="生图底图" aspect="aspect-square" value={cs.spriteRefImage} onChange={v => updateConvo({ spriteRefImage: v })} />
                        </div>
                    </Entry>

                    <Entry mark="❅" title="通话时的八副表情" note="「默认」那张会当成音视频通话的背景形象；其余情绪格子留给生图与通话表现用。">
                        <div className="grid grid-cols-4 gap-3">
                            {CALL_SPRITE_EMOTIONS.map(emo => (
                                <Polaroid
                                    key={emo} label={emo} aspect="aspect-[3/4]"
                                    value={cs.callSprites?.[emo]}
                                    onChange={v => {
                                        const next = { ...cs.callSprites };
                                        if (v) next[emo] = v; else delete next[emo];
                                        updateConvo({ callSprites: next });
                                    }}
                                />
                            ))}
                        </div>
                    </Entry>

                    <Entry
                        mark="❅" title="每轮都配一张图"
                        note="生图管线的配置位：打开后每轮回复都会试着按场景配图（要接好生图 API，配合上面的「生图底图」）。"
                        side={<CandyToggle on={!!cs.perTurnImageGen} onToggle={() => updateConvo({ perTurnImageGen: !cs.perTurnImageGen })} />}
                    />
                </Page>

                {/* ═══ P.07 剪报夹页（世界书挂载） ═══ */}
                <Page no="07" title="剪报夹页" en="Clippings" tape="blue" pattern="star" paper="mint">
                    <Entry
                        mark="❃" title="夹进本子的卷册"
                        note={`全局卷自己会进来，这里只挑局部卷，合计最多夹 ${WB_BIND_LIMIT} 卷。每条剪报的开关和作用域去「剪报夹」App 里拨。`}
                        side={<PinButton onClick={clearMountedWorldbooks}>全部取下</PinButton>}
                    >
                        <div className="text-[10px] mb-2.5" style={{ ...MONO_STACK, color: PAPER_TONES.inkSoft }}>
                            已夹 {mountedLocalCount} / {WB_BIND_LIMIT} · 书架上可选 {localCategories.length} 卷
                        </div>

                        {localCategories.length === 0 && (
                            <PinButton onClick={() => openApp(AppID.Worldbook)}>书架还空着，去「剪报夹」App 剪一卷 ⇢</PinButton>
                        )}

                        {/* 已夹好的卷册（糖果贴纸，点击即取下） */}
                        {mountedLocalCount > 0 && (
                            <div className="flex flex-wrap gap-2 mb-2.5">
                                {localCategories.filter(([, books]) => categoryMounted(books)).map(([category, books]) => (
                                    <StickerChip
                                        key={`sel-${category}`} seed={`sel-${category}`}
                                        active candy="#9dc1d5"
                                        onClick={() => toggleBookCategory(category, books)}
                                    >📎 {category}</StickerChip>
                                ))}
                            </div>
                        )}

                        {localCategories.length > 0 && (
                            <div className="mb-2.5">
                                <PinButton onClick={() => setWbListOpen(v => !v)}>{wbListOpen ? '合上书架' : '翻翻书架'}</PinButton>
                            </div>
                        )}

                        {wbListOpen && (
                            <div>
                                <LineInput
                                    value={wbSearch}
                                    onChange={setWbSearch}
                                    placeholder="找一卷…"
                                />
                                <div className="flex flex-wrap gap-2 max-h-56 overflow-y-auto pr-1 mt-2.5">
                                    {localCategories
                                        .filter(([category]) => !wbSearch.trim() || category.toLowerCase().includes(wbSearch.trim().toLowerCase()))
                                        .map(([category, books]) => {
                                            const on = categoryMounted(books);
                                            return (
                                                <StickerChip
                                                    key={category} seed={category}
                                                    active={on} candy="#9dc1d5"
                                                    title={`${books.length} 条目`}
                                                    onClick={() => toggleBookCategory(category, books)}
                                                >{category}</StickerChip>
                                            );
                                        })}
                                    {localCategories.length > 0 && wbSearch.trim() && localCategories.every(([category]) => !category.toLowerCase().includes(wbSearch.trim().toLowerCase())) && (
                                        <span className="text-[10px] py-1" style={{ color: PAPER_TONES.inkFaint }}>书架上找不到「{wbSearch.trim()}」</span>
                                    )}
                                </div>
                            </div>
                        )}
                    </Entry>
                </Page>

                {/* ═══ P.08 底纸与贴纸 ═══ */}
                <Page no="08" title="底纸与贴纸" en="Wallpaper" tape="cream" pattern="lace" paper="sky">
                    <Entry mark="✿" title="只在这页换的脸" note="只对本会话生效的形象覆盖，别的页面照旧。">
                        <div className="grid grid-cols-3 gap-3">
                            <Polaroid label="TA 的头像" aspect="aspect-square" value={cs.charAvatarOverride} hint="沿用角色头像" onChange={v => updateConvo({ charAvatarOverride: v })} />
                            <Polaroid label="我的头像" aspect="aspect-square" value={cs.userAvatarOverride} hint="沿用我的头像" onChange={v => updateConvo({ userAvatarOverride: v })} />
                            <Polaroid label="身份卡画板" aspect="aspect-square" value={cs.idCardImage} hint="角色资料页顶部" onChange={v => updateConvo({ idCardImage: v })} />
                        </div>
                    </Entry>

                    <Entry mark="✿" title="铺在聊天里的底纸" note="消息区底纸就是聊天壁纸；两条「细横条」是贴边装饰；顶栏 / 输入栏的底纸靠白框样式注入。">
                        <div className="grid grid-cols-2 gap-3">
                            {/* 聊天壁纸：沿用 onBgUpload 管线，原画质收录 */}
                            <div style={{ transform: 'rotate(-0.8deg)' }}>
                                <div className="bg-white p-1.5 rounded-[3px] relative" style={{ boxShadow: '0 2px 6px rgba(122,90,114,0.22)' }}>
                                    <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-8 h-3 pointer-events-none" style={{ background: 'rgba(251,184,200,0.7)', transform: 'rotate(-4deg)', clipPath: 'polygon(3% 0, 100% 8%, 97% 100%, 0 92%)' }} />
                                    <div
                                        onClick={() => bgInputRef.current?.click()}
                                        className="aspect-[2/1] overflow-hidden flex items-center justify-center cursor-pointer"
                                        style={{ background: '#faf3f6', border: char.chatBackground ? 'none' : '1px dashed #e4cdd8' }}
                                    >
                                        {char.chatBackground
                                            ? <img src={char.chatBackground} className="w-full h-full object-cover" alt="" />
                                            : <span className="text-[8.5px] text-center px-1.5 leading-relaxed" style={{ color: '#bfa8b8' }}>＋ 贴一张<br />原画质收录</span>}
                                    </div>
                                    <div className="flex items-center justify-between gap-1 pt-1">
                                        <span className="text-[9px] font-bold truncate" style={{ ...CUTE_STACK, color: PAPER_TONES.inkSoft }}>聊天壁纸（消息区）</span>
                                        {char.chatBackground && <button onClick={onRemoveBg} className="text-[8px] shrink-0" style={{ color: '#d4798f' }}>撕掉</button>}
                                    </div>
                                </div>
                                <input type="file" ref={bgInputRef} className="hidden" accept="image/*" onChange={e => e.target.files?.[0] && onBgUpload(e.target.files[0])} />
                            </div>
                            <Polaroid label="顶栏背景（头像后面）" aspect="aspect-[2/1]" value={cs.headerBgImage} onChange={v => updateConvo({ headerBgImage: v })} />
                            <Polaroid label="顶栏下的细横条" aspect="aspect-[4/1]" value={cs.headerEdgeImage} onChange={v => updateConvo({ headerEdgeImage: v })} />
                            <Polaroid label="输入栏上的细横条" aspect="aspect-[4/1]" value={cs.msgEdgeImage} onChange={v => updateConvo({ msgEdgeImage: v })} />
                            <Polaroid label="输入栏的底" aspect="aspect-[4/1]" value={cs.inputBarImage} onChange={v => updateConvo({ inputBarImage: v })} />
                        </div>
                    </Entry>
                </Page>

                {/* ═══ P.09 裁缝铺 ═══ */}
                <Page no="09" title="裁缝铺" en="Tailor Shop" tape="silver" pattern="stripe" paper="plain">
                    <Entry
                        mark="✄" title="整体的衣裳"
                        note="气泡、头像、顶栏、输入栏这些全局聊天样式，都在「外观」App 里量体裁衣。"
                        side={<PinButton onClick={() => openApp(AppID.Appearance)}>去外观挑 ⇢</PinButton>}
                    />
                    <Entry
                        mark="✄" title="只属于 TA 的针线（CSS）"
                        note="只对这个角色生效的聊天界面自定义样式（.moro-chat-* 钩子），缝在全局样式之上。"
                        side={<PinButton onClick={onOpenChromeCss}>动手缝 ⇢</PinButton>}
                    />
                </Page>

                {/* ═══ P.10 使用习惯 ═══ */}
                <Page no="10" title="使用习惯" en="Habits" tape="lavender" pattern="dot" paper="lined">
                    <Entry
                        mark="✤" title="收起系统碎碎念"
                        note="不再显示 Date / App 冒出来的上下文提示文本（转账、戳一戳、图片发送提示还是会留着）。"
                        side={<CandyToggle on={hideSysLogs} onToggle={onToggleHideSysLogs} />}
                    />
                    <Entry
                        mark="✤" title="谁也不许拉黑我"
                        note="打开后所有角色都不会再做出「拉黑你」的举动（对全部会话生效）。已经存在的拉黑不受影响，会照常自动解除。"
                        side={<CandyToggle candy="#ec7d9e" on={charBlockProtect} onToggle={() => {
                            const next = !charBlockProtect;
                            setCharBlockProtect(next);
                            setCharBlockDisabled(next);
                        }} />}
                    />
                    <Entry
                        mark="✤" title="把以前的页折起来"
                        note="从某条消息开始展示，之前的记录折进去藏好（AI 也读不到）。"
                        side={<PinButton onClick={onOpenHistoryManager}>去折页 ⇢</PinButton>}
                    />
                </Page>

                {/* ═══ P.11 收纳箱 ═══ */}
                <Page no="11" title="收纳箱" en="Archive Box" tape="blush" pattern="heart" paper="cream">
                    <Entry
                        mark="❒" title="把聊天装进盒子"
                        note={`这一页现在有 ${messagesCount} 条看得见的消息，可以整册打包成 JSON 文件带走。`}
                        side={<PinButton onClick={onExportChat}>打包带走 ⇢</PinButton>}
                    />
                    {char.memoryPalaceEnabled && onForceVectorize && (
                        <Entry
                            mark="❒" title="送进回忆标本馆"
                            note="把还没处理的聊天记录全部交给回忆标本馆做向量化，办完之后就能放心清空聊天。"
                            side={
                                <PinButton tone="mint" onClick={onForceVectorize} disabled={isVectorizing}>
                                    {isVectorizing ? '搬运中…' : '🏰 全部送去'}
                                </PinButton>
                            }
                        />
                    )}
                    <Entry mark="❒" title="碎纸机" note="把这一页的聊天记录整个绞碎，动手前想清楚。">
                        <div className="rounded-[10px] p-3" style={{ border: '1.5px dashed #e8a0b0', background: 'rgba(255,235,240,0.6)' }}>
                            <div className="flex items-center gap-2 mb-2.5 cursor-pointer select-none" onClick={onTogglePreserveContext}>
                                <div
                                    className="w-4 h-4 rounded-[5px] flex items-center justify-center transition-colors shrink-0"
                                    style={preserveContext
                                        ? { background: '#ec7d9e', border: '1px solid #d4607f' }
                                        : { background: '#fff', border: '1.5px dashed #dcb4c2' }}
                                >
                                    {preserveContext && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>}
                                </div>
                                <span className="text-[11px]" style={{ color: PAPER_TONES.inkSoft }}>留下最近 10 条垫底，免得 TA 彻底失忆</span>
                            </div>
                            <button
                                onClick={onClearHistory}
                                className="w-full py-2.5 text-[12px] font-bold rounded-[10px] active:scale-95 transition-transform"
                                style={{ background: '#fff', border: '1.5px solid #e8889d', color: '#d4536f', boxShadow: '2px 2px 0 #f3c1cd', ...CUTE_STACK }}
                            >启动碎纸机 · 清空记录</button>
                        </div>
                    </Entry>
                </Page>

                {/* 卷尾语 */}
                <div className="text-center text-[10px] pb-1 select-none" style={{ ...CUTE_STACK, color: '#c39aab' }}>
                    ☾ 这一册先写到这里 · 每一笔都已自动存好
                </div>
            </div>
        </div>
    );
};

export default ConvoSettingsPanel;
