import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { INSTALLED_APPS } from '../constants';
import { AppID, UserScreenWatchFrame, UserScreenWatchSession, UserScreenWatchSettings, UserScreenWatchUsageSlice } from '../types';
import { useOS } from './OSContext';
import { DB } from '../utils/db';
import { callChatCompletion } from '../utils/llmClient';
import { extractContent } from '../utils/safeApi';
import { makeApiUsageMeta } from '../utils/apiUsageCatalog';
import {
  appendUserScreenWatchComment,
  appendUserScreenWatchFrame,
  buildUserScreenWatchSummary,
  canGenerateUserScreenWatchComment,
  captureVideoFrame,
  createUserScreenWatchSession,
  fallbackAppName,
  makeUserScreenWatchTextFrameSummary,
  normalizeUserScreenWatchSettings,
  recordUserScreenWatchUsage,
  sanitizeUserScreenWatchComment,
  USER_SCREEN_WATCH_MAX_SESSIONS,
} from '../utils/userScreenWatch';
import {
  userScreenWatchCommentSystemPrompt,
  userScreenWatchCommentUserPrompt,
  userScreenWatchTextFallbackPrompt,
} from '../utils/laiwangPrompts';

interface UserScreenWatchContextValue {
  session: UserScreenWatchSession | null;
  isSupported: boolean;
  isBusy: boolean;
  isCommenting: boolean;
  lastError: string;
  startWatch: (charId: string, settings?: Partial<UserScreenWatchSettings>) => Promise<void>;
  pauseSampling: () => Promise<void>;
  resumeSampling: () => Promise<void>;
  stopWatch: () => Promise<void>;
  requestCommentNow: () => Promise<void>;
  updateSettings: (updates: Partial<UserScreenWatchSettings>) => Promise<void>;
}

const UserScreenWatchContext = createContext<UserScreenWatchContextValue | null>(null);

const appNameOf = (appId: AppID): string =>
  INSTALLED_APPS.find(app => app.id === appId)?.name || fallbackAppName(appId);

const isVisionUnsupported = (message: string): boolean =>
  /vision|image|图片|图像|多模态|multimodal|unsupported|不支持|invalid.*content/i.test(message || '');

export const UserScreenWatchProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { activeApp, characters, apiConfig, addToast, userProfile } = useOS();
  const [session, setSession] = useState<UserScreenWatchSession | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isCommenting, setIsCommenting] = useState(false);
  const [lastError, setLastError] = useState('');

  const sessionRef = useRef<UserScreenWatchSession | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stoppingRef = useRef(false);
  const activeAppRef = useRef(activeApp);
  const usageRef = useRef<{ appId: AppID; appName: string; startedAt: number } | null>(null);

  const isSupported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;

  useEffect(() => {
    activeAppRef.current = activeApp;
  }, [activeApp]);

  const saveSession = useCallback(async (next: UserScreenWatchSession): Promise<UserScreenWatchSession> => {
    sessionRef.current = next;
    setSession(next);
    await DB.saveUserScreenWatchSession(next, USER_SCREEN_WATCH_MAX_SESSIONS);
    return next;
  }, []);

  const clearSamplingInterval = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => {
      try { track.stop(); } catch { /* ignore */ }
    });
    streamRef.current = null;
    if (videoRef.current) {
      try { videoRef.current.pause(); } catch { /* ignore */ }
      videoRef.current.srcObject = null;
    }
    videoRef.current = null;
  }, []);

  const usageSnapshot = useCallback((base: UserScreenWatchSession, now = Date.now()): UserScreenWatchUsageSlice[] => {
    const current = usageRef.current;
    if (!current || !base.settings.trackMoroUsage) return base.usage || [];
    const endedAt = Math.max(current.startedAt, now);
    return [
      ...(base.usage || []),
      {
        appId: current.appId,
        appName: current.appName,
        startedAt: current.startedAt,
        endedAt,
        durationMs: Math.max(0, endedAt - current.startedAt),
      },
    ];
  }, []);

  const flushUsage = useCallback((base: UserScreenWatchSession, now = Date.now()): UserScreenWatchSession => {
    const current = usageRef.current;
    usageRef.current = null;
    if (!current || !base.settings.trackMoroUsage) return base;
    return recordUserScreenWatchUsage(base, {
      appId: current.appId,
      appName: current.appName,
      startedAt: current.startedAt,
      endedAt: now,
    });
  }, []);

  const beginUsage = useCallback((now = Date.now()) => {
    const current = sessionRef.current;
    if (!current || !current.settings.trackMoroUsage || current.status === 'ended' || current.status === 'error') {
      usageRef.current = null;
      return;
    }
    const appId = activeAppRef.current;
    usageRef.current = { appId, appName: appNameOf(appId), startedAt: now };
  }, []);

  const appendComment = useCallback(async (
    text: string,
    source: 'vision' | 'text' | 'fallback',
    frame?: UserScreenWatchFrame,
  ) => {
    const current = sessionRef.current;
    const cleaned = sanitizeUserScreenWatchComment(text);
    if (!current || !cleaned) return;
    const next = appendUserScreenWatchComment(current, {
      frameId: frame?.id,
      text: cleaned,
      createdAt: Date.now(),
      source,
    });
    await saveSession(next);
  }, [saveSession]);

  const generateComment = useCallback(async (force = false, frame?: UserScreenWatchFrame) => {
    const current = sessionRef.current;
    if (!current || !canGenerateUserScreenWatchComment(current, Date.now(), force)) return;
    if (isCommenting) return;
    setIsCommenting(true);
    try {
      const char = characters.find(c => c.id === current.charId);
      const userName = userProfile?.name || '用户';
      const usage = usageSnapshot(current);
      const frameText = makeUserScreenWatchTextFrameSummary(frame || current.frames.slice(-1)[0], usage);
      if (!apiConfig.baseUrl || !apiConfig.model) {
        await appendComment('我先看到了。配好聊天 API 后，这一眼我就能接着吐槽。', 'fallback', frame);
        return;
      }

      const promptParams = {
        charName: current.charName,
        userName,
        personaBrief: char?.systemPrompt || char?.description || '',
        frameText,
        hasImage: !!frame?.imageDataUrl,
      };
      const meta = makeApiUsageMeta('chat.userScreenWatch.comment', {
        charId: current.charId,
        charName: current.charName,
        apiRole: 'main',
        apiBinding: '观屏评论',
      });

      let text = '';
      let source: 'vision' | 'text' = frame?.imageDataUrl ? 'vision' : 'text';
      if (frame?.imageDataUrl) {
        try {
          const data = await callChatCompletion(apiConfig, {
            model: apiConfig.model,
            messages: [
              { role: 'system', content: userScreenWatchCommentSystemPrompt(promptParams) },
              {
                role: 'user',
                content: [
                  { type: 'text', text: userScreenWatchCommentUserPrompt(true) },
                  { type: 'image_url', image_url: { url: frame.imageDataUrl } },
                ],
              },
            ],
            temperature: 0.82,
            max_tokens: 180,
            stream: false,
          }, { meta, maxRetries: 1 });
          text = extractContent(data) || '';
        } catch (err: any) {
          if (!isVisionUnsupported(err?.message || String(err))) throw err;
          source = 'text';
        }
      }

      if (!text.trim()) {
        const data = await callChatCompletion(apiConfig, {
          model: apiConfig.model,
          messages: [
            { role: 'system', content: userScreenWatchTextFallbackPrompt({ ...promptParams, hasImage: false }) },
            { role: 'user', content: userScreenWatchCommentUserPrompt(false) },
          ],
          temperature: 0.82,
          max_tokens: 180,
          stream: false,
        }, { meta, maxRetries: 1 });
        text = extractContent(data) || '';
        source = 'text';
      }
      const cleanedText = sanitizeUserScreenWatchComment(text);
      await appendComment(cleanedText || '这一眼我先记下了。', source, frame);
    } catch (err: any) {
      const message = err?.message || '观屏评论生成失败';
      setLastError(message);
      await appendComment('这一眼我先记着，刚才那句没顺利说出来。', 'fallback', frame);
    } finally {
      setIsCommenting(false);
    }
  }, [apiConfig, appendComment, characters, isCommenting, usageSnapshot, userProfile?.name]);

  const sampleOnce = useCallback(async (forceComment = false) => {
    const current = sessionRef.current;
    if (!current || current.status === 'ended' || current.status === 'error') return;
    if (current.status === 'paused' && !forceComment) return;

    let next = current;
    let frame = next.frames.slice(-1)[0];
    if (current.status === 'active' && current.settings.captureFrames && videoRef.current) {
      try {
        const imageDataUrl = await captureVideoFrame(videoRef.current, 480, 0.62);
        if (imageDataUrl) {
          next = appendUserScreenWatchFrame(current, {
            capturedAt: Date.now(),
            imageDataUrl,
            sourceLabel: '用户主动共享的屏幕',
            summary: '用户主动共享期间抽取的一帧缩略图；真实系统 App 只能由视觉内容谨慎推测。',
          });
          frame = next.frames.slice(-1)[0];
          await saveSession(next);
        }
      } catch (err: any) {
        setLastError(err?.message || '截图抽帧失败');
      }
    }

    const latest = sessionRef.current || next;
    if (canGenerateUserScreenWatchComment(latest, Date.now(), forceComment)) {
      await generateComment(forceComment, frame);
    }
  }, [generateComment, saveSession]);

  const stopWatch = useCallback(async () => {
    const current = sessionRef.current;
    if (!current || stoppingRef.current) return;
    stoppingRef.current = true;
    clearSamplingInterval();
    try {
      const now = Date.now();
      let next = flushUsage(current, now);
      const summary = buildUserScreenWatchSummary({ ...next, endedAt: now, status: 'ended', updatedAt: now });
      next = {
        ...next,
        status: 'ended',
        endedAt: now,
        updatedAt: now,
        summary,
      };
      await saveSession(next);
      const summaryCard = {
        id: `usw-card-${next.id}`,
        sessionId: next.id,
        charId: next.charId,
        charName: next.charName,
        startedAt: next.startedAt,
        endedAt: now,
        summary,
        usage: next.usage || [],
        frameCount: (next.frames || []).length,
        commentCount: (next.comments || [])
          .filter(c => c.source !== 'summary')
          .map(c => sanitizeUserScreenWatchComment(c.text))
          .filter(Boolean)
          .length,
        latestComments: (next.comments || [])
          .filter(c => c.source !== 'summary')
          .map(c => sanitizeUserScreenWatchComment(c.text))
          .filter(Boolean)
          .slice(-3),
      };
      await DB.saveMessage({
        charId: next.charId,
        role: 'system',
        type: 'screen_watch_card',
        content: JSON.stringify(summaryCard),
        metadata: { userScreenWatchSummary: summaryCard, excludeFromContext: true },
      } as any);
      addToast('观屏评论已停止', 'success');
    } catch (err: any) {
      setLastError(err?.message || '停止观屏失败');
    } finally {
      stopTracks();
      usageRef.current = null;
      sessionRef.current = null;
      setSession(null);
      stoppingRef.current = false;
    }
  }, [addToast, clearSamplingInterval, flushUsage, saveSession, stopTracks]);

  const startWatch = useCallback(async (charId: string, settings?: Partial<UserScreenWatchSettings>) => {
    if (!isSupported) {
      const message = '当前浏览器不支持屏幕共享';
      setLastError(message);
      addToast(message, 'error');
      return;
    }
    const char = characters.find(c => c.id === charId);
    if (!char) return;
    if (sessionRef.current) await stopWatch();
    setIsBusy(true);
    setLastError('');
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const [track] = stream.getVideoTracks();
      if (!track) throw new Error('没有可用的视频共享轨道');
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      streamRef.current = stream;
      videoRef.current = video;

      const displayName = char.convoSettings?.remarkName?.trim() || char.name;
      const next = createUserScreenWatchSession({ charId: char.id, charName: displayName, settings });
      await saveSession(next);
      beginUsage();
      track.addEventListener('ended', () => { void stopWatch(); }, { once: true });
      addToast('已开始观屏评论：浏览器共享期间才会采样', 'success');
    } catch (err: any) {
      stopTracks();
      const name = err?.name || '';
      const cancelled = /AbortError|NotAllowedError|Permission/i.test(name) || /cancel|denied|permission|取消|拒绝/i.test(err?.message || '');
      if (cancelled) {
        addToast('已取消屏幕共享', 'info');
      } else {
        const message = err?.message || '无法开始屏幕共享';
        setLastError(message);
        addToast(message, 'error');
      }
    } finally {
      setIsBusy(false);
    }
  }, [addToast, beginUsage, characters, isSupported, saveSession, stopTracks, stopWatch]);

  const pauseSampling = useCallback(async () => {
    const current = sessionRef.current;
    if (!current || current.status !== 'active') return;
    await saveSession({ ...current, status: 'paused', updatedAt: Date.now() });
    addToast('观屏采样已暂停', 'info');
  }, [addToast, saveSession]);

  const resumeSampling = useCallback(async () => {
    const current = sessionRef.current;
    if (!current || current.status !== 'paused') return;
    await saveSession({ ...current, status: 'active', updatedAt: Date.now() });
    addToast('观屏采样已继续', 'success');
  }, [addToast, saveSession]);

  const updateSettings = useCallback(async (updates: Partial<UserScreenWatchSettings>) => {
    const current = sessionRef.current;
    if (!current) return;
    let base = current;
    if (current.settings.trackMoroUsage && updates.trackMoroUsage === false) {
      base = flushUsage(current, Date.now());
    }
    const nextSettings = normalizeUserScreenWatchSettings({ ...base.settings, ...updates });
    const next = { ...base, settings: nextSettings, updatedAt: Date.now() };
    await saveSession(next);
    if (!current.settings.trackMoroUsage && nextSettings.trackMoroUsage) beginUsage();
  }, [beginUsage, flushUsage, saveSession]);

  const requestCommentNow = useCallback(async () => {
    if (!sessionRef.current) return;
    await sampleOnce(true);
  }, [sampleOnce]);

  useEffect(() => {
    const current = sessionRef.current;
    if (!current || current.status === 'ended' || current.status === 'error') {
      usageRef.current = null;
      return;
    }
    if (!current.settings.trackMoroUsage) {
      usageRef.current = null;
      return;
    }
    const now = Date.now();
    let next = current;
    if (usageRef.current) next = flushUsage(current, now);
    usageRef.current = { appId: activeApp, appName: appNameOf(activeApp), startedAt: now };
    if (next !== current) void saveSession(next);
  }, [activeApp, flushUsage, saveSession, session?.id, session?.settings.trackMoroUsage, session?.status]);

  useEffect(() => {
    clearSamplingInterval();
    const current = sessionRef.current;
    if (!current || current.status !== 'active') return;
    intervalRef.current = setInterval(() => { void sampleOnce(false); }, current.settings.sampleIntervalMs);
    return clearSamplingInterval;
  }, [clearSamplingInterval, sampleOnce, session?.id, session?.settings.sampleIntervalMs, session?.settings.captureFrames, session?.status]);

  useEffect(() => () => {
    clearSamplingInterval();
    stopTracks();
  }, [clearSamplingInterval, stopTracks]);

  const value = useMemo<UserScreenWatchContextValue>(() => ({
    session,
    isSupported,
    isBusy,
    isCommenting,
    lastError,
    startWatch,
    pauseSampling,
    resumeSampling,
    stopWatch,
    requestCommentNow,
    updateSettings,
  }), [isBusy, isCommenting, isSupported, lastError, pauseSampling, requestCommentNow, resumeSampling, session, startWatch, stopWatch, updateSettings]);

  return (
    <UserScreenWatchContext.Provider value={value}>
      {children}
    </UserScreenWatchContext.Provider>
  );
};

export function useUserScreenWatch(): UserScreenWatchContextValue {
  const ctx = useContext(UserScreenWatchContext);
  if (!ctx) throw new Error('useUserScreenWatch must be used inside UserScreenWatchProvider');
  return ctx;
}
