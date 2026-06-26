
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { GalleryImage } from '../types';
import { safeResponseJson } from '../utils/safeApi';
import {
    InsShell, InsHeader, InsScroll, Polaroid, StoryRing, InsCard, InsButton,
    IconCircle, InsEmpty, InsDialog, SectionLabel, accent, INK, INK_SOFT,
} from '../components/ui/insKit';
import {
    Trash, ArrowsClockwise, ChatCircleText, Images, Sparkle, Spinner, PencilSimpleLine, CaretLeft,
} from '@phosphor-icons/react';

// 相册的强调色（取自 constants：相册 = orange）
const AC = 'orange' as const;

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
                title: '清空这本相册？',
                message: `「${char?.name || ''}」的照片会全部移除，没法再找回来了。`,
                confirmText: '清空',
                onConfirm: async () => {
                    const imgs = await DB.getGalleryImages(charId);
                    for (const img of imgs) {
                        await DB.deleteGalleryImage(img.id);
                    }
                    setAlbumCounts(prev => ({ ...prev, [charId]: 0 }));
                    addToast('整本相册清空了', 'success');
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
            title: '删掉这张照片？',
            message: '删掉就找不回来了，确定吗？',
            confirmText: '删掉',
            onConfirm: async () => {
                await DB.deleteGalleryImage(selectedImage.id);
                setImages(prev => prev.filter(img => img.id !== selectedImage.id));
                setView('grid');
                setSelectedImage(null);
                addToast('删掉了这张', 'success');
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

            addToast('TA 留了句话', 'success');

        } catch (e: any) {
            console.error('Review Error:', e);
            addToast(`留言失败: ${e.message}`, 'error');
        } finally {
            setIsReviewing(false);
        }
    };

    // --- Sub-Components ---

    const activeChar = characters.find(c => c.id === activeCharId);

    // 相册墙：每位角色一张拍立得（头像彩照 + 手写名 + 张数角标），错落微旋转
    const renderAlbums = () => (
        <div className="relative z-10 grid grid-cols-2 gap-x-5 gap-y-8 px-5 pt-3 pb-8">
            {characters.map((char, i) => {
                const count = albumCounts[char.id] || 0;
                const tilt = i % 4 === 0 ? -2.5 : i % 4 === 1 ? 1.8 : i % 4 === 2 ? -1.2 : 2.4;
                return (
                    <Polaroid
                        key={char.id}
                        src={char.avatar}
                        caption={char.name}
                        rotate={tilt}
                        accent={AC}
                        fallback={char.name.charAt(0)}
                        onClick={() => handleCharClick(char.id)}
                        onPointerDown={() => handleAlbumPressStart(char.id)}
                        onPointerUp={handleAlbumPressEnd}
                        onPointerLeave={handleAlbumPressEnd}
                        style={{ animationDelay: `${i * 45}ms` }}
                    >
                        {count > 0 && (
                            <span className="absolute top-1.5 left-1.5 text-[10px] font-black tabular-nums px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.92)', color: accent(AC).ink, boxShadow: '0 2px 6px rgba(0,0,0,0.15)' }}>{count} 张</span>
                        )}
                    </Polaroid>
                );
            })}
            {characters.length === 0 && (
                <div className="col-span-2"><InsEmpty icon={<Images size={52} weight="thin" />} title="还没有谁的相册" hint="和角色聊天、收到照片后，这里会自动出现 TA 的相册本" /></div>
            )}
        </div>
    );

    // 网格：IG 个人主页式——顶部故事环头像 + 名字 + 张数，下面紧密三列彩照网格
    const renderGrid = () => (
        <InsScroll className="px-0">
            {/* IG 式资料条 */}
            <div className="flex items-center gap-4 px-5 pt-2 pb-4">
                <StoryRing src={activeChar?.avatar} size={64} active={images.length > 0} spin={false} fallback={activeChar?.name?.charAt(0)} />
                <div className="min-w-0">
                    <div className="text-[18px] font-extrabold truncate" style={{ color: INK }}>{activeChar?.name || '相册'}</div>
                    <div className="text-[12px] mt-0.5" style={{ color: INK_SOFT }}>
                        <span className="font-bold tabular-nums" style={{ color: INK }}>{images.length}</span> 张照片
                    </div>
                </div>
            </div>
            {images.length === 0 ? (
                <InsEmpty icon={<Images size={52} weight="thin" />} title="这本相册还空着" hint="收到的照片会陆续贴进来" />
            ) : (
                <div className="grid grid-cols-3 gap-[3px] px-[3px] pb-6">
                    {images.map((img, i) => (
                        <button key={img.id} onClick={() => handleImageClick(img)} className="aspect-square relative overflow-hidden press-soft" style={{ background: accent(AC).soft }}>
                            <img src={img.url} className="w-full h-full object-cover animate-photo-develop" style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }} loading="lazy" />
                            {img.review && (
                                <span className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.92)', boxShadow: '0 2px 5px rgba(0,0,0,0.2)' }}>
                                    <ChatCircleText size={11} weight="fill" style={{ color: accent(AC).solid }} />
                                </span>
                            )}
                            {img.savedDate && (
                                <div className="absolute bottom-1 left-1">
                                    <span className="text-[8px] px-1.5 py-0.5 rounded-md font-bold tabular-nums" style={{ background: 'rgba(0,0,0,0.42)', color: '#fff', fontFamily: 'var(--font-label)' }}>{img.savedDate}</span>
                                </div>
                            )}
                        </button>
                    ))}
                </div>
            )}
        </InsScroll>
    );

    // 详情：暖调灯箱 + 拍立得照片，底部「背面题字」白卡
    const renderDetail = () => selectedImage && (
        <div className="flex flex-col h-full relative animate-fade-in" style={{ background: 'linear-gradient(180deg,#2a2723,#16140f)' }}>
            {/* Header */}
            <div className="absolute top-0 left-0 w-full p-4 flex justify-between items-start z-50" style={{ paddingTop: 'calc(var(--safe-top) + 8px)' }}>
                <IconCircle tone="glass" onClick={() => { setView('grid'); setShowChatContext(false); }} title="返回"><CaretLeft size={18} weight="bold" /></IconCircle>
                {selectedImage.savedDate && (
                    <span className="self-center text-[10px] px-3 py-1.5 rounded-full font-bold" style={{ background: 'rgba(255,255,255,0.16)', color: '#fff', fontFamily: 'var(--font-label)', backdropFilter: 'blur(8px)' }}>{selectedImage.savedDate}</span>
                )}
                <IconCircle tone="glass" onClick={handleDeleteImage} title="删除"><Trash size={17} weight="bold" /></IconCircle>
            </div>

            {/* 拍立得照片（暗台上轻微旋转） */}
            <div className="flex-1 min-h-0 w-full flex items-center justify-center relative overflow-hidden p-6">
                <div className="animate-develop" style={{ ['--pl-rot' as any]: '-1.2deg', maxHeight: '100%', maxWidth: '100%' }}>
                    <div className="p-2.5 pb-7" style={{ background: '#fff', borderRadius: 8, boxShadow: '0 30px 60px -20px rgba(0,0,0,0.75)' }}>
                        <img src={selectedImage.url} className="max-w-full object-contain" style={{ maxHeight: '52vh', borderRadius: 3, display: 'block' }} alt="Detail" />
                        {selectedImage.review && (
                            <div className="absolute left-0 right-0 bottom-1.5 px-4 text-center">
                                <span className="text-[12px] font-bold truncate block" style={{ color: '#8a857c', fontFamily: 'var(--font-hand)' }}>{activeChar?.name} · 留言已写在背面</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* 背面题字白卡 */}
            <div className="shrink-0 w-full z-40" style={{ background: '#fff', borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingBottom: 'max(env(safe-area-inset-bottom), 12px)', boxShadow: '0 -18px 40px -22px rgba(0,0,0,0.6)' }}>
                {selectedImage.review ? (
                    <div className="p-5 animate-slide-up">
                        <div className="flex items-start gap-3 mb-2">
                            <StoryRing src={activeChar?.avatar} size={40} active fallback={activeChar?.name?.charAt(0)} />
                            <div className="flex-1 min-w-0">
                                <div className="text-[11px] font-bold mb-1 flex items-center gap-1" style={{ color: accent(AC).solid }}><PencilSimpleLine size={12} weight="bold" />{activeChar?.name} 写在背面</div>
                                <p className="text-[17px] leading-relaxed select-text" style={{ color: INK, fontFamily: 'var(--font-hand)' }}>“{selectedImage.review}”</p>
                            </div>
                        </div>
                        <div className="flex justify-between items-center pt-2.5 mt-1" style={{ borderTop: '1px solid rgba(0,0,0,0.06)' }}>
                            {selectedImage.chatContext && selectedImage.chatContext.length > 0 ? (
                                <button onClick={() => setShowChatContext(!showChatContext)} className="text-[11px] flex items-center gap-1 px-2 py-1 font-bold press-soft" style={{ color: INK_SOFT }}>
                                    <ChatCircleText size={13} weight="bold" />
                                    {showChatContext ? '收起对话' : '翻到那天的对话'}
                                </button>
                            ) : <span />}
                            <button onClick={handleReview} disabled={isReviewing} className="text-[11px] flex items-center gap-1 px-2 py-1 ml-auto font-bold disabled:opacity-50 press-soft" style={{ color: accent(AC).solid }}>
                                <ArrowsClockwise size={13} weight="bold" className={isReviewing ? 'animate-spin' : ''} />
                                {isReviewing ? '提笔中…' : '换句留言'}
                            </button>
                        </div>
                        {showChatContext && selectedImage.chatContext && (
                            <div className="mt-3 rounded-2xl p-3.5 space-y-1.5 max-h-40 overflow-y-auto no-scrollbar" style={{ background: accent(AC).soft }}>
                                <SectionLabel en="THAT DAY" accent={AC}>拍下这张时的对话</SectionLabel>
                                {selectedImage.chatContext.map((line, i) => (
                                    <div key={i} className="text-[12px] leading-relaxed" style={{ color: '#5a5660' }}>{line}</div>
                                ))}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="p-5 flex flex-col items-center gap-3">
                        <InsButton variant="solid" accent={AC} onClick={handleReview} disabled={isReviewing} className="px-6 py-3 text-sm"
                            icon={isReviewing ? <Spinner size={16} className="animate-spin" /> : <Sparkle size={16} weight="fill" />}>
                            {isReviewing ? '提笔中…' : `请 ${activeChar?.name || 'TA'} 写句话`}
                        </InsButton>
                        {selectedImage.chatContext && selectedImage.chatContext.length > 0 && (
                            <button onClick={() => setShowChatContext(!showChatContext)} className="text-[11px] font-bold press-soft" style={{ color: INK_SOFT }}>
                                {showChatContext ? '收起对话记录' : '翻到那天的对话'}
                            </button>
                        )}
                        {showChatContext && selectedImage.chatContext && (
                            <div className="w-full rounded-2xl p-3.5 space-y-1.5 max-h-40 overflow-y-auto no-scrollbar" style={{ background: accent(AC).soft }}>
                                <SectionLabel en="THAT DAY" accent={AC}>拍下这张时的对话</SectionLabel>
                                {selectedImage.chatContext.map((line, i) => (
                                    <div key={i} className="text-[12px] leading-relaxed" style={{ color: '#5a5660' }}>{line}</div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );

    return (
        <InsShell accent={AC}>
            {/* 清空 / 删除确认弹窗 */}
            <InsDialog open={!!confirmDialog} title={confirmDialog?.title} en="ARE YOU SURE" accent={AC} onClose={() => setConfirmDialog(null)}
                actions={confirmDialog ? <>
                    <InsButton variant="soft" accent="slate" onClick={() => setConfirmDialog(null)} className="flex-1 py-2.5 text-[13px]">留着</InsButton>
                    <InsButton variant="solid" accent={AC} onClick={confirmDialog.onConfirm} className="flex-1 py-2.5 text-[13px]">{confirmDialog.confirmText}</InsButton>
                </> : null}>
                {confirmDialog?.message}
            </InsDialog>

            {view !== 'detail' && (
                <InsHeader
                    accent={AC}
                    title={view === 'albums' ? '相册' : activeChar?.name || '相册'}
                    en={view === 'albums' ? 'THE GALLERY' : `${images.length} PHOTOS`}
                    onBack={handleBack}
                />
            )}

            {view === 'albums' && <div className="flex-1 overflow-y-auto no-scrollbar min-h-0">{renderAlbums()}</div>}
            {view === 'grid' && renderGrid()}
            {view === 'detail' && renderDetail()}
        </InsShell>
    );
};

export default Gallery;
