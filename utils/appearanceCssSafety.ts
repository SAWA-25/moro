import { AppID, OSTheme } from '../types';

export type AppearanceCssWarningSeverity = 'info' | 'warning' | 'danger';

export interface AppearanceCssWarning {
  id: string;
  severity: AppearanceCssWarningSeverity;
  title: string;
  message: string;
  selector?: string;
  match?: string;
  source?: string;
}

export interface AppearanceCssScanOptions {
  source?: string;
  protectedSelectors?: string[];
  zIndexDangerThreshold?: number;
}

const DEFAULT_PROTECTED_SELECTORS = [
  '.moro-dock',
  '.moro-dock-icon',
  '.moro-palette-btn',
  '.moro-chat-back',
  '.moro-floating-quick-menu',
  '.moro-floating-quick-menu-button',
  '.moro-lock-passcode',
  '.moro-lock-passcode-panel',
  '.moro-lock-passcode-key',
  '.moro-lock-passcode-cancel',
];

const GLOBAL_SELECTOR_RE = /(^|,)\s*(\*|html|body|:root)\s*($|,|[{.#[:>\s])/i;

const stripCssComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

const splitRules = (css: string): Array<{ selector: string; body: string }> => {
  const rules: Array<{ selector: string; body: string }> = [];
  const clean = stripCssComments(css);
  const ruleRe = /([^{}@][^{}]*)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = ruleRe.exec(clean))) {
    const selector = match[1].trim();
    const body = match[2].trim();
    if (selector && body) rules.push({ selector, body });
  }
  return rules;
};

const selectorTouchesProtected = (selector: string, protectedSelectors: string[]): boolean =>
  protectedSelectors.some(protectedSelector => selector.includes(protectedSelector));

const pushWarning = (
  warnings: AppearanceCssWarning[],
  warning: Omit<AppearanceCssWarning, 'id'>,
) => {
  warnings.push({
    ...warning,
    id: `${warning.source || 'css'}-${warnings.length}-${warning.title}`,
  });
};

export const scanAppearanceCss = (
  css: string | undefined,
  options: AppearanceCssScanOptions = {},
): AppearanceCssWarning[] => {
  if (!css?.trim()) return [];
  const warnings: AppearanceCssWarning[] = [];
  const protectedSelectors = options.protectedSelectors || DEFAULT_PROTECTED_SELECTORS;
  const zIndexDangerThreshold = options.zIndexDangerThreshold ?? 100;

  for (const rule of splitRules(css)) {
    const selector = rule.selector;
    const body = rule.body;
    const source = options.source;
    const touchesProtected = selectorTouchesProtected(selector, protectedSelectors);

    if (GLOBAL_SELECTOR_RE.test(selector)) {
      pushWarning(warnings, {
        severity: 'warning',
        title: '全局选择器',
        message: '这条规则可能影响整台手机；建议改成 .moro-* 或 [data-moro-app="..."] 范围。',
        selector,
        match: selector,
        source,
      });
    }

    if (/display\s*:\s*none\b/i.test(body)) {
      pushWarning(warnings, {
        severity: touchesProtected ? 'danger' : 'warning',
        title: '隐藏元素',
        message: touchesProtected
          ? '这条规则可能隐藏返回、Dock、拼贴册入口或解锁按钮，需要优先移除。'
          : 'display:none 会让目标区域完全消失；确认不是误伤按钮、入口或输入框。',
        selector,
        match: 'display:none',
        source,
      });
    }

    if (/pointer-events\s*:\s*none\b/i.test(body)) {
      pushWarning(warnings, {
        severity: touchesProtected ? 'danger' : 'warning',
        title: '禁用点击',
        message: touchesProtected
          ? '这条规则可能让救援入口或解锁界面点不到。'
          : 'pointer-events:none 会让区域无法点击；只建议用于纯装饰层。',
        selector,
        match: 'pointer-events:none',
        source,
      });
    }

    if (/position\s*:\s*fixed\b/i.test(body)) {
      pushWarning(warnings, {
        severity: 'warning',
        title: '固定定位',
        message: 'fixed 元素容易盖住整屏；请确认 z-index、尺寸和 pointer-events 都安全。',
        selector,
        match: 'position:fixed',
        source,
      });
    }

    const zIndexMatches = Array.from(body.matchAll(/z-index\s*:\s*(-?\d+)/gi));
    for (const z of zIndexMatches) {
      const value = Number(z[1]);
      if (value > zIndexDangerThreshold) {
        pushWarning(warnings, {
          severity: value > 999 ? 'danger' : 'warning',
          title: '层级过高',
          message: `z-index:${value} 可能盖住弹窗、Dock 或锁屏；建议控制在 ${zIndexDangerThreshold} 以下。`,
          selector,
          match: z[0],
          source,
        });
      }
    }
  }

  return warnings;
};

export const collectAppearanceCssWarnings = (theme: OSTheme): AppearanceCssWarning[] => {
  const warnings: AppearanceCssWarning[] = [];
  warnings.push(...scanAppearanceCss(theme.globalCustomCss, { source: '整机手写码' }));
  warnings.push(...scanAppearanceCss(theme.chatChromeCustomCss, { source: '聊天白框' }));
  Object.entries(theme.appCustomCss || {}).forEach(([id, css]) => {
    warnings.push(...scanAppearanceCss(css, { source: `App 分区：${id}` }));
  });
  Object.entries(theme.desktopWidgetPrefs || {}).forEach(([id, pref]) => {
    warnings.push(...scanAppearanceCss(pref.customCss, { source: `桌面零件：${id}` }));
  });
  warnings.push(...scanAppearanceCss(theme.dynamicIslandStyle?.customCss, { source: '灵动岛' }));
  warnings.push(...scanAppearanceCss(theme.lockScreenStyle?.customCss, { source: '锁屏' }));
  warnings.push(...scanAppearanceCss(theme.floatingQuickMenuStyle?.customCss, { source: '悬浮窗' }));
  warnings.push(...scanAppearanceCss(theme.offlineModeStyle?.customCss, { source: '线下弹窗' }));
  return warnings;
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const managedCssBlockMarkers = (blockId: string) => ({
  start: `/* MORO_APPEARANCE_PACK:${blockId}:START */`,
  end: `/* MORO_APPEARANCE_PACK:${blockId}:END */`,
});

export const replaceManagedCssBlock = (
  css: string | undefined,
  blockId: string,
  nextCss: string,
): string => {
  const current = css || '';
  const markers = managedCssBlockMarkers(blockId);
  const block = `${markers.start}\n${nextCss.trim()}\n${markers.end}`;
  const re = new RegExp(`${escapeRegExp(markers.start)}[\\s\\S]*?${escapeRegExp(markers.end)}`, 'm');
  if (re.test(current)) return current.replace(re, block).trim();
  return [current.trim(), block].filter(Boolean).join('\n\n');
};

export const removeManagedCssBlock = (css: string | undefined, blockId: string): string => {
  const current = css || '';
  const markers = managedCssBlockMarkers(blockId);
  const re = new RegExp(`\\n?${escapeRegExp(markers.start)}[\\s\\S]*?${escapeRegExp(markers.end)}\\n?`, 'm');
  return current.replace(re, '\n').replace(/\n{3,}/g, '\n\n').trim();
};

export const stripCustomCssFromWidgetPrefs = (
  prefs: OSTheme['desktopWidgetPrefs'],
): OSTheme['desktopWidgetPrefs'] => {
  if (!prefs) return undefined;
  const next: NonNullable<OSTheme['desktopWidgetPrefs']> = {};
  Object.entries(prefs).forEach(([id, pref]) => {
    const cleaned = { ...pref };
    delete cleaned.customCss;
    if (Object.keys(cleaned).length) next[id] = cleaned;
  });
  return Object.keys(next).length ? next : undefined;
};

export const stripAppCustomCss = (
  appCustomCss: OSTheme['appCustomCss'],
  appId?: AppID,
): OSTheme['appCustomCss'] => {
  if (!appCustomCss) return undefined;
  if (!appId) return undefined;
  const next = { ...appCustomCss };
  delete next[appId];
  return Object.keys(next).length ? next : undefined;
};
