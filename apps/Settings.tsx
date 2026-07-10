/**
 * 文具盒 —— 系统设置入口。
 * 统一管理基础设置、备份恢复、主/副 API、实时数据源与通知推送。
 */
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useOS } from '../context/OSContext';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { NotionManager, FeishuManager, RealtimeContextManager } from '../utils/realtimeContext';
import { XhsMcpClient } from '../utils/xhsMcpClient';
import { getMcdToken, setMcdToken as saveMcdToken, isMcdEnabled, setMcdEnabled as saveMcdEnabled, testMcdConnection, resetMcdSession } from '../utils/mcdMcpClient';
import { Sun, Newspaper, NotePencil, Notebook, Book, ForkKnife, X } from '@phosphor-icons/react';
import { loadPushConfig, savePushConfig, registerScheduleOnWorker, startHeartbeat, stopHeartbeat, isPushConfigAvailable, ensureSubscribed, sendTestPush, getPushDiagnostics, resetSubscription, deepResetSubscription, type PushDiagnostics } from '../utils/proactivePushConfig';
import { ProactiveChat } from '../utils/proactiveChat';
import { InstantPushSettingsModal } from '../components/settings/InstantPushSettingsModal';
import { isBackgroundReplyNotifyEnabled, setBackgroundReplyNotify } from '../utils/backgroundReply';
import { getNotifyPermission, isNativeNotificationRuntime, requestNotifyPermission, type NotifyPermission } from '../utils/browserNotify';
import { PushVapidSettingsModal } from '../components/settings/PushVapidSettingsModal';
import VersionInfo from '../components/settings/VersionInfo';
import { isPushVapidReady } from '../utils/pushVapid';
import ApiCallLogModal from '../components/settings/ApiCallLogModal';
import { PresetRuntime } from '../utils/presets';
import { DB } from '../utils/db';
import { AppID } from '../types';
import { getLockPasscode, setLockPasscode, isLockPasscodeEnabled, setLockPasscodeEnabled, DEFAULT_LOCK_PASSCODE } from '../utils/lockScreenSettings';
import {
    isAuxContextBudgetEnabled,
    isMainContextBudgetEnabled,
    setAuxContextBudgetEnabled,
    setMainContextBudgetEnabled,
} from '../utils/contextBudget';
import {
    checkConfiguredAppUpdate,
    downloadAndInstallApk,
    getNativeAppInfo,
    openInstallerPermissionSettings,
    type AppUpdateCheckResult,
    type ApkDownloadProgress,
    type NativeAppInfo,
} from '../utils/appUpdates';
import { queueManualDeepLink, scrollToManualAnchor, useManualDeepLink } from '../utils/manualDeepLink';
import { makeApiUsageMeta } from '../utils/apiUsageCatalog';
import { fetchModelList, testChatConnection } from '../utils/llmClient';
import { isMainApiStreamEnabled } from '../utils/apiConfigDefaults';
import type { ApiErrorHelp } from '../utils/apiErrorHelp';

// hot_news（orz.ai）可选热榜平台。key 必须与 API 的 ?platform= 完全一致。
const HOTNEWS_PLATFORM_OPTIONS: { key: string; label: string }[] = [
    { key: 'weibo', label: '微博' },
    { key: 'zhihu', label: '知乎' },
    { key: 'baidu', label: '百度' },
    { key: 'bilibili', label: 'B站' },
    { key: 'douyin', label: '抖音' },
    { key: 'jinritoutiao', label: '今日头条' },
    { key: 'tieba', label: '贴吧' },
    { key: 'hupu', label: '虎扑' },
    { key: 'douban', label: '豆瓣' },
    { key: 'tskr', label: '36氪' },
    { key: 'juejin', label: '掘金' },
    { key: 'sspai', label: '少数派' },
    { key: 'vtex', label: 'V2EX' },
    { key: 'github', label: 'GitHub' },
    { key: 'hackernews', label: 'Hacker News' },
    { key: 'sina_finance', label: '新浪财经' },
    { key: 'eastmoney', label: '东方财富' },
    { key: 'xueqiu', label: '雪球' },
    { key: 'cls', label: '财联社' },
    { key: 'tenxunwang', label: '腾讯网' },
];

// 「主动消息 Push 加速」面板入口开关。底层逻辑（心跳、订阅、诊断）全部保留，
// 这里设为 false 只是把设置页里的入口隐藏掉，想恢复改回 true 即可。
const SHOW_PROACTIVE_PUSH_ACCEL_UI = false;

// ── 文具盒 / 轻拍立得设计 token：浅米纸、石墨字、雾蓝点缀 ─────────
const INK = '#2f3437';
const INK_SOFT = '#8a918d';
const ROSE = '#7fa8b3';
const ROSE_DARK = '#577782';
const PAPER = '#fffdf8';
const LINE = '#e7e1d6';
const CARD_BORDER = '#eee9df';
const CARD_SHADOW = '0 1px 2px rgba(31,35,38,0.04), 0 18px 42px -34px rgba(31,35,38,0.36)';
const AUX_MODELS_STORAGE_KEY = 'os_aux_available_models';
/** 轻量按钮：白色照片纸底 + 极淡边线 */
const STICKER = 'border border-[#e7e1d6] rounded-full bg-white/90 text-[#577782] shadow-[0_1px_2px_rgba(31,35,38,0.05)] press-soft';
/** 主按钮：低饱和雾蓝胶囊 */
const INK_BTN = 'bg-[#7fa8b3] text-white border border-[#d8e5e7] rounded-full shadow-[0_10px_18px_-16px_rgba(31,35,38,0.42)] press-soft';
/** 柔和旁注字体 */
const HAND_CN: React.CSSProperties = { fontFamily: "'LXGW WenKai', 'ZCOOL XiaoWei', 'Noto Serif SC', serif" };
/** 页面底纹：极浅纸底 + 一点雾蓝光斑，保留空气感。 */
const DOT_BG: React.CSSProperties = {
    background:
        'radial-gradient(circle at 12% 0%, rgba(196,185,160,0.16), transparent 32%), radial-gradient(circle at 92% 14%, rgba(127,168,179,0.14), transparent 30%), linear-gradient(180deg, #f6f6f2 0%, #fbfaf6 52%, #f5f3ed 100%)',
};
/** 输入框：白纸底 + 轻边线 */
const FIELD = 'w-full px-3 py-2 bg-white border border-[#e7e1d6] rounded-[14px] text-sm text-[#2f3437] caret-[#7fa8b3] focus:outline-none focus:border-[#9dbbc2] focus:shadow-[0_8px_18px_-18px_rgba(31,35,38,0.28)] transition-all placeholder:text-[#aab0ac]';
/** 小标签（字段名） */
const LABEL = 'label-mono text-[9px] text-[#8a918d] block mb-1';

const POLAROID_SCOPE_CSS = `
.settings-polaroid {
  max-width: 100%;
  overflow: hidden;
  overflow-x: clip;
  overscroll-behavior: contain;
  overscroll-behavior-x: none;
  touch-action: pan-y;
  -webkit-text-size-adjust: 100%;
}
.settings-polaroid * {
  max-width: 100%;
  -webkit-tap-highlight-color: transparent;
}
.settings-polaroid-scroll {
  overflow-x: hidden;
  overscroll-behavior-x: none;
  touch-action: pan-y;
}
.settings-polaroid button,
.settings-polaroid [role="button"],
.settings-polaroid .select-none {
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  user-select: none;
}
.settings-polaroid [class*="text-[#26242a]"], .settings-polaroid [class*="text-[#5a3140]"] { color: #2f3437 !important; }
.settings-polaroid [class*="text-[#26242a]/"], .settings-polaroid [class*="text-[#8f6b7b]"] { color: #69716d !important; }
.settings-polaroid [class*="text-[#a892a3]"] { color: #8a918d !important; }
.settings-polaroid [class*="text-[#9c5e74]"] { color: #577782 !important; }
.settings-polaroid [class*="bg-[#1c1b1a]"], .settings-polaroid [class*="bg-[#d8a5b7]"] { background-color: #7fa8b3 !important; }
.settings-polaroid [class*="bg-[#1c1b1a]/"], .settings-polaroid [class*="bg-[#d8a5b7]/"] { background-color: rgba(127,168,179,0.10) !important; }
.settings-polaroid [class*="bg-[#fff4f7]"] { background-color: #f3f7f6 !important; }
.settings-polaroid [class*="bg-[#fffdfa]"] { background-color: #fffdf8 !important; }
.settings-polaroid [class*="border-[#1c1b1a]"], .settings-polaroid [class*="border-[#eed6df]"] { border-color: #e7e1d6 !important; }
.settings-polaroid [class*="border-[#1c1b1a]/"], .settings-polaroid [class*="border-[#eed6df]/"] { border-color: rgba(231,225,214,0.9) !important; }
.settings-polaroid [class*="decoration-[#1c1b1a]"], .settings-polaroid [class*="decoration-[#d8a5b7]"] { text-decoration-color: rgba(127,168,179,0.85) !important; }
.settings-polaroid .border-black\\/10 { border-color: #eee9df !important; }
.settings-polaroid .border-dashed { border-style: solid !important; }
.settings-polaroid .border-2 { border-width: 1px !important; }
.settings-polaroid code { background-color: #f3f7f6 !important; color: #577782 !important; border-radius: 7px; }
.settings-polaroid input,
.settings-polaroid textarea,
.settings-polaroid select {
  max-width: 100%;
  min-width: 0;
  -webkit-user-select: text;
  user-select: text;
  touch-action: manipulation;
}
.settings-polaroid input:not([type="checkbox"]):not([type="range"]):not([type="file"]),
.settings-polaroid textarea,
.settings-polaroid select {
  /* iOS/WebView pans the visual viewport when focused inputs render below 16px. */
  font-size: 16px;
  line-height: 1.35;
}
.settings-polaroid input[type="range"] { accent-color: #7fa8b3; }
`;

/** 一截半透明拍立得胶带 */
const Tape: React.FC<{ className?: string }> = ({ className }) => (
    <div
        aria-hidden
        className={`pointer-events-none absolute h-3 w-16 rounded-full bg-white/55 border border-[#eee9df]/80 shadow-[0_1px_2px_rgba(31,35,38,0.04)] backdrop-blur-[1px] ${className || ''}`}
    />
);

/** 拍立得弹层：白色相纸 + 柔和玫瑰描边 */
const PaperSheet: React.FC<{
    open: boolean;
    tag: string;
    title: string;
    onClose: () => void;
    children: React.ReactNode;
    footer?: React.ReactNode;
}> = ({ open, tag, title, onClose, children, footer }) => {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-5 animate-fade-in">
            <div className="absolute inset-0 bg-[#2f3437]/28 backdrop-blur-[2px]" onClick={onClose} />
            <div
                className="relative w-full max-w-sm bg-white border border-[#e7e1d6] rounded-[22px] shadow-[0_1px_2px_rgba(31,35,38,0.04),0_18px_42px_-30px_rgba(31,35,38,0.30)] animate-slide-up overflow-hidden"
                style={{ background: `linear-gradient(180deg, #ffffff 0%, ${PAPER} 100%)` }}
            >
                <Tape className="-top-2 left-1/2 -translate-x-1/2" />
                <button
                    onClick={onClose}
                    className={`absolute top-3 right-3 w-8 h-8 flex items-center justify-center ${STICKER}`}
                    aria-label="关闭"
                >
                    <X size={14} weight="bold" color={INK} />
                </button>
                <div className="px-5 pt-6 pb-2">
                    <div className="label-mono text-[9px] text-[#8a918d]">{tag}</div>
                    <h3 className="text-lg font-black text-[#2f3437] tracking-wide mt-0.5">{title}</h3>
                    <div className="h-[3px] w-14 rounded-full bg-[#7fa8b3] mt-1.5" />
                </div>
                <div className="px-5 py-3 max-h-[58vh] overflow-y-auto no-scrollbar">{children}</div>
                {footer && <div className="px-5 pb-5 pt-2 flex gap-3">{footer}</div>}
            </div>
        </div>
    );
};

/** 淡玫瑰开关：与絮语私聊设置一致的轻量 toggle */
const InkSwitch: React.FC<{ on: boolean; onChange: (on: boolean) => void; title?: string; disabled?: boolean }> = ({ on, onChange, title, disabled }) => (
    <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={(e) => { e.stopPropagation(); if (!disabled) onChange(!on); }}
        title={title}
        disabled={disabled}
        className={`relative w-[52px] h-[28px] rounded-full shrink-0 transition-all duration-300 active:scale-95 ${disabled ? 'opacity-50' : ''}`}
        style={{
            background: on ? ROSE : '#eef2f0',
            border: `1px solid ${LINE}`,
            boxShadow: on ? '0 8px 16px -14px rgba(31,35,38,0.36)' : 'inset 0 1px 2px rgba(31,35,38,0.06)',
        }}
    >
        <span className="absolute top-1/2 -translate-y-1/2 text-[8px] font-bold transition-opacity duration-300 pointer-events-none" style={{ left: 8, color: 'rgba(255,255,255,0.92)', opacity: on ? 1 : 0 }}>ON</span>
        <span className="absolute top-1/2 -translate-y-1/2 text-[8px] font-bold transition-opacity duration-300 pointer-events-none" style={{ right: 7, color: '#aab0ac', opacity: on ? 0 : 1 }}>off</span>
        <span
            className="absolute top-1/2 -translate-y-1/2 w-[22px] h-[22px] rounded-full bg-white transition-all duration-300 pointer-events-none"
            style={{ left: on ? 27 : 3, boxShadow: '0 2px 6px rgba(31,35,38,0.18)' }}
        />
    </button>
);

/** 分区白卡：与絮语设置一致的 ins 白卡 + 拍立得轻贴纸 */
const SectionCard: React.FC<{
    tag: string;
    title: string;
    right?: React.ReactNode;
    hand?: string;
    rotate?: string;
    manualAnchor?: string;
    children: React.ReactNode;
}> = ({ tag, title, right, hand, manualAnchor, children }) => (
    <section data-manual-anchor={manualAnchor} className="relative bg-white rounded-[18px] p-4 pt-5" style={{ border: `1px solid ${CARD_BORDER}`, boxShadow: CARD_SHADOW }}>
        <Tape className="-top-2 left-6" />
        <div className="flex items-start justify-between gap-2 mb-2">
            <div className="min-w-0">
                <div className="label-mono text-[9px] text-[#8a918d]">{tag}</div>
                <h2 className="text-base font-black text-[#2f3437] tracking-wide leading-tight">{title}</h2>
            </div>
            {right}
        </div>
        {hand && <p className="text-[11px] text-[#69716d] mb-3 leading-relaxed" style={HAND_CN}>{hand}</p>}
        {children}
    </section>
);

const InfoNote: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
    <div
        className={`rounded-[14px] px-3 py-2.5 text-[11px] leading-relaxed ${className || ''}`}
        style={{ color: '#69716d', background: '#f3f7f6', border: '1px solid #dce8ea' }}
    >
        {children}
    </div>
);

const StatusBadge: React.FC<{ active: boolean; activeText: string; inactiveText: string }> = ({ active, activeText, inactiveText }) => (
    <span
        className="shrink-0 label-mono text-[9px] px-2 py-1 rounded-full"
        style={{
            color: active ? '#ffffff' : '#8a918d',
            background: active ? ROSE : '#fffdf8',
            border: `1px solid ${LINE}`,
        }}
    >
        {active ? activeText : inactiveText}
    </span>
);

const ModelSelectButton: React.FC<{ model: string; placeholder: string; onClick: () => void }> = ({ model, placeholder, onClick }) => (
    <button
        onClick={onClick}
        title={model || placeholder}
        className={`w-full px-4 py-3 text-sm flex justify-between items-center gap-2 relative ${STICKER}`}
    >
        <span
            className="font-mono overflow-hidden whitespace-nowrap min-w-0 flex-1 text-left"
            style={{ direction: 'rtl', textOverflow: 'ellipsis', color: model ? INK : INK_SOFT }}
        >
            <bdi style={{ direction: 'ltr' }}>{model || placeholder}</bdi>
        </span>
        <span className="flex-shrink-0 text-xs" style={{ color: INK_SOFT }}>选择</span>
    </button>
);

const StatusTile: React.FC<{ label: string; value: string; detail?: string; active?: boolean }> = ({ label, value, detail, active }) => (
    <div className={`min-w-0 rounded-[16px] border px-3 py-2.5 ${active ? 'border-[#dce8ea] bg-[#f3f7f6] text-[#2f3437]' : 'border-[#eee9df] bg-white/80 text-[#69716d]'}`}>
        <div className={`label-mono text-[8px] ${active ? 'text-[#577782]' : 'text-[#8a918d]'}`}>{label}</div>
        <div className="text-[12px] font-black truncate mt-0.5">{value}</div>
        {detail && <div className={`text-[9px] mt-0.5 truncate ${active ? 'text-[#69716d]' : 'text-[#8a918d]'}`}>{detail}</div>}
    </div>
);

const JumpButton: React.FC<{ label: string; target: string; onJump: (target: string) => void }> = ({ label, target, onJump }) => (
    <button
        type="button"
        onClick={() => onJump(target)}
        className={`px-3 py-2 text-[11px] font-black ${STICKER}`}
    >
        {label}
    </button>
);

const SettingsGroup: React.FC<{ id: string; eyebrow: string; title: string; desc: string; children: React.ReactNode }> = ({ id, eyebrow, title, desc, children }) => (
    <section id={id} className="scroll-mt-28 space-y-3">
        <div className="flex items-end justify-between gap-3 px-1">
            <div className="min-w-0">
                <div className="label-mono text-[8px] text-[#8a918d]">{eyebrow}</div>
                <h2 className="text-lg font-black text-[#2f3437] tracking-wide">{title}</h2>
            </div>
            <p className="hidden sm:block text-[11px] text-[#69716d] leading-snug max-w-[16rem] text-right">{desc}</p>
        </div>
        <p className="sm:hidden text-[11px] text-[#69716d] leading-snug px-1">{desc}</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start">
            {children}
        </div>
    </section>
);

const DiagRow: React.FC<{ label: string; value: string; bad?: boolean }> = ({ label, value, bad }) => (
    <div className="flex items-start justify-between gap-3">
        <span className="text-[#69716d] shrink-0">{label}</span>
        <span className={`text-right ${bad ? 'text-[#577782] font-bold underline decoration-wavy decoration-[#7fa8b3]/70' : 'text-[#2f3437]/80'}`}>{value}</span>
    </div>
);

const formatApkVersion = (versionName?: string, versionCode?: number | string) =>
    `${versionName || 'unknown'}（${versionCode || 0}）`;

const formatApkNoUpdateStatus = (result: AppUpdateCheckResult) =>
    `当前已是最新版：本机 ${formatApkVersion(result.current.versionName, result.current.versionCode)} · 远端 ${formatApkVersion(result.latest.versionName, result.latest.versionCode)}`;

/** 界面全屏开关（文具盒）：用 Fullscreen API 让整机网页铺满屏幕、藏起浏览器地址栏等 chrome。 */
const FullscreenCard: React.FC<{ addToast: (m: string, t: 'info' | 'success' | 'error') => void }> = ({ addToast }) => {
    const isFullscreenNow = () => typeof document !== 'undefined' && !!(document.fullscreenElement || (document as any).webkitFullscreenElement);
    const [isFs, setIsFs] = useState<boolean>(isFullscreenNow);
    const supported = typeof document !== 'undefined' && !!(
        document.documentElement.requestFullscreen || (document.documentElement as any).webkitRequestFullscreen
    );
    useEffect(() => {
        const onChange = () => setIsFs(isFullscreenNow());
        document.addEventListener('fullscreenchange', onChange);
        document.addEventListener('webkitfullscreenchange', onChange as any);
        return () => {
            document.removeEventListener('fullscreenchange', onChange);
            document.removeEventListener('webkitfullscreenchange', onChange as any);
        };
    }, []);
    const toggle = async () => {
        const el = document.documentElement as any;
        const doc = document as any;
        try {
            if (!isFullscreenNow()) {
                if (el.requestFullscreen) await el.requestFullscreen();
                else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
                else { addToast('当前浏览器不支持网页全屏（iOS Safari 可「添加到主屏幕」获得全屏）', 'info'); return; }
            } else {
                if (document.exitFullscreen) await document.exitFullscreen();
                else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
            }
        } catch (e: any) {
            addToast('全屏切换失败：' + (e?.message || '浏览器拒绝'), 'error');
        }
    };
    return (
        <SectionCard
            tag="FULLSCREEN"
            title="界面全屏"
            hand="启用浏览器全屏显示"
            rotate="rotate-[0.4deg]"
            right={<InkSwitch on={isFs} onChange={() => void toggle()} title="界面全屏" disabled={!supported} />}
        >
            <p className="text-[11px] text-[#26242a]/55 leading-snug">
                {supported
                    ? '隐藏地址栏和系统栏。再次点击开关或按返回键即可退出全屏。'
                    : '当前环境不支持网页全屏。iOS Safari 可用分享菜单「添加到主屏幕」，以独立 App 的全屏方式打开。'}
            </p>
        </SectionCard>
    );
};

const TopStatusBarCard: React.FC<{ hidden: boolean; onChange: (hidden: boolean) => void }> = ({ hidden, onChange }) => (
    <SectionCard
        tag="STATUS BAR"
        title="顶部状态栏"
        hand="藏起 Moro 自带的时间、电量和网络状态"
        rotate="rotate-[-0.35deg]"
        right={<InkSwitch on={hidden} onChange={onChange} title="藏起顶部状态栏" />}
    >
        <p className="text-[11px] text-[#26242a]/55 leading-snug">
            开启后会收起屏幕上方那条 Moro 时间 / 电量 / 网络状态栏；如果还想隐藏浏览器或手机系统顶栏，可同时使用「界面全屏」。
        </p>
    </SectionCard>
);

const Settings: React.FC = () => {
  const {
      apiConfig, updateApiConfig, auxApiConfig, updateAuxApiConfig, closeApp, availableModels, setAvailableModels,
      exportSystem, importSystem, addToast, showError, resetSystem,
      apiPresets, addApiPreset, removeApiPreset,
      sysOperation, // Get progress state
      realtimeConfig, updateRealtimeConfig, // 实时感知配置
      cloudBackupConfig, updateCloudBackupConfig,
      cloudBackupToWebDAV, cloudRestoreFromWebDAV, listCloudBackups,
      openApp,
      theme, updateTheme,
      activeApp,
  } = useOS();
  const nativeRuntime = isNativeNotificationRuntime();
  const settingsRootRef = useRef<HTMLDivElement>(null);
  const settingsScrollRef = useRef<HTMLDivElement>(null);
  
  const [localKey, setLocalKey] = useState(apiConfig.apiKey);
  const [localUrl, setLocalUrl] = useState(apiConfig.baseUrl);
  const [localModel, setLocalModel] = useState(apiConfig.model);
  const [localStream, setLocalStream] = useState<boolean>(isMainApiStreamEnabled(apiConfig));
  const [localTemperature, setLocalTemperature] = useState<number>(
    typeof apiConfig.temperature === 'number' ? apiConfig.temperature : 0.85
  );
  const [mainContextBudgetOn, setMainContextBudgetOn] = useState<boolean>(() => isMainContextBudgetEnabled());
  const [localMiniMaxKey, setLocalMiniMaxKey] = useState(apiConfig.minimaxApiKey || '');
  const [localMiniMaxGroupId, setLocalMiniMaxGroupId] = useState(apiConfig.minimaxGroupId || '');
  const [localMiniMaxRegion, setLocalMiniMaxRegion] = useState<'domestic' | 'overseas'>(
    apiConfig.minimaxRegion === 'overseas' ? 'overseas' : 'domestic'
  );
  const [localAceStepKey, setLocalAceStepKey] = useState(apiConfig.aceStepApiKey || '');
  const [showAceStepGuide, setShowAceStepGuide] = useState(false);

  useEffect(() => {
      let frame = 0;
      const keepSettingsAligned = () => {
          if (frame) return;
          frame = window.requestAnimationFrame(() => {
              frame = 0;
              const root = settingsRootRef.current;
              const scroller = settingsScrollRef.current;
              if (root) root.scrollLeft = 0;
              if (scroller) scroller.scrollLeft = 0;
              if (document.documentElement.scrollLeft !== 0) document.documentElement.scrollLeft = 0;
              if (document.body.scrollLeft !== 0) document.body.scrollLeft = 0;
              if (window.scrollX !== 0) window.scrollTo(0, window.scrollY);
          });
      };

      document.addEventListener('selectionchange', keepSettingsAligned);
      window.addEventListener('scroll', keepSettingsAligned, { passive: true });
      window.visualViewport?.addEventListener('scroll', keepSettingsAligned);
      window.visualViewport?.addEventListener('resize', keepSettingsAligned);
      settingsRootRef.current?.addEventListener('select', keepSettingsAligned, true);
      settingsRootRef.current?.addEventListener('focusin', keepSettingsAligned, true);
      settingsRootRef.current?.addEventListener('touchend', keepSettingsAligned, true);

      return () => {
          if (frame) window.cancelAnimationFrame(frame);
          document.removeEventListener('selectionchange', keepSettingsAligned);
          window.removeEventListener('scroll', keepSettingsAligned);
          window.visualViewport?.removeEventListener('scroll', keepSettingsAligned);
          window.visualViewport?.removeEventListener('resize', keepSettingsAligned);
          settingsRootRef.current?.removeEventListener('select', keepSettingsAligned, true);
          settingsRootRef.current?.removeEventListener('focusin', keepSettingsAligned, true);
          settingsRootRef.current?.removeEventListener('touchend', keepSettingsAligned, true);
      };
  }, []);

  // 副 API（处理主聊天以外的辅助任务：生活侧写、记忆整理……）
  const [localAuxEnabled, setLocalAuxEnabled] = useState<boolean>(!!auxApiConfig.enabled);
  const [localAuxUrl, setLocalAuxUrl] = useState(auxApiConfig.baseUrl);
  const [localAuxKey, setLocalAuxKey] = useState(auxApiConfig.apiKey);
  const [localAuxModel, setLocalAuxModel] = useState(auxApiConfig.model);
  const [auxContextBudgetOn, setAuxContextBudgetOn] = useState<boolean>(() => isAuxContextBudgetEnabled());
  const [auxAvailableModels, setAuxAvailableModels] = useState<string[]>(() => {
      try {
          const saved = localStorage.getItem(AUX_MODELS_STORAGE_KEY);
          const parsed = saved ? JSON.parse(saved) : [];
          return Array.isArray(parsed) ? parsed.filter((m): m is string => typeof m === 'string') : [];
      } catch {
          return [];
      }
  });
  const [auxStatusMsg, setAuxStatusMsg] = useState('');
  const [otherStatusMsg, setOtherStatusMsg] = useState('');
  // 高级设置（流式/温度）默认折叠 — 大多数用户不需要碰
  const [showApiAdvanced, setShowApiAdvanced] = useState(false);
  // 预设 App 接管采样参数时，温度滑条旁提示用户去预设里改（联动提示）
  const [presetTakeoverName, setPresetTakeoverName] = useState<string | null>(null);
  useEffect(() => {
      let cancelled = false;
      (async () => {
          if (!PresetRuntime.isEnabled() || !PresetRuntime.isSamplingApplied()) return;
          const id = PresetRuntime.getActiveId();
          if (!id) return;
          try {
              const p = await DB.getPreset(id);
              if (!cancelled && p) setPresetTakeoverName(p.name);
          } catch { /* 预设读取失败时不挡设置页 */ }
      })();
      return () => { cancelled = true; };
  }, []);
  const [loadingModelTarget, setLoadingModelTarget] = useState<'main' | 'aux' | null>(null);
  const [newPresetName, setNewPresetName] = useState('');
  
  // UI States
  const [showModelModal, setShowModelModal] = useState(false);
  const [modelPickerTarget, setModelPickerTarget] = useState<'main' | 'aux'>('main');
  const [modelFilter, setModelFilter] = useState('');
  const [showExportModal, setShowExportModal] = useState(false); // Used for completion now
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showPresetModal, setShowPresetModal] = useState(false);
  const [showApiCallLog, setShowApiCallLog] = useState(false);
  const [showRealtimeModal, setShowRealtimeModal] = useState(false);
  const [showCloudModal, setShowCloudModal] = useState(false);
  const [showGithubModal, setShowGithubModal] = useState(false);
  const [showCloudRestoreModal, setShowCloudRestoreModal] = useState(false);
  const [cloudBackupFiles, setCloudBackupFiles] = useState<import('../types').CloudBackupFile[]>([]);
  const [cloudTestResult, setCloudTestResult] = useState<string>('');
  const [cloudTesting, setCloudTesting] = useState(false);

  // 应用更新（手机安装版检查）
  const [nativeAppInfo, setNativeAppInfo] = useState<NativeAppInfo | null>(null);
  const [apkUpdateCheck, setApkUpdateCheck] = useState<AppUpdateCheckResult | null>(null);
  const [apkUpdateBusy, setApkUpdateBusy] = useState(false);
  const [apkUpdateStatus, setApkUpdateStatus] = useState('');
  const [apkDownloadProgress, setApkDownloadProgress] = useState<ApkDownloadProgress | null>(null);

  // 锁屏密码（默认 0103；关闭后锁屏点按直接解锁）
  const [lockPassEnabled, setLockPassEnabled] = useState(() => isLockPasscodeEnabled());
  const [lockPassCurrent, setLockPassCurrent] = useState('');
  const [lockPassNew, setLockPassNew] = useState('');

  // Cloud backup local config state (WebDAV)
  const [cbUrl, setCbUrl] = useState(cloudBackupConfig.webdavUrl);
  const [cbUsername, setCbUsername] = useState(cloudBackupConfig.username);
  const [cbPassword, setCbPassword] = useState(cloudBackupConfig.password);
  const [cbPath, setCbPath] = useState(cloudBackupConfig.remotePath || '/MoroBackup/');

  // GitHub local state
  const [ghToken, setGhToken] = useState(cloudBackupConfig.githubToken || '');
  const [ghRepo, setGhRepo] = useState(cloudBackupConfig.githubRepo || 'moro-backup');
  // Default proxy ON — most users in mainland China can't reach github.com
  // directly. Only flip to false if the user has explicitly opted out before.
  const [ghUseProxy, setGhUseProxy] = useState(cloudBackupConfig.githubUseProxy !== false);
  const [ghShowAdvanced, setGhShowAdvanced] = useState(false);
  const [ghTesting, setGhTesting] = useState(false);
  const [ghTestResult, setGhTestResult] = useState<string>('');

  // 实时感知配置的本地状态
  const [rtWeatherEnabled, setRtWeatherEnabled] = useState(realtimeConfig.weatherEnabled);
  const [rtWeatherMode, setRtWeatherMode] = useState<'geo' | 'manual'>(realtimeConfig.weatherMode || 'geo');
  const [rtWeatherKey, setRtWeatherKey] = useState(realtimeConfig.weatherApiKey);
  const [rtWeatherCity, setRtWeatherCity] = useState(realtimeConfig.weatherCity);
  const [rtNewsEnabled, setRtNewsEnabled] = useState(realtimeConfig.newsEnabled);
  const [rtNewsApiKey, setRtNewsApiKey] = useState(realtimeConfig.newsApiKey || '');
  const [rtNewsPlatforms, setRtNewsPlatforms] = useState<string[]>(realtimeConfig.newsPlatforms || ['weibo', 'zhihu', 'baidu', 'bilibili', 'douyin']);
  const [rtNotionEnabled, setRtNotionEnabled] = useState(realtimeConfig.notionEnabled);
  const [rtNotionKey, setRtNotionKey] = useState(realtimeConfig.notionApiKey);
  const [rtNotionDbId, setRtNotionDbId] = useState(realtimeConfig.notionDatabaseId);
  const [rtNotionNotesDbId, setRtNotionNotesDbId] = useState(realtimeConfig.notionNotesDatabaseId || '');
  const [rtFeishuEnabled, setRtFeishuEnabled] = useState(realtimeConfig.feishuEnabled);
  const [rtFeishuAppId, setRtFeishuAppId] = useState(realtimeConfig.feishuAppId);
  const [rtFeishuAppSecret, setRtFeishuAppSecret] = useState(realtimeConfig.feishuAppSecret);
  const [rtFeishuBaseId, setRtFeishuBaseId] = useState(realtimeConfig.feishuBaseId);
  const [rtFeishuTableId, setRtFeishuTableId] = useState(realtimeConfig.feishuTableId);
  const [rtXhsEnabled, setRtXhsEnabled] = useState(realtimeConfig.xhsEnabled);
  const XHS_LITE_URL = 'https://sullymeow.ccwu.cc/api';
  const XHS_RISK_TEXT = '⚠️ 风险：本功能基于网页爬虫技术调用小红书，账号有被风控的概率。建议①用小号；②尽量别让角色主动发帖；③发出的笔记可能被屏蔽。';
  const XHS_COOKIE_GUIDE = [
    '【获取小红书 cookie 教程】',
    '1. 用电脑浏览器(Chrome/Edge)登录 www.xiaohongshu.com',
    '2. 按 F12 打开开发者工具，切到「Network/网络」标签',
    '3. 刷新页面，点列表最上面那条「explore」(document 类型，发给 www.xiaohongshu.com 的主请求)',
    '4. 右侧切到「Headers/标头」，往下滚到「Request Headers/请求标头」',
    '5. 找到 cookie: 开头那一行(很长一串)',
    '6. 复制它后面整段的值：可把 Request Headers 右边的「Raw」开关打开看纯文本更好选，或在值上右键 Copy value，或选中后 Ctrl+C',
    '7. 确认这串里有 a1= 和 web_session= 两个字段(最关键)，粘到「小红书 Lite」的 cookie 框',
    '注意：别用 Console 的 document.cookie，拿不到 web_session(httpOnly)。cookie 数天~数周会过期，失效重复制即可。',
  ].join('\n');
  const _xhsCfgUrl = realtimeConfig.xhsMcpConfig?.serverUrl || '';
  const [rtXhsMcpEnabled, setRtXhsMcpEnabled] = useState(realtimeConfig.xhsMcpConfig?.enabled || false);
  const [rtXhsMode, setRtXhsMode] = useState<'lite' | 'local'>(_xhsCfgUrl && _xhsCfgUrl !== XHS_LITE_URL ? 'local' : 'lite');
  const [rtXhsLocalUrl, setRtXhsLocalUrl] = useState(_xhsCfgUrl && _xhsCfgUrl !== XHS_LITE_URL ? _xhsCfgUrl : 'http://localhost:18060/mcp');
  const [rtXhsNickname, setRtXhsNickname] = useState(realtimeConfig.xhsMcpConfig?.loggedInNickname || '');
  const [rtXhsUserId, setRtXhsUserId] = useState(realtimeConfig.xhsMcpConfig?.loggedInUserId || '');
  const [rtXhsCookie, setRtXhsCookie] = useState(realtimeConfig.xhsMcpConfig?.cookie || '');
  const [rtXhsGuideOpen, setRtXhsGuideOpen] = useState(false);
  const [rtTestStatus, setRtTestStatus] = useState('');

  // 麦当劳 MCP (token / 启用态都直接存 localStorage, 不进 realtimeConfig)
  const [mcdToken, setMcdTokenState] = useState(() => getMcdToken());
  const [mcdEnabled, setMcdEnabledState] = useState(() => isMcdEnabled());
  const [mcdTestStatus, setMcdTestStatus] = useState('');
  const [mcdTesting, setMcdTesting] = useState(false);

  // Proactive Push 加速器（Worker URL / VAPID 公钥写死在 proactivePushConfig.ts 常量里）
  const initialPushCfg = loadPushConfig();
  const ppAvailable = isPushConfigAvailable();
  const [ppEnabled, setPpEnabled] = useState(initialPushCfg.enabled);
  const [ppStatus, setPpStatus] = useState<string>('');
  const [ppBusy, setPpBusy] = useState(false);
  const [showPpConfirm, setShowPpConfirm] = useState(false);
  const [ppDiag, setPpDiag] = useState<PushDiagnostics | null>(null);
  const [ppTestBusy, setPpTestBusy] = useState(false);
  const [ppResetBusy, setPpResetBusy] = useState(false);
  const [ppDeepResetBusy, setPpDeepResetBusy] = useState(false);
  // 连续 zombie 重置失败次数 — 累计 >= 3 时, "重置订阅" 按钮自动 morph 成
  // "深度重置". 不持久化, 刷新页面归零 (用户原话: "刷新页面正常消失").
  const [ppZombieStreak, setPpZombieStreak] = useState(0);
  const [showInstantModal, setShowInstantModal] = useState(false);
  const [showVapidModal, setShowVapidModal] = useState(false);
  // 自律代理 · 后台回复通知（普通聊天发出后切后台，回复完成进系统通知栏）
  const [bgReplyNotify, setBgReplyNotifyState] = useState(isBackgroundReplyNotifyEnabled());
  const [notifyPerm, setNotifyPerm] = useState<NotifyPermission>(getNotifyPermission());
  const [vapidReadyTick, setVapidReadyTick] = useState(0); // 关闭 VAPID 弹窗后刷新顶层徽标

  // 模型选择 Modal 的过滤 + 公共前缀（memo 掉，避免每次 Settings 重渲染都重算）
  const modelPickerView = useMemo(() => {
      const sourceModels = modelPickerTarget === 'aux' ? auxAvailableModels : availableModels;
      const q = modelFilter.trim().toLowerCase();
      const filtered = q ? sourceModels.filter(m => m.toLowerCase().includes(q)) : sourceModels;
      let commonPrefix = '';
      if (filtered.length >= 2) {
          let p = filtered[0];
          for (let i = 1; i < filtered.length; i++) {
              const s = filtered[i];
              let j = 0;
              while (j < p.length && j < s.length && p[j] === s[j]) j++;
              p = p.slice(0, j);
              if (!p) break;
          }
          const cut = Math.max(p.lastIndexOf('/'), p.lastIndexOf('-'));
          if (cut > 3) p = p.slice(0, cut + 1);
          if (p.length >= 4) commonPrefix = p;
      }
      return { filtered, commonPrefix, total: sourceModels.length };
  }, [modelFilter, availableModels, auxAvailableModels, modelPickerTarget]);

  const refreshPpDiag = useCallback(async () => {
      try { setPpDiag(await getPushDiagnostics()); } catch { /* ignore */ }
  }, []);

  const doEnablePushAccelerator = async () => {
      if (ppBusy) return;
      setPpBusy(true);
      setPpStatus('正在连接 Worker…');
      try {
          const res = await fetch(`${initialPushCfg.workerUrl}/health`);
          if (!res.ok) { setPpStatus(`失败：Worker HTTP ${res.status}`); setPpBusy(false); return; }
      } catch (e: any) {
          setPpStatus(`失败：${e?.message || '网络错误'}`); setPpBusy(false); return;
      }

      // Step 1: ensure permission + subscription up front, regardless of schedules.
      // This is the fix for the old bug where toggle "succeeded" without ever
      // requesting permission when the user hadn't enabled any character timer yet.
      setPpStatus('正在请求通知权限并创建订阅…');
      const sub = await ensureSubscribed();
      if (!sub.ok) {
          setPpStatus(`失败：${sub.reason || '订阅创建失败'}`);
          setPpBusy(false);
          await refreshPpDiag();
          return;
      }

      // Step 2: persist enabled flag and start heartbeat.
      savePushConfig(true);
      setPpEnabled(true);
      startHeartbeat();

      // Step 3: register any existing per-character schedules.
      const schedules = ProactiveChat.getSchedules();
      let okCount = 0;
      for (const s of schedules) {
          if (await registerScheduleOnWorker(s.charId, s.intervalMs)) okCount++;
      }

      if (schedules.length === 0) {
          setPpStatus('已启用（订阅已建立。暂无主动消息定时，下次开启角色主动消息时会自动注册）');
      } else if (okCount < schedules.length) {
          setPpStatus(`已启用：${okCount}/${schedules.length} 个定时注册成功`);
      } else {
          setPpStatus(`已启用，${okCount} 个主动消息定时已注册`);
      }
      setPpBusy(false);
      await refreshPpDiag();
  };

  const doDisablePushAccelerator = async () => {
      savePushConfig(false);
      setPpEnabled(false);
      stopHeartbeat();
      setPpStatus('已关闭（主动消息退回本地计时器）');
      await refreshPpDiag();
  };

  const doSendTestPush = async () => {
      if (ppTestBusy) return;
      setPpTestBusy(true);
      setPpStatus('正在发送测试推送…');
      const res = await sendTestPush();
      if (res.ok) {
          setPpStatus('测试推送已发出。如果 5 秒内系统通知里没出现"推送测试成功"，说明送达环节有问题——看下方诊断面板。');
      } else if (res.deadSubscription) {
          setPpStatus('订阅已被浏览器吊销（zombie endpoint）。请点下方"重置订阅"重建一次再测。');
      } else {
          setPpStatus(`测试失败：${res.reason || '未知错误'}${res.status ? `（HTTP ${res.status}）` : ''}`);
      }
      setPpTestBusy(false);
      await refreshPpDiag();
  };

  const doResetSubscription = async () => {
      if (ppResetBusy || ppDeepResetBusy) return;
      setPpResetBusy(true);
      setPpStatus('正在重置订阅…');
      const res = await resetSubscription();
      if (res.ok) {
          setPpZombieStreak(0);
          setPpStatus('订阅已重建。可以再次发送测试推送验证。');
      } else {
          const reason = res.reason || '';
          // 失败原因指向 zombie endpoint 时累计, 达到 3 次后按钮自动 morph 成深度重置
          if (/permanently-removed|zombie/i.test(reason)) {
              setPpZombieStreak(c => c + 1);
          }
          setPpStatus(`重置失败：${reason || '未知错误'}`);
      }
      setPpResetBusy(false);
      await refreshPpDiag();
  };

  const doDeepResetSubscription = async () => {
      if (ppDeepResetBusy || ppResetBusy) return;
      setPpDeepResetBusy(true);
      setPpStatus('正在深度重置…');
      const res = await deepResetSubscription();
      // 无论成败, 按钮都回归"重置订阅" — 下次出问题再次累计触发 morph
      setPpZombieStreak(0);
      if (res.ok) {
          // ProactiveChat.resume() 把所有 schedule 推回新 SW. deepResetSubscription 内部
          // 不调它是为了避免循环依赖 (ProactiveChat 反向依赖 proactivePushConfig).
          try { ProactiveChat.resume(); } catch (e) { console.warn('[Settings] ProactiveChat.resume failed', e); }
          setPpStatus('订阅已重建。可以再次发送测试推送验证。');
      } else {
          setPpStatus(`深度重置失败：${res.reason || '未知错误'}`);
      }
      setPpDeepResetBusy(false);
      await refreshPpDiag();
  };

  // Refresh diagnostics whenever the panel is mounted or the toggle changes.
  useEffect(() => {
      void refreshPpDiag();
  }, [refreshPpDiag, ppEnabled]);

  useEffect(() => {
      let cancelled = false;
      (async () => {
          const info = await getNativeAppInfo();
          if (!cancelled) setNativeAppInfo(info);
      })();
      return () => { cancelled = true; };
  }, []);

  const handleCheckApkUpdate = async () => {
      if (apkUpdateBusy) return;
      setApkUpdateBusy(true);
      setApkDownloadProgress(null);
      setApkUpdateStatus('正在检查更新...');
      try {
          const result = await checkConfiguredAppUpdate();
          setNativeAppInfo(result.current);
          setApkUpdateCheck(result);
          setApkUpdateStatus(result.updateAvailable
              ? `发现新版本 ${result.latest.versionName}（${result.latest.versionCode}）`
              : formatApkNoUpdateStatus(result));
      } catch (e: any) {
          console.warn('[Settings] check app update failed', e);
          setApkUpdateCheck(null);
          const message = e?.message || '检查更新失败';
          setApkUpdateStatus(message);
          addToast(message, 'error');
      } finally {
          setApkUpdateBusy(false);
      }
  };

  const handleDownloadApkUpdate = async (useDomesticLine = false) => {
      if (apkUpdateBusy) return;
      let latest = apkUpdateCheck?.latest;
      if (!latest) {
          try {
              const result = await checkConfiguredAppUpdate();
              setNativeAppInfo(result.current);
              setApkUpdateCheck(result);
              if (!result.updateAvailable) {
                  setApkUpdateStatus(formatApkNoUpdateStatus(result));
                  return;
              }
              latest = result.latest;
          } catch (e: any) {
              console.warn('[Settings] load app update before download failed', e);
              addToast(e?.message || '读取更新清单失败', 'error');
              return;
          }
      }
      if (useDomesticLine && !latest.domesticApkUrl) {
          addToast('国内线路暂不可用', 'error');
          return;
      }

      setApkUpdateBusy(true);
      setApkUpdateStatus(useDomesticLine ? '正在通过国内线路下载更新包...' : '正在下载更新包...');
      setApkDownloadProgress(null);
      try {
          const downloadTarget = useDomesticLine && latest.domesticApkUrl
              ? { ...latest, apkUrl: latest.domesticApkUrl }
              : latest;
          await downloadAndInstallApk(downloadTarget, progress => {
              setApkDownloadProgress(progress);
              if (progress.status === 'downloading') {
                  setApkUpdateStatus(`正在下载更新包：${Math.round(progress.progress * 100)}%`);
              } else if (progress.status === 'verifying') {
                  setApkUpdateStatus('正在校验更新包...');
              } else if (progress.status === 'installing') {
                  setApkUpdateStatus('正在打开系统安装器...');
              }
          });
          setApkUpdateStatus('系统安装器已打开，请按提示确认安装。');
      } catch (e: any) {
          console.warn('[Settings] download app update failed', e);
          const message = e?.message || '下载或安装失败';
          setApkUpdateStatus(message);
          addToast(message, 'error');
      } finally {
          setApkUpdateBusy(false);
      }
  };

  const handleOpenInstallPermission = async () => {
      try {
          await openInstallerPermissionSettings();
          addToast('已打开安装权限设置', 'info');
      } catch (e: any) {
          addToast(e?.message || '无法打开安装权限设置', 'error');
      }
  };

  // For web download link
  const [downloadUrl, setDownloadUrl] = useState<string>('');
  
  const [statusMsg, setStatusMsg] = useState('');
  const [testingApi, setTestingApi] = useState(false);
  const [testApiResult, setTestApiResult] = useState<string | null>(null);
  const [testingAuxApi, setTestingAuxApi] = useState(false);
  const [testAuxApiResult, setTestAuxApiResult] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  // Auto-save draft configs locally to prevent loss during typing
  useEffect(() => {
      setLocalUrl(apiConfig.baseUrl);
      setLocalKey(apiConfig.apiKey);
      setLocalModel(apiConfig.model);
      setLocalStream(isMainApiStreamEnabled(apiConfig));
      setLocalTemperature(typeof apiConfig.temperature === 'number' ? apiConfig.temperature : 0.85);
      setLocalMiniMaxKey(apiConfig.minimaxApiKey || '');
      setLocalMiniMaxGroupId(apiConfig.minimaxGroupId || '');
      setLocalMiniMaxRegion(apiConfig.minimaxRegion === 'overseas' ? 'overseas' : 'domestic');
      setLocalAceStepKey(apiConfig.aceStepApiKey || '');
  }, [apiConfig]);

  useEffect(() => {
      setLocalAuxEnabled(!!auxApiConfig.enabled);
      setLocalAuxUrl(auxApiConfig.baseUrl);
      setLocalAuxKey(auxApiConfig.apiKey);
      setLocalAuxModel(auxApiConfig.model);
  }, [auxApiConfig]);

  const handleSaveAuxApi = () => {
      updateAuxApiConfig({
          enabled: localAuxEnabled,
          baseUrl: localAuxUrl.trim(),
          apiKey: localAuxKey.trim(),
          model: localAuxModel.trim(),
      });
      setAuxStatusMsg('副 API 已保存');
      setTimeout(() => setAuxStatusMsg(''), 2000);
  };

  const handleTestAuxApi = async () => {
      if (!localAuxUrl.trim() || !localAuxModel.trim()) return;
      setTestingAuxApi(true);
      setTestAuxApiResult(null);
      try {
          const reply = await testChatConnection(
              { baseUrl: localAuxUrl.trim(), apiKey: localAuxKey.trim(), model: localAuxModel.trim() },
              { stream: false, meta: makeApiUsageMeta('settings.auxApi.testConnection', { apiRole: 'aux' }) },
          );
          setTestAuxApiResult(`✅ 连接成功 — 模型回复: "${reply.slice(0, 30)}"`);
      } catch (err: any) {
          setTestAuxApiResult(`❌ 连接失败: ${err.message}`);
      } finally {
          setTestingAuxApi(false);
      }
  };

  /** 把主 API 的 URL/Key/模型一键拷进副 API（多数人主副同源，省得重填） */
  const handleCopyMainToAux = () => {
      setLocalAuxUrl(apiConfig.baseUrl);
      setLocalAuxKey(apiConfig.apiKey);
      setLocalAuxModel(apiConfig.model);
      addToast('已复制主 API 配置，保存后生效', 'info');
  };

  const loadPreset = (preset: typeof apiPresets[0]) => {
      setLocalUrl(preset.config.baseUrl);
      setLocalKey(preset.config.apiKey);
      setLocalModel(preset.config.model);
      setLocalStream(isMainApiStreamEnabled(preset.config));
      setLocalTemperature(typeof preset.config.temperature === 'number' ? preset.config.temperature : 0.85);
      // MiniMax / AceStep settings are NOT overwritten by presets — typically one user
      // has only one MiniMax / Replicate account regardless of which LLM preset they use.
      addToast(`已载入 API 预设：${preset.name}`, 'info');
  };

  const handleSavePreset = () => {
      if (!newPresetName.trim()) {
          addToast('请先填写预设名称', 'error');
          return;
      }
      addApiPreset(newPresetName, {
        baseUrl: localUrl,
        apiKey: localKey,
        model: localModel,
        stream: localStream,
        temperature: localTemperature,
      });
      setNewPresetName('');
      setShowPresetModal(false);
      addToast('API 预设已保存', 'success');
  };

  const handleSaveApi = () => {
    updateApiConfig({
      apiKey: localKey,
      baseUrl: localUrl,
      model: localModel,
      stream: localStream,
      temperature: localTemperature,
    });
    setStatusMsg('主 API 已保存');
    setTimeout(() => setStatusMsg(''), 2000);
  };

  const handleSaveOtherApis = () => {
    updateApiConfig({
      minimaxApiKey: localMiniMaxKey,
      minimaxGroupId: localMiniMaxGroupId,
      minimaxRegion: localMiniMaxRegion,
      aceStepApiKey: localAceStepKey,
    });
    setOtherStatusMsg('已保存');
    setTimeout(() => setOtherStatusMsg(''), 2000);
  };

  const openModelPicker = (target: 'main' | 'aux') => {
      setModelPickerTarget(target);
      setModelFilter('');
      setShowModelModal(true);
  };

  const handleMainContextBudgetToggle = (next: boolean) => {
      setMainContextBudgetOn(next);
      setMainContextBudgetEnabled(next);
      addToast(next ? '主 API 上下文防爆保护已开启' : '主 API 上下文防爆保护已关闭', 'success');
  };

  const handleAuxContextBudgetToggle = (next: boolean) => {
      setAuxContextBudgetOn(next);
      setAuxContextBudgetEnabled(next);
      addToast(next ? '副 API 上下文防爆保护已开启' : '副 API 上下文防爆保护已关闭', 'success');
  };

  const fetchModels = async (
      target: 'main' | 'aux',
      url: string,
      key: string,
      currentModel: string,
      setModel: (model: string) => void,
      setStatus: (msg: string) => void,
  ) => {
    if (!url.trim()) { setStatus('请先填写 Base URL'); return; }
    setLoadingModelTarget(target);
    setStatus(target === 'aux' ? '正在拉取副 API 模型…' : '正在拉取主 API 模型…');
    try {
        const models = await fetchModelList(
            { baseUrl: url, apiKey: key },
            { meta: makeApiUsageMeta(target === 'aux' ? 'settings.auxApi.fetchModels' : 'settings.mainApi.fetchModels', { apiRole: target }) },
        );
        if (models.length > 0) {
            if (target === 'aux') {
                setAuxAvailableModels(models);
                localStorage.setItem(AUX_MODELS_STORAGE_KEY, JSON.stringify(models));
            } else {
                setAvailableModels(models);
            }
            if (models.length > 0 && !models.includes(currentModel)) setModel(models[0]);
            setStatus('');
            addToast(`已拉取 ${models.length} 个模型，请保存${target === 'aux' ? '副 API' : '主 API'}`, 'success');
            openModelPicker(target);
        } else {
            setStatus('模型列表格式不兼容');
        }
    } catch (error: any) {
        setStatus(`拉取失败：${error?.message || '请检查地址和密钥'}；也可以先手动输入模型名并保存`);
    } finally {
        setLoadingModelTarget(null);
    }
  };

  const handleExport = async (mode: 'text_only' | 'media_only' | 'full') => {
      try {
          // Trigger export (Context handles loading state UI)
          const blob = await exportSystem(mode);
          
          if (Capacitor.isNativePlatform()) {
              // Convert Blob to Base64 for Native Write
              const reader = new FileReader();
              reader.readAsDataURL(blob);
              reader.onloadend = async () => {
                  const base64data = String(reader.result);
                  const fileName = `Moro_Backup_${mode}_${Date.now()}.zip`;
                  
                  try {
                      await Filesystem.writeFile({
                          path: fileName,
                          data: base64data, // Filesystem accepts data urls? Or need strip prefix
                          directory: Directory.Cache,
                      });
                      const uriResult = await Filesystem.getUri({
                          directory: Directory.Cache,
                          path: fileName,
                      });
                      await Share.share({
                          title: `Moro Backup`,
                          files: [uriResult.uri],
                      });
                  } catch (e) {
                      console.error("Native write failed", e);
                      addToast("文件保存失败", "error");
                  }
              };
          } else {
              // Web Download
              const url = URL.createObjectURL(blob);
              setDownloadUrl(url);
              setShowExportModal(true);
              
              // Auto click
              const a = document.createElement('a');
              a.href = url;
              a.download = `Moro_Backup_${mode}_${new Date().toISOString().slice(0,10)}.zip`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
          }
      } catch (e: any) {
          addToast(e.message, 'error');
      }
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Pass the File object directly to importSystem
      importSystem(file).catch(err => {
          console.error(err);
          const details = err?.stack || err?.message || String(err || '未知错误');
          showError('导入失败', details);
          addToast('导入失败，已打开错误详情', 'error');
      });
      
      if (importInputRef.current) importInputRef.current.value = '';
  };

  // Cloud Backup Handlers
  const handleTestCloudConnection = async () => {
      setCloudTesting(true);
      setCloudTestResult('');
      try {
          const { testConnection } = await import('../utils/webdavClient');
          const tempConfig = { ...cloudBackupConfig, webdavUrl: cbUrl, username: cbUsername, password: cbPassword, remotePath: cbPath };
          const result = await testConnection(tempConfig);
          setCloudTestResult(result.ok ? `✓ ${result.message}` : `✗ ${result.message}`);
      } catch (e: any) {
          setCloudTestResult(`✗ ${e.message}`);
      }
      setCloudTesting(false);
  };

  const handleSaveCloudConfig = () => {
      updateCloudBackupConfig({
          enabled: true,
          provider: 'webdav',
          webdavUrl: cbUrl, username: cbUsername, password: cbPassword,
          remotePath: cbPath,
      });
      addToast('WebDAV 备份配置已保存', 'success');
      setShowCloudModal(false);
  };

  const handleCloudBackup = async (mode: 'text_only' | 'full') => {
      try { await cloudBackupToWebDAV(mode); } catch { /* toast handled in context */ }
  };

  const handleOpenCloudRestore = async () => {
      setShowCloudRestoreModal(true);
      setCloudBackupFiles([]);
      try {
          const files = await listCloudBackups();
          setCloudBackupFiles(files);
      } catch { addToast('云端备份列表获取失败', 'error'); }
  };

  const handleCloudRestore = async (file: import('../types').CloudBackupFile) => {
      setShowCloudRestoreModal(false);
      try {
          await cloudRestoreFromWebDAV(file);
      } catch (err: any) {
          const details = err?.stack || err?.message || String(err || '未知错误');
          showError('云端恢复失败', details);
      }
  };

  // GitHub backup handlers — single "测试并连接" button does verify-token +
  // ensure-repo, persists owner/login on success so users never type 'owner'.
  const handleTestGithub = async () => {
      if (!ghToken.trim()) { setGhTestResult('✗ 请先粘贴 Token'); return; }
      setGhTesting(true);
      setGhTestResult('');
      try {
          const { testConnection } = await import('../utils/githubClient');
          const result = await testConnection({
              ...cloudBackupConfig,
              githubToken: ghToken.trim(),
              githubRepo: ghRepo.trim() || 'moro-backup',
              githubUseProxy: ghUseProxy,
          });
          setGhTestResult(result.ok ? `✓ ${result.message}` : `✗ ${result.message}`);
          if (result.ok && result.login) {
              updateCloudBackupConfig({
                  enabled: true,
                  provider: 'github',
                  githubToken: ghToken.trim(),
                  githubOwner: result.login,
                  githubRepo: ghRepo.trim() || 'moro-backup',
                  githubUseProxy: ghUseProxy,
              });
          }
      } catch (e: any) {
          setGhTestResult(`✗ ${e?.message || '连接失败'}`);
      }
      setGhTesting(false);
  };

  const handleDisableCloud = () => {
      updateCloudBackupConfig({ enabled: false });
      setShowCloudModal(false);
      setShowGithubModal(false);
      addToast('云端备份已关闭', 'info');
  };

  // One-click provider switch — if the target provider was already configured
  // before, just flip the 'provider' field and show a toast. Otherwise open
  // the setup modal. Critically: switching does NOT touch the other side's
  // saved credentials, so old WebDAV users keep their old backups visible
  // when they switch back.
  const switchToGithub = () => {
      if (cloudBackupConfig.githubToken && cloudBackupConfig.githubOwner) {
          updateCloudBackupConfig({ provider: 'github' });
          addToast(`已切换到 GitHub 备份 @${cloudBackupConfig.githubOwner}`, 'success');
      } else {
          setShowGithubModal(true);
      }
  };
  const switchToWebDAV = () => {
      if (cloudBackupConfig.webdavUrl && cloudBackupConfig.username) {
          updateCloudBackupConfig({ provider: 'webdav' });
          addToast('已切换到 WebDAV 备份', 'success');
      } else {
          setShowCloudModal(true);
      }
  };

  const confirmReset = () => {
      resetSystem();
      setShowResetConfirm(false);
  };

  // 保存实时感知配置
  const handleSaveRealtimeConfig = () => {
      updateRealtimeConfig({
          weatherEnabled: rtWeatherEnabled,
          weatherMode: rtWeatherMode,
          weatherApiKey: rtWeatherKey,
          weatherCity: rtWeatherCity,
          newsEnabled: rtNewsEnabled,
          newsApiKey: rtNewsApiKey,
          newsPlatforms: rtNewsPlatforms,
          notionEnabled: rtNotionEnabled,
          notionApiKey: rtNotionKey,
          notionDatabaseId: rtNotionDbId,
          notionNotesDatabaseId: rtNotionNotesDbId || undefined,
          feishuEnabled: rtFeishuEnabled,
          feishuAppId: rtFeishuAppId,
          feishuAppSecret: rtFeishuAppSecret,
          feishuBaseId: rtFeishuBaseId,
          feishuTableId: rtFeishuTableId,
          xhsEnabled: rtXhsEnabled,
          xhsMcpConfig: {
              enabled: rtXhsMcpEnabled,
              serverUrl: rtXhsMode === 'lite' ? XHS_LITE_URL : rtXhsLocalUrl,
              cookie: rtXhsMode === 'lite' ? (rtXhsCookie.trim() || undefined) : undefined,
              loggedInNickname: rtXhsNickname || undefined,
              loggedInUserId: rtXhsUserId || undefined,
              userXsecToken: realtimeConfig.xhsMcpConfig?.userXsecToken, // 保留自动获取的 token
          }
      });
      addToast('实时感知配置已保存', 'success');
      setShowRealtimeModal(false);
  };

  // 测试天气：走真实取数路径（geo=定位+Open-Meteo 免密钥；manual=手填城市+Open-Meteo 免密钥）
  const testWeatherApi = async () => {
      if (rtWeatherMode === 'manual' && !rtWeatherCity.trim()) {
          setRtTestStatus('自定义城市模式请先填写城市名');
          return;
      }
      setRtTestStatus(rtWeatherMode === 'geo' ? '正在获取天气…（如需更准，首次会请求定位；拒绝也会按 IP 估算）' : '正在查询自定义城市…');
      try {
          RealtimeContextManager.clearCache(); // 强制重新取，别命中缓存
          const weather = await RealtimeContextManager.fetchWeather({
              ...realtimeConfig,
              weatherEnabled: true,
              weatherMode: rtWeatherMode,
              weatherApiKey: rtWeatherKey,
              weatherCity: rtWeatherCity,
          }, { requestLocationPermission: true });
          if (weather) {
              setRtTestStatus(`看到了！${weather.city}: ${weather.description}, ${weather.temp}°C（体感 ${weather.feelsLike}°C）`);
          } else {
              setRtTestStatus(rtWeatherMode === 'geo'
                  ? '没取到天气：可能拒绝了定位授权，或网络不通。可改用自定义城市。'
                  : '没取到天气：检查城市名是否正确，城市重名或查不到时可加上省份。');
          }
      } catch (e: any) {
          setRtTestStatus(`出错了: ${e?.message || e}`);
      }
  };

  // 测试Notion连接
  const testNotionApi = async () => {
      if (!rtNotionKey || !rtNotionDbId) {
          setRtTestStatus('请填写 Notion API Key 和 Database ID');
          return;
      }
      setRtTestStatus('正在测试 Notion 连接...');
      try {
          const result = await NotionManager.testConnection(rtNotionKey, rtNotionDbId);
          setRtTestStatus(result.message);
      } catch (e: any) {
          setRtTestStatus(`网络错误: ${e.message}`);
      }
  };

  // 测试飞书连接
  const testFeishuApi = async () => {
      if (!rtFeishuAppId || !rtFeishuAppSecret || !rtFeishuBaseId || !rtFeishuTableId) {
          setRtTestStatus('请填写飞书 App ID、App Secret、多维表格 ID 和数据表 ID');
          return;
      }
      setRtTestStatus('正在测试飞书连接...');
      try {
          const result = await FeishuManager.testConnection(rtFeishuAppId, rtFeishuAppSecret, rtFeishuBaseId, rtFeishuTableId);
          setRtTestStatus(result.message);
      } catch (e: any) {
          setRtTestStatus(`网络错误: ${e.message}`);
      }
  };

  // 测试小红书 Bridge 连接
  const testXhsMcp = async () => {
      const urlToUse = rtXhsMode === 'lite' ? XHS_LITE_URL : rtXhsLocalUrl;
      const cookieToUse = rtXhsMode === 'lite' ? (rtXhsCookie.trim() || undefined) : undefined;
      if (!urlToUse) {
          setRtTestStatus('请填写服务器 URL');
          return;
      }
      if (rtXhsMode === 'lite' && !cookieToUse) {
          setRtTestStatus('请先粘贴小红书 cookie');
          return;
      }
      setRtTestStatus('正在连接...');
      try {
          const result = await XhsMcpClient.testConnection(urlToUse, cookieToUse);
          if (result.connected) {
              const toolCount = result.tools?.length || 0;
              const tokenInfo = result.xsecToken ? ' | xsecToken 已获取' : '';
              const loginInfo = result.loggedIn
                  ? ` | ${result.nickname ? `账号: ${result.nickname}` : '已登录'}${result.userId ? ` (ID: ${result.userId})` : ''}${tokenInfo}`
                  : ' | 未登录，请检查 cookie 或登录小红书';
              setRtTestStatus(`连接成功! ${toolCount} 个功能可用${loginInfo}`);
              // 自动填充：只在用户未手动填写时覆盖
              if (result.nickname && !rtXhsNickname) setRtXhsNickname(result.nickname);
              if (result.userId && !rtXhsUserId) setRtXhsUserId(result.userId);
              updateRealtimeConfig({
                  xhsMcpConfig: {
                      enabled: rtXhsMcpEnabled,
                      serverUrl: urlToUse,
                      cookie: cookieToUse,
                      loggedInNickname: rtXhsNickname || result.nickname,
                      loggedInUserId: rtXhsUserId || result.userId,
                      userXsecToken: result.xsecToken,
                  }
              });
          } else {
              setRtTestStatus(`连接失败: ${result.error}`);
          }
      } catch (e: any) {
          setRtTestStatus(`网络错误: ${e.message}`);
      }
  };

  // 麦当劳 MCP: 改 token / 启用态都即时落 localStorage; "测试连接"调 initialize+tools/list
  const handleMcdTokenChange = (v: string) => {
      setMcdTokenState(v);
      saveMcdToken(v);
      resetMcdSession();
      setMcdTestStatus('');
  };
  const handleMcdEnabledChange = (v: boolean) => {
      setMcdEnabledState(v);
      saveMcdEnabled(v);
      if (!v) resetMcdSession();
  };
  const testMcdApi = async () => {
      if (!mcdToken.trim()) { setMcdTestStatus('请先填写 MCP Token'); return; }
      setMcdTesting(true);
      setMcdTestStatus('正在连接麦当劳 MCP...');
      try {
          const r = await testMcdConnection();
          if (r.ok) {
              const names = (r.tools || []).map(t => t.name).slice(0, 6).join(', ');
              setMcdTestStatus(`✅ ${r.message}${names ? `\n工具: ${names}${(r.tools || []).length > 6 ? ' ...' : ''}` : ''}`);
          } else {
              setMcdTestStatus(`❌ ${r.message}`);
          }
      } catch (e: any) {
          setMcdTestStatus(`❌ ${e?.message || String(e)}`);
      } finally {
          setMcdTesting(false);
      }
  };

  const jumpToSettingsGroup = (id: string) => {
      if (typeof document === 'undefined') return;
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  useManualDeepLink(AppID.Settings, useCallback((target) => {
      const route = String(target.route || '');
      const groupId = route === 'group:backup' ? 'settings-backup'
          : route === 'group:api' ? 'settings-api'
          : route === 'group:live' ? 'settings-live'
          : 'settings-basic';
      jumpToSettingsGroup(groupId);
      window.setTimeout(() => {
          if (!scrollToManualAnchor(target.anchorId)) scrollToManualAnchor(groupId);
      }, 180);
  }, []), { enabled: activeApp === AppID.Settings });

  const openApiErrorManualHelp = useCallback((help: ApiErrorHelp) => {
      setShowApiCallLog(false);
      queueManualDeepLink({
          appId: AppID.Manual,
          route: 'guide',
          anchorId: help.manualAnchorId,
          payload: { app: '文具盒', view: 'detail', settingId: help.manualSettingId },
      });
      openApp(AppID.Manual);
  }, [openApp]);

  return (
    <div ref={settingsRootRef} className="settings-polaroid h-full w-full bg-[#f6f6f2] flex min-h-0 flex-col relative text-[#2f3437]" style={DOT_BG}>
      <style>{POLAROID_SCOPE_CSS}</style>

      {/* GLOBAL PROGRESS OVERLAY */}
      {sysOperation.status === 'processing' && (
          <div className="absolute inset-0 z-50 bg-[#2f3437]/34 backdrop-blur-[2px] flex items-center justify-center animate-fade-in">
              <div className="relative bg-white border border-[#e7e1d6] rounded-[22px] p-6 flex flex-col items-center gap-4 w-64" style={{ ...DOT_BG, boxShadow: CARD_SHADOW }}>
                  <Tape className="-top-2 left-1/2 -translate-x-1/2" />
                  <div className="w-12 h-12 border-4 border-[#e7e1d6] border-t-[#7fa8b3] rounded-full animate-spin"></div>
                  <div className="text-sm font-bold text-[#2f3437] text-center leading-relaxed whitespace-pre-wrap break-words max-w-full">{sysOperation.message}</div>
                  {sysOperation.progress > 0 && (
                      <div className="w-full h-2 bg-white border border-[#e7e1d6] rounded-full overflow-hidden">
                          <div className="h-full bg-[#7fa8b3] transition-all duration-300" style={{ width: `${sysOperation.progress}%` }}></div>
                      </div>
                  )}
              </div>
          </div>
      )}

      {/* 顶栏 */}
      <div className="shrink-0 z-10 sticky top-0 px-4 pt-3 pb-3 bg-white/88 backdrop-blur-md border-b border-[#eee9df]">
        <div className="flex items-center gap-3">
            <button
                onClick={closeApp}
                className={`shrink-0 px-2.5 py-2 flex items-center gap-1 ${STICKER}`}
                title="关闭设置"
            >
                <svg viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth={2.5} className="w-3.5 h-3.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
                </svg>
                <span className="text-[10px] font-black">返回</span>
            </button>
            <div className="flex-1 min-w-0 relative">
                <Tape className="-top-4 left-6 w-12" />
                <div className="label-mono text-[8px] text-[#8a918d]">SETTINGS · SYSTEM CONFIG</div>
                <div className="flex items-baseline gap-2">
                    <h1 className="text-2xl font-black tracking-[0.08em] text-[#2f3437]">文具盒</h1>
                    <span className="text-sm text-[#69716d] truncate" style={HAND_CN}>设置、接口、备份、通知</span>
                </div>
            </div>
        </div>
      </div>

      <div ref={settingsScrollRef} className="settings-polaroid-scroll flex-1 min-h-0 overflow-y-auto p-5 space-y-8 no-scrollbar pb-20">

        <section data-manual-anchor="manual-settings-root" className="relative overflow-hidden bg-white/92 border border-[#eee9df] rounded-[18px] p-4 pt-5" style={{ boxShadow: CARD_SHADOW }}>
            <Tape className="-top-2 left-8" />
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
                <div>
                    <div className="label-mono text-[8px] text-[#8a918d]">SETTINGS OVERVIEW</div>
                    <h2 className="text-lg font-black text-[#2f3437] tracking-wide">配置总览</h2>
                    <p className="text-[11px] text-[#69716d] mt-1 leading-relaxed">查看关键状态，并快速跳到对应配置区。</p>
                </div>
                <div className="flex gap-2 overflow-x-auto no-scrollbar pb-0.5">
                    <JumpButton label="基础" target="settings-basic" onJump={jumpToSettingsGroup} />
                    <JumpButton label="备份" target="settings-backup" onJump={jumpToSettingsGroup} />
                    <JumpButton label="API" target="settings-api" onJump={jumpToSettingsGroup} />
                    <JumpButton label="通知" target="settings-live" onJump={jumpToSettingsGroup} />
                </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mt-4">
                <StatusTile label="MAIN API" value={localModel || '未选择模型'} detail={localUrl ? `${availableModels.length || 0} 个已缓存模型` : '未填写地址'} active={!!localUrl.trim() && !!localModel.trim()} />
                <StatusTile label="AUX API" value={localAuxEnabled ? '已开启' : '已关闭'} detail={localAuxModel || `${auxAvailableModels.length || 0} 个已缓存模型`} active={localAuxEnabled && !!localAuxUrl.trim() && !!localAuxModel.trim()} />
                <StatusTile label="BACKUP" value={cloudBackupConfig.enabled ? '云端已启用' : '仅本地'} detail={cloudBackupConfig.enabled ? (cloudBackupConfig.provider || 'cloud').toUpperCase() : '可导出 ZIP'} active={cloudBackupConfig.enabled} />
                <StatusTile label="NOTIFY" value={notifyPerm === 'granted' ? '通知已授权' : notifyPerm === 'denied' ? '通知被拒绝' : '通知未授权'} detail={isPushVapidReady() ? 'VAPID 已配置' : 'VAPID 未配置'} active={notifyPerm === 'granted'} />
            </div>
        </section>

        <SettingsGroup id="settings-basic" eyebrow="01 / DEVICE" title="基础与安全" desc="控制界面显示、锁屏密码和本机数据导入导出。">
            {/* 界面全屏（沉浸式铺满屏幕） */}
            <div data-manual-anchor="manual-settings-fullscreen"><FullscreenCard addToast={addToast} /></div>
            <div data-manual-anchor="manual-settings-statusbar"><TopStatusBarCard hidden={!!theme.hideStatusBar} onChange={(hidden) => updateTheme({ hideStatusBar: hidden })} /></div>

            {nativeAppInfo?.native && (
                <SectionCard
                    manualAnchor="manual-settings-update"
                    tag="UPDATE"
                    title="应用更新"
                    hand="检查并安装开发者发布的新版本。"
                    rotate="rotate-[0.4deg]"
                    right={<StatusBadge active={!!apkUpdateCheck?.updateAvailable} activeText="有新版" inactiveText="已就绪" />}
                >
                    <div className="space-y-4">
                        <div className="rounded-[14px] border border-[#e7e1d6] bg-white px-3 py-2.5">
                            <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-[11px] font-black text-[#2f3437]">当前安装包</p>
                                    <p className="text-[10px] text-[#69716d] font-mono truncate">
                                        {nativeAppInfo?.native ? `${nativeAppInfo.versionName || '?'} · code ${nativeAppInfo.versionCode || 0}` : '网页版 / 未进入 Android App'}
                                    </p>
                                </div>
                                {nativeAppInfo?.native && !nativeAppInfo.canRequestPackageInstalls && (
                                    <button type="button" onClick={handleOpenInstallPermission} className={`shrink-0 px-2.5 py-1.5 text-[10px] font-black ${STICKER}`}>
                                        安装权限
                                    </button>
                                )}
                            </div>
                            <p className="text-[10px] text-[#69716d] mt-2 leading-relaxed">
                                有新版本时会下载安装包并打开 Android 系统安装器，仍需你手动确认安装。
                            </p>
                        </div>

                        <div className={`grid gap-3 ${apkUpdateCheck?.latest.domesticApkUrl ? 'grid-cols-2 md:grid-cols-3' : 'grid-cols-2'}`}>
                            <button
                                type="button"
                                disabled={apkUpdateBusy}
                                onClick={handleCheckApkUpdate}
                                className={`py-2.5 text-xs font-black disabled:opacity-40 ${STICKER}`}
                            >
                                {apkUpdateBusy && !apkDownloadProgress ? '检查中...' : '检查更新'}
                            </button>
                            <button
                                type="button"
                                disabled={apkUpdateBusy || !apkUpdateCheck?.updateAvailable}
                                onClick={() => handleDownloadApkUpdate(false)}
                                className={`py-2.5 text-xs font-black disabled:opacity-40 ${apkUpdateCheck?.updateAvailable ? INK_BTN : STICKER}`}
                            >
                                下载新版
                            </button>
                            {apkUpdateCheck?.latest.domesticApkUrl && (
                                <button
                                    type="button"
                                    disabled={apkUpdateBusy || !apkUpdateCheck?.updateAvailable}
                                    onClick={() => handleDownloadApkUpdate(true)}
                                    className={`py-2.5 text-xs font-black disabled:opacity-40 ${apkUpdateCheck?.updateAvailable ? INK_BTN : STICKER}`}
                                >
                                    国内线路
                                </button>
                            )}
                        </div>

                        {(apkUpdateStatus || apkUpdateCheck?.latest) && (
                            <div className="rounded-[14px] border border-[#dce8ea] bg-[#f3f7f6] p-3 text-[11px] text-[#2f3437] leading-relaxed">
                                {apkUpdateStatus && <p className="font-bold">{apkUpdateStatus}</p>}
                                {apkDownloadProgress && apkDownloadProgress.status === 'downloading' && (
                                    <div className="mt-2 h-2 rounded-full bg-white border border-[#e7e1d6] overflow-hidden">
                                        <div className="h-full bg-[#7fa8b3] transition-all" style={{ width: `${Math.round(apkDownloadProgress.progress * 100)}%` }} />
                                    </div>
                                )}
                                {apkUpdateCheck?.latest.releaseNotes && (
                                    <p className="mt-2 whitespace-pre-wrap text-[#69716d]">{apkUpdateCheck.latest.releaseNotes}</p>
                                )}
                            </div>
                        )}
                    </div>
                </SectionCard>
            )}

            {/* 锁屏与密码 */}
            <SectionCard manualAnchor="manual-settings-lock" tag="LOCK" title="锁屏与密码" hand="设置进入应用时的 4 位密码" rotate="rotate-[-0.5deg]">
            <div className="flex items-center justify-between mb-2 gap-3">
                <div>
                    <div className="text-xs font-bold text-[#26242a]">锁屏密码</div>
                    <p className="text-[10px] text-[#26242a]/55 mt-0.5">开启后，解锁需要输入 4 位数字密码（默认 {DEFAULT_LOCK_PASSCODE}）；关闭后点按即可进入。</p>
                </div>
                <InkSwitch
                    on={lockPassEnabled}
                    onChange={(next) => {
                        setLockPassEnabled(next);
                        setLockPasscodeEnabled(next);
                        addToast(next ? '锁屏密码已启用' : '锁屏密码已关闭', 'success');
                    }}
                />
            </div>

            {lockPassEnabled && (
                <div className="mt-3 border-2 border-dashed border-[#1c1b1a]/30 p-3 space-y-2.5">
                    <div>
                        <label className={LABEL}>OLD CODE · 当前密码</label>
                        <input
                            type="password" inputMode="numeric" maxLength={4}
                            value={lockPassCurrent}
                            onChange={e => setLockPassCurrent(e.target.value.replace(/\D/g, ''))}
                            placeholder="输入当前 4 位密码"
                            className={FIELD}
                        />
                    </div>
                    <div>
                        <label className={LABEL}>NEW CODE · 新密码</label>
                        <input
                            type="password" inputMode="numeric" maxLength={4}
                            value={lockPassNew}
                            onChange={e => setLockPassNew(e.target.value.replace(/\D/g, ''))}
                            placeholder="输入新的 4 位数字"
                            className={FIELD}
                        />
                    </div>
                    <button
                        onClick={() => {
                            if (lockPassCurrent !== getLockPasscode()) { addToast('当前密码不正确', 'error'); return; }
                            if (!/^\d{4}$/.test(lockPassNew)) { addToast('新密码必须是 4 位数字', 'error'); return; }
                            setLockPasscode(lockPassNew);
                            setLockPassCurrent('');
                            setLockPassNew('');
                            addToast('锁屏密码已更新', 'success');
                        }}
                        className={`w-full py-2.5 text-xs font-black ${INK_BTN}`}
                    >
                        更新密码
                    </button>
                </div>
            )}
            </SectionCard>
        </SettingsGroup>

        <SettingsGroup id="settings-backup" eyebrow="02 / BACKUP" title="备份与恢复" desc="本地 ZIP、云端备份和恢复操作集中在这里。">
            {/* 本地备份与恢复 */}
            <SectionCard manualAnchor="manual-settings-local-backup" tag="LOCAL BACKUP" title="本地备份（ZIP）" hand="导出或导入本机数据" rotate="rotate-[0.4deg]">
            <div className="mb-3">
                <button onClick={() => handleExport('full')} className={`w-full py-4 text-xs font-black flex flex-col items-center gap-2 relative ${INK_BTN}`}>
                    <span className="absolute top-0 right-0 px-1.5 py-0.5 label-mono text-[8px] bg-white text-[#26242a]">FULL</span>
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0-3-3m3 3 3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" /></svg>
                    <span>导出完整备份（文字 + 媒体）</span>
                </button>
            </div>

            <p className="text-[10px] text-[#26242a]/50 px-1 mb-3 text-center" style={HAND_CN}>可按内容类型分别导出，降低文件体积</p>

            <div className="grid grid-cols-2 gap-3 mb-3">
                <button onClick={() => handleExport('text_only')} className={`py-4 text-xs font-bold text-[#26242a] flex flex-col items-center gap-2 rotate-[-0.6deg] ${STICKER}`}>
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke={INK} className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
                    <span>导出文字数据</span>
                </button>
                 <button onClick={() => handleExport('media_only')} className={`py-4 text-xs font-bold text-[#26242a] flex flex-col items-center gap-2 rotate-[0.6deg] ${STICKER}`}>
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke={INK} className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" /></svg>
                    <span>导出媒体与外观</span>
                </button>
            </div>

            <div className="grid grid-cols-1 gap-3 mb-4">
                 <div onClick={() => importInputRef.current?.click()} className={`py-4 text-xs font-bold text-[#26242a] flex flex-col items-center gap-2 cursor-pointer border-dashed ${STICKER}`}>
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke={INK} className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                    <span>导入备份 (.zip / .json)</span>
                </div>
                <input type="file" ref={importInputRef} className="hidden" accept=".json,.zip" onChange={handleImport} />
            </div>

            <p className="text-[10px] text-[#26242a]/55 px-1 mb-4 leading-relaxed border-l-2 border-[#1c1b1a]/20 pl-2">
                • <b>完整备份</b>：导出文字数据与媒体资源，适合迁移设备。<br/>
                • <b>文字数据</b>：聊天记录、角色设定、剧情数据等，不包含图片。<br/>
                • <b>媒体与外观</b>：相册、表情包、聊天图片、头像、主题气泡、壁纸、图标等资源。<br/>
                • 支持导入旧版 JSON 备份。
            </p>

            <button onClick={() => setShowResetConfirm(true)} className={`w-full py-3 text-xs font-black flex items-center justify-center gap-2 ${STICKER}`}>
                <span className="line-through decoration-2">清空全部数据</span>
                <span className="label-mono text-[8px] text-[#26242a]/55">FACTORY RESET</span>
            </button>
            </SectionCard>

            {/* 云端备份 */}
            <SectionCard manualAnchor="manual-settings-cloud-backup" tag="CLOUD BACKUP" title="云端备份" hand="把备份保存到你自己的云端账号" rotate="rotate-[-0.4deg]">
            {!cloudBackupConfig.enabled ? (
                <div className="space-y-3 py-2">
                    <p className="text-[11px] text-[#26242a]/60 leading-relaxed text-center">
                        备份保存到你自己的云端账号，便于换设备或恢复数据。<br/>
                        国内推荐 <b>GitHub</b>（可直连，2GB/份）。
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                        <button
                            onClick={() => setShowGithubModal(true)}
                            className={`py-3 px-2 text-xs font-black flex flex-col items-center gap-1.5 relative rotate-[-0.8deg] ${INK_BTN}`}
                        >
                            <span className="absolute -top-2 -right-1.5 label-mono text-[8px] bg-white text-[#26242a] border border-black/10 rounded-xl px-1.5 py-0.5 rotate-[3deg]">推荐</span>
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.203 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0022 12.017C22 6.484 17.522 2 12 2z" /></svg>
                            <span>GitHub</span>
                            <span className="label-mono text-[8px] text-white/70 font-normal">可直连 · 2GB</span>
                        </button>
                        <button
                            onClick={() => setShowCloudModal(true)}
                            className={`py-3 px-2 text-xs font-black text-[#26242a] flex flex-col items-center gap-1.5 rotate-[0.8deg] ${STICKER}`}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke={INK} className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" /></svg>
                            <span>WebDAV</span>
                            <span className="label-mono text-[8px] text-[#26242a]/55 font-normal">日本/NAS · 需代理</span>
                        </button>
                    </div>
                </div>
            ) : (
                <div className="space-y-3">
                    <div className="flex items-center justify-between px-3 py-2 border-2 border-dashed border-[#1c1b1a]/40">
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-[#1c1b1a] animate-pulse" />
                            <span className="text-[11px] text-[#26242a] font-bold">
                                已连接 · {cloudBackupConfig.provider === 'github'
                                    ? `GitHub${cloudBackupConfig.githubOwner ? ` (@${cloudBackupConfig.githubOwner})` : ''}`
                                    : 'WebDAV'}
                            </span>
                        </div>
                        <button
                            onClick={() => cloudBackupConfig.provider === 'github' ? setShowGithubModal(true) : setShowCloudModal(true)}
                            className="text-[10px] font-bold text-[#26242a] underline underline-offset-2"
                        >
                            修改配置
                        </button>
                    </div>

                    {/* Quick link to the GitHub releases page so the user knows
                        where their backups physically live and can browse /
                        delete them on github.com directly if they want. */}
                    {cloudBackupConfig.provider === 'github' && cloudBackupConfig.githubOwner && (
                        <a
                            href={`https://github.com/${cloudBackupConfig.githubOwner}/${cloudBackupConfig.githubRepo || 'moro-backup'}/releases`}
                            target="_blank" rel="noopener noreferrer"
                            className="block text-center text-[10px] text-[#26242a]/60 hover:text-[#26242a] underline-offset-2 hover:underline transition-colors"
                        >
                            打开 GitHub 备份列表 (github.com/{cloudBackupConfig.githubOwner}/{cloudBackupConfig.githubRepo || 'moro-backup'}/releases) ↗
                        </a>
                    )}

                    {/* Switch-provider hint — shown to existing users so the
                        new GitHub option is discoverable from the connected
                        state, not only on the first-time setup screen. If the
                        other provider was previously configured, the click is
                        a one-shot flip; old credentials and backups stay put. */}
                    {cloudBackupConfig.provider !== 'github' ? (
                        <>
                            <button
                                onClick={switchToGithub}
                                className={`w-full py-2 text-[11px] font-black flex items-center justify-center gap-2 ${INK_BTN}`}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5"><path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.203 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0022 12.017C22 6.484 17.522 2 12 2z" /></svg>
                                <span>{cloudBackupConfig.githubToken ? '切换到 GitHub' : '配置 GitHub 备份（可直连 · 2GB/份）'}</span>
                            </button>
                            <p className="text-[10px] text-[#26242a]/50 text-center" style={HAND_CN}>
                                切换服务不会删除 WebDAV 上已有的备份
                            </p>
                        </>
                    ) : (
                        <button
                            onClick={switchToWebDAV}
                            className="w-full py-1.5 text-[10px] text-[#26242a]/50 hover:text-[#26242a] underline underline-offset-2 transition-colors"
                        >
                            {cloudBackupConfig.webdavUrl ? '切换到 WebDAV →' : '配置 WebDAV →'}
                        </button>
                    )}
                    {cloudBackupConfig.lastBackupTime && (
                        <p className="text-[10px] text-[#26242a]/50 text-center label-mono">
                            上次备份: {new Date(cloudBackupConfig.lastBackupTime).toLocaleString('zh-CN')}
                            {cloudBackupConfig.lastBackupSize && ` (${(cloudBackupConfig.lastBackupSize / 1024 / 1024).toFixed(1)} MB)`}
                        </p>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                        <button
                            onClick={() => handleCloudBackup('text_only')}
                            className={`py-3 text-xs font-bold text-[#26242a] flex flex-col items-center gap-1 rotate-[-0.5deg] ${STICKER}`}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke={INK} className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" /></svg>
                            <span>上传文字备份</span>
                            <span className="label-mono text-[8px] text-[#26242a]/55">纯文字</span>
                        </button>
                        <button
                            onClick={() => handleCloudBackup('full')}
                            className={`py-3 text-xs font-bold text-[#26242a] flex flex-col items-center gap-1 rotate-[0.5deg] ${STICKER}`}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke={INK} className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" /></svg>
                            <span>上传完整备份</span>
                            <span className="label-mono text-[8px] text-[#26242a]/55">完整</span>
                        </button>
                    </div>

                    <button
                        onClick={handleOpenCloudRestore}
                        className={`w-full py-3 text-xs font-bold text-[#26242a] flex items-center justify-center gap-2 ${STICKER}`}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke={INK} className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9.75v6.75m0 0l-3-3m3 3l3-3m-8.25 6a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" /></svg>
                        从云端恢复
                    </button>
                </div>
            )}

            <p className="text-[10px] text-[#26242a]/50 px-1 mt-3 leading-relaxed">
                备份文件保存在你的账号下，凭据只存本机，不上传到 Moro 服务器。
            </p>
            </SectionCard>
        </SettingsGroup>

        <SettingsGroup id="settings-api" eyebrow="03 / API" title="模型与服务" desc="主 API 负责聊天回复；副 API 负责总结、生活侧写、记忆整理等辅助任务。">
            {/* 主 API 配置 */}
            <SectionCard
            manualAnchor="manual-settings-main-api"
            tag="CHAT API"
            title="主 API"
            hand="用于私聊、群聊、电话等核心对话生成。"
            right={
                <button onClick={() => setShowPresetModal(true)} className={`shrink-0 text-[10px] font-black px-2.5 py-1.5 ${STICKER}`}>
                    保存为预设
                </button>
            }
        >
            {/* Presets List */}
            {apiPresets.length > 0 && (
                <div className="mb-4">
                    <label className={LABEL}>PRESETS · 已保存接口</label>
                    <div className="flex gap-2 flex-wrap">
                        {apiPresets.map(preset => (
                            <div key={preset.id} className={`flex items-center pl-3 pr-1 py-1 ${STICKER}`}>
                                <span onClick={() => loadPreset(preset)} className="text-xs font-bold text-[#26242a] cursor-pointer mr-2">{preset.name}</span>
                                <button onClick={() => removeApiPreset(preset.id)} className="p-1 text-[#26242a]/40 hover:text-[#26242a] transition-colors" title="删除这个预设">
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3"><path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" /></svg>
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

                <div className="space-y-4">
                <div className="group">
                    <label className={LABEL}>BASE URL · 接口地址</label>
                    <input type="text" value={localUrl} onChange={(e) => setLocalUrl(e.target.value)} placeholder="https://your-api.example.com/v1" className={`${FIELD} font-mono`} />
                </div>

                <div className="group">
                    <label className={LABEL}>API KEY · 密钥</label>
                    <input type="password" value={localKey} onChange={(e) => setLocalKey(e.target.value)} placeholder="输入 API Key" className={`${FIELD} font-mono`} />
                </div>

                <div className="rounded-[16px] border border-[#e7e1d6] bg-[#fffdf8] px-3 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <div className="text-[11px] font-black text-[#2f3437]">上下文防爆保护</div>
                        <p className="text-[10px] text-[#69716d] mt-0.5 leading-relaxed">
                            开启时，发送前会自动压缩旧图片和过大的旧上下文，避免模型返回 token 上限 400。
                        </p>
                    </div>
                    <InkSwitch on={mainContextBudgetOn} onChange={handleMainContextBudgetToggle} title="上下文防爆保护" />
                </div>

                {/* 高级（流式 / 温度）— 默认折叠，灰色低调 */}
                <div className="pt-1">
                    <button
                        type="button"
                        onClick={() => setShowApiAdvanced(v => !v)}
                        className="text-[10px] text-[#26242a]/40 hover:text-[#26242a]/60 transition-colors flex items-center gap-1 pl-1 active:scale-95"
                    >
                        <span>高级参数</span>
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={`w-2.5 h-2.5 transition-transform ${showApiAdvanced ? 'rotate-180' : ''}`}>
                            <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                        </svg>
                    </button>
                    {showApiAdvanced && (
                        <div className="mt-2 pl-2 border-l-2 border-[#1c1b1a]/20 space-y-3 py-2">
                            {presetTakeoverName && (
                                <div className="border-2 border-dashed border-[#1c1b1a]/40 px-3 py-2 text-[10px] text-[#26242a]/70 leading-relaxed">
                                    采样参数当前由预设「{presetTakeoverName}」接管（温度等以预设 App 配置为准）。
                                    <button onClick={() => openApp(AppID.Presets)} className="font-bold underline ml-1">打开预设 App</button>
                                </div>
                            )}
                            <p className="text-[10px] text-[#26242a]/40 leading-relaxed">
                                默认使用流式输出；如果你的接口不兼容，关掉后会等完整回复再显示。
                            </p>
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <span className="text-[10px] text-[#26242a]/60 font-bold">流式输出 (Stream)</span>
                                    <p className="text-[9px] text-[#26242a]/40 mt-0.5">默认开启；遇到半路断开、乱码或空白时可关闭</p>
                                </div>
                                <InkSwitch on={localStream} onChange={() => setLocalStream(v => !v)} />
                            </div>
                            <div>
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] text-[#26242a]/60 font-bold">温度 (Temperature)</span>
                                    <span className="label-mono text-[10px] text-[#26242a]/60">{localTemperature.toFixed(2)}</span>
                                </div>
                                <input
                                    type="range"
                                    min="0"
                                    max="2"
                                    step="0.05"
                                    value={localTemperature}
                                    onChange={(e) => setLocalTemperature(parseFloat(e.target.value))}
                                    className="w-full accent-[#1c1b1a] mt-1"
                                />
                                <p className="text-[9px] text-[#26242a]/40 mt-0.5">默认 0.85；只作用于聊天和约会的主回复</p>
                            </div>
                        </div>
                    )}
                </div>

                    <div className="pt-2">
                     <div className="flex justify-between items-center mb-1.5 pl-1">
                        <label className={LABEL}>MODEL · 聊天模型</label>
                        <button
                            onClick={() => fetchModels('main', localUrl, localKey, localModel, setLocalModel, setStatusMsg)}
                            disabled={loadingModelTarget !== null}
                            className="text-[10px] text-[#577782] font-black underline underline-offset-2 disabled:opacity-50"
                        >
                            {loadingModelTarget === 'main' ? '正在拉取…' : availableModels.length ? `刷新模型（${availableModels.length}）` : '拉取模型'}
                        </button>
                    </div>

                    <ModelSelectButton model={localModel} placeholder="选择或手动输入模型" onClick={() => openModelPicker('main')} />
                </div>

                <button onClick={handleSaveApi} className={`w-full py-3 font-black mt-2 ${INK_BTN}`}>
                    {statusMsg || '保存主 API'}
                </button>

                <button
                    onClick={async () => {
                        if (!localUrl.trim() || !localModel.trim()) return;
                        setTestingApi(true);
                        setTestApiResult(null);
                        try {
                            const reply = await testChatConnection(
                                { baseUrl: localUrl.trim(), apiKey: localKey.trim(), model: localModel.trim() },
                                { stream: localStream, meta: makeApiUsageMeta('settings.mainApi.testConnection', { apiRole: 'main' }) },
                            );
                            setTestApiResult(`✅ 连接成功 — 模型回复: "${reply.slice(0, 30)}"`);
                        } catch (err: any) {
                            setTestApiResult(`❌ 连接失败: ${err.message}`);
                        } finally {
                            setTestingApi(false);
                        }
                    }}
                    disabled={testingApi || !localUrl.trim() || !localModel.trim()}
                    className={`w-full py-2.5 font-black text-sm mt-2 ${
                        testingApi || !localUrl.trim() || !localModel.trim()
                            ? 'border border-black/10 rounded-xl/20 text-[#26242a]/30 bg-white'
                            : STICKER + ' text-[#26242a]'
                    }`}
                >
                    {testingApi ? '测试中…' : '测试连接'}
                </button>

                {testApiResult && (
                    <div className={`mt-2 text-xs px-3 py-2 border-2 ${
                        testApiResult.startsWith('✅') ? 'border-[#1c1b1a] bg-white text-[#26242a]' : 'border-dashed border-[#1c1b1a]/50 bg-[#1c1b1a]/5 text-[#26242a]/80'
                    }`}>
                        {testApiResult}
                    </div>
                )}
            </div>
            </SectionCard>

            {/* 副 API 配置 */}
            <SectionCard
            manualAnchor="manual-settings-aux-api"
            tag="AUX API"
            title="副 API"
            hand="用于聊天以外的后台任务，可选择更快或更便宜的模型。"
            right={
                <button
                    onClick={() => { setLocalAuxEnabled(v => !v); }}
                    className={`shrink-0 text-[10px] font-black px-2.5 py-1.5 ${localAuxEnabled ? INK_BTN : STICKER}`}
                >
                    {localAuxEnabled ? '已开启' : '已关闭'}
                </button>
            }
        >
            <div className="space-y-4">
                <InfoNote>
                    开启后，<b>生活侧写、记忆整理、部分工具生成</b>会优先使用副 API。絮语「今日作息」和心情 buff 使用各自的日程 API / 心情 API，留空时走主 API。
                </InfoNote>

                <div className="flex items-center justify-between">
                    <label className={LABEL}>ENABLE · 启用副 API</label>
                    <InkSwitch on={localAuxEnabled} onChange={() => setLocalAuxEnabled(v => !v)} />
                </div>

                <div className="group">
                    <div className="flex items-center justify-between mb-1">
                        <label className={LABEL}>BASE URL · 接口地址</label>
                        <button onClick={handleCopyMainToAux} className="text-[10px] text-[#577782] font-black underline underline-offset-2">复制主 API</button>
                    </div>
                    <input type="text" value={localAuxUrl} onChange={(e) => setLocalAuxUrl(e.target.value)} placeholder="https://your-api.example.com/v1" className={`${FIELD} font-mono`} />
                </div>

                <div className="group">
                    <label className={LABEL}>API KEY · 密钥</label>
                    <input type="password" value={localAuxKey} onChange={(e) => setLocalAuxKey(e.target.value)} placeholder="输入 API Key" className={`${FIELD} font-mono`} />
                </div>

                <div className="rounded-[16px] border border-[#e7e1d6] bg-[#fffdf8] px-3 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <div className="text-[11px] font-black text-[#2f3437]">上下文防爆保护</div>
                        <p className="text-[10px] text-[#69716d] mt-0.5 leading-relaxed">
                            副 API 的情绪评估、记忆整理等后台请求使用这条保护，独立于主 API。
                        </p>
                    </div>
                    <InkSwitch on={auxContextBudgetOn} onChange={handleAuxContextBudgetToggle} title="上下文防爆保护" />
                </div>

                <div className="group">
                    <div className="flex justify-between items-center mb-1.5">
                        <label className={LABEL}>MODEL · 辅助模型</label>
                        <button
                            onClick={() => fetchModels('aux', localAuxUrl, localAuxKey, localAuxModel, setLocalAuxModel, setAuxStatusMsg)}
                            disabled={loadingModelTarget !== null}
                            className="text-[10px] text-[#577782] font-black underline underline-offset-2 disabled:opacity-50"
                        >
                            {loadingModelTarget === 'aux' ? '正在拉取…' : auxAvailableModels.length ? `刷新模型（${auxAvailableModels.length}）` : '拉取模型'}
                        </button>
                    </div>
                    <ModelSelectButton model={localAuxModel} placeholder="选择或手动输入模型" onClick={() => openModelPicker('aux')} />
                    <p className="text-[10px] text-[#69716d] mt-1">建议使用响应快、成本低的模型；主聊天质量不受影响。</p>
                </div>

                <button onClick={handleSaveAuxApi} className={`w-full py-3 font-black mt-2 ${INK_BTN}`}>
                    {auxStatusMsg || '保存副 API'}
                </button>

                <button
                    onClick={handleTestAuxApi}
                    disabled={testingAuxApi || !localAuxUrl.trim() || !localAuxModel.trim()}
                    className={`w-full py-2.5 font-black text-sm mt-2 ${
                        testingAuxApi || !localAuxUrl.trim() || !localAuxModel.trim()
                            ? 'border border-black/10 rounded-xl/20 text-[#26242a]/30 bg-white'
                            : STICKER + ' text-[#26242a]'
                    }`}
                >
                    {testingAuxApi ? '测试中…' : '测试副 API 连接'}
                </button>

                {testAuxApiResult && (
                    <div className={`mt-2 text-xs px-3 py-2 border-2 ${
                        testAuxApiResult.startsWith('✅') ? 'border-[#1c1b1a] bg-white text-[#26242a]' : 'border-dashed border-[#1c1b1a]/50 bg-[#1c1b1a]/5 text-[#26242a]/80'
                    }`}>
                        {testAuxApiResult}
                    </div>
                )}
            </div>
            </SectionCard>

            {/* API 后台流水入口 */}
            <button
            type="button"
            onClick={() => setShowApiCallLog(true)}
            data-manual-anchor="manual-settings-api-log"
            className="relative w-full bg-white border border-[#ededed] rounded-[18px] press-soft p-4 pt-5 flex items-center gap-3 text-left"
            style={{ boxShadow: CARD_SHADOW }}
        >
            <Tape className="-top-2 left-6" />
            <div className="p-2 border border-[#e7e1d6] rounded-[14px] shrink-0 bg-white">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke={INK} className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25m18 0A2.25 2.25 0 0 0 18.75 3H5.25A2.25 2.25 0 0 0 3 5.25m18 0V12a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 12V5.25" />
                </svg>
            </div>
            <div className="flex-1 min-w-0">
                <div className="label-mono text-[9px] text-[#8a918d]">API LEDGER</div>
                <h2 className="text-base font-black text-[#2f3437] tracking-wide leading-tight">API 后台流水</h2>
                <p className="text-[11px] text-[#69716d] mt-0.5">最近 5 天：按 App 和具体功能查看消耗。</p>
            </div>
            <span className="text-[#8a918d] text-sm shrink-0">→</span>
            </button>

            {/* 其他 API — 非 LLM 类（语音、写歌等），不会跟随 API 预设切换 */}
            <SectionCard manualAnchor="manual-settings-other-services" tag="OTHER SERVICES" title="其他服务 API" hand="配置语音、写歌等非 LLM 服务。">
            <p className="text-[11px] text-[#26242a]/55 mb-4 leading-relaxed pl-1">
                语音 / 写歌等非 LLM 类 API。这里的配置 <span className="font-bold text-[#26242a]">不会随 API 预设切换</span>，通常只需要配置一次。
            </p>

            <div className="space-y-4">
                <div className="group">
                    <label className={LABEL}>MINIMAX SERVER · MiniMax 服务器</label>
                    <div className="flex border border-black/10 rounded-xl bg-white p-1 gap-1">
                        <button
                            type="button"
                            onClick={() => setLocalMiniMaxRegion('domestic')}
                            className={`flex-1 py-2 text-sm font-black transition-all ${localMiniMaxRegion === 'domestic' ? 'bg-[#1c1b1a] text-white' : 'text-[#26242a] active:bg-[#1c1b1a]/10'}`}
                        >
                            国服
                        </button>
                        <button
                            type="button"
                            onClick={() => setLocalMiniMaxRegion('overseas')}
                            className={`flex-1 py-2 text-sm font-black transition-all ${localMiniMaxRegion === 'overseas' ? 'bg-[#1c1b1a] text-white' : 'text-[#26242a] active:bg-[#1c1b1a]/10'}`}
                        >
                            海外
                        </button>
                    </div>
                    <p className="text-[11px] text-[#26242a]/55 mt-1 pl-1">
                        {localMiniMaxRegion === 'overseas'
                            ? '海外站（api.minimax.io）— 请使用海外账号签发的 Key。'
                            : '国服（api.minimaxi.com）— 默认，适配国内账号。'}
                    </p>
                </div>

                <div className="group">
                    <label className={LABEL}>MINIMAX KEY · 可不填</label>
                    <input type="password" name="minimax-api-secret" autoComplete="new-password" spellCheck={false} value={localMiniMaxKey} onChange={(e) => setLocalMiniMaxKey(e.target.value)} placeholder="MiniMax API Secret（留空则复用 Key）" className={`${FIELD} font-mono`} />
                    <p className="text-[11px] text-[#26242a]/55 mt-1 pl-1">电话 / 音色查询优先使用此 Key，留空时回退通用 Key。</p>
                </div>

                <div className="group">
                    <label className={LABEL}>MINIMAX GROUP ID · 可不填</label>
                    <input type="text" value={localMiniMaxGroupId} onChange={(e) => setLocalMiniMaxGroupId(e.target.value)} placeholder="group_id（部分账号/模型需要）" className={`${FIELD} font-mono`} />
                    <p className="text-[11px] text-[#26242a]/55 mt-1 pl-1">如控制台给了 group_id，请填这里；会透传到 TTS 请求体和代理日志。</p>
                </div>

                <div className="group">
                    <div className="flex items-center justify-between mb-1 pl-1">
                        <label className="label-mono text-[9px] text-[#26242a]/55">REPLICATE TOKEN · 写歌用，可不填</label>
                        <button
                            type="button"
                            onClick={() => setShowAceStepGuide(v => !v)}
                            className="text-[10px] font-black text-[#26242a] underline underline-offset-2 active:scale-95 transition-all flex items-center gap-1"
                        >
                            {showAceStepGuide ? '收起说明' : '查看获取方法'}
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={`w-3 h-3 transition-transform ${showAceStepGuide ? 'rotate-180' : ''}`}>
                                <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                            </svg>
                        </button>
                    </div>
                    <input type="password" name="ace-step-api-token" autoComplete="new-password" spellCheck={false} value={localAceStepKey} onChange={(e) => setLocalAceStepKey(e.target.value)} placeholder="r8_xxx（写歌 App 调用 ACE-Step 生成完整歌曲）" className={`${FIELD} font-mono`} />
                    <p className="text-[11px] text-[#26242a]/55 mt-1 pl-1">配置后，写歌 App 可调用 ACE-Step 生成带人声的完整歌曲（约 ¥0.1/首，走 sfworker 代理）。</p>

                    {showAceStepGuide && (
                        <div className="mt-3 border border-black/10 rounded-xl bg-white shadow-[0_12px_24px_-12px_rgba(38,36,42,0.45)] animate-slide-down relative">
                            <Tape className="-top-2.5 right-6 rotate-[3deg] w-10" />
                            <div className="px-4 pt-3.5 pb-2 flex items-center gap-2 border-b-2 border-dashed border-[#1c1b1a]/30">
                                <div className="w-7 h-7 border border-black/10 rounded-xl bg-white flex items-center justify-center text-base">🎤</div>
                                <div className="flex-1">
                                    <div className="text-[12px] font-black text-[#26242a]">3 步拿到 Replicate Token</div>
                                    <div className="text-[10px] text-[#26242a]/55">用于生成带人声的完整歌曲</div>
                                </div>
                            </div>
                            <div className="px-4 py-3 space-y-2.5">
                                <div className="flex gap-2.5">
                                    <span className="shrink-0 w-5 h-5 bg-[#1c1b1a] text-white text-[11px] font-black flex items-center justify-center mt-0.5">1</span>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-[12px] text-[#26242a] font-bold">注册 Replicate 账号</div>
                                        <p className="text-[11px] text-[#26242a]/60 leading-relaxed mt-0.5">用 GitHub 一键登录最快。无需邮箱验证。</p>
                                        <a
                                            href="https://replicate.com/signin"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className={`inline-flex items-center gap-1 mt-1.5 text-[11px] font-black text-[#26242a] px-2 py-1 ${STICKER}`}
                                        >
                                            打开注册页
                                        </a>
                                    </div>
                                </div>
                                <div className="flex gap-2.5">
                                    <span className="shrink-0 w-5 h-5 bg-[#1c1b1a] text-white text-[11px] font-black flex items-center justify-center mt-0.5">2</span>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-[12px] text-[#26242a] font-bold">复制 API Token</div>
                                        <p className="text-[11px] text-[#26242a]/60 leading-relaxed mt-0.5">登录后访问 Account → API Tokens，复制以 <span className="font-mono font-bold">r8_</span> 开头的那一串。</p>
                                        <a
                                            href="https://replicate.com/account/api-tokens"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className={`inline-flex items-center gap-1 mt-1.5 text-[11px] font-black text-[#26242a] px-2 py-1 ${STICKER}`}
                                        >
                                            打开 Token 页
                                        </a>
                                    </div>
                                </div>
                                <div className="flex gap-2.5">
                                    <span className="shrink-0 w-5 h-5 bg-[#1c1b1a] text-white text-[11px] font-black flex items-center justify-center mt-0.5">3</span>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-[12px] text-[#26242a] font-bold">绑卡充值（必须）</div>
                                        <p className="text-[11px] text-[#26242a]/60 leading-relaxed mt-0.5">Replicate 没有免费试用额度，需先绑信用卡。<span className="font-bold underline decoration-wavy">国内卡基本不行</span>，建议 Visa / MC 美区卡。最低充 $1（约 ¥7.3）≈ 50-100 首歌。</p>
                                    </div>
                                </div>
                                <div className="mt-2 pt-2.5 border-t-2 border-dashed border-[#1c1b1a]/30 flex gap-2 items-start">
                                    <span className="text-sm leading-none mt-0.5" style={HAND_CN}>✎</span>
                                    <p className="text-[11px] text-[#26242a]/60 leading-relaxed">
                                        粘贴到上方输入框 → 点击「保存其他 API」→ 进入写歌 App 的歌曲预览页 → 点击底部「AI 出歌」。
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <button onClick={handleSaveOtherApis} className={`w-full py-3 font-black mt-2 ${INK_BTN}`}>
                    {otherStatusMsg || '保存其他 API'}
                </button>
            </div>
            </SectionCard>
        </SettingsGroup>

        <SettingsGroup id="settings-live" eyebrow="04 / LIVE" title="实时与通知" desc="外部数据源、系统通知和 Web Push 相关配置。">
            {/* 实时感知 */}
            <SectionCard
            manualAnchor="manual-settings-realtime"
            tag="REALTIME"
            title="实时感知"
            hand="配置天气、新闻、时间与外部数据源"
            rotate="rotate-[0.4deg]"
            right={
                <button onClick={() => setShowRealtimeModal(true)} className={`shrink-0 text-[10px] font-black px-2.5 py-1.5 ${STICKER}`}>
                    配置
                </button>
            }
            >
            <p className="text-xs text-[#26242a]/60 mb-3 leading-relaxed">
                让角色在聊天中使用真实世界信息：天气、新闻热点、当前时间，以及可选的日记 / 小红书数据源。
            </p>

            <div className="grid grid-cols-5 gap-2 text-center">
                <div className={`py-3 text-xs font-bold border-2 ${rtWeatherEnabled ? 'border-[#1c1b1a] bg-[#1c1b1a] text-white' : 'border-dashed border-[#1c1b1a]/30 text-[#26242a]/40'}`}>
                    <div className="mb-1 flex justify-center"><Sun size={18} weight={rtWeatherEnabled ? 'fill' : 'regular'} /></div>
                    天气
                </div>
                <div className={`py-3 text-xs font-bold border-2 ${rtNewsEnabled ? 'border-[#1c1b1a] bg-[#1c1b1a] text-white' : 'border-dashed border-[#1c1b1a]/30 text-[#26242a]/40'}`}>
                    <div className="mb-1 flex justify-center"><Newspaper size={18} weight={rtNewsEnabled ? 'fill' : 'regular'} /></div>
                    新闻
                </div>
                <div className={`py-3 text-xs font-bold border-2 ${rtNotionEnabled ? 'border-[#1c1b1a] bg-[#1c1b1a] text-white' : 'border-dashed border-[#1c1b1a]/30 text-[#26242a]/40'}`}>
                    <div className="mb-1 flex justify-center"><NotePencil size={18} weight={rtNotionEnabled ? 'fill' : 'regular'} /></div>
                    Notion
                </div>
                <div className={`py-3 text-xs font-bold border-2 ${rtFeishuEnabled ? 'border-[#1c1b1a] bg-[#1c1b1a] text-white' : 'border-dashed border-[#1c1b1a]/30 text-[#26242a]/40'}`}>
                    <div className="mb-1 flex justify-center"><Notebook size={18} weight={rtFeishuEnabled ? 'fill' : 'regular'} /></div>
                    飞书
                </div>
                <div className={`py-3 text-xs font-bold border-2 ${rtXhsEnabled ? 'border-[#1c1b1a] bg-[#1c1b1a] text-white' : 'border-dashed border-[#1c1b1a]/30 text-[#26242a]/40'}`}>
                    <div className="mb-1 flex justify-center"><Book size={18} weight={rtXhsEnabled ? 'fill' : 'regular'} /></div>
                    小红书
                </div>
            </div>
            </SectionCard>

            {/* ───────── 系统通知 · 后台回复通知 ───────── */}
            <section data-manual-anchor="manual-settings-notification" className="relative bg-white border border-[#ededed] rounded-[18px] p-4 pt-5" style={{ boxShadow: CARD_SHADOW }}>
            <Tape className="-top-2 left-6" />
            <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                    <div className="label-mono text-[9px] text-[#8a918d]">NOTIFICATION</div>
                    <h2 className="text-base font-black text-[#2f3437] tracking-wide leading-tight">系统通知</h2>
                </div>
                <StatusBadge active={notifyPerm === 'granted'} activeText="已允许" inactiveText={notifyPerm === 'denied' ? '被拒绝' : '未授权'} />
            </div>
            <p className="text-[11px] text-[#69716d] mb-3 leading-relaxed" style={HAND_CN}>聊天生成完成后发送系统通知。</p>

            {notifyPerm !== 'granted' && (
                <button
                    type="button"
                    onClick={async () => {
                        const p = await requestNotifyPermission();
                        setNotifyPerm(p);
                        if (p === 'granted') addToast('系统通知已开启', 'success');
                        else if (p === 'denied') addToast(
                            nativeRuntime
                                ? '通知权限被拒绝，请到手机系统设置 → 应用 → Moro → 通知里手动开启'
                                : '通知权限被拒绝，请到浏览器站点设置里手动开启',
                            'error',
                        );
                    }}
                    className={`w-full py-2.5 text-xs font-black mb-3 ${INK_BTN}`}
                >
                    {notifyPerm === 'denied'
                        ? (nativeRuntime ? '权限被拒绝（去手机系统设置开启）' : '权限被拒绝（去浏览器站点设置开启）')
                        : '开启系统通知权限 →'}
                </button>
            )}

            <div className="flex items-center justify-between border border-[#e7e1d6] bg-white rounded-[14px] px-3 py-2.5 gap-3">
                <div className="min-w-0">
                    <p className="text-[11px] text-[#2f3437] font-bold">后台回复通知</p>
                    <p className="text-[10px] text-[#69716d] leading-snug">普通聊天发出后切后台，回复完成时尝试进入系统通知栏。生成期间靠 keep-alive 保活。</p>
                </div>
                <InkSwitch
                    on={bgReplyNotify}
                    onChange={(v) => { setBgReplyNotifyState(v); setBackgroundReplyNotify(v); }}
                />
            </div>
            <p className="text-[10px] text-[#69716d] mt-2 leading-relaxed">
                {nativeRuntime
                    ? '手机安装版使用手机系统通知。首次开启时会弹出系统授权；如果拒绝了，请到系统设置 → 应用 → Moro → 通知里重新允许。'
                    : '网页版优先用浏览器系统通知；电脑版 Chrome / Edge 体验最好。想让浏览器完全关闭也能收，去下面的 Instant Push 配 worker。'}
            </p>
            </section>

            {/* ───────── 推送凭据 (VAPID) ───────── */}
            {/* VAPID 公私钥, 与 Proactive / Instant Push 共用一份 — 独立成块, 避免再被当成 */}
            {/* Instant Push 的子配置, 也避免两边 key 不一致互相抢同一个 pushManager 订阅. */}
            {/* vapidReadyTick: VAPID 弹窗关闭后 +1, 让本节点 re-render 重读 isPushVapidReady(). */}
            <section data-manual-anchor="manual-settings-vapid" data-vapid-tick={vapidReadyTick} className="relative bg-white border border-[#ededed] rounded-[18px] p-4 pt-5" style={{ boxShadow: CARD_SHADOW }}>
            <Tape className="-top-2 left-6" />
            <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                    <div className="label-mono text-[9px] text-[#8a918d]">WEB PUSH KEY</div>
                    <h2 className="text-base font-black text-[#2f3437] tracking-wide leading-tight">推送凭据（VAPID）</h2>
                </div>
                <StatusBadge active={isPushVapidReady()} activeText="已配置" inactiveText="未配置" />
            </div>
            <p className="text-[11px] text-[#69716d] mb-2 leading-relaxed" style={HAND_CN}>配置 Web Push 使用的 VAPID 密钥。</p>
            <p className="text-xs text-[#69716d] mb-3 leading-relaxed">
                Proactive Push 和 Instant Push <b>共用同一份 VAPID 密钥对</b>。两边 key 不一致时会反复 unsubscribe 抢同一个 pushManager 订阅 ——
                "推送成功但收不到"的常见原因。
            </p>
            <button
                type="button"
                onClick={() => setShowVapidModal(true)}
                className={`w-full py-2.5 text-xs font-black ${isPushVapidReady() ? STICKER + ' text-[#26242a]' : INK_BTN}`}
            >
                {isPushVapidReady() ? '查看 / 更新 VAPID' : '配置 VAPID →'}
            </button>
            </section>

            {/* ───────── 主动消息 Push 加速开关 ───────── */}
            {SHOW_PROACTIVE_PUSH_ACCEL_UI && ppAvailable && (
            <section data-manual-anchor="manual-settings-proactive-push" className="relative bg-white border border-black/10 rounded-xl shadow-[0_12px_24px_-12px_rgba(38,36,42,0.45)] p-4 pt-5 rotate-[0.5deg]">
            <Tape className="-top-2.5 left-6 rotate-[3deg]" />
            <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                    <div className="label-mono text-[9px] text-[#26242a]/45">EXPRESS</div>
                    <h2 className="text-base font-black text-[#26242a] tracking-wide leading-tight">主动消息 Push 加速</h2>
                </div>
                <span className={`shrink-0 label-mono text-[9px] px-2 py-1 border-2 rotate-[2deg] ${ppEnabled ? 'border-[#1c1b1a] bg-[#1c1b1a] text-white' : 'border-dashed border-[#1c1b1a]/50 text-[#26242a]/60'}`}>
                    {ppEnabled ? '已启用' : '未启用'}
                </span>
            </div>

            <p className="text-xs text-[#26242a]/60 mb-3 leading-relaxed">
                让主动消息在浏览器后台标签中按计划触发。AI 仍在本地生成，云端只负责按时唤醒浏览器。
                浏览器进程被完全关闭时无法唤醒——下次打开 app 会自动补跑漏掉的主动消息，
                不会额外弹窗打扰你。
            </p>

            {ppStatus && (
                <div className={`mb-3 p-3 text-xs font-medium text-center border-2 ${ppStatus.includes('成功') || ppStatus.includes('已启用') || ppStatus.includes('OK') ? 'border-[#1c1b1a] bg-white text-[#26242a]' : ppStatus.includes('失败') || ppStatus.includes('错误') || ppStatus.includes('拒绝') ? 'border-dashed border-[#1c1b1a]/60 bg-[#1c1b1a]/5 text-[#26242a]' : 'border-[#1c1b1a]/20 bg-white text-[#26242a]/70'}`}>
                    {ppStatus}
                </div>
            )}

            <div className="flex items-center justify-between border-2 border-dashed border-[#1c1b1a]/40 px-3 py-2.5 gap-3">
                <div>
                    <p className="text-[11px] text-[#26242a] font-bold">启用 Push 加速</p>
                    <p className="text-[10px] text-[#26242a]/50">关闭后改用本地计时器</p>
                </div>
                <InkSwitch
                    on={ppEnabled}
                    disabled={ppBusy}
                    onChange={() => {
                        if (ppBusy) return;
                        if (ppEnabled) {
                            void doDisablePushAccelerator();
                        } else {
                            setShowPpConfirm(true);
                        }
                    }}
                />
            </div>

            {/* ───── 诊断面板 ───── */}
            <div className="mt-4 border border-black/10 rounded-xl/30 p-4">
                <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-black text-[#26242a]">Web Push 诊断</p>
                    <button
                        onClick={() => void refreshPpDiag()}
                        className={`text-[10px] font-black px-2.5 py-1 ${STICKER}`}
                    >
                        重新检测
                    </button>
                </div>

                {ppDiag ? (
                    <div className="space-y-1.5 text-[11px]">
                        <DiagRow
                            label="浏览器支持"
                            value={
                                ppDiag.capacitorNative ? '否（当前在 App 里运行）' :
                                ppDiag.supported ? '是' : '否（浏览器缺少推送相关 API）'
                            }
                            bad={!ppDiag.supported || ppDiag.capacitorNative}
                        />
                        <DiagRow
                            label="通知权限"
                            value={
                                ppDiag.permission === 'granted' ? '已授权' :
                                ppDiag.permission === 'denied' ? '已拒绝（请到浏览器站点设置手动开启）' :
                                ppDiag.permission === 'default' ? '未决定' :
                                '不可用'
                            }
                            bad={ppDiag.permission !== 'granted'}
                        />
                        <DiagRow
                            label="Service Worker"
                            value={
                                ppDiag.swState === 'activated' ? `已激活（scope: ${ppDiag.swScope || '?'}）` :
                                ppDiag.swState === 'none' ? '未注册' :
                                `${ppDiag.swState}（scope: ${ppDiag.swScope || '?'}）`
                            }
                            bad={ppDiag.swState !== 'activated'}
                        />
                        <DiagRow
                            label="订阅"
                            value={
                                !ppDiag.endpoint ? '不存在' :
                                ppDiag.endpointDead ? '已失效（zombie endpoint）' :
                                '已建立'
                            }
                            bad={!ppDiag.endpoint || ppDiag.endpointDead}
                        />
                        <DiagRow label="推送通道" value={ppDiag.channel} />
                        <DiagRow
                            label="最近一次唤醒"
                            value={
                                ppDiag.lastWakeAt
                                    ? `${new Date(ppDiag.lastWakeAt).toLocaleString()}${ppDiag.lastWakeChar ? `（${ppDiag.lastWakeChar}）` : ''}`
                                    : '从未'
                            }
                        />
                        {ppDiag.endpoint && (
                            <div className="pt-2 mt-2 border-t-2 border-dashed border-[#1c1b1a]/30">
                                <p className="text-[10px] text-[#26242a]/50 mb-1">订阅端点（前 60 字符）</p>
                                <p className={`text-[10px] font-mono break-all leading-relaxed ${ppDiag.endpointDead ? 'text-[#26242a] font-bold' : 'text-[#26242a]/60'}`}>{ppDiag.endpoint.slice(0, 60)}…</p>
                            </div>
                        )}
                        {ppDiag.endpointDead && (
                            <div className="mt-2 p-2 border border-black/10 rounded-xl bg-[#1c1b1a]/5 text-[10px] text-[#26242a]/80 leading-relaxed">
                                订阅地址是 <code className="font-mono">permanently-removed.invalid</code>——浏览器已经把这个订阅吊销了
                                （常见原因：长期不访问、通知权限切换过、浏览器清理过站点数据）。<br/>
                                这个域名是 RFC 保留 TLD，全球永远不会解析；Worker 试图把 push 投递过去就会回 HTTP 530。<br/>
                                点下方<b>"重置订阅"</b>会清掉这条死订阅并重建一个新的。
                            </div>
                        )}
                        {ppDiag.iosNeedsPwa && (
                            <div className="mt-2 p-2 border-2 border-dashed border-[#1c1b1a]/50 text-[10px] text-[#26242a]/70 leading-relaxed">
                                检测到 iOS Safari，但当前不是已添加到主屏幕的 PWA。<br/>
                                iOS 的 Web Push 必须先把网站"添加到主屏幕"启动后才能用。
                            </div>
                        )}
                        {ppDiag.capacitorNative && (
                            <div className="mt-2 p-2 border-2 border-dashed border-[#1c1b1a]/50 text-[10px] text-[#26242a]/70 leading-relaxed">
                                你现在是在<b>打包好的 App</b>里运行（不是浏览器网页）。<br/>
                                这项 Web Push 加速只对网页版生效——App 里没有网页推送通道，但<b>不影响你正常用</b>：
                                主动消息会通过 App 的本地通知发出，App 在后台/锁屏也能收到。<br/>
                                下面的"测试推送 / 重置订阅"按钮在 App 里点了也没用，可以直接忽略这项诊断。
                            </div>
                        )}
                    </div>
                ) : (
                    <p className="text-[10px] text-[#26242a]/50">正在读取诊断信息…</p>
                )}

                {(() => {
                    const inDeepMode = ppZombieStreak >= 3;
                    const resetLabel = inDeepMode
                        ? (ppDeepResetBusy ? '深度重置中…' : '深度重置')
                        : (ppResetBusy ? '重置中…' : '重置订阅');
                    const resetBusy = ppResetBusy || ppDeepResetBusy;
                    return (
                        <div className="mt-4 grid grid-cols-2 gap-3">
                            <button
                                disabled={ppTestBusy || resetBusy || !ppDiag?.endpoint || ppDiag?.endpointDead || ppDiag?.capacitorNative}
                                onClick={() => void doSendTestPush()}
                                className={`py-2 text-xs font-black ${ppTestBusy || resetBusy || !ppDiag?.endpoint || ppDiag?.endpointDead || ppDiag?.capacitorNative ? 'border border-black/10 rounded-xl/20 text-[#26242a]/30 bg-white' : INK_BTN}`}
                            >
                                {ppTestBusy ? '测试中…' : '发送测试推送'}
                            </button>
                            <button
                                disabled={resetBusy || ppTestBusy || ppDiag?.capacitorNative}
                                onClick={() => inDeepMode ? void doDeepResetSubscription() : void doResetSubscription()}
                                className={`py-2 text-xs font-black ${resetBusy || ppTestBusy || ppDiag?.capacitorNative ? 'border border-black/10 rounded-xl/20 text-[#26242a]/30 bg-white' : inDeepMode || ppDiag?.endpointDead ? INK_BTN : STICKER + ' text-[#26242a]'}`}
                            >
                                {resetLabel}
                            </button>
                        </div>
                    );
                })()}
                <p className="text-[10px] text-[#26242a]/50 mt-2 leading-relaxed">
                    "测试推送"会让 Worker 立刻给你这台设备发一条 push，5 秒内系统通知里出现"推送测试成功"= 链路通。
                    "重置订阅"会清掉旧订阅再建一个，适合订阅失效或换浏览器后用。
                    {ppZombieStreak >= 3 && <><br/>连续几次都没成，已切到"深度重置"——点一下做一次更彻底的清理。</>}
                </p>
            </div>
            </section>
            )}

            {/* ───────── Instant Push ───────── */}
            <SectionCard
            manualAnchor="manual-settings-instant-push"
            tag="INSTANT"
            title="Instant Push"
            hand="配置 Worker 驱动的即时 Web Push 回复"
            rotate="rotate-[-0.5deg]"
            right={
                <button
                    onClick={() => setShowInstantModal(true)}
                    className={`shrink-0 text-[10px] font-black px-2.5 py-1.5 rotate-[2deg] ${STICKER}`}
                >
                    配置
                </button>
            }
            >
            <p className="text-xs text-[#26242a]/60 leading-relaxed">
                前端把 prompt 发到你自部署的 Worker，Worker 调用你的 LLM 生成回复后，通过 Web Push 分句送达。零数据库、零 cron。
            </p>
            </SectionCard>
        </SettingsGroup>

        <VersionInfo />
      </div>

      {/* 主动消息 Push 加速确认 */}
      <PaperSheet
          open={showPpConfirm}
          tag="PUSH CONFIRM"
          title="启用主动消息 Push 加速？"
          onClose={() => setShowPpConfirm(false)}
          footer={
              <>
                  <button
                      onClick={() => setShowPpConfirm(false)}
                      className={`flex-1 py-3 font-black text-[#26242a] ${STICKER}`}
                  >
                      取消
                  </button>
                  <button
                      onClick={() => {
                          setShowPpConfirm(false);
                          void doEnablePushAccelerator();
                      }}
                      className={`flex-1 py-3 font-black ${INK_BTN}`}
                  >
                      确认启用
                  </button>
              </>
          }
      >
          <div className="space-y-3 text-[12px] leading-relaxed text-[#26242a]/80">
              <div className="border border-black/10 rounded-xl bg-white p-3">
                  <p className="font-black text-[#26242a] mb-1">启用后会做三件事</p>
                  <ol className="list-decimal pl-4 space-y-1">
                      <li>浏览器会弹 <b>"允许发送通知？"</b> 的系统对话框；需要允许通知才能后台唤醒</li>
                      <li>浏览器生成一个 <b>推送订阅凭证</b>（只用于推送路由，不含任何聊天内容），上传到 Cloudflare</li>
                      <li>开着本应用的标签页时，每 2 分钟给 Cloudflare 发一次心跳；关闭页面 5 分钟后 Cloudflare 自动停止唤醒</li>
                  </ol>
              </div>

              <div className="border border-black/10 rounded-xl bg-white p-3">
                  <p className="font-black text-[#26242a] mb-1">谁能看到什么</p>
                  <div className="space-y-1.5">
                      <p><b>Cloudflare 能看到：</b>推送订阅凭证 + 角色 ID（一串随机字符串）+ 间隔分钟数。<b>看不到</b>聊天内容、角色设定、AI 回复、API Key、你是谁。</p>
                      <p><b>浏览器厂商的推送服务（Google / Mozilla / Apple）：</b>知道你某时刻收到一条 push，内容是加密的，他们读不到。</p>
                      <p><b>你的 AI 接口供应商：</b>和平时聊天一样，到点时浏览器在<b>本地</b>直接调用你配置的 API，走你自己的 key。Cloudflare 完全不碰这一步。</p>
                  </div>
              </div>

              <div className="border-2 border-dashed border-[#1c1b1a]/50 p-3">
                  <p className="font-black text-[#26242a] mb-1">隐私范围</p>
                  <p>聊天记录和 AI 请求只在你自己和 AI 提供商之间。Cloudflare 只保存推送订阅凭证和调度信息。</p>
              </div>

              <div className="border-2 border-dashed border-[#1c1b1a]/50 p-3">
                  <p className="font-black text-[#26242a] mb-1">通知触发方式</p>
                  <p>浏览器后台标签会静默触发。浏览器完全关闭时，下次打开 app 会自动补跑漏掉的主动消息。</p>
              </div>
          </div>
      </PaperSheet>

      {/* WebDAV 备份配置 */}
      <PaperSheet open={showCloudModal} tag="WEBDAV" title="WebDAV 备份配置" onClose={() => setShowCloudModal(false)}>
          <div className="space-y-4 p-1">
              <div className="border border-black/10 rounded-xl bg-white p-3">
                  <p className="text-[10px] text-[#26242a]/80 leading-relaxed">
                      <b>需要代理</b><br/>
                      InfiniCloud 是日本服务，国内直连通常无法打开注册页，也可能无法同步备份。<b>注册和同步时请保持代理开启</b>，否则会连接失败或超时。
                  </p>
              </div>
              <div className="border-2 border-dashed border-[#1c1b1a]/50 p-3">
                  <p className="text-[10px] text-[#26242a]/70 leading-relaxed">
                      <b>快速上手 (InfiniCloud, 免费 20GB):</b><br/>
                      1. 注册 <a href="https://infini-cloud.net/" target="_blank" rel="noopener noreferrer" className="text-[#26242a] underline font-bold">infini-cloud.net ↗</a>（邮箱验证）<br/>
                      2. 登录后 <b>My Page</b> 最底 → 勾选 <b>Turn on Apps Connection</b><br/>
                      3. 顶栏 <b>Apps</b> → 复制 <b>WebDAV URL</b> / <b>Connection ID</b> / <b>Apps Password</b><br/>
                      4. 用户名填 <b>Connection ID</b>（不是邮箱），密码填 <b>Apps Password</b>
                  </p>
              </div>
              <div className="border-2 border-dashed border-[#1c1b1a]/50 p-3">
                  <p className="text-[10px] text-[#26242a]/70 leading-relaxed">
                      <b>⚠️ Apps Password ≠ 登录密码</b><br/>
                      <b>Apps Password</b> 是 <b>Apps</b> 页面里显示在 <b>WebDAV URL</b>、<b>Connection ID</b> <b>下方</b>的一串<b>可复制</b>的应用专用密码，往下滚就能看到。直接把它复制粘贴到上面的"密码"框即可，用账号登录密码会 401。
                  </p>
              </div>
              <div>
                  <label className={LABEL}>WEBDAV URL · 服务地址</label>
                  <input type="url" value={cbUrl} onChange={(e) => setCbUrl(e.target.value)} placeholder="https://xxx.infini-cloud.net/dav/" className={`${FIELD} text-xs`} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                  <div>
                      <label className={LABEL}>USER · 用户名</label>
                      <input type="text" value={cbUsername} onChange={(e) => setCbUsername(e.target.value)} placeholder="邮箱或用户名" className={`${FIELD} text-xs`} />
                  </div>
                  <div>
                      <label className={LABEL}>PASS · 密码</label>
                      <input type="password" value={cbPassword} onChange={(e) => setCbPassword(e.target.value)} placeholder="应用专用密码" className={`${FIELD} text-xs`} />
                  </div>
              </div>
              <div>
                  <label className={LABEL}>PATH · 备份目录</label>
                  <input type="text" value={cbPath} onChange={(e) => setCbPath(e.target.value)} placeholder="/MoroBackup/" className={`${FIELD} text-xs`} />
              </div>
              <button onClick={handleTestCloudConnection} disabled={cloudTesting || !cbUrl || !cbUsername || !cbPassword} className={`w-full py-2.5 text-xs font-black text-[#26242a] disabled:opacity-40 ${STICKER}`}>
                  {cloudTesting ? '测试中…' : '测试 WebDAV 连接'}
              </button>
              {cloudTestResult && (
                  <p className={`text-[11px] text-center font-bold ${cloudTestResult.startsWith('✓') ? 'text-[#26242a]' : 'text-[#26242a]/70 underline decoration-wavy'}`}>{cloudTestResult}</p>
              )}
              <div className="grid grid-cols-2 gap-3 pt-2">
                  <button onClick={() => setShowCloudModal(false)} className={`py-2.5 text-xs font-black text-[#26242a] ${STICKER}`}>取消</button>
                  <button onClick={handleSaveCloudConfig} disabled={!cbUrl || !cbUsername || !cbPassword} className={`py-2.5 text-xs font-black disabled:opacity-40 ${INK_BTN}`}>保存 WebDAV</button>
              </div>
              {cloudBackupConfig.enabled && (
                  <button onClick={() => { updateCloudBackupConfig({ enabled: false }); setShowCloudModal(false); addToast('云端备份已关闭', 'info'); }} className="w-full py-2 text-[11px] text-[#26242a]/50 font-bold underline underline-offset-2">关闭云端备份</button>
              )}
          </div>
      </PaperSheet>

      {/* GitHub Backup Sheet — minimum-input flow: paste a token, we figure
          out owner via /user and auto-create a private 'moro-backup' repo. */}
      <PaperSheet open={showGithubModal} tag="GITHUB" title="GitHub 备份配置" onClose={() => setShowGithubModal(false)}>
          <div className="space-y-4 p-1">
              <div className="border border-black/10 rounded-xl bg-white p-3">
                  <p className="text-[11px] text-[#26242a]/80 leading-relaxed">
                      <b>三步配置 GitHub 备份：</b><br/>
                      ① 打开 GitHub 创建 Token<br/>
                      ② 复制 token，粘贴到下面输入框<br/>
                      ③ 点击 <b>测试并连接</b>，系统会自动创建私有仓库 <code className="bg-[#1c1b1a]/10 px-1">{ghRepo || 'moro-backup'}</code>
                  </p>
              </div>

              <div className="border-2 border-dashed border-[#1c1b1a]/50 p-3">
                  <p className="text-[10px] text-[#26242a]/70 leading-relaxed">
                      <b>⚠️ 在 GitHub 那一页只改一处:</b><br/>
                      把 <b>Expiration</b>(有效期)下拉框 <b>从 90天 改成 No expiration</b>（永不过期）。
                      不改的话 90 天后 token 过期，备份会突然 401。<br/>
                      其它都别动 —— Note 已经填好「Moro 备份」，<b>repo</b> 权限已经勾上了，
                      直接拉到最底点绿色 <b>Generate token</b> 即可。
                  </p>
              </div>

              <a
                  href="https://github.com/settings/tokens/new?scopes=repo&description=Moro%20%E5%A4%87%E4%BB%BD"
                  target="_blank" rel="noopener noreferrer"
                  className={`block w-full py-3 text-xs font-black text-center ${INK_BTN}`}
              >
                  ① 去 GitHub 创建 Token ↗
              </a>

              <div>
                  <label className={LABEL}>② PERSONAL ACCESS TOKEN</label>
                  <input
                      type="password"
                      value={ghToken}
                      onChange={(e) => setGhToken(e.target.value)}
                      placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                      className={`${FIELD} text-xs font-mono`}
                  />
                  <p className="text-[10px] text-[#26242a]/50 mt-1 leading-relaxed">
                      Token 只保存在本机，不会发送到 Moro 服务器。
                  </p>
              </div>

              <button
                  onClick={handleTestGithub}
                  disabled={ghTesting || !ghToken.trim()}
                  className={`w-full py-3 text-xs font-black text-[#26242a] disabled:opacity-40 ${STICKER}`}
              >
                  {ghTesting ? '测试中…' : '③ 测试并连接'}
              </button>
              {ghTestResult && (
                  <p className={`text-[11px] text-center font-bold ${ghTestResult.startsWith('✓') ? 'text-[#26242a]' : 'text-[#26242a]/70 underline decoration-wavy'}`}>
                      {ghTestResult}
                  </p>
              )}
              {ghTestResult.startsWith('✓') && cloudBackupConfig.githubOwner && (
                  <div className="border border-black/10 rounded-xl bg-white p-3 space-y-1.5">
                      <p className="text-[11px] text-[#26242a] font-bold">
                          备份将保存到：
                      </p>
                      <a
                          href={`https://github.com/${cloudBackupConfig.githubOwner}/${cloudBackupConfig.githubRepo || 'moro-backup'}/releases`}
                          target="_blank" rel="noopener noreferrer"
                          className="block text-[10px] text-[#26242a]/70 font-mono break-all underline"
                      >
                          github.com/{cloudBackupConfig.githubOwner}/{cloudBackupConfig.githubRepo || 'moro-backup'}/releases ↗
                      </a>
                      <p className="text-[10px] text-[#26242a]/60 leading-relaxed">
                          每次备份会创建一个新的 release（带时间戳）。可在 GitHub 页面查看或删除旧备份。
                      </p>
                  </div>
              )}

              <button
                  onClick={() => setGhShowAdvanced(v => !v)}
                  className="w-full text-[10px] text-[#26242a]/50 underline-offset-2 hover:underline"
              >
                  {ghShowAdvanced ? '收起高级设置 ▲' : '高级设置 ▼'}
              </button>
              {ghShowAdvanced && (
                  <div className="space-y-3 border-2 border-dashed border-[#1c1b1a]/40 p-3">
                      <div>
                          <label className={LABEL}>REPO · 备份仓库名</label>
                          <input
                              type="text"
                              value={ghRepo}
                              onChange={(e) => setGhRepo(e.target.value)}
                              placeholder="moro-backup"
                              className={`${FIELD} text-xs font-mono`}
                          />
                          <p className="text-[10px] text-[#26242a]/50 mt-1">不存在会自动创建为私有仓库。</p>
                      </div>
                      <label className="flex items-center gap-2 text-[11px] text-[#26242a]/80 cursor-pointer">
                          <input
                              type="checkbox"
                              checked={ghUseProxy}
                              onChange={(e) => setGhUseProxy(e.target.checked)}
                              className="accent-[#1c1b1a]"
                          />
                          <span>走 Cloudflare 代理（默认开，国内必需；能直连 GitHub 的可关掉提速）</span>
                      </label>
                      <p className="text-[10px] text-[#26242a]/50 leading-relaxed pl-5">
                          大于 80MB 的备份会自动切成多片上传，所以勾着也能传 1GB+ 的完整备份，恢复时自动拼回来。能直连 github.com 的可以关掉提速。
                      </p>
                  </div>
              )}

              <div className="grid grid-cols-2 gap-3 pt-2">
                  <button onClick={() => setShowGithubModal(false)} className={`py-2.5 text-xs font-black text-[#26242a] ${STICKER}`}>关闭</button>
                  {cloudBackupConfig.enabled && cloudBackupConfig.provider === 'github' ? (
                      <button onClick={handleDisableCloud} className="py-2.5 text-xs font-black text-[#26242a] border-2 border-dashed border-[#1c1b1a]/60 bg-white active:bg-[#1c1b1a]/5"><span className="line-through">关闭 GitHub 备份</span></button>
                  ) : (
                      <button
                          onClick={() => setShowGithubModal(false)}
                          disabled={!cloudBackupConfig.enabled || cloudBackupConfig.provider !== 'github'}
                          className={`py-2.5 text-xs font-black disabled:opacity-30 ${INK_BTN}`}
                      >
                          完成
                      </button>
                  )}
              </div>
          </div>
      </PaperSheet>

      {/* 从云端恢复 */}
      <PaperSheet open={showCloudRestoreModal} tag="RESTORE" title="从云端恢复" onClose={() => setShowCloudRestoreModal(false)}>
          <div className="space-y-2 p-1">
              {cloudBackupFiles.length === 0 ? (
                  <div className="text-center py-8"><p className="text-[11px] text-[#26242a]/50" style={HAND_CN}>正在读取云端备份列表…</p></div>
              ) : (
                  <>
                      <p className="text-[10px] text-[#26242a]/55 mb-2">选择要恢复的备份：</p>
                      <div className="max-h-[50vh] overflow-y-auto space-y-2">
                          {cloudBackupFiles.map((file, i) => (
                              <button key={i} onClick={() => handleCloudRestore(file)} className={`w-full p-3 text-left ${STICKER}`}>
                                  <p className="text-[11px] text-[#26242a] font-bold truncate">{file.name}</p>
                                  <div className="flex items-center gap-3 mt-1">
                                      <span className="label-mono text-[9px] text-[#26242a]/55">{file.lastModified ? new Date(file.lastModified).toLocaleString('zh-CN') : '备份时间未知'}</span>
                                      <span className="label-mono text-[9px] text-[#26242a]/55">{file.size > 0 ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : ''}</span>
                                  </div>
                              </button>
                          ))}
                      </div>
                  </>
              )}
          </div>
      </PaperSheet>

      {/* 模型选择 */}
      <PaperSheet open={showModelModal} tag="MODEL" title={modelPickerTarget === 'aux' ? '选择副 API 模型' : '选择主 API 模型'} onClose={() => setShowModelModal(false)}>
        {(() => {
            const { filtered, commonPrefix, total } = modelPickerView;
            const currentModel = modelPickerTarget === 'aux' ? localAuxModel : localModel;
            const setCurrentModel = modelPickerTarget === 'aux' ? setLocalAuxModel : setLocalModel;
            return (
                <div className="space-y-3 p-1">
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={currentModel}
                            onChange={(e) => setCurrentModel(e.target.value)}
                            placeholder="可手动输入模型名"
                            className={`flex-1 min-w-0 ${FIELD} font-mono`}
                        />
                        <button
                            onClick={() => setShowModelModal(false)}
                            className={`px-4 py-2.5 text-sm font-black shrink-0 ${INK_BTN}`}
                        >
                            确定
                        </button>
                    </div>
                    {total > 0 && (
                        <div className="relative">
                            <input
                                type="text"
                                value={modelFilter}
                                onChange={(e) => setModelFilter(e.target.value)}
                                placeholder={`在 ${total} 个模型中搜索`}
                                className={`${FIELD} text-xs`}
                            />
                            {modelFilter && (
                                <button
                                    onClick={() => setModelFilter('')}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[#26242a]/50 text-xs px-2"
                                >
                                    ×
                                </button>
                            )}
                        </div>
                    )}
                    {commonPrefix && (
                        <div className="text-[10px] text-[#69716d] px-1 flex items-center gap-1 flex-wrap">
                            <span>公共前缀:</span>
                            <code className="font-mono px-1.5 py-0.5 break-all">{commonPrefix}</code>
                            <span className="text-[#8a918d]">(下方已弱化显示)</span>
                        </div>
                    )}
                    <div className="max-h-[40vh] overflow-y-auto no-scrollbar space-y-2">
                        {filtered.length > 0 ? filtered.map(m => {
                            const suffix = commonPrefix && m.startsWith(commonPrefix) ? m.slice(commonPrefix.length) : m;
                            const selected = m === currentModel;
                            return (
                                <button
                                    key={m}
                                    onClick={() => { setCurrentModel(m); setShowModelModal(false); }}
                                    title={m}
                                    className="w-full text-left px-4 py-3 text-sm font-mono flex justify-between items-start gap-2 rounded-[14px] transition-all"
                                    style={selected
                                        ? { color: '#fff', background: ROSE, border: `1px solid ${LINE}`, boxShadow: '0 8px 18px -14px rgba(48,50,56,0.45)' }
                                        : { color: '#2f3437', background: '#fffdf8', border: `1px solid ${LINE}` }}
                                >
                                    <span className="break-all min-w-0 flex-1 leading-relaxed">
                                        {commonPrefix && suffix !== m && (
                                            <span className={selected ? 'text-white/60 font-normal' : 'text-[#8a918d] font-normal'}>{commonPrefix}</span>
                                        )}
                                        <span>{suffix}</span>
                                    </span>
                                    {selected && <span className="mt-0.5 flex-shrink-0 text-xs">✓</span>}
                                </button>
                            );
                        }) : (
                            <div className="text-center text-[#8a918d] py-8 text-xs">
                                {total === 0
                                    ? `当前没有已拉取的${modelPickerTarget === 'aux' ? '副 API' : '主 API'}模型，可手动输入或先点“拉取模型”`
                                    : `没有找到 “${modelFilter}”`}
                            </div>
                        )}
                    </div>
                </div>
            );
        })()}
      </PaperSheet>

      {/* API 后台流水页面 */}
      <ApiCallLogModal
          isOpen={showApiCallLog}
          onClose={() => setShowApiCallLog(false)}
          onOpenManualHelp={openApiErrorManualHelp}
      />

      {/* API 预设命名 */}
      <PaperSheet open={showPresetModal} tag="API PRESET" title="保存 API 预设" onClose={() => setShowPresetModal(false)} footer={<button onClick={handleSavePreset} className={`w-full py-3 font-black ${INK_BTN}`}>保存预设</button>}>
          <div className="space-y-2">
              <label className={LABEL}>NAME · 预设名称（例如: DeepSeek）</label>
              <input value={newPresetName} onChange={e => setNewPresetName(e.target.value)} className={FIELD} autoFocus placeholder="输入预设名称" />
          </div>
      </PaperSheet>

      {/* 备份导出完成 */}
      <PaperSheet open={showExportModal} tag="EXPORTED" title="备份已导出" onClose={() => setShowExportModal(false)} footer={
          <button onClick={() => setShowExportModal(false)} className={`flex-1 py-3 font-black text-[#26242a] ${STICKER}`}>关闭</button>
      }>
          <div className="space-y-4 text-center py-4">
              <div className="w-16 h-16 border border-black/10 rounded-xl bg-white shadow-[0_12px_24px_-12px_rgba(38,36,42,0.45)] flex items-center justify-center mx-auto mb-2 rotate-[-3deg]">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke={INK} className="w-8 h-8"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
              </div>
              <p className="text-sm font-black text-[#26242a]">备份文件已生成</p>
              <p className="text-xs text-[#26242a]/60">如果浏览器没有自动下载，请点下面这行字。</p>
              {downloadUrl && <a href={downloadUrl} download="Moro_Backup.zip" className="text-[#26242a] text-sm underline underline-offset-2 font-bold block py-2">手动下载 .zip</a>}
          </div>
      </PaperSheet>

      {/* 实时感知配置 Sheet */}
      <PaperSheet
          open={showRealtimeModal}
          tag="REALTIME"
          title="实时感知配置"
          onClose={() => setShowRealtimeModal(false)}
          footer={<button onClick={handleSaveRealtimeConfig} className={`w-full py-3 font-black ${INK_BTN}`}>保存实时感知</button>}
      >
          <div className="space-y-5">
              {/* 天气配置 */}
              <div className="border border-black/10 rounded-xl bg-white p-4 space-y-3 relative">
                  <Tape className="-top-2.5 left-4 rotate-[-3deg] w-10" />
                  <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                          <Sun size={20} weight="fill" color={INK} />
                          <span className="text-sm font-black text-[#26242a]">天气感知</span>
                      </div>
                      <InkSwitch on={rtWeatherEnabled} onChange={v => setRtWeatherEnabled(v)} />
                  </div>
                  {rtWeatherEnabled && (
                      <div className="space-y-2">
                          {/* 取数方式：定位（免密钥）/ 自定义城市（免密钥） */}
                          <div className="grid grid-cols-2 gap-2">
                              <button
                                  onClick={() => setRtWeatherMode('geo')}
                                  className={`py-2 text-xs font-black border-2 ${rtWeatherMode === 'geo' ? 'border-[#1c1b1a] bg-[#1c1b1a] text-white' : 'border-dashed border-[#1c1b1a]/30 text-[#26242a]/50'}`}
                              >📍 定位·实时（免密钥）</button>
                              <button
                                  onClick={() => setRtWeatherMode('manual')}
                                  className={`py-2 text-xs font-black border-2 ${rtWeatherMode === 'manual' ? 'border-[#1c1b1a] bg-[#1c1b1a] text-white' : 'border-dashed border-[#1c1b1a]/30 text-[#26242a]/50'}`}
                              >🏙️ 自定义城市</button>
                          </div>
                          {rtWeatherMode === 'geo' ? (
                              <p className="text-xs text-[#26242a]/60 leading-relaxed">
                                  取你所在地的实时天气（Open-Meteo，全程免密钥、不用申请）。日常自动刷新不会主动弹定位授权；已授权时优先用{nativeRuntime ? '手机系统定位' : '浏览器定位'}，未授权时会用本地缓存或按 IP 取城市级的本地实时天气。只有点「测试天气连接」或天气详情页「刷新」这类主动操作时，才可能请求定位；定位偏到邻城时可切到「自定义城市」。
                              </p>
                          ) : (
                              <>
                                  <div>
                                      <label className={LABEL}>CITY · 自定义城市</label>
                                      <input type="text" value={rtWeatherCity} onChange={e => setRtWeatherCity(e.target.value)} className={FIELD} placeholder="城市名 / 省份 城市 / City name" />
                                      <p className="mt-1 text-[11px] leading-relaxed text-[#26242a]/55">
                                          手填城市同样走免密钥天气；定位偏到邻城时写这里即可。城市重名或查不到时，可加省份。
                                      </p>
                                  </div>
                                  <div>
                                      <label className={LABEL}>OPENWEATHERMAP API KEY · 旧版兜底，可不填</label>
                                      <input type="password" value={rtWeatherKey} onChange={e => setRtWeatherKey(e.target.value)} className={`${FIELD} font-mono`} placeholder="留空即可" />
                                  </div>
                              </>
                          )}
                          <button onClick={testWeatherApi} className={`w-full py-2 text-xs font-black text-[#26242a] ${STICKER}`}>测试天气连接</button>
                      </div>
                  )}
              </div>

              {/* 新闻配置 */}
              <div className="border border-black/10 rounded-xl bg-white p-4 space-y-3 relative">
                  <Tape className="-top-2.5 right-4 rotate-[3deg] w-10" />
                  <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                          <Newspaper size={20} weight="fill" color={INK} />
                          <span className="text-sm font-black text-[#26242a]">新闻热点</span>
                      </div>
                      <InkSwitch on={rtNewsEnabled} onChange={v => setRtNewsEnabled(v)} />
                  </div>
                  {rtNewsEnabled && (
                      <div className="space-y-2">
                          <p className="text-xs text-[#26242a]/60">默认主源：中文多平台热榜（免鉴权，聊天时角色会自动使用热点）。请选择要启用的平台：</p>
                          <div className="flex flex-wrap gap-1.5">
                              {HOTNEWS_PLATFORM_OPTIONS.map(p => {
                                  const active = rtNewsPlatforms.includes(p.key);
                                  return (
                                      <button
                                          key={p.key}
                                          type="button"
                                          onClick={() => setRtNewsPlatforms(prev => prev.includes(p.key) ? prev.filter(k => k !== p.key) : [...prev, p.key])}
                                          className={`text-[11px] px-2.5 py-1 font-bold border-2 transition-colors active:scale-95 ${active ? 'border-[#1c1b1a] bg-[#1c1b1a] text-white' : 'border-[#1c1b1a]/30 bg-white text-[#26242a]/60'}`}
                                      >
                                          {p.label}
                                      </button>
                                  );
                              })}
                          </div>
                          {rtNewsPlatforms.length === 0 && (
                              <p className="text-[10px] text-[#26242a]/60 underline decoration-wavy">未选择平台时，将回退到 Brave / Hacker News。</p>
                          )}
                          <details className="border-t-2 border-dashed border-[#1c1b1a]/30 pt-2 mt-1 group">
                              <summary className="label-mono text-[10px] text-[#26242a]/55 cursor-pointer select-none list-none flex items-center gap-1.5">
                                  <span className="transition-transform group-open:rotate-90">›</span>
                                  Brave Search（回落源 · <span className="underline decoration-wavy">不建议配置</span>）
                              </summary>
                              <div className="mt-2 space-y-1.5">
                                  <p className="text-[10px] text-[#26242a]/55 leading-relaxed">
                                      上面的中文热榜在国内场景比 Brave 好用一万倍，<b className="text-[#26242a]/80">基本不需要配这个</b>。
                                      它只是热榜彻底拉不到时的英文回落，配了反而可能盖掉中文热点。除非你清楚自己在做什么，否则留空即可。
                                  </p>
                                  <input type="password" value={rtNewsApiKey} onChange={e => setRtNewsApiKey(e.target.value)} className={`${FIELD} font-mono`} placeholder="（不建议）brave.com/search/api" />
                                  <p className="text-[10px] text-[#26242a]/45">仅当中文热榜拉取失败时才启用；都不可用时再兜底 Hacker News（英文）。</p>
                              </div>
                          </details>
                      </div>
                  )}
              </div>

              {/* Notion 配置 */}
              <div className="border border-black/10 rounded-xl bg-white p-4 space-y-3 relative">
                  <Tape className="-top-2.5 left-4 rotate-[-3deg] w-10" />
                  <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                          <NotePencil size={20} weight="fill" color={INK} />
                          <span className="text-sm font-black text-[#26242a]">Notion 日记</span>
                      </div>
                      <InkSwitch on={rtNotionEnabled} onChange={v => setRtNotionEnabled(v)} />
                  </div>
                  {rtNotionEnabled && (
                      <div className="space-y-2">
                          <div>
                              <label className={LABEL}>NOTION INTEGRATION TOKEN</label>
                              <input type="password" value={rtNotionKey} onChange={e => setRtNotionKey(e.target.value)} className={`${FIELD} font-mono`} placeholder="secret_..." />
                          </div>
                          <div>
                              <label className={LABEL}>DATABASE ID</label>
                              <input type="text" value={rtNotionDbId} onChange={e => setRtNotionDbId(e.target.value)} className={`${FIELD} font-mono`} placeholder="从数据库 URL 复制" />
                          </div>
                          <button onClick={testNotionApi} className={`w-full py-2 text-xs font-black text-[#26242a] ${STICKER}`}>测试 Notion 连接</button>
                          <div className="border-t-2 border-dashed border-[#1c1b1a]/30 pt-2 mt-2">
                              <label className={LABEL}>NOTES DATABASE ID · 笔记库，可不填</label>
                              <input type="text" value={rtNotionNotesDbId} onChange={e => setRtNotionNotesDbId(e.target.value)} className={`${FIELD} font-mono`} placeholder="用户日常笔记的数据库 ID" />
                              <p className="text-[10px] text-[#26242a]/50 leading-relaxed mt-1">
                                  填写后，角色可读取你的笔记标题并在聊天中自然引用。留空则不启用。
                              </p>
                          </div>
                          <p className="text-[10px] text-[#26242a]/55 leading-relaxed">
                              1. 在 <a href="https://www.notion.so/my-integrations" target="_blank" className="underline font-bold">Notion开发者</a> 创建Integration<br/>
                              2. 创建一个日记数据库，添加"Name"(标题)和"Date"(日期)属性<br/>
                              3. 在数据库右上角菜单中 Connect 你的 Integration
                          </p>
                      </div>
                  )}
              </div>

              {/* 飞书配置 (中国区替代) */}
              <div className="border border-black/10 rounded-xl bg-white p-4 space-y-3 relative">
                  <Tape className="-top-2.5 right-4 rotate-[3deg] w-10" />
                  <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                          <Notebook size={20} weight="fill" color={INK} />
                          <span className="text-sm font-black text-[#26242a]">飞书日记</span>
                          <span className="label-mono text-[8px] border border-[#1c1b1a]/40 text-[#26242a]/60 px-1.5 py-0.5">中国区</span>
                      </div>
                      <InkSwitch on={rtFeishuEnabled} onChange={v => setRtFeishuEnabled(v)} />
                  </div>
                  <p className="text-[10px] text-[#26242a]/55 leading-relaxed">
                      Notion 的中国区替代方案。使用飞书多维表格存储日记。
                  </p>
                  {rtFeishuEnabled && (
                      <div className="space-y-2">
                          <div>
                              <label className={LABEL}>飞书 APP ID</label>
                              <input type="text" value={rtFeishuAppId} onChange={e => setRtFeishuAppId(e.target.value)} className={`${FIELD} font-mono`} placeholder="cli_xxxxxxxx" />
                          </div>
                          <div>
                              <label className={LABEL}>飞书 APP SECRET</label>
                              <input type="password" value={rtFeishuAppSecret} onChange={e => setRtFeishuAppSecret(e.target.value)} className={`${FIELD} font-mono`} placeholder="xxxxxxxxxxxxxxxx" />
                          </div>
                          <div>
                              <label className={LABEL}>多维表格 APP TOKEN</label>
                              <input type="text" value={rtFeishuBaseId} onChange={e => setRtFeishuBaseId(e.target.value)} className={`${FIELD} font-mono`} placeholder="从多维表格 URL 中获取" />
                          </div>
                          <div>
                              <label className={LABEL}>数据表 TABLE ID</label>
                              <input type="text" value={rtFeishuTableId} onChange={e => setRtFeishuTableId(e.target.value)} className={`${FIELD} font-mono`} placeholder="tblxxxxxxxx" />
                          </div>
                          <button onClick={testFeishuApi} className={`w-full py-2 text-xs font-black text-[#26242a] ${STICKER}`}>测试飞书连接</button>
                          <p className="text-[10px] text-[#26242a]/55 leading-relaxed">
                              1. 在 <a href="https://open.feishu.cn/app" target="_blank" className="underline font-bold">飞书开放平台</a> 创建企业自建应用，获取 App ID 和 Secret<br/>
                              2. 在应用权限中添加「多维表格」相关权限<br/>
                              3. 创建一个多维表格，添加字段: 标题(文本)、内容(文本)、日期(日期)、心情(文本)、角色(文本)<br/>
                              4. 从多维表格 URL 中获取 App Token 和 Table ID
                          </p>
                      </div>
                  )}
              </div>

              {/* 小红书 · 本地配置 */}
              <div className="border border-black/10 rounded-xl bg-white p-4 space-y-3 relative">
                  <Tape className="-top-2.5 left-4 rotate-[-3deg] w-10" />
                  <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                          <Book size={20} weight="fill" color={INK} />
                          <span className="text-sm font-black text-[#26242a]">小红书 · 本地</span>
                          <span className="label-mono text-[8px] border border-[#1c1b1a]/40 text-[#26242a]/60 px-1.5 py-0.5">MCP / Skills</span>
                      </div>
                      <InkSwitch on={rtXhsMcpEnabled && rtXhsMode === 'local'} onChange={v => { if (v) { setRtXhsMcpEnabled(true); setRtXhsEnabled(true); setRtXhsMode('local'); } else { setRtXhsMcpEnabled(false); setRtXhsEnabled(false); } }} />
                  </div>
                  <p className="text-[10px] text-[#26242a]/55 leading-relaxed">
                      本地后端：需在电脑上跑 xiaohongshu-mcp 或 xhs-bridge。想免电脑请用下面的「小红书 Lite」。
                  </p>
                  {rtXhsMcpEnabled && rtXhsMode === 'local' && (
                      <div className="space-y-2">
                          <div>
                              <label className={LABEL}>SERVER URL · 服务器地址</label>
                              <input value={rtXhsLocalUrl} onChange={e => setRtXhsLocalUrl(e.target.value)} className={`${FIELD} text-[11px] font-mono`} placeholder="http://localhost:18060/mcp" />
                          </div>
                          <button onClick={testXhsMcp} className={`w-full py-2 text-xs font-black text-[#26242a] ${STICKER}`}>测试小红书连接</button>
                          <div className="grid grid-cols-2 gap-2">
                              <div>
                                  <label className={LABEL}>小红书昵称</label>
                                  <input value={rtXhsNickname} onChange={e => setRtXhsNickname(e.target.value)} className={`${FIELD} text-[11px]`} placeholder="手动填写" />
                              </div>
                              <div>
                                  <label className={LABEL}>用户 ID</label>
                                  <input value={rtXhsUserId} onChange={e => setRtXhsUserId(e.target.value)} className={`${FIELD} text-[11px] font-mono`} placeholder="可不填，用于查看主页" />
                              </div>
                          </div>
                          <p className="text-[10px] text-[#26242a]/55 leading-relaxed">
                              <b>MCP 模式:</b> 下载 xiaohongshu-mcp + 运行脚本，URL 填 http://localhost:18060/mcp（代理则 18061/mcp）<br/>
                              <b>Skills 模式:</b> URL 填 http://localhost:18061/api（需 Python + xhs-bridge.mjs，额外支持视频/长文）<br/>
                              系统按 URL 结尾自动判断（/mcp 或 /api）。
                          </p>
                      </div>
                  )}
              </div>

              {/* 小红书 Lite (云端) */}
              <div className="border border-black/10 rounded-xl bg-white p-4 space-y-3 relative">
                  <Tape className="-top-2.5 right-4 rotate-[3deg] w-10" />
                  <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                          <Book size={20} weight="fill" color={INK} />
                          <span className="text-sm font-black text-[#26242a]">小红书 Lite</span>
                          <span className="label-mono text-[8px] bg-[#1c1b1a] text-white px-1.5 py-0.5">云端 · 推荐</span>
                      </div>
                      <InkSwitch on={rtXhsMcpEnabled && rtXhsMode === 'lite'} onChange={v => { if (v) { if (!window.confirm(XHS_RISK_TEXT + '\n\n确定要开启吗？')) return; setRtXhsMcpEnabled(true); setRtXhsEnabled(true); setRtXhsMode('lite'); } else { setRtXhsMcpEnabled(false); setRtXhsEnabled(false); } }} />
                  </div>
                  <p className="text-[10px] text-[#26242a]/55 leading-relaxed">
                      免电脑、免扫码：粘贴一次小红书 cookie，即可搜索/浏览/详情/点赞/收藏/评论/发帖(带图)。地址已内置，无需填写。
                  </p>
                  <p className="text-[10px] text-[#26242a]/70 leading-relaxed border-2 border-dashed border-[#1c1b1a]/50 px-2 py-1.5">{XHS_RISK_TEXT}</p>
                  {rtXhsMcpEnabled && rtXhsMode === 'lite' && (
                      <div className="space-y-2">
                          <div>
                              <label className={LABEL}>小红书 COOKIE</label>
                              <textarea value={rtXhsCookie} onChange={e => setRtXhsCookie(e.target.value)} rows={2} className={`${FIELD} text-[10px] font-mono resize-y`} placeholder="a1=...; web_session=...; （从浏览器登录后复制完整 cookie）" />
                          </div>
                          <button onClick={testXhsMcp} className={`w-full py-2 text-xs font-black text-[#26242a] ${STICKER}`}>测试小红书连接</button>
                          <div className="grid grid-cols-2 gap-2">
                              <div>
                                  <label className={LABEL}>小红书昵称</label>
                                  <input value={rtXhsNickname} onChange={e => setRtXhsNickname(e.target.value)} className={`${FIELD} text-[11px]`} placeholder="测试连接后自动获取" />
                              </div>
                              <div>
                                  <label className={LABEL}>用户 ID</label>
                                  <input value={rtXhsUserId} onChange={e => setRtXhsUserId(e.target.value)} className={`${FIELD} text-[11px] font-mono`} placeholder="测试连接后自动获取" />
                              </div>
                          </div>
                          <div>
                              <button type="button" onClick={() => setRtXhsGuideOpen(v => !v)} className="text-[11px] font-black text-[#26242a] underline underline-offset-2">Cookie 获取教程 {rtXhsGuideOpen ? '▲' : '▼'}</button>
                              {rtXhsGuideOpen && (
                                  <div className="mt-1 border-2 border-dashed border-[#1c1b1a]/40 p-2 space-y-1.5">
                                      <pre className="text-[10px] text-[#26242a]/70 whitespace-pre-wrap font-sans leading-relaxed">{XHS_COOKIE_GUIDE}</pre>
                                      <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(XHS_COOKIE_GUIDE); addToast('教程已复制', 'success'); } catch { addToast('复制失败，请手动选择文本', 'error'); } }} className={`w-full py-1.5 text-[11px] font-black text-[#26242a] ${STICKER}`}>复制教程</button>
                                  </div>
                              )}
                          </div>
                          <p className="text-[10px] text-[#26242a]/55 leading-relaxed border-l-2 border-[#1c1b1a]/30 pl-2">
                              🔒 隐私：cookie 经 HTTPS 加密发到云端 Worker 仅用于请求签名，服务器<b>不保存、不记录</b>，运营方看不到。正常使用是安全的；但凡经第三方云服务都存在理论风险，介意可自行评估。
                          </p>
                      </div>
                  )}
              </div>

              {/* 麦当劳 MCP */}
              <div className="border border-black/10 rounded-xl bg-white p-4 space-y-3 relative">
                  <Tape className="-top-2.5 left-4 rotate-[-3deg] w-10" />
                  <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                          <ForkKnife size={20} weight="fill" color={INK} />
                          <span className="text-sm font-black text-[#26242a]">麦当劳</span>
                          <span className="label-mono text-[8px] border border-[#1c1b1a]/40 text-[#26242a]/60 px-1.5 py-0.5">官方 MCP</span>
                      </div>
                      <InkSwitch on={mcdEnabled} onChange={v => handleMcdEnabledChange(v)} />
                  </div>
                  <p className="text-[10px] text-[#26242a]/55 leading-relaxed">
                      启用后，在聊天里点 + 号 → 第二页 → 麦当劳，发送"麦请求"激活，角色就能为你查菜单、查门店、点麦乐送/到店取餐/团餐、积分兑券、查活动。
                  </p>
                  {mcdEnabled && (
                      <div className="space-y-2">
                          <div>
                              <label className={LABEL}>MCP TOKEN · 个人</label>
                              <input type="password" value={mcdToken} onChange={e => handleMcdTokenChange(e.target.value)} className={`${FIELD} font-mono`} placeholder="去 open.mcd.cn/mcp 申请" />
                          </div>
                          <button onClick={testMcdApi} disabled={mcdTesting} className={`w-full py-2 text-xs font-black text-[#26242a] disabled:opacity-60 ${STICKER}`}>
                              {mcdTesting ? '测试中…' : '测试麦当劳连接'}
                          </button>
                          {mcdTestStatus && (
                              <div className={`p-2 text-[11px] whitespace-pre-line leading-relaxed border-2 ${mcdTestStatus.startsWith('✅') ? 'border-[#1c1b1a] bg-white text-[#26242a]' : mcdTestStatus.startsWith('❌') ? 'border-dashed border-[#1c1b1a]/60 bg-[#1c1b1a]/5 text-[#26242a]/80' : 'border-[#1c1b1a]/20 text-[#26242a]/70'}`}>
                                  {mcdTestStatus}
                              </div>
                          )}
                          <p className="text-[10px] text-[#26242a]/55 leading-relaxed">
                              1. 访问 <a href="https://open.mcd.cn/mcp" target="_blank" className="underline font-bold">open.mcd.cn/mcp</a> 用麦当劳账号登录申请 Token<br/>
                              2. 粘贴到上面的输入框（仅保存在本机，<b>不会上传服务器</b>）<br/>
                              3. 下单类操作涉及真实支付，角色会先复述清单等你确认再下单<br/>
                              4. 仅中国大陆 (不含港澳台)
                          </p>
                      </div>
                  )}
              </div>

              {/* 测试状态 */}
              {rtTestStatus && (
                  <div className={`p-3 text-xs font-medium text-center border-2 ${rtTestStatus.includes('成功') ? 'border-[#1c1b1a] bg-white text-[#26242a]' : rtTestStatus.includes('失败') || rtTestStatus.includes('错误') ? 'border-dashed border-[#1c1b1a]/60 bg-[#1c1b1a]/5 text-[#26242a]/80' : 'border-[#1c1b1a]/20 bg-white text-[#26242a]/70'}`}>
                      {rtTestStatus}
                  </div>
              )}
          </div>
      </PaperSheet>

      {/* 倒空确认 */}
      <PaperSheet
          open={showResetConfirm}
          tag="RESET"
          title="确认清空全部数据"
          onClose={() => setShowResetConfirm(false)}
          footer={
              <>
                  <button onClick={() => setShowResetConfirm(false)} className={`flex-1 py-3 font-black text-[#26242a] ${STICKER}`}>取消</button>
                  <button onClick={confirmReset} className={`flex-1 py-3 font-black ${INK_BTN}`}>确认清空</button>
              </>
          }
      >
          <div className="flex flex-col items-center gap-3 py-2">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke={INK} className="w-12 h-12"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" /></svg>
              <p className="text-center text-sm text-[#26242a]/80 font-medium">
                  清空会<span className="font-black underline decoration-wavy">永久删除</span>所有角色、聊天记录和设置，且无法恢复。
              </p>
          </div>
      </PaperSheet>

      <InstantPushSettingsModal
        open={showInstantModal}
        onClose={() => setShowInstantModal(false)}
        onOpenVapid={() => { setShowInstantModal(false); setShowVapidModal(true); }}
      />
      <PushVapidSettingsModal
        open={showVapidModal}
        onClose={() => { setShowVapidModal(false); setVapidReadyTick((n) => n + 1); }}
      />

    </div>
  );
};

export default Settings;
