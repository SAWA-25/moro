/**
 * 世界书导入解析器（支持 .json 与 .zip 压缩包）。
 *
 * 纯解析逻辑，不碰 DB / React，方便单测。把以下几种常见格式都归一成 Moro 的 Worldbook[]：
 *  1. Moro 自家导出：Worldbook[] 数组，或单个 Worldbook 对象
 *  2. SillyTavern 世界书/lorebook 导出：{ name?, entries: {…}|[…] }
 *     （entries 可为按 uid 键的对象，也可为数组；字段名兼容 key/keys、
 *      secondary_keys、insertion_order/order、case_sensitive、constant、disable 等）
 */

import { Worldbook, WorldbookPosition } from '../types';

let seq = 0;
const genId = (): string => `wb-imp-${Date.now().toString(36)}-${(seq++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const toStrArray = (v: any): string[] => {
    if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean);
    if (typeof v === 'string') return v.split(',').map(s => s.trim()).filter(Boolean);
    return [];
};

/** 看起来像一个 Moro 世界书对象（已带 title + content）。 */
const looksLikeMoroBook = (o: any): boolean =>
    o && typeof o === 'object' && typeof o.title === 'string' && typeof o.content === 'string';

const positionFromST = (pos: any): WorldbookPosition | undefined => {
    // ST position: 0=before_char, 1=after_char, 2/3/4=@depth 系。这里只做温和映射，缺省交给运行时。
    if (pos === 0) return 'before_char';
    if (pos === 1) return 'after_char';
    return undefined;
};

/** 把一个 ST lorebook 条目对象转成 Worldbook。无内容返回 null。 */
function entryToWorldbook(entry: any, category: string, idx: number): Worldbook | null {
    if (!entry || typeof entry !== 'object') return null;
    const content = typeof entry.content === 'string' ? entry.content : '';
    if (!content.trim()) return null;

    const keys = toStrArray(entry.keys ?? entry.key);
    const secondaryKeys = toStrArray(entry.secondary_keys ?? entry.secondaryKeys ?? entry.keysecondary);
    const constant = entry.constant === true;
    const disabled = entry.disable === true || entry.enabled === false;
    const order = Number.isFinite(entry.insertion_order) ? entry.insertion_order
        : Number.isFinite(entry.order) ? entry.order : 100;
    const title = String(entry.comment || entry.name || (keys.length ? keys.join(' / ') : `条目 ${idx + 1}`)).slice(0, 80);

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
        position: positionFromST(entry.position),
        order,
        activation: (!constant && keys.length > 0) ? 'keyword' : 'always',
        keys: keys.length ? keys : undefined,
        secondaryKeys: secondaryKeys.length ? secondaryKeys : undefined,
        selective: entry.selective === true || undefined,
        caseSensitive: entry.case_sensitive === true || entry.caseSensitive === true || undefined,
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
    const list = Array.isArray(entries) ? entries : (entries && typeof entries === 'object' ? Object.values(entries) : []);
    const out: Worldbook[] = [];
    list.forEach((e, i) => {
        const wb = entryToWorldbook(e, category, i);
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
