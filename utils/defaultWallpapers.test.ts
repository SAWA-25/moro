import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  DEFAULT_DESKTOP_WALLPAPER,
  DEFAULT_LOCK_SCREEN_WALLPAPER,
  isImageWallpaper,
  toWallpaperBackground,
} from './defaultWallpapers';

describe('default wallpapers', () => {
  test('uses the bundled desktop and lock screen images', () => {
    expect(DEFAULT_DESKTOP_WALLPAPER).toBe('/wallpapers/moro-default-desktop.jpg');
    expect(DEFAULT_LOCK_SCREEN_WALLPAPER).toBe('/wallpapers/moro-default-lock.jpg');

    expect(existsSync(join(process.cwd(), 'public', DEFAULT_DESKTOP_WALLPAPER))).toBe(true);
    expect(existsSync(join(process.cwd(), 'public', DEFAULT_LOCK_SCREEN_WALLPAPER))).toBe(true);
  });

  test('treats bundled public paths as image wallpapers', () => {
    expect(isImageWallpaper('/wallpapers/moro-default-desktop.jpg')).toBe(true);
    expect(isImageWallpaper('linear-gradient(180deg, #fff, #eee)')).toBe(false);
    expect(toWallpaperBackground('/wallpapers/moro-default-lock.jpg')).toBe('url(/wallpapers/moro-default-lock.jpg)');
    expect(toWallpaperBackground('linear-gradient(180deg, #fff, #eee)')).toBe('linear-gradient(180deg, #fff, #eee)');
  });
});
