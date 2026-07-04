import { describe, expect, it } from 'vitest';
import { CharacterProfile, Worldbook } from '../types';
import { regex_placement, substitute_find_regex } from './regex/engine';
import { buildCharacterCardExportData, collectMountedWorldbooksForExport } from './characterCardExport';

const baseChar = (overrides: Partial<CharacterProfile> = {}): CharacterProfile => ({
    id: 'char-local',
    modelId: 'stable-anchor',
    name: '小满',
    avatar: 'avatar.png',
    description: '列表备注',
    systemPrompt: '小满是一位旅行画家。',
    worldview: '蒸汽朋克世界。',
    firstMes: '你好，{{user}}。',
    alternateGreetings: ['又见面了。'],
    mesExample: '<START>\nUser: 画什么？\n小满: 云。',
    memories: [{ id: 'm1', date: '2026-01-01', summary: '不该进单卡', mood: 'calm' }],
    refinedMemories: { '2026-01': '也不该进单卡' },
    activeMemoryMonths: ['2026-01'],
    guidebookInsights: ['攻略本洞察不进单卡'],
    ...overrides,
});

const wb = (overrides: Partial<Worldbook>): Worldbook => ({
    id: 'wb',
    title: '设定',
    content: '内容',
    category: '小满的世界',
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
});

describe('collectMountedWorldbooksForExport', () => {
    it('按整本分组导出 live 条目，并用 live 内容覆盖旧挂载快照', () => {
        const char = baseChar({
            mountedWorldbooks: [
                { id: 'wb-live-1', title: '旧标题', content: '旧内容', category: '小满的世界', enabled: true },
            ],
        });
        const books = [
            wb({ id: 'wb-live-1', title: '核心世界观', content: 'live 内容', order: 20 }),
            wb({ id: 'wb-live-2', title: '后来新增', content: '同分组新增内容', order: 10 }),
            wb({ id: 'wb-other', title: '其他分组', content: '不该导出', category: '别的世界' }),
        ];

        const exported = collectMountedWorldbooksForExport(char, books, 1000);

        expect(exported.map(book => book.id)).toEqual(['wb-live-2', 'wb-live-1']);
        expect(exported.find(book => book.id === 'wb-live-1')?.content).toBe('live 内容');
        expect(exported.some(book => book.id === 'wb-other')).toBe(false);
    });

    it('live 记录不存在时保留挂载快照作为兜底', () => {
        const char = baseChar({
            mountedWorldbooks: [
                { id: 'wb-missing', title: '快照条目', content: '快照内容', category: '旧书', enabled: false },
            ],
        });

        const exported = collectMountedWorldbooksForExport(char, [], 2000);

        expect(exported).toHaveLength(1);
        expect(exported[0]).toMatchObject({
            id: 'wb-missing',
            title: '快照条目',
            content: '快照内容',
            category: '旧书',
            enabled: false,
            createdAt: 2000,
            updatedAt: 2000,
        });
    });
});

describe('buildCharacterCardExportData', () => {
    it('生成 Moro 单卡 + SillyTavern character_book / scoped regex 兼容字段', () => {
        const char = baseChar({
            mountedWorldbooks: [{ id: 'wb-depth', title: '深度线索', content: '旧', category: '小满的世界' }],
            regexScripts: [
                {
                    id: 'rx1',
                    scriptName: '隐藏状态栏',
                    findRegex: '/<status>[\\s\\S]*?<\\/status>/g',
                    replaceString: '',
                    trimStrings: [],
                    placement: [regex_placement.AI_OUTPUT],
                    disabled: false,
                    markdownOnly: true,
                    promptOnly: false,
                    runOnEdit: false,
                    substituteRegex: substitute_find_regex.NONE,
                    minDepth: null,
                    maxDepth: null,
                },
            ],
        });
        const books = [
            wb({
                id: 'wb-depth',
                title: '深度线索',
                content: '应该按 live 内容导出',
                category: '小满的世界',
                enabled: false,
                activation: 'keyword',
                keys: ['飞艇'],
                secondaryKeys: ['旅行'],
                selective: true,
                selectiveLogic: 'and_all',
                position: 'depth_user',
                depth: 3,
                order: 5,
                probability: 80,
                useProbability: true,
                scanDepth: 6,
                matchWholeWords: true,
                ignoreBudget: true,
                stData: {
                    bookName: '小满的世界',
                    tokenBudget: 512,
                    recursiveScanning: true,
                    bookExtensions: { st_custom: 1 },
                    entry: {
                        id: 7,
                        comment: '原注释',
                        insertionOrder: 30,
                        extensions: { display_index: 9 },
                    },
                },
            }),
        ];

        const { exportData, worldbookCount, regexScriptCount } = buildCharacterCardExportData(char, {
            worldbooks: books,
            worldbookGroupSettings: {
                '小满的世界': { tokenBudget: 256, recursiveScanning: false, maxRecursionSteps: 4 },
            },
            now: 1234,
        });

        expect(worldbookCount).toBe(1);
        expect(regexScriptCount).toBe(1);
        expect(exportData.type).toBe('moro_character_card');
        expect(exportData.spec).toBe('chara_card_v2');
        expect(exportData.mountedWorldbooks?.[0]).toMatchObject({
            id: 'wb-depth',
            content: '应该按 live 内容导出',
            activation: 'keyword',
            position: 'depth_user',
        });
        expect(exportData.regexScripts?.[0].id).toBe('rx1');

        expect(exportData).not.toHaveProperty('id');
        expect(exportData).not.toHaveProperty('modelId');
        expect(JSON.stringify(exportData)).not.toContain('char-local');
        expect(JSON.stringify(exportData)).not.toContain('stable-anchor');
        expect(exportData).not.toHaveProperty('memories');
        expect(exportData).not.toHaveProperty('refinedMemories');
        expect(exportData).not.toHaveProperty('activeMemoryMonths');
        expect(exportData).not.toHaveProperty('guidebookInsights');

        const stData = exportData.data!;
        expect(stData.name).toBe('小满');
        expect(stData.description).toBe('小满是一位旅行画家。');
        expect(stData.scenario).toBe('蒸汽朋克世界。');
        expect(stData.extensions.regex_scripts).toHaveLength(1);
        expect(stData.character_book).toMatchObject({
            name: '小满的世界',
            token_budget: 256,
            recursive_scanning: false,
            extensions: {
                st_custom: 1,
                max_recursion_steps: 4,
                moro_categories: ['小满的世界'],
            },
        });
        expect(stData.character_book.entries).toHaveLength(1);
        expect(stData.character_book.entries[0]).toMatchObject({
            id: 7,
            keys: ['飞艇'],
            secondary_keys: ['旅行'],
            comment: '原注释',
            content: '应该按 live 内容导出',
            constant: false,
            selective: true,
            insertion_order: 5,
            enabled: false,
            position: 'after_char',
            extensions: {
                display_index: 9,
                position: 4,
                depth: 3,
                role: 1,
                probability: 80,
                useProbability: true,
                selectiveLogic: 3,
                scan_depth: 6,
                match_whole_words: true,
                ignore_budget: true,
                moro_id: 'wb-depth',
                moro_category: '小满的世界',
            },
        });
    });

    it('绑定多本世界书时合并进一份 ST character_book，并在 Moro 快照里保留原分组', () => {
        const char = baseChar({
            mountedWorldbooks: [
                { id: 'a', title: 'A', content: 'A', category: '甲书' },
                { id: 'b', title: 'B', content: 'B', category: '乙书' },
            ],
        });
        const { exportData } = buildCharacterCardExportData(char, {
            worldbooks: [
                wb({ id: 'a', title: 'A', content: 'A', category: '甲书' }),
                wb({ id: 'b', title: 'B', content: 'B', category: '乙书' }),
            ],
            now: 1,
        });

        expect(exportData.mountedWorldbooks?.map(book => book.category)).toEqual(['甲书', '乙书']);
        expect(exportData.data?.character_book.name).toBe('小满的世界书');
        expect(exportData.data?.character_book.extensions.moro_categories).toEqual(['甲书', '乙书']);
    });
});
