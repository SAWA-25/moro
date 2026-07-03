import type { CharacterProfile, GroupProfile, Message, UserProfile } from '../types';
import { DB } from './db';
import { extractContent } from './safeApi';
import type { OfflineCommitInfo, OfflinePovPerson } from './offlineMode';
import { formatCharacterWithId } from './characterIdentity';
import { callChatCompletion } from './llmClient';
import { makeApiUsageMeta } from './apiUsageCatalog';

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
const callGroupOfflineLLM = async (api: GroupOfflineApi, prompt: string, temperature = 0.9): Promise<string> => {
  const data = await callChatCompletion(api, {
    model: api.model,
    messages: [{ role: 'user', content: prompt }],
    temperature,
  }, {
    meta: makeApiUsageMeta('chat.groupOfflineMode', {
      apiRole: api.apiRole || 'main',
      apiBinding: api.apiBinding,
    }),
  });
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
  return member ? formatCharacterWithId(member, memberDisplayName(group, member)) : (msg.charId || '群成员');
};

const formatRoster = (group: GroupProfile, members: CharacterProfile[]): string => {
  if (!members.length) return '（暂无角色成员）';
  return members.map(member => {
    const name = memberDisplayName(group, member);
    const title = group.memberTitles?.[member.id];
    return `- ${formatCharacterWithId(member, name)}${title ? `, title: ${title}` : ''}`;
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
  return `### [群聊线下面对面模式]
群聊：${group.name}
用户：${userName}
用户档案：${userProfile.bio || '（暂无）'}

### [群成员]
${formatRoster(group, members)}

### [最近的线上群聊]
${formatRecentGroupMessages(recent, group, members, userName)}

### [线下模式规则]
这场群体见面是上面线上群聊的直接延续，不是独立番外。请延续最近聊到的话题、玩笑、约定、情绪和未说完的 tension，让大家像真的从群聊走到现场。
- 谁接话由性格、关系和刚才的话题决定；不需要每位成员轮流发言，也不要强行全员有戏；
- 群聊现场要有生活感：到场顺序、座位/站位、身边声音、尴尬停顿、有人插话、有人只做小动作，都可以自然出现；
- 不要把线下聚会写成会议纪要、剧情总结或整齐的舞台调度；
- 不要替 ${userName} 说话或行动，除非已有记录里明确写过。`;
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
    ? `\n### [选定开场]\n${scenario.trim()}\n请按这个设定安排大家在哪里见面、谁先出现、第一刻怎么开始。`
    : '\n### [选定开场]\n请根据最近群聊推断一个合理的见面地点和开场方式。';
  return callGroupOfflineLLM(api, `${base}

${buildGroupPovInstruction(pov, userProfile.name || '你')}
${scenarioBlock}

### [任务]
写出群体线下面对面见面的开场（120-280字）：
- 交代地点、氛围、谁已经到了/谁刚到，但只写现场会注意到的具体细节；
- 至少让一位最适合接这个场的人有反应，可以是台词、小动作、插科打诨或沉默；
- 承接最近群聊里的话题或约定，让这场见面像自然落地；
- 不要替 ${userProfile.name || '你'} 说话或行动，不要让所有成员机械轮流亮相。
只输出现场正文，不要前缀或解释。`);
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
  const userName = userProfile.name || '你';
  const transcript = formatGroupOfflineTranscript(entries, userName);
  const action = userInput?.trim()
    ? `${userName} 刚刚说了/做了：${userInput.trim()}`
    : `${userName} 暂时没有新的行动；让群成员按现场气氛自然继续。`;
  return callGroupOfflineLLM(api, `${base}

${buildGroupPovInstruction(pov, userName)}

### [线下现场已发生]
${transcript || '（大家刚刚见面）'}

### [用户刚刚的行动]
${action}

### [任务]
续写接下来的一小段群体现场互动（80-220字）：
- 先回应 ${userName} 刚刚的行动/发言，没人需要回应时就让现场自然流动；
- 让一位或几位最适合的人接话，不要强行全员轮流，不要写成主持人总结；
- 可以穿插小动作、视线、停顿、身边环境和成员之间的打岔，但要短、具体、像真人聚在一起；
- 不要替 ${userName} 说话或行动，不要突然推进不符合关系的亲密或冲突。
只输出续写正文，不要前缀或解释。`);
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
    content: `[group offline session] [群聊线下记录] ${userName} 刚刚和「${group.name}」一起线下见面了。下面是这次面对面发生的现场记录。见面已经结束，这段经历已经写入群聊上下文，但这不是要求成员们立刻补一轮线上消息。之后群聊接着聊时，成员们应当把这些当作真实发生过、彼此记得的共同经历：可以自然延续当时的情绪、玩笑、尴尬、未说完的话和现场细节；有人可以轻描淡写地提起，有人也可以嘴硬、装作没事或接着群聊原本的话题。严格保持时间边界：没有在下面记录中明确发生的外卖送达、快递到达、电话接通、约定完成等事件，都还不能说成已经发生。不要表现得像没见过面，也不要把这段经历复述成整齐的总结报告。\n${transcript}`,
    metadata: {
      groupId: group.id,
      groupName: group.name,
      groupOfflineSession: true,
    },
    timestamp,
  } as any);
  return { messageId, timestamp };
};
