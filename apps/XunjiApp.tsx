import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowsClockwise,
  Bell,
  CaretLeft,
  CheckCircle,
  Compass,
  Eye,
  GearSix,
  Heartbeat,
  MapPin,
  PhoneCall,
  Play,
  Sparkle,
  Trash,
} from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { resolveAuxApi } from '../utils/auxApi';
import { buildFullActiveUserSetting } from '../utils/characterPromptProfile';
import type {
  CharacterProfile,
  Message,
  XunjiCharacterLocationSettings,
  XunjiDensity,
  XunjiGeneratedMoment,
  XunjiMonitorSnapshot,
  XunjiReportItem,
  XunjiReportType,
  XunjiScreenlifeRun,
  XunjiSettings,
} from '../types';
import { AppID } from '../types';
import {
  DEFAULT_XUNJI_REPORT_RULES,
  XUNJI_REPORT_LABELS,
  buildXunjiLocationSourceForChar,
  buildXunjiMemoText,
  createDefaultXunjiSettings,
  generateXunjiMonitorSnapshot,
  generateXunjiRealtimeSnapshot,
  generateXunjiReports,
  generateXunjiScreenlifeRun,
  getXunjiCharacterLocationSettings,
  hasXunjiLocationPatch,
  normalizeXunjiSettings,
  notifyXunjiReports,
  patchXunjiCharacterLocationSettings,
  shouldAutoAdvanceXunji,
  summarizeXunjiForCharacter,
  xunjiBatteryEventLabel,
  xunjiDurationMinutes,
  xunjiFormatClock,
  xunjiLocationTransportLabel,
} from '../utils/xunji';

type RangePreset = 'today' | 'yesterday' | 'last2h' | 'custom';
type XunjiHomeSection = 'overview' | 'generate' | 'monitor' | 'link';
const AUTO_TRACE_CHECK_MS = 60 * 1000;
const AUTO_TRACE_REPORT_GRACE_MS = 2 * 60 * 1000;
type XunjiWindowId =
  | 'screenlife'
  | 'social'
  | 'moments'
  | 'timeline'
  | 'monitor'
  | 'phone'
  | 'network'
  | 'device'
  | 'location'
  | 'health'
  | 'calls'
  | 'battery'
  | 'report'
  | 'settings';

const WINDOW_META: Record<XunjiWindowId, { label: string; sub: string; icon: React.ReactNode; tone: string }> = {
  screenlife: { label: '屏幕记录', sub: '生成指定时间段的手机使用记录', icon: <Sparkle size={18} weight="fill" />, tone: 'from-cyan-50 to-white' },
  social: { label: '关系线索', sub: '整理情绪、亲近信号和迟疑点', icon: <Heartbeat size={18} weight="fill" />, tone: 'from-rose-50 to-white' },
  moments: { label: '浮窗动态', sub: '查看短事件卡和边角提醒', icon: <Bell size={18} weight="fill" />, tone: 'from-amber-50 to-white' },
  timeline: { label: '时间线', sub: '把屏幕、位置、报备和设备事件排成一条线', icon: <Compass size={18} weight="fill" />, tone: 'from-indigo-50 to-white' },
  monitor: { label: '实时概览', sub: '刷新位置、设备和健康概况', icon: <Eye size={18} weight="fill" />, tone: 'from-slate-50 to-white' },
  phone: { label: '使用统计', sub: 'App 使用、解锁、锁屏和排行', icon: <Eye size={18} weight="bold" />, tone: 'from-cyan-50 to-white' },
  network: { label: '网络切换', sub: 'WiFi / 移动数据记录', icon: <Compass size={18} weight="bold" />, tone: 'from-emerald-50 to-white' },
  device: { label: '设备状态', sub: '机型、电量和充电状态', icon: <GearSix size={18} weight="bold" />, tone: 'from-slate-50 to-white' },
  location: { label: '位置轨迹', sub: '距离、停留点、移动方式和历史轨迹', icon: <MapPin size={18} weight="fill" />, tone: 'from-lime-50 to-white' },
  health: { label: '健康数据', sub: 'HRV、心率、睡眠和步数趋势', icon: <Heartbeat size={18} weight="fill" />, tone: 'from-pink-50 to-white' },
  calls: { label: '通话记录', sub: '通话对象、时长和状态', icon: <PhoneCall size={18} weight="fill" />, tone: 'from-violet-50 to-white' },
  battery: { label: '电量记录', sub: '电量变化和充电开始 / 结束', icon: <Bell size={18} weight="bold" />, tone: 'from-yellow-50 to-white' },
  report: { label: '报备', sub: '查看时间流和规则提醒', icon: <CheckCircle size={18} weight="fill" />, tone: 'from-orange-50 to-white' },
  settings: { label: '絮语联动', sub: '聊天上下文、自动更新和写入记忆', icon: <GearSix size={18} weight="bold" />, tone: 'from-stone-50 to-white' },
};

const DENSITY_LABEL: Record<XunjiDensity, string> = { light: '轻量', standard: '标准', detailed: '详细' };
type XunjiTimelineKind = 'screenlife' | 'report' | 'phone' | 'location' | 'network' | 'call' | 'battery' | 'health';
type XunjiTimelineFilter = 'all' | XunjiTimelineKind;
type XunjiTimelineItem = {
  id: string;
  at: number;
  kind: XunjiTimelineKind;
  title: string;
  body: string;
  source: string;
  accent: string;
};
const REPORT_GROUPS: { title: string; types: XunjiReportType[] }[] = [
  { title: '手机解锁次数', types: ['unlock_count'] },
  { title: '网络切换', types: ['network_switch'] },
  { title: '软件使用', types: ['app_open', 'app_close', 'app_hourly'] },
  { title: '电量', types: ['charge_start', 'charge_end'] },
  { title: '当前位置', types: ['move_start', 'stay', 'transit', 'arrive'] },
  { title: '电话', types: ['call_start', 'call_10min'] },
  { title: '睡眠', types: ['sleep_phone_off', 'sleep_late_reminder', 'sleep_5h', 'sleep_end'] },
];

const fmtDateTime = (ts: number) => new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const fmtReportStamp = (ts: number) => {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fmtMinutes = (mins: number) => mins >= 60 ? `${Math.floor(mins / 60)}小时${mins % 60}分` : `${mins}分`;
const isImg = (s?: string) => !!s && /^(https?:|data:|blob:|\/)/.test(s);
const cityLabel = (char?: CharacterProfile) => {
  if (!char) return '未设城市';
  if (char.cityConfig?.mode === 'real' && char.cityConfig.realCity) return char.cityConfig.realCity;
  if (char.cityConfig?.mode === 'virtual') return char.cityConfig.virtualName || char.cityConfig.prototypeCity || char.socialProfile?.region || '架空城市';
  return char.socialProfile?.region || '未设城市';
};

function toLocalInput(ts: number): string {
  const d = new Date(ts - new Date(ts).getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

function fromLocalInput(value: string, fallback: number): number {
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : fallback;
}

const Avatar: React.FC<{ char?: CharacterProfile; size?: number }> = ({ char, size = 42 }) => {
  const [broken, setBroken] = useState(false);
  const avatar = char?.avatar || '';
  const showImage = isImg(avatar) && !broken;
  const fallback = !isImg(avatar) && avatar ? avatar : '🧭';

  useEffect(() => {
    setBroken(false);
  }, [avatar]);

  return (
    <div className="shrink-0 rounded-2xl overflow-hidden flex items-center justify-center bg-white text-xl border border-black/10 shadow-sm" style={{ width: size, height: size }}>
      {showImage ? (
        <img src={avatar} alt={char?.name || '角色头像'} className="w-full h-full object-cover" onError={() => setBroken(true)} />
      ) : (
        <span>{fallback}</span>
      )}
    </div>
  );
};

const Toggle: React.FC<{ on: boolean; onChange: (next: boolean) => void; label?: string }> = ({ on, onChange, label }) => (
  <button
    type="button"
    aria-pressed={on}
    onClick={() => onChange(!on)}
    className="inline-flex shrink-0 items-center gap-2 rounded-full transition active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-700/30"
  >
    <span className={`relative block h-6 w-11 shrink-0 rounded-full transition-colors ${on ? 'bg-cyan-950' : 'bg-slate-300'}`}>
      <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0'}`} />
    </span>
    {label && <span className={`text-[11px] font-black ${on ? 'text-cyan-950' : 'text-slate-500'}`}>{label}</span>}
  </button>
);

const PillButton: React.FC<{ active?: boolean; onClick?: () => void; children: React.ReactNode; icon?: React.ReactNode; disabled?: boolean }> = ({ active, onClick, children, icon, disabled }) => (
  <button
    disabled={disabled}
    onClick={onClick}
    className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full px-3 py-2 text-[12px] font-black transition active:scale-95 disabled:opacity-50 ${active ? 'bg-cyan-950 text-white shadow-lg shadow-cyan-950/15' : 'bg-white text-slate-700 border border-slate-200'}`}
  >
    {icon}{children}
  </button>
);

const Panel: React.FC<{ title: string; icon?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }> = ({ title, icon, right, children, defaultOpen = true }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-[8px] bg-white border border-slate-200 shadow-sm overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 px-3 py-3 text-left">
        <span className="w-8 h-8 rounded-full bg-cyan-50 text-cyan-800 flex items-center justify-center">{icon || <Compass size={16} weight="bold" />}</span>
        <span className="flex-1 min-w-0 font-black text-[14px] text-slate-900">{title}</span>
        {right}
        <span className={`text-slate-400 transition ${open ? 'rotate-90' : ''}`}>›</span>
      </button>
      {open && <div className="px-3 pb-3 space-y-3">{children}</div>}
    </section>
  );
};

const Stat: React.FC<{ label: string; value: React.ReactNode; sub?: string }> = ({ label, value, sub }) => (
  <div className="rounded-[8px] p-3 border bg-cyan-50/60 border-cyan-100">
    <div className="text-[11px] text-slate-500 font-bold">{label}</div>
    <div className="mt-1 text-[18px] font-black text-slate-950 leading-none">{value}</div>
    {sub && <div className="mt-1 text-[10px] text-slate-500">{sub}</div>}
  </div>
);

const reportIcon = (type: XunjiReportType) => {
  if (type.startsWith('call')) return <PhoneCall size={19} weight="fill" />;
  if (['move_start', 'stay', 'transit', 'arrive'].includes(type)) return <MapPin size={19} weight="fill" />;
  if (type.startsWith('sleep')) return <Heartbeat size={19} weight="fill" />;
  if (type.startsWith('charge')) return <Bell size={19} weight="fill" />;
  if (type === 'network_switch') return <Compass size={19} weight="fill" />;
  return <Eye size={19} weight="fill" />;
};

const reportTone = (item: XunjiReportItem) => {
  if (item.severity === 'warning') return 'bg-rose-50 text-rose-600 border-rose-100';
  if (item.severity === 'notice') return 'bg-amber-50 text-amber-600 border-amber-100';
  if (['move_start', 'stay', 'transit', 'arrive'].includes(item.type)) return 'bg-orange-50 text-orange-500 border-orange-100';
  if (item.type.startsWith('charge')) return 'bg-emerald-50 text-emerald-500 border-emerald-100';
  return 'bg-lime-50 text-lime-600 border-lime-100';
};

const reportLineText = (item: XunjiReportItem) => {
  switch (item.type) {
    case 'unlock_count':
      return 'TA手机屏幕使用记录已更新';
    case 'network_switch':
      return 'TA切换了网络';
    case 'app_open':
      return `TA打开了 ${item.relatedApp || item.title.replace(/^进入\s*/, '')}`;
    case 'app_close':
      return `TA关闭了 ${item.relatedApp || item.title.replace(/^关闭\s*/, '')}`;
    case 'app_hourly':
      return `${item.relatedApp || '手机屏幕'} 使用时长提醒`;
    case 'charge_start':
      return 'TA手机开始充电了';
    case 'charge_end':
      return 'TA手机结束充电了';
    case 'move_start':
      return 'TA开始移动';
    case 'stay':
      return item.title.replace(/^停留在/, 'TA停留在');
    case 'transit':
      return 'TA正在路上';
    case 'arrive':
      return item.title.startsWith('到达') ? `TA${item.title}` : item.title;
    case 'call_start':
      return 'TA开始了一通电话';
    case 'call_10min':
      return 'TA通话超过10分钟';
    case 'sleep_phone_off':
      return 'TA睡前关闭了手机';
    case 'sleep_late_reminder':
      return 'TA还没有进入睡眠';
    case 'sleep_5h':
      return 'TA睡眠已持续5小时';
    case 'sleep_end':
      return 'TA睡眠结束';
    default:
      return item.title;
  }
};

const mergeReports = (incoming: XunjiReportItem[], existing: XunjiReportItem[] = [], limit = 100) => {
  const map = new Map<string, XunjiReportItem>();
  [...incoming, ...existing].forEach(item => map.set(item.id, { ...map.get(item.id), ...item }));
  return Array.from(map.values()).sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
};

const preserveReportState = (incoming: XunjiReportItem[], existing: XunjiReportItem[]) => {
  const old = new Map(existing.map(item => [item.id, item]));
  return incoming.map(item => {
    const prev = old.get(item.id);
    return prev ? { ...item, acknowledged: prev.acknowledged, writtenBack: prev.writtenBack } : item;
  });
};

const Sparkline: React.FC<{ values: number[]; color?: string; height?: number }> = ({ values, color = '#0891b2', height = 52 }) => {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(1, max - min);
  const points = values.map((v, i) => {
    const x = values.length <= 1 ? 0 : (i / (values.length - 1)) * 100;
    const y = 100 - ((v - min) / range) * 82 - 9;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg viewBox="0 0 100 100" className="w-full" style={{ height }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

const Bars: React.FC<{ rows: { label: string; value: number; sub?: string }[]; max?: number }> = ({ rows, max }) => {
  const top = max || Math.max(...rows.map(r => r.value), 1);
  return (
    <div className="space-y-2">
      {rows.map(row => (
        <div key={row.label}>
          <div className="flex items-center justify-between gap-2 text-[11px] font-bold text-slate-600">
            <span className="truncate">{row.label}</span><span className="shrink-0">{row.sub || row.value}</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full rounded-full bg-cyan-700" style={{ width: `${Math.max(5, Math.min(100, row.value / top * 100))}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
};

const EmptyState: React.FC<{ text: string }> = ({ text }) => (
  <div className="rounded-[8px] border border-dashed border-slate-300 bg-white/70 p-4 text-center text-[12px] text-slate-500 font-bold">{text}</div>
);

const XunjiApp: React.FC = () => {
  const { closeApp, openApp, characters, activeCharacterId, setActiveCharacterId, apiConfig, auxApiConfig, userProfile, updateCharacter, addToast } = useOS();
  const defaultCharId = activeCharacterId || characters[0]?.id;
  const [settings, setSettings] = useState<XunjiSettings>(() => createDefaultXunjiSettings(defaultCharId));
  const [snapshot, setSnapshot] = useState<XunjiMonitorSnapshot | null>(null);
  const [snapshots, setSnapshots] = useState<XunjiMonitorSnapshot[]>([]);
  const [reports, setReports] = useState<XunjiReportItem[]>([]);
  const [runs, setRuns] = useState<XunjiScreenlifeRun[]>([]);
  const [activeWindow, setActiveWindow] = useState<XunjiWindowId | null>(null);
  const [loading, setLoading] = useState(false);
  const [rangePreset, setRangePreset] = useState<RangePreset>('today');
  const [density, setDensity] = useState<XunjiDensity>('standard');
  const [customStart, setCustomStart] = useState(() => toLocalInput(Date.now() - 2 * 60 * 60 * 1000));
  const [customEnd, setCustomEnd] = useState(() => toLocalInput(Date.now()));
  const [routeExpanded, setRouteExpanded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const autoAdvancingRef = useRef(false);

  const activeChar = useMemo(() => {
    const id = settings.activeCharId || defaultCharId;
    return characters.find(c => c.id === id) || characters[0];
  }, [characters, defaultCharId, settings.activeCharId]);

  const activeSnapshot = activeChar && snapshot?.charId === activeChar.id ? snapshot : null;
  const activeReports = activeChar ? reports.filter(r => r.charId === activeChar.id) : [];
  const activeRuns = activeChar ? runs.filter(r => r.charId === activeChar.id) : [];

  const buildLocationSource = (s: XunjiSettings = settings, char: CharacterProfile | undefined = activeChar) => (
    buildXunjiLocationSourceForChar(s, char?.id)
  );
  const promptUserName = userProfile?.name || '用户';
  const buildPromptUserSetting = () => buildFullActiveUserSetting(userProfile, { fallback: `用户名：${promptUserName}` });
  const loadRecentWhisperMessages = (charId: string) => DB.getRecentMessagesByCharId(charId, 20, true).catch(() => [] as Message[]);

  const persistSettings = (patch: Partial<XunjiSettings>) => {
    if (patch.activeCharId && patch.activeCharId !== settings.activeCharId) {
      setSnapshot(null);
      setReports([]);
      setRuns([]);
      setActiveCharacterId(patch.activeCharId);
    }
    const containsLocationPatch = hasXunjiLocationPatch(patch);
    const targetCharId = patch.activeCharId || activeChar?.id || settings.activeCharId || defaultCharId;
    const applyPatch = (base: XunjiSettings): XunjiSettings => {
      const restPatch = { ...patch };
      if (containsLocationPatch) {
        delete restPatch.locationSource;
        delete restPatch.customLocation;
        delete restPatch.customLocationUpdatedAt;
        delete restPatch.browserLocation;
      }
      const nextBase = {
        ...base,
        ...(containsLocationPatch ? restPatch : patch),
        reportRules: patch.reportRules || base.reportRules,
        locationByCharId: base.locationByCharId || {},
      };
      return containsLocationPatch
        ? patchXunjiCharacterLocationSettings(nextBase, targetCharId, patch as Partial<XunjiCharacterLocationSettings>)
        : nextBase;
    };
    const projected = applyPatch(settings);
    setSettings(prev => {
      const next = applyPatch(prev);
      void DB.saveXunjiSettings(next);
      return next;
    });
    if (
      activeChar
      && containsLocationPatch
    ) {
      const nextSnapshot = generateXunjiMonitorSnapshot({
        char: activeChar,
        previous: activeSnapshot,
        locationSource: buildLocationSource(projected, activeChar),
      });
      void DB.saveXunjiSnapshot(nextSnapshot);
      setSnapshot(nextSnapshot);
      setSnapshots(prev => [nextSnapshot, ...prev.filter(item => item.id !== nextSnapshot.id && item.charId === activeChar.id)].slice(0, 12));
    }
  };

  useEffect(() => {
    let alive = true;
    DB.getXunjiSettings().then(saved => {
      if (!alive) return;
      const next = normalizeXunjiSettings(saved || createDefaultXunjiSettings(defaultCharId), activeCharacterId || saved?.activeCharId || defaultCharId);
      setSettings(next);
      setDensity(next.defaultDensity);
      void DB.saveXunjiSettings(next);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [activeCharacterId, defaultCharId]);

  const selectCharacter = (id: string) => {
    persistSettings({ activeCharId: id });
  };

  useEffect(() => {
    if (!activeChar) return;
    let alive = true;
    setSnapshot(null);
    setSnapshots([]);
    setReports([]);
    setRuns([]);
    (async () => {
      const [savedSnapshots, savedReports, savedRuns] = await Promise.all([
        DB.getXunjiSnapshots(activeChar.id, 12),
        DB.getXunjiReports(activeChar.id, 80),
        DB.getXunjiRuns(activeChar.id, 10),
      ]);
      if (!alive) return;
      const latest = savedSnapshots[0];
      if (latest) {
        setSnapshot(latest);
        setSnapshots(savedSnapshots.filter(item => item.charId === activeChar.id));
      } else {
        const generated = generateXunjiMonitorSnapshot({
          char: activeChar,
          locationSource: buildLocationSource(settings, activeChar),
        });
        await DB.saveXunjiSnapshot(generated);
        if (alive) {
          setSnapshot(generated);
          setSnapshots([generated]);
        }
      }
      setReports(savedReports.filter(r => r.charId === activeChar.id));
      setRuns(savedRuns.filter(run => run.charId === activeChar.id));
    })().catch(() => addToast('循迹数据读取失败', 'error'));
    return () => { alive = false; };
  }, [activeChar?.id]);

  const range = useMemo(() => {
    const now = Date.now();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    if (rangePreset === 'yesterday') {
      const s = start.getTime() - 24 * 60 * 60 * 1000;
      return { start: s, end: s + 24 * 60 * 60 * 1000 - 1 };
    }
    if (rangePreset === 'last2h') return { start: now - 2 * 60 * 60 * 1000, end: now };
    if (rangePreset === 'custom') return { start: fromLocalInput(customStart, now - 2 * 60 * 60 * 1000), end: fromLocalInput(customEnd, now) };
    return { start: start.getTime(), end: now };
  }, [customEnd, customStart, rangePreset]);

  const refreshSnapshot = async () => {
    if (!activeChar) return;
    setSyncing(true);
    try {
      const api = resolveAuxApi(auxApiConfig, apiConfig);
      const hasApi = !!(api.baseUrl && api.model);
      let userSetting: string | undefined;
      let recentMessages: Message[] | undefined;
      if (hasApi) {
        [userSetting, recentMessages] = await Promise.all([
          buildPromptUserSetting(),
          loadRecentWhisperMessages(activeChar.id),
        ]);
      }
      const next = await generateXunjiRealtimeSnapshot({
        char: activeChar,
        previous: activeSnapshot,
        api: hasApi ? { baseUrl: api.baseUrl, apiKey: api.apiKey, model: api.model } : null,
        locationSource: buildLocationSource(settings, activeChar),
        userSetting,
        userName: promptUserName,
        recentMessages,
      });
      await DB.saveXunjiSnapshot(next);
      setSnapshot(next);
      setSnapshots(prev => [next, ...prev.filter(item => item.id !== next.id && item.charId === activeChar.id)].slice(0, 12));
      const items = preserveReportState(generateXunjiReports({ char: activeChar, snapshot: next, rules: settings.reportRules }).slice(0, 6), activeReports);
      if (items.length) {
        await DB.saveXunjiReports(items);
        notifyXunjiReports(items, activeChar);
        setReports(prev => mergeReports(items, prev.filter(r => r.charId === activeChar.id)));
      }
      addToast(hasApi ? '实时数据已更新' : '今日数据已更新', 'success');
    } catch (e) {
      console.error('[Xunji] refreshSnapshot failed', e);
      addToast('循迹实时同步失败', 'error');
    } finally {
      setSyncing(false);
    }
  };

  const generateReportsNow = async () => {
    if (!activeChar) return;
    let snap = activeSnapshot;
    if (!snap) {
      snap = generateXunjiMonitorSnapshot({ char: activeChar, locationSource: buildLocationSource(settings, activeChar) });
      await DB.saveXunjiSnapshot(snap);
      setSnapshot(snap);
    }
    const items = preserveReportState(generateXunjiReports({ char: activeChar, snapshot: snap, rules: settings.reportRules }), activeReports);
    await DB.saveXunjiReports(items);
    notifyXunjiReports(items, activeChar);
    setReports(prev => mergeReports(items, prev.filter(r => r.charId === activeChar.id)));
    addToast(`已生成 ${items.length} 条事件提醒`, 'success');
  };

  const markReport = async (id: string, patch: Partial<XunjiReportItem>) => {
    if (!activeReports.some(r => r.id === id)) return;
    await DB.updateXunjiReport(id, patch);
    setReports(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  };

  const markAllRead = async () => {
    const targets = activeReports.filter(r => !r.acknowledged);
    await Promise.all(targets.map(r => DB.updateXunjiReport(r.id, { acknowledged: true })));
    setReports(prev => prev.map(r => targets.some(target => target.id === r.id) ? { ...r, acknowledged: true } : r));
    addToast('事件提醒已全部标记已读', 'success');
  };

  const writeReportsBack = async () => {
    if (!activeChar || activeReports.length === 0) return;
    const chosen = activeReports.filter(r => !r.writtenBack).slice(0, 8);
    if (chosen.length === 0) {
      addToast('没有新的报备需要写入', 'info');
      return;
    }
    const memo = {
      id: `memo_xunji_reports_${Date.now()}`,
      by: 'char' as const,
      createdAt: Date.now(),
      text: `【循迹报备写回】${chosen.map(r => `${XUNJI_REPORT_LABELS[r.type]}：${r.title}`).join('；')}`,
    };
    await updateCharacter(activeChar.id, { memos: [memo, ...(activeChar.memos || [])].slice(0, 80) });
    await Promise.all(chosen.map(r => DB.updateXunjiReport(r.id, { writtenBack: true })));
    setReports(prev => prev.map(r => chosen.some(c => c.id === r.id) ? { ...r, writtenBack: true } : r));
    addToast('事件提醒已写入角色日常', 'success');
  };

  const writeSingleReportBack = async (id: string) => {
    if (!activeChar) return;
    const item = activeReports.find(r => r.id === id);
    if (!item) return;
    const memo = {
      id: `memo_xunji_report_${item.id}_${Date.now()}`,
      by: 'char' as const,
      createdAt: Date.now(),
      text: `【循迹报备写回】${XUNJI_REPORT_LABELS[item.type]}：${item.title}。${item.body}`,
    };
    await updateCharacter(activeChar.id, { memos: [memo, ...(activeChar.memos || [])].slice(0, 80) });
    await DB.updateXunjiReport(item.id, { writtenBack: true, acknowledged: true });
    setReports(prev => prev.map(r => r.id === item.id ? { ...r, writtenBack: true, acknowledged: true } : r));
    addToast('这条报备已写入角色日常', 'success');
  };

  const writeLatestTraceBack = async () => {
    if (!activeChar) return;
    const latestRun = activeRuns[0];
    const text = summarizeXunjiForCharacter({ run: latestRun, snapshot: activeSnapshot || undefined, reports: activeReports.slice(0, 4) });
    if (!text.trim()) {
      addToast('还没有可写回的循迹内容', 'error');
      return;
    }
    const memo = {
      id: `memo_xunji_context_${Date.now()}`,
      by: 'char' as const,
      createdAt: Date.now(),
      text: `【循迹同步到絮语】${text.slice(0, 700)}`,
    };
    await updateCharacter(activeChar.id, { memos: [memo, ...(activeChar.memos || [])].slice(0, 80) });
    addToast('循迹已写入角色备忘录，絮语会接得更自然', 'success');
  };

  const openWhisperChat = () => {
    if (activeChar) setActiveCharacterId(activeChar.id);
    openApp(AppID.GroupChat);
  };

  const runScreenlifeForRange = async (options?: { rangeStart?: number; rangeEnd?: number; silent?: boolean; auto?: boolean }) => {
    if (!activeChar) return;
    if (!options?.silent) setLoading(true);
    try {
      const now = Date.now();
      const rangeStart = options?.rangeStart ?? Math.min(range.start, range.end - 30 * 60 * 1000);
      const rangeEnd = options?.rangeEnd ?? Math.max(range.end, range.start + 30 * 60 * 1000);
      const api = resolveAuxApi(auxApiConfig, apiConfig);
      const hasApi = !!(api.baseUrl && api.model);
      const [userSetting, recentMessages] = await Promise.all([
        hasApi ? buildPromptUserSetting() : Promise.resolve(undefined),
        loadRecentWhisperMessages(activeChar.id),
      ]);
      const run = await generateXunjiScreenlifeRun({
        char: activeChar,
        api: hasApi ? { baseUrl: api.baseUrl, apiKey: api.apiKey, model: api.model } : null,
        rangeStart,
        rangeEnd,
        density: options?.auto ? settings.defaultDensity || density : density,
        writeBack: options?.auto ? false : settings.writeBackToCharacter,
        userSetting,
        userName: promptUserName,
        recentMessages,
        seed: options?.auto ? `${activeChar.id}_${rangeStart}_${rangeEnd}_auto` : undefined,
      });
      await DB.saveXunjiRun(run);

      let nextSnapshot = activeSnapshot;
      if (options?.auto) {
        nextSnapshot = await generateXunjiRealtimeSnapshot({
          char: activeChar,
          previous: activeSnapshot,
          api: hasApi ? { baseUrl: api.baseUrl, apiKey: api.apiKey, model: api.model } : null,
          locationSource: buildLocationSource(settings, activeChar),
          userSetting,
          userName: promptUserName,
          recentMessages,
          now,
        });
        await DB.saveXunjiSnapshot(nextSnapshot);
        setSnapshot(nextSnapshot);
        setSnapshots(prev => nextSnapshot ? [nextSnapshot, ...prev.filter(item => item.id !== nextSnapshot?.id && item.charId === activeChar.id)].slice(0, 12) : prev);
      }

      let linkedReports: XunjiReportItem[] = [];
      if (run.writeBack) {
        const snap = activeSnapshot || generateXunjiMonitorSnapshot({ char: activeChar, locationSource: buildLocationSource(settings, activeChar) });
        if (!activeSnapshot) {
          await DB.saveXunjiSnapshot(snap);
          setSnapshot(snap);
        }
        linkedReports = generateXunjiReports({ char: activeChar, snapshot: snap, rules: settings.reportRules }).slice(0, 4).map(item => ({ ...item, writtenBack: true, acknowledged: true }));
        await DB.saveXunjiReports(linkedReports);
        const memo = {
          id: `memo_xunji_run_${run.id}`,
          by: 'char' as const,
          createdAt: Date.now(),
          text: buildXunjiMemoText(run, linkedReports),
        };
        await updateCharacter(activeChar.id, { memos: [memo, ...(activeChar.memos || [])].slice(0, 80) });
        setReports(prev => mergeReports(linkedReports, prev.filter(r => r.charId === activeChar.id)));
        addToast('屏幕记录已写入角色日常', 'success');
      } else if (options?.auto) {
        const reportSource = nextSnapshot || activeSnapshot;
        if (reportSource) {
          linkedReports = preserveReportState(generateXunjiReports({ char: activeChar, snapshot: reportSource, rules: settings.reportRules, now })
            .filter(item => item.timestamp >= rangeStart - AUTO_TRACE_REPORT_GRACE_MS && item.timestamp <= rangeEnd + AUTO_TRACE_REPORT_GRACE_MS)
            .slice(0, 4), activeReports);
          if (linkedReports.length) {
            await DB.saveXunjiReports(linkedReports);
            notifyXunjiReports(linkedReports, activeChar);
            setReports(prev => mergeReports(linkedReports, prev.filter(r => r.charId === activeChar.id)));
          }
        }
      } else {
        addToast('屏幕记录已保存', 'success');
      }
      setRuns(prev => [run, ...prev.filter(item => item.charId === activeChar.id)].slice(0, 10));
      if (options?.auto) {
        setSettings(prev => {
          const nextSettings = {
            ...prev,
            autoTraceLastAtByChar: { ...(prev.autoTraceLastAtByChar || {}), [activeChar.id]: rangeEnd },
          };
          void DB.saveXunjiSettings(nextSettings);
          return nextSettings;
        });
      }
    } catch (e) {
      console.error('[Xunji] runScreenlife failed', e);
      if (!options?.silent) addToast('屏幕记录生成失败', 'error');
    } finally {
      if (!options?.silent) setLoading(false);
    }
  };

  const runScreenlife = () => runScreenlifeForRange();

  const deleteRun = async (runId: string) => {
    const run = activeRuns.find(item => item.id === runId);
    if (!run) return;
    if (!window.confirm(`删除这条屏幕记录「${run.title}」？`)) return;
    await DB.deleteXunjiRun(runId);
    setRuns(prev => prev.filter(item => item.id !== runId));
    addToast('屏幕记录已删除', 'success');
  };

  useEffect(() => {
    if (!activeChar) return;
    const tick = () => {
      if (autoAdvancingRef.current || loading || syncing) return;
      const decision = shouldAutoAdvanceXunji({
        settings,
        charId: activeChar.id,
        latestRun: activeRuns[0],
        latestSnapshot: activeSnapshot,
      });
      if (!decision.shouldRun) return;
      autoAdvancingRef.current = true;
      void runScreenlifeForRange({
        rangeStart: decision.rangeStart,
        rangeEnd: decision.rangeEnd,
        auto: true,
        silent: true,
      }).finally(() => {
        autoAdvancingRef.current = false;
      });
    };

    tick();
    const timer = window.setInterval(tick, AUTO_TRACE_CHECK_MS);
    return () => window.clearInterval(timer);
  }, [
    activeChar?.id,
    settings,
    activeRuns[0]?.id,
    activeRuns[0]?.rangeEnd,
    activeSnapshot?.generatedAt,
    loading,
    syncing,
  ]);

  const clearData = async () => {
    if (!activeChar) return;
    if (!window.confirm(`清空 ${activeChar.name} 的循迹数据？`)) return;
    const count = await DB.clearXunjiForChar(activeChar.id);
    setSnapshot(null);
    setSnapshots([]);
    setReports([]);
    setRuns([]);
    setSettings(prev => {
      const { [activeChar.id]: _cleared, ...rest } = prev.autoTraceLastAtByChar || {};
      const next = { ...prev, autoTraceLastAtByChar: rest };
      void DB.saveXunjiSettings(next);
      return next;
    });
    addToast(`已清空 ${count} 条循迹数据`, 'success');
  };

  if (!activeChar) {
    return (
      <div className="h-full bg-slate-100 flex flex-col">
        <Header closeApp={closeApp} />
        <div className="flex-1 flex items-center justify-center p-6"><EmptyState text="还没有角色，循迹需要先选择一个角色。" /></div>
      </div>
    );
  }

  return (
    <div className="relative h-full overflow-hidden bg-[#eef3f4] text-slate-900 flex flex-col">
      <Header closeApp={closeApp} />
      <main className="flex-1 min-h-0 overflow-y-auto px-3 pb-5 space-y-3">
        <RoleCard
          char={activeChar}
          characters={characters}
          settings={settings}
          snapshot={activeSnapshot}
          syncing={syncing}
          onSelect={selectCharacter}
        />

        <WorkbenchHome
          snapshot={activeSnapshot}
          reports={activeReports}
          runs={activeRuns}
          snapshots={snapshots}
          settings={settings}
          syncing={syncing}
          loading={loading}
          onOpen={setActiveWindow}
          onRefresh={refreshSnapshot}
          onRun={runScreenlife}
          onOpenChat={openWhisperChat}
          onWriteBack={writeLatestTraceBack}
          onToggleChatContext={next => persistSettings({ chatContextEnabled: next })}
        />
      </main>

      {activeWindow === 'screenlife' && (
        <div className="absolute right-3 bottom-4 z-20">
          <Toggle on={settings.writeBackToCharacter} onChange={next => persistSettings({ writeBackToCharacter: next })} label={settings.writeBackToCharacter ? '写入日常' : '仅本地'} />
        </div>
      )}

      {activeWindow && (
        <XunjiWindow title={WINDOW_META[activeWindow].label} sub={WINDOW_META[activeWindow].sub} icon={WINDOW_META[activeWindow].icon} onClose={() => setActiveWindow(null)}>
          <WindowContent
            id={activeWindow}
            char={activeChar}
            characters={characters}
            settings={settings}
            snapshot={activeSnapshot}
            reports={activeReports}
            runs={activeRuns}
            snapshots={snapshots}
            rangePreset={rangePreset}
            setRangePreset={setRangePreset}
            customStart={customStart}
            customEnd={customEnd}
            setCustomStart={setCustomStart}
            setCustomEnd={setCustomEnd}
            density={density}
            setDensity={next => { setDensity(next); persistSettings({ defaultDensity: next }); }}
            loading={loading}
            syncing={syncing}
            routeExpanded={routeExpanded}
            setRouteExpanded={setRouteExpanded}
            onRun={runScreenlife}
            onRefresh={refreshSnapshot}
            onPatch={persistSettings}
            onClear={clearData}
            onGenerateReports={generateReportsNow}
            onMarkAllRead={markAllRead}
            onMarkReport={markReport}
            onWriteReportBack={writeSingleReportBack}
            onWriteReportsBack={writeReportsBack}
            onDeleteRun={deleteRun}
            onOpenChat={openWhisperChat}
            onWriteLatestBack={writeLatestTraceBack}
          />
        </XunjiWindow>
      )}
    </div>
  );
};

const Header: React.FC<{ closeApp: () => void }> = ({ closeApp }) => (
  <header className="shrink-0 h-[52px] bg-white/95 backdrop-blur border-b border-slate-200 px-3 flex items-center gap-2 z-10">
    <button onClick={closeApp} className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center active:scale-95"><CaretLeft size={18} weight="bold" /></button>
      <div className="w-9 h-9 rounded-[8px] bg-cyan-950 text-white flex items-center justify-center"><Compass size={20} weight="fill" /></div>
      <div className="min-w-0">
        <div className="font-black leading-tight">循迹</div>
        <div className="text-[10px] text-slate-500 font-bold">屏幕记录 · 实时数据 · 事件提醒</div>
      </div>
  </header>
);

const RoleCard: React.FC<{
  char: CharacterProfile;
  characters: CharacterProfile[];
  settings: XunjiSettings;
  snapshot: XunjiMonitorSnapshot | null;
  syncing: boolean;
  onSelect: (id: string) => void;
}> = ({ char, characters, settings, snapshot, syncing, onSelect }) => (
  <section className="rounded-[8px] bg-white border border-slate-200 p-3 shadow-sm overflow-hidden">
    <div className="flex items-start gap-3">
      <Avatar char={char} size={52} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="font-black text-[17px] leading-tight truncate">{char.name}</h2>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${syncing ? 'bg-cyan-950 text-white' : snapshot?.isCharging ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
            {syncing ? '同步中' : snapshot?.isCharging ? '充电中' : '在线'}
          </span>
        </div>
        <div className="mt-1 text-[11px] text-slate-500 font-bold truncate">{snapshot?.phoneModel || '正在识别手机型号'} · {cityLabel(char)}</div>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          <TinyMetric label="更新" value={snapshot ? fmtDateTime(snapshot.generatedAt) : '刚刚'} />
          <TinyMetric label="电量" value={snapshot ? `${snapshot.batteryLevel}%` : '--'} />
          <TinyMetric label="距离" value={snapshot ? `${snapshot.distanceKm}km` : '--'} />
        </div>
      </div>
      <select value={settings.activeCharId || char.id} onChange={e => onSelect(e.target.value)} className="max-w-[98px] rounded-[8px] border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] font-bold outline-none">
        {characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </div>
  </section>
);

const TinyMetric: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="min-w-0 rounded-[8px] bg-slate-50 px-2 py-1.5">
    <div className="text-[9px] text-slate-400 font-black">{label}</div>
    <div className="truncate text-[11px] text-slate-800 font-black">{value}</div>
  </div>
);

const WorkbenchHome: React.FC<{
  snapshot: XunjiMonitorSnapshot | null;
  snapshots: XunjiMonitorSnapshot[];
  reports: XunjiReportItem[];
  runs: XunjiScreenlifeRun[];
  settings: XunjiSettings;
  syncing: boolean;
  loading: boolean;
  onOpen: (id: XunjiWindowId) => void;
  onRefresh: () => void;
  onRun: () => void;
  onOpenChat: () => void;
  onWriteBack: () => void;
  onToggleChatContext: (next: boolean) => void;
}> = ({ snapshot, snapshots, reports, runs, settings, syncing, loading, onOpen, onRefresh, onRun, onOpenChat, onWriteBack, onToggleChatContext }) => {
  const [section, setSection] = useState<XunjiHomeSection>('overview');
  const latestRun = runs[0];
  const social = latestRun?.socialInference;
  const latestMoment = latestRun?.moments?.[0];
  const unread = reports.filter(r => !r.acknowledged).length;
  const monitorTiles: XunjiWindowId[] = ['phone', 'network', 'device', 'location', 'health', 'calls', 'battery'];
  const sections: { id: XunjiHomeSection; label: string; sub: string }[] = [
    { id: 'overview', label: '总览', sub: '当前状态' },
    { id: 'generate', label: '生成', sub: '记录与线索' },
    { id: 'monitor', label: '监测', sub: '设备数据' },
    { id: 'link', label: '联动', sub: '絮语与设置' },
  ];

  return (
    <div className="space-y-3">
      <section className="rounded-[8px] bg-white border border-slate-200 p-2 shadow-sm">
        <div className="grid grid-cols-4 gap-1.5">
          {sections.map(item => (
            <button
              key={item.id}
              onClick={() => setSection(item.id)}
              className={`min-w-0 rounded-[8px] px-2 py-2 text-left transition active:scale-[0.99] ${section === item.id ? 'bg-cyan-950 text-white shadow-sm' : 'bg-slate-50 text-slate-600'}`}
            >
              <div className="truncate text-[12px] font-black">{item.label}</div>
              <div className={`mt-0.5 truncate text-[9px] font-bold ${section === item.id ? 'text-white/70' : 'text-slate-400'}`}>{item.sub}</div>
            </button>
          ))}
        </div>
      </section>

      {section === 'overview' && (
        <div className="space-y-3">
          <section className="rounded-[8px] bg-white border border-slate-200 p-3 shadow-sm space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <Stat label="关系分" value={social ? `${social.screenlifeScore}` : '--'} sub={social?.mood || '未生成'} />
              <Stat label="动态" value={latestRun?.moments?.length || 0} sub={latestMoment?.title || '无记录'} />
              <Stat label="提醒" value={unread} sub={`${reports.length} 条总计`} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => onOpen('report')} className="h-10 rounded-[8px] bg-emerald-600 text-white text-[12px] font-black">报备</button>
              <button onClick={() => setSection('generate')} className="h-10 rounded-[8px] bg-cyan-950 text-white text-[12px] font-black">生成记录</button>
            </div>
          </section>
          <section className="rounded-[8px] bg-white border border-slate-200 p-3 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[12px] font-black text-slate-500">最近记录</div>
                <div className="mt-1 text-[15px] font-black text-slate-950 truncate">{latestRun?.title || '还没有屏幕记录'}</div>
                <div className="mt-1 text-[11px] text-slate-500 font-bold truncate">{latestRun ? `${fmtDateTime(latestRun.rangeStart)} - ${fmtDateTime(latestRun.rangeEnd)}` : '先生成一次，后续会按时间更新'}</div>
              </div>
              <button onClick={() => onOpen('screenlife')} className="shrink-0 h-9 rounded-[8px] bg-white border border-slate-200 px-3 text-[12px] font-black">打开</button>
            </div>
          </section>
          <div className="grid grid-cols-2 gap-2">
            <CompactTile id="social" onOpen={onOpen} metric={social ? `${social.screenlifeScore}/100` : '--'} />
            <CompactTile id="timeline" onOpen={onOpen} metric={`${runs.length + snapshots.length + reports.length} 条`} />
            <CompactTile id="report" onOpen={onOpen} metric={unread ? `${unread} 未读` : `${reports.length}`} />
          </div>
        </div>
      )}

      {section === 'generate' && (
        <div className="space-y-3">
          <section className="rounded-[8px] bg-white border border-slate-200 p-3 shadow-sm space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <button onClick={onRun} disabled={loading} className="h-11 rounded-[8px] bg-cyan-950 text-white text-[12px] font-black flex items-center justify-center gap-2 active:scale-[0.99] disabled:opacity-60">
                {loading ? <ArrowsClockwise size={15} weight="bold" className="animate-spin" /> : <Play size={15} weight="fill" />}生成屏幕记录
              </button>
              <button onClick={onRefresh} disabled={syncing} className="h-11 rounded-[8px] bg-white border border-slate-200 text-slate-800 text-[12px] font-black flex items-center justify-center gap-2 active:scale-[0.99] disabled:opacity-60">
                <ArrowsClockwise size={15} weight="bold" className={syncing ? 'animate-spin' : ''} />刷新实时数据
              </button>
            </div>
            <div className="rounded-[8px] bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600 font-bold">
              {settings.autoTraceEnabled === false ? '自动更新已暂停。' : latestRun ? '已生成过首条记录，后续会按时间自动续写。' : '第一次需要手动生成，后续会按时间自动更新。'}
            </div>
          </section>
          <div className="grid grid-cols-2 gap-2">
            <WindowTile id="screenlife" onOpen={onOpen} />
            <WindowTile id="social" onOpen={onOpen} badge={social ? `${social.screenlifeScore}/100` : undefined} />
            <WindowTile id="moments" onOpen={onOpen} badge={`${latestRun?.moments?.length || 0}`} />
            <WindowTile id="timeline" onOpen={onOpen} badge={`${runs.length + reports.length}`} />
            <WindowTile id="report" onOpen={onOpen} badge={unread ? `${unread} 未读` : undefined} />
          </div>
        </div>
      )}

      {section === 'monitor' && (
        <div className="space-y-3">
          <section className="rounded-[8px] bg-white border border-slate-200 p-3 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[12px] font-black text-slate-500">实时数据</div>
                <div className="mt-1 text-[15px] font-black text-slate-950">{snapshot ? fmtDateTime(snapshot.generatedAt) : '未生成'}</div>
              </div>
              <button onClick={onRefresh} disabled={syncing} className="shrink-0 h-10 rounded-[8px] bg-cyan-950 px-3 text-white text-[12px] font-black disabled:opacity-60">
                {syncing ? '刷新中' : '刷新'}
              </button>
            </div>
          </section>
          <div className="grid grid-cols-2 gap-2">
            <WindowTile id="monitor" onOpen={onOpen} disabled={!snapshot} />
            {monitorTiles.map(id => <WindowTile key={id} id={id} onOpen={onOpen} disabled={!snapshot} />)}
          </div>
        </div>
      )}

      {section === 'link' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <WindowTile id="settings" onOpen={onOpen} badge={settings.chatContextEnabled === false ? '关闭' : '开启'} />
            <WindowTile id="report" onOpen={onOpen} badge={unread ? `${unread} 未读` : undefined} />
          </div>
          <section className="rounded-[8px] bg-white border border-slate-200 p-3 shadow-sm space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-black text-[13px]">絮语联动</div>
              <div className="mt-1 text-[11px] text-slate-500 leading-relaxed">
                {settings.chatContextEnabled === false ? '循迹内容不会加入聊天上下文。' : '屏幕记录、实时数据和提醒会加入聊天上下文。'}
              </div>
            </div>
            <Toggle on={settings.chatContextEnabled !== false} onChange={onToggleChatContext} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={onOpenChat} className="h-10 rounded-[8px] bg-emerald-700 text-white text-[12px] font-black">打开絮语</button>
            <button onClick={onWriteBack} className="h-10 rounded-[8px] bg-slate-100 text-slate-800 text-[12px] font-black">收进记忆</button>
          </div>
          </section>
        </div>
      )}
    </div>
  );
};

const WindowTile: React.FC<{ id: XunjiWindowId; onOpen: (id: XunjiWindowId) => void; badge?: string; disabled?: boolean }> = ({ id, onOpen, badge, disabled }) => {
  const meta = WINDOW_META[id];
  return (
    <button
      disabled={disabled}
      onClick={() => onOpen(id)}
      className={`min-h-[96px] rounded-[8px] border border-slate-200 bg-gradient-to-br ${meta.tone} p-3 text-left shadow-sm active:scale-[0.99] disabled:opacity-50`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="w-9 h-9 rounded-[8px] bg-white border border-slate-200 text-cyan-900 flex items-center justify-center shadow-sm">{meta.icon}</span>
        {badge && <span className="rounded-full bg-cyan-950 text-white px-2 py-0.5 text-[10px] font-black">{badge}</span>}
      </div>
      <div className="mt-2 font-black text-[14px] text-slate-950">{meta.label}</div>
      <div className="mt-1 text-[11px] leading-snug text-slate-500 font-bold">{meta.sub}</div>
    </button>
  );
};

const CompactTile: React.FC<{ id: XunjiWindowId; onOpen: (id: XunjiWindowId) => void; metric?: string; disabled?: boolean }> = ({ id, onOpen, metric, disabled }) => {
  const meta = WINDOW_META[id];
  return (
    <button
      disabled={disabled}
      onClick={() => onOpen(id)}
      className="min-w-0 rounded-[8px] bg-white border border-slate-200 p-3 text-left shadow-sm active:scale-[0.99] disabled:opacity-50"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="w-9 h-9 rounded-[8px] bg-slate-50 border border-slate-200 text-cyan-900 flex items-center justify-center">{meta.icon}</span>
        {metric && <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-700 font-black">{metric}</span>}
      </div>
      <div className="mt-2 text-[13px] font-black text-slate-950">{meta.label}</div>
      <div className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-slate-500 font-bold">{meta.sub}</div>
    </button>
  );
};

const XunjiWindow: React.FC<{ title: string; sub: string; icon: React.ReactNode; onClose: () => void; children: React.ReactNode }> = ({ title, sub, icon, onClose, children }) => (
  <div className="absolute inset-0 z-40 bg-slate-950/35 backdrop-blur-sm p-3 pt-[62px] flex items-start">
    <section className="w-full max-h-full rounded-[8px] bg-[#eef3f4] border border-white/70 shadow-2xl overflow-hidden flex flex-col">
      <header className="h-[58px] shrink-0 bg-white border-b border-slate-200 px-3 flex items-center gap-2">
        <span className="w-9 h-9 rounded-[8px] bg-cyan-950 text-white flex items-center justify-center">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="font-black text-[15px] truncate">{title}</div>
          <div className="text-[10px] text-slate-500 font-bold truncate">{sub}</div>
        </div>
        <button onClick={onClose} className="w-9 h-9 rounded-full bg-slate-100 text-slate-600 font-black active:scale-95">×</button>
      </header>
      <div className="min-h-0 overflow-y-auto p-3">
        {children}
      </div>
    </section>
  </div>
);

const WindowContent: React.FC<{
  id: XunjiWindowId;
  char: CharacterProfile;
  characters: CharacterProfile[];
  settings: XunjiSettings;
  snapshot: XunjiMonitorSnapshot | null;
  snapshots: XunjiMonitorSnapshot[];
  reports: XunjiReportItem[];
  runs: XunjiScreenlifeRun[];
  rangePreset: RangePreset;
  setRangePreset: (p: RangePreset) => void;
  customStart: string;
  customEnd: string;
  setCustomStart: (v: string) => void;
  setCustomEnd: (v: string) => void;
  density: XunjiDensity;
  setDensity: (d: XunjiDensity) => void;
  loading: boolean;
  syncing: boolean;
  routeExpanded: boolean;
  setRouteExpanded: (v: boolean) => void;
  onRun: () => void;
  onRefresh: () => void;
  onPatch: (patch: Partial<XunjiSettings>) => void;
  onClear: () => void;
  onGenerateReports: () => void;
  onMarkAllRead: () => void;
  onMarkReport: (id: string, patch: Partial<XunjiReportItem>) => void;
  onWriteReportBack: (id: string) => void;
  onWriteReportsBack: () => void;
  onDeleteRun: (id: string) => void;
  onOpenChat: () => void;
  onWriteLatestBack: () => void;
}> = (props) => {
  const { id, snapshot } = props;
  const appRanks = snapshot ? buildAppRanks(snapshot) : [];
  if (id === 'screenlife') return (
    <ScreenlifeTab
      runs={props.runs}
      rangePreset={props.rangePreset}
      setRangePreset={props.setRangePreset}
      customStart={props.customStart}
      customEnd={props.customEnd}
      setCustomStart={props.setCustomStart}
      setCustomEnd={props.setCustomEnd}
      density={props.density}
      setDensity={props.setDensity}
      loading={props.loading}
      onRun={props.onRun}
      onDeleteRun={props.onDeleteRun}
    />
  );
  if (id === 'social') return <SocialInferencePanel run={props.runs[0]} onOpenChat={props.onOpenChat} onWriteBack={props.onWriteLatestBack} />;
  if (id === 'moments') return <MomentsPanel moments={props.runs[0]?.moments || []} run={props.runs[0]} onRun={props.onRun} loading={props.loading} />;
  if (id === 'timeline') return <TimelinePanel runs={props.runs} snapshots={props.snapshots} reports={props.reports} onOpenChat={props.onOpenChat} onWriteBack={props.onWriteLatestBack} />;
  if (id === 'monitor') return snapshot ? <MonitorTab snapshot={snapshot} snapshots={props.snapshots} syncing={props.syncing} routeExpanded={props.routeExpanded} setRouteExpanded={props.setRouteExpanded} onRefresh={props.onRefresh} /> : <EmptyState text="还没有实时数据。" />;
  if (!snapshot && ['phone', 'network', 'device', 'location', 'health', 'calls', 'battery'].includes(id)) return <EmptyState text="还没有实时数据，请先刷新。" />;
  if (id === 'phone' && snapshot) return <PhoneUsagePanel snapshot={snapshot} appRanks={appRanks} />;
  if (id === 'network' && snapshot) return <NetworkPanel snapshot={snapshot} />;
  if (id === 'device' && snapshot) return <DevicePanel snapshot={snapshot} />;
  if (id === 'location' && snapshot) return <LocationPanel snapshot={snapshot} routeExpanded={props.routeExpanded} setRouteExpanded={props.setRouteExpanded} />;
  if (id === 'health' && snapshot) return <HealthPanel snapshot={snapshot} />;
  if (id === 'calls' && snapshot) return <CallsPanel snapshot={snapshot} />;
  if (id === 'battery' && snapshot) return <BatteryPanel snapshot={snapshot} />;
  if (id === 'report') return (
    <ReportTab
      char={props.char}
      reports={props.reports}
      rules={props.settings.reportRules}
      onToggleRule={(type, on) => props.onPatch({ reportRules: { ...props.settings.reportRules, [type]: on } })}
      onGenerate={props.onGenerateReports}
      onMarkAllRead={props.onMarkAllRead}
      onMarkReport={props.onMarkReport}
      onWriteReportBack={props.onWriteReportBack}
      onWriteBack={props.onWriteReportsBack}
    />
  );
  return (
    <div className="space-y-3">
      <XunjiLinkPanel settings={props.settings} onPatch={props.onPatch} onOpenChat={props.onOpenChat} onWriteBack={props.onWriteLatestBack} />
      <SettingsTab char={props.char} characters={props.characters} settings={props.settings} onPatch={props.onPatch} onClear={props.onClear} />
    </div>
  );
};

const XunjiLinkPanel: React.FC<{
  settings: XunjiSettings;
  onPatch: (patch: Partial<XunjiSettings>) => void;
  onOpenChat: () => void;
  onWriteBack: () => void;
}> = ({ settings, onPatch, onOpenChat, onWriteBack }) => (
  <section className="rounded-[8px] bg-white border border-slate-200 p-3 shadow-sm space-y-3">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="font-black text-[13px]">加入絮语上下文</div>
        <div className="mt-1 text-[11px] text-slate-500 leading-relaxed">
          最近的屏幕记录、实时数据和事件提醒会进入聊天上下文。
        </div>
      </div>
      <Toggle on={settings.chatContextEnabled !== false} onChange={next => onPatch({ chatContextEnabled: next })} />
    </div>
    <div className="flex items-start justify-between gap-3 rounded-[8px] bg-slate-50 p-3">
      <div className="min-w-0">
        <div className="font-black text-[13px]">自动更新记录</div>
        <div className="mt-1 text-[11px] text-slate-500 leading-relaxed">
          首次生成后，后续按时间自动补充新记录。
        </div>
      </div>
      <Toggle on={settings.autoTraceEnabled !== false} onChange={next => onPatch({ autoTraceEnabled: next })} />
    </div>
    <div className="grid grid-cols-2 gap-2">
      <button onClick={onOpenChat} className="h-10 rounded-[8px] bg-emerald-700 text-white text-[12px] font-black">打开絮语</button>
      <button onClick={onWriteBack} className="h-10 rounded-[8px] bg-cyan-950 text-white text-[12px] font-black">收进记忆</button>
    </div>
  </section>
);

const SocialInferencePanel: React.FC<{ run?: XunjiScreenlifeRun; onOpenChat: () => void; onWriteBack: () => void }> = ({ run, onOpenChat, onWriteBack }) => {
  const social = run?.socialInference;
  if (!run || !social) return <EmptyState text="还没有关系线索，请先生成屏幕记录。" />;
  return (
    <div className="space-y-3">
      <section className="rounded-[8px] bg-white border border-slate-200 p-3 shadow-sm space-y-3">
        <div className="grid grid-cols-[92px_1fr] gap-3 items-center">
          <div className="relative h-[92px] rounded-full bg-cyan-950 text-white flex items-center justify-center">
            <div className="text-center">
              <div className="text-[28px] font-black leading-none">{social.screenlifeScore}</div>
              <div className="text-[10px] font-black opacity-80">温度</div>
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-black text-rose-600">SOCIAL TRACE</div>
            <div className="mt-1 text-[16px] font-black text-slate-950">{social.mood}</div>
            <p className="mt-1 text-[12px] leading-relaxed text-slate-600">{social.relationshipPulse}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={onOpenChat} className="h-10 rounded-[8px] bg-emerald-700 text-white text-[12px] font-black">带去絮语聊</button>
            <button onClick={onWriteBack} className="h-10 rounded-[8px] bg-slate-100 text-slate-800 text-[12px] font-black">收进记忆</button>
        </div>
      </section>
      <TraceList title="亲近信号" rows={social.intimacySignals} tone="cyan" />
      <TraceList title="摩擦 / 迟疑" rows={social.frictionSignals} tone="rose" />
      <TraceList title="TA 可能需要" rows={social.likelyNeeds} tone="emerald" />
      <TraceList title="可以轻轻接起的话" rows={social.nextConversationSeeds} tone="amber" />
      <TraceList title="可接话题" rows={social.whisperHooks} tone="violet" />
    </div>
  );
};

const TraceList: React.FC<{ title: string; rows: string[]; tone: 'cyan' | 'rose' | 'emerald' | 'amber' | 'violet' }> = ({ title, rows, tone }) => {
  const colors: Record<typeof tone, string> = {
    cyan: 'bg-cyan-50 border-cyan-100 text-cyan-900',
    rose: 'bg-rose-50 border-rose-100 text-rose-900',
    emerald: 'bg-emerald-50 border-emerald-100 text-emerald-900',
    amber: 'bg-amber-50 border-amber-100 text-amber-900',
    violet: 'bg-violet-50 border-violet-100 text-violet-900',
  };
  return (
    <section className="rounded-[8px] bg-white border border-slate-200 p-3 shadow-sm">
      <div className="text-[12px] font-black mb-2">{title}</div>
      <div className="space-y-2">
        {(rows.length ? rows : ['暂无']).map((row, i) => (
          <div key={`${title}_${i}`} className={`rounded-[8px] border px-3 py-2 text-[12px] leading-relaxed font-bold ${colors[tone]}`}>{row}</div>
        ))}
      </div>
    </section>
  );
};

const MomentsPanel: React.FC<{ moments: XunjiGeneratedMoment[]; run?: XunjiScreenlifeRun; onRun: () => void; loading: boolean }> = ({ moments, run, onRun, loading }) => (
  <div className="space-y-3">
    <section className="rounded-[8px] bg-white border border-slate-200 p-3 shadow-sm space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-black text-amber-700">SYSTEM FLOATS</div>
          <div className="mt-1 text-[15px] font-black">{run?.title || '还没有动态'}</div>
        </div>
        <button onClick={onRun} disabled={loading} className="h-9 rounded-[8px] bg-cyan-950 text-white px-3 text-[12px] font-black flex items-center gap-1.5 disabled:opacity-60">
          {loading ? <ArrowsClockwise size={14} className="animate-spin" /> : <Sparkle size={14} weight="fill" />}生成
        </button>
      </div>
      <p className="text-[12px] leading-relaxed text-slate-600">{run?.narrative || '生成后，这里会显示短事件和提醒卡。'}</p>
    </section>
    {moments.length === 0 ? <EmptyState text="暂无浮窗动态。" /> : moments.map(moment => <MomentCard key={moment.id} moment={moment} />)}
  </div>
);

const MomentCard: React.FC<{ moment: XunjiGeneratedMoment }> = ({ moment }) => {
  const toneClass: Record<XunjiGeneratedMoment['tone'], string> = {
    soft: 'bg-cyan-50 border-cyan-100 text-cyan-900',
    busy: 'bg-slate-50 border-slate-200 text-slate-800',
    private: 'bg-violet-50 border-violet-100 text-violet-900',
    social: 'bg-emerald-50 border-emerald-100 text-emerald-900',
    alert: 'bg-amber-50 border-amber-100 text-amber-900',
  };
  return (
    <section className={`rounded-[8px] border p-3 shadow-sm ${toneClass[moment.tone]}`}>
      <div className="flex items-start gap-2">
        <div className="w-9 h-9 rounded-[8px] bg-white/80 flex items-center justify-center shrink-0"><Bell size={16} weight="fill" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="font-black text-[13px] truncate">{moment.title}</div>
            {moment.relatedApp && <span className="shrink-0 rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-black">{moment.relatedApp}</span>}
          </div>
          <div className="text-[10px] font-bold opacity-70">{xunjiFormatClock(moment.time)}</div>
          <p className="mt-1 text-[12px] leading-relaxed">{moment.body}</p>
        </div>
      </div>
    </section>
  );
};

const TIMELINE_FILTERS: { id: XunjiTimelineFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'screenlife', label: '屏幕' },
  { id: 'report', label: '报备' },
  { id: 'location', label: '位置' },
  { id: 'phone', label: 'App' },
  { id: 'health', label: '健康' },
];

const timelineKindLabel: Record<XunjiTimelineKind, string> = {
  screenlife: '屏幕',
  report: '报备',
  phone: 'App',
  location: '位置',
  network: '网络',
  call: '通话',
  battery: '电量',
  health: '健康',
};

const timelineAccent: Record<XunjiTimelineKind, string> = {
  screenlife: 'bg-cyan-950 text-white',
  report: 'bg-orange-100 text-orange-700',
  phone: 'bg-cyan-100 text-cyan-800',
  location: 'bg-lime-100 text-lime-700',
  network: 'bg-emerald-100 text-emerald-700',
  call: 'bg-violet-100 text-violet-700',
  battery: 'bg-amber-100 text-amber-700',
  health: 'bg-rose-100 text-rose-700',
};

function buildTimelineItems(runs: XunjiScreenlifeRun[], snapshots: XunjiMonitorSnapshot[], reports: XunjiReportItem[]): XunjiTimelineItem[] {
  const items: XunjiTimelineItem[] = [];
  const push = (item: Omit<XunjiTimelineItem, 'accent'>) => items.push({ ...item, accent: timelineAccent[item.kind] });

  runs.forEach(run => {
    push({
      id: `run-${run.id}`,
      at: run.createdAt,
      kind: 'screenlife',
      title: run.title,
      body: run.narrative,
      source: `${DENSITY_LABEL[run.density]} · ${run.writeBack ? '已写入日常' : '本地保存'}`,
    });
    run.chats.slice(0, 3).forEach(chat => push({
      id: `run-${run.id}-chat-${chat.id}`,
      at: chat.time,
      kind: 'screenlife',
      title: `和 ${chat.target} 的聊天痕迹`,
      body: chat.summary || chat.messages.join(' / '),
      source: '聊天',
    }));
    run.browsed.slice(0, 3).forEach(item => push({
      id: `run-${run.id}-browse-${item.id}`,
      at: item.time,
      kind: 'phone',
      title: `${item.appName} · ${item.title}`,
      body: item.summary,
      source: '浏览',
    }));
    run.notes.slice(0, 3).forEach(note => push({
      id: `run-${run.id}-note-${note.id}`,
      at: note.time,
      kind: 'screenlife',
      title: '随手记',
      body: note.text,
      source: '备忘录',
    }));
    (run.moments || []).slice(0, 4).forEach(moment => push({
      id: `run-${run.id}-moment-${moment.id}`,
      at: moment.time,
      kind: moment.tone === 'alert' ? 'report' : 'screenlife',
      title: moment.title,
      body: moment.body,
      source: moment.relatedApp || '浮窗动态',
    }));
  });

  snapshots.forEach(snap => {
    push({
      id: `snap-${snap.id}`,
      at: snap.generatedAt,
      kind: 'health',
      title: '实时概览快照',
      body: `${snap.phoneModel}，电量 ${snap.batteryLevel}%，解锁 ${snap.unlockCount} 次，屏幕 ${fmtMinutes(snap.screenTimeMinutes)}。`,
      source: snap.isCharging ? '充电中' : '使用中',
    });
    snap.appUsage.slice(0, 5).forEach(app => push({
      id: `snap-${snap.id}-app-${app.id}`,
      at: app.startedAt,
      kind: 'phone',
      title: app.appName,
      body: app.note || `使用 ${xunjiDurationMinutes(app)} 分钟`,
      source: app.category || 'App 使用',
    }));
    snap.locations.slice(0, 5).forEach(loc => push({
      id: `snap-${snap.id}-loc-${loc.id}`,
      at: loc.arrivedAt,
      kind: 'location',
      title: loc.label,
      body: `${loc.address} · 停留 ${loc.stayMinutes || 0} 分钟`,
      source: xunjiLocationTransportLabel(loc),
    }));
    snap.networks.slice(0, 4).forEach(net => push({
      id: `snap-${snap.id}-net-${net.id}`,
      at: net.timestamp,
      kind: 'network',
      title: net.type === 'wifi' ? '切到 WiFi' : '切到移动数据',
      body: net.name,
      source: '网络',
    }));
    snap.calls.slice(0, 3).forEach(call => push({
      id: `snap-${snap.id}-call-${call.id}`,
      at: call.startedAt,
      kind: 'call',
      title: `通话 · ${call.target}`,
      body: `通话 ${call.durationMinutes} 分钟 · ${call.status}`,
      source: '电话',
    }));
    snap.batteryEvents.slice(0, 3).forEach(event => push({
      id: `snap-${snap.id}-bat-${event.id}`,
      at: event.timestamp,
      kind: 'battery',
      title: xunjiBatteryEventLabel(event),
      body: `电量 ${event.level}%`,
      source: '电池',
    }));
  });

  reports.forEach(report => push({
    id: `report-${report.id}`,
    at: report.timestamp,
    kind: 'report',
    title: report.title,
    body: report.body,
    source: `${XUNJI_REPORT_LABELS[report.type]}${report.writtenBack ? ' · 已写入' : ''}`,
  }));

  const unique = new Map<string, XunjiTimelineItem>();
  items.forEach(item => unique.set(item.id, item));
  return Array.from(unique.values()).sort((a, b) => b.at - a.at).slice(0, 180);
}

const TimelinePanel: React.FC<{
  runs: XunjiScreenlifeRun[];
  snapshots: XunjiMonitorSnapshot[];
  reports: XunjiReportItem[];
  onOpenChat: () => void;
  onWriteBack: () => void;
}> = ({ runs, snapshots, reports, onOpenChat, onWriteBack }) => {
  const [filter, setFilter] = useState<XunjiTimelineFilter>('all');
  const [query, setQuery] = useState('');
  const items = useMemo(() => buildTimelineItems(runs, snapshots, reports), [runs, snapshots, reports]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(item => {
      if (filter !== 'all' && item.kind !== filter) return false;
      if (!q) return true;
      return `${item.title}\n${item.body}\n${item.source}`.toLowerCase().includes(q);
    });
  }, [filter, items, query]);

  return (
    <div className="space-y-3">
      <section className="rounded-[8px] bg-white border border-slate-200 p-3 shadow-sm space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <Stat label="时间点" value={items.length} />
          <Stat label="屏幕记录" value={runs.length} />
          <Stat label="快照" value={snapshots.length} />
        </div>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="搜索时间线"
          className="w-full rounded-[8px] border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] font-bold outline-none focus:border-cyan-800"
        />
        <div className="flex gap-2 overflow-x-auto pb-1">
          {TIMELINE_FILTERS.map(item => <PillButton key={item.id} active={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</PillButton>)}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={onOpenChat} className="h-10 rounded-[8px] bg-emerald-700 text-white text-[12px] font-black">带去絮语聊</button>
          <button onClick={onWriteBack} className="h-10 rounded-[8px] bg-slate-100 text-slate-800 text-[12px] font-black">收进记忆</button>
        </div>
      </section>

      {visible.length === 0 ? <EmptyState text="这条时间线暂时没有内容。" /> : (
        <section className="rounded-[8px] bg-white border border-slate-200 p-3 shadow-sm">
          <div className="space-y-3">
            {visible.map(item => (
              <div key={item.id} className="grid grid-cols-[58px_1fr] gap-2">
                <div className="pt-1 text-right">
                  <div className="text-[11px] font-black text-slate-700">{xunjiFormatClock(item.at)}</div>
                  <div className="mt-0.5 text-[9px] font-bold text-slate-400">{fmtReportStamp(item.at).slice(0, 5)}</div>
                </div>
                <div className="relative border-l border-slate-200 pl-3 pb-3">
                  <span className={`absolute -left-[9px] top-1 w-4 h-4 rounded-full border-2 border-white ${item.accent}`} />
                  <div className="rounded-[8px] bg-slate-50 border border-slate-100 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-black text-[13px] text-slate-950 leading-snug">{item.title}</div>
                        <div className="mt-0.5 text-[10px] text-slate-500 font-bold">{item.source}</div>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black ${item.accent}`}>{timelineKindLabel[item.kind]}</span>
                    </div>
                    <p className="mt-2 text-[12px] leading-relaxed text-slate-700 whitespace-pre-wrap">{item.body}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

const ScreenlifeTab: React.FC<{
  runs: XunjiScreenlifeRun[];
  rangePreset: RangePreset;
  setRangePreset: (p: RangePreset) => void;
  customStart: string;
  customEnd: string;
  setCustomStart: (v: string) => void;
  setCustomEnd: (v: string) => void;
  density: XunjiDensity;
  setDensity: (d: XunjiDensity) => void;
  loading: boolean;
  onRun: () => void;
  onDeleteRun: (id: string) => void;
}> = ({ runs, rangePreset, setRangePreset, customStart, customEnd, setCustomStart, setCustomEnd, density, setDensity, loading, onRun, onDeleteRun }) => {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'all' | 'written' | 'local'>('all');
  const [openRunId, setOpenRunId] = useState<string | null>(runs[0]?.id || null);
  useEffect(() => {
    setOpenRunId(prev => prev && runs.some(run => run.id === prev) ? prev : runs[0]?.id || null);
  }, [runs]);
  const filteredRuns = useMemo(() => {
    const q = query.trim().toLowerCase();
    return runs.filter(run => {
      if (mode === 'written' && !run.writeBack) return false;
      if (mode === 'local' && run.writeBack) return false;
      if (!q) return true;
      const haystack = [
        run.title,
        run.narrative,
        ...run.chats.map(c => `${c.target} ${c.summary} ${c.messages.join(' ')}`),
        ...run.browsed.map(b => `${b.appName} ${b.title} ${b.summary}`),
        ...run.notes.map(n => n.text),
        ...(run.moments || []).map(m => `${m.title} ${m.body} ${m.relatedApp || ''}`),
      ].join('\n').toLowerCase();
      return haystack.includes(q);
    });
  }, [mode, query, runs]);

  return (
    <div className="space-y-3">
      <section className="rounded-[8px] bg-white border border-slate-200 p-3 shadow-sm space-y-3">
        <div>
          <div className="text-[12px] font-black mb-2">时间范围</div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {[
              ['today', '今天'],
              ['yesterday', '昨天'],
              ['last2h', '近 2 小时'],
              ['custom', '自定义'],
            ].map(([id, label]) => <PillButton key={id} active={rangePreset === id} onClick={() => setRangePreset(id as RangePreset)}>{label}</PillButton>)}
          </div>
          {rangePreset === 'custom' && (
            <div className="grid grid-cols-2 gap-2 mt-2">
              <input value={customStart} onChange={e => setCustomStart(e.target.value)} type="datetime-local" className="min-w-0 rounded-[8px] border border-slate-200 px-2 py-2 text-[11px] font-bold" />
              <input value={customEnd} onChange={e => setCustomEnd(e.target.value)} type="datetime-local" className="min-w-0 rounded-[8px] border border-slate-200 px-2 py-2 text-[11px] font-bold" />
            </div>
          )}
        </div>
        <div>
          <div className="text-[12px] font-black mb-2">记录密度</div>
          <div className="grid grid-cols-3 gap-2">
            {(['light', 'standard', 'detailed'] as XunjiDensity[]).map(d => <PillButton key={d} active={density === d} onClick={() => setDensity(d)}>{DENSITY_LABEL[d]}</PillButton>)}
          </div>
        </div>
        <button onClick={onRun} disabled={loading} className="w-full h-12 rounded-[8px] bg-cyan-950 text-white font-black flex items-center justify-center gap-2 active:scale-[0.99] disabled:opacity-60">
          {loading ? <ArrowsClockwise size={17} weight="bold" className="animate-spin" /> : <Play size={17} weight="fill" />}
          {loading ? '正在生成屏幕记录...' : '生成屏幕记录'}
        </button>
      </section>

      <section className="rounded-[8px] bg-white border border-slate-200 p-3 shadow-sm space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <Stat label="记录数" value={runs.length} />
          <Stat label="已写入" value={runs.filter(run => run.writeBack).length} />
          <Stat label="最新" value={<span className="text-[13px]">{runs[0] ? fmtDateTime(runs[0].createdAt) : '--'}</span>} />
        </div>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="搜索标题、App、聊天摘要或随手记"
          className="w-full rounded-[8px] border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] font-bold outline-none focus:border-cyan-800"
        />
        <div className="grid grid-cols-3 gap-2">
          <PillButton active={mode === 'all'} onClick={() => setMode('all')}>全部</PillButton>
          <PillButton active={mode === 'written'} onClick={() => setMode('written')}>已写入</PillButton>
          <PillButton active={mode === 'local'} onClick={() => setMode('local')}>仅本地</PillButton>
        </div>
      </section>

      {runs.length === 0 ? <EmptyState text="还没有屏幕记录。" /> : filteredRuns.length === 0 ? <EmptyState text="没有符合筛选的屏幕记录。" /> : filteredRuns.map(run => {
        const open = openRunId === run.id;
        return (
          <section key={run.id} className="rounded-[8px] bg-white border border-slate-200 p-3 shadow-sm space-y-3">
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="font-black text-[15px] leading-snug">{run.title}</div>
                <div className="text-[10px] text-slate-500 font-bold">{fmtDateTime(run.createdAt)} · {DENSITY_LABEL[run.density]} · {fmtDateTime(run.rangeStart)} - {fmtDateTime(run.rangeEnd)}</div>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-black ${run.writeBack ? 'bg-cyan-950 text-white' : 'bg-slate-100 text-slate-500'}`}>{run.writeBack ? '已写入' : '本地保存'}</span>
            </div>
            {open ? <RunSections run={run} /> : <p className="rounded-[8px] bg-slate-50 p-3 text-[12px] leading-relaxed text-slate-700 line-clamp-3">{run.narrative}</p>}
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setOpenRunId(open ? null : run.id)} className="h-9 rounded-[8px] bg-slate-100 text-slate-800 text-[12px] font-black">{open ? '收起详情' : '展开详情'}</button>
              <button onClick={() => onDeleteRun(run.id)} className="h-9 rounded-[8px] bg-rose-50 text-rose-700 text-[12px] font-black flex items-center justify-center gap-1.5"><Trash size={14} weight="bold" />删除</button>
            </div>
          </section>
        );
      })}
    </div>
  );
};

const RunSections: React.FC<{ run: XunjiScreenlifeRun }> = ({ run }) => (
  <div className="space-y-3">
    <div className="rounded-[8px] bg-slate-50 p-3">
      <div className="text-[12px] font-black mb-1">记录摘要</div>
      <p className="text-[12px] leading-relaxed text-slate-700">{run.narrative}</p>
    </div>
    <MiniList title="聊了什么" rows={run.chats.map(c => ({ left: xunjiFormatClock(c.time), main: c.target, sub: c.summary }))} />
    <MiniList title="刷了什么" rows={run.browsed.map(b => ({ left: b.appName, main: b.title, sub: b.summary }))} />
    <MiniList title="记了什么" rows={run.notes.map(n => ({ left: xunjiFormatClock(n.time), main: n.text }))} />
    <MiniList title="屏幕时间线" rows={run.appUsage.map(a => ({ left: xunjiFormatClock(a.startedAt), main: a.appName, sub: `${xunjiDurationMinutes(a)} 分钟 · ${a.note || ''}` }))} />
  </div>
);

const MiniList: React.FC<{ title: string; rows: { left: string; main: string; sub?: string }[] }> = ({ title, rows }) => (
  <div>
    <div className="text-[12px] font-black mb-2">{title}</div>
    <div className="space-y-2">
      {rows.map((row, i) => (
        <div key={`${row.left}_${i}`} className="flex gap-2 text-[12px]">
          <div className="w-[56px] shrink-0 text-[10px] font-black text-cyan-800 pt-0.5">{row.left}</div>
          <div className="min-w-0 flex-1 border-l border-slate-200 pl-2">
            <div className="font-bold text-slate-800">{row.main}</div>
            {row.sub && <div className="text-[11px] text-slate-500 leading-relaxed">{row.sub}</div>}
          </div>
        </div>
      ))}
    </div>
  </div>
);

const buildAppRanks = (snapshot: XunjiMonitorSnapshot) => {
  const map = new Map<string, number>();
  snapshot.appUsage.forEach(s => map.set(s.appName, (map.get(s.appName) || 0) + xunjiDurationMinutes(s)));
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, value]) => ({ label, value, sub: `${value}分` }));
};

const MonitorTab: React.FC<{ snapshot: XunjiMonitorSnapshot; snapshots: XunjiMonitorSnapshot[]; syncing: boolean; routeExpanded: boolean; setRouteExpanded: (v: boolean) => void; onRefresh: () => void }> = ({ snapshot, snapshots, syncing, routeExpanded, setRouteExpanded, onRefresh }) => {
  const appRanks = useMemo(() => buildAppRanks(snapshot), [snapshot]);
  const currentNetwork = snapshot.networks[snapshot.networks.length - 1];
  const currentLoc = snapshot.locations[snapshot.locations.length - 1];

  return (
    <div className="space-y-3">
      <section className="rounded-[8px] bg-white border border-slate-200 p-3 shadow-sm space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] text-cyan-700 font-black">TODAY</div>
            <div className="mt-0.5 text-[15px] font-black text-slate-950">实时概览</div>
            <div className="mt-1 text-[11px] text-slate-500 font-bold">更新时间 {fmtDateTime(snapshot.generatedAt)}</div>
          </div>
          <button disabled={syncing} onClick={onRefresh} className="shrink-0 h-10 rounded-[8px] bg-cyan-950 px-3 text-white font-black text-[12px] flex items-center justify-center gap-2 active:scale-[0.99] disabled:opacity-60">
            <ArrowsClockwise size={15} weight="bold" className={syncing ? 'animate-spin' : ''} />{syncing ? '刷新中' : '刷新'}
          </button>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <Stat label="解锁" value={snapshot.unlockCount} />
          <Stat label="屏幕" value={<span className="text-[15px]">{fmtMinutes(snapshot.screenTimeMinutes)}</span>} />
          <Stat label="电量" value={`${snapshot.batteryLevel}%`} />
          <Stat label="步数" value={<span className="text-[15px]">{snapshot.health.steps}</span>} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-[8px] bg-emerald-50 border border-emerald-100 p-3 min-w-0">
            <div className="text-[10px] text-emerald-700 font-black">当前位置</div>
            <div className="mt-1 text-[13px] font-black text-slate-900 truncate">{currentLoc?.label || '--'}</div>
            <div className="mt-0.5 text-[10px] text-slate-500 font-bold truncate">{currentLoc?.address || '暂无定位'}</div>
          </div>
          <div className="rounded-[8px] bg-amber-50 border border-amber-100 p-3 min-w-0">
            <div className="text-[10px] text-amber-700 font-black">当前网络</div>
            <div className="mt-1 text-[13px] font-black text-slate-900 truncate">{currentNetwork?.type === 'wifi' ? 'WIFI' : '移动数据'}</div>
            <div className="mt-0.5 text-[10px] text-slate-500 font-bold truncate">{currentNetwork?.name || '未知网络'}</div>
          </div>
        </div>
      </section>

      <PhoneUsagePanel snapshot={snapshot} appRanks={appRanks} />
      <SnapshotHistoryPanel snapshots={snapshots} />
      <NetworkPanel snapshot={snapshot} />
      <DevicePanel snapshot={snapshot} />
      <LocationPanel snapshot={snapshot} routeExpanded={routeExpanded} setRouteExpanded={setRouteExpanded} />
      <HealthPanel snapshot={snapshot} />
      <CallsPanel snapshot={snapshot} />
      <BatteryPanel snapshot={snapshot} />
    </div>
  );
};

const SnapshotHistoryPanel: React.FC<{ snapshots: XunjiMonitorSnapshot[] }> = ({ snapshots }) => (
  <Panel title="概览历史" icon={<ArrowsClockwise size={17} weight="bold" />} defaultOpen={false}>
    {snapshots.length <= 1 ? <EmptyState text="刷新几次后，这里会保留最近的实时概览。" /> : (
      <div className="space-y-2">
        {snapshots.slice(0, 8).map(item => {
          const topApp = [...item.appUsage].sort((a, b) => xunjiDurationMinutes(b) - xunjiDurationMinutes(a))[0];
          const loc = item.locations[item.locations.length - 1];
          return (
            <div key={item.id} className="rounded-[8px] bg-slate-50 border border-slate-100 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-black text-[13px] text-slate-900">{fmtDateTime(item.generatedAt)}</div>
                  <div className="mt-0.5 text-[10px] font-bold text-slate-500 truncate">{loc?.label || '未知位置'} · {topApp?.appName || '无 App'}</div>
                </div>
                <span className="shrink-0 rounded-full bg-white border border-slate-200 px-2 py-0.5 text-[10px] font-black text-slate-700">{item.batteryLevel}%</span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <TinyMetric label="解锁" value={item.unlockCount} />
                <TinyMetric label="屏幕" value={fmtMinutes(item.screenTimeMinutes)} />
                <TinyMetric label="步数" value={item.health.steps} />
              </div>
            </div>
          );
        })}
      </div>
    )}
  </Panel>
);

const PhoneUsagePanel: React.FC<{ snapshot: XunjiMonitorSnapshot; appRanks: { label: string; value: number; sub?: string }[] }> = ({ snapshot, appRanks }) => (
  <Panel title="手机使用记录" icon={<Eye size={17} weight="bold" />}>
    <div className="grid grid-cols-3 gap-2">
      <Stat label="解锁手机次数" value={snapshot.unlockCount} />
      <Stat label="屏幕使用时间" value={fmtMinutes(snapshot.screenTimeMinutes)} />
      <Stat label="锁屏时间" value={snapshot.lockPeriods.length} sub="段记录" />
    </div>
    <MiniList title="app 使用记录 · 时间轴" rows={snapshot.appUsage.map(s => ({ left: xunjiFormatClock(s.startedAt), main: s.appName, sub: `${xunjiFormatClock(s.startedAt)} 使用，时长 ${xunjiDurationMinutes(s)} 分钟` }))} />
    <div>
      <div className="text-[12px] font-black mb-2">使用时长排行</div>
      <Bars rows={appRanks} />
    </div>
    <MiniList title="锁屏时间" rows={snapshot.lockPeriods.map(p => ({ left: xunjiFormatClock(p.startedAt), main: `${xunjiFormatClock(p.startedAt)} - ${xunjiFormatClock(p.endedAt)}`, sub: `锁屏 ${fmtMinutes(Math.round((p.endedAt - p.startedAt) / 60000))}` }))} />
  </Panel>
);

const NetworkPanel: React.FC<{ snapshot: XunjiMonitorSnapshot }> = ({ snapshot }) => {
  const currentNetwork = snapshot.networks[snapshot.networks.length - 1];
  return (
    <Panel title="网络记录" icon={<Compass size={17} weight="bold" />}>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="当前网络" value={currentNetwork?.type === 'wifi' ? 'WIFI' : '移动数据'} />
        <Stat label="名称" value={<span className="text-[13px]">{currentNetwork?.name}</span>} />
        <Stat label="时间" value={currentNetwork ? xunjiFormatClock(currentNetwork.timestamp) : '--'} />
      </div>
      <MiniList title="网络切换时间轴" rows={snapshot.networks.map(n => ({ left: xunjiFormatClock(n.timestamp), main: n.type === 'wifi' ? 'WIFI' : '移动数据', sub: n.name }))} />
    </Panel>
  );
};

const DevicePanel: React.FC<{ snapshot: XunjiMonitorSnapshot }> = ({ snapshot }) => (
  <Panel title="手机型号" icon={<Compass size={17} weight="bold" />}>
    <div className="grid grid-cols-2 gap-2">
      <Stat label="手机型号" value={<span className="text-[14px]">{snapshot.phoneModel}</span>} />
      <Stat label="系统状态" value={snapshot.isCharging ? '充电中' : '使用中'} sub={`电量 ${snapshot.batteryLevel}%`} />
    </div>
  </Panel>
);

const LocationPanel: React.FC<{ snapshot: XunjiMonitorSnapshot; routeExpanded: boolean; setRouteExpanded: (v: boolean) => void }> = ({ snapshot, routeExpanded, setRouteExpanded }) => {
  const currentLoc = snapshot.locations[snapshot.locations.length - 1];
  return (
    <Panel title="地图定位" icon={<MapPin size={17} weight="fill" />}>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="相距距离" value={`${snapshot.distanceKm}km`} />
        <Stat label="地图详情位置" value={<span className="text-[13px]">{currentLoc?.label}</span>} sub={currentLoc?.address} />
      </div>
      <button onClick={() => setRouteExpanded(!routeExpanded)} className="w-full h-10 rounded-[8px] bg-cyan-950 text-white font-black text-[12px] flex items-center justify-center gap-2">
        <MapPin size={15} weight="fill" />导航
      </button>
      <MiniMap locations={snapshot.locations} />
      <MiniList title="地图停留 · 时间轴" rows={snapshot.locations.map(p => ({ left: xunjiFormatClock(p.arrivedAt), main: p.label, sub: `具体位置：${p.address} · 移动时间 ${p.moveMinutes || 0} 分 · 停留时间 ${p.stayMinutes || 0} 分` }))} />
      {routeExpanded && <MiniList title="历史轨迹" rows={snapshot.locations.map(p => ({ left: xunjiLocationTransportLabel(p), main: p.label, sub: p.address }))} />}
    </Panel>
  );
};

const HealthPanel: React.FC<{ snapshot: XunjiMonitorSnapshot }> = ({ snapshot }) => (
  <Panel title="对方今日健康状态" icon={<Heartbeat size={17} weight="fill" />}>
    <div className="grid grid-cols-3 gap-2">
      <Stat label="压力状态" value={<span className="text-[14px]">{snapshot.health.stressLabel}</span>} />
      <Stat label="平均 HRV" value={snapshot.health.hrvAvg} />
      <Stat label="当前 HRV" value={snapshot.health.hrvCurrent} />
    </div>
    <ChartBlock title="HRV 趋势图" values={snapshot.health.hrvTrend} footer={`平均HRV ${snapshot.health.hrvAvg} · 最轻松 ${Math.max(...snapshot.health.hrvTrend)} · 最压力 ${Math.min(...snapshot.health.hrvTrend)}`} />
    <div className="grid grid-cols-3 gap-2">
      <Stat label="心率范围" value={<span className="text-[14px]">{snapshot.health.heartRateMin}-{snapshot.health.heartRateMax}</span>} />
      <Stat label="最近心率" value={snapshot.health.heartRateLatest} />
      <Stat label="步行距离" value={`${snapshot.health.walkingKm}km`} />
    </div>
    <ChartBlock title="心率趋势" values={snapshot.health.heartRateTrend} color="#e11d48" />
    <div className="grid grid-cols-2 gap-2">
      <Stat label="睡眠时长" value={fmtMinutes(snapshot.health.sleepMinutes)} />
      <Stat label="睡眠质量" value={<span className="text-[14px]">{snapshot.health.sleepQuality}</span>} />
    </div>
    <MiniList title="睡眠阶段" rows={[
      { left: '入睡', main: xunjiFormatClock(snapshot.health.sleep.asleepAt) },
      { left: '清醒', main: xunjiFormatClock(snapshot.health.sleep.awakeAt), sub: `${snapshot.health.sleep.awakeMinutes} 分钟` },
      { left: '快速动眼', main: `${snapshot.health.sleep.remMinutes} 分钟` },
      { left: '核心睡眠', main: `${snapshot.health.sleep.coreMinutes} 分钟` },
      { left: '深度睡眠', main: `${snapshot.health.sleep.deepMinutes} 分钟` },
    ]} />
    <div className="grid grid-cols-2 gap-2">
      <Stat label="步数" value={snapshot.health.steps} />
      <Stat label="当日趋势" value={<span className="text-[12px]">12 段记录</span>} sub="本周趋势如下" />
    </div>
    <ChartBlock title="步数 · 当日趋势" values={snapshot.health.dayStepTrend} color="#059669" />
    <ChartBlock title="步数 · 本周趋势" values={snapshot.health.weekStepTrend} color="#7c3aed" />
  </Panel>
);

const CallsPanel: React.FC<{ snapshot: XunjiMonitorSnapshot }> = ({ snapshot }) => (
  <Panel title="拨打记录" icon={<PhoneCall size={17} weight="fill" />}>
    <MiniList title="通话时间 / 通话对象 / 时间轴 / 通话情况" rows={snapshot.calls.map(c => ({ left: xunjiFormatClock(c.startedAt), main: c.target, sub: `通话时长 ${c.durationMinutes} 分钟 · ${c.status}` }))} />
  </Panel>
);

const BatteryPanel: React.FC<{ snapshot: XunjiMonitorSnapshot }> = ({ snapshot }) => (
  <Panel title="手机电量" icon={<Bell size={17} weight="bold" />}>
    <div className="grid grid-cols-2 gap-2">
      <Stat label="当前电量" value={`${snapshot.batteryLevel}%`} />
      <Stat label="充电状态" value={snapshot.isCharging ? '充电中' : '未充电'} />
    </div>
    <MiniList title="电量事件" rows={snapshot.batteryEvents.map(e => ({ left: xunjiFormatClock(e.timestamp), main: xunjiBatteryEventLabel(e), sub: `电量 ${e.level}%` }))} />
  </Panel>
);

const ChartBlock: React.FC<{ title: string; values: number[]; color?: string; footer?: string }> = ({ title, values, color, footer }) => (
  <div className="rounded-[8px] bg-slate-50 p-3">
    <div className="text-[12px] font-black mb-1">{title}</div>
    <Sparkline values={values} color={color} />
    <div className="text-[10px] text-slate-500 font-bold">{footer || `最小 ${Math.min(...values)} · 最大 ${Math.max(...values)}`}</div>
  </div>
);

const MiniMap: React.FC<{ locations: XunjiMonitorSnapshot['locations'] }> = ({ locations }) => (
  <div className="relative h-[112px] rounded-[8px] overflow-hidden bg-gradient-to-br from-cyan-50 via-white to-emerald-50 border border-slate-200">
    <div className="absolute inset-0 opacity-50" style={{ backgroundImage: 'linear-gradient(rgba(15,23,42,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(15,23,42,.08) 1px, transparent 1px)', backgroundSize: '22px 22px' }} />
    <div className="absolute left-7 right-7 top-1/2 h-1 bg-cyan-700/25 rounded-full" />
    {locations.map((p, i) => (
      <div key={p.id} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${12 + i * (76 / Math.max(1, locations.length - 1))}%`, top: `${38 + (i % 2) * 22}%` }}>
        <div className="w-5 h-5 rounded-full bg-cyan-950 text-white text-[9px] font-black flex items-center justify-center shadow">{i + 1}</div>
        <div className="mt-1 whitespace-nowrap rounded-full bg-white/90 px-1.5 py-0.5 text-[9px] font-bold text-slate-600 shadow-sm">{p.label}</div>
      </div>
    ))}
  </div>
);

const ReportTab: React.FC<{
  char: CharacterProfile;
  reports: XunjiReportItem[];
  rules: Record<XunjiReportType, boolean>;
  onToggleRule: (type: XunjiReportType, on: boolean) => void;
  onGenerate: () => void;
  onMarkAllRead: () => void;
  onMarkReport: (id: string, patch: Partial<XunjiReportItem>) => void;
  onWriteReportBack: (id: string) => void;
  onWriteBack: () => void;
}> = ({ char, reports, rules, onToggleRule, onGenerate, onMarkAllRead, onMarkReport, onWriteReportBack, onWriteBack }) => {
  const unread = reports.filter(r => !r.acknowledged).length;
  const [mode, setMode] = useState<'feed' | 'rules'>('feed');
  const [openId, setOpenId] = useState<string | null>(reports[0]?.id || null);
  useEffect(() => {
    if (!reports.length) {
      setOpenId(null);
      return;
    }
    setOpenId(prev => prev && reports.some(r => r.id === prev) ? prev : reports[0].id);
  }, [reports]);
  return (
    <div className="space-y-3">
      <section className="rounded-[8px] bg-white border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 pt-4 pb-3 text-center">
          <div className="mx-auto inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-1 shadow-sm">
            <span className="inline-flex w-5 h-5 rounded-[6px] bg-lime-100 text-lime-700 items-center justify-center"><Compass size={14} weight="fill" /></span>
            <span className="text-[14px] font-black text-slate-950">Lookus</span>
          </div>
          <div className="mt-2 flex items-center justify-center gap-2">
            <span className="font-black text-[18px] leading-none">{char.name}</span>
          </div>
          <div className="mt-1 inline-flex items-center gap-1.5 text-[12px] font-bold text-slate-600">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            在线
          </div>
        </div>
        <div className="border-t border-slate-100 px-3 py-3">
          <div className="grid grid-cols-2 gap-2 mb-3">
            <Stat label="报备总数" value={reports.length} />
            <Stat label="未读报备" value={unread} />
          </div>
          <div className="grid grid-cols-2 gap-2 rounded-[8px] bg-slate-100 p-1">
            <button onClick={() => setMode('feed')} className={`h-9 rounded-[7px] text-[12px] font-black transition ${mode === 'feed' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'}`}>报备</button>
            <button onClick={() => setMode('rules')} className={`h-9 rounded-[7px] text-[12px] font-black transition ${mode === 'rules' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'}`}>规则</button>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <PillButton active onClick={onGenerate} icon={<Bell size={14} weight="bold" />}>生成报备</PillButton>
            <PillButton onClick={onMarkAllRead} icon={<CheckCircle size={14} weight="bold" />}>全部已读</PillButton>
            <PillButton onClick={onWriteBack} icon={<Sparkle size={14} weight="bold" />}>写入日常</PillButton>
          </div>
        </div>
      </section>

      {mode === 'feed' ? (
        <section className="rounded-[8px] bg-[#f7f7f7] border border-slate-200 shadow-sm px-3 py-4">
          {reports.length === 0 ? <EmptyState text="还没有报备记录。" /> : (
            <div className="space-y-5">
              {reports.map(item => {
                const open = openId === item.id;
                return (
                  <div key={item.id} className="text-center">
                    <div className="text-[17px] font-black tracking-wide text-slate-700">{fmtReportStamp(item.timestamp)}</div>
                    <div className="mt-3 flex items-center justify-center gap-2 text-left">
                      <span className={`w-7 h-7 rounded-full border flex items-center justify-center shrink-0 ${reportTone(item)}`}>
                        {reportIcon(item.type)}
                      </span>
                      <div className="min-w-0 max-w-[66%] text-[14px] font-black text-slate-600 leading-snug">
                        <span>{reportLineText(item)}</span>
                      </div>
                      <button
                        onClick={() => {
                          setOpenId(open ? null : item.id);
                          if (!item.acknowledged) void onMarkReport(item.id, { acknowledged: true });
                        }}
                        className="shrink-0 text-[13px] font-black text-emerald-500 active:scale-95"
                      >
                        查看记录
                      </button>
                    </div>
                    {open && (
                      <div className="mt-3 mx-auto max-w-[92%] rounded-[8px] bg-white border border-slate-200 p-3 text-left shadow-sm">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-[13px] font-black text-slate-900 truncate">{item.title}</div>
                            <div className="mt-0.5 text-[10px] font-bold text-slate-500">{fmtDateTime(item.timestamp)} · {XUNJI_REPORT_LABELS[item.type]}</div>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            {!item.acknowledged && <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-black text-emerald-700">未读</span>}
                            {item.writtenBack && <span className="rounded-full bg-slate-900 px-1.5 py-0.5 text-[9px] font-black text-white">已写入</span>}
                          </div>
                        </div>
                        <p className="mt-2 text-[12px] leading-relaxed text-slate-700">{item.body}</p>
                        <div className="mt-3 flex justify-end gap-2">
                          {!item.acknowledged && <button onClick={() => onMarkReport(item.id, { acknowledged: true })} className="rounded-full bg-white border border-slate-200 px-2 py-1 text-[11px] font-black">标记已读</button>}
                          {!item.writtenBack && <button onClick={() => onWriteReportBack(item.id)} className="rounded-full bg-slate-950 text-white px-2 py-1 text-[11px] font-black">写入日常</button>}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ) : (
        <Panel title="报备规则" icon={<GearSix size={17} weight="bold" />}>
          <div className="space-y-3">
            {REPORT_GROUPS.map(group => (
              <div key={group.title} className="rounded-[8px] bg-slate-50 p-2">
                <div className="text-[12px] font-black mb-2">{group.title}</div>
                <div className="space-y-2">
                  {group.types.map(type => (
                    <div key={type} className="flex items-center justify-between gap-3 rounded-[8px] bg-white px-2 py-2 border border-slate-100">
                      <div className="min-w-0">
                        <div className="text-[12px] font-bold text-slate-800">{XUNJI_REPORT_LABELS[type]}</div>
                        {type === 'app_hourly' && <div className="text-[10px] text-slate-500">具体时间 · 每一小时提醒一次</div>}
                        {type === 'call_10min' && <div className="text-[10px] text-slate-500">电话时长 · 十分钟提醒一次</div>}
                        {type === 'sleep_late_reminder' && <div className="text-[10px] text-slate-500">9 点后没进入睡眠提醒一次</div>}
                        {type === 'sleep_5h' && <div className="text-[10px] text-slate-500">睡眠时长 · 5 小时提醒一次</div>}
                      </div>
                      <Toggle on={rules[type]} onChange={next => onToggleRule(type, next)} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
};

const SettingsTab: React.FC<{
  char: CharacterProfile;
  characters: CharacterProfile[];
  settings: XunjiSettings;
  onPatch: (patch: Partial<XunjiSettings>) => void;
  onClear: () => void;
}> = ({ char, characters, settings, onPatch, onClear }) => {
  const [locationEditorOpen, setLocationEditorOpen] = useState(false);
  const locationSettings = getXunjiCharacterLocationSettings(settings, char.id);
  const [locationDraft, setLocationDraft] = useState(locationSettings.customLocation || cityLabel(char));

  useEffect(() => {
    if (!locationEditorOpen) setLocationDraft(locationSettings.customLocation || cityLabel(char));
  }, [char.id, locationEditorOpen, locationSettings.customLocation]);

  const editCharacterLocation = () => {
    setLocationDraft(locationSettings.customLocation || cityLabel(char));
    setLocationEditorOpen(true);
  };

  const saveCharacterLocation = () => {
    const value = locationDraft.trim();
    onPatch({
      locationSource: 'character',
      customLocation: value || undefined,
      customLocationUpdatedAt: Date.now(),
    });
    setLocationEditorOpen(false);
  };

  const requestBrowserLocation = () => {
    if (!navigator.geolocation) {
      window.alert('当前设备不支持系统定位。');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => onPatch({
        locationSource: 'browser',
        browserLocation: {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          capturedAt: Date.now(),
        },
      }),
      err => window.alert(err.message || '系统定位授权失败。'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  };

  return (
    <div className="relative space-y-3">
      <section className="rounded-[8px] bg-white border border-slate-200 p-3 shadow-sm space-y-3">
        <div>
          <div className="text-[12px] font-black mb-2">目标角色</div>
          <select value={settings.activeCharId || char.id} onChange={e => onPatch({ activeCharId: e.target.value })} className="w-full rounded-[8px] border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] font-bold outline-none">
            {characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="flex items-start justify-between gap-3 rounded-[8px] bg-slate-50 p-3">
          <div className="min-w-0">
            <div className="text-[13px] font-black">留进 TA 的日常</div>
            <div className="mt-1 text-[11px] text-slate-600 leading-relaxed">
              {settings.writeBackToCharacter ? '这段痕迹会被 TA 当成自己经历过的小日常。' : '只在这里翻看，不惊动 TA 的日常。'}
            </div>
          </div>
          <Toggle on={settings.writeBackToCharacter} onChange={next => onPatch({ writeBackToCharacter: next })} />
        </div>
        <div>
          <div className="text-[12px] font-black mb-2">定位来源</div>
          <div className="grid grid-cols-2 gap-2">
            <PillButton active={(locationSettings.locationSource || 'character') === 'character'} onClick={editCharacterLocation}>角色设定</PillButton>
            <PillButton active={locationSettings.locationSource === 'browser'} onClick={requestBrowserLocation}>真实定位</PillButton>
          </div>
          <div className="mt-2 rounded-[8px] bg-slate-50 px-3 py-2 text-[11px] text-slate-600 font-bold leading-relaxed">
            {(locationSettings.locationSource || 'character') === 'browser' && locationSettings.browserLocation
              ? `已授权：${locationSettings.browserLocation.lat.toFixed(5)}, ${locationSettings.browserLocation.lng.toFixed(5)} · ${fmtDateTime(locationSettings.browserLocation.capturedAt)}`
              : `角色设定：${locationSettings.customLocation || cityLabel(char)}${locationSettings.customLocationUpdatedAt ? ` · ${fmtDateTime(locationSettings.customLocationUpdatedAt)}` : ''}`}
          </div>
        </div>
        <div>
          <div className="text-[12px] font-black mb-2">默认记录密度</div>
          <div className="grid grid-cols-3 gap-2">
            {(['light', 'standard', 'detailed'] as XunjiDensity[]).map(d => <PillButton key={d} active={settings.defaultDensity === d} onClick={() => onPatch({ defaultDensity: d })}>{DENSITY_LABEL[d]}</PillButton>)}
          </div>
        </div>
      </section>

      <section className="rounded-[8px] bg-white border border-slate-200 p-3 shadow-sm space-y-2">
        <button onClick={() => onPatch({ reportRules: { ...DEFAULT_XUNJI_REPORT_RULES } })} className="w-full h-10 rounded-[8px] bg-slate-100 font-black text-[12px] flex items-center justify-center gap-2">
          <ArrowsClockwise size={15} weight="bold" />留意规则恢复默认
        </button>
        <button onClick={onClear} className="w-full h-10 rounded-[8px] bg-rose-50 text-rose-700 font-black text-[12px] flex items-center justify-center gap-2">
          <Trash size={15} weight="bold" />清空当前角色循迹数据
        </button>
      </section>

      {locationEditorOpen && (
        <div className="absolute inset-0 z-50 bg-slate-950/30 backdrop-blur-sm flex items-end p-3">
          <section className="w-full rounded-[8px] bg-white border border-slate-200 shadow-xl p-3 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[15px] font-black text-slate-950">角色设定定位</div>
                <div className="mt-1 text-[11px] text-slate-500 font-bold">输入本次循迹使用的城市、街区或自定义地点。</div>
              </div>
              <button onClick={() => setLocationEditorOpen(false)} className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 font-black">×</button>
            </div>
            <textarea
              value={locationDraft}
              onChange={e => setLocationDraft(e.target.value)}
              rows={4}
              className="w-full resize-none rounded-[8px] border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] font-bold outline-none focus:border-cyan-800"
              placeholder="例如：上海市徐汇区衡山路附近 / 架空城市白塔区北站 / 成都玉林路"
            />
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setLocationEditorOpen(false)} className="h-10 rounded-[8px] bg-slate-100 text-slate-700 text-[12px] font-black">取消</button>
              <button onClick={saveCharacterLocation} className="h-10 rounded-[8px] bg-cyan-950 text-white text-[12px] font-black">保存并切换</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

export default XunjiApp;
