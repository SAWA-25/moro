
import React from 'react';
import { ShopRecipe, ShopStaff, RoomLayout, DollhouseRoom, DollhouseState } from '../../types';

// Pixel Art Assets (Twemoji CDN for consistent cross-platform rendering)
export const BANK_ASSETS = {
    // Backgrounds (Patterns)
    floors: {
        wood: 'repeating-linear-gradient(0deg, #c19a6b 0px, #c19a6b 4px, #a67c52 5px)',
        tile: 'conic-gradient(from 90deg at 2px 2px, #fdf6e3 90deg, #eee8d5 0) 0 0/20px 20px',
        check: 'conic-gradient(#eee8d5 90deg, #fdf6e3 90deg 180deg, #eee8d5 180deg 270deg, #fdf6e3 270deg) 0 0 / 40px 40px'
    },
    // Furniture Icons (Twemoji CDN)
    furniture: {
        table: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1fa91.png',
        counter: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f371.png',
        plant: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1fab4.png',
        window: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1fa9f.png',
        rug: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f9f6.png'
    }
};

export const SHOP_RECIPES: ShopRecipe[] = [
    { id: 'recipe-coffee-001', name: '手冲咖啡', icon: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/2615.png', cost: 0, appeal: 10, isUnlocked: true, price: 18 },
    { id: 'recipe-cake-001', name: '草莓蛋糕', icon: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f370.png', cost: 50, appeal: 20, isUnlocked: false, price: 32 },
    { id: 'recipe-tea-001', name: '伯爵红茶', icon: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f375.png', cost: 80, appeal: 25, isUnlocked: false, price: 22 },
    { id: 'recipe-donut-001', name: '甜甜圈', icon: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f369.png', cost: 120, appeal: 30, isUnlocked: false, price: 16 },
    { id: 'recipe-icecream-001', name: '抹茶冰淇淋', icon: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f366.png', cost: 200, appeal: 40, isUnlocked: false, price: 28 },
    { id: 'recipe-pudding-001', name: '焦糖布丁', icon: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f36e.png', cost: 300, appeal: 50, isUnlocked: false, price: 26 },
    { id: 'recipe-cocktail-001', name: '特调气泡水', icon: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f379.png', cost: 500, appeal: 80, isUnlocked: false, price: 38 },
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

export const AVAILABLE_STAFF: Omit<ShopStaff, 'hireDate' | 'fatigue'>[] = [
    { id: 'staff-dog-01', name: '柴犬服务生', avatar: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f436.png', role: 'waiter', maxFatigue: 120 },
    { id: 'staff-bear-01', name: '棕熊大厨', avatar: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f43b.png', role: 'chef', maxFatigue: 150 },
    { id: 'staff-rabbit-01', name: '兔兔前台', avatar: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f430.png', role: 'waiter', maxFatigue: 80 },
    { id: 'staff-penguin-01', name: '企鹅采购', avatar: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f427.png', role: 'manager', maxFatigue: 110 },
];

// --- DOLLHOUSE ROOM LAYOUTS ---
export const ROOM_LAYOUTS: RoomLayout[] = [
    {
        id: 'layout-cafe',
        name: '咖啡吧台',
        icon: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/2615.png',
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
        icon: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f373.png',
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
        icon: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f6cb.png',
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
        icon: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f4e6.png',
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
        icon: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/2728.png',
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
        icon: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f33f.png',
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
    { id: 'wp-cream', name: '奶油白', style: 'linear-gradient(180deg, #FEF9F0, #F5EBD8)' },
    { id: 'wp-blush', name: '蜜桃粉', style: 'linear-gradient(180deg, #FFF0F0, #FFE0E0)' },
    { id: 'wp-mint', name: '薄荷绿', style: 'linear-gradient(180deg, #F0FFF4, #C6F6D5)' },
    { id: 'wp-sky', name: '天空蓝', style: 'linear-gradient(180deg, #EBF8FF, #BEE3F8)' },
    { id: 'wp-lavender', name: '薰衣草', style: 'linear-gradient(180deg, #FAF5FF, #E9D8FD)' },
    { id: 'wp-warm', name: '暖阳橘', style: 'linear-gradient(180deg, #FFFAF0, #FEEBC8)' },
    { id: 'wp-brick', name: '复古砖墙', style: 'repeating-linear-gradient(0deg, #D4A574 0px, #D4A574 8px, #C4956A 8px, #C4956A 10px, #DEB587 10px, #DEB587 18px, #C4956A 18px, #C4956A 20px)' },
    { id: 'wp-stripe', name: '条纹', style: 'repeating-linear-gradient(90deg, #FFF8E1 0px, #FFF8E1 12px, #FFE0B2 12px, #FFE0B2 14px)' },
];

export const FLOOR_PRESETS = [
    { id: 'fl-wood', name: '木地板', style: 'linear-gradient(135deg, #C4A77D, #B8956E)' },
    { id: 'fl-tile', name: '白瓷砖', style: 'conic-gradient(from 90deg at 2px 2px, #fdf6e3 90deg, #eee8d5 0) 0 0/20px 20px' },
    { id: 'fl-check', name: '棋盘格', style: 'conic-gradient(#eee8d5 90deg, #fdf6e3 90deg 180deg, #eee8d5 180deg 270deg, #fdf6e3 270deg) 0 0 / 20px 20px' },
    { id: 'fl-dark', name: '深木纹', style: 'linear-gradient(135deg, #8B7355, #6D5A3F)' },
    { id: 'fl-marble', name: '大理石', style: 'linear-gradient(135deg, #F5F5F5 0%, #E0E0E0 25%, #F5F5F5 50%, #EEEEEE 75%, #F5F5F5 100%)' },
    { id: 'fl-tatami', name: '榻榻米', style: 'repeating-linear-gradient(0deg, #C8B88A 0px, #C8B88A 3px, #D4C89A 3px, #D4C89A 6px)' },
];

// --- DEFAULT STICKER LIBRARY ---
export const STICKER_LIBRARY = [
    { id: 'stk-plant1', name: '盆栽', url: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1fab4.png', category: 'decor' },
    { id: 'stk-plant2', name: '仙人掌', url: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f335.png', category: 'decor' },
    { id: 'stk-flower', name: '花束', url: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f490.png', category: 'decor' },
    { id: 'stk-frame', name: '相框', url: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f5bc.png', category: 'wall' },
    { id: 'stk-clock', name: '挂钟', url: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f550.png', category: 'wall' },
    { id: 'stk-lamp', name: '台灯', url: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1fa94.png', category: 'decor' },
    { id: 'stk-sofa', name: '沙发', url: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f6cb.png', category: 'furniture' },
    { id: 'stk-table', name: '桌子', url: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1fa91.png', category: 'furniture' },
    { id: 'stk-book', name: '书架', url: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f4da.png', category: 'furniture' },
    { id: 'stk-coffee', name: '咖啡', url: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/2615.png', category: 'food' },
    { id: 'stk-cake', name: '蛋糕', url: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f370.png', category: 'food' },
    { id: 'stk-candle', name: '蜡烛', url: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f56f.png', category: 'decor' },
    { id: 'stk-rug', name: '地毯', url: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f9f6.png', category: 'floor' },
    { id: 'stk-cat', name: '猫咪', url: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f431.png', category: 'pet' },
    { id: 'stk-star', name: '星星', url: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/2b50.png', category: 'decor' },
    { id: 'stk-heart', name: '爱心', url: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/2764.png', category: 'decor' },
    { id: 'stk-window', name: '窗户', url: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1fa9f.png', category: 'wall' },
    { id: 'stk-sign', name: '招牌', url: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1faa7.png', category: 'wall' },
];

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
            wallpaperLeft: 'linear-gradient(180deg, #FEF9F0, #F5EBD8)',
            wallpaperRight: 'linear-gradient(180deg, #FEF9F0, #F5EBD8)',
            floorStyle: 'linear-gradient(135deg, #C4A77D, #B8956E)',
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
