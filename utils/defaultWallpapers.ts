export const DEFAULT_DESKTOP_WALLPAPER = '/wallpapers/moro-default-desktop.jpg';
export const DEFAULT_LOCK_SCREEN_WALLPAPER = '/wallpapers/moro-default-lock.jpg';

export const PAPER_DEFAULT_WALLPAPER = 'linear-gradient(180deg, #fbfaf7 0%, #f5f3ee 55%, #efede6 100%)';

export const isImageWallpaper = (wallpaper?: string): boolean => {
  const value = wallpaper?.trim() || '';
  return /^(https?:|data:|blob:|\/)/.test(value);
};

export const toWallpaperBackground = (wallpaper?: string, fallback = '#eef0f6'): string => {
  const value = wallpaper?.trim() || '';
  if (!value) return fallback;
  return isImageWallpaper(value) ? `url(${value})` : value;
};
