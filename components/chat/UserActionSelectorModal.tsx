import React, { useEffect, useRef, useState } from 'react';
import { CharacterProfile, UserProfile, Message } from '../../types';
import type { ResolvedApi } from '../../utils/auxApi';
import { suggestUserActions } from '../../utils/userActionSuggest';

/**
 * 行动选择器弹窗（来往·聊天）。
 * 点最后一轮的 user 头像后弹出：根据最近上下文生成若干条「接下来可以发的话」，
 * 用户可自由编辑 / 删除 / 添加，挑一条发出去。纯手动触发，无开关。
 * 目标 6 条、保底至少 4 条：模型少给或失败时用空槽补齐，绝不出现只剩一条/空白的情况。
 */

/** 目标候选条数（向模型多要几条，方向更分散） */
const TARGET_COUNT = 6;
/** 无论如何都至少展示这么多条（不足用空槽补齐，供用户自己写） */
const MIN_OPTIONS = 4;

/** 把候选补齐到至少 MIN_OPTIONS 条（用空字符串占位）。 */
function padOptions(acts: string[]): string[] {
    const out = [...acts];
    while (out.length < MIN_OPTIONS) out.push('');
    return out;
}

interface Props {
    char: CharacterProfile;
    userProfile: UserProfile;
    recent: Message[];
    api: ResolvedApi;
    onClose: () => void;
    /** 选中（或编辑后的）一条，作为 user 发出 */
    onSend: (text: string) => void;
    addToast: (msg: string, type: 'info' | 'success' | 'error') => void;
}

/** 自适应高度的多行文本框：value 变化（含程序化填入候选）时自动撑高，不再截断长消息。 */
const AutoGrowTextarea: React.FC<{
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
}> = ({ value, onChange, placeholder }) => {
    const ref = useRef<HTMLTextAreaElement>(null);
    const resize = () => {
        const el = ref.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
    };
    // value 每次变化（生成候选、再想一组、编辑）都重新量高度
    useEffect(() => { resize(); }, [value]);
    return (
        <textarea
            ref={ref}
            value={value}
            onChange={e => onChange(e.target.value)}
            rows={1}
            placeholder={placeholder}
            className="flex-1 min-w-0 bg-transparent text-[13.5px] leading-relaxed text-slate-700 outline-none resize-none placeholder:text-slate-300 py-1"
            style={{ minHeight: 24 }}
            onInput={resize}
        />
    );
};

const UserActionSelectorModal: React.FC<Props> = ({ char, userProfile, recent, api, onClose, onSend, addToast }) => {
    const [options, setOptions] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const startedRef = useRef(false);

    const generate = async () => {
        setLoading(true);
        try {
            const acts = await suggestUserActions({ api, char, userProfile, recent, count: TARGET_COUNT });
            // 保底至少 MIN_OPTIONS 条：模型少给就用空槽补齐
            setOptions(padOptions(acts));
            if (!acts.length) addToast('没想出来，自己写两句吧～', 'info');
        } catch (e: any) {
            addToast(`想词失败：${e?.message || e}`, 'error');
            // 失败也保证至少 MIN_OPTIONS 个空槽，保留用户已编辑过的内容
            setOptions(prev => padOptions(prev.filter(o => o.trim())));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (startedRef.current) return;
        startedRef.current = true;
        void generate();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const updateOption = (i: number, val: string) => setOptions(prev => prev.map((o, idx) => (idx === i ? val : o)));
    const removeOption = (i: number) => setOptions(prev => prev.filter((_, idx) => idx !== i));
    const addOption = () => setOptions(prev => [...prev, '']);

    const send = (text: string) => {
        const t = text.trim();
        if (!t) { addToast('这条还是空的哦', 'info'); return; }
        onSend(t);
        onClose();
    };

    return (
        <div
            className="absolute inset-0 z-[460] flex flex-col justify-end animate-fade-in"
            style={{ background: 'rgba(30,24,33,0.42)', backdropFilter: 'blur(2px)' }}
            onClick={onClose}
        >
            <div
                className="relative w-full rounded-t-[22px] bg-white shadow-2xl flex flex-col max-h-[78%]"
                style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}
                onClick={e => e.stopPropagation()}
            >
                {/* 抓手 + 标题 */}
                <div className="pt-2.5 pb-1 flex flex-col items-center shrink-0">
                    <span className="w-9 h-1 rounded-full bg-slate-200" />
                </div>
                <div className="px-5 pt-1 pb-2 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2 min-w-0">
                        <img src={userProfile.avatar} className="w-7 h-7 rounded-full object-cover ring-1 ring-black/5" alt="" />
                        <div className="min-w-0">
                            <div className="text-[14px] font-bold text-slate-800 leading-tight">接下来说点啥？</div>
                            <div className="text-[10.5px] text-slate-400 leading-tight truncate">挑一条、改一改，或自己加一条发给 {char.name}</div>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="shrink-0 w-7 h-7 rounded-full bg-slate-100 text-slate-400 text-[14px] flex items-center justify-center active:scale-90 transition"
                        aria-label="关闭"
                    >✕</button>
                </div>

                {/* 选项列表 */}
                <div className="flex-1 overflow-y-auto no-scrollbar px-4 pt-1 pb-2 space-y-2.5">
                    {loading && options.length === 0 ? (
                        <div className="py-10 flex flex-col items-center gap-2 text-slate-400">
                            <span className="inline-flex gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-pink-300 animate-bounce" style={{ animationDelay: '0ms' }} />
                                <span className="w-1.5 h-1.5 rounded-full bg-pink-300 animate-bounce" style={{ animationDelay: '120ms' }} />
                                <span className="w-1.5 h-1.5 rounded-full bg-pink-300 animate-bounce" style={{ animationDelay: '240ms' }} />
                            </span>
                            <span className="text-[11.5px]">正在帮你想几句…</span>
                        </div>
                    ) : (
                        options.map((opt, i) => (
                            <div
                                key={i}
                                className="group rounded-2xl border border-slate-150 bg-slate-50/80 px-3 py-2.5 flex items-start gap-2 focus-within:border-pink-200 focus-within:bg-white transition-colors"
                                style={{ borderColor: '#eef0f3' }}
                            >
                                <span className="mt-1.5 w-5 h-5 shrink-0 rounded-full bg-white text-pink-400 text-[10px] font-bold flex items-center justify-center ring-1 ring-pink-100">{i + 1}</span>
                                <AutoGrowTextarea
                                    value={opt}
                                    onChange={val => updateOption(i, val)}
                                    placeholder="自己写点什么…"
                                />
                                <div className="flex items-center gap-1 shrink-0 self-center">
                                    <button
                                        onClick={() => removeOption(i)}
                                        className="w-7 h-7 rounded-full text-slate-300 hover:text-rose-400 text-[15px] flex items-center justify-center active:scale-90 transition"
                                        aria-label="删除这条"
                                        title="删除"
                                    >🗑</button>
                                    <button
                                        onClick={() => send(opt)}
                                        disabled={!opt.trim()}
                                        className="px-3.5 h-8 rounded-full text-white text-[12px] font-bold flex items-center justify-center active:scale-95 transition disabled:opacity-40"
                                        style={{ background: 'linear-gradient(135deg,#ff9eb5,#ff7aa0)' }}
                                    >发送</button>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* 底部操作：再来一组 / 加一条 */}
                <div className="px-4 pt-2 pb-1 flex items-center gap-2 shrink-0 border-t border-slate-100">
                    <button
                        onClick={() => { if (!loading) void generate(); }}
                        disabled={loading}
                        className="flex-1 h-10 rounded-full bg-slate-100 text-slate-600 text-[12.5px] font-bold active:scale-95 transition disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                        <span className={loading ? 'animate-spin' : ''} aria-hidden>↻</span>
                        {loading ? '想词中…' : '再想一组'}
                    </button>
                    <button
                        onClick={addOption}
                        className="flex-1 h-10 rounded-full text-pink-500 text-[12.5px] font-bold active:scale-95 transition flex items-center justify-center gap-1"
                        style={{ background: 'rgba(255,158,181,0.14)' }}
                    >＋ 自己加一条</button>
                </div>
            </div>
        </div>
    );
};

export default UserActionSelectorModal;
