import { ReiClient } from '@rei-standard/amsg-client';
import {
  ActiveMsg2CharacterConfig,
  ActiveMsg2GlobalConfig,
  APIConfig,
  CharacterProfile,
  GroupProfile,
  RealtimeConfig,
  UserProfile,
} from '../types';
import { ChatPrompts } from './chatPrompts';
import { DB } from './db';
import { safeResponseJson } from './safeApi';
import { ActiveMsgStore } from './activeMsgStore';
import { KeepAlive } from './keepAlive';
import { activeMsg2ImportantRules, activeMsg2LegacyStyleHint, activeMsg2ModeInstruction } from './laiwangPrompts';
import { buildOpenAiEndpoint } from './openAiCompat';
import { WorldbookRuntime } from './worldbookRuntime';

const ACTIVE_MSG_VAPID_PUBLIC_KEY = import.meta.env.VITE_AMSG_VAPID_PUBLIC_KEY || '';
const ACTIVE_MSG_API_BASE_OVERRIDE = (import.meta.env.VITE_AMSG_API_BASE_URL || '').trim();

export interface ActiveMsg2PushStatus {
  supported: boolean;
  permission: NotificationPermission | 'unsupported';
  hasSubscription: boolean;
  vapidConfigured: boolean;
  detail?: string;
}

export interface ActiveMsg2InitTenantResult {
  tenantId: string;
  tenantToken: string;
  cronToken: string;
  cronWebhookUrl: string;
  masterKeyFingerprint: string;
}

type InternalReiClient = ReiClient & {
  _encrypt: (plaintext: string) => Promise<{ iv: string; authTag: string; encryptedData: string }>;
  _decrypt: (payload: { iv: string; authTag: string; encryptedData: string }) => Promise<any>;
};

const ACTIVE_MSG_RUNTIME_HEADER = '[ActiveMsg2]';

const createClient = (userId: string) => new ReiClient({
  baseUrl: resolveActiveMsgApiBase(),
  userId,
}) as InternalReiClient;

const nowIsoLocal = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
};

export const getDefaultActiveMsgFirstSendTime = () => {
  const base = new Date();
  base.setMinutes(base.getMinutes() + 30);
  const offset = base.getTimezoneOffset();
  const local = new Date(base.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
};

const normalizeActiveMsgApiBase = (value: string) => {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return /\/api\/v1$/i.test(trimmed) ? trimmed : `${trimmed}/api/v1`;
};

export const resolveActiveMsgApiBase = () => {
  if (ACTIVE_MSG_API_BASE_OVERRIDE) {
    return normalizeActiveMsgApiBase(ACTIVE_MSG_API_BASE_OVERRIDE);
  }
  const currentDir = new URL('./', window.location.href);
  return new URL('api/v1/', currentDir).toString().replace(/\/+$/, '');
};

const detectActiveMsgDbDriver = (databaseUrl: string, fallback: ActiveMsg2GlobalConfig['driver']) => {
  return /(?:^|[./-])neon\.tech\b/i.test(databaseUrl) ? 'neon' : fallback;
};

export const sanitizeActiveMsgDatabaseUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return '';

  const match = trimmed.match(/postgres(?:ql)?:\/\/[^\s'"]+/i);
  if (match?.[0]) {
    return match[0].replace(/[;'"]+$/, '');
  }

  return trimmed
    .replace(/^psql\s+/i, '')
    .replace(/^['\"]+/, '')
    .replace(/['\";]+$/, '')
    .trim();
};

const normalizeChatApiUrl = (baseUrl: string) => buildOpenAiEndpoint(baseUrl, 'chat.completions');

const buildActiveMsgApiHint = () => {
  const apiBase = resolveActiveMsgApiBase();
  if (ACTIVE_MSG_API_BASE_OVERRIDE) {
    return `当前主动消息 2.0 API 地址是 ${apiBase}。请确认这里对应的是已部署的 Netlify Functions，而不是静态网页。`;
  }

  if (window.location.hostname.endsWith('github.io') || window.location.protocol === 'file:') {
    return '你当前打开的是静态站点环境，默认 /api/v1 很可能只会返回网页 HTML。请把项目部署到 Netlify，或者在构建环境里设置 VITE_AMSG_API_BASE_URL 指向你的 Netlify 站点。';
  }

  return `当前主动消息 2.0 会向 ${apiBase} 发请求。请确认这里确实能访问到 Netlify Functions。`;
};

const looksLikeHtmlFallbackError = (message: string) => (
  /HTML/i.test(message) ||
  message.includes(`Unexpected token '<'`) ||
  /<!doctype/i.test(message) ||
  /<html/i.test(message)
);

const normalizeActiveMsgApiError = (error: unknown, phase: string) => {
  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
  if (looksLikeHtmlFallbackError(message)) {
    return new Error(`主动消息 2.0 的 ${phase} 请求没有打到 API，而是拿到了网页 HTML。${buildActiveMsgApiHint()}`);
  }
  return error instanceof Error ? error : new Error(message);
};

const withAuthorizationPatchedFetch = async <T>(tenantToken: string, fn: () => Promise<T>) => {
  const originalFetch = window.fetch.bind(window);

  const patchedFetch: typeof window.fetch = (input, init = {}) => {
    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
    headers.set('Authorization', `Bearer ${tenantToken}`);
    return originalFetch(input, { ...init, headers });
  };

  (window as typeof window & { fetch: typeof window.fetch }).fetch = patchedFetch;
  try {
    return await fn();
  } finally {
    (window as typeof window & { fetch: typeof window.fetch }).fetch = originalFetch;
  }
};

const ensureGlobalReady = async (): Promise<ActiveMsg2GlobalConfig> => {
  const userId = await ActiveMsgStore.ensureUserId();
  const config = await ActiveMsgStore.getGlobalConfig();
  return { ...config, userId };
};

const ensureTenantReady = async () => {
  const config = await ensureGlobalReady();
  if (!config.tenantToken) throw new Error('请先在「文具盒」里完成“主动消息 2.0”的租户初始化。');
  return config;
};

const initializeClient = async (config: ActiveMsg2GlobalConfig) => {
  const client = createClient(config.userId);
  try {
    await withAuthorizationPatchedFetch(config.tenantToken || '', () => client.init());
  } catch (error) {
    throw normalizeActiveMsgApiError(error, '获取用户密钥');
  }
  return client;
};

const resolveApiConfig = (_char: CharacterProfile, config: ActiveMsg2CharacterConfig, apiConfig: APIConfig) => {
  const useSecondary = config.useSecondaryApi && config.secondaryApi?.baseUrl;
  const source = useSecondary ? config.secondaryApi! : apiConfig;

  if (!source.baseUrl || !source.apiKey || !source.model) {
    throw new Error('主动消息 2.0 缺少可用的 API URL / Key / Model。');
  }

  return source;
};

const formatHistoryLine = (role: string, content: any, char: CharacterProfile, userProfile: UserProfile) => {
  const speaker = role === 'assistant' ? char.name : role === 'user' ? userProfile.name : '系统';
  const text = Array.isArray(content)
    ? content.map((part) => typeof part === 'string' ? part : JSON.stringify(part)).join('\n')
    : String(content || '');
  return `【${speaker}】\n${text.trim()}`;
};

const buildTimeGapHint = async (charId: string) => {
  const recentMessages = await DB.getRecentMessagesByCharId(charId, 200);
  const lastRealUserMessage = [...recentMessages].reverse().find((message) => (
    message.role === 'user' && !message.metadata?.proactiveHint
  ));

  if (!lastRealUserMessage) {
    return {
      timeSinceUser: '你们最近没有新的聊天记录。',
      recentMessages,
    };
  }

  const diffMinutes = Math.max(0, Math.floor((Date.now() - lastRealUserMessage.timestamp) / 60_000));
  if (diffMinutes < 60) {
    return {
      timeSinceUser: `距离用户上次主动发消息大约 ${diffMinutes} 分钟。`,
      recentMessages,
    };
  }
  if (diffMinutes < 1440) {
    const hours = Math.floor(diffMinutes / 60);
    const minutes = diffMinutes % 60;
    return {
      timeSinceUser: `距离用户上次主动发消息大约 ${hours} 小时${minutes ? ` ${minutes} 分钟` : ''}。`,
      recentMessages,
    };
  }

  const days = Math.floor(diffMinutes / 1440);
  const hours = Math.floor((diffMinutes % 1440) / 60);
  return {
    timeSinceUser: `距离用户上次主动发消息大约 ${days} 天${hours ? ` ${hours} 小时` : ''}。`,
    recentMessages,
  };
};

const buildLegacyStyleProactiveHint = (
  targetName: string,
  currentTime: string,
  timeSinceUser: string,
) => {
  return activeMsg2LegacyStyleHint({ targetName, currentTime, timeSinceUser });
};

const buildCompletePrompt = async (
  char: CharacterProfile,
  config: ActiveMsg2CharacterConfig,
  userProfile: UserProfile,
  groups: GroupProfile[],
  realtimeConfig: RealtimeConfig,
) => {
  const { recentMessages, timeSinceUser } = await buildTimeGapHint(char.id);
  const currentTime = nowIsoLocal().replace('T', ' ');
  const legacyHint = buildLegacyStyleProactiveHint(userProfile.name || '对方', currentTime, timeSinceUser);
  const emojis = await DB.getEmojis();
  const categories = await DB.getEmojiCategories();
  const scanMessages = recentMessages
    .filter(message => (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string')
    .slice(-20)
    .map(message => String(message.content));
  const systemPrompt = await WorldbookRuntime.withContext({ scanMessages }, () => ChatPrompts.buildSystemPrompt(
      char,
      userProfile,
      groups,
      emojis,
      categories,
      recentMessages,
      realtimeConfig,
  ));
  const { apiMessages } = ChatPrompts.buildMessageHistory(
    recentMessages,
    Math.min(char.contextLimit || 120, 120),
    char,
    userProfile,
    emojis,
  );

  const recentTranscript = apiMessages
    .slice(-30)
    .map((message) => formatHistoryLine(message.role, message.content, char, userProfile))
    .join('\n\n');

  const modeInstruction = activeMsg2ModeInstruction(config.mode, config.promptHint);

  return [
    '你将代表下面这个角色，生成一条“主动发给用户”的私聊消息。',
    '',
    '【重要规则】',
    ...activeMsg2ImportantRules(userProfile.name || '用户'),
    '',
    '【角色系统设定】',
    systemPrompt,
    '',
    '【最近对话上下文】',
    recentTranscript || '（暂时没有最近聊天记录）',
    '',
    '【当前时刻补充】',
    `当前本地时间：${currentTime}`,
    timeSinceUser,
    '',
    legacyHint,
    '',
    '【本次任务】',
    modeInstruction,
  ].join('\n');
};

const ensureFutureTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('请选择有效的首次发送时间。');
  }
  if (date.getTime() <= Date.now()) {
    throw new Error('首次发送时间必须晚于当前时间。');
  }
  return date.toISOString();
};

const fetchWithTenant = async (path: string, config: ActiveMsg2GlobalConfig, init: RequestInit, phase = '接口') => {
  const headers = new Headers(init.headers);
  if (config.tenantToken) headers.set('Authorization', `Bearer ${config.tenantToken}`);
  headers.set('X-User-Id', config.userId);

  try {
    const response = await fetch(`${resolveActiveMsgApiBase()}/${path}`, {
      ...init,
      headers,
    });

    return await safeResponseJson(response);
  } catch (error) {
    throw normalizeActiveMsgApiError(error, phase);
  }
};

const encryptPayload = async (client: InternalReiClient, payload: unknown) => {
  return client._encrypt(JSON.stringify(payload));
};

const decryptPayload = async (client: InternalReiClient, payload: { iv: string; authTag: string; encryptedData: string }) => {
  return client._decrypt(payload);
};

export const ActiveMsgClient = {
  get vapidPublicKey() {
    return ACTIVE_MSG_VAPID_PUBLIC_KEY;
  },

  get apiBaseUrl() {
    return resolveActiveMsgApiBase();
  },

  async getGlobalConfig() {
    return ensureGlobalReady();
  },

  async getPushStatus(): Promise<ActiveMsg2PushStatus> {
    const supported = 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
    if (!supported) {
      return {
        supported: false,
        permission: 'unsupported',
        hasSubscription: false,
        vapidConfigured: Boolean(ACTIVE_MSG_VAPID_PUBLIC_KEY),
        detail: '当前浏览器不支持 Web Push。',
      };
    }

    await KeepAlive.init();
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    return {
      supported: true,
      permission: Notification.permission,
      hasSubscription: Boolean(subscription),
      vapidConfigured: Boolean(ACTIVE_MSG_VAPID_PUBLIC_KEY),
      detail: !ACTIVE_MSG_VAPID_PUBLIC_KEY ? '缺少 VITE_AMSG_VAPID_PUBLIC_KEY。' : undefined,
    };
  },

  async ensurePushSubscription() {
    const pushStatus = await this.getPushStatus();
    if (!pushStatus.supported) throw new Error(pushStatus.detail || '当前环境不支持推送。');
    if (!ACTIVE_MSG_VAPID_PUBLIC_KEY) throw new Error('缺少 VITE_AMSG_VAPID_PUBLIC_KEY，无法创建推送订阅。');

    let permission = Notification.permission;
    if (permission !== 'granted') {
      permission = await Notification.requestPermission();
    }
    if (permission !== 'granted') {
      throw new Error('通知权限未授予，无法创建主动消息 2.0 的推送订阅。');
    }

    const globalConfig = await ensureGlobalReady();
    await KeepAlive.init();
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    if (existing) return existing.toJSON();

    const client = createClient(globalConfig.userId);
    const subscription = await client.subscribePush(ACTIVE_MSG_VAPID_PUBLIC_KEY, registration);
    return subscription.toJSON();
  },

  async initTenant(updates: Pick<ActiveMsg2GlobalConfig, 'driver' | 'databaseUrl' | 'initSecret'>) {
    const current = await ensureGlobalReady();
    const databaseUrl = sanitizeActiveMsgDatabaseUrl(updates.databaseUrl);
    const driver = detectActiveMsgDbDriver(databaseUrl, updates.driver);
    if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
      throw new Error('Database URL 需要填写原始 PostgreSQL/Neon 连接串，不要带 psql 命令前缀。');
    }

    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (updates.initSecret?.trim()) {
      headers.set('X-Init-Secret', updates.initSecret.trim());
    }

    try {
      const response = await fetch(`${resolveActiveMsgApiBase()}/init-tenant`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          driver,
          databaseUrl,
        }),
      });
      const json = await safeResponseJson(response);
      if (!response.ok || !json?.success) {
        throw new Error(json?.error?.message || `鍒濆鍖栧け璐?(HTTP ${response.status})`);
      }

      const data = json.data as ActiveMsg2InitTenantResult;
      await ActiveMsgStore.saveGlobalConfig({
        ...current,
        ...updates,
        driver,
        databaseUrl,
        tenantId: data.tenantId,
        tenantToken: data.tenantToken,
        cronToken: data.cronToken,
        cronWebhookUrl: data.cronWebhookUrl,
        masterKeyFingerprint: data.masterKeyFingerprint,
        initializedAt: Date.now(),
      });

      return data;
    } catch (error) {
      throw normalizeActiveMsgApiError(error, '初始化租户');
    }
  },

  async verifyUserKey() {
    const config = await ensureTenantReady();
    await initializeClient(config);
    return {
      ok: true,
      userId: config.userId,
      version: 1,
    };
  },

  async listTasks() {
    const config = await ensureTenantReady();
    const client = await initializeClient(config);
    const response = await fetchWithTenant('messages', config, {
      method: 'GET',
      headers: {
        'X-Response-Encrypted': 'true',
        'X-Encryption-Version': '1',
      },
    }, '璇诲彇浠诲姟鍒楄〃');

    if (!response?.success || response?.encrypted !== true) {
      return response?.data?.tasks || [];
    }

    const decrypted = await decryptPayload(client, response.data);
    return decrypted?.tasks || [];
  },

  async cancelTask(taskUuid: string) {
    const config = await ensureTenantReady();
    const response = await fetchWithTenant(`cancel-message?id=${encodeURIComponent(taskUuid)}`, config, {
      method: 'DELETE',
    }, '鍙栨秷浠诲姟');

    if (!response?.success) {
      throw new Error(response?.error?.message || '取消主动消息 2.0 任务失败。');
    }

    return response.data;
  },

  async scheduleCharacterTask(params: {
    char: CharacterProfile;
    config: ActiveMsg2CharacterConfig;
    userProfile: UserProfile;
    groups: GroupProfile[];
    realtimeConfig: RealtimeConfig;
    apiConfig: APIConfig;
  }) {
    const { char, config, userProfile, groups, realtimeConfig, apiConfig } = params;
    const globalConfig = await ensureTenantReady();
    const client = await initializeClient(globalConfig);
    const pushSubscription = await this.ensurePushSubscription();

    if (config.taskUuid) {
      try {
        await this.cancelTask(config.taskUuid);
      } catch (error) {
        console.warn(`${ACTIVE_MSG_RUNTIME_HEADER} cancel old task failed`, error);
      }
    }

    const firstSendTime = ensureFutureTime(config.firstSendTime);
    const payload: Record<string, any> = {
      contactName: char.name,
      avatarUrl: char.avatar,
      messageType: config.mode,
      messageSubtype: 'chat',
      firstSendTime,
      recurrenceType: config.recurrenceType,
      pushSubscription,
      metadata: {
        charId: char.id,
        charName: char.name,
        source: 'active_msg_2',
      },
    };

    if (config.mode === 'fixed') {
      const userMessage = config.userMessage?.trim();
      if (!userMessage) throw new Error('固定消息模式需要填写消息内容。');
      payload.userMessage = userMessage;
    } else {
      const activeApi = resolveApiConfig(char, config, apiConfig);
      const completePrompt = await buildCompletePrompt(char, config, userProfile, groups, realtimeConfig);
      payload.completePrompt = completePrompt;
      payload.apiUrl = normalizeChatApiUrl(activeApi.baseUrl);
      payload.apiKey = activeApi.apiKey;
      payload.primaryModel = activeApi.model;
      if (config.maxTokens && config.maxTokens > 0) {
        payload.maxTokens = config.maxTokens;
      }
    }

    const encrypted = await encryptPayload(client, payload);
    const response = await fetchWithTenant('schedule-message', globalConfig, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Payload-Encrypted': 'true',
        'X-Encryption-Version': '1',
      },
      body: JSON.stringify(encrypted),
    }, '鍒涘缓浠诲姟');

    if (!response?.success) {
      throw new Error(response?.error?.message || '主动消息 2.0 任务创建失败。');
    }

    return response.data as { uuid: string; status: string; nextSendAt?: string };
  },
};











