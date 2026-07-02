import { AppID, DesktopWidgetPref, OSTheme } from '../../types';
import { replaceManagedCssBlock } from '../../utils/appearanceCssSafety';
import { AppearanceThemePack } from './types';

const packBlockId = (packId: string, surface: string) => `${packId}:${surface}`;

const mergeWidgetCss = (
  current: OSTheme['desktopWidgetPrefs'],
  widgetCss: Record<string, string> | undefined,
  packId: string,
): OSTheme['desktopWidgetPrefs'] => {
  if (!widgetCss) return current;
  const next: Record<string, DesktopWidgetPref> = { ...(current || {}) };
  Object.entries(widgetCss).forEach(([id, css]) => {
    const pref = { ...(next[id] || {}) };
    pref.customCss = replaceManagedCssBlock(pref.customCss, packBlockId(packId, `widget:${id}`), css);
    next[id] = pref;
  });
  return next;
};

const mergeAppCss = (
  current: OSTheme['appCustomCss'],
  appCss: AppearanceThemePack['appCss'],
  packId: string,
): OSTheme['appCustomCss'] => {
  if (!appCss) return current;
  const next = { ...(current || {}) };
  Object.entries(appCss).forEach(([id, css]) => {
    if (!css) return;
    next[id as AppID] = replaceManagedCssBlock(next[id as AppID], packBlockId(packId, `app:${id}`), css);
  });
  return next;
};

export const applyAppearanceThemePack = (
  theme: OSTheme,
  pack: AppearanceThemePack,
): Partial<OSTheme> => ({
  ...pack.theme,
  globalCustomCss: replaceManagedCssBlock(theme.globalCustomCss, packBlockId(pack.id, 'global'), pack.globalCss),
  chatChromeCustomCss: pack.chatChromeCss
    ? replaceManagedCssBlock(theme.chatChromeCustomCss, packBlockId(pack.id, 'chat'), pack.chatChromeCss)
    : theme.chatChromeCustomCss,
  appCustomCss: mergeAppCss(theme.appCustomCss, pack.appCss, pack.id),
  desktopWidgetPrefs: mergeWidgetCss(theme.desktopWidgetPrefs, pack.widgetCss, pack.id),
});

export const APPEARANCE_THEME_PACKS: AppearanceThemePack[] = [
  {
    id: 'cream-journal',
    name: '奶白手账',
    tagline: '柔白纸面、浅灰气泡、轻贴纸',
    description: '适合日常使用，保留清晰可读性，只把桌面和聊天壳调成奶白手账质感。',
    palette: ['#fbfaf7', '#efe9df', '#2b2933', '#e7b8a7'],
    theme: {
      hue: 18,
      saturation: 34,
      lightness: 72,
      contentColor: '#2b2933',
      desktopIconShape: 'rounded',
      desktopIconSurface: 'paper',
      desktopDockStyle: 'paper',
      chatChromeStyle: 'floating',
      chatBackgroundStyle: 'plain',
      groupChatBackgroundStyle: 'plain',
      chatBubbleStyle: 'plain',
      chatInputStyle: 'rounded',
    },
    globalCss: `
.moro-clock-card,.moro-character-card,.moro-widget-card{background:rgba(255,253,248,.82)!important;border:1px solid rgba(95,82,66,.12)!important;box-shadow:0 18px 44px -30px rgba(58,45,31,.42)!important;}
.moro-app-tile{background:rgba(255,255,255,.78)!important;border:1px solid rgba(95,82,66,.10)!important;box-shadow:0 12px 28px -22px rgba(58,45,31,.38)!important;}
.moro-dock{background:rgba(255,253,248,.72)!important;border:1px solid rgba(95,82,66,.14)!important;backdrop-filter:blur(18px)!important;}
.moro-palette-btn{background:#2b2933!important;color:#fbfaf7!important;}`,
    chatChromeCss: `
.moro-chat-header,.moro-chat-inputbar{background:rgba(255,253,248,.86)!important;border-color:rgba(95,82,66,.10)!important;box-shadow:0 14px 34px -30px rgba(58,45,31,.42)!important;}
.moro-chat-avatar{box-shadow:0 0 0 3px rgba(255,255,255,.78)!important;}
.moro-chat-token{background:#f1ede5!important;color:#85796d!important;border-color:rgba(95,82,66,.10)!important;}`,
    widgetCss: {
      clock: `.moro-widget-clock{filter:saturate(.96);}`,
      weather: `.moro-widget-weather{border-radius:22px!important;}`,
    },
  },
  {
    id: 'mono-magazine',
    name: '黑白杂志',
    tagline: '墨黑标题、报刊留白、硬朗线条',
    description: '把整机转成黑白杂志视觉，适合想要冷静、高对比桌面的用户。',
    palette: ['#f7f5ef', '#e0ddd4', '#1f1d1a', '#73706a'],
    theme: {
      hue: 0,
      saturation: 0,
      lightness: 24,
      contentColor: '#1f1d1a',
      desktopIconShape: 'stamp',
      desktopIconSurface: 'minimal',
      desktopDockStyle: 'solid',
      chatChromeStyle: 'flat',
      chatBackgroundStyle: 'paper',
      groupChatBackgroundStyle: 'paper',
      chatBubbleStyle: 'outline',
    },
    globalCss: `
.moro-clock-card,.moro-character-card,.moro-widget-card{background:#f8f6f0!important;color:#1f1d1a!important;border:2px solid #1f1d1a!important;box-shadow:4px 4px 0 rgba(31,29,26,.18)!important;border-radius:8px!important;}
.moro-app-tile{background:#f8f6f0!important;color:#1f1d1a!important;border:2px solid #1f1d1a!important;border-radius:10px!important;box-shadow:3px 3px 0 rgba(31,29,26,.18)!important;}
.moro-dock{background:#1f1d1a!important;border-color:#1f1d1a!important;}
.moro-dock-icon{background:#f8f6f0!important;color:#1f1d1a!important;}
.moro-palette-btn{background:#1f1d1a!important;color:#f8f6f0!important;border-radius:4px!important;}`,
    chatChromeCss: `
.moro-chat-header,.moro-chat-inputbar{background:#f8f6f0!important;color:#1f1d1a!important;border-color:#1f1d1a!important;border-width:2px!important;}
.moro-chat-back,.moro-chat-trigger{color:#1f1d1a!important;}
.moro-chat-token{background:#1f1d1a!important;color:#f8f6f0!important;border-radius:4px!important;}`,
  },
  {
    id: 'glass-console',
    name: '玻璃控制台',
    tagline: '通透卡片、青蓝高光、悬浮控件',
    description: '给桌面和聊天白框加轻玻璃质感，保留明亮背景和柔和阴影。',
    palette: ['#f7fbff', '#dff6ff', '#123142', '#56c7d9'],
    theme: {
      hue: 188,
      saturation: 76,
      lightness: 58,
      contentColor: '#123142',
      desktopIconSurface: 'glass',
      desktopDockStyle: 'glass',
      chatChromeStyle: 'floating',
      chatBackgroundStyle: 'mesh',
      groupChatBackgroundStyle: 'mesh',
      chatInputStyle: 'telegram',
      chatBubbleStyle: 'flat',
    },
    globalCss: `
.moro-clock-card,.moro-character-card,.moro-widget-card,.moro-app-tile,.moro-dock{background:rgba(255,255,255,.42)!important;border:1px solid rgba(86,199,217,.28)!important;backdrop-filter:blur(20px) saturate(1.25)!important;box-shadow:0 20px 50px -34px rgba(18,49,66,.55)!important;}
.moro-palette-btn{background:rgba(18,49,66,.82)!important;color:#f7fbff!important;}`,
    chatChromeCss: `
.moro-chat-header,.moro-chat-inputbar{background:rgba(255,255,255,.58)!important;border-color:rgba(86,199,217,.24)!important;backdrop-filter:blur(20px) saturate(1.22)!important;}
.moro-chat-token,.moro-chat-buffs button{background:rgba(86,199,217,.14)!important;color:#123142!important;border-color:rgba(86,199,217,.25)!important;}`,
  },
  {
    id: 'pixel-handheld',
    name: '像素掌机',
    tagline: '硬边窗口、低饱和底色、按键反馈',
    description: '把控件压成硬边像素窗口，适合游戏感桌面和 TRPG 使用场景。',
    palette: ['#f3eadb', '#c6b48f', '#2e2a24', '#8f674a'],
    theme: {
      hue: 29,
      saturation: 32,
      lightness: 45,
      contentColor: '#2e2a24',
      desktopIconShape: 'squircle',
      desktopIconSurface: 'solid',
      desktopDockStyle: 'solid',
      chatChromeStyle: 'pixel',
      chatBackgroundStyle: 'grid',
      groupChatBackgroundStyle: 'grid',
      chatHeaderStyle: 'pixel',
      chatInputStyle: 'pixel',
      chatBubbleStyle: 'outline',
    },
    globalCss: `
.moro-clock-card,.moro-character-card,.moro-widget-card,.moro-app-tile{background:#f3eadb!important;border:3px solid #2e2a24!important;border-radius:4px!important;box-shadow:4px 4px 0 #8f674a!important;}
.moro-dock{background:#2e2a24!important;border:3px solid #8f674a!important;border-radius:10px!important;}
.moro-dock-icon{border-radius:4px!important;box-shadow:none!important;}
.moro-palette-btn{background:#2e2a24!important;color:#f3eadb!important;border:2px solid #8f674a!important;border-radius:4px!important;}`,
    chatChromeCss: `
.moro-chat-header,.moro-chat-inputbar{background:#f3eadb!important;border:3px solid #2e2a24!important;border-radius:0!important;box-shadow:4px 4px 0 #8f674a!important;}
.moro-chat-back,.moro-chat-trigger{border-radius:4px!important;background:#2e2a24!important;color:#f3eadb!important;}`,
  },
  {
    id: 'film-theater',
    name: '胶片剧场',
    tagline: '暗色幕布、胶片边框、暖光标题',
    description: '更适合折子戏、创作社和沉浸式玩法，桌面像一张小型戏单。',
    palette: ['#16131a', '#2f2733', '#f5e7c8', '#d8a75f'],
    theme: {
      hue: 38,
      saturation: 56,
      lightness: 55,
      contentColor: '#f5e7c8',
      desktopIconSurface: 'solid',
      desktopDockStyle: 'solid',
      chatChromeStyle: 'floating',
      chatBackgroundStyle: 'grid',
      chatBubbleStyle: 'shadow',
    },
    globalCss: `
.moro-clock-card,.moro-character-card,.moro-widget-card{background:rgba(22,19,26,.82)!important;color:#f5e7c8!important;border:1px solid rgba(216,167,95,.34)!important;box-shadow:0 22px 54px -34px rgba(0,0,0,.8)!important;}
.moro-app-tile{background:#2f2733!important;color:#f5e7c8!important;border:1px solid rgba(216,167,95,.3)!important;}
.moro-app-label{color:#f5e7c8!important;text-shadow:0 1px 8px rgba(0,0,0,.5)!important;}
.moro-dock{background:rgba(22,19,26,.82)!important;border-color:rgba(216,167,95,.28)!important;}
.moro-palette-btn{background:#d8a75f!important;color:#16131a!important;}`,
    chatChromeCss: `
.moro-chat-header,.moro-chat-inputbar{background:rgba(22,19,26,.84)!important;color:#f5e7c8!important;border-color:rgba(216,167,95,.28)!important;}
.moro-chat-name,.moro-chat-status,.moro-chat-token{color:#f5e7c8!important;}
.moro-chat-back,.moro-chat-trigger{color:#d8a75f!important;}`,
  },
  {
    id: 'fresh-ins',
    name: '清爽 Ins',
    tagline: '白卡、柔影、彩色轻点缀',
    description: '把旧手账质感换成更清爽的社交 App 风格，适合长时间使用。',
    palette: ['#ffffff', '#f4f1ec', '#2b2933', '#f97316'],
    theme: {
      hue: 22,
      saturation: 90,
      lightness: 55,
      contentColor: '#2b2933',
      desktopIconShape: 'rounded',
      desktopIconSurface: 'glass',
      desktopDockStyle: 'glass',
      chatChromeStyle: 'soft',
      chatBackgroundStyle: 'plain',
      groupChatBackgroundStyle: 'plain',
      chatBubbleStyle: 'ios',
      chatInputStyle: 'ios',
    },
    globalCss: `
.moro-clock-card,.moro-character-card,.moro-widget-card,.moro-app-tile{background:#fff!important;border:1px solid rgba(0,0,0,.05)!important;box-shadow:0 18px 40px -28px rgba(38,38,38,.34)!important;}
.moro-dock{background:rgba(255,255,255,.68)!important;border:1px solid rgba(0,0,0,.06)!important;backdrop-filter:blur(18px)!important;}
.moro-palette-btn{background:#2b2933!important;color:#fff!important;}`,
    chatChromeCss: `
.moro-chat-header,.moro-chat-inputbar{background:rgba(255,255,255,.86)!important;border-color:rgba(0,0,0,.06)!important;box-shadow:0 16px 34px -30px rgba(38,38,38,.32)!important;}
.moro-chat-buffs button{border-radius:999px!important;}`,
  },
];
