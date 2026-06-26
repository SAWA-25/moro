
import React, { useState, useEffect, useCallback } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { XhsStockImage } from '../types';
import {
    InsShell, InsHeader, Chip, InsButton, InsEmpty, InsDialog, accent, INK, INK_SOFT,
} from '../components/ui/insKit';
import { Plus, X, ImageSquare } from '@phosphor-icons/react';

// 拾光图库的强调色（取自 constants：XhsStock = red）
const AC = 'red' as const;

const XhsStockApp: React.FC = () => {
    const { goBack, addToast } = useOS();
    const [images, setImages] = useState<XhsStockImage[]>([]);
    const [view, setView] = useState<'list' | 'add'>('list');
    const [newUrl, setNewUrl] = useState('');
    const [newTags, setNewTags] = useState('');
    const [previewOk, setPreviewOk] = useState<boolean | null>(null);
    const [confirmDialog, setConfirmDialog] = useState<{
        isOpen: boolean; title: string; message: string;
        variant: 'danger' | 'warning' | 'info'; onConfirm: () => void;
    } | null>(null);
    const [filterTag, setFilterTag] = useState<string | null>(null);

    const loadImages = useCallback(async () => {
        const imgs = await DB.getXhsStockImages();
        setImages(imgs.sort((a, b) => b.addedAt - a.addedAt));
    }, []);

    useEffect(() => { loadImages(); }, [loadImages]);

    // All unique tags
    const allTags = Array.from(new Set(images.flatMap(img => img.tags))).sort();

    const filteredImages = filterTag
        ? images.filter(img => img.tags.includes(filterTag))
        : images;

    const handleAdd = async () => {
        const url = newUrl.trim();
        if (!url) { addToast('请填写图片URL', 'error'); return; }
        if (!/^https?:\/\//i.test(url)) { addToast('URL必须以 http(s):// 开头', 'error'); return; }

        const tags = newTags.split(/[,，\s#]+/).map(t => t.trim()).filter(Boolean);
        if (tags.length === 0) { addToast('至少填一个标签', 'error'); return; }

        const img: XhsStockImage = {
            id: `xhs_stock_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            url,
            tags,
            addedAt: Date.now(),
            usedCount: 0,
        };

        await DB.saveXhsStockImage(img);
        setNewUrl('');
        setNewTags('');
        setPreviewOk(null);
        setView('list');
        await loadImages();
        addToast('图片已入库', 'success');
    };

    const handleDelete = (img: XhsStockImage) => {
        setConfirmDialog({
            isOpen: true,
            title: '删除图片',
            message: `确定删除这张图片吗？\n标签: ${img.tags.join(', ')}`,
            variant: 'danger',
            onConfirm: async () => {
                await DB.deleteXhsStockImage(img.id);
                await loadImages();
                addToast('已删除', 'success');
                setConfirmDialog(null);
            }
        });
    };

    const inputCls = 'w-full px-4 py-3 rounded-2xl bg-white text-[14px] focus:outline-none focus:ring-2 placeholder:text-slate-300';
    const inputStyle: React.CSSProperties = { border: `1px solid ${accent(AC).soft}`, boxShadow: '0 1px 2px rgba(38,38,38,0.04)' };

    const renderAddForm = () => (
        <div className="p-5 space-y-5 animate-fade-in relative z-10">
            {/* URL Input */}
            <div>
                <label className="text-[11px] font-bold uppercase tracking-wider mb-2 block" style={{ color: INK_SOFT }}>图片 URL</label>
                <input
                    type="url"
                    value={newUrl}
                    onChange={e => { setNewUrl(e.target.value); setPreviewOk(null); }}
                    placeholder="https://your-image-host.com/image.jpg"
                    className={inputCls}
                    style={inputStyle}
                />
            </div>

            {/* Preview（拍立得式相框预览） */}
            {newUrl && /^https?:\/\//i.test(newUrl) && (
                <div className="relative mx-auto" style={{ maxWidth: 240 }}>
                    <div className="p-2.5 pb-7 bg-white animate-develop" style={{ borderRadius: 10, boxShadow: '0 16px 32px -16px rgba(38,38,38,0.45)' }}>
                        <div className="relative overflow-hidden" style={{ borderRadius: 4, background: accent(AC).soft, minHeight: 120 }}>
                            <img
                                src={newUrl}
                                className="w-full object-cover"
                                style={{ maxHeight: 200, display: 'block' }}
                                onLoad={() => setPreviewOk(true)}
                                onError={() => setPreviewOk(false)}
                                alt="preview"
                            />
                            {previewOk === false && (
                                <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(255,235,235,0.95)' }}>
                                    <span className="text-[13px] font-bold" style={{ color: accent(AC).solid }}>图片加载失败，检查 URL</span>
                                </div>
                            )}
                        </div>
                        <div className="absolute left-0 right-0 bottom-1.5 text-center px-2">
                            <span className="text-[12px] font-bold" style={{ color: '#4a463f', fontFamily: 'var(--font-hand)' }}>新入库</span>
                        </div>
                    </div>
                </div>
            )}

            {/* Tags Input */}
            <div>
                <label className="text-[11px] font-bold uppercase tracking-wider mb-2 block" style={{ color: INK_SOFT }}>标签（空格 / 逗号分隔）</label>
                <input
                    type="text"
                    value={newTags}
                    onChange={e => setNewTags(e.target.value)}
                    placeholder="美食 咖啡 下午茶 或 #穿搭 #日常"
                    className={inputCls}
                    style={inputStyle}
                />
                {newTags && (
                    <div className="flex flex-wrap gap-1.5 mt-2.5">
                        {newTags.split(/[,，\s#]+/).filter(Boolean).map((tag, i) => (
                            <span key={i} className="px-2.5 py-1 text-[12px] rounded-full font-bold" style={{ background: accent(AC).soft, color: accent(AC).ink }}>#{tag}</span>
                        ))}
                    </div>
                )}
            </div>

            {/* Submit */}
            <InsButton variant="gradient" onClick={handleAdd} className="w-full py-3.5 text-sm" disabled={!newUrl || previewOk === false}>
                添加到图库
            </InsButton>
        </div>
    );

    const renderList = () => (
        <div className="flex-1 overflow-y-auto no-scrollbar min-h-0 relative z-10">
            {/* Tag filter */}
            {allTags.length > 0 && (
                <div className="flex gap-2 px-4 py-3 overflow-x-auto no-scrollbar">
                    <Chip active={!filterTag} accent={AC} onClick={() => setFilterTag(null)}>全部 · {images.length}</Chip>
                    {allTags.map(tag => {
                        const count = images.filter(img => img.tags.includes(tag)).length;
                        return (
                            <Chip key={tag} active={filterTag === tag} accent={AC} onClick={() => setFilterTag(filterTag === tag ? null : tag)}>#{tag} · {count}</Chip>
                        );
                    })}
                </div>
            )}

            {/* Image grid */}
            {filteredImages.length === 0 ? (
                <InsEmpty icon={<ImageSquare size={52} weight="thin" />} title="还没有囤图" hint="点右上角 + 把好看的图存进来，配上标签方便随时翻" />
            ) : (
                <div className="grid grid-cols-3 gap-[3px] px-[3px] pb-6">
                    {filteredImages.map((img, idx) => (
                        <div key={img.id} className="aspect-square relative overflow-hidden group press-soft" style={{ background: accent(AC).soft, borderRadius: 6 }}>
                            <img src={img.url} className="w-full h-full object-cover animate-photo-develop" style={{ animationDelay: `${Math.min(idx, 14) * 30}ms` }} loading="lazy" alt="" />
                            {/* Used count badge */}
                            {img.usedCount > 0 && (
                                <div className="absolute top-1.5 left-1.5 text-white text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: accent(AC).solid }}>
                                    ×{img.usedCount}
                                </div>
                            )}
                            {/* Tags overlay */}
                            <div className="absolute bottom-0 left-0 right-0 px-1.5 pb-1 pt-4" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.6), transparent)' }}>
                                <div className="flex flex-wrap gap-0.5">
                                    {img.tags.slice(0, 2).map((tag, i) => (
                                        <span key={i} className="text-[9px] font-medium text-white/90">#{tag}</span>
                                    ))}
                                    {img.tags.length > 2 && <span className="text-[9px] text-white/60">+{img.tags.length - 2}</span>}
                                </div>
                            </div>
                            {/* Delete button */}
                            <button
                                onClick={(e) => { e.stopPropagation(); handleDelete(img); }}
                                className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 active:opacity-100 transition-opacity"
                                style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}
                            >
                                <X size={13} weight="bold" color="white" />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );

    return (
        <InsShell accent={AC}>
            <InsDialog
                open={!!confirmDialog}
                title={confirmDialog?.title}
                en="DELETE PHOTO"
                accent={AC}
                onClose={() => setConfirmDialog(null)}
                actions={confirmDialog ? <>
                    <InsButton variant="soft" accent="slate" onClick={() => setConfirmDialog(null)} className="flex-1 py-2.5 text-[13px]">留着</InsButton>
                    <InsButton variant="solid" accent={AC} onClick={confirmDialog.onConfirm} className="flex-1 py-2.5 text-[13px]">删掉</InsButton>
                </> : null}
            >
                <span style={{ whiteSpace: 'pre-line' }}>{confirmDialog?.message}</span>
            </InsDialog>

            <InsHeader
                accent={AC}
                title={view === 'add' ? '添加图片' : '拾光图库'}
                en={view === 'add' ? 'NEW PHOTO' : `${images.length} IN STASH`}
                onBack={view === 'add' ? () => setView('list') : goBack}
                right={view === 'list' ? (
                    <button onClick={() => setView('add')} className="w-9 h-9 rounded-full flex items-center justify-center text-white press-soft" style={{ background: accent(AC).solid, boxShadow: `0 10px 20px -10px ${accent(AC).solid}` }}>
                        <Plus size={19} weight="bold" />
                    </button>
                ) : undefined}
            />

            {view === 'add' ? renderAddForm() : renderList()}
        </InsShell>
    );
};

export default XhsStockApp;
