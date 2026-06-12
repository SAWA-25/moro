import React, { useMemo, useRef, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { CharacterProfile, ConvoSettings, EmojiCategory, AppID } from '../../types';
import { processImage } from '../../utils/file';
import { RINGTONE_PRESETS, playRingtone } from '../../utils/ringtone';
import { fetchMiniMaxVoices, MiniMaxVoiceItem } from '../../utils/minimaxVoice';
import { resolveMiniMaxApiKey } from '../../utils/minimaxApiKey';
import { isCharBlockDisabled, setCharBlockDisabled } from '../../utils/blockSystem';

/**
 * 会话设置（聊天设置）全屏面板。
 * 结构对照参考设计：01 会话信息 / 02 绑定世界书 / 03 背景图 / 04 样式预设 / 05 体验 / 06 数据。
 * 所有更改即时保存：会话专属配置写 char.convoSettings，老字段沿用原 per-char 持久化。
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

// ── UI 原子 ────────────────────────────────────────────────────────────────

const Toggle: React.FC<{ on: boolean; onToggle: () => void; tone?: string }> = ({ on, onToggle, tone }) => (
    <button
        onClick={onToggle}
        className={`w-10 h-6 rounded-full p-1 transition-colors flex items-center shrink-0 ${on ? (tone || 'bg-primary') : 'bg-slate-200'}`}
        role="switch" aria-checked={on}
    >
        <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${on ? 'translate-x-4' : ''}`} />
    </button>
);

const Chip: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
    <button
        onClick={onClick}
        className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-all ${active ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
    >
        {children}
    </button>
);

const Sect: React.FC<{ num: string; title: string; children: React.ReactNode }> = ({ num, title, children }) => (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="flex items-baseline gap-2 px-4 pt-4 pb-1">
            <span className="text-[18px] font-black text-slate-200 leading-none select-none">{num}</span>
            <span className="text-[12px] font-bold text-slate-500 tracking-widest">{title}</span>
        </div>
        <div className="px-4 pb-4 divide-y divide-slate-50">{children}</div>
    </div>
);

const Item: React.FC<{ label: string; desc?: string; right?: React.ReactNode; children?: React.ReactNode }> = ({ label, desc, right, children }) => (
    <div className="py-3">
        <div className="flex items-center justify-between gap-3">
            <label className="text-[12px] font-bold text-slate-600">{label}</label>
            {right}
        </div>
        {desc && <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">{desc}</p>}
        {children && <div className="mt-2">{children}</div>}
    </div>
);

/** 图片槽位：预览 + 上传 + 清除（统一走 processImage 压缩） */
const ImgSlot: React.FC<{
    label: string;
    value?: string;
    fallbackHint?: string;
    aspect?: string;
    onChange: (dataUrl: string | undefined) => void;
}> = ({ label, value, fallbackHint, aspect = 'aspect-[2/1]', onChange }) => {
    const inputRef = useRef<HTMLInputElement>(null);
    return (
        <div>
            <div className="text-[10px] font-bold text-slate-400 mb-1">{label}</div>
            <div
                onClick={() => inputRef.current?.click()}
                className={`${aspect} bg-slate-50 rounded-xl border-2 border-dashed border-slate-200 flex items-center justify-center cursor-pointer hover:border-primary/50 overflow-hidden relative`}
            >
                {value ? (
                    <img src={value} className="w-full h-full object-cover" alt="" />
                ) : (
                    <span className="text-[9px] text-slate-300 px-2 text-center leading-relaxed">未设置{fallbackHint ? `（${fallbackHint}）` : ''}</span>
                )}
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
            {value && <button onClick={() => onChange(undefined)} className="text-[9px] text-red-400 mt-0.5">清除</button>}
        </div>
    );
};

const REGION_PRESETS = ['中国大陆', '港澳台', '日本', '韩国', '北美', '欧洲', '东南亚'];
const CALL_SPRITE_EMOTIONS = ['默认', '开心', '难过', '生气', '惊讶', '害羞', '冷淡', '撒娇'];

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
        if (!key) { addToast('请先在设置中配置 MiniMax API Key', 'error'); return; }
        setVoicesLoading(true);
        try {
            const r = await fetchMiniMaxVoices(key, 'all');
            setVoices([...(r.system_voice || []), ...(r.voice_cloning || []), ...(r.voice_generation || [])]);
        } catch (e: any) {
            addToast(e?.message || '获取音色列表失败', 'error');
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
    const categoryMounted = (books: typeof worldbooks) => books.length > 0 && books.every(b => mountedIds.has(b.id));
    // 局部卷册：分组里至少有一条 scope 为 local（缺省即 local）的条目
    const localCategories = useMemo(
        () => bookCategories.filter(([, books]) => books.some(b => (b.scope || 'local') === 'local')),
        [bookCategories]
    );
    const mountedLocalCount = localCategories.filter(([, books]) => categoryMounted(books)).length;
    const toggleBookCategory = (category: string, books: typeof worldbooks) => {
        const current = char.mountedWorldbooks || [];
        if (categoryMounted(books)) {
            const ids = new Set(books.map(b => b.id));
            updateCharacter(char.id, { mountedWorldbooks: current.filter(b => !ids.has(b.id)) });
            addToast(`已卸载《${category}》`, 'info');
        } else {
            if (mountedLocalCount >= WB_BIND_LIMIT) {
                addToast(`最多绑定 ${WB_BIND_LIMIT} 本，先取消一些再试`, 'error');
                return;
            }
            const additions = books
                .filter(b => !mountedIds.has(b.id))
                .map(b => ({ id: b.id, title: b.title, content: b.content, category: b.category }));
            updateCharacter(char.id, { mountedWorldbooks: [...current, ...additions] });
            addToast(`已挂载《${category}》（${additions.length} 条）`, 'success');
        }
    };
    const clearMountedWorldbooks = () => {
        if (!(char.mountedWorldbooks || []).length) return;
        updateCharacter(char.id, { mountedWorldbooks: [] });
        addToast('已清空本会话绑定的世界书', 'info');
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
        <div className="absolute inset-0 z-[260] flex flex-col bg-[#f3f4f8] animate-fade-in" style={{ paddingTop: 'var(--safe-top)' }}>
            {/* 顶栏 */}
            <div className="shrink-0 flex items-center gap-2 px-3 py-3 bg-white/80 backdrop-blur-md border-b border-slate-100">
                <button onClick={onClose} className="p-2 -ml-1 rounded-full hover:bg-black/5 active:scale-90 transition-transform" aria-label="返回">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor" className="w-5 h-5 text-slate-600">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                    </svg>
                </button>
                <div className="min-w-0">
                    <div className="text-[15px] font-bold text-slate-700 leading-tight">聊天设置</div>
                    <div className="text-[10px] text-slate-400 truncate">{cs.remarkName || char.name} · 更改即时保存</div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar p-3 space-y-3 pb-10">

                {/* ════ 01 会话信息 ════ */}
                <Sect num="01" title="会话信息">
                    <Item label="备注名" desc="聊天顶栏、消息列表与聊天列表里显示的名字，不改变角色本名。">
                        <input
                            value={cs.remarkName || ''}
                            onChange={e => updateConvo({ remarkName: e.target.value || undefined })}
                            placeholder={char.name}
                            className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[13px] outline-none focus:ring-2 focus:ring-primary/20"
                        />
                    </Item>

                    <Item label="TA 对我的备注" desc="角色对你的称呼，会注入提示词——TA 平时就这么叫你。">
                        <input
                            value={cs.userNickname || ''}
                            onChange={e => updateConvo({ userNickname: e.target.value || undefined })}
                            placeholder="如：阿宝 / 小朋友 / 主人…"
                            className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[13px] outline-none focus:ring-2 focus:ring-primary/20"
                        />
                    </Item>

                    <Item label="角色资料条目" desc="角色主页展示的微信号 / 地区 / 个性签名，由你自行设定（不再 AI 生成），留空则不显示。">
                        <div className="space-y-2">
                            <div>
                                <div className="text-[10px] font-bold text-slate-400 mb-1">微信号</div>
                                <input
                                    value={char.socialProfile?.handle || ''}
                                    onChange={e => updateCharacter(char.id, { socialProfile: { ...char.socialProfile, handle: e.target.value } })}
                                    placeholder={`默认 moro_${char.id.slice(0, 10)}`}
                                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[12px] outline-none focus:ring-2 focus:ring-primary/20"
                                />
                            </div>
                            <div>
                                <div className="text-[10px] font-bold text-slate-400 mb-1">地区</div>
                                <input
                                    value={char.socialProfile?.region || ''}
                                    onChange={e => updateCharacter(char.id, { socialProfile: { handle: char.socialProfile?.handle || '', ...char.socialProfile, region: e.target.value || undefined } })}
                                    placeholder="如：安徽 亳州 / 日本 京都…"
                                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[12px] outline-none focus:ring-2 focus:ring-primary/20"
                                />
                            </div>
                            <div>
                                <div className="text-[10px] font-bold text-slate-400 mb-1">个性签名</div>
                                <input
                                    value={char.socialProfile?.bio || ''}
                                    onChange={e => updateCharacter(char.id, { socialProfile: { handle: char.socialProfile?.handle || '', ...char.socialProfile, bio: e.target.value || undefined } })}
                                    placeholder="角色主页展示的一句话签名…"
                                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[12px] outline-none focus:ring-2 focus:ring-primary/20"
                                />
                            </div>
                        </div>
                    </Item>

                    <Item label="关联群聊记忆" desc="私聊时携带 TA 所在群聊的近期活动作背景。不关联 = 群里发生的事这段单聊完全不知道。">
                        <div className="flex flex-wrap gap-1.5">
                            <Chip active={gmMode === 'all'} onClick={() => updateConvo({ groupMemoryMode: 'all' })}>全部群聊</Chip>
                            <Chip active={gmMode === 'none'} onClick={() => updateConvo({ groupMemoryMode: 'none' })}>不关联</Chip>
                            <Chip active={gmMode === 'selected'} onClick={() => updateConvo({ groupMemoryMode: 'selected' })}>指定群</Chip>
                        </div>
                        {gmMode === 'selected' && (
                            <div className="flex flex-wrap gap-1.5 mt-2">
                                {memberGroups.length === 0 && <span className="text-[10px] text-slate-300">TA 还不在任何群聊里</span>}
                                {memberGroups.map(g => {
                                    const on = (cs.linkedGroupIds || []).includes(g.id);
                                    return (
                                        <Chip key={g.id} active={on} onClick={() => {
                                            const cur = cs.linkedGroupIds || [];
                                            updateConvo({ linkedGroupIds: on ? cur.filter(id => id !== g.id) : [...cur, g.id] });
                                        }}>{g.name}</Chip>
                                    );
                                })}
                            </div>
                        )}
                    </Item>

                    <Item
                        label="记忆摘要"
                        desc="月度精炼记忆（由记忆归档生成），注入对话作为长期记忆。"
                        right={
                            <button onClick={() => setMemoryOpen(v => !v)} className="text-[11px] font-bold text-primary">
                                {refinedMonths.length} 个月 {memoryOpen ? '收起' : '查看'}
                            </button>
                        }
                    >
                        {memoryOpen && (
                            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                                {refinedMonths.length === 0 && <p className="text-[10px] text-slate-300">还没有归档记忆。在聊天里执行「记忆归档」后这里会出现月度总结。</p>}
                                {refinedMonths.map(([month, content]) => (
                                    <div key={month} className="bg-slate-50 rounded-xl p-2.5">
                                        <div className="text-[10px] font-bold text-slate-400 mb-1">{month}</div>
                                        <p className="text-[11px] text-slate-500 leading-relaxed whitespace-pre-wrap line-clamp-4">{content}</p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Item>

                    <Item label="顶栏装饰文案" desc="显示在聊天顶栏下方的小胶囊文字，纯装饰。">
                        <input
                            value={cs.headerDecorText || ''}
                            onChange={e => updateConvo({ headerDecorText: e.target.value || undefined })}
                            placeholder="如：恋爱进行时 / 三句话冷战中…"
                            className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[13px] outline-none focus:ring-2 focus:ring-primary/20"
                        />
                    </Item>

                    <Item label={`对话记忆 · 近端条数${unlimitedContext ? '（不限制）' : ` (${contextLimit})`}`} desc="每次对话携带的最近消息条数。再早的内容靠记忆摘要与记忆宫殿补足。">
                        <div className="flex items-center gap-2">
                            <input
                                type="range" min={20} max={5000} step={10}
                                value={Math.min(contextLimit, 5000)}
                                disabled={unlimitedContext}
                                onChange={e => setContextLimit(parseInt(e.target.value))}
                                className="flex-1 h-2 bg-slate-200 rounded-full appearance-none accent-primary disabled:opacity-40"
                            />
                            <Chip active={unlimitedContext} onClick={() => setContextLimit(unlimitedContext ? 500 : 100000)}>不限制</Chip>
                        </div>
                    </Item>

                    <Item
                        label="旁白模式" right={<Toggle on={!!cs.narrationMode} onToggle={() => updateConvo({ narrationMode: !cs.narrationMode })} />}
                        desc="开启后角色可单独发出（动作 / 场景旁白）气泡，描写此刻的动作、神态与环境。"
                    />

                    <Item
                        label="心声手记" right={<Toggle on={cs.innerVoiceEnabled !== false} onToggle={() => updateConvo({ innerVoiceEnabled: cs.innerVoiceEnabled === false })} />}
                        desc="「偷看心声」入口开关：生成角色没说出口的内心独白，不进入对话上下文。"
                    />

                    <Item label="专属铃声" desc="本会话新消息的通知音（灵动岛弹横幅时播放），点选即试听。">
                        <div className="flex flex-wrap gap-1.5">
                            {RINGTONE_PRESETS.map(p => (
                                <Chip
                                    key={p.id}
                                    active={(cs.ringtone || 'none') === p.id}
                                    onClick={() => { updateConvo({ ringtone: p.id as any }); playRingtone(p.id); }}
                                >{p.label}</Chip>
                            ))}
                        </div>
                    </Item>

                    <Item
                        label="对照翻译" right={<Toggle on={translationEnabled} onToggle={onToggleTranslation} />}
                        desc="开启后 AI 消息自动翻译为「选」的语言显示，点「译」切换到目标语言。"
                    >
                        {translationEnabled && (
                            <div className="space-y-2.5">
                                <div>
                                    <div className="text-[10px] font-bold text-slate-400 mb-1">选（气泡显示语言）</div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {['中文', 'English', '日本語', '한국어', 'Français', 'Español'].map(l => (
                                            <Chip key={`s-${l}`} active={translateSourceLang === l} onClick={() => onSetTranslateSourceLang(l)}>{l}</Chip>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[10px] font-bold text-slate-400 mb-1">译成</div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {['中文', 'English', '日本語', '한국어', 'Français', 'Español'].map(l => (
                                            <Chip key={`t-${l}`} active={translateTargetLang === l} onClick={() => onSetTranslateLang(l)}>{l}</Chip>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[10px] font-bold text-slate-400 mb-1">译文风格</div>
                                    <input
                                        value={cs.translateStyle || ''}
                                        onChange={e => updateConvo({ translateStyle: e.target.value || undefined })}
                                        placeholder="如：口语化 / 文学腔 / 保留语气词…（追加进翻译要求）"
                                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[12px] outline-none focus:ring-2 focus:ring-primary/20"
                                    />
                                </div>
                            </div>
                        )}
                    </Item>

                    <Item
                        label="隐藏时间戳" right={<Toggle on={!!cs.hideTimestamp} onToggle={() => updateConvo({ hideTimestamp: !cs.hideTimestamp })} />}
                        desc="本会话不显示消息时间（覆盖全局外观设置）。"
                    />

                    <Item
                        label="时间感知" right={<Toggle on={char.timeAwarenessEnabled !== false} onToggle={() => updateCharacter(char.id, { timeAwarenessEnabled: char.timeAwarenessEnabled === false })} />}
                        desc="注入「距离上次聊天已过去多久」等提示，强化角色的时间观念、主动匹配现实时间。"
                    />

                    <Item label="所在地区" desc="角色生活的地区：作息、时差、天气、日常话题都会贴合此地区。">
                        <div className="flex flex-wrap gap-1.5 mb-2">
                            {REGION_PRESETS.map(r => (
                                <Chip key={r} active={cs.region === r} onClick={() => updateConvo({ region: cs.region === r ? undefined : r })}>{r}</Chip>
                            ))}
                        </div>
                        <input
                            value={cs.region && !REGION_PRESETS.includes(cs.region) ? cs.region : ''}
                            onChange={e => updateConvo({ region: e.target.value || undefined })}
                            placeholder="或自定义：如「日本 京都」「重庆」…"
                            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[12px] outline-none focus:ring-2 focus:ring-primary/20"
                        />
                    </Item>

                    <Item
                        label="主动查询" right={<Toggle on={!!cs.proactiveLookup} onToggle={() => updateConvo({ proactiveLookup: !cs.proactiveLookup })} />}
                        desc="开启后角色发消息前会先留意当前时间 / 天气 / 热点等实时信息，把它们自然融进话题（需在全局设置开启实时信息源）。"
                    />

                    <Item
                        label="主动语音通话"
                        right={<Toggle on={!!cs.proactiveCallEnabled} onToggle={() => updateConvo({ proactiveCallEnabled: !cs.proactiveCallEnabled })} />}
                        desc="开启后，角色在主动找你时会根据人设和剧情自行决定要不要直接打语音电话给你（主动消息在聊天界面下方 + 号面板里开启）。来电可接听或挂断，没接到会留下未接来电记录。"
                    />

                    <Item label="主动发朋友圈" desc="角色自发更新朋友圈的倾向。「随缘」由 TA 心情决定；聊天里 TA 也会提到自己发的动态。">
                        <div className="flex flex-wrap gap-1.5 items-center">
                            <Chip active={!cs.momentsAutoPost || cs.momentsAutoPost === 'off'} onClick={() => updateConvo({ momentsAutoPost: 'off' })}>关闭</Chip>
                            <Chip active={cs.momentsAutoPost === 'random'} onClick={() => updateConvo({ momentsAutoPost: 'random' })}>随缘</Chip>
                            <Chip active={typeof cs.momentsAutoPost === 'number'} onClick={() => updateConvo({ momentsAutoPost: typeof cs.momentsAutoPost === 'number' ? cs.momentsAutoPost : 24 })}>自定义</Chip>
                            {typeof cs.momentsAutoPost === 'number' && (
                                <span className="inline-flex items-center gap-1">
                                    <input
                                        type="number" min={1}
                                        value={cs.momentsAutoPost}
                                        onChange={e => updateConvo({ momentsAutoPost: Math.max(1, parseInt(e.target.value) || 24) })}
                                        className="w-16 px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-[12px] outline-none"
                                    />
                                    <span className="text-[10px] text-slate-400">小时/条</span>
                                </span>
                            )}
                        </div>
                    </Item>

                    <Item
                        label="允许 char 看手机" right={<Toggle on={!!cs.allowPhoneBrowse} onToggle={() => updateConvo({ allowPhoneBrowse: !cs.allowPhoneBrowse })} />}
                        desc="开启后角色会不定期主动拿走你的手机翻看（界面变成你的桌面，TA 一边翻一边冒想法，还可能替你回消息/拉黑别人）。中途想拿回手机需征得 TA 同意、答对 TA 出的三个问题或强行抢回。关闭则角色不会发起。"
                    />

                    <Item
                        label="自动线下" right={<Toggle on={!!cs.autoOffline} onToggle={() => updateConvo({ autoOffline: !cs.autoOffline })} />}
                        desc="对话发展到见面情境时角色会进入线下模式：弹出线下场景窗口记录现场情景，你可在窗口内发言/行动。退出后情景进入上下文，角色会主动发消息收尾。关闭则角色不会进入线下模式。"
                    />

                    <Item label="发消息方式" desc="碎片短句 = 像真人一样拆成多条短消息；完整段落 = 一条说完。">
                        <div className="flex gap-1.5">
                            <Chip active={(cs.bubbleStyleMode || 'split') === 'split'} onClick={() => updateConvo({ bubbleStyleMode: 'split' })}>碎片短句</Chip>
                            <Chip active={cs.bubbleStyleMode === 'whole'} onClick={() => updateConvo({ bubbleStyleMode: 'whole' })}>完整段落</Chip>
                        </div>
                    </Item>

                    <Item
                        label="表情联想" right={<Toggle on={!!cs.emojiAssociation} onToggle={() => updateConvo({ emojiAssociation: !cs.emojiAssociation })} />}
                        desc="开启后角色会在情绪合适的时机联想并发送表情包。"
                    />

                    <Item label="表情分类总览" desc="点击分类可切换该分类的表情对本角色是否可用。">
                        <div className="flex flex-wrap gap-1.5">
                            {categories.length === 0 && <span className="text-[10px] text-slate-300">还没有表情分类</span>}
                            {categories.map(cat => {
                                const on = categoryEnabledForChar(cat);
                                return (
                                    <button
                                        key={cat.id}
                                        onClick={() => toggleCategoryForChar(cat)}
                                        className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-all border ${on ? 'bg-violet-50 text-violet-600 border-violet-200' : 'bg-slate-50 text-slate-300 border-slate-100 line-through'}`}
                                    >
                                        {cat.name} ({emojiCounts[cat.id] || 0})
                                    </button>
                                );
                            })}
                        </div>
                    </Item>

                    <Item
                        label="角色音色（MiniMax）"
                        desc={char.voiceProfile?.voiceId ? `当前：${char.voiceProfile.voiceName || char.voiceProfile.voiceId}` : '未设置。语音消息与音视频通话都会用这个音色。'}
                        right={<button onClick={loadVoices} className="text-[11px] font-bold text-primary">{voicesLoading ? '加载中…' : voices ? '' : '选择音色'}</button>}
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
                                    addToast(`音色已设为 ${v.voice_name || v.voice_id}`, 'success');
                                }}
                                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[12px] outline-none"
                            >
                                <option value="">选择音色…</option>
                                {voices.map(v => <option key={v.voice_id} value={v.voice_id}>{v.voice_name || v.voice_id}</option>)}
                            </select>
                        )}
                    </Item>

                    <Item
                        label="语音消息" right={<Toggle tone="bg-emerald-400" on={!!char.chatVoiceEnabled} onToggle={() => updateCharacter(char.id, { chatVoiceEnabled: !char.chatVoiceEnabled })} />}
                        desc="AI 回复自动生成语音条（需配置 MiniMax 与角色音色）。"
                    >
                        {char.chatVoiceEnabled && (
                            <div className="flex flex-wrap gap-1.5">
                                {[{ v: '', l: '默认' }, { v: 'en', l: 'English' }, { v: 'ja', l: '日本語' }, { v: 'ko', l: '한국어' }, { v: 'fr', l: 'Français' }, { v: 'es', l: 'Español' }].map(o => (
                                    <Chip key={o.v} active={(char.chatVoiceLang || '') === o.v} onClick={() => updateCharacter(char.id, { chatVoiceLang: o.v })}>{o.l}</Chip>
                                ))}
                            </div>
                        )}
                    </Item>

                    <Item label="会话立绘" desc="角色立绘会以半透明形式出现在聊天界面右下角（galgame 式）；生图参考用于 img2img / edits 的底图。">
                        <div className="grid grid-cols-3 gap-2">
                            <ImgSlot label="角色·会话头像" aspect="aspect-square" value={cs.charAvatarOverride} fallbackHint="沿用角色头像" onChange={v => updateConvo({ charAvatarOverride: v })} />
                            <ImgSlot label="角色立绘" aspect="aspect-square" value={cs.spriteImage} onChange={v => updateConvo({ spriteImage: v })} />
                            <ImgSlot label="生图参考" aspect="aspect-square" value={cs.spriteRefImage} onChange={v => updateConvo({ spriteRefImage: v })} />
                        </div>
                    </Item>

                    <Item label="视频通话 · 通话立绘" desc="「默认」立绘会作为音视频通话的背景形象，其余情绪态为生图 / 通话表现的配置位。">
                        <div className="grid grid-cols-4 gap-2">
                            {CALL_SPRITE_EMOTIONS.map(emo => (
                                <ImgSlot
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
                    </Item>

                    <Item
                        label="每轮对话生图" right={<Toggle on={!!cs.perTurnImageGen} onToggle={() => updateConvo({ perTurnImageGen: !cs.perTurnImageGen })} />}
                        desc="生图管线配置位：开启后每轮回复尝试按场景配图（需接入生图 API，配合上方「生图参考」）。"
                    />

                    <Item
                        label="小红书" right={<Toggle tone="bg-red-400" on={!!char.xhsEnabled} onToggle={() => updateCharacter(char.id, { xhsEnabled: !char.xhsEnabled })} />}
                        desc="角色可在聊天中搜索、浏览、发帖、评论小红书（需全局配置 MCP 或 Cookie）。"
                    />

                    <Item
                        label="HTML 模块模式" right={<Toggle tone="bg-fuchsia-500" on={char.htmlModeEnabled !== false} onToggle={() => updateCharacter(char.id, { htmlModeEnabled: char.htmlModeEnabled === false })} />}
                        desc="AI 在合适场景输出邀请函 / 票据 / 通知等可视化卡片（默认开启）。"
                    >
                        {char.htmlModeEnabled !== false && (
                            <textarea
                                value={char.htmlModeCustomPrompt || ''}
                                onChange={e => updateCharacter(char.id, { htmlModeCustomPrompt: e.target.value })}
                                placeholder="自定义补充提示词（追加在内置之后）…"
                                className="w-full h-20 bg-slate-50 rounded-xl p-3 text-[12px] resize-none border border-slate-200 outline-none focus:border-fuchsia-300"
                            />
                        )}
                    </Item>
                </Sect>

                {/* ════ 02 绑定世界书 ════ */}
                <Sect num="02" title="绑定世界书">
                    <Item
                        label="卷册（可多选）"
                        desc={`全局卷自动注入；此处选局部。合计≤${WB_BIND_LIMIT} 本。条目开关与作用域在世界书 App 里管理。`}
                        right={
                            <button
                                onClick={clearMountedWorldbooks}
                                className="text-[11px] font-bold text-slate-400 border border-slate-200 rounded-full px-3 py-1 active:scale-95 transition-transform"
                            >清空</button>
                        }
                    >
                        <div className="text-[11px] text-slate-500 mb-2">
                            已绑定 {mountedLocalCount} 本 · 可选局部 {localCategories.length} 本 · 合计≤{WB_BIND_LIMIT}
                        </div>

                        {localCategories.length === 0 && (
                            <button onClick={() => openApp(AppID.Worldbook)} className="text-[11px] text-primary font-bold">还没有局部世界书，去「世界书」App 创建 →</button>
                        )}

                        {/* 已绑定的卷册（黑色 chip，点击即卸载） */}
                        {mountedLocalCount > 0 && (
                            <div className="flex flex-wrap gap-1.5 mb-2">
                                {localCategories.filter(([, books]) => categoryMounted(books)).map(([category, books]) => (
                                    <button
                                        key={`sel-${category}`}
                                        onClick={() => toggleBookCategory(category, books)}
                                        className="px-3 py-1.5 rounded-full text-[12px] font-bold bg-slate-900 text-white active:scale-95 transition-transform max-w-full truncate"
                                    >{category}</button>
                                ))}
                            </div>
                        )}

                        {localCategories.length > 0 && (
                            <button onClick={() => setWbListOpen(v => !v)} className="text-[11px] font-bold text-slate-500 border border-slate-200 rounded-full px-3 py-1 mb-2 active:scale-95 transition-transform">
                                {wbListOpen ? '收起' : '展开选择'}
                            </button>
                        )}

                        {wbListOpen && (
                            <div>
                                <input
                                    value={wbSearch}
                                    onChange={e => setWbSearch(e.target.value)}
                                    placeholder="搜索卷名…"
                                    className="w-full px-3 py-2.5 bg-white border border-slate-300 rounded-xl text-[13px] outline-none focus:ring-2 focus:ring-primary/20 mb-2"
                                />
                                <div className="flex flex-wrap gap-1.5 max-h-56 overflow-y-auto pr-1">
                                    {localCategories
                                        .filter(([category]) => !wbSearch.trim() || category.toLowerCase().includes(wbSearch.trim().toLowerCase()))
                                        .map(([category, books]) => {
                                            const on = categoryMounted(books);
                                            return (
                                                <button
                                                    key={category}
                                                    onClick={() => toggleBookCategory(category, books)}
                                                    title={`${books.length} 条目`}
                                                    className={`px-3 py-1.5 rounded-full text-[12px] font-bold active:scale-95 transition-all max-w-full truncate ${on ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 border border-slate-200'}`}
                                                >{category}</button>
                                            );
                                        })}
                                    {localCategories.length > 0 && wbSearch.trim() && localCategories.every(([category]) => !category.toLowerCase().includes(wbSearch.trim().toLowerCase())) && (
                                        <span className="text-[10px] text-slate-300 py-1">没有匹配「{wbSearch.trim()}」的卷册</span>
                                    )}
                                </div>
                            </div>
                        )}
                    </Item>
                </Sect>

                {/* ════ 03 背景图 ════ */}
                <Sect num="03" title="背景图">
                    <Item label="头像与画板" desc="仅作用于本会话的形象覆盖。">
                        <div className="grid grid-cols-3 gap-2">
                            <ImgSlot label="角色·本会话头像" aspect="aspect-square" value={cs.charAvatarOverride} fallbackHint="沿用角色头像" onChange={v => updateConvo({ charAvatarOverride: v })} />
                            <ImgSlot label="主控·本会话头像" aspect="aspect-square" value={cs.userAvatarOverride} fallbackHint="沿用我的头像" onChange={v => updateConvo({ userAvatarOverride: v })} />
                            <ImgSlot label="身份卡画板" aspect="aspect-square" value={cs.idCardImage} fallbackHint="角色资料页顶部" onChange={v => updateConvo({ idCardImage: v })} />
                        </div>
                    </Item>
                    <Item label="界面背景" desc="消息区背景即聊天壁纸；贴边是装饰横条；顶栏 / 输入栏背景通过白框样式注入。">
                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <div className="text-[10px] font-bold text-slate-400 mb-1">消息区背景（聊天壁纸）</div>
                                <div onClick={() => bgInputRef.current?.click()} className="aspect-[2/1] bg-slate-50 rounded-xl border-2 border-dashed border-slate-200 flex items-center justify-center cursor-pointer hover:border-primary/50 overflow-hidden">
                                    {char.chatBackground
                                        ? <img src={char.chatBackground} className="w-full h-full object-cover" alt="" />
                                        : <span className="text-[9px] text-slate-300">未设置（原画质上传）</span>}
                                </div>
                                <input type="file" ref={bgInputRef} className="hidden" accept="image/*" onChange={e => e.target.files?.[0] && onBgUpload(e.target.files[0])} />
                                {char.chatBackground && <button onClick={onRemoveBg} className="text-[9px] text-red-400 mt-0.5">清除</button>}
                            </div>
                            <ImgSlot label="顶部·头像背后（顶栏背景）" value={cs.headerBgImage} onChange={v => updateConvo({ headerBgImage: v })} />
                            <ImgSlot label="顶部贴边（顶栏下横条）" aspect="aspect-[4/1]" value={cs.headerEdgeImage} onChange={v => updateConvo({ headerEdgeImage: v })} />
                            <ImgSlot label="消息区贴边（输入栏上横条）" aspect="aspect-[4/1]" value={cs.msgEdgeImage} onChange={v => updateConvo({ msgEdgeImage: v })} />
                            <ImgSlot label="底部输入栏背景" aspect="aspect-[4/1]" value={cs.inputBarImage} onChange={v => updateConvo({ inputBarImage: v })} />
                        </div>
                    </Item>
                </Sect>

                {/* ════ 04 样式预设 ════ */}
                <Sect num="04" title="样式预设">
                    <Item
                        label="界面主题" desc="气泡 / 头像 / 顶栏 / 输入栏等全局聊天样式在「外观」App 里调整。"
                        right={<button onClick={() => openApp(AppID.Appearance)} className="text-[11px] font-bold text-primary">去外观 →</button>}
                    />
                    <Item
                        label="本会话专属白框 CSS" desc="只对这个角色生效的聊天界面自定义样式（.moro-chat-* 钩子），叠加在全局之上。"
                        right={<button onClick={onOpenChromeCss} className="text-[11px] font-bold text-primary">编辑 →</button>}
                    />
                </Sect>

                {/* ════ 05 体验 ════ */}
                <Sect num="05" title="体验">
                    <Item
                        label="隐藏系统日志" right={<Toggle on={hideSysLogs} onToggle={onToggleHideSysLogs} />}
                        desc="不再显示 Date / App 产生的上下文提示文本（转账、戳一戳、图片发送提示除外）。"
                    />
                    <Item
                        label="拉黑保护（整体开关）"
                        right={<Toggle tone="bg-rose-500" on={charBlockProtect} onToggle={() => {
                            const next = !charBlockProtect;
                            setCharBlockProtect(next);
                            setCharBlockDisabled(next);
                        }} />}
                        desc="开启后，所有角色都不会再触发「拉黑你」的行为（对全部会话生效）。已有的拉黑状态不受影响，会照常自动解除。"
                    />
                    <Item
                        label="管理上下文 / 隐藏历史" desc="从某条消息开始显示，隐藏之前的记录（不被 AI 读取）。"
                        right={<button onClick={onOpenHistoryManager} className="text-[11px] font-bold text-primary">打开 →</button>}
                    />
                </Sect>

                {/* ════ 06 数据 ════ */}
                <Sect num="06" title="数据">
                    <Item
                        label="导出聊天记录" desc={`当前共 ${messagesCount} 条可见消息，导出为 JSON 文件。`}
                        right={<button onClick={onExportChat} className="text-[11px] font-bold text-primary">导出 →</button>}
                    />
                    {char.memoryPalaceEnabled && onForceVectorize && (
                        <Item
                            label="记忆宫殿向量化" desc="将所有未处理的聊天记录交给记忆宫殿向量化，完成后可安全清空聊天。"
                            right={
                                <button onClick={onForceVectorize} disabled={isVectorizing} className="text-[11px] font-bold text-emerald-600 disabled:opacity-40">
                                    {isVectorizing ? '处理中…' : '🏰 一键向量化'}
                                </button>
                            }
                        />
                    )}
                    <Item label="危险区域" desc="清空本会话的聊天记录。">
                        <div className="flex items-center gap-2 mb-2 cursor-pointer" onClick={onTogglePreserveContext}>
                            <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${preserveContext ? 'bg-primary border-primary' : 'bg-slate-100 border-slate-300'}`}>
                                {preserveContext && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>}
                            </div>
                            <span className="text-[11px] text-slate-500">清空时保留最后 10 条记录（维持语境）</span>
                        </div>
                        <button onClick={onClearHistory} className="w-full py-2.5 bg-red-50 text-red-500 text-[12px] font-bold rounded-xl border border-red-100 active:scale-95 transition-transform">
                            执行清空
                        </button>
                    </Item>
                </Sect>
            </div>
        </div>
    );
};

export default ConvoSettingsPanel;
