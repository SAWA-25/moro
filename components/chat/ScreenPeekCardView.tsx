import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Message, ScreenPeekCard } from '../../types';
import { screenPeekCardUsesScreenshot } from '../../utils/screenPeek';

type Screen = NonNullable<ScreenPeekCard['screen']>;
type Row = NonNullable<Screen['rows']>[number];

const fmtTime = (ts?: number) => {
  if (!ts) return '';
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const rowsFor = (card: ScreenPeekCard, screen: Screen): Row[] => (
  screen.rows?.length ? screen.rows : [{
    id: 'screen-row',
    title: screen.title || screen.appName,
    subtitle: screen.appName,
    body: screen.action || card.narrative,
    meta: screen.timeText || fmtTime(card.generatedAt),
  }]
).slice(0, 12);

const text = (value?: string, fallback = '') => (value || fallback).trim();

const ScreenPeekCardView: React.FC<{
  m: Message;
  commonLayout: (content: React.ReactNode) => JSX.Element;
}> = ({ m, commonLayout }) => {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded || typeof document === 'undefined') return;
    const old = document.body.style.overflow;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = old;
      window.removeEventListener('keydown', onKey);
    };
  }, [expanded]);

  const card: ScreenPeekCard | null = (() => {
    if (m.metadata?.screenPeek) return m.metadata.screenPeek as ScreenPeekCard;
    try { return JSON.parse(m.content) as ScreenPeekCard; } catch { return null; }
  })();

  if (!card) {
    return commonLayout(<div className="text-xs text-slate-400">窥屏卡片无法解析</div>);
  }

  if (screenPeekCardUsesScreenshot(card)) {
    const title = card.snapshotTitle || card.title || `${card.charName} 的手机屏幕`;
    const appName = card.snapshotAppName || '手机';
    const overlay = expanded && typeof document !== 'undefined'
      ? createPortal(
        <div className="fixed inset-0 z-[9998] bg-black text-white flex flex-col animate-fade-in" style={{ paddingTop: 'calc(var(--safe-top, 0px) + 14px)', paddingBottom: 'calc(var(--safe-bottom, 0px) + 14px)' }} onClick={() => setExpanded(false)}>
          <button type="button" onClick={(event) => { event.stopPropagation(); setExpanded(false); }} className="fixed right-4 z-[10000] h-10 px-3 rounded-full bg-white active:scale-95 border border-slate-200 text-slate-950 text-[12px] font-bold flex items-center gap-1.5" style={{ top: 'calc(var(--safe-top, 0px) + 14px)' }} aria-label="关闭窥屏"><span className="text-lg leading-none">x</span><span>关闭</span></button>
          <div className="shrink-0 px-5 pr-24 min-h-10 flex flex-col justify-center pointer-events-none">
            <div className="text-[13px] font-bold truncate">{title}</div>
            <div className="text-[10px] text-white/45 truncate">{card.charName} · {appName} · {new Date(card.generatedAt).toLocaleString()}</div>
          </div>
          <div className="flex-1 min-h-0 overflow-hidden px-4 pt-3 flex items-center justify-center" onClick={(event) => event.stopPropagation()}>
            <img
              src={card.screenshotDataUrl}
              alt={title}
              className="block max-h-full max-w-full object-contain rounded-[30px] shadow-[0_30px_80px_-38px_rgba(255,255,255,.45)]"
              draggable={false}
            />
          </div>
          <div className="shrink-0 pt-3 text-center text-[10px] text-white/35 pointer-events-none">点空白处或按 Esc 退出</div>
        </div>,
        document.body,
      )
      : null;
    return (
      <>
        {commonLayout(
          <button type="button" onClick={(event) => { event.stopPropagation(); setExpanded(true); }} className="block text-left rounded-[30px] active:scale-[0.98] transition-transform">
            <img
              src={card.screenshotDataUrl}
              alt={title}
              className="block w-[258px] h-auto rounded-[32px] shadow-[0_24px_62px_-28px_rgba(0,0,0,.85)] bg-slate-950"
              draggable={false}
            />
          </button>,
        )}
        {overlay}
      </>
    );
  }

  const fallbackScreen: Screen = {
    appKind: card.chats?.length ? 'chat' : card.browsed?.length ? 'browser' : 'app',
    appName: card.chats?.length ? '聊天' : card.browsed?.[0]?.appName || '手机',
    title: card.chats?.[0]?.target || card.browsed?.[0]?.title || `${card.charName} 的手机`,
    subtitle: card.browsed?.[0]?.appName,
    action: card.narrative,
    timeText: fmtTime(card.generatedAt),
    batteryLevel: 80,
    messages: card.chats?.[0] ? [
      { id: 'summary', side: 'center' as const, text: card.chats[0].summary },
      ...(card.chats[0].messages || []).slice(0, 6).map((line, index) => ({
        id: `msg-${index}`,
        side: (index % 3 === 0 ? 'right' : 'left') as 'left' | 'right',
        text: line,
      })),
    ] : undefined,
    rows: (card.browsed || []).map(item => ({
      id: item.id,
      title: item.title,
      subtitle: item.appName,
      body: item.summary,
      meta: fmtTime(item.time),
    })),
    notes: (card.notes || []).map(note => ({ id: note.id, text: note.text, meta: fmtTime(note.time) })),
  };

  const screen = card.screen || fallbackScreen;
  const rows = rowsFor(card, screen);
  const battery = Math.max(8, Math.min(100, Number(screen.batteryLevel ?? 80)));
  const toplessKinds = new Set<Screen['appKind']>(['browser', 'calendar', 'home']);
  const hasAppHeader = !toplessKinds.has(screen.appKind);
  const contentTop = hasAppHeader ? 'top-[105px]' : 'top-9';
  const pageBg = screen.appKind === 'chat' ? 'bg-[#ededed]' :
    screen.appKind === 'notes' ? 'bg-[#fff8d7]' :
    screen.appKind === 'music' ? 'bg-[#111827]' :
    screen.appKind === 'calendar' ? 'bg-white' :
    'bg-white';

  const renderChat = () => (
    <div className="px-4 py-4 space-y-2.5">
      {(screen.messages || []).slice(0, 12).map((msg, index) => {
        if (msg.side === 'center') return <div key={msg.id || index} className="text-center text-[10px] text-slate-400 py-1">{msg.text}</div>;
        const right = msg.side === 'right';
        return (
          <div key={msg.id || index} className={`flex ${right ? 'justify-end' : 'justify-start'} gap-2`}>
            {!right && (screen.contactAvatar ? <img src={screen.contactAvatar} alt="" className="w-7 h-7 rounded-full object-cover shrink-0 mt-1" /> : <div className="w-7 h-7 rounded-full bg-slate-300 shrink-0 mt-1" />)}
            <div className={`max-w-[76%] rounded-[18px] px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap break-words ${right ? 'bg-[#95ec69] text-slate-900 rounded-br-[5px]' : 'bg-white text-slate-800 rounded-bl-[5px] shadow-sm'}`}>
              {msg.imageUrl ? <img src={msg.imageUrl} alt="" className="rounded-xl max-w-full" /> : msg.text}
            </div>
          </div>
        );
      })}
    </div>
  );

  const renderBrowser = () => {
    const first = rows[0];
    const isSearch = screen.layout === 'search' || !first?.body;
    return (
      <div className="min-h-full bg-white text-slate-950">
        <div className="sticky top-0 z-10 bg-white border-b border-slate-100 px-3 py-2">
          <div className="h-9 rounded-full bg-slate-100 px-3 flex items-center gap-2 text-[10px] text-slate-500">
            <span className="shrink-0">lock</span>
            <span className="truncate">{screen.url || first?.subtitle || screen.appName || 'search.local'}</span>
            <span className="ml-auto shrink-0 text-[15px] leading-none">...</span>
          </div>
        </div>
        {isSearch ? (
          <div className="px-5 pt-10 text-center">
            <div className="text-[34px] font-black tracking-tight text-slate-800">{screen.appName || 'Browser'}</div>
            <div className="mt-7 h-11 rounded-full bg-slate-100 px-4 flex items-center text-[12px] text-slate-400 text-left">{screen.action || screen.title || '搜索或输入网址'}</div>
            <div className="mt-7 grid grid-cols-4 gap-3">
              {['资讯', '图片', '地图', '翻译', '收藏', '历史', '下载', '设置'].map(item => (
                <div key={item} className="min-w-0">
                  <div className="mx-auto w-10 h-10 rounded-[14px] bg-slate-100 flex items-center justify-center text-[12px] font-black text-slate-500">{item.slice(0, 1)}</div>
                  <div className="mt-1 text-[9px] text-slate-400 truncate">{item}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <article className="px-5 py-4">
            <div className="text-[20px] leading-7 font-black">{first.title || screen.title}</div>
            <div className="mt-1 text-[10px] text-slate-400">{first.meta || screen.timeText} · {screen.appName}</div>
            {first.imageUrl && <div className="mt-4 h-32 rounded-[18px] bg-slate-100 overflow-hidden"><img src={first.imageUrl} alt="" className="w-full h-full object-cover" /></div>}
            <div className="mt-4 space-y-3">
              {[first.body || screen.action || card.narrative, ...rows.slice(1, 4).map(row => row.body || row.title)].filter(Boolean).map((line, index) => (
                <p key={index} className="text-[13px] leading-6 text-slate-600">{line}</p>
              ))}
            </div>
          </article>
        )}
      </div>
    );
  };

  const renderCalendar = () => {
    const d = new Date(card.generatedAt || Date.now());
    const day = d.getDate();
    const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
    return (
      <div className="min-h-full bg-white text-slate-950">
        <div className="sticky top-0 z-10 bg-white border-b border-slate-100 px-5 py-3">
          <div className="flex items-center justify-between text-[12px] font-bold text-red-500">
            <span>日历</span>
            <span>今天</span>
          </div>
          <div className="mt-3 flex items-end gap-3">
            <div className="text-[42px] leading-none font-black text-slate-950">{day}</div>
            <div className="pb-1">
              <div className="text-[14px] font-black">{weekday}</div>
              <div className="text-[10px] text-slate-400">{screen.action || '正在查看今天的安排'}</div>
            </div>
          </div>
        </div>
        <div className="px-5 py-4">
          <div className="space-y-0">
            {rows.slice(0, 8).map((row, index) => (
              <div key={row.id || index} className="grid grid-cols-[44px_1fr] gap-3 min-h-[72px]">
                <div className="pt-1 text-[11px] text-slate-400">{row.meta || screen.timeText || fmtTime(card.generatedAt)}</div>
                <div className="relative border-l border-slate-200 pl-4 pb-5">
                  <span className="absolute -left-[5px] top-1 w-2.5 h-2.5 rounded-full bg-red-500 ring-4 ring-red-50" />
                  <div className="rounded-[16px] bg-red-50 border border-red-100 px-3 py-2.5">
                    <div className="text-[13px] leading-5 font-black text-slate-900">{row.title || '日程'}</div>
                    {row.body && <div className="mt-1 text-[11px] leading-relaxed text-slate-500">{row.body}</div>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderTakeout = () => {
    const appName = screen.appName || '';
    const mode = /下厨房|菜谱|厨房/.test(appName)
      ? 'recipe'
      : /大众点评|点评|探店/.test(appName)
        ? 'review'
        : /美团|饿了么|外卖|点单/.test(appName)
          ? 'delivery'
          : 'store';
    const tabs = (screen.tabs?.length ? screen.tabs : mode === 'recipe'
      ? ['菜谱', '菜单', '作品', '食材', '课堂']
      : mode === 'review'
        ? ['推荐', '附近', '收藏', '榜单', '我的']
        : ['首页', '店铺', '商品', '订单', '我的']).slice(0, 5);
    const active = screen.activeTab || tabs[Math.min(2, tabs.length - 1)] || tabs[0];
    const accent = mode === 'recipe' ? '#16a34a' : mode === 'review' ? '#ff7a00' : '#ff5d4a';
    return (
      <div className="min-h-full bg-[#f7f7f7] text-slate-950">
        <div className="sticky top-0 z-10 bg-white border-b border-slate-100">
          <div className="px-4 pt-2 pb-2 flex items-center gap-3">
            <div className="h-8 flex-1 rounded-full bg-slate-100 px-3 flex items-center text-[11px] text-slate-400">{screen.action || (mode === 'delivery' ? '搜索店铺或商品' : mode === 'recipe' ? '搜索菜谱、食材' : '搜索地点、店铺')}</div>
            <div className="text-[11px] font-bold">管理</div>
          </div>
          <div className="grid grid-cols-5 text-center text-[12px] font-bold">
            {tabs.map(tab => (
              <div key={tab} className="py-2 relative" style={{ color: tab === active ? accent : '#64748b' }}>
                {tab}
                {tab === active && <span className="absolute left-1/2 bottom-0 h-[2px] w-7 -translate-x-1/2 rounded-full" style={{ background: accent }} />}
              </div>
            ))}
          </div>
        </div>
        <div className={mode === 'recipe' ? 'grid grid-cols-2 gap-3 px-3 py-3' : 'px-3 py-3 space-y-3'}>
          {rows.slice(0, mode === 'recipe' ? 8 : 7).map((row, index) => (
            <div key={row.id || index} className={mode === 'recipe' ? 'rounded-[18px] bg-white border border-slate-100 px-3 py-3 shadow-[0_10px_24px_-18px_rgba(15,23,42,.35)]' : 'rounded-[18px] bg-white border border-slate-100 p-3 shadow-[0_10px_26px_-20px_rgba(15,23,42,.45)]'}>
              {row.imageUrl && <img src={row.imageUrl} alt="" className={mode === 'recipe' ? 'w-full h-[86px] rounded-[10px] object-cover mb-2' : 'w-full h-28 rounded-[12px] object-cover mb-2'} />}
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1 text-[14px] leading-5 font-black truncate">{row.title || screen.title || appName}</div>
                {row.badge && <div className="text-[10px] font-black px-1.5 py-0.5 rounded-full" style={{ color: accent, background: `${accent}12` }}>{row.badge}</div>}
              </div>
              <div className="mt-1 text-[10px] text-slate-400 truncate">{row.meta || screen.timeText}</div>
              <div className="mt-1.5 text-[11px] leading-relaxed text-slate-500 line-clamp-2">{row.body || screen.action || card.narrative}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderSocial = () => (
    <div className="min-h-full bg-white text-slate-950">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-slate-900 text-white flex items-center justify-center text-[13px] font-black">{card.charName.slice(0, 1)}</div>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-black truncate">{screen.title || card.charName}</div>
          <div className="text-[10px] text-slate-400 truncate">{screen.appName}</div>
        </div>
        <div className="text-[18px] text-slate-400">...</div>
      </div>
      <div className="px-4 py-3 space-y-4">
        {rows.slice(0, 6).map((row, index) => (
          <div key={row.id || index} className="border-b border-slate-100 pb-4 last:border-b-0">
            <div className="text-[13px] leading-relaxed text-slate-800 whitespace-pre-wrap">{row.body || row.title || card.narrative}</div>
            {row.imageUrl && <div className="mt-3 rounded-[18px] bg-slate-100 overflow-hidden h-36"><img src={row.imageUrl} alt="" className="w-full h-full object-cover" /></div>}
            <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400"><span>{row.meta || screen.timeText}</span><span>like repost comment</span></div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderGallery = () => (
    <div className="min-h-full bg-white px-3 py-3">
      <div className="grid grid-cols-3 gap-1">
        {rows.slice(0, 18).map((row, index) => (
          <div key={row.id || index} className="aspect-square bg-slate-100 overflow-hidden relative">
            {row.imageUrl ? <img src={row.imageUrl} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full bg-slate-100" />}
          </div>
        ))}
      </div>
    </div>
  );

  const renderNotes = () => {
    const note = screen.notes?.[0] || { text: screen.action || card.narrative, meta: screen.timeText || fmtTime(card.generatedAt) };
    return (
      <div className="min-h-full bg-[#fff8d7] text-amber-950 px-5 py-5">
        <div className="text-[22px] leading-8 font-black">{screen.title || '备忘录'}</div>
        <div className="mt-1 text-[11px] text-amber-700/55">{note.meta || screen.timeText}</div>
        <div className="mt-5 text-[15px] leading-7 whitespace-pre-wrap break-words">{note.text}</div>
      </div>
    );
  };

  const renderMap = () => (
    <div className="relative min-h-full overflow-hidden bg-[#d9efe0]">
      <div className="absolute inset-0 opacity-70" style={{ backgroundImage: 'linear-gradient(30deg, transparent 45%, rgba(255,255,255,.7) 46%, rgba(255,255,255,.7) 54%, transparent 55%), linear-gradient(120deg, transparent 42%, rgba(96,165,250,.45) 43%, rgba(96,165,250,.45) 50%, transparent 51%)', backgroundSize: '92px 70px, 140px 120px' }} />
      <div className="absolute left-4 right-4 top-4 h-10 rounded-full bg-white shadow px-4 flex items-center text-[12px] text-slate-500">{screen.action || screen.title || '附近'}</div>
      {rows.slice(0, 5).map((row, index) => <div key={row.id || index} className="absolute w-7 h-7 rounded-full bg-red-500 text-white text-[11px] font-black flex items-center justify-center shadow-lg" style={{ left: `${22 + (index * 17) % 58}%`, top: `${28 + (index * 23) % 48}%` }}>{index + 1}</div>)}
      <div className="absolute left-4 right-4 bottom-4 rounded-[20px] bg-white shadow-xl p-3">
        <div className="text-[13px] font-black truncate">{rows[0]?.title || screen.title}</div>
        <div className="mt-1 text-[11px] text-slate-500 line-clamp-2">{rows[0]?.body || screen.subtitle || card.narrative}</div>
      </div>
    </div>
  );

  const renderMusic = () => (
    <div className="h-full min-h-[360px] flex flex-col items-center justify-center text-center px-6 text-white bg-slate-950">
      <div className="w-44 h-44 rounded-[28px] bg-gradient-to-br from-slate-700 via-slate-900 to-black shadow-2xl mb-6 flex items-center justify-center"><span className="w-14 h-14 rounded-full border-2 border-white/70 flex items-center justify-center text-2xl">♪</span></div>
      <div className="text-lg font-black max-w-full truncate">{screen.hero?.title || screen.title}</div>
      <div className="mt-2 text-[12px] leading-relaxed text-white/55 line-clamp-3">{screen.hero?.subtitle || screen.subtitle || screen.action}</div>
    </div>
  );

  const renderApp = () => (
    <div className="min-h-full bg-white text-slate-950 px-4 py-4">
      <div className="text-[18px] font-black">{screen.title || screen.appName}</div>
      <div className="mt-1 text-[11px] text-slate-400">{screen.action || card.narrative}</div>
      <div className="mt-5 space-y-3">
        {rows.slice(0, 6).map((row, index) => (
          <div key={row.id || index} className="rounded-[18px] border border-slate-100 bg-slate-50 px-3 py-3">
            <div className="text-[13px] font-black text-slate-800">{row.title}</div>
            {row.body && <div className="mt-1 text-[11px] leading-relaxed text-slate-500">{row.body}</div>}
            {row.meta && <div className="mt-2 text-[9px] text-slate-400">{row.meta}</div>}
          </div>
        ))}
      </div>
    </div>
  );

  const renderHome = () => (
    <div className="min-h-full px-5 py-5 text-white" style={{ background: screen.wallpaper || 'linear-gradient(160deg,#1d4ed8,#7c3aed 48%,#111827)' }}>
      <div className="text-center pt-8 pb-5">
        <div className="text-[34px] font-light">{screen.timeText || fmtTime(card.generatedAt)}</div>
        <div className="text-[11px] text-white/70">{card.charName}</div>
      </div>
      <div className="grid grid-cols-4 gap-x-4 gap-y-5">
        {['聊天', '相册', '音乐', '地图', '浏览器', '备忘录', '日历', '设置'].map(name => (
          <div key={name} className="text-center min-w-0">
            <div className="mx-auto w-12 h-12 rounded-[15px] bg-white/90 text-slate-800 flex items-center justify-center font-black shadow-lg">{name.slice(0, 1)}</div>
            <div className="mt-1 text-[9px] truncate text-white/90">{name}</div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderSurface = () => {
    if (screen.appKind === 'chat') return renderChat();
    if (screen.appKind === 'takeout') return renderTakeout();
    if (screen.appKind === 'notes') return renderNotes();
    if (screen.appKind === 'gallery') return renderGallery();
    if (screen.appKind === 'music') return renderMusic();
    if (screen.appKind === 'map') return renderMap();
    if (screen.appKind === 'social') return renderSocial();
    if (screen.appKind === 'calendar') return renderCalendar();
    if (screen.appKind === 'browser') return renderBrowser();
    if (screen.appKind === 'home') return renderHome();
    return renderApp();
  };

  const renderPhone = (large = false) => (
    <div className={`${large ? 'w-[min(390px,calc(100vw-34px))] h-[min(780px,calc(100vh-116px))]' : 'w-[258px] h-[500px]'} shrink-0 rounded-[42px] bg-slate-950 p-[7px] shadow-[0_28px_70px_-28px_rgba(0,0,0,0.9)] relative text-slate-900`}>
      <div className="absolute left-1/2 top-[9px] z-30 h-[22px] w-[82px] -translate-x-1/2 rounded-full bg-black" />
      <div className={`relative h-full overflow-hidden rounded-[35px] ${pageBg}`}>
        <div className="relative z-20 h-9 px-5 flex items-center justify-between text-[11px] font-semibold text-slate-900 bg-white">
          <span className="min-w-[42px]">{screen.timeText || fmtTime(card.generatedAt)}</span>
          <span className="w-[74px]" />
          <span className="min-w-[64px] flex items-center justify-end gap-1 text-[10px]"><span>|||</span><span className="inline-flex h-2.5 w-5 rounded-[3px] border border-slate-900/60 p-[1px]"><span className="block rounded-[2px]" style={{ width: `${battery}%`, background: battery < 18 ? '#ef4444' : '#111827' }} /></span></span>
        </div>
        {hasAppHeader && (
          <div className="relative z-10 h-[66px] px-4 bg-white border-b border-slate-200 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-[22px] text-slate-800 shrink-0">&lt;</div>
            <div className="min-w-0 flex-1 text-center">
              <div className="text-[16px] leading-5 font-black text-slate-950 truncate">{screen.title || screen.appName}</div>
              {(screen.appKind === 'takeout' ? screen.appName : (screen.subtitle || screen.appName)) && <div className="text-[10px] leading-4 text-slate-400 truncate mt-0.5">{screen.appKind === 'takeout' ? screen.appName : (screen.subtitle || screen.appName)}</div>}
            </div>
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-[18px] text-slate-700 shrink-0">...</div>
          </div>
        )}
        <div className={`absolute left-0 right-0 ${screen.appKind === 'chat' ? 'bottom-[64px]' : 'bottom-7'} ${contentTop} overflow-y-auto overscroll-contain no-scrollbar ${pageBg}`}>{renderSurface()}</div>
        {screen.appKind === 'chat' && <div className="absolute left-0 right-0 bottom-7 h-[58px] bg-white border-t border-slate-200 px-3 flex items-center gap-2"><div className="w-8 h-8 rounded-full border border-slate-300 flex items-center justify-center text-slate-500 text-lg">+</div><div className="h-10 flex-1 rounded-[14px] bg-slate-50 border border-slate-200" /><div className="w-8 h-8 rounded-full border border-slate-300 flex items-center justify-center text-slate-500 text-lg">#</div></div>}
        <div className="absolute left-0 right-0 bottom-0 h-7 bg-white flex items-center justify-center"><div className="w-24 h-1 rounded-full bg-black" /></div>
      </div>
    </div>
  );

  const overlay = expanded && typeof document !== 'undefined'
    ? createPortal(
      <div className="fixed inset-0 z-[9998] bg-black text-white flex flex-col animate-fade-in" style={{ paddingTop: 'calc(var(--safe-top, 0px) + 14px)', paddingBottom: 'calc(var(--safe-bottom, 0px) + 14px)' }} onClick={() => setExpanded(false)}>
        <button type="button" onClick={(event) => { event.stopPropagation(); setExpanded(false); }} className="fixed right-4 z-[10000] h-10 px-3 rounded-full bg-white active:scale-95 border border-slate-200 text-slate-950 text-[12px] font-bold flex items-center gap-1.5" style={{ top: 'calc(var(--safe-top, 0px) + 14px)' }} aria-label="关闭窥屏"><span className="text-lg leading-none">x</span><span>关闭</span></button>
        <div className="shrink-0 px-5 pr-24 min-h-10 flex flex-col justify-center pointer-events-none">
          <div className="text-[13px] font-bold truncate">{card.title || `${card.charName} 的手机屏幕`}</div>
          <div className="text-[10px] text-white/45 truncate">{card.charName} · {new Date(card.generatedAt).toLocaleString()}</div>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden px-4 pt-3 flex items-center justify-center" onClick={(event) => event.stopPropagation()}>{renderPhone(true)}</div>
        <div className="shrink-0 pt-3 text-center text-[10px] text-white/35 pointer-events-none">点空白处或按 Esc 退出</div>
      </div>,
      document.body,
    )
    : null;

  return (
    <>
      {commonLayout(<button type="button" onClick={(event) => { event.stopPropagation(); setExpanded(true); }} className="block text-left rounded-[30px] active:scale-[0.98] transition-transform">{renderPhone(false)}</button>)}
      {overlay}
    </>
  );
};

export default ScreenPeekCardView;
