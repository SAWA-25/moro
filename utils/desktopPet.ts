import type { DesktopPetAutoBehavior, DesktopPetMood, DesktopPetReminder, DesktopPetRoleState, DesktopPetState, DesktopPetTalkMessage } from '../types';

export type DesktopPetReminderRepeat = 'none' | 'daily';

export interface DesktopPetActionManifest {
  id: string;
  images: string;
  actNum: number;
  frameRefresh: number;
  needMove?: boolean;
  direction?: 'left' | 'right' | string;
  frameMove?: number;
  anchor?: [number, number];
  frames: string[];
}

export interface DesktopPetRandomAct {
  name: string;
  actList: string[];
  actProb: number;
  actType: [number, number];
  sound?: string[];
}

export interface DesktopPetRoleManifest {
  id: string;
  name: string;
  width: number;
  height: number;
  scale: number;
  refresh: number;
  interactSpeed: number;
  defaultAction: string;
  patAction: string;
  randomActs: DesktopPetRandomAct[];
  favorites: Record<string, number>;
  dislikes: Record<string, number>;
  messageDict: Record<string, string>;
  actions: Record<string, DesktopPetActionManifest>;
}

export interface DesktopPetItemManifest {
  id: string;
  name: string;
  effectHP: number;
  effectFV: number;
  dropRate: number;
  fvLock: number;
  fvReward?: number;
  type: string;
  description: string;
  image: string;
  petLimit?: string[];
}

export interface DesktopPetManifest {
  version: number;
  generatedAt: string;
  source: string;
  roles: Record<string, DesktopPetRoleManifest>;
  items: Record<string, DesktopPetItemManifest>;
}

export const DESKTOP_PET_STATE_ID = 'main';
export const DESKTOP_PET_DEFAULT_ROLE = '流浪者';
export const DESKTOP_PET_MANIFEST_URL = './dyberpet/genshin/manifest.json';
export const DESKTOP_PET_HP_MAX = 200;
export const DESKTOP_PET_FV_MAX = 999;
export const DESKTOP_PET_DIALOGUE_LIMIT = 40;
export const DESKTOP_PET_PROMPT_LIMIT = 1200;
export const DESKTOP_PET_FALL_SPEED_MIN = 60;
export const DESKTOP_PET_FALL_SPEED_MAX = 360;
export const DESKTOP_PET_FALL_SPEED_DEFAULT = 150;
export const DESKTOP_PET_DEFAULT_AUTO_BEHAVIOR: DesktopPetAutoBehavior = 'gentle';
export const DESKTOP_PET_HP_DECAY_PER_HOUR = 2;
export const DESKTOP_PET_HP_DECAY_MAX_HOURS = 12;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export type DesktopPetWalkDirection = 'left' | 'right';

export interface DesktopPetManualAction {
  id: string;
  label: string;
}

export interface DesktopPetMoodMeta {
  label: string;
  description: string;
  accent: string;
}

const DESKTOP_PET_AUTO_BEHAVIORS: DesktopPetAutoBehavior[] = ['quiet', 'gentle', 'lively'];

const DESKTOP_PET_BLOCKED_MANUAL_ACTIONS = new Set([
  'default',
  'up',
  'down',
  'left',
  'right',
  'left_walk',
  'right_walk',
  'drag',
  'fall',
  'onfloor',
]);

const DESKTOP_PET_BLOCKED_MANUAL_ACTION_PREFIXES = ['feed_'];

const DESKTOP_PET_ACTION_LABELS: Record<string, string> = {
  sleep: '睡一会',
  sit: '坐下',
  patpat: '摸摸反应',
  niaolong: '鸟笼',
  zhiren: '纸人',
  wavehand: '挥手',
  wavehand2: '挥手',
  shr: '伸展',
  quiqian1: '求签',
  quiqian2: '再求一签',
  quiqian3: '小小占卜',
  look: '探头',
  wind: '起风',
  str: '伸展',
  e_skill1: '小技能',
  e_skill2: '小技能',
  e_skill3: '小技能',
  qskill: '大招',
  palace_1: '标本馆',
  palace_2: '标本馆',
  palace_3: '标本馆',
  photo_frame_1: '拍照',
  photo_frame_2: '拍照',
  photo_frame_3: '拍照',
};

export const DESKTOP_PET_MOOD_META: Record<DesktopPetMood, DesktopPetMoodMeta> = {
  hungry: { label: '有点饿', description: '饱腹偏低，喂点喜欢的食物会恢复精神。', accent: 'emerald' },
  lonely: { label: '想陪伴', description: '有一阵没互动了，摸摸或说句话会让它安心。', accent: 'sky' },
  happy: { label: '很亲近', description: '最近有互动，好感也不错，正适合一起待着。', accent: 'pink' },
  sleepy: { label: '犯困', description: '夜深了，桌宠会更安静一点。', accent: 'violet' },
  calm: { label: '安稳', description: '状态平稳，适合轻轻陪在桌面上。', accent: 'slate' },
};

const DESKTOP_PET_ACTION_HOLD_LOOPS: Record<string, number> = {
  sleep: 4,
  sit: 3,
};

export const isDesktopPetWalkAction = (actionId: string): actionId is 'left_walk' | 'right_walk' => (
  actionId === 'left_walk' || actionId === 'right_walk'
);

export const getDesktopPetActionHoldLoops = (actionId: string): number => (
  DESKTOP_PET_ACTION_HOLD_LOOPS[actionId] || 1
);

export const isDesktopPetIdleAction = (
  actionId: string,
  defaultAction = 'default',
): boolean => (
  actionId === defaultAction
  || actionId === 'default'
  || actionId === 'left'
  || actionId === 'right'
);

export const canDesktopPetAutoWalkDuringAction = (
  actionId: string,
  defaultAction = 'default',
): boolean => (
  isDesktopPetIdleAction(actionId, defaultAction) || isDesktopPetWalkAction(actionId)
);

export const createDefaultDesktopPetState = (now = Date.now()): DesktopPetState => ({
  id: DESKTOP_PET_STATE_ID,
  activeRoleId: DESKTOP_PET_DEFAULT_ROLE,
  floatingEnabled: false,
  overlay: { x: 24, y: 220, scale: 0.72, dockSide: 'none' },
  aiEnabled: true,
  autoBehavior: DESKTOP_PET_DEFAULT_AUTO_BEHAVIOR,
  fallSpeed: DESKTOP_PET_FALL_SPEED_DEFAULT,
  lastCareTickAt: now,
  dialogueLog: [],
  notificationsEnabled: false,
  roleStates: {},
  reminders: [],
  updatedAt: now,
});

export const clampNumber = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
};

export const normalizeDesktopPetAutoBehavior = (value?: string | null): DesktopPetAutoBehavior => (
  DESKTOP_PET_AUTO_BEHAVIORS.includes(value as DesktopPetAutoBehavior)
    ? value as DesktopPetAutoBehavior
    : DESKTOP_PET_DEFAULT_AUTO_BEHAVIOR
);

export const sortFrameNames = (frames: string[]): string[] => [...frames].sort((a, b) => {
  const an = Number((a.match(/_(\d+)\.[^./?#]+(?:[?#].*)?$/) || [])[1] ?? Number.MAX_SAFE_INTEGER);
  const bn = Number((b.match(/_(\d+)\.[^./?#]+(?:[?#].*)?$/) || [])[1] ?? Number.MAX_SAFE_INTEGER);
  if (an !== bn) return an - bn;
  return a.localeCompare(b, 'zh-Hans-CN');
});

export const normalizeDesktopPetPrompt = (prompt?: string | null): string => (
  (prompt || '').replace(/\r\n/g, '\n').trim().slice(0, DESKTOP_PET_PROMPT_LIMIT)
);

export const normalizeDesktopPetRolePrompts = (prompts?: Record<string, string> | null): Record<string, string> => {
  if (!prompts || typeof prompts !== 'object') return {};
  return Object.entries(prompts).reduce<Record<string, string>>((acc, [roleId, prompt]) => {
    const cleanRoleId = roleId.trim();
    const cleanPrompt = normalizeDesktopPetPrompt(prompt);
    if (cleanRoleId && cleanPrompt) acc[cleanRoleId] = cleanPrompt;
    return acc;
  }, {});
};

export const ensureDesktopPetState = (state?: DesktopPetState | null, now = Date.now()): DesktopPetState => ({
  ...createDefaultDesktopPetState(now),
  ...(state || {}),
  id: DESKTOP_PET_STATE_ID,
  overlay: {
    ...createDefaultDesktopPetState(now).overlay,
    ...(state?.overlay || {}),
    scale: clampNumber(state?.overlay?.scale ?? 0.72, 0.45, 1.35),
    dockSide: state?.overlay?.dockSide || 'none',
  },
  aiEnabled: state?.aiEnabled !== false,
  autoBehavior: normalizeDesktopPetAutoBehavior(state?.autoBehavior),
  fallSpeed: clampNumber(state?.fallSpeed ?? DESKTOP_PET_FALL_SPEED_DEFAULT, DESKTOP_PET_FALL_SPEED_MIN, DESKTOP_PET_FALL_SPEED_MAX),
  lastCareTickAt: typeof state?.lastCareTickAt === 'number' && Number.isFinite(state.lastCareTickAt) ? state.lastCareTickAt : now,
  rolePrompts: normalizeDesktopPetRolePrompts(state?.rolePrompts),
  dialogueLog: Array.isArray(state?.dialogueLog) ? state.dialogueLog.slice(-DESKTOP_PET_DIALOGUE_LIMIT) : [],
  lastSpeech: state?.lastSpeech,
  roleStates: state?.roleStates || {},
  reminders: Array.isArray(state?.reminders) ? state.reminders : [],
});

export const setDesktopPetAutoBehavior = (
  input: DesktopPetState,
  autoBehavior: DesktopPetAutoBehavior,
  now = Date.now(),
): DesktopPetState => ({
  ...ensureDesktopPetState(input, now),
  autoBehavior: normalizeDesktopPetAutoBehavior(autoBehavior),
  updatedAt: now,
});

export const setDesktopPetRolePrompt = (
  input: DesktopPetState,
  roleId: string,
  prompt: string,
  now = Date.now(),
): DesktopPetState => {
  const state = ensureDesktopPetState(input, now);
  const cleanRoleId = roleId.trim();
  if (!cleanRoleId) return state;
  const cleanPrompt = normalizeDesktopPetPrompt(prompt);
  const rolePrompts = { ...(state.rolePrompts || {}) };
  if (cleanPrompt) rolePrompts[cleanRoleId] = cleanPrompt;
  else delete rolePrompts[cleanRoleId];
  return {
    ...state,
    rolePrompts,
    updatedAt: now,
  };
};

export const createDesktopPetTalkMessage = (
  input: Omit<DesktopPetTalkMessage, 'id' | 'createdAt'> & { id?: string; createdAt?: number },
  now = Date.now(),
): DesktopPetTalkMessage => ({
  id: input.id || `dpet_msg_${now}_${Math.random().toString(36).slice(2, 8)}`,
  role: input.role,
  text: input.text.trim(),
  createdAt: input.createdAt ?? now,
  source: input.source,
  itemId: input.itemId,
});

export const appendDesktopPetDialogue = (
  input: DesktopPetState,
  messages: DesktopPetTalkMessage | DesktopPetTalkMessage[],
  now = Date.now(),
): DesktopPetState => {
  const state = ensureDesktopPetState(input, now);
  const incoming = (Array.isArray(messages) ? messages : [messages])
    .filter(message => message.text.trim().length > 0);
  if (incoming.length === 0) return state;
  const dialogueLog = [...(state.dialogueLog || []), ...incoming].slice(-DESKTOP_PET_DIALOGUE_LIMIT);
  const lastSpeech = [...incoming].reverse().find(message => message.role === 'pet') || state.lastSpeech;
  return {
    ...state,
    dialogueLog,
    lastSpeech,
    updatedAt: now,
  };
};

export const clearDesktopPetDialogue = (
  input: DesktopPetState,
  now = Date.now(),
): DesktopPetState => ({
  ...ensureDesktopPetState(input, now),
  dialogueLog: [],
  lastSpeech: undefined,
  updatedAt: now,
});

export const getDesktopPetRoleState = (state: DesktopPetState, roleId: string): DesktopPetRoleState => (
  state.roleStates?.[roleId] || { hp: 80, fv: 0 }
);

export const getDesktopPetLastInteractionAt = (roleState: DesktopPetRoleState): number => Math.max(
  roleState.lastInteractedAt || 0,
  roleState.lastFedAt || 0,
  roleState.lastPattedAt || 0,
  roleState.lastTalkedAt || 0,
);

export const applyDesktopPetCareTick = (
  input: DesktopPetState,
  now = Date.now(),
): DesktopPetState => {
  const state = ensureDesktopPetState(input, now);
  const lastCareTickAt = typeof input.lastCareTickAt === 'number' && Number.isFinite(input.lastCareTickAt) ? input.lastCareTickAt : now;
  const elapsedHours = Math.floor((now - lastCareTickAt) / HOUR_MS);
  if (elapsedHours <= 0) {
    return state.lastCareTickAt === lastCareTickAt ? state : { ...state, lastCareTickAt };
  }

  const hpLoss = Math.min(elapsedHours, DESKTOP_PET_HP_DECAY_MAX_HOURS) * DESKTOP_PET_HP_DECAY_PER_HOUR;
  const roleIds = new Set([state.activeRoleId, ...Object.keys(state.roleStates || {})].filter(Boolean));
  const roleStates = { ...state.roleStates };
  roleIds.forEach(roleId => {
    const prev = getDesktopPetRoleState(state, roleId);
    roleStates[roleId] = {
      ...prev,
      hp: clampNumber((prev.hp || 0) - hpLoss, 0, DESKTOP_PET_HP_MAX),
    };
  });

  return {
    ...state,
    roleStates,
    lastCareTickAt: now,
    updatedAt: now,
  };
};

export const getDesktopPetMood = (
  state: DesktopPetState,
  roleId: string,
  now = Date.now(),
): DesktopPetMood => {
  const roleState = getDesktopPetRoleState(state, roleId);
  if (roleState.hp <= 35) return 'hungry';

  const hour = new Date(now).getHours();
  if (hour >= 23 || hour < 6) return 'sleepy';

  const lastInteractionAt = getDesktopPetLastInteractionAt(roleState);
  if (lastInteractionAt && now - lastInteractionAt <= 2 * HOUR_MS && roleState.fv >= 40) return 'happy';
  if ((!lastInteractionAt || now - lastInteractionAt > 48 * HOUR_MS) && roleState.fv < 80) return 'lonely';
  return 'calm';
};

export const getDesktopPetMoodMeta = (mood: DesktopPetMood): DesktopPetMoodMeta => DESKTOP_PET_MOOD_META[mood];

export const markDesktopPetTalked = (
  input: DesktopPetState,
  roleId: string,
  now = Date.now(),
): DesktopPetState => {
  const state = ensureDesktopPetState(input, now);
  const prev = getDesktopPetRoleState(state, roleId);
  return {
    ...state,
    activeRoleId: roleId,
    roleStates: {
      ...state.roleStates,
      [roleId]: {
        ...prev,
        lastTalkedAt: now,
        lastInteractedAt: now,
      },
    },
    updatedAt: now,
  };
};

export const canUseDesktopPetItem = (item: DesktopPetItemManifest, roleId: string): boolean => (
  item.type === 'consumable' && (!item.petLimit || item.petLimit.includes(roleId))
);

export const getDesktopPetItemMultiplier = (
  role: DesktopPetRoleManifest | undefined,
  itemName: string,
): number => {
  if (!role) return 1;
  const favorite = Number(role.favorites?.[itemName]);
  if (Number.isFinite(favorite) && favorite > 0) return favorite;
  const dislike = Number(role.dislikes?.[itemName]);
  if (Number.isFinite(dislike)) return dislike;
  return 1;
};

export const feedDesktopPet = (
  input: DesktopPetState,
  manifest: DesktopPetManifest,
  roleId: string,
  itemId: string,
  now = Date.now(),
): { state: DesktopPetState; actionId: string; message: string; hpDelta: number; fvDelta: number } => {
  const state = ensureDesktopPetState(input, now);
  const role = manifest.roles[roleId];
  const item = manifest.items[itemId];
  if (!role || !item || !canUseDesktopPetItem(item, roleId)) {
    return { state, actionId: role?.actions.feed_3 ? 'feed_3' : role?.defaultAction || 'default', message: '这个不能喂给当前桌宠。', hpDelta: 0, fvDelta: 0 };
  }

  const multiplier = getDesktopPetItemMultiplier(role, item.name);
  const prev = getDesktopPetRoleState(state, roleId);
  const hpDelta = Math.round(item.effectHP * multiplier);
  const fvDelta = Math.round((item.effectFV + (item.fvReward || 0)) * multiplier);
  const nextRole: DesktopPetRoleState = {
    ...prev,
    hp: clampNumber((prev.hp || 0) + hpDelta, 0, DESKTOP_PET_HP_MAX),
    fv: clampNumber((prev.fv || 0) + fvDelta, 0, DESKTOP_PET_FV_MAX),
    lastFedAt: now,
    lastInteractedAt: now,
  };
  const actionId = multiplier > 1 ? 'feed_1' : multiplier < 1 ? 'feed_3' : 'feed_2';

  return {
    state: {
      ...state,
      activeRoleId: roleId,
      roleStates: { ...state.roleStates, [roleId]: nextRole },
      updatedAt: now,
    },
    actionId: role.actions[actionId] ? actionId : role.defaultAction,
    message: multiplier > 1
      ? `${role.name} 很喜欢 ${item.name}。`
      : multiplier < 1
        ? `${role.name} 对 ${item.name} 兴致不高。`
        : `${role.name} 吃下了 ${item.name}。`,
    hpDelta,
    fvDelta,
  };
};

export const buildDesktopPetFallbackSpeech = (
  roleName: string,
  source: DesktopPetTalkMessage['source'] = 'chat',
  options: {
    userText?: string;
    itemName?: string;
    multiplier?: number;
    hpDelta?: number;
    fvDelta?: number;
  } = {},
): string => {
  if (source === 'feed') {
    if (!options.itemName) return `${roleName}看了看你递来的东西，轻轻点了点头。`;
    if ((options.multiplier ?? 1) > 1) return `${roleName}接过${options.itemName}，眼睛明显亮了一下。这个味道很合心意。`;
    if ((options.multiplier ?? 1) < 1) return `${roleName}尝了尝${options.itemName}，表情有点微妙，但还是收下了你的心意。`;
    return `${roleName}吃下了${options.itemName}，看起来精神了一点。`;
  }
  if (source === 'pat') return `${roleName}被摸了摸，安静地靠近了一点。`;
  if (source === 'reminder') return `${roleName}轻轻敲了敲屏幕，提醒你看一眼待办。`;
  if (source === 'idle') return `${roleName}晃了晃，像是在等你继续陪一会儿。`;
  const text = options.userText?.trim();
  if (text) return `${roleName}听见了：“${text.slice(0, 24)}”。`;
  return `${roleName}看着你，轻轻应了一声。`;
};

export const buildDesktopPetReminderSpeech = (
  roleName: string,
  reminder: Pick<DesktopPetReminder, 'title' | 'note'>,
): string => {
  const title = reminder.title.trim() || '提醒';
  const note = reminder.note?.trim();
  return note
    ? `${roleName}轻轻敲了敲屏幕：${title}。${note}`
    : `${roleName}轻轻敲了敲屏幕：${title}。`;
};

export const getDesktopPetActionLabel = (actionId: string): string => (
  DESKTOP_PET_ACTION_LABELS[actionId]
  || actionId
    .replace(/^e_skill/i, '技能 ')
    .replace(/^qskill$/i, '大招')
    .replace(/_/g, ' ')
);

export const isDesktopPetSafeManualAction = (actionId: string): boolean => (
  !!actionId
  && !DESKTOP_PET_BLOCKED_MANUAL_ACTIONS.has(actionId)
  && !DESKTOP_PET_BLOCKED_MANUAL_ACTION_PREFIXES.some(prefix => actionId.startsWith(prefix))
);

export const listDesktopPetManualActions = (
  role: DesktopPetRoleManifest | undefined,
  limit = 18,
): DesktopPetManualAction[] => {
  if (!role) return [];
  const ordered = [
    ...(role.randomActs || []).flatMap(act => act.actList || []),
    ...Object.keys(role.actions || {}),
  ];
  const seen = new Set<string>();
  return ordered
    .filter(actionId => {
      if (seen.has(actionId) || !role.actions[actionId] || !isDesktopPetSafeManualAction(actionId)) return false;
      seen.add(actionId);
      return true;
    })
    .slice(0, limit)
    .map(actionId => ({ id: actionId, label: getDesktopPetActionLabel(actionId) }));
};

export const clampDesktopPetOverlay = (
  overlay: DesktopPetState['overlay'],
  viewport: { width: number; height: number },
  size: { width: number; height: number } = { width: 96, height: 128 },
): DesktopPetState['overlay'] => {
  const maxX = Math.max(0, viewport.width - size.width);
  const maxY = Math.max(0, viewport.height - size.height);
  return {
    ...overlay,
    x: clampNumber(overlay.x, 0, maxX),
    y: clampNumber(overlay.y, 0, maxY),
    scale: clampNumber(overlay.scale, 0.45, 1.35),
    dockSide: overlay.dockSide || 'none',
  };
};

export const dockDesktopPetOverlay = (
  overlay: DesktopPetState['overlay'],
  viewport: { width: number; height: number },
  size: { width: number; height: number } = { width: 96, height: 128 },
  side?: 'left' | 'right',
): DesktopPetState['overlay'] => {
  const threshold = Math.max(20, Math.min(40, viewport.width * 0.08));
  const requested = side || (
    overlay.x <= threshold
      ? 'left'
      : overlay.x + size.width >= viewport.width - threshold
        ? 'right'
        : 'none'
  );
  if (requested === 'left') {
    return clampDesktopPetOverlay({ ...overlay, x: 0, dockSide: 'left' }, viewport, size);
  }
  if (requested === 'right') {
    return clampDesktopPetOverlay({ ...overlay, x: Math.max(0, viewport.width - size.width), dockSide: 'right' }, viewport, size);
  }
  return clampDesktopPetOverlay({ ...overlay, dockSide: 'none' }, viewport, size);
};

export const advanceDesktopPetWalkOverlay = (
  overlay: DesktopPetState['overlay'],
  direction: DesktopPetWalkDirection,
  viewport: { width: number; height: number },
  size: { width: number; height: number } = { width: 96, height: 128 },
  step = 4,
): { overlay: DesktopPetState['overlay']; direction: DesktopPetWalkDirection; actionId: 'left_walk' | 'right_walk' } => {
  const maxX = Math.max(0, viewport.width - size.width);
  const rawX = overlay.x + (direction === 'right' ? step : -step);
  if (rawX <= 0) {
    return {
      overlay: clampDesktopPetOverlay({ ...overlay, x: 0, dockSide: 'none' }, viewport, size),
      direction: 'right',
      actionId: 'right_walk',
    };
  }
  if (rawX >= maxX) {
    return {
      overlay: clampDesktopPetOverlay({ ...overlay, x: maxX, dockSide: 'none' }, viewport, size),
      direction: 'left',
      actionId: 'left_walk',
    };
  }
  return {
    overlay: clampDesktopPetOverlay({ ...overlay, x: rawX, dockSide: 'none' }, viewport, size),
    direction,
    actionId: direction === 'right' ? 'right_walk' : 'left_walk',
  };
};

export const advanceDesktopPetFallOverlay = (
  overlay: DesktopPetState['overlay'],
  viewport: { width: number; height: number },
  size: { width: number; height: number } = { width: 96, height: 128 },
  deltaSeconds = 1 / 60,
  speed = DESKTOP_PET_FALL_SPEED_DEFAULT,
  targetY = overlay.y + 36,
): { overlay: DesktopPetState['overlay']; landed: boolean } => {
  const safeDelta = clampNumber(deltaSeconds, 0, 0.08);
  const maxY = Math.max(0, viewport.height - size.height);
  const safeTargetY = clampNumber(targetY, 0, maxY);
  const step = clampNumber(speed, DESKTOP_PET_FALL_SPEED_MIN, DESKTOP_PET_FALL_SPEED_MAX) * safeDelta;
  const nextY = Math.min(safeTargetY, overlay.y + step);
  return {
    overlay: clampDesktopPetOverlay({ ...overlay, y: nextY }, viewport, size),
    landed: nextY >= safeTargetY - 0.5,
  };
};

export const getDesktopPetFallTargetY = (
  overlay: DesktopPetState['overlay'],
  viewport: { width: number; height: number },
  size: { width: number; height: number } = { width: 96, height: 128 },
  distance = 36,
): number => {
  const maxY = Math.max(0, viewport.height - size.height);
  return clampNumber(overlay.y + distance, 0, maxY);
};

export const shouldPlaceDesktopPetControlsOnLeft = (
  overlay: DesktopPetState['overlay'],
  viewportWidth: number,
  size: { width: number; height: number } = { width: 96, height: 128 },
  controlsWidth = 36,
): boolean => overlay.x + size.width + controlsWidth > viewportWidth;

export const patDesktopPet = (
  input: DesktopPetState,
  roleId: string,
  now = Date.now(),
): DesktopPetState => {
  const state = ensureDesktopPetState(input, now);
  const prev = getDesktopPetRoleState(state, roleId);
  return {
    ...state,
    activeRoleId: roleId,
    roleStates: {
      ...state.roleStates,
      [roleId]: {
        ...prev,
        fv: clampNumber((prev.fv || 0) + 1, 0, DESKTOP_PET_FV_MAX),
        lastPattedAt: now,
        lastInteractedAt: now,
      },
    },
    updatedAt: now,
  };
};

export const selectDesktopPetRandomAction = (
  role: DesktopPetRoleManifest | undefined,
  random = Math.random,
): string => {
  if (!role) return 'default';
  const candidates = role.randomActs
    .filter(act => act.actProb > 0 && act.actList.some(actionId => !!role.actions[actionId]))
    .map(act => ({ act, weight: act.actProb }));
  const total = candidates.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0) return role.defaultAction;
  let roll = random() * total;
  for (const { act, weight } of candidates) {
    roll -= weight;
    if (roll <= 0) {
      const list = act.actList.filter(actionId => !!role.actions[actionId]);
      return list[Math.floor(random() * list.length)] || role.defaultAction;
    }
  }
  return role.defaultAction;
};

export const getDueDesktopPetReminders = (
  reminders: DesktopPetReminder[],
  now = Date.now(),
): DesktopPetReminder[] => reminders.filter(reminder => (
  reminder.enabled !== false
  && reminder.dueAt <= now
  && (!reminder.lastFiredAt || reminder.lastFiredAt < reminder.dueAt)
));

export const markDesktopPetReminderFired = (
  reminder: DesktopPetReminder,
  now = Date.now(),
): DesktopPetReminder => {
  if (reminder.repeat === 'daily') {
    let nextDueAt = reminder.dueAt + DAY_MS;
    while (nextDueAt <= now) nextDueAt += DAY_MS;
    return { ...reminder, dueAt: nextDueAt, lastFiredAt: now, enabled: true };
  }
  return { ...reminder, lastFiredAt: now, enabled: false };
};

export const markDueDesktopPetRemindersFired = (
  state: DesktopPetState,
  now = Date.now(),
): { state: DesktopPetState; due: DesktopPetReminder[] } => {
  const due = getDueDesktopPetReminders(state.reminders || [], now);
  if (due.length === 0) return { state, due };
  const dueIds = new Set(due.map(reminder => reminder.id));
  return {
    due,
    state: {
      ...state,
      reminders: state.reminders.map(reminder => (
        dueIds.has(reminder.id) ? markDesktopPetReminderFired(reminder, now) : reminder
      )),
      updatedAt: now,
    },
  };
};
