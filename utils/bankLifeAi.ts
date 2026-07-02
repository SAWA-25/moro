import type { ResolvedApi } from './auxApi';
import { JOB_CATEGORIES, JOB_POSTINGS, LOAN_PRODUCTS } from './bankLife';
import { callChatCompletion } from './llmClient';
import { makeApiUsageMeta } from './apiUsageCatalog';
import type {
    BankJobApplication,
    BankJobApplicationStage,
    BankJobPayCycle,
    BankJobPosting,
    BankLifeAiEvent,
    BankLifeState,
    BankLoanChannel,
    BankMarketPulse,
} from '../types';

export function parseAiJsonObject(raw: string): any {
    const trimmed = String(raw || '').trim();
    const unfenced = trimmed
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```$/i, '')
        .trim();
    return JSON.parse(unfenced);
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const clampText = (v: unknown, fallback: string, max = 240) => {
    const s = String(v || fallback).trim() || fallback;
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};
const asList = (v: unknown, max: number) => Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean).slice(0, max) : [];
const toneSet = new Set(['good', 'warn', 'bad', 'info']);
const pulseSentiments = new Set(['bullish', 'neutral', 'bearish']);
const payCycles = new Set<BankJobPayCycle>(['daily', 'monthly']);
const riskWords = ['押金', '培训费', '无薪', '拖欠', '高风险', '保证金', '先交'];

export function sanitizeAiEvent(input: any, dateStr: string): BankLifeAiEvent {
    const tone = toneSet.has(input?.tone) ? input.tone : 'info';
    const category = ['daily', 'career', 'market', 'company', 'loan', 'shop'].includes(input?.category) ? input.category : 'daily';
    return {
        id: `ai-life-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        dateStr,
        title: clampText(input?.title, '今日事件', 40),
        detail: clampText(input?.detail, '生活继续往前推进。', 240),
        tone,
        source: 'ai',
        category,
    };
}

export async function callBankLifeAiJson(api: ResolvedApi, messages: { role: 'system' | 'user'; content: string }[], fallback: any): Promise<any> {
    if (!api?.baseUrl || !api?.model) return fallback;
    try {
        const json = await callChatCompletion(api, {
            model: api.model,
            messages,
            temperature: 0.85,
            stream: false,
        }, {
            meta: makeApiUsageMeta('bank.lifeAi', {
                apiRole: api.apiRole || 'aux',
                apiBinding: api.apiBinding,
                isBackgroundTask: true,
            }),
        });
        const content = json?.choices?.[0]?.message?.content || '';
        return parseAiJsonObject(content);
    } catch (error) {
        console.warn('[BankLifeAI] fallback', error);
        return fallback;
    }
}

export async function generateAiLifeDay(api: ResolvedApi, life: BankLifeState): Promise<BankLifeAiEvent[]> {
    const fallback = [{ title: '平稳的一天', detail: '今天没有特别大的波澜，但你更清楚下一步要做什么。', tone: 'info', category: 'daily' }];
    const data = await callBankLifeAiJson(api, [
        { role: 'system', content: '你是人生拟模拟器事件导演。只输出 JSON：{"events":[{"title":"","detail":"","tone":"good|warn|bad|info","category":"daily|career|market|company|loan|shop"}]}。所有内容都是虚拟模拟。' },
        { role: 'user', content: JSON.stringify({ dateStr: life.dateStr, dayIndex: life.dayIndex, job: life.currentJob?.title, fatigue: life.fatigue, energy: life.energy, company: life.company?.name, loans: life.loans.length, holdings: Object.keys(life.holdings) }) },
    ], { events: fallback });
    return (Array.isArray(data?.events) ? data.events : fallback).slice(0, 3).map((e: any) => sanitizeAiEvent(e, life.dateStr));
}

export function sanitizeResumeReview(input: any) {
    return {
        score: clamp(Math.round(Number(input?.score) || 50), 0, 100),
        strengths: asList(input?.strengths, 4),
        weaknesses: asList(input?.weaknesses, 4),
        suggestion: clampText(input?.suggestion, '先补充简历与相关经历，再尝试投递。', 160),
    };
}

export async function generateAiResumeReview(api: ResolvedApi, life: BankLifeState, posting: BankJobPosting) {
    const fallback = { score: 55, strengths: ['有基础求职意愿'], weaknesses: ['简历信息还不够完整'], suggestion: '补充技能、经历和期望薪资后再投递。' };
    const data = await callBankLifeAiJson(api, [
        { role: 'system', content: '你是求职 APP 的岗位匹配评估器。只输出 JSON：{"score":0,"strengths":[],"weaknesses":[],"suggestion":""}。' },
        { role: 'user', content: JSON.stringify({ resume: life.resume, posting, fatigue: life.fatigue, experience: life.experience }) },
    ], fallback);
    return sanitizeResumeReview(data);
}

export function sanitizeAiJobs(input: any, category: string): BankJobPosting[] {
    const arr = Array.isArray(input) ? input : [];
    return arr.slice(0, 8).map((raw, idx) => {
        const riskTags = asList(raw?.riskTags, 6);
        const black = !!raw?.black || riskTags.some(tag => riskWords.some(w => tag.includes(w)));
        const payCycle: BankJobPayCycle = payCycles.has(raw?.payCycle) ? raw.payCycle : 'monthly';
        const fallback = JOB_POSTINGS[idx % JOB_POSTINGS.length];
        const pickedCategory = JOB_CATEGORIES.includes(raw?.category) && raw.category !== '全部' ? raw.category : (category && category !== '全部' ? category : fallback.category);
        const salaryMin = clamp(Math.round(Number(raw?.salaryMin) || fallback.salaryMin), 80, 50000);
        const salaryMax = clamp(Math.round(Number(raw?.salaryMax) || Math.max(salaryMin, fallback.salaryMax)), salaryMin, 50000);
        return {
            ...fallback,
            id: `ai-job-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
            category: pickedCategory,
            title: clampText(raw?.title, fallback.title, 32),
            employer: clampText(raw?.employer, fallback.employer, 32),
            salaryMin,
            salaryMax,
            payCycle,
            payDay: payCycle === 'monthly' ? clamp(Math.round(Number(raw?.payDay) || fallback.payDay || 10), 1, 28) : undefined,
            intensity: clamp(Math.round(Number(raw?.intensity) || fallback.intensity), 1, 5),
            requirements: asList(raw?.requirements, 6).length ? asList(raw?.requirements, 6) : fallback.requirements,
            benefits: asList(raw?.benefits, 5).length ? asList(raw?.benefits, 5) : fallback.benefits,
            riskTags,
            description: clampText(raw?.description, fallback.description, 180),
            location: clampText(raw?.location, fallback.location || '本市', 40),
            workTime: clampText(raw?.workTime, fallback.workTime || '排班制', 40),
            companySize: clampText(raw?.companySize, fallback.companySize || '规模未披露', 24),
            bossName: clampText(raw?.bossName, fallback.bossName || '招聘负责人', 20),
            bossTitle: clampText(raw?.bossTitle, fallback.bossTitle || 'HR', 20),
            companyIntro: clampText(raw?.companyIntro, fallback.companyIntro || fallback.description, 160),
            black,
            tags: asList(raw?.tags, 6),
        };
    });
}

export async function generateAiJobs(api: ResolvedApi, life: BankLifeState, query: string, category: string): Promise<BankJobPosting[]> {
    const data = await callBankLifeAiJson(api, [
        { role: 'system', content: '你是虚拟招聘市场生成器。只输出 JSON：{"jobs":[岗位]}。岗位字段包含 category/title/employer/salaryMin/salaryMax/payCycle/intensity/requirements/benefits/riskTags/description/location/workTime/companySize/bossName/bossTitle/companyIntro/black。不要使用真实品牌。' },
        { role: 'user', content: JSON.stringify({ dateStr: life.dateStr, resume: life.resume, query, category, existingCategories: JOB_CATEGORIES }) },
    ], { jobs: [] });
    return sanitizeAiJobs(data?.jobs, category);
}

export async function generateAiRecruiterReply(api: ResolvedApi, life: BankLifeState, application: BankJobApplication, userMessage: string) {
    const fallback = { content: '收到，我这边先看一下你的情况。可以再说说你的排班和相关经验吗？', stageHint: application.stage || 'screening' };
    const data = await callBankLifeAiJson(api, [
        { role: 'system', content: '你扮演招聘方 Boss/HR。只输出 JSON：{"content":"回复内容","stageHint":"submitted|screening|assessment|interview|offer|rejected|scammed"}。语气像真实招聘聊天，简短直接。黑心岗位可以露出押金/培训费等风险。' },
        { role: 'user', content: JSON.stringify({ resume: life.resume, application, userMessage }) },
    ], fallback);
    const validStages: BankJobApplicationStage[] = ['submitted', 'screening', 'assessment', 'interview', 'offer', 'hired', 'trial', 'rejected', 'scammed'];
    return { content: clampText(data?.content, fallback.content, 220), stageHint: validStages.includes(data?.stageHint) ? data.stageHint : fallback.stageHint };
}

export function sanitizeMarketPulses(input: any, dateStr: string, symbols: string[]): BankMarketPulse[] {
    const arr = Array.isArray(input) ? input : [];
    return arr.slice(0, 4).map((raw, idx) => {
        const affected = asList(raw?.affectedSymbols, 4).filter(s => symbols.includes(s));
        return {
            id: `ai-pulse-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
            dateStr,
            headline: clampText(raw?.headline, '虚拟市场窄幅波动', 42),
            summary: clampText(raw?.summary, '消费与科技板块分化，适合观察自选股。', 160),
            affectedSymbols: affected.length ? affected : symbols.slice(0, 2),
            sentiment: pulseSentiments.has(raw?.sentiment) ? raw.sentiment : 'neutral',
            source: 'ai',
        };
    });
}

export async function generateAiMarketPulse(api: ResolvedApi, life: BankLifeState): Promise<BankMarketPulse[]> {
    const symbols = life.stockMarket.map(q => q.symbol);
    const fallback = [{ headline: '虚拟市场窄幅波动', summary: '消费与科技板块分化，适合观察自选股。', affectedSymbols: symbols.slice(0, 2), sentiment: 'neutral' }];
    const data = await callBankLifeAiJson(api, [
        { role: 'system', content: '你是虚拟股市资讯编辑。只输出 JSON：{"pulses":[{"headline":"","summary":"","affectedSymbols":[],"sentiment":"bullish|neutral|bearish"}]}。不要提供现实投资建议。' },
        { role: 'user', content: JSON.stringify({ dateStr: life.dateStr, quotes: life.stockMarket.map(q => ({ symbol: q.symbol, name: q.name, price: q.price, changePct: q.changePct, industry: q.industry })) }) },
    ], { pulses: fallback });
    return sanitizeMarketPulses(data?.pulses, life.dateStr, symbols);
}

export function sanitizeLoanReview(input: any, amount: number, channel: BankLoanChannel) {
    const product = LOAN_PRODUCTS[channel];
    const approved = input?.approved !== false;
    return {
        approved,
        approvedAmount: approved ? clamp(Math.round(Number(input?.approvedAmount) || amount), product.min, Math.min(amount, product.max)) : 0,
        reason: clampText(input?.reason, approved ? '按当前模拟信用资料可进入放款流程。' : '当前模拟信用资料暂未通过审核。', 180),
        warnings: asList(input?.warnings, 4),
        suggestedDailyRateMultiplier: clamp(Number(input?.suggestedDailyRateMultiplier) || 1, 0.8, channel === 'shady' ? 2.5 : 1.4),
    };
}

export async function generateAiLoanReview(api: ResolvedApi, life: BankLifeState, channel: BankLoanChannel, amount: number) {
    const fallback = { approved: true, approvedAmount: amount, reason: '按当前模拟信用资料可进入放款流程。', warnings: [] };
    const data = await callBankLifeAiJson(api, [
        { role: 'system', content: '你是虚拟借款审核员。只输出 JSON：{"approved":true,"approvedAmount":0,"reason":"","warnings":[],"suggestedDailyRateMultiplier":1}。银行更严格，高利贷更容易通过但风险警告更多。所有内容都是虚拟模拟。' },
        { role: 'user', content: JSON.stringify({ creditProfile: life.creditProfile, currentJob: life.currentJob?.title, debt: life.loans, channel, amount }) },
    ], fallback);
    return sanitizeLoanReview(data, amount, channel);
}
