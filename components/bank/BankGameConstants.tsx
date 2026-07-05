
import { ShopRecipe, ShopStaff, RoomLayout, DollhouseState } from '../../types';
import { BANK_PIXEL_STICKER_LIBRARY, bankPixelRef } from './bankPixelArt';

// Pixel Art Assets
export const BANK_ASSETS = {
    // Backgrounds (Patterns)
    floors: {
        wood: 'repeating-linear-gradient(0deg, #c19a6b 0px, #c19a6b 4px, #a67c52 5px)',
        tile: 'conic-gradient(from 90deg at 2px 2px, #fdf6e3 90deg, #eee8d5 0) 0 0/20px 20px',
        check: 'conic-gradient(#eee8d5 90deg, #fdf6e3 90deg 180deg, #eee8d5 180deg 270deg, #fdf6e3 270deg) 0 0 / 40px 40px'
    },
    // Furniture Icons
    furniture: {
        table: bankPixelRef('furniture/round-table', 96),
        counter: bankPixelRef('furniture/counter', 128),
        plant: bankPixelRef('furniture/plant', 64),
        window: bankPixelRef('furniture/window-awning', 128),
        rug: bankPixelRef('furniture/rug-round', 96)
    }
};

export const SHOP_RECIPES: ShopRecipe[] = [
    { id: 'recipe-coffee-001', name: '手冲咖啡', icon: bankPixelRef('recipe/coffee', 64), cost: 0, appeal: 10, isUnlocked: true, price: 18 },
    { id: 'recipe-cake-001', name: '草莓蛋糕', icon: bankPixelRef('recipe/cake', 64), cost: 50, appeal: 20, isUnlocked: false, price: 32 },
    { id: 'recipe-tea-001', name: '伯爵红茶', icon: bankPixelRef('recipe/tea', 64), cost: 80, appeal: 25, isUnlocked: false, price: 22 },
    { id: 'recipe-donut-001', name: '甜甜圈', icon: bankPixelRef('recipe/donut', 64), cost: 120, appeal: 30, isUnlocked: false, price: 16 },
    { id: 'recipe-icecream-001', name: '抹茶冰淇淋', icon: bankPixelRef('recipe/icecream', 64), cost: 200, appeal: 40, isUnlocked: false, price: 28 },
    { id: 'recipe-pudding-001', name: '焦糖布丁', icon: bankPixelRef('recipe/pudding', 64), cost: 300, appeal: 50, isUnlocked: false, price: 26 },
    { id: 'recipe-cocktail-001', name: '特调气泡水', icon: bankPixelRef('recipe/cocktail', 64), cost: 500, appeal: 80, isUnlocked: false, price: 38 },
];

// --- 库存 / 进货（经营深度）---------------------------------------------------
// 经营游戏的核心循环：进货(花钱补库存) → 营业(卖出扣库存) → 利润(进钱包)。
// 库存与钱包直接挂钩——进货从钱包扣钱，卖货把钱赚回来，毛利来自「进货价 < 售价」。
export const STARTING_STOCK = 12;     // 商品上架时附赠的起始库存（让新店能先开张）
export const RESTOCK_BATCH = 20;      // 一次进货补充的份数
export const STOCK_CAP = 200;         // 单品库存上限（防止无限囤货）
export const DAILY_STOCK_FLOOR = 5;   // 每日登录把在售商品补到至少这么多（保底，避免彻底断货卡死）

/** 商品售价（全局统一口径：优先 price，否则按人气折算）。进货价与营业收入都以它为唯一来源。 */
export const recipePrice = (r: { price?: number; appeal: number }): number =>
    r.price ?? Math.max(10, Math.round(r.appeal * 0.8));
/** 进货单价：售价的四成，留出六成毛利；最低 1 */
export const restockUnitCost = (r: { price?: number; appeal: number }): number =>
    Math.max(1, Math.round(recipePrice(r) * 0.4));
/** 一次进货（RESTOCK_BATCH 份）的总花费 */
export const restockBatchCost = (r: { price?: number; appeal: number }): number =>
    restockUnitCost(r) * RESTOCK_BATCH;

// --- 店铺升级（经营深度）-----------------------------------------------------
// 花钱包的钱给店铺升级，提升「客流」(每轮营业客人数) 与「档次溢价」(营业收入加成)，
// 顺带提高过夜营业额。是钱包利润的再投资出口。
export const MAX_SHOP_LEVEL = 8;
/** 从 level 升到 level+1 的花费（递增，从钱包扣） */
export const shopUpgradeCost = (level: number): number => 200 * Math.max(1, level);
/** 店铺档次溢价：营业总收入按此百分比加成（与口碑加成叠加） */
export const shopLevelBonusPct = (level: number): number => Math.max(0, (level - 1) * 6);
/** 等级带来的额外客流（每轮营业多接待的客人数） */
export const shopLevelExtraCustomers = (level: number): number => Math.max(0, level - 1);
/** 过夜营业额的等级倍率 */
export const shopLevelPassiveMult = (level: number): number => 1 + Math.max(0, level - 1) * 0.15;

// --- 回头客 / VIP（经营深度）-------------------------------------------------
// 顾客成功消费会被记住；到访够多就成「常客」，再多成「VIP」。
// 常客/VIP 小费更勤更高、评分更稳，且有更高概率「回头」光顾，让营业越做越熟客。
export const REGULAR_VISITS = 3;  // 到访达到此值 → 常客
export const VIP_VISITS = 8;      // 到访达到此值 → VIP
export const MAX_REGULARS = 60;   // 常客表上限（按到访次数保留 Top N，防止无限膨胀）
/** 根据到访次数判定忠诚档位 */
export const regularTier = (visits: number): 'new' | 'regular' | 'vip' =>
    visits >= VIP_VISITS ? 'vip' : visits >= REGULAR_VISITS ? 'regular' : 'new';

// --- 挂机营业额（idle 收益）-------------------------------------------------
// 离店期间店铺持续累计「挂机营业额」，回来点金币收进钱包。攒满约 IDLE_CAP_HOURS
// 小时就停（idle 游戏的存储上限，催你常回来看看），需有店员才产出。
export const IDLE_CAP_HOURS = 8;
/** 每小时挂机营业额（随人气与店铺等级提升） */
export const idleRatePerHour = (appeal: number, level: number): number =>
    Math.max(1, Math.floor(appeal * 0.18 * shopLevelPassiveMult(level)));
/** 挂机营业额上限（满了就停止累计） */
export const idleCap = (appeal: number, level: number): number =>
    idleRatePerHour(appeal, level) * IDLE_CAP_HOURS;

// --- 天气 / 限时事件（经营变数）---------------------------------------------
// 每隔约 4 小时随机切换一种天气/事件，影响客流(营业人数)与挂机产出，给经营加变数。
export interface WeatherDef {
    id: string; label: string; emoji: string;
    trafficMult: number;  // 客流倍率（营业人数）
    idleMult: number;     // 挂机产出倍率
    tipBias: number;      // 额外小费倾向（0~1，加到给小费概率上）
    note: string;
    weight: number;       // 随机权重
}
export const WEATHER_TYPES: WeatherDef[] = [
    { id: 'sunny', label: '晴天', emoji: '☀️', trafficMult: 1.05, idleMult: 1.05, tipBias: 0, note: '阳光正好，生意不错', weight: 30 },
    { id: 'cloudy', label: '阴天', emoji: '⛅', trafficMult: 0.9, idleMult: 1, tipBias: 0, note: '不温不火的一天', weight: 20 },
    { id: 'rain', label: '雨天', emoji: '🌧️', trafficMult: 0.7, idleMult: 0.9, tipBias: 0.12, note: '雨天客人少，但来的都想多坐会儿', weight: 18 },
    { id: 'weekend', label: '周末', emoji: '🛍️', trafficMult: 1.25, idleMult: 1.15, tipBias: 0, note: '逛街的人多，客流旺', weight: 17 },
    { id: 'festival', label: '节日', emoji: '🎉', trafficMult: 1.45, idleMult: 1.3, tipBias: 0.05, note: '节日气氛拉满，人气爆棚！', weight: 9 },
    { id: 'snow', label: '下雪', emoji: '❄️', trafficMult: 0.8, idleMult: 0.95, tipBias: 0.15, note: '下雪天，热饮格外好卖', weight: 6 },
];
export const WEATHER_DURATION_MS = 4 * 60 * 60 * 1000; // 每段天气约 4 小时
export const getWeatherDef = (id?: string): WeatherDef =>
    WEATHER_TYPES.find(w => w.id === id) || WEATHER_TYPES[0];
/** 按权重随机一种天气 id */
export const rollWeatherId = (): string => {
    const total = WEATHER_TYPES.reduce((s, w) => s + w.weight, 0);
    let r = Math.random() * total;
    for (const w of WEATHER_TYPES) { if ((r -= w.weight) <= 0) return w.id; }
    return WEATHER_TYPES[0].id;
};

// 营业时光顾的 NPC 顾客池（emoji 头像，无需网络）
export const NPC_CUSTOMERS: { name: string; avatar: string }[] = [
    { name: '上班族小林', avatar: '🧑‍💼' },
    { name: '画画的姑娘', avatar: '👩‍🎨' },
    { name: '遛狗的大叔', avatar: '🧔' },
    { name: '放学的学生', avatar: '🎒' },
    { name: '赶稿的编辑', avatar: '🤓' },
    { name: '健身教练', avatar: '💪' },
    { name: '隔壁的奶奶', avatar: '👵' },
    { name: '快递小哥', avatar: '📦' },
    { name: '背包客', avatar: '🧗' },
    { name: '猫咖常客', avatar: '🐱' },
    { name: '附近的程序员', avatar: '💻' },
    { name: '咖啡发烧友', avatar: '☕' },
    { name: '约会的情侣', avatar: '💑' },
    { name: '加班的白领', avatar: '🌙' },
    { name: '带娃的妈妈', avatar: '🤱' },
    { name: '路过的游客', avatar: '📷' },
    { name: '写小说的', avatar: '✍️' },
    { name: '考研党', avatar: '📚' },
    { name: '退休教师', avatar: '🧓' },
    { name: '网红博主', avatar: '🤳' },
    { name: '钢琴老师', avatar: '🎹' },
    { name: '花店老板', avatar: '💐' },
    { name: '出租司机', avatar: '🚕' },
    { name: '医学生', avatar: '🩺' },
    { name: '街头艺人', avatar: '🎸' },
    { name: '咖啡评测员', avatar: '📝' },
    { name: '失恋的人', avatar: '💔' },
    { name: '面试归来', avatar: '👔' },
    { name: '插画师', avatar: '🖌️' },
    { name: '旅居数字游民', avatar: '🌏' },
];

// 「碎碎念」气泡台词：戳一戳演员、或闲时随机冒泡，让店子像活的。
export const CUSTOMER_QUIPS = [
    '这家氛围绝了', '拍照真好看📷', 'wifi 密码是多少呀', '老板再来一杯！', '续杯续杯～',
    '今天也要好好生活', '比上班香多了', '约会圣地实锤', '排队也值了', '下次带闺蜜来',
    '这拉花舍不得喝', '社恐角落坐一下', '充电的地方有吗', '隔壁那桌好吵', '我可以住在这吗',
];
export const STAFF_QUIPS = [
    '今天客人好多呀～', '咖啡豆又要订啦', '老板要不要尝尝新品？', '让我歇会儿…脚酸',
    '这桌拉花我超满意', '吧台擦得锃亮✨', '又来熟客了，开心', '奶泡今天很听话',
    '快打烊了吧…还没', '我是不是该加薪了（小声）', '上新品我第一个试吃', '猫又在偷懒了',
];
export const PET_QUIPS = [
    '喵～', '（蹭了蹭你）', '打工使我快乐（并不）', '鱼干在哪里…', '今天也要看好店喵',
    '困了，趴一会儿', '客人摸了我三下', '老板，加鸡腿', '本喵今日营业额贡献+1', 'zzz…',
];

// 营业「翻车」台词（店员累了会失误，偶发差评/丢小费，让经营更真实）
export const MISHAP_REVIEWS = [
    '等了好久，{p}还上错了…', '店员手忙脚乱，{p}洒了一点', '太忙了顾不过来，体验打折',
    '排队太久，{p}都凉了', '点的不是这个呀，不过算了',
];

// 评价文案模板（{p}=点的商品）。按星级取不同口吻。
const REVIEW_BY_STAR: Record<number, string[]> = {
    5: ['{p}绝了，下次还来！', '环境太舒服，{p}也好喝，必须五星⭐', '店员超亲切，{p}份量很足～', '一进门就被治愈了，{p}好评！', '本店之光{p}，已安利给同事'],
    4: ['{p}不错，就是稍微等了一下', '味道在线，会再来的', '{p}挺好喝，位子要是再多就好了', '整体满意，{p}加点料更棒'],
    3: ['{p}一般般，普普通通', '还行吧，没太多惊喜', '{p}中规中矩，价格还行', '凑合，下次试试别的'],
    2: ['等太久了，{p}都不热乎了', '今天店员好像很累，体验打折', '{p}有点敷衍，希望改进'],
    1: ['生意太忙顾不过来，{p}上错了', '排队排到怀疑人生，{p}也一般', '体验不太好，下次再看看'],
};

const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

/** 按星级与商品名生成一条评价文案 */
export const buildReviewText = (rating: number, productName: string): string => {
    const pool = REVIEW_BY_STAR[Math.max(1, Math.min(5, rating))] || REVIEW_BY_STAR[3];
    return pick(pool).replace('{p}', productName);
};

/** 店员失误时的吐槽文案（{p}=点的商品） */
export const buildMishapText = (productName: string): string =>
    pick(MISHAP_REVIEWS).replace('{p}', productName);

export const AVAILABLE_STAFF: Omit<ShopStaff, 'hireDate' | 'fatigue'>[] = [
    { id: 'staff-dog-01', name: '柴犬服务生', avatar: bankPixelRef('staff/dog', 64), role: 'waiter', maxFatigue: 120 },
    { id: 'staff-bear-01', name: '棕熊大厨', avatar: bankPixelRef('staff/bear', 64), role: 'chef', maxFatigue: 150 },
    { id: 'staff-rabbit-01', name: '兔兔前台', avatar: bankPixelRef('staff/rabbit', 64), role: 'waiter', maxFatigue: 80 },
    { id: 'staff-penguin-01', name: '企鹅采购', avatar: bankPixelRef('staff/penguin', 64), role: 'manager', maxFatigue: 110 },
];

// --- DOLLHOUSE ROOM LAYOUTS ---
export const ROOM_LAYOUTS: RoomLayout[] = [
    {
        id: 'layout-cafe',
        name: '咖啡吧台',
        icon: bankPixelRef('furniture/counter', 96),
        description: '经典咖啡店格局，带吧台和窗户',
        apCost: 0,
        floorWidthRatio: 1,
        floorDepthRatio: 1,
        hasCounter: true,
        hasWindow: true,
    },
    {
        id: 'layout-kitchen',
        name: '后厨',
        icon: bankPixelRef('furniture/kitchen-stove', 96),
        description: '宽敞的厨房空间',
        apCost: 100,
        floorWidthRatio: 1,
        floorDepthRatio: 0.8,
        hasCounter: true,
        hasWindow: false,
    },
    {
        id: 'layout-lounge',
        name: '休息室',
        icon: bankPixelRef('furniture/sofa', 96),
        description: '温馨的休息区，适合放沙发',
        apCost: 150,
        floorWidthRatio: 1,
        floorDepthRatio: 1,
        hasCounter: false,
        hasWindow: true,
    },
    {
        id: 'layout-storage',
        name: '储藏室',
        icon: bankPixelRef('furniture/storage-crates', 96),
        description: '小型储物间',
        apCost: 80,
        floorWidthRatio: 0.7,
        floorDepthRatio: 0.7,
        hasCounter: false,
        hasWindow: false,
    },
    {
        id: 'layout-vip',
        name: 'VIP包间',
        icon: bankPixelRef('effect/sparkles', 64),
        description: '高级包间，适合放高端装饰',
        apCost: 300,
        floorWidthRatio: 1,
        floorDepthRatio: 1,
        hasCounter: false,
        hasWindow: true,
    },
    {
        id: 'layout-garden',
        name: '空中花园',
        icon: bankPixelRef('furniture/outdoor-planter', 96),
        description: '二楼露天阳台风格',
        apCost: 250,
        floorWidthRatio: 1,
        floorDepthRatio: 1,
        hasCounter: false,
        hasWindow: true,
    },
];

// --- WALLPAPER / FLOOR PRESETS ---
export const WALLPAPER_PRESETS = [
    { id: 'wp-pixel-mint', name: '像素薄荷墙', style: 'repeating-linear-gradient(90deg, #9bcac0 0 14px, #87b8ae 14px 16px), repeating-linear-gradient(0deg, transparent 0 14px, rgba(34,27,27,0.16) 14px 16px)' },
    { id: 'wp-pixel-sky', name: '像素蓝墙', style: 'repeating-linear-gradient(90deg, #9ac2d7 0 14px, #7fb0ca 14px 16px), repeating-linear-gradient(0deg, transparent 0 14px, rgba(34,27,27,0.14) 14px 16px)' },
    { id: 'wp-pixel-rose', name: '像素莓果墙', style: 'repeating-linear-gradient(90deg, #e4868b 0 14px, #c96d7c 14px 16px), repeating-linear-gradient(0deg, transparent 0 14px, rgba(34,27,27,0.14) 14px 16px)' },
    { id: 'wp-pixel-cream', name: '像素奶砖墙', style: 'repeating-linear-gradient(90deg, #ffedc2 0 14px, #e2c58d 14px 16px), repeating-linear-gradient(0deg, transparent 0 14px, rgba(34,27,27,0.12) 14px 16px)' },
    { id: 'wp-pixel-brick', name: '像素砖墙', style: 'repeating-linear-gradient(0deg, #b36a3e 0 10px, #7b4b32 10px 12px), repeating-linear-gradient(90deg, transparent 0 24px, rgba(34,27,27,0.22) 24px 26px)' },
    { id: 'wp-pixel-stripe', name: '像素条纹', style: 'repeating-linear-gradient(90deg, #fff0c9 0 12px, #6bb5aa 12px 16px, #fff0c9 16px 28px, #e4868b 28px 32px)' },
];

export const FLOOR_PRESETS = [
    { id: 'fl-pixel-green', name: '像素绿地板', style: 'repeating-linear-gradient(90deg, #5c7a62 0 22px, #405c4a 22px 24px), repeating-linear-gradient(0deg, transparent 0 14px, rgba(255,255,255,0.16) 14px 16px)' },
    { id: 'fl-pixel-wood', name: '像素木地板', style: 'repeating-linear-gradient(90deg, #b36a3e 0 22px, #7b4b32 22px 24px), repeating-linear-gradient(0deg, transparent 0 14px, rgba(255,255,255,0.14) 14px 16px)' },
    { id: 'fl-pixel-check', name: '像素棋盘格', style: 'conic-gradient(#ffedc2 90deg, #6bb5aa 90deg 180deg, #ffedc2 180deg 270deg, #6bb5aa 270deg) 0 0 / 24px 24px' },
    { id: 'fl-pixel-slate', name: '像素石板', style: 'repeating-linear-gradient(90deg, #77736b 0 22px, #4a4a45 22px 24px), repeating-linear-gradient(0deg, transparent 0 14px, rgba(255,255,255,0.12) 14px 16px)' },
    { id: 'fl-pixel-rose', name: '像素莓果砖', style: 'conic-gradient(#e4868b 90deg, #813c54 90deg 180deg, #e4868b 180deg 270deg, #813c54 270deg) 0 0 / 24px 24px' },
    { id: 'fl-pixel-tatami', name: '像素榻榻米', style: 'repeating-linear-gradient(0deg, #b7d77a 0 6px, #6cae5f 6px 8px), repeating-linear-gradient(90deg, transparent 0 30px, rgba(34,27,27,0.2) 30px 32px)' },
];

// --- DEFAULT STICKER LIBRARY ---
export const STICKER_LIBRARY = BANK_PIXEL_STICKER_LIBRARY;

// --- INITIAL DOLLHOUSE STATE ---
export const INITIAL_DOLLHOUSE: DollhouseState = {
    rooms: [
        {
            id: 'room-1f-left',
            name: '咖啡店',
            floor: 0,
            position: 'left',
            isUnlocked: true,
            layoutId: 'layout-cafe',
            wallpaperLeft: '#9bcac0',
            wallpaperRight: '#9bcac0',
            floorStyle: '#5c7a62',
            stickers: [],
            staffIds: [],
        },
        {
            id: 'room-1f-right',
            name: '后厨',
            floor: 0,
            position: 'right',
            isUnlocked: false,
            layoutId: 'layout-kitchen',
            stickers: [],
            staffIds: [],
        },
        {
            id: 'room-2f-left',
            name: '休息室',
            floor: 1,
            position: 'left',
            isUnlocked: false,
            layoutId: 'layout-lounge',
            stickers: [],
            staffIds: [],
        },
        {
            id: 'room-2f-right',
            name: 'VIP包间',
            floor: 1,
            position: 'right',
            isUnlocked: false,
            layoutId: 'layout-vip',
            stickers: [],
            staffIds: [],
        },
    ],
    activeRoomId: null,
};
