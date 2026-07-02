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

export interface AppearanceApiConfig {
    baseUrl: string;
    apiKey: string;
    model: string;
}

/**
 * 把角色核心设定 + 绑定世界书拼成一段「外貌素材」喂给 prompt（纯函数，便于单测）。
 * 只取已启用（enabled !== false）的挂载世界书，单条与总量都做截断防止 prompt 过长。
 */
export function buildAppearanceSourceText(char: CharacterProfile, perBookLimit = 600, totalLimit = 4000): string {
    const personaParts = [
        char.systemPrompt ? `核心设定：\n${char.systemPrompt}` : '',
        char.worldview ? `世界观/背景：\n${char.worldview}` : '',
    ].filter(Boolean);

    const books = (char.mountedWorldbooks || []).filter(b => b && b.enabled !== false && (b.content || '').trim());
    const bookLines = books.map(b => {
        const body = (b.content || '').trim().slice(0, perBookLimit);
        return `【${b.title || '世界书条目'}】${body}`;
    });

    let text = [
        personaParts.join('\n\n'),
        bookLines.length ? `绑定世界书（外貌相关线索请从中提取）：\n${bookLines.join('\n')}` : '',
    ].filter(Boolean).join('\n\n');

    if (text.length > totalLimit) text = text.slice(0, totalLimit);
    return text;
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

    const prompt = `你是文生图标签（booru / danbooru 风格）提炼助手。下面是角色「${char.name}」的人设与绑定世界书，请据此提炼 TA 的**外貌**标签。

${source || '（资料不多，凭名字与常识给出合理且中性的外貌标签。）'}

要求：
1. 只输出**外貌相关**的标签：性别、发色发型、瞳色、肤色、体型身高气质、显著面部特征、惯常服饰与配饰、表情气场等。不要剧情、性格、能力、场景标签。
2. 全部用**英文小写**，booru 习惯（用下划线或空格都行），如 long_hair, silver eyes, black coat。
3. 用**英文逗号**分隔，一行输出，12-25 个标签为宜。
4. 只从资料中**有依据**地提取；资料没提到的别硬编，可给中性合理项，不要互相矛盾。
5. 直接输出标签本身，不要前言、不要解释、不要代码块、不要编号。`;

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
