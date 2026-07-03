import type {
    TheaterCustomImportBundle,
    TheaterCustomLibraryItem,
    TheaterCustomLibraryKind,
    TheaterCustomPiecePreset,
    TheaterCustomQuizPreset,
} from '../types';

export interface ParseTheaterCustomLibraryOptions {
    sourceName?: string;
    now?: number;
}

export interface ParsedTheaterCustomLibrary {
    items: TheaterCustomLibraryItem[];
    pieceCount: number;
    quizCount: number;
}

interface NormalizedParseOptions {
    sourceName?: string;
    now: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);

const cleanText = (value: unknown, max = 1000): string => {
    if (typeof value !== 'string' && typeof value !== 'number') return '';
    return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
};

const cleanLongText = (value: unknown, max = 20000): string => {
    if (typeof value !== 'string' && typeof value !== 'number') return '';
    return String(value).trim().slice(0, max);
};

const uniqueTexts = (values: unknown, maxItems: number, maxText = 40): string[] => {
    if (!Array.isArray(values)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    values.forEach(value => {
        const text = cleanText(value, maxText);
        const key = text.toLocaleLowerCase();
        if (!text || seen.has(key)) return;
        seen.add(key);
        out.push(text);
    });
    return out.slice(0, maxItems);
};

const normalizeTitleKey = (title: string): string =>
    title.trim().replace(/\s+/g, ' ').toLocaleLowerCase();

export function theaterCustomLibraryId(kind: TheaterCustomLibraryKind, title: string): string {
    return `${kind}:${normalizeTitleKey(title)}`;
}

const itemBase = (
    kind: TheaterCustomLibraryKind,
    title: string,
    raw: Record<string, unknown>,
    fallbackTags: string[],
    opts: NormalizedParseOptions,
) => ({
    id: theaterCustomLibraryId(kind, title),
    kind,
    title,
    description: cleanText(raw.description, 220) || undefined,
    tags: uniqueTexts(raw.tags, 8, 18).length ? uniqueTexts(raw.tags, 8, 18) : fallbackTags,
    sourceName: opts.sourceName,
    createdAt: opts.now,
    updatedAt: opts.now,
});

function parsePieces(bundle: TheaterCustomImportBundle, opts: NormalizedParseOptions): TheaterCustomPiecePreset[] {
    if (!Array.isArray(bundle.pieces)) return [];
    return bundle.pieces.flatMap(raw => {
        if (!isRecord(raw)) return [];
        const title = cleanText(raw.title, 80);
        const instruction = cleanLongText(raw.instruction, 20000);
        if (!title || !instruction) return [];
        return [{
            ...itemBase('piece', title, raw, ['小剧场'], opts),
            kind: 'piece' as const,
            instruction,
        }];
    });
}

function parseQuizzes(bundle: TheaterCustomImportBundle, opts: NormalizedParseOptions): TheaterCustomQuizPreset[] {
    if (!Array.isArray(bundle.quizzes)) return [];
    return bundle.quizzes.flatMap(raw => {
        if (!isRecord(raw)) return [];
        const title = cleanText(raw.title, 80);
        const questions = uniqueTexts(raw.questions, 200, 300);
        if (!title || !questions.length) return [];
        return [{
            ...itemBase('quiz', title, raw, ['问卷'], opts),
            kind: 'quiz' as const,
            questions,
            recommendedParticipants: cleanText(raw.recommendedParticipants, 40) || undefined,
        }];
    });
}

export function parseTheaterCustomLibraryJson(
    text: string,
    options: ParseTheaterCustomLibraryOptions = {},
): ParsedTheaterCustomLibrary {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error('导入文件不是有效 JSON。');
    }
    if (!isRecord(parsed)) throw new Error('导入文件需要是一个 JSON 对象。');

    const bundle = parsed as TheaterCustomImportBundle;
    const opts: NormalizedParseOptions = {
        sourceName: options.sourceName || undefined,
        now: options.now || Date.now(),
    };
    const itemsById = new Map<string, TheaterCustomLibraryItem>();
    [...parsePieces(bundle, opts), ...parseQuizzes(bundle, opts)].forEach(item => {
        const prev = itemsById.get(item.id);
        itemsById.set(item.id, prev ? { ...item, createdAt: prev.createdAt } : item);
    });
    const items = [...itemsById.values()];
    if (!items.length) throw new Error('没有找到可导入的小剧场或问卷。');
    return {
        items,
        pieceCount: items.filter(item => item.kind === 'piece').length,
        quizCount: items.filter(item => item.kind === 'quiz').length,
    };
}
