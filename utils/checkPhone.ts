import type {
  CharacterProfile,
  PhoneEvidence,
  PhoneEvidenceMeta,
  PhoneEvidenceRisk,
  PhoneEvidenceSource,
  PhoneCheckActionRecord,
  PhoneCheckActionType,
  PhoneCheckDirection,
  PhoneCheckMode,
  PhoneCheckSession,
  PhoneCheckStatusSnapshot,
  PhoneCheckStepRecord,
  XunjiMonitorSnapshot,
  XunjiReportItem,
  XunjiScreenlifeRun,
} from '../types';
import { buildPhoneCityHint } from './charCity';
import { xunjiDurationMinutes, xunjiFormatClock } from './xunji';

export interface CheckPhoneAppDefinition {
  key: string;
  type: string;
  name: string;
  logPrefix: string;
  instruction?: string;
  cityHint?: boolean;
}

export interface CheckPhoneStatusSummary {
  phoneModel: string;
  batteryLevel: number;
  isCharging: boolean;
  unlockCount: number;
  screenTimeMinutes: number;
  generatedAt: number;
  topAppName?: string;
  topAppMinutes?: number;
  topAppNote?: string;
  latestLocation?: string;
  latestNetwork?: string;
}

export interface CheckPhonePromptArgs {
  char: CharacterProfile;
  userName: string;
  type: string;
  context: string;
  recentMessages: string;
  timeGap: string;
  customPrompt?: string;
  appName?: string;
  snapshot?: XunjiMonitorSnapshot | null;
  run?: XunjiScreenlifeRun | null;
  reports?: XunjiReportItem[];
  mode?: PhoneCheckMode;
}

export interface CheckPhonePromptResult {
  prompt: string;
  instruction: string;
  logPrefix: string;
  appName: string;
}

const MAX_DETAIL = 1200;
const RISK_VALUES: PhoneEvidenceRisk[] = ['normal', 'private', 'suspicious'];

export const CHECK_PHONE_MODE_LABELS: Record<PhoneCheckMode, string> = {
  quick: '快速看一眼',
  life: '生活线索',
  relationship: '关系线索',
  deep: '深挖全部',
};

export const CHECK_PHONE_MODE_NOTES: Record<PhoneCheckMode, string> = {
  quick: '只看最近、最明显的手机痕迹，记录少而准，不刻意制造冲突。',
  life: '优先呈现作息、地点、消费、备忘录、健康、日程等生活质感。',
  relationship: '优先呈现联系人、聊天、社交动态、暧昧/冷落/误会等关系线索。',
  deep: '综合生活、关系、消费、位置、健康和浏览痕迹，可以给出更完整的线索链。',
};

export const normalizePhoneCheckMode = (value: unknown): PhoneCheckMode => {
  const raw = asText(value).toLowerCase();
  if (raw === 'quick' || /快速|随便|一眼/.test(raw)) return 'quick';
  if (raw === 'life' || /生活|日常|作息/.test(raw)) return 'life';
  if (raw === 'relationship' || /关系|聊天|暧昧|社交/.test(raw)) return 'relationship';
  if (raw === 'deep' || /深挖|全部|完整/.test(raw)) return 'deep';
  return 'life';
};

const riskWeight = (risk?: PhoneEvidenceRisk): number => {
  if (risk === 'suspicious') return 0.16;
  if (risk === 'private') return 0.08;
  return 0.02;
};

const actionRiskWeight = (type: PhoneCheckActionType): number => {
  switch (type) {
    case 'delete_record': return 0.2;
    case 'send_as_character':
    case 'char_reply': return 0.24;
    case 'post_moment_as_character':
    case 'char_post_moment': return 0.28;
    case 'char_block':
    case 'char_delete': return 0.3;
    case 'char_clear_cart': return 0.18;
    case 'intrusion_caught': return 0.26;
    case 'confront': return 0.12;
    case 'refresh_app': return 0.04;
    case 'collect_evidence': return 0.03;
    default: return 0.01;
  }
};

export const CHECK_PHONE_APP_DEFS: CheckPhoneAppDefinition[] = [
  { key: 'chat', type: 'chat', name: '信息', logPrefix: '聊天软件' },
  { key: 'call', type: 'call', name: '电话', logPrefix: '通话记录' },
  { key: 'taobao', type: 'order', name: '购物', logPrefix: '购物APP', cityHint: true },
  { key: 'waimai', type: 'delivery', name: '外卖', logPrefix: '外卖APP', cityHint: true },
  { key: 'social', type: 'social', name: '动态', logPrefix: '朋友圈' },
  {
    key: 'notes',
    type: 'notes',
    name: '备忘录',
    logPrefix: '备忘录',
    instruction: '生成 3 条该角色备忘录/便签里的内容（待办、随手记、藏起来的心事、清单等，贴人设）。',
  },
  {
    key: 'wallet',
    type: 'wallet',
    name: '钱包',
    logPrefix: '钱包',
    instruction: '生成该角色钱包里的账户余额 + 2~3 笔最近收支（金额必须符合人设身份）。',
  },
  {
    key: 'album',
    type: 'album',
    name: '相册',
    logPrefix: '相册',
    instruction: '生成 3~4 条该角色相册里照片的文字描述（拍了什么、当时的场景与心情，贴人设）。',
  },
  {
    key: 'music',
    type: 'music',
    name: '音乐',
    logPrefix: '音乐',
    instruction: '生成该角色最近在听的 3~4 首歌（歌名+歌手+为什么循环它，贴人设与近期心境）。',
  },
  {
    key: 'browser',
    type: 'browser',
    name: '浏览',
    logPrefix: '浏览记录',
    instruction: '生成 3~4 条该角色最近的浏览器搜索/浏览记录（搜了什么，能侧面透出 TA 的关心或小秘密，贴人设）。',
  },
  {
    key: 'map',
    type: 'map',
    name: '地图',
    logPrefix: '地图足迹',
    cityHint: true,
    instruction: '生成 3~4 条该角色最近在地图/定位/打车软件里的地点记录（去过哪里、收藏了什么地点、搜过哪条路线）。地点要贴合角色城市与人设，不要都写景点。',
  },
  {
    key: 'health',
    type: 'health',
    name: '健康',
    logPrefix: '健康',
    instruction: '生成该角色今天的健康数据（步数、睡眠、心率等 3~4 项，数值贴人设作息）。',
  },
  {
    key: 'calendar',
    type: 'calendar',
    name: '日历',
    logPrefix: '日历',
    instruction: '生成 3~4 条该角色日历上的日程/待办（贴人设的工作、约会、提醒）。',
  },
];

export function getCheckPhoneAppDefinition(type: string): CheckPhoneAppDefinition | undefined {
  return CHECK_PHONE_APP_DEFS.find(app => app.type === type || app.key === type);
}

const asText = (value: unknown, fallback = ''): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(item => asText(item)).filter(Boolean).join('\n');
  return fallback;
};

const normalizeTags = (value: unknown): string[] | undefined => {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[，,、\s]+/) : [];
  const tags = raw.map(item => asText(item).replace(/^#/, '')).filter(Boolean).slice(0, 6);
  return tags.length ? tags : undefined;
};

const normalizeRisk = (value: unknown, text: string): PhoneEvidenceRisk => {
  const risk = asText(value).toLowerCase() as PhoneEvidenceRisk;
  if (RISK_VALUES.includes(risk)) return risk;
  if (/暧昧|删除|藏|秘密|撒谎|转账|定位|酒店|药|前任|拉黑|投诉/.test(text)) return 'suspicious';
  if (/心事|私密|不想让|没发出|草稿|账单|余额|健康|睡眠|地址/.test(text)) return 'private';
  return 'normal';
};

const normalizeSource = (value: unknown, fallback: PhoneEvidenceSource): PhoneEvidenceSource => {
  const source = asText(value) as PhoneEvidenceSource;
  return ['generated', 'xunji', 'user_action', 'custom'].includes(source) ? source : fallback;
};

function extractPayload(raw: string): unknown {
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  if (!cleaned) return [];
  const firstArray = cleaned.indexOf('[');
  const firstObject = cleaned.indexOf('{');
  const startsWithArray = firstArray >= 0 && (firstObject < 0 || firstArray < firstObject);
  const start = startsWithArray ? firstArray : firstObject;
  const end = startsWithArray ? cleaned.lastIndexOf(']') : cleaned.lastIndexOf('}');
  const candidate = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  return JSON.parse(candidate);
}

function unwrapPayload(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  const obj = value as Record<string, unknown>;
  for (const key of ['records', 'items', 'data', 'results', 'evidence', 'list']) {
    if (Array.isArray(obj[key])) return obj[key] as unknown[];
  }
  if ('title' in obj || 'detail' in obj || 'content' in obj || 'summary' in obj) return [obj];
  return [];
}

export function parsePhoneEvidenceJson(raw: string, opts: {
  type: string;
  appName?: string;
  source?: PhoneEvidenceSource;
  now?: number;
}): PhoneEvidence[] {
  try {
    return unwrapPayload(extractPayload(raw)).map((item, index) => normalizePhoneEvidence(item, { ...opts, index }));
  } catch {
    return [];
  }
}

export function normalizePhoneEvidence(item: unknown, opts: {
  type: string;
  appName?: string;
  source?: PhoneEvidenceSource;
  now?: number;
  index?: number;
}): PhoneEvidence {
  const obj = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
  const metaObj = (obj.meta && typeof obj.meta === 'object' ? obj.meta : {}) as Record<string, unknown>;
  const title = asText(obj.title, asText(obj.name, asText(obj.target, 'Unknown'))).slice(0, 80) || 'Unknown';
  const detail = asText(
    obj.detail,
    asText(obj.summary, asText(obj.content, asText(obj.body, asText(obj.note, asText(obj.description, '...'))))),
  ).slice(0, MAX_DETAIL) || '...';
  const value = asText(obj.value, asText(obj.status, asText(obj.amount, asText(obj.time, '')))).slice(0, 80) || undefined;
  const textForRisk = `${title}\n${detail}\n${value || ''}`;
  const participants = [
    ...((Array.isArray(obj.participants) ? obj.participants : []) as unknown[]),
    obj.contact,
    obj.target,
  ].map(v => asText(v)).filter(Boolean).slice(0, 8);
  const meta: PhoneEvidenceMeta = {
    ...metaObj,
    source: normalizeSource(metaObj.source ?? obj.source, opts.source || 'generated'),
    appName: asText(metaObj.appName, opts.appName || getCheckPhoneAppDefinition(opts.type)?.name || opts.type),
    tags: normalizeTags(metaObj.tags ?? obj.tags),
    risk: normalizeRisk(metaObj.risk ?? obj.risk, textForRisk),
    participants: participants.length ? participants : Array.isArray(metaObj.participants) ? (metaObj.participants as unknown[]).map(v => asText(v)).filter(Boolean) : undefined,
    locationLabel: asText(metaObj.locationLabel, asText(obj.location, asText(obj.address, ''))) || undefined,
    amount: asText(metaObj.amount, asText(obj.amount, '')) || undefined,
    status: asText(metaObj.status, asText(obj.status, '')) || undefined,
  };

  return {
    id: asText(obj.id) || `rec-${opts.now || Date.now()}-${opts.index || 0}-${Math.random().toString(36).slice(2, 8)}`,
    type: asText(obj.type, opts.type) || opts.type,
    title,
    detail,
    value,
    timestamp: Number(obj.timestamp) || opts.now || Date.now(),
    systemMessageId: typeof obj.systemMessageId === 'number' ? obj.systemMessageId : undefined,
    meta,
  };
}

export function makePhoneCheckAction(input: {
  type: PhoneCheckActionType;
  label: string;
  detail?: string;
  app?: string;
  targetName?: string;
  recordId?: string;
  risk?: PhoneEvidenceRisk;
  riskDelta?: number;
  metadata?: Record<string, any>;
  at?: number;
}): PhoneCheckActionRecord {
  const at = input.at || Date.now();
  return {
    id: `pca-${at}-${Math.random().toString(36).slice(2, 8)}`,
    at,
    type: input.type,
    label: input.label,
    detail: input.detail,
    app: input.app,
    targetName: input.targetName,
    recordId: input.recordId,
    risk: input.risk,
    riskDelta: input.riskDelta ?? actionRiskWeight(input.type),
    metadata: input.metadata,
  };
}

export function normalizePhoneCheckStep(value: unknown, fallbackAt = Date.now()): PhoneCheckStepRecord {
  const obj = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    at: Number(obj.at) || fallbackAt,
    app: asText(obj.app) || undefined,
    title: asText(obj.title) || undefined,
    targetName: asText(obj.targetName) || undefined,
    thought: asText(obj.thought).slice(0, 300) || undefined,
    intent: asText(obj.intent).slice(0, 80) || undefined,
    emotion: asText(obj.emotion).slice(0, 40) || undefined,
    risk: RISK_VALUES.includes(asText(obj.risk).toLowerCase() as PhoneEvidenceRisk) ? asText(obj.risk).toLowerCase() as PhoneEvidenceRisk : undefined,
    visibleClue: asText(obj.visibleClue).slice(0, 240) || undefined,
    actionReason: asText(obj.actionReason).slice(0, 240) || undefined,
    detail: asText(obj.detail).slice(0, 400) || undefined,
  };
}

export function createPhoneCheckSession(input: {
  direction: PhoneCheckDirection;
  charId: string;
  charName?: string;
  userName?: string;
  mode?: PhoneCheckMode;
  statusSnapshot?: PhoneCheckStatusSnapshot | null;
  startedAt?: number;
}): PhoneCheckSession {
  const startedAt = input.startedAt || Date.now();
  const mode = normalizePhoneCheckMode(input.mode || 'life');
  return {
    id: `pcs-${input.direction}-${input.charId}-${startedAt}-${Math.random().toString(36).slice(2, 8)}`,
    direction: input.direction,
    charId: input.charId,
    charName: input.charName,
    userName: input.userName,
    mode,
    startedAt,
    status: 'active',
    statusSnapshot: input.statusSnapshot || null,
    steps: [],
    evidence: [],
    actions: [makePhoneCheckAction({
      type: 'start',
      label: `${input.direction === 'user_to_char' ? '用户开始查 TA 手机' : 'TA 开始查用户手机'} · ${CHECK_PHONE_MODE_LABELS[mode]}`,
      riskDelta: 0,
      at: startedAt,
    })],
  };
}

export function normalizePhoneCheckSession(value: unknown): PhoneCheckSession {
  const obj = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const direction = obj.direction === 'char_to_user' ? 'char_to_user' : 'user_to_char';
  const charId = asText(obj.charId, 'unknown');
  const startedAt = Number(obj.startedAt) || Date.now();
  const mode = normalizePhoneCheckMode(obj.mode);
  const status = obj.status === 'finished' || obj.status === 'interrupted' ? obj.status : 'active';
  const evidence = Array.isArray(obj.evidence)
    ? obj.evidence.map((item, index) => normalizePhoneEvidence(item, {
      type: (item as PhoneEvidence)?.type || 'notes',
      appName: (item as PhoneEvidence)?.meta?.appName,
      source: (item as PhoneEvidence)?.meta?.source || 'generated',
      now: startedAt + index,
      index,
    }))
    : [];
  const steps = Array.isArray(obj.steps) ? obj.steps.map((step, index) => normalizePhoneCheckStep(step, startedAt + index)) : [];
  const actions = Array.isArray(obj.actions)
    ? obj.actions.map((item, index) => {
      const raw = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      const type = asText(raw.type) as PhoneCheckActionType;
      return {
        id: asText(raw.id) || `pca-${startedAt}-${index}`,
        at: Number(raw.at) || startedAt + index,
        type: ([
          'start', 'refresh_status', 'refresh_app', 'collect_evidence', 'clear_evidence', 'confront',
          'delete_record', 'send_as_character', 'post_moment_as_character', 'intrusion_caught',
          'browse_step', 'char_reply', 'char_block', 'char_delete', 'char_ignore', 'char_post_moment',
          'char_clear_cart', 'exit',
        ].includes(type) ? type : 'browse_step') as PhoneCheckActionType,
        label: asText(raw.label, '查岗动作'),
        detail: asText(raw.detail) || undefined,
        app: asText(raw.app) || undefined,
        targetName: asText(raw.targetName) || undefined,
        recordId: asText(raw.recordId) || undefined,
        risk: RISK_VALUES.includes(asText(raw.risk).toLowerCase() as PhoneEvidenceRisk) ? asText(raw.risk).toLowerCase() as PhoneEvidenceRisk : undefined,
        riskDelta: Number(raw.riskDelta) || undefined,
        metadata: raw.metadata && typeof raw.metadata === 'object' ? raw.metadata as Record<string, any> : undefined,
      };
    })
    : [];
  return {
    id: asText(obj.id) || `pcs-${direction}-${charId}-${startedAt}`,
    direction,
    charId,
    charName: asText(obj.charName) || undefined,
    userName: asText(obj.userName) || undefined,
    mode,
    startedAt,
    endedAt: Number(obj.endedAt) || undefined,
    status,
    statusSnapshot: obj.statusSnapshot && typeof obj.statusSnapshot === 'object' ? obj.statusSnapshot as PhoneCheckStatusSnapshot : null,
    steps,
    evidence,
    actions,
    exitMode: asText(obj.exitMode) as PhoneCheckSession['exitMode'] || undefined,
    summary: asText(obj.summary) || undefined,
    moodAfter: asText(obj.moodAfter) || undefined,
    systemMessageId: typeof obj.systemMessageId === 'number' ? obj.systemMessageId : undefined,
  };
}

export function summarizeEvidenceTrail(records: PhoneEvidence[], limit = 8): string {
  if (!records.length) return '没有收进证据篮的线索。';
  return records.slice(0, limit).map((record, index) => {
    const appName = record.meta?.appName || getCheckPhoneAppDefinition(record.type)?.name || record.type || '手机';
    const source = record.meta?.source === 'xunji' ? '循迹' : record.meta?.source === 'custom' ? '自装 App' : record.meta?.source === 'user_action' ? '越界操作' : '生成';
    const risk = record.meta?.risk === 'suspicious' ? '可疑' : record.meta?.risk === 'private' ? '私密' : '普通';
    const people = record.meta?.participants?.length ? `；相关人：${record.meta.participants.join('、')}` : '';
    return `${index + 1}. ${appName} / ${source} / ${risk}：「${record.title}」${record.value ? `（${record.value}）` : ''}${people}\n${record.detail}`;
  }).join('\n\n');
}

export function calculatePhoneCheckRisk(actions: PhoneCheckActionRecord[] = [], evidence: PhoneEvidence[] = []): number {
  const actionScore = actions.reduce((sum, action) => sum + (typeof action.riskDelta === 'number' ? action.riskDelta : actionRiskWeight(action.type)), 0);
  const evidenceScore = evidence.reduce((sum, record) => sum + riskWeight(record.meta?.risk), 0);
  return Math.max(0, Math.min(0.92, 0.08 + actionScore + evidenceScore));
}

export function estimatePhoneCheckAwareness(args: {
  actions?: PhoneCheckActionRecord[];
  evidence?: PhoneEvidence[];
  profileText?: string;
  base?: number;
}): number {
  const text = (args.profileText || '').toLowerCase();
  let score = args.base ?? calculatePhoneCheckRisk(args.actions || [], args.evidence || []);
  if (/(敏感|警觉|多疑|占有|控制|侦探|黑客|安全|边界|洁癖|细节|反侦察)/i.test(text)) score += 0.18;
  if (/(迟钝|大条|粗心|天然|信任|温柔|随和)/i.test(text)) score -= 0.12;
  return Math.max(0.04, Math.min(0.95, score));
}

export function buildPhoneCheckSessionSummary(session: PhoneCheckSession, fallbackCharName = 'TA', fallbackUserName = '用户'): string {
  const charName = session.charName || fallbackCharName;
  const userName = session.userName || fallbackUserName;
  const actor = session.direction === 'user_to_char' ? userName : charName;
  const owner = session.direction === 'user_to_char' ? charName : userName;
  const parts = [
    `${actor}查了${owner}的手机（${CHECK_PHONE_MODE_LABELS[session.mode]}）。`,
    session.statusSnapshot?.phoneModel ? `开场手机状态：${session.statusSnapshot.phoneModel}，电量 ${session.statusSnapshot.batteryLevel ?? '--'}%，屏幕 ${session.statusSnapshot.screenTimeMinutes ?? '--'} 分钟。` : '',
    session.steps.length ? `浏览过程：${session.steps.slice(0, 5).map(step => step.title || step.app || step.visibleClue || step.thought).filter(Boolean).join('；')}。` : '',
    session.evidence.length ? `收集线索：${session.evidence.slice(0, 4).map(record => `${record.meta?.appName || record.type}「${record.title}」`).join('；')}。` : '',
    session.actions.filter(action => action.type !== 'start' && action.type !== 'browse_step').length
      ? `发生动作：${session.actions.filter(action => action.type !== 'start' && action.type !== 'browse_step').slice(0, 5).map(action => action.label).join('；')}。`
      : '',
    session.exitMode ? `结局：${session.exitMode}。` : '',
    session.moodAfter ? `余波：${session.moodAfter}` : '',
  ].filter(Boolean);
  return parts.join('\n');
}

export function buildCheckPhoneStatusSummary(snapshot?: XunjiMonitorSnapshot | null): CheckPhoneStatusSummary | null {
  if (!snapshot) return null;
  const topApp = [...snapshot.appUsage].sort((a, b) => xunjiDurationMinutes(b) - xunjiDurationMinutes(a))[0];
  const latestLocation = [...snapshot.locations].sort((a, b) => (b.arrivedAt || 0) - (a.arrivedAt || 0))[0];
  const latestNetwork = [...snapshot.networks].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))[0];
  return {
    phoneModel: snapshot.phoneModel,
    batteryLevel: snapshot.batteryLevel,
    isCharging: snapshot.isCharging,
    unlockCount: snapshot.unlockCount,
    screenTimeMinutes: snapshot.screenTimeMinutes,
    generatedAt: snapshot.generatedAt,
    topAppName: topApp?.appName,
    topAppMinutes: topApp ? xunjiDurationMinutes(topApp) : undefined,
    topAppNote: topApp?.note,
    latestLocation: latestLocation ? `${latestLocation.label}${latestLocation.address ? ` · ${latestLocation.address}` : ''}` : undefined,
    latestNetwork: latestNetwork ? `${latestNetwork.type === 'wifi' ? 'Wi-Fi' : '移动数据'} · ${latestNetwork.name}` : undefined,
  };
}

export function formatCheckPhoneStatusForPrompt(status?: CheckPhoneStatusSummary | null): string {
  if (!status) return '暂无循迹快照；请按角色人设生成一台合理的虚拟手机状态。';
  return [
    `机型：${status.phoneModel}`,
    `电量：${status.batteryLevel}%${status.isCharging ? '，正在充电' : ''}`,
    `今日解锁：${status.unlockCount} 次`,
    `屏幕使用：${status.screenTimeMinutes} 分钟`,
    status.topAppName ? `停留最久 App：${status.topAppName}${status.topAppMinutes ? ` ${status.topAppMinutes} 分钟` : ''}${status.topAppNote ? `，${status.topAppNote}` : ''}` : '',
    status.latestLocation ? `最近地点：${status.latestLocation}` : '',
    status.latestNetwork ? `当前网络：${status.latestNetwork}` : '',
    `快照时间：${new Date(status.generatedAt).toLocaleString('zh-CN')}`,
  ].filter(Boolean).join('\n');
}

function baseInstruction(type: string, char: CharacterProfile): string {
  if (type === 'chat') {
    return [
      '生成 3 个该角色手机聊天软件中的对话片段。',
      '联系人要贴合人设，不要使用“User”作为联系人。',
      '内容必须是有来有回的对话脚本（3-4句），体现关系和近期状态。',
      'detail 必须严格使用“我: ...”“对方: ...”或“联系人名: ...”分行。',
    ].join('\n');
  }
  if (type === 'call') return '生成 3 条该角色的近期通话记录，value 写“呼入/呼出/未接 + 时长”，detail 写通话缘由。';
  if (type === 'order') return `生成 3 条该角色最近的购物订单。${buildPhoneCityHint(char)}`;
  if (type === 'delivery') return `生成 3 条该角色最近的外卖记录。${buildPhoneCityHint(char)}`;
  if (type === 'social') return '生成 2-3 条该角色的朋友圈/社交媒体动态，像真实手机里留下的状态，不要像公告。';
  const def = getCheckPhoneAppDefinition(type);
  if (!def?.instruction) return '';
  return `${def.instruction}${def.cityHint ? `\n${buildPhoneCityHint(char)}` : ''}`;
}

function buildXunjiPromptBlock(snapshot?: XunjiMonitorSnapshot | null, run?: XunjiScreenlifeRun | null, reports: XunjiReportItem[] = []): string {
  const status = formatCheckPhoneStatusForPrompt(buildCheckPhoneStatusSummary(snapshot));
  const runLines = run ? [
    `最近 Screenlife：${run.title}`,
    run.narrative,
    run.chats.length ? `近期聊天线索：${run.chats.slice(0, 3).map(c => `${c.target}：${c.summary}`).join('；')}` : '',
    run.browsed.length ? `浏览线索：${run.browsed.slice(0, 3).map(b => `${b.appName}/${b.title}`).join('；')}` : '',
    run.notes.length ? `随手记：${run.notes.slice(0, 3).map(n => n.text).join('；')}` : '',
  ].filter(Boolean).join('\n') : '暂无最近 Screenlife 演出。';
  const reportLines = reports.length ? reports.slice(0, 6).map(r => `${xunjiFormatClock(r.timestamp)} ${r.title}：${r.body}`).join('\n') : '暂无事件提醒。';
  return `### [Phone Screenlife Snapshot]\n${status}\n\n### [Recent Screenlife]\n${runLines}\n\n### [Recent Monitor Reports]\n${reportLines}`;
}

export function buildCheckPhoneRecordPrompt(args: CheckPhonePromptArgs): CheckPhonePromptResult | null {
  const custom = args.customPrompt?.trim();
  const def = getCheckPhoneAppDefinition(args.type);
  const appName = args.appName || def?.name || args.type;
  const mode = normalizePhoneCheckMode(args.mode);
  const instruction = custom
    ? [
      `用户正在查看你的手机 App：“${appName}”。`,
      `该 App 的功能/用户想看的内容是：“${custom}”。`,
      '请生成 2-4 条符合该 App 功能的记录，必须符合你的人设。',
    ].join('\n')
    : baseInstruction(args.type, args.char);
  if (!instruction) return null;
  const outputShape = [
    '只输出 JSON 数组，不要 markdown，不要解释。',
    '每条格式：{"title":"标题/对象/项目名","detail":"详细内容","value":"可选状态或数值","meta":{"tags":["短标签"],"risk":"normal|private|suspicious","participants":["相关人"],"locationLabel":"可选地点","amount":"可选金额","status":"可选状态"}}',
    'risk 用来标注隐私/可疑程度；普通生活填 normal，私密心事填 private，可能引发对峙的矛盾线索填 suspicious。',
  ].join('\n');
  const prompt = [
    args.context,
    `### [Current Status]\n时间距离上次互动：${args.timeGap}`,
    buildXunjiPromptBlock(args.snapshot, args.run, args.reports || []),
    `### [Recent Chat Context]\n${args.recentMessages || '暂无最近聊天。'}`,
    `### [Check Mode]\n${CHECK_PHONE_MODE_LABELS[mode]}：${CHECK_PHONE_MODE_NOTES[mode]}`,
    `### [Task]\n${instruction}`,
    '请让记录和上面的手机状态、近期 Screenlife、最近聊天彼此一致，不要各编各的。',
    '这是虚拟手机剧情生成，不要声称读取真实手机、真实联系人或真实 App。',
    outputShape,
  ].join('\n\n');
  return { prompt, instruction, logPrefix: def?.logPrefix || appName, appName };
}

function inferRecordType(appName = ''): string {
  if (/外卖|美团|饿了么|饭|餐|咖啡|奶茶/.test(appName)) return 'delivery';
  if (/淘宝|京东|购物|拼多多|订单/.test(appName)) return 'order';
  if (/微信|QQ|消息|Line|聊天|私信|絮语/.test(appName)) return 'chat';
  if (/微博|小红书|朋友圈|动态|社交|X|Twitter/.test(appName)) return 'social';
  if (/地图|打车|导航|定位/.test(appName)) return 'map';
  if (/音乐|歌|播客/.test(appName)) return 'music';
  if (/相册|照片|图库/.test(appName)) return 'album';
  if (/日历|待办|提醒/.test(appName)) return 'calendar';
  if (/健康|睡眠|运动|步数/.test(appName)) return 'health';
  return 'browser';
}

export function mapXunjiToPhoneEvidence(args: {
  run?: XunjiScreenlifeRun | null;
  snapshot?: XunjiMonitorSnapshot | null;
  reports?: XunjiReportItem[];
  now?: number;
}): PhoneEvidence[] {
  const now = args.now || Date.now();
  const records: PhoneEvidence[] = [];
  const push = (record: Omit<PhoneEvidence, 'timestamp'> & { timestamp?: number }) => {
    records.push({ ...record, timestamp: record.timestamp ?? now, meta: { source: 'xunji', ...(record.meta || {}) } });
  };

  args.run?.chats.slice(0, 6).forEach(chat => push({
    id: `xunji-${args.run!.id}-chat-${chat.id}`,
    type: 'chat',
    title: chat.target,
    detail: chat.messages?.length ? chat.messages.join('\n') : `对方: ${chat.summary}\n我: 嗯，我知道。`,
    value: xunjiFormatClock(chat.time),
    timestamp: chat.time,
    meta: { appName: '信息', relatedXunjiRunId: args.run!.id, participants: [chat.target], risk: normalizeRisk(undefined, chat.summary) },
  }));
  args.run?.browsed.slice(0, 8).forEach(item => push({
    id: `xunji-${args.run!.id}-browse-${item.id}`,
    type: inferRecordType(item.appName),
    title: item.title,
    detail: `${item.appName} · ${item.summary}`,
    value: xunjiFormatClock(item.time),
    timestamp: item.time,
    meta: { appName: getCheckPhoneAppDefinition(inferRecordType(item.appName))?.name || item.appName, relatedXunjiRunId: args.run!.id, tags: [item.appName], risk: normalizeRisk(undefined, item.summary) },
  }));
  args.run?.notes.slice(0, 5).forEach(note => push({
    id: `xunji-${args.run!.id}-note-${note.id}`,
    type: 'notes',
    title: '随手记',
    detail: note.text,
    value: xunjiFormatClock(note.time),
    timestamp: note.time,
    meta: { appName: '备忘录', relatedXunjiRunId: args.run!.id, risk: normalizeRisk(undefined, note.text) },
  }));
  args.run?.moments?.slice(0, 5).forEach(moment => push({
    id: `xunji-${args.run!.id}-moment-${moment.id}`,
    type: 'social',
    title: moment.title,
    detail: moment.body,
    value: xunjiFormatClock(moment.time),
    timestamp: moment.time,
    meta: { appName: '动态', relatedXunjiRunId: args.run!.id, tags: [moment.tone, moment.relatedApp || ''].filter(Boolean), risk: moment.tone === 'private' ? 'private' : 'normal' },
  }));

  args.snapshot?.calls.slice(0, 5).forEach(call => push({
    id: `xunji-${args.snapshot!.id}-call-${call.id}`,
    type: 'call',
    title: call.target,
    detail: `循迹记录到一次${call.status === 'missed' ? '未接' : call.status === 'outgoing' ? '呼出' : '通话'}，持续 ${call.durationMinutes} 分钟。`,
    value: `${call.status === 'missed' ? '未接' : call.status === 'outgoing' ? '呼出' : '呼入'} (${call.durationMinutes}分钟)`,
    timestamp: call.startedAt,
    meta: { appName: '电话', relatedXunjiSnapshotId: args.snapshot!.id, participants: [call.target], risk: call.status === 'missed' ? 'private' : 'normal' },
  }));
  args.snapshot?.locations.slice(-5).forEach(loc => push({
    id: `xunji-${args.snapshot!.id}-loc-${loc.id}`,
    type: 'map',
    title: loc.label,
    detail: `${loc.address}${loc.stayMinutes ? ` · 停留 ${loc.stayMinutes} 分钟` : ''}${loc.transport ? ` · ${loc.transport}` : ''}`,
    value: xunjiFormatClock(loc.arrivedAt),
    timestamp: loc.arrivedAt,
    meta: { appName: '地图', relatedXunjiSnapshotId: args.snapshot!.id, locationLabel: loc.label, risk: 'private' },
  }));
  args.snapshot?.appUsage.slice(0, 6).forEach(session => push({
    id: `xunji-${args.snapshot!.id}-app-${session.id}`,
    type: inferRecordType(session.appName),
    title: session.appName,
    detail: session.note || `使用了 ${xunjiDurationMinutes(session)} 分钟。`,
    value: `${xunjiDurationMinutes(session)} 分钟`,
    timestamp: session.startedAt,
    meta: { appName: getCheckPhoneAppDefinition(inferRecordType(session.appName))?.name || session.appName, relatedXunjiSnapshotId: args.snapshot!.id, tags: [session.category || '屏幕时间'], risk: normalizeRisk(undefined, session.note || session.appName) },
  }));
  if (args.snapshot?.health) {
    const h = args.snapshot.health;
    push({
      id: `xunji-${args.snapshot.id}-health-summary`,
      type: 'health',
      title: '今日健康摘要',
      detail: `${h.stressLabel}；睡眠 ${Math.round(h.sleepMinutes / 60 * 10) / 10} 小时（${h.sleepQuality}）；步数 ${h.steps}。`,
      value: `${h.heartRateLatest} bpm`,
      timestamp: h.timestamp,
      meta: { appName: '健康', relatedXunjiSnapshotId: args.snapshot.id, risk: 'private' },
    });
  }
  args.reports?.slice(0, 6).forEach(report => push({
    id: `xunji-report-${report.id}`,
    type: report.relatedApp ? inferRecordType(report.relatedApp) : report.type.startsWith('call') ? 'call' : report.type.startsWith('sleep') ? 'health' : report.type.includes('move') || report.type.includes('stay') || report.type.includes('arrive') ? 'map' : 'notes',
    title: report.title,
    detail: report.body,
    value: xunjiFormatClock(report.timestamp),
    timestamp: report.timestamp,
    meta: { appName: report.relatedApp || '循迹提醒', relatedReportId: report.id, tags: [report.type], risk: report.severity === 'warning' ? 'suspicious' : 'normal' },
  }));
  return records;
}

export function mergePhoneEvidenceRecords(primary: PhoneEvidence[], secondary: PhoneEvidence[]): PhoneEvidence[] {
  const seen = new Set<string>();
  const result: PhoneEvidence[] = [];
  [...primary, ...secondary].forEach(record => {
    const key = record.id || `${record.type}:${record.title}:${record.detail}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push(record);
  });
  return result;
}

export function buildEvidenceConfrontText(records: PhoneEvidence[], charName: string): string {
  const lines = records.slice(0, 8).map((record, index) => {
    const appName = record.meta?.appName || getCheckPhoneAppDefinition(record.type)?.name || record.type || '手机';
    const value = record.value ? `（${record.value}）` : '';
    return `${index + 1}. ${appName}：「${record.title}」${value}\n${record.detail}`;
  });
  return `（我翻了你的手机，收集到这些线索：\n${lines.join('\n\n')}\n）\n——${charName}，这些你想怎么解释？`;
}

export function systemMessageForPhoneEvidence(charName: string, record: PhoneEvidence, logPrefix?: string): string {
  const appName = logPrefix || record.meta?.appName || getCheckPhoneAppDefinition(record.type)?.logPrefix || '手机';
  if (record.type === 'chat') {
    return `[系统: ${charName} 与 "${record.title}" 的聊天记录-内容涉及: ${record.detail.replace(/\n/g, ' ')}]`;
  }
  return `[系统: ${charName}的手机(${appName}) 显示: ${record.title} - ${record.detail}]`;
}
