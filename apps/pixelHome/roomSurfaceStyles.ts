import type { CSSProperties } from 'react';
import type { MemoryRoom } from '../../utils/memoryPalace/types';

export type PixelFloorPattern = 'wood' | 'tile' | 'stone';
export type PixelWallPattern = 'panel' | 'diamond' | 'shelves' | 'plaster' | 'stars' | 'linen' | 'glass';

export interface PixelRoomSurfaceStyle {
  wallFace: string;
  wallFaceDark: string;
  wallAccent: string;
  base: string;
  alt: string;
  floor: string;
  floorAlt: string;
  floorAccent: string;
  pattern: PixelFloorPattern;
  floorType: PixelFloorPattern;
  wallPattern: PixelWallPattern;
}

export const ROOM_SURFACE_STYLES: Record<MemoryRoom, PixelRoomSurfaceStyle> = {
  living_room: {
    wallFace: '#d9cfb2',
    wallFaceDark: '#9d8466',
    wallAccent: '#708f73',
    base: '#a8754b',
    alt: '#795436',
    floor: '#a8754b',
    floorAlt: '#795436',
    floorAccent: '#d2a66b',
    pattern: 'wood',
    floorType: 'wood',
    wallPattern: 'panel',
  },
  bedroom: {
    wallFace: '#cdbcc8',
    wallFaceDark: '#98798b',
    wallAccent: '#6f6f91',
    base: '#946b55',
    alt: '#6c4b3c',
    floor: '#946b55',
    floorAlt: '#6c4b3c',
    floorAccent: '#c79b78',
    pattern: 'wood',
    floorType: 'wood',
    wallPattern: 'diamond',
  },
  study: {
    wallFace: '#b9c4b0',
    wallFaceDark: '#75856c',
    wallAccent: '#5d6e86',
    base: '#6f5639',
    alt: '#4e3b2a',
    floor: '#6f5639',
    floorAlt: '#4e3b2a',
    floorAccent: '#9b784c',
    pattern: 'wood',
    floorType: 'wood',
    wallPattern: 'shelves',
  },
  attic: {
    wallFace: '#6f675e',
    wallFaceDark: '#464039',
    wallAccent: '#8c7d65',
    base: '#594e45',
    alt: '#3f3832',
    floor: '#594e45',
    floorAlt: '#3f3832',
    floorAccent: '#75665a',
    pattern: 'stone',
    floorType: 'stone',
    wallPattern: 'plaster',
  },
  self_room: {
    wallFace: '#d6bcc2',
    wallFaceDark: '#9a717b',
    wallAccent: '#3f7f85',
    base: '#ad8792',
    alt: '#8f6873',
    floor: '#ad8792',
    floorAlt: '#8f6873',
    floorAccent: '#d0aab2',
    pattern: 'tile',
    floorType: 'tile',
    wallPattern: 'stars',
  },
  user_room: {
    wallFace: '#c5d4bf',
    wallFaceDark: '#839577',
    wallAccent: '#bb7d5b',
    base: '#8ea58d',
    alt: '#708370',
    floor: '#8ea58d',
    floorAlt: '#708370',
    floorAccent: '#c2d0ad',
    pattern: 'tile',
    floorType: 'tile',
    wallPattern: 'linen',
  },
  windowsill: {
    wallFace: '#afc7c2',
    wallFaceDark: '#6f938e',
    wallAccent: '#c7894f',
    base: '#8c9989',
    alt: '#667469',
    floor: '#8c9989',
    floorAlt: '#667469',
    floorAccent: '#b3b994',
    pattern: 'stone',
    floorType: 'stone',
    wallPattern: 'glass',
  },
};

export function getRoomSurfaceStyle(roomId: MemoryRoom): PixelRoomSurfaceStyle {
  return ROOM_SURFACE_STYLES[roomId] || ROOM_SURFACE_STYLES.living_room;
}

const SURFACE_SIZE = 48;
const SURFACE_SCALE = 3;
const _surfaceCache = new Map<string, string>();

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function pp(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  rr(ctx, x, y, 1, 1, color);
}

function drawSurfaceTile(roomId: MemoryRoom, surface: 'wall' | 'floor'): string | null {
  if (typeof document === 'undefined') return null;

  const key = `${roomId}:${surface}`;
  const cached = _surfaceCache.get(key);
  if (cached) return cached;

  const s = getRoomSurfaceStyle(roomId);
  const small = document.createElement('canvas');
  small.width = SURFACE_SIZE;
  small.height = SURFACE_SIZE;
  const ctx = small.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  if (surface === 'wall') drawWallTile(ctx, roomId, s);
  else drawFloorTile(ctx, roomId, s);

  const canvas = document.createElement('canvas');
  canvas.width = SURFACE_SIZE * SURFACE_SCALE;
  canvas.height = SURFACE_SIZE * SURFACE_SCALE;
  const out = canvas.getContext('2d')!;
  out.imageSmoothingEnabled = false;
  out.drawImage(small, 0, 0, canvas.width, canvas.height);

  const uri = canvas.toDataURL('image/png');
  _surfaceCache.set(key, uri);
  return uri;
}

function drawWallTile(ctx: CanvasRenderingContext2D, roomId: MemoryRoom, s: PixelRoomSurfaceStyle) {
  rr(ctx, 0, 0, 48, 48, s.wallFace);
  for (let y = 0; y < 48; y += 6) rr(ctx, 0, y, 48, 1, `${s.wallFaceDark}66`);
  for (let x = 0; x < 48; x += 12) rr(ctx, x, 0, 1, 48, 'rgba(255,255,255,0.18)');

  if (roomId === 'living_room') {
    for (let x = 4; x < 48; x += 12) {
      rr(ctx, x, 5, 1, 28, s.wallAccent);
      pp(ctx, x - 2, 11, s.wallAccent); pp(ctx, x + 2, 16, s.wallAccent);
      pp(ctx, x - 3, 24, '#b85f4f'); pp(ctx, x + 3, 25, '#e0b06f');
    }
    rr(ctx, 0, 36, 48, 3, s.wallFaceDark);
    rr(ctx, 0, 39, 48, 1, s.wallAccent);
    return;
  }

  if (roomId === 'bedroom') {
    for (let x = -8; x < 56; x += 16) {
      rr(ctx, x + 7, 7, 2, 2, '#f4d7a8');
      pp(ctx, x + 8, 5, '#fff1c9'); pp(ctx, x + 8, 10, '#fff1c9');
      pp(ctx, x + 5, 8, '#fff1c9'); pp(ctx, x + 11, 8, '#fff1c9');
      rr(ctx, x + 2, 24, 11, 1, s.wallFaceDark);
      rr(ctx, x + 5, 21, 1, 7, s.wallAccent);
    }
    rr(ctx, 0, 34, 48, 2, '#f0c4b7');
    rr(ctx, 0, 38, 48, 2, s.wallFaceDark);
    return;
  }

  if (roomId === 'study') {
    for (let y = 8; y < 42; y += 14) {
      rr(ctx, 0, y + 7, 48, 2, s.wallFaceDark);
      for (let x = 4; x < 46; x += 7) {
        rr(ctx, x, y, 2, 7, ['#8f4f43', '#4f6c86', '#d0a35c', '#5e7c58'][Math.floor(x / 7) % 4]);
        rr(ctx, x + 2, y + 1, 1, 6, '#ead6ad');
      }
    }
    rr(ctx, 36, 4, 8, 8, '#e9dfc5');
    rr(ctx, 37, 5, 6, 6, '#6d8797');
    return;
  }

  if (roomId === 'attic') {
    for (let y = 2; y < 48; y += 10) rr(ctx, 0, y, 48, 1, '#3c352f');
    for (let x = 3; x < 48; x += 13) {
      rr(ctx, x, 0, 1, 48, '#514941');
      pp(ctx, x + 5, 9, '#9f9177'); pp(ctx, x + 7, 29, '#8a7d68');
    }
    rr(ctx, 7, 4, 1, 12, '#2f2b27'); rr(ctx, 8, 16, 5, 1, '#2f2b27');
    rr(ctx, 32, 20, 1, 14, '#2f2b27'); rr(ctx, 28, 33, 5, 1, '#2f2b27');
    return;
  }

  if (roomId === 'self_room') {
    for (let x = 6; x < 48; x += 14) {
      for (let y = 6; y < 48; y += 14) {
        pp(ctx, x, y - 2, '#ffe0b8'); pp(ctx, x - 2, y, '#ffe0b8');
        pp(ctx, x + 2, y, '#ffe0b8'); pp(ctx, x, y + 2, '#ffe0b8');
        pp(ctx, x, y, s.wallAccent);
      }
    }
    rr(ctx, 0, 35, 48, 2, s.wallFaceDark);
    rr(ctx, 0, 39, 48, 1, '#f2cfb7');
    return;
  }

  if (roomId === 'user_room') {
    for (let x = 0; x < 48; x += 8) rr(ctx, x, 0, 2, 48, '#e5ddbd');
    for (let y = 0; y < 48; y += 8) rr(ctx, 0, y, 48, 2, '#9aa885');
    for (let x = 4; x < 48; x += 16) for (let y = 4; y < 48; y += 16) pp(ctx, x, y, s.wallAccent);
    rr(ctx, 0, 37, 48, 3, '#7f6d4d');
    return;
  }

  for (let x = 0; x < 48; x += 16) rr(ctx, x, 0, 2, 48, s.wallFaceDark);
  for (let y = 0; y < 48; y += 16) rr(ctx, 0, y, 48, 2, '#d7ece0');
  for (let x = 5; x < 48; x += 18) {
    rr(ctx, x, 18, 1, 13, '#567b6f');
    pp(ctx, x - 2, 23, '#6fae78'); pp(ctx, x + 2, 20, '#6fae78');
  }
  rr(ctx, 0, 36, 48, 2, s.wallAccent);
}

function drawFloorTile(ctx: CanvasRenderingContext2D, roomId: MemoryRoom, s: PixelRoomSurfaceStyle) {
  rr(ctx, 0, 0, 48, 48, s.base);

  if (roomId === 'living_room') {
    for (let y = 0; y < 48; y += 12) {
      for (let x = -12; x < 48; x += 24) {
        rr(ctx, x + (y % 24 === 0 ? 0 : 12), y, 12, 10, '#b77845');
        rr(ctx, x + (y % 24 === 0 ? 12 : 0), y, 12, 10, '#875a38');
      }
      rr(ctx, 0, y + 10, 48, 1, s.alt);
    }
  } else if (roomId === 'bedroom') {
    for (let y = 0; y < 48; y += 12) {
      rr(ctx, 0, y, 48, 1, '#704f61');
      for (let x = 0; x < 48; x += 12) {
        rr(ctx, x, y, 1, 12, '#704f61');
        rr(ctx, x + 2, y + 2, 8, 8, (x + y) % 24 === 0 ? '#b28a8d' : '#8d6f87');
        pp(ctx, x + 5, y + 5, '#e2c6a8');
      }
    }
  } else if (roomId === 'study') {
    for (let y = 0; y < 48; y += 8) {
      rr(ctx, 0, y, 48, 1, s.alt);
      for (let x = (y % 16 === 0 ? 0 : 12); x < 48; x += 24) rr(ctx, x, y + 3, 13, 1, '#a07c4c');
    }
  } else if (roomId === 'attic') {
    for (let y = 0; y < 48; y += 10) {
      rr(ctx, 0, y, 48, 1, '#2f2925');
      for (let x = 0; x < 48; x += 16) rr(ctx, x + (y % 20 ? 8 : 0), y + 1, 1, 9, '#706257');
    }
    pp(ctx, 11, 11, '#99866a'); pp(ctx, 35, 26, '#837562'); pp(ctx, 19, 39, '#99866a');
  } else if (roomId === 'self_room') {
    for (let y = 0; y < 48; y += 12) for (let x = 0; x < 48; x += 12) {
      rr(ctx, x, y, 11, 11, (x + y) % 24 === 0 ? '#c799a2' : '#8f6873');
      rr(ctx, x + 10, y, 1, 12, '#644a54');
      rr(ctx, x, y + 10, 12, 1, '#644a54');
      pp(ctx, x + 3, y + 3, '#e2bec5');
    }
  } else if (roomId === 'user_room') {
    for (let y = 0; y < 48; y += 12) {
      rr(ctx, 0, y, 48, 1, '#6d7c67');
      for (let x = 0; x < 48; x += 12) {
        rr(ctx, x, y, 1, 12, '#6d7c67');
        rr(ctx, x + 2, y + 2, 8, 8, (x + y) % 24 === 0 ? '#d7d4bd' : '#9dae91');
      }
    }
  } else {
    for (let y = 0; y < 48; y += 12) {
      rr(ctx, 0, y, 48, 1, s.alt);
      for (let x = 0; x < 48; x += 18) {
        rr(ctx, x + (y % 24 ? 9 : 0), y + 1, 17, 10, (x + y) % 36 === 0 ? '#9a9f85' : '#7b887d');
        pp(ctx, x + 4, y + 4, '#c2c89a');
      }
    }
  }

  for (let i = 0; i < 48; i += 7) pp(ctx, (i * 5) % 48, (i * 11) % 48, 'rgba(255,255,255,0.2)');
}

function generatedSurfaceStyle(roomId: MemoryRoom, surface: 'wall' | 'floor', tileSize: number): CSSProperties | null {
  const src = drawSurfaceTile(roomId, surface);
  if (!src) return null;
  const t = Math.max(12, Math.round(tileSize));
  return {
    backgroundColor: surface === 'wall' ? getRoomSurfaceStyle(roomId).wallFace : getRoomSurfaceStyle(roomId).base,
    backgroundImage: `url(${src})`,
    backgroundSize: `${t * 2}px ${t * 2}px`,
    backgroundRepeat: 'repeat',
    imageRendering: 'pixelated' as any,
  };
}

export function wallTextureStyle(roomId: MemoryRoom, tileSize: number): CSSProperties {
  const generated = generatedSurfaceStyle(roomId, 'wall', tileSize);
  if (generated) return generated;

  const s = getRoomSurfaceStyle(roomId);
  const t = Math.max(8, Math.round(tileSize));
  const half = Math.max(4, Math.round(t / 2));
  const small = Math.max(3, Math.round(t / 4));
  const shared: CSSProperties = {
    backgroundColor: s.wallFace,
    imageRendering: 'pixelated' as any,
  };

  if (s.wallPattern === 'diamond') {
    return {
      ...shared,
      backgroundImage: [
        `linear-gradient(45deg, transparent ${half - 1}px, ${s.wallAccent}66 ${half}px, transparent ${half + 1}px)`,
        `linear-gradient(-45deg, transparent ${half - 1}px, ${s.wallFaceDark}66 ${half}px, transparent ${half + 1}px)`,
        `repeating-linear-gradient(0deg, ${s.wallFaceDark}55 0px, ${s.wallFaceDark}55 1px, transparent 1px, transparent ${half}px)`,
      ].join(', '),
      backgroundSize: `${t}px ${t}px, ${t}px ${t}px, ${t}px ${half}px`,
    };
  }

  if (s.wallPattern === 'shelves') {
    return {
      ...shared,
      backgroundImage: [
        `repeating-linear-gradient(0deg, transparent 0px, transparent ${half - 2}px, ${s.wallFaceDark}99 ${half - 2}px, ${s.wallFaceDark}99 ${half}px)`,
        `repeating-linear-gradient(90deg, ${s.wallAccent}80 0px, ${s.wallAccent}80 2px, transparent 2px, transparent ${small + 5}px)`,
        `linear-gradient(180deg, rgba(255,255,255,0.2), transparent 55%)`,
      ].join(', '),
      backgroundSize: `${t}px ${half}px, ${t}px ${half}px, 100% 100%`,
    };
  }

  if (s.wallPattern === 'plaster') {
    return {
      ...shared,
      backgroundImage: [
        `repeating-linear-gradient(0deg, transparent 0px, transparent ${half - 1}px, ${s.wallFaceDark}88 ${half - 1}px, ${s.wallFaceDark}88 ${half}px)`,
        `repeating-linear-gradient(90deg, transparent 0px, transparent ${t + half - 1}px, ${s.wallAccent}66 ${t + half - 1}px, ${s.wallAccent}66 ${t + half}px)`,
        `linear-gradient(135deg, rgba(255,255,255,0.1) 0%, transparent 35%, rgba(0,0,0,0.1) 100%)`,
      ].join(', '),
      backgroundSize: `${t * 2}px ${half}px, ${t * 2}px ${t}px, 100% 100%`,
    };
  }

  if (s.wallPattern === 'stars') {
    return {
      ...shared,
      backgroundImage: [
        `radial-gradient(circle at ${small}px ${small}px, ${s.wallAccent} 0px, ${s.wallAccent} 1px, transparent 2px)`,
        `radial-gradient(circle at ${half + small}px ${half}px, ${s.wallFaceDark} 0px, ${s.wallFaceDark} 1px, transparent 2px)`,
        `repeating-linear-gradient(0deg, ${s.wallFaceDark}55 0px, ${s.wallFaceDark}55 1px, transparent 1px, transparent ${half}px)`,
      ].join(', '),
      backgroundSize: `${t}px ${t}px, ${t}px ${t}px, ${t}px ${half}px`,
    };
  }

  if (s.wallPattern === 'linen') {
    return {
      ...shared,
      backgroundImage: [
        `repeating-linear-gradient(90deg, rgba(255,255,255,0.16) 0px, rgba(255,255,255,0.16) 1px, transparent 1px, transparent ${small}px)`,
        `repeating-linear-gradient(0deg, ${s.wallFaceDark}66 0px, ${s.wallFaceDark}66 1px, transparent 1px, transparent ${small + 2}px)`,
        `linear-gradient(180deg, transparent, rgba(0,0,0,0.08))`,
      ].join(', '),
      backgroundSize: `${small}px ${small}px, ${small + 2}px ${small + 2}px, 100% 100%`,
    };
  }

  if (s.wallPattern === 'glass') {
    return {
      ...shared,
      backgroundImage: [
        `linear-gradient(135deg, rgba(255,255,255,0.36) 0px, rgba(255,255,255,0.36) 2px, transparent 2px, transparent ${half}px)`,
        `repeating-linear-gradient(90deg, ${s.wallFaceDark}88 0px, ${s.wallFaceDark}88 2px, transparent 2px, transparent ${t}px)`,
        `repeating-linear-gradient(0deg, ${s.wallAccent}66 0px, ${s.wallAccent}66 1px, transparent 1px, transparent ${half}px)`,
      ].join(', '),
      backgroundSize: `${t * 2}px ${t}px, ${t}px ${t}px, ${t}px ${half}px`,
    };
  }

  return {
    ...shared,
    backgroundImage: [
      `repeating-linear-gradient(90deg, transparent 0px, transparent ${t - 2}px, ${s.wallFaceDark}88 ${t - 2}px, ${s.wallFaceDark}88 ${t}px)`,
      `repeating-linear-gradient(0deg, transparent 0px, transparent ${half - 1}px, ${s.wallAccent}77 ${half - 1}px, ${s.wallAccent}77 ${half}px)`,
      `radial-gradient(circle at ${small}px ${half}px, ${s.wallAccent}99 0px, ${s.wallAccent}99 1px, transparent 2px)`,
    ].join(', '),
    backgroundSize: `${t}px ${half}px, ${t}px ${half}px, ${t}px ${half}px`,
  };
}

export function floorTextureStyle(roomId: MemoryRoom, tileSize: number): CSSProperties {
  const generated = generatedSurfaceStyle(roomId, 'floor', tileSize);
  if (generated) return generated;

  const s = getRoomSurfaceStyle(roomId);
  const t = Math.max(8, Math.round(tileSize));
  const half = Math.max(4, Math.round(t / 2));
  const shared: CSSProperties = {
    backgroundColor: s.base,
    imageRendering: 'pixelated' as any,
  };

  if (s.pattern === 'wood') {
    return {
      ...shared,
      backgroundImage: [
        `repeating-linear-gradient(90deg, ${s.alt} 0px, ${s.alt} 1px, transparent 1px, transparent ${t}px)`,
        `repeating-linear-gradient(0deg, transparent 0px, transparent ${t - 2}px, ${s.floorAccent}66 ${t - 2}px, ${s.floorAccent}66 ${t}px)`,
        `linear-gradient(90deg, rgba(255,255,255,0.08) 0px, rgba(255,255,255,0.08) ${half}px, transparent ${half}px, transparent ${t}px)`,
      ].join(', '),
      backgroundSize: `${t}px ${t}px, ${t * 2}px ${t}px, ${t * 4}px ${t}px`,
    };
  }

  if (s.pattern === 'tile') {
    return {
      ...shared,
      backgroundImage: [
        `linear-gradient(${s.alt} 1px, transparent 1px)`,
        `linear-gradient(90deg, ${s.alt} 1px, transparent 1px)`,
        `linear-gradient(45deg, transparent 0px, transparent ${half - 1}px, ${s.floorAccent}66 ${half - 1}px, ${s.floorAccent}66 ${half}px, transparent ${half + 1}px)`,
      ].join(', '),
      backgroundSize: `${t}px ${t}px, ${t}px ${t}px, ${t * 2}px ${t * 2}px`,
    };
  }

  return {
    ...shared,
    backgroundImage: [
      `linear-gradient(${s.alt} 1px, transparent 1px)`,
      `linear-gradient(90deg, ${s.alt} 1px, transparent 1px)`,
      `repeating-linear-gradient(90deg, transparent 0px, transparent ${t + half - 2}px, ${s.floorAccent}55 ${t + half - 2}px, ${s.floorAccent}55 ${t + half}px)`,
    ].join(', '),
    backgroundSize: `${t * 2}px ${t}px, ${t * 2}px ${t}px, ${t * 3}px ${t}px`,
  };
}
