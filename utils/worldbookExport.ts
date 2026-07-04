import { Worldbook, WorldbookPosition, WorldbookSelectiveLogic, WorldbookSTData } from '../types';
import { DEFAULT_WB_CATEGORY, type WorldbookGroupScope, type WorldbookGroupSettings } from './worldbookRuntime';

export interface BuildWorldbookExportOptions {
    category: string;
    books: Worldbook[];
    groupEnabled?: boolean;
    groupScope?: WorldbookGroupScope;
    groupSettings?: WorldbookGroupSettings;
    exportedAt?: number;
}

export interface SillyTavernWorldbookExport {
    name: string;
    description: string;
    entries: Record<string, Record<string, any>>;
    scan_depth?: number;
    token_budget?: number;
    recursive_scanning?: boolean;
    extensions: Record<string, any>;
}

const logicToSTNumber = (logic?: WorldbookSelectiveLogic): number | undefined => {
    if (logic === 'not_all') return 1;
    if (logic === 'not_any') return 2;
    if (logic === 'and_all') return 3;
    if (logic === 'and_any') return 0;
    return undefined;
};

const stPositionFor = (position?: WorldbookPosition): { position: number; role?: number } => {
    if (position === 'before_char') return { position: 0 };
    if (position === 'depth_user') return { position: 4, role: 1 };
    if (position === 'depth_assistant') return { position: 4, role: 2 };
    if (position === 'depth_system') return { position: 4, role: 0 };
    return { position: 1 };
};

const cleanCategory = (category: string) =>
    (category || DEFAULT_WB_CATEGORY).trim() || DEFAULT_WB_CATEGORY;

const numberOrUndefined = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const firstStBookData = (books: Worldbook[]): Omit<WorldbookSTData, 'entry'> => {
    for (const book of books) {
        if (!book.stData) continue;
        return {
            bookName: book.stData.bookName,
            bookDescription: book.stData.bookDescription,
            scanDepth: book.stData.scanDepth,
            tokenBudget: book.stData.tokenBudget,
            recursiveScanning: book.stData.recursiveScanning,
            bookExtensions: book.stData.bookExtensions,
        };
    }
    return {};
};

const addDefined = (target: Record<string, any>, key: string, value: unknown) => {
    if (value !== undefined) target[key] = value;
};

const exportEntryFor = (book: Worldbook, index: number, category: string): Record<string, any> => {
    const stEntry = book.stData?.entry;
    const activation = book.activation
        ?? (stEntry?.constant === false && (stEntry.keys?.length || 0) > 0 ? 'keyword' : 'always');
    const keys = book.keys ?? stEntry?.keys ?? [];
    const secondaryKeys = book.secondaryKeys ?? stEntry?.secondaryKeys ?? [];
    const order = numberOrUndefined(book.order) ?? stEntry?.insertionOrder ?? 100;
    const scanDepth = numberOrUndefined(book.scanDepth) ?? stEntry?.scanDepth;
    const probability = numberOrUndefined(book.probability) ?? stEntry?.probability;
    const useProbability = book.useProbability ?? stEntry?.useProbability;
    const selectiveLogic = book.selectiveLogic ?? stEntry?.selectiveLogic;
    const depth = numberOrUndefined(book.depth) ?? numberOrUndefined(stEntry?.extensions?.depth);
    const currentPosition = book.position || 'after_char';
    const stPosition = stPositionFor(currentPosition);

    const extensions: Record<string, any> = {
        moro: {
            id: book.id,
            category: cleanCategory(book.category || category),
            activation,
            position: currentPosition,
            createdAt: book.createdAt,
            updatedAt: book.updatedAt,
            source: book.source,
        },
    };
    addDefined(extensions, 'depth', stPosition.position === 4 ? depth : undefined);
    addDefined(extensions, 'scan_depth', scanDepth);
    addDefined(extensions, 'match_whole_words', book.matchWholeWords ?? stEntry?.matchWholeWords);
    addDefined(extensions, 'probability', probability);
    addDefined(extensions, 'useProbability', useProbability);
    addDefined(extensions, 'use_probability', useProbability);
    addDefined(extensions, 'ignore_budget', book.ignoreBudget ?? stEntry?.ignoreBudget);
    addDefined(extensions, 'selectiveLogic', selectiveLogic);

    const entry: Record<string, any> = {
        uid: stEntry?.id ?? index,
        key: keys,
        keys,
        keysecondary: secondaryKeys,
        secondary_keys: secondaryKeys,
        comment: book.title || stEntry?.comment || stEntry?.name || `条目 ${index + 1}`,
        content: book.content || '',
        constant: activation !== 'keyword',
        enabled: book.enabled !== false,
        disable: book.enabled === false,
        insertion_order: order,
        order,
        selective: !!(book.selective ?? stEntry?.selective),
        case_sensitive: !!(book.caseSensitive ?? stEntry?.caseSensitive),
        position: stPosition.position,
        extensions,
    };
    addDefined(entry, 'role', stPosition.role);
    addDefined(entry, 'depth', stPosition.position === 4 ? depth : undefined);
    addDefined(entry, 'scan_depth', scanDepth);
    addDefined(entry, 'selectiveLogic', logicToSTNumber(selectiveLogic));
    addDefined(entry, 'probability', probability);
    addDefined(entry, 'useProbability', useProbability);
    addDefined(entry, 'ignore_budget', book.ignoreBudget ?? stEntry?.ignoreBudget);
    addDefined(entry, 'match_whole_words', book.matchWholeWords ?? stEntry?.matchWholeWords);
    return entry;
};

export const buildWorldbookExport = (options: BuildWorldbookExportOptions): SillyTavernWorldbookExport => {
    const category = cleanCategory(options.category);
    const fallback = firstStBookData(options.books);
    const settings = options.groupSettings || {};
    const tokenBudget = numberOrUndefined(settings.tokenBudget) ?? numberOrUndefined(fallback.tokenBudget);
    const maxRecursionSteps = numberOrUndefined(settings.maxRecursionSteps)
        ?? numberOrUndefined(fallback.bookExtensions?.max_recursion_steps)
        ?? numberOrUndefined(fallback.bookExtensions?.maxRecursionSteps);
    const scanDepth = numberOrUndefined(fallback.scanDepth);
    const recursiveScanning = typeof settings.recursiveScanning === 'boolean'
        ? settings.recursiveScanning
        : fallback.recursiveScanning;

    const extensions: Record<string, any> = {
        moro: {
            format: 'moro-worldbook',
            version: 1,
            exportedAt: options.exportedAt || Date.now(),
            groupEnabled: options.groupEnabled !== false,
            groupScope: options.groupScope || 'local',
            entryCount: options.books.length,
        },
    };
    addDefined(extensions, 'max_recursion_steps', maxRecursionSteps);

    const entries: Record<string, Record<string, any>> = {};
    options.books.forEach((book, index) => {
        entries[String(index)] = exportEntryFor(book, index, category);
    });

    const out: SillyTavernWorldbookExport = {
        name: category,
        description: fallback.bookDescription || `Moro 剪报夹导出：${category}`,
        entries,
        extensions,
    };
    addDefined(out, 'scan_depth', scanDepth);
    if (tokenBudget && tokenBudget > 0) out.token_budget = tokenBudget;
    addDefined(out, 'recursive_scanning', recursiveScanning);
    return out;
};

export const stringifyWorldbookExport = (options: BuildWorldbookExportOptions): string =>
    JSON.stringify(buildWorldbookExport(options), null, 2);

export const sanitizeWorldbookFileNamePart = (value: string): string => {
    const clean = cleanCategory(value)
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80);
    return clean || 'worldbook';
};

export const worldbookExportFileName = (category: string): string =>
    `moro-worldbook-${sanitizeWorldbookFileNamePart(category)}.json`;
