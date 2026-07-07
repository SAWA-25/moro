import { CharacterExportData, CharacterProfile, ChatTheme, RegexScriptData, Worldbook, WorldbookPosition, WorldbookSelectiveLogic } from '../types';
import { DEFAULT_WB_CATEGORY, WorldbookGroupSettings } from './worldbookRuntime';

interface ExportOptions {
    customThemes?: ChatTheme[];
    worldbooks?: Worldbook[];
    worldbookGroupSettings?: Record<string, WorldbookGroupSettings>;
    now?: number;
}

export interface CharacterCardExportResult {
    exportData: CharacterExportData;
    worldbookCount: number;
    regexScriptCount: number;
}

type MountedSnapshot = NonNullable<CharacterProfile['mountedWorldbooks']>[number] & Partial<Worldbook>;
type CharacterCardPrivateField =
    | 'id'
    | 'modelId'
    | 'memories'
    | 'refinedMemories'
    | 'activeMemoryMonths'
    | 'guidebookInsights'
    | 'mountedWorldbooks'
    | 'convoSettings';

const categoryOf = (category?: string): string => (category && category.trim()) || DEFAULT_WB_CATEGORY;

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

export function stripCharacterCardPrivateFields<T extends Record<string, any>>(value: T): Omit<T, CharacterCardPrivateField> {
    const {
        id: _id,
        modelId: _modelId,
        memories: _memories,
        refinedMemories: _refinedMemories,
        activeMemoryMonths: _activeMemoryMonths,
        guidebookInsights: _guidebookInsights,
        mountedWorldbooks: _mountedWorldbooks,
        convoSettings: _convoSettings,
        ...cardFields
    } = value;
    return cardFields;
}

const compactUndefined = <T extends Record<string, any>>(obj: T): T => {
    Object.keys(obj).forEach(key => {
        if (obj[key] === undefined) delete obj[key];
    });
    return obj;
};

const firstNumber = (...values: any[]): number | undefined =>
    values.find(value => typeof value === 'number' && Number.isFinite(value));

const firstBoolean = (...values: any[]): boolean | undefined =>
    values.find(value => typeof value === 'boolean');

const logicToSTNumber = (logic?: WorldbookSelectiveLogic): number | undefined => {
    if (logic === 'not_all') return 1;
    if (logic === 'not_any') return 2;
    if (logic === 'and_all') return 3;
    if (logic === 'and_any') return 0;
    return undefined;
};

const normalizeExportWorldbook = (raw: MountedSnapshot, index: number, now: number): Worldbook => {
    const wb = raw as Worldbook;
    return {
        ...wb,
        id: wb.id || `wb-export-${now}-${index}`,
        title: wb.title || '未命名设定',
        content: wb.content || '',
        category: categoryOf(wb.category),
        createdAt: typeof wb.createdAt === 'number' ? wb.createdAt : now,
        updatedAt: typeof wb.updatedAt === 'number' ? wb.updatedAt : now,
    };
};

/**
 * 角色挂载语义是“绑定整本分组”。导出时先用 live 世界书替换旧快照，
 * 再把这些分组下后来新增的 live 条目一并带走。
 */
export function collectMountedWorldbooksForExport(
    char: CharacterProfile,
    allWorldbooks: Worldbook[] = [],
    now = Date.now(),
): Worldbook[] {
    const mounted = Array.isArray(char.mountedWorldbooks) ? char.mountedWorldbooks : [];
    if (mounted.length === 0) return [];

    const liveById = new Map(allWorldbooks.map(wb => [wb.id, wb]));
    const resolvedMounted = mounted.map((snapshot, index) =>
        normalizeExportWorldbook((liveById.get(snapshot.id) || snapshot) as MountedSnapshot, index, now),
    );
    const mountedCategories = new Set(resolvedMounted.map(wb => categoryOf(wb.category)));

    const byId = new Map<string, Worldbook>();
    const add = (wb: Worldbook) => {
        byId.set(wb.id, clone(normalizeExportWorldbook(wb as MountedSnapshot, byId.size, now)));
    };

    resolvedMounted.forEach(add);
    allWorldbooks
        .filter(wb => mountedCategories.has(categoryOf(wb.category)))
        .forEach(add);

    const categoryRank = new Map<string, number>();
    resolvedMounted.forEach((wb, index) => {
        const category = categoryOf(wb.category);
        if (!categoryRank.has(category)) categoryRank.set(category, index);
    });

    return [...byId.values()].sort((a, b) => {
        const rankA = categoryRank.get(categoryOf(a.category)) ?? Number.MAX_SAFE_INTEGER;
        const rankB = categoryRank.get(categoryOf(b.category)) ?? Number.MAX_SAFE_INTEGER;
        if (rankA !== rankB) return rankA - rankB;
        const orderA = typeof a.order === 'number' ? a.order : 100;
        const orderB = typeof b.order === 'number' ? b.order : 100;
        if (orderA !== orderB) return orderA - orderB;
        return a.title.localeCompare(b.title, 'zh-CN');
    });
}

const stPosition = (position?: WorldbookPosition): { cardPosition: 'before_char' | 'after_char'; extensionPosition: number; role: number } => {
    if (position === 'before_char') return { cardPosition: 'before_char', extensionPosition: 0, role: 0 };
    if (position === 'depth_user') return { cardPosition: 'after_char', extensionPosition: 4, role: 1 };
    if (position === 'depth_assistant') return { cardPosition: 'after_char', extensionPosition: 4, role: 2 };
    if (position === 'depth_system') return { cardPosition: 'after_char', extensionPosition: 4, role: 0 };
    return { cardPosition: 'after_char', extensionPosition: 1, role: 0 };
};

const toCharacterBookEntry = (wb: Worldbook, index: number): Record<string, any> => {
    const entryData = wb.stData?.entry || {};
    const { cardPosition, extensionPosition, role } = stPosition(wb.position);
    const constant = wb.activation
        ? wb.activation !== 'keyword'
        : (typeof entryData.constant === 'boolean' ? entryData.constant : true);
    const enabled = firstBoolean(wb.enabled, entryData.enabled) !== false;
    const selectiveLogic = logicToSTNumber(wb.selectiveLogic || entryData.selectiveLogic)
        ?? firstNumber(entryData.extensions?.selectiveLogic, entryData.extensions?.selective_logic)
        ?? 0;
    const extensions = compactUndefined({
        ...(entryData.extensions ? clone(entryData.extensions) : {}),
        position: extensionPosition,
        depth: wb.position?.startsWith('depth_')
            ? firstNumber(wb.depth, entryData.extensions?.depth, 4)
            : firstNumber(wb.depth, entryData.extensions?.depth),
        role,
        probability: firstNumber(wb.probability, entryData.probability, entryData.extensions?.probability) ?? null,
        useProbability: firstBoolean(wb.useProbability, entryData.useProbability, entryData.extensions?.useProbability) ?? false,
        selectiveLogic,
        scan_depth: firstNumber(wb.scanDepth, entryData.scanDepth, entryData.extensions?.scan_depth) ?? null,
        match_whole_words: firstBoolean(wb.matchWholeWords, entryData.matchWholeWords, entryData.extensions?.match_whole_words) ?? null,
        ignore_budget: firstBoolean(wb.ignoreBudget, entryData.ignoreBudget, entryData.extensions?.ignore_budget) ?? false,
        case_sensitive: firstBoolean(wb.caseSensitive, entryData.caseSensitive, entryData.extensions?.case_sensitive) ?? null,
        moro_id: wb.id,
        moro_category: categoryOf(wb.category),
    });

    return compactUndefined({
        id: typeof entryData.id === 'number' ? entryData.id : index,
        name: entryData.name || wb.title,
        keys: Array.isArray(wb.keys) ? wb.keys : (Array.isArray(entryData.keys) ? entryData.keys : []),
        secondary_keys: Array.isArray(wb.secondaryKeys) ? wb.secondaryKeys : (Array.isArray(entryData.secondaryKeys) ? entryData.secondaryKeys : []),
        comment: entryData.comment || wb.title,
        content: wb.content || '',
        constant,
        selective: firstBoolean(wb.selective, entryData.selective) ?? false,
        insertion_order: firstNumber(wb.order, entryData.insertionOrder) ?? 100,
        enabled,
        position: cardPosition,
        use_regex: true,
        case_sensitive: firstBoolean(wb.caseSensitive, entryData.caseSensitive),
        priority: firstNumber(entryData.priority),
        extensions,
    });
};

function buildCharacterBook(
    char: CharacterProfile,
    mountedWorldbooks: Worldbook[],
    groupSettings: Record<string, WorldbookGroupSettings> = {},
): Record<string, any> | undefined {
    if (mountedWorldbooks.length === 0) return undefined;

    const categories = [...new Set(mountedWorldbooks.map(wb => categoryOf(wb.category)))];
    const singleCategory = categories.length === 1 ? categories[0] : undefined;
    const firstBookData = mountedWorldbooks.find(wb => wb.stData)?.stData;
    const settings = singleCategory ? groupSettings[singleCategory] : undefined;
    const extensions = compactUndefined({
        ...(firstBookData?.bookExtensions ? clone(firstBookData.bookExtensions) : {}),
        max_recursion_steps: firstNumber(settings?.maxRecursionSteps, firstBookData?.bookExtensions?.max_recursion_steps, firstBookData?.bookExtensions?.maxRecursionSteps),
        moro_categories: categories,
    });

    return compactUndefined({
        name: singleCategory || `${char.name || '导出角色'}的世界书`,
        description: firstBookData?.bookDescription,
        scan_depth: firstNumber(firstBookData?.scanDepth),
        token_budget: firstNumber(settings?.tokenBudget, firstBookData?.tokenBudget),
        recursive_scanning: firstBoolean(settings?.recursiveScanning, firstBookData?.recursiveScanning),
        extensions,
        entries: mountedWorldbooks.map(toCharacterBookEntry),
    });
}

function buildSillyTavernV2Data(
    char: CharacterProfile,
    mountedWorldbooks: Worldbook[],
    regexScripts: RegexScriptData[],
    groupSettings: Record<string, WorldbookGroupSettings> = {},
): Record<string, any> {
    const extensions: Record<string, any> = {
        moro: {
            exported_from: 'Moro',
            exported_at: new Date().toISOString(),
        },
    };
    if (regexScripts.length > 0) extensions.regex_scripts = clone(regexScripts);

    const data = compactUndefined({
        name: char.name || '未命名角色',
        description: char.systemPrompt || '',
        personality: '',
        scenario: char.worldview || '',
        first_mes: char.firstMes || '',
        mes_example: char.mesExample || '',
        creator_notes: char.description || '',
        system_prompt: '',
        post_history_instructions: '',
        alternate_greetings: Array.isArray(char.alternateGreetings) ? [...char.alternateGreetings] : [],
        tags: [],
        creator: '',
        character_version: '',
        extensions,
        character_book: buildCharacterBook(char, mountedWorldbooks, groupSettings),
    });

    return data;
}

export function buildCharacterCardExportData(char: CharacterProfile, options: ExportOptions = {}): CharacterCardExportResult {
    const { regexScripts: rawRegexScripts, ...cardProps } = stripCharacterCardPrivateFields(char);
    const now = options.now ?? Date.now();
    const mountedWorldbooks = collectMountedWorldbooksForExport(char, options.worldbooks || [], now);
    const regexScripts = Array.isArray(rawRegexScripts) ? clone(rawRegexScripts) : [];

    const exportData: CharacterExportData = {
        ...cardProps,
        regexScripts: regexScripts.length > 0 ? regexScripts : undefined,
        mountedWorldbooks: mountedWorldbooks.length > 0 ? mountedWorldbooks : undefined,
        version: 1,
        type: 'moro_character_card',
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: buildSillyTavernV2Data(char, mountedWorldbooks, regexScripts, options.worldbookGroupSettings || {}),
    };

    if (char.bubbleStyle) {
        const customTheme = options.customThemes?.find(theme => theme.id === char.bubbleStyle);
        if (customTheme) exportData.embeddedTheme = customTheme;
    }

    return {
        exportData,
        worldbookCount: mountedWorldbooks.length,
        regexScriptCount: regexScripts.length,
    };
}
