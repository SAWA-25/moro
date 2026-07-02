import { AppID } from '../../types';

export type CssPromptKind = 'beginner' | 'complete' | 'local' | 'fix' | 'style';

export type CssPromptTarget = {
  target: string;
  selectors: string[];
  scopeNote?: string;
  styleExamples?: string;
  currentCss?: string;
};

export const cssPromptBaseRules = `请帮我给 Moro 虚拟手机写一段自定义 CSS。
要求：
1. 只输出 CSS 代码，不要解释、不要 Markdown 代码块。
2. 优先使用我给你的选择器，不要写 html、body、* 这种会污染整页的选择器。
3. 默认给关键覆盖项加 !important。
4. 不要隐藏返回键、Dock、拼贴册入口、Palette 按钮，不要让用户无法退出或恢复。
5. 视觉要完整：背景、卡片、按钮、输入框、文字颜色、边框、阴影/材质都照顾到。
6. CSS 尽量适配手机窄屏，不要让文字溢出或互相遮挡。`;

export const cssPromptKindText: Record<CssPromptKind, string> = {
  beginner: `你要把我的一句自然语言愿望，翻译成可以直接粘进 Moro「拼贴册」的 CSS。
如果我没有指定范围，就按下面目标区域写；不要问我 CSS 术语。`,
  complete: `请做一次完整视觉改造：背景、卡片、按钮、输入框、文字、边框、阴影/材质、轻微动效都要统一。
请让视觉像一套完整皮肤，不要只改一两个颜色。`,
  local: `请只做局部微调，不要影响目标以外的区域。
可以调整这个区域的背景、圆角、边框、阴影、间距、文字颜色和 hover/active 状态。`,
  fix: `请帮我修复下面这段 CSS。重点检查：按钮/返回键/入口是否被遮住或隐藏、文字是否溢出、层级是否压住界面、页面是否无法滚动。
修复后仍然只输出完整 CSS。`,
  style: `请把我口语化的风格描述扩写成一套可用 CSS。
风格可以有材质、边框、阴影、贴纸/玻璃/纸张/像素等细节，但不要牺牲可读性和可点击性。`,
};

export const buildCssPrompt = (kind: CssPromptKind, target: CssPromptTarget): string => {
  const selectorText = target.selectors.join('\n');
  const cssText = target.currentCss?.trim()
    ? `\n\n我现在已有的 CSS（请在此基础上修复或改写）：\n${target.currentCss.trim()}`
    : '';
  return `${cssPromptBaseRules}

提示词类型：${kind === 'beginner' ? '新手一句话' : kind === 'complete' ? '完整定制' : kind === 'local' ? '局部微调' : kind === 'fix' ? '修坏修复' : '风格扩写'}
${cssPromptKindText[kind]}

目标区域：
${target.target}

可用选择器：
${selectorText}
${target.scopeNote ? `\n范围说明：\n${target.scopeNote}` : ''}

我想要的风格/问题：
【在这里写：${target.styleExamples || '例如 奶油风、黑白手账、玻璃拟态、像素游戏、旧报纸拼贴，或描述哪里坏了'}】${cssText}`;
};

export const GLOBAL_SELECTORS = [
  '.moro-clock-card', '.moro-clock-time', '.moro-clock-greeting', '.moro-palette-btn',
  '.moro-character-card', '.moro-app-tile', '.moro-app-label',
  '.moro-dock', '.moro-dock-icon', '.moro-status-bar',
  '.moro-widget-card', '.moro-lock-screen', '.moro-app-shell',
];

export const CHAT_SELECTORS = [
  '.moro-chat-root',
  '.moro-chat-header', '.moro-chat-back', '.moro-chat-avatar', '.moro-chat-name', '.moro-chat-status',
  '.moro-chat-buffs', '.moro-chat-buffs button', '.moro-chat-token', '.moro-chat-trigger',
  '.moro-chat-inputbar', '.moro-chat-panel', '.moro-chat-panel button',
];

export const buildGlobalCssPrompt = (kind: CssPromptKind = 'complete', currentCss?: string) => buildCssPrompt(kind, {
  target: '改整台 Moro 虚拟手机的整体外观：桌面、Dock、状态栏、小组件、App 外壳。',
  selectors: GLOBAL_SELECTORS,
  styleExamples: '复古贴纸感、玻璃拟态、黑白报纸、赛博夜店、奶油手账',
  currentCss,
});

export const buildDesktopCssPrompt = (kind: CssPromptKind = 'complete', currentCss?: string) => buildCssPrompt(kind, {
  target: '只改桌面页：桌面时钟/问候卡、聊天预览卡、App 图标、Dock、状态栏、小组件。',
  selectors: [
    '.moro-clock-card', '.moro-clock-time', '.moro-clock-greeting',
    '.moro-character-card', '.moro-app-tile', '.moro-app-label',
    '.moro-dock', '.moro-dock-icon', '.moro-status-bar',
    '.moro-widget-card', '.moro-palette-btn',
  ],
  scopeNote: '不要隐藏 .moro-dock、.moro-palette-btn 或桌面 App 图标；用户需要靠它们回到拼贴册修复。',
  styleExamples: '让桌面像奶油手账、黑白拼贴册、透明玻璃桌面、像素掌机首页',
  currentCss,
});

export const buildChatChromeCssPrompt = (kind: CssPromptKind = 'complete', currentCss?: string) => buildCssPrompt(kind, {
  target: '只改聊天界面的白框外壳：顶栏、返回键、头像、状态、输入栏和功能面板。',
  selectors: CHAT_SELECTORS,
  scopeNote: '不要 display:none 掉 .moro-chat-back。气泡本体不要在这里写，气泡请去「气泡裁剪台」使用 .moro-bubble-user / .moro-bubble-ai。',
  styleExamples: '微信极简、粉白软糖、黑金唱片、像素游戏、旧报纸拼贴',
  currentCss,
});

export const buildBeginnerCssPrompt = () => buildCssPrompt('beginner', {
  target: 'Moro 拼贴册可自定义 CSS 的任意区域。如果我没说清楚范围，请优先写整机外观；如果我提到某个 App，请提醒我替换成对应 [data-moro-app="应用ID"]。',
  selectors: [...GLOBAL_SELECTORS, ...CHAT_SELECTORS, '[data-moro-app="应用ID"]'],
  styleExamples: '我想让整个手机像黑白手账，按钮像贴纸，背景像旧纸',
});

export const appScope = (appId: AppID) => `[data-moro-app="${appId}"]`;
export const appInScope = (appId: AppID, selector: string) => `${appScope(appId)} ${selector}`;
export const uniqueSelectors = (selectors: string[]) => Array.from(new Set(selectors));

export const buildAppCssPrompt = (appName: string, appId: AppID, kind: CssPromptKind = 'complete', currentCss?: string) => buildCssPrompt(kind, {
  target: `只改 Moro 的「${appName}」这个 App，不影响其他 App。`,
  selectors: [
    appScope(appId),
    `.moro-app-shell-${appId}`,
    '.moro-app-shell',
    '[data-moro-active="true"]',
    `${appScope(appId)} button`,
    `${appScope(appId)} input`,
    `${appScope(appId)} textarea`,
  ],
  scopeNote: `所有具体样式都尽量写在 ${appScope(appId)} 下面，例如 ${appScope(appId)} button { ... }。`,
  styleExamples: '复古杂志、银行账本、唱片店、黑白剧场、透明玻璃控制台',
  currentCss,
});

export type AppCssArea = {
  id: string;
  title: string;
  desc: string;
  selectors: (appId: AppID) => string[];
  scopeNote?: string;
  styleExamples: string;
};

export const APP_CSS_AREAS: AppCssArea[] = [
  {
    id: 'shell',
    title: '整页外壳',
    desc: '背景、整页底色、字体颜色和 App 总体氛围。',
    selectors: (appId) => [appScope(appId), `.moro-app-shell-${appId}`, `${appScope(appId)} > *`],
    scopeNote: '只改当前 App 的根外壳和第一层内容，不要把 position/fixed 写到整页根节点上，避免页面移出屏幕。',
    styleExamples: '把整个软件改成黑白杂志、奶油手账、玻璃控制台、像素掌机界面',
  },
  {
    id: 'topbar',
    title: '顶栏标题区',
    desc: '返回键、标题、右上角工具按钮、吸顶栏和页头。',
    selectors: (appId) => [appInScope(appId, 'header'), appInScope(appId, '[class*="sticky"]'), appInScope(appId, '[class*="top-"]'), appInScope(appId, 'h1'), appInScope(appId, 'h2'), appInScope(appId, 'button[aria-label]')],
    scopeNote: '不要隐藏返回、关闭、保存、刷新这类安全按钮；顶栏可以改背景、边框、阴影、圆角和标题字体。',
    styleExamples: '把顶栏做成拍立得相纸标题、透明玻璃导航、旧报纸铅字标题、像素游戏菜单',
  },
  {
    id: 'scroll',
    title: '滚动内容区',
    desc: '页面主体、列表外层、长内容阅读区和滚动手感。',
    selectors: (appId) => [appInScope(appId, 'main'), appInScope(appId, '[class*="overflow-y-auto"]'), appInScope(appId, '[class*="overflow-auto"]'), appInScope(appId, '[class*="no-scrollbar"]'), appInScope(appId, '[class*="space-y-"]')],
    scopeNote: '不要写 overflow:hidden 到主体滚动区；可以调整 padding、背景纹理、滚动区间距和分隔感。',
    styleExamples: '让长列表像手账页面、杂志内页、透明玻璃卷轴、复古终端输出区',
  },
  {
    id: 'cards',
    title: '卡片与列表',
    desc: '内容卡、帖子、相册、课程、订单、歌单、记忆条目等重复块。',
    selectors: (appId) => [appInScope(appId, 'section'), appInScope(appId, 'article'), appInScope(appId, 'li'), appInScope(appId, '[class*="rounded"]'), appInScope(appId, '[class*="border"]'), appInScope(appId, '[class*="shadow"]')],
    scopeNote: '优先改卡片背景、边框、圆角、阴影、间距和悬停态；不要把所有卡片设成透明到文字看不清。',
    styleExamples: '卡片像便签纸、票据、拍立得、旧报纸剪报、黑胶唱片封套',
  },
  {
    id: 'buttons',
    title: '按钮与工具条',
    desc: '主要按钮、图标按钮、标签切换、刷新/保存/删除等操作入口。',
    selectors: (appId) => [appInScope(appId, 'button'), appInScope(appId, '[role="button"]'), appInScope(appId, '[class*="active:"]'), appInScope(appId, '[class*="hover:"]'), appInScope(appId, 'a')],
    scopeNote: '按钮可以改材质、边框、阴影和按下反馈，但不要让文字和图标同色、不要禁用 pointer-events。',
    styleExamples: '按钮像贴纸、复古印章、玻璃胶囊、像素方块、黑白报纸小标签',
  },
  {
    id: 'forms',
    title: '输入表单区',
    desc: '搜索框、文本框、选择器、滑杆、开关和编辑框。',
    selectors: (appId) => [appInScope(appId, 'input'), appInScope(appId, 'textarea'), appInScope(appId, 'select'), appInScope(appId, '[contenteditable="true"]'), appInScope(appId, 'label')],
    scopeNote: '输入区必须保留可读文字、光标和焦点态；不要把输入框高度压到点不到。',
    styleExamples: '输入框像手账横线纸、复古表格、透明玻璃搜索框、终端命令行',
  },
  {
    id: 'bottomnav',
    title: '底栏与导航',
    desc: '底部 Tab、底部操作栏、固定导航和浮动提交栏。',
    selectors: (appId) => [appInScope(appId, 'nav'), appInScope(appId, 'footer'), appInScope(appId, '[class*="bottom-"]'), appInScope(appId, '[class*="fixed"]'), appInScope(appId, '[class*="absolute"]')],
    scopeNote: '底栏不要移出屏幕、不要盖住输入框；如果改 fixed/absolute 元素，要保留点击和滚动空间。',
    styleExamples: '底栏像手机 Dock、纸胶带工具条、玻璃浮层、黑白像素菜单',
  },
  {
    id: 'media',
    title: '图片与媒体',
    desc: '头像、封面、相册图、播放器封面、视频、画布和图标。',
    selectors: (appId) => [appInScope(appId, 'img'), appInScope(appId, 'video'), appInScope(appId, 'canvas'), appInScope(appId, 'svg'), appInScope(appId, '[class*="object-"]')],
    scopeNote: '媒体可以加边框、滤镜、圆角和相纸阴影；不要把 object-fit 改到图片严重变形，头像不要被裁掉五官。',
    styleExamples: '图片像拍立得、胶片、黑白相纸、杂志封面、像素缩略图',
  },
  {
    id: 'dialogs',
    title: '弹窗抽屉',
    desc: '确认框、详情弹层、底部抽屉、浮层菜单和遮罩。',
    selectors: (appId) => [appInScope(appId, '[role="dialog"]'), appInScope(appId, '[aria-modal="true"]'), appInScope(appId, '[class*="z-"]'), appInScope(appId, '[class*="backdrop"]'), appInScope(appId, '[class*="modal"]')],
    scopeNote: '弹窗要保留关闭、取消、确认按钮；不要把遮罩 z-index 写得盖住整个手机后无法点击。',
    styleExamples: '弹窗像票据夹、玻璃抽屉、旧报纸剪贴、舞台提示框',
  },
];

export const buildAppAreaCssPrompt = (appName: string, appId: AppID, area: AppCssArea, currentCss?: string) => buildCssPrompt('local', {
  target: `只改 Moro「${appName}」App 的「${area.title}」区域，不影响这个 App 的其它区域，也不影响其它 App。`,
  selectors: uniqueSelectors([appScope(appId), ...area.selectors(appId)]),
  scopeNote: `所有 CSS 都必须放在 ${appScope(appId)} 下面。${area.scopeNote || ''}`,
  styleExamples: area.styleExamples,
  currentCss,
});

export const buildWidgetCssPrompt = (label: string, id: string, kind: CssPromptKind = 'local', currentCss?: string) => buildCssPrompt(kind, {
  target: `只改桌面小组件「${label}」。`,
  selectors: [`.moro-widget-${id}`, `.moro-widget-${id} *`, '.moro-widget-card'],
  scopeNote: `优先把样式包在 .moro-widget-${id} 里，不要影响其他小组件。`,
  styleExamples: '让它像拍立得、便签纸、玻璃小窗、像素小卡片',
  currentCss,
});

export const buildFloatingMenuCssPrompt = (kind: CssPromptKind = 'local', currentCss?: string) => buildCssPrompt(kind, {
  target: '只改桌面悬浮快捷菜单：悬浮球、展开面板和里面的快捷按钮。',
  selectors: ['.moro-floating-quick-menu', '.moro-floating-quick-menu-panel', '.moro-floating-quick-menu-button'],
  scopeNote: '悬浮球不能被隐藏，也不能被移出屏幕到完全点不到的位置。',
  styleExamples: '奶油圆球、玻璃小胶囊、黑白贴纸按钮、像素快捷菜单',
  currentCss,
});

export const buildOfflineModalCssPrompt = (kind: CssPromptKind = 'local', currentCss?: string) => buildCssPrompt(kind, {
  target: '只改线下模式弹窗：背景遮罩、对话小窗、场景文字、角色/用户气泡和输入栏。',
  selectors: ['.moro-offline-modal-backdrop', '.moro-offline-modal', '.moro-offline-modal-header', '.moro-offline-modal-entry', '.moro-offline-modal-scene', '.moro-offline-modal-char', '.moro-offline-modal-user', '.moro-offline-modal-inputbar'],
  scopeNote: '不要让弹窗超出窄屏，也不要遮住必要的关闭/输入区域。',
  styleExamples: '夜雨电影感、纸页剧本、暖黄卧室灯、透明玻璃对话窗',
  currentCss,
});

export const buildIslandCssPrompt = (kind: CssPromptKind = 'local', currentCss?: string) => buildCssPrompt(kind, {
  target: '只改灵动岛通知胶囊和展开预览面板。',
  selectors: ['.moro-dynamic-island', '.moro-dynamic-island-panel'],
  scopeNote: '灵动岛在状态栏附近，注意不要盖住整屏内容，也不要把通知文字挤出胶囊。',
  styleExamples: '黑胶囊、透明玻璃、电子像素、胶片通知条',
  currentCss,
});

export const buildLockCssPrompt = (kind: CssPromptKind = 'local', currentCss?: string) => buildCssPrompt(kind, {
  target: '只改锁屏：锁屏背景层、时间日期、通知卡、解锁提示和密码输入界面。',
  selectors: ['.moro-lock-screen', '.moro-lock-clock', '.moro-lock-notif', '.moro-lock-passcode', '.moro-lock-passcode-panel', '.moro-lock-passcode-key'],
  scopeNote: '不要隐藏解锁/取消/密码输入相关元素，避免用户无法进入手机。',
  styleExamples: '黑白杂志锁屏、奶油便利贴、玻璃拟态、复古胶片相机屏',
  currentCss,
});
