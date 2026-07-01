import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BookOpenText,
  CaretRight,
  ChatCircleText,
  GearSix,
  MagnifyingGlass,
  Megaphone,
  SlidersHorizontal,
  Sparkle,
  Wrench,
  type Icon,
} from '@phosphor-icons/react';
import { Icons, INSTALLED_APPS } from '../constants';
import { useOS } from '../context/OSContext';
import { AppID } from '../types';
import { isDevDebugAvailable, subscribeDevDebugAvailability } from '../utils/devDebug';
import { queueManualDeepLink, useManualDeepLink, type ManualDeepLinkTarget } from '../utils/manualDeepLink';
import { isNativeAppRuntime } from '../utils/nativeRuntime';
import {
  CATEGORY_ORDER,
  getManualUpdateNotices,
  MANUAL_DESTINATIONS,
  MANUAL_ENTRIES,
  type ManualCategory,
  type ManualEntry,
  type ManualSetting,
  type ManualUpdateNotice,
} from './manual/manualData';

const CATEGORY_META: Record<ManualCategory, { label: string; en: string; Icon: Icon }> = {
  daily: { label: '日常与陪伴', en: 'Daily', Icon: Sparkle },
  social: { label: '社交与消息', en: 'Social', Icon: ChatCircleText },
  creation: { label: '创作与记录', en: 'Create', Icon: BookOpenText },
  roleplay: { label: '剧场与世界', en: 'Play', Icon: CaretRight },
  system: { label: '系统与工具', en: 'Tools', Icon: GearSix },
};

const UPDATE_KIND_META: Record<ManualUpdateNotice['kind'], { label: string; className: string }> = {
  feature: { label: '新功能', className: 'bg-[#23211d] text-[#fffdf8]' },
  fix: { label: '修复', className: 'bg-[#f7dede] text-[#8b2f3e]' },
  improvement: { label: '优化', className: 'bg-[#dce8f7] text-[#2d557e]' },
  notice: { label: '提醒', className: 'bg-[#efe3c6] text-[#7b5b1b]' },
};

const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, '');

const formatNoticeDate = (date: string) => {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(parsed);
};

const settingSearchText = (setting: ManualSetting) => [
  setting.id,
  setting.title,
  setting.description,
  setting.defaultBehavior || '',
  ...(setting.path || []),
  ...(setting.options || []).flatMap(option => [option.label, option.description]),
].join(' ');

const isNativeEntry = (entry: ManualEntry) => !!entry.nativeOnly;
const isDevEntry = (entry: ManualEntry) => !!entry.devOnly;

const entrySearchText = (entry: ManualEntry, nativeRuntime: boolean) => {
  const destination = MANUAL_DESTINATIONS[entry.app];
  return [
    entry.app,
    entry.en,
    entry.summary,
    ...entry.features,
    ...(entry.beginnerSteps || []),
    ...(entry.commonQuestions || []).flatMap(item => [item.title, item.answer]),
    ...(entry.tips || []),
    ...(destination?.path || []),
    ...(destination?.details || []),
    CATEGORY_META[entry.category].label,
    ...(entry.settingSections || []).flatMap(section => [
      section.id,
      section.title,
      section.description || '',
      ...section.settings.filter(setting => nativeRuntime || !setting.nativeOnly).map(settingSearchText),
    ]),
  ].join(' ');
};

const settingCountOf = (entry: ManualEntry, nativeRuntime: boolean) =>
  (entry.settingSections || []).reduce((sum, section) => sum + section.settings.filter(setting => nativeRuntime || !setting.nativeOnly).length, 0);

const visibleSectionsOf = (entry: ManualEntry, nativeRuntime: boolean) =>
  (entry.settingSections || [])
    .map(section => ({
      ...section,
      settings: section.settings.filter(setting => nativeRuntime || !setting.nativeOnly),
    }))
    .filter(section => section.settings.length > 0);

const SettingPath: React.FC<{ setting: ManualSetting }> = ({ setting }) => {
  const path = setting.path || [];
  if (path.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1">
      {path.map((step, index) => (
        <React.Fragment key={`${setting.id}-path-${step}`}>
          <span className="px-2 py-0.5 rounded-full bg-[#fffdf8] border border-black/[0.05] text-[9.5px] font-bold text-[#7b705f]">{step}</span>
          {index < path.length - 1 && <CaretRight size={9} weight="bold" className="text-[#a79a84]" />}
        </React.Fragment>
      ))}
    </div>
  );
};

const UpdateNoticeCard: React.FC<{ notice: ManualUpdateNotice; latest?: boolean }> = ({ notice, latest }) => {
  const meta = UPDATE_KIND_META[notice.kind];
  return (
    <article
      className={[
        'relative overflow-hidden rounded-[20px] border px-4 py-4',
        latest
          ? 'bg-[#23211d] text-[#fffdf8] border-[#23211d] shadow-[0_18px_36px_-26px_rgba(35,33,29,0.8)]'
          : 'bg-[#fffdf8] text-[#23211d] border-black/10 shadow-[0_12px_28px_-24px_rgba(35,33,29,0.45)]',
      ].join(' ')}
    >
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.12] pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.55) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.35) 1px, transparent 1px)',
          backgroundSize: '18px 18px',
        }}
      />
      <div className="relative">
        <div className="flex flex-wrap items-center gap-2">
          {latest && (
            <span className="px-2.5 py-1 rounded-full bg-[#fffdf8] text-[#23211d] text-[10px] font-black">
              最新
            </span>
          )}
          <span className={`px-2.5 py-1 rounded-full text-[10px] font-black ${latest ? 'bg-white/16 text-white' : meta.className}`}>
            {meta.label}
          </span>
          <span className={`label-mono text-[9px] tracking-[0.18em] ${latest ? 'text-white/56' : 'text-[#9a8c75]'}`}>
            {formatNoticeDate(notice.date)}
          </span>
        </div>
        <h2 className={`mt-3 text-[20px] font-black leading-snug tracking-wide ${latest ? 'text-white' : 'text-[#2f2a24]'}`}>
          {notice.title}
        </h2>
        <p className={`mt-2 text-[12.5px] leading-relaxed ${latest ? 'text-white/76' : 'text-[#5c5143]'}`}>
          {notice.summary}
        </p>
        <div className="mt-3 space-y-2">
          {notice.items.map((item, index) => (
            <div
              key={`${notice.id}-${item}`}
              className={[
                'flex items-start gap-2.5 rounded-[14px] border px-3 py-2.5',
                latest ? 'bg-white/10 border-white/12' : 'bg-[#f7f1e6] border-black/[0.06]',
              ].join(' ')}
            >
              <span
                className={[
                  'shrink-0 w-5 h-5 rounded-full label-mono text-[10px] font-bold flex items-center justify-center mt-0.5',
                  latest ? 'bg-[#fffdf8] text-[#23211d]' : 'bg-[#23211d] text-[#fffdf8]',
                ].join(' ')}
              >
                {index + 1}
              </span>
              <span className={`text-[11.5px] leading-relaxed ${latest ? 'text-white/78' : 'text-[#4d4439]'}`}>{item}</span>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
};

const ManualApp: React.FC = () => {
  const { closeApp, openApp } = useOS();
  const nativeRuntime = isNativeAppRuntime();
  const [devDebugVisible, setDevDebugVisible] = useState(() => isDevDebugAvailable());
  const [category, setCategory] = useState<'all' | ManualCategory>('all');
  const [query, setQuery] = useState('');
  const [activeApp, setActiveApp] = useState(MANUAL_ENTRIES[0]?.app || '');
  const [page, setPage] = useState<'guide' | 'updates'>('guide');

  useEffect(() => subscribeDevDebugAvailability(setDevDebugVisible), []);

  useManualDeepLink(AppID.Manual, useCallback((target) => {
    if (target.route === 'updates' || target.payload?.page === 'updates') {
      setPage('updates');
    }
  }, []));

  const visibleEntries = useMemo(
    () => MANUAL_ENTRIES.filter(entry =>
      (nativeRuntime || !isNativeEntry(entry)) &&
      (devDebugVisible || !isDevEntry(entry)),
    ),
    [devDebugVisible, nativeRuntime],
  );

  const filteredEntries = useMemo(() => {
    const q = normalize(query);
    return visibleEntries.filter((entry) => {
      if (category !== 'all' && entry.category !== category) return false;
      if (!q) return true;
      return normalize(entrySearchText(entry, nativeRuntime)).includes(q);
    });
  }, [category, nativeRuntime, query, visibleEntries]);

  const activeEntry = useMemo(() => {
    if (filteredEntries.length === 0) return null;
    return filteredEntries.find((entry) => entry.app === activeApp) || filteredEntries[0];
  }, [activeApp, filteredEntries]);

  const activeDestination = activeEntry ? MANUAL_DESTINATIONS[activeEntry.app] : null;
  const activeAppConfig = activeDestination
    ? INSTALLED_APPS.find((app) => app.id === activeDestination.appId)
    : null;
  const ActiveAppIcon = activeAppConfig ? Icons[activeAppConfig.icon] : null;
  const updateNotices = useMemo(() => getManualUpdateNotices(), []);
  const latestNotice = updateNotices[0] || null;
  const olderNotices = updateNotices.slice(1);

  const countByCategory = useMemo(() => {
    const counts: Record<ManualCategory, number> = {
      daily: 0,
      social: 0,
      creation: 0,
      roleplay: 0,
      system: 0,
    };
    visibleEntries.forEach((entry) => { counts[entry.category] += 1; });
    return counts;
  }, [visibleEntries]);

  const jumpTo = (target?: ManualDeepLinkTarget | null) => {
    if (!target) return;
    queueManualDeepLink(target);
    openApp(target.appId);
  };

  const openDestination = () => {
    if (!activeDestination) return;
    if (activeDestination.deepLink) jumpTo(activeDestination.deepLink);
    else openApp(activeDestination.appId);
  };

  if (page === 'updates') {
    return (
      <div
        className="absolute inset-0 flex flex-col animate-fade-in text-[#23211d]"
        data-manual-anchor="manual-updates-root"
        style={{
          background:
            'radial-gradient(circle at 16% 0%, rgba(236, 192, 111, 0.22), transparent 32%), radial-gradient(circle at 96% 10%, rgba(94, 151, 246, 0.12), transparent 30%), linear-gradient(180deg, #f8f4ea 0%, #efe7d6 100%)',
          paddingTop: 'var(--safe-top)',
        }}
      >
        <div className="shrink-0 px-4 pt-3 pb-3">
          <div className="flex items-center justify-between gap-3">
            <button
              onClick={() => setPage('guide')}
              className="h-9 w-9 rounded-full bg-white/80 border border-black/10 shadow-sm flex items-center justify-center active:scale-95 transition-transform"
              aria-label="返回说明书"
            >
              <ArrowLeft size={18} weight="bold" />
            </button>
            <div className="text-center min-w-0">
              <div className="label-mono text-[9px] tracking-[0.32em] text-[#8d7f68]">MORO UPDATES</div>
              <h1 className="text-[24px] leading-tight font-black tracking-wide">更新公告</h1>
            </div>
            <div className="h-9 w-9 rounded-full bg-[#23211d] text-white flex items-center justify-center shadow-sm">
              <Megaphone size={18} weight="fill" />
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-4 pb-5">
          {updateNotices.length === 0 ? (
            <div className="mt-4 rounded-[20px] bg-[#fffdf8] border border-black/10 px-4 py-8 text-center shadow-[0_14px_32px_-26px_rgba(35,33,29,0.45)]">
              <div className="mx-auto h-11 w-11 rounded-full bg-[#23211d] text-[#fffdf8] flex items-center justify-center">
                <Megaphone size={20} weight="fill" />
              </div>
              <div className="mt-3 text-[15px] font-black text-[#342f28]">还没有更新公告</div>
              <p className="mt-1 text-[12px] leading-relaxed text-[#7b705f]">
                等下一次新增功能、修复问题或调整重要入口时，这里会开始记录。
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {latestNotice && <UpdateNoticeCard notice={latestNotice} latest />}

              <div className="flex items-center gap-2 pt-1">
                <span className="h-px flex-1 bg-black/10" />
                <span className="label-mono text-[9px] tracking-[0.24em] text-[#9a8c75]">过往公告</span>
                <span className="h-px flex-1 bg-black/10" />
              </div>

              {olderNotices.length > 0 ? (
                olderNotices.map(notice => <UpdateNoticeCard key={notice.id} notice={notice} />)
              ) : (
                <div className="rounded-[18px] bg-white/72 border border-black/10 px-4 py-5 text-center text-[11.5px] leading-relaxed text-[#7b705f]">
                  暂时只有这一条公告。之后的新功能和修复会继续往这里补。
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="absolute inset-0 flex flex-col animate-fade-in text-[#23211d]"
      data-manual-anchor="manual-root"
      style={{
        background:
          'radial-gradient(circle at 16% 0%, rgba(236, 192, 111, 0.22), transparent 32%), radial-gradient(circle at 96% 10%, rgba(94, 151, 246, 0.12), transparent 30%), linear-gradient(180deg, #f8f4ea 0%, #efe7d6 100%)',
        paddingTop: 'var(--safe-top)',
      }}
    >
      <div className="shrink-0 px-4 pt-3 pb-3">
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={closeApp}
            className="h-9 w-9 rounded-full bg-white/80 border border-black/10 shadow-sm flex items-center justify-center active:scale-95 transition-transform"
            aria-label="回桌面"
          >
            <ArrowLeft size={18} weight="bold" />
          </button>
          <div className="text-center min-w-0">
            <div className="label-mono text-[9px] tracking-[0.32em] text-[#8d7f68]">MORO GUIDE</div>
            <h1 className="text-[24px] leading-tight font-black tracking-wide">说明书</h1>
          </div>
          <button
            onClick={() => setPage('updates')}
            className="h-9 w-9 rounded-full bg-[#23211d] text-white flex items-center justify-center shadow-sm active:scale-95 transition-transform"
            aria-label="查看更新公告"
          >
            <Megaphone size={18} weight="fill" />
          </button>
        </div>

        <div className="mt-4 rounded-[18px] bg-white/86 border border-black/10 shadow-[0_12px_32px_-24px_rgba(35,33,29,0.45)] px-3 py-3">
          <div className="flex items-center gap-2 rounded-[14px] bg-[#f6f1e7] border border-black/[0.06] px-3 py-2">
            <MagnifyingGlass size={15} weight="bold" className="shrink-0 text-[#7b705f]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索 App、设置、开关或路径"
              className="w-full bg-transparent text-[13px] text-[#23211d] placeholder:text-[#a79a84] focus:outline-none"
            />
          </div>

          <div className="mt-3 flex gap-2 overflow-x-auto no-scrollbar pb-0.5">
            {CATEGORY_ORDER.map((item) => {
              const selected = category === item;
              const label = item === 'all' ? '全部' : CATEGORY_META[item].label;
              const count = item === 'all' ? visibleEntries.length : countByCategory[item];
              const IconComp = item === 'all' ? BookOpenText : CATEGORY_META[item].Icon;
              return (
                <button
                  key={item}
                  onClick={() => setCategory(item)}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-full border text-[11px] font-bold active:scale-95 transition-transform"
                  style={{
                    background: selected ? '#23211d' : '#fffdf8',
                    color: selected ? '#fffdf8' : '#5f5547',
                    borderColor: selected ? '#23211d' : 'rgba(35,33,29,0.09)',
                  }}
                >
                  <IconComp size={13} weight="bold" />
                  <span>{label}</span>
                  <span className="opacity-55">{count}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 px-4 pb-5 grid grid-cols-[122px_minmax(0,1fr)] gap-3">
        <div className="min-h-0 overflow-y-auto no-scrollbar space-y-2 pr-0.5">
          {filteredEntries.length === 0 ? (
            <div className="rounded-[16px] bg-white/78 border border-black/10 px-3 py-5 text-center text-[11px] leading-relaxed text-[#7b705f]">
              没搜到。换个词试试，比如“主动点外卖”“锁屏密码”“聊天气泡”。
            </div>
          ) : filteredEntries.map((entry) => {
            const meta = CATEGORY_META[entry.category];
            const selected = activeEntry?.app === entry.app;
            const settings = settingCountOf(entry, nativeRuntime);
            return (
              <button
                key={entry.app}
                onClick={() => setActiveApp(entry.app)}
                className="w-full text-left rounded-[16px] border px-3 py-3 active:scale-[0.98] transition-transform"
                style={{
                  background: selected ? '#23211d' : 'rgba(255,253,248,0.84)',
                  color: selected ? '#fffdf8' : '#342f28',
                  borderColor: selected ? '#23211d' : 'rgba(35,33,29,0.09)',
                  boxShadow: selected ? '0 12px 26px -20px rgba(35,33,29,0.65)' : '0 8px 22px -22px rgba(35,33,29,0.3)',
                }}
              >
                <div className="text-[13px] font-black leading-snug">{entry.app}</div>
                <div className="label-mono text-[8px] mt-1 opacity-55 truncate">{entry.en}</div>
                <div className="text-[9px] mt-2 opacity-70 truncate">{meta.label}{settings ? ` · ${settings} 项设置` : ''}</div>
              </button>
            );
          })}
        </div>

        <div className="min-h-0 overflow-y-auto no-scrollbar">
          {activeEntry && (
            <article className="relative overflow-hidden rounded-[22px] bg-[#fffdf8] border border-black/10 shadow-[0_18px_42px_-30px_rgba(35,33,29,0.55)]">
              <div
                aria-hidden
                className="absolute inset-0 opacity-[0.18] pointer-events-none"
                style={{
                  backgroundImage:
                    'linear-gradient(rgba(35,33,29,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(35,33,29,0.05) 1px, transparent 1px)',
                  backgroundSize: '18px 18px',
                }}
              />
              <div className="relative px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="label-mono text-[9px] tracking-[0.28em] text-[#9a8c75]">
                      {CATEGORY_META[activeEntry.category].en}
                    </div>
                    <h2 className="text-[27px] font-black leading-tight tracking-wide mt-1">{activeEntry.app}</h2>
                    <div className="label-mono text-[9px] text-[#9a8c75] mt-1">{activeEntry.en}</div>
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-2">
                    <div className="w-10 h-10 rounded-full bg-[#23211d] text-white flex items-center justify-center">
                      {ActiveAppIcon
                        ? <ActiveAppIcon className="w-5 h-5" />
                        : React.createElement(CATEGORY_META[activeEntry.category].Icon, { size: 20, weight: 'bold' })}
                    </div>
                    {activeDestination && (
                      <button
                        onClick={openDestination}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-[#23211d] text-[#fffdf8] text-[11px] font-black shadow-[0_12px_24px_-18px_rgba(35,33,29,0.7)] active:scale-95 transition-transform"
                      >
                        <span>{activeDestination.jumpText || '打开 App'}</span>
                        <CaretRight size={12} weight="bold" />
                      </button>
                    )}
                  </div>
                </div>

                <p className="mt-4 text-[13px] leading-relaxed text-[#5c5143]">
                  {activeEntry.summary}
                </p>

                {activeDestination && (
                  <div className="mt-4 rounded-[16px] bg-[#f7f1e6] border border-black/[0.06] px-3.5 py-3">
                    <div className="label-mono text-[9px] tracking-[0.22em] text-[#9a8c75]">进入路径</div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {activeDestination.path.map((step, index) => (
                        <React.Fragment key={`${activeEntry.app}-path-${step}`}>
                          <span className="px-2.5 py-1 rounded-full bg-[#fffdf8] border border-black/[0.06] text-[11px] font-bold text-[#5c5143]">
                            {step}
                          </span>
                          {index < activeDestination.path.length - 1 && (
                            <CaretRight size={12} weight="bold" className="text-[#9a8c75]" />
                          )}
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                )}

                {activeEntry.beginnerSteps && activeEntry.beginnerSteps.length > 0 && (
                  <div className="mt-5 rounded-[16px] bg-[#23211d] text-[#fffdf8] px-3.5 py-3">
                    <div className="flex items-center gap-2 text-[11px] font-black">
                      <Sparkle size={14} weight="bold" />
                      新手先看
                    </div>
                    <div className="mt-2 space-y-1.5">
                      {activeEntry.beginnerSteps.map((step, index) => (
                        <p key={step} className="text-[11px] leading-relaxed text-white/78">
                          <span className="font-black text-white">{index + 1}. </span>{step}
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-5">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="h-px flex-1 bg-black/10" />
                    <span className="label-mono text-[9px] tracking-[0.24em] text-[#9a8c75]">功能说明</span>
                    <span className="h-px flex-1 bg-black/10" />
                  </div>
                  <div className="space-y-2.5">
                    {activeEntry.features.map((feature, index) => (
                      <div key={feature} className="flex items-start gap-2.5 rounded-[15px] bg-[#f7f1e6] border border-black/[0.06] px-3 py-2.5">
                        <span className="shrink-0 w-5 h-5 rounded-full bg-[#23211d] text-[#fffdf8] label-mono text-[10px] font-bold flex items-center justify-center mt-0.5">
                          {index + 1}
                        </span>
                        <span className="text-[12px] leading-relaxed text-[#4d4439]">{feature}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {visibleSectionsOf(activeEntry, nativeRuntime).length > 0 && (
                  <div className="mt-5">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="h-px flex-1 bg-black/10" />
                      <span className="inline-flex items-center gap-1 label-mono text-[9px] tracking-[0.24em] text-[#9a8c75]">
                        <SlidersHorizontal size={12} weight="bold" />
                        设置与开关
                      </span>
                      <span className="h-px flex-1 bg-black/10" />
                    </div>
                    <div className="space-y-3">
                      {visibleSectionsOf(activeEntry, nativeRuntime).map(section => (
                        <section key={section.id} className="rounded-[18px] bg-white/80 border border-black/[0.06] px-3 py-3">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <h3 className="text-[13px] font-black text-[#342f28]">{section.title}</h3>
                              {section.description && <p className="text-[11px] leading-relaxed text-[#7b705f] mt-0.5">{section.description}</p>}
                            </div>
                            <span className="shrink-0 label-mono text-[8px] text-[#9a8c75]">{section.settings.length} ITEMS</span>
                          </div>
                          <div className="mt-2.5 space-y-2.5">
                            {section.settings.map(setting => (
                              <div key={setting.id} className="rounded-[15px] bg-[#f7f1e6] border border-black/[0.06] px-3 py-3">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <h4 className="text-[12.5px] font-black text-[#3d362e] leading-snug">{setting.title}</h4>
                                    <p className="mt-1 text-[11.5px] leading-relaxed text-[#5c5143]">{setting.description}</p>
                                  </div>
                                  {(setting.deepLink || activeDestination?.deepLink) && (
                                    <button
                                      onClick={() => jumpTo(setting.deepLink || activeDestination?.deepLink || null)}
                                      className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-[#23211d] text-[#fffdf8] text-[10px] font-black active:scale-95 transition-transform"
                                    >
                                      跳到这里
                                      <CaretRight size={10} weight="bold" />
                                    </button>
                                  )}
                                </div>
                                {setting.defaultBehavior && (
                                  <div className="mt-2 rounded-[12px] bg-white/72 border border-black/[0.05] px-2.5 py-2 text-[10.5px] leading-relaxed text-[#6b604f]">
                                    <span className="font-black text-[#3d362e]">默认行为：</span>{setting.defaultBehavior}
                                  </div>
                                )}
                                {setting.options && setting.options.length > 0 && (
                                  <div className="mt-2 grid gap-1.5">
                                    {setting.options.map(option => (
                                      <div key={`${setting.id}-${option.label}`} className="rounded-[12px] bg-white/72 border border-black/[0.05] px-2.5 py-2">
                                        <div className="text-[10.5px] font-black text-[#3d362e]">{option.label}</div>
                                        <div className="mt-0.5 text-[10.5px] leading-relaxed text-[#6b604f]">{option.description}</div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                <SettingPath setting={setting} />
                              </div>
                            ))}
                          </div>
                        </section>
                      ))}
                    </div>
                  </div>
                )}

                {activeDestination && activeDestination.details.length > 0 && (
                  <div className="mt-5">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="h-px flex-1 bg-black/10" />
                      <span className="label-mono text-[9px] tracking-[0.24em] text-[#9a8c75]">适合怎么用</span>
                      <span className="h-px flex-1 bg-black/10" />
                    </div>
                    <div className="space-y-2">
                      {activeDestination.details.map((detail) => (
                        <div key={detail} className="rounded-[15px] bg-white/75 border border-black/[0.06] px-3 py-2.5 text-[12px] leading-relaxed text-[#4d4439]">
                          {detail}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {activeEntry.commonQuestions && activeEntry.commonQuestions.length > 0 && (
                  <div className="mt-5">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="h-px flex-1 bg-black/10" />
                      <span className="label-mono text-[9px] tracking-[0.24em] text-[#9a8c75]">常见困惑</span>
                      <span className="h-px flex-1 bg-black/10" />
                    </div>
                    <div className="space-y-2">
                      {activeEntry.commonQuestions.map((item) => (
                        <div key={item.title} className="rounded-[15px] bg-[#f7f1e6] border border-black/[0.06] px-3 py-2.5">
                          <div className="text-[12px] font-black text-[#3d362e]">{item.title}</div>
                          <div className="mt-1 text-[11.5px] leading-relaxed text-[#5c5143]">{item.answer}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {activeEntry.tips && activeEntry.tips.length > 0 && (
                  <div className="mt-5 rounded-[16px] bg-[#23211d] text-[#fffdf8] px-3.5 py-3">
                    <div className="flex items-center gap-2 text-[11px] font-black">
                      <Wrench size={14} weight="bold" />
                      使用提示
                    </div>
                    <div className="mt-2 space-y-1.5">
                      {activeEntry.tips.map((tip) => (
                        <p key={tip} className="text-[11px] leading-relaxed text-white/78">{tip}</p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </article>
          )}
        </div>
      </div>
    </div>
  );
};

export default ManualApp;
