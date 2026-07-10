import React from 'react';
import { createRoot } from 'react-dom/client';
import { INSTALLED_APPS } from '../../constants';
import type { PhoneEvidence } from '../../types';
import type { ScreenPeekSnapshot } from '../../utils/screenPeek';
import { toWallpaperBackground } from '../../utils/defaultWallpapers';

export const SCREEN_PEEK_CAPTURE_WIDTH = 390;
export const SCREEN_PEEK_CAPTURE_HEIGHT = 780;

const fmtTime = (ts?: number) => {
  const d = new Date(ts || Date.now());
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const shortDate = (ts?: number) => {
  const d = new Date(ts || Date.now());
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

const clip = (value?: string, limit = 120) => {
  const clean = (value || '').replace(/\s+/g, ' ').trim();
  return clean.length > limit ? `${clean.slice(0, limit)}...` : clean;
};

const sourceText = (record: PhoneEvidence) => {
  if (record.meta?.source === 'xunji') return '循迹';
  if (record.meta?.source === 'user_action') return '改动';
  if (record.meta?.source === 'custom') return '自装';
  return '手机';
};

const recordTime = (record: PhoneEvidence) =>
  record.value || fmtTime(record.timestamp);

const appIconLabel = (name: string) => name.trim().slice(0, 1) || 'A';

const appAccent = (snapshot: ScreenPeekSnapshot) => snapshot.accent || '#475569';

const phoneWallpaper = (snapshot: ScreenPeekSnapshot) =>
  toWallpaperBackground(snapshot.wallpaper, 'linear-gradient(160deg,#42526e 0%,#20283b 48%,#101827 100%)');

const parseChatLines = (record?: PhoneEvidence) => {
  const lines = (record?.detail || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .slice(-9);
  if (!lines.length && record?.title) return [{ side: 'left' as const, text: clip(record.detail || record.title, 120), name: record.title }];
  return lines.map((line, index) => {
    const match = line.match(/^([^:：]{1,24})[:：]\s*(.*)$/);
    const speaker = match?.[1]?.trim() || '';
    const text = match?.[2]?.trim() || line;
    const self = /^(我|me|自己|ta)$/i.test(speaker) || index % 3 === 1;
    return { side: self ? 'right' as const : 'left' as const, text: clip(text, 150), name: speaker };
  });
};

const SnapshotStatusBar: React.FC<{ snapshot: ScreenPeekSnapshot; dark?: boolean }> = ({ snapshot, dark }) => {
  const color = dark ? '#fff' : '#0f172a';
  const battery = Math.max(8, Math.min(100, snapshot.batteryLevel || 72));
  return (
    <div className="h-10 px-6 pt-3 flex items-center justify-between text-[13px] font-bold tabular-nums shrink-0" style={{ color }}>
      <span>{fmtTime(snapshot.generatedAt)}</span>
      <span className="w-[92px]" />
      <span className="flex items-center gap-1.5 text-[11px]">
        <span className="tracking-[0.12em]">5G</span>
        <span className="inline-flex h-[11px] w-[24px] rounded-[4px] border p-[1.5px]" style={{ borderColor: dark ? 'rgba(255,255,255,.76)' : 'rgba(15,23,42,.65)' }}>
          <span className="block rounded-[2px]" style={{ width: `${battery}%`, background: battery < 18 ? '#ef4444' : color }} />
        </span>
      </span>
    </div>
  );
};

const AppHeader: React.FC<{ snapshot: ScreenPeekSnapshot; title?: string; subtitle?: string }> = ({ snapshot, title, subtitle }) => (
  <div className="h-[78px] px-4 bg-white border-b border-slate-200 flex items-center gap-3 shrink-0">
    <div className="w-9 h-9 rounded-full flex items-center justify-center text-[24px] text-slate-800 shrink-0">&lt;</div>
    <div className="min-w-0 flex-1 text-center">
      <div className="text-[20px] leading-6 font-black text-slate-950 truncate">{title || snapshot.title}</div>
      {(subtitle || snapshot.subtitle || snapshot.appName) && (
        <div className="mt-1 text-[12px] leading-4 text-slate-400 truncate">{subtitle || snapshot.subtitle || snapshot.appName}</div>
      )}
    </div>
    <div className="w-9 h-9 rounded-full flex items-center justify-center text-[20px] text-slate-700 shrink-0">...</div>
  </div>
);

const RowCard: React.FC<{ record: PhoneEvidence; accent: string; compact?: boolean }> = ({ record, accent, compact }) => (
  <div className={`rounded-[18px] bg-white border border-slate-100 shadow-[0_12px_30px_-24px_rgba(15,23,42,.7)] ${compact ? 'px-3 py-2.5' : 'px-4 py-3.5'}`}>
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <div className="text-[15px] leading-5 font-black text-slate-950 truncate">{record.title || record.meta?.appName || record.type}</div>
        <div className="mt-1 text-[11px] text-slate-400 truncate">{recordTime(record)} · {sourceText(record)}</div>
      </div>
      {record.value && (
        <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black" style={{ color: accent, background: `${accent}14` }}>
          {clip(record.value, 14)}
        </span>
      )}
    </div>
    {record.detail && <div className="mt-2 text-[12px] leading-relaxed text-slate-500 whitespace-pre-wrap break-words line-clamp-3">{clip(record.detail, compact ? 96 : 160)}</div>}
    {(record.meta?.tags || []).length > 0 && (
      <div className="mt-2 flex flex-wrap gap-1">
        {record.meta!.tags!.slice(0, 3).map(tag => <span key={tag} className="text-[9px] font-bold rounded-full bg-slate-100 text-slate-500 px-1.5 py-0.5">#{tag}</span>)}
      </div>
    )}
  </div>
);

const HomeScreen: React.FC<{ snapshot: ScreenPeekSnapshot }> = ({ snapshot }) => {
  const apps = INSTALLED_APPS.filter(app => app.id !== 'launcher').slice(0, 16);
  return (
    <div className="absolute inset-0 overflow-hidden text-white" style={{ background: phoneWallpaper(snapshot), backgroundSize: 'cover', backgroundPosition: 'center' }}>
      <div className="absolute inset-0 bg-gradient-to-b from-black/18 via-transparent to-black/38" />
      <div className="relative z-10 h-full flex flex-col">
        <SnapshotStatusBar snapshot={snapshot} dark />
        <div className="px-6 pt-6 pb-2">
          <div className="flex items-center gap-3">
            {snapshot.charAvatar && <img src={snapshot.charAvatar} alt="" className="w-14 h-14 rounded-[18px] object-cover ring-1 ring-white/30 shadow-xl" />}
            <div className="min-w-0">
              <div className="text-[18px] font-black truncate">{snapshot.deviceName}</div>
              <div className="mt-1 text-[12px] text-white/72 truncate">{snapshot.tagline}</div>
            </div>
          </div>
        </div>
        <div className="flex-1 px-6 pt-6 grid grid-cols-4 auto-rows-min gap-x-4 gap-y-5">
          {apps.map(app => (
            <div key={app.id} className="min-w-0 text-center">
              <div className="mx-auto w-[54px] h-[54px] rounded-[18px] bg-white/92 text-slate-800 shadow-[0_12px_28px_-16px_rgba(0,0,0,.72)] flex items-center justify-center text-[20px] font-black">
                {appIconLabel(app.name)}
              </div>
              <div className="mt-1.5 text-[10px] font-bold truncate text-white/90">{app.name}</div>
            </div>
          ))}
        </div>
        <div className="mx-6 mb-8 rounded-[28px] bg-white/24 border border-white/24 backdrop-blur-md px-5 py-3">
          <div className="text-[11px] text-white/62">最近状态</div>
          <div className="mt-1 text-[13px] font-bold truncate">{snapshot.summary}</div>
        </div>
      </div>
    </div>
  );
};

const LockScreen: React.FC<{ snapshot: ScreenPeekSnapshot }> = ({ snapshot }) => (
  <div className="absolute inset-0 overflow-hidden text-white" style={{ background: phoneWallpaper(snapshot), backgroundSize: 'cover', backgroundPosition: 'center' }}>
    <div className="absolute inset-0 bg-black/68 backdrop-blur-sm" />
    <div className="relative z-10 h-full flex flex-col">
      <SnapshotStatusBar snapshot={snapshot} dark />
      <div className="px-8 pt-12 text-center">
        {snapshot.charAvatar && <img src={snapshot.charAvatar} className="mx-auto w-20 h-20 rounded-[24px] object-cover ring-1 ring-white/20 shadow-xl" alt="" />}
        <div className="mt-5 text-[34px] font-light tabular-nums">{fmtTime(snapshot.generatedAt)}</div>
        <div className="mt-2 text-[13px] tracking-[0.24em] text-white/62">手机已锁住</div>
      </div>
      <div className="flex-1 flex flex-col justify-center px-8 pb-20">
        <div className="text-center text-[24px] leading-[1.65] font-serif font-bold whitespace-pre-wrap">
          {snapshot.lock?.note || snapshot.lock?.message || snapshot.summary}
        </div>
        <div className="mt-10 rounded-[22px] px-4 py-4 border border-white/10 bg-white/6">
          <div className="text-[11px] text-white/45">解锁提示</div>
          <div className="mt-1 text-[14px] leading-relaxed">{snapshot.lock?.questions?.[0]?.text || '等待 TA 解锁。'}</div>
        </div>
      </div>
    </div>
  </div>
);

const ChatScreen: React.FC<{ snapshot: ScreenPeekSnapshot }> = ({ snapshot }) => {
  const primary = snapshot.records[0];
  const lines = parseChatLines(primary);
  return (
    <div className="absolute inset-0 flex flex-col bg-[#ededed]">
      <SnapshotStatusBar snapshot={snapshot} />
      <AppHeader snapshot={snapshot} title={primary?.title || snapshot.title} subtitle={snapshot.appName} />
      <div className="flex-1 min-h-0 overflow-hidden px-4 py-4 space-y-3">
        {lines.map((msg, index) => {
          const right = msg.side === 'right';
          return (
            <div key={index} className={`flex ${right ? 'justify-end' : 'justify-start'} gap-2`}>
              {!right && <div className="w-8 h-8 rounded-[10px] bg-slate-300 text-slate-600 flex items-center justify-center text-[11px] font-black shrink-0">{(msg.name || primary?.title || '?').slice(0, 1)}</div>}
              <div className={`max-w-[76%] rounded-[18px] px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap break-words ${right ? 'bg-[#95ec69] rounded-br-[5px]' : 'bg-white rounded-bl-[5px] shadow-sm'}`}>
                {msg.text}
              </div>
              {right && snapshot.charAvatar && <img src={snapshot.charAvatar} className="w-8 h-8 rounded-[10px] object-cover shrink-0" alt="" />}
            </div>
          );
        })}
      </div>
      <div className="h-[66px] bg-white border-t border-slate-200 px-3 flex items-center gap-2 shrink-0">
        <div className="w-8 h-8 rounded-full border border-slate-300 flex items-center justify-center text-slate-500 text-lg">+</div>
        <div className="h-10 flex-1 rounded-[14px] bg-slate-50 border border-slate-200" />
        <div className="w-8 h-8 rounded-full border border-slate-300 flex items-center justify-center text-slate-500 text-lg">#</div>
      </div>
    </div>
  );
};

const MusicScreen: React.FC<{ snapshot: ScreenPeekSnapshot }> = ({ snapshot }) => {
  const accent = appAccent(snapshot);
  const current = snapshot.records[0];
  return (
    <div className="absolute inset-0 flex flex-col bg-[#101318] text-white">
      <SnapshotStatusBar snapshot={snapshot} dark />
      <AppHeader snapshot={snapshot} title={snapshot.appName} subtitle="正在播放" />
      <div className="flex-1 min-h-0 px-7 pt-9 pb-6 text-center">
        <div className="mx-auto w-[210px] h-[210px] rounded-[34px] shadow-2xl flex items-center justify-center" style={{ background: `linear-gradient(145deg, ${accent}, #111827 62%, #020617)` }}>
          <span className="w-20 h-20 rounded-full border-2 border-white/72 flex items-center justify-center text-[38px]">♪</span>
        </div>
        <div className="mt-8 text-[24px] leading-7 font-black truncate">{current?.title || snapshot.title}</div>
        <div className="mt-2 text-[13px] leading-relaxed text-white/58 line-clamp-3">{current?.detail || snapshot.summary}</div>
        <div className="mt-8 h-1.5 rounded-full bg-white/14 overflow-hidden"><div className="h-full w-[42%] rounded-full" style={{ background: accent }} /></div>
        <div className="mt-2 flex justify-between text-[10px] text-white/38 tabular-nums"><span>1:18</span><span>3:40</span></div>
        <div className="mt-7 flex items-center justify-center gap-10 text-[26px]"><span>‹</span><span className="w-16 h-16 rounded-full bg-white text-slate-950 flex items-center justify-center">▶</span><span>›</span></div>
      </div>
    </div>
  );
};

const NotesScreen: React.FC<{ snapshot: ScreenPeekSnapshot }> = ({ snapshot }) => {
  const record = snapshot.records[0];
  const privateMode = snapshot.appKind === 'secret_space';
  return (
    <div className={`absolute inset-0 flex flex-col ${privateMode ? 'bg-[#111827] text-white' : 'bg-[#fff8d7] text-amber-950'}`}>
      <SnapshotStatusBar snapshot={snapshot} dark={privateMode} />
      <AppHeader snapshot={snapshot} title={snapshot.appName} subtitle={privateMode ? '私密记录' : '刚刚停在这里'} />
      <div className="flex-1 min-h-0 px-6 py-6 overflow-hidden">
        <div className="text-[28px] leading-9 font-black">{record?.title || snapshot.title}</div>
        <div className={`mt-2 text-[12px] ${privateMode ? 'text-white/42' : 'text-amber-700/55'}`}>{record ? recordTime(record) : shortDate(snapshot.generatedAt)}</div>
        <div className="mt-7 text-[17px] leading-8 whitespace-pre-wrap break-words">{record?.detail || snapshot.summary}</div>
      </div>
    </div>
  );
};

const GalleryScreen: React.FC<{ snapshot: ScreenPeekSnapshot }> = ({ snapshot }) => (
  <div className="absolute inset-0 flex flex-col bg-white">
    <SnapshotStatusBar snapshot={snapshot} />
    <AppHeader snapshot={snapshot} title={snapshot.appName} subtitle={`${snapshot.records.length || 0} 项`} />
    <div className="grid grid-cols-3 gap-1 p-2">
      {(snapshot.records.length ? snapshot.records : [{ id: 'empty', title: '最近照片', detail: snapshot.summary, timestamp: snapshot.generatedAt, type: 'album' } as PhoneEvidence]).slice(0, 18).map((record, index) => (
        <div key={record.id || index} className="aspect-square bg-slate-100 overflow-hidden relative p-2 flex flex-col justify-end">
          <div className="absolute inset-0" style={{ background: `linear-gradient(145deg, hsl(${(index * 43) % 360} 58% 86%), #f8fafc)` }} />
          <div className="relative text-[10px] leading-tight font-bold text-slate-700 line-clamp-3">{record.title}</div>
        </div>
      ))}
    </div>
  </div>
);

const MapScreen: React.FC<{ snapshot: ScreenPeekSnapshot }> = ({ snapshot }) => (
  <div className="absolute inset-0 overflow-hidden bg-[#d9efe0]">
    <SnapshotStatusBar snapshot={snapshot} />
    <AppHeader snapshot={snapshot} title={snapshot.appName} subtitle={snapshot.records[0]?.title || '位置线索'} />
    <div className="absolute left-0 right-0 top-[128px] bottom-0 overflow-hidden">
      <div className="absolute inset-0 opacity-70" style={{ backgroundImage: 'linear-gradient(30deg, transparent 45%, rgba(255,255,255,.72) 46%, rgba(255,255,255,.72) 54%, transparent 55%), linear-gradient(120deg, transparent 42%, rgba(96,165,250,.42) 43%, rgba(96,165,250,.42) 50%, transparent 51%)', backgroundSize: '92px 70px, 140px 120px' }} />
      {snapshot.records.slice(0, 6).map((record, index) => (
        <div key={record.id} className="absolute w-8 h-8 rounded-full bg-red-500 text-white text-[11px] font-black flex items-center justify-center shadow-lg" style={{ left: `${20 + (index * 17) % 58}%`, top: `${20 + (index * 23) % 48}%` }}>{index + 1}</div>
      ))}
      <div className="absolute left-4 right-4 bottom-5 rounded-[22px] bg-white shadow-xl p-4">
        <div className="text-[15px] font-black truncate">{snapshot.records[0]?.title || snapshot.title}</div>
        <div className="mt-1 text-[12px] text-slate-500 line-clamp-3">{snapshot.records[0]?.detail || snapshot.summary}</div>
      </div>
    </div>
  </div>
);

const ListScreen: React.FC<{ snapshot: ScreenPeekSnapshot }> = ({ snapshot }) => {
  const accent = appAccent(snapshot);
  const delivery = snapshot.appKind === 'delivery' || snapshot.appKind === 'order';
  const social = snapshot.appKind === 'social';
  return (
    <div className={`absolute inset-0 flex flex-col ${delivery ? 'bg-[#f7f7f7]' : social ? 'bg-white' : 'bg-slate-50'}`}>
      <SnapshotStatusBar snapshot={snapshot} />
      <AppHeader snapshot={snapshot} title={snapshot.appName} subtitle={snapshot.subtitle || `${snapshot.records.length} 条记录`} />
      {delivery && (
        <div className="grid grid-cols-4 text-center text-[13px] font-black bg-white border-b border-slate-100">
          {['收藏', '内容', '最近', '更多'].map((tab, index) => (
            <div key={tab} className="py-3 relative" style={{ color: index === 0 ? accent : '#64748b' }}>
              {tab}
              {index === 0 && <span className="absolute left-1/2 bottom-0 h-[3px] w-8 -translate-x-1/2 rounded-full" style={{ background: accent }} />}
            </div>
          ))}
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-hidden p-4 space-y-3">
        {(snapshot.records.length ? snapshot.records : [{ id: 'empty', title: snapshot.title, detail: snapshot.summary, timestamp: snapshot.generatedAt, type: snapshot.appKind } as PhoneEvidence]).slice(0, 7).map(record => (
          <RowCard key={record.id} record={record} accent={accent} compact={snapshot.records.length > 4} />
        ))}
      </div>
    </div>
  );
};

const SnapshotScreen: React.FC<{ snapshot: ScreenPeekSnapshot }> = ({ snapshot }) => {
  if (snapshot.appKind === 'lock') return <LockScreen snapshot={snapshot} />;
  if (snapshot.appKind === 'home') return <HomeScreen snapshot={snapshot} />;
  if (snapshot.appKind === 'chat') return <ChatScreen snapshot={snapshot} />;
  if (snapshot.appKind === 'music') return <MusicScreen snapshot={snapshot} />;
  if (snapshot.appKind === 'notes' || snapshot.appKind === 'secret_space') return <NotesScreen snapshot={snapshot} />;
  if (snapshot.appKind === 'album') return <GalleryScreen snapshot={snapshot} />;
  if (snapshot.appKind === 'map') return <MapScreen snapshot={snapshot} />;
  return <ListScreen snapshot={snapshot} />;
};

const PhoneFrame: React.FC<{ snapshot: ScreenPeekSnapshot; className?: string }> = ({ snapshot, className = '' }) => (
  <div
    className={`relative bg-[#050617] p-[8px] rounded-[48px] shadow-[0_34px_84px_-34px_rgba(0,0,0,.9)] overflow-hidden ${className}`}
    style={{ width: SCREEN_PEEK_CAPTURE_WIDTH, height: SCREEN_PEEK_CAPTURE_HEIGHT }}
  >
    <div className="absolute left-1/2 top-[17px] z-40 h-[35px] w-[126px] -translate-x-1/2 rounded-full bg-black shadow" />
    <div className="relative h-full w-full overflow-hidden rounded-[40px] bg-white">
      <SnapshotScreen snapshot={snapshot} />
      <div className="absolute left-0 right-0 bottom-0 h-7 bg-white flex items-center justify-center z-30">
        <div className="w-28 h-1.5 rounded-full bg-black" />
      </div>
    </div>
  </div>
);

const ScreenPeekPhoneSnapshot: React.FC<{ snapshot: ScreenPeekSnapshot; className?: string }> = ({ snapshot, className }) => (
  <PhoneFrame snapshot={snapshot} className={className} />
);

export async function captureScreenPeekSnapshotImage(snapshot: ScreenPeekSnapshot): Promise<string> {
  if (typeof document === 'undefined') throw new Error('当前环境不能截图');
  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '-10000px';
  host.style.top = '0';
  host.style.width = `${SCREEN_PEEK_CAPTURE_WIDTH}px`;
  host.style.height = `${SCREEN_PEEK_CAPTURE_HEIGHT}px`;
  host.style.pointerEvents = 'none';
  host.style.background = 'transparent';
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    root.render(<ScreenPeekPhoneSnapshot snapshot={snapshot} />);
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    if ((document as any).fonts?.ready) {
      try { await (document as any).fonts.ready; } catch { /* ignore */ }
    }
    const html2canvas = (await import('html2canvas')).default;
    const canvas = await html2canvas(host.firstElementChild as HTMLElement, {
      backgroundColor: null,
      scale: Math.min(2.5, Math.max(2, window.devicePixelRatio || 2)),
      useCORS: true,
      logging: false,
    });
    return canvas.toDataURL('image/png');
  } finally {
    root.unmount();
    host.remove();
  }
}

export default ScreenPeekPhoneSnapshot;
