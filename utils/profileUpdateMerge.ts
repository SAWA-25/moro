import type { CharacterProfile, GroupProfile } from '../types';

const hasOwn = <T extends object>(value: T, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const mergeOptionalObject = <T extends object>(
  current: T | undefined,
  patch: T | undefined,
): T | undefined => {
  if (patch === undefined) return undefined;
  return { ...(current || {}), ...patch } as T;
};

/**
 * Character updates often come from compact settings controls that save one
 * nested field at a time. Merge those setting bags against the latest state so
 * rapid UI saves cannot erase sibling settings.
 */
export const mergeCharacterProfileUpdate = (
  current: CharacterProfile,
  updates: Partial<CharacterProfile>,
): CharacterProfile => {
  const next: CharacterProfile = { ...current, ...updates };

  if (hasOwn(updates, 'convoSettings')) {
    next.convoSettings = mergeOptionalObject(current.convoSettings, updates.convoSettings);
  }
  if (hasOwn(updates, 'socialProfile')) {
    next.socialProfile = mergeOptionalObject(current.socialProfile, updates.socialProfile);
  }
  if (hasOwn(updates, 'cityConfig')) {
    next.cityConfig = mergeOptionalObject(current.cityConfig, updates.cityConfig);
  }
  if (hasOwn(updates, 'voiceProfile')) {
    next.voiceProfile = mergeOptionalObject(current.voiceProfile, updates.voiceProfile);
  }
  if (hasOwn(updates, 'emotionConfig')) {
    next.emotionConfig = mergeOptionalObject(current.emotionConfig, updates.emotionConfig);
  }
  if (hasOwn(updates, 'proactiveConfig')) {
    next.proactiveConfig = mergeOptionalObject(current.proactiveConfig, updates.proactiveConfig);
  }

  return next;
};

const hasEmotionBuffPatch = (updates: Partial<CharacterProfile>): boolean =>
  hasOwn(updates, 'activeBuffs') || hasOwn(updates, 'buffInjection');

/**
 * Some background jobs update archival/profile fields after emotion eval has
 * already saved fresher buffs to IndexedDB. If the job did not explicitly
 * touch buffs, keep the persisted emotion state instead of writing an older
 * in-memory snapshot back over it.
 */
export const preserveCharacterEmotionState = (
  candidate: CharacterProfile,
  latestPersisted: CharacterProfile | null | undefined,
  updates: Partial<CharacterProfile>,
): CharacterProfile => {
  if (!latestPersisted || hasEmotionBuffPatch(updates)) return candidate;
  return {
    ...candidate,
    activeBuffs: latestPersisted.activeBuffs,
    buffInjection: latestPersisted.buffInjection,
  };
};

export const mergeGroupProfileUpdate = (
  current: GroupProfile,
  updates: Partial<GroupProfile>,
): GroupProfile => {
  const next: GroupProfile = { ...current, ...updates };

  if (hasOwn(updates, 'convoSettings')) {
    next.convoSettings = mergeOptionalObject(current.convoSettings, updates.convoSettings);
  }

  return next;
};
