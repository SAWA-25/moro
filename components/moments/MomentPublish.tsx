import React, { useRef, useState } from 'react';
import { CaretRight, Lock, MapPin, UserCirclePlus, Globe, X } from '@phosphor-icons/react';
import { CharacterProfile, SocialPost } from '../../types';
import { processImage } from '../../utils/file';
import Modal from '../os/Modal';

export interface MomentPublishData {
    content: string;
    images: string[];
    location?: string;
    mentionedCharIds: string[];
    visibility: 'public' | 'private';
    repostOf?: SocialPost['repostOf'];
}

interface MomentPublishProps {
    characters: CharacterProfile[];
    /** 转发模式：预填原帖摘要 */
    initialRepost?: SocialPost['repostOf'];
    onCancel: () => void;
    onPublish: (data: MomentPublishData) => void;
    addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const MAX_IMAGES = 9;

/** 发表页：仿微信朋友圈发布界面（取消 / 发表 / 这一刻的想法 / 图片九宫格 / 位置 / 提醒谁看 / 谁可以看） */
const MomentPublish: React.FC<MomentPublishProps> = ({ characters, initialRepost, onCancel, onPublish, addToast }) => {
    const [content, setContent] = useState('');
    const [images, setImages] = useState<string[]>([]);
    const [location, setLocation] = useState('');
    const [mentionedCharIds, setMentionedCharIds] = useState<string[]>([]);
    const [visibility, setVisibility] = useState<'public' | 'private'>('public');

    const [showLocationModal, setShowLocationModal] = useState(false);
    const [locationDraft, setLocationDraft] = useState('');
    const [showMentionModal, setShowMentionModal] = useState(false);
    const [showVisibilityModal, setShowVisibilityModal] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const isRepost = !!initialRepost;
    // 转发时有原帖兜底，发纯文字/纯图都行；普通动态需要文字或图片
    const canPublish = isRepost || !!content.trim() || images.length > 0;

    const handlePickImages = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        e.target.value = ''; // 允许重复选同一张
        if (files.length === 0) return;
        const room = MAX_IMAGES - images.length;
        if (room <= 0) { addToast(`最多只能添加 ${MAX_IMAGES} 张图片`, 'error'); return; }
        try {
            const picked = await Promise.all(
                files.slice(0, room).map(f => processImage(f, { maxWidth: 1280 }))
            );
            setImages(prev => [...prev, ...picked]);
            if (files.length > room) addToast(`最多 ${MAX_IMAGES} 张，已截断`, 'info');
        } catch (err: any) {
            addToast(err?.message || '图片处理失败', 'error');
        }
    };

    const toggleMention = (id: string) => {
        setMentionedCharIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    const handlePublish = () => {
        if (!canPublish) return;
        onPublish({
            content: content.trim(),
            images,
            location: location.trim() || undefined,
            mentionedCharIds,
            visibility,
            repostOf: initialRepost || null,
        });
    };

    const mentionedNames = characters
        .filter(c => mentionedCharIds.includes(c.id))
        .map(c => c.name)
        .join('、');

    return (
        <div className="absolute inset-0 z-50 bg-white flex flex-col animate-slide-up">
            {/* 顶栏：取消 / 发表 */}
            <div
                className="flex items-center justify-between px-4 border-b border-slate-50 shrink-0"
                style={{ paddingTop: 'max(12px, env(safe-area-inset-top))', paddingBottom: '10px' }}
            >
                <button onClick={onCancel} className="text-slate-600 text-sm px-1 py-1 active:opacity-60">取消</button>
                <span className="text-sm font-bold text-slate-800">{isRepost ? '转发' : '发表'}</span>
                <button
                    onClick={handlePublish}
                    disabled={!canPublish}
                    className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${canPublish ? 'bg-[#07c160] text-white shadow-md shadow-green-200 active:scale-95' : 'bg-slate-100 text-slate-300'}`}
                >
                    发表
                </button>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar">
                <div className="p-5">
                    <textarea
                        value={content}
                        onChange={e => setContent(e.target.value)}
                        placeholder={isRepost ? '说说你的看法...' : '这一刻的想法...'}
                        autoFocus
                        className="w-full min-h-[120px] resize-none outline-none text-base leading-relaxed placeholder:text-slate-300 text-slate-800"
                    />

                    {/* 转发原帖摘要 */}
                    {initialRepost && (
                        <div className="mt-2 bg-slate-100 rounded-xl p-3 flex gap-2 items-start">
                            {initialRepost.images && initialRepost.images[0] && (
                                <img src={initialRepost.images[0]} className="w-12 h-12 rounded-lg object-cover shrink-0" />
                            )}
                            <p className="text-[13px] text-slate-500 leading-snug line-clamp-3">
                                <span className="text-[#576b95] font-medium">{initialRepost.authorName}</span>
                                ：{initialRepost.content || '(图片动态)'}
                            </p>
                        </div>
                    )}

                    {/* 图片九宫格选择（转发不再附图，与微信一致） */}
                    {!isRepost && (
                        <div className="grid grid-cols-3 gap-2 mt-4">
                            {images.map((img, i) => (
                                <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-slate-100">
                                    <img src={img} className="w-full h-full object-cover" />
                                    <button
                                        onClick={() => setImages(prev => prev.filter((_, idx) => idx !== i))}
                                        className="absolute top-1 right-1 w-5 h-5 bg-black/50 text-white rounded-full flex items-center justify-center backdrop-blur-sm active:scale-90"
                                    >
                                        <X size={11} weight="bold" />
                                    </button>
                                </div>
                            ))}
                            {images.length < MAX_IMAGES && (
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    className="aspect-square rounded-lg bg-slate-100 flex items-center justify-center text-slate-300 text-4xl font-thin active:bg-slate-200 transition-colors"
                                >
                                    +
                                </button>
                            )}
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                multiple
                                className="hidden"
                                onChange={handlePickImages}
                            />
                        </div>
                    )}
                </div>

                {/* 设置行 */}
                <div className="mt-2 border-t border-slate-100">
                    <button
                        onClick={() => { setLocationDraft(location); setShowLocationModal(true); }}
                        className="w-full flex items-center gap-3 px-5 py-4 border-b border-slate-50 active:bg-slate-50"
                    >
                        <MapPin size={20} className="text-slate-600" />
                        <span className="text-sm text-slate-700 flex-1 text-left">所在位置</span>
                        <span className="text-xs text-slate-400 max-w-[40%] truncate">{location || ''}</span>
                        <CaretRight size={14} className="text-slate-300" />
                    </button>
                    <button
                        onClick={() => setShowMentionModal(true)}
                        className="w-full flex items-center gap-3 px-5 py-4 border-b border-slate-50 active:bg-slate-50"
                    >
                        <UserCirclePlus size={20} className="text-slate-600" />
                        <span className="text-sm text-slate-700 flex-1 text-left">提醒谁看</span>
                        <span className="text-xs text-slate-400 max-w-[40%] truncate">{mentionedNames}</span>
                        <CaretRight size={14} className="text-slate-300" />
                    </button>
                    <button
                        onClick={() => setShowVisibilityModal(true)}
                        className="w-full flex items-center gap-3 px-5 py-4 border-b border-slate-50 active:bg-slate-50"
                    >
                        {visibility === 'public'
                            ? <Globe size={20} className="text-slate-600" />
                            : <Lock size={20} className="text-slate-600" />}
                        <span className="text-sm text-slate-700 flex-1 text-left">谁可以看</span>
                        <span className="text-xs text-slate-400">{visibility === 'public' ? '公开' : '私密'}</span>
                        <CaretRight size={14} className="text-slate-300" />
                    </button>
                </div>
            </div>

            {/* 所在位置：简单文本输入 */}
            <Modal
                isOpen={showLocationModal}
                title="所在位置"
                onClose={() => setShowLocationModal(false)}
                footer={
                    <>
                        <button onClick={() => { setLocation(''); setShowLocationModal(false); }} className="flex-1 py-3 bg-slate-100 text-slate-500 font-bold rounded-2xl text-sm active:scale-95 transition-transform">不显示位置</button>
                        <button onClick={() => { setLocation(locationDraft.trim()); setShowLocationModal(false); }} className="flex-1 py-3 bg-[#07c160] text-white font-bold rounded-2xl text-sm active:scale-95 transition-transform">确定</button>
                    </>
                }
            >
                <input
                    value={locationDraft}
                    onChange={e => setLocationDraft(e.target.value)}
                    placeholder="输入一个位置，如：海边·落日观景台"
                    maxLength={30}
                    className="w-full text-sm bg-slate-50 rounded-xl px-4 py-3 outline-none border border-slate-100 focus:border-[#07c160]/50 text-slate-800 placeholder:text-slate-300"
                />
            </Modal>

            {/* 提醒谁看：角色多选（被提醒的角色保证互动） */}
            <Modal
                isOpen={showMentionModal}
                title="提醒谁看"
                onClose={() => setShowMentionModal(false)}
                footer={
                    <button onClick={() => setShowMentionModal(false)} className="flex-1 py-3 bg-[#07c160] text-white font-bold rounded-2xl text-sm active:scale-95 transition-transform">完成</button>
                }
            >
                <p className="text-[11px] text-slate-400 bg-slate-50 p-2 rounded-lg mb-3">被提醒的角色一定会来你这条动态下互动。</p>
                <div className="space-y-1">
                    {characters.length === 0 && <div className="text-center text-xs text-slate-300 py-6">还没有角色</div>}
                    {characters.map(c => {
                        const checked = mentionedCharIds.includes(c.id);
                        return (
                            <button key={c.id} onClick={() => toggleMention(c.id)} className="w-full flex items-center gap-3 p-2 rounded-xl active:bg-slate-50">
                                <img src={c.avatar} className="w-9 h-9 rounded-full object-cover" />
                                <span className="text-sm text-slate-700 flex-1 text-left truncate">{c.name}</span>
                                <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${checked ? 'bg-[#07c160] border-[#07c160]' : 'border-slate-200'}`}>
                                    {checked && <span className="text-white text-[10px] font-bold">✓</span>}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </Modal>

            {/* 谁可以看：公开 / 私密 */}
            <Modal isOpen={showVisibilityModal} title="谁可以看" onClose={() => setShowVisibilityModal(false)}>
                <div className="space-y-2">
                    {([
                        { key: 'public', icon: <Globe size={18} />, label: '公开', desc: '角色们可以看到并互动' },
                        { key: 'private', icon: <Lock size={18} />, label: '私密', desc: '仅自己可见，角色不会互动' },
                    ] as const).map(opt => (
                        <button
                            key={opt.key}
                            onClick={() => { setVisibility(opt.key); setShowVisibilityModal(false); }}
                            className={`w-full flex items-center gap-3 p-3 rounded-2xl border transition-colors ${visibility === opt.key ? 'border-[#07c160] bg-green-50/50' : 'border-slate-100 active:bg-slate-50'}`}
                        >
                            <span className={visibility === opt.key ? 'text-[#07c160]' : 'text-slate-500'}>{opt.icon}</span>
                            <span className="flex-1 text-left">
                                <span className="block text-sm font-bold text-slate-700">{opt.label}</span>
                                <span className="block text-[11px] text-slate-400">{opt.desc}</span>
                            </span>
                            {visibility === opt.key && <span className="text-[#07c160] text-sm font-bold">✓</span>}
                        </button>
                    ))}
                </div>
            </Modal>
        </div>
    );
};

export default MomentPublish;
