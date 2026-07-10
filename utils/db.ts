


import {
    CharacterProfile, ChatTheme, Message, PrivateChatArchive, ChatAlarm, PeriodReminderSettings, PeriodCycleEvent, UserProfile,
    HealthModuleSettings, HealthRecord, HealthReminder, HealthPlan, HealthSummary, HealthImportBatch, HealthModuleId,
    Task, Anniversary, DiaryEntry, RoomTodo, RoomNote, DailySchedule,
    GalleryImage, FullBackupData, GroupProfile, SocialPost, StudyCourse, GameSession, Worldbook, NovelBook, CoViewBook, CoViewMedia, CoViewMessage, CoViewSession, Emoji, EmojiCategory,
    BankTransaction, BankFullState, DollhouseState, BankDollhousesByShopId, XhsStockImage, XhsActivityRecord, XhsFeedPost, SongSheet, QuizSession, GuidebookSession,
    LifeSimState, HandbookEntry, Tracker, TrackerEntry, HotNewsSnapshot,
    VRWorldNovel, VRNovelAnnotation, CustomCreatorPart, VRMusicRoomState, VRGuestbookState, VRScript, VRStagedPlay, VRLetter,
    PhoneCallLog, ExchangeDiaryBook, InnerVoiceEntry, TavernPreset, Persona, CalendarMark, CharLedgerEntry, CharLifeEvent,
    XunjiMonitorSnapshot, XunjiReportItem, XunjiScreenlifeRun, XunjiSettings, PhoneCheckSession, UserScreenWatchSession,
    RelationshipNetworkAutoSettings, RelationshipNetworkEdge, RelationshipNetworkMessage,
    TalkSession, CollectionItem, TakeoutOrder, DivinationCard, WerewolfGame, TruthDareSession, TheaterQuizSession, TheaterFauxPiece, TheaterCustomLibraryItem,
    TheaterReflectionSession, TheaterSleepSession, TheaterGomokuGame, TheaterGomokuInvitation, TheaterGoGame, TheaterGoInvitation, TheaterDoudizhuGame, TheaterDoudizhuInvitation, TheaterTurtleSoupGame, TheaterTurtleSoupInvitation, TheaterMahjongGame, TheaterMahjongInvitation,
    TwitterTweet, TwitterNotification, TwitterProfile, TwitterAccount, TwitterDMThread, TwitterSearchRecord,
    DesktopPetState,
    MusicLibraryTrack, MusicLibraryPlaylist, MusicPlaylistItem, MusicPlayEvent, MusicSearchHistoryItem, MusicRecommendCacheEntry,
    ChatFollowup, ChatHubDigest
} from '../types';
import { normalizeCharacterDefaults } from './impression';
import { exportPostOfficeLocal, importPostOfficeLocal } from './vrWorld/postOffice';
import { dispatchCharLifeEventUpdated, dispatchDailyScheduleSaved, dispatchDailyScheduleUpdated } from './scheduleEvents';
import { sanitizeAssistantVisibleText } from './promptPrivacy';

// Legacy physical IndexedDB name retained so existing local-first user data stays available.
const DB_NAME = 'AetherOS_Data';
const DB_VERSION = 101; // Bumped: v101 theater mahjong games and invitations

const STORE_CHARACTERS = 'characters';
const STORE_MESSAGES = 'messages';
const STORE_PRIVATE_CHAT_ARCHIVES = 'private_chat_archives';
const STORE_CHAT_ALARMS = 'chat_alarms';
const STORE_CHAT_FOLLOWUPS = 'chat_followups';
const STORE_CHAT_HUB_DIGESTS = 'chat_hub_digests';

const ASSISTANT_VISIBLE_MESSAGE_TYPES = new Set<string>([
    'text',
    'voice',
    'call_log',
    'html_card',
    'vr_card',
    'twitter_card',
    'xhs_card',
    'social_card',
    'forum_card',
    'news_card',
    'screen_peek_card',
    'screen_watch_card',
]);

const cleanVisibleRoleText = (value: unknown): string =>
    sanitizeAssistantVisibleText(value).trim();

const cleanOptionalRoleText = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return value as any;
    const cleaned = cleanVisibleRoleText(value);
    return cleaned || undefined;
};

const normalizeAssistantMessageForSave = <T extends Omit<Message, 'id' | 'timestamp'> & { timestamp?: number }>(msg: T): T => {
    if (msg.role !== 'assistant' || typeof msg.content !== 'string' || !ASSISTANT_VISIBLE_MESSAGE_TYPES.has(msg.type)) return msg;
    const next: any = { ...msg, content: cleanVisibleRoleText(msg.content) };
    if (next.metadata?.htmlTextPreview && typeof next.metadata.htmlTextPreview === 'string') {
        next.metadata = {
            ...next.metadata,
            htmlTextPreview: cleanVisibleRoleText(next.metadata.htmlTextPreview),
        };
    }
    return next;
};

const normalizeSocialPostVisibleText = (post: SocialPost): SocialPost => ({
    ...post,
    title: post.authorType === 'user' ? post.title : cleanVisibleRoleText(post.title),
    content: post.authorType === 'user' ? post.content : cleanVisibleRoleText(post.content),
    comments: (post.comments || []).map(comment => (
        comment.authorType === 'user'
            ? comment
            : { ...comment, content: cleanVisibleRoleText(comment.content) }
    )),
    relationSignals: post.relationSignals?.map(signal => ({
        ...signal,
        text: cleanOptionalRoleText(signal.text),
    })),
});

const normalizeXhsFeedVisibleText = (post: XhsFeedPost): XhsFeedPost => ({
    ...post,
    title: post.authorType === 'user' ? post.title : cleanVisibleRoleText(post.title),
    body: post.authorType === 'user' ? post.body : cleanVisibleRoleText(post.body),
    repostNote: post.authorType === 'user' ? post.repostNote : cleanOptionalRoleText(post.repostNote),
    comments: (post.comments || []).map(comment => (
        comment.isUser
            ? comment
            : { ...comment, content: cleanVisibleRoleText(comment.content) }
    )),
});

const normalizeTwitterTweetVisibleText = (tweet: TwitterTweet): TwitterTweet => ({
    ...tweet,
    content: tweet.authorType === 'user' ? tweet.content : cleanVisibleRoleText(tweet.content),
    replies: (tweet.replies || []).map(reply => (
        reply.authorType === 'user'
            ? reply
            : { ...reply, content: cleanVisibleRoleText(reply.content) }
    )),
});

const normalizePhoneCheckSessionVisibleText = (session: PhoneCheckSession): PhoneCheckSession => ({
    ...session,
    steps: (session.steps || []).map(step => ({
        ...step,
        thought: cleanOptionalRoleText(step.thought),
        intent: cleanOptionalRoleText(step.intent),
        visibleClue: cleanOptionalRoleText(step.visibleClue),
        actionReason: cleanOptionalRoleText(step.actionReason),
        detail: cleanOptionalRoleText(step.detail),
    })),
    evidence: (session.evidence || []).map(record => {
        const source = record.meta?.source;
        if (source === 'user_action' || source === 'xunji') return record;
        return {
            ...record,
            title: cleanVisibleRoleText(record.title),
            detail: cleanVisibleRoleText(record.detail),
            value: cleanOptionalRoleText(record.value),
        };
    }),
    actions: (session.actions || []).map(action => {
        if (action.type === 'send_as_character' || action.type === 'post_moment_as_character') return action;
        return { ...action, detail: cleanOptionalRoleText(action.detail) };
    }),
    summary: cleanOptionalRoleText(session.summary),
    moodAfter: cleanOptionalRoleText(session.moodAfter),
});

const normalizeUserScreenWatchVisibleText = (session: UserScreenWatchSession): UserScreenWatchSession => ({
    ...session,
    comments: (session.comments || []).map(comment => ({
        ...comment,
        text: cleanVisibleRoleText(comment.text),
    })),
    summary: cleanOptionalRoleText(session.summary),
});

const normalizeDesktopPetVisibleText = (state: DesktopPetState): DesktopPetState => {
    const cleanTalk = (message?: DesktopPetState['lastSpeech']) => {
        if (!message || message.role !== 'pet') return message;
        return { ...message, text: cleanVisibleRoleText(message.text) };
    };
    return {
        ...state,
        dialogueLog: state.dialogueLog?.map(message => message.role === 'pet' ? { ...message, text: cleanVisibleRoleText(message.text) } : message),
        lastSpeech: cleanTalk(state.lastSpeech),
    };
};
const STORE_PERIOD_REMINDER_SETTINGS = 'period_reminder_settings';
const STORE_PERIOD_CYCLE_EVENTS = 'period_cycle_events';
const STORE_HEALTH_MODULE_SETTINGS = 'health_module_settings';
const STORE_HEALTH_RECORDS = 'health_records';
const STORE_HEALTH_REMINDERS = 'health_reminders';
const STORE_HEALTH_PLANS = 'health_plans';
const STORE_HEALTH_SUMMARIES = 'health_summaries';
const STORE_HEALTH_IMPORT_BATCHES = 'health_import_batches';
const STORE_EMOJIS = 'emojis';
const STORE_EMOJI_CATEGORIES = 'emoji_categories'; 
const STORE_THEMES = 'themes';
const STORE_ASSETS = 'assets'; 
const STORE_SCHEDULED = 'scheduled_messages'; 
const STORE_GALLERY = 'gallery';
const STORE_USER = 'user_profile'; 
const STORE_DIARIES = 'diaries';
const STORE_TASKS = 'tasks';
const STORE_ANNIVERSARIES = 'anniversaries';
const STORE_CALENDAR_MARKS = 'calendar_marks'; // 岁时记·实时日历贴纸（用户手动 + 角色 AI 自标，按 date 检索）
const STORE_CHAR_LEDGERS = 'char_ledgers';     // 存钱罐·角色账本（角色 AI 自记账 + 用户/角色互评）
const STORE_ROOM_TODOS = 'room_todos'; 
const STORE_ROOM_NOTES = 'room_notes'; 
const STORE_GROUPS = 'groups'; 
const STORE_JOURNAL_STICKERS = 'journal_stickers';
const STORE_SOCIAL_POSTS = 'social_posts';
const STORE_COURSES = 'courses';
const STORE_GAMES = 'games';
const STORE_WORLDBOOKS = 'worldbooks'; 
const STORE_NOVELS = 'novels'; 
const STORE_COVIEW_MEDIA = 'coview_media';
const STORE_COVIEW_BOOKS = 'coview_books';
const STORE_COVIEW_SESSIONS = 'coview_sessions';
const STORE_COVIEW_MESSAGES = 'coview_messages';
const STORE_BANK_TX = 'bank_transactions';
const STORE_BANK_DATA = 'bank_data';
const STORE_XHS_STOCK = 'xhs_stock';
const STORE_XHS_ACTIVITIES = 'xhs_activities';
const STORE_XHS_FEED = 'xhs_feed_posts';          // 小红书 App 本地生成信息流（角色 + NPC 帖子）
const STORE_TWITTER_TWEETS = 'twitter_tweets';    // 推特 App 本地 AI 时间线
const STORE_TWITTER_NOTIFS = 'twitter_notifications'; // 推特 App 通知
const STORE_TWITTER_PROFILE = 'twitter_profile';  // 推特 App 用户资料单例 id='me'
const STORE_TWITTER_ACCOUNTS = 'twitter_accounts'; // 推特 App 角色/NPC 账号资料
const STORE_TWITTER_DM = 'twitter_dm_threads';    // 推特 App 私信线程
const STORE_TWITTER_SEARCH = 'twitter_search_records'; // 推特 App 搜索历史
const STORE_SONGS = 'songs';
const STORE_MUSIC_TRACKS = 'music_tracks';
const STORE_MUSIC_PLAYLISTS = 'music_playlists';
const STORE_MUSIC_PLAYLIST_ITEMS = 'music_playlist_items';
const STORE_MUSIC_PLAY_EVENTS = 'music_play_events';
const STORE_MUSIC_SEARCH_HISTORY = 'music_search_history';
const STORE_MUSIC_RECOMMEND_CACHE = 'music_recommend_cache';
const STORE_QUIZZES = 'quizzes';
const STORE_GUIDEBOOK = 'guidebook';
const STORE_LIFE_SIM = 'life_sim';
const STORE_DAILY_SCHEDULE = 'daily_schedule';
const STORE_HANDBOOK = 'handbook'; // 跨角色聚合手账，每天一条 entry，id = 'YYYY-MM-DD'
const STORE_TRACKERS = 'trackers';                // 手账打卡 tracker 定义
const STORE_TRACKER_ENTRIES = 'tracker_entries';  // tracker 每日打卡数据
const STORE_HOTNEWS = 'hotnews_snapshots';        // 分时段热点快照（全角色共享，key=日期#时段）
const STORE_VR_NOVELS = 'vr_novels';              // 虚拟世界「页外」全局小说库（所有角色共享原文）
const STORE_VR_ANNOTATIONS = 'vr_annotations';    // 虚拟世界小说批注（per-segment per-char，可互相吐槽）
const STORE_CC_PARTS = 'cc_custom_parts';         // 捏脸系统自定义部件（开发模式追加，注入捏人器）
const STORE_VR_MUSIC = 'vr_music';                // 听歌房共享状态（单例 nowPlaying + 循环队列）
const STORE_VR_GUESTBOOK = 'vr_guestbook';        // 留言簿共享版聊墙（单例 messages）
const STORE_VR_SCRIPTS = 'vr_scripts';            // 剧院·投稿剧本库（每份剧本一条）
const STORE_VR_PLAYS = 'vr_plays';                // 剧院·历史舞台剧（每场演出一条）
const STORE_VR_PRESETS = 'vr_presets';            // 剧院·用户自定义写作风格预设（key 为主键）
const STORE_VR_LETTERS = 'vr_letters';            // 邮局信件（本地存档 + 待寄出/待回复队列）
const STORE_VR_SETTINGS = 'vr_settings';          // 页外设置单例：独立 API（id='api'）+ 调用记录（id='apilog'）
const STORE_API_CALL_LOG = 'api_call_log';        // 全局 API 后台流水单例（id='log'，保留近 5 天）
const STORE_PHONE_CALL_LOGS = 'phone_call_logs';  // 电话 App 通话记录（拨出/接听/未接，轻量条目）
const STORE_PHONE_CHECK_SESSIONS = 'phone_check_sessions'; // 絮语查岗档案（用户查 TA / TA 查用户）
const STORE_USER_SCREEN_WATCH = 'user_screen_watch_sessions'; // 絮语观屏评论：用户授权共享屏幕后，角色实时评论
const STORE_EXCHANGE_DIARY = 'exchange_diary_books'; // 日记社：多角色交换日记本（entries 内联在 book 里）
const STORE_INNER_VOICES = 'inner_voices';        // 偷看心声历史（per-char，不进聊天上下文）
const STORE_LLM_PRESETS = 'llm_presets';          // 预设 App：SillyTavern 式 Chat Completion 预设（提示词管理器 + 采样参数）
const STORE_PERSONAS = 'personas';                // 人设 App：SillyTavern 式用户人设（多套用户身份，可绑定角色/世界书）
const STORE_CHAR_LIFE_EVENTS = 'char_life_events'; // 来往·角色离线自主生活事件（每条一件小事，攒成离线回顾时间线 + 给主动消息取材）
const STORE_XUNJI_RUNS = 'xunji_screenlife_runs';  // 循迹·Screenlife 演出记录
const STORE_XUNJI_SNAPSHOTS = 'xunji_monitor_snapshots'; // 循迹·监视快照
const STORE_XUNJI_REPORTS = 'xunji_reports';       // 循迹·报备/提醒事件
const STORE_XUNJI_SETTINGS = 'xunji_settings';     // 循迹·设置单例 id='settings'
const STORE_RELATIONSHIP_NETWORK_EDGES = 'relationship_network_edges';
const STORE_RELATIONSHIP_NETWORK_MESSAGES = 'relationship_network_messages';
const STORE_RELATIONSHIP_NETWORK_SETTINGS = 'relationship_network_settings';
const STORE_TALK_SESSIONS = 'talk_sessions';      // 折子戏·谈心会话（user 与某角色的倾诉/安慰记录，可收录/转发）
const STORE_WEREWOLF_GAMES = 'werewolf_games';    // 折子戏·狼人杀对局（一桌熟人开局的完整流程，可存档/续局/回看）
const STORE_TRUTHDARE_SESSIONS = 'truthdare_sessions'; // 折子戏·真心话大冒险（一圈玩家 + 一串回合记录，可存档/回看/续玩）
const STORE_THEATER_QUIZ_SESSIONS = 'theater_quiz_sessions'; // 折子戏·番外问卷会话（多角色答题 + 题内评论，可续做/回看）
const STORE_THEATER_FAUX_PIECES = 'theater_faux_pieces'; // 折子戏·仿真图文历史（微信/微博/备忘录等截图结构化结果）
const STORE_THEATER_CUSTOM_LIBRARY = 'theater_custom_library'; // 幕间集·用户导入小剧场 / 问卷库
const STORE_THEATER_REFLECTION_SESSIONS = 'theater_reflection_sessions'; // 折子戏·对影会话（两个时间里的 TA + 用户短会面）
const STORE_THEATER_SLEEP_SESSIONS = 'theater_sleep_sessions'; // 幕间集·一起入眠会话（文字 / 电话式语音陪伴记录）
const STORE_THEATER_GOMOKU_GAMES = 'theater_gomoku_games'; // 幕间集·五子棋对局（15x15 休闲规则，可续局/回看）
const STORE_THEATER_GOMOKU_INVITATIONS = 'theater_gomoku_invitations'; // 幕间集·五子棋邀请（聊天卡片 + App 待处理）
const STORE_THEATER_GO_GAMES = 'theater_go_games'; // 幕间集·围棋对局（19 路休闲规则，可续局/回看）
const STORE_THEATER_GO_INVITATIONS = 'theater_go_invitations'; // 幕间集·围棋邀请（聊天卡片 + App 待处理）
const STORE_THEATER_DOUDIZHU_GAMES = 'theater_doudizhu_games'; // 幕间集·斗地主对局（三人牌桌，可续局/回看）
const STORE_THEATER_DOUDIZHU_INVITATIONS = 'theater_doudizhu_invitations'; // 幕间集·斗地主邀请（聊天卡片 + App 待处理）
const STORE_THEATER_TURTLE_SOUP_GAMES = 'theater_turtle_soup_games'; // 幕间集·海龟汤汤局（主持人 + 多角色猜题，可续局/回看）
const STORE_THEATER_TURTLE_SOUP_INVITATIONS = 'theater_turtle_soup_invitations'; // 幕间集·海龟汤邀请（聊天卡片 + App 待处理）
const STORE_THEATER_MAHJONG_GAMES = 'theater_mahjong_games'; // 幕间集·麻将牌局（四人牌桌，可续局/回看）
const STORE_THEATER_MAHJONG_INVITATIONS = 'theater_mahjong_invitations'; // 幕间集·麻将邀请（聊天卡片 + App 待处理）
const STORE_COLLECTION_ITEMS = 'collection_items'; // 岁时记·典藏馆收录条目（引用谈心/创作社/自习室/折子戏内容）
const STORE_TAKEOUT_ORDERS = 'takeout_orders';     // 外卖 App 订单（含与骑手/商家的对话、配送进度）
const STORE_DIVINATION_CARDS = 'divination_cards'; // 折子戏·占卜牌库（塔罗 0~77 / 雷诺曼 1~36 的导入图）
const STORE_DESKTOP_PET = 'desktop_pet';           // 桌宠 App 状态（角色养成、悬浮窗、提醒）

// API 后台流水：保留近 5 天，超期丢弃；再加一个硬上限防止异常情况撑爆
// Message-store change event used by views that derive summaries from IndexedDB.
type MessagesUpdatedDetail = {
  kind: 'created' | 'updated' | 'deleted' | 'cleared' | 'replaced';
  charId?: string;
  groupId?: string;
  messageId?: number;
  messageIds?: number[];
  timestamp?: number;
};

const dispatchMessagesUpdated = (detail: MessagesUpdatedDetail) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('messages-updated', { detail }));
};

const listObjectStoreNames = (db: IDBDatabase): string[] => {
  const names: string[] = [];
  for (let i = 0; i < db.objectStoreNames.length; i++) {
      const name = db.objectStoreNames.item(i);
      if (name) names.push(name);
  }
  return names;
};

// API call-log retention limits.
const API_CALL_LOG_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000;
const API_CALL_LOG_MAX_ENTRIES = 2000;

export interface ScheduledMessage {
    id: string;
    charId: string;
    content: string;
    dueAt: number;
    createdAt: number;
}

// Built-in Presets
/** 旧版内置专属表情包分类（已下线），迁移时连同其下表情一起删除 */
const LEGACY_MORO_CATEGORY_ID = 'cat_moro_exclusive';
/** 默认表情包一次性迁移标记（老用户启动时补种 + 清理旧专属包） */
const DEFAULT_EMOJI_PACK_FLAG = 'moro_default_emoji_pack_v1';

// 默认内置表情包：落在「默认」分类（无可见性限制，角色可在聊天里通过
// [[SEND_EMOJI: 名称]] 直接使用）。重名表情按 名称2 区分（IDB keyPath 是 name）。
const DEFAULT_PRESET_EMOJIS = [
    { name: '猫不想努力了', url: '/stickers/default/001_猫不想努力了.jpg', categoryId: 'default' },
    { name: '偷笑', url: '/stickers/default/002_偷笑.jpg', categoryId: 'default' },
    { name: '色', url: '/stickers/default/003_色.jpg', categoryId: 'default' },
    { name: '大脑宕机', url: '/stickers/default/004_大脑宕机.jpg', categoryId: 'default' },
    { name: '咦～', url: '/stickers/default/005_咦.jpg', categoryId: 'default' },
    { name: '喝茶', url: '/stickers/default/006_喝茶.jpg', categoryId: 'default' },
    { name: '嘿', url: '/stickers/default/007_嘿.gif', categoryId: 'default' },
    { name: '记录丢人过程', url: '/stickers/default/008_记录丢人过程.jpg', categoryId: 'default' },
    { name: '点赞', url: '/stickers/default/009_点赞.jpg', categoryId: 'default' },
    { name: '请吃', url: '/stickers/default/010_请吃.jpg', categoryId: 'default' },
    { name: '看涩涩', url: '/stickers/default/011_看涩涩.jpg', categoryId: 'default' },
    { name: '菜就多练', url: '/stickers/default/012_菜就多练.jpg', categoryId: 'default' },
    { name: '做爱', url: '/stickers/default/013_做爱.gif', categoryId: 'default' },
    { name: '乖巧', url: '/stickers/default/014_乖巧.gif', categoryId: 'default' },
    { name: '疑惑', url: '/stickers/default/015_疑惑.jpg', categoryId: 'default' },
    { name: '叹气', url: '/stickers/default/016_叹气.jpg', categoryId: 'default' },
    { name: '吓哭', url: '/stickers/default/017_吓哭.jpg', categoryId: 'default' },
    { name: '无语', url: '/stickers/default/018_无语.jpg', categoryId: 'default' },
    { name: '我在报警', url: '/stickers/default/019_我在报警.jpg', categoryId: 'default' },
    { name: '愣', url: '/stickers/default/020_愣.jpg', categoryId: 'default' },
    { name: '贴贴', url: '/stickers/default/021_贴贴.jpg', categoryId: 'default' },
    { name: '哈？2', url: '/stickers/default/022_哈2.jpg', categoryId: 'default' },
    { name: '信仰我', url: '/stickers/default/023_信仰我.jpg', categoryId: 'default' },
    { name: '傻眼', url: '/stickers/default/024_傻眼.jpg', categoryId: 'default' },
    { name: '不甘心', url: '/stickers/default/025_不甘心.jpg', categoryId: 'default' },
    { name: '看你', url: '/stickers/default/026_看你.jpg', categoryId: 'default' },
    { name: '开心', url: '/stickers/default/027_开心.gif', categoryId: 'default' },
    { name: '请吩咐我', url: '/stickers/default/028_请吩咐我.jpg', categoryId: 'default' },
    { name: '鄙视', url: '/stickers/default/029_鄙视.jpg', categoryId: 'default' },
    { name: '欢快', url: '/stickers/default/030_欢快.gif', categoryId: 'default' },
    { name: '盯', url: '/stickers/default/031_盯.jpg', categoryId: 'default' },
    { name: '惊吓', url: '/stickers/default/032_惊吓.jpg', categoryId: 'default' },
    { name: '委屈', url: '/stickers/default/033_委屈.jpg', categoryId: 'default' },
    { name: '抱紧自己', url: '/stickers/default/034_抱紧自己.jpg', categoryId: 'default' },
    { name: '对手指', url: '/stickers/default/035_对手指.jpg', categoryId: 'default' },
    { name: '痛苦', url: '/stickers/default/036_痛苦.jpg', categoryId: 'default' },
    { name: '心虚', url: '/stickers/default/037_心虚.jpg', categoryId: 'default' },
    { name: '软弱', url: '/stickers/default/038_软弱.jpg', categoryId: 'default' },
    { name: '华丽登场', url: '/stickers/default/039_华丽登场.jpg', categoryId: 'default' },
    { name: '瞳孔地震', url: '/stickers/default/040_瞳孔地震.jpg', categoryId: 'default' },
    { name: '拒绝色色', url: '/stickers/default/041_拒绝色色.jpg', categoryId: 'default' },
    { name: '卖萌', url: '/stickers/default/042_卖萌.jpg', categoryId: 'default' },
    { name: '可爱', url: '/stickers/default/043_可爱.jpg', categoryId: 'default' },
    { name: '期待', url: '/stickers/default/044_期待.jpg', categoryId: 'default' },
    { name: '思考', url: '/stickers/default/045_思考.jpg', categoryId: 'default' },
    { name: '要钱', url: '/stickers/default/046_要钱.jpg', categoryId: 'default' },
    { name: '害羞', url: '/stickers/default/047_害羞.gif', categoryId: 'default' },
    { name: '蹭蹭', url: '/stickers/default/048_蹭蹭.jpg', categoryId: 'default' },
    { name: '被抓住', url: '/stickers/default/049_被抓住.jpg', categoryId: 'default' },
    { name: '鼓励', url: '/stickers/default/050_鼓励.gif', categoryId: 'default' },
    { name: '欣慰', url: '/stickers/default/051_欣慰.jpg', categoryId: 'default' },
    { name: '紧张', url: '/stickers/default/052_紧张.jpg', categoryId: 'default' },
    { name: '尖叫', url: '/stickers/default/053_尖叫.jpg', categoryId: 'default' },
    { name: '叼花', url: '/stickers/default/054_叼花.jpg', categoryId: 'default' },
    { name: '笑对人生', url: '/stickers/default/055_笑对人生.jpg', categoryId: 'default' },
    { name: '嗷呜', url: '/stickers/default/056_嗷呜.gif', categoryId: 'default' },
    { name: '担心', url: '/stickers/default/057_担心.gif', categoryId: 'default' },
    { name: '唉？', url: '/stickers/default/058_唉.jpg', categoryId: 'default' },
    { name: '偷偷摸摸', url: '/stickers/default/059_偷偷摸摸.jpg', categoryId: 'default' },
    { name: '哭', url: '/stickers/default/060_哭.jpg', categoryId: 'default' },
    { name: '抽象', url: '/stickers/default/061_抽象.jpg', categoryId: 'default' },
    { name: '抓', url: '/stickers/default/062_抓.gif', categoryId: 'default' },
    { name: '看手机', url: '/stickers/default/063_看手机.gif', categoryId: 'default' },
    { name: '溜走', url: '/stickers/default/064_溜走.jpg', categoryId: 'default' },
    { name: '我来了', url: '/stickers/default/065_我来了.jpg', categoryId: 'default' },
    { name: '皮', url: '/stickers/default/066_皮.gif', categoryId: 'default' },
    { name: '喜欢', url: '/stickers/default/067_喜欢.gif', categoryId: 'default' },
    { name: '想吃', url: '/stickers/default/068_想吃.jpg', categoryId: 'default' },
    { name: '严肃拒绝', url: '/stickers/default/069_严肃拒绝.jpg', categoryId: 'default' },
    { name: '色2', url: '/stickers/default/070_色2.jpg', categoryId: 'default' },
    { name: '亲晕', url: '/stickers/default/071_亲晕.gif', categoryId: 'default' },
    { name: '坏笑', url: '/stickers/default/072_坏笑.jpg', categoryId: 'default' },
    { name: '恐惧', url: '/stickers/default/073_恐惧.jpg', categoryId: 'default' },
    { name: '惊讶害羞', url: '/stickers/default/074_惊讶害羞.jpg', categoryId: 'default' },
    { name: '吃醋', url: '/stickers/default/075_吃醋.jpg', categoryId: 'default' },
    { name: '无语流汗', url: '/stickers/default/076_无语流汗.jpg', categoryId: 'default' },
    { name: '期待2', url: '/stickers/default/077_期待2.jpg', categoryId: 'default' },
    { name: '撇嘴', url: '/stickers/default/078_撇嘴.jpg', categoryId: 'default' },
    { name: '被喜欢害羞', url: '/stickers/default/079_被喜欢害羞.jpg', categoryId: 'default' },
    { name: '感动哭哭', url: '/stickers/default/080_感动哭哭.jpg', categoryId: 'default' },
    { name: '帅气自信', url: '/stickers/default/081_帅气自信.jpg', categoryId: 'default' },
    { name: '腹黑笑', url: '/stickers/default/082_腹黑笑.jpg', categoryId: 'default' },
    { name: '满意笑', url: '/stickers/default/083_满意笑.jpg', categoryId: 'default' },
    { name: '黑脸生气', url: '/stickers/default/084_黑脸生气.jpg', categoryId: 'default' },
    { name: '默认同意', url: '/stickers/default/085_默认同意.jpg', categoryId: 'default' },
    { name: '在意', url: '/stickers/default/086_在意.jpg', categoryId: 'default' },
    { name: '闭上眼仿佛可以看见天堂', url: '/stickers/default/087_闭上眼仿佛可以看见天堂.jpg', categoryId: 'default' },
    { name: '希望人没事', url: '/stickers/default/088_希望人没事.gif', categoryId: 'default' },
    { name: '嘻嘻', url: '/stickers/default/089_嘻嘻.jpg', categoryId: 'default' },
    { name: '呆住', url: '/stickers/default/090_呆住.jpg', categoryId: 'default' },
    { name: '开心跳舞', url: '/stickers/default/091_开心跳舞.gif', categoryId: 'default' },
    { name: '吐魂', url: '/stickers/default/092_吐魂.png', categoryId: 'default' },
    { name: '吃惊', url: '/stickers/default/093_吃惊.jpg', categoryId: 'default' },
    { name: '小意思', url: '/stickers/default/094_小意思.jpg', categoryId: 'default' },
    { name: '猫猫恼火', url: '/stickers/default/095_猫猫恼火.jpg', categoryId: 'default' },
    { name: '趴玻璃看你', url: '/stickers/default/096_趴玻璃看你.jpg', categoryId: 'default' },
    { name: '偷听', url: '/stickers/default/097_偷听.jpg', categoryId: 'default' },
    { name: '酒杯猫猫', url: '/stickers/default/098_酒杯猫猫.jpg', categoryId: 'default' },
    { name: '乖巧猫猫', url: '/stickers/default/099_乖巧猫猫.jpg', categoryId: 'default' },
    { name: '猫猫心虚', url: '/stickers/default/100_猫猫心虚.jpg', categoryId: 'default' },
    { name: '猫猫看你', url: '/stickers/default/101_猫猫看你.jpg', categoryId: 'default' },
    { name: '猫猫目移', url: '/stickers/default/102_猫猫目移.jpg', categoryId: 'default' },
    { name: '猫猫闭眼睡', url: '/stickers/default/103_猫猫闭眼睡.jpg', categoryId: 'default' },
    { name: '猫猫委屈瞪你', url: '/stickers/default/104_猫猫委屈瞪你.jpg', categoryId: 'default' },
    { name: '猫猫满脸疑问', url: '/stickers/default/105_猫猫满脸疑问.jpg', categoryId: 'default' },
    { name: '猫猫星星眼', url: '/stickers/default/106_猫猫星星眼.jpg', categoryId: 'default' },
    { name: '猫猫去世', url: '/stickers/default/107_猫猫去世.jpg', categoryId: 'default' },
    { name: '猫猫wink', url: '/stickers/default/108_猫猫wink.jpg', categoryId: 'default' },
    { name: '猫猫瞪你', url: '/stickers/default/109_猫猫瞪你.jpg', categoryId: 'default' },
    { name: '猫猫无语', url: '/stickers/default/110_猫猫无语.jpg', categoryId: 'default' },
    { name: '猫猫生气', url: '/stickers/default/111_猫猫生气.jpg', categoryId: 'default' },
    { name: '看你的猫猫', url: '/stickers/default/112_看你的猫猫.jpg', categoryId: 'default' },
    { name: '智慧的猫猫', url: '/stickers/default/113_智慧的猫猫.jpg', categoryId: 'default' },
    { name: '猫猫眼汪汪', url: '/stickers/default/114_猫猫眼汪汪.jpg', categoryId: 'default' },
    { name: '猫猫委屈', url: '/stickers/default/115_猫猫委屈.jpg', categoryId: 'default' },
    { name: '客服猫', url: '/stickers/default/116_客服猫.jpg', categoryId: 'default' },
    { name: '捣乱猫猫', url: '/stickers/default/117_捣乱猫猫.jpg', categoryId: 'default' },
    { name: '天真威胁', url: '/stickers/default/118_天真威胁.jpg', categoryId: 'default' },
    { name: '吃瓜', url: '/stickers/default/119_吃瓜.jpg', categoryId: 'default' },
    { name: '面包猫', url: '/stickers/default/120_面包猫.jpg', categoryId: 'default' },
    { name: '叼着', url: '/stickers/default/121_叼着.jpg', categoryId: 'default' },
    { name: '自恋', url: '/stickers/default/122_自恋.jpg', categoryId: 'default' },
    { name: '不愧是我', url: '/stickers/default/123_不愧是我.jpg', categoryId: 'default' },
    { name: '被冷落', url: '/stickers/default/124_被冷落.jpg', categoryId: 'default' },
    { name: '被冷落生气', url: '/stickers/default/125_被冷落生气.jpg', categoryId: 'default' },
    { name: '盯着', url: '/stickers/default/126_盯着.jpg', categoryId: 'default' },
    { name: '无奈', url: '/stickers/default/127_无奈.jpg', categoryId: 'default' },
    { name: '瞧着', url: '/stickers/default/128_瞧着.jpg', categoryId: 'default' },
    { name: '探出', url: '/stickers/default/129_探出.jpg', categoryId: 'default' },
    { name: '十斤半价', url: '/stickers/default/130_十斤半价.jpg', categoryId: 'default' },
    { name: '从上看你', url: '/stickers/default/131_从上看你.jpg', categoryId: 'default' },
    { name: '躺', url: '/stickers/default/132_躺.jpg', categoryId: 'default' },
    { name: '泪眼婆娑', url: '/stickers/default/133_泪眼婆娑.jpg', categoryId: 'default' },
    { name: '不度蝼蚁', url: '/stickers/default/134_不度蝼蚁.jpg', categoryId: 'default' },
    { name: '叫我吗？哼', url: '/stickers/default/135_叫我吗哼.jpg', categoryId: 'default' },
    { name: '叫我做什么', url: '/stickers/default/136_叫我做什么.jpg', categoryId: 'default' },
    { name: '嘴硬哭哭', url: '/stickers/default/137_嘴硬哭哭.jpg', categoryId: 'default' },
    { name: '我吗？', url: '/stickers/default/138_我吗.jpg', categoryId: 'default' },
    { name: '告辞', url: '/stickers/default/139_告辞.jpg', categoryId: 'default' },
    { name: '卖萌猫猫群', url: '/stickers/default/140_卖萌猫猫群.gif', categoryId: 'default' },
];

// 单例连接缓存。openDB 原本每次调用都新开一条 IDB 连接, 既不复用也不 close ——
// 在记忆管线 (hybridSearch / touchAccess 等) 并发读写下会瞬间堆出几十条主库连接
// 连接, 撑爆 Chromium 底层 backing store; 一旦底层报错, 整个 origin 的 IndexedDB
// (含 Service Worker 的 dedupe / inbox 库) 可能跟着开不了或被强关, Instant Push 因此确认超时。
// 改成复用同一条连接, 并在连接被外部失效 (另一 tab 升级版本 / 浏览器强制关闭) 时
// 清掉缓存, 下次 openDB 自动重开 —— 一处改, 全部 ~165 个调用点受益。
let dbPromise: Promise<IDBDatabase> | null = null;

export const openDB = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;

  const promise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    // onblocked 不是终态: 它先 reject, 但底层 open request 还活着, 等占用方关闭后仍会
    // 触发 onsuccess。用 settled 标记 promise 已 settle, 让那条迟到的连接被 close 掉而
    // 不是泄漏成一条没人持有、却能 block 后续升级/删库的孤儿连接。
    // 清缓存一律先比对 dbPromise === promise: onclose/onerror 等都是异步回调, 期间若已
    // 重开并缓存了新 promise, 陈旧连接的回调不能误清新单例 (否则又凭空多开一条连接)。
    let settled = false;

    request.onerror = () => {
        const err = request.error;
        // 版本回退兜底: 浏览器里已存在「比当前 build 的 DB_VERSION 更高」的版本时
        // (用户先跑过更新的 build / 另一个 tab 升过级 / SW 缓存了更新的 bundle),
        // 带 DB_VERSION 打开会抛 VersionError("lower version than existing")。
        // 旧逻辑直接 reject → 整个 origin 的 IndexedDB 读写全挂: SYSTEM ERROR、
        // 美化(themes 存在库里)读不出来、线下(LifeSim)进不去。其实更高版本的 store
        // 只是当前 schema 的超集, 不带版本号打开就能连到现有版本、读写完全兼容,
        // 不需要也不能降级建表。所以这里回退到「不带版本号 open」一次而不是报死。
        if (err?.name === 'VersionError') {
            console.warn('[DB] open VersionError —— 现有版本高于当前 build, 回退到不带版本号打开');
            settled = true; // 原 request 已终结 (VersionError 后不会再 onsuccess), 标记以防迟到回调
            const fb = indexedDB.open(DB_NAME); // 不带版本号 = 连到现有(更高)版本, 不触发 upgrade
            fb.onsuccess = () => {
                const db = fb.result;
                // 与正常路径一致地挂上失效自愈回调 (另一 tab 升级 / 浏览器强关连接)。
                db.onversionchange = () => {
                    db.close();
                    if (dbPromise === promise) dbPromise = null;
                };
                db.onclose = () => {
                    if (dbPromise === promise) dbPromise = null;
                };
                resolve(db);
            };
            fb.onerror = () => {
                console.error("DB Open Error (versionless fallback):", fb.error);
                if (dbPromise === promise) dbPromise = null;
                reject(fb.error);
            };
            return;
        }
        console.error("DB Open Error:", err);
        if (dbPromise === promise) dbPromise = null; // 打开失败别把 rejected promise 缓存住
        settled = true;
        reject(err);
    };

    request.onsuccess = () => {
        const db = request.result;
        // 已经 reject 过 (onblocked / onerror): 这条迟到的连接没人接收, 直接 close,
        // 否则它开着会 block 后续的版本升级 / deleteDatabase。
        if (settled) {
            try { db.close(); } catch { /* ignore */ }
            return;
        }
        // 另一个 tab 触发版本升级时必须主动 close 让位, 否则对方 open 会被 block;
        // 顺手清缓存, 下次 openDB 重开到新版本。
        db.onversionchange = () => {
            db.close();
            if (dbPromise === promise) dbPromise = null;
        };
        // Chromium 因 backing store 出错等原因强制关闭连接时触发 —— 清缓存自愈,
        // 避免后续操作一直复用一条已死的连接。
        //
        // 已知残余 (有意不修): onclose 是异步派发的, 强关到回调跑之间, 命中这条 fast-path
        // 的调用方会拿到将死连接, 其 db.transaction() 同步抛 InvalidStateError —— 当次操作
        // 失败, 但下一次调用就自愈。主库这 ~165 个调用点全是记忆管线 / UI 读写, 失败是
        // 瞬时且会自然重试的 (不丢数据), 不值得为它给每个调用点铺事务级重试 (要全覆盖得上
        // 共享 runTx 层并迁移所有 DB.* 方法, 是独立大重构)。SW inbox 那条路径不一样: 同样
        // 的竞态会让 push 静默丢失 → 主线程超时, 所以那边 (worker/sw-keep-alive.ts 的
        // withInboxTx) 单独补了「InvalidStateError 清缓存重开一次」的事务级兜底。
        db.onclose = () => {
            if (dbPromise === promise) dbPromise = null;
        };
        resolve(db);
    };

    request.onblocked = () => {
        // 另一个 tab 仍持有旧版本连接, 升级被挡。清缓存 + reject, 别让调用方无限挂着;
        // 与 activeMsgStore / sw-keep-alive 的 openDB 一致, 对方 tab 关闭后下次调用可重试。
        console.warn('[DB] open blocked —— 另一个 tab 仍持有旧版本连接未关闭');
        if (dbPromise === promise) dbPromise = null;
        settled = true;
        reject(new Error('IndexedDB open blocked —— 关闭其它标签页后重试'));
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      const createStore = (name: string, options?: IDBObjectStoreParameters) => {
          if (!db.objectStoreNames.contains(name)) {
              db.createObjectStore(name, options);
          }
      };

      createStore(STORE_CHARACTERS, { keyPath: 'id' });

      if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
        const msgStore = db.createObjectStore(STORE_MESSAGES, { keyPath: 'id', autoIncrement: true });
        msgStore.createIndex('charId', 'charId', { unique: false });
        msgStore.createIndex('groupId', 'groupId', { unique: false }); 
      } else {
          const msgStore = (event.target as IDBOpenDBRequest).transaction?.objectStore(STORE_MESSAGES);
          if (msgStore && !msgStore.indexNames.contains(STORE_MESSAGES) && !msgStore.indexNames.contains('groupId')) {
              try {
                  msgStore.createIndex('groupId', 'groupId', { unique: false });
              } catch (e) { console.log('Index already exists'); }
          }
      }

      // v75: 絮语私聊档案（每角色多份聊天记录，当前活跃记录仍恢复到 messages 表）
      if (!db.objectStoreNames.contains(STORE_PRIVATE_CHAT_ARCHIVES)) {
          const pcaStore = db.createObjectStore(STORE_PRIVATE_CHAT_ARCHIVES, { keyPath: 'id' });
          pcaStore.createIndex('charId', 'charId', { unique: false });
          pcaStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      } else {
          const pcaStore = (event.target as IDBOpenDBRequest).transaction?.objectStore(STORE_PRIVATE_CHAT_ARCHIVES);
          if (pcaStore && !pcaStore.indexNames.contains('charId')) {
              try { pcaStore.createIndex('charId', 'charId', { unique: false }); } catch { /* ignore */ }
          }
          if (pcaStore && !pcaStore.indexNames.contains('updatedAt')) {
              try { pcaStore.createIndex('updatedAt', 'updatedAt', { unique: false }); } catch { /* ignore */ }
          }
      }
      if (!db.objectStoreNames.contains(STORE_CHAT_ALARMS)) {
          const alarmStore = db.createObjectStore(STORE_CHAT_ALARMS, { keyPath: 'id' });
          alarmStore.createIndex('charId', 'charId', { unique: false });
          alarmStore.createIndex('nextAt', 'nextAt', { unique: false });
          alarmStore.createIndex('enabled', 'enabled', { unique: false });
      } else {
          const alarmStore = (event.target as IDBOpenDBRequest).transaction?.objectStore(STORE_CHAT_ALARMS);
          if (alarmStore && !alarmStore.indexNames.contains('charId')) {
              try { alarmStore.createIndex('charId', 'charId', { unique: false }); } catch { /* ignore */ }
          }
          if (alarmStore && !alarmStore.indexNames.contains('nextAt')) {
              try { alarmStore.createIndex('nextAt', 'nextAt', { unique: false }); } catch { /* ignore */ }
          }
          if (alarmStore && !alarmStore.indexNames.contains('enabled')) {
              try { alarmStore.createIndex('enabled', 'enabled', { unique: false }); } catch { /* ignore */ }
          }
      }

      // v88: 絮语总览（稍后回待办 + 今日摘要）
      if (!db.objectStoreNames.contains(STORE_CHAT_FOLLOWUPS)) {
          const followupStore = db.createObjectStore(STORE_CHAT_FOLLOWUPS, { keyPath: 'id' });
          followupStore.createIndex('status', 'status', { unique: false });
          followupStore.createIndex('targetId', 'targetId', { unique: false });
          followupStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      } else {
          const followupStore = (event.target as IDBOpenDBRequest).transaction?.objectStore(STORE_CHAT_FOLLOWUPS);
          if (followupStore && !followupStore.indexNames.contains('status')) {
              try { followupStore.createIndex('status', 'status', { unique: false }); } catch { /* ignore */ }
          }
          if (followupStore && !followupStore.indexNames.contains('targetId')) {
              try { followupStore.createIndex('targetId', 'targetId', { unique: false }); } catch { /* ignore */ }
          }
          if (followupStore && !followupStore.indexNames.contains('updatedAt')) {
              try { followupStore.createIndex('updatedAt', 'updatedAt', { unique: false }); } catch { /* ignore */ }
          }
      }
      if (!db.objectStoreNames.contains(STORE_CHAT_HUB_DIGESTS)) {
          const digestStore = db.createObjectStore(STORE_CHAT_HUB_DIGESTS, { keyPath: 'id' });
          digestStore.createIndex('date', 'date', { unique: false });
          digestStore.createIndex('createdAt', 'createdAt', { unique: false });
      } else {
          const digestStore = (event.target as IDBOpenDBRequest).transaction?.objectStore(STORE_CHAT_HUB_DIGESTS);
          if (digestStore && !digestStore.indexNames.contains('date')) {
              try { digestStore.createIndex('date', 'date', { unique: false }); } catch { /* ignore */ }
          }
          if (digestStore && !digestStore.indexNames.contains('createdAt')) {
              try { digestStore.createIndex('createdAt', 'createdAt', { unique: false }); } catch { /* ignore */ }
          }
      }

      // v62: messages 加 [charId, type] 复合索引。页外动态按 (charId, 'vr_card') 直取 vr_card，
      // 成本只跟 vr_card 条数相关，跟总消息量无关——上万条聊天的用户也不必把整段历史 getAll
      // 进内存再筛。没有 type 字段的老消息不会进此索引，正好不影响（我们只查 vr_card）。
      if (!db.objectStoreNames.contains(STORE_PERIOD_REMINDER_SETTINGS)) {
          const psStore = db.createObjectStore(STORE_PERIOD_REMINDER_SETTINGS, { keyPath: 'id' });
          psStore.createIndex('nextAt', 'nextAt', { unique: false });
          psStore.createIndex('enabled', 'enabled', { unique: false });
      } else {
          const psStore = (event.target as IDBOpenDBRequest).transaction?.objectStore(STORE_PERIOD_REMINDER_SETTINGS);
          if (psStore && !psStore.indexNames.contains('nextAt')) {
              try { psStore.createIndex('nextAt', 'nextAt', { unique: false }); } catch { /* ignore */ }
          }
          if (psStore && !psStore.indexNames.contains('enabled')) {
              try { psStore.createIndex('enabled', 'enabled', { unique: false }); } catch { /* ignore */ }
          }
      }
      if (!db.objectStoreNames.contains(STORE_PERIOD_CYCLE_EVENTS)) {
          const peStore = db.createObjectStore(STORE_PERIOD_CYCLE_EVENTS, { keyPath: 'id' });
          peStore.createIndex('date', 'date', { unique: false });
          peStore.createIndex('kind', 'kind', { unique: false });
      } else {
          const peStore = (event.target as IDBOpenDBRequest).transaction?.objectStore(STORE_PERIOD_CYCLE_EVENTS);
          if (peStore && !peStore.indexNames.contains('date')) {
              try { peStore.createIndex('date', 'date', { unique: false }); } catch { /* ignore */ }
          }
          if (peStore && !peStore.indexNames.contains('kind')) {
              try { peStore.createIndex('kind', 'kind', { unique: false }); } catch { /* ignore */ }
          }
      }

      if (!db.objectStoreNames.contains(STORE_HEALTH_MODULE_SETTINGS)) {
          db.createObjectStore(STORE_HEALTH_MODULE_SETTINGS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_HEALTH_RECORDS)) {
          const healthStore = db.createObjectStore(STORE_HEALTH_RECORDS, { keyPath: 'id' });
          healthStore.createIndex('moduleId', 'moduleId', { unique: false });
          healthStore.createIndex('date', 'date', { unique: false });
          healthStore.createIndex('moduleId_date', ['moduleId', 'date'], { unique: false });
      } else {
          const healthStore = (event.target as IDBOpenDBRequest).transaction?.objectStore(STORE_HEALTH_RECORDS);
          if (healthStore && !healthStore.indexNames.contains('moduleId')) {
              try { healthStore.createIndex('moduleId', 'moduleId', { unique: false }); } catch { /* ignore */ }
          }
          if (healthStore && !healthStore.indexNames.contains('date')) {
              try { healthStore.createIndex('date', 'date', { unique: false }); } catch { /* ignore */ }
          }
          if (healthStore && !healthStore.indexNames.contains('moduleId_date')) {
              try { healthStore.createIndex('moduleId_date', ['moduleId', 'date'], { unique: false }); } catch { /* ignore */ }
          }
      }
      if (!db.objectStoreNames.contains(STORE_HEALTH_REMINDERS)) {
          const reminderStore = db.createObjectStore(STORE_HEALTH_REMINDERS, { keyPath: 'id' });
          reminderStore.createIndex('moduleId', 'moduleId', { unique: false });
          reminderStore.createIndex('nextAt', 'nextAt', { unique: false });
          reminderStore.createIndex('enabled', 'enabled', { unique: false });
      } else {
          const reminderStore = (event.target as IDBOpenDBRequest).transaction?.objectStore(STORE_HEALTH_REMINDERS);
          if (reminderStore && !reminderStore.indexNames.contains('moduleId')) {
              try { reminderStore.createIndex('moduleId', 'moduleId', { unique: false }); } catch { /* ignore */ }
          }
          if (reminderStore && !reminderStore.indexNames.contains('nextAt')) {
              try { reminderStore.createIndex('nextAt', 'nextAt', { unique: false }); } catch { /* ignore */ }
          }
          if (reminderStore && !reminderStore.indexNames.contains('enabled')) {
              try { reminderStore.createIndex('enabled', 'enabled', { unique: false }); } catch { /* ignore */ }
          }
      }
      if (!db.objectStoreNames.contains(STORE_HEALTH_PLANS)) {
          const planStore = db.createObjectStore(STORE_HEALTH_PLANS, { keyPath: 'id' });
          planStore.createIndex('moduleId', 'moduleId', { unique: false });
      } else {
          const planStore = (event.target as IDBOpenDBRequest).transaction?.objectStore(STORE_HEALTH_PLANS);
          if (planStore && !planStore.indexNames.contains('moduleId')) {
              try { planStore.createIndex('moduleId', 'moduleId', { unique: false }); } catch { /* ignore */ }
          }
      }
      if (!db.objectStoreNames.contains(STORE_HEALTH_SUMMARIES)) {
          const summaryStore = db.createObjectStore(STORE_HEALTH_SUMMARIES, { keyPath: 'id' });
          summaryStore.createIndex('range', 'range', { unique: false });
          summaryStore.createIndex('startDate', 'startDate', { unique: false });
      } else {
          const summaryStore = (event.target as IDBOpenDBRequest).transaction?.objectStore(STORE_HEALTH_SUMMARIES);
          if (summaryStore && !summaryStore.indexNames.contains('range')) {
              try { summaryStore.createIndex('range', 'range', { unique: false }); } catch { /* ignore */ }
          }
          if (summaryStore && !summaryStore.indexNames.contains('startDate')) {
              try { summaryStore.createIndex('startDate', 'startDate', { unique: false }); } catch { /* ignore */ }
          }
      }
      if (!db.objectStoreNames.contains(STORE_HEALTH_IMPORT_BATCHES)) {
          const batchStore = db.createObjectStore(STORE_HEALTH_IMPORT_BATCHES, { keyPath: 'id' });
          batchStore.createIndex('source', 'source', { unique: false });
          batchStore.createIndex('createdAt', 'createdAt', { unique: false });
      } else {
          const batchStore = (event.target as IDBOpenDBRequest).transaction?.objectStore(STORE_HEALTH_IMPORT_BATCHES);
          if (batchStore && !batchStore.indexNames.contains('source')) {
              try { batchStore.createIndex('source', 'source', { unique: false }); } catch { /* ignore */ }
          }
          if (batchStore && !batchStore.indexNames.contains('createdAt')) {
              try { batchStore.createIndex('createdAt', 'createdAt', { unique: false }); } catch { /* ignore */ }
          }
      }

      try {
          const msgStore = (event.target as IDBOpenDBRequest).transaction?.objectStore(STORE_MESSAGES);
          if (msgStore && !msgStore.indexNames.contains('charId_type')) {
              msgStore.createIndex('charId_type', ['charId', 'type'], { unique: false });
          }
      } catch (e) { console.log('charId_type index migration skipped', e); }

      createStore(STORE_EMOJIS, { keyPath: 'name' });
      createStore(STORE_EMOJI_CATEGORIES, { keyPath: 'id' });

      createStore(STORE_THEMES, { keyPath: 'id' });
      createStore(STORE_ASSETS, { keyPath: 'id' });
      
      if (!db.objectStoreNames.contains(STORE_SCHEDULED)) {
        const schedStore = db.createObjectStore(STORE_SCHEDULED, { keyPath: 'id' });
        schedStore.createIndex('charId', 'charId', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_GALLERY)) {
          const galleryStore = db.createObjectStore(STORE_GALLERY, { keyPath: 'id' });
          galleryStore.createIndex('charId', 'charId', { unique: false });
      }

      createStore(STORE_USER, { keyPath: 'id' });
      
      if (!db.objectStoreNames.contains(STORE_DIARIES)) {
          const diaryStore = db.createObjectStore(STORE_DIARIES, { keyPath: 'id' });
          diaryStore.createIndex('charId', 'charId', { unique: false });
      }
      
      createStore(STORE_TASKS, { keyPath: 'id' });
      createStore(STORE_ANNIVERSARIES, { keyPath: 'id' });

      if (!db.objectStoreNames.contains(STORE_CALENDAR_MARKS)) {
          const calStore = db.createObjectStore(STORE_CALENDAR_MARKS, { keyPath: 'id' });
          calStore.createIndex('date', 'date', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_CHAR_LEDGERS)) {
          const clStore = db.createObjectStore(STORE_CHAR_LEDGERS, { keyPath: 'id' });
          clStore.createIndex('charId', 'charId', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_ROOM_TODOS)) {
          db.createObjectStore(STORE_ROOM_TODOS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_ROOM_NOTES)) {
          const notesStore = db.createObjectStore(STORE_ROOM_NOTES, { keyPath: 'id' });
          notesStore.createIndex('charId', 'charId', { unique: false });
      }

      createStore(STORE_GROUPS, { keyPath: 'id' });
      createStore(STORE_JOURNAL_STICKERS, { keyPath: 'name' });
      const ensureSocialIndexes = (store: IDBObjectStore) => {
          [
              ['timestamp', 'timestamp'],
              ['authorCharId', 'authorCharId'],
              ['authorType', 'authorType'],
              ['visibility', 'visibility'],
              ['lastActivityAt', 'lastActivityAt'],
              ['unreadForUser', 'unreadForUser'],
          ].forEach(([name, keyPath]) => {
              if (!store.indexNames.contains(name)) {
                  try { store.createIndex(name, keyPath, { unique: false }); } catch { /* ignore */ }
              }
          });
      };
      if (!db.objectStoreNames.contains(STORE_SOCIAL_POSTS)) {
          const socialStore = db.createObjectStore(STORE_SOCIAL_POSTS, { keyPath: 'id' });
          ensureSocialIndexes(socialStore);
      } else {
          const socialStore = (event.target as IDBOpenDBRequest).transaction?.objectStore(STORE_SOCIAL_POSTS);
          if (socialStore) ensureSocialIndexes(socialStore);
      }
      createStore(STORE_COURSES, { keyPath: 'id' });
      createStore(STORE_GAMES, { keyPath: 'id' }); 
      createStore(STORE_WORLDBOOKS, { keyPath: 'id' }); 
      createStore(STORE_NOVELS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_COVIEW_MEDIA)) {
          const coMedia = db.createObjectStore(STORE_COVIEW_MEDIA, { keyPath: 'id' });
          coMedia.createIndex('kind', 'kind', { unique: false });
          coMedia.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_COVIEW_BOOKS)) {
          const coBooks = db.createObjectStore(STORE_COVIEW_BOOKS, { keyPath: 'id' });
          coBooks.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_COVIEW_SESSIONS)) {
          const coSessions = db.createObjectStore(STORE_COVIEW_SESSIONS, { keyPath: 'id' });
          coSessions.createIndex('mode', 'mode', { unique: false });
          coSessions.createIndex('charId', 'charId', { unique: false });
          coSessions.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_COVIEW_MESSAGES)) {
          const coMessages = db.createObjectStore(STORE_COVIEW_MESSAGES, { keyPath: 'id' });
          coMessages.createIndex('sessionId', 'sessionId', { unique: false });
          coMessages.createIndex('createdAt', 'createdAt', { unique: false });
      }

      createStore(STORE_VR_NOVELS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_VR_ANNOTATIONS)) {
          const vrAnnStore = db.createObjectStore(STORE_VR_ANNOTATIONS, { keyPath: 'id' });
          vrAnnStore.createIndex('novelId', 'novelId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_CC_PARTS)) {
          const ccStore = db.createObjectStore(STORE_CC_PARTS, { keyPath: 'id' });
          ccStore.createIndex('categoryKey', 'categoryKey', { unique: false });
      }
      createStore(STORE_VR_MUSIC, { keyPath: 'id' });
      createStore(STORE_VR_GUESTBOOK, { keyPath: 'id' });
      createStore(STORE_VR_SCRIPTS, { keyPath: 'id' });
      createStore(STORE_VR_PLAYS, { keyPath: 'id' });
      createStore(STORE_VR_PRESETS, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(STORE_VR_LETTERS)) {
          const ltStore = db.createObjectStore(STORE_VR_LETTERS, { keyPath: 'id' });
          ltStore.createIndex('box', 'box', { unique: false });
      }
      createStore(STORE_VR_SETTINGS, { keyPath: 'id' });
      createStore(STORE_API_CALL_LOG, { keyPath: 'id' });

      createStore(STORE_BANK_TX, { keyPath: 'id' });
      createStore(STORE_BANK_DATA, { keyPath: 'id' });
      createStore(STORE_XHS_STOCK, { keyPath: 'id' });

      if (!db.objectStoreNames.contains(STORE_XHS_ACTIVITIES)) {
          const xhsActStore = db.createObjectStore(STORE_XHS_ACTIVITIES, { keyPath: 'id' });
          xhsActStore.createIndex('characterId', 'characterId', { unique: false });
      }

      createStore(STORE_XHS_FEED, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_TWITTER_TWEETS)) {
          const twStore = db.createObjectStore(STORE_TWITTER_TWEETS, { keyPath: 'id' });
          twStore.createIndex('createdAt', 'createdAt', { unique: false });
          twStore.createIndex('charId', 'charId', { unique: false });
          twStore.createIndex('authorType', 'authorType', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_TWITTER_NOTIFS)) {
          const tnStore = db.createObjectStore(STORE_TWITTER_NOTIFS, { keyPath: 'id' });
          tnStore.createIndex('tweetId', 'tweetId', { unique: false });
          tnStore.createIndex('actorCharId', 'actorCharId', { unique: false });
          tnStore.createIndex('createdAt', 'createdAt', { unique: false });
      }
      createStore(STORE_TWITTER_PROFILE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_TWITTER_ACCOUNTS)) {
          const taStore = db.createObjectStore(STORE_TWITTER_ACCOUNTS, { keyPath: 'id' });
          taStore.createIndex('handle', 'handle', { unique: false });
          taStore.createIndex('charId', 'charId', { unique: false });
          taStore.createIndex('authorType', 'authorType', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_TWITTER_DM)) {
          const dmStore = db.createObjectStore(STORE_TWITTER_DM, { keyPath: 'id' });
          dmStore.createIndex('accountId', 'accountId', { unique: false });
          dmStore.createIndex('participantCharId', 'participantCharId', { unique: false });
          dmStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_TWITTER_SEARCH)) {
          const searchStore = db.createObjectStore(STORE_TWITTER_SEARCH, { keyPath: 'id' });
          searchStore.createIndex('createdAt', 'createdAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_MUSIC_TRACKS)) {
          const mtStore = db.createObjectStore(STORE_MUSIC_TRACKS, { keyPath: 'id' });
          mtStore.createIndex('source', 'source', { unique: false });
          mtStore.createIndex('updatedAt', 'updatedAt', { unique: false });
          mtStore.createIndex('lastPlayedAt', 'lastPlayedAt', { unique: false });
          mtStore.createIndex('liked', 'liked', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_MUSIC_PLAYLISTS)) {
          const mplStore = db.createObjectStore(STORE_MUSIC_PLAYLISTS, { keyPath: 'id' });
          mplStore.createIndex('kind', 'kind', { unique: false });
          mplStore.createIndex('source', 'source', { unique: false });
          mplStore.createIndex('updatedAt', 'updatedAt', { unique: false });
          mplStore.createIndex('pinned', 'pinned', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_MUSIC_PLAYLIST_ITEMS)) {
          const mpiStore = db.createObjectStore(STORE_MUSIC_PLAYLIST_ITEMS, { keyPath: 'id' });
          mpiStore.createIndex('playlistId', 'playlistId', { unique: false });
          mpiStore.createIndex('trackId', 'trackId', { unique: false });
          mpiStore.createIndex('playlist_position', ['playlistId', 'position'], { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_MUSIC_PLAY_EVENTS)) {
          const mpeStore = db.createObjectStore(STORE_MUSIC_PLAY_EVENTS, { keyPath: 'id' });
          mpeStore.createIndex('trackId', 'trackId', { unique: false });
          mpeStore.createIndex('startedAt', 'startedAt', { unique: false });
          mpeStore.createIndex('playSource', 'playSource', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_MUSIC_SEARCH_HISTORY)) {
          const mshStore = db.createObjectStore(STORE_MUSIC_SEARCH_HISTORY, { keyPath: 'id' });
          mshStore.createIndex('keyword', 'keyword', { unique: true });
          mshStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_MUSIC_RECOMMEND_CACHE)) {
          const mrcStore = db.createObjectStore(STORE_MUSIC_RECOMMEND_CACHE, { keyPath: 'id' });
          mrcStore.createIndex('kind', 'kind', { unique: false });
          mrcStore.createIndex('key', 'key', { unique: false });
          mrcStore.createIndex('expiresAt', 'expiresAt', { unique: false });
      }
      createStore(STORE_SONGS, { keyPath: 'id' });
      createStore(STORE_QUIZZES, { keyPath: 'id' });
      createStore(STORE_GUIDEBOOK, { keyPath: 'id' });
      createStore(STORE_LIFE_SIM, { keyPath: 'id' });
      createStore(STORE_DAILY_SCHEDULE, { keyPath: 'id' });
      createStore(STORE_HANDBOOK, { keyPath: 'id' });

      createStore(STORE_TRACKERS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_TRACKER_ENTRIES)) {
          const teStore = db.createObjectStore(STORE_TRACKER_ENTRIES, { keyPath: 'id' });
          teStore.createIndex('trackerId', 'trackerId', { unique: false });
          teStore.createIndex('date', 'date', { unique: false });
      }

      createStore(STORE_HOTNEWS, { keyPath: 'id' });

      // ─── 回忆标本馆 stores ───
      if (!db.objectStoreNames.contains('memory_nodes')) {
          const mnStore = db.createObjectStore('memory_nodes', { keyPath: 'id' });
          mnStore.createIndex('charId', 'charId', { unique: false });
          mnStore.createIndex('room', 'room', { unique: false });
          mnStore.createIndex('embedded', 'embedded', { unique: false });
          mnStore.createIndex('boxId', 'boxId', { unique: false }); // deprecated，保留索引兼容旧数据
          mnStore.createIndex('eventBoxId', 'eventBoxId', { unique: false });
      } else {
          // Migration: 为已有 memory_nodes 表补建 eventBoxId 索引（v47 新增）
          const mnStore = (event.target as IDBOpenDBRequest).transaction?.objectStore('memory_nodes');
          if (mnStore && !mnStore.indexNames.contains('eventBoxId')) {
              try { mnStore.createIndex('eventBoxId', 'eventBoxId', { unique: false }); }
              catch (e) { console.log('memory_nodes eventBoxId index migration skipped'); }
          }
      }

      if (!db.objectStoreNames.contains('memory_vectors')) {
          const mvStore = db.createObjectStore('memory_vectors', { keyPath: 'memoryId' });
          mvStore.createIndex('charId', 'charId', { unique: false });
      } else {
          // Migration: add charId index to existing memory_vectors store
          const mvStore = (event.target as IDBOpenDBRequest).transaction?.objectStore('memory_vectors');
          if (mvStore && !mvStore.indexNames.contains('charId')) {
              try { mvStore.createIndex('charId', 'charId', { unique: false }); } catch (e) { console.log('memory_vectors charId index migration skipped'); }
          }
      }

      if (!db.objectStoreNames.contains('memory_links')) {
          const mlStore = db.createObjectStore('memory_links', { keyPath: 'id' });
          mlStore.createIndex('sourceId', 'sourceId', { unique: false });
          mlStore.createIndex('targetId', 'targetId', { unique: false });
      }

      if (!db.objectStoreNames.contains('memory_batches')) {
          const mbStore = db.createObjectStore('memory_batches', { keyPath: 'id' });
          mbStore.createIndex('charId', 'charId', { unique: false });
      }

      if (!db.objectStoreNames.contains('topic_boxes')) {
          const tbStore = db.createObjectStore('topic_boxes', { keyPath: 'id' });
          tbStore.createIndex('charId', 'charId', { unique: false });
          tbStore.createIndex('status', 'status', { unique: false });
      }

      if (!db.objectStoreNames.contains('anticipations')) {
          const antStore = db.createObjectStore('anticipations', { keyPath: 'id' });
          antStore.createIndex('charId', 'charId', { unique: false });
          antStore.createIndex('status', 'status', { unique: false });
      }

      // ─── EventBox（事件盒，v47 新增） ───────────────
      if (!db.objectStoreNames.contains('event_boxes')) {
          const ebStore = db.createObjectStore('event_boxes', { keyPath: 'id' });
          ebStore.createIndex('charId', 'charId', { unique: false });
      }

      // ─── v48 一次性强制清空回忆标本馆（EventBox 体系，旧 boxId 数据不兼容） ───
      //     oldVersion === 0 = 全新安装，没东西可清
      //     oldVersion >= 48 = 已经清过，跳过
      //     0 < oldVersion < 48 = 现有用户升级 → 清一次
      const oldVersion = event.oldVersion || 0;
      if (oldVersion > 0 && oldVersion < 48) {
          const upgradeTx = (event.target as IDBOpenDBRequest).transaction;
          const MP_STORES_TO_CLEAR = [
              'memory_nodes', 'memory_vectors', 'memory_links',
              'memory_batches', 'topic_boxes', 'anticipations', 'event_boxes',
          ];
          let cleared = 0;
          for (const name of MP_STORES_TO_CLEAR) {
              if (db.objectStoreNames.contains(name) && upgradeTx) {
                  try {
                      upgradeTx.objectStore(name).clear();
                      cleared++;
                  } catch (e) {
                      console.warn(`[DB v48 wipe] skip ${name}:`, e);
                  }
              }
          }
          // 同步清理 localStorage 里的高水位标记
          let hwmCleared = 0;
          try {
              const toRemove: string[] = [];
              for (let i = 0; i < localStorage.length; i++) {
                  const key = localStorage.key(i);
                  if (key && key.startsWith('mp_lastMsgId_')) toRemove.push(key);
              }
              for (const key of toRemove) { localStorage.removeItem(key); hwmCleared++; }
          } catch { /* ignore */ }
          console.log(`🗑️ [DB v48] 一次性清空完成：${cleared} 个 store，${hwmCleared} 个高水位（oldVersion=${oldVersion}）`);
      }

      // ─── Pixel Home（像素家园）stores ───────────────
      if (!db.objectStoreNames.contains('pixel_home_assets')) {
          const phaStore = db.createObjectStore('pixel_home_assets', { keyPath: 'id' });
          phaStore.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('pixel_home_layouts')) {
          const phlStore = db.createObjectStore('pixel_home_layouts', { keyPath: ['charId', 'roomId'] });
          phlStore.createIndex('charId', 'charId', { unique: false });
      }

      // ─── v63: 电话 App / 日记社 / 偷看心声 ───────────────
      if (!db.objectStoreNames.contains(STORE_PHONE_CALL_LOGS)) {
          const pclStore = db.createObjectStore(STORE_PHONE_CALL_LOGS, { keyPath: 'id' });
          pclStore.createIndex('charId', 'charId', { unique: false });
          pclStore.createIndex('timestamp', 'timestamp', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_PHONE_CHECK_SESSIONS)) {
          const pcsStore = db.createObjectStore(STORE_PHONE_CHECK_SESSIONS, { keyPath: 'id' });
          pcsStore.createIndex('charId', 'charId', { unique: false });
          pcsStore.createIndex('direction', 'direction', { unique: false });
          pcsStore.createIndex('startedAt', 'startedAt', { unique: false });
          pcsStore.createIndex('status', 'status', { unique: false });
      } else {
          const pcsStore = (event.target as IDBOpenDBRequest).transaction?.objectStore(STORE_PHONE_CHECK_SESSIONS);
          if (pcsStore && !pcsStore.indexNames.contains('charId')) {
              try { pcsStore.createIndex('charId', 'charId', { unique: false }); } catch { /* ignore */ }
          }
          if (pcsStore && !pcsStore.indexNames.contains('direction')) {
              try { pcsStore.createIndex('direction', 'direction', { unique: false }); } catch { /* ignore */ }
          }
          if (pcsStore && !pcsStore.indexNames.contains('startedAt')) {
              try { pcsStore.createIndex('startedAt', 'startedAt', { unique: false }); } catch { /* ignore */ }
          }
          if (pcsStore && !pcsStore.indexNames.contains('status')) {
              try { pcsStore.createIndex('status', 'status', { unique: false }); } catch { /* ignore */ }
          }
      }
      if (!db.objectStoreNames.contains(STORE_USER_SCREEN_WATCH)) {
          const uswStore = db.createObjectStore(STORE_USER_SCREEN_WATCH, { keyPath: 'id' });
          uswStore.createIndex('charId', 'charId', { unique: false });
          uswStore.createIndex('startedAt', 'startedAt', { unique: false });
          uswStore.createIndex('updatedAt', 'updatedAt', { unique: false });
          uswStore.createIndex('status', 'status', { unique: false });
      } else {
          const uswStore = (event.target as IDBOpenDBRequest).transaction?.objectStore(STORE_USER_SCREEN_WATCH);
          if (uswStore && !uswStore.indexNames.contains('charId')) {
              try { uswStore.createIndex('charId', 'charId', { unique: false }); } catch { /* ignore */ }
          }
          if (uswStore && !uswStore.indexNames.contains('startedAt')) {
              try { uswStore.createIndex('startedAt', 'startedAt', { unique: false }); } catch { /* ignore */ }
          }
          if (uswStore && !uswStore.indexNames.contains('updatedAt')) {
              try { uswStore.createIndex('updatedAt', 'updatedAt', { unique: false }); } catch { /* ignore */ }
          }
          if (uswStore && !uswStore.indexNames.contains('status')) {
              try { uswStore.createIndex('status', 'status', { unique: false }); } catch { /* ignore */ }
          }
      }
      createStore(STORE_EXCHANGE_DIARY, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_INNER_VOICES)) {
          const ivStore = db.createObjectStore(STORE_INNER_VOICES, { keyPath: 'id' });
          ivStore.createIndex('charId', 'charId', { unique: false });
      }

      // ─── v64: 预设 App（SillyTavern 式 Chat Completion 预设） ───
      createStore(STORE_LLM_PRESETS, { keyPath: 'id' });
      createStore(STORE_PERSONAS, { keyPath: 'id' });

      // ─── v69: 来往·角色离线自主生活（autonomous life）事件 ───
      if (!db.objectStoreNames.contains(STORE_CHAR_LIFE_EVENTS)) {
          const leStore = db.createObjectStore(STORE_CHAR_LIFE_EVENTS, { keyPath: 'id' });
          leStore.createIndex('charId', 'charId', { unique: false });
          leStore.createIndex('timestamp', 'timestamp', { unique: false });
      }

      // ─── v76: 循迹 App（Screenlife 演出 / 监视快照 / 报备 / 设置） ───
      if (!db.objectStoreNames.contains(STORE_XUNJI_RUNS)) {
          const xjRunStore = db.createObjectStore(STORE_XUNJI_RUNS, { keyPath: 'id' });
          xjRunStore.createIndex('charId', 'charId', { unique: false });
          xjRunStore.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_XUNJI_SNAPSHOTS)) {
          const xjSnapStore = db.createObjectStore(STORE_XUNJI_SNAPSHOTS, { keyPath: 'id' });
          xjSnapStore.createIndex('charId', 'charId', { unique: false });
          xjSnapStore.createIndex('generatedAt', 'generatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_XUNJI_REPORTS)) {
          const xjReportStore = db.createObjectStore(STORE_XUNJI_REPORTS, { keyPath: 'id' });
          xjReportStore.createIndex('charId', 'charId', { unique: false });
          xjReportStore.createIndex('timestamp', 'timestamp', { unique: false });
          xjReportStore.createIndex('type', 'type', { unique: false });
      }
      createStore(STORE_XUNJI_SETTINGS, { keyPath: 'id' });

      // v79: Relationship Network char-char edges, private messages, and auto settings.
      if (!db.objectStoreNames.contains(STORE_RELATIONSHIP_NETWORK_EDGES)) {
          const rnEdgeStore = db.createObjectStore(STORE_RELATIONSHIP_NETWORK_EDGES, { keyPath: 'id' });
          rnEdgeStore.createIndex('pairKey', 'pairKey', { unique: true });
          rnEdgeStore.createIndex('updatedAt', 'updatedAt', { unique: false });
          rnEdgeStore.createIndex('lastInteractionAt', 'lastInteractionAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_RELATIONSHIP_NETWORK_MESSAGES)) {
          const rnMsgStore = db.createObjectStore(STORE_RELATIONSHIP_NETWORK_MESSAGES, { keyPath: 'id' });
          rnMsgStore.createIndex('pairKey', 'pairKey', { unique: false });
          rnMsgStore.createIndex('createdAt', 'createdAt', { unique: false });
          rnMsgStore.createIndex('speakerId', 'speakerId', { unique: false });
      }
      createStore(STORE_RELATIONSHIP_NETWORK_SETTINGS, { keyPath: 'id' });

      // ─── v70: 折子戏·谈心会话 ───
      if (!db.objectStoreNames.contains(STORE_TALK_SESSIONS)) {
          const tsStore = db.createObjectStore(STORE_TALK_SESSIONS, { keyPath: 'id' });
          tsStore.createIndex('charId', 'charId', { unique: false });
          tsStore.createIndex('lastActiveAt', 'lastActiveAt', { unique: false });
      }
      // ─── v73: 折子戏·狼人杀对局 ───
      if (!db.objectStoreNames.contains(STORE_WEREWOLF_GAMES)) {
          const wwStore = db.createObjectStore(STORE_WEREWOLF_GAMES, { keyPath: 'id' });
          wwStore.createIndex('lastActiveAt', 'lastActiveAt', { unique: false });
      }
      // ─── v74: 折子戏·真心话大冒险 ───
      if (!db.objectStoreNames.contains(STORE_TRUTHDARE_SESSIONS)) {
          const tdStore = db.createObjectStore(STORE_TRUTHDARE_SESSIONS, { keyPath: 'id' });
          tdStore.createIndex('lastActiveAt', 'lastActiveAt', { unique: false });
      }
      // ─── v81: 折子戏·番外问卷会话 ───
      if (!db.objectStoreNames.contains(STORE_THEATER_QUIZ_SESSIONS)) {
          const tqStore = db.createObjectStore(STORE_THEATER_QUIZ_SESSIONS, { keyPath: 'id' });
          tqStore.createIndex('lastActiveAt', 'lastActiveAt', { unique: false });
          tqStore.createIndex('status', 'status', { unique: false });
      }
      // ─── v85: 折子戏·仿真图文历史 ───
      if (!db.objectStoreNames.contains(STORE_THEATER_FAUX_PIECES)) {
          const tfStore = db.createObjectStore(STORE_THEATER_FAUX_PIECES, { keyPath: 'id' });
          tfStore.createIndex('charId', 'charId', { unique: false });
          tfStore.createIndex('kind', 'kind', { unique: false });
          tfStore.createIndex('createdAt', 'createdAt', { unique: false });
      }
      // ─── v93: 幕间集·用户导入小剧场 / 问卷库 ───
      if (!db.objectStoreNames.contains(STORE_THEATER_CUSTOM_LIBRARY)) {
          const tclStore = db.createObjectStore(STORE_THEATER_CUSTOM_LIBRARY, { keyPath: 'id' });
          tclStore.createIndex('kind', 'kind', { unique: false });
          tclStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      // ─── v86: 折子戏·对影会话 ───
      if (!db.objectStoreNames.contains(STORE_THEATER_REFLECTION_SESSIONS)) {
          const trStore = db.createObjectStore(STORE_THEATER_REFLECTION_SESSIONS, { keyPath: 'id' });
          trStore.createIndex('charId', 'charId', { unique: false });
          trStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      // ─── v96: 幕间集·一起入眠会话 ───
      if (!db.objectStoreNames.contains(STORE_THEATER_SLEEP_SESSIONS)) {
          const sleepStore = db.createObjectStore(STORE_THEATER_SLEEP_SESSIONS, { keyPath: 'id' });
          sleepStore.createIndex('charId', 'charId', { unique: false });
          sleepStore.createIndex('lastActiveAt', 'lastActiveAt', { unique: false });
          sleepStore.createIndex('status', 'status', { unique: false });
      }
      // ─── v97: 幕间集·五子棋 ───
      if (!db.objectStoreNames.contains(STORE_THEATER_GOMOKU_GAMES)) {
          const gomokuStore = db.createObjectStore(STORE_THEATER_GOMOKU_GAMES, { keyPath: 'id' });
          gomokuStore.createIndex('charId', 'charId', { unique: false });
          gomokuStore.createIndex('lastActiveAt', 'lastActiveAt', { unique: false });
          gomokuStore.createIndex('status', 'status', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_THEATER_GOMOKU_INVITATIONS)) {
          const inviteStore = db.createObjectStore(STORE_THEATER_GOMOKU_INVITATIONS, { keyPath: 'id' });
          inviteStore.createIndex('charId', 'charId', { unique: false });
          inviteStore.createIndex('updatedAt', 'updatedAt', { unique: false });
          inviteStore.createIndex('status', 'status', { unique: false });
      }
      // ─── v98: 幕间集·围棋 ───
      if (!db.objectStoreNames.contains(STORE_THEATER_GO_GAMES)) {
          const goStore = db.createObjectStore(STORE_THEATER_GO_GAMES, { keyPath: 'id' });
          goStore.createIndex('charId', 'charId', { unique: false });
          goStore.createIndex('lastActiveAt', 'lastActiveAt', { unique: false });
          goStore.createIndex('status', 'status', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_THEATER_GO_INVITATIONS)) {
          const inviteStore = db.createObjectStore(STORE_THEATER_GO_INVITATIONS, { keyPath: 'id' });
          inviteStore.createIndex('charId', 'charId', { unique: false });
          inviteStore.createIndex('updatedAt', 'updatedAt', { unique: false });
          inviteStore.createIndex('status', 'status', { unique: false });
      }
      // ─── v99: 幕间集·斗地主 ───
      if (!db.objectStoreNames.contains(STORE_THEATER_DOUDIZHU_GAMES)) {
          const doudizhuStore = db.createObjectStore(STORE_THEATER_DOUDIZHU_GAMES, { keyPath: 'id' });
          doudizhuStore.createIndex('charIds', 'charIds', { unique: false, multiEntry: true });
          doudizhuStore.createIndex('lastActiveAt', 'lastActiveAt', { unique: false });
          doudizhuStore.createIndex('status', 'status', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_THEATER_DOUDIZHU_INVITATIONS)) {
          const inviteStore = db.createObjectStore(STORE_THEATER_DOUDIZHU_INVITATIONS, { keyPath: 'id' });
          inviteStore.createIndex('charId', 'charId', { unique: false });
          inviteStore.createIndex('updatedAt', 'updatedAt', { unique: false });
          inviteStore.createIndex('status', 'status', { unique: false });
      }
      // ─── v100: 幕间集·海龟汤 ───
      if (!db.objectStoreNames.contains(STORE_THEATER_TURTLE_SOUP_GAMES)) {
          const soupStore = db.createObjectStore(STORE_THEATER_TURTLE_SOUP_GAMES, { keyPath: 'id' });
          soupStore.createIndex('charIds', 'charIds', { unique: false, multiEntry: true });
          soupStore.createIndex('hostCharId', 'host.charId', { unique: false });
          soupStore.createIndex('lastActiveAt', 'lastActiveAt', { unique: false });
          soupStore.createIndex('status', 'status', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_THEATER_TURTLE_SOUP_INVITATIONS)) {
          const inviteStore = db.createObjectStore(STORE_THEATER_TURTLE_SOUP_INVITATIONS, { keyPath: 'id' });
          inviteStore.createIndex('charId', 'charId', { unique: false });
          inviteStore.createIndex('updatedAt', 'updatedAt', { unique: false });
          inviteStore.createIndex('status', 'status', { unique: false });
      }
      // ─── v70: 岁时记·典藏馆收录条目 ───
      // ─── v101: 幕间集·麻将 ───
      if (!db.objectStoreNames.contains(STORE_THEATER_MAHJONG_GAMES)) {
          const mahjongStore = db.createObjectStore(STORE_THEATER_MAHJONG_GAMES, { keyPath: 'id' });
          mahjongStore.createIndex('charIds', 'charIds', { unique: false, multiEntry: true });
          mahjongStore.createIndex('lastActiveAt', 'lastActiveAt', { unique: false });
          mahjongStore.createIndex('status', 'status', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_THEATER_MAHJONG_INVITATIONS)) {
          const inviteStore = db.createObjectStore(STORE_THEATER_MAHJONG_INVITATIONS, { keyPath: 'id' });
          inviteStore.createIndex('charId', 'charId', { unique: false });
          inviteStore.createIndex('updatedAt', 'updatedAt', { unique: false });
          inviteStore.createIndex('status', 'status', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_COLLECTION_ITEMS)) {
          const ciStore = db.createObjectStore(STORE_COLLECTION_ITEMS, { keyPath: 'id' });
          ciStore.createIndex('collectedAt', 'collectedAt', { unique: false });
          ciStore.createIndex('sourceType', 'sourceType', { unique: false });
      }
      // ─── v71: 外卖 App 订单 ───
      if (!db.objectStoreNames.contains(STORE_TAKEOUT_ORDERS)) {
          const toStore = db.createObjectStore(STORE_TAKEOUT_ORDERS, { keyPath: 'id' });
          toStore.createIndex('placedAt', 'placedAt', { unique: false });
          toStore.createIndex('charId', 'charId', { unique: false });
      }

      // ─── v72: 折子戏·占卜牌库 ───
      if (!db.objectStoreNames.contains(STORE_DIVINATION_CARDS)) {
          const dcStore = db.createObjectStore(STORE_DIVINATION_CARDS, { keyPath: 'id' });
          dcStore.createIndex('deck', 'deck', { unique: false });
      }
      createStore(STORE_DESKTOP_PET, { keyPath: 'id' });
    };
  });

  dbPromise = promise;
  return promise;
};

const getAllStoreItems = async <T,>(storeName: string): Promise<T[]> => {
    const db = await openDB();
    if (!db.objectStoreNames.contains(storeName)) return [];
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => resolve((req.result || []) as T[]);
        req.onerror = () => reject(req.error);
    });
};

const getStoreItem = async <T,>(storeName: string, id: IDBValidKey): Promise<T | null> => {
    const db = await openDB();
    if (!db.objectStoreNames.contains(storeName)) return null;
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get(id);
        req.onsuccess = () => resolve((req.result || null) as T | null);
        req.onerror = () => reject(req.error);
    });
};

const putStoreItem = async <T,>(storeName: string, item: T): Promise<void> => {
    const db = await openDB();
    if (!db.objectStoreNames.contains(storeName)) return;
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(item as any);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
};

const deleteStoreItem = async (storeName: string, id: IDBValidKey): Promise<void> => {
    const db = await openDB();
    if (!db.objectStoreNames.contains(storeName)) return;
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
};

export const DB = {
  deleteDB: async (): Promise<void> => {
      // 删库前先关掉单例连接, 否则这条还开着的连接会 block 掉 deleteDatabase。
      if (dbPromise) {
          try { (await dbPromise).close(); } catch { /* ignore */ }
          dbPromise = null;
      }
      return new Promise((resolve, reject) => {
          const req = indexedDB.deleteDatabase(DB_NAME);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
          req.onblocked = () => console.warn('Delete blocked');
      });
  },

  deleteByIndex: async (storeName: string, indexName: string, value: IDBValidKey): Promise<number> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(storeName)) return 0;
      return new Promise((resolve, reject) => {
          const tx = db.transaction(storeName, 'readwrite');
          const store = tx.objectStore(storeName);
          let deleted = 0;
          const deleteCursor = (request: IDBRequest<IDBCursorWithValue | null>) => {
              request.onsuccess = () => {
                  const cursor = request.result;
                  if (!cursor) return;
                  cursor.delete();
                  deleted++;
                  cursor.continue();
              };
              request.onerror = () => reject(request.error);
          };
          if (!store.indexNames.contains(indexName)) {
              const request = store.openCursor();
              request.onsuccess = () => {
                  const cursor = request.result;
                  if (!cursor) return;
                  if ((cursor.value as any)?.[indexName] === value) {
                      cursor.delete();
                      deleted++;
                  }
                  cursor.continue();
              };
              request.onerror = () => reject(request.error);
              tx.oncomplete = () => resolve(deleted);
              tx.onerror = () => reject(tx.error);
              tx.onabort = () => reject(tx.error);
              return;
          }
          const index = store.index(indexName);
          const request = index.openCursor(IDBKeyRange.only(value));
          deleteCursor(request);
          tx.oncomplete = () => resolve(deleted);
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
      });
  },

  updateByCursor: async (storeName: string, updater: (value: any, key: IDBValidKey) => false | 'delete' | any): Promise<number> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(storeName)) return 0;
      return new Promise((resolve, reject) => {
          const tx = db.transaction(storeName, 'readwrite');
          const store = tx.objectStore(storeName);
          const request = store.openCursor();
          let touched = 0;
          request.onsuccess = () => {
              const cursor = request.result;
              if (!cursor) return;
              const next = updater(cursor.value, cursor.key);
              if (next === 'delete') {
                  cursor.delete();
                  touched++;
              } else if (next) {
                  cursor.update(next);
                  touched++;
              }
              cursor.continue();
          };
          request.onerror = () => reject(request.error);
          tx.oncomplete = () => resolve(touched);
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
      });
  },

  deleteByCursor: async (storeName: string, predicate: (value: any, key: IDBValidKey) => boolean): Promise<number> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(storeName)) return 0;
      return new Promise((resolve, reject) => {
          const tx = db.transaction(storeName, 'readwrite');
          const store = tx.objectStore(storeName);
          const request = store.openCursor();
          let deleted = 0;
          request.onsuccess = () => {
              const cursor = request.result;
              if (!cursor) return;
              if (predicate(cursor.value, cursor.key)) {
                  cursor.delete();
                  deleted++;
              }
              cursor.continue();
          };
          request.onerror = () => reject(request.error);
          tx.oncomplete = () => resolve(deleted);
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
      });
  },

  deletePixelHomeLayoutsByCharId: async (charId: string): Promise<number> => {
      return DB.deleteByIndex('pixel_home_layouts', 'charId', charId);
  },

  getAllCharacters: async (): Promise<CharacterProfile[]> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_CHARACTERS, 'readonly');
      const store = transaction.objectStore(STORE_CHARACTERS);
      const request = store.getAll();
      request.onsuccess = () => resolve(((request.result || []) as CharacterProfile[]).map(c => normalizeCharacterDefaults(c)));
      request.onerror = () => reject(request.error);
    });
  },

  saveCharacter: async (character: CharacterProfile): Promise<void> => {
    const db = await openDB();
    const normalizedCharacter = normalizeCharacterDefaults(character);
    // 等事务真正提交再 resolve —— 否则调用方 await 后立刻重读 DB 会拿到旧值 (情绪 buff 落库竞态根因).
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_CHARACTERS, 'readwrite');
      transaction.objectStore(STORE_CHARACTERS).put(normalizedCharacter);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('saveCharacter aborted'));
    });
  },

  deleteCharacter: async (id: string): Promise<void> => {
    const db = await openDB();
    const stores = [
        STORE_CHARACTERS,
        ...(db.objectStoreNames.contains(STORE_CHAT_ALARMS) ? [STORE_CHAT_ALARMS] : []),
        ...(db.objectStoreNames.contains(STORE_USER_SCREEN_WATCH) ? [STORE_USER_SCREEN_WATCH] : []),
        ...(db.objectStoreNames.contains(STORE_THEATER_GOMOKU_GAMES) ? [STORE_THEATER_GOMOKU_GAMES] : []),
        ...(db.objectStoreNames.contains(STORE_THEATER_GOMOKU_INVITATIONS) ? [STORE_THEATER_GOMOKU_INVITATIONS] : []),
        ...(db.objectStoreNames.contains(STORE_THEATER_GO_GAMES) ? [STORE_THEATER_GO_GAMES] : []),
        ...(db.objectStoreNames.contains(STORE_THEATER_GO_INVITATIONS) ? [STORE_THEATER_GO_INVITATIONS] : []),
        ...(db.objectStoreNames.contains(STORE_THEATER_DOUDIZHU_GAMES) ? [STORE_THEATER_DOUDIZHU_GAMES] : []),
        ...(db.objectStoreNames.contains(STORE_THEATER_DOUDIZHU_INVITATIONS) ? [STORE_THEATER_DOUDIZHU_INVITATIONS] : []),
        ...(db.objectStoreNames.contains(STORE_THEATER_TURTLE_SOUP_GAMES) ? [STORE_THEATER_TURTLE_SOUP_GAMES] : []),
        ...(db.objectStoreNames.contains(STORE_THEATER_TURTLE_SOUP_INVITATIONS) ? [STORE_THEATER_TURTLE_SOUP_INVITATIONS] : []),
        ...(db.objectStoreNames.contains(STORE_THEATER_MAHJONG_GAMES) ? [STORE_THEATER_MAHJONG_GAMES] : []),
        ...(db.objectStoreNames.contains(STORE_THEATER_MAHJONG_INVITATIONS) ? [STORE_THEATER_MAHJONG_INVITATIONS] : []),
    ];
    const transaction = db.transaction(stores, 'readwrite');
    transaction.objectStore(STORE_CHARACTERS).delete(id);
    const deleteByCharId = (storeName: string) => {
        if (!db.objectStoreNames.contains(storeName)) return;
        const store = transaction.objectStore(storeName);
        if (!store.indexNames.contains('charId')) return;
        const idx = store.index('charId');
        const req = idx.openCursor(IDBKeyRange.only(id));
        req.onsuccess = () => {
            const cursor = req.result;
            if (!cursor) return;
            cursor.delete();
            cursor.continue();
        };
    };
    const deleteByCharIds = (storeName: string) => {
        if (!db.objectStoreNames.contains(storeName)) return;
        const store = transaction.objectStore(storeName);
        if (!store.indexNames.contains('charIds')) return;
        const idx = store.index('charIds');
        const req = idx.openCursor(IDBKeyRange.only(id));
        req.onsuccess = () => {
            const cursor = req.result;
            if (!cursor) return;
            cursor.delete();
            cursor.continue();
        };
    };
    if (db.objectStoreNames.contains(STORE_CHAT_ALARMS)) {
        const alarmStore = transaction.objectStore(STORE_CHAT_ALARMS);
        const idx = alarmStore.index('charId');
        const req = idx.openCursor(IDBKeyRange.only(id));
        req.onsuccess = () => {
            const cursor = req.result;
            if (!cursor) return;
            cursor.delete();
            cursor.continue();
        };
    }
    if (db.objectStoreNames.contains(STORE_USER_SCREEN_WATCH)) {
        const watchStore = transaction.objectStore(STORE_USER_SCREEN_WATCH);
        const idx = watchStore.index('charId');
        const req = idx.openCursor(IDBKeyRange.only(id));
        req.onsuccess = () => {
            const cursor = req.result;
            if (!cursor) return;
            cursor.delete();
            cursor.continue();
        };
    }
    deleteByCharId(STORE_THEATER_GOMOKU_GAMES);
    deleteByCharId(STORE_THEATER_GOMOKU_INVITATIONS);
    deleteByCharId(STORE_THEATER_GO_GAMES);
    deleteByCharId(STORE_THEATER_GO_INVITATIONS);
    deleteByCharIds(STORE_THEATER_DOUDIZHU_GAMES);
    deleteByCharId(STORE_THEATER_DOUDIZHU_INVITATIONS);
    deleteByCharIds(STORE_THEATER_TURTLE_SOUP_GAMES);
    deleteByCharId(STORE_THEATER_TURTLE_SOUP_INVITATIONS);
    deleteByCharIds(STORE_THEATER_MAHJONG_GAMES);
    deleteByCharId(STORE_THEATER_MAHJONG_INVITATIONS);
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error('deleteCharacter aborted'));
    });
  },

  /**
   * 获取角色的私聊消息。
   * @param includeProcessed 是否包含已被回忆标本馆处理的消息（默认 false，即自动过滤）。
   *                         记忆归档、批量总结等需要完整历史的场景应传 true。
   */
  getMessagesByCharId: async (charId: string, includeProcessed: boolean = false): Promise<Message[]> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_MESSAGES, 'readonly');
      const store = transaction.objectStore(STORE_MESSAGES);
      const index = store.index('charId');
      const request = index.getAll(IDBKeyRange.only(charId));
      request.onsuccess = () => {
          let results = (request.result || []).filter((m: Message) => !m.groupId);
          // 回忆标本馆：过滤已处理的消息（高水位标记之前的），用本地长期记忆替代
          if (!includeProcessed) {
              try {
                  const hwm = parseInt(localStorage.getItem(`mp_lastMsgId_${charId}`) || '0', 10);
                  if (hwm > 0) {
                      results = results.filter((m: Message) => m.id > hwm);
                  }
              } catch {}
          }
          resolve(results);
      };
      request.onerror = () => reject(request.error);
    });
  },

  // Performance: Load only the most recent N messages for a character
  getRecentMessagesByCharId: async (charId: string, limit: number, includeProcessed: boolean = false): Promise<Message[]> => {
    const db = await openDB();
    const hwm = includeProcessed ? 0 : (() => {
        try { return parseInt(localStorage.getItem(`mp_lastMsgId_${charId}`) || '0', 10) || 0; } catch { return 0; }
    })();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_MESSAGES, 'readonly');
      const store = transaction.objectStore(STORE_MESSAGES);
      const index = store.index('charId');
      const collected: Message[] = [];
      const cursorReq = index.openCursor(IDBKeyRange.only(charId), 'prev');
      cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor && collected.length < limit) {
              const m = cursor.value as Message;
              if (!m.groupId && (includeProcessed || m.id > hwm)) collected.push(m);
              cursor.continue();
          } else {
              resolve(collected.reverse());
          }
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });
  },

  // 页外动态专用：捞某角色全部 vr_card，不受"最近 N 条窗口"、回忆标本馆高水位
  // （mp_lastMsgId）、归档隐藏起点（char.hideBeforeMessageId）影响。
  // 这些机制只管「LLM 上下文能否看到」；页外动态是用户自己的浏览界面，
  // 只要消息还在 IndexedDB 里就应当永远可见——哪怕它早被新聊天挤出聊天取数窗口、
  // 或被归档标记为「对 AI 隐藏」。（清空聊天会真删消息，删掉就没了——那是预期行为。）
  //
  // 性能：走 [charId, type] 复合索引直取 vr_card，成本只跟该角色 vr_card 条数相关，
  // 跟总消息量无关——上万条聊天的用户也不会把整段历史读进内存。
  getVRCardsByCharId: async (charId: string): Promise<Message[]> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_MESSAGES, 'readonly');
      const store = transaction.objectStore(STORE_MESSAGES);
      if (store.indexNames.contains('charId_type')) {
          const idx = store.index('charId_type');
          const req = idx.getAll(IDBKeyRange.only([charId, 'vr_card']));
          req.onsuccess = () => {
              const results = (req.result || []).filter((m: Message) => !m.groupId && (m as any).metadata?.vrCard);
              resolve(results);
          };
          req.onerror = () => reject(req.error);
          return;
      }
      // 兜底：复合索引尚未建好的极少数情况（如升级事务还没跑完），用倒序游标扫，
      // 凑够 80 条 vr_card 即停——避免 getAll 整段历史。
      const index = store.index('charId');
      const collected: Message[] = [];
      const cursorReq = index.openCursor(IDBKeyRange.only(charId), 'prev');
      cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor && collected.length < 80) {
              const m = cursor.value as Message;
              if (!m.groupId && m.type === 'vr_card' && (m as any).metadata?.vrCard) collected.push(m);
              cursor.continue();
          } else {
              resolve(collected);
          }
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });
  },

  // Same as getRecentMessagesByCharId but also returns the total count (for UI display)
  getRecentMessagesWithCount: async (
    charId: string,
    limit: number,
    filter?: (message: Message) => boolean,
  ): Promise<{ messages: Message[], totalCount: number }> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_MESSAGES, 'readonly');
      const store = transaction.objectStore(STORE_MESSAGES);
      const index = store.index('charId');
      if (filter) {
          const countReq = index.count(IDBKeyRange.only(charId));
          countReq.onsuccess = () => {
              const rawCount = countReq.result;
              if (limit <= 0) {
                  resolve({ messages: [], totalCount: rawCount });
                  return;
              }
              const collected: Message[] = [];
              const target = limit + 1;
              const cursorReq = index.openCursor(IDBKeyRange.only(charId), 'prev');
              cursorReq.onsuccess = () => {
                  const cursor = cursorReq.result;
                  if (!cursor) {
                      resolve({ messages: collected.slice(0, limit).reverse(), totalCount: collected.length });
                      return;
                  }
                  const m = cursor.value as Message;
                  if (!m.groupId && filter(m)) {
                      collected.push(m);
                      if (collected.length >= target) {
                          resolve({ messages: collected.slice(0, limit).reverse(), totalCount: rawCount });
                          return;
                      }
                  }
                  cursor.continue();
              };
              cursorReq.onerror = () => reject(cursorReq.error);
          };
          countReq.onerror = () => reject(countReq.error);
          return;
      }
      const countReq = index.count(IDBKeyRange.only(charId));
      countReq.onsuccess = () => {
          const totalCount = countReq.result;
          // Use reverse cursor to only collect the last N messages
          const collected: Message[] = [];
          const cursorReq = index.openCursor(IDBKeyRange.only(charId), 'prev');
          cursorReq.onsuccess = () => {
              const cursor = cursorReq.result;
              if (cursor && collected.length < limit) {
                  const m = cursor.value as Message;
                  if (!m.groupId) collected.push(m);
                  cursor.continue();
              } else {
                  resolve({ messages: collected.reverse(), totalCount });
              }
          };
          cursorReq.onerror = () => reject(cursorReq.error);
      };
      countReq.onerror = () => reject(countReq.error);
    });
  },

  // Get all messages for a character from a given message ID onward (for hideBeforeMessageId)
  getMessagesFromId: async (charId: string, fromId: number): Promise<{ messages: Message[], totalCount: number }> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_MESSAGES, 'readonly');
      const store = transaction.objectStore(STORE_MESSAGES);
      const index = store.index('charId');
      const collected: Message[] = [];
      const cursorReq = index.openCursor(IDBKeyRange.only(charId));
      cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
              const m = cursor.value as Message;
              if (!m.groupId && m.id >= fromId) {
                  collected.push(m);
              }
              cursor.continue();
          } else {
              resolve({ messages: collected, totalCount: collected.length });
          }
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });
  },

  saveMessage: async (msg: Omit<Message, 'id' | 'timestamp'> & { timestamp?: number }): Promise<number> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_MESSAGES, 'readwrite');
        const store = transaction.objectStore(STORE_MESSAGES);
        const cleanMsg = normalizeAssistantMessageForSave(msg);
        const timestamp = typeof cleanMsg.timestamp === 'number' ? cleanMsg.timestamp : Date.now();
        const { timestamp: _ignored, ...payload } = cleanMsg;
        const request = store.add({ ...payload, timestamp });
        let newId = 0;
        request.onsuccess = () => { newId = request.result as number; };
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => {
            dispatchMessagesUpdated({
                kind: 'created',
                charId: cleanMsg.charId,
                groupId: cleanMsg.groupId,
                messageId: newId,
                timestamp,
            });
            resolve(newId);
        };
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error('saveMessage aborted'));
    });
  },

  updateMessage: async (id: number, content: string): Promise<void> => {
    const db = await openDB();
    const transaction = db.transaction(STORE_MESSAGES, 'readwrite');
    const store = transaction.objectStore(STORE_MESSAGES);
    
    return new Promise((resolve, reject) => {
        let updated: Message | undefined;
        const req = store.get(id);
        req.onsuccess = () => {
            const data = req.result as Message;
            if (data) {
                data.content = data.role === 'assistant' && ASSISTANT_VISIBLE_MESSAGE_TYPES.has(data.type)
                    ? cleanVisibleRoleText(content)
                    : content;
                updated = data;
                store.put(data);
            } else {
                reject(new Error('Message not found'));
            }
        };
        req.onerror = () => reject(req.error);
        transaction.oncomplete = () => {
            if (updated) {
                dispatchMessagesUpdated({
                    kind: 'updated',
                    charId: updated.charId,
                    groupId: updated.groupId,
                    messageId: id,
                    timestamp: updated.timestamp,
                });
            }
            resolve();
        };
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error('updateMessage aborted'));
    });
  },

  updateMessageMetadata: async (id: number, updater: (prev: any) => any): Promise<void> => {
    const db = await openDB();
    const transaction = db.transaction(STORE_MESSAGES, 'readwrite');
    const store = transaction.objectStore(STORE_MESSAGES);

    return new Promise((resolve, reject) => {
        let updated: Message | undefined;
        const req = store.get(id);
        req.onsuccess = () => {
            const data = req.result as Message | undefined;
            if (data) {
                (data as any).metadata = updater((data as any).metadata);
                updated = data;
                store.put(data);
            } else {
                reject(new Error('Message not found'));
            }
        };
        req.onerror = () => reject(req.error);
        transaction.oncomplete = () => {
            if (updated) {
                dispatchMessagesUpdated({
                    kind: 'updated',
                    charId: updated.charId,
                    groupId: updated.groupId,
                    messageId: id,
                    timestamp: updated.timestamp,
                });
            }
            resolve();
        };
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error('updateMessageMetadata aborted'));
    });
  },

  /** 批量写消息回执状态（metadata.msgStatus），ids 为空时直接返回。 */
  setMessagesStatus: async (ids: number[], status: string): Promise<void> => {
    if (!ids.length) return;
    const db = await openDB();
    const transaction = db.transaction(STORE_MESSAGES, 'readwrite');
    const store = transaction.objectStore(STORE_MESSAGES);
    for (const id of ids) {
        const req = store.get(id);
        req.onsuccess = () => {
            const data = req.result as Message | undefined;
            if (!data) return;
            (data as any).metadata = { ...((data as any).metadata || {}), msgStatus: status };
            store.put(data);
        };
    }
    return new Promise((resolve) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => resolve();
    });
  },

  /** 把某角色私聊里指定 role 的消息全部标成某回执状态（跳过群聊与已是该状态的消息）。 */
  markCharMessagesStatus: async (charId: string, role: 'user' | 'assistant', status: string): Promise<void> => {
    const db = await openDB();
    const transaction = db.transaction(STORE_MESSAGES, 'readwrite');
    const store = transaction.objectStore(STORE_MESSAGES);
    const index = store.index('charId');
    const request = index.openCursor(IDBKeyRange.only(charId));
    request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const m = cursor.value as Message;
        if (!m.groupId && m.role === role && (m as any).metadata?.msgStatus !== status) {
            (m as any).metadata = { ...((m as any).metadata || {}), msgStatus: status };
            cursor.update(m);
        }
        cursor.continue();
    };
    return new Promise((resolve) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => resolve();
    });
  },

  deleteMessage: async (id: number): Promise<void> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_MESSAGES, 'readwrite');
      const store = transaction.objectStore(STORE_MESSAGES);
      let deleted: Message | undefined;
      const req = store.get(id);
      req.onsuccess = () => {
        deleted = req.result as Message | undefined;
        store.delete(id);
      };
      req.onerror = () => reject(req.error);
      transaction.oncomplete = () => {
        dispatchMessagesUpdated({
          kind: 'deleted',
          charId: deleted?.charId,
          groupId: deleted?.groupId,
          messageId: id,
          timestamp: deleted?.timestamp,
        });
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('deleteMessage aborted'));
    });
  },

  deleteMessages: async (ids: number[]): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_MESSAGES, 'readwrite');
      const store = transaction.objectStore(STORE_MESSAGES);
      ids.forEach(id => store.delete(id));
      return new Promise((resolve, reject) => {
          transaction.oncomplete = () => {
              dispatchMessagesUpdated({ kind: 'deleted', messageIds: ids });
              resolve();
          };
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error || new Error('deleteMessages aborted'));
      });
  },

  clearMessages: async (charId: string): Promise<void> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_MESSAGES, 'readwrite');
      const store = transaction.objectStore(STORE_MESSAGES);
      const index = store.index('charId');
      const request = index.openCursor(IDBKeyRange.only(charId));
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
            const m = cursor.value as Message;
            if (!m.groupId) {
                cursor.delete();
            }
            cursor.continue();
        }
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => {
        dispatchMessagesUpdated({ kind: 'cleared', charId });
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  },

  getPrivateChatArchives: async (charId: string): Promise<PrivateChatArchive[]> => {
    const db = await openDB();
    if (!db.objectStoreNames.contains(STORE_PRIVATE_CHAT_ARCHIVES)) return [];
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_PRIVATE_CHAT_ARCHIVES, 'readonly');
      const store = transaction.objectStore(STORE_PRIVATE_CHAT_ARCHIVES);
      const request = store.index('charId').getAll(IDBKeyRange.only(charId));
      request.onsuccess = () => {
        const rows = (request.result || []) as PrivateChatArchive[];
        rows.sort((a, b) => {
          const pinDelta = Number(!!b.pinned) - Number(!!a.pinned);
          return pinDelta || (b.updatedAt || 0) - (a.updatedAt || 0);
        });
        resolve(rows);
      };
      request.onerror = () => reject(request.error);
    });
  },

  getPrivateChatArchive: async (id: string): Promise<PrivateChatArchive | undefined> => {
    const db = await openDB();
    if (!db.objectStoreNames.contains(STORE_PRIVATE_CHAT_ARCHIVES)) return undefined;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_PRIVATE_CHAT_ARCHIVES, 'readonly');
      const request = transaction.objectStore(STORE_PRIVATE_CHAT_ARCHIVES).get(id);
      request.onsuccess = () => resolve(request.result as PrivateChatArchive | undefined);
      request.onerror = () => reject(request.error);
    });
  },

  savePrivateChatArchive: async (archive: PrivateChatArchive): Promise<void> => {
    const db = await openDB();
    if (!db.objectStoreNames.contains(STORE_PRIVATE_CHAT_ARCHIVES)) return;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_PRIVATE_CHAT_ARCHIVES, 'readwrite');
      transaction.objectStore(STORE_PRIVATE_CHAT_ARCHIVES).put(archive);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('savePrivateChatArchive aborted'));
    });
  },

  deletePrivateChatArchive: async (id: string): Promise<void> => {
    const db = await openDB();
    if (!db.objectStoreNames.contains(STORE_PRIVATE_CHAT_ARCHIVES)) return;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_PRIVATE_CHAT_ARCHIVES, 'readwrite');
      transaction.objectStore(STORE_PRIVATE_CHAT_ARCHIVES).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('deletePrivateChatArchive aborted'));
    });
  },

  deletePrivateChatArchivesByCharId: async (charId: string): Promise<void> => {
    const db = await openDB();
    if (!db.objectStoreNames.contains(STORE_PRIVATE_CHAT_ARCHIVES)) return;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_PRIVATE_CHAT_ARCHIVES, 'readwrite');
      const store = transaction.objectStore(STORE_PRIVATE_CHAT_ARCHIVES);
      const request = store.index('charId').openCursor(IDBKeyRange.only(charId));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('deletePrivateChatArchivesByCharId aborted'));
    });
  },

  getGroups: async (): Promise<GroupProfile[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_GROUPS)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_GROUPS, 'readonly');
          const store = transaction.objectStore(STORE_GROUPS);
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveGroup: async (group: GroupProfile): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_GROUPS, 'readwrite');
      transaction.objectStore(STORE_GROUPS).put(group);
  },

  deleteGroup: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_GROUPS, 'readwrite');
      transaction.objectStore(STORE_GROUPS).delete(id);
  },

  getGroupMessages: async (groupId: string): Promise<Message[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_MESSAGES, 'readonly');
          const store = transaction.objectStore(STORE_MESSAGES);
          const index = store.index('groupId');
          const request = index.getAll(IDBKeyRange.only(groupId));
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  replaceGroupMessages: async (groupId: string, messages: Message[]): Promise<void> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_MESSAGES, 'readwrite');
          const store = transaction.objectStore(STORE_MESSAGES);
          const index = store.index('groupId');
          const cursorReq = index.openCursor(IDBKeyRange.only(groupId));
          cursorReq.onsuccess = () => {
              const cursor = cursorReq.result;
              if (cursor) {
                  cursor.delete();
                  cursor.continue();
              } else {
                  for (const msg of messages) {
                      const { id: _id, ...payload } = msg;
                      store.add({ ...payload, groupId, timestamp: typeof msg.timestamp === 'number' ? msg.timestamp : Date.now() });
                  }
              }
          };
          cursorReq.onerror = () => reject(cursorReq.error);
          transaction.oncomplete = () => {
              dispatchMessagesUpdated({ kind: 'replaced', groupId });
              resolve();
          };
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
      });
  },

  getRecentGroupMessagesWithCount: async (groupId: string, limit: number): Promise<{ messages: Message[], totalCount: number }> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_MESSAGES, 'readonly');
          const store = transaction.objectStore(STORE_MESSAGES);
          const index = store.index('groupId');
          const countReq = index.count(IDBKeyRange.only(groupId));
          countReq.onsuccess = () => {
              const totalCount = countReq.result;
              const collected: Message[] = [];
              const cursorReq = index.openCursor(IDBKeyRange.only(groupId), 'prev');
              cursorReq.onsuccess = () => {
                  const cursor = cursorReq.result;
                  if (cursor && collected.length < limit) {
                      collected.push(cursor.value as Message);
                      cursor.continue();
                  } else {
                      resolve({ messages: collected.reverse(), totalCount });
                  }
              };
              cursorReq.onerror = () => reject(cursorReq.error);
          };
          countReq.onerror = () => reject(countReq.error);
      });
  },

  getSocialPosts: async (): Promise<SocialPost[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_SOCIAL_POSTS)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_SOCIAL_POSTS, 'readonly');
          const store = transaction.objectStore(STORE_SOCIAL_POSTS);
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveSocialPost: async (post: SocialPost): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_SOCIAL_POSTS, 'readwrite');
      const cleanPost = normalizeSocialPostVisibleText(post);
      transaction.objectStore(STORE_SOCIAL_POSTS).put({
          ...cleanPost,
          lastActivityAt: cleanPost.lastActivityAt || cleanPost.timestamp || Date.now(),
      });
  },

  updateSocialPost: async (id: string, updater: (post: SocialPost) => SocialPost | null | undefined): Promise<SocialPost | null> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_SOCIAL_POSTS)) return null;
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_SOCIAL_POSTS, 'readwrite');
          const store = tx.objectStore(STORE_SOCIAL_POSTS);
          const req = store.get(id);
          let next: SocialPost | null = null;
          req.onsuccess = () => {
              const existing = req.result as SocialPost | undefined;
              if (!existing) { resolve(null); return; }
              const updated = updater(existing);
              if (!updated) { resolve(null); return; }
              next = normalizeSocialPostVisibleText({ ...updated, lastActivityAt: updated.lastActivityAt || updated.timestamp || existing.lastActivityAt || Date.now() });
              store.put(next);
          };
          req.onerror = () => reject(req.error);
          tx.oncomplete = () => resolve(next);
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
      });
  },

  getUnreadSocialPosts: async (): Promise<SocialPost[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_SOCIAL_POSTS)) return [];
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_SOCIAL_POSTS, 'readonly');
          const store = tx.objectStore(STORE_SOCIAL_POSTS);
          const req = store.getAll();
          req.onsuccess = () => {
              const rows = (req.result || []) as SocialPost[];
              resolve(rows
                  .filter(p => !!p.unreadForUser)
                  .sort((a, b) => (b.lastActivityAt || b.timestamp || 0) - (a.lastActivityAt || a.timestamp || 0)));
          };
          req.onerror = () => reject(req.error);
      });
  },

  markSocialPostsSeen: async (ids?: string[]): Promise<number> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_SOCIAL_POSTS)) return 0;
      return new Promise((resolve, reject) => {
          const targetIds = ids && ids.length > 0 ? new Set(ids) : null;
          const tx = db.transaction(STORE_SOCIAL_POSTS, 'readwrite');
          const store = tx.objectStore(STORE_SOCIAL_POSTS);
          const req = store.openCursor();
          let touched = 0;
          req.onsuccess = () => {
              const cursor = req.result;
              if (!cursor) return;
              const post = cursor.value as SocialPost;
              if ((targetIds ? targetIds.has(post.id) : !!post.unreadForUser) && post.unreadForUser) {
                  cursor.update({ ...post, unreadForUser: false });
                  touched++;
              }
              cursor.continue();
          };
          req.onerror = () => reject(req.error);
          tx.oncomplete = () => resolve(touched);
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
      });
  },

  getSocialPostsByAuthorChar: async (charId: string, limit = 50): Promise<SocialPost[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_SOCIAL_POSTS)) return [];
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_SOCIAL_POSTS, 'readonly');
          const store = tx.objectStore(STORE_SOCIAL_POSTS);
          const collected: SocialPost[] = [];
          if (store.indexNames.contains('authorCharId')) {
              const req = store.index('authorCharId').openCursor(IDBKeyRange.only(charId));
              req.onsuccess = () => {
                  const cursor = req.result;
                  if (!cursor) return;
                  collected.push(cursor.value as SocialPost);
                  cursor.continue();
              };
              req.onerror = () => reject(req.error);
              tx.oncomplete = () => resolve(collected
                  .sort((a, b) => (b.lastActivityAt || b.timestamp || 0) - (a.lastActivityAt || a.timestamp || 0))
                  .slice(0, limit));
              tx.onerror = () => reject(tx.error);
              tx.onabort = () => reject(tx.error);
              return;
          }
          const req = store.getAll();
          req.onsuccess = () => resolve(((req.result || []) as SocialPost[])
              .filter(p => p.authorCharId === charId)
              .sort((a, b) => (b.lastActivityAt || b.timestamp || 0) - (a.lastActivityAt || a.timestamp || 0))
              .slice(0, limit));
          req.onerror = () => reject(req.error);
      });
  },

  deleteSocialPost: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_SOCIAL_POSTS, 'readwrite');
      transaction.objectStore(STORE_SOCIAL_POSTS).delete(id);
  },

  clearSocialPosts: async (): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_SOCIAL_POSTS, 'readwrite');
      transaction.objectStore(STORE_SOCIAL_POSTS).clear();
  },

  deleteSocialPostsByChar: async (charId: string): Promise<number> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_SOCIAL_POSTS)) return 0;
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_SOCIAL_POSTS, 'readwrite');
          const store = tx.objectStore(STORE_SOCIAL_POSTS);
          const request = store.openCursor();
          let touched = 0;
          request.onsuccess = () => {
              const cursor = request.result;
              if (!cursor) return;
              const post = cursor.value as SocialPost;
              if (post?.authorCharId === charId) {
                  cursor.delete();
                  touched++;
                  cursor.continue();
                  return;
              }
              const comments = Array.isArray(post?.comments) ? post.comments.filter(c => c?.authorCharId !== charId) : post.comments;
              const likedBy = Array.isArray(post?.likedBy) ? post.likedBy.filter(l => l?.id !== charId) : post.likedBy;
              const mentionedCharIds = Array.isArray(post?.mentionedCharIds) ? post.mentionedCharIds.filter(id => id !== charId) : post.mentionedCharIds;
              const changed =
                  (Array.isArray(post?.comments) && comments.length !== post.comments.length) ||
                  (Array.isArray(post?.likedBy) && (likedBy?.length || 0) !== post.likedBy.length) ||
                  (Array.isArray(post?.mentionedCharIds) && (mentionedCharIds?.length || 0) !== post.mentionedCharIds.length);
              if (changed) {
                  cursor.update({ ...post, comments, likedBy, mentionedCharIds });
                  touched++;
              }
              cursor.continue();
          };
          request.onerror = () => reject(request.error);
          tx.oncomplete = () => resolve(touched);
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
      });
  },

  getEmojis: async (): Promise<Emoji[]> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_EMOJIS, 'readonly');
      const store = transaction.objectStore(STORE_EMOJIS);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  },

  saveEmoji: async (name: string, url: string, categoryId?: string, description?: string): Promise<void> => {
    const db = await openDB();
    const transaction = db.transaction(STORE_EMOJIS, 'readwrite');
    transaction.objectStore(STORE_EMOJIS).put({ name, url, categoryId, ...(description ? { description } : {}) });
  },

  deleteEmoji: async (name: string): Promise<void> => {
    const db = await openDB();
    const transaction = db.transaction(STORE_EMOJIS, 'readwrite');
    transaction.objectStore(STORE_EMOJIS).delete(name);
  },

  getEmojiCategories: async (): Promise<EmojiCategory[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          if (!db.objectStoreNames.contains(STORE_EMOJI_CATEGORIES)) {
              resolve([]);
              return;
          }
          const transaction = db.transaction(STORE_EMOJI_CATEGORIES, 'readonly');
          const store = transaction.objectStore(STORE_EMOJI_CATEGORIES);
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveEmojiCategory: async (category: EmojiCategory): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_EMOJI_CATEGORIES, 'readwrite');
      transaction.objectStore(STORE_EMOJI_CATEGORIES).put(category);
  },

  deleteEmojiCategory: async (id: string): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction([STORE_EMOJI_CATEGORIES, STORE_EMOJIS], 'readwrite');
      tx.objectStore(STORE_EMOJI_CATEGORIES).delete(id);
      const emojiStore = tx.objectStore(STORE_EMOJIS);
      const request = emojiStore.getAll();
      request.onsuccess = () => {
          const allEmojis = request.result as Emoji[];
          allEmojis.forEach(e => {
              if (e.categoryId === id) {
                  emojiStore.delete(e.name);
              }
          });
      };
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
      });
  },

  initializeEmojiData: async (): Promise<void> => {
      const cats = await DB.getEmojiCategories();
      // 巧妙利用 UI 强制保留 default 分类的特性：
      // 只要初始化过一次，cats.length 至少为 1（必然包含 default）。
      // 只有全量清空的首次安装，cats.length 才为 0。这样无需 localStorage 即可避免内置分类无限复活。
      if (cats.length === 0) {
          await DB.saveEmojiCategory({ id: 'default', name: '默认', isSystem: true });
          const db = await openDB();
          const tx = db.transaction(STORE_EMOJIS, 'readwrite');
          const store = tx.objectStore(STORE_EMOJIS);
          DEFAULT_PRESET_EMOJIS.forEach(emoji => store.put(emoji));
          await new Promise(resolve => { tx.oncomplete = resolve; });
          try { localStorage.setItem(DEFAULT_EMOJI_PACK_FLAG, '1'); } catch { /* ignore */ }
          return;
      }
      // 老用户一次性迁移：下线旧「Moro 专属」包（连同其下表情），补种新默认表情包。
      // 用 localStorage 标记保证只跑一次——之后用户删掉默认表情不会复活。
      let migrated = false;
      try { migrated = localStorage.getItem(DEFAULT_EMOJI_PACK_FLAG) === '1'; } catch { /* ignore */ }
      if (migrated) return;
      try {
          if (cats.some(c => c.id === LEGACY_MORO_CATEGORY_ID)) {
              await DB.deleteEmojiCategory(LEGACY_MORO_CATEGORY_ID);
          }
          // 只补不覆盖：用户已有同名表情时保留用户的
          const existingNames = new Set((await DB.getEmojis()).map(e => e.name));
          const db = await openDB();
          const tx = db.transaction(STORE_EMOJIS, 'readwrite');
          const store = tx.objectStore(STORE_EMOJIS);
          DEFAULT_PRESET_EMOJIS.forEach(emoji => { if (!existingNames.has(emoji.name)) store.put(emoji); });
          await new Promise(resolve => { tx.oncomplete = resolve; });
          try { localStorage.setItem(DEFAULT_EMOJI_PACK_FLAG, '1'); } catch { /* ignore */ }
      } catch (e) {
          console.warn('[EmojiMigration] 默认表情包迁移失败，下次启动重试:', e);
      }
  },

  // ─── 来往·角色离线自主生活事件（autonomous life）─────────────────
  // 见 utils/autonomousLife.ts：角色在用户离线时「过自己的日子」，事件既给主动
  // 消息取材、也攒成离线动态回顾时间线。
  saveLifeEvent: async (event: CharLifeEvent): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_CHAR_LIFE_EVENTS, 'readwrite');
      tx.objectStore(STORE_CHAR_LIFE_EVENTS).put(event);
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => {
              dispatchCharLifeEventUpdated(event);
              resolve();
          };
          tx.onerror = () => reject(tx.error);
      });
  },

  /** 取某角色的生活事件，按时间升序；limit>0 时只留最近 limit 条。 */
  getLifeEvents: async (charId: string, limit?: number): Promise<CharLifeEvent[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_CHAR_LIFE_EVENTS, 'readonly');
          const idx = tx.objectStore(STORE_CHAR_LIFE_EVENTS).index('charId');
          const req = idx.getAll(charId);
          req.onsuccess = () => {
              const all = ((req.result as CharLifeEvent[]) || []).sort((a, b) => a.timestamp - b.timestamp);
              resolve(limit && limit > 0 ? all.slice(-limit) : all);
          };
          req.onerror = () => reject(req.error);
      });
  },

  /** 取某角色自 sinceTs 起的生活事件（离线回顾用）。 */
  getLifeEventsSince: async (charId: string, sinceTs: number): Promise<CharLifeEvent[]> => {
      const all = await DB.getLifeEvents(charId);
      return all.filter(e => e.timestamp >= sinceTs);
  },

  /** 标记某事件已作为主动消息发出（回顾里据此区分「已说过 / 你没在时发生的」）。 */
  markLifeEventSurfaced: async (id: string, surfacedAt = Date.now()): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_CHAR_LIFE_EVENTS, 'readwrite');
      const store = tx.objectStore(STORE_CHAR_LIFE_EVENTS);
      let updatedEvent: CharLifeEvent | null = null;
      const getReq = store.get(id);
      getReq.onsuccess = () => {
          const ev = getReq.result as CharLifeEvent | undefined;
          if (ev) {
              ev.surfacedAsMsg = true;
              ev.surfacedAt = surfacedAt;
              updatedEvent = ev;
              store.put(ev);
          }
      };
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => {
              if (updatedEvent) dispatchCharLifeEventUpdated(updatedEvent);
              resolve();
          };
          tx.onerror = () => reject(tx.error);
      });
  },

  /** 修剪：每个角色只保留最近 keepN 条，防止无限增长（默认 200）。 */
  pruneLifeEvents: async (charId: string, keepN = 200): Promise<void> => {
      const all = await DB.getLifeEvents(charId);
      if (all.length <= keepN) return;
      const toDelete = all.slice(0, all.length - keepN);
      const db = await openDB();
      const tx = db.transaction(STORE_CHAR_LIFE_EVENTS, 'readwrite');
      const store = tx.objectStore(STORE_CHAR_LIFE_EVENTS);
      toDelete.forEach(e => store.delete(e.id));
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
      });
  },

  /** 删除某角色全部生活事件（删角色 / 清理时用）。 */
  deleteLifeEventsForChar: async (charId: string): Promise<void> => {
      const all = await DB.getLifeEvents(charId);
      if (all.length === 0) return;
      const db = await openDB();
      const tx = db.transaction(STORE_CHAR_LIFE_EVENTS, 'readwrite');
      const store = tx.objectStore(STORE_CHAR_LIFE_EVENTS);
      all.forEach(e => store.delete(e.id));
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
      });
  },

  // ─── 循迹 App（Screenlife 演出 / 监视快照 / 报备）─────────────────
  saveXunjiRun: async (run: XunjiScreenlifeRun): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_XUNJI_RUNS, 'readwrite');
      tx.objectStore(STORE_XUNJI_RUNS).put(run);
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
      });
  },

  getXunjiRuns: async (charId?: string, limit?: number): Promise<XunjiScreenlifeRun[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_XUNJI_RUNS, 'readonly');
          const store = tx.objectStore(STORE_XUNJI_RUNS);
          const req = charId ? store.index('charId').getAll(charId) : store.getAll();
          req.onsuccess = () => {
              const all = ((req.result as XunjiScreenlifeRun[]) || []).sort((a, b) => b.createdAt - a.createdAt);
              resolve(limit && limit > 0 ? all.slice(0, limit) : all);
          };
          req.onerror = () => reject(req.error);
      });
  },

  deleteXunjiRun: async (id: string): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_XUNJI_RUNS, 'readwrite');
      tx.objectStore(STORE_XUNJI_RUNS).delete(id);
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
      });
  },

  saveXunjiSnapshot: async (snapshot: XunjiMonitorSnapshot): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_XUNJI_SNAPSHOTS, 'readwrite');
      tx.objectStore(STORE_XUNJI_SNAPSHOTS).put(snapshot);
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
      });
  },

  getXunjiSnapshots: async (charId: string, limit?: number): Promise<XunjiMonitorSnapshot[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_XUNJI_SNAPSHOTS, 'readonly');
          const req = tx.objectStore(STORE_XUNJI_SNAPSHOTS).index('charId').getAll(charId);
          req.onsuccess = () => {
              const all = ((req.result as XunjiMonitorSnapshot[]) || []).sort((a, b) => b.generatedAt - a.generatedAt);
              resolve(limit && limit > 0 ? all.slice(0, limit) : all);
          };
          req.onerror = () => reject(req.error);
      });
  },

  getLatestXunjiSnapshot: async (charId: string): Promise<XunjiMonitorSnapshot | undefined> => {
      const snapshots = await DB.getXunjiSnapshots(charId, 1);
      return snapshots[0];
  },

  saveXunjiReports: async (items: XunjiReportItem[]): Promise<void> => {
      if (items.length === 0) return;
      const db = await openDB();
      const tx = db.transaction(STORE_XUNJI_REPORTS, 'readwrite');
      const store = tx.objectStore(STORE_XUNJI_REPORTS);
      items.forEach(item => store.put(item));
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
      });
  },

  getXunjiReports: async (charId: string, limit?: number): Promise<XunjiReportItem[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_XUNJI_REPORTS, 'readonly');
          const req = tx.objectStore(STORE_XUNJI_REPORTS).index('charId').getAll(charId);
          req.onsuccess = () => {
              const all = ((req.result as XunjiReportItem[]) || []).sort((a, b) => b.timestamp - a.timestamp);
              resolve(limit && limit > 0 ? all.slice(0, limit) : all);
          };
          req.onerror = () => reject(req.error);
      });
  },

  updateXunjiReport: async (id: string, updates: Partial<XunjiReportItem>): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_XUNJI_REPORTS, 'readwrite');
      const store = tx.objectStore(STORE_XUNJI_REPORTS);
      const req = store.get(id);
      req.onsuccess = () => {
          const current = req.result as XunjiReportItem | undefined;
          if (current) store.put({ ...current, ...updates, id: current.id });
      };
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
      });
  },

  clearXunjiForChar: async (charId: string): Promise<number> => {
      const [runs, snapshots, reports] = await Promise.all([
          DB.deleteByIndex(STORE_XUNJI_RUNS, 'charId', charId),
          DB.deleteByIndex(STORE_XUNJI_SNAPSHOTS, 'charId', charId),
          DB.deleteByIndex(STORE_XUNJI_REPORTS, 'charId', charId),
      ]);
      return runs + snapshots + reports;
  },

  getXunjiSettings: async (): Promise<XunjiSettings | undefined> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_XUNJI_SETTINGS, 'readonly');
          const req = tx.objectStore(STORE_XUNJI_SETTINGS).get('settings');
          req.onsuccess = () => resolve(req.result as XunjiSettings | undefined);
          req.onerror = () => reject(req.error);
      });
  },

  saveXunjiSettings: async (settings: XunjiSettings): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_XUNJI_SETTINGS, 'readwrite');
      tx.objectStore(STORE_XUNJI_SETTINGS).put(settings);
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
      });
  },

  getRelationshipNetworkEdges: async (): Promise<RelationshipNetworkEdge[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_RELATIONSHIP_NETWORK_EDGES, 'readonly');
          const req = tx.objectStore(STORE_RELATIONSHIP_NETWORK_EDGES).getAll();
          req.onsuccess = () => {
              const all = ((req.result as RelationshipNetworkEdge[]) || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
              resolve(all);
          };
          req.onerror = () => reject(req.error);
      });
  },

  getRelationshipNetworkEdgeByPair: async (pairKey: string): Promise<RelationshipNetworkEdge | undefined> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_RELATIONSHIP_NETWORK_EDGES, 'readonly');
          const req = tx.objectStore(STORE_RELATIONSHIP_NETWORK_EDGES).index('pairKey').get(pairKey);
          req.onsuccess = () => resolve(req.result as RelationshipNetworkEdge | undefined);
          req.onerror = () => reject(req.error);
      });
  },

  saveRelationshipNetworkEdge: async (edge: RelationshipNetworkEdge): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_RELATIONSHIP_NETWORK_EDGES, 'readwrite');
      tx.objectStore(STORE_RELATIONSHIP_NETWORK_EDGES).put(edge);
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
      });
  },

  saveRelationshipNetworkEdges: async (edges: RelationshipNetworkEdge[]): Promise<void> => {
      if (edges.length === 0) return;
      const db = await openDB();
      const tx = db.transaction(STORE_RELATIONSHIP_NETWORK_EDGES, 'readwrite');
      const store = tx.objectStore(STORE_RELATIONSHIP_NETWORK_EDGES);
      edges.forEach(edge => store.put(edge));
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
      });
  },

  getRelationshipNetworkMessagesByPair: async (pairKey: string, limit?: number): Promise<RelationshipNetworkMessage[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_RELATIONSHIP_NETWORK_MESSAGES, 'readonly');
          const req = tx.objectStore(STORE_RELATIONSHIP_NETWORK_MESSAGES).index('pairKey').getAll(pairKey);
          req.onsuccess = () => {
              const all = ((req.result as RelationshipNetworkMessage[]) || []).sort((a, b) => a.createdAt - b.createdAt);
              resolve(limit && limit > 0 ? all.slice(-limit) : all);
          };
          req.onerror = () => reject(req.error);
      });
  },

  saveRelationshipNetworkMessage: async (message: RelationshipNetworkMessage): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_RELATIONSHIP_NETWORK_MESSAGES, 'readwrite');
      tx.objectStore(STORE_RELATIONSHIP_NETWORK_MESSAGES).put(message);
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
      });
  },

  saveRelationshipNetworkMessages: async (messages: RelationshipNetworkMessage[]): Promise<void> => {
      if (messages.length === 0) return;
      const db = await openDB();
      const tx = db.transaction(STORE_RELATIONSHIP_NETWORK_MESSAGES, 'readwrite');
      const store = tx.objectStore(STORE_RELATIONSHIP_NETWORK_MESSAGES);
      messages.forEach(message => store.put(message));
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
      });
  },

  getRelationshipNetworkAutoSettings: async (): Promise<RelationshipNetworkAutoSettings | undefined> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_RELATIONSHIP_NETWORK_SETTINGS, 'readonly');
          const req = tx.objectStore(STORE_RELATIONSHIP_NETWORK_SETTINGS).get('settings');
          req.onsuccess = () => resolve(req.result as RelationshipNetworkAutoSettings | undefined);
          req.onerror = () => reject(req.error);
      });
  },

  saveRelationshipNetworkAutoSettings: async (settings: RelationshipNetworkAutoSettings): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_RELATIONSHIP_NETWORK_SETTINGS, 'readwrite');
      tx.objectStore(STORE_RELATIONSHIP_NETWORK_SETTINGS).put(settings);
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
      });
  },

  deleteRelationshipNetworkDataByCharId: async (charId: string): Promise<number> => {
      const pairKeys = new Set<string>();
      const pairKeyHasChar = (pairKey?: string): boolean => {
          if (typeof pairKey !== 'string') return false;
          const m = pairKey.match(/^rn_(.+)__(.+)$/);
          return !!m && (m[1] === charId || m[2] === charId);
      };
      const edgeDeleted = await DB.deleteByCursor(STORE_RELATIONSHIP_NETWORK_EDGES, (edge: RelationshipNetworkEdge) => {
          const related = (Array.isArray(edge?.charIds) && edge.charIds.includes(charId)) || pairKeyHasChar(edge?.pairKey);
          if (related && edge?.pairKey) pairKeys.add(edge.pairKey);
          return related;
      });
      const messageDeleted = await DB.deleteByCursor(STORE_RELATIONSHIP_NETWORK_MESSAGES, (message: RelationshipNetworkMessage) => {
          const relatedPair = (message?.pairKey && pairKeys.has(message.pairKey)) || pairKeyHasChar(message?.pairKey);
          const relatedSpeaker = message?.speakerId === charId;
          const relatedForward = Array.isArray(message?.forwardedByCharIds) && message.forwardedByCharIds.includes(charId);
          return !!(relatedPair || relatedSpeaker || relatedForward);
      });
      const settings = await DB.getRelationshipNetworkAutoSettings().catch(() => undefined);
      let settingsTouched = 0;
      if (settings) {
          const nextSelected = (settings.selectedCharIds || []).filter(id => id !== charId);
          const cleanRecord = (record: Record<string, number> = {}, mode: 'char' | 'pair') => {
              const next: Record<string, number> = {};
              for (const [key, value] of Object.entries(record)) {
                  if (mode === 'char' && key === charId) continue;
                  if (mode === 'pair' && (pairKeys.has(key) || pairKeyHasChar(key))) continue;
                  next[key] = value;
              }
              return next;
          };
          const nextSettings: RelationshipNetworkAutoSettings = {
              ...settings,
              selectedCharIds: nextSelected,
              lastRunAtByChar: cleanRecord(settings.lastRunAtByChar, 'char'),
              lastRunAtByPair: cleanRecord(settings.lastRunAtByPair, 'pair'),
              forwardedCountByPair: cleanRecord(settings.forwardedCountByPair, 'pair'),
              updatedAt: Date.now(),
          };
          const changed =
              nextSettings.selectedCharIds.length !== (settings.selectedCharIds || []).length ||
              Object.keys(nextSettings.lastRunAtByChar || {}).length !== Object.keys(settings.lastRunAtByChar || {}).length ||
              Object.keys(nextSettings.lastRunAtByPair || {}).length !== Object.keys(settings.lastRunAtByPair || {}).length ||
              Object.keys(nextSettings.forwardedCountByPair || {}).length !== Object.keys(settings.forwardedCountByPair || {}).length;
          if (changed) {
              await DB.saveRelationshipNetworkAutoSettings(nextSettings);
              settingsTouched = 1;
          }
      }
      return edgeDeleted + messageDeleted + settingsTouched;
  },

  // ─── 折子戏·谈心会话 ───
  getAllTalkSessions: async (): Promise<TalkSession[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_TALK_SESSIONS, 'readonly');
          const req = tx.objectStore(STORE_TALK_SESSIONS).getAll();
          req.onsuccess = () => resolve(((req.result as TalkSession[]) || []).sort((a, b) => b.lastActiveAt - a.lastActiveAt));
          req.onerror = () => reject(req.error);
      });
  },
  getTalkSession: async (id: string): Promise<TalkSession | undefined> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_TALK_SESSIONS, 'readonly');
          const req = tx.objectStore(STORE_TALK_SESSIONS).get(id);
          req.onsuccess = () => resolve(req.result as TalkSession | undefined);
          req.onerror = () => reject(req.error);
      });
  },
  saveTalkSession: async (session: TalkSession): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_TALK_SESSIONS, 'readwrite');
      tx.objectStore(STORE_TALK_SESSIONS).put(session);
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
      });
  },
  deleteTalkSession: async (id: string): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_TALK_SESSIONS, 'readwrite');
      tx.objectStore(STORE_TALK_SESSIONS).delete(id);
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
      });
  },

  deleteTalkSessionsByCharId: async (charId: string): Promise<number> => {
      return DB.deleteByIndex(STORE_TALK_SESSIONS, 'charId', charId);
  },

  // ─── 折子戏·狼人杀对局 ───
  getAllWerewolfGames: async (): Promise<WerewolfGame[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_WEREWOLF_GAMES, 'readonly');
          const req = tx.objectStore(STORE_WEREWOLF_GAMES).getAll();
          req.onsuccess = () => resolve(((req.result as WerewolfGame[]) || []).sort((a, b) => b.lastActiveAt - a.lastActiveAt));
          req.onerror = () => reject(req.error);
      });
  },
  saveWerewolfGame: async (game: WerewolfGame): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_WEREWOLF_GAMES, 'readwrite');
      tx.objectStore(STORE_WEREWOLF_GAMES).put(game);
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
      });
  },
  deleteWerewolfGame: async (id: string): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_WEREWOLF_GAMES, 'readwrite');
      tx.objectStore(STORE_WEREWOLF_GAMES).delete(id);
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
      });
  },
  deleteWerewolfGamesByCharId: async (charId: string): Promise<number> => {
      return DB.deleteByCursor(STORE_WEREWOLF_GAMES, (game: WerewolfGame) => (
          Array.isArray(game?.players) && game.players.some(player => player?.charId === charId)
      ));
  },

  // ─── 折子戏·真心话大冒险 ───
  getAllTruthDareSessions: async (): Promise<TruthDareSession[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_TRUTHDARE_SESSIONS, 'readonly');
          const req = tx.objectStore(STORE_TRUTHDARE_SESSIONS).getAll();
          req.onsuccess = () => resolve(((req.result as TruthDareSession[]) || []).sort((a, b) => b.lastActiveAt - a.lastActiveAt));
          req.onerror = () => reject(req.error);
      });
  },
  saveTruthDareSession: async (session: TruthDareSession): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_TRUTHDARE_SESSIONS, 'readwrite');
      tx.objectStore(STORE_TRUTHDARE_SESSIONS).put(session);
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
      });
  },
  deleteTruthDareSession: async (id: string): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_TRUTHDARE_SESSIONS, 'readwrite');
      tx.objectStore(STORE_TRUTHDARE_SESSIONS).delete(id);
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
      });
  },
  deleteTruthDareSessionsByCharId: async (charId: string): Promise<number> => {
      return DB.deleteByCursor(STORE_TRUTHDARE_SESSIONS, (session: TruthDareSession) => (
          Array.isArray(session?.players) && session.players.some(player => player?.charId === charId || player?.id === charId)
      ));
  },

  // ─── 折子戏·番外问卷会话 ───
  getAllTheaterQuizSessions: async (): Promise<TheaterQuizSession[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_THEATER_QUIZ_SESSIONS, 'readonly');
          const req = tx.objectStore(STORE_THEATER_QUIZ_SESSIONS).getAll();
          req.onsuccess = () => resolve(((req.result as TheaterQuizSession[]) || []).sort((a, b) => b.lastActiveAt - a.lastActiveAt));
          req.onerror = () => reject(req.error);
      });
  },
  saveTheaterQuizSession: async (session: TheaterQuizSession): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_THEATER_QUIZ_SESSIONS, 'readwrite');
      tx.objectStore(STORE_THEATER_QUIZ_SESSIONS).put(session);
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
      });
  },
  deleteTheaterQuizSession: async (id: string): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_THEATER_QUIZ_SESSIONS, 'readwrite');
      tx.objectStore(STORE_THEATER_QUIZ_SESSIONS).delete(id);
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
      });
  },
  deleteTheaterQuizSessionsByCharId: async (charId: string): Promise<number> => {
      return DB.deleteByCursor(STORE_THEATER_QUIZ_SESSIONS, (session: TheaterQuizSession) => (
          Array.isArray(session?.participantIds) && session.participantIds.includes(charId)
      ));
  },

  getAllChatFollowups: async (): Promise<ChatFollowup[]> => (
      await getAllStoreItems<ChatFollowup>(STORE_CHAT_FOLLOWUPS)
  ).sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)),

  saveChatFollowup: (followup: ChatFollowup): Promise<void> =>
      putStoreItem(STORE_CHAT_FOLLOWUPS, followup),

  deleteChatFollowup: (id: string): Promise<void> =>
      deleteStoreItem(STORE_CHAT_FOLLOWUPS, id),

  deleteChatFollowupsByCharId: async (charId: string, messageIds?: number[]): Promise<number> => {
      const messageIdSet = new Set(messageIds || []);
      return DB.deleteByCursor(STORE_CHAT_FOLLOWUPS, (followup: ChatFollowup) => (
          (followup?.targetKind === 'char' && followup.targetId === charId) ||
          (typeof followup?.messageId === 'number' && messageIdSet.has(followup.messageId))
      ));
  },

  updateChatFollowupStatus: async (id: string, status: ChatFollowup['status']): Promise<ChatFollowup | null> => {
      const existing = await getStoreItem<ChatFollowup>(STORE_CHAT_FOLLOWUPS, id);
      if (!existing) return null;
      const next = { ...existing, status, updatedAt: Date.now() };
      await putStoreItem(STORE_CHAT_FOLLOWUPS, next);
      return next;
  },

  getAllChatHubDigests: async (): Promise<ChatHubDigest[]> => (
      await getAllStoreItems<ChatHubDigest>(STORE_CHAT_HUB_DIGESTS)
  ).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),

  getChatHubDigestByDate: async (date: string): Promise<ChatHubDigest | null> => {
      const all = await getAllStoreItems<ChatHubDigest>(STORE_CHAT_HUB_DIGESTS);
      return all
          .filter(item => item.date === date)
          .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] || null;
  },

  saveChatHubDigest: (digest: ChatHubDigest): Promise<void> =>
      putStoreItem(STORE_CHAT_HUB_DIGESTS, digest),

  clearChatHubDigests: async (): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_CHAT_HUB_DIGESTS)) return;
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_CHAT_HUB_DIGESTS, 'readwrite');
          tx.objectStore(STORE_CHAT_HUB_DIGESTS).clear();
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
      });
  },

  // ─── 折子戏·仿真图文历史 ───
  getAllTheaterFauxPieces: async (): Promise<TheaterFauxPiece[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_THEATER_FAUX_PIECES)) return [];
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_THEATER_FAUX_PIECES, 'readonly');
          const req = tx.objectStore(STORE_THEATER_FAUX_PIECES).getAll();
          req.onsuccess = () => resolve(((req.result as TheaterFauxPiece[]) || []).sort((a, b) => b.createdAt - a.createdAt));
          req.onerror = () => reject(req.error);
      });
  },
  saveTheaterFauxPiece: async (piece: TheaterFauxPiece): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_THEATER_FAUX_PIECES)) return;
      const tx = db.transaction(STORE_THEATER_FAUX_PIECES, 'readwrite');
      tx.objectStore(STORE_THEATER_FAUX_PIECES).put(piece);
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
      });
  },
  deleteTheaterFauxPiece: async (id: string): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_THEATER_FAUX_PIECES)) return;
      const tx = db.transaction(STORE_THEATER_FAUX_PIECES, 'readwrite');
      tx.objectStore(STORE_THEATER_FAUX_PIECES).delete(id);
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
      });
  },
  deleteTheaterFauxPiecesByCharId: async (charId: string): Promise<number> => {
      return DB.deleteByIndex(STORE_THEATER_FAUX_PIECES, 'charId', charId);
  },

  // ─── 幕间集·用户导入小剧场 / 问卷库 ───
  getAllTheaterCustomLibraryItems: async (): Promise<TheaterCustomLibraryItem[]> => (
      await getAllStoreItems<TheaterCustomLibraryItem>(STORE_THEATER_CUSTOM_LIBRARY)
  ).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)),
  saveTheaterCustomLibraryItem: (item: TheaterCustomLibraryItem): Promise<void> =>
      putStoreItem(STORE_THEATER_CUSTOM_LIBRARY, item),
  bulkSaveTheaterCustomLibraryItems: async (items: TheaterCustomLibraryItem[]): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_THEATER_CUSTOM_LIBRARY)) return;
      const tx = db.transaction(STORE_THEATER_CUSTOM_LIBRARY, 'readwrite');
      const store = tx.objectStore(STORE_THEATER_CUSTOM_LIBRARY);
      items.forEach(item => store.put(item));
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
      });
  },
  deleteTheaterCustomLibraryItem: (id: string): Promise<void> =>
      deleteStoreItem(STORE_THEATER_CUSTOM_LIBRARY, id),

  // ─── 折子戏·对影会话 ───
  getAllTheaterReflectionSessions: async (): Promise<TheaterReflectionSession[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_THEATER_REFLECTION_SESSIONS)) return [];
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_THEATER_REFLECTION_SESSIONS, 'readonly');
          const req = tx.objectStore(STORE_THEATER_REFLECTION_SESSIONS).getAll();
          req.onsuccess = () => resolve(((req.result as TheaterReflectionSession[]) || []).sort((a, b) => b.updatedAt - a.updatedAt));
          req.onerror = () => reject(req.error);
      });
  },
  getTheaterReflectionSessionsByCharId: async (charId: string): Promise<TheaterReflectionSession[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_THEATER_REFLECTION_SESSIONS)) return [];
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_THEATER_REFLECTION_SESSIONS, 'readonly');
          const req = tx.objectStore(STORE_THEATER_REFLECTION_SESSIONS).index('charId').getAll(charId);
          req.onsuccess = () => resolve(((req.result as TheaterReflectionSession[]) || []).sort((a, b) => b.updatedAt - a.updatedAt));
          req.onerror = () => reject(req.error);
      });
  },
  getTheaterReflectionSession: async (id: string): Promise<TheaterReflectionSession | undefined> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_THEATER_REFLECTION_SESSIONS)) return undefined;
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_THEATER_REFLECTION_SESSIONS, 'readonly');
          const req = tx.objectStore(STORE_THEATER_REFLECTION_SESSIONS).get(id);
          req.onsuccess = () => resolve(req.result as TheaterReflectionSession | undefined);
          req.onerror = () => reject(req.error);
      });
  },
  saveTheaterReflectionSession: async (session: TheaterReflectionSession): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_THEATER_REFLECTION_SESSIONS)) return;
      const tx = db.transaction(STORE_THEATER_REFLECTION_SESSIONS, 'readwrite');
      tx.objectStore(STORE_THEATER_REFLECTION_SESSIONS).put(session);
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
      });
  },
  deleteTheaterReflectionSession: async (id: string): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_THEATER_REFLECTION_SESSIONS)) return;
      const tx = db.transaction(STORE_THEATER_REFLECTION_SESSIONS, 'readwrite');
      tx.objectStore(STORE_THEATER_REFLECTION_SESSIONS).delete(id);
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
      });
  },
  deleteTheaterReflectionSessionsByCharId: async (charId: string): Promise<number> => {
      return DB.deleteByIndex(STORE_THEATER_REFLECTION_SESSIONS, 'charId', charId);
  },

  // ─── 幕间集·一起入眠会话 ───
  getAllTheaterSleepSessions: async (): Promise<TheaterSleepSession[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_THEATER_SLEEP_SESSIONS)) return [];
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_THEATER_SLEEP_SESSIONS, 'readonly');
          const req = tx.objectStore(STORE_THEATER_SLEEP_SESSIONS).getAll();
          req.onsuccess = () => resolve(((req.result as TheaterSleepSession[]) || []).sort((a, b) => b.lastActiveAt - a.lastActiveAt));
          req.onerror = () => reject(req.error);
      });
  },
  getTheaterSleepSession: async (id: string): Promise<TheaterSleepSession | undefined> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_THEATER_SLEEP_SESSIONS)) return undefined;
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_THEATER_SLEEP_SESSIONS, 'readonly');
          const req = tx.objectStore(STORE_THEATER_SLEEP_SESSIONS).get(id);
          req.onsuccess = () => resolve(req.result as TheaterSleepSession | undefined);
          req.onerror = () => reject(req.error);
      });
  },
  saveTheaterSleepSession: async (session: TheaterSleepSession): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_THEATER_SLEEP_SESSIONS)) return;
      const tx = db.transaction(STORE_THEATER_SLEEP_SESSIONS, 'readwrite');
      tx.objectStore(STORE_THEATER_SLEEP_SESSIONS).put(session);
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
      });
  },
  deleteTheaterSleepSession: async (id: string): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_THEATER_SLEEP_SESSIONS)) return;
      const tx = db.transaction(STORE_THEATER_SLEEP_SESSIONS, 'readwrite');
      tx.objectStore(STORE_THEATER_SLEEP_SESSIONS).delete(id);
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
      });
  },
  deleteTheaterSleepSessionsByCharId: async (charId: string): Promise<number> => {
      return DB.deleteByIndex(STORE_THEATER_SLEEP_SESSIONS, 'charId', charId);
  },

  // ─── 幕间集·五子棋 ───
  getAllTheaterGomokuGames: async (): Promise<TheaterGomokuGame[]> => (
      await getAllStoreItems<TheaterGomokuGame>(STORE_THEATER_GOMOKU_GAMES)
  ).sort((a, b) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0)),
  getTheaterGomokuGamesByCharId: async (charId: string): Promise<TheaterGomokuGame[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_THEATER_GOMOKU_GAMES)) return [];
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_THEATER_GOMOKU_GAMES, 'readonly');
          const req = tx.objectStore(STORE_THEATER_GOMOKU_GAMES).index('charId').getAll(charId);
          req.onsuccess = () => resolve(((req.result as TheaterGomokuGame[]) || []).sort((a, b) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0)));
          req.onerror = () => reject(req.error);
      });
  },
  getTheaterGomokuGame: (id: string): Promise<TheaterGomokuGame | null> =>
      getStoreItem<TheaterGomokuGame>(STORE_THEATER_GOMOKU_GAMES, id),
  saveTheaterGomokuGame: (game: TheaterGomokuGame): Promise<void> =>
      putStoreItem(STORE_THEATER_GOMOKU_GAMES, game),
  deleteTheaterGomokuGame: (id: string): Promise<void> =>
      deleteStoreItem(STORE_THEATER_GOMOKU_GAMES, id),
  deleteTheaterGomokuGamesByCharId: async (charId: string): Promise<number> =>
      DB.deleteByIndex(STORE_THEATER_GOMOKU_GAMES, 'charId', charId),

  getAllTheaterGomokuInvitations: async (): Promise<TheaterGomokuInvitation[]> => (
      await getAllStoreItems<TheaterGomokuInvitation>(STORE_THEATER_GOMOKU_INVITATIONS)
  ).sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)),
  getPendingTheaterGomokuInvitations: async (charId?: string): Promise<TheaterGomokuInvitation[]> => {
      const all = await DB.getAllTheaterGomokuInvitations();
      return all.filter(inv => inv.status === 'pending' && (!charId || inv.charId === charId));
  },
  getTheaterGomokuInvitation: (id: string): Promise<TheaterGomokuInvitation | null> =>
      getStoreItem<TheaterGomokuInvitation>(STORE_THEATER_GOMOKU_INVITATIONS, id),
  saveTheaterGomokuInvitation: (invitation: TheaterGomokuInvitation): Promise<void> =>
      putStoreItem(STORE_THEATER_GOMOKU_INVITATIONS, invitation),
  deleteTheaterGomokuInvitation: (id: string): Promise<void> =>
      deleteStoreItem(STORE_THEATER_GOMOKU_INVITATIONS, id),
  deleteTheaterGomokuInvitationsByCharId: async (charId: string): Promise<number> =>
      DB.deleteByIndex(STORE_THEATER_GOMOKU_INVITATIONS, 'charId', charId),

  // ─── 幕间集·围棋 ───
  getAllTheaterGoGames: async (): Promise<TheaterGoGame[]> => (
      await getAllStoreItems<TheaterGoGame>(STORE_THEATER_GO_GAMES)
  ).sort((a, b) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0)),
  getTheaterGoGamesByCharId: async (charId: string): Promise<TheaterGoGame[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_THEATER_GO_GAMES)) return [];
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_THEATER_GO_GAMES, 'readonly');
          const req = tx.objectStore(STORE_THEATER_GO_GAMES).index('charId').getAll(charId);
          req.onsuccess = () => resolve(((req.result as TheaterGoGame[]) || []).sort((a, b) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0)));
          req.onerror = () => reject(req.error);
      });
  },
  getTheaterGoGame: (id: string): Promise<TheaterGoGame | null> =>
      getStoreItem<TheaterGoGame>(STORE_THEATER_GO_GAMES, id),
  saveTheaterGoGame: (game: TheaterGoGame): Promise<void> =>
      putStoreItem(STORE_THEATER_GO_GAMES, game),
  deleteTheaterGoGame: (id: string): Promise<void> =>
      deleteStoreItem(STORE_THEATER_GO_GAMES, id),
  deleteTheaterGoGamesByCharId: async (charId: string): Promise<number> =>
      DB.deleteByIndex(STORE_THEATER_GO_GAMES, 'charId', charId),

  getAllTheaterGoInvitations: async (): Promise<TheaterGoInvitation[]> => (
      await getAllStoreItems<TheaterGoInvitation>(STORE_THEATER_GO_INVITATIONS)
  ).sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)),
  getPendingTheaterGoInvitations: async (charId?: string): Promise<TheaterGoInvitation[]> => {
      const all = await DB.getAllTheaterGoInvitations();
      return all.filter(inv => inv.status === 'pending' && (!charId || inv.charId === charId));
  },
  getTheaterGoInvitation: (id: string): Promise<TheaterGoInvitation | null> =>
      getStoreItem<TheaterGoInvitation>(STORE_THEATER_GO_INVITATIONS, id),
  saveTheaterGoInvitation: (invitation: TheaterGoInvitation): Promise<void> =>
      putStoreItem(STORE_THEATER_GO_INVITATIONS, invitation),
  deleteTheaterGoInvitation: (id: string): Promise<void> =>
      deleteStoreItem(STORE_THEATER_GO_INVITATIONS, id),
  deleteTheaterGoInvitationsByCharId: async (charId: string): Promise<number> =>
      DB.deleteByIndex(STORE_THEATER_GO_INVITATIONS, 'charId', charId),

  // ─── 幕间集·斗地主 ───
  getAllTheaterDoudizhuGames: async (): Promise<TheaterDoudizhuGame[]> => (
      await getAllStoreItems<TheaterDoudizhuGame>(STORE_THEATER_DOUDIZHU_GAMES)
  ).sort((a, b) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0)),
  getTheaterDoudizhuGamesByCharId: async (charId: string): Promise<TheaterDoudizhuGame[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_THEATER_DOUDIZHU_GAMES)) return [];
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_THEATER_DOUDIZHU_GAMES, 'readonly');
          const req = tx.objectStore(STORE_THEATER_DOUDIZHU_GAMES).index('charIds').getAll(charId);
          req.onsuccess = () => resolve(((req.result as TheaterDoudizhuGame[]) || []).sort((a, b) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0)));
          req.onerror = () => reject(req.error);
      });
  },
  getTheaterDoudizhuGame: (id: string): Promise<TheaterDoudizhuGame | null> =>
      getStoreItem<TheaterDoudizhuGame>(STORE_THEATER_DOUDIZHU_GAMES, id),
  saveTheaterDoudizhuGame: (game: TheaterDoudizhuGame): Promise<void> =>
      putStoreItem(STORE_THEATER_DOUDIZHU_GAMES, game),
  deleteTheaterDoudizhuGame: (id: string): Promise<void> =>
      deleteStoreItem(STORE_THEATER_DOUDIZHU_GAMES, id),
  deleteTheaterDoudizhuGamesByCharId: async (charId: string): Promise<number> =>
      DB.deleteByIndex(STORE_THEATER_DOUDIZHU_GAMES, 'charIds', charId),

  getAllTheaterDoudizhuInvitations: async (): Promise<TheaterDoudizhuInvitation[]> => (
      await getAllStoreItems<TheaterDoudizhuInvitation>(STORE_THEATER_DOUDIZHU_INVITATIONS)
  ).sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)),
  getPendingTheaterDoudizhuInvitations: async (charId?: string): Promise<TheaterDoudizhuInvitation[]> => {
      const all = await DB.getAllTheaterDoudizhuInvitations();
      return all.filter(inv => inv.status === 'pending' && (!charId || inv.charId === charId));
  },
  getTheaterDoudizhuInvitation: (id: string): Promise<TheaterDoudizhuInvitation | null> =>
      getStoreItem<TheaterDoudizhuInvitation>(STORE_THEATER_DOUDIZHU_INVITATIONS, id),
  saveTheaterDoudizhuInvitation: (invitation: TheaterDoudizhuInvitation): Promise<void> =>
      putStoreItem(STORE_THEATER_DOUDIZHU_INVITATIONS, invitation),
  deleteTheaterDoudizhuInvitation: (id: string): Promise<void> =>
      deleteStoreItem(STORE_THEATER_DOUDIZHU_INVITATIONS, id),
  deleteTheaterDoudizhuInvitationsByCharId: async (charId: string): Promise<number> =>
      DB.deleteByIndex(STORE_THEATER_DOUDIZHU_INVITATIONS, 'charId', charId),

  // ─── 幕间集·海龟汤 ───
  getAllTheaterTurtleSoupGames: async (): Promise<TheaterTurtleSoupGame[]> => (
      await getAllStoreItems<TheaterTurtleSoupGame>(STORE_THEATER_TURTLE_SOUP_GAMES)
  ).sort((a, b) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0)),
  getTheaterTurtleSoupGamesByCharId: async (charId: string): Promise<TheaterTurtleSoupGame[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_THEATER_TURTLE_SOUP_GAMES)) return [];
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_THEATER_TURTLE_SOUP_GAMES, 'readonly');
          const req = tx.objectStore(STORE_THEATER_TURTLE_SOUP_GAMES).index('charIds').getAll(charId);
          req.onsuccess = () => resolve(((req.result as TheaterTurtleSoupGame[]) || []).sort((a, b) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0)));
          req.onerror = () => reject(req.error);
      });
  },
  getTheaterTurtleSoupGame: (id: string): Promise<TheaterTurtleSoupGame | null> =>
      getStoreItem<TheaterTurtleSoupGame>(STORE_THEATER_TURTLE_SOUP_GAMES, id),
  saveTheaterTurtleSoupGame: (game: TheaterTurtleSoupGame): Promise<void> =>
      putStoreItem(STORE_THEATER_TURTLE_SOUP_GAMES, game),
  deleteTheaterTurtleSoupGame: (id: string): Promise<void> =>
      deleteStoreItem(STORE_THEATER_TURTLE_SOUP_GAMES, id),
  deleteTheaterTurtleSoupGamesByCharId: async (charId: string): Promise<number> =>
      DB.deleteByIndex(STORE_THEATER_TURTLE_SOUP_GAMES, 'charIds', charId),

  getAllTheaterTurtleSoupInvitations: async (): Promise<TheaterTurtleSoupInvitation[]> => (
      await getAllStoreItems<TheaterTurtleSoupInvitation>(STORE_THEATER_TURTLE_SOUP_INVITATIONS)
  ).sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)),
  getPendingTheaterTurtleSoupInvitations: async (charId?: string): Promise<TheaterTurtleSoupInvitation[]> => {
      const all = await DB.getAllTheaterTurtleSoupInvitations();
      return all.filter(inv => inv.status === 'pending' && (!charId || inv.charId === charId));
  },
  getTheaterTurtleSoupInvitation: (id: string): Promise<TheaterTurtleSoupInvitation | null> =>
      getStoreItem<TheaterTurtleSoupInvitation>(STORE_THEATER_TURTLE_SOUP_INVITATIONS, id),
  saveTheaterTurtleSoupInvitation: (invitation: TheaterTurtleSoupInvitation): Promise<void> =>
      putStoreItem(STORE_THEATER_TURTLE_SOUP_INVITATIONS, invitation),
  deleteTheaterTurtleSoupInvitation: (id: string): Promise<void> =>
      deleteStoreItem(STORE_THEATER_TURTLE_SOUP_INVITATIONS, id),
  deleteTheaterTurtleSoupInvitationsByCharId: async (charId: string): Promise<number> =>
      DB.deleteByIndex(STORE_THEATER_TURTLE_SOUP_INVITATIONS, 'charId', charId),

  // ─── 岁时记·典藏馆收录条目 ───
  // ─── 幕间集·麻将 ───
  getAllTheaterMahjongGames: async (): Promise<TheaterMahjongGame[]> => (
      await getAllStoreItems<TheaterMahjongGame>(STORE_THEATER_MAHJONG_GAMES)
  ).sort((a, b) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0)),
  getTheaterMahjongGamesByCharId: async (charId: string): Promise<TheaterMahjongGame[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_THEATER_MAHJONG_GAMES)) return [];
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_THEATER_MAHJONG_GAMES, 'readonly');
          const req = tx.objectStore(STORE_THEATER_MAHJONG_GAMES).index('charIds').getAll(charId);
          req.onsuccess = () => resolve(((req.result as TheaterMahjongGame[]) || []).sort((a, b) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0)));
          req.onerror = () => reject(req.error);
      });
  },
  getTheaterMahjongGame: (id: string): Promise<TheaterMahjongGame | null> =>
      getStoreItem<TheaterMahjongGame>(STORE_THEATER_MAHJONG_GAMES, id),
  saveTheaterMahjongGame: (game: TheaterMahjongGame): Promise<void> =>
      putStoreItem(STORE_THEATER_MAHJONG_GAMES, game),
  deleteTheaterMahjongGame: (id: string): Promise<void> =>
      deleteStoreItem(STORE_THEATER_MAHJONG_GAMES, id),
  deleteTheaterMahjongGamesByCharId: async (charId: string): Promise<number> =>
      DB.deleteByIndex(STORE_THEATER_MAHJONG_GAMES, 'charIds', charId),

  getAllTheaterMahjongInvitations: async (): Promise<TheaterMahjongInvitation[]> => (
      await getAllStoreItems<TheaterMahjongInvitation>(STORE_THEATER_MAHJONG_INVITATIONS)
  ).sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)),
  getPendingTheaterMahjongInvitations: async (charId?: string): Promise<TheaterMahjongInvitation[]> => {
      const all = await DB.getAllTheaterMahjongInvitations();
      return all.filter(inv => inv.status === 'pending' && (!charId || inv.charId === charId));
  },
  getTheaterMahjongInvitation: (id: string): Promise<TheaterMahjongInvitation | null> =>
      getStoreItem<TheaterMahjongInvitation>(STORE_THEATER_MAHJONG_INVITATIONS, id),
  saveTheaterMahjongInvitation: (invitation: TheaterMahjongInvitation): Promise<void> =>
      putStoreItem(STORE_THEATER_MAHJONG_INVITATIONS, invitation),
  deleteTheaterMahjongInvitation: (id: string): Promise<void> =>
      deleteStoreItem(STORE_THEATER_MAHJONG_INVITATIONS, id),
  deleteTheaterMahjongInvitationsByCharId: async (charId: string): Promise<number> =>
      DB.deleteByIndex(STORE_THEATER_MAHJONG_INVITATIONS, 'charId', charId),

  getCollectionItems: async (): Promise<CollectionItem[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_COLLECTION_ITEMS, 'readonly');
          const req = tx.objectStore(STORE_COLLECTION_ITEMS).getAll();
          req.onsuccess = () => resolve(((req.result as CollectionItem[]) || []).sort((a, b) => b.collectedAt - a.collectedAt));
          req.onerror = () => reject(req.error);
      });
  },
  saveCollectionItem: async (item: CollectionItem): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_COLLECTION_ITEMS, 'readwrite');
      tx.objectStore(STORE_COLLECTION_ITEMS).put(item);
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
      });
  },
  deleteCollectionItem: async (id: string): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_COLLECTION_ITEMS, 'readwrite');
      tx.objectStore(STORE_COLLECTION_ITEMS).delete(id);
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
      });
  },

  deleteCollectionItemsByCharId: async (charId: string): Promise<number> => {
      return DB.deleteByCursor(STORE_COLLECTION_ITEMS, (item: CollectionItem) => (
          Array.isArray(item?.charIds) && item.charIds.includes(charId)
      ));
  },

  // ─── 外卖订单 ───
  getTakeoutOrders: async (): Promise<TakeoutOrder[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_TAKEOUT_ORDERS, 'readonly');
          const req = tx.objectStore(STORE_TAKEOUT_ORDERS).getAll();
          req.onsuccess = () => resolve(((req.result as TakeoutOrder[]) || []).sort((a, b) => b.placedAt - a.placedAt));
          req.onerror = () => reject(req.error);
      });
  },
  getTakeoutOrder: async (id: string): Promise<TakeoutOrder | null> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_TAKEOUT_ORDERS, 'readonly');
          const req = tx.objectStore(STORE_TAKEOUT_ORDERS).get(id);
          req.onsuccess = () => resolve((req.result as TakeoutOrder) || null);
          req.onerror = () => reject(req.error);
      });
  },
  saveTakeoutOrder: async (order: TakeoutOrder): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_TAKEOUT_ORDERS, 'readwrite');
      tx.objectStore(STORE_TAKEOUT_ORDERS).put(order);
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
      });
  },
  deleteTakeoutOrder: async (id: string): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_TAKEOUT_ORDERS, 'readwrite');
      tx.objectStore(STORE_TAKEOUT_ORDERS).delete(id);
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
      });
  },

  deleteTakeoutOrdersByCharId: async (charId: string): Promise<number> => {
      return DB.deleteByCursor(STORE_TAKEOUT_ORDERS, (order: TakeoutOrder) => (
          order?.charId === charId || order?.recipient === charId || order?.payer === charId
      ));
  },

  // ── 折子戏·占卜牌库 ──────────────────────────────────────────────
  getDivinationCards: async (deck?: 'tarot' | 'lenormand'): Promise<DivinationCard[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_DIVINATION_CARDS, 'readonly');
          const req = tx.objectStore(STORE_DIVINATION_CARDS).getAll();
          req.onsuccess = () => {
              let list = (req.result as DivinationCard[]) || [];
              if (deck) list = list.filter(c => c.deck === deck);
              resolve(list.sort((a, b) => a.index - b.index));
          };
          req.onerror = () => reject(req.error);
      });
  },
  saveDivinationCard: async (card: DivinationCard): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_DIVINATION_CARDS, 'readwrite');
      tx.objectStore(STORE_DIVINATION_CARDS).put(card);
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
      });
  },
  /** 批量入库（导入整副牌时一次写完，单事务）。 */
  bulkSaveDivinationCards: async (cards: DivinationCard[]): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_DIVINATION_CARDS, 'readwrite');
      const store = tx.objectStore(STORE_DIVINATION_CARDS);
      for (const c of cards) store.put(c);
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
      });
  },
  /** 清空某一副牌（重新导入前用）。 */
  deleteDivinationDeck: async (deck: 'tarot' | 'lenormand'): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_DIVINATION_CARDS, 'readwrite');
      const store = tx.objectStore(STORE_DIVINATION_CARDS);
      const req = store.index('deck').getAllKeys(deck);
      req.onsuccess = () => { for (const k of (req.result as IDBValidKey[])) store.delete(k); };
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
      });
  },

  getThemes: async (): Promise<ChatTheme[]> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_THEMES, 'readonly');
      const store = transaction.objectStore(STORE_THEMES);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  },

  saveTheme: async (theme: ChatTheme): Promise<void> => {
    const db = await openDB();
    const transaction = db.transaction(STORE_THEMES, 'readwrite');
    transaction.objectStore(STORE_THEMES).put(theme);
  },

  deleteTheme: async (id: string): Promise<void> => {
    const db = await openDB();
    const transaction = db.transaction(STORE_THEMES, 'readwrite');
    transaction.objectStore(STORE_THEMES).delete(id);
  },

  getAllAssets: async (): Promise<{id: string, data: string}[]> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_ASSETS, 'readonly');
      const store = transaction.objectStore(STORE_ASSETS);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  },

  getAsset: async (id: string): Promise<string | null> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_ASSETS, 'readonly');
          const store = transaction.objectStore(STORE_ASSETS);
          const request = store.get(id);
          request.onsuccess = () => resolve(request.result?.data || null);
          request.onerror = () => reject(request.error);
      });
  },

  saveAsset: async (id: string, data: string): Promise<void> => {
    const db = await openDB();
    const transaction = db.transaction(STORE_ASSETS, 'readwrite');
    transaction.objectStore(STORE_ASSETS).put({ id, data });
  },

  getAssetRaw: async (id: string): Promise<any | null> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_ASSETS, 'readonly');
          const store = transaction.objectStore(STORE_ASSETS);
          const request = store.get(id);
          request.onsuccess = () => resolve(request.result?.data ?? null);
          request.onerror = () => reject(request.error);
      });
  },

  saveAssetRaw: async (id: string, data: any): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_ASSETS, 'readwrite');
      transaction.objectStore(STORE_ASSETS).put({ id, data });
  },

  deleteAsset: async (id: string): Promise<void> => {
    const db = await openDB();
    const transaction = db.transaction(STORE_ASSETS, 'readwrite');
    transaction.objectStore(STORE_ASSETS).delete(id);
  },

  getJournalStickers: async (): Promise<{name: string, url: string}[]> => {
    const db = await openDB();
    if (!db.objectStoreNames.contains(STORE_JOURNAL_STICKERS)) return [];
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_JOURNAL_STICKERS, 'readonly');
      const store = transaction.objectStore(STORE_JOURNAL_STICKERS);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  },

  saveJournalSticker: async (name: string, url: string): Promise<void> => {
    const db = await openDB();
    const transaction = db.transaction(STORE_JOURNAL_STICKERS, 'readwrite');
    transaction.objectStore(STORE_JOURNAL_STICKERS).put({ name, url });
  },

  deleteJournalSticker: async (name: string): Promise<void> => {
    const db = await openDB();
    const transaction = db.transaction(STORE_JOURNAL_STICKERS, 'readwrite');
    transaction.objectStore(STORE_JOURNAL_STICKERS).delete(name);
  },

  saveGalleryImage: async (img: GalleryImage): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_GALLERY, 'readwrite');
      transaction.objectStore(STORE_GALLERY).put({
          ...img,
          review: typeof img.review === 'string' ? cleanVisibleRoleText(img.review) : img.review,
          charEssay: typeof img.charEssay === 'string' ? cleanVisibleRoleText(img.charEssay) : img.charEssay,
      });
  },

  getGalleryImages: async (charId?: string): Promise<GalleryImage[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_GALLERY, 'readonly');
          const store = transaction.objectStore(STORE_GALLERY);
          let request;
          if (charId) {
              const index = store.index('charId');
              request = index.getAll(IDBKeyRange.only(charId));
          } else {
              request = store.getAll();
          }
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  updateGalleryImage: async (id: string, patch: Partial<Omit<GalleryImage, 'id'>>): Promise<GalleryImage> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_GALLERY, 'readwrite');
      const store = transaction.objectStore(STORE_GALLERY);
      return new Promise((resolve, reject) => {
          const req = store.get(id);
          req.onsuccess = () => {
              const data = req.result as GalleryImage | undefined;
              if (!data) {
                  reject(new Error('Image not found'));
                  return;
              }
              const cleanPatch: Partial<Omit<GalleryImage, 'id'>> = { ...patch };
              if (typeof patch.review === 'string') cleanPatch.review = cleanVisibleRoleText(patch.review);
              if (typeof patch.charEssay === 'string') cleanPatch.charEssay = cleanVisibleRoleText(patch.charEssay);
              const updated: GalleryImage = { ...data, ...cleanPatch, id: data.id, updatedAt: Date.now() };
              const putReq = store.put(updated);
              putReq.onsuccess = () => resolve(updated);
              putReq.onerror = () => reject(putReq.error);
          };
          req.onerror = () => reject(req.error);
      });
  },

  updateGalleryImageReview: async (id: string, review: string): Promise<void> => {
      await DB.updateGalleryImage(id, { review, reviewTimestamp: Date.now() });
  },

  deleteGalleryImage: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_GALLERY, 'readwrite');
      transaction.objectStore(STORE_GALLERY).delete(id);
  },

  deleteGalleryImagesByCharId: async (charId: string): Promise<number> => {
      return DB.deleteByIndex(STORE_GALLERY, 'charId', charId);
  },

  // --- XHS Stock Images ---
  getXhsStockImages: async (): Promise<XhsStockImage[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_XHS_STOCK, 'readonly');
          const request = transaction.objectStore(STORE_XHS_STOCK).getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveXhsStockImage: async (img: XhsStockImage): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_XHS_STOCK, 'readwrite');
      transaction.objectStore(STORE_XHS_STOCK).put(img);
  },

  deleteXhsStockImage: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_XHS_STOCK, 'readwrite');
      transaction.objectStore(STORE_XHS_STOCK).delete(id);
  },

  updateXhsStockImageUsage: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_XHS_STOCK, 'readwrite');
      const store = transaction.objectStore(STORE_XHS_STOCK);
      return new Promise((resolve, reject) => {
          const req = store.get(id);
          req.onsuccess = () => {
              const data = req.result as XhsStockImage;
              if (data) {
                  data.usedCount = (data.usedCount || 0) + 1;
                  data.lastUsedAt = Date.now();
                  store.put(data);
                  resolve();
              } else reject(new Error('Stock image not found'));
          };
          req.onerror = () => reject(req.error);
      });
  },

  // --- XHS Activities (Free Roam) ---
  saveXhsActivity: async (activity: XhsActivityRecord): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_XHS_ACTIVITIES, 'readwrite');
      transaction.objectStore(STORE_XHS_ACTIVITIES).put(activity);
  },

  getXhsActivities: async (characterId: string, limit?: number): Promise<XhsActivityRecord[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_XHS_ACTIVITIES, 'readonly');
          const store = transaction.objectStore(STORE_XHS_ACTIVITIES);
          const index = store.index('characterId');
          const request = index.getAll(IDBKeyRange.only(characterId));
          request.onsuccess = () => {
              let results = (request.result || []) as XhsActivityRecord[];
              results.sort((a, b) => b.timestamp - a.timestamp);
              if (limit) results = results.slice(0, limit);
              resolve(results);
          };
          request.onerror = () => reject(request.error);
      });
  },

  getAllXhsActivities: async (): Promise<XhsActivityRecord[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_XHS_ACTIVITIES, 'readonly');
          const request = transaction.objectStore(STORE_XHS_ACTIVITIES).getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  deleteXhsActivity: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_XHS_ACTIVITIES, 'readwrite');
      transaction.objectStore(STORE_XHS_ACTIVITIES).delete(id);
  },

  clearXhsActivities: async (characterId: string): Promise<void> => {
      const activities = await DB.getXhsActivities(characterId);
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_XHS_ACTIVITIES, 'readwrite');
          const store = transaction.objectStore(STORE_XHS_ACTIVITIES);
          for (const a of activities) {
              store.delete(a.id);
          }
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
      });
  },

  deleteXhsFeedPostsByCharId: async (charId: string): Promise<number> => {
      return DB.updateByCursor(STORE_XHS_FEED, (post: XhsFeedPost) => {
          if (post?.authorType === 'character' && post.charId === charId) return 'delete';
          const comments = Array.isArray(post?.comments) ? post.comments.filter(c => c?.charId !== charId) : post.comments;
          if (Array.isArray(post?.comments) && comments.length !== post.comments.length) {
              return { ...post, comments };
          }
          return false;
      });
  },

  // --- XHS Feed Posts (小红书 App 本地生成信息流) ---
  getXhsFeedPosts: async (): Promise<XhsFeedPost[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_XHS_FEED, 'readonly');
          const request = transaction.objectStore(STORE_XHS_FEED).getAll();
          request.onsuccess = () => {
              const results = (request.result || []) as XhsFeedPost[];
              results.sort((a, b) => b.createdAt - a.createdAt);
              resolve(results);
          };
          request.onerror = () => reject(request.error);
      });
  },

  saveXhsFeedPost: async (post: XhsFeedPost): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_XHS_FEED, 'readwrite');
      transaction.objectStore(STORE_XHS_FEED).put(normalizeXhsFeedVisibleText(post));
  },

  saveXhsFeedPosts: async (posts: XhsFeedPost[]): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_XHS_FEED, 'readwrite');
      const store = transaction.objectStore(STORE_XHS_FEED);
      for (const p of posts) store.put(normalizeXhsFeedVisibleText(p));
  },

  deleteXhsFeedPost: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_XHS_FEED, 'readwrite');
      transaction.objectStore(STORE_XHS_FEED).delete(id);
  },

  clearXhsFeedPosts: async (): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_XHS_FEED, 'readwrite');
      transaction.objectStore(STORE_XHS_FEED).clear();
  },

  // --- Twitter Tweets (推特 App 本地 AI 时间线) ---
  getTwitterTweets: async (): Promise<TwitterTweet[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_TWITTER_TWEETS, 'readonly');
          const request = transaction.objectStore(STORE_TWITTER_TWEETS).getAll();
          request.onsuccess = () => {
              const results = (request.result || []) as TwitterTweet[];
              results.sort((a, b) => b.createdAt - a.createdAt);
              resolve(results);
          };
          request.onerror = () => reject(request.error);
      });
  },

  saveTwitterTweet: async (tweet: TwitterTweet): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_TWITTER_TWEETS, 'readwrite');
      transaction.objectStore(STORE_TWITTER_TWEETS).put(normalizeTwitterTweetVisibleText(tweet));
  },

  saveTwitterTweets: async (tweets: TwitterTweet[]): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_TWITTER_TWEETS, 'readwrite');
      const store = transaction.objectStore(STORE_TWITTER_TWEETS);
      for (const tweet of tweets) store.put(normalizeTwitterTweetVisibleText(tweet));
  },

  deleteTwitterTweet: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_TWITTER_TWEETS, 'readwrite');
      transaction.objectStore(STORE_TWITTER_TWEETS).delete(id);
  },

  clearTwitterTweets: async (): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_TWITTER_TWEETS, 'readwrite');
      transaction.objectStore(STORE_TWITTER_TWEETS).clear();
  },

  getTwitterNotifications: async (): Promise<TwitterNotification[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_TWITTER_NOTIFS, 'readonly');
          const request = transaction.objectStore(STORE_TWITTER_NOTIFS).getAll();
          request.onsuccess = () => {
              const results = (request.result || []) as TwitterNotification[];
              results.sort((a, b) => b.createdAt - a.createdAt);
              resolve(results);
          };
          request.onerror = () => reject(request.error);
      });
  },

  saveTwitterNotification: async (notification: TwitterNotification): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_TWITTER_NOTIFS, 'readwrite');
      transaction.objectStore(STORE_TWITTER_NOTIFS).put(notification);
  },

  saveTwitterNotifications: async (notifications: TwitterNotification[]): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_TWITTER_NOTIFS, 'readwrite');
      const store = transaction.objectStore(STORE_TWITTER_NOTIFS);
      for (const notification of notifications) store.put(notification);
  },

  clearTwitterNotifications: async (): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_TWITTER_NOTIFS, 'readwrite');
      transaction.objectStore(STORE_TWITTER_NOTIFS).clear();
  },

  markTwitterNotificationsRead: async (): Promise<number> => {
      return DB.updateByCursor(STORE_TWITTER_NOTIFS, (notification: TwitterNotification) => (
          notification?.read ? false : { ...notification, read: true }
      ));
  },

  getTwitterProfile: async (): Promise<TwitterProfile | null> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_TWITTER_PROFILE)) return null;
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_TWITTER_PROFILE, 'readonly');
          const request = transaction.objectStore(STORE_TWITTER_PROFILE).get('me');
          request.onsuccess = () => resolve(request.result || null);
          request.onerror = () => reject(request.error);
      });
  },

  saveTwitterProfile: async (profile: TwitterProfile): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_TWITTER_PROFILE)) return;
      const transaction = db.transaction(STORE_TWITTER_PROFILE, 'readwrite');
      transaction.objectStore(STORE_TWITTER_PROFILE).put({ ...profile, id: 'me' });
  },

  getTwitterAccounts: async (): Promise<TwitterAccount[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_TWITTER_ACCOUNTS)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_TWITTER_ACCOUNTS, 'readonly');
          const request = transaction.objectStore(STORE_TWITTER_ACCOUNTS).getAll();
          request.onsuccess = () => {
              const results = (request.result || []) as TwitterAccount[];
              results.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
              resolve(results);
          };
          request.onerror = () => reject(request.error);
      });
  },

  saveTwitterAccount: async (account: TwitterAccount): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_TWITTER_ACCOUNTS)) return;
      const transaction = db.transaction(STORE_TWITTER_ACCOUNTS, 'readwrite');
      transaction.objectStore(STORE_TWITTER_ACCOUNTS).put(account);
  },

  saveTwitterAccounts: async (accounts: TwitterAccount[]): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_TWITTER_ACCOUNTS)) return;
      const transaction = db.transaction(STORE_TWITTER_ACCOUNTS, 'readwrite');
      const store = transaction.objectStore(STORE_TWITTER_ACCOUNTS);
      for (const account of accounts) store.put(account);
  },

  clearTwitterAccounts: async (): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_TWITTER_ACCOUNTS)) return;
      const transaction = db.transaction(STORE_TWITTER_ACCOUNTS, 'readwrite');
      transaction.objectStore(STORE_TWITTER_ACCOUNTS).clear();
  },

  getTwitterDMThreads: async (): Promise<TwitterDMThread[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_TWITTER_DM)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_TWITTER_DM, 'readonly');
          const request = transaction.objectStore(STORE_TWITTER_DM).getAll();
          request.onsuccess = () => {
              const results = (request.result || []) as TwitterDMThread[];
              results.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
              resolve(results);
          };
          request.onerror = () => reject(request.error);
      });
  },

  saveTwitterDMThread: async (thread: TwitterDMThread): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_TWITTER_DM)) return;
      const transaction = db.transaction(STORE_TWITTER_DM, 'readwrite');
      transaction.objectStore(STORE_TWITTER_DM).put(thread);
  },

  clearTwitterDMThreads: async (): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_TWITTER_DM)) return;
      const transaction = db.transaction(STORE_TWITTER_DM, 'readwrite');
      transaction.objectStore(STORE_TWITTER_DM).clear();
  },

  markTwitterDMThreadRead: async (threadId: string): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_TWITTER_DM)) return;
      const transaction = db.transaction(STORE_TWITTER_DM, 'readwrite');
      const store = transaction.objectStore(STORE_TWITTER_DM);
      return new Promise((resolve, reject) => {
          const req = store.get(threadId);
          req.onsuccess = () => {
              const thread = req.result as TwitterDMThread | undefined;
              if (thread) {
                  store.put({
                      ...thread,
                      unreadCount: 0,
                      messages: (thread.messages || []).map(m => ({ ...m, read: true, status: m.senderType === 'user' ? m.status : 'read' })),
                  });
              }
              resolve();
          };
          req.onerror = () => reject(req.error);
      });
  },

  getTwitterSearchRecords: async (): Promise<TwitterSearchRecord[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_TWITTER_SEARCH)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_TWITTER_SEARCH, 'readonly');
          const request = transaction.objectStore(STORE_TWITTER_SEARCH).getAll();
          request.onsuccess = () => {
              const results = (request.result || []) as TwitterSearchRecord[];
              results.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
              resolve(results.slice(0, 20));
          };
          request.onerror = () => reject(request.error);
      });
  },

  saveTwitterSearchRecord: async (record: TwitterSearchRecord): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_TWITTER_SEARCH)) return;
      const transaction = db.transaction(STORE_TWITTER_SEARCH, 'readwrite');
      transaction.objectStore(STORE_TWITTER_SEARCH).put(record);
  },

  clearTwitterSearchRecords: async (): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_TWITTER_SEARCH)) return;
      const transaction = db.transaction(STORE_TWITTER_SEARCH, 'readwrite');
      transaction.objectStore(STORE_TWITTER_SEARCH).clear();
  },

  deleteTwitterDataByCharId: async (charId: string): Promise<number> => {
      const tweetChanged = await DB.updateByCursor(STORE_TWITTER_TWEETS, (tweet: TwitterTweet) => {
          let changed = false;
          let next: TwitterTweet = tweet;
          if (tweet?.authorType === 'character' && tweet.charId === charId) {
              next = {
                  ...next,
                  authorType: 'npc',
                  charId: undefined,
                  authorAvatar: undefined,
                  authorName: `${tweet.authorName || '角色'}（已离线）`,
              };
              changed = true;
          }
          if (Array.isArray(next?.replies)) {
              const replies = next.replies.map(r => {
                  if (r.charId !== charId) return r;
                  changed = true;
                  return {
                      ...r,
                      authorType: 'npc' as const,
                      charId: undefined,
                      authorAvatar: undefined,
                      authorName: `${r.authorName || '角色'}（已离线）`,
                  };
              });
              if (changed) next = { ...next, replies };
          }
          return changed ? next : false;
      });
      const notifChanged = await DB.updateByCursor(STORE_TWITTER_NOTIFS, (notification: TwitterNotification) => {
          if (notification?.actorCharId !== charId) return false;
          return {
              ...notification,
              actorType: 'npc',
              actorCharId: undefined,
              actorAvatar: undefined,
              actorName: `${notification.actorName || '角色'}（已离线）`,
          };
      });
      const accountChanged = await DB.updateByCursor(STORE_TWITTER_ACCOUNTS, (account: TwitterAccount) => {
          if (account?.charId !== charId) return false;
          return {
              ...account,
              authorType: 'npc',
              charId: undefined,
              avatar: undefined,
              displayName: `${account.displayName || '角色'}（已离线）`,
              bio: account.bio || '这个账号已经离线。',
              updatedAt: Date.now(),
          };
      });
      const dmChanged = await DB.updateByCursor(STORE_TWITTER_DM, (thread: TwitterDMThread) => {
          if (thread?.participantCharId !== charId) return false;
          return {
              ...thread,
              participantType: 'npc',
              participantCharId: undefined,
              accountAvatar: undefined,
              accountName: `${thread.accountName || '角色'}（已离线）`,
              updatedAt: Date.now(),
          };
      });
      return tweetChanged + notifChanged + accountChanged + dmChanged;
  },

  saveScheduledMessage: async (msg: ScheduledMessage): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_SCHEDULED, 'readwrite');
      transaction.objectStore(STORE_SCHEDULED).put(msg);
  },

  getDueScheduledMessages: async (charId: string): Promise<ScheduledMessage[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_SCHEDULED, 'readonly');
          const store = transaction.objectStore(STORE_SCHEDULED);
          const index = store.index('charId');
          const request = index.getAll(IDBKeyRange.only(charId));
          request.onsuccess = () => {
              const all = request.result as ScheduledMessage[];
              const now = Date.now();
              const due = all.filter(m => m.dueAt <= now);
              resolve(due);
          };
          request.onerror = () => reject(request.error);
      });
  },

  deleteScheduledMessage: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_SCHEDULED, 'readwrite');
      transaction.objectStore(STORE_SCHEDULED).delete(id);
  },

  deleteScheduledMessagesByCharId: async (charId: string): Promise<number> => {
      return DB.deleteByIndex(STORE_SCHEDULED, 'charId', charId);
  },

  // ─── 絮语·单聊闹钟 ───
  getAllChatAlarms: async (): Promise<ChatAlarm[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_CHAT_ALARMS)) return [];
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_CHAT_ALARMS, 'readonly');
          const req = tx.objectStore(STORE_CHAT_ALARMS).getAll();
          req.onsuccess = () => resolve(((req.result || []) as ChatAlarm[]).sort((a, b) => a.nextAt - b.nextAt));
          req.onerror = () => reject(req.error);
      });
  },

  getChatAlarmsByCharId: async (charId: string): Promise<ChatAlarm[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_CHAT_ALARMS)) return [];
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_CHAT_ALARMS, 'readonly');
          const store = tx.objectStore(STORE_CHAT_ALARMS);
          const idx = store.index('charId');
          const req = idx.getAll(IDBKeyRange.only(charId));
          req.onsuccess = () => resolve(((req.result || []) as ChatAlarm[]).sort((a, b) => {
              if (a.timeHHmm === b.timeHHmm) return a.createdAt - b.createdAt;
              return a.timeHHmm.localeCompare(b.timeHHmm);
          }));
          req.onerror = () => reject(req.error);
      });
  },

  getDueChatAlarms: async (now: number = Date.now()): Promise<ChatAlarm[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_CHAT_ALARMS)) return [];
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_CHAT_ALARMS, 'readonly');
          const store = tx.objectStore(STORE_CHAT_ALARMS);
          const finish = (rows: ChatAlarm[]) => resolve(rows.filter(a => a.enabled && a.nextAt <= now).sort((a, b) => a.nextAt - b.nextAt));
          if (store.indexNames.contains('nextAt')) {
              const idx = store.index('nextAt');
              const req = idx.getAll(IDBKeyRange.upperBound(now));
              req.onsuccess = () => finish((req.result || []) as ChatAlarm[]);
              req.onerror = () => reject(req.error);
              return;
          }
          const req = store.getAll();
          req.onsuccess = () => finish((req.result || []) as ChatAlarm[]);
          req.onerror = () => reject(req.error);
      });
  },

  saveChatAlarm: async (alarm: ChatAlarm): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_CHAT_ALARMS)) return;
      const tx = db.transaction(STORE_CHAT_ALARMS, 'readwrite');
      tx.objectStore(STORE_CHAT_ALARMS).put(alarm);
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error || new Error('saveChatAlarm aborted'));
      });
  },

  deleteChatAlarm: async (id: string): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_CHAT_ALARMS)) return;
      const tx = db.transaction(STORE_CHAT_ALARMS, 'readwrite');
      tx.objectStore(STORE_CHAT_ALARMS).delete(id);
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error || new Error('deleteChatAlarm aborted'));
      });
  },

  deleteChatAlarmsByCharId: async (charId: string): Promise<number> => {
      return DB.deleteByIndex(STORE_CHAT_ALARMS, 'charId', charId);
  },

  // Health period reminders
  getAllPeriodReminderSettings: async (): Promise<PeriodReminderSettings[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_PERIOD_REMINDER_SETTINGS)) return [];
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_PERIOD_REMINDER_SETTINGS, 'readonly');
          const req = tx.objectStore(STORE_PERIOD_REMINDER_SETTINGS).getAll();
          req.onsuccess = () => resolve(((req.result || []) as PeriodReminderSettings[]).sort((a, b) => a.createdAt - b.createdAt));
          req.onerror = () => reject(req.error);
      });
  },

  getPeriodReminderSettings: async (id = 'period_reminder_main'): Promise<PeriodReminderSettings | null> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_PERIOD_REMINDER_SETTINGS)) return null;
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_PERIOD_REMINDER_SETTINGS, 'readonly');
          const req = tx.objectStore(STORE_PERIOD_REMINDER_SETTINGS).get(id);
          req.onsuccess = () => resolve((req.result || null) as PeriodReminderSettings | null);
          req.onerror = () => reject(req.error);
      });
  },

  getDuePeriodReminderSettings: async (now: number = Date.now()): Promise<PeriodReminderSettings[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_PERIOD_REMINDER_SETTINGS)) return [];
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_PERIOD_REMINDER_SETTINGS, 'readonly');
          const store = tx.objectStore(STORE_PERIOD_REMINDER_SETTINGS);
          const finish = (rows: PeriodReminderSettings[]) => resolve(rows.filter(s => s.enabled && s.nextAt > 0 && s.nextAt <= now).sort((a, b) => a.nextAt - b.nextAt));
          if (store.indexNames.contains('nextAt')) {
              const idx = store.index('nextAt');
              const req = idx.getAll(IDBKeyRange.upperBound(now));
              req.onsuccess = () => finish((req.result || []) as PeriodReminderSettings[]);
              req.onerror = () => reject(req.error);
              return;
          }
          const req = store.getAll();
          req.onsuccess = () => finish((req.result || []) as PeriodReminderSettings[]);
          req.onerror = () => reject(req.error);
      });
  },

  savePeriodReminderSettings: async (settings: PeriodReminderSettings): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_PERIOD_REMINDER_SETTINGS)) return;
      const tx = db.transaction(STORE_PERIOD_REMINDER_SETTINGS, 'readwrite');
      tx.objectStore(STORE_PERIOD_REMINDER_SETTINGS).put(settings);
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error || new Error('savePeriodReminderSettings aborted'));
      });
  },

  getAllPeriodCycleEvents: async (): Promise<PeriodCycleEvent[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_PERIOD_CYCLE_EVENTS)) return [];
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_PERIOD_CYCLE_EVENTS, 'readonly');
          const req = tx.objectStore(STORE_PERIOD_CYCLE_EVENTS).getAll();
          req.onsuccess = () => resolve(((req.result || []) as PeriodCycleEvent[]).sort((a, b) => a.date.localeCompare(b.date)));
          req.onerror = () => reject(req.error);
      });
  },

  savePeriodCycleEvent: async (event: PeriodCycleEvent): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_PERIOD_CYCLE_EVENTS)) return;
      const tx = db.transaction(STORE_PERIOD_CYCLE_EVENTS, 'readwrite');
      tx.objectStore(STORE_PERIOD_CYCLE_EVENTS).put(event);
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error || new Error('savePeriodCycleEvent aborted'));
      });
  },

  deletePeriodCycleEvent: async (id: string): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_PERIOD_CYCLE_EVENTS)) return;
      const tx = db.transaction(STORE_PERIOD_CYCLE_EVENTS, 'readwrite');
      tx.objectStore(STORE_PERIOD_CYCLE_EVENTS).delete(id);
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error || new Error('deletePeriodCycleEvent aborted'));
      });
  },

  // Health center
  getAllHealthModuleSettings: async (): Promise<HealthModuleSettings[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_HEALTH_MODULE_SETTINGS)) return [];
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_HEALTH_MODULE_SETTINGS, 'readonly');
          const req = tx.objectStore(STORE_HEALTH_MODULE_SETTINGS).getAll();
          req.onsuccess = () => resolve((req.result || []) as HealthModuleSettings[]);
          req.onerror = () => reject(req.error);
      });
  },

  saveHealthModuleSettings: async (settings: HealthModuleSettings): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_HEALTH_MODULE_SETTINGS)) return;
      const tx = db.transaction(STORE_HEALTH_MODULE_SETTINGS, 'readwrite');
      tx.objectStore(STORE_HEALTH_MODULE_SETTINGS).put(settings);
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error || new Error('saveHealthModuleSettings aborted'));
      });
  },

  saveHealthModuleSettingsMany: async (settings: HealthModuleSettings[]): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_HEALTH_MODULE_SETTINGS)) return;
      const tx = db.transaction(STORE_HEALTH_MODULE_SETTINGS, 'readwrite');
      const store = tx.objectStore(STORE_HEALTH_MODULE_SETTINGS);
      settings.forEach(item => store.put(item));
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error || new Error('saveHealthModuleSettingsMany aborted'));
      });
  },

  getAllHealthRecords: async (): Promise<HealthRecord[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_HEALTH_RECORDS)) return [];
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_HEALTH_RECORDS, 'readonly');
          const req = tx.objectStore(STORE_HEALTH_RECORDS).getAll();
          req.onsuccess = () => resolve(((req.result || []) as HealthRecord[]).sort((a, b) => {
              if (a.date === b.date) return (a.timeHHmm || '').localeCompare(b.timeHHmm || '');
              return b.date.localeCompare(a.date);
          }));
          req.onerror = () => reject(req.error);
      });
  },

  getHealthRecordsByDate: async (date: string): Promise<HealthRecord[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_HEALTH_RECORDS)) return [];
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_HEALTH_RECORDS, 'readonly');
          const store = tx.objectStore(STORE_HEALTH_RECORDS);
          const req = store.indexNames.contains('date')
              ? store.index('date').getAll(IDBKeyRange.only(date))
              : store.getAll();
          req.onsuccess = () => resolve(((req.result || []) as HealthRecord[])
              .filter(record => record.date === date)
              .sort((a, b) => (a.timeHHmm || '').localeCompare(b.timeHHmm || '')));
          req.onerror = () => reject(req.error);
      });
  },

  getHealthRecordsByModule: async (moduleId: HealthModuleId): Promise<HealthRecord[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_HEALTH_RECORDS)) return [];
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_HEALTH_RECORDS, 'readonly');
          const store = tx.objectStore(STORE_HEALTH_RECORDS);
          const req = store.indexNames.contains('moduleId')
              ? store.index('moduleId').getAll(IDBKeyRange.only(moduleId))
              : store.getAll();
          req.onsuccess = () => resolve(((req.result || []) as HealthRecord[])
              .filter(record => record.moduleId === moduleId)
              .sort((a, b) => b.date.localeCompare(a.date)));
          req.onerror = () => reject(req.error);
      });
  },

  getHealthRecordsByModuleDate: async (moduleId: HealthModuleId, date: string): Promise<HealthRecord[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_HEALTH_RECORDS)) return [];
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_HEALTH_RECORDS, 'readonly');
          const store = tx.objectStore(STORE_HEALTH_RECORDS);
          const req = store.indexNames.contains('moduleId_date')
              ? store.index('moduleId_date').getAll(IDBKeyRange.only([moduleId, date]))
              : store.getAll();
          req.onsuccess = () => resolve(((req.result || []) as HealthRecord[])
              .filter(record => record.moduleId === moduleId && record.date === date)
              .sort((a, b) => (a.timeHHmm || '').localeCompare(b.timeHHmm || '')));
          req.onerror = () => reject(req.error);
      });
  },

  saveHealthRecord: async (record: HealthRecord): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_HEALTH_RECORDS)) return;
      const tx = db.transaction(STORE_HEALTH_RECORDS, 'readwrite');
      tx.objectStore(STORE_HEALTH_RECORDS).put(record);
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error || new Error('saveHealthRecord aborted'));
      });
  },

  deleteHealthRecord: async (id: string): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_HEALTH_RECORDS)) return;
      const tx = db.transaction(STORE_HEALTH_RECORDS, 'readwrite');
      tx.objectStore(STORE_HEALTH_RECORDS).delete(id);
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error || new Error('deleteHealthRecord aborted'));
      });
  },

  getAllHealthReminders: async (): Promise<HealthReminder[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_HEALTH_REMINDERS)) return [];
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_HEALTH_REMINDERS, 'readonly');
          const req = tx.objectStore(STORE_HEALTH_REMINDERS).getAll();
          req.onsuccess = () => resolve(((req.result || []) as HealthReminder[]).sort((a, b) => a.nextAt - b.nextAt));
          req.onerror = () => reject(req.error);
      });
  },

  getDueHealthReminders: async (now: number = Date.now()): Promise<HealthReminder[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_HEALTH_REMINDERS)) return [];
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_HEALTH_REMINDERS, 'readonly');
          const store = tx.objectStore(STORE_HEALTH_REMINDERS);
          const finish = (rows: HealthReminder[]) => resolve(rows.filter(r => r.enabled && r.nextAt > 0 && r.nextAt <= now).sort((a, b) => a.nextAt - b.nextAt));
          if (store.indexNames.contains('nextAt')) {
              const req = store.index('nextAt').getAll(IDBKeyRange.upperBound(now));
              req.onsuccess = () => finish((req.result || []) as HealthReminder[]);
              req.onerror = () => reject(req.error);
              return;
          }
          const req = store.getAll();
          req.onsuccess = () => finish((req.result || []) as HealthReminder[]);
          req.onerror = () => reject(req.error);
      });
  },

  saveHealthReminder: async (reminder: HealthReminder): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_HEALTH_REMINDERS)) return;
      const tx = db.transaction(STORE_HEALTH_REMINDERS, 'readwrite');
      tx.objectStore(STORE_HEALTH_REMINDERS).put(reminder);
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error || new Error('saveHealthReminder aborted'));
      });
  },

  deleteHealthReminder: async (id: string): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_HEALTH_REMINDERS)) return;
      const tx = db.transaction(STORE_HEALTH_REMINDERS, 'readwrite');
      tx.objectStore(STORE_HEALTH_REMINDERS).delete(id);
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error || new Error('deleteHealthReminder aborted'));
      });
  },

  getAllHealthPlans: async (): Promise<HealthPlan[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_HEALTH_PLANS)) return [];
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_HEALTH_PLANS, 'readonly');
          const req = tx.objectStore(STORE_HEALTH_PLANS).getAll();
          req.onsuccess = () => resolve((req.result || []) as HealthPlan[]);
          req.onerror = () => reject(req.error);
      });
  },

  saveHealthPlan: async (plan: HealthPlan): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_HEALTH_PLANS)) return;
      const tx = db.transaction(STORE_HEALTH_PLANS, 'readwrite');
      tx.objectStore(STORE_HEALTH_PLANS).put(plan);
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error || new Error('saveHealthPlan aborted'));
      });
  },

  getAllHealthSummaries: async (): Promise<HealthSummary[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_HEALTH_SUMMARIES)) return [];
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_HEALTH_SUMMARIES, 'readonly');
          const req = tx.objectStore(STORE_HEALTH_SUMMARIES).getAll();
          req.onsuccess = () => resolve((req.result || []) as HealthSummary[]);
          req.onerror = () => reject(req.error);
      });
  },

  saveHealthSummary: async (summary: HealthSummary): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_HEALTH_SUMMARIES)) return;
      const tx = db.transaction(STORE_HEALTH_SUMMARIES, 'readwrite');
      tx.objectStore(STORE_HEALTH_SUMMARIES).put(summary);
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error || new Error('saveHealthSummary aborted'));
      });
  },

  getAllHealthImportBatches: async (): Promise<HealthImportBatch[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_HEALTH_IMPORT_BATCHES)) return [];
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_HEALTH_IMPORT_BATCHES, 'readonly');
          const req = tx.objectStore(STORE_HEALTH_IMPORT_BATCHES).getAll();
          req.onsuccess = () => resolve(((req.result || []) as HealthImportBatch[]).sort((a, b) => b.createdAt - a.createdAt));
          req.onerror = () => reject(req.error);
      });
  },

  saveHealthImportBatch: async (batch: HealthImportBatch): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_HEALTH_IMPORT_BATCHES)) return;
      const tx = db.transaction(STORE_HEALTH_IMPORT_BATCHES, 'readwrite');
      tx.objectStore(STORE_HEALTH_IMPORT_BATCHES).put(batch);
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error || new Error('saveHealthImportBatch aborted'));
      });
  },

  deleteHealthImportBatch: async (id: string): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_HEALTH_IMPORT_BATCHES)) return;
      const tx = db.transaction(STORE_HEALTH_IMPORT_BATCHES, 'readwrite');
      tx.objectStore(STORE_HEALTH_IMPORT_BATCHES).delete(id);
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error || new Error('deleteHealthImportBatch aborted'));
      });
  },

  saveUserProfile: async (profile: UserProfile): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_USER, 'readwrite');
      transaction.objectStore(STORE_USER).put({ ...profile, id: 'me' });
  },

  getUserProfile: async (): Promise<UserProfile | null> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_USER, 'readonly');
          const store = transaction.objectStore(STORE_USER);
          const request = store.get('me');
          request.onsuccess = () => {
              if (request.result) {
                  const { id, ...profile } = request.result;
                  resolve(profile as UserProfile);
              } else {
                  resolve(null);
              }
          };
          request.onerror = () => reject(request.error);
      });
  },

  getDiariesByCharId: async (charId: string): Promise<DiaryEntry[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_DIARIES, 'readonly');
          const store = transaction.objectStore(STORE_DIARIES);
          const index = store.index('charId');
          const request = index.getAll(IDBKeyRange.only(charId));
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveDiary: async (diary: DiaryEntry): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_DIARIES, 'readwrite');
      transaction.objectStore(STORE_DIARIES).put(diary);
  },

  deleteDiary: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_DIARIES, 'readwrite');
      transaction.objectStore(STORE_DIARIES).delete(id);
  },

  deleteDiariesByCharId: async (charId: string): Promise<number> => {
      return DB.deleteByIndex(STORE_DIARIES, 'charId', charId);
  },

  // --- 电话 App：通话记录 ---
  savePhoneCallLog: async (log: PhoneCallLog): Promise<void> => {
      const db = await openDB();
      db.transaction(STORE_PHONE_CALL_LOGS, 'readwrite').objectStore(STORE_PHONE_CALL_LOGS).put(log);
  },

  getAllPhoneCallLogs: async (): Promise<PhoneCallLog[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const request = db.transaction(STORE_PHONE_CALL_LOGS, 'readonly').objectStore(STORE_PHONE_CALL_LOGS).getAll();
          request.onsuccess = () => {
              const logs: PhoneCallLog[] = request.result || [];
              resolve(logs.sort((a, b) => b.timestamp - a.timestamp));
          };
          request.onerror = () => reject(request.error);
      });
  },

  deletePhoneCallLog: async (id: string): Promise<void> => {
      const db = await openDB();
      db.transaction(STORE_PHONE_CALL_LOGS, 'readwrite').objectStore(STORE_PHONE_CALL_LOGS).delete(id);
  },

  deletePhoneCallLogsByCharId: async (charId: string): Promise<number> => {
      return DB.deleteByIndex(STORE_PHONE_CALL_LOGS, 'charId', charId);
  },

  clearPhoneCallLogs: async (): Promise<void> => {
      const db = await openDB();
      db.transaction(STORE_PHONE_CALL_LOGS, 'readwrite').objectStore(STORE_PHONE_CALL_LOGS).clear();
  },

  // --- 絮语查岗档案 ---
  savePhoneCheckSession: (session: PhoneCheckSession): Promise<void> =>
      putStoreItem(STORE_PHONE_CHECK_SESSIONS, normalizePhoneCheckSessionVisibleText(session)),

  getPhoneCheckSession: (id: string): Promise<PhoneCheckSession | null> =>
      getStoreItem<PhoneCheckSession>(STORE_PHONE_CHECK_SESSIONS, id),

  getPhoneCheckSessions: async (charId?: string, limit?: number): Promise<PhoneCheckSession[]> => {
      const all = await getAllStoreItems<PhoneCheckSession>(STORE_PHONE_CHECK_SESSIONS);
      const filtered = charId ? all.filter(session => session.charId === charId) : all;
      const sorted = filtered.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
      return limit && limit > 0 ? sorted.slice(0, limit) : sorted;
  },

  deletePhoneCheckSession: (id: string): Promise<void> =>
      deleteStoreItem(STORE_PHONE_CHECK_SESSIONS, id),

  deletePhoneCheckSessionsByCharId: async (charId: string): Promise<number> =>
      DB.deleteByIndex(STORE_PHONE_CHECK_SESSIONS, 'charId', charId),

  prunePhoneCheckSessions: async (charId: string, keepN = 80): Promise<void> => {
      const sessions = await DB.getPhoneCheckSessions(charId);
      if (sessions.length <= keepN) return;
      const toDelete = sessions.slice(keepN);
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_PHONE_CHECK_SESSIONS)) return;
      const tx = db.transaction(STORE_PHONE_CHECK_SESSIONS, 'readwrite');
      const store = tx.objectStore(STORE_PHONE_CHECK_SESSIONS);
      toDelete.forEach(session => store.delete(session.id));
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
      });
  },

  // --- 絮语观屏评论会话 ---
  saveUserScreenWatchSession: async (session: UserScreenWatchSession, keepN = 30): Promise<void> => {
      const cleanSession = normalizeUserScreenWatchVisibleText(session);
      const clean: UserScreenWatchSession = {
          ...cleanSession,
          frames: (cleanSession.frames || []).slice(-20),
          comments: (cleanSession.comments || []).slice(-80),
          updatedAt: session.updatedAt || Date.now(),
      };
      await putStoreItem(STORE_USER_SCREEN_WATCH, clean);
      await DB.pruneUserScreenWatchSessions(clean.charId, keepN);
  },

  getUserScreenWatchSession: (id: string): Promise<UserScreenWatchSession | null> =>
      getStoreItem<UserScreenWatchSession>(STORE_USER_SCREEN_WATCH, id),

  getUserScreenWatchSessions: async (charId?: string, limit?: number): Promise<UserScreenWatchSession[]> => {
      const all = await getAllStoreItems<UserScreenWatchSession>(STORE_USER_SCREEN_WATCH);
      const filtered = charId ? all.filter(session => session.charId === charId) : all;
      const sorted = filtered.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
      return limit && limit > 0 ? sorted.slice(0, limit) : sorted;
  },

  getLatestUserScreenWatchSession: async (charId: string): Promise<UserScreenWatchSession | undefined> => {
      const sessions = await DB.getUserScreenWatchSessions(charId, 1);
      return sessions[0];
  },

  deleteUserScreenWatchSession: (id: string): Promise<void> =>
      deleteStoreItem(STORE_USER_SCREEN_WATCH, id),

  deleteUserScreenWatchSessionsByCharId: async (charId: string): Promise<number> =>
      DB.deleteByIndex(STORE_USER_SCREEN_WATCH, 'charId', charId),

  pruneUserScreenWatchSessions: async (charId: string, keepN = 30): Promise<void> => {
      const sessions = await DB.getUserScreenWatchSessions(charId);
      if (sessions.length <= keepN) return;
      const toDelete = sessions.slice(keepN);
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_USER_SCREEN_WATCH)) return;
      const tx = db.transaction(STORE_USER_SCREEN_WATCH, 'readwrite');
      const store = tx.objectStore(STORE_USER_SCREEN_WATCH);
      toDelete.forEach(session => store.delete(session.id));
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
      });
  },

  // --- 日记社：多角色交换日记本 ---
  saveExchangeDiaryBook: async (book: ExchangeDiaryBook): Promise<void> => {
      const db = await openDB();
      db.transaction(STORE_EXCHANGE_DIARY, 'readwrite').objectStore(STORE_EXCHANGE_DIARY).put(book);
  },

  getAllExchangeDiaryBooks: async (): Promise<ExchangeDiaryBook[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const request = db.transaction(STORE_EXCHANGE_DIARY, 'readonly').objectStore(STORE_EXCHANGE_DIARY).getAll();
          request.onsuccess = () => {
              const books: ExchangeDiaryBook[] = request.result || [];
              resolve(books.sort((a, b) => b.updatedAt - a.updatedAt));
          };
          request.onerror = () => reject(request.error);
      });
  },

  deleteExchangeDiaryBook: async (id: string): Promise<void> => {
      const db = await openDB();
      db.transaction(STORE_EXCHANGE_DIARY, 'readwrite').objectStore(STORE_EXCHANGE_DIARY).delete(id);
  },

  deleteExchangeDiaryBooksByCharId: async (charId: string): Promise<number> => {
      return DB.updateByCursor(STORE_EXCHANGE_DIARY, (book: ExchangeDiaryBook) => {
          const nextEntries = Array.isArray(book?.entries) ? book.entries.filter(e => e?.charId !== charId) : [];
          const nextCharIds = Array.isArray(book?.charIds) ? book.charIds.filter(id => id !== charId) : [];
          const changed =
              nextEntries.length !== (book?.entries?.length || 0) ||
              nextCharIds.length !== (book?.charIds?.length || 0) ||
              book?.activeCharId === charId;
          if (!changed) return false;
          if (nextCharIds.length === 0 && nextEntries.length === 0) return 'delete';
          return {
              ...book,
              charIds: nextCharIds,
              activeCharId: book.activeCharId === charId ? (nextCharIds[0] || '') : book.activeCharId,
              entries: nextEntries,
              updatedAt: Date.now(),
          };
      });
  },

  // --- 偷看心声 ---
  saveInnerVoice: async (entry: InnerVoiceEntry): Promise<void> => {
      const db = await openDB();
      db.transaction(STORE_INNER_VOICES, 'readwrite').objectStore(STORE_INNER_VOICES).put(entry);
  },

  getInnerVoicesByCharId: async (charId: string): Promise<InnerVoiceEntry[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const index = db.transaction(STORE_INNER_VOICES, 'readonly').objectStore(STORE_INNER_VOICES).index('charId');
          const request = index.getAll(IDBKeyRange.only(charId));
          request.onsuccess = () => {
              const entries: InnerVoiceEntry[] = request.result || [];
              resolve(entries.sort((a, b) => b.timestamp - a.timestamp));
          };
          request.onerror = () => reject(request.error);
      });
  },

  deleteInnerVoice: async (id: string): Promise<void> => {
      const db = await openDB();
      db.transaction(STORE_INNER_VOICES, 'readwrite').objectStore(STORE_INNER_VOICES).delete(id);
  },

  deleteInnerVoicesByCharId: async (charId: string): Promise<number> => {
      return DB.deleteByIndex(STORE_INNER_VOICES, 'charId', charId);
  },

  getAllTasks: async (): Promise<Task[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_TASKS)) return [];
      
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_TASKS, 'readonly');
          const store = transaction.objectStore(STORE_TASKS);
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveTask: async (task: Task): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_TASKS, 'readwrite');
      transaction.objectStore(STORE_TASKS).put(task);
  },

  deleteTask: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_TASKS, 'readwrite');
      transaction.objectStore(STORE_TASKS).delete(id);
  },

  getAllAnniversaries: async (): Promise<Anniversary[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_ANNIVERSARIES)) return [];

      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_ANNIVERSARIES, 'readonly');
          const store = transaction.objectStore(STORE_ANNIVERSARIES);
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveAnniversary: async (anniversary: Anniversary): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_ANNIVERSARIES, 'readwrite');
      transaction.objectStore(STORE_ANNIVERSARIES).put(anniversary);
  },

  deleteAnniversary: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_ANNIVERSARIES, 'readwrite');
      transaction.objectStore(STORE_ANNIVERSARIES).delete(id);
  },

  deleteAnniversariesByCharId: async (charId: string): Promise<number> => {
      return DB.deleteByIndex(STORE_ANNIVERSARIES, 'charId', charId);
  },

  // --- 岁时记 · 实时日历贴纸 ---
  getAllCalendarMarks: async (): Promise<CalendarMark[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_CALENDAR_MARKS)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_CALENDAR_MARKS, 'readonly');
          const request = transaction.objectStore(STORE_CALENDAR_MARKS).getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveCalendarMark: async (mark: CalendarMark): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_CALENDAR_MARKS, 'readwrite');
      transaction.objectStore(STORE_CALENDAR_MARKS).put(mark);
  },

  deleteCalendarMark: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_CALENDAR_MARKS, 'readwrite');
      transaction.objectStore(STORE_CALENDAR_MARKS).delete(id);
  },

  deleteCalendarMarksByCharId: async (charId: string): Promise<number> => {
      return DB.deleteByCursor(STORE_CALENDAR_MARKS, (mark: CalendarMark) => mark?.charId === charId);
  },

  // --- 存钱罐 · 角色账本 ---
  getAllCharLedgerEntries: async (): Promise<CharLedgerEntry[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_CHAR_LEDGERS)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_CHAR_LEDGERS, 'readonly');
          const request = transaction.objectStore(STORE_CHAR_LEDGERS).getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveCharLedgerEntry: async (entry: CharLedgerEntry): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_CHAR_LEDGERS, 'readwrite');
      transaction.objectStore(STORE_CHAR_LEDGERS).put(entry);
  },

  deleteCharLedgerEntry: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_CHAR_LEDGERS, 'readwrite');
      transaction.objectStore(STORE_CHAR_LEDGERS).delete(id);
  },

  deleteCharLedgerEntriesByCharId: async (charId: string): Promise<number> => {
      return DB.deleteByIndex(STORE_CHAR_LEDGERS, 'charId', charId);
  },

  getRoomTodo: async (charId: string, date: string): Promise<RoomTodo | null> => {
      const db = await openDB();
      const id = `${charId}_${date}`;
      return new Promise((resolve, reject) => {
          if (!db.objectStoreNames.contains(STORE_ROOM_TODOS)) { resolve(null); return; }
          const transaction = db.transaction(STORE_ROOM_TODOS, 'readonly');
          const store = transaction.objectStore(STORE_ROOM_TODOS);
          const req = store.get(id);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(req.error);
      });
  },

  saveRoomTodo: async (todo: RoomTodo): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_ROOM_TODOS, 'readwrite');
      transaction.objectStore(STORE_ROOM_TODOS).put(todo);
  },

  deleteRoomTodosByCharId: async (charId: string): Promise<number> => {
      return DB.deleteByCursor(STORE_ROOM_TODOS, (todo: RoomTodo, key: IDBValidKey) => (
          todo?.charId === charId || (typeof key === 'string' && key.startsWith(`${charId}_`))
      ));
  },

  getRoomNotes: async (charId: string): Promise<RoomNote[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          if (!db.objectStoreNames.contains(STORE_ROOM_NOTES)) { resolve([]); return; }
          const transaction = db.transaction(STORE_ROOM_NOTES, 'readonly');
          const store = transaction.objectStore(STORE_ROOM_NOTES);
          const index = store.index('charId');
          const request = index.getAll(IDBKeyRange.only(charId));
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveRoomNote: async (note: RoomNote): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_ROOM_NOTES, 'readwrite');
      transaction.objectStore(STORE_ROOM_NOTES).put(note);
  },

  deleteRoomNote: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_ROOM_NOTES, 'readwrite');
      transaction.objectStore(STORE_ROOM_NOTES).delete(id);
  },

  deleteRoomNotesByCharId: async (charId: string): Promise<number> => {
      return DB.deleteByIndex(STORE_ROOM_NOTES, 'charId', charId);
  },

  // ─── Daily Schedule (角色日程表) ───
  getDailySchedule: async (charId: string, date: string): Promise<DailySchedule | null> => {
      const db = await openDB();
      const id = `${charId}_${date}`;
      return new Promise((resolve, reject) => {
          if (!db.objectStoreNames.contains(STORE_DAILY_SCHEDULE)) { resolve(null); return; }
          const transaction = db.transaction(STORE_DAILY_SCHEDULE, 'readonly');
          const store = transaction.objectStore(STORE_DAILY_SCHEDULE);
          const req = store.get(id);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(req.error);
      });
  },

  saveDailySchedule: async (schedule: DailySchedule): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_DAILY_SCHEDULE, 'readwrite');
      transaction.objectStore(STORE_DAILY_SCHEDULE).put(schedule);
      return new Promise((resolve, reject) => {
          transaction.oncomplete = () => {
              dispatchDailyScheduleSaved(schedule);
              resolve();
          };
          transaction.onerror = () => reject(transaction.error);
      });
  },

  /** 删除某角色的全部每日日程（清空聊天记录·全部清除时连日程一并抹掉） */
  deleteDailySchedulesByChar: async (charId: string): Promise<void> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          if (!db.objectStoreNames.contains(STORE_DAILY_SCHEDULE)) { resolve(); return; }
          const transaction = db.transaction(STORE_DAILY_SCHEDULE, 'readwrite');
          const store = transaction.objectStore(STORE_DAILY_SCHEDULE);
          const deleted: DailySchedule[] = [];
          const req = store.openCursor();
          req.onsuccess = () => {
              const cursor = req.result;
              if (cursor) {
                  const val = cursor.value as DailySchedule;
                  if (val?.charId === charId || (typeof cursor.key === 'string' && cursor.key.startsWith(`${charId}_`))) {
                      if (val?.charId) deleted.push(val);
                      cursor.delete();
                  }
                  cursor.continue();
              }
          };
          transaction.oncomplete = () => {
              if (deleted.length > 0) {
                  deleted.forEach(s => dispatchDailyScheduleUpdated({
                      charId: s.charId,
                      date: s.date,
                      scheduleId: s.id,
                      deleted: true,
                  }));
              } else {
                  dispatchDailyScheduleUpdated({ charId, deleted: true });
              }
              resolve();
          };
          transaction.onerror = () => reject(transaction.error);
      });
  },

  // ─── 热点快照 (分时段，全角色共享) ───
  getHotNewsSnapshot: async (id: string): Promise<HotNewsSnapshot | null> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          if (!db.objectStoreNames.contains(STORE_HOTNEWS)) { resolve(null); return; }
          const transaction = db.transaction(STORE_HOTNEWS, 'readonly');
          const req = transaction.objectStore(STORE_HOTNEWS).get(id);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(req.error);
      });
  },

  saveHotNewsSnapshot: async (snapshot: HotNewsSnapshot): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_HOTNEWS, 'readwrite');
      transaction.objectStore(STORE_HOTNEWS).put(snapshot);
  },

  // 拿最近一次快照（按 fetchedAt 倒序），失败兜底与 App 展示用
  getLatestHotNewsSnapshot: async (): Promise<HotNewsSnapshot | null> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          if (!db.objectStoreNames.contains(STORE_HOTNEWS)) { resolve(null); return; }
          const transaction = db.transaction(STORE_HOTNEWS, 'readonly');
          const req = transaction.objectStore(STORE_HOTNEWS).getAll();
          req.onsuccess = () => {
              const all = (req.result || []) as HotNewsSnapshot[];
              if (all.length === 0) { resolve(null); return; }
              all.sort((a, b) => b.fetchedAt - a.fetchedAt);
              resolve(all[0]);
          };
          req.onerror = () => reject(req.error);
      });
  },

  // 清理过期快照（保留最近 N 条），避免无限堆积
  pruneHotNewsSnapshots: async (keep = 12): Promise<void> => {
      const db = await openDB();
      return new Promise((resolve) => {
          if (!db.objectStoreNames.contains(STORE_HOTNEWS)) { resolve(); return; }
          const transaction = db.transaction(STORE_HOTNEWS, 'readwrite');
          const store = transaction.objectStore(STORE_HOTNEWS);
          const req = store.getAll();
          req.onsuccess = () => {
              const all = (req.result || []) as HotNewsSnapshot[];
              all.sort((a, b) => b.fetchedAt - a.fetchedAt);
              all.slice(keep).forEach(s => store.delete(s.id));
              resolve();
          };
          req.onerror = () => resolve();
      });
  },

  getScheduleCoverImage: async (charId: string): Promise<string | null> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          if (!db.objectStoreNames.contains(STORE_DAILY_SCHEDULE)) { resolve(null); return; }
          const transaction = db.transaction(STORE_DAILY_SCHEDULE, 'readonly');
          const store = transaction.objectStore(STORE_DAILY_SCHEDULE);
          const req = store.openCursor();
          req.onsuccess = () => {
              const cursor = req.result;
              if (cursor) {
                  const val = cursor.value as DailySchedule;
                  if (val.charId === charId && val.coverImage) {
                      resolve(val.coverImage);
                      return;
                  }
                  cursor.continue();
              } else {
                  resolve(null);
              }
          };
          req.onerror = () => reject(req.error);
      });
  },

  // ─── Handbook (手账) ───
  getHandbook: async (date: string): Promise<HandbookEntry | null> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          if (!db.objectStoreNames.contains(STORE_HANDBOOK)) { resolve(null); return; }
          const transaction = db.transaction(STORE_HANDBOOK, 'readonly');
          const store = transaction.objectStore(STORE_HANDBOOK);
          const req = store.get(date);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(req.error);
      });
  },

  getAllHandbooks: async (): Promise<HandbookEntry[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_HANDBOOK)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_HANDBOOK, 'readonly');
          const store = transaction.objectStore(STORE_HANDBOOK);
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error);
      });
  },

  saveHandbook: async (entry: HandbookEntry): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_HANDBOOK, 'readwrite');
      transaction.objectStore(STORE_HANDBOOK).put(entry);
  },

  deleteHandbook: async (date: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_HANDBOOK, 'readwrite');
      transaction.objectStore(STORE_HANDBOOK).delete(date);
  },

  // ─── Trackers (手账打卡引擎) ───
  getAllTrackers: async (): Promise<Tracker[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_TRACKERS)) return [];
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_TRACKERS, 'readonly');
          const req = tx.objectStore(STORE_TRACKERS).getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error);
      });
  },

  saveTracker: async (tracker: Tracker): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_TRACKERS, 'readwrite');
      tx.objectStore(STORE_TRACKERS).put(tracker);
  },

  deleteTracker: async (id: string): Promise<void> => {
      const db = await openDB();
      // 同时删掉该 tracker 的所有 entries
      const tx = db.transaction([STORE_TRACKERS, STORE_TRACKER_ENTRIES], 'readwrite');
      tx.objectStore(STORE_TRACKERS).delete(id);
      const teStore = tx.objectStore(STORE_TRACKER_ENTRIES);
      const idx = teStore.index('trackerId');
      const req = idx.openCursor(IDBKeyRange.only(id));
      req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) { cursor.delete(); cursor.continue(); }
      };
  },

  getTrackerEntriesByTracker: async (trackerId: string): Promise<TrackerEntry[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_TRACKER_ENTRIES)) return [];
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_TRACKER_ENTRIES, 'readonly');
          const idx = tx.objectStore(STORE_TRACKER_ENTRIES).index('trackerId');
          const req = idx.getAll(IDBKeyRange.only(trackerId));
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error);
      });
  },

  getTrackerEntry: async (trackerId: string, date: string): Promise<TrackerEntry | null> => {
      // 复合查询:用 tracker 索引,客户端再过滤 date(简单且足够快)
      const all = await DB.getTrackerEntriesByTracker(trackerId);
      return all.find(e => e.date === date) || null;
  },

  saveTrackerEntry: async (entry: TrackerEntry): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_TRACKER_ENTRIES, 'readwrite');
      tx.objectStore(STORE_TRACKER_ENTRIES).put(entry);
  },

  deleteTrackerEntry: async (id: string): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_TRACKER_ENTRIES, 'readwrite');
      tx.objectStore(STORE_TRACKER_ENTRIES).delete(id);
  },

  getAllCourses: async (): Promise<StudyCourse[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_COURSES)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_COURSES, 'readonly');
          const store = transaction.objectStore(STORE_COURSES);
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveCourse: async (course: StudyCourse): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_COURSES, 'readwrite');
      transaction.objectStore(STORE_COURSES).put(course);
  },

  deleteCourse: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_COURSES, 'readwrite');
      transaction.objectStore(STORE_COURSES).delete(id);
  },

  // --- Quiz / Practice Book ---
  getAllQuizzes: async (): Promise<QuizSession[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_QUIZZES)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_QUIZZES, 'readonly');
          const store = transaction.objectStore(STORE_QUIZZES);
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveQuiz: async (quiz: QuizSession): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_QUIZZES, 'readwrite');
      transaction.objectStore(STORE_QUIZZES).put(quiz);
  },

  deleteQuiz: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_QUIZZES, 'readwrite');
      transaction.objectStore(STORE_QUIZZES).delete(id);
  },

  getAllGames: async (): Promise<GameSession[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_GAMES)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_GAMES, 'readonly');
          const store = transaction.objectStore(STORE_GAMES);
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveGame: async (game: GameSession): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_GAMES, 'readwrite');
      transaction.objectStore(STORE_GAMES).put(game);
  },

  deleteGame: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_GAMES, 'readwrite');
      transaction.objectStore(STORE_GAMES).delete(id);
  },

  getAllWorldbooks: async (): Promise<Worldbook[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_WORLDBOOKS)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_WORLDBOOKS, 'readonly');
          const store = transaction.objectStore(STORE_WORLDBOOKS);
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveWorldbook: async (book: Worldbook): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_WORLDBOOKS, 'readwrite');
      transaction.objectStore(STORE_WORLDBOOKS).put(book);
  },

  deleteWorldbook: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_WORLDBOOKS, 'readwrite');
      transaction.objectStore(STORE_WORLDBOOKS).delete(id);
  },

  // ─── 预设 App（SillyTavern 式 Chat Completion 预设） ───
  getAllPresets: async (): Promise<TavernPreset[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_LLM_PRESETS)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_LLM_PRESETS, 'readonly');
          const request = transaction.objectStore(STORE_LLM_PRESETS).getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  getPreset: async (id: string): Promise<TavernPreset | null> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_LLM_PRESETS)) return null;
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_LLM_PRESETS, 'readonly');
          const request = transaction.objectStore(STORE_LLM_PRESETS).get(id);
          request.onsuccess = () => resolve(request.result || null);
          request.onerror = () => reject(request.error);
      });
  },

  savePreset: async (preset: TavernPreset): Promise<void> => {
      const db = await openDB();
      // 等事务提交再 resolve —— 发消息前 PresetRuntime 会立刻重读，避免拿到旧值
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_LLM_PRESETS, 'readwrite');
          transaction.objectStore(STORE_LLM_PRESETS).put(preset);
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error || new Error('savePreset aborted'));
      });
  },

  deletePreset: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_LLM_PRESETS, 'readwrite');
      transaction.objectStore(STORE_LLM_PRESETS).delete(id);
  },

  // ===== 人设（Persona）CRUD =====

  getAllPersonas: async (): Promise<Persona[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_PERSONAS)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_PERSONAS, 'readonly');
          const request = transaction.objectStore(STORE_PERSONAS).getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  getPersona: async (id: string): Promise<Persona | null> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_PERSONAS)) return null;
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_PERSONAS, 'readonly');
          const request = transaction.objectStore(STORE_PERSONAS).get(id);
          request.onsuccess = () => resolve(request.result || null);
          request.onerror = () => reject(request.error);
      });
  },

  savePersona: async (persona: Persona): Promise<void> => {
      const db = await openDB();
      // 等事务提交再 resolve —— 发消息前 PersonaRuntime 会立刻重读，避免拿到旧值
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_PERSONAS, 'readwrite');
          transaction.objectStore(STORE_PERSONAS).put(persona);
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error || new Error('savePersona aborted'));
      });
  },

  deletePersona: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_PERSONAS, 'readwrite');
      transaction.objectStore(STORE_PERSONAS).delete(id);
  },

  getAllNovels: async (): Promise<NovelBook[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_NOVELS)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_NOVELS, 'readonly');
          const store = transaction.objectStore(STORE_NOVELS);
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveNovel: async (novel: NovelBook): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_NOVELS, 'readwrite');
      transaction.objectStore(STORE_NOVELS).put(novel);
  },

  deleteNovel: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_NOVELS, 'readwrite');
      transaction.objectStore(STORE_NOVELS).delete(id);
  },

  // --- CoView App ---
  getCoViewMedia: async (): Promise<CoViewMedia[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_COVIEW_MEDIA)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_COVIEW_MEDIA, 'readonly');
          const request = transaction.objectStore(STORE_COVIEW_MEDIA).getAll();
          request.onsuccess = () => {
              const rows = (request.result || []) as CoViewMedia[];
              rows.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
              resolve(rows);
          };
          request.onerror = () => reject(request.error);
      });
  },

  getCoViewMediaById: async (id: string): Promise<CoViewMedia | null> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_COVIEW_MEDIA)) return null;
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_COVIEW_MEDIA, 'readonly');
          const request = transaction.objectStore(STORE_COVIEW_MEDIA).get(id);
          request.onsuccess = () => resolve(request.result || null);
          request.onerror = () => reject(request.error);
      });
  },

  saveCoViewMedia: async (media: CoViewMedia): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_COVIEW_MEDIA, 'readwrite');
      transaction.objectStore(STORE_COVIEW_MEDIA).put(media);
  },

  deleteCoViewMedia: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_COVIEW_MEDIA, 'readwrite');
      transaction.objectStore(STORE_COVIEW_MEDIA).delete(id);
  },

  getCoViewBooks: async (): Promise<CoViewBook[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_COVIEW_BOOKS)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_COVIEW_BOOKS, 'readonly');
          const request = transaction.objectStore(STORE_COVIEW_BOOKS).getAll();
          request.onsuccess = () => {
              const rows = (request.result || []) as CoViewBook[];
              rows.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
              resolve(rows);
          };
          request.onerror = () => reject(request.error);
      });
  },

  saveCoViewBook: async (book: CoViewBook): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_COVIEW_BOOKS, 'readwrite');
      transaction.objectStore(STORE_COVIEW_BOOKS).put(book);
  },

  deleteCoViewBook: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_COVIEW_BOOKS, 'readwrite');
      transaction.objectStore(STORE_COVIEW_BOOKS).delete(id);
  },

  getCoViewSessions: async (): Promise<CoViewSession[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_COVIEW_SESSIONS)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_COVIEW_SESSIONS, 'readonly');
          const request = transaction.objectStore(STORE_COVIEW_SESSIONS).getAll();
          request.onsuccess = () => {
              const rows = (request.result || []) as CoViewSession[];
              rows.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
              resolve(rows);
          };
          request.onerror = () => reject(request.error);
      });
  },

  saveCoViewSession: async (session: CoViewSession): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_COVIEW_SESSIONS, 'readwrite');
      transaction.objectStore(STORE_COVIEW_SESSIONS).put(session);
  },

  deleteCoViewSession: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_COVIEW_SESSIONS, 'readwrite');
      transaction.objectStore(STORE_COVIEW_SESSIONS).delete(id);
  },

  getCoViewMessages: async (sessionId: string): Promise<CoViewMessage[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_COVIEW_MESSAGES)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_COVIEW_MESSAGES, 'readonly');
          const store = transaction.objectStore(STORE_COVIEW_MESSAGES);
          const index = store.index('sessionId');
          const request = index.getAll(IDBKeyRange.only(sessionId));
          request.onsuccess = () => {
              const rows = (request.result || []) as CoViewMessage[];
              rows.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
              resolve(rows);
          };
          request.onerror = () => reject(request.error);
      });
  },

  saveCoViewMessage: async (message: CoViewMessage): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_COVIEW_MESSAGES, 'readwrite');
      transaction.objectStore(STORE_COVIEW_MESSAGES).put(message);
  },

  clearCoViewMessages: async (sessionId: string): Promise<void> => {
      const rows = await DB.getCoViewMessages(sessionId);
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_COVIEW_MESSAGES, 'readwrite');
          const store = transaction.objectStore(STORE_COVIEW_MESSAGES);
          rows.forEach(row => store.delete(row.id));
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
      });
  },

  deleteCoViewSessionsByCharId: async (charId: string): Promise<number> => {
      const sessions = (await DB.getCoViewSessions()).filter(session => session.charId === charId);
      if (sessions.length === 0) return 0;
      await Promise.all(sessions.map(session => DB.clearCoViewMessages(session.id).catch(() => undefined)));
      const db = await openDB();
      return new Promise((resolve, reject) => {
          if (!db.objectStoreNames.contains(STORE_COVIEW_SESSIONS)) {
              resolve(0);
              return;
          }
          const tx = db.transaction(STORE_COVIEW_SESSIONS, 'readwrite');
          const store = tx.objectStore(STORE_COVIEW_SESSIONS);
          sessions.forEach(session => store.delete(session.id));
          tx.oncomplete = () => resolve(sessions.length);
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
      });
  },

  // --- VR World 「页外」 全局小说库 ---
  getVRNovels: async (): Promise<VRWorldNovel[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_VR_NOVELS)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_VR_NOVELS, 'readonly');
          const request = transaction.objectStore(STORE_VR_NOVELS).getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveVRNovel: async (novel: VRWorldNovel): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_VR_NOVELS, 'readwrite');
      transaction.objectStore(STORE_VR_NOVELS).put(novel);
  },

  deleteVRNovel: async (id: string): Promise<void> => {
      const db = await openDB();
      // 删书时连带删掉这本书的全部批注
      const annIds: string[] = await new Promise((resolve) => {
          if (!db.objectStoreNames.contains(STORE_VR_ANNOTATIONS)) return resolve([]);
          const tx = db.transaction(STORE_VR_ANNOTATIONS, 'readonly');
          const idx = tx.objectStore(STORE_VR_ANNOTATIONS).index('novelId');
          const req = idx.getAll(id);
          req.onsuccess = () => resolve((req.result || []).map((a: VRNovelAnnotation) => a.id));
          req.onerror = () => resolve([]);
      });
      const tx = db.transaction([STORE_VR_NOVELS, STORE_VR_ANNOTATIONS], 'readwrite');
      tx.objectStore(STORE_VR_NOVELS).delete(id);
      const annStore = tx.objectStore(STORE_VR_ANNOTATIONS);
      for (const aid of annIds) annStore.delete(aid);
  },

  // --- VR World 小说批注 ---
  getVRAnnotations: async (novelId?: string): Promise<VRNovelAnnotation[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_VR_ANNOTATIONS)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_VR_ANNOTATIONS, 'readonly');
          const store = transaction.objectStore(STORE_VR_ANNOTATIONS);
          const request = novelId ? store.index('novelId').getAll(novelId) : store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveVRAnnotation: async (annotation: VRNovelAnnotation): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_VR_ANNOTATIONS, 'readwrite');
      transaction.objectStore(STORE_VR_ANNOTATIONS).put(annotation);
  },

  deleteVRAnnotation: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_VR_ANNOTATIONS, 'readwrite');
      transaction.objectStore(STORE_VR_ANNOTATIONS).delete(id);
  },

  // --- 捏脸系统自定义部件 ---
  getCustomCreatorParts: async (): Promise<CustomCreatorPart[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_CC_PARTS)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_CC_PARTS, 'readonly');
          const request = transaction.objectStore(STORE_CC_PARTS).getAll();
          request.onsuccess = () => resolve((request.result || []).sort((a: CustomCreatorPart, b: CustomCreatorPart) => a.createdAt - b.createdAt));
          request.onerror = () => reject(request.error);
      });
  },

  saveCustomCreatorPart: async (part: CustomCreatorPart): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_CC_PARTS, 'readwrite');
      transaction.objectStore(STORE_CC_PARTS).put(part);
  },

  deleteCustomCreatorPart: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_CC_PARTS, 'readwrite');
      transaction.objectStore(STORE_CC_PARTS).delete(id);
  },

  // --- 听歌房共享状态（单例 id='state'） ---
  getVRMusicRoom: async (): Promise<VRMusicRoomState | null> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_VR_MUSIC)) return null;
      return new Promise((resolve) => {
          const transaction = db.transaction(STORE_VR_MUSIC, 'readonly');
          const request = transaction.objectStore(STORE_VR_MUSIC).get('state');
          request.onsuccess = () => resolve(request.result || null);
          request.onerror = () => resolve(null);
      });
  },

  saveVRMusicRoom: async (state: VRMusicRoomState): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_VR_MUSIC, 'readwrite');
      transaction.objectStore(STORE_VR_MUSIC).put({ ...state, id: 'state' });
  },

  // --- 留言簿共享状态（单例 id='board'） ---
  getVRGuestbook: async (): Promise<VRGuestbookState | null> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_VR_GUESTBOOK)) return null;
      return new Promise((resolve) => {
          const transaction = db.transaction(STORE_VR_GUESTBOOK, 'readonly');
          const request = transaction.objectStore(STORE_VR_GUESTBOOK).get('board');
          request.onsuccess = () => resolve(request.result || null);
          request.onerror = () => resolve(null);
      });
  },

  saveVRGuestbook: async (state: VRGuestbookState): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_VR_GUESTBOOK, 'readwrite');
      // 只保留最近 200 条
      const messages = (state.messages || []).slice(-200);
      transaction.objectStore(STORE_VR_GUESTBOOK).put({ ...state, id: 'board', messages });
  },

  // --- 剧院·投稿剧本库 ---
  getVRScripts: async (): Promise<VRScript[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_VR_SCRIPTS)) return [];
      return new Promise((resolve) => {
          const request = db.transaction(STORE_VR_SCRIPTS, 'readonly').objectStore(STORE_VR_SCRIPTS).getAll();
          request.onsuccess = () => resolve((request.result || []).sort((a: VRScript, b: VRScript) => b.createdAt - a.createdAt));
          request.onerror = () => resolve([]);
      });
  },
  saveVRScript: async (script: VRScript): Promise<void> => {
      const db = await openDB();
      db.transaction(STORE_VR_SCRIPTS, 'readwrite').objectStore(STORE_VR_SCRIPTS).put(script);
  },
  deleteVRScript: async (id: string): Promise<void> => {
      const db = await openDB();
      db.transaction(STORE_VR_SCRIPTS, 'readwrite').objectStore(STORE_VR_SCRIPTS).delete(id);
  },

  // --- 剧院·历史舞台剧 ---
  getVRStagedPlays: async (): Promise<VRStagedPlay[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_VR_PLAYS)) return [];
      return new Promise((resolve) => {
          const request = db.transaction(STORE_VR_PLAYS, 'readonly').objectStore(STORE_VR_PLAYS).getAll();
          request.onsuccess = () => resolve((request.result || []).sort((a: VRStagedPlay, b: VRStagedPlay) => b.createdAt - a.createdAt));
          request.onerror = () => resolve([]);
      });
  },
  saveVRStagedPlay: async (play: VRStagedPlay): Promise<void> => {
      const db = await openDB();
      db.transaction(STORE_VR_PLAYS, 'readwrite').objectStore(STORE_VR_PLAYS).put(play);
  },
  deleteVRStagedPlay: async (id: string): Promise<void> => {
      const db = await openDB();
      db.transaction(STORE_VR_PLAYS, 'readwrite').objectStore(STORE_VR_PLAYS).delete(id);
  },

  // --- 剧院·用户自定义写作风格预设 ---
  getVRPresets: async (): Promise<any[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_VR_PRESETS)) return [];
      return new Promise((resolve) => {
          const request = db.transaction(STORE_VR_PRESETS, 'readonly').objectStore(STORE_VR_PRESETS).getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => resolve([]);
      });
  },
  saveVRPreset: async (preset: { key: string; name: string; prompt: string; blurb?: string }): Promise<void> => {
      const db = await openDB();
      db.transaction(STORE_VR_PRESETS, 'readwrite').objectStore(STORE_VR_PRESETS).put(preset);
  },
  deleteVRPreset: async (key: string): Promise<void> => {
      const db = await openDB();
      db.transaction(STORE_VR_PRESETS, 'readwrite').objectStore(STORE_VR_PRESETS).delete(key);
  },

  // --- 邮局信件 ---
  getVRLetters: async (): Promise<VRLetter[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_VR_LETTERS)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_VR_LETTERS, 'readonly');
          const request = transaction.objectStore(STORE_VR_LETTERS).getAll();
          request.onsuccess = () => resolve((request.result || []).sort((a: VRLetter, b: VRLetter) => b.createdAt - a.createdAt));
          request.onerror = () => reject(request.error);
      });
  },

  saveVRLetter: async (letter: VRLetter): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_VR_LETTERS, 'readwrite');
      transaction.objectStore(STORE_VR_LETTERS).put(letter);
  },

  saveVRLetters: async (letters: VRLetter[]): Promise<void> => {
      if (letters.length === 0) return;
      const db = await openDB();
      const transaction = db.transaction(STORE_VR_LETTERS, 'readwrite');
      const store = transaction.objectStore(STORE_VR_LETTERS);
      for (const l of letters) store.put(l);
      return new Promise((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
      });
  },

  deleteVRLetter: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_VR_LETTERS, 'readwrite');
      transaction.objectStore(STORE_VR_LETTERS).delete(id);
  },

  // --- 页外独立 API + 调用记录（vr_settings 单例 store）---
  getVRApiConfig: async (): Promise<any | null> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_VR_SETTINGS)) return null;
      return new Promise((resolve) => {
          const tx = db.transaction(STORE_VR_SETTINGS, 'readonly');
          const req = tx.objectStore(STORE_VR_SETTINGS).get('api');
          req.onsuccess = () => resolve(req.result?.config ?? null);
          req.onerror = () => resolve(null);
      });
  },

  saveVRApiConfig: async (config: any | null): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_VR_SETTINGS, 'readwrite');
      tx.objectStore(STORE_VR_SETTINGS).put({ id: 'api', config: config ?? null });
  },

  getVRApiLog: async (): Promise<any[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_VR_SETTINGS)) return [];
      return new Promise((resolve) => {
          const tx = db.transaction(STORE_VR_SETTINGS, 'readonly');
          const req = tx.objectStore(STORE_VR_SETTINGS).get('apilog');
          req.onsuccess = () => resolve(req.result?.entries ?? []);
          req.onerror = () => resolve([]);
      });
  },

  setVRApiLog: async (entries: any[]): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_VR_SETTINGS, 'readwrite');
      tx.objectStore(STORE_VR_SETTINGS).put({ id: 'apilog', entries: (entries || []).slice(0, 120) });
  },

  appendVRApiLog: async (entry: any): Promise<void> => {
      const db = await openDB();
      const read = (): Promise<any[]> => new Promise((resolve) => {
          const tx = db.transaction(STORE_VR_SETTINGS, 'readonly');
          const req = tx.objectStore(STORE_VR_SETTINGS).get('apilog');
          req.onsuccess = () => resolve(req.result?.entries ?? []);
          req.onerror = () => resolve([]);
      });
      const cur = await read();
      cur.unshift(entry);
      const tx = db.transaction(STORE_VR_SETTINGS, 'readwrite');
      tx.objectStore(STORE_VR_SETTINGS).put({ id: 'apilog', entries: cur.slice(0, 120) });
  },

  clearVRApiLog: async (): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_VR_SETTINGS, 'readwrite');
      tx.objectStore(STORE_VR_SETTINGS).put({ id: 'apilog', entries: [] });
  },

  // --- 全局 API 后台流水（api_call_log 单例 store，id='log'）---
  // 只保留近 5 天的记录，超期在写入时丢弃。读出时再过滤一次兜底。
  getApiCallLog: async (): Promise<any[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_API_CALL_LOG)) return [];
      return new Promise((resolve) => {
          const tx = db.transaction(STORE_API_CALL_LOG, 'readonly');
          const req = tx.objectStore(STORE_API_CALL_LOG).get('log');
          req.onsuccess = () => {
              const entries: any[] = req.result?.entries ?? [];
              const cutoff = Date.now() - API_CALL_LOG_MAX_AGE_MS;
              resolve(entries.filter((e) => (e?.timestamp ?? 0) > cutoff));
          };
          req.onerror = () => resolve([]);
      });
  },

  appendApiCallLog: async (entry: any): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_API_CALL_LOG)) return;
      const read = (): Promise<any[]> => new Promise((resolve) => {
          const tx = db.transaction(STORE_API_CALL_LOG, 'readonly');
          const req = tx.objectStore(STORE_API_CALL_LOG).get('log');
          req.onsuccess = () => resolve(req.result?.entries ?? []);
          req.onerror = () => resolve([]);
      });
      const cur = await read();
      cur.unshift(entry);
      const cutoff = Date.now() - API_CALL_LOG_MAX_AGE_MS;
      const pruned = cur
          .filter((e) => (e?.timestamp ?? 0) > cutoff)
          .slice(0, API_CALL_LOG_MAX_ENTRIES);
      const tx = db.transaction(STORE_API_CALL_LOG, 'readwrite');
      tx.objectStore(STORE_API_CALL_LOG).put({ id: 'log', entries: pruned });
  },

  clearApiCallLog: async (): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_API_CALL_LOG)) return;
      const tx = db.transaction(STORE_API_CALL_LOG, 'readwrite');
      tx.objectStore(STORE_API_CALL_LOG).put({ id: 'log', entries: [] });
  },

  // 导入备份用：直接写回一条 vr_settings 原始记录（{id, ...}）。
  saveVRSettingRecord: async (record: any): Promise<void> => {
      if (!record || !record.id) return;
      const db = await openDB();
      const tx = db.transaction(STORE_VR_SETTINGS, 'readwrite');
      tx.objectStore(STORE_VR_SETTINGS).put(record);
  },

  // --- BANK / PET APP LOGIC ---
  getBankState: async (): Promise<BankFullState | null> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          if (!db.objectStoreNames.contains(STORE_BANK_DATA)) { resolve(null); return; }
          const transaction = db.transaction(STORE_BANK_DATA, 'readonly');
          const store = transaction.objectStore(STORE_BANK_DATA);
          const req = store.get('main_state');
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(req.error);
      });
  },

  saveBankState: async (state: BankFullState): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_BANK_DATA, 'readwrite');
      // Strip dollhouse from the main state save (dollhouse is saved separately)
      const stripShopDollhouse = (shop: any) => {
          const { dollhouse: _dh, ...shopWithoutDollhouse } = (shop || {}) as any;
          return shopWithoutDollhouse;
      };
      const cleanPortfolio = state.shopPortfolio ? {
          ...state.shopPortfolio,
          branches: (state.shopPortfolio.branches || []).map(branch => ({
              ...branch,
              shop: stripShopDollhouse(branch.shop),
          })),
      } : state.shopPortfolio;
      const cleanState = { ...state, shop: stripShopDollhouse(state.shop), shopPortfolio: cleanPortfolio };
      transaction.objectStore(STORE_BANK_DATA).put({ ...cleanState, id: 'main_state' });
      return new Promise((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
      });
  },

  // Dollhouse state saved separately (same pattern as RoomApp's per-character roomConfig)
  getBankDollhouse: async (): Promise<DollhouseState | null> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          if (!db.objectStoreNames.contains(STORE_BANK_DATA)) { resolve(null); return; }
          const transaction = db.transaction(STORE_BANK_DATA, 'readonly');
          const store = transaction.objectStore(STORE_BANK_DATA);
          const req = store.get('dollhouse_state');
          req.onsuccess = () => resolve(req.result?.data || null);
          req.onerror = () => reject(req.error);
      });
  },

  saveBankDollhouse: async (state: DollhouseState): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_BANK_DATA, 'readwrite');
      transaction.objectStore(STORE_BANK_DATA).put({ id: 'dollhouse_state', data: state });
      return new Promise((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
      });
  },

  getBankDollhouses: async (): Promise<BankDollhousesByShopId | null> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          if (!db.objectStoreNames.contains(STORE_BANK_DATA)) { resolve(null); return; }
          const transaction = db.transaction(STORE_BANK_DATA, 'readonly');
          const store = transaction.objectStore(STORE_BANK_DATA);
          const req = store.get('dollhouses_by_shop');
          req.onsuccess = () => resolve(req.result?.data || null);
          req.onerror = () => reject(req.error);
      });
  },

  saveBankDollhouses: async (state: BankDollhousesByShopId): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_BANK_DATA, 'readwrite');
      transaction.objectStore(STORE_BANK_DATA).put({ id: 'dollhouses_by_shop', data: state });
      return new Promise((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
      });
  },

  getAllTransactions: async (): Promise<BankTransaction[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_BANK_TX)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_BANK_TX, 'readonly');
          const store = transaction.objectStore(STORE_BANK_TX);
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveTransaction: async (txData: BankTransaction): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_BANK_TX, 'readwrite');
      transaction.objectStore(STORE_BANK_TX).put(txData);
  },

  deleteTransaction: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_BANK_TX, 'readwrite');
      transaction.objectStore(STORE_BANK_TX).delete(id);
  },

  // --- Songs (Songwriting App) ---
  getAllSongs: async (): Promise<SongSheet[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_SONGS)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_SONGS, 'readonly');
          const store = transaction.objectStore(STORE_SONGS);
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveSong: async (song: SongSheet): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_SONGS, 'readwrite');
      transaction.objectStore(STORE_SONGS).put(song);
  },

  deleteSong: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_SONGS, 'readwrite');
      transaction.objectStore(STORE_SONGS).delete(id);
  },

  deleteSongsByCollaboratorId: async (charId: string): Promise<number> => {
      const songs = (await DB.getAllSongs()).filter(song => song.collaboratorId === charId);
      if (songs.length === 0) return 0;
      const db = await openDB();
      await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_SONGS, 'readwrite');
          const store = tx.objectStore(STORE_SONGS);
          songs.forEach(song => store.delete(song.id));
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
      });
      await Promise.all(songs.map(song => (
          song.audio?.assetKey ? DB.deleteAsset(song.audio.assetKey).catch(() => undefined) : Promise.resolve()
      )));
      return songs.length;
  },

  // --- Music Library (Music App) ---
  getAllMusicTracks: () => getAllStoreItems<MusicLibraryTrack>(STORE_MUSIC_TRACKS),
  getMusicTrack: (id: string) => getStoreItem<MusicLibraryTrack>(STORE_MUSIC_TRACKS, id),
  saveMusicTrack: (track: MusicLibraryTrack) => putStoreItem(STORE_MUSIC_TRACKS, track),
  deleteMusicTrack: (id: string) => deleteStoreItem(STORE_MUSIC_TRACKS, id),

  getAllMusicPlaylists: () => getAllStoreItems<MusicLibraryPlaylist>(STORE_MUSIC_PLAYLISTS),
  getMusicPlaylist: (id: string) => getStoreItem<MusicLibraryPlaylist>(STORE_MUSIC_PLAYLISTS, id),
  saveMusicPlaylist: (playlist: MusicLibraryPlaylist) => putStoreItem(STORE_MUSIC_PLAYLISTS, playlist),
  deleteMusicPlaylist: (id: string) => deleteStoreItem(STORE_MUSIC_PLAYLISTS, id),

  getAllMusicPlaylistItems: () => getAllStoreItems<MusicPlaylistItem>(STORE_MUSIC_PLAYLIST_ITEMS),
  saveMusicPlaylistItem: (item: MusicPlaylistItem) => putStoreItem(STORE_MUSIC_PLAYLIST_ITEMS, item),
  deleteMusicPlaylistItem: (id: string) => deleteStoreItem(STORE_MUSIC_PLAYLIST_ITEMS, id),

  getAllMusicPlayEvents: () => getAllStoreItems<MusicPlayEvent>(STORE_MUSIC_PLAY_EVENTS),
  saveMusicPlayEvent: (event: MusicPlayEvent) => putStoreItem(STORE_MUSIC_PLAY_EVENTS, event),
  deleteMusicPlayEvent: (id: string) => deleteStoreItem(STORE_MUSIC_PLAY_EVENTS, id),

  getAllMusicSearchHistory: () => getAllStoreItems<MusicSearchHistoryItem>(STORE_MUSIC_SEARCH_HISTORY),
  saveMusicSearchHistoryItem: (item: MusicSearchHistoryItem) => putStoreItem(STORE_MUSIC_SEARCH_HISTORY, item),
  deleteMusicSearchHistoryItem: (id: string) => deleteStoreItem(STORE_MUSIC_SEARCH_HISTORY, id),

  getAllMusicRecommendCache: () => getAllStoreItems<MusicRecommendCacheEntry>(STORE_MUSIC_RECOMMEND_CACHE),
  saveMusicRecommendCache: (entry: MusicRecommendCacheEntry) => putStoreItem(STORE_MUSIC_RECOMMEND_CACHE, entry),
  deleteMusicRecommendCache: (id: string) => deleteStoreItem(STORE_MUSIC_RECOMMEND_CACHE, id),

  // --- Guidebook (攻略本) ---
  getAllGuidebookSessions: async (): Promise<GuidebookSession[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_GUIDEBOOK)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_GUIDEBOOK, 'readonly');
          const store = transaction.objectStore(STORE_GUIDEBOOK);
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveGuidebookSession: async (session: GuidebookSession): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_GUIDEBOOK, 'readwrite');
      transaction.objectStore(STORE_GUIDEBOOK).put(session);
  },

  deleteGuidebookSession: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_GUIDEBOOK, 'readwrite');
      transaction.objectStore(STORE_GUIDEBOOK).delete(id);
  },

  deleteGuidebookSessionsByCharId: async (charId: string): Promise<number> => {
      return DB.deleteByCursor(STORE_GUIDEBOOK, (session: GuidebookSession) => session?.charId === charId);
  },

  // ── LifeSim (模拟人生) ────────────────────────────────────
  getLifeSimState: async (): Promise<LifeSimState | null> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_LIFE_SIM)) return null;
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_LIFE_SIM, 'readonly');
          const request = transaction.objectStore(STORE_LIFE_SIM).get('main');
          request.onsuccess = () => resolve(request.result || null);
          request.onerror = () => reject(request.error);
      });
  },

  saveLifeSimState: async (state: LifeSimState): Promise<void> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_LIFE_SIM, 'readwrite');
          transaction.objectStore(STORE_LIFE_SIM).put({ ...state, id: 'main' });
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
      });
  },

  clearLifeSimState: async (): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_LIFE_SIM, 'readwrite');
      transaction.objectStore(STORE_LIFE_SIM).clear();
  },

  getDesktopPetState: async (): Promise<DesktopPetState | null> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_DESKTOP_PET)) return null;
      return new Promise((resolve) => {
          const transaction = db.transaction(STORE_DESKTOP_PET, 'readonly');
          const request = transaction.objectStore(STORE_DESKTOP_PET).get('main');
          request.onsuccess = () => resolve(request.result || null);
          request.onerror = () => resolve(null);
      });
  },

  saveDesktopPetState: async (state: DesktopPetState): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_DESKTOP_PET, 'readwrite');
      transaction.objectStore(STORE_DESKTOP_PET).put({ ...normalizeDesktopPetVisibleText(state), id: 'main' });
  },

  removeLifeSimCharacterContext: async (charId: string): Promise<number> => {
      const state = await DB.getLifeSimState();
      if (!state) return 0;
      let changed = false;
      const participantCharIds = Array.isArray(state.participantCharIds)
          ? state.participantCharIds.filter(id => id !== charId)
          : state.participantCharIds;
      if (participantCharIds !== state.participantCharIds) changed = true;
      const charQueue = Array.isArray(state.charQueue)
          ? state.charQueue.filter(id => id !== charId)
          : [];
      if (charQueue.length !== (state.charQueue?.length || 0)) changed = true;
      const replayPending = Array.isArray(state.replayPending)
          ? state.replayPending.filter(action => action?.actorId !== charId)
          : [];
      if (replayPending.length !== (state.replayPending?.length || 0)) changed = true;
      const actionLog = Array.isArray(state.actionLog)
          ? state.actionLog.filter(action => action?.actorId !== charId)
          : [];
      if (actionLog.length !== (state.actionLog?.length || 0)) changed = true;
      const currentActorId = state.currentActorId === charId ? 'user' : state.currentActorId;
      if (currentActorId !== state.currentActorId) changed = true;
      if (!changed) return 0;
      await DB.saveLifeSimState({
          ...state,
          participantCharIds,
          charQueue,
          replayPending,
          actionLog,
          currentActorId,
          isProcessingCharTurn: state.isProcessingCharTurn && currentActorId !== 'user',
      });
      return 1;
  },

  getRawStoreData: async (storeName: string): Promise<any[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(storeName)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(storeName, 'readonly');
          const store = transaction.objectStore(storeName);
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  getObjectStoreNames: async (): Promise<string[]> => {
      const db = await openDB();
      return listObjectStoreNames(db);
  },

  exportFullData: async (): Promise<Partial<FullBackupData>> => {
      const db = await openDB();
      
      const getAllFromStore = (storeName: string): Promise<any[]> => {
          if (!db.objectStoreNames.contains(storeName)) {
              return Promise.resolve([]);
          }
          return new Promise((resolve) => {
              const tx = db.transaction(storeName, 'readonly');
              const store = tx.objectStore(storeName);
              const req = store.getAll();
              req.onsuccess = () => resolve(req.result || []);
              req.onerror = () => resolve([]); 
          });
      };

      const [characters, messages, privateChatArchives, chatAlarms, chatFollowups, chatHubDigests, periodReminderSettings, periodCycleEvents, healthModuleSettings, healthRecords, healthReminders, healthPlans, healthSummaries, healthImportBatches, themes, emojis, emojiCategories, assets, galleryImages, userProfiles, diaries, tasks, anniversaries, roomTodos, roomNotes, groups, journalStickers, socialPosts, courses, games, worldbooks, novels, coviewMediaRaw, coviewBooks, coviewSessions, coviewMessages, bankTx, bankData, xhsActivities, xhsStockImages, xhsFeedPosts, twitterTweets, twitterNotifications, twitterProfileRecords, twitterAccounts, twitterDMThreads, twitterSearchRecords, songs, musicTracks, musicPlaylists, musicPlaylistItems, musicPlayEvents, musicSearchHistory, musicRecommendCache, quizzes, guidebookSessions, theaterQuizSessions, theaterFauxPieces, theaterCustomLibrary, theaterReflectionSessions, theaterSleepSessions, theaterGomokuGames, theaterGomokuInvitations, theaterGoGames, theaterGoInvitations, theaterDoudizhuGames, theaterDoudizhuInvitations, theaterTurtleSoupGames, theaterTurtleSoupInvitations, theaterMahjongGames, theaterMahjongInvitations, collectionItems, scheduledMessages, lifeSimStates, handbooks, trackers, trackerEntries, hotNewsSnapshots, vrNovels, vrAnnotations, customCreatorParts, vrMusic, vrGuestbook, vrScripts, vrStagedPlays, vrPresets, vrLetters, vrSettings, phoneCallLogs, phoneCheckSessions, userScreenWatchSessions, exchangeDiaryBooks, innerVoices, llmPresets, personas, desktopPetRecords, takeoutOrders] = await Promise.all([
          getAllFromStore(STORE_CHARACTERS),
          getAllFromStore(STORE_MESSAGES),
          getAllFromStore(STORE_PRIVATE_CHAT_ARCHIVES),
          getAllFromStore(STORE_CHAT_ALARMS),
          getAllFromStore(STORE_CHAT_FOLLOWUPS),
          getAllFromStore(STORE_CHAT_HUB_DIGESTS),
          getAllFromStore(STORE_PERIOD_REMINDER_SETTINGS),
          getAllFromStore(STORE_PERIOD_CYCLE_EVENTS),
          getAllFromStore(STORE_HEALTH_MODULE_SETTINGS),
          getAllFromStore(STORE_HEALTH_RECORDS),
          getAllFromStore(STORE_HEALTH_REMINDERS),
          getAllFromStore(STORE_HEALTH_PLANS),
          getAllFromStore(STORE_HEALTH_SUMMARIES),
          getAllFromStore(STORE_HEALTH_IMPORT_BATCHES),
          getAllFromStore(STORE_THEMES),
          getAllFromStore(STORE_EMOJIS),
          getAllFromStore(STORE_EMOJI_CATEGORIES),
          getAllFromStore(STORE_ASSETS),
          getAllFromStore(STORE_GALLERY),
          getAllFromStore(STORE_USER),
          getAllFromStore(STORE_DIARIES),
          getAllFromStore(STORE_TASKS),
          getAllFromStore(STORE_ANNIVERSARIES),
          getAllFromStore(STORE_ROOM_TODOS),
          getAllFromStore(STORE_ROOM_NOTES),
          getAllFromStore(STORE_GROUPS),
          getAllFromStore(STORE_JOURNAL_STICKERS),
          getAllFromStore(STORE_SOCIAL_POSTS),
          getAllFromStore(STORE_COURSES),
          getAllFromStore(STORE_GAMES),
          getAllFromStore(STORE_WORLDBOOKS),
          getAllFromStore(STORE_NOVELS),
          getAllFromStore(STORE_COVIEW_MEDIA),
          getAllFromStore(STORE_COVIEW_BOOKS),
          getAllFromStore(STORE_COVIEW_SESSIONS),
          getAllFromStore(STORE_COVIEW_MESSAGES),
          getAllFromStore(STORE_BANK_TX),
          getAllFromStore(STORE_BANK_DATA),
          getAllFromStore(STORE_XHS_ACTIVITIES),
          getAllFromStore(STORE_XHS_STOCK),
          getAllFromStore(STORE_XHS_FEED),
          getAllFromStore(STORE_TWITTER_TWEETS),
          getAllFromStore(STORE_TWITTER_NOTIFS),
          getAllFromStore(STORE_TWITTER_PROFILE),
          getAllFromStore(STORE_TWITTER_ACCOUNTS),
          getAllFromStore(STORE_TWITTER_DM),
          getAllFromStore(STORE_TWITTER_SEARCH),
          getAllFromStore(STORE_SONGS),
          getAllFromStore(STORE_MUSIC_TRACKS),
          getAllFromStore(STORE_MUSIC_PLAYLISTS),
          getAllFromStore(STORE_MUSIC_PLAYLIST_ITEMS),
          getAllFromStore(STORE_MUSIC_PLAY_EVENTS),
          getAllFromStore(STORE_MUSIC_SEARCH_HISTORY),
          getAllFromStore(STORE_MUSIC_RECOMMEND_CACHE),
          getAllFromStore(STORE_QUIZZES),
          getAllFromStore(STORE_GUIDEBOOK),
          getAllFromStore(STORE_THEATER_QUIZ_SESSIONS),
          getAllFromStore(STORE_THEATER_FAUX_PIECES),
          getAllFromStore(STORE_THEATER_CUSTOM_LIBRARY),
          getAllFromStore(STORE_THEATER_REFLECTION_SESSIONS),
          getAllFromStore(STORE_THEATER_SLEEP_SESSIONS),
          getAllFromStore(STORE_THEATER_GOMOKU_GAMES),
          getAllFromStore(STORE_THEATER_GOMOKU_INVITATIONS),
          getAllFromStore(STORE_THEATER_GO_GAMES),
          getAllFromStore(STORE_THEATER_GO_INVITATIONS),
          getAllFromStore(STORE_THEATER_DOUDIZHU_GAMES),
          getAllFromStore(STORE_THEATER_DOUDIZHU_INVITATIONS),
          getAllFromStore(STORE_THEATER_TURTLE_SOUP_GAMES),
          getAllFromStore(STORE_THEATER_TURTLE_SOUP_INVITATIONS),
          getAllFromStore(STORE_THEATER_MAHJONG_GAMES),
          getAllFromStore(STORE_THEATER_MAHJONG_INVITATIONS),
          getAllFromStore(STORE_COLLECTION_ITEMS),
          getAllFromStore(STORE_SCHEDULED),
          getAllFromStore(STORE_LIFE_SIM),
          getAllFromStore(STORE_HANDBOOK),
          getAllFromStore(STORE_TRACKERS),
          getAllFromStore(STORE_TRACKER_ENTRIES),
          getAllFromStore(STORE_HOTNEWS),
          getAllFromStore(STORE_VR_NOVELS),
          getAllFromStore(STORE_VR_ANNOTATIONS),
          getAllFromStore(STORE_CC_PARTS),
          getAllFromStore(STORE_VR_MUSIC),
          getAllFromStore(STORE_VR_GUESTBOOK),
          getAllFromStore(STORE_VR_SCRIPTS),
          getAllFromStore(STORE_VR_PLAYS),
          getAllFromStore(STORE_VR_PRESETS),
          getAllFromStore(STORE_VR_LETTERS),
          getAllFromStore(STORE_VR_SETTINGS),
          getAllFromStore(STORE_PHONE_CALL_LOGS),
          getAllFromStore(STORE_PHONE_CHECK_SESSIONS),
          getAllFromStore(STORE_USER_SCREEN_WATCH),
          getAllFromStore(STORE_EXCHANGE_DIARY),
          getAllFromStore(STORE_INNER_VOICES),
          getAllFromStore(STORE_LLM_PRESETS),
          getAllFromStore(STORE_PERSONAS),
          getAllFromStore(STORE_DESKTOP_PET),
          getAllFromStore(STORE_TAKEOUT_ORDERS),
      ]);

      const [relationshipNetworkEdges, relationshipNetworkMessages, relationshipNetworkAutoSettings] = await Promise.all([
          getAllFromStore(STORE_RELATIONSHIP_NETWORK_EDGES),
          getAllFromStore(STORE_RELATIONSHIP_NETWORK_MESSAGES),
          getAllFromStore(STORE_RELATIONSHIP_NETWORK_SETTINGS),
      ]);

      const structuredBackupStores = new Set([
          STORE_CHARACTERS, STORE_MESSAGES, STORE_PRIVATE_CHAT_ARCHIVES,
          STORE_CHAT_ALARMS, STORE_CHAT_FOLLOWUPS, STORE_CHAT_HUB_DIGESTS,
          STORE_PERIOD_REMINDER_SETTINGS, STORE_PERIOD_CYCLE_EVENTS,
          STORE_HEALTH_MODULE_SETTINGS, STORE_HEALTH_RECORDS, STORE_HEALTH_REMINDERS, STORE_HEALTH_PLANS, STORE_HEALTH_SUMMARIES, STORE_HEALTH_IMPORT_BATCHES,
          STORE_THEMES, STORE_EMOJIS, STORE_EMOJI_CATEGORIES, STORE_ASSETS, STORE_GALLERY, STORE_USER,
          STORE_DIARIES, STORE_TASKS, STORE_ANNIVERSARIES, STORE_ROOM_TODOS, STORE_ROOM_NOTES, STORE_GROUPS,
          STORE_JOURNAL_STICKERS, STORE_SOCIAL_POSTS, STORE_COURSES, STORE_GAMES, STORE_WORLDBOOKS, STORE_NOVELS,
          STORE_COVIEW_MEDIA, STORE_COVIEW_BOOKS, STORE_COVIEW_SESSIONS, STORE_COVIEW_MESSAGES,
          STORE_BANK_TX, STORE_BANK_DATA, STORE_XHS_ACTIVITIES, STORE_XHS_STOCK, STORE_XHS_FEED,
          STORE_TWITTER_TWEETS, STORE_TWITTER_NOTIFS, STORE_TWITTER_PROFILE, STORE_TWITTER_ACCOUNTS, STORE_TWITTER_DM, STORE_TWITTER_SEARCH,
          STORE_SONGS, STORE_MUSIC_TRACKS, STORE_MUSIC_PLAYLISTS, STORE_MUSIC_PLAYLIST_ITEMS, STORE_MUSIC_PLAY_EVENTS,
          STORE_MUSIC_SEARCH_HISTORY, STORE_MUSIC_RECOMMEND_CACHE, STORE_QUIZZES, STORE_GUIDEBOOK,
          STORE_THEATER_QUIZ_SESSIONS, STORE_THEATER_FAUX_PIECES, STORE_THEATER_CUSTOM_LIBRARY, STORE_THEATER_REFLECTION_SESSIONS, STORE_THEATER_SLEEP_SESSIONS,
          STORE_THEATER_GOMOKU_GAMES, STORE_THEATER_GOMOKU_INVITATIONS, STORE_THEATER_GO_GAMES, STORE_THEATER_GO_INVITATIONS, STORE_THEATER_DOUDIZHU_GAMES, STORE_THEATER_DOUDIZHU_INVITATIONS, STORE_THEATER_TURTLE_SOUP_GAMES, STORE_THEATER_TURTLE_SOUP_INVITATIONS, STORE_THEATER_MAHJONG_GAMES, STORE_THEATER_MAHJONG_INVITATIONS, STORE_COLLECTION_ITEMS,
          STORE_SCHEDULED, STORE_LIFE_SIM, STORE_HANDBOOK, STORE_TRACKERS, STORE_TRACKER_ENTRIES, STORE_HOTNEWS,
          STORE_VR_NOVELS, STORE_VR_ANNOTATIONS, STORE_CC_PARTS, STORE_VR_MUSIC, STORE_VR_GUESTBOOK,
          STORE_VR_SCRIPTS, STORE_VR_PLAYS, STORE_VR_PRESETS, STORE_VR_LETTERS, STORE_VR_SETTINGS,
          STORE_PHONE_CALL_LOGS, STORE_PHONE_CHECK_SESSIONS, STORE_USER_SCREEN_WATCH, STORE_EXCHANGE_DIARY, STORE_INNER_VOICES,
          STORE_LLM_PRESETS, STORE_PERSONAS, STORE_DESKTOP_PET, STORE_TAKEOUT_ORDERS,
          STORE_RELATIONSHIP_NETWORK_EDGES, STORE_RELATIONSHIP_NETWORK_MESSAGES, STORE_RELATIONSHIP_NETWORK_SETTINGS,
          'memory_nodes', 'memory_vectors', 'memory_links', 'topic_boxes', 'anticipations', 'event_boxes',
          'memory_batches', 'pixel_home_assets', 'pixel_home_layouts',
      ]);
      const indexedDbSnapshotEntries = await Promise.all(
          listObjectStoreNames(db)
              .filter(storeName => !structuredBackupStores.has(storeName))
              .map(async storeName => [storeName, await getAllFromStore(storeName)] as const)
      );
      const indexedDbSnapshot = Object.fromEntries(indexedDbSnapshotEntries);

      const userProfile = userProfiles.length > 0 ? {
          name: userProfiles[0].name,
          avatar: userProfiles[0].avatar,
          bio: userProfiles[0].bio
      } : undefined;

      const mainState = bankData.find((d: any) => d.id === 'main_state');
      const dollhouseRecord = bankData.find((d: any) => d.id === 'dollhouse_state');
      const dollhousesRecord = bankData.find((d: any) => d.id === 'dollhouses_by_shop');
      const coviewMedia = (coviewMediaRaw as CoViewMedia[]).map(({ blob: _blob, ...media }) => media as CoViewMedia);

      return {
          characters, messages, privateChatArchives, chatAlarms, chatFollowups, chatHubDigests, periodReminderSettings, periodCycleEvents, healthModuleSettings, healthRecords, healthReminders, healthPlans, healthSummaries, healthImportBatches, customThemes: themes, savedEmojis: emojis, emojiCategories, assets, galleryImages, userProfile, diaries, tasks, anniversaries, roomTodos, roomNotes, groups, savedJournalStickers: journalStickers, socialPosts, courses, games, worldbooks, novels, coviewMedia, coviewBooks, coviewSessions, coviewMessages,
          bankState: mainState ? { ...mainState, id: undefined } : undefined,
          bankDollhouse: dollhouseRecord?.data || undefined,
          bankDollhouses: dollhousesRecord?.data || undefined,
          bankTransactions: bankTx,
          xhsActivities,
          xhsStockImages,
          xhsFeedPosts,
          twitterTweets,
          twitterNotifications,
          twitterProfile: twitterProfileRecords[0] || undefined,
          twitterAccounts,
          twitterDMThreads,
          twitterSearchRecords,
          songs,
          musicTracks,
          musicPlaylists,
          musicPlaylistItems,
          musicPlayEvents,
          musicSearchHistory,
          musicRecommendCache,
          quizSessions: quizzes,
          guidebookSessions,
          theaterQuizSessions,
          theaterFauxPieces,
          theaterCustomLibrary,
          theaterReflectionSessions,
          theaterSleepSessions,
          theaterGomokuGames,
          theaterGomokuInvitations,
          theaterGoGames,
          theaterGoInvitations,
          theaterDoudizhuGames,
          theaterDoudizhuInvitations,
          theaterTurtleSoupGames,
          theaterTurtleSoupInvitations,
          theaterMahjongGames,
          theaterMahjongInvitations,
          collectionItems,
          scheduledMessages,
          lifeSimState: lifeSimStates[0] || null,
          handbooks,
          trackers,
          trackerEntries,
          hotNewsSnapshots,
          vrNovels,
          vrAnnotations,
          customCreatorParts,
          vrMusicRoom: vrMusic && vrMusic.length ? vrMusic[0] : undefined,
          vrGuestbook: vrGuestbook && vrGuestbook.length ? vrGuestbook[0] : undefined,
          vrScripts,
          vrStagedPlays,
          vrPresets,
          vrLetters,
          vrSettings,
          vrPostOffice: exportPostOfficeLocal(), // 邮局本机配置（身份/后端地址，存 localStorage）
          phoneCallLogs,
          phoneCheckSessions,
          userScreenWatchSessions,
          exchangeDiaryBooks,
          innerVoices,
          llmPresets,
          personas,
          desktopPetState: desktopPetRecords[0] || undefined,
          takeoutOrders,
          indexedDbSnapshot: Object.keys(indexedDbSnapshot).length > 0 ? indexedDbSnapshot : undefined,
          relationshipNetworkEdges,
          relationshipNetworkMessages,
          relationshipNetworkAutoSettings,
      };
  },

  importFullData: async (
      data: FullBackupData,
      options: {
          beforeWrite?: (root: any, label: string) => Promise<void>;
          onProgress?: (progress: {
              label: string;
              stage: 'start' | 'items' | 'done';
              sectionDone: number;
              sectionTotal: number;
              itemDone?: number;
              itemTotal?: number;
          }) => void;
      } = {}
  ): Promise<void> => {
      const db = await openDB();
      
      const knownImportStores = [
          STORE_CHARACTERS, STORE_MESSAGES, STORE_PRIVATE_CHAT_ARCHIVES, STORE_THEMES, STORE_EMOJIS, STORE_EMOJI_CATEGORIES,
          STORE_CHAT_ALARMS, STORE_CHAT_FOLLOWUPS, STORE_CHAT_HUB_DIGESTS, STORE_PERIOD_REMINDER_SETTINGS, STORE_PERIOD_CYCLE_EVENTS,
          STORE_HEALTH_MODULE_SETTINGS, STORE_HEALTH_RECORDS, STORE_HEALTH_REMINDERS, STORE_HEALTH_PLANS, STORE_HEALTH_SUMMARIES, STORE_HEALTH_IMPORT_BATCHES,
          STORE_ASSETS, STORE_GALLERY, STORE_USER, STORE_DIARIES,
          STORE_TASKS, STORE_ANNIVERSARIES, STORE_ROOM_TODOS, STORE_ROOM_NOTES,
          STORE_GROUPS, STORE_JOURNAL_STICKERS, STORE_SOCIAL_POSTS, STORE_COURSES, STORE_GAMES, STORE_WORLDBOOKS, STORE_NOVELS,
          STORE_COVIEW_MEDIA, STORE_COVIEW_BOOKS, STORE_COVIEW_SESSIONS, STORE_COVIEW_MESSAGES, STORE_SONGS,
          STORE_MUSIC_TRACKS, STORE_MUSIC_PLAYLISTS, STORE_MUSIC_PLAYLIST_ITEMS, STORE_MUSIC_PLAY_EVENTS,
          STORE_MUSIC_SEARCH_HISTORY, STORE_MUSIC_RECOMMEND_CACHE,
          STORE_BANK_TX, STORE_BANK_DATA,
          STORE_XHS_ACTIVITIES, STORE_XHS_STOCK, STORE_XHS_FEED, STORE_TWITTER_TWEETS, STORE_TWITTER_NOTIFS,
          STORE_TWITTER_PROFILE, STORE_TWITTER_ACCOUNTS, STORE_TWITTER_DM, STORE_TWITTER_SEARCH,
          STORE_QUIZZES,
          STORE_GUIDEBOOK,
          STORE_THEATER_QUIZ_SESSIONS,
          STORE_THEATER_FAUX_PIECES,
          STORE_THEATER_CUSTOM_LIBRARY,
          STORE_THEATER_REFLECTION_SESSIONS,
          STORE_THEATER_SLEEP_SESSIONS,
          STORE_THEATER_GOMOKU_GAMES,
          STORE_THEATER_GOMOKU_INVITATIONS,
          STORE_THEATER_GO_GAMES,
          STORE_THEATER_GO_INVITATIONS,
          STORE_THEATER_DOUDIZHU_GAMES,
          STORE_THEATER_DOUDIZHU_INVITATIONS,
          STORE_THEATER_TURTLE_SOUP_GAMES,
          STORE_THEATER_TURTLE_SOUP_INVITATIONS,
          STORE_THEATER_MAHJONG_GAMES,
          STORE_THEATER_MAHJONG_INVITATIONS,
          STORE_COLLECTION_ITEMS,
          STORE_SCHEDULED,
          STORE_LIFE_SIM,
          STORE_DAILY_SCHEDULE,
          STORE_HANDBOOK,
          STORE_TRACKERS,
          STORE_TRACKER_ENTRIES,
          STORE_HOTNEWS,
          STORE_VR_NOVELS, STORE_VR_ANNOTATIONS, STORE_CC_PARTS, STORE_VR_MUSIC, STORE_VR_GUESTBOOK, STORE_VR_SCRIPTS, STORE_VR_PLAYS, STORE_VR_PRESETS, STORE_VR_LETTERS, STORE_VR_SETTINGS,
          'memory_nodes', 'memory_vectors', 'memory_links', 'topic_boxes', 'anticipations', 'event_boxes',
          'memory_batches', 'pixel_home_assets', 'pixel_home_layouts',
          STORE_PHONE_CALL_LOGS, STORE_PHONE_CHECK_SESSIONS, STORE_USER_SCREEN_WATCH, STORE_EXCHANGE_DIARY, STORE_INNER_VOICES,
          STORE_LLM_PRESETS, STORE_PERSONAS, STORE_DESKTOP_PET, STORE_TAKEOUT_ORDERS,
          STORE_RELATIONSHIP_NETWORK_EDGES, STORE_RELATIONSHIP_NETWORK_MESSAGES, STORE_RELATIONSHIP_NETWORK_SETTINGS,
      ];
      const availableStores = Array.from(new Set([...knownImportStores, ...listObjectStoreNames(db)]))
          .filter(name => db.objectStoreNames.contains(name));

      const hasStore = (storeName: string) => availableStores.includes(storeName);

      const waitForTransaction = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
          tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
      });

      const withStore = async (storeName: string, writer: (store: IDBObjectStore) => void): Promise<void> => {
          if (!hasStore(storeName)) return;
          const tx = db.transaction(storeName, 'readwrite');
          try {
              writer(tx.objectStore(storeName));
          } catch (err) {
              try { tx.abort(); } catch { /* ignore */ }
              throw err;
          }
          await waitForTransaction(tx);
      };

      const getAllFromStore = async <T,>(storeName: string): Promise<T[]> => {
          if (!hasStore(storeName)) return [];
          return new Promise((resolve, reject) => {
              const tx = db.transaction(storeName, 'readonly');
              const request = tx.objectStore(storeName).getAll();
              request.onsuccess = () => resolve(request.result as T[]);
              request.onerror = () => reject(request.error || tx.error);
              tx.onerror = () => reject(tx.error || new Error('IndexedDB read failed'));
              tx.onabort = () => reject(tx.error || new Error('IndexedDB read aborted'));
          });
      };

      const plannedSections = [
          data.characters !== undefined || data.mediaAssets !== undefined,
          data.messages !== undefined,
          data.privateChatArchives !== undefined,
          data.chatAlarms !== undefined,
          data.chatFollowups !== undefined,
          data.chatHubDigests !== undefined,
          data.periodReminderSettings !== undefined,
          data.periodCycleEvents !== undefined,
          data.healthModuleSettings !== undefined,
          data.healthRecords !== undefined,
          data.healthReminders !== undefined,
          data.healthPlans !== undefined,
          data.healthSummaries !== undefined,
          data.healthImportBatches !== undefined,
          data.customThemes !== undefined,
          data.savedEmojis !== undefined,
          data.emojiCategories !== undefined,
          data.assets !== undefined,
          data.savedJournalStickers !== undefined,
          data.galleryImages !== undefined,
          data.diaries !== undefined,
          data.tasks !== undefined,
          data.anniversaries !== undefined,
          data.roomTodos !== undefined,
          data.roomNotes !== undefined,
          data.groups !== undefined,
          data.socialPosts !== undefined,
          data.courses !== undefined,
          data.games !== undefined,
          data.worldbooks !== undefined,
          data.llmPresets !== undefined,
          data.personas !== undefined,
          data.novels !== undefined,
          data.coviewMedia !== undefined,
          data.coviewBooks !== undefined,
          data.coviewSessions !== undefined,
          data.coviewMessages !== undefined,
          data.songs !== undefined,
          data.musicTracks !== undefined,
          data.musicPlaylists !== undefined,
          data.musicPlaylistItems !== undefined,
          data.musicPlayEvents !== undefined,
          data.musicSearchHistory !== undefined,
          data.musicRecommendCache !== undefined,
          data.quizSessions !== undefined,
          data.guidebookSessions !== undefined,
          data.theaterQuizSessions !== undefined,
          data.theaterFauxPieces !== undefined,
          data.theaterReflectionSessions !== undefined,
          data.theaterSleepSessions !== undefined,
          data.theaterGomokuGames !== undefined,
          data.theaterGomokuInvitations !== undefined,
          data.theaterGoGames !== undefined,
          data.theaterGoInvitations !== undefined,
          data.theaterDoudizhuGames !== undefined,
          data.theaterDoudizhuInvitations !== undefined,
          data.theaterTurtleSoupGames !== undefined,
          data.theaterTurtleSoupInvitations !== undefined,
          data.theaterMahjongGames !== undefined,
          data.theaterMahjongInvitations !== undefined,
          data.collectionItems !== undefined,
          data.scheduledMessages !== undefined,
          data.lifeSimState !== undefined,
          data.bankTransactions !== undefined,
          data.xhsActivities !== undefined,
          data.xhsStockImages !== undefined,
          data.twitterTweets !== undefined,
          data.twitterNotifications !== undefined,
          data.twitterProfile !== undefined,
          data.twitterAccounts !== undefined,
          data.twitterDMThreads !== undefined,
          data.twitterSearchRecords !== undefined,
          data.memoryNodes !== undefined,
          data.memoryLinks !== undefined,
          data.topicBoxes !== undefined,
          data.anticipations !== undefined,
          data.eventBoxes !== undefined,
          data.memoryBatches !== undefined,
          data.dailySchedules !== undefined,
          data.handbooks !== undefined,
          data.trackers !== undefined,
          data.trackerEntries !== undefined,
          data.hotNewsSnapshots !== undefined,
          data.vrNovels !== undefined,
          data.vrAnnotations !== undefined,
          data.customCreatorParts !== undefined,
          data.vrMusicRoom !== undefined,
          data.vrGuestbook !== undefined,
          data.vrScripts !== undefined,
          data.vrStagedPlays !== undefined,
          data.vrPresets !== undefined,
          data.vrLetters !== undefined,
          (data as any).vrPostOffice !== undefined,
          data.pixelHomeAssets !== undefined,
          data.pixelHomeLayouts !== undefined,
          data.userProfile !== undefined,
          data.bankState !== undefined || data.bankDollhouse !== undefined,
          data.phoneCallLogs !== undefined,
          data.phoneCheckSessions !== undefined,
          data.userScreenWatchSessions !== undefined,
          data.exchangeDiaryBooks !== undefined,
          data.innerVoices !== undefined,
          data.relationshipNetworkEdges !== undefined,
          data.relationshipNetworkMessages !== undefined,
          data.relationshipNetworkAutoSettings !== undefined,
          data.desktopPetState !== undefined,
          data.takeoutOrders !== undefined,
          data.indexedDbSnapshot !== undefined,
      ];
      const sectionTotal = Math.max(1, plannedSections.filter(Boolean).length);
      let sectionDone = 0;

      const report = (
          label: string,
          stage: 'start' | 'items' | 'done',
          itemDone?: number,
          itemTotal?: number
      ) => {
          options.onProgress?.({
              label,
              stage,
              sectionDone,
              sectionTotal,
              itemDone,
              itemTotal,
          });
      };

      const runSection = async (
          label: string,
          present: boolean,
          work: () => Promise<void>,
          itemTotal?: number
      ) => {
          if (!present) return;
          report(label, 'start', 0, itemTotal);
          await work();
          sectionDone += 1;
          report(label, 'done', itemTotal, itemTotal);
      };

      const beforeWrite = async (root: any, label: string, restoreAssets: boolean) => {
          if (!restoreAssets || root === undefined || root === null) return;
          if (!options.beforeWrite) return;
          await options.beforeWrite(root, label);
      };

      const clearStore = async (storeName: string) => {
          await withStore(storeName, store => {
              store.clear();
          });
      };

      const putItems = async (
          storeName: string,
          items: any[] | undefined | null,
          label: string,
          restoreAssets = true
      ) => {
          if (!hasStore(storeName) || !items || items.length === 0) return;

          const CHUNK_SIZE = 50;
          const total = items.length;
          for (let i = 0; i < total; i += CHUNK_SIZE) {
              const end = Math.min(i + CHUNK_SIZE, total);
              const chunk = items.slice(i, end).filter(Boolean);
              if (chunk.length === 0) {
                  report(label, 'items', end, total);
                  continue;
              }
              await beforeWrite(chunk, label, restoreAssets);
              await withStore(storeName, store => {
                  chunk.forEach(item => store.put(item));
              });
              for (let j = i; j < end; j++) {
                  (items as any[])[j] = undefined;
              }
              report(label, 'items', end, total);
          }
      };

      const clearAndAdd = async (
          storeName: string,
          items: any[] | undefined | null,
          label: string,
          restoreAssets = true
      ) => {
          if (!hasStore(storeName) || items === undefined || items === null) return;
          await clearStore(storeName);
          await putItems(storeName, items, label, restoreAssets);
      };

      const mergeStore = async (
          storeName: string,
          items: any[] | undefined | null,
          label: string,
          restoreAssets = true
      ) => {
          if (!hasStore(storeName) || !items || items.length === 0) return;
          await putItems(storeName, items, label, restoreAssets);
      };

      const applyMediaToChar = (c: CharacterProfile, media: NonNullable<FullBackupData['mediaAssets']>[number]): CharacterProfile => {
          return {
              ...c,
              avatar: media.avatar || c.avatar,
              sprites: media.sprites || c.sprites,
              dateSkinSets: media.dateSkinSets || c.dateSkinSets,
              activeSkinSetId: media.activeSkinSetId || c.activeSkinSetId,
              customDateSprites: media.customDateSprites || c.customDateSprites,
              spriteConfig: media.spriteConfig || c.spriteConfig,
              chatBackground: media.backgrounds?.chat || c.chatBackground,
              dateBackground: media.backgrounds?.date || c.dateBackground,
              roomConfig: c.roomConfig ? {
                  ...c.roomConfig,
                  wallImage: media.backgrounds?.roomWall || c.roomConfig.wallImage,
                  floorImage: media.backgrounds?.roomFloor || c.roomConfig.floorImage,
                  items: c.roomConfig.items.map(item => {
                      const img = media.roomItems?.[item.id];
                      return img ? { ...item, image: img } : item;
                  })
              } : c.roomConfig
          } as CharacterProfile;
      };

      const hasCharacterBackup = Array.isArray(data.characters);

      await runSection('角色资料', data.characters !== undefined || data.mediaAssets !== undefined, async () => {
          if (data.characters) {
              if (data.mediaAssets) {
                  await beforeWrite(data.mediaAssets, '角色媒体', true);
                  const mediaAssets = data.mediaAssets;
                  data.characters = data.characters.map(c => {
                      const media = mediaAssets.find(m => m.charId === c.id);
                      return media ? applyMediaToChar(c, media) : c;
                  });
              }
              data.characters = data.characters.map(c => c ? normalizeCharacterDefaults(c) : c);
              await clearAndAdd(STORE_CHARACTERS, data.characters, '角色资料', true);
          } else if (data.mediaAssets && hasStore(STORE_CHARACTERS)) {
              await beforeWrite(data.mediaAssets, '角色媒体', true);
              const mediaAssets = data.mediaAssets;
              const existingChars = await getAllFromStore<CharacterProfile>(STORE_CHARACTERS);
              if (existingChars.length > 0) {
                  const updatedChars = existingChars.map(c => {
                      const media = mediaAssets.find(m => m.charId === c.id);
                      return normalizeCharacterDefaults(media ? applyMediaToChar(c, media) : c);
                  });
                  await putItems(STORE_CHARACTERS, updatedChars, '角色资料', false);
              }
          }
          data.characters = undefined as any;
          data.mediaAssets = undefined as any;
      }, data.characters?.length || data.mediaAssets?.length || 0);

      await runSection('聊天记录', data.messages !== undefined, async () => {
          if (!hasStore(STORE_MESSAGES)) return;
          const isPatchMode = !hasCharacterBackup;
          if (!isPatchMode) {
              await clearStore(STORE_MESSAGES);
          }
          await putItems(STORE_MESSAGES, data.messages || [], '聊天记录', true);
          data.messages = undefined as any;
      }, data.messages?.length || 0);

      await runSection('私聊档案', data.privateChatArchives !== undefined, async () => {
          if (!hasStore(STORE_PRIVATE_CHAT_ARCHIVES)) return;
          const isPatchMode = !hasCharacterBackup;
          if (!isPatchMode) {
              await clearStore(STORE_PRIVATE_CHAT_ARCHIVES);
          }
          await putItems(STORE_PRIVATE_CHAT_ARCHIVES, data.privateChatArchives || [], '私聊档案', true);
          data.privateChatArchives = undefined as any;
      }, data.privateChatArchives?.length || 0);

      await runSection('聊天闹钟', data.chatAlarms !== undefined, async () => {
          if (!hasStore(STORE_CHAT_ALARMS)) return;
          const isPatchMode = !hasCharacterBackup;
          if (!isPatchMode) {
              await clearStore(STORE_CHAT_ALARMS);
          }
          await putItems(STORE_CHAT_ALARMS, data.chatAlarms || [], '聊天闹钟', false);
          data.chatAlarms = undefined as any;
      }, data.chatAlarms?.length || 0);

      await runSection('絮语稍后回', data.chatFollowups !== undefined, async () => {
          if (!hasStore(STORE_CHAT_FOLLOWUPS)) return;
          const isPatchMode = !hasCharacterBackup;
          if (!isPatchMode) {
              await clearStore(STORE_CHAT_FOLLOWUPS);
          }
          await putItems(STORE_CHAT_FOLLOWUPS, data.chatFollowups || [], '絮语稍后回', false);
          data.chatFollowups = undefined as any;
      }, data.chatFollowups?.length || 0);

      await runSection('絮语总览摘要', data.chatHubDigests !== undefined, async () => {
          if (!hasStore(STORE_CHAT_HUB_DIGESTS)) return;
          const isPatchMode = !hasCharacterBackup;
          if (!isPatchMode) {
              await clearStore(STORE_CHAT_HUB_DIGESTS);
          }
          await putItems(STORE_CHAT_HUB_DIGESTS, data.chatHubDigests || [], '絮语总览摘要', false);
          data.chatHubDigests = undefined as any;
      }, data.chatHubDigests?.length || 0);

      await runSection('经期提醒设置', data.periodReminderSettings !== undefined, async () => {
          await clearAndAdd(STORE_PERIOD_REMINDER_SETTINGS, data.periodReminderSettings || [], '经期提醒设置', false);
          data.periodReminderSettings = undefined as any;
      }, data.periodReminderSettings?.length || 0);

      await runSection('经期记录', data.periodCycleEvents !== undefined, async () => {
          await clearAndAdd(STORE_PERIOD_CYCLE_EVENTS, data.periodCycleEvents || [], '经期记录', false);
          data.periodCycleEvents = undefined as any;
      }, data.periodCycleEvents?.length || 0);

      await runSection('健康模块设置', data.healthModuleSettings !== undefined, async () => {
          await clearAndAdd(STORE_HEALTH_MODULE_SETTINGS, data.healthModuleSettings || [], '健康模块设置', false);
          data.healthModuleSettings = undefined as any;
      }, data.healthModuleSettings?.length || 0);

      await runSection('健康记录', data.healthRecords !== undefined, async () => {
          await clearAndAdd(STORE_HEALTH_RECORDS, data.healthRecords || [], '健康记录', false);
          data.healthRecords = undefined as any;
      }, data.healthRecords?.length || 0);

      await runSection('健康提醒', data.healthReminders !== undefined, async () => {
          await clearAndAdd(STORE_HEALTH_REMINDERS, data.healthReminders || [], '健康提醒', false);
          data.healthReminders = undefined as any;
      }, data.healthReminders?.length || 0);

      await runSection('健康目标', data.healthPlans !== undefined, async () => {
          await clearAndAdd(STORE_HEALTH_PLANS, data.healthPlans || [], '健康目标', false);
          data.healthPlans = undefined as any;
      }, data.healthPlans?.length || 0);

      await runSection('健康摘要', data.healthSummaries !== undefined, async () => {
          await clearAndAdd(STORE_HEALTH_SUMMARIES, data.healthSummaries || [], '健康摘要', false);
          data.healthSummaries = undefined as any;
      }, data.healthSummaries?.length || 0);

      await runSection('健康导入批次', data.healthImportBatches !== undefined, async () => {
          await clearAndAdd(STORE_HEALTH_IMPORT_BATCHES, data.healthImportBatches || [], '健康导入批次', false);
          data.healthImportBatches = undefined as any;
      }, data.healthImportBatches?.length || 0);

      await runSection('聊天主题', data.customThemes !== undefined, async () => {
          await mergeStore(STORE_THEMES, data.customThemes, '聊天主题', true);
          data.customThemes = undefined as any;
      }, data.customThemes?.length || 0);
      await runSection('表情包', data.savedEmojis !== undefined, async () => {
          await mergeStore(STORE_EMOJIS, data.savedEmojis, '表情包', true);
          data.savedEmojis = undefined as any;
      }, data.savedEmojis?.length || 0);
      await runSection('表情分类', data.emojiCategories !== undefined, async () => {
          await mergeStore(STORE_EMOJI_CATEGORIES, data.emojiCategories, '表情分类', false);
          data.emojiCategories = undefined as any;
      }, data.emojiCategories?.length || 0);
      await runSection('系统资源', data.assets !== undefined, async () => {
          await clearAndAdd(STORE_ASSETS, data.assets || [], '系统资源', true);
          data.assets = undefined as any;
      }, data.assets?.length || 0);
      await runSection('日记贴纸', data.savedJournalStickers !== undefined, async () => {
          await mergeStore(STORE_JOURNAL_STICKERS, data.savedJournalStickers, '日记贴纸', true);
          data.savedJournalStickers = undefined as any;
      }, data.savedJournalStickers?.length || 0);

      await runSection('相册图片', data.galleryImages !== undefined, async () => {
          await clearAndAdd(STORE_GALLERY, data.galleryImages, '相册图片', true);
          data.galleryImages = undefined as any;
      }, data.galleryImages?.length || 0);
      await runSection('日记', data.diaries !== undefined, async () => {
          await clearAndAdd(STORE_DIARIES, data.diaries, '日记', true);
          data.diaries = undefined as any;
      }, data.diaries?.length || 0);
      await runSection('任务', data.tasks !== undefined, async () => {
          await clearAndAdd(STORE_TASKS, data.tasks, '任务', false);
          data.tasks = undefined as any;
      }, data.tasks?.length || 0);
      await runSection('通话记录', data.phoneCallLogs !== undefined, async () => {
          await clearAndAdd(STORE_PHONE_CALL_LOGS, data.phoneCallLogs, '通话记录', false);
          data.phoneCallLogs = undefined as any;
      }, data.phoneCallLogs?.length || 0);
      await runSection('查岗档案', data.phoneCheckSessions !== undefined, async () => {
          await clearAndAdd(STORE_PHONE_CHECK_SESSIONS, data.phoneCheckSessions, '查岗档案', false);
          data.phoneCheckSessions = undefined as any;
      }, data.phoneCheckSessions?.length || 0);
      await runSection('观屏评论', data.userScreenWatchSessions !== undefined, async () => {
          await clearAndAdd(STORE_USER_SCREEN_WATCH, data.userScreenWatchSessions, '观屏评论', false);
          data.userScreenWatchSessions = undefined as any;
      }, data.userScreenWatchSessions?.length || 0);
      await runSection('日记社', data.exchangeDiaryBooks !== undefined, async () => {
          await clearAndAdd(STORE_EXCHANGE_DIARY, data.exchangeDiaryBooks, '日记社', false);
          data.exchangeDiaryBooks = undefined as any;
      }, data.exchangeDiaryBooks?.length || 0);
      await runSection('偷看心声', data.innerVoices !== undefined, async () => {
          await clearAndAdd(STORE_INNER_VOICES, data.innerVoices, '偷看心声', false);
          data.innerVoices = undefined as any;
      }, data.innerVoices?.length || 0);
      await runSection('关系网关系', data.relationshipNetworkEdges !== undefined, async () => {
          await clearAndAdd(STORE_RELATIONSHIP_NETWORK_EDGES, data.relationshipNetworkEdges, '关系网关系', false);
          data.relationshipNetworkEdges = undefined as any;
      }, data.relationshipNetworkEdges?.length || 0);
      await runSection('关系网私聊', data.relationshipNetworkMessages !== undefined, async () => {
          await clearAndAdd(STORE_RELATIONSHIP_NETWORK_MESSAGES, data.relationshipNetworkMessages, '关系网私聊', false);
          data.relationshipNetworkMessages = undefined as any;
      }, data.relationshipNetworkMessages?.length || 0);
      await runSection('关系网后台设置', data.relationshipNetworkAutoSettings !== undefined, async () => {
          await clearAndAdd(STORE_RELATIONSHIP_NETWORK_SETTINGS, data.relationshipNetworkAutoSettings, '关系网后台设置', false);
          data.relationshipNetworkAutoSettings = undefined as any;
      }, data.relationshipNetworkAutoSettings?.length || 0);
      await runSection('桌宠', data.desktopPetState !== undefined, async () => {
          if (!hasStore(STORE_DESKTOP_PET)) return;
          await withStore(STORE_DESKTOP_PET, store => {
              store.clear();
              if (data.desktopPetState) store.put({ ...data.desktopPetState, id: 'main' });
          });
          data.desktopPetState = undefined as any;
      }, data.desktopPetState ? 1 : 0);
      await runSection('纪念日', data.anniversaries !== undefined, async () => {
          await clearAndAdd(STORE_ANNIVERSARIES, data.anniversaries, '纪念日', false);
          data.anniversaries = undefined as any;
      }, data.anniversaries?.length || 0);
      await runSection('房间待办', data.roomTodos !== undefined, async () => {
          await clearAndAdd(STORE_ROOM_TODOS, data.roomTodos, '房间待办', false);
          data.roomTodos = undefined as any;
      }, data.roomTodos?.length || 0);
      await runSection('房间便签', data.roomNotes !== undefined, async () => {
          await clearAndAdd(STORE_ROOM_NOTES, data.roomNotes, '房间便签', false);
          data.roomNotes = undefined as any;
      }, data.roomNotes?.length || 0);
      await runSection('群聊资料', data.groups !== undefined, async () => {
          await clearAndAdd(STORE_GROUPS, data.groups, '群聊资料', true);
          data.groups = undefined as any;
      }, data.groups?.length || 0);
      await runSection('动态帖子', data.socialPosts !== undefined, async () => {
          await clearAndAdd(STORE_SOCIAL_POSTS, data.socialPosts, '动态帖子', true);
          data.socialPosts = undefined as any;
      }, data.socialPosts?.length || 0);
      await runSection('学习课程', data.courses !== undefined, async () => {
          await clearAndAdd(STORE_COURSES, data.courses, '学习课程', false);
          data.courses = undefined as any;
      }, data.courses?.length || 0);
      await runSection('游戏记录', data.games !== undefined, async () => {
          await clearAndAdd(STORE_GAMES, data.games, '游戏记录', false);
          data.games = undefined as any;
      }, data.games?.length || 0);
      await runSection('世界书', data.worldbooks !== undefined, async () => {
          await clearAndAdd(STORE_WORLDBOOKS, data.worldbooks, '世界书', false);
          data.worldbooks = undefined as any;
      }, data.worldbooks?.length || 0);
      await runSection('LLM预设', data.llmPresets !== undefined, async () => {
          await clearAndAdd(STORE_LLM_PRESETS, data.llmPresets, 'LLM预设', false);
          data.llmPresets = undefined as any;
      }, data.llmPresets?.length || 0);
      await runSection('人设', data.personas !== undefined, async () => {
          await clearAndAdd(STORE_PERSONAS, data.personas, '人设', true);
          data.personas = undefined as any;
      }, data.personas?.length || 0);
      await runSection('小说', data.novels !== undefined, async () => {
          await clearAndAdd(STORE_NOVELS, data.novels, '小说', false);
          data.novels = undefined as any;
      }, data.novels?.length || 0);
      await runSection('共览视频', data.coviewMedia !== undefined, async () => {
          const media = (data.coviewMedia || []).map(({ blob: _blob, ...item }) => item);
          await clearAndAdd(STORE_COVIEW_MEDIA, media, '共览视频', false);
          data.coviewMedia = undefined as any;
      }, data.coviewMedia?.length || 0);
      await runSection('共览书籍', data.coviewBooks !== undefined, async () => {
          await clearAndAdd(STORE_COVIEW_BOOKS, data.coviewBooks, '共览书籍', false);
          data.coviewBooks = undefined as any;
      }, data.coviewBooks?.length || 0);
      await runSection('共览会话', data.coviewSessions !== undefined, async () => {
          await clearAndAdd(STORE_COVIEW_SESSIONS, data.coviewSessions, '共览会话', false);
          data.coviewSessions = undefined as any;
      }, data.coviewSessions?.length || 0);
      await runSection('共览消息', data.coviewMessages !== undefined, async () => {
          await clearAndAdd(STORE_COVIEW_MESSAGES, data.coviewMessages, '共览消息', false);
          data.coviewMessages = undefined as any;
      }, data.coviewMessages?.length || 0);
      await runSection('页外小说库', data.vrNovels !== undefined, async () => {
          await clearAndAdd(STORE_VR_NOVELS, data.vrNovels, '页外小说库', false);
          data.vrNovels = undefined as any;
      }, data.vrNovels?.length || 0);
      await runSection('页外批注', data.vrAnnotations !== undefined, async () => {
          await clearAndAdd(STORE_VR_ANNOTATIONS, data.vrAnnotations, '页外批注', false);
          data.vrAnnotations = undefined as any;
      }, data.vrAnnotations?.length || 0);
      await runSection('捏脸自定义部件', data.customCreatorParts !== undefined, async () => {
          await clearAndAdd(STORE_CC_PARTS, data.customCreatorParts, '捏脸自定义部件', false);
          data.customCreatorParts = undefined as any;
      }, data.customCreatorParts?.length || 0);
      await runSection('听歌房', data.vrMusicRoom !== undefined, async () => {
          if (hasStore(STORE_VR_MUSIC) && data.vrMusicRoom) await DB.saveVRMusicRoom(data.vrMusicRoom);
          data.vrMusicRoom = undefined as any;
      }, 1);
      await runSection('留言簿', data.vrGuestbook !== undefined, async () => {
          if (hasStore(STORE_VR_GUESTBOOK) && data.vrGuestbook) await DB.saveVRGuestbook(data.vrGuestbook);
          data.vrGuestbook = undefined as any;
      }, 1);
      await runSection('剧院剧本', data.vrScripts !== undefined, async () => {
          if (hasStore(STORE_VR_SCRIPTS) && Array.isArray(data.vrScripts)) for (const s of data.vrScripts) await DB.saveVRScript(s);
          data.vrScripts = undefined as any;
      }, data.vrScripts?.length || 0);
      await runSection('历史舞台剧', data.vrStagedPlays !== undefined, async () => {
          if (hasStore(STORE_VR_PLAYS) && Array.isArray(data.vrStagedPlays)) for (const p of data.vrStagedPlays) await DB.saveVRStagedPlay(p);
          data.vrStagedPlays = undefined as any;
      }, data.vrStagedPlays?.length || 0);
      await runSection('剧院预设', (data as any).vrPresets !== undefined, async () => {
          if (hasStore(STORE_VR_PRESETS) && Array.isArray((data as any).vrPresets)) for (const p of (data as any).vrPresets) await DB.saveVRPreset(p);
          (data as any).vrPresets = undefined as any;
      }, (data as any).vrPresets?.length || 0);
      await runSection('邮局信件', data.vrLetters !== undefined, async () => {
          await clearAndAdd(STORE_VR_LETTERS, data.vrLetters, '邮局信件', false);
          data.vrLetters = undefined as any;
      }, data.vrLetters?.length || 0);
      await runSection('页外设置', data.vrSettings !== undefined, async () => {
          if (hasStore(STORE_VR_SETTINGS) && Array.isArray(data.vrSettings)) {
              for (const rec of data.vrSettings) await DB.saveVRSettingRecord(rec);
          }
          data.vrSettings = undefined as any;
      }, data.vrSettings?.length || 0);
      await runSection('邮局身份', (data as any).vrPostOffice !== undefined, async () => {
          importPostOfficeLocal((data as any).vrPostOffice);
          (data as any).vrPostOffice = undefined;
      }, 1);
      await runSection('歌曲', data.songs !== undefined, async () => {
          await clearAndAdd(STORE_SONGS, data.songs, '歌曲', false);
          data.songs = undefined as any;
      }, data.songs?.length || 0);
      await runSection('音乐资料库·歌曲', data.musicTracks !== undefined, async () => {
          await clearAndAdd(STORE_MUSIC_TRACKS, data.musicTracks, '音乐资料库·歌曲', false);
          data.musicTracks = undefined as any;
      }, data.musicTracks?.length || 0);
      await runSection('音乐资料库·歌单', data.musicPlaylists !== undefined, async () => {
          await clearAndAdd(STORE_MUSIC_PLAYLISTS, data.musicPlaylists, '音乐资料库·歌单', false);
          data.musicPlaylists = undefined as any;
      }, data.musicPlaylists?.length || 0);
      await runSection('音乐资料库·歌单歌曲', data.musicPlaylistItems !== undefined, async () => {
          await clearAndAdd(STORE_MUSIC_PLAYLIST_ITEMS, data.musicPlaylistItems, '音乐资料库·歌单歌曲', false);
          data.musicPlaylistItems = undefined as any;
      }, data.musicPlaylistItems?.length || 0);
      await runSection('音乐资料库·播放记录', data.musicPlayEvents !== undefined, async () => {
          await clearAndAdd(STORE_MUSIC_PLAY_EVENTS, data.musicPlayEvents, '音乐资料库·播放记录', false);
          data.musicPlayEvents = undefined as any;
      }, data.musicPlayEvents?.length || 0);
      await runSection('音乐资料库·搜索记录', data.musicSearchHistory !== undefined, async () => {
          await clearAndAdd(STORE_MUSIC_SEARCH_HISTORY, data.musicSearchHistory, '音乐资料库·搜索记录', false);
          data.musicSearchHistory = undefined as any;
      }, data.musicSearchHistory?.length || 0);
      await runSection('音乐资料库·推荐缓存', data.musicRecommendCache !== undefined, async () => {
          await clearAndAdd(STORE_MUSIC_RECOMMEND_CACHE, data.musicRecommendCache, '音乐资料库·推荐缓存', false);
          data.musicRecommendCache = undefined as any;
      }, data.musicRecommendCache?.length || 0);
      await runSection('练习本', data.quizSessions !== undefined, async () => {
          await clearAndAdd(STORE_QUIZZES, data.quizSessions, '练习本', false);
          data.quizSessions = undefined as any;
      }, data.quizSessions?.length || 0);
      await runSection('攻略本', data.guidebookSessions !== undefined, async () => {
          await clearAndAdd(STORE_GUIDEBOOK, data.guidebookSessions, '攻略本', false);
          data.guidebookSessions = undefined as any;
      }, data.guidebookSessions?.length || 0);
      await runSection('番外问卷', data.theaterQuizSessions !== undefined, async () => {
          await clearAndAdd(STORE_THEATER_QUIZ_SESSIONS, data.theaterQuizSessions, '番外问卷', false);
          data.theaterQuizSessions = undefined as any;
      }, data.theaterQuizSessions?.length || 0);
      await runSection('仿真图文历史', data.theaterFauxPieces !== undefined, async () => {
          await clearAndAdd(STORE_THEATER_FAUX_PIECES, data.theaterFauxPieces, '仿真图文历史', false);
          data.theaterFauxPieces = undefined as any;
      }, data.theaterFauxPieces?.length || 0);
      await runSection('幕间集导入库', data.theaterCustomLibrary !== undefined, async () => {
          await clearAndAdd(STORE_THEATER_CUSTOM_LIBRARY, data.theaterCustomLibrary, '幕间集导入库', false);
          data.theaterCustomLibrary = undefined as any;
      }, data.theaterCustomLibrary?.length || 0);
      await runSection('对影册', data.theaterReflectionSessions !== undefined, async () => {
          await clearAndAdd(STORE_THEATER_REFLECTION_SESSIONS, data.theaterReflectionSessions, '对影册', false);
          data.theaterReflectionSessions = undefined as any;
      }, data.theaterReflectionSessions?.length || 0);
      await runSection('一起入眠', data.theaterSleepSessions !== undefined, async () => {
          await clearAndAdd(STORE_THEATER_SLEEP_SESSIONS, data.theaterSleepSessions, '一起入眠', false);
          data.theaterSleepSessions = undefined as any;
      }, data.theaterSleepSessions?.length || 0);
      await runSection('五子棋棋局', data.theaterGomokuGames !== undefined, async () => {
          await clearAndAdd(STORE_THEATER_GOMOKU_GAMES, data.theaterGomokuGames, '五子棋棋局', false);
          data.theaterGomokuGames = undefined as any;
      }, data.theaterGomokuGames?.length || 0);
      await runSection('五子棋邀请', data.theaterGomokuInvitations !== undefined, async () => {
          await clearAndAdd(STORE_THEATER_GOMOKU_INVITATIONS, data.theaterGomokuInvitations, '五子棋邀请', false);
          data.theaterGomokuInvitations = undefined as any;
      }, data.theaterGomokuInvitations?.length || 0);
      await runSection('围棋棋局', data.theaterGoGames !== undefined, async () => {
          await clearAndAdd(STORE_THEATER_GO_GAMES, data.theaterGoGames, '围棋棋局', false);
          data.theaterGoGames = undefined as any;
      }, data.theaterGoGames?.length || 0);
      await runSection('围棋邀请', data.theaterGoInvitations !== undefined, async () => {
          await clearAndAdd(STORE_THEATER_GO_INVITATIONS, data.theaterGoInvitations, '围棋邀请', false);
          data.theaterGoInvitations = undefined as any;
      }, data.theaterGoInvitations?.length || 0);
      await runSection('斗地主牌局', data.theaterDoudizhuGames !== undefined, async () => {
          await clearAndAdd(STORE_THEATER_DOUDIZHU_GAMES, data.theaterDoudizhuGames, '斗地主牌局', false);
          data.theaterDoudizhuGames = undefined as any;
      }, data.theaterDoudizhuGames?.length || 0);
      await runSection('斗地主邀请', data.theaterDoudizhuInvitations !== undefined, async () => {
          await clearAndAdd(STORE_THEATER_DOUDIZHU_INVITATIONS, data.theaterDoudizhuInvitations, '斗地主邀请', false);
          data.theaterDoudizhuInvitations = undefined as any;
      }, data.theaterDoudizhuInvitations?.length || 0);
      await runSection('海龟汤汤局', data.theaterTurtleSoupGames !== undefined, async () => {
          await clearAndAdd(STORE_THEATER_TURTLE_SOUP_GAMES, data.theaterTurtleSoupGames, '海龟汤汤局', false);
          data.theaterTurtleSoupGames = undefined as any;
      }, data.theaterTurtleSoupGames?.length || 0);
      await runSection('海龟汤邀请', data.theaterTurtleSoupInvitations !== undefined, async () => {
          await clearAndAdd(STORE_THEATER_TURTLE_SOUP_INVITATIONS, data.theaterTurtleSoupInvitations, '海龟汤邀请', false);
          data.theaterTurtleSoupInvitations = undefined as any;
      }, data.theaterTurtleSoupInvitations?.length || 0);
      await runSection('麻将牌局', data.theaterMahjongGames !== undefined, async () => {
          await clearAndAdd(STORE_THEATER_MAHJONG_GAMES, data.theaterMahjongGames, '麻将牌局', false);
          data.theaterMahjongGames = undefined as any;
      }, data.theaterMahjongGames?.length || 0);
      await runSection('麻将邀请', data.theaterMahjongInvitations !== undefined, async () => {
          await clearAndAdd(STORE_THEATER_MAHJONG_INVITATIONS, data.theaterMahjongInvitations, '麻将邀请', false);
          data.theaterMahjongInvitations = undefined as any;
      }, data.theaterMahjongInvitations?.length || 0);
      await runSection('典藏馆收录', data.collectionItems !== undefined, async () => {
          await clearAndAdd(STORE_COLLECTION_ITEMS, data.collectionItems, '典藏馆收录', false);
          data.collectionItems = undefined as any;
      }, data.collectionItems?.length || 0);
      await runSection('饭票订单', data.takeoutOrders !== undefined, async () => {
          await clearAndAdd(STORE_TAKEOUT_ORDERS, data.takeoutOrders || [], '饭票订单', false);
          data.takeoutOrders = undefined as any;
      }, data.takeoutOrders?.length || 0);
      await runSection('IndexedDB兜底数据', data.indexedDbSnapshot !== undefined, async () => {
          const snapshot = data.indexedDbSnapshot || {};
          for (const [storeName, items] of Object.entries(snapshot)) {
              if (!hasStore(storeName) || !Array.isArray(items)) continue;
              await clearAndAdd(storeName, items, `IndexedDB:${storeName}`, true);
              snapshot[storeName] = undefined as any;
          }
          data.indexedDbSnapshot = undefined as any;
      }, Object.values(data.indexedDbSnapshot || {}).reduce((sum, items) => sum + (Array.isArray(items) ? items.length : 0), 0));
      await runSection('定时消息', data.scheduledMessages !== undefined, async () => {
          await clearAndAdd(STORE_SCHEDULED, data.scheduledMessages || [], '定时消息', false);
          data.scheduledMessages = undefined as any;
      }, data.scheduledMessages?.length || 0);
      await runSection('人生模拟', data.lifeSimState !== undefined, async () => {
          if (!hasStore(STORE_LIFE_SIM)) return;
          await beforeWrite(data.lifeSimState, '人生模拟', true);
          await withStore(STORE_LIFE_SIM, store => {
              store.clear();
              if (data.lifeSimState) {
                  store.put({ ...data.lifeSimState, id: 'main' });
              }
          });
          data.lifeSimState = undefined as any;
      }, data.lifeSimState ? 1 : 0);
      await runSection('银行流水', data.bankTransactions !== undefined, async () => {
          await clearAndAdd(STORE_BANK_TX, data.bankTransactions, '银行流水', false);
          data.bankTransactions = undefined as any;
      }, data.bankTransactions?.length || 0);
      await runSection('小红书活动', data.xhsActivities !== undefined, async () => {
          await clearAndAdd(STORE_XHS_ACTIVITIES, data.xhsActivities, '小红书活动', false);
          data.xhsActivities = undefined as any;
      }, data.xhsActivities?.length || 0);
      await runSection('小红书图库', data.xhsStockImages !== undefined, async () => {
          await clearAndAdd(STORE_XHS_STOCK, data.xhsStockImages, '小红书图库', true);
          data.xhsStockImages = undefined as any;
      }, data.xhsStockImages?.length || 0);
      await runSection('见闻簿卡片', data.xhsFeedPosts !== undefined, async () => {
          await clearAndAdd(STORE_XHS_FEED, data.xhsFeedPosts, '见闻簿卡片', true);
          data.xhsFeedPosts = undefined as any;
      }, data.xhsFeedPosts?.length || 0);
      await runSection('推特时间线', data.twitterTweets !== undefined, async () => {
          await clearAndAdd(STORE_TWITTER_TWEETS, data.twitterTweets, '推特时间线', false);
          data.twitterTweets = undefined as any;
      }, data.twitterTweets?.length || 0);
      await runSection('推特通知', data.twitterNotifications !== undefined, async () => {
          await clearAndAdd(STORE_TWITTER_NOTIFS, data.twitterNotifications, '推特通知', false);
          data.twitterNotifications = undefined as any;
      }, data.twitterNotifications?.length || 0);
      await runSection('推特个人资料', data.twitterProfile !== undefined, async () => {
          await clearAndAdd(STORE_TWITTER_PROFILE, data.twitterProfile ? [{ ...data.twitterProfile, id: 'me' }] : [], '推特个人资料', false);
          data.twitterProfile = undefined as any;
      }, data.twitterProfile ? 1 : 0);
      await runSection('推特账号', data.twitterAccounts !== undefined, async () => {
          await clearAndAdd(STORE_TWITTER_ACCOUNTS, data.twitterAccounts, '推特账号', false);
          data.twitterAccounts = undefined as any;
      }, data.twitterAccounts?.length || 0);
      await runSection('推特私信', data.twitterDMThreads !== undefined, async () => {
          await clearAndAdd(STORE_TWITTER_DM, data.twitterDMThreads, '推特私信', false);
          data.twitterDMThreads = undefined as any;
      }, data.twitterDMThreads?.length || 0);
      await runSection('推特搜索历史', data.twitterSearchRecords !== undefined, async () => {
          await clearAndAdd(STORE_TWITTER_SEARCH, data.twitterSearchRecords, '推特搜索历史', false);
          data.twitterSearchRecords = undefined as any;
      }, data.twitterSearchRecords?.length || 0);

      // 回忆标本馆
      await runSection('记忆节点', data.memoryNodes !== undefined, async () => {
          await clearAndAdd('memory_nodes', data.memoryNodes, '记忆节点', false);
          data.memoryNodes = undefined as any;
      }, data.memoryNodes?.length || 0);
      await runSection('记忆关系', data.memoryLinks !== undefined, async () => {
          await clearAndAdd('memory_links', data.memoryLinks, '记忆关系', false);
          data.memoryLinks = undefined as any;
      }, data.memoryLinks?.length || 0);
      await runSection('话题盒', data.topicBoxes !== undefined, async () => {
          await clearAndAdd('topic_boxes', data.topicBoxes, '话题盒', false);
          data.topicBoxes = undefined as any;
      }, data.topicBoxes?.length || 0);
      await runSection('期待事项', data.anticipations !== undefined, async () => {
          await clearAndAdd('anticipations', data.anticipations, '期待事项', false);
          data.anticipations = undefined as any;
      }, data.anticipations?.length || 0);
      await runSection('事件盒', data.eventBoxes !== undefined, async () => {
          await clearAndAdd('event_boxes', data.eventBoxes, '事件盒', false);
          data.eventBoxes = undefined as any;
      }, data.eventBoxes?.length || 0);
      await runSection('记忆批次', data.memoryBatches !== undefined, async () => {
          await clearAndAdd('memory_batches', data.memoryBatches, '记忆批次', false);
          data.memoryBatches = undefined as any;
      }, data.memoryBatches?.length || 0);

      // 角色日程表（每日日程 + 意识流）
      await runSection('每日程', data.dailySchedules !== undefined, async () => {
          await clearAndAdd(STORE_DAILY_SCHEDULE, data.dailySchedules, '每日程', false);
          data.dailySchedules = undefined as any;
      }, data.dailySchedules?.length || 0);

      // 手账（跨角色聚合留痕本）
      await runSection('手账', data.handbooks !== undefined, async () => {
          await clearAndAdd(STORE_HANDBOOK, data.handbooks, '手账', false);
          data.handbooks = undefined as any;
      }, data.handbooks?.length || 0);

      // 手账 Tracker（健康/生活打卡引擎）
      await runSection('打卡项目', data.trackers !== undefined, async () => {
          await clearAndAdd(STORE_TRACKERS, data.trackers, '打卡项目', false);
          data.trackers = undefined as any;
      }, data.trackers?.length || 0);
      await runSection('打卡记录', data.trackerEntries !== undefined, async () => {
          await clearAndAdd(STORE_TRACKER_ENTRIES, data.trackerEntries, '打卡记录', false);
          data.trackerEntries = undefined as any;
      }, data.trackerEntries?.length || 0);

      // 热点快照（全角色共享缓存）
      await runSection('热点快照', data.hotNewsSnapshots !== undefined, async () => {
          await clearAndAdd(STORE_HOTNEWS, data.hotNewsSnapshots, '热点快照', false);
          data.hotNewsSnapshots = undefined as any;
      }, data.hotNewsSnapshots?.length || 0);

      // Pixel Home（小屋像素界面）
      await runSection('像素小屋素材', data.pixelHomeAssets !== undefined, async () => {
          await clearAndAdd('pixel_home_assets', data.pixelHomeAssets, '像素小屋素材', true);
          data.pixelHomeAssets = undefined as any;
      }, data.pixelHomeAssets?.length || 0);
      await runSection('像素小屋布局', data.pixelHomeLayouts !== undefined, async () => {
          await clearAndAdd('pixel_home_layouts', data.pixelHomeLayouts, '像素小屋布局', false);
          data.pixelHomeLayouts = undefined as any;
      }, data.pixelHomeLayouts?.length || 0);

      await runSection('用户资料', data.userProfile !== undefined, async () => {
          if (!hasStore(STORE_USER)) return;
          await beforeWrite(data.userProfile, '用户资料', true);
          await withStore(STORE_USER, store => {
              store.clear();
              if (data.userProfile) {
                  store.put({ ...data.userProfile, id: 'me' });
              }
          });
          data.userProfile = undefined as any;
      }, data.userProfile ? 1 : 0);

      await runSection('银行状态', data.bankState !== undefined || data.bankDollhouse !== undefined || data.bankDollhouses !== undefined, async () => {
          if (!hasStore(STORE_BANK_DATA)) return;
          await beforeWrite([data.bankState, data.bankDollhouse, data.bankDollhouses], '银行状态', true);
          await withStore(STORE_BANK_DATA, store => {
              store.clear();
              if (data.bankState) {
                  store.put({ ...data.bankState, id: 'main_state' });
              }
              let dollhousesByShop = data.bankDollhouses;
              if (!dollhousesByShop && data.bankDollhouse) {
                  const portfolio = data.bankState?.shopPortfolio;
                  const firstShopId = portfolio?.activeShopId || portfolio?.branches?.[0]?.id || 'shop-main';
                  dollhousesByShop = { [firstShopId]: data.bankDollhouse };
              }
              if (data.bankDollhouse) {
                  store.put({ id: 'dollhouse_state', data: data.bankDollhouse });
              }
              if (dollhousesByShop) {
                  store.put({ id: 'dollhouses_by_shop', data: dollhousesByShop });
              }
          });
          data.bankState = undefined as any;
          data.bankDollhouse = undefined as any;
          data.bankDollhouses = undefined as any;
      }, (data.bankState ? 1 : 0) + (data.bankDollhouse ? 1 : 0) + (data.bankDollhouses ? 1 : 0));
  }
};
