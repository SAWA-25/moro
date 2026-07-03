import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, afterEach, vi } from 'vitest';
import { API_USAGE_CATALOG, getApiUsageFeature, hydrateApiUsageMeta, isApiUsageFeatureId, makeApiUsageMeta } from './apiUsageCatalog';
import { llmComplete } from './llmComplete';
import type { ResolvedApi } from './auxApi';

const ROOT = process.cwd();
const SCAN_DIRS = ['apps', 'components', 'utils', 'hooks', 'context', 'worker'];
const ALLOWED_RAW_ENDPOINT_FILES = new Set([
    'utils/openAiCompat.ts',
    'utils/openAiCompat.test.ts',
    'utils/llmClient.test.ts',
    'utils/apiCallLog.ts',
    'utils/apiCallLog.test.ts',
    'utils/safeApi.ts',
    'utils/streamChat.ts',
    'utils/groupOfflineMode.test.ts',
    'worker/instant-push/src/index.ts',
    'worker/instant-push/worker.bundle.js',
]);

const NON_OPENAI_ENDPOINT_FILES = new Set([
    'utils/aceStepApi.ts',
]);

const CORE_ANNOTATED_FILES: Record<string, string[]> = {
    'apps/Settings.tsx': [
        'settings.mainApi.testConnection',
        'settings.mainApi.fetchModels',
        'settings.auxApi.testConnection',
        'settings.auxApi.fetchModels',
    ],
    'components/moments/momentsGen.ts': [
        'chat.moments.refresh',
        'chat.moments.autoPost',
        'chat.moments.reactions',
        'chat.moments.commentReplies',
    ],
    'utils/coupleSpace.ts': [
        'chat.coupleSpace.moment',
        'chat.coupleSpace.comment',
        'chat.coupleSpace.whisper',
        'chat.coupleSpace.interaction',
        'chat.coupleSpace.innerVoice',
        'chat.coupleSpace.question',
        'chat.coupleSpace.compat',
        'chat.coupleSpace.autoCare',
        'chat.coupleSpace.recap',
    ],
    'hooks/useChatAI.ts': [
        'chat.privateReply',
        'chat.postProcess.emotionEval',
    ],
    'context/OSContext.tsx': ['chat.proactiveReply'],
    'utils/applyAssistantPostProcessing.ts': [
        'chat.postProcess.diary',
        'chat.postProcess.xhs',
        'chat.postProcess.scrap',
        'chat.postProcess.search',
        'chat.postProcess.note',
    ],
    'utils/scheduleGenerator.ts': [
        'almanac.scheduleGenerate',
        'almanac.scheduleReconcile',
        'almanac.flowNarrative',
    ],
    'utils/dateEngine.ts': [
        'date.worldEngine',
        'date.summary',
    ],
    'apps/CallApp.tsx': ['chat.phoneTextReply'],
    'apps/Chat.tsx': [
        'chat.privateReply',
        'chat.parallelReply',
        'chat.translation',
        'chat.phoneTextReply',
        'chat.lockScreen',
        'chat.coupleSpace.innerVoice',
        'chat.postProcess.summary',
    ],
    'apps/ChatHub.tsx': [
        'chat.groupReply',
        'chat.postProcess.summary',
    ],
    'apps/LifeSimApp.tsx': ['date.scene'],
    'apps/lifesim/RoamView.tsx': [
        'date.reply',
        'date.worldEngine',
    ],
    'utils/recenter.ts': ['chat.recenter'],
    'utils/takeout.ts': ['takeout.generate'],
    'utils/vrWorld/runSession.ts': ['vrWorld.session'],
    'utils/vrWorld/theater.ts': ['vrWorld.theater'],
    'apps/pixelHome/memoryDiveEngine.ts': [
        'pixelHome.memoryDive.explore',
        'pixelHome.memoryDive.script',
        'pixelHome.memoryDive.buff',
    ],
    'utils/pixelHomeDecoration.ts': ['room.decoration'],
    'utils/lifeProfile.ts': ['character.lifeProfile'],
    'utils/appearanceTags.ts': ['character.appearanceTags'],
    'components/settings/LlmApiConfigFields.tsx': ['chat.emotionApi.fetchModels'],
    'utils/theaterTimeline.ts': [
        'theater.timeline',
        'theater.reflection',
    ],
};

function walk(dir: string): string[] {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) return [];
    return fs.readdirSync(abs, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(abs, entry.name);
        if (entry.isDirectory()) return walk(path.relative(ROOT, full));
        return /\.(ts|tsx|js|mjs)$/.test(entry.name) ? [path.relative(ROOT, full).replace(/\\/g, '/')] : [];
    });
}

function res(body: any) {
    return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(body),
    } as unknown as Response;
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('API 后台流水登记表', () => {
    it('featureId 能解析出唯一 App / 功能 / 入口路径', () => {
        const ids = API_USAGE_CATALOG.map(item => item.featureId);
        expect(new Set(ids).size).toBe(ids.length);

        const settings = getApiUsageFeature('settings.mainApi.testConnection');
        expect(settings?.appName).toBe('文具盒');
        expect(settings?.featureName).toBe('主 API');
        expect(settings?.entryPath.join(' → ')).toBe('文具盒 → 模型与服务 → 主 API → 测试连接');

        const moments = getApiUsageFeature('chat.moments.refresh');
        expect(moments?.appName).toBe('絮语');
        expect(moments?.featureName).toBe('此刻');
        expect(moments?.entryPath.join(' → ')).toContain('底栏：此刻');
    });

    it('apiRole 只保留 main / aux / custom，额外来源进入 apiBinding', () => {
        const meta = makeApiUsageMeta('chat.groupReply', { apiRole: 'member' });
        expect(meta.apiRole).toBe('main');
        expect(meta.apiBinding).toBe('member');

        const hydrated = hydrateApiUsageMeta({
            featureId: 'chat.groupReply',
            apiRole: 'group',
        });
        expect(hydrated.apiRole).toBe('main');
        expect(hydrated.apiBinding).toBe('group');
    });

    it('旧记录缺 featureId 时保持兼容但不伪装成新登记项', () => {
        const legacy = hydrateApiUsageMeta({ appName: '消息', purpose: '聊天回复', apiRole: 'main' });
        expect(legacy.featureId).toBeUndefined();
        expect(legacy.appName).toBe('消息');
        expect(legacy.purpose).toBe('聊天回复');
        expect(legacy.apiRole).toBe('main');
    });
});

describe('llmComplete API 流水 meta', () => {
    it('把 featureId 挂到 fetch options.__moroMeta 上', async () => {
        const api: ResolvedApi = { baseUrl: 'https://api.example.test/v1', apiKey: 'sk-test', model: 'm' };
        const fetchFn = vi.fn(async () => res({
            choices: [{ message: { content: '好了。' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
        }));
        global.fetch = fetchFn as unknown as typeof fetch;

        await llmComplete(api, [{ role: 'user', content: 'hi' }], {
            meta: makeApiUsageMeta('chat.coupleSpace.moment'),
        });

        const init = (fetchFn.mock.calls as any[])[0]?.[1] as RequestInit & { __moroMeta?: any };
        expect(init.__moroMeta?.featureId).toBe('chat.coupleSpace.moment');
        expect(init.__moroMeta?.appName).toBe('絮语');
        expect(init.__moroMeta?.featureName).toBeUndefined();
    });
});

describe('LLM 调用静态扫描', () => {
    it('核心改造路径必须显式登记 featureId', () => {
        for (const [file, featureIds] of Object.entries(CORE_ANNOTATED_FILES)) {
            const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
            for (const featureId of featureIds) {
                expect(text, `${file} 缺少 ${featureId}`).toContain(featureId);
            }
        }
    });

    it('实时私聊不再触发已停用的串门流水', () => {
        const text = fs.readFileSync(path.join(ROOT, 'apps/Chat.tsx'), 'utf8');
        expect(text).not.toContain('chat.livePrivateInterject');
    });

    it('实时群聊不执行 PRIVATE 私聊侧写入', () => {
        const text = fs.readFileSync(path.join(ROOT, 'apps/ChatHub.tsx'), 'utf8');
        expect(text).toContain('privateContent && !liveMode');
        expect(text).toContain('实时模式禁用');
    });

    it('OpenAI-compatible 原始端点字符串只留在中心 helper、测试和 worker 协议代码', () => {
        const offenders: string[] = [];
        for (const file of SCAN_DIRS.flatMap(walk)) {
            if (ALLOWED_RAW_ENDPOINT_FILES.has(file)) continue;
            if (NON_OPENAI_ENDPOINT_FILES.has(file)) continue;
            const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
            if (!/(\/chat\/completions|\/models)/.test(text)) continue;
            offenders.push(file);
        }
        expect(offenders).toEqual([]);
    });

    it('写死的 LLM featureId 都必须登记在 API_USAGE_CATALOG', () => {
        const offenders: string[] = [];
        const patterns = [
            /makeApiUsageMeta\(\s*['"`]([^'"`]+)['"`]/g,
            /featureId\s*:\s*['"`]([^'"`]+)['"`]/g,
        ];
        for (const file of SCAN_DIRS.flatMap(walk)) {
            if (file === 'utils/apiUsageCatalog.ts') continue;
            const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
            for (const pattern of patterns) {
                pattern.lastIndex = 0;
                let match: RegExpExecArray | null;
                while ((match = pattern.exec(text))) {
                    const featureId = match[1];
                    if (!isApiUsageFeatureId(featureId)) offenders.push(`${file}: ${featureId}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });
});
