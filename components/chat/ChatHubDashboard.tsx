import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BellRinging,
  CheckCircle,
  ChatsTeardrop,
  ClockCounterClockwise,
  Compass,
  GearSix,
  Lightning,
  ListChecks,
  NotePencil,
  Planet,
  Sparkle,
  X,
} from '@phosphor-icons/react';
import { useOS } from '../../context/OSContext';
import type { ChatFollowup, ChatHubDigest, CharLifeEvent, GroupProfile, Message, SocialPost } from '../../types';
import { DB } from '../../utils/db';
import { resolveAuxApi } from '../../utils/auxApi';
import { buildChatTimelineItems, timelineItemsForDigest, type ChatTimelineItem } from '../../utils/chatTimeline';
import { completeChatFollowup, dismissChatFollowup } from '../../utils/chatFollowups';
import { generateChatHubDigest } from '../../utils/chatHubDigest';

type DashboardTab = 'today' | 'timeline' | 'followups' | 'settings';

interface Props {
  onClose: () => void;
  onOpenPrivate: (charId: string, messageId?: number) => void;
  onOpenGroup: (group: GroupProfile, messageId?: number) => void;
  onOpenMoments: () => void;
  onOpenCouple: (charId?: string) => void;
}

const todayYmd = (ts = Date.now()) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const formatTime = (ts?: number) => {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return sameDay
    ? d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : `${d.getMonth() + 1}月${d.getDate()}日`;
};

const sourceLabel: Record<string, string> = {
  private: '私聊',
  group: '群聊',
  moments: '此刻',
  couple: '情侣空间',
  relationship: '关系',
  takeout: '饭票',
  offline: '线下',
  life: '生活',
  followup: '稍后回',
  digest: '摘要',
};

const toneFor = (source: string) => {
  if (source === 'followup') return '#9c5e74';
  if (source === 'relationship' || source === 'couple') return '#d4536f';
  if (source === 'life') return '#4c8f6b';
  if (source === 'group') return '#6a6fb3';
  return '#7fa8b3';
};

const Pill = ({ children }: { children: React.ReactNode }) => (
  <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-white/70 border border-[#eed6df] text-[#9c5e74]">
    {children}
  </span>
);

const Empty = ({ text }: { text: string }) => (
  <div className="py-10 text-center text-[12px] text-slate-400 font-bold">{text}</div>
);

const ChatHubDashboard: React.FC<Props> = ({ onClose, onOpenPrivate, onOpenGroup, onOpenMoments, onOpenCouple }) => {
  const {
    characters,
    groups,
    userProfile,
    updateUserProfile,
    apiConfig,
    auxApiConfig,
    addToast,
    unreadMessages,
  } = useOS();
  const [tab, setTab] = useState<DashboardTab>('today');
  const [loading, setLoading] = useState(true);
  const [timeline, setTimeline] = useState<ChatTimelineItem[]>([]);
  const [followups, setFollowups] = useState<ChatFollowup[]>([]);
  const [digest, setDigest] = useState<ChatHubDigest | null>(null);
  const [digestBusy, setDigestBusy] = useState(false);
  const [socialPosts, setSocialPosts] = useState<SocialPost[]>([]);
  const [lifeEvents, setLifeEvents] = useState<CharLifeEvent[]>([]);

  const agencyMode = userProfile.chatHubV2?.agencyMode || 'quiet_life';
  const digestEnabled = userProfile.chatHubV2?.digestEnabled !== false;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const visibleGroups = groups.filter(g => !g.dissolved);
      const [privateBatches, groupBatches, posts, followupRows, digestRows, lifeBatches] = await Promise.all([
        Promise.all(characters.map(c => DB.getRecentMessagesWithCount(c.id, 12).then(res => res.messages).catch(() => [] as Message[]))),
        Promise.all(visibleGroups.map(g => DB.getRecentGroupMessagesWithCount(g.id, 14).then(res => res.messages).catch(() => [] as Message[]))),
        DB.getSocialPosts().catch(() => [] as SocialPost[]),
        DB.getAllChatFollowups().catch(() => [] as ChatFollowup[]),
        DB.getAllChatHubDigests().catch(() => [] as ChatHubDigest[]),
        Promise.all(characters.map(c => DB.getLifeEvents(c.id, 4).catch(() => [] as CharLifeEvent[]))),
      ]);
      const flatLife = lifeBatches.flat();
      const todayDigest = digestRows.find(d => d.date === todayYmd()) || null;
      const items = buildChatTimelineItems({
        characters,
        groups: visibleGroups,
        privateMessages: privateBatches.flat(),
        groupMessages: groupBatches.flat(),
        socialPosts: posts,
        followups: followupRows,
        digests: digestRows,
        lifeEvents: flatLife,
        limit: 160,
      });
      setTimeline(items);
      setFollowups(followupRows);
      setDigest(todayDigest);
      setSocialPosts(posts);
      setLifeEvents(flatLife);
    } finally {
      setLoading(false);
    }
  }, [characters, groups]);

  useEffect(() => {
    void load();
    const handler = () => { void load(); };
    window.addEventListener('messages-updated', handler);
    window.addEventListener('autonomous-life-catchup', handler);
    return () => {
      window.removeEventListener('messages-updated', handler);
      window.removeEventListener('autonomous-life-catchup', handler);
    };
  }, [load]);

  useEffect(() => {
    updateUserProfile({
      chatHubV2: {
        ...userProfile.chatHubV2,
        dashboardLastSeenAt: Date.now(),
        agencyMode,
        digestEnabled,
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openFollowups = useMemo(() => followups.filter(f => f.status === 'open'), [followups]);
  const unreadTotal = useMemo(() => Object.values(unreadMessages || {}).reduce((sum, n) => sum + (Number(n) || 0), 0), [unreadMessages]);
  const specialCareCount = useMemo(() => (
    characters.filter(c => c.convoSettings?.specialCare).length
    + groups.filter(g => (g.specialCareMemberIds || []).length > 0).length
  ), [characters, groups]);
  const verificationCount = useMemo(() => characters.filter(c => c.charBlock?.active || c.unblockAppeal?.awaiting).length, [characters]);
  const latestLife = useMemo(() => [...lifeEvents].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, 4), [lifeEvents]);
  const recentTimeline = useMemo(() => [...timeline].sort((a, b) => b.at - a.at).slice(0, 32), [timeline]);

  const openTimelineTarget = (item: ChatTimelineItem) => {
    const target = item.openTarget;
    if (!target) return;
    if (target.kind === 'char' && target.id) onOpenPrivate(target.id, target.messageId);
    if (target.kind === 'group') {
      const group = groups.find(g => g.id === (target.groupId || target.id));
      if (group) onOpenGroup(group, target.messageId);
    }
    if (target.kind === 'moments') onOpenMoments();
    if (target.kind === 'couple') onOpenCouple(target.id);
  };

  const generateDigest = async () => {
    setDigestBusy(true);
    try {
      const next = await generateChatHubDigest({
        api: resolveAuxApi(auxApiConfig, apiConfig),
        items: timelineItemsForDigest(timeline, 18),
        date: todayYmd(),
      });
      await DB.saveChatHubDigest(next);
      setDigest(next);
      addToast('今日摘要已更新', 'success');
      void load();
    } catch (err: any) {
      addToast(err?.message || '今日摘要生成失败', 'error');
    } finally {
      setDigestBusy(false);
    }
  };

  const setAgencyMode = (mode: 'quiet_life' | 'lively' | 'story') => {
    updateUserProfile({
      chatHubV2: {
        ...userProfile.chatHubV2,
        agencyMode: mode,
        digestEnabled,
      },
    });
    addToast('絮语总览设置已保存', 'success');
  };

  const setDigestEnabled = (enabled: boolean) => {
    updateUserProfile({
      chatHubV2: {
        ...userProfile.chatHubV2,
        agencyMode,
        digestEnabled: enabled,
      },
    });
  };

  const markFollowup = async (id: string, status: 'done' | 'dismissed') => {
    if (status === 'done') await completeChatFollowup(id);
    else await dismissChatFollowup(id);
    addToast(status === 'done' ? '已完成稍后回' : '已收起稍后回', 'success');
    void load();
  };

  const renderTimelineRow = (item: ChatTimelineItem) => (
    <button
      key={item.id}
      onClick={() => openTimelineTarget(item)}
      className="w-full text-left bg-white rounded-[8px] border border-[#f0dce4] p-3 active:scale-[0.99] transition-transform"
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 w-2 h-2 rounded-full shrink-0" style={{ background: toneFor(item.source) }} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[12.5px] font-black text-slate-700 truncate">{item.title}</span>
            <span className="text-[9px] font-black text-slate-400 shrink-0">{formatTime(item.at)}</span>
          </div>
          <div className="mt-1 text-[11px] leading-relaxed text-slate-500 line-clamp-2">{item.summary}</div>
        </div>
        <Pill>{sourceLabel[item.source] || item.source}</Pill>
      </div>
    </button>
  );

  const renderToday = () => (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-white rounded-[8px] border border-[#f0dce4] p-3">
          <div className="flex items-center gap-2 text-[#9c5e74]"><BellRinging size={17} weight="fill" /><span className="text-[11px] font-black">未读</span></div>
          <div className="mt-2 text-2xl font-black text-slate-800">{unreadTotal}</div>
        </div>
        <div className="bg-white rounded-[8px] border border-[#f0dce4] p-3">
          <div className="flex items-center gap-2 text-[#9c5e74]"><Lightning size={17} weight="fill" /><span className="text-[11px] font-black">特别关心</span></div>
          <div className="mt-2 text-2xl font-black text-slate-800">{specialCareCount}</div>
        </div>
        <div className="bg-white rounded-[8px] border border-[#f0dce4] p-3">
          <div className="flex items-center gap-2 text-[#9c5e74]"><ListChecks size={17} weight="fill" /><span className="text-[11px] font-black">稍后回</span></div>
          <div className="mt-2 text-2xl font-black text-slate-800">{openFollowups.length}</div>
        </div>
        <div className="bg-white rounded-[8px] border border-[#f0dce4] p-3">
          <div className="flex items-center gap-2 text-[#9c5e74]"><ChatsTeardrop size={17} weight="fill" /><span className="text-[11px] font-black">验证/恢复</span></div>
          <div className="mt-2 text-2xl font-black text-slate-800">{verificationCount}</div>
        </div>
      </div>

      <div className="bg-white rounded-[8px] border border-[#f0dce4] p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-slate-800 font-black text-[13px]"><Sparkle size={17} weight="fill" className="text-[#9c5e74]" />今日摘要</div>
          {digestEnabled && (
            <button onClick={generateDigest} disabled={digestBusy} className="px-2.5 py-1 rounded-full bg-[#262626] text-white text-[10px] font-black disabled:opacity-50 active:scale-95">
              {digestBusy ? '整理中' : digest ? '更新' : '生成'}
            </button>
          )}
        </div>
        {digest ? (
          <div className="mt-2 space-y-2">
            <div className="text-[12px] leading-relaxed text-slate-600">{digest.summary}</div>
            {digest.highlights.slice(0, 4).map((h, i) => <div key={i} className="text-[11px] text-slate-500 bg-[#faf7f2] rounded-[6px] px-2 py-1.5">{h}</div>)}
          </div>
        ) : (
          <div className="mt-2 text-[12px] text-slate-400">{digestEnabled ? '还没有今日摘要。' : '今日摘要已关闭。'}</div>
        )}
      </div>

      <div className="space-y-2">
        <div className="px-1 text-[11px] font-black tracking-[0.16em] text-[#9c5e74]/70">最近线索</div>
        {recentTimeline.slice(0, 6).map(renderTimelineRow)}
        {recentTimeline.length === 0 && <Empty text={loading ? '正在整理絮语...' : '今天还没有新的线索'} />}
      </div>
    </div>
  );

  const renderFollowups = () => (
    <div className="space-y-2">
      {openFollowups.length === 0 && <Empty text="没有待处理的稍后回" />}
      {openFollowups.map(f => (
        <div key={f.id} className="bg-white rounded-[8px] border border-[#f0dce4] p-3">
          <div className="flex items-start gap-2">
            <NotePencil size={18} weight="fill" className="text-[#9c5e74] shrink-0 mt-0.5" />
            <button
              className="flex-1 min-w-0 text-left"
              onClick={() => {
                if (f.targetKind === 'char' && f.targetId) onOpenPrivate(f.targetId, f.messageId);
                if (f.targetKind === 'group') {
                  const group = groups.find(g => g.id === (f.groupId || f.targetId));
                  if (group) onOpenGroup(group, f.messageId);
                }
              }}
            >
              <div className="text-[13px] font-black text-slate-700 truncate">{f.title}</div>
              {f.note && <div className="mt-1 text-[11px] leading-relaxed text-slate-500">{f.note}</div>}
              <div className="mt-1 text-[9px] font-black text-slate-300">{formatTime(f.createdAt)}</div>
            </button>
            <div className="flex flex-col gap-1.5 shrink-0">
              <button onClick={() => void markFollowup(f.id, 'done')} className="p-1.5 rounded-full bg-emerald-50 text-emerald-700 active:scale-90"><CheckCircle size={17} weight="fill" /></button>
              <button onClick={() => void markFollowup(f.id, 'dismissed')} className="p-1.5 rounded-full bg-slate-100 text-slate-500 active:scale-90"><X size={16} weight="bold" /></button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  const renderSettings = () => (
    <div className="space-y-3">
      <div className="bg-white rounded-[8px] border border-[#f0dce4] p-3">
        <div className="text-[13px] font-black text-slate-800 mb-2">主动性</div>
        <div className="grid grid-cols-1 gap-2">
          {([
            ['quiet_life', '克制但有生活', '默认。角色有自己的日常，低频自然承接。'],
            ['lively', '更热闹', '提高此刻、群聊和实时插话存在感。'],
            ['story', '强剧情驱动', '更容易形成事件、邀约和关系转折。'],
          ] as const).map(([id, title, note]) => (
            <button
              key={id}
              onClick={() => setAgencyMode(id)}
              className={`text-left rounded-[8px] border p-3 active:scale-[0.99] ${agencyMode === id ? 'bg-[#fff4f7] border-[#d8a5b7]' : 'bg-[#fafafa] border-slate-100'}`}
            >
              <div className="text-[12.5px] font-black text-slate-700">{title}</div>
              <div className="mt-1 text-[11px] text-slate-500">{note}</div>
            </button>
          ))}
        </div>
      </div>
      <button
        onClick={() => setDigestEnabled(!digestEnabled)}
        className="w-full bg-white rounded-[8px] border border-[#f0dce4] p-3 flex items-center justify-between text-left active:scale-[0.99]"
      >
        <div>
          <div className="text-[13px] font-black text-slate-800">今日摘要</div>
          <div className="mt-1 text-[11px] text-slate-500">{digestEnabled ? '允许用副 API 整理今日线索' : '已关闭自动摘要入口'}</div>
        </div>
        <span className={`w-11 h-6 rounded-full p-0.5 transition-colors ${digestEnabled ? 'bg-[#9c5e74]' : 'bg-slate-200'}`}>
          <span className="block w-5 h-5 rounded-full bg-white transition-transform" style={{ transform: digestEnabled ? 'translateX(20px)' : 'translateX(0)' }} />
        </span>
      </button>
    </div>
  );

  return (
    <div className="absolute inset-0 z-[70] bg-[#faf7f2] flex flex-col" data-manual-anchor="manual-chathub-dashboard">
      <div className="shrink-0 bg-white/90 backdrop-blur-xl border-b border-[#ededed]">
        <div style={{ height: 'var(--safe-top)' }} />
        <div className="h-16 px-4 flex items-center gap-3">
          <button onClick={onClose} className="p-2 -ml-2 rounded-full text-slate-500 hover:bg-slate-100 active:scale-90"><X size={22} weight="bold" /></button>
          <div className="flex-1 min-w-0">
            <div className="text-[18px] font-black text-slate-800">絮语总览</div>
            <div className="text-[10px] text-slate-400 font-bold tracking-[0.14em]">CHAT HUB V2</div>
          </div>
          <Compass size={24} weight="duotone" className="text-[#9c5e74]" />
        </div>
        <div className="grid grid-cols-4 px-2 pb-2 gap-1">
          {([
            ['today', '今日', Sparkle],
            ['timeline', '事件线', Planet],
            ['followups', '待办', ListChecks],
            ['settings', '设置', GearSix],
          ] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`py-2 rounded-[8px] flex flex-col items-center gap-0.5 text-[10px] font-black active:scale-95 ${tab === id ? 'bg-[#fff4f7] text-[#9c5e74]' : 'text-slate-400'}`}
            >
              <Icon size={18} weight={tab === id ? 'fill' : 'regular'} />
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-3 pb-[calc(var(--safe-bottom)+1rem)]">
        {tab === 'today' && renderToday()}
        {tab === 'timeline' && (
          <div className="space-y-2">
            {recentTimeline.map(renderTimelineRow)}
            {recentTimeline.length === 0 && <Empty text={loading ? '正在整理絮语...' : '还没有事件'} />}
          </div>
        )}
        {tab === 'followups' && renderFollowups()}
        {tab === 'settings' && renderSettings()}
        {latestLife.length > 0 && tab === 'today' && (
          <div className="mt-3 bg-white rounded-[8px] border border-[#f0dce4] p-3">
            <div className="flex items-center gap-2 text-[13px] font-black text-slate-800"><ClockCounterClockwise size={17} weight="fill" className="text-[#4c8f6b]" />角色近况</div>
            <div className="mt-2 space-y-1.5">
              {latestLife.map(event => (
                <div key={event.id} className="text-[11px] text-slate-500 bg-[#f7fbf8] rounded-[6px] px-2 py-1.5">
                  {event.activity}{event.mood ? ` · ${event.mood}` : ''}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatHubDashboard;
