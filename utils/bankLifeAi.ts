import type { ResolvedApi } from './auxApi';
import { JOB_CATEGORIES, JOB_POSTINGS, LOAN_PRODUCTS } from './bankLife';
import { callChatCompletion } from './llmClient';
import { makeApiUsageMeta } from './apiUsageCatalog';
import type {
    BankJobApplication,
    BankJobApplicationStage,
    BankJobPayCycle,
    BankJobPosting,
    BankJobStageAiDraft,
    BankLifeActionCategory,
    BankLifeActionMetric,
    BankLifeActionTone,
    BankLifeAiEvent,
    BankLifeState,
    BankLoanChannel,
    BankMarketPulse,
    BankStockQuote,
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
const jobStages: BankJobApplicationStage[] = ['submitted', 'screening', 'recruiter_chat', 'assessment', 'interview', 'negotiation', 'offer', 'hired', 'trial', 'rejected', 'scammed', 'declined'];
const immersiveJobReplacements: Array<[RegExp, string]> = [
    [/虚拟求职模拟|虚拟招聘模拟|模拟求职|虚拟岗位|虚拟雇主|虚拟|模拟/g, ''],
    [/不连接真实招聘平台|不连接平台|真实招聘承诺|真实招聘|真实品牌|Moro|系统/g, ''],
    [/黑心岗位|黑心铺子|黑心店|黑心/g, '细节不稳'],
    [/押金风险/g, '物料费用口径'],
    [/高风险/g, '需要多问'],
    [/风险/g, '细节'],
    [/保证金|押金|先交钱|先交费|先交/g, '到岗前费用'],
    [/培训费/g, '培训门槛'],
    [/无薪试岗|无薪/g, '试岗计薪'],
    [/拖欠/g, '到账慢'],
    [/结算不明/g, '结算待确认'],
];

const cleanImmersiveJobText = (v: unknown, fallback: string, max = 240) => {
    let s = clampText(v, fallback, max);
    for (const [pattern, replacement] of immersiveJobReplacements) s = s.replace(pattern, replacement);
    s = s.replace(/\s+/g, ' ').replace(/\s+([，。；、：])/g, '$1').replace(/([（(])\s+/g, '$1').replace(/\s+([）)])/g, '$1').trim();
    return s || clampText(fallback || '细节待确认', '细节待确认', max);
};

const cleanImmersiveJobList = (items: unknown, fallback: string[] = [], max = 6, maxChars = 48) => {
    const source = asList(items, max).length ? asList(items, max) : fallback;
    return source.map(item => cleanImmersiveJobText(item, '', maxChars)).filter(Boolean).slice(0, max);
};

const sanitizeSalaryDetail = (raw: any, fallback: BankJobPosting, payCycle: BankJobPayCycle, salaryMin: number) => {
    const detail = raw?.salaryDetail || {};
    const fallbackDetail = fallback.salaryDetail || {};
    const rawBase = Number(detail?.baseSalary);
    const baseSalary = Number.isFinite(rawBase)
        ? clamp(Math.round(rawBase), 80, 50000)
        : fallbackDetail.baseSalary ?? (payCycle === 'monthly' ? Math.round(salaryMin * 0.72) : undefined);
    const bonusSubsidies = cleanImmersiveJobList(detail?.bonusSubsidies, [], 6, 32);
    return {
        baseSalary,
        socialInsurance: cleanImmersiveJobText(detail?.socialInsurance, fallbackDetail.socialInsurance || (payCycle === 'monthly' ? '五险一金' : '灵活结算'), 24),
        bonusSubsidies: bonusSubsidies.length ? bonusSubsidies : (fallbackDetail.bonusSubsidies || []),
        note: cleanImmersiveJobText(detail?.note, fallbackDetail.note || '薪资以最终沟通条款为准。', 120),
    };
};

const sanitizeRecruiterStats = (raw: any, fallback: BankJobPosting) => {
    const stats = raw?.recruiterStats || {};
    const fallbackStats = fallback.recruiterStats || {};
    return {
        responseTime: cleanImmersiveJobText(stats?.responseTime, fallbackStats.responseTime || '30分钟内回复', 24),
        replyRate: cleanImmersiveJobText(stats?.replyRate, fallbackStats.replyRate || '回复率较高', 24),
        todayReplies: cleanImmersiveJobText(stats?.todayReplies, fallbackStats.todayReplies || '今日活跃', 24),
    };
};

export interface BankLifeActionAiDraft {
    title?: string;
    summary: string;
    tone: BankLifeActionTone;
    riskTags: string[];
    suggestions: string[];
    metrics?: BankLifeActionMetric[];
}

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

export async function callBankLifeAiJson(api: ResolvedApi, messages: { role: 'system' | 'user'; content: string }[], fallback: any, featureId = 'bank.lifeAi'): Promise<any> {
    if (!api?.baseUrl || !api?.model) return fallback;
    try {
        const json = await callChatCompletion(api, {
            model: api.model,
            messages,
            temperature: 0.85,
            stream: false,
        }, {
            meta: makeApiUsageMeta(featureId, {
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

export function sanitizeBankActionAiDraft(input: any, fallbackSummary = '这一步已按本地规则完成。'): BankLifeActionAiDraft {
    const rawMetrics = Array.isArray(input?.metrics) ? input.metrics : [];
    const metrics = rawMetrics.slice(0, 5).map((m: any) => ({
        label: clampText(m?.label, '指标', 18),
        value: clampText(m?.value, '已更新', 32),
        tone: toneSet.has(m?.tone) ? m.tone : undefined,
    })).filter((m: BankLifeActionMetric) => m.label && m.value);
    return {
        title: input?.title ? clampText(input.title, 'AI 点评', 36) : undefined,
        summary: clampText(input?.summary, fallbackSummary, 220),
        tone: toneSet.has(input?.tone) ? input.tone : 'info',
        riskTags: asList(input?.riskTags, 6),
        suggestions: asList(input?.suggestions || input?.nextActions, 4),
        metrics: metrics.length ? metrics : undefined,
    };
}

export async function generateAiBankActionDraft(
    api: ResolvedApi,
    life: BankLifeState,
    category: BankLifeActionCategory,
    action: string,
    context: Record<string, unknown>,
    featureId: string,
    fallbackSummary = '这一步已按本地规则完成。'
): Promise<BankLifeActionAiDraft> {
    const fallback = { summary: fallbackSummary, tone: 'info', riskTags: [], suggestions: [] };
    const data = await callBankLifeAiJson(api, [
        { role: 'system', content: '你是人生拟虚拟资产流程的点评员。只输出 JSON：{"title":"","summary":"","tone":"good|warn|bad|info","riskTags":[],"suggestions":[],"metrics":[{"label":"","value":"","tone":"good|warn|bad|info"}]}。只能点评 Moro 内虚拟模拟，不提供真实金融、借贷、工商、招聘建议。' },
        { role: 'user', content: JSON.stringify({ dateStr: life.dateStr, category, action, state: { walletFree: false, fatigue: life.fatigue, reputation: life.reputation, holdings: Object.keys(life.holdings), loans: life.loans.length, company: life.company?.name, shop: life.shopBusinessName }, context }) },
    ], fallback, featureId);
    return sanitizeBankActionAiDraft(data, fallbackSummary);
}

export function generateLocalDashboardInsight(life: BankLifeState): BankLifeActionAiDraft {
    const debt = life.loans.reduce((sum, l) => sum + l.outstanding + l.interestDue, 0);
    const riskTags = [
        ...(life.fatigue > 70 ? ['疲劳偏高'] : []),
        ...(debt > 0 ? ['有负债'] : []),
        ...(Object.keys(life.holdings).length > 0 ? ['持仓需复盘'] : []),
    ];
    return {
        summary: riskTags.length ? `今天最该留意的是${riskTags.join('、')}，先把现金流和精力稳住。` : '今天状态比较平稳，可以选择求职、经营或复盘账本推进下一步。',
        tone: riskTags.length ? 'warn' : 'good',
        riskTags,
        suggestions: ['查看今日事件', life.company?.pendingIssue ? '处理公司事务' : '补齐下一步计划', debt > 0 ? '检查还款计划' : '保留应急现金'].slice(0, 3),
    };
}

export async function generateAiDashboardInsight(api: ResolvedApi, life: BankLifeState) {
    return generateAiBankActionDraft(api, life, 'dashboard', 'dashboard-insight', {}, 'bank.dashboardInsight', generateLocalDashboardInsight(life).summary);
}

export async function generateAiShopActionDraft(api: ResolvedApi, life: BankLifeState, context: Record<string, unknown>) {
    return generateAiBankActionDraft(api, life, 'shop', String(context.action || 'shop-action'), context, 'bank.shopAction', '店铺动作已完成，记得关注库存、店员状态和顾客反馈。');
}

export async function generateAiInvestAdvice(api: ResolvedApi, life: BankLifeState, quote?: BankStockQuote) {
    return generateAiBankActionDraft(api, life, 'invest', 'invest-advice', { quote }, 'bank.investAdvice', '这是 Moro 内虚拟行情，先看风险等级、仓位和新闻变化。');
}

export async function generateAiStockOrderDraft(api: ResolvedApi, life: BankLifeState, context: Record<string, unknown>) {
    return generateAiBankActionDraft(api, life, 'invest', 'stock-order', context, 'bank.stockOrder', '订单已按本地撮合规则完成，建议复盘成交价、手续费和仓位。');
}

export async function generateAiCompanyActionDraft(api: ResolvedApi, life: BankLifeState, context: Record<string, unknown>) {
    return generateAiBankActionDraft(api, life, 'company', String(context.action || 'company-action'), context, 'bank.companyAction', '公司动作已完成，下一步重点看现金流、压力和声誉。');
}

export async function generateAiLedgerInsight(api: ResolvedApi, life: BankLifeState, context: Record<string, unknown>) {
    return generateAiBankActionDraft(api, life, 'ledger', 'ledger-insight', context, 'bank.ledgerInsight', '账本已经更新，可以回看金额、来源和预算影响。');
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
    ], fallback, 'bank.resumeReview');
    return sanitizeResumeReview(data);
}

export function sanitizeAiJobs(input: any, category: string): BankJobPosting[] {
    const arr = Array.isArray(input) ? input : [];
    return arr.slice(0, 8).map((raw, idx) => {
        const rawRiskTags = asList(raw?.riskTags, 6);
        const riskTags = cleanImmersiveJobList(raw?.riskTags, [], 6, 32);
        const black = !!raw?.black || rawRiskTags.some(tag => riskWords.some(w => tag.includes(w)));
        const payCycle: BankJobPayCycle = payCycles.has(raw?.payCycle) ? raw.payCycle : 'monthly';
        const baseFallback = JOB_POSTINGS[idx % JOB_POSTINGS.length];
        const pickedCategory = JOB_CATEGORIES.includes(raw?.category) && raw.category !== '全部' ? raw.category : (category && category !== '全部' ? category : baseFallback.category);
        const fallback = JOB_POSTINGS.find(j => j.category === pickedCategory) || baseFallback;
        const salaryMin = clamp(Math.round(Number(raw?.salaryMin) || fallback.salaryMin), 80, 50000);
        const salaryMax = clamp(Math.round(Number(raw?.salaryMax) || Math.max(salaryMin, fallback.salaryMax)), salaryMin, 50000);
        const responsibilities = cleanImmersiveJobList(raw?.responsibilities, [], 5, 96);
        const requirementDetails = cleanImmersiveJobList(raw?.requirementDetails, [], 5, 96);
        const employeeBenefits = cleanImmersiveJobList(raw?.employeeBenefits, [], 8, 32);
        const tags = cleanImmersiveJobList(raw?.tags, [], 8, 32);
        return {
            ...fallback,
            id: `ai-job-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
            category: pickedCategory,
            title: cleanImmersiveJobText(raw?.title, fallback.title, 32),
            employer: cleanImmersiveJobText(raw?.employer, fallback.employer, 32),
            salaryMin,
            salaryMax,
            payCycle,
            payDay: payCycle === 'monthly' ? clamp(Math.round(Number(raw?.payDay) || fallback.payDay || 10), 1, 28) : undefined,
            intensity: clamp(Math.round(Number(raw?.intensity) || fallback.intensity), 1, 5),
            requirements: cleanImmersiveJobList(raw?.requirements, fallback.requirements, 6, 32),
            benefits: cleanImmersiveJobList(raw?.benefits, fallback.benefits, 5, 32),
            riskTags,
            description: cleanImmersiveJobText(raw?.description, fallback.description, 180),
            location: cleanImmersiveJobText(raw?.location, fallback.location || '本市', 40),
            workTime: cleanImmersiveJobText(raw?.workTime, fallback.workTime || '排班制', 40),
            companySize: cleanImmersiveJobText(raw?.companySize, fallback.companySize || '规模未披露', 24),
            bossName: cleanImmersiveJobText(raw?.bossName, fallback.bossName || '招聘负责人', 20),
            bossTitle: cleanImmersiveJobText(raw?.bossTitle, fallback.bossTitle || 'HR', 20),
            companyIntro: cleanImmersiveJobText(raw?.companyIntro, fallback.companyIntro || fallback.description, 220),
            salaryDetail: sanitizeSalaryDetail(raw, fallback, payCycle, salaryMin),
            responsibilities: responsibilities.length ? responsibilities : fallback.responsibilities,
            requirementDetails: requirementDetails.length ? requirementDetails : fallback.requirementDetails,
            employeeBenefits: employeeBenefits.length ? employeeBenefits : fallback.employeeBenefits,
            recruiterStats: sanitizeRecruiterStats(raw, fallback),
            companyIndustry: cleanImmersiveJobText(raw?.companyIndustry, fallback.companyIndustry || pickedCategory, 32),
            companyStage: cleanImmersiveJobText(raw?.companyStage, fallback.companyStage || fallback.companySize || '招聘中', 32),
            publishNote: cleanImmersiveJobText(raw?.publishNote, fallback.publishNote || '该职位近期活跃', 32),
            black,
            tags: tags.length ? tags : fallback.tags,
        };
    });
}

export async function generateAiJobs(api: ResolvedApi, life: BankLifeState, query: string, category: string): Promise<BankJobPosting[]> {
    const data = await callBankLifeAiJson(api, [
        { role: 'system', content: '你是招聘市场内容生成器。只输出 JSON：{"jobs":[岗位]}。岗位字段包含 category/title/employer/salaryMin/salaryMax/payCycle/payDay/intensity/requirements/benefits/riskTags/description/location/education/experienceRequired/workTime/companySize/bossName/bossTitle/companyIntro/salaryDetail/responsibilities/requirementDetails/employeeBenefits/recruiterStats/companyIndustry/companyStage/publishNote/black。文案参考招聘 App 的信息密度，所有公司、岗位和品牌名都必须是虚构的。不要在任何岗位标题、简介、公司介绍、标签、warning 或 HR 话术里出现“虚拟/模拟/黑心/风险/系统/Moro/不连接真实平台/真实招聘承诺”等幕后词。靠谱与不靠谱都用场景内细节表现：薪资口径、试岗计薪、到岗费用、培训门槛、合同主体、地址和结算周期可以写得含蓄但具体。' },
        { role: 'user', content: JSON.stringify({ dateStr: life.dateStr, resume: life.resume, query, category, existingCategories: JOB_CATEGORIES }) },
    ], { jobs: [] }, 'bank.jobSearch');
    return sanitizeAiJobs(data?.jobs, category);
}

export async function generateAiRecruiterReply(api: ResolvedApi, life: BankLifeState, application: BankJobApplication, userMessage: string) {
    const fallback = { content: '收到，我这边先看一下你的情况。可以再说说你的到岗时间、排班偏好和期望薪资吗？薪资结构、社保、试用期和结算方式也可以一起确认。', stageHint: application.stage || 'screening' };
    const data = await callBankLifeAiJson(api, [
        { role: 'system', content: '你扮演招聘方 Boss/HR。只输出 JSON：{"content":"回复内容","stageHint":"submitted|screening|recruiter_chat|assessment|interview|negotiation|offer|rejected|scammed"}。语气像招聘聊天，简短直接，优先围绕薪资结构、社保、排班、试用期、结算方式和到岗时间。遇到条款含糊的岗位，可以通过到岗费用、培训门槛、试岗计薪、合同主体、地址和到账周期露出破绽；不要在回复里说“虚拟/模拟/黑心/风险/系统/Moro/不连接真实平台”等幕后词。' },
        { role: 'user', content: JSON.stringify({ resume: life.resume, application, userMessage }) },
    ], fallback, 'bank.recruiterChat');
    const validStages: BankJobApplicationStage[] = jobStages;
    return { content: cleanImmersiveJobText(data?.content, fallback.content, 220), stageHint: validStages.includes(data?.stageHint) ? data.stageHint : fallback.stageHint };
}

export function sanitizeAiJobStageDraft(input: any, fallbackStage: BankJobApplicationStage): BankJobStageAiDraft {
    const rawTerms = input?.offerTerms || {};
    const nextStage = jobStages.includes(input?.nextStage) ? input.nextStage : fallbackStage;
    const scoreDelta = Number.isFinite(Number(input?.scoreDelta)) ? clamp(Math.round(Number(input.scoreDelta)), -25, 30) : undefined;
    const offerSalary = Number.isFinite(Number(input?.offerSalary)) ? clamp(Math.round(Number(input.offerSalary)), 80, 50000) : undefined;
    return {
        nextStage,
        scoreDelta,
        summary: cleanImmersiveJobText(input?.summary, '这一步有了新的求职进展。', 220),
        bossMessage: input?.bossMessage ? cleanImmersiveJobText(input.bossMessage, '这边收到，会继续推进。', 220) : undefined,
        highlights: cleanImmersiveJobList(input?.highlights, [], 5, 96),
        riskFlags: cleanImmersiveJobList(input?.riskFlags, [], 6, 32),
        offerSalary,
        rejectReason: input?.rejectReason ? cleanImmersiveJobText(input.rejectReason, '双方暂时不匹配。', 120) : undefined,
        nextActionLabel: input?.nextActionLabel ? cleanImmersiveJobText(input.nextActionLabel, '继续下一步', 24) : undefined,
        tone: toneSet.has(input?.tone) ? input.tone : undefined,
        offerTerms: input?.offerTerms ? {
            salary: offerSalary || (Number.isFinite(Number(rawTerms.salary)) ? clamp(Math.round(Number(rawTerms.salary)), 80, 50000) : undefined),
            payCycle: payCycles.has(rawTerms.payCycle) ? rawTerms.payCycle : undefined,
            payDay: Number.isFinite(Number(rawTerms.payDay)) ? clamp(Math.round(Number(rawTerms.payDay)), 1, 28) : undefined,
            workTime: rawTerms.workTime ? cleanImmersiveJobText(rawTerms.workTime, '排班制', 40) : undefined,
            trialDays: Number.isFinite(Number(rawTerms.trialDays)) ? clamp(Math.round(Number(rawTerms.trialDays)), 0, 30) : undefined,
            benefits: cleanImmersiveJobList(rawTerms.benefits, [], 6, 32),
            risks: cleanImmersiveJobList(rawTerms.risks, [], 6, 32),
            negotiable: rawTerms.negotiable !== false,
        } : undefined,
    };
}

export async function generateAiJobStageDecision(api: ResolvedApi, life: BankLifeState, application: BankJobApplication, userInput: string): Promise<BankJobStageAiDraft> {
    const fallback = { nextStage: application.stage || 'screening', summary: application.message || '这一步有了新的求职进展。', highlights: [], riskFlags: [] };
    const data = await callBankLifeAiJson(api, [
        { role: 'system', content: '你是求职流程导演。只输出 JSON：{"nextStage":"submitted|screening|recruiter_chat|assessment|interview|negotiation|offer|hired|trial|rejected|scammed|declined","scoreDelta":0,"summary":"","bossMessage":"","highlights":[],"riskFlags":[],"offerSalary":0,"offerTerms":{"salary":0,"payCycle":"daily|monthly","payDay":10,"workTime":"","trialDays":0,"benefits":[],"risks":[],"negotiable":true},"nextActionLabel":"","tone":"good|warn|bad|info"}。所有公司、岗位和品牌名都必须是虚构的；不要把“虚拟/模拟/黑心/风险/系统/Moro/不连接真实平台/真实招聘承诺”等幕后词写进 summary、bossMessage、highlights、riskFlags 或 offerTerms。条款不稳时，用费用名目、培训门槛、试岗计薪、合同主体、地址、到账日期等场景内细节呈现。' },
        { role: 'user', content: JSON.stringify({ dateStr: life.dateStr, resume: life.resume, fatigue: life.fatigue, reputation: life.reputation, application, userInput }) },
    ], fallback, 'bank.jobStage');
    return sanitizeAiJobStageDraft(data, application.stage || 'screening');
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
    ], { pulses: fallback }, 'bank.investAdvice');
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
    ], fallback, 'bank.loanReview');
    return sanitizeLoanReview(data, amount, channel);
}
