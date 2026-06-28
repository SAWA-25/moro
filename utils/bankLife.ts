import {
    BankBusinessTemplate,
    BankFullState,
    BankJobApplication,
    BankJobApplicationStatus,
    BankJobEmployment,
    BankJobPosting,
    BankLifeEvent,
    BankLifeState,
    BankLoan,
    BankLoanChannel,
    BankStockHolding,
    BankStockQuote,
    BankCompanyState,
} from '../types';

export const BANK_LIFE_VERSION = 2;
export const SHOP_UNLOCK_COST = 10000;
export const COMPANY_FOUND_COST = 100000;

const DAY_MS = 24 * 60 * 60 * 1000;

const genId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

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

function seededNoise(seed: string): number {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) {
        h ^= seed.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 10000) / 10000;
}

export const JOB_CATEGORIES = [
    '全部', '服务业', '餐饮', '安保', '技术', '设计', '文职', '销售', '教育', '医疗辅助', '物流', '自由职业', '兼职', '灰色/黑心岗位',
];

export const JOB_POSTINGS: BankJobPosting[] = [
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
    { id: 'job-shady-deposit', category: '灰色/黑心岗位', title: '高薪试岗店员', employer: '金拱门外包部', salaryMin: 9000, salaryMax: 16000, payCycle: 'monthly', payDay: 28, intensity: 5, requirements: ['先交服装押金'], benefits: ['号称包过'], riskTags: ['押金', '无薪试岗', '拖欠'], description: '招聘页写得很好看，但细则里藏着押金和无薪试岗。', black: true, successBias: -0.22 },
    { id: 'job-shady-click', category: '灰色/黑心岗位', title: '居家数据标注', employer: '快赚互联', salaryMin: 300, salaryMax: 1200, payCycle: 'daily', intensity: 2, requirements: ['自备电脑', '先培训'], benefits: ['在家做'], riskTags: ['培训费', '结算不明'], description: '看似轻松，可能会被收培训费或拖延结算。', black: true, successBias: -0.18 },
];

export const BUSINESS_TEMPLATES: BankBusinessTemplate[] = [
    {
        id: 'drinks',
        name: '饮品店',
        icon: '🥤',
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
    return { ...q, price: last.close, previousPrice: history[history.length - 2]?.close || q.previousPrice, history, intraday: buildIntraday(q.symbol, last.close, last.dateStr, q.risk), eventTags: q.eventTags || [] };
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
    return {
        version: BANK_LIFE_VERSION,
        dateStr,
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
        stockMarket: BASE_STOCKS.map(s => ({ ...s })),
        holdings: {},
        watchlist: ['MORO', 'CAFE'],
        loans: [],
        events: [{ id: genId('life'), dateStr, title: '生活拟启动', detail: '你的虚拟人生账本翻开了第一页。', tone: 'info' }],
    };
}

export function migrateBankLifeState(state: BankFullState): BankFullState {
    const hasOldShopProgress = !!(
        state.shop?.lastBusinessAt ||
        state.shop?.totalRevenue ||
        (state.shop?.reviews?.length || 0) > 0 ||
        (state.shop?.regulars && Object.keys(state.shop.regulars).length > 0) ||
        (state.shop?.unlockedRecipes?.length || 0) > 1
    );
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
            shopEvents: state.life.shopEvents || [],
            jobHistory: state.life.jobHistory || [],
            pendingWages: state.life.pendingWages || [],
            experience: state.life.experience || {},
            stockMarket: ensureMarketDetail(state.life.stockMarket?.length ? state.life.stockMarket : BASE_STOCKS, state.life.dateStr || state.lastLoginDate || todayStr()),
            holdings: state.life.holdings || {},
            watchlist: state.life.watchlist || ['MORO', 'CAFE'],
            loans: state.life.loans || [],
            events: state.life.events || [],
        }
        : createDefaultBankLifeState(state.lastLoginDate || todayStr(), hasOldShopProgress);
    return { ...state, life, dataVersion: Math.max(state.dataVersion || 0, BANK_LIFE_VERSION) };
}

function buildShopProducts(businessTypeId: string) {
    const tpl = BUSINESS_TEMPLATES.find(b => b.id === businessTypeId) || BUSINESS_TEMPLATES[0];
    return tpl.products.map(p => ({ ...p, stock: 8 }));
}

export function openLifeShop(life: BankLifeState, businessTypeId: string, shopName: string): BankLifeState {
    const tpl = BUSINESS_TEMPLATES.find(b => b.id === businessTypeId) || BUSINESS_TEMPLATES[0];
    const name = shopName.trim() || tpl.name;
    return {
        ...life,
        shopUnlocked: true,
        shopBusinessType: tpl.id,
        shopBusinessName: name,
        shopProducts: buildShopProducts(tpl.id),
        shopCustomers: tpl.customerGroups,
        shopEvents: [{ id: genId('life'), dateStr: life.dateStr, title: '准备开张', detail: `${name} 的第一批货已经上架。`, tone: 'good' }],
        events: pushEvent(life.events, { dateStr: life.dateStr, title: '小店开张', detail: `${name} 开始营业，主打${tpl.name}。`, tone: 'good', amount: -SHOP_UNLOCK_COST }),
    };
}

function ensureMarketDetail(market: BankStockQuote[], dateStr: string): BankStockQuote[] {
    return market.map(q => {
        const base = BASE_STOCKS.find(s => s.symbol === q.symbol);
        const history = q.history?.length ? q.history : buildStockHistory(q.symbol, q.price || base?.price || 10, q.risk || base?.risk || 3, dateStr);
        const last = history[history.length - 1];
        const prev = history[history.length - 2];
        return {
            ...q,
            history,
            intraday: q.intraday?.length ? q.intraday : buildIntraday(q.symbol, last?.close || q.price, dateStr, q.risk),
            eventTags: q.eventTags || base?.eventTags || [],
            price: q.price || last?.close || base?.price || 1,
            previousPrice: q.previousPrice || prev?.close || q.price || base?.previousPrice || 1,
        };
    });
}

export function getJobsByCategory(category: string): BankJobPosting[] {
    if (!category || category === '全部') return JOB_POSTINGS;
    return JOB_POSTINGS.filter(j => j.category === category);
}

function buildInterviewQuestions(posting: BankJobPosting, seedKey: string) {
    const base = [
        `为什么想做「${posting.title}」？`,
        `遇到${posting.riskTags[0] || '高压情况'}时你会怎么处理？`,
        `你最能匹配这个岗位的经验是什么？`,
    ];
    if (posting.category === '技术') base[1] = '如果线上页面突然白屏，你会先检查什么？';
    if (posting.category === '餐饮') base[1] = '高峰期同时有三桌催单，你会怎么排优先级？';
    if (posting.category === '销售') base[1] = '客户只看不买时，你会怎么继续跟进？';
    if (posting.black) base[1] = '对方要求先交费用或无薪试岗，你准备怎么判断？';
    return base.map((question, idx) => ({
        id: `q-${idx + 1}`,
        question,
        score: Math.round(55 + seededNoise(`${seedKey}:q:${idx}`) * 35),
    }));
}

export function startJobApplication(life: BankLifeState, posting: BankJobPosting): { life: BankLifeState; application: BankJobApplication } {
    const app: BankJobApplication = {
        id: genId('jobapp'),
        postingId: posting.id,
        title: posting.title,
        employer: posting.employer,
        status: 'rejected',
        stage: 'submitted',
        score: 0,
        dateStr: life.dateStr,
        questions: buildInterviewQuestions(posting, `${life.dateStr}:${posting.id}:${life.jobHistory.length}`),
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
    const app = life.jobHistory.find(a => a.id === applicationId);
    const posting = app ? JOB_POSTINGS.find(j => j.id === app.postingId) : undefined;
    if (!app || !posting) return { life, balanceDelta: 0 };
    const seed = seededNoise(`${life.dateStr}:${app.id}:${app.stage}:${answer.length}`);
    const exp = life.experience[posting.category] || 0;
    const answerBonus = clamp(answer.trim().length / 120, 0, 0.16);
    const baseChance = clamp(0.52 + (posting.successBias || 0) + exp * 0.018 + answerBonus - (life.fatigue > 78 ? 0.1 : 0), 0.1, 0.94);
    const score = Math.round(clamp((app.score || 45) + 18 + answerBonus * 100 + (seed - 0.5) * 22, 0, 100));
    let balanceDelta = 0;
    let nextApp: BankJobApplication = { ...app, score };
    const questions = nextApp.questions || buildInterviewQuestions(posting, app.id);
    const updateHistory = (updated: BankJobApplication) => life.jobHistory.map(a => a.id === updated.id ? updated : a);

    if (app.stage === 'submitted' || !app.stage) {
        nextApp = { ...nextApp, stage: 'screening', message: `${posting.employer} 正在看你的简历，关键要求是：${posting.requirements.join('、')}。` };
    } else if (app.stage === 'screening') {
        if (posting.black && seed < 0.2) {
            balanceDelta = -Math.min(walletBalance, Math.round(posting.salaryMin * 0.12));
            nextApp = { ...nextApp, stage: 'scammed', status: 'scammed', riskNote: '对方先收费用后失联。', message: '这次踩坑了，先交的费用没能追回。' };
        } else if (seed > baseChance + 0.16) {
            nextApp = { ...nextApp, stage: 'rejected', status: 'rejected', message: `${posting.employer} 没有约面，先换个方向继续找。` };
        } else {
            nextApp = { ...nextApp, stage: 'assessment', message: posting.payCycle === 'daily' ? '对方约你试岗半天，表现好就能当天排班。' : '进入笔试/能力测试，答完再等面试。' };
        }
    } else if (app.stage === 'assessment') {
        const idx = questions.findIndex(q => !q.answer);
        const nextQuestions = idx >= 0
            ? questions.map((q, i) => i === idx ? { ...q, answer: answer || '现场完成了基础测试。', score: Math.round(score) } : q)
            : questions;
        nextApp = { ...nextApp, questions: nextQuestions, stage: 'interview', message: '测评通过，进入面试。' };
    } else if (app.stage === 'interview') {
        const answered = questions.filter(q => q.answer).length;
        const finalChance = clamp(baseChance + answered * 0.04 + (score - 60) / 260, 0.08, 0.96);
        if (posting.black && seed < 0.32) {
            nextApp = { ...nextApp, stage: 'trial', status: 'trial', riskNote: '条款里有押金、拖欠或无薪试岗风险。', message: `${posting.employer} 给了试用机会，但条款要盯紧。` };
        } else if (seed < finalChance) {
            const offerSalary = posting.payCycle === 'daily'
                ? Math.round((posting.salaryMin + posting.salaryMax) / 2)
                : Math.round(posting.salaryMin + (posting.salaryMax - posting.salaryMin) * clamp(score / 100, 0.25, 0.9));
            nextApp = { ...nextApp, stage: 'offer', status: 'hired', offerSalary, message: `${posting.employer} 发来 Offer，薪资约 ¥${offerSalary}${posting.payCycle === 'daily' ? '/天' : '/月'}。` };
        } else {
            nextApp = { ...nextApp, stage: 'rejected', status: 'rejected', message: `面试结束后，${posting.employer} 选择了其他候选人。` };
        }
    } else if (app.stage === 'offer') {
        nextApp = { ...nextApp, stage: 'hired', status: 'hired', message: `${posting.title} 已入职，明天开始计算收入。` };
    }

    const hired = nextApp.stage === 'hired' || nextApp.stage === 'trial';
    const nextLife: BankLifeState = {
        ...life,
        currentJob: hired ? { ...posting, startedAt: life.dateStr, accruedWage: 0, daysWorked: 0, trialUntil: nextApp.stage === 'trial' ? addDays(life.dateStr, 3) : undefined } : life.currentJob,
        fatigue: clamp(life.fatigue + (nextApp.stage === 'scammed' ? 12 : nextApp.stage === 'rejected' ? 4 : 2), 0, 100),
        reputation: clamp(life.reputation + (hired ? 2 : nextApp.stage === 'scammed' ? -2 : 0), 0, 100),
        jobHistory: updateHistory(nextApp).slice(0, 60),
        events: pushEvent(life.events, { dateStr: life.dateStr, title: nextApp.stage === 'scammed' ? '求职踩坑' : '求职进展', detail: nextApp.message, tone: hired ? 'good' : nextApp.stage === 'scammed' ? 'bad' : nextApp.stage === 'rejected' ? 'warn' : 'info', amount: balanceDelta || undefined }),
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
            message = `这份「${posting.title}」踩坑了，押金/培训费被扣走，先记一笔教训。`;
        } else if (seed < 0.48) {
            status = 'trial';
            message = `${posting.employer} 只给了试用机会，条款含糊，要小心拖欠工资。`;
        }
    } else if (status === 'hired' && seed > 0.82) {
        status = 'trial';
        message = `${posting.employer} 愿意让你试用三天，表现好就转正式。`;
    }

    const application: BankJobApplication = {
        id: genId('jobapp'),
        postingId: posting.id,
        title: posting.title,
        employer: posting.employer,
        status,
        stage: status,
        score: Math.round(chance * 100),
        questions: buildInterviewQuestions(posting, `${life.dateStr}:${posting.id}:${life.jobHistory.length}`),
        offerSalary: status === 'hired' || status === 'trial' ? Math.round((posting.salaryMin + posting.salaryMax) / 2) : undefined,
        riskNote: status === 'scammed' ? '押金或培训费用损失。' : posting.black ? '条款需要逐条看清。' : undefined,
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
        events: pushEvent(life.events, { dateStr: life.dateStr, title: status === 'scammed' ? '求职踩坑' : '求职结果', detail: message, tone: status === 'hired' ? 'good' : status === 'scammed' ? 'bad' : 'info', amount: balanceDelta || undefined }),
    };
    return { life: next, application, balanceDelta };
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
    let next: BankLifeState = { ...life, dateStr: nextDate };
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
        next = { ...next, fatigue: clamp(next.fatigue - 8, 0, 100) };
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
    next = { ...next, events: [...dayEvents.reverse(), ...next.events].slice(0, 80) };
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

export function buyStock(life: BankLifeState, symbol: string, amount: number): { life: BankLifeState; cost: number; shares: number } {
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
    return {
        life: { ...life, holdings: { ...life.holdings, [symbol]: holding }, watchlist: Array.from(new Set([symbol, ...life.watchlist])) },
        cost,
        shares,
    };
}

export function sellStock(life: BankLifeState, symbol: string, shares: number): { life: BankLifeState; revenue: number; soldShares: number } {
    const quote = life.stockMarket.find(s => s.symbol === symbol);
    const prev = life.holdings[symbol];
    if (!quote || !prev || shares <= 0) return { life, revenue: 0, soldShares: 0 };
    const soldShares = Math.min(prev.shares, shares);
    const fee = Math.max(1, Math.round(soldShares * quote.price * 0.003));
    const revenue = roundMoney(soldShares * quote.price - fee);
    const remain = roundMoney(prev.shares - soldShares);
    const holdings = { ...life.holdings };
    if (remain <= 0) delete holdings[symbol];
    else holdings[symbol] = { ...prev, shares: remain };
    return { life: { ...life, holdings }, revenue, soldShares };
}

export function foundCompany(life: BankLifeState, name: string, direction: string): BankLifeState {
    const company: BankCompanyState = {
        id: genId('company'),
        name: name.trim() || `${direction}小公司`,
        direction,
        cash: COMPANY_FOUND_COST,
        reputation: 45,
        employees: 1,
        stress: 20,
        cumulativeProfit: 0,
        foundedAt: life.dateStr,
        cashflow: [],
        orders: [],
        risks: ['现金流', '获客', '交付'],
    };
    return {
        ...life,
        company,
        events: pushEvent(life.events, { dateStr: life.dateStr, title: '公司成立', detail: `${company.name} 开张了，方向是${direction}。`, tone: 'good', amount: -COMPANY_FOUND_COST }),
    };
}

export function applyCompanyIssue(life: BankLifeState, optionId: string): BankLifeState {
    const company = life.company;
    const issue = company?.pendingIssue;
    if (!company || !issue) return life;
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
    return {
        ...life,
        company: nextCompany,
        events: pushEvent(life.events, { dateStr: life.dateStr, title: issue.title, detail: `你选择了「${opt.label}」。`, tone: opt.cashDelta >= 0 ? 'good' : 'info', amount: opt.cashDelta }),
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

function buildRepaymentPlan(amount: number, startDate: string, days: number) {
    const parts = days >= 80 ? 3 : days >= 40 ? 2 : 1;
    const step = Math.max(1, Math.floor(days / parts));
    return Array.from({ length: parts }, (_, idx) => ({
        dueDate: addDays(startDate, step * (idx + 1)),
        amount: roundMoney(amount / parts),
        status: 'pending' as const,
    }));
}

export function borrowLoan(life: BankLifeState, channel: BankLoanChannel, amount: number): { life: BankLifeState; loan: BankLoan } {
    const product = LOAN_PRODUCTS[channel];
    const loan: BankLoan = {
        id: genId('loan'),
        channel,
        productName: product.name,
        principal: amount,
        outstanding: amount,
        interestDue: 0,
        dailyRate: product.dailyRate,
        borrowedAt: life.dateStr,
        dueDate: addDays(life.dateStr, product.days),
        overdueDays: 0,
        note: product.name,
        reviewStatus: 'approved',
        contractTerms: product.terms,
        repaymentPlan: buildRepaymentPlan(amount, life.dateStr, product.days),
    };
    return {
        loan,
        life: {
            ...life,
            loans: [loan, ...life.loans],
            events: pushEvent(life.events, { dateStr: life.dateStr, title: '借款到账', detail: `${loan.note} ¥${amount} 已到账。`, tone: channel === 'shady' ? 'warn' : 'good', amount }),
        },
    };
}

export function repayLoan(life: BankLifeState, loanId: string, amount: number): { life: BankLifeState; paid: number } {
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
    return {
        paid,
        life: {
            ...life,
            loans,
            events: pushEvent(life.events, { dateStr: life.dateStr, title: remain <= 0 ? '贷款结清' : '还了一笔贷款', detail: remain <= 0 ? `${loan.note} 已结清。` : `${loan.note} 剩余约 ¥${remain}。`, tone: 'good', amount: -paid }),
        },
    };
}

export function channelLabel(channel: BankLoanChannel): string {
    if (channel === 'bank') return '银行';
    if (channel === 'formal') return '正规渠道';
    return '高利贷';
}
