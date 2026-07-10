import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  makeRealtimeHeartRateRecord,
  parseBleHeartRateMeasurement,
  parseHealthImportFile,
  parseHealthImportText,
} from './healthImport';

const at = (year: number, month: number, day: number, hour = 0, minute = 0) =>
  new Date(year, month - 1, day, hour, minute, 0, 0).getTime();

const namedBlob = (name: string, data: BlobPart[], type = 'application/octet-stream'): File => {
  const blob = new Blob(data, { type }) as Blob & { name: string };
  Object.defineProperty(blob, 'name', { value: name });
  return blob as File;
};

describe('health wearable import utilities', () => {
  it('imports generic CSV rows with Chinese headers', async () => {
    const csv = '日期,步数,睡眠分钟,心率\n2026-07-01,8000,420,72';
    const preview = await parseHealthImportText('daily.csv', csv, { now: at(2026, 7, 1, 10) });

    expect(preview.records.map(record => record.moduleId).sort()).toEqual(['movement', 'sleep', 'vitals']);
    expect(preview.records.find(record => record.moduleId === 'movement')?.value).toBe(8000);
    expect(preview.records.find(record => record.moduleId === 'sleep')?.value).toBe(7);
    expect(preview.records.find(record => record.label === '心率')?.value).toBe(72);
  });

  it('imports nested JSON records', async () => {
    const json = JSON.stringify({
      records: [
        { date: '2026-07-02', steps: 3200, hrv: 46 },
      ],
    });
    const preview = await parseHealthImportText('google-fit.json', json, { now: at(2026, 7, 2, 10) });

    expect(preview.records.some(record => record.moduleId === 'movement' && record.value === 3200)).toBe(true);
    expect(preview.records.some(record => record.moduleId === 'vitals' && record.label === 'HRV')).toBe(true);
  });

  it('imports Garmin Connect CSV daily summaries', async () => {
    const csv = [
      'calendarDate,steps,distanceInMeters,activeKilocalories,restingHeartRateInBeatsPerMinute,averageStressLevel,averageSpo2',
      '2026-07-06,7654,5400,360,58,32,97',
    ].join('\n');
    const preview = await parseHealthImportText('garmin-connect-daily.csv', csv, { now: at(2026, 7, 6, 10) });

    expect(preview.source).toBe('garmin');
    const movement = preview.records.find(record => record.moduleId === 'movement');
    expect(movement?.value).toBe(7654);
    expect(movement?.metadata?.distanceKm).toBe(5.4);
    expect(preview.records.some(record => record.moduleId === 'vitals' && record.label === '静息心率' && record.value === 58)).toBe(true);
    expect(preview.records.some(record => record.moduleId === 'vitals' && record.label === '压力' && record.value === 32)).toBe(true);
    expect(preview.records.some(record => record.moduleId === 'vitals' && record.label === '血氧' && record.value === 97)).toBe(true);
  });

  it('imports Garmin Health API style nested JSON and files sleep by awake date', async () => {
    const json = JSON.stringify({
      dailies: [
        { summaryId: 'daily-1', calendarDate: '2026-07-06', steps: 4321, distanceInMeters: 3100 },
      ],
      sleepSummaries: [
        {
          summaryId: 'sleep-1',
          calendarDate: '2026-07-07',
          startTimeInSeconds: Math.floor(at(2026, 7, 6, 23, 30) / 1000),
          durationInSeconds: 7 * 60 * 60,
          awakeDurationInSeconds: 15 * 60,
          deepSleepDurationInSeconds: 80 * 60,
          lightSleepDurationInSeconds: 240 * 60,
          remSleepInSeconds: 85 * 60,
        },
      ],
    });
    const preview = await parseHealthImportText('garmin-health-api.json', json, { now: at(2026, 7, 7, 10) });

    expect(preview.source).toBe('garmin');
    expect(preview.records.some(record => record.moduleId === 'movement' && record.date === '2026-07-06' && record.value === 4321)).toBe(true);
    const sleep = preview.records.find(record => record.moduleId === 'sleep');
    expect(sleep?.date).toBe('2026-07-07');
    expect(sleep?.value).toBe(6.75);
    expect(sleep?.metadata?.deepSleepSeconds).toBe(80 * 60);
  });

  it('imports Apple Health XML including cross-day sleep by awake date', async () => {
    const xml = `
      <HealthData>
        <Record type="HKQuantityTypeIdentifierStepCount" startDate="2026-07-01T08:00:00" endDate="2026-07-01T08:30:00" value="1200" unit="count" sourceName="Apple Watch"/>
        <Record type="HKQuantityTypeIdentifierHeartRate" startDate="2026-07-01T09:00:00" endDate="2026-07-01T09:05:00" value="76" unit="count/min" sourceName="Apple Watch"/>
        <Record type="HKQuantityTypeIdentifierHeartRateVariabilitySDNN" startDate="2026-07-01T09:00:00" endDate="2026-07-01T09:05:00" value="52" unit="ms" sourceName="Apple Watch"/>
        <Record type="HKCategoryTypeIdentifierSleepAnalysis" startDate="2026-07-01T23:00:00" endDate="2026-07-02T06:00:00" value="HKCategoryValueSleepAnalysisAsleep" sourceName="Apple Watch"/>
      </HealthData>
    `;
    const preview = await parseHealthImportText('export.xml', xml, { now: at(2026, 7, 2, 10) });

    expect(preview.source).toBe('apple_health');
    expect(preview.records.some(record => record.moduleId === 'movement' && record.date === '2026-07-01')).toBe(true);
    expect(preview.records.some(record => record.moduleId === 'vitals' && record.label === 'HRV')).toBe(true);
    const sleep = preview.records.find(record => record.moduleId === 'sleep');
    expect(sleep?.date).toBe('2026-07-02');
    expect(sleep?.value).toBe(7);
  });

  it('imports supported files from ZIP and warns about unsupported entries', async () => {
    const zip = new JSZip();
    zip.file('daily.csv', 'date,steps,heartRate\n2026-07-03,5000,70');
    zip.file('readme.md', '# not health data');
    const buffer = await zip.generateAsync({ type: 'arraybuffer' });
    const preview = await parseHealthImportFile(namedBlob('takeout.zip', [buffer], 'application/zip'), { now: at(2026, 7, 3, 10) });

    expect(preview.records.length).toBeGreaterThan(0);
    expect(preview.warnings.some(warning => warning.includes('readme.md'))).toBe(true);
  });

  it('uses stable IDs for repeated imports of the same source and day', async () => {
    const csv = 'date,steps\n2026-07-04,6000';
    const first = await parseHealthImportText('mi-band.csv', csv, { preset: 'xiaomi', now: at(2026, 7, 4, 10) });
    const second = await parseHealthImportText('mi-band.csv', csv, { preset: 'xiaomi', now: at(2026, 7, 4, 12) });

    expect(first.records.map(record => record.id)).toEqual(second.records.map(record => record.id));
  });

  it('reports Garmin FIT files as recognized but unsupported', async () => {
    const preview = await parseHealthImportFile(namedBlob('garmin-monitoring.fit', [new Uint8Array([14, 0x10, 0])]), { now: at(2026, 7, 4, 10) });

    expect(preview.source).toBe('garmin');
    expect(preview.records).toHaveLength(0);
    expect(preview.warnings.some(warning => warning.includes('FIT'))).toBe(true);
  });

  it('decodes realtime BLE heart rate measurements', () => {
    const oneByte = new DataView(Uint8Array.from([0, 72]).buffer);
    const twoByte = new DataView(Uint8Array.from([1, 0x2c, 0x01]).buffer);

    expect(parseBleHeartRateMeasurement(oneByte)).toBe(72);
    expect(parseBleHeartRateMeasurement(twoByte)).toBe(300);

    const record = makeRealtimeHeartRateRecord({
      heartRate: 72,
      deviceName: 'Band',
      manufacturer: 'Garmin',
      model: 'Forerunner',
      batteryLevel: 88,
      devicePreset: 'garmin',
      now: at(2026, 7, 5, 9, 30),
    });
    expect(record.source).toBe('wearable_realtime');
    expect(record.moduleId).toBe('vitals');
    expect(record.metadata?.deviceName).toBe('Band');
    expect(record.metadata?.manufacturer).toBe('Garmin');
    expect(record.metadata?.batteryLevel).toBe(88);
  });
});
