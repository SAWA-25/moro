import type { GoDifficultyMode } from '../types';
import { sanitizeGoDifficultyMode } from './theaterGo';

export const GO_INVITE_EVENT = 'moro-go-invite';

const GO_INVITE_DIRECTIVE_RE = /\[\[GO_INVITE(?:[：:]\s*([\s\S]*?))?\]\]/gi;

const clean = (value: unknown, max = 120): string | undefined => {
    const text = String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
    return text || undefined;
};

function parseInvitePayload(raw: string | undefined): { message?: string; difficultyMode?: GoDifficultyMode } {
    const text = clean(raw, 180);
    if (!text) return {};
    let difficultyMode: GoDifficultyMode | undefined;
    if (/每步|per[_ -]?move|dynamic/i.test(text)) difficultyMode = 'per_move';
    else if (/开局|定档|opening|fixed/i.test(text)) difficultyMode = 'opening';

    const modeMatch = text.match(/(?:mode|模式)\s*[=：:]\s*([a-zA-Z_-]+|每步评估|开局定档)/i);
    if (modeMatch?.[1]) difficultyMode = sanitizeGoDifficultyMode(modeMatch[1], difficultyMode || 'opening');

    const message = clean(
        text
            .replace(/(?:mode|模式)\s*[=：:]\s*([a-zA-Z_-]+|每步评估|开局定档)/ig, '')
            .replace(/(?:每步评估|开局定档|per[_ -]?move|opening|fixed|dynamic)/ig, '')
            .replace(/^[,，;；\s]+|[,，;；\s]+$/g, ''),
        120,
    );
    return { message: message || text, difficultyMode };
}

/** 解析并剥离 [[GO_INVITE: 邀请文案]]，供聊天与主动消息路径共用。 */
export function extractGoInviteDirective(content: string): {
    content: string;
    invited?: boolean;
    message?: string;
    difficultyMode?: GoDifficultyMode;
} {
    if (!content || !/GO_INVITE/i.test(content)) return { content };
    GO_INVITE_DIRECTIVE_RE.lastIndex = 0;
    const first = GO_INVITE_DIRECTIVE_RE.exec(content);
    if (!first) return { content };
    const payload = parseInvitePayload(first[1]);
    const stripped = content.replace(GO_INVITE_DIRECTIVE_RE, '').trim();
    return {
        content: stripped,
        invited: true,
        ...payload,
    };
}
