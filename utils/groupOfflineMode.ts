import type { CharacterProfile, GroupProfile, Message, UserProfile } from '../types';
import { DB } from './db';
import { extractContent, safeResponseJson } from './safeApi';
import type { OfflinePovPerson } from './offlineMode';

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

export const formatGroupOfflineTranscript = (entries: GroupOfflineEntry[], userName: string): string =>
  entries.map(entry => {
    if (entry.role === 'scene') return `(scene) ${entry.text}`;
    if (entry.role === 'user') return `${userName}: ${entry.text}`;
    return `${entry.speakerName || 'Group member'}: ${entry.text}`;
  }).join('\n');

interface GroupOfflineApi {
  baseUrl: string;
  apiKey: string;
  model: string;
}

const callGroupOfflineLLM = async (api: GroupOfflineApi, prompt: string, temperature = 0.9): Promise<string> => {
  const response = await fetch(`${api.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api.apiKey}` },
    body: JSON.stringify({
      model: api.model,
      messages: [{ role: 'user', content: prompt }],
      temperature,
    }),
  });
  if (!response.ok) throw new Error(`API ${response.status}`);
  const data = await safeResponseJson(response);
  return (extractContent(data) || '').trim();
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
  return member ? memberDisplayName(group, member) : (msg.charId || 'Group member');
};

const formatRoster = (group: GroupProfile, members: CharacterProfile[]): string => {
  if (!members.length) return '(no character members yet)';
  return members.map(member => {
    const name = memberDisplayName(group, member);
    const title = group.memberTitles?.[member.id];
    return `- ${name} (id: ${member.id})${title ? `, title: ${title}` : ''}`;
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
  return lines.join('\n') || '(no recent group chat)';
};

const refWord = (person: OfflinePovPerson, label: string): string => {
  if (person === 'first') return `first person "I" for ${label}`;
  if (person === 'second') return `second person "you" for ${label}`;
  return `third person by name for ${label}`;
};

const buildGroupPovInstruction = (pov: GroupOfflinePov, userName: string): string =>
  `### [Narration POV]
- Refer to group members with ${refWord(pov.members, 'each member')}.
- Refer to ${userName} with ${refWord(pov.user, userName)}.
Keep the chosen POV consistent for actions, dialogue tags, and scene narration.`;

const buildGroupOfflineBase = async (
  group: GroupProfile,
  members: CharacterProfile[],
  userProfile: UserProfile,
): Promise<string> => {
  const recent = await DB.getGroupMessages(group.id).catch(() => [] as Message[]);
  const userName = userProfile.name || 'You';
  return `### [Group Face-to-Face Mode]
Group: ${group.name}
User: ${userName}
User profile: ${userProfile.bio || '(none)'}

### [Group Members]
${formatRoster(group, members)}

### [Recent Online Group Chat]
${formatRecentGroupMessages(recent, group, members, userName)}

The group chat is moving into a standalone offline, face-to-face scene. Treat it as the same relationship timeline as the online chat: continue recent topics, promises, moods, jokes, and unfinished tension naturally. Write a grounded live scene, not a detached summary.`;
};

export const generateGroupOfflineOpening = async (
  group: GroupProfile,
  members: CharacterProfile[],
  userProfile: UserProfile,
  api: GroupOfflineApi,
  pov: GroupOfflinePov = loadGroupOfflinePov(group.id),
  scenario?: string,
): Promise<string> => {
  const base = await buildGroupOfflineBase(group, members, userProfile);
  const scenarioBlock = scenario?.trim()
    ? `\n### [Selected Opening Scenario]\n${scenario.trim()}\nFollow this setup when arranging where everyone meets and how the first moment begins.`
    : '\n### [Selected Opening Scenario]\nInfer a plausible meeting place and opening from the recent group chat.';
  return callGroupOfflineLLM(api, `${base}

${buildGroupPovInstruction(pov, userProfile.name || 'You')}
${scenarioBlock}

### [Task]
Write the opening moment of this group face-to-face meeting in 120-280 Chinese characters. Include the place, atmosphere, who is already there or arriving, and at least one fitting group member reaction. Output only the scene text.`);
};

export const generateGroupOfflineTurn = async (
  group: GroupProfile,
  members: CharacterProfile[],
  userProfile: UserProfile,
  api: GroupOfflineApi,
  entries: GroupOfflineEntry[],
  userInput?: string,
  pov: GroupOfflinePov = loadGroupOfflinePov(group.id),
): Promise<string> => {
  const base = await buildGroupOfflineBase(group, members, userProfile);
  const userName = userProfile.name || 'You';
  const transcript = formatGroupOfflineTranscript(entries, userName);
  const action = userInput?.trim()
    ? `${userName} just said or did: ${userInput.trim()}`
    : `${userName} is quiet for the moment; let the group members continue the face-to-face scene naturally.`;
  return callGroupOfflineLLM(api, `${base}

${buildGroupPovInstruction(pov, userName)}

### [Offline Scene So Far]
${transcript || '(the group has just met)'}

### [Latest User Action]
${action}

### [Task]
Continue the onsite group interaction in 80-220 Chinese characters. Let one or more fitting group members respond through dialogue, small actions, and nearby atmosphere. Do not write ${userName}'s next action or line. Output only the continuation.`);
};

export const commitGroupOfflineSessionToContext = async (
  group: GroupProfile,
  userName: string,
  entries: GroupOfflineEntry[],
): Promise<void> => {
  if (!entries.length) return;
  const transcript = formatGroupOfflineTranscript(entries, userName);
  await DB.saveMessage({
    charId: 'system',
    groupId: group.id,
    role: 'system',
    type: 'text',
    content: `[group offline session] [群聊线下记录] ${userName} 刚刚和「${group.name}」一起线下见面了。下面是这次面对面发生的现场记录。见面已经结束，群聊回到线上时，成员们应当把这些当作真实发生过、彼此记得的共同经历，可以自然延续当时的情绪、话题和细节。\n${transcript}`,
    metadata: {
      groupId: group.id,
      groupName: group.name,
      groupOfflineSession: true,
    },
  } as any);
};
