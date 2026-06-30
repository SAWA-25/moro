import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Bell,
  CalendarBlank,
  Check,
  FirstAidKit,
  Heart,
  Plus,
  ShieldCheck,
  Sparkle,
} from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { AppID } from '../types';
import type { PeriodCycleEvent, PeriodReminderNotifyChannel, PeriodReminderSettings, PeriodReminderVisibility, Tracker, TrackerEntry } from '../types';
import {
  addDaysToDateKey,
  makeDefaultPeriodReminderSettings,
  normalizePeriodDate,
  normalizePeriodOffsets,
  normalizePeriodTime,
  periodReminderBody,
  predictNextPeriodStart,
  preparePeriodReminderSettings,
} from '../utils/periodReminders';
import { getNotifyPermission, requestNotifyPermission, showLocalNotification, type NotifyPermission } from '../utils/browserNotify';
import { scrollToManualAnchor, useManualDeepLink } from '../utils/manualDeepLink';

const pad = (n: number) => String(n).padStart(2, '0');
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const notifyPeriodReminderUpdated = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('period-reminders-updated'));
  }
};

const offsetLabel = (offset: number) => {
  if (offset === 0) return '当天';
  return offset < 0 ? `提前 ${Math.abs(offset)} 天` : `之后 ${offset} 天`;
};

const channelLabel: Record<PeriodReminderNotifyChannel, string> = {
  system: '系统通知',
  character: '角色提醒',
  both: '两者都要',
};

const visibilityLabel: Record<PeriodReminderVisibility, string> = {
  private: '私密',
  public: '公开给角色',
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

const HealthApp: React.FC = () => {
  const { closeApp, characters, addToast } = useOS();
  const [settings, setSettings] = useState<PeriodReminderSettings>(() => makeDefaultPeriodReminderSettings());
  const [events, setEvents] = useState<PeriodCycleEvent[]>([]);
  const [trackers, setTrackers] = useState<Tracker[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notifyPerm, setNotifyPerm] = useState<NotifyPermission>(() => getNotifyPermission());
  const [authorizingNotify, setAuthorizingNotify] = useState(false);

  const periodTracker = useMemo(() => findPeriodTracker(trackers), [trackers]);
  const predictedStart = useMemo(
    () => predictNextPeriodStart(settings.lastStartDate, settings.cycleLength),
    [settings.cycleLength, settings.lastStartDate],
  );
  const predictedEnd = predictedStart ? addDaysToDateKey(predictedStart, settings.periodLength - 1) : '';
  const reminderChips = useMemo(() => normalizePeriodOffsets(settings.remindOffsets), [settings.remindOffsets]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [stored, storedEvents, storedTrackers] = await Promise.all([
        DB.getPeriodReminderSettings().catch(() => null),
        DB.getAllPeriodCycleEvents().catch(() => []),
        DB.getAllTrackers().catch(() => []),
      ]);
      const tracker = findPeriodTracker(storedTrackers);
      const trackerEntries = tracker
        ? await DB.getTrackerEntriesByTracker(tracker.id).catch(() => [])
        : [];
      const inferredStart = !stored?.lastStartDate ? inferLastStartDate(storedEvents, trackerEntries) : '';
      setSettings(preparePeriodReminderSettings({
        ...(stored || makeDefaultPeriodReminderSettings()),
        ...(inferredStart ? { lastStartDate: inferredStart } : {}),
      }, Date.now()));
      setEvents(storedEvents);
      setTrackers(storedTrackers);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  const patchSettings = (patch: Partial<PeriodReminderSettings>) => {
    setSettings(prev => preparePeriodReminderSettings({ ...prev, ...patch }, Date.now()));
  };

  const saveSettings = async (next = settings) => {
    setSaving(true);
    try {
      const prepared = preparePeriodReminderSettings(next, Date.now());
      await DB.savePeriodReminderSettings(prepared);
      setSettings(prepared);
      notifyPeriodReminderUpdated();
      addToast('经期提醒已保存', 'success');
      const perm = getNotifyPermission();
      setNotifyPerm(perm);
      if (prepared.enabled && perm === 'default') {
        addToast('还需要点「授权通知」允许系统提醒', 'info');
      }
    } catch (err: any) {
      addToast(err?.message || '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleRequestNotify = async () => {
    setAuthorizingNotify(true);
    try {
      const perm = await requestNotifyPermission();
      setNotifyPerm(perm);
      if (perm === 'granted') {
        const ok = await showLocalNotification('健康提醒已开启', {
          body: '到点后会像这样提醒你。',
          tag: 'period-reminder-permission-test',
          data: {
            source: 'period-reminder',
            type: 'period-reminder',
            settingsId: settings.id,
            charId: settings.charIds?.[0],
          },
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

  const recordEvent = async (kind: PeriodCycleEvent['kind'], date = todayKey()) => {
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
    setEvents(prev => [...prev, event].sort((a, b) => a.date.localeCompare(b.date)));

    let nextSettings = settings;
    if (kind === 'start') {
      nextSettings = preparePeriodReminderSettings({ ...settings, lastStartDate: normalizedDate, enabled: true }, now);
      await DB.savePeriodReminderSettings(nextSettings);
      setSettings(nextSettings);
    }

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
    addToast(kind === 'start' ? '已记录今天开始' : '已记录今天结束', 'success');
  };

  const toggleOffset = (offset: number) => {
    const current = normalizePeriodOffsets(settings.remindOffsets);
    const next = current.includes(offset) ? current.filter(v => v !== offset) : [...current, offset];
    patchSettings({ remindOffsets: next.length ? next : [0] });
  };

  const toggleChar = (charId: string) => {
    const set = new Set(settings.charIds || []);
    if (set.has(charId)) set.delete(charId);
    else set.add(charId);
    patchSettings({ charIds: Array.from(set), notifyChannel: set.size ? settings.notifyChannel : 'system' });
  };

  const recentEvents = [...events].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);

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
          <div className="w-10 h-10 rounded-full bg-[#fdecef] text-[#b84d67] flex items-center justify-center">
            <FirstAidKit size={20} weight="bold" />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {loading ? (
            <div className="h-full grid place-items-center text-sm font-bold text-[#789085]">正在整理健康记录...</div>
          ) : (
            <>
              <section className="rounded-[8px] bg-white border border-[#dfe9e3] p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-[12px] font-black text-[#7b8f86]">
                      <CalendarBlank size={16} weight="bold" />
                      下次预测
                    </div>
                    <div className="mt-2 text-[28px] font-black leading-tight">
                      {predictedStart || '未设置'}
                    </div>
                    <div className="mt-1 text-[12px] font-bold text-[#769086]">
                      {predictedStart ? `预计 ${predictedStart} 至 ${predictedEnd}` : '填写最近一次开始日后开始预测'}
                    </div>
                  </div>
                  <button
                    onClick={() => patchSettings({ enabled: !settings.enabled })}
                    className={`px-3 py-2 rounded-[8px] text-[12px] font-black border ${settings.enabled ? 'bg-[#e8f7ee] border-[#b7dec6] text-[#327a4e]' : 'bg-[#f7f3f4] border-[#ead6dc] text-[#9b5065]'}`}
                  >
                    {settings.enabled ? '提醒开' : '提醒关'}
                  </button>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button onClick={() => void recordEvent('start')} className="h-11 rounded-[8px] bg-[#e85d75] text-white text-[13px] font-black active:scale-[0.99]">
                    今天开始
                  </button>
                  <button onClick={() => void recordEvent('end')} className="h-11 rounded-[8px] bg-[#e7f1ec] text-[#2f6b4a] text-[13px] font-black active:scale-[0.99]">
                    今天结束
                  </button>
                </div>
              </section>

              <section data-manual-anchor="manual-health-period-root" className="rounded-[8px] bg-white border border-[#dfe9e3] p-4 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-[15px] font-black">周期设置</div>
                  <button disabled={saving} onClick={() => void saveSettings()} className="px-3 h-9 rounded-[8px] bg-[#26332e] text-white text-[12px] font-black disabled:opacity-50">
                    {saving ? '保存中' : '保存'}
                  </button>
                </div>

                <label className="block">
                  <span className="text-[12px] font-bold text-[#6d8379]">最近一次开始日</span>
                  <input
                    type="date"
                    value={settings.lastStartDate || ''}
                    onChange={e => patchSettings({ lastStartDate: e.target.value })}
                    className="mt-1 w-full h-11 rounded-[8px] border border-[#d8e5de] px-3 text-[14px] font-bold bg-[#fbfdfc] outline-none"
                  />
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-[12px] font-bold text-[#6d8379]">周期天数</span>
                    <input
                      type="number"
                      min={15}
                      max={60}
                      value={settings.cycleLength}
                      onChange={e => patchSettings({ cycleLength: Number(e.target.value) })}
                      className="mt-1 w-full h-11 rounded-[8px] border border-[#d8e5de] px-3 text-[14px] font-bold bg-[#fbfdfc] outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[12px] font-bold text-[#6d8379]">经期天数</span>
                    <input
                      type="number"
                      min={1}
                      max={14}
                      value={settings.periodLength}
                      onChange={e => patchSettings({ periodLength: Number(e.target.value) })}
                      className="mt-1 w-full h-11 rounded-[8px] border border-[#d8e5de] px-3 text-[14px] font-bold bg-[#fbfdfc] outline-none"
                    />
                  </label>
                </div>

                <label className="block">
                  <span className="text-[12px] font-bold text-[#6d8379]">提醒时间</span>
                  <input
                    type="time"
                    value={normalizePeriodTime(settings.timeHHmm)}
                    onChange={e => patchSettings({ timeHHmm: e.target.value })}
                    className="mt-1 w-full h-11 rounded-[8px] border border-[#d8e5de] px-3 text-[14px] font-bold bg-[#fbfdfc] outline-none"
                  />
                </label>

                <div>
                  <div className="text-[12px] font-bold text-[#6d8379] mb-2">提醒日</div>
                  <div className="flex flex-wrap gap-2">
                    {[-3, -2, -1, 0].map(offset => {
                      const active = reminderChips.includes(offset);
                      return (
                        <button
                          key={offset}
                          onClick={() => toggleOffset(offset)}
                          className={`px-3 h-9 rounded-[8px] border text-[12px] font-black ${active ? 'bg-[#e8f7ee] border-[#acd6bd] text-[#2d734a]' : 'bg-[#fbfdfc] border-[#d8e5de] text-[#6d8379]'}`}
                        >
                          {offsetLabel(offset)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </section>

              <section data-manual-anchor="manual-health-privacy" className="rounded-[8px] bg-white border border-[#dfe9e3] p-4 shadow-sm space-y-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={18} weight="bold" className="text-[#4f8d65]" />
                  <div className="text-[15px] font-black">公开与提醒方式</div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {(['private', 'public'] as PeriodReminderVisibility[]).map(value => (
                    <button
                      key={value}
                      onClick={() => patchSettings({ visibility: value, notifyChannel: value === 'private' ? 'system' : settings.notifyChannel })}
                      className={`h-10 rounded-[8px] border text-[12px] font-black ${settings.visibility === value ? 'bg-[#e8f7ee] border-[#acd6bd] text-[#2d734a]' : 'bg-[#fbfdfc] border-[#d8e5de] text-[#6d8379]'}`}
                    >
                      {visibilityLabel[value]}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(['system', 'character', 'both'] as PeriodReminderNotifyChannel[]).map(value => (
                    <button
                      key={value}
                      disabled={settings.visibility === 'private' && value !== 'system'}
                      onClick={() => patchSettings({ notifyChannel: value })}
                      className={`min-h-10 rounded-[8px] border px-2 text-[11px] font-black disabled:opacity-40 ${settings.notifyChannel === value ? 'bg-[#fdecef] border-[#efb8c4] text-[#9c3f58]' : 'bg-[#fbfdfc] border-[#d8e5de] text-[#6d8379]'}`}
                    >
                      {channelLabel[value]}
                    </button>
                  ))}
                </div>
                {settings.visibility === 'public' && (
                  <div className="space-y-2">
                    <div className="text-[12px] font-bold text-[#6d8379]">选择会提醒你的角色</div>
                    <div className="grid grid-cols-2 gap-2">
                      {characters.map(char => {
                        const active = settings.charIds.includes(char.id);
                        return (
                          <button
                            key={char.id}
                            onClick={() => toggleChar(char.id)}
                            className={`h-12 rounded-[8px] border px-2 flex items-center gap-2 text-left ${active ? 'bg-[#fff0f3] border-[#efb8c4]' : 'bg-[#fbfdfc] border-[#d8e5de]'}`}
                          >
                            {char.avatar ? (
                              <img src={char.avatar} alt="" className="w-8 h-8 rounded-full object-cover bg-[#edf3ef]" />
                            ) : (
                              <span className="w-8 h-8 rounded-full bg-[#edf3ef] text-[#6d8379] flex items-center justify-center text-[12px] font-black shrink-0">
                                {char.name?.[0] || '角'}
                              </span>
                            )}
                            <span className="min-w-0 flex-1 truncate text-[12px] font-black">{char.name}</span>
                            {active && <Check size={16} weight="bold" className="text-[#9c3f58]" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div className="rounded-[8px] bg-[#f7faf8] border border-[#e1ebe5] p-3 text-[12px] font-bold leading-relaxed text-[#6b8077]">
                  {settings.visibility === 'public'
                    ? '公开给角色后，到点可以让选中的角色用自己的语气来提醒。'
                    : '私密模式只弹本地提醒，不写入聊天，也不告诉角色。'}
                </div>
              </section>

              <section className="rounded-[8px] bg-white border border-[#dfe9e3] p-4 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Bell size={18} weight="bold" className="text-[#b84d67]" />
                    <div className="text-[15px] font-black">下一次提醒</div>
                  </div>
                  <button
                    disabled={authorizingNotify}
                    onClick={() => void handleRequestNotify()}
                    className="px-3 h-8 rounded-[8px] bg-[#f7f1f3] text-[#9c3f58] text-[11px] font-black disabled:opacity-50"
                  >
                    {authorizingNotify ? '授权中' : notifyPerm === 'granted' ? '测试通知' : notifyPerm === 'denied' ? '已拒绝' : '授权通知'}
                  </button>
                </div>
                <div className="text-[13px] font-bold text-[#667c72] leading-relaxed">
                  {settings.nextAt ? `${new Date(settings.nextAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })} · ${periodReminderBody(settings, settings.nextAt)}` : '开启提醒并填写开始日后生成。'}
                </div>
                <div className="rounded-[8px] bg-[#f7faf8] border border-[#e1ebe5] px-3 py-2 text-[11px] font-bold text-[#6b8077]">
                  通知状态：{notifyPerm === 'granted' ? '已授权，可以发送系统提醒。' : notifyPerm === 'denied' ? '已被拒绝，需要到浏览器或系统设置里改为允许。' : notifyPerm === 'unsupported' ? '当前环境不支持系统通知。' : '未授权，点右上角按钮允许后才会弹系统提醒。'}
                </div>
                <div className="text-[11px] font-bold text-[#91a29a]">
                  浏览器完全关闭后不保证常驻提醒；手机安装版会排程本地通知。
                </div>
              </section>

              <section className="rounded-[8px] bg-white border border-[#dfe9e3] p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <Heart size={18} weight="fill" className="text-[#e85d75]" />
                  <div className="text-[15px] font-black">最近记录</div>
                </div>
                {recentEvents.length ? (
                  <div className="space-y-2">
                    {recentEvents.map(event => (
                      <div key={event.id} className="h-10 rounded-[8px] bg-[#f8faf9] border border-[#e6eee9] px-3 flex items-center justify-between">
                        <span className="text-[13px] font-black">{event.date}</span>
                        <span className="text-[12px] font-bold text-[#7b8f86]">{event.kind === 'start' ? '开始' : '结束'}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[12px] font-bold text-[#7b8f86]">还没有记录。</div>
                )}
              </section>

              {periodTracker && (
                <div className="pb-6 flex items-center justify-center gap-1 text-[11px] font-bold text-[#91a29a]">
                  <Sparkle size={14} weight="bold" />
                  已同步到手账里的「经期」打卡
                </div>
              )}
              {!periodTracker && (
                <div className="pb-6 flex items-center justify-center gap-1 text-[11px] font-bold text-[#91a29a]">
                  <Plus size={14} weight="bold" />
                  手账经期 tracker 不存在时，健康 App 会独立保存记录
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
};

export default HealthApp;
