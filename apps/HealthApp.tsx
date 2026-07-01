import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Bell,
  CalendarBlank,
  ChartLineUp,
  Check,
  Drop,
  FirstAidKit,
  Heart,
  LockKey,
  Moon,
  Notebook,
  PersonSimpleWalk,
  Pill,
  Plus,
  ShieldCheck,
  Smiley,
  Sparkle,
  ThermometerSimple,
  Trash,
} from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { AppID } from '../types';
import type {
  HealthModuleId,
  HealthModuleSettings,
  HealthPrivacyMode,
  HealthRecord,
  HealthReminder,
  HealthReminderChannel,
  HealthReminderFrequency,
  PeriodCycleEvent,
  PeriodReminderNotifyChannel,
  PeriodReminderSettings,
  Tracker,
  TrackerEntry,
} from '../types';
import {
  HEALTH_MODULE_LABEL,
  HEALTH_MODULES,
  HEALTH_REMINDERS_UPDATED_EVENT,
  HEALTH_SUMMARY_REQUEST_EVENT,
  HEALTH_UPDATED_EVENT,
  buildPeriodModuleSettingsFromLegacy,
  computeHealthGoalProgress,
  healthPrivacyAllowsReminder,
  healthPrivacyAllowsSummary,
  makeHealthPlan,
  makeHealthRecord,
  mergeHealthModuleSettings,
  normalizeHealthReminder,
  periodEventsToHealthRecords,
  prepareHealthModuleSettings,
  summarizeHealthDay,
  toHealthDateKey,
} from '../utils/health';
import {
  PERIOD_CYCLE_LENGTH_DEFAULT,
  PERIOD_CYCLE_LENGTH_MAX,
  PERIOD_CYCLE_LENGTH_MIN,
  PERIOD_LENGTH_DEFAULT,
  PERIOD_LENGTH_MAX,
  PERIOD_LENGTH_MIN,
  addDaysToDateKey,
  makeDefaultPeriodReminderSettings,
  normalizePeriodCycleLength,
  normalizePeriodDate,
  normalizePeriodLength,
  normalizePeriodOffsets,
  normalizePeriodTime,
  periodReminderBody,
  predictNextPeriodStart,
  preparePeriodReminderSettings,
} from '../utils/periodReminders';
import { getNotifyPermission, requestNotifyPermission, showLocalNotification, type NotifyPermission } from '../utils/browserNotify';
import { scrollToManualAnchor, useManualDeepLink } from '../utils/manualDeepLink';

type ViewId = 'today' | 'calendar' | 'trends' | 'reminders' | 'privacy';
type PeriodNumberField = 'cycleLength' | 'periodLength';

const pad = (n: number) => String(n).padStart(2, '0');
const todayKey = () => toHealthDateKey(new Date());

const notifyPeriodReminderUpdated = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('period-reminders-updated'));
};

const notifyHealthUpdated = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(HEALTH_UPDATED_EVENT));
};

const notifyHealthRemindersUpdated = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(HEALTH_REMINDERS_UPDATED_EVENT));
};

const offsetLabel = (offset: number) => {
  if (offset === 0) return '当天';
  return offset < 0 ? `提前 ${Math.abs(offset)} 天` : `之后 ${offset} 天`;
};

const privacyLabel: Record<HealthPrivacyMode, string> = {
  private: '私密',
  summary: '摘要给角色',
  reminder: '提醒给角色',
  summary_reminder: '摘要+提醒',
};

const channelLabel: Record<HealthReminderChannel, string> = {
  system: '系统',
  character: '角色',
  both: '两者',
};

const legacyChannelLabel: Record<PeriodReminderNotifyChannel, string> = {
  system: '系统通知',
  character: '角色提醒',
  both: '两者都要',
};

const periodNumberLimits: Record<PeriodNumberField, {
  min: number;
  max: number;
  normalize: (value: unknown) => number;
}> = {
  cycleLength: { min: PERIOD_CYCLE_LENGTH_MIN, max: PERIOD_CYCLE_LENGTH_MAX, normalize: normalizePeriodCycleLength },
  periodLength: { min: PERIOD_LENGTH_MIN, max: PERIOD_LENGTH_MAX, normalize: normalizePeriodLength },
};

const periodNumberDraftFromSettings = (settings: Pick<PeriodReminderSettings, 'cycleLength' | 'periodLength'>) => ({
  cycleLength: String(settings.cycleLength),
  periodLength: String(settings.periodLength),
});

const sanitizePeriodNumberDraft = (value: string) => value.replace(/[^\d]/g, '').slice(0, 3);

const validPeriodNumberDraft = (field: PeriodNumberField, raw: string): number | null => {
  if (!raw.trim()) return null;
  const value = Number(raw);
  const { min, max } = periodNumberLimits[field];
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded >= min && rounded <= max ? rounded : null;
};

const moduleIcon: Record<HealthModuleId, React.ReactNode> = {
  period: <Heart size={18} weight="fill" />,
  sleep: <Moon size={18} weight="fill" />,
  hydration: <Drop size={18} weight="fill" />,
  medication: <Pill size={18} weight="fill" />,
  symptom: <ThermometerSimple size={18} weight="fill" />,
  mood: <Smiley size={18} weight="fill" />,
  movement: <PersonSimpleWalk size={18} weight="fill" />,
};

const findPeriodTracker = (trackers: Tracker[]) => (
  trackers.find(t => t.name === '经期' || t.id.includes('cycle') || t.schema.some(field => field.key === 'flow'))
);

const inferLastStartDate = (events: PeriodCycleEvent[], trackerEntries: TrackerEntry[]): string => {
  const eventDate = events
    .filter(event => event.kind === 'start' && normalizePeriodDate(event.date))
    .sort((a, b) => b.date.localeCompare(a.date))[0]?.date;
  if (eventDate) return eventDate;

  return trackerEntries
    .filter(entry => normalizePeriodDate(entry.date) && entry.values?.flow === 'start')
    .sort((a, b) => b.date.localeCompare(a.date))[0]?.date || '';
};

const formatShortDate = (date: string) => date.slice(5).replace('-', '/');

const lastNDates = (count: number) => {
  const out: string[] = [];
  const base = new Date();
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - i);
    out.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  }
  return out;
};

const emptyForm = {
  moduleId: 'hydration' as HealthModuleId,
  date: todayKey(),
  timeHHmm: normalizePeriodTime(`${new Date().getHours()}:${new Date().getMinutes()}`),
  value: '',
  unit: 'ml',
  label: '',
  tags: '',
  note: '',
};

const HealthApp: React.FC = () => {
  const { closeApp, characters, addToast } = useOS();
  const [activeView, setActiveView] = useState<ViewId>('today');
  const [activeModule, setActiveModule] = useState<HealthModuleId>('hydration');
  const [moduleSettings, setModuleSettings] = useState<HealthModuleSettings[]>(() => mergeHealthModuleSettings([]));
  const [records, setRecords] = useState<HealthRecord[]>([]);
  const [reminders, setReminders] = useState<HealthReminder[]>([]);
  const [periodSettings, setPeriodSettings] = useState<PeriodReminderSettings>(() => makeDefaultPeriodReminderSettings());
  const [periodNumberDraft, setPeriodNumberDraft] = useState(() => ({
    cycleLength: String(PERIOD_CYCLE_LENGTH_DEFAULT),
    periodLength: String(PERIOD_LENGTH_DEFAULT),
  }));
  const [periodEvents, setPeriodEvents] = useState<PeriodCycleEvent[]>([]);
  const [trackers, setTrackers] = useState<Tracker[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notifyPerm, setNotifyPerm] = useState<NotifyPermission>(() => getNotifyPermission());
  const [authorizingNotify, setAuthorizingNotify] = useState(false);
  const [calendarDate, setCalendarDate] = useState(todayKey());
  const [recordForm, setRecordForm] = useState(emptyForm);
  const [reminderForm, setReminderForm] = useState({
    moduleId: 'hydration' as HealthModuleId,
    title: '喝水提醒',
    body: '喝点水，顺手记一笔。',
    timeHHmm: '10:30',
    frequency: 'daily' as HealthReminderFrequency,
  });

  const periodTracker = useMemo(() => findPeriodTracker(trackers), [trackers]);
  const today = todayKey();
  const todayRecords = useMemo(() => records.filter(record => record.date === today), [records, today]);
  const selectedDateRecords = useMemo(() => records.filter(record => record.date === calendarDate), [records, calendarDate]);
  const selectedModuleRecords = useMemo(() => records.filter(record => record.moduleId === activeModule), [records, activeModule]);
  const selectedModuleSettings = useMemo(
    () => moduleSettings.find(item => item.id === activeModule) || prepareHealthModuleSettings({ id: activeModule }),
    [activeModule, moduleSettings],
  );
  const predictedStart = useMemo(
    () => predictNextPeriodStart(periodSettings.lastStartDate, periodSettings.cycleLength),
    [periodSettings.cycleLength, periodSettings.lastStartDate],
  );
  const predictedEnd = predictedStart ? addDaysToDateKey(predictedStart, periodSettings.periodLength - 1) : '';
  const reminderChips = useMemo(() => normalizePeriodOffsets(periodSettings.remindOffsets), [periodSettings.remindOffsets]);
  const daySummary = useMemo(() => summarizeHealthDay(todayRecords, today), [todayRecords, today]);
  const summaryAuthorizedCount = useMemo(
    () => moduleSettings.filter(item => item.enabled && healthPrivacyAllowsSummary(item.privacy) && item.charIds.length > 0).length,
    [moduleSettings],
  );
  const nextReminder = useMemo(() => {
    const generic = reminders.filter(item => item.enabled && item.nextAt > 0);
    const all = [
      ...generic.map(item => ({ at: item.nextAt, label: item.title, body: item.body || HEALTH_MODULE_LABEL[item.moduleId] })),
      ...(periodSettings.enabled && periodSettings.nextAt ? [{ at: periodSettings.nextAt, label: '经期提醒', body: periodReminderBody(periodSettings, periodSettings.nextAt) }] : []),
    ].sort((a, b) => a.at - b.at);
    return all[0];
  }, [periodSettings, reminders]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [
        storedModuleSettings,
        storedRecords,
        storedReminders,
        storedPeriod,
        storedEvents,
        storedTrackers,
        storedPlans,
      ] = await Promise.all([
        DB.getAllHealthModuleSettings().catch(() => []),
        DB.getAllHealthRecords().catch(() => []),
        DB.getAllHealthReminders().catch(() => []),
        DB.getPeriodReminderSettings().catch(() => null),
        DB.getAllPeriodCycleEvents().catch(() => []),
        DB.getAllTrackers().catch(() => []),
        DB.getAllHealthPlans().catch(() => []),
      ]);
      const tracker = findPeriodTracker(storedTrackers);
      const trackerEntries = tracker ? await DB.getTrackerEntriesByTracker(tracker.id).catch(() => []) : [];
      const inferredStart = !storedPeriod?.lastStartDate ? inferLastStartDate(storedEvents, trackerEntries) : '';
      const preparedPeriod = preparePeriodReminderSettings({
        ...(storedPeriod || makeDefaultPeriodReminderSettings()),
        ...(inferredStart ? { lastStartDate: inferredStart } : {}),
      }, Date.now());

      const existingIds = new Set(storedRecords.map(record => record.metadata?.periodEventId).filter(Boolean));
      const migratedRecords = periodEventsToHealthRecords(storedEvents.filter(event => !existingIds.has(event.id)));
      if (migratedRecords.length) {
        await Promise.all(migratedRecords.map(record => DB.saveHealthRecord(record).catch(() => {})));
      }

      let mergedModules = mergeHealthModuleSettings(storedModuleSettings);
      if (!storedModuleSettings.some(item => item.id === 'period') && (storedPeriod || storedEvents.length)) {
        const periodModule = buildPeriodModuleSettingsFromLegacy(preparedPeriod);
        mergedModules = mergedModules.map(item => item.id === 'period' ? periodModule : item);
      }
      if (storedModuleSettings.length === 0) {
        await DB.saveHealthModuleSettingsMany(mergedModules).catch(() => {});
      }
      if (!storedPlans.length) {
        const defaultPlans = mergedModules
          .filter(item => item.goals?.target)
          .map(item => makeHealthPlan({
            id: `health_plan_${item.id}`,
            moduleId: item.id,
            target: item.goals?.target,
            unit: item.goals?.unit || '次',
            privacy: item.privacy,
            charIds: item.charIds,
          }));
        await Promise.all(defaultPlans.map(plan => DB.saveHealthPlan(plan).catch(() => {})));
      }

      setModuleSettings(mergedModules);
      setRecords([...storedRecords, ...migratedRecords].sort((a, b) => b.date.localeCompare(a.date)));
      setReminders(storedReminders);
      setPeriodSettings(preparedPeriod);
      setPeriodEvents(storedEvents);
      setTrackers(storedTrackers);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPeriodNumberDraft(periodNumberDraftFromSettings(periodSettings));
  }, [periodSettings.cycleLength, periodSettings.periodLength]);

  useEffect(() => {
    const refresh = () => setNotifyPerm(getNotifyPermission());
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  useManualDeepLink(AppID.Health, useCallback((target) => {
    window.setTimeout(() => {
      if (!scrollToManualAnchor(target.anchorId)) scrollToManualAnchor('manual-health-root');
    }, 120);
  }, []));

  const patchPeriodSettings = (patch: Partial<PeriodReminderSettings>) => {
    setPeriodSettings(prev => preparePeriodReminderSettings({ ...prev, ...patch }, Date.now()));
  };

  const patchPeriodNumberSetting = (field: PeriodNumberField, value: number) => {
    patchPeriodSettings(field === 'cycleLength' ? { cycleLength: value } : { periodLength: value });
  };

  const normalizePeriodNumberDraft = (field: PeriodNumberField, settings = periodSettings) => {
    const raw = periodNumberDraft[field].trim();
    if (!raw) return settings[field];
    return periodNumberLimits[field].normalize(raw);
  };

  const patchPeriodNumberDraft = (field: PeriodNumberField, rawValue: string) => {
    const value = sanitizePeriodNumberDraft(rawValue);
    setPeriodNumberDraft(prev => ({ ...prev, [field]: value }));
    const validValue = validPeriodNumberDraft(field, value);
    if (validValue !== null) {
      patchPeriodNumberSetting(field, validValue);
    }
  };

  const commitPeriodNumberDraft = (field: PeriodNumberField) => {
    const value = normalizePeriodNumberDraft(field);
    setPeriodNumberDraft(prev => ({ ...prev, [field]: String(value) }));
    patchPeriodNumberSetting(field, value);
  };

  const savePeriodSettings = async (next = periodSettings) => {
    setSaving(true);
    try {
      const prepared = preparePeriodReminderSettings({
        ...next,
        cycleLength: normalizePeriodNumberDraft('cycleLength', next),
        periodLength: normalizePeriodNumberDraft('periodLength', next),
      }, Date.now());
      await DB.savePeriodReminderSettings(prepared);
      setPeriodSettings(prepared);
      setPeriodNumberDraft(periodNumberDraftFromSettings(prepared));
      const privacy: HealthPrivacyMode = prepared.visibility === 'public'
        ? prepared.notifyChannel === 'character' ? 'reminder' : 'summary_reminder'
        : 'private';
      const periodModule = prepareHealthModuleSettings({
        ...(moduleSettings.find(item => item.id === 'period') || { id: 'period' as HealthModuleId }),
        enabled: prepared.enabled,
        privacy,
        reminderChannel: prepared.notifyChannel,
        charIds: prepared.charIds,
      });
      await saveModuleSettings(periodModule, false);
      notifyPeriodReminderUpdated();
      addToast('经期提醒已保存', 'success');
      if (prepared.enabled && getNotifyPermission() === 'default') {
        addToast('还需要授权通知，系统提醒才会弹出', 'info');
      }
    } catch (err: any) {
      addToast(err?.message || '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveModuleSettings = async (settings: HealthModuleSettings, toast = true) => {
    const prepared = prepareHealthModuleSettings(settings);
    await DB.saveHealthModuleSettings(prepared);
    setModuleSettings(prev => mergeHealthModuleSettings(prev.map(item => item.id === prepared.id ? prepared : item)));
    if (prepared.id === 'period') {
      const visibility = prepared.privacy === 'private' || prepared.privacy === 'summary' ? 'private' : 'public';
      const nextPeriod = preparePeriodReminderSettings({
        ...periodSettings,
        visibility,
        notifyChannel: visibility === 'private' ? 'system' : prepared.reminderChannel as PeriodReminderNotifyChannel,
        charIds: prepared.charIds,
      });
      await DB.savePeriodReminderSettings(nextPeriod);
      setPeriodSettings(nextPeriod);
      notifyPeriodReminderUpdated();
    }
    notifyHealthUpdated();
    if (toast) addToast('健康隐私设置已更新', 'success');
  };

  const handleRequestNotify = async () => {
    setAuthorizingNotify(true);
    try {
      const perm = await requestNotifyPermission();
      setNotifyPerm(perm);
      if (perm === 'granted') {
        const ok = await showLocalNotification('健康提醒已开启', {
          body: '到点后会像这样提醒你。',
          tag: 'health-reminder-permission-test',
          data: { source: 'health-reminder', type: 'health-reminder' },
        });
        addToast(ok ? '通知已授权，并发送了一条测试提醒' : '通知已授权，但系统没有弹出测试提醒', ok ? 'success' : 'info');
      } else if (perm === 'denied') {
        addToast('通知权限被拒绝，请到浏览器或手机系统设置里手动允许', 'error');
      } else if (perm === 'unsupported') {
        addToast('当前环境不支持系统通知', 'error');
      } else {
        addToast('还没有完成通知授权', 'info');
      }
    } catch (err: any) {
      addToast(err?.message || '通知授权失败', 'error');
    } finally {
      setAuthorizingNotify(false);
    }
  };

  const saveRecord = async (input: Partial<HealthRecord>) => {
    const record = makeHealthRecord(input);
    await DB.saveHealthRecord(record);
    setRecords(prev => [record, ...prev.filter(item => item.id !== record.id)].sort((a, b) => b.date.localeCompare(a.date)));
    const summary = summarizeHealthDay([record, ...records.filter(item => item.date === record.date)], record.date);
    await DB.saveHealthSummary(summary).catch(() => {});
    notifyHealthUpdated();
    addToast(`${HEALTH_MODULE_LABEL[record.moduleId]}已记录`, 'success');
  };

  const recordPeriodEvent = async (kind: PeriodCycleEvent['kind'], date = todayKey()) => {
    const normalizedDate = normalizePeriodDate(date) || todayKey();
    const now = Date.now();
    const event: PeriodCycleEvent = {
      id: `period_${kind}_${normalizedDate}_${now.toString(36)}`,
      kind,
      date: normalizedDate,
      createdAt: now,
      updatedAt: now,
    };
    await DB.savePeriodCycleEvent(event);
    setPeriodEvents(prev => [...prev, event].sort((a, b) => a.date.localeCompare(b.date)));

    let nextPeriod = periodSettings;
    if (kind === 'start') {
      nextPeriod = preparePeriodReminderSettings({ ...periodSettings, lastStartDate: normalizedDate, enabled: true }, now);
      await DB.savePeriodReminderSettings(nextPeriod);
      setPeriodSettings(nextPeriod);
    }

    const healthRecord = makeHealthRecord({
      moduleId: 'period',
      date: normalizedDate,
      label: kind === 'start' ? '开始' : '结束',
      tags: [kind === 'start' ? '经期开始' : '经期结束'],
      metadata: { periodEventId: event.id, kind },
      source: 'manual',
      createdAt: now,
      updatedAt: now,
    }, now);
    await DB.saveHealthRecord(healthRecord);
    setRecords(prev => [healthRecord, ...prev].sort((a, b) => b.date.localeCompare(a.date)));

    if (periodTracker) {
      const existing = await DB.getTrackerEntry(periodTracker.id, normalizedDate).catch(() => null);
      const entry: TrackerEntry = {
        id: existing?.id || `tracker-entry-${periodTracker.id}-${normalizedDate}`,
        trackerId: periodTracker.id,
        date: normalizedDate,
        values: { ...(existing?.values || {}), flow: kind === 'start' ? 'start' : 'end' },
        note: existing?.note,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };
      await DB.saveTrackerEntry(entry);
    }

    notifyPeriodReminderUpdated();
    notifyHealthUpdated();
    addToast(kind === 'start' ? '已记录今天开始' : '已记录今天结束', 'success');
  };

  const quickRecord = async (moduleId: HealthModuleId, value?: number, label?: string, unit?: string, tags: string[] = []) => {
    if (moduleId === 'period') {
      await recordPeriodEvent('start');
      return;
    }
    await saveRecord({
      moduleId,
      date: today,
      value,
      label,
      unit,
      tags,
      source: 'manual',
    });
  };

  const submitRecordForm = async () => {
    await saveRecord({
      moduleId: recordForm.moduleId,
      date: recordForm.date,
      timeHHmm: recordForm.timeHHmm,
      value: recordForm.value === '' ? undefined : Number(recordForm.value),
      unit: recordForm.unit,
      label: recordForm.label,
      tags: recordForm.tags.split(/[，,\s]+/).filter(Boolean),
      note: recordForm.note,
      source: 'manual',
    });
    setRecordForm(prev => ({ ...prev, value: '', label: '', tags: '', note: '' }));
  };

  const saveReminder = async () => {
    const moduleSetting = moduleSettings.find(item => item.id === reminderForm.moduleId);
    const reminder = normalizeHealthReminder({
      moduleId: reminderForm.moduleId,
      title: reminderForm.title,
      body: reminderForm.body,
      timeHHmm: reminderForm.timeHHmm,
      frequency: reminderForm.frequency,
      privacy: moduleSetting?.privacy || 'private',
      channel: moduleSetting?.reminderChannel || 'system',
      charIds: moduleSetting?.charIds || [],
    });
    await DB.saveHealthReminder(reminder);
    setReminders(prev => [reminder, ...prev.filter(item => item.id !== reminder.id)].sort((a, b) => a.nextAt - b.nextAt));
    notifyHealthRemindersUpdated();
    addToast('健康提醒已保存', 'success');
  };

  const requestHealthSummary = () => {
    if (!summaryAuthorizedCount) {
      addToast('还没有给任何模块授权摘要给角色', 'info');
      setActiveView('privacy');
      return;
    }
    window.dispatchEvent(new CustomEvent(HEALTH_SUMMARY_REQUEST_EVENT, { detail: { date: today } }));
    addToast('已请授权角色温柔复盘今天', 'success');
  };

  const toggleReminder = async (reminder: HealthReminder) => {
    const next = normalizeHealthReminder({ ...reminder, enabled: !reminder.enabled });
    await DB.saveHealthReminder(next);
    setReminders(prev => prev.map(item => item.id === next.id ? next : item));
    notifyHealthRemindersUpdated();
  };

  const deleteReminder = async (id: string) => {
    await DB.deleteHealthReminder(id);
    setReminders(prev => prev.filter(item => item.id !== id));
    notifyHealthRemindersUpdated();
    addToast('提醒已删除', 'success');
  };

  const togglePeriodOffset = (offset: number) => {
    const current = normalizePeriodOffsets(periodSettings.remindOffsets);
    const next = current.includes(offset) ? current.filter(v => v !== offset) : [...current, offset];
    patchPeriodSettings({ remindOffsets: next.length ? next : [0] });
  };

  const patchModulePrivacy = async (moduleId: HealthModuleId, patch: Partial<HealthModuleSettings>) => {
    const base = moduleSettings.find(item => item.id === moduleId) || prepareHealthModuleSettings({ id: moduleId });
    await saveModuleSettings({ ...base, ...patch });
  };

  const toggleModuleChar = async (moduleId: HealthModuleId, charId: string) => {
    const base = moduleSettings.find(item => item.id === moduleId) || prepareHealthModuleSettings({ id: moduleId });
    const set = new Set(base.charIds || []);
    if (set.has(charId)) set.delete(charId);
    else set.add(charId);
    await saveModuleSettings({ ...base, charIds: Array.from(set) });
  };

  const renderToday = () => (
    <div className="space-y-4">
      <section className="rounded-[8px] bg-white border border-[#dfe9e3] p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[12px] font-black text-[#6f8379]">
              <FirstAidKit size={16} weight="bold" />
              今日健康
            </div>
            <div className="mt-2 text-[24px] font-black leading-tight">本地健康中心</div>
            <div className="mt-1 text-[12px] font-bold text-[#789085] leading-relaxed">{daySummary.text}</div>
          </div>
          <button
            onClick={() => setActiveView('privacy')}
            className="w-10 h-10 rounded-[8px] bg-[#eef6f1] text-[#37694c] grid place-items-center"
            title="隐私授权"
          >
            <ShieldCheck size={20} weight="bold" />
          </button>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <StatMini label="今日记录" value={todayRecords.length || 0} />
          <StatMini label="已授权" value={moduleSettings.filter(item => item.privacy !== 'private').length} />
          <StatMini label="提醒" value={reminders.filter(item => item.enabled).length + (periodSettings.enabled ? 1 : 0)} />
        </div>
        <button onClick={requestHealthSummary} className="mt-3 w-full h-10 rounded-[8px] bg-[#26332e] text-white text-[12px] font-black">
          请授权角色复盘今天
        </button>
      </section>

      <section className="rounded-[8px] bg-white border border-[#dfe9e3] p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[15px] font-black">快捷打卡</div>
          <button onClick={() => setActiveView('calendar')} className="text-[12px] font-black text-[#4e8062]">补记</button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <QuickButton moduleId="hydration" text="+250 ml" onClick={() => quickRecord('hydration', 250, '喝水', 'ml', ['饮水'])} />
          <QuickButton moduleId="movement" text="+1000 步" onClick={() => quickRecord('movement', 1000, '步行', '步', ['运动'])} />
          <QuickButton moduleId="sleep" text="睡眠 7.5h" onClick={() => quickRecord('sleep', 7.5, '睡眠', '小时', ['睡眠'])} />
          <QuickButton moduleId="medication" text="已服药" onClick={() => quickRecord('medication', 1, '已服药', '次', ['用药'])} />
          <QuickButton moduleId="mood" text="心情平静" onClick={() => quickRecord('mood', 4, '平静', '分', ['心情'])} />
          <QuickButton moduleId="symptom" text="轻微不适" onClick={() => quickRecord('symptom', 2, '轻微不适', '级', ['症状'])} />
        </div>
      </section>

      <section data-manual-anchor="manual-health-period-root" className="rounded-[8px] bg-white border border-[#dfe9e3] p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[12px] font-black text-[#9b5065]">
              <Heart size={16} weight="fill" />
              经期预测
            </div>
            <div className="mt-2 text-[24px] font-black leading-tight">{predictedStart || '未设置'}</div>
            <div className="mt-1 text-[12px] font-bold text-[#789085]">
              {predictedStart ? `预计 ${predictedStart} 至 ${predictedEnd}` : '填写最近一次开始日后开始预测'}
            </div>
          </div>
          <button
            onClick={() => patchPeriodSettings({ enabled: !periodSettings.enabled })}
            className={`px-3 py-2 rounded-[8px] text-[12px] font-black border ${periodSettings.enabled ? 'bg-[#e8f7ee] border-[#b7dec6] text-[#327a4e]' : 'bg-[#f7f3f4] border-[#ead6dc] text-[#9b5065]'}`}
          >
            {periodSettings.enabled ? '提醒开' : '提醒关'}
          </button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button onClick={() => void recordPeriodEvent('start')} className="h-11 rounded-[8px] bg-[#e85d75] text-white text-[13px] font-black active:scale-[0.99]">
            今天开始
          </button>
          <button onClick={() => void recordPeriodEvent('end')} className="h-11 rounded-[8px] bg-[#e7f1ec] text-[#2f6b4a] text-[13px] font-black active:scale-[0.99]">
            今天结束
          </button>
        </div>
      </section>

      <section className="rounded-[8px] bg-white border border-[#dfe9e3] p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Bell size={18} weight="bold" className="text-[#b84d67]" />
            <div className="text-[15px] font-black">下一次提醒</div>
          </div>
          <button onClick={() => setActiveView('reminders')} className="text-[12px] font-black text-[#4e8062]">管理</button>
        </div>
        <div className="text-[13px] font-bold text-[#667c72] leading-relaxed">
          {nextReminder ? `${new Date(nextReminder.at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })} · ${nextReminder.label} · ${nextReminder.body}` : '还没有开启提醒。'}
        </div>
      </section>

      <section className="rounded-[8px] bg-white border border-[#dfe9e3] p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[15px] font-black">模块目标</div>
          <button onClick={() => setActiveView('trends')} className="text-[12px] font-black text-[#4e8062]">看趋势</button>
        </div>
        <div className="space-y-2">
          {moduleSettings.filter(item => item.goals?.target).map(item => {
            const plan = makeHealthPlan({
              moduleId: item.id,
              target: item.goals?.target,
              unit: item.goals?.unit || '次',
            });
            const progress = computeHealthGoalProgress(plan, records, today);
            return <ProgressRow key={item.id} label={HEALTH_MODULE_LABEL[item.id]} progress={progress.ratio} value={`${Math.round(progress.current * 10) / 10}/${progress.target}${progress.unit}`} accent={HEALTH_MODULES.find(m => m.id === item.id)?.accent || '#4e8062'} />;
          })}
        </div>
      </section>
    </div>
  );

  const renderCalendar = () => (
    <div className="space-y-4">
      <section className="rounded-[8px] bg-white border border-[#dfe9e3] p-4 shadow-sm space-y-3">
        <div className="flex items-center gap-2">
          <Notebook size={18} weight="bold" className="text-[#4e8062]" />
          <div className="text-[15px] font-black">日历手账</div>
        </div>
        <input type="date" value={calendarDate} onChange={e => setCalendarDate(e.target.value)} className="w-full h-11 rounded-[8px] border border-[#d8e5de] px-3 text-[14px] font-bold bg-[#fbfdfc] outline-none" />
        <div className="space-y-2">
          {selectedDateRecords.length ? selectedDateRecords.map(record => <RecordRow key={record.id} record={record} onDelete={async () => {
            await DB.deleteHealthRecord(record.id);
            setRecords(prev => prev.filter(item => item.id !== record.id));
            notifyHealthUpdated();
          }} />) : <div className="text-[12px] font-bold text-[#7b8f86]">这一天还没有记录。</div>}
        </div>
      </section>

      <section className="rounded-[8px] bg-white border border-[#dfe9e3] p-4 shadow-sm space-y-3">
        <div className="text-[15px] font-black">补记一笔</div>
        <div className="grid grid-cols-2 gap-2">
          <SelectField label="模块" value={recordForm.moduleId} onChange={value => {
            const module = HEALTH_MODULES.find(item => item.id === value);
            setRecordForm(prev => ({ ...prev, moduleId: value as HealthModuleId, unit: module?.unit || '次' }));
          }}>
            {HEALTH_MODULES.map(module => <option key={module.id} value={module.id}>{module.label}</option>)}
          </SelectField>
          <InputField label="日期" type="date" value={recordForm.date} onChange={value => setRecordForm(prev => ({ ...prev, date: value }))} />
          <InputField label="时间" type="time" value={recordForm.timeHHmm} onChange={value => setRecordForm(prev => ({ ...prev, timeHHmm: value }))} />
          <InputField label="数值" type="number" value={recordForm.value} onChange={value => setRecordForm(prev => ({ ...prev, value }))} />
          <InputField label="单位" value={recordForm.unit} onChange={value => setRecordForm(prev => ({ ...prev, unit: value }))} />
          <InputField label="标题" value={recordForm.label} onChange={value => setRecordForm(prev => ({ ...prev, label: value }))} />
        </div>
        <InputField label="标签" value={recordForm.tags} placeholder="用空格或逗号分隔" onChange={value => setRecordForm(prev => ({ ...prev, tags: value }))} />
        <label className="block">
          <span className="text-[12px] font-bold text-[#6d8379]">备注</span>
          <textarea value={recordForm.note} onChange={e => setRecordForm(prev => ({ ...prev, note: e.target.value }))} className="mt-1 w-full min-h-[76px] rounded-[8px] border border-[#d8e5de] px-3 py-2 text-[13px] font-bold bg-[#fbfdfc] outline-none resize-none" />
        </label>
        <button onClick={() => void submitRecordForm()} className="w-full h-11 rounded-[8px] bg-[#26332e] text-white text-[13px] font-black">
          保存记录
        </button>
      </section>
    </div>
  );

  const renderTrends = () => {
    const days = lastNDates(7);
    return (
      <div className="space-y-4">
        <section className="rounded-[8px] bg-white border border-[#dfe9e3] p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <ChartLineUp size={18} weight="bold" className="text-[#4e8062]" />
            <div className="text-[15px] font-black">趋势回顾</div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {HEALTH_MODULES.map(module => (
              <button
                key={module.id}
                onClick={() => setActiveModule(module.id)}
                className={`h-10 rounded-[8px] border text-[12px] font-black ${activeModule === module.id ? 'bg-[#e8f7ee] border-[#acd6bd] text-[#2d734a]' : 'bg-[#fbfdfc] border-[#d8e5de] text-[#6d8379]'}`}
              >
                {module.shortLabel}
              </button>
            ))}
          </div>
        </section>
        <section className="rounded-[8px] bg-white border border-[#dfe9e3] p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[15px] font-black">{HEALTH_MODULE_LABEL[activeModule]} · 7 天</div>
            <div className="text-[11px] font-bold text-[#91a29a]">{selectedModuleRecords.length} 条记录</div>
          </div>
          <div className="h-40 flex items-end gap-2">
            {days.map(day => {
              const total = records
                .filter(record => record.moduleId === activeModule && record.date === day)
                .reduce((sum, record) => sum + (Number(record.value) || 1), 0);
              const max = Math.max(1, ...days.map(d => records.filter(record => record.moduleId === activeModule && record.date === d).reduce((sum, record) => sum + (Number(record.value) || 1), 0)));
              const height = Math.max(10, Math.round((total / max) * 120));
              return (
                <div key={day} className="flex-1 min-w-0 flex flex-col items-center gap-2">
                  <div className="w-full rounded-t-[8px] bg-[#9fcdb2]" style={{ height }} />
                  <div className="text-[10px] font-bold text-[#7b8f86]">{formatShortDate(day)}</div>
                </div>
              );
            })}
          </div>
        </section>
        <section className="rounded-[8px] bg-white border border-[#dfe9e3] p-4 shadow-sm">
          <div className="text-[15px] font-black mb-3">最近记录</div>
          <div className="space-y-2">
            {selectedModuleRecords.slice(0, 8).map(record => <RecordRow key={record.id} record={record} />)}
            {!selectedModuleRecords.length && <div className="text-[12px] font-bold text-[#7b8f86]">这个模块还没有记录。</div>}
          </div>
        </section>
      </div>
    );
  };

  const renderReminders = () => (
    <div className="space-y-4">
      <section className="rounded-[8px] bg-white border border-[#dfe9e3] p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell size={18} weight="bold" className="text-[#b84d67]" />
            <div className="text-[15px] font-black">提醒管理</div>
          </div>
          <button
            disabled={authorizingNotify}
            onClick={() => void handleRequestNotify()}
            className="px-3 h-8 rounded-[8px] bg-[#f7f1f3] text-[#9c3f58] text-[11px] font-black disabled:opacity-50"
          >
            {authorizingNotify ? '授权中' : notifyPerm === 'granted' ? '测试通知' : notifyPerm === 'denied' ? '已拒绝' : '授权通知'}
          </button>
        </div>
        <div className="rounded-[8px] bg-[#f7faf8] border border-[#e1ebe5] px-3 py-2 text-[11px] font-bold text-[#6b8077] leading-relaxed">
          通知状态：{notifyPerm === 'granted' ? '已授权，可以发送系统提醒。' : notifyPerm === 'denied' ? '已被拒绝，需要到浏览器或系统设置里改为允许。' : notifyPerm === 'unsupported' ? '当前环境不支持系统通知。' : '未授权，点右上角按钮允许后才会弹系统提醒。'}
        </div>
      </section>

      <section className="rounded-[8px] bg-white border border-[#dfe9e3] p-4 shadow-sm space-y-3">
        <div className="text-[15px] font-black">新增提醒</div>
        <div className="grid grid-cols-2 gap-2">
          <SelectField label="模块" value={reminderForm.moduleId} onChange={value => setReminderForm(prev => ({ ...prev, moduleId: value as HealthModuleId, title: `${HEALTH_MODULE_LABEL[value as HealthModuleId]}提醒` }))}>
            {HEALTH_MODULES.filter(module => module.id !== 'period').map(module => <option key={module.id} value={module.id}>{module.label}</option>)}
          </SelectField>
          <InputField label="时间" type="time" value={reminderForm.timeHHmm} onChange={value => setReminderForm(prev => ({ ...prev, timeHHmm: value }))} />
          <InputField label="标题" value={reminderForm.title} onChange={value => setReminderForm(prev => ({ ...prev, title: value }))} />
          <SelectField label="频率" value={reminderForm.frequency} onChange={value => setReminderForm(prev => ({ ...prev, frequency: value as HealthReminderFrequency }))}>
            <option value="daily">每天</option>
            <option value="weekdays">工作日</option>
            <option value="once">一次</option>
          </SelectField>
        </div>
        <InputField label="说明" value={reminderForm.body} onChange={value => setReminderForm(prev => ({ ...prev, body: value }))} />
        <button onClick={() => void saveReminder()} className="w-full h-11 rounded-[8px] bg-[#26332e] text-white text-[13px] font-black">
          保存提醒
        </button>
      </section>

      <section className="rounded-[8px] bg-white border border-[#dfe9e3] p-4 shadow-sm space-y-3">
        <div className="text-[15px] font-black">已有提醒</div>
        {periodSettings.nextAt ? (
          <div className="rounded-[8px] bg-[#fff7f8] border border-[#f1d4dc] p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[13px] font-black">经期提醒</div>
                <div className="text-[11px] font-bold text-[#8e6873] mt-1">{new Date(periodSettings.nextAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })} · {periodReminderBody(periodSettings, periodSettings.nextAt)}</div>
              </div>
              <span className={`px-2 h-7 rounded-[8px] grid place-items-center text-[11px] font-black ${periodSettings.enabled ? 'bg-[#e8f7ee] text-[#327a4e]' : 'bg-[#f5ecef] text-[#9b5065]'}`}>{periodSettings.enabled ? '开启' : '关闭'}</span>
            </div>
          </div>
        ) : null}
        {reminders.map(reminder => (
          <div key={reminder.id} className="rounded-[8px] bg-[#f8faf9] border border-[#e6eee9] p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[13px] font-black truncate">{reminder.title}</div>
                <div className="text-[11px] font-bold text-[#789085] mt-1">
                  {HEALTH_MODULE_LABEL[reminder.moduleId]} · {normalizePeriodTime(reminder.timeHHmm)} · {reminder.frequency === 'daily' ? '每天' : reminder.frequency === 'weekdays' ? '工作日' : '一次'}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => void toggleReminder(reminder)} className={`px-2 h-8 rounded-[8px] text-[11px] font-black ${reminder.enabled ? 'bg-[#e8f7ee] text-[#327a4e]' : 'bg-[#f5ecef] text-[#9b5065]'}`}>{reminder.enabled ? '开' : '关'}</button>
                <button onClick={() => void deleteReminder(reminder.id)} className="w-8 h-8 rounded-[8px] bg-white border border-[#e6dfe2] text-[#9b5065] grid place-items-center">
                  <Trash size={15} weight="bold" />
                </button>
              </div>
            </div>
          </div>
        ))}
        {!reminders.length && !periodSettings.nextAt && <div className="text-[12px] font-bold text-[#7b8f86]">还没有提醒。</div>}
      </section>
    </div>
  );

  const renderPrivacy = () => (
    <div className="space-y-4" data-manual-anchor="manual-health-privacy">
      <section className="rounded-[8px] bg-white border border-[#dfe9e3] p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <LockKey size={18} weight="bold" className="text-[#4e8062]" />
          <div className="text-[15px] font-black">模块授权</div>
        </div>
        <div className="text-[12px] font-bold text-[#6b8077] leading-relaxed">
          默认全部私密。只有你把某个模块设为摘要或提醒授权，选中的角色才会收到对应上下文；私密明细不会注入聊天。
        </div>
      </section>
      {moduleSettings.map(setting => (
        <section key={setting.id} className="rounded-[8px] bg-white border border-[#dfe9e3] p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-[8px] bg-[#f1f7f3] text-[#4e8062] grid place-items-center">{moduleIcon[setting.id]}</span>
              <div>
                <div className="text-[14px] font-black">{HEALTH_MODULE_LABEL[setting.id]}</div>
                <div className="text-[10px] font-bold text-[#91a29a]">
                  {healthPrivacyAllowsSummary(setting.privacy) ? '可给摘要' : '摘要私密'} · {healthPrivacyAllowsReminder(setting.privacy) ? '可发提醒' : '提醒私密'}
                </div>
              </div>
            </div>
            <button
              onClick={() => void patchModulePrivacy(setting.id, { enabled: !setting.enabled })}
              className={`px-2 h-8 rounded-[8px] text-[11px] font-black ${setting.enabled ? 'bg-[#e8f7ee] text-[#327a4e]' : 'bg-[#f5ecef] text-[#9b5065]'}`}
            >
              {setting.enabled ? '启用' : '停用'}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(privacyLabel) as HealthPrivacyMode[]).map(value => (
              <button
                key={value}
                onClick={() => void patchModulePrivacy(setting.id, { privacy: value })}
                className={`min-h-10 rounded-[8px] border px-2 text-[11px] font-black ${setting.privacy === value ? 'bg-[#e8f7ee] border-[#acd6bd] text-[#2d734a]' : 'bg-[#fbfdfc] border-[#d8e5de] text-[#6d8379]'}`}
              >
                {privacyLabel[value]}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(['system', 'character', 'both'] as HealthReminderChannel[]).map(value => (
              <button
                key={value}
                disabled={!healthPrivacyAllowsReminder(setting.privacy) && value !== 'system'}
                onClick={() => void patchModulePrivacy(setting.id, { reminderChannel: value })}
                className={`h-9 rounded-[8px] border text-[11px] font-black disabled:opacity-40 ${setting.reminderChannel === value ? 'bg-[#fdecef] border-[#efb8c4] text-[#9c3f58]' : 'bg-[#fbfdfc] border-[#d8e5de] text-[#6d8379]'}`}
              >
                {channelLabel[value]}
              </button>
            ))}
          </div>
          {setting.privacy !== 'private' && (
            <div className="grid grid-cols-2 gap-2">
              {characters.map(char => {
                const active = setting.charIds.includes(char.id);
                return (
                  <button
                    key={char.id}
                    onClick={() => void toggleModuleChar(setting.id, char.id)}
                    className={`h-12 rounded-[8px] border px-2 flex items-center gap-2 text-left ${active ? 'bg-[#fff0f3] border-[#efb8c4]' : 'bg-[#fbfdfc] border-[#d8e5de]'}`}
                  >
                    {char.avatar ? (
                      <img src={char.avatar} alt="" className="w-8 h-8 rounded-full object-cover bg-[#edf3ef]" />
                    ) : (
                      <span className="w-8 h-8 rounded-full bg-[#edf3ef] text-[#6d8379] flex items-center justify-center text-[12px] font-black shrink-0">{char.name?.[0] || '角'}</span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-[12px] font-black">{char.name}</span>
                    {active && <Check size={16} weight="bold" className="text-[#9c3f58]" />}
                  </button>
                );
              })}
            </div>
          )}
        </section>
      ))}
    </div>
  );

  const renderPeriodSettings = () => (
    <section className="rounded-[8px] bg-white border border-[#dfe9e3] p-4 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[15px] font-black">经期周期设置</div>
        <button disabled={saving} onClick={() => void savePeriodSettings()} className="px-3 h-9 rounded-[8px] bg-[#26332e] text-white text-[12px] font-black disabled:opacity-50">
          {saving ? '保存中' : '保存'}
        </button>
      </div>
      <InputField label="最近一次开始日" type="date" value={periodSettings.lastStartDate || ''} onChange={value => patchPeriodSettings({ lastStartDate: value })} />
      <div className="grid grid-cols-2 gap-3">
        <InputField
          label="周期天数"
          type="number"
          value={periodNumberDraft.cycleLength}
          min={PERIOD_CYCLE_LENGTH_MIN}
          max={PERIOD_CYCLE_LENGTH_MAX}
          inputMode="numeric"
          onChange={value => patchPeriodNumberDraft('cycleLength', value)}
          onBlur={() => commitPeriodNumberDraft('cycleLength')}
        />
        <InputField
          label="经期天数"
          type="number"
          value={periodNumberDraft.periodLength}
          min={PERIOD_LENGTH_MIN}
          max={PERIOD_LENGTH_MAX}
          inputMode="numeric"
          onChange={value => patchPeriodNumberDraft('periodLength', value)}
          onBlur={() => commitPeriodNumberDraft('periodLength')}
        />
      </div>
      <InputField label="提醒时间" type="time" value={normalizePeriodTime(periodSettings.timeHHmm)} onChange={value => patchPeriodSettings({ timeHHmm: value })} />
      <div>
        <div className="text-[12px] font-bold text-[#6d8379] mb-2">提醒日</div>
        <div className="flex flex-wrap gap-2">
          {[-3, -2, -1, 0].map(offset => {
            const active = reminderChips.includes(offset);
            return (
              <button
                key={offset}
                onClick={() => togglePeriodOffset(offset)}
                className={`px-3 h-9 rounded-[8px] border text-[12px] font-black ${active ? 'bg-[#e8f7ee] border-[#acd6bd] text-[#2d734a]' : 'bg-[#fbfdfc] border-[#d8e5de] text-[#6d8379]'}`}
              >
                {offsetLabel(offset)}
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {(['system', 'character', 'both'] as PeriodReminderNotifyChannel[]).map(value => (
          <button
            key={value}
            disabled={selectedModuleSettings.privacy === 'private' && value !== 'system'}
            onClick={() => patchPeriodSettings({ notifyChannel: value })}
            className={`min-h-10 rounded-[8px] border px-2 text-[11px] font-black disabled:opacity-40 ${periodSettings.notifyChannel === value ? 'bg-[#fdecef] border-[#efb8c4] text-[#9c3f58]' : 'bg-[#fbfdfc] border-[#d8e5de] text-[#6d8379]'}`}
          >
            {legacyChannelLabel[value]}
          </button>
        ))}
      </div>
    </section>
  );

  return (
    <div className="w-full h-full bg-[#f8faf9] text-[#26332e] overflow-hidden" data-manual-anchor="manual-health-root" style={{ paddingTop: 'var(--safe-top)' }}>
      <div className="h-full flex flex-col">
        <header className="shrink-0 px-4 pt-3 pb-3 flex items-center justify-between bg-white/80 border-b border-[#e2ebe5]">
          <button onClick={closeApp} className="w-10 h-10 rounded-full bg-[#eef6f1] flex items-center justify-center active:scale-95">
            <ArrowLeft size={20} weight="bold" />
          </button>
          <div className="text-center">
            <div className="text-[11px] font-black tracking-[0.24em] text-[#7d9489] uppercase">Health</div>
            <div className="text-[18px] font-black">健康</div>
          </div>
          <button onClick={() => setActiveView('reminders')} className="w-10 h-10 rounded-full bg-[#fdecef] text-[#b84d67] flex items-center justify-center">
            <Bell size={20} weight="bold" />
          </button>
        </header>

        <nav className="shrink-0 bg-white/90 border-b border-[#e2ebe5] px-3 py-2">
          <div className="grid grid-cols-5 gap-1">
            <TabButton active={activeView === 'today'} label="总览" icon={<FirstAidKit size={16} weight="bold" />} onClick={() => setActiveView('today')} />
            <TabButton active={activeView === 'calendar'} label="手账" icon={<CalendarBlank size={16} weight="bold" />} onClick={() => setActiveView('calendar')} />
            <TabButton active={activeView === 'trends'} label="趋势" icon={<ChartLineUp size={16} weight="bold" />} onClick={() => setActiveView('trends')} />
            <TabButton active={activeView === 'reminders'} label="提醒" icon={<Bell size={16} weight="bold" />} onClick={() => setActiveView('reminders')} />
            <TabButton active={activeView === 'privacy'} label="授权" icon={<ShieldCheck size={16} weight="bold" />} onClick={() => setActiveView('privacy')} />
          </div>
        </nav>

        <main className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {loading ? (
            <div className="h-full grid place-items-center text-sm font-bold text-[#789085]">正在整理健康记录...</div>
          ) : (
            <>
              {activeView === 'today' && renderToday()}
              {activeView === 'calendar' && renderCalendar()}
              {activeView === 'trends' && renderTrends()}
              {activeView === 'reminders' && (
                <>
                  {renderReminders()}
                  <div className="mt-4">{renderPeriodSettings()}</div>
                </>
              )}
              {activeView === 'privacy' && renderPrivacy()}
              <div className="pb-6 flex items-center justify-center gap-1 text-[11px] font-bold text-[#91a29a]">
                {periodTracker ? <Sparkle size={14} weight="bold" /> : <Plus size={14} weight="bold" />}
                {periodTracker ? '经期记录会同步到手账里的「经期」打卡' : '健康记录保存在本机；没有手账 tracker 也能独立使用'}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
};

const TabButton: React.FC<{ active: boolean; label: string; icon: React.ReactNode; onClick: () => void }> = ({ active, label, icon, onClick }) => (
  <button onClick={onClick} className={`h-10 rounded-[8px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-black ${active ? 'bg-[#e8f7ee] text-[#2d734a]' : 'text-[#789085]'}`}>
    {icon}
    <span>{label}</span>
  </button>
);

const StatMini: React.FC<{ label: string; value: string | number }> = ({ label, value }) => (
  <div className="h-14 rounded-[8px] bg-[#f7faf8] border border-[#e1ebe5] px-2 flex flex-col justify-center">
    <div className="text-[16px] font-black leading-tight">{value}</div>
    <div className="text-[10px] font-bold text-[#7b8f86]">{label}</div>
  </div>
);

const QuickButton: React.FC<{ moduleId: HealthModuleId; text: string; onClick: () => void }> = ({ moduleId, text, onClick }) => {
  const module = HEALTH_MODULES.find(item => item.id === moduleId);
  return (
    <button onClick={onClick} className="h-12 rounded-[8px] bg-[#f8faf9] border border-[#e6eee9] px-3 flex items-center gap-2 text-left active:scale-[0.99]">
      <span className="w-8 h-8 rounded-[8px] grid place-items-center text-white shrink-0" style={{ backgroundColor: module?.accent || '#4e8062' }}>
        {moduleIcon[moduleId]}
      </span>
      <span className="min-w-0 text-[12px] font-black">{text}</span>
    </button>
  );
};

const ProgressRow: React.FC<{ label: string; value: string; progress: number; accent: string }> = ({ label, value, progress, accent }) => (
  <div>
    <div className="flex items-center justify-between text-[12px] font-bold mb-1">
      <span>{label}</span>
      <span className="text-[#789085]">{value}</span>
    </div>
    <div className="h-2 rounded-full bg-[#eef4f0] overflow-hidden">
      <div className="h-full rounded-full" style={{ width: `${Math.round(progress * 100)}%`, backgroundColor: accent }} />
    </div>
  </div>
);

const RecordRow: React.FC<{ record: HealthRecord; onDelete?: () => void }> = ({ record, onDelete }) => (
  <div className="rounded-[8px] bg-[#f8faf9] border border-[#e6eee9] px-3 py-2 flex items-center justify-between gap-2">
    <div className="min-w-0">
      <div className="text-[13px] font-black truncate">{record.label || record.tags[0] || HEALTH_MODULE_LABEL[record.moduleId]}</div>
      <div className="text-[11px] font-bold text-[#789085] mt-0.5">
        {record.date} {record.timeHHmm || ''} · {HEALTH_MODULE_LABEL[record.moduleId]}{record.value !== undefined ? ` · ${record.value}${record.unit || ''}` : ''}
      </div>
      {record.note && <div className="text-[11px] font-bold text-[#91a29a] mt-1 truncate">{record.note}</div>}
    </div>
    {onDelete && (
      <button onClick={onDelete} className="w-8 h-8 rounded-[8px] bg-white border border-[#e6dfe2] text-[#9b5065] grid place-items-center shrink-0">
        <Trash size={15} weight="bold" />
      </button>
    )}
  </div>
);

const InputField: React.FC<{
  label: string;
  value: string;
  type?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  onChange: (value: string) => void;
  onBlur?: () => void;
}> = ({ label, value, type = 'text', placeholder, min, max, inputMode, onChange, onBlur }) => (
  <label className="block">
    <span className="text-[12px] font-bold text-[#6d8379]">{label}</span>
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      min={min}
      max={max}
      inputMode={inputMode}
      onChange={e => onChange(e.target.value)}
      onBlur={onBlur}
      className="mt-1 w-full h-11 rounded-[8px] border border-[#d8e5de] px-3 text-[14px] font-bold bg-[#fbfdfc] outline-none"
    />
  </label>
);

const SelectField: React.FC<{ label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }> = ({ label, value, onChange, children }) => (
  <label className="block">
    <span className="text-[12px] font-bold text-[#6d8379]">{label}</span>
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="mt-1 w-full h-11 rounded-[8px] border border-[#d8e5de] px-3 text-[14px] font-bold bg-[#fbfdfc] outline-none"
    >
      {children}
    </select>
  </label>
);

export default HealthApp;
