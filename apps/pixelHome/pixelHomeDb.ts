/**
 * Pixel Home — IndexedDB 存储层
 *
 * 两个 store：
 *   pixel_home_assets  — 用户生成的像素资产
 *   pixel_home_layouts — 每个角色的每个房间布局
 */

import { isLegacyDefaultPixelSurface } from './types';
import type { PixelAsset, PixelRoomLayout, PixelHomeState } from './types';
import type { MemoryRoom } from '../../utils/memoryPalace/types';
import { ROOM_SLOTS, DEFAULT_ROOM_COLORS, ALL_ROOMS } from './roomTemplates';
import type { PlacedFurniture } from './types';
import { openDB } from '../../utils/db';

// ─── DB 常量 ─────────────────────────────────────────
// pixel_home_* 两个 store 由 utils/db.ts 的主库 upgradeneeded 统一创建,
// 这里直接复用 utils/db.ts 的单例 openDB —— 本地原来那个 openDB 每次操作都裸开一条
// 主库连接 (连版本号都没传), 既漏连接又绕过单例, 会一起喂大连接风暴。

const STORE_ASSETS = 'pixel_home_assets';
const STORE_LAYOUTS = 'pixel_home_layouts';

const LEGACY_DEFAULT_ROOM_COLORS: Record<MemoryRoom, { wall: string; floor: string }> = {
  living_room: { wall: '#fef3c7', floor: '#d6b88a' },
  bedroom:     { wall: '#ede9fe', floor: '#c4b5a0' },
  study:       { wall: '#dbeafe', floor: '#8b7355' },
  attic:       { wall: '#4b5563', floor: '#374151' },
  self_room:   { wall: '#fce7f3', floor: '#d4a8c0' },
  user_room:   { wall: '#d1fae5', floor: '#a8c4b0' },
  windowsill:  { wall: '#cffafe', floor: '#92a89c' },
};

function isLegacyDefaultTexture(value: unknown): boolean {
  return typeof value === 'string' && isLegacyDefaultPixelSurface(value);
}

function isLegacyDefaultSurfaceValue(roomId: MemoryRoom, surface: 'wall' | 'floor', value: unknown): boolean {
  if (isLegacyDefaultTexture(value)) return true;
  if (typeof value !== 'string') return false;
  return value.toLowerCase() === LEGACY_DEFAULT_ROOM_COLORS[roomId]?.[surface].toLowerCase();
}

function sanitizePresetSurface(roomId: MemoryRoom, surface: 'wall' | 'floor', value: unknown): string {
  if (isLegacyDefaultSurfaceValue(roomId, surface, value)) return '';
  return typeof value === 'string' ? value : '';
}

function layoutLooksLikeBuiltinDefault(layout: PixelRoomLayout): boolean {
  if (layout.lastDecoratedBy === 'user') return false;
  const slotIds = new Set((ROOM_SLOTS[layout.roomId] || []).map(slot => slot.id));
  return (layout.furniture || []).every(f =>
    slotIds.has(f.slotId) &&
    f.placedBy !== 'user' &&
    f.isDefault !== false &&
    !f.assetId
  );
}

function isLegacyDefaultPresetAsset(asset: PixelAsset): boolean {
  return (Array.isArray(asset.tags) && asset.tags.includes('default')) ||
    isLegacyDefaultPixelSurface(asset.pixelImage) ||
    isLegacyDefaultPixelSurface(asset.originalImage);
}

// ─── 资产 CRUD ──────────────────────────────────────

export const PixelAssetDB = {
  async save(asset: PixelAsset): Promise<void> {
    const db = await openDB();
    const tx = db.transaction(STORE_ASSETS, 'readwrite');
    tx.objectStore(STORE_ASSETS).put(asset);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async saveBatch(assets: PixelAsset[]): Promise<void> {
    const db = await openDB();
    const tx = db.transaction(STORE_ASSETS, 'readwrite');
    const store = tx.objectStore(STORE_ASSETS);
    for (const a of assets) store.put(a);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async getAll(): Promise<PixelAsset[]> {
    const db = await openDB();
    const tx = db.transaction(STORE_ASSETS, 'readonly');
    const req = tx.objectStore(STORE_ASSETS).getAll();
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  async getById(id: string): Promise<PixelAsset | undefined> {
    const db = await openDB();
    const tx = db.transaction(STORE_ASSETS, 'readonly');
    const req = tx.objectStore(STORE_ASSETS).get(id);
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async delete(id: string): Promise<void> {
    const db = await openDB();
    const tx = db.transaction(STORE_ASSETS, 'readwrite');
    tx.objectStore(STORE_ASSETS).delete(id);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
};

// ─── 布局 CRUD ──────────────────────────────────────

export const PixelLayoutDB = {
  async save(layout: PixelRoomLayout): Promise<void> {
    const db = await openDB();
    const tx = db.transaction(STORE_LAYOUTS, 'readwrite');
    tx.objectStore(STORE_LAYOUTS).put(layout);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async get(charId: string, roomId: MemoryRoom): Promise<PixelRoomLayout | undefined> {
    const db = await openDB();
    const tx = db.transaction(STORE_LAYOUTS, 'readonly');
    const req = tx.objectStore(STORE_LAYOUTS).get([charId, roomId]);
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async getAllForChar(charId: string): Promise<PixelRoomLayout[]> {
    const db = await openDB();
    const tx = db.transaction(STORE_LAYOUTS, 'readonly');
    const idx = tx.objectStore(STORE_LAYOUTS).index('charId');
    const req = idx.getAll(charId);
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  async saveBatch(layouts: PixelRoomLayout[]): Promise<void> {
    const db = await openDB();
    const tx = db.transaction(STORE_LAYOUTS, 'readwrite');
    const store = tx.objectStore(STORE_LAYOUTS);
    for (const l of layouts) store.put(l);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
};

// ─── 内置默认家园预设 ──────────────────────────────

/**
 * 尝试为指定角色加载内置默认家园预设。
 * 查找顺序：
 *   1. public/pixel-presets/<charId>.json   — 该角色专属预设
 *   2. public/pixel-presets/default.json    — 所有角色共用的默认家园
 * 预设文件由仓库 pixelroom/ 导出的 JSON 复制而来。
 *
 * 返回 true 表示成功加载并写入了至少一个房间。
 */
async function trySeedDefaultHome(charId: string): Promise<boolean> {
  // 仅在浏览器环境（有 fetch + 静态资源服务）下尝试
  if (typeof fetch !== 'function') return false;

  const base = (import.meta as any).env?.BASE_URL ?? '/';
  const candidates = [
    `${base}pixel-presets/${encodeURIComponent(charId)}.json`,
    `${base}pixel-presets/default.json`,
  ];

  let preset: any = null;
  for (const url of candidates) {
    try {
      const resp = await fetch(url, { cache: 'force-cache' });
      if (!resp.ok) continue;
      preset = await resp.json();
      if (preset && Array.isArray(preset.rooms) && preset.rooms.length > 0) break;
      preset = null;
    } catch {
      // 继续下一个候选
    }
  }
  if (!preset) return false;

  // 默认家具现在由 roomPixelRenderer 手绘生成，不再导入旧预设里的家具资产。

  // 导入房间布局
  const layouts: PixelRoomLayout[] = preset.rooms.map((r: any) => ({
    roomId: r.roomId,
    charId,
    furniture: (r.furniture || [])
      .filter((f: any) => f && f.isDefault !== false && !String(f.slotId || '').startsWith('user_'))
      .map((f: any) => ({ ...f, assetId: null })),
    wallColor: sanitizePresetSurface(r.roomId, 'wall', r.wallColor),
    floorColor: sanitizePresetSurface(r.roomId, 'floor', r.floorColor),
    ambiance: r.ambiance,
    wallFillMode: isLegacyDefaultSurfaceValue(r.roomId, 'wall', r.wallColor) ? 'tile' : r.wallFillMode,
    wallOffsetX: isLegacyDefaultSurfaceValue(r.roomId, 'wall', r.wallColor) ? 50 : r.wallOffsetX,
    wallOffsetY: isLegacyDefaultSurfaceValue(r.roomId, 'wall', r.wallColor) ? 50 : r.wallOffsetY,
    floorFillMode: isLegacyDefaultSurfaceValue(r.roomId, 'floor', r.floorColor) ? 'tile' : r.floorFillMode,
    floorOffsetX: isLegacyDefaultSurfaceValue(r.roomId, 'floor', r.floorColor) ? 50 : r.floorOffsetX,
    floorOffsetY: isLegacyDefaultSurfaceValue(r.roomId, 'floor', r.floorColor) ? 50 : r.floorOffsetY,
    lastUpdatedAt: Date.now(),
    lastDecoratedBy: 'character' as const,
  }));
  if (layouts.length === 0) return false;
  await PixelLayoutDB.saveBatch(layouts);
  return true;
}

// ─── 家园状态整合 ────────────────────────────────────

/**
 * 判断一组房间是不是"还没装修过"——没有任何用户放置的家具、也没有任何关联到具体资产的家具。
 * 用于判断是否值得跑一次默认预设填充（如存在旧版空壳数据）。
 */
function layoutsLookUntouched(layouts: PixelRoomLayout[]): boolean {
  if (layouts.length === 0) return true;
  for (const r of layouts) {
    for (const f of r.furniture || []) {
      if (f.placedBy === 'user') return false;
      if (f.assetId) return false;
    }
  }
  return true;
}

/**
 * 旧版默认家园会把一批内置 PNG 家具当作 user_ 家具导入，并给资产打上 default 标签。
 * 现在默认家具改由代码手绘生成；这里仅移除这些内置旧家具，不碰用户自己导入的资产。
 */
async function removeLegacyDefaultPresetFurniture(layouts: PixelRoomLayout[]): Promise<PixelRoomLayout[]> {
  if (layouts.length === 0) return layouts;

  let defaultAssetIds: Set<string>;
  try {
    const assets = await PixelAssetDB.getAll();
    defaultAssetIds = new Set(
      assets
        .filter(isLegacyDefaultPresetAsset)
        .map(a => a.id)
    );
  } catch {
    return layouts;
  }

  if (defaultAssetIds.size === 0) return layouts;

  let changed = false;
  const next = layouts.map(layout => {
    let roomChanged = false;
    const furniture = (layout.furniture || [])
      .filter(f => {
        const isLegacyFreeDefault =
          f.isDefault === false &&
          !!f.assetId &&
          defaultAssetIds.has(f.assetId) &&
          String(f.slotId || '').startsWith('user_');
        if (isLegacyFreeDefault) {
          roomChanged = true;
          return false;
        }
        return true;
      })
      .map(f => {
        if (f.isDefault !== false && f.assetId && defaultAssetIds.has(f.assetId)) {
          roomChanged = true;
          return { ...f, assetId: null };
        }
        return f;
      });

    if (!roomChanged) return layout;
    changed = true;
    return {
      ...layout,
      furniture,
      lastUpdatedAt: Date.now(),
    };
  });

  if (changed) await PixelLayoutDB.saveBatch(next);
  return next;
}

/** 获取角色的完整家园状态，不存在则初始化默认 */
async function resetLegacyDefaultRoomSurfaces(layouts: PixelRoomLayout[]): Promise<PixelRoomLayout[]> {
  if (layouts.length === 0) return layouts;

  let changed = false;
  const next = layouts.map(layout => {
    const looksBuiltin = layoutLooksLikeBuiltinDefault(layout);
    const hasLegacyTexture =
      isLegacyDefaultTexture(layout.wallColor) ||
      isLegacyDefaultTexture(layout.floorColor);
    if (!hasLegacyTexture && !looksBuiltin) return layout;

    const wallLegacy = isLegacyDefaultTexture(layout.wallColor) ||
      (looksBuiltin && isLegacyDefaultSurfaceValue(layout.roomId, 'wall', layout.wallColor));
    const floorLegacy = isLegacyDefaultTexture(layout.floorColor) ||
      (looksBuiltin && isLegacyDefaultSurfaceValue(layout.roomId, 'floor', layout.floorColor));
    if (!wallLegacy && !floorLegacy) return layout;

    changed = true;
    return {
      ...layout,
      wallColor: wallLegacy ? '' : layout.wallColor,
      floorColor: floorLegacy ? '' : layout.floorColor,
      wallFillMode: wallLegacy ? 'tile' as const : layout.wallFillMode,
      wallOffsetX: wallLegacy ? 50 : layout.wallOffsetX,
      wallOffsetY: wallLegacy ? 50 : layout.wallOffsetY,
      floorFillMode: floorLegacy ? 'tile' as const : layout.floorFillMode,
      floorOffsetX: floorLegacy ? 50 : layout.floorOffsetX,
      floorOffsetY: floorLegacy ? 50 : layout.floorOffsetY,
      lastUpdatedAt: Date.now(),
    };
  });

  if (changed) await PixelLayoutDB.saveBatch(next);
  return next;
}

export async function getOrCreateHomeState(charId: string): Promise<PixelHomeState> {
  let existing = await PixelLayoutDB.getAllForChar(charId);
  existing = await removeLegacyDefaultPresetFurniture(existing);
  existing = await resetLegacyDefaultRoomSurfaces(existing);

  // 首次进入、或之前只存了空壳（没家具/没用户放置）：尝试加载内置默认家园预设
  if (layoutsLookUntouched(existing)) {
    try {
      const seeded = await trySeedDefaultHome(charId);
      if (seeded) {
        existing = await PixelLayoutDB.getAllForChar(charId);
        existing = await resetLegacyDefaultRoomSurfaces(existing);
      }
    } catch (e) {
      console.warn('[pixelHome] seed default home failed:', e);
    }
  }

  if (existing.length === ALL_ROOMS.length) {
    return {
      charId,
      rooms: existing,
      lastLLMDecoration: 0,
    };
  }

  // 补齐缺失的房间
  const existingMap = new Map(existing.map(r => [r.roomId, r]));
  const allRooms: PixelRoomLayout[] = ALL_ROOMS.map(roomId => {
    if (existingMap.has(roomId)) return existingMap.get(roomId)!;

    const slots = ROOM_SLOTS[roomId];
    const colors = DEFAULT_ROOM_COLORS[roomId];
    const furniture: PlacedFurniture[] = slots.map(slot => ({
      slotId: slot.id,
      assetId: null,
      x: slot.defaultX,
      y: slot.defaultY,
      scale: slot.defaultScale,
      rotation: 0,
      placedBy: 'character' as const,
      isDefault: true,
    }));

    return {
      roomId,
      charId,
      furniture,
      wallColor: colors.wall,
      floorColor: colors.floor,
      ambiance: '',
      lastUpdatedAt: Date.now(),
      lastDecoratedBy: 'character' as const,
    };
  });

  // 保存新建的房间
  const newRooms = allRooms.filter(r => !existingMap.has(r.roomId));
  if (newRooms.length > 0) {
    await PixelLayoutDB.saveBatch(newRooms);
  }

  return {
    charId,
    rooms: allRooms,
    lastLLMDecoration: 0,
  };
}
