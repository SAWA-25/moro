
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useOS, DEFAULT_WALLPAPER } from '../context/OSContext';
import { OSTheme, DesktopDecoration, DesktopWidgetPref, AppearancePreset, Toast } from '../types';
import { INSTALLED_APPS, Icons } from '../constants';
import { processImage } from '../utils/file';
import { DB } from '../utils/db';
import { Sparkle } from '@phosphor-icons/react';
import { ChatAppearanceEditor as ModularChatAppearanceEditor } from '../components/appearance/ChatAppearanceEditor';
import ThemeMaker from './ThemeMaker';
import ChromeCssEditor from '../components/chat/ChromeCssEditor';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

// Touch-friendly long-press wrapper. `onContextMenu` alone misses iOS Safari /
// Capacitor WebView, so we also wire pointer/touch timers to fire after ~550ms.
// When a long-press fires, the subsequent click is suppressed.
const LongPressArea: React.FC<{
    onLongPress: () => void;
    onClick?: () => void;
    delay?: number;
    className?: string;
    style?: React.CSSProperties;
    children?: React.ReactNode;
}> = ({ onLongPress, onClick, delay = 550, className, style, children }) => {
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const fired = useRef(false);
    const startPos = useRef<{ x: number; y: number } | null>(null);

    const clear = useCallback(() => {
        if (timer.current) { clearTimeout(timer.current); timer.current = null; }
        startPos.current = null;
    }, []);

    useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

    const start = (x: number, y: number) => {
        fired.current = false;
        startPos.current = { x, y };
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
            fired.current = true;
            onLongPress();
        }, delay);
    };
    const move = (x: number, y: number) => {
        const sp = startPos.current;
        if (!sp) return;
        if (Math.hypot(x - sp.x, y - sp.y) > 8) clear();
    };

    return (
        <div
            className={className}
            style={style}
            onContextMenu={(e) => { e.preventDefault(); onLongPress(); }}
            onTouchStart={(e) => { const t = e.touches[0]; if (t) start(t.clientX, t.clientY); }}
            onTouchMove={(e) => { const t = e.touches[0]; if (t) move(t.clientX, t.clientY); }}
            onTouchEnd={clear}
            onTouchCancel={clear}
            onPointerDown={(e) => { if (e.pointerType !== 'touch') start(e.clientX, e.clientY); }}
            onPointerMove={(e) => { if (e.pointerType !== 'touch') move(e.clientX, e.clientY); }}
            onPointerUp={clear}
            onPointerLeave={clear}
            onPointerCancel={clear}
            onClick={() => {
                if (fired.current) { fired.current = false; return; }
                onClick?.();
            }}
        >
            {children}
        </div>
    );
};

const TwemojiImg: React.FC<{ code: string; alt?: string; className?: string }> = ({ code, alt, className = 'w-4 h-4 inline-block' }) => (
  <img src={`https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/${code}.png`} alt={alt || ''} className={className} draggable={false} />
);

const CATEGORY_LABELS: Record<string, { code: string; label: string }> = {
  'stars': { code: '2728', label: 'Stars' },
  'hearts': { code: '1f496', label: 'Hearts' },
  'flowers': { code: '1f338', label: 'Flowers' },
  'ribbons': { code: '1f380', label: 'Ribbons' },
  'animals': { code: '1f431', label: 'Animals' },
  'shapes': { code: '1f52e', label: 'Shapes' },
  'badges': { code: '1f3f7', label: 'Badges' },
};

// --- Chat Appearance Editor Component ---
const AVATAR_SHAPES: { value: 'circle' | 'rounded' | 'square'; label: string; preview: string }[] = [
    { value: 'circle', label: '圆形', preview: 'rounded-full' },
    { value: 'rounded', label: '圆角', preview: 'rounded-xl' },
    { value: 'square', label: '方形', preview: 'rounded-none' },
];
const AVATAR_SIZES: { value: 'small' | 'medium' | 'large'; label: string; size: string }[] = [
    { value: 'small', label: '小', size: 'w-7 h-7' },
    { value: 'medium', label: '中', size: 'w-9 h-9' },
    { value: 'large', label: '大', size: 'w-12 h-12' },
];
const BUBBLE_STYLES: { value: 'modern' | 'flat' | 'outline' | 'shadow'; label: string; desc: string }[] = [
    { value: 'modern', label: '现代', desc: '圆角气泡+微透明' },
    { value: 'flat', label: '扁平', desc: '无阴影纯色气泡' },
    { value: 'outline', label: '描边', desc: '边框线条风格' },
    { value: 'shadow', label: '立体', desc: '深阴影立体效果' },
];
const MSG_SPACINGS: { value: 'compact' | 'default' | 'spacious'; label: string }[] = [
    { value: 'compact', label: '紧凑' },
    { value: 'default', label: '默认' },
    { value: 'spacious', label: '宽松' },
];
const HEADER_STYLES: { value: 'default' | 'minimal' | 'gradient'; label: string; desc: string }[] = [
    { value: 'default', label: '默认', desc: '标准头部' },
    { value: 'minimal', label: '简约', desc: '仅显示名字' },
    { value: 'gradient', label: '渐变', desc: '渐变色头部' },
];
const INPUT_STYLES: { value: 'default' | 'rounded' | 'flat'; label: string }[] = [
    { value: 'default', label: '默认' },
    { value: 'rounded', label: '圆角' },
    { value: 'flat', label: '扁平' },
];
const TIMESTAMP_OPTIONS: { value: 'always' | 'hover' | 'never'; label: string }[] = [
    { value: 'always', label: '始终显示' },
    { value: 'hover', label: '悬停显示' },
    { value: 'never', label: '不显示' },
];

// Chat Layout Presets (built-in combinations)
const CHAT_LAYOUT_COMBOS: { name: string; desc: string; config: Partial<OSTheme> }[] = [
    { name: '默认', desc: '标准聊天界面', config: { chatAvatarShape: 'circle', chatAvatarSize: 'medium', chatBubbleStyle: 'modern', chatMessageSpacing: 'default', chatHeaderStyle: 'default', chatInputStyle: 'default', chatShowTimestamp: 'hover' } },
    { name: 'QQ风格', desc: '圆角头像+紧凑间距', config: { chatAvatarShape: 'rounded', chatAvatarSize: 'medium', chatBubbleStyle: 'shadow', chatMessageSpacing: 'compact', chatHeaderStyle: 'gradient', chatInputStyle: 'rounded', chatShowTimestamp: 'hover' } },
    { name: '微信风格', desc: '方形头像+扁平气泡', config: { chatAvatarShape: 'square', chatAvatarSize: 'medium', chatBubbleStyle: 'flat', chatMessageSpacing: 'default', chatHeaderStyle: 'default', chatInputStyle: 'flat', chatShowTimestamp: 'hover' } },
    { name: 'iMessage', desc: '大圆头像+宽松气泡', config: { chatAvatarShape: 'circle', chatAvatarSize: 'large', chatBubbleStyle: 'modern', chatMessageSpacing: 'spacious', chatHeaderStyle: 'minimal', chatInputStyle: 'rounded', chatShowTimestamp: 'always' } },
    { name: '简约模式', desc: '小头像+最简界面', config: { chatAvatarShape: 'circle', chatAvatarSize: 'small', chatBubbleStyle: 'flat', chatMessageSpacing: 'compact', chatHeaderStyle: 'minimal', chatInputStyle: 'flat', chatShowTimestamp: 'never' } },
];

const ChatAppearanceEditor: React.FC<{ theme: OSTheme; updateTheme: (u: Partial<OSTheme>) => void }> = ({ theme, updateTheme }) => {
    const avatarShape = theme.chatAvatarShape || 'circle';
    const avatarSize = theme.chatAvatarSize || 'medium';
    const bubbleStyle = theme.chatBubbleStyle || 'modern';
    const msgSpacing = theme.chatMessageSpacing || 'default';
    const headerStyle = theme.chatHeaderStyle || 'default';
    const inputStyle = theme.chatInputStyle || 'default';
    const showTimestamp = theme.chatShowTimestamp || 'hover';

    const OptionButton: React.FC<{ active: boolean; label: string; desc?: string; onClick: () => void }> = ({ active, label, desc, onClick }) => (
        <button onClick={onClick}
            className={`px-3 py-2 text-[11px] font-bold rounded-xl border transition-all active:scale-95 ${active ? 'bg-primary/10 text-primary border-primary/30 ring-1 ring-primary/20' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}>
            <div>{label}</div>
            {desc && <div className="text-[9px] font-normal mt-0.5 opacity-70">{desc}</div>}
        </button>
    );

    return (
        <div className="space-y-5">
            {/* Quick Combo Presets */}
            <section className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-3">快速风格</h2>
                <p className="text-[10px] text-slate-400 mb-3">一键切换聊天界面风格组合，包含头像、气泡、间距等全套配置。</p>
                <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                    {CHAT_LAYOUT_COMBOS.map(combo => (
                        <button key={combo.name} onClick={() => updateTheme(combo.config)}
                            className="shrink-0 px-4 py-2.5 bg-slate-50 rounded-xl border border-slate-200 hover:border-primary/40 active:scale-95 transition-all text-left">
                            <div className="text-xs font-bold text-slate-700">{combo.name}</div>
                            <div className="text-[9px] text-slate-400 mt-0.5">{combo.desc}</div>
                        </button>
                    ))}
                </div>
            </section>

            {/* Live Preview */}
            <section className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-3">预览</h2>
                <div className="bg-slate-50 rounded-2xl border border-slate-100 overflow-hidden">
                    {/* Fake header */}
                    <div className={`px-4 py-3 flex items-center gap-3 border-b border-slate-100 ${headerStyle === 'gradient' ? 'bg-gradient-to-r from-primary/20 to-primary/5' : headerStyle === 'minimal' ? 'bg-white' : 'bg-slate-50'}`}>
                        <div className={`${AVATAR_SIZES.find(s => s.value === avatarSize)?.size || 'w-9 h-9'} ${AVATAR_SHAPES.find(s => s.value === avatarShape)?.preview || 'rounded-full'} bg-primary/20 shrink-0`} />
                        <div>
                            <div className="text-xs font-bold text-slate-700">角色名</div>
                            {headerStyle !== 'minimal' && <div className="text-[9px] text-slate-400">在线</div>}
                        </div>
                    </div>
                    {/* Fake messages */}
                    <div className={`p-3 space-y-${msgSpacing === 'compact' ? '1' : msgSpacing === 'spacious' ? '4' : '2'}`}>
                        {/* AI message */}
                        <div className="flex gap-2 items-end">
                            <div className={`${AVATAR_SIZES.find(s => s.value === avatarSize)?.size || 'w-9 h-9'} ${AVATAR_SHAPES.find(s => s.value === avatarShape)?.preview || 'rounded-full'} bg-pink-200 shrink-0`} />
                            <div className={`px-3 py-2 text-[11px] max-w-[65%] ${bubbleStyle === 'outline' ? 'bg-transparent border-2 border-slate-300 rounded-2xl rounded-bl-sm' : bubbleStyle === 'shadow' ? 'bg-white shadow-md rounded-2xl rounded-bl-sm' : bubbleStyle === 'flat' ? 'bg-slate-100 rounded-2xl rounded-bl-sm' : 'bg-white/90 backdrop-blur-sm rounded-2xl rounded-bl-sm shadow-sm'}`}>
                                你好呀，今天过得怎么样？
                                {showTimestamp === 'always' && <div className="text-[8px] text-slate-300 mt-1 text-right">14:32</div>}
                            </div>
                        </div>
                        {/* User message */}
                        <div className="flex gap-2 items-end justify-end">
                            <div className={`px-3 py-2 text-[11px] text-white max-w-[65%] ${bubbleStyle === 'outline' ? 'bg-transparent border-2 border-primary text-primary rounded-2xl rounded-br-sm' : bubbleStyle === 'shadow' ? 'bg-primary shadow-md rounded-2xl rounded-br-sm' : bubbleStyle === 'flat' ? 'bg-primary rounded-2xl rounded-br-sm' : 'bg-primary/90 backdrop-blur-sm rounded-2xl rounded-br-sm shadow-sm'}`}
                                style={bubbleStyle === 'outline' ? { color: `hsl(${theme.hue}, ${theme.saturation}%, ${theme.lightness}%)` } : undefined}>
                                挺好的，今天天气不错！
                                {showTimestamp === 'always' && <div className={`text-[8px] mt-1 text-right ${bubbleStyle === 'outline' ? 'opacity-50' : 'text-white/60'}`}>14:33</div>}
                            </div>
                            <div className={`${AVATAR_SIZES.find(s => s.value === avatarSize)?.size || 'w-9 h-9'} ${AVATAR_SHAPES.find(s => s.value === avatarShape)?.preview || 'rounded-full'} bg-primary/30 shrink-0`} />
                        </div>
                    </div>
                    {/* Fake input */}
                    <div className={`px-3 py-2 border-t border-slate-100 ${inputStyle === 'flat' ? 'bg-slate-50' : 'bg-white'}`}>
                        <div className={`bg-slate-100 px-4 py-2 text-[10px] text-slate-400 ${inputStyle === 'rounded' ? 'rounded-full' : inputStyle === 'flat' ? 'rounded-none border-b border-slate-200 bg-transparent' : 'rounded-xl'}`}>输入消息...</div>
                    </div>
                </div>
            </section>

            {/* Avatar Shape */}
            <section className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-3">头像形状</h2>
                <div className="flex gap-2">
                    {AVATAR_SHAPES.map(s => (
                        <OptionButton key={s.value} active={avatarShape === s.value} label={s.label} onClick={() => updateTheme({ chatAvatarShape: s.value })} />
                    ))}
                </div>
            </section>

            {/* Avatar Size */}
            <section className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-3">头像大小</h2>
                <div className="flex gap-2">
                    {AVATAR_SIZES.map(s => (
                        <OptionButton key={s.value} active={avatarSize === s.value} label={s.label} onClick={() => updateTheme({ chatAvatarSize: s.value })} />
                    ))}
                </div>
            </section>

            {/* Bubble Style */}
            <section className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-3">气泡风格</h2>
                <div className="flex gap-2 flex-wrap">
                    {BUBBLE_STYLES.map(s => (
                        <OptionButton key={s.value} active={bubbleStyle === s.value} label={s.label} desc={s.desc} onClick={() => updateTheme({ chatBubbleStyle: s.value })} />
                    ))}
                </div>
            </section>

            {/* Message Spacing */}
            <section className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-3">消息间距</h2>
                <div className="flex gap-2">
                    {MSG_SPACINGS.map(s => (
                        <OptionButton key={s.value} active={msgSpacing === s.value} label={s.label} onClick={() => updateTheme({ chatMessageSpacing: s.value })} />
                    ))}
                </div>
            </section>

            {/* Header Style */}
            <section className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-3">聊天头部</h2>
                <div className="flex gap-2 flex-wrap">
                    {HEADER_STYLES.map(s => (
                        <OptionButton key={s.value} active={headerStyle === s.value} label={s.label} desc={s.desc} onClick={() => updateTheme({ chatHeaderStyle: s.value })} />
                    ))}
                </div>
            </section>

            {/* Input Style */}
            <section className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-3">输入框样式</h2>
                <div className="flex gap-2">
                    {INPUT_STYLES.map(s => (
                        <OptionButton key={s.value} active={inputStyle === s.value} label={s.label} onClick={() => updateTheme({ chatInputStyle: s.value })} />
                    ))}
                </div>
            </section>

            {/* Timestamp Display */}
            <section className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-3">时间戳显示</h2>
                <div className="flex gap-2">
                    {TIMESTAMP_OPTIONS.map(s => (
                        <OptionButton key={s.value} active={showTimestamp === s.value} label={s.label} onClick={() => updateTheme({ chatShowTimestamp: s.value })} />
                    ))}
                </div>
            </section>

            <div className="text-[10px] text-slate-400 text-center px-4 pb-4">
                聊天界面设置全局生效。单个角色的气泡颜色、背景图等可在聊天内的「捏主题」中自定义。
            </div>
        </div>
    );
};

// --- Preset Manager Component ---
interface PresetManagerProps {
    presets: AppearancePreset[];
    onSave: (name: string) => void;
    onApply: (id: string) => void;
    onDelete: (id: string) => void;
    onRename: (id: string, name: string) => void;
    onExport: (id: string) => Promise<Blob>;
    onImport: (file: File) => Promise<void>;
    onReset: () => Promise<void>;
    addToast: (msg: string, type?: Toast['type']) => void;
    currentTheme: OSTheme;
}

const PresetManager: React.FC<PresetManagerProps> = ({ presets, onSave, onApply, onDelete, onRename, onExport, onImport, onReset, addToast, currentTheme }) => {
    const [newName, setNewName] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const [confirmReset, setConfirmReset] = useState(false);
    const [resetting, setResetting] = useState(false);
    const importRef = useRef<HTMLInputElement>(null);

    const handleReset = async () => {
        setResetting(true);
        try {
            await onReset();
        } finally {
            setResetting(false);
            setConfirmReset(false);
        }
    };

    const handleSave = () => {
        const name = newName.trim() || `存档 ${new Date().toLocaleDateString('zh-CN')}`;
        onSave(name);
        setNewName('');
    };

    const handleExport = async (id: string) => {
        try {
            const blob = await onExport(id);
            const preset = presets.find(p => p.id === id);
            const fileName = `appearance_${preset?.name || 'preset'}.zip`;
            const title = `拼贴册存档 - ${preset?.name || 'preset'}`;

            if (Capacitor.isNativePlatform()) {
                // Native: 写到 Cache 再调系统分享
                const base64 = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(String(reader.result).split(',')[1] || '');
                    reader.onerror = () => reject(reader.error);
                    reader.readAsDataURL(blob);
                });
                await Filesystem.writeFile({ path: fileName, data: base64, directory: Directory.Cache });
                const uri = await Filesystem.getUri({ directory: Directory.Cache, path: fileName });
                await Share.share({ title, files: [uri.uri] });
            } else {
                // Web: 先触发浏览器原生下载，再尝试拉起系统分享面板
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = fileName;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                try {
                    const file = new File([blob], fileName, { type: 'application/zip' });
                    if (
                        typeof navigator !== 'undefined' &&
                        typeof navigator.share === 'function' &&
                        (typeof (navigator as any).canShare !== 'function' || (navigator as any).canShare({ files: [file] }))
                    ) {
                        await navigator.share({ title, files: [file] });
                    }
                } catch (shareErr: any) {
                    // 用户取消分享是正常情况，吞掉
                    if (shareErr?.name !== 'AbortError') {
                        console.warn('[Appearance] share failed', shareErr);
                    }
                }
            }
            addToast('存档导出了', 'success');
        } catch (e: any) {
            addToast(e.message || '导出没成', 'error');
        }
    };

    const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            await onImport(file);
        } catch (err: any) {
            addToast(err.message || '夹入没成', 'error');
        }
        if (importRef.current) importRef.current.value = '';
    };

    const handleRename = (id: string) => {
        if (editName.trim()) {
            onRename(id, editName.trim());
        }
        setEditingId(null);
        setEditName('');
    };

    return (
        <div className="space-y-5">
            {/* One-click Reset */}
            <section className="bg-[#f4f2ed] p-5 border-2 border-[#2b2933] border-dashed shadow-[3px_3px_0_rgba(43,41,51,0.18)]">
                <div className="flex items-center gap-2 mb-2">
                    <h2 className="text-base font-bold font-display-italic text-[#2b2933]">撕回最初那页</h2>
                </div>
                <p className="text-[10px] text-[#6b6b6b] mb-3 leading-relaxed">
                    把主色、壁纸、字体、图标、桌面贴图、贴纸全部撕回出厂的样子。版本之间反复导预设、图标乱套时用它。<br/>
                    <span className="text-[#8b8996]">已存的存档不会丢，随时还能翻回去。</span>
                </p>
                {!confirmReset ? (
                    <button onClick={() => setConfirmReset(true)}
                        className="w-full py-2.5 bg-[#fbfaf7] text-[#2b2933] font-bold text-xs label-mono border-2 border-[#2b2933] active:translate-x-[1px] active:translate-y-[1px] transition-transform flex items-center justify-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>
                        撕回出厂样
                    </button>
                ) : (
                    <div className="flex gap-2">
                        <button onClick={handleReset} disabled={resetting}
                            className="flex-1 py-2.5 bg-[#2b2933] text-[#fbfaf7] font-bold text-xs label-mono active:translate-x-[1px] active:translate-y-[1px] transition-transform disabled:opacity-50">
                            {resetting ? '撕回中…' : '确认撕回'}
                        </button>
                        <button onClick={() => setConfirmReset(false)} disabled={resetting}
                            className="flex-1 py-2.5 bg-[#fbfaf7] text-[#6b6b6b] font-bold text-xs label-mono border-2 border-[#2b2933] active:translate-x-[1px] active:translate-y-[1px] transition-transform disabled:opacity-50">
                            算了
                        </button>
                    </div>
                )}
            </section>

            {/* Save Current */}
            <section className="bg-[#fbfaf7] p-5 border-2 border-[#2b2933] shadow-[3px_3px_0_rgba(43,41,51,0.18)]">
                <h2 className="text-base font-bold font-display-italic text-[#2b2933] mb-3">把这页存起来</h2>
                <p className="text-[10px] text-[#6b6b6b] mb-3">把当前的主色、壁纸、字体、图标、贴纸整页存成一份，以后随时翻回来。</p>
                <div className="flex gap-2">
                    <input
                        value={newName}
                        onChange={e => setNewName(e.target.value)}
                        placeholder="给这页起个名（可留空）"
                        className="flex-1 bg-[#f4f2ed] border-2 border-[#2b2933] px-4 py-2.5 text-xs outline-none focus:shadow-[2px_2px_0_#2b2933] transition-all"
                        onKeyDown={e => e.key === 'Enter' && handleSave()}
                    />
                    <button onClick={handleSave}
                        className="px-5 py-2.5 bg-[#2b2933] text-[#fbfaf7] font-bold text-xs label-mono active:translate-x-[1px] active:translate-y-[1px] transition-transform shrink-0">
                        存档
                    </button>
                </div>
            </section>

            {/* Import */}
            <section className="bg-[#fbfaf7] p-5 border-2 border-[#2b2933] shadow-[3px_3px_0_rgba(43,41,51,0.18)]">
                <h2 className="text-base font-bold font-display-italic text-[#2b2933] mb-3">夹一页进来</h2>
                <p className="text-[10px] text-[#6b6b6b] mb-3">从 .zip 文件夹入别人分享的外观存档（也认旧版 .json）。系统整机备份里也带当前外观，单独的存档更适合分享。</p>
                <input type="file" ref={importRef} className="hidden" accept=".zip,.json,application/zip,application/json" onChange={handleImport} />
                <button onClick={() => importRef.current?.click()}
                    className="w-full py-2.5 bg-[#fbfaf7] text-[#2b2933] font-bold text-xs label-mono border-2 border-dashed border-[#2b2933] hover:bg-[#2b2933] hover:text-[#fbfaf7] active:translate-x-[1px] active:translate-y-[1px] transition-all flex items-center justify-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                    选个文件夹入
                </button>
            </section>

            {/* Preset List */}
            <section className="bg-[#fbfaf7] p-5 border-2 border-[#2b2933] shadow-[3px_3px_0_rgba(43,41,51,0.18)]">
                <h2 className="text-base font-bold font-display-italic text-[#2b2933] mb-3">存档册 · {presets.length} 页</h2>
                {presets.length === 0 ? (
                    <div className="text-center py-8">
                        <div className="text-3xl mb-2 opacity-40">
                            <Sparkle size={48} weight="fill" className="mx-auto text-[#c4c1b8]" />
                        </div>
                        <p className="text-xs text-[#8b8996]">册子还是空的</p>
                        <p className="text-[10px] text-[#c4c1b8] mt-1">存一页当前外观，或夹一份别人的进来</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {presets.map(preset => (
                            <div key={preset.id} className="bg-[#f4f2ed] border-2 border-[#2b2933] overflow-hidden shadow-[2px_2px_0_rgba(43,41,51,0.15)]">
                                {/* Preview bar */}
                                <div className="h-14 relative overflow-hidden"
                                    style={{
                                        background: (() => {
                                            const wp = preset.theme.wallpaper;
                                            if (!wp) return `linear-gradient(135deg, hsl(${preset.theme.hue}, ${preset.theme.saturation}%, ${preset.theme.lightness}%), hsl(${preset.theme.hue + 30}, ${preset.theme.saturation}%, ${Math.max(preset.theme.lightness - 15, 10)}%))`;
                                            if (wp.startsWith('linear-gradient') || wp.startsWith('radial-gradient') || wp.startsWith('conic-gradient')) return wp;
                                            return `url("${wp}") center/cover`;
                                        })(),
                                    }}>
                                    <div className="absolute inset-0 bg-[#2b2933]/10" />
                                    <div className="absolute bottom-1.5 left-3 flex gap-1">
                                        <div className="w-4 h-4 border border-[#2b2933]" style={{ backgroundColor: `hsl(${preset.theme.hue}, ${preset.theme.saturation}%, ${preset.theme.lightness}%)` }} />
                                        <div className="w-4 h-4 border border-[#2b2933]" style={{ backgroundColor: preset.theme.contentColor || '#fff' }} />
                                    </div>
                                    {preset.theme.desktopDecorations && preset.theme.desktopDecorations.length > 0 && (
                                        <div className="absolute bottom-1.5 right-3 text-[8px] text-[#fbfaf7] bg-[#2b2933] px-1.5 py-0.5 label-mono">
                                            贴纸 {preset.theme.desktopDecorations.length}
                                        </div>
                                    )}
                                </div>

                                {/* Info & actions */}
                                <div className="p-3">
                                    {editingId === preset.id ? (
                                        <div className="flex gap-2 mb-2">
                                            <input
                                                value={editName}
                                                onChange={e => setEditName(e.target.value)}
                                                className="flex-1 bg-[#fbfaf7] border-2 border-[#2b2933] px-3 py-1.5 text-xs outline-none focus:shadow-[2px_2px_0_#2b2933]"
                                                autoFocus
                                                onKeyDown={e => { if (e.key === 'Enter') handleRename(preset.id); if (e.key === 'Escape') setEditingId(null); }}
                                            />
                                            <button onClick={() => handleRename(preset.id)} className="px-3 py-1.5 bg-[#2b2933] text-[#fbfaf7] text-[10px] font-bold label-mono">好</button>
                                            <button onClick={() => setEditingId(null)} className="px-3 py-1.5 bg-[#fbfaf7] text-[#6b6b6b] border-2 border-[#2b2933] text-[10px] font-bold label-mono">退</button>
                                        </div>
                                    ) : (
                                        <div className="flex items-center justify-between mb-2">
                                            <div>
                                                <div className="text-xs font-bold text-[#2b2933]">{preset.name}</div>
                                                <div className="text-[9px] text-[#8b8996] font-mono">{new Date(preset.createdAt).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                                            </div>
                                        </div>
                                    )}

                                    <div className="flex gap-1.5 flex-wrap">
                                        <button onClick={() => onApply(preset.id)}
                                            className="px-3 py-1.5 bg-[#2b2933] text-[#fbfaf7] text-[10px] font-bold label-mono active:translate-x-[1px] active:translate-y-[1px] transition-transform">
                                            翻到这页
                                        </button>
                                        <button onClick={() => handleExport(preset.id)}
                                            className="px-3 py-1.5 bg-[#fbfaf7] text-[#2b2933] text-[10px] font-bold label-mono border-2 border-[#2b2933] active:translate-x-[1px] active:translate-y-[1px] transition-transform">
                                            导出
                                        </button>
                                        <button onClick={() => { setEditingId(preset.id); setEditName(preset.name); }}
                                            className="px-3 py-1.5 bg-[#fbfaf7] text-[#6b6b6b] text-[10px] font-bold label-mono border-2 border-[#2b2933]/30 active:translate-x-[1px] active:translate-y-[1px] transition-transform">
                                            改名
                                        </button>
                                        {confirmDeleteId === preset.id ? (
                                            <div className="flex gap-1">
                                                <button onClick={() => { onDelete(preset.id); setConfirmDeleteId(null); }}
                                                    className="px-3 py-1.5 bg-[#2b2933] text-[#fbfaf7] text-[10px] font-bold label-mono active:translate-x-[1px] active:translate-y-[1px] transition-transform">
                                                    确认撕掉
                                                </button>
                                                <button onClick={() => setConfirmDeleteId(null)}
                                                    className="px-3 py-1.5 bg-[#fbfaf7] text-[#6b6b6b] border-2 border-[#2b2933] text-[10px] font-bold label-mono active:translate-x-[1px] active:translate-y-[1px] transition-transform">
                                                    算了
                                                </button>
                                            </div>
                                        ) : (
                                            <button onClick={() => setConfirmDeleteId(preset.id)}
                                                className="px-3 py-1.5 bg-[#fbfaf7] text-[#2b2933] text-[10px] font-bold label-mono border-2 border-dashed border-[#2b2933]/50 active:translate-x-[1px] active:translate-y-[1px] transition-transform">
                                                撕掉
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            <div className="text-[10px] text-[#8b8996] text-center px-4 pb-4 font-hand text-sm">
                每页存档都能单独导入/导出，也会随整机备份一起留着。想存几页存几页，随时翻着换。
            </div>
        </div>
    );
};

// ===== 小部位实时预览（桌面零件 / 聊天白框）=====
// 预览 mock 挂了与真实组件相同的 .moro-* 钩子类：主题色 / 壁纸 / 全局 CSS / 白框 CSS 改动即时反映。
const previewWallpaperStyle = (wp: string): React.CSSProperties => {
    const isUrl = wp.startsWith('http') || wp.startsWith('data:') || wp.startsWith('blob:');
    return isUrl
        ? { backgroundImage: `url(${wp})`, backgroundSize: 'cover', backgroundPosition: 'center' }
        : { background: wp || '#eef0f6' };
};

const DesktopMiniPreview: React.FC<{ theme: OSTheme }> = ({ theme }) => {
    const ink = theme.contentColor || '#3f3d49';
    return (
        <div className="rounded-[22px] overflow-hidden border border-slate-200 shadow-inner select-none pointer-events-none"
            style={{ ...previewWallpaperStyle(theme.wallpaper), color: ink }}>
            {/* 状态栏 */}
            <div className="moro-status-bar flex justify-between px-4 pt-2.5 text-[8px] font-bold label-mono opacity-80">
                <span>12:17</span><span>5G ▮▮▮</span>
            </div>
            <div className="px-4 pt-2 pb-3 space-y-2">
                {/* 时钟卡 */}
                <div className="moro-clock-card glass-card rounded-2xl px-3.5 py-2.5 relative overflow-hidden">
                    <div className="flex justify-between text-[7px] label-mono font-bold opacity-60"><span>APRIL 07</span><span>TUESDAY</span></div>
                    <div className="moro-clock-time font-display-italic font-semibold text-[26px] leading-tight">12:17</div>
                    <div className="moro-clock-greeting text-[8px] opacity-70">天天开心，万事顺意。</div>
                    <span className="moro-palette-btn label-mono inline-block text-[6.5px] font-bold mt-1.5 px-2.5 py-1 rounded-full text-white" style={{ background: '#2c2a35' }}>Palette</span>
                </div>
                {/* 角色卡 */}
                <div className="moro-character-card glass-card rounded-2xl px-3.5 py-2 flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                        <div className="text-[6.5px] label-mono font-bold opacity-50 truncate">Moro Card</div>
                        <div className="font-display-italic text-[13px] font-semibold leading-tight">聊天</div>
                    </div>
                    <div className="w-7 h-7 rounded-lg bg-white/70 border border-white shadow-sm shrink-0" />
                </div>
                {/* 应用瓦片 */}
                <div className="grid grid-cols-4 gap-1.5">
                    {['聊天', '剧情', '关系', '音乐'].map(n => (
                        <div key={n} className="flex flex-col items-center gap-0.5">
                            <div className="moro-app-tile w-8 h-8 rounded-[10px] bg-white/72 border border-[#ececf2] shadow-sm flex items-center justify-center">
                                <div className="w-3 h-3 rounded-full border-[1.5px]" style={{ borderColor: ink, opacity: 0.6 }} />
                            </div>
                            <span className="moro-app-label text-[6px] label-mono font-bold opacity-60">{n}</span>
                        </div>
                    ))}
                </div>
                {/* Dock */}
                <div className="moro-dock glass-pill rounded-full px-3 py-1.5 flex justify-around items-center mx-3">
                    {[0, 1, 2, 3].map(i => (
                        <div key={i} className="moro-dock-icon w-6 h-6 rounded-full bg-white/55 border border-[#e4e3ec] shadow-sm" />
                    ))}
                </div>
            </div>
        </div>
    );
};

const ChromeMiniPreview: React.FC<{ chromeCss?: string }> = ({ chromeCss }) => (
    <div className="moro-chat-root rounded-[22px] overflow-hidden border border-slate-200 bg-[#f7f7f9] select-none pointer-events-none">
        {chromeCss && <style>{chromeCss}</style>}
        <div className="moro-chat-header flex items-center gap-2 px-3 py-2.5 bg-white/80 border-b border-slate-200/60">
            <span className="moro-chat-back text-slate-500 text-xs px-1">‹</span>
            <div className="moro-chat-avatar w-7 h-7 rounded-full bg-gradient-to-br from-indigo-200 to-pink-200" />
            <div className="min-w-0">
                <div className="moro-chat-name text-[10px] font-bold text-slate-800">聊天对象</div>
                <div className="moro-chat-status text-[8px] text-slate-400 uppercase">Online</div>
            </div>
            <div className="moro-chat-token ml-auto text-[7px] font-mono text-slate-400 bg-slate-100 border border-slate-200 rounded px-1 py-0.5">42 tok</div>
        </div>
        <div className="p-3 space-y-2">
            <div className="flex justify-start"><div className="moro-bubble-ai max-w-[75%] px-3 py-1.5 rounded-lg bg-[#f4f4f6] border border-black/5 text-[9px] text-slate-700">白框 CSS 改动会即时反映在这里。</div></div>
            <div className="flex justify-end"><div className="moro-bubble-user max-w-[75%] px-3 py-1.5 rounded-lg bg-[#ededf1] border border-black/5 text-[9px] text-slate-700">比如挪顶栏、换输入栏底色。</div></div>
        </div>
        <div className="moro-chat-inputbar flex items-center gap-1.5 px-3 py-2 bg-white/90 border-t border-slate-200/50">
            <div className="w-5 h-5 rounded-full bg-slate-100 shrink-0" />
            <div className="flex-1 h-5 rounded-full bg-slate-100 px-2 text-[8px] text-slate-400 flex items-center">输入消息...</div>
            <div className="w-5 h-5 rounded-full bg-primary shrink-0" />
        </div>
    </div>
);

// 「自定义 CSS」工作台：全局 CSS（整机）+ 聊天白框全局 CSS，都带小部位实时预览。
const CustomCssStudio: React.FC<{
    theme: OSTheme;
    updateTheme: (u: Partial<OSTheme>) => void;
    onResetAllChrome: () => void;
    addToast: (msg: string, type?: Toast['type']) => void;
}> = ({ theme, updateTheme, onResetAllChrome, addToast }) => {
    const GLOBAL_HOOKS = [
        '.moro-clock-card', '.moro-clock-time', '.moro-clock-greeting', '.moro-palette-btn',
        '.moro-character-card', '.moro-app-tile', '.moro-app-label', '.moro-dock', '.moro-dock-icon',
        '.moro-status-bar', '.moro-widget-card', '.moro-lock-screen', '.glass-card', '.glass-pill',
    ];
    const GLOBAL_EXAMPLE = `/* 例：把桌面时钟卡换成奶油黄、Dock 改半透明黑 */
.moro-clock-card { background: #fff8e1 !important; }
.moro-dock { background: rgba(20,20,28,0.55) !important; border-color: transparent !important; }
.moro-dock-icon { background: rgba(255,255,255,0.12) !important; }`;
    return (
        <div className="space-y-5">
            <section className="bg-[#fbfaf7] p-5 border-2 border-[#2b2933] shadow-[3px_3px_0_rgba(43,41,51,0.18)]">
                <h2 className="text-base font-bold font-display-italic text-[#2b2933] mb-1">整机手写码</h2>
                <p className="text-[10px] text-[#6b6b6b] leading-relaxed mb-3">
                    写进整机（桌面 / 锁屏 / 所有 App），落笔即生效。桌面每个零件都有 .moro-* 钩子类可精准点名；
                    写崩了删掉就好（Dock 和桌面 Palette 按钮受保护、永远能点，从那能摸回这里）。
                </p>
                <div className="mb-3">
                    <div className="text-[10px] font-bold text-[#8b8996] label-mono mb-1.5">取景框（桌面零件）</div>
                    <DesktopMiniPreview theme={theme} />
                </div>
                <div className="flex flex-wrap gap-1 mb-2">
                    {GLOBAL_HOOKS.map(h => (
                        <code key={h} className="text-[9px] bg-[#2b2933] text-[#fbfaf7] px-1.5 py-0.5">{h}</code>
                    ))}
                </div>
                <textarea
                    value={theme.globalCustomCss || ''}
                    onChange={(e) => updateTheme({ globalCustomCss: e.target.value })}
                    spellCheck={false}
                    placeholder={GLOBAL_EXAMPLE}
                    className="w-full h-44 bg-[#2b2933] text-[#f4f2ed] font-mono text-[11px] leading-relaxed p-3.5 resize-none outline-none border-2 border-[#2b2933] focus:ring-2 focus:ring-[#2b2933]"
                />
                <div className="flex gap-2 mt-2">
                    <button
                        onClick={() => { updateTheme({ globalCustomCss: GLOBAL_EXAMPLE }); addToast('样张填进去了', 'success'); }}
                        className="flex-1 py-2 bg-[#fbfaf7] border-2 border-[#2b2933] text-[#2b2933] text-[11px] font-bold label-mono active:translate-x-[1px] active:translate-y-[1px] transition-transform">填样张</button>
                    <button
                        onClick={() => { updateTheme({ globalCustomCss: '' }); addToast('整机手写码擦了', 'success'); }}
                        className="flex-1 py-2 border-2 border-dashed border-[#2b2933]/50 bg-[#f4f2ed] text-[#2b2933] text-[11px] font-bold label-mono active:translate-x-[1px] active:translate-y-[1px] transition-transform">擦干净</button>
                </div>
            </section>

            <section className="bg-[#fbfaf7] p-5 border-2 border-[#2b2933] shadow-[3px_3px_0_rgba(43,41,51,0.18)]">
                <h2 className="text-base font-bold font-display-italic text-[#2b2933] mb-1">聊天白框 · 手写码</h2>
                <p className="text-[10px] text-[#6b6b6b] leading-relaxed mb-3">
                    管所有角色的聊天顶栏 / 输入栏 / 气泡（.moro-chat-*）。单个角色的专属白框还是在该角色聊天「＋ → 白框」里写，叠在这层之上。
                </p>
                <div className="mb-3">
                    <div className="text-[10px] font-bold text-[#8b8996] label-mono mb-1.5">取景框（聊天白框）</div>
                    <ChromeMiniPreview chromeCss={theme.chatChromeCustomCss} />
                </div>
                <ChromeCssEditor value={theme.chatChromeCustomCss || ''} onChange={(css) => updateTheme({ chatChromeCustomCss: css })} />
                <button
                    onClick={() => { if (window.confirm('确定把全部聊天白框手写码都撕掉？会清空「全局」和「每个角色」的码。')) onResetAllChrome(); }}
                    className="mt-3 w-full border-2 border-dashed border-[#2b2933]/50 bg-[#f4f2ed] px-4 py-3 text-[12px] font-bold label-mono text-[#2b2933] transition-all hover:bg-[#2b2933] hover:text-[#fbfaf7] active:translate-x-[1px] active:translate-y-[1px]">
                    一键全撕 · 救援
                </button>
            </section>
        </div>
    );
};

// ── 「桌面与锁屏」编辑器 ──────────────────────────────────────────────────────
// 桌面小组件（显示/删除、网格尺寸横竖样式、自定义 CSS）+ 灵动岛美化 + 锁屏美化（壁纸/时钟字体/通知卡/解锁动画/CSS）

const DESKTOP_WIDGET_DEFS: { id: string; label: string; defaultW: number; defaultH: number; desc: string }[] = [
    { id: 'clock', label: '时钟日期卡', defaultW: 4, defaultH: 6, desc: '大号日期 + 时间 + 问候语' },
    { id: 'character', label: '聊天预览卡', defaultW: 4, defaultH: 2, desc: '最近消息 + 未读角标' },
    { id: 'schedule', label: '日程卡', defaultW: 4, defaultH: 5, desc: '角色今日日程' },
    { id: 'music', label: '音乐卡', defaultW: 2, defaultH: 4, desc: '正在播放' },
    { id: 'image', label: '方图卡', defaultW: 2, defaultH: 4, desc: '自定义图片格' },
    { id: 'text', label: '文字便签', defaultW: 4, defaultH: 3, desc: '点一下就地写字贴桌面' },
];

const WIDGET_SIZE_PRESETS: { label: string; w: number; h: number }[] = [
    { label: '小方块 2×4', w: 2, h: 4 },
    { label: '横版 4×3', w: 4, h: 3 },
    { label: '竖版 2×6', w: 2, h: 6 },
    { label: '大卡 4×6', w: 4, h: 6 },
];

const DESKTOP_ICON_SHAPES = [
    { value: 'rounded', label: '圆角' },
    { value: 'squircle', label: '超圆' },
    { value: 'circle', label: '圆形' },
    { value: 'stamp', label: '贴纸' },
] as const;

const DESKTOP_ICON_SURFACES = [
    { value: 'paper', label: '纸片' },
    { value: 'glass', label: '玻璃' },
    { value: 'solid', label: '纯色' },
    { value: 'minimal', label: '极简' },
] as const;

const DESKTOP_ICON_SCALES = [
    { value: 'sm', label: '紧凑' },
    { value: 'md', label: '默认' },
    { value: 'lg', label: '舒展' },
] as const;

const DESKTOP_LABEL_MODES = [
    { value: 'show', label: '常显' },
    { value: 'fade', label: '淡显' },
    { value: 'hide', label: '隐藏' },
] as const;

const DESKTOP_DOCK_STYLES = [
    { value: 'glass', label: '玻璃' },
    { value: 'paper', label: '纸片' },
    { value: 'solid', label: '墨块' },
    { value: 'minimal', label: '极简' },
] as const;

const DESKTOP_DRAG_MODES = [
    { value: 'gentle', label: '温柔' },
    { value: 'balanced', label: '平衡' },
    { value: 'snappy', label: '利落' },
] as const;

const DESKTOP_EDIT_EFFECTS = [
    { value: 'wiggle', label: '晃动' },
    { value: 'breathe', label: '呼吸' },
    { value: 'none', label: '静止' },
] as const;

const SmallChip: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
    <button
        onClick={onClick}
        className={`px-2.5 py-1.5 text-[11px] font-bold border-2 transition-all ${active ? 'bg-[#2b2933] text-[#fbfaf7] border-[#2b2933] shadow-[2px_2px_0_rgba(43,41,51,0.3)]' : 'bg-[#fbfaf7] text-[#6b6b6b] border-[#2b2933]/30 hover:border-[#2b2933]'}`}
    >{children}</button>
);

const DesktopLockEditor: React.FC<{
    theme: OSTheme;
    updateTheme: (u: Partial<OSTheme>) => void;
    addToast: (msg: string, type: Toast['type']) => void;
}> = ({ theme, updateTheme, addToast }) => {
    const prefs = theme.desktopWidgetPrefs || {};
    const island = theme.dynamicIslandStyle || {};
    const lock = theme.lockScreenStyle || {};
    const floating = theme.floatingQuickMenuStyle || {};
    const offline = theme.offlineModeStyle || {};
    const lockWallpaperRef = useRef<HTMLInputElement>(null);
    const [cssOpenId, setCssOpenId] = useState<string | null>(null);

    const setPref = (id: string, patch: Partial<DesktopWidgetPref>) => {
        const next: DesktopWidgetPref = { ...(prefs[id] || {}), ...patch };
        if (!next.hidden) delete next.hidden;
        if (!next.w) delete next.w;
        if (!next.h) delete next.h;
        if (!next.customCss?.trim()) delete next.customCss;
        const all = { ...prefs };
        if (Object.keys(next).length === 0) delete all[id];
        else all[id] = next;
        updateTheme({ desktopWidgetPrefs: Object.keys(all).length ? all : undefined });
    };

    const setIsland = (patch: Partial<NonNullable<OSTheme['dynamicIslandStyle']>>) => {
        const next = { ...island, ...patch };
        (Object.keys(next) as (keyof typeof next)[]).forEach(k => {
            const v = next[k];
            if (v === undefined || v === '' || (k === 'customCss' && !String(v).trim())) delete next[k];
        });
        updateTheme({ dynamicIslandStyle: Object.keys(next).length ? next : undefined });
    };

    const setLock = (patch: Partial<NonNullable<OSTheme['lockScreenStyle']>>) => {
        const next = { ...lock, ...patch };
        (Object.keys(next) as (keyof typeof next)[]).forEach(k => {
            const v = next[k];
            if (v === undefined || v === '' || (k === 'customCss' && !String(v).trim())) delete next[k];
        });
        updateTheme({ lockScreenStyle: Object.keys(next).length ? next : undefined });
    };

    const setFloating = (patch: Partial<NonNullable<OSTheme['floatingQuickMenuStyle']>>) => {
        const next = { ...floating, ...patch };
        (Object.keys(next) as (keyof typeof next)[]).forEach(k => {
            const v = next[k];
            if (v === undefined || v === '' || (k === 'customCss' && !String(v).trim())) delete next[k];
        });
        updateTheme({ floatingQuickMenuStyle: Object.keys(next).length ? next : undefined });
    };

    const setOffline = (patch: Partial<NonNullable<OSTheme['offlineModeStyle']>>) => {
        const next = { ...offline, ...patch };
        (Object.keys(next) as (keyof typeof next)[]).forEach(k => {
            const v = next[k];
            if (v === undefined || v === '' || (k === 'customCss' && !String(v).trim())) delete next[k];
        });
        updateTheme({ offlineModeStyle: Object.keys(next).length ? next : undefined });
    };

    const handleLockWallpaperUpload = async (file: File) => {
        try {
            addToast('正在裁锁屏壁纸…', 'info');
            const dataUrl = await processImage(file, { maxWidth: 1600, quality: 0.92 });
            setLock({ wallpaper: dataUrl });
            addToast('锁屏壁纸贴好了', 'success');
        } catch (e: any) {
            addToast(e.message, 'error');
        }
    };

    return (
        <>
            {/* 01 桌面小组件 */}
            <section className="bg-[#fbfaf7] p-5 border-2 border-[#2b2933] shadow-[3px_3px_0_rgba(43,41,51,0.18)]">
                <h2 className="text-base font-bold font-display-italic text-[#2b2933] mb-1">桌面零件</h2>
                <p className="text-[10px] text-[#6b6b6b] mb-4 leading-relaxed">
                    管每个零件的露出 / 收起、占格大小（横、竖、方随你改），还能给它写专属手写码。
                    位置直接在桌面长按拖动；零件里的贴图槽在「调色页」里设。
                </p>
                <div className="space-y-4">
                    {DESKTOP_WIDGET_DEFS.map(def => {
                        const p = prefs[def.id] || {};
                        const visible = !p.hidden;
                        const w = p.w || def.defaultW;
                        const h = p.h || def.defaultH;
                        const isDefaultSize = !p.w && !p.h;
                        return (
                            <div key={def.id} className="border-2 border-[#2b2933]/20 bg-[#f4f2ed] p-4">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="text-[13px] font-bold text-[#2b2933]">{def.label}</div>
                                        <div className="text-[10px] text-[#8b8996] mt-0.5">{def.desc} · 当前 {w}×{h}</div>
                                    </div>
                                    {/* 显示 / 删除开关 */}
                                    <button
                                        onClick={() => setPref(def.id, { hidden: visible ? true : undefined })}
                                        className={`w-11 h-[26px] p-[2px] border-2 border-[#2b2933] transition-all duration-300 flex items-center shrink-0 ${visible ? 'bg-[#2b2933]' : 'bg-[#fbfaf7]'}`}
                                        role="switch" aria-checked={visible}
                                    >
                                        <div className={`w-[18px] h-[18px] border border-[#2b2933] transition-transform duration-300 ${visible ? 'translate-x-[18px] bg-[#fbfaf7]' : 'bg-[#2b2933]'}`} />
                                    </button>
                                </div>
                                {visible && (
                                    <>
                                        <div className="flex flex-wrap gap-1.5 mt-3">
                                            <SmallChip active={isDefaultSize} onClick={() => setPref(def.id, { w: undefined, h: undefined })}>默认 {def.defaultW}×{def.defaultH}</SmallChip>
                                            {WIDGET_SIZE_PRESETS.map(s => (
                                                <SmallChip
                                                    key={s.label}
                                                    active={!isDefaultSize && w === s.w && h === s.h}
                                                    onClick={() => setPref(def.id, { w: s.w, h: s.h })}
                                                >{s.label}</SmallChip>
                                            ))}
                                        </div>
                                        {/* 微调：宽（1-4 列）/ 高（1-12 行） */}
                                        <div className="flex items-center gap-4 mt-3">
                                            {([['宽', 'w', w, 4], ['高', 'h', h, 12]] as const).map(([label, key, val, max]) => (
                                                <div key={key} className="flex items-center gap-1.5">
                                                    <span className="text-[10px] font-bold text-[#8b8996] label-mono">{label}</span>
                                                    <button onClick={() => setPref(def.id, { [key]: Math.max(1, val - 1) } as any)} className="w-6 h-6 bg-[#fbfaf7] border-2 border-[#2b2933] text-[#2b2933] text-sm leading-none active:translate-x-[1px] active:translate-y-[1px]">−</button>
                                                    <span className="text-[12px] font-mono font-bold text-[#2b2933] w-4 text-center">{val}</span>
                                                    <button onClick={() => setPref(def.id, { [key]: Math.min(max, val + 1) } as any)} className="w-6 h-6 bg-[#fbfaf7] border-2 border-[#2b2933] text-[#2b2933] text-sm leading-none active:translate-x-[1px] active:translate-y-[1px]">＋</button>
                                                </div>
                                            ))}
                                        </div>
                                        {/* 自定义 CSS */}
                                        <button
                                            onClick={() => setCssOpenId(cssOpenId === def.id ? null : def.id)}
                                            className="mt-3 text-[11px] font-bold text-[#2b2933] underline decoration-dotted underline-offset-2 label-mono"
                                        >{cssOpenId === def.id ? '收起手写码' : '给它写码…'}</button>
                                        {cssOpenId === def.id && (
                                            <div className="mt-2">
                                                <textarea
                                                    value={p.customCss || ''}
                                                    onChange={e => setPref(def.id, { customCss: e.target.value })}
                                                    placeholder={`.moro-widget-${def.id} { /* 你的样式 */ }\n.moro-widget-${def.id} .moro-clock-card { border-radius: 12px; }`}
                                                    rows={5}
                                                    spellCheck={false}
                                                    className="w-full px-3 py-2.5 bg-[#2b2933] text-[#f4f2ed] font-mono text-[11px] outline-none leading-relaxed border-2 border-[#2b2933]"
                                                />
                                                <p className="text-[10px] text-[#8b8996] mt-1">钩子类：<code className="font-mono text-[#2b2933]">.moro-widget-{def.id}</code>（零件所在网格容器）。</p>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        );
                    })}
                </div>
            </section>

            {/* 悬浮窗快捷菜单 */}
            <section className="bg-[#fbfaf7] p-5 border-2 border-[#2b2933] shadow-[3px_3px_0_rgba(43,41,51,0.18)]">
                <div className="flex items-center justify-between gap-3 mb-4">
                    <div className="min-w-0">
                        <h2 className="text-base font-bold font-display-italic text-[#2b2933] mb-1">悬浮窗快捷菜单</h2>
                        <p className="text-[10px] text-[#6b6b6b] leading-snug">可拖动的悬浮球，点开是常用 App 快捷入口；支持 CSS 和实时预览。</p>
                    </div>
                    <button
                        onClick={() => updateTheme({ floatingQuickMenu: theme.floatingQuickMenu === false })}
                        role="switch"
                        aria-checked={theme.floatingQuickMenu !== false}
                        className={`shrink-0 w-14 h-8 rounded-full border-2 border-[#2b2933] relative transition-colors ${theme.floatingQuickMenu !== false ? 'bg-[#2b2933]' : 'bg-[#f4f2ed]'}`}
                    >
                        <span className={`absolute top-[2px] w-6 h-6 rounded-full transition-all ${theme.floatingQuickMenu !== false ? 'left-[26px] bg-white' : 'left-[2px] bg-[#2b2933]'}`} />
                    </button>
                </div>
                <div className="relative h-28 bg-[#f4f2ed] border-2 border-dashed border-[#2b2933]/35 mb-4 overflow-hidden">
                    {floating.customCss && <style>{floating.customCss}</style>}
                    <div
                        className="moro-floating-quick-menu-panel absolute left-4 top-4 flex gap-2 p-2 rounded-[20px] shadow-sm"
                        style={{ background: floating.menuBackground || 'rgba(255,255,255,0.8)', border: `1px solid ${floating.borderColor || 'rgba(120,96,86,0.14)'}` }}
                    >
                        {['聊', '店', '图'].map(x => (
                            <span key={x} className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-[11px] font-bold" style={{ color: floating.pawColor || '#e0a191', border: `1px solid ${floating.borderColor || 'rgba(120,96,86,0.14)'}` }}>{x}</span>
                        ))}
                    </div>
                    <div
                        className="moro-floating-quick-menu-button absolute right-8 bottom-5 w-[54px] h-[54px] flex items-center justify-center rounded-full shadow-lg"
                        style={{
                            background: floating.bubbleBackground || 'rgba(255,255,255,0.86)',
                            color: floating.pawColor || '#e0a191',
                            border: `1px solid ${floating.borderColor || 'rgba(120,96,86,0.14)'}`,
                            ...(typeof floating.radius === 'number' ? { borderRadius: `${floating.radius}px` } : {}),
                        }}
                    >
                        <span className="text-[22px] leading-none">●</span>
                    </div>
                </div>
                <div className="space-y-4">
                    {([
                        ['bubbleBackground', '悬浮球底色', 'rgba(255,255,255,0.86)'],
                        ['menuBackground', '展开菜单底色', 'rgba(255,255,255,0.8)'],
                        ['pawColor', '猫爪 / 图标色', '#e0a191'],
                        ['textColor', '菜单文字色', '#6f615a'],
                        ['borderColor', '细边框色', 'rgba(120,96,86,0.14)'],
                    ] as const).map(([key, label, placeholder]) => (
                        <div key={key}>
                            <div className="text-[11px] font-bold text-[#2b2933] mb-1.5 label-mono">{label}</div>
                            <div className="flex items-center gap-2">
                                <input
                                    type="color"
                                    value={/^#[0-9a-fA-F]{6}$/.test(String(floating[key] || '')) ? String(floating[key]) : (key === 'pawColor' ? '#e0a191' : key === 'textColor' ? '#6f615a' : '#ffffff')}
                                    onChange={e => setFloating({ [key]: e.target.value } as any)}
                                    className="w-9 h-9 border-2 border-[#2b2933] bg-[#fbfaf7] p-1 shrink-0"
                                />
                                <input
                                    value={String(floating[key] || '')}
                                    onChange={e => setFloating({ [key]: e.target.value || undefined } as any)}
                                    placeholder={placeholder}
                                    className="flex-1 px-3 py-2 bg-[#f4f2ed] border-2 border-[#2b2933] text-[12px] font-mono outline-none"
                                />
                            </div>
                        </div>
                    ))}
                    <div>
                        <div className="flex justify-between text-[11px] font-bold text-[#2b2933] mb-1.5 label-mono">
                            <span>悬浮球圆角</span><span className="font-mono text-[#8b8996]">{typeof floating.radius === 'number' ? `${floating.radius}px` : '圆形'}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <input
                                type="range" min={0} max={28}
                                value={typeof floating.radius === 'number' ? floating.radius : 28}
                                onChange={e => setFloating({ radius: parseInt(e.target.value) >= 28 ? undefined : parseInt(e.target.value) })}
                                className="flex-1 h-1.5 bg-[#e3e0d6] rounded-full appearance-none cursor-pointer accent-[#2b2933]"
                            />
                            <SmallChip active={typeof floating.radius !== 'number'} onClick={() => setFloating({ radius: undefined })}>圆形</SmallChip>
                        </div>
                    </div>
                    <div>
                        <div className="text-[11px] font-bold text-[#2b2933] mb-1.5 label-mono">手写码（.moro-floating-quick-menu / .moro-floating-quick-menu-panel / .moro-floating-quick-menu-button）</div>
                        <textarea
                            value={floating.customCss || ''}
                            onChange={e => setFloating({ customCss: e.target.value })}
                            placeholder={`.moro-floating-quick-menu-button {\n  box-shadow: 0 0 0 3px rgba(224,161,145,.18);\n}`}
                            rows={4}
                            spellCheck={false}
                            className="w-full px-3 py-2.5 bg-[#2b2933] text-[#f4f2ed] font-mono text-[11px] outline-none leading-relaxed border-2 border-[#2b2933]"
                        />
                    </div>
                    <button
                        onClick={() => { updateTheme({ floatingQuickMenuStyle: undefined }); addToast('悬浮窗撕回默认了', 'success'); }}
                        className="text-[11px] font-bold text-[#2b2933] underline decoration-dotted underline-offset-2 label-mono"
                    >撕回默认</button>
                </div>
            </section>

            {/* 线下模式弹窗 */}
            <section className="bg-[#fbfaf7] p-5 border-2 border-[#2b2933] shadow-[3px_3px_0_rgba(43,41,51,0.18)]">
                <h2 className="text-base font-bold font-display-italic text-[#2b2933] mb-1">线下模式弹窗</h2>
                <p className="text-[10px] text-[#6b6b6b] mb-4">角色开启线下模式时弹出的面对面小窗：改底色、文字、强调色、圆角，也能写 CSS。</p>
                <div className="moro-offline-modal-backdrop bg-[#2b2933]/20 border-2 border-dashed border-[#2b2933]/35 p-4 mb-4">
                    {offline.customCss && <style>{offline.customCss}</style>}
                    <div
                        className="moro-offline-modal overflow-hidden shadow-lg"
                        style={{
                            background: offline.background || 'linear-gradient(180deg,#fbf9f2,#f2efe4)',
                            color: offline.textColor || '#1f1d1a',
                            borderRadius: typeof offline.radius === 'number' ? offline.radius : 22,
                        }}
                    >
                        <div className="moro-offline-modal-header px-4 py-3 border-b border-dashed border-black/20 text-[12px] font-bold">和 Ta 面对面</div>
                        <div className="p-4 space-y-2">
                            <div className="moro-offline-modal-entry moro-offline-modal-scene text-[11px] italic px-3 py-2 rounded-lg bg-black/5">雨声贴着窗沿，房间里只剩两个人的呼吸。</div>
                            <div className="moro-offline-modal-entry moro-offline-modal-char text-[11px] px-3 py-2 rounded-[4px_14px_14px_14px] bg-white">“你刚刚是不是想说什么？”</div>
                            <div className="moro-offline-modal-entry moro-offline-modal-user ml-auto w-fit text-[11px] px-3 py-2 rounded-[14px_4px_14px_14px] text-white" style={{ background: offline.accentColor || '#1f1d1a' }}>嗯，我想靠近一点。</div>
                        </div>
                        <div className="moro-offline-modal-inputbar px-4 py-3 border-t border-dashed border-black/20 text-[11px] opacity-70">说句话，或写下你的动作…</div>
                    </div>
                </div>
                <div className="space-y-4">
                    {([
                        ['background', '弹窗底色', 'linear-gradient(180deg,#fbf9f2,#f2efe4)'],
                        ['textColor', '文字颜色', '#1f1d1a'],
                        ['accentColor', '强调色 / 用户气泡', '#1f1d1a'],
                    ] as const).map(([key, label, placeholder]) => (
                        <div key={key}>
                            <div className="text-[11px] font-bold text-[#2b2933] mb-1.5 label-mono">{label}</div>
                            <div className="flex items-center gap-2">
                                <input
                                    type="color"
                                    value={/^#[0-9a-fA-F]{6}$/.test(String(offline[key] || '')) ? String(offline[key]) : '#1f1d1a'}
                                    onChange={e => setOffline({ [key]: e.target.value } as any)}
                                    className="w-9 h-9 border-2 border-[#2b2933] bg-[#fbfaf7] p-1 shrink-0"
                                />
                                <input
                                    value={String(offline[key] || '')}
                                    onChange={e => setOffline({ [key]: e.target.value || undefined } as any)}
                                    placeholder={placeholder}
                                    className="flex-1 px-3 py-2 bg-[#f4f2ed] border-2 border-[#2b2933] text-[12px] font-mono outline-none"
                                />
                            </div>
                        </div>
                    ))}
                    <div>
                        <div className="flex justify-between text-[11px] font-bold text-[#2b2933] mb-1.5 label-mono">
                            <span>弹窗圆角</span><span className="font-mono text-[#8b8996]">{typeof offline.radius === 'number' ? `${offline.radius}px` : '22px'}</span>
                        </div>
                        <input
                            type="range" min={0} max={32}
                            value={typeof offline.radius === 'number' ? offline.radius : 22}
                            onChange={e => setOffline({ radius: parseInt(e.target.value) === 22 ? undefined : parseInt(e.target.value) })}
                            className="w-full h-1.5 bg-[#e3e0d6] rounded-full appearance-none cursor-pointer accent-[#2b2933]"
                        />
                    </div>
                    <div>
                        <div className="text-[11px] font-bold text-[#2b2933] mb-1.5 label-mono">手写码（.moro-offline-modal-*）</div>
                        <textarea
                            value={offline.customCss || ''}
                            onChange={e => setOffline({ customCss: e.target.value })}
                            placeholder={`.moro-offline-modal-char {\n  border-radius: 14px;\n}\n.moro-offline-modal-inputbar { background: rgba(255,255,255,.45); }`}
                            rows={4}
                            spellCheck={false}
                            className="w-full px-3 py-2.5 bg-[#2b2933] text-[#f4f2ed] font-mono text-[11px] outline-none leading-relaxed border-2 border-[#2b2933]"
                        />
                    </div>
                    <button
                        onClick={() => { updateTheme({ offlineModeStyle: undefined }); addToast('线下模式弹窗撕回默认了', 'success'); }}
                        className="text-[11px] font-bold text-[#2b2933] underline decoration-dotted underline-offset-2 label-mono"
                    >撕回默认</button>
                </div>
            </section>

            {/* 02 灵动岛 */}
            <section className="bg-[#fbfaf7] p-5 border-2 border-[#2b2933] shadow-[3px_3px_0_rgba(43,41,51,0.18)]">
                <h2 className="text-base font-bold font-display-italic text-[#2b2933] mb-1">灵动岛</h2>
                <p className="text-[10px] text-[#6b6b6b] mb-4">浮在状态栏中央那颗通知胶囊：换底色 / 字色 / 圆角，或直接写码。</p>
                <div className="relative h-24 bg-[#f4f2ed] border-2 border-dashed border-[#2b2933]/35 mb-4 overflow-hidden">
                    {island.customCss && <style>{island.customCss}</style>}
                    <div
                        className="moro-dynamic-island absolute left-1/2 top-4 -translate-x-1/2 flex items-center gap-2 px-4 h-9 rounded-full text-[10px] font-bold shadow-lg"
                        style={{
                            background: island.background || '#0b0b12',
                            color: island.textColor || '#ffffff',
                            ...(typeof island.radius === 'number' ? { borderRadius: `${island.radius}px` } : {}),
                        }}
                    >
                        <span className="w-2 h-2 rounded-full bg-emerald-400" />
                        2 条新消息
                    </div>
                    <div className="moro-dynamic-island-panel absolute left-5 right-5 bottom-3 rounded-2xl px-3 py-2 text-[10px] text-white bg-[#0d0d16]/90 border border-white/10">
                        通知中心 · 预览面板
                    </div>
                </div>
                <div className="space-y-4">
                    <div>
                        <div className="text-[11px] font-bold text-[#2b2933] mb-1.5 label-mono">底色（认渐变，如 linear-gradient(...)）</div>
                        <div className="flex items-center gap-2">
                            <input
                                type="color"
                                value={/^#[0-9a-fA-F]{6}$/.test(island.background || '') ? island.background! : '#0b0b12'}
                                onChange={e => setIsland({ background: e.target.value })}
                                className="w-9 h-9 border-2 border-[#2b2933] bg-[#fbfaf7] p-1 shrink-0"
                            />
                            <input
                                value={island.background || ''}
                                onChange={e => setIsland({ background: e.target.value || undefined })}
                                placeholder="#0b0b12（默认墨黑）"
                                className="flex-1 px-3 py-2 bg-[#f4f2ed] border-2 border-[#2b2933] text-[12px] font-mono outline-none"
                            />
                        </div>
                    </div>
                    <div>
                        <div className="text-[11px] font-bold text-[#2b2933] mb-1.5 label-mono">字色</div>
                        <div className="flex items-center gap-2">
                            <input
                                type="color"
                                value={/^#[0-9a-fA-F]{6}$/.test(island.textColor || '') ? island.textColor! : '#ffffff'}
                                onChange={e => setIsland({ textColor: e.target.value })}
                                className="w-9 h-9 border-2 border-[#2b2933] bg-[#fbfaf7] p-1 shrink-0"
                            />
                            <input
                                value={island.textColor || ''}
                                onChange={e => setIsland({ textColor: e.target.value || undefined })}
                                placeholder="#ffffff（默认白）"
                                className="flex-1 px-3 py-2 bg-[#f4f2ed] border-2 border-[#2b2933] text-[12px] font-mono outline-none"
                            />
                        </div>
                    </div>
                    <div>
                        <div className="flex justify-between text-[11px] font-bold text-[#2b2933] mb-1.5 label-mono">
                            <span>圆角</span><span className="font-mono text-[#8b8996]">{typeof island.radius === 'number' ? `${island.radius}px` : '全圆胶囊'}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <input
                                type="range" min={0} max={24}
                                value={typeof island.radius === 'number' ? island.radius : 24}
                                onChange={e => setIsland({ radius: parseInt(e.target.value) >= 24 ? undefined : parseInt(e.target.value) })}
                                className="flex-1 h-1.5 bg-[#e3e0d6] rounded-full appearance-none cursor-pointer accent-[#2b2933]"
                            />
                            <SmallChip active={typeof island.radius !== 'number'} onClick={() => setIsland({ radius: undefined })}>全圆</SmallChip>
                        </div>
                    </div>
                    <div>
                        <div className="text-[11px] font-bold text-[#2b2933] mb-1.5 label-mono">手写码（钩子类 .moro-dynamic-island）</div>
                        <textarea
                            value={island.customCss || ''}
                            onChange={e => setIsland({ customCss: e.target.value })}
                            placeholder={`.moro-dynamic-island {\n  border: 1px solid rgba(255,255,255,0.25);\n}`}
                            rows={4}
                            spellCheck={false}
                            className="w-full px-3 py-2.5 bg-[#2b2933] text-[#f4f2ed] font-mono text-[11px] outline-none leading-relaxed border-2 border-[#2b2933]"
                        />
                    </div>
                    <button
                        onClick={() => { updateTheme({ dynamicIslandStyle: undefined }); addToast('灵动岛撕回默认了', 'success'); }}
                        className="text-[11px] font-bold text-[#2b2933] underline decoration-dotted underline-offset-2 label-mono"
                    >撕回默认</button>
                </div>
            </section>

            {/* 03 锁屏 */}
            <section className="bg-[#fbfaf7] p-5 border-2 border-[#2b2933] shadow-[3px_3px_0_rgba(43,41,51,0.18)]">
                <h2 className="text-base font-bold font-display-italic text-[#2b2933] mb-1">锁屏</h2>
                <p className="text-[10px] text-[#6b6b6b] mb-4">专属壁纸 / 时钟字体 / 通知卡样式 / 解锁动画，落笔即生效。</p>
                <div
                    className="relative h-56 overflow-hidden border-2 border-dashed border-[#2b2933]/35 mb-4 bg-cover bg-center"
                    style={previewWallpaperStyle(lock.wallpaper || theme.wallpaper)}
                >
                    {lock.customCss && <style>{lock.customCss}</style>}
                    <div className="absolute inset-0 bg-black/10" />
                    <div
                        className="moro-lock-clock absolute left-0 right-0 flex flex-col items-center text-center"
                        style={{
                            top: `${typeof lock.clockTop === 'number' ? lock.clockTop : 14}%`,
                            transform: `scale(${typeof lock.clockScale === 'number' ? lock.clockScale : 1})`,
                            color: theme.contentColor || '#2b2933',
                        }}
                    >
                        <div className="text-[9px] font-bold px-2 py-1 rounded-full bg-white/30 border border-white/40">{lock.dateText || '6月27日 · 周六'}</div>
                        <div className="text-[42px] leading-none font-display-italic font-semibold mt-2">12:17</div>
                        <div className="text-[10px] opacity-80 mt-1">{lock.greetingText || '晚上好，今天辛苦了'}</div>
                    </div>
                    {(lock.showNotifications !== false) && (
                        <div className="moro-lock-notif absolute left-4 right-4 bottom-12 rounded-2xl px-3 py-2 text-[10px] bg-white/35 backdrop-blur-md border border-white/30">
                            <div className="font-bold">Moro</div>
                            <div className="opacity-75 truncate">发来了一条新消息</div>
                        </div>
                    )}
                    <div className="absolute bottom-4 left-0 right-0 text-center text-[9px] font-bold tracking-[0.18em]">{lock.unlockHintText || '轻点 · 输入密码'}</div>
                </div>
                <div className="space-y-5">
                    <div>
                        <div className="text-[11px] font-bold text-[#2b2933] mb-1.5 label-mono">锁屏专属壁纸（不设就沿用桌面的）</div>
                        <div
                            onClick={() => lockWallpaperRef.current?.click()}
                            className="aspect-[2/1] bg-[#f4f2ed] border-2 border-dashed border-[#2b2933]/50 flex items-center justify-center cursor-pointer hover:border-[#2b2933] overflow-hidden relative"
                        >
                            {lock.wallpaper ? (
                                <img src={lock.wallpaper} className="w-full h-full object-cover" alt="" />
                            ) : (
                                <span className="text-[10px] text-[#8b8996]">点一下贴张锁屏壁纸</span>
                            )}
                        </div>
                        <input
                            type="file" accept="image/*" ref={lockWallpaperRef} className="hidden"
                            onChange={e => { const f = e.target.files?.[0]; if (f) void handleLockWallpaperUpload(f); e.target.value = ''; }}
                        />
                        {lock.wallpaper && (
                            <button onClick={() => setLock({ wallpaper: undefined })} className="mt-1.5 text-[11px] font-bold text-[#2b2933] underline decoration-dotted underline-offset-2 label-mono">撕掉，沿用桌面壁纸</button>
                        )}
                    </div>
                    <div>
                        <div className="text-[11px] font-bold text-[#2b2933] mb-1.5 label-mono">时钟字体</div>
                        <div className="flex flex-wrap gap-1.5">
                            {([['serif', '衬线斜体'], ['sans', '无衬线'], ['mono', '等宽'], ['hand', '手写']] as const).map(([v, label]) => (
                                <SmallChip key={v} active={(lock.clockFont || 'serif') === v} onClick={() => setLock({ clockFont: v === 'serif' ? undefined : v })}>{label}</SmallChip>
                            ))}
                        </div>
                    </div>
                    <div>
                        <div className="flex justify-between text-[11px] font-bold text-[#2b2933] mb-1.5 label-mono">
                            <span>时间组件位置</span><span className="font-mono text-[#8b8996]">{typeof lock.clockTop === 'number' ? `${lock.clockTop}%` : '14%'}</span>
                        </div>
                        <input
                            type="range" min={6} max={34}
                            value={typeof lock.clockTop === 'number' ? lock.clockTop : 14}
                            onChange={e => setLock({ clockTop: parseInt(e.target.value) === 14 ? undefined : parseInt(e.target.value) })}
                            className="w-full h-1.5 bg-[#e3e0d6] rounded-full appearance-none cursor-pointer accent-[#2b2933]"
                        />
                    </div>
                    <div>
                        <div className="flex justify-between text-[11px] font-bold text-[#2b2933] mb-1.5 label-mono">
                            <span>时间组件缩放</span><span className="font-mono text-[#8b8996]">{typeof lock.clockScale === 'number' ? `${lock.clockScale.toFixed(2)}x` : '1.00x'}</span>
                        </div>
                        <input
                            type="range" min={0.72} max={1.35} step={0.01}
                            value={typeof lock.clockScale === 'number' ? lock.clockScale : 1}
                            onChange={e => {
                                const v = parseFloat(e.target.value);
                                setLock({ clockScale: Math.abs(v - 1) < 0.01 ? undefined : v });
                            }}
                            className="w-full h-1.5 bg-[#e3e0d6] rounded-full appearance-none cursor-pointer accent-[#2b2933]"
                        />
                    </div>
                    <div>
                        <div className="text-[11px] font-bold text-[#2b2933] mb-1.5 label-mono">各区域文字修改</div>
                        <div className="space-y-2">
                            {([
                                ['dateText', '日期胶囊文案', '6月27日 · 周六'],
                                ['greetingText', '时间下方文案', '晚上好，今天辛苦了'],
                                ['unlockHintText', '底部解锁提示', '轻点 · 输入密码'],
                                ['passcodeTitleText', '密码标题', '输入锁屏密码'],
                                ['passcodeErrorText', '密码错误提示', '密码错误，请重试'],
                                ['passcodeCancelText', '取消按钮', '取消'],
                            ] as const).map(([key, label, placeholder]) => (
                                <input
                                    key={key}
                                    value={String(lock[key] || '')}
                                    onChange={e => setLock({ [key]: e.target.value || undefined } as any)}
                                    placeholder={`${label}：${placeholder}`}
                                    className="w-full px-3 py-2 bg-[#f4f2ed] border-2 border-[#2b2933] text-[12px] outline-none"
                                />
                            ))}
                        </div>
                    </div>
                    <div>
                        <div className="text-[11px] font-bold text-[#2b2933] mb-1.5 label-mono">通知卡样式</div>
                        <div className="flex flex-wrap gap-1.5">
                            {([['glass', '玻璃拟态'], ['paper', '纸面手帐'], ['ink', '墨色']] as const).map(([v, label]) => (
                                <SmallChip key={v} active={(lock.notifCardStyle || 'glass') === v} onClick={() => setLock({ notifCardStyle: v === 'glass' ? undefined : v })}>{label}</SmallChip>
                            ))}
                        </div>
                        <div className="mt-2">
                            <SmallChip active={lock.showNotifications !== false} onClick={() => setLock({ showNotifications: lock.showNotifications === false ? undefined : false })}>
                                {lock.showNotifications === false ? '通知已隐藏' : '显示消息通知'}
                            </SmallChip>
                        </div>
                    </div>
                    <div>
                        <div className="text-[11px] font-bold text-[#2b2933] mb-1.5 label-mono">解锁动画</div>
                        <div className="flex flex-wrap gap-1.5">
                            {([['fade', '淡出'], ['slide', '上滑'], ['zoom', '放大'], ['none', '无']] as const).map(([v, label]) => (
                                <SmallChip key={v} active={(lock.unlockAnimation || 'fade') === v} onClick={() => setLock({ unlockAnimation: v === 'fade' ? undefined : v })}>{label}</SmallChip>
                            ))}
                        </div>
                    </div>
                    <div>
                        <div className="text-[11px] font-bold text-[#2b2933] mb-1.5 label-mono">密码输入界面样式</div>
                        <div className="flex flex-wrap gap-1.5">
                            {([['glass', '玻璃'], ['paper', '纸面'], ['ink', '墨色']] as const).map(([v, label]) => (
                                <SmallChip key={v} active={(lock.passcodeStyle || 'glass') === v} onClick={() => setLock({ passcodeStyle: v === 'glass' ? undefined : v })}>{label}</SmallChip>
                            ))}
                        </div>
                    </div>
                    <div>
                        <div className="text-[11px] font-bold text-[#2b2933] mb-1.5 label-mono">手写码（钩子类 .moro-lock-screen / .moro-lock-clock / .moro-lock-notif）</div>
                        <textarea
                            value={lock.customCss || ''}
                            onChange={e => setLock({ customCss: e.target.value })}
                            placeholder={`.moro-lock-notif {\n  border-radius: 8px;\n}`}
                            rows={4}
                            spellCheck={false}
                            className="w-full px-3 py-2.5 bg-[#2b2933] text-[#f4f2ed] font-mono text-[11px] outline-none leading-relaxed border-2 border-[#2b2933]"
                        />
                    </div>
                    <button
                        onClick={() => { updateTheme({ lockScreenStyle: undefined }); addToast('锁屏撕回默认了', 'success'); }}
                        className="text-[11px] font-bold text-[#2b2933] underline decoration-dotted underline-offset-2 label-mono"
                    >撕回默认</button>
                </div>
            </section>
        </>
    );
};

// ── 占卜牌面美化（小剧场·占卜读 theme.tarotSkin 渲染牌面）──────────────────
const TAROT_FRAMES: { id: 'none' | 'gold' | 'ink' | 'film'; label: string }[] = [
    { id: 'none', label: '无边' },
    { id: 'gold', label: '描金' },
    { id: 'ink', label: '水墨' },
    { id: 'film', label: '胶片' },
];
const TAROT_STYLES: { id: 'classic' | 'minimal' | 'mystic'; label: string }[] = [
    { id: 'classic', label: '古典' },
    { id: 'minimal', label: '极简' },
    { id: 'mystic', label: '神秘' },
];

const TarotSkinEditor: React.FC<{
    theme: OSTheme;
    updateTheme: (u: Partial<OSTheme>) => void;
    addToast: (msg: string, type?: Toast['type']) => void;
}> = ({ theme, updateTheme, addToast }) => {
    const skin = theme.tarotSkin || {};
    const backInputRef = useRef<HTMLInputElement>(null);
    const set = (patch: Partial<NonNullable<OSTheme['tarotSkin']>>) => updateTheme({ tarotSkin: { ...skin, ...patch } });

    const handleBack = async (file?: File) => {
        if (!file) return;
        try {
            const dataUrl = await processImage(file, { maxWidth: 720, quality: 0.85 });
            set({ cardBack: dataUrl });
            addToast('牌背换好了', 'success');
        } catch { addToast('图片没读进来', 'error'); }
        if (backInputRef.current) backInputRef.current.value = '';
    };

    const sectionCls = 'bg-[#fbfaf7] p-5 border-2 border-[#2b2933] shadow-[3px_3px_0_rgba(43,41,51,0.18)]';
    const chip = (active: boolean) => `px-3 py-1.5 text-xs font-bold border-2 border-[#2b2933] transition-all ${active ? 'bg-[#2b2933] text-[#fbfaf7]' : 'bg-[#fbfaf7] text-[#2b2933] shadow-[2px_2px_0_#2b2933]'}`;

    return (
        <>
            <section className={sectionCls}>
                <h2 className="text-base font-bold font-display-italic text-[#2b2933] mb-1">牌面美化</h2>
                <p className="text-[10px] text-[#6b6b6b] mb-3">小剧场 → 占卜里抽出的塔罗 / 雷诺曼牌面会套用这里的边框与风格；牌背图用于未翻开 / 未导入牌库时的占位。</p>
                <div className="flex items-end gap-4">
                    {/* 牌面预览 */}
                    <div className={`w-24 aspect-[2/3] overflow-hidden bg-gradient-to-br from-indigo-900/80 to-violet-900/60 relative ${
                        skin.frame === 'gold' ? 'border-2 border-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.4)]' :
                        skin.frame === 'ink' ? 'border-2 border-[#2b2933] shadow-[3px_3px_0_rgba(43,41,51,0.5)]' :
                        skin.frame === 'film' ? 'border-2 border-white shadow-lg' : 'border border-white/30'
                    } ${skin.renderStyle === 'mystic' ? 'rounded-xl ring-1 ring-violet-300/40' : skin.renderStyle === 'minimal' ? 'rounded-md' : 'rounded-lg'}`}>
                        {skin.cardBack
                            ? <img src={skin.cardBack} className="w-full h-full object-cover" alt="牌背" />
                            : <div className="w-full h-full flex items-center justify-center text-3xl">🔮</div>}
                    </div>
                    <div className="text-[10px] text-[#6b6b6b] leading-relaxed">这是牌面预览。<br />换牌背 / 边框 / 风格都会实时反映。</div>
                </div>
            </section>

            <section className={sectionCls}>
                <h3 className="text-sm font-bold text-[#2b2933] mb-2">牌背图</h3>
                <input ref={backInputRef} type="file" accept="image/*" className="hidden" onChange={e => void handleBack(e.target.files?.[0])} />
                <div className="flex gap-2">
                    <button onClick={() => backInputRef.current?.click()} className="px-3 py-2 text-xs font-bold border-2 border-[#2b2933] bg-[#2b2933] text-[#fbfaf7] shadow-[2px_2px_0_rgba(43,41,51,0.35)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all">上传牌背图</button>
                    {skin.cardBack && (
                        <button onClick={() => set({ cardBack: undefined })} className="px-3 py-2 text-xs font-bold border-2 border-[#2b2933] bg-[#fbfaf7] text-[#2b2933] shadow-[2px_2px_0_#2b2933] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all">清除</button>
                    )}
                </div>
            </section>

            <section className={sectionCls}>
                <h3 className="text-sm font-bold text-[#2b2933] mb-2">边框</h3>
                <div className="flex flex-wrap gap-2">
                    {TAROT_FRAMES.map(f => (
                        <button key={f.id} onClick={() => set({ frame: f.id })} className={chip((skin.frame || 'none') === f.id)}>{f.label}</button>
                    ))}
                </div>
            </section>

            <section className={sectionCls}>
                <h3 className="text-sm font-bold text-[#2b2933] mb-2">渲染风格</h3>
                <div className="flex flex-wrap gap-2">
                    {TAROT_STYLES.map(s => (
                        <button key={s.id} onClick={() => set({ renderStyle: s.id })} className={chip((skin.renderStyle || 'classic') === s.id)}>{s.label}</button>
                    ))}
                </div>
            </section>
        </>
    );
};

const Appearance: React.FC = () => {
  const { theme, updateTheme, closeApp, setCustomIcon, customIcons, addToast, appearancePresets, saveAppearancePreset, applyAppearancePreset, deleteAppearancePreset, renameAppearancePreset, exportAppearancePreset, importAppearancePreset, resetAppearance, characters, updateCharacter } = useOS();
  // 一键还原全部「聊天白框自定义 CSS」：清掉全局 + 每个角色自带的。
  // 兼作救援：单角色的坏 CSS 把聊天界面整崩、进不去该角色设置时，从这里一键全清即可恢复。
  const resetAllChromeCss = () => {
    let n = 0;
    if (theme.chatChromeCustomCss) { updateTheme({ chatChromeCustomCss: '' }); n++; }
    (characters || []).forEach((c: any) => {
      if (c?.chromeCustomCss) { updateCharacter(c.id, { chromeCustomCss: '' } as any); n++; }
    });
    addToast(n ? `撕掉了 ${n} 处白框手写码` : '没有要撕的白框手写码', n ? 'success' : 'info');
  };
  const [activeTab, setActiveTab] = useState<'theme' | 'desktop' | 'icons' | 'presets' | 'chat' | 'css' | 'tarot'>('theme');
  // 气泡工坊全屏编辑器：原独立 tab 已并入「聊天界面」页，从那里的入口卡打开
  const [showBubbleWorkshop, setShowBubbleWorkshop] = useState(false);
  const wallpaperInputRef = useRef<HTMLInputElement>(null);
  const [wallpaperUrl, setWallpaperUrl] = useState('');
  const widgetInputRef = useRef<HTMLInputElement>(null);
  const [activeWidgetSlot, setActiveWidgetSlot] = useState<string | null>(null);
  const iconInputRef = useRef<HTMLInputElement>(null);
  const fontInputRef = useRef<HTMLInputElement>(null);
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  
  // Font State
  const [fontMode, setFontMode] = useState<'local' | 'web'>('local');
  const [webFontUrl, setWebFontUrl] = useState('');

  // Desktop Decoration DIY State
  const decoInputRef = useRef<HTMLInputElement>(null);
  const [editingDecoId, setEditingDecoId] = useState<string | null>(null);
  const [showPresetPicker, setShowPresetPicker] = useState(false);

  const decorations = theme.desktopDecorations || [];
  const editingDeco = editingDecoId ? decorations.find(d => d.id === editingDecoId) : null;

  // Preset decoration SVGs (cute decorative elements)
  const PRESET_DECOS: { name: string; content: string; category: string }[] = [
    // Stars & Sparkles
    { name: '闪光', category: 'stars', content: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50 5 L58 38 L95 50 L58 62 L50 95 L42 62 L5 50 L42 38Z" fill="#FFD700" opacity="0.9"/><path d="M50 20 L54 42 L78 50 L54 58 L50 80 L46 58 L22 50 L46 42Z" fill="#FFF8DC"/></svg>')}` },
    { name: '星星', category: 'stars', content: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><polygon points="50,5 63,35 95,40 72,62 78,95 50,78 22,95 28,62 5,40 37,35" fill="#FF69B4"/><polygon points="50,20 58,38 78,42 64,55 67,78 50,68 33,78 36,55 22,42 42,38" fill="#FFB6C1" opacity="0.7"/></svg>')}` },
    { name: '小星', category: 'stars', content: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><polygon points="50,10 61,40 95,40 68,60 78,90 50,72 22,90 32,60 5,40 39,40" fill="#B19CD9" opacity="0.85"/></svg>')}` },
    // Hearts
    { name: '爱心', category: 'hearts', content: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50 88 C25 65 5 50 5 30 C5 15 17 5 30 5 C38 5 46 10 50 18 C54 10 62 5 70 5 C83 5 95 15 95 30 C95 50 75 65 50 88Z" fill="#FF6B9D"/><path d="M50 78 C30 60 15 48 15 33 C15 22 23 15 33 15 C39 15 45 18 50 25 C55 18 61 15 67 15 C77 15 85 22 85 33 C85 48 70 60 50 78Z" fill="#FF8FB1" opacity="0.6"/></svg>')}` },
    { name: '双心', category: 'hearts', content: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M35 70 C18 52 3 42 3 27 C3 16 12 8 22 8 C28 8 33 11 35 16 C37 11 42 8 48 8 C58 8 67 16 67 27 C67 42 52 52 35 70Z" fill="#FF69B4" opacity="0.8"/><path d="M65 80 C48 62 33 52 33 37 C33 26 42 18 52 18 C58 18 63 21 65 26 C67 21 72 18 78 18 C88 18 97 26 97 37 C97 52 82 62 65 80Z" fill="#FF1493" opacity="0.7"/></svg>')}` },
    // Flowers & Nature
    { name: '花朵', category: 'flowers', content: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="30" r="18" fill="#FFB7D5" opacity="0.8"/><circle cx="30" cy="50" r="18" fill="#FFB7D5" opacity="0.8"/><circle cx="70" cy="50" r="18" fill="#FFB7D5" opacity="0.8"/><circle cx="38" cy="70" r="18" fill="#FFB7D5" opacity="0.8"/><circle cx="62" cy="70" r="18" fill="#FFB7D5" opacity="0.8"/><circle cx="50" cy="50" r="12" fill="#FFE4B5"/></svg>')}` },
    { name: '樱花', category: 'flowers', content: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g transform="translate(50,50)"><g fill="#FFB7C5" opacity="0.85"><ellipse rx="12" ry="22" transform="rotate(0) translate(0,-20)"/><ellipse rx="12" ry="22" transform="rotate(72) translate(0,-20)"/><ellipse rx="12" ry="22" transform="rotate(144) translate(0,-20)"/><ellipse rx="12" ry="22" transform="rotate(216) translate(0,-20)"/><ellipse rx="12" ry="22" transform="rotate(288) translate(0,-20)"/></g><circle r="8" fill="#FF69B4"/></g></svg>')}` },
    { name: '叶子', category: 'flowers', content: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50 10 Q80 30 85 60 Q85 90 50 95 Q15 90 15 60 Q20 30 50 10Z" fill="#90EE90" opacity="0.8"/><path d="M50 20 L50 85" stroke="#228B22" stroke-width="2" fill="none" opacity="0.5"/><path d="M50 40 Q65 35 70 45" stroke="#228B22" stroke-width="1.5" fill="none" opacity="0.4"/><path d="M50 55 Q35 50 30 60" stroke="#228B22" stroke-width="1.5" fill="none" opacity="0.4"/></svg>')}` },
    // Ribbons & Bows
    { name: '蝴蝶结', category: 'ribbons', content: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50 45 Q20 20 10 35 Q5 50 25 55 Q35 57 50 50Z" fill="#FF69B4"/><path d="M50 45 Q80 20 90 35 Q95 50 75 55 Q65 57 50 50Z" fill="#FF69B4"/><circle cx="50" cy="48" r="6" fill="#FF1493"/><path d="M45 54 Q42 75 38 90" stroke="#FF69B4" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M55 54 Q58 75 62 90" stroke="#FF69B4" stroke-width="4" fill="none" stroke-linecap="round"/></svg>')}` },
    { name: '丝带', category: 'ribbons', content: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M10 30 Q30 20 50 30 Q70 40 90 30 L90 50 Q70 40 50 50 Q30 60 10 50Z" fill="#DDA0DD" opacity="0.85"/><path d="M10 50 Q30 40 50 50 Q70 60 90 50 L90 70 Q70 60 50 70 Q30 80 10 70Z" fill="#BA55D3" opacity="0.7"/></svg>')}` },
    // Cute Animals
    { name: '猫耳', category: 'animals', content: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M15 65 L5 15 L40 45Z" fill="#333" opacity="0.9"/><path d="M85 65 L95 15 L60 45Z" fill="#333" opacity="0.9"/><path d="M18 60 L12 22 L38 46Z" fill="#FFB6C1" opacity="0.6"/><path d="M82 60 L88 22 L62 46Z" fill="#FFB6C1" opacity="0.6"/></svg>')}` },
    { name: '猫爪', category: 'animals', content: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><ellipse cx="50" cy="62" rx="22" ry="20" fill="#FFB6C1" opacity="0.85"/><circle cx="35" cy="38" r="10" fill="#FFB6C1" opacity="0.85"/><circle cx="65" cy="38" r="10" fill="#FFB6C1" opacity="0.85"/><circle cx="22" cy="50" r="9" fill="#FFB6C1" opacity="0.85"/><circle cx="78" cy="50" r="9" fill="#FFB6C1" opacity="0.85"/></svg>')}` },
    // Geometric / Shapes
    { name: '月亮', category: 'shapes', content: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M60 10 A40 40 0 1 0 60 90 A30 30 0 1 1 60 10Z" fill="#FFD700" opacity="0.8"/></svg>')}` },
    { name: '钻石', category: 'shapes', content: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><polygon points="50,5 85,35 50,95 15,35" fill="#87CEEB" opacity="0.8"/><polygon points="50,5 65,35 50,95" fill="#ADD8E6" opacity="0.5"/><polygon points="15,35 85,35 50,5" fill="#B0E0E6" opacity="0.6"/></svg>')}` },
    { name: '泡泡', category: 'shapes', content: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="35" fill="none" stroke="#87CEEB" stroke-width="2" opacity="0.6"/><circle cx="50" cy="50" r="35" fill="#E0F0FF" opacity="0.2"/><ellipse cx="38" cy="38" rx="12" ry="8" fill="white" opacity="0.5" transform="rotate(-30 38 38)"/></svg>')}` },
    // Text Badges
    { name: 'LOVE', category: 'badges', content: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 50"><rect x="2" y="2" width="116" height="46" rx="23" fill="#FF69B4" opacity="0.85"/><text x="60" y="33" text-anchor="middle" fill="white" font-size="22" font-weight="bold" font-family="sans-serif">LOVE</text></svg>')}` },
    { name: 'CUTE', category: 'badges', content: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 50"><rect x="2" y="2" width="116" height="46" rx="23" fill="#DDA0DD" opacity="0.85"/><text x="60" y="33" text-anchor="middle" fill="white" font-size="22" font-weight="bold" font-family="sans-serif">CUTE</text></svg>')}` },
    { name: 'MY♡', category: 'badges', content: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 50"><rect x="2" y="2" width="116" height="46" rx="10" fill="none" stroke="#FF69B4" stroke-width="3" opacity="0.8"/><text x="60" y="34" text-anchor="middle" fill="#FF69B4" font-size="20" font-weight="bold" font-family="sans-serif">MY♡</text></svg>')}` },
  ];

  const addDecoration = useCallback((content: string, type: 'image' | 'preset') => {
    const newDeco: DesktopDecoration = {
      id: `deco-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      content,
      x: 20 + Math.random() * 60,
      y: 20 + Math.random() * 60,
      scale: 1,
      rotation: 0,
      opacity: 1,
      zIndex: decorations.length + 1,
    };
    const next = [...decorations, newDeco];
    updateTheme({ desktopDecorations: next });
    setEditingDecoId(newDeco.id);
    setShowPresetPicker(false);
  }, [decorations, updateTheme]);

  const updateDecoration = useCallback((id: string, updates: Partial<DesktopDecoration>) => {
    const next = decorations.map(d => d.id === id ? { ...d, ...updates } : d);
    updateTheme({ desktopDecorations: next });
  }, [decorations, updateTheme]);

  const removeDecoration = useCallback((id: string) => {
    const next = decorations.filter(d => d.id !== id);
    updateTheme({ desktopDecorations: next });
    if (editingDecoId === id) setEditingDecoId(null);
  }, [decorations, updateTheme, editingDecoId]);

  const handleDecoUpload = async (file: File) => {
    try {
      const dataUrl = await processImage(file, { maxWidth: 400, quality: 0.85 });
      addDecoration(dataUrl, 'image');
      addToast('贴纸贴上了', 'success');
    } catch (e: any) {
      addToast(e.message, 'error');
    }
  };

  const THEME_PRESETS: { name: string, config: Partial<OSTheme>, color: string }[] = [
      { name: 'Ink', config: { hue: 248, saturation: 16, lightness: 36, contentColor: '#3f3d49' }, color: 'hsl(248, 16%, 36%)' },
      { name: 'Indigo', config: { hue: 245, saturation: 25, lightness: 65, contentColor: '#ffffff' }, color: 'hsl(245, 25%, 65%)' },
      { name: 'Sakura', config: { hue: 350, saturation: 70, lightness: 80, contentColor: '#334155' }, color: 'hsl(350, 70%, 80%)' },
      { name: 'Cyber', config: { hue: 170, saturation: 100, lightness: 45, contentColor: '#ffffff' }, color: 'hsl(170, 100%, 45%)' },
      { name: 'Noir', config: { hue: 0, saturation: 0, lightness: 20, contentColor: '#ffffff' }, color: 'hsl(0, 0%, 20%)' },
      { name: 'Sunset', config: { hue: 20, saturation: 90, lightness: 60, contentColor: '#ffffff' }, color: 'hsl(20, 90%, 60%)' },
  ];

  const handleWallpaperUpload = async (file: File) => {
      try {
          addToast('正在裁壁纸（原画质）…', 'info');
          // Use skipCompression to keep original quality
          const dataUrl = await processImage(file, { skipCompression: true });
          updateTheme({ wallpaper: dataUrl });
          addToast('壁纸贴好了', 'success');
      } catch (e: any) {
          addToast(e.message, 'error');
      }
  };

  const applyWallpaperUrl = () => {
      const url = wallpaperUrl.trim();
      if (!url) return;
      if (!/^https?:\/\//i.test(url) && !url.startsWith('data:') && !url.startsWith('blob:')) {
          addToast('要 http(s):// 开头的图片地址', 'error');
          return;
      }
      updateTheme({ wallpaper: url });
      setWallpaperUrl('');
      addToast('壁纸贴好了', 'success');
  };

  const handleWidgetUpload = async (file: File) => {
      if (!activeWidgetSlot) return;
      try {
          const maxW = activeWidgetSlot === 'wide' ? 800 : activeWidgetSlot === 'dsq' ? 600 : 500;
          const dataUrl = await processImage(file, { maxWidth: maxW, quality: 0.9 });
          const current = theme.launcherWidgets || {};
          updateTheme({ launcherWidgets: { ...current, [activeWidgetSlot]: dataUrl } });
          addToast('贴图换好了', 'success');
      } catch (e: any) {
          addToast(e.message, 'error');
      }
  };

  const removeWidget = (slot: string) => {
      const current = { ...(theme.launcherWidgets || {}) };
      delete current[slot];
      updateTheme({ launcherWidgets: Object.keys(current).length > 0 ? current : undefined });
  };

  const handleFontUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      
      const allowedExts = ['.ttf', '.otf', '.woff', '.woff2'];
      const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
      
      if (!allowedExts.includes(ext)) {
          addToast('仅支持 ttf/otf/woff/woff2 格式', 'error');
          return;
      }

      addToast('正在收字体文件…', 'info');
      
      const reader = new FileReader();
      reader.onload = async (ev) => {
          try {
              const dataUrl = ev.target?.result as string;
              updateTheme({ customFont: dataUrl });
              addToast('字体换好了', 'success');
          } catch(err) {
              addToast('字体没读进来', 'error');
          }
      };
      reader.onerror = () => addToast('文件没读进来', 'error');
      reader.readAsDataURL(file);
      
      // Clear input
      if (fontInputRef.current) fontInputRef.current.value = '';
  };

  const applyWebFont = () => {
      if (!webFontUrl.trim()) return;
      updateTheme({ customFont: webFontUrl.trim() });
      setWebFontUrl('');
      addToast('网络字体贴好了', 'success');
  };

  const handleIconUpload = async (file: File) => {
      if (!selectedAppId) return;
      try {
          const dataUrl = await processImage(file);
          setCustomIcon(selectedAppId, dataUrl);
          addToast('图标换好了', 'success');
      } catch (e: any) {
          addToast(e.message, 'error');
      }
  };

  // 气泡工坊：全屏嵌入（编辑器需要整屏空间），返回键 / 保存退出回到「聊天界面」页
  if (showBubbleWorkshop) {
      return <ThemeMaker embedded onRequestClose={() => { setShowBubbleWorkshop(false); setActiveTab('chat'); }} />;
  }

  const TABS: { id: 'theme' | 'desktop' | 'icons' | 'presets' | 'chat' | 'css' | 'tarot'; label: string }[] = [
      { id: 'theme', label: '调色页' },
      { id: 'desktop', label: '桌面页' },
      { id: 'chat', label: '对话页' },
      { id: 'css', label: '手写码' },
      { id: 'icons', label: '图标贴' },
      { id: 'tarot', label: '牌面' },
      { id: 'presets', label: '存档册' },
  ];

  return (
    <div className="h-full w-full bg-[#f4f2ed] flex flex-col font-light">
      <div className="h-20 bg-[#fbfaf7] flex items-end pb-3 px-4 border-b-2 border-[#2b2933] shrink-0 z-10 sticky top-0">
        <div className="flex items-center gap-3 w-full">
            <button onClick={closeApp} className="w-9 h-9 border-2 border-[#2b2933] bg-[#fbfaf7] flex items-center justify-center active:translate-x-[1px] active:translate-y-[1px] transition-transform shadow-[2px_2px_0_#2b2933]">
                <span className="text-[#2b2933] text-lg leading-none -mt-0.5">‹</span>
            </button>
            <div className="flex flex-col">
                <h1 className="text-2xl text-[#2b2933] font-display-italic leading-none">拼贴册</h1>
                <span className="text-[8px] label-mono text-[#8b8996] mt-1">SCRAPBOOK · 黑白手账</span>
            </div>
        </div>
      </div>

      <div className="flex border-b-2 border-[#2b2933] bg-[#fbfaf7] sticky top-0 z-20 overflow-x-auto no-scrollbar gap-1 px-2">
          {TABS.map(tab => (
              <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`shrink-0 px-3.5 py-2.5 text-xs font-bold label-mono transition-colors whitespace-nowrap -mb-[2px] border-2 ${activeTab === tab.id ? 'text-[#2b2933] border-[#2b2933] border-b-[#fbfaf7] bg-[#fbfaf7]' : 'text-[#8b8996] border-transparent'}`}
              >{tab.label}</button>
          ))}
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-6 no-scrollbar">
        {activeTab === 'theme' ? (
            <>
                <section className="bg-[#fbfaf7] p-5 border-2 border-[#2b2933] shadow-[3px_3px_0_rgba(43,41,51,0.18)]">
                    <h2 className="text-base font-bold font-display-italic text-[#2b2933] mb-1">取景框</h2>
                    <p className="text-[10px] text-[#6b6b6b] mb-3">壁纸 / 主色 / 字色 / 全局码 一改，这块小桌面立刻跟着变。</p>
                    <DesktopMiniPreview theme={theme} />
                </section>

                <section className="bg-[#fbfaf7] p-5 border-2 border-[#2b2933] shadow-[3px_3px_0_rgba(43,41,51,0.18)]">
                    <h2 className="text-base font-bold font-display-italic text-[#2b2933] mb-4">色票本</h2>
                    <div className="flex gap-3 mb-6 overflow-x-auto no-scrollbar pb-1">
                        {THEME_PRESETS.map(preset => (
                            <button
                                key={preset.name}
                                onClick={() => updateTheme(preset.config)}
                                className="flex flex-col items-center gap-1.5 shrink-0 group"
                            >
                                <div className="w-10 h-10 border-2 border-[#2b2933] shadow-[2px_2px_0_rgba(43,41,51,0.3)] transition-transform group-active:translate-x-[1px] group-active:translate-y-[1px]" style={{ backgroundColor: preset.color }}></div>
                                <span className="text-[9px] text-[#6b6b6b] label-mono">{preset.name}</span>
                            </button>
                        ))}
                    </div>

                    <div className="space-y-5">
                        <div>
                            <div className="flex justify-between text-[10px] text-[#8b8996] mb-2 label-mono">
                                <span>色相 HUE</span><span>{theme.hue}°</span>
                            </div>
                            <input type="range" min="0" max="360" value={theme.hue} onChange={(e) => updateTheme({ hue: parseInt(e.target.value) })} className="w-full h-1.5 bg-[#e3e0d6] rounded-full appearance-none cursor-pointer accent-[#2b2933]" />
                            <div className="h-2 w-full mt-3 opacity-60 border border-[#2b2933]/30" style={{ background: `linear-gradient(to right, hsl(0, 50%, 80%), hsl(60, 50%, 80%), hsl(120, 50%, 80%), hsl(180, 50%, 80%), hsl(240, 50%, 80%), hsl(300, 50%, 80%), hsl(360, 50%, 80%))`}}></div>
                        </div>
                        <div>
                            <div className="flex justify-between text-[10px] text-[#8b8996] mb-2 label-mono">
                                <span>浓淡 SAT</span><span>{theme.saturation}%</span>
                            </div>
                            <input type="range" min="0" max="100" value={theme.saturation} onChange={(e) => updateTheme({ saturation: parseInt(e.target.value) })} className="w-full h-1.5 bg-[#e3e0d6] rounded-full appearance-none cursor-pointer accent-[#2b2933]" />
                        </div>
                        <div>
                            <div className="flex justify-between text-[10px] text-[#8b8996] mb-2 label-mono">
                                <span>明暗 LIGHT</span><span>{theme.lightness}%</span>
                            </div>
                            <input type="range" min="10" max="95" value={theme.lightness} onChange={(e) => updateTheme({ lightness: parseInt(e.target.value) })} className="w-full h-1.5 bg-[#e3e0d6] rounded-full appearance-none cursor-pointer accent-[#2b2933]" />
                        </div>
                        <div>
                            <div className="flex justify-between text-[10px] text-[#8b8996] mb-2 label-mono">
                                <span>字 / 组件墨色</span>
                            </div>
                            <div className="flex gap-4 items-center bg-[#f4f2ed] p-2 border-2 border-[#2b2933]">
                                <div
                                    onClick={() => updateTheme({ contentColor: '#ffffff' })}
                                    className={`w-8 h-8 border-2 cursor-pointer ${theme.contentColor === '#ffffff' ? 'border-[#2b2933] shadow-[2px_2px_0_#2b2933]' : 'border-[#2b2933]/30'}`}
                                    style={{ backgroundColor: '#ffffff' }}
                                />
                                <div
                                    onClick={() => updateTheme({ contentColor: '#334155' })} // Slate-700
                                    className={`w-8 h-8 border-2 cursor-pointer ${theme.contentColor === '#334155' ? 'border-[#2b2933] shadow-[2px_2px_0_#2b2933]' : 'border-[#2b2933]/30'}`}
                                    style={{ backgroundColor: '#334155' }}
                                />
                                <div className="h-6 w-0.5 bg-[#2b2933] mx-1"></div>
                                <input
                                    type="color"
                                    value={theme.contentColor || '#ffffff'}
                                    onChange={(e) => updateTheme({ contentColor: e.target.value })}
                                    className="w-8 h-8 border border-[#2b2933] cursor-pointer bg-transparent p-0"
                                />
                                <span className="text-xs text-[#8b8996] font-mono">{theme.contentColor}</span>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Global Font Section */}
                <section className="bg-[#fbfaf7] p-5 border-2 border-[#2b2933] shadow-[3px_3px_0_rgba(43,41,51,0.18)]">
                    <h2 className="text-base font-bold font-display-italic text-[#2b2933] mb-4">字体</h2>

                    <div className="flex border-2 border-[#2b2933] mb-4">
                        <button onClick={() => setFontMode('local')} className={`flex-1 py-1.5 text-xs font-bold label-mono transition-all ${fontMode === 'local' ? 'bg-[#2b2933] text-[#fbfaf7]' : 'bg-[#fbfaf7] text-[#8b8996]'}`}>本地</button>
                        <button onClick={() => setFontMode('web')} className={`flex-1 py-1.5 text-xs font-bold label-mono transition-all border-l-2 border-[#2b2933] ${fontMode === 'web' ? 'bg-[#2b2933] text-[#fbfaf7]' : 'bg-[#fbfaf7] text-[#8b8996]'}`}>网址</button>
                    </div>

                    {fontMode === 'local' ? (
                        <>
                            <div
                                className="w-full h-24 bg-[#f4f2ed] overflow-hidden relative mb-2 group cursor-pointer border-2 border-dashed border-[#2b2933]/50 hover:border-[#2b2933] flex items-center justify-center flex-col gap-2"
                                onClick={() => fontInputRef.current?.click()}
                            >
                                {theme.customFont && theme.customFont.startsWith('data:') ? (
                                    <>
                                        <span className="text-lg font-bold text-[#2b2933]">Abc 样字</span>
                                        <span className="text-[10px] text-[#8b8996] label-mono">本地字体已贴上</span>
                                    </>
                                ) : (
                                    <>
                                        <span className="text-2xl text-[#8b8996] font-display-italic">Aa</span>
                                        <span className="text-xs text-[#8b8996]">贴一个字体文件 (.ttf / .otf)</span>
                                    </>
                                )}
                                <div className="absolute inset-0 bg-[#2b2933]/5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                    <span className="text-[#fbfaf7] text-xs font-bold bg-[#2b2933] px-3 py-1 label-mono">换字体</span>
                                </div>
                            </div>
                            <input type="file" ref={fontInputRef} className="hidden" accept=".ttf,.otf,.woff,.woff2" onChange={handleFontUpload} />
                        </>
                    ) : (
                        <div className="space-y-2">
                            <input
                                value={webFontUrl}
                                onChange={e => setWebFontUrl(e.target.value)}
                                placeholder="贴一条字体文件 URL (https://...)"
                                className="w-full bg-[#f4f2ed] border-2 border-[#2b2933] px-4 py-3 text-xs outline-none focus:shadow-[2px_2px_0_#2b2933] transition-all"
                            />
                            <button onClick={applyWebFont} className="w-full py-2 bg-[#2b2933] text-[#fbfaf7] font-bold text-xs label-mono active:translate-x-[1px] active:translate-y-[1px] transition-transform">
                                贴上网络字体
                            </button>
                            <div className="text-[10px] text-[#8b8996] px-1">
                                {theme.customFont && theme.customFont.startsWith('http') ? (
                                    <span className="text-[#2b2933] font-bold">正在用：{theme.customFont}</span>
                                ) : '提示：链接要直通字体文件 (.ttf/.woff)'}
                            </div>
                        </div>
                    )}

                    {theme.customFont && (
                        <button onClick={() => updateTheme({ customFont: undefined })} className="w-full py-2 text-xs font-bold label-mono text-[#2b2933] border-2 border-dashed border-[#2b2933]/50 hover:bg-[#2b2933] hover:text-[#fbfaf7] mt-2 transition-colors">撕掉 · 还原默认字体</button>
                    )}
                </section>

                {/* Status Bar Toggle */}
                <section className="bg-[#fbfaf7] p-5 border-2 border-[#2b2933] shadow-[3px_3px_0_rgba(43,41,51,0.18)]">
                    <h2 className="text-base font-bold font-display-italic text-[#2b2933] mb-4">顶栏</h2>
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-sm font-bold text-[#2b2933]">藏起顶部时间栏</div>
                            <div className="text-[10px] text-[#6b6b6b] mt-0.5">把屏幕顶上的时间、电量这些都收起来</div>
                        </div>
                        <button
                            onClick={() => updateTheme({ hideStatusBar: !theme.hideStatusBar })}
                            className={`w-12 h-7 border-2 border-[#2b2933] transition-colors relative ${theme.hideStatusBar ? 'bg-[#2b2933]' : 'bg-[#fbfaf7]'}`}
                        >
                            <div className={`absolute top-[2px] w-5 h-5 border border-[#2b2933] transition-transform ${theme.hideStatusBar ? 'translate-x-[20px] bg-[#fbfaf7]' : 'translate-x-[2px] bg-[#2b2933]'}`} />
                        </button>
                    </div>
                </section>

                {/* Wallpaper Section */}
                <section className="bg-[#fbfaf7] p-5 border-2 border-[#2b2933] shadow-[3px_3px_0_rgba(43,41,51,0.18)]">
                    <h2 className="text-base font-bold font-display-italic text-[#2b2933] mb-4">壁纸</h2>
                    <LongPressArea
                        className="aspect-[9/16] w-1/2 mx-auto bg-[#f4f2ed] overflow-hidden relative mb-4 group cursor-pointer border-2 border-[#2b2933] shadow-[3px_3px_0_rgba(43,41,51,0.25)]"
                        onClick={() => wallpaperInputRef.current?.click()}
                        onLongPress={() => {
                            if (theme.wallpaper === DEFAULT_WALLPAPER) {
                                addToast('已经是默认壁纸了', 'info');
                                return;
                            }
                            updateTheme({ wallpaper: DEFAULT_WALLPAPER });
                            addToast('壁纸撕回默认了', 'success');
                        }}
                    >
                         <div
                            className="w-full h-full"
                            style={{
                                background: !theme.wallpaper
                                    ? '#e2e8f0'
                                    : (theme.wallpaper.startsWith('linear-gradient') || theme.wallpaper.startsWith('radial-gradient') || theme.wallpaper.startsWith('conic-gradient'))
                                        ? theme.wallpaper
                                        : `url("${theme.wallpaper}") center/cover`,
                            }}
                         />
                         <div className="absolute inset-0 bg-[#2b2933]/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                             <span className="text-[#fbfaf7] text-xs font-bold bg-[#2b2933] px-3 py-1 label-mono">换壁纸</span>
                         </div>
                    </LongPressArea>
                    <input type="file" ref={wallpaperInputRef} className="hidden" accept="image/*" onChange={(e) => e.target.files?.[0] && handleWallpaperUpload(e.target.files[0])} />
                    <p className="text-center text-[10px] text-[#8b8996] mb-4">点一下贴新的 · 长按撕回默认（原画质）</p>

                    <div className="border-t-2 border-dashed border-[#2b2933]/30 pt-4 space-y-2">
                        <p className="text-[11px] font-bold text-[#2b2933] label-mono">从网址贴</p>
                        <input
                            value={wallpaperUrl}
                            onChange={e => setWallpaperUrl(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') applyWallpaperUrl(); }}
                            placeholder="贴一条图片地址 (https://...)"
                            className="w-full bg-[#f4f2ed] border-2 border-[#2b2933] px-4 py-3 text-xs outline-none focus:shadow-[2px_2px_0_#2b2933] transition-all"
                        />
                        <button
                            onClick={applyWallpaperUrl}
                            disabled={!wallpaperUrl.trim()}
                            className="w-full py-2 bg-[#2b2933] text-[#fbfaf7] font-bold text-xs label-mono active:translate-x-[1px] active:translate-y-[1px] transition-transform disabled:opacity-40"
                        >
                            贴上网络壁纸
                        </button>
                        <p className="text-[10px] text-[#8b8996]">直接引网图，不占本地空间</p>
                    </div>
                </section>

                {/* Page 1 Desktop Square Image */}
                <section className="bg-[#fbfaf7] p-5 border-2 border-[#2b2933] shadow-[3px_3px_0_rgba(43,41,51,0.18)]">
                    <h2 className="text-base font-bold font-display-italic text-[#2b2933] mb-2">首页方块照</h2>
                    <p className="text-[10px] text-[#6b6b6b] mb-4">桌面首页右下角那格方照片，长按撕掉</p>
                    <div className="flex justify-center bg-[#f4f2ed] p-3 border-2 border-dashed border-[#2b2933]/30">
                        {(() => {
                            const slot = 'dsq';
                            const img = (theme.launcherWidgets || {})[slot];
                            return (
                                <LongPressArea
                                    className={`w-40 aspect-square overflow-hidden relative cursor-pointer transition-transform active:translate-x-[1px] active:translate-y-[1px] ${img ? 'border-2 border-[#2b2933] shadow-[3px_3px_0_rgba(43,41,51,0.25)]' : 'border-2 border-dashed border-[#2b2933]/50 bg-[#fbfaf7] flex items-center justify-center'}`}
                                    onClick={() => { setActiveWidgetSlot(slot); widgetInputRef.current?.click(); }}
                                    onLongPress={() => {
                                        if (img) {
                                            removeWidget(slot);
                                            addToast('方照撕掉了', 'success');
                                        }
                                    }}
                                >
                                    {img ? (
                                        <>
                                            <img src={img} className="w-full h-full object-cover" />
                                            <div className="absolute inset-0 bg-[#2b2933]/0 hover:bg-[#2b2933]/20 transition-colors flex items-center justify-center opacity-0 hover:opacity-100">
                                                <span className="text-[#fbfaf7] text-[10px] font-bold bg-[#2b2933] px-2 py-0.5 label-mono">换</span>
                                            </div>
                                        </>
                                    ) : (
                                        <div className="text-[#8b8996] text-center">
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-7 h-7 mx-auto mb-1"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                                            <span className="text-[10px]">方照</span>
                                        </div>
                                    )}
                                </LongPressArea>
                            );
                        })()}
                    </div>
                </section>

                {/* Page 2 Widget Images */}
                <section className="bg-[#fbfaf7] p-5 border-2 border-[#2b2933] shadow-[3px_3px_0_rgba(43,41,51,0.18)]">
                    <h2 className="text-base font-bold font-display-italic text-[#2b2933] mb-2">桌面贴图</h2>
                    <p className="text-[10px] text-[#6b6b6b] mb-4">贴小组件图片（时钟截图、推图之类），长按撕掉</p>
                    <input type="file" ref={widgetInputRef} className="hidden" accept="image/*" onChange={(e) => e.target.files?.[0] && handleWidgetUpload(e.target.files[0])} />
                    <div className="space-y-2 bg-[#f4f2ed] p-3 border-2 border-dashed border-[#2b2933]/30">
                        <div className="flex gap-2">
                            {['tl', 'tr'].map(slot => {
                                const img = (theme.launcherWidgets || {})[slot];
                                return (
                                    <LongPressArea
                                        key={slot}
                                        className={`flex-1 aspect-square overflow-hidden relative cursor-pointer transition-transform active:translate-x-[1px] active:translate-y-[1px] ${img ? 'border-2 border-[#2b2933] shadow-[2px_2px_0_rgba(43,41,51,0.25)]' : 'border-2 border-dashed border-[#2b2933]/50 bg-[#fbfaf7] flex items-center justify-center'}`}
                                        onClick={() => { setActiveWidgetSlot(slot); widgetInputRef.current?.click(); }}
                                        onLongPress={() => {
                                            if (img) {
                                                removeWidget(slot);
                                                addToast('贴图撕掉了', 'success');
                                            }
                                        }}
                                    >
                                        {img ? (
                                            <>
                                                <img src={img} className="w-full h-full object-cover" />
                                                <div className="absolute inset-0 bg-[#2b2933]/0 hover:bg-[#2b2933]/20 transition-colors flex items-center justify-center opacity-0 hover:opacity-100">
                                                    <span className="text-[#fbfaf7] text-[10px] font-bold bg-[#2b2933] px-2 py-0.5 label-mono">换</span>
                                                </div>
                                            </>
                                        ) : (
                                            <div className="text-[#8b8996] text-center">
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 mx-auto mb-1"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                                                <span className="text-[9px]">图片</span>
                                            </div>
                                        )}
                                    </LongPressArea>
                                );
                            })}
                        </div>
                        {(() => {
                            const slot = 'wide';
                            const img = (theme.launcherWidgets || {})[slot];
                            return (
                                <LongPressArea
                                    className={`w-full h-20 overflow-hidden relative cursor-pointer transition-transform active:translate-x-[1px] active:translate-y-[1px] ${img ? 'border-2 border-[#2b2933] shadow-[2px_2px_0_rgba(43,41,51,0.25)]' : 'border-2 border-dashed border-[#2b2933]/50 bg-[#fbfaf7] flex items-center justify-center'}`}
                                    onClick={() => { setActiveWidgetSlot(slot); widgetInputRef.current?.click(); }}
                                    onLongPress={() => {
                                        if (img) {
                                            removeWidget(slot);
                                            addToast('长条撕掉了', 'success');
                                        }
                                    }}
                                >
                                    {img ? (
                                        <>
                                            <img src={img} className="w-full h-full object-cover" />
                                            <div className="absolute inset-0 bg-[#2b2933]/0 hover:bg-[#2b2933]/20 transition-colors flex items-center justify-center opacity-0 hover:opacity-100">
                                                <span className="text-[#fbfaf7] text-[10px] font-bold bg-[#2b2933] px-2 py-0.5 label-mono">换</span>
                                            </div>
                                        </>
                                    ) : (
                                        <div className="text-[#8b8996] text-center">
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 mx-auto mb-0.5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                                            <span className="text-[9px]">长条</span>
                                        </div>
                                    )}
                                </LongPressArea>
                            );
                        })()}
                    </div>
                </section>

                {/* Desktop Decoration DIY Section */}
                <section className="bg-[#fbfaf7] p-5 border-2 border-[#2b2933] shadow-[3px_3px_0_rgba(43,41,51,0.18)]">
                    <div className="flex items-center justify-between mb-2">
                        <h2 className="text-base font-bold font-display-italic text-[#2b2933]">贴纸拼贴</h2>
                        <span className="text-[9px] bg-[#2b2933] text-[#fbfaf7] px-2 py-0.5 label-mono -rotate-3">尽情贴</span>
                    </div>
                    <p className="text-[10px] text-[#6b6b6b] mb-4">随手往桌面贴贴纸，挪位置 / 调大小 / 转角度 / 改透明度，拼出只属于你的那一页！</p>
                    <input type="file" ref={decoInputRef} className="hidden" accept="image/*" onChange={(e) => { if (e.target.files?.[0]) handleDecoUpload(e.target.files[0]); e.target.value = ''; }} />

                    {/* Live Preview */}
                    <div className="relative w-full aspect-[9/16] bg-slate-100 overflow-hidden mb-4 border-2 border-[#2b2933] shadow-[3px_3px_0_rgba(43,41,51,0.25)]"
                         style={{ background: theme.wallpaper ? `url(${theme.wallpaper}) center/cover` : `linear-gradient(135deg, hsl(${theme.hue}, ${theme.saturation}%, ${theme.lightness}%), hsl(${theme.hue + 30}, ${theme.saturation}%, ${Math.max(theme.lightness - 15, 10)}%))` }}>
                        <div className="absolute inset-0 bg-black/10"></div>
                        {/* Render widget previews */}
                        <div className="absolute top-[12%] left-4 right-4 space-y-1.5 pointer-events-none">
                            {(() => {
                                const w = theme.launcherWidgets || {};
                                return (
                                    <>
                                        {(w['tl'] || w['tr']) && (
                                            <div className="flex gap-1.5">
                                                {['tl', 'tr'].map(k => w[k] ? (
                                                    <div key={k} className="flex-1 aspect-square rounded-lg overflow-hidden opacity-70"><img src={w[k]} className="w-full h-full object-cover" /></div>
                                                ) : <div key={k} className="flex-1" />)}
                                            </div>
                                        )}
                                        {w['wide'] && (
                                            <div className="w-full h-8 rounded-lg overflow-hidden opacity-70"><img src={w['wide']} className="w-full h-full object-cover" /></div>
                                        )}
                                    </>
                                );
                            })()}
                        </div>
                        {/* Render decorations in preview */}
                        {decorations.map(deco => (
                            <div key={deco.id}
                                className={`absolute cursor-pointer transition-all duration-100 ${editingDecoId === deco.id ? 'ring-2 ring-[#fbfaf7] ring-offset-2 ring-offset-[#2b2933]' : ''}`}
                                style={{
                                    left: `${deco.x}%`, top: `${deco.y}%`,
                                    transform: `translate(-50%, -50%) scale(${deco.scale * 0.4}) rotate(${deco.rotation}deg)${deco.flip ? ' scaleX(-1)' : ''}`,
                                    opacity: deco.opacity, zIndex: deco.zIndex,
                                }}
                                onClick={() => setEditingDecoId(editingDecoId === deco.id ? null : deco.id)}>
                                <img src={deco.content} className="w-16 h-16 object-contain pointer-events-none select-none" draggable={false} />
                            </div>
                        ))}
                        {decorations.length === 0 && (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <div className="text-center text-white/50">
                                    <Sparkle size={48} weight="fill" className="text-white/70 mb-2" />
                                    <div className="text-[10px] font-bold label-mono">贴第一张贴纸吧</div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Add Decoration Buttons */}
                    <div className="flex gap-2 mb-4">
                        <button onClick={() => setShowPresetPicker(!showPresetPicker)}
                            className="flex-1 py-2.5 bg-[#fbfaf7] text-[#2b2933] font-bold text-xs label-mono border-2 border-[#2b2933] hover:bg-[#2b2933] hover:text-[#fbfaf7] active:translate-x-[1px] active:translate-y-[1px] transition-all flex items-center justify-center gap-1.5">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z" /></svg>
                            现成贴纸
                        </button>
                        <button onClick={() => decoInputRef.current?.click()}
                            className="flex-1 py-2.5 bg-[#2b2933] text-[#fbfaf7] font-bold text-xs label-mono border-2 border-[#2b2933] active:translate-x-[1px] active:translate-y-[1px] transition-all flex items-center justify-center gap-1.5">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" /></svg>
                            贴自己的
                        </button>
                    </div>

                    {/* Preset Picker */}
                    {showPresetPicker && (
                        <div className="bg-[#f4f2ed] p-3 border-2 border-dashed border-[#2b2933]/40 mb-4 animate-fade-in">
                            <div className="text-[10px] text-[#8b8996] font-bold label-mono mb-3">挑一张现成贴纸</div>
                            {['stars', 'hearts', 'flowers', 'ribbons', 'animals', 'shapes', 'badges'].map(cat => {
                                const items = PRESET_DECOS.filter(p => p.category === cat);
                                if (items.length === 0) return null;
                                const catInfo = CATEGORY_LABELS[cat];
                                return (
                                    <div key={cat} className="mb-3">
                                        <div className="text-[10px] text-[#6b6b6b] mb-1.5 flex items-center gap-1 label-mono">{catInfo && <TwemojiImg code={catInfo.code} className="w-3.5 h-3.5 inline-block" />} {catInfo?.label || cat}</div>
                                        <div className="flex gap-2 flex-wrap">
                                            {items.map(preset => (
                                                <button key={preset.name} onClick={() => addDecoration(preset.content, 'preset')}
                                                    className="w-14 h-14 bg-[#fbfaf7] border-2 border-[#2b2933]/30 flex flex-col items-center justify-center gap-0.5 hover:border-[#2b2933] hover:shadow-[2px_2px_0_#2b2933] active:translate-x-[1px] active:translate-y-[1px] transition-all group">
                                                    <img src={preset.content} className="w-8 h-8 object-contain group-hover:scale-110 transition-transform" />
                                                    <span className="text-[8px] text-[#8b8996]">{preset.name}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Decoration List & Editor */}
                    {decorations.length > 0 && (
                        <div className="space-y-2">
                            <div className="text-[10px] text-[#8b8996] font-bold label-mono mb-2">已贴 {decorations.length} 张</div>
                            {decorations.map((deco, idx) => (
                                <div key={deco.id} className={`bg-[#f4f2ed] border-2 transition-all ${editingDecoId === deco.id ? 'border-[#2b2933] shadow-[2px_2px_0_#2b2933]' : 'border-[#2b2933]/20'}`}>
                                    {/* Decoration header row */}
                                    <div className="flex items-center gap-2 p-2.5 cursor-pointer" onClick={() => setEditingDecoId(editingDecoId === deco.id ? null : deco.id)}>
                                        <div className="w-10 h-10 bg-[#fbfaf7] border-2 border-[#2b2933] flex items-center justify-center overflow-hidden shrink-0">
                                            <img src={deco.content} className="w-8 h-8 object-contain" style={{ transform: deco.flip ? 'scaleX(-1)' : undefined }} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-xs font-bold text-[#2b2933]">第 {idx + 1} 张</div>
                                            <div className="text-[9px] text-[#8b8996]">位置 ({Math.round(deco.x)}, {Math.round(deco.y)}) · {deco.scale}x · {deco.rotation}°</div>
                                        </div>
                                        <button onClick={(e) => { e.stopPropagation(); removeDecoration(deco.id); }} className="p-1.5 text-[#8b8996] hover:text-[#fbfaf7] hover:bg-[#2b2933] transition-colors">
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                                        </button>
                                        <div className={`w-5 h-5 flex items-center justify-center transition-transform ${editingDecoId === deco.id ? 'rotate-180' : ''}`}>
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5 text-[#8b8996]"><path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" /></svg>
                                        </div>
                                    </div>

                                    {/* Expanded edit controls */}
                                    {editingDecoId === deco.id && (
                                        <div className="px-3 pb-3 space-y-4 animate-fade-in border-t-2 border-dashed border-[#2b2933]/30 pt-3">
                                            {/* Position X */}
                                            <div>
                                                <div className="flex justify-between mb-1.5">
                                                    <label className="text-[10px] font-bold text-[#8b8996] label-mono">左右</label>
                                                    <span className="text-[10px] text-[#6b6b6b] font-mono">{Math.round(deco.x)}%</span>
                                                </div>
                                                <input type="range" min="0" max="100" value={deco.x} onChange={(e) => updateDecoration(deco.id, { x: parseFloat(e.target.value) })} className="w-full h-1.5 bg-[#e3e0d6] rounded-full appearance-none cursor-pointer accent-[#2b2933]" />
                                            </div>
                                            {/* Position Y */}
                                            <div>
                                                <div className="flex justify-between mb-1.5">
                                                    <label className="text-[10px] font-bold text-[#8b8996] label-mono">上下</label>
                                                    <span className="text-[10px] text-[#6b6b6b] font-mono">{Math.round(deco.y)}%</span>
                                                </div>
                                                <input type="range" min="0" max="100" value={deco.y} onChange={(e) => updateDecoration(deco.id, { y: parseFloat(e.target.value) })} className="w-full h-1.5 bg-[#e3e0d6] rounded-full appearance-none cursor-pointer accent-[#2b2933]" />
                                            </div>
                                            {/* Scale & Rotation */}
                                            <div className="grid grid-cols-2 gap-4">
                                                <div>
                                                    <div className="flex justify-between mb-1.5">
                                                        <label className="text-[10px] font-bold text-[#8b8996] label-mono">缩放</label>
                                                        <span className="text-[10px] text-[#6b6b6b] font-mono">{deco.scale}x</span>
                                                    </div>
                                                    <input type="range" min="0.2" max="3" step="0.1" value={deco.scale} onChange={(e) => updateDecoration(deco.id, { scale: parseFloat(e.target.value) })} className="w-full h-1.5 bg-[#e3e0d6] rounded-full appearance-none cursor-pointer accent-[#2b2933]" />
                                                </div>
                                                <div>
                                                    <div className="flex justify-between mb-1.5">
                                                        <label className="text-[10px] font-bold text-[#8b8996] label-mono">旋转</label>
                                                        <span className="text-[10px] text-[#6b6b6b] font-mono">{deco.rotation}°</span>
                                                    </div>
                                                    <input type="range" min="-180" max="180" value={deco.rotation} onChange={(e) => updateDecoration(deco.id, { rotation: parseInt(e.target.value) })} className="w-full h-1.5 bg-[#e3e0d6] rounded-full appearance-none cursor-pointer accent-[#2b2933]" />
                                                </div>
                                            </div>
                                            {/* Opacity */}
                                            <div>
                                                <div className="flex justify-between mb-1.5">
                                                    <label className="text-[10px] font-bold text-[#8b8996] label-mono">透明度</label>
                                                    <span className="text-[10px] text-[#6b6b6b] font-mono">{Math.round(deco.opacity * 100)}%</span>
                                                </div>
                                                <input type="range" min="0.1" max="1" step="0.05" value={deco.opacity} onChange={(e) => updateDecoration(deco.id, { opacity: parseFloat(e.target.value) })} className="w-full h-1.5 bg-[#e3e0d6] rounded-full appearance-none cursor-pointer accent-[#2b2933]" />
                                            </div>
                                            {/* Quick Actions */}
                                            <div className="flex gap-2 flex-wrap">
                                                <button onClick={() => updateDecoration(deco.id, { flip: !deco.flip })}
                                                    className={`px-3 py-1.5 text-[10px] font-bold label-mono border-2 transition-all active:translate-x-[1px] active:translate-y-[1px] ${deco.flip ? 'bg-[#2b2933] text-[#fbfaf7] border-[#2b2933]' : 'bg-[#fbfaf7] text-[#6b6b6b] border-[#2b2933]/30'}`}>
                                                    翻面
                                                </button>
                                                <button onClick={() => updateDecoration(deco.id, { rotation: 0, scale: 1, opacity: 1, flip: false })}
                                                    className="px-3 py-1.5 text-[10px] font-bold label-mono bg-[#fbfaf7] text-[#6b6b6b] border-2 border-[#2b2933]/30 active:translate-x-[1px] active:translate-y-[1px] transition-all">
                                                    复位
                                                </button>
                                                <button onClick={() => {
                                                    const dup: DesktopDecoration = { ...deco, id: `deco-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, x: Math.min(deco.x + 8, 95), y: Math.min(deco.y + 8, 95) };
                                                    const next = [...decorations, dup];
                                                    updateTheme({ desktopDecorations: next });
                                                    setEditingDecoId(dup.id);
                                                }}
                                                    className="px-3 py-1.5 text-[10px] font-bold label-mono bg-[#fbfaf7] text-[#6b6b6b] border-2 border-[#2b2933]/30 active:translate-x-[1px] active:translate-y-[1px] transition-all">
                                                    再贴一张
                                                </button>
                                                {/* Layer controls */}
                                                <button onClick={() => {
                                                    const maxZ = Math.max(...decorations.map(d => d.zIndex), 0);
                                                    updateDecoration(deco.id, { zIndex: maxZ + 1 });
                                                }}
                                                    className="px-3 py-1.5 text-[10px] font-bold label-mono bg-[#fbfaf7] text-[#6b6b6b] border-2 border-[#2b2933]/30 active:translate-x-[1px] active:translate-y-[1px] transition-all">
                                                    压最上
                                                </button>
                                                <button onClick={() => updateDecoration(deco.id, { zIndex: 0 })}
                                                    className="px-3 py-1.5 text-[10px] font-bold label-mono bg-[#fbfaf7] text-[#6b6b6b] border-2 border-[#2b2933]/30 active:translate-x-[1px] active:translate-y-[1px] transition-all">
                                                    塞最下
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                            {/* Clear all button */}
                            <button onClick={() => { updateTheme({ desktopDecorations: [] }); setEditingDecoId(null); }}
                                className="w-full py-2 text-xs font-bold label-mono text-[#2b2933] border-2 border-dashed border-[#2b2933]/50 hover:bg-[#2b2933] hover:text-[#fbfaf7] transition-colors mt-2">
                                全撕光
                            </button>
                        </div>
                    )}
                    <div className="text-[10px] text-[#8b8996] mt-3 px-1 font-hand text-sm">提示：贴纸叠在桌面第二页上，每张都能单独挪位置、调大小、转角度、改透明度。可以贴自己的图，也能用现成贴纸。</div>
                </section>
            </>
        ) : activeTab === 'icons' ? (
            <div className="space-y-5">
                <section className="bg-[#fbfaf7] p-5 border-2 border-[#2b2933] shadow-[3px_3px_0_rgba(43,41,51,0.18)]">
                    <h2 className="text-base font-bold font-display-italic text-[#2b2933] mb-2">桌面图标风格</h2>
                    <p className="text-[10px] text-[#6b6b6b] mb-4">桌面图标、Dock 和拖拽手感统一在这里调。上面调风格，下面给单个 App 换图。</p>
                    <div className="space-y-4">
                        <div>
                            <div className="text-[11px] font-bold text-[#2b2933] mb-1.5 label-mono">图标形状</div>
                            <div className="flex flex-wrap gap-1.5">
                                {DESKTOP_ICON_SHAPES.map(opt => (
                                    <SmallChip key={opt.value} active={(theme.desktopIconShape || 'rounded') === opt.value} onClick={() => updateTheme({ desktopIconShape: opt.value as any })}>{opt.label}</SmallChip>
                                ))}
                            </div>
                        </div>
                        <div>
                            <div className="text-[11px] font-bold text-[#2b2933] mb-1.5 label-mono">图标材质</div>
                            <div className="flex flex-wrap gap-1.5">
                                {DESKTOP_ICON_SURFACES.map(opt => (
                                    <SmallChip key={opt.value} active={(theme.desktopIconSurface || 'paper') === opt.value} onClick={() => updateTheme({ desktopIconSurface: opt.value as any })}>{opt.label}</SmallChip>
                                ))}
                            </div>
                        </div>
                        <div>
                            <div className="text-[11px] font-bold text-[#2b2933] mb-1.5 label-mono">图标大小</div>
                            <div className="flex flex-wrap gap-1.5">
                                {DESKTOP_ICON_SCALES.map(opt => (
                                    <SmallChip key={opt.value} active={(theme.desktopIconScale || 'md') === opt.value} onClick={() => updateTheme({ desktopIconScale: opt.value as any })}>{opt.label}</SmallChip>
                                ))}
                            </div>
                        </div>
                        <div>
                            <div className="text-[11px] font-bold text-[#2b2933] mb-1.5 label-mono">标签显示</div>
                            <div className="flex flex-wrap gap-1.5">
                                {DESKTOP_LABEL_MODES.map(opt => (
                                    <SmallChip key={opt.value} active={(theme.desktopIconLabelMode || 'fade') === opt.value} onClick={() => updateTheme({ desktopIconLabelMode: opt.value as any })}>{opt.label}</SmallChip>
                                ))}
                            </div>
                        </div>
                        <div>
                            <div className="text-[11px] font-bold text-[#2b2933] mb-1.5 label-mono">Dock 风格</div>
                            <div className="flex flex-wrap gap-1.5">
                                {DESKTOP_DOCK_STYLES.map(opt => (
                                    <SmallChip key={opt.value} active={(theme.desktopDockStyle || 'glass') === opt.value} onClick={() => updateTheme({ desktopDockStyle: opt.value as any })}>{opt.label}</SmallChip>
                                ))}
                            </div>
                        </div>
                        <div>
                            <div className="text-[11px] font-bold text-[#2b2933] mb-1.5 label-mono">拖拽手感</div>
                            <div className="flex flex-wrap gap-1.5">
                                {DESKTOP_DRAG_MODES.map(opt => (
                                    <SmallChip key={opt.value} active={(theme.desktopDragMode || 'balanced') === opt.value} onClick={() => updateTheme({ desktopDragMode: opt.value as any })}>{opt.label}</SmallChip>
                                ))}
                            </div>
                        </div>
                        <div>
                            <div className="text-[11px] font-bold text-[#2b2933] mb-1.5 label-mono">编辑态动效</div>
                            <div className="flex flex-wrap gap-1.5">
                                {DESKTOP_EDIT_EFFECTS.map(opt => (
                                    <SmallChip key={opt.value} active={(theme.desktopEditEffect || 'wiggle') === opt.value} onClick={() => updateTheme({ desktopEditEffect: opt.value as any })}>{opt.label}</SmallChip>
                                ))}
                            </div>
                        </div>
                    </div>
                </section>

                <section className="bg-[#fbfaf7] p-5 border-2 border-[#2b2933] shadow-[3px_3px_0_rgba(43,41,51,0.18)]">
                    <h2 className="text-base font-bold font-display-italic text-[#2b2933] mb-2">图标贴图</h2>
                    <p className="text-[10px] text-[#6b6b6b] mb-4">给单个 App 换自己的封面图。保留原图标也没问题，上面的风格设置同样照常生效。</p>
                    <div className="grid grid-cols-3 gap-4">
                        {INSTALLED_APPS.map(app => {
                            const Icon = Icons[app.icon];
                            const customUrl = customIcons[app.id];
                            return (
                                <div key={app.id} className="flex flex-col items-center gap-2">
                                     <div
                                        className="w-16 h-16 border-2 border-[#2b2933] shadow-[2px_2px_0_#2b2933] bg-[#f4f2ed] overflow-hidden relative group cursor-pointer rounded-[1.15rem]"
                                        onClick={() => { setSelectedAppId(app.id); iconInputRef.current?.click(); }}
                                     >
                                         {customUrl ? (
                                             <img src={customUrl} className="w-full h-full object-cover" />
                                         ) : (
                                             <div className={`w-full h-full ${app.color} flex items-center justify-center text-white`}>
                                                 <Icon className="w-8 h-8" />
                                             </div>
                                         )}
                                         <div className="absolute inset-0 bg-[#2b2933]/45 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                             <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6 text-[#fbfaf7]"><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" /></svg>
                                         </div>
                                     </div>
                                     <span className="text-[10px] text-[#6b6b6b] font-bold">{app.name}</span>
                                     {customUrl && (
                                         <button onClick={() => setCustomIcon(app.id, undefined)} className="text-[10px] text-[#2b2933] underline label-mono">撕掉</button>
                                     )}
                                </div>
                            );
                        })}
                        <input type="file" ref={iconInputRef} className="hidden" accept="image/*" onChange={(e) => e.target.files?.[0] && handleIconUpload(e.target.files[0])} />
                    </div>
                </section>
            </div>
        ) : false ? (
            <div className="grid grid-cols-3 gap-4">
                {INSTALLED_APPS.map(app => {
                    const Icon = Icons[app.icon];
                    const customUrl = customIcons[app.id];
                    return (
                        <div key={app.id} className="flex flex-col items-center gap-2">
                             <div
                                className="w-16 h-16 border-2 border-[#2b2933] shadow-[2px_2px_0_#2b2933] bg-[#f4f2ed] overflow-hidden relative group cursor-pointer"
                                onClick={() => { setSelectedAppId(app.id); iconInputRef.current?.click(); }}
                             >
                                 {customUrl ? (
                                     <img src={customUrl} className="w-full h-full object-cover" />
                                 ) : (
                                     <div className={`w-full h-full ${app.color} flex items-center justify-center text-white`}>
                                         <Icon className="w-8 h-8" />
                                     </div>
                                 )}
                                 <div className="absolute inset-0 bg-[#2b2933]/45 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                     <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6 text-[#fbfaf7]"><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" /></svg>
                                 </div>
                             </div>
                             <span className="text-[10px] text-[#6b6b6b] font-bold">{app.name}</span>
                             {customUrl && (
                                 <button onClick={() => setCustomIcon(app.id, undefined)} className="text-[10px] text-[#2b2933] underline label-mono">撕掉</button>
                             )}
                        </div>
                    );
                })}
                <input type="file" ref={iconInputRef} className="hidden" accept="image/*" onChange={(e) => e.target.files?.[0] && handleIconUpload(e.target.files[0])} />
            </div>
        ) : activeTab === 'presets' ? (
            <PresetManager
                presets={appearancePresets}
                onSave={saveAppearancePreset}
                onApply={applyAppearancePreset}
                onDelete={deleteAppearancePreset}
                onRename={renameAppearancePreset}
                onExport={exportAppearancePreset}
                onImport={importAppearancePreset}
                onReset={resetAppearance}
                addToast={addToast}
                currentTheme={theme}
            />
        ) : activeTab === 'desktop' ? (
            <DesktopLockEditor theme={theme} updateTheme={updateTheme} addToast={addToast} />
        ) : activeTab === 'chat' ? (
            <ModularChatAppearanceEditor theme={theme} updateTheme={updateTheme} onResetAllChrome={resetAllChromeCss} onOpenBubbleWorkshop={() => setShowBubbleWorkshop(true)} />
        ) : activeTab === 'css' ? (
            <CustomCssStudio theme={theme} updateTheme={updateTheme} onResetAllChrome={resetAllChromeCss} addToast={addToast} />
        ) : activeTab === 'tarot' ? (
            <TarotSkinEditor theme={theme} updateTheme={updateTheme} addToast={addToast} />
        ) : null}
      </div>
    </div>
  );
};

export default Appearance;
