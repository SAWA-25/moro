import type {
  CharacterProfile,
  PhoneEvidence,
  PhoneLockState,
  UserProfile,
  XunjiMonitorSnapshot,
} from '../types';
import { getCheckPhoneAppDefinition, mergePhoneEvidenceRecords } from './checkPhone';

export type ScreenPeekSnapshotKind =
  | 'home'
  | 'lock'
  | 'chat'
  | 'delivery'
  | 'order'
  | 'social'
  | 'notes'
  | 'secret_space'
  | 'music'
  | 'album'
  | 'map'
  | 'health'
  | 'calendar'
  | 'call'
  | 'browser'
  | 'app';

export type ScreenPeekSnapshotSource = 'phone_home' | 'phone_lock' | 'phone_record';

export interface ScreenPeekSnapshot {
  id: string;
  charId: string;
  charName: string;
  charAvatar?: string;
  userName: string;
  userAvatar?: string;
  generatedAt: number;
  source: ScreenPeekSnapshotSource;
  appKind: ScreenPeekSnapshotKind;
  appName: string;
  title: string;
  subtitle?: string;
  summary: string;
  deviceName: string;
  tagline: string;
  wallpaper?: string;
  accent?: string;
  batteryLevel: number;
  isCharging: boolean;
  phoneModel?: string;
  records: PhoneEvidence[];
  primaryRecordId?: string;
  lock?: PhoneLockState;
}

export interface BuildScreenPeekSnapshotInput {
  char: CharacterProfile;
  userProfile: UserProfile;
  records?: PhoneEvidence[];
  xunjiSnapshot?: XunjiMonitorSnapshot | null;
  generatedAt?: number;
  fallbackWallpaper?: string;
  forceHome?: boolean;
}

const KIND_LABELS: Record<string, string> = {
  chat: '信息',
  delivery: '外卖',
  order: '购物',
  social: '动态',
  notes: '备忘录',
  secret_space: '秘密空间',
  music: '音乐',
  album: '相册',
  map: '地图',
  health: '健康',
  calendar: '日历',
  call: '电话',
  browser: '浏览',
  app: '手机',
};

const normalizeText = (value?: string): string =>
  (value || '').trim().replace(/\s+/g, ' ').toLowerCase();

const clampBattery = (value: unknown, fallback = 76): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(8, Math.min(100, Math.round(n)));
};

export const isScreenPeekLockActive = (lock?: PhoneLockState | null): lock is PhoneLockState =>
  !!lock?.active && !lock.unlockedAt;

export const screenPeekRecordAppName = (record?: PhoneEvidence | null): string => {
  if (!record) return '手机';
  return record.meta?.appName
    || getCheckPhoneAppDefinition(record.type)?.name
    || KIND_LABELS[record.type]
    || record.type
    || '手机';
};

export const screenPeekRecordKind = (record?: PhoneEvidence | null): ScreenPeekSnapshotKind => {
  const type = normalizeText(record?.type);
  const appName = normalizeText(screenPeekRecordAppName(record));
  const text = `${type} ${appName} ${normalizeText(record?.title)} ${normalizeText(record?.detail)}`;
  if (!record) return 'home';
  if (type === 'chat' || /微信|qq|信息|消息|聊天|私信|絮语/.test(text)) return 'chat';
  if (type === 'delivery' || /外卖|饭票|美团|饿了么|奶茶|咖啡|餐|配送/.test(text)) return 'delivery';
  if (type === 'order' || /购物|订单|淘宝|京东|心意铺|商品|购物车/.test(text)) return 'order';
  if (type === 'social' || /动态|朋友圈|小红书|微博|推特|twitter|社交/.test(text)) return 'social';
  if (type === 'secret_space' || /秘密空间|草稿|私密|心愿/.test(text)) return 'secret_space';
  if (type === 'notes' || /备忘|便签|待办|随手记|memo|note/.test(text)) return 'notes';
  if (type === 'music' || /音乐|网易云|qq音乐|歌|播放|播客/.test(text)) return 'music';
  if (type === 'album' || /相册|照片|图库|截图/.test(text)) return 'album';
  if (type === 'map' || /地图|定位|导航|打车|地点|位置/.test(text)) return 'map';
  if (type === 'health' || /健康|睡眠|心率|步数|运动/.test(text)) return 'health';
  if (type === 'calendar' || /日历|日程|提醒|纪念日/.test(text)) return 'calendar';
  if (type === 'call' || /电话|通话|未接|呼入|呼出/.test(text)) return 'call';
  if (type === 'browser' || /浏览|搜索|网页|热点|safari|chrome|edge/.test(text)) return 'browser';
  return 'app';
};

const sortedRecords = (records: PhoneEvidence[] = []): PhoneEvidence[] =>
  records
    .filter(record => record && (record.title || record.detail || record.value))
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

const scopedRecordsFor = (records: PhoneEvidence[], primary: PhoneEvidence): PhoneEvidence[] => {
  const primaryKind = screenPeekRecordKind(primary);
  const primaryApp = normalizeText(screenPeekRecordAppName(primary));
  const primarySource = [
    primary.meta?.relatedXunjiRunId,
    primary.meta?.relatedXunjiSnapshotId,
    primary.meta?.relatedReportId,
  ].filter(Boolean).join('|');
  const exact = records.filter(record => {
    if (screenPeekRecordKind(record) !== primaryKind) return false;
    if (normalizeText(screenPeekRecordAppName(record)) !== primaryApp) return false;
    if (!primarySource) return true;
    const source = [
      record.meta?.relatedXunjiRunId,
      record.meta?.relatedXunjiSnapshotId,
      record.meta?.relatedReportId,
    ].filter(Boolean).join('|');
    return !source || source === primarySource;
  });
  return (exact.length ? exact : [primary]).slice(0, 12);
};

export function buildScreenPeekSnapshot(input: BuildScreenPeekSnapshotInput): ScreenPeekSnapshot {
  const now = input.generatedAt || Date.now();
  const profile = input.char.phoneState?.profile || {};
  const lock = input.char.phoneState?.lock;
  const batteryLevel = clampBattery(input.xunjiSnapshot?.batteryLevel, 72);
  const base = {
    id: `screen-peek-snapshot-${input.char.id}-${now}`,
    charId: input.char.id,
    charName: input.char.convoSettings?.remarkName?.trim() || input.char.name,
    charAvatar: input.char.avatar,
    userName: input.userProfile.name || '用户',
    userAvatar: input.userProfile.avatar,
    generatedAt: now,
    deviceName: profile.deviceName || `${input.char.name} 的手机`,
    tagline: profile.tagline || '一台属于 TA 的虚拟手机',
    wallpaper: profile.wallpaper || input.char.dateBackground || input.fallbackWallpaper,
    accent: profile.accent,
    batteryLevel,
    isCharging: input.xunjiSnapshot?.isCharging === true,
    phoneModel: input.xunjiSnapshot?.phoneModel,
  };

  if (!input.forceHome && isScreenPeekLockActive(lock)) {
    return {
      ...base,
      source: 'phone_lock',
      appKind: 'lock',
      appName: '锁屏',
      title: '手机已锁住',
      subtitle: lock.ownerUserName,
      summary: lock.note || lock.message || '锁屏还停在当前留言上。',
      records: [],
      lock,
    };
  }

  const allRecords = sortedRecords(mergePhoneEvidenceRecords(input.records || [], []));
  const primary = input.forceHome ? undefined : allRecords[0];
  if (!primary) {
    return {
      ...base,
      source: 'phone_home',
      appKind: 'home',
      appName: '桌面',
      title: base.deviceName,
      subtitle: base.tagline,
      summary: input.xunjiSnapshot
        ? `屏幕使用 ${input.xunjiSnapshot.screenTimeMinutes} 分钟，最近没有停在具体记录页。`
        : '没有可用记录，停留在手机桌面。',
      records: allRecords.slice(0, 6),
    };
  }

  const appKind = screenPeekRecordKind(primary);
  const appName = screenPeekRecordAppName(primary);
  const records = scopedRecordsFor(allRecords, primary);
  const primaryTitle = (primary.title || '').trim();
  const title = appKind === 'music' && primaryTitle ? primaryTitle : appName;
  const subtitle = appKind === 'music' ? appName : primaryTitle || appName;
  return {
    ...base,
    source: 'phone_record',
    appKind,
    appName,
    title,
    subtitle,
    summary: primary.detail || primary.value || primaryTitle || `${appName} 停留在当前页面。`,
    records,
    primaryRecordId: primary.id,
  };
}

export const screenPeekCardUsesScreenshot = (card?: { screenshotDataUrl?: string | null } | null): boolean =>
  typeof card?.screenshotDataUrl === 'string' && /^data:image\//.test(card.screenshotDataUrl);
