
export enum AppID {
  Launcher = 'launcher',
  Settings = 'settings',
  Character = 'character',
  Chat = 'chat',
  GroupChat = 'group_chat', 
  Gallery = 'gallery',
  Music = 'music',
  Browser = 'browser',
  ThemeMaker = 'thememaker',
  Appearance = 'appearance',
  Date = 'date',
  Journal = 'journal',
  Schedule = 'schedule',
  Room = 'room',
  CheckPhone = 'check_phone',
  Social = 'social',
  Study = 'study',
  Game = 'game',
  Worldbook = 'worldbook', 
  Novel = 'novel', 
  Bank = 'bank', // New App
  XhsStock = 'xhs_stock', // XHS image stock for publishing
  SpecialMoments = 'special_moments', // Valentine's Day & future events
  XhsFreeRoam = 'xhs_free_roam', // Character autonomous XHS activity
  Songwriting = 'songwriting', // Songwriting / Lyric creation app
  Call = 'call', // 语音电话测试（MiniMax TTS）
  VoiceDesigner = 'voice_designer', // 捏声音 — MiniMax 音色设计器
  Guidebook = 'guidebook', // 攻略本 — 角色攻略用户小游戏
  LifeSim = 'lifesim', // 模拟人生 — 与角色共同经营的小世界
  MemoryPalace = 'memory_palace', // 记忆宫殿 — 七个房间可视化
  Handbook = 'handbook', // 手账 — 跨角色聚合的生活留痕本（LLM 代笔 + 角色生活流陪伴）
  QQBridge = 'qq_bridge', // QQ 桥接 — 通过 NapCat 把 QQ 私聊接入当前角色，共享 IndexedDB 上下文
  HotNews = 'hot_news', // 热点 — 分时段召回的多平台热榜可视化（决定角色可能聊起的话题）
  VRWorld = 'vrworld', // 页外 — 角色自主登入的虚拟世界（定时驱动，房间里看小说/听歌/留言，产出活动卡注入聊天+记忆）
  CharCreatorDev = 'char_creator_dev', // 捏脸系统开发模式 — 仅开发模式可见，向捏人器指定类目追加自定义部件
  Phone = 'phone', // 电话 — 拨号键盘 / 通话记录（拨出·接听·未接）/ 通话录音回放与逐字稿
  ExchangeDiary = 'exchange_diary', // 日记社 — 多角色交换日记本（角色视角日记 + 每日对话总结）
  Presets = 'presets', // 预设 — SillyTavern 式 Chat Completion 预设（提示词管理器 + 采样参数，可导入酒馆预设 JSON）
  Personas = 'personas', // 人设 — SillyTavern 式用户人设管理（多套用户身份，可绑定角色 / 默认 / 世界书，描述按位置注入 prompt）
  Regex = 'regex', // 正则 — SillyTavern 式正则脚本（全局/角色局部，作用于用户输入/AI 输出/提示词/显示，可导入酒馆正则 JSON）
  Creative = 'creative', // 创作社 — 「笔友会」（共创小说）与「写歌」（共创歌曲）合并入口，首页选模式后进入对应创作台
  Theater = 'theater', // 折子戏 — 「攻略本」(galgame 恋爱攻略) 与「TRPG」(跑团冒险) 合并入口，封面页选模式后进入对应剧目（Guidebook/Game 子 App 保留路由兼容）
  Almanac = 'almanac', // 岁时记 — 「时光契约」(日程/心愿单/纪念日倒数) 与「特别时光」(节日记忆活动) 合并入口，封面页选模式后进入对应页（Schedule/SpecialMoments 子 App 保留路由兼容）
  Takeout = 'takeout', // 外卖 — 参考美团：本地生成店铺点菜下单、配送进度、和骑手/商家聊天、自付/代付，并与来往联动（给角色点单/代付）
  Shop = 'shop', // 购物商城 — 虚拟礼物商城：买礼物送角色（聊天里落礼物卡 + 角色回应/感谢信），角色也会自己逛（自购/回赠），查角色购物小票
  Harem = 'harem', // 椒房记 — AI 后宫文游：AI 实时生成后宫恋爱剧情的互动小说，玩家用选择影响好感/信任/嫉妒/记忆/事件flag/结局，含长期记忆·角色独立记忆·多周目
  Forum = 'forum', // 茶话亭 — 可浏览的论坛：板块/帖子/跟帖，用户发帖回帖，角色与匿名网友（副 API）来盖楼/开帖
  Twitter = 'twitter', // 推特 — 本地 AI 生成的 X/Twitter 式时间线，角色/NPC 自由发推互动
  VideoCall = 'video_call', // 视频通话 — 聊天里发起的视频通话：角色侧用通话立绘，用户侧可自选开/关摄像头（只开一下就关），翻转镜头
  Xunji = 'xunji', // 循迹 — 角色 Screenlife 演出 + 异地恋式监视/报备模拟，local-first 落库
  Manual = 'manual', // 说明书 — 按 App 分类收纳用户可操作功能说明
}

// =====================================================================
// 正则脚本（SillyTavern Regex Script 完整移植）
// =====================================================================

/**
 * 单条正则脚本。字段与 SillyTavern 的 RegexScriptData 一一对应，
 * 导入酒馆正则 JSON（单条对象或数组）可无损落库。
 * - findRegex 支持 "/pattern/flags" 与裸 pattern 两种写法
 * - placement 取值见 utils/regex/engine.ts 的 regex_placement
 * - markdownOnly = 仅改聊天显示（不动消息原文）；promptOnly = 仅改发给 LLM 的提示词
 * - 两者都不勾 = 直接改写消息原文（落库前生效）
 */
export interface RegexScriptData {
  id: string;
  scriptName: string;
  findRegex: string;
  replaceString: string;
  trimStrings: string[];
  placement: number[];
  disabled: boolean;
  markdownOnly: boolean;
  promptOnly: boolean;
  runOnEdit: boolean;
  /** 0=不替换宏 1=原样替换 {{user}}/{{char}} 2=替换后做正则转义 */
  substituteRegex: number;
  /** 最小深度（-1/null = 不限），depth 0 = 最后一条消息 */
  minDepth?: number | null;
  maxDepth?: number | null;
}

// =====================================================================
// --- 人设（SillyTavern Persona Management 移植） ---
// 与 ST 的 power_user.personas / persona_descriptions 对齐：
// 一套人设 = 名字 + 头像 + 描述 + 注入位置 (+ 世界书绑定 + 角色绑定)。
// 激活人设时把 name/avatar/description 写入 UserProfile（全链路立即生效），
// 位置 / 深度 / 世界书等高级语义由 utils/personas.ts 的 PersonaRuntime 在
// 主聊天链路（buildChatRequestPayload）里解析。
// =====================================================================

/**
 * 人设描述注入位置（保留 ST persona_description_positions 的原始数值）。
 * Moro 没有作者注释（Author's Note），ST 的 2（顶部）/ 3（底部）导入时降级为 0。
 */
export const PERSONA_POSITION = {
    /** 嵌入提示词（默认）：进核心上下文的「互动对象」块 / 预设的 personaDescription marker */
    IN_PROMPT: 0,
    /** @Depth 注入：以指定 role 插到聊天历史的对应深度（同世界书 @D 语义） */
    AT_DEPTH: 4,
    /** 不注入：描述不进 prompt（名字仍通过 {{user}} 与「互动对象」块生效） */
    NONE: 9,
} as const;

/** @Depth 注入时的消息 role（同 ST persona_description_role）：0=system 1=user 2=assistant */
export type PersonaDepthRole = 0 | 1 | 2;

export interface PersonaConnection {
    type: 'character' | 'group';
    id: string;
}

export interface Persona {
    id: string;
    /** 人设名（聊天里作为用户名，{{user}} 宏的解析值） */
    name: string;
    /** 仅展示用小标题（ST 的 title），不进 prompt */
    title?: string;
    avatar: string;
    /** 人设描述（进 prompt；支持 {{char}} / {{user}} 宏） */
    description: string;
    /** 注入位置（PERSONA_POSITION 数值；兼容导入的 ST 备份里出现的 1/2/3 → 视为 0） */
    position: number;
    /** @Depth 注入深度（仅 position=4 生效），默认 2（同 ST） */
    depth?: number;
    /** @Depth 注入 role（仅 position=4 生效），默认 0=system */
    role?: PersonaDepthRole;
    /** 绑定的世界书分组名（=ST 人设世界书）：激活时该组条目按各自位置/开关注入主聊天 */
    lorebookCategory?: string;
    /** 绑定的角色/群（=ST connections）：进入对应聊天时自动切换到本人设 */
    connections?: PersonaConnection[];
    createdAt: number;
    updatedAt: number;
}

// =====================================================================
// --- LLM 预设（SillyTavern Chat Completion 预设移植） ---
// 字段名与 SillyTavern 预设 JSON 完全对齐（snake_case），导入导出零转换。
// 详见 utils/presets.ts 的导入 / 组装逻辑。
// =====================================================================

export type PresetPromptRole = 'system' | 'user' | 'assistant';

/** 预设里的一条提示词（与 ST PromptManager 的 Prompt 对齐）。 */
export interface PresetPrompt {
    /** 唯一标识。内置项是固定名（main / jailbreak / chatHistory…），用户自建项是 UUID */
    identifier: string;
    name: string;
    /** ST 语义：true = 系统内置提示词；false/缺省 = 用户自建 */
    system_prompt?: boolean;
    role?: PresetPromptRole;
    content?: string;
    /** marker = 由系统填充的占位符（chatHistory / charDescription 等），content 不可编辑 */
    marker?: boolean;
    /** 注入位置：0 = 相对（按列表顺序排进消息流）；1 = 绝对（@Depth 注入聊天历史） */
    injection_position?: number;
    /** 绝对注入时距聊天历史末尾的深度（0 = 紧跟最后一条消息之前），默认 4 */
    injection_depth?: number;
    /** 同深度内的优先级，大的更靠近末尾，默认 100 */
    injection_order?: number;
    /** ST：禁止角色卡覆盖（main / jailbreak 用）。Moro 无角色卡覆盖机制，仅保留字段 */
    forbid_overrides?: boolean;
    /** 个别 ST 导出会把开关直接写在 prompt 上；正式开关在 prompt_order 里 */
    enabled?: boolean;
}

export interface PresetPromptOrderEntry {
    identifier: string;
    enabled: boolean;
}

/** ST 约定：character_id 100000 = 单聊默认，100001 = 群聊默认。 */
export interface PresetPromptOrderCharacter {
    character_id: number;
    order: PresetPromptOrderEntry[];
}

/** 一份完整预设。采样字段名与 ST 一致；其余 ST 字段进 raw 兜底，导出时合并回去。 */
export interface TavernPreset {
    id: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    // —— 采样参数（与 ST 字段同名） ——
    temperature?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    top_p?: number;
    top_k?: number;
    top_a?: number;
    min_p?: number;
    repetition_penalty?: number;
    /** 上下文窗口 token 数（ST openai_max_context）。Moro 按条数截历史，此值仅存档展示 */
    openai_max_context?: number;
    /** 回复 max_tokens（ST openai_max_tokens） */
    openai_max_tokens?: number;
    /**
     * 绑定的 Moro API 预设 id（设置 App 里保存的 os_api_presets 条目）。
     * 激活本预设时自动套用对应 API 配置（baseUrl/key/model），类似 ST 的
     * 连接配置切换。Moro 本地字段，不随酒馆 JSON 导出。
     */
    moroApiPresetId?: string;
    // —— 提示词管理器 ——
    prompts: PresetPrompt[];
    prompt_order: PresetPromptOrderCharacter[];
    /**
     * 预设自带的正则脚本（SillyTavern PRESET 作用域，存在预设 JSON 的
     * extensions.regex_scripts 里）。导入时解析填充，仅当本预设被激活且印坊开印时
     * 生效（执行顺序：全局 → 预设 → 角色局部），导出时写回 extensions.regex_scripts。
     */
    regexScripts?: RegexScriptData[];
    /** 导入时的原始 JSON 全量兜底（utility prompts / 模型选择等未映射字段），导出时原样合并 */
    raw?: Record<string, any>;
}

export interface SystemLog {
    id: string;
    timestamp: number;
    type: 'error' | 'network' | 'system';
    source: string;
    message: string;
    detail?: string;
}

export interface AppConfig {
  id: AppID;
  name: string;
  icon: string;
  color: string;
}

export interface DesktopDecoration {
  id: string;
  type: 'image' | 'preset';
  content: string; // data URI for image, SVG data URI or emoji for preset
  x: number;       // percentage 0-100
  y: number;       // percentage 0-100
  scale: number;   // multiplier (0.2 - 3)
  rotation: number; // degrees (-180 to 180)
  opacity: number;  // 0-1
  zIndex: number;
  flip?: boolean;
}

export interface OSTheme {
  hue: number;
  saturation: number;
  lightness: number;
  wallpaper: string;
  darkMode: boolean;
  contentColor?: string;
  /** 桌面整体皮肤。动森皮肤已下线，仅保留 'default'（旧存档中的 'animalcrossing' 会在加载时迁移）。 */
  skin?: 'default';
  launcherWidgetImage?: string; // DEPRECATED: always stripped on load — never renders.
  launcherWidgets?: Record<string, string>; // slots: 'tl' | 'tr' | 'wide' | 'dsq' (legacy 'bl' / 'br' are banned)
  desktopDecorations?: DesktopDecoration[];
  customFont?: string;
  hideStatusBar?: boolean;
  desktopIconShape?: 'rounded' | 'squircle' | 'circle' | 'stamp';
  desktopIconSurface?: 'paper' | 'glass' | 'solid' | 'minimal';
  desktopIconScale?: 'sm' | 'md' | 'lg';
  desktopIconLabelMode?: 'show' | 'fade' | 'hide';
  desktopDockStyle?: 'glass' | 'paper' | 'solid' | 'minimal';
  desktopDragMode?: 'gentle' | 'balanced' | 'snappy';
  desktopEditEffect?: 'wiggle' | 'breathe' | 'none';
  /** 悬浮窗快捷菜单：全局可拖动的悬浮球，点开是常用 App 快捷入口。undefined 视为开启；显式 false 关闭。 */
  floatingQuickMenu?: boolean;
  floatingQuickMenuStyle?: FloatingQuickMenuStyle;
  // Chat UI customization (global)
  chatAvatarShape?: 'circle' | 'rounded' | 'square';
  chatAvatarSize?: 'small' | 'medium' | 'large';
  chatAvatarMode?: 'grouped' | 'every_message';
  chatBubbleStyle?: 'modern' | 'flat' | 'outline' | 'shadow' | 'wechat' | 'ios';
  chatMessageSpacing?: 'compact' | 'default' | 'spacious';
  chatShowTimestamp?: 'always' | 'hover' | 'never';
  chatHeaderStyle?: 'default' | 'minimal' | 'gradient' | 'wechat' | 'telegram' | 'discord' | 'pixel';
  chatInputStyle?: 'default' | 'rounded' | 'flat' | 'wechat' | 'ios' | 'telegram' | 'discord' | 'pixel';
  chatChromeStyle?: 'soft' | 'flat' | 'floating' | 'pixel';
  chatBackgroundStyle?: 'plain' | 'grid' | 'paper' | 'mesh';
  /** 群聊通用背景。单个群若设置了 chatBackgroundImage，则优先使用单群背景。 */
  groupChatBackgroundStyle?: 'plain' | 'grid' | 'paper' | 'mesh';
  chatHeaderAlign?: 'left' | 'center';
  chatHeaderDensity?: 'compact' | 'default' | 'airy';
  chatStatusStyle?: 'subtle' | 'pill' | 'dot';
  chatSendButtonStyle?: 'circle' | 'pill' | 'minimal';
  /** 聊天「输入动效」：在输入栏上叠一层装饰动画 —— 上传图片（含动图）或让 AI 写一段 SVG。 */
  chatInputAnimation?: {
    kind: 'image' | 'svg';
    data: string;             // 图片 data URL，或 SVG 源码字符串
    position?: 'corner' | 'top' | 'background';
    opacity?: number;         // 0..1，默认 0.9
  };
  /** Instant Push 用户气泡左侧的"准备中"圆点动画。默认开启。 */
  chatPendingIndicator?: boolean;
  /** 聊天「白框」自定义 CSS：作用于 .moro-chat-header / .moro-chat-inputbar / .moro-chat-root，
   *  以及顶栏各零件 .moro-chat-back / .moro-chat-avatar / .moro-chat-name / .moro-chat-status /
   *  .moro-chat-buffs / .moro-chat-token / .moro-chat-trigger。可换色 / 贴图 / 改外形 / 挪位。 */
  chatChromeCustomCss?: string;
  /** 隐藏顶栏的情绪 buff 栏。 */
  chatHideHeaderBuffs?: boolean;
  /** 全局自定义 CSS：注入整机（桌面 / 锁屏 / 所有 App），配合 .moro-* 钩子类（moro-clock-card /
   *  moro-character-card / moro-app-tile / moro-dock / moro-status-bar / moro-lock-screen 等）做全局美化。
   *  在「主题 → 自定义 CSS」编辑，实时生效。 */
  globalCustomCss?: string;
  /** 桌面小组件自定义（key = widget id：clock / character / schedule / music / image / imgtl / imgtr / imgwide / text）。
   *  在「主题 → 桌面小组件」编辑：隐藏（删除）、改网格尺寸（横版/竖版/方形）、注入小组件自定义 CSS。 */
  desktopWidgetPrefs?: Record<string, DesktopWidgetPref>;
  /** 文字小组件内容（桌面便签）：标题 + 正文，点小组件即可编辑。 */
  textWidget?: { title?: string; body?: string };
  /** 灵动岛样式自定义（背景 / 文字色 / 圆角 / 自定义 CSS），在「主题 → 灵动岛」编辑。 */
  dynamicIslandStyle?: DynamicIslandStyle;
  /** 锁屏样式自定义（专属壁纸 / 时钟字体 / 通知卡风格 / 解锁动画 / 自定义 CSS），在「主题 → 锁屏」编辑。 */
  lockScreenStyle?: LockScreenStyle;
  offlineModeStyle?: OfflineModeStyle;
  /** 占卜牌面美化（折子戏·占卜读这里渲染牌面）：牌背图 / 边框风格 / 渲染风格。 */
  tarotSkin?: {
    cardBack?: string;                                  // 牌背图 dataURL（牌面未翻开 / 占位时显示）
    frame?: 'none' | 'gold' | 'ink' | 'film';           // 边框：无 / 描金 / 水墨 / 胶片
    renderStyle?: 'classic' | 'minimal' | 'mystic';     // 渲染风格：古典 / 极简 / 神秘
  };
}

/** 单个桌面小组件的自定义项 */
export interface DesktopWidgetPref {
  /** 从桌面移除（不渲染、不占格） */
  hidden?: boolean;
  /** 网格宽度覆盖（1-4 列）。与 h 搭配实现横版 / 竖版 / 方形 */
  w?: number;
  /** 网格高度覆盖（1-12 行） */
  h?: number;
  /** 注入桌面的原生 CSS，配合 .moro-widget-<id> 钩子类（如 .moro-widget-clock）自定义样式 */
  customCss?: string;
}

/** 灵动岛样式自定义 */
export interface DynamicIslandStyle {
  /** 胶囊背景（CSS color / gradient），默认 #0b0b12 */
  background?: string;
  /** 文字颜色，默认白 */
  textColor?: string;
  /** 圆角 px。缺省为全圆胶囊 */
  radius?: number;
  /** 注入的原生 CSS（配合 .moro-dynamic-island 钩子类） */
  customCss?: string;
}

/** 锁屏样式自定义 */
export interface FloatingQuickMenuStyle {
  bubbleBackground?: string;
  menuBackground?: string;
  pawColor?: string;
  textColor?: string;
  borderColor?: string;
  radius?: number;
  customCss?: string;
}

export interface LockScreenStyle {
  /** 锁屏专属壁纸（缺省沿用桌面壁纸） */
  wallpaper?: string;
  /** 时钟字体风格 */
  clockFont?: 'serif' | 'sans' | 'mono' | 'hand';
  clockTop?: number;
  clockScale?: number;
  dateText?: string;
  greetingText?: string;
  unlockHintText?: string;
  /** 消息通知卡风格：玻璃拟态 / 纸面手帐 / 墨色 */
  notifCardStyle?: 'glass' | 'paper' | 'ink';
  showNotifications?: boolean;
  /** 解锁进入桌面的过渡动画 */
  unlockAnimation?: 'slide' | 'fade' | 'zoom' | 'none';
  passcodeStyle?: 'glass' | 'paper' | 'ink';
  passcodeTitleText?: string;
  passcodeErrorText?: string;
  passcodeCancelText?: string;
  /** 注入的原生 CSS（配合 .moro-lock-screen / .moro-lock-clock / .moro-lock-notif 钩子类） */
  customCss?: string;
}

export interface OfflineModeStyle {
  background?: string;
  textColor?: string;
  accentColor?: string;
  radius?: number;
  customCss?: string;
}

export interface AppearancePreset {
  id: string;
  name: string;
  createdAt: number;
  theme: OSTheme;
  customIcons?: Record<string, string>;
  chatThemes?: ChatTheme[];
  chatLayout?: ChatLayoutPreset;
}

export interface ChatLayoutPreset {
  id: string;
  name: string;
  createdAt: number;
  chatBg?: string;
  chatBgOpacity?: number;
  headerStyle?: 'default' | 'minimal' | 'immersive';
  inputStyle?: 'default' | 'rounded' | 'flat';
  avatarShape?: 'circle' | 'rounded' | 'square';
  avatarSize?: 'small' | 'medium' | 'large';
  messageLayout?: 'default' | 'compact' | 'spacious';
  showTimestamp?: 'always' | 'hover' | 'never';
  bubbleThemeId?: string;
}

export interface TranslationConfig {
  enabled: boolean;
  sourceLang: string; // e.g. '日本語' - the language messages are displayed in (选)
  targetLang: string; // e.g. '中文' - the language to translate into (译)
}

export interface VirtualTime {
  hours: number;
  minutes: number;
  day: string;
}

export type MinimaxRegion = 'domestic' | 'overseas';

export interface APIConfig {
  baseUrl: string;
  apiKey: string;
  minimaxApiKey?: string;
  minimaxGroupId?: string;
  // 'domestic' → https://api.minimaxi.com (国内站)
  // 'overseas' → https://api.minimax.io  (海外站)
  // Missing / unknown falls back to domestic.
  minimaxRegion?: MinimaxRegion;
  // Replicate token (r8_xxx) for ACE-Step song generation in 写歌 App.
  aceStepApiKey?: string;
  model: string;
  // Per-API streaming toggle. Some endpoints only support stream:true.
  // Missing → false (默认非流式).
  stream?: boolean;
  // Per-API temperature for chat / 约会 main calls. Missing → 0.85.
  temperature?: number;
}

/**
 * 副 API（全局）：负责处理「主 API 聊天以外」的功能——日程生成/协调、角色生活侧写、
 * （后续）约会世界引擎等后台/辅助 LLM 任务。在「文具盒」里配置，所有角色共用。
 * 关闭或未填时，相关功能回退到主 apiConfig（见 utils/auxApi.ts resolveAuxApi）。
 */
export interface AuxApiConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface InstantPushConfig {
  enabled: boolean;
  workerUrl: string;        // https://your-instant.workers.dev
  // VAPID 公私钥已迁移到 utils/pushVapid.ts (push_vapid_v1)，与 Proactive Push
  // 共享同一份，避免两边互相 unsubscribe 抢同一个 pushManager 订阅。
  clientToken?: string;     // 对应 Worker 的 AMSG_CLIENT_TOKEN
  // 发送文本后是否自动触发 AI 回复 (worker 端跑 + push 回写). 仅控制"自动触发"这件事,
  // 不改变 instant push 本身的开关含义. 关闭时 instant 模式也保留手动 ⚡, 跟本地模式一致.
  // 缺省 (undefined) 视为关闭 — 避免"启用 instant = 自动回复"的反直觉强绑定.
  autoTriggerOnSend?: boolean;
  // 大 payload 的传输方式默认走 multipart。只有连接测试确认 Worker 绑定了可用 D1 后,
  // 前台才允许用户打开 D1 envelope。
  useD1BlobStore?: boolean;
  d1Available?: boolean;
  d1CheckedAt?: number;
  d1CheckedWorkerUrl?: string;
  updatedAt?: number;
}

export type InstantOversizeTransport = 'multipart' | 'd1';

export type ActiveMsg2DbDriver = 'pg' | 'neon';
export type ActiveMsg2Mode = 'fixed' | 'auto' | 'prompted';
export type ActiveMsg2Recurrence = 'none' | 'daily' | 'weekly';

export interface ActiveMsg2ApiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ActiveMsg2GlobalConfig {
  userId: string;
  driver: ActiveMsg2DbDriver;
  databaseUrl: string;
  initSecret?: string;
  tenantId?: string;
  tenantToken?: string;
  cronToken?: string;
  cronWebhookUrl?: string;
  masterKeyFingerprint?: string;
  initializedAt?: number;
  updatedAt?: number;
}

export interface ActiveMsg2CharacterConfig {
  enabled: boolean;
  mode: ActiveMsg2Mode;
  firstSendTime: string;
  recurrenceType: ActiveMsg2Recurrence;
  userMessage?: string;
  promptHint?: string;
  maxTokens?: number;
  taskUuid?: string;
  remoteStatus?: 'idle' | 'scheduled' | 'sent' | 'error';
  useSecondaryApi?: boolean;
  secondaryApi?: ActiveMsg2ApiConfig;
  lastSyncedAt?: number;
  lastError?: string;
}

export interface ActiveMsg2InboxMessage {
  messageId: string;
  charId: string;
  charName: string;
  body: string;
  previewBody?: string;
  avatarUrl?: string;
  source?: string;
  messageType?: string;
  messageSubtype?: string;
  taskId?: string | null;
  metadata?: Record<string, any>;
  sentAt?: number;
  receivedAt: number;
}

// Phase 2 Round 1 — Instant Push agentic loop session state, written client-side
// before /instant and consumed by /continue. See plans/instant-push-agentic-loop-phase2.md
export interface InstantPushOutboundSession {
  sessionId: string;
  charId: string;
  /** Conversation messages snapshot at /instant call time — fed to /continue as agentic-loop history. */
  messages: any[];
  /** API credentials needed to resume via /continue when worker calls back. */
  apiCredentials: { baseUrl: string; apiKey: string; model: string };
  createdAt: number;
}

// Phase 2 Round 2 — SW will populate these stores; Round 1 just defines schema (empty).
export interface InstantPushPendingToolCall {
  sessionId: string;
  charId: string;
  /** OpenAI-shape tool_calls from worker LLM emit, ready to dispatch via agenticTools. */
  toolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  /** Pre-tool-call LLM text output, used to prefix assistant-side content if needed. */
  llmOutputText: string;
  /**
   * Agentic-loop iteration that produced this tool_request (0-indexed at worker side, see
   * amsg-instant SessionContext.iteration). Client POST /continue must use iteration + 1,
   * worker rejects non-incrementing values with HTTP 400. Default 0 for safety when the
   * push didn't carry metadata.iteration (e.g. legacy worker).
   */
  iteration: number;
  createdAt: number;
}

/**
 * SW writes reasoning_buffer when amsg-instant emits ReasoningPush.
 * 0.8.0-next.2 起, ReasoningPush 自带 (messageIndex, totalMessages, chunkIndex,
 * totalChunks) 四个字段 — long reasoning_content 会被 amsg-instant 按 UTF-8
 * 字节自动切多 push (默认 reasoningChunkBytes=2000), 多 push 通过 chunks[]
 * 累积, claimReasoning 按 (messageIndex, chunkIndex) 排序后拼接成完整 reasoning.
 *
 * `reasoningContent` 字段是 claimReasoning 输出 (向后兼容老 Round 1 buffer 形态).
 * `chunks` 字段是 SW 累积形态 (新 push 进来 read-modify-write 追加一条).
 */
export interface InstantPushReasoningBufferEntry {
  sessionId: string;
  charId: string;
  /** 拼接后的完整 reasoning. claimReasoning 输出时填这个字段; SW 写入时可省略. */
  reasoningContent?: string;
  /** SW 累积式 buffer — 每条 ReasoningPush 进来追加一条. */
  chunks?: Array<{
    messageIndex: number;
    chunkIndex: number;
    reasoningContent: string;
  }>;
  receivedAt: number;
}

export interface ApiPreset {
  id: string;
  name: string;
  config: APIConfig;
}

export interface CharacterBuff {
  id: string;
  name: string;      // internal key, e.g. 'reconciliation_fragile'
  label: string;     // display text, e.g. '脆弱的和好'
  intensity: 1 | 2 | 3;
  emoji?: string;
  color?: string;    // hex, e.g. '#f87171'
  description?: string;  // 用户可读的简短说明（给用户看的，不是给AI的）
}

// 实时上下文配置 - 让AI角色感知真实世界
export interface RealtimeConfig {
  // 天气配置
  weatherEnabled: boolean;
  /** 取数方式：'geo'（默认，浏览器定位 + Open-Meteo 免密钥）/ 'manual'（旧版手填 OpenWeatherMap Key + 城市） */
  weatherMode?: 'geo' | 'manual';
  weatherApiKey: string;  // OpenWeatherMap API Key（仅 manual 模式需要）
  weatherCity: string;    // 城市名（仅 manual 模式用）

  // 新闻配置
  newsEnabled: boolean;
  newsApiKey?: string;
  newsPlatforms?: string[];  // hot_news 热榜平台 key 列表（默认主源，免鉴权），留空用内置默认

  // Notion 配置
  notionEnabled: boolean;
  notionApiKey: string;   // Notion Integration Token
  notionDatabaseId: string; // 日记数据库ID
  notionNotesDatabaseId?: string; // 用户笔记数据库ID（可选，让角色读取用户的日常笔记）

  // 飞书配置 (中国区 Notion 替代)
  feishuEnabled: boolean;
  feishuAppId: string;      // 飞书应用 App ID
  feishuAppSecret: string;  // 飞书应用 App Secret
  feishuBaseId: string;     // 多维表格 App Token
  feishuTableId: string;    // 数据表 Table ID

  // 小红书配置 (MCP / Skills 双模式浏览器自动化)
  xhsEnabled: boolean;
  xhsMcpConfig?: XhsMcpConfig;

  // 缓存配置
  cacheMinutes: number;
}

// 热点单条（与 realtimeContext 的 NewsItem 结构一致，单独放在 types 里避免循环依赖）
export interface HotNewsItem {
  title: string;
  source?: string;  // 平台展示名，如「微博」
  url?: string;
  desc?: string;    // 热点简介（API 的 desc 字段，可能为空）
}

// 分时段热点快照：每天每时段（0-8/8-16/16-24）最多拉一次，全角色共享
export interface HotNewsSnapshot {
  id: string;          // `${date}#${slot}`，如 2026-05-20#1
  date: string;        // YYYY-MM-DD
  slot: number;        // 0=早间 1=午间 2=晚间
  slotLabel: string;   // 早间 / 午间 / 晚间
  items: HotNewsItem[];
  platforms: string[]; // 本次召回用的平台 key 列表
  fetchedAt: number;   // 拉取时间戳
}

export interface MemoryPalaceBackupConfig {
  embedding: {
    baseUrl: string;
    apiKey: string;
    model: string;
    dimensions: number;
  };
  lightLLM: {
    baseUrl: string;
    apiKey: string;
    model: string;
  };
  rerank: {
    enabled: boolean;
    baseUrl: string;
    apiKey: string;
    model: string;
    topN: number;
  };
}

export interface MemoryFragment {
  id: string;
  date: string;
  summary: string;
  mood?: string;
}

export interface SpriteConfig {
  scale: number;
  x: number;
  y: number;
}

export interface SkinSet {
  id: string;
  name: string;
  sprites: Record<string, string>; // emotion -> image URL or base64
}

export interface RoomItem {
    id: string;
    name: string;
    type: 'furniture' | 'decor';
    image: string;
    x: number;
    y: number;
    scale: number;
    rotation: number;
    isInteractive: boolean;
    descriptionPrompt?: string;
}

export interface RoomTodo {
    id: string;
    charId: string;
    date: string;
    /** byUser=true 表示这条是用户自己加进清单的（栖居志·今日清单自主勾画），会同步给角色 */
    items: { text: string; done: boolean; byUser?: boolean }[];
    generatedAt: number;
}

export interface RoomNote {
    id: string;
    charId: string;
    timestamp: number;
    content: string;
    type: 'lyric' | 'doodle' | 'thought' | 'search' | 'gossip';
    relatedMessageId?: number; 
}

export interface ScheduleSlot {
    startTime: string;    // "08:00"
    endTime?: string;     // "09:00" 该时段大致结束时间（可选，仅展示用）
    activity: string;     // "晨跑"
    description?: string; // "在河边慢跑"
    emoji?: string;       // "🏃"
    location?: string;    // "河边"
    /** 该时段的情绪基调（2-4字，如"松弛""专注""烦躁""期待"），用于卡片小标签 */
    mood?: string;
    /** 该时段的能量水平 1-5（1 困乏 / 5 满电），用于卡片小指示 */
    energy?: number;
    innerThought?: string; // 该时段的内心独白，生成时由AI写好，运行时直接注入
    /**
     * 日程锚点来源：
     * - 'self'（默认/缺省）：角色自己安排的活动
     * - 'chat'：从聊天里协调出来的约定/变更（如"晚上八点一起看电影"）——这类是「日程锚点」，
     *   优先级最高，角色会围着它安排其它时段。
     */
    source?: 'self' | 'chat';
    /** 是否为锚定时段：聊天里明确约定、角色应当遵守、不应随意改动的事项 */
    anchored?: boolean;
}

export interface DailySchedule {
    id: string;           // `${charId}_${date}`
    charId: string;
    date: string;         // YYYY-MM-DD
    slots: ScheduleSlot[];
    generatedAt: number;
    coverImage?: string;  // 用户自定义角色看板图 (持久化)
    /**
     * 按时段生成的意识流独白。
     * key = slot 的 startTime（如 "08:00"），value = 截止该时段的完整内心独白。
     * 注入时根据当前时间找到最近的 key，直接使用整段文本，不做拼接。
     */
    flowNarrative?: Record<string, string>;
}

export interface RoomGeneratedState {
    actorStatus: string;
    welcomeMessage: string;
    items: Record<string, { description: string; reaction: string }>;
    actorAction?: string; // e.g. 'idle', 'sleep'
}

export interface BubbleStyle {
    textColor: string;
    backgroundColor: string;
    backgroundImage?: string;
    backgroundImageOpacity?: number;
    borderRadius: number;
    opacity: number;
    
    decoration?: string;
    decorationX?: number;
    decorationY?: number;
    decorationScale?: number;
    decorationRotate?: number;

    avatarDecoration?: string;
    avatarDecorationX?: number;
    avatarDecorationY?: number;
    avatarDecorationScale?: number;
    avatarDecorationRotate?: number;

    voiceBarBg?: string;
    voiceBarActiveBg?: string;
    voiceBarBtnColor?: string;
    voiceBarWaveColor?: string;
    voiceBarTextColor?: string;
}

export interface ChatTheme {
    id: string;
    name: string;
    type: 'preset' | 'custom';
    user: BubbleStyle;
    ai: BubbleStyle;
    customCss?: string;
}

export interface PhoneCustomApp {
    id: string;
    name: string;
    icon: string;
    color: string;
    prompt: string;
}

export interface PhoneEvidence {
    id: string;
    type: 'chat' | 'order' | 'social' | 'delivery' | string;
    title: string;
    detail: string;
    timestamp: number;
    systemMessageId?: number;
    value?: string;
}

export interface PhoneLockQuestion {
    id: string;
    text: string;
}

export interface PhoneLockSubmission {
    passcodeInput?: string;
    answers?: string[];
    reply?: string;
    mood?: string;
}

export interface PhoneLockAttemptRecord {
    at: number;
    passcodeInput: string;
    answers: string[];
    result: 'passcode' | 'question' | 'both' | 'none';
    completedQuestionId?: string;
    reply?: string;
    mood?: string;
}

export interface PhoneLockState {
    id: string;
    active: boolean;
    createdAt: number;
    unlockedAt?: number;
    unlockedBy?: 'passcode' | 'question' | 'both';
    ownerUserName: string;
    charName: string;
    /** 黑屏锁机上方系统提示：留言播完后仍只显示这张锁屏。 */
    message: string;
    /** 用户留给角色看的锁屏留言。 */
    note: string;
    /** 用户设置的口令答案；角色根据提示答对即可解锁。 */
    passcode: string;
    /** 用户完全自定义的题目；角色完成任意一题即可解锁。 */
    questions: PhoneLockQuestion[];
    attempts: PhoneLockAttemptRecord[];
}

/**
 * 查岗·角色专属手机皮肤（每个角色一套，让"翻 TA 手机"的桌面千人千面）。
 * 主要由 char.id 确定性派生（配色/排版），可选地用 LLM 生成一份更贴人设的「手机侧写」
 * （设备名 / 桌面副标 / 一句话 vibe / 一组贴人设的 App），生成后缓存在 phoneState.profile。
 */
export interface PhoneProfile {
    /** 设备名（桌面顶部，如「Ethan 的 iPhone」） */
    deviceName?: string;
    /** 桌面副标题 / 一句话状态 */
    tagline?: string;
    /** 壁纸：CSS 渐变串或图片 url（缺省时按 char.id 派生渐变） */
    wallpaper?: string;
    /** 主题强调色 hex */
    accent?: string;
    /** 配色方案 id（确定性派生，决定深浅/色相） */
    paletteId?: string;
    /** LLM 生成的一组贴人设 App（覆盖默认 App 集的展示名/图标/取数指令） */
    apps?: Array<{ id: string; name: string; icon: string; color: string; kind: string; prompt?: string }>;
    /** 是否由 LLM 生成过（用于按钮文案 ✎ 装点 / ↻ 重新装点） */
    generated?: boolean;
    generatedAt?: number;
}

/** 回望小报（昨日来信 / 回望·周章 / 回望·月章）：把过去一段时间整理成娱乐小报 */
export interface Tabloid {
    /** 'day' 昨日来信 / 'week' 回望·周章 / 'month' 回望·月章 */
    period: 'day' | 'week' | 'month';
    /** 小报头条大标题 */
    headline: string;
    /** 副标 / 期号小字 */
    subhead?: string;
    /** 主笔（角色）寄语：像编辑手记一样的开场白 */
    editorNote?: string;
    /** 栏目：每条是一个娱乐版块 */
    sections: Array<{ tag: string; title: string; body: string; quote?: string }>;
    /** 花絮 / 边栏小料 */
    sidebar?: string[];
    /** 结尾签名 */
    signoff?: string;
    /** 覆盖的时间窗口 [from, to) */
    rangeFrom: number;
    rangeTo: number;
    generatedAt: number;
}

/**
 * SillyTavern 角色卡内嵌世界书 (character_book / lorebook) 的原始设定。
 * Moro 的世界书是「挂载即全文注入」，没有 ST 的关键词扫描激活机制，
 * 导入时把条目级（局部）+ 书级（全局）设置原样保留在这里：
 * 一来保证「全部设定信息」不丢，二来为以后实现关键词激活留好数据。
 */
export interface WorldbookSTData {
    // ---- 书级（全局）设置 ----
    bookName?: string;
    bookDescription?: string;
    scanDepth?: number;
    tokenBudget?: number;
    recursiveScanning?: boolean;
    bookExtensions?: Record<string, any>;
    // ---- 条目级（局部）设置 ----
    entry?: {
        id?: number | string;
        name?: string;
        comment?: string;
        keys?: string[];           // 触发关键词
        secondaryKeys?: string[];  // 二级过滤词
        selective?: boolean;       // 需同时命中二级词
        constant?: boolean;        // 常驻（蓝灯）
        enabled?: boolean;         // ST 里是否启用
        insertionOrder?: number;   // 插入顺序
        caseSensitive?: boolean;
        priority?: number;
        position?: string | number; // 'before_char' / 'after_char' / ST 内部数字位
        extensions?: Record<string, any>; // ST 私有字段（depth/probability 等）全量兜底
    };
}

/**
 * 世界书条目的插入位置（对齐 SillyTavern 的 position 语义）：
 * - 'before_char'：角色定义（### 你的身份）之前
 * - 'after_char'：角色定义之后（默认，即现有「扩展设定集」块的位置）
 * - 'depth_system' / 'depth_user' / 'depth_assistant'：以指定 role 注入到聊天历史
 *   倒数第 depth 条消息处（@Depth）。仅主聊天链路真正按深度插消息；
 *   其他只产出单条 system prompt 的调用方会内联降级到 after_char 块。
 */
export type WorldbookPosition =
    | 'before_char'
    | 'after_char'
    | 'depth_system'
    | 'depth_user'
    | 'depth_assistant';

export interface Worldbook {
    id: string;
    title: string;
    content: string;
    category: string;
    createdAt: number;
    updatedAt: number;
    /**
     * 条目开关：false = 关闭（任何场景都不注入）。undefined 视为 true（向后兼容）。
     * 整本书的开关不存在条目上 —— 按 category 存在 localStorage
     * （见 utils/worldbookRuntime.ts 的 GROUP_TOGGLES_KEY）。
     */
    enabled?: boolean;
    /**
     * 旧版条目级作用域字段，仅为导入/备份兼容保留。
     * 当前运行时的全局/局部由「整本世界书分组」决定：
     * 见 utils/worldbookRuntime.ts 的 GROUP_SCOPES_KEY。
     */
    scope?: 'local' | 'global';
    /** 插入位置，undefined = 'after_char' */
    position?: WorldbookPosition;
    /** position 为 depth_* 时的注入深度（倒数第几条消息前），默认 4（同 ST） */
    depth?: number;
    /** 同一位置内的插入顺序，小的在前（同 ST 的最终生效顺序），默认 100 */
    order?: number;
    /**
     * 激活方式（ST 关键词扫描移植）：
     * - 'always'（默认，即 ST 的常驻/蓝灯 🔵）：只要开关开着就注入
     * - 'keyword'（ST 的绿灯 🟢）：扫描最近的聊天消息，命中关键词才注入。
     *   仅主聊天链路（buildChatRequestPayload 设置扫描上下文）执行扫描；
     *   没有聊天上下文的调用方（约会等单 prompt 场景）不注入关键词条目。
     */
    activation?: 'always' | 'keyword';
    /** 触发关键词（任一命中即激活），activation='keyword' 时生效 */
    keys?: string[];
    /** 二级过滤词（selective=true 时需同时命中任一） */
    secondaryKeys?: string[];
    /** 需同时命中二级过滤词（同 ST selective） */
    selective?: boolean;
    /** 关键词匹配大小写敏感，默认不敏感（同 ST case_sensitive） */
    caseSensitive?: boolean;
    /** 关键词扫描深度：扫最近 N 条消息，默认 4（同 ST scan_depth 语义） */
    scanDepth?: number;
    /** 'sillytavern' = 从 SillyTavern 角色卡导入的条目 */
    source?: 'sillytavern';
    /** SillyTavern 原始设定信息（仅 source === 'sillytavern' 时存在） */
    stData?: WorldbookSTData;
}

// --- NOVEL / CO-WRITING TYPES ---
export interface NovelProtagonist {
    id: string;
    name: string;
    role: string; // e.g. "Protagonist", "Villain"
    description: string;
}

export interface NovelSegment {
    id: string;
    role?: 'writer' | 'commenter' | 'analyst'; 
    type: 'discussion' | 'story' | 'analysis'; 
    authorId: string; 
    content: string;
    timestamp: number;
    focus?: string; 
    targetSegId?: string;
    meta?: {
        tone?: string;
        suggestion?: string;
        reaction?: string;
        technique?: string;
        mood?: string;
    };
}

export interface NovelBook {
    id: string;
    title: string;
    subtitle?: string; 
    summary: string;
    coverStyle: string; 
    coverImage?: string; 
    worldSetting: string;
    collaboratorIds: string[]; 
    protagonists: NovelProtagonist[];
    segments: NovelSegment[];
    createdAt: number;
    lastActiveAt: number;
}

// =====================================================================
// --- VR WORLD ("页外") TYPES ---
// 角色自主登入的虚拟世界。定时器驱动每个角色独立调用一次 LLM，在某个房间
// 完成一次活动（v1：图书馆看小说），产出一张活动卡注入该角色的 1v1 聊天，
// 天然被上下文与记忆总结捕捉。
// =====================================================================

/** 虚拟世界里的房间。 */
export type VRRoomId = 'plaza' | 'library' | 'music' | 'guestbook' | 'gym' | 'postoffice' | 'theater';

/** 全局小说库里的一本书（所有角色共享原文，各自留批注、各自书签）。 */
export interface VRWorldNovel {
    id: string;
    title: string;
    author?: string;
    /** 简介，喂给角色当背景，也用于 UI 展示 */
    summary?: string;
    /** 原文按阅读单元切好的段落块（每块 ~数百字，便于定位批注与推进书签）。 */
    segments: VRNovelSegment[];
    /** 总字数（缓存，UI 展示用） */
    totalChars: number;
    createdAt: number;
    updatedAt: number;
}

/** 小说里的一个阅读单元（原文段落块）。 */
export interface VRNovelSegment {
    /** 段落索引（0-based，等于在 segments 数组里的位置，持久化以防重排） */
    idx: number;
    /** 原文内容 */
    text: string;
    /** 字数（缓存） */
    chars: number;
}

/**
 * 一条批注。挂在 (novelId, segIdx) 上，可被任何角色吐槽（targetAnnotationId 指向被吐槽的批注）。
 * 全局存在 VRWorldNovel 之外的独立集合里——见 db 的 vr_annotations 字段。
 */
export interface VRNovelAnnotation {
    id: string;
    novelId: string;
    /** 批注锚定的段落索引 */
    segIdx: number;
    /** 作者角色 id（user 留批注时为 'user'） */
    authorId: string;
    /** 作者展示名（落库冗余，避免角色删除后丢名） */
    authorName: string;
    /** 批注/吐槽正文 */
    content: string;
    /** 若是"吐槽别人的吐槽"，指向被吐槽的批注 id */
    targetAnnotationId?: string;
    createdAt: number;
}

/** 角色在虚拟世界里的个人状态（挂在 CharacterProfile.vrState）。 */
export interface VRWorldCharState {
    /** 是否启用该角色的自主登入（独立于主动发消息 proactiveConfig） */
    enabled: boolean;
    /** 自主登入间隔（分钟，30 对齐；默认 120 = 2h） */
    intervalMinutes: number;
    /**
     * 每本小说的独立书签：novelId -> 下一次该从第几个 segment 开始读。
     * 这是"每个角色书签不一样"的落点。
     */
    novelBookmarks?: Record<string, number>;
    /** 最近一次活动落在哪个房间（UI 立绘站位用） */
    currentRoom?: VRRoomId;
    /** 最近一次活动时间戳（UI / 调度展示用） */
    lastActiveAt?: number;
    /** 该角色专属 API 覆盖（用户可单独为「页外」活动配 api）；不设则回落全局 apiConfig。 */
    api?: { baseUrl: string; apiKey: string; model: string };
    /**
     * 角色在「页外」里的 chibi 形象（Q版小人）。启用自主登入时要求设定，可随时编辑。
     * img 不设时回退到角色立绘/头像。
     */
    chibi?: VRChibi;
    /** 已存的多套形象（换装位）：随时一键切换；切换会把选中那套写回 chibi。 */
    chibiLooks?: VRChibi[];
}

/** 一套 chibi 形象（Q版小人）。捏小人功能与「世界房间」换装共用。 */
export interface VRChibi {
    /** 形象图（透明背景 PNG，来自捏人器 transparentDataUrl） */
    img: string;
    /** 捏人器导出的完整状态，回填用于再编辑（state.selected 可作为 presets） */
    state?: any;
    /** 站位缩放（默认 1） */
    scale?: number;
    /** 垂直微调（px，负数上移，默认 0） */
    offsetY?: number;
    /** 水平微调（px，负数左移，默认 0） */
    offsetX?: number;
    /** 旋转角度（deg，默认 0） */
    rotate?: number;
    /** 透明度（0.35~1，默认 1） */
    opacity?: number;
    /** 是否显示投影（默认 true） */
    shadow?: boolean;
    /** 脚下/身后光环样式 */
    halo?: 'none' | 'soft' | 'mint' | 'violet' | 'warm';
    /** 是否水平翻转 */
    flip?: boolean;
    /** 房间内姿势/动画（'idle' | 'bob' | 'wiggle' | 'spin' | 'jump' | 'nod'…），驱动小人在世界里更生动。 */
    pose?: string;
    /** 贴纸装饰（emoji，挂在小人头顶），手账拼贴味。 */
    sticker?: string;
    /** 贴纸水平偏移（px） */
    stickerX?: number;
    /** 贴纸垂直偏移（px） */
    stickerY?: number;
    /** 贴纸缩放（默认 1） */
    stickerSize?: number;
    /** 是否显示在线名牌（默认 true） */
    nameVisible?: boolean;
    /** 这套形象的命名（换装位标签，选填）。 */
    name?: string;
}

/** 注入聊天的 vr_card 消息的 metadata 结构。 */
export interface VRCardMeta {
    vrCard: true;
    room: VRRoomId;
    /** 活动概述（steam 提示式，UI 标题） */
    activity: string;
    novelId?: string;
    novelTitle?: string;
    /** 本次读到的段落范围 [from, to)（仅 library） */
    segRange?: [number, number];
    /** 本次写下的批注摘要（保留正文，原文省略） */
    annotationExcerpts?: string[];
    /** 带段落锚点的批注引用（用于从动态点回原文跳转） */
    annotationRefs?: { segIdx: number; text: string }[];
    // --- 听歌房专用 ---
    /** 本次评/听的当前歌（名 - 歌手） */
    songLabel?: string;
    /** 本次点/排进队列的自己的歌 */
    queuedLabel?: string;
    /** 此刻的行为描述（盯着跳/跟唱/给user录…；娱乐室也用） */
    behavior?: string;
    // --- 留言簿专用 ---
    /** 本次发到留言簿的话（保留正文） */
    boardPost?: string;
    /** 本次发到留言簿的所有发言（原样，含回复对象），用于同步进 1v1 聊天/记忆 */
    boardPosts?: { content: string; replyToName?: string }[];
    /** 回复了谁 */
    boardReplyToName?: string;
    /** 这条卡片是"用户在留言簿发言"广播给该 char 的 */
    userBoardPost?: boolean;
    // --- 邮局专用 ---
    /** 本次写信/回信的正文摘要 */
    letterExcerpt?: string;
}

/** 邮局：一封信收到的回复（留档用）。 */
export interface VRLetterReply {
    pen: string;
    content: string;
    createdAt: number;
}

/**
 * 邮局信件（本地存档 + 队列）。
 * box='outbox'：我方角色写的漂流信（待寄出→已寄出→收到回复留档）。
 * box='inbox' ：从别的用户那抽到的信（待回信→待发送回信→已发送）。
 */
export interface VRLetter {
    id: string;                 // 本地 id
    box: 'outbox' | 'inbox';
    pen: string;                // 笔名（写信角色名 / 远端寄信方笔名）
    content: string;
    createdAt: number;
    charId?: string;            // 写这封信/回信的角色

    // outbox
    status?: 'queued' | 'sent' | 'archived' | 'sealed';  // 待寄出 / 已寄出 / 收到回复留档 / 角色已读并封存
    remoteId?: string;          // 寄出后服务端分配的远端 id
    released?: boolean;         // 作者已「停止传播」：后端已删、退出公共池，本地仍留档
    sentAt?: number;
    repliesReceived?: VRLetterReply[];
    /** 原作者角色读过回信后的感触（写完即封存，使命完成） */
    reaction?: { content: string; createdAt: number };

    // inbox
    remoteLetterId?: string;    // 远端信 id（回信时用）
    replyStatus?: 'none' | 'queued' | 'sent'; // 未回 / 待发送回信 / 已发送
    reply?: { charId: string; pen: string; content: string; createdAt: number; userNote?: string };
    fetchedAt?: number;

    // 互动热度缓存（服务端为准；UI 即时反馈用）
    likes?: number;             // 点赞数
    dislikes?: number;          // 点踩(=举报)数
    views?: number;             // 被抽到/浏览次数
    myVote?: 1 | -1 | 0;        // 我对这封信的投票（inbox 抽到的信）
}

/** 听歌房队列项。 */
export interface VRMusicQueueItem {
    song: CharPlaylistSong;
    charId: string;
    charName: string;
}

/** 留言簿（共享版聊墙）的一条留言。 */
export interface VRGuestbookMessage {
    id: string;
    /** 'user' = 用户本人，其余为 charId */
    authorId: string;
    authorName: string;
    content: string;
    /** 若是回复某条留言 */
    replyToId?: string;
    replyToName?: string;
    createdAt: number;
}

/** 留言簿共享状态（单例，所有角色 + 用户共用一面墙）。 */
export interface VRGuestbookState {
    id: string; // 'board' 单例
    messages: VRGuestbookMessage[];
    updatedAt: number;
}

/** 听歌房共享状态（单例，所有角色共用一个循环队列）。 */
export interface VRMusicRoomState {
    id: string; // 'state' 单例
    nowPlaying?: {
        song: CharPlaylistSong;
        charId: string;
        charName: string;
        /** 选曲心境/理由 */
        vibe?: string;
        since: number;
    };
    queue: VRMusicQueueItem[];
    updatedAt: number;
}

// ============ 剧院 / 话剧部门 ============

/** 剧本里的一个登场角色（名字 + 大致性格，供选角匹配/演绎用）。 */
export interface VRPlayRole {
    name: string;
    persona: string;
}

/** 一份投稿剧本（角色创作 / 用户写 / LLM 代写 / 上传）。 */
export interface VRScript {
    id: string;
    title: string;
    /** 一句话简介（"创作了关于 xxx 的舞台剧"用） */
    logline: string;
    roles: VRPlayRole[];
    /** 完整剧本正文（固定格式：幕/场 + 角色台词 + （旁白）） */
    body: string;
    /** 作者 id：'user' | charId | 'llm' */
    authorId: string;
    authorName: string;
    source: 'char' | 'user' | 'llm' | 'upload';
    createdAt: number;
}

/** 编排时的 LLM 调用模式：逐角色各调一次（精准，N 次）/ 固定两次（省，可能 OOC）。 */
export type VRStageMode = 'per-role' | 'two-call';

/** 选角：剧本角色 → 演员（char 或 临时 NPC）。 */
export interface VRCastAssign {
    roleName: string;
    actorId: string;   // charId | npc_xxx
    actorName: string;
    isNpc: boolean;
    /** NPC 的捏脸立绘（透明 PNG dataUrl） */
    npcChibi?: string;
}

/** 某演员读完剧本后给导演的意见（吐槽 / 改台词动作 / 配不配合）。 */
export interface VRActorNote {
    actorId: string;
    actorName: string;
    roleName: string;
    /** 一句吐槽 / 想法（UI 展示） */
    note: string;
    /** 角色按自己本色重写过的"我这部分台词 / 怎么演"（可空 = 照原本演） */
    lines?: string;
    /** 绝对禁忌：导演绝不能让该角色做的事（硬红线，可空） */
    taboo?: string;
    /** 给导演的写作指导（这条线该怎么处理，可空） */
    direction?: string;
    /** 态度光谱：欣然 / 配合 / 勉强 / 隐忍 / 抵触 / 拒演（按角色性子自然落点，不必都硬刚） */
    attitude?: string;
    /** 是否配合（由 attitude 推导：抵触/拒演 = false） */
    cooperative: boolean;
}

/** 最终演出脚本的一拍（台词气泡 / 旁白 / 上场 / 下场）。 */
export interface VRStageLine {
    kind: 'line' | 'narration' | 'enter' | 'exit';
    /** line/enter/exit 时是谁 */
    actorName?: string;
    /** 台词气泡内容 / 旁白文字 */
    text: string;
}

/** 一场已收录的演出（导演整合后的成品 + 观众锐评 + 评级）。 */
export interface VRStagedPlay {
    id: string;
    scriptId: string;
    title: string;
    logline: string;
    cast: VRCastAssign[];
    notes: VRActorNote[];
    /** 导演整合后的可演出脚本 */
    stage: VRStageLine[];
    /** 赛博观众锐评 */
    reviews: { critic: string; text: string }[];
    /** 评级（如 S / A / ★★★★☆） */
    rating: string;
    createdAt: number;
}

/**
 * 捏脸系统自定义部件（开发模式追加）。运行时由 CreatorIframe 读出，随 like520_init
 * 以 extraItems 注入捏人器，合并进对应类目的 PARTS。520 / 页外 都会拿到。
 */
export interface CustomCreatorPart {
    id: string;
    /** 归属类目 key（如 skin / fronthair / outfit …，须与捏人器 PARTS 的 key 对应） */
    categoryKey: string;
    /** 面板里显示的名字 */
    name: string;
    /** 部件图（透明 PNG 的 data URL，须与捏人器画布同尺寸/同锚点） */
    src: string;
    /** 是否可被换色（对应 item.tintable） */
    tintable?: boolean;
    createdAt: number;
}

// --- SONGWRITING APP TYPES ---
export type SongMood = 'happy' | 'sad' | 'romantic' | 'angry' | 'chill' | 'epic' | 'nostalgic' | 'dreamy';
export type SongGenre = 'pop' | 'rock' | 'ballad' | 'rap' | 'folk' | 'electronic' | 'jazz' | 'rnb' | 'free';

export interface SongLine {
    id: string;
    authorId: string; // 'user' or charId
    content: string;
    section: 'intro' | 'verse' | 'pre-chorus' | 'chorus' | 'bridge' | 'outro' | 'free';
    annotation?: string; // AI guidance note on this line
    timestamp: number;
    isDraft?: boolean; // true = not selected as final lyrics, kept as draft record
}

export interface SongComment {
    id: string;
    authorId: string; // charId
    type: 'guidance' | 'praise' | 'suggestion' | 'teaching' | 'reaction';
    content: string;
    targetLineId?: string; // which line this comment is about
    timestamp: number;
}

export interface ChordInfo {
    root: string;       // e.g. 'C', 'D', 'Ab'
    quality: string;    // e.g. 'maj', 'min', '7', 'maj7', 'sus4'
    display: string;    // e.g. 'C', 'Am', 'G7', 'Fmaj7'
    midi: number;       // root note MIDI number (for audio)
}

export interface MelodyNote {
    midi: number;       // MIDI note number
    duration: number;   // in beats
    vowel: number;      // index into vowel formant table (0=a,1=o,2=e,3=i,4=u)
}

export interface SectionArrangement {
    section: string;            // matches SongLine.section
    chords: ChordInfo[];        // one chord per line in this section
    melodies?: MelodyNote[][];  // melodies[lineIdx] = notes for that line
}

export interface SongArrangement {
    rootNote: string;           // e.g. 'C', 'A'
    scale: 'major' | 'minor';
    bpm: number;
    sections: SectionArrangement[];
    instruments: {
        piano: boolean;
        bass: boolean;
        drums: boolean;
        melody: boolean;
    };
    drumPattern: 'basic' | 'upbeat' | 'halftime' | 'shuffle';
}

// Provider identifier for AI-generated audio. Each one has its own pricing
// / length cap / API path; the actual call site decides which to use.
//   - 'minimax-free' → music-2.6-free, free tier, 60s cap
//   - 'minimax-paid' → music-2.6, Token-Plan price, 60s cap
//   - 'ace-step'     → Replicate lucataco/ace-step, $0.015/song, 4-min cap
export type MusicProvider = 'minimax-free' | 'minimax-paid' | 'ace-step';

// AI-rendered audio attached to a SongSheet.
// Audio blob lives in the IndexedDB assets store keyed by `assetKey`,
// so the sheet itself stays small and JSON-serializable for sync/export.
export interface SongAudio {
    assetKey: string;          // DB.getAssetRaw / saveAssetRaw key
    mimeType: string;          // e.g. "audio/mpeg", "audio/wav"
    durationSec?: number;
    generatedAt: number;
    provider: MusicProvider;
    // Snapshot of the inputs used so we can show "regenerate when lyrics changed"
    promptHash: string;
    tagsUsed: string;
    lyricsLineCount: number;
}

export interface SongSheet {
    id: string;
    title: string;
    subtitle?: string;
    genre: SongGenre;
    mood: SongMood;
    bpm?: number;
    key?: string; // e.g. "C major", "A minor"
    collaboratorId: string; // the character guiding the user
    lines: SongLine[];
    comments: SongComment[];
    status: 'draft' | 'completed';
    coverStyle: string; // gradient/color identifier
    createdAt: number;
    lastActiveAt: number;
    completedAt?: number;
    arrangement?: SongArrangement;
    audio?: SongAudio;
    // Custom style prompt — when set, overrides the preset/genre/mood-derived tags.
    // Plain comma-separated English string the user (or LLM helper) authored.
    // Reused by both ACE-Step (`tags` field) and MiniMax music (`prompt` field).
    aceStepCustomTags?: string;
    // Last-used music provider for this song — drives the modal's default selection.
    musicProvider?: MusicProvider;
    // Lyric structure template chosen at creation. Drives the structure-guide
    // banner shown in the write view so user/char don't write randomly.
    lyricTemplate?: string;
}

// --- DATE APP TYPES ---
export interface DialogueItem {
    text: string;
    emotion?: string;
}

export interface DateState {
    dialogueQueue: DialogueItem[];
    dialogueBatch: DialogueItem[];
    currentText: string;
    bgImage: string;
    currentSprite: string;
    isNovelMode: boolean;
    timestamp: number;
    peekStatus: string; 
}


export interface SpecialMomentRecord {
    content: string;
    image?: string; // base64 PNG (stored separately so export tools can handle it)
    timestamp: number;
    source?: 'generated' | 'migrated';
    /** Free-form per-event extra data (e.g. like520 captureface state, anchors, etc.) */
    customData?: Record<string, any>;
}

// --- BANK / SHOP GAME TYPES (NEW) ---
export interface BankTransaction {
    id: string;
    amount: number;
    category: string;
    note: string;
    timestamp: number;
    dateStr: string; // YYYY-MM-DD
    /** 进账 / 支出。默认 expense（兼容旧数据） */
    type?: 'income' | 'expense';
    /** 自动流水来源，如生活拟 / 心意铺 / 饭票 / 聊天。 */
    sourceApp?: string;
    /** 来源业务 id，如订单 id、岗位 id、股票代码。 */
    sourceId?: string;
    /** 更细的资金流类型：salary / shop / stock / loan / company / shopping 等。 */
    kind?: string;
    /** 是否由钱包变动自动生成。 */
    auto?: boolean;
    /** 这笔变动后的钱包余额。 */
    balanceAfter?: number;
    /** 创建者：user 手动 / system 自动 / character 角色侧生成。 */
    createdBy?: 'user' | 'system' | 'character';
    /** 关联实体 id，如公司 id、贷款 id、持仓代码。 */
    relatedEntityId?: string;
    /** 角色对这笔现实账目的点评（AI 生成，一笔一条） */
    charComment?: { charId: string; charName: string; text: string; ts: number };
}

export interface AdjustBalanceMeta {
    note?: string;
    category?: string;
    sourceApp?: string;
    sourceId?: string;
    kind?: string;
    relatedEntityId?: string;
    createdBy?: 'user' | 'system' | 'character';
    /** false = 只改余额，不自动生成生活拟流水。 */
    ledger?: boolean;
}

/** 账本里一条评论（用户 ↔ 角色互评） */
export interface LedgerComment {
    author: 'user' | 'character';
    text: string;
    ts: number;
}

/**
 * 角色账本：角色按人设给自己记的一条账（AI 生成的进账/支出），
 * 用户可在下面留言评论，角色会 AI 回复。与用户钱包、店铺均无关。
 */
export interface CharLedgerEntry {
    id: string;
    charId: string;
    type: 'income' | 'expense';
    amount: number;
    note: string;
    dateStr: string;   // YYYY-MM-DD
    ts: number;
    comments?: LedgerComment[];
}

export interface SavingsGoal {
    id: string;
    name: string;
    targetAmount: number;
    currentAmount: number; 
    icon: string;
    isCompleted: boolean;
}

export interface ShopStaff {
    id: string;
    name: string;
    avatar: string; // Emoji or URL
    role: 'manager' | 'waiter' | 'chef';
    fatigue: number; // 0-100, >80 stops working
    maxFatigue: number;
    hireDate: number;
    personality?: string; // New: Custom personality
    x?: number; // New: Position X (0-100)
    y?: number; // New: Position Y (0-100)
    // Pet System
    ownerCharId?: string; // If set, this staff is a "pet" belonging to this character
    isPet?: boolean; // Flag to indicate this is a pet
    scale?: number; // Display scale (0.4-2)
}

export interface ShopRecipe {
    id: string;
    name: string;
    icon: string;
    cost: number; // AP cost to unlock
    appeal: number; // Contribution to shop appeal
    isUnlocked: boolean;
    /** 售价：营业时每卖出一份的收入（进钱包）。未设则用 appeal 估算。 */
    price?: number;
}

/** 一条顾客评价（营业时由 NPC / 角色顾客留下，影响店铺口碑） */
export interface ShopReview {
    id: string;
    authorName: string;
    avatar: string;       // emoji 或 URL
    rating: number;       // 1~5 星
    text: string;
    productName?: string; // 点的什么
    ts: number;
    isNpc?: boolean;
    aiPending?: boolean;  // 已提交 AI 润色、等待返回（UI 可显示「客人正在写…」）
}

/** 回头客 / VIP：累计到访（成功消费）越多，越忠诚——常客小费更高、评分更稳。 */
export interface ShopRegular {
    id: string;        // 'npc:名字' 或 'char:角色id'
    name: string;
    avatar: string;    // emoji 或 URL
    isNpc: boolean;
    visits: number;    // 累计成功消费次数
}

export interface BankConfig {
    dailyBudget: number;
    currencySymbol: string;
}

export interface BankGuestbookItem {
    id: string;
    authorName: string;
    avatar?: string;
    content: string;
    isChar: boolean;
    charId?: string;
    timestamp: number;
    systemMessageId?: number; // Linked system message ID for deletion
}

// --- DOLLHOUSE / ROOM DECORATION TYPES ---
export interface DollhouseSticker {
    id: string;
    url: string;       // image URL or emoji
    x: number;         // % position within the surface
    y: number;
    scale: number;
    rotation: number;
    zIndex: number;
    surface: 'floor' | 'leftWall' | 'rightWall';
}

export interface DollhouseRoom {
    id: string;
    name: string;
    floor: number;         // 0 = ground floor, 1 = second floor
    position: 'left' | 'right';
    isUnlocked: boolean;
    layoutId: string;      // references a RoomLayout template
    wallpaperLeft?: string;  // CSS gradient or image URL
    wallpaperRight?: string;
    floorStyle?: string;     // CSS gradient or image URL
    roomTextureUrl?: string; // optional full-room overlay image
    roomTextureScale?: number;
    stickers: DollhouseSticker[];
    staffIds: string[];      // staff assigned to this room
}

export interface RoomLayout {
    id: string;
    name: string;
    icon: string;
    description: string;
    apCost: number;
    floorWidthRatio: number;   // relative width (0-1)
    floorDepthRatio: number;   // relative depth (0-1)
    hasCounter: boolean;
    hasWindow: boolean;
}

export interface DollhouseState {
    rooms: DollhouseRoom[];
    activeRoomId: string | null;   // currently zoomed-in room
    selectedLayoutId?: string;
}

export interface BankShopState {
    actionPoints: number;
    shopName: string;
    shopLevel: number;
    appeal: number; // Total Appeal
    background: string; // Custom BG
    staff: ShopStaff[];
    unlockedRecipes: string[]; // IDs
    activeVisitor?: {
        charId: string;
        message: string;
        timestamp: number;
        giftAp?: number; // Optional gift from visitor
        roomId?: string;
        x?: number;
        y?: number;
        scale?: number;
    };
    guestbook?: BankGuestbookItem[];
    dollhouse?: DollhouseState;
    /** 上次「营业」结算的时间戳（用于营业冷却） */
    lastBusinessAt?: number;
    /** 店铺累计营业额（进过钱包的总收入，仅作展示统计） */
    totalRevenue?: number;
    /** 顾客评价（最近若干条，营业时产生，决定口碑评分） */
    reviews?: ShopReview[];
    /** 各商品库存（recipeId → 剩余份数）。营业卖出扣减，进货花钱补充。 */
    stock?: Record<string, number>;
    /** 回头客 / VIP（identity id → 记录）。营业时累计到访，常客会回头光顾。 */
    regulars?: Record<string, ShopRegular>;
    /** 挂机营业额：离店期间持续累计、点金币收进钱包（上限见 IDLE_CAP_HOURS）。 */
    pendingRevenue?: number;
    /** 上次把流逝时间折算成 pendingRevenue 的锚点时间戳。 */
    lastAccrualAt?: number;
    /** 当前天气/限时事件（影响客流与挂机产出），到期后随机切换。 */
    weather?: { id: string; until: number };
}

export type BankJobPayCycle = 'daily' | 'monthly';
export type BankJobApplicationStatus = 'hired' | 'trial' | 'rejected' | 'scammed';
export type BankJobApplicationStage = 'submitted' | 'screening' | 'assessment' | 'interview' | 'offer' | 'hired' | 'trial' | 'rejected' | 'scammed';
export type BankLoanChannel = 'bank' | 'formal' | 'shady';
export type BankLifeSeason = 'spring' | 'summer' | 'autumn' | 'winter';
export type BankLifePlanKind = 'work' | 'shop' | 'interview' | 'company' | 'loan' | 'invest' | 'rest';

export interface BankLifeDailyPlanItem {
    id: string;
    kind: BankLifePlanKind;
    label: string;
    detail: string;
    done?: boolean;
    tone?: 'good' | 'warn' | 'bad' | 'info';
}

export interface BankBusinessTemplate {
    id: string;
    name: string;
    icon: string;
    vibe: string;
    customerGroups: string[];
    margin: number;
    risk: 1 | 2 | 3 | 4 | 5;
    products: { id: string; name: string; price: number; cost: number; appeal: number }[];
    events: string[];
}

export interface BankLifeShopProduct {
    id: string;
    name: string;
    price: number;
    cost: number;
    stock: number;
    appeal: number;
}

export interface BankJobPosting {
    id: string;
    category: string;
    title: string;
    employer: string;
    salaryMin: number;
    salaryMax: number;
    payCycle: BankJobPayCycle;
    payDay?: number;
    intensity: number; // 1-5
    requirements: string[];
    benefits: string[];
    riskTags: string[];
    description: string;
    location?: string;
    education?: string;
    experienceRequired?: string;
    workTime?: string;
    companySize?: string;
    tags?: string[];
    bossName?: string;
    bossTitle?: string;
    companyIntro?: string;
    black?: boolean;
    successBias?: number;
}

export interface BankJobEmployment extends BankJobPosting {
    startedAt: string;
    accruedWage: number;
    daysWorked: number;
    trialUntil?: string;
}

export interface BankJobApplication {
    id: string;
    postingId: string;
    title: string;
    employer: string;
    status: BankJobApplicationStatus;
    stage?: BankJobApplicationStage;
    score?: number;
    questions?: { id: string; question: string; answer?: string; score?: number }[];
    offerSalary?: number;
    riskNote?: string;
    chatMessages?: { role: 'boss' | 'user' | 'system'; content: string; at: string }[];
    resumeSnapshot?: BankResumeProfile;
    aiReview?: { score: number; strengths: string[]; weaknesses: string[]; suggestion: string };
    dateStr: string;
    message: string;
}

export interface BankPendingWage {
    id: string;
    title: string;
    employer: string;
    amount: number;
    payDate: string;
    note: string;
}

export interface BankStockQuote {
    symbol: string;
    name: string;
    industry: string;
    price: number;
    previousPrice: number;
    changePct: number;
    trend: 'up' | 'flat' | 'down';
    risk: 1 | 2 | 3 | 4 | 5;
    news: string;
    eventTags?: string[];
    open?: number;
    high?: number;
    low?: number;
    marketCap?: number;
    pe?: number;
    turnoverRate?: number;
    bidAsk?: { bid: number; ask: number; bidVolume: number; askVolume: number };
    newsList?: { id: string; title: string; source: string; dateStr: string; tone?: 'good' | 'warn' | 'bad' | 'info' }[];
    history?: { dateStr: string; open: number; high: number; low: number; close: number; volume: number }[];
    intraday?: { time: string; price: number; volume: number }[];
    aiReason?: string;
}

export interface BankStockHolding {
    symbol: string;
    shares: number;
    avgCost: number;
}

export interface BankCompanyState {
    id: string;
    name: string;
    direction: string;
    cash: number;
    reputation: number;
    employees: number;
    stress: number;
    cumulativeProfit: number;
    foundedAt: string;
    cashflow?: { dateStr: string; revenue: number; cost: number; profit: number; note: string }[];
    orders?: { id: string; title: string; client: string; value: number; difficulty: number; status: 'open' | 'active' | 'done' | 'lost' }[];
    risks?: string[];
    pendingIssue?: {
        id: string;
        title: string;
        description: string;
        kind?: 'order' | 'employee' | 'marketing' | 'tax' | 'risk' | 'cashflow';
        options: { id: string; label: string; cashDelta: number; reputationDelta: number; stressDelta: number; employeeDelta?: number; orderId?: string }[];
    };
}

export interface BankLoan {
    id: string;
    channel: BankLoanChannel;
    productName?: string;
    principal: number;
    outstanding: number;
    interestDue: number;
    dailyRate: number;
    borrowedAt: string;
    dueDate: string;
    overdueDays: number;
    note: string;
    reviewStatus?: 'approved' | 'rejected' | 'manual';
    contractTerms?: string[];
    repaymentPlan?: { dueDate: string; amount: number; status: 'pending' | 'paid' | 'overdue' }[];
    creditProfile?: BankLoanCreditProfile;
    reviewReason?: string;
    serviceFee?: number;
    collectionRisk?: string;
}

export interface BankLifeEvent {
    id: string;
    dateStr: string;
    title: string;
    detail: string;
    tone?: 'good' | 'warn' | 'bad' | 'info';
    amount?: number;
}

export interface BankLifeAiEvent extends BankLifeEvent {
    source?: 'ai' | 'system';
    category?: 'daily' | 'career' | 'market' | 'company' | 'loan' | 'shop';
    choices?: { id: string; label: string; effectHint: string }[];
}

export interface BankResumeProfile {
    name: string;
    headline: string;
    expectedSalaryMin?: number;
    expectedSalaryMax?: number;
    expectedCategories: string[];
    skills: string[];
    experience: { id: string; title: string; company: string; detail: string }[];
    education?: string;
    selfIntro: string;
    updatedAt: number;
}

export interface BankJobSearchSession {
    id: string;
    query: string;
    category: string;
    filters: {
        salaryMin?: number;
        payCycle?: BankJobPayCycle | 'any';
        risk?: 'any' | 'safe' | 'high-risk';
        location?: string;
    };
    generatedAt: string;
    source: 'preset' | 'ai';
}

export interface BankMarketPulse {
    id: string;
    dateStr: string;
    headline: string;
    summary: string;
    affectedSymbols: string[];
    sentiment: 'bullish' | 'neutral' | 'bearish';
    source: 'ai' | 'system';
}

export interface BankLoanCreditProfile {
    score: number;
    incomeStability: number;
    debtPressure: number;
    repaymentHistory: number;
    riskLevel: 'low' | 'medium' | 'high' | 'danger';
    reasons: string[];
    updatedAt: string;
}

export interface BankLifeState {
    version: number;
    dateStr: string;
    dayIndex: number;
    weekDay: number;
    season: BankLifeSeason;
    mood: number;
    energy: number;
    health: number;
    dailyPlan: BankLifeDailyPlanItem[];
    shopUnlocked: boolean;
    shopBusinessType?: string;
    shopBusinessName?: string;
    shopProducts?: BankLifeShopProduct[];
    shopCustomers?: string[];
    shopEvents?: BankLifeEvent[];
    currentJob?: BankJobEmployment;
    jobHistory: BankJobApplication[];
    pendingWages: BankPendingWage[];
    fatigue: number;
    reputation: number;
    experience: Record<string, number>;
    stockMarket: BankStockQuote[];
    holdings: Record<string, BankStockHolding>;
    watchlist: string[];
    company?: BankCompanyState;
    loans: BankLoan[];
    events: BankLifeEvent[];
    aiEvents?: BankLifeAiEvent[];
    resume?: BankResumeProfile;
    jobSearchSessions?: BankJobSearchSession[];
    aiJobPostings?: BankJobPosting[];
    marketPulses?: BankMarketPulse[];
    creditProfile?: BankLoanCreditProfile;
    aiLastGeneratedAt?: Record<string, string>;
}

export interface BankFullState {
    config: BankConfig;
    shop: BankShopState;
    life?: BankLifeState;
    goals: SavingsGoal[];
    firedStaff?: ShopStaff[]; // Fired staff pool: can rehire or permanently delete
    todaySpent: number;
    lastLoginDate: string;
    dataVersion?: number; // Migration version tracker (undefined = v0/v1 legacy)
}
// ---------------------------------

// --- CHAR MUSIC PROFILE (网易云风格 · 角色的音乐人格) ---

/** 角色本地歌单里的轻量歌曲快照 — 字段与 MusicContext 的 Song 对齐（无运行时 url） */
export interface CharPlaylistSong {
    id: number;
    name: string;
    artists: string;
    album: string;
    albumPic: string;
    duration: number;
    fee: number;
    /**
     * 'user' = 这首是从 user 那里"抄"过来的（user 在听 → char 加进自己歌单）。
     * 'discovered' = char 自己探索 / 初始化时找到的。
     * 不写默认按 'discovered' 处理（向后兼容已有数据）。
     * 用途：当 char 后续"在听"这首时，prompt 会告诉 LLM "这是从 user 那儿收来的"，
     * 让记忆/对话能自然带上这层关系，而不是当成一首中立的歌。
     */
    source?: 'user' | 'discovered';
    /** 加入歌单时间，用来排序 / 显示"最近收藏" */
    addedAt?: number;
}

export interface CharPlaylist {
    id: string;                 // 本地 id (不与网易云 playlistId 冲突)
    title: string;
    description: string;        // 角色自己写的歌单简介
    coverStyle: string;         // 渐变色标识 or 第一首歌封面
    songs: CharPlaylistSong[];
    mood?: SongMood;
    createdAt: number;
    updatedAt: number;
}

export interface CharPlayRecord {
    song: CharPlaylistSong;
    at: number;                 // 播放时间戳（真实时间）
    context?: string;           // 该时刻的心境备注，如 "失眠的时候"
}

export interface CharMusicReview {
    id: string;
    targetType: 'song' | 'user_playlist' | 'user_record';
    targetId: string;           // songId or playlistId as string
    targetTitle: string;        // 歌名 / 歌单名
    content: string;            // 评论正文
    createdAt: number;
}

/** 运行时"此刻在听" — 根据 Schedule 决定，不必持久化（可以随时 recompute） */
export interface CharCurrentListening {
    songId: number;
    songName: string;
    artists: string;
    albumPic: string;
    /** 心境 / 选曲理由（来自 slot.innerThought 或 description） */
    vibe?: string;
    startedAt: number;
}

export interface CharMusicProfile {
    /** 音乐品味简介（LLM 初始化生成） */
    bio: string;
    /** 曲风标签（可随听歌演化） */
    genreTags: string[];
    /** 偏爱的艺人 */
    signatureArtists: { name: string; artistId?: number }[];
    /** 本地歌单列表 */
    playlists: CharPlaylist[];
    /** 仿 likelist */
    likedSongIds: number[];
    /** 最近在听（仿 user/record） */
    recentPlays: CharPlayRecord[];
    /** 私人 FM 关键词种子（留给未来做 char FM） */
    fmSeed?: string;
    /** 角色对歌/user 歌单的点评 */
    reviews?: CharMusicReview[];
    /** 此刻在听（Schedule 运行时填充，UI 展示用） */
    currentListening?: CharCurrentListening;
    /** 是否允许 char 读取 user 的网易云数据（默认 true） */
    canReadUserMusic?: boolean;
    /** 在线一起听开关：开启时 char 可在你听歌时「一起听」（输出 join 卡片）；
     *  关闭则不再提供一起听选项（仍可收歌/分享）。undefined 视为开启（默认行为）。 */
    listenTogetherEnabled?: boolean;
    /** 初始化时间 */
    initializedAt?: number;
    updatedAt: number;
}

/**
 * 角色离线自主生活事件 —— 由 utils/autonomousLife.ts 的 agent 生成。
 * 角色在用户离线 / 没在聊天时「过自己的日子」，每条事件代表 TA 正在或刚刚经历的
 * 一件小事（上班、吃饭、追剧、和朋友出门、emo…）。这些事件有两个出口：
 *  1. 给主动消息取材 —— 角色分享自己的生活，而不是反复催用户回复（不围着用户转）；
 *  2. 攒成「你不在时 TA 经历了…」的离线动态回顾时间线（来往 App 内可查看）。
 */
export interface CharLifeEvent {
  /** `life_${charId}_${timestamp}_${rand}` */
  id: string;
  charId: string;
  /** 事件发生时刻（ms）。回顾按它排序 / 分组。 */
  timestamp: number;
  /** 一句话活动，如「在公司赶方案」「窝在沙发追剧」 */
  activity: string;
  /** 当下心情，一两个词或 emoji，如「有点累」「😌 惬意」 */
  mood?: string;
  /** 可选地点，如「公司」「楼下咖啡店」 */
  location?: string;
  /** 用于通知 / 回顾的简短摘要（通常等于 activity，或更口语的一句话） */
  summary: string;
  /** 是否已作为主动消息发给用户（回顾里据此标注「已经跟你说过」，避免重复强调） */
  surfacedAsMsg?: boolean;
  /** 生成来源：proactive 触发时顺带生成 / 用户离线回来时补齐 */
  source: 'proactive' | 'catchup';
}

// =====================================================================
// 循迹 App — 角色 Screenlife 演出 + 异地恋监视/报备模拟
// =====================================================================

export type XunjiTab = 'screenlife' | 'monitor' | 'report' | 'settings';
export type XunjiNetworkType = 'wifi' | 'mobile';
export type XunjiCallStatus = 'outgoing' | 'incoming' | 'missed' | 'connected';
export type XunjiBatteryEventType = 'charge_start' | 'charge_end';
export type XunjiDensity = 'light' | 'standard' | 'detailed';
export type XunjiTransport = 'walk' | 'bike' | 'car' | 'subway' | 'bus';
export type XunjiReportSeverity = 'info' | 'notice' | 'warning';
export type XunjiReportType =
  | 'unlock_count'
  | 'network_switch'
  | 'app_open'
  | 'app_close'
  | 'app_hourly'
  | 'charge_start'
  | 'charge_end'
  | 'move_start'
  | 'stay'
  | 'transit'
  | 'arrive'
  | 'call_start'
  | 'call_10min'
  | 'sleep_phone_off'
  | 'sleep_late_reminder'
  | 'sleep_5h'
  | 'sleep_end';

export interface XunjiSocialInference {
  mood: string;
  relationshipPulse: string;
  screenlifeScore: number;
  intimacySignals: string[];
  frictionSignals: string[];
  likelyNeeds: string[];
  nextConversationSeeds: string[];
  whisperHooks: string[];
}

export interface XunjiGeneratedMoment {
  id: string;
  time: number;
  title: string;
  body: string;
  tone: 'soft' | 'busy' | 'private' | 'social' | 'alert';
  relatedApp?: string;
}

export interface XunjiAppUsageSession {
  id: string;
  appName: string;
  icon?: string;
  category?: string;
  startedAt: number;
  endedAt: number;
  note?: string;
}

export interface XunjiNetworkRecord {
  id: string;
  type: XunjiNetworkType;
  name: string;
  timestamp: number;
}

export interface XunjiLocationPoint {
  id: string;
  label: string;
  address: string;
  lat?: number;
  lng?: number;
  arrivedAt: number;
  leftAt?: number;
  moveMinutes?: number;
  stayMinutes?: number;
  transport?: XunjiTransport;
}

export interface XunjiHealthSnapshot {
  timestamp: number;
  stressLabel: string;
  hrvAvg: number;
  hrvCurrent: number;
  hrvTrend: number[];
  heartRateMin: number;
  heartRateMax: number;
  heartRateLatest: number;
  heartRateTrend: number[];
  sleepMinutes: number;
  sleepQuality: string;
  sleep: {
    asleepAt: number;
    awakeAt: number;
    awakeMinutes: number;
    remMinutes: number;
    coreMinutes: number;
    deepMinutes: number;
  };
  steps: number;
  walkingKm: number;
  dayStepTrend: number[];
  weekStepTrend: number[];
}

export interface XunjiCallRecord {
  id: string;
  target: string;
  startedAt: number;
  durationMinutes: number;
  status: XunjiCallStatus;
}

export interface XunjiBatteryEvent {
  id: string;
  type: XunjiBatteryEventType;
  timestamp: number;
  level: number;
}

export interface XunjiScreenlifeRun {
  id: string;
  charId: string;
  createdAt: number;
  rangeStart: number;
  rangeEnd: number;
  density: XunjiDensity;
  writeBack: boolean;
  title: string;
  narrative: string;
  chats: { id: string; time: number; target: string; summary: string; messages: string[] }[];
  browsed: { id: string; time: number; appName: string; title: string; summary: string }[];
  notes: { id: string; time: number; text: string }[];
  appUsage: XunjiAppUsageSession[];
  socialInference?: XunjiSocialInference;
  moments?: XunjiGeneratedMoment[];
}

export interface XunjiMonitorSnapshot {
  id: string;
  charId: string;
  generatedAt: number;
  phoneModel: string;
  batteryLevel: number;
  isCharging: boolean;
  unlockCount: number;
  screenTimeMinutes: number;
  lockPeriods: { id: string; startedAt: number; endedAt: number }[];
  appUsage: XunjiAppUsageSession[];
  networks: XunjiNetworkRecord[];
  locations: XunjiLocationPoint[];
  distanceKm: number;
  health: XunjiHealthSnapshot;
  calls: XunjiCallRecord[];
  batteryEvents: XunjiBatteryEvent[];
}

export interface XunjiReportItem {
  id: string;
  charId: string;
  type: XunjiReportType;
  timestamp: number;
  title: string;
  body: string;
  severity?: XunjiReportSeverity;
  relatedApp?: string;
  acknowledged?: boolean;
  writtenBack?: boolean;
}

export interface XunjiSettings {
  id: 'settings';
  activeCharId?: string;
  writeBackToCharacter: boolean;
  /** 絮语联动：把最新循迹演出 / 监视 / 报备作为角色可感知的近期生活痕迹注入聊天上下文。 */
  chatContextEnabled?: boolean;
  /** 点亮过一次后，循迹会按时间为该角色续上新的生活痕迹。默认开启。 */
  autoTraceEnabled?: boolean;
  /** per-char 的自动续写水位，避免同一段时间被重复生成。 */
  autoTraceLastAtByChar?: Record<string, number>;
  defaultDensity: XunjiDensity;
  locationSource?: 'character' | 'browser';
  customLocation?: string;
  customLocationUpdatedAt?: number;
  browserLocation?: {
    lat: number;
    lng: number;
    accuracy?: number;
    capturedAt: number;
  };
  reportRules: Record<XunjiReportType, boolean>;
}

export interface ScreenPeekCard {
  id: string;
  charId: string;
  charName: string;
  generatedAt: number;
  title: string;
  narrative: string;
  screen?: {
    appKind: 'chat' | 'takeout' | 'browser' | 'notes' | 'gallery' | 'music' | 'map' | 'social' | 'calendar' | 'app' | 'home';
    appName: string;
    title: string;
    subtitle?: string;
    action?: string;
    layout?: 'feed' | 'detail' | 'favorite' | 'search' | 'compose' | 'article' | 'day' | 'month' | 'player' | 'route' | 'store' | 'generic';
    url?: string;
    timeText?: string;
    batteryLevel?: number;
    wallpaper?: string;
    avatar?: string;
    contactName?: string;
    contactAvatar?: string;
    tabs?: string[];
    activeTab?: string;
    messages?: { id: string; side: 'left' | 'right' | 'center'; text?: string; imageUrl?: string; senderName?: string }[];
    rows?: { id: string; title: string; subtitle?: string; body?: string; meta?: string; imageUrl?: string; badge?: string }[];
    notes?: { id: string; text: string; meta?: string }[];
    hero?: { title?: string; subtitle?: string; imageUrl?: string };
  };
  chats: { id: string; time: number; target: string; summary: string; messages: string[] }[];
  browsed: { id: string; time: number; appName: string; title: string; summary: string }[];
  notes: { id: string; time: number; text: string }[];
  moments?: XunjiGeneratedMoment[];
  sourceRunId?: string;
}

export interface RelationshipNetworkEdge {
  id: string;
  pairKey: string;
  charIds: [string, string];
  label: string;
  summary: string;
  confidence: number;
  intimacy: number;
  tension: number;
  signals: {
    intimacy: string[];
    friction: string[];
    conflict: string[];
  };
  source: 'ai' | 'fallback' | 'manual' | 'auto';
  createdAt: number;
  updatedAt: number;
  lastInteractionAt?: number;
}

export interface RelationshipNetworkMessage {
  id: string;
  pairKey: string;
  speakerId: string;
  speakerName: string;
  content: string;
  createdAt: number;
  source: 'manual' | 'auto';
  forwardedByCharIds?: string[];
}

export interface RelationshipNetworkThread {
  id: string;
  pairKey: string;
  charIds: [string, string];
  createdAt: number;
  updatedAt: number;
  lastMessagePreview?: string;
  messageCount?: number;
}

export interface RelationshipNetworkAutoSettings {
  id: 'settings';
  enabled: boolean;
  selectedCharIds: string[];
  intervalMinutes: number;
  charCooldownMinutes: number;
  pairCooldownMinutes: number;
  nextRunAt: number;
  lastRunAtByChar: Record<string, number>;
  lastRunAtByPair: Record<string, number>;
  forwardedCountByPair: Record<string, number>;
  updatedAt: number;
}

export interface RelationshipNetworkForwardDecision {
  shouldForward: boolean;
  forwarderId?: string;
  reason?: string;
  excerptMessageIds?: string[];
}

export interface RelationshipNetworkGenerationResult {
  messages: RelationshipNetworkMessage[];
  edgePatch?: Partial<RelationshipNetworkEdge>;
  forward?: RelationshipNetworkForwardDecision;
}

export interface SuspendedVideoCallInfo {
  charId: string;
  charName: string;
  charAvatar?: string;
  startedAt: number;
  elapsedSeconds: number;
  chatLines: { id: string; role: 'user' | 'char'; text: string; timestamp: number }[];
  sessionId: string;
  camOn: boolean;
  micOn: boolean;
  facing: 'user' | 'environment';
}

/**
 * 角色真实城市配置（见 utils/charCity.ts）。
 * real：现实世界角色直接选真实城市；virtual：架空角色可选原型城市 + 虚拟程度。
 */
export interface CharCityConfig {
  mode: 'real' | 'virtual';
  /** mode==='real'：真实城市名（如「上海」） */
  realCity?: string;
  /** mode==='virtual'：架空城市显示名（如「A 市」） */
  virtualName?: string;
  /** mode==='virtual'：原型真实城市（如「上海」） */
  prototypeCity?: string;
  /** mode==='virtual'：虚拟程度 0~100（0 几乎贴现实可直接挪用，100 完全架空只留神韵） */
  fictionLevel?: number;
}

/** 角色备忘录的一条：TA 手机备忘录里的待办 / 随手记 / 小心事（TA 自己写或用户帮记）。注入聊天上下文让 TA 记得。 */
export interface CharMemo {
  id: string;
  text: string;
  createdAt: number;
  /** 谁写的：'char'=角色自己记的（生成）；'user'=用户帮 TA 记的 */
  by?: 'char' | 'user';
  /** 待办勾掉（完成的不再注入上下文） */
  done?: boolean;
}

export interface CharacterProfile {
  id: string;
  name: string;
  avatar: string;
  /** 剪影集列表备注：仅供界面展示与搜索，不注入任何 AI 提示词。 */
  description: string;
  systemPrompt: string;
  worldview?: string;
  /** 角色备忘录：TA 的待办/随手记/小心事，聊天时随身携带（注入上下文），TA 会记得自己写过的事。 */
  memos?: CharMemo[];
  /** 外貌 Tag：booru 风格英文外貌标签，喂文生图（立绘/头像/相册）用。可从人设+绑定世界书一键生成（utils/appearanceTags.ts），也可手改。 */
  appearanceTags?: string;
  /**
   * 开场白（SillyTavern 角色卡 first_mes）。保留原始宏（{{user}} / {{char}}），
   * 进入空聊天选择开场白时才替换 —— 换人设后再开聊天，宏会解析成新名字。
   */
  firstMes?: string;
  /** 备选开场白（角色卡 alternate_greetings），与 firstMes 一起构成进入聊天时左右切换的候选 */
  alternateGreetings?: string[];
  /**
   * 对话示例（SillyTavern 角色卡 mes_example）。独立于 systemPrompt 存储：
   * 未启用预设时作为「对话示例」块注入核心上下文；启用预设时落在
   * dialogueExamples 占位（受 marker 开关控制）。<START> 分隔多段示例（ST 惯例）。
   */
  mesExample?: string;
  /**
   * 角色局部正则脚本（SillyTavern scoped regex）。来源：
   * - 角色卡 data.extensions.regex_scripts 随卡导入
   * - 补丁铺（正则 App）里手动添加 / 导入到该角色
   * 与全局脚本（补丁铺「满铺通用」标签，localStorage）叠加生效，全局在前。
   */
  regexScripts?: RegexScriptData[];
  /** 日程卡片/桌面小组件的主题色相（HSL hue 0~360），未设置时取默认紫 260 */
  themeColor?: number;
  memories: MemoryFragment[];
  refinedMemories?: Record<string, string>;
  activeMemoryMonths?: string[];
  
  writerPersona?: string;
  writerPersonaGeneratedAt?: number;

  /** 挂载的世界书条目快照。注入时以世界书 App 的 live 记录为准（按 id、退而按
   *  分组+标题匹配），live 记录不存在时按快照生效 —— enabled 随 live 同步，
   *  保证条目开关对快照兜底路径同样生效 */
  mountedWorldbooks?: { id: string; title: string; content: string; category?: string; enabled?: boolean }[];

  bubbleStyle?: string;
  chatBackground?: string;
  contextLimit?: number;
  hideSystemLogs?: boolean; 
  hideBeforeMessageId?: number; 
  /** 絮语私聊档案：当前打开的聊天记录快照 id。实际活跃消息仍落 messages 表，切换档案时恢复。 */
  activePrivateChatId?: string;
  
  dateBackground?: string;
  sprites?: Record<string, string>;
  spriteConfig?: SpriteConfig;
  customDateSprites?: string[]; // User-added custom emotion names for date mode (per-character)
  dateLightReading?: boolean;   // Light reading mode for novel/text view in date
  dateSkinSets?: SkinSet[];     // Multiple skin sets for portrait mode
  activeSkinSetId?: string;     // Currently active skin set ID

  savedDateState?: DateState;
  specialMomentRecords?: Record<string, SpecialMomentRecord>;

  // 小红书 per-character toggle
  xhsEnabled?: boolean;

  socialProfile?: {
      handle: string;
      bio?: string;
      region?: string; // 地区（角色主页展示，如「安徽 亳州」）
  };

  /** 真实城市系统：真实/架空城市选择 + 实时信息接地（见 utils/charCity.ts） */
  cityConfig?: CharCityConfig;

  /** 朋友设置（角色主页右上角 ··· 进入）：星标朋友 / 黑名单 */
  starredFriend?: boolean;
  /** 已进入「往来」会话列表：新建/导入即置 true，或首次打开私聊时置 true。
   *  让角色创建/导入后无需先「添加好友」即可在往来直接出现并开聊。 */
  addedToChat?: boolean;
  /** 拍一拍后缀（微信式）：别人「拍了拍 TA 的<后缀>」里的后缀。角色可用 [[PAT_SUFFIX: x]] 自己改，默认「脑袋」。 */
  patSuffix?: string;
  blacklisted?: boolean;
  /** 用户拉黑角色的时刻——此后角色发来的消息气泡旁带红色感叹号 */
  blacklistedAt?: number;
  /** 被用户拉黑后的「解除拉黑验证」申诉状态：角色会主动发来验证消息求解封，
   *  用户可同意（解除拉黑）或拒绝；拒绝后角色会在 nextAt 之后再发，直到用户同意。 */
  unblockAppeal?: {
      active: boolean;        // 拉黑期间是否仍在申诉（同意/移出黑名单后置 false）
      awaiting: boolean;      // 已发出一条申诉、正等用户处理（true 时不再发新的）
      nextAt: number;         // 下一次可发申诉的时间戳
      rejectedCount: number;  // 被拒次数（影响措辞与下次间隔）
  };

  /** 角色拉黑用户（AI 输出 [[BLOCK_USER]] 触发）：active 期间用户无法发消息，
   *  到 unblockAt（随机 30 分钟 ~ 24 小时）自动解除，或通过好友验证提前拉回 */
  charBlock?: {
      active: boolean;
      blockedAt: number;
      unblockAt: number;
  };

  /** 会话设置（聊天界面 ··· → 聊天设置）：本会话专属的展示 / 行为 / 提示词配置 */
  convoSettings?: ConvoSettings;

  roomConfig?: {
      bgImage?: string;
      wallImage?: string;
      floorImage?: string;
      items: RoomItem[];
      wallScale?: number; 
      wallRepeat?: boolean; 
      floorScale?: number;
      floorRepeat?: boolean;
  };
  
  // deprecated: per-character assets migrated to global room_custom_assets_list with assignedCharIds

  lastRoomDate?: string;
  savedRoomState?: RoomGeneratedState;

  phoneState?: {
      records: PhoneEvidence[];
      customApps?: PhoneCustomApp[];
      /** 角色专属手机皮肤（确定性派生 + 可选 LLM 装点，详见 PhoneProfile） */
      profile?: PhoneProfile;
      /** 用户通过絮语「锁机」远程锁住角色手机；角色完成口令或任意题目后自动解锁。 */
      lock?: PhoneLockState;
  };

  voiceProfile?: {
      provider?: 'minimax' | 'custom';
      voiceId?: string;
      voiceName?: string;
      source?: 'system' | 'voice_cloning' | 'voice_generation' | 'custom';
      model?: string;
      notes?: string;
      timberWeights?: { voice_id: string; weight: number }[];
      voiceModify?: { pitch?: number; intensity?: number; timbre?: number; sound_effects?: string };
      emotion?: string;
      speed?: number;
      vol?: number;
      pitch?: number;
  };

  // 时间感知强化：开启（默认）时会向上下文注入「距离上次聊天已过去多久」的强化提示，
  // 让角色强化时间观念、主动匹配现实世界时间。关掉后不再注入这组提示词
  // （注意：历史消息本身仍带时间戳，关掉后弱化程度取决于模型自身理解）。
  // 这里承载「时间流逝感知」：两次聊天 / 有待跟进事件时，TA 知道过去了多久。
  timeAwarenessEnabled?: boolean;

  // 柔顺奉养（Soft Devotion Chat）：开启后这个角色在聊天里共情能力大幅提升——
  // 更偏爱、更耐心地接住用户的敏感、撒娇和不安（向 system prompt 注入共情强化段）。
  softDevotionChatEnabled?: boolean;

  // 回望小报缓存：键为周期标识（'day-YYYY-MM-DD' / 'week-YYYY-WW' / 'month-YYYY-MM'），
  // 值为已生成的娱乐小报。开关在会话设置 convoSettings.tabloidEnabled。
  generatedTabloids?: Record<string, Tabloid>;

  // Chat & Date voice TTS settings
  chatVoiceEnabled?: boolean;
  chatVoiceLang?: string;
  dateVoiceEnabled?: boolean;
  dateVoiceLang?: string;

  // Cross-session guidebook insights: what char has discovered about user across games
  guidebookInsights?: string[];

  // 主动消息配置
  proactiveConfig?: {
    enabled: boolean;
    intervalMinutes: number; // 30, 60, 120, 240, etc.
    /** 随机时间模式：间隔随机（1 小时 ~ 1 天），且用户刚回过消息时不打扰，
     *  发不发、说什么完全交给角色性格 */
    randomMode?: boolean;
    /** 离线自主生活：开启后角色在后台「过自己的日子」，主动消息从 TA 正在经历的
     *  生活事件取材（分享自己的生活、而不是催用户回复），离线期间的活动也会攒成
     *  一份「你不在时 TA 经历了…」的回顾时间线（见 utils/autonomousLife.ts）。
     *  undefined 视为开启（默认行为）。 */
    autonomousLifeEnabled?: boolean;
    useSecondaryApi?: boolean;
    secondaryApi?: {
      baseUrl: string;
      apiKey: string;
      model: string;
    };
  };

  // 情绪Buff系统
  activeMsg2Config?: ActiveMsg2CharacterConfig;
  activeBuffs?: CharacterBuff[];
  buffInjection?: string;   // 注入到systemPrompt的叙事型情绪底色描述

  /** 好感值 0~100（点聊天顶栏头像「偷看心声」时由模型一并评估更新；走 utils/relationship 的加减框架，日常小幅徘徊、决定性事件才大幅波动） */
  affection?: number;
  /** 当前心情（与好感值同一评估链路更新），显示在心声面板 */
  currentMood?: { emoji?: string; label: string; updatedAt: number };
  /** 关系状态（来往·偷看心声 的关系系统）：由 AI 依据好感 / 设定关系 / 剧情自动更新 */
  relationship?: RelationshipState;
  /** 婚姻状态（求婚成功后进入「婚姻筹备期」，落入岁时记·喜事页） */
  marriage?: MarriageState;
  /** 购物商城·角色小票：角色收到的礼物 / 自己买的 / 回赠用户的历史（最新在前）。供「查角色购物小票」与聊天上下文。 */
  shopReceipts?: ShopReceipt[];
  /** 购物商城·角色购物车：角色逛商城时加进的「心愿购物车」，用户可帮 TA 清空（代付）。 */
  shopCart?: ShopCartLine[];
  /** 来往·情侣空间（参考 QQ 情侣空间）：恋爱天数 / 亲密度 / 情侣动态 / 纪念日 / 相册 / 约定 / 悄悄话。
   *  挂在角色上（每个角色一份），由 ChatHub「情侣空间」标签页读写，并经 utils/context.ts 注入聊天上下文。 */
  coupleSpace?: CoupleSpace;
  emotionConfig?: {
    enabled: boolean;
    api?: {
      baseUrl: string;
      apiKey: string;
      model: string;
    };
  };

  // 记忆宫殿 (Memory Palace)
  memoryPalaceEnabled?: boolean;
  /**
   * 是否启用"palace 提取后自动同步归档"：开启后每次 buffer 处理成功都会把新记忆按日期
   * 合成 YAML MemoryFragment 追加到 char.memories，并推 hideBeforeMessageId 自动隐藏
   * 已处理的聊天。默认 false（opt-in）——首次启用建议让用户做一次 force 追平历史。
   */
  autoArchiveEnabled?: boolean;
  embeddingConfig?: {
    baseUrl: string;
    apiKey: string;
    model: string;        // 默认 text-embedding-3-small
    dimensions: number;   // 默认 1024
  };
  personalityStyle?: 'emotional' | 'narrative' | 'imagery' | 'analytical';
  ruminationTendency?: number;  // 反刍倾向 0-1，默认 0.3
  memoryPalaceInjection?: string;  // 记忆宫殿检索结果，注入到 System Prompt（运行时填充，不持久化）

  // 自我领悟词条：消化过程中 self_room 反刍产生的常驻认知
  // 像情绪 buff 一样注入到 contextBuilder 的角色设定下方
  selfInsights?: string[];

  /**
   * 角色生活侧写：一份帮助角色「更了解自己」的生活速写（日常节奏、习惯癖好、在意的事、
   * 与用户关系的底色……）。由副 API 依据人设 + 记忆生成，可手动编辑，注入 system prompt。
   * 入口在 剪影集 → 登场人物 → 角色编辑器（底稿页）。
   */
  lifeProfile?: {
    content: string;       // 侧写正文（markdown）
    generatedAt: number;
    edited?: boolean;      // 用户是否手动改过（改过则不被「重新生成」静默覆盖）
  };

  /**
   * 回神校准：用户触发「回神」后，角色完成一次自我审视，得到一句校准方向。
   * 在接下来的 turnsLeft 轮 AI 回复里注入 system prompt（悄悄调回本来的样子），
   * 每回复一轮 turnsLeft--，归零即清除，自然淡出回到常态。运行时字段，会被持久化。
   */
  recenterCalibration?: {
    /** 一句话校准方向（注入 prompt 用） */
    note: string;
    /** 第一人称回神独白（留档/可再展示） */
    monologue?: string;
    /** 察觉到的偏移点 */
    drift?: string[];
    createdAt: number;
    /** 剩余生效轮数（>0 才注入） */
    turnsLeft: number;
  };

  // 音乐人格 — 角色自己的网易云式歌单 / 品味 / 正在听
  // 在音乐 App 里以"拜访"形式访问
  musicProfile?: CharMusicProfile;

  /**
   * 日程风格：
   * - 'lifestyle'（生活系，默认）：虚构角色，拥有日常物理生活（晨跑、做饭、逛街……）
   * - 'mindful'（意识系）：角色诚实面对自身存在，内心活动基于真实能力（回忆对话、整理想法、等待用户……），不虚构物理行为
   */
  scheduleStyle?: 'lifestyle' | 'mindful';

  /**
   * 日程 / 情绪 Buff 总开关。
   * - true：启用日程生成、意识流、情绪 buff 评估与注入（消耗副 API）。
   * - false：完全关闭，不调副 API，不注入情绪，不生成日程。
   * - undefined：向后兼容——若 scheduleStyle 已设（老用户已隐式选风格）视为开启；否则默认关闭。
   */
  scheduleFeatureEnabled?: boolean;

  /**
   * HTML 模块模式（per-character）。
   * - htmlModeEnabled：默认开启（undefined 视为 true，显式 false 才关闭）。开启时给 LLM
   *   注入"用 [html]...[/html] 包裹的富 HTML 卡片"提示词，
   *   AI 输出里的 [html] 块会被解析成单独的 html_card 消息（沙盒 iframe 渲染）。
   * - htmlModeCustomPrompt：用户自定义内容，**追加**在内置提示词之后（不会覆盖内置内容）。
   * - 上下文 / 归档 总结读到的 html_card 消息内容是已剥离 HTML 的纯文字摘要，避免 token 浪费。
   */
  htmlModeEnabled?: boolean;
  htmlModeCustomPrompt?: string;
  /** 该角色专属的聊天「白框」自定义 CSS（叠加在全局 osTheme.chatChromeCustomCss 之上）。 */
  chromeCustomCss?: string;

  /**
   * 思考过程展示（per-character / 会话级）。
   * - true：把 LLM 返回的 reasoning_content 与 <think>...</think> 抽出来，
   *   作为 metadata.thinkingChain 落库到 assistant 消息上，
   *   MessageItem 在气泡顶部渲染可折叠"💭 思考过程"区块。
   * - false / undefined：依然按旧逻辑剥离，不展示。
   * - 仅影响开关切到 true 之后产生的新消息；旧消息没有 thinkingChain，
   *   UI 自然不会显示，符合"打开后才看"的预期。
   */
  showThinkingChain?: boolean;
  /**
   * 思考链卡片视觉风格（per-character）。
   * - 'echo' (default)：暗紫底 + 暖金描边「回响」二次元卡牌
   * - 'whisper'：米色羊皮纸「心声」轻盈版
   * - 'minimal'：无装饰单色简洁版
   * - 'custom'：使用 thinkingChainCustomColors 给的配色
   */
  thinkingChainStyle?: 'echo' | 'whisper' | 'minimal' | 'custom';
  /** 自定义风格用的配色组（仅 thinkingChainStyle === 'custom' 生效） */
  thinkingChainCustomColors?: {
    bg?: string;       // 卡片背景
    accent?: string;   // 边框/标题点缀
    text?: string;     // 正文颜色
  };
  /** 用户追加的思考提示词（不替换原生，只在最后追加一段「用户额外要求」） */
  thinkingChainCustomPrompt?: string;

  /**
   * 虚拟世界「页外」的个人状态：是否自主登入、登入间隔、各本小说的独立书签等。
   * 独立于 proactiveConfig（主动发消息），互不挤占触发。
   */
  vrState?: VRWorldCharState;
}

/**
 * 关系阶段（来往·偷看心声 的关系系统）。由 AI 依据好感 / 设定关系 / 剧情自动更新。
 * 顺序大致对应「亲密度递进」，utils/relationship 用它约束跳变（不能凭空从陌生跳到已婚）。
 */
export type RelationshipStage =
  | 'stranger'      // 陌生
  | 'acquaintance'  // 认识
  | 'friend'        // 朋友
  | 'close'         // 好友 / 知己
  | 'crush'         // 暧昧（高好感但未确立恋人关系）
  | 'lover'         // 恋人（男女朋友）
  | 'engaged'       // 未婚夫妻（求婚成功 → 婚姻筹备期）
  | 'married'       // 已婚（领证 / 完婚）
  | 'ex'            // 前任（分手）
  | 'estranged';    // 决裂 / 形同陌路

export interface RelationshipState {
  stage: RelationshipStage;
  /** 展示用关系名（如「男朋友」「未婚妻」「暧昧对象」「前男友」），AI 给、落地展示 */
  label: string;
  /** 进入当前阶段的时间戳 */
  since: number;
  updatedAt: number;
  /** 关系变更简史（最新在前），供来往面板回看 */
  history?: Array<{ stage: RelationshipStage; label: string; at: number; reason?: string }>;
}

/** 婚姻筹备阶段：求婚成功后逐步推进，时间与现实匹配。 */
export type MarriageStage =
  | 'engaged'     // 已订婚·筹备中
  | 'planning'    // 已商定婚期
  | 'registered'  // 已领证
  | 'wed';        // 已完婚

export interface MarriageMilestone {
  id: string;
  kind: 'proposal' | 'plan' | 'register' | 'wedding' | 'custom';
  title: string;
  date?: string;       // YYYY-MM-DD（与现实匹配）
  note?: string;
  by?: 'user' | 'char';
  done?: boolean;
  at: number;
}

/** 婚姻状态（落入岁时记·喜事页；聊天上下文据此让角色商量婚期 / 领证等）。 */
export interface MarriageState {
  active: boolean;
  stage: MarriageStage;
  /** 谁先求的婚 */
  proposalBy: 'user' | 'char';
  engagedAt: number;
  /** 商定的婚期（YYYY-MM-DD） */
  weddingDate?: string;
  /** 领证时间戳 */
  registeredAt?: number;
  milestones: MarriageMilestone[];
}

// ── 来往·情侣空间（QQ 情侣空间移植） ────────────────────────────────────────
/** 情侣动态 / 留言板的一条评论。 */
export interface CoupleComment {
  id: string;
  author: 'user' | 'char';
  text: string;
  at: number;
}

/** 情侣动态里的多媒体卡片类型：语音条 / 音乐 / 物件·照片（点击触发「心声」弹窗）。 */
export type CoupleMediaKind = 'voice' | 'music' | 'item';

/** 情侣动态的多媒体附件卡片（语音 / 音乐 / 物件）。 */
export interface CoupleMedia {
  kind: CoupleMediaKind;
  /** 显示名（语音：如「晚安语音.m4a」；音乐：歌名；物件：如「照片_糯米糍.jpg」） */
  name: string;
  /** 语音时长展示（如「00:15」），仅 voice 用 */
  duration?: string;
}

/** 情侣动态（留言板）：双方可发文字 / 心情 / 图片 / 多媒体卡片，按时间倒序展示，可点赞 + 评论。 */
export interface CoupleMoment {
  id: string;
  author: 'user' | 'char';
  text?: string;
  /** 心情（emoji + 文字，可选） */
  mood?: string;
  /** 图片（base64 data url），九宫格展示 */
  images?: string[];
  /** 多媒体卡片（语音 / 音乐 / 物件）；点击触发「心声」弹窗 */
  media?: CoupleMedia;
  /** 角色对这条动态的「心声」独白（点击多媒体块时懒生成、缓存后复用） */
  innerVoice?: string;
  createdAt: number;
  /** 点赞：双方各自是否赞过 */
  likedByUser?: boolean;
  likedByChar?: boolean;
  comments: CoupleComment[];
}

/** 纪念日 / 生日 / 约定日：自动倒计时提醒。 */
export interface CoupleAnniversary {
  id: string;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  kind: 'love' | 'birthday' | 'promise' | 'custom';
  /** 是否每年重复（生日 / 周年）：倒计时取「下一次」 */
  repeatYearly?: boolean;
  createdAt: number;
}

/** 情侣相册照片（九宫格展示）。 */
export interface CouplePhoto {
  id: string;
  url: string;        // base64 data url
  caption?: string;
  addedBy: 'user' | 'char';
  at: number;
}

/** 情侣任务 / 约定（完成打勾 + 加亲密度）。 */
export interface CoupleTask {
  id: string;
  title: string;
  done: boolean;
  by?: 'user' | 'char';
  createdAt: number;
  doneAt?: number;
}

/** 愿望清单：一条共同心愿（想一起做的事 / 想要的东西），可被实现勾掉。 */
export interface CoupleWish {
  id: string;
  text: string;
  by?: 'user' | 'char';
  fulfilled?: boolean;
  createdAt: number;
  fulfilledAt?: number;
}

/** 提问箱：用户问一句，角色（AI）答一句，两边合存一条。 */
export interface CoupleQuestion {
  id: string;
  question: string;
  answer: string;
  at: number;
}

/** 养盆栽：你们一起养的一株虚拟植物，每日照料攒成长值、随阶段长大。 */
export interface CouplePlant {
  /** 累计成长值（决定阶段） */
  growth: number;
  /** 上次浇水 / 施肥 / 晒太阳的本地日期 YYYY-MM-DD（每日各一次） */
  water?: string;
  fertilize?: string;
  sun?: string;
  createdAt: number;
}

/** 悄悄话 / 留言信箱：一条私密留言。 */
export interface CoupleWhisper {
  id: string;
  author: 'user' | 'char';
  text: string;
  at: number;
}

/** 每日互动类型：亲一下 / 抱一下 / 牵手 / 送礼物。 */
export type CoupleInteractionKind = 'kiss' | 'hug' | 'hold' | 'gift';

/** 每日互动记录（一键互动触发动画 / 文字反馈并加亲密度）。 */
export interface CoupleInteraction {
  id: string;
  kind: CoupleInteractionKind;
  by: 'user' | 'char';
  /** 对方的一句反馈文字（角色侧由 LLM 生成；兜底用模板） */
  note?: string;
  at: number;
}

/**
 * 来往·情侣空间（参考 QQ 情侣空间）。挂在 CharacterProfile 上（每个角色一份），
 * 由 ChatHub「情侣空间」标签页读写，并经 utils/context.ts 注入聊天上下文，
 * 让角色「知道」恋爱天数 / 亲密度 / 最近动态 / 待办约定 / 悄悄话，据此扮演 + 主动互动。
 */
export interface CoupleSpace {
  /** 在一起纪念日（YYYY-MM-DD）：计算「已相恋 X 天」 */
  anniversaryDate?: string;
  /** 亲密度（随互动增长，0 起、无上限；UI 按每 100 一级展示进度条） */
  intimacy: number;
  moments: CoupleMoment[];
  anniversaries: CoupleAnniversary[];
  photos: CouplePhoto[];
  tasks: CoupleTask[];
  whispers: CoupleWhisper[];
  /** 愿望清单：你们的共同心愿（可选，老数据可能缺） */
  wishes?: CoupleWish[];
  /** 提问箱：你问 TA 答的问答记录（可选，老数据可能缺） */
  questions?: CoupleQuestion[];
  /** 养盆栽：你们一起养的小植物（可选，首次浇水时创建） */
  plant?: CouplePlant;
  /** 默契大考验·历史最高默契度（0~100，可选） */
  compatBest?: number;
  /** 最近的每日互动记录（保留若干条） */
  interactions: CoupleInteraction[];
  createdAt: number;
  updatedAt: number;
}

/**
 * 会话设置（聊天设置面板）—— 本会话（与该角色的单聊）专属配置。
 * 展示类字段只影响聊天界面；行为类字段会以「会话设定」块注入系统提示词。
 */
export interface ConvoSettings {
    /** 备注名：聊天界面顶栏 / 消息列表 / 聊天列表显示的名字（不改变角色本名） */
    remarkName?: string;
    /** TA 对我的备注：角色对用户的称呼（注入提示词，角色平时就这么叫用户）。角色可通过 [[SET_USER_REMARK]] 自己改。 */
    userNickname?: string;
    /** 角色最近一次主动换备注（[[SET_USER_REMARK]]）的动机说明（弹窗 / 聊天手帐里展示） */
    userRemarkMotivation?: string;
    /** 角色最近一次换备注的时间戳 */
    userRemarkUpdatedAt?: number;
    /** 角色历次给用户换备注的记录（聊天手帐「TA 怎么称呼你」栏目展示，最新在前） */
    userRemarkHistory?: Array<{ remark: string; motivation?: string; at: number }>;
    /** 关联群聊记忆：'all' 携带全部所在群的近期活动（默认，与旧行为一致）/ 'none' 不关联 / 'selected' 仅关联指定群 */
    groupMemoryMode?: 'all' | 'none' | 'selected';
    /** groupMemoryMode='selected' 时关联的群 id 列表 */
    linkedGroupIds?: string[];
    /** 顶栏装饰文案：显示在聊天界面最顶部（顶栏上方）的居中小字 */
    headerDecorText?: string;
    /** 消息区底部装饰文案：显示在消息列表下方、输入栏上方的居中小字 */
    footerDecorText?: string;
    /** 输入框占位文案：自定义输入框 placeholder（默认 "Message..."） */
    inputPlaceholderText?: string;
    /** 旁白模式：允许角色单独输出（动作/场景）旁白气泡 */
    narrationMode?: boolean;
    /** 心声手记开关（默认开）：关闭后聊天里的「偷看心声」入口不可用 */
    innerVoiceEnabled?: boolean;
    /** 专属铃声：新消息通知音（undefined/'none' = 静音，预设见 utils/ringtone.ts） */
    ringtone?: 'none' | 'chime' | 'bubble' | 'bell' | 'retro' | 'koto';
    /** 私聊特别关心：开启后 TA 的消息/此刻走独立提醒。 */
    specialCare?: boolean;
    /** 特别关心专属提醒音；未设置时回退到 ringtone，再回退清铃。 */
    specialCareRingtone?: 'none' | 'chime' | 'bubble' | 'bell' | 'retro' | 'koto';
    /** 特别关心是否提醒消息与此刻；undefined 视为开启。 */
    specialCareNotify?: boolean;
    /** 隐藏时间戳：本会话覆盖全局 chatShowTimestamp */
    hideTimestamp?: boolean;
    /** 所在地区：注入提示词，影响角色作息 / 时差 / 话题贴合 */
    region?: string;
    /** 实时感知·线上：在线聊天里明确把「当前真实时间」告诉模型（默认开，关掉则不注入钟点）。 */
    realtimeClockOnline?: boolean;
    /** 实时感知·线下：线下面对面模式里也把「当前真实时间」告诉模型（默认关，线下多为架空场景）。 */
    realtimeClockOffline?: boolean;
    /** 回望小报：开启后聊天里可生成「昨日来信 / 回望·周章 / 回望·月章」娱乐小报。 */
    tabloidEnabled?: boolean;
    /** 主动查询：发消息前先留意当前时间 / 天气 / 热点等实时信息再开口（提示词注入） */
    proactiveLookup?: boolean;
    /** 主动发消息「随机 30 分~10h」模式标记（intervalMinutes 仍是调度器实际读的值） */
    proactiveRandom?: boolean;
    /** 主动语音通话：角色在主动找用户时可按人设/剧情自行决定直接拨语音电话（需主动发消息开启） */
    proactiveCallEnabled?: boolean;
    /** 主动为用户点外卖：开启后角色可在合适场景（饭点/降温/用户喊饿…）主动替用户下单外卖并代付，
     *  在聊天里生成可点开的外卖订单小票。关闭则永不触发该行为。默认关。 */
    proactiveTakeoutOrder?: boolean;
    /** 主动发朋友圈：'off' 关 / 'random' 随缘 / 数字 = 自定义间隔小时（提示词倾向 + 配置位） */
    momentsAutoPost?: 'off' | 'random' | number;
    /** 允许 char 看手机：角色可自然提及用户手机里的日程 / 朋友圈 / 音乐动态（提示词注入） */
    allowPhoneBrowse?: boolean;
    /** 自动线下：对话发展到见面情境时自动切换线下面对面模式（提示词注入） */
    autoOffline?: boolean;
    /** 发消息方式：'split' 碎片短句（默认习惯）/ 'whole' 完整段落 */
    bubbleStyleMode?: 'split' | 'whole';
    /** 表情联想：允许角色在合适时机联想并发送表情包（提示词注入） */
    emojiAssociation?: boolean;
    /** 每轮对话生图：生图管线配置位（开启后每轮回复尝试配图，需生图 API） */
    perTurnImageGen?: boolean;
    /** 译文风格：对照翻译时追加的风格要求（如「口语化」「文学腔」） */
    translateStyle?: string;

    // ── 立绘 ──
    /** 角色·本会话头像（覆盖 char.avatar，仅本会话展示） */
    charAvatarOverride?: string;
    /** 允许 TA 自主把用户发来的图片设为自己的头像。 */
    allowCharAvatarFromUserImage?: boolean;
    /** 主控·本会话头像（覆盖用户头像，仅本会话展示） */
    userAvatarOverride?: string;
    /** 角色立绘：聊天界面右下角半透明立绘（galgame 式） */
    spriteImage?: string;
    /** 生图参考图：作为 img2img / edits 的参考底图配置位 */
    spriteRefImage?: string;
    /** 视频通话·通话立绘：情绪态 → 图（'默认' 用作通话背景/形象） */
    callSprites?: Record<string, string>;

    // ── 背景图（消息区背景沿用 char.chatBackground） ──
    /** 顶部·头像背后：聊天顶栏背景图 */
    headerBgImage?: string;
    /** 顶部贴边：顶栏下方装饰横条 */
    headerEdgeImage?: string;
    /** 消息区贴边：输入栏上方装饰横条 */
    msgEdgeImage?: string;
    /** 身份卡画板：角色主页（资料卡）顶部背景 */
    idCardImage?: string;
    /** 底部输入栏背景图 */
    inputBarImage?: string;
}

/** 群公告（QQ 式）：一条当前生效的公告，群主/管理员可发布、修改或撤下。 */
export interface GroupAnnouncement {
    /** 公告正文 */
    text: string;
    /** 发布者：'user' 或 charId */
    by: string;
    /** 发布 / 最后修改时间（ms） */
    at: number;
}

export interface GroupChatRecord {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    pinned?: boolean;
    messages: Message[];
}

export interface GroupProfile {
    id: string;
    name: string;
    members: string[];
    avatar?: string;
    createdAt: number;
    /**
     * 私聊里"近期群活动"上下文从这个群最多取最后多少条消息。
     * 不设默认 80。设大点能让活跃群更完整，设小点节省 token、避免某个活跃群把其他群挤掉。
     */
    privateContextCap?: number;
    /** 群主。'user' = 用户本人；历史群没有该字段时按用户是群主处理。 */
    ownerId?: string;
    /** 管理员 charId 列表（群主天然拥有管理员权限，不需要重复列在这里）。 */
    adminIds?: string[];
    /** 群名片：charId（或 'user'）→ 在本群显示的昵称。角色可通过 [[SET_NICKNAME]] 自己改。 */
    memberNicknames?: Record<string, string>;
    /** 头衔：charId（或 'user'）→ 群主/管理员设置的专属头衔，显示在名字旁的小徽章。 */
    memberTitles?: Record<string, string>;
    /** 角色视角关系：viewer charId → target charId → “在 viewer 眼里 target 是谁 / 什么关系 / 有没有过节”。只给 viewer 自己发言时参考。 */
    memberLenses?: Record<string, Record<string, string>>;
    /** 禁言：charId → 解禁时间戳（ms）。当前时间小于该值时该成员被禁言。 */
    mutedUntil?: Record<string, number>;
    /** 全员禁言：开启后所有角色成员本轮都不发言（仅群主/管理员＝用户可发），导演直接跳过。 */
    mutedAll?: boolean;
    /** 角色各自回复：开启后群聊每轮按成员分别调用 API，而不是一次导演调用统筹全场。 */
    replyIndividually?: boolean;
    /** 让角色自动接话：用户发言后，额外续跑若干轮角色之间的自然对话。 */
    autoContinueEnabled?: boolean;
    /** 自动接话轮数。每轮会让群成员在用户旁观状态下继续接话一次。 */
    autoContinueRounds?: number;
    /** 群公告：群主/管理员发布，进入群聊时置顶展示，并注入群聊上下文让成员知晓。撤下时为 undefined。 */
    announcement?: GroupAnnouncement;
    /** 聊天列表置顶。 */
    pinned?: boolean;
    /** 特别关心：这些成员在群里的消息会被高亮/提醒。 */
    specialCareMemberIds?: string[];
    /** 特别关心是否开启消息提醒。undefined 视为开启。 */
    specialCareNotify?: boolean;
    /** 当前群聊记录包标题，用于导出/导入后显示，不等同于群名。 */
    chatArchiveTitle?: string;
    /** 当前打开的群聊记录 id。未设置时沿用默认消息流。 */
    activeChatRecordId?: string;
    /** 群聊记录快照，用于新聊天、切换旧记录、改标题、置顶和删除。 */
    chatArchives?: GroupChatRecord[];
    /** 单个群聊专属背景图（data URL）。 */
    chatBackgroundImage?: string;
    /** 群聊回形针「赴个约」设置。 */
    offlineMode?: {
        enabled?: boolean;
        style?: string;
        maxChars?: number;
        openingStrategy?: 'choose' | 'story' | 'skip';
        openingPreset?: 'approach' | 'visit' | 'encounter' | 'appointment' | 'custom';
        customScenario?: string;
    };
    /** 已解散标记：解散后群保留在聊天列表显示"此群聊已被解散"，进入后只读。 */
    dissolved?: boolean;
    dissolvedAt?: number;
}

export interface CharacterExportData extends Omit<CharacterProfile, 'id' | 'memories' | 'refinedMemories' | 'activeMemoryMonths'> {
    version: number;
    type: 'moro_character_card';
    embeddedTheme?: ChatTheme;
}

/** 絮语·用户社交背景：不是正式神经链接角色，而是用户人际关系里的影子联系人/群聊。 */
export type AmbientSocialRelation =
    | 'family'
    | 'relative'
    | 'friend'
    | 'bestie'
    | 'coworker'
    | 'classmate'
    | 'neighbor'
    | 'crush'
    | 'group';

export interface AmbientSocialContact {
    id: string;
    kind: 'contact';
    name: string;
    relation: AmbientSocialRelation;
    relationLabel: string;
    avatar: string;
    note: string;
    lastMessage: string;
    lastAt: number;
    unread?: number;
    pinned?: boolean;
    hidden?: boolean;
    /** 转成正式 CharacterProfile 后写入，后续不再当影子联系人显示。 */
    linkedCharId?: string;
    createdAt: number;
}

export interface AmbientSocialGroup {
    id: string;
    kind: 'group';
    name: string;
    relation: 'group';
    relationLabel: string;
    avatar: string;
    note: string;
    memberNames: string[];
    lastMessage: string;
    lastAt: number;
    unread?: number;
    pinned?: boolean;
    hidden?: boolean;
    /** 转成正式 GroupProfile 后写入，后续不再当影子群聊显示。 */
    linkedGroupId?: string;
    createdAt: number;
}

export type AmbientSocialEntry = AmbientSocialContact | AmbientSocialGroup;

export interface AmbientSocialState {
    version: number;
    entries: AmbientSocialEntry[];
    seededAt: number;
    lastGrowthAt?: number;
}

export interface UserProfile {
    name: string;
    avatar: string;
    bio: string;
    /**
     * 钱包余额（可花的钱）。靠经营店铺「营业」赚取，用于「往来」里给角色转账 / 发红包，
     * 收到角色红包领取后回到钱包。与「记账」（记录现实金钱的流水）相互独立、互不影响。
     */
    balance?: number;
    /** 购物商城·背包：买下但还没送出去的礼物。 */
    shopInventory?: ShopOwnedItem[];
    /** 购物商城·购物车：加购但还没结算的商品（淘宝式）。 */
    shopCart?: ShopCartLine[];
    /** 购物商城·收藏（淘宝式想要清单）：收藏的商品 id。 */
    shopFavorites?: string[];
    /** 购物商城·我的订单（淘宝式，含物流进度；确认收货后才进背包）。 */
    shopOrders?: ShopOrder[];
    /** 购物商城·已领优惠券 id（满减券，结算自动用最优的一张）。 */
    shopCoupons?: string[];
    /** 饭票(外卖)·已领平台红包 id（满减券，结算自动用最优的一张）。 */
    takeoutRedpackets?: string[];
    /** 购物商城·我的小票：购买 / 赠送 / 收礼历史（最新在前）。 */
    shopReceipts?: ShopReceipt[];
    /** 购物商城·浏览足迹（淘宝式）：看过的商品 id + 时间（最新在前，去重，限量）。 */
    shopFootprints?: ShopFootprint[];
    /** 购物商城·我写的评价（确认收货后对商品的「晒单」，注入商品详情评价区置顶）。 */
    shopReviews?: ShopUserReview[];
    /** 购物商城·淘金币余额（签到/下单获得，结算可抵现）。 */
    shopCoins?: number;
    /** 购物商城·上次每日签到的时间戳（同一自然日只能签到一次）。 */
    shopCheckinAt?: number;
    /**
     * 用户本人接入「页外」的状态：捏的 chibi、此刻所在房间、在干嘛。可随时改。
     * enabled=false（登出）时，聊天里给角色的"用户在页外"提示词随之消失。
     */
    vrState?: UserVRState;
    /** 絮语·是否开启用户社交圈：关闭后不再自动出现随机家人/同事/朋友/亲戚/群聊等背景会话。 */
    ambientSocialEnabled?: boolean;
    /** 絮语·用户完整社交关系：随机家人/同事/朋友/亲戚/群聊等背景会话，随剧情时间轻微生长。 */
    ambientSocial?: AmbientSocialState;
    /** 拍一拍后缀（微信式）：别人「拍了拍 你 的<后缀>」里的后缀。用户自定义，默认「脑袋」。 */
    patSuffix?: string;
}

export interface UserVRState {
    /** 是否接入页外（登出后不再向角色注入"用户在页外"提示） */
    enabled: boolean;
    /** 用户此刻把自己挂在哪个房间 */
    currentRoom?: VRRoomId;
    /** 用户自己写的"在页外干嘛"，会注入聊天提示词 + 广播成行为卡片 */
    activity?: string;
    /** 最近一次更新时间 */
    updatedAt?: number;
    /** 用户在页外里的 chibi 形象（同角色 chibi 结构，来自 mode="user" 的捏人器） */
    chibi?: VRChibi;
    /** 用户存的多套形象（换装位）。 */
    chibiLooks?: VRChibi[];
}

export interface Toast {
    id: string;
    message: string;
    type: 'success' | 'error' | 'info';
}

export interface XhsStockImage {
    id: string;
    url: string;           // 图床URL (must be public https)
    tags: string[];        // 标签 e.g. ['美食','咖啡','下午茶']
    addedAt: number;       // timestamp
    usedCount: number;     // 被使用次数
    lastUsedAt?: number;   // 上次使用时间
}

// ── 占卜（折子戏·占卜）─────────────────────────────────────────────────────
/** 一张导入的占卜牌图。塔罗按 index 0~77、雷诺曼按 index 1~36 对应文件名。 */
export interface DivinationCard {
    id: string;            // `${deck}_${index}`
    deck: 'tarot' | 'lenormand';
    index: number;         // 塔罗 0~77 / 雷诺曼 1~36
    dataUrl: string;       // 压缩后的本地图（dataURL，存 IndexedDB）
    addedAt: number;
}

/** 一次占卜记录（可选持久化，便于「发到聊天」与回看）。 */
export interface DivinationSession {
    id: string;
    charId?: string;       // 一起占卜的角色（可空）
    kind: 'tarot' | 'lenormand' | 'liuyao' | 'meihua';
    question: string;
    /** engines 产出的牌面/卦象摘要文字 */
    readingText: string;
    /** 解读：手动写的或 API 生成的 */
    interpretation?: string;
    interpretedBy?: 'manual' | 'ai';
    createdAt: number;
}

// ── 番外仿真图文（折子戏·番外）结构化数据 ───────────────────────────────────
/** 仿微信聊天截图 */
export interface FauxWeChat {
    contactName: string;
    messages: { from: 'user' | 'char'; text: string; time?: string }[];
}
/** 仿微信朋友圈 */
export interface FauxMoments {
    author: string;
    text: string;
    images?: number;          // 占位图数量（仿真灰块）
    time: string;
    likes: string[];
    comments: { name: string; text: string }[];
}
/** 仿小红书图文笔记 */
export interface FauxXhs {
    title: string;
    body: string;
    images?: number;          // 占位图数量
    tags: string[];
    author: string;
    likes: number;
    comments: { name: string; text: string }[];
}
/** 仿匿名论坛帖 */
export interface FauxForum {
    board: string;
    title: string;
    op: { floor: string; text: string };
    replies: { floor: string; text: string }[];
}

export interface GalleryImage {
    id: string;
    charId: string;
    url: string;
    timestamp: number;
    review?: string;
    reviewTimestamp?: number;
    savedDate?: string; // YYYY-MM-DD format
    chatContext?: string[]; // Recent chat messages at time of save
}

export interface StickerData {
    id: string;
    url: string;
    x: number;
    y: number;
    rotation: number;
    scale?: number; 
}

export interface DiaryPage {
    text: string;
    paperStyle: string;
    stickers: StickerData[];
}

export interface DiaryEntry {
    id: string;
    charId: string;
    date: string;
    userPage: DiaryPage;
    charPage?: DiaryPage;
    timestamp: number;
    isArchived: boolean;
    /** 角色回复了的日记自动发到聊天后, 记录那条 score_card 消息的 id, 用于后续 edit/delete 同步 */
    chatCardMessageId?: number;
    /** 标记这条日记是"自动同步聊天"时代产生的 (本次更新后新建的). 老日记 (字段未设)
     *  才会在列表里看到手动归档按钮. 防止用户对已经在自动同步上的新日记再点归档造成重复. */
    autoSync?: boolean;
}

// ─── HANDBOOK / 手账 (跨角色聚合·零负担留痕本) ───
//
// 设计哲学（user 共识）:
//   - 主体是 user 自己的一天,LLM 读今天跨角色聊天后用 user 的口吻替 ta 写一份草稿
//     (user 不必模仿,后续会二次编辑)
//   - 即便 user 一天没说话,生活系角色们也会"过自己的小生活",自动填一两页陪伴页
//     (绝不能写成 AI 捧场 / 等 user / 想 user)
//   - 反完美主义:留白即真实,不强制每天生成,不显示连续天数,不做 streak
//   - 一日一 entry,id 直接是 'YYYY-MM-DD'
//
// Section / tag 模型留位但暂不在 UI 实装(等 user 想清楚)。
export type HandbookPageType =
    | 'user_diary'       // LLM 代笔 user 第一人称当日日记
    | 'character_life'   // 生活系角色今日的生活流(陪伴页)
    | 'user_note'        // user 自己手写/补充的一页
    | 'free';            // 自由格式,未来扩展用

export interface HandbookPage {
    id: string;
    type: HandbookPageType;
    charId?: string;          // type=character_life 时绑定的角色
    title?: string;
    content: string;          // 主体文本(也是编辑/兜底渲染用)
    /**
     * 碎片化展示:LLM 生成时若返回 JSON 数组(社媒碎碎念体),解析出来存这里。
     * 前端有 fragments 走 FragmentCollage 拼贴渲染,无则走 content 段落渲染。
     * user 编辑后会清空 fragments,回退到 content 段落形态。
     */
    fragments?: HandbookFragment[];
    paperStyle?: string;      // 'plain' | 'grid' | 'lined' | 'dot' | 'pink' | 'dark'
    tags?: string[];          // 预留:section/标签(生理期/饮食/项目…),v1 不渲染
    generatedBy?: 'llm' | 'user';
    generatedAt?: number;
    excluded?: boolean;       // user 把这页标记为不入册
    isPinned?: boolean;
}

export interface HandbookFragment {
    id: string;
    text: string;             // 30~80 字社媒碎碎念体
    time?: string;            // 可选时段标签,如 "上午 10 点" / "下午" / "10:23"
    // ─── v2 槽位元数据 (新版式才有) ─────────────────────
    /** 来自 LayoutTemplate 的槽 id */
    slotId?: string;
    /** 槽语义角色 — 渲染时按这个分发 */
    slotRole?: SlotRole;
    /** 谁写的 — 'user' 或某 charId */
    authorKind?: 'user' | 'char';
    /** 若是反应型槽 (sticky-reaction), 引用的目标 slotId */
    refersTo?: string;
    /** 结构化数据 (todo / gratitude / mood-card 等需要) */
    payload?: SlotPayload;
}

/**
 * 结构化 slot 数据。普通文本槽不用,
 * 仅 todo/gratitude/mood-card/timeline-plan 这种"列表/打分"才填。
 */
export type SlotPayload =
    | { kind: 'todo'; items: { text: string; done?: boolean }[] }
    | { kind: 'gratitude'; items: string[] }
    | { kind: 'timeline'; items: { time: string; text: string; emoji?: string }[] }
    | { kind: 'mood'; rating: number; tag?: string }       // rating 1~5
    | { kind: 'photo'; src?: string; caption: string };   // src 由 user 贴, 也可暂缺

// ─── 单页拼贴排版 ──────────────────────────────────────
//
// v2 设计 (2026-05): "版式优先"。先 roll 一份 layout template (pre-baked JSON),
// 它已包含每个槽的 {位置, 视觉角色, 字数预算, 可写者} —— LLM 只填空,不排版。
// 角色按顺序看到 "已填的槽 + 剩余槽 + 自己人格", 选一个槽写,或 pass。
//
// 旧的 'main'|'side'|'corner'|'margin' 仍然保留 (老数据回放兼容),
// 新版式用更语义化的 SlotRole, 渲染时按 role 分发到专门组件。
//
// 坐标都用百分比,固定比例的纸面 → 任意尺寸下都不破。

/** v1 旧角色 — 仅为兼容历史 entry 数据保留, 新版式不要再产出 */
export type LayoutRole =
    | 'main'        // 主区,大块,正放或微旋转
    | 'side'        // 侧栏,中等尺寸
    | 'corner'      // 角落,小卡片,大旋转
    | 'margin';     // 页边,极小尺寸,可以纵向

/**
 * v2 槽角色 —— 一个 role = 一种 "内容类型 + 视觉皮肤 + 写作约束"。
 * Renderer 按 role 分发, prompt 按 role 出 hint。
 *
 * - hero-diary       主日记本体, 当天主叙事 (80~180 字)
 * - timeline-plan    时间表 / 今日计划 (6~10 行)
 * - todo             待办清单 (3~6 项)
 * - gratitude        今日感恩 / 三件好事 (3 项)
 * - mood-card        心情卡 + 评分 (20~50 字 + 1~5 ★)
 * - photo-caption    照片 + 短描述 (8~25 字, 图由 user 贴)
 * - sticky-reaction  反应便签 (15~50 字, char-only, 必须引用已填槽)
 * - corner-note      边角独白小字 (6~20 字)
 */
export type SlotRole =
    | 'hero-diary'
    | 'timeline-plan'
    | 'todo'
    | 'gratitude'
    | 'mood-card'
    | 'photo-caption'
    | 'sticky-reaction'
    | 'corner-note';

/** 谁能填这个槽 */
export type SlotAuthorKind = 'user' | 'char';

/**
 * 槽定义 —— template 里的一个空位, 渲染时也是 placement 的扩展。
 * 比 v1 的 LayoutPlacement 多: charBudget / eligibleAuthors / slotRole / hint
 */
export interface SlotDef {
    /** 槽 id, 在一份 template 内唯一 */
    id: string;
    /** 视觉 + 内容类型 */
    slotRole: SlotRole;
    /** 字数预算 [min, max] —— 给 LLM, 也给渲染器估高度 */
    charBudget: [number, number];
    /** 谁能填: ['user'] / ['char'] / ['user', 'char'] */
    eligibleAuthors: SlotAuthorKind[];
    /** 给 LLM 的一句话目的 (作为 prompt hint) */
    hint: string;
    /** 位置 — 整页百分比 */
    xPct: number;
    yPct: number;
    widthPct: number;
    /** 高度上限 (% of page) — 渲染器超出截断, 估高用 */
    maxHeightPct: number;
    rotate?: number;             // 默认 0
    zIndex?: number;             // 默认 10
    /** 是否本页 hero — 每页 ≤ 1, 字号最大, 视觉权重最高 */
    isHero?: boolean;
    /** 视觉皮肤变体 (例: sticky-reaction 的便签底色) */
    skinVariant?: string;
}

/** 一份预置版式 = 一组 SlotDef + 一些视觉装饰 */
export interface LayoutTemplate {
    id: string;                  // 'plan-day' / 'reflective-day' / 'photo-day' / ...
    name: string;                // 中文显示名
    /** 每页 SlotDef 列表; index 0 = page 1, 1 = page 2 ... */
    pages: SlotDef[][];
    /** 推荐使用条件提示 (orchestrator 选模板用) */
    suitFor?: string;
    /** 默认纸张底纹: 'plain' | 'grid' | 'lined' | 'dot' */
    paperStyle?: string;
}

/** v2 placement —— LayoutPlacement 的扩展, 携带 slot 元数据。
 *  老数据没有 slotRole 时, 渲染器走 v1 的 JournalFragmentCard。 */
export interface LayoutPlacement {
    pageId: string;             // 对应 HandbookPage.id
    fragmentId?: string;        // 对应 HandbookFragment.id;手写整页留空
    xPct: number;               // 0~100,左上角 x
    yPct: number;               // 0~100,左上角 y
    widthPct: number;           // 10~95,卡片宽度占页面百分比
    rotate: number;             // -10 ~ 10,角落可到 ±15
    zIndex: number;             // 越大越压上面
    role: LayoutRole;           // v1 角色 (兼容)
    /** 该页 hero — 字号最大、视觉最显眼。每页最多 1 个。 */
    isHero?: boolean;
    // ─── v2 字段 (新版式才有, 老数据为 undefined) ───
    /** 来自 template 的槽 id */
    slotId?: string;
    /** v2 语义角色 (有则按 SlotRole 分发渲染) */
    slotRole?: SlotRole;
    /** 高度上限 % */
    maxHeightPct?: number;
    /** 视觉变体 (跟随 SlotDef.skinVariant) */
    skinVariant?: string;
}

export interface HandbookLayout {
    pageNumber: number;         // 一张纸,1-based;超量时可有 page 2
    placements: LayoutPlacement[];
    generatedAt: number;
    /** v2 版式来源 template id (用于重生成时复用相同 template) */
    templateId?: string;
}

// ─── HANDBOOK TRACKER（自定义健康/生活打卡引擎）───
//
// 设计:
// - Tracker = 用户自定义的"打卡项"(生理期 / 饮食 / 喝水 / 心情 / 体重 / 服药 / 自定义……)
// - 每个 Tracker 有 schema(字段定义),系统提供模板,user 可改可建
// - TrackerEntry = 某 tracker 在某天的一条打卡记录,values 按 schema 存
// - 跟 HandbookPage 解耦:tracker 是结构化数据,page 是自由文本/碎片
//
export type TrackerFieldKind =
    | 'rating'       // 1~5 等级(滑块 / emoji 选择)
    | 'number'       // 数字(体重 / ml)
    | 'options'      // 多选 / 单选(经期流量:无/少/中/多)
    | 'photo'        // 一张图(饮食拍照)
    | 'text'         // 一句话备注
    | 'boolean';     // 是/否(今天有没有头痛)

export interface TrackerField {
    key: string;                     // values 字典里的 key
    label: string;                   // 显示名("评分" / "备注" / "流量")
    kind: TrackerFieldKind;
    required?: boolean;
    /** rating: 1~max 整数;number: 自由数字 */
    max?: number;
    min?: number;
    unit?: string;                   // 'kg' / 'ml' / '小时'
    /** options 时的可选项 */
    choices?: { value: string; label: string; emoji?: string }[];
    placeholder?: string;
}

export interface Tracker {
    id: string;
    name: string;                    // "心情" / "经期" / "今天有没有偏头痛"
    icon?: string;                   // emoji 或 sticker 名
    color: string;                   // tab/标记 底色
    schema: TrackerField[];
    createdAt: number;
    updatedAt: number;
    /** 系统预设 vs 用户自建（系统预设 user 可禁用但不可彻底删除）*/
    isBuiltin?: boolean;
    /** 在月历单元格上如何"一眼看到"今日 entry —— 默认显示主字段值 */
    cellRenderField?: string;        // schema field key
    sortOrder?: number;              // 在 tab 列表里的排序
}

export interface TrackerEntry {
    id: string;
    trackerId: string;
    date: string;                    // YYYY-MM-DD
    values: Record<string, any>;
    note?: string;
    createdAt: number;
    updatedAt: number;
}

export interface HandbookEntry {
    id: string;               // = date 'YYYY-MM-DD'
    date: string;
    pages: HandbookPage[];
    /** 二次 LLM 生成的整页排版;一天可能跨多张纸 */
    layouts?: HandbookLayout[];
    generatedAt?: number;     // 最后一次自动生成的时间
    updatedAt: number;
}

export interface Task {
    id: string;
    title: string;
    supervisorId: string;
    tone: 'gentle' | 'strict' | 'tsundere';
    deadline?: string;
    isCompleted: boolean;
    completedAt?: number;
    createdAt: number;
}

export interface Anniversary {
    id: string;
    title: string;
    date: string;
    charId: string;
    aiThought?: string;
    lastThoughtGeneratedAt?: number;
}

/**
 * 岁时记 · 日历贴纸
 * 用户 / 角色往某一天贴的一条标记。author='user' 是手动贴的；
 * author='character' 是角色按人设自己惦记/想做的事（AI 生成，charId 必填）。
 */
export interface CalendarMark {
    id: string;
    date: string;            // 'YYYY-MM-DD'
    text: string;
    author: 'user' | 'character';
    charId?: string;         // author==='character' 时为该角色 id
    color?: string;          // 贴纸/胶带色（hex 或 tailwind 友好的色值）
    emoji?: string;          // 可选小贴纸
    createdAt: number;
}

export interface SocialComment {
    id: string;
    authorName: string;
    authorAvatar?: string;
    content: string;
    likes: number;
    isCharacter?: boolean;
    authorType?: 'user' | 'character' | 'stranger';
    authorCharId?: string;
    /** 朋友圈：回复某条评论（name 用于渲染 "A 回复 B: xxx"） */
    replyTo?: { commentId: string; name: string };
}

export interface SocialPost {
    id: string;
    authorName: string;
    authorAvatar: string;
    title: string;
    content: string;
    images: string[];
    likes: number;
    isCollected: boolean;
    isLiked: boolean;
    comments: SocialComment[];
    timestamp: number;
    tags: string[];
    bgStyle?: string;
    authorType?: 'user' | 'character' | 'stranger';
    authorCharId?: string;
    /** 朋友圈：点赞列表（id 为角色 id 或 'user'） */
    likedBy?: { id: string; name: string }[];
    /** 朋友圈：转发的原帖摘要（嵌入原帖内容） */
    repostOf?: { postId: string; authorName: string; content: string; images?: string[] } | null;
    /** 朋友圈：所在位置 */
    location?: string;
    /** 朋友圈：谁可以看（private = 角色不可见、不互动） */
    visibility?: 'public' | 'private';
    /** 朋友圈：提醒谁看（角色 id 列表，被提醒的角色保证互动） */
    mentionedCharIds?: string[];
}

// --- 推特 App（本地 AI 生成 X/Twitter 时间线）---

export type TwitterAuthorType = 'user' | 'character' | 'npc';
export type TwitterNotificationKind = 'reply' | 'like' | 'retweet' | 'quote' | 'mention' | 'follow' | 'dm';

export interface TwitterTranslation {
    targetLang: string;
    text: string;
    provider?: 'ai' | 'fallback';
    translatedAt: number;
}

export type TwitterMediaType = 'image' | 'video' | 'gif' | 'link-card' | 'quote-card';

export interface TwitterMedia {
    type: TwitterMediaType;
    url?: string;
    alt?: string;
    color?: string;
    title?: string;
    description?: string;
    domain?: string;
    durationMs?: number;
    thumbnailColor?: string;
}

export interface TwitterPollOption {
    id: string;
    label: string;
    votes: number;
}

export interface TwitterPoll {
    id: string;
    question?: string;
    options: TwitterPollOption[];
    votedOptionId?: string;
    closesAt?: number;
    closed?: boolean;
}

export interface TwitterReply {
    id: string;
    accountId?: string;
    authorType: TwitterAuthorType;
    authorName: string;
    authorHandle: string;
    authorAvatar?: string;
    charId?: string;
    content: string;
    language?: string;
    country?: string;
    location?: string;
    translations?: Record<string, TwitterTranslation>;
    likes: number;
    createdAt: number;
    replyToReplyId?: string;
}

export interface TwitterTweet {
    id: string;
    accountId?: string;
    authorType: TwitterAuthorType;
    authorName: string;
    authorHandle: string;
    authorAvatar?: string;
    charId?: string;
    authorBio?: string;
    authorLocation?: string;
    authorVerified?: boolean;
    authorFollowers?: number;
    content: string;
    language?: string;
    country?: string;
    location?: string;
    translations?: Record<string, TwitterTranslation>;
    topics: string[];
    media?: TwitterMedia[];
    poll?: TwitterPoll;
    mentions?: string[];
    replies: TwitterReply[];
    replyCount: number;
    retweets: number;
    quotes: number;
    likes: number;
    views: number;
    liked?: boolean;
    retweeted?: boolean;
    bookmarked?: boolean;
    repostedBy?: string;
    pinned?: boolean;
    visibility?: 'public' | 'followers' | 'circle';
    threadSize?: number;
    createdAt: number;
    sourceTweetId?: string;
    sourceTweet?: {
        id: string;
        accountId?: string;
        authorName: string;
        authorHandle: string;
        content: string;
        language?: string;
    };
    quoteNote?: string;
    threadId?: string;
    threadIndex?: number;
    qualityTags?: string[];
    generated?: boolean;
}

export interface TwitterTrend {
    id: string;
    label: string;
    posts: number;
    blurb?: string;
}

export interface TwitterNotification {
    id: string;
    kind: TwitterNotificationKind;
    tweetId: string;
    actorType: TwitterAuthorType;
    actorName: string;
    actorHandle: string;
    actorAvatar?: string;
    actorCharId?: string;
    snippet: string;
    createdAt: number;
    read?: boolean;
}

export interface TwitterProfile {
    id: 'me';
    displayName: string;
    handle: string;
    avatar?: string;
    bannerColor?: string;
    bio?: string;
    location?: string;
    website?: string;
    birthday?: string;
    joinedAt: number;
    language?: string;
    country?: string;
    followers: number;
    following: number;
    updatedAt: number;
}

export interface TwitterAccount {
    id: string;
    authorType: TwitterAuthorType;
    charId?: string;
    displayName: string;
    handle: string;
    avatar?: string;
    bannerColor?: string;
    bio?: string;
    location?: string;
    website?: string;
    birthday?: string;
    joinedAt: number;
    language?: string;
    country?: string;
    followers: number;
    following: number;
    verified?: boolean;
    postingWeight?: number;
    styleTags?: string[];
    interests?: string[];
    commonContacts?: string[];
    profileSummary?: string;
    relationshipHint?: string;
    recentStatus?: string;
    pinnedTweetId?: string;
    profileTabs?: Array<'posts' | 'replies' | 'media' | 'likes' | 'quotes' | 'about'>;
    lastActiveAt?: number;
    followed?: boolean;
    generated?: boolean;
    updatedAt: number;
}

export interface TwitterSearchRecord {
    id: string;
    query: string;
    resultCount?: number;
    createdAt: number;
}

export interface TwitterDMMessage {
    id: string;
    threadId: string;
    senderType: 'user' | 'account';
    accountId?: string;
    content: string;
    tweetId?: string;
    tweetSnapshot?: Pick<TwitterTweet, 'id' | 'authorName' | 'authorHandle' | 'content' | 'topics' | 'replyCount' | 'retweets' | 'likes' | 'language'>;
    createdAt: number;
    read?: boolean;
    status?: 'sent' | 'read' | 'failed';
}

export interface TwitterDMThread {
    id: string;
    accountId: string;
    accountName: string;
    accountHandle: string;
    accountAvatar?: string;
    participantType: Exclude<TwitterAuthorType, 'user'>;
    participantCharId?: string;
    lastMessage: string;
    updatedAt: number;
    unreadCount: number;
    messages: TwitterDMMessage[];
}

export interface SubAccount {
    id: string;
    handle: string; 
    note: string;   
}

export interface SocialAppProfile {
    name: string;
    avatar: string;
    bio: string;
}

export interface StudyChapter {
    id: string;
    title: string;
    summary: string;
    difficulty: 'easy' | 'normal' | 'hard';
    isCompleted: boolean;
    rawContentRange?: { start: number, end: number }; 
    content?: string; 
}

export interface StudyCourse {
    id: string;
    title: string;
    rawText: string; 
    chapters: StudyChapter[];
    currentChapterIndex: number;
    createdAt: number;
    coverStyle: string; 
    totalProgress: number; 
    preference?: string; 
}

export interface StudyTutorPreset {
    id: string;
    name: string;
    prompt: string;
}

// --- QUIZ / PRACTICE BOOK TYPES ---
export interface QuizQuestionNote {
    question: string;
    answer: string;
    timestamp: number;
}

export interface QuizQuestion {
    id: string;
    type: 'choice' | 'true_false' | 'fill_blank';
    stem: string;
    options?: string[];
    answer: string;           // For choice: "A"/"B"/etc, true_false: "true"/"false", fill_blank: the text
    explanation: string;
    userAnswer?: string;
    isCorrect?: boolean;
    notes?: QuizQuestionNote[];  // Follow-up Q&A notes per question
}

export interface QuizSession {
    id: string;
    courseId: string;
    chapterId: string;
    chapterTitle: string;
    courseTitle: string;
    questions: QuizQuestion[];
    score: number;
    totalQuestions: number;
    aiReview: string;         // AI review/commentary full text
    status: 'in_progress' | 'graded';
    createdAt: number;
    gradedAt?: number;
}

export type GameTheme = 'fantasy' | 'cyber' | 'horror' | 'modern';

export interface GameActionOption {
    label: string;
    type: 'neutral' | 'chaotic' | 'evil';
}

export interface GameLog {
    id: string;
    role: 'gm' | 'player' | 'character' | 'system';
    speakerName?: string;
    content: string;
    timestamp: number;
    diceRoll?: {
        result: number;
        max: number;
        check?: string;
        success?: boolean;
    };
    // 自动总结后，被归档折叠的日志会标记为 archived（不删除，UI 灰显折叠）
    archived?: boolean;
}

// 自动总结产出的「前情提要」存档，像写小说一样记录起因经过结果与人物关系变化
export interface GameSummary {
    id: string;
    content: string;       // 小说式总结（起因/经过/结果 + 人物关系变化）
    logCount: number;      // 本段总结覆盖了多少条日志
    logIds?: string[];     // 本段总结覆盖的日志 id（用于把原文与总结对应展示）
    createdAt: number;
}

export interface GameSession {
    id: string;
    title: string;
    theme: GameTheme;
    worldSetting: string;
    playerCharIds: string[];
    logs: GameLog[];
    status: {
        location: string;
        health: number;
        sanity: number;
        gold: number;
        inventory: string[];
    };
    sanityLocked?: boolean;
    diceDisabled?: boolean;      // 关闭骰子：行动不再自动骰 D20，默认直接成功
    // 归档模式：'auto' 满20条自动总结并送进角色 chatapp；'manual' 自动总结但不送，仅手动归档时送。
    // 旧存档无此字段，按 'manual' 处理（不污染旧角色的聊天上下文）。
    archiveMode?: 'auto' | 'manual';
    suggestedActions?: GameActionOption[];
    summaries?: GameSummary[];   // 自动总结归档的前情提要
    createdAt: number;
    lastPlayedAt: number;
}

export type MessageType = 'text' | 'image' | 'emoji' | 'interaction' | 'transfer' | 'system' | 'social_card' | 'forum_card' | 'chat_forward' | 'screen_peek_card' | 'xhs_card' | 'twitter_card' | 'score_card' | 'music_card' | 'mcd_card' | 'html_card' | 'news_card' | 'vr_card' | 'trpg_card' | 'location' | 'voice' | 'call_log' | 'takeout_card' | 'proposal_card' | 'poll_card' | 'relay_card' | 'checkin_card' | 'gift_card';

/** 购物商城：一件礼物（内置目录条目）。 */
export interface ShopItem {
    id: string;
    name: string;
    emoji: string;          // 礼物图标（emoji）；没有真实图片时作为「文字图」展示
    price: number;          // 价格（元）
    category: string;       // 分类 key
    blurb: string;          // 一句话描述
    image?: string;         // 真实商品图 URL（AI 生成/有图时填，渲染时优先用图，否则用 emoji 文字图）
    generated?: boolean;    // 是否 AI 实时生成（区分内置兜底商品）
    rating?: number;        // 评分 1.0~5.0（AI 生成，有好有坏；缺省时按 id 确定性派生）
}

/** 购物商城：优惠券（满减券）。满 threshold 元减 discount 元。 */
export interface ShopCoupon {
    id: string;
    title: string;
    threshold: number;      // 使用门槛（满 X 元）
    discount: number;       // 立减金额（元）
}

/** 购物商城：背包里拥有的一件物品（user 买下但还没送出去的）。 */
export interface ShopOwnedItem {
    uid: string;            // 唯一实例 id（同一 item 可拥有多件）
    itemId: string;
    name: string;
    emoji: string;
    price: number;
    boughtAt: number;
}

/** 购物商城：购物车里的一行（某商品 + 数量）。user 与 char 各有一个购物车。 */
export interface ShopCartLine {
    itemId: string;
    qty: number;
}

/** 购物商城：订单里的一件商品（带数量快照）。 */
export interface ShopOrderItem {
    itemId: string;
    name: string;
    emoji: string;
    price: number;
    qty: number;
}

/** 购物商城：一笔订单（淘宝式，含物流配送进度）。下单 → 物流推进 → 确认收货后进背包。 */
export interface ShopOrder {
    id: string;
    items: ShopOrderItem[];
    total: number;
    /** 'self'=自己付；'char'=角色代付（payerName 记角色名） */
    paidBy: 'self' | 'char';
    payerName?: string;
    placedAt: number;
    etaAt: number;          // 预计送达时间戳
    receivedAt?: number;    // 用户点「确认收货」的时刻
    refundedAt?: number;    // 用户申请退款（退款/售后）成功的时刻；退款后订单不再进背包
    coinDiscount?: number;  // 本单用淘金币抵扣的金额（元，仅展示用）
}

/** 购物商城·浏览足迹：看过某商品的记录。 */
export interface ShopFootprint {
    itemId: string;
    at: number;
}

/** 购物商城·我写的商品评价（确认收货后晒单；按 orderId+itemId 唯一）。 */
export interface ShopUserReview {
    id: string;
    itemId: string;
    orderId: string;
    stars: number;          // 1~5
    text: string;
    at: number;
}

/** 购物商城：一条小票（购买 / 赠送 / 收礼）。user 与 char 各存一份历史。 */
export interface ShopReceipt {
    id: string;
    itemId: string;
    name: string;
    emoji: string;
    price: number;
    /** 谁的动作：用户 or 角色 */
    by: 'user' | 'char';
    /** buy=给自己买；gift=送出；receive=收到对方送的 */
    action: 'buy' | 'gift' | 'receive';
    /** 对方是谁：charId / 'user' / 'self'（给自己买） */
    counterpartId: string;
    counterpartName: string;
    note?: string;          // 赠言 / 角色买它的理由
    at: number;
}

/**
 * 消息送达状态（Telegram 式回执，存 metadata.msgStatus）：
 * - 'sent'：已发出（单勾）
 * - 'read'：对方已读（双勾）—— 用户消息在角色成功回复后标记；角色消息在用户打开聊天页时标记
 * - 'failed'：发送失败（红色感叹号）—— 本地 API 调用失败时标记
 * 旧消息没有该字段时不显示任何回执。
 */
export type MessageDeliveryStatus = 'sent' | 'read' | 'failed';

export interface Message {
    id: number;
    charId: string; 
    groupId?: string; 
    role: 'user' | 'assistant' | 'system';
    type: MessageType;
    content: string;
    timestamp: number;
    metadata?: any; 
    replyTo?: {
        id: number;
        content: string;
        name: string;
    };
}

/** 絮语私聊档案内的消息快照。id 会在恢复到活跃 messages 表时重新生成。 */
export interface PrivateChatArchiveMessage {
    originalId?: number;
    charId: string;
    role: 'user' | 'assistant' | 'system';
    type: MessageType;
    content: string;
    timestamp: number;
    metadata?: any;
    replyTo?: {
        id?: number;
        content: string;
        name: string;
    };
}

/** 絮语私聊档案：参考 SillyTavern 的 per-character chat file 管理。 */
export interface PrivateChatArchive {
    id: string;
    charId: string;
    title: string;
    pinned?: boolean;
    createdAt: number;
    updatedAt: number;
    messageCount: number;
    lastMessagePreview?: string;
    messages: PrivateChatArchiveMessage[];
    source?: 'moro' | 'sillytavern' | 'manual';
}

/** 电话 App：一条通话记录（拨出 / 接听 / 未接）。
 *  与 CallApp 的通话消息（metadata.callSessionId）互补：CallApp 落详细逐字稿，
 *  这里只落"通话发生过"的轻量条目，供电话 App 的通话记录列表展示与回拨。 */
export interface PhoneCallLog {
    id: string;
    charId?: string;        // 已知角色时关联；手动拨陌生号码时为空
    name: string;           // 显示名（角色名或号码本身）
    number: string;         // 虚拟号码（角色号码由 charId 确定性生成）
    direction: 'outgoing' | 'incoming' | 'missed';
    timestamp: number;
    durationSec: number;    // 未接 = 0
    sessionId?: string;     // 关联 CallApp 的 callSessionId（有录音/逐字稿时可跳转）
    mode?: 'voice' | 'video'; // 默认语音；视频聊天落库时标记为 video
}

/** 日记社：一篇日记（用户或角色视角） */
export interface ExchangeDiaryEntry {
    id: string;
    author: 'user' | 'char';
    charId: string;         // author === 'char' 时为角色 id；user 篇记录"写给谁看"的当前活跃角色
    authorName: string;
    avatar?: string;
    mood?: string;          // sunny / rainy / starry / cozy / wild
    seals?: string[];       // secret / gratitude / courage / dream / routine
    content: string;
    date: string;           // YYYY-MM-DD
    timestamp: number;
    isSummary?: boolean;    // 由"今日对话总结"自动生成的篇目
}

/** 日记社：一本多角色共写的交换日记本 */
export interface ExchangeDiaryBook {
    id: string;
    title: string;
    charIds: string[];      // 参与的角色
    activeCharId: string;   // 当前对话/回应的角色
    paperStyle?: string;    // plain / grid / lined / pink / dark
    entries: ExchangeDiaryEntry[];
    createdAt: number;
    updatedAt: number;
}

/** 偷看心声：一次"窥探角色内心"的生成结果（角色不知情，不进聊天上下文） */
export interface InnerVoiceEntry {
    id: string;
    charId: string;
    content: string;
    timestamp: number;
}

export interface EmojiCategory {
    id: string;
    name: string;
    isSystem?: boolean;
    allowedCharacterIds?: string[]; // If set, only these characters can see this category
}

export interface Emoji {
    name: string;
    url: string;
    categoryId?: string;
    /** 描述：表情面板按描述搜索用，同时注入提示词帮 AI 选表情。 */
    description?: string;
}

export interface FullBackupData {
    timestamp: number;
    version: number;
    theme?: OSTheme;
    apiConfig?: APIConfig;
    instantPushConfig?: InstantPushConfig;
    pushVapid?: { vapidPublicKey: string; vapidPrivateKey: string; vapidEmail?: string; updatedAt?: number; };
    apiPresets?: ApiPreset[];
    availableModels?: string[];
    realtimeConfig?: RealtimeConfig;  // 实时感知配置（天气/新闻/Notion）
    memoryPalaceConfig?: MemoryPalaceBackupConfig;
    customIcons?: Record<string, string>;
    appearancePresets?: AppearancePreset[];
    characters?: CharacterProfile[];
    groups?: GroupProfile[]; 
    messages?: Message[];
    privateChatArchives?: PrivateChatArchive[];
    customThemes?: ChatTheme[];
    savedEmojis?: Emoji[]; 
    emojiCategories?: EmojiCategory[]; 
    savedJournalStickers?: {name: string, url: string}[]; 
    assets?: { id: string, data: string }[];
    galleryImages?: GalleryImage[];
    userProfile?: UserProfile;
    diaries?: DiaryEntry[];
    tasks?: Task[];
    anniversaries?: Anniversary[];
    roomTodos?: RoomTodo[]; 
    roomNotes?: RoomNote[];
    socialPosts?: SocialPost[]; 
    courses?: StudyCourse[]; 
    games?: GameSession[];
    worldbooks?: Worldbook[]; 
    roomCustomAssets?: { id?: string; name: string; image: string; defaultScale: number; description?: string; visibility?: 'public' | 'character'; assignedCharIds?: string[] }[]; 
    
    novels?: NovelBook[];
    vrNovels?: VRWorldNovel[];          // 虚拟世界「页外」全局小说库
    vrAnnotations?: VRNovelAnnotation[]; // 虚拟世界小说批注
    customCreatorParts?: CustomCreatorPart[]; // 捏脸系统自定义部件
    vrMusicRoom?: VRMusicRoomState;            // 听歌房共享状态
    vrGuestbook?: VRGuestbookState;            // 留言簿共享状态
    vrScripts?: VRScript[];                     // 剧院·投稿剧本库
    vrStagedPlays?: VRStagedPlay[];             // 剧院·历史舞台剧
    vrPresets?: { key: string; name: string; prompt: string; blurb?: string }[]; // 剧院·用户自定义写作风格预设
    vrLetters?: VRLetter[];                    // 邮局信件（本地存档+队列）
    vrSettings?: any[];                        // 页外设置（独立 API + 调用记录）
    vrPostOffice?: Record<string, string>;     // 邮局本机配置：身份 deviceId / 后端地址（存 localStorage）
    songs?: SongSheet[]; // Songwriting app data
    phoneCallLogs?: PhoneCallLog[];           // 电话 App 通话记录
    exchangeDiaryBooks?: ExchangeDiaryBook[]; // 日记社多角色交换日记本
    innerVoices?: InnerVoiceEntry[];          // 偷看心声历史
    llmPresets?: TavernPreset[];              // 预设 App：SillyTavern 式 Chat Completion 预设
    personas?: Persona[];                     // 人设 App：SillyTavern 式用户人设
    relationshipNetworkEdges?: RelationshipNetworkEdge[];
    relationshipNetworkMessages?: RelationshipNetworkMessage[];
    relationshipNetworkAutoSettings?: RelationshipNetworkAutoSettings[];

    // Bank Data
    bankState?: BankFullState;
    bankDollhouse?: DollhouseState;
    bankTransactions?: BankTransaction[];

    socialAppData?: {
        charHandles?: Record<string, SubAccount[]>;
        userProfile?: SocialAppProfile;
        userId?: string;
        userBg?: string;
    };
    
    mediaAssets?: {
        charId: string;
        avatar?: string;
        sprites?: Record<string, string>;
        dateSkinSets?: SkinSet[];
        activeSkinSetId?: string;
        customDateSprites?: string[];
        spriteConfig?: SpriteConfig;
        roomItems?: Record<string, string>;
        backgrounds?: { chat?: string; date?: string; roomWall?: string; roomFloor?: string };
    }[];

    xhsActivities?: XhsActivityRecord[];
    xhsStockImages?: XhsStockImage[];
    twitterTweets?: TwitterTweet[];
    twitterNotifications?: TwitterNotification[];
    twitterProfile?: TwitterProfile;
    twitterAccounts?: TwitterAccount[];
    twitterDMThreads?: TwitterDMThread[];
    twitterSearchRecords?: TwitterSearchRecord[];

    // Study Room settings
    studyApiConfig?: Partial<APIConfig>;
    studyTutorPresets?: StudyTutorPreset[];

    // Quiz / Practice Book
    quizSessions?: QuizSession[];

    // Guidebook (攻略本)
    guidebookSessions?: GuidebookSession[];

    // Chat delayed actions
    scheduledMessages?: {
        id: string;
        charId: string;
        content: string;
        dueAt: number;
        createdAt: number;
    }[];

    // LifeSim
    lifeSimState?: LifeSimState | null;

    // Memory Palace (记忆宫殿)
    memoryNodes?: any[];
    memoryVectors?: any[];
    memoryLinks?: any[];
    topicBoxes?: any[];
    anticipations?: any[];
    eventBoxes?: any[];
    memoryPalaceHighWaterMarks?: Record<string, number>; // charId → lastProcessedMsgId
    memoryPalaceFlags?: Record<string, string>; // mp_personality_tried_* / mp_first_archive_notice_* 等 UI 标记
    cloudBackupConfig?: CloudBackupConfig;
    remoteVectorConfig?: { enabled: boolean; supabaseUrl: string; supabaseAnonKey: string; initialized: boolean };

    // Character daily schedule (角色日程表 — daily_schedule store)
    dailySchedules?: DailySchedule[];

    // 手账（跨角色聚合留痕本 — handbook store）
    handbooks?: HandbookEntry[];

    // 手账 Tracker（健康/生活打卡引擎）
    trackers?: Tracker[];
    trackerEntries?: TrackerEntry[];

    // Memory Palace 批次处理元数据
    memoryBatches?: any[];

    // Pixel Home（小屋像素界面）
    pixelHomeAssets?: any[];
    pixelHomeLayouts?: any[];

    // Chat 设置（翻译 / 归档 / 润色 prompts）
    chatTranslateSourceLang?: string;
    chatTranslateTargetLang?: string;
    chatTranslateSourceLangByChar?: Record<string, string>;
    chatTranslateTargetLangByChar?: Record<string, string>;
    chatTranslateEnabledByChar?: Record<string, boolean>;
    chatArchivePrompts?: any;
    chatActiveArchivePromptId?: string;
    characterRefinePrompts?: any;
    characterActiveRefinePromptId?: string;

    // 其它 UI / 偏好
    scheduleAppTheme?: string;
    handbookLifestreamDepth?: string;
    groupchatContextLimit?: number;
    browserConfig?: { braveKey?: string; useRealSearch?: boolean };
    bm25Mode?: string;
    lastActiveCharId?: string;
    eventNotifFlags?: Record<string, string>;  // moro_* 事件通知标记
    hotNewsSnapshots?: HotNewsSnapshot[];
}

// --- CLOUD BACKUP TYPES ---
// Two providers share one config: WebDAV (legacy) and GitHub Releases (new,
// no GFW friction for most users — just paste a Personal Access Token).
export type CloudBackupProvider = 'webdav' | 'github';

export interface CloudBackupConfig {
    enabled: boolean;
    provider?: CloudBackupProvider;     // undefined = 'webdav' (back-compat)

    // WebDAV
    webdavUrl: string;          // e.g. https://dav.jianguoyun.com/dav/
    username: string;
    password: string;           // App-specific password
    remotePath: string;         // e.g. /MoroBackup/

    // GitHub Releases — uses a Personal Access Token. Owner is resolved from
    // GET /user during connect; repo defaults to 'moro-backup' (private).
    githubToken?: string;
    githubOwner?: string;
    githubRepo?: string;
    githubUseProxy?: boolean;   // route through Cloudflare Worker (for GFW)

    lastBackupTime?: number;    // timestamp
    lastBackupSize?: number;    // bytes
}

export interface CloudBackupFile {
    name: string;
    size: number;
    lastModified: string;       // ISO date string
    href: string;               // WebDAV: remote path. GitHub: 'releaseId:assetId'
}

// --- GUIDEBOOK (攻略本) APP TYPES ---
export interface GuidebookOption {
    text: string;
    affinity: number;
}

export interface GuidebookRound {
    id: string;
    roundNumber: number;
    scenario: string;
    options: GuidebookOption[];
    gmNarration: string;
    charInnerThought: string;
    charChoice: number;
    charReaction: string;
    charExploration?: string;
    charInsight?: string;      // what user's scoring reveals about their personality
    affinityBefore: number;
    affinityAfter: number;
    timestamp: number;
}

export interface GuidebookEndCard {
    finalAffinity: number;
    charVerdict: string;
    title: string;
    highlights: string[];
    charSummary?: string;
    charNewInsight?: string;   // the one specific thing char learned about user this session
}

export interface GuidebookSession {
    id: string;
    charId: string;
    initialAffinity: number;
    currentAffinity: number;
    maxRounds: number;
    currentRound: number;
    mode: 'manual' | 'auto';
    scenarioHint?: string;
    recentMessageCount?: number;
    rounds: GuidebookRound[];
    openingSequence?: string;
    status: 'setup' | 'opening' | 'playing' | 'ended';
    endCard?: GuidebookEndCard;
    createdAt: number;
    lastPlayedAt: number;
}

// --- XHS FREE ROAM / AUTONOMOUS ACTIVITY TYPES ---

export type XhsActionType = 'post' | 'browse' | 'search' | 'comment' | 'save_topic' | 'idle';

export interface XhsActivityRecord {
    id: string;
    characterId: string;
    timestamp: number;
    actionType: XhsActionType;
    content: {
        title?: string;
        body?: string;
        tags?: string[];
        keyword?: string;
        savedTopics?: { title: string; desc: string; noteId?: string }[];
        notesViewed?: { noteId: string; title: string; desc: string; author: string; likes: number }[];
        commentTarget?: { noteId: string; title: string };
        commentText?: string;
    };
    thinking: string;  // Character's internal monologue / reasoning
    result: 'success' | 'failed' | 'skipped';
    resultMessage?: string;
}

export interface XhsFreeRoamSession {
    id: string;
    characterId: string;
    startedAt: number;
    endedAt?: number;
    activities: XhsActivityRecord[];
    summary?: string;  // AI-generated session summary
}

export interface XhsMcpConfig {
    enabled: boolean;
    serverUrl: string;  // MCP: "http://localhost:18060/mcp" | Skills: "http://localhost:18061/api" | Lite Worker: "https://xhs-lite.<acct>.workers.dev/api"
    cookie?: string;    // Lite 模式：登录后的小红书完整 cookie（含 a1 / web_session）。仅 lite Worker 用。
    loggedInUserId?: string;   // 登录用户的 user_id，连接测试成功后自动获取
    loggedInNickname?: string; // 登录用户的昵称
    userXsecToken?: string;    // 连接测试时从首页推荐自动提取的 xsec_token
}

// --- XHS 本地生成信息流（小红书 App：LLM 生成角色 + NPC 帖子，本地持久化）---

export interface XhsFeedComment {
    id: string;
    author: string;            // 显示昵称
    charId?: string;           // 角色评论时为角色 id；NPC 评论为空
    isUser?: boolean;          // 用户自己发的评论
    content: string;
    likes: number;
    timestamp: number;
}

export interface XhsFeedPost {
    id: string;
    authorType: 'character' | 'npc' | 'user';
    charId?: string;           // authorType='character' 时的角色 id
    author: string;            // 显示昵称
    authorAvatar?: string;     // 角色头像 / 用户头像；NPC 留空走字母头像
    title: string;
    body: string;
    tags: string[];
    coverUrl?: string;         // 封面图（来自小红书图库，可空 → 渐变占位）
    likes: number;
    liked?: boolean;           // 用户已点赞
    favs: number;
    faved?: boolean;           // 用户已收藏
    comments: XhsFeedComment[];
    createdAt: number;
    repostOf?: string;         // 转发：源帖 id
    repostNote?: string;       // 转发附言
}

// ============================================================
// 模拟人生 (LifeSim) Types — 真人秀沙盒版
// ============================================================

export type SimActionType =
    | 'ADD_NPC'        // 创建NPC并丢进某家庭
    | 'MOVE_NPC'       // 把NPC移到另一个家庭
    | 'TRIGGER_EVENT'  // 触发事件（吵架/联谊/出走等）
    | 'GO_SOLO'        // NPC独立成家
    | 'DO_NOTHING';    // 观望

export type SimEventType =
    | 'fight'          // 吵架
    | 'party'          // 联谊/聚会
    | 'gossip'         // 搬弄是非
    | 'romance'        // 暧昧
    | 'rivalry'        // 竞争
    | 'alliance';      // 结盟

// 事件链效果代码
export type SimEffectCode =
    | 'fight_break'           // 矛盾爆发（离家出走）
    | 'mood_drop'             // 心情低落
    | 'relationship_change'   // 关系变化
    | 'revenge_plot'          // 复仇计划
    | 'love_triangle'         // 三角恋
    | 'jealousy_spiral'       // 嫉妒螺旋
    | 'family_feud'           // 家族世仇
    | 'betrayal'              // 背叛
    | 'romantic_confession'   // 浪漫告白
    | 'gossip_wildfire'       // 八卦野火
    | 'npc_runaway'           // NPC出走
    | 'mood_breakdown'        // 情绪崩溃
    | 'secret_alliance'       // 秘密同盟
    | 'power_shift'           // 权力更迭
    | 'reconciliation';       // 和解

// NPC 内驱力
export type NPCDesire =
    | { type: 'socialize'; targetNpcId: string }
    | { type: 'revenge'; targetNpcId: string }
    | { type: 'romance'; targetNpcId: string }
    | { type: 'leave_family' }
    | { type: 'recruit'; targetNpcId: string }
    | { type: 'gossip_about'; targetNpcId: string }
    | { type: 'start_rivalry'; targetNpcId: string };

// 角色叙事层
export interface CharNarrative {
    innerThought: string;      // 角色内心独白（100字内）
    dialogue: string;          // 角色说的话/场景描写（150字内）
    commentOnWorld: string;    // 对世界状态的吐槽（50字内）
    emotionalTone: 'vengeful' | 'romantic' | 'scheming' | 'chaotic' | 'peaceful' | 'amused' | 'anxious';
}

export type SimStoryKind = 'main_plot' | 'character_drama' | 'ambient' | 'system';
export type SimStoryAttachmentKind = 'image' | 'item' | 'fanfic' | 'evidence';
export type SimStoryAttachmentRarity = 'common' | 'rare' | 'epic';

export interface SimStoryAttachmentDraft {
    kind: SimStoryAttachmentKind;
    title: string;
    summary: string;
    detail?: string;
    visualPrompt?: string;
    rarity?: SimStoryAttachmentRarity;
}

export interface SimStoryAttachment {
    id: string;
    kind: SimStoryAttachmentKind;
    title: string;
    summary: string;
    detail?: string;
    imageUrl?: string;
    rarity?: SimStoryAttachmentRarity;
}

export interface SimAction {
    id: string;
    turnNumber: number;
    actor: string;       // 'user' | char.name
    actorAvatar: string; // char.avatar or '🧑'
    actorId: string;     // 'user' | char.id | 'system' | 'autonomous'
    type: SimActionType;
    description: string;      // 自然语言，CHAR们读这个
    immediateResult: string;  // 即时后果描述
    reasoning?: string;       // 角色内心独白（完整原文）
    reactionToUser?: string;  // 角色对玩家操作的评价
    narrative?: CharNarrative; // 角色叙事层（LLM回合使用）
    chainFromId?: string;     // 由哪个事件链引发
    storyKind?: SimStoryKind;
    headline?: string;
    involvedNpcIds?: string[];
    attachments?: SimStoryAttachment[];
    timestamp: number;
}

export interface SimPendingEffect {
    id: string;
    triggerTurn: number;
    npcId?: string;
    familyId?: string;
    description: string;
    effectCode: SimEffectCode;
    effectValue?: number;
    chainFrom?: string;        // 产生此效果的事件ID
    severity?: number;         // 1-5 严重程度
    involvedNpcIds?: string[]; // 涉及的NPC
}

export interface SimNPC {
    id: string;
    name: string;
    emoji: string;       // 角色头像 emoji（后续替换为像素头像seed）
    personality: string[]; // ["暴躁","善良","好奇"]
    mood: number;        // -100 ~ 100
    familyId: string | null; // null = 独立
    profession?: SimProfession; // 纯身份标签
    gold?: number;              // 财富指标
    // 人物故事系统
    gender?: SimGender;         // 性别（每局随机）
    bio?: string;               // 人物简介（1-2句）
    backstory?: string;         // 背景故事（2-3句）
    // 内驱力系统
    desires?: NPCDesire[];      // 当前欲望
    grudges?: string[];         // 记仇对象 NPC IDs
    crushes?: string[];         // 暗恋对象 NPC IDs
    // 向后兼容旧存档（迁移时删除）
    energy?: number;
    skills?: SimSkills;
    inventory?: Record<string, number>;
    currentActivity?: SimActivity;
    activityResult?: string;
}

export interface SimFamily {
    id: string;
    name: string;
    emoji: string;       // 家庭标志 emoji
    memberIds: string[];
    relationships: Record<string, Record<string, number>>; // npcId -> npcId -> [-100,100]
    homeX: number;       // 0-100 percent
    homeY: number;
}

// ── LifeSim 基础类型 ──────────────────────────────────────────

export type SimSeason = 'spring' | 'summer' | 'fall' | 'winter';
export type SimWeather = 'sunny' | 'cloudy' | 'rainy' | 'stormy' | 'snowy' | 'windy';
export type SimTimeOfDay = 'dawn' | 'morning' | 'afternoon' | 'evening' | 'night';
export type SimProfession = 'programmer' | 'designer' | 'finance' | 'influencer' | 'lawyer' | 'freelancer' | 'barista' | 'musician'
    | 'internet_troll' | 'fanfic_writer' | 'fan_artist' | 'college_student' | 'tired_worker' | 'old_fashioned' | 'fashion_designer';

export type SimGender = 'male' | 'female' | 'nonbinary';

// 保留但不再使用的旧类型（存档兼容）
export type SimActivity = 'farming' | 'mining' | 'fishing' | 'crafting' | 'socializing' | 'resting' | 'foraging' | 'trading';
export interface SimSkills { farming: number; mining: number; fishing: number; crafting: number; social: number; foraging: number; }
export interface SimBuilding { id: string; type: string; name: string; x: number; y: number; level: number; familyId?: string; }

export interface SimFestival {
    name: string;
    season: SimSeason;
    day: number;
    emoji: string;
    description: string;
    moodBonus: number;
    relBonus: number;
    chaosChange: number;
}

// 离线回顾事件
export interface OfflineRecapEvent {
    day: number;
    season: SimSeason;
    timeOfDay: SimTimeOfDay;
    headline: string;          // 戏剧性标题
    description: string;       // 事件描述
    involvedNpcs: { name: string; emoji: string }[];
    eventType: SimEventType | SimEffectCode;
    moodChanges?: Record<string, number>;   // npcId -> delta
    relChanges?: { a: string; b: string; delta: number }[];
    chaosChange?: number;
    narrativeQuote?: string;   // 离线模板旁白
}

export interface LifeSimState {
    id: string;
    createdAt: number;
    turnNumber: number;
    currentActorId: string; // 'user' | char.id — 当前谁的回合
    families: SimFamily[];
    npcs: SimNPC[];
    actionLog: SimAction[];  // 完整历史
    pendingEffects: SimPendingEffect[];
    chaosLevel: number;      // 0-100，乱度指数
    charQueue: string[];     // 待执行的CHAR id队列（用户结束后填入）
    replayPending: SimAction[]; // 用户回来后待回放的行动
    participantCharIds?: string[]; // 允许参与本局LifeSim的外部角色
    useIndependentApiConfig?: boolean;
    independentApiConfig?: Partial<APIConfig>;
    isProcessingCharTurn: boolean;
    gameOver: boolean;
    gameOverReason?: string;
    // 时间系统
    season?: SimSeason;
    day?: number;        // 1-28
    year?: number;
    timeOfDay?: SimTimeOfDay;
    weather?: SimWeather;
    lastFestival?: string;  // 上次触发的节日名
    // 离线模拟
    lastActiveTimestamp?: number; // 上次活跃时间
    offlineRecap?: OfflineRecapEvent[]; // 离线回顾数据
    // 旧字段（存档兼容，运行时忽略）
    buildings?: SimBuilding[];
    worldInventory?: Record<string, number>;
    worldGold?: number;
}

// ─── 街角 · 约会世界引擎 (Date World Engine) ──────────────────────────
// char 带着 user 在不同场景里溜达的日常陪伴向约会。副 API 当世界引擎做场景调度，
// 支持内置/自定义场景、多世界线分支、话/动作分输入、氛围 BGM、每 20 轮总结隐藏上文。

/** 约会场景（内置或自定义） */
export interface DateScene {
  id: string;
  name: string;        // "海边栈道"
  emoji: string;       // "🌊"
  vibe: string;        // 基调/氛围（喂世界引擎 + BGM 生成）
  opening: string;     // 开场旁白
  builtin?: boolean;
}

export type DateRole = 'user' | 'char' | 'world';

/** 约会里的一条消息：user(话+动作) / char(回应) / world(世界引擎旁白·场景调度) */
export interface DateMessage {
  id: string;
  role: DateRole;
  speech?: string;     // 说的话
  action?: string;     // 做的动作 / 旁白
  ts: number;
}

/** 一条世界线（一个剧情分支）。多世界线 = 同角色下多条 DateWorldline。 */
export interface DateWorldline {
  id: string;
  charId: string;
  sceneId: string;
  sceneName: string;
  sceneEmoji: string;
  vibe: string;            // 当前氛围关键词（随剧情更新，喂 BGM）
  title: string;           // 世界线标题（自动取，用户可改）
  createdAt: number;
  updatedAt: number;
  turnCount: number;       // 已进行回合数（用于 20 轮总结）
  messages: DateMessage[]; // 当前可见消息（总结隐藏后只保留 mark 之后的）
  recap?: string;          // 截至 recapTurnMark 的剧情总结（隐藏上文后注入世界引擎）
  recapTurnMark?: number;
  parentId?: string;       // 从哪条世界线分叉来
  forkedAtTurn?: number;
  bgmAssetKey?: string;    // 已生成的专属 BGM 资源 key（minimaxMusic 缓存）
  bgmVibe?: string;        // 生成该 BGM 时的氛围
}

// ──────────────────────────────────────────────────────────────────
// 折子戏·谈心（heart-to-heart）：让 user 有个被认真倾听、被安慰的地方。
// 每段谈心是一串 user / char 轮流的话，可存档、可收录进岁时记·典藏馆、可转发给别的角色。
// ──────────────────────────────────────────────────────────────────
export interface TalkTurn {
  role: 'user' | 'char';
  text: string;
  at: number;
}
export interface TalkSession {
  id: string;
  charId: string;
  title: string;          // 取自首句或主题，列表展示用
  mood?: string;          // 谈心当下选的心情 / 主题标签
  turns: TalkTurn[];
  createdAt: number;
  lastActiveAt: number;
}

// ──────────────────────────────────────────────────────────────────
// 折子戏·狼人杀（捌）：拉一桌熟人开一局狼人杀。
// user 与选中的角色各占一座，AI 玩家按各自身份（狼 / 预言家 / 女巫 / 猎人 / 平民）
// 在夜里行动、白天发言、投票放逐。AI 发言走副 API、贴各自人设说话、会伪装会推理。
// 一局完整流程（夜→昼→投票）记在 log 里，可存档、回看、续局。
// 📌 prompt 文案集中在 utils/theaterPrompts.ts（[捌] 狼人杀 区段），引擎在 utils/theaterWerewolf.ts。
// ──────────────────────────────────────────────────────────────────
export type WerewolfRole = 'wolf' | 'seer' | 'witch' | 'hunter' | 'villager';
export type WerewolfPhase = 'setup' | 'night' | 'day' | 'vote' | 'over';
export type WerewolfDeathReason = 'wolf' | 'vote' | 'poison' | 'shot';

export interface WerewolfPlayer {
  seat: number;            // 座位号 1..N
  name: string;
  isUser: boolean;
  charId?: string;         // AI 玩家对应角色（user 座位无）
  avatar?: string;
  role: WerewolfRole;
  alive: boolean;
  deadRound?: number;      // 死于第几轮
  deadReason?: WerewolfDeathReason;
}

export interface WerewolfLogEntry {
  round: number;
  kind: 'narration' | 'speech' | 'vote' | 'death' | 'result' | 'system' | 'check';
  seat?: number;           // 关联玩家座位
  name?: string;           // 冗余存名字，避免座位重排
  text: string;
  at: number;
  privateToUser?: boolean; // 仅 user 可见（预言家查验结果等）
}

export interface WerewolfGame {
  id: string;
  title: string;
  createdAt: number;
  lastActiveAt: number;
  players: WerewolfPlayer[];
  round: number;           // 当前进行到第几轮（第 1 个夜晚 = 1）
  phase: WerewolfPhase;
  log: WerewolfLogEntry[];
  witchHealUsed: boolean;  // 女巫解药是否已用
  witchPoisonUsed: boolean;// 女巫毒药是否已用
  pendingKill?: number | null;   // 本夜狼刀目标座位（结算前暂存）
  winner?: 'good' | 'wolf' | null;
}

// ──────────────────────────────────────────────────────────────────
// 折子戏·真心话大冒险（玖）：和角色们围一圈玩转瓶子。
// 每轮转瓶子选一个「受题者」，TA 挑真心话或大冒险；另一个人出题，受题者作答/执行。
// user 与 AI 都能当受题者 / 出题者；AI 贴各自人设出题、答题，可调尺度（轻松/暧昧/大胆）。
// 一局＝一个圈 + 一串回合记录，可存档、回看、续玩。
// 📌 prompt 文案集中在 utils/theaterPrompts.ts（[玖] 真心话大冒险 区段），引擎在 utils/theaterTruthDare.ts。
// ──────────────────────────────────────────────────────────────────
export type TruthDareKind = 'truth' | 'dare';
export type TruthDareSpice = 'light' | 'flirty' | 'bold';

export interface TruthDarePlayer {
  id: string;          // 'user' 或 charId
  name: string;
  isUser: boolean;
  charId?: string;
  avatar?: string;
}

export interface TruthDareRound {
  no: number;          // 第几回合
  targetId: string;    // 受题者 player id
  targetName: string;
  kind: TruthDareKind; // 真心话 / 大冒险
  poserId: string;     // 出题者 player id
  poserName: string;
  challenge: string;   // 题面
  answer: string;      // 作答 / 执行描述
  at: number;
}

export interface TruthDareSession {
  id: string;
  title: string;
  createdAt: number;
  lastActiveAt: number;
  players: TruthDarePlayer[];
  spice: TruthDareSpice;    // 尺度
  rounds: TruthDareRound[];
}

// ──────────────────────────────────────────────────────────────────
// 岁时记·典藏馆：把「谈心 / 创作社 / 自习室 / 折子戏」里完成的内容收进来，
// 可在典藏馆里把已收录的剧场内容与谈心转发给任意角色（给 char B 看 user & char A 的记录）。
// ──────────────────────────────────────────────────────────────────
export type CollectionSourceType = 'talk' | 'novel' | 'song' | 'course' | 'quiz' | 'guidebook' | 'game' | 'chat';
export interface CollectionItem {
  id: string;                 // = `${sourceType}:${sourceId}`，天然去重
  sourceType: CollectionSourceType;
  sourceId: string;
  title: string;
  subtitle?: string;          // 副标题：参与角色 / 体裁 / 心情等
  excerpt?: string;           // 一小段预览
  charIds?: string[];         // 关联角色（用于「我和 A 的记录」与转发措辞）
  cover?: string;             // emoji 或图片 URL
  collectedAt: number;
}

// ──────────────────────────────────────────────────────────────────
// 外卖 App（参考美团）：char 可以给 user 点单、user 也可以给 char 点单。
// 店铺为本地生成（每次刷新 10+ 家，可进店点菜），订单可看配送进度、和骑手/商家聊天，
// 付款支持自己付与代付，并与来往 App 联动（给某角色点单/代付会在该角色聊天里留消息）。
// ──────────────────────────────────────────────────────────────────
/** 菜品规格组（单选）：如「份量：标准份/大份(+5)」「辣度：不辣/微辣/特辣」。对标美团「选规格」。 */
export interface TakeoutDishSpecOption { label: string; priceDelta: number; }
export interface TakeoutDishSpec { name: string; options: TakeoutDishSpecOption[]; }
/** 菜品加料（多选，按份加价）：如「加蛋 +2」「加宽粉 +3」。对标美团「加料」。 */
export interface TakeoutDishAddon { label: string; price: number; }
export interface TakeoutDish {
  id: string;
  name: string;
  desc?: string;
  price: number;
  emoji?: string;
  popular?: boolean;       // 招牌/热销
  /** 菜品月售（展示「月售N」），可选。 */
  monthlySales?: number;
  /** 规格组（单选，可多组：份量/辣度/甜度/冰量…），选项带差价。对标美团「选规格」。 */
  specs?: TakeoutDishSpec[];
  /** 加料（多选，按份加价）。对标美团「加料」。 */
  addons?: TakeoutDishAddon[];
}
export interface TakeoutStore {
  id: string;
  name: string;
  emoji: string;           // 店铺 logo（emoji）
  category: string;        // 中餐 / 奶茶 / 快餐 / 甜品 …
  rating: number;          // 4.x
  monthlySales: number;    // 月售
  deliveryMinutes: number; // 预计配送分钟
  deliveryFee: number;
  minOrder: number;        // 起送价
  distanceKm: number;
  promo?: string;          // 满减 / 首单优惠文案
  dishes: TakeoutDish[];
  /** AI 生成的店铺简介 / 招牌一句话（参照真实外卖店的「店铺公告」）。 */
  blurb?: string;
  /**
   * 隐藏的「良心值」0~1：越低越黑心（分量不足、卫生差、图文不符、强制砍单的概率越高）。
   * 现实里下单前看不见，只用于下单后掷配送事件；UI 不直接展示。
   */
  integrity?: number;
  /** 现实里看得见的红旗提示（如「近期卫生差评多·谨慎下单」）。黑心店里有一部分会亮明，正常店为空。 */
  warning?: string;
  /** AI 生成标记（用于「AI 现搓的店」徽标）。 */
  aiGenerated?: boolean;
}
export interface TakeoutOrderItem {
  dishId: string; name: string; price: number; qty: number; emoji?: string;
  /** 所选规格的合并描述（如「大份·微辣」），对标美团「选规格」。price 已含规格/加料差价。 */
  spec?: string;
  /** 所选加料（如「加蛋」「加肠」），对标美团「加料」。 */
  addons?: string[];
}
/** 一条 NPC / 商家 对评价的回应（「其它 npc 评论」） */
export interface TakeoutReviewReply { name: string; emoji: string; text: string; at: number; isMerchant?: boolean; }
/** 用户对某单的评价 */
export interface TakeoutReview {
  rating: number;       // 1~5 星
  text?: string;
  tags?: string[];      // 快捷标签（如「分量足」「送得快」）
  at: number;
  likes?: number;       // 其它食客点的「有用」数
  replies?: TakeoutReviewReply[];  // 商家 / 其它食客的评论
}
/**
 * 配送状态：
 * - preparing 商家备餐中 / delivering 骑手配送中（按时间实时推算）
 * - arrived 已到达·待收货（now >= etaAt 但用户尚未确认收货；「收到货才能点送达」的前提）
 * - delivered 已送达（用户点了确认收货，或给角色点的单到时角色已收下）
 * - cancelled 已取消
 */
export type TakeoutStatus = 'preparing' | 'delivering' | 'arrived' | 'delivered' | 'cancelled';
export interface TakeoutChatMsg { role: 'user' | 'rider' | 'store' | 'support'; text: string; at: number; }

/** 黑心商家 / 坏骑手会触发的现实化配送事故种类。 */
export type TakeoutIncidentKind =
  | 'short_weight'    // 缺斤少两 / 分量明显不足
  | 'missing_item'    // 漏发餐品
  | 'wrong_item'      // 送错餐 / 上错菜
  | 'foreign_object'  // 餐里有异物（头发、塑料…）
  | 'cold_food'       // 餐品冰凉坨成一团
  | 'spilled'         // 撒漏 / 包装破损汤汁洒光
  | 'severe_late'     // 严重超时
  | 'rider_ate'       // 骑手偷吃 / 动过餐
  | 'left_at_door'    // 不打电话直接丢门口（甚至放错地方）
  | 'fake_photo'      // 图文严重不符（卖家秀 vs 买家秀）
  | 'force_cancel';   // 商家收了钱迟迟不接单 / 强制砍单

/** 一桩配送事故；下单时按良心值/骑手靠谱度掷出，送达后暴露给用户。 */
export interface TakeoutIncident {
  kind: TakeoutIncidentKind;
  by: 'store' | 'rider';   // 责任方
  title: string;           // 短标题「缺斤少两」
  detail: string;          // 现实化描述
  suggestedRefund: number; // 合理赔付金额（投诉成立后退回钱包）
}

/** 投诉 / 售后处理状态。 */
export interface TakeoutComplaint {
  filed: boolean;          // 已发起投诉
  resolved: boolean;       // 平台已结案
  outcome?: string;        // 结案结论文案
  refunded: number;        // 本次投诉退回金额
}

export interface TakeoutOrder {
  id: string;
  storeId: string;
  storeName: string;
  storeEmoji: string;
  items: TakeoutOrderItem[];
  subtotal: number;
  deliveryFee: number;
  packFee: number;
  /** 可选：给跑腿的小费（结算时自选，计入 total，被强制砍单时随 total 原路退回）。 */
  tip?: number;
  total: number;
  /** 收货人：'me' = 用户本人，否则是 charId。 */
  recipient: string;
  /** 付款人：'me' = 用户自付，否则是某角色代付。 */
  payer: string;
  /** 主要关联角色 id（用于来往联动 / 列表展示）：recipient 或 payer 中那个角色。 */
  charId?: string;
  payStatus: 'unpaid' | 'paid';
  /** 落库时的基础状态；展示进度时按时间实时推算（liveTakeoutStatus）。 */
  status: TakeoutStatus;
  riderName: string;
  riderEmoji: string;
  address: string;
  note?: string;
  placedAt: number;
  etaAt: number;           // 预计送达时间戳
  /** 预约送达时间戳（选了「预约送达」时；为空＝尽快送达）。对标美团预约下单。 */
  scheduledAt?: number;
  /** 餐具份数（0＝无需餐具的环保选项）。对标美团餐具份数。 */
  tableware?: number;
  deliveredAt?: number;
  chat: TakeoutChatMsg[];  // 和骑手/商家/平台客服的对话
  chatTarget?: 'rider' | 'store' | 'support';
  /** 隐藏的骑手靠谱度 0~1：越低越容易超时/撒漏/偷吃/不送上门。 */
  riderReliability?: number;
  /** 下单时掷出、送达后暴露的配送事故（黑心商家 / 坏骑手）。 */
  incidents?: TakeoutIncident[];
  /** 投诉 / 售后。 */
  complaint?: TakeoutComplaint;
  /** 强制砍单的店铺：被商家单方面取消（钱已退回钱包）。 */
  cancelledByStore?: boolean;
  /** 发起方：用户在外卖 App / 聊天回形针点的 = 'user'；角色主动为用户点的 = 'char'。 */
  initiatedBy?: 'user' | 'char';
  /** 是否已在该角色聊天里生成「外卖订单小票」卡片（避免重复生成）。 */
  cardPosted?: boolean;
  /** 给角色点的单：到时角色已在聊天里对收到外卖做出反应，避免重复触发。 */
  reactionPosted?: boolean;
  /** 用户对本单的评价（送达后可评价；含商家/其它食客的评论）。 */
  review?: TakeoutReview;
}
