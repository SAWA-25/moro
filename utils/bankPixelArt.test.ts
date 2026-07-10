import { describe, expect, it } from 'vitest';
import {
  BANK_PIXEL_CUSTOMER_DEFS,
  BANK_PIXEL_DECOR_SET_DEFS,
  BANK_PIXEL_DAILY_FURNITURE_DEFS,
  BANK_PIXEL_PRODUCT_IDS,
  BANK_PIXEL_STAFF_DEFS,
  BANK_PIXEL_STICKER_LIBRARY,
  getBankPixelAssetMeta,
} from '../components/bank/bankPixelArt';
import { AVAILABLE_STAFF } from '../components/bank/BankGameConstants';

describe('Bank shop pixel furniture library', () => {
  it('adds at least 120 themed decoration items to the shop furniture library', () => {
    expect(BANK_PIXEL_DECOR_SET_DEFS).toHaveLength(126);
    expect(BANK_PIXEL_DECOR_SET_DEFS.length).toBeGreaterThanOrEqual(120);

    const ids = BANK_PIXEL_DECOR_SET_DEFS.map(item => item.id);
    const assetIds = BANK_PIXEL_DECOR_SET_DEFS.map(item => item.assetId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(assetIds).size).toBe(assetIds.length);
    expect(BANK_PIXEL_DECOR_SET_DEFS.every(item => item.category === 'decor-set')).toBe(true);
  });

  it('keeps each decor set at 18 items and searchable by theme tags', () => {
    const themes = ['咖啡烘焙', '粉彩烘焙', '赛博夜市', '植物温室', '复古餐车', '海边小铺', '月光茶铺'];

    for (const theme of themes) {
      const themed = BANK_PIXEL_DECOR_SET_DEFS.filter(item => item.theme === theme);
      expect(themed).toHaveLength(18);
      expect(themed.every(item => item.tags.includes('装饰套装'))).toBe(true);
    }
  });

  it('registers every decor item as a pixel sticker with render metadata', () => {
    const stickerIds = new Set(BANK_PIXEL_STICKER_LIBRARY.map(item => item.id));
    const wallCount = BANK_PIXEL_DECOR_SET_DEFS.filter(item => item.surface === 'leftWall').length;
    const floorCount = BANK_PIXEL_DECOR_SET_DEFS.filter(item => item.surface === 'floor').length;

    expect(wallCount).toBeGreaterThan(0);
    expect(floorCount).toBeGreaterThan(0);
    for (const item of BANK_PIXEL_DECOR_SET_DEFS) {
      expect(stickerIds.has(item.id)).toBe(true);
      const meta = getBankPixelAssetMeta(`bank-pixel:${item.assetId}@${item.size || 96}`);
      expect(meta?.kind).toBe('furniture');
      expect(meta?.defaultSize).toBe(item.size || 96);
      expect(meta?.surface).toBe(item.surface);
    }
  });

  it('adds at least 120 everyday shop furniture items to the shop furniture library', () => {
    expect(BANK_PIXEL_DAILY_FURNITURE_DEFS).toHaveLength(126);
    expect(BANK_PIXEL_DAILY_FURNITURE_DEFS.length).toBeGreaterThanOrEqual(120);

    const ids = BANK_PIXEL_DAILY_FURNITURE_DEFS.map(item => item.id);
    const assetIds = BANK_PIXEL_DAILY_FURNITURE_DEFS.map(item => item.assetId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(assetIds).size).toBe(assetIds.length);
    expect(BANK_PIXEL_DAILY_FURNITURE_DEFS.every(item => item.category === 'daily')).toBe(true);
    expect(BANK_PIXEL_DAILY_FURNITURE_DEFS.every(item => item.id.startsWith('stk-daily-'))).toBe(true);
    expect(BANK_PIXEL_DAILY_FURNITURE_DEFS.every(item => item.assetId.startsWith('furniture/daily-'))).toBe(true);
  });

  it('keeps each daily shop set at 18 items and searchable by daily tags', () => {
    const themes = ['前台收银', '后厨备餐', '清洁维护', '仓储补货', '员工休息', '顾客便利', '开店收摊'];

    for (const theme of themes) {
      const themed = BANK_PIXEL_DAILY_FURNITURE_DEFS.filter(item => item.theme === theme);
      expect(themed).toHaveLength(18);
      expect(themed.every(item => item.tags.includes('日常'))).toBe(true);
      expect(themed.every(item => item.tags.includes('店铺日常'))).toBe(true);
    }
  });

  it('registers every daily shop item as a pixel sticker with render metadata', () => {
    const stickerIds = new Set(BANK_PIXEL_STICKER_LIBRARY.map(item => item.id));
    const wallCount = BANK_PIXEL_DAILY_FURNITURE_DEFS.filter(item => item.surface === 'leftWall').length;
    const floorCount = BANK_PIXEL_DAILY_FURNITURE_DEFS.filter(item => item.surface === 'floor').length;

    expect(wallCount).toBeGreaterThan(0);
    expect(floorCount).toBeGreaterThan(0);
    for (const item of BANK_PIXEL_DAILY_FURNITURE_DEFS) {
      expect(stickerIds.has(item.id)).toBe(true);
      const meta = getBankPixelAssetMeta(`bank-pixel:${item.assetId}@${item.size || 96}`);
      expect(meta?.kind).toBe('furniture');
      expect(meta?.defaultSize).toBe(item.size || 96);
      expect(meta?.surface).toBe(item.surface);
    }
  });

  it('adds at least 10 distinct pixel staff candidates to the hiring pool', () => {
    expect(BANK_PIXEL_STAFF_DEFS).toHaveLength(10);
    expect(BANK_PIXEL_STAFF_DEFS.length).toBeGreaterThanOrEqual(10);

    const ids = BANK_PIXEL_STAFF_DEFS.map(item => item.id);
    const names = BANK_PIXEL_STAFF_DEFS.map(item => item.name);
    const assetIds = BANK_PIXEL_STAFF_DEFS.map(item => item.assetId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(assetIds).size).toBe(assetIds.length);
    expect(BANK_PIXEL_STAFF_DEFS.every(item => item.assetId.startsWith('staff/'))).toBe(true);
    expect(new Set(BANK_PIXEL_STAFF_DEFS.map(item => item.role))).toEqual(new Set(['manager', 'waiter', 'chef']));
  });

  it('registers every new pixel staff avatar as staff metadata and available staff', () => {
    const availableByName = new Set(AVAILABLE_STAFF.map(item => item.name));
    const availableAvatars = new Set(AVAILABLE_STAFF.map(item => item.avatar));

    for (const staff of BANK_PIXEL_STAFF_DEFS) {
      const ref = `bank-pixel:${staff.assetId}@64`;
      const meta = getBankPixelAssetMeta(ref);
      expect(meta?.kind).toBe('staff');
      expect(meta?.defaultSize).toBe(64);
      expect(availableByName.has(staff.name)).toBe(true);
      expect(availableAvatars.has(ref)).toBe(true);
    }
  });

  it('registers every shop product as a 64px pixel product asset', () => {
    expect(BANK_PIXEL_PRODUCT_IDS).toHaveLength(40);
    expect(new Set(BANK_PIXEL_PRODUCT_IDS).size).toBe(BANK_PIXEL_PRODUCT_IDS.length);

    for (const id of BANK_PIXEL_PRODUCT_IDS) {
      const meta = getBankPixelAssetMeta(`bank-pixel:product/${id}@64`);
      expect(meta?.kind).toBe('product');
      expect(meta?.defaultSize).toBe(64);
    }
  });

  it('adds at least 20 distinct ambient pixel customer types', () => {
    expect(BANK_PIXEL_CUSTOMER_DEFS.length).toBeGreaterThanOrEqual(20);

    const ids = BANK_PIXEL_CUSTOMER_DEFS.map(item => item.id);
    const names = BANK_PIXEL_CUSTOMER_DEFS.map(item => item.name);
    const assetIds = BANK_PIXEL_CUSTOMER_DEFS.map(item => item.assetId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(assetIds).size).toBe(assetIds.length);
    expect(BANK_PIXEL_CUSTOMER_DEFS.every(item => item.id.startsWith('customer-'))).toBe(true);
    expect(BANK_PIXEL_CUSTOMER_DEFS.every(item => item.assetId.startsWith('customer/'))).toBe(true);
    expect(BANK_PIXEL_CUSTOMER_DEFS.every(item => item.trait.length > 0)).toBe(true);
    expect(BANK_PIXEL_CUSTOMER_DEFS.every(item => item.reactionTags.length > 0)).toBe(true);
  });

  it('registers every ambient customer avatar as customer metadata', () => {
    for (const customer of BANK_PIXEL_CUSTOMER_DEFS) {
      const meta = getBankPixelAssetMeta(`bank-pixel:${customer.assetId}@64`);
      expect(meta?.kind).toBe('customer');
      expect(meta?.defaultSize).toBe(64);
    }
  });
});
