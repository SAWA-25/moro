import React, { useState, useRef } from 'react';
import { DB } from '../../../utils/db';
import { processImage } from '../../../utils/file';
import type { DivinationCard } from '../../../types';
import { ArrowLeft, UploadSimple, Trash } from '@phosphor-icons/react';

/**
 * 牌库管理 —— 批量导入塔罗(0.jpg~77.jpg) / 雷诺曼(1.jpg~36.jpg)。
 * 按文件名数字解析 index；塔罗 0~77、雷诺曼 1~36。导入即压缩存 IndexedDB。
 */

interface Props {
    deck: 'tarot' | 'lenormand';
    images: Record<number, string>;     // 当前已导入：index→dataUrl
    onChanged: () => void;              // 导入/清空后通知父组件重载
    onBack: () => void;
    addToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

const DECK_META = {
    tarot: { name: '塔罗', total: 78, lo: 0, hi: 77, hint: '已内置整副公版韦特塔罗牌面，可直接占卜。想换成自己的牌？导入 78 张图，命名 0.jpg ～ 77.jpg（0 号为愚者，按韦特体系大→小阿卡纳）即可覆盖' },
    lenormand: { name: '雷诺曼', total: 36, lo: 1, hi: 36, hint: '雷诺曼无牌面图，已用每张对应的传统扑克牌（如 1骑士=9♥）代替牌面，可直接占卜。想换成自己的牌？导入 36 张图，命名 1.jpg ～ 36.jpg（牌号 1=骑士…36=十字）即可覆盖' },
} as const;

/** 从文件名解析牌号（取第一段数字）。 */
const parseIndex = (filename: string): number | null => {
    const base = filename.replace(/\.[^.]+$/, '');
    const m = base.match(/\d+/);
    if (!m) return null;
    const n = parseInt(m[0], 10);
    return Number.isFinite(n) ? n : null;
};

const CardDeckManager: React.FC<Props> = ({ deck, images, onChanged, onBack, addToast }) => {
    const meta = DECK_META[deck];
    const fileRef = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

    const importedCount = Object.keys(images).length;

    const handleFiles = async (files: FileList | null) => {
        if (!files || files.length === 0) return;
        setBusy(true);
        setProgress({ done: 0, total: files.length });
        const cards: DivinationCard[] = [];
        let skipped = 0;
        try {
            const arr = Array.from(files);
            for (let i = 0; i < arr.length; i++) {
                const f = arr[i];
                const idx = parseIndex(f.name);
                if (idx === null || idx < meta.lo || idx > meta.hi) { skipped++; setProgress({ done: i + 1, total: arr.length }); continue; }
                try {
                    const dataUrl = await processImage(f, { maxWidth: 720, quality: 0.82 });
                    cards.push({ id: `${deck}_${idx}`, deck, index: idx, dataUrl, addedAt: Date.now() });
                } catch { skipped++; }
                setProgress({ done: i + 1, total: arr.length });
            }
            if (cards.length > 0) await DB.bulkSaveDivinationCards(cards);
            onChanged();
            addToast(`导入 ${cards.length} 张${skipped ? `，跳过 ${skipped} 张（命名不符）` : ''}`, cards.length ? 'success' : 'error');
        } catch (e: any) {
            addToast('导入失败：' + (e?.message || e), 'error');
        } finally {
            setBusy(false);
            setProgress(null);
            if (fileRef.current) fileRef.current.value = '';
        }
    };

    const handleClear = async () => {
        if (!window.confirm(`清空整副「${meta.name}」牌库？（图片会被删除，可重新导入）`)) return;
        await DB.deleteDivinationDeck(deck);
        onChanged();
        addToast('已清空', 'success');
    };

    return (
        <div className="absolute inset-0 flex flex-col bg-[#14101c] text-white animate-fade-in overflow-hidden">
            <div className="relative flex items-center px-4 pt-3 pb-2 shrink-0 z-10">
                <button onClick={onBack} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-[11px] font-bold bg-white/10 hover:bg-white/15 text-white/80 active:scale-95 transition-all border border-white/10">
                    <ArrowLeft size={14} weight="bold" /> 返回
                </button>
                <div className="absolute left-1/2 -translate-x-1/2 text-[11px] tracking-[0.3em] text-white/45 select-none">{meta.name}牌库</div>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-10 space-y-4 z-10">
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 space-y-2">
                    <div className="flex items-center justify-between">
                        <span className="text-[13px] font-bold text-white/85">已导入 {importedCount} / {meta.total}</span>
                        {importedCount > 0 && (
                            <button onClick={() => void handleClear()} disabled={busy} className="text-rose-300/80 text-[11px] inline-flex items-center gap-1 active:scale-95 disabled:opacity-40">
                                <Trash size={13} weight="bold" /> 清空
                            </button>
                        )}
                    </div>
                    <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                        <div className="h-full bg-amber-300/80 transition-all" style={{ width: `${Math.round((importedCount / meta.total) * 100)}%` }} />
                    </div>
                    <p className="text-[11px] text-white/45 leading-relaxed">{meta.hint}</p>
                </div>

                <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={e => void handleFiles(e.target.files)}
                />
                <button
                    onClick={() => fileRef.current?.click()}
                    disabled={busy}
                    className="w-full py-3 rounded-xl text-sm font-black bg-amber-300/90 text-[#14101c] active:scale-95 disabled:opacity-50 inline-flex items-center justify-center gap-2"
                >
                    <UploadSimple size={18} weight="bold" />
                    {busy ? (progress ? `导入中 ${progress.done}/${progress.total}…` : '导入中…') : '批量选图导入'}
                </button>

                {/* 缩略预览网格 */}
                {importedCount > 0 && (
                    <div className="grid grid-cols-6 gap-1.5">
                        {Object.keys(images).map(Number).sort((a, b) => a - b).map(idx => (
                            <div key={idx} className="aspect-[2/3] rounded-md overflow-hidden bg-white/5 relative">
                                <img src={images[idx]} className="w-full h-full object-cover" loading="lazy" alt={`#${idx}`} />
                                <span className="absolute bottom-0 right-0 bg-black/60 text-white/80 text-[7px] px-1 rounded-tl">{idx}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default CardDeckManager;
