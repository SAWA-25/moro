/**
 * SillyTavern 角色卡导入：解析 PNG（tEXt 元数据）/ JSON 两种载体，
 * 兼容 Character Card V1（平铺）/ V2（chara_card_v2）/ V3（chara_card_v3）规范，
 * 并把内嵌世界书（character_book）连同条目内容、名称、局部/全局设置完整转换
 * 成 Moro 的 Worldbook 记录（原始设置保留在 stData 字段）。
 *
 * 纯函数、零依赖（手写 PNG chunk 解析），可在 node 测试环境直接跑。
 */

import { CharacterProfile, RegexScriptData, Worldbook, WorldbookPosition, WorldbookSTData } from '../types';
import { normalizeRegexScript } from './regex/engine';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface ParsedSTCard {
    spec: 'v1' | 'v2' | 'v3';
    /** V2/V3 的 data 字段；V1 时为卡片本体（平铺字段） */
    data: Record<string, any>;
}

interface STBookEntryNorm {
    id?: number | string;
    name?: string;
    comment?: string;
    keys: string[];
    secondaryKeys: string[];
    content: string;
    constant: boolean;
    selective: boolean;
    enabled: boolean;
    insertionOrder: number;
    caseSensitive?: boolean;
    priority?: number;
    position?: string | number;
    extensions?: Record<string, any>;
    /** 映射到 Moro 的插入位置 / 深度（原始值仍保留在 position / extensions） */
    moroPosition: WorldbookPosition;
    moroDepth: number;
}

interface STBookNorm {
    name?: string;
    description?: string;
    scanDepth?: number;
    tokenBudget?: number;
    recursiveScanning?: boolean;
    extensions?: Record<string, any>;
    entries: STBookEntryNorm[];
}

export interface STImportResult {
    name: string;
    /** Moro 的「描述/用户备注」：作者、版本、标签等一行摘要 */
    description: string;
    systemPrompt: string;
    worldview?: string;
    /**
     * 开场白（first_mes）与备选开场白（alternate_greetings）。
     * 不再拼进 systemPrompt —— 作为独立字段挂到角色上，进入空聊天时
     * 由用户选择其中一条作为第一条消息（同 ST 的开场白 swipe）。
     * 保留原始宏（{{user}} 等），插入聊天时才按当时的用户名替换。
     */
    firstMes?: string;
    alternateGreetings: string[];
    /**
     * 对话示例（mes_example）。不再拼进 systemPrompt —— 独立字段挂到角色上，
     * 由消息组装按 ST 语义注入（预设的 dialogueExamples 占位 / 核心上下文示例块）。
     * 宏与其他设定字段一致：导入时烘焙一次。
     */
    mesExample?: string;
    /** JSON 卡没有图片时的兜底头像（svg data URL） */
    avatarFallback: string;
    /** 需要写入全局世界书库的全部条目（含 ST 里禁用的条目和创作者备注） */
    worldbooks: Worldbook[];
    /**
     * 需要挂载到角色身上的条目（有内容的全部条目，按插入顺序排序）。
     * ST 里禁用的条目也在内（enabled=false 由注入时的条目开关拦截），
     * 用户后续在世界书 App 打开开关即可生效。
     */
    mountedWorldbooks: NonNullable<CharacterProfile['mountedWorldbooks']>;
    /**
     * 卡内自带的正则脚本（data.extensions.regex_scripts）。原样规范化导入，
     * 作为角色局部脚本挂到 char.regexScripts（正则 App「角色」标签可管理）。
     */
    regexScripts: RegexScriptData[];
}

// ---------------------------------------------------------------------------
// PNG tEXt 解析
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const latin1 = (bytes: Uint8Array): string => {
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
    return out;
};

/** 遍历 PNG chunk，取出全部 tEXt 块（keyword + 文本）。不校验 CRC。 */
export function extractPngTextChunks(buffer: ArrayBuffer): { keyword: string; text: string }[] {
    const bytes = new Uint8Array(buffer);
    if (bytes.length < 8 || PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) {
        throw new Error('不是有效的 PNG 文件');
    }
    const view = new DataView(buffer);
    const chunks: { keyword: string; text: string }[] = [];
    let offset = 8;
    while (offset + 8 <= bytes.length) {
        const length = view.getUint32(offset);
        const type = latin1(bytes.subarray(offset + 4, offset + 8));
        const dataStart = offset + 8;
        if (dataStart + length > bytes.length) break;
        if (type === 'tEXt') {
            const data = bytes.subarray(dataStart, dataStart + length);
            const sep = data.indexOf(0);
            if (sep > 0) {
                chunks.push({
                    keyword: latin1(data.subarray(0, sep)),
                    text: latin1(data.subarray(sep + 1)),
                });
            }
        }
        if (type === 'IEND') break;
        offset = dataStart + length + 4; // 跳过 CRC
    }
    return chunks;
}

const decodeBase64Utf8 = (b64: string): string => {
    const bin = atob(b64.trim());
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
};

/**
 * 从 PNG 中取出角色卡 JSON。
 * SillyTavern 把卡片写在 tEXt 块：keyword 'chara'（V2）/ 'ccv3'（V3），
 * 值为 base64(UTF-8 JSON)。与 ST 一致：ccv3 优先。
 */
export function extractCardJsonFromPng(buffer: ArrayBuffer): any {
    const chunks = extractPngTextChunks(buffer);
    const ccv3 = chunks.find(c => c.keyword.toLowerCase() === 'ccv3');
    const chara = chunks.find(c => c.keyword.toLowerCase() === 'chara');
    const target = ccv3 || chara;
    if (!target) {
        throw new Error('这张 PNG 不含角色卡数据（缺少 chara / ccv3 元数据块）');
    }
    try {
        return JSON.parse(decodeBase64Utf8(target.text));
    } catch {
        throw new Error('PNG 内的角色卡元数据损坏，无法解析');
    }
}

// ---------------------------------------------------------------------------
// 卡片识别 / 规范化
// ---------------------------------------------------------------------------

const V1_HINT_FIELDS = ['description', 'personality', 'scenario', 'first_mes', 'mes_example'];

/** 识别 SillyTavern 角色卡（V1/V2/V3）。不是则返回 null（如 Moro 卡）。 */
export function parseSillyTavernCard(json: any): ParsedSTCard | null {
    if (!json || typeof json !== 'object') return null;
    if (json.type === 'moro_character_card') return null;
    if (json.spec === 'chara_card_v3' && json.data && typeof json.data === 'object') {
        return { spec: 'v3', data: json.data };
    }
    if (json.spec === 'chara_card_v2' && json.data && typeof json.data === 'object') {
        return { spec: 'v2', data: json.data };
    }
    // 没有 spec 的老卡：data 包裹或 V1 平铺
    const flat = json.data && typeof json.data === 'object' ? json.data : json;
    if (
        typeof flat.name === 'string' && flat.name.trim() &&
        V1_HINT_FIELDS.some(k => typeof flat[k] === 'string')
    ) {
        return { spec: 'v1', data: flat };
    }
    return null;
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

const strOrU = (v: any): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
const numOrU = (v: any): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const boolOrU = (v: any): boolean | undefined => (typeof v === 'boolean' ? v : undefined);
const objOrU = (v: any): Record<string, any> | undefined =>
    v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0 ? v : undefined;

const toStrArray = (v: any): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];

/** {{char}} / {{user}} / <BOT> / <USER> 宏替换（导入时一次性烘焙，Moro 没有运行时宏系统） */
export const applyCardMacros = (text: string, charName: string, userName: string): string =>
    text
        .replace(/\{\{char\}\}/gi, charName)
        .replace(/\{\{user\}\}/gi, userName)
        .replace(/<BOT>/gi, charName)
        .replace(/<USER>/gi, userName);

/** 与 OSContext.generateAvatar 同款的字母头像兜底（那边是模块私有函数，无法复用） */
const makeFallbackAvatar = (seed: string): string => {
    const colors = ['FF9AA2', 'FFB7B2', 'FFDAC1', 'E2F0CB', 'B5EAD7', 'C7CEEA', 'e2e8f0', 'fcd34d', 'fca5a5'];
    const color = colors[(seed.charCodeAt(0) || 0) % colors.length];
    const letter = (seed.charAt(0) || '?').toUpperCase();
    return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23${color}"/><text x="50" y="55" font-family="sans-serif" font-weight="bold" font-size="50" text-anchor="middle" dy=".3em" fill="white" opacity="0.9">${letter}</text></svg>`;
};

// ---------------------------------------------------------------------------
// 世界书规范化
// ---------------------------------------------------------------------------

/**
 * ST 位置 → Moro 位置映射。
 * ST 数值位（world_info_position）：0=角色前 1=角色后 2/3=作者注释 4=@Depth 5/6=示例消息 7=outlet；
 * @Depth 的 role：0=system 1=user 2=assistant。规范卡的真实位置在 extensions.position
 * （字符串 position 只有 before_char/after_char 两档），ST 原生 WI 格式则直接在条目顶层。
 * Moro 没有作者注释 / 示例消息锚点，2/3/5/6/7 一律降级为角色定义后。
 */
function resolveMoroPosition(rawPos: any, rawRole: any): WorldbookPosition {
    if (typeof rawPos === 'number') {
        if (rawPos === 0) return 'before_char';
        if (rawPos === 4) {
            if (rawRole === 1) return 'depth_user';
            if (rawRole === 2) return 'depth_assistant';
            return 'depth_system';
        }
        return 'after_char';
    }
    if (rawPos === 'before_char') return 'before_char';
    return 'after_char';
}

/**
 * 兼容两种条目载体：
 * - 规范 V2/V3：entries 为数组，字段 keys / secondary_keys / insertion_order / enabled…
 * - ST 内部 World Info 形态：entries 为 { uid: entry } 映射，字段 key / keysecondary / order / disable…
 *   （部分第三方卡会把这种格式直接塞进 character_book）
 */
function normalizeCharacterBook(book: any): STBookNorm | null {
    if (!book || typeof book !== 'object') return null;
    const raw = book.entries;
    let list: any[] = [];
    if (Array.isArray(raw)) list = raw;
    else if (raw && typeof raw === 'object') list = Object.values(raw);
    list = list.filter(e => e && typeof e === 'object');
    if (list.length === 0) return null;

    const entries: STBookEntryNorm[] = list.map(e => {
        // 规范卡：真实位置/角色/深度在 extensions；ST 原生 WI 格式：直接在条目顶层
        const rawPos = e.extensions?.position ?? e.position;
        const rawRole = e.extensions?.role ?? e.role;
        const rawDepth = numOrU(e.extensions?.depth ?? e.depth);
        return {
            id: e.id ?? e.uid,
            name: strOrU(e.name),
            comment: strOrU(e.comment),
            keys: toStrArray(e.keys ?? e.key),
            secondaryKeys: toStrArray(e.secondary_keys ?? e.keysecondary),
            content: typeof e.content === 'string' ? e.content : '',
            constant: !!e.constant,
            selective: !!e.selective,
            enabled: e.enabled !== undefined ? !!e.enabled : !e.disable,
            insertionOrder: numOrU(e.insertion_order ?? e.order) ?? 100,
            caseSensitive: boolOrU(e.case_sensitive ?? e.caseSensitive),
            priority: numOrU(e.priority),
            position: typeof e.position === 'string' || typeof e.position === 'number' ? e.position : undefined,
            extensions: objOrU(e.extensions),
            moroPosition: resolveMoroPosition(rawPos, rawRole),
            moroDepth: rawDepth ?? 4,
        };
    });

    return {
        name: strOrU(book.name),
        description: strOrU(book.description),
        scanDepth: numOrU(book.scan_depth),
        tokenBudget: numOrU(book.token_budget),
        recursiveScanning: boolOrU(book.recursive_scanning),
        extensions: objOrU(book.extensions),
        entries,
    };
}

// ---------------------------------------------------------------------------
// 转换主入口
// ---------------------------------------------------------------------------

/**
 * 把规范化后的 ST 卡转换为 Moro 角色字段 + 世界书记录。
 * 字段映射：
 * - description + personality + system_prompt 等 → systemPrompt（分节拼接）
 * - first_mes / alternate_greetings → firstMes / alternateGreetings（独立字段，
 *   进入空聊天时由用户选择一条作为第一条消息，不污染 systemPrompt）
 * - mes_example → mesExample（独立字段，按 ST 语义注入 dialogueExamples 占位 / 示例块）
 * - scenario → worldview
 * - creator / character_version / tags → description（列表页一行摘要）
 * - creator_notes 及卡片元信息 → 一条 enabled=false 的世界书（保留信息但不进 prompt）
 * - character_book → 全部条目导入世界书库（默认局部作用域），有内容的条目按
 *   insertion_order 挂载到角色；开关 / 位置(@Depth 含 role) / 顺序按原卡映射
 */
export function convertSTCardToCharacter(
    parsed: ParsedSTCard,
    opts: { userName?: string } = {},
): STImportResult {
    const d = parsed.data;
    const name = (strOrU(d.name) || strOrU(d.nickname) || '未命名角色').trim();
    // V3：nickname 存在时 {{char}} 按 nickname 解析
    const macroChar = (strOrU(d.nickname) || name).trim();
    const userName = opts.userName?.trim() || 'User';
    const m = (text: any): string =>
        typeof text === 'string' ? applyCardMacros(text, macroChar, userName).trim() : '';

    // ---- systemPrompt 分节拼接（空段自动跳过，不丢任何设定） ----
    const sections: string[] = [];
    const stSystemPrompt = m(d.system_prompt);
    if (stSystemPrompt) sections.push(stSystemPrompt);
    const desc = m(d.description);
    if (desc) sections.push(`【角色设定】\n${desc}`);
    const personality = m(d.personality);
    if (personality) sections.push(`【性格特征】\n${personality}`);
    // 对话示例不进 systemPrompt：它是说话风格的「示例」而非角色设定，混进核心指令会
    // 和角色描述黏在一起、模型容易把示例当成真实发生过的对话。独立字段由消息组装注入。
    const mesExample = m(d.mes_example);
    // 开场白不进 systemPrompt：它是对话的第一条消息而非角色设定，拼进核心指令会
    // 让模型把开场白当常驻指令复读。保留原始宏，进入聊天选择时再替换。
    const firstMes = typeof d.first_mes === 'string' ? d.first_mes.trim() : '';
    const alternateGreetings = toStrArray(d.alternate_greetings).map(g => g.trim()).filter(Boolean);
    const postHistory = m(d.post_history_instructions);
    if (postHistory) sections.push(`【附加指令（原 post-history instructions）】\n${postHistory}`);

    const worldview = m(d.scenario) || undefined;

    // ---- 列表页摘要 ----
    const metaBits: string[] = [];
    if (strOrU(d.creator)) metaBits.push(`by ${d.creator.trim()}`);
    if (strOrU(d.character_version)) metaBits.push(`v${String(d.character_version).trim()}`);
    const tags = toStrArray(d.tags);
    if (tags.length > 0) metaBits.push(tags.slice(0, 6).join(' / '));
    const description = metaBits.length > 0
        ? `SillyTavern 卡 · ${metaBits.join(' · ')}`
        : 'SillyTavern 角色卡导入';

    // ---- 世界书 ----
    const worldbooks: Worldbook[] = [];
    const mountedWorldbooks: STImportResult['mountedWorldbooks'] = [];
    const now = Date.now();
    const newWbId = (idx: number) => `wb-st-${now}-${idx}-${Math.random().toString(36).slice(2, 6)}`;

    const book = normalizeCharacterBook(d.character_book);
    const category = book?.name?.trim() || `${name} 的世界书`;

    if (book) {
        const bookMeta: Omit<WorldbookSTData, 'entry'> = {
            bookName: book.name,
            bookDescription: book.description,
            scanDepth: book.scanDepth,
            tokenBudget: book.tokenBudget,
            recursiveScanning: book.recursiveScanning,
            bookExtensions: book.extensions,
        };

        const mountable: { wb: Worldbook; order: number }[] = [];
        book.entries.forEach((entry, idx) => {
            const title = m(entry.comment || entry.name || '')
                || (entry.keys.length > 0 ? entry.keys.join(' / ') : `条目 ${idx + 1}`);
            const content = m(entry.content);
            const wb: Worldbook = {
                id: newWbId(idx),
                title,
                content,
                category,
                createdAt: now,
                updatedAt: now,
                // 工作字段：导入的角色书默认「局部」，可在世界书 App 手动切全局；
                // 开关 / 位置 / 深度 / 顺序按原卡映射（原始值另存 stData 备查）
                enabled: entry.enabled,
                scope: 'local',
                position: entry.moroPosition,
                depth: entry.moroPosition.startsWith('depth_') ? entry.moroDepth : undefined,
                order: entry.insertionOrder,
                // 关键词激活（ST 绿灯条目）现已在 Moro 运行时执行：constant=蓝灯 → 常驻；
                // 有关键词且非 constant → keyword（仅在最近消息命中时注入）。
                activation: (!entry.constant && entry.keys.length > 0) ? 'keyword' : 'always',
                keys: entry.keys.length > 0 ? entry.keys : undefined,
                secondaryKeys: entry.secondaryKeys.length > 0 ? entry.secondaryKeys : undefined,
                selective: entry.selective || undefined,
                caseSensitive: entry.caseSensitive,
                scanDepth: book.scanDepth,
                source: 'sillytavern',
                stData: {
                    ...bookMeta,
                    entry: {
                        id: entry.id,
                        name: entry.name,
                        comment: entry.comment,
                        keys: entry.keys,
                        secondaryKeys: entry.secondaryKeys,
                        selective: entry.selective,
                        constant: entry.constant,
                        enabled: entry.enabled,
                        insertionOrder: entry.insertionOrder,
                        caseSensitive: entry.caseSensitive,
                        priority: entry.priority,
                        position: entry.position,
                        extensions: entry.extensions,
                    },
                },
            };
            worldbooks.push(wb);
            // 有内容的条目全部挂载；关键词条目（activation='keyword'）挂载后由
            // WorldbookRuntime 在发消息时按最近消息扫描决定是否注入（同 ST 绿灯）。
            // ST 里禁用的条目也挂载，但 enabled=false —— 注入时被条目开关拦下，
            // 用户在世界书 App 里打开开关即可生效，无需重新挂载。
            if (content) {
                mountable.push({ wb, order: entry.insertionOrder });
            }
        });

        mountable
            .sort((a, b) => a.order - b.order)
            .forEach(({ wb }) => mountedWorldbooks.push({
                id: wb.id,
                title: wb.title,
                content: wb.content,
                category: wb.category,
            }));
    }

    // ---- 卡片元信息 / 创作者备注：入库但不挂载，不污染 prompt ----
    const infoLines: string[] = [];
    if (strOrU(d.creator)) infoLines.push(`作者: ${d.creator.trim()}`);
    if (strOrU(d.character_version)) infoLines.push(`版本: ${String(d.character_version).trim()}`);
    if (tags.length > 0) infoLines.push(`标签: ${tags.join(', ')}`);
    // V3 规范里 source 是字符串数组，老卡里偶见字符串
    const sourceList = Array.isArray(d.source) ? toStrArray(d.source) : (strOrU(d.source) ? [d.source.trim()] : []);
    if (sourceList.length > 0) infoLines.push(`来源: ${sourceList.join(', ')}`);
    if (strOrU(d.creation_date)) infoLines.push(`创建时间: ${d.creation_date}`);
    const creatorNotes = typeof d.creator_notes === 'string' ? d.creator_notes.trim() : '';
    if (creatorNotes) infoLines.push(`\n--- 创作者备注 ---\n${creatorNotes}`);
    if (objOrU(d.creator_notes_multilingual)) {
        Object.entries(d.creator_notes_multilingual as Record<string, any>).forEach(([lang, note]) => {
            if (typeof note === 'string' && note.trim()) {
                infoLines.push(`\n--- 创作者备注 (${lang}) ---\n${note.trim()}`);
            }
        });
    }
    if (infoLines.length > 0) {
        worldbooks.push({
            id: newWbId(worldbooks.length + 1000),
            title: `【卡片信息】${name}`,
            content: infoLines.join('\n'),
            category,
            createdAt: now,
            updatedAt: now,
            // 创作者备注是给用户看的，默认关闭——即使整本书被挂载也不会进 prompt
            enabled: false,
            scope: 'local',
            source: 'sillytavern',
        });
    }

    // ---- 卡内自带正则脚本（extensions.regex_scripts，ST scoped regex）----
    const rawRegexScripts = d.extensions?.regex_scripts;
    const regexScripts: RegexScriptData[] = Array.isArray(rawRegexScripts)
        ? rawRegexScripts.map(normalizeRegexScript).filter((s): s is RegexScriptData => !!s)
        : [];

    return {
        name,
        description,
        systemPrompt: sections.join('\n\n'),
        worldview,
        firstMes: firstMes || undefined,
        alternateGreetings,
        mesExample: mesExample || undefined,
        avatarFallback: makeFallbackAvatar(name),
        worldbooks,
        mountedWorldbooks,
        regexScripts,
    };
}
