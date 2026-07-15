/**
 * 角色外貌 Tag 生成 —— 从人设 + 角色绑定（已挂载）的世界书里，提炼出一串
 * booru/danbooru 风格的英文外貌标签（发色发型、瞳色、体型、服饰、配饰、气质…），
 * 直接拿去喂文生图（立绘 / 头像 / 相册）。
 *
 * 和「生活侧写」一样属于「主聊天以外」的辅助任务，走副 API（resolveAuxApi 解析后接口）。
 * 入口在 剪影集 → 登场人物 → 角色编辑器（人物图像区）。
 */

import { CharacterProfile } from '../types';
import { makeApiUsageMeta } from './apiUsageCatalog';
import { callChatCompletion } from './llmClient';
import { buildFullCharacterSetting } from './characterPromptProfile';
import { characterAppearanceTagsPrompt } from './laiwangPrompts';

export interface AppearanceApiConfig {
    baseUrl: string;
    apiKey: string;
    model: string;
}

/**
 * 把剪影集完整角色设定 + 绑定世界书拼成一段「外貌素材」喂给 prompt（纯函数，便于单测）。
 * 不在这里裁剪角色卡或挂载世界书，避免外貌线索被摘要丢失。
 */
export function buildAppearanceSourceText(char: CharacterProfile, _perBookLimit?: number, _totalLimit?: number): string {
    return buildFullCharacterSetting(char, { includeMemos: true });
}

/** 把模型回复清洗成一行逗号分隔的 tag（去重、去引号/代码块/编号、压空白）。 */
export function normalizeTags(raw: string): string {
    let s = (raw || '').trim();
    s = s.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, '').trim();
    // 允许模型用逗号 / 换行 / 顿号分隔
    const parts = s.split(/[,，\n、]+/).map(t => t
        .replace(/^[\s\-*0-9.)）、]+/, '') // 去行首编号/符号
        .replace(/["'“”`]/g, '')
        .trim()
        .toLowerCase(),
    ).filter(Boolean);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of parts) {
        if (!seen.has(p)) { seen.add(p); out.push(p); }
    }
    return out.join(', ');
}

/**
 * 生成外貌 tag。返回逗号分隔的 tag 串；失败返回 null。
 */
export async function generateAppearanceTags(
    char: CharacterProfile,
    api: AppearanceApiConfig,
): Promise<string | null> {
    const source = buildAppearanceSourceText(char);

    const prompt = characterAppearanceTagsPrompt(char.name, source);

    try {
        const data = await callChatCompletion(api, {
            model: api.model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.5,
            max_tokens: 600,
            stream: false,
        }, {
            meta: makeApiUsageMeta('character.appearanceTags', { apiRole: 'aux', charId: char.id, charName: char.name }),
        });
        const content = normalizeTags(data.choices?.[0]?.message?.content || '');
        return content.length >= 3 ? content : null;
    } catch (e: any) {
        console.warn('🎨 [AppearanceTags] generate failed:', e?.message || e);
        return null;
    }
}
