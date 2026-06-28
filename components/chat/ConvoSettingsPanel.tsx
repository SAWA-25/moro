import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { CharacterProfile, ConvoSettings, EmojiCategory, AppID, PrivateChatArchive } from '../../types';
import { processImage } from '../../utils/file';
import { RINGTONE_PRESETS, playRingtone } from '../../utils/ringtone';
import { fetchMiniMaxVoices, MiniMaxVoiceItem } from '../../utils/minimaxVoice';
import { resolveMiniMaxApiKey } from '../../utils/minimaxApiKey';
import { isCharBlockDisabled, setCharBlockDisabled } from '../../utils/blockSystem';
import { isScheduleFeatureOn } from '../../utils/scheduleGenerator';
import { isAuxApiOn } from '../../utils/auxApi';
import { PAPER_TONES, MONO_STACK, CUTE_STACK } from '../handbook/paper';

/**
 * 聊天设置（会话设置）全屏面板。
 * 原 01~06 分区重排成 12 个功能区：
 *   P.01 名字与名片 / P.02 氛围布置 / P.03 记性 / P.04 说话的样子 / P.05 TA 的小日子
 *   P.06 相片角 / P.07 世界书挂载 / P.08 界面背景 / P.09 外观设置 / P.10 使用习惯 / P.11 私聊档案 / P.12 数据管理
 * 功能、数据流与持久化与旧版完全一致：会话专属配置写 char.convoSettings，
 * 老字段沿用原 per-char 持久化；所有更改即时保存。
 */

interface ConvoSettingsPanelProps {
    char: CharacterProfile;
    onClose: () => void;
    // 对话记忆（上下文条数）—— Chat 本地态 + char 字段双写
    contextLimit: number;
    onContextLimitChange: (v: number) => void;
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
    onClearChatContextOnly: () => void;
    preserveContext: boolean;
    onTogglePreserveContext: () => void;
    isVectorizing?: boolean;
    onForceVectorize?: () => void;
    onExportChat: () => void;
    messagesCount: number;
    privateChatArchives: PrivateChatArchive[];
    activePrivateChatId?: string;
    onNewPrivateChat: () => void;
    onSwitchPrivateChat: (archiveId: string) => void;
    onRenamePrivateChat: (archiveId: string, title: string) => void;
    onTogglePinPrivateChat: (archiveId: string) => void;
    onDeletePrivateChat: (archiveId: string) => void;
    onExportPrivateChat: (archiveId: string) => void;
    onImportPrivateChat: (file: File) => void;
    // 表情
    categories: EmojiCategory[];
    emojiCounts: Record<string, number>;
    onSaveCategoryVisibility: (categoryId: string, allowedCharacterIds: string[] | undefined) => void;
    // 消息区背景（沿用 char.chatBackground 的上传管线）
    onBgUpload: (file: File) => void;
    onRemoveBg: () => void;
    // 日程表：打开今日日程卡片（由 Chat 切到 schedule modal）
    onOpenSchedule: () => void;
    // 回顾摘要：打开「日回顾 / 周回顾 / 月回顾」弹层
    onOpenTabloid: () => void;
}

// ── 淡色设置 UI 原子 ─────────────────────────────────────────────────────

/** 轻量开关：私聊设置同款淡玫瑰色 */
const CandyToggle: React.FC<{ on: boolean; onToggle: () => void; candy?: string }> = ({ on, onToggle, candy = '#d8a5b7' }) => (
    <button
        onClick={onToggle} role="switch" aria-checked={on}
        className="relative w-[52px] h-[28px] shrink-0 rounded-full transition-all duration-300 active:scale-95"
        style={{
            background: on ? candy : '#f8f4f6',
            border: '1px solid #eed6df',
            boxShadow: on ? '0 8px 16px -12px rgba(122,90,114,0.42)' : 'inset 0 1px 2px rgba(122,90,114,0.08)',
        }}
    >
        <span className="absolute top-1/2 -translate-y-1/2 text-[8px] font-bold transition-opacity duration-300 pointer-events-none" style={{ ...MONO_STACK, left: 8, color: 'rgba(255,255,255,0.92)', opacity: on ? 1 : 0 }}>ON</span>
        <span className="absolute top-1/2 -translate-y-1/2 text-[8px] font-bold transition-opacity duration-300 pointer-events-none" style={{ ...MONO_STACK, right: 7, color: '#d8c2cd', opacity: on ? 0 : 1 }}>off</span>
        <span
            className="absolute top-1/2 -translate-y-1/2 w-[22px] h-[22px] rounded-full bg-white transition-all duration-300"
            style={{ left: on ? 27 : 3, boxShadow: '0 2px 6px rgba(122,90,114,0.24)' }}
        />
    </button>
);

/** 标签胶囊：功能选项用，淡色、无旋转 */
const StickerChip: React.FC<{
    active: boolean; onClick: () => void; seed: string;
    candy?: string; strike?: boolean; title?: string; children: React.ReactNode;
}> = ({ active, onClick, seed, candy: _candy = '#d8a5b7', strike, title, children }) => (
    <button
        onClick={onClick} title={title} data-seed={seed}
        className={`px-3 py-1.5 text-[11px] font-bold rounded-full transition-all active:scale-95 max-w-full truncate ${strike ? 'line-through' : ''}`}
        style={{
            background: active ? '#fff4f7' : '#fffdfa',
            color: active ? '#5a3140' : '#a892a3',
            border: '1px solid #eed6df',
            boxShadow: active ? '0 6px 14px -12px rgba(122,90,114,0.35)' : 'none',
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
            ? { background: '#f6fbf8', border: '1px solid #dbe9e2', color: '#5f7f6d', boxShadow: '0 1px 2px rgba(122,90,114,0.08)', ...CUTE_STACK }
            : { background: '#fffdfa', border: '1px solid #eed6df', color: '#9c5e74', boxShadow: '0 1px 2px rgba(122,90,114,0.10)', ...CUTE_STACK }}
    >{children}</button>
);

/** 轻量输入框 */
const LineInput: React.FC<{ value: string; onChange: (v: string) => void; placeholder?: string; tag?: string }> = ({ value, onChange, placeholder, tag }) => (
    <div className="w-full">
        {tag && <div className="text-[9px] mb-0.5 tracking-wider" style={{ ...MONO_STACK, color: '#a892a3' }}>{tag}</div>}
        <input
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
            className="w-full px-3 py-2 text-[13px] outline-none rounded-[14px] placeholder:text-[#cfb8c4]"
            style={{ color: PAPER_TONES.ink, caretColor: '#d8a5b7', background: '#fffdfa', border: '1px solid #eed6df' }}
        />
    </div>
);

/** 功能区卡片 */
const Page: React.FC<{
    no: string; title: string; en: string;
    tape?: string; pattern?: string; paper?: string;
    children: React.ReactNode;
}> = ({ title, en, children }) => {
    return (
        <section className="relative rounded-[18px] bg-white" style={{ border: '1px solid #ededed', boxShadow: '0 1px 2px rgba(38,38,38,0.04), 0 14px 30px -24px rgba(38,38,38,0.22)' }}>
            <div className="flex items-center justify-between gap-2 px-4 pt-3.5 pb-1">
                <span className="text-[15px] font-bold leading-tight" style={{ color: PAPER_TONES.ink }}>{title}</span>
                <span className="text-[8.5px] tracking-[0.22em] uppercase select-none shrink-0" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>{en}</span>
            </div>
            <div className="px-4 pb-5 pt-1">{children}</div>
        </section>
    );
};

/** 条目：花朵记号 + 标题 + 旁注小字，条目间用缝线分隔 */
const Entry: React.FC<{ mark?: string; title: string; note?: string; side?: React.ReactNode; children?: React.ReactNode }> = ({ mark = '✿', title, note, side, children }) => (
    <div className="py-3 border-b last:border-b-0" style={{ borderColor: 'rgba(216,165,183,0.35)' }}>
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

/** 拍立得相框：保留照片感，使用平整淡色边框 */
const Polaroid: React.FC<{
    label: string; value?: string; hint?: string; aspect?: string;
    onChange: (dataUrl: string | undefined) => void;
}> = ({ label, value, hint, aspect = 'aspect-square', onChange }) => {
    const inputRef = useRef<HTMLInputElement>(null);
    return (
        <div>
            <div className="bg-white p-1.5 pb-2.5 rounded-[10px] relative" style={{ border: '1px solid #f0e2e7', boxShadow: '0 8px 18px -16px rgba(122,90,114,0.32)' }}>
                <div
                    onClick={() => inputRef.current?.click()}
                    className={`${aspect} overflow-hidden flex items-center justify-center cursor-pointer`}
                    style={{ background: '#faf3f6', border: value ? 'none' : '1px solid #eadbe2', borderRadius: 5 }}
                >
                    {value
                        ? <img src={value} className="w-full h-full object-cover" alt="" />
                        : <span className="text-[8.5px] text-center px-1.5 leading-relaxed" style={{ color: '#bfa8b8' }}>＋ 上传{hint ? <><br />{hint}</> : null}</span>}
                </div>
                <div className="flex items-center justify-between gap-1 pt-1">
                    <span className="text-[9px] font-bold truncate" style={{ ...CUTE_STACK, color: PAPER_TONES.inkSoft }}>{label}</span>
                    {value && <button onClick={() => onChange(undefined)} className="text-[8px] shrink-0" style={{ color: '#d4798f' }}>移除</button>}
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
        contextLimit, onContextLimitChange,
        translationEnabled, onToggleTranslation, translateSourceLang, translateTargetLang,
        onSetTranslateSourceLang, onSetTranslateLang,
        onOpenHistoryManager, onClearHistory, onClearChatContextOnly, preserveContext, onTogglePreserveContext,
        isVectorizing, onForceVectorize, onExportChat, messagesCount,
        privateChatArchives, activePrivateChatId,
        onNewPrivateChat, onSwitchPrivateChat, onRenamePrivateChat, onTogglePinPrivateChat, onDeletePrivateChat, onExportPrivateChat, onImportPrivateChat,
        categories, emojiCounts, onSaveCategoryVisibility,
        onBgUpload, onRemoveBg, onOpenSchedule, onOpenTabloid,
    } = props;
    const { updateCharacter, groups, worldbooks, characters, apiConfig, auxApiConfig, addToast, openApp, userProfile } = useOS();

    const cs: ConvoSettings = char.convoSettings || {};
    const updateConvo = (patch: Partial<ConvoSettings>) => {
        updateCharacter(char.id, { convoSettings: { ...char.convoSettings, ...patch } });
    };
    const defaultUserRemark = useMemo(() => {
        const name = (userProfile?.name || '').trim();
        return (name || '你').slice(0, 24);
    }, [userProfile?.name]);

    useEffect(() => {
        if ((char.convoSettings?.userNickname || '').trim()) return;
        const now = Date.now();
        updateCharacter(char.id, {
            convoSettings: {
                ...char.convoSettings,
                userNickname: defaultUserRemark,
                userRemarkMotivation: `默认备注：先按你的个人资料称呼你，之后 ${char.name} 可以根据剧情和相处主动改。`,
                userRemarkUpdatedAt: now,
                userRemarkHistory: [
                    { remark: defaultUserRemark, motivation: '私聊建立时自动生成的初始备注。', at: now },
                    ...(char.convoSettings?.userRemarkHistory || []),
                ].slice(0, 20),
            },
        });
    }, [char.id, char.name, char.convoSettings?.userNickname, defaultUserRemark]);

    const bgInputRef = useRef<HTMLInputElement>(null);
    const archiveImportRef = useRef<HTMLInputElement>(null);
    const [archiveSearch, setArchiveSearch] = useState('');
    const [renameArchiveId, setRenameArchiveId] = useState<string | null>(null);
    const [renameTitle, setRenameTitle] = useState('');

    // ── 拉黑保护（整体开关，localStorage 持久化，对所有会话生效） ──
    const [charBlockProtect, setCharBlockProtect] = useState(() => isCharBlockDisabled());

    // ── MiniMax 音色 ──
    const [voices, setVoices] = useState<MiniMaxVoiceItem[] | null>(null);
    const [voicesLoading, setVoicesLoading] = useState(false);
    const filteredPrivateArchives = useMemo(() => {
        const q = archiveSearch.trim().toLowerCase();
        if (!q) return privateChatArchives;
        return privateChatArchives.filter(a =>
            a.title.toLowerCase().includes(q)
            || (a.lastMessagePreview || '').toLowerCase().includes(q)
            || (a.messages || []).some(m => (m.content || '').toLowerCase().includes(q))
        );
    }, [archiveSearch, privateChatArchives]);
    const archiveTimeLabel = (ts?: number) => {
        if (!ts) return '刚刚';
        const d = new Date(ts);
        return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    };
    const beginRenameArchive = (archive: PrivateChatArchive) => {
        setRenameArchiveId(archive.id);
        setRenameTitle(archive.title);
    };
    const commitRenameArchive = () => {
        if (!renameArchiveId || !renameTitle.trim()) return;
        onRenamePrivateChat(renameArchiveId, renameTitle);
        setRenameArchiveId(null);
        setRenameTitle('');
    };
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

    // ── 角色备忘录（待办/随手记/小心事）：用户帮记 + 让 TA 自己写，注入聊天上下文 ──
    const [memoOpen, setMemoOpen] = useState(false);
    const [newMemoText, setNewMemoText] = useState('');
    const [memoGenerating, setMemoGenerating] = useState(false);
    const addMemo = () => {
        const t = newMemoText.trim();
        if (!t) return;
        const m = { id: `memo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, text: t.slice(0, 200), createdAt: Date.now(), by: 'user' as const };
        updateCharacter(char.id, { memos: [m, ...(char.memos || [])].slice(0, 50) });
        setNewMemoText('');
    };
    const deleteMemo = (id: string) => updateCharacter(char.id, { memos: (char.memos || []).filter(m => m.id !== id) });
    const toggleMemoDone = (id: string) => updateCharacter(char.id, { memos: (char.memos || []).map(m => m.id === id ? { ...m, done: !m.done } : m) });
    const generateMemos = async () => {
        if (!apiConfig.apiKey) { addToast('先去「文具盒」配置好聊天 API', 'error'); return; }
        setMemoGenerating(true);
        try {
            const persona = (char.systemPrompt || char.description || '').slice(0, 800);
            const prompt = `你是「${char.name}」。请根据你的人设，写 3~4 条你自己手机备忘录里会有的内容（待办、随手记、藏起来的小心事、清单等，要贴合你的性格与生活，简短自然）。\n\n你的人设：${persona}\n\n只输出 JSON 字符串数组，例如：["明天记得交房租","想给 TA 买生日礼物，纠结选什么","健身：周一三五"]`;
            const res = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify({ model: apiConfig.model, messages: [{ role: 'user', content: prompt }], temperature: 0.9 }),
            });
            if (!res.ok) throw new Error('生成失败，再试一次');
            const data = await res.json();
            let txt: string = data?.choices?.[0]?.message?.content || '';
            txt = txt.replace(/```json/g, '').replace(/```/g, '').trim();
            const a = txt.indexOf('['), b = txt.lastIndexOf(']');
            if (a >= 0 && b > a) txt = txt.slice(a, b + 1);
            const arr = JSON.parse(txt);
            if (!Array.isArray(arr)) throw new Error('格式不对，再试一次');
            const newMemos = arr.filter((s: any) => typeof s === 'string' && s.trim()).slice(0, 4)
                .map((s: string) => ({ id: `memo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, text: s.trim().slice(0, 200), createdAt: Date.now(), by: 'char' as const }));
            if (newMemos.length === 0) throw new Error('没生成出内容，再试一次');
            updateCharacter(char.id, { memos: [...newMemos, ...(char.memos || [])].slice(0, 50) });
            setMemoOpen(true);
            addToast(`TA 记了 ${newMemos.length} 条`, 'success');
        } catch (e: any) {
            addToast(e?.message || '生成失败，再试一次', 'error');
        } finally {
            setMemoGenerating(false);
        }
    };

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
            addToast(`《${category}》已取消挂载`, 'info');
        } else {
            if (mountedLocalCount >= WB_BIND_LIMIT) {
                addToast(`最多挂载 ${WB_BIND_LIMIT} 个分组，先取消几个再来`, 'error');
                return;
            }
            const additions = books
                .filter(b => !mountedIds.has(b.id))
                .map(b => ({ id: b.id, title: b.title, content: b.content, category: b.category, enabled: b.enabled }));
            updateCharacter(char.id, { mountedWorldbooks: [...current, ...additions] });
            addToast(`《${category}》已挂载（${additions.length} 条）`, 'success');
        }
    };
    const clearMountedWorldbooks = () => {
        if (!(char.mountedWorldbooks || []).length) return;
        updateCharacter(char.id, { mountedWorldbooks: [] });
        addToast('世界书挂载已清空', 'info');
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
                backgroundColor: '#fafafa',
            }}
        >
            {/* 顶栏：ins 干净白 + 发丝下边线 */}
            <div
                className="shrink-0 flex items-center gap-3 px-3 py-3"
                style={{ background: '#ffffff', borderBottom: '1px solid #ededed' }}
            >
                <button
                    onClick={onClose}
                    className="w-9 h-9 rounded-full bg-white flex items-center justify-center active:scale-90 transition-transform shrink-0"
                    style={{ boxShadow: '0 1px 3px rgba(122,90,114,0.18)', border: '1px solid #ededed' }}
                    aria-label="返回聊天设置"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="#9c5e74" className="w-[18px] h-[18px]">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                    </svg>
                </button>
                <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                        <span className="text-[16px] font-bold leading-tight" style={{ color: '#5a3140' }}>聊天设置</span>
                        <span className="text-[8.5px] tracking-[0.24em] select-none" style={{ ...MONO_STACK, color: '#b07a8d' }}>CHAT SETTINGS</span>
                    </div>
                    <div className="text-[10px] truncate mt-0.5" style={{ color: '#a96f84' }}>{cs.remarkName || char.name} · 更改会自动保存</div>
                </div>
                <span className="text-[10px] select-none shrink-0 px-2 py-1 rounded-full" style={{ color: '#a96f84', background: '#fff4f7', border: '1px solid #eed6df' }}>已保存</span>
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

                    <Entry mark="♡" title="TA 怎么称呼你" note="TA 根据你们的相处和剧情，自己决定怎么称呼你；聊天里 TA 可以主动改备注，这里统一展示当前称呼和改名记录。">
                        <div className="space-y-2">
                            <div
                                className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-[14px] font-bold"
                                style={cs.userNickname
                                    ? { background: 'rgba(176,122,141,0.08)', border: '1px solid rgba(176,122,141,0.18)', color: '#a96f84' }
                                    : { background: 'rgba(148,163,184,0.06)', border: '1px solid rgba(148,163,184,0.18)', color: '#94a3b8' }}
                            >
                                <span className="opacity-60 text-[12px] font-normal shrink-0">现在叫你</span>
                                <span className="truncate">{cs.userNickname || '还没给你起备注'}</span>
                                {cs.userRemarkUpdatedAt && (
                                    <span className="text-[10px] text-slate-300 ml-auto shrink-0">{new Date(cs.userRemarkUpdatedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} 改</span>
                                )}
                            </div>
                            {cs.userRemarkMotivation && (
                                <div className="rounded-xl p-2.5 text-[12px] text-slate-600 leading-relaxed" style={{ background: 'rgba(176,122,141,0.08)', border: '1px solid rgba(176,122,141,0.18)' }}>
                                    💭 {cs.userRemarkMotivation}
                                </div>
                            )}
                            {cs.userRemarkHistory && cs.userRemarkHistory.length > 1 && (
                                <details className="text-[11px] text-slate-400">
                                    <summary className="cursor-pointer select-none py-1">TA 给你换过的备注（{cs.userRemarkHistory.length}）</summary>
                                    <ul className="mt-1 space-y-1.5">
                                        {cs.userRemarkHistory.map((h, i) => (
                                            <li key={i} className="flex flex-col gap-0.5 border-l-2 pl-2" style={{ borderColor: 'rgba(176,122,141,0.3)' }}>
                                                <span className="text-slate-600 font-bold">「{h.remark}」<span className="text-slate-300 font-normal ml-1">{new Date(h.at).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}</span></span>
                                                {h.motivation && <span className="text-slate-400 leading-snug">{h.motivation}</span>}
                                            </li>
                                        ))}
                                    </ul>
                                </details>
                            )}
                        </div>
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
                    <Entry mark="✩" title="顶栏文案" note="显示在聊天界面最顶端（顶栏卡片上方）的一句居中文案。">
                        <LineInput
                            value={cs.headerDecorText || ''}
                            onChange={v => updateConvo({ headerDecorText: v || undefined })}
                            placeholder="比如：보고 싶어…ㅠㅠ🖤 / 恋爱进行时"
                        />
                    </Entry>

                    <Entry mark="✩" title="底部文案" note="显示在消息列表下方、输入栏上方的一句居中文案。">
                        <LineInput
                            value={cs.footerDecorText || ''}
                            onChange={v => updateConvo({ footerDecorText: v || undefined })}
                            placeholder="比如：小狗勾流眼泪TT / 今天也想见你"
                        />
                    </Entry>

                    <Entry mark="✩" title="输入框提示语" note="输入框空着时显示的提示语（不填就是「说点什么…」）。">
                        <LineInput
                            value={cs.inputPlaceholderText || ''}
                            onChange={v => updateConvo({ inputPlaceholderText: v || undefined })}
                            placeholder="比如：( ʚಌɞ )삶의 조각들 / 说点什么…"
                        />
                    </Entry>

                    <Entry mark="✩" title="消息铃声" note="TA 来新消息时灵动岛横幅的提示音，点一下选项就能试听。">
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
                                style={{ accentColor: '#d8a5b7' }}
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
                        mark="✦" title="月度记忆摘要"
                        note="按月精炼出的长期记忆（记忆归档生成），每次聊天都会作为背景参考。"
                        side={
                            <PinButton onClick={() => setMemoryOpen(v => !v)}>
                                {refinedMonths.length} 个月 · {memoryOpen ? '收起' : '展开'}
                            </PinButton>
                        }
                    >
                        {memoryOpen && (
                            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                                {refinedMonths.length === 0 && (
                                    <p className="text-[10px]" style={{ color: PAPER_TONES.inkFaint }}>
                                        还没有月度摘要。在聊天里做一次「记忆归档」后会显示在这里。
                                    </p>
                                )}
                                {refinedMonths.map(([month, content]) => (
                                    <div key={month} className="rounded-[8px] p-2.5" style={{ background: '#fffdfa', border: '1px solid #eed6df' }}>
                                        <div className="text-[9px] mb-1" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>{month}</div>
                                        <p className="text-[11px] leading-relaxed whitespace-pre-wrap line-clamp-4" style={{ color: PAPER_TONES.inkSoft }}>{content}</p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Entry>

                    <Entry
                        mark="✎" title="TA 的备忘录"
                        note="TA 手机备忘录里的待办 / 随手记 / 小心事。聊天时随身带着，TA 会记得自己写过的事；你也能帮 TA 记一条。"
                        side={<PinButton onClick={() => setMemoOpen(v => !v)}>{(char.memos || []).length} 条 · {memoOpen ? '收起' : '展开'}</PinButton>}
                    >
                        {memoOpen && (
                            <div className="space-y-2">
                                <div className="flex gap-2">
                                    <input
                                        value={newMemoText}
                                        onChange={e => setNewMemoText(e.target.value)}
                                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addMemo(); } }}
                                        placeholder="帮 TA 记一条…"
                                        className="flex-1 text-[11px] px-2.5 py-1.5 rounded-[8px] outline-none"
                                        style={{ background: '#fffdfa', border: '1px solid #eed6df', color: PAPER_TONES.inkSoft }}
                                    />
                                    <button onClick={addMemo} className="text-[10px] px-3 rounded-[8px] shrink-0" style={{ background: '#fff4f7', color: '#9c5e74', border: '1px solid #eed6df' }}>记下</button>
                                </div>
                                <button onClick={generateMemos} disabled={memoGenerating} className="w-full text-[10px] py-1.5 rounded-[8px] disabled:opacity-50" style={{ background: '#fff4f7', color: '#9c5e74', border: '1px solid #eed6df' }}>
                                    {memoGenerating ? 'TA 正在记…' : '让 TA 自己记几条'}
                                </button>
                                <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                                    {(char.memos || []).length === 0 && (
                                        <p className="text-[10px]" style={{ color: PAPER_TONES.inkFaint }}>还没有备忘。帮 TA 记一条，或让 TA 自己写几条。</p>
                                    )}
                                    {(char.memos || []).map(m => (
                                        <div key={m.id} className="flex items-start gap-2 rounded-[8px] p-2" style={{ background: '#fffdfa', border: '1px solid #eed6df' }}>
                                            <button onClick={() => toggleMemoDone(m.id)} className="mt-0.5 shrink-0 w-3.5 h-3.5 rounded-[3px] flex items-center justify-center" style={{ border: `1.5px solid ${m.done ? '#d8a5b7' : '#d4c2cb'}`, background: m.done ? '#d8a5b7' : 'transparent' }}>
                                                {m.done && <span className="text-white text-[8px] leading-none">✓</span>}
                                            </button>
                                            <div className="min-w-0 flex-1">
                                                <p className={`text-[11px] leading-relaxed whitespace-pre-wrap break-all ${m.done ? 'line-through opacity-50' : ''}`} style={{ color: PAPER_TONES.inkSoft }}>{m.text}</p>
                                                <div className="text-[8px] mt-0.5" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>{m.by === 'char' ? 'TA 写的' : '你记的'} · {new Date(m.createdAt).toLocaleDateString()}</div>
                                            </div>
                                            <button onClick={() => deleteMemo(m.id)} className="text-[8px] shrink-0" style={{ color: '#d4798f' }}>删除</button>
                                        </div>
                                    ))}
                                </div>
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

                    <Entry mark="❀" title="表情包权限" note="选择哪些表情分类允许 TA 使用。划线表示这个分类暂时不可用。">
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

                    <Entry mark="☘" title="TA 的城市" note="给 TA 一座城：真实城市会接入真实天气，本地小吃/外卖也按真实情况来（查岗能看到 TA 点的真实外卖）；架空城市可挑个原型，按虚拟程度借用真实风物。">
                        {(() => {
                            const city = char.cityConfig;
                            const mode = city?.mode;
                            const setCity = (patch: Partial<NonNullable<typeof char.cityConfig>>) =>
                                updateCharacter(char.id, { cityConfig: { ...(char.cityConfig || { mode: 'real' as const }), ...patch } });
                            return (
                                <div className="space-y-2.5">
                                    <div className="flex flex-wrap gap-2">
                                        <StickerChip seed="city-off" active={!mode} candy="#d6c8e8" onClick={() => updateCharacter(char.id, { cityConfig: undefined })}>不设定</StickerChip>
                                        <StickerChip seed="city-real" active={mode === 'real'} candy="#d6c8e8" onClick={() => setCity({ mode: 'real' })}>真实城市</StickerChip>
                                        <StickerChip seed="city-virtual" active={mode === 'virtual'} candy="#d6c8e8" onClick={() => setCity({ mode: 'virtual' })}>架空城市</StickerChip>
                                    </div>
                                    {mode === 'real' && (
                                        <LineInput
                                            value={city?.realCity || ''}
                                            onChange={v => setCity({ realCity: v || undefined })}
                                            placeholder="真实城市名：「上海」「成都」「东京」…"
                                        />
                                    )}
                                    {mode === 'virtual' && (
                                        <div className="space-y-2">
                                            <LineInput
                                                value={city?.virtualName || ''}
                                                onChange={v => setCity({ virtualName: v || undefined })}
                                                placeholder="架空城市名：「A 市」「云港」…"
                                            />
                                            <LineInput
                                                value={city?.prototypeCity || ''}
                                                onChange={v => setCity({ prototypeCity: v || undefined })}
                                                placeholder="原型参考城市（可留空）：「上海」「北京」…"
                                            />
                                            <div className="flex items-center gap-2 pt-0.5">
                                                <span className="text-[10px] shrink-0" style={{ color: PAPER_TONES.inkSoft }}>虚拟程度</span>
                                                <input
                                                    type="range" min={0} max={100} step={5}
                                                    value={city?.fictionLevel ?? 50}
                                                    onChange={e => setCity({ fictionLevel: parseInt(e.target.value, 10) })}
                                                    className="flex-1 accent-[#bfa3dd]"
                                                />
                                                <span className="text-[10px] w-9 text-right tabular-nums" style={{ color: PAPER_TONES.ink }}>{city?.fictionLevel ?? 50}%</span>
                                            </div>
                                            <p className="text-[9.5px] leading-relaxed" style={{ color: PAPER_TONES.inkFaint }}>
                                                越低越贴近原型（可直接用真实地名/店名）；越高越架空（只借神韵、改写化用）。
                                            </p>
                                        </div>
                                    )}
                                </div>
                            );
                        })()}
                    </Entry>

                    <Entry mark="☘" title="TA 对时间的感知" note="分「实时感知」（明确告诉 TA 现在几点）和「时间流逝感知」（让 TA 知道两次聊天/没跟进的约定隔了多久）。线上线下可分开开关。">
                        <div className="space-y-3 pt-1">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="text-[11.5px] font-bold" style={{ ...CUTE_STACK, color: PAPER_TONES.ink }}>实时感知 · 线上</div>
                                    <p className="text-[9.5px] leading-relaxed mt-0.5" style={{ color: PAPER_TONES.inkFaint }}>在线聊天里把「当前真实时间」（几号、星期几、几点、上午下午）明确告诉 TA。</p>
                                </div>
                                <CandyToggle candy="#9ec7e8" on={cs.realtimeClockOnline !== false} onToggle={() => updateConvo({ realtimeClockOnline: cs.realtimeClockOnline === false })} />
                            </div>
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="text-[11.5px] font-bold" style={{ ...CUTE_STACK, color: PAPER_TONES.ink }}>实时感知 · 线下</div>
                                    <p className="text-[9.5px] leading-relaxed mt-0.5" style={{ color: PAPER_TONES.inkFaint }}>线下面对面（见面）模式里也把当前真实时间告诉 TA。线下多为架空场景，默认关。</p>
                                </div>
                                <CandyToggle candy="#9ec7e8" on={!!cs.realtimeClockOffline} onToggle={() => updateConvo({ realtimeClockOffline: !cs.realtimeClockOffline })} />
                            </div>
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="text-[11.5px] font-bold" style={{ ...CUTE_STACK, color: PAPER_TONES.ink }}>时间流逝感知</div>
                                    <p className="text-[9.5px] leading-relaxed mt-0.5" style={{ color: PAPER_TONES.inkFaint }}>两次聊天之间、或有没跟进的约定时，让 TA 知道「隔了多久」——短暂停顿、久别都会被 TA 察觉并回应。</p>
                                </div>
                                <CandyToggle on={char.timeAwarenessEnabled !== false} onToggle={() => updateCharacter(char.id, { timeAwarenessEnabled: char.timeAwarenessEnabled === false })} />
                            </div>
                        </div>
                    </Entry>

                    <Entry
                        mark="☘" title="回顾摘要"
                        note="按天 / 周 / 月整理你们最近发生的事，生成可查看的关系回顾。"
                        side={<CandyToggle candy="#d8a5b7" on={!!cs.tabloidEnabled} onToggle={() => updateConvo({ tabloidEnabled: !cs.tabloidEnabled })} />}
                    >
                        {cs.tabloidEnabled && (
                            <button
                                onClick={onOpenTabloid}
                                className="w-full py-2.5 text-[12px] font-bold rounded-[10px] active:scale-95 transition-transform"
                                style={{ background: '#fffdfa', border: '1.5px solid #eed6df', color: '#5a3140', boxShadow: '0 8px 18px -14px rgba(122,90,114,0.38)', ...CUTE_STACK }}
                            >打开回望</button>
                        )}
                    </Entry>

                    <Entry
                        mark="☘" title="TA 的日程表"
                        note="TA 有自己的一天：作息时间线 + 意识流独白，会悄悄染进聊天的语气与情绪。"
                        side={<CandyToggle on={isScheduleFeatureOn(char)} onToggle={() => updateCharacter(char.id, { scheduleFeatureEnabled: !isScheduleFeatureOn(char) })} />}
                    >
                        {isScheduleFeatureOn(char) && (
                            <div className="space-y-2">
                                <button
                                    onClick={onOpenSchedule}
                                    className="w-full py-2.5 text-[12px] font-bold rounded-[10px] active:scale-95 transition-transform"
                                    style={{ background: '#fff', border: '1.5px solid #bfa3dd', color: '#7a5aa0', boxShadow: '2px 2px 0 #ddccef', ...CUTE_STACK }}
                                >打开今日日程</button>
                                <p className="text-[9.5px] leading-relaxed" style={{ color: PAPER_TONES.inkFaint }}>
                                    {isAuxApiOn(auxApiConfig)
                                        ? '已接副 API：聊到约定/变更（“晚上八点一起看电影”“今天不去公司了”…）时，TA 会主动把日程调过来。'
                                        : '想让 TA 照着聊天主动调整日程？去「文具盒 → 副线盒（副 API）」开启副 API。'}
                                </p>
                            </div>
                        )}
                    </Entry>

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

                    <Entry
                        mark="☘" title="TA 会主动给你撕饭票"
                        note="到饭点、降温、你喊饿或聊到吃的时，TA 可能默默在「饭票」里替你点一单并代付，在聊天里生成一张能点开看的饭票小票。关掉则永远不会触发。"
                        side={<CandyToggle candy="#ffb27a" on={!!cs.proactiveTakeoutOrder} onToggle={() => updateConvo({ proactiveTakeoutOrder: !cs.proactiveTakeoutOrder })} />}
                    />

                    <Entry mark="☘" title="TA 发此刻的勤快度" note="TA 自己更新此刻的频率。「看心情」全凭 TA 当下的情绪；TA 聊天时也会提起自己发过的动态。">
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
                                        className="w-14 px-1 py-0.5 text-[12px] text-center outline-none border rounded-[8px] bg-[#fffdfa] border-[#eed6df] focus:border-[#d8a5b7]"
                                        style={{ color: PAPER_TONES.ink }}
                                    />
                                    <span className="text-[10px]" style={{ color: PAPER_TONES.inkSoft }}>小时一条</span>
                                </span>
                            )}
                        </div>
                    </Entry>

                    <Entry
                        mark="☘" title="允许 TA 查岗"
                        note="TA 会不定期主动拿走你的手机翻一翻（屏幕会变成你的桌面，TA 一边翻一边冒想法，甚至替你回消息、拉黑别人、锁住手机）。想中途拿回来，要么 TA 点头，要么答对 TA 出的三道题，要么硬抢；被锁住时还可以向 TA 要口令。关着的话 TA 不会动你手机。"
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

                {/* ═══ P.06 照片与立绘 ═══ */}
                <Page no="06" title="照片与立绘" en="Photo Assets" tape="blush" pattern="plain" paper="plain">
                    <Entry
                        mark="❅" title="TA 会自己挑头像"
                        note="打开后，TA 看到你发来的合适图片时，可以自主把那张图设成自己的头像；关掉后不再注入这条能力提示。"
                        side={<CandyToggle on={!!cs.allowCharAvatarFromUserImage} onToggle={() => updateConvo({ allowCharAvatarFromUserImage: !cs.allowCharAvatarFromUserImage })} />}
                    />

                    <Entry mark="❅" title="聊天立绘" note="立绘会半透明地显示在聊天界面右下角；「生图底图」是 img2img / edits 用的参考图。">
                        <div className="grid grid-cols-3 gap-3">
                            <Polaroid label="本会话头像" aspect="aspect-square" value={cs.charAvatarOverride} hint="沿用角色头像" onChange={v => updateConvo({ charAvatarOverride: v })} />
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

                {/* ═══ P.07 世界书挂载 ═══ */}
                <Page no="07" title="世界书挂载" en="Worldbooks" tape="blue" pattern="star" paper="mint">
                    <Entry
                        mark="❃" title="已挂载分组"
                        note={`全局分组会自动注入；这里选择本会话专用的局部分组，最多挂载 ${WB_BIND_LIMIT} 个。每条设定的开关和作用域在「剪报夹」App 调整。`}
                        side={<PinButton onClick={clearMountedWorldbooks}>全部取下</PinButton>}
                    >
                        <div className="text-[10px] mb-2.5" style={{ ...MONO_STACK, color: PAPER_TONES.inkSoft }}>
                            已挂载 {mountedLocalCount} / {WB_BIND_LIMIT} · 可选 {localCategories.length} 个分组
                        </div>

                        {localCategories.length === 0 && (
                            <PinButton onClick={() => openApp(AppID.Worldbook)}>去「剪报夹」App 新建分组</PinButton>
                        )}

                        {/* 已挂载分组，点击即取消 */}
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
                                <PinButton onClick={() => setWbListOpen(v => !v)}>{wbListOpen ? '收起列表' : '选择分组'}</PinButton>
                            </div>
                        )}

                        {wbListOpen && (
                            <div>
                                <LineInput
                                    value={wbSearch}
                                    onChange={setWbSearch}
                                    placeholder="搜索分组…"
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
                                        <span className="text-[10px] py-1" style={{ color: PAPER_TONES.inkFaint }}>没有匹配「{wbSearch.trim()}」的分组</span>
                                    )}
                                </div>
                            </div>
                        )}
                    </Entry>
                </Page>

                {/* ═══ P.08 界面背景 ═══ */}
                <Page no="08" title="界面背景" en="Wallpaper" tape="cream" pattern="lace" paper="sky">
                    <Entry mark="✿" title="本会话头像与资料图" note="只对本会话生效的形象覆盖，其他页面保持原设置。">
                        <div className="grid grid-cols-3 gap-3">
                            <Polaroid label="TA 的头像" aspect="aspect-square" value={cs.charAvatarOverride} hint="沿用角色头像" onChange={v => updateConvo({ charAvatarOverride: v })} />
                            <Polaroid label="我的头像" aspect="aspect-square" value={cs.userAvatarOverride} hint="沿用我的头像" onChange={v => updateConvo({ userAvatarOverride: v })} />
                            <Polaroid label="身份卡画板" aspect="aspect-square" value={cs.idCardImage} hint="角色资料页顶部" onChange={v => updateConvo({ idCardImage: v })} />
                        </div>
                    </Entry>

                    <Entry mark="✿" title="聊天背景" note="消息区壁纸、顶栏背景、输入栏背景和上下分隔条都在这里单独设置。">
                        <div className="grid grid-cols-2 gap-3">
                            {/* 聊天壁纸：沿用 onBgUpload 管线，原画质收录 */}
                            <div>
                                <div className="bg-white p-1.5 pb-2.5 rounded-[10px] relative" style={{ border: '1px solid #f0e2e7', boxShadow: '0 8px 18px -16px rgba(122,90,114,0.32)' }}>
                                    <div
                                        onClick={() => bgInputRef.current?.click()}
                                        className="aspect-[2/1] overflow-hidden flex items-center justify-center cursor-pointer"
                                        style={{ background: '#faf3f6', border: char.chatBackground ? 'none' : '1px solid #eadbe2', borderRadius: 5 }}
                                    >
                                        {char.chatBackground
                                            ? <img src={char.chatBackground} className="w-full h-full object-cover" alt="" />
                                            : <span className="text-[8.5px] text-center px-1.5 leading-relaxed" style={{ color: '#bfa8b8' }}>＋ 上传<br />原画质收录</span>}
                                    </div>
                                    <div className="flex items-center justify-between gap-1 pt-1">
                                        <span className="text-[9px] font-bold truncate" style={{ ...CUTE_STACK, color: PAPER_TONES.inkSoft }}>聊天壁纸（消息区）</span>
                                        {char.chatBackground && <button onClick={onRemoveBg} className="text-[8px] shrink-0" style={{ color: '#d4798f' }}>移除</button>}
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

                {/* ═══ P.09 外观设置 ═══ */}
                <Page no="09" title="外观设置" en="Appearance" tape="silver" pattern="stripe" paper="plain">
                    <Entry
                        mark="✄" title="全局聊天外观"
                        note="气泡、头像、顶栏、输入栏这些全局聊天样式，都在「外观」App 里设置。"
                        side={<PinButton onClick={() => openApp(AppID.Appearance)}>打开外观</PinButton>}
                    />
                </Page>

                {/* ═══ P.10 使用习惯 ═══ */}
                <Page no="10" title="使用习惯" en="Habits" tape="lavender" pattern="dot" paper="lined">
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
                        mark="✤" title="隐藏早期消息"
                        note="从某条消息开始展示，之前的记录会隐藏，AI 也读不到。"
                        side={<PinButton onClick={onOpenHistoryManager}>管理</PinButton>}
                    />
                </Page>

                {/* ═══ P.11 私聊档案 ═══ */}
                <Page no="11" title="私聊档案" en="Private Chats" tape="blush" pattern="heart" paper="cream">
                    <Entry
                        mark="✉" title="当前角色的聊天文件"
                        note="像 SillyTavern 一样给同一个角色保留多份私聊：新建、打开、改名、置顶、导入、导出、删除。"
                        side={
                            <div className="flex gap-1.5">
                                <PinButton tone="mint" onClick={onNewPrivateChat}>新聊天</PinButton>
                                <PinButton onClick={() => archiveImportRef.current?.click()}>导入</PinButton>
                            </div>
                        }
                    >
                        <input
                            ref={archiveImportRef}
                            type="file"
                            accept=".json,.jsonl,application/json"
                            className="hidden"
                            onChange={e => {
                                const f = e.target.files?.[0];
                                if (f) onImportPrivateChat(f);
                                e.target.value = '';
                            }}
                        />
                        <div className="grid grid-cols-1 gap-2.5">
                            <LineInput
                                value={archiveSearch}
                                onChange={setArchiveSearch}
                                placeholder="搜索标题、预览或聊天正文…"
                                tag="SEARCH"
                            />
                            <div className="flex flex-wrap gap-2">
                                <PinButton onClick={onOpenHistoryManager}>查当前记录</PinButton>
                                <PinButton onClick={onExportChat}>导出当前可见</PinButton>
                            </div>
                        </div>
                    </Entry>

                    <Entry mark="✉" title="聊天记录列表" note={`共 ${privateChatArchives.length} 份档案，置顶会排在最上面。`}>
                        <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
                            {filteredPrivateArchives.length === 0 && (
                                <div className="rounded-[14px] px-3 py-5 text-center text-[11px]" style={{ background: '#fffdfa', border: '1px dashed #eadbe2', color: PAPER_TONES.inkSoft }}>
                                    {archiveSearch.trim() ? '没有搜到匹配的私聊档案' : '还没有私聊档案。点「新聊天」会把当前聊天收进档案，并开启一页空白私聊。'}
                                </div>
                            )}

                            {filteredPrivateArchives.map(archive => {
                                const active = archive.id === activePrivateChatId;
                                const renaming = renameArchiveId === archive.id;
                                return (
                                    <div key={archive.id} className="rounded-[14px] p-3" style={{ background: active ? '#fff4f7' : '#fffdfa', border: active ? '1px solid #eab6c6' : '1px solid #eed6df' }}>
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-1.5 min-w-0">
                                                    {archive.pinned && <span className="text-[10px] shrink-0" style={{ color: '#c98ba0' }}>置顶</span>}
                                                    {active && <span className="text-[10px] shrink-0" style={{ color: '#7aa58a' }}>当前</span>}
                                                    {renaming ? (
                                                        <input
                                                            value={renameTitle}
                                                            onChange={e => setRenameTitle(e.target.value)}
                                                            className="min-w-0 flex-1 px-2 py-1 rounded-[10px] outline-none text-[12px] font-bold"
                                                            style={{ background: '#fff', border: '1px solid #e8cad4', color: PAPER_TONES.ink }}
                                                            maxLength={80}
                                                            autoFocus
                                                            onKeyDown={e => {
                                                                if (e.key === 'Enter') commitRenameArchive();
                                                                if (e.key === 'Escape') { setRenameArchiveId(null); setRenameTitle(''); }
                                                            }}
                                                        />
                                                    ) : (
                                                        <div className="text-[12.5px] font-bold truncate" style={{ ...CUTE_STACK, color: PAPER_TONES.ink }}>{archive.title}</div>
                                                    )}
                                                </div>
                                                <div className="text-[9.5px] mt-1" style={{ ...MONO_STACK, color: PAPER_TONES.inkFaint }}>
                                                    {archive.messageCount} 条 · {archiveTimeLabel(archive.updatedAt)}
                                                    {archive.source === 'sillytavern' ? ' · ST 导入' : ''}
                                                </div>
                                                <div className="text-[10.5px] mt-1.5 leading-relaxed line-clamp-2" style={{ color: PAPER_TONES.inkSoft }}>
                                                    {archive.lastMessagePreview || '这页还没有消息'}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex flex-wrap gap-1.5 mt-2.5">
                                            {renaming ? (
                                                <>
                                                    <PinButton tone="mint" onClick={commitRenameArchive}>保存</PinButton>
                                                    <PinButton onClick={() => { setRenameArchiveId(null); setRenameTitle(''); }}>取消</PinButton>
                                                </>
                                            ) : (
                                                <>
                                                    <PinButton tone="mint" onClick={() => onSwitchPrivateChat(archive.id)} disabled={active}>打开</PinButton>
                                                    <PinButton onClick={() => beginRenameArchive(archive)}>改名</PinButton>
                                                    <PinButton onClick={() => onTogglePinPrivateChat(archive.id)}>{archive.pinned ? '取消置顶' : '置顶'}</PinButton>
                                                    <PinButton onClick={() => onExportPrivateChat(archive.id)}>导出</PinButton>
                                                    <PinButton onClick={() => onDeletePrivateChat(archive.id)}>删除</PinButton>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </Entry>
                </Page>

                {/* ═══ P.12 数据管理 ═══ */}
                <Page no="12" title="数据管理" en="Data" tape="blush" pattern="heart" paper="cream">
                    <Entry
                        mark="❒" title="导出聊天记录"
                        note={`当前有 ${messagesCount} 条看得见的消息，可以导出为 JSON 文件。`}
                        side={<PinButton onClick={onExportChat}>导出 JSON</PinButton>}
                    />
                    {char.memoryPalaceEnabled && onForceVectorize && (
                        <Entry
                            mark="❒" title="送进回忆标本馆"
                            note="把还没处理的聊天记录全部交给回忆标本馆做向量化，办完之后就能放心清空聊天。"
                            side={
                                <PinButton tone="mint" onClick={onForceVectorize} disabled={isVectorizing}>
                                    {isVectorizing ? '处理中…' : '🏰 全部处理'}
                                </PinButton>
                            }
                        />
                    )}
                    <Entry mark="❒" title="清空记录" note="清空本会话的聊天记录，操作前请确认已经导出或保存需要的内容。">
                        <div className="rounded-[14px] p-3" style={{ border: '1px solid #f1c6d1', background: '#fff5f7' }}>
                            <div className="flex items-center gap-2 mb-2.5 cursor-pointer select-none" onClick={onTogglePreserveContext}>
                                <div
                                    className="w-4 h-4 rounded-[5px] flex items-center justify-center transition-colors shrink-0"
                                    style={preserveContext
                                        ? { background: '#ec7d9e', border: '1px solid #d4607f' }
                                        : { background: '#fff', border: '1.5px dashed #dcb4c2' }}
                                >
                                    {preserveContext && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>}
                                </div>
                                <span className="text-[11px]" style={{ color: PAPER_TONES.inkSoft }}>保留最近 10 条作为上下文</span>
                            </div>
                            <button
                                onClick={onClearChatContextOnly}
                                className="w-full py-2.5 mb-2 text-[12px] font-bold rounded-[10px] active:scale-95 transition-transform"
                                style={{ background: '#fffdfa', border: '1px solid #eed6df', color: '#9b6478', ...CUTE_STACK }}
                            >清空絮语上下文</button>
                            <button
                                onClick={onClearHistory}
                                className="w-full py-2.5 text-[12px] font-bold rounded-[10px] active:scale-95 transition-transform"
                                style={{ background: '#fff', border: '1px solid #e8889d', color: '#d4536f', ...CUTE_STACK }}
                            >清空聊天记录</button>
                        </div>
                    </Entry>
                </Page>

                <div className="text-center text-[10px] pb-1 select-none" style={{ ...CUTE_STACK, color: '#c39aab' }}>
                    设置已自动保存
                </div>
            </div>
        </div>
    );
};

export default ConvoSettingsPanel;
