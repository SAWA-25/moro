


import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useOS } from '../context/OSContext';
import { ChatTheme, BubbleStyle } from '../types';
import { processImage } from '../utils/file';

const cloneTheme = (theme: ChatTheme): ChatTheme => {
    if (typeof structuredClone === 'function') {
        return structuredClone(theme);
    }
    return JSON.parse(JSON.stringify(theme));
};

const DEFAULT_STYLE: BubbleStyle = {
    textColor: '#334155',
    backgroundColor: '#ffffff',
    borderRadius: 20,
    opacity: 1,
    backgroundImageOpacity: 0.5,
    decorationX: 90,
    decorationY: -10,
    decorationScale: 1,
    decorationRotate: 0,
    avatarDecorationX: 50,
    avatarDecorationY: 50,
    avatarDecorationScale: 1,
    avatarDecorationRotate: 0
};

const DEFAULT_THEME: ChatTheme = {
    id: '',
    name: '未命名贴页',
    type: 'custom',
    user: { ...DEFAULT_STYLE, textColor: '#ffffff', backgroundColor: '#6366f1' },
    ai: { ...DEFAULT_STYLE },
    customCss: ''
};

// --- CSS Examples ---
const CSS_EXAMPLES = [
    {
        name: '磨砂玻璃',
        code: `/* Glassmorphism for bubbles */
.moro-bubble-user, .moro-bubble-ai {
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255,255,255,0.4);
  box-shadow: 0 4px 6px rgba(0,0,0,0.05);
}
.moro-bubble-user { background: rgba(99, 102, 241, 0.7) !important; }
.moro-bubble-ai { background: rgba(255, 255, 255, 0.7) !important; }`
    },
    {
        name: '霓虹勾边',
        code: `/* Glowing Neon Borders */
.moro-bubble-user {
  border: 2px solid #a855f7;
  box-shadow: 0 0 10px #a855f7;
  background: #2e1065 !important;
  color: #fff !important;
}
.moro-bubble-ai {
  border: 2px solid #3b82f6;
  box-shadow: 0 0 10px #3b82f6;
  background: #172554 !important;
  color: #fff !important;
}`
    },
    {
        name: '像素颗粒',
        code: `/* Pixel Art Style — Refined */
.moro-bubble-user, .moro-bubble-ai {
  border-radius: 0px !important;
  border: 3px solid #2d2d2d;
  box-shadow: 4px 4px 0px #2d2d2d, inset -2px -2px 0px rgba(0,0,0,0.12), inset 2px 2px 0px rgba(255,255,255,0.25);
  font-family: 'Courier New', monospace;
  image-rendering: pixelated;
  letter-spacing: 0.02em;
}
.moro-bubble-user {
  background: linear-gradient(135deg, #6366f1 0%, #818cf8 100%) !important;
  border-color: #4338ca;
  box-shadow: 4px 4px 0px #4338ca, inset -2px -2px 0px rgba(0,0,0,0.15), inset 2px 2px 0px rgba(255,255,255,0.2);
}
.moro-bubble-ai {
  background: linear-gradient(135deg, #f8f8f8 0%, #e8e8e8 100%) !important;
  border-color: #bbb;
  box-shadow: 4px 4px 0px #bbb, inset -2px -2px 0px rgba(0,0,0,0.06), inset 2px 2px 0px rgba(255,255,255,0.8);
}`
    }
];

// --- Helpers for Color & CSS ---

// Parse Hex/RGBA to { hex: "#RRGGBB", alpha: 0-1 }
const parseColorValue = (color: string) => {
    // Default
    let hex = '#ffffff';
    let alpha = 1;

    if (!color) return { hex, alpha };

    if (color.startsWith('#')) {
        hex = color.substring(0, 7);
        // Handle #RRGGBBAA? Assuming standard 6 char for now or simple
        return { hex, alpha: 1 };
    }

    if (color.startsWith('rgba')) {
        const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (match) {
            const r = parseInt(match[1]);
            const g = parseInt(match[2]);
            const b = parseInt(match[3]);
            const a = match[4] ? parseFloat(match[4]) : 1;
            const toHex = (n: number) => n.toString(16).padStart(2, '0');
            hex = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
            alpha = a;
        }
    }
    return { hex, alpha };
};

const toRgbaString = (hex: string, alpha: number) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

type RGB = { r: number; g: number; b: number };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const hexToRgb = (hex: string): RGB => ({
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16)
});

const mixColors = (fg: RGB, bg: RGB, alpha: number): RGB => {
    const a = clamp(alpha, 0, 1);
    return {
        r: Math.round(fg.r * a + bg.r * (1 - a)),
        g: Math.round(fg.g * a + bg.g * (1 - a)),
        b: Math.round(fg.b * a + bg.b * (1 - a))
    };
};

const relativeLuminance = ({ r, g, b }: RGB) => {
    const toLinear = (channel: number) => {
        const value = channel / 255;
        return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
};

const getContrastRatio = (textHex: string, backgroundColor: string, previewBgHex: string) => {
    const parsedBg = parseColorValue(backgroundColor);
    const text = hexToRgb(parseColorValue(textHex).hex);
    const bubbleBg = hexToRgb(parsedBg.hex);
    const previewBg = hexToRgb(previewBgHex);
    const effectiveBg = mixColors(bubbleBg, previewBg, parsedBg.alpha);
    const l1 = relativeLuminance(text);
    const l2 = relativeLuminance(effectiveBg);
    const bright = Math.max(l1, l2);
    const dark = Math.min(l1, l2);
    return (bright + 0.05) / (dark + 0.05);
};

const getContrastGrade = (ratio: number) => {
    if (ratio >= 7) return 'A';
    if (ratio >= 4.5) return 'B';
    return 'C';
};

const getReadableTextColor = (backgroundColor: string, previewBgHex: string) => {
    const whiteContrast = getContrastRatio('#ffffff', backgroundColor, previewBgHex);
    const blackContrast = getContrastRatio('#000000', backgroundColor, previewBgHex);
    return whiteContrast >= blackContrast ? '#ffffff' : '#000000';
};

// Padding CSS Injection Helper
const PADDING_MARKER_START = '/* PADDING_AUTO_START */';
const PADDING_MARKER_END = '/* PADDING_AUTO_END */';

const injectPaddingCss = (css: string, verticalPadding: number) => {
    const horizontalPadding = Math.round(verticalPadding * 1.6); // Aspect ratio for bubble
    const rule = `
${PADDING_MARKER_START}
.moro-bubble-user, .moro-bubble-ai {
  padding: ${verticalPadding}px ${horizontalPadding}px !important;
}
${PADDING_MARKER_END}`;

    const regex = new RegExp(`${PADDING_MARKER_START.replace(/\*/g, '\\*')}[\\s\\S]*?${PADDING_MARKER_END.replace(/\*/g, '\\*')}`);
    
    if (css && css.match(regex)) {
        return css.replace(regex, rule);
    }
    return (css || '') + rule;
};

const extractPaddingFromCss = (css: string) => {
    const match = css?.match(/padding:\s*(\d+)px/);
    return match ? parseInt(match[1]) : 12; // Default 12px (py-3)
};

const SHADOW_MARKER_START = '/* SHADOW_AUTO_START */';
const SHADOW_MARKER_END = '/* SHADOW_AUTO_END */';

const injectShadowCss = (css: string, userShadow: string, aiShadow: string) => {
    const rule = `
${SHADOW_MARKER_START}
.moro-bubble-user { box-shadow: ${userShadow} !important; }
.moro-bubble-ai { box-shadow: ${aiShadow} !important; }
${SHADOW_MARKER_END}`;

    const regex = new RegExp(`${SHADOW_MARKER_START.replace(/\*/g, '\\*')}[\\s\\S]*?${SHADOW_MARKER_END.replace(/\*/g, '\\*')}`);
    if (css && css.match(regex)) {
        return css.replace(regex, rule);
    }
    return (css || '') + rule;
};

const hslToHex = (h: number, s: number, l: number) => {
    const sat = s / 100;
    const light = l / 100;
    const c = (1 - Math.abs(2 * light - 1)) * sat;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = light - c / 2;
    let r = 0;
    let g = 0;
    let b = 0;

    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];

    const toHex = (value: number) => Math.round((value + m) * 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

type StyleTemplate = {
    id: string;
    name: string;
    description: string;
    user: Partial<BubbleStyle>;
    ai: Partial<BubbleStyle>;
    userShadow: string;
    aiShadow: string;
};

type CssSnippet = {
    id: string;
    name: string;
    description: string;
    code: string;
};

type CssValidationResult = {
    isValid: boolean;
    errors: string[];
    errorLines: number[];
    importantCount: number;
};

const TARGET_SELECTOR_REGEX = /^\.moro-bubble-(user|ai)\b/;

const isValidHttpImageUrl = (value: string) => {
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch {
        return false;
    }
};

const findLineNumberByIndex = (input: string, index: number) => input.slice(0, index).split('\n').length;

const extractLineFromErrorMessage = (message: string) => {
    const lineMatch = message.match(/line\s*(\d+)/i);
    return lineMatch ? parseInt(lineMatch[1], 10) : null;
};

const validateCustomCss = (css: string): CssValidationResult => {
    const source = css || '';
    const errors: string[] = [];
    const errorLines: number[] = [];
    const pushError = (message: string, line?: number | null) => {
        errors.push(message);
        if (line && !Number.isNaN(line)) {
            errorLines.push(line);
        }
    };

    const importantCount = (source.match(/!important/g) || []).length;
    if (!source.trim()) {
        return { isValid: true, errors: [], errorLines: [], importantCount };
    }

    // Minimal syntax check 1: browser parser
    try {
        if (typeof CSSStyleSheet !== 'undefined') {
            const sheet = new CSSStyleSheet();
            sheet.replaceSync(source);
        }
    } catch (error: any) {
        pushError(`CSS 语法错误：${error?.message || '请检查语法。'}`, extractLineFromErrorMessage(error?.message || ''));
    }

    // Minimal syntax check 2: brace balance
    const braceStack: number[] = [];
    [...source].forEach((char, index) => {
        if (char === '{') braceStack.push(index);
        if (char === '}') {
            if (braceStack.length === 0) {
                pushError('发现多余的 `}`，请检查大括号闭合。', findLineNumberByIndex(source, index));
            } else {
                braceStack.pop();
            }
        }
    });
    braceStack.forEach(index => pushError('存在未闭合的 `{`，请补全规则块。', findLineNumberByIndex(source, index)));

    // Scope check: only allow .moro-bubble-user / .moro-bubble-ai
    // Ignore comments first to avoid false positives like:
    // /* comment */ .moro-bubble-user { ... }
    const sourceWithoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
    const selectorRegex = /([^{}]+)\{/g;
    let selectorMatch = selectorRegex.exec(sourceWithoutComments);
    while (selectorMatch) {
        // 捕获到局部 const：forEach 回调里 TS 无法保证 let selectorMatch 仍非空
        const matchIndex = selectorMatch.index;
        const selectorGroup = selectorMatch[1].trim();
        if (!selectorGroup.startsWith('@')) {
            const selectorList = selectorGroup.split(',').map(item => item.trim()).filter(Boolean);
            selectorList.forEach(selector => {
                if (!TARGET_SELECTOR_REGEX.test(selector)) {
                    pushError(
                        `选择器 \`${selector}\` 超出限定范围，仅允许以 .moro-bubble-user / .moro-bubble-ai 开头。`,
                        findLineNumberByIndex(sourceWithoutComments, matchIndex)
                    );
                }
            });
        }
        selectorMatch = selectorRegex.exec(sourceWithoutComments);
    }

    return {
        isValid: errors.length === 0,
        errors,
        errorLines,
        importantCount
    };
};

const runCssRenderabilityCheck = (css: string, validation: CssValidationResult) => {
    if (!validation.isValid) {
        return {
            ok: false,
            message: `CSS 不可渲染：第 ${validation.errorLines[0] || '?'} 行附近存在错误，请先修复。`
        };
    }

    if (!css.trim()) {
        return { ok: true, message: '' };
    }

    try {
        const styleEl = document.createElement('style');
        styleEl.textContent = css;
        document.head.appendChild(styleEl);
        const ruleCount = styleEl.sheet?.cssRules?.length ?? 0;
        styleEl.remove();
        if (ruleCount === 0) {
            return { ok: false, message: 'CSS 未生成有效规则，请确认语法和选择器。' };
        }
    } catch (error: any) {
        return { ok: false, message: `CSS 渲染检查失败：${error?.message || '未知错误。'}` };
    }

    return { ok: true, message: '' };
};

const CSS_SCOPE_SNIPPETS: CssSnippet[] = [
    {
        id: 'scope-shadow',
        name: '落影',
        description: '给两侧气泡压一层柔投影',
        code: `.moro-bubble-user, .moro-bubble-ai {\n  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.14);\n}`
    },
    {
        id: 'scope-stroke',
        name: '勾线',
        description: '统一描一圈轮廓边',
        code: `.moro-bubble-user, .moro-bubble-ai {\n  border: 1px solid rgba(148, 163, 184, 0.45);\n}`
    },
    {
        id: 'scope-gradient',
        name: '晕染',
        description: '让你我气泡拉开层次',
        code: `.moro-bubble-user {\n  background: linear-gradient(135deg, #6366f1, #8b5cf6) !important;\n}\n.moro-bubble-ai {\n  background: linear-gradient(135deg, #ffffff, #e2e8f0) !important;\n}`
    },
    {
        id: 'scope-glass',
        name: '磨砂',
        description: '磨砂底 + 高光镶边',
        code: `.moro-bubble-user, .moro-bubble-ai {\n  backdrop-filter: blur(10px);\n  border: 1px solid rgba(255, 255, 255, 0.45);\n}\n.moro-bubble-user {\n  background: rgba(99, 102, 241, 0.62) !important;\n}\n.moro-bubble-ai {\n  background: rgba(255, 255, 255, 0.62) !important;\n}`
    }
];

const STYLE_TEMPLATES: StyleTemplate[] = [
    {
        id: 'cream',
        name: '奶油页',
        description: '低饱和暖调，落影柔和',
        user: { textColor: '#7c2d12', backgroundColor: 'rgba(254, 243, 199, 0.92)', borderRadius: 20, opacity: 1, backgroundImageOpacity: 0.45, decorationX: 88, decorationY: -12, avatarDecorationX: 52, avatarDecorationY: 50 },
        ai: { textColor: '#78350f', backgroundColor: 'rgba(255, 251, 235, 0.9)', borderRadius: 20, opacity: 1, backgroundImageOpacity: 0.4, decorationX: 12, decorationY: -10, avatarDecorationX: 48, avatarDecorationY: 50 },
        userShadow: '0 8px 24px rgba(217, 119, 6, 0.18)',
        aiShadow: '0 6px 20px rgba(180, 83, 9, 0.14)'
    },
    {
        id: 'glass',
        name: '磨砂页',
        description: '半透磨砂，边缘轻薄',
        user: { textColor: '#0f172a', backgroundColor: 'rgba(191, 219, 254, 0.78)', borderRadius: 18, opacity: 0.98, backgroundImageOpacity: 0.6, decorationX: 90, decorationY: -14, avatarDecorationX: 50, avatarDecorationY: 48 },
        ai: { textColor: '#0f172a', backgroundColor: 'rgba(255, 255, 255, 0.72)', borderRadius: 18, opacity: 0.98, backgroundImageOpacity: 0.55, decorationX: 10, decorationY: -14, avatarDecorationX: 50, avatarDecorationY: 48 },
        userShadow: '0 10px 28px rgba(30, 41, 59, 0.16)',
        aiShadow: '0 8px 22px rgba(30, 41, 59, 0.13)'
    },
    {
        id: 'neon',
        name: '霓虹页',
        description: '高反差荧光，发光勾边',
        user: { textColor: '#faf5ff', backgroundColor: 'rgba(88, 28, 135, 0.9)', borderRadius: 16, opacity: 1, backgroundImageOpacity: 0.32, decorationX: 94, decorationY: -8, avatarDecorationX: 50, avatarDecorationY: 46 },
        ai: { textColor: '#e0f2fe', backgroundColor: 'rgba(12, 74, 110, 0.9)', borderRadius: 16, opacity: 1, backgroundImageOpacity: 0.32, decorationX: 8, decorationY: -8, avatarDecorationX: 50, avatarDecorationY: 46 },
        userShadow: '0 0 18px rgba(217, 70, 239, 0.55)',
        aiShadow: '0 0 18px rgba(14, 165, 233, 0.55)'
    },
    {
        id: 'paper',
        name: '纸页',
        description: '微黄纸面，带颗粒手感',
        user: { textColor: '#3f3f46', backgroundColor: 'rgba(254, 249, 195, 0.93)', borderRadius: 14, opacity: 1, backgroundImageOpacity: 0.7, decorationX: 90, decorationY: -6, avatarDecorationX: 54, avatarDecorationY: 52 },
        ai: { textColor: '#44403c', backgroundColor: 'rgba(254, 252, 232, 0.93)', borderRadius: 14, opacity: 1, backgroundImageOpacity: 0.68, decorationX: 10, decorationY: -6, avatarDecorationX: 46, avatarDecorationY: 52 },
        userShadow: '2px 2px 0 rgba(120, 113, 108, 0.32)',
        aiShadow: '2px 2px 0 rgba(113, 113, 122, 0.26)'
    },
    {
        id: 'minimal',
        name: '留白页',
        description: '弱投影，干净留白',
        user: { textColor: '#0f172a', backgroundColor: 'rgba(226, 232, 240, 0.86)', borderRadius: 20, opacity: 0.97, backgroundImageOpacity: 0.25, decorationX: 92, decorationY: -10, avatarDecorationX: 50, avatarDecorationY: 50 },
        ai: { textColor: '#1e293b', backgroundColor: 'rgba(248, 250, 252, 0.85)', borderRadius: 20, opacity: 0.97, backgroundImageOpacity: 0.22, decorationX: 8, decorationY: -10, avatarDecorationX: 50, avatarDecorationY: 50 },
        userShadow: '0 2px 8px rgba(15, 23, 42, 0.08)',
        aiShadow: '0 2px 8px rgba(15, 23, 42, 0.06)'
    }
];

type PreviewMockMessage = {
    id: string;
    role: 'user' | 'ai';
    kind: 'text' | 'image' | 'emoji';
    content: string;
    replyTo?: {
        name: string;
        content: string;
    };
};

type PreviewScene = {
    id: string;
    name: string;
    wallpaper?: string;
    darkMode?: boolean;
    messages: PreviewMockMessage[];
};

const PREVIEW_SCENES: PreviewScene[] = [
    {
        id: 'daily',
        name: '日常对话',
        messages: [
            { id: 'd1', role: 'ai', kind: 'text', content: '今天状态怎么样？要不要一起复盘一下计划。' },
            { id: 'd2', role: 'user', kind: 'text', content: '挺好！晚点一起把任务过一遍吧。' }
        ]
    },
    {
        id: 'long',
        name: '长段落',
        messages: [
            {
                id: 'l1',
                role: 'ai',
                kind: 'text',
                content: '这是一个长文本示例，用于观察在大段内容、自动换行和段落阅读中的可读性表现。\n\n第二段会保持留白，你可以重点观察行距、背景图叠加透明度与文本对比是否舒适。'
            },
            {
                id: 'l2',
                role: 'user',
                kind: 'text',
                content: '收到，我会重点看边角、段落间距、亮暗背景下的可读性。'
            }
        ]
    },
    {
        id: 'reply',
        name: '引用回复',
        messages: [
            { id: 'r1', role: 'ai', kind: 'text', content: '我把重点标出来了，看看这个版本。' },
            {
                id: 'r2',
                role: 'user',
                kind: 'text',
                content: '这里我想再调一下边框高亮效果。',
                replyTo: { name: 'AI', content: '我把重点标出来了，看看这个版本。' }
            }
        ]
    },
    {
        id: 'mix',
        name: '图文混排',
        messages: [
            { id: 'm1', role: 'ai', kind: 'image', content: '预览图' },
            { id: 'm2', role: 'user', kind: 'emoji', content: '😆' },
            { id: 'm3', role: 'ai', kind: 'text', content: '图片和文字、表情混排时也要保持层级清晰。' }
        ]
    },
    {
        id: 'dark-wallpaper',
        name: '暗底壁纸',
        darkMode: true,
        wallpaper: 'linear-gradient(135deg,#020617 0%,#1e293b 35%,#0f172a 100%)',
        messages: [
            { id: 'dw1', role: 'ai', kind: 'text', content: '深色壁纸下建议确认浅色文字的对比度。' },
            { id: 'dw2', role: 'user', kind: 'text', content: 'OK，我再检查透明背景图和阴影是否干净。' }
        ]
    }
];

// embedded：嵌在「主题」App 内当一个标签页用 —— 返回/保存退出走 onRequestClose 回到主题页，而不是关 App。
const ThemeMaker: React.FC<{ embedded?: boolean; onRequestClose?: () => void }> = ({ embedded = false, onRequestClose }) => {
    const { closeApp, addCustomTheme, addToast } = useOS();
    const exitView = () => (onRequestClose ? onRequestClose() : closeApp());
    const [initialThemeId] = useState(() => `theme-${Date.now()}`);
    const [editingTheme, setEditingTheme] = useState<ChatTheme>({ ...DEFAULT_THEME, id: initialThemeId });
    const [activeTab, setActiveTab] = useState<'user' | 'ai' | 'css'>('user');
    const [toolSection, setToolSection] = useState<'base' | 'sticker' | 'avatar'>('base'); 
    const [previewSceneId, setPreviewSceneId] = useState(PREVIEW_SCENES[0].id);
    const [showPreviewBgImage, setShowPreviewBgImage] = useState(true);
    const [isPreviewDark, setIsPreviewDark] = useState(false);
    const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
    const [userFollowAi, setUserFollowAi] = useState(false);
    const [lastSavedTheme, setLastSavedTheme] = useState<ChatTheme>(() => cloneTheme({ ...DEFAULT_THEME, id: initialThemeId }));
    const [isDirty, setIsDirty] = useState(false);
    const [pendingDiscardAction, setPendingDiscardAction] = useState<(() => void) | null>(null);
    const [showLowContrastConfirm, setShowLowContrastConfirm] = useState(false);
    const [pendingSaveExit, setPendingSaveExit] = useState(false);
    const [isAppliedToPreview, setIsAppliedToPreview] = useState(false);
    const [undoStack, setUndoStack] = useState<ChatTheme[]>([]);
    const [redoStack, setRedoStack] = useState<ChatTheme[]>([]);
    const [previewCompareMode, setPreviewCompareMode] = useState<'single' | 'split' | 'toggle'>('single');
    const [previewToggleTarget, setPreviewToggleTarget] = useState<'A' | 'B'>('A');
    const [lastUsableCss, setLastUsableCss] = useState('');
    const [isPreviewFullscreen, setIsPreviewFullscreen] = useState(false);
    const [assetUrlDraft, setAssetUrlDraft] = useState<Record<'bg' | 'deco' | 'avatarDeco', string>>({ bg: '', deco: '', avatarDeco: '' });
    
    // Local state for sliders
    const [paddingVal, setPaddingVal] = useState(12);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const decorationInputRef = useRef<HTMLInputElement>(null);
    const avatarDecoInputRef = useRef<HTMLInputElement>(null);
    const cssTextareaRef = useRef<HTMLTextAreaElement>(null);

    const activeStyle = editingTheme[activeTab === 'css' ? 'user' : activeTab];
    const CONTRAST_LOW_THRESHOLD = 4.5;
    const CONTRAST_CRITICAL_THRESHOLD = 3;
    const HIGH_BG_IMAGE_OPACITY = 0.75;
    const cssValidation = useMemo(() => validateCustomCss(editingTheme.customCss || ''), [editingTheme.customCss]);

    useEffect(() => {
        if (cssValidation.isValid) {
            setLastUsableCss(editingTheme.customCss || '');
        }
    }, [cssValidation.isValid, editingTheme.customCss]);

    const updateTheme = (
        updater: (prev: ChatTheme) => ChatTheme,
        options?: { trackHistory?: boolean; markDirty?: boolean }
    ) => {
        const trackHistory = options?.trackHistory ?? true;
        const markDirty = options?.markDirty ?? true;
        setEditingTheme(prev => {
            const next = updater(prev);
            if (next === prev) return prev;
            if (trackHistory) {
                setUndoStack(history => [...history, cloneTheme(prev)]);
                setRedoStack([]);
            }
            if (markDirty) {
                setIsDirty(true);
                setIsAppliedToPreview(false);
            }
            return next;
        });
    };

    const withDiscardGuard = (action: () => void) => {
        if (!isDirty) { action(); return; }
        setPendingDiscardAction(() => action);
    };

    const requestTabSwitch = (target: 'user' | 'ai' | 'css') => {
        if (target === activeTab) return;
        setActiveTab(target);
    };

    const requestToolSectionSwitch = (target: 'base' | 'sticker' | 'avatar') => {
        if (target === toolSection) return;
        setToolSection(target);
    };

    const requestClose = () => withDiscardGuard(() => exitView());

    // Initialize padding state from CSS on load
    useEffect(() => {
        if (editingTheme.customCss) {
            setPaddingVal(extractPaddingFromCss(editingTheme.customCss));
        }
    }, []);

    const updateStyle = (key: keyof BubbleStyle, value: any) => {
        if (activeTab === 'css') return;
        updateTheme(prev => ({
            ...prev,
            [activeTab]: {
                ...prev[activeTab as 'user' | 'ai'],
                [key]: value
            },
            ...(userFollowAi && activeTab === 'ai'
                ? {
                    user: {
                        ...prev.user,
                        [key]: value
                    }
                }
                : {})
        }));
    };

    const updateColorWithAlpha = (newHex: string, newAlpha: number) => {
        const val = newAlpha === 1 ? newHex : toRgbaString(newHex, newAlpha);
        updateStyle('backgroundColor', val);
    };

    const updatePadding = (val: number) => {
        setPaddingVal(val);
        const newCss = injectPaddingCss(editingTheme.customCss || '', val);
        updateTheme(prev => ({ ...prev, customCss: newCss }));
    };

    const handleImageUpload = async (file: File, type: 'bg' | 'deco' | 'avatarDeco') => {
        try {
            const result = await processImage(file);
            if (type === 'bg') updateStyle('backgroundImage', result);
            else if (type === 'deco') updateStyle('decoration', result);
            else if (type === 'avatarDeco') updateStyle('avatarDecoration', result);
            addToast('图片贴好了', 'success');
        } catch (e: any) {
            addToast(e.message, 'error');
        }
    };

    const handleUrlApply = (type: 'bg' | 'deco' | 'avatarDeco') => {
        const url = assetUrlDraft[type].trim();
        if (!url) {
            addToast('先贴一条图床 URL 进来', 'error');
            return;
        }
        if (!isValidHttpImageUrl(url)) {
            addToast('这条 URL 不对，要 http(s) 开头的图床地址', 'error');
            return;
        }

        if (type === 'bg') updateStyle('backgroundImage', url);
        else if (type === 'deco') updateStyle('decoration', url);
        else updateStyle('avatarDecoration', url);

        setAssetUrlDraft(prev => ({ ...prev, [type]: '' }));
        addToast('图床图片贴好了', 'success');
    };

    const doSaveTheme = (exitAfterSave: boolean) => {
        addCustomTheme(editingTheme);
        setLastSavedTheme(cloneTheme(editingTheme));
        setIsDirty(false);
        setIsAppliedToPreview(true);
        addToast('已贴好并应用到当前聊天', 'success');
        if (exitAfterSave) exitView();
    };

    const saveTheme = ({ exitAfterSave }: { exitAfterSave: boolean }) => {
        if (!editingTheme.name.trim()) return;
        const renderability = runCssRenderabilityCheck(editingTheme.customCss || '', cssValidation);
        if (!renderability.ok) {
            addToast(renderability.message, 'error');
            return;
        }
        if (overallContrastScore.ratio < CONTRAST_CRITICAL_THRESHOLD) {
            setPendingSaveExit(exitAfterSave);
            setShowLowContrastConfirm(true);
            return;
        }
        doSaveTheme(exitAfterSave);
    };

    const insertCssSnippet = (snippet: CssSnippet) => {
        const textarea = cssTextareaRef.current;
        const currentCss = editingTheme.customCss || '';
        if (!textarea) {
            updateTheme(prev => ({ ...prev, customCss: `${currentCss}${currentCss.endsWith('\n') || !currentCss ? '' : '\n'}${snippet.code}\n` }));
            return;
        }

        const start = textarea.selectionStart ?? currentCss.length;
        const end = textarea.selectionEnd ?? currentCss.length;
        const insertContent = `${start === 0 ? '' : '\n'}${snippet.code}\n`;
        const nextCss = `${currentCss.slice(0, start)}${insertContent}${currentCss.slice(end)}`;
        updateTheme(prev => ({ ...prev, customCss: nextCss }));
        requestAnimationFrame(() => {
            const cursor = start + insertContent.length;
            textarea.focus();
            textarea.setSelectionRange(cursor, cursor);
        });
    };

    const restoreLastUsableCss = () => {
        if ((editingTheme.customCss || '') === lastUsableCss) {
            addToast('已经是上次能用的那版了', 'success');
            return;
        }
        updateTheme(prev => ({ ...prev, customCss: lastUsableCss }));
        addToast('撕回上次能用的那版了', 'success');
    };

    const applyTemplate = (template: StyleTemplate) => {
        updateTheme(prev => ({
            ...prev,
            user: { ...prev.user, ...template.user },
            ai: { ...prev.ai, ...template.ai },
            customCss: injectShadowCss(prev.customCss || '', template.userShadow, template.aiShadow)
        }));
        addToast(`贴上「${template.name}」样张`, 'success');
    };

    const randomizeMonochrome = () => {
        const baseHue = Math.floor(Math.random() * 360);
        const hueShift = Math.floor(Math.random() * 18) - 9;
        const aiHue = (baseHue + hueShift + 360) % 360;
        const userBg = hslToHex(baseHue, 68, 48);
        const aiBg = hslToHex(aiHue, 54, 84);
        const userAlpha = 0.88;
        const aiAlpha = 0.85;
        const userText = '#f8fafc';
        const aiText = '#0f172a';
        updateTheme(prev => ({
            ...prev,
            user: {
                ...prev.user,
                backgroundColor: toRgbaString(userBg, userAlpha),
                textColor: userText,
                borderRadius: 20,
                backgroundImageOpacity: 0.4
            },
            ai: {
                ...prev.ai,
                backgroundColor: toRgbaString(aiBg, aiAlpha),
                textColor: aiText,
                borderRadius: 16,
                backgroundImageOpacity: 0.35
            }
        }));
        addToast('掷出一组同色系', 'success');
    };

    const mirrorToOtherBubble = () => {
        if (activeTab === 'css') return;
        const sourceKey = activeTab;
        const targetKey = activeTab === 'user' ? 'ai' : 'user';
        updateTheme(prev => ({
            ...prev,
            [targetKey]: {
                ...prev[targetKey],
                ...prev[sourceKey]
            }
        }));
        addToast('拓到另一侧了', 'success');
    };

    const currentScene = useMemo(
        () => PREVIEW_SCENES.find(scene => scene.id === previewSceneId) || PREVIEW_SCENES[0],
        [previewSceneId]
    );

    const previewBgHex = useMemo(() => {
        if (currentScene.darkMode || isPreviewDark) return '#0f172a';
        return '#f1f5f9';
    }, [currentScene.darkMode, isPreviewDark]);

    const contrastScores = useMemo(() => {
        const userRatio = getContrastRatio(editingTheme.user.textColor, editingTheme.user.backgroundColor, previewBgHex);
        const aiRatio = getContrastRatio(editingTheme.ai.textColor, editingTheme.ai.backgroundColor, previewBgHex);
        return {
            user: { ratio: userRatio, grade: getContrastGrade(userRatio) },
            ai: { ratio: aiRatio, grade: getContrastGrade(aiRatio) }
        };
    }, [editingTheme.user.textColor, editingTheme.user.backgroundColor, editingTheme.ai.textColor, editingTheme.ai.backgroundColor, previewBgHex]);

    const overallContrastScore = useMemo(() => {
        return contrastScores.user.ratio <= contrastScores.ai.ratio
            ? { ...contrastScores.user, role: 'user' as const }
            : { ...contrastScores.ai, role: 'ai' as const };
    }, [contrastScores]);

    const activeContrastScore = activeTab === 'ai' ? contrastScores.ai : contrastScores.user;
    const showLowContrastWarning = activeTab !== 'css' && activeContrastScore.ratio < CONTRAST_LOW_THRESHOLD;
    const showCombinedRisk = activeTab !== 'css'
        && (activeStyle.backgroundImageOpacity ?? 0) >= HIGH_BG_IMAGE_OPACITY
        && activeContrastScore.ratio < CONTRAST_LOW_THRESHOLD;

    const oneClickFixContrast = () => {
        if (activeTab === 'css') return;
        const betterTextColor = getReadableTextColor(activeStyle.backgroundColor, previewBgHex);
        updateTheme(prev => ({
            ...prev,
            [activeTab]: {
                ...prev[activeTab],
                textColor: betterTextColor,
                backgroundImageOpacity: Math.min(prev[activeTab].backgroundImageOpacity ?? 0.5, 0.55)
            }
        }));
        addToast('字色已自动调清', 'success');
    };

    useEffect(() => {
        setIsPreviewDark(!!currentScene.darkMode);
    }, [currentScene.id]);

    const handleUndo = () => {
        if (undoStack.length === 0) return;
        const previous = undoStack[undoStack.length - 1];
        const nextUndo = undoStack.slice(0, -1);
        setUndoStack(nextUndo);
        setRedoStack(stack => [...stack, cloneTheme(editingTheme)]);
        setEditingTheme(cloneTheme(previous));
        setIsDirty(true);
        setIsAppliedToPreview(false);
    };

    const handleRedo = () => {
        if (redoStack.length === 0) return;
        const next = redoStack[redoStack.length - 1];
        const nextRedo = redoStack.slice(0, -1);
        setRedoStack(nextRedo);
        setUndoStack(stack => [...stack, cloneTheme(editingTheme)]);
        setEditingTheme(cloneTheme(next));
        setIsDirty(true);
        setIsAppliedToPreview(false);
    };

    const renderPreviewBubble = (mock: PreviewMockMessage, theme: ChatTheme, panel: 'A' | 'B') => {
        const role = mock.role;
        const style = role === 'user' ? theme.user : theme.ai;
        const isUser = role === 'user';
        const isActive = panel === 'A' && (activeTab === role || activeTab === 'css');
        
        // Match core bubble corner strategy in MessageItem.tsx
        const containerStyle = {
            backgroundColor: style.backgroundColor,
            borderRadius: `${style.borderRadius}px`,
            opacity: style.opacity,
            borderBottomLeftRadius: isUser ? `${style.borderRadius}px` : '4px',
            borderBottomRightRadius: isUser ? '4px' : `${style.borderRadius}px`,
            borderTopLeftRadius: `${style.borderRadius}px`,
            borderTopRightRadius: `${style.borderRadius}px`,
        };

        return (
            <div 
                className={`relative w-full flex items-end transition-all duration-300 cursor-pointer opacity-100 scale-100 ${isUser ? 'justify-end' : 'justify-start'}`}
                onClick={() => panel === 'A' && requestTabSwitch(role)}
                title={panel === 'A' ? `点一下裁剪${isUser ? '我方' : '对方'}气泡` : '上一次贴好的版本'}
            >
                {/* Avatar + decoration: align with MessageItem layering */}
                <div className={`absolute bottom-0 ${isUser ? 'right-0' : 'left-0'} w-9 h-9 z-10`}>
                    <div className="w-full h-full rounded-full bg-slate-300 overflow-hidden relative z-0 shadow-sm ring-1 ring-black/5">
                         <div className="absolute inset-0 flex items-center justify-center text-white/50 font-bold text-[10px]">{isUser ? 'ME' : 'AI'}</div>
                    </div>
                    {style.avatarDecoration && (
                        <img 
                            src={style.avatarDecoration}
                            className="absolute pointer-events-none z-10 max-w-none"
                            style={{
                                left: `${style.avatarDecorationX ?? 50}%`,
                                top: `${style.avatarDecorationY ?? 50}%`,
                                width: `${36 * (style.avatarDecorationScale ?? 1)}px`, 
                                height: 'auto',
                                transform: `translate(-50%, -50%) rotate(${style.avatarDecorationRotate ?? 0}deg)`,
                            }}
                        />
                    )}
                </div>

                <div className={`relative group max-w-[78%] ${isUser ? 'mr-12' : 'ml-12'}`}>
                    {style.decoration && (
                        <img 
                            src={style.decoration} 
                            className="absolute z-10 w-8 h-8 object-contain drop-shadow-sm pointer-events-none"
                            style={{
                                left: `${style.decorationX ?? (isUser ? 90 : 10)}%`,
                                top: `${style.decorationY ?? -10}%`,
                                transform: `translate(-50%, -50%) scale(${style.decorationScale ?? 1}) rotate(${style.decorationRotate ?? 0}deg)`
                            }}
                        />
                    )}

                    <div
                        className={`relative px-5 py-3 shadow-sm border border-black/5 text-sm overflow-visible ${isUser ? 'moro-bubble-user' : 'moro-bubble-ai'} ${isActive ? 'ring-2 ring-[#2b2933]' : ''}`}
                        style={containerStyle}
                    >
                        {showPreviewBgImage && style.backgroundImage && (
                            <div 
                                className="absolute inset-0 bg-cover bg-center pointer-events-none z-0"
                                style={{ 
                                    backgroundImage: `url(${style.backgroundImage})`,
                                    opacity: style.backgroundImageOpacity ?? 0.5,
                                    borderRadius: 'inherit'
                                }}
                            ></div>
                        )}
                        {mock.replyTo && (
                            <div className="relative z-10 mb-1 text-[10px] bg-black/5 p-1.5 rounded-md border-l-2 border-current opacity-60 flex flex-col gap-0.5 max-w-full overflow-hidden">
                                <span className="font-bold opacity-90 truncate">{mock.replyTo.name}</span>
                                <span className="truncate italic">"{mock.replyTo.content}"</span>
                            </div>
                        )}

                        {mock.kind === 'image' ? (
                            <div className="relative z-10 w-40 h-28 rounded-xl bg-black/10 border border-black/10 flex items-center justify-center text-xs" style={{ color: style.textColor }}>
                                🖼️ 图片占位
                            </div>
                        ) : mock.kind === 'emoji' ? (
                            <div className="relative z-10 text-3xl leading-none">{mock.content}</div>
                        ) : (
                            <div className="relative z-10 text-[15px] leading-relaxed whitespace-pre-wrap break-all" style={{ color: style.textColor }}>
                                {mock.content}
                            </div>
                        )}

                        {isActive && (
                            <div className="absolute -top-2.5 left-3 px-2 py-0.5 bg-[#2b2933] text-[#fbfaf7] text-[9px] font-bold tracking-wider z-20 label-mono -rotate-2 shadow-[2px_2px_0_rgba(43,41,51,0.35)]">
                                正在裁 · {isUser ? '我方' : '对方'}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    const parsedBgColor = parseColorValue(activeStyle.backgroundColor);

    return (
        <div className="h-full w-full bg-[#f4f2ed] flex flex-col font-light relative">
            {/* Header —— 手账封面条：墨色横线收口 */}
            <div className="h-20 bg-[#fbfaf7] flex items-end pb-3 px-4 border-b-2 border-[#2b2933] shrink-0 z-20 justify-between">
                <div className="flex items-center gap-3">
                    <button onClick={requestClose} className="w-9 h-9 border-2 border-[#2b2933] bg-[#fbfaf7] flex items-center justify-center active:translate-x-[1px] active:translate-y-[1px] transition-transform shadow-[2px_2px_0_#2b2933]">
                        <span className="text-[#2b2933] text-lg leading-none -mt-0.5">‹</span>
                    </button>
                    <div className="flex flex-col">
                        <h1 className="text-2xl text-[#2b2933] font-display-italic leading-none">气泡裁剪台</h1>
                        <div className="text-[9px] flex items-center gap-1.5 text-[#8b8996] label-mono mt-1">
                            <span className={`inline-flex w-2 h-2 ${isAppliedToPreview && !isDirty ? 'bg-[#2b2933]' : 'bg-transparent border border-[#2b2933]'}`}></span>
                            {isAppliedToPreview && !isDirty ? '已贴入当前预览' : '草稿未贴入'}
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={() => saveTheme({ exitAfterSave: false })} className="px-4 py-2 bg-[#2b2933] text-[#fbfaf7] text-xs font-bold label-mono shadow-[3px_3px_0_rgba(43,41,51,0.3)] active:translate-x-[1px] active:translate-y-[1px] transition-transform -rotate-1">
                        贴好 · 应用
                    </button>
                </div>
            </div>

            {/* Preview Area (Realistic Chat Row) */}
            <div className={`${isPreviewFullscreen ? 'fixed inset-0 z-[120]' : 'flex-1'} relative overflow-hidden flex flex-col p-4 justify-center items-center gap-4 ${isPreviewDark ? 'bg-slate-900' : 'bg-slate-100'}`}>
                <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(#cbd5e1 1px, transparent 1px)', backgroundSize: '20px 20px' }}></div>
                {currentScene.wallpaper && (
                    <div className="absolute inset-0" style={{ background: currentScene.wallpaper, opacity: isPreviewDark ? 0.9 : 0.45 }} />
                )}
                
                {/* Live CSS Injection for Preview */}
                {editingTheme.customCss && <style>{editingTheme.customCss}</style>}

                <div className="w-full max-w-sm relative z-10 bg-[#fbfaf7] p-3 border-2 border-[#2b2933] shadow-[4px_4px_0_rgba(43,41,51,0.25)] rotate-[-0.4deg]">
                    <div className={`absolute right-3 top-3 px-2.5 py-1 text-[10px] font-bold label-mono border-2 border-[#2b2933] ${overallContrastScore.grade === 'A' ? 'bg-[#2b2933] text-[#fbfaf7]' : overallContrastScore.grade === 'B' ? 'bg-[#fbfaf7] text-[#2b2933]' : 'bg-[#fbfaf7] text-[#2b2933] border-dashed'}`}>
                        清晰度 {overallContrastScore.grade}
                    </div>
                    <div className="text-[8px] label-mono text-[#8b8996] mb-2">取景框</div>
                    <div className="flex flex-wrap gap-1.5 mb-3">
                        {PREVIEW_SCENES.map(scene => (
                            <button
                                key={scene.id}
                                onClick={() => setPreviewSceneId(scene.id)}
                                className={`px-2.5 py-1 text-[11px] border transition-all ${previewSceneId === scene.id ? 'bg-[#2b2933] text-[#fbfaf7] border-[#2b2933]' : 'bg-[#fbfaf7] text-[#6b6b6b] border-[#2b2933]/30 hover:border-[#2b2933]'}`}
                            >
                                {scene.name}
                            </button>
                        ))}
                    </div>

                    <div className="flex flex-wrap gap-3 text-[11px] text-[#6b6b6b] mb-2">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                            <input type="checkbox" checked={showPreviewBgImage} onChange={(e) => setShowPreviewBgImage(e.target.checked)} className="accent-[#2b2933]" />
                            显示底图层
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                            <input type="checkbox" checked={isPreviewDark} onChange={(e) => setIsPreviewDark(e.target.checked)} className="accent-[#2b2933]" />
                            暗底背景
                        </label>
                    </div>

                    <div className="flex items-center justify-end mb-2">
                        <button
                            onClick={() => setIsPreviewFullscreen(prev => !prev)}
                            className="px-2.5 py-1 text-[11px] border border-[#2b2933]/40 bg-[#fbfaf7] text-[#2b2933] hover:border-[#2b2933] transition-colors"
                        >
                            {isPreviewFullscreen ? '收起整页' : '摊开整页'}
                        </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className="text-[#8b8996] label-mono text-[9px]">对照</span>
                        <button onClick={() => setPreviewCompareMode('single')} className={`px-2 py-1 border ${previewCompareMode === 'single' ? 'bg-[#2b2933] text-[#fbfaf7] border-[#2b2933]' : 'bg-[#fbfaf7] text-[#6b6b6b] border-[#2b2933]/30'}`}>单张</button>
                        <button onClick={() => setPreviewCompareMode('split')} className={`px-2 py-1 border ${previewCompareMode === 'split' ? 'bg-[#2b2933] text-[#fbfaf7] border-[#2b2933]' : 'bg-[#fbfaf7] text-[#6b6b6b] border-[#2b2933]/30'}`}>并排</button>
                        <button onClick={() => setPreviewCompareMode('toggle')} className={`px-2 py-1 border ${previewCompareMode === 'toggle' ? 'bg-[#2b2933] text-[#fbfaf7] border-[#2b2933]' : 'bg-[#fbfaf7] text-[#6b6b6b] border-[#2b2933]/30'}`}>翻面</button>
                        {previewCompareMode === 'toggle' && (
                            <div className="flex items-center gap-1">
                                <button onClick={() => setPreviewToggleTarget('A')} className={`px-2 py-1 border ${previewToggleTarget === 'A' ? 'bg-[#2b2933] text-[#fbfaf7] border-[#2b2933]' : 'bg-[#fbfaf7] text-[#6b6b6b] border-[#2b2933]/30'}`}>A 草稿</button>
                                <button onClick={() => setPreviewToggleTarget('B')} className={`px-2 py-1 border ${previewToggleTarget === 'B' ? 'bg-[#2b2933] text-[#fbfaf7] border-[#2b2933]' : 'bg-[#fbfaf7] text-[#6b6b6b] border-[#2b2933]/30'}`}>B 存档</button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Simulated Chat Conversation */}
                {previewCompareMode === 'split' ? (
                    <div className="w-full max-w-3xl grid grid-cols-1 md:grid-cols-2 gap-3 relative z-10">
                        {[{ label: 'A 草稿', theme: editingTheme, panel: 'A' as const }, { label: 'B 存档', theme: lastSavedTheme, panel: 'B' as const }].map(item => (
                            <div key={item.label} className={`space-y-4 p-4 border-2 ${isPreviewDark ? 'bg-slate-950/60 border-white/20' : 'bg-[#fbfaf7]/80 border-[#2b2933]'}`}>
                                <div className="text-[9px] label-mono text-[#8b8996]">{item.label}</div>
                                {currentScene.messages.map(msg => (
                                    <div key={`${item.panel}-${msg.id}`}>{renderPreviewBubble(msg, item.theme, item.panel)}</div>
                                ))}
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className={`w-full max-w-sm space-y-4 p-4 relative z-10 border-2 ${isPreviewDark ? 'bg-slate-950/60 border-white/20' : 'bg-[#fbfaf7]/80 border-[#2b2933]'}`}>
                        {currentScene.messages.map(msg => (
                            <div key={msg.id}>{renderPreviewBubble(msg, previewCompareMode === 'toggle' && previewToggleTarget === 'B' ? lastSavedTheme : editingTheme, previewCompareMode === 'toggle' && previewToggleTarget === 'B' ? 'B' : 'A')}</div>
                        ))}
                    </div>
                )}
                
                <div className={`text-[9px] label-mono absolute bottom-2 ${isPreviewDark ? 'text-slate-400' : 'text-[#8b8996]'}`}>A=草稿 · B=上次贴好的存档</div>
            </div>

            {/* Editor Controls */}
            {!isPreviewFullscreen && (
            <div className="bg-[#fbfaf7] rounded-t-[2rem] shadow-[0_-6px_0_#2b2933] border-t-2 border-x-2 border-[#2b2933] z-30 flex flex-col h-[55%]">
                {/* Main Tabs (User / AI / CSS) —— 手账纸折页签 */}
                <div className="flex px-8 pt-6 pb-2 gap-5 overflow-x-auto no-scrollbar">
                    <button onClick={() => requestTabSwitch('user')} className={`text-base font-bold font-display-italic transition-colors whitespace-nowrap ${activeTab === 'user' ? 'text-[#2b2933] underline decoration-2 underline-offset-4' : 'text-[#c4c1b8]'}`}>我方气泡</button>
                    <button onClick={() => requestTabSwitch('ai')} className={`text-base font-bold font-display-italic transition-colors whitespace-nowrap ${activeTab === 'ai' ? 'text-[#2b2933] underline decoration-2 underline-offset-4' : 'text-[#c4c1b8]'}`}>对方气泡</button>
                    <button onClick={() => requestTabSwitch('css')} className={`text-base font-bold font-display-italic transition-colors whitespace-nowrap flex items-center gap-1 ${activeTab === 'css' ? 'text-[#2b2933] underline decoration-2 underline-offset-4' : 'text-[#c4c1b8]'}`}>
                        <span>✎</span> 手写码
                    </button>
                </div>

                <div className="px-8 pb-2 flex items-center gap-2">
                    <button onClick={handleUndo} disabled={undoStack.length === 0} className="text-[11px] px-2.5 py-1 border border-[#2b2933]/40 bg-[#fbfaf7] text-[#2b2933] disabled:opacity-30">↶ 撤回</button>
                    <button onClick={handleRedo} disabled={redoStack.length === 0} className="text-[11px] px-2.5 py-1 border border-[#2b2933]/40 bg-[#fbfaf7] text-[#2b2933] disabled:opacity-30">↷ 重来</button>
                </div>

                {/* Conditional Sub-Tool Tabs */}
                {activeTab !== 'css' && (
                    <div className="flex px-6 border-b-2 border-[#2b2933] mb-2 overflow-x-auto no-scrollbar gap-1">
                        <button onClick={() => requestToolSectionSwitch('base')} className={`px-4 py-2 text-[11px] font-bold label-mono transition-all shrink-0 -mb-[2px] border-2 ${toolSection === 'base' ? 'border-[#2b2933] border-b-[#fbfaf7] bg-[#fbfaf7] text-[#2b2933]' : 'border-transparent text-[#8b8996]'}`}>底样</button>
                        <button onClick={() => requestToolSectionSwitch('sticker')} className={`px-4 py-2 text-[11px] font-bold label-mono transition-all shrink-0 -mb-[2px] border-2 ${toolSection === 'sticker' ? 'border-[#2b2933] border-b-[#fbfaf7] bg-[#fbfaf7] text-[#2b2933]' : 'border-transparent text-[#8b8996]'}`}>贴纸</button>
                        <button onClick={() => requestToolSectionSwitch('avatar')} className={`px-4 py-2 text-[11px] font-bold label-mono transition-all shrink-0 -mb-[2px] border-2 ${toolSection === 'avatar' ? 'border-[#2b2933] border-b-[#fbfaf7] bg-[#fbfaf7] text-[#2b2933]' : 'border-transparent text-[#8b8996]'}`}>挂件</button>
                    </div>
                )}

                <div className="flex-1 overflow-y-auto p-6 space-y-6 no-scrollbar pb-20">
                    
                    {/* --- CSS EDITOR --- */}
                    {activeTab === 'css' && (
                        <div className="space-y-6 animate-fade-in h-full flex flex-col">
                            <div className="text-[10px] text-[#6b6b6b] bg-[#f4f2ed] p-3 border border-dashed border-[#2b2933]/40 leading-relaxed space-y-2">
                                <span className="font-bold block mb-1 text-[#2b2933] label-mono">手写码 · 增强</span>
                                贴上类名 <code className="bg-[#2b2933] text-[#fbfaf7] px-1">.moro-bubble-user</code> 与 <code className="bg-[#2b2933] text-[#fbfaf7] px-1">.moro-bubble-ai</code> 即可统一裱糊两侧气泡。
                                <br/>加 <code className="text-[#2b2933] font-bold">!important</code> 可盖过上面可视面板的设置。
                                <div className="border-2 border-[#2b2933] bg-[#fbfaf7] px-2.5 py-2 text-[10px] text-[#2b2933]">
                                    <div className="font-bold label-mono">叠放次序：面板底样 vs 手写码</div>
                                    <div>① 上方滑杆/取色先打底；② 手写码随后覆上；③ <code>!important</code> 只对命中的属性强行压住，盖过面板里的同名设置。</div>
                                </div>
                                <div className="flex items-center justify-between gap-2 border-2 border-[#2b2933] bg-[#fbfaf7] px-2.5 py-2">
                                    <div>
                                        <div className={`text-[10px] font-bold label-mono ${cssValidation.isValid ? 'text-[#2b2933]' : 'text-[#2b2933]'}`}>
                                            {cssValidation.isValid ? '✓ 语法通顺' : '✗ 语法卡壳'}
                                        </div>
                                        <div className="text-[10px] text-[#6b6b6b]">数到 <code className="text-[#2b2933] font-bold">!important</code> {cssValidation.importantCount} 处</div>
                                    </div>
                                    <button
                                        onClick={restoreLastUsableCss}
                                        disabled={(editingTheme.customCss || '') === lastUsableCss}
                                        className="text-[10px] px-2.5 py-1 border border-[#2b2933] bg-[#fbfaf7] text-[#2b2933] disabled:opacity-40"
                                    >
                                        撕回上次能用的
                                    </button>
                                </div>
                            </div>

                            <textarea
                                ref={cssTextareaRef}
                                value={editingTheme.customCss || ''}
                                onChange={(e) => updateTheme(prev => ({ ...prev, customCss: e.target.value }))}
                                placeholder="/* 在这张纸上手写 CSS */"
                                className="flex-1 w-full bg-[#2b2933] text-[#f4f2ed] font-mono text-xs p-4 resize-none border-2 border-[#2b2933] focus:ring-2 focus:ring-[#2b2933] outline-none leading-relaxed"
                                spellCheck={false}
                            />

                            {!cssValidation.isValid && (
                                <div className="text-[11px] border-2 border-[#2b2933] border-dashed bg-[#f4f2ed] px-3 py-2 text-[#2b2933]">
                                    <div className="font-bold mb-1 label-mono">卡壳处（实时标注）</div>
                                    <ul className="space-y-1 list-disc pl-4">
                                        {cssValidation.errors.map((error, idx) => (
                                            <li key={`${error}-${idx}`}>
                                                {cssValidation.errorLines[idx] ? `第 ${cssValidation.errorLines[idx]} 行：` : ''}{error}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            <div>
                                <label className="text-[10px] font-bold text-[#8b8996] label-mono block mb-2">限定贴片（只贴 .moro-bubble-user/.moro-bubble-ai）</label>
                                <div className="grid grid-cols-2 gap-2">
                                    {CSS_SCOPE_SNIPPETS.map(snippet => (
                                        <button
                                            key={snippet.id}
                                            onClick={() => insertCssSnippet(snippet)}
                                            className="text-left p-2.5 border-2 border-[#2b2933]/30 bg-[#fbfaf7] hover:border-[#2b2933] hover:shadow-[2px_2px_0_#2b2933] transition-all"
                                        >
                                            <div className="text-xs font-bold text-[#2b2933]">{snippet.name}</div>
                                            <div className="text-[10px] text-[#6b6b6b] mt-1">{snippet.description}</div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <label className="text-[10px] font-bold text-[#8b8996] label-mono block mb-2">整页样张</label>
                                <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
                                    {CSS_EXAMPLES.map((ex, i) => (
                                        <button
                                            key={i}
                                            onClick={() => updateTheme(prev => ({ ...prev, customCss: ex.code }))}
                                            className="px-3 py-2 bg-[#fbfaf7] hover:bg-[#2b2933] hover:text-[#fbfaf7] text-xs font-mono text-[#2b2933] border border-[#2b2933] whitespace-nowrap transition-colors"
                                        >
                                            {ex.name}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* --- BASE STYLE TOOLS --- */}
                    {activeTab !== 'css' && toolSection === 'base' && (
                        <div className="space-y-6 animate-fade-in">
                            {/* Name Input (Only on Base) */}
                            <div>
                                <label className="text-[10px] font-bold text-[#8b8996] label-mono block mb-2">这页贴纸叫什么</label>
                                <input value={editingTheme.name} onChange={(e) => updateTheme(prev => ({ ...prev, name: e.target.value }), { trackHistory: false })} className="w-full bg-[#fbfaf7] border-2 border-[#2b2933] px-3 py-2 text-sm focus:shadow-[2px_2px_0_#2b2933] transition-all outline-none" placeholder="给这页起个名" />
                            </div>

                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <label className="text-[10px] font-bold text-[#8b8996] label-mono">现成样张</label>
                                    <button onClick={randomizeMonochrome} className="text-[10px] px-2.5 py-1 border border-[#2b2933] bg-[#fbfaf7] text-[#2b2933] hover:bg-[#2b2933] hover:text-[#fbfaf7]">掷骰 · 同色系</button>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    {STYLE_TEMPLATES.map(template => (
                                        <button
                                            key={template.id}
                                            onClick={() => applyTemplate(template)}
                                            className="text-left p-2.5 border-2 border-[#2b2933]/30 bg-[#fbfaf7] hover:border-[#2b2933] hover:shadow-[2px_2px_0_#2b2933] transition-all"
                                        >
                                            <div className="text-xs font-bold text-[#2b2933]">{template.name}</div>
                                            <div className="text-[10px] text-[#6b6b6b] mt-1">{template.description}</div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="border-2 border-dashed border-[#2b2933]/40 bg-[#f4f2ed] p-3">
                                <div className="text-[10px] font-bold text-[#8b8996] label-mono mb-2">联动</div>
                                <div className="flex items-center gap-2 flex-wrap">
                                    <label className="text-xs text-[#2b2933] flex items-center gap-2">
                                        <input type="checkbox" checked={userFollowAi} onChange={(e) => setUserFollowAi(e.target.checked)} className="accent-[#2b2933]" />
                                        我方跟着对方一起变
                                    </label>
                                    <button onClick={mirrorToOtherBubble} className="text-[10px] px-2.5 py-1 bg-[#fbfaf7] border border-[#2b2933] hover:bg-[#2b2933] hover:text-[#fbfaf7]">拓到另一侧</button>
                                </div>
                            </div>

                            {/* 对比度提示：外层已限定 activeTab !== 'css' && toolSection === 'base'，此处无需重复判断 */}
                            <div className={`border-2 p-3 ${showLowContrastWarning ? 'border-[#2b2933] border-dashed bg-[#f4f2ed]' : 'border-[#2b2933] bg-[#fbfaf7]'}`}>
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div>
                                            <div className="text-[11px] font-bold text-[#2b2933] label-mono">清晰度 {activeContrastScore.grade} · {activeContrastScore.ratio.toFixed(2)}:1</div>
                                            <div className="text-[10px] mt-1 text-[#6b6b6b]">
                                                {showLowContrastWarning ? '字和底太接近了，读起来费劲，建议拉开对比。' : '字和底对比舒服，读得清。'}
                                            </div>
                                        </div>
                                        {showLowContrastWarning && (
                                            <button onClick={oneClickFixContrast} className="text-[10px] px-2.5 py-1 bg-[#2b2933] text-[#fbfaf7] font-bold label-mono hover:opacity-80 transition-opacity">
                                                一键调清
                                            </button>
                                        )}
                                    </div>
                                    {showCombinedRisk && (
                                        <div className="mt-2 text-[10px] text-[#2b2933] font-bold border-t border-dashed border-[#2b2933]/40 pt-2">
                                            叠加风险：底图太显 + 对比不足，复杂壁纸上可能看不清。
                                        </div>
                                    )}
                                </div>

                            {/* Colors & Opacity */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <div className="flex items-center justify-between mb-2"><label className="text-[10px] font-bold text-[#8b8996] label-mono">字色</label><span className="text-[9px] px-1.5 py-0.5 border border-[#2b2933] text-[#2b2933]">自动配</span></div>
                                    <div className="flex items-center gap-2 bg-[#fbfaf7] p-2 border-2 border-[#2b2933]"><input type="color" value={activeStyle.textColor} onChange={(e) => updateStyle('textColor', e.target.value)} className="w-8 h-8 border-none cursor-pointer bg-transparent" /></div>
                                </div>
                                <div>
                                    <div className="flex items-center justify-between mb-2"><label className="text-[10px] font-bold text-[#8b8996] label-mono">气泡底色</label><span className="text-[9px] px-1.5 py-0.5 border border-[#2b2933] text-[#2b2933]">同色系</span></div>
                                    <div className="flex items-center gap-2 bg-[#fbfaf7] p-2 border-2 border-[#2b2933]">
                                        <input
                                            type="color"
                                            value={parsedBgColor.hex}
                                            onChange={(e) => updateColorWithAlpha(e.target.value, parsedBgColor.alpha)}
                                            className="w-8 h-8 border-none cursor-pointer bg-transparent"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Background Alpha (Transparency) */}
                            <div>
                                <div className="flex justify-between mb-2">
                                    <label className="text-[10px] font-bold text-[#8b8996] label-mono">底色透明度</label>
                                    <span className="text-[9px] px-1.5 py-0.5 border border-[#2b2933] text-[#2b2933]">约 85%</span>
                                </div>
                                <input
                                    type="range" min="0" max="1" step="0.05"
                                    value={parsedBgColor.alpha}
                                    onChange={(e) => updateColorWithAlpha(parsedBgColor.hex, parseFloat(e.target.value))}
                                    className="w-full h-1.5 bg-[#e3e0d6] rounded-full appearance-none cursor-pointer accent-[#2b2933]"
                                />
                            </div>

                            {/* Padding (Compactness) */}
                            <div>
                                <div className="flex justify-between mb-2">
                                    <label className="text-[10px] font-bold text-[#8b8996] label-mono">气泡留白</label>
                                    <span className="text-[9px] px-1.5 py-0.5 border border-[#2b2933] text-[#2b2933]">约 12</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] text-[#8b8996]">挤</span>
                                    <input
                                        type="range" min="4" max="24" step="1"
                                        value={paddingVal}
                                        onChange={(e) => updatePadding(parseInt(e.target.value))}
                                        className="flex-1 h-1.5 bg-[#e3e0d6] rounded-full appearance-none cursor-pointer accent-[#2b2933]"
                                    />
                                    <span className="text-[10px] text-[#8b8996]">松</span>
                                </div>
                            </div>

                            {/* Border Radius */}
                            <div>
                                <div className="flex justify-between mb-2"><label className="text-[10px] font-bold text-[#8b8996] label-mono">圆角</label><span className="text-[9px] px-1.5 py-0.5 border border-[#2b2933] text-[#2b2933]">16 / 20</span></div>
                                <input type="range" min="0" max="30" value={activeStyle.borderRadius} onChange={(e) => updateStyle('borderRadius', parseInt(e.target.value))} className="w-full h-1.5 bg-[#e3e0d6] rounded-full appearance-none cursor-pointer accent-[#2b2933]" />
                            </div>

                            {/* Background Image Logic */}
                            <div onClick={() => fileInputRef.current?.click()} className="cursor-pointer group relative h-24 bg-[#f4f2ed] border-2 border-dashed border-[#2b2933]/50 flex flex-col items-center justify-center text-[#8b8996] overflow-hidden hover:border-[#2b2933] hover:text-[#2b2933] transition-all">
                                {activeStyle.backgroundImage ? (
                                    <>
                                        <img src={activeStyle.backgroundImage} className="absolute inset-0 w-full h-full object-cover opacity-50" />
                                        <span className="relative z-10 text-[10px] bg-[#fbfaf7] border border-[#2b2933] px-2 py-1 font-bold label-mono">换底纹</span>
                                    </>
                                ) : <span className="text-xs font-bold label-mono">＋ 贴一张底纹</span>}
                                <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={(e) => e.target.files?.[0] && handleImageUpload(e.target.files[0], 'bg')} />
                                {activeStyle.backgroundImage && <button onClick={(e) => { e.stopPropagation(); updateStyle('backgroundImage', undefined); }} className="absolute top-2 right-2 text-[10px] bg-[#2b2933] text-[#fbfaf7] px-2 py-0.5 z-20">撕掉</button>}
                            </div>
                            <div className="flex gap-2">
                                <input
                                    type="url"
                                    value={assetUrlDraft.bg}
                                    onChange={(e) => setAssetUrlDraft(prev => ({ ...prev, bg: e.target.value }))}
                                    onClick={(e) => e.stopPropagation()}
                                    placeholder="或贴一条图床 URL"
                                    className="flex-1 border-2 border-[#2b2933] bg-[#fbfaf7] px-3 py-2 text-xs text-[#2b2933] focus:outline-none focus:shadow-[2px_2px_0_#2b2933]"
                                />
                                <button onClick={() => handleUrlApply('bg')} className="px-3 py-2 bg-[#2b2933] text-[#fbfaf7] text-xs font-bold label-mono hover:opacity-80">贴上</button>
                            </div>

                            {/* Background Image Opacity */}
                            {activeStyle.backgroundImage && (
                                <div>
                                    <div className="flex justify-between mb-2"><label className="text-[10px] font-bold text-[#8b8996] label-mono">底纹透明度</label><span className="text-[9px] px-1.5 py-0.5 border border-[#2b2933] text-[#2b2933]">35%~55%</span></div>
                                    <input type="range" min="0" max="1" step="0.05" value={activeStyle.backgroundImageOpacity ?? 0.5} onChange={(e) => updateStyle('backgroundImageOpacity', parseFloat(e.target.value))} className="w-full h-1.5 bg-[#e3e0d6] rounded-full appearance-none cursor-pointer accent-[#2b2933]" />
                                </div>
                            )}
                            {/* Voice Bar Style */}
                            <div className="bg-[#fbfaf7] p-4 border-2 border-[#2b2933] shadow-[3px_3px_0_rgba(43,41,51,0.2)]">
                                <h3 className="text-[11px] font-bold text-[#2b2933] label-mono mb-3 flex items-center gap-2">
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M7 4a3 3 0 0 1 6 0v6a3 3 0 1 1-6 0V4Z" /><path d="M5.5 9.643a.75.75 0 0 0-1.5 0V10c0 3.06 2.29 5.585 5.25 5.954V17.5h-1.5a.75.75 0 0 0 0 1.5h4.5a.75.75 0 0 0 0-1.5h-1.5v-1.546A6.001 6.001 0 0 0 16 10v-.357a.75.75 0 0 0-1.5 0V10a4.5 4.5 0 0 1-9 0v-.357Z" /></svg>
                                    语音条
                                </h3>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-[10px] text-[#8b8996] block mb-1">底色</label>
                                        <div className="flex items-center gap-2">
                                            <input type="color" value={activeStyle.voiceBarBg || '#f1f5f9'} onChange={(e) => updateStyle('voiceBarBg', e.target.value)} className="w-7 h-7 border border-[#2b2933] cursor-pointer" />
                                            <span className="text-[10px] text-[#8b8996] font-mono">{activeStyle.voiceBarBg || '默认'}</span>
                                            {activeStyle.voiceBarBg && <button onClick={() => updateStyle('voiceBarBg', undefined)} className="text-[9px] text-[#2b2933] underline">还原</button>}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-[#8b8996] block mb-1">播放时底色</label>
                                        <div className="flex items-center gap-2">
                                            <input type="color" value={activeStyle.voiceBarActiveBg || '#d1fae5'} onChange={(e) => updateStyle('voiceBarActiveBg', e.target.value)} className="w-7 h-7 border border-[#2b2933] cursor-pointer" />
                                            <span className="text-[10px] text-[#8b8996] font-mono">{activeStyle.voiceBarActiveBg || '默认'}</span>
                                            {activeStyle.voiceBarActiveBg && <button onClick={() => updateStyle('voiceBarActiveBg', undefined)} className="text-[9px] text-[#2b2933] underline">还原</button>}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-[#8b8996] block mb-1">按钮色</label>
                                        <div className="flex items-center gap-2">
                                            <input type="color" value={activeStyle.voiceBarBtnColor || '#10b981'} onChange={(e) => updateStyle('voiceBarBtnColor', e.target.value)} className="w-7 h-7 border border-[#2b2933] cursor-pointer" />
                                            <span className="text-[10px] text-[#8b8996] font-mono">{activeStyle.voiceBarBtnColor || '默认'}</span>
                                            {activeStyle.voiceBarBtnColor && <button onClick={() => updateStyle('voiceBarBtnColor', undefined)} className="text-[9px] text-[#2b2933] underline">还原</button>}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-[#8b8996] block mb-1">波形色</label>
                                        <div className="flex items-center gap-2">
                                            <input type="color" value={activeStyle.voiceBarWaveColor || '#10b981'} onChange={(e) => updateStyle('voiceBarWaveColor', e.target.value)} className="w-7 h-7 border border-[#2b2933] cursor-pointer" />
                                            <span className="text-[10px] text-[#8b8996] font-mono">{activeStyle.voiceBarWaveColor || '默认'}</span>
                                            {activeStyle.voiceBarWaveColor && <button onClick={() => updateStyle('voiceBarWaveColor', undefined)} className="text-[9px] text-[#2b2933] underline">还原</button>}
                                        </div>
                                    </div>
                                    <div className="col-span-2">
                                        <label className="text-[10px] text-[#8b8996] block mb-1">字色</label>
                                        <div className="flex items-center gap-2">
                                            <input type="color" value={activeStyle.voiceBarTextColor || '#475569'} onChange={(e) => updateStyle('voiceBarTextColor', e.target.value)} className="w-7 h-7 border border-[#2b2933] cursor-pointer" />
                                            <span className="text-[10px] text-[#8b8996] font-mono">{activeStyle.voiceBarTextColor || '默认'}</span>
                                            {activeStyle.voiceBarTextColor && <button onClick={() => updateStyle('voiceBarTextColor', undefined)} className="text-[9px] text-[#2b2933] underline">还原</button>}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* --- STICKER TOOLS --- */}
                    {activeTab !== 'css' && toolSection === 'sticker' && (
                        <div className="space-y-6 animate-fade-in">
                            <div onClick={() => decorationInputRef.current?.click()} className="cursor-pointer group relative h-20 bg-[#f4f2ed] border-2 border-dashed border-[#2b2933]/50 flex items-center justify-center text-[#8b8996] hover:border-[#2b2933] hover:text-[#2b2933] transition-all">
                                 {activeStyle.decoration ? <img src={activeStyle.decoration} className="h-10 w-10 object-contain" /> : <span className="text-xs font-bold label-mono">＋ 贴个角标 / 贴纸</span>}
                                 <input type="file" ref={decorationInputRef} className="hidden" accept="image/*" onChange={(e) => e.target.files?.[0] && handleImageUpload(e.target.files[0], 'deco')} />
                                 {activeStyle.decoration && <button onClick={(e) => { e.stopPropagation(); updateStyle('decoration', undefined); }} className="absolute top-2 right-2 text-[10px] bg-[#2b2933] text-[#fbfaf7] px-2 py-0.5">撕掉</button>}
                            </div>
                            <div className="flex gap-2 -mt-4">
                                <input
                                    type="url"
                                    value={assetUrlDraft.deco}
                                    onChange={(e) => setAssetUrlDraft(prev => ({ ...prev, deco: e.target.value }))}
                                    placeholder="或贴一条贴纸图床 URL"
                                    className="flex-1 border-2 border-[#2b2933] bg-[#fbfaf7] px-3 py-2 text-xs text-[#2b2933] focus:outline-none focus:shadow-[2px_2px_0_#2b2933]"
                                />
                                <button onClick={() => handleUrlApply('deco')} className="px-3 py-2 bg-[#2b2933] text-[#fbfaf7] text-xs font-bold label-mono hover:opacity-80">贴上</button>
                            </div>

                            {activeStyle.decoration && (
                                <details className="border-2 border-[#2b2933]/30 bg-[#fbfaf7] p-3" open={showAdvancedSettings}>
                                    <summary onClick={(e) => { e.preventDefault(); setShowAdvancedSettings(prev => !prev); }} className="text-xs font-bold text-[#2b2933] cursor-pointer label-mono">细调 · 贴纸位置与旋转</summary>
                                    {showAdvancedSettings && (
                                        <div className="grid grid-cols-2 gap-x-6 gap-y-6 pt-4">
                                            <div className="col-span-2"><label className="text-[10px] text-[#8b8996] label-mono block mb-2">挪位 (左右 / 上下)</label>
                                                <div className="flex gap-3">
                                                    <input type="range" min="-50" max="150" value={activeStyle.decorationX ?? 90} onChange={(e) => updateStyle('decorationX', parseInt(e.target.value))} className="flex-1 h-1.5 bg-[#e3e0d6] rounded-full accent-[#2b2933]" />
                                                    <input type="range" min="-50" max="150" value={activeStyle.decorationY ?? -10} onChange={(e) => updateStyle('decorationY', parseInt(e.target.value))} className="flex-1 h-1.5 bg-[#e3e0d6] rounded-full accent-[#2b2933]" />
                                                </div>
                                            </div>
                                            <div><label className="text-[10px] text-[#8b8996] label-mono block mb-2">缩放 ({activeStyle.decorationScale ?? 1}x)</label>
                                                <input type="range" min="0.2" max="3" step="0.1" value={activeStyle.decorationScale ?? 1} onChange={(e) => updateStyle('decorationScale', parseFloat(e.target.value))} className="w-full h-1.5 bg-[#e3e0d6] rounded-full accent-[#2b2933]" />
                                            </div>
                                            <div><label className="text-[10px] text-[#8b8996] label-mono block mb-2">旋转 ({activeStyle.decorationRotate ?? 0}°)</label>
                                                <input type="range" min="-180" max="180" value={activeStyle.decorationRotate ?? 0} onChange={(e) => updateStyle('decorationRotate', parseInt(e.target.value))} className="w-full h-1.5 bg-[#e3e0d6] rounded-full accent-[#2b2933]" />
                                            </div>
                                        </div>
                                    )}
                                </details>
                            )}
                        </div>
                    )}

                    {/* --- AVATAR TOOLS --- */}
                    {activeTab !== 'css' && toolSection === 'avatar' && (
                        <div className="space-y-6 animate-fade-in">
                            <div onClick={() => avatarDecoInputRef.current?.click()} className="cursor-pointer group relative h-20 bg-[#f4f2ed] border-2 border-dashed border-[#2b2933]/50 flex items-center justify-center text-[#8b8996] hover:border-[#2b2933] hover:text-[#2b2933] transition-all">
                                 {activeStyle.avatarDecoration ? <img src={activeStyle.avatarDecoration} className="h-10 w-10 object-contain" /> : <span className="text-xs font-bold label-mono">＋ 贴个头像框 / 挂件</span>}
                                 <input type="file" ref={avatarDecoInputRef} className="hidden" accept="image/*" onChange={(e) => e.target.files?.[0] && handleImageUpload(e.target.files[0], 'avatarDeco')} />
                                 {activeStyle.avatarDecoration && <button onClick={(e) => { e.stopPropagation(); updateStyle('avatarDecoration', undefined); }} className="absolute top-2 right-2 text-[10px] bg-[#2b2933] text-[#fbfaf7] px-2 py-0.5">撕掉</button>}
                            </div>
                            <div className="flex gap-2 -mt-4">
                                <input
                                    type="url"
                                    value={assetUrlDraft.avatarDeco}
                                    onChange={(e) => setAssetUrlDraft(prev => ({ ...prev, avatarDeco: e.target.value }))}
                                    placeholder="或贴一条挂件图床 URL"
                                    className="flex-1 border-2 border-[#2b2933] bg-[#fbfaf7] px-3 py-2 text-xs text-[#2b2933] focus:outline-none focus:shadow-[2px_2px_0_#2b2933]"
                                />
                                <button onClick={() => handleUrlApply('avatarDeco')} className="px-3 py-2 bg-[#2b2933] text-[#fbfaf7] text-xs font-bold label-mono hover:opacity-80">贴上</button>
                            </div>

                            {activeStyle.avatarDecoration && (
                                <details className="border-2 border-[#2b2933]/30 bg-[#fbfaf7] p-3" open={showAdvancedSettings}>
                                    <summary onClick={(e) => { e.preventDefault(); setShowAdvancedSettings(prev => !prev); }} className="text-xs font-bold text-[#2b2933] cursor-pointer label-mono">细调 · 挂件偏移与旋转</summary>
                                    {showAdvancedSettings && (
                                        <div className="grid grid-cols-2 gap-x-6 gap-y-6 pt-4">
                                            <div className="col-span-2"><label className="text-[10px] text-[#8b8996] label-mono block mb-2">围着头像挪 (左右 / 上下)</label>
                                                <div className="flex gap-3">
                                                    <input type="range" min="-50" max="150" value={activeStyle.avatarDecorationX ?? 50} onChange={(e) => updateStyle('avatarDecorationX', parseInt(e.target.value))} className="flex-1 h-1.5 bg-[#e3e0d6] rounded-full accent-[#2b2933]" />
                                                    <input type="range" min="-50" max="150" value={activeStyle.avatarDecorationY ?? 50} onChange={(e) => updateStyle('avatarDecorationY', parseInt(e.target.value))} className="flex-1 h-1.5 bg-[#e3e0d6] rounded-full accent-[#2b2933]" />
                                                </div>
                                            </div>
                                            <div><label className="text-[10px] text-[#8b8996] label-mono block mb-2">缩放 ({activeStyle.avatarDecorationScale ?? 1}x)</label>
                                                <input type="range" min="0.5" max="3" step="0.1" value={activeStyle.avatarDecorationScale ?? 1} onChange={(e) => updateStyle('avatarDecorationScale', parseFloat(e.target.value))} className="w-full h-1.5 bg-[#e3e0d6] rounded-full accent-[#2b2933]" />
                                            </div>
                                            <div><label className="text-[10px] text-[#8b8996] label-mono block mb-2">旋转 ({activeStyle.avatarDecorationRotate ?? 0}°)</label>
                                                <input type="range" min="-180" max="180" value={activeStyle.avatarDecorationRotate ?? 0} onChange={(e) => updateStyle('avatarDecorationRotate', parseInt(e.target.value))} className="w-full h-1.5 bg-[#e3e0d6] rounded-full accent-[#2b2933]" />
                                            </div>
                                        </div>
                                    )}
                                </details>
                            )}
                        </div>
                    )}

                </div>
            </div>
            )}

            {/* Discard unsaved changes confirm */}
            {pendingDiscardAction && (
                <div className="absolute inset-0 z-[999] bg-[#2b2933]/40 backdrop-blur-sm flex items-center justify-center px-6">
                    <div className="w-full max-w-sm bg-[#fbfaf7] p-5 border-2 border-[#2b2933] shadow-[6px_6px_0_rgba(43,41,51,0.4)] -rotate-1">
                        <div className="text-base font-bold text-[#2b2933] font-display-italic">这页还没贴好</div>
                        <p className="mt-2 text-sm text-[#6b6b6b]">就这么走的话，刚才改的会全没。</p>
                        <div className="mt-5 flex gap-3">
                            <button onClick={() => setPendingDiscardAction(null)} className="flex-1 py-2.5 border-2 border-[#2b2933] bg-[#fbfaf7] text-[#2b2933] font-bold label-mono">留下</button>
                            <button onClick={() => { const action = pendingDiscardAction; setPendingDiscardAction(null); action(); }} className="flex-1 py-2.5 bg-[#2b2933] text-[#fbfaf7] font-bold label-mono">撕掉走人</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Low contrast confirm */}
            {showLowContrastConfirm && (
                <div className="absolute inset-0 z-[999] bg-[#2b2933]/40 backdrop-blur-sm flex items-center justify-center px-6">
                    <div className="w-full max-w-sm bg-[#fbfaf7] p-5 border-2 border-[#2b2933] shadow-[6px_6px_0_rgba(43,41,51,0.4)] rotate-1">
                        <div className="text-base font-bold text-[#2b2933] font-display-italic">这页太糊了</div>
                        <p className="mt-2 text-sm text-[#6b6b6b]">字和底贴得太近，聊天内容可能读不清。还是要贴上吗？</p>
                        <div className="mt-5 flex gap-3">
                            <button onClick={() => setShowLowContrastConfirm(false)} className="flex-1 py-2.5 border-2 border-[#2b2933] bg-[#fbfaf7] text-[#2b2933] font-bold label-mono">再调调</button>
                            <button onClick={() => { setShowLowContrastConfirm(false); doSaveTheme(pendingSaveExit); }} className="flex-1 py-2.5 bg-[#2b2933] text-[#fbfaf7] font-bold label-mono">照样贴</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ThemeMaker;
