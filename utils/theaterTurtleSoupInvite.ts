import type { TurtleSoupDifficultyMode } from '../types';
import { sanitizeTurtleSoupDifficultyMode } from './theaterTurtleSoup';

export const TURTLE_SOUP_INVITE_EVENT = 'moro-turtle-soup-invite';

const TURTLE_SOUP_INVITE_DIRECTIVE_RE = /\[\[TURTLE_SOUP_INVITE(?:[：:]\s*([\s\S]*?))?\]\]/gi;

const clean = (value: unknown, max = 120): string | undefined => {
    const text = String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
    return text || undefined;
};

function parseInvitePayload(raw: string | undefined): { message?: string; difficultyMode?: TurtleSoupDifficultyMode } {
    const text = clean(raw, 180);
    if (!text) return {};
    let difficultyMode: TurtleSoupDifficultyMode | undefined;
    if (/每步|每轮|per[_ -]?move|dynamic/i.test(text)) difficultyMode = 'per_move';
    else if (/开局|定档|opening|fixed/i.test(text)) difficultyMode = 'opening';

    const modeMatch = text.match(/(?:mode|模式)\s*[=：:]\s*([a-zA-Z_-]+|每步评估|每轮评估|开局定档)/i);
    if (modeMatch?.[1]) difficultyMode = sanitizeTurtleSoupDifficultyMode(modeMatch[1], difficultyMode || 'opening');

    const message = clean(
        text
            .replace(/(?:mode|模式)\s*[=：:]\s*([a-zA-Z_-]+|每步评估|每轮评估|开局定档)/ig, '')
            .replace(/(?:每步评估|每轮评估|开局定档|per[_ -]?move|opening|fixed|dynamic)/ig, '')
            .replace(/^[,，；;、\s]+|[,，；;、\s]+$/g, ''),
        120,
    );
    return { message: message || text, difficultyMode };
}

/** 解析并剥离 [[TURTLE_SOUP_INVITE: 邀请文案]]，供聊天与主动消息路径共用。 */
export function extractTurtleSoupInviteDirective(content: string): {
    content: string;
    invited?: boolean;
    message?: string;
    difficultyMode?: TurtleSoupDifficultyMode;
} {
    if (!content || !/TURTLE_SOUP_INVITE/i.test(content)) return { content };
    TURTLE_SOUP_INVITE_DIRECTIVE_RE.lastIndex = 0;
    const first = TURTLE_SOUP_INVITE_DIRECTIVE_RE.exec(content);
    if (!first) return { content };
    const payload = parseInvitePayload(first[1]);
    const stripped = content.replace(TURTLE_SOUP_INVITE_DIRECTIVE_RE, '').trim();
    return {
        content: stripped,
        invited: true,
        ...payload,
    };
}
