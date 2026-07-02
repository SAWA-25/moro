/**
 * 世界书导入解析器（支持 .json 与 .zip 压缩包）。
 *
 * 纯解析逻辑，不碰 DB / React，方便单测。把以下几种常见格式都归一成 Moro 的 Worldbook[]：
 *  1. Moro 自家导出：Worldbook[] 数组，或单个 Worldbook 对象
 *  2. SillyTavern 世界书/lorebook 导出：{ name?, entries: {…}|[…] }
 *     （entries 可为按 uid 键的对象，也可为数组；字段名兼容 key/keys、
 *      secondary_keys、insertion_order/order、case_sensitive、constant、disable 等）
 */

import { Worldbook, WorldbookPosition, WorldbookSTData } from '../types';
import { normalizeSelectiveLogic } from './worldbookRuntime';

let seq = 0;
const genId = (): string => `wb-imp-${Date.now().toString(36)}-${(seq++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const toStrArray = (v: any): string[] => {
    if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean);
    if (typeof v === 'string') return v.split(',').map(s => s.trim()).filter(Boolean);
    return [];
};

const numOrU = (v: any): number | undefined => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '') {
        const n = Number(v);
        if (Number.isFinite(n)) return n;
    }
    return undefined;
};

const boolOrU = (v: any): boolean | undefined => typeof v === 'boolean' ? v : undefined;

const objOrU = (v: any): Record<string, any> | undefined =>
    v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0 ? v : undefined;

/** 看起来像一个 Moro 世界书对象（已带 title + content）。 */
const looksLikeMoroBook = (o: any): boolean =>
    o && typeof o === 'object' && typeof o.title === 'string' && typeof o.content === 'string';

const positionFromST = (pos: any, role?: any): WorldbookPosition | undefined => {
    // ST position: 0=before_char, 1=after_char, 4=@Depth；作者注释/示例消息等降级到 after_char。
    if (pos === 0 || pos === 'before_char') return 'before_char';
    if (pos === 4) {
        if (role === 1) return 'depth_user';
        if (role === 2) return 'depth_assistant';
        return 'depth_system';
    }
    if (pos === 1 || pos === 'after_char') return 'after_char';
    if (typeof pos === 'number') return 'after_char';
    return undefined;
};

/** 把一个 ST lorebook 条目对象转成 Worldbook。无内容返回 null。 */
function entryToWorldbook(entry: any, category: string, idx: number, bookMeta: Omit<WorldbookSTData, 'entry'>): Worldbook | null {
    if (!entry || typeof entry !== 'object') return null;
    const content = typeof entry.content === 'string' ? entry.content : '';
    if (!content.trim()) return null;

    const ext = entry.extensions && typeof entry.extensions === 'object' ? entry.extensions : {};
    const keys = toStrArray(entry.keys ?? entry.key);
    const secondaryKeys = toStrArray(entry.secondary_keys ?? entry.secondaryKeys ?? entry.keysecondary);
    const constant = entry.constant === true;
    const disabled = entry.disable === true || entry.enabled === false;
    const order = Number.isFinite(entry.insertion_order) ? entry.insertion_order
        : Number.isFinite(entry.order) ? entry.order : 100;
    const title = String(entry.comment || entry.name || (keys.length ? keys.join(' / ') : `条目 ${idx + 1}`)).slice(0, 80);
    const probability = numOrU(ext.probability ?? entry.probability);
    const selectiveLogic = normalizeSelectiveLogic(ext.selectiveLogic ?? ext.selective_logic ?? entry.selectiveLogic ?? entry.selective_logic);
    const scanDepth = numOrU(ext.scan_depth ?? entry.scan_depth ?? bookMeta.scanDepth);
    const rawPos = ext.position ?? entry.position;
    const rawRole = ext.role ?? entry.role;
    const depth = numOrU(ext.depth ?? entry.depth);

    const now = Date.now();
    return {
        id: genId(),
        title,
        content,
        category,
        createdAt: now,
        updatedAt: now,
        enabled: !disabled,
        scope: 'local',
        position: positionFromST(rawPos, rawRole),
        depth,
        order,
        activation: (!constant && keys.length > 0) ? 'keyword' : 'always',
        keys: keys.length ? keys : undefined,
        secondaryKeys: secondaryKeys.length ? secondaryKeys : undefined,
        selective: entry.selective === true || undefined,
        selectiveLogic,
        caseSensitive: entry.case_sensitive === true || entry.caseSensitive === true || undefined,
        matchWholeWords: boolOrU(ext.match_whole_words ?? ext.matchWholeWords ?? entry.match_whole_words ?? entry.matchWholeWords),
        scanDepth,
        probability,
        useProbability: boolOrU(ext.useProbability ?? ext.use_probability ?? entry.useProbability ?? entry.use_probability)
            ?? (probability !== undefined ? true : undefined),
        ignoreBudget: boolOrU(ext.ignore_budget ?? ext.ignoreBudget ?? entry.ignore_budget ?? entry.ignoreBudget),
        source: 'sillytavern',
        stData: {
            ...bookMeta,
            entry: {
                id: entry.id ?? entry.uid,
                name: entry.name,
                comment: entry.comment,
                keys,
                secondaryKeys,
                selective: entry.selective === true,
                constant,
                enabled: !disabled,
                insertionOrder: order,
                caseSensitive: entry.case_sensitive === true || entry.caseSensitive === true || undefined,
                scanDepth,
                selectiveLogic,
                matchWholeWords: boolOrU(ext.match_whole_words ?? ext.matchWholeWords ?? entry.match_whole_words ?? entry.matchWholeWords),
                probability,
                useProbability: boolOrU(ext.useProbability ?? ext.use_probability ?? entry.useProbability ?? entry.use_probability)
                    ?? (probability !== undefined ? true : undefined),
                ignoreBudget: boolOrU(ext.ignore_budget ?? ext.ignoreBudget ?? entry.ignore_budget ?? entry.ignoreBudget),
                priority: numOrU(entry.priority),
                position: entry.position,
                extensions: objOrU(entry.extensions),
            },
        },
    };
}

/** 归一一份已解析的 JSON → Worldbook[]。fallbackName 用作分类名（通常是文件名）。 */
export function parseWorldbookJson(json: any, fallbackName: string): Worldbook[] {
    const now = Date.now();
    const cleanName = (fallbackName || '导入的世界书').replace(/\.(json|zip)$/i, '').trim() || '导入的世界书';

    // Moro 导出：数组
    if (Array.isArray(json)) {
        return json.filter(looksLikeMoroBook).map((o: any) => ({
            ...o,
            id: genId(),
            category: (o.category && String(o.category).trim()) || cleanName,
            createdAt: now,
            updatedAt: now,
        }));
    }

    // Moro 导出：单个对象
    if (looksLikeMoroBook(json)) {
        return [{
            ...json,
            id: genId(),
            category: (json.category && String(json.category).trim()) || cleanName,
            createdAt: now,
            updatedAt: now,
        }];
    }

    // SillyTavern 世界书：{ name?, entries }
    const entries = json?.entries;
    const category = (json?.name && String(json.name).trim()) || cleanName;
    const bookMeta: Omit<WorldbookSTData, 'entry'> = {
        bookName: json?.name,
        bookDescription: json?.description,
        scanDepth: numOrU(json?.scan_depth),
        tokenBudget: numOrU(json?.token_budget),
        recursiveScanning: boolOrU(json?.recursive_scanning),
        bookExtensions: objOrU(json?.extensions),
    };
    const list = Array.isArray(entries) ? entries : (entries && typeof entries === 'object' ? Object.values(entries) : []);
    const out: Worldbook[] = [];
    list.forEach((e, i) => {
        const wb = entryToWorldbook(e, category, i, bookMeta);
        if (wb) out.push(wb);
    });
    return out;
}

/** 解析一个 .json 文件文本 → Worldbook[]（解析失败抛错）。 */
export function parseWorldbookText(text: string, fileName: string): Worldbook[] {
    let json: any;
    try {
        json = JSON.parse(text);
    } catch {
        throw new Error(`「${fileName}」不是合法的 JSON`);
    }
    return parseWorldbookJson(json, fileName);
}

/**
 * 从一个文件（.json 或 .zip）导入世界书。zip 内所有 .json 都会被解析。
 * JSZip 动态 import，避免拖慢首屏。返回解析出的 Worldbook[]（已带新 id）。
 */
export async function importWorldbookFromFile(file: File): Promise<Worldbook[]> {
    const name = file.name || '';
    const isZip = /\.zip$/i.test(name) || file.type === 'application/zip' || file.type === 'application/x-zip-compressed';

    if (!isZip) {
        const text = await file.text();
        return parseWorldbookText(text, name);
    }

    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const jsonFiles = Object.values(zip.files).filter((f: any) => !f.dir && /\.json$/i.test(f.name));
    if (jsonFiles.length === 0) throw new Error('压缩包里没有找到 .json 世界书文件');

    const books: Worldbook[] = [];
    for (const f of jsonFiles as any[]) {
        const text = await f.async('string');
        try {
            books.push(...parseWorldbookText(text, f.name.split('/').pop() || f.name));
        } catch {
            // 跳过坏文件，继续解析其余条目
        }
    }
    if (books.length === 0) throw new Error('压缩包里的 .json 都无法解析为世界书');
    return books;
}
