/**
 * Pixel Home — 默认家具像素渲染器
 *
 * 所有默认槽位家具都在这里用 Canvas 手绘成 32×32 像素图。
 * 这些图只用于 assetId 为空的默认家具；用户替换过的素材仍优先使用仓库资产。
 */

import type { MemoryRoom } from '../../utils/memoryPalace/types';

const _cache = new Map<string, string>();

const SIZE = 32;
const SCALE = 4;

const PAL = {
  ink: '#2a211c',
  inkSoft: '#46372d',
  shadow: 'rgba(35, 25, 18, 0.24)',
  dust: 'rgba(70, 59, 47, 0.42)',

  wood0: '#4d3323',
  wood1: '#6f472b',
  wood2: '#9b683d',
  wood3: '#c08a55',
  wood4: '#e0b16f',

  brass0: '#8b5e1f',
  brass1: '#d7a33f',
  brass2: '#f3cf71',

  cloth0: '#4e4a63',
  cloth1: '#6b6686',
  cloth2: '#8f88ae',
  cloth3: '#b9adc8',

  teal0: '#345f65',
  teal1: '#4e8585',
  teal2: '#83b8ae',
  teal3: '#b9d6c7',

  rose0: '#7e4b59',
  rose1: '#b16b78',
  rose2: '#d89695',
  rose3: '#f0c4b7',

  cream0: '#bca486',
  cream1: '#dec7a0',
  cream2: '#f3dfb9',
  cream3: '#fff0cf',

  paper0: '#b8ad92',
  paper1: '#e4d7b6',
  paper2: '#fff4d4',

  glass0: '#35506a',
  glass1: '#5f89a5',
  glass2: '#93bdcb',
  glass3: '#d2edf0',

  green0: '#31543d',
  green1: '#4d7a4a',
  green2: '#7fad63',
  green3: '#b7cf81',

  red0: '#70312e',
  red1: '#a8453f',
  red2: '#d66a54',

  blue0: '#3d536f',
  blue1: '#607d9e',
  blue2: '#9ab0c8',

  gray0: '#4b4a46',
  gray1: '#78756d',
  gray2: '#aaa49a',
  gray3: '#d6cec0',

  black: '#171512',
  white: '#fff8e8',
};

/**
 * 获取默认家具像素图的 data URI。
 */
export function defaultFurniturePixelSrc(roomId: MemoryRoom, slotId: string): string {
  const key = `${roomId}:${slotId}`;
  const cached = _cache.get(key);
  if (cached) return cached;

  const small = document.createElement('canvas');
  small.width = SIZE;
  small.height = SIZE;
  const s = small.getContext('2d')!;
  s.imageSmoothingEnabled = false;
  drawDefaultFurniture(s, key);

  const canvas = document.createElement('canvas');
  canvas.width = SIZE * SCALE;
  canvas.height = SIZE * SCALE;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, canvas.width, canvas.height);

  const dataUri = canvas.toDataURL('image/png');
  _cache.set(key, dataUri);
  return dataUri;
}

function r(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function p(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  r(ctx, x, y, 1, 1, color);
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

function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string, outline = PAL.ink) {
  r(ctx, x, y, w, h, outline);
  r(ctx, x + 1, y + 1, w - 2, h - 2, fill);
}

function shadow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h = 2) {
  r(ctx, x, y, w, h, PAL.shadow);
}

function shine(ctx: CanvasRenderingContext2D, x: number, y: number, w: number) {
  r(ctx, x, y, w, 1, 'rgba(255, 246, 210, 0.45)');
}

function woodGrain(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, rows = 2) {
  for (let i = 0; i < rows; i++) {
    const yy = y + i * 3;
    r(ctx, x, yy, Math.max(2, w - i * 3), 1, i % 2 ? PAL.wood0 : PAL.wood3);
  }
}

function stitch(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, color = PAL.cream2) {
  for (let i = 0; i < w; i += 3) p(ctx, x + i, y, color);
}

function tinyFlower(ctx: CanvasRenderingContext2D, x: number, y: number, petal = PAL.rose2) {
  p(ctx, x, y - 1, petal);
  p(ctx, x - 1, y, petal);
  p(ctx, x + 1, y, petal);
  p(ctx, x, y + 1, petal);
  p(ctx, x, y, PAL.brass2);
}

function drawDefaultFurniture(ctx: CanvasRenderingContext2D, key: string) {
  ctx.clearRect(0, 0, SIZE, SIZE);

  switch (key) {
    // ─── 客厅 ─────────────────────────────
    case 'living_room:sofa': {
      shadow(ctx, 5, 27, 22);
      box(ctx, 5, 14, 22, 11, PAL.cloth1);
      r(ctx, 7, 10, 18, 6, PAL.ink);
      r(ctx, 8, 11, 16, 5, PAL.cloth2);
      r(ctx, 3, 16, 4, 9, PAL.ink);
      r(ctx, 4, 17, 3, 7, PAL.cloth0);
      r(ctx, 25, 16, 4, 9, PAL.ink);
      r(ctx, 25, 17, 3, 7, PAL.cloth0);
      r(ctx, 8, 16, 8, 8, PAL.cloth2);
      r(ctx, 16, 16, 8, 8, PAL.cloth1);
      stitch(ctx, 9, 17, 14);
      r(ctx, 9, 23, 3, 3, PAL.wood0);
      r(ctx, 20, 23, 3, 3, PAL.wood0);
      p(ctx, 12, 13, PAL.rose3);
      p(ctx, 20, 12, PAL.teal3);
      break;
    }
    case 'living_room:tv': {
      shadow(ctx, 7, 27, 18);
      box(ctx, 5, 6, 22, 15, PAL.black);
      r(ctx, 7, 8, 18, 11, PAL.glass0);
      r(ctx, 8, 9, 7, 3, PAL.glass2);
      r(ctx, 16, 13, 7, 4, PAL.glass1);
      p(ctx, 24, 7, PAL.red2);
      r(ctx, 15, 21, 2, 4, PAL.gray0);
      r(ctx, 10, 25, 12, 2, PAL.gray1);
      r(ctx, 8, 27, 16, 1, PAL.ink);
      break;
    }
    case 'living_room:coffee_table': {
      shadow(ctx, 6, 25, 20);
      r(ctx, 5, 15, 22, 4, PAL.ink);
      r(ctx, 6, 14, 20, 4, PAL.wood3);
      shine(ctx, 7, 14, 17);
      woodGrain(ctx, 8, 17, 16, 1);
      r(ctx, 8, 19, 3, 7, PAL.wood0);
      r(ctx, 21, 19, 3, 7, PAL.wood0);
      r(ctx, 12, 11, 5, 3, PAL.paper2);
      p(ctx, 14, 12, PAL.red2);
      r(ctx, 18, 10, 4, 4, PAL.teal1);
      r(ctx, 19, 9, 2, 1, PAL.teal3);
      break;
    }
    case 'living_room:rug': {
      shadow(ctx, 4, 25, 24);
      r(ctx, 4, 18, 24, 8, PAL.ink);
      r(ctx, 5, 19, 22, 6, PAL.cream1);
      r(ctx, 7, 20, 18, 4, PAL.rose2);
      r(ctx, 10, 21, 12, 2, PAL.cream2);
      for (let x = 5; x < 28; x += 3) {
        p(ctx, x, 17, PAL.cream3);
        p(ctx, x, 26, PAL.cream3);
      }
      p(ctx, 8, 22, PAL.teal2);
      p(ctx, 23, 22, PAL.teal2);
      break;
    }
    case 'living_room:clock': {
      shadow(ctx, 11, 24, 10);
      box(ctx, 10, 4, 12, 18, PAL.wood2);
      r(ctx, 12, 6, 8, 8, PAL.ink);
      r(ctx, 13, 7, 6, 6, PAL.paper2);
      p(ctx, 16, 8, PAL.ink);
      p(ctx, 16, 12, PAL.ink);
      p(ctx, 14, 10, PAL.ink);
      p(ctx, 18, 10, PAL.ink);
      line(ctx, 16, 10, 16, 8, PAL.red1);
      line(ctx, 16, 10, 18, 11, PAL.red1);
      r(ctx, 14, 15, 4, 5, PAL.brass1);
      p(ctx, 16, 21, PAL.brass2);
      break;
    }

    // ─── 卧室 ─────────────────────────────
    case 'bedroom:bed': {
      shadow(ctx, 4, 27, 24);
      box(ctx, 4, 12, 24, 14, PAL.wood1);
      r(ctx, 6, 9, 20, 6, PAL.ink);
      r(ctx, 7, 10, 8, 4, PAL.cream3);
      r(ctx, 16, 10, 9, 4, PAL.cream2);
      r(ctx, 6, 15, 20, 9, PAL.rose1);
      r(ctx, 8, 16, 16, 3, PAL.rose2);
      stitch(ctx, 8, 20, 16, PAL.cream2);
      r(ctx, 5, 24, 4, 3, PAL.wood0);
      r(ctx, 23, 24, 4, 3, PAL.wood0);
      break;
    }
    case 'bedroom:nightstand': {
      shadow(ctx, 9, 27, 14);
      box(ctx, 9, 11, 14, 15, PAL.wood2);
      r(ctx, 11, 13, 10, 4, PAL.wood1);
      r(ctx, 11, 19, 10, 4, PAL.wood1);
      p(ctx, 16, 15, PAL.brass2);
      p(ctx, 16, 21, PAL.brass2);
      woodGrain(ctx, 11, 12, 9, 3);
      r(ctx, 10, 26, 3, 2, PAL.wood0);
      r(ctx, 19, 26, 3, 2, PAL.wood0);
      r(ctx, 13, 7, 6, 3, PAL.paper2);
      p(ctx, 18, 8, PAL.red2);
      break;
    }
    case 'bedroom:lamp': {
      shadow(ctx, 10, 27, 12);
      r(ctx, 12, 6, 8, 5, PAL.ink);
      r(ctx, 13, 5, 6, 6, PAL.brass2);
      r(ctx, 14, 7, 4, 2, PAL.cream3);
      r(ctx, 15, 11, 2, 11, PAL.gray1);
      r(ctx, 12, 22, 8, 3, PAL.gray0);
      r(ctx, 10, 25, 12, 2, PAL.ink);
      p(ctx, 12, 12, PAL.brass2);
      p(ctx, 20, 12, PAL.brass2);
      p(ctx, 9, 9, PAL.cream3);
      p(ctx, 22, 9, PAL.cream3);
      break;
    }
    case 'bedroom:curtain': {
      shadow(ctx, 5, 27, 22);
      box(ctx, 7, 5, 18, 19, PAL.wood1);
      r(ctx, 9, 7, 14, 15, PAL.glass2);
      r(ctx, 16, 7, 1, 15, PAL.wood0);
      r(ctx, 9, 14, 14, 1, PAL.wood0);
      r(ctx, 4, 4, 6, 22, PAL.ink);
      r(ctx, 5, 5, 4, 20, PAL.cloth1);
      r(ctx, 22, 4, 6, 22, PAL.ink);
      r(ctx, 23, 5, 4, 20, PAL.cloth0);
      for (let y = 7; y < 24; y += 4) {
        p(ctx, 7, y, PAL.cloth3);
        p(ctx, 25, y, PAL.cloth2);
      }
      r(ctx, 4, 3, 24, 2, PAL.wood0);
      break;
    }
    case 'bedroom:frame': {
      shadow(ctx, 9, 25, 14);
      box(ctx, 8, 6, 16, 17, PAL.wood2);
      r(ctx, 10, 8, 12, 13, PAL.paper1);
      r(ctx, 11, 9, 10, 7, PAL.glass3);
      r(ctx, 11, 16, 10, 4, PAL.green2);
      tinyFlower(ctx, 16, 13, PAL.rose2);
      p(ctx, 12, 10, PAL.brass2);
      p(ctx, 20, 10, PAL.brass2);
      break;
    }

    // ─── 书房 ─────────────────────────────
    case 'study:desk': {
      shadow(ctx, 4, 27, 24);
      r(ctx, 4, 14, 24, 5, PAL.ink);
      r(ctx, 5, 13, 22, 5, PAL.wood2);
      shine(ctx, 6, 13, 19);
      woodGrain(ctx, 7, 16, 18, 1);
      r(ctx, 6, 18, 4, 9, PAL.wood0);
      r(ctx, 22, 18, 4, 9, PAL.wood0);
      r(ctx, 12, 9, 9, 4, PAL.paper2);
      p(ctx, 14, 10, PAL.blue1);
      p(ctx, 15, 11, PAL.blue1);
      r(ctx, 22, 10, 3, 3, PAL.teal2);
      break;
    }
    case 'study:bookshelf': {
      shadow(ctx, 6, 28, 20);
      box(ctx, 6, 3, 20, 24, PAL.wood1);
      r(ctx, 8, 6, 16, 2, PAL.wood3);
      r(ctx, 8, 14, 16, 2, PAL.wood3);
      r(ctx, 8, 22, 16, 2, PAL.wood3);
      const books = [PAL.red2, PAL.blue1, PAL.green2, PAL.cream2, PAL.rose2, PAL.teal2];
      for (let i = 0; i < 12; i++) {
        const shelfY = i < 4 ? 8 : i < 8 ? 16 : 24;
        const x = 8 + (i % 4) * 4;
        r(ctx, x, shelfY - 5, 2, 5, books[i % books.length]);
        r(ctx, x + 2, shelfY - 4, 1, 4, PAL.paper0);
      }
      p(ctx, 22, 20, PAL.brass2);
      p(ctx, 23, 19, PAL.green3);
      break;
    }
    case 'study:whiteboard': {
      shadow(ctx, 6, 25, 20);
      box(ctx, 5, 6, 22, 16, PAL.gray1);
      r(ctx, 7, 8, 18, 12, PAL.white);
      r(ctx, 8, 9, 8, 1, PAL.blue1);
      r(ctx, 8, 12, 6, 1, PAL.red2);
      line(ctx, 17, 17, 23, 11, PAL.green1);
      p(ctx, 22, 11, PAL.green1);
      r(ctx, 11, 21, 10, 2, PAL.gray0);
      r(ctx, 18, 19, 5, 1, PAL.red1);
      break;
    }
    case 'study:pen_holder': {
      shadow(ctx, 10, 27, 12);
      box(ctx, 11, 15, 10, 11, PAL.gray1);
      r(ctx, 13, 17, 6, 7, PAL.gray2);
      r(ctx, 12, 14, 8, 2, PAL.gray0);
      line(ctx, 13, 14, 11, 6, PAL.red2);
      line(ctx, 16, 14, 16, 4, PAL.blue1);
      line(ctx, 19, 14, 22, 7, PAL.green2);
      p(ctx, 10, 5, PAL.brass2);
      p(ctx, 16, 3, PAL.paper2);
      p(ctx, 23, 6, PAL.brass2);
      p(ctx, 15, 21, PAL.inkSoft);
      break;
    }
    case 'study:globe': {
      shadow(ctx, 9, 27, 14);
      r(ctx, 12, 5, 9, 9, PAL.ink);
      r(ctx, 13, 6, 7, 7, PAL.glass2);
      r(ctx, 14, 8, 2, 3, PAL.green1);
      r(ctx, 17, 7, 2, 2, PAL.green2);
      p(ctx, 18, 11, PAL.green0);
      line(ctx, 11, 4, 22, 15, PAL.brass1);
      r(ctx, 16, 14, 2, 7, PAL.gray1);
      r(ctx, 11, 21, 10, 3, PAL.wood2);
      r(ctx, 9, 24, 14, 3, PAL.wood0);
      break;
    }

    // ─── 阁楼 ─────────────────────────────
    case 'attic:chest': {
      shadow(ctx, 5, 27, 22);
      box(ctx, 5, 13, 22, 13, PAL.wood1);
      r(ctx, 6, 10, 20, 6, PAL.ink);
      r(ctx, 7, 11, 18, 5, PAL.wood2);
      r(ctx, 5, 17, 22, 2, PAL.wood0);
      r(ctx, 15, 15, 3, 6, PAL.brass1);
      r(ctx, 16, 16, 1, 2, PAL.brass2);
      woodGrain(ctx, 8, 21, 16, 2);
      p(ctx, 9, 12, PAL.dust);
      p(ctx, 23, 22, PAL.dust);
      break;
    }
    case 'attic:cobweb': {
      line(ctx, 3, 3, 16, 16, PAL.gray3);
      line(ctx, 3, 3, 3, 21, PAL.gray2);
      line(ctx, 3, 3, 22, 3, PAL.gray2);
      line(ctx, 3, 21, 22, 3, PAL.gray2);
      r(ctx, 5, 6, 8, 1, PAL.gray2);
      r(ctx, 6, 10, 11, 1, PAL.gray2);
      r(ctx, 8, 14, 8, 1, PAL.gray3);
      p(ctx, 18, 18, PAL.inkSoft);
      p(ctx, 18, 19, PAL.inkSoft);
      line(ctx, 18, 18, 18, 23, PAL.gray2);
      p(ctx, 17, 19, PAL.gray1);
      p(ctx, 19, 19, PAL.gray1);
      break;
    }
    case 'attic:mirror': {
      shadow(ctx, 10, 28, 13);
      box(ctx, 10, 4, 12, 23, PAL.wood0);
      r(ctx, 12, 6, 8, 18, PAL.glass1);
      r(ctx, 13, 7, 6, 16, PAL.glass3);
      line(ctx, 14, 8, 18, 12, PAL.white);
      line(ctx, 13, 17, 17, 21, PAL.glass0);
      p(ctx, 12, 10, PAL.dust);
      p(ctx, 20, 14, PAL.dust);
      p(ctx, 15, 23, PAL.dust);
      r(ctx, 13, 27, 6, 2, PAL.wood0);
      break;
    }
    case 'attic:window': {
      shadow(ctx, 6, 27, 20);
      box(ctx, 6, 4, 20, 14, PAL.wood0);
      r(ctx, 8, 6, 16, 10, PAL.glass1);
      r(ctx, 9, 7, 6, 4, PAL.glass3);
      r(ctx, 17, 11, 6, 4, PAL.glass2);
      r(ctx, 15, 6, 2, 10, PAL.wood0);
      r(ctx, 8, 11, 16, 2, PAL.wood0);
      line(ctx, 10, 19, 5, 27, PAL.brass2);
      line(ctx, 16, 19, 16, 28, PAL.brass1);
      line(ctx, 22, 19, 28, 27, PAL.brass2);
      p(ctx, 23, 7, PAL.white);
      break;
    }
    case 'attic:music_box': {
      shadow(ctx, 8, 27, 16);
      box(ctx, 8, 15, 16, 10, PAL.wood1);
      r(ctx, 9, 13, 14, 4, PAL.wood3);
      woodGrain(ctx, 10, 19, 12, 1);
      r(ctx, 15, 10, 2, 5, PAL.brass1);
      p(ctx, 16, 9, PAL.brass2);
      p(ctx, 17, 8, PAL.brass2);
      tinyFlower(ctx, 12, 18, PAL.rose2);
      r(ctx, 18, 17, 3, 3, PAL.brass1);
      p(ctx, 19, 18, PAL.brass2);
      break;
    }

    // ─── 个人房间 ─────────────────────────
    case 'self_room:vanity': {
      shadow(ctx, 6, 28, 20);
      box(ctx, 7, 13, 18, 13, PAL.wood2);
      box(ctx, 10, 3, 12, 12, PAL.wood0);
      r(ctx, 12, 5, 8, 8, PAL.glass2);
      line(ctx, 13, 6, 18, 11, PAL.white);
      r(ctx, 9, 16, 6, 5, PAL.wood1);
      r(ctx, 17, 16, 6, 5, PAL.wood1);
      p(ctx, 12, 18, PAL.brass2);
      p(ctx, 20, 18, PAL.brass2);
      r(ctx, 13, 10, 6, 2, PAL.rose3);
      p(ctx, 25, 15, PAL.red2);
      break;
    }
    case 'self_room:diary': {
      shadow(ctx, 10, 27, 12);
      r(ctx, 10, 7, 13, 18, PAL.ink);
      r(ctx, 11, 8, 11, 16, PAL.cloth1);
      r(ctx, 13, 9, 8, 14, PAL.paper1);
      r(ctx, 11, 8, 2, 16, PAL.cloth0);
      r(ctx, 15, 13, 5, 1, PAL.inkSoft);
      r(ctx, 15, 16, 4, 1, PAL.inkSoft);
      r(ctx, 15, 19, 5, 1, PAL.inkSoft);
      p(ctx, 12, 11, PAL.brass2);
      p(ctx, 20, 22, PAL.rose2);
      break;
    }
    case 'self_room:trophy': {
      shadow(ctx, 9, 28, 14);
      r(ctx, 12, 6, 8, 7, PAL.ink);
      r(ctx, 13, 5, 6, 8, PAL.brass1);
      r(ctx, 14, 6, 4, 4, PAL.brass2);
      line(ctx, 12, 8, 8, 12, PAL.brass1);
      line(ctx, 19, 8, 23, 12, PAL.brass1);
      p(ctx, 8, 13, PAL.brass2);
      p(ctx, 23, 13, PAL.brass2);
      r(ctx, 15, 13, 2, 8, PAL.brass1);
      r(ctx, 11, 21, 10, 4, PAL.wood1);
      r(ctx, 9, 25, 14, 3, PAL.wood0);
      shine(ctx, 13, 22, 6);
      break;
    }
    case 'self_room:poster': {
      shadow(ctx, 7, 26, 18);
      box(ctx, 7, 5, 18, 20, PAL.paper1);
      r(ctx, 9, 7, 14, 16, PAL.cream2);
      r(ctx, 10, 9, 12, 6, PAL.rose1);
      r(ctx, 11, 16, 10, 2, PAL.teal1);
      r(ctx, 12, 19, 8, 1, PAL.inkSoft);
      p(ctx, 12, 11, PAL.cream3);
      p(ctx, 19, 10, PAL.brass2);
      p(ctx, 8, 6, PAL.gray1);
      p(ctx, 24, 6, PAL.gray1);
      break;
    }
    case 'self_room:pet_bed': {
      shadow(ctx, 6, 27, 20);
      r(ctx, 6, 18, 20, 8, PAL.ink);
      r(ctx, 7, 17, 18, 8, PAL.teal0);
      r(ctx, 9, 19, 14, 5, PAL.teal2);
      r(ctx, 11, 20, 10, 3, PAL.cream2);
      r(ctx, 7, 15, 18, 4, PAL.teal1);
      stitch(ctx, 10, 18, 12, PAL.cream3);
      p(ctx, 14, 21, PAL.rose2);
      p(ctx, 17, 21, PAL.rose2);
      break;
    }

    // ─── 用户房 ──────────────────────────
    case 'user_room:guest_bed': {
      shadow(ctx, 4, 27, 24);
      box(ctx, 4, 12, 24, 14, PAL.wood1);
      r(ctx, 6, 10, 20, 5, PAL.paper2);
      r(ctx, 7, 11, 8, 3, PAL.white);
      r(ctx, 16, 11, 9, 3, PAL.cream3);
      r(ctx, 6, 15, 20, 9, PAL.teal1);
      r(ctx, 8, 16, 16, 3, PAL.teal2);
      stitch(ctx, 8, 21, 16, PAL.cream2);
      r(ctx, 5, 24, 4, 3, PAL.wood0);
      r(ctx, 23, 24, 4, 3, PAL.wood0);
      break;
    }
    case 'user_room:photo_wall': {
      shadow(ctx, 5, 27, 22);
      box(ctx, 4, 5, 9, 8, PAL.wood1);
      r(ctx, 6, 7, 5, 4, PAL.glass2);
      box(ctx, 17, 4, 10, 10, PAL.wood2);
      r(ctx, 19, 6, 6, 6, PAL.rose2);
      box(ctx, 8, 17, 11, 9, PAL.wood0);
      r(ctx, 10, 19, 7, 5, PAL.cream2);
      p(ctx, 8, 6, PAL.brass2);
      p(ctx, 22, 5, PAL.brass2);
      p(ctx, 13, 18, PAL.brass2);
      line(ctx, 6, 16, 24, 16, PAL.gray1);
      break;
    }
    case 'user_room:gift_shelf': {
      shadow(ctx, 6, 28, 20);
      box(ctx, 6, 5, 20, 22, PAL.wood1);
      r(ctx, 8, 12, 16, 2, PAL.wood3);
      r(ctx, 8, 20, 16, 2, PAL.wood3);
      box(ctx, 9, 8, 5, 4, PAL.red1);
      r(ctx, 11, 7, 1, 6, PAL.brass2);
      box(ctx, 17, 9, 5, 3, PAL.teal1);
      r(ctx, 19, 8, 1, 5, PAL.cream2);
      r(ctx, 10, 16, 4, 4, PAL.rose2);
      r(ctx, 17, 16, 5, 4, PAL.green2);
      p(ctx, 22, 24, PAL.brass2);
      break;
    }
    case 'user_room:letter_box': {
      shadow(ctx, 8, 27, 16);
      box(ctx, 9, 12, 14, 13, PAL.wood2);
      r(ctx, 11, 14, 10, 5, PAL.paper2);
      line(ctx, 11, 14, 16, 18, PAL.paper0);
      line(ctx, 21, 14, 16, 18, PAL.paper0);
      r(ctx, 12, 21, 8, 2, PAL.wood0);
      r(ctx, 22, 9, 2, 9, PAL.gray1);
      r(ctx, 23, 8, 5, 4, PAL.red1);
      p(ctx, 16, 18, PAL.rose2);
      break;
    }
    case 'user_room:welcome_mat': {
      shadow(ctx, 4, 27, 24);
      r(ctx, 5, 19, 22, 7, PAL.ink);
      r(ctx, 6, 20, 20, 5, PAL.teal1);
      r(ctx, 8, 21, 16, 3, PAL.teal2);
      stitch(ctx, 7, 19, 18, PAL.cream2);
      stitch(ctx, 7, 25, 18, PAL.cream2);
      p(ctx, 11, 22, PAL.cream3);
      p(ctx, 13, 22, PAL.cream3);
      p(ctx, 16, 22, PAL.cream3);
      p(ctx, 19, 22, PAL.cream3);
      p(ctx, 21, 22, PAL.cream3);
      break;
    }

    // ─── 窗台/露台 ────────────────────────
    case 'windowsill:flower_pot': {
      shadow(ctx, 9, 28, 14);
      r(ctx, 11, 19, 10, 8, PAL.ink);
      r(ctx, 12, 18, 8, 8, PAL.wood2);
      r(ctx, 10, 16, 12, 3, PAL.wood3);
      line(ctx, 16, 17, 16, 8, PAL.green1);
      line(ctx, 15, 14, 10, 10, PAL.green2);
      line(ctx, 17, 13, 23, 9, PAL.green2);
      tinyFlower(ctx, 16, 7, PAL.rose2);
      tinyFlower(ctx, 10, 10, PAL.cream3);
      tinyFlower(ctx, 23, 9, PAL.red2);
      p(ctx, 15, 22, PAL.wood0);
      break;
    }
    case 'windowsill:wind_chime': {
      r(ctx, 9, 5, 14, 2, PAL.gray1);
      p(ctx, 16, 3, PAL.gray3);
      line(ctx, 11, 7, 11, 18, PAL.gray2);
      line(ctx, 16, 7, 16, 21, PAL.gray2);
      line(ctx, 21, 7, 21, 17, PAL.gray2);
      r(ctx, 10, 18, 3, 6, PAL.teal2);
      r(ctx, 15, 21, 3, 6, PAL.glass2);
      r(ctx, 20, 17, 3, 6, PAL.rose2);
      p(ctx, 11, 25, PAL.brass2);
      p(ctx, 16, 28, PAL.brass2);
      p(ctx, 21, 24, PAL.brass2);
      p(ctx, 8, 12, PAL.cream3);
      p(ctx, 24, 13, PAL.cream3);
      break;
    }
    case 'windowsill:telescope': {
      shadow(ctx, 8, 28, 16);
      line(ctx, 16, 15, 9, 27, PAL.wood0);
      line(ctx, 17, 15, 23, 27, PAL.wood0);
      line(ctx, 16, 16, 16, 27, PAL.wood0);
      r(ctx, 9, 10, 15, 5, PAL.ink);
      r(ctx, 10, 9, 13, 5, PAL.gray1);
      r(ctx, 21, 8, 5, 5, PAL.glass1);
      r(ctx, 23, 9, 2, 2, PAL.glass3);
      r(ctx, 7, 11, 4, 4, PAL.gray0);
      r(ctx, 14, 15, 5, 3, PAL.brass1);
      p(ctx, 15, 19, PAL.brass2);
      break;
    }
    case 'windowsill:seed_box': {
      shadow(ctx, 6, 28, 20);
      box(ctx, 6, 16, 20, 10, PAL.wood1);
      r(ctx, 7, 14, 18, 4, PAL.wood3);
      woodGrain(ctx, 8, 20, 16, 1);
      r(ctx, 10, 11, 3, 4, PAL.green2);
      r(ctx, 16, 10, 4, 5, PAL.green1);
      r(ctx, 21, 12, 2, 3, PAL.green3);
      p(ctx, 11, 9, PAL.green3);
      p(ctx, 18, 8, PAL.green2);
      p(ctx, 22, 10, PAL.brass2);
      r(ctx, 9, 23, 14, 1, PAL.wood0);
      break;
    }
    case 'windowsill:lantern': {
      shadow(ctx, 10, 28, 12);
      line(ctx, 15, 4, 12, 8, PAL.gray2);
      line(ctx, 16, 4, 20, 8, PAL.gray2);
      r(ctx, 12, 8, 8, 3, PAL.gray0);
      box(ctx, 10, 11, 12, 14, PAL.red1);
      r(ctx, 12, 13, 8, 10, PAL.brass1);
      r(ctx, 14, 15, 4, 6, PAL.brass2);
      r(ctx, 11, 25, 10, 2, PAL.gray0);
      p(ctx, 9, 17, PAL.brass2);
      p(ctx, 22, 17, PAL.brass2);
      break;
    }

    default: {
      shadow(ctx, 8, 26, 16);
      box(ctx, 9, 9, 14, 14, PAL.gray1);
      r(ctx, 11, 11, 10, 10, PAL.gray2);
      p(ctx, 14, 14, PAL.paper2);
      p(ctx, 17, 17, PAL.paper2);
      break;
    }
  }
}

/** 生成房间缩略图（供俯瞰地图使用） */
export function generateRoomPixelThumbnail(_roomId: MemoryRoom): string {
  return '';
}
