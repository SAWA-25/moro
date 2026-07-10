import { describe, expect, it } from 'vitest';
import {
  BUILTIN_PIXEL_ASSET_PREFIX,
  BUILTIN_PIXEL_FURNITURE_DEFS,
  BUILTIN_PIXEL_SIZE,
  getBuiltinPixelAssets,
} from '../apps/pixelHome/builtinFurnitureCatalog';

const ROOM_TAGS = ['客厅', '卧室', '书房', '阁楼', '自我房', '用户房', '露台'];

describe('Pixel Home builtin furniture catalog', () => {
  it('provides the base furniture and decor-set builtin assets with stable IDs', () => {
    expect(BUILTIN_PIXEL_FURNITURE_DEFS).toHaveLength(252);
    expect(BUILTIN_PIXEL_FURNITURE_DEFS.length).toBeGreaterThanOrEqual(240);

    const ids = BUILTIN_PIXEL_FURNITURE_DEFS.map(item => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(id => id.startsWith(BUILTIN_PIXEL_ASSET_PREFIX))).toBe(true);
  });

  it('adds at least 120 themed decoration-set assets', () => {
    const decorSetAssets = BUILTIN_PIXEL_FURNITURE_DEFS.filter(item => item.tags.includes('装饰套装'));
    const setTags = ['森系', '赛博', '复古', '海滨', '月相', '糖果', '茶室'];

    expect(decorSetAssets).toHaveLength(126);
    expect(decorSetAssets.length).toBeGreaterThanOrEqual(120);
    expect(decorSetAssets.every(item => item.tags.includes('decor'))).toBe(true);
    for (const tag of setTags) {
      expect(decorSetAssets.filter(item => item.tags.includes(tag))).toHaveLength(18);
    }
  });

  it('keeps each builtin item searchable by category and room', () => {
    const assets = getBuiltinPixelAssets();
    expect(assets).toHaveLength(BUILTIN_PIXEL_FURNITURE_DEFS.length);

    for (const asset of assets) {
      expect(asset.isBuiltin).toBe(true);
      expect(asset.name.trim()).not.toBe('');
      expect(asset.pixelSize).toBe(BUILTIN_PIXEL_SIZE);
      expect(asset.width).toBe(BUILTIN_PIXEL_SIZE);
      expect(asset.height).toBe(BUILTIN_PIXEL_SIZE);
      expect(asset.tags).toContain('builtin');
      expect(asset.tags).toContain('内置');
      expect(asset.tags.some(tag => ROOM_TAGS.includes(tag))).toBe(true);
      expect(asset.tags.some(tag => ['furniture', 'decor', 'plant', 'food', 'other'].includes(tag))).toBe(true);
    }
  });

  it('marks every rug-like builtin as a rug for the carpet layer', () => {
    const rugs = BUILTIN_PIXEL_FURNITURE_DEFS.filter(item =>
      item.shape.includes('rug') || item.shape.includes('mat') || item.name.includes('地毯') || item.name.includes('毯'),
    );

    expect(rugs.length).toBeGreaterThanOrEqual(12);
    expect(rugs.every(item => item.tags.includes('rug'))).toBe(true);
  });
});
