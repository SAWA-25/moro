import type { CharacterProfile, GroupProfile, Message, UserProfile } from '../types';
import { DB } from './db';
import {
  DEFAULT_OFFLINE_WORD_LIMIT,
  formatOfflineLengthRange,
  normalizeOfflineWordLimit,
  offlineWordLimitRule,
  resolveOfflineRequestTokenBudget,
  type OfflineCommitInfo,
  type OfflinePovPerson,
  type OfflineWordLimit,
} from './offlineMode';
import { formatCharacterWithId } from './characterIdentity';
import { completeText } from './llmClient';
import { makeApiUsageMeta } from './apiUsageCatalog';
import type { PresetMacroCtx } from './presets';
import { buildFullCharacterSetting, buildFullActiveUserSetting } from './characterPromptProfile';
import {
  groupOfflineBasePrompt,
  groupOfflineDirectOutputUserPrompt,
  groupOfflineOpeningTaskPrompt,
  groupOfflineTurnTaskPrompt,
} from './laiwangPrompts';

export interface GroupOfflineSceneEntry {
  role: 'scene';
  text: string;
  at: number;
}

export interface GroupOfflineUserEntry {
  role: 'user';
  text: string;
  at: number;
}

export interface GroupOfflineCharEntry {
  role: 'char';
  text: string;
  at: number;
  speakerId?: string;
  speakerName?: string;
  speakerAvatar?: string;
}

export type GroupOfflineEntry = GroupOfflineSceneEntry | GroupOfflineUserEntry | GroupOfflineCharEntry;

export interface GroupOfflinePov {
  members: OfflinePovPerson;
  user: OfflinePovPerson;
}

export const DEFAULT_GROUP_OFFLINE_POV: GroupOfflinePov = { members: 'third', user: 'third' };

const sessionKey = (groupId: string) => `moro_group_offline_session_${groupId}`;
const povKey = (groupId: string) => `moro_group_offline_pov_${groupId}`;
const wordLimitKey = (groupId: string) => `moro_group_offline_word_limit_${groupId}`;

const isPerson = (value: unknown): value is OfflinePovPerson =>
  value === 'first' || value === 'second' || value === 'third';

export const loadGroupOfflineSession = (groupId: string): GroupOfflineEntry[] => {
  try {
    const raw = localStorage.getItem(sessionKey(groupId));
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const saveGroupOfflineSession = (groupId: string, entries: GroupOfflineEntry[]): void => {
  try {
    localStorage.setItem(sessionKey(groupId), JSON.stringify(entries));
  } catch {
    // localStorage can fail in private/quota-constrained contexts; losing the draft is acceptable.
  }
};

export const clearGroupOfflineSession = (groupId: string): void => {
  try {
    localStorage.removeItem(sessionKey(groupId));
  } catch {
    // ignore
  }
};

export const hasGroupOfflineSession = (groupId: string): boolean =>
  loadGroupOfflineSession(groupId).length > 0;

export const loadGroupOfflinePov = (groupId: string): GroupOfflinePov => {
  try {
    const raw = localStorage.getItem(povKey(groupId));
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && isPerson(parsed.members) && isPerson(parsed.user)) return parsed;
  } catch {
    // ignore
  }
  return DEFAULT_GROUP_OFFLINE_POV;
};

export const saveGroupOfflinePov = (groupId: string, pov: GroupOfflinePov): void => {
  try {
    localStorage.setItem(povKey(groupId), JSON.stringify(pov));
  } catch {
    // ignore
  }
};

export const loadGroupOfflineWordLimit = (groupId: string): OfflineWordLimit => {
  try {
    const raw = localStorage.getItem(wordLimitKey(groupId));
    const parsed = raw ? JSON.parse(raw) : null;
    return normalizeOfflineWordLimit(parsed);
  } catch {
    // ignore
  }
  return {};
};

export const saveGroupOfflineWordLimit = (groupId: string, limit: OfflineWordLimit): void => {
  try {
    const normalized = normalizeOfflineWordLimit(limit);
    if (normalized.maxChars) localStorage.setItem(wordLimitKey(groupId), JSON.stringify(normalized));
    else localStorage.removeItem(wordLimitKey(groupId));
  } catch {
    // ignore
  }
};

export const formatGroupOfflineTranscript = (entries: GroupOfflineEntry[], userName: string): string =>
  entries.map(entry => {
    if (entry.role === 'scene') return `(scene) ${entry.text}`;
    if (entry.role === 'user') return `${userName}: ${entry.text}`;
    return `${entry.speakerName || '群成员'}: ${entry.text}`;
  }).join('\n');

interface GroupOfflineApi {
  baseUrl: string;
  apiKey: string;
  model: string;
  apiRole?: 'main' | 'aux' | 'custom';
  apiBinding?: string;
}

// 群聊线下赴约默认走文具盒主 API / 主模型，让群体现场和主聊天保持同一套角色声音。
const GROUP_OFFLINE_DIRECT_OUTPUT_USER = groupOfflineDirectOutputUserPrompt;
const GROUP_OFFLINE_LLM_CONTINUE_ROUNDS = 2;
const GROUP_OFFLINE_LLM_CONTINUE_TIMEOUT_MS = 45_000;

const callGroupOfflineLLM = async (
  api: GroupOfflineApi,
  prompt: string,
  temperature = 0.9,
  presetMacros?: PresetMacroCtx,
  maxTokens = resolveOfflineRequestTokenBudget(),
): Promise<string> => {
  return (await completeText(api, [
    { role: 'system', content: prompt },
    { role: 'user', content: GROUP_OFFLINE_DIRECT_OUTPUT_USER },
  ], {
    temperature,
    maxTokens,
    preserveMaxTokens: true,
    continueRounds: GROUP_OFFLINE_LLM_CONTINUE_ROUNDS,
    continueOnMissingFinishReason: false,
    returnPartialOnContinueError: true,
    continueTimeoutMs: GROUP_OFFLINE_LLM_CONTINUE_TIMEOUT_MS,
    continueMaxRetries: 0,
    presetScope: 'creative.text',
    presetMacros,
    meta: makeApiUsageMeta('chat.groupOfflineMode', {
      apiRole: api.apiRole || 'main',
      apiBinding: api.apiBinding,
    }),
  })).trim();
};

const memberDisplayName = (group: GroupProfile, member: CharacterProfile): string =>
  group.memberNicknames?.[member.id]?.trim() || member.name;

const speakerNameFor = (
  msg: Message,
  group: GroupProfile,
  members: CharacterProfile[],
  userName: string,
): string => {
  if (msg.role === 'user' || msg.charId === 'user') return group.memberNicknames?.user || userName;
  const member = members.find(item => item.id === msg.charId);
  return member ? formatCharacterWithId(member, memberDisplayName(group, member)) : (msg.charId || '群成员');
};

const formatRoster = (group: GroupProfile, members: CharacterProfile[]): string => {
  if (!members.length) return '（暂无角色成员）';
  return members.map(member => {
    const name = memberDisplayName(group, member);
    const title = group.memberTitles?.[member.id];
    return `- ${formatCharacterWithId(member, name)}${title ? `, title: ${title}` : ''}\n${buildFullCharacterSetting(member, { includeMemos: true, includeName: false })}`;
  }).join('\n');
};

const formatRecentGroupMessages = (
  messages: Message[],
  group: GroupProfile,
  members: CharacterProfile[],
  userName: string,
): string => {
  const lines = messages
    .filter(msg => msg.role !== 'system' && msg.type !== 'system' && typeof msg.content === 'string')
    .slice(-20)
    .map(msg => `${speakerNameFor(msg, group, members, userName)}: ${String(msg.content).slice(0, 240)}`);
  return lines.join('\n') || '（暂无最近群聊）';
};

const refWord = (person: OfflinePovPerson, label: string): string => {
  if (person === 'first') return `第一人称“我”指代${label}`;
  if (person === 'second') return `第二人称“你”指代${label}`;
  return `第三人称姓名指代${label}`;
};

const buildGroupPovInstruction = (pov: GroupOfflinePov, userName: string): string =>
  `### [叙述人称]
- 群成员：使用${refWord(pov.members, '每位成员')}；
- ${userName}：使用${refWord(pov.user, userName)}。
动作、台词标注和场景旁白都保持同一种人称，不要忽然切换。`;

const buildGroupOfflineBase = async (
  group: GroupProfile,
  members: CharacterProfile[],
  userProfile: UserProfile,
): Promise<string> => {
  const recent = await DB.getGroupMessages(group.id).catch(() => [] as Message[]);
  const userName = userProfile.name || '你';
  const userSetting = await buildFullActiveUserSetting(userProfile, { fallback: `用户名：${userName}` });
  return groupOfflineBasePrompt({
    groupName: group.name,
    userName,
    userSetting,
    roster: formatRoster(group, members),
    recentMessages: formatRecentGroupMessages(recent, group, members, userName),
  });
};

export const generateGroupOfflineOpening = async (
  group: GroupProfile,
  members: CharacterProfile[],
  userProfile: UserProfile,
  api: GroupOfflineApi,
  pov: GroupOfflinePov = loadGroupOfflinePov(group.id),
  scenario?: string,
  rerollPrevious?: string,
  wordLimit?: OfflineWordLimit,
): Promise<string> => {
  const base = await buildGroupOfflineBase(group, members, userProfile);
  const lengthRange = formatOfflineLengthRange(wordLimit, '120-280字');
  const lengthRule = offlineWordLimitRule(wordLimit);
  const outputBudget = resolveOfflineRequestTokenBudget(wordLimit);
  const scenarioBlock = scenario?.trim()
    ? `\n### [选定开场]\n${scenario.trim()}\n请按这个设定安排大家在哪里见面、谁先出现、第一刻怎么开始。`
    : '\n### [选定开场]\n请根据最近群聊推断一个合理的见面地点和开场方式。';
  const rerollBlock = rerollPrevious?.trim()
    ? `\n### [这次是重写]\n上一版群体开场已经被用户撤回：\n${rerollPrevious.trim().slice(0, 1200)}\n请保留同一场赴约的基本关系和时间线，但换一种现场切入、成员反应和措辞重新写，不要照抄上一版，也不要故意反着写成突兀剧情。`
    : '';
  const userName = userProfile.name || '你';
  return callGroupOfflineLLM(api, groupOfflineOpeningTaskPrompt({
    base,
    povText: buildGroupPovInstruction(pov, userName),
    scenarioBlock,
    rerollBlock,
    lengthRange,
    lengthRule,
    userName,
  }), 0.9, { charName: group.name, userName }, outputBudget);
};

export const generateGroupOfflineTurn = async (
  group: GroupProfile,
  members: CharacterProfile[],
  userProfile: UserProfile,
  api: GroupOfflineApi,
  entries: GroupOfflineEntry[],
  userInput?: string,
  pov: GroupOfflinePov = loadGroupOfflinePov(group.id),
  rerollPrevious?: string,
  wordLimit?: OfflineWordLimit,
): Promise<string> => {
  const base = await buildGroupOfflineBase(group, members, userProfile);
  const lengthRange = formatOfflineLengthRange(wordLimit, '80-220字');
  const lengthRule = offlineWordLimitRule(wordLimit);
  const outputBudget = resolveOfflineRequestTokenBudget(wordLimit);
  const userName = userProfile.name || '你';
  const transcript = formatGroupOfflineTranscript(entries, userName);
  const action = userInput?.trim()
    ? `${userName} 刚刚说了/做了：${userInput.trim()}`
    : `${userName} 暂时没有新的行动；让群成员按现场气氛自然继续。`;
  const rerollBlock = rerollPrevious?.trim()
    ? `\n### [这次是重写]\n上一版续写已经被用户撤回：\n${rerollPrevious.trim().slice(0, 1200)}\n请基于同一个现场重新接这一拍，保留前文事实和用户刚刚的行动/发言，但换一种更自然的成员反应、动作和措辞，不要照抄上一版。`
    : '';
  return callGroupOfflineLLM(api, groupOfflineTurnTaskPrompt({
    base,
    povText: buildGroupPovInstruction(pov, userName),
    transcript,
    action,
    rerollBlock,
    lengthRange,
    lengthRule,
    userName,
  }), 0.9, { charName: group.name, userName }, outputBudget);
};

export const commitGroupOfflineSessionToContext = async (
  group: GroupProfile,
  userName: string,
  entries: GroupOfflineEntry[],
): Promise<OfflineCommitInfo | null> => {
  if (!entries.length) return null;
  const transcript = formatGroupOfflineTranscript(entries, userName);
  const timestamp = Date.now();
  const messageId = await DB.saveMessage({
    charId: 'system',
    groupId: group.id,
    role: 'system',
    type: 'text',
    content: `[group offline session] [群聊线下记录] ${userName} 刚刚和「${group.name}」一起线下见面。现场简记如下：\n${transcript}`,
    metadata: {
      groupId: group.id,
      groupName: group.name,
      groupOfflineSession: true,
    },
    timestamp,
  } as any);
  return { messageId, timestamp };
};
