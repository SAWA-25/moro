/**
 * 「输入动效」AI 生成 SVG。
 * ================================
 * 拼贴册·聊天界面里，让 AI 写一段小小的 SVG 动画，贴在聊天输入栏上做装饰。
 * 产物是一段纯 SVG（自带 CSS/SMIL 动画），渲染时塞进 <img src="data:image/svg+xml,…">，
 * img 上下文里脚本不会执行，但 SVG 内的 CSS/SMIL 动画照常播放——既安全又有动效。
 */

import type { ResolvedApi } from './auxApi';
import { extractContent } from './safeApi';
import { makeApiUsageMeta } from './apiUsageCatalog';
import { callChatCompletion } from './llmClient';

const SYSTEM = [
    '你是一个擅长写「自带动画的内联 SVG」的设计助手。',
    '请根据用户描述，写一段小巧、精致、循环播放的装饰性 SVG，用来贴在手机聊天输入框上当动效。',
    '硬性要求：',
    '1. 只输出一个完整的 <svg>…</svg>，不要任何解释、不要 markdown 围栏。',
    '2. 必须带 viewBox（建议 0 0 240 64 这种扁横幅比例），不要写死 width/height 像素。',
    '3. 背景透明，不要画不透明的整块底板（会挡住输入框）。',
    '4. 动画用 SVG 内联 <style> 里的 CSS @keyframes，或 SMIL <animate>/<animateTransform>，要循环、轻柔。',
    '5. 绝对不要包含 <script>、事件属性（onload 等）、外链资源或 <foreignObject>。',
    '6. 体量小、线条干净，配色温柔，适合做点缀。',
].join('\n');

/** 从模型输出里抠出 <svg>…</svg> 并做安全清洗（去脚本 / 事件属性 / 外链）。 */
export function extractAndSanitizeSvg(raw: string): string | null {
    if (!raw) return null;
    const fenced = raw.match(/```(?:svg|xml|html)?\s*([\s\S]*?)```/i);
    const body = fenced ? fenced[1] : raw;
    const m = body.match(/<svg[\s\S]*?<\/svg>/i);
    if (!m) return null;
    let svg = m[0];
    // 去脚本与危险内容
    svg = svg
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
        .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
        .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
        .replace(/javascript:/gi, '');
    return svg.trim();
}

/** 让 AI 写一段输入动效 SVG。失败抛错，由调用方兜底。 */
export async function generateInputAnimationSvg(api: ResolvedApi, prompt: string): Promise<string> {
    if (!api.baseUrl || !api.model) throw new Error('请先在「文具盒」里配置 API');
    const data = await callChatCompletion(api, {
        model: api.model,
        messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: `想要的输入动效：${prompt || '一些轻轻飘动的小爱心和星星'}` },
        ],
        temperature: 0.9,
        max_tokens: 1500,
        stream: false,
    }, {
        meta: makeApiUsageMeta('chat.inputAnimation', {
            apiRole: api.apiRole || 'aux',
            apiBinding: api.apiBinding,
        }),
    });
    const svg = extractAndSanitizeSvg(extractContent(data) || '');
    if (!svg) throw new Error('没读到有效的 SVG，换个描述再试试');
    return svg;
}

/** 把存储的动效数据转成可直接放进 <img src> 的字符串。 */
export function inputAnimationSrc(anim: { kind: 'image' | 'svg'; data: string } | undefined): string {
    if (!anim?.data) return '';
    if (anim.kind === 'image') return anim.data; // 已是 data URL
    return `data:image/svg+xml,${encodeURIComponent(anim.data)}`;
}
