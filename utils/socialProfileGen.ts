import { APIConfig, CharacterProfile } from '../types';
import { safeResponseJson, extractContent } from './safeApi';

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
        `名字: ${char.name}`,
        char.description ? `人设描述: ${String(char.description).slice(0, 800)}` : '',
        char.worldview ? `世界观: ${String(char.worldview).slice(0, 300)}` : '',
        char.socialProfile?.bio ? `已有签名(供参考语气): ${char.socialProfile.bio}` : '',
    ].filter(Boolean).join('\n');

    const prompt = `### 任务
为下面这个角色生成 ta 的微信个人资料，要贴合人设、像真人随手设置的，不要太刻意。

### 角色档案
${persona}

### 要求
- handle: 微信号。字母开头，6~20 位，只能用字母/数字/下划线/减号。常见套路：名字拼音/英文名 + 随手数字、生日、谐音梗等
- region: 地区。格式「省份 城市」（中间一个空格），如「安徽 亳州」「广东 深圳」；若角色明显是海外背景可用「国家 城市」。架空/异世界角色就挑一个气质最接近的现实地区
- bio: 个性签名。一句话（30 字以内），贴合角色性格与说话风格，可以有点小情绪或小心思，别写成自我介绍

### 输出
只输出一个 JSON 对象，不要任何其它文字：
{"handle": "...", "region": "...", "bio": "..."}`;

    const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
        body: JSON.stringify({
            model: apiConfig.model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.9,
            max_tokens: 300,
        }),
    });
    if (!response.ok) throw new Error(`API Error (${response.status})`);
    const data = await safeResponseJson(response);
    const parsed = safeParseObject(extractContent(data));
    if (!parsed) throw new Error('资料生成结果解析失败');

    // handle 不合规则时退回名字派生的兜底（保证字段总是可用）
    const fallbackHandle = `wxid_${char.id.replace(/[^A-Za-z0-9]/g, '').slice(0, 12) || 'moro'}`;
    return {
        handle: sanitizeHandle(parsed.handle) || fallbackHandle,
        region: String(parsed.region || '').trim().slice(0, 20),
        bio: String(parsed.bio || '').trim().slice(0, 60),
    };
};
