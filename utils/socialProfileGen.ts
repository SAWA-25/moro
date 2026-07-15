import { APIConfig, CharacterProfile } from '../types';
import { extractContent } from './safeApi';
import { callChatCompletion } from './llmClient';
import { makeApiUsageMeta } from './apiUsageCatalog';
import { buildFullCharacterSetting } from './characterPromptProfile';
import { characterSocialProfilePrompt } from './laiwangPrompts';

/**
 * 角色主页「微信号 / 地区 / 个性签名」AI 生成。
 * 进入角色主页时缺啥补啥（只填空缺项，不覆盖已有值），也可强制重新生成。
 */

export interface GeneratedSocialProfile {
    handle: string;
    region: string;
    bio: string;
}

const safeParseObject = (input: string): any => {
    const clean = (input || '').replace(/```json/g, '').replace(/```/g, '').trim();
    try { return JSON.parse(clean); } catch {}
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start >= 0 && end > start) {
        try { return JSON.parse(clean.substring(start, end + 1)); } catch {}
    }
    return null;
};

// 微信号规则：字母开头，6-20 位字母/数字/下划线/减号
const sanitizeHandle = (raw: any): string => {
    const cleaned = String(raw || '').trim().replace(/[^A-Za-z0-9_-]/g, '');
    if (!cleaned || !/^[A-Za-z]/.test(cleaned)) return '';
    return cleaned.slice(0, 20).length >= 6 ? cleaned.slice(0, 20) : '';
};

export const generateSocialProfile = async (
    apiConfig: APIConfig,
    char: CharacterProfile,
): Promise<GeneratedSocialProfile> => {
    const persona = [
        buildFullCharacterSetting(char, { includeMemos: true }),
        char.socialProfile?.bio ? `已有签名(供参考语气): ${char.socialProfile.bio}` : '',
    ].filter(Boolean).join('\n');

    const prompt = characterSocialProfilePrompt(persona);

    const data = await callChatCompletion(apiConfig, {
        model: apiConfig.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.9,
        max_tokens: 300,
    }, {
        meta: makeApiUsageMeta('social.profile', {
            apiRole: 'aux',
            charId: char.id,
            charName: char.name,
        }),
    });
    const parsed = safeParseObject(extractContent(data));
    if (!parsed) throw new Error('资料生成结果解析失败');

    // handle 不合规则时退回名字派生的兜底（保证字段总是可用）。
    // region / bio 同理：模型偶尔换字段名或漏字段，先尝试常见别名，仍为空就给
    // 微信风格兜底——否则资料页只剩微信号，地区和签名整行消失（显示 bug 根因）。
    const fallbackHandle = `wxid_${char.id.replace(/[^A-Za-z0-9]/g, '').slice(0, 12) || 'moro'}`;
    const regionRaw = parsed.region ?? parsed.area ?? parsed.location ?? parsed['地区'];
    const bioRaw = parsed.bio ?? parsed.signature ?? parsed.sign ?? parsed['个性签名'] ?? parsed['签名'];
    return {
        handle: sanitizeHandle(parsed.handle ?? parsed.wechatId ?? parsed['微信号']) || fallbackHandle,
        region: String(regionRaw || '').trim().slice(0, 20) || '保密',
        bio: String(bioRaw || '').trim().slice(0, 60) || '这个人很懒，什么都没留下。',
    };
};
