import type {
  CharacterProfile,
  ChatFollowup,
  ChatHubDigest,
  CharLifeEvent,
  GroupProfile,
  Message,
  SocialPost,
} from '../types';
import { sanitizeLifeText } from './autonomousLife';

export type ChatTimelineSource =
  | 'private'
  | 'group'
  | 'moments'
  | 'couple'
  | 'relationship'
  | 'takeout'
  | 'offline'
  | 'life'
  | 'followup'
  | 'digest';

export interface ChatTimelineItem {
  id: string;
  source: ChatTimelineSource;
  kind: string;
  targetId?: string;
  title: string;
  summary: string;
  at: number;
  openTarget?: {
    kind: 'char' | 'group' | 'moments' | 'couple' | 'dashboard' | 'message';
    id?: string;
    messageId?: number;
    groupId?: string;
  };
  weight: number;
}

export interface BuildChatTimelineInput {
  characters?: CharacterProfile[];
  groups?: GroupProfile[];
  privateMessages?: Message[];
  groupMessages?: Message[];
  socialPosts?: SocialPost[];
  lifeEvents?: CharLifeEvent[];
  followups?: ChatFollowup[];
  digests?: ChatHubDigest[];
  now?: number;
  limit?: number;
}

const clip = (value: unknown, limit = 96): string => {
  const clean = String(value ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > limit ? `${clean.slice(0, limit)}...` : clean;
};

const messageSummary = (m: Message): string => {
  const meta = (m.metadata as any) || {};
  if (meta.recalled) return '[撤回了一条消息]';
  if (m.type === 'image') return '[图片]';
  if (m.type === 'emoji') return '[表情]';
  if (m.type === 'voice') return '[语音]';
  if (m.type === 'takeout_card') return '[饭票小票]';
  if (m.type === 'proposal_card') return '[求婚]';
  if (m.type === 'call_log') return '[通话记录]';
  if (typeof m.content === 'string') return clip(m.content);
  return `[${m.type}]`;
};

const charNameOf = (chars: CharacterProfile[], id?: string): string => (
  chars.find(c => c.id === id)?.convoSettings?.remarkName?.trim()
  || chars.find(c => c.id === id)?.name
  || '某位角色'
);

const groupNameOf = (groups: GroupProfile[], id?: string): string => (
  groups.find(g => g.id === id)?.name || '群聊'
);

export function buildChatTimelineItems(input: BuildChatTimelineInput): ChatTimelineItem[] {
  const chars = input.characters || [];
  const groups = input.groups || [];
  const items: ChatTimelineItem[] = [];

  (input.privateMessages || []).forEach(m => {
    if (!m?.id || m.metadata?.source === 'group_call') return;
    const name = charNameOf(chars, m.charId);
    const mine = m.role === 'user';
    items.push({
      id: `private:${m.id}`,
      source: m.type === 'takeout_card' ? 'takeout' : 'private',
      kind: m.type,
      targetId: m.charId,
      title: mine ? `你对 ${name} 说` : `${name} 发来消息`,
      summary: messageSummary(m),
      at: m.timestamp || 0,
      openTarget: { kind: 'char', id: m.charId, messageId: m.id },
      weight: m.type === 'takeout_card' ? 82 : 70,
    });
  });

  (input.groupMessages || []).forEach(m => {
    if (!m?.id || !m.groupId || m.metadata?.source === 'group_call') return;
    const groupName = groupNameOf(groups, m.groupId);
    const speaker = m.role === 'user' ? '你' : charNameOf(chars, m.charId);
    items.push({
      id: `group:${m.id}`,
      source: 'group',
      kind: m.type,
      targetId: m.groupId,
      title: `${groupName} · ${speaker}`,
      summary: messageSummary(m),
      at: m.timestamp || 0,
      openTarget: { kind: 'group', id: m.groupId, groupId: m.groupId, messageId: m.id },
      weight: 64,
    });
  });

  (input.socialPosts || []).forEach((post: any) => {
    const authorId = post.authorCharId || post.charId || post.authorId;
    const author = authorId ? charNameOf(chars, authorId) : (post.authorName || '此刻');
    items.push({
      id: `moments:${post.id}`,
      source: 'moments',
      kind: 'moment',
      targetId: authorId,
      title: `${author} 更新了此刻`,
      summary: clip(post.content || post.text || post.body || post.title || '新的熟人动态'),
      at: post.lastActivityAt || post.timestamp || post.createdAt || post.at || 0,
      openTarget: { kind: 'moments', id: post.id },
      weight: 58,
    });
  });

  chars.forEach(char => {
    const rel = char.relationship;
    if (rel?.updatedAt) {
      items.push({
        id: `relationship:${char.id}:${rel.updatedAt}`,
        source: 'relationship',
        kind: 'relationship',
        targetId: char.id,
        title: `${charNameOf(chars, char.id)} 的关系变动`,
        summary: rel.label || rel.stage,
        at: rel.updatedAt,
        openTarget: { kind: 'char', id: char.id },
        weight: 88,
      });
    }
    const cs = char.coupleSpace;
    if (cs?.updatedAt) {
      const latestMoment = [...(cs.moments || [])].sort((a: any, b: any) => (b.at || 0) - (a.at || 0))[0] as any;
      items.push({
        id: `couple:${char.id}:${cs.updatedAt}`,
        source: 'couple',
        kind: 'couple_space',
        targetId: char.id,
        title: `${charNameOf(chars, char.id)} 的情侣空间`,
        summary: clip(latestMoment?.text || latestMoment?.content || `亲密度 ${cs.intimacy || 0}`),
        at: cs.updatedAt,
        openTarget: { kind: 'couple', id: char.id },
        weight: 76,
      });
    }
  });

  (input.lifeEvents || []).forEach(event => {
    const activity = sanitizeLifeText(event.activity) || sanitizeLifeText(event.summary || '');
    if (!activity) return;
    const mood = event.mood ? sanitizeLifeText(event.mood) : '';
    const location = event.location ? sanitizeLifeText(event.location) : '';
    items.push({
      id: `life:${event.id}`,
      source: 'life',
      kind: event.eventKind || 'life',
      targetId: event.charId,
      title: `${charNameOf(chars, event.charId)} 此刻的生活`,
      summary: clip([activity, mood, location].filter(Boolean).join(' · ')),
      at: event.timestamp || 0,
      openTarget: { kind: 'char', id: event.charId },
      weight: event.surfacedAt ? 44 : 62,
    });
  });

  (input.followups || []).forEach(f => {
    if (f.status !== 'open') return;
    items.push({
      id: `followup:${f.id}`,
      source: 'followup',
      kind: f.source,
      targetId: f.targetId,
      title: f.title,
      summary: clip(f.note || '稍后回到这里处理'),
      at: f.dueAt || f.updatedAt || f.createdAt,
      openTarget: f.targetKind === 'group'
        ? { kind: 'group', id: f.targetId, groupId: f.groupId || f.targetId, messageId: f.messageId }
        : f.targetKind === 'char'
          ? { kind: 'char', id: f.targetId, messageId: f.messageId }
          : { kind: 'dashboard', id: f.id },
      weight: 95,
    });
  });

  (input.digests || []).forEach(d => {
    items.push({
      id: `digest:${d.id}`,
      source: 'digest',
      kind: 'digest',
      title: `${d.date} 絮语摘要`,
      summary: clip(d.summary, 140),
      at: d.createdAt,
      openTarget: { kind: 'dashboard', id: d.id },
      weight: 52,
    });
  });

  return items
    .filter(item => item.at > 0)
    .sort((a, b) => (b.weight - a.weight) || (b.at - a.at))
    .slice(0, input.limit || 120);
}

export function timelineItemsForDigest(items: ChatTimelineItem[], limit = 16): ChatTimelineItem[] {
  return [...items]
    .sort((a, b) => (b.at - a.at) || (b.weight - a.weight))
    .slice(0, limit);
}
