type BankPixelKind = 'furniture' | 'recipe' | 'staff' | 'effect' | 'ui' | 'product' | 'customer';

export interface BankPixelAssetMeta {
    id: string;
    kind: BankPixelKind;
    defaultSize: 64 | 96 | 128;
    surface?: 'floor' | 'leftWall';
}

export interface BankPixelStickerItem {
    id: string;
    name: string;
    url: string;
    category: string;
}

export interface BankPixelDecorSetDef {
    id: string;
    assetId: string;
    name: string;
    category: 'decor-set';
    theme: string;
    tags: string[];
    size?: 64 | 96 | 128;
    surface?: 'floor' | 'leftWall';
}

export interface BankPixelDailyFurnitureDef {
    id: string;
    assetId: string;
    name: string;
    category: 'daily';
    theme: string;
    tags: string[];
    size?: 64 | 96 | 128;
    surface?: 'floor' | 'leftWall';
}

export interface BankPixelStaffDef {
    id: string;
    assetId: string;
    name: string;
    role: 'manager' | 'waiter' | 'chef';
    maxFatigue: number;
    personality: string;
}

export interface BankPixelCustomerDef {
    id: string;
    assetId: string;
    name: string;
    trait: string;
    reactionTags: string[];
}

const REF_PREFIX = 'bank-pixel:';
const BASE = 32;
const cache = new Map<string, string>();

const P = {
    ink: '#1e1b1a',
    ink2: '#3a2f2a',
    shadow: 'rgba(30, 24, 18, 0.35)',
    cream0: '#fff0c9',
    cream1: '#e2c58d',
    cream2: '#b8874e',
    wood0: '#4a2f25',
    wood1: '#7b4b32',
    wood2: '#b36a3e',
    wood3: '#e09a55',
    teal0: '#1d4f58',
    teal1: '#2f7b80',
    teal2: '#6bb5aa',
    teal3: '#b5dfcf',
    rose0: '#813c54',
    rose1: '#b9576f',
    rose2: '#e4868b',
    rose3: '#ffd0bd',
    amber0: '#8a551d',
    amber1: '#d28a2d',
    amber2: '#ffc857',
    green0: '#214532',
    green1: '#3e7550',
    green2: '#6cae5f',
    green3: '#b7d77a',
    blue0: '#2e4968',
    blue1: '#5c83aa',
    blue2: '#9ac2d7',
    blue3: '#d7eff0',
    gray0: '#4a4a45',
    gray1: '#77736b',
    gray2: '#aaa399',
    gray3: '#d7cfc2',
    white: '#fff8e6',
    black: '#151313',
};

const meta: Record<string, BankPixelAssetMeta> = {};

function addMeta(id: string, kind: BankPixelKind, defaultSize: 64 | 96 | 128, surface?: 'floor' | 'leftWall') {
    meta[id] = { id, kind, defaultSize, surface };
}

type DecorSetItem = [slug: string, name: string, surface?: 'floor' | 'leftWall', size?: 64 | 96 | 128];
type DailyFurnitureItem = [slug: string, name: string, surface?: 'floor' | 'leftWall', size?: 64 | 96 | 128];

const DECOR_SET_CATALOGS: Array<{ key: string; theme: string; tags: string[]; items: DecorSetItem[] }> = [
    {
        key: 'roastery',
        theme: '咖啡烘焙',
        tags: ['装饰套装', '咖啡', '烘焙'],
        items: [
            ['bean-wreath', '咖啡豆花环', 'leftWall', 64],
            ['espresso-neon', '浓缩霓虹灯', 'leftWall', 96],
            ['origin-map', '产区地图', 'leftWall', 96],
            ['steam-lamp', '蒸汽小灯', 'leftWall', 64],
            ['receipt-clip', '小票夹板', 'leftWall', 64],
            ['chalk-arrow', '手写箭头牌', 'leftWall', 64],
            ['menu-ribbons', '菜单丝带', 'leftWall', 96],
            ['latte-frame', '拉花相框', 'leftWall', 64],
            ['burlap-rug', '麻布咖啡地毯', 'floor', 96],
            ['brass-grinder', '黄铜磨豆机', 'floor', 64],
            ['tasting-tray', '杯测托盘', 'floor', 64],
            ['roaster-drum', '迷你烘豆桶', 'floor', 96],
            ['copper-kettle', '铜色手冲壶', 'floor', 64],
            ['jar-shelf', '咖啡罐小架', 'floor', 96],
            ['bean-scoop', '豆勺摆件', 'floor', 64],
            ['crate-stack', '咖啡木箱堆', 'floor', 96],
            ['cupping-spoons', '杯测勺架', 'floor', 64],
            ['sack-pile', '咖啡麻袋堆', 'floor', 96],
        ],
    },
    {
        key: 'bakery',
        theme: '粉彩烘焙',
        tags: ['装饰套装', '甜点', '粉彩'],
        items: [
            ['croissant-garland', '可颂挂串', 'leftWall', 96],
            ['cupcake-sign', '纸杯蛋糕招牌', 'leftWall', 96],
            ['rolling-pin-wall', '擀面杖墙饰', 'leftWall', 64],
            ['recipe-frame', '手写配方框', 'leftWall', 64],
            ['ribbon-awning', '粉彩缎带棚', 'leftWall', 128],
            ['donut-neon', '甜甜圈霓虹', 'leftWall', 64],
            ['whisk-rack', '打蛋器挂架', 'leftWall', 64],
            ['oven-mitt-banner', '隔热手套挂旗', 'leftWall', 96],
            ['gingham-rug', '格纹烘焙地毯', 'floor', 96],
            ['pastel-cake-stand', '粉彩蛋糕座', 'floor', 64],
            ['macaron-tower', '马卡龙塔', 'floor', 64],
            ['sugar-jar', '砂糖玻璃罐', 'floor', 64],
            ['flour-sack', '面粉袋', 'floor', 64],
            ['cookie-tin', '曲奇铁盒', 'floor', 64],
            ['frosting-lamp', '奶油裱花灯', 'floor', 64],
            ['bread-basket', '面包篮', 'floor', 64],
            ['milk-bottle', '牛奶瓶组', 'floor', 64],
            ['pie-display', '派点展示盘', 'floor', 96],
        ],
    },
    {
        key: 'cyber',
        theme: '赛博夜市',
        tags: ['装饰套装', '赛博', '霓虹'],
        items: [
            ['noodle-neon', '霓虹面碗牌', 'leftWall', 96],
            ['holo-menu', '全息菜单屏', 'leftWall', 96],
            ['pixel-kanji', '像素文字牌', 'leftWall', 64],
            ['led-strip', 'LED 灯带', 'leftWall', 96],
            ['ramen-poster', '拉面海报', 'leftWall', 64],
            ['warning-stripes', '警戒条装饰', 'leftWall', 96],
            ['glitch-frame', '故障风相框', 'leftWall', 64],
            ['data-lantern', '数据灯笼', 'leftWall', 64],
            ['circuit-mat', '电路地垫', 'floor', 96],
            ['vending-panel', '迷你贩卖面板', 'floor', 96],
            ['synth-speaker', '合成器音箱', 'floor', 64],
            ['cable-plant', '电线盆栽', 'floor', 64],
            ['prism-cube', '棱镜方块', 'floor', 64],
            ['steam-vent', '蒸汽排风口', 'floor', 64],
            ['robot-mascot', '机器人招财仔', 'floor', 64],
            ['mini-server', '迷你服务器架', 'floor', 96],
            ['chrome-tray', '铬色托盘', 'floor', 64],
            ['noodle-stack', '杯面叠叠', 'floor', 64],
        ],
    },
    {
        key: 'botanica',
        theme: '植物温室',
        tags: ['装饰套装', '植物', '温室'],
        items: [
            ['hanging-fern', '悬挂蕨叶', 'leftWall', 64],
            ['herb-rack', '香草墙架', 'leftWall', 96],
            ['floral-arch', '花藤拱门', 'leftWall', 128],
            ['seed-board', '种子包板', 'leftWall', 64],
            ['greenhouse-pane', '温室窗格', 'leftWall', 96],
            ['leaf-garland', '叶片挂串', 'leftWall', 96],
            ['botany-print', '植物图鉴', 'leftWall', 64],
            ['bee-sign', '小蜜蜂招牌', 'leftWall', 64],
            ['moss-mat', '苔藓地垫', 'floor', 96],
            ['terrarium', '玻璃生态瓶', 'floor', 64],
            ['watering-can', '绿铜浇水壶', 'floor', 64],
            ['clay-pot-stack', '陶盆叠叠', 'floor', 64],
            ['vine-curtain', '藤蔓帘脚', 'floor', 96],
            ['garden-lantern', '花园灯笼', 'floor', 64],
            ['mushroom-stool', '蘑菇小墩', 'floor', 64],
            ['compost-crate', '园艺木箱', 'floor', 96],
            ['butterfly-mobile', '蝴蝶小挂件', 'floor', 64],
            ['herb-jars', '香草罐组', 'floor', 64],
        ],
    },
    {
        key: 'diner',
        theme: '复古餐车',
        tags: ['装饰套装', '复古', '餐车'],
        items: [
            ['vinyl-wall', '黑胶唱片墙', 'leftWall', 64],
            ['milkshake-neon', '奶昔霓虹牌', 'leftWall', 96],
            ['chrome-clock', '铬边挂钟', 'leftWall', 64],
            ['menu-letters', '字母菜单板', 'leftWall', 96],
            ['license-plate', '旧车牌墙饰', 'leftWall', 64],
            ['soda-sign', '汽水招牌', 'leftWall', 96],
            ['checker-banner', '棋盘格挂旗', 'leftWall', 96],
            ['pie-clock', '派形小钟', 'leftWall', 64],
            ['checker-rug', '黑白棋盘地毯', 'floor', 96],
            ['jukebox', '迷你点唱机', 'floor', 96],
            ['booth-pillow', '红卡座靠垫', 'floor', 64],
            ['ketchup-pair', '番茄酱瓶组', 'floor', 64],
            ['starburst-lamp', '星芒台灯', 'floor', 64],
            ['gumball', '糖球机', 'floor', 64],
            ['diner-pennant', '餐车小旗', 'floor', 64],
            ['napkin-holder', '餐巾架', 'floor', 64],
            ['straw-dispenser', '吸管筒', 'floor', 64],
            ['roller-skate', '轮滑鞋摆件', 'floor', 64],
        ],
    },
    {
        key: 'ocean',
        theme: '海边小铺',
        tags: ['装饰套装', '海滨', '蓝白'],
        items: [
            ['shell-garland', '贝壳挂串', 'leftWall', 96],
            ['fish-sign', '小鱼招牌', 'leftWall', 96],
            ['net-wall', '渔网墙饰', 'leftWall', 96],
            ['driftwood-menu', '漂流木菜单', 'leftWall', 96],
            ['starfish-frame', '海星相框', 'leftWall', 64],
            ['anchor-banner', '锚形挂旗', 'leftWall', 96],
            ['seagull-sign', '海鸥小牌', 'leftWall', 64],
            ['tide-clock', '潮汐钟', 'leftWall', 64],
            ['wave-rug', '海浪地毯', 'floor', 96],
            ['lighthouse-lamp', '灯塔小灯', 'floor', 64],
            ['coral-vase', '珊瑚花瓶', 'floor', 64],
            ['boat-shelf', '小船置物架', 'floor', 96],
            ['pearl-jar', '珍珠玻璃罐', 'floor', 64],
            ['surfboard', '冲浪板摆件', 'floor', 96],
            ['blue-lantern', '蓝白提灯', 'floor', 64],
            ['rope-coil', '缆绳卷', 'floor', 64],
            ['ice-bucket', '碎冰小桶', 'floor', 64],
            ['message-bottle', '漂流瓶', 'floor', 64],
        ],
    },
    {
        key: 'moon',
        theme: '月光茶铺',
        tags: ['装饰套装', '月相', '魔法'],
        items: [
            ['moon-lantern', '月亮灯笼', 'leftWall', 64],
            ['star-curtain', '星星帘', 'leftWall', 96],
            ['tarot-menu', '塔罗菜单牌', 'leftWall', 96],
            ['crescent-sign', '弯月招牌', 'leftWall', 96],
            ['constellation-board', '星座板', 'leftWall', 96],
            ['star-garland', '星光挂串', 'leftWall', 96],
            ['oracle-frame', '占卜相框', 'leftWall', 64],
            ['eclipse-clock', '月蚀钟', 'leftWall', 64],
            ['galaxy-rug', '银河地毯', 'floor', 96],
            ['crystal-display', '水晶陈列座', 'floor', 64],
            ['potion-syrups', '魔法糖浆瓶', 'floor', 64],
            ['velvet-runner', '丝绒长垫', 'floor', 128],
            ['incense-burner', '线香炉', 'floor', 64],
            ['cat-statue', '黑猫小像', 'floor', 64],
            ['spell-jar-shelf', '咒语罐小架', 'floor', 96],
            ['midnight-teapot', '午夜茶壶', 'floor', 64],
            ['rune-tray', '符文石托盘', 'floor', 64],
            ['cloud-pillow', '云朵靠垫', 'floor', 64],
        ],
    },
];

export const BANK_PIXEL_DECOR_SET_DEFS: BankPixelDecorSetDef[] = DECOR_SET_CATALOGS.flatMap(group =>
    group.items.map(([slug, name, surface, size]) => ({
        id: `stk-decor-${group.key}-${slug}`,
        assetId: `furniture/decor-${group.key}-${slug}`,
        name,
        category: 'decor-set' as const,
        theme: group.theme,
        tags: ['decor', '装饰', '套装', ...group.tags],
        surface,
        size,
    }))
);

const DAILY_FURNITURE_CATALOGS: Array<{ key: string; theme: string; tags: string[]; items: DailyFurnitureItem[] }> = [
    {
        key: 'front',
        theme: '前台收银',
        tags: ['日常家具', '前台', '收银'],
        items: [
            ['queue-post', '排队立柱', 'floor', 64],
            ['receipt-printer', '小票打印机', 'floor', 64],
            ['card-reader', '刷卡机', 'floor', 64],
            ['cash-drawer', '零钱抽屉', 'floor', 64],
            ['pickup-number', '取餐号码牌', 'leftWall', 64],
            ['order-bell', '叫号铃', 'floor', 64],
            ['clipboard-desk', '桌面夹板', 'floor', 64],
            ['stamp-pad', '印章台', 'floor', 64],
            ['price-tags', '价格标签盒', 'floor', 64],
            ['counter-mat', '收银防滑垫', 'floor', 96],
            ['service-sign', '服务提示牌', 'leftWall', 64],
            ['open-hours', '营业时间牌', 'leftWall', 96],
            ['queue-arrow', '排队箭头牌', 'leftWall', 64],
            ['notice-board', '公告小板', 'leftWall', 96],
            ['coupon-stand', '优惠券立牌', 'floor', 64],
            ['tip-jar', '小费罐', 'floor', 64],
            ['barcode-scanner', '扫码枪', 'floor', 64],
            ['card-tray', '卡片托盘', 'floor', 64],
        ],
    },
    {
        key: 'kitchen',
        theme: '后厨备餐',
        tags: ['日常家具', '后厨', '备餐'],
        items: [
            ['prep-bowl', '备餐大碗', 'floor', 64],
            ['cutting-board', '切菜板', 'floor', 64],
            ['knife-block', '刀具座', 'floor', 64],
            ['spice-rack', '调料墙架', 'leftWall', 96],
            ['apron-hook', '围裙挂钩', 'leftWall', 64],
            ['towel-rail', '擦手巾杆', 'leftWall', 96],
            ['soup-pot', '汤锅', 'floor', 64],
            ['rice-cooker', '电饭锅', 'floor', 64],
            ['hand-mixer', '手持搅拌器', 'floor', 64],
            ['ingredient-bin', '食材分装箱', 'floor', 96],
            ['dish-stack', '盘子叠叠', 'floor', 64],
            ['sauce-bottles', '酱汁瓶组', 'floor', 64],
            ['prep-labels', '备餐标签条', 'leftWall', 64],
            ['freezer-box', '冷冻盒', 'floor', 64],
            ['timer-clock', '厨房计时钟', 'leftWall', 64],
            ['serving-cart', '出餐推车', 'floor', 96],
            ['tray-stack', '托盘叠叠', 'floor', 64],
            ['cooling-rack', '晾凉架', 'floor', 96],
        ],
    },
    {
        key: 'clean',
        theme: '清洁维护',
        tags: ['日常家具', '清洁', '维护'],
        items: [
            ['mop-bucket', '拖把桶', 'floor', 64],
            ['broom-set', '扫帚簸箕组', 'floor', 64],
            ['wet-floor-sign', '小心地滑牌', 'floor', 64],
            ['dustpan', '簸箕', 'floor', 64],
            ['spray-bottle', '清洁喷瓶', 'floor', 64],
            ['towel-stack', '抹布叠叠', 'floor', 64],
            ['trash-bag-roll', '垃圾袋卷', 'floor', 64],
            ['recycle-bin', '分类回收桶', 'floor', 64],
            ['soap-dispenser', '洗手液泵', 'floor', 64],
            ['sanitizer-stand', '消毒液立架', 'floor', 64],
            ['glove-box', '手套盒', 'floor', 64],
            ['tissue-box', '纸巾盒', 'floor', 64],
            ['floor-squeegee', '地刮', 'floor', 64],
            ['window-wiper', '擦窗器', 'floor', 64],
            ['laundry-basket', '待洗布草篮', 'floor', 96],
            ['cleaning-shelf', '清洁用品架', 'floor', 96],
            ['drain-mat', '沥水垫', 'floor', 96],
            ['checklist-board', '清洁检查表', 'leftWall', 96],
        ],
    },
    {
        key: 'stock',
        theme: '仓储补货',
        tags: ['日常家具', '仓储', '补货'],
        items: [
            ['delivery-box', '到货纸箱', 'floor', 96],
            ['parcel-stack', '包裹叠叠', 'floor', 96],
            ['label-printer', '标签打印机', 'floor', 64],
            ['inventory-board', '库存看板', 'leftWall', 96],
            ['rolling-ladder', '补货梯', 'floor', 96],
            ['hand-truck', '手推车', 'floor', 96],
            ['stock-shelf', '库存货架', 'floor', 96],
            ['canister-row', '密封罐排', 'floor', 64],
            ['paper-bag-stack', '纸袋叠叠', 'floor', 64],
            ['cup-sleeve-box', '杯套盒', 'floor', 64],
            ['straw-box', '吸管盒', 'floor', 64],
            ['napkin-box', '餐巾纸盒', 'floor', 64],
            ['takeout-bag', '外带袋架', 'floor', 64],
            ['receipt-rolls', '小票纸卷', 'floor', 64],
            ['seal-stickers', '封口贴卷', 'floor', 64],
            ['price-gun', '标价枪', 'floor', 64],
            ['counter-scale', '台秤', 'floor', 64],
            ['freezer-crate', '冷链周转箱', 'floor', 96],
        ],
    },
    {
        key: 'staff',
        theme: '员工休息',
        tags: ['日常家具', '员工', '休息'],
        items: [
            ['staff-locker', '员工储物柜', 'floor', 96],
            ['break-table', '休息小桌', 'floor', 96],
            ['staff-chair', '员工椅', 'floor', 64],
            ['water-cooler', '饮水机', 'floor', 96],
            ['microwave', '微波炉', 'floor', 64],
            ['lunchbox', '便当盒', 'floor', 64],
            ['thermos', '保温杯', 'floor', 64],
            ['schedule-board', '排班表', 'leftWall', 96],
            ['punch-clock', '打卡钟', 'leftWall', 64],
            ['uniform-hook', '制服挂钩', 'leftWall', 64],
            ['shoe-rack', '换班鞋架', 'floor', 96],
            ['first-aid-kit', '急救箱', 'leftWall', 64],
            ['message-board', '员工留言板', 'leftWall', 96],
            ['charging-station', '充电小站', 'floor', 64],
            ['snack-basket', '零食篮', 'floor', 64],
            ['cushion-bench', '休息长凳', 'floor', 96],
            ['umbrella-hook', '雨伞挂钩', 'leftWall', 64],
            ['staff-mug-row', '员工杯架', 'floor', 64],
        ],
    },
    {
        key: 'customer',
        theme: '顾客便利',
        tags: ['日常家具', '顾客', '便利'],
        items: [
            ['basket-stack', '购物篮叠叠', 'floor', 64],
            ['child-seat', '儿童椅', 'floor', 64],
            ['bag-hook', '包包挂钩', 'leftWall', 64],
            ['coat-bench', '外套长凳', 'floor', 96],
            ['umbrella-basket', '客用伞筐', 'floor', 64],
            ['phone-charger', '客用充电器', 'floor', 64],
            ['water-cups', '自取水杯', 'floor', 64],
            ['tissue-stand', '纸巾立架', 'floor', 64],
            ['menu-holder', '桌面菜单夹', 'floor', 64],
            ['feedback-box', '意见箱', 'floor', 64],
            ['lost-found-box', '失物招领盒', 'floor', 64],
            ['waiting-stool', '等候小凳', 'floor', 64],
            ['stroller-sign', '婴儿车停放牌', 'leftWall', 64],
            ['pet-water-bowl', '宠物水碗', 'floor', 64],
            ['reading-rack', '等候读物架', 'floor', 96],
            ['umbrella-dryer', '雨伞甩干桶', 'floor', 64],
            ['receipt-bin', '小票回收盒', 'floor', 64],
            ['queue-cushion', '排队坐垫', 'floor', 64],
        ],
    },
    {
        key: 'routine',
        theme: '开店收摊',
        tags: ['日常家具', '开店', '收摊'],
        items: [
            ['shop-key-hook', '店钥匙挂板', 'leftWall', 64],
            ['open-sign', '开店翻牌', 'leftWall', 96],
            ['cash-bag', '备用钱袋', 'floor', 64],
            ['apron-stack', '围裙叠叠', 'floor', 64],
            ['daily-ledger', '日营业账本', 'floor', 64],
            ['task-board', '今日任务板', 'leftWall', 96],
            ['delivery-clipboard', '配送夹板', 'floor', 64],
            ['broom-corner', '角落扫帚', 'floor', 64],
            ['folding-sign', '折叠立牌', 'floor', 96],
            ['patio-chair-stack', '外摆椅叠叠', 'floor', 96],
            ['table-number-set', '桌号牌组', 'floor', 64],
            ['reservation-book', '预约本', 'floor', 64],
            ['takeout-shelf', '外带取餐架', 'floor', 96],
            ['courier-bell', '骑手取餐铃', 'floor', 64],
            ['rain-mat', '雨天吸水垫', 'floor', 96],
            ['sunshade-stand', '遮阳伞座', 'floor', 96],
            ['tool-roll', '维修工具卷', 'floor', 64],
            ['closing-box', '打烊收纳箱', 'floor', 96],
        ],
    },
];

export const BANK_PIXEL_DAILY_FURNITURE_DEFS: BankPixelDailyFurnitureDef[] = DAILY_FURNITURE_CATALOGS.flatMap(group =>
    group.items.map(([slug, name, surface, size]) => ({
        id: `stk-daily-${group.key}-${slug}`,
        assetId: `furniture/daily-${group.key}-${slug}`,
        name,
        category: 'daily' as const,
        theme: group.theme,
        tags: ['daily', '日常', '店铺日常', ...group.tags],
        surface,
        size,
    }))
);

export const BANK_PIXEL_STAFF_DEFS: BankPixelStaffDef[] = [
    { id: 'staff-night-manager-01', assetId: 'staff/night-manager', name: '夜班店长澄澄', role: 'manager', maxFatigue: 135, personality: '冷静会控场，擅长晚高峰排班和安抚客人。' },
    { id: 'staff-pastry-chef-01', assetId: 'staff/pastry-chef', name: '奶油主厨米娅', role: 'chef', maxFatigue: 145, personality: '甜品手很稳，喜欢把新品摆得漂漂亮亮。' },
    { id: 'staff-latte-artist-01', assetId: 'staff/latte-artist', name: '拉花师阿岚', role: 'waiter', maxFatigue: 115, personality: '动作轻快，会记住熟客常点的饮品。' },
    { id: 'staff-stock-clerk-01', assetId: 'staff/stock-clerk', name: '补货员小满', role: 'manager', maxFatigue: 125, personality: '对库存数字很敏感，缺料前会先提醒。' },
    { id: 'staff-cleaner-01', assetId: 'staff/cleaner', name: '清洁员明净', role: 'waiter', maxFatigue: 130, personality: '爱把角落擦亮，忙起来也会保持店面清爽。' },
    { id: 'staff-packaging-01', assetId: 'staff/packaging', name: '打包员柚子', role: 'waiter', maxFatigue: 110, personality: '外带袋封得很整齐，适合照顾取餐高峰。' },
    { id: 'staff-dessert-chef-01', assetId: 'staff/dessert-chef', name: '甜品师绵绵', role: 'chef', maxFatigue: 140, personality: '擅长小蛋糕和布丁，做事慢一点但很细。' },
    { id: 'staff-greeter-01', assetId: 'staff/greeter', name: '门迎店员晴子', role: 'waiter', maxFatigue: 105, personality: '笑容很亮，适合招呼排队和安排座位。' },
    { id: 'staff-buyer-01', assetId: 'staff/buyer', name: '采购经理柏舟', role: 'manager', maxFatigue: 120, personality: '会比较成本和品质，擅长给店里挑稳定供货。' },
    { id: 'staff-trainee-01', assetId: 'staff/trainee', name: '新人店员豆豆', role: 'waiter', maxFatigue: 95, personality: '还在学习，但热情很足，适合轻量排班。' },
];

export const BANK_PIXEL_CUSTOMER_DEFS: BankPixelCustomerDef[] = [
    { id: 'customer-office-runner-01', assetId: 'customer/office-runner', name: '赶班白领岚岚', trait: '来得快、看商品标签也快', reactionTags: ['通勤', '外带', '效率'] },
    { id: 'customer-sketch-student-01', assetId: 'customer/sketch-student', name: '速写学生小禾', trait: '会盯着装饰角落找灵感', reactionTags: ['学生', '拍照', '装饰'] },
    { id: 'customer-dog-walker-01', assetId: 'customer/dog-walker', name: '遛狗邻居阿川', trait: '常在门口和休息区停一下', reactionTags: ['邻居', '散步', '熟客'] },
    { id: 'customer-courier-rider-01', assetId: 'customer/courier-rider', name: '风风快递员', trait: '喜欢拿了就走的货架动线', reactionTags: ['外带', '赶时间', '补给'] },
    { id: 'customer-tourist-camera-01', assetId: 'customer/tourist-camera', name: '相机游客南南', trait: '看到好看的货架会想拍照', reactionTags: ['游客', '拍照', '装饰'] },
    { id: 'customer-parent-kid-01', assetId: 'customer/parent-kid', name: '亲子客小满', trait: '会在展示柜前多看一会儿', reactionTags: ['亲子', '甜品', '停留'] },
    { id: 'customer-fitness-coach-01', assetId: 'customer/fitness-coach', name: '健身教练青山', trait: '会留意清爽低负担的商品', reactionTags: ['健康', '饮品', '日常'] },
    { id: 'customer-raincoat-guest-01', assetId: 'customer/raincoat-guest', name: '雨衣客绵绵', trait: '下雨天也会进店避一避', reactionTags: ['雨天', '热饮', '停留'] },
    { id: 'customer-bookworm-01', assetId: 'customer/bookworm', name: '抱书客页页', trait: '偏爱安静角落和书架附近', reactionTags: ['阅读', '安静', '座位'] },
    { id: 'customer-date-planner-01', assetId: 'customer/date-planner', name: '约会策划人栀子', trait: '会挑适合分享的小物和甜品', reactionTags: ['约会', '礼物', '甜品'] },
    { id: 'customer-plant-neighbor-01', assetId: 'customer/plant-neighbor', name: '植物邻居青芽', trait: '会对绿植和自然风装饰有反应', reactionTags: ['植物', '装饰', '邻居'] },
    { id: 'customer-coffee-critic-01', assetId: 'customer/coffee-critic', name: '咖啡点评员摩卡', trait: '会认真观察吧台和新品', reactionTags: ['点评', '饮品', '新品'] },
    { id: 'customer-night-owl-01', assetId: 'customer/night-owl', name: '夜归客阿泊', trait: '喜欢灯光暖一点的角落', reactionTags: ['夜晚', '灯光', '热饮'] },
    { id: 'customer-vlogger-01', assetId: 'customer/vlogger', name: '探店博主莓莓', trait: '会围着招牌和货架找镜头', reactionTags: ['探店', '拍照', '人气'] },
    { id: 'customer-retired-teacher-01', assetId: 'customer/retired-teacher', name: '退休老师方叔', trait: '会慢慢看完菜单和陈列', reactionTags: ['慢逛', '菜单', '熟客'] },
    { id: 'customer-taxi-driver-01', assetId: 'customer/taxi-driver', name: '出租司机老许', trait: '喜欢能快速补能量的东西', reactionTags: ['赶路', '外带', '补给'] },
    { id: 'customer-interviewee-01', assetId: 'customer/interviewee', name: '面试归来安安', trait: '会找让人放松的小物', reactionTags: ['放松', '甜品', '座位'] },
    { id: 'customer-gamer-01', assetId: 'customer/gamer', name: '掌机玩家小电', trait: '喜欢有趣的角落和能量饮品', reactionTags: ['游戏', '饮品', '停留'] },
    { id: 'customer-florist-01', assetId: 'customer/florist', name: '花店老板洛洛', trait: '会注意包装、色彩和香味', reactionTags: ['花艺', '礼物', '装饰'] },
    { id: 'customer-med-student-01', assetId: 'customer/med-student', name: '医学生阿澈', trait: '常买能撑过自习的补给', reactionTags: ['自习', '补给', '夜晚'] },
    { id: 'customer-handmade-fan-01', assetId: 'customer/handmade-fan', name: '手作爱好者柚柚', trait: '会看包装和手作摆件', reactionTags: ['手作', '礼物', '小物'] },
    { id: 'customer-remote-worker-01', assetId: 'customer/remote-worker', name: '远程办公客星回', trait: '会找插座感和安静座位', reactionTags: ['办公', '安静', '座位'] },
    { id: 'customer-cosplay-visitor-01', assetId: 'customer/cosplay-visitor', name: '换装客璃璃', trait: '喜欢有风格主题的店面', reactionTags: ['主题', '拍照', '装饰'] },
    { id: 'customer-budget-hunter-01', assetId: 'customer/budget-hunter', name: '精打细算客豆子', trait: '会比较价格和库存状态', reactionTags: ['价格', '补货', '日常'] },
];

export const BANK_PIXEL_PRODUCT_IDS = [
    'drink-americano', 'drink-latte', 'drink-fruit-tea', 'drink-sparkling-yuzu',
    'snack-skewer', 'snack-noodle', 'snack-box', 'snack-rice-ball',
    'cv-bento', 'cv-drink', 'cv-bundle', 'cv-battery',
    'fl-bouquet', 'fl-mini', 'fl-card', 'fl-dried',
    'ds-roll', 'ds-pudding', 'ds-set', 'ds-macaron',
    'pet-food', 'pet-toy', 'pet-care', 'pet-treats',
    'st-pen', 'st-note', 'st-box', 'st-sticker',
    'sh-book', 'sh-lamp', 'sh-cloth', 'sh-camera',
    'hm-keychain', 'hm-ring', 'hm-custom', 'hm-candle',
    'on-case', 'on-bag', 'on-set', 'on-poster',
] as const;

const FURNITURE: Array<Omit<BankPixelStickerItem, 'url'> & { assetId: string; size?: 64 | 96 | 128; surface?: 'floor' | 'leftWall' }> = [
    { id: 'stk-counter', assetId: 'furniture/counter', name: '像素吧台', category: 'furniture', size: 128 },
    { id: 'stk-display-case', assetId: 'furniture/display-case', name: '甜品展示柜', category: 'furniture', size: 128 },
    { id: 'stk-coffee-machine', assetId: 'furniture/coffee-machine', name: '咖啡机', category: 'furniture', size: 96 },
    { id: 'stk-cashier', assetId: 'furniture/cashier', name: '收银机', category: 'furniture', size: 64 },
    { id: 'stk-round-table', assetId: 'furniture/round-table', name: '圆桌', category: 'furniture', size: 96 },
    { id: 'stk-square-table', assetId: 'furniture/square-table', name: '方桌', category: 'furniture', size: 96 },
    { id: 'stk-chair', assetId: 'furniture/chair', name: '木椅', category: 'furniture', size: 64 },
    { id: 'stk-stool', assetId: 'furniture/stool', name: '吧凳', category: 'furniture', size: 64 },
    { id: 'stk-sofa', assetId: 'furniture/sofa', name: '沙发', category: 'furniture', size: 128 },
    { id: 'stk-booth', assetId: 'furniture/booth', name: '卡座', category: 'furniture', size: 128 },
    { id: 'stk-shelf', assetId: 'furniture/high-shelf', name: '陈列高架', category: 'furniture', size: 96 },
    { id: 'stk-book', assetId: 'furniture/book-shelf', name: '书架', category: 'furniture', size: 96 },
    { id: 'stk-bakery-rack', assetId: 'furniture/bakery-rack', name: '面包架', category: 'furniture', size: 96 },
    { id: 'stk-drink-fridge', assetId: 'furniture/drink-fridge', name: '饮料冰柜', category: 'furniture', size: 96 },
    { id: 'stk-dessert-case', assetId: 'furniture/dessert-case', name: '蛋糕柜', category: 'furniture', size: 128 },
    { id: 'stk-tea-station', assetId: 'furniture/tea-station', name: '茶饮台', category: 'furniture', size: 96 },
    { id: 'stk-stove', assetId: 'furniture/kitchen-stove', name: '后厨炉灶', category: 'furniture', size: 96 },
    { id: 'stk-oven', assetId: 'furniture/oven', name: '烤箱', category: 'furniture', size: 96 },
    { id: 'stk-sink', assetId: 'furniture/sink', name: '水槽', category: 'furniture', size: 96 },
    { id: 'stk-prep-table', assetId: 'furniture/prep-table', name: '备餐台', category: 'furniture', size: 96 },
    { id: 'stk-crates', assetId: 'furniture/storage-crates', name: '储物箱', category: 'furniture', size: 96 },
    { id: 'stk-cake-stand', assetId: 'furniture/cake-stand', name: '蛋糕托盘', category: 'food', size: 64 },
    { id: 'stk-coffee-cup', assetId: 'furniture/coffee-cup', name: '咖啡杯', category: 'food', size: 64 },
    { id: 'stk-pastry-tray', assetId: 'furniture/pastry-tray', name: '点心托盘', category: 'food', size: 64 },
    { id: 'stk-menu-board', assetId: 'furniture/menu-board', name: '菜单板', category: 'wall', size: 96, surface: 'leftWall' },
    { id: 'stk-sign', assetId: 'furniture/wall-sign', name: '招牌', category: 'wall', size: 96, surface: 'leftWall' },
    { id: 'stk-window', assetId: 'furniture/window-awning', name: '遮阳窗', category: 'wall', size: 128, surface: 'leftWall' },
    { id: 'stk-clock', assetId: 'furniture/clock', name: '挂钟', category: 'wall', size: 64, surface: 'leftWall' },
    { id: 'stk-frame', assetId: 'furniture/wall-frame', name: '像素相框', category: 'wall', size: 64, surface: 'leftWall' },
    { id: 'stk-star-lights', assetId: 'furniture/star-lights', name: '星星串灯', category: 'wall', size: 96, surface: 'leftWall' },
    { id: 'stk-neon-heart', assetId: 'furniture/neon-heart', name: '爱心霓虹', category: 'wall', size: 64, surface: 'leftWall' },
    { id: 'stk-pendant-lamp', assetId: 'furniture/pendant-lamp', name: '吊灯', category: 'decor', size: 64, surface: 'leftWall' },
    { id: 'stk-lamp', assetId: 'furniture/table-lamp', name: '台灯', category: 'decor', size: 64 },
    { id: 'stk-floor-lamp', assetId: 'furniture/floor-lamp', name: '落地灯', category: 'decor', size: 96 },
    { id: 'stk-plant1', assetId: 'furniture/plant', name: '盆栽', category: 'decor', size: 64 },
    { id: 'stk-plant2', assetId: 'furniture/cactus', name: '仙人掌', category: 'decor', size: 64 },
    { id: 'stk-flower', assetId: 'furniture/flower-vase', name: '花瓶', category: 'decor', size: 64 },
    { id: 'stk-outdoor-planter', assetId: 'furniture/outdoor-planter', name: '门口花箱', category: 'decor', size: 96 },
    { id: 'stk-rug', assetId: 'furniture/rug-round', name: '圆地毯', category: 'floor', size: 96 },
    { id: 'stk-runner-rug', assetId: 'furniture/rug-runner', name: '长地毯', category: 'floor', size: 128 },
    { id: 'stk-welcome-mat', assetId: 'furniture/welcome-mat', name: '欢迎脚垫', category: 'floor', size: 96 },
    { id: 'stk-chalkboard-stand', assetId: 'furniture/chalkboard-stand', name: '门口小黑板', category: 'decor', size: 96 },
    { id: 'stk-coat-rack', assetId: 'furniture/coat-rack', name: '衣帽架', category: 'decor', size: 96 },
    { id: 'stk-umbrella-stand', assetId: 'furniture/umbrella-stand', name: '伞架', category: 'decor', size: 64 },
    { id: 'stk-trash-bin', assetId: 'furniture/trash-bin', name: '垃圾桶', category: 'decor', size: 64 },
    { id: 'stk-cat', assetId: 'furniture/cat-bed', name: '猫窝', category: 'pet', size: 64 },
    { id: 'stk-star', assetId: 'effect/sparkles', name: '星星', category: 'decor', size: 64 },
    { id: 'stk-heart', assetId: 'effect/heart', name: '爱心', category: 'decor', size: 64 },
];

FURNITURE.push(...BANK_PIXEL_DECOR_SET_DEFS.map(item => ({
    id: item.id,
    assetId: item.assetId,
    name: item.name,
    category: item.category,
    size: item.size,
    surface: item.surface,
})));

FURNITURE.push(...BANK_PIXEL_DAILY_FURNITURE_DEFS.map(item => ({
    id: item.id,
    assetId: item.assetId,
    name: item.name,
    category: item.category,
    size: item.size,
    surface: item.surface,
})));

for (const item of FURNITURE) addMeta(item.assetId, item.assetId.startsWith('effect/') ? 'effect' : 'furniture', item.size || 96, item.surface);

[
    'recipe/coffee', 'recipe/cake', 'recipe/tea', 'recipe/donut', 'recipe/icecream', 'recipe/pudding', 'recipe/cocktail',
].forEach(id => addMeta(id, 'recipe', 64));

[
    'staff/manager', 'staff/waiter', 'staff/chef', 'staff/cat', 'staff/dog', 'staff/bear', 'staff/rabbit', 'staff/penguin', 'staff/generic', 'staff/tired',
].forEach(id => addMeta(id, 'staff', 64));
BANK_PIXEL_STAFF_DEFS.forEach(staff => addMeta(staff.assetId, 'staff', 64));

BANK_PIXEL_PRODUCT_IDS.forEach(id => addMeta(`product/${id}`, 'product', 64));
BANK_PIXEL_CUSTOMER_DEFS.forEach(customer => addMeta(customer.assetId, 'customer', 64));

['effect/heart', 'effect/sparkles', 'effect/zzz', 'effect/guestbook'].forEach(id => addMeta(id, 'effect', 64));
[
    'ui/food', 'ui/transport', 'ui/shopping', 'ui/entertainment', 'ui/bills', 'ui/health', 'ui/education', 'ui/other',
    'ui/sun', 'ui/calendar-week', 'ui/calendar-month', 'ui/budget-good', 'ui/budget-over', 'ui/ai', 'ui/idea',
    'ui/chart', 'ui/memo', 'ui/empty', 'ui/target', 'ui/energy', 'ui/feed', 'ui/invite', 'ui/paw',
].forEach(id => addMeta(id, 'ui', 64));

export const BANK_PIXEL_STICKER_LIBRARY: BankPixelStickerItem[] = FURNITURE.map(item => ({
    id: item.id,
    name: item.name,
    url: bankPixelRef(item.assetId, item.size),
    category: item.category,
}));

export function bankPixelRef(id: string, size?: 64 | 96 | 128): string {
    return `${REF_PREFIX}${id}${size ? `@${size}` : ''}`;
}

export function isBankPixelRef(value?: string | null): value is string {
    return typeof value === 'string' && value.startsWith(REF_PREFIX);
}

export function getBankPixelAssetMeta(value?: string | null): BankPixelAssetMeta | undefined {
    const parsed = parseRef(value) || parseRef(resolveLegacyBankPixelRef(value || ''));
    if (!parsed) return undefined;
    return meta[parsed.id] || { id: parsed.id, kind: parsed.id.split('/')[0] as BankPixelKind, defaultSize: parsed.size };
}

export function isBankBuiltInPixelValue(value?: string | null): boolean {
    return !!(parseRef(value || '') || resolveLegacyBankPixelRef(value || ''));
}

export function resolveBankPixelSrc(value?: string | null, sizeOverride?: 64 | 96 | 128): string | undefined {
    const ref = parseRef(value || '') ? value! : resolveLegacyBankPixelRef(value || '');
    const parsed = parseRef(ref);
    if (!parsed) return undefined;
    const size = sizeOverride || parsed.size || meta[parsed.id]?.defaultSize || 96;
    const key = `${parsed.id}@${size}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const dataUri = createPixelAsset(parsed.id, size);
    cache.set(key, dataUri);
    return dataUri;
}

export function bankPixelStyle(): { imageRendering: 'pixelated' } {
    return { imageRendering: 'pixelated' };
}

export function resolveLegacyBankPixelRef(value?: string | null): string | undefined {
    const key = normalizeLegacyValue(value);
    if (!key) return undefined;
    return LEGACY_PIXEL_MAP[key];
}

function parseRef(value?: string | null): { id: string; size: 64 | 96 | 128 } | undefined {
    if (!isBankPixelRef(value)) return undefined;
    const raw = value.slice(REF_PREFIX.length);
    const [id, sizeRaw] = raw.split('@');
    const size = Number(sizeRaw || meta[id]?.defaultSize || 96);
    return { id, size: size === 64 || size === 128 ? size : 96 };
}

function normalizeLegacyValue(value?: string | null): string {
    const raw = (value || '').trim();
    const match = raw.match(/(?:twemoji\/(?:14\.0\.2\/)?72x72|vendor\/twemoji\/72x72)\/([a-f0-9-]+)\.png/i);
    if (match) return legacyTwemoji(match[1].toLowerCase());
    return raw;
}

function legacyTwemoji(code: string): string {
    return `twemoji:${code.toLowerCase()}`;
}

const LEGACY_PIXEL_MAP: Record<string, string> = {
    [legacyTwemoji('1fab4')]: bankPixelRef('furniture/plant', 64),
    [legacyTwemoji('1f335')]: bankPixelRef('furniture/cactus', 64),
    [legacyTwemoji('1f490')]: bankPixelRef('furniture/flower-vase', 64),
    [legacyTwemoji('1f5bc')]: bankPixelRef('furniture/wall-frame', 64),
    [legacyTwemoji('1f550')]: bankPixelRef('furniture/clock', 64),
    [legacyTwemoji('1fa94')]: bankPixelRef('furniture/table-lamp', 64),
    [legacyTwemoji('1f6cb')]: bankPixelRef('furniture/sofa', 128),
    [legacyTwemoji('1fa91')]: bankPixelRef('furniture/round-table', 96),
    [legacyTwemoji('1f4da')]: bankPixelRef('furniture/book-shelf', 96),
    [legacyTwemoji('2615')]: bankPixelRef('recipe/coffee', 64),
    [legacyTwemoji('1f370')]: bankPixelRef('recipe/cake', 64),
    [legacyTwemoji('1f56f')]: bankPixelRef('furniture/table-lamp', 64),
    [legacyTwemoji('1f9f6')]: bankPixelRef('furniture/rug-round', 96),
    [legacyTwemoji('1f431')]: bankPixelRef('staff/cat', 64),
    [legacyTwemoji('2b50')]: bankPixelRef('effect/sparkles', 64),
    [legacyTwemoji('2764')]: bankPixelRef('effect/heart', 64),
    [legacyTwemoji('1fa9f')]: bankPixelRef('furniture/window-awning', 128),
    [legacyTwemoji('1faa7')]: bankPixelRef('furniture/wall-sign', 96),
    [legacyTwemoji('1f436')]: bankPixelRef('staff/dog', 64),
    [legacyTwemoji('1f43b')]: bankPixelRef('staff/bear', 64),
    [legacyTwemoji('1f430')]: bankPixelRef('staff/rabbit', 64),
    [legacyTwemoji('1f427')]: bankPixelRef('staff/penguin', 64),
    [legacyTwemoji('1f375')]: bankPixelRef('recipe/tea', 64),
    [legacyTwemoji('1f369')]: bankPixelRef('recipe/donut', 64),
    [legacyTwemoji('1f366')]: bankPixelRef('recipe/icecream', 64),
    [legacyTwemoji('1f36e')]: bankPixelRef('recipe/pudding', 64),
    [legacyTwemoji('1f379')]: bankPixelRef('recipe/cocktail', 64),
    [legacyTwemoji('1f4a4')]: bankPixelRef('effect/zzz', 64),
    [legacyTwemoji('1f495')]: bankPixelRef('effect/heart', 64),
    [legacyTwemoji('1f497')]: bankPixelRef('effect/heart', 64),
    [legacyTwemoji('1f496')]: bankPixelRef('effect/heart', 64),
    [legacyTwemoji('1f49d')]: bankPixelRef('effect/heart', 64),
    [legacyTwemoji('1fa77')]: bankPixelRef('effect/heart', 64),
    [legacyTwemoji('2764-fe0f')]: bankPixelRef('effect/heart', 64),
    [legacyTwemoji('2728')]: bankPixelRef('effect/sparkles', 64),
    [legacyTwemoji('1f354')]: bankPixelRef('ui/food', 64),
    [legacyTwemoji('1f697')]: bankPixelRef('ui/transport', 64),
    [legacyTwemoji('1f6cd')]: bankPixelRef('ui/shopping', 64),
    [legacyTwemoji('1f6cd-fe0f')]: bankPixelRef('ui/shopping', 64),
    [legacyTwemoji('1f3ae')]: bankPixelRef('ui/entertainment', 64),
    [legacyTwemoji('1f4f1')]: bankPixelRef('ui/bills', 64),
    [legacyTwemoji('1f48a')]: bankPixelRef('ui/health', 64),
    [legacyTwemoji('1f4e6')]: bankPixelRef('ui/other', 64),
    [legacyTwemoji('2600')]: bankPixelRef('ui/sun', 64),
    [legacyTwemoji('2600-fe0f')]: bankPixelRef('ui/sun', 64),
    [legacyTwemoji('1f4c6')]: bankPixelRef('ui/calendar-week', 64),
    [legacyTwemoji('1f4c5')]: bankPixelRef('ui/calendar-month', 64),
    [legacyTwemoji('1f4aa')]: bankPixelRef('ui/budget-good', 64),
    [legacyTwemoji('1f631')]: bankPixelRef('ui/budget-over', 64),
    [legacyTwemoji('1f916')]: bankPixelRef('ui/ai', 64),
    [legacyTwemoji('1f4a1')]: bankPixelRef('ui/idea', 64),
    [legacyTwemoji('1f4ca')]: bankPixelRef('ui/chart', 64),
    [legacyTwemoji('1f4dd')]: bankPixelRef('ui/memo', 64),
    [legacyTwemoji('1f4ed')]: bankPixelRef('ui/empty', 64),
    [legacyTwemoji('1f3af')]: bankPixelRef('ui/target', 64),
    [legacyTwemoji('1f50b')]: bankPixelRef('ui/energy', 64),
    [legacyTwemoji('1f357')]: bankPixelRef('ui/feed', 64),
    [legacyTwemoji('1f6aa')]: bankPixelRef('ui/invite', 64),
    [legacyTwemoji('1f6ce')]: bankPixelRef('ui/invite', 64),
    [legacyTwemoji('1f6ce-fe0f')]: bankPixelRef('ui/invite', 64),
    [legacyTwemoji('1f43e')]: bankPixelRef('ui/paw', 64),
    [legacyTwemoji('1f425')]: bankPixelRef('staff/cat', 64),
    [legacyTwemoji('1f4d6')]: bankPixelRef('effect/guestbook', 64),
    '☕': bankPixelRef('recipe/coffee', 64),
    '🍰': bankPixelRef('recipe/cake', 64),
    '🍵': bankPixelRef('recipe/tea', 64),
    '🍩': bankPixelRef('recipe/donut', 64),
    '🍦': bankPixelRef('recipe/icecream', 64),
    '🍮': bankPixelRef('recipe/pudding', 64),
    '🍹': bankPixelRef('recipe/cocktail', 64),
    '🐱': bankPixelRef('staff/cat', 64),
    '🙂': bankPixelRef('staff/generic', 64),
    '✨': bankPixelRef('effect/sparkles', 64),
    '⭐': bankPixelRef('effect/sparkles', 64),
    '❤️': bankPixelRef('effect/heart', 64),
    '❤': bankPixelRef('effect/heart', 64),
    '🍔': bankPixelRef('ui/food', 64),
    '🚗': bankPixelRef('ui/transport', 64),
    '🛍️': bankPixelRef('ui/shopping', 64),
    '🛍': bankPixelRef('ui/shopping', 64),
    '🎮': bankPixelRef('ui/entertainment', 64),
    '📱': bankPixelRef('ui/bills', 64),
    '💊': bankPixelRef('ui/health', 64),
    '📚': bankPixelRef('furniture/book-shelf', 96),
    '📦': bankPixelRef('ui/other', 64),
    '☀️': bankPixelRef('ui/sun', 64),
    '☀': bankPixelRef('ui/sun', 64),
    '📆': bankPixelRef('ui/calendar-week', 64),
    '📅': bankPixelRef('ui/calendar-month', 64),
    '💪': bankPixelRef('ui/budget-good', 64),
    '😱': bankPixelRef('ui/budget-over', 64),
    '🤖': bankPixelRef('ui/ai', 64),
    '💡': bankPixelRef('ui/idea', 64),
    '📊': bankPixelRef('ui/chart', 64),
    '📝': bankPixelRef('ui/memo', 64),
    '📭': bankPixelRef('ui/empty', 64),
    '🎯': bankPixelRef('ui/target', 64),
    '🔋': bankPixelRef('ui/energy', 64),
    '🍗': bankPixelRef('ui/feed', 64),
    '🚪': bankPixelRef('ui/invite', 64),
    '🛎️': bankPixelRef('ui/invite', 64),
    '🛎': bankPixelRef('ui/invite', 64),
    '🐾': bankPixelRef('ui/paw', 64),
    '🐥': bankPixelRef('staff/cat', 64),
    '📖': bankPixelRef('effect/guestbook', 64),
};

function createPixelAsset(id: string, size: 64 | 96 | 128): string {
    if (typeof document === 'undefined') return svgFallback(id, size);

    const small = document.createElement('canvas');
    small.width = BASE;
    small.height = BASE;
    const s = small.getContext('2d');
    if (!s) return svgFallback(id, size);
    s.imageSmoothingEnabled = false;
    s.clearRect(0, 0, BASE, BASE);
    drawAsset(s, id);

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return svgFallback(id, size);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, size, size);
    return canvas.toDataURL('image/png');
}

function svgFallback(id: string, size: number): string {
    const hue = hash(id) % 360;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32" shape-rendering="crispEdges"><rect width="32" height="32" fill="hsl(${hue} 45% 24%)"/><rect x="4" y="4" width="24" height="24" fill="hsl(${hue} 65% 62%)"/><rect x="8" y="8" width="16" height="16" fill="#fff0c9"/></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function hash(text: string): number {
    let h = 0;
    for (let i = 0; i < text.length; i++) h = ((h << 5) - h + text.charCodeAt(i)) | 0;
    return Math.abs(h);
}

function r(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function p(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
    r(ctx, x, y, 1, 1, color);
}

function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string, outline = P.ink) {
    r(ctx, x, y, w, h, outline);
    r(ctx, x + 1, y + 1, w - 2, h - 2, fill);
}

function shadow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h = 2) {
    r(ctx, x, y, w, h, P.shadow);
}

function shine(ctx: CanvasRenderingContext2D, x: number, y: number, w: number) {
    r(ctx, x, y, w, 1, 'rgba(255,255,230,0.6)');
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string) {
    const dx = Math.sign(x2 - x1);
    const dy = Math.sign(y2 - y1);
    let x = x1;
    let y = y1;
    p(ctx, x, y, color);
    while (x !== x2 || y !== y2) {
        if (x !== x2) x += dx;
        if (y !== y2) y += dy;
        p(ctx, x, y, color);
    }
}

function drawAsset(ctx: CanvasRenderingContext2D, id: string) {
    if (id.startsWith('recipe/')) return drawRecipe(ctx, id.slice(7));
    if (id.startsWith('staff/')) return drawStaff(ctx, id.slice(6));
    if (id.startsWith('effect/')) return drawEffect(ctx, id.slice(7));
    if (id.startsWith('ui/')) return drawUi(ctx, id.slice(3));
    if (id.startsWith('product/')) return drawProduct(ctx, id.slice(8));
    if (id.startsWith('customer/')) return drawCustomer(ctx, id.slice(9));
    return drawFurniture(ctx, id.replace(/^furniture\//, ''));
}

function drawProduct(ctx: CanvasRenderingContext2D, id: string) {
    const colors = [P.teal2, P.rose2, P.amber2, P.green2, P.blue2, P.cream1, P.wood2, P.rose3];
    const accent = colors[hash(id) % colors.length];
    const accent2 = colors[(hash(`${id}:b`) + 3) % colors.length];
    shadow(ctx, 7, 28, 18);

    if (id.startsWith('drink-')) {
        if (id.includes('sparkling')) {
            box(ctx, 12, 8, 8, 18, P.blue2);
            r(ctx, 13, 10, 6, 4, P.blue3);
            p(ctx, 15, 15, P.white);
            p(ctx, 18, 19, P.white);
            r(ctx, 14, 5, 4, 4, P.green2);
        } else {
            drawCup(ctx, 10, 12, 1, id.includes('latte') ? P.cream1 : id.includes('fruit') ? P.rose3 : P.cream0);
            r(ctx, 12, 10, 8, 2, id.includes('fruit') ? P.green2 : P.wood2);
            if (id.includes('latte')) drawSpark(ctx, 22, 12, P.amber2);
            if (id.includes('fruit')) {
                p(ctx, 13, 16, P.rose2);
                p(ctx, 17, 18, P.amber2);
            }
        }
        return;
    }

    if (id.startsWith('snack-')) {
        if (id.includes('skewer')) {
            line(ctx, 8, 24, 24, 8, P.wood1);
            [9, 13, 17, 21].forEach((x, i) => box(ctx, x, 20 - i * 4, 4, 4, i % 2 ? P.rose2 : P.amber2));
        } else if (id.includes('noodle')) {
            box(ctx, 8, 17, 16, 8, P.rose2);
            r(ctx, 10, 15, 12, 3, P.cream0);
            line(ctx, 12, 13, 21, 8, P.wood1);
        } else if (id.includes('rice')) {
            r(ctx, 10, 18, 12, 9, P.ink);
            r(ctx, 11, 17, 10, 9, P.cream0);
            r(ctx, 14, 20, 4, 4, P.green0);
        } else {
            box(ctx, 7, 13, 18, 12, P.amber1);
            r(ctx, 10, 16, 12, 2, P.cream0);
            r(ctx, 11, 20, 9, 2, P.rose2);
        }
        return;
    }

    if (id.startsWith('cv-')) {
        if (id.includes('drink')) {
            box(ctx, 11, 8, 10, 18, P.blue1);
            r(ctx, 13, 11, 6, 6, P.blue3);
        } else if (id.includes('battery')) {
            box(ctx, 9, 13, 16, 9, P.gray2);
            r(ctx, 25, 16, 2, 3, P.ink);
            r(ctx, 11, 16, 8, 3, P.green2);
        } else if (id.includes('bundle')) {
            box(ctx, 7, 11, 18, 14, P.cream1);
            r(ctx, 9, 14, 14, 2, P.rose2);
            r(ctx, 10, 19, 10, 2, P.teal2);
        } else {
            box(ctx, 8, 12, 16, 12, P.cream0);
            r(ctx, 10, 15, 12, 3, P.green2);
            r(ctx, 12, 19, 8, 2, P.rose2);
        }
        return;
    }

    if (id.startsWith('fl-')) {
        if (id.includes('card')) {
            box(ctx, 8, 9, 16, 16, P.cream0);
            drawMiniFlower(ctx, 16, 15, P.rose2);
            r(ctx, 11, 21, 10, 1, P.ink2);
        } else {
            r(ctx, 14, 18, 4, 9, id.includes('dried') ? P.wood2 : P.green1);
            for (let i = 0; i < (id.includes('mini') ? 4 : 7); i++) {
                const x = 9 + i * 2 + (i % 2);
                const y = 10 + (i % 3);
                line(ctx, 16, 21, x, y, P.green1);
                drawMiniFlower(ctx, x, y, id.includes('dried') ? P.cream1 : colors[i % colors.length]);
            }
            r(ctx, 11, 22, 10, 4, P.rose3);
        }
        return;
    }

    if (id.startsWith('ds-')) {
        if (id.includes('macaron')) {
            [8, 13, 18].forEach((x, i) => {
                r(ctx, x, 16 + i % 2, 6, 3, colors[i]);
                r(ctx, x, 19 + i % 2, 6, 3, P.cream0);
            });
        } else if (id.includes('pudding')) {
            r(ctx, 10, 14, 12, 10, P.amber2);
            r(ctx, 12, 11, 8, 4, P.wood2);
            r(ctx, 11, 23, 10, 3, P.cream0);
        } else if (id.includes('set')) {
            drawCup(ctx, 7, 13, 1, P.teal3);
            drawMiniCake(ctx, 20, 15, P.rose2, 1);
        } else {
            box(ctx, 8, 15, 16, 8, P.cream0);
            r(ctx, 10, 13, 12, 4, P.rose3);
            r(ctx, 11, 18, 10, 2, P.wood2);
        }
        return;
    }

    if (id.startsWith('pet-')) {
        if (id.includes('toy')) {
            r(ctx, 9, 15, 14, 8, accent);
            r(ctx, 7, 17, 4, 4, accent2);
            r(ctx, 21, 17, 4, 4, accent2);
        } else if (id.includes('care')) {
            box(ctx, 9, 10, 14, 15, P.blue2);
            r(ctx, 14, 7, 4, 4, P.gray2);
            r(ctx, 13, 16, 6, 2, P.white);
            r(ctx, 15, 14, 2, 6, P.white);
        } else {
            box(ctx, 8, 11, 16, 15, id.includes('treats') ? P.rose2 : P.green2);
            r(ctx, 11, 16, 10, 2, P.cream0);
            drawMiniFlower(ctx, 16, 22, P.amber2);
        }
        return;
    }

    if (id.startsWith('st-')) {
        if (id.includes('pen')) {
            line(ctx, 8, 23, 23, 8, P.blue1);
            line(ctx, 10, 25, 25, 10, P.amber2);
            r(ctx, 22, 7, 3, 3, P.gray2);
        } else if (id.includes('note')) {
            box(ctx, 9, 7, 14, 20, P.cream0);
            r(ctx, 12, 11, 8, 1, P.blue1);
            r(ctx, 12, 15, 8, 1, P.blue1);
            r(ctx, 12, 19, 7, 1, P.rose2);
        } else {
            box(ctx, 8, 12, 16, 12, id.includes('sticker') ? P.rose3 : P.amber2);
            r(ctx, 11, 15, 10, 2, P.cream0);
            drawSpark(ctx, 21, 11, P.teal2);
        }
        return;
    }

    if (id.startsWith('sh-')) {
        if (id.includes('lamp')) {
            r(ctx, 15, 11, 2, 13, P.wood1);
            box(ctx, 10, 8, 12, 7, P.amber2);
            r(ctx, 11, 24, 10, 3, P.wood2);
        } else if (id.includes('camera')) {
            box(ctx, 8, 13, 17, 11, P.gray1);
            r(ctx, 13, 10, 7, 4, P.gray2);
            r(ctx, 14, 16, 6, 6, P.blue2);
        } else if (id.includes('cloth')) {
            r(ctx, 10, 10, 12, 15, accent);
            r(ctx, 8, 13, 4, 8, accent2);
            r(ctx, 20, 13, 4, 8, accent2);
        } else {
            box(ctx, 8, 9, 16, 17, P.wood2);
            r(ctx, 11, 12, 10, 2, P.cream0);
            r(ctx, 11, 17, 8, 2, P.cream1);
        }
        return;
    }

    if (id.startsWith('hm-')) {
        if (id.includes('ring')) {
            r(ctx, 11, 12, 10, 10, P.amber2);
            r(ctx, 14, 15, 4, 4, P.cream0);
            drawSpark(ctx, 21, 11, P.blue3);
        } else if (id.includes('candle')) {
            box(ctx, 11, 13, 10, 12, P.rose3);
            r(ctx, 14, 9, 4, 4, P.amber2);
            p(ctx, 16, 8, P.white);
        } else if (id.includes('keychain')) {
            r(ctx, 10, 9, 8, 8, P.amber2);
            r(ctx, 12, 11, 4, 4, P.cream0);
            line(ctx, 16, 17, 22, 25, P.wood1);
        } else {
            box(ctx, 8, 11, 16, 14, P.cream1);
            r(ctx, 15, 11, 2, 14, P.rose2);
            r(ctx, 8, 17, 16, 2, P.rose2);
        }
        return;
    }

    if (id.startsWith('on-')) {
        if (id.includes('case')) {
            box(ctx, 11, 7, 10, 20, P.blue1);
            r(ctx, 14, 10, 4, 10, accent);
            p(ctx, 16, 24, P.gray3);
        } else if (id.includes('bag')) {
            box(ctx, 8, 13, 16, 12, P.cream1);
            line(ctx, 12, 13, 12, 9, P.wood1);
            line(ctx, 20, 13, 20, 9, P.wood1);
            r(ctx, 13, 10, 7, 2, P.wood1);
        } else if (id.includes('poster')) {
            box(ctx, 9, 7, 14, 20, P.cream0);
            r(ctx, 11, 10, 10, 7, accent);
            r(ctx, 12, 20, 8, 1, P.ink2);
        } else {
            box(ctx, 7, 11, 18, 14, P.rose3);
            r(ctx, 10, 14, 12, 3, P.cream0);
            drawSpark(ctx, 23, 11, P.amber2);
        }
        return;
    }

    box(ctx, 8, 11, 16, 14, accent);
    r(ctx, 11, 15, 10, 2, P.cream0);
}

function drawUi(ctx: CanvasRenderingContext2D, id: string) {
    shadow(ctx, 8, 28, 16);
    switch (id) {
        case 'food':
            r(ctx, 8, 13, 16, 4, P.amber2);
            r(ctx, 7, 17, 18, 3, P.green2);
            r(ctx, 7, 20, 18, 3, P.wood1);
            r(ctx, 8, 23, 16, 3, P.amber1);
            p(ctx, 12, 14, P.cream0);
            p(ctx, 17, 14, P.cream0);
            break;
        case 'transport':
            box(ctx, 6, 15, 20, 8, P.blue1);
            r(ctx, 10, 10, 10, 6, P.blue2);
            r(ctx, 12, 11, 3, 4, P.blue3);
            r(ctx, 17, 11, 3, 4, P.blue3);
            r(ctx, 9, 23, 4, 4, P.ink);
            r(ctx, 20, 23, 4, 4, P.ink);
            r(ctx, 10, 24, 2, 2, P.gray3);
            r(ctx, 21, 24, 2, 2, P.gray3);
            break;
        case 'shopping':
            box(ctx, 9, 12, 14, 14, P.rose1);
            line(ctx, 12, 12, 12, 8, P.ink2);
            line(ctx, 20, 12, 20, 8, P.ink2);
            r(ctx, 13, 8, 7, 2, P.ink2);
            r(ctx, 12, 18, 8, 2, P.rose3);
            break;
        case 'entertainment':
            box(ctx, 6, 13, 20, 10, P.teal1);
            r(ctx, 10, 16, 2, 5, P.cream0);
            r(ctx, 8, 18, 6, 1, P.cream0);
            p(ctx, 20, 16, P.amber2);
            p(ctx, 22, 18, P.rose2);
            p(ctx, 18, 19, P.green3);
            break;
        case 'bills':
            box(ctx, 10, 5, 12, 22, P.gray1);
            r(ctx, 12, 8, 8, 15, P.blue2);
            p(ctx, 16, 25, P.gray3);
            r(ctx, 14, 10, 4, 2, P.blue3);
            break;
        case 'health':
            r(ctx, 8, 17, 7, 8, P.rose2);
            r(ctx, 15, 17, 9, 8, P.cream0);
            r(ctx, 9, 14, 14, 3, P.ink);
            r(ctx, 10, 13, 12, 3, P.rose3);
            r(ctx, 13, 11, 6, 2, P.cream0);
            break;
        case 'education':
            box(ctx, 7, 8, 8, 18, P.blue1);
            box(ctx, 16, 8, 9, 18, P.rose1);
            r(ctx, 10, 11, 3, 1, P.cream0);
            r(ctx, 18, 12, 5, 1, P.cream0);
            r(ctx, 15, 9, 2, 16, P.ink2);
            break;
        case 'other':
            box(ctx, 8, 12, 16, 13, P.wood2);
            line(ctx, 8, 12, 16, 7, P.wood3);
            line(ctx, 24, 12, 16, 7, P.wood1);
            r(ctx, 13, 15, 6, 2, P.cream0);
            break;
        case 'sun':
            r(ctx, 13, 8, 6, 16, P.amber2);
            r(ctx, 8, 13, 16, 6, P.amber2);
            r(ctx, 11, 11, 10, 10, P.amber1);
            r(ctx, 13, 13, 6, 6, P.cream0);
            break;
        case 'calendar-week':
        case 'calendar-month':
            box(ctx, 7, 8, 18, 18, P.cream0);
            r(ctx, 7, 8, 18, 5, id === 'calendar-week' ? P.teal1 : P.rose1);
            r(ctx, 10, 5, 2, 5, P.gray1);
            r(ctx, 20, 5, 2, 5, P.gray1);
            for (let i = 0; i < (id === 'calendar-week' ? 5 : 9); i++) {
                const x = 10 + (i % 3) * 5;
                const y = 15 + Math.floor(i / 3) * 4;
                r(ctx, x, y, 2, 2, i % 2 ? P.teal2 : P.amber2);
            }
            break;
        case 'budget-good':
            r(ctx, 9, 23, 4, 3, P.green1);
            r(ctx, 14, 18, 4, 8, P.green2);
            r(ctx, 19, 12, 4, 14, P.green3);
            line(ctx, 10, 14, 17, 7, P.amber2);
            line(ctx, 17, 7, 23, 13, P.amber2);
            break;
        case 'budget-over':
            r(ctx, 15, 6, 2, 13, P.rose2);
            r(ctx, 13, 19, 6, 2, P.rose2);
            r(ctx, 11, 22, 10, 4, P.rose0);
            p(ctx, 13, 12, P.ink);
            p(ctx, 20, 12, P.ink);
            break;
        case 'ai':
            box(ctx, 8, 9, 16, 14, P.gray2);
            r(ctx, 13, 5, 6, 3, P.gray1);
            r(ctx, 15, 3, 2, 3, P.gray1);
            p(ctx, 12, 15, P.teal3);
            p(ctx, 20, 15, P.teal3);
            r(ctx, 13, 19, 7, 1, P.ink2);
            break;
        case 'idea':
            r(ctx, 12, 8, 8, 9, P.amber2);
            r(ctx, 10, 11, 12, 4, P.amber2);
            r(ctx, 13, 18, 6, 3, P.gray2);
            r(ctx, 14, 22, 4, 3, P.gray1);
            p(ctx, 15, 10, P.white);
            break;
        case 'chart':
            r(ctx, 8, 22, 4, 4, P.teal2);
            r(ctx, 14, 17, 4, 9, P.amber2);
            r(ctx, 20, 11, 4, 15, P.rose2);
            r(ctx, 7, 26, 18, 2, P.ink2);
            break;
        case 'memo':
            box(ctx, 9, 6, 14, 21, P.cream0);
            r(ctx, 12, 10, 8, 1, P.ink2);
            r(ctx, 12, 14, 7, 1, P.ink2);
            r(ctx, 12, 18, 9, 1, P.ink2);
            r(ctx, 12, 22, 5, 1, P.rose2);
            break;
        case 'empty':
            box(ctx, 7, 12, 18, 12, P.cream0);
            line(ctx, 7, 12, 16, 18, P.wood2);
            line(ctx, 25, 12, 16, 18, P.wood2);
            r(ctx, 11, 8, 10, 5, P.blue2);
            r(ctx, 13, 9, 6, 1, P.blue3);
            break;
        case 'target':
            r(ctx, 8, 8, 16, 16, P.rose0);
            r(ctx, 10, 10, 12, 12, P.cream0);
            r(ctx, 12, 12, 8, 8, P.rose2);
            r(ctx, 14, 14, 4, 4, P.cream0);
            p(ctx, 16, 16, P.ink);
            break;
        case 'energy':
            box(ctx, 6, 12, 19, 10, P.green2);
            r(ctx, 25, 15, 2, 4, P.ink);
            r(ctx, 9, 15, 12, 4, P.green3);
            break;
        case 'feed':
            r(ctx, 9, 21, 15, 4, P.wood2);
            r(ctx, 11, 17, 11, 5, P.amber2);
            r(ctx, 14, 13, 7, 4, P.cream0);
            p(ctx, 12, 18, P.rose2);
            p(ctx, 20, 18, P.rose2);
            break;
        case 'invite':
            box(ctx, 10, 7, 12, 20, P.wood2);
            r(ctx, 18, 16, 2, 2, P.amber2);
            line(ctx, 5, 17, 12, 17, P.teal2);
            line(ctx, 9, 13, 12, 17, P.teal2);
            line(ctx, 9, 21, 12, 17, P.teal2);
            break;
        case 'paw':
            r(ctx, 12, 17, 8, 7, P.wood2);
            r(ctx, 9, 11, 4, 4, P.wood3);
            r(ctx, 14, 8, 4, 5, P.wood3);
            r(ctx, 20, 11, 4, 4, P.wood3);
            r(ctx, 13, 18, 6, 4, P.rose3);
            break;
        default:
            drawEffect(ctx, 'sparkles');
    }
}

function shopDecorPalette(id: string) {
    if (id.includes('cyber')) return { dark: P.blue0, mid: P.teal1, light: P.teal3, accent: P.rose2 };
    if (id.includes('bakery')) return { dark: P.rose0, mid: P.rose1, light: P.rose3, accent: P.amber2 };
    if (id.includes('botanica')) return { dark: P.green0, mid: P.green1, light: P.green3, accent: P.amber2 };
    if (id.includes('diner')) return { dark: P.rose0, mid: P.rose2, light: P.cream0, accent: P.teal2 };
    if (id.includes('ocean')) return { dark: P.blue0, mid: P.blue1, light: P.blue3, accent: P.amber2 };
    if (id.includes('moon')) return { dark: P.ink2, mid: P.blue0, light: P.blue3, accent: P.amber2 };
    return { dark: P.wood0, mid: P.wood2, light: P.cream1, accent: P.green2 };
}

function drawShopDecor(ctx: CanvasRenderingContext2D, id: string) {
    const pal = shopDecorPalette(id);
    const isWall = /wreath|neon|map|clip|arrow|ribbons|frame|garland|sign|wall|poster|strip|banner|curtain|board|awning|rack|print|letters|plate|menu|net|clock/.test(id);
    shadow(ctx, isWall ? 8 : 7, isWall ? 26 : 28, isWall ? 16 : 18);

    if (/rug|mat|runner/.test(id)) {
        const wide = id.includes('runner');
        const x = wide ? 3 : 5;
        const w = wide ? 26 : 22;
        r(ctx, x, 18, w, 8, P.ink);
        r(ctx, x + 1, 19, w - 2, 6, pal.mid);
        r(ctx, x + 4, 21, w - 8, 2, pal.light);
        for (let i = 0; i < w - 2; i += 4) p(ctx, x + 1 + i, 18, pal.accent);
        return;
    }

    if (/neon|strip/.test(id)) {
        box(ctx, 6, 10, 20, 12, P.black);
        r(ctx, 8, 12, 16, 2, pal.accent);
        r(ctx, 10, 16, 12, 2, pal.light);
        p(ctx, 9, 20, P.white);
        p(ctx, 23, 20, pal.accent);
        return;
    }

    if (/garland|ribbons|banner|curtain/.test(id)) {
        line(ctx, 5, 8, 27, 9, P.wood0);
        for (let x = 7; x <= 25; x += 4) {
            line(ctx, x, 9, x + 1, 18, pal.dark);
            r(ctx, x - 1, 18, 4, 4, x % 8 === 0 ? pal.accent : pal.light);
        }
        if (id.includes('curtain')) {
            r(ctx, 8, 10, 7, 16, pal.mid);
            r(ctx, 17, 10, 7, 16, pal.dark);
            r(ctx, 11, 12, 2, 12, pal.light);
        }
        return;
    }

    if (/sign|menu|board|map|poster|frame|plate|print/.test(id)) {
        box(ctx, 7, 6, 18, 18, id.includes('neon') ? P.black : P.cream0);
        r(ctx, 9, 8, 14, 4, pal.mid);
        r(ctx, 10, 14, 11, 2, pal.dark);
        r(ctx, 10, 18, 8, 2, pal.accent);
        if (id.includes('clock')) {
            r(ctx, 12, 9, 8, 8, P.white);
            line(ctx, 16, 13, 16, 10, P.ink);
            line(ctx, 16, 13, 19, 14, P.ink);
        }
        return;
    }

    if (/lamp|lantern|light/.test(id)) {
        r(ctx, 15, id.includes('moon') ? 8 : 12, 2, 15, P.ink2);
        r(ctx, 10, 24, 12, 3, pal.dark);
        box(ctx, 10, 9, 12, 8, pal.accent);
        r(ctx, 12, 11, 8, 3, P.cream0);
        p(ctx, 16, 8, P.white);
        return;
    }

    if (/plant|fern|herb|terrarium|vase|pot|jars|bottle/.test(id)) {
        box(ctx, 10, 20, 12, 7, id.includes('bottle') || id.includes('jar') ? P.blue2 : pal.mid);
        for (let i = 0; i < 6; i++) {
            const x = 9 + i * 3;
            line(ctx, 16, 20, x, 8 + (i % 3), P.green1);
            p(ctx, x, 8 + (i % 3), i % 2 ? P.green3 : pal.accent);
        }
        if (id.includes('crystal') || id.includes('potion')) {
            r(ctx, 12, 11, 4, 8, pal.light);
            r(ctx, 17, 9, 4, 10, pal.accent);
        }
        return;
    }

    if (/shelf|display|rack|crate|stack|pile|server|vending|jukebox|machine|tower/.test(id)) {
        box(ctx, 7, 8, 18, 19, pal.dark);
        r(ctx, 9, 12, 14, 2, P.ink2);
        r(ctx, 9, 18, 14, 2, P.ink2);
        for (let i = 0; i < 8; i++) {
            const x = 10 + (i % 4) * 3;
            const y = 9 + Math.floor(i / 4) * 7;
            r(ctx, x, y, 2, 5, [pal.light, pal.mid, pal.accent, P.cream0][i % 4]);
        }
        if (id.includes('jukebox') || id.includes('vending')) r(ctx, 11, 7, 10, 5, pal.accent);
        return;
    }

    if (/tray|bowl|tin|bucket|holder|dispenser|kettle|grinder|cup|teapot|scoop|spoons/.test(id)) {
        r(ctx, 8, 23, 16, 3, P.gray2);
        box(ctx, 10, 15, 12, 8, pal.mid);
        r(ctx, 12, 12, 8, 4, pal.light);
        p(ctx, 21, 18, pal.accent);
        if (/cup|teapot|kettle/.test(id)) drawCup(ctx, 11, 12, 1, pal.light);
        return;
    }

    if (/wreath|arch|mobile|shell|fish|anchor|star|moon|crystal|rune|cat|mascot|statue|robot|ball|skate|pillow/.test(id)) {
        if (/moon|star/.test(id)) {
            r(ctx, 12, 8, 9, 12, pal.light);
            r(ctx, 17, 7, 8, 13, P.black);
            drawSpark(ctx, 8, 13, pal.accent);
            drawSpark(ctx, 23, 18, pal.light);
        } else if (/wreath|shell/.test(id)) {
            for (let i = 0; i < 12; i++) {
                const x = 16 + Math.round(Math.cos(i / 12 * Math.PI * 2) * 8);
                const y = 16 + Math.round(Math.sin(i / 12 * Math.PI * 2) * 8);
                r(ctx, x, y, 3, 3, i % 2 ? pal.light : pal.accent);
            }
        } else {
            box(ctx, 10, 13, 12, 12, pal.mid);
            r(ctx, 12, 10, 8, 5, pal.light);
            p(ctx, 14, 17, P.ink);
            p(ctx, 19, 17, P.ink);
        }
        return;
    }

    box(ctx, 9, 12, 14, 13, pal.mid);
    r(ctx, 11, 9, 10, 5, pal.light);
    p(ctx, 16, 17, pal.accent);
}

function shopDailyPalette(id: string) {
    if (id.includes('kitchen')) return { dark: P.wood0, mid: P.amber1, light: P.cream0, accent: P.rose2 };
    if (id.includes('clean')) return { dark: P.blue0, mid: P.blue1, light: P.blue3, accent: P.teal2 };
    if (id.includes('stock')) return { dark: P.wood0, mid: P.wood2, light: P.cream1, accent: P.green2 };
    if (id.includes('staff')) return { dark: P.green0, mid: P.green1, light: P.green3, accent: P.rose2 };
    if (id.includes('customer')) return { dark: P.teal0, mid: P.teal1, light: P.teal3, accent: P.amber2 };
    if (id.includes('routine')) return { dark: P.rose0, mid: P.wood2, light: P.cream0, accent: P.amber2 };
    return { dark: P.ink2, mid: P.teal1, light: P.cream0, accent: P.amber2 };
}

function drawShopDaily(ctx: CanvasRenderingContext2D, id: string) {
    const pal = shopDailyPalette(id);
    const isWall = /board|sign|hook|clock|rail|hours|number|labels/.test(id);
    shadow(ctx, isWall ? 8 : 7, isWall ? 26 : 28, isWall ? 16 : 18);

    if (/mat|rug/.test(id)) {
        const wide = id.includes('rain') || id.includes('drain') || id.includes('counter');
        const x = wide ? 3 : 5;
        const w = wide ? 26 : 22;
        r(ctx, x, 18, w, 8, P.ink);
        r(ctx, x + 1, 19, w - 2, 6, pal.mid);
        r(ctx, x + 4, 21, w - 8, 2, pal.light);
        for (let i = 0; i < w - 2; i += 4) p(ctx, x + 1 + i, 24, pal.accent);
        return;
    }

    if (/board|sign|hook|clock|rail|hours|number|labels/.test(id)) {
        if (/hook|rail/.test(id)) {
            r(ctx, 7, 8, 18, 3, pal.dark);
            for (let x = 9; x <= 23; x += 5) {
                line(ctx, x, 10, x - 1, 16, pal.dark);
                r(ctx, x - 2, 16, 4, 5, x % 2 ? pal.accent : pal.light);
            }
            return;
        }
        box(ctx, 7, 6, 18, 18, P.cream0);
        r(ctx, 9, 8, 14, 4, pal.mid);
        r(ctx, 10, 14, 11, 2, pal.dark);
        r(ctx, 10, 18, 8, 2, pal.accent);
        if (/clock/.test(id)) {
            r(ctx, 12, 9, 8, 8, P.white);
            line(ctx, 16, 13, 16, 10, P.ink);
            line(ctx, 16, 13, 19, 14, P.ink);
        }
        return;
    }

    if (/printer|reader|scanner|microwave|cooler|dispenser|scale|timer|charger|bell/.test(id)) {
        box(ctx, 8, 12, 16, 13, P.gray2);
        r(ctx, 10, 14, 12, 3, pal.mid);
        r(ctx, 11, 19, 10, 2, P.ink2);
        p(ctx, 21, 15, pal.accent);
        p(ctx, 21, 18, pal.light);
        if (/cooler|dispenser/.test(id)) {
            r(ctx, 12, 6, 8, 8, P.blue2);
            r(ctx, 14, 8, 4, 4, P.blue3);
        }
        if (/bell/.test(id)) {
            r(ctx, 10, 20, 12, 4, P.gray1);
            r(ctx, 12, 14, 8, 6, pal.accent);
        }
        return;
    }

    if (/bucket|broom|mop|wiper|squeegee|spray|trash|recycle|soap|glove|tissue|sanitizer|dustpan/.test(id)) {
        if (/broom|mop|wiper|squeegee/.test(id)) {
            line(ctx, 12, 7, 20, 26, pal.dark);
            line(ctx, 18, 7, 10, 26, pal.mid);
            r(ctx, 8, 23, 8, 4, pal.accent);
            r(ctx, 18, 23, 6, 4, pal.light);
            return;
        }
        box(ctx, 10, 17, 12, 10, /trash|recycle|bucket/.test(id) ? pal.mid : P.blue2);
        r(ctx, 12, 13, 8, 5, pal.light);
        p(ctx, 17, 11, P.white);
        if (/spray|soap|sanitizer/.test(id)) r(ctx, 15, 9, 4, 4, P.gray1);
        return;
    }

    if (/shelf|locker|rack|cart|stand|stack|row|box|bin|crate|basket|bag|rolls|stickers|holder|station|drawer|post/.test(id)) {
        if (/cart|truck|ladder/.test(id)) {
            box(ctx, 7, 12, 18, 11, pal.mid);
            r(ctx, 9, 23, 4, 4, P.ink2);
            r(ctx, 20, 23, 4, 4, P.ink2);
            line(ctx, 23, 12, 27, 8, pal.dark);
            return;
        }
        box(ctx, 7, 8, 18, 19, pal.dark);
        r(ctx, 9, 12, 14, 2, P.ink2);
        r(ctx, 9, 18, 14, 2, P.ink2);
        for (let i = 0; i < 8; i++) {
            const x = 10 + (i % 4) * 3;
            const y = 9 + Math.floor(i / 4) * 7;
            r(ctx, x, y, 2, 5, [pal.light, pal.mid, pal.accent, P.cream0][i % 4]);
        }
        if (/post/.test(id)) {
            r(ctx, 15, 8, 3, 18, pal.dark);
            r(ctx, 11, 7, 11, 3, pal.accent);
        }
        return;
    }

    if (/table|chair|bench|stool|seat|ladder|truck/.test(id)) {
        if (/ladder/.test(id)) {
            line(ctx, 10, 6, 7, 27, pal.dark);
            line(ctx, 21, 6, 24, 27, pal.dark);
            for (let y = 10; y <= 23; y += 4) line(ctx, 11, y, 22, y, pal.mid);
            return;
        }
        box(ctx, 7, 13, 18, 7, pal.mid);
        if (/chair|seat/.test(id)) box(ctx, 10, 7, 12, 9, pal.light);
        r(ctx, 10, 20, 3, 7, pal.dark);
        r(ctx, 20, 20, 3, 7, pal.dark);
        return;
    }

    if (/bowl|cup|mug|tray|pot|cooker|bottle|thermos|lunchbox|ledger|book|clipboard|pad|tag|coupon|jar|cash|gun|key|tool|apron|number/.test(id)) {
        r(ctx, 8, 23, 16, 3, P.gray2);
        box(ctx, 10, 15, 12, 8, pal.mid);
        r(ctx, 12, 12, 8, 4, pal.light);
        p(ctx, 21, 18, pal.accent);
        if (/cup|mug|thermos/.test(id)) drawCup(ctx, 11, 12, 1, pal.light);
        if (/ledger|book|clipboard/.test(id)) {
            r(ctx, 11, 10, 10, 14, P.cream0);
            r(ctx, 13, 13, 6, 1, pal.dark);
            r(ctx, 13, 17, 5, 1, pal.accent);
        }
        return;
    }

    box(ctx, 9, 12, 14, 13, pal.mid);
    r(ctx, 11, 9, 10, 5, pal.light);
    p(ctx, 16, 17, pal.accent);
}

function drawFurniture(ctx: CanvasRenderingContext2D, id: string) {
    if (id.startsWith('daily-')) {
        drawShopDaily(ctx, id);
        return;
    }

    if (id.startsWith('decor-')) {
        drawShopDecor(ctx, id);
        return;
    }

    switch (id) {
        case 'counter': {
            shadow(ctx, 2, 28, 28);
            box(ctx, 2, 16, 28, 11, P.wood1);
            r(ctx, 3, 14, 26, 4, P.wood3);
            shine(ctx, 4, 14, 22);
            for (let x = 5; x <= 23; x += 6) box(ctx, x, 19, 4, 6, P.wood0, P.ink2);
            r(ctx, 21, 10, 6, 5, P.gray2);
            r(ctx, 23, 8, 2, 2, P.teal2);
            r(ctx, 8, 10, 4, 4, P.cream0);
            p(ctx, 9, 9, P.white);
            break;
        }
        case 'display-case':
        case 'dessert-case': {
            shadow(ctx, 3, 28, 26);
            box(ctx, 4, 12, 24, 15, P.wood2);
            r(ctx, 6, 13, 20, 8, P.blue2);
            r(ctx, 7, 14, 18, 2, P.blue3);
            r(ctx, 7, 21, 18, 1, P.wood0);
            drawMiniCake(ctx, 8, 18);
            drawMiniCake(ctx, 15, 18, P.teal2);
            drawMiniCake(ctx, 21, 18, P.rose2);
            r(ctx, 6, 24, 20, 2, P.wood0);
            break;
        }
        case 'coffee-machine': {
            shadow(ctx, 8, 28, 16);
            box(ctx, 7, 9, 18, 18, P.gray1);
            r(ctx, 9, 11, 14, 5, P.teal1);
            r(ctx, 10, 12, 4, 2, P.teal3);
            r(ctx, 12, 17, 8, 3, P.gray0);
            r(ctx, 15, 20, 2, 5, P.black);
            r(ctx, 12, 25, 9, 2, P.wood2);
            p(ctx, 21, 18, P.rose2);
            p(ctx, 22, 18, P.amber2);
            break;
        }
        case 'cashier': {
            shadow(ctx, 8, 28, 16);
            box(ctx, 8, 14, 16, 11, P.gray1);
            r(ctx, 10, 10, 12, 6, P.gray2);
            r(ctx, 12, 12, 8, 2, P.teal2);
            for (let x = 11; x <= 20; x += 3) p(ctx, x, 19, P.cream0);
            r(ctx, 10, 24, 12, 2, P.ink2);
            break;
        }
        case 'round-table':
        case 'square-table': {
            shadow(ctx, 6, 27, 20);
            if (id === 'round-table') {
                r(ctx, 8, 13, 16, 2, P.ink);
                r(ctx, 6, 15, 20, 4, P.wood3);
                r(ctx, 8, 19, 16, 2, P.wood1);
            } else {
                box(ctx, 5, 13, 22, 7, P.wood3);
            }
            r(ctx, 9, 20, 3, 7, P.wood0);
            r(ctx, 20, 20, 3, 7, P.wood0);
            drawCup(ctx, 14, 9);
            p(ctx, 22, 12, P.green2);
            break;
        }
        case 'chair':
        case 'stool': {
            shadow(ctx, 10, 28, 12);
            if (id === 'chair') {
                box(ctx, 10, 7, 12, 12, P.wood2);
                r(ctx, 12, 10, 8, 2, P.wood3);
            }
            box(ctx, 9, 18, 14, 5, P.wood3);
            r(ctx, 11, 23, 3, 6, P.wood0);
            r(ctx, 19, 23, 3, 6, P.wood0);
            break;
        }
        case 'sofa':
        case 'booth': {
            shadow(ctx, 4, 28, 24);
            box(ctx, 5, 14, 22, 11, id === 'sofa' ? P.rose1 : P.teal1);
            r(ctx, 7, 10, 18, 6, P.ink);
            r(ctx, 8, 11, 16, 5, id === 'sofa' ? P.rose2 : P.teal2);
            r(ctx, 3, 17, 4, 8, P.ink);
            r(ctx, 25, 17, 4, 8, P.ink);
            r(ctx, 9, 17, 6, 7, P.rose3);
            r(ctx, 17, 17, 6, 7, id === 'sofa' ? P.rose0 : P.teal0);
            p(ctx, 12, 13, P.white);
            p(ctx, 20, 13, P.amber2);
            break;
        }
        case 'high-shelf':
        case 'book-shelf':
        case 'bakery-rack': {
            shadow(ctx, 6, 29, 20);
            box(ctx, 6, 4, 20, 24, P.wood1);
            for (let y = 10; y <= 24; y += 7) r(ctx, 8, y, 16, 2, P.wood3);
            const colors = id === 'bakery-rack' ? [P.cream0, P.amber2, P.rose3, P.cream1] : [P.rose2, P.teal2, P.green2, P.amber2];
            for (let i = 0; i < 12; i++) {
                const x = 9 + (i % 4) * 4;
                const y = 8 + Math.floor(i / 4) * 7;
                r(ctx, x, y, 3, id === 'book-shelf' ? 6 : 4, colors[i % colors.length]);
                p(ctx, x + 1, y + 1, P.white);
            }
            break;
        }
        case 'drink-fridge': {
            shadow(ctx, 8, 29, 16);
            box(ctx, 8, 4, 16, 24, P.blue0);
            r(ctx, 10, 6, 12, 16, P.blue2);
            r(ctx, 11, 7, 5, 4, P.blue3);
            r(ctx, 11, 13, 10, 2, P.teal2);
            r(ctx, 11, 17, 10, 2, P.rose2);
            r(ctx, 22, 6, 1, 16, P.white);
            r(ctx, 10, 24, 12, 3, P.gray1);
            break;
        }
        case 'tea-station':
        case 'prep-table': {
            shadow(ctx, 4, 28, 24);
            box(ctx, 5, 14, 22, 12, P.wood2);
            r(ctx, 7, 11, 18, 4, P.wood3);
            shine(ctx, 8, 11, 15);
            if (id === 'tea-station') {
                r(ctx, 9, 7, 5, 4, P.teal2);
                r(ctx, 17, 7, 5, 4, P.green2);
                p(ctx, 12, 6, P.white);
            } else {
                r(ctx, 10, 8, 10, 2, P.gray2);
                r(ctx, 21, 8, 4, 4, P.cream0);
            }
            r(ctx, 8, 18, 5, 5, P.wood1);
            r(ctx, 19, 18, 5, 5, P.wood1);
            break;
        }
        case 'kitchen-stove':
        case 'oven':
        case 'sink': {
            shadow(ctx, 6, 28, 20);
            box(ctx, 6, 13, 20, 13, P.gray1);
            if (id === 'sink') {
                r(ctx, 10, 9, 12, 6, P.gray3);
                r(ctx, 12, 10, 8, 3, P.blue2);
                r(ctx, 15, 6, 2, 5, P.gray1);
            } else {
                r(ctx, 9, 9, 14, 5, P.gray2);
                p(ctx, 11, 11, P.ink);
                p(ctx, 16, 11, P.ink);
                p(ctx, 21, 11, P.rose2);
                r(ctx, 10, 17, 12, 6, id === 'oven' ? P.black : P.ink2);
                p(ctx, 12, 18, P.amber2);
            }
            break;
        }
        case 'storage-crates': {
            shadow(ctx, 5, 28, 22);
            box(ctx, 5, 16, 10, 9, P.wood2);
            box(ctx, 17, 14, 10, 11, P.wood1);
            box(ctx, 10, 8, 10, 8, P.wood3);
            line(ctx, 6, 18, 14, 24, P.wood0);
            line(ctx, 18, 16, 26, 24, P.wood0);
            p(ctx, 21, 11, P.green2);
            break;
        }
        case 'menu-board':
        case 'chalkboard-stand': {
            shadow(ctx, 7, 28, 18);
            box(ctx, 7, 5, 18, id === 'menu-board' ? 21 : 18, P.wood1);
            r(ctx, 9, 7, 14, id === 'menu-board' ? 17 : 13, '#263c35');
            r(ctx, 12, 9, 8, 1, P.cream0);
            r(ctx, 11, 13, 10, 1, P.cream1);
            r(ctx, 11, 17, 7, 1, P.rose3);
            if (id === 'chalkboard-stand') {
                line(ctx, 10, 23, 6, 29, P.wood0);
                line(ctx, 22, 23, 26, 29, P.wood0);
            }
            break;
        }
        case 'wall-sign': {
            shadow(ctx, 5, 25, 22);
            r(ctx, 7, 5, 2, 5, P.wood0);
            r(ctx, 23, 5, 2, 5, P.wood0);
            box(ctx, 5, 10, 22, 12, P.rose1);
            r(ctx, 8, 13, 16, 2, P.cream0);
            r(ctx, 10, 16, 12, 1, P.amber2);
            p(ctx, 6, 11, P.white);
            break;
        }
        case 'window-awning': {
            shadow(ctx, 4, 27, 24);
            box(ctx, 6, 9, 20, 15, P.wood1);
            r(ctx, 8, 11, 16, 11, P.blue2);
            r(ctx, 9, 12, 6, 4, P.blue3);
            r(ctx, 16, 11, 2, 11, P.wood0);
            r(ctx, 8, 16, 16, 2, P.wood0);
            for (let x = 4; x < 28; x += 4) r(ctx, x, 5, 4, 5, (x / 4) % 2 ? P.rose2 : P.cream0);
            r(ctx, 4, 9, 24, 2, P.wood0);
            break;
        }
        case 'clock': {
            shadow(ctx, 11, 26, 10);
            box(ctx, 10, 5, 12, 17, P.wood2);
            r(ctx, 12, 7, 8, 8, P.cream0);
            p(ctx, 16, 8, P.ink);
            p(ctx, 16, 14, P.ink);
            p(ctx, 13, 11, P.ink);
            p(ctx, 19, 11, P.ink);
            line(ctx, 16, 11, 16, 8, P.rose0);
            line(ctx, 16, 11, 18, 12, P.rose0);
            r(ctx, 14, 17, 4, 4, P.amber1);
            break;
        }
        case 'wall-frame': {
            shadow(ctx, 8, 26, 16);
            box(ctx, 8, 6, 16, 16, P.wood2);
            r(ctx, 10, 8, 12, 12, P.blue3);
            r(ctx, 10, 16, 12, 4, P.green2);
            r(ctx, 13, 10, 5, 4, P.amber2);
            break;
        }
        case 'star-lights': {
            line(ctx, 4, 9, 28, 13, P.wood0);
            for (let i = 0; i < 6; i++) drawSpark(ctx, 5 + i * 4, 10 + (i % 2), i % 2 ? P.amber2 : P.teal3);
            break;
        }
        case 'neon-heart': {
            shadow(ctx, 9, 26, 14);
            drawHeart(ctx, 10, 8, P.rose2);
            r(ctx, 13, 20, 6, 2, P.rose0);
            break;
        }
        case 'pendant-lamp':
        case 'table-lamp':
        case 'floor-lamp': {
            shadow(ctx, 10, 28, 12);
            if (id === 'pendant-lamp') r(ctx, 15, 2, 2, 9, P.wood0);
            if (id === 'floor-lamp') r(ctx, 15, 14, 2, 13, P.gray1);
            if (id === 'table-lamp') r(ctx, 15, 16, 2, 9, P.gray1);
            r(ctx, 10, id === 'pendant-lamp' ? 10 : 8, 12, 6, P.ink);
            r(ctx, 11, id === 'pendant-lamp' ? 11 : 9, 10, 5, P.amber2);
            r(ctx, 13, id === 'pendant-lamp' ? 13 : 11, 6, 2, P.cream0);
            r(ctx, 11, 26, 10, 2, P.gray0);
            break;
        }
        case 'plant':
        case 'cactus':
        case 'flower-vase':
        case 'outdoor-planter': {
            shadow(ctx, 8, 28, 16);
            if (id === 'cactus') {
                box(ctx, 12, 20, 8, 7, P.wood2);
                r(ctx, 14, 8, 5, 13, P.green1);
                r(ctx, 10, 13, 4, 7, P.green2);
                r(ctx, 19, 15, 4, 5, P.green2);
                p(ctx, 15, 10, P.cream0);
                p(ctx, 17, 16, P.cream0);
            } else if (id === 'flower-vase') {
                box(ctx, 12, 17, 8, 10, P.teal1);
                for (let i = 0; i < 5; i++) {
                    line(ctx, 16, 17, 10 + i * 3, 8 + (i % 2), P.green1);
                    drawMiniFlower(ctx, 10 + i * 3, 8 + (i % 2), [P.rose2, P.amber2, P.teal2][i % 3]);
                }
            } else {
                box(ctx, id === 'outdoor-planter' ? 7 : 12, 20, id === 'outdoor-planter' ? 18 : 8, 7, P.wood2);
                for (let i = 0; i < 7; i++) {
                    const x = 9 + i * 2;
                    line(ctx, 16, 20, x, 7 + (i % 3), P.green1);
                    p(ctx, x, 7 + (i % 3), i % 2 ? P.green3 : P.green2);
                }
            }
            break;
        }
        case 'rug-round':
        case 'rug-runner':
        case 'welcome-mat': {
            shadow(ctx, 4, 27, 24);
            const w = id === 'rug-runner' ? 26 : 22;
            const x = id === 'rug-runner' ? 3 : 5;
            r(ctx, x, 18, w, 8, P.ink);
            r(ctx, x + 1, 19, w - 2, 6, id === 'welcome-mat' ? P.teal1 : P.rose1);
            r(ctx, x + 4, 21, w - 8, 2, P.cream0);
            for (let i = 0; i < w - 2; i += 3) p(ctx, x + 1 + i, 18, P.cream0);
            break;
        }
        case 'trash-bin':
        case 'umbrella-stand':
        case 'coat-rack':
        case 'cat-bed': {
            shadow(ctx, 9, 28, 14);
            if (id === 'coat-rack') {
                r(ctx, 15, 6, 2, 20, P.wood1);
                line(ctx, 16, 10, 9, 14, P.wood1);
                line(ctx, 16, 11, 23, 14, P.wood1);
                r(ctx, 11, 14, 5, 7, P.rose1);
                r(ctx, 16, 26, 7, 2, P.wood0);
            } else if (id === 'umbrella-stand') {
                box(ctx, 11, 18, 10, 9, P.teal1);
                line(ctx, 14, 18, 9, 7, P.rose2);
                line(ctx, 17, 18, 18, 6, P.blue2);
                line(ctx, 19, 18, 24, 9, P.amber2);
            } else if (id === 'cat-bed') {
                r(ctx, 7, 18, 18, 8, P.ink);
                r(ctx, 8, 17, 16, 8, P.teal1);
                r(ctx, 11, 20, 10, 3, P.cream0);
                p(ctx, 14, 21, P.rose2);
                p(ctx, 18, 21, P.rose2);
            } else {
                box(ctx, 11, 10, 10, 17, P.gray1);
                r(ctx, 9, 8, 14, 3, P.gray2);
                r(ctx, 13, 5, 6, 3, P.gray1);
                r(ctx, 14, 14, 1, 10, P.gray0);
                r(ctx, 18, 14, 1, 10, P.gray0);
            }
            break;
        }
        case 'cake-stand':
        case 'coffee-cup':
        case 'pastry-tray': {
            shadow(ctx, 8, 28, 16);
            if (id === 'coffee-cup') drawCup(ctx, 11, 13, 2);
            if (id === 'cake-stand') {
                drawMiniCake(ctx, 12, 11, P.rose2, 2);
                r(ctx, 13, 22, 6, 2, P.gray1);
                r(ctx, 10, 24, 12, 2, P.gray2);
            }
            if (id === 'pastry-tray') {
                r(ctx, 7, 22, 18, 3, P.gray2);
                drawMiniCake(ctx, 8, 16, P.amber2);
                drawMiniCake(ctx, 14, 15, P.rose3);
                drawMiniCake(ctx, 20, 16, P.teal2);
            }
            break;
        }
        default: {
            shadow(ctx, 7, 28, 18);
            box(ctx, 8, 9, 16, 17, P.teal1);
            p(ctx, 12, 13, P.cream0);
            p(ctx, 19, 18, P.rose2);
        }
    }
}

function drawRecipe(ctx: CanvasRenderingContext2D, id: string) {
    shadow(ctx, 8, 28, 16);
    switch (id) {
        case 'coffee':
            drawCup(ctx, 10, 13, 2);
            for (let x = 11; x <= 19; x += 4) line(ctx, x, 11, x + 1, 7, P.gray2);
            break;
        case 'cake':
            drawMiniCake(ctx, 8, 12, P.rose2, 2);
            r(ctx, 10, 10, 2, 4, P.amber2);
            p(ctx, 11, 9, P.rose3);
            break;
        case 'tea':
            drawCup(ctx, 10, 14, 2, P.teal1);
            r(ctx, 13, 12, 9, 2, P.green2);
            p(ctx, 21, 11, P.green3);
            break;
        case 'donut':
            r(ctx, 10, 13, 12, 3, P.wood0);
            r(ctx, 8, 16, 16, 7, P.amber1);
            r(ctx, 11, 17, 10, 5, P.rose2);
            r(ctx, 14, 18, 4, 3, P.cream0);
            p(ctx, 11, 18, P.teal2);
            p(ctx, 20, 20, P.white);
            break;
        case 'icecream':
            r(ctx, 13, 18, 6, 10, P.amber1);
            r(ctx, 11, 11, 10, 8, P.green2);
            r(ctx, 13, 9, 6, 4, P.cream0);
            p(ctx, 17, 12, P.rose2);
            break;
        case 'pudding':
            r(ctx, 9, 22, 14, 4, P.gray2);
            r(ctx, 10, 14, 12, 8, P.cream1);
            r(ctx, 12, 11, 8, 4, P.amber1);
            p(ctx, 16, 13, P.white);
            break;
        case 'cocktail':
            r(ctx, 15, 19, 2, 7, P.gray2);
            r(ctx, 11, 26, 10, 2, P.gray1);
            r(ctx, 9, 10, 14, 8, P.rose2);
            line(ctx, 10, 10, 16, 20, P.gray2);
            p(ctx, 21, 9, P.green2);
            break;
    }
}

interface ShopStaffLook {
    skin: string;
    hair: string;
    shirt: string;
    apron: string;
    accent: string;
    hat?: 'visor' | 'chef' | 'cap' | 'beret' | 'headband' | 'beanie';
    hairStyle?: 'bob' | 'short' | 'side' | 'bun';
    accessory?: 'clipboard' | 'cake' | 'cup' | 'box' | 'mop' | 'bag' | 'pudding' | 'sparkle' | 'phone' | 'badge';
}

const SHOP_STAFF_LOOKS: Record<string, ShopStaffLook> = {
    'night-manager': { skin: P.cream1, hair: P.ink2, shirt: P.blue0, apron: P.rose1, accent: P.amber2, hat: 'visor', hairStyle: 'short', accessory: 'clipboard' },
    'pastry-chef': { skin: P.cream0, hair: P.rose0, shirt: P.white, apron: P.rose3, accent: P.amber2, hat: 'chef', hairStyle: 'bob', accessory: 'cake' },
    'latte-artist': { skin: P.cream1, hair: P.wood1, shirt: P.teal1, apron: P.cream0, accent: P.teal3, hairStyle: 'side', accessory: 'cup' },
    'stock-clerk': { skin: P.cream2, hair: P.wood0, shirt: P.green1, apron: P.wood2, accent: P.cream1, hat: 'cap', hairStyle: 'short', accessory: 'box' },
    cleaner: { skin: P.cream0, hair: P.blue0, shirt: P.blue1, apron: P.blue3, accent: P.teal2, hat: 'headband', hairStyle: 'bun', accessory: 'mop' },
    packaging: { skin: P.cream1, hair: P.rose0, shirt: P.rose2, apron: P.cream0, accent: P.amber2, hairStyle: 'bob', accessory: 'bag' },
    'dessert-chef': { skin: P.cream0, hair: P.wood1, shirt: P.white, apron: P.teal2, accent: P.rose2, hat: 'beret', hairStyle: 'side', accessory: 'pudding' },
    greeter: { skin: P.cream1, hair: P.ink2, shirt: P.teal2, apron: P.green3, accent: P.amber2, hat: 'headband', hairStyle: 'bob', accessory: 'sparkle' },
    buyer: { skin: P.cream2, hair: P.gray0, shirt: P.blue0, apron: P.gray2, accent: P.green2, hat: 'beanie', hairStyle: 'short', accessory: 'phone' },
    trainee: { skin: P.cream0, hair: P.amber0, shirt: P.green2, apron: P.cream1, accent: P.rose2, hat: 'cap', hairStyle: 'side', accessory: 'badge' },
};

function drawShopStaff(ctx: CanvasRenderingContext2D, look: ShopStaffLook) {
    if (look.hairStyle === 'bun') {
        r(ctx, 8, 9, 5, 5, look.hair);
        r(ctx, 20, 9, 5, 5, look.hair);
    }
    r(ctx, 11, 8, 11, 11, look.skin);
    r(ctx, 10, 10, 13, 8, look.skin);
    if (look.hairStyle === 'bob') {
        r(ctx, 9, 7, 15, 5, look.hair);
        r(ctx, 8, 10, 4, 8, look.hair);
        r(ctx, 21, 10, 4, 8, look.hair);
    } else if (look.hairStyle === 'side') {
        r(ctx, 9, 7, 14, 5, look.hair);
        r(ctx, 9, 10, 6, 6, look.hair);
    } else {
        r(ctx, 11, 7, 11, 4, look.hair);
        r(ctx, 10, 10, 4, 4, look.hair);
    }

    if (look.hat === 'chef') {
        r(ctx, 10, 4, 13, 5, P.white);
        r(ctx, 12, 2, 3, 3, P.white);
        r(ctx, 17, 2, 3, 3, P.white);
    } else if (look.hat === 'visor') {
        r(ctx, 9, 6, 14, 3, look.accent);
        r(ctx, 19, 7, 6, 2, look.accent);
    } else if (look.hat === 'cap') {
        r(ctx, 10, 5, 12, 4, look.accent);
        r(ctx, 20, 7, 5, 2, look.accent);
    } else if (look.hat === 'beret') {
        r(ctx, 9, 5, 13, 4, look.accent);
        p(ctx, 16, 4, look.accent);
    } else if (look.hat === 'headband') {
        r(ctx, 10, 8, 13, 2, look.accent);
    } else if (look.hat === 'beanie') {
        r(ctx, 10, 5, 13, 5, look.accent);
        r(ctx, 12, 4, 4, 2, look.accent);
    }

    p(ctx, 14, 13, P.black);
    p(ctx, 19, 13, P.black);
    r(ctx, 16, 16, 2, 1, P.rose0);
    box(ctx, 10, 19, 13, 10, look.shirt);
    r(ctx, 12, 20, 9, 7, look.apron);
    r(ctx, 14, 21, 5, 1, P.white);
    r(ctx, 11, 27, 4, 3, P.ink2);
    r(ctx, 19, 27, 4, 3, P.ink2);

    switch (look.accessory) {
        case 'clipboard':
            box(ctx, 4, 17, 7, 9, P.cream0);
            r(ctx, 6, 20, 3, 1, look.accent);
            break;
        case 'cake':
            drawMiniCake(ctx, 4, 18, look.accent);
            break;
        case 'cup':
            drawCup(ctx, 4, 18, 1, look.accent);
            break;
        case 'box':
            box(ctx, 4, 18, 8, 7, P.wood2);
            line(ctx, 5, 19, 11, 24, P.wood0);
            break;
        case 'mop':
            line(ctx, 5, 8, 10, 26, P.wood1);
            r(ctx, 4, 24, 8, 4, look.accent);
            break;
        case 'bag':
            box(ctx, 4, 18, 8, 8, P.cream0);
            line(ctx, 6, 18, 8, 15, look.accent);
            line(ctx, 10, 18, 8, 15, look.accent);
            break;
        case 'pudding':
            r(ctx, 4, 24, 8, 3, P.gray2);
            r(ctx, 5, 19, 6, 5, P.cream1);
            r(ctx, 6, 17, 4, 2, look.accent);
            break;
        case 'sparkle':
            drawSpark(ctx, 5, 17, look.accent);
            drawSpark(ctx, 24, 10, P.white);
            break;
        case 'phone':
            box(ctx, 4, 16, 6, 10, P.gray0);
            r(ctx, 5, 18, 4, 5, P.blue2);
            break;
        case 'badge':
            r(ctx, 19, 21, 3, 3, look.accent);
            p(ctx, 20, 22, P.white);
            break;
    }
}

function drawStaff(ctx: CanvasRenderingContext2D, id: string) {
    shadow(ctx, 9, 29, 14);
    if (id === 'cat' || id === 'dog' || id === 'bear' || id === 'rabbit' || id === 'penguin') {
        const fur = id === 'cat' ? P.amber2 : id === 'dog' ? P.wood3 : id === 'bear' ? P.wood1 : id === 'rabbit' ? P.gray3 : P.black;
        const face = id === 'penguin' ? P.white : fur;
        if (id === 'rabbit') {
            r(ctx, 11, 3, 4, 9, fur);
            r(ctx, 18, 3, 4, 9, fur);
            r(ctx, 12, 5, 2, 6, P.rose3);
            r(ctx, 19, 5, 2, 6, P.rose3);
        } else if (id !== 'penguin') {
            r(ctx, 9, 7, 5, 5, fur);
            r(ctx, 20, 7, 5, 5, fur);
        }
        r(ctx, 9, 10, 15, 13, P.ink);
        r(ctx, 10, 9, 13, 13, face);
        if (id === 'penguin') {
            r(ctx, 9, 6, 15, 17, P.black);
            r(ctx, 12, 10, 9, 12, P.white);
            r(ctx, 14, 15, 5, 2, P.amber2);
        }
        p(ctx, 13, 14, P.black);
        p(ctx, 20, 14, P.black);
        r(ctx, 16, 16, 2, 1, id === 'rabbit' ? P.rose2 : P.ink2);
        box(ctx, 10, 22, 13, 7, id === 'bear' ? P.rose1 : P.teal1);
        r(ctx, 13, 23, 7, 2, P.white);
        return;
    }

    const look = SHOP_STAFF_LOOKS[id];
    if (look) {
        drawShopStaff(ctx, look);
        return;
    }

    const shirt = id === 'chef' ? P.white : id === 'manager' ? P.rose1 : id === 'waiter' ? P.teal1 : id === 'tired' ? P.gray1 : P.green1;
    if (id === 'chef') {
        r(ctx, 11, 5, 11, 4, P.white);
        r(ctx, 13, 3, 2, 3, P.white);
        r(ctx, 18, 3, 2, 3, P.white);
    }
    r(ctx, 11, 8, 11, 11, P.cream1);
    r(ctx, 10, 10, 13, 8, P.cream2);
    r(ctx, 12, 7, 9, 4, P.ink2);
    p(ctx, 14, 13, P.black);
    p(ctx, 19, 13, P.black);
    r(ctx, 16, 15, 2, 1, P.rose0);
    box(ctx, 10, 19, 13, 10, shirt);
    r(ctx, 13, 20, 7, 2, P.white);
    if (id === 'tired') {
        r(ctx, 21, 5, 4, 1, P.blue1);
        r(ctx, 23, 3, 5, 1, P.blue1);
        r(ctx, 25, 1, 4, 1, P.blue1);
    }
}

interface ShopCustomerLook {
    skin: string;
    hair: string;
    shirt: string;
    bottom: string;
    accent: string;
    hairStyle?: 'bob' | 'short' | 'side' | 'bun' | 'long' | 'cap';
    outfit?: 'coat' | 'hoodie' | 'dress' | 'jacket' | 'apron' | 'suit';
    accessory?: 'briefcase' | 'sketchbook' | 'leash' | 'parcel' | 'camera' | 'kid' | 'bottle' | 'umbrella' | 'book' | 'gift' | 'plant' | 'cup' | 'moon' | 'phone' | 'menu' | 'taxi' | 'resume' | 'console' | 'flower' | 'notes' | 'craft' | 'laptop' | 'star' | 'coin';
}

const SHOP_CUSTOMER_LOOKS: Record<string, ShopCustomerLook> = {
    'office-runner': { skin: P.cream1, hair: P.ink2, shirt: P.blue0, bottom: P.gray0, accent: P.amber2, hairStyle: 'short', outfit: 'suit', accessory: 'briefcase' },
    'sketch-student': { skin: P.cream0, hair: P.wood1, shirt: P.green2, bottom: P.blue0, accent: P.cream0, hairStyle: 'bob', outfit: 'hoodie', accessory: 'sketchbook' },
    'dog-walker': { skin: P.cream2, hair: P.gray0, shirt: P.teal1, bottom: P.wood1, accent: P.rose2, hairStyle: 'cap', outfit: 'jacket', accessory: 'leash' },
    'courier-rider': { skin: P.cream1, hair: P.ink2, shirt: P.amber1, bottom: P.gray0, accent: P.green2, hairStyle: 'cap', outfit: 'jacket', accessory: 'parcel' },
    'tourist-camera': { skin: P.cream0, hair: P.amber0, shirt: P.rose2, bottom: P.blue1, accent: P.amber2, hairStyle: 'side', outfit: 'coat', accessory: 'camera' },
    'parent-kid': { skin: P.cream1, hair: P.wood0, shirt: P.green1, bottom: P.rose0, accent: P.rose3, hairStyle: 'bun', outfit: 'dress', accessory: 'kid' },
    'fitness-coach': { skin: P.cream2, hair: P.ink2, shirt: P.green2, bottom: P.gray0, accent: P.teal3, hairStyle: 'short', outfit: 'hoodie', accessory: 'bottle' },
    'raincoat-guest': { skin: P.cream0, hair: P.blue0, shirt: P.blue1, bottom: P.gray1, accent: P.amber2, hairStyle: 'cap', outfit: 'coat', accessory: 'umbrella' },
    bookworm: { skin: P.cream1, hair: P.wood1, shirt: P.cream1, bottom: P.green0, accent: P.blue2, hairStyle: 'long', outfit: 'jacket', accessory: 'book' },
    'date-planner': { skin: P.cream0, hair: P.rose0, shirt: P.rose2, bottom: P.cream1, accent: P.amber2, hairStyle: 'bob', outfit: 'dress', accessory: 'gift' },
    'plant-neighbor': { skin: P.cream2, hair: P.green0, shirt: P.green1, bottom: P.wood1, accent: P.green3, hairStyle: 'side', outfit: 'apron', accessory: 'plant' },
    'coffee-critic': { skin: P.cream1, hair: P.gray0, shirt: P.wood2, bottom: P.ink2, accent: P.cream0, hairStyle: 'short', outfit: 'coat', accessory: 'cup' },
    'night-owl': { skin: P.cream0, hair: P.blue0, shirt: P.ink2, bottom: P.blue0, accent: P.amber2, hairStyle: 'long', outfit: 'hoodie', accessory: 'moon' },
    vlogger: { skin: P.cream1, hair: P.rose0, shirt: P.teal2, bottom: P.cream1, accent: P.rose3, hairStyle: 'bun', outfit: 'jacket', accessory: 'phone' },
    'retired-teacher': { skin: P.cream2, hair: P.gray2, shirt: P.blue1, bottom: P.wood1, accent: P.cream0, hairStyle: 'short', outfit: 'coat', accessory: 'menu' },
    'taxi-driver': { skin: P.cream2, hair: P.ink2, shirt: P.amber2, bottom: P.gray0, accent: P.black, hairStyle: 'cap', outfit: 'jacket', accessory: 'taxi' },
    interviewee: { skin: P.cream0, hair: P.wood0, shirt: P.white, bottom: P.gray0, accent: P.blue1, hairStyle: 'side', outfit: 'suit', accessory: 'resume' },
    gamer: { skin: P.cream1, hair: P.blue0, shirt: P.rose1, bottom: P.gray0, accent: P.teal3, hairStyle: 'short', outfit: 'hoodie', accessory: 'console' },
    florist: { skin: P.cream0, hair: P.green0, shirt: P.rose3, bottom: P.green1, accent: P.rose2, hairStyle: 'long', outfit: 'apron', accessory: 'flower' },
    'med-student': { skin: P.cream1, hair: P.ink2, shirt: P.white, bottom: P.blue0, accent: P.teal2, hairStyle: 'short', outfit: 'coat', accessory: 'notes' },
    'handmade-fan': { skin: P.cream0, hair: P.amber0, shirt: P.amber2, bottom: P.rose0, accent: P.teal2, hairStyle: 'bob', outfit: 'apron', accessory: 'craft' },
    'remote-worker': { skin: P.cream2, hair: P.wood1, shirt: P.teal1, bottom: P.gray0, accent: P.blue2, hairStyle: 'side', outfit: 'jacket', accessory: 'laptop' },
    'cosplay-visitor': { skin: P.cream0, hair: P.rose0, shirt: P.blue1, bottom: P.cream1, accent: P.amber2, hairStyle: 'long', outfit: 'dress', accessory: 'star' },
    'budget-hunter': { skin: P.cream1, hair: P.wood0, shirt: P.green2, bottom: P.wood1, accent: P.amber2, hairStyle: 'cap', outfit: 'hoodie', accessory: 'coin' },
};

function drawCustomer(ctx: CanvasRenderingContext2D, id: string) {
    const look = SHOP_CUSTOMER_LOOKS[id] || SHOP_CUSTOMER_LOOKS['office-runner'];
    shadow(ctx, 9, 29, 14);

    r(ctx, 11, 26, 4, 4, P.ink2);
    r(ctx, 19, 26, 4, 4, P.ink2);
    r(ctx, 11, 21, 4, 6, look.bottom);
    r(ctx, 19, 21, 4, 6, look.bottom);

    if (look.outfit === 'coat') {
        box(ctx, 9, 18, 15, 11, look.shirt);
        r(ctx, 10, 19, 5, 9, look.accent);
        r(ctx, 18, 19, 5, 9, look.accent);
    } else if (look.outfit === 'dress') {
        r(ctx, 10, 18, 13, 6, look.shirt);
        r(ctx, 8, 23, 17, 6, look.shirt);
        r(ctx, 12, 20, 8, 2, look.accent);
    } else if (look.outfit === 'hoodie') {
        box(ctx, 9, 18, 15, 11, look.shirt);
        r(ctx, 11, 19, 11, 2, look.accent);
        r(ctx, 14, 22, 2, 2, P.white);
        r(ctx, 18, 22, 2, 2, P.white);
    } else if (look.outfit === 'apron') {
        box(ctx, 9, 18, 15, 11, look.shirt);
        r(ctx, 12, 19, 9, 8, look.accent);
        r(ctx, 14, 21, 5, 1, P.white);
    } else if (look.outfit === 'suit') {
        box(ctx, 9, 18, 15, 11, look.shirt);
        r(ctx, 15, 18, 3, 11, P.white);
        r(ctx, 16, 20, 1, 5, look.accent);
    } else {
        box(ctx, 9, 18, 15, 11, look.shirt);
        r(ctx, 11, 20, 11, 2, look.accent);
    }

    if (look.hairStyle === 'bun') {
        r(ctx, 8, 9, 5, 5, look.hair);
        r(ctx, 20, 9, 5, 5, look.hair);
    }
    r(ctx, 11, 8, 11, 11, look.skin);
    r(ctx, 10, 10, 13, 8, look.skin);

    if (look.hairStyle === 'bob') {
        r(ctx, 9, 7, 15, 5, look.hair);
        r(ctx, 8, 10, 4, 8, look.hair);
        r(ctx, 21, 10, 4, 8, look.hair);
    } else if (look.hairStyle === 'side') {
        r(ctx, 9, 7, 14, 5, look.hair);
        r(ctx, 9, 10, 6, 6, look.hair);
    } else if (look.hairStyle === 'long') {
        r(ctx, 9, 7, 15, 5, look.hair);
        r(ctx, 8, 11, 4, 10, look.hair);
        r(ctx, 21, 11, 4, 10, look.hair);
    } else {
        r(ctx, 11, 7, 11, 4, look.hair);
        r(ctx, 10, 10, 4, 4, look.hair);
    }
    if (look.hairStyle === 'cap') {
        r(ctx, 10, 5, 12, 4, look.accent);
        r(ctx, 20, 7, 5, 2, look.accent);
    }

    p(ctx, 14, 13, P.black);
    p(ctx, 19, 13, P.black);
    r(ctx, 16, 16, 2, 1, P.rose0);

    switch (look.accessory) {
        case 'briefcase':
            box(ctx, 4, 20, 7, 6, P.wood0);
            r(ctx, 6, 18, 3, 2, P.wood0);
            break;
        case 'sketchbook':
            box(ctx, 4, 17, 8, 10, P.cream0);
            line(ctx, 5, 20, 10, 18, look.accent);
            break;
        case 'leash':
            line(ctx, 5, 19, 2, 26, look.accent);
            r(ctx, 1, 25, 5, 2, P.wood2);
            p(ctx, 2, 24, P.black);
            break;
        case 'parcel':
            box(ctx, 4, 18, 8, 8, P.wood2);
            line(ctx, 5, 19, 11, 25, P.wood0);
            break;
        case 'camera':
            box(ctx, 4, 16, 8, 7, P.gray0);
            r(ctx, 7, 18, 3, 3, P.blue2);
            r(ctx, 5, 14, 4, 2, P.gray1);
            break;
        case 'kid':
            r(ctx, 24, 17, 5, 5, look.skin);
            r(ctx, 23, 21, 7, 7, look.accent);
            p(ctx, 25, 19, P.black);
            break;
        case 'bottle':
            box(ctx, 4, 18, 5, 9, P.blue2);
            r(ctx, 5, 16, 3, 2, P.gray2);
            break;
        case 'umbrella':
            line(ctx, 5, 9, 9, 27, P.wood1);
            r(ctx, 1, 8, 11, 5, look.accent);
            break;
        case 'book':
            box(ctx, 4, 18, 8, 7, P.blue1);
            r(ctx, 8, 18, 1, 7, P.cream0);
            break;
        case 'gift':
            box(ctx, 4, 19, 8, 7, P.rose2);
            r(ctx, 7, 19, 2, 7, P.amber2);
            r(ctx, 4, 22, 8, 2, P.amber2);
            break;
        case 'plant':
            box(ctx, 4, 22, 7, 5, P.wood2);
            line(ctx, 8, 22, 5, 15, P.green1);
            line(ctx, 8, 22, 11, 15, P.green1);
            p(ctx, 5, 15, P.green3);
            p(ctx, 11, 15, P.green2);
            break;
        case 'cup':
            drawCup(ctx, 4, 18, 1, look.accent);
            break;
        case 'moon':
            r(ctx, 4, 17, 8, 8, P.amber2);
            r(ctx, 7, 15, 6, 8, P.ink2);
            break;
        case 'phone':
            box(ctx, 4, 16, 6, 10, P.gray0);
            r(ctx, 5, 18, 4, 5, P.blue2);
            break;
        case 'menu':
            box(ctx, 4, 15, 8, 11, P.cream0);
            r(ctx, 6, 18, 4, 1, look.accent);
            r(ctx, 6, 21, 4, 1, look.accent);
            break;
        case 'taxi':
            box(ctx, 2, 21, 10, 5, P.amber2);
            r(ctx, 4, 18, 6, 4, P.amber1);
            p(ctx, 4, 26, P.black);
            p(ctx, 10, 26, P.black);
            break;
        case 'resume':
            box(ctx, 4, 15, 8, 12, P.white);
            r(ctx, 6, 18, 4, 1, P.blue1);
            r(ctx, 6, 21, 3, 1, P.rose2);
            break;
        case 'console':
            box(ctx, 4, 19, 9, 5, P.gray0);
            p(ctx, 6, 21, P.teal2);
            p(ctx, 11, 21, P.rose2);
            break;
        case 'flower':
            line(ctx, 8, 24, 5, 16, P.green1);
            drawMiniFlower(ctx, 5, 16, P.rose2);
            drawMiniFlower(ctx, 10, 17, P.amber2);
            break;
        case 'notes':
            box(ctx, 4, 16, 8, 10, P.cream0);
            r(ctx, 6, 19, 4, 1, P.teal2);
            r(ctx, 6, 22, 3, 1, P.teal2);
            break;
        case 'craft':
            box(ctx, 4, 19, 8, 6, P.cream1);
            drawSpark(ctx, 10, 17, look.accent);
            break;
        case 'laptop':
            box(ctx, 3, 19, 10, 6, P.gray1);
            r(ctx, 5, 20, 6, 3, P.blue2);
            break;
        case 'star':
            drawSpark(ctx, 6, 17, look.accent);
            drawSpark(ctx, 24, 9, P.rose3);
            break;
        case 'coin':
            r(ctx, 5, 19, 6, 6, P.amber2);
            p(ctx, 7, 21, P.white);
            break;
    }
}

function drawEffect(ctx: CanvasRenderingContext2D, id: string) {
    if (id === 'heart') return drawHeart(ctx, 9, 8, P.rose2);
    if (id === 'zzz') {
        r(ctx, 8, 9, 9, 2, P.blue1);
        r(ctx, 14, 11, 2, 2, P.blue1);
        r(ctx, 8, 13, 9, 2, P.blue1);
        r(ctx, 17, 17, 8, 2, P.blue2);
        r(ctx, 22, 19, 2, 2, P.blue2);
        r(ctx, 17, 21, 8, 2, P.blue2);
        return;
    }
    if (id === 'guestbook') {
        box(ctx, 9, 6, 14, 20, P.wood1);
        r(ctx, 11, 8, 10, 16, P.cream0);
        r(ctx, 12, 11, 8, 1, P.ink2);
        r(ctx, 12, 15, 7, 1, P.ink2);
        p(ctx, 20, 21, P.rose2);
        return;
    }
    drawSpark(ctx, 15, 6, P.amber2, 2);
    drawSpark(ctx, 8, 17, P.teal2);
    drawSpark(ctx, 23, 20, P.rose2);
}

function drawCup(ctx: CanvasRenderingContext2D, x: number, y: number, scale = 1, color = P.cream0) {
    r(ctx, x, y + 3 * scale, 10 * scale, 7 * scale, P.ink);
    r(ctx, x + scale, y + 4 * scale, 8 * scale, 5 * scale, color);
    r(ctx, x + 9 * scale, y + 5 * scale, 3 * scale, 3 * scale, P.ink);
    r(ctx, x + 10 * scale, y + 6 * scale, scale, scale, color);
    r(ctx, x + 1 * scale, y + 2 * scale, 8 * scale, scale, P.gray2);
    r(ctx, x + 3 * scale, y + 10 * scale, 6 * scale, scale, P.gray1);
}

function drawMiniCake(ctx: CanvasRenderingContext2D, x: number, y: number, color = P.rose2, scale = 1) {
    r(ctx, x, y + 3 * scale, 6 * scale, 4 * scale, P.ink);
    r(ctx, x + scale, y + 2 * scale, 4 * scale, 2 * scale, P.cream0);
    r(ctx, x + scale, y + 4 * scale, 4 * scale, 2 * scale, color);
    p(ctx, x + 3 * scale, y + scale, P.amber2);
}

function drawMiniFlower(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
    p(ctx, x, y - 1, color);
    p(ctx, x - 1, y, color);
    p(ctx, x + 1, y, color);
    p(ctx, x, y + 1, color);
    p(ctx, x, y, P.amber2);
}

function drawSpark(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, scale = 1) {
    r(ctx, x, y - 2 * scale, scale, 5 * scale, color);
    r(ctx, x - 2 * scale, y, 5 * scale, scale, color);
    p(ctx, x - scale, y - scale, P.white);
    p(ctx, x + scale, y + scale, P.amber2);
}

function drawHeart(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
    r(ctx, x + 2, y, 4, 3, color);
    r(ctx, x + 9, y, 4, 3, color);
    r(ctx, x, y + 3, 15, 6, color);
    r(ctx, x + 2, y + 9, 11, 4, color);
    r(ctx, x + 5, y + 13, 5, 3, color);
    p(ctx, x + 7, y + 16, color);
    p(ctx, x + 4, y + 2, P.rose3);
}
