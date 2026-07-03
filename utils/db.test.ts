import { describe, it, expect, vi } from 'vitest';
import { DB, openDB } from './db';
import { makeChatAlarm, prepareAlarmForSave } from './chatAlarms';
import { preparePeriodReminderSettings } from './periodReminders';
import { makeHealthPlan, makeHealthRecord, normalizeHealthReminder, prepareHealthModuleSettings, summarizeHealthDay } from './health';
import { createDefaultDesktopPetState } from './desktopPet';
import { collectLocalStorageSnapshot, restoreLocalStorageSnapshot, shouldBackupLocalStorageKey } from './localStorageBackup';
import type { CharacterProfile, ChatAlarm, ChatFollowup, ChatHubDigest, CollectionItem, FullBackupData, PeriodCycleEvent, PeriodReminderSettings, Persona, RelationshipNetworkAutoSettings, RelationshipNetworkEdge, RelationshipNetworkMessage, SocialPost, TakeoutOrder, TheaterFauxPiece, TheaterReflectionSession, XhsFeedPost } from '../types';

// fake-indexeddb 已通过 test-setup.ts 注入。这组用例锁住「单例连接复用」这条修复:
// 修复前 openDB 每次调用都 indexedDB.open() 新开一条连接 (a !== b, 且每个 DB 操作
// 都触发一次 open) —— 在记忆管线并发下堆出几十条连接撑爆 backing store。修复后复用
// 同一条连接。

describe('openDB 单例连接复用', () => {
  it('多次 openDB 返回同一条连接 (不再每次新开)', async () => {
    const a = await openDB();
    const b = await openDB();
    expect(a).toBe(b);
  });

  it('连续 DB 操作复用已缓存连接, 不再触发新的 indexedDB.open', async () => {
    await openDB(); // 确保单例已建立 (幂等)
    const openSpy = vi.spyOn(indexedDB, 'open');
    try {
      await DB.getAllCharacters();
      await DB.getAllCharacters();
      await DB.getAllCharacters();
      expect(openSpy).not.toHaveBeenCalled();
    } finally {
      openSpy.mockRestore();
    }
  });
});

// 单例只解决「复用」, 还得保证连接被外部失效后能自愈, 否则下次拿到的还是死连接。
// 这里直接触发挂在连接上的 onversionchange / onclose 回调, 验证缓存被清、下次 openDB 重开。
describe('openDB 失效自愈', () => {
  it('onversionchange 触发后 close 让位并清缓存, 下次 openDB 重开新连接', async () => {
    const a = await openDB();
    // 模拟另一个 tab 升级版本时浏览器派发的 versionchange
    (a as unknown as { onversionchange?: (e: Event) => void }).onversionchange?.(new Event('versionchange'));
    const b = await openDB();
    expect(b).not.toBe(a);
  });

  it('onclose 触发后清缓存, 下次 openDB 重开新连接', async () => {
    const a = await openDB();
    // 真实场景: 浏览器是先强制关闭连接、再 fire close 事件。先 close(a) 让 fake-indexeddb
    // 进入"连接已关"的真实状态 (否则 a 会作为一条开着的孤儿连接残留, 拖累后面的删库),
    // 再手动触发我们挂的 onclose 处理器 (它只负责清缓存, 不负责关连接)。
    a.close();
    (a as unknown as { onclose?: (e: Event) => void }).onclose?.(new Event('close'));
    const b = await openDB();
    expect(b).not.toBe(a);
  });

  it('陈旧连接迟到的 onclose 不误清已重开的新单例 (=== promise 守卫)', async () => {
    const a = await openDB();
    // 重开: 触发 a 的 onversionchange (会 close a + 清缓存), 再 openDB 拿到新单例 b
    (a as unknown as { onversionchange?: (e: Event) => void }).onversionchange?.(new Event('versionchange'));
    const b = await openDB();
    expect(b).not.toBe(a);
    // 此刻才迟到触发 a (陈旧连接) 的 onclose —— 不带守卫会把 b 误清成 null，
    // 下次 openDB 凭空多开一条连接 (正是本次要消灭的 churn)。带守卫则 b 保留。
    (a as unknown as { onclose?: (e: Event) => void }).onclose?.(new Event('close'));
    const c = await openDB();
    expect(c).toBe(b);
  });
});

// 现有版本高于当前 build 的 DB_VERSION 时 (用户先跑过更新的 build / 另一 tab 升过级 /
// SW 缓存了更新的 bundle), 带 DB_VERSION 打开会抛 VersionError —— 旧逻辑直接 reject,
// 整个 origin 的 IndexedDB 全挂 (SYSTEM ERROR、美化读不出来、线下进不去)。修复后回退到
// 「不带版本号打开」, 连到现有更高版本 (store 是超集, 读写兼容)。
describe('openDB 版本回退 (现有版本高于当前 build)', () => {
  it('遇到 VersionError 时不带版本号回退打开, 不再整库报错', async () => {
    await DB.deleteDB(); // 复位 + 清掉单例连接

    // 裸开一条「比 DB_VERSION 更高」的连接建库后关闭, 制造现有版本偏高的现场
    const hi = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('AetherOS_Data', 999);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    hi.close();

    // openDB 带 DB_VERSION(<999) 打开 → VersionError → 回退到不带版本号 → 连到 v999
    const db = await openDB();
    expect(db).toBeTruthy();
    expect(db.version).toBe(999);

    await DB.deleteDB(); // 收尾, 避免污染后续用例
  });
});

describe('DB.deleteDB', () => {
  it('删库前先关掉单例连接, 不被本页自己的连接 block', async () => {
    await openDB(); // 建立单例连接
    // 修复前: 单例连接一直开着 → deleteDatabase 被 onblocked 卡住, 这里会 hang/超时。
    // 修复后: deleteDB 先 close 单例再删, 正常 resolve。
    await expect(DB.deleteDB()).resolves.toBeUndefined();
  });
});

describe('chat timeline recent messages', () => {
  it('can count and load only messages visible in the private chat timeline', async () => {
    await DB.deleteDB();
    const charId = 'timeline-char';
    const visible = (m: any) =>
      !m.groupId
      && m.metadata?.source !== 'date'
      && m.metadata?.source !== 'call'
      && !m.metadata?.proactiveHint;

    await DB.saveMessage({ charId, role: 'user', type: 'text', content: 'old 1', timestamp: 1 });
    await DB.saveMessage({ charId, role: 'system', type: 'text', content: 'schedule', timestamp: 2, metadata: { source: 'date' } });
    await DB.saveMessage({ charId, role: 'assistant', type: 'text', content: 'old 2', timestamp: 3 });
    await DB.saveMessage({ charId, role: 'user', type: 'text', content: 'hidden hint', timestamp: 4, metadata: { proactiveHint: true, hidden: true } as any });
    await DB.saveMessage({ charId, role: 'assistant', type: 'text', content: 'old 3', timestamp: 5 });
    await DB.saveMessage({ charId, role: 'system', type: 'text', content: 'call', timestamp: 6, metadata: { source: 'call' } });
    await DB.saveMessage({ charId, role: 'user', type: 'text', content: 'new 4', timestamp: 7 });

    const result = await DB.getRecentMessagesWithCount(charId, 3, visible);

    expect(result.totalCount).toBeGreaterThan(result.messages.length);
    expect(result.messages.map(m => m.content)).toEqual(['old 2', 'old 3', 'new 4']);

    const fullResult = await DB.getRecentMessagesWithCount(charId, 30, visible);
    expect(fullResult.totalCount).toBe(4);
    expect(fullResult.messages.map(m => m.content)).toEqual(['old 1', 'old 2', 'old 3', 'new 4']);
  });
});

describe('social post indexes and unread helpers', () => {
  const makePost = (id: string, patch: Partial<SocialPost> = {}): SocialPost => ({
    id,
    authorName: '角色',
    authorAvatar: '',
    title: '',
    content: id,
    images: [],
    likes: 0,
    isCollected: false,
    isLiked: false,
    comments: [],
    timestamp: Date.now(),
    tags: [],
    authorType: 'character',
    authorCharId: 'char-a',
    visibility: 'public',
    lastActivityAt: Date.now(),
    ...patch,
  });

  it('creates moments indexes and can query/clear unread social posts', async () => {
    await DB.deleteDB();
    const db = await openDB();
    const store = db.transaction('social_posts', 'readonly').objectStore('social_posts');
    expect(Array.from(store.indexNames)).toEqual(expect.arrayContaining([
      'timestamp',
      'authorCharId',
      'authorType',
      'visibility',
      'lastActivityAt',
      'unreadForUser',
    ]));

    await DB.saveSocialPost(makePost('read', { unreadForUser: false, lastActivityAt: 1 }));
    await DB.saveSocialPost(makePost('unread', { unreadForUser: true, lastActivityAt: 2 }));

    expect((await DB.getUnreadSocialPosts()).map(p => p.id)).toEqual(['unread']);
    await expect(DB.markSocialPostsSeen(['unread'])).resolves.toBe(1);
    expect(await DB.getUnreadSocialPosts()).toEqual([]);
    expect((await DB.getSocialPostsByAuthorChar('char-a')).map(p => p.id).sort()).toEqual(['read', 'unread']);
  });
});

describe('chat hub dashboard stores', () => {
  it('saves followups and digests, then includes them in full backup restore', async () => {
    await DB.deleteDB();
    const followup: ChatFollowup = {
      id: 'cf-test',
      source: 'private_message',
      targetKind: 'char',
      targetId: 'c1',
      messageId: 1,
      title: '回这句',
      note: '稍后处理',
      status: 'open',
      createdAt: 10,
      updatedAt: 10,
    };
    const digest: ChatHubDigest = {
      id: 'chat_digest_2026-07-03',
      date: '2026-07-03',
      range: { from: 1, to: 2 },
      sourceItemIds: ['cf-test'],
      summary: '今天有一条待办。',
      highlights: ['回这句'],
      createdAt: 20,
    };

    await DB.saveChatFollowup(followup);
    await DB.saveChatHubDigest(digest);
    expect(await DB.updateChatFollowupStatus('cf-test', 'done')).toMatchObject({ status: 'done' });

    const exported = await DB.exportFullData();
    expect(exported.chatFollowups?.[0].id).toBe('cf-test');
    expect(exported.chatHubDigests?.[0].date).toBe('2026-07-03');

    await DB.deleteDB();
    await DB.importFullData({
      timestamp: Date.now(),
      version: 1,
      chatFollowups: exported.chatFollowups,
      chatHubDigests: exported.chatHubDigests,
    } as FullBackupData);

    expect((await DB.getAllChatFollowups())[0]).toMatchObject({ id: 'cf-test', status: 'done' });
    expect(await DB.getChatHubDigestByDate('2026-07-03')).toMatchObject({ id: 'chat_digest_2026-07-03' });
  });
});

// blocked-then-unblocked 连接泄漏: onblocked 先 reject, 但底层 open request 还活着 ——
// 占用方关闭后 onsuccess 仍会触发。修复前那条迟到的连接没人持有也没缓存, 开着会 block
// 后续升级/删库; 修复后 settled 守卫让它被 close。这里复现整条链路, 用「事后 deleteDatabase
// 不被 block」来证明孤儿连接确实被关掉了。
describe('openDB blocked-then-unblocked 不泄漏连接', () => {
  it('占用方关闭后迟到的 onsuccess 关掉孤儿连接, 不 block 后续删库', async () => {
    await DB.deleteDB(); // 复位到 version 0, 让下面能从低版本起步

    // 一条 raw 连接占住 v50 且不挂 onversionchange (模拟不肯让位的旧 tab)
    const blocker = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('AetherOS_Data', 50);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });

    // openDB 要升到 DB_VERSION(51) → 被 blocker 挡住 → reject
    await expect(openDB()).rejects.toBeTruthy();

    // 放行: 关掉 blocker, 那条挂起的 51-open 会走完 onsuccess (此时 settled=true → 应 close)
    blocker.close();
    await new Promise((r) => setTimeout(r, 50)); // 等事件队列把 onsuccess 跑掉

    // 若孤儿连接没被关, 这里 deleteDatabase 会触发 onblocked → reject; 关掉了则正常 resolve
    await expect(new Promise<void>((resolve, reject) => {
      const del = indexedDB.deleteDatabase('AetherOS_Data');
      del.onsuccess = () => resolve();
      del.onerror = () => reject(del.error);
      del.onblocked = () => reject(new Error('deleteDatabase 被 block —— 有孤儿连接没关闭'));
    })).resolves.toBeUndefined();
  });
});

describe('character identity persistence', () => {
  it('backfills modelId when saving and reading legacy character rows', async () => {
    await DB.deleteDB();
    const legacy = {
      id: 'legacy-char',
      name: 'Legacy',
      avatar: '',
      description: '',
      systemPrompt: '',
      memories: [],
      contextLimit: 500,
    } as CharacterProfile;

    await DB.saveCharacter(legacy);

    const chars = await DB.getAllCharacters();
    expect(chars.find(c => c.id === 'legacy-char')?.modelId).toBe('legacy-char');
  });
});

describe('xhs feed backup', () => {
  it('exports and restores local 见闻簿 cards', async () => {
    await DB.deleteDB();
    const post: XhsFeedPost = {
      id: 'xhs-feed-backup-1',
      authorType: 'user',
      author: 'User',
      title: '本地见闻',
      body: '这是一条需要随完整备份保存的见闻簿卡片。',
      tags: ['备份', '见闻簿'],
      likes: 3,
      favs: 1,
      faved: true,
      comments: [],
      createdAt: 123,
      source: 'user',
      category: 'life',
    };

    await DB.saveXhsFeedPost(post);
    const exported = await DB.exportFullData();

    expect(exported.xhsFeedPosts?.[0]).toMatchObject({ id: post.id, title: post.title, category: 'life' });

    await DB.deleteDB();
    await DB.importFullData({
      timestamp: Date.now(),
      version: 1,
      xhsFeedPosts: exported.xhsFeedPosts,
    } as FullBackupData);

    expect((await DB.getXhsFeedPosts())[0]).toMatchObject({ id: post.id, source: 'user', category: 'life' });
  });
});

describe('relationship network stores', () => {
  it('saves and reads edges, pair messages, and auto settings', async () => {
    await DB.deleteDB();
    const pairKey = 'rn_a__b';
    const edge: RelationshipNetworkEdge = {
      id: pairKey,
      pairKey,
      charIds: ['a', 'b'],
      label: 'test relation',
      summary: 'two chars know each other',
      confidence: 80,
      intimacy: 70,
      tension: 10,
      signals: { intimacy: ['same scene'], friction: [], conflict: [] },
      source: 'manual',
      createdAt: 100,
      updatedAt: 200,
    };
    const messages: RelationshipNetworkMessage[] = [
      { id: 'm1', pairKey, speakerId: 'a', speakerName: 'A', content: 'hello', createdAt: 101, source: 'manual' },
      { id: 'm2', pairKey, speakerId: 'b', speakerName: 'B', content: 'hi', createdAt: 102, source: 'auto' },
    ];
    const settings: RelationshipNetworkAutoSettings = {
      id: 'settings',
      enabled: true,
      selectedCharIds: ['a'],
      intervalMinutes: 30,
      charCooldownMinutes: 60,
      pairCooldownMinutes: 120,
      summaryCompressAfter: 72,
      summaryKeepRaw: 36,
      nextRunAt: 999,
      lastRunAtByChar: { a: 10 },
      lastRunAtByPair: { [pairKey]: 10 },
      forwardedCountByPair: { [pairKey]: 1 },
      updatedAt: 20,
    };

    await DB.saveRelationshipNetworkEdge(edge);
    await DB.saveRelationshipNetworkMessages(messages);
    await DB.saveRelationshipNetworkAutoSettings(settings);

    await expect(DB.getRelationshipNetworkEdgeByPair(pairKey)).resolves.toMatchObject({ pairKey, label: 'test relation' });
    await expect(DB.getRelationshipNetworkMessagesByPair(pairKey)).resolves.toEqual(messages);
    await expect(DB.getRelationshipNetworkMessagesByPair(pairKey, 1)).resolves.toEqual([messages[1]]);
    await expect(DB.getRelationshipNetworkAutoSettings()).resolves.toEqual(settings);
  });
});

describe('desktop pet store', () => {
  it('saves and reads desktop pet state', async () => {
    await DB.deleteDB();
    const state = {
      ...createDefaultDesktopPetState(123),
      floatingEnabled: true,
      overlay: { x: 12, y: 34, scale: 0.8, dockSide: 'left' as const },
      roleStates: { test_pet: { hp: 42, fv: 7, lastFedAt: 100 } },
      updatedAt: 456,
    };

    await DB.saveDesktopPetState(state);

    await expect(DB.getDesktopPetState()).resolves.toMatchObject({
      id: 'main',
      floatingEnabled: true,
      overlay: { x: 12, y: 34, scale: 0.8, dockSide: 'left' },
      roleStates: { test_pet: { hp: 42, fv: 7, lastFedAt: 100 } },
      updatedAt: 456,
    });
  });
});

describe('chat alarm store', () => {
  const mkChar = (id = 'alarm-char'): CharacterProfile => ({
    id,
    name: 'Alarm Char',
    avatar: '',
    description: '',
    systemPrompt: '',
    memories: [],
    contextLimit: 500,
  } as CharacterProfile);

  const mkAlarm = (charId = 'alarm-char', now = 1_788_000_000_000): ChatAlarm =>
    prepareAlarmForSave(makeChatAlarm({
      charId,
      kind: 'wake',
      label: '起床叫醒',
      timeHHmm: '07:30',
      weekdays: [1, 2, 3, 4, 5],
      channel: 'auto',
      now,
    }), now);

  it('saves, reads, queries due alarms, and deletes by id', async () => {
    await DB.deleteDB();
    const alarm = mkAlarm();

    await DB.saveChatAlarm(alarm);
    await expect(DB.getChatAlarmsByCharId(alarm.charId)).resolves.toEqual([alarm]);

    const due = { ...alarm, nextAt: alarm.createdAt - 1000 };
    await DB.saveChatAlarm(due);
    await expect(DB.getDueChatAlarms(alarm.createdAt)).resolves.toEqual([due]);

    await DB.deleteChatAlarm(alarm.id);
    await expect(DB.getChatAlarmsByCharId(alarm.charId)).resolves.toEqual([]);
  });

  it('cascades alarms when deleting a character', async () => {
    await DB.deleteDB();
    const char = mkChar();
    await DB.saveCharacter(char);
    await DB.saveChatAlarm(mkAlarm(char.id));

    await DB.deleteCharacter(char.id);

    await expect(DB.getChatAlarmsByCharId(char.id)).resolves.toEqual([]);
  });

  it('exports and restores chat alarms in full backup data', async () => {
    await DB.deleteDB();
    const char = mkChar();
    const alarm = mkAlarm(char.id);
    await DB.saveCharacter(char);
    await DB.saveChatAlarm(alarm);

    const exported = await DB.exportFullData();
    expect(exported.chatAlarms).toEqual([alarm]);

    await DB.deleteDB();
    await DB.importFullData({
      timestamp: 0,
      version: 1,
      characters: [char],
      messages: [],
      chatAlarms: exported.chatAlarms || [],
    } as FullBackupData);

    await expect(DB.getChatAlarmsByCharId(char.id)).resolves.toEqual([alarm]);
  });
});

describe('theater faux piece store', () => {
  const mkPiece = (id: string, createdAt: number, kind: TheaterFauxPiece['kind'] = 'memo'): TheaterFauxPiece => ({
    id,
    kind,
    charId: 'faux-char',
    charName: 'Faux Char',
    keyword: '深夜',
    data: kind === 'memo'
      ? { title: '备忘录', updatedAt: '刚刚', lines: ['第一行', '第二行'] }
      : { topic: '#热搜#', rank: '热搜第1', posts: [], hotComments: [] },
    fallbackText: '',
    createdAt,
    updatedAt: createdAt,
  });

  it('saves, reads by newest first, and deletes faux pieces', async () => {
    await DB.deleteDB();
    const oldPiece = mkPiece('tf-old', 100);
    const newPiece = mkPiece('tf-new', 200, 'weibo');

    await DB.saveTheaterFauxPiece(oldPiece);
    await DB.saveTheaterFauxPiece(newPiece);

    await expect(DB.getAllTheaterFauxPieces()).resolves.toEqual([newPiece, oldPiece]);

    await DB.deleteTheaterFauxPiece(newPiece.id);
    await expect(DB.getAllTheaterFauxPieces()).resolves.toEqual([oldPiece]);
  });

  it('exports and restores faux piece history in full backup data', async () => {
    await DB.deleteDB();
    const oldPiece = mkPiece('tf-old', 100);
    const newPiece = mkPiece('tf-new', 200, 'weibo');

    await DB.saveTheaterFauxPiece(oldPiece);
    await DB.saveTheaterFauxPiece(newPiece);

    const exported = await DB.exportFullData();
    expect(exported.theaterFauxPieces).toHaveLength(2);
    expect(exported.theaterFauxPieces).toEqual(expect.arrayContaining([oldPiece, newPiece]));

    await DB.deleteDB();
    await DB.importFullData({
      timestamp: 0,
      version: 1,
      characters: [],
      messages: [],
      theaterFauxPieces: exported.theaterFauxPieces || [],
    } as FullBackupData);

    await expect(DB.getAllTheaterFauxPieces()).resolves.toEqual([newPiece, oldPiece]);
  });
});

describe('reflection and collection stores', () => {
  const mkReflection = (): TheaterReflectionSession => ({
    id: 'reflection-test',
    charId: 'faux-char',
    charName: 'Faux Char',
    userName: '你',
    title: '雨中照面',
    subtitle: '月光也认得旧伞',
    nodes: {
      past: {
        id: 'r-past',
        ts: 100,
        era: 'before',
        title: '旧站台',
        scene: '旧站台。',
        source: 'generated',
        when: '相遇前约 1 个月',
      },
      now: {
        id: 'r-now',
        ts: 200,
        era: 'after',
        title: '新雨夜',
        scene: '新雨夜。',
        source: 'lifeEvent',
        when: '相遇之后不久',
      },
    },
    options: { mode: 'moonlight', tone: 'restrained', length: 'standard' },
    initialScene: { title: '雨中照面', lines: [{ who: 'past', text: '我以为车会来。' }] },
    continuationLines: [],
    createdAt: 100,
    updatedAt: 200,
  });

  it('saves, reads, deletes, and full-backup restores reflection sessions and collection references', async () => {
    await DB.deleteDB();
    const reflection = mkReflection();
    const collectionItem: CollectionItem = {
      id: 'reflection:reflection-test',
      sourceType: 'reflection',
      sourceId: reflection.id,
      title: '对影 · 雨中照面',
      subtitle: '折子戏 · Faux Char',
      excerpt: '我以为车会来。',
      charIds: [reflection.charId],
      cover: '🌙',
      collectedAt: 300,
    };

    await DB.saveTheaterReflectionSession(reflection);
    await DB.saveCollectionItem(collectionItem);

    await expect(DB.getTheaterReflectionSession(reflection.id)).resolves.toEqual(reflection);
    await expect(DB.getTheaterReflectionSessionsByCharId(reflection.charId)).resolves.toEqual([reflection]);
    await expect(DB.getCollectionItems()).resolves.toEqual([collectionItem]);

    const exported = await DB.exportFullData();
    expect(exported.theaterReflectionSessions).toEqual([reflection]);
    expect(exported.collectionItems).toEqual([collectionItem]);

    await DB.deleteTheaterReflectionSessionsByCharId(reflection.charId);
    await DB.deleteCollectionItemsByCharId(reflection.charId);
    await expect(DB.getTheaterReflectionSessionsByCharId(reflection.charId)).resolves.toEqual([]);
    await expect(DB.getCollectionItems()).resolves.toEqual([]);

    await DB.deleteDB();
    await DB.importFullData({
      timestamp: 0,
      version: 1,
      characters: [],
      messages: [],
      theaterReflectionSessions: exported.theaterReflectionSessions || [],
      collectionItems: exported.collectionItems || [],
    } as FullBackupData);

    await expect(DB.getTheaterReflectionSession(reflection.id)).resolves.toEqual(reflection);
    await expect(DB.getCollectionItems()).resolves.toEqual([collectionItem]);
  });
});

describe('period reminder stores', () => {
  const mkSettings = (now = 1_788_000_000_000): PeriodReminderSettings =>
    preparePeriodReminderSettings({
      id: 'period_reminder_main',
      enabled: true,
      lastStartDate: '2026-06-01',
      cycleLength: 28,
      periodLength: 5,
      remindOffsets: [-2, 0],
      timeHHmm: '09:00',
      visibility: 'public',
      notifyChannel: 'both',
      charIds: ['period-char'],
      createdAt: now,
      updatedAt: now,
    }, now);

  const mkEvent = (id = 'period-start-1'): PeriodCycleEvent => ({
    id,
    kind: 'start',
    date: '2026-06-01',
    note: 'started',
    createdAt: 1_788_000_000_000,
    updatedAt: 1_788_000_000_000,
  });

  it('saves, reads, and queries due reminder settings', async () => {
    await DB.deleteDB();
    const settings = mkSettings();

    await DB.savePeriodReminderSettings(settings);
    await expect(DB.getPeriodReminderSettings(settings.id)).resolves.toEqual(settings);
    await expect(DB.getAllPeriodReminderSettings()).resolves.toEqual([settings]);

    const due = { ...settings, nextAt: settings.createdAt - 1000 };
    await DB.savePeriodReminderSettings(due);
    await expect(DB.getDuePeriodReminderSettings(settings.createdAt)).resolves.toEqual([due]);
  });

  it('saves, reads, and deletes cycle events', async () => {
    await DB.deleteDB();
    const event = mkEvent();

    await DB.savePeriodCycleEvent(event);
    await expect(DB.getAllPeriodCycleEvents()).resolves.toEqual([event]);

    await DB.deletePeriodCycleEvent(event.id);
    await expect(DB.getAllPeriodCycleEvents()).resolves.toEqual([]);
  });

  it('exports and restores period reminder settings and events', async () => {
    await DB.deleteDB();
    const settings = mkSettings();
    const event = mkEvent();

    await DB.savePeriodReminderSettings(settings);
    await DB.savePeriodCycleEvent(event);

    const exported = await DB.exportFullData();
    expect(exported.periodReminderSettings).toEqual([settings]);
    expect(exported.periodCycleEvents).toEqual([event]);

    await DB.deleteDB();
    await DB.importFullData({
      timestamp: 0,
      version: 1,
      characters: [],
      messages: [],
      periodReminderSettings: exported.periodReminderSettings || [],
      periodCycleEvents: exported.periodCycleEvents || [],
    } as FullBackupData);

    await expect(DB.getPeriodReminderSettings(settings.id)).resolves.toEqual(settings);
    await expect(DB.getAllPeriodCycleEvents()).resolves.toEqual([event]);
  });
});

describe('health center stores', () => {
  it('saves, reads, and queries health records by date and module', async () => {
    await DB.deleteDB();
    const settings = prepareHealthModuleSettings({ id: 'hydration', privacy: 'summary_reminder', charIds: ['char-1'] }, 1_788_000_000_000);
    const water = makeHealthRecord({ moduleId: 'hydration', date: '2026-07-01', value: 350, unit: 'ml' }, 1_788_000_000_000);
    const mood = makeHealthRecord({ moduleId: 'mood', date: '2026-07-01', label: '平静' }, 1_788_000_001_000);

    await DB.saveHealthModuleSettings(settings);
    await DB.saveHealthRecord(water);
    await DB.saveHealthRecord(mood);

    await expect(DB.getAllHealthModuleSettings()).resolves.toEqual([settings]);
    await expect(DB.getHealthRecordsByDate('2026-07-01')).resolves.toEqual([water, mood]);
    await expect(DB.getHealthRecordsByModule('hydration')).resolves.toEqual([water]);
    await expect(DB.getHealthRecordsByModuleDate('hydration', '2026-07-01')).resolves.toEqual([water]);

    await DB.deleteHealthRecord(water.id);
    await expect(DB.getHealthRecordsByModule('hydration')).resolves.toEqual([]);
  });

  it('saves and queries due health reminders', async () => {
    await DB.deleteDB();
    const now = 1_788_000_000_000;
    const reminder = normalizeHealthReminder({
      moduleId: 'medication',
      title: '晚药',
      timeHHmm: '09:00',
      frequency: 'daily',
      nextAt: now - 1000,
    }, now);
    const due = { ...reminder, nextAt: now - 1000 };

    await DB.saveHealthReminder(due);
    await expect(DB.getAllHealthReminders()).resolves.toEqual([due]);
    await expect(DB.getDueHealthReminders(now)).resolves.toEqual([due]);
  });

  it('exports and restores health center data', async () => {
    await DB.deleteDB();
    const settings = prepareHealthModuleSettings({ id: 'sleep', privacy: 'summary' }, 1_788_000_000_000);
    const record = makeHealthRecord({ moduleId: 'sleep', date: '2026-07-01', value: 7.5, unit: '小时' }, 1_788_000_000_000);
    const reminder = normalizeHealthReminder({ moduleId: 'sleep', title: '准备睡觉', timeHHmm: '23:00' }, 1_788_000_000_000);
    const plan = makeHealthPlan({ moduleId: 'sleep', target: 7.5, unit: '小时' }, 1_788_000_000_000);
    const summary = summarizeHealthDay([record], '2026-07-01', 1_788_000_000_000);

    await DB.saveHealthModuleSettings(settings);
    await DB.saveHealthRecord(record);
    await DB.saveHealthReminder(reminder);
    await DB.saveHealthPlan(plan);
    await DB.saveHealthSummary(summary);

    const exported = await DB.exportFullData();
    expect(exported.healthModuleSettings).toEqual([settings]);
    expect(exported.healthRecords).toEqual([record]);
    expect(exported.healthReminders).toEqual([reminder]);
    expect(exported.healthPlans).toEqual([plan]);
    expect(exported.healthSummaries).toEqual([summary]);

    await DB.deleteDB();
    await DB.importFullData({
      timestamp: 0,
      version: 1,
      characters: [],
      messages: [],
      healthModuleSettings: exported.healthModuleSettings || [],
      healthRecords: exported.healthRecords || [],
      healthReminders: exported.healthReminders || [],
      healthPlans: exported.healthPlans || [],
      healthSummaries: exported.healthSummaries || [],
    } as FullBackupData);

    await expect(DB.getAllHealthModuleSettings()).resolves.toEqual([settings]);
    await expect(DB.getAllHealthRecords()).resolves.toEqual([record]);
    await expect(DB.getAllHealthReminders()).resolves.toEqual([reminder]);
    await expect(DB.getAllHealthPlans()).resolves.toEqual([plan]);
    await expect(DB.getAllHealthSummaries()).resolves.toEqual([summary]);
  });
});

describe('complete backup restore coverage', () => {
  const walkAndRestoreAssetRefs = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        if (node[i] === 'assets/avatar.png') node[i] = 'data:image/png;base64,AAA';
        else walkAndRestoreAssetRefs(node[i]);
      }
      return;
    }
    for (const key of Object.keys(node)) {
      if (node[key] === 'assets/avatar.png') node[key] = 'data:image/png;base64,AAA';
      else walkAndRestoreAssetRefs(node[key]);
    }
  };

  it('restores persona avatar asset references before writing personas', async () => {
    await DB.deleteDB();
    const persona: Persona = {
      id: 'persona-backup-1',
      name: 'Backup Persona',
      avatar: 'assets/avatar.png',
      description: 'identity',
      position: 0,
      createdAt: 1,
      updatedAt: 1,
    };

    await DB.importFullData({
      timestamp: 0,
      version: 1,
      personas: [persona],
    } as FullBackupData, {
      beforeWrite: async (root) => {
        walkAndRestoreAssetRefs(root);
      },
    });

    expect((await DB.getAllPersonas())[0]).toMatchObject({
      id: persona.id,
      avatar: 'data:image/png;base64,AAA',
    });
  });

  it('exports and restores takeout order receipts and status history', async () => {
    await DB.deleteDB();
    const order: TakeoutOrder = {
      id: 'takeout-order-backup-1',
      storeId: 'store-1',
      storeName: 'Noodle House',
      storeEmoji: 'N',
      items: [{ dishId: 'dish-1', name: 'Noodles', price: 18, qty: 2, emoji: 'B' }],
      subtotal: 36,
      deliveryFee: 3,
      packFee: 1,
      total: 40,
      recipient: 'me',
      payer: 'me',
      payStatus: 'paid',
      status: 'delivered',
      riderName: 'Rider',
      riderEmoji: 'R',
      address: 'Test address',
      placedAt: 100,
      etaAt: 200,
      deliveredAt: 220,
      chat: [{ role: 'rider', text: 'Arrived', at: 210 }],
      chatTarget: 'rider',
      complaint: { filed: true, resolved: true, outcome: 'refund approved', refunded: 5 },
      review: { rating: 5, text: 'Good', at: 230, tags: ['fast'], replies: [{ name: 'Store', emoji: 'S', text: 'Thanks', at: 240, isMerchant: true }] },
    };

    await DB.saveTakeoutOrder(order);
    const exported = await DB.exportFullData();
    expect(exported.takeoutOrders).toEqual([order]);

    await DB.deleteDB();
    await DB.importFullData({
      timestamp: 0,
      version: 1,
      takeoutOrders: exported.takeoutOrders || [],
    } as FullBackupData);

    await expect(DB.getTakeoutOrders()).resolves.toEqual([order]);
  });

  it('exports and restores unmapped IndexedDB stores through the fallback snapshot', async () => {
    await DB.deleteDB();
    const card = {
      id: 'divination-card-backup-1',
      deck: 'tarot',
      index: 1,
      name: 'Backup Card',
      image: 'data:image/png;base64,BBB',
      updatedAt: 10,
    };
    const db = await openDB();
    const tx = db.transaction('divination_cards', 'readwrite');
    tx.objectStore('divination_cards').put(card);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });

    const exported = await DB.exportFullData();
    expect(exported.indexedDbSnapshot?.divination_cards).toEqual([card]);

    await DB.deleteDB();
    await DB.importFullData({
      timestamp: 0,
      version: 1,
      indexedDbSnapshot: {
        divination_cards: exported.indexedDbSnapshot?.divination_cards || [],
      },
    } as FullBackupData);

    await expect(DB.getRawStoreData('divination_cards')).resolves.toEqual([card]);
  });

  it('collects persistent localStorage backup keys and skips transient runtime keys', () => {
    localStorage.clear();
    localStorage.setItem('os_active_persona_id', 'persona-a');
    localStorage.setItem('os_default_persona_id', 'persona-default');
    localStorage.setItem('moro_takeout_custom_stores_v1', '[{"id":"store"}]');
    localStorage.setItem('moro_takeout_custom_dishes_v1', '[{"id":"dish"}]');
    localStorage.setItem('moro_shop_dynamic_items_v1', '[{"id":"gift"}]');
    localStorage.setItem('moro_shop_catalog_v1', '[{"id":"catalog"}]');
    localStorage.setItem('moro_import_in_progress_v1', '{"phase":"database"}');
    localStorage.setItem('moro_takeout_intent_v1', '{"recipientCharId":"c1"}');

    const snapshot = collectLocalStorageSnapshot();

    expect(snapshot).toMatchObject({
      os_active_persona_id: 'persona-a',
      os_default_persona_id: 'persona-default',
      moro_takeout_custom_stores_v1: '[{"id":"store"}]',
      moro_takeout_custom_dishes_v1: '[{"id":"dish"}]',
      moro_shop_dynamic_items_v1: '[{"id":"gift"}]',
      moro_shop_catalog_v1: '[{"id":"catalog"}]',
    });
    expect(snapshot).not.toHaveProperty('moro_import_in_progress_v1');
    expect(snapshot).not.toHaveProperty('moro_takeout_intent_v1');
    expect(shouldBackupLocalStorageKey('moro_import_in_progress_v1')).toBe(false);
    expect(shouldBackupLocalStorageKey('moro_takeout_intent_v1')).toBe(false);
  });

  it('restores only allowed localStorage snapshot keys', () => {
    localStorage.clear();

    restoreLocalStorageSnapshot({
      os_active_persona_id: 'persona-a',
      moro_takeout_custom_stores_v1: '[{"id":"store"}]',
      moro_shop_dynamic_items_v1: '[{"id":"gift"}]',
      moro_import_in_progress_v1: '{"phase":"assets"}',
      moro_takeout_intent_v1: '{"recipientCharId":"c1"}',
      unrelated_key: 'skip',
    });

    expect(localStorage.getItem('os_active_persona_id')).toBe('persona-a');
    expect(localStorage.getItem('moro_takeout_custom_stores_v1')).toBe('[{"id":"store"}]');
    expect(localStorage.getItem('moro_shop_dynamic_items_v1')).toBe('[{"id":"gift"}]');
    expect(localStorage.getItem('moro_import_in_progress_v1')).toBeNull();
    expect(localStorage.getItem('moro_takeout_intent_v1')).toBeNull();
    expect(localStorage.getItem('unrelated_key')).toBeNull();
  });
});
