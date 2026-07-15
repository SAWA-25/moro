
import { ChatTheme } from '../../types';
export { DEFAULT_ARCHIVE_PROMPTS, DEFAULT_REFINE_PROMPTS } from '../../utils/laiwangPrompts';

// Built-in presets map to the new data structure for consistency
export const PRESET_THEMES: Record<string, ChatTheme> = {
    // 新默认：奶白极简 —— 用户浅灰胶囊、AI 白底描边胶囊，全圆角。
    default: {
        id: 'default', name: 'Paper', type: 'preset',
        user: { textColor: '#2e2c36', backgroundColor: '#f1f1f3', borderRadius: 22, opacity: 1, backgroundImageOpacity: 0.5 },
        ai: { textColor: '#2e2c36', backgroundColor: '#ffffff', borderRadius: 22, opacity: 1, backgroundImageOpacity: 0.5 }
    },
    indigo: {
        id: 'indigo', name: 'Indigo', type: 'preset',
        user: { textColor: '#ffffff', backgroundColor: '#6366f1', borderRadius: 20, opacity: 1, backgroundImageOpacity: 0.5 },
        ai: { textColor: '#1e293b', backgroundColor: '#ffffff', borderRadius: 20, opacity: 1, backgroundImageOpacity: 0.5 }
    },
    dream: {
        id: 'dream', name: 'Dream', type: 'preset',
        user: { textColor: '#ffffff', backgroundColor: '#f472b6', borderRadius: 20, opacity: 1, backgroundImageOpacity: 0.5 },
        ai: { textColor: '#1e293b', backgroundColor: '#ffffff', borderRadius: 20, opacity: 1, backgroundImageOpacity: 0.5 }
    },
    forest: {
        id: 'forest', name: 'Forest', type: 'preset',
        user: { textColor: '#ffffff', backgroundColor: '#10b981', borderRadius: 20, opacity: 1, backgroundImageOpacity: 0.5 },
        ai: { textColor: '#1e293b', backgroundColor: '#ffffff', borderRadius: 20, opacity: 1, backgroundImageOpacity: 0.5 }
    },
};

