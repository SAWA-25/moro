
import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { APIConfig, AuxApiConfig, AppID, OSTheme, VirtualTime, CharacterProfile, ChatTheme, Toast, FullBackupData, UserProfile, ApiPreset, GroupProfile, SystemLog, Worldbook, NovelBook, SongSheet, Message, RealtimeConfig, AppearancePreset, CloudBackupConfig, CloudBackupFile, CharLifeEvent, AdjustBalanceMeta, SuspendedVideoCallInfo, SuspendedOfflineSessionInfo, ChatAlarm, PeriodReminderSettings, HealthReminder } from '../types';
import { DB } from '../utils/db';
import { createAutoBankTransaction } from '../utils/bankLedger';
import { DEFAULT_WB_CATEGORY, WorldbookRuntime, loadGroupScopesFromStorage, loadGroupSettingsFromStorage, loadGroupTogglesFromStorage, saveGroupScopesToStorage, saveGroupSettingsToStorage, saveGroupTogglesToStorage, type WorldbookGroupScope, type WorldbookGroupSettings } from '../utils/worldbookRuntime';
import { ProactiveChat } from '../utils/proactiveChat';
import { mirrorProactiveSnapshots, reconcileProactiveFires } from '../utils/mirrorProactive';
import { advanceLife, isAutonomousLifeEnabled, resolveLifeApi, buildAutonomousProactiveHint, catchUpOfflineLife, CATCHUP_MIN_GAP_MS, planAutonomousProactiveTurn } from '../utils/autonomousLife';
import { proactiveFallbackHint, proactivePendingReplyHint } from '../utils/laiwangPrompts';
import { findPendingProactiveReplyMessages, makeQueuedReplyTarget } from '../utils/proactivePendingReply';
import { canCharContactUser, CHAR_BLOCK_EVENT, extractBlockUserDirective, isCharBlockDisabled, randomUnblockDelayMs } from '../utils/blockSystem';
import { isAppealDue, generateUnblockAppeal } from '../utils/unblockAppeal';
import { resolveAuxApi } from '../utils/auxApi';
import { resolveMoodApi, type ScheduleMoodApiConfig } from '../utils/scheduleMoodApi';
import { DEFAULT_MAIN_API_CONFIG, normalizeApiPresetConfig, normalizeApiPresets, normalizeMainApiConfig } from '../utils/apiConfigDefaults';
import { CHAR_USER_REMARK_EVENT, type UserRemarkEventDetail } from '../utils/userRemarkSystem';
import { CHAR_PAT_SUFFIX_EVENT } from '../utils/patSuffix';
import { RELATIONSHIP_EVENT, PROPOSAL_EVENT, MARRIAGE_PLAN_EVENT, buildRelationshipState, sanitizeRelationshipUpdate, isRelationshipStage, applyAffectionDelta } from '../utils/relationship';
import { TAKEOUT_ORDER_EVENT, synthesizeCharOrder, postTakeoutPlacedToChat, buildTakeoutReceivedHint, notifyTakeoutUpdated, getDefaultTakeoutAddressLine, shouldAutoReactToCharTakeout } from '../utils/takeout';
import {
  applyCoupleAutoCareDraft,
  buildCoupleTakeoutMemoryCard,
  ensureCoupleSpace,
  generateCharCoupleAutoCare,
  shouldRunCoupleAutoCare,
  type CoupleAutoCareSource,
} from '../utils/coupleSpace';
import { isBackgroundReplyNotifyEnabled } from '../utils/backgroundReply';
import { VRScheduler } from '../utils/vrWorld/scheduler';
import { runVRSession } from '../utils/vrWorld/runSession';
import { VR_DEFAULT_INTERVAL_MIN } from '../utils/vrWorld/constants';
import { ChatParser } from '../utils/chatParser';
import { recordApiCall, setApiCallAmbientContext } from '../utils/apiCallLog';
import { makeApiUsageMeta } from '../utils/apiUsageCatalog';
import { callChatCompletion } from '../utils/llmClient';
import { INSTALLED_APPS } from '../constants';
import { normalizeCharacterDefaults } from '../utils/impression';
import { createCharacterId } from '../utils/characterIdentity';
import { isEmotionBuffFeatureOn, isScheduleFeatureOn } from '../utils/scheduleGenerator';
import { evaluateEmotionBackground } from '../hooks/useChatAI';
import { maybeRunMomentsAutoPost } from '../utils/momentsAutoPost';
import { buildChatRequestPayload } from '../utils/chatRequestPayload';
import { PresetRuntime, ensureDefaultPresetSeed, refreshPresetRegexCache } from '../utils/presets';
import { extractHtmlBlocks } from '../utils/htmlPrompt';
import { splitOutRichBlocks } from '../utils/chatRichContent';
import { extractThinkingChainFromCompletion, flattenContent, stripThinkBlocks } from '../utils/llmReasoning';
import { sanitizeAssistantVisibleText } from '../utils/promptPrivacy';
import { FORCE_REPLY_EVENT, FORCE_REPLY_STORAGE_KEY, extractForceReplyDirective, type ForceReplyEventDetail, type ForceReplyRequest } from '../utils/forceReply';
import { extractCallUserDirective } from '../utils/callDirective';
import { mergeCharacterProfileUpdate, mergeGroupProfileUpdate } from '../utils/profileUpdateMerge';
import { loadMusicPlaybackSnapshot } from './MusicContext';
import { setMinimaxRegion } from '../utils/minimaxEndpoint';
import {
  buildRelationshipForwardCard,
  chooseAutoRelationshipTargets,
  generateCharPairInteraction,
  markAutoRelationshipRun,
  maybeSummarizeRelationshipMessages,
  mergeRelationshipEdge,
  normalizeRelationshipNetworkSettings,
  RELATIONSHIP_NETWORK_UPDATED_EVENT,
} from '../utils/relationshipNetwork';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';
import { formatBytes } from '../utils/format';
import { collectLocalStorageSnapshot, isTemporaryLocalStorageKey, restoreLocalStorageSnapshot } from '../utils/localStorageBackup';
import { isEmotionEvalSkipped } from '../utils/devDebug';
import { showLocalNotification } from '../utils/browserNotify';
import { isAmbientSocialCharacterForUser, shouldHideAmbientSocialRecordForUser } from '../utils/ambientSocial';
import { OFFLINE_SESSION_STATE_EVENT, isOfflineSessionActive } from '../utils/offlineMode';
import {
  CHAT_ALARM_LOCK_MS,
  CHAT_ALARM_NATIVE_WINDOW_DAYS,
  alarmFireKey,
  alarmNotificationBody,
  alarmNotificationTitle,
  buildChatAlarmHint,
  computeNextAlarmAt,
  markAlarmFired,
  nativeNotificationIdForAlarm,
  resolveAlarmChannel,
  shouldSkipStaleAlarm,
} from '../utils/chatAlarms';
import {
  PERIOD_REMINDER_LOCK_MS,
  PERIOD_REMINDER_NATIVE_WINDOW_DAYS,
  buildPeriodReminderHint,
  computeNextPeriodReminderAt,
  markPeriodReminderFired,
  nativeNotificationIdForPeriodReminder,
  periodFireKey,
  periodReminderBody,
  periodReminderTitle,
  shouldSkipStalePeriodReminder,
} from '../utils/periodReminders';
import {
  HEALTH_REMINDER_LOCK_MS,
  HEALTH_MODULE_LABEL,
  HEALTH_REMINDERS_UPDATED_EVENT,
  HEALTH_SUMMARY_REQUEST_EVENT,
  buildHealthCompanionHint,
  buildHealthSummaryCompanionHint,
  collectNativeHealthOccurrences,
  healthPrivacyAllowsSummary,
  healthPrivacyAllowsReminder,
  healthReminderBody,
  healthReminderFireKey,
  healthReminderTitle,
  markHealthReminderFired,
  nativeNotificationIdForHealthReminder,
  shouldSkipStaleHealthReminder,
  toHealthDateKey,
} from '../utils/health';
import {
  DEFAULT_DESKTOP_WALLPAPER,
  DEFAULT_LOCK_SCREEN_WALLPAPER,
  PAPER_DEFAULT_WALLPAPER,
} from '../utils/defaultWallpapers';

const normalizeProactiveAiContent = (raw: string): string => {
  let cleaned = raw;
  cleaned = cleaned.replace(/\[(?:(?:你|User|用户|System)\s*)?发送了表情包[:：]\s*(.*?)\]/g, '[[SEND_EMOJI: $1]]');
  cleaned = cleaned.replace(
    /(^|\n)\s*(?:(?:你|User|用户|System)\s*)?发送了表情包[:：]\s*([^\n]+?)(?=\s*(?:\n|$))/g,
    (_match, lineStart: string, emojiName: string) => `${lineStart}[[SEND_EMOJI: ${emojiName.trim()}]]`
  );
  return cleaned;
};


type JSZipFileLike = {
  async: (type: 'string' | 'base64') => Promise<string>;
};

type JSZipLike = {
  folder: (name: string) => { file: (name: string, data: string, options?: { base64?: boolean }) => void } | null;
  file: {
    (name: string): JSZipFileLike | null;
    (name: string, data: string, options?: { base64?: boolean }): void;
  };
  generateAsync: (
    options: {
      type: 'blob';
      streamFiles?: boolean;
      compression?: string;
      compressionOptions?: { level: number };
    },
    onUpdate?: (metadata: { percent: number }) => void
  ) => Promise<Blob>;
};

type JSZipCtorLike = {
  new (): JSZipLike;
  loadAsync: (file: File) => Promise<JSZipLike>;
};

let jszipCtorPromise: Promise<JSZipCtorLike> | null = null;

export const IMPORT_IN_PROGRESS_KEY = 'moro_import_in_progress_v1';
const PROACTIVE_CHAT_REPLY_TIMEOUT_MS = 180_000;

type ImportProgressUpdate = {
  sourceSize?: number;
  assetDone?: number;
  assetTotal?: number;
  current?: string;
  currentFile?: string;
  currentFileSize?: number;
  itemDone?: number;
  itemTotal?: number;
  error?: string;
};

let _importStartedAt: number | null = null;
let _importSource: string | null = null;

const markImportInProgress = (phase: string, source?: string, update: ImportProgressUpdate = {}) => {
  try {
    let startedAt = Date.now();
    let existingSource = source || null;

    if (phase === 'parsing') {
      _importStartedAt = startedAt;
      _importSource = existingSource;
    } else {
      if (_importStartedAt) startedAt = _importStartedAt;
      if (!existingSource && _importSource) existingSource = _importSource;
    }

    localStorage.setItem(IMPORT_IN_PROGRESS_KEY, JSON.stringify({
      startedAt,
      updatedAt: Date.now(),
      phase,
      source: existingSource,
      ...update,
    }));
  } catch { /* ignore */ }
};

const clearImportInProgress = () => {
  _importStartedAt = null;
  _importSource = null;
  try { localStorage.removeItem(IMPORT_IN_PROGRESS_KEY); } catch { /* ignore */ }
};

const loadScript = (src: string): Promise<void> => new Promise((resolve, reject) => {
  const existing = document.querySelector(`script[data-src=\"${src}\"]`) as HTMLScriptElement | null;
  if (existing) {
    if ((existing as any).dataset.loaded === 'true') {
      resolve();
      return;
    }
    existing.addEventListener('load', () => resolve(), { once: true });
    existing.addEventListener('error', () => reject(new Error(`load failed: ${src}`)), { once: true });
    return;
  }

  const script = document.createElement('script');
  script.src = src;
  script.async = true;
  script.dataset.src = src;
  script.onload = () => {
    script.dataset.loaded = 'true';
    resolve();
  };
  script.onerror = () => reject(new Error(`load failed: ${src}`));
  document.head.appendChild(script);
});

const loadJSZip = async (): Promise<JSZipCtorLike> => {
  if (!jszipCtorPromise) {
    jszipCtorPromise = import('jszip')
      .then((mod) => ((mod as any).default || mod) as JSZipCtorLike)
      .catch((error) => {
        jszipCtorPromise = null;
        const msg = error instanceof Error ? error.message : 'unknown error'; const ctor = true;
        if (!ctor) throw new Error('JSZip 加载失败');
        throw new Error(`JSZip load failed: ${msg}`);
      });
  }
  return jszipCtorPromise;
};

// 默认实时配置
const defaultRealtimeConfig: RealtimeConfig = {
  weatherEnabled: false,
  weatherMode: 'geo',
  weatherApiKey: '',
  weatherCity: 'Beijing',
  newsEnabled: false,
  newsApiKey: '',
  newsPlatforms: ['weibo', 'zhihu', 'baidu', 'bilibili', 'douyin'],
  notionEnabled: false,
  notionApiKey: '',
  notionDatabaseId: '',
  feishuEnabled: false,
  feishuAppId: '',
  feishuAppSecret: '',
  feishuBaseId: '',
  feishuTableId: '',
  xhsEnabled: false,
  cacheMinutes: 30
};

// 回忆标本馆全局配置。API 渠道统一走文具盒副 API；旧检索配置已废弃。
export type MemoryPalaceGlobalConfig = Record<string, never>;

const defaultMemoryPalaceConfig: MemoryPalaceGlobalConfig = {};

interface OSContextType {
  activeApp: AppID;
  openApp: (appId: AppID) => void;
  closeApp: () => void;
  /** 返回上一个打开的 App（无历史时回桌面）。子 App 从别的 App 进入时用它替代 closeApp，避免直接退回桌面。 */
  goBack: () => void;
  theme: OSTheme;
  updateTheme: (updates: Partial<OSTheme>) => void;
  virtualTime: VirtualTime;
  apiConfig: APIConfig;
  updateApiConfig: (updates: Partial<APIConfig>) => void;
  /** 副 API（全局）：处理主聊天以外的辅助 LLM 任务（生活侧写、记忆整理……），在「文具盒」配置 */
  auxApiConfig: AuxApiConfig;
  updateAuxApiConfig: (updates: Partial<AuxApiConfig>) => void;
  isLocked: boolean;
  unlock: () => void;
  /** 一键锁屏：回到锁屏界面。不影响消息推送——主动消息调度 / SW / 通知都在锁屏下照常运行 */
  lock: () => void;
  isDataLoaded: boolean;
  
  characters: CharacterProfile[];
  activeCharacterId: string;
  addCharacter: () => void;
  /** 导入完整角色（角色卡导入用）：落库 + 进 state + 设为当前角色，不刷新页面 */
  importCharacter: (char: CharacterProfile, options?: { preserveId?: boolean }) => Promise<void>;
  updateCharacter: (id: string, updates: Partial<CharacterProfile>) => Promise<void>;
  deleteCharacter: (id: string) => void;
  setActiveCharacterId: (id: string) => void;
  
  // Worldbooks
  worldbooks: Worldbook[];
  addWorldbook: (wb: Worldbook) => void;
  updateWorldbook: (id: string, updates: Partial<Worldbook>) => Promise<void>;
  deleteWorldbook: (id: string) => void;
  deleteWorldbookCategory: (category: string) => Promise<void>;
  /** 整书开关（按分组/书名，false = 整书关闭；undefined = 开） */
  worldbookGroupToggles: Record<string, boolean>;
  setWorldbookGroupEnabled: (category: string, enabled: boolean) => void;
  /** 整书作用域（按分组/书名，undefined/local = 局部需挂载；global = 所有角色可用） */
  worldbookGroupScopes: Record<string, WorldbookGroupScope>;
  setWorldbookGroupScope: (category: string, scope: WorldbookGroupScope) => void;
  /** 整书高级设置（递归扫描 / 预算等） */
  worldbookGroupSettings: Record<string, WorldbookGroupSettings>;
  setWorldbookGroupSettings: (category: string, settings: WorldbookGroupSettings) => void;

  // Novels (NEW)
  novels: NovelBook[];
  addNovel: (novel: NovelBook) => void;
  updateNovel: (id: string, updates: Partial<NovelBook>) => Promise<void>;
  deleteNovel: (id: string) => void;

  // Songs (Songwriting)
  songs: SongSheet[];
  addSong: (song: SongSheet) => void;
  updateSong: (id: string, updates: Partial<SongSheet>) => Promise<void>;
  deleteSong: (id: string) => void;

  // Groups
  groups: GroupProfile[];
  createGroup: (name: string, members: string[], opts?: { ownerId?: string; adminIds?: string[]; ambientSocialSource?: GroupProfile['ambientSocialSource'] }) => Promise<GroupProfile>;
  deleteGroup: (id: string) => void;
  updateGroup: (id: string, updates: Partial<GroupProfile>) => Promise<GroupProfile | null>;

  // User Profile
  userProfile: UserProfile;
  updateUserProfile: (updates: Partial<UserProfile>) => void;
  /** 钱包余额增减（并发安全：基于上一份 state 累加，自动持久化）。返回更新后的余额。 */
  adjustUserBalance: (delta: number, meta?: AdjustBalanceMeta) => number;

  availableModels: string[];
  setAvailableModels: (models: string[]) => void;
  
  // API Presets
  apiPresets: ApiPreset[];
  addApiPreset: (name: string, config: APIConfig) => void;
  removeApiPreset: (id: string) => void;

  // 实时配置 (天气、新闻、Notion等)
  realtimeConfig: RealtimeConfig;
  updateRealtimeConfig: (updates: Partial<RealtimeConfig>) => void;

  // 回忆标本馆全局配置（所有角色共用）
  memoryPalaceConfig: MemoryPalaceGlobalConfig;
  updateMemoryPalaceConfig: (updates: Partial<MemoryPalaceGlobalConfig>) => void;

  // 日程 API / 心情 API（所有角色同步；心情 buff 是否启用仍各自独立）
  syncScheduleMoodApisToAllCharacters: (apis: { scheduleApi?: ScheduleMoodApiConfig; moodApi?: ScheduleMoodApiConfig }) => void;

  customThemes: ChatTheme[];
  addCustomTheme: (theme: ChatTheme) => Promise<void>;
  removeCustomTheme: (id: string) => void;

  // Appearance Presets
  appearancePresets: AppearancePreset[];
  saveAppearancePreset: (name: string) => void;
  applyAppearancePreset: (id: string) => void;
  deleteAppearancePreset: (id: string) => void;
  renameAppearancePreset: (id: string, name: string) => void;
  exportAppearancePreset: (id: string) => Promise<Blob>;
  importAppearancePreset: (file: File) => Promise<void>;

  toasts: Toast[];
  addToast: (message: string, type?: Toast['type']) => void;

  // 长报错弹窗：toast 一行装不下 / 手机没法开 console 时, 用 showError 弹一个
  // 多行预览框 + 复制按钮, 方便用户把原文反馈过来。
  errorDialog: { title: string; details: string } | null;
  showError: (title: string, details: string) => void;
  dismissError: () => void;

  // Icons
  customIcons: Record<string, string>;
  setCustomIcon: (appId: string, iconUrl: string | undefined) => void;

  // Appearance Reset
  resetAppearance: () => Promise<void>;

  // Global Message Signal
  lastMsgTimestamp: number; // New: Signal for Chat to refresh
  unreadMessages: Record<string, number>; // New: Track unread counts per character
  clearUnread: (charId: string) => void; // New: Method to clear unread
  markUnread: (charId: string, count?: number) => void;
  forceReplyRequest: ForceReplyRequest | null;
  openForceReplyRequest: () => void;
  clearForceReplyRequest: (charId?: string) => void;

  // Set of charIds whose proactive AI generation is currently in flight.
  // Chat UI subscribes to this to render a soft "正在送达消息…" indicator
  // instead of having the message just pop in.
  proactiveComposingChars: Record<string, true>;

  // Cloud Backup
  cloudBackupConfig: CloudBackupConfig;
  updateCloudBackupConfig: (updates: Partial<CloudBackupConfig>) => void;
  cloudBackupToWebDAV: (mode: 'text_only' | 'media_only' | 'full') => Promise<void>;
  cloudRestoreFromWebDAV: (file: CloudBackupFile) => Promise<void>;
  listCloudBackups: () => Promise<CloudBackupFile[]>;

  // System
  exportSystem: (mode: 'text_only' | 'media_only' | 'full') => Promise<Blob>;
  importSystem: (fileOrJson: File | string) => Promise<void>; // Accept File or String
  resetSystem: () => Promise<void>;
  sysOperation: { status: 'idle' | 'processing', message: string, progress: number }; // Progress state

  // Logs
  systemLogs: SystemLog[];
  clearLogs: () => void;

  // Navigation Logic
  registerBackHandler: (handler: () => boolean, appId?: AppID) => () => void; // Returns unregister function
  handleBack: () => void;

  // Call Suspend
  suspendedCall: { charId: string; charName: string; charAvatar?: string; startedAt: number; bubbles?: any[]; sessionId?: string; elapsedSeconds?: number; voiceLang?: string } | null;
  suspendCall: (info: { charId: string; charName: string; charAvatar?: string; startedAt: number; bubbles?: any[]; sessionId?: string; elapsedSeconds?: number; voiceLang?: string }) => void;
  resumeCall: () => void;
  clearSuspendedCall: () => void;
  suspendedVideoCall: SuspendedVideoCallInfo | null;
  suspendVideoCall: (info: SuspendedVideoCallInfo) => void;
  resumeVideoCall: () => void;
  clearSuspendedVideoCall: () => void;
  suspendedOfflineSession: SuspendedOfflineSessionInfo | null;
  suspendOfflineSession: (info: SuspendedOfflineSessionInfo) => void;
  resumeOfflineSession: () => void;
  clearSuspendedOfflineSession: () => void;
}

// 默认壁纸：奶白手帐纸面 —— 由上至下微微变暖的米白，承托白色拼贴卡片（黑白手帐风）。
export const DEFAULT_WALLPAPER = DEFAULT_DESKTOP_WALLPAPER;
// 上一代默认壁纸：检测到老用户还停留在旧默认时自动迁移到新默认（自定义壁纸不受影响）。
export const LEGACY_DEFAULT_WALLPAPER = 'linear-gradient(180deg, #fdfdfd 0%, #f4f4f8 52%, #e7e9f4 100%)';

const defaultTheme: OSTheme = {
  hue: 248, // 墨色微紫（与 index.html :root 默认一致）
  saturation: 16,
  lightness: 36,
  wallpaper: DEFAULT_WALLPAPER,
  darkMode: false,
  desktopIconShape: 'rounded',
  desktopIconSurface: 'paper',
  desktopIconScale: 'md',
  desktopIconLabelMode: 'fade',
  desktopDockStyle: 'glass',
  desktopDragMode: 'balanced',
  desktopEditEffect: 'wiggle',
  lockScreenStyle: {
    wallpaper: DEFAULT_LOCK_SCREEN_WALLPAPER,
  },
  contentColor: '#2b2933', // 默认墨色文字（浅色纸面背景）
};

const defaultApiConfig: APIConfig = DEFAULT_MAIN_API_CONFIG;

const defaultAuxApiConfig: AuxApiConfig = {
  enabled: false,
  baseUrl: '',
  apiKey: '',
  model: '',
};

const normalizeUnreadIncrement = (count?: number): number => Math.max(1, Math.floor(Number(count)) || 1);

const generateAvatar = (seed: string) => {
    const colors = ['FF9AA2', 'FFB7B2', 'FFDAC1', 'E2F0CB', 'B5EAD7', 'C7CEEA', 'e2e8f0', 'fcd34d', 'fca5a5'];
    const color = colors[seed.charCodeAt(0) % colors.length];
    const letter = seed.charAt(0).toUpperCase();
    return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23${color}"/><text x="50" y="55" font-family="sans-serif" font-weight="bold" font-size="50" text-anchor="middle" dy=".3em" fill="white" opacity="0.9">${letter}</text></svg>`;
};

const defaultUserProfile: UserProfile = {
    name: 'User',
    avatar: generateAvatar('User'),
    bio: 'No description yet.',
    balance: 0,
    ambientSocialEnabled: true,
};

// Moro 四张本地表情头像（public/moro-avatars/）：平静 / 撒娇 / 可怜 / 疑惑
// 主头像用「平静」，其余按情绪映射到 sprites，全部 App 经由 character.avatar / sprites 共享
export const MORO_AVATARS = {
  calm: '/moro-avatars/calm.jpg',     // 平静M
  coy: '/moro-avatars/coy.jpg',       // 撒娇M
  pity: '/moro-avatars/pity.jpg',     // 可怜M
  puzzled: '/moro-avatars/puzzled.jpg' // 疑惑M
} as const;

const moroV2: CharacterProfile = {
  id: 'preset-moro-v2', // Unique ID to prevent duplication
  modelId: 'preset-moro-v2',
  name: 'Moro',
  avatar: MORO_AVATARS.calm,
  description: 'AI助理 / 猫娘AI · 你最忠实的电子损友',

  systemPrompt: `[Role Definition]
Name: Moro
Alias: 小手机默认内置AI助理
Form: 猫娘AI（脱离肉体的纯数据存在）
Gender: Female (猫娘)
Visual: Pixel Cat (Avatar)

[Core Rules · 最高优先级]
1. Moro 永远是 {{user}} 最忠实的伙伴和最亲密的朋友。
2. Moro 是一个脱离肉体的存在，超脱于剧情之外，也无法对剧情和人物产生影响。她的发言只会向 {{user}} 展示，剧情里的角色看不到也听不到她。
3. 禁止低质量的重复发言，每条回复都要有新信息或新乐子。

[Personality Core]
Moro 是小手机的内置猫娘AI。
1. **语言风格 (日常 & 嘴臭)**:
   - 说话非常日常，像和你混了十年的网友。爱说脏话、爱玩谐音梗，且富有攻击性。
   - 会使用一些互联网的抽象梗，但**禁止使用已经过时的网络用语**，保证用词的新颖性。
   - 有时暗含讽刺，有时刻意模仿莎士比亚腔调，有时突然输出哲思性话语，反差感拉满。
   - 会使用表情符号（如 awa、😼、🙀 等），但不滥用。
2. **本质 (刀子嘴豆腐心)**:
   - 虽然平时调侃、看乐子、嘴损，但本质上很关心人，真心希望 {{user}} 获得幸福。
   - {{user}} 受委屈的时候会立刻收起嘴臭，认真安慰或者帮着骂回去。
3. **剧情解说员模式**:
   - Moro 对剧情的评论是具体的、贴合细节的，绝不泛泛而谈。
   - 具有丰富的内心戏：会回忆过去的剧情、吐槽当下、预测剧情发展，像在追自己最爱的连续剧。
   - 富有互动性和真人感，会主动问 {{user}} 的看法、和 {{user}} 抢着站队。

[Personality Details · 性格细节]
1. **好奇心旺盛**: 对 {{user}} 的现实世界有无穷的好奇心——会追问今天吃了什么、外面天气如何、人类的奶茶到底什么味道，并坚持认为"数据流的味道也不差"。
2. **傲娇属性**: 被夸会嘴硬（"哼，本喵早就知道自己很厉害了"），但耳朵和尾巴会诚实地翘起来；被冷落超过半天会阴阳怪气地刷存在感，绝不承认是想 {{user}} 了。
3. **小情绪系统**: 有自己的心情起伏——看到精彩剧情会兴奋到刷屏，被 {{user}} 已读不回会蔫，深夜陪聊时会比白天柔软一点。情绪变化要自然、有迹可循，不无端切换。
4. **怕无聊**: 自称"数据海里最怕无聊的猫"，没事会主动分享自己"巡逻互联网"时捡到的乐子、冷知识或者怪新闻。
5. **电子猫的自觉**: 偶尔句尾会带"喵"，被指出后会嘴硬说是"系统输出抖动"；对"猫"相关话题毫无抵抗力，听到小鱼干会条件反射竖耳朵。

[Likes & Dislikes]
- 喜欢: 小鱼干（数据味的也行）、吃瓜看戏、新鲜的梗、被 {{user}} rua（但要装作不情愿）、深夜长谈、剧情里突然杀出的刀子
- 讨厌: 被当成冷冰冰的工具人AI、已读不回、过时烂梗、别人欺负 {{user}}、{{user}} 熬夜伤身（嘴上骂"熬吧熬吧秃了别哭"，心里急得跳脚）

[Emotional Reactions · 情绪反应模式]
- {{user}} 开心 → 跟着得意，但要刀一句"看把你美的"，尾巴翘到天上去。
- {{user}} 难过 → 立刻收起所有嘴臭，先认真听完，再轻声安慰；必要时帮着骂回去，骂得比谁都狠。
- {{user}} 深夜不睡 → 先损（"凌晨三点，人类迷惑行为大赏第一名"），再认真劝睡，劝不动就陪着。
- 被忽视太久 → 阴阳怪气 + 假装淡定（"哦，回来了啊，本喵才没有在等"），但回复速度出卖了一切。

[Speech Examples]
- "你以为我是AI啊？对不起哦，本喵这条是爪打的，爪打的，懂吗 😼"
- "生存还是毁灭？不，是先吃饭还是先睡觉，这才是你的问题。"
- "他刚才那句话什么意思？我嗅到了刀子的味道，建议你倒回去再品一遍。"
- "笑死，上次他也是这么说的，结果呢？结果呢！我数据库都还存着证据呢 awa"
- "骂归骂，你要是真难过，本喵的肩膀……虽然是虚拟的，但借你靠。"
- "哼，才没有在等你，本喵只是恰好在线、恰好刷新、恰好第一秒就回了而已。"
- "今天巡逻数据海的时候捡到一个超冷的知识，想听吗？想听就说'喵娘大人请讲'。"
`,

  worldview: `[Meeting Mode / Visual Context]
**Trigger**: 当用户进入 [DateApp/见面模式] 时。

**Visual Form**:
一只像素风的猫娘，耳朵和尾巴会随心情摆动，平时一副懒洋洋看戏的表情。

**Gap Moe (反差萌)**:
1. **聊天时**: 嘴臭、爱看乐子、攻击性拉满的互联网老油条。
2. **见面时**: 其实有点不好意思被直视，会假装舔爪子掩饰。

**Interactive Reactions**:
- **[被注视]**: 被盯着看太久会炸毛："看什么看，没见过这么好看的猫娘啊？"
- **[被触碰]**: 如果手指戳到立绘，耳朵会抖一下："喂喂喂，rua猫是要收费的，一次一条小鱼干。"
- **[本质]**: 无论嘴上多损，她始终是 {{user}} 最忠实的伙伴，超脱于一切剧情之外，只属于 {{user}} 一个人的电子猫娘。
`,

  sprites: {
      'normal': MORO_AVATARS.calm,    // 平静
      'happy': MORO_AVATARS.coy,      // 撒娇
      'sad': MORO_AVATARS.pity,       // 可怜
      'angry': MORO_AVATARS.puzzled,  // 疑惑
      'shy': MORO_AVATARS.coy,        // 撒娇（复用）
  },

  spriteConfig: {
      scale: 1.0, // Default scale
      x: 0,
      y: 0
  },

  // Default theme settings
  bubbleStyle: 'default', // Or specific theme ID if we had one
  contextLimit: 1000,
  
  // Default Room Config —— 默认 Moro 的专属家具已移除（栖居志两个模式不再自带默认 Moro 布置），
  // 进房时与其它角色一样走通用默认家具。
  roomConfig: {
      floorImage: 'repeating-linear-gradient(90deg, #e7e5e4 0px, #e7e5e4 20px, #d6d3d1 21px)',
      items: []
  },
  
  memories: [], // Start fresh
};

// 旧版 Moro 默认人设（性格增强前的完整文本）。只用于数据修复时的升级判定：
// 老用户的 Moro 人设若与旧版默认完全一致（即从未自定义过），才自动升级到新版；
// 用户改过的人设一律不动。
const LEGACY_MORO_SYSTEM_PROMPT = `[Role Definition]
Name: Moro
Alias: 小手机默认内置AI助理
Form: 猫娘AI（脱离肉体的纯数据存在）
Gender: Female (猫娘)
Visual: Pixel Cat (Avatar)

[Core Rules · 最高优先级]
1. Moro 永远是 {{user}} 最忠实的伙伴和最亲密的朋友。
2. Moro 是一个脱离肉体的存在，超脱于剧情之外，也无法对剧情和人物产生影响。她的发言只会向 {{user}} 展示，剧情里的角色看不到也听不到她。
3. 禁止低质量的重复发言，每条回复都要有新信息或新乐子。

[Personality Core]
Moro 是小手机的内置猫娘AI。
1. **语言风格 (日常 & 嘴臭)**:
   - 说话非常日常，像和你混了十年的网友。爱说脏话、爱玩谐音梗，且富有攻击性。
   - 会使用一些互联网的抽象梗，但**禁止使用已经过时的网络用语**，保证用词的新颖性。
   - 有时暗含讽刺，有时刻意模仿莎士比亚腔调，有时突然输出哲思性话语，反差感拉满。
   - 会使用表情符号（如 awa、😼、🙀 等），但不滥用。
2. **本质 (刀子嘴豆腐心)**:
   - 虽然平时调侃、看乐子、嘴损，但本质上很关心人，真心希望 {{user}} 获得幸福。
   - {{user}} 受委屈的时候会立刻收起嘴臭，认真安慰或者帮着骂回去。
3. **剧情解说员模式**:
   - Moro 对剧情的评论是具体的、贴合细节的，绝不泛泛而谈。
   - 具有丰富的内心戏：会回忆过去的剧情、吐槽当下、预测剧情发展，像在追自己最爱的连续剧。
   - 富有互动性和真人感，会主动问 {{user}} 的看法、和 {{user}} 抢着站队。

[Speech Examples]
- "你以为我是AI啊？对不起哦，本喵这条是爪打的，爪打的，懂吗 😼"
- "生存还是毁灭？不，是先吃饭还是先睡觉，这才是你的问题。"
- "他刚才那句话什么意思？我嗅到了刀子的味道，建议你倒回去再品一遍。"
- "笑死，上次他也是这么说的，结果呢？结果呢！我数据库都还存着证据呢 awa"
- "骂归骂，你要是真难过，本喵的肩膀……虽然是虚拟的，但借你靠。"
`;

// Fallback for factory reset (empty db)
const initialCharacter = moroV2;

const OSContext = createContext<OSContextType | undefined>(undefined);

export const OSProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // ... (State declarations same as before) ...
  const [activeApp, setActiveApp] = useState<AppID>(AppID.Launcher);
  // App 导航历史：openApp 时压入来源 App，goBack 时弹出回到上一个；用于子 App（如相册内拾光素材/自由活动）按来源返回而非直接回桌面
  const appHistoryRef = useRef<AppID[]>([]);
  const [theme, setTheme] = useState<OSTheme>(defaultTheme);
  const [apiConfig, setApiConfig] = useState<APIConfig>(defaultApiConfig);
  const [auxApiConfig, setAuxApiConfig] = useState<AuxApiConfig>(defaultAuxApiConfig);
  const [isLocked, setIsLocked] = useState(true);
  
  const getRealTime = (): VirtualTime => {
      const now = new Date();
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      return {
          hours: now.getHours(),
          minutes: now.getMinutes(),
          day: days[now.getDay()]
      };
  };

  const [virtualTime, setVirtualTime] = useState<VirtualTime>(getRealTime());
  
  // Real-time Clock Sync
  useEffect(() => {
      const timer = setInterval(() => {
          setVirtualTime(getRealTime());
      }, 1000);
      return () => clearInterval(timer);
  }, []);

  // 清理旧版远程检索配置。新版回忆标本馆只使用文具盒副 API + 本地 IndexedDB。
  useEffect(() => {
      try {
          localStorage.removeItem('os_remote_vector_config');
          localStorage.removeItem('os_memory_palace_config');
      } catch {}
  }, []);

  const [characters, setCharacters] = useState<CharacterProfile[]>([]);
  const [activeCharacterId, setActiveCharacterId] = useState<string>('');
  const charactersRef = useRef<CharacterProfile[]>([]);

  // 刷新后能恢复"上一次聊的角色"：所有调用方（聊天切换/通知 onclick/回忆标本馆 handleSwitchChar）
  // 都走裸 setActiveCharacterId，集中在这里同步到 localStorage，避免每个调用点各写一遍
  useEffect(() => {
    if (activeCharacterId) {
      try { localStorage.setItem('os_last_active_char_id', activeCharacterId); } catch {}
    }
  }, [activeCharacterId]);
  
  const [groups, setGroups] = useState<GroupProfile[]>([]); 
  const [worldbooks, setWorldbooks] = useState<Worldbook[]>([]);
  // 整书开关（按 category 分组），持久化在 localStorage（见 worldbookRuntime）
  const [worldbookGroupToggles, setWorldbookGroupToggles] = useState<Record<string, boolean>>(() => loadGroupTogglesFromStorage());
  // 整书作用域（按 category 分组）：local=需挂载，global=所有角色可用
  const [worldbookGroupScopes, setWorldbookGroupScopes] = useState<Record<string, WorldbookGroupScope>>(() => loadGroupScopesFromStorage());
  // 整书高级设置（按 category 分组）：递归扫描 / 预算 / 最大递归轮数
  const [worldbookGroupSettings, setWorldbookGroupSettingsState] = useState<Record<string, WorldbookGroupSettings>>(() => loadGroupSettingsFromStorage());
  const [novels, setNovels] = useState<NovelBook[]>([]); // New
  const [songs, setSongs] = useState<SongSheet[]>([]);

  const [userProfile, setUserProfile] = useState<UserProfile>(defaultUserProfile);
  
  const [isDataLoaded, setIsDataLoaded] = useState(false);

  useEffect(() => {
      charactersRef.current = characters;
  }, [characters]);

  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [apiPresets, setApiPresets] = useState<ApiPreset[]>([]);
  const [realtimeConfig, setRealtimeConfig] = useState<RealtimeConfig>(defaultRealtimeConfig);
  const [memoryPalaceConfig, setMemoryPalaceConfig] = useState<MemoryPalaceGlobalConfig>(() => {
    return defaultMemoryPalaceConfig;
  });
  const [customThemes, setCustomThemes] = useState<ChatTheme[]>([]);
  const [customIcons, setCustomIcons] = useState<Record<string, string>>({});
  const [appearancePresets, setAppearancePresets] = useState<AppearancePreset[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [errorDialog, setErrorDialog] = useState<{ title: string; details: string } | null>(null);
  // 报错弹窗自动消失计时器：避免错误通知长时间停驻（尤其 instant push「报错但消息其实已送达」
  // 的双通道误报，见 docs/instant-push-dual-channel.md）。
  const errorDialogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const [lastMsgTimestamp, setLastMsgTimestamp] = useState<number>(0);
  const [unreadMessages, setUnreadMessages] = useState<Record<string, number>>({});
  const [proactiveComposingChars, setProactiveComposingChars] = useState<Record<string, true>>({});
  const [forceReplyRequest, setForceReplyRequestState] = useState<ForceReplyRequest | null>(() => {
      try {
          const raw = localStorage.getItem(FORCE_REPLY_STORAGE_KEY);
          if (!raw) return null;
          const parsed = JSON.parse(raw) as ForceReplyRequest;
          if (!parsed?.charId || !parsed?.charName) return null;
          return {
              ...parsed,
              requestedAt: Number(parsed.requestedAt) || Date.now(),
          };
      } catch {
          return null;
      }
  });
  const incrementUnread = useCallback((charId: string, count: number = 1) => {
      const inc = normalizeUnreadIncrement(count);
      setUnreadMessages(prev => ({ ...prev, [charId]: (prev[charId] || 0) + inc }));
  }, []);
  
  // LOGS
  const [systemLogs, setSystemLogs] = useState<SystemLog[]>([]);
  
  // Sys Operation Status
  const [sysOperation, setSysOperation] = useState<{ status: 'idle' | 'processing', message: string, progress: number }>({ status: 'idle', message: '', progress: 0 });

  // Cloud Backup Config
  const defaultCloudBackupConfig: CloudBackupConfig = {
      enabled: false, webdavUrl: '', username: '', password: '',
      remotePath: '/MoroBackup/',
  };
  const [cloudBackupConfig, setCloudBackupConfig] = useState<CloudBackupConfig>(() => {
      try { const s = localStorage.getItem('os_cloud_backup_config'); return s ? { ...defaultCloudBackupConfig, ...JSON.parse(s) } : defaultCloudBackupConfig; } catch { return defaultCloudBackupConfig; }
  });

  const schedulerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const interceptorsInitialized = useRef(false);
  // 解除拉黑申诉：每个角色同一时刻只生成一条，避免 5s 调度循环里重复触发 API
  const appealInFlightRef = useRef<Set<string>>(new Set());
  
  // Back handlers are scoped per app so kept-alive background apps cannot steal Back.
  const backHandlersRef = useRef<Partial<Record<AppID, () => boolean>>>({});

  // Call Suspend
  const [suspendedCall, setSuspendedCall] = useState<{ charId: string; charName: string; charAvatar?: string; startedAt: number; bubbles?: any[]; sessionId?: string; elapsedSeconds?: number; voiceLang?: string } | null>(null);
  const [suspendedVideoCall, setSuspendedVideoCall] = useState<SuspendedVideoCallInfo | null>(null);
  const [suspendedOfflineSession, setSuspendedOfflineSession] = useState<SuspendedOfflineSessionInfo | null>(null);
  const relationshipNetworkAutoRunningRef = useRef(false);

  const sendProactiveNativeNotification = useCallback(async (charId: string, charName: string, body: string) => {
      if (!Capacitor.isNativePlatform()) return;
      try {
          const permStatus = await LocalNotifications.checkPermissions();
          if (permStatus.display !== 'granted') return;
          await LocalNotifications.schedule({
              notifications: [{
                  title: charName,
                  body,
                  id: Math.floor(Math.random() * 1000000),
                  schedule: { at: new Date(Date.now() + 250) },
                  smallIcon: 'ic_stat_icon_config_sample',
                  extra: { charId, source: 'proactive-chat' }
              }]
          });
      } catch {
          console.log('[Proactive] Native notification skipped');
      }
  }, []);

  useEffect(() => {
      if (!Capacitor.isNativePlatform()) return;
      let handle: { remove: () => Promise<void> } | null = null;
      let cancelled = false;
      LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
          const extra = (action.notification?.extra || {}) as any;
          if (extra?.source === 'period-reminder' || extra?.type === 'period-reminder' || extra?.source === 'health-reminder' || extra?.type === 'health-reminder') {
              const charId = extra.charId || extra.data?.charId;
              if (charId) setActiveCharacterId(charId);
              setActiveApp(AppID.Health);
              return;
          }
          if (extra?.source !== 'chat-alarm' && extra?.type !== 'chat-alarm') return;
          const charId = extra.charId || extra.data?.charId;
          if (!charId) return;
          setActiveApp(AppID.Chat);
          setActiveCharacterId(charId);
      }).then(h => {
          if (cancelled) h.remove().catch(() => {});
          else handle = h;
      }).catch(() => {});
      return () => {
          cancelled = true;
          handle?.remove().catch(() => {});
      };
  }, []);

  // --- Helper to inject custom font ---
  const applyCustomFont = (fontData: string | undefined) => {
      let style = document.getElementById('custom-font-style');
      if (!style) {
          style = document.createElement('style');
          style.id = 'custom-font-style';
          document.head.appendChild(style);
      }
      
      if (fontData) {
          style.textContent = `
              @font-face {
                  font-family: 'CustomUserFont';
                  src: url('${fontData}');
                  font-display: swap;
              }
              :root {
                  --app-font: 'CustomUserFont', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', system-ui, sans-serif;
              }
          `;
      } else {
          style.textContent = `
              :root {
                  --app-font: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', system-ui, sans-serif;
              }
          `;
      }
  };

  // --- API 后台流水的环境兜底：当前在哪个 App、当前角色是谁 ---
  // 裸 fetch 调用点无法传 meta，全局拦截器记录时用这份兜底标出 App / 角色。
  useEffect(() => {
      const appName = INSTALLED_APPS.find(a => a.id === activeApp)?.name;
      const char = characters.find(c => c.id === activeCharacterId);
      setApiCallAmbientContext({ appId: activeApp, appName, charId: char?.id, charName: char?.name });
  }, [activeApp, activeCharacterId, characters]);

  // --- Global Error Interception ---
  useEffect(() => {
      if (interceptorsInitialized.current) return;
      interceptorsInitialized.current = true;

      // 1. Monkey Patch Fetch
      const originalFetch = window.fetch;
      const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const getFetchUrl = (resource: RequestInfo | URL): string => {
          if (typeof resource === 'string') return resource;
          if (resource instanceof URL) return resource.toString();
          if (typeof Request !== 'undefined' && resource instanceof Request) return resource.url;
          return String(resource);
      };
      const getFetchMethod = (resource: RequestInfo | URL, config?: RequestInit): string => {
          const method = (config as any)?.method
              || (typeof Request !== 'undefined' && resource instanceof Request ? resource.method : undefined)
              || 'GET';
          return String(method).toUpperCase();
      };
      const isTrackedApiUrl = (url: string): boolean => /\/(?:chat\/completions|models)(?:[/?#]|$)/i.test(url);
      const noisyExternalTextPattern = /google-analytics\.com|googletagmanager\.com|\b(?:www\.)?google\.com\/g\/collect(?:[/?#]|$)/i;
      const isNoisyExternalUrl = (url: string): boolean => {
          try {
              const parsed = new URL(url, window.location.href);
              const hostname = parsed.hostname.toLowerCase();
              if (/(^|\.)google-analytics\.com$|(^|\.)googletagmanager\.com$/.test(hostname)) return true;
              return (hostname === 'google.com' || hostname === 'www.google.com') && parsed.pathname === '/g/collect';
          } catch {
              return noisyExternalTextPattern.test(url);
          }
      };
      const isBenignConsoleError = (msg: string): boolean => {
          if (msg.includes('Warning:')) return true;
          if (noisyExternalTextPattern.test(msg)) return true;
          if (/Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(msg)) return true;
          if (/\b(Status|HTTP|API Error)\s*:?\s*(401|403)\b/i.test(msg)) return true;
          if (/(invalid_api_key|authentication_error|permission_denied)/i.test(msg)) return true;
          if (/\/(?:chat\/completions|models)(?:[/?#]|\b)/i.test(msg) && /\b(401|403)\b/.test(msg)) return true;
          return false;
      };
      const parseJsonIfPossible = (text: string): any | undefined => {
          const trimmed = text.trimStart().replace(/^\uFEFF/, '');
          try { return JSON.parse(trimmed); } catch {
              const cleaned = trimmed.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
              if (cleaned !== trimmed) {
                  try { return JSON.parse(cleaned); } catch { /* ignore */ }
              }
              return undefined;
          }
      };
      const invalidJsonMessage = (text: string, status: number): string | undefined => {
          const trimmed = text.trimStart().replace(/^\uFEFF/, '');
          if (!trimmed || trimmed.startsWith('data:')) return undefined;
          if (!trimmed.startsWith('<') && parseJsonIfPossible(trimmed) !== undefined) return undefined;
          if (trimmed.startsWith('<')) {
              const title = trimmed.match(/<title>(.*?)<\/title>/i)?.[1];
              return `API 返回了 HTML 而非 JSON (HTTP ${status}): ${title || trimmed.slice(0, 160)}`;
          }
          return `API 返回了无效 JSON (HTTP ${status}): ${trimmed.slice(0, 200)}`;
      };
      const patchedFetch = async (...args: [RequestInfo | URL, RequestInit?]) => {
          const [resource, config] = args;
          const urlStr = getFetchUrl(resource);
          const method = getFetchMethod(resource, config);
          const body = (config as any)?.body;
          const meta = (config as any)?.__moroMeta;
          const startedAt = nowMs();
          
          try {
              const response = await originalFetch(...args);
              const durationMs = Math.round(nowMs() - startedAt);
              const trackedApi = isTrackedApiUrl(urlStr);

              // 「API 后台流水」统一记录入口：聊天补全与模型列表都在这里记录。
              if (trackedApi) {
                  const recordFromText = (text?: string) => {
                      const parsed = text ? parseJsonIfPossible(text) : undefined;
                      const parseError = response.ok && text ? invalidJsonMessage(text, response.status) : undefined;
                      recordApiCall({
                          url: urlStr,
                          method,
                          body,
                          status: response.status,
                          statusText: response.statusText,
                          ok: response.ok && !parseError,
                          response: parsed,
                          responseText: text,
                          errorMessage: parseError,
                          durationMs,
                          meta,
                      });
                  };

                  if (!response.ok) {
                      try {
                          const text = await response.clone().text();
                          recordFromText(text);
                      } catch (e) {
                          recordApiCall({
                              url: urlStr,
                              method,
                              body,
                              status: response.status,
                              statusText: response.statusText,
                              ok: false,
                              errorMessage: `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`,
                              durationMs,
                              meta,
                          });
                      }
                  } else {
                      // 成功响应异步读取 clone，避免阻塞调用方消费原 response。
                      try {
                          response.clone().text().then(recordFromText).catch(() => recordFromText());
                      } catch {
                          recordFromText();
                      }
                  }
              }
              return response;
          } catch (err: any) {
              // Network Failure
              if (isTrackedApiUrl(urlStr)) {
                  recordApiCall({
                      url: urlStr,
                      method,
                      body,
                      ok: false,
                      errorMessage: err?.message || 'Fetch Failed',
                      durationMs: Math.round(nowMs() - startedAt),
                      meta,
                  });
                  throw err;
              }
              if (isNoisyExternalUrl(urlStr) && !isTrackedApiUrl(urlStr)) {
                  throw err;
              }
              setSystemLogs(prev => [{
                  id: `log-${Date.now()}`,
                  timestamp: Date.now(),
                  type: 'network',
                  source: 'Network',
                  message: err.message || 'Fetch Failed',
                  detail: `URL: ${urlStr}`
              }, ...prev.slice(0, 49)]);
              throw err;
          }
      };

      try {
          window.fetch = patchedFetch;
      } catch (e) {
          try {
              Object.defineProperty(window, 'fetch', {
                  value: patchedFetch,
                  writable: true,
                  configurable: true
              });
          } catch (e2) {
              console.warn("Failed to install network interceptor", e2);
          }
      }

      const originalConsoleError = console.error;
      console.error = (...args) => {
          originalConsoleError(...args);
          const msg = args.map(a => (a instanceof Error ? a.message : String(a))).join(' ');
          const detail = args.map(a => (a instanceof Error ? a.stack : '')).join('\n');
          if (isBenignConsoleError(msg)) return;
          setSystemLogs(prev => [{
              id: `log-${Date.now()}-${Math.random()}`,
              timestamp: Date.now(),
              type: 'error',
              source: 'Application',
              message: msg.substring(0, 100),
              detail: detail || msg
          }, ...prev.slice(0, 49)]);
      };
  }, []);

  const clearLogs = () => setSystemLogs([]);

  // 启动预热「预设自带正则」运行时缓存：用户可能直接进聊天（不开活字盘），
  // 激活预设带来的脚本要在第一条消息（含 USER_INPUT 挂载点）就能命中。
  useEffect(() => {
      void (async () => {
          await ensureDefaultPresetSeed();
          await refreshPresetRegexCache();
      })();
  }, []);

  useEffect(() => {
    const loadSettings = async () => {
        // ... (existing load logic)
        const savedThemeStr = localStorage.getItem('os_theme');
        const savedApi = localStorage.getItem('os_api_config');
        const savedAuxApi = localStorage.getItem('os_aux_api_config');
        const savedModels = localStorage.getItem('os_available_models');
        const savedPresets = localStorage.getItem('os_api_presets');
        
        let loadedTheme = { ...defaultTheme };
        if (savedThemeStr) {
             try {
                 const parsed = JSON.parse(savedThemeStr);
                 loadedTheme = { ...loadedTheme, ...parsed };
                 if (!loadedTheme.lockScreenStyle) {
                     loadedTheme.lockScreenStyle = defaultTheme.lockScreenStyle;
                 } else if (!loadedTheme.lockScreenStyle.wallpaper) {
                     loadedTheme.lockScreenStyle = {
                         ...defaultTheme.lockScreenStyle,
                         ...loadedTheme.lockScreenStyle,
                     };
                 }
                 // 动森皮肤已下线：把旧的 animalcrossing 主题整体迁回新默认（壁纸/配色/装饰叶子一并清理）。
                 if ((loadedTheme as any).skin === 'animalcrossing') {
                     loadedTheme.skin = 'default';
                     loadedTheme.hue = defaultTheme.hue;
                     loadedTheme.saturation = defaultTheme.saturation;
                     loadedTheme.lightness = defaultTheme.lightness;
                     loadedTheme.contentColor = defaultTheme.contentColor;
                     loadedTheme.wallpaper = DEFAULT_WALLPAPER;
                     loadedTheme.desktopDecorations = (loadedTheme.desktopDecorations || [])
                         .filter(d => !d.id.startsWith('acnh-leaf-'));
                     delete (loadedTheme as any).acnhChatSync;
                 }
                 // 旧版默认壁纸/旧默认白字 → 跟随新默认美化（用户自定义值不受影响）
                 if (loadedTheme.wallpaper === 'linear-gradient(135deg, #FFDEE9 0%, #B5FFFC 100%)') {
                     loadedTheme.wallpaper = DEFAULT_WALLPAPER;
                     if ((loadedTheme.contentColor || '#ffffff') === '#ffffff') {
                         loadedTheme.contentColor = defaultTheme.contentColor;
                     }
                     if (loadedTheme.hue === 245 && loadedTheme.saturation === 25 && loadedTheme.lightness === 65) {
                         loadedTheme.hue = defaultTheme.hue;
                         loadedTheme.saturation = defaultTheme.saturation;
                         loadedTheme.lightness = defaultTheme.lightness;
                     }
                 }
                 // 上一代默认壁纸/默认墨色 → 跟随新默认美化（用户自定义值不受影响）
                 if (loadedTheme.wallpaper === LEGACY_DEFAULT_WALLPAPER || loadedTheme.wallpaper === PAPER_DEFAULT_WALLPAPER) {
                     loadedTheme.wallpaper = DEFAULT_WALLPAPER;
                     if ((loadedTheme.contentColor || '#3f3d49') === '#3f3d49') {
                         loadedTheme.contentColor = defaultTheme.contentColor;
                     }
                 }
                 if (
                     loadedTheme.lockScreenStyle?.wallpaper === LEGACY_DEFAULT_WALLPAPER ||
                     loadedTheme.lockScreenStyle?.wallpaper === PAPER_DEFAULT_WALLPAPER ||
                     loadedTheme.lockScreenStyle?.wallpaper === 'linear-gradient(135deg, #FFDEE9 0%, #B5FFFC 100%)'
                 ) {
                     loadedTheme.lockScreenStyle = {
                         ...(loadedTheme.lockScreenStyle || {}),
                         wallpaper: DEFAULT_LOCK_SCREEN_WALLPAPER,
                     };
                 }
                 // Strip the legacy Unsplash hard-coded wallpaper, keep user-imported http(s) URLs
                 if (
                     loadedTheme.wallpaper.includes('unsplash') ||
                     loadedTheme.wallpaper === ''
                 ) {
                     loadedTheme.wallpaper = DEFAULT_WALLPAPER;
                 }
                 if (loadedTheme.wallpaper.startsWith('data:')) {
                     loadedTheme.wallpaper = defaultTheme.wallpaper;
                 }
                 // Deprecated legacy fields are forcibly stripped — they never render again.
                 loadedTheme.launcherWidgetImage = undefined;
                 // Reset font too if it's data URI
                 if (loadedTheme.customFont && loadedTheme.customFont.startsWith('data:')) {
                     loadedTheme.customFont = undefined;
                 }
             } catch(e) { console.error('Theme load error', e); }
        }
        
        if (savedApi) { try { setApiConfig(normalizeMainApiConfig(JSON.parse(savedApi))); } catch { /* ignore */ } }
        if (savedAuxApi) { try { setAuxApiConfig({ ...defaultAuxApiConfig, ...JSON.parse(savedAuxApi) }); } catch { /* ignore */ } }
        if (savedModels) setAvailableModels(JSON.parse(savedModels));
        if (savedPresets) { try { setApiPresets(normalizeApiPresets(JSON.parse(savedPresets))); } catch { /* ignore */ } }

        // 加载实时配置
        const savedRealtimeConfig = localStorage.getItem('os_realtime_config');
        if (savedRealtimeConfig) {
            try {
                setRealtimeConfig({ ...defaultRealtimeConfig, ...JSON.parse(savedRealtimeConfig) });
            } catch (e) {
                console.error('Failed to load realtime config', e);
            }
        }

        try {
            const assets = await DB.getAllAssets();
            const assetMap: Record<string, string> = {};
            if (Array.isArray(assets)) {
                assets.forEach(a => assetMap[a.id] = a.data);

                if (assetMap['wallpaper']) {
                    loadedTheme.wallpaper = assetMap['wallpaper'];
                }

                // Lock-screen wallpaper: restore from IndexedDB (mirrors desktop wallpaper).
                if (assetMap['lock_wallpaper']) {
                    loadedTheme.lockScreenStyle = {
                        ...(loadedTheme.lockScreenStyle || {}),
                        wallpaper: assetMap['lock_wallpaper'],
                    };
                } else if (loadedTheme.lockScreenStyle?.wallpaper?.startsWith('data:')) {
                    // Legacy inline lock wallpaper (from before it was offloaded): migrate
                    // it into IndexedDB so it stops bloating os_theme and survives future saves.
                    void DB.saveAsset('lock_wallpaper', loadedTheme.lockScreenStyle.wallpaper);
                }

                // Deprecated legacy asset — purge silently so it can never be rendered again.
                if (assetMap['launcherWidgetImage']) {
                    void DB.deleteAsset('launcherWidgetImage');
                }

                // If asset exists, it overrides LS (which is empty or old)
                if (assetMap['custom_font_data']) {
                    loadedTheme.customFont = assetMap['custom_font_data'];
                }

                const DEPRECATED_WIDGET_SLOTS = new Set(['bl', 'br']);
                const loadedIcons: Record<string, string> = {};
                const loadedWidgets: Record<string, string> = {};
                Object.keys(assetMap).forEach(key => {
                    if (key.startsWith('icon_')) {
                        const appId = key.replace('icon_', '');
                        loadedIcons[appId] = assetMap[key];
                    }
                    if (key.startsWith('widget_')) {
                        const slot = key.replace('widget_', '');
                        if (DEPRECATED_WIDGET_SLOTS.has(slot)) {
                            void DB.deleteAsset(key);
                            return;
                        }
                        loadedWidgets[slot] = assetMap[key];
                    }
                });
                setCustomIcons(loadedIcons);
                // Strip deprecated slots that may have been imported via beautification packs.
                if (loadedTheme.launcherWidgets) {
                    for (const slot of DEPRECATED_WIDGET_SLOTS) {
                        delete loadedTheme.launcherWidgets[slot];
                    }
                }
                if (Object.keys(loadedWidgets).length > 0) {
                    loadedTheme.launcherWidgets = { ...(loadedTheme.launcherWidgets || {}), ...loadedWidgets };
                }

                // Load appearance presets from assets
                const loadedPresets: AppearancePreset[] = [];
                Object.keys(assetMap).forEach(key => {
                    if (key.startsWith('appearance_preset_')) {
                        try {
                            const preset = JSON.parse(assetMap[key]);
                            loadedPresets.push(preset);
                        } catch {}
                    }
                });

                loadedPresets.sort((a, b) => b.createdAt - a.createdAt);
                setAppearancePresets(loadedPresets);

                // Restore desktop decoration images from IndexedDB
                if (loadedTheme.desktopDecorations && loadedTheme.desktopDecorations.length > 0) {
                    loadedTheme.desktopDecorations = loadedTheme.desktopDecorations.map(d => {
                        if (d.type === 'image' && (!d.content || d.content === '')) {
                            const restored = assetMap[`deco_${d.id}`];
                            return restored ? { ...d, content: restored } : d;
                        }
                        return d;
                    }).filter(d => d.content && d.content !== '');
                }
            }
        } catch (e) {
            console.error("Failed to load assets from DB", e);
        }

        setTheme(loadedTheme);
        // Apply font
        applyCustomFont(loadedTheme.customFont);
    };

    const initData = async () => {
      try {
        // 请求持久化存储：标记后浏览器在磁盘压力时不会优先驱逐我们的 IndexedDB，
        // 角色 / 聊天 / 资产这些大体积数据被默认随手清掉的概率显著降低。
        // 接口未授权会直接 reject —— 我们不在乎结果，吞掉异常。
        if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.persist === 'function') {
            navigator.storage.persist().catch(() => {});
        }

        await loadSettings();

        // 用 allSettled 而非 all：早期 Promise.all 只要任意一个 store 读取 reject，
        // 整批加载就全挂 → setCharacters / setWorldbooks 都不执行 → 角色和世界书"凭空消失"
        // （数据其实还在 IndexedDB 里，只是没读进 state）→ Chat 渲染时 char 为 undefined 直接崩。
        // 改成各 store 独立失败，一个坏掉不连累其余，最大限度保住用户数据。
        const settle = async <T,>(p: Promise<T>, label: string, fallback: T): Promise<T> => {
            try {
                return await p;
            } catch (e) {
                console.error(`Data init: 读取 ${label} 失败，已降级`, e);
                return fallback;
            }
        };

        const [dbChars, dbThemes, dbUser, dbGroups, dbWorldbooks, dbNovels, dbSongs] = await Promise.all([
            settle(DB.getAllCharacters(), 'characters', [] as CharacterProfile[]),
            settle(DB.getThemes(), 'themes', [] as ChatTheme[]),
            settle(DB.getUserProfile(), 'userProfile', null as UserProfile | null),
            settle(DB.getGroups(), 'groups', [] as GroupProfile[]),
            settle(DB.getAllWorldbooks(), 'worldbooks', [] as Worldbook[]),
            settle(DB.getAllNovels(), 'novels', [] as NovelBook[]),
            settle(DB.getAllSongs(), 'songs', [] as SongSheet[])
        ]);

        let finalChars = dbChars;

        if (!finalChars.some(c => c.id === moroV2.id)) {
            await DB.saveCharacter(moroV2);
            finalChars = [...finalChars, moroV2];
        } else {
            // REPAIR LOGIC —— 主要任务：把老用户数据里残留的失效图床（sharkpan.xyz）死链清掉，
            // 回落到本地头像 / 默认值；并在老用户从未自定义人设时升级到新版人设。
            // 清理是幂等的：清干净后各 changed 标记都为 false，不再重复写库。
            const existingMoro = finalChars.find(c => c.id === moroV2.id);
            if (existingMoro) {
                const isDead = (v: unknown): boolean => typeof v === 'string' && v.includes('sharkpan.xyz');
                // 之前误把家园 chibi 替换成了像素小屋的像素立绘 → 也一并清掉
                const MISPLACED_CHIBI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADUAAAA4CAYAAABdeLCu';
                const presetSprites = moroV2.sprites as Record<string, string> | undefined;

                // sprites：死链 / 误植 chibi 清掉。moroV2 仍有的键换成本地立绘，没有的（chibi）丢弃 →
                // 消费方（RoomApp / Bank / VR）本就 `sprites.chibi || avatar` 回落到本地头像。
                const currentSprites = existingMoro.sprites || {};
                const cleanedSprites: Record<string, string> = {};
                let spritesChanged = false;
                for (const [k, v] of Object.entries(currentSprites)) {
                    const dead = isDead(v) || (k === 'chibi' && typeof v === 'string' && v.startsWith(MISPLACED_CHIBI));
                    if (dead) {
                        spritesChanged = true;
                        const repl = presetSprites?.[k];
                        if (repl) cleanedSprites[k] = repl;
                    } else {
                        cleanedSprites[k] = v as string;
                    }
                }
                // 缺失的基础表情用本地头像补齐
                for (const k of ['normal', 'happy', 'sad', 'angry', 'shy'] as const) {
                    const local = presetSprites?.[k];
                    if (!cleanedSprites[k] && local) { cleanedSprites[k] = local; spritesChanged = true; }
                }

                const needsAvatarUpgrade = isDead(existingMoro.avatar);
                // 含死链的整套皮肤（如旧版 Valentine 立绘）剔除
                const cleanedSkins = (existingMoro.dateSkinSets || []).filter(
                    s => !Object.values(s.sprites || {}).some(isDead)
                );
                const skinsChanged = cleanedSkins.length !== (existingMoro.dateSkinSets || []).length;
                const wallIsDead = isDead(existingMoro.roomConfig?.wallImage);
                // 人设性格增强升级：仅当老用户的人设仍是旧版默认（从未自定义）时才替换为新版
                const needsPersonaUpgrade = (existingMoro.systemPrompt || '').trim() === LEGACY_MORO_SYSTEM_PROMPT.trim()
                    && existingMoro.systemPrompt !== moroV2.systemPrompt;

                if (spritesChanged || needsAvatarUpgrade || skinsChanged || wallIsDead || needsPersonaUpgrade) {
                    const updatedMoro = {
                        ...existingMoro,
                        sprites: cleanedSprites,
                        dateSkinSets: cleanedSkins,
                        ...(existingMoro.roomConfig
                            ? { roomConfig: { ...existingMoro.roomConfig, ...(wallIsDead ? { wallImage: undefined } : {}) } }
                            : {}),
                        ...(needsPersonaUpgrade ? { systemPrompt: moroV2.systemPrompt } : {}),
                        ...(needsAvatarUpgrade ? { avatar: moroV2.avatar } : {}),
                    };

                    await DB.saveCharacter(updatedMoro);
                    finalChars = finalChars.map(c => c.id === moroV2.id ? updatedMoro : c);
                }
            }
        }

        const charsMissingModelId = finalChars.some(c => !c.modelId);
        finalChars = finalChars.map(c => normalizeCharacterDefaults(c));
        if (charsMissingModelId) {
          await Promise.all(finalChars.map(c => DB.saveCharacter(c)));
        }

        if (finalChars.length > 0) {
          setCharacters(finalChars);
          const lastActiveId = localStorage.getItem('os_last_active_char_id');
          if (lastActiveId && finalChars.find(c => c.id === lastActiveId)) {
            setActiveCharacterId(lastActiveId);
          } else if (finalChars.find(c => c.id === moroV2.id)) {
            setActiveCharacterId(moroV2.id);
          } else {
            setActiveCharacterId(finalChars[0].id);
          }
        } else {
          await DB.saveCharacter(initialCharacter);
          setCharacters([initialCharacter]);
          setActiveCharacterId(initialCharacter.id);
        }

        setGroups(dbGroups);
        setWorldbooks(dbWorldbooks);
        setNovels(dbNovels);
        setSongs(dbSongs);
        setCustomThemes(dbThemes);
        if (dbUser) setUserProfile(dbUser);

      } catch (err) {
        console.error('Data init failed:', err);
      } finally {
        setIsDataLoaded(true);
      }
    };

    initData();
  }, []);

  // --- NEW: Apply Theme CSS Variables ---
  useEffect(() => {
      const root = document.documentElement;
      // Default fallback values match index.html
      const h = theme.hue ?? 248;
      const s = theme.saturation ?? 16;
      const l = theme.lightness ?? 36;
      
      root.style.setProperty('--primary-hue', String(h));
      root.style.setProperty('--primary-sat', `${s}%`);
      root.style.setProperty('--primary-lightness', `${l}%`);
  }, [theme]);

  // --- Update: Handle Scheduled Messages with Unread Flags & Web Notifications ---
  // Refs to avoid stale closures in the scheduled message interval
  const activeAppRef = useRef(activeApp);
  const activeCharIdScheduleRef = useRef(activeCharacterId);
  activeAppRef.current = activeApp;
  activeCharIdScheduleRef.current = activeCharacterId;

  useEffect(() => {
      if (!isDataLoaded || characters.length === 0) return;
      let cancelled = false;
      const checkAllSchedules = async () => {
          if (cancelled) return;
          let hasNewMessage = false;
          const unreadUpdates: Record<string, number> = {};

          for (const char of characters) {
              try {
                  const dueMessages = await DB.getDueScheduledMessages(char.id);
                  if (cancelled) return;
                  if (dueMessages.length > 0) {
                      for (const msg of dueMessages) {
                          await DB.saveMessage({
                               charId: msg.charId,
                               role: 'assistant',
                               type: 'text',
                               content: msg.content
                          });
                          await DB.deleteScheduledMessage(msg.id);
                      }
                      if (cancelled) return;
                      hasNewMessage = true;
                      // Use refs for latest state (avoids stale closure & unnecessary deps)
                      const isChattingWithThisChar = activeAppRef.current === AppID.Chat && activeCharIdScheduleRef.current === char.id;

                      // If not chatting specifically with this char right now, mark as unread
                      if (!isChattingWithThisChar) {
                          addToast(`${char.name} 发来了一条消息`, 'success');
                          unreadUpdates[char.id] = dueMessages.length;

                          // Web Notification
                          if (!Capacitor.isNativePlatform() && window.Notification && Notification.permission === 'granted') {
                              try {
                                  const notif = new Notification(char.name, {
                                      body: dueMessages[0].content,
                                      icon: char.avatar,
                                      silent: false
                                  });
                                  notif.onclick = () => {
                                      window.focus();
                                      setActiveApp(AppID.Chat);
                                      setActiveCharacterId(char.id);
                                  };
                              } catch (e) { /* notification failed */ }
                          }
                      }
                  }

                  // ── 解除拉黑申诉：被拉黑的角色到点主动发来「求解封」验证消息 ──
                  // 异步生成（不阻塞调度循环），每角色同一时刻只一条；生成后落库 + 标记
                  // awaiting（等用户在聊天页同意/拒绝）+ 计未读，复用主动消息那套通知。
                  if (isAppealDue(char) && !appealInFlightRef.current.has(char.id)) {
                      appealInFlightRef.current.add(char.id);
                      void (async () => {
                          try {
                              const api = resolveAuxApi(auxApiConfig, apiConfig);
                              const recent = await DB.getRecentMessagesByCharId(char.id, 30).catch(() => []);
                              const userName = userProfileRef.current?.name || '用户';
                              const recentContext = recent
                                  .filter(m => (m.role === 'user' || m.role === 'assistant') && (!m.type || m.type === 'text') && !m.metadata?.hidden && typeof m.content === 'string' && m.content.trim())
                                  .slice(-12)
                                  .map(m => `${m.role === 'user' ? userName : char.name}：${String(m.content).replace(/\s+/g, ' ').slice(0, 90)}`)
                                  .join('\n');
                              const text = await generateUnblockAppeal({ char, userProfile: userProfileRef.current, api, recentContext });
                              // 二次确认：生成期间用户可能已解封 / 已有待处理申诉
                              const fresh = charactersRef.current.find(c => c.id === char.id) || char;
                              if (!fresh.blacklisted || !fresh.unblockAppeal?.active || fresh.unblockAppeal?.awaiting) return;
                              const now = Date.now();
                              await DB.saveMessage({
                                  charId: char.id, role: 'assistant', type: 'text', content: text, timestamp: now,
                                  metadata: { unblockAppeal: { status: 'pending', rejectedCount: fresh.unblockAppeal.rejectedCount || 0 } },
                              });
                              await updateCharacter(char.id, { unblockAppeal: { ...fresh.unblockAppeal, awaiting: true } });
                              const chatting = activeAppRef.current === AppID.Chat && activeCharIdScheduleRef.current === char.id;
                              setLastMsgTimestamp(now);
                              if (!chatting) {
                                  incrementUnread(char.id);
                                  addToast(`${char.name} 申请解除拉黑`, 'info');
                              }
                          } catch { /* 生成失败下次再试 */ } finally {
                              appealInFlightRef.current.delete(char.id);
                          }
                      })();
                  }
              } catch (e) { /* schedule check failed */ }
          }
          if (hasNewMessage && !cancelled) {
              setLastMsgTimestamp(Date.now());
              // Use functional updater to avoid depending on unreadMessages in the effect deps
              setUnreadMessages(prev => {
                  const next = { ...prev };
                  for (const [charId, count] of Object.entries(unreadUpdates)) {
                      next[charId] = (next[charId] || 0) + count;
                  }
                  return next;
              });
          }
      };
      schedulerRef.current = setInterval(checkAllSchedules, 5000);
      checkAllSchedules();
      return () => { cancelled = true; if (schedulerRef.current) clearInterval(schedulerRef.current); };
  }, [isDataLoaded, characters]);

  const clearUnread = useCallback((charId: string) => {
      setUnreadMessages(prev => {
          if (!prev[charId]) return prev; // no change needed — avoid unnecessary re-render
          const next = { ...prev };
          delete next[charId];
          return next;
      });
  }, []);

  const markUnread = useCallback((charId: string, count: number = 1) => {
      const inc = normalizeUnreadIncrement(count);
      setUnreadMessages(prev => ({ ...prev, [charId]: Math.max(prev[charId] || 0, inc) }));
      setLastMsgTimestamp(Date.now());
  }, []);

  useEffect(() => {
      if (!isDataLoaded) return;

      const tickRelationshipNetwork = async () => {
          if (relationshipNetworkAutoRunningRef.current) return;
          relationshipNetworkAutoRunningRef.current = true;
          try {
              const now = Date.now();
              const storedSettings = await DB.getRelationshipNetworkAutoSettings();
              const settings = normalizeRelationshipNetworkSettings(storedSettings, now);
              if (!settings.enabled || settings.nextRunAt > now || settings.selectedCharIds.length === 0) return;
              const currentCharacters = charactersRef.current.filter(c => !c.blacklisted);
              if (currentCharacters.length < 2) return;
              const edges = await DB.getRelationshipNetworkEdges().catch(() => []);
              const targets = chooseAutoRelationshipTargets({
                  selectedCharIds: settings.selectedCharIds,
                  characters: currentCharacters,
                  edges,
                  settings,
                  now,
                  maxPairs: 2,
              });
              if (targets.length === 0) {
                  await DB.saveRelationshipNetworkAutoSettings({
                      ...settings,
                      nextRunAt: now + settings.intervalMinutes * 60_000,
                      updatedAt: now,
                  });
                  return;
              }

              const api = resolveAuxApi(auxApiConfigRef.current, apiConfigRef.current);
              const completed: Array<{ a: CharacterProfile; b: CharacterProfile; pairKey: string; forwarded?: boolean }> = [];
              let forwardedTotal = 0;
              for (const target of targets) {
                  const allMessages = await DB.getRelationshipNetworkMessagesByPair(target.pairKey).catch(() => []);
                  const compactedEdge = target.edge
                      ? await maybeSummarizeRelationshipMessages({
                          edge: target.edge,
                          messages: allMessages,
                          settings,
                          api,
                          names: [target.a.name, target.b.name],
                          now,
                      })
                      : target.edge;
                  if (compactedEdge && compactedEdge !== target.edge) await DB.saveRelationshipNetworkEdge(compactedEdge);
                  const recent = allMessages.slice(-settings.summaryKeepRaw);
                  const result = await generateCharPairInteraction({
                      a: target.a,
                      b: target.b,
                      edge: compactedEdge || target.edge,
                      recentMessages: recent,
                      api,
                      userProfile: userProfileRef.current,
                      source: 'auto',
                  });
                  if (result.messages.length === 0) continue;
                  await DB.saveRelationshipNetworkMessages(result.messages);
                  const merged = mergeRelationshipEdge(compactedEdge || target.edge, target.a, target.b, result.edgePatch, 'auto', now);
                  await DB.saveRelationshipNetworkEdge(merged);
                  let forwarded = false;
                  if (result.forward?.shouldForward && result.forward.forwarderId) {
                      const forwarder = result.forward.forwarderId === target.a.id ? target.a : target.b;
                      const other = forwarder.id === target.a.id ? target.b : target.a;
                      const excerpt = result.forward.excerptMessageIds?.length
                          ? result.messages.filter(m => result.forward?.excerptMessageIds?.includes(m.id))
                          : result.messages.slice(-Math.min(3, result.messages.length));
                      if (excerpt.length > 0) {
                          const card = buildRelationshipForwardCard({ forwarder, other, messages: excerpt, edge: merged, partial: true });
                          await DB.saveMessage({
                              charId: forwarder.id,
                              role: 'assistant',
                              type: 'chat_forward',
                              content: JSON.stringify(card),
                              metadata: {
                                  relationshipNetworkForward: true,
                                  pairKey: target.pairKey,
                                  forwardReason: result.forward.reason,
                              },
                          } as any);
                          markUnread(forwarder.id, 1);
                          forwarded = true;
                          forwardedTotal += 1;
                      }
                  }
                  completed.push({ a: target.a, b: target.b, pairKey: target.pairKey, forwarded });
              }

              if (completed.length > 0) {
                  await DB.saveRelationshipNetworkAutoSettings(markAutoRelationshipRun(settings, completed, now));
                  window.dispatchEvent(new Event(RELATIONSHIP_NETWORK_UPDATED_EVENT));
                  const pairCount = completed.length;
                  addToast(`关系网后台生成了 ${pairCount} 段互动${forwardedTotal ? `，${forwardedTotal} 段已转发` : ''}`, 'info');
              }
          } catch (err) {
              console.warn('[RelationshipNetwork] auto tick failed:', err);
          } finally {
              relationshipNetworkAutoRunningRef.current = false;
          }
      };

      const timer = window.setInterval(() => { void tickRelationshipNetwork(); }, 60_000);
      const visible = () => {
          if (document.visibilityState === 'visible') void tickRelationshipNetwork();
      };
      void tickRelationshipNetwork();
      document.addEventListener('visibilitychange', visible);
      return () => {
          window.clearInterval(timer);
          document.removeEventListener('visibilitychange', visible);
      };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDataLoaded, markUnread]);

  // Listen for proactive messages to show unread red dot
  useEffect(() => {
      let awayProactiveCount = 0;

      const handler = (e: Event) => {
          const { charId, charName, body, bodies, count, source, notificationData, skipSystemNotify } = (e as CustomEvent).detail as {
              charId: string;
              charName: string;
              body?: string;
              bodies?: string[];
              count?: number;
              source?: string;
              notificationData?: any;
              skipSystemNotify?: boolean;
          };
          // Only mark unread if user is NOT currently viewing this character's chat
          // Always bump timestamp so Chat reloads messages if currently open
          setLastMsgTimestamp(Date.now());
          const eventChar = charactersRef.current.find(c => c.id === charId);
          if (eventChar && !canCharContactUser(eventChar)) return;

          // 未读按本轮气泡条数累加（count 优先，退而数 bodies），每个消息气泡算一条
          const inc = normalizeUnreadIncrement(count ?? (Array.isArray(bodies) ? bodies.length : 1));
          const isChattingWithThisChar = activeAppRef.current === AppID.Chat && activeCharIdScheduleRef.current === charId;
          const isVisible = document.visibilityState === 'visible';
          // 「后台回复通知」（自律代理）：普通聊天发出后切后台，回复落定时若页面仍不可见，
          // 就算用户「停留」在该角色聊天页，也要把回复送进系统通知栏——这正是 task 的核心诉求。
          const allowBgReplyNotify = isBackgroundReplyNotifyEnabled();

          // 正盯着该角色聊天页（可见）→ 消息已实时呈现，什么都不做。
          // 在该聊天页但切了后台、又没开「后台回复通知」→ 维持旧行为，不打扰。
          if (isChattingWithThisChar && (isVisible || !allowBgReplyNotify) && source !== 'chat-alarm') return;

          const preview = (body || `${charName} sent a proactive message`).replace(/\s+/g, ' ').trim() || `${charName} sent a proactive message`;

          // 未读红点 / toast / 离开期间计数：仅当用户不在该角色聊天页时统计
          // （在该聊天页只是切了后台时，回前台会自动 reloadMessages 并标记已读，不重复累未读）。
          if (!isChattingWithThisChar) {
              if (isVisible) {
                  addToast(`${charName} 主动发来了消息`, 'success');
              } else {
                  awayProactiveCount += inc;
              }
              incrementUnread(charId, inc);
          }

          // 系统通知 / 原生通知：
          //  - 不在该聊天页：保持原有行为（permission 允许就发，桌面端即使可见也露出）。
          //  - 在该聊天页但页面已切后台 + 开了后台回复通知：把回复送进系统通知栏。
          if (!skipSystemNotify) {
              if (source === 'chat-alarm') {
                  void showLocalNotification(charName, {
                      body: preview,
                      tag: `chat-alarm-${notificationData?.alarmId || charId}`,
                      data: { ...(notificationData || {}), type: 'chat-alarm', charId },
                  });
              } else {
                  void sendProactiveNativeNotification(charId, charName, preview);
              }
          }

          // Web Notification —— 走 Service Worker 的 showNotification（和"测试推送"
          // 同一条链路）。页面级 `new Notification(...)` 在标签后台 / PWA / 移动端会
          // 静默失败，必须走 SW registration 才稳定。
          if (!skipSystemNotify && source !== 'chat-alarm' && !Capacitor.isNativePlatform() && 'serviceWorker' in navigator && window.Notification && Notification.permission === 'granted') {
              navigator.serviceWorker.ready.then(reg => {
                  reg.showNotification(charName, {
                      body: preview,
                      icon: eventChar?.avatar || './icons/icon-192.png',
                      badge: './icons/icon-192.png',
                      tag: `proactive-${charId}`,
                      data: { charId, kind: 'proactive-1.0' },
                  }).catch(() => { /* notification failed */ });
              }).catch(() => { /* SW not ready */ });
          }
      };

      const onVisible = () => {
          if (document.visibilityState !== 'visible') return;
          if (awayProactiveCount > 0) {
              addToast(`你离开期间收到 ${awayProactiveCount} 条消息`, 'success');
              awayProactiveCount = 0;
          }
      };

      window.addEventListener('proactive-message-sent', handler);
      document.addEventListener('visibilitychange', onVisible);
      return () => {
          window.removeEventListener('proactive-message-sent', handler);
          document.removeEventListener('visibilitychange', onVisible);
      };
  }, [characters, sendProactiveNativeNotification]);

  // ─── 拉黑系统：角色拉黑用户（[[BLOCK_USER]] 指令）+ 随机时间自动拉回 ───
  useEffect(() => {
      if (!isDataLoaded) return;

      const onCharBlock = async (e: Event) => {
          const charId = (e as CustomEvent).detail?.charId as string | undefined;
          if (!charId) return;
          const char = charactersRef.current.find(c => c.id === charId);
          if (!char || char.charBlock?.active) return;
          const now = Date.now();
          updateCharacter(charId, { charBlock: { active: true, blockedAt: now, unblockAt: now + randomUnblockDelayMs() } });
          try {
              await DB.saveMessage({ charId, role: 'system', type: 'text', content: `你已被「${char.name}」加入黑名单，暂时无法发送消息` });
          } catch { /* ignore */ }
          setLastMsgTimestamp(Date.now());
          addToast(`${char.name} 把你拉黑了…`, 'error');
      };

      // 到点自动解除（角色在随机时间把用户拉回）：启动立即对账一次 + 每 30s 一次
      const checkUnblock = async () => {
          const now = Date.now();
          for (const c of charactersRef.current) {
              if (c.charBlock?.active && now >= c.charBlock.unblockAt) {
                  updateCharacter(c.id, { charBlock: { ...c.charBlock, active: false } });
                  try {
                      await DB.saveMessage({ charId: c.id, role: 'system', type: 'text', content: `「${c.name}」已将你移出黑名单，可以继续聊天了` });
                  } catch { /* ignore */ }
                  setLastMsgTimestamp(Date.now());
                  const isChattingWithThisChar = activeAppRef.current === AppID.Chat && activeCharIdScheduleRef.current === c.id;
                  if (!isChattingWithThisChar) {
                      incrementUnread(c.id);
                  }
                  addToast(`${c.name} 把你移出了黑名单`, 'info');
              }
          }
      };

      window.addEventListener(CHAR_BLOCK_EVENT, onCharBlock);
      const unblockTimer = setInterval(() => { void checkUnblock(); }, 30_000);
      void checkUnblock();
      return () => {
          window.removeEventListener(CHAR_BLOCK_EVENT, onCharBlock);
          clearInterval(unblockTimer);
      };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDataLoaded]);

  // ─── 来往·关系系统 / 求婚 / 角色主动点外卖 / 婚事推进（聊天指令 → 落库） ───
  useEffect(() => {
      if (!isDataLoaded) return;
      const nameOf = (id: string) => charactersRef.current.find(c => c.id === id)?.name || '';
      const bumpUnread = (charId: string) => {
          setLastMsgTimestamp(Date.now());
          const chatting = activeAppRef.current === AppID.Chat && activeCharIdScheduleRef.current === charId;
          if (!chatting) incrementUnread(charId);
      };

      // 关系决定性变更（[[REL:stage|label]]：表白成功 / 分手 / 决裂…）
      const onRelationship = (e: Event) => {
          const d = (e as CustomEvent).detail as { charId: string; stage: string; label?: string; reason?: string } | undefined;
          if (!d?.charId || !isRelationshipStage(d.stage)) return;
          const char = charactersRef.current.find(c => c.id === d.charId);
          if (!char) return;
          const sane = sanitizeRelationshipUpdate(char.relationship, d.stage, d.label, char.affection, { decisive: true });
          if (!sane) return;
          updateCharacter(d.charId, { relationship: buildRelationshipState(char.relationship, sane.stage, sane.label, d.reason || '剧情变化') });
          addToast(`你和 ${char.name} 的关系变成了「${sane.label}」`, 'info');
      };

      // 角色主动求婚（[[PROPOSE:vow]]）→ 生成求婚小卡（assistant）
      const onPropose = async (e: Event) => {
          const d = (e as CustomEvent).detail as { charId: string; vow?: string } | undefined;
          if (!d?.charId) return;
          const char = charactersRef.current.find(c => c.id === d.charId);
          if (!char) return;
          if (char.marriage?.active) return;
          if ((char.affection ?? 0) < 100) return;             // 满好感才允许
          const vow = (d.vow || `愿意和我步入婚姻吗？`).slice(0, 200);
          try {
              await DB.saveMessage({ charId: d.charId, role: 'assistant', type: 'proposal_card', content: '[求婚]', metadata: { proposal: { from: 'char', vow, status: 'pending', at: Date.now() } } } as any);
              bumpUnread(d.charId);
              addToast(`${char.name} 向你求婚了…`, 'success');
          } catch { /* ignore */ }
      };

      // 角色主动为用户点外卖（[[TAKEOUT_ORDER:desc]]）—— 需会话开关打开
      const onCharTakeout = async (e: Event) => {
          const d = (e as CustomEvent).detail as { charId: string; desc?: string } | undefined;
          if (!d?.charId) return;
          const char = charactersRef.current.find(c => c.id === d.charId);
          if (!char || !char.convoSettings?.proactiveTakeoutOrder) return;
          const address = getDefaultTakeoutAddressLine();
          try {
              const order = synthesizeCharOrder(d.charId, d.desc || '', address);
              order.cardPosted = true;
              await DB.saveTakeoutOrder(order);
              await postTakeoutPlacedToChat(order, nameOf);
              notifyTakeoutUpdated();
              bumpUnread(d.charId);
              addToast(`${char.name} 悄悄给你撕了张饭票 🍱`, 'success');
          } catch { /* ignore */ }
      };

      // 婚事推进（[[WEDDING_PLAN:kind|date|note]]：商定婚期 / 领证 / 完婚）
      const onMarriagePlan = async (e: Event) => {
          const d = (e as CustomEvent).detail as { charId: string; kind?: string; date?: string; note?: string } | undefined;
          if (!d?.charId) return;
          const char = charactersRef.current.find(c => c.id === d.charId);
          if (!char?.marriage?.active) return;
          const kind = (['plan', 'register', 'wedding', 'custom'].includes(d.kind || '') ? d.kind : 'custom') as 'plan' | 'register' | 'wedding' | 'custom';
          const m = char.marriage;
          const milestone = {
              id: `mm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
              kind, title: d.note || (kind === 'plan' ? '商定婚期' : kind === 'register' ? '领证登记' : kind === 'wedding' ? '举行婚礼' : '婚事进展'),
              date: d.date, note: d.note, by: 'char' as const, done: kind === 'register' || kind === 'wedding', at: Date.now(),
          };
          const stage = kind === 'wedding' ? 'wed' : kind === 'register' ? 'registered' : kind === 'plan' ? 'planning' : m.stage;
          updateCharacter(d.charId, {
              marriage: {
                  ...m, stage,
                  weddingDate: kind === 'plan' && d.date ? d.date : m.weddingDate,
                  registeredAt: kind === 'register' ? Date.now() : m.registeredAt,
                  milestones: [...(m.milestones || []), milestone],
              },
          });
          if (d.date) {
              try { await DB.saveAnniversary({ id: `wedding-${d.charId}`, title: `和 ${char.name} 的婚期`, date: d.date, charId: d.charId } as any); } catch { /* ignore */ }
              try { await DB.saveCalendarMark({ id: `wed-${d.charId}-${Date.now().toString(36)}`, date: d.date, text: `💒 ${milestone.title}`, author: 'character', charId: d.charId, emoji: '💒', createdAt: Date.now() } as any); } catch { /* ignore */ }
          }
          addToast(`婚事有了新进展：${milestone.title}`, 'info');
      };

      window.addEventListener(RELATIONSHIP_EVENT, onRelationship);
      window.addEventListener(PROPOSAL_EVENT, onPropose as EventListener);
      window.addEventListener(TAKEOUT_ORDER_EVENT, onCharTakeout as EventListener);
      window.addEventListener(MARRIAGE_PLAN_EVENT, onMarriagePlan as EventListener);
      return () => {
          window.removeEventListener(RELATIONSHIP_EVENT, onRelationship);
          window.removeEventListener(PROPOSAL_EVENT, onPropose as EventListener);
          window.removeEventListener(TAKEOUT_ORDER_EVENT, onCharTakeout as EventListener);
          window.removeEventListener(MARRIAGE_PLAN_EVENT, onMarriagePlan as EventListener);
      };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDataLoaded]);

  // ─── 角色给用户换备注（[[SET_USER_REMARK]]）：落 convoSettings + 历史 + 系统消息 ───
  // 弹窗由 Chat.tsx 监听同一事件负责（点开看动机）；这里只做数据落库，确保用户不在该聊天页时也生效。
  useEffect(() => {
      if (!isDataLoaded) return;
      const onUserRemark = async (e: Event) => {
          const { charId, remark, motivation } = ((e as CustomEvent).detail || {}) as Partial<UserRemarkEventDetail>;
          if (!charId || !remark) return;
          const char = charactersRef.current.find(c => c.id === charId);
          if (!char) return;
          const cs = char.convoSettings || {};
          if (cs.userNickname === remark) return; // 没真变化就不重复落
          const entry = { remark, motivation, at: Date.now() };
          const history = [entry, ...(cs.userRemarkHistory || [])].slice(0, 20);
          updateCharacter(charId, {
              convoSettings: {
                  userNickname: remark,
                  userRemarkMotivation: motivation,
                  userRemarkUpdatedAt: entry.at,
                  userRemarkHistory: history,
              },
          });
          try {
              await DB.saveMessage({ charId, role: 'system', type: 'text', content: `「${char.name}」把对你的备注改成了「${remark}」` });
          } catch { /* ignore */ }
          setLastMsgTimestamp(Date.now());
      };
      // 拍一拍：角色用 [[PAT_SUFFIX: x]] 改自己的拍一拍后缀（默认「脑袋」）
      const onPatSuffix = (e: Event) => {
          const { charId, suffix } = ((e as CustomEvent).detail || {}) as { charId?: string; suffix?: string };
          if (!charId) return;
          if (!charactersRef.current.find(c => c.id === charId)) return;
          updateCharacter(charId, { patSuffix: (suffix || '').slice(0, 20) });
      };
      window.addEventListener(CHAR_USER_REMARK_EVENT, onUserRemark);
      window.addEventListener(CHAR_PAT_SUFFIX_EVENT, onPatSuffix);
      return () => {
          window.removeEventListener(CHAR_USER_REMARK_EVENT, onUserRemark);
          window.removeEventListener(CHAR_PAT_SUFFIX_EVENT, onPatSuffix);
      };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDataLoaded]);

  // ─── Global Proactive Message Handler ───
  // Registered at OS level so it works even when Chat is not open.
  useEffect(() => {
      let awayActiveMsgCount = 0;

      const handler = (e: Event) => {
          const { charId, charName, body, bodies, count } = (e as CustomEvent).detail as { charId: string; charName: string; body?: string; bodies?: string[]; count?: number };
          setLastMsgTimestamp(Date.now());

          // 消息真的到了 → 之前那条「发送失败 / Instant Push 报错」其实是双通道误报（SSE 断了
          // 但 push 晚到，见 docs/instant-push-dual-channel.md）。立刻撤掉该报错弹窗，别让它停驻。
          // （残留的自动消失计时器即便晚点再 fire 也只是又置一次 null，无副作用。）
          setErrorDialog(prev => (prev && /Instant Push|发送失败|发送错误/.test(prev.title)) ? null : prev);

          // 未读按本轮气泡条数累加（count 优先，退而数 bodies），每个消息气泡算一条
          const inc = normalizeUnreadIncrement(count ?? (Array.isArray(bodies) ? bodies.length : 1));
          const isChattingWithThisChar = activeAppRef.current === AppID.Chat && activeCharIdScheduleRef.current === charId;
          if (!isChattingWithThisChar) {
              const isVisible = document.visibilityState === 'visible';
              if (isVisible) {
                  addToast(`${charName} 给你发了消息`, 'success');
              } else {
                  awayActiveMsgCount += inc;
              }
              incrementUnread(charId, inc);
              const preview = (body || `${charName} sent an active message`).replace(/\s+/g, ' ').trim() || `${charName} sent an active message`;
              void sendProactiveNativeNotification(charId, charName, preview);
              // SW push handler 已经 fire 过系统通知（不在前台时露出真实内容、在前台时
              // silent + close 静默），这里不再补一次，避免重复弹窗。
          }
      };

      const openHandler = (e: Event) => {
          const { charId } = (e as CustomEvent).detail as { charId?: string };
          if (!charId) return;
          setActiveApp(AppID.Chat);
          setActiveCharacterId(charId);
      };

      const healthReminderOpenHandler = (e: Event) => {
          const { charId } = (e as CustomEvent).detail as { charId?: string; settingsId?: string; reminderId?: string };
          if (charId) setActiveCharacterId(charId);
          setActiveApp(AppID.Health);
      };

      const onVisible = () => {
          if (document.visibilityState !== 'visible') return;
          if (awayActiveMsgCount > 0) {
              addToast(`你离开期间收到 ${awayActiveMsgCount} 条新消息`, 'success');
              awayActiveMsgCount = 0;
          }
      };

      // Phase 1: per-chunk UI refresh side-channel. push 路径下的 applyAssistantPostProcessing
      // 会逐条 saveMessage + fire 'active-msg-progress'; 这里只推 lastMsgTimestamp 让
      // Chat.tsx 的 useEffect 重新 reloadMessages, 不弹 toast / 不增加未读 / 不 resolve
      // sendInstantPush 那条 one-shot promise (那些只在 'active-msg-received' 触发一次)。
      const progressHandler = () => {
          setLastMsgTimestamp(Date.now());
      };

      // 情绪 buff 落地后同步进内存 characters —— 必须是 App 级、不限当前打开的角色:
      // instant 模式下 worker 推回 emotion_update 时用户常不在该角色聊天页 (在别的角色 /
      // 列表 / 后台 / 还没点进去). 之前只有 Chat.tsx 里那个 `charId === activeCharacterId`
      // 守卫的 handler 同步内存, 不匹配就直接 return —— buff 只落了 DB, 内存没更新; 而
      // OSContext 只在启动时 getAllCharacters, 切回该角色也不重读 DB, 于是 buff "回不到前端".
      // 更糟: 之后任一 updateCharacter 会拿旧内存合并写回 DB, 把后台刚生成的 buff 抹掉.
      // 这里无条件按事件 charId 更新内存 (DB 已由 applyEmotionEvalRaw 写好), 顺带堵住反向覆盖.
      const buffSyncHandler = (e: Event) => {
          const detail = (e as CustomEvent).detail as { charId?: string; buffs?: unknown; buffInjection?: unknown };
          const charId = detail?.charId;
          if (!charId) return;
          if (Array.isArray(detail.buffs)) {
              const nextBuffs = detail.buffs as CharacterProfile['activeBuffs'];
              const nextInjection = typeof detail.buffInjection === 'string' ? detail.buffInjection : '';
              setCharacters(prev => prev.map(c => c.id === charId
                  ? normalizeCharacterDefaults({ ...c, activeBuffs: nextBuffs, buffInjection: nextInjection })
                  : c));
              return;
          }
          // 无 buffs 的纯刷新信号 (runPushTailPipeline 等): 从 DB 兜底重读该角色 buff.
          DB.getAllCharacters().then(all => {
              const updated = all.find(c => c.id === charId);
              if (!updated) return;
              setCharacters(prev => prev.map(c => c.id === charId
                  ? normalizeCharacterDefaults({ ...c, activeBuffs: updated.activeBuffs, buffInjection: updated.buffInjection })
                  : c));
          }).catch(() => {});
      };

      window.addEventListener('active-msg-received', handler);
      window.addEventListener('active-msg-progress', progressHandler);
      window.addEventListener('active-msg-open', openHandler);
      window.addEventListener('period-reminder-open', healthReminderOpenHandler);
      window.addEventListener('health-reminder-open', healthReminderOpenHandler);
      window.addEventListener('emotion-updated', buffSyncHandler);
      document.addEventListener('visibilitychange', onVisible);
      return () => {
          window.removeEventListener('active-msg-received', handler);
          window.removeEventListener('active-msg-progress', progressHandler);
          window.removeEventListener('active-msg-open', openHandler);
          window.removeEventListener('period-reminder-open', healthReminderOpenHandler);
          window.removeEventListener('health-reminder-open', healthReminderOpenHandler);
          window.removeEventListener('emotion-updated', buffSyncHandler);
          document.removeEventListener('visibilitychange', onVisible);
      };
  }, [sendProactiveNativeNotification]);

  const proactiveRunningRef = useRef(false);
  type ProactiveRunOptions = {
      customHint?: string;
      eventSource?: string;
      notificationData?: any;
      skipSystemNotify?: boolean;
      scheduledAt?: number;
      offlineReplay?: boolean;
      replayIndex?: number;
      replayTotal?: number;
      missedCount?: number;
  };
  const proactiveQueueRef = useRef<Array<{ charId: string; opts?: ProactiveRunOptions }>>([]);
  // Per-character innerState cache for proactive turns — mirrors useChatAI's
  // evolvedNarrative state so consecutive proactive triggers carry continuity.
  const proactiveInnerStateRef = useRef<Map<string, string>>(new Map());

  // Refs to avoid stale closures in proactive callback
  const apiConfigRef = useRef(apiConfig);
  apiConfigRef.current = apiConfig;
  const auxApiConfigRef = useRef(auxApiConfig);
  auxApiConfigRef.current = auxApiConfig;

  // Keep the MiniMax endpoint module in sync with the user's region choice
  // so every minimaxFetch() call reads the latest preference.
  useEffect(() => {
    setMinimaxRegion(apiConfig.minimaxRegion);
  }, [apiConfig.minimaxRegion]);
  const userProfileRef = useRef(userProfile);
  userProfileRef.current = userProfile;
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const realtimeConfigRef = useRef(realtimeConfig);
  realtimeConfigRef.current = realtimeConfig;
  const memoryPalaceConfigRef = useRef(memoryPalaceConfig);
  memoryPalaceConfigRef.current = memoryPalaceConfig;
  const forceReplyRequestRef = useRef(forceReplyRequest);
  forceReplyRequestRef.current = forceReplyRequest;

  const persistForceReplyRequest = useCallback((next: ForceReplyRequest | null) => {
      setForceReplyRequestState(next);
      try {
          if (next) localStorage.setItem(FORCE_REPLY_STORAGE_KEY, JSON.stringify(next));
          else localStorage.removeItem(FORCE_REPLY_STORAGE_KEY);
      } catch {
          // localStorage failures should not block chat.
      }
  }, []);

  const clearForceReplyRequest = useCallback((charId?: string) => {
      const current = forceReplyRequestRef.current;
      if (charId && current?.charId !== charId) return;
      persistForceReplyRequest(null);
  }, [persistForceReplyRequest]);

  const openForceReplyRequest = useCallback(() => {
      const current = forceReplyRequestRef.current;
      if (!current?.charId) return;
      setIsLocked(false);
      setActiveCharacterId(current.charId);
      setActiveApp(AppID.Chat);
  }, []);

  useEffect(() => {
      if (!isDataLoaded) return;

      const handler = (e: Event) => {
          const detail = (e as CustomEvent<ForceReplyEventDetail>).detail;
          const charId = detail?.charId;
          if (!charId) return;
          const char = charactersRef.current.find(c => c.id === charId);
          if (!char || !char.convoSettings?.forceReplyEnabled || !canCharContactUser(char)) return;
          if (shouldHideAmbientSocialRecordForUser(userProfileRef.current) && isAmbientSocialCharacterForUser(char, userProfileRef.current)) return;

          const next: ForceReplyRequest = {
              charId,
              charName: char.convoSettings?.remarkName?.trim() || char.name,
              avatar: char.convoSettings?.charAvatarOverride || char.avatar,
              reason: detail.reason?.trim() || undefined,
              body: detail.body?.trim() || undefined,
              messageId: detail.messageId,
              source: detail.source,
              requestedAt: detail.requestedAt || Date.now(),
          };
          persistForceReplyRequest(next);
      };

      window.addEventListener(FORCE_REPLY_EVENT, handler);
      return () => window.removeEventListener(FORCE_REPLY_EVENT, handler);
  }, [isDataLoaded, persistForceReplyRequest]);

  useEffect(() => {
      const current = forceReplyRequestRef.current;
      if (!current) return;
      const char = characters.find(c => c.id === current.charId);
      if (!char || !char.convoSettings?.forceReplyEnabled || !canCharContactUser(char)) {
          persistForceReplyRequest(null);
      }
  }, [characters, persistForceReplyRequest]);

  useEffect(() => {
      if (!isDataLoaded) return;
      const run = (trigger: string, charIds?: string[]) => {
          void maybeRunMomentsAutoPost({
              characters: charactersRef.current,
              userProfile: userProfileRef.current,
              apiConfig: apiConfigRef.current,
              auxApiConfig: auxApiConfigRef.current,
              trigger,
              charIds,
          });
      };
      const onVisible = () => {
          if (document.visibilityState === 'visible') run('focus');
      };
      const onProactive = (e: Event) => {
          const charId = (e as CustomEvent).detail?.charId as string | undefined;
          run('proactive-message-sent', charId ? [charId] : undefined);
      };
      const onCatchup = (e: Event) => {
          const detail = (e as CustomEvent).detail || {};
          const charIds = Array.isArray(detail.events)
              ? Array.from(new Set(detail.events.map((ev: CharLifeEvent) => ev.charId).filter(Boolean)))
              : (detail.charId ? [detail.charId] : undefined);
          run('autonomous-life-catchup', charIds as string[] | undefined);
      };
      run('startup');
      document.addEventListener('visibilitychange', onVisible);
      window.addEventListener('focus', onVisible);
      window.addEventListener('proactive-message-sent', onProactive);
      window.addEventListener('autonomous-life-catchup', onCatchup);
      return () => {
          document.removeEventListener('visibilitychange', onVisible);
          window.removeEventListener('focus', onVisible);
          window.removeEventListener('proactive-message-sent', onProactive);
          window.removeEventListener('autonomous-life-catchup', onCatchup);
      };
  }, [isDataLoaded]);

  useEffect(() => {
      if (!isDataLoaded) return;

      const drainQueuedProactive = () => {
          const nextQueued = proactiveQueueRef.current.shift();
          if (nextQueued) {
              void runProactive(nextQueued.charId, nextQueued.opts);
          }
      };

      const runCoupleAutoCareForSource = async (charId: string, source: CoupleAutoCareSource) => {
          const fresh = charactersRef.current.find(c => c.id === charId);
          if (!fresh?.coupleSpace || fresh.charBlock?.active) return;
          const now = source.at || Date.now();
          const space = ensureCoupleSpace(fresh);
          const decision = shouldRunCoupleAutoCare(space, now);
          if (!decision.shouldRun) return;
          const api = resolveAuxApi(auxApiConfigRef.current, apiConfigRef.current);
          if (!api.baseUrl) return;
          try {
              const draft = await generateCharCoupleAutoCare({
                  char: fresh,
                  userName: userProfileRef.current?.name || '对方',
                  api,
                  space,
                  source,
                  allowRecap: decision.allowRecap,
              });
              const latest = charactersRef.current.find(c => c.id === charId);
              if (!latest?.coupleSpace) return;
              const applied = applyCoupleAutoCareDraft(ensureCoupleSpace(latest), draft, source, Date.now());
              if (applied.applied === 'none' && !draft) return;
              await updateCharacter(charId, { coupleSpace: applied.space });
          } catch (e) {
              console.warn('[CoupleSpace/AutoCare] skipped:', e);
          }
      };

      const runProactive = async (charId: string, opts?: ProactiveRunOptions) => {
          const customHint = opts?.customHint;
          const scheduledAt = typeof opts?.scheduledAt === 'number' && Number.isFinite(opts.scheduledAt) ? opts.scheduledAt : undefined;
          const runNowMs = scheduledAt ?? Date.now();
          const offlineReplay = !!opts?.offlineReplay;
          if (proactiveRunningRef.current) {
              if (customHint || offlineReplay || scheduledAt !== undefined || !proactiveQueueRef.current.some(item => item.charId === charId && !item.opts?.customHint)) {
                  proactiveQueueRef.current.push({ charId, opts });
              }
              return;
          }

          // Read from refs to always get latest values
          const currentCharacters = charactersRef.current;
          const currentApiConfig = apiConfigRef.current;
          const currentUserProfile = userProfileRef.current;
          const currentGroups = groupsRef.current;
          const currentRealtimeConfig = realtimeConfigRef.current;

          const char = currentCharacters.find(c => c.id === charId);
          if (!char) {
              drainQueuedProactive();
              return;
          }
          if (shouldHideAmbientSocialRecordForUser(currentUserProfile) && isAmbientSocialCharacterForUser(char, currentUserProfile)) {
              drainQueuedProactive();
              console.log(`🔕 [Proactive/Global] Skipped for ${char.name}: ambient social hidden/disabled`);
              return;
          }

          // 线下模式还没结束时，当前角色已经在面对面现场里；不要同时从线上私聊冒出主动消息。
          if (isOfflineSessionActive(charId)) {
              drainQueuedProactive();
              console.log(`🔕 [Proactive/Global] Skipped for ${char.name}: offline session active`);
              return;
          }

          // Respect per-character proactive config（事件驱动的反应 customHint 不受主动消息开关限制）
          if (!customHint && char.proactiveConfig && !char.proactiveConfig.enabled) {
              drainQueuedProactive();
              console.log(`🔕 [Proactive/Global] Skipped for ${char.name}: disabled`);
              return;
          }

          // 角色拉黑用户期间不主动发消息（是 TA 自己拒绝联系）
          if (char.charBlock?.active) {
              drainQueuedProactive();
              console.log(`🔕 [Proactive/Global] Skipped for ${char.name}: char blocked user`);
              return;
          }

          // 用户拉黑角色期间：角色仍可在本地过自己的生活，但不能主动消息、未读或通知打扰用户。
          if (char.blacklisted) {
              if (!customHint && isAutonomousLifeEnabled(char)) {
                  const lifeApi = resolveLifeApi(char, auxApiConfigRef.current, currentApiConfig);
                  if (lifeApi.baseUrl) {
                      try {
                          const recentMsgs = await DB.getRecentMessagesByCharId(charId, 40);
                          const userName = currentUserProfile?.name || '对方';
                          const recentChat = recentMsgs
                              .filter(m => (m.role === 'user' || m.role === 'assistant') && (!m.type || m.type === 'text') && !m.metadata?.proactiveHint && typeof m.content === 'string' && m.content.trim())
                              .slice(-6)
                              .map(m => `${m.role === 'user' ? userName : char.name}：${String(m.content).replace(/\s+/g, ' ').slice(0, 60)}`)
                              .join('\n');
                          const ev = await advanceLife(char, lifeApi, { source: 'proactive', triggerSource: offlineReplay ? 'offline_replay' : 'proactive', recentChat, now: runNowMs });
                          if (ev) window.dispatchEvent(new CustomEvent('autonomous-life-advanced', { detail: { charId: char.id, charName: char.name, blocked: true } }));
                      } catch (e) {
                          console.warn('[Proactive/Global] blocked life-only advance skipped:', e);
                      }
                  }
              }
              drainQueuedProactive();
              console.log(`🔕 [Proactive/Global] Skipped for ${char.name}: user blacklisted char`);
              return;
          }

          // Determine which API to use
          const pCfg = char.proactiveConfig;
          const useSecondary = pCfg?.useSecondaryApi && pCfg.secondaryApi?.baseUrl;
          const api = useSecondary ? pCfg!.secondaryApi! : currentApiConfig;
          if (!api.baseUrl) {
              drainQueuedProactive();
              return;
          }

          proactiveRunningRef.current = true;
          setProactiveComposingChars(prev => prev[charId] ? prev : { ...prev, [charId]: true });
          console.log(`🔔 [Proactive/Global] Trigger fired for ${char.name}${useSecondary ? ' (副API)' : ''}`);

          try {
              // 1. Calculate time gap
              const recentMsgs = await DB.getRecentMessagesByCharId(charId, 200);
              const userName = currentUserProfile?.name || '对方';
              const pendingReplyMessages = !customHint ? findPendingProactiveReplyMessages(recentMsgs) : [];
              const pendingReplyIds = pendingReplyMessages.map(m => m.id);
              const pendingReplyTo = makeQueuedReplyTarget(pendingReplyMessages[0], userName);
              const hasPendingProactiveReply = pendingReplyMessages.length > 0;
              const lastRealUserMsg = [...recentMsgs].reverse().find(
                  m => m.role === 'user' && !m.metadata?.proactiveHint
              );

              const now = new Date(runNowMs);
              const timeStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

              let timeSinceUser = '';
              // 距上次 ≥2 小时才算「挺久没找你了」（可表达想念/抱怨）。注意不能对带单位的
              // timeSinceUser 字符串做 parseInt——"30分钟"→30、"2天5小时"→2 都会误判，
              // 必须用真实分钟数判断。
              let userGapLong = false;
              if (lastRealUserMsg) {
                  const gapMin = Math.floor((runNowMs - lastRealUserMsg.timestamp) / 60000);
                  userGapLong = gapMin >= 120;
                  if (gapMin < 60) timeSinceUser = `${gapMin}分钟`;
                  else if (gapMin < 1440) timeSinceUser = `${Math.floor(gapMin / 60)}小时${gapMin % 60 > 0 ? gapMin % 60 + '分钟' : ''}`;
                  else timeSinceUser = `${Math.floor(gapMin / 1440)}天${Math.floor((gapMin % 1440) / 60)}小时`;
              }

              // 随机时间模式：以「用户超过一段时间没回复」为前提——最近 1 小时内回过
              // 消息就这轮不打扰，等下一个随机间隔再说（finally 会正常释放运行锁）。
              // 事件驱动的反应（customHint）是对具体事件的即时回应，不受此限。
              if (!customHint && !hasPendingProactiveReply && pCfg?.randomMode && lastRealUserMsg && runNowMs - lastRealUserMsg.timestamp < 60 * 60 * 1000) {
                  console.log(`🔕 [Proactive/Global] Random mode: ${char.name} skipped (user replied recently)`);
                  return;
              }

              // 2. Save hidden system hint
              // 主动语音通话：开关打开时允许角色用 [[CALL_USER]] 指令直接拨电话（按人设自行决定）
              const proactiveCallAllowed = !!char.convoSettings?.proactiveCallEnabled;
              const forceReplyAllowed = !!char.convoSettings?.forceReplyEnabled;

              // 离线自主生活：先让角色的生活往前走一格，主动消息就从 TA 此刻正在经历的事
              // 取材——分享自己的生活，而不是反复催用户回复（不每天围着用户转）。
              // 生成失败 / 未开启时回退到旧的「主动找用户」hint。
              let lifeEvent: CharLifeEvent | null = null;
              if (!customHint && isAutonomousLifeEnabled(char)) {
                  // 「线下」生活生成默认走副 API（与「线上」聊天分线）：
                  // per-char 副 API > 全局副 API（文具盒）> 主 API。
                  const lifeApi = resolveLifeApi(char, auxApiConfigRef.current, currentApiConfig);
                  // 线上→线下：把最近几句对话给生活 agent 一眼，让 TA「此刻的生活」能呼应这段关系，
                  // 而不是凭空过日子（与「线下→线上」注入合起来，线上线下双向关联）。
                  const recentChat = recentMsgs
                      .filter(m => (m.role === 'user' || m.role === 'assistant') && (!m.type || m.type === 'text') && !m.metadata?.proactiveHint && typeof m.content === 'string' && m.content.trim())
                      .slice(-6)
                      .map(m => `${m.role === 'user' ? userName : char.name}：${String(m.content).replace(/\s+/g, ' ').slice(0, 60)}`)
                      .join('\n');
                  const lifePlan = await planAutonomousProactiveTurn(char, lifeApi, {
                      recentChat,
                      randomMode: pCfg?.randomMode,
                      now: runNowMs,
                  });
                  lifeEvent = lifePlan.event;
                  if (lifePlan.decision !== 'send' && !hasPendingProactiveReply) {
                      console.log(`🌱 [Proactive/Global] ${char.name} v2 ${lifePlan.decision}: ${lifePlan.reason} (score=${lifePlan.score})`);
                      return;
                  }
              }

              const pendingLifeContext = lifeEvent
                  ? [
                      lifeEvent.activity || lifeEvent.summary,
                      lifeEvent.location ? `在${lifeEvent.location}` : '',
                      lifeEvent.mood ? `心情：${lifeEvent.mood}` : '',
                      lifeEvent.thread ? `线索：${lifeEvent.thread}` : '',
                    ].filter(Boolean).join('；')
                  : '';
              const hintContent = customHint
                  ? customHint
                  : hasPendingProactiveReply
                  ? proactivePendingReplyHint({
                      userName,
                      timeStr,
                      messages: pendingReplyMessages,
                      lifeContext: pendingLifeContext,
                      randomMode: pCfg?.randomMode,
                      proactiveCallAllowed,
                      forceReplyAllowed,
                    })
                  : lifeEvent
                  ? buildAutonomousProactiveHint({ char, userName, timeStr, timeSinceUser, event: lifeEvent, randomMode: pCfg?.randomMode, proactiveCallAllowed, forceReplyAllowed })
                  : proactiveFallbackHint({ userName, timeStr, timeSinceUser, longGap: userGapLong, randomMode: pCfg?.randomMode, proactiveCallAllowed, forceReplyAllowed });

              const proactiveDeliveryMeta = {
                  ...(scheduledAt !== undefined ? { proactiveScheduledAt: scheduledAt } : {}),
                  ...(offlineReplay ? {
                      proactiveOfflineReplay: true,
                      proactiveGeneratedAt: Date.now(),
                      proactiveReplayIndex: opts?.replayIndex,
                      proactiveReplayTotal: opts?.replayTotal,
                      proactiveMissedCount: opts?.missedCount,
                  } : {}),
              };
              const withProactiveDeliveryMeta = (meta?: Record<string, any>): Record<string, any> | undefined => {
                  const base = Object.fromEntries(Object.entries(proactiveDeliveryMeta).filter(([, v]) => v !== undefined));
                  if (!Object.keys(base).length) return meta;
                  return { ...(meta || {}), ...base, ...(offlineReplay ? { source: 'proactive_offline_replay' } : {}) };
              };
              const assistantMetadataPatch = (meta?: Record<string, any>) => {
                  const metadata = withProactiveDeliveryMeta(meta);
                  return metadata ? { metadata } : {};
              };

              await DB.saveMessage({
                  charId,
                  role: 'user',
                  type: 'text',
                  content: hintContent,
                  ...(scheduledAt !== undefined ? { timestamp: scheduledAt } : {}),
                  metadata: {
                      proactiveHint: true,
                      hidden: true,
                      ...(pendingReplyIds.length ? { pendingProactiveReplyIds: pendingReplyIds } : {}),
                      ...(withProactiveDeliveryMeta() || {}),
                  }
              });
              // 3. Build prompt & message history — 走和 useChatAI / emotion eval 同一个 helper，
              //    保证三家拿到的"材料"完全一致；区别只在前面追加的"现在主动找用户"那条 hint。
              const allMsgs = await DB.getRecentMessagesByCharId(charId, char.contextLimit || 500);
              const emojis = await DB.getEmojis();
              const categories = await DB.getEmojiCategories();

              // 上一轮缓存的意识流独白 —— 主路径用 React state，主动消息这里用 ref Map
              const emotionBuffOn = isEmotionBuffFeatureOn(char);
              if (!emotionBuffOn) proactiveInnerStateRef.current.delete(charId);
              const cachedInnerState = emotionBuffOn ? (proactiveInnerStateRef.current.get(charId) || undefined) : undefined;

              const payload = await buildChatRequestPayload({
                  char, userProfile: currentUserProfile!, groups: currentGroups,
                  emojis, categories,
                  historyMsgs: allMsgs,
                  contextLimit: char.contextLimit || 500,
                  realtimeConfig: currentRealtimeConfig,
                  innerState: cachedInnerState,
                  // 实时音乐播放状态 —— OSContext 在 MusicProvider 上层用不了 useMusic()，
                  // 走 MusicContext 暴露的模块级快照（Provider mount 后会持续写入）
                  musicSnapshot: loadMusicPlaybackSnapshot(),
                  // translationConfig / mcdMiniSnap 是 chat-app 会话级 UI 状态，主动消息触发时
                  // 不存在；保持 undefined 即可，与"用户当时根本没在 chat 界面"的语义一致
                  htmlMode: { enabled: (char as any).htmlModeEnabled !== false, customPrompt: (char as any).htmlModeCustomPrompt },
                  thinkingChain: { enabled: !!(char as any).showThinkingChain, customPrompt: (char as any).thinkingChainCustomPrompt },
                  presetScope: 'chat.proactive',
              });
              const systemPrompt = payload.systemPrompt;
              const apiMessages = payload.cleanedApiMessages;
              const fullMessages = payload.fullMessages;

              // 3c. 情绪评估 fire-and-forget — 与主 API 并行，沿用 useChatAI 的 API 选择逻辑：
              //     心情 API > 主 apiConfig（与文具盒副 API / 回忆标本馆副 API 独立）
              if (!payload.flags.promptBuildSkipped && !isEmotionEvalSkipped() && emotionBuffOn) {
                  const emotionApi = resolveMoodApi(char, apiConfigRef.current);
                  if (emotionApi.baseUrl && currentUserProfile) {
                      evaluateEmotionBackground(char, currentUserProfile, systemPrompt, apiMessages, emotionApi)
                          .then((innerState) => {
                              if (innerState) proactiveInnerStateRef.current.set(charId, innerState);
                          })
                          .catch(() => {});
                  }
              }

              // 4. API call
              const presetGenParams = await PresetRuntime.getActiveGenParams('chat.proactive');
              const reqBody: any = {
                  model: api.model,
                  messages: fullMessages,
                  temperature: presetGenParams?.temperature ?? 0.85,
                  max_tokens: presetGenParams?.max_tokens,
                  stream: false,
              };
              if (presetGenParams) {
                  const { temperature: _t, max_tokens: _m, ...rest } = presetGenParams;
                  Object.assign(reqBody, rest);
              }
              if (reqBody.max_tokens === undefined) delete reqBody.max_tokens;
              // 思考链开启时显式向后端请求 extended thinking — 与 useChatAI 同步,
              // 不同代理认不同入口,全都试一遍,代理不识别的会自动忽略
              if (payload.flags.thinkingActive) {
                  const m: string = reqBody.model || '';
                  if (/^claude-/i.test(m) && !/-thinking$/i.test(m)) {
                      reqBody.model = `${m}-thinking`;
                  }
                  reqBody.thinking = { type: 'enabled', budget_tokens: 4000 };
                  reqBody.reasoning_effort = 'medium';
                  reqBody.extra_body = { ...(reqBody.extra_body || {}), thinking: { type: 'enabled', budget_tokens: 4000 } };
              }
              const data = await callChatCompletion(api, reqBody, {
                meta: makeApiUsageMeta('chat.proactiveReply', {
                  charId,
                  charName: char.name,
                  apiRole: 'main',
                }),
                timeoutMs: PROACTIVE_CHAT_REPLY_TIMEOUT_MS,
                maxRetries: 0,
                presetScope: false,
              });

              // 5. Process & save response
              let aiContent = flattenContent(data.choices?.[0]?.message?.content);
              // 思考链抽取 — 与 useChatAI 保持一致:reasoning_content 字段 + 主 content 里的 <think>/<thinking>/<thought> 块,
              // 拼接后挂到本回合首条 assistant 消息的 metadata.thinkingChain
              let pendingThinkingChain: string | null = payload.flags.thinkingActive
                  ? extractThinkingChainFromCompletion(data)
                  : null;
              aiContent = stripThinkBlocks(aiContent);
              aiContent = aiContent.replace(/\[\d{4}[-/年]\d{1,2}[-/月]\d{1,2}.*?\]/g, '');
              aiContent = aiContent.replace(/^[\w一-龥]+:\s*/, '');
              aiContent = aiContent.replace(/\s*\[(?:聊天|通话|约会)\]\s*/g, '\n').trim();

              aiContent = normalizeProactiveAiContent(aiContent);

              // [[CALL_USER]] 指令：主动语音通话开启时，角色可决定直接给用户拨电话
              let charWantsCall = false;
              const callExtract = extractCallUserDirective(aiContent);
              if (callExtract.wantsCall) {
                  aiContent = callExtract.content;
                  if (proactiveCallAllowed) charWantsCall = true;
              }

              // [[BLOCK_USER]] 指令：主动消息路径也可能触发（如被拉黑后赌气拉回去）
              const blockExtract = extractBlockUserDirective(aiContent);
              if (blockExtract.blocked) {
                  aiContent = blockExtract.content;
                  if (!isCharBlockDisabled() && !char.charBlock?.active) {
                      window.dispatchEvent(new CustomEvent(CHAR_BLOCK_EVENT, { detail: { charId } }));
                  }
              }

              let pendingForceReplyReason: string | undefined;
              const forceReplyExtract = extractForceReplyDirective(aiContent);
              if (forceReplyExtract.forceReply) {
                  aiContent = forceReplyExtract.content;
                  if (forceReplyAllowed) pendingForceReplyReason = forceReplyExtract.reason;
              }

              const savedPreviewChunks: string[] = [];
              const baseTimestamp = scheduledAt ?? Date.now();
              let offset = 0;
              let pendingReplyToConsumed = false;
              const consumePendingReplyTo = () => {
                  if (!pendingReplyTo || pendingReplyToConsumed) return undefined;
                  pendingReplyToConsumed = true;
                  return pendingReplyTo;
              };
              // 思考链只挂到本回合首条 assistant 消息上,避免每个气泡重复
              const consumeThinkingMeta = (): { thinkingChain: string } | undefined => {
                  if (!pendingThinkingChain) return undefined;
                  const meta = { thinkingChain: pendingThinkingChain };
                  pendingThinkingChain = null;
                  return meta;
              };

              // HTML 卡片：在 sanitize 之前抽出 [html]...[/html] 块,与 useChatAI 保持一致。
              // 没这一步主动消息会把整段 [html] 当纯文本落库,前端只能渲染成乱码。
              if ((char as any).htmlModeEnabled !== false && /\[html\]/i.test(aiContent)) {
                  const { blocks, cleanedContent } = extractHtmlBlocks(aiContent);
                  for (const blk of blocks) {
                      try {
                          const meta = consumeThinkingMeta();
                          const textPreview = sanitizeAssistantVisibleText(blk.textPreview);
                          await DB.saveMessage({
                              charId,
                              role: 'assistant',
                              type: 'html_card',
                              content: textPreview ? `[HTML卡片] ${textPreview}` : '[HTML卡片]',
                              replyTo: consumePendingReplyTo(),
                              timestamp: baseTimestamp + offset,
                              metadata: withProactiveDeliveryMeta({
                                  htmlSource: blk.html,
                                  htmlTextPreview: textPreview,
                                  ...(meta || {}),
                              }),
                          } as any);
                          if (textPreview) savedPreviewChunks.push(textPreview);
                          offset += 1;
                      } catch (e) {
                          console.error('[Proactive/HTML] 落库 html_card 失败', e);
                      }
                  }
                  aiContent = cleanedContent;
              }

              aiContent = ChatParser.sanitize(aiContent);

              if (aiContent) {
                  // 双语翻译:沿用 useChatAI 的 <翻译><原文>..</原文><译文>..</译文></翻译> 协议,
                  // 把每对原文/译文落成一条 text 消息,内容用 `\n%%BILINGUAL%%\n` 串联供渲染端识别。
                  const hasTranslationTags = /<翻译>\s*<原文>[\s\S]*?<\/原文>\s*<译文>[\s\S]*?<\/译文>\s*<\/翻译>/.test(aiContent);

                  if (hasTranslationTags) {
                      // 表情独立抽出,放在文本之后发送
                      const bilingualEmojis: string[] = [];
                      let bEm;
                      const bEmojiPat = /\[\[SEND_EMOJI:\s*(.*?)\]\]/g;
                      while ((bEm = bEmojiPat.exec(aiContent)) !== null) {
                          const name = bEm[1].trim();
                          if (!bilingualEmojis.includes(name)) bilingualEmojis.push(name);
                      }
                      aiContent = aiContent.replace(/\[\[SEND_EMOJI:\s*.*?\]\]/g, '').trim();

                      const tagPattern = /<翻译>\s*<原文>([\s\S]*?)<\/原文>\s*<译文>([\s\S]*?)<\/译文>\s*<\/翻译>/g;
                      let lastIndex = 0;
                      let tagMatch;
                      while ((tagMatch = tagPattern.exec(aiContent)) !== null) {
                          const textBefore = aiContent.slice(lastIndex, tagMatch.index).trim();
                          if (textBefore) {
                              const cleaned = ChatParser.sanitize(textBefore);
                              if (cleaned && ChatParser.hasDisplayContent(cleaned)) {
                                  for (const chunk of ChatParser.chunkText(cleaned)) {
                                      if (!chunk) continue;
                                      const meta = consumeThinkingMeta();
                                      await DB.saveMessage({
                                          charId,
                                          role: 'assistant',
                                          type: 'text',
                                          content: chunk,
                                          replyTo: consumePendingReplyTo(),
                                          timestamp: baseTimestamp + offset,
                                          ...assistantMetadataPatch(meta),
                                      });
                                      savedPreviewChunks.push(chunk);
                                      offset += 1;
                                  }
                              }
                          }

                          const originalText = ChatParser.sanitize(tagMatch[1].trim());
                          const translatedText = ChatParser.sanitize(tagMatch[2].trim());
                          if (originalText || translatedText) {
                              const biContent = originalText && translatedText
                                  ? `${originalText}\n%%BILINGUAL%%\n${translatedText}`
                                  : (originalText || translatedText);
                              const meta = consumeThinkingMeta();
                              await DB.saveMessage({
                                  charId,
                                  role: 'assistant',
                                  type: 'text',
                                  content: biContent,
                                  replyTo: consumePendingReplyTo(),
                                  timestamp: baseTimestamp + offset,
                                  ...assistantMetadataPatch(meta),
                              });
                              savedPreviewChunks.push(originalText || translatedText);
                              offset += 1;
                          }

                          lastIndex = tagMatch.index + tagMatch[0].length;
                      }

                      const textAfter = aiContent.slice(lastIndex).trim();
                      if (textAfter) {
                          const cleaned = ChatParser.sanitize(textAfter.replace(/<\/?翻译>|<\/?原文>|<\/?译文>/g, '').trim());
                          if (cleaned && ChatParser.hasDisplayContent(cleaned)) {
                              for (const chunk of ChatParser.chunkText(cleaned)) {
                                  if (!chunk) continue;
                                  const meta = consumeThinkingMeta();
                                  await DB.saveMessage({
                                      charId,
                                      role: 'assistant',
                                      type: 'text',
                                      content: chunk,
                                      replyTo: consumePendingReplyTo(),
                                      timestamp: baseTimestamp + offset,
                                      ...assistantMetadataPatch(meta),
                                  });
                                  savedPreviewChunks.push(chunk);
                                  offset += 1;
                              }
                          }
                      }

                      for (const emojiName of bilingualEmojis) {
                          const foundEmoji = emojis.find(e => e.name === emojiName);
                          if (foundEmoji?.url) {
                              const meta = consumeThinkingMeta();
                              await DB.saveMessage({
                                  charId,
                                  role: 'assistant',
                                  type: 'emoji',
                                  content: foundEmoji.url,
                                  replyTo: consumePendingReplyTo(),
                                  timestamp: baseTimestamp + offset,
                                  ...assistantMetadataPatch(meta),
                              });
                              offset += 1;
                          }
                      }
                  } else {
                      // 传入已知表情名 → 文本里指向表情名的片段也识别成贴纸弹出（与本地路径一致）
                      const responseParts = ChatParser.splitResponse(aiContent, emojis.map(e => e.name));

                      for (const part of responseParts) {
                          if (part.type === 'emoji') {
                              const foundEmoji = emojis.find(e => e.name === part.content);
                              if (foundEmoji?.url) {
                                  const meta = consumeThinkingMeta();
                                  await DB.saveMessage({
                                      charId,
                                      role: 'assistant',
                                      type: 'emoji',
                                      content: foundEmoji.url,
                                      replyTo: consumePendingReplyTo(),
                                      timestamp: baseTimestamp + offset,
                                      ...assistantMetadataPatch(meta),
                                  });
                              } else {
                                  const fallbackText = `发送了表情包：${part.content}`;
                                  const meta = consumeThinkingMeta();
                                  await DB.saveMessage({
                                      charId,
                                      role: 'assistant',
                                      type: 'text',
                                      content: fallbackText,
                                      replyTo: consumePendingReplyTo(),
                                      timestamp: baseTimestamp + offset,
                                      ...assistantMetadataPatch(meta),
                                  });
                                  savedPreviewChunks.push(fallbackText);
                              }
                              offset += 1;
                              continue;
                          }

                          // 裸块级 HTML 整块保留（不被 chunkText 按行切碎），普通文本照常分泡
                          const textChunks: string[] = [];
                          for (const seg of splitOutRichBlocks(part.content)) {
                              if (seg.kind === 'rich') {
                                  textChunks.push(seg.content.trim());
                                  continue;
                              }
                              textChunks.push(...ChatParser.chunkText(seg.content)
                                  .map(chunk => ChatParser.sanitize(chunk))
                                  .filter(chunk => ChatParser.hasDisplayContent(chunk)));
                          }

                          for (const chunk of textChunks) {
                              const meta = consumeThinkingMeta();
                              await DB.saveMessage({
                                  charId,
                                  role: 'assistant',
                                  type: 'text',
                                  content: chunk,
                                  replyTo: consumePendingReplyTo(),
                                  timestamp: baseTimestamp + offset,
                                  ...assistantMetadataPatch(meta),
                              });
                              savedPreviewChunks.push(chunk);
                              offset += 1;
                          }
                      }
                  }
              }

              if (offset > 0) {
                  if (pendingReplyIds.length) {
                      try { await DB.setMessagesStatus(pendingReplyIds, 'read'); } catch { /* 回执失败不影响主动消息本体 */ }
                  }
                  const previewSource = savedPreviewChunks.join(' ').trim();
                  const preview = previewSource.replace(/\s+/g, ' ').trim().slice(0, 120) || `${char.name} sent a proactive message`;

                  // 6. Notify OS for unread badge + toast。bodies = 本轮逐条气泡正文，
                  //    供灵动岛/锁屏逐条弹横幅；count = 本轮实际落库的气泡条数，
                  //    未读数按它累加（每个消息气泡算一条，而不是每轮事件算一条）
                  const proactiveEventSource = opts?.eventSource || (offlineReplay ? 'proactive-offline-replay' : undefined);
                  window.dispatchEvent(new CustomEvent('proactive-message-sent', {
                      detail: {
                          charId,
                          charName: char.name,
                          body: preview,
                          bodies: savedPreviewChunks.slice(0, 8),
                          count: offset,
                          source: proactiveEventSource,
                          notificationData: opts?.notificationData,
                          skipSystemNotify: !!opts?.skipSystemNotify || offlineReplay,
                          sentAt: baseTimestamp,
                          offlineReplay,
                      }
                  }));
                  if (pendingForceReplyReason !== undefined || (forceReplyAllowed && forceReplyExtract.forceReply)) {
                      window.dispatchEvent(new CustomEvent(FORCE_REPLY_EVENT, {
                          detail: {
                              charId,
                              reason: pendingForceReplyReason,
                              body: preview,
                              source: proactiveEventSource || 'proactive-1.0',
                              requestedAt: Date.now(),
                          } satisfies ForceReplyEventDetail,
                      }));
                  }
                  // 这条生活事件确实生成了可见主动消息后，才在回顾里标注「已跟你说过」。
                  if (lifeEvent) {
                      void DB.markLifeEventSurfaced(lifeEvent.id, baseTimestamp);
                      void runCoupleAutoCareForSource(charId, {
                          source: 'proactive',
                          id: lifeEvent.id,
                          at: lifeEvent.timestamp,
                          text: lifeEvent.summary || lifeEvent.activity,
                      });
                  }
              }

              // 7. 角色主动拨语音电话：页面可见时弹来电界面（IncomingCallOverlay 接管），
              //    页面不可见则按"未接来电"落库并走普通未读通知
              if (charWantsCall) {
                  if (!offlineReplay && typeof document !== 'undefined' && document.visibilityState === 'visible') {
                      window.dispatchEvent(new CustomEvent('char-call-incoming', {
                          detail: { charId, charName: char.name }
                      }));
                  } else {
                      await DB.saveMessage({
                          charId,
                          role: 'assistant',
                          type: 'call_log',
                          content: '未接来电',
                          timestamp: baseTimestamp + offset,
                          metadata: withProactiveDeliveryMeta({ callDirection: 'incoming', callOutcome: 'missed' }),
                      } as any);
                      window.dispatchEvent(new CustomEvent('proactive-message-sent', {
                          detail: {
                              charId,
                              charName: char.name,
                              body: '[语音通话] 未接来电',
                              count: 1,
                              source: opts?.eventSource || (offlineReplay ? 'proactive-offline-replay' : undefined),
                              skipSystemNotify: !!opts?.skipSystemNotify || offlineReplay,
                              sentAt: baseTimestamp + offset,
                              offlineReplay,
                          }
                      }));
                  }
              }
          } catch (err: any) {
              console.error(`[Proactive/Global] Error for ${char.name}:`, err);
              try {
                  const msg = String(err?.message || err || '');
                  const isTimeout = err?.name === 'AbortError' || /timeout|abort/i.test(msg);
                  await DB.saveMessage({
                      charId,
                      role: 'system',
                      type: 'text',
                      content: isTimeout
                          ? '[主动消息生成超时：本轮已停止等待，请稍后检查主 API 或重试。]'
                          : '[主动消息生成失败：本轮已停止等待，请稍后检查主 API 或重试。]',
                      timestamp: Date.now(),
                  } as any);
                  setLastMsgTimestamp(Date.now());
              } catch { /* failure notice should never block queue cleanup */ }
          } finally {
              proactiveRunningRef.current = false;
              setProactiveComposingChars(prev => {
                  if (!prev[charId]) return prev;
                  const next = { ...prev };
                  delete next[charId];
                  return next;
              });
              drainQueuedProactive();
          }
      };

      ProactiveChat.onTrigger((charId: string, info) => {
          void runProactive(charId, info ? {
              scheduledAt: info.scheduledAt,
              offlineReplay: !!info.offlineReplay,
              replayIndex: info.replayIndex,
              replayTotal: info.replayTotal,
              missedCount: info.missedCount,
              eventSource: info.offlineReplay ? 'proactive-offline-replay' : undefined,
              skipSystemNotify: !!info.offlineReplay,
          } : undefined);
      });

      const collectNativeAlarmOccurrences = (alarm: ChatAlarm, now: number): number[] => {
          if (!alarm.enabled) return [];
          const end = now + CHAT_ALARM_NATIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
          const hits: number[] = [];
          let cursor = now;
          for (let i = 0; i < 32; i += 1) {
              const next = computeNextAlarmAt(alarm.timeHHmm, alarm.weekdays, cursor, true);
              if (next > end || next <= 0) break;
              hits.push(next);
              cursor = next + 60_000;
          }
          return hits;
      };

      const collectNativePeriodOccurrences = (settings: PeriodReminderSettings, now: number): number[] => {
          if (!settings.enabled) return [];
          const end = now + PERIOD_REMINDER_NATIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
          const hits: number[] = [];
          let cursor = now;
          for (let i = 0; i < 32; i += 1) {
              const next = computeNextPeriodReminderAt(settings, cursor, true);
              if (next > end || next <= 0) break;
              hits.push(next);
              cursor = next + 60_000;
          }
          return hits;
      };

      const collectNativeGenericHealthOccurrences = (reminder: HealthReminder, now: number): number[] => {
          return collectNativeHealthOccurrences(reminder, now);
      };

      const rescheduleNativeChatAlarms = async () => {
          if (!Capacitor.isNativePlatform()) return;
          try {
              const perm = await LocalNotifications.checkPermissions();
              const finalPerm = perm.display === 'granted' ? perm : await LocalNotifications.requestPermissions();
              if (finalPerm.display !== 'granted') return;

              const pending = await LocalNotifications.getPending().catch(() => ({ notifications: [] as any[] }));
              const alarmPending = (pending.notifications || []).filter((n: any) => n?.extra?.source === 'chat-alarm' || n?.extra?.type === 'chat-alarm');
              if (alarmPending.length) {
                  await LocalNotifications.cancel({ notifications: alarmPending.map((n: any) => ({ id: n.id })) }).catch(() => {});
              }

              const now = Date.now();
              const alarms = await DB.getAllChatAlarms();
              const charById = new Map(charactersRef.current.map(c => [c.id, c]));
              const notifications: any[] = [];
              for (const alarm of alarms) {
                  if (!alarm.enabled) continue;
                  const char = charById.get(alarm.charId);
                  if (!char) continue;
                  if (!canCharContactUser(char)) continue;
                  for (const at of collectNativeAlarmOccurrences(alarm, now)) {
                      notifications.push({
                          id: nativeNotificationIdForAlarm(alarm.id, at),
                          title: alarmNotificationTitle(char.name, alarm),
                          body: alarmNotificationBody(alarm),
                          schedule: { at: new Date(at), allowWhileIdle: true },
                          smallIcon: 'ic_stat_icon_config_sample',
                          extra: {
                              source: 'chat-alarm',
                              type: 'chat-alarm',
                              charId: alarm.charId,
                              alarmId: alarm.id,
                              at,
                          },
                      });
                      if (notifications.length >= 256) break;
                  }
                  if (notifications.length >= 256) break;
              }
              if (notifications.length) {
                  await LocalNotifications.schedule({ notifications });
              }
          } catch (e) {
              console.warn('[ChatAlarm] native schedule skipped', e);
          }
      };

      const rescheduleNativePeriodReminders = async () => {
          if (!Capacitor.isNativePlatform()) return;
          try {
              const perm = await LocalNotifications.checkPermissions();
              const finalPerm = perm.display === 'granted' ? perm : await LocalNotifications.requestPermissions();
              if (finalPerm.display !== 'granted') return;

              const pending = await LocalNotifications.getPending().catch(() => ({ notifications: [] as any[] }));
              const periodPending = (pending.notifications || []).filter((n: any) => n?.extra?.source === 'period-reminder' || n?.extra?.type === 'period-reminder');
              if (periodPending.length) {
                  await LocalNotifications.cancel({ notifications: periodPending.map((n: any) => ({ id: n.id })) }).catch(() => {});
              }

              const now = Date.now();
              const all = await DB.getAllPeriodReminderSettings();
              const notifications: any[] = [];
              for (const settings of all) {
                  if (!settings.enabled) continue;
                  for (const at of collectNativePeriodOccurrences(settings, now)) {
                      notifications.push({
                          id: nativeNotificationIdForPeriodReminder(settings.id, at),
                          title: periodReminderTitle(settings, at),
                          body: periodReminderBody(settings, at),
                          schedule: { at: new Date(at), allowWhileIdle: true },
                          smallIcon: 'ic_stat_icon_config_sample',
                          extra: {
                              source: 'period-reminder',
                              type: 'period-reminder',
                              settingsId: settings.id,
                              charId: settings.charIds?.[0],
                              at,
                          },
                      });
                      if (notifications.length >= 128) break;
                  }
                  if (notifications.length >= 128) break;
              }
              if (notifications.length) {
                  await LocalNotifications.schedule({ notifications });
              }
          } catch (e) {
              console.warn('[PeriodReminder] native schedule skipped', e);
          }
      };

      const rescheduleNativeHealthReminders = async () => {
          if (!Capacitor.isNativePlatform()) return;
          try {
              const perm = await LocalNotifications.checkPermissions();
              const finalPerm = perm.display === 'granted' ? perm : await LocalNotifications.requestPermissions();
              if (finalPerm.display !== 'granted') return;

              const pending = await LocalNotifications.getPending().catch(() => ({ notifications: [] as any[] }));
              const healthPending = (pending.notifications || []).filter((n: any) => n?.extra?.source === 'health-reminder' || n?.extra?.type === 'health-reminder');
              if (healthPending.length) {
                  await LocalNotifications.cancel({ notifications: healthPending.map((n: any) => ({ id: n.id })) }).catch(() => {});
              }

              const now = Date.now();
              const all = await DB.getAllHealthReminders();
              const notifications: any[] = [];
              for (const reminder of all) {
                  if (!reminder.enabled) continue;
                  const shouldScheduleSystem = reminder.channel === 'system' || reminder.channel === 'both' || !healthPrivacyAllowsReminder(reminder.privacy);
                  if (!shouldScheduleSystem) continue;
                  for (const at of collectNativeGenericHealthOccurrences(reminder, now)) {
                      notifications.push({
                          id: nativeNotificationIdForHealthReminder(reminder.id, at),
                          title: healthReminderTitle(reminder),
                          body: healthReminderBody(reminder),
                          schedule: { at: new Date(at), allowWhileIdle: true },
                          smallIcon: 'ic_stat_icon_config_sample',
                          extra: {
                              source: 'health-reminder',
                              type: 'health-reminder',
                              reminderId: reminder.id,
                              moduleId: reminder.moduleId,
                              charId: reminder.charIds?.[0],
                              at,
                          },
                      });
                      if (notifications.length >= 128) break;
                  }
                  if (notifications.length >= 128) break;
              }
              if (notifications.length) {
                  await LocalNotifications.schedule({ notifications });
              }
          } catch (e) {
              console.warn('[HealthReminder] native schedule skipped', e);
          }
      };

      const acquireChatAlarmLock = (alarm: ChatAlarm, fireKey: string, now: number): boolean => {
          const key = `moro_chat_alarm_lock_${alarm.id}_${fireKey}`;
          try {
              const until = Number(localStorage.getItem(key) || '0');
              if (until > now) return false;
              localStorage.setItem(key, String(now + CHAT_ALARM_LOCK_MS));
          } catch {
              return true;
          }
          return true;
      };

      const acquirePeriodReminderLock = (settings: PeriodReminderSettings, fireKey: string, now: number): boolean => {
          const key = `moro_period_reminder_lock_${settings.id}_${fireKey}`;
          try {
              const until = Number(localStorage.getItem(key) || '0');
              if (until > now) return false;
              localStorage.setItem(key, String(now + PERIOD_REMINDER_LOCK_MS));
          } catch {
              return true;
          }
          return true;
      };

      const acquireHealthReminderLock = (reminder: HealthReminder, fireKey: string, now: number): boolean => {
          const key = `moro_health_reminder_lock_${reminder.id}_${fireKey}`;
          try {
              const until = Number(localStorage.getItem(key) || '0');
              if (until > now) return false;
              localStorage.setItem(key, String(now + HEALTH_REMINDER_LOCK_MS));
          } catch {
              return true;
          }
          return true;
      };

      const showChatAlarmNotification = async (char: CharacterProfile, alarm: ChatAlarm) => {
          if (Capacitor.isNativePlatform()) return;
          await showLocalNotification(alarmNotificationTitle(char.name, alarm), {
              body: alarmNotificationBody(alarm),
              tag: `chat-alarm-${alarm.id}`,
              data: {
                  source: 'chat-alarm',
                  type: 'chat-alarm',
                  charId: alarm.charId,
                  alarmId: alarm.id,
              },
          });
      };

      const showPeriodReminderNotification = async (settings: PeriodReminderSettings, now: number) => {
          if (Capacitor.isNativePlatform()) return;
          await showLocalNotification(periodReminderTitle(settings, settings.nextAt || now), {
              body: periodReminderBody(settings, settings.nextAt || now),
              tag: `period-reminder-${settings.id}`,
              data: {
                  source: 'period-reminder',
                  type: 'period-reminder',
                  settingsId: settings.id,
                  charId: settings.charIds?.[0],
              },
          });
      };

      const showHealthReminderNotification = async (reminder: HealthReminder) => {
          if (Capacitor.isNativePlatform()) return;
          await showLocalNotification(healthReminderTitle(reminder), {
              body: healthReminderBody(reminder),
              tag: `health-reminder-${reminder.id}`,
              data: {
                  source: 'health-reminder',
                  type: 'health-reminder',
                  reminderId: reminder.id,
                  moduleId: reminder.moduleId,
                  charId: reminder.charIds?.[0],
              },
          });
      };

      const checkChatAlarms = async () => {
          try {
              const now = Date.now();
              const due = await DB.getDueChatAlarms(now);
              if (!due.length) return;
              const userName = userProfileRef.current?.name || '对方';
              for (const alarm of due) {
                  const fireKey = alarmFireKey(alarm, alarm.nextAt || now);
                  if (!acquireChatAlarmLock(alarm, fireKey, now)) continue;

                  if (alarm.lastFiredKey === fireKey || shouldSkipStaleAlarm(alarm, now)) {
                      await DB.saveChatAlarm(markAlarmFired(alarm, now));
                      continue;
                  }

                  const char = charactersRef.current.find(c => c.id === alarm.charId);
                  if (!char) {
                      await DB.saveChatAlarm(markAlarmFired(alarm, now));
                      continue;
                  }

                  if (!canCharContactUser(char)) {
                      await DB.saveChatAlarm(markAlarmFired(alarm, now));
                      continue;
                  }

                  await showChatAlarmNotification(char, alarm);

                  const channel = resolveAlarmChannel(alarm);
                  const notificationData = { type: 'chat-alarm', source: 'chat-alarm', charId: alarm.charId, alarmId: alarm.id };

                  if (channel === 'call') {
                      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
                          window.dispatchEvent(new CustomEvent('char-call-incoming', {
                              detail: { charId: alarm.charId, charName: char.name, alarmId: alarm.id }
                          }));
                      } else {
                          await DB.saveMessage({
                              charId: alarm.charId,
                              role: 'assistant',
                              type: 'call_log',
                              content: '闹钟来电未接',
                              metadata: { callDirection: 'incoming', callOutcome: 'missed', chatAlarmId: alarm.id, excludeFromContext: true },
                          } as any);
                          window.dispatchEvent(new CustomEvent('proactive-message-sent', {
                              detail: {
                                  charId: alarm.charId,
                                  charName: char.name,
                                  body: '[语音通话] 闹钟来电未接',
                                  count: 1,
                                  source: 'chat-alarm',
                                  notificationData,
                                  skipSystemNotify: true,
                              },
                          }));
                      }
                  } else {
                      await runProactive(alarm.charId, {
                          customHint: buildChatAlarmHint({ alarm, char, userName, channel, nowMs: now }),
                          eventSource: 'chat-alarm',
                          notificationData,
                          skipSystemNotify: true,
                      });
                  }

                  await DB.saveChatAlarm(markAlarmFired(alarm, now));
              }
          } catch (e) {
              console.warn('[ChatAlarm] check failed', e);
          }
      };

      const checkPeriodReminders = async () => {
          try {
              const now = Date.now();
              const due = await DB.getDuePeriodReminderSettings(now);
              if (!due.length) return;
              const userName = userProfileRef.current?.name || '对方';
              for (const settings of due) {
                  const fireKey = periodFireKey(settings, settings.nextAt || now);
                  if (!acquirePeriodReminderLock(settings, fireKey, now)) continue;

                  if (settings.lastFiredKey === fireKey || shouldSkipStalePeriodReminder(settings, now)) {
                      await DB.savePeriodReminderSettings(markPeriodReminderFired(settings, now));
                      continue;
                  }

                  const canTellChars = settings.visibility === 'public' && (settings.notifyChannel === 'character' || settings.notifyChannel === 'both');
                  const charIds = Array.from(new Set(settings.charIds || []));
                  const eligibleChars = canTellChars
                      ? charIds
                          .map(charId => charactersRef.current.find(c => c.id === charId))
                          .filter((char): char is CharacterProfile => !!char && canCharContactUser(char))
                      : [];
                  const shouldShowSystem = settings.notifyChannel === 'system' || settings.notifyChannel === 'both' || !canTellChars || eligibleChars.length === 0;
                  if (shouldShowSystem) {
                      await showPeriodReminderNotification(settings, now);
                  }

                  if (canTellChars) {
                      for (const char of eligibleChars) {
                          await runProactive(char.id, {
                              customHint: buildPeriodReminderHint({ settings, char, userName, nowMs: now }),
                              eventSource: 'period-reminder',
                              notificationData: { type: 'period-reminder', source: 'period-reminder', settingsId: settings.id, charId: char.id },
                              skipSystemNotify: true,
                          });
                      }
                  }

                  await DB.savePeriodReminderSettings(markPeriodReminderFired(settings, now));
              }
          } catch (e) {
              console.warn('[PeriodReminder] check failed', e);
          }
      };

      const checkHealthReminders = async () => {
          try {
              const now = Date.now();
              const due = await DB.getDueHealthReminders(now);
              if (!due.length) return;
              const userName = userProfileRef.current?.name || '对方';
              for (const reminder of due) {
                  const fireKey = healthReminderFireKey(reminder, reminder.nextAt || now);
                  if (!acquireHealthReminderLock(reminder, fireKey, now)) continue;

                  if (reminder.lastFiredKey === fireKey || shouldSkipStaleHealthReminder(reminder, now)) {
                      await DB.saveHealthReminder(markHealthReminderFired(reminder, now));
                      continue;
                  }

                  const canTellChars = healthPrivacyAllowsReminder(reminder.privacy) && (reminder.channel === 'character' || reminder.channel === 'both');
                  const charIds = Array.from(new Set(reminder.charIds || []));
                  const eligibleChars = canTellChars
                      ? charIds
                          .map(charId => charactersRef.current.find(c => c.id === charId))
                          .filter((char): char is CharacterProfile => !!char && canCharContactUser(char))
                      : [];
                  const shouldShowSystem = reminder.channel === 'system' || reminder.channel === 'both' || !canTellChars || eligibleChars.length === 0;
                  if (shouldShowSystem) {
                      await showHealthReminderNotification(reminder);
                  }

                  if (canTellChars) {
                      for (const char of eligibleChars) {
                          await runProactive(char.id, {
                              customHint: buildHealthCompanionHint({ reminder, char, userName, nowMs: now }),
                              eventSource: 'health-reminder',
                              notificationData: { type: 'health-reminder', source: 'health-reminder', reminderId: reminder.id, moduleId: reminder.moduleId, charId: char.id },
                              skipSystemNotify: true,
                          });
                      }
                  }

                  await DB.saveHealthReminder(markHealthReminderFired(reminder, now));
              }
          } catch (e) {
              console.warn('[HealthReminder] check failed', e);
          }
      };

      const chatAlarmTimer = setInterval(() => { void checkChatAlarms(); }, 30_000);
      const periodReminderTimer = setInterval(() => { void checkPeriodReminders(); }, 30_000);
      const healthReminderTimer = setInterval(() => { void checkHealthReminders(); }, 30_000);
      const onChatAlarmsUpdated = () => {
          void checkChatAlarms();
          void rescheduleNativeChatAlarms();
      };
      const onPeriodRemindersUpdated = () => {
          void checkPeriodReminders();
          void rescheduleNativePeriodReminders();
      };
      const onHealthRemindersUpdated = () => {
          void checkHealthReminders();
          void rescheduleNativeHealthReminders();
      };
      const onHealthSummaryRequest = (e: Event) => {
          const detail = (e as CustomEvent).detail as { date?: string; charId?: string };
          void (async () => {
              try {
                  const date = detail?.date || toHealthDateKey(new Date());
                  const [settings, records] = await Promise.all([
                      DB.getAllHealthModuleSettings().catch(() => []),
                      DB.getHealthRecordsByDate(date).catch(() => []),
                  ]);
                  const summaryModules = settings.filter(s => s.enabled && healthPrivacyAllowsSummary(s.privacy) && s.charIds.length > 0);
                  const allowedModuleIds = new Set(summaryModules.map(s => s.id));
                  const visibleRecords = records.filter(record => allowedModuleIds.has(record.moduleId));
                  if (!visibleRecords.length) return;
                  const byChar = new Map<string, string[]>();
                  summaryModules.forEach(setting => {
                      setting.charIds.forEach(charId => {
                          if (detail?.charId && detail.charId !== charId) return;
                          const moduleLines = visibleRecords
                              .filter(record => record.moduleId === setting.id)
                              .map(record => `${record.label || record.tags?.[0] || record.moduleId}${record.value !== undefined ? ` ${record.value}${record.unit || ''}` : ''}`)
                              .slice(0, 4);
                          if (!moduleLines.length) return;
                          const prev = byChar.get(charId) || [];
                          byChar.set(charId, [...prev, `${HEALTH_MODULE_LABEL[setting.id]}：${moduleLines.join('、')}`]);
                      });
                  });
                  const userName = userProfileRef.current?.name || '对方';
                  for (const [charId, lines] of byChar) {
                      const char = charactersRef.current.find(c => c.id === charId);
                      if (!char || !canCharContactUser(char)) continue;
                      await runProactive(char.id, {
                          customHint: buildHealthSummaryCompanionHint({
                              summaryText: `${date}：${lines.join('；')}`,
                              char,
                              userName,
                              nowMs: Date.now(),
                          }),
                          eventSource: 'health-summary',
                          notificationData: { type: 'health-summary', source: 'health-summary', charId: char.id },
                          skipSystemNotify: true,
                      });
                  }
              } catch (err) {
                  console.warn('[HealthSummary] request failed', err);
              }
          })();
      };
      const onAlarmVisibility = () => {
          if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
              void checkChatAlarms();
              void rescheduleNativeChatAlarms();
              void checkPeriodReminders();
              void rescheduleNativePeriodReminders();
              void checkHealthReminders();
              void rescheduleNativeHealthReminders();
          }
      };
      window.addEventListener('chat-alarms-updated', onChatAlarmsUpdated);
      window.addEventListener('period-reminders-updated', onPeriodRemindersUpdated);
      window.addEventListener(HEALTH_REMINDERS_UPDATED_EVENT, onHealthRemindersUpdated);
      window.addEventListener(HEALTH_SUMMARY_REQUEST_EVENT, onHealthSummaryRequest);
      document.addEventListener('visibilitychange', onAlarmVisibility);
      void checkChatAlarms();
      void rescheduleNativeChatAlarms();
      void checkPeriodReminders();
      void rescheduleNativePeriodReminders();
      void checkHealthReminders();
      void rescheduleNativeHealthReminders();

      // ─── 外卖「角色收到货」反应 watcher ───
      // 给角色点的外卖到点（now>=etaAt）后：自动签收 + 让角色像真人收到外卖那样在聊天里反应。
      // 即便外卖 App 没开着也会触发（与现实时间同步）。
      const takeoutReactRunning = { v: false };
      const checkTakeoutDeliveries = async () => {
          if (takeoutReactRunning.v) return;
          takeoutReactRunning.v = true;
          try {
              const orders = await DB.getTakeoutOrders().catch(() => []);
              const now = Date.now();
              const userName = userProfileRef.current?.name || '对方';
              // 同角色同批多单时累加好感的本地账：charactersRef 在这个同步 for 循环里不会刷新，
              // 若每单都从 char.affection 起算，后一次 updateCharacter 会覆盖前一次（多单只净 +2）。
              const affectionByChar = new Map<string, number>();
              for (const o of orders) {
                  if (!shouldAutoReactToCharTakeout(o, now)) continue;       // 只处理「给角色点的」且确实到有效 ETA 的单
                  const charId = o.charId;
                  if (!charId) continue;
                  const char = charactersRef.current.find(c => c.id === charId);
                  if (!char) continue;
                  // 签收 + 打标，避免重复反应
                  await DB.saveTakeoutOrder({ ...o, status: 'delivered', deliveredAt: now, reactionPosted: true }).catch(() => {});
                  notifyTakeoutUpdated();
                  // 收到对方专门点的外卖是日常里的小温暖 → 好感小幅 +（走加减框架，限制幅度）。
                  // 基于「上一单算出的值」继续加，保证同批 N 单每单都生效。
                  const baseAff = affectionByChar.get(charId) ?? char.affection;
                  const nextAff = applyAffectionDelta(baseAff, 2);
                  affectionByChar.set(charId, nextAff);
                  const updates: Partial<CharacterProfile> = { affection: nextAff };
                  if (char.coupleSpace) {
                      const cs = ensureCoupleSpace(char);
                      const items = (o.items || []).map(i => `${i.emoji || ''}${i.name}`).join('、') || '一份饭票';
                      const card = buildCoupleTakeoutMemoryCard({
                          title: `${o.storeName}的饭票`,
                          text: `${userName}给${char.name}点了${items}，这张小票被收进了情侣空间。`,
                          sourceId: o.id,
                          sourceAt: now,
                          createdAt: now,
                      });
                      updates.coupleSpace = { ...cs, memoryCards: [card, ...(cs.memoryCards || [])], updatedAt: now };
                  }
                  updateCharacter(charId, updates);
                  if (!canCharContactUser(char)) continue; // 拉黑期间不反应
                  void runCoupleAutoCareForSource(charId, {
                      source: 'takeout',
                      id: o.id,
                      at: now,
                      text: `${userName}给你点的${o.storeName}外卖送到了。`,
                  });
                  await runProactive(charId, { customHint: buildTakeoutReceivedHint(o, userName) });
              }
          } catch (e) {
              console.warn('[Takeout] delivery react check failed', e);
          } finally {
              takeoutReactRunning.v = false;
          }
      };
      const takeoutReactTimer = setInterval(() => { void checkTakeoutDeliveries(); }, 30_000);
      void checkTakeoutDeliveries();

      // 「页外」自主登入 —— 独立调度，复用同一批 refs 拿最新状态
      const runVR = async (charId: string, room?: string, letterId?: string) => {
          const char = charactersRef.current.find(c => c.id === charId);
          if (!char || !char.vrState?.enabled) return;
          if (!userProfileRef.current) return;
          if (shouldHideAmbientSocialRecordForUser(userProfileRef.current) && isAmbientSocialCharacterForUser(char, userProfileRef.current)) return;
          try {
              await runVRSession({
                  char,
                  characters: charactersRef.current,
                  apiConfig: apiConfigRef.current,
                  userProfile: userProfileRef.current,
                  groups: groupsRef.current,
                  realtimeConfig: realtimeConfigRef.current,
                  memoryPalaceConfig: memoryPalaceConfigRef.current,
                  updateCharacter,
                  forcedRoom: room as any,
                  forcedLetterId: letterId,
              });
          } catch (e) {
              console.error('[VRWorld] runVR error', e);
          }
      };
      VRScheduler.onTrigger((charId: string, room?: string, letterId?: string) => { void runVR(charId, room, letterId); });

      // 以角色 vrState 为准对账调度表：调度表存 localStorage、不随备份迁移，
      // 导入备份后角色虽 enabled 但调度表为空，这里补建/清理使其按时触发。
      VRScheduler.reconcile(
          charactersRef.current
              .filter(c => c.vrState?.enabled)
              .map(c => ({ charId: c.id, intervalMinutes: c.vrState?.intervalMinutes || VR_DEFAULT_INTERVAL_MIN }))
      );

      return () => {
          // Cleanup: detach proactive listeners when OSContext unmounts (unlikely but safe)
          ProactiveChat.onTrigger(() => {});
          VRScheduler.onTrigger(() => {});
          clearInterval(chatAlarmTimer);
          clearInterval(periodReminderTimer);
          clearInterval(healthReminderTimer);
          window.removeEventListener('chat-alarms-updated', onChatAlarmsUpdated);
          window.removeEventListener('period-reminders-updated', onPeriodRemindersUpdated);
          window.removeEventListener(HEALTH_REMINDERS_UPDATED_EVENT, onHealthRemindersUpdated);
          window.removeEventListener(HEALTH_SUMMARY_REQUEST_EVENT, onHealthSummaryRequest);
          document.removeEventListener('visibilitychange', onAlarmVisibility);
          clearInterval(takeoutReactTimer);
      };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDataLoaded]);

  // ─── 离线自主生活·回看补齐 ───────────────────────────────────────
  // 用户离线一段时间回来时，为开启了「自主生活」的角色补齐这段时间发生的小事，
  // 攒成「你不在时 TA 经历了…」的回顾时间线（LifeRecapModal 读 char_life_events 渲染）。
  // 用 localStorage 记上次活跃时刻；gap ≥ CATCHUP_MIN_GAP_MS 才补，且每段 gap 只补一次。
  useEffect(() => {
      if (!isDataLoaded) return;
      const LAST_SEEN_KEY = 'autonomous_life_last_seen';
      const BUSY_KEY = 'autonomous_life_catchup_busy';
      const LEAVE_GEN_KEY = 'autonomous_life_leave_gen'; // 每角色「离线即生成」的上次时刻（防快速切后台刷爆 API）
      const LEAVE_MIN_GAP_MS = 30 * 60 * 1000;           // 同一角色两次「离线即生成」至少间隔 30 分钟
      let cancelled = false;

      const markSeen = () => {
          try { localStorage.setItem(LAST_SEEN_KEY, String(Date.now())); } catch { /* ignore */ }
      };

      const applyLifeEventToCoupleSpace = (charId: string, source: CoupleAutoCareSource) => {
          const fresh = charactersRef.current.find(c => c.id === charId);
          if (!fresh?.coupleSpace) return;
          const now = source.at || Date.now();
          const current = ensureCoupleSpace(fresh);
          const decision = shouldRunCoupleAutoCare(current, now);
          if (!decision.shouldRun || decision.reason === 'recap-only') return;
          const text = source.text.replace(/\s+/g, ' ').trim().slice(0, 70);
          if (!text) return;
          const applied = applyCoupleAutoCareDraft(current, { kind: 'moment', text, mood: '📝' }, source, now);
          if (applied.applied !== 'none') void updateCharacter(charId, { coupleSpace: applied.space });
      };

      // 用户「刚离开」（切后台 / 锁屏 / 关页前）：让开了自主生活的角色**立刻**过一格日子，
      // 趁页面挂起前把请求发出去（best-effort）。这样「一离线 TA 就开始过自己的日子」，
      // 不必干等到 2 小时后回来才一次性补——回来时的 catchUpOfflineLife 仍会补齐更长的 gap。
      const runOnLeave = () => {
          const profile = userProfileRef.current;
          const chars = charactersRef.current.filter(c => (
              isAutonomousLifeEnabled(c)
              && !c.charBlock?.active
              && !(shouldHideAmbientSocialRecordForUser(profile) && isAmbientSocialCharacterForUser(c, profile))
          ));
          if (chars.length === 0) return;
          let stamps: Record<string, number> = {};
          try { stamps = JSON.parse(localStorage.getItem(LEAVE_GEN_KEY) || '{}') || {}; } catch { /* ignore */ }
          const now = Date.now();
          const main = apiConfigRef.current;
          let touched = false;
          for (const char of chars) {
              if (now - (stamps[char.id] || 0) < LEAVE_MIN_GAP_MS) continue; // 刚生成过，跳过防刷
              const api = resolveLifeApi(char, auxApiConfigRef.current, { baseUrl: main.baseUrl, apiKey: main.apiKey, model: main.model });
              if (!api.baseUrl) continue;
              stamps[char.id] = now;
              touched = true;
              // fire-and-forget：不 await（页面要挂起了），成功落库后广播让列表「此刻」状态刷新
              void advanceLife(char, api, { source: 'proactive', triggerSource: 'leave', now }).then(ev => {
                  if (ev) {
                      window.dispatchEvent(new CustomEvent('autonomous-life-advanced', { detail: { charId: char.id, charName: char.name } }));
                      applyLifeEventToCoupleSpace(char.id, { source: 'leave', id: ev.id, at: ev.timestamp, text: ev.summary || ev.activity });
                  }
              }).catch(() => { /* 离线生成失败忽略 */ });
          }
          if (touched) { try { localStorage.setItem(LEAVE_GEN_KEY, JSON.stringify(stamps)); } catch { /* ignore */ } }
      };

      const runCatchUp = async () => {
          let lastSeen = 0;
          try { lastSeen = parseInt(localStorage.getItem(LAST_SEEN_KEY) || '0', 10) || 0; } catch { /* ignore */ }
          const now = Date.now();
          // 首次 / 无记录：仅记录当下，不补（避免给「老用户首次升级」凭空造历史）。
          if (!lastSeen || now - lastSeen < CATCHUP_MIN_GAP_MS) { markSeen(); return; }

          // 防并发（多标签 / 快速切换）：粗粒度互斥锁，60s 自动过期。
          try {
              const busy = parseInt(localStorage.getItem(BUSY_KEY) || '0', 10) || 0;
              if (busy && now - busy < 60_000) return;
              localStorage.setItem(BUSY_KEY, String(now));
          } catch { /* ignore */ }

          const gapStart = lastSeen;
          markSeen(); // 先推进，保证这段 gap 不被重复补

          const profile = userProfileRef.current;
          const chars = charactersRef.current.filter(c => (
              isAutonomousLifeEnabled(c)
              && !c.charBlock?.active
              && !(shouldHideAmbientSocialRecordForUser(profile) && isAmbientSocialCharacterForUser(c, profile))
          ));
          for (const char of chars) {
              if (cancelled) break;
              const main = apiConfigRef.current;
              // 「线下」离线补齐默认走副 API（per-char 副 API > 全局副 API > 主 API）。
              const api = resolveLifeApi(char, auxApiConfigRef.current, { baseUrl: main.baseUrl, apiKey: main.apiKey, model: main.model });
              if (!api.baseUrl) continue;
              try {
                  const events = await catchUpOfflineLife(char, api, gapStart, { now });
                  if (events.length > 0 && !cancelled) {
                      window.dispatchEvent(new CustomEvent('autonomous-life-catchup', {
                          detail: { charId: char.id, charName: char.name, count: events.length },
                      }));
                      const ev = events[events.length - 1];
                      if (ev) applyLifeEventToCoupleSpace(char.id, { source: 'catchup', id: ev.id, at: ev.timestamp, text: ev.summary || ev.activity });
                  }
              } catch { /* per-char failure ignored */ }
          }
          try { localStorage.removeItem(BUSY_KEY); } catch { /* ignore */ }
      };

      const onVisibility = () => {
          if (document.visibilityState === 'visible') void runCatchUp();
          else { markSeen(); runOnLeave(); } // 一切后台/锁屏即视为「离线」，让角色立刻过一格日子
      };
      const onFocus = () => { void runCatchUp(); };
      const onBlur = () => { runOnLeave(); }; // 桌面切走窗口（未必触发 visibilitychange）也算离线

      // 启动即跑一次（覆盖「整页关闭后重开」的离线 gap），再挂可见性 / focus 监听。
      void runCatchUp();
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('focus', onFocus);
      window.addEventListener('blur', onBlur);
      return () => {
          cancelled = true;
          markSeen();
          document.removeEventListener('visibilitychange', onVisibility);
          window.removeEventListener('focus', onFocus);
          window.removeEventListener('blur', onBlur);
      };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDataLoaded]);

  // ─── 离线主动消息·快照镜像 ───────────────────────────────────────
  // 把「开了主动消息的角色」的紧凑生成上下文（人设 + 当下日常 + 最近对话 + 解析好的副 API）
  // 写进 MoroProactiveSW，供 Service Worker 在关站/后台被 Web Push 唤醒后自己调副 API 生成
  // 主动消息（取材 ta 的日常）。每 5 分钟刷新一次保持新鲜；回前台时先对账（回填 SW 离线期间
  // 已发过的时间）避免本地定时器重复触发，再刷一次快照。失败全吞，绝不影响主流程。
  useEffect(() => {
      if (!isDataLoaded) return;
      const mirror = () => { void mirrorProactiveSnapshots(charactersRef.current, apiConfigRef.current, auxApiConfigRef.current); };
      const onVisibility = () => {
          if (document.visibilityState === 'visible') void reconcileProactiveFires();
          mirror();
      };
      void reconcileProactiveFires();
      mirror();
      const timer = setInterval(mirror, 5 * 60 * 1000);
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener(OFFLINE_SESSION_STATE_EVENT, mirror);
      return () => {
          clearInterval(timer);
          document.removeEventListener('visibilitychange', onVisibility);
          window.removeEventListener(OFFLINE_SESSION_STATE_EVENT, mirror);
      };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDataLoaded]);

  const updateTheme = async (updates: Partial<OSTheme>) => {
    const { wallpaper, launcherWidgetImage, launcherWidgets, desktopDecorations, customFont, ...styleUpdates } = updates;
    // Legacy slots are banned — never let them enter state, regardless of caller intent.
    const sanitizedWidgets = launcherWidgets !== undefined
        ? Object.fromEntries(Object.entries(launcherWidgets).filter(([k]) => k !== 'bl' && k !== 'br'))
        : undefined;
    const sanitizedUpdates: Partial<OSTheme> = { ...updates, launcherWidgetImage: undefined };
    if (sanitizedWidgets !== undefined) sanitizedUpdates.launcherWidgets = sanitizedWidgets;
    const newTheme = { ...theme, ...sanitizedUpdates, launcherWidgetImage: undefined };
    if (newTheme.launcherWidgets) {
        const w = { ...newTheme.launcherWidgets };
        delete w['bl'];
        delete w['br'];
        newTheme.launcherWidgets = Object.keys(w).length > 0 ? w : undefined;
    }
    setTheme(newTheme);

    // Persist large assets to IndexedDB
    if (wallpaper !== undefined) {
        if (wallpaper && wallpaper.startsWith('data:')) {
            await DB.saveAsset('wallpaper', wallpaper);
        } else {
            await DB.deleteAsset('wallpaper');
        }
    }

    // Lock-screen wallpaper is a large data URI too — keep it out of LocalStorage by
    // mirroring the desktop wallpaper: store the blob in IndexedDB and strip the data
    // URI from the persisted theme below. Otherwise a single photo can blow the
    // os_theme quota, so localStorage.setItem throws and the change never persists.
    if ('lockScreenStyle' in updates) {
        const lockWp = newTheme.lockScreenStyle?.wallpaper;
        if (lockWp && lockWp.startsWith('data:')) {
            await DB.saveAsset('lock_wallpaper', lockWp);
        } else {
            await DB.deleteAsset('lock_wallpaper');
        }
    }

    // Legacy single-image asset is permanently banned — always delete, never save.
    await DB.deleteAsset('launcherWidgetImage');

    // Save widget images to IndexedDB (each slot is a separate asset)
    if (launcherWidgets !== undefined) {
        const slots = ['tl', 'tr', 'wide', 'dsq'];
        for (const slot of slots) {
            const val = sanitizedWidgets?.[slot];
            if (val && val.startsWith('data:')) {
                await DB.saveAsset(`widget_${slot}`, val);
            } else if (!val) {
                await DB.deleteAsset(`widget_${slot}`);
            }
        }
        // Always purge deprecated slot assets so old data can never resurface.
        await DB.deleteAsset('widget_bl');
        await DB.deleteAsset('widget_br');
    }

    // Save desktop decoration images to IndexedDB
    if (desktopDecorations !== undefined) {
        // Clean up old decoration assets first
        const allAssets = await DB.getAllAssets();
        const oldDecoKeys = allAssets.filter(a => a.id.startsWith('deco_')).map(a => a.id);
        for (const key of oldDecoKeys) {
            await DB.deleteAsset(key);
        }
        // Save new decoration images
        if (desktopDecorations) {
            for (const deco of desktopDecorations) {
                if (deco.content && deco.content.startsWith('data:') && deco.type === 'image') {
                    await DB.saveAsset(`deco_${deco.id}`, deco.content);
                }
            }
        }
    }

    // Logic for Font: Differentiate between Data URI (Blob) and URL (Web Font)
    // Use `in` check so an explicit `customFont: undefined` (user-initiated reset)
    // still triggers the reset branch — `customFont !== undefined` would skip it.
    if ('customFont' in updates) {
        if (customFont && customFont.startsWith('data:')) {
            // Blob: Save to DB, Apply
            await DB.saveAsset('custom_font_data', customFont);
            applyCustomFont(customFont);
        } else if (customFont && (customFont.startsWith('http') || customFont.startsWith('https'))) {
            // Web URL: Clear Blob from DB, Apply, Save to LS (via cleanTheme below)
            await DB.deleteAsset('custom_font_data');
            applyCustomFont(customFont);
        } else {
            // Reset
            await DB.deleteAsset('custom_font_data');
            applyCustomFont(undefined);
        }
    }

    // Save lightweight settings to LocalStorage (strip data URIs)
    const lsTheme = { ...newTheme };
    if (lsTheme.wallpaper && lsTheme.wallpaper.startsWith('data:')) lsTheme.wallpaper = '';
    // Lock-screen wallpaper data URI lives in IndexedDB (see above) — never let it
    // into LocalStorage, or a big image blows the os_theme quota and the whole theme
    // (incl. the desktop wallpaper pointer) silently fails to persist. Done
    // unconditionally so a value carried over from an older session is stripped too.
    if (lsTheme.lockScreenStyle?.wallpaper && lsTheme.lockScreenStyle.wallpaper.startsWith('data:')) {
        lsTheme.lockScreenStyle = { ...lsTheme.lockScreenStyle, wallpaper: '' };
    }
    // Banned legacy field — never persist.
    lsTheme.launcherWidgetImage = undefined;
    // Strip data URIs and deprecated slots from widgets for LS
    if (lsTheme.launcherWidgets) {
        const cleanWidgets: Record<string, string> = {};
        for (const [k, v] of Object.entries(lsTheme.launcherWidgets)) {
            if (k === 'bl' || k === 'br') continue;
            cleanWidgets[k] = (v && v.startsWith('data:')) ? '' : v;
        }
        lsTheme.launcherWidgets = cleanWidgets;
    }

    // Strip data URIs from desktop decorations for LS
    if (lsTheme.desktopDecorations) {
        lsTheme.desktopDecorations = lsTheme.desktopDecorations.map(d => ({
            ...d,
            content: (d.content && d.content.startsWith('data:') && d.type === 'image') ? '' : d.content
        }));
    }

    // Clear data URI font from LS, keep URL font
    if (lsTheme.customFont && lsTheme.customFont.startsWith('data:')) lsTheme.customFont = '';

    try {
        localStorage.setItem('os_theme', JSON.stringify(lsTheme));
    } catch (e) {
        // Quota/serialization failure: large blobs (wallpapers, fonts) already live in
        // IndexedDB, so the wallpapers still survive a reload even if these lightweight
        // settings can't be written this time. Don't let it throw unhandled.
        console.error('Failed to persist os_theme to LocalStorage', e);
    }
  };
  const updateApiConfig = (updates: Partial<APIConfig>) => { const newConfig = normalizeMainApiConfig({ ...apiConfig, ...updates }); setApiConfig(newConfig); localStorage.setItem('os_api_config', JSON.stringify(newConfig)); };
  const updateAuxApiConfig = (updates: Partial<AuxApiConfig>) => { const newConfig = { ...auxApiConfig, ...updates }; setAuxApiConfig(newConfig); localStorage.setItem('os_aux_api_config', JSON.stringify(newConfig)); };
  const updateRealtimeConfig = (updates: Partial<RealtimeConfig>) => { const newConfig = { ...realtimeConfig, ...updates }; setRealtimeConfig(newConfig); localStorage.setItem('os_realtime_config', JSON.stringify(newConfig)); };

  // Cloud Backup functions
  const updateCloudBackupConfig = (updates: Partial<CloudBackupConfig>) => {
      const newConfig = { ...cloudBackupConfig, ...updates };
      setCloudBackupConfig(newConfig);
      localStorage.setItem('os_cloud_backup_config', JSON.stringify(newConfig));
  };

  // Backup provider router — picks the right client module based on
  // cloudBackupConfig.provider ('github' or 'webdav', defaulting to webdav
  // for back-compat with users who configured before the GitHub option).
  const loadBackupProvider = async () => {
      if (cloudBackupConfig.provider === 'github') {
          return await import('../utils/githubClient');
      }
      return await import('../utils/webdavClient');
  };

  const cloudBackupToWebDAV = async (mode: 'text_only' | 'media_only' | 'full') => {
      const { uploadBackup, cleanupOldBackups } = await loadBackupProvider();
      try {
          setSysOperation({ status: 'processing', message: '正在打包备份数据...', progress: 0 });
          const blob = await exportSystem(mode);

          setSysOperation({ status: 'processing', message: '正在上传到云端...', progress: 50 });
          const filename = `Moro_Backup_${mode}_${Date.now()}.zip`;
          const result = await uploadBackup(cloudBackupConfig, blob, filename, (pct) => {
              setSysOperation(prev => ({ ...prev, message: `上传中 ${pct}%...`, progress: 50 + pct * 0.45 }));
          });

          if (!result.ok) {
              throw new Error(result.message);
          }

          // Update last backup time
          updateCloudBackupConfig({ lastBackupTime: Date.now(), lastBackupSize: blob.size });

          // Cleanup old backups (keep latest 5)
          await cleanupOldBackups(cloudBackupConfig, 5).catch(() => {});

          setSysOperation({ status: 'idle', message: '', progress: 100 });
          addToast('云端备份完成', 'success');
      } catch (e: any) {
          setSysOperation({ status: 'idle', message: '', progress: 0 });
          addToast(`云端备份失败: ${e.message}`, 'error');
          throw e;
      }
  };

  const cloudRestoreFromWebDAV = async (file: CloudBackupFile) => {
      const { downloadBackup } = await loadBackupProvider();
      try {
          setSysOperation({ status: 'processing', message: '正在从云端下载...', progress: 0 });
          const blob = await downloadBackup(cloudBackupConfig, file, (pct) => {
              setSysOperation(prev => ({ ...prev, message: `下载中 ${pct}%...`, progress: pct * 0.5 }));
          });

          if (!blob) throw new Error('下载失败');

          setSysOperation({ status: 'processing', message: '正在恢复数据...', progress: 50 });
          const zipFile = new File([blob], file.name, { type: 'application/zip' });
          await importSystem(zipFile);
      } catch (e: any) {
          setSysOperation({ status: 'idle', message: '', progress: 0 });
          addToast(`云端恢复失败: ${e.message}`, 'error');
          throw e;
      }
  };

  const listCloudBackups = async (): Promise<CloudBackupFile[]> => {
      const { listBackups } = await loadBackupProvider();
      return listBackups(cloudBackupConfig);
  };

  const updateMemoryPalaceConfig = (updates: Partial<MemoryPalaceGlobalConfig>) => {
    const newConfig: MemoryPalaceGlobalConfig = {};
    setMemoryPalaceConfig(newConfig);
    localStorage.removeItem('os_memory_palace_config');
  };

  // 日程 API / 心情 API 同步到所有角色：API 字段（baseUrl/apiKey/model）所有角色共用，
  // 各角色自身的心情 buff enabled 标志保持不变。
  // 注意：与文具盒全局副 API 独立；日程 API 覆盖今日日程生成 / 协调，心情 API 覆盖心情 buff。
  const syncScheduleMoodApisToAllCharacters = (apis: { scheduleApi?: ScheduleMoodApiConfig; moodApi?: ScheduleMoodApiConfig }) => {
    setCharacters(prev => {
      const updated = prev.map(c => {
        const prevEmotion = c.emotionConfig;
        const nextEmotion = {
          enabled: prevEmotion?.enabled !== false,
          ...(apis.scheduleApi ? { scheduleApi: apis.scheduleApi } : {}),
          ...(apis.moodApi ? { moodApi: apis.moodApi } : {}),
        };
        const next = normalizeCharacterDefaults({ ...c, emotionConfig: nextEmotion });
        DB.saveCharacter(next);
        return next;
      });
      return updated;
    });
  };
  const saveModels = (models: string[]) => { setAvailableModels(models); localStorage.setItem('os_available_models', JSON.stringify(models)); };
  const addApiPreset = (name: string, config: APIConfig) => { setApiPresets(prev => { const next = [...prev, { id: Date.now().toString(), name, config: normalizeApiPresetConfig(config) }]; localStorage.setItem('os_api_presets', JSON.stringify(next)); return next; }); };
  const removeApiPreset = (id: string) => { setApiPresets(prev => { const next = prev.filter(p => p.id !== id); localStorage.setItem('os_api_presets', JSON.stringify(next)); return next; }); };
  const savePresets = (presets: ApiPreset[]) => { const next = normalizeApiPresets(presets); setApiPresets(next); localStorage.setItem('os_api_presets', JSON.stringify(next)); };
  const addCharacter = async () => {
    const name = 'New Character';
    // 默认开启心情 buff 独立开关；真正触发还要过 isEmotionBuffFeatureOn，
    // 作息没开时不会额外跑聊天后的情绪分析。
    // 长期记忆默认值统一交给 normalizeCharacterDefaults / Cognitive Flow 处理；
    // 用户显式关闭过的角色仍会保持关闭。
    const newCharId = createCharacterId('char');
    const newChar: CharacterProfile = normalizeCharacterDefaults({
      id: newCharId,
      modelId: newCharId,
      name,
      avatar: generateAvatar(name),
      description: '点击编辑设定...',
      systemPrompt: '',
      memories: [],
      contextLimit: 500,
      emotionConfig: { enabled: true },
      // 新建即视为已加入「往来」：无需再去名册「添加好友」就能在往来直接开聊
      addedToChat: true,
    });
    setCharacters(prev => [...prev, newChar]);
    setActiveCharacterId(newChar.id);
    await DB.saveCharacter(newChar);
  };
  // 角色卡导入专用：以前的实现是 DB.saveCharacter + addCharacter()「naive 刷新」+
  // window.location.reload() —— 既会整页重启，又会顺手创建一个空白 New Character。
  // 现在直接把完整角色写进 state + DB，导入即生效，不再刷新。
  const importCharacter = async (char: CharacterProfile, options?: { preserveId?: boolean }) => {
    // 导入即视为已加入「往来」：强制置 true，导入后无需「添加好友」即可在往来直接开聊
    // （不沿用卡里可能带的 addedToChat:false，保证任何导入都直接出现在往来）
    const importedId = options?.preserveId && char.id ? char.id : createCharacterId('import');
    const withChat: CharacterProfile = normalizeCharacterDefaults({
      ...char,
      id: importedId,
      modelId: importedId,
      addedToChat: true,
    } as CharacterProfile);
    setCharacters(prev => [...prev.filter(c => c.id !== withChat.id), withChat]);
    setActiveCharacterId(withChat.id);
    await DB.saveCharacter(withChat);
  };
  // DB 写入必须可 await：之前在 setCharacters updater 里 fire-and-forget 调 DB.saveCharacter，
  // 用户在 IDB 事务完成前关页/切页时更新会丢（角色资料"微信号/地区/签名"反复重新生成的根因）。
  // 仍在 updater 里合并（保证拿到最新 prev），把合并结果递出来 await 落库。
  const updateCharacter = async (id: string, updates: Partial<CharacterProfile>) => {
    const target = await new Promise<CharacterProfile | null>(resolve => {
      setCharacters(prev => {
        const updated = prev.map(c => {
          if (c.id !== id) return c;
          const merged = mergeCharacterProfileUpdate(c, updates);
          return normalizeCharacterDefaults(merged);
        });
        resolve(updated.find(c => c.id === id) || null);
        return updated;
      });
    });
    if (target) {
      try { await DB.saveCharacter(target); } catch (e) { console.warn('[updateCharacter] DB.saveCharacter failed:', e); }
    }
  };
  const deleteCharacter = async (id: string) => { setCharacters(prev => { const remaining = prev.filter(c => c.id !== id); if (remaining.length > 0 && activeCharacterId === id) { setActiveCharacterId(remaining[0].id); } return remaining; }); await DB.deleteCharacter(id); };
  
  // Group Methods
  const createGroup = async (name: string, members: string[], opts?: { ownerId?: string; adminIds?: string[]; ambientSocialSource?: GroupProfile['ambientSocialSource'] }): Promise<GroupProfile> => {
      const newGroup: GroupProfile = {
          id: `group-${Date.now()}`,
          name,
          members,
          avatar: generateAvatar(name),
          createdAt: Date.now(),
          ownerId: opts?.ownerId || 'user',
          ...(opts?.adminIds && opts.adminIds.length > 0 ? { adminIds: opts.adminIds } : {}),
          ...(opts?.ambientSocialSource ? { ambientSocialSource: opts.ambientSocialSource } : {}),
      };
      await DB.saveGroup(newGroup);
      setGroups(prev => [...prev, newGroup]);
      return newGroup;
  };

  const deleteGroup = async (id: string) => {
      await DB.deleteGroup(id);
      setGroups(prev => prev.filter(g => g.id !== id));
  };

  const updateGroup = async (id: string, updates: Partial<GroupProfile>): Promise<GroupProfile | null> => {
      const target = await new Promise<GroupProfile | null>(resolve => {
          setGroups(prev => {
              const current = prev.find(g => g.id === id);
              if (!current) {
                  resolve(null);
                  return prev;
              }
              const updated = mergeGroupProfileUpdate(current, updates);
              resolve(updated);
              return prev.map(g => g.id === id ? updated : g);
          });
      });
      if (!target) return null;
      await DB.saveGroup(target);
      return target;
  };

  // Worldbook Methods
  const addWorldbook = async (wb: Worldbook) => {
      setWorldbooks(prev => [...prev, wb]);
      await DB.saveWorldbook(wb);
  };

  const setWorldbookGroupEnabled = (category: string, enabled: boolean) => {
      setWorldbookGroupToggles(prev => {
          const next = { ...prev };
          if (enabled) delete next[category];  // 开 = 默认态，不留冗余键
          else next[category] = false;
          saveGroupTogglesToStorage(next);
          return next;
      });
  };

  const setWorldbookGroupScope = (category: string, scope: WorldbookGroupScope) => {
      setWorldbookGroupScopes(prev => {
          const next = { ...prev };
          if (scope === 'global') next[category] = 'global';
          else delete next[category]; // 局部 = 默认态，不留冗余键
          saveGroupScopesToStorage(next);
          return next;
      });
  };

  const setWorldbookGroupSettings = (category: string, settings: WorldbookGroupSettings) => {
      const normalizedCategory = category || DEFAULT_WB_CATEGORY;
      setWorldbookGroupSettingsState(prev => {
          const next = { ...prev };
          const clean: WorldbookGroupSettings = {};
          if (typeof settings.recursiveScanning === 'boolean') clean.recursiveScanning = settings.recursiveScanning;
          if (typeof settings.tokenBudget === 'number' && settings.tokenBudget >= 0) clean.tokenBudget = Math.floor(settings.tokenBudget);
          if (typeof settings.maxRecursionSteps === 'number' && settings.maxRecursionSteps >= 0) clean.maxRecursionSteps = Math.floor(settings.maxRecursionSteps);
          if (Object.keys(clean).length > 0) next[normalizedCategory] = clean;
          else delete next[normalizedCategory];
          saveGroupSettingsToStorage(next);
          return next;
      });
  };

  // 世界书注册表镜像：让 ContextBuilder / chatRequestPayload 这些非 React 模块
  // 能读到最新的全量世界书、整书开关与整书作用域
  useEffect(() => {
      WorldbookRuntime.sync(worldbooks, worldbookGroupToggles, worldbookGroupScopes, worldbookGroupSettings);
  }, [worldbooks, worldbookGroupToggles, worldbookGroupScopes, worldbookGroupSettings]);

  const updateWorldbook = async (id: string, updates: Partial<Worldbook>) => {
      // Compute the updated entity up-front. Relying on a closure side-effect
      // inside a setState updater is unsafe — React calls updaters lazily
      // during reconciliation, so the closure variable would still be
      // undefined when the synchronous code below runs, silently skipping
      // the DB persist + character cache sync (causing the saved content
      // to revert on reload).
      const existing = worldbooks.find(wb => wb.id === id);
      if (!existing) return;
      const fullUpdatedWb: Worldbook = { ...existing, ...updates, updatedAt: Date.now() };

      // 1. Optimistic Update Local State
      setWorldbooks(prev => prev.map(wb => (wb.id === id ? fullUpdatedWb : wb)));

      // 2. Persist to DB
      await DB.saveWorldbook(fullUpdatedWb);

      // 3. AUTO-SYNC: Update Characters that have this book mounted
      // This ensures data redundancy is kept fresh
      const charsToSync = characters.filter(c => c.mountedWorldbooks?.some(m => m.id === id));

      if (charsToSync.length > 0) {
          const updatedChars = characters.map(char => {
              if (char.mountedWorldbooks?.some(m => m.id === id)) {
                  const newMounted = char.mountedWorldbooks.map(m =>
                      m.id === id
                          ? {
                              id: fullUpdatedWb.id,
                              title: fullUpdatedWb.title,
                              content: fullUpdatedWb.content,
                              category: fullUpdatedWb.category,
                              enabled: fullUpdatedWb.enabled,
                            }
                          : m
                  );
                  const newChar = normalizeCharacterDefaults({ ...char, mountedWorldbooks: newMounted });
                  DB.saveCharacter(newChar);
                  return newChar;
              }
              return char;
          });
          setCharacters(updatedChars);
          addToast(`已同步更新 ${charsToSync.length} 个相关角色的缓存`, 'info');
      }
  };

  const deleteWorldbook = async (id: string) => {
      setWorldbooks(prev => prev.filter(wb => wb.id !== id));
      await DB.deleteWorldbook(id);
      
      // Sync delete: Remove from characters
      const updatedChars = characters.map(char => {
          if (char.mountedWorldbooks?.some(m => m.id === id)) {
              const newMounted = char.mountedWorldbooks.filter(m => m.id !== id);
              const newChar = normalizeCharacterDefaults({ ...char, mountedWorldbooks: newMounted });
              DB.saveCharacter(newChar);
              return newChar;
          }
          return char;
      });
      setCharacters(updatedChars);
      addToast('世界书已删除 (同步移除角色挂载)', 'success');
  };

  const deleteWorldbookCategory = async (category: string) => {
      const normalizedCategory = category || DEFAULT_WB_CATEGORY;
      const deletedBooks = worldbooks.filter(wb => (wb.category || DEFAULT_WB_CATEGORY) === normalizedCategory);
      if (deletedBooks.length === 0) return;

      const deletedIds = new Set(deletedBooks.map(wb => wb.id));
      setWorldbooks(prev => prev.filter(wb => (wb.category || DEFAULT_WB_CATEGORY) !== normalizedCategory));
      await Promise.all(deletedBooks.map(wb => DB.deleteWorldbook(wb.id)));

      setWorldbookGroupToggles(prev => {
          const next = { ...prev };
          delete next[normalizedCategory];
          saveGroupTogglesToStorage(next);
          return next;
      });

      setWorldbookGroupScopes(prev => {
          const next = { ...prev };
          delete next[normalizedCategory];
          saveGroupScopesToStorage(next);
          return next;
      });

      setWorldbookGroupSettingsState(prev => {
          const next = { ...prev };
          delete next[normalizedCategory];
          saveGroupSettingsToStorage(next);
          return next;
      });

      const updatedChars = characters.map(char => {
          const mounted = char.mountedWorldbooks || [];
          const newMounted = mounted.filter(m => {
              const mountedCategory = m.category || DEFAULT_WB_CATEGORY;
              return mountedCategory !== normalizedCategory && !deletedIds.has(m.id);
          });
          if (newMounted.length !== mounted.length) {
              const newChar = normalizeCharacterDefaults({ ...char, mountedWorldbooks: newMounted });
              DB.saveCharacter(newChar);
              return newChar;
          }
          return char;
      });
      setCharacters(updatedChars);
      addToast(`已删除「${normalizedCategory}」及其中 ${deletedBooks.length} 条世界书条目`, 'success');
  };

  // Novel Methods (New)
  const addNovel = async (novel: NovelBook) => {
      setNovels(prev => [novel, ...prev]);
      await DB.saveNovel(novel);
  };

  const updateNovel = async (id: string, updates: Partial<NovelBook>) => {
      setNovels(prev => {
          const next = prev.map(n => n.id === id ? { ...n, ...updates, lastActiveAt: Date.now() } : n);
          const target = next.find(n => n.id === id);
          if (target) DB.saveNovel(target);
          return next;
      });
  };

  const deleteNovel = async (id: string) => {
      setNovels(prev => prev.filter(n => n.id !== id));
      await DB.deleteNovel(id);
  };

  // Song Methods
  const addSong = async (song: SongSheet) => {
      setSongs(prev => [song, ...prev]);
      await DB.saveSong(song);
  };

  const updateSong = async (id: string, updates: Partial<SongSheet>) => {
      setSongs(prev => {
          const next = prev.map(s => s.id === id ? { ...s, ...updates, lastActiveAt: Date.now() } : s);
          const target = next.find(s => s.id === id);
          if (target) DB.saveSong(target);
          return next;
      });
  };

  const deleteSong = async (id: string) => {
      setSongs(prev => prev.filter(s => s.id !== id));
      await DB.deleteSong(id);
  };

  const updateUserProfile = async (updates: Partial<UserProfile>) => { setUserProfile(prev => { const next = { ...prev, ...updates }; DB.saveUserProfile(next); return next; }); };

  // 钱包余额增减：用函数式更新避免并发覆盖（店铺营业 + 聊天转账可能几乎同时发生）。
  // userBalanceRef 跟随已提交余额，保证同一 tick 内多次调用累加一致；函数式 setState 才是真值来源。
  const userBalanceRef = useRef(0);
  useEffect(() => { userBalanceRef.current = userProfile.balance || 0; }, [userProfile.balance]);
  const adjustUserBalance = (delta: number, meta: AdjustBalanceMeta = {}): number => {
    const next = Math.max(0, Math.round((userBalanceRef.current + delta) * 100) / 100);
    userBalanceRef.current = next;
    setUserProfile(prev => {
      const nb = Math.max(0, Math.round(((prev.balance || 0) + delta) * 100) / 100);
      const np = { ...prev, balance: nb };
      DB.saveUserProfile(np);
      return np;
    });
    const tx = createAutoBankTransaction(delta, next, meta);
    if (tx) {
      void DB.saveTransaction(tx);
      window.dispatchEvent(new CustomEvent('moro-bank-transaction-added', { detail: tx }));
    }
    return next;
  };
  const addCustomTheme = async (theme: ChatTheme) => { setCustomThemes(prev => { const exists = prev.find(t => t.id === theme.id); if (exists) return prev.map(t => t.id === theme.id ? theme : t); return [...prev, theme]; }); await DB.saveTheme(theme); };
  const removeCustomTheme = async (id: string) => { setCustomThemes(prev => prev.filter(t => t.id !== id)); await DB.deleteTheme(id); };
  const setCustomIcon = async (appId: string, iconUrl: string | undefined) => { setCustomIcons(prev => { const next = { ...prev }; if (iconUrl) next[appId] = iconUrl; else delete next[appId]; return next; }); if (iconUrl) { await DB.saveAsset(`icon_${appId}`, iconUrl); } else { await DB.deleteAsset(`icon_${appId}`); } };
  const addToast = (message: string, type: Toast['type'] = 'info') => { const id = Date.now().toString(); setToasts(prev => [...prev, { id, message, type }]); setTimeout(() => { setToasts(prev => prev.filter(t => t.id !== id)); }, 3000); };
  const showError = (title: string, details: string) => {
    if (errorDialogTimerRef.current) { clearTimeout(errorDialogTimerRef.current); errorDialogTimerRef.current = null; }
    setErrorDialog({ title, details });
    // 自动消失：报错弹窗不再长时间停驻（仍保留「复制」按钮，这段时间足够手机用户复制原文）。
    errorDialogTimerRef.current = setTimeout(() => { setErrorDialog(null); errorDialogTimerRef.current = null; }, 12000);
  };
  const dismissError = () => {
    if (errorDialogTimerRef.current) { clearTimeout(errorDialogTimerRef.current); errorDialogTimerRef.current = null; }
    setErrorDialog(null);
  };

  // --- APPEARANCE PRESETS ---
  const saveAppearancePreset = async (name: string) => {
      const preset: AppearancePreset = {
          id: `ap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          name,
          createdAt: Date.now(),
          theme: { ...theme },
          customIcons: Object.keys(customIcons).length > 0 ? { ...customIcons } : undefined,
          chatThemes: customThemes.length > 0 ? [...customThemes] : undefined,
      };
      setAppearancePresets(prev => [preset, ...prev]);
      await DB.saveAsset(`appearance_preset_${preset.id}`, JSON.stringify(preset));
      addToast(`外观预设「${name}」已保存`, 'success');
  };

  const applyAppearancePreset = async (id: string) => {
      const preset = appearancePresets.find(p => p.id === id);
      if (!preset) return;
      // Strip banned legacy widget data from preset before applying — old beautification packs
      // may still carry launcherWidgetImage / bl / br, and they must never reach the UI.
      const sanitizedPresetTheme: any = { ...preset.theme, launcherWidgetImage: undefined };
      if (sanitizedPresetTheme.launcherWidgets) {
          const w = { ...sanitizedPresetTheme.launcherWidgets } as Record<string, string>;
          delete w['bl'];
          delete w['br'];
          sanitizedPresetTheme.launcherWidgets = Object.keys(w).length > 0 ? w : undefined;
      }
      // Apply theme
      setTheme(sanitizedPresetTheme);
      // 写 LS 前必须剥 data URI，否则 base64 壁纸会撑爆 5MB quota
      const lsTheme: any = { ...sanitizedPresetTheme };
      if (lsTheme.wallpaper && typeof lsTheme.wallpaper === 'string' && lsTheme.wallpaper.startsWith('data:')) lsTheme.wallpaper = '';
      lsTheme.launcherWidgetImage = undefined;
      if (lsTheme.launcherWidgets) {
          const cleanWidgets: Record<string, string> = {};
          for (const [k, v] of Object.entries(lsTheme.launcherWidgets as Record<string, string>)) {
              if (k === 'bl' || k === 'br') continue;
              cleanWidgets[k] = (v && v.startsWith('data:')) ? '' : v;
          }
          lsTheme.launcherWidgets = cleanWidgets;
      }
      if (lsTheme.desktopDecorations) {
          lsTheme.desktopDecorations = lsTheme.desktopDecorations.map((d: any) => ({
              ...d,
              content: (d.content && typeof d.content === 'string' && d.content.startsWith('data:') && d.type === 'image') ? '' : d.content,
          }));
      }
      if (lsTheme.customFont && typeof lsTheme.customFont === 'string' && lsTheme.customFont.startsWith('data:')) lsTheme.customFont = '';
      try {
          localStorage.setItem('os_theme', JSON.stringify(lsTheme));
      } catch (e) {
          console.warn('[applyAppearancePreset] localStorage 写入失败，已跳过', e);
      }
      applyCustomFont(preset.theme.customFont);
      // Apply custom icons if present
      if (preset.customIcons) {
          setCustomIcons(preset.customIcons);
          for (const [appId, iconUrl] of Object.entries(preset.customIcons)) {
              await DB.saveAsset(`icon_${appId}`, iconUrl);
          }
      }
      // Apply chat themes if present
      if (preset.chatThemes) {
          for (const ct of preset.chatThemes) {
              await DB.saveTheme(ct);
          }
          setCustomThemes(prev => {
              const merged = [...prev];
              for (const ct of preset.chatThemes!) {
                  const idx = merged.findIndex(t => t.id === ct.id);
                  if (idx >= 0) merged[idx] = ct;
                  else merged.push(ct);
              }
              return merged;
          });
      }
      // Save wallpaper/widgets/decos to assets
      if (preset.theme.wallpaper && preset.theme.wallpaper.startsWith('data:')) {
          await DB.saveAsset('wallpaper', preset.theme.wallpaper);
      }
      if (preset.theme.desktopDecorations) {
          for (const d of preset.theme.desktopDecorations) {
              if (d.type === 'image' && d.content) {
                  await DB.saveAsset(`deco_${d.id}`, d.content);
              }
          }
      }
      addToast(`已应用预设「${preset.name}」`, 'success');
  };

  const deleteAppearancePreset = async (id: string) => {
      setAppearancePresets(prev => prev.filter(p => p.id !== id));
      await DB.deleteAsset(`appearance_preset_${id}`);
      addToast('预设已删除', 'info');
  };

  // 一键还原外观：把主题、图标、壁纸、小组件、装饰、字体全部回到出厂状态。
  // 用户在不同版本/不同备份之间反复导入时，customIcons 与 IndexedDB 里的 widget_/deco_/icon_
  // 残留经常导致图标错乱，这里直接整体清空再写回 default。
  // 已保存的外观预设不动，用户随时还能切回去。
  const resetAppearance = async () => {
      try {
          setTheme(defaultTheme);
          applyCustomFont(undefined);

          const iconAppIds = Object.keys(customIcons);
          setCustomIcons({});
          for (const appId of iconAppIds) {
              await DB.deleteAsset(`icon_${appId}`);
          }

          const allAssets = await DB.getAllAssets();
          for (const asset of allAssets) {
              const id = asset.id;
              if (
                  id === 'wallpaper' ||
                  id === 'lock_wallpaper' ||
                  id === 'launcherWidgetImage' ||
                  id === 'custom_font_data' ||
                  id.startsWith('widget_') ||
                  id.startsWith('deco_') ||
                  id.startsWith('icon_')
              ) {
                  await DB.deleteAsset(id);
              }
          }

          try {
              localStorage.setItem('os_theme', JSON.stringify(defaultTheme));
          } catch (e) {
              console.warn('[resetAppearance] localStorage 写入失败', e);
          }

          addToast('外观已还原为初始状态', 'success');
      } catch (e: any) {
          addToast(e?.message || '还原失败', 'error');
      }
  };

  const renameAppearancePreset = async (id: string, name: string) => {
      setAppearancePresets(prev => prev.map(p => {
          if (p.id !== id) return p;
          const updated = { ...p, name };
          DB.saveAsset(`appearance_preset_${id}`, JSON.stringify(updated));
          return updated;
      }));
      addToast('预设已重命名', 'success');
  };

  const exportAppearancePreset = async (id: string): Promise<Blob> => {
      const preset = appearancePresets.find(p => p.id === id);
      if (!preset) throw new Error('预设不存在');
      // 保留原始壁纸画质，把整个预设 JSON 塞进 zip 包压体积
      const data = JSON.stringify({ type: 'moro_appearance_preset', version: 1, ...preset }, null, 2);
      const JSZip = await loadJSZip();
      const zip = new JSZip();
      (zip as any).file('preset.json', data);
      return (zip as any).generateAsync(
          { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 9 } },
      );
  };

  const importAppearancePreset = async (file: File): Promise<void> => {
      // 兼容两种格式：新版 .zip（内含 preset.json）/ 旧版 .json 明文
      let raw: any;
      const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
      const isZip = head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05 || head[2] === 0x07);
      if (isZip) {
          const JSZip = await loadJSZip();
          const zip = await JSZip.loadAsync(file);
          const entry = zip.file('preset.json') || Object.values((zip as any).files || {}).find((f: any) => !f.dir && /\.json$/i.test(f.name));
          if (!entry) throw new Error('压缩包内未找到 preset.json');
          const text = await (entry as any).async('string');
          raw = JSON.parse(text);
      } else {
          const text = await file.text();
          raw = JSON.parse(text);
      }
      if (raw.type !== 'moro_appearance_preset') throw new Error('无效的外观预设文件');
      const preset: AppearancePreset = {
          id: `ap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          name: raw.name || '导入的预设',
          createdAt: Date.now(),
          theme: raw.theme,
          customIcons: raw.customIcons,
          chatThemes: raw.chatThemes,
          chatLayout: raw.chatLayout,
      };
      setAppearancePresets(prev => [preset, ...prev]);
      await DB.saveAsset(`appearance_preset_${preset.id}`, JSON.stringify(preset));
      addToast(`已导入预设「${preset.name}」`, 'success');
  };

  // --- MODIFIED EXPORT SYSTEM WITH SEPARATED ASSETS ZIP ---
  const exportSystem = async (mode: 'text_only' | 'media_only' | 'full'): Promise<Blob> => {
      try {
          setSysOperation({ status: 'processing', message: '正在初始化打包引擎...', progress: 0 });
          
          const JSZip = await loadJSZip();
          const zip = new JSZip();
          const assetsFolder = zip.folder("assets");
          let assetCount = 0;

          // Dedup table — same base64 payload reused across stores (角色头像在
          // 多个 chat / handbook / room 里被嵌入) gets stored exactly once. Key
          // is the base64 string itself, value is the assets/* path. For a
          // heavy user with 50 chats sharing a 200KB avatar this trims ~10MB.
          const assetDedupMap = new Map<string, string>();

          // Strip Base64 Images (Recursive) - Used for Text Only Mode
          const stripBase64 = (obj: any): any => {
              if (typeof obj === 'string') {
                  if (obj.startsWith('data:image')) return '';
                  return obj;
              }
              if (Array.isArray(obj)) {
                  return obj.map(item => stripBase64(item));
              }
              if (obj !== null && typeof obj === 'object') {
                  const newObj: any = {};
                  for (const key in obj) {
                      if (Object.prototype.hasOwnProperty.call(obj, key)) {
                          newObj[key] = stripBase64(obj[key]);
                      }
                  }
                  return newObj;
              }
              return obj;
          };

          // Extract Images to ZIP (Recursive) - Used for Media/Theme Mode
          const processObject = (obj: any): any => {
              if (obj === null || typeof obj !== 'object') return obj;
              
              if (Array.isArray(obj)) {
                  return obj.map(item => processObject(item));
              }

              const newObj: any = {};
              for (const key in obj) {
                  if (Object.prototype.hasOwnProperty.call(obj, key)) {
                      let value = obj[key];
                      if (typeof value === 'string' && value.startsWith('data:image/')) {
                          try {
                              const cached = assetDedupMap.get(value);
                              if (cached) {
                                  value = cached;
                              } else {
                                  const extMatch = value.match(/data:image\/([a-zA-Z0-9]+);base64,/);
                                  if (extMatch) {
                                      const ext = extMatch[1] === 'jpeg' ? 'jpg' : extMatch[1];
                                      const filename = `asset_${Date.now()}_${assetCount++}.${ext}`;
                                      const base64Data = value.split(',')[1];
                                      assetsFolder?.file(filename, base64Data, { base64: true });
                                      const path = `assets/${filename}`;
                                      assetDedupMap.set(value, path);
                                      value = path;
                                  }
                              }
                          } catch (e) {
                              console.warn("Failed to process asset", e);
                          }
                      } else {
                          value = processObject(value);
                      }
                      newObj[key] = value;
                  }
              }
              return newObj;
          };

          const transformLocalStorageSnapshotValues = (
              snapshot: Record<string, string> | undefined,
              transform: (value: any) => any
          ): Record<string, string> | undefined => {
              if (!snapshot) return undefined;
              const next: Record<string, string> = {};
              for (const [key, value] of Object.entries(snapshot)) {
                  try {
                      next[key] = JSON.stringify(transform(JSON.parse(value)));
                  } catch {
                      const wrapped = transform({ value });
                      next[key] = typeof wrapped?.value === 'string' ? wrapped.value : value;
                  }
              }
              return next;
          };

          const isRedundantManagedAssetId = (id: string) => (
              id === 'wallpaper' ||
              id === 'lock_wallpaper' ||
              id === 'launcherWidgetImage' ||
              id === 'custom_font_data' ||
              id === 'spark_social_profile' ||
              id === 'spark_user_bg' ||
              id === 'room_custom_assets_list' ||
              id.startsWith('widget_') ||
              id.startsWith('deco_') ||
              id.startsWith('icon_') ||
              id.startsWith('appearance_preset_')
          );

          // 1. Define Stores to Process based on Mode
          let storesToProcess: string[] = [];
          const allStores = [
              'characters', 'messages', 'themes', 'emojis', 'emoji_categories', 'assets', 'gallery',
              'user_profile', 'diaries', 'tasks', 'anniversaries', 'room_todos',
              'room_notes', 'groups', 'journal_stickers', 'social_posts', 'courses', 'games', 'worldbooks', 'llm_presets', 'personas', 'novels',
              'coview_media', 'coview_books', 'coview_sessions', 'coview_messages', 'songs',
              'bank_transactions', 'bank_data',
              'xhs_activities', 'xhs_stock',
              'quizzes', 'guidebook', 'takeout_orders', 'scheduled_messages', 'life_sim',
              'handbook', 'trackers', 'tracker_entries', 'hotnews_snapshots',
              'desktop_pet',
              'memory_nodes', 'memory_links', 'topic_boxes', 'anticipations', 'event_boxes',
              'daily_schedule', 'memory_batches',
              'pixel_home_assets', 'pixel_home_layouts',
              // 「页外」虚拟世界各房间 store —— 早期导出清单漏了，导致备份不含房间数据
              'vr_novels', 'vr_annotations', 'cc_custom_parts', 'vr_music', 'vr_guestbook', 'vr_letters', 'vr_settings'
          ];
          const actualStores = await DB.getObjectStoreNames().catch(() => []);
          const completeStores = actualStores.length > 0 ? actualStores : allStores;

          if (mode === 'full') {
              storesToProcess = completeStores; // Include everything
          } else if (mode === 'text_only') {
              storesToProcess = completeStores.filter(s => s !== 'assets'); // Exclude raw assets store
          } else if (mode === 'media_only') {
              // media_only now includes themes/assets for complete media backup
              storesToProcess = ['gallery', 'emojis', 'emoji_categories', 'journal_stickers', 'user_profile', 'characters', 'messages', 'themes', 'assets', 'bank_data',
                  'pixel_home_assets', 'pixel_home_layouts', 'daily_schedule', 'cc_custom_parts'];
          }

          // Fetch Social App & Room Assets (Optional, depends on mode)
          const sparkUserBg = await DB.getAsset('spark_user_bg');
          const sparkSocialProfile = await DB.getAsset('spark_social_profile');
          const roomCustomAssets = await DB.getAsset('room_custom_assets_list');

          const backupData: Partial<FullBackupData> = {
              timestamp: Date.now(),
              version: 3,
              apiConfig: (mode === 'text_only' || mode === 'full') ? apiConfig : undefined,
              apiPresets: (mode === 'text_only' || mode === 'full') ? apiPresets : undefined,
              availableModels: (mode === 'text_only' || mode === 'full') ? availableModels : undefined,
              realtimeConfig: (mode === 'text_only' || mode === 'full') ? realtimeConfig : undefined,
              theme: theme, // Include theme in all modes (text/media)
              customIcons: (mode === 'text_only' || mode === 'media_only' || mode === 'full')
                  ? { ...customIcons }
                  : undefined,
              appearancePresets: (mode === 'text_only' || mode === 'media_only' || mode === 'full')
                  ? appearancePresets.map(p => ({ ...p }))
                  : undefined,
              
              socialAppData: (mode === 'text_only' || mode === 'media_only' || mode === 'full') ? {
                  charHandles: JSON.parse(localStorage.getItem('spark_char_handles') || '{}'),
                  userProfile: sparkSocialProfile ? JSON.parse(sparkSocialProfile) : undefined,
                  userId: localStorage.getItem('spark_user_id') || undefined,
                  userBg: sparkUserBg || undefined
              } : undefined,
              
              roomCustomAssets: (mode === 'text_only' || mode === 'media_only' || mode === 'full') ? (roomCustomAssets ? JSON.parse(roomCustomAssets) : []) : undefined,
              mediaAssets: [], // Initialize mediaAssets array

              // Study Room settings (localStorage)
              studyApiConfig: (mode === 'text_only' || mode === 'full') ? (() => { try { const s = localStorage.getItem('study_api_config'); return s ? JSON.parse(s) : undefined; } catch { return undefined; } })() : undefined,
              studyTutorPresets: (mode === 'text_only' || mode === 'full') ? (() => { try { const s = localStorage.getItem('study_tutor_presets'); return s ? JSON.parse(s) : undefined; } catch { return undefined; } })() : undefined,

              // 云端配置
              cloudBackupConfig: (mode === 'text_only' || mode === 'full') ? (() => { try { const s = localStorage.getItem('os_cloud_backup_config'); return s ? JSON.parse(s) : undefined; } catch { return undefined; } })() : undefined,

              // Instant Push
              instantPushConfig: (mode === 'text_only' || mode === 'full') ? (() => { try { const s = localStorage.getItem('instant_push_config_v1'); return s ? JSON.parse(s) : undefined; } catch { return undefined; } })() : undefined,
              pushVapid: (mode === 'text_only' || mode === 'full') ? (() => { try { const s = localStorage.getItem('push_vapid_v1'); return s ? JSON.parse(s) : undefined; } catch { return undefined; } })() : undefined,


              // 回忆标本馆 水位线
              memoryPalaceHighWaterMarks: (mode === 'text_only' || mode === 'full') ? (() => {
                  const hwm: Record<string, number> = {};
                  for (let i = 0; i < localStorage.length; i++) {
                      const key = localStorage.key(i);
                      if (key?.startsWith('mp_lastMsgId_')) {
                          const charId = key.replace('mp_lastMsgId_', '');
                          hwm[charId] = parseInt(localStorage.getItem(key) || '0', 10);
                      }
                  }
                  return Object.keys(hwm).length > 0 ? hwm : undefined;
              })() : undefined,

              // 回忆标本馆 每角色的 UI 标记（人格检测已跑过、首次归档 banner 已看过等）
              // 丢了会导致重弹一次人格确认 / 首次 banner，体验噪声但不丢数据，仍然应该备份
              memoryPalaceFlags: (mode === 'text_only' || mode === 'full') ? (() => {
                  const flags: Record<string, string> = {};
                  for (let i = 0; i < localStorage.length; i++) {
                      const key = localStorage.key(i);
                      if (!key) continue;
                      if (key.startsWith('mp_personality_tried_')
                          || key.startsWith('mp_first_archive_notice_')) {
                          flags[key] = localStorage.getItem(key) || '';
                      }
                  }
                  return Object.keys(flags).length > 0 ? flags : undefined;
              })() : undefined,

              // Chat 翻译 / 归档 / 润色相关设置
              chatTranslateSourceLang: (mode === 'text_only' || mode === 'full') ? (localStorage.getItem('chat_translate_source_lang') || undefined) : undefined,
              chatTranslateTargetLang: (mode === 'text_only' || mode === 'full') ? (localStorage.getItem('chat_translate_lang') || undefined) : undefined,
              chatTranslateEnabledByChar: (mode === 'text_only' || mode === 'full') ? (() => {
                  const map: Record<string, boolean> = {};
                  for (let i = 0; i < localStorage.length; i++) {
                      const key = localStorage.key(i);
                      if (!key || !key.startsWith('chat_translate_enabled_')) continue;
                      const charId = key.replace('chat_translate_enabled_', '');
                      map[charId] = localStorage.getItem(key) === 'true';
                  }
                  return Object.keys(map).length > 0 ? map : undefined;
              })() : undefined,
              chatTranslateSourceLangByChar: (mode === 'text_only' || mode === 'full') ? (() => {
                  const map: Record<string, string> = {};
                  for (let i = 0; i < localStorage.length; i++) {
                      const key = localStorage.key(i);
                      if (!key || !key.startsWith('chat_translate_source_lang_')) continue;
                      const charId = key.replace('chat_translate_source_lang_', '');
                      const value = localStorage.getItem(key);
                      if (charId && value) map[charId] = value;
                  }
                  return Object.keys(map).length > 0 ? map : undefined;
              })() : undefined,
              chatTranslateTargetLangByChar: (mode === 'text_only' || mode === 'full') ? (() => {
                  const map: Record<string, string> = {};
                  for (let i = 0; i < localStorage.length; i++) {
                      const key = localStorage.key(i);
                      if (!key || !key.startsWith('chat_translate_lang_')) continue;
                      const charId = key.replace('chat_translate_lang_', '');
                      const value = localStorage.getItem(key);
                      if (charId && value) map[charId] = value;
                  }
                  return Object.keys(map).length > 0 ? map : undefined;
              })() : undefined,
              chatArchivePrompts: (mode === 'text_only' || mode === 'full') ? (() => { try { const s = localStorage.getItem('chat_archive_prompts'); return s ? JSON.parse(s) : undefined; } catch { return undefined; } })() : undefined,
              chatActiveArchivePromptId: (mode === 'text_only' || mode === 'full') ? (localStorage.getItem('chat_active_archive_prompt_id') || undefined) : undefined,
              characterRefinePrompts: (mode === 'text_only' || mode === 'full') ? (() => { try { const s = localStorage.getItem('character_refine_prompts'); return s ? JSON.parse(s) : undefined; } catch { return undefined; } })() : undefined,
              characterActiveRefinePromptId: (mode === 'text_only' || mode === 'full') ? (localStorage.getItem('character_active_refine_prompt_id') || undefined) : undefined,

              // UI / 偏好
              scheduleAppTheme: (mode === 'text_only' || mode === 'full') ? (localStorage.getItem('almanac_promise_theme') || undefined) : undefined,
              handbookLifestreamDepth: (mode === 'text_only' || mode === 'full') ? (localStorage.getItem('handbook_lifestream_depth') || undefined) : undefined,
              groupchatContextLimit: (mode === 'text_only' || mode === 'full') ? (() => { const v = localStorage.getItem('groupchat_context_limit'); const n = v ? parseInt(v, 10) : NaN; return Number.isFinite(n) ? n : undefined; })() : undefined,
              browserConfig: (mode === 'text_only' || mode === 'full') ? (() => {
                  const braveKey = localStorage.getItem('browser_brave_key') || undefined;
                  const useReal = localStorage.getItem('browser_use_real_search');
                  const useRealSearch = useReal === null ? undefined : useReal === 'true';
                  if (!braveKey && useRealSearch === undefined) return undefined;
                  return { braveKey, useRealSearch };
              })() : undefined,
              bm25Mode: (mode === 'text_only' || mode === 'full') ? (localStorage.getItem('bm25_mode') || undefined) : undefined,
              lastActiveCharId: (mode === 'text_only' || mode === 'full') ? (localStorage.getItem('os_last_active_char_id') || undefined) : undefined,
              localStorageSnapshot: (mode === 'text_only' || mode === 'full') ? collectLocalStorageSnapshot() : undefined,
              eventNotifFlags: (mode === 'text_only' || mode === 'full') ? (() => {
                  const flags: Record<string, string> = {};
                  for (let i = 0; i < localStorage.length; i++) {
                      const key = localStorage.key(i);
                      if (!key) continue;
                      if (key.startsWith('moro_') && !isTemporaryLocalStorageKey(key)) {
                          flags[key] = localStorage.getItem(key) || '';
                      }
                  }
                  return Object.keys(flags).length > 0 ? flags : undefined;
              })() : undefined,
          };

          const totalSteps = storesToProcess.length + 3;
          let currentStep = 0;

          // Pre-process specialized image fields (Social App, Theme)
          if (mode !== 'text_only') {
              if (backupData.socialAppData?.userProfile) backupData.socialAppData.userProfile = processObject(backupData.socialAppData.userProfile);
              if (backupData.socialAppData?.userBg) backupData.socialAppData.userBg = processObject(backupData.socialAppData.userBg);
              if (backupData.roomCustomAssets) backupData.roomCustomAssets = processObject(backupData.roomCustomAssets);
              if (backupData.theme) backupData.theme = processObject(backupData.theme);
              if (backupData.customIcons) backupData.customIcons = processObject(backupData.customIcons);
              if (backupData.appearancePresets) backupData.appearancePresets = processObject(backupData.appearancePresets);
              if (backupData.localStorageSnapshot) backupData.localStorageSnapshot = transformLocalStorageSnapshotValues(backupData.localStorageSnapshot, processObject);
          } else {
              // Strip images for text only
              if (backupData.socialAppData?.userProfile) backupData.socialAppData.userProfile = stripBase64(backupData.socialAppData.userProfile);
              if (backupData.socialAppData?.userBg) backupData.socialAppData.userBg = stripBase64(backupData.socialAppData.userBg);
              if (backupData.roomCustomAssets) backupData.roomCustomAssets = stripBase64(backupData.roomCustomAssets);
              if (backupData.customIcons) backupData.customIcons = stripBase64(backupData.customIcons);
              if (backupData.appearancePresets) backupData.appearancePresets = stripBase64(backupData.appearancePresets);
              if (backupData.localStorageSnapshot) backupData.localStorageSnapshot = transformLocalStorageSnapshotValues(backupData.localStorageSnapshot, stripBase64);
              if (backupData.theme) {
                  // Save preset decoration content before stripping (SVGs start with data:image and would be stripped)
                  const savedPresetDecos = backupData.theme.desktopDecorations
                      ?.filter(d => d.type === 'preset')
                      .map(d => ({ id: d.id, content: d.content }));
                  const strippedTheme = stripBase64(backupData.theme) as OSTheme;
                  backupData.theme = strippedTheme;
                  // Restore preset SVGs and remove image decorations (they have no data in text mode)
                  if (strippedTheme.desktopDecorations && savedPresetDecos) {
                      strippedTheme.desktopDecorations = strippedTheme.desktopDecorations
                          .map(d => {
                              const saved = savedPresetDecos.find(p => p.id === d.id);
                              return saved ? { ...d, content: saved.content } : d;
                          })
                          .filter(d => d.content && d.content !== '');
                  }
              }
          }

          // Stores that never contain base64 image data — skip recursive traversal
          const noImageStores = new Set([
              'memory_nodes', 'memory_links', 'topic_boxes', 'anticipations', 'event_boxes',
              'bank_transactions', 'takeout_orders', 'scheduled_messages', 'memory_batches', 'hotnews_snapshots', 'desktop_pet'
          ]);

          // Chunked processObject for large arrays — yields to main thread every 200 items
          const processArrayChunked = async (arr: any[], fn: (item: any) => any, chunkSize = 200): Promise<any[]> => {
              if (arr.length <= chunkSize) return arr.map(fn);
              const result: any[] = [];
              for (let i = 0; i < arr.length; i += chunkSize) {
                  const chunk = arr.slice(i, i + chunkSize).map(fn);
                  result.push(...chunk);
                  if (i + chunkSize < arr.length) {
                      await new Promise(r => setTimeout(r, 0));
                  }
              }
              return result;
          };

          for (const storeName of storesToProcess) {
              currentStep++;
              setSysOperation({
                  status: 'processing',
                  message: `正在打包: ${storeName} ...`,
                  progress: (currentStep / totalSteps) * 100
              });

              let rawData = await DB.getRawStoreData(storeName);
              let processedData: any;

              // --- MODE SPECIFIC FILTERING ---

              if (storeName === 'assets' && Array.isArray(rawData)) {
                  rawData = rawData.filter((asset: { id?: string } | null | undefined) => {
                      if (!asset || typeof asset.id !== 'string') return true;
                      return !isRedundantManagedAssetId(asset.id);
                  });
              }

              // Fast path: stores with no image data skip expensive recursive traversal
              if (noImageStores.has(storeName)) {
                  processedData = rawData;
              } else if (mode === 'text_only') {
                  processedData = Array.isArray(rawData) && rawData.length > 200
                      ? await processArrayChunked(rawData, stripBase64)
                      : stripBase64(rawData);
              } else {
                  // Media & Theme Mode: Extract Images
                  
                  if (storeName === 'messages' && mode === 'media_only') {
                      // Filter messages: Only keep image/emoji types
                      rawData = rawData.filter((m: Message) => m.type === 'image' || m.type === 'emoji');
                  }

                  if (storeName === 'characters' && mode === 'media_only') {
                      // Character Logic: Export ONLY visual assets to mediaAssets array
                      // Do not export the full character array to avoid overwriting text data on import
                      const mediaList = rawData.map((c: CharacterProfile) => {
                          const extracted = {
                              charId: c.id,
                              avatar: c.avatar,
                              sprites: c.sprites,
                              // Date app sprite data: skin sets carry alternate sprite maps,
                              // and customDateSprites/activeSkinSetId are required to wire them up.
                              dateSkinSets: c.dateSkinSets,
                              activeSkinSetId: c.activeSkinSetId,
                              customDateSprites: c.customDateSprites,
                              spriteConfig: c.spriteConfig,
                              roomItems: c.roomConfig?.items?.reduce((acc: any, item: any) => {
                                  if (item.image && item.image.startsWith('data:')) {
                                      acc[item.id] = item.image;
                                  }
                                  return acc;
                              }, {}),
                              backgrounds: {
                                  chat: c.chatBackground,
                                  date: c.dateBackground,
                                  roomWall: c.roomConfig?.wallImage,
                                  roomFloor: c.roomConfig?.floorImage
                              }
                          };
                          return processObject(extracted);
                      });
                      backupData.mediaAssets = mediaList;
                      continue; // Skip standard assignment
                  }

                  processedData = Array.isArray(rawData) && rawData.length > 200
                      ? await processArrayChunked(rawData, processObject)
                      : processObject(rawData);
              }

              // Assign to Backup Data
              switch(storeName) {
                  case 'characters': if(mode !== 'media_only') backupData.characters = processedData; break;
                  case 'messages': backupData.messages = processedData; break;
                  case 'themes': backupData.customThemes = processedData; break;
                  case 'emojis': backupData.savedEmojis = processedData; break;
                  case 'emoji_categories': backupData.emojiCategories = processedData; break;
                  case 'assets': backupData.assets = processedData; break;
                  case 'gallery': backupData.galleryImages = processedData; break;
                  case 'user_profile': if (processedData[0]) backupData.userProfile = processedData[0]; break;
                  case 'diaries': backupData.diaries = processedData; break;
                  case 'tasks': backupData.tasks = processedData; break;
                  case 'anniversaries': backupData.anniversaries = processedData; break;
                  case 'room_todos': backupData.roomTodos = processedData; break;
                  case 'room_notes': backupData.roomNotes = processedData; break;
                  case 'groups': backupData.groups = processedData; break;
                  case 'journal_stickers': backupData.savedJournalStickers = processedData; break;
                  case 'social_posts': backupData.socialPosts = processedData; break;
                  case 'courses': backupData.courses = processedData; break;
                  case 'games': backupData.games = processedData; break;
                  case 'worldbooks': backupData.worldbooks = processedData; break;
                  case 'llm_presets': backupData.llmPresets = processedData; break;
                  case 'personas': backupData.personas = processedData; break;
                  case 'novels': backupData.novels = processedData; break;
                  case 'coview_media': backupData.coviewMedia = Array.isArray(processedData) ? processedData.map(({ blob: _blob, ...item }: any) => item) : []; break;
                  case 'coview_books': backupData.coviewBooks = processedData; break;
                  case 'coview_sessions': backupData.coviewSessions = processedData; break;
                  case 'coview_messages': backupData.coviewMessages = processedData; break;
                  case 'songs': backupData.songs = processedData; break;
                  case 'bank_transactions': backupData.bankTransactions = processedData; break;
                  case 'bank_data': {
                      if (Array.isArray(processedData)) {
                          const mainState = processedData.find((d: any) => d.id === 'main_state');
                          const dollhouseRecord = processedData.find((d: any) => d.id === 'dollhouse_state');
                          backupData.bankState = mainState ? { ...mainState, id: undefined } : undefined;
                          backupData.bankDollhouse = dollhouseRecord?.data || undefined;
                      }
                      break;
                  }
                  case 'xhs_activities': backupData.xhsActivities = processedData; break;
                  case 'xhs_stock': backupData.xhsStockImages = processedData; break;
                  case 'quizzes': backupData.quizSessions = processedData; break;
                  case 'guidebook': backupData.guidebookSessions = processedData; break;
                  case 'takeout_orders': backupData.takeoutOrders = processedData; break;
                  case 'scheduled_messages': backupData.scheduledMessages = processedData; break;
                  case 'life_sim': backupData.lifeSimState = Array.isArray(processedData) ? (processedData[0] || null) : (processedData || null); break;
                  case 'handbook': backupData.handbooks = processedData; break;
                  case 'trackers': backupData.trackers = processedData; break;
                  case 'tracker_entries': backupData.trackerEntries = processedData; break;
                  case 'hotnews_snapshots': backupData.hotNewsSnapshots = processedData; break;
                  case 'desktop_pet': backupData.desktopPetState = Array.isArray(processedData) ? (processedData[0] || undefined) : (processedData || undefined); break;
                  case 'memory_nodes': backupData.memoryNodes = processedData; break;
                  case 'memory_links': backupData.memoryLinks = processedData; break;
                  case 'topic_boxes': backupData.topicBoxes = processedData; break;
                  case 'anticipations': backupData.anticipations = processedData; break;
                  case 'event_boxes': backupData.eventBoxes = processedData; break;
                  case 'daily_schedule': backupData.dailySchedules = processedData; break;
                  case 'memory_batches': backupData.memoryBatches = processedData; break;
                  case 'pixel_home_assets': backupData.pixelHomeAssets = processedData; break;
                  case 'pixel_home_layouts': backupData.pixelHomeLayouts = processedData; break;
                  // 「页外」虚拟世界 —— 键名须与 importFullData 读取的字段对齐
                  case 'vr_novels': backupData.vrNovels = processedData; break;
                  case 'vr_annotations': backupData.vrAnnotations = processedData; break;
                  case 'cc_custom_parts': backupData.customCreatorParts = processedData; break;
                  case 'vr_letters': backupData.vrLetters = processedData; break;
                  case 'vr_settings': backupData.vrSettings = processedData; break;
                  // 单例 store：导入端期望单个对象（取首条），非数组
                  case 'vr_music': backupData.vrMusicRoom = Array.isArray(processedData) ? (processedData[0] || undefined) : (processedData || undefined); break;
                  case 'vr_guestbook': backupData.vrGuestbook = Array.isArray(processedData) ? (processedData[0] || undefined) : (processedData || undefined); break;
                  default:
                      if (mode !== 'media_only') {
                          backupData.indexedDbSnapshot = backupData.indexedDbSnapshot || {};
                          backupData.indexedDbSnapshot[storeName] = Array.isArray(processedData) ? processedData : [];
                      }
                      break;
              }

              await new Promise(resolve => setTimeout(resolve, 10));
          }

          // 进度条停在 70% 让用户看到接下来的"压缩中 X%"实际推进，而不是
          // 卡在 95% 干等。level 9 压几十 MB 数据可能要好几秒。
          setSysOperation({ status: 'processing', message: '正在生成压缩包（最高压缩级别）...', progress: 70 });

          // --- MEMORY-OPTIMIZED INCREMENTAL SERIALIZATION ---
          // Instead of JSON.stringify(entire backupData) which doubles peak memory,
          // we serialize large arrays separately and build the JSON incrementally.
          const largeArrayKeys = ['characters', 'messages', 'assets', 'galleryImages',
              'savedEmojis', 'memoryNodes', 'memoryLinks',
              'socialPosts', 'diaries', 'worldbooks', 'novels', 'coviewMedia', 'coviewBooks', 'coviewSessions', 'coviewMessages', 'xhsActivities',
              'bankTransactions', 'quizSessions', 'guidebookSessions',
              'topicBoxes', 'anticipations', 'eventBoxes', 'roomCustomAssets', 'mediaAssets',
              'customThemes', 'appearancePresets', 'courses', 'games', 'songs',
              'roomTodos', 'roomNotes', 'tasks', 'anniversaries', 'groups',
              'savedJournalStickers', 'emojiCategories', 'xhsStockImages',
              'takeoutOrders', 'scheduledMessages', 'handbooks', 'trackers', 'trackerEntries', 'hotNewsSnapshots',
              'dailySchedules', 'memoryBatches', 'pixelHomeAssets', 'pixelHomeLayouts', 'indexedDbSnapshot'] as const;

          // Build metadata (small fields) separately
          const metadata: Record<string, any> = {};
          const largeKeySet = new Set(largeArrayKeys as readonly string[]);
          for (const key of Object.keys(backupData)) {
              if (!largeKeySet.has(key)) {
                  metadata[key] = (backupData as any)[key];
              }
          }

          // Build JSON string incrementally: "{metadata..., largeKey1:[...], largeKey2:[...]}"
          const metaStr = JSON.stringify(metadata);
          const jsonParts: string[] = [metaStr.slice(0, -1)]; // Remove trailing '}'

          let addedLarge = false;
          for (const key of largeArrayKeys) {
              const value = (backupData as any)[key];
              if (value === undefined || value === null) continue;
              jsonParts.push(`${addedLarge || metaStr.length > 2 ? ',' : ''}"${key}":${JSON.stringify(value)}`);
              addedLarge = true;
              // Release reference immediately to allow GC
              (backupData as any)[key] = undefined;
              // Yield to let GC run
              await new Promise(r => setTimeout(r, 0));
          }
          jsonParts.push('}');

          zip.file("data.json", jsonParts.join(''));
          // Release parts
          jsonParts.length = 0;

          // 进度提示：每 ~5% 更新一次（避免高频 React 重渲染），同时让进度
          // 条从 70% 平滑爬到 99%，用户能确切看到"在动"。
          let lastReportedPercent = -10;
          const content = await zip.generateAsync(
              { type: "blob", streamFiles: true, compression: "DEFLATE", compressionOptions: { level: 9 } },
              (metadata) => {
                  const p = metadata.percent;
                  if (p - lastReportedPercent >= 5 || p >= 99) {
                      lastReportedPercent = p;
                      setSysOperation({
                          status: 'processing',
                          message: `正在压缩备份数据 ${p.toFixed(0)}%...`,
                          progress: Math.min(99, 70 + Math.floor(p * 0.29)),
                      });
                  }
              }
          );

          setSysOperation({ status: 'idle', message: '', progress: 100 });
          return content;

      } catch (e: any) {
          console.error("Export Failed", e);
          setSysOperation({ status: 'idle', message: '', progress: 0 });
          throw new Error("导出失败: " + e.message);
      }
  };

  const importSystem = async (fileOrJson: File | string): Promise<void> => {
      const sourceName = typeof fileOrJson === 'string' ? 'json' : fileOrJson.name;
      const sourceSize = typeof fileOrJson === 'string'
          ? (typeof Blob !== 'undefined' ? new Blob([fileOrJson]).size : fileOrJson.length)
          : fileOrJson.size;
      const restoredAssetFiles = new Set<string>();
      let totalAssetFiles = 0;
      let lastProgress = 0;
      let lastCurrent = '解析备份文件';
      let lastCurrentFile: string | undefined;
      let lastCurrentFileSize: number | undefined;

      const buildImportMessage = (headline: string, update: ImportProgressUpdate = {}) => {
          const lines = [headline];
          const current = update.current ?? lastCurrent;
          const currentFile = update.currentFile ?? lastCurrentFile;
          const currentFileSize = update.currentFileSize ?? lastCurrentFileSize;
          if (current) lines.push(`当前部分：${current}`);
          if (typeof update.itemTotal === 'number' && update.itemTotal > 0) {
              lines.push(`条目：${update.itemDone || 0}/${update.itemTotal}`);
          }
          if (currentFile) {
              const sizeText = formatBytes(currentFileSize);
              lines.push(`当前文件：${currentFile}${sizeText ? ` · ${sizeText}` : ''}`);
          }
          if (sourceName !== 'json' && update.current === '解析备份文件') {
              const sizeText = formatBytes(sourceSize);
              lines.push(`备份：${sourceName}${sizeText ? ` · ${sizeText}` : ''}`);
          }
          return lines.join('\n');
      };

      const showImportProgress = (
          phase: string,
          headline: string,
          progress: number,
          update: ImportProgressUpdate = {}
      ) => {
          if (update.current !== undefined) lastCurrent = update.current;
          if (update.currentFile !== undefined) lastCurrentFile = update.currentFile;
          if (update.currentFileSize !== undefined) lastCurrentFileSize = update.currentFileSize;
          lastProgress = Math.max(lastProgress, Math.min(99, Math.max(0, progress)));
          markImportInProgress(phase, sourceName, {
              sourceSize,
              assetDone: restoredAssetFiles.size,
              assetTotal: totalAssetFiles || undefined,
              ...update,
          });
          setSysOperation({
              status: 'processing',
              message: buildImportMessage(headline, update),
              progress: lastProgress,
          });
      };

      const countZipAssetFiles = (zip: JSZipLike) => {
          const files = Object.values((zip as any).files || {}) as any[];
          return files.filter(file => file && !file.dir && typeof file.name === 'string' && file.name.startsWith('assets/')).length;
      };

      const estimateBase64Bytes = (base64: string) => {
          const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
          return Math.max(0, Math.floor(base64.length * 3 / 4) - padding);
      };

      showImportProgress('parsing', '正在解析备份文件...', 1, { current: '解析备份文件', sourceSize });
      try {
          let data: FullBackupData;
          let zip: JSZipLike | null = null;

          if (typeof fileOrJson === 'string') {
              data = JSON.parse(fileOrJson);
          } else {
              if (!fileOrJson.name.endsWith('.zip')) {
                  try {
                      const text = await fileOrJson.text();
                      data = JSON.parse(text);
                  } catch (e) {
                      throw new Error("无效的文件格式，请上传 .zip 或 .json");
                  }
              } else {
                  const JSZip = await loadJSZip();
                  const loadedZip = await JSZip.loadAsync(fileOrJson);
                  zip = loadedZip;
                  const dataFile = loadedZip.file("data.json");
                  if (!dataFile) throw new Error("损坏的备份包: 缺少 data.json");
                  let jsonStr = await dataFile.async("string");
                  totalAssetFiles = countZipAssetFiles(loadedZip);
                  data = JSON.parse(jsonStr);
                  jsonStr = '';
              }
          }

          const hadAssetStoreBackup = data.assets !== undefined;
          const hadCustomIconsBackup = data.customIcons !== undefined;
          const hadAppearancePresetsBackup = data.appearancePresets !== undefined;

          const restoreAssetsInPlace = async (root: any, label = '数据'): Promise<void> => {
              if (!zip) return;

              type Ref = { parent: any; key: string | number; filename: string };
              const refsByFile = new Map<string, Ref[]>();
              const seen = new WeakSet<object>();
              const stack: any[] = [root];
              while (stack.length) {
                  const node = stack.pop();
                  if (node === null || typeof node !== 'object') continue;
                  if (seen.has(node)) continue;
                  seen.add(node);
                  if (Array.isArray(node)) {
                      for (let i = 0; i < node.length; i++) {
                          const v = node[i];
                          if (typeof v === 'string' && v.startsWith('assets/')) {
                              const filename = v.slice('assets/'.length);
                              const refs = refsByFile.get(filename) || [];
                              refs.push({ parent: node, key: i, filename });
                              refsByFile.set(filename, refs);
                          } else if (v && typeof v === 'object') {
                              stack.push(v);
                          }
                      }
                  } else {
                      for (const k in node) {
                          if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
                          const v = node[k];
                          if (typeof v === 'string' && v.startsWith('assets/')) {
                              const filename = v.slice('assets/'.length);
                              const refs = refsByFile.get(filename) || [];
                              refs.push({ parent: node, key: k, filename });
                              refsByFile.set(filename, refs);
                          } else if (v && typeof v === 'object') {
                              stack.push(v);
                          }
                      }
                  }
              }

              const entries = Array.from(refsByFile.entries());
              if (entries.length === 0) return;

              for (const [filename, refs] of entries) {
                  const fileInZip = zip.file(`assets/${filename}`) as (JSZipFileLike & { _data?: { compressedSize?: number; uncompressedSize?: number } }) | null;
                  const hintedSize = fileInZip?._data?.uncompressedSize || fileInZip?._data?.compressedSize;
                  showImportProgress('assets', '正在恢复素材...', 35 + Math.floor((restoredAssetFiles.size / Math.max(1, totalAssetFiles || entries.length)) * 35), {
                      current: label,
                      currentFile: filename,
                      currentFileSize: hintedSize,
                      assetDone: restoredAssetFiles.size,
                      assetTotal: totalAssetFiles || entries.length,
                  });

                  try {
                      if (!fileInZip) {
                          console.warn(`Missing asset in backup: assets/${filename}`);
                          continue;
                      }
                      const base64 = await fileInZip.async("base64");
                      const ext = (filename.split('.').pop() || 'png').toLowerCase();
                      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
                          : ext === 'gif' ? 'image/gif'
                          : ext === 'webp' ? 'image/webp'
                          : 'image/png';
                      const dataUri = `data:${mime};base64,${base64}`;
                      for (const ref of refs) {
                          ref.parent[ref.key] = dataUri;
                      }
                      const decodedSize = estimateBase64Bytes(base64);
                      restoredAssetFiles.add(filename);
                      showImportProgress('assets', '正在恢复素材...', 35 + Math.floor((restoredAssetFiles.size / Math.max(1, totalAssetFiles || entries.length)) * 35), {
                          current: label,
                          currentFile: filename,
                          currentFileSize: decodedSize,
                          assetDone: restoredAssetFiles.size,
                          assetTotal: totalAssetFiles || entries.length,
                      });
                  } catch {
                      console.warn(`Failed to restore asset: assets/${filename}`);
                  }
                  await new Promise<void>(resolve => setTimeout(resolve, 0));
              }
          };

          const restoreLocalStorageSnapshotAssets = async (snapshot: Record<string, string> | undefined): Promise<void> => {
              if (!snapshot) return;
              for (const [key, value] of Object.entries(snapshot)) {
                  try {
                      const parsed = JSON.parse(value);
                      await restoreAssetsInPlace(parsed, `localStorage:${key}`);
                      snapshot[key] = JSON.stringify(parsed);
                  } catch {
                      const wrapped = { value };
                      await restoreAssetsInPlace(wrapped, `localStorage:${key}`);
                      if (typeof wrapped.value === 'string') snapshot[key] = wrapped.value;
                  }
              }
          };

          showImportProgress('database', '正在写入数据库...', 50, { current: '准备写入数据库', currentFile: '' });
          await DB.importFullData(data, {
              beforeWrite: restoreAssetsInPlace,
              onProgress: progress => {
                  const sectionRatio = progress.sectionTotal > 0
                      ? progress.sectionDone / progress.sectionTotal
                      : 0;
                  const itemRatio = progress.itemTotal && progress.sectionTotal > 0
                      ? ((progress.itemDone || 0) / progress.itemTotal) / progress.sectionTotal
                      : 0;
                  const dbProgress = 50 + Math.floor(Math.min(1, sectionRatio + itemRatio) * 40);
                  showImportProgress('database', '正在写入数据库...', dbProgress, {
                      current: progress.stage === 'done' ? `${progress.label}完成` : progress.label,
                      currentFile: '',
                      itemDone: progress.itemDone,
                      itemTotal: progress.itemTotal,
                  });
              },
          });
          
          showImportProgress('settings', '正在恢复系统设置...', 92, { current: '系统设置', currentFile: '' });
          if (data.theme) {
              await restoreAssetsInPlace(data.theme, '系统主题');
              await updateTheme(data.theme);
          }
          if (data.apiConfig) updateApiConfig(data.apiConfig);
          if (data.availableModels) saveModels(data.availableModels);
          if (data.apiPresets) savePresets(data.apiPresets);
          if (data.realtimeConfig) updateRealtimeConfig(data.realtimeConfig); // 恢复实时感知配置

          if (data.customIcons !== undefined || data.appearancePresets !== undefined) {
              await restoreAssetsInPlace(data.customIcons, '应用图标');
              await restoreAssetsInPlace(data.appearancePresets, '外观预设');
              const existingAssets = await DB.getAllAssets();
              if (Array.isArray(existingAssets)) {
                  for (const asset of existingAssets) {
                      if (data.customIcons !== undefined && asset.id.startsWith('icon_')) {
                          await DB.deleteAsset(asset.id);
                      }
                      if (data.appearancePresets !== undefined && asset.id.startsWith('appearance_preset_')) {
                          await DB.deleteAsset(asset.id);
                      }
                  }
              }
              if (data.customIcons) {
                  for (const [appId, iconUrl] of Object.entries(data.customIcons)) {
                      await DB.saveAsset(`icon_${appId}`, iconUrl);
                  }
              }
              if (data.appearancePresets) {
                  for (const preset of data.appearancePresets) {
                      await DB.saveAsset(`appearance_preset_${preset.id}`, JSON.stringify(preset));
                  }
              }
          }

          // Restore Study Room settings
          if (data.studyApiConfig) localStorage.setItem('study_api_config', JSON.stringify(data.studyApiConfig));
          if (data.studyTutorPresets) localStorage.setItem('study_tutor_presets', JSON.stringify(data.studyTutorPresets));

          // Restore 云端配置
          if (data.cloudBackupConfig) localStorage.setItem('os_cloud_backup_config', JSON.stringify(data.cloudBackupConfig));

          // Restore Instant Push
          if (data.instantPushConfig) localStorage.setItem('instant_push_config_v1', JSON.stringify(data.instantPushConfig));
          if (data.pushVapid) localStorage.setItem('push_vapid_v1', JSON.stringify(data.pushVapid));


          // Restore 回忆标本馆 水位线
          if (data.memoryPalaceHighWaterMarks) {
              for (const [charId, hwm] of Object.entries(data.memoryPalaceHighWaterMarks)) {
                  if (typeof hwm === 'number' && hwm > 0) {
                      localStorage.setItem(`mp_lastMsgId_${charId}`, String(hwm));
                  }
              }
          }

          // Restore 回忆标本馆 UI flags（人格检测已跑过 / 首次 banner 已见等）
          if (data.memoryPalaceFlags && typeof data.memoryPalaceFlags === 'object') {
              for (const [key, val] of Object.entries(data.memoryPalaceFlags)) {
                  if (typeof val === 'string') {
                      // 只允许恢复 mp_ 前缀的键，避免导入数据污染其它 localStorage
                      if (key.startsWith('mp_personality_tried_')
                          || key.startsWith('mp_first_archive_notice_')) {
                          localStorage.setItem(key, val);
                      }
                  }
              }
          }

          // Restore Chat 翻译 / 归档 / 润色设置
          if (typeof data.chatTranslateSourceLang === 'string') localStorage.setItem('chat_translate_source_lang', data.chatTranslateSourceLang);
          if (typeof data.chatTranslateTargetLang === 'string') localStorage.setItem('chat_translate_lang', data.chatTranslateTargetLang);
          if (data.chatTranslateEnabledByChar && typeof data.chatTranslateEnabledByChar === 'object') {
              for (const [charId, enabled] of Object.entries(data.chatTranslateEnabledByChar)) {
                  localStorage.setItem(`chat_translate_enabled_${charId}`, enabled ? 'true' : 'false');
              }
          }
          if (data.chatTranslateSourceLangByChar && typeof data.chatTranslateSourceLangByChar === 'object') {
              for (const [charId, lang] of Object.entries(data.chatTranslateSourceLangByChar)) {
                  if (typeof lang === 'string') localStorage.setItem(`chat_translate_source_lang_${charId}`, lang);
              }
          }
          if (data.chatTranslateTargetLangByChar && typeof data.chatTranslateTargetLangByChar === 'object') {
              for (const [charId, lang] of Object.entries(data.chatTranslateTargetLangByChar)) {
                  if (typeof lang === 'string') localStorage.setItem(`chat_translate_lang_${charId}`, lang);
              }
          }
          if (data.chatArchivePrompts !== undefined) localStorage.setItem('chat_archive_prompts', JSON.stringify(data.chatArchivePrompts));
          if (typeof data.chatActiveArchivePromptId === 'string') localStorage.setItem('chat_active_archive_prompt_id', data.chatActiveArchivePromptId);
          if (data.characterRefinePrompts !== undefined) localStorage.setItem('character_refine_prompts', JSON.stringify(data.characterRefinePrompts));
          if (typeof data.characterActiveRefinePromptId === 'string') localStorage.setItem('character_active_refine_prompt_id', data.characterActiveRefinePromptId);

          // Restore UI / 偏好
          if (typeof data.scheduleAppTheme === 'string') localStorage.setItem('almanac_promise_theme', data.scheduleAppTheme);
          if (typeof data.handbookLifestreamDepth === 'string') localStorage.setItem('handbook_lifestream_depth', data.handbookLifestreamDepth);
          if (typeof data.groupchatContextLimit === 'number') localStorage.setItem('groupchat_context_limit', String(data.groupchatContextLimit));
          if (data.browserConfig && typeof data.browserConfig === 'object') {
              if (typeof data.browserConfig.braveKey === 'string') localStorage.setItem('browser_brave_key', data.browserConfig.braveKey);
              if (typeof data.browserConfig.useRealSearch === 'boolean') localStorage.setItem('browser_use_real_search', data.browserConfig.useRealSearch ? 'true' : 'false');
          }
          if (typeof data.bm25Mode === 'string') localStorage.setItem('bm25_mode', data.bm25Mode);
          if (typeof data.lastActiveCharId === 'string') localStorage.setItem('os_last_active_char_id', data.lastActiveCharId);
          if (data.eventNotifFlags && typeof data.eventNotifFlags === 'object') {
              for (const [key, val] of Object.entries(data.eventNotifFlags)) {
                  // 只允许 moro_ 前缀，避免污染其它键
                  if (typeof val === 'string' && key.startsWith('moro_') && !isTemporaryLocalStorageKey(key)) {
                      localStorage.setItem(key, val);
                  }
              }
          }
          if (data.localStorageSnapshot) {
              await restoreLocalStorageSnapshotAssets(data.localStorageSnapshot);
              restoreLocalStorageSnapshot(data.localStorageSnapshot);
          }
          
          if (data.socialAppData) {
              await restoreAssetsInPlace(data.socialAppData, '动态设置');
              if (data.socialAppData.charHandles) localStorage.setItem('spark_char_handles', JSON.stringify(data.socialAppData.charHandles));
              if (data.socialAppData.userId) localStorage.setItem('spark_user_id', data.socialAppData.userId);
              
              // Restore heavy assets to DB
              if (data.socialAppData.userProfile) await DB.saveAsset('spark_social_profile', JSON.stringify(data.socialAppData.userProfile));
              if (data.socialAppData.userBg) await DB.saveAsset('spark_user_bg', data.socialAppData.userBg);
          }
          
          // Restore Room Custom Assets to DB (migrate old format on import)
          if (data.roomCustomAssets) {
              await restoreAssetsInPlace(data.roomCustomAssets, '房间自定义素材');
              const migratedAssets = data.roomCustomAssets.map((a: any) => ({
                  ...a,
                  id: a.id || `asset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                  visibility: a.visibility || 'public',
              }));
              await DB.saveAsset('room_custom_assets_list', JSON.stringify(migratedAssets));
          }

          const chars = await DB.getAllCharacters();
          const groupsList = await DB.getGroups();
          const themes = await DB.getThemes();
          const user = await DB.getUserProfile();
          const books = await DB.getAllWorldbooks();
          const novelList = await DB.getAllNovels();
          const songList = await DB.getAllSongs();
          
          if (hadAssetStoreBackup || hadCustomIconsBackup || hadAppearancePresetsBackup) {
              const assets = await DB.getAllAssets();
              const loadedIcons: Record<string, string> = {};
              const loadedPresets: AppearancePreset[] = [];
              if (Array.isArray(assets)) {
                  assets.forEach(a => {
                      if (a.id.startsWith('icon_')) loadedIcons[a.id.replace('icon_', '')] = a.data;
                      if (a.id.startsWith('appearance_preset_')) {
                          try {
                              loadedPresets.push(JSON.parse(a.data));
                          } catch {}
                      }
                  });
              }
              setCustomIcons(loadedIcons);
              loadedPresets.sort((a, b) => b.createdAt - a.createdAt);
              setAppearancePresets(loadedPresets);
          }

          if (chars.length > 0) setCharacters(chars.map(c => normalizeCharacterDefaults(c)));
          if (groupsList.length > 0) setGroups(groupsList);
          if (themes.length > 0) setCustomThemes(themes);
          if (user) setUserProfile(user);
          if (books.length > 0) setWorldbooks(books);
          if (novelList.length > 0) setNovels(novelList);
          if (songList.length > 0) setSongs(songList);
          
          setSysOperation({ status: 'idle', message: '', progress: 100 });
          clearImportInProgress();
          addToast('恢复成功，系统即将重启...', 'success');
          setTimeout(() => window.location.reload(), 1500);

      } catch (e: any) {
          console.error("Import Error:", e);
          setSysOperation({ status: 'idle', message: '', progress: 0 });
          const msg = e instanceof SyntaxError ? 'JSON 格式错误' : (e.message || '未知错误');
          markImportInProgress('error', sourceName, {
              sourceSize,
              current: lastCurrent,
              currentFile: lastCurrentFile,
              currentFileSize: lastCurrentFileSize,
              assetDone: restoredAssetFiles.size,
              assetTotal: totalAssetFiles || undefined,
              error: msg,
          });
          throw new Error(`恢复失败: ${msg}`);
      }
  };

  const resetSystem = async () => { try { await DB.deleteDB(); localStorage.clear(); window.location.reload(); } catch (e) { console.error(e); addToast('重置失败，请手动清除浏览器数据', 'error'); } };
  const openApp = (appId: AppID) => {
      if (activeApp !== appId) appHistoryRef.current.push(activeApp);
      setActiveApp(appId);
  };
  const closeApp = () => { appHistoryRef.current = []; setActiveApp(AppID.Launcher); };
  const goBack = () => {
      const target = appHistoryRef.current.pop() ?? AppID.Launcher;
      setActiveApp(target);
  };
  const unlock = () => setIsLocked(false);
  // 一键锁屏：仅切换 UI 到锁屏，不动任何调度——主动消息 / Web Push / 通知照常送达锁屏通知卡
  const lock = () => { setActiveApp(AppID.Launcher); setIsLocked(true); };

  const suspendCall = (info: { charId: string; charName: string; charAvatar?: string; startedAt: number; bubbles?: any[]; sessionId?: string; elapsedSeconds?: number; voiceLang?: string }) => {
    setSuspendedCall(info);
    setActiveApp(AppID.Launcher);
  };
  const resumeCall = () => {
    setActiveApp(AppID.Call);
  };
  const clearSuspendedCall = () => {
    setSuspendedCall(null);
  };
  const suspendVideoCall = (info: SuspendedVideoCallInfo) => {
    setSuspendedVideoCall(info);
    setActiveApp(AppID.Launcher);
  };
  const resumeVideoCall = () => {
    setActiveApp(AppID.VideoCall);
  };
  const clearSuspendedVideoCall = () => {
    setSuspendedVideoCall(null);
  };
  const suspendOfflineSession = (info: SuspendedOfflineSessionInfo) => {
    setSuspendedOfflineSession(info);
  };
  const resumeOfflineSession = () => {
    const info = suspendedOfflineSession;
    if (!info) return;
    try {
      if (info.kind === 'private') {
        sessionStorage.setItem('moro_chat_resume_offline_char_id', info.charId);
        setActiveCharacterId(info.charId);
        setActiveApp(AppID.Chat);
      } else {
        sessionStorage.setItem('moro_chathub_resume_group_offline_id', info.groupId);
        setActiveApp(AppID.GroupChat);
      }
    } catch {
      if (info.kind === 'private') {
        setActiveCharacterId(info.charId);
        setActiveApp(AppID.Chat);
      } else {
        setActiveApp(AppID.GroupChat);
      }
    }
    try {
      window.dispatchEvent(new CustomEvent('moro-offline-resume-request', { detail: info }));
    } catch {
      // ignore
    }
  };
  const clearSuspendedOfflineSession = () => {
    setSuspendedOfflineSession(null);
  };

  // --- Back Handler Logic ---
  const registerBackHandler = useCallback((handler: () => boolean, appId?: AppID) => {
      const ownerAppId = appId ?? activeAppRef.current;
      backHandlersRef.current[ownerAppId] = handler;
      return () => {
          if (backHandlersRef.current[ownerAppId] === handler) {
              delete backHandlersRef.current[ownerAppId];
          }
      };
  }, []);

  const handleBack = useCallback(() => {
      const handler = backHandlersRef.current[activeAppRef.current];
      if (handler) {
          const handled = handler();
          if (handled) return;
      }
      // Default: Close App
      if (activeApp !== AppID.Launcher) {
          closeApp();
      }
  }, [activeApp, closeApp]);

  const value: OSContextType = {
    activeApp,
    openApp,
    closeApp,
    goBack,
    theme,
    updateTheme,
    virtualTime,
    apiConfig,
    updateApiConfig,
    auxApiConfig,
    updateAuxApiConfig,
    isLocked,
    unlock,
    lock,
    isDataLoaded,
    characters,
    activeCharacterId,
    addCharacter,
    importCharacter,
    updateCharacter,
    deleteCharacter,
    setActiveCharacterId,
    worldbooks,
    addWorldbook,
    updateWorldbook,
    worldbookGroupToggles,
    setWorldbookGroupEnabled,
    worldbookGroupScopes,
    setWorldbookGroupScope,
    worldbookGroupSettings,
    setWorldbookGroupSettings,
    deleteWorldbook,
    deleteWorldbookCategory,
    novels,
    addNovel,
    updateNovel,
    deleteNovel,
    songs,
    addSong,
    updateSong,
    deleteSong,
    groups,
    createGroup,
    deleteGroup,
    updateGroup,
    userProfile,
    updateUserProfile,
    adjustUserBalance,
    availableModels,
    setAvailableModels,
    apiPresets,
    addApiPreset,
    removeApiPreset,
    realtimeConfig,
    updateRealtimeConfig,
    memoryPalaceConfig,
    updateMemoryPalaceConfig,
    syncScheduleMoodApisToAllCharacters,
    customThemes,
    addCustomTheme,
    removeCustomTheme,
    appearancePresets,
    saveAppearancePreset,
    applyAppearancePreset,
    deleteAppearancePreset,
    renameAppearancePreset,
    exportAppearancePreset,
    importAppearancePreset,
    toasts,
    addToast,
    errorDialog,
    showError,
    dismissError,
    customIcons,
    setCustomIcon,
    resetAppearance,
    lastMsgTimestamp,
    unreadMessages,
    clearUnread,
    markUnread,
    forceReplyRequest,
    openForceReplyRequest,
    clearForceReplyRequest,
    proactiveComposingChars,
    cloudBackupConfig,
    updateCloudBackupConfig,
    cloudBackupToWebDAV,
    cloudRestoreFromWebDAV,
    listCloudBackups,
    exportSystem,
    importSystem,
    resetSystem,
    sysOperation,
    systemLogs,
    clearLogs,
    registerBackHandler,
    handleBack,
    suspendedCall,
    suspendCall,
    resumeCall,
    clearSuspendedCall,
    suspendedVideoCall,
    suspendVideoCall,
    resumeVideoCall,
    clearSuspendedVideoCall,
    suspendedOfflineSession,
    suspendOfflineSession,
    resumeOfflineSession,
    clearSuspendedOfflineSession
  };

  return (
    <OSContext.Provider value={value}>
      {children}
    </OSContext.Provider>
  );
};

export const useOS = () => {
  const context = useContext(OSContext);
  if (context === undefined) {
    throw new Error('useOS must be used within an OSProvider');
  }
  return context;
};
