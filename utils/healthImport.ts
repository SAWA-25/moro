import type { HealthImportBatch, HealthImportSource, HealthRecord } from '../types';
import { makeHealthRecord, normalizeHealthDate, toHealthDateKey } from './health';
import { normalizePeriodTime } from './periodReminders';

export type HealthImportPreset = 'auto' | HealthImportSource;

export type HealthImportFieldKey =
  | ''
  | 'ignore'
  | 'date'
  | 'startTime'
  | 'endTime'
  | 'steps'
  | 'sleepMinutes'
  | 'sleepHours'
  | 'heartRate'
  | 'restingHeartRate'
  | 'hrv'
  | 'spo2'
  | 'stress'
  | 'calories'
  | 'distanceKm'
  | 'label';

export type HealthImportFieldMapping = Record<string, HealthImportFieldKey>;

export interface HealthImportPreview {
  source: HealthImportSource;
  fileName: string;
  records: HealthRecord[];
  parsedCount: number;
  skippedCount: number;
  warnings: string[];
  headers: string[];
  mappedFields: Record<string, HealthImportFieldKey>;
  unmappedHeaders: string[];
}

export interface HealthImportParseOptions {
  preset?: HealthImportPreset;
  mapping?: HealthImportFieldMapping;
  now?: number;
}

export const HEALTH_IMPORT_FIELD_OPTIONS: Array<{ key: HealthImportFieldKey; label: string }> = [
  { key: '', label: '自动' },
  { key: 'ignore', label: '忽略' },
  { key: 'date', label: '日期' },
  { key: 'startTime', label: '开始时间' },
  { key: 'endTime', label: '结束时间' },
  { key: 'steps', label: '步数' },
  { key: 'sleepMinutes', label: '睡眠分钟' },
  { key: 'sleepHours', label: '睡眠小时' },
  { key: 'heartRate', label: '心率' },
  { key: 'restingHeartRate', label: '静息心率' },
  { key: 'hrv', label: 'HRV' },
  { key: 'spo2', label: '血氧' },
  { key: 'stress', label: '压力' },
  { key: 'calories', label: '卡路里' },
  { key: 'distanceKm', label: '距离 km' },
  { key: 'label', label: '标签/备注' },
];

type MetricKey = 'steps' | 'distanceKm' | 'calories' | 'sleep' | 'heartRate' | 'restingHeartRate' | 'hrv' | 'spo2' | 'stress';

interface MetricSample {
  metric: MetricKey;
  date: string;
  value: number;
  timestamp?: number;
  startAt?: number;
  endAt?: number;
  label?: string;
  unit?: string;
  metadata?: Record<string, any>;
}

const MINUTE = 60_000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const FIELD_ALIASES: Record<Exclude<HealthImportFieldKey, '' | 'ignore'>, string[]> = {
  date: ['date', 'day', 'recorddate', '日期', '日期时间', '时间', '记录时间', '开始日期', 'startdate', 'startday'],
  startTime: ['start', 'starttime', 'startedat', 'startdate', '开始', '开始时间', '入睡', '入睡时间'],
  endTime: ['end', 'endtime', 'endedat', 'enddate', '结束', '结束时间', '醒来', '醒来时间'],
  steps: ['steps', 'step', 'stepcount', 'count', '步数', '计步', '运动步数'],
  sleepMinutes: ['sleepminutes', 'sleepminute', 'sleepdurationminutes', 'sleepduration', 'asleepminutes', '睡眠分钟', '睡眠时长分钟', '睡眠时长', '入睡分钟'],
  sleepHours: ['sleephours', 'sleephour', 'sleepdurationhours', '睡眠小时', '睡眠时长小时'],
  heartRate: ['heartrate', 'heart_rate', 'bpm', 'avgheartrate', 'averageheartrate', '心率', '平均心率'],
  restingHeartRate: ['restingheartrate', 'restingheart_rate', 'rhr', '静息心率', '安静心率'],
  hrv: ['hrv', 'heartratevariability', 'sdnn', '心率变异', '心率变异性'],
  spo2: ['spo2', 'oxygen', 'oxygensaturation', 'bloodoxygen', '血氧', '血氧饱和度'],
  stress: ['stress', 'stresslevel', 'pressure', '压力', '压力值', '压力指数'],
  calories: ['calories', 'calorie', 'kcal', 'energy', '卡路里', '热量', '千卡'],
  distanceKm: ['distance', 'distancekm', 'km', '公里', '距离', '步行距离'],
  label: ['label', 'type', 'name', 'note', '备注', '类型', '标签', '名称'],
};

const normalizeHeader = (value: string) => value
  .trim()
  .toLowerCase()
  .replace(/[\s_\-:：/\\()[\]{}"'.,，。]+/g, '');

const FIELD_ALIAS_LOOKUP: Record<string, HealthImportFieldKey> = Object.entries(FIELD_ALIASES).reduce((acc, [field, aliases]) => {
  aliases.forEach(alias => {
    acc[normalizeHeader(alias)] = field as HealthImportFieldKey;
  });
  return acc;
}, {} as Record<string, HealthImportFieldKey>);

const readTextFile = async (file: File | Blob): Promise<string> => {
  if (typeof (file as File).text === 'function') return (file as File).text();
  const buffer = await file.arrayBuffer();
  return new TextDecoder('utf-8').decode(buffer);
};

const fileNameOf = (file: File | Blob, fallback = 'wearable-data') => (
  typeof (file as File).name === 'string' && (file as File).name ? (file as File).name : fallback
);

const sourceFromPreset = (preset?: HealthImportPreset): HealthImportSource | null => {
  if (!preset || preset === 'auto') return null;
  return preset;
};

const guessSource = (fileName: string, text = ''): HealthImportSource => {
  const lower = fileName.toLowerCase();
  const head = text.slice(0, 2000).toLowerCase();
  if (lower.includes('apple') || lower.endsWith('export.xml') || head.includes('hkquantitytypeidentifier')) return 'apple_health';
  if (lower.includes('google') || lower.includes('fit') || head.includes('datasourcename') || head.includes('com.google')) return 'google_fit';
  if (lower.includes('huawei') || lower.includes('华为')) return 'huawei';
  if (lower.includes('zepp') || lower.includes('amazfit')) return 'zepp';
  if (lower.includes('mi') || lower.includes('xiaomi') || lower.includes('小米')) return 'xiaomi';
  return 'generic';
};

const stableHash = (value: string): string => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const stableRecordId = (source: HealthImportSource, metric: string, date: string, suffix = '') => (
  `health_wearable_${source}_${metric}_${date}_${stableHash(`${source}:${metric}:${date}:${suffix}`)}`
);

const toNumber = (value: unknown): number | undefined => {
  if (value === null || value === undefined) return undefined;
  const raw = String(value).trim().replace(/,/g, '');
  if (!raw) return undefined;
  const match = raw.match(/-?\d+(?:\.\d+)?/);
  if (!match) return undefined;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : undefined;
};

const parseDateValue = (value: unknown, baseDate?: string): Date | null => {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(raw) && baseDate && DAY_RE.test(baseDate)) {
    const [y, m, d] = baseDate.split('-').map(Number);
    const [h, min, sec = 0] = raw.split(':').map(Number);
    return new Date(y, m - 1, d, h, min, sec, 0);
  }
  const normalized = raw
    .replace(/\//g, '-')
    .replace(/^(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/, (_, y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  const parsed = new Date(normalized);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  const day = normalized.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (day) return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
  return null;
};

const dateKeyFrom = (value: unknown, fallback?: string): string => {
  if (typeof value === 'string' && DAY_RE.test(value.trim())) return value.trim();
  const parsed = parseDateValue(value);
  if (parsed) return toHealthDateKey(parsed);
  return normalizeHealthDate(fallback, toHealthDateKey());
};

const timeHHmmFromMs = (ms?: number): string | undefined => {
  if (!ms) return undefined;
  const d = new Date(ms);
  return normalizePeriodTime(`${d.getHours()}:${d.getMinutes()}`);
};

const chooseDelimiter = (line: string): string => {
  const candidates = [',', '\t', ';'];
  return candidates.sort((a, b) => line.split(b).length - line.split(a).length)[0] || ',';
};

export function parseCsvRows(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, '');
  const delimiter = chooseDelimiter(input.split(/\r?\n/)[0] || '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    const next = input[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows.filter(item => item.some(cellValue => cellValue.trim()));
}

const inferField = (header: string, mapping?: HealthImportFieldMapping): HealthImportFieldKey => {
  const explicit = mapping?.[header];
  if (explicit) return explicit;
  return FIELD_ALIAS_LOOKUP[normalizeHeader(header)] || '';
};

const parseDelimitedSamples = (text: string, mapping?: HealthImportFieldMapping): { samples: MetricSample[]; headers: string[]; mappedFields: Record<string, HealthImportFieldKey>; skipped: number } => {
  const rows = parseCsvRows(text);
  const headers = rows[0]?.map(header => header.trim()) || [];
  const mappedFields = Object.fromEntries(headers.map(header => [header, inferField(header, mapping)])) as Record<string, HealthImportFieldKey>;
  const samples: MetricSample[] = [];
  let skipped = 0;
  rows.slice(1).forEach(row => {
    const obj: Record<string, string> = {};
    headers.forEach((header, index) => {
      obj[header] = row[index] || '';
    });
    const next = samplesFromMappedObject(obj, mappedFields);
    if (next.length) samples.push(...next);
    else skipped += 1;
  });
  return { samples, headers, mappedFields, skipped };
};

const samplesFromMappedObject = (obj: Record<string, any>, fields: Record<string, HealthImportFieldKey>): MetricSample[] => {
  const byField: Partial<Record<HealthImportFieldKey, any>> = {};
  Object.entries(fields).forEach(([header, field]) => {
    if (!field || field === 'ignore') return;
    byField[field] = obj[header];
  });
  return samplesFromFieldValues(byField);
};

const samplesFromFieldValues = (fields: Partial<Record<HealthImportFieldKey, any>>): MetricSample[] => {
  const baseDate = fields.date ? dateKeyFrom(fields.date) : undefined;
  const start = parseDateValue(fields.startTime, baseDate);
  const end = parseDateValue(fields.endTime, baseDate);
  const metricDate = end ? toHealthDateKey(end) : start ? toHealthDateKey(start) : dateKeyFrom(fields.date, baseDate);
  const label = typeof fields.label === 'string' ? fields.label.trim().slice(0, 80) : undefined;
  const out: MetricSample[] = [];
  const pushValue = (metric: MetricKey, value: unknown, unit: string, extra?: Record<string, any>) => {
    const n = toNumber(value);
    if (n === undefined) return;
    out.push({ metric, date: metricDate, value: n, unit, timestamp: end?.getTime() || start?.getTime(), startAt: start?.getTime(), endAt: end?.getTime(), label, metadata: extra });
  };
  pushValue('steps', fields.steps, '步');
  pushValue('distanceKm', fields.distanceKm, 'km');
  pushValue('calories', fields.calories, 'kcal');
  pushValue('heartRate', fields.heartRate, 'bpm');
  pushValue('restingHeartRate', fields.restingHeartRate, 'bpm');
  pushValue('hrv', fields.hrv, 'ms');
  pushValue('spo2', fields.spo2, '%');
  pushValue('stress', fields.stress, '分');
  const sleepMinutes = toNumber(fields.sleepMinutes);
  const sleepHours = toNumber(fields.sleepHours);
  const intervalMinutes = start && end && end.getTime() > start.getTime() ? Math.round((end.getTime() - start.getTime()) / MINUTE) : undefined;
  const sleepValue = sleepMinutes ?? (sleepHours !== undefined ? sleepHours * 60 : intervalMinutes);
  if (sleepValue !== undefined && sleepValue > 0) {
    out.push({
      metric: 'sleep',
      date: metricDate,
      value: sleepValue,
      unit: '分钟',
      timestamp: end?.getTime() || start?.getTime(),
      startAt: start?.getTime(),
      endAt: end?.getTime(),
      label: label || '睡眠',
    });
  }
  return out;
};

const collectJsonObjects = (value: any, out: Record<string, any>[] = [], depth = 0): Record<string, any>[] => {
  if (depth > 8 || value === null || value === undefined) return out;
  if (Array.isArray(value)) {
    value.forEach(item => collectJsonObjects(item, out, depth + 1));
    return out;
  }
  if (typeof value !== 'object') return out;
  const keys = Object.keys(value);
  if (keys.some(key => inferField(key) || ['dataSourceName', 'dataTypeName', 'startTimeNanos', 'endTimeNanos', 'value'].includes(key))) {
    out.push(value);
  }
  keys.forEach(key => {
    const child = value[key];
    if (Array.isArray(child) || (child && typeof child === 'object' && ['records', 'data', 'items', 'activities', 'point', 'points'].includes(key))) {
      collectJsonObjects(child, out, depth + 1);
    }
  });
  return out;
};

const googleFitSampleFromObject = (obj: Record<string, any>): MetricSample[] => {
  const sourceName = String(obj.dataSourceName || obj.dataTypeName || obj.originDataSourceId || '').toLowerCase();
  const startNanos = Number(obj.startTimeNanos || obj.startTime || 0);
  const endNanos = Number(obj.endTimeNanos || obj.endTime || 0);
  const startMs = startNanos > 1e14 ? Math.floor(startNanos / 1_000_000) : startNanos;
  const endMs = endNanos > 1e14 ? Math.floor(endNanos / 1_000_000) : endNanos;
  const value = Array.isArray(obj.value) ? obj.value[0] : obj.value;
  const metricValue = typeof value === 'object' ? (value.intVal ?? value.fpVal ?? value.doubleVal) : value;
  const n = toNumber(metricValue);
  if (n === undefined) return [];
  const date = toHealthDateKey(new Date(endMs || startMs || Date.now()));
  if (sourceName.includes('step_count')) return [{ metric: 'steps', date, value: n, unit: '步', startAt: startMs, endAt: endMs }];
  if (sourceName.includes('heart_rate')) return [{ metric: 'heartRate', date, value: n, unit: 'bpm', startAt: startMs, endAt: endMs }];
  if (sourceName.includes('calories')) return [{ metric: 'calories', date, value: n, unit: 'kcal', startAt: startMs, endAt: endMs }];
  if (sourceName.includes('distance')) return [{ metric: 'distanceKm', date, value: n > 100 ? n / 1000 : n, unit: 'km', startAt: startMs, endAt: endMs }];
  return [];
};

const parseJsonSamples = (text: string, mapping?: HealthImportFieldMapping): { samples: MetricSample[]; headers: string[]; mappedFields: Record<string, HealthImportFieldKey>; skipped: number } => {
  const parsed = JSON.parse(text);
  const objects = collectJsonObjects(parsed);
  const headers = Array.from(new Set(objects.flatMap(obj => Object.keys(obj)))).slice(0, 80);
  const mappedFields = Object.fromEntries(headers.map(header => [header, inferField(header, mapping)])) as Record<string, HealthImportFieldKey>;
  const samples: MetricSample[] = [];
  let skipped = 0;
  objects.forEach(obj => {
    const google = googleFitSampleFromObject(obj);
    const generic = samplesFromMappedObject(obj, mappedFields);
    const next = [...google, ...generic];
    if (next.length) samples.push(...next);
    else skipped += 1;
  });
  return { samples, headers, mappedFields, skipped };
};

const decodeXmlAttr = (value: string) => value
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>');

const xmlAttrs = (raw: string): Record<string, string> => {
  const attrs: Record<string, string> = {};
  raw.replace(/([A-Za-z_:][-A-Za-z0-9_:.]*)="([^"]*)"/g, (_, key, value) => {
    attrs[key] = decodeXmlAttr(value);
    return '';
  });
  return attrs;
};

const parseAppleXmlSamples = (text: string): { samples: MetricSample[]; skipped: number } => {
  const samples: MetricSample[] = [];
  let skipped = 0;
  const recordRe = /<Record\b([^>]*)\/?>/g;
  let match: RegExpExecArray | null;
  while ((match = recordRe.exec(text))) {
    const attrs = xmlAttrs(match[1]);
    const type = String(attrs.type || '').replace(/^HK(?:Quantity|Category)TypeIdentifier/, '');
    const value = toNumber(attrs.value);
    const start = parseDateValue(attrs.startDate);
    const end = parseDateValue(attrs.endDate);
    const date = end ? toHealthDateKey(end) : start ? toHealthDateKey(start) : dateKeyFrom(attrs.creationDate);
    const base = { date, timestamp: end?.getTime() || start?.getTime(), startAt: start?.getTime(), endAt: end?.getTime(), metadata: { appleType: attrs.type, sourceName: attrs.sourceName } };
    if (type === 'StepCount' && value !== undefined) samples.push({ ...base, metric: 'steps', value, unit: '步' });
    else if (type === 'DistanceWalkingRunning' && value !== undefined) samples.push({ ...base, metric: 'distanceKm', value: attrs.unit === 'm' ? value / 1000 : value, unit: 'km' });
    else if (type === 'ActiveEnergyBurned' && value !== undefined) samples.push({ ...base, metric: 'calories', value, unit: attrs.unit || 'kcal' });
    else if (type === 'HeartRate' && value !== undefined) samples.push({ ...base, metric: 'heartRate', value, unit: 'bpm' });
    else if (type === 'RestingHeartRate' && value !== undefined) samples.push({ ...base, metric: 'restingHeartRate', value, unit: 'bpm' });
    else if (type === 'HeartRateVariabilitySDNN' && value !== undefined) samples.push({ ...base, metric: 'hrv', value, unit: 'ms' });
    else if (type === 'OxygenSaturation' && value !== undefined) samples.push({ ...base, metric: 'spo2', value: value <= 1.5 ? value * 100 : value, unit: '%' });
    else if (type === 'SleepAnalysis' && start && end && /Asleep|InBed/.test(String(attrs.value || ''))) {
      samples.push({
        ...base,
        metric: 'sleep',
        value: Math.max(1, Math.round((end.getTime() - start.getTime()) / MINUTE)),
        unit: '分钟',
        label: '睡眠',
        metadata: { ...base.metadata, sleepStage: attrs.value },
      });
    } else {
      skipped += 1;
    }
  }
  return { samples, skipped };
};

const aggregateSamples = (samples: MetricSample[], source: HealthImportSource, now: number): HealthRecord[] => {
  const byDate = new Map<string, MetricSample[]>();
  samples.forEach(sample => {
    if (!sample.date || !Number.isFinite(sample.value)) return;
    byDate.set(sample.date, [...(byDate.get(sample.date) || []), sample]);
  });
  const records: HealthRecord[] = [];
  byDate.forEach((rows, date) => {
    const steps = rows.filter(row => row.metric === 'steps');
    const distance = rows.filter(row => row.metric === 'distanceKm');
    const calories = rows.filter(row => row.metric === 'calories');
    if (steps.length || distance.length || calories.length) {
      const stepTotal = Math.round(steps.reduce((sum, row) => sum + row.value, 0));
      const distanceKm = Number(distance.reduce((sum, row) => sum + row.value, 0).toFixed(2));
      const calorieTotal = Math.round(calories.reduce((sum, row) => sum + row.value, 0));
      records.push(makeHealthRecord({
        id: stableRecordId(source, 'movement', date),
        moduleId: 'movement',
        date,
        timeHHmm: timeHHmmFromMs(Math.max(...rows.map(row => row.timestamp || row.endAt || row.startAt || 0))),
        value: stepTotal || distanceKm || calorieTotal,
        unit: stepTotal ? '步' : distanceKm ? 'km' : 'kcal',
        label: stepTotal ? '手环步数' : distanceKm ? '手环距离' : '手环热量',
        tags: ['手环导入', stepTotal ? '步数' : distanceKm ? '距离' : '卡路里'],
        source: 'wearable_import',
        metadata: { importSource: source, metric: 'movement', steps: stepTotal || undefined, distanceKm: distanceKm || undefined, calories: calorieTotal || undefined },
        createdAt: now,
      }, now));
    }

    const sleep = rows.filter(row => row.metric === 'sleep');
    if (sleep.length) {
      const minutes = Math.round(sleep.reduce((sum, row) => sum + row.value, 0));
      const starts = sleep.map(row => row.startAt).filter((value): value is number => !!value);
      const ends = sleep.map(row => row.endAt).filter((value): value is number => !!value);
      records.push(makeHealthRecord({
        id: stableRecordId(source, 'sleep', date),
        moduleId: 'sleep',
        date,
        timeHHmm: timeHHmmFromMs(ends.length ? Math.max(...ends) : sleep[0]?.timestamp),
        value: Number((minutes / 60).toFixed(2)),
        unit: '小时',
        label: '手环睡眠',
        tags: ['手环导入', '睡眠'],
        source: 'wearable_import',
        metadata: {
          importSource: source,
          metric: 'sleep',
          sleepMinutes: minutes,
          asleepAt: starts.length ? Math.min(...starts) : undefined,
          awakeAt: ends.length ? Math.max(...ends) : undefined,
          stages: sleep.map(row => row.metadata?.sleepStage).filter(Boolean),
        },
        createdAt: now,
      }, now));
    }

    (['heartRate', 'restingHeartRate', 'hrv', 'spo2', 'stress'] as MetricKey[]).forEach(metric => {
      const metricRows = rows.filter(row => row.metric === metric);
      if (!metricRows.length) return;
      const avg = metricRows.reduce((sum, row) => sum + row.value, 0) / metricRows.length;
      const meta: Record<MetricKey, { label: string; unit: string; tag: string }> = {
        steps: { label: '步数', unit: '步', tag: '步数' },
        distanceKm: { label: '距离', unit: 'km', tag: '距离' },
        calories: { label: '卡路里', unit: 'kcal', tag: '卡路里' },
        sleep: { label: '睡眠', unit: '小时', tag: '睡眠' },
        heartRate: { label: '心率', unit: 'bpm', tag: '心率' },
        restingHeartRate: { label: '静息心率', unit: 'bpm', tag: '静息心率' },
        hrv: { label: 'HRV', unit: 'ms', tag: 'HRV' },
        spo2: { label: '血氧', unit: '%', tag: '血氧' },
        stress: { label: '压力', unit: '分', tag: '压力' },
      };
      const spec = meta[metric];
      records.push(makeHealthRecord({
        id: stableRecordId(source, metric, date),
        moduleId: 'vitals',
        date,
        timeHHmm: timeHHmmFromMs(Math.max(...metricRows.map(row => row.timestamp || row.endAt || row.startAt || 0))),
        value: Number(avg.toFixed(1)),
        unit: spec.unit,
        label: spec.label,
        tags: ['手环导入', spec.tag],
        source: 'wearable_import',
        metadata: {
          importSource: source,
          metric,
          samples: metricRows.length,
          min: Math.min(...metricRows.map(row => row.value)),
          max: Math.max(...metricRows.map(row => row.value)),
        },
        createdAt: now,
      }, now));
    });
  });
  return records.sort((a, b) => b.date.localeCompare(a.date) || (a.timeHHmm || '').localeCompare(b.timeHHmm || ''));
};

const previewFromSamples = (params: {
  fileName: string;
  source: HealthImportSource;
  samples: MetricSample[];
  headers?: string[];
  mappedFields?: Record<string, HealthImportFieldKey>;
  skipped?: number;
  warnings?: string[];
  now: number;
}): HealthImportPreview => {
  const headers = params.headers || [];
  const mappedFields = params.mappedFields || {};
  return {
    source: params.source,
    fileName: params.fileName,
    records: aggregateSamples(params.samples, params.source, params.now),
    parsedCount: params.samples.length,
    skippedCount: params.skipped || 0,
    warnings: params.warnings || [],
    headers,
    mappedFields,
    unmappedHeaders: headers.filter(header => !mappedFields[header]),
  };
};

export async function parseHealthImportText(fileName: string, text: string, options: HealthImportParseOptions = {}): Promise<HealthImportPreview> {
  const now = options.now ?? Date.now();
  const lower = fileName.toLowerCase();
  const source = sourceFromPreset(options.preset) || guessSource(fileName, text);
  const warnings: string[] = [];
  try {
    if (lower.endsWith('.xml') || text.trim().startsWith('<')) {
      const apple = parseAppleXmlSamples(text);
      if (apple.samples.length === 0) warnings.push('没有识别到 Apple Health 或通用 XML 健康记录。');
      return previewFromSamples({ fileName, source: source === 'generic' ? 'apple_health' : source, samples: apple.samples, skipped: apple.skipped, warnings, now });
    }
    if (lower.endsWith('.json') || /^[\s\r\n]*[\[{]/.test(text)) {
      const parsed = parseJsonSamples(text, options.mapping);
      if (!parsed.samples.length) warnings.push('没有识别到可导入的 JSON 健康字段。');
      return previewFromSamples({ fileName, source, samples: parsed.samples, headers: parsed.headers, mappedFields: parsed.mappedFields, skipped: parsed.skipped, warnings, now });
    }
    const parsed = parseDelimitedSamples(text, options.mapping);
    if (!parsed.samples.length) warnings.push('没有识别到可导入的 CSV 健康字段，可尝试手动映射列名。');
    return previewFromSamples({ fileName, source, samples: parsed.samples, headers: parsed.headers, mappedFields: parsed.mappedFields, skipped: parsed.skipped, warnings, now });
  } catch (err: any) {
    return previewFromSamples({
      fileName,
      source,
      samples: [],
      skipped: 1,
      warnings: [err?.message || '文件解析失败。'],
      now,
    });
  }
}

export async function parseHealthImportFile(file: File | Blob, options: HealthImportParseOptions = {}): Promise<HealthImportPreview> {
  const fileName = fileNameOf(file);
  const lower = fileName.toLowerCase();
  const now = options.now ?? Date.now();
  if (lower.endsWith('.zip') || (file as File).type === 'application/zip') {
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const previews: HealthImportPreview[] = [];
    const warnings: string[] = [];
    const entries = Object.values(zip.files).filter(entry => !entry.dir);
    for (const entry of entries) {
      const name = entry.name;
      const entryLower = name.toLowerCase();
      if (!/\.(csv|json|xml|txt)$/.test(entryLower)) {
        warnings.push(`已跳过不支持的文件：${name}`);
        continue;
      }
      const text = await entry.async('string');
      previews.push(await parseHealthImportText(name, text, { ...options, now }));
    }
    if (!previews.length) {
      return previewFromSamples({ fileName, source: sourceFromPreset(options.preset) || guessSource(fileName), samples: [], skipped: entries.length, warnings: ['压缩包里没有可识别的 CSV / JSON / XML 健康文件。', ...warnings], now });
    }
    const source = sourceFromPreset(options.preset) || previews.find(p => p.source !== 'generic')?.source || guessSource(fileName);
    const records = previews.flatMap(preview => preview.records);
    const dedup = new Map<string, HealthRecord>();
    records.forEach(record => dedup.set(record.id, record));
    return {
      source,
      fileName,
      records: Array.from(dedup.values()).sort((a, b) => b.date.localeCompare(a.date)),
      parsedCount: previews.reduce((sum, preview) => sum + preview.parsedCount, 0),
      skippedCount: previews.reduce((sum, preview) => sum + preview.skippedCount, 0),
      warnings: [...warnings, ...previews.flatMap(preview => preview.warnings)].slice(0, 30),
      headers: Array.from(new Set(previews.flatMap(preview => preview.headers))).slice(0, 80),
      mappedFields: Object.assign({}, ...previews.map(preview => preview.mappedFields)),
      unmappedHeaders: Array.from(new Set(previews.flatMap(preview => preview.unmappedHeaders))).slice(0, 80),
    };
  }
  return parseHealthImportText(fileName, await readTextFile(file), options);
}

export function makeHealthImportBatch(input: Partial<HealthImportBatch> & Pick<HealthImportBatch, 'source' | 'mode'>, now = Date.now()): HealthImportBatch {
  return {
    id: input.id || `health_import_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    source: input.source,
    mode: input.mode,
    fileName: input.fileName,
    deviceName: input.deviceName,
    importedCount: Math.max(0, Math.round(Number(input.importedCount) || 0)),
    updatedCount: Math.max(0, Math.round(Number(input.updatedCount) || 0)),
    skippedCount: Math.max(0, Math.round(Number(input.skippedCount) || 0)),
    warnings: (input.warnings || []).map(item => String(item)).filter(Boolean).slice(0, 40),
    recordIds: Array.from(new Set(input.recordIds || [])),
    createdAt: input.createdAt || now,
    updatedAt: now,
  };
}

export function parseBleHeartRateMeasurement(value: DataView): number {
  const flags = value.getUint8(0);
  return (flags & 0x01) ? value.getUint16(1, true) : value.getUint8(1);
}

export function makeRealtimeHeartRateRecord(params: {
  heartRate: number;
  deviceName?: string;
  now?: number;
}): HealthRecord {
  const now = params.now ?? Date.now();
  const date = toHealthDateKey(new Date(now));
  const minuteBucket = Math.floor(now / 60_000);
  return makeHealthRecord({
    id: stableRecordId('web_bluetooth', 'heartRateRealtime', date, String(minuteBucket)),
    moduleId: 'vitals',
    date,
    timeHHmm: timeHHmmFromMs(now),
    value: params.heartRate,
    unit: 'bpm',
    label: '实时心率',
    tags: ['实时同步', '心率'],
    source: 'wearable_realtime',
    metadata: {
      importSource: 'web_bluetooth',
      protocol: 'web_bluetooth',
      metric: 'heartRate',
      deviceName: params.deviceName,
      realtime: true,
    },
    createdAt: now,
  }, now);
}
