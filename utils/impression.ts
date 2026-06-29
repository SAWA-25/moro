import { CharacterProfile } from '../types';
import { ensureCharacterModelId } from './characterIdentity';

// 「印象档案」功能已整体移除（UI / 生成 / prompt 注入都已删），本文件只剩
// 角色字段的历史脏数据兜底。旧存档里残留的 impression 字段会被静默忽略。

/**
 * 历史脏数据兜底：早期 addCharacter 没初始化 emotionConfig，导致一批"新角色"该字段
 * 为 undefined，情绪闸门 (useChatAI:761) 永远过不去。
 * 此处只把 undefined 补成默认 enabled，用户显式关掉 (false) 的不动。
 * memoryPalaceEnabled 是用户显式 opt-in 的功能，不在这里替用户开。
 */
export const normalizeCharacterDefaults = (char: CharacterProfile): CharacterProfile => {
    const withIdentity = ensureCharacterModelId(char);
    if (withIdentity.emotionConfig !== undefined) return withIdentity;
    return { ...withIdentity, emotionConfig: { enabled: true } };
};
