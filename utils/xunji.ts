import type {
  CharacterProfile,
  XunjiAppUsageSession,
  XunjiBatteryEvent,
  XunjiCallRecord,
  XunjiDensity,
  XunjiGeneratedMoment,
  XunjiLocationPoint,
  XunjiMonitorSnapshot,
  XunjiNetworkRecord,
  XunjiReportItem,
  XunjiReportType,
  XunjiScreenlifeRun,
  XunjiSettings,
  XunjiSocialInference,
  XunjiTransport,
} from '../types';
import { xunjiChatContextBlock } from './laiwangPrompts';
import { makeApiUsageMeta } from './apiUsageCatalog';
import { callChatCompletion } from './llmClient';
import { extractContent } from './safeApi';

export const XUNJI_REPORT_EVENT = 'moro-xunji-report';

export interface XunjiReportEventDetail {
  charId: string;
  charName?: string;
  reportId: string;
  title: string;
  body: string;
  severity?: XunjiReportItem['severity'];
  count: number;
  at: number;
}

export const XUNJI_REPORT_TYPES: XunjiReportType[] = [
  'unlock_count',
  'network_switch',
  'app_open',
  'app_close',
  'app_hourly',
  'charge_start',
  'charge_end',
  'move_start',
  'stay',
  'transit',
  'arrive',
  'call_start',
  'call_10min',
  'sleep_phone_off',
  'sleep_late_reminder',
  'sleep_5h',
  'sleep_end',
];

export const DEFAULT_XUNJI_REPORT_RULES: Record<XunjiReportType, boolean> = XUNJI_REPORT_TYPES.reduce((acc, type) => {
  acc[type] = true;
  return acc;
}, {} as Record<XunjiReportType, boolean>);

export const XUNJI_REPORT_LABELS: Record<XunjiReportType, string> = {
  unlock_count: '手机解锁次数',
  network_switch: '网络切换',
  app_open: '进入软件',
  app_close: '关闭软件',
  app_hourly: '软件使用每小时提醒',
  charge_start: '开始充电',
  charge_end: '结束充电',
  move_start: '开始移动',
  stay: '停留位置',
  transit: '乘车信息',
  arrive: '到达信息',
  call_start: '拨打电话',
  call_10min: '电话十分钟提醒',
  sleep_phone_off: '关闭手机进入睡眠',
  sleep_late_reminder: '9 点后未进入睡眠提醒',
  sleep_5h: '睡眠 5 小时提醒',
  sleep_end: '睡眠结束',
};

export function notifyXunjiReports(items: XunjiReportItem[], char?: CharacterProfile | null): void {
  const pending = items.filter(item => !item.acknowledged);
  if (!pending.length) return;
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  const latest = [...pending].sort((a, b) => b.timestamp - a.timestamp)[0];
  if (!latest) return;
  const detail: XunjiReportEventDetail = {
    charId: latest.charId,
    charName: char?.name,
    reportId: latest.id,
    title: latest.title,
    body: latest.body,
    severity: latest.severity,
    count: pending.length,
    at: Date.now(),
  };
  try {
    window.dispatchEvent(new CustomEvent<XunjiReportEventDetail>(XUNJI_REPORT_EVENT, { detail }));
  } catch {
    // Notification fan-out is best effort; reports are already persisted before this helper runs.
  }
}

export interface XunjiApiConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
}

export interface XunjiLocationSource {
  mode: 'character' | 'browser';
  customLocation?: string;
  browserLocation?: {
    lat: number;
    lng: number;
    accuracy?: number;
    capturedAt: number;
  };
}

const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;
const XUNJI_AUTO_TRACE_MIN_INTERVAL = 35 * MIN;
const XUNJI_AUTO_TRACE_MAX_WINDOW = 3 * HOUR;

const PHONE_MODELS = ['Moro Phone 15 Pro', 'Nimbus X2', 'Pixel Fold Mini', 'iPhone 15', 'Galaxy S24', 'Nothing Phone (2)'];
const WIFI_NAMES = ['HOME-5G', 'Moro Cafe', 'Library_Free', 'Apt-802', 'MoonRail-WiFi', 'Studio_2F'];
const CARRIERS = ['中国移动 5G', '中国联通 5G', '中国电信 5G'];
const CHAT_TARGETS = ['朋友', '同事', '家人', '群聊', '店员', '项目搭子'];
const BROWSE_TITLES = ['同城探店收藏', '天气和通勤提醒', '短视频收藏夹', '旧照片回看', '歌单评论区', '便利店新品'];
const NOTE_LINES = ['晚点记得回消息', '把今天那句好笑的话留一下', '想买的东西先别冲动', '今天心情比早上稳一点', '下次路过要拍给你看'];

const APP_LIBRARY = [
  { appName: '微信', icon: '💬', category: '聊天' },
  { appName: '小红书', icon: '📕', category: '社交' },
  { appName: '网易云音乐', icon: '🎧', category: '音乐' },
  { appName: '地图', icon: '🗺️', category: '出行' },
  { appName: '备忘录', icon: '📝', category: '效率' },
  { appName: '相册', icon: '🖼️', category: '生活' },
  { appName: '浏览器', icon: '🌐', category: '资讯' },
  { appName: '外卖', icon: '🍱', category: '生活' },
  { appName: '视频', icon: '▶️', category: '娱乐' },
  { appName: '日历', icon: '📅', category: '效率' },
];

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rngFrom(seed: string): () => number {
  let t = hashSeed(seed) || 1;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const pad2 = (n: number) => String(n).padStart(2, '0');
const dayStart = (now: number) => {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const atToday = (now: number, hour: number, minute = 0) => dayStart(now) + hour * HOUR + minute * MIN;
const fmtTime = (ts: number) => `${pad2(new Date(ts).getHours())}:${pad2(new Date(ts).getMinutes())}`;
const randInt = (rng: () => number, min: number, max: number) => Math.floor(rng() * (max - min + 1)) + min;
const pick = <T,>(rng: () => number, arr: T[]): T => arr[Math.floor(rng() * arr.length)] || arr[0];
const str = (value: unknown, fallback = '', max = 120) => {
  const s = typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
  return (s || fallback).slice(0, max);
};
const num = (value: unknown, fallback: number, min: number, max: number) => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? clamp(Math.round(n), min, max) : fallback;
};
const bool = (value: unknown, fallback: boolean) => typeof value === 'boolean' ? value : fallback;

function id(prefix: string, seed: string, n: number): string {
  return `${prefix}_${hashSeed(`${seed}_${n}`).toString(36)}`;
}

function clockOnDay(now: number, value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 10_000_000_000) return value;
    if (value >= 0 && value < 24) {
      const hour = Math.floor(value);
      const minute = Math.round((value - hour) * 60);
      return atToday(now, hour, minute);
    }
    if (value >= 0 && value < 24 * 60) return dayStart(now) + value * MIN;
  }
  if (typeof value === 'string') {
    const m = value.match(/(\d{1,2})[:：](\d{1,2})/);
    if (m) {
      const h = clamp(Number(m[1]), 0, 23);
      const mm = clamp(Number(m[2]), 0, 59);
      return atToday(now, h, mm);
    }
  }
  return fallback;
}

function trend(value: unknown, fallback: number[], min: number, max: number, keep = fallback.length): number[] {
  if (!Array.isArray(value)) return fallback;
  const out = value
    .map(v => Number(v))
    .filter(Number.isFinite)
    .slice(0, keep)
    .map(v => clamp(Math.round(v), min, max));
  return out.length >= Math.min(3, keep) ? out : fallback;
}

function normalizeTransport(value: unknown, fallback?: XunjiTransport): XunjiTransport {
  const raw = String(value || '').toLowerCase();
  if (/bike|骑/.test(raw)) return 'bike';
  if (/car|taxi|drive|打车|驾/.test(raw)) return 'car';
  if (/subway|metro|地铁/.test(raw)) return 'subway';
  if (/bus|公交/.test(raw)) return 'bus';
  if (/walk|步行|走/.test(raw)) return 'walk';
  return fallback || 'walk';
}

function normalizeNetworkType(value: unknown, fallback: XunjiNetworkRecord['type']): XunjiNetworkRecord['type'] {
  const raw = String(value || '').toLowerCase();
  if (/wifi|wi-fi|无线/.test(raw)) return 'wifi';
  if (/mobile|cell|5g|4g|移动|流量/.test(raw)) return 'mobile';
  return fallback;
}

function normalizeCallStatus(value: unknown, fallback: XunjiCallRecord['status']): XunjiCallRecord['status'] {
  const raw = String(value || '').toLowerCase();
  if (/incoming|接入|来电/.test(raw)) return 'incoming';
  if (/miss|未接/.test(raw)) return 'missed';
  if (/connect|已接|通/.test(raw)) return 'connected';
  if (/out|拨/.test(raw)) return 'outgoing';
  return fallback;
}

function buildXunjiPersonaBlock(char: CharacterProfile): string {
  const city = char.cityConfig?.mode === 'real'
    ? char.cityConfig.realCity
    : [char.cityConfig?.virtualName, char.cityConfig?.prototypeCity ? `原型 ${char.cityConfig.prototypeCity}` : '', char.cityConfig?.fictionLevel != null ? `虚拟程度 ${char.cityConfig.fictionLevel}%` : ''].filter(Boolean).join('，');
  const memos = (char.memos || []).filter(m => !m.done).slice(0, 8).map(m => `- ${m.text}`).join('\n');
  return [
    `角色名：${char.name}`,
    char.socialProfile?.region ? `主页地区：${char.socialProfile.region}` : '',
    city ? `所在城市：${city}` : '',
    char.description ? `展示简介：${char.description.slice(0, 600)}` : '',
    char.systemPrompt ? `核心人设：${char.systemPrompt.slice(0, 1400)}` : '',
    char.worldview ? `世界观/补充：${char.worldview.slice(0, 800)}` : '',
    char.lifeProfile?.content ? `生活侧写：${char.lifeProfile.content.slice(0, 1200)}` : '',
    memos ? `近期备忘/待办：\n${memos}` : '',
  ].filter(Boolean).join('\n');
}

function placeSeed(char: CharacterProfile, customLocation?: string): string {
  if (customLocation?.trim()) return customLocation.trim();
  return char.cityConfig?.realCity
    || char.cityConfig?.virtualName
    || char.cityConfig?.prototypeCity
    || char.socialProfile?.region
    || '本城';
}

function applyLocationSource(snapshot: XunjiMonitorSnapshot, source?: XunjiLocationSource): XunjiMonitorSnapshot {
  if (!source || source.mode !== 'browser' || !source.browserLocation) return snapshot;
  const loc = source.browserLocation;
  const last = snapshot.locations[snapshot.locations.length - 1];
  const browserPoint: XunjiLocationPoint = {
    id: id('xj_loc_browser', `${snapshot.charId}_${loc.lat}_${loc.lng}_${loc.capturedAt}`, 1),
    label: '用户授权定位',
    address: `真实定位 ${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}${loc.accuracy ? ` · 精度约 ${Math.round(loc.accuracy)}m` : ''}`,
    lat: loc.lat,
    lng: loc.lng,
    arrivedAt: snapshot.generatedAt,
    stayMinutes: last?.stayMinutes || 30,
    moveMinutes: 0,
    transport: 'walk',
  };
  return {
    ...snapshot,
    locations: [...snapshot.locations.slice(0, -1), browserPoint],
    distanceKm: 0,
  };
}

function profileBias(char: CharacterProfile): string[] {
  const text = `${char.systemPrompt || ''}\n${char.description || ''}\n${char.worldview || ''}`;
  const tags: string[] = [];
  if (/学生|学校|大学|考试|课程/.test(text)) tags.push('校园');
  if (/医生|护士|医院|诊所/.test(text)) tags.push('医院');
  if (/程序|工程|代码|产品|公司/.test(text)) tags.push('公司');
  if (/明星|演员|偶像|舞台|直播/.test(text)) tags.push('演艺');
  if (/画|写|小说|创作|音乐/.test(text)) tags.push('创作');
  return tags.length ? tags : ['日常'];
}

function generateAppUsage(seed: string, now: number, density: XunjiDensity = 'standard'): XunjiAppUsageSession[] {
  const rng = rngFrom(`${seed}_apps_${density}`);
  const count = density === 'light' ? 7 : density === 'detailed' ? 14 : 10;
  const sessions: XunjiAppUsageSession[] = [];
  let cursor = atToday(now, 7, randInt(rng, 5, 40));
  for (let i = 0; i < count; i++) {
    const app = pick(rng, APP_LIBRARY);
    const duration = randInt(rng, 6, density === 'detailed' ? 58 : 42);
    const startedAt = cursor + randInt(rng, 8, 55) * MIN;
    const endedAt = startedAt + duration * MIN;
    sessions.push({
      id: id('xj_app', seed, i),
      ...app,
      startedAt,
      endedAt,
      note: `${fmtTime(startedAt)} 打开，使用 ${duration} 分钟`,
    });
    cursor = endedAt;
  }
  return sessions.sort((a, b) => a.startedAt - b.startedAt);
}

function generateNetworks(seed: string, now: number): XunjiNetworkRecord[] {
  const rng = rngFrom(`${seed}_net`);
  return [
    { id: id('xj_net', seed, 1), type: 'wifi', name: pick(rng, WIFI_NAMES), timestamp: atToday(now, 7, 45) },
    { id: id('xj_net', seed, 2), type: 'mobile', name: pick(rng, CARRIERS), timestamp: atToday(now, 10, randInt(rng, 5, 40)) },
    { id: id('xj_net', seed, 3), type: 'wifi', name: pick(rng, WIFI_NAMES), timestamp: atToday(now, 13, randInt(rng, 0, 50)) },
    { id: id('xj_net', seed, 4), type: 'mobile', name: pick(rng, CARRIERS), timestamp: atToday(now, 18, randInt(rng, 0, 50)) },
  ];
}

function generateLocations(char: CharacterProfile, seed: string, now: number, customLocation?: string): XunjiLocationPoint[] {
  const rng = rngFrom(`${seed}_loc`);
  const city = placeSeed(char, customLocation);
  const bias = profileBias(char)[0];
  const mid = bias === '校园' ? '教学楼' : bias === '医院' ? '门诊楼' : bias === '公司' ? '写字楼' : bias === '演艺' ? '排练室' : '街角咖啡店';
  const transports: XunjiTransport[] = ['walk', 'bike', 'car', 'subway', 'bus'];
  const points = [
    { label: '住处', address: `${city} · 晨间出发点`, hour: 7, stay: 54 },
    { label: mid, address: `${city} · ${mid}附近`, hour: 9, stay: 210 },
    { label: '便利店', address: `${city} · 转角便利店`, hour: 13, stay: 22 },
    { label: '临时停留', address: `${city} · 树影路口`, hour: 16, stay: 48 },
    { label: '回到住处', address: `${city} · 晚间落脚处`, hour: 20, stay: 140 },
  ];
  return points.map((p, i) => {
    const arrivedAt = atToday(now, p.hour, randInt(rng, 0, 35));
    return {
      id: id('xj_loc', seed, i),
      label: p.label,
      address: p.address,
      lat: Number((31 + rng()).toFixed(6)),
      lng: Number((121 + rng()).toFixed(6)),
      arrivedAt,
      leftAt: i === points.length - 1 ? undefined : arrivedAt + p.stay * MIN,
      moveMinutes: i === 0 ? 0 : randInt(rng, 8, 42),
      stayMinutes: p.stay,
      transport: i === 0 ? 'walk' : pick(rng, transports),
    };
  });
}

function generateCalls(seed: string, now: number): XunjiCallRecord[] {
  const rng = rngFrom(`${seed}_call`);
  return [
    { id: id('xj_call', seed, 1), target: pick(rng, CHAT_TARGETS), startedAt: atToday(now, 11, randInt(rng, 5, 45)), durationMinutes: randInt(rng, 3, 9), status: 'connected' },
    { id: id('xj_call', seed, 2), target: pick(rng, CHAT_TARGETS), startedAt: atToday(now, 19, randInt(rng, 5, 35)), durationMinutes: randInt(rng, 14, 32), status: 'outgoing' },
  ];
}

function generateBattery(seed: string, now: number): { level: number; isCharging: boolean; events: XunjiBatteryEvent[] } {
  const rng = rngFrom(`${seed}_battery`);
  const startLevel = randInt(rng, 18, 38);
  const endLevel = randInt(rng, 76, 96);
  return {
    level: randInt(rng, 42, 91),
    isCharging: rng() > 0.65,
    events: [
      { id: id('xj_bat', seed, 1), type: 'charge_start', timestamp: atToday(now, 12, randInt(rng, 0, 40)), level: startLevel },
      { id: id('xj_bat', seed, 2), type: 'charge_end', timestamp: atToday(now, 14, randInt(rng, 0, 50)), level: endLevel },
    ],
  };
}

export function createDefaultXunjiSettings(activeCharId?: string): XunjiSettings {
  return {
    id: 'settings',
    activeCharId,
    writeBackToCharacter: false,
    chatContextEnabled: true,
    autoTraceEnabled: true,
    autoTraceLastAtByChar: {},
    defaultDensity: 'standard',
    locationSource: 'character',
    reportRules: { ...DEFAULT_XUNJI_REPORT_RULES },
  };
}

export function shouldAutoAdvanceXunji(args: {
  settings: XunjiSettings;
  charId?: string;
  latestRun?: XunjiScreenlifeRun | null;
  latestSnapshot?: XunjiMonitorSnapshot | null;
  now?: number;
  minIntervalMs?: number;
}): { shouldRun: boolean; rangeStart: number; rangeEnd: number; reason: 'disabled' | 'no-char' | 'no-seed' | 'too-soon' | 'ready' } {
  const now = args.now ?? Date.now();
  if (args.settings.autoTraceEnabled === false) return { shouldRun: false, rangeStart: now, rangeEnd: now, reason: 'disabled' };
  if (!args.charId) return { shouldRun: false, rangeStart: now, rangeEnd: now, reason: 'no-char' };
  if (!args.latestRun) return { shouldRun: false, rangeStart: now, rangeEnd: now, reason: 'no-seed' };

  const minInterval = args.minIntervalMs ?? XUNJI_AUTO_TRACE_MIN_INTERVAL;
  const lastWatermark = args.settings.autoTraceLastAtByChar?.[args.charId] || 0;
  const lastTraceAt = Math.max(lastWatermark, args.latestRun.rangeEnd || args.latestRun.createdAt || 0);
  if (lastTraceAt > 0 && now - lastTraceAt < minInterval) {
    return { shouldRun: false, rangeStart: lastTraceAt, rangeEnd: now, reason: 'too-soon' };
  }

  const rangeEnd = now;
  const fallbackStart = now - minInterval;
  const rawStart = lastTraceAt > 0 ? lastTraceAt : fallbackStart;
  const rangeStart = clamp(Math.min(rawStart, now - 10 * MIN), now - XUNJI_AUTO_TRACE_MAX_WINDOW, now - 5 * MIN);
  return { shouldRun: true, rangeStart, rangeEnd, reason: 'ready' };
}

export function generateXunjiMonitorSnapshot(args: {
  char: CharacterProfile;
  now?: number;
  seed?: string;
  previous?: XunjiMonitorSnapshot | null;
  locationSource?: XunjiLocationSource;
}): XunjiMonitorSnapshot {
  const now = args.now ?? Date.now();
  const seed = args.seed || `${args.char.id}_${new Date(now).toDateString()}`;
  const rng = rngFrom(`${seed}_snapshot`);
  const appUsage = generateAppUsage(seed, now, 'standard');
  const battery = generateBattery(seed, now);
  const sleepStart = atToday(now, 23, randInt(rng, 0, 38)) - 24 * HOUR;
  const sleepMinutes = randInt(rng, 310, 485);
  const deepMinutes = randInt(rng, 48, 92);
  const remMinutes = randInt(rng, 62, 118);
  const awakeMinutes = randInt(rng, 10, 42);
  const coreMinutes = Math.max(120, sleepMinutes - deepMinutes - remMinutes - awakeMinutes);
  const hrvTrend = Array.from({ length: 12 }, (_, i) => randInt(rng, 35, 82) + (i % 3 === 0 ? 4 : 0));
  const heartTrend = Array.from({ length: 14 }, () => randInt(rng, 58, 112));
  const dayStepTrend = Array.from({ length: 12 }, (_, i) => randInt(rng, 120, 980) + i * randInt(rng, 20, 80));
  const weekStepTrend = Array.from({ length: 7 }, () => randInt(rng, 3200, 12600));
  const screenTimeMinutes = appUsage.reduce((sum, s) => sum + Math.round((s.endedAt - s.startedAt) / MIN), 0);

  const snapshot: XunjiMonitorSnapshot = {
    id: id('xj_snap', seed, 1),
    charId: args.char.id,
    generatedAt: now,
    phoneModel: args.previous?.phoneModel || pick(rng, PHONE_MODELS),
    batteryLevel: battery.level,
    isCharging: battery.isCharging,
    unlockCount: randInt(rng, 42, 128),
    screenTimeMinutes,
    lockPeriods: [
      { id: id('xj_lock', seed, 1), startedAt: atToday(now, 0, 20), endedAt: atToday(now, 6, randInt(rng, 10, 50)) },
      { id: id('xj_lock', seed, 2), startedAt: atToday(now, 14, 10), endedAt: atToday(now, 14, randInt(rng, 35, 55)) },
      { id: id('xj_lock', seed, 3), startedAt: atToday(now, 21, 35), endedAt: atToday(now, 22, randInt(rng, 2, 28)) },
    ],
    appUsage,
    networks: generateNetworks(seed, now),
    locations: generateLocations(args.char, seed, now, args.locationSource?.mode === 'character' ? args.locationSource.customLocation : undefined),
    distanceKm: Number((randInt(rng, 2, 1800) / 10).toFixed(1)),
    health: {
      timestamp: now,
      stressLabel: pick(rng, ['放松', '平稳', '轻微压力', '压力偏高']),
      hrvAvg: Math.round(hrvTrend.reduce((a, b) => a + b, 0) / hrvTrend.length),
      hrvCurrent: hrvTrend[hrvTrend.length - 1],
      hrvTrend,
      heartRateMin: Math.min(...heartTrend),
      heartRateMax: Math.max(...heartTrend),
      heartRateLatest: heartTrend[heartTrend.length - 1],
      heartRateTrend: heartTrend,
      sleepMinutes,
      sleepQuality: sleepMinutes >= 420 ? '良好' : sleepMinutes >= 360 ? '一般' : '偏短',
      sleep: {
        asleepAt: sleepStart,
        awakeAt: sleepStart + sleepMinutes * MIN,
        awakeMinutes,
        remMinutes,
        coreMinutes,
        deepMinutes,
      },
      steps: weekStepTrend[weekStepTrend.length - 1],
      walkingKm: Number((weekStepTrend[weekStepTrend.length - 1] * 0.00072).toFixed(1)),
      dayStepTrend,
      weekStepTrend,
    },
    calls: generateCalls(seed, now),
    batteryEvents: battery.events,
  };
  return applyLocationSource(snapshot, args.locationSource);
}

async function callXunjiLLM(api: XunjiApiConfig, prompt: string, maxTokens = 1600, signal?: AbortSignal): Promise<string> {
  const baseUrl = (api.baseUrl || '').trim();
  if (!baseUrl || !api.model) return '';
  try {
    const data = await callChatCompletion(api, {
      model: api.model,
      stream: false,
      temperature: 0.78,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: '你为虚拟手机系统生成角色循迹快照。只能返回 JSON，不要解释，不要代码块。内容必须像同一个角色真实会有的日常，而不是泛泛模板。' },
        { role: 'user', content: prompt },
      ],
    }, {
      signal,
      meta: makeApiUsageMeta('xunji.generate', { apiRole: 'aux', apiBinding: '循迹快照' }),
    });
    return extractContent(data) || '';
  } catch {
    return '';
  }
}

function mergeAiSnapshot(fallback: XunjiMonitorSnapshot, parsed: any): XunjiMonitorSnapshot {
  const now = fallback.generatedAt;
  const stamp = `${fallback.id}_ai`;
  const appUsage: XunjiAppUsageSession[] = Array.isArray(parsed?.appUsage) && parsed.appUsage.length
    ? (parsed.appUsage as any[]).slice(0, 14).map((item: any, i: number): XunjiAppUsageSession => {
      const base = fallback.appUsage[i % fallback.appUsage.length] || fallback.appUsage[0];
      const startedAt = clockOnDay(now, item?.startedAt || item?.time || item?.start, base?.startedAt || atToday(now, 8 + i, 0));
      const duration = num(item?.durationMinutes ?? item?.duration, base ? xunjiDurationMinutes(base) : 18, 3, 180);
      return {
        id: id('xj_ai_app', stamp, i),
        appName: str(item?.appName || item?.name, base?.appName || '备忘录', 24),
        icon: str(item?.icon, base?.icon || '', 4) || undefined,
        category: str(item?.category, base?.category || '生活', 16),
        startedAt,
        endedAt: Math.max(startedAt + MIN, startedAt + duration * MIN),
        note: str(item?.note, `${fmtTime(startedAt)} 打开，使用 ${duration} 分钟`, 90),
      };
    }).sort((a, b) => a.startedAt - b.startedAt)
    : fallback.appUsage;
  const locations: XunjiLocationPoint[] = Array.isArray(parsed?.locations) && parsed.locations.length
    ? (parsed.locations as any[]).slice(0, 7).map((item: any, i: number): XunjiLocationPoint => {
      const base = fallback.locations[i % fallback.locations.length] || fallback.locations[0];
      const arrivedAt = clockOnDay(now, item?.arrivedAt || item?.time, base?.arrivedAt || atToday(now, 8 + i * 2, 0));
      const stayMinutes = num(item?.stayMinutes, base?.stayMinutes || 30, 5, 360);
      const moveMinutes = num(item?.moveMinutes, base?.moveMinutes || 12, 0, 120);
      const total = Math.min(parsed.locations.length, 7);
      return {
        id: id('xj_ai_loc', stamp, i),
        label: str(item?.label || item?.name, base?.label || '临时停留', 32),
        address: str(item?.address, base?.address || '城市里的一处日常地点', 80),
        lat: typeof item?.lat === 'number' ? Number(item.lat.toFixed(6)) : base?.lat,
        lng: typeof item?.lng === 'number' ? Number(item.lng.toFixed(6)) : base?.lng,
        arrivedAt,
        leftAt: i === (total - 1) ? undefined : arrivedAt + stayMinutes * MIN,
        moveMinutes,
        stayMinutes,
        transport: normalizeTransport(item?.transport, base?.transport),
      };
    }).sort((a, b) => a.arrivedAt - b.arrivedAt)
    : fallback.locations;
  const networks: XunjiNetworkRecord[] = Array.isArray(parsed?.networks) && parsed.networks.length
    ? (parsed.networks as any[]).slice(0, 6).map((item: any, i: number): XunjiNetworkRecord => {
      const base = fallback.networks[i % fallback.networks.length] || fallback.networks[0];
      return {
        id: id('xj_ai_net', stamp, i),
        type: normalizeNetworkType(item?.type, base?.type || 'mobile'),
        name: str(item?.name, base?.name || '移动数据', 32),
        timestamp: clockOnDay(now, item?.timestamp || item?.time, base?.timestamp || atToday(now, 8 + i * 3, 0)),
      };
    }).sort((a, b) => a.timestamp - b.timestamp)
    : fallback.networks;
  const calls: XunjiCallRecord[] = Array.isArray(parsed?.calls) && parsed.calls.length
    ? (parsed.calls as any[]).slice(0, 5).map((item: any, i: number): XunjiCallRecord => {
      const base = fallback.calls[i % fallback.calls.length] || fallback.calls[0];
      return {
        id: id('xj_ai_call', stamp, i),
        target: str(item?.target, base?.target || '朋友', 24),
        startedAt: clockOnDay(now, item?.startedAt || item?.time, base?.startedAt || atToday(now, 12 + i * 3, 0)),
        durationMinutes: num(item?.durationMinutes ?? item?.duration, base?.durationMinutes || 8, 1, 120),
        status: normalizeCallStatus(item?.status, base?.status || 'connected'),
      };
    }).sort((a, b) => a.startedAt - b.startedAt)
    : fallback.calls;
  const batteryEvents: XunjiBatteryEvent[] = Array.isArray(parsed?.batteryEvents) && parsed.batteryEvents.length
    ? (parsed.batteryEvents as any[]).slice(0, 4).map((item: any, i: number): XunjiBatteryEvent => {
      const base = fallback.batteryEvents[i % fallback.batteryEvents.length] || fallback.batteryEvents[0];
      const type = item?.type === 'charge_end' || /end|结束/.test(String(item?.type || item?.label || '')) ? 'charge_end' : 'charge_start';
      return {
        id: id('xj_ai_bat', stamp, i),
        type,
        timestamp: clockOnDay(now, item?.timestamp || item?.time, base?.timestamp || atToday(now, 12 + i, 0)),
        level: num(item?.level, base?.level || fallback.batteryLevel, 1, 100),
      };
    }).sort((a, b) => a.timestamp - b.timestamp)
    : fallback.batteryEvents;

  const screenTimeMinutes = appUsage.reduce((sum, s) => sum + xunjiDurationMinutes(s), 0);
  const hrvTrend = trend(parsed?.health?.hrvTrend, fallback.health.hrvTrend, 20, 110, 16);
  const heartRateTrend = trend(parsed?.health?.heartRateTrend, fallback.health.heartRateTrend, 45, 180, 18);
  const dayStepTrend = trend(parsed?.health?.dayStepTrend, fallback.health.dayStepTrend, 0, 4000, 16);
  const weekStepTrend = trend(parsed?.health?.weekStepTrend, fallback.health.weekStepTrend, 0, 30000, 7);
  const sleepMinutes = num(parsed?.health?.sleepMinutes, fallback.health.sleepMinutes, 90, 720);
  const asleepAt = clockOnDay(now, parsed?.health?.sleep?.asleepAt, fallback.health.sleep.asleepAt);
  const awakeAt = clockOnDay(now, parsed?.health?.sleep?.awakeAt, asleepAt + sleepMinutes * MIN);

  return {
    ...fallback,
    id: id('xj_snap_ai', `${fallback.charId}_${now}_${JSON.stringify(parsed).slice(0, 80)}`, 1),
    phoneModel: str(parsed?.phoneModel, fallback.phoneModel, 40),
    batteryLevel: num(parsed?.batteryLevel, fallback.batteryLevel, 1, 100),
    isCharging: bool(parsed?.isCharging, fallback.isCharging),
    unlockCount: num(parsed?.unlockCount, fallback.unlockCount, 1, 240),
    screenTimeMinutes,
    appUsage,
    networks,
    locations,
    distanceKm: Number((Number.isFinite(Number(parsed?.distanceKm)) ? clamp(Number(parsed.distanceKm), 0, 300) : fallback.distanceKm).toFixed(1)),
    health: {
      ...fallback.health,
      timestamp: now,
      stressLabel: str(parsed?.health?.stressLabel, fallback.health.stressLabel, 20),
      hrvAvg: Math.round(hrvTrend.reduce((a, b) => a + b, 0) / hrvTrend.length),
      hrvCurrent: hrvTrend[hrvTrend.length - 1],
      hrvTrend,
      heartRateMin: Math.min(...heartRateTrend),
      heartRateMax: Math.max(...heartRateTrend),
      heartRateLatest: heartRateTrend[heartRateTrend.length - 1],
      heartRateTrend,
      sleepMinutes,
      sleepQuality: str(parsed?.health?.sleepQuality, fallback.health.sleepQuality, 20),
      sleep: {
        asleepAt,
        awakeAt,
        awakeMinutes: num(parsed?.health?.sleep?.awakeMinutes, fallback.health.sleep.awakeMinutes, 0, 180),
        remMinutes: num(parsed?.health?.sleep?.remMinutes, fallback.health.sleep.remMinutes, 0, 240),
        coreMinutes: num(parsed?.health?.sleep?.coreMinutes, fallback.health.sleep.coreMinutes, 30, 480),
        deepMinutes: num(parsed?.health?.sleep?.deepMinutes, fallback.health.sleep.deepMinutes, 0, 240),
      },
      steps: weekStepTrend[weekStepTrend.length - 1] || fallback.health.steps,
      walkingKm: Number(((weekStepTrend[weekStepTrend.length - 1] || fallback.health.steps) * 0.00072).toFixed(1)),
      dayStepTrend,
      weekStepTrend,
    },
    calls,
    batteryEvents,
  };
}

export async function generateXunjiRealtimeSnapshot(args: {
  char: CharacterProfile;
  api?: XunjiApiConfig | null;
  previous?: XunjiMonitorSnapshot | null;
  locationSource?: XunjiLocationSource;
  now?: number;
  signal?: AbortSignal;
}): Promise<XunjiMonitorSnapshot> {
  const now = args.now ?? Date.now();
  const fallback = generateXunjiMonitorSnapshot({ char: args.char, previous: args.previous, now, seed: `${args.char.id}_${now}_realtime`, locationSource: args.locationSource });
  if (!args.api?.baseUrl || !args.api.model) return fallback;
  try {
    const latest = args.previous ? summarizeXunjiForCharacter({ snapshot: args.previous }) : '暂无旧快照。';
    const locationLine = args.locationSource?.mode === 'browser' && args.locationSource.browserLocation
      ? `定位来源：用户已授权设备真实定位。请把当前位置写成“用户授权定位”，坐标 ${args.locationSource.browserLocation.lat.toFixed(5)}, ${args.locationSource.browserLocation.lng.toFixed(5)}，不要臆造真实门牌。`
      : args.locationSource?.customLocation?.trim()
        ? `定位来源：用户手动输入的角色设定定位「${args.locationSource.customLocation.trim().slice(0, 120)}」。请按这个定位生成 TA 的日常地点。`
        : '定位来源：角色卡里的地理设定。请按角色城市/生活侧写生成 TA 自己的日常地点。';
    const prompt = [
      '请为“循迹”生成一份当前时刻的角色手机/生活实时快照。',
      '这不是读取真实设备，而是角色人格模拟；必须和角色在其它 App 中的人设、城市、生活侧写、备忘录保持一致。',
      `当前时间：${new Date(now).toLocaleString('zh-CN')}`,
      locationLine,
      buildXunjiPersonaBlock(args.char),
      `上一份快照摘要：${latest}`,
      '只返回 JSON，字段如下：',
      '{',
      '  "phoneModel": string, "batteryLevel": number, "isCharging": boolean, "unlockCount": number, "distanceKm": number,',
      '  "appUsage": [{"appName":string,"category":string,"startedAt":"HH:mm","durationMinutes":number,"note":string}],',
      '  "networks": [{"type":"wifi|mobile","name":string,"time":"HH:mm"}],',
      '  "locations": [{"label":string,"address":string,"arrivedAt":"HH:mm","moveMinutes":number,"stayMinutes":number,"transport":"walk|bike|car|subway|bus"}],',
      '  "health": {"stressLabel":string,"hrvTrend":number[],"heartRateTrend":number[],"sleepMinutes":number,"sleepQuality":string,"sleep":{"asleepAt":"HH:mm","awakeAt":"HH:mm","awakeMinutes":number,"remMinutes":number,"coreMinutes":number,"deepMinutes":number},"dayStepTrend":number[],"weekStepTrend":number[]},',
      '  "calls": [{"target":string,"startedAt":"HH:mm","durationMinutes":number,"status":"outgoing|incoming|missed|connected"}],',
      '  "batteryEvents": [{"type":"charge_start|charge_end","time":"HH:mm","level":number}]',
      '}',
      '地点和 App 不要泛泛而谈；优先写 TA 所在城市里符合人设的日常地点、常用软件、通话对象和随手停留。不要写用户真实隐私。',
    ].join('\n');
    const raw = await callXunjiLLM(args.api, prompt, 2200, args.signal);
    const parsed = extractJson<any>(raw);
    return parsed ? applyLocationSource(mergeAiSnapshot(fallback, parsed), args.locationSource) : fallback;
  } catch {
    return fallback;
  }
}

export function generateXunjiReports(args: {
  char: CharacterProfile;
  snapshot: XunjiMonitorSnapshot;
  rules: Record<XunjiReportType, boolean>;
  now?: number;
}): XunjiReportItem[] {
  const { char, snapshot, rules } = args;
  const now = args.now ?? snapshot.generatedAt;
  const reports: XunjiReportItem[] = [];
  const firstApp = snapshot.appUsage[0];
  const longApp = [...snapshot.appUsage].sort((a, b) => (b.endedAt - b.startedAt) - (a.endedAt - a.startedAt))[0] || firstApp;
  const loc = snapshot.locations[1] || snapshot.locations[0];
  const lastLoc = snapshot.locations[snapshot.locations.length - 1] || loc;
  const call = snapshot.calls.find(c => c.durationMinutes >= 10) || snapshot.calls[0];
  const chargeStart = snapshot.batteryEvents.find(e => e.type === 'charge_start') || snapshot.batteryEvents[0];
  const chargeEnd = snapshot.batteryEvents.find(e => e.type === 'charge_end') || snapshot.batteryEvents[snapshot.batteryEvents.length - 1];

  const add = (type: XunjiReportType, timestamp: number, title: string, body: string, severity: XunjiReportItem['severity'] = 'info', relatedApp?: string) => {
    if (!rules[type]) return;
    reports.push({
      id: id('xj_report', `${char.id}_${snapshot.id}_${type}`, reports.length),
      charId: char.id,
      type,
      timestamp,
      title,
      body,
      severity,
      relatedApp,
      acknowledged: false,
      writtenBack: false,
    });
  };

  add('unlock_count', now - 50 * MIN, '手机解锁次数更新', `${char.name} 今天已解锁手机 ${snapshot.unlockCount} 次，屏幕使用 ${snapshot.screenTimeMinutes} 分钟。`, snapshot.unlockCount > 100 ? 'warning' : 'notice');
  const net = snapshot.networks[1] || snapshot.networks[0];
  add('network_switch', net.timestamp, '网络发生切换', `当前从 ${snapshot.networks[0]?.name || '未知网络'} 切到 ${net.type === 'wifi' ? 'WIFI' : '移动数据'}：${net.name}。`, 'notice');
  add('app_open', firstApp.startedAt, `进入 ${firstApp.appName}`, `${char.name} 在 ${fmtTime(firstApp.startedAt)} 打开了 ${firstApp.appName}。`, 'info', firstApp.appName);
  add('app_close', firstApp.endedAt, `关闭 ${firstApp.appName}`, `${firstApp.appName} 已使用 ${Math.round((firstApp.endedAt - firstApp.startedAt) / MIN)} 分钟后关闭。`, 'info', firstApp.appName);
  add('app_hourly', longApp.startedAt + HOUR, `${longApp.appName} 使用提醒`, `${longApp.appName} 已连续/累计使用接近 1 小时，记录具体时间：${fmtTime(longApp.startedAt)} - ${fmtTime(longApp.endedAt)}。`, 'warning', longApp.appName);
  add('charge_start', chargeStart.timestamp, '开始充电', `${char.name} 的手机在 ${fmtTime(chargeStart.timestamp)} 开始充电，电量 ${chargeStart.level}%。`, 'notice');
  add('charge_end', chargeEnd.timestamp, '结束充电', `充电在 ${fmtTime(chargeEnd.timestamp)} 结束，电量 ${chargeEnd.level}%。`, 'info');
  add('move_start', loc.arrivedAt - (loc.moveMinutes || 12) * MIN, '开始移动', `${char.name} 开始从上一地点移动，预计移动 ${loc.moveMinutes || 12} 分钟。`, 'notice');
  add('stay', loc.arrivedAt + 15 * MIN, `停留在${loc.label}`, `具体位置：${loc.address}，已停留 ${loc.stayMinutes || 0} 分钟。`, 'info');
  add('transit', loc.arrivedAt - 8 * MIN, '乘车信息', `移动方式：${transportLabel(loc.transport)}，前往 ${loc.label}。`, 'notice');
  add('arrive', lastLoc.arrivedAt, `到达${lastLoc.label}`, `${char.name} 已到达 ${lastLoc.address}。`, 'notice');
  add('call_start', call.startedAt, '拨打电话', `${char.name} 与 ${call.target} 通话，状态：${callStatusLabel(call.status)}。`, 'notice');
  add('call_10min', call.startedAt + 10 * MIN, '电话十分钟提醒', `与 ${call.target} 的电话已持续 10 分钟，当前记录总时长 ${call.durationMinutes} 分钟。`, 'warning');
  add('sleep_phone_off', snapshot.health.sleep.asleepAt - 12 * MIN, '关闭手机进入睡眠', `${char.name} 在睡前锁屏，准备进入睡眠。`, 'info');
  add('sleep_late_reminder', atToday(now, 21, 5), '9 点后未进入睡眠', `21:00 后仍未进入睡眠，当前最近睡眠开始于 ${fmtTime(snapshot.health.sleep.asleepAt)}。`, 'warning');
  add('sleep_5h', snapshot.health.sleep.asleepAt + 5 * HOUR, '睡眠 5 小时提醒', `睡眠已持续 5 小时，核心睡眠 ${snapshot.health.sleep.coreMinutes} 分钟。`, 'notice');
  add('sleep_end', snapshot.health.sleep.awakeAt, '睡眠结束', `本次睡眠 ${Math.round(snapshot.health.sleepMinutes / 60 * 10) / 10} 小时，质量：${snapshot.health.sleepQuality}。`, 'info');

  return reports.sort((a, b) => b.timestamp - a.timestamp);
}

function transportLabel(t?: XunjiTransport): string {
  return ({ walk: '步行', bike: '骑行', car: '打车/驾车', subway: '地铁', bus: '公交' } as Record<XunjiTransport, string>)[t || 'walk'];
}

function callStatusLabel(status: XunjiCallRecord['status']): string {
  return ({ outgoing: '拨出', incoming: '接入', missed: '未接', connected: '已接通' } as Record<XunjiCallRecord['status'], string>)[status];
}

function localScreenlifeRun(args: {
  char: CharacterProfile;
  rangeStart: number;
  rangeEnd: number;
  density: XunjiDensity;
  writeBack: boolean;
  seed?: string;
}): XunjiScreenlifeRun {
  const seed = args.seed || `${args.char.id}_${args.rangeStart}_${args.rangeEnd}_${args.density}`;
  const rng = rngFrom(`${seed}_screenlife`);
  const scale = args.density === 'light' ? 0 : args.density === 'detailed' ? 2 : 1;
  const span = Math.max(HOUR, args.rangeEnd - args.rangeStart);
  const rawAppUsage = generateAppUsage(seed, args.rangeEnd, args.density)
    .map((s, i) => ({ ...s, id: id('xj_run_app', seed, i) }));
  const filteredAppUsage = rawAppUsage
    .filter(s => s.startedAt >= args.rangeStart && s.startedAt <= args.rangeEnd)
    .slice(0, 6 + scale * 3);
  const appUsage = filteredAppUsage.length ? filteredAppUsage : rawAppUsage.slice(0, 4 + scale * 2).map((s, i, arr) => {
    const startedAt = args.rangeStart + Math.floor(span * ((i + 1) / (arr.length + 2)));
    const duration = clamp(Math.round((s.endedAt - s.startedAt) / MIN), 8, 55);
    return { ...s, startedAt, endedAt: Math.min(args.rangeEnd, startedAt + duration * MIN), note: `${fmtTime(startedAt)} 打开，使用 ${duration} 分钟` };
  });
  const chatCount = 2 + scale;
  const browseCount = 3 + scale * 2;
  const noteCount = 2 + scale;
  const timeAt = (i: number, total: number) => args.rangeStart + Math.floor(span * ((i + 1) / (total + 1)));
  const chats = Array.from({ length: chatCount }, (_, i) => {
    const target = pick(rng, CHAT_TARGETS);
    return {
      id: id('xj_chat', seed, i),
      time: timeAt(i, chatCount),
      target,
      summary: `和${target}聊了${pick(rng, ['今天的安排', '一件小烦恼', '路上看到的东西', '晚饭吃什么', '一个没说完的玩笑'])}`,
      messages: [
        `先是随口问了近况，语气像${args.char.name}平时会有的样子。`,
        `后来话题拐到${pick(rng, ['天气', '工作', '歌单', '路边的小店', '今晚的计划'])}，停了几秒才继续回。`,
      ],
    };
  });
  const browsed = Array.from({ length: browseCount }, (_, i) => ({
    id: id('xj_browse', seed, i),
    time: timeAt(i, browseCount),
    appName: pick(rng, APP_LIBRARY).appName,
    title: pick(rng, BROWSE_TITLES),
    summary: `${args.char.name}停在这条内容上多看了一会儿，像是把它和自己的今天悄悄对上了。`,
  }));
  const notes = Array.from({ length: noteCount }, (_, i) => ({
    id: id('xj_note', seed, i),
    time: timeAt(i, noteCount),
    text: pick(rng, NOTE_LINES),
  }));
  const socialInference: XunjiSocialInference = buildLocalSocialInference(args.char, rng, appUsage, chats, browsed, notes);
  const moments: XunjiGeneratedMoment[] = buildLocalMoments(seed, args.char, rng, args.rangeStart, args.rangeEnd, socialInference, appUsage, chats, notes);

  return {
    id: id('xj_run', seed, 1),
    charId: args.char.id,
    createdAt: Date.now(),
    rangeStart: args.rangeStart,
    rangeEnd: args.rangeEnd,
    density: args.density,
    writeBack: args.writeBack,
    title: `${args.char.name} 的屏幕亮起`,
    narrative: `${args.char.name} 的这段 Screenlife 像一条不太用力的日常线：聊天、刷到的东西、随手记下的念头，都顺着 TA 的性格走。${args.writeBack ? '这次演出会被写回角色日常，之后 TA 可以把它当成自己经历过的痕迹。' : '这次只是观赏演出，看完即走，不影响 TA 的日常。'}`,
    chats,
    browsed,
    notes,
    appUsage,
    socialInference,
    moments,
  };
}

function buildLocalSocialInference(
  char: CharacterProfile,
  rng: () => number,
  appUsage: XunjiAppUsageSession[],
  chats: XunjiScreenlifeRun['chats'],
  browsed: XunjiScreenlifeRun['browsed'],
  notes: XunjiScreenlifeRun['notes'],
): XunjiSocialInference {
  const chatApps = appUsage.filter(a => /微信|群|QQ|消息|絮语/.test(a.appName)).length;
  const lateUse = appUsage.some(a => new Date(a.startedAt).getHours() >= 22);
  const musicUse = appUsage.some(a => /音乐|歌/.test(a.appName));
  const mapUse = appUsage.some(a => /地图|外卖|日历/.test(a.appName));
  const score = clamp(58 + chatApps * 6 + (musicUse ? 7 : 0) + (mapUse ? 4 : 0) - (lateUse ? 8 : 0) + randInt(rng, -6, 8), 0, 100);
  const mood = lateUse
    ? pick(rng, ['有点疲惫但还在撑着', '心里挂着事，节奏偏晚'])
    : musicUse
      ? pick(rng, ['被一首歌带得心软', '情绪比上午松下来一点'])
      : pick(rng, ['平稳地忙着自己的事', '有一点想被人惦记']);
  const relationshipPulse = score >= 76
    ? `对 ${char.name} 来说，今天的屏幕痕迹里有明显的靠近感。`
    : score >= 55
      ? '关系温度稳定，适合从一个小细节自然开口。'
      : '今天更像各自忙着，最好先轻轻确认状态。';
  return {
    mood,
    relationshipPulse,
    screenlifeScore: score,
    intimacySignals: [
      chats[0]?.summary || '有几段没明说但留了余温的聊天',
      notes[0]?.text ? `备忘录里写着「${notes[0].text}」` : '随手记里留了一个小念头',
      musicUse ? '音乐 App 停留偏久，像是在找一句能代替自己说的话' : '常用 App 切换不急，今天的节奏比较生活化',
    ].slice(0, 3),
    frictionSignals: [
      lateUse ? '夜里屏幕亮得偏晚，可能有点累' : '没有明显冲突，只是回复节奏有几处停顿',
      browsed[0]?.title ? `在「${browsed[0].title}」上停留，像是被某个话题绊住` : '有些内容只是刷过，没有真的分享出口',
    ].slice(0, 2),
    likelyNeeds: [
      pick(rng, ['需要一句不追问的关心', '需要有人接住 TA 今天没讲完的半句话', '需要一点被允许慢下来的空间']),
      mapUse ? '如果聊到出门、吃饭、路上见闻，会更容易接上' : '从音乐、旧照片或随手记切入会更自然',
    ],
    nextConversationSeeds: [
      chats[0]?.summary || '问 TA 今天有没有哪一刻突然想起你',
      notes[0]?.text ? `接「${notes[0].text}」这句随手记往下聊` : '让 TA 讲一个今天屏幕里没发出去的念头',
      musicUse ? '问刚才那首歌哪一句最像今天' : '从今天刷到的一件小东西聊起',
    ],
    whisperHooks: [
      pick(rng, ['你今天是不是有一句话没舍得发给我？', '我想看你手机里最想藏起来的那一秒。']),
      notes[0]?.text ? `「${notes[0].text}」这句，我替你记住了。` : '你不用马上说清楚，我先在这里陪你一会儿。',
    ],
  };
}

function buildLocalMoments(
  seed: string,
  char: CharacterProfile,
  rng: () => number,
  rangeStart: number,
  rangeEnd: number,
  social: XunjiSocialInference,
  appUsage: XunjiAppUsageSession[],
  chats: XunjiScreenlifeRun['chats'],
  notes: XunjiScreenlifeRun['notes'],
): XunjiGeneratedMoment[] {
  const span = Math.max(HOUR, rangeEnd - rangeStart);
  const timeAt = (i: number, total: number) => rangeStart + Math.floor(span * ((i + 1) / (total + 1)));
  const topApp = [...appUsage].sort((a, b) => xunjiDurationMinutes(b) - xunjiDurationMinutes(a))[0];
  return [
    {
      id: id('xj_moment', seed, 1),
      time: timeAt(1, 4),
      title: `${char.name} 的屏幕亮了一下`,
      body: chats[0]?.summary || `${char.name}把一句话停在输入框里，最后又切去了别的 App。`,
      tone: 'private',
      relatedApp: chats[0]?.target,
    },
    {
      id: id('xj_moment', seed, 2),
      time: timeAt(2, 4),
      title: topApp ? `${topApp.appName} 停留偏久` : '一段安静停留',
      body: topApp ? `${topApp.note || `使用了 ${xunjiDurationMinutes(topApp)} 分钟`}，像是把今天的心情放在那里缓了一下。` : social.mood,
      tone: topApp && /微信|QQ|消息|絮语/.test(topApp.appName) ? 'social' : 'soft',
      relatedApp: topApp?.appName,
    },
    {
      id: id('xj_moment', seed, 3),
      time: timeAt(3, 4),
      title: '随手记落下',
      body: notes[0]?.text || pick(rng, social.whisperHooks),
      tone: 'soft',
      relatedApp: '备忘录',
    },
  ];
}

async function callScreenlifeLLM(api: XunjiApiConfig, prompt: string, signal?: AbortSignal): Promise<string> {
  const baseUrl = (api.baseUrl || '').trim();
  if (!baseUrl || !api.model) return '';
  try {
    const data = await callChatCompletion(api, {
      model: api.model,
      stream: false,
      temperature: 0.9,
      max_tokens: 1200,
      messages: [
        { role: 'system', content: '你为虚拟角色生成 Screenlife 演出。只返回 JSON，不要写解释。' },
        { role: 'user', content: prompt },
      ],
    }, {
      signal,
      meta: makeApiUsageMeta('xunji.generate', { apiRole: 'aux', apiBinding: 'Screenlife 演出' }),
    });
    return extractContent(data) || '';
  } catch {
    return '';
  }
}

function extractJson<T>(text: string): T | null {
  const body = (text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const start = body.search(/[\[{]/);
  if (start < 0) return null;
  const open = body[start];
  const close = open === '[' ? ']' : '}';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) {
      try { return JSON.parse(body.slice(start, i + 1)) as T; } catch { return null; }
    }
  }
  return null;
}

export async function generateXunjiScreenlifeRun(args: {
  char: CharacterProfile;
  api?: XunjiApiConfig | null;
  rangeStart: number;
  rangeEnd: number;
  density: XunjiDensity;
  writeBack: boolean;
  seed?: string;
  signal?: AbortSignal;
}): Promise<XunjiScreenlifeRun> {
  const fallback = localScreenlifeRun(args);
  if (!args.api?.baseUrl || !args.api.model) return fallback;

  try {
    const prompt = [
      `角色名：${args.char.name}`,
      `角色设定：${(args.char.systemPrompt || args.char.description || '').slice(0, 1200)}`,
      `时间范围：${new Date(args.rangeStart).toLocaleString()} - ${new Date(args.rangeEnd).toLocaleString()}`,
      `密度：${args.density}`,
      '返回 JSON 字段：title,narrative,chats[{target,summary,messages[]}],browsed[{appName,title,summary}],notes[{text}],moments[{time,title,body,tone,relatedApp}],socialInference{mood,relationshipPulse,screenlifeScore,intimacySignals[],frictionSignals[],likelyNeeds[],nextConversationSeeds[],whisperHooks[]}。',
      '内容要体现：聊了什么、刷了什么、记了什么、右下角动态会弹什么，以及这些痕迹折射出的关系温度。',
      'socialInference 是给“絮语”聊天联动用的：写成角色能自然感知的近期生活线索，不要写成分析报告口吻。',
    ].join('\n');
    const raw = await callScreenlifeLLM(args.api, prompt, args.signal);
    const parsed = extractJson<Partial<XunjiScreenlifeRun>>(raw);
    if (!parsed) return fallback;
    const stamp = `${args.seed || fallback.id}_ai`;
    const chats = Array.isArray(parsed.chats) && parsed.chats.length ? parsed.chats.map((c: any, i: number) => ({
      id: id('xj_ai_chat', stamp, i),
      time: fallback.rangeStart + Math.floor((fallback.rangeEnd - fallback.rangeStart) * ((i + 1) / (parsed.chats!.length + 1))),
      target: String(c.target || pick(rngFrom(stamp), CHAT_TARGETS)).slice(0, 20),
      summary: String(c.summary || '').slice(0, 160) || fallback.chats[i % fallback.chats.length]?.summary || '',
      messages: Array.isArray(c.messages) ? c.messages.map((m: any) => String(m).slice(0, 180)).slice(0, 4) : [],
    })) : fallback.chats;
    const browsed = Array.isArray(parsed.browsed) && parsed.browsed.length ? parsed.browsed.map((b: any, i: number) => ({
      id: id('xj_ai_browse', stamp, i),
      time: fallback.rangeStart + Math.floor((fallback.rangeEnd - fallback.rangeStart) * ((i + 1) / (parsed.browsed!.length + 1))),
      appName: String(b.appName || '浏览器').slice(0, 20),
      title: String(b.title || '屏幕记录').slice(0, 60),
      summary: String(b.summary || '').slice(0, 180),
    })) : fallback.browsed;
    const notes = Array.isArray(parsed.notes) && parsed.notes.length ? parsed.notes.map((n: any, i: number) => ({
      id: id('xj_ai_note', stamp, i),
      time: fallback.rangeStart + Math.floor((fallback.rangeEnd - fallback.rangeStart) * ((i + 1) / (parsed.notes!.length + 1))),
      text: String(n.text || n).slice(0, 160),
    })) : fallback.notes;
    return {
      ...fallback,
      title: String(parsed.title || fallback.title).slice(0, 80),
      narrative: String(parsed.narrative || fallback.narrative).slice(0, 2000),
      chats,
      browsed,
      notes,
      socialInference: normalizeAiSocialInference((parsed as any).socialInference, fallback.socialInference),
      moments: normalizeAiMoments((parsed as any).moments, fallback.moments, fallback.rangeStart, fallback.rangeEnd, stamp),
    };
  } catch {
    return fallback;
  }
}

function normalizeStringArray(value: unknown, fallback: string[] = [], max = 4): string[] {
  if (!Array.isArray(value)) return fallback.slice(0, max);
  const out = value.map(v => String(v || '').trim()).filter(Boolean).slice(0, max).map(v => v.slice(0, 140));
  return out.length ? out : fallback.slice(0, max);
}

function normalizeAiSocialInference(value: any, fallback?: XunjiSocialInference): XunjiSocialInference {
  const fb = fallback || {
    mood: '平稳地过着自己的日子',
    relationshipPulse: '关系温度稳定，适合从今天的小痕迹自然聊起。',
    screenlifeScore: 62,
    intimacySignals: [],
    frictionSignals: [],
    likelyNeeds: [],
    nextConversationSeeds: [],
    whisperHooks: [],
  };
  if (!value || typeof value !== 'object') return fb;
  return {
    mood: str(value.mood, fb.mood, 80),
    relationshipPulse: str(value.relationshipPulse, fb.relationshipPulse, 140),
    screenlifeScore: num(value.screenlifeScore, fb.screenlifeScore, 0, 100),
    intimacySignals: normalizeStringArray(value.intimacySignals, fb.intimacySignals, 4),
    frictionSignals: normalizeStringArray(value.frictionSignals, fb.frictionSignals, 4),
    likelyNeeds: normalizeStringArray(value.likelyNeeds, fb.likelyNeeds, 4),
    nextConversationSeeds: normalizeStringArray(value.nextConversationSeeds, fb.nextConversationSeeds, 4),
    whisperHooks: normalizeStringArray(value.whisperHooks, fb.whisperHooks, 4),
  };
}

function normalizeMomentTone(value: unknown, fallback: XunjiGeneratedMoment['tone'] = 'soft'): XunjiGeneratedMoment['tone'] {
  const raw = String(value || '').toLowerCase();
  if (raw === 'busy' || /忙|通勤|赶/.test(raw)) return 'busy';
  if (raw === 'private' || /私|藏|心/.test(raw)) return 'private';
  if (raw === 'social' || /社交|聊天|群/.test(raw)) return 'social';
  if (raw === 'alert' || /警|提醒|异常/.test(raw)) return 'alert';
  return fallback;
}

function normalizeAiMoments(
  value: any,
  fallback: XunjiGeneratedMoment[] = [],
  rangeStart: number,
  rangeEnd: number,
  seed: string,
): XunjiGeneratedMoment[] {
  if (!Array.isArray(value) || value.length === 0) return fallback;
  const span = Math.max(HOUR, rangeEnd - rangeStart);
  return value.slice(0, 6).map((item: any, i: number) => {
    const base = fallback[i];
    const parsedTime = clockOnDay(rangeEnd, item?.time || item?.at, base?.time || rangeStart + Math.floor(span * ((i + 1) / (value.length + 1))));
    return {
      id: id('xj_ai_moment', seed, i),
      time: clamp(parsedTime, Math.min(rangeStart, rangeEnd), Math.max(rangeStart, rangeEnd)),
      title: str(item?.title, base?.title || '屏幕动态', 50),
      body: str(item?.body || item?.summary || item?.text, base?.body || '屏幕短暂亮起，又安静下去。', 180),
      tone: normalizeMomentTone(item?.tone, base?.tone),
      relatedApp: str(item?.relatedApp || item?.appName, base?.relatedApp || '', 24) || undefined,
    };
  });
}

export function summarizeXunjiForCharacter(args: {
  run?: XunjiScreenlifeRun;
  snapshot?: XunjiMonitorSnapshot;
  reports?: XunjiReportItem[];
}): string {
  const lines: string[] = [];
  if (args.run) {
    lines.push(`循迹演出：${args.run.title}。${args.run.narrative}`);
    if (args.run.notes.length) lines.push(`随手记：${args.run.notes.map(n => n.text).slice(0, 3).join('；')}`);
    if (args.run.socialInference) {
      lines.push(`关系温度：${args.run.socialInference.mood}；${args.run.socialInference.relationshipPulse}`);
    }
    if (args.run.moments?.length) {
      lines.push(`右下角动态：${args.run.moments.slice(0, 2).map(m => `${m.title}：${m.body}`).join('；')}`);
    }
  }
  if (args.snapshot) {
    const topApp = [...args.snapshot.appUsage].sort((a, b) => (b.endedAt - b.startedAt) - (a.endedAt - a.startedAt))[0];
    lines.push(`今日手机：解锁 ${args.snapshot.unlockCount} 次，屏幕 ${args.snapshot.screenTimeMinutes} 分钟，电量 ${args.snapshot.batteryLevel}%。`);
    if (topApp) lines.push(`最长使用：${topApp.appName} ${Math.round((topApp.endedAt - topApp.startedAt) / MIN)} 分钟。`);
    const loc = args.snapshot.locations[0];
    if (loc) lines.push(`位置痕迹：最近在 ${loc.label}（${loc.address}）。`);
  }
  if (args.reports?.length) {
    lines.push(`报备：${args.reports.slice(0, 4).map(r => `${XUNJI_REPORT_LABELS[r.type]}：${r.title}`).join('；')}`);
  }
  return lines.join('\n');
}

export function buildXunjiChatContextBlock(args: {
  char: CharacterProfile;
  userName: string;
  run?: XunjiScreenlifeRun;
  snapshot?: XunjiMonitorSnapshot;
  reports?: XunjiReportItem[];
  maxLines?: number;
}): string {
  const lines: string[] = [];
  const maxLines = args.maxLines ?? 12;
  if (args.run) {
    lines.push(`最近一次 Screenlife：${args.run.title}。${args.run.narrative.slice(0, 180)}`);
    if (args.run.socialInference) {
      const s = args.run.socialInference;
      lines.push(`此刻内在状态：${s.mood}；${s.relationshipPulse}（关系温度 ${s.screenlifeScore}/100）。`);
      if (s.intimacySignals.length) lines.push(`亲近信号：${s.intimacySignals.slice(0, 3).join('；')}`);
      if (s.frictionSignals.length) lines.push(`需要留意：${s.frictionSignals.slice(0, 2).join('；')}`);
      if (s.nextConversationSeeds.length) lines.push(`适合在絮语里自然接的话题：${s.nextConversationSeeds.slice(0, 3).join('；')}`);
      if (s.whisperHooks.length) lines.push(`悄悄话钩子：${s.whisperHooks.slice(0, 2).join('；')}`);
    }
    if (args.run.moments?.length) {
      lines.push(`右下角动态：${args.run.moments.slice(0, 3).map(m => `${fmtTime(m.time)} ${m.title}：${m.body}`).join('；')}`);
    }
    if (args.run.notes.length) lines.push(`手机备忘录/随手记：${args.run.notes.slice(0, 3).map(n => n.text).join('；')}`);
  }
  if (args.snapshot) {
    const topApp = [...args.snapshot.appUsage].sort((a, b) => xunjiDurationMinutes(b) - xunjiDurationMinutes(a))[0];
    const loc = args.snapshot.locations[args.snapshot.locations.length - 1];
    lines.push(`今日手机状态：解锁 ${args.snapshot.unlockCount} 次，屏幕 ${args.snapshot.screenTimeMinutes} 分钟，电量 ${args.snapshot.batteryLevel}%，${args.snapshot.isCharging ? '正在充电' : '未充电'}。`);
    if (topApp) lines.push(`今天停留最久的 App：${topApp.appName} ${xunjiDurationMinutes(topApp)} 分钟，${topApp.note || '有一段明显停留'}。`);
    if (loc) lines.push(`最近位置痕迹：${loc.label}（${loc.address}），移动方式 ${transportLabel(loc.transport)}。`);
    lines.push(`身体状态：${args.snapshot.health.stressLabel}，HRV ${args.snapshot.health.hrvCurrent}/${args.snapshot.health.hrvAvg}，睡眠 ${Math.round(args.snapshot.health.sleepMinutes / 60 * 10) / 10} 小时，步数 ${args.snapshot.health.steps}。`);
  }
  if (args.reports?.length) {
    const unread = args.reports.filter(r => !r.acknowledged).slice(0, 4);
    const source = unread.length ? unread : args.reports.slice(0, 4);
    if (source.length) lines.push(`最近报备：${source.map(r => `${XUNJI_REPORT_LABELS[r.type]}：${r.title}`).join('；')}`);
  }
  return xunjiChatContextBlock({
    charName: args.char.name,
    userName: args.userName,
    lines: lines.filter(Boolean).slice(0, maxLines),
  });
}

export function buildXunjiMemoText(run: XunjiScreenlifeRun, reports: XunjiReportItem[] = []): string {
  const reportText = reports.length ? ` 报备摘录：${reports.slice(0, 3).map(r => r.title).join('；')}` : '';
  const socialText = run.socialInference ? ` 关系温度：${run.socialInference.mood}；${run.socialInference.nextConversationSeeds.slice(0, 2).join('；')}` : '';
  return `【循迹写回】${run.title}：${run.narrative.slice(0, 240)}${socialText}${reportText}`;
}

export function xunjiDurationMinutes(session: XunjiAppUsageSession): number {
  return Math.max(1, Math.round((session.endedAt - session.startedAt) / MIN));
}

export function xunjiBatteryEventLabel(event: XunjiBatteryEvent): string {
  return event.type === 'charge_start' ? '开始充电' : '结束充电';
}

export function xunjiLocationTransportLabel(point: XunjiLocationPoint): string {
  return transportLabel(point.transport);
}

export function xunjiFormatClock(ts: number): string {
  return fmtTime(ts);
}
