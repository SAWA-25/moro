import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ImageSquare, Sticker, Trash } from '@phosphor-icons/react';
import { Emoji, EmojiCategory } from '../../types';
import { processImage } from '../../utils/file';
import {
    ParsedEmojiImport,
    buildEmojiRecordsFromImageDrafts,
    cleanEmojiText,
    emojiNameFromFileName,
    normalizeEmojiCategoryId,
    parseEmojiImportText,
} from '../../utils/emojiImport';
import Modal, { INK, INK_SOFT, ScrapBtn, ScrapInput, ScrapNote, ScrapTextarea } from './ScrapModal';

export interface EmojiImportDraft {
    id: string;
    fileName: string;
    url: string;
    name: string;
    description: string;
}

export interface EmojiImportModalProps {
    isOpen: boolean;
    onClose: () => void;
    categories: EmojiCategory[];
    defaultCategoryId?: string;
    existingEmojis: Emoji[];
    onSave: (records: ParsedEmojiImport[]) => Promise<void> | void;
    addToast?: (msg: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
    title?: string;
}

const inputId = 'moro-emoji-image-import-input';

const normalizeCategories = (categories: EmojiCategory[]): EmojiCategory[] => {
    const seen = new Set<string>();
    const next: EmojiCategory[] = [];
    for (const cat of categories) {
        const id = normalizeEmojiCategoryId(cat.id);
        if (seen.has(id)) continue;
        seen.add(id);
        next.push({ ...cat, id });
    }
    if (!seen.has('default')) next.unshift({ id: 'default', name: '默认', isSystem: true });
    return next;
};

const EmojiImportModal: React.FC<EmojiImportModalProps> = ({
    isOpen,
    onClose,
    categories,
    defaultCategoryId,
    existingEmojis,
    onSave,
    addToast,
    title = '收集表情',
}) => {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [textImport, setTextImport] = useState('');
    const [drafts, setDrafts] = useState<EmojiImportDraft[]>([]);
    const [categoryId, setCategoryId] = useState(normalizeEmojiCategoryId(defaultCategoryId));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const categoryOptions = useMemo(() => normalizeCategories(categories), [categories]);

    useEffect(() => {
        if (!isOpen) return;
        setCategoryId(normalizeEmojiCategoryId(defaultCategoryId));
        setError('');
    }, [isOpen, defaultCategoryId]);

    const resetAndClose = () => {
        setTextImport('');
        setDrafts([]);
        setError('');
        setBusy(false);
        onClose();
    };

    const updateDraft = (id: string, patch: Partial<EmojiImportDraft>) => {
        setDrafts(prev => prev.map(draft => draft.id === id ? { ...draft, ...patch } : draft));
    };

    const removeDraft = (id: string) => {
        setDrafts(prev => prev.filter(draft => draft.id !== id));
    };

    const handleFiles = async (files: FileList | null) => {
        const picked = Array.from(files || []).filter(file => file.type.startsWith('image/'));
        if (fileInputRef.current) fileInputRef.current.value = '';
        if (picked.length === 0) return;
        setBusy(true);
        setError('');
        try {
            const used = new Set([
                ...existingEmojis.map(e => e.name),
                ...drafts.map(d => cleanEmojiText(d.name)).filter(Boolean),
            ]);
            const next: EmojiImportDraft[] = [];
            for (let i = 0; i < picked.length; i++) {
                const file = picked[i];
                const url = await processImage(file, { maxWidth: 512, quality: 0.85 });
                const baseName = emojiNameFromFileName(file.name);
                let name = baseName;
                let n = 2;
                while (used.has(name)) {
                    name = `${baseName}${n}`;
                    n += 1;
                }
                used.add(name);
                next.push({
                    id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
                    fileName: file.name,
                    url,
                    name,
                    description: '',
                });
            }
            setDrafts(prev => [...prev, ...next]);
            addToast?.(`已读入 ${next.length} 张图片`, 'success');
        } catch (err: any) {
            const message = err?.message || '图片处理失败';
            setError(message);
            addToast?.(message, 'error');
        } finally {
            setBusy(false);
        }
    };

    const handleSave = async () => {
        const textRecords = parseEmojiImportText(textImport, categoryId);
        const existingForImages: Emoji[] = [
            ...existingEmojis,
            ...textRecords.map(record => ({
                name: record.name,
                url: record.url,
                categoryId: record.categoryId,
                description: record.description,
            })),
        ];
        const imageRecords = buildEmojiRecordsFromImageDrafts(
            drafts.map(draft => ({
                fileName: draft.fileName,
                url: draft.url,
                name: draft.name,
                description: draft.description,
            })),
            existingForImages,
            categoryId,
        );
        const records = [...textRecords, ...imageRecords];
        if (records.length === 0) {
            setError('先选择图片，或贴入“名字--URL--备注”。');
            return;
        }
        setBusy(true);
        setError('');
        try {
            await onSave(records);
            setTextImport('');
            setDrafts([]);
        } finally {
            setBusy(false);
        }
    };

    const footer = (
        <>
            <ScrapBtn variant="paper" onClick={resetAndClose}>取消</ScrapBtn>
            <ScrapBtn onClick={handleSave} disabled={busy}>
                {busy ? '处理中…' : '收进表情包'}
            </ScrapBtn>
        </>
    );

    return (
        <Modal isOpen={isOpen} title={title} en="STICKERS" onClose={resetAndClose} footer={footer}>
            <div className="space-y-4">
                <ScrapNote>
                    图片会加入选中的分组；备注不会压到图上，只用于搜索和让角色更懂什么时候该用这张表情。
                </ScrapNote>

                <div className="space-y-2">
                    <div className="text-[10px] font-black tracking-[0.18em] uppercase" style={{ color: INK_SOFT }}>保存到</div>
                    <div className="flex flex-wrap gap-2">
                        {categoryOptions.map(cat => {
                            const active = categoryId === cat.id;
                            return (
                                <button
                                    key={cat.id}
                                    type="button"
                                    onClick={() => setCategoryId(cat.id)}
                                    className="px-3 py-1.5 text-[11px] font-black active:scale-95 transition-transform"
                                    style={{
                                        borderRadius: 999,
                                        background: active ? INK : '#fffdfa',
                                        color: active ? '#fffdfa' : INK,
                                        border: `1px solid ${active ? INK : INK_SOFT + '55'}`,
                                    }}
                                >
                                    {cat.name}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div>
                    <input
                        id={inputId}
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={event => void handleFiles(event.target.files)}
                    />
                    <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={busy}
                        className="w-full min-h-[84px] border border-dashed active:scale-[0.99] transition-transform flex flex-col items-center justify-center gap-2"
                        style={{ borderColor: INK_SOFT + '88', borderRadius: 16, background: '#fffdfa', color: INK }}
                    >
                        <ImageSquare size={24} weight="bold" />
                        <span className="text-[12px] font-black tracking-wide">选择图片，可一次多选</span>
                    </button>
                </div>

                {drafts.length > 0 && (
                    <div className="space-y-2 max-h-[34vh] overflow-y-auto no-scrollbar pr-1">
                        {drafts.map((draft, index) => (
                            <div
                                key={draft.id}
                                className="p-2.5 flex gap-3"
                                style={{ background: '#fffdfa', border: `1px solid ${INK_SOFT}44`, borderRadius: 14 }}
                            >
                                <div className="w-16 h-16 shrink-0 rounded-xl bg-white border border-black/5 flex items-center justify-center overflow-hidden">
                                    <img src={draft.url} alt="" className="w-full h-full object-contain" />
                                </div>
                                <div className="flex-1 min-w-0 space-y-2">
                                    <ScrapInput
                                        value={draft.name}
                                        onChange={event => updateDraft(draft.id, { name: event.target.value })}
                                        placeholder={`表情 ${index + 1} 的名字`}
                                        className="text-[12px] font-bold"
                                    />
                                    <ScrapInput
                                        value={draft.description}
                                        onChange={event => updateDraft(draft.id, { description: event.target.value })}
                                        placeholder="备注：比如 吐槽 / 装傻 / 求饶"
                                        className="text-[12px]"
                                    />
                                </div>
                                <button
                                    type="button"
                                    onClick={() => removeDraft(draft.id)}
                                    className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-red-400 active:scale-90"
                                    style={{ background: '#fff4f4', border: '1px solid #ffd6d6' }}
                                    title="移除"
                                >
                                    <Trash size={15} weight="bold" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-[10px] font-black tracking-[0.18em] uppercase" style={{ color: INK_SOFT }}>
                        <Sticker size={13} weight="bold" />
                        URL 批量导入
                    </div>
                    <ScrapTextarea
                        value={textImport}
                        onChange={event => setTextImport(event.target.value)}
                        placeholder={'名字--URL（每行一个）\n名字--URL--备注（备注可选）'}
                        className="h-28"
                    />
                </div>

                {error && (
                    <div className="text-[11px] font-bold text-red-500 px-1">{error}</div>
                )}
            </div>
        </Modal>
    );
};

export default EmojiImportModal;
