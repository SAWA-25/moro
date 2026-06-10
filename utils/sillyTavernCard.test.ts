import { describe, it, expect } from 'vitest';
import {
    extractPngTextChunks,
    extractCardJsonFromPng,
    parseSillyTavernCard,
    convertSTCardToCharacter,
    applyCardMacros,
} from './sillyTavernCard';

// ---------------------------------------------------------------------------
// 测试用 PNG 构造（解析器不校验 CRC，所以 CRC 填 0 即可）
// ---------------------------------------------------------------------------

const makeChunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length);
    new DataView(out.buffer).setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    return out;
};

const makeTextChunk = (keyword: string, json: any): Uint8Array => {
    const b64 = Buffer.from(JSON.stringify(json), 'utf8').toString('base64');
    const payload = new Uint8Array(keyword.length + 1 + b64.length);
    for (let i = 0; i < keyword.length; i++) payload[i] = keyword.charCodeAt(i);
    payload[keyword.length] = 0;
    for (let i = 0; i < b64.length; i++) payload[keyword.length + 1 + i] = b64.charCodeAt(i);
    return makeChunk('tEXt', payload);
};

const makePng = (texts: { keyword: string; json: any }[]): ArrayBuffer => {
    const parts = [
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        makeChunk('IHDR', new Uint8Array(13)),
        ...texts.map(t => makeTextChunk(t.keyword, t.json)),
        makeChunk('IEND', new Uint8Array(0)),
    ];
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out.buffer;
};

// ---------------------------------------------------------------------------
// 样例卡
// ---------------------------------------------------------------------------

const v2Card = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
        name: '小满',
        description: '{{char}}是一位旅行画家，常给{{user}}写信。',
        personality: '温柔、好奇',
        scenario: '架空的蒸汽朋克世界',
        first_mes: '你好呀，{{user}}！',
        mes_example: '<START>\n{{user}}: 在画什么？\n{{char}}: 在画云。',
        system_prompt: '永远保持温柔的语气。',
        post_history_instructions: '回复保持简短。',
        alternate_greetings: ['好久不见，{{user}}。'],
        creator: 'tester',
        character_version: '1.2',
        tags: ['原创', '画家'],
        creator_notes: '建议搭配低温度使用。',
        character_book: {
            name: '小满的世界',
            description: '蒸汽朋克设定集',
            scan_depth: 4,
            token_budget: 512,
            recursive_scanning: true,
            extensions: { st_custom: 1 },
            entries: [
                {
                    id: 7,
                    keys: ['飞艇', 'airship'],
                    secondary_keys: ['旅行'],
                    comment: '飞艇设定',
                    content: '{{char}}的飞艇名叫「云雀号」。',
                    constant: false,
                    selective: true,
                    enabled: true,
                    insertion_order: 5,
                    case_sensitive: false,
                    priority: 10,
                    position: 'after_char',
                    extensions: { probability: 80, depth: 4 },
                },
                {
                    keys: [],
                    comment: '核心世界观',
                    content: '这个世界以蒸汽与黄铜驱动。',
                    constant: true,
                    selective: false,
                    enabled: true,
                    insertion_order: 1,
                    position: 'before_char',
                },
                {
                    keys: ['秘密'],
                    comment: '禁用条目',
                    content: '只有原卡作者知道的秘密。',
                    enabled: false,
                    insertion_order: 2,
                },
            ],
        },
    },
};

describe('PNG tEXt 解析', () => {
    it('能从 chara 块解析出卡片 JSON（含中文 UTF-8）', () => {
        const buf = makePng([{ keyword: 'chara', json: v2Card }]);
        const json = extractCardJsonFromPng(buf);
        expect(json.spec).toBe('chara_card_v2');
        expect(json.data.name).toBe('小满');
    });

    it('ccv3 优先于 chara', () => {
        const v3 = { ...v2Card, spec: 'chara_card_v3', data: { ...v2Card.data, name: 'V3小满' } };
        const buf = makePng([
            { keyword: 'chara', json: v2Card },
            { keyword: 'ccv3', json: v3 },
        ]);
        expect(extractCardJsonFromPng(buf).data.name).toBe('V3小满');
    });

    it('非 PNG / 无元数据时报错', () => {
        expect(() => extractPngTextChunks(new Uint8Array([1, 2, 3]).buffer)).toThrow('不是有效的 PNG');
        expect(() => extractCardJsonFromPng(makePng([]))).toThrow('缺少 chara / ccv3');
    });
});

describe('卡片识别', () => {
    it('识别 V2 / V3 / V1 平铺卡', () => {
        expect(parseSillyTavernCard(v2Card)?.spec).toBe('v2');
        expect(parseSillyTavernCard({ ...v2Card, spec: 'chara_card_v3' })?.spec).toBe('v3');
        expect(parseSillyTavernCard({ name: '老卡', description: 'x', first_mes: 'hi' })?.spec).toBe('v1');
    });

    it('Sully 卡与无关 JSON 返回 null', () => {
        expect(parseSillyTavernCard({ type: 'sully_character_card', name: 'a', description: 'b' })).toBeNull();
        expect(parseSillyTavernCard({ foo: 1 })).toBeNull();
        expect(parseSillyTavernCard(null)).toBeNull();
    });
});

describe('convertSTCardToCharacter', () => {
    const result = convertSTCardToCharacter(parseSillyTavernCard(v2Card)!, { userName: '阿月' });

    it('基础字段映射 + 宏替换', () => {
        expect(result.name).toBe('小满');
        expect(result.worldview).toBe('架空的蒸汽朋克世界');
        expect(result.systemPrompt).toContain('永远保持温柔的语气');
        expect(result.systemPrompt).toContain('小满是一位旅行画家，常给阿月写信');
        expect(result.systemPrompt).toContain('【性格特征】\n温柔、好奇');
        expect(result.systemPrompt).toContain('【对话示例】');
        expect(result.systemPrompt).toContain('你好呀，阿月！');
        expect(result.systemPrompt).toContain('【备选开场白 1】\n好久不见，阿月。');
        expect(result.systemPrompt).toContain('回复保持简短');
        expect(result.systemPrompt).not.toContain('{{char}}');
        expect(result.systemPrompt).not.toContain('{{user}}');
        expect(result.description).toContain('by tester');
        expect(result.description).toContain('v1.2');
        expect(result.avatarFallback.startsWith('data:image/svg+xml')).toBe(true);
    });

    it('世界书条目全部入库：3 个条目 + 1 条卡片信息', () => {
        expect(result.worldbooks).toHaveLength(4);
        const titles = result.worldbooks.map(w => w.title);
        expect(titles).toContain('飞艇设定');
        expect(titles).toContain('核心世界观');
        expect(titles).toContain('禁用条目');
        expect(titles).toContain('【卡片信息】小满');
        // 分类用书名
        expect(result.worldbooks[0].category).toBe('小满的世界');
    });

    it('局部 + 全局设置完整保留在 stData', () => {
        const airship = result.worldbooks.find(w => w.title === '飞艇设定')!;
        expect(airship.source).toBe('sillytavern');
        expect(airship.stData?.entry).toMatchObject({
            id: 7,
            keys: ['飞艇', 'airship'],
            secondaryKeys: ['旅行'],
            selective: true,
            constant: false,
            enabled: true,
            insertionOrder: 5,
            caseSensitive: false,
            priority: 10,
            position: 'after_char',
            extensions: { probability: 80, depth: 4 },
        });
        expect(airship.stData).toMatchObject({
            bookName: '小满的世界',
            bookDescription: '蒸汽朋克设定集',
            scanDepth: 4,
            tokenBudget: 512,
            recursiveScanning: true,
            bookExtensions: { st_custom: 1 },
        });
        expect(airship.content).toBe('小满的飞艇名叫「云雀号」。');
    });

    it('仅启用条目按 insertion_order 挂载，禁用条目与卡片信息不挂载', () => {
        expect(result.mountedWorldbooks).toHaveLength(2);
        expect(result.mountedWorldbooks[0].title).toBe('核心世界观'); // order 1
        expect(result.mountedWorldbooks[1].title).toBe('飞艇设定');   // order 5
    });

    it('卡片信息条目包含创作者备注', () => {
        const info = result.worldbooks.find(w => w.title === '【卡片信息】小满')!;
        expect(info.content).toContain('作者: tester');
        expect(info.content).toContain('标签: 原创, 画家');
        expect(info.content).toContain('建议搭配低温度使用');
    });
});

describe('兼容 ST World Info 对象映射格式的 character_book', () => {
    it('key/keysecondary/order/disable 字段正确映射', () => {
        const card = {
            spec: 'chara_card_v2',
            data: {
                name: 'WI角色',
                description: '测试',
                character_book: {
                    entries: {
                        '0': {
                            uid: 0,
                            key: ['城堡'],
                            keysecondary: ['北方'],
                            comment: '城堡',
                            content: '北方有座城堡。',
                            constant: false,
                            selective: true,
                            order: 10,
                            disable: false,
                            position: 0,
                        },
                        '1': {
                            uid: 1,
                            key: ['废弃'],
                            comment: '已禁用',
                            content: '废弃设定。',
                            order: 20,
                            disable: true,
                        },
                    },
                },
            },
        };
        const res = convertSTCardToCharacter(parseSillyTavernCard(card)!, {});
        const castle = res.worldbooks.find(w => w.title === '城堡')!;
        expect(castle.stData?.entry).toMatchObject({
            id: 0,
            keys: ['城堡'],
            secondaryKeys: ['北方'],
            enabled: true,
            insertionOrder: 10,
            position: 0,
        });
        const disabled = res.worldbooks.find(w => w.title === '已禁用')!;
        expect(disabled.stData?.entry?.enabled).toBe(false);
        expect(res.mountedWorldbooks.map(w => w.title)).toEqual(['城堡']);
    });
});

describe('applyCardMacros', () => {
    it('大小写不敏感，支持 <BOT>/<USER>', () => {
        expect(applyCardMacros('{{Char}}和{{USER}}，<bot>与<User>', '甲', '乙')).toBe('甲和乙，甲与乙');
    });
});
