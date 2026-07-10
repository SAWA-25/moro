import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { AppID, GalleryImage } from '../types';
import { extractContent } from '../utils/safeApi';
import { processImage } from '../utils/file';
import { callChatCompletion } from '../utils/llmClient';
import { makeApiUsageMeta } from '../utils/apiUsageCatalog';
import { buildFullCharacterSetting, buildFullActiveUserSetting } from '../utils/characterPromptProfile';
import { GalleryStockPanel } from './GalleryStockPanel';
import { manualAnchorProps, scrollToManualAnchor, useManualDeepLink } from '../utils/manualDeepLink';
import {
    InsShell, InsHeader, InsScroll, Polaroid, StoryRing, InsCard, InsButton,
    IconCircle, InsEmpty, InsDialog, InsSheet, SectionLabel, Chip, accent,
    INK, INK_SOFT, HAIRLINE,
} from '../components/ui/insKit';
import {
    ArrowsClockwise, BookOpenText, CaretLeft, ChatCircleText, DownloadSimple, Funnel,
    Camera, Images, MagnifyingGlass, NotePencil, PencilSimpleLine, ShareNetwork,
    Sparkle, Spinner, Star, Tag, Trash, UploadSimple, X,
} from '@phosphor-icons/react';

const AC = 'orange' as const;

type View = 'albums' | 'stock' | 'grid' | 'detail';
type GalleryFilter = 'all' | 'favorite' | 'reviewed' | 'unreviewed' | 'essayed' | 'tagged' | 'untagged';
type SortMode = 'newest' | 'oldest' | 'favorite';
type GalleryRoleTextKind = 'review' | 'charEssay';

interface AlbumStats {
    total: number;
    favorites: number;
    reviewed: number;
    tagged: number;
    latest?: GalleryImage;
}

interface EditDraft {
    title: string;
    note: string;
    userEssay: string;
    charEssay: string;
    tags: string;
    savedDate: string;
    review: string;
}

interface GalleryProps {
    initialView?: 'albums' | 'stock';
}

const todayYmd = () => new Date().toISOString().split('T')[0];

const uniqueTags = (raw: string): string[] => {
    const seen = new Set<string>();
    return raw
        .split(/[,，、\s#]+/)
        .map(t => t.trim())
        .filter(Boolean)
        .filter(t => {
            const key = t.toLocaleLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .slice(0, 12);
};

const baseName = (name: string) => name.replace(/\.[^.]+$/, '').trim();

const safeFilename = (name: string) =>
    (name || 'moro-photo').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 40) || 'moro-photo';

const extFromUrl = (url: string) => {
    const mime = url.match(/^data:image\/([^;,]+)/i)?.[1]?.toLowerCase();
    if (mime) return mime === 'jpeg' ? 'jpg' : mime;
    const ext = url.match(/\.([a-z0-9]+)(?:[?#]|$)/i)?.[1]?.toLowerCase();
    return ext && ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif'].includes(ext) ? ext : 'jpg';
};

const dataUrlToFile = async (dataUrl: string, filename: string): Promise<File> => {
    const resp = await fetch(dataUrl);
    const blob = await resp.blob();
    return new File([blob], filename, { type: blob.type || 'image/jpeg' });
};

const sourceLabel = (img: GalleryImage) => {
    if (img.source === 'camera' || img.id.startsWith('cam-')) return '相机';
    if (img.source === 'import' || img.originalName) return '导入';
    if (img.source === 'generated') return '生图';
    if (img.source === 'other') return '其他';
    return '聊天';
};

const dateLabel = (img: GalleryImage) => {
    if (img.savedDate) return img.savedDate;
    if (!img.timestamp) return '未注明日期';
    return new Date(img.timestamp).toLocaleDateString('zh-CN');
};

const monthKey = (img: GalleryImage) => {
    if (img.savedDate && /^\d{4}-\d{2}/.test(img.savedDate)) return img.savedDate.slice(0, 7);
    if (!img.timestamp) return 'undated';
    return new Date(img.timestamp).toISOString().slice(0, 7);
};

const monthTitle = (key: string) => {
    if (key === 'undated') return '未注明日期';
    const [year, month] = key.split('-');
    return `${year}年${Number(month)}月`;
};

const sortImages = (items: GalleryImage[], mode: SortMode) => {
    const next = [...items];
    next.sort((a, b) => {
        if (mode === 'favorite' && !!a.favorite !== !!b.favorite) return a.favorite ? -1 : 1;
        if (mode === 'oldest') return (a.timestamp || 0) - (b.timestamp || 0);
        return (b.timestamp || 0) - (a.timestamp || 0);
    });
    return next;
};

const hasEssay = (img: GalleryImage) => !!(img.userEssay?.trim() || img.charEssay?.trim());

const Gallery: React.FC<GalleryProps> = ({ initialView = 'albums' }) => {
    const { closeApp, characters, apiConfig, addToast, userProfile } = useOS();
    const [view, setView] = useState<View>(initialView);
    const [activeCharId, setActiveCharId] = useState<string | null>(null);
    const [images, setImages] = useState<GalleryImage[]>([]);
    const [selectedImage, setSelectedImage] = useState<GalleryImage | null>(null);
    const [isReviewing, setIsReviewing] = useState(false);
    const [isWritingEssay, setIsWritingEssay] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [showChatContext, setShowChatContext] = useState(false);
    const [showControls, setShowControls] = useState(true);
    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState<GalleryFilter>('all');
    const [sortMode, setSortMode] = useState<SortMode>('newest');
    const [activeTag, setActiveTag] = useState<string | null>(null);
    const [editImage, setEditImage] = useState<GalleryImage | null>(null);
    const [editDraft, setEditDraft] = useState<EditDraft>({ title: '', note: '', userEssay: '', charEssay: '', tags: '', savedDate: '', review: '' });
    const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; confirmText: string; onConfirm: () => void; } | null>(null);
    const [albumStats, setAlbumStats] = useState<Record<string, AlbumStats>>({});
    const [stockCount, setStockCount] = useState(0);
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const activeChar = characters.find(c => c.id === activeCharId);

    const loadAlbumStats = useCallback(async () => {
        const entries = await Promise.all(characters.map(async char => {
            const imgs = sortImages(await DB.getGalleryImages(char.id), 'newest');
            const stats: AlbumStats = {
                total: imgs.length,
                favorites: imgs.filter(img => img.favorite).length,
                reviewed: imgs.filter(img => !!img.review).length,
                tagged: imgs.filter(img => (img.tags || []).length > 0).length,
                latest: imgs[0],
            };
            return [char.id, stats] as const;
        }));
        setAlbumStats(Object.fromEntries(entries));
    }, [characters]);

    const loadStockCount = useCallback(async () => {
        const imgs = await DB.getXhsStockImages();
        setStockCount(imgs.length);
    }, []);

    const loadActiveImages = useCallback(async () => {
        if (!activeCharId) {
            setImages([]);
            return;
        }
        const imgs = await DB.getGalleryImages(activeCharId);
        setImages(sortImages(imgs, 'newest'));
    }, [activeCharId]);

    useEffect(() => {
        if (view === 'albums') void loadAlbumStats();
    }, [loadAlbumStats, view]);

    useEffect(() => {
        if (view === 'albums') void loadStockCount();
    }, [loadStockCount, view]);

    useEffect(() => {
        void loadActiveImages();
    }, [loadActiveImages]);

    useEffect(() => {
        if (initialView === 'stock') {
            setView('stock');
            setSelectedImage(null);
            setShowChatContext(false);
        }
    }, [initialView]);

    useManualDeepLink(AppID.Gallery, useCallback((target) => {
        const route = String(target.route || target.payload?.tab || '');
        const wantsStock = route === 'stock' || route === 'xhs_stock' || target.anchorId === 'manual-xhs-stock-root';
        if (wantsStock) {
            setSelectedImage(null);
            setEditImage(null);
            setShowChatContext(false);
            setView('stock');
            window.setTimeout(() => scrollToManualAnchor(target.anchorId || 'manual-xhs-stock-root'), 120);
            return;
        }
        setView('albums');
        setActiveCharId(null);
        setSelectedImage(null);
        setShowChatContext(false);
        window.setTimeout(() => scrollToManualAnchor(target.anchorId || 'manual-gallery-root'), 120);
    }, []));

    const allTags = useMemo(() => {
        const counts = new Map<string, number>();
        images.forEach(img => (img.tags || []).forEach(tag => counts.set(tag, (counts.get(tag) || 0) + 1)));
        return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'));
    }, [images]);

    const visibleImages = useMemo(() => {
        const q = query.trim().toLocaleLowerCase();
        const filtered = images.filter(img => {
            if (filter === 'favorite' && !img.favorite) return false;
            if (filter === 'reviewed' && !img.review) return false;
            if (filter === 'unreviewed' && img.review) return false;
            if (filter === 'essayed' && !hasEssay(img)) return false;
            if (filter === 'tagged' && !(img.tags || []).length) return false;
            if (filter === 'untagged' && (img.tags || []).length) return false;
            if (activeTag && !(img.tags || []).includes(activeTag)) return false;
            if (!q) return true;
            const haystack = [
                img.title, img.note, img.userEssay, img.charEssay, img.review, img.savedDate, img.originalName,
                sourceLabel(img), ...(img.tags || []),
            ].filter(Boolean).join(' ').toLocaleLowerCase();
            return haystack.includes(q);
        });
        return sortImages(filtered, sortMode);
    }, [activeTag, filter, images, query, sortMode]);

    const groupedImages = useMemo(() => {
        const groups = new Map<string, GalleryImage[]>();
        visibleImages.forEach(img => {
            const key = monthKey(img);
            groups.set(key, [...(groups.get(key) || []), img]);
        });
        return [...groups.entries()];
    }, [visibleImages]);

    const currentStats = useMemo(() => ({
        total: images.length,
        favorites: images.filter(img => img.favorite).length,
        reviewed: images.filter(img => img.review).length,
        essays: images.filter(hasEssay).length,
        tagged: images.filter(img => (img.tags || []).length > 0).length,
    }), [images]);

    const totalStats = useMemo(() => {
        const values = Object.values(albumStats);
        return {
            total: values.reduce((sum, item) => sum + item.total, 0),
            favorites: values.reduce((sum, item) => sum + item.favorites, 0),
            reviewed: values.reduce((sum, item) => sum + item.reviewed, 0),
            albums: values.filter(item => item.total > 0).length,
        };
    }, [albumStats]);

    const resetFilters = () => {
        setQuery('');
        setFilter('all');
        setActiveTag(null);
        setSortMode('newest');
    };

    const updateImageInState = (updated: GalleryImage) => {
        setImages(prev => sortImages(prev.map(img => img.id === updated.id ? updated : img), 'newest'));
        setSelectedImage(prev => prev?.id === updated.id ? updated : prev);
        setEditImage(prev => prev?.id === updated.id ? updated : prev);
    };

    const handleCharClick = (id: string) => {
        setActiveCharId(id);
        setSelectedImage(null);
        resetFilters();
        setView('grid');
    };

    const handleImageClick = (img: GalleryImage) => {
        setSelectedImage(img);
        setShowChatContext(false);
        setView('detail');
    };

    const handleBack = () => {
        if (view === 'stock') {
            setView('albums');
            return;
        }
        if (view === 'detail') {
            setView('grid');
            setShowChatContext(false);
            return;
        }
        if (view === 'grid') {
            setView('albums');
            setActiveCharId(null);
            setSelectedImage(null);
            return;
        }
        closeApp();
    };

    const handleAlbumPressStart = useCallback((charId: string) => {
        longPressTimer.current = setTimeout(() => {
            const char = characters.find(c => c.id === charId);
            setConfirmDialog({
                title: '清空这本相册？',
                message: `「${char?.name || ''}」的照片会全部移除，没法再找回来了。`,
                confirmText: '清空',
                onConfirm: async () => {
                    const imgs = await DB.getGalleryImages(charId);
                    for (const img of imgs) await DB.deleteGalleryImage(img.id);
                    if (activeCharId === charId) setImages([]);
                    await loadAlbumStats();
                    addToast('整本相册清空了', 'success');
                    setConfirmDialog(null);
                },
            });
        }, 620);
    }, [activeCharId, addToast, characters, loadAlbumStats]);

    const handleAlbumPressEnd = useCallback(() => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    }, []);

    const handleDeleteImage = async () => {
        if (!selectedImage) return;
        setConfirmDialog({
            title: '删掉这张照片？',
            message: '删掉就找不回来了，确定吗？',
            confirmText: '删掉',
            onConfirm: async () => {
                await DB.deleteGalleryImage(selectedImage.id);
                setImages(prev => prev.filter(img => img.id !== selectedImage.id));
                setView('grid');
                setSelectedImage(null);
                await loadAlbumStats();
                addToast('删掉了这张', 'success');
                setConfirmDialog(null);
            },
        });
    };

    const handleToggleFavorite = async (img: GalleryImage) => {
        const updated = await DB.updateGalleryImage(img.id, { favorite: !img.favorite });
        updateImageInState(updated);
        addToast(updated.favorite ? '已放进喜欢' : '已取消喜欢', 'success');
        void loadAlbumStats();
    };

    const handleImportFiles = async (files: FileList | null) => {
        if (!files?.length || !activeCharId) return;
        const imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
        if (!imageFiles.length) {
            addToast('请选择图片文件', 'error');
            return;
        }
        setIsImporting(true);
        try {
            const now = Date.now();
            let saved = 0;
            for (const [index, file] of imageFiles.entries()) {
                const url = await processImage(file, { maxWidth: 1600, quality: 0.84 });
                await DB.saveGalleryImage({
                    id: `import-${now}-${index}-${Math.random().toString(36).slice(2, 8)}`,
                    charId: activeCharId,
                    url,
                    timestamp: now + index,
                    title: baseName(file.name),
                    savedDate: todayYmd(),
                    source: 'import',
                    originalName: file.name,
                });
                saved += 1;
            }
            await loadActiveImages();
            await loadAlbumStats();
            addToast(`已导入 ${saved} 张照片`, 'success');
        } catch (e: any) {
            addToast(e?.message || '导入照片失败', 'error');
        } finally {
            setIsImporting(false);
        }
    };

    const openEditSheet = (img: GalleryImage) => {
        setEditImage(img);
        setEditDraft({
            title: img.title || '',
            note: img.note || '',
            userEssay: img.userEssay || '',
            charEssay: img.charEssay || '',
            tags: (img.tags || []).join(' '),
            savedDate: img.savedDate || '',
            review: img.review || '',
        });
    };

    const handleSaveEdit = async () => {
        if (!editImage) return;
        const nextReview = editDraft.review.trim();
        const oldReview = editImage.review || '';
        const nextCharEssay = editDraft.charEssay.trim();
        const oldCharEssay = editImage.charEssay || '';
        const updated = await DB.updateGalleryImage(editImage.id, {
            title: editDraft.title.trim() || undefined,
            note: editDraft.note.trim() || undefined,
            userEssay: editDraft.userEssay.trim() || undefined,
            charEssay: nextCharEssay || undefined,
            tags: uniqueTags(editDraft.tags),
            savedDate: editDraft.savedDate.trim() || undefined,
            review: nextReview || undefined,
            reviewTimestamp: nextReview !== oldReview ? Date.now() : editImage.reviewTimestamp,
            charEssayTimestamp: nextCharEssay ? (nextCharEssay !== oldCharEssay ? Date.now() : editImage.charEssayTimestamp) : undefined,
        });
        updateImageInState(updated);
        setEditImage(null);
        void loadAlbumStats();
        addToast('整理信息已保存', 'success');
    };

    const handleDownload = (img = selectedImage) => {
        if (!img) return;
        const ext = extFromUrl(img.url);
        const name = `${safeFilename(img.title || activeChar?.name || 'moro-photo')}-${img.savedDate || todayYmd()}.${ext}`;
        const a = document.createElement('a');
        a.href = img.url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        addToast('已开始保存照片', 'success');
    };

    const handleShare = async () => {
        if (!selectedImage) return;
        const filename = `${safeFilename(selectedImage.title || activeChar?.name || 'moro-photo')}.${extFromUrl(selectedImage.url)}`;
        try {
            const nav = navigator as Navigator & {
                canShare?: (data: ShareData) => boolean;
                share?: (data: ShareData) => Promise<void>;
            };
            if (nav.share) {
                if (selectedImage.url.startsWith('data:')) {
                    const file = await dataUrlToFile(selectedImage.url, filename);
                    if (nav.canShare?.({ files: [file] })) {
                        await nav.share({ title: selectedImage.title || 'Moro 相册', text: selectedImage.note || selectedImage.userEssay || selectedImage.charEssay || selectedImage.review || '', files: [file] });
                        return;
                    }
                }
                await nav.share({
                    title: selectedImage.title || 'Moro 相册',
                    text: selectedImage.note || selectedImage.userEssay || selectedImage.charEssay || selectedImage.review || '这张照片保存在 Moro 相册里。',
                    ...(selectedImage.url.startsWith('http') ? { url: selectedImage.url } : {}),
                });
                return;
            }
        } catch (e: any) {
            if (e?.name === 'AbortError') return;
        }
        handleDownload(selectedImage);
    };

    const handleGenerateRoleText = async (kind: GalleryRoleTextKind) => {
        if (!selectedImage || !activeCharId || !apiConfig.baseUrl || !apiConfig.model) {
            addToast('还没配好 API 或缺图片信息', 'error');
            return;
        }
        const char = characters.find(c => c.id === activeCharId);
        if (!char) return;
        const isEssay = kind === 'charEssay';

        if (isEssay) setIsWritingEssay(true);
        else setIsReviewing(true);
        try {
            const metaLines = [
                selectedImage.title ? `Title: ${selectedImage.title}` : '',
                selectedImage.note ? `User note: ${selectedImage.note}` : '',
                selectedImage.userEssay ? `User essay: ${selectedImage.userEssay}` : '',
                selectedImage.review ? `Existing back caption: ${selectedImage.review}` : '',
                selectedImage.charEssay ? `Existing character essay: ${selectedImage.charEssay}` : '',
                (selectedImage.tags || []).length ? `Tags: ${(selectedImage.tags || []).join(', ')}` : '',
                selectedImage.savedDate ? `Saved date: ${selectedImage.savedDate}` : '',
                `Source: ${sourceLabel(selectedImage)}`,
            ].filter(Boolean).join('\n');
            const chatContextStr = selectedImage.chatContext?.length
                ? `\n\nConversation context when this photo was saved:\n${selectedImage.chatContext.join('\n')}\n`
                : '';
            const task = isEssay
                ? 'The user is looking at one saved photo in your shared gallery. Write a warm, in-character photo essay in Chinese, about 80-180 Chinese characters. It can be reflective, diary-like, playful, intimate, or restrained according to your personality and relationship with the user.'
                : 'The user is looking at one saved photo in your shared gallery. Write a short note on the back of the photo in your own voice, 1-3 natural Chinese sentences.';
            const systemContent = `You are ${char.name}.
${buildFullCharacterSetting(char, { includeMemos: true })}

${await buildFullActiveUserSetting(userProfile)}

Task: ${task}
${metaLines ? `Photo metadata:\n${metaLines}\n` : ''}${chatContextStr}
Style: intimate, casual, in character. Do not say you are an AI. Do not merely describe "this is an image"; react like you remember or are seeing this photo with the user.`;

            const payload = {
                model: apiConfig.model,
                messages: [
                    { role: 'system', content: systemContent },
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: isEssay ? '请用你的语气给这张相册照片写一段随笔。' : '给这张相册照片写一句背面留言。' },
                            { type: 'image_url', image_url: { url: selectedImage.url } },
                        ],
                    },
                ],
                max_tokens: isEssay ? 1800 : 1200,
                temperature: isEssay ? 0.82 : 0.75,
                stream: false,
            };

            const data = await callChatCompletion(apiConfig, payload, {
                meta: makeApiUsageMeta('gallery.caption', {
                    charId: char.id,
                    charName: char.name,
                    apiRole: 'main',
                    apiBinding: isEssay ? '相册随笔' : '相册题字',
                }),
                presetScope: 'creative.text',
                presetMacros: { charName: char.name, userName: userProfile.name || '用户' },
            });

            const choice = data.choices?.[0];
            if (choice?.finish_reason === 'content_filter') throw new Error('AI 拒绝回复（图片可能包含敏感内容）');

            let text = extractContent(data) || choice?.message?.reasoning_content || choice?.text || choice?.delta?.content || '';
            text = String(text).trim();
            if (!text) throw new Error('AI 返回内容为空，请重试');

            const updatedImage = await DB.updateGalleryImage(selectedImage.id, isEssay
                ? { charEssay: text, charEssayTimestamp: Date.now() }
                : { review: text, reviewTimestamp: Date.now() });
            updateImageInState(updatedImage);
            void loadAlbumStats();
            addToast(isEssay ? 'TA 写下了随笔' : 'TA 留了句话', 'success');
        } catch (e: any) {
            console.error('Review Error:', e);
            let msg = e?.message || '未知错误';
            if (/vision|image|multimodal|不支持/i.test(msg)) msg = '当前模型可能不支持图片识别(Vision)，请切换模型。';
            addToast(`${isEssay ? '随笔' : '留言'}失败：${msg}`, 'error');
        } finally {
            if (isEssay) setIsWritingEssay(false);
            else setIsReviewing(false);
        }
    };

    const renderAlbums = () => (
        <InsScroll className="px-5 pt-2 pb-8">
            <div className="flex gap-1 rounded-full p-1 mb-4 bg-white" style={{ border: `1px solid ${HAIRLINE}`, boxShadow: '0 8px 24px -20px rgba(38,38,38,0.34)' }} {...manualAnchorProps('manual-gallery-root')}>
                <button className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-2 text-[12px] font-black" style={{ background: accent(AC).solid, color: '#fff' }}>
                    <Images size={15} weight="bold" />角色相册
                </button>
                <button onClick={() => setView('stock')} className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-2 text-[12px] font-black press-soft" style={{ color: accent('red').ink, background: accent('red').soft }}>
                    <Camera size={15} weight="bold" />拾光素材
                </button>
            </div>

            <InsCard className="p-4 mb-4" accent={AC} edge>
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: accent(AC).soft, color: accent(AC).solid }}>
                        <Images size={26} weight="duotone" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="text-[18px] font-extrabold" style={{ color: INK }}>时间和照片都在这里</div>
                        <div className="text-[12px] mt-1" style={{ color: INK_SOFT }}>
                            {totalStats.albums} 本相册 · {totalStats.total} 张照片 · {totalStats.favorites} 张喜欢
                        </div>
                    </div>
                </div>
            </InsCard>

            <InsCard className="p-4 mb-6" accent="red" edge onClick={() => setView('stock')}>
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: accent('red').soft, color: accent('red').solid }}>
                        <Camera size={25} weight="duotone" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="text-[16px] font-extrabold" style={{ color: INK }}>拾光素材</div>
                        <div className="text-[12px] mt-1" style={{ color: INK_SOFT }}>
                            {stockCount} 张素材 · 给见闻簿和自由活动备图
                        </div>
                    </div>
                </div>
            </InsCard>

            <div className="grid grid-cols-2 gap-x-5 gap-y-8">
                {characters.map((char, i) => {
                    const stats = albumStats[char.id] || { total: 0, favorites: 0, reviewed: 0, tagged: 0 };
                    const cover = stats.latest?.url || char.avatar;
                    const tilt = i % 4 === 0 ? -2.5 : i % 4 === 1 ? 1.8 : i % 4 === 2 ? -1.2 : 2.4;
                    return (
                        <Polaroid
                            key={char.id}
                            src={cover}
                            caption={char.name}
                            rotate={tilt}
                            accent={AC}
                            fallback={char.name.charAt(0)}
                            onClick={() => handleCharClick(char.id)}
                            onPointerDown={() => handleAlbumPressStart(char.id)}
                            onPointerUp={handleAlbumPressEnd}
                            onPointerLeave={handleAlbumPressEnd}
                            style={{ animationDelay: `${i * 45}ms`, opacity: stats.total ? 1 : 0.72 }}
                        >
                            <span className="absolute top-1.5 left-1.5 text-[10px] font-black tabular-nums px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.92)', color: accent(AC).ink, boxShadow: '0 2px 6px rgba(0,0,0,0.15)' }}>
                                {stats.total ? `${stats.total} 张` : '空'}
                            </span>
                            {stats.favorites > 0 && (
                                <span className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.92)', color: '#f59e0b' }}>
                                    <Star size={13} weight="fill" />
                                </span>
                            )}
                        </Polaroid>
                    );
                })}
                {characters.length === 0 && (
                    <div className="col-span-2">
                        <InsEmpty icon={<Images size={52} weight="thin" />} title="还没有谁的相册" hint="和角色聊天、拍照或导入照片后，这里会出现 TA 的相册本" />
                    </div>
                )}
            </div>
        </InsScroll>
    );

    const renderGridTile = (img: GalleryImage, index: number) => (
        <button key={img.id} onClick={() => handleImageClick(img)} className="aspect-square relative overflow-hidden press-soft text-left" style={{ background: accent(AC).soft }}>
            <img src={img.url} className="w-full h-full object-cover animate-photo-develop" style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }} loading="lazy" alt={img.title || ''} />
            <div className="absolute inset-x-0 bottom-0 px-1.5 pb-1.5 pt-8" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.58), transparent)' }}>
                <div className="text-[9px] font-bold text-white/95 truncate">{img.title || dateLabel(img)}</div>
                {(img.tags || []).length > 0 && <div className="text-[8px] text-white/72 truncate">#{(img.tags || []).slice(0, 2).join(' #')}</div>}
            </div>
            {img.favorite && (
                <span className="absolute top-1.5 left-1.5 w-5 h-5 rounded-full flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.92)', color: '#f59e0b' }}>
                    <Star size={11} weight="fill" />
                </span>
            )}
            {(img.review || hasEssay(img)) && (
                <span className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.92)', color: accent(AC).solid }}>
                    {hasEssay(img) ? <BookOpenText size={11} weight="fill" /> : <ChatCircleText size={11} weight="fill" />}
                </span>
            )}
        </button>
    );

    const renderGrid = () => (
        <InsScroll className="px-0">
            <div className="px-5 pt-2 pb-3">
                <InsCard className="p-4" accent={AC}>
                    <div className="flex items-center gap-4">
                        <StoryRing src={activeChar?.avatar} size={64} active={images.length > 0} spin={false} fallback={activeChar?.name?.charAt(0)} />
                        <div className="min-w-0 flex-1">
                            <div className="text-[18px] font-extrabold truncate" style={{ color: INK }}>{activeChar?.name || '相册'}</div>
                            <div className="grid grid-cols-4 gap-2 mt-2">
                                {[
                                    ['照片', currentStats.total],
                                    ['喜欢', currentStats.favorites],
                                    ['题字', currentStats.reviewed],
                                    ['随笔', currentStats.essays],
                                ].map(([label, value]) => (
                                    <div key={label} className="rounded-2xl px-2.5 py-2 text-center" style={{ background: accent(AC).soft }}>
                                        <div className="text-[15px] font-black tabular-nums" style={{ color: INK }}>{value}</div>
                                        <div className="text-[10px] font-bold" style={{ color: accent(AC).ink }}>{label}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </InsCard>
            </div>

            <div className="px-5 pb-3 space-y-2">
                <div className="flex items-center gap-2 rounded-full px-3.5 py-2.5" style={{ background: '#fff', border: `1px solid ${HAIRLINE}` }}>
                    <MagnifyingGlass size={16} weight="bold" style={{ color: INK_SOFT }} />
                    <input
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="搜标题、随笔、题字、标签、日期"
                        className="min-w-0 flex-1 bg-transparent outline-none text-[13px] placeholder:text-[#bbb5ae]"
                        style={{ color: INK }}
                    />
                    {query && <button onClick={() => setQuery('')} className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: accent(AC).soft, color: accent(AC).ink }}><X size={12} weight="bold" /></button>}
                </div>

                {showControls && (
                    <div className="space-y-2 animate-slide-up">
                        <div className="flex gap-2 overflow-x-auto no-scrollbar">
                            {([
                                ['all', '全部'],
                                ['favorite', '喜欢'],
                                ['reviewed', '有题字'],
                                ['unreviewed', '待题字'],
                                ['essayed', '有随笔'],
                                ['tagged', '有标签'],
                                ['untagged', '未整理'],
                            ] as Array<[GalleryFilter, string]>).map(([key, label]) => (
                                <Chip key={key} active={filter === key} accent={AC} onClick={() => setFilter(key)}>{label}</Chip>
                            ))}
                        </div>
                        <div className="flex gap-2 overflow-x-auto no-scrollbar">
                            {([
                                ['newest', '最新'],
                                ['oldest', '最早'],
                                ['favorite', '喜欢优先'],
                            ] as Array<[SortMode, string]>).map(([key, label]) => (
                                <Chip key={key} active={sortMode === key} accent={AC} onClick={() => setSortMode(key)}>{label}</Chip>
                            ))}
                        </div>
                        {allTags.length > 0 && (
                            <div className="flex gap-2 overflow-x-auto no-scrollbar">
                                <Chip active={!activeTag} accent={AC} onClick={() => setActiveTag(null)}>全部标签</Chip>
                                {allTags.map(([tag, count]) => (
                                    <Chip key={tag} active={activeTag === tag} accent={AC} onClick={() => setActiveTag(activeTag === tag ? null : tag)}>
                                        #{tag} · {count}
                                    </Chip>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {images.length === 0 ? (
                <InsEmpty icon={<Images size={52} weight="thin" />} title="这本相册还空着" hint="点右上角导入照片，或在聊天、相机里留下图片" />
            ) : visibleImages.length === 0 ? (
                <InsEmpty icon={<Funnel size={52} weight="thin" />} title="没有匹配的照片" hint="换个关键词或清掉筛选条件" />
            ) : (
                <div className="pb-7">
                    {groupedImages.map(([key, group]) => (
                        <section key={key} className="mb-4">
                            <div className="px-5 py-2 flex items-center justify-between">
                                <SectionLabel en={`${group.length} PHOTOS`} accent={AC}>{monthTitle(key)}</SectionLabel>
                            </div>
                            <div className="grid grid-cols-3 gap-[3px] px-[3px]">
                                {group.map((img, i) => renderGridTile(img, i))}
                            </div>
                        </section>
                    ))}
                </div>
            )}
        </InsScroll>
    );

    const renderDetail = () => selectedImage && (
        <div className="flex flex-col h-full relative animate-fade-in" style={{ background: 'linear-gradient(180deg,#2a2723,#16140f)' }}>
            <div className="absolute top-0 left-0 w-full px-4 pt-3 flex justify-between items-start z-50">
                <IconCircle tone="glass" onClick={() => { setView('grid'); setShowChatContext(false); }} title="返回"><CaretLeft size={18} weight="bold" /></IconCircle>
                <div className="min-w-0 mx-3 text-center">
                    <div className="text-[11px] px-3 py-1.5 rounded-full font-bold truncate max-w-[170px]" style={{ background: 'rgba(255,255,255,0.16)', color: '#fff', fontFamily: 'var(--font-label)', backdropFilter: 'blur(8px)' }}>
                        {selectedImage.title || dateLabel(selectedImage)}
                    </div>
                </div>
                <div className="flex gap-2">
                    <IconCircle tone="glass" onClick={() => void handleToggleFavorite(selectedImage)} title={selectedImage.favorite ? '取消喜欢' : '喜欢'}>
                        <Star size={17} weight={selectedImage.favorite ? 'fill' : 'bold'} style={{ color: selectedImage.favorite ? '#f59e0b' : undefined }} />
                    </IconCircle>
                    <IconCircle tone="glass" onClick={handleDeleteImage} title="删除"><Trash size={17} weight="bold" /></IconCircle>
                </div>
            </div>

            <div className="flex-1 min-h-0 w-full flex items-center justify-center relative overflow-hidden p-6">
                <div className="animate-develop" style={{ ['--pl-rot' as any]: '-1.2deg', maxHeight: '100%', maxWidth: '100%' }}>
                    <div className="p-2.5 pb-8 relative" style={{ background: '#fff', borderRadius: 8, boxShadow: '0 30px 60px -20px rgba(0,0,0,0.75)' }}>
                        <img src={selectedImage.url} className="max-w-full object-contain" style={{ maxHeight: '52vh', borderRadius: 3, display: 'block' }} alt={selectedImage.title || 'Gallery detail' } />
                        <div className="absolute left-0 right-0 bottom-1.5 px-4 text-center">
                            <span className="text-[12px] font-bold truncate block" style={{ color: '#8a857c', fontFamily: 'var(--font-hand)' }}>
                                {selectedImage.review ? `${activeChar?.name || 'TA'} · 留言已写在背面` : selectedImage.title || sourceLabel(selectedImage)}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="shrink-0 w-full z-40" style={{ background: '#fff', borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingBottom: 'max(env(safe-area-inset-bottom), 12px)', boxShadow: '0 -18px 40px -22px rgba(0,0,0,0.6)' }}>
                <div className="p-5 animate-slide-up">
                    <div className="flex items-start gap-3">
                        <StoryRing src={activeChar?.avatar} size={42} active fallback={activeChar?.name?.charAt(0)} />
                        <div className="flex-1 min-w-0">
                            <div className="text-[11px] font-bold mb-1 flex items-center gap-1" style={{ color: accent(AC).solid }}>
                                <PencilSimpleLine size={12} weight="bold" />背面题字
                            </div>
                            {selectedImage.review ? (
                                <p className="text-[17px] leading-relaxed select-text" style={{ color: INK, fontFamily: 'var(--font-hand)' }}>“{selectedImage.review}”</p>
                            ) : (
                                <p className="text-[13px] leading-relaxed" style={{ color: INK_SOFT }}>还没有题字，可以请 {activeChar?.name || 'TA'} 写一句，或者自己整理备注。</p>
                            )}
                        </div>
                    </div>

                    {hasEssay(selectedImage) && (
                        <div className="mt-3 rounded-2xl p-3.5 space-y-3" style={{ background: '#fffaf2', border: `1px solid ${accent(AC).soft}` }}>
                            <SectionLabel en="PHOTO ESSAY" accent={AC}>照片随笔</SectionLabel>
                            {selectedImage.userEssay && (
                                <div>
                                    <div className="text-[10px] font-black mb-1" style={{ color: INK_SOFT }}>我写的</div>
                                    <p className="text-[13px] leading-relaxed whitespace-pre-wrap select-text" style={{ color: '#5a5660' }}>{selectedImage.userEssay}</p>
                                </div>
                            )}
                            {selectedImage.charEssay && (
                                <div>
                                    <div className="text-[10px] font-black mb-1 inline-flex items-center gap-1" style={{ color: accent(AC).solid }}>
                                        <BookOpenText size={11} weight="bold" />{activeChar?.name || 'TA'} 写的
                                    </div>
                                    <p className="text-[15px] leading-relaxed whitespace-pre-wrap select-text" style={{ color: INK, fontFamily: 'var(--font-hand)' }}>{selectedImage.charEssay}</p>
                                </div>
                            )}
                        </div>
                    )}

                    {(selectedImage.note || (selectedImage.tags || []).length > 0 || selectedImage.originalName) && (
                        <div className="mt-3 rounded-2xl p-3.5 space-y-2" style={{ background: accent(AC).soft }}>
                            {selectedImage.note && <div className="text-[13px] leading-relaxed" style={{ color: '#5a5660' }}>{selectedImage.note}</div>}
                            {(selectedImage.tags || []).length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                    {(selectedImage.tags || []).map(tag => <span key={tag} className="text-[11px] font-bold px-2 py-1 rounded-full bg-white" style={{ color: accent(AC).ink }}>#{tag}</span>)}
                                </div>
                            )}
                            {selectedImage.originalName && <div className="text-[10px]" style={{ color: INK_SOFT }}>原文件：{selectedImage.originalName}</div>}
                        </div>
                    )}

                    <div className="grid grid-cols-5 gap-2 pt-3 mt-3" style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
                        <button onClick={() => openEditSheet(selectedImage)} className="flex flex-col items-center gap-1 py-2 rounded-2xl press-soft" style={{ background: accent(AC).soft, color: accent(AC).ink }}>
                            <NotePencil size={17} weight="bold" /><span className="text-[10px] font-bold">整理</span>
                        </button>
                        <button onClick={() => void handleGenerateRoleText('review')} disabled={isReviewing} className="flex flex-col items-center gap-1 py-2 rounded-2xl press-soft disabled:opacity-50" style={{ background: accent(AC).soft, color: accent(AC).ink }}>
                            {isReviewing ? <Spinner size={17} className="animate-spin" /> : <ArrowsClockwise size={17} weight="bold" />}<span className="text-[10px] font-bold">{selectedImage.review ? '换句' : '题字'}</span>
                        </button>
                        <button onClick={() => void handleGenerateRoleText('charEssay')} disabled={isWritingEssay} className="flex flex-col items-center gap-1 py-2 rounded-2xl press-soft disabled:opacity-50" style={{ background: accent(AC).soft, color: accent(AC).ink }}>
                            {isWritingEssay ? <Spinner size={17} className="animate-spin" /> : <Sparkle size={17} weight="bold" />}<span className="text-[10px] font-bold">{selectedImage.charEssay ? '重写' : '随笔'}</span>
                        </button>
                        <button onClick={() => void handleShare()} className="flex flex-col items-center gap-1 py-2 rounded-2xl press-soft" style={{ background: accent(AC).soft, color: accent(AC).ink }}>
                            <ShareNetwork size={17} weight="bold" /><span className="text-[10px] font-bold">分享</span>
                        </button>
                        <button onClick={() => handleDownload()} className="flex flex-col items-center gap-1 py-2 rounded-2xl press-soft" style={{ background: accent(AC).soft, color: accent(AC).ink }}>
                            <DownloadSimple size={17} weight="bold" /><span className="text-[10px] font-bold">保存</span>
                        </button>
                    </div>

                    {selectedImage.chatContext && selectedImage.chatContext.length > 0 && (
                        <div className="mt-3">
                            <button onClick={() => setShowChatContext(!showChatContext)} className="text-[11px] flex items-center gap-1 px-2 py-1 font-bold press-soft" style={{ color: INK_SOFT }}>
                                <ChatCircleText size={13} weight="bold" />
                                {showChatContext ? '收起对话' : '翻到那天的对话'}
                            </button>
                            {showChatContext && (
                                <div className="mt-2 rounded-2xl p-3.5 space-y-1.5 max-h-36 overflow-y-auto no-scrollbar" style={{ background: accent(AC).soft }}>
                                    <SectionLabel en="THAT DAY" accent={AC}>保存这张时的对话</SectionLabel>
                                    {selectedImage.chatContext.map((line, i) => (
                                        <div key={i} className="text-[12px] leading-relaxed" style={{ color: '#5a5660' }}>{line}</div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );

    return (
        <InsShell accent={AC}>
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={e => { void handleImportFiles(e.currentTarget.files); e.currentTarget.value = ''; }}
            />

            <InsDialog open={!!confirmDialog} title={confirmDialog?.title} en="ARE YOU SURE" accent={AC} onClose={() => setConfirmDialog(null)}
                actions={confirmDialog ? <>
                    <InsButton variant="soft" accent="slate" onClick={() => setConfirmDialog(null)} className="flex-1 py-2.5 text-[13px]">留着</InsButton>
                    <InsButton variant="solid" accent={AC} onClick={confirmDialog.onConfirm} className="flex-1 py-2.5 text-[13px]">{confirmDialog.confirmText}</InsButton>
                </> : null}>
                {confirmDialog?.message}
            </InsDialog>

            <InsSheet open={!!editImage} onClose={() => setEditImage(null)} title="整理这张照片">
                <div className="space-y-3 text-left">
                    <div className="grid grid-cols-[92px_1fr] gap-3 items-start">
                        {editImage && <img src={editImage.url} className="w-[92px] aspect-square object-cover rounded-2xl" alt="" />}
                        <div className="space-y-2">
                            <input value={editDraft.title} onChange={e => setEditDraft(prev => ({ ...prev, title: e.target.value }))} placeholder="标题，例如：雨后那张" className="w-full px-3 py-2 rounded-2xl text-[13px] outline-none" style={{ border: `1px solid ${HAIRLINE}` }} />
                            <input value={editDraft.savedDate} onChange={e => setEditDraft(prev => ({ ...prev, savedDate: e.target.value }))} placeholder="日期 YYYY-MM-DD" className="w-full px-3 py-2 rounded-2xl text-[13px] outline-none" style={{ border: `1px solid ${HAIRLINE}` }} />
                        </div>
                    </div>
                    <textarea value={editDraft.note} onChange={e => setEditDraft(prev => ({ ...prev, note: e.target.value }))} rows={3} placeholder="自己的备注：这张图为什么想留下？" className="w-full px-3 py-2 rounded-2xl text-[13px] outline-none resize-none" style={{ border: `1px solid ${HAIRLINE}` }} />
                    <textarea value={editDraft.userEssay} onChange={e => setEditDraft(prev => ({ ...prev, userEssay: e.target.value }))} rows={4} placeholder="我的随笔：可以写得长一点，留给以后翻相册时看" className="w-full px-3 py-2 rounded-2xl text-[13px] outline-none resize-none" style={{ border: `1px solid ${HAIRLINE}` }} />
                    <textarea value={editDraft.charEssay} onChange={e => setEditDraft(prev => ({ ...prev, charEssay: e.target.value }))} rows={4} placeholder="TA 的随笔：可手动修改，也可回详情页点“随笔”让 TA 重写" className="w-full px-3 py-2 rounded-2xl text-[13px] outline-none resize-none" style={{ border: `1px solid ${HAIRLINE}` }} />
                    <div>
                        <div className="flex items-center gap-1.5 text-[11px] font-bold mb-1.5" style={{ color: INK_SOFT }}><Tag size={12} weight="bold" />标签，用空格或逗号分隔</div>
                        <input value={editDraft.tags} onChange={e => setEditDraft(prev => ({ ...prev, tags: e.target.value }))} placeholder="约会 雨天 合照" className="w-full px-3 py-2 rounded-2xl text-[13px] outline-none" style={{ border: `1px solid ${HAIRLINE}` }} />
                    </div>
                    <textarea value={editDraft.review} onChange={e => setEditDraft(prev => ({ ...prev, review: e.target.value }))} rows={3} placeholder="背面题字，可手动修一修 TA 的留言" className="w-full px-3 py-2 rounded-2xl text-[13px] outline-none resize-none" style={{ border: `1px solid ${HAIRLINE}` }} />
                    <div className="flex gap-2 pt-1">
                        <InsButton variant="soft" accent="slate" onClick={() => setEditImage(null)} className="flex-1 py-2.5 text-[13px]">取消</InsButton>
                        <InsButton variant="solid" accent={AC} onClick={handleSaveEdit} className="flex-1 py-2.5 text-[13px]">保存整理</InsButton>
                    </div>
                </div>
            </InsSheet>

            {view !== 'detail' && view !== 'stock' && (
                <InsHeader
                    accent={AC}
                    title={view === 'albums' ? '相册' : activeChar?.name || '相册'}
                    en={view === 'albums' ? 'THE GALLERY' : `${visibleImages.length}/${images.length} PHOTOS`}
                    onBack={handleBack}
                    right={view === 'grid' ? (
                        <div className="flex items-center gap-2">
                            <IconCircle size={36} onClick={() => setShowControls(v => !v)} title="筛选"><Funnel size={16} weight="bold" /></IconCircle>
                            <IconCircle size={36} onClick={() => fileInputRef.current?.click()} title="导入照片">
                                {isImporting ? <Spinner size={16} className="animate-spin" /> : <UploadSimple size={16} weight="bold" />}
                            </IconCircle>
                        </div>
                    ) : undefined}
                />
            )}

            {view === 'albums' && renderAlbums()}
            {view === 'stock' && <GalleryStockPanel embedded onBack={handleBack} onChanged={loadStockCount} anchorId="manual-xhs-stock-root" />}
            {view === 'grid' && renderGrid()}
            {view === 'detail' && renderDetail()}
        </InsShell>
    );
};

export default Gallery;
