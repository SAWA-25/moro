
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { GalleryImage, CharacterProfile } from '../types';
import { safeResponseJson } from '../utils/safeApi';
import {
    PaperBackdrop, ScrapButton, WashiTape, PaperDialog, SectionTag,
    INK, INK_SOFT, PAPER, PAGE_BG, TAPE_STRIPES, WASHI,
} from './theater/scrapbook';
import {
    CaretLeft, Trash, ArrowsClockwise, ChatCircleText, Images, Sparkle, Spinner, PencilSimpleLine,
} from '@phosphor-icons/react';

const Gallery: React.FC = () => {
    const { closeApp, characters, apiConfig, addToast } = useOS();
    const [view, setView] = useState<'albums' | 'grid' | 'detail'>('albums');
    const [activeCharId, setActiveCharId] = useState<string | null>(null);
    const [images, setImages] = useState<GalleryImage[]>([]);
    const [selectedImage, setSelectedImage] = useState<GalleryImage | null>(null);
    const [isReviewing, setIsReviewing] = useState(false);
    const [showChatContext, setShowChatContext] = useState(false);

    // Long-press delete state
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; confirmText: string; onConfirm: () => void; } | null>(null);

    // Album image counts
    const [albumCounts, setAlbumCounts] = useState<Record<string, number>>({});

    useEffect(() => {
        // Load image counts for all characters
        const loadCounts = async () => {
            const counts: Record<string, number> = {};
            for (const char of characters) {
                const imgs = await DB.getGalleryImages(char.id);
                counts[char.id] = imgs.length;
            }
            setAlbumCounts(counts);
        };
        if (view === 'albums') loadCounts();
    }, [characters, view]);

    useEffect(() => {
        if (activeCharId) {
            DB.getGalleryImages(activeCharId).then(imgs => {
                setImages(imgs.sort((a, b) => b.timestamp - a.timestamp));
            });
        }
    }, [activeCharId]);

    const handleCharClick = (id: string) => {
        setActiveCharId(id);
        setView('grid');
    };

    const handleImageClick = (img: GalleryImage) => {
        setSelectedImage(img);
        setView('detail');
    };

    const handleBack = () => {
        if (view === 'detail') { setView('grid'); setShowChatContext(false); }
        else if (view === 'grid') { setView('albums'); setActiveCharId(null); }
        else closeApp();
    };

    // Long-press handlers for album deletion
    const handleAlbumPressStart = useCallback((charId: string) => {
        longPressTimer.current = setTimeout(() => {
            const char = characters.find(c => c.id === charId);
            setConfirmDialog({
                title: '撕掉整本相册？',
                message: `「${char?.name || ''}」的照片会全部撕下来，没法再贴回去了。`,
                confirmText: '撕掉',
                onConfirm: async () => {
                    const imgs = await DB.getGalleryImages(charId);
                    for (const img of imgs) {
                        await DB.deleteGalleryImage(img.id);
                    }
                    setAlbumCounts(prev => ({ ...prev, [charId]: 0 }));
                    addToast('整本相册撕干净了', 'success');
                    setConfirmDialog(null);
                }
            });
        }, 600);
    }, [characters, addToast]);

    const handleAlbumPressEnd = useCallback(() => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    }, []);

    // Delete single image
    const handleDeleteImage = async () => {
        if (!selectedImage) return;
        setConfirmDialog({
            title: '撕掉这张照片？',
            message: '撕下来就贴不回去了，确定吗？',
            confirmText: '撕掉',
            onConfirm: async () => {
                await DB.deleteGalleryImage(selectedImage.id);
                setImages(prev => prev.filter(img => img.id !== selectedImage.id));
                setView('grid');
                setSelectedImage(null);
                addToast('撕掉了这张', 'success');
                setConfirmDialog(null);
            }
        });
    };

    const handleReview = async () => {
        if (!selectedImage || !activeCharId || !apiConfig.apiKey) {
            addToast('还没配好 API 或缺图片信息', 'error');
            return;
        }

        const char = characters.find(c => c.id === activeCharId);
        if (!char) return;

        setIsReviewing(true);
        try {
            // Build context-aware prompt
            const chatContextStr = selectedImage.chatContext?.length
                ? `\n\nContext: This photo was shared during a conversation. Here's what was being discussed:\n${selectedImage.chatContext.join('\n')}\n\nIMPORTANT: Your comment should feel natural given the conversation context above. Do NOT say things that contradict or are completely unrelated to what was being talked about.`
                : '';

            const dateStr = selectedImage.savedDate
                ? `\nThis photo is from ${selectedImage.savedDate}.`
                : '';

            const systemContent = `You are ${char.name}. ${char.systemPrompt || 'You are a helpful assistant.'}
Task: The user sent you a photo. Comment on it briefly (1-3 sentences) based on your personality.${dateStr}${chatContextStr}
Style: Casual, conversational, strictly NO AI-assistant tone. React as if you received this on a chat app.
CRITICAL: Stay in character. If there's conversation context, your comment should naturally fit that context. Don't say anything that would be bizarre given what you two were just talking about.`;

            const payload = {
                model: apiConfig.model,
                messages: [
                    { role: 'system', content: systemContent },
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: "Look at this photo I sent you." },
                            {
                                type: 'image_url',
                                image_url: {
                                    url: selectedImage.url
                                }
                            }
                        ]
                    }
                ],
                max_tokens: 8000,
                temperature: 0.7,
                stream: false
            };

            const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiConfig.apiKey}`
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                let errorMsg = `HTTP Error ${response.status}`;
                try {
                    const errData = await safeResponseJson(response);
                    errorMsg = errData.error?.message || JSON.stringify(errData.error) || errorMsg;
                    if (errorMsg.includes('vision') || errorMsg.includes('image')) {
                        errorMsg = '当前模型可能不支持图片识别(Vision)，请切换模型。';
                    }
                } catch (e) {
                    const text = await response.text();
                    if(text) errorMsg = text.slice(0, 100);
                }
                throw new Error(errorMsg);
            }

            const data = await safeResponseJson(response);
            const choice = data.choices?.[0];

            if (choice?.finish_reason === 'content_filter') {
                throw new Error('AI 拒绝回复 (图片可能包含敏感内容)');
            }

            let reviewText = choice?.message?.content;
            if (!reviewText && choice?.message?.reasoning_content) {
                reviewText = choice.message.reasoning_content;
            }
            if (!reviewText && choice?.text) reviewText = choice.text;
            if (!reviewText && choice?.delta?.content) reviewText = choice.delta.content;

            if (!reviewText) {
                const debugStr = JSON.stringify(choice || data);
                console.warn('AI Empty Response Structure:', data);
                throw new Error(`AI 返回内容为空. Raw: ${debugStr.substring(0, 100)}...`);
            }

            await DB.updateGalleryImageReview(selectedImage.id, reviewText);

            const updatedImage = { ...selectedImage, review: reviewText, reviewTimestamp: Date.now() };
            setSelectedImage(updatedImage);
            setImages(prev => prev.map(img => img.id === selectedImage.id ? updatedImage : img));

            addToast('TA 在背面题了字', 'success');

        } catch (e: any) {
            console.error('Review Error:', e);
            addToast(`题字失败: ${e.message}`, 'error');
        } finally {
            setIsReviewing(false);
        }
    };

    // --- Sub-Components ---

    const [imgStatus, setImgStatus] = useState<Record<string, 'loading' | 'loaded' | 'error'>>({});
    const activeChar = characters.find(c => c.id === activeCharId);

    const renderAlbums = () => (
        <div className="relative z-10 grid grid-cols-2 gap-x-4 gap-y-6 p-5 animate-fade-in">
            {characters.map((char, i) => {
                const count = albumCounts[char.id] || 0;
                const status = imgStatus[char.id] || 'loading';
                const tilt = i % 3 === 0 ? -2 : i % 3 === 1 ? 1.5 : -1;
                return (
                    <button
                        key={char.id}
                        onClick={() => handleCharClick(char.id)}
                        onTouchStart={() => handleAlbumPressStart(char.id)}
                        onTouchEnd={handleAlbumPressEnd}
                        onTouchCancel={handleAlbumPressEnd}
                        onMouseDown={() => handleAlbumPressStart(char.id)}
                        onMouseUp={handleAlbumPressEnd}
                        onMouseLeave={handleAlbumPressEnd}
                        className="relative group active:scale-95 transition-transform"
                        style={{ transform: `rotate(${tilt}deg)` }}
                    >
                        <WashiTape color={i % 2 ? 'ink' : 'butter'} rotate={i % 2 ? -5 : 4} className="absolute -top-2.5 left-1/2 -translate-x-1/2 w-14 h-5 rounded-[2px] z-20" />
                        {/* 拍立得相框（照片保留彩色） */}
                        <div className="p-2 pb-8" style={{ background: '#fffdf8', border: '1px solid rgba(176,170,158,0.8)', borderRadius: 6, boxShadow: '0 12px 22px -12px rgba(31,29,26,0.5)' }}>
                            <div className="w-full relative overflow-hidden" style={{ paddingBottom: '100%', borderRadius: 3, background: 'linear-gradient(135deg,#d9d4c8,#b9b4a8)' }}>
                                <div className="absolute inset-0 z-0 flex items-center justify-center pointer-events-none">
                                    <span className="text-5xl font-black select-none" style={{ color: 'rgba(255,255,255,0.65)' }}>{char.name.charAt(0)}</span>
                                </div>
                                {status !== 'error' && (
                                    <img
                                        src={char.avatar}
                                        alt={char.name}
                                        className={`absolute inset-0 w-full h-full object-cover z-10 transition-opacity duration-300 ${status === 'loaded' ? 'opacity-100' : 'opacity-0'}`}
                                        loading="lazy"
                                        decoding="async"
                                        onLoad={() => setImgStatus(prev => ({ ...prev, [char.id]: 'loaded' }))}
                                        onError={() => setImgStatus(prev => ({ ...prev, [char.id]: 'error' }))}
                                    />
                                )}
                            </div>
                            {/* 相框题字条 */}
                            <div className="absolute left-0 right-0 bottom-1.5 px-3 flex items-center justify-between gap-1">
                                <span className="text-[12px] font-black truncate" style={{ color: '#36322b' }}>{char.name}</span>
                                {count > 0 && <span className="text-[9px] font-black tabular-nums px-1.5 py-0.5 rounded-full shrink-0" style={{ background: INK, color: PAPER }}>{count}</span>}
                            </div>
                        </div>
                    </button>
                );
            })}
            {characters.length === 0 && <div className="col-span-2 text-center py-16 text-xs" style={{ color: INK_SOFT }}>还没有谁的相册</div>}
        </div>
    );

    const renderGrid = () => (
        <div className="relative z-10 flex-1 overflow-y-auto no-scrollbar p-3 animate-fade-in">
            {images.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center gap-3 py-20" style={{ color: INK_SOFT }}>
                    <Images size={52} weight="thin" style={{ opacity: 0.5 }} />
                    <span className="text-sm">这本相册还空着</span>
                </div>
            ) : (
                <div className="grid grid-cols-3 gap-1.5">
                    {images.map(img => (
                        <button key={img.id} onClick={() => handleImageClick(img)} className="aspect-square relative overflow-hidden active:scale-95 transition-transform" style={{ background: '#fffdf8', padding: 3, borderRadius: 4, border: '1px solid rgba(176,170,158,0.7)', boxShadow: '0 6px 12px -8px rgba(31,29,26,0.4)' }}>
                            <img src={img.url} className="w-full h-full object-cover" style={{ borderRadius: 2 }} loading="lazy" />
                            {img.review && <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full" style={{ background: INK, boxShadow: '0 0 0 2px #fffdf8' }} />}
                            {img.savedDate && <div className="absolute bottom-1 left-1 right-1"><span className="text-[8px] px-1 rounded font-black" style={{ background: 'rgba(31,29,26,0.6)', color: PAPER, fontFamily: 'var(--font-label)' }}>{img.savedDate}</span></div>}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );

    const renderDetail = () => selectedImage && (
        <div className="flex flex-col h-full relative animate-fade-in" style={{ background: 'linear-gradient(180deg,#211f1b,#13120f)' }}>
            {/* Header */}
            <div className="absolute top-0 left-0 w-full p-4 flex justify-between items-start z-50 pointer-events-none" style={{ paddingTop: 'calc(var(--safe-top) + 8px)' }}>
                <button onClick={() => setView('grid')} className="pointer-events-auto active:scale-95 transition-transform p-2.5 rounded-full" style={{ background: 'rgba(246,243,236,0.92)', color: INK, boxShadow: '0 4px 10px -4px rgba(0,0,0,0.6)' }}>
                    <CaretLeft size={20} weight="bold" />
                </button>
                <button onClick={handleDeleteImage} className="pointer-events-auto active:scale-95 transition-transform p-2.5 rounded-full" style={{ background: 'rgba(246,243,236,0.92)', color: INK, boxShadow: '0 4px 10px -4px rgba(0,0,0,0.6)' }}>
                    <Trash size={18} weight="bold" />
                </button>
            </div>

            {/* Date badge */}
            {selectedImage.savedDate && (
                <div className="absolute z-50 left-1/2 -translate-x-1/2" style={{ top: 'calc(var(--safe-top) + 16px)' }}>
                    <span className="text-[10px] px-3 py-1 rounded-full font-black" style={{ background: 'rgba(246,243,236,0.9)', color: INK_SOFT, fontFamily: 'var(--font-label)' }}>{selectedImage.savedDate}</span>
                </div>
            )}

            {/* Main Image（贴在暗台上的照片） */}
            <div className="flex-1 min-h-0 w-full flex items-center justify-center relative overflow-hidden p-3">
                <img
                    src={selectedImage.url}
                    className="max-w-full max-h-full object-contain"
                    style={{ background: '#fffdf8', padding: 8, borderRadius: 4, boxShadow: '0 24px 48px -18px rgba(0,0,0,0.8)' }}
                    alt="Detail"
                />
            </div>

            {/* Review & Context Section（照片背面的题字，米白纸卡） */}
            <div className="shrink-0 w-full z-40" style={{ background: 'linear-gradient(180deg,#fbf9f2,#f1eee4)', borderTop: '1px solid rgba(176,170,158,0.7)', paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}>
                {selectedImage.review ? (
                    <div className="p-5 animate-slide-up">
                        <div className="flex items-start gap-3 mb-3">
                            <img src={activeChar?.avatar} className="w-9 h-9 rounded-full object-cover shrink-0" style={{ border: '1px solid rgba(176,170,158,0.8)' }} />
                            <div className="flex-1 min-w-0">
                                <div className="text-[10px] font-black mb-1.5 tracking-[0.2em] uppercase flex items-center gap-1" style={{ color: INK_SOFT, fontFamily: 'var(--font-label)' }}><PencilSimpleLine size={11} weight="bold" />{activeChar?.name} 写在背面</div>
                                <p className="text-[15px] leading-relaxed select-text" style={{ color: INK, fontFamily: 'var(--font-hand)', fontSize: 18 }}>“{selectedImage.review}”</p>
                            </div>
                        </div>
                        <div className="flex justify-between items-center pt-2 mt-2" style={{ borderTop: '1px dashed rgba(150,144,132,0.5)' }}>
                            {selectedImage.chatContext && selectedImage.chatContext.length > 0 && (
                                <button onClick={() => setShowChatContext(!showChatContext)} className="text-[10px] transition-colors flex items-center gap-1 px-2 py-1 font-bold" style={{ color: INK_SOFT }}>
                                    <ChatCircleText size={12} weight="bold" />
                                    {showChatContext ? '收起对话' : '翻到那天的对话'}
                                </button>
                            )}
                            <button onClick={handleReview} disabled={isReviewing} className="text-[10px] transition-colors flex items-center gap-1 px-2 py-1 ml-auto font-bold disabled:opacity-50" style={{ color: INK }}>
                                <ArrowsClockwise size={12} weight="bold" className={isReviewing ? 'animate-spin' : ''} />
                                {isReviewing ? '提笔中…' : '换句题字'}
                            </button>
                        </div>
                        {/* Chat context expandable */}
                        {showChatContext && selectedImage.chatContext && (
                            <div className="mt-3 rounded-xl p-3 space-y-1.5 max-h-40 overflow-y-auto no-scrollbar" style={{ background: 'rgba(232,228,217,0.5)', border: '1px dashed rgba(150,144,132,0.5)' }}>
                                <div className="text-[9px] uppercase tracking-wider mb-2 font-black" style={{ color: INK_SOFT, fontFamily: 'var(--font-label)' }}>拍下这张时的对话</div>
                                {selectedImage.chatContext.map((line, i) => (
                                    <div key={i} className="text-[11px] leading-relaxed" style={{ color: '#48443c' }}>{line}</div>
                                ))}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="p-5 flex flex-col items-center gap-3">
                        <ScrapButton variant="ink" onClick={handleReview} disabled={isReviewing} className="px-6 py-3 text-sm"
                            icon={isReviewing ? <Spinner size={16} className="animate-spin" /> : <PencilSimpleLine size={16} weight="bold" />}>
                            {isReviewing ? '提笔中…' : '请 TA 在背面写句话'}
                        </ScrapButton>
                        {selectedImage.chatContext && selectedImage.chatContext.length > 0 && (
                            <button onClick={() => setShowChatContext(!showChatContext)} className="text-[10px] transition-colors font-bold" style={{ color: INK_SOFT }}>
                                {showChatContext ? '收起对话记录' : '翻到那天的对话'}
                            </button>
                        )}
                        {showChatContext && selectedImage.chatContext && (
                            <div className="w-full rounded-xl p-3 space-y-1.5 max-h-40 overflow-y-auto no-scrollbar" style={{ background: 'rgba(232,228,217,0.5)', border: '1px dashed rgba(150,144,132,0.5)' }}>
                                <div className="text-[9px] uppercase tracking-wider mb-2 font-black" style={{ color: INK_SOFT, fontFamily: 'var(--font-label)' }}>拍下这张时的对话</div>
                                {selectedImage.chatContext.map((line, i) => (
                                    <div key={i} className="text-[11px] leading-relaxed" style={{ color: '#48443c' }}>{line}</div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );

    return (
        <div className="h-full w-full flex flex-col relative overflow-hidden" style={{ color: INK, background: PAGE_BG }}>
            {view !== 'detail' && <PaperBackdrop corners={false} />}

            {/* 撕照片 / 撕相册确认弹窗（统一纸面弹窗） */}
            <PaperDialog open={!!confirmDialog} title={confirmDialog?.title} en="TEAR IT OFF" tape="ink" onClose={() => setConfirmDialog(null)}
                actions={confirmDialog ? <>
                    <ScrapButton variant="paper" onClick={() => setConfirmDialog(null)} className="flex-1 py-2.5 text-[13px]">留着</ScrapButton>
                    <ScrapButton variant="ink" onClick={confirmDialog.onConfirm} className="flex-1 py-2.5 text-[13px]">{confirmDialog.confirmText}</ScrapButton>
                </> : null}>
                {confirmDialog?.message}
            </PaperDialog>

            {/* Header */}
            {view !== 'detail' && (
                <div className="relative z-20 shrink-0">
                    <div style={{ height: 'var(--safe-top)' }} />
                    <div className="flex items-center px-3 pt-2 pb-2.5 gap-2">
                        <button onClick={handleBack} className="relative inline-flex items-center gap-1 px-3 py-2 text-[12px] font-black active:scale-95 transition-transform" style={{ color: '#36322b' }}>
                            <span aria-hidden className="absolute inset-0 rounded-[6px]" style={{ backgroundColor: WASHI.butter.base, backgroundImage: TAPE_STRIPES, transform: 'rotate(-2deg)', boxShadow: '0 3px 7px -3px rgba(31,29,26,0.5)' }} />
                            <span className="relative z-10 flex items-center gap-1"><CaretLeft size={13} weight="bold" />{view === 'albums' ? '收起' : '相册'}</span>
                        </button>
                        <div className="leading-none">
                            <div className="text-[16px] font-black tracking-[0.04em]" style={{ color: INK }}>{view === 'albums' ? '相册' : activeChar?.name || '相册'}</div>
                            <div className="text-[7px] tracking-[0.36em] uppercase mt-0.5" style={{ fontFamily: 'var(--font-label)', color: INK_SOFT }}>{view === 'albums' ? 'THE PHOTO ALBUM' : `${images.length} PHOTOS`}</div>
                        </div>
                        <div className="flex-1" />
                    </div>
                </div>
            )}

            {view === 'albums' && <div className="flex-1 overflow-y-auto no-scrollbar min-h-0">{renderAlbums()}</div>}
            {view === 'grid' && renderGrid()}
            {view === 'detail' && renderDetail()}
        </div>
    );
};

export default Gallery;
