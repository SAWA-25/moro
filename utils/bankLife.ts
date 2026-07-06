import {
    BankBusinessTemplate,
    BankFullState,
    BankJobApplication,
    BankJobApplicationStage,
    BankJobApplicationStatus,
    BankJobEmployment,
    BankJobPosting,
    BankJobStageAiDraft,
    BankJobStageResult,
    BankJobStageTodo,
    BankLifeDailyPlanItem,
    BankLifeEvent,
    BankLifeState,
    BankLoan,
    BankLoanChannel,
    BankLoanActionResult,
    BankCompanyActionResult,
    BankLifeActionCategory,
    BankLifeActionMetric,
    BankLifeActionRecord,
    BankLifeActionResult,
    BankLifeActionTone,
    BankLifeShopProduct,
    BankShopActionResult,
    BankShopBranch,
    BankShopDailyRewards,
    BankShopPortfolioState,
    BankShopState,
    BankStockOrderResult,
    BankStockHolding,
    BankStockQuote,
    BankCompanyState,
    BankLoanCreditProfile,
    BankMarketPulse,
    BankResumeProfile,
    ShopStaff,
} from '../types';

export const BANK_LIFE_VERSION = 4;
export const SHOP_UNLOCK_COST = 10000;
export const BANK_OPEN_BRANCH_ENERGY_COST = 30;
export const INITIAL_HEADQUARTERS_ENERGY = 80;
export const COMPANY_FOUND_COST = 100000;
export const BANK_SHOP_CLOSE_HOUR = 18;
export const BANK_SHOP_DAILY_RESET_HOUR = 4;

export function canCloseBankShopAt(date: Date | number = new Date()): boolean {
    const d = date instanceof Date ? date : new Date(date);
    return d.getHours() >= BANK_SHOP_CLOSE_HOUR;
}

export type BankShopCloseBlockReason = 'tooEarly' | 'alreadyClosed';

export function getBankShopCloseBlockReason(shop: Pick<BankShopState, 'isBusinessOpen'>, date: Date | number = new Date()): BankShopCloseBlockReason | undefined {
    if (!canCloseBankShopAt(date)) return 'tooEarly';
    if (shop.isBusinessOpen !== true) return 'alreadyClosed';
    return undefined;
}

type BankShopBusinessGateState = Pick<BankShopState, 'isBusinessOpen' | 'openedBusinessDateStr' | 'lastBusinessDateStr'>;
type BankShopBusinessDateInput = Date | number | string;

const pad2 = (n: number): string => n < 10 ? `0${n}` : `${n}`;

const localDateStr = (date: Date): string => {
    const y = date.getFullYear();
    const m = pad2(date.getMonth() + 1);
    const d = pad2(date.getDate());
    return `${y}-${m}-${d}`;
};

export function bankShopBusinessDateStr(date: Date | number = new Date()): string {
    const d = date instanceof Date ? new Date(date.getTime()) : new Date(date);
    if (!isFinite(d.getTime())) return todayStr();
    if (d.getHours() < BANK_SHOP_DAILY_RESET_HOUR) d.setDate(d.getDate() - 1);
    return localDateStr(d);
}

const normalizeBusinessDateStr = (date: BankShopBusinessDateInput = new Date()): string => {
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(date)) return date.slice(0, 10);
    return bankShopBusinessDateStr(date instanceof Date || typeof date === 'number' ? date : new Date(date));
};

export function canOpenBankShopForDate(shop: BankShopBusinessGateState, date: BankShopBusinessDateInput = new Date()): boolean {
    const day = normalizeBusinessDateStr(date);
    return shop.isBusinessOpen !== true && shop.lastBusinessDateStr !== day;
}

export function canSettleBankShopForDate(shop: BankShopBusinessGateState, date: BankShopBusinessDateInput = new Date()): boolean {
    const day = normalizeBusinessDateStr(date);
    return shop.isBusinessOpen === true
        && shop.openedBusinessDateStr === day
        && shop.lastBusinessDateStr !== day;
}

export function markBankShopBusinessOpened<T extends BankShopState>(shop: T, date: BankShopBusinessDateInput = new Date(), now = Date.now()): T {
    const day = normalizeBusinessDateStr(date);
    return {
        ...shop,
        isBusinessOpen: true,
        openedBusinessDateStr: day,
        lastAccrualAt: now,
    };
}

export function markBankShopBusinessSettled<T extends BankShopState>(shop: T, date: BankShopBusinessDateInput = new Date(), now = Date.now()): T {
    const day = normalizeBusinessDateStr(date);
    const { openedBusinessDateStr: _openedBusinessDateStr, ...rest } = shop;
    return {
        ...rest,
        isBusinessOpen: false,
        lastBusinessDateStr: day,
        lastBusinessAt: now,
        lastAccrualAt: now,
    } as T;
}

const genId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const DEFAULT_SHOP_RECIPE_ID = 'recipe-coffee-001';
const DEFAULT_SHOP_RECIPE_STOCK = 12;

const createDefaultSystemStaff = (): ShopStaff => ({
    id: 'staff-001',
    name: '系统',
    avatar: '🐱',
    role: 'manager',
    fatigue: 0,
    maxFatigue: 100,
    hireDate: Date.now(),
    x: 50,
    y: 50,
    personality: 'Moro的专属宠物，负责看店',
    isPet: true,
});

export const todayStr = () => new Date().toISOString().slice(0, 10);

export const addDays = (dateStr: string, days: number): string => {
    const [y, m, d0] = dateStr.split('-').map(Number);
    const d = new Date(Date.UTC(y, (m || 1) - 1, d0 || 1));
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
};

const dayOfMonth = (dateStr: string) => Number(dateStr.slice(8, 10));

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

const roundMoney = (n: number) => Math.round(n * 100) / 100;

function weekDayOf(dateStr: string): number {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, (m || 1) - 1, d || 1)).getUTCDay();
}

function seasonOf(dateStr: string): BankLifeState['season'] {
    const month = Number(dateStr.slice(5, 7));
    if (month >= 3 && month <= 5) return 'spring';
    if (month >= 6 && month <= 8) return 'summer';
    if (month >= 9 && month <= 11) return 'autumn';
    return 'winter';
}

function buildDailyPlan(life: Partial<BankLifeState> & { dateStr: string }): BankLifeDailyPlanItem[] {
    const plan: BankLifeDailyPlanItem[] = [];
    if (life.currentJob) {
        plan.push({ id: 'plan-work', kind: 'work', label: '上班赚钱', detail: `${life.currentJob.employer} · ${life.currentJob.title}`, tone: 'info' });
    } else {
        plan.push({ id: 'plan-rest', kind: 'rest', label: '休整生活', detail: '今天没有固定班次，适合恢复精力或找新机会。', tone: 'good' });
    }
    if (life.shopUnlocked) plan.push({ id: 'plan-shop', kind: 'shop', label: '打理小店', detail: `${life.shopBusinessName || '小店'} 有货架和客群要照看。`, tone: 'info' });
    if (life.company?.pendingIssue) plan.push({ id: 'plan-company', kind: 'company', label: '处理公司事务', detail: life.company.pendingIssue.title, tone: 'warn' });
    const loan = life.loans?.find(l => l.outstanding + l.interestDue > 0);
    if (loan) plan.push({ id: 'plan-loan', kind: 'loan', label: '关注还款', detail: `${loan.productName || loan.note} 到期日 ${loan.dueDate}`, tone: loan.overdueDays > 0 ? 'bad' : 'warn' });
    if (life.stockMarket?.length) plan.push({ id: 'plan-invest', kind: 'invest', label: '查看行情', detail: '自选股行情每天刷新，可复盘持仓盈亏。', tone: 'info' });
    return plan.slice(0, 5);
}

function defaultResume(dateStr: string): BankResumeProfile {
    return {
        name: '我',
        headline: '正在探索人生拟机会',
        expectedCategories: [],
        skills: [],
        experience: [],
        education: '',
        selfIntro: '希望找到适合当前生活节奏的机会。',
        updatedAt: new Date(`${dateStr}T00:00:00Z`).getTime() || Date.now(),
    };
}

function defaultCreditProfile(dateStr = todayStr()): BankLoanCreditProfile {
    return {
        score: 620,
        incomeStability: 50,
        debtPressure: 20,
        repaymentHistory: 70,
        riskLevel: 'medium',
        reasons: ['暂无完整收入与还款记录，先按中等信用评估。'],
        updatedAt: dateStr,
    };
}

const actionToneForAmount = (amount?: number): BankLifeActionTone => {
    if (!amount) return 'info';
    return amount >= 0 ? 'good' : 'warn';
};

function compactMetrics(metrics?: BankLifeActionMetric[]): BankLifeActionMetric[] | undefined {
    const clean = (metrics || [])
        .map(m => ({ ...m, label: String(m.label || '').trim(), value: String(m.value || '').trim() }))
        .filter(m => m.label && m.value)
        .slice(0, 8);
    return clean.length ? clean : undefined;
}

export function createBankActionResult(input: {
    category: BankLifeActionCategory;
    kind: string;
    title: string;
    summary: string;
    dateStr?: string;
    tone?: BankLifeActionTone;
    amount?: number;
    riskTags?: string[];
    aiSummary?: string;
    metrics?: BankLifeActionMetric[];
    lines?: BankLifeActionMetric[];
    nextActions?: string[];
    payload?: Record<string, unknown>;
}): BankLifeActionResult {
    return {
        id: genId('action'),
        category: input.category,
        kind: input.kind,
        title: input.title,
        summary: input.summary,
        tone: input.tone || actionToneForAmount(input.amount),
        amount: input.amount,
        riskTags: (input.riskTags || []).filter(Boolean).slice(0, 8),
        aiSummary: input.aiSummary,
        metrics: compactMetrics(input.metrics),
        lines: compactMetrics(input.lines),
        nextActions: (input.nextActions || []).filter(Boolean).slice(0, 4),
        payload: input.payload,
    };
}

function actionRecordFromResult(result: BankLifeActionResult, dateStr: string): BankLifeActionRecord {
    return {
        id: result.id,
        category: result.category,
        kind: result.kind,
        title: result.title,
        summary: result.summary,
        dateStr,
        at: new Date().toISOString(),
        tone: result.tone,
        amount: result.amount,
        riskTags: result.riskTags,
        aiSummary: result.aiSummary,
        metrics: result.metrics,
        payload: result.payload,
    };
}

export function appendBankActionRecord(life: BankLifeState, result: BankLifeActionResult): BankLifeState {
    return {
        ...life,
        actionHistory: [actionRecordFromResult(result, life.dateStr), ...(life.actionHistory || [])].slice(0, 120),
    };
}


export function canUnlockLifeShop(balance: number): boolean {
    return balance >= SHOP_UNLOCK_COST;
}

export function canFoundCompany(balance: number): boolean {
    return balance >= COMPANY_FOUND_COST;
}

function seededNoise(seed: string): number {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) {
        h ^= seed.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 10000) / 10000;
}

export const JOB_CATEGORIES = [
    '全部', '服务业', '餐饮', '安保', '技术', '设计', '文职', '销售', '教育', '医疗辅助', '物流', '自由职业', '兼职', '快招专区',
];

const RAW_JOB_POSTINGS: BankJobPosting[] = [
    { id: 'job-cleaner', category: '服务业', title: '写字楼保洁', employer: '星河物业', salaryMin: 4200, salaryMax: 5600, payCycle: 'monthly', payDay: 10, intensity: 3, requirements: ['细心', '能早起'], benefits: ['包工作餐', '稳定排班'], riskTags: ['早班'], description: '负责公共区域清洁和巡检，节奏稳定，适合先攒启动资金。', successBias: 0.22 },
    { id: 'job-waiter', category: '餐饮', title: '餐厅服务员', employer: '晚风小馆', salaryMin: 4800, salaryMax: 6800, payCycle: 'monthly', payDay: 15, intensity: 4, requirements: ['沟通', '能站班'], benefits: ['包餐', '小费机会'], riskTags: ['晚班', '高峰忙'], description: '负责点单、上菜和收台，忙起来很累，但现金流稳定。', successBias: 0.18 },
    { id: 'job-programmer', category: '技术', title: '前端程序员', employer: '蓝鲸云科', salaryMin: 15000, salaryMax: 26000, payCycle: 'monthly', payDay: 5, intensity: 4, requirements: ['React', 'TypeScript', '项目经验'], benefits: ['双休', '项目奖金'], riskTags: ['加班', '面试难'], description: '维护 Web 产品和内部工具，薪资高，面试门槛也高。', successBias: -0.08 },
    { id: 'job-security', category: '安保', title: '社区保安', employer: '安宁安保', salaryMin: 4600, salaryMax: 6200, payCycle: 'monthly', payDay: 12, intensity: 3, requirements: ['守时', '夜班'], benefits: ['住宿补贴'], riskTags: ['轮班'], description: '巡逻、门岗和登记，工作重复但稳定。', successBias: 0.2 },
    { id: 'job-courier', category: '物流', title: '同城骑手', employer: '飞跑配送站', salaryMin: 180, salaryMax: 420, payCycle: 'daily', intensity: 5, requirements: ['体力', '路线熟'], benefits: ['日结', '多劳多得'], riskTags: ['天气影响', '体力消耗'], description: '按单计酬，日结到账，适合短期快速回款。', successBias: 0.12 },
    { id: 'job-designer', category: '设计', title: '视觉设计助理', employer: '白格创意', salaryMin: 8000, salaryMax: 13000, payCycle: 'monthly', payDay: 8, intensity: 3, requirements: ['审美', '作品集'], benefits: ['弹性上班'], riskTags: ['改稿'], description: '做物料、海报和品牌视觉，作品集越好越容易通过。', successBias: 0.02 },
    { id: 'job-sales', category: '销售', title: '家装顾问', employer: '好住空间', salaryMin: 5000, salaryMax: 18000, payCycle: 'monthly', payDay: 20, intensity: 4, requirements: ['表达', '抗压'], benefits: ['提成高'], riskTags: ['收入波动'], description: '底薪加提成，能说会聊时上限很高。', successBias: 0.08 },
    { id: 'job-tutor', category: '教育', title: '晚间家教', employer: '邻里托辅', salaryMin: 160, salaryMax: 360, payCycle: 'daily', intensity: 2, requirements: ['耐心', '基础学科'], benefits: ['日结', '时间短'], riskTags: ['临时取消'], description: '辅导作业和复习，适合兼顾其它赚钱方式。', successBias: 0.16 },
    { id: 'job-clerk', category: '文职', title: '行政文员', employer: '晨野商贸', salaryMin: 5500, salaryMax: 8200, payCycle: 'monthly', payDay: 10, intensity: 2, requirements: ['表格', '细心'], benefits: ['稳定', '朝九晚六'], riskTags: ['琐事多'], description: '处理报销、资料、会议和流程，稳定但成长慢。', successBias: 0.18 },
    { id: 'job-care', category: '医疗辅助', title: '陪诊助理', employer: '暖灯健康', salaryMin: 220, salaryMax: 460, payCycle: 'daily', intensity: 3, requirements: ['耐心', '熟悉流程'], benefits: ['日结', '需求稳定'], riskTags: ['情绪劳动'], description: '陪同挂号、检查、取药，细心和共情很重要。', successBias: 0.1 },
    { id: 'job-streamer', category: '自由职业', title: '直播运营兼职', employer: '浪花MCN', salaryMin: 260, salaryMax: 900, payCycle: 'daily', intensity: 4, requirements: ['网感', '剪辑'], benefits: ['日结', '有爆发'], riskTags: ['熬夜', '收入波动'], description: '帮主播排品、切片和复盘，做得好会有额外奖金。', successBias: 0.03 },
    { id: 'job-shady-deposit', category: '快招专区', title: '高薪试岗店员', employer: '金拱门外包部', salaryMin: 9000, salaryMax: 16000, payCycle: 'monthly', payDay: 28, intensity: 5, requirements: ['到岗物料确认'], benefits: ['流程快'], riskTags: ['物料费用口径', '试岗计薪口径', '月底结算'], description: '薪资写得很亮眼，入职流程催得快；物料、试岗计薪和月底结算几处口径需要逐句问清。', black: true, successBias: -0.22 },
    { id: 'job-shady-click', category: '快招专区', title: '居家数据标注', employer: '快赚互联', salaryMin: 300, salaryMax: 1200, payCycle: 'daily', intensity: 2, requirements: ['自备电脑', '先上培训'], benefits: ['居家接单'], riskTags: ['培训门槛', '接单规则', '结算周期'], description: '主打居家轻松，培训、派单门槛和到账周期写得很省字，适合把规则问具体再决定。', black: true, successBias: -0.18 },
];

const JOB_DETAIL_PRESETS: Record<string, Partial<BankJobPosting>> = {
    '服务业': { location: '本市 · 商务区', education: '不限', experienceRequired: '经验不限', workTime: '排班制', companySize: '100-499人', bossTitle: '招聘主管', tags: ['稳定', '包餐', '就近分配'] },
    '餐饮': { location: '本市 · 餐饮街', education: '不限', experienceRequired: '经验不限', workTime: '早晚班轮换', companySize: '20-99人', bossTitle: '店长', tags: ['包餐', '小费', '晋升快'] },
    '安保': { location: '本市 · 社区', education: '不限', experienceRequired: '经验不限', workTime: '两班倒', companySize: '500-999人', bossTitle: '项目经理', tags: ['住宿补贴', '稳定', '夜班'] },
    '技术': { location: '本市 · 科技园', education: '本科', experienceRequired: '1-3年', workTime: '10:00-19:00', companySize: '100-499人', bossTitle: '技术负责人', tags: ['React', 'TypeScript', '双休'] },
    '设计': { location: '本市 · 创意园', education: '大专', experienceRequired: '作品集优先', workTime: '弹性工作', companySize: '20-99人', bossTitle: '创意总监', tags: ['作品集', '弹性', '审美'] },
    '文职': { location: '本市 · 写字楼', education: '大专', experienceRequired: '经验不限', workTime: '朝九晚六', companySize: '50-199人', bossTitle: '行政经理', tags: ['稳定', '双休', '表格'] },
    '销售': { location: '本市 · 门店/外勤', education: '不限', experienceRequired: '经验不限', workTime: '弹性排班', companySize: '100-499人', bossTitle: '销售经理', tags: ['高提成', '客户资源', '抗压'] },
    '教育': { location: '本市 · 社区校区', education: '大专', experienceRequired: '有辅导经验优先', workTime: '晚间/周末', companySize: '20-99人', bossTitle: '校区负责人', tags: ['日结', '耐心', '短时'] },
    '医疗辅助': { location: '本市 · 医院周边', education: '不限', experienceRequired: '熟悉就医流程优先', workTime: '预约制', companySize: '20-99人', bossTitle: '服务主管', tags: ['日结', '陪诊', '情绪劳动'] },
    '物流': { location: '本市 · 配送站', education: '不限', experienceRequired: '路线熟优先', workTime: '多劳多得', companySize: '1000人以上', bossTitle: '站长', tags: ['日结', '高强度', '接单自由'] },
    '自由职业': { location: '远程/本市', education: '不限', experienceRequired: '案例优先', workTime: '项目制', companySize: '20-99人', bossTitle: '运营负责人', tags: ['日结', '灵活', '波动'] },
    '兼职': { location: '本市 · 多商圈', education: '不限', experienceRequired: '经验不限', workTime: '按班次预约', companySize: '20-99人', bossTitle: '兼职招聘专员', tags: ['短期', '排班灵活', '日结优先'] },
    '快招专区': { location: '地址待确认', education: '不限', experienceRequired: '号称无门槛', workTime: '说法不一', companySize: '信息待补充', bossTitle: '招聘专员', tags: ['到岗快', '条款需问清', '结算需确认'] },
};

const JOB_REALISTIC_DETAIL_PRESETS: Record<string, Partial<BankJobPosting>> = {
    '服务业': {
        companyIndustry: '物业/生活服务',
        companyStage: '区域连锁',
        salaryDetail: { socialInsurance: '五险一金', bonusSubsidies: ['全勤奖', '餐补', '节日福利'], note: '底薪按月发放，节假日排班另计补贴。' },
        responsibilities: ['负责公共区域清洁、物品补充和日常巡检。', '按楼层任务单完成消杀、垃圾清运和异常上报。', '配合主管处理临时会议、访客和活动后的现场恢复。'],
        requirementDetails: ['能接受早班或轮班，做事细致，守时。', '无需相关经验，入职会安排区域流程培训。'],
        employeeBenefits: ['五险一金', '包工作餐', '带薪年假', '节日福利', '全勤奖'],
        recruiterStats: { responseTime: '10分钟内回复', replyRate: '回复率高', todayReplies: '今日回复6次' },
        publishNote: '该职位7日内发布',
    },
    '餐饮': {
        companyIndustry: '餐饮/门店服务',
        companyStage: '社区门店',
        salaryDetail: { socialInsurance: '五险一金', bonusSubsidies: ['包餐', '夜班补贴', '门店奖金'], note: '高峰班次和节假日可叠加门店奖金。' },
        responsibilities: ['负责点单、上菜、收台和基础顾客接待。', '按门店标准完成备餐、卫生和交接班记录。', '高峰期配合后厨和收银台处理催单与加单。'],
        requirementDetails: ['能站班，沟通自然，愿意学习门店流程。', '经验不限，有餐饮、奶茶或便利店经历优先。'],
        employeeBenefits: ['包餐', '绩效奖金', '晋升通道', '调休', '节日福利'],
        recruiterStats: { responseTime: '3分钟内回复', replyRate: '今日回复10+次', todayReplies: '回复率高' },
        publishNote: '该职位3日内发布',
    },
    '安保': {
        companyIndustry: '安保/社区服务',
        companyStage: '项目外包',
        salaryDetail: { socialInsurance: '五险', bonusSubsidies: ['住宿补贴', '夜班补助', '全勤奖'], note: '固定项目按月结算，夜班补助随当月排班发放。' },
        responsibilities: ['负责门岗登记、巡逻、监控室值守和突发情况上报。', '维护小区或园区出入秩序，协助处理访客和快递车辆。'],
        requirementDetails: ['守时，能接受轮班和夜班。', '无经验可培训，有安保、物业或客服经验优先。'],
        employeeBenefits: ['住宿补贴', '夜班补助', '五险', '全勤奖', '稳定排班'],
        recruiterStats: { responseTime: '15分钟内回复', replyRate: '回复率较高', todayReplies: '今日回复5次' },
        publishNote: '该职位7日内发布',
    },
    '技术': {
        companyIndustry: '计算机软件',
        companyStage: '成长型团队',
        salaryDetail: { socialInsurance: '五险一金', bonusSubsidies: ['项目奖金', '年终奖', '餐补'], note: '薪资按能力定级，试用期不打折。' },
        responsibilities: ['负责 Web 产品页面、后台工具和组件的开发维护。', '与产品、设计和后端协作，处理需求评审、联调和线上问题。', '持续优化性能、可维护性和用户体验。'],
        requirementDetails: ['熟悉 React、TypeScript 和常见工程化流程。', '有完整项目经验，能说明遇到的问题和解决方式。', '重视代码质量，能接受需求变化和阶段性加班。'],
        employeeBenefits: ['五险一金', '双休', '项目奖金', '年终奖', '弹性上班'],
        recruiterStats: { responseTime: '1小时内回复', replyRate: '回复率高', todayReplies: '今日回复8次' },
        publishNote: '该职位本周活跃',
    },
    '设计': {
        companyIndustry: '广告/创意设计',
        companyStage: '创意工作室',
        salaryDetail: { socialInsurance: '五险一金', bonusSubsidies: ['项目奖金', '加班餐补', '作品奖金'], note: '根据作品集和试稿表现确定薪资档位。' },
        responsibilities: ['负责品牌物料、活动海报、页面视觉和日常设计支持。', '跟进需求沟通、改稿反馈和素材归档。', '协助建立可复用的视觉组件和模板。'],
        requirementDetails: ['需要提供作品集，审美稳定，能理解需求目标。', '熟悉 Figma、PS 或同类设计工具。', '能接受合理改稿，沟通反馈清晰。'],
        employeeBenefits: ['五险一金', '弹性工作', '项目奖金', '下午茶', '作品署名'],
        recruiterStats: { responseTime: '30分钟内回复', replyRate: '回复率中高', todayReplies: '今日回复4次' },
        publishNote: '该职位7日内发布',
    },
    '文职': {
        companyIndustry: '商贸/行政服务',
        companyStage: '稳定经营',
        salaryDetail: { socialInsurance: '五险一金', bonusSubsidies: ['全勤奖', '年终奖', '下午茶'], note: '固定底薪为主，少量绩效与出勤挂钩。' },
        responsibilities: ['负责资料整理、报销登记、会议通知和日常行政支持。', '维护表格台账，协助对接供应商、快递和办公用品采购。'],
        requirementDetails: ['细心，熟悉基础办公软件，能按流程推进事务。', '经验不限，能稳定到岗、沟通礼貌即可投递。'],
        employeeBenefits: ['五险一金', '双休', '全勤奖', '年终奖', '下午茶'],
        recruiterStats: { responseTime: '5分钟内回复', replyRate: '今日回复10+次', todayReplies: '回复率高' },
        publishNote: '该职位3日内发布',
    },
    '销售': {
        companyIndustry: '家装/本地生活',
        companyStage: '区域直营网点',
        salaryDetail: { socialInsurance: '五险', bonusSubsidies: ['高提成', '开单奖', '交通补贴'], note: '底薪加提成，收入随线索转化波动。' },
        responsibilities: ['跟进门店和线上线索，介绍方案、报价和活动政策。', '维护客户关系，协助量房、签约和售后沟通。'],
        requirementDetails: ['表达清楚，愿意主动沟通，能接受业绩目标。', '无经验可培训，有销售、客服或家装经验优先。'],
        employeeBenefits: ['五险', '高提成', '开单奖', '交通补贴', '带薪培训'],
        recruiterStats: { responseTime: '刚刚活跃', replyRate: '回复率高', todayReplies: '今日回复12次' },
        publishNote: '该职位今日活跃',
    },
    '教育': {
        companyIndustry: '教育培训/托辅',
        companyStage: '社区校区',
        salaryDetail: { socialInsurance: '灵活结算', bonusSubsidies: ['课时费', '续班奖励', '交通补贴'], note: '按课时或班次结算，临时取消会提前通知。' },
        responsibilities: ['辅导学生完成作业、复习基础知识和整理错题。', '记录学生表现，按要求向家长或校区负责人反馈。'],
        requirementDetails: ['有耐心，表达清楚，基础学科掌握扎实。', '能固定晚间或周末时段优先。'],
        employeeBenefits: ['日结/周结', '课时奖励', '短时排班', '交通补贴', '带教培训'],
        recruiterStats: { responseTime: '20分钟内回复', replyRate: '回复率中高', todayReplies: '今日回复3次' },
        publishNote: '该职位本周活跃',
    },
    '医疗辅助': {
        companyIndustry: '健康服务/陪诊',
        companyStage: '本地服务团队',
        salaryDetail: { socialInsurance: '灵活结算', bonusSubsidies: ['服务奖励', '交通补贴', '好评奖'], note: '按单或按天结算，复杂订单会提前确认补贴。' },
        responsibilities: ['陪同用户挂号、检查、缴费、取药并整理流程提醒。', '帮助用户记录注意事项，必要时联系家属或客服。'],
        requirementDetails: ['熟悉医院基础流程，细心、耐心，能处理焦虑沟通。', '可接受预约制排班，守时可靠。'],
        employeeBenefits: ['日结', '交通补贴', '好评奖励', '弹性接单', '流程培训'],
        recruiterStats: { responseTime: '30分钟内回复', replyRate: '回复率中高', todayReplies: '今日回复4次' },
        publishNote: '该职位7日内发布',
    },
    '物流': {
        companyIndustry: '物流/即时配送',
        companyStage: '站点直营',
        salaryDetail: { socialInsurance: '商业险', bonusSubsidies: ['高峰补贴', '天气补贴', '冲单奖励'], note: '多劳多得，恶劣天气和高峰时段另有补贴。' },
        responsibilities: ['按系统派单完成取货、配送和异常上报。', '维护配送工具，保证餐品或包裹准时送达。'],
        requirementDetails: ['路线熟悉，体力较好，能接受天气和高峰压力。', '需自备或租用合规交通工具，注意安全。'],
        employeeBenefits: ['日结', '高峰补贴', '天气补贴', '商业险', '接单自由'],
        recruiterStats: { responseTime: '刚刚活跃', replyRate: '今日回复10+次', todayReplies: '回复率高' },
        publishNote: '该职位今日活跃',
    },
    '自由职业': {
        companyIndustry: '内容/运营服务',
        companyStage: '项目制团队',
        salaryDetail: { socialInsurance: '项目结算', bonusSubsidies: ['项目奖金', '爆款奖励', '夜班补贴'], note: '按项目、天或单量结算，收益波动较大。' },
        responsibilities: ['协助内容选题、素材整理、剪辑发布和数据复盘。', '根据项目目标跟进排期，及时同步进度和风险。'],
        requirementDetails: ['有案例或作品优先，能独立推进小任务。', '接受项目制节奏，能提前沟通可用时间。'],
        employeeBenefits: ['日结/项目结', '远程协作', '项目奖金', '弹性排期', '爆款奖励'],
        recruiterStats: { responseTime: '1小时内回复', replyRate: '回复率中等', todayReplies: '今日回复2次' },
        publishNote: '该职位本周活跃',
    },
    '兼职': {
        companyIndustry: '兼职/灵活用工',
        companyStage: '本地合作商户',
        salaryDetail: { socialInsurance: '灵活结算', bonusSubsidies: ['日结', '班次补贴', '临时加班费'], note: '具体班次和结算方式以沟通确认后为准。' },
        responsibilities: ['按班次完成门店、活动或临时项目的基础工作。', '到岗后听从现场负责人安排，完成签到和交接。'],
        requirementDetails: ['时间匹配，能按约定到岗，不临时爽约。', '经验不限，提前确认地点、时长和结算。'],
        employeeBenefits: ['日结优先', '短期班次', '排班灵活', '临时补贴', '就近安排'],
        recruiterStats: { responseTime: '刚刚活跃', replyRate: '回复率高', todayReplies: '今日回复9次' },
        publishNote: '该职位今日活跃',
    },
    '快招专区': {
        companyIndustry: '灵活用工/门店外包',
        companyStage: '资料待补充',
        salaryDetail: { socialInsurance: '沟通后确认', bonusSubsidies: ['高薪空间', '绩效另算'], note: '薪资、物料、培训、试岗和结算口径写得比较松，沟通时要落到文字里。' },
        responsibilities: ['招聘描述把轻松高薪写得很满，实际任务、排班和结算口径需要再确认。', '到岗前可能先谈物料、培训或试岗安排，别只听口头一句话。'],
        requirementDetails: ['费用名目、试岗计薪、合同主体和到账时间都要落到文字里。', '联系人催得急或地址说法变来变去时，先停一停再推进。'],
        employeeBenefits: ['入职很快', '高薪空间', '短期可谈'],
        recruiterStats: { responseTime: '回复很快', replyRate: '信息待确认', todayReplies: '催到岗较多' },
        publishNote: '该职位细节待确认',
    },
};

function enrichJobPosting(job: BankJobPosting): BankJobPosting {
    const preset = {
        ...(JOB_DETAIL_PRESETS[job.category] || JOB_DETAIL_PRESETS['服务业']),
        ...(JOB_REALISTIC_DETAIL_PRESETS[job.category] || JOB_REALISTIC_DETAIL_PRESETS['服务业']),
    };
    const salaryDetail = {
        ...preset.salaryDetail,
        baseSalary: preset.salaryDetail?.baseSalary ?? (job.payCycle === 'monthly' ? Math.round(job.salaryMin * 0.72) : undefined),
        bonusSubsidies: Array.from(new Set([...(preset.salaryDetail?.bonusSubsidies || []), ...job.benefits])).slice(0, 6),
    };
    const tags = Array.from(new Set([
        ...(preset.tags || []),
        ...job.requirements,
        ...job.benefits,
        ...(preset.employeeBenefits || []),
    ])).slice(0, 8);
    return {
        ...job,
        ...preset,
        salaryDetail,
        tags,
        bossName: job.black ? '陈专员' : `${job.employer.slice(0, 1)}主管`,
        companyIntro: `${job.employer} 是${preset.companyIndustry || job.category}方向的招聘方，当前招聘「${job.title}」。岗位主要看重${job.requirements.join('、')}，${job.description}`,
    };
}

export const JOB_POSTINGS: BankJobPosting[] = RAW_JOB_POSTINGS.map(enrichJobPosting);

export const BUSINESS_TEMPLATES: BankBusinessTemplate[] = [
    {
        id: 'drinks',
        name: '饮品店',
        icon: '🥤',
        startupCost: 10000,
        vibe: '早晚高峰客流稳定，靠新品和口碑拉复购。',
        customerGroups: ['上班族', '学生', '散步邻居'],
        margin: 0.58,
        risk: 2,
        products: [
            { id: 'drink-americano', name: '冰美式', price: 18, cost: 7, appeal: 18 },
            { id: 'drink-latte', name: '燕麦拿铁', price: 24, cost: 10, appeal: 24 },
            { id: 'drink-fruit-tea', name: '满杯水果茶', price: 22, cost: 9, appeal: 22 },
        ],
        events: ['附近写字楼加班多，晚间订单变密。', '新品试饮被路过学生夸了几句。'],
    },
    {
        id: 'snack',
        name: '小吃摊',
        icon: '🍢',
        startupCost: 7000,
        vibe: '翻台快、现金流轻，天气和位置很影响生意。',
        customerGroups: ['夜宵客', '通勤人群', '附近摊主'],
        margin: 0.62,
        risk: 3,
        products: [
            { id: 'snack-skewer', name: '招牌烤串', price: 12, cost: 4, appeal: 18 },
            { id: 'snack-noodle', name: '热拌小面', price: 16, cost: 6, appeal: 20 },
            { id: 'snack-box', name: '夜宵拼盒', price: 29, cost: 12, appeal: 28 },
        ],
        events: ['夜市人流忽然变大，备货压力上来。', '隔壁摊主推荐了一个便宜进货渠道。'],
    },
    {
        id: 'convenience',
        name: '便利店',
        icon: '🏪',
        startupCost: 22000,
        vibe: '品类多、复购稳，库存管理决定利润。',
        customerGroups: ['社区居民', '夜班族', '快递员'],
        margin: 0.35,
        risk: 2,
        products: [
            { id: 'cv-bento', name: '热便当', price: 19, cost: 11, appeal: 20 },
            { id: 'cv-drink', name: '冷柜饮料', price: 8, cost: 4, appeal: 10 },
            { id: 'cv-bundle', name: '加班补给包', price: 32, cost: 18, appeal: 26 },
        ],
        events: ['社区团购临时缺货，店里的日用品被多买了几单。', '冷柜维护让今天成本高了一点。'],
    },
    {
        id: 'flower',
        name: '花店',
        icon: '🌷',
        startupCost: 14000,
        vibe: '客单价漂亮，节日波动明显，审美和损耗都重要。',
        customerGroups: ['情侣', '办公室', '探病客'],
        margin: 0.55,
        risk: 3,
        products: [
            { id: 'fl-bouquet', name: '晨雾花束', price: 88, cost: 38, appeal: 32 },
            { id: 'fl-mini', name: '桌面小花', price: 36, cost: 16, appeal: 18 },
            { id: 'fl-card', name: '手写花卡', price: 12, cost: 2, appeal: 10 },
        ],
        events: ['有人订了临时花束，愿意加急。', '一批鲜花状态一般，需要快点卖掉。'],
    },
    {
        id: 'dessert',
        name: '甜品店',
        icon: '🍰',
        startupCost: 16000,
        vibe: '靠颜值和口味出圈，研发新品能抬高客单。',
        customerGroups: ['闺蜜聚会', '打卡客', '亲子客'],
        margin: 0.5,
        risk: 3,
        products: [
            { id: 'ds-roll', name: '奶油卷', price: 28, cost: 12, appeal: 26 },
            { id: 'ds-pudding', name: '焦糖布丁', price: 18, cost: 7, appeal: 18 },
            { id: 'ds-set', name: '下午茶双人组', price: 68, cost: 31, appeal: 36 },
        ],
        events: ['打卡照片被转发，午后客流增加。', '奶油到货晚了，备货节奏被打乱。'],
    },
    {
        id: 'pet',
        name: '宠物用品',
        icon: '🐾',
        startupCost: 15000,
        vibe: '复购强，熟客会带来稳定口碑。',
        customerGroups: ['养宠家庭', '救助志愿者', '新手铲屎官'],
        margin: 0.42,
        risk: 2,
        products: [
            { id: 'pet-food', name: '试吃粮包', price: 29, cost: 16, appeal: 18 },
            { id: 'pet-toy', name: '逗猫小玩具', price: 22, cost: 9, appeal: 20 },
            { id: 'pet-care', name: '清洁护理套装', price: 58, cost: 29, appeal: 28 },
        ],
        events: ['附近宠物群有人推荐了你的店。', '有顾客询问长期订购折扣。'],
    },
    {
        id: 'stationery',
        name: '文具杂货',
        icon: '✒️',
        startupCost: 8000,
        vibe: '单价不高但很有氛围，靠选品和陈列打动人。',
        customerGroups: ['学生', '手账爱好者', '办公室'],
        margin: 0.48,
        risk: 2,
        products: [
            { id: 'st-pen', name: '顺滑中性笔', price: 6, cost: 2, appeal: 8 },
            { id: 'st-note', name: '方格本', price: 18, cost: 8, appeal: 18 },
            { id: 'st-box', name: '开学文具包', price: 49, cost: 24, appeal: 30 },
        ],
        events: ['开学季临近，文具套装被多看了几眼。', '有人想寄售自己的手写卡片。'],
    },
    {
        id: 'secondhand',
        name: '二手小铺',
        icon: '🧺',
        startupCost: 9000,
        vibe: '淘货感强，进价低但成色和故事决定成交。',
        customerGroups: ['学生党', '复古爱好者', '邻里熟客'],
        margin: 0.64,
        risk: 4,
        products: [
            { id: 'sh-book', name: '旧书盲盒', price: 25, cost: 8, appeal: 20 },
            { id: 'sh-lamp', name: '复古台灯', price: 79, cost: 34, appeal: 30 },
            { id: 'sh-cloth', name: '干净外套', price: 58, cost: 20, appeal: 24 },
        ],
        events: ['收到一批成色不错的小物件。', '有顾客压价很狠，需要判断要不要成交。'],
    },
    {
        id: 'handmade',
        name: '手作店',
        icon: '🧶',
        startupCost: 12000,
        vibe: '制作慢、毛利高，订单排期和口碑很关键。',
        customerGroups: ['礼物买家', '手作同好', '定制客户'],
        margin: 0.68,
        risk: 4,
        products: [
            { id: 'hm-keychain', name: '毛线挂件', price: 36, cost: 10, appeal: 22 },
            { id: 'hm-ring', name: '串珠戒指', price: 28, cost: 8, appeal: 18 },
            { id: 'hm-custom', name: '定制礼物盒', price: 128, cost: 42, appeal: 40 },
        ],
        events: ['有人想加急定制，愿意多付一点。', '手作材料缺了一个颜色。'],
    },
    {
        id: 'online',
        name: '线上小店',
        icon: '📦',
        startupCost: 9000,
        vibe: '不吃地段，吃选品、流量和售后。',
        customerGroups: ['网购用户', '粉丝客群', '回购客户'],
        margin: 0.46,
        risk: 3,
        products: [
            { id: 'on-case', name: '手机壳', price: 39, cost: 16, appeal: 18 },
            { id: 'on-bag', name: '通勤帆布袋', price: 59, cost: 26, appeal: 24 },
            { id: 'on-set', name: '主题小礼包', price: 99, cost: 45, appeal: 34 },
        ],
        events: ['平台给了短暂曝光，咨询量上来了。', '物流慢了一点，售后消息变多。'],
    },
];

export const COMPANY_DIRECTIONS = ['餐饮品牌', '软件工作室', '设计工作室', 'MCN', '自媒体公司', '便利店', '小型贸易', '咨询服务'];

function buildStockHistory(symbol: string, basePrice: number, risk: number, endDate = todayStr(), days = 36): NonNullable<BankStockQuote['history']> {
    let close = basePrice;
    const history: NonNullable<BankStockQuote['history']> = [];
    for (let i = days - 1; i >= 0; i--) {
        const dateStr = addDays(endDate, -i);
        const noise = seededNoise(`${symbol}:hist:${dateStr}`);
        const pct = clamp((noise - 0.5) * (0.018 + risk * 0.01), -0.09, 0.09);
        const open = roundMoney(close * (1 + (seededNoise(`${symbol}:open:${dateStr}`) - 0.5) * 0.012));
        close = Math.max(1, roundMoney(close * (1 + pct)));
        const high = roundMoney(Math.max(open, close) * (1 + 0.006 + seededNoise(`${symbol}:high:${dateStr}`) * 0.024));
        const low = roundMoney(Math.max(0.5, Math.min(open, close) * (1 - 0.006 - seededNoise(`${symbol}:low:${dateStr}`) * 0.024)));
        const volume = Math.round((70000 + seededNoise(`${symbol}:vol:${dateStr}`) * 260000) * (1 + risk * 0.18));
        history.push({ dateStr, open, high, low, close, volume });
    }
    return history;
}

function buildIntraday(symbol: string, price: number, dateStr = todayStr(), risk = 3): NonNullable<BankStockQuote['intraday']> {
    const times = ['09:30', '10:00', '10:30', '11:00', '11:30', '13:30', '14:00', '14:30', '15:00'];
    let p = price;
    return times.map(time => {
        const noise = seededNoise(`${symbol}:tick:${dateStr}:${time}`) - 0.5;
        p = Math.max(1, roundMoney(p * (1 + noise * (0.006 + risk * 0.003))));
        return { time, price: p, volume: Math.round(5000 + seededNoise(`${symbol}:tickvol:${dateStr}:${time}`) * 36000) };
    });
}

function withMarketDetail(q: Omit<BankStockQuote, 'history' | 'intraday' | 'eventTags'> & { eventTags?: string[] }): BankStockQuote {
    const history = buildStockHistory(q.symbol, q.price, q.risk);
    const last = history[history.length - 1];
    return ensureQuoteDetail({ ...q, price: last.close, previousPrice: history[history.length - 2]?.close || q.previousPrice, history, intraday: buildIntraday(q.symbol, last.close, last.dateStr, q.risk), eventTags: q.eventTags || [] }, last.dateStr);
}

function ensureQuoteDetail(q: BankStockQuote, dateStr: string): BankStockQuote {
    const history = q.history?.length ? q.history : buildStockHistory(q.symbol, q.price, q.risk, dateStr);
    const last = history[history.length - 1];
    const prev = history[history.length - 2];
    const price = last?.close || q.price;
    const previousPrice = prev?.close || q.previousPrice || price;
    return {
        ...q,
        open: last?.open || q.open || price,
        high: last?.high || q.high || price,
        low: last?.low || q.low || price,
        price,
        previousPrice,
        changePct: previousPrice ? Math.round(((price - previousPrice) / previousPrice) * 10000) / 100 : q.changePct,
        marketCap: q.marketCap || Math.round(price * (80 + q.risk * 35) * 1000000),
        pe: q.pe || roundMoney(12 + q.risk * 5 + seededNoise(`${q.symbol}:pe:${dateStr}`) * 18),
        turnoverRate: q.turnoverRate || roundMoney(1.2 + q.risk * 0.65 + seededNoise(`${q.symbol}:turn:${dateStr}`) * 3.2),
        bidAsk: q.bidAsk || { bid: roundMoney(price * 0.998), ask: roundMoney(price * 1.002), bidVolume: Math.round(800 + seededNoise(`${q.symbol}:bid:${dateStr}`) * 4600), askVolume: Math.round(800 + seededNoise(`${q.symbol}:ask:${dateStr}`) * 4600) },
        newsList: q.newsList || [
            { id: `${q.symbol}-${dateStr}-news`, title: q.news, source: 'Moro 财经', dateStr, tone: q.trend === 'down' ? 'warn' : q.trend === 'up' ? 'good' : 'info' },
        ],
        history,
        intraday: q.intraday?.length ? q.intraday : buildIntraday(q.symbol, price, dateStr, q.risk),
        eventTags: q.eventTags || [],
    };
}

const BASE_STOCKS: BankStockQuote[] = [
    withMarketDetail({ symbol: 'MORO', name: '墨洛科技', industry: 'AI应用', price: 42.8, previousPrice: 42.8, changePct: 0, trend: 'flat', risk: 4, news: '新产品预约人数增加，市场情绪偏热。', eventTags: ['AI', '成长'] }),
    withMarketDetail({ symbol: 'CAFE', name: '街角餐饮', industry: '消费', price: 18.6, previousPrice: 18.6, changePct: 0, trend: 'flat', risk: 2, news: '门店上新带动客流，走势稳中有升。', eventTags: ['消费', '连锁'] }),
    withMarketDetail({ symbol: 'CURE', name: '暖灯健康', industry: '医疗服务', price: 31.2, previousPrice: 31.2, changePct: 0, trend: 'flat', risk: 3, news: '社区服务订单增长，资金关注度提高。', eventTags: ['健康', '服务'] }),
    withMarketDetail({ symbol: 'BYTE', name: '字节小店', industry: '电商', price: 27.4, previousPrice: 27.4, changePct: 0, trend: 'flat', risk: 4, news: '平台补贴变化，短期波动加剧。', eventTags: ['电商', '流量'] }),
    withMarketDetail({ symbol: 'SAFE', name: '安宁物业', industry: '公共服务', price: 12.8, previousPrice: 12.8, changePct: 0, trend: 'flat', risk: 1, news: '现金流稳定，适合防守型仓位。', eventTags: ['稳健', '现金流'] }),
    withMarketDetail({ symbol: 'WIND', name: '晚风文娱', industry: '文娱', price: 9.9, previousPrice: 9.9, changePct: 0, trend: 'flat', risk: 5, news: '爆款内容传闻拉动关注，也更容易回撤。', eventTags: ['文娱', '高波动'] }),
];

export function createDefaultBankLifeState(dateStr = todayStr(), shopUnlocked = false): BankLifeState {
    const defaultBusiness = BUSINESS_TEMPLATES[0];
    const base: BankLifeState = {
        version: BANK_LIFE_VERSION,
        dateStr,
        dayIndex: 1,
        weekDay: weekDayOf(dateStr),
        season: seasonOf(dateStr),
        mood: 62,
        energy: 70,
        health: 88,
        dailyPlan: [],
        shopUnlocked,
        shopBusinessType: shopUnlocked ? defaultBusiness.id : undefined,
        shopBusinessName: shopUnlocked ? defaultBusiness.name : undefined,
        shopProducts: shopUnlocked ? defaultBusiness.products.map(p => ({ ...p, stock: 8 })) : [],
        shopCustomers: shopUnlocked ? defaultBusiness.customerGroups : [],
        shopEvents: [],
        jobHistory: [],
        pendingWages: [],
        fatigue: 0,
        reputation: 50,
        experience: {},
        stockMarket: BASE_STOCKS.map(s => ensureQuoteDetail({ ...s }, dateStr)),
        holdings: {},
        watchlist: ['MORO', 'CAFE'],
        loans: [],
        events: [{ id: genId('life'), dateStr, title: '人生拟启动', detail: '你的虚拟人生账本翻开了第一页。', tone: 'info' }],
        actionHistory: [],
        aiEvents: [],
        resume: defaultResume(dateStr),
        jobSearchSessions: [],
        aiJobPostings: [],
        marketPulses: [],
        creditProfile: defaultCreditProfile(dateStr),
        aiLastGeneratedAt: {},
    };
    return { ...base, dailyPlan: buildDailyPlan(base) };
}

export type BankShopDailyRewardKind = 'headquartersPatrol' | 'shelf' | 'review' | 'idleBonus';

export function getBankBusinessTemplate(businessTypeId?: string): BankBusinessTemplate {
    return BUSINESS_TEMPLATES.find(b => b.id === businessTypeId) || BUSINESS_TEMPLATES[0];
}

export function getBankShopStartupCost(businessTypeId?: string): number {
    return getBankBusinessTemplate(businessTypeId).startupCost;
}

export function createDefaultBankShopState(shopName = '我的小店'): BankShopState {
    return {
        actionPoints: 100,
        shopName,
        shopLevel: 1,
        appeal: 100,
        background: '',
        staff: [createDefaultSystemStaff()],
        unlockedRecipes: [DEFAULT_SHOP_RECIPE_ID],
        stock: { [DEFAULT_SHOP_RECIPE_ID]: DEFAULT_SHOP_RECIPE_STOCK },
        activeVisitor: undefined,
        guestbook: [],
        reviews: [],
        regulars: {},
        pendingRevenue: 0,
        totalRevenue: 0,
        lastAccrualAt: Date.now(),
        isBusinessOpen: false,
    };
}

function normalizeBankShopState(shop: Partial<BankShopState> | undefined, shopName: string): BankShopState {
    const base = createDefaultBankShopState(shopName);
    const unlockedRecipes = (shop?.unlockedRecipes?.length ? shop.unlockedRecipes : base.unlockedRecipes).filter(Boolean);
    const stock = { ...base.stock, ...(shop?.stock || {}) };
    for (const id of unlockedRecipes) {
        if (stock[id] === undefined) stock[id] = DEFAULT_SHOP_RECIPE_STOCK;
    }
    return {
        ...base,
        ...(shop || {}),
        shopName: (shop?.shopName || shopName || base.shopName).trim() || base.shopName,
        actionPoints: Math.max(0, Math.floor(shop?.actionPoints ?? base.actionPoints)),
        shopLevel: Math.max(1, Math.floor(shop?.shopLevel ?? base.shopLevel)),
        appeal: Math.max(0, Math.floor(shop?.appeal ?? base.appeal)),
        staff: shop?.staff?.length ? shop.staff : base.staff,
        unlockedRecipes,
        stock,
        guestbook: shop?.guestbook || [],
        reviews: shop?.reviews || [],
        regulars: shop?.regulars || {},
        pendingRevenue: Math.max(0, shop?.pendingRevenue || 0),
        totalRevenue: Math.max(0, shop?.totalRevenue || 0),
        openedBusinessDateStr: shop?.isBusinessOpen === true && typeof shop?.openedBusinessDateStr === 'string'
            ? normalizeBusinessDateStr(shop.openedBusinessDateStr)
            : undefined,
        lastBusinessDateStr: typeof shop?.lastBusinessDateStr === 'string'
            ? normalizeBusinessDateStr(shop.lastBusinessDateStr)
            : undefined,
        isBusinessOpen: shop?.isBusinessOpen === true,
    };
}

export function getDefaultBankBranchName(businessTypeId: string, branches: BankShopBranch[] = []): string {
    const tpl = getBankBusinessTemplate(businessTypeId);
    const sameTypeCount = branches.filter(b => b.businessTypeId === tpl.id).length;
    return sameTypeCount <= 0 ? tpl.name : `${tpl.name} ${sameTypeCount + 1}号店`;
}

export function createBankShopBranch(
    businessTypeId: string,
    shopName?: string,
    dateStr = todayStr(),
    overrides: Partial<BankShopBranch> = {}
): BankShopBranch {
    const tpl = getBankBusinessTemplate(businessTypeId);
    const name = (shopName || '').trim() || tpl.name;
    const shop = normalizeBankShopState(overrides.shop, name);
    return {
        id: overrides.id || genId('shop'),
        businessTypeId: tpl.id,
        businessName: tpl.name,
        openedAt: overrides.openedAt || dateStr,
        shop,
        firedStaff: overrides.firedStaff || [],
        shopProducts: overrides.shopProducts?.length ? overrides.shopProducts : buildShopProducts(tpl.id),
        shopCustomers: overrides.shopCustomers?.length ? overrides.shopCustomers : tpl.customerGroups,
        shopEvents: overrides.shopEvents || [],
    };
}

function hasLegacyShopProgress(state: BankFullState): boolean {
    return !!(
        state.life?.shopUnlocked ||
        state.shop?.lastBusinessAt ||
        state.shop?.totalRevenue ||
        (state.shop?.reviews?.length || 0) > 0 ||
        (state.shop?.regulars && Object.keys(state.shop.regulars).length > 0) ||
        (state.shop?.unlockedRecipes?.length || 0) > 1
    );
}

function normalizeDailyRewards(rewards: BankShopDailyRewards | undefined, dateStr: string): BankShopDailyRewards {
    if (!rewards || rewards.dateStr !== dateStr) {
        return {
            dateStr,
            headquartersPatrol: false,
            shelfByShopId: {},
            reviewByShopId: {},
            idleBonusByShopId: {},
        };
    }
    return {
        dateStr,
        headquartersPatrol: !!rewards.headquartersPatrol,
        shelfByShopId: rewards.shelfByShopId || {},
        reviewByShopId: rewards.reviewByShopId || {},
        idleBonusByShopId: rewards.idleBonusByShopId || {},
    };
}

function normalizePortfolio(portfolio: BankShopPortfolioState | undefined, dateStr: string): BankShopPortfolioState {
    const branches = (portfolio?.branches || []).map((branch, index) => createBankShopBranch(
        branch.businessTypeId || 'drinks',
        branch.shop?.shopName || branch.businessName,
        branch.openedAt || dateStr,
        {
            ...branch,
            id: branch.id || `shop-${index + 1}`,
            shop: branch.shop,
            firedStaff: branch.firedStaff || [],
            shopProducts: branch.shopProducts || [],
            shopCustomers: branch.shopCustomers || [],
            shopEvents: branch.shopEvents || [],
        }
    ));
    const activeShopId = branches.some(b => b.id === portfolio?.activeShopId)
        ? portfolio!.activeShopId
        : (branches[0]?.id || '');
    return {
        activeShopId,
        headquartersEnergy: Math.max(0, Math.floor(portfolio?.headquartersEnergy ?? INITIAL_HEADQUARTERS_ENERGY)),
        branches,
        dailyRewards: normalizeDailyRewards(portfolio?.dailyRewards, dateStr),
    };
}

export function getActiveShopBranch(state: BankFullState): BankShopBranch | undefined {
    const portfolio = state.shopPortfolio;
    if (!portfolio?.branches?.length) return undefined;
    return portfolio.branches.find(b => b.id === portfolio.activeShopId) || portfolio.branches[0];
}

export function syncActiveShopMirror(state: BankFullState): BankFullState {
    const dateStr = state.life?.dateStr || state.lastLoginDate || todayStr();
    const portfolio = normalizePortfolio(state.shopPortfolio, dateStr);
    const active = portfolio.branches.find(b => b.id === portfolio.activeShopId) || portfolio.branches[0];
    if (!active) {
        const life = state.life ? {
            ...state.life,
            shopUnlocked: false,
            shopBusinessType: undefined,
            shopBusinessName: undefined,
            shopProducts: [],
            shopCustomers: [],
            shopEvents: [],
        } : state.life;
        return {
            ...state,
            life: life ? { ...life, dailyPlan: buildDailyPlan(life) } : life,
            shopPortfolio: { ...portfolio, activeShopId: '' },
        };
    }
    const life = state.life || createDefaultBankLifeState(dateStr, true);
    const syncedLife: BankLifeState = {
        ...life,
        shopUnlocked: true,
        shopBusinessType: active.businessTypeId,
        shopBusinessName: active.shop.shopName || active.businessName,
        shopProducts: active.shopProducts,
        shopCustomers: active.shopCustomers,
        shopEvents: active.shopEvents,
    };
    return {
        ...state,
        shop: active.shop,
        firedStaff: active.firedStaff,
        life: { ...syncedLife, dailyPlan: buildDailyPlan(syncedLife) },
        shopPortfolio: portfolio,
    };
}

export function syncActiveBranchFromMirror(state: BankFullState): BankFullState {
    const dateStr = state.life?.dateStr || state.lastLoginDate || todayStr();
    const portfolio = normalizePortfolio(state.shopPortfolio, dateStr);
    const active = portfolio.branches.find(b => b.id === portfolio.activeShopId) || portfolio.branches[0];
    if (!active) return syncActiveShopMirror({ ...state, shopPortfolio: portfolio });
    const life = state.life || createDefaultBankLifeState(dateStr, true);
    const activeShopName = state.shop?.shopName || life.shopBusinessName || active.shop.shopName || active.businessName;
    const branches = portfolio.branches.map(branch => branch.id === active.id ? {
        ...branch,
        shop: normalizeBankShopState({ ...state.shop, shopName: activeShopName }, activeShopName),
        firedStaff: state.firedStaff || [],
        shopProducts: life.shopProducts || branch.shopProducts,
        shopCustomers: life.shopCustomers || branch.shopCustomers,
        shopEvents: life.shopEvents || branch.shopEvents,
    } : branch);
    return syncActiveShopMirror({
        ...state,
        shopPortfolio: { ...portfolio, branches },
    });
}

export function prepareBankStateForSave(state: BankFullState): BankFullState {
    if (!state.shopPortfolio?.branches?.length) {
        return syncActiveBranchFromMirror(migrateBankLifeState(state));
    }

    const mirrorShop = state.shop;
    const mirrorFiredStaff = state.firedStaff;
    const mirrorShopProducts = state.life?.shopProducts;
    const mirrorShopCustomers = state.life?.shopCustomers;
    const mirrorShopEvents = state.life?.shopEvents;
    const migrated = migrateBankLifeState(state);
    const life = migrated.life;

    return syncActiveBranchFromMirror({
        ...migrated,
        shop: mirrorShop || migrated.shop,
        firedStaff: mirrorFiredStaff || migrated.firedStaff,
        life: life ? {
            ...life,
            ...(mirrorShopProducts ? { shopProducts: mirrorShopProducts } : {}),
            ...(mirrorShopCustomers ? { shopCustomers: mirrorShopCustomers } : {}),
            ...(mirrorShopEvents ? { shopEvents: mirrorShopEvents } : {}),
        } : life,
    });
}

export function migrateBankShopPortfolioState(state: BankFullState): BankFullState {
    const dateStr = state.life?.dateStr || state.lastLoginDate || todayStr();
    if (state.shopPortfolio?.branches?.length) {
        return syncActiveShopMirror({
            ...state,
            shopPortfolio: normalizePortfolio(state.shopPortfolio, dateStr),
        });
    }

    if (!hasLegacyShopProgress(state)) {
        return syncActiveShopMirror({
            ...state,
            shopPortfolio: normalizePortfolio(state.shopPortfolio, dateStr),
        });
    }

    const businessTypeId = state.life?.shopBusinessType || 'drinks';
    const tpl = getBankBusinessTemplate(businessTypeId);
    const shopName = state.life?.shopBusinessName || state.shop?.shopName || tpl.name;
    const legacyBranch = createBankShopBranch(tpl.id, shopName, dateStr, {
        id: 'shop-main',
        openedAt: state.lastLoginDate || dateStr,
        shop: state.shop,
        firedStaff: state.firedStaff || [],
        shopProducts: state.life?.shopProducts?.length ? state.life.shopProducts : buildShopProducts(tpl.id),
        shopCustomers: state.life?.shopCustomers?.length ? state.life.shopCustomers : tpl.customerGroups,
        shopEvents: state.life?.shopEvents || [],
    });
    return syncActiveShopMirror({
        ...state,
        shopPortfolio: {
            activeShopId: legacyBranch.id,
            headquartersEnergy: Math.max(0, Math.floor(state.shopPortfolio?.headquartersEnergy ?? INITIAL_HEADQUARTERS_ENERGY)),
            branches: [legacyBranch],
            dailyRewards: normalizeDailyRewards(state.shopPortfolio?.dailyRewards, dateStr),
        },
    });
}

export function switchActiveBankShop(state: BankFullState, shopId: string): BankFullState {
    const withCurrentSaved = syncActiveBranchFromMirror(state);
    const portfolio = withCurrentSaved.shopPortfolio;
    if (!portfolio?.branches?.some(b => b.id === shopId)) return withCurrentSaved;
    return syncActiveShopMirror({
        ...withCurrentSaved,
        shopPortfolio: { ...portfolio, activeShopId: shopId },
    });
}

export function openBankShopBranch(
    state: BankFullState,
    businessTypeId: string,
    shopName?: string,
    options: { walletBalance?: number; dateStr?: string; headquartersEnergyCost?: number } = {}
): { ok: boolean; state: BankFullState; branch?: BankShopBranch; cost: number; energyCost: number; reason?: 'wallet' | 'energy'; actionResult?: BankShopActionResult } {
    const prepared = state.shopPortfolio?.branches?.length
        ? syncActiveBranchFromMirror(state)
        : migrateBankShopPortfolioState(state);
    const tpl = getBankBusinessTemplate(businessTypeId);
    const cost = tpl.startupCost;
    const energyCost = options.headquartersEnergyCost ?? BANK_OPEN_BRANCH_ENERGY_COST;
    if (typeof options.walletBalance === 'number' && options.walletBalance < cost) {
        return { ok: false, state: prepared, cost, energyCost, reason: 'wallet' };
    }
    const portfolio = normalizePortfolio(prepared.shopPortfolio, prepared.life?.dateStr || options.dateStr || todayStr());
    if ((portfolio.headquartersEnergy || 0) < energyCost) {
        return { ok: false, state: prepared, cost, energyCost, reason: 'energy' };
    }
    const dateStr = options.dateStr || prepared.life?.dateStr || todayStr();
    const name = (shopName || '').trim() || getDefaultBankBranchName(tpl.id, portfolio.branches);
    const branch = createBankShopBranch(tpl.id, name, dateStr, {
        shopEvents: [{ id: genId('life'), dateStr, title: '分店开张', detail: `${name} 开始营业，主打${tpl.name}。`, tone: 'good' }],
    });
    const actionResult: BankShopActionResult = {
        ...createBankActionResult({
            category: 'shop',
            kind: 'shop-branch-open',
            title: portfolio.branches.length ? '新分店开张' : '开店确认',
            summary: `${name} 已经完成开业准备，第一批货架会自动上架。`,
            tone: 'good',
            amount: -cost,
            metrics: [
                { label: '业态', value: tpl.name },
                { label: '启动金', value: `¥${cost}`, tone: 'warn' },
                { label: '总部精力', value: `-${energyCost}`, tone: 'warn' },
                { label: '初始商品', value: `${tpl.products.length} 种` },
            ],
            riskTags: tpl.risk >= 4 ? ['高波动客流'] : [],
            payload: { businessTypeId: tpl.id, shopName: name, branchId: branch.id, cost, energyCost },
        }),
        category: 'shop',
        productName: tpl.name,
    };
    const life = appendBankActionRecord({
        ...(prepared.life || createDefaultBankLifeState(dateStr, true)),
        events: pushEvent(prepared.life?.events || [], { dateStr, title: portfolio.branches.length ? '新分店开张' : '小店开张', detail: `${name} 开始营业，主打${tpl.name}。`, tone: 'good', amount: -cost }),
    }, actionResult);
    const next = syncActiveShopMirror({
        ...prepared,
        life,
        shopPortfolio: {
            ...portfolio,
            headquartersEnergy: portfolio.headquartersEnergy - energyCost,
            activeShopId: branch.id,
            branches: [...portfolio.branches, branch],
        },
    });
    return { ok: true, state: next, branch, cost, energyCost, actionResult };
}

export function claimBankShopDailyReward(
    state: BankFullState,
    kind: BankShopDailyRewardKind,
    options: { shopId?: string; dateStr?: string } = {}
): { claimed: boolean; state: BankFullState; amount: number; target: 'headquarters' | 'shop'; actionResult?: BankLifeActionResult } {
    const prepared = state.shopPortfolio?.branches?.length
        ? syncActiveBranchFromMirror(state)
        : migrateBankShopPortfolioState(state);
    const portfolio = normalizePortfolio(prepared.shopPortfolio, prepared.life?.dateStr || todayStr());
    const dateStr = options.dateStr || prepared.life?.dateStr || todayStr();
    const rewards = normalizeDailyRewards(portfolio.dailyRewards, dateStr);
    const active = portfolio.branches.find(b => b.id === (options.shopId || portfolio.activeShopId)) || portfolio.branches[0];
    const defs: Record<BankShopDailyRewardKind, { amount: number; title: string; summary: string; target: 'headquarters' | 'shop' }> = {
        headquartersPatrol: { amount: 25, title: '每日巡店完成', summary: '总部精力恢复了，今天可以继续规划开店和装修。', target: 'headquarters' },
        shelf: { amount: 18, title: '货架整理完成', summary: '当前店的经营精力恢复了，补货和员工安排更顺手。', target: 'shop' },
        review: { amount: 10, title: '营业复盘完成', summary: '当前店的经营精力恢复了，下一轮营业更稳。', target: 'shop' },
        idleBonus: { amount: 6, title: '闲置收益首领奖励', summary: '第一次收取今天的闲置收益，当前店精力小幅恢复。', target: 'shop' },
    };
    const def = defs[kind];
    if (!active && def.target === 'shop') return { claimed: false, state: prepared, amount: def.amount, target: def.target };

    const already = kind === 'headquartersPatrol'
        ? rewards.headquartersPatrol
        : kind === 'shelf'
            ? rewards.shelfByShopId?.[active!.id]
            : kind === 'review'
                ? rewards.reviewByShopId?.[active!.id]
                : rewards.idleBonusByShopId?.[active!.id];
    if (already) return { claimed: false, state: prepared, amount: def.amount, target: def.target };

    const actionResult = createBankActionResult({
        category: 'shop',
        kind: `daily-${kind}`,
        title: def.title,
        summary: def.summary,
        tone: 'good',
        metrics: [
            { label: def.target === 'headquarters' ? '总部精力' : '单店精力', value: `+${def.amount}`, tone: 'good' },
            ...(active ? [{ label: '店铺', value: active.shop.shopName }] : []),
        ],
        payload: { kind, shopId: active?.id, amount: def.amount, dateStr },
    });

    let nextRewards = rewards;
    if (kind === 'headquartersPatrol') {
        nextRewards = { ...nextRewards, headquartersPatrol: true };
    } else if (kind === 'shelf') {
        nextRewards = { ...nextRewards, shelfByShopId: { ...(nextRewards.shelfByShopId || {}), [active!.id]: true } };
    } else if (kind === 'review') {
        nextRewards = { ...nextRewards, reviewByShopId: { ...(nextRewards.reviewByShopId || {}), [active!.id]: true } };
    } else {
        nextRewards = { ...nextRewards, idleBonusByShopId: { ...(nextRewards.idleBonusByShopId || {}), [active!.id]: true } };
    }

    const branches = def.target === 'shop'
        ? portfolio.branches.map(branch => branch.id === active!.id ? { ...branch, shop: { ...branch.shop, actionPoints: (branch.shop.actionPoints || 0) + def.amount } } : branch)
        : portfolio.branches;
    const life = appendBankActionRecord(prepared.life || createDefaultBankLifeState(dateStr, !!branches.length), actionResult);
    const nextState = syncActiveShopMirror({
        ...prepared,
        life,
        shopPortfolio: {
            ...portfolio,
            headquartersEnergy: def.target === 'headquarters' ? portfolio.headquartersEnergy + def.amount : portfolio.headquartersEnergy,
            branches,
            dailyRewards: nextRewards,
        },
    });
    return { claimed: true, state: nextState, amount: def.amount, target: def.target, actionResult };
}

export function migrateBankLifeState(state: BankFullState): BankFullState {
    const hasOldShopProgress = hasLegacyShopProgress(state);
    const life = state.life
        ? {
            ...createDefaultBankLifeState(state.life.dateStr || state.lastLoginDate || todayStr(), state.life.shopUnlocked || hasOldShopProgress),
            ...state.life,
            version: BANK_LIFE_VERSION,
            shopUnlocked: !!(state.life.shopUnlocked || hasOldShopProgress),
            shopBusinessType: state.life.shopBusinessType || ((state.life.shopUnlocked || hasOldShopProgress) ? 'drinks' : undefined),
            shopBusinessName: state.life.shopBusinessName || ((state.life.shopUnlocked || hasOldShopProgress) ? (state.shop?.shopName || '饮品店') : undefined),
            shopProducts: state.life.shopProducts?.length ? state.life.shopProducts : ((state.life.shopUnlocked || hasOldShopProgress) ? buildShopProducts('drinks') : []),
            shopCustomers: state.life.shopCustomers?.length ? state.life.shopCustomers : ((state.life.shopUnlocked || hasOldShopProgress) ? (BUSINESS_TEMPLATES.find(b => b.id === 'drinks')?.customerGroups || []) : []),
            dayIndex: state.life.dayIndex || 1,
            weekDay: typeof state.life.weekDay === 'number' ? state.life.weekDay : weekDayOf(state.life.dateStr || state.lastLoginDate || todayStr()),
            season: state.life.season || seasonOf(state.life.dateStr || state.lastLoginDate || todayStr()),
            mood: state.life.mood ?? 62,
            energy: state.life.energy ?? 70,
            health: state.life.health ?? 88,
            shopEvents: state.life.shopEvents || [],
            jobHistory: (state.life.jobHistory || []).map(app => normalizeJobApplication(app, state.life?.dateStr || state.lastLoginDate || todayStr())),
            pendingWages: state.life.pendingWages || [],
            experience: state.life.experience || {},
            stockMarket: ensureMarketDetail(state.life.stockMarket?.length ? state.life.stockMarket : BASE_STOCKS, state.life.dateStr || state.lastLoginDate || todayStr()),
            holdings: state.life.holdings || {},
            watchlist: state.life.watchlist || ['MORO', 'CAFE'],
            loans: state.life.loans || [],
            events: state.life.events || [],
            actionHistory: state.life.actionHistory || [],
            aiEvents: state.life.aiEvents || [],
            resume: state.life.resume || defaultResume(state.life.dateStr || state.lastLoginDate || todayStr()),
            jobSearchSessions: state.life.jobSearchSessions || [],
            aiJobPostings: state.life.aiJobPostings || [],
            marketPulses: state.life.marketPulses || [],
            creditProfile: state.life.creditProfile || defaultCreditProfile(state.life.dateStr || state.lastLoginDate || todayStr()),
            aiLastGeneratedAt: state.life.aiLastGeneratedAt || {},
        }
        : createDefaultBankLifeState(state.lastLoginDate || todayStr(), hasOldShopProgress);
    return migrateBankShopPortfolioState({ ...state, life: { ...life, dailyPlan: buildDailyPlan(life) }, dataVersion: Math.max(state.dataVersion || 0, BANK_LIFE_VERSION) });
}

function buildShopProducts(businessTypeId: string) {
    const tpl = BUSINESS_TEMPLATES.find(b => b.id === businessTypeId) || BUSINESS_TEMPLATES[0];
    return tpl.products.map(p => ({ ...p, stock: 8 }));
}

export function openLifeShop(life: BankLifeState, businessTypeId: string, shopName: string): BankLifeState {
    const tpl = BUSINESS_TEMPLATES.find(b => b.id === businessTypeId) || BUSINESS_TEMPLATES[0];
    const name = shopName.trim() || tpl.name;
    const startupCost = tpl.startupCost;
    const result: BankShopActionResult = {
        ...createBankActionResult({
            category: 'shop',
            kind: 'shop-open',
            title: '开店确认',
            summary: `${name} 已经完成开业准备，第一批货架会自动上架。`,
            tone: 'good',
            amount: -startupCost,
            metrics: [
                { label: '业态', value: tpl.name },
                { label: '启动金', value: `¥${startupCost}`, tone: 'warn' },
                { label: '初始商品', value: `${tpl.products.length} 种` },
                { label: '风险', value: `${tpl.risk}/5`, tone: tpl.risk >= 4 ? 'warn' : 'info' },
            ],
            riskTags: tpl.risk >= 4 ? ['高波动客流'] : [],
            payload: { businessTypeId: tpl.id, shopName: name },
        }),
        category: 'shop',
        productName: tpl.name,
    };
    return appendBankActionRecord({
        ...life,
        shopUnlocked: true,
        shopBusinessType: tpl.id,
        shopBusinessName: name,
        shopProducts: buildShopProducts(tpl.id),
        shopCustomers: tpl.customerGroups,
        shopEvents: [{ id: genId('life'), dateStr: life.dateStr, title: '准备开张', detail: `${name} 的第一批货已经上架。`, tone: 'good' }],
        events: pushEvent(life.events, { dateStr: life.dateStr, title: '小店开张', detail: `${name} 开始营业，主打${tpl.name}。`, tone: 'good', amount: -startupCost }),
    }, result);
}

function ensureMarketDetail(market: BankStockQuote[], dateStr: string): BankStockQuote[] {
    return market.map(q => {
        const base = BASE_STOCKS.find(s => s.symbol === q.symbol);
        return ensureQuoteDetail({ ...(base || q), ...q, price: q.price || base?.price || 1, previousPrice: q.previousPrice || base?.previousPrice || q.price || 1, risk: q.risk || base?.risk || 3 }, dateStr);
    });
}

export function getJobsByCategory(category: string): BankJobPosting[] {
    if (!category || category === '全部') return JOB_POSTINGS;
    return JOB_POSTINGS.filter(j => j.category === category);
}

export const BANK_JOB_STAGE_LABELS: Record<BankJobApplicationStage, string> = {
    submitted: '已投递',
    screening: '简历筛选',
    recruiter_chat: 'HR 沟通',
    assessment: '测评 / 试岗',
    interview: '面试',
    negotiation: '薪资谈判',
    offer: 'Offer 确认',
    hired: '已入职',
    trial: '试用中',
    rejected: '未通过',
    scammed: '已中止',
    declined: '已放弃',
};

const TERMINAL_JOB_STAGES = new Set<BankJobApplicationStage>(['hired', 'trial', 'rejected', 'scammed', 'declined']);

const JOB_STAGE_FLOW: Record<BankJobApplicationStage, BankJobApplicationStage[]> = {
    submitted: ['screening', 'rejected'],
    screening: ['recruiter_chat', 'assessment', 'rejected', 'scammed'],
    recruiter_chat: ['assessment', 'rejected', 'scammed'],
    assessment: ['interview', 'rejected', 'scammed'],
    interview: ['negotiation', 'offer', 'trial', 'rejected', 'scammed'],
    negotiation: ['offer', 'hired', 'trial', 'rejected', 'declined'],
    offer: ['hired', 'trial', 'declined'],
    hired: [],
    trial: [],
    rejected: [],
    scammed: [],
    declined: [],
};

function isTerminalJobStage(stage?: BankJobApplicationStage): boolean {
    return !!stage && TERMINAL_JOB_STAGES.has(stage);
}

function statusForJobStage(stage: BankJobApplicationStage): BankJobApplicationStatus {
    if (stage === 'hired' || stage === 'trial' || stage === 'rejected' || stage === 'scammed' || stage === 'declined') return stage;
    return 'active';
}

function jobStageTone(stage: BankJobApplicationStage): BankJobStageResult['tone'] {
    if (stage === 'hired' || stage === 'trial' || stage === 'offer') return 'good';
    if (stage === 'rejected' || stage === 'declined' || stage === 'scammed') return stage === 'scammed' ? 'bad' : 'warn';
    if (stage === 'negotiation' || stage === 'assessment') return 'warn';
    return 'info';
}

function jobStageNextActionLabel(stage: BankJobApplicationStage): string | undefined {
    const labels: Partial<Record<BankJobApplicationStage, string>> = {
        submitted: '查看筛选结果',
        screening: '进入 HR 沟通',
        recruiter_chat: '提交沟通印象',
        assessment: '提交测评 / 试岗',
        interview: '提交面试回答',
        negotiation: '确认谈判结果',
        offer: '接受 Offer',
    };
    return labels[stage];
}

function findPostingForApplication(life: BankLifeState, app: BankJobApplication): BankJobPosting | undefined {
    return [app.postingSnapshot, ...(life.aiJobPostings || []), ...JOB_POSTINGS].find(j => j?.id === app.postingId);
}

function buildJobOfferTerms(posting: BankJobPosting, salary: number, aiDraft?: BankJobStageAiDraft): NonNullable<BankJobApplication['offerTerms']> {
    const raw = aiDraft?.offerTerms || {};
    const trialDays = typeof raw.trialDays === 'number'
        ? clamp(Math.round(raw.trialDays), 0, 30)
        : (posting.black ? 3 : 0);
    return {
        salary: clamp(Math.round(raw.salary || aiDraft?.offerSalary || salary), Math.max(80, posting.salaryMin), Math.max(posting.salaryMin, posting.salaryMax)),
        payCycle: raw.payCycle === 'daily' || raw.payCycle === 'monthly' ? raw.payCycle : posting.payCycle,
        payDay: posting.payCycle === 'monthly' ? clamp(Math.round(raw.payDay || posting.payDay || 10), 1, 28) : undefined,
        workTime: String(raw.workTime || posting.workTime || '排班制').slice(0, 40),
        trialDays,
        benefits: Array.from(new Set([...(Array.isArray(raw.benefits) ? raw.benefits.map(String) : []), ...posting.benefits])).slice(0, 6),
        risks: Array.from(new Set([...(Array.isArray(raw.risks) ? raw.risks.map(String) : []), ...posting.riskTags])).slice(0, 6),
        negotiable: raw.negotiable !== false && !posting.black,
    };
}

function buildJobTodos(stage: BankJobApplicationStage, posting?: BankJobPosting): BankJobStageTodo[] {
    const byStage: Partial<Record<BankJobApplicationStage, BankJobStageTodo[]>> = {
        submitted: [
            { id: 'resume-snapshot', kind: 'resume', label: '等简历进入筛选池', detail: '这次投递已保存当前简历快照。' },
        ],
        screening: [
            { id: 'read-requirements', kind: 'resume', label: '对照岗位要求', detail: posting?.requirements?.join('、') || '先确认岗位看重什么。' },
        ],
        recruiter_chat: [
            { id: 'reply-hr', kind: 'chat', label: '和 HR 说清期待', detail: '可问排班、薪资结构、试用期和结算方式。' },
            { id: 'watch-risk', kind: 'risk', label: '留意条款细节', detail: posting?.riskTags?.length ? posting.riskTags.join('、') : '费用、合同和结算都先问清。' },
        ],
        assessment: [
            { id: 'finish-assessment', kind: 'assessment', label: '完成测评或试岗', detail: '提交一段表现描述，系统会给出阶段反馈。' },
        ],
        interview: [
            { id: 'answer-interview', kind: 'interview', label: '回答面试问题', detail: '说明经验、稳定性和遇到问题时的处理方式。' },
        ],
        negotiation: [
            { id: 'negotiate-offer', kind: 'negotiation', label: '确认薪资和条款', detail: '可以谈薪资、发薪日、试用期和工作时间。' },
        ],
        offer: [
            { id: 'read-offer', kind: 'offer', label: '核对 Offer', detail: '确认薪资、结算周期、试用期和额外条款后再接受。' },
        ],
        hired: [{ id: 'done', kind: 'done', label: '明天开始计算收入', detail: '这份工作已经进入人生拟现金流。', done: true }],
        trial: [{ id: 'trial-watch', kind: 'risk', label: '盯紧试用条款', detail: '试用期里留意计薪、结算和转正口径。' }],
        rejected: [{ id: 'next-search', kind: 'done', label: '换个方向继续投', detail: '这次未通过，可以调整简历或岗位方向。', done: true }],
        scammed: [{ id: 'risk-review', kind: 'risk', label: '记下这次教训', detail: '把费用名目、聊天口径和到账日期记下来，下次先问清再排班。', done: true }],
        declined: [{ id: 'declined', kind: 'done', label: '已放弃这份机会', detail: '申请保留在历史里，便于回看。', done: true }],
    };
    return byStage[stage] || [];
}

function createJobStageResult(
    stage: BankJobApplicationStage,
    posting: BankJobPosting,
    summary: string,
    input?: {
        tone?: BankJobStageResult['tone'];
        highlights?: string[];
        balanceDelta?: number;
        scoreDelta?: number;
        riskFlags?: string[];
        nextActionLabel?: string;
    },
): BankJobStageResult {
    return {
        id: genId('jobstage'),
        stage,
        title: BANK_JOB_STAGE_LABELS[stage] || posting.title,
        summary,
        tone: input?.tone || jobStageTone(stage),
        highlights: (input?.highlights?.length ? input.highlights : [
            `${posting.employer} · ${posting.title}`,
            posting.payCycle === 'daily' ? '日结岗位' : `${posting.payDay || 10} 号发薪`,
        ]).slice(0, 5),
        nextActionLabel: input?.nextActionLabel || jobStageNextActionLabel(stage),
        balanceDelta: input?.balanceDelta,
        scoreDelta: input?.scoreDelta,
        riskFlags: input?.riskFlags?.slice(0, 6),
    };
}

function appendJobStageHistory(app: BankJobApplication, result: BankJobStageResult, life: BankLifeState): NonNullable<BankJobApplication['stageHistory']> {
    const entry = {
        id: result.id,
        stage: result.stage,
        title: result.title,
        detail: result.summary,
        at: `${life.dateStr} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
        tone: result.tone,
        score: app.score,
        balanceDelta: result.balanceDelta,
    };
    return [entry, ...(app.stageHistory || [])].slice(0, 40);
}

function normalizeJobApplication(app: BankJobApplication, fallbackDateStr: string): BankJobApplication {
    const stage = (app.stage || (app.status as BankJobApplicationStage) || 'submitted') as BankJobApplicationStage;
    const safeStage = BANK_JOB_STAGE_LABELS[stage] ? stage : 'submitted';
    const status = isTerminalJobStage(safeStage) ? statusForJobStage(safeStage) : 'active';
    const result = app.stageResult;
    return {
        ...app,
        stage: safeStage,
        status,
        score: typeof app.score === 'number' ? app.score : 0,
        stageHistory: app.stageHistory?.length ? app.stageHistory : [{
            id: genId('jobhist'),
            stage: safeStage,
            title: BANK_JOB_STAGE_LABELS[safeStage],
            detail: app.message || '求职进度已迁移。',
            at: app.dateStr || fallbackDateStr,
            tone: jobStageTone(safeStage),
            score: app.score || 0,
        }],
        todos: app.todos?.length ? app.todos : buildJobTodos(safeStage, app.postingSnapshot),
        stageResult: result,
        lastUpdatedAt: app.lastUpdatedAt || app.dateStr || fallbackDateStr,
    };
}

function buildInterviewQuestions(posting: BankJobPosting, seedKey: string): NonNullable<BankJobApplication['questions']> {
    const base = [
        `为什么想做「${posting.title}」？`,
        `遇到${posting.riskTags[0] || '高压情况'}时你会怎么处理？`,
        `你最能匹配这个岗位的经验是什么？`,
    ];
    if (posting.category === '技术') base[1] = '如果线上页面突然白屏，你会先检查什么？';
    if (posting.category === '餐饮') base[1] = '高峰期同时有三桌催单，你会怎么排优先级？';
    if (posting.category === '销售') base[1] = '客户只看不买时，你会怎么继续跟进？';
    if (posting.black) base[1] = '对方把费用、试岗和结算说得很快，你准备先确认哪几件事？';
    return base.map((question, idx) => ({
        id: `q-${idx + 1}`,
        question,
        score: Math.round(55 + seededNoise(`${seedKey}:q:${idx}`) * 35),
    }));
}

export function startJobApplication(life: BankLifeState, posting: BankJobPosting): { life: BankLifeState; application: BankJobApplication } {
    const at = `${life.dateStr} 09:00`;
    const result = createJobStageResult('submitted', posting, `简历已投给 ${posting.employer}，招聘方会先看岗位匹配度和基本要求。`, {
        highlights: [
            `岗位：${posting.title}`,
            `薪资：¥${posting.salaryMin}-${posting.salaryMax}${posting.payCycle === 'daily' ? '/天' : '/月'}`,
            `要求：${posting.requirements.slice(0, 3).join('、')}`,
        ],
    });
    const app: BankJobApplication = {
        id: genId('jobapp'),
        postingId: posting.id,
        title: posting.title,
        employer: posting.employer,
        status: 'active',
        stage: 'submitted',
        score: 0,
        dateStr: life.dateStr,
        questions: buildInterviewQuestions(posting, `${life.dateStr}:${posting.id}:${life.jobHistory.length}`),
        chatMessages: [
            { role: 'boss', content: `你好，我是${posting.employer}的${posting.bossName || posting.bossTitle || '招聘负责人'}，这边在招「${posting.title}」。可以先说下你的到岗时间、排班偏好和期望薪资，我也会把社保、结算和试用期讲清楚。`, at },
            { role: 'system', content: `${posting.location || '本市'} · ${posting.workTime || '排班制'} · ${posting.companySize || '规模未披露'} · ${posting.salaryDetail?.socialInsurance || (posting.payCycle === 'monthly' ? '五险一金' : '灵活结算')}`, at },
        ],
        resumeSnapshot: life.resume,
        postingSnapshot: posting,
        stageHistory: [{
            id: result.id,
            stage: 'submitted',
            title: result.title,
            detail: result.summary,
            at,
            tone: result.tone,
            score: 0,
        }],
        todos: buildJobTodos('submitted', posting),
        stageResult: result,
        lastUpdatedAt: at,
        message: `简历已投给 ${posting.employer}，等待筛选。`,
    };
    return {
        application: app,
        life: {
            ...life,
            jobHistory: [app, ...life.jobHistory].slice(0, 60),
            events: pushEvent(life.events, { dateStr: life.dateStr, title: '投出简历', detail: app.message, tone: 'info' }),
        },
    };
}

export function advanceJobApplicationStage(life: BankLifeState, applicationId: string, answer = '', walletBalance = 0): { life: BankLifeState; application?: BankJobApplication; balanceDelta: number } {
    return advanceJobApplicationStageWithAi(life, applicationId, answer, walletBalance);
}

export function advanceJobApplicationStageWithAi(life: BankLifeState, applicationId: string, answer = '', walletBalance = 0, aiDraft?: BankJobStageAiDraft): { life: BankLifeState; application?: BankJobApplication; balanceDelta: number } {
    const rawApp = life.jobHistory.find(a => a.id === applicationId);
    if (!rawApp) return { life, balanceDelta: 0 };
    const app = normalizeJobApplication(rawApp, life.dateStr);
    const posting = findPostingForApplication(life, app);
    if (!posting) return { life, application: app, balanceDelta: 0 };
    const stage = (app.stage || 'submitted') as BankJobApplicationStage;
    if (isTerminalJobStage(stage)) return { life, application: app, balanceDelta: 0 };

    const seed = seededNoise(`${life.dateStr}:${app.id}:${stage}:${answer.length}:${app.stageHistory?.length || 0}`);
    const exp = life.experience[posting.category] || 0;
    const answerBonus = clamp(answer.trim().length / 120, 0, 0.16);
    const baseChance = clamp(0.52 + (posting.successBias || 0) + exp * 0.018 + answerBonus - (life.fatigue > 78 ? 0.1 : 0), 0.1, 0.94);
    const defaultScoreDelta = Math.round(12 + answerBonus * 70 + (seed - 0.5) * 18);
    const aiScoreDelta = typeof aiDraft?.scoreDelta === 'number' ? clamp(Math.round(aiDraft.scoreDelta), -25, 30) : undefined;
    const scoreDelta = aiScoreDelta ?? defaultScoreDelta;
    const score = Math.round(clamp((app.score || app.aiReview?.score || 45) + scoreDelta, 0, 100));
    let balanceDelta = 0;
    let nextStage: BankJobApplicationStage = stage;
    let message = app.message;
    const questions = app.questions || buildInterviewQuestions(posting, app.id);
    let nextQuestions = questions;

    if (stage === 'submitted') {
        nextStage = 'screening';
        message = `${posting.employer} 正在看你的简历，关键要求是：${posting.requirements.join('、')}。`;
    } else if (stage === 'screening') {
        if (posting.black && seed < 0.2) {
            balanceDelta = -Math.min(walletBalance, Math.round(posting.salaryMin * 0.12));
            nextStage = 'scammed';
            message = '对方把到岗物料和培训说成必要流程，先扣走一笔费用，后面没再给明确答复。';
        } else if (seed > baseChance + 0.16) {
            nextStage = 'rejected';
            message = `${posting.employer} 没有约面，先换个方向继续找。`;
        } else {
            nextStage = 'recruiter_chat';
            message = '简历通过初筛，HR 想先聊聊排班、经验和到岗时间。';
        }
    } else if (stage === 'recruiter_chat') {
        if (posting.black && seed < 0.16) {
            balanceDelta = -Math.min(walletBalance, Math.round(posting.salaryMin * 0.1));
            nextStage = 'scammed';
            message = '沟通里费用名目、试岗计薪和结算日期一直绕来绕去，对方随后不再回复。';
        } else if (seed > baseChance + 0.2) {
            nextStage = 'rejected';
            message = `${posting.employer} 沟通后觉得期待不太匹配，没有继续约测评。`;
        } else {
            nextStage = 'assessment';
            message = posting.payCycle === 'daily' ? '对方约你试岗半天，表现好就能当天排班。' : '进入笔试/能力测试，答完再等面试。';
        }
    } else if (stage === 'assessment') {
        const idx = questions.findIndex(q => !q.answer);
        nextQuestions = idx >= 0
            ? questions.map((q, i) => i === idx ? { ...q, answer: answer || '现场完成了基础测试。', score: Math.round(score) } : q)
            : questions;
        if (posting.black && seed < 0.12) {
            balanceDelta = -Math.min(walletBalance, Math.round(posting.salaryMin * 0.08));
            nextStage = 'scammed';
            message = '试岗后对方又追加了几项费用，结算日期也往后推，先停在这里更稳。';
        } else if (seed > baseChance + 0.28) {
            nextStage = 'rejected';
            message = '测评表现没有达到对方预期，这轮先到这里。';
        } else {
            nextStage = 'interview';
            message = '测评通过，进入面试。';
        }
    } else if (stage === 'interview') {
        const idx = questions.findIndex(q => !q.answer);
        nextQuestions = idx >= 0
            ? questions.map((q, i) => i === idx ? { ...q, answer: answer || '我会稳定排班，也会先把问题拆清楚再处理。', score: Math.round(score) } : q)
            : questions;
        const answered = questions.filter(q => q.answer).length;
        const finalChance = clamp(baseChance + answered * 0.04 + (score - 60) / 260, 0.08, 0.96);
        if (posting.black && seed < 0.32) {
            nextStage = 'trial';
            message = `${posting.employer} 给了试用机会，但条款要盯紧。`;
        } else if (seed < finalChance) {
            nextStage = seed < finalChance * 0.72 ? 'negotiation' : 'offer';
            message = nextStage === 'negotiation'
                ? `${posting.employer} 认可面试表现，开始谈薪资和试用条款。`
                : `${posting.employer} 发来 Offer，可以核对条款后决定是否入职。`;
        } else {
            nextStage = 'rejected';
            message = `面试结束后，${posting.employer} 选择了其他候选人。`;
        }
    } else if (stage === 'negotiation') {
        if (seed > baseChance + 0.35) {
            nextStage = 'rejected';
            message = '双方在薪资或排班上没有谈拢，这份机会先放下。';
        } else {
            nextStage = 'offer';
            message = `${posting.employer} 更新了 Offer 条款，请最后核对。`;
        }
    } else if (stage === 'offer') {
        nextStage = posting.black && (app.offerTerms?.risks?.length || 0) > 1 ? 'trial' : 'hired';
        message = nextStage === 'trial'
            ? `${posting.title} 进入试用，先盯紧条款和结算。`
            : `${posting.title} 已入职，明天开始计算收入。`;
    }

    const allowed = JOB_STAGE_FLOW[stage] || [];
    const aiStage = aiDraft?.nextStage;
    if (aiStage && allowed.includes(aiStage)) {
        nextStage = aiStage;
        if (aiDraft.summary) message = aiDraft.summary;
    }
    if (nextStage === 'scammed' && balanceDelta === 0) {
        balanceDelta = -Math.min(walletBalance, Math.max(0, Math.round(posting.salaryMin * 0.1)));
    }

    const offerSalary = app.offerSalary || aiDraft?.offerSalary || (posting.payCycle === 'daily'
        ? Math.round((posting.salaryMin + posting.salaryMax) / 2)
        : Math.round(posting.salaryMin + (posting.salaryMax - posting.salaryMin) * clamp(score / 100, 0.25, 0.9)));
    const nextOfferTerms = (nextStage === 'negotiation' || nextStage === 'offer' || nextStage === 'hired' || nextStage === 'trial')
        ? buildJobOfferTerms(posting, offerSalary, aiDraft)
        : app.offerTerms;
    const status = statusForJobStage(nextStage);
    const riskFlags = Array.from(new Set([...(aiDraft?.riskFlags || []), ...(nextStage === 'scammed' || posting.black ? posting.riskTags : [])])).slice(0, 6);
    const result = createJobStageResult(nextStage, posting, aiDraft?.summary || message, {
        tone: aiDraft?.tone,
        highlights: aiDraft?.highlights,
        balanceDelta,
        scoreDelta,
        riskFlags,
        nextActionLabel: aiDraft?.nextActionLabel,
    });
    let nextApp: BankJobApplication = {
        ...app,
        score,
        stage: nextStage,
        status,
        questions: nextQuestions,
        offerSalary: nextOfferTerms?.salary,
        offerTerms: nextOfferTerms,
        riskNote: riskFlags.length ? riskFlags.join('、') : app.riskNote,
        message,
        todos: buildJobTodos(nextStage, posting),
        stageResult: result,
        stageHistory: appendJobStageHistory({ ...app, score }, result, life),
        lastUpdatedAt: `${life.dateStr} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    };
    if (aiDraft?.bossMessage) {
        const bossMessage = { role: 'boss' as const, content: String(aiDraft.bossMessage).slice(0, 220), at: nextApp.lastUpdatedAt || life.dateStr };
        nextApp = {
            ...nextApp,
            chatMessages: [...(nextApp.chatMessages || []), bossMessage].slice(-80),
        };
    }

    const hired = nextStage === 'hired' || nextStage === 'trial';
    const nextLife: BankLifeState = {
        ...life,
        currentJob: hired ? {
            ...posting,
            salaryMin: nextOfferTerms?.salary || posting.salaryMin,
            salaryMax: nextOfferTerms?.salary || posting.salaryMax,
            payCycle: nextOfferTerms?.payCycle || posting.payCycle,
            payDay: nextOfferTerms?.payDay || posting.payDay,
            startedAt: life.dateStr,
            accruedWage: 0,
            daysWorked: 0,
            trialUntil: nextStage === 'trial' ? addDays(life.dateStr, nextOfferTerms?.trialDays || 3) : undefined,
        } : life.currentJob,
        fatigue: clamp(life.fatigue + (nextStage === 'scammed' ? 12 : nextStage === 'rejected' ? 4 : hired ? 3 : 2), 0, 100),
        reputation: clamp(life.reputation + (hired ? 2 : nextStage === 'scammed' ? -2 : 0), 0, 100),
        experience: hired ? { ...life.experience, [posting.category]: (life.experience[posting.category] || 0) + 1 } : life.experience,
        jobHistory: life.jobHistory.map(a => a.id === nextApp.id ? nextApp : a).slice(0, 60),
        events: pushEvent(life.events, { dateStr: life.dateStr, title: nextStage === 'scammed' ? '求职中止' : '求职进展', detail: nextApp.message, tone: hired ? 'good' : nextStage === 'scammed' ? 'bad' : nextStage === 'rejected' || nextStage === 'declined' ? 'warn' : 'info', amount: balanceDelta || undefined }),
    };
    return { life: nextLife, application: nextApp, balanceDelta };
}

export function applyForJob(life: BankLifeState, posting: BankJobPosting, walletBalance = 0): { life: BankLifeState; application: BankJobApplication; balanceDelta: number } {
    const seed = seededNoise(`${life.dateStr}:${posting.id}:${life.jobHistory.length}`);
    const exp = life.experience[posting.category] || 0;
    const fatiguePenalty = life.fatigue > 75 ? -0.12 : 0;
    const wealthSignal = walletBalance > 50000 ? 0.03 : 0;
    const chance = clamp(0.55 + (posting.successBias || 0) + exp * 0.015 + wealthSignal + fatiguePenalty, 0.12, 0.92);
    let status: BankJobApplicationStatus = seed < chance ? 'hired' : 'rejected';
    let balanceDelta = 0;
    let message = status === 'hired'
        ? `${posting.employer} 发来入职通知，${posting.title} 可以开始上班了。`
        : `${posting.employer} 暂时没有录用你，建议换个方向或积累经验。`;

    if (posting.black) {
        if (seed < 0.28) {
            status = 'scammed';
            balanceDelta = -Math.min(walletBalance, Math.round((posting.salaryMin || 3000) * 0.18));
            message = `这份「${posting.title}」最后没走稳，到岗前的费用被扣走，先把这次记录下来。`;
        } else if (seed < 0.48) {
            status = 'trial';
            message = `${posting.employer} 只给了试用机会，计薪和转正口径还没说透。`;
        }
    } else if (status === 'hired' && seed > 0.82) {
        status = 'trial';
        message = `${posting.employer} 愿意让你试用三天，表现好就转正式。`;
    }

    const stage = status as BankJobApplicationStage;
    const offerTerms = (status === 'hired' || status === 'trial')
        ? buildJobOfferTerms(posting, Math.round((posting.salaryMin + posting.salaryMax) / 2))
        : undefined;
    const stageResult = createJobStageResult(stage, posting, message, {
        balanceDelta,
        riskFlags: status === 'scammed' || posting.black ? posting.riskTags : undefined,
    });
    const application: BankJobApplication = {
        id: genId('jobapp'),
        postingId: posting.id,
        title: posting.title,
        employer: posting.employer,
        status,
        stage,
        score: Math.round(chance * 100),
        questions: buildInterviewQuestions(posting, `${life.dateStr}:${posting.id}:${life.jobHistory.length}`),
        offerSalary: offerTerms?.salary,
        offerTerms,
        riskNote: status === 'scammed' ? '到岗前费用损失。' : posting.black ? '条款需要逐条看清。' : undefined,
        postingSnapshot: posting,
        stageHistory: [{
            id: stageResult.id,
            stage,
            title: stageResult.title,
            detail: stageResult.summary,
            at: life.dateStr,
            tone: stageResult.tone,
            score: Math.round(chance * 100),
            balanceDelta,
        }],
        todos: buildJobTodos(stage, posting),
        stageResult,
        lastUpdatedAt: life.dateStr,
        dateStr: life.dateStr,
        message,
    };
    const next: BankLifeState = {
        ...life,
        currentJob: status === 'hired' || status === 'trial'
            ? { ...posting, startedAt: life.dateStr, accruedWage: 0, daysWorked: 0, trialUntil: status === 'trial' ? addDays(life.dateStr, 3) : undefined }
            : life.currentJob,
        fatigue: clamp(life.fatigue + (status === 'scammed' ? 12 : status === 'rejected' ? 5 : 2), 0, 100),
        reputation: clamp(life.reputation + (status === 'hired' ? 2 : status === 'scammed' ? -2 : 0), 0, 100),
        jobHistory: [application, ...life.jobHistory].slice(0, 60),
        events: pushEvent(life.events, { dateStr: life.dateStr, title: status === 'scammed' ? '求职中止' : '求职结果', detail: message, tone: status === 'hired' ? 'good' : status === 'scammed' ? 'bad' : 'info', amount: balanceDelta || undefined }),
    };
    return { life: next, application, balanceDelta };
}


export function updateResumeProfile(life: BankLifeState, updates: Partial<BankResumeProfile>): BankLifeState {
    const current = life.resume || defaultResume(life.dateStr);
    return {
        ...life,
        resume: {
            ...current,
            ...updates,
            headline: String(updates.headline ?? current.headline).trim().slice(0, 80) || current.headline,
            selfIntro: String(updates.selfIntro ?? current.selfIntro).trim().slice(0, 300) || current.selfIntro,
            skills: (updates.skills || current.skills || []).map(s => String(s).trim()).filter(Boolean).slice(0, 12),
            expectedCategories: (updates.expectedCategories || current.expectedCategories || []).map(s => String(s).trim()).filter(Boolean).slice(0, 6),
            experience: (updates.experience || current.experience || []).slice(0, 8),
            updatedAt: Date.now(),
        },
    };
}

export function mergeAiJobPostings(life: BankLifeState, jobs: BankJobPosting[], query: string, category: string): BankLifeState {
    return {
        ...life,
        aiJobPostings: [...jobs, ...(life.aiJobPostings || [])].slice(0, 40),
        jobSearchSessions: [{ id: genId('jobsearch'), query, category, filters: {}, generatedAt: life.dateStr, source: 'ai' as const }, ...(life.jobSearchSessions || [])].slice(0, 20),
    };
}

export function appendJobChatMessage(life: BankLifeState, applicationId: string, message: { role: 'boss' | 'user' | 'system'; content: string; at: string }): BankLifeState {
    return {
        ...life,
        jobHistory: life.jobHistory.map(app => app.id === applicationId
            ? { ...app, chatMessages: [...(app.chatMessages || []), message].slice(-80) }
            : app),
    };
}

export function declineJobApplication(life: BankLifeState, applicationId: string, reason = '这份机会先不继续了。'): { life: BankLifeState; application?: BankJobApplication } {
    const rawApp = life.jobHistory.find(a => a.id === applicationId);
    if (!rawApp) return { life };
    const app = normalizeJobApplication(rawApp, life.dateStr);
    if (isTerminalJobStage(app.stage)) return { life, application: app };
    const posting = findPostingForApplication(life, app) || app.postingSnapshot || JOB_POSTINGS[0];
    const message = reason.trim().slice(0, 160) || '这份机会先不继续了。';
    const result = createJobStageResult('declined', posting, message, {
        tone: 'warn',
        highlights: [`已放弃：${app.title}`, '不会影响当前工作收入'],
    });
    const nextApp: BankJobApplication = {
        ...app,
        stage: 'declined',
        status: 'declined',
        declinedReason: message,
        message,
        todos: buildJobTodos('declined', posting),
        stageResult: result,
        stageHistory: appendJobStageHistory(app, result, life),
        lastUpdatedAt: `${life.dateStr} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    };
    const nextLife = {
        ...life,
        jobHistory: life.jobHistory.map(a => a.id === nextApp.id ? nextApp : a).slice(0, 60),
        events: pushEvent(life.events, { dateStr: life.dateStr, title: '放弃求职机会', detail: `${app.employer} · ${app.title}：${message}`, tone: 'warn' }),
    };
    return { life: nextLife, application: nextApp };
}

export function leaveJob(life: BankLifeState): BankLifeState {
    const job = life.currentJob;
    if (!job) return life;
    const payDate = job.payCycle === 'monthly'
        ? nextPayDate(life.dateStr, job.payDay || 10)
        : addDays(life.dateStr, 1);
    const pending = job.accruedWage > 0
        ? [{ id: genId('wage'), title: job.title, employer: job.employer, amount: roundMoney(job.accruedWage), payDate, note: '离职后待发工资' }, ...life.pendingWages]
        : life.pendingWages;
    return {
        ...life,
        currentJob: undefined,
        pendingWages: pending,
        events: pushEvent(life.events, { dateStr: life.dateStr, title: '办理离职', detail: `你离开了 ${job.employer}，未结工资会在 ${payDate} 发放。`, tone: 'info' }),
    };
}

function nextPayDate(dateStr: string, payDay: number): string {
    const [y, m, d0] = dateStr.split('-').map(Number);
    const d = new Date(Date.UTC(y, (m || 1) - 1, d0 || 1));
    const target = new Date(d);
    target.setUTCDate(clamp(payDay, 1, 28));
    if (target.getTime() <= d.getTime()) target.setUTCMonth(target.getUTCMonth() + 1);
    return target.toISOString().slice(0, 10);
}

function pushEvent(events: BankLifeEvent[], event: Omit<BankLifeEvent, 'id'>): BankLifeEvent[] {
    return [{ id: genId('life'), ...event }, ...events].slice(0, 80);
}

export interface BankLifeAdvanceResult {
    life: BankLifeState;
    balanceDelta: number;
    ledgerEvents: { amount: number; note: string; category: string; kind: string; sourceId?: string }[];
}

export function advanceBankLifeDay(life: BankLifeState): BankLifeAdvanceResult {
    const nextDate = addDays(life.dateStr, 1);
    let next: BankLifeState = {
        ...life,
        dateStr: nextDate,
        dayIndex: (life.dayIndex || 1) + 1,
        weekDay: weekDayOf(nextDate),
        season: seasonOf(nextDate),
    };
    let balanceDelta = 0;
    const ledgerEvents: BankLifeAdvanceResult['ledgerEvents'] = [];
    const dayEvents: BankLifeEvent[] = [];

    if (next.currentJob) {
        const job = next.currentJob;
        const dailyPay = job.payCycle === 'daily'
            ? Math.round((job.salaryMin + job.salaryMax) / 2)
            : Math.round(((job.salaryMin + job.salaryMax) / 2) / 22);
        const worked = job.daysWorked + 1;
        const accrued = roundMoney((job.accruedWage || 0) + dailyPay);
        const exp = { ...next.experience, [job.category]: (next.experience[job.category] || 0) + 1 };
        const updatedJob: BankJobEmployment = { ...job, daysWorked: worked, accruedWage: accrued };
        next = {
            ...next,
            currentJob: updatedJob,
            fatigue: clamp(next.fatigue + job.intensity * 4, 0, 100),
            energy: clamp(next.energy - job.intensity * 6, 0, 100),
            mood: clamp(next.mood + (job.payCycle === 'daily' ? 1 : 0) - Math.max(0, job.intensity - 3), 0, 100),
            health: clamp(next.health - (job.intensity >= 5 ? 2 : 0), 0, 100),
            experience: exp,
        };
        if (job.payCycle === 'daily') {
            next.currentJob = { ...updatedJob, accruedWage: 0 };
            balanceDelta += accrued;
            ledgerEvents.push({ amount: accrued, note: `${job.title} 日结工资`, category: 'salary', kind: 'salary', sourceId: job.id });
            dayEvents.push({ id: genId('life'), dateStr: nextDate, title: '日结到账', detail: `${job.employer} 支付了今天的工资。`, tone: 'good', amount: accrued });
        } else if (dayOfMonth(nextDate) === (job.payDay || 10) && next.currentJob) {
            const paid = accrued;
            next.currentJob = { ...next.currentJob, accruedWage: 0 };
            balanceDelta += paid;
            ledgerEvents.push({ amount: paid, note: `${job.title} 月薪发放`, category: 'salary', kind: 'salary', sourceId: job.id });
            dayEvents.push({ id: genId('life'), dateStr: nextDate, title: '工资到账', detail: `${job.employer} 发了本月工资。`, tone: 'good', amount: paid });
        }
    } else {
        next = {
            ...next,
            fatigue: clamp(next.fatigue - 8, 0, 100),
            energy: clamp(next.energy + 12, 0, 100),
            mood: clamp(next.mood + 3, 0, 100),
            health: clamp(next.health + 1, 0, 100),
        };
    }

    const remainingPending = [];
    for (const w of next.pendingWages) {
        if (w.payDate <= nextDate) {
            balanceDelta += w.amount;
            ledgerEvents.push({ amount: w.amount, note: `${w.title} 离职补发`, category: 'salary', kind: 'salary', sourceId: w.id });
            dayEvents.push({ id: genId('life'), dateStr: nextDate, title: '补发到账', detail: w.note, tone: 'good', amount: w.amount });
        } else remainingPending.push(w);
    }
    next = { ...next, pendingWages: remainingPending };

    const market = updateStockMarket(next.stockMarket, nextDate);
    next = { ...next, stockMarket: market };

    const loanResult = settleLoans(next.loans, nextDate);
    next = { ...next, loans: loanResult.loans };
    if (loanResult.events.length) dayEvents.push(...loanResult.events);

    if (next.company) {
        const companyResult = advanceCompany(next.company, nextDate);
        next = { ...next, company: companyResult.company };
        dayEvents.push(companyResult.event);
    }

    if (dayEvents.length === 0) {
        dayEvents.push({ id: genId('life'), dateStr: nextDate, title: '平稳的一天', detail: '没有大事发生，生活继续往前滚动。', tone: 'info' });
    }
    next = { ...next, dailyPlan: buildDailyPlan(next), events: [...dayEvents.reverse(), ...next.events].slice(0, 80) };
    return { life: next, balanceDelta: roundMoney(balanceDelta), ledgerEvents };
}

function updateStockMarket(market: BankStockQuote[], dateStr: string): BankStockQuote[] {
    return market.map(q => {
        const noise = seededNoise(`${dateStr}:${q.symbol}`);
        const riskAmp = 0.012 + q.risk * 0.012;
        const drift = q.trend === 'up' ? 0.006 : q.trend === 'down' ? -0.006 : 0;
        const pct = clamp((noise - 0.5) * riskAmp * 2 + drift, -0.12, 0.12);
        const open = q.price;
        const price = Math.max(1, roundMoney(q.price * (1 + pct)));
        const high = roundMoney(Math.max(open, price) * (1 + 0.006 + seededNoise(`${dateStr}:${q.symbol}:high`) * 0.026));
        const low = roundMoney(Math.max(0.5, Math.min(open, price) * (1 - 0.006 - seededNoise(`${dateStr}:${q.symbol}:low`) * 0.026)));
        const volume = Math.round((82000 + seededNoise(`${dateStr}:${q.symbol}:volume`) * 320000) * (1 + q.risk * 0.2));
        const news = pct > 0.035
            ? `${q.industry}板块有资金流入，${q.name}放量走强。`
            : pct < -0.035
                ? `${q.industry}情绪降温，${q.name}短线承压。`
                : `${q.name}窄幅震荡，市场等待新消息。`;
        const history = [...(q.history || []), { dateStr, open, high, low, close: price, volume }].slice(-90);
        return {
            ...q,
            previousPrice: q.price,
            price,
            changePct: Math.round(pct * 10000) / 100,
            trend: pct > 0.012 ? 'up' : pct < -0.012 ? 'down' : 'flat',
            news,
            history,
            intraday: buildIntraday(q.symbol, price, dateStr, q.risk),
            eventTags: q.eventTags || [],
        };
    });
}

export function movingAverage(values: number[], window: number): number[] {
    return values.map((_, idx) => {
        const start = Math.max(0, idx - window + 1);
        const slice = values.slice(start, idx + 1);
        return roundMoney(slice.reduce((sum, n) => sum + n, 0) / slice.length);
    });
}

function settleLoans(loans: BankLoan[], dateStr: string): { loans: BankLoan[]; events: BankLifeEvent[] } {
    const events: BankLifeEvent[] = [];
    const nextLoans = loans.map(loan => {
        const interest = roundMoney(loan.outstanding * loan.dailyRate);
        const overdue = dateStr > loan.dueDate ? loan.overdueDays + 1 : loan.overdueDays;
        const repaymentPlan = (loan.repaymentPlan || []).map(p => {
            if (p.status === 'paid') return p;
            return { ...p, status: dateStr > p.dueDate ? 'overdue' as const : 'pending' as const };
        });
        const updated = { ...loan, interestDue: roundMoney(loan.interestDue + interest), overdueDays: overdue, repaymentPlan };
        if (overdue > 0) {
            events.push({ id: genId('life'), dateStr, title: '贷款逾期提醒', detail: `${channelLabel(loan.channel)}借款已逾期 ${overdue} 天，利息继续滚动。`, tone: loan.channel === 'shady' ? 'bad' : 'warn' });
        }
        return updated;
    });
    return { loans: nextLoans, events };
}

function advanceCompany(company: BankCompanyState, dateStr: string): { company: BankCompanyState; event: BankLifeEvent } {
    const noise = seededNoise(`${dateStr}:${company.id}:${company.cash}`);
    const revenue = Math.round((company.reputation * 18 + company.employees * 260) * (0.7 + noise));
    const cost = Math.round(900 + company.employees * 180 + company.stress * 8);
    const profit = revenue - cost;
    const stressDelta = profit < 0 ? 6 : -3;
    const reputationDelta = profit > 1000 ? 2 : profit < -1000 ? -2 : 0;
    const nextCompany = {
        ...company,
        cash: roundMoney(company.cash + profit),
        reputation: clamp(company.reputation + reputationDelta, 0, 100),
        stress: clamp(company.stress + stressDelta, 0, 100),
        cumulativeProfit: roundMoney(company.cumulativeProfit + profit),
        cashflow: [{ dateStr, revenue, cost, profit, note: profit >= 0 ? '订单回款' : '日常开支' }, ...(company.cashflow || [])].slice(0, 45),
        orders: refreshCompanyOrders(company, dateStr),
        pendingIssue: buildCompanyIssue(company, dateStr),
    };
    return {
        company: nextCompany,
        event: { id: genId('life'), dateStr, title: profit >= 0 ? '公司进账' : '公司烧钱', detail: `${company.name} 今日${profit >= 0 ? '净赚' : '亏损'} ¥${Math.abs(profit)}。`, tone: profit >= 0 ? 'good' : 'warn', amount: profit },
    };
}

function refreshCompanyOrders(company: BankCompanyState, dateStr: string): NonNullable<BankCompanyState['orders']> {
    const base = company.orders?.filter(o => o.status === 'open' || o.status === 'active').slice(0, 4) || [];
    const n = seededNoise(`${dateStr}:orders:${company.id}`);
    if (base.length >= 4 || n < 0.38) return base;
    const pools = [
        { title: '小单快交付', client: '邻里客户', value: 2600, difficulty: 2 },
        { title: '月度合作包', client: '新城商户', value: 8800, difficulty: 3 },
        { title: '品牌改造案', client: '白鲸品牌部', value: 16000, difficulty: 4 },
        { title: '紧急救场单', client: '晚风工作群', value: 5200, difficulty: 5 },
    ];
    const pick = pools[Math.floor(n * pools.length) % pools.length];
    return [{ id: genId('order'), ...pick, value: Math.round(pick.value * (0.8 + n * 0.6)), status: 'open' }, ...base];
}

function buildCompanyIssue(company: BankCompanyState, dateStr: string): BankCompanyState['pendingIssue'] {
    const n = seededNoise(`${dateStr}:issue:${company.id}`);
    const openOrder = company.orders?.find(o => o.status === 'open');
    if (openOrder && n < 0.28) {
        return {
            id: genId('issue'),
            title: '接一个新订单',
            description: `${openOrder.client} 想把「${openOrder.title}」交给你，报价 ¥${openOrder.value}。`,
            kind: 'order',
            options: [
                { id: 'take-order', label: '接下订单', cashDelta: Math.round(openOrder.value * 0.25), reputationDelta: 2, stressDelta: openOrder.difficulty * 2, orderId: openOrder.id },
                { id: 'pass-order', label: '婉拒这单', cashDelta: 0, reputationDelta: -1, stressDelta: -1, orderId: openOrder.id },
            ],
        };
    }
    if (n < 0.35) {
        return {
            id: genId('issue'),
            title: '客户临时改需求',
            description: '客户想加内容但预算没变，团队士气有点低。',
            kind: 'risk',
            options: [
                { id: 'firm', label: '坚持追加报价', cashDelta: 1200, reputationDelta: -1, stressDelta: 3 },
                { id: 'soft', label: '赠送小改动', cashDelta: -500, reputationDelta: 3, stressDelta: 1 },
            ],
        };
    }
    if (n < 0.7) {
        return {
            id: genId('issue'),
            title: '招一个帮手',
            description: '业务忙起来了，是否招一名兼职帮你分担？',
            kind: 'employee',
            options: [
                { id: 'hire', label: '招人扩张', cashDelta: -3000, reputationDelta: 2, stressDelta: -8, employeeDelta: 1 },
                { id: 'hold', label: '先自己扛', cashDelta: 0, reputationDelta: 0, stressDelta: 6 },
            ],
        };
    }
    return {
        id: genId('issue'),
        title: '投一波推广',
        description: '最近流量不错，可以考虑买一点曝光。',
        kind: 'marketing',
        options: [
            { id: 'ads', label: '投放推广', cashDelta: -1800, reputationDelta: 5, stressDelta: 2 },
            { id: 'organic', label: '自然增长', cashDelta: 0, reputationDelta: 1, stressDelta: 0 },
        ],
    };
}

export function stockMarketValue(life: BankLifeState): number {
    return Object.values(life.holdings).reduce((sum, h) => {
        const q = life.stockMarket.find(s => s.symbol === h.symbol);
        return sum + (q ? q.price * h.shares : 0);
    }, 0);
}

export function loanTotal(life: BankLifeState): number {
    return life.loans.reduce((sum, l) => sum + l.outstanding + l.interestDue, 0);
}

export function buyStock(life: BankLifeState, symbol: string, amount: number): { life: BankLifeState; cost: number; shares: number; actionResult?: BankStockOrderResult } {
    const quote = life.stockMarket.find(s => s.symbol === symbol);
    if (!quote || amount <= 0) return { life, cost: 0, shares: 0 };
    const fee = Math.max(1, Math.round(amount * 0.003));
    const budget = Math.max(0, amount - fee);
    const shares = Math.floor((budget / quote.price) * 1000) / 1000;
    const cost = roundMoney(shares * quote.price + fee);
    if (shares <= 0) return { life, cost: 0, shares: 0 };
    const prev = life.holdings[symbol];
    const nextShares = roundMoney((prev?.shares || 0) + shares);
    const nextAvg = prev
        ? roundMoney(((prev.avgCost * prev.shares) + (quote.price * shares)) / nextShares)
        : quote.price;
    const holding: BankStockHolding = { symbol, shares: nextShares, avgCost: nextAvg };
    const actionResult: BankStockOrderResult = {
        ...createBankActionResult({
            category: 'invest',
            kind: 'stock-buy',
            title: `买入 ${quote.name}`,
            summary: `按 ¥${quote.price} 成交 ${shares} 股，手续费 ¥${fee}。`,
            tone: quote.risk >= 4 ? 'warn' : 'good',
            amount: -cost,
            riskTags: quote.risk >= 4 ? ['高波动', '虚拟投资'] : ['虚拟投资'],
            metrics: [
                { label: '代码', value: quote.symbol },
                { label: '成交价', value: `¥${quote.price}` },
                { label: '买入份额', value: `${shares} 股` },
                { label: '手续费', value: `¥${fee}`, tone: 'warn' },
                { label: '持仓均价', value: `¥${nextAvg}` },
            ],
            nextActions: ['观察自选新闻', '设置卖出纪律'],
            payload: { symbol, amount, price: quote.price, fee, shares, cost },
        }),
        category: 'invest',
        kind: 'stock-buy',
        symbol,
        shares,
        price: quote.price,
        fee,
        cost,
    };
    const nextLife = appendBankActionRecord({
        ...life,
        holdings: { ...life.holdings, [symbol]: holding },
        watchlist: Array.from(new Set([symbol, ...life.watchlist])),
        events: pushEvent(life.events, { dateStr: life.dateStr, title: '股票买入', detail: `${quote.name} 成交 ${shares} 股，成本 ¥${cost}。`, tone: quote.risk >= 4 ? 'warn' : 'good', amount: -cost }),
    }, actionResult);
    return {
        life: nextLife,
        cost,
        shares,
        actionResult,
    };
}

export function sellStock(life: BankLifeState, symbol: string, shares: number): { life: BankLifeState; revenue: number; soldShares: number; actionResult?: BankStockOrderResult } {
    const quote = life.stockMarket.find(s => s.symbol === symbol);
    const prev = life.holdings[symbol];
    if (!quote || !prev || shares <= 0) return { life, revenue: 0, soldShares: 0 };
    const soldShares = Math.min(prev.shares, shares);
    const fee = Math.max(1, Math.round(soldShares * quote.price * 0.003));
    const revenue = roundMoney(soldShares * quote.price - fee);
    const pnl = roundMoney((quote.price - prev.avgCost) * soldShares - fee);
    const remain = roundMoney(prev.shares - soldShares);
    const holdings = { ...life.holdings };
    if (remain <= 0) delete holdings[symbol];
    else holdings[symbol] = { ...prev, shares: remain };
    const actionResult: BankStockOrderResult = {
        ...createBankActionResult({
            category: 'invest',
            kind: 'stock-sell',
            title: `卖出 ${quote.name}`,
            summary: `按 ¥${quote.price} 卖出 ${soldShares} 股，${pnl >= 0 ? '浮盈' : '浮亏'}约 ¥${Math.abs(pnl)}。`,
            tone: pnl >= 0 ? 'good' : 'warn',
            amount: revenue,
            riskTags: ['虚拟投资'],
            metrics: [
                { label: '代码', value: quote.symbol },
                { label: '成交价', value: `¥${quote.price}` },
                { label: '卖出份额', value: `${soldShares} 股` },
                { label: '手续费', value: `¥${fee}`, tone: 'warn' },
                { label: '本次盈亏', value: `${pnl >= 0 ? '+' : '-'}¥${Math.abs(pnl)}`, tone: pnl >= 0 ? 'good' : 'warn' },
            ],
            nextActions: remain > 0 ? ['继续观察剩余仓位'] : ['复盘这笔交易'],
            payload: { symbol, requestedShares: shares, soldShares, price: quote.price, fee, revenue, pnl, remain },
        }),
        category: 'invest',
        kind: 'stock-sell',
        symbol,
        shares: soldShares,
        price: quote.price,
        fee,
        revenue,
        pnl,
    };
    return {
        life: appendBankActionRecord({
            ...life,
            holdings,
            events: pushEvent(life.events, { dateStr: life.dateStr, title: '股票卖出', detail: `${quote.name} 卖出 ${soldShares} 股，到账 ¥${revenue}。`, tone: pnl >= 0 ? 'good' : 'warn', amount: revenue }),
        }, actionResult),
        revenue,
        soldShares,
        actionResult,
    };
}

export function foundCompany(life: BankLifeState, name: string, direction: string): BankLifeState {
    const id = genId('company');
    const companyName = name.trim() || `${direction}小公司`;
    const starterOrder = {
        id: genId('order'),
        title: '开业首单',
        client: '熟人介绍',
        value: 3200,
        difficulty: 2,
        status: 'open' as const,
    };
    const company: BankCompanyState = {
        id,
        name: companyName,
        direction,
        cash: COMPANY_FOUND_COST,
        reputation: 45,
        employees: 1,
        stress: 20,
        cumulativeProfit: 0,
        foundedAt: life.dateStr,
        cashflow: [],
        orders: [starterOrder],
        risks: ['现金流', '获客', '交付'],
    };
    company.pendingIssue = buildCompanyIssue(company, life.dateStr);
    const actionResult: BankCompanyActionResult = {
        ...createBankActionResult({
            category: 'company',
            kind: 'company-found',
            title: '公司成立',
            summary: `${company.name} 已成立，方向是${direction}，第一笔启动资金进入公司现金池。`,
            tone: 'good',
            amount: -COMPANY_FOUND_COST,
            riskTags: ['现金流', '获客', '交付'],
            metrics: [
                { label: '方向', value: direction },
                { label: '启动资金', value: `¥${COMPANY_FOUND_COST}`, tone: 'warn' },
                { label: '声誉', value: `${company.reputation}/100` },
                { label: '首个订单', value: starterOrder.title },
            ],
            nextActions: ['处理公司第一件事务', '观察现金流'],
            payload: { companyId: id, direction, starterOrder },
        }),
        category: 'company',
        cashDelta: COMPANY_FOUND_COST,
        reputationDelta: 0,
        stressDelta: company.stress,
    };
    return appendBankActionRecord({
        ...life,
        company,
        events: pushEvent(life.events, { dateStr: life.dateStr, title: '公司成立', detail: `${company.name} 开张了，方向是${direction}。`, tone: 'good', amount: -COMPANY_FOUND_COST }),
    }, actionResult);
}

export function applyCompanyIssueWithResult(life: BankLifeState, optionId: string): { life: BankLifeState; actionResult?: BankCompanyActionResult } {
    const company = life.company;
    const issue = company?.pendingIssue;
    if (!company || !issue) return { life };
    const opt = issue.options.find(o => o.id === optionId) || issue.options[0];
    const orders = opt.orderId
        ? ((company.orders || []).map(o => o.id === opt.orderId ? { ...o, status: opt.id === 'take-order' ? 'active' as const : 'lost' as const } : o).slice(0, 8))
        : company.orders;
    const nextCompany = {
        ...company,
        cash: roundMoney(company.cash + opt.cashDelta),
        reputation: clamp(company.reputation + opt.reputationDelta, 0, 100),
        stress: clamp(company.stress + opt.stressDelta, 0, 100),
        employees: Math.max(1, company.employees + (opt.employeeDelta || 0)),
        orders,
        cashflow: [{ dateStr: life.dateStr, revenue: Math.max(0, opt.cashDelta), cost: Math.max(0, -opt.cashDelta), profit: opt.cashDelta, note: opt.label }, ...(company.cashflow || [])].slice(0, 45),
        pendingIssue: undefined,
    };
    const actionResult: BankCompanyActionResult = {
        ...createBankActionResult({
            category: 'company',
            kind: 'company-issue',
            title: issue.title,
            summary: `你选择了「${opt.label}」，公司现金${opt.cashDelta >= 0 ? '增加' : '减少'} ¥${Math.abs(opt.cashDelta)}。`,
            tone: opt.cashDelta >= 0 ? 'good' : opt.stressDelta > 8 ? 'warn' : 'info',
            amount: opt.cashDelta,
            riskTags: opt.stressDelta > 8 ? ['压力升高'] : [],
            metrics: [
                { label: '选择', value: opt.label },
                { label: '现金变化', value: `${opt.cashDelta >= 0 ? '+' : '-'}¥${Math.abs(opt.cashDelta)}`, tone: opt.cashDelta >= 0 ? 'good' : 'warn' },
                { label: '声誉变化', value: `${opt.reputationDelta >= 0 ? '+' : ''}${opt.reputationDelta}` },
                { label: '压力变化', value: `${opt.stressDelta >= 0 ? '+' : ''}${opt.stressDelta}`, tone: opt.stressDelta > 0 ? 'warn' : 'good' },
            ],
            nextActions: ['等待下一天刷新公司事项'],
            payload: { issueId: issue.id, optionId: opt.id, companyId: company.id },
        }),
        category: 'company',
        cashDelta: opt.cashDelta,
        reputationDelta: opt.reputationDelta,
        stressDelta: opt.stressDelta,
    };
    return {
        life: appendBankActionRecord({
            ...life,
            company: nextCompany,
            events: pushEvent(life.events, { dateStr: life.dateStr, title: issue.title, detail: `你选择了「${opt.label}」。`, tone: opt.cashDelta >= 0 ? 'good' : 'info', amount: opt.cashDelta }),
        }, actionResult),
        actionResult,
    };
}

export function applyCompanyIssue(life: BankLifeState, optionId: string): BankLifeState {
    return applyCompanyIssueWithResult(life, optionId).life;
}

export function withdrawCompanyDividend(life: BankLifeState): { life: BankLifeState; amount: number; actionResult?: BankCompanyActionResult } {
    const company = life.company;
    if (!company || company.cash <= COMPANY_FOUND_COST) return { life, amount: 0 };
    const amount = Math.floor((company.cash - COMPANY_FOUND_COST) * 0.35);
    if (amount <= 0) return { life, amount: 0 };
    const nextCompany = { ...company, cash: roundMoney(company.cash - amount), cumulativeProfit: Math.max(company.cumulativeProfit, 0) };
    const actionResult: BankCompanyActionResult = {
        ...createBankActionResult({
            category: 'company',
            kind: 'company-dividend',
            title: '公司分红',
            summary: `${company.name} 可分配利润中转出 ¥${amount}，公司保留现金 ¥${Math.round(nextCompany.cash)}。`,
            tone: 'good',
            amount,
            metrics: [
                { label: '到账', value: `¥${amount}`, tone: 'good' },
                { label: '公司现金', value: `¥${Math.round(nextCompany.cash)}` },
                { label: '安全垫', value: `¥${COMPANY_FOUND_COST}` },
            ],
            nextActions: ['继续观察公司现金流'],
            payload: { companyId: company.id, beforeCash: company.cash, afterCash: nextCompany.cash },
        }),
        category: 'company',
        cashDelta: -amount,
    };
    return {
        amount,
        actionResult,
        life: appendBankActionRecord({
            ...life,
            company: nextCompany,
            events: pushEvent(life.events, { dateStr: life.dateStr, title: '公司分红', detail: `${company.name} 分红到账 ¥${amount}。`, tone: 'good', amount }),
        }, actionResult),
    };
}

export const LOAN_PRODUCTS: Record<BankLoanChannel, { name: string; min: number; max: number; dailyRate: number; days: number; review: string; terms: string[] }> = {
    bank: {
        name: '银行信用贷',
        min: 3000,
        max: 80000,
        dailyRate: 0.00035,
        days: 90,
        review: '看收入、负债和近期还款记录',
        terms: ['按日计息', '可提前还款', '逾期会明显影响信用'],
    },
    formal: {
        name: '持牌周转金',
        min: 1000,
        max: 30000,
        dailyRate: 0.0009,
        days: 45,
        review: '审核较快，额度中等',
        terms: ['按日计息', '支持部分还款', '逾期会有提醒和罚息'],
    },
    shady: {
        name: '街口快借',
        min: 500,
        max: 12000,
        dailyRate: 0.0035,
        days: 14,
        review: '到账很快，代价也高',
        terms: ['利息高', '逾期事件多', '建议只做短期周转'],
    },
};


export function applyMarketPulses(life: BankLifeState, pulses: BankMarketPulse[]): BankLifeState {
    const quotes = life.stockMarket.map(q => {
        const pulse = pulses.find(p => p.affectedSymbols.includes(q.symbol));
        return pulse ? {
            ...q,
            aiReason: pulse.summary,
            newsList: [{ id: pulse.id, title: pulse.headline, source: 'AI 市场脉冲', dateStr: pulse.dateStr, tone: pulse.sentiment === 'bearish' ? 'warn' as const : pulse.sentiment === 'bullish' ? 'good' as const : 'info' as const }, ...(q.newsList || [])].slice(0, 8),
        } : q;
    });
    return { ...life, stockMarket: quotes, marketPulses: [...pulses, ...(life.marketPulses || [])].slice(0, 40) };
}

export function computeCreditProfile(life: BankLifeState): BankLoanCreditProfile {
    const income = life.currentJob ? 25 : 0;
    const debt = loanTotal(life);
    const debtPressure = clamp(Math.round(debt / 1000), 0, 100);
    const repaymentHistory = life.loans.some(l => l.overdueDays > 0) ? 35 : 75;
    const score = clamp(580 + income - Math.round(debtPressure * 1.5) + Math.round((repaymentHistory - 50) * 0.8), 300, 850);
    return {
        score,
        incomeStability: life.currentJob ? 70 : 35,
        debtPressure,
        repaymentHistory,
        riskLevel: score >= 720 ? 'low' : score >= 620 ? 'medium' : score >= 500 ? 'high' : 'danger',
        reasons: [life.currentJob ? '有当前工作收入记录' : '暂无稳定工作收入', debt > 0 ? `当前负债约 ¥${Math.round(debt)}` : '当前负债较低'],
        updatedAt: life.dateStr,
    };
}

export function buildLifeSuggestions(life: BankLifeState, walletBalance: number): { id: string; title: string; detail: string; tab: 'jobs' | 'shop' | 'invest' | 'company' | 'loans'; tone: 'good' | 'warn' | 'info' | 'bad' }[] {
    const items: { id: string; title: string; detail: string; tab: 'jobs' | 'shop' | 'invest' | 'company' | 'loans'; tone: 'good' | 'warn' | 'info' | 'bad' }[] = [];
    if (!life.currentJob) items.push({ id: 'find-job', title: '先找一份现金流', detail: '没有固定工作，求职能提供稳定工资。', tab: 'jobs', tone: 'info' });
    if (!life.shopUnlocked) items.push({ id: 'open-shop', title: `还差 ¥${Math.max(0, SHOP_UNLOCK_COST - walletBalance)} 可开店`, detail: '小店是人生拟里的经营赚钱模式。', tab: 'shop', tone: walletBalance >= SHOP_UNLOCK_COST ? 'good' : 'warn' });
    if (!life.company) items.push({ id: 'found-company', title: `公司启动金 ¥${COMPANY_FOUND_COST}`, detail: '资金充足后可选择方向创业。', tab: 'company', tone: walletBalance >= COMPANY_FOUND_COST ? 'good' : 'info' });
    if (loanTotal(life) > 0) items.push({ id: 'repay-loan', title: '关注借款还款', detail: '逾期会提高风险和利息。', tab: 'loans', tone: 'warn' });
    if (Object.keys(life.holdings).length > 0) items.push({ id: 'watch-market', title: '复盘持仓新闻', detail: '市场脉冲会影响虚拟个股情绪。', tab: 'invest', tone: 'info' });
    return items.slice(0, 4);
}

function buildRepaymentPlan(amount: number, startDate: string, days: number) {
    const parts = days >= 80 ? 3 : days >= 40 ? 2 : 1;
    const step = Math.max(1, Math.floor(days / parts));
    return Array.from({ length: parts }, (_, idx) => ({
        dueDate: addDays(startDate, step * (idx + 1)),
        amount: roundMoney(amount / parts),
        status: 'pending' as const,
    }));
}

export function borrowLoan(life: BankLifeState, channel: BankLoanChannel, amount: number): { life: BankLifeState; loan: BankLoan; actionResult?: BankLoanActionResult } {
    const product = LOAN_PRODUCTS[channel];
    const clampedAmount = clamp(Math.round(amount), product.min, product.max);
    const serviceFee = channel === 'shady' ? Math.min(500, Math.round(clampedAmount * 0.06)) : 0;
    const loan: BankLoan = {
        id: genId('loan'),
        channel,
        productName: product.name,
        principal: clampedAmount,
        outstanding: clampedAmount,
        interestDue: 0,
        dailyRate: product.dailyRate,
        borrowedAt: life.dateStr,
        dueDate: addDays(life.dateStr, product.days),
        overdueDays: 0,
        note: product.name,
        reviewStatus: 'approved',
        contractTerms: product.terms,
        repaymentPlan: buildRepaymentPlan(clampedAmount, life.dateStr, product.days),
        creditProfile: life.creditProfile,
        serviceFee,
        collectionRisk: channel === 'shady' ? '催收风险高，建议只做短期周转并尽快结清。' : undefined,
    };
    const actionResult: BankLoanActionResult = {
        ...createBankActionResult({
            category: 'loan',
            kind: 'loan-borrow',
            title: `${product.name} 到账`,
            summary: `虚拟借款 ¥${clampedAmount} 已到账，日息 ${(product.dailyRate * 100).toFixed(3)}%，到期日 ${loan.dueDate}。`,
            tone: channel === 'shady' ? 'warn' : 'good',
            amount: clampedAmount,
            riskTags: [
                '虚拟借款',
                ...(channel === 'shady' ? ['高利息', '催收风险', `服务费封顶 ¥${serviceFee}`] : []),
            ],
            metrics: [
                { label: '到账金额', value: `¥${clampedAmount}`, tone: 'good' },
                { label: '日息', value: `${(product.dailyRate * 100).toFixed(3)}%`, tone: channel === 'shady' ? 'warn' : 'info' },
                { label: '期限', value: `${product.days} 天` },
                { label: '到期日', value: loan.dueDate },
                ...(serviceFee ? [{ label: '服务费上限', value: `¥${serviceFee}`, tone: 'warn' as const }] : []),
            ],
            nextActions: ['查看还款计划', '避免逾期滚息'],
            payload: { loanId: loan.id, channel, amount: clampedAmount, dailyRate: product.dailyRate, dueDate: loan.dueDate, serviceFee },
        }),
        category: 'loan',
        loanId: loan.id,
        channel,
        principal: clampedAmount,
        dueDate: loan.dueDate,
    };
    return {
        loan,
        actionResult,
        life: appendBankActionRecord({
            ...life,
            loans: [loan, ...life.loans],
            events: pushEvent(life.events, { dateStr: life.dateStr, title: '借款到账', detail: `${loan.note} ¥${clampedAmount} 已到账。`, tone: channel === 'shady' ? 'warn' : 'good', amount: clampedAmount }),
        }, actionResult),
    };
}

export function repayLoan(life: BankLifeState, loanId: string, amount: number): { life: BankLifeState; paid: number; actionResult?: BankLoanActionResult } {
    const loan = life.loans.find(l => l.id === loanId);
    if (!loan || amount <= 0) return { life, paid: 0 };
    const total = roundMoney(loan.outstanding + loan.interestDue);
    const paid = Math.min(total, roundMoney(amount));
    let remain = roundMoney(total - paid);
    const loans = life.loans
        .map(l => {
            if (l.id !== loanId) return l;
            const interestPaid = Math.min(l.interestDue, paid);
            const newInterest = roundMoney(l.interestDue - interestPaid);
            const principalPaid = paid - interestPaid;
            remain = roundMoney(l.outstanding + newInterest - principalPaid);
            let rest = paid;
            const repaymentPlan = (l.repaymentPlan || []).map(p => {
                if (p.status === 'paid' || rest <= 0) return p;
                if (rest >= p.amount) {
                    rest = roundMoney(rest - p.amount);
                    return { ...p, status: 'paid' as const };
                }
                return p;
            });
            return { ...l, interestDue: newInterest, outstanding: Math.max(0, roundMoney(l.outstanding - principalPaid)), repaymentPlan };
        })
        .filter(l => l.outstanding + l.interestDue > 0.01);
    const actionResult: BankLoanActionResult = {
        ...createBankActionResult({
            category: 'loan',
            kind: 'loan-repay',
            title: remain <= 0 ? '借款结清' : '还款成功',
            summary: remain <= 0 ? `${loan.note} 已结清，本地账本不会继续滚息。` : `${loan.note} 已还 ¥${paid}，剩余约 ¥${remain}。`,
            tone: 'good',
            amount: -paid,
            riskTags: remain > 0 && loan.overdueDays > 0 ? ['仍有逾期'] : [],
            metrics: [
                { label: '本次还款', value: `¥${paid}`, tone: 'good' },
                { label: '剩余应还', value: `¥${Math.max(0, remain)}`, tone: remain > 0 ? 'warn' : 'good' },
                { label: '到期日', value: loan.dueDate },
            ],
            nextActions: remain > 0 ? ['按计划继续还款'] : ['复盘负债压力'],
            payload: { loanId, paid, remain, totalBefore: total },
        }),
        category: 'loan',
        loanId,
        channel: loan.channel,
        paid,
        dueDate: loan.dueDate,
    };
    return {
        paid,
        actionResult,
        life: appendBankActionRecord({
            ...life,
            loans,
            events: pushEvent(life.events, { dateStr: life.dateStr, title: remain <= 0 ? '贷款结清' : '还了一笔贷款', detail: remain <= 0 ? `${loan.note} 已结清。` : `${loan.note} 剩余约 ¥${remain}。`, tone: 'good', amount: -paid }),
        }, actionResult),
    };
}

export function channelLabel(channel: BankLoanChannel): string {
    if (channel === 'bank') return '银行';
    if (channel === 'formal') return '正规渠道';
    return '高利贷';
}
