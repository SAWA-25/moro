type BankPixelKind = 'furniture' | 'recipe' | 'staff' | 'effect';

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

for (const item of FURNITURE) addMeta(item.assetId, item.assetId.startsWith('effect/') ? 'effect' : 'furniture', item.size || 96, item.surface);

[
    'recipe/coffee', 'recipe/cake', 'recipe/tea', 'recipe/donut', 'recipe/icecream', 'recipe/pudding', 'recipe/cocktail',
].forEach(id => addMeta(id, 'recipe', 64));

[
    'staff/manager', 'staff/waiter', 'staff/chef', 'staff/cat', 'staff/dog', 'staff/bear', 'staff/rabbit', 'staff/penguin', 'staff/generic', 'staff/tired',
].forEach(id => addMeta(id, 'staff', 64));

['effect/heart', 'effect/sparkles', 'effect/zzz', 'effect/guestbook'].forEach(id => addMeta(id, 'effect', 64));

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
    return (value || '').trim();
}

function legacyTwemoji(code: string): string {
    return `https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/${code}.png`;
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
    return drawFurniture(ctx, id.replace(/^furniture\//, ''));
}

function drawFurniture(ctx: CanvasRenderingContext2D, id: string) {
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
