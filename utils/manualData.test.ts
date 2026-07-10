import { describe, expect, it } from 'vitest';
import {
  getManualUpdateNotices,
  groupManualUpdateNoticesByDate,
  MANUAL_DESTINATIONS,
  MANUAL_ENTRIES,
  MANUAL_UPDATE_NOTICE_DATE_PINNED_HEADLINES,
  MANUAL_UPDATE_NOTICES,
  flattenManualSettings,
} from '../apps/manual/manualData';
import {
  getLatestManualUpdateNotice,
  getPendingLatestManualUpdateDateNotices,
  getPendingManualUpdateNotice,
  getPendingManualUpdateNotices,
  MANUAL_UPDATE_NOTICE_SEEN_KEY,
  markManualUpdateNoticeSeen,
} from './manualUpdateNotice';

const fakeStorage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
  };
};

describe('manual update notices', () => {
  it('uses unique ids', () => {
    const ids = MANUAL_UPDATE_NOTICES.map(notice => notice.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has complete user-facing content', () => {
    for (const notice of MANUAL_UPDATE_NOTICES) {
      expect(notice.id.trim()).toBeTruthy();
      expect(Number.isNaN(Date.parse(notice.date))).toBe(false);
      expect(notice.title.trim()).toBeTruthy();
      expect(notice.summary.trim()).toBeTruthy();
      expect(notice.items.length).toBeGreaterThan(0);
      expect(notice.items.every(item => item.trim().length > 0)).toBe(true);
    }
  });

  it('returns notices newest first', () => {
    const sorted = getManualUpdateNotices();

    for (let i = 1; i < sorted.length; i += 1) {
      expect(Date.parse(sorted[i - 1].date)).toBeGreaterThanOrEqual(Date.parse(sorted[i].date));
    }
  });

  it('keeps same-day notices in data order', () => {
    const sorted = getManualUpdateNotices();
    const dateWithMultiple = MANUAL_UPDATE_NOTICES.find((notice, index, all) =>
      all.findIndex(item => item.date === notice.date) !== index,
    )?.date;

    expect(dateWithMultiple).toBeTruthy();
    expect(sorted.filter(notice => notice.date === dateWithMultiple).map(notice => notice.id)).toEqual(
      MANUAL_UPDATE_NOTICES.filter(notice => notice.date === dateWithMultiple).map(notice => notice.id),
    );
  });

  it('groups notices by update date without changing order', () => {
    const sorted = getManualUpdateNotices();
    const groups = groupManualUpdateNoticesByDate(sorted);

    expect(groups.flatMap(group => group.notices.map(notice => notice.id))).toEqual(
      sorted.map(notice => notice.id),
    );
    expect(new Set(groups.map(group => group.date)).size).toBe(groups.length);
  });

  it('adds pinned headlines to matching update dates', () => {
    const sorted = getManualUpdateNotices();
    const groups = groupManualUpdateNoticesByDate(sorted);

    Object.entries(MANUAL_UPDATE_NOTICE_DATE_PINNED_HEADLINES).forEach(([date, headline]) => {
      expect(groups.find(group => group.date === date)?.pinnedHeadline).toBe(headline);
    });
  });

  it('queues every unseen notice once', () => {
    const storage = fakeStorage();
    const latest = getLatestManualUpdateNotice();
    expect(latest).toBeTruthy();

    expect(getPendingManualUpdateNotices(storage).map(notice => notice.id)).toEqual(
      getManualUpdateNotices().map(notice => notice.id),
    );
    expect(getPendingManualUpdateNotice(storage)?.id).toBe(latest!.id);
    markManualUpdateNoticeSeen(latest!.id, storage);

    expect(JSON.parse(storage.getItem(MANUAL_UPDATE_NOTICE_SEEN_KEY) || '[]')).toContain(latest!.id);
    expect(getPendingManualUpdateNotices(storage).some(notice => notice.id === latest!.id)).toBe(false);
    expect(getPendingManualUpdateNotices(storage).length).toBe(Math.max(0, MANUAL_UPDATE_NOTICES.length - 1));
  });

  it('only pops unread notices from the latest update date', () => {
    const storage = fakeStorage();
    const sorted = getManualUpdateNotices();
    const latestDate = sorted[0]?.date;
    expect(latestDate).toBeTruthy();

    expect(getPendingLatestManualUpdateDateNotices(storage).map(notice => notice.id)).toEqual(
      sorted.filter(notice => notice.date === latestDate).map(notice => notice.id),
    );

    sorted
      .filter(notice => notice.date === latestDate)
      .forEach(notice => markManualUpdateNoticeSeen(notice.id, storage));

    expect(getPendingManualUpdateNotices(storage).some(notice => notice.date !== latestDate)).toBe(true);
    expect(getPendingLatestManualUpdateDateNotices(storage)).toEqual([]);
  });

  it('does not queue already-read notices again on later checks', () => {
    const storage = fakeStorage();
    for (const notice of getManualUpdateNotices()) {
      markManualUpdateNoticeSeen(notice.id, storage);
    }

    expect(getPendingManualUpdateNotice(storage)).toBeNull();
    expect(getPendingManualUpdateNotices(storage)).toEqual([]);
  });

  it('keeps legacy single-id seen storage compatible', () => {
    const storage = fakeStorage();
    const latest = getLatestManualUpdateNotice();
    expect(latest).toBeTruthy();
    storage.setItem(MANUAL_UPDATE_NOTICE_SEEN_KEY, latest!.id);

    expect(getPendingManualUpdateNotices(storage).some(notice => notice.id === latest!.id)).toBe(false);
  });
});

describe('manual guide data', () => {
  it('uses unique entry names', () => {
    const names = MANUAL_ENTRIES.map(entry => entry.app);
    expect(new Set(names).size).toBe(names.length);
  });

  it('has a guide entry for every destination', () => {
    const entryNames = new Set(MANUAL_ENTRIES.map(entry => entry.app));

    for (const destinationName of Object.keys(MANUAL_DESTINATIONS)) {
      expect(entryNames.has(destinationName)).toBe(true);
    }
  });

  it('keeps the stock gallery as a gallery sub-entry instead of a legacy app', () => {
    expect(MANUAL_ENTRIES.find(entry => entry.app === '拾光图库')).toBeUndefined();
    expect(MANUAL_DESTINATIONS['拾光图库']).toBeUndefined();

    const stockEntry = MANUAL_ENTRIES.find(entry => entry.app === '相册·拾光素材');
    expect(stockEntry).toBeTruthy();
    expect(stockEntry?.keywords || []).toContain('拾光图库');
    expect(MANUAL_DESTINATIONS['相册·拾光素材']?.deepLink?.route).toBe('stock');
  });

  it('uses unique setting ids', () => {
    const ids = flattenManualSettings().map(({ setting }) => setting.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps user-facing entries complete enough to read without guessing', () => {
    for (const entry of MANUAL_ENTRIES) {
      if (entry.devOnly) continue;

      expect(entry.summary.trim().length).toBeGreaterThan(12);
      expect(entry.features.length).toBeGreaterThanOrEqual(4);
      expect(entry.beginnerSteps?.length || 0).toBeGreaterThanOrEqual(3);
      expect(entry.commonQuestions?.length || 0).toBeGreaterThanOrEqual(3);
      expect(entry.tips?.length || 0).toBeGreaterThanOrEqual(1);
      expect((entry.settingSections || []).length).toBeGreaterThanOrEqual(1);
      expect((entry.settingSections || []).flatMap(section => section.settings).length).toBeGreaterThanOrEqual(4);
    }
  });

  it('keeps settings descriptive and searchable', () => {
    for (const { entry, section, setting } of flattenManualSettings()) {
      expect(entry.app.trim()).toBeTruthy();
      expect(section.id.trim()).toBeTruthy();
      expect(setting.id.trim()).toBeTruthy();
      expect(setting.title.trim()).toBeTruthy();
      expect(setting.description.trim().length).toBeGreaterThan(8);
      if (setting.path) {
        expect(setting.path.every(step => step.trim().length > 0)).toBe(true);
      }
      if (setting.keywords) {
        expect(setting.keywords.every(keyword => keyword.trim().length > 0)).toBe(true);
      }
    }
  });

  it('documents the default-off Moro preset seed', () => {
    const presetEntry = MANUAL_ENTRIES.find(entry => entry.en === 'Presets');
    const notice = MANUAL_UPDATE_NOTICES.find(item => item.id === '2026-07-03-preset-default-seed');

    expect(notice?.summary).toContain('默认不接管聊天');
    expect(presetEntry?.features.join('\n')).toContain('默认关闭');
    expect(presetEntry?.beginnerSteps?.join('\n')).toContain('默认关闭');
  });

  it('documents the chat hub dashboard entry and destination', () => {
    const chat = MANUAL_ENTRIES.find(entry => entry.app === '絮语');
    const dashboard = MANUAL_ENTRIES.find(entry => entry.app === '絮语·总览');

    expect(MANUAL_UPDATE_NOTICES.some(notice => notice.id === '2026-07-03-chat-hub-dashboard-v2')).toBe(true);
    expect(chat?.features.join('\n')).toContain('絮语总览');
    expect(dashboard?.settingSections?.[0].settings.map(setting => setting.id)).toContain('chat-dashboard-followups');
    expect(MANUAL_DESTINATIONS['絮语·总览']?.deepLink?.route).toBe('dashboard');
  });

  it('documents private chat user screen watch boundaries', () => {
    const tools = MANUAL_ENTRIES.find(entry => entry.app === '絮语·单聊工具');
    const notice = MANUAL_UPDATE_NOTICES.find(item => item.id === '2026-07-03-chat-user-screen-watch');
    const text = [
      notice?.summary,
      ...(notice?.items || []),
      tools?.summary,
      ...(tools?.features || []),
      ...(tools?.settingSections || []).flatMap(section => section.settings.flatMap(setting => [
        setting.title,
        setting.description,
        ...(setting.options || []).map(option => `${option.label}${option.description}`),
      ])),
      ...(MANUAL_DESTINATIONS['絮语·单聊工具']?.details || []),
    ].join('\n');

    expect(notice).toBeTruthy();
    expect(text).toContain('观屏评论');
    expect(text).toContain('主动共享');
    expect(text).toContain('Moro 内部');
    expect(text).toContain('不会读取真实系统后台 App 列表');
    expect(text).toContain('不会创建 Android 全局悬浮窗');
  });

  it('documents chat phone watch meta-analysis guard', () => {
    const notice = MANUAL_UPDATE_NOTICES.find(item => item.id === '2026-07-04-chat-phone-watch-meta-guard');
    const text = [notice?.summary, ...(notice?.items || [])].join('\n');

    expect(notice).toBeTruthy();
    expect(text).toContain('查岗');
    expect(text).toContain('观屏');
    expect(text).toContain('以我的性格');
    expect(text).toContain('不会把查岗脚本和人设分析念出来');
  });

  it('documents check-phone secret space', () => {
    const notice = MANUAL_UPDATE_NOTICES.find(item => item.id === '2026-07-04-check-phone-secret-space');
    const setting = flattenManualSettings().find(({ setting }) => setting.id === 'chat-check-phone-tool')?.setting;
    const destination = MANUAL_DESTINATIONS['絮语查岗·秘密空间'];
    const tools = MANUAL_ENTRIES.find(entry => entry.app === '絮语·单聊工具');
    const text = [
      notice?.summary,
      ...(notice?.items || []),
      setting?.description,
      setting?.defaultBehavior,
      ...(setting?.options || []).map(option => `${option.label}${option.description}`),
      ...(destination?.details || []),
      ...(tools?.keywords || []),
    ].join('\n');

    expect(notice).toBeTruthy();
    expect(setting).toBeTruthy();
    expect(destination).toBeTruthy();
    expect(text).toContain('查岗');
    expect(text).toContain('秘密空间');
    expect(text).toContain('未发送');
    expect(text).toContain('私密笔记');
    expect(text).toContain('心愿');
    expect(text).toContain('不会读取现实手机');
  });

  it('documents richer check-phone density and chat snippets', () => {
    const notice = MANUAL_UPDATE_NOTICES.find(item => item.id === '2026-07-10-check-phone-density');
    const setting = flattenManualSettings().find(({ setting }) => setting.id === 'chat-check-phone-tool')?.setting;
    const tools = MANUAL_ENTRIES.find(entry => entry.app === '絮语·单聊工具');
    const destination = MANUAL_DESTINATIONS['絮语·单聊工具'];
    const text = [
      notice?.summary,
      ...(notice?.items || []),
      tools?.summary,
      ...(tools?.features || []),
      ...(tools?.keywords || []),
      setting?.description,
      setting?.defaultBehavior,
      ...(setting?.options || []).map(option => `${option.label}${option.description}`),
      ...(destination?.details || []),
    ].join('\n');

    expect(notice).toBeTruthy();
    expect(setting).toBeTruthy();
    expect(text).toContain('查岗');
    expect(text).toContain('多联系人');
    expect(text).toContain('群聊');
    expect(text).toContain('多行对话');
    expect(text).toContain('生活碎片');
    expect(text).toContain('不会读取现实手机');
  });

  it('documents private chat force reply setting', () => {
    const notice = MANUAL_UPDATE_NOTICES.find(item => item.id === '2026-07-04-chat-force-reply');
    const setting = flattenManualSettings().find(({ setting }) => setting.id === 'chat-force-reply')?.setting;
    const destination = MANUAL_DESTINATIONS['絮语·单聊设置'];
    const text = [
      notice?.summary,
      ...(notice?.items || []),
      setting?.title,
      setting?.description,
      ...(setting?.options || []).map(option => `${option.label}${option.description}`),
      ...(destination?.details || []),
    ].join('\n');

    expect(notice).toBeTruthy();
    expect(setting).toBeTruthy();
    expect(text).toContain('强制你回话');
    expect(text).toContain('立即回复');
    expect(text).toContain('可见消息');
    expect(text).toContain('默认关闭');
  });

  it('documents private chat long-distance mode', () => {
    const notice = MANUAL_UPDATE_NOTICES.find(item => item.id === '2026-07-04-chat-long-distance-mode');
    const setting = flattenManualSettings().find(({ setting }) => setting.id === 'chat-long-distance-mode')?.setting;
    const destination = MANUAL_DESTINATIONS['絮语·单聊设置'];
    const text = [
      notice?.summary,
      ...(notice?.items || []),
      setting?.title,
      setting?.description,
      setting?.defaultBehavior,
      ...(setting?.options || []).map(option => `${option.label}${option.description}`),
      ...(destination?.details || []),
    ].join('\n');

    expect(notice).toBeTruthy();
    expect(setting).toBeTruthy();
    expect(text).toContain('异地模式');
    expect(text).toContain('远距离');
    expect(text).toContain('自动关闭');
    expect(text).toContain('手动点「见面」仍可进入');
    expect(text).toContain('不影响你手动点“见面 / 赴个约”');
  });

  it('documents user-requested private chat avatar changes', () => {
    const notice = MANUAL_UPDATE_NOTICES.find(item => item.id === '2026-07-05-chat-user-request-avatar-change');
    const setting = flattenManualSettings().find(({ setting }) => setting.id === 'chat-photo-assets')?.setting;
    const destination = MANUAL_DESTINATIONS['絮语·单聊设置'];
    const entry = MANUAL_ENTRIES.find(item => item.app === '絮语·单聊设置');
    const text = [
      notice?.summary,
      ...(notice?.items || []),
      setting?.title,
      setting?.description,
      ...(setting?.options || []).map(option => `${option.label}${option.description}`),
      ...(destination?.details || []),
      ...(entry?.features || []),
      ...(entry?.tips || []),
      ...(entry?.keywords || []),
    ].join('\n');

    expect(notice).toBeTruthy();
    expect(setting).toBeTruthy();
    expect(text).toContain('用户发出的图片');
    expect(text).toContain('TA 同意');
    expect(text).toContain('头像会自动变化');
    expect(text).toContain('可撤回');
    expect(text).toContain('同步到角色卡');
  });

  it('documents stable private chat avatar changes through interruptions and refreshes', () => {
    const notice = MANUAL_UPDATE_NOTICES.find(item => item.id === '2026-07-08-chat-char-avatar-change-interruption');
    const text = [notice?.summary, ...(notice?.items || [])].join('\n');

    expect(notice).toBeTruthy();
    expect(text).toContain('头像');
    expect(text).toContain('查岗');
    expect(text).toContain('线下');
    expect(text).toContain('刷新');
    expect(text).toContain('提示');
    expect(text).toContain('不会反复刷系统记录');
  });

  it('documents automatic offline detection for private and group chats', () => {
    const notice = MANUAL_UPDATE_NOTICES.find(item => item.id === '2026-07-05-chat-auto-offline-detection');
    const groupEntry = MANUAL_ENTRIES.find(entry => entry.app === '絮语·群聊设置');
    const groupSetting = flattenManualSettings().find(({ setting }) => setting.id === 'group-voice-and-words')?.setting;
    const destination = MANUAL_DESTINATIONS['絮语·群聊设置'];
    const text = [
      notice?.summary,
      ...(notice?.items || []),
      ...(groupEntry?.features || []),
      groupSetting?.description,
      groupSetting?.defaultBehavior,
      ...(groupSetting?.options || []).map(option => `${option.label}${option.description}`),
      ...(destination?.details || []),
      ...(groupEntry?.keywords || []),
    ].join('\n');

    expect(notice).toBeTruthy();
    expect(groupSetting).toBeTruthy();
    expect(text).toContain('聊着聊着就见面');
    expect(text).toContain('聊着聊着就赴约');
    expect(text).toContain('默认关闭');
    expect(text).toContain('到场');
    expect(text).toContain('碰头');
    expect(text).toContain('同处现场');
    expect(text).toContain('自动赴约');
    expect(text).toContain('明天下午三点楼下见');
    expect(text).toContain('到点再自动');
  });

  it('documents local map cards for chat locations', () => {
    const notice = MANUAL_UPDATE_NOTICES.find(item => item.id === '2026-07-04-chat-location-map');
    const chat = MANUAL_ENTRIES.find(entry => entry.app === '絮语');
    const tools = MANUAL_ENTRIES.find(entry => entry.app === '絮语·单聊工具');
    const text = [
      notice?.summary,
      ...(notice?.items || []),
      ...(chat?.features || []),
      ...(chat?.keywords || []),
      ...(tools?.features || []),
      ...(tools?.keywords || []),
    ].join('\n');

    expect(notice).toBeTruthy();
    expect(text).toContain('落脚点');
    expect(text).toContain('地图');
    expect(text).toContain('本地虚拟');
    expect(text).toContain('不会读取真实定位');
  });
});
