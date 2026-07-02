import { AppID, OSTheme } from '../../types';
import { AppearanceCssWarning } from '../../utils/appearanceCssSafety';

export type AppearanceTabId =
  | 'overview'
  | 'packs'
  | 'materials'
  | 'rescue'
  | 'theme'
  | 'desktop'
  | 'chat'
  | 'apps'
  | 'css'
  | 'icons'
  | 'tarot'
  | 'presets';

export interface AppearanceThemePack {
  id: string;
  name: string;
  tagline: string;
  description: string;
  palette: string[];
  theme: Partial<OSTheme>;
  globalCss: string;
  chatChromeCss?: string;
  appCss?: Partial<Record<AppID, string>>;
  widgetCss?: Record<string, string>;
}

export type AppearanceCssWarningGroup = {
  source: string;
  warnings: AppearanceCssWarning[];
};
