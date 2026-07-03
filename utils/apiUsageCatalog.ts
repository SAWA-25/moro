import { AppID } from '../types';
import type { ApiCallMeta } from './apiCallLog';

export type ApiRole = 'main' | 'aux' | 'custom';

export interface ApiUsageFeature {
    featureId: string;
    appId: AppID;
    appName: string;
    featureName: string;
    actionName: string;
    entryPath: string[];
    defaultApiRole: ApiRole;
    apiBinding?: string;
    isBackgroundTask: boolean;
}

export interface ApiUsageContext {
    charId?: string;
    charName?: string;
    apiRole?: ApiRole | string;
    apiBinding?: string;
    isBackgroundTask?: boolean;
}

const feature = (
    featureId: string,
    appId: AppID,
    appName: string,
    featureName: string,
    actionName: string,
    entryPath: string[],
    defaultApiRole: ApiRole,
    isBackgroundTask = true,
    apiBinding?: string,
): ApiUsageFeature => ({
    featureId,
    appId,
    appName,
    featureName,
    actionName,
    entryPath,
    defaultApiRole,
    isBackgroundTask,
    apiBinding,
});

export const API_USAGE_CATALOG = [
    feature('settings.mainApi.testConnection', AppID.Settings, '文具盒', '主 API', '测试连接', ['文具盒', '模型与服务', '主 API', '测试连接'], 'main', false),
    feature('settings.mainApi.fetchModels', AppID.Settings, '文具盒', '主 API', '拉取模型列表', ['文具盒', '模型与服务', '主 API', '拉取模型'], 'main', false),
    feature('settings.auxApi.testConnection', AppID.Settings, '文具盒', '副 API', '测试连接', ['文具盒', '模型与服务', '副 API', '测试连接'], 'aux', false),
    feature('settings.auxApi.fetchModels', AppID.Settings, '文具盒', '副 API', '拉取模型列表', ['文具盒', '模型与服务', '副 API', '拉取模型'], 'aux', false),

    feature('chat.privateReply', AppID.GroupChat, '絮语', '私聊回复', '生成角色回复', ['絮语', '私聊', '发送消息'], 'main', false),
    feature('chat.groupReply', AppID.GroupChat, '絮语', '群聊回复', '生成群聊回复', ['絮语', '群聊', '发送消息'], 'main', false),
    feature('chat.parallelReply', AppID.GroupChat, '絮语', '并发回复', '后台补发其他私聊回复', ['絮语', '私聊', '并发回复'], 'aux'),
    feature('chat.liveDraftReply', AppID.GroupChat, '絮语', '实时草稿回复', '感知未发送草稿并回复', ['絮语', '实时聊天模式', '草稿感知'], 'main', false),
    feature('chat.livePrivateInterject', AppID.GroupChat, '絮语', '实时私聊串门（已停用）', '历史记录兼容', ['絮语', '实时聊天模式', '历史记录'], 'aux'),
    feature('chat.groupLiveDraft', AppID.GroupChat, '絮语', '群聊实时草稿', '群成员感知未发送草稿', ['絮语', '群聊', '实时聊天模式'], 'main', false),
    feature('chat.proactiveReply', AppID.GroupChat, '絮语', '主动消息', '生成角色主动回复', ['絮语', '主动消息'], 'main'),
    feature('chat.unblockAppeal', AppID.GroupChat, '絮语', '解除拉黑验证', '生成角色申诉', ['絮语', '拉黑', '解除拉黑验证'], 'main'),
    feature('chat.autonomousLife', AppID.GroupChat, '絮语', '主动消息', '生成角色离线生活', ['絮语', '主动消息', '离线自主生活'], 'aux'),
    feature('chat.dashboard.digest', AppID.GroupChat, '絮语', '絮语总览', '生成今日摘要', ['絮语', '絮语总览', '今日摘要'], 'aux'),
    feature('chat.phoneTextReply', AppID.Phone, '回声亭', '文字通话', '生成通话文本回复', ['回声亭', '通话', '文字回复'], 'main', false),
    feature('chat.postProcess.diary', AppID.GroupChat, '絮语', '聊天后处理', '写入日记', ['絮语', '聊天', '后处理', '日记'], 'aux'),
    feature('chat.postProcess.xhs', AppID.GroupChat, '絮语', '聊天后处理', '生成小红书内容', ['絮语', '聊天', '后处理', '小红书'], 'aux'),
    feature('chat.postProcess.scrap', AppID.GroupChat, '絮语', '聊天后处理', '生成调阅内容', ['絮语', '聊天', '后处理', '调阅'], 'aux'),
    feature('chat.postProcess.summary', AppID.GroupChat, '絮语', '聊天后处理', '整理归档总结', ['絮语', '聊天', '后处理', '总结'], 'aux'),
    feature('chat.postProcess.emotionEval', AppID.GroupChat, '絮语', '聊天后处理', '情绪评估', ['絮语', '聊天', '后处理', '情绪评估'], 'aux'),
    feature('chat.postProcess.search', AppID.GroupChat, '絮语', '聊天后处理', '联网搜索后续回复', ['絮语', '聊天', '后处理', '联网搜索'], 'aux'),
    feature('chat.postProcess.note', AppID.GroupChat, '絮语', '聊天后处理', '翻阅笔记后续回复', ['絮语', '聊天', '后处理', '笔记'], 'aux'),
    feature('chat.moments.refresh', AppID.GroupChat, '絮语', '此刻', '刷新角色动态', ['絮语', '底栏：此刻', '刷新'], 'aux'),
    feature('chat.moments.autoPost', AppID.GroupChat, '絮语', '此刻', '角色主动发动态', ['絮语', '底栏：此刻', '主动发动态'], 'aux'),
    feature('chat.moments.reactions', AppID.GroupChat, '絮语', '此刻', '生成角色互动', ['絮语', '底栏：此刻', '角色互动'], 'aux'),
    feature('chat.moments.commentReplies', AppID.GroupChat, '絮语', '此刻', '回复用户评论', ['絮语', '底栏：此刻', '评论回复'], 'aux'),
    feature('chat.coupleSpace.moment', AppID.GroupChat, '絮语', '情侣空间', '角色发布动态', ['絮语', '情侣空间', '动态'], 'aux'),
    feature('chat.coupleSpace.comment', AppID.GroupChat, '絮语', '情侣空间', '角色评论动态', ['絮语', '情侣空间', '动态评论'], 'aux'),
    feature('chat.coupleSpace.whisper', AppID.GroupChat, '絮语', '情侣空间', '回复悄悄话', ['絮语', '情侣空间', '悄悄话'], 'aux'),
    feature('chat.coupleSpace.interaction', AppID.GroupChat, '絮语', '情侣空间', '回应每日互动', ['絮语', '情侣空间', '每日互动'], 'aux'),
    feature('chat.coupleSpace.innerVoice', AppID.GroupChat, '絮语', '情侣空间', '偷看心声', ['絮语', '情侣空间', '心声'], 'aux'),
    feature('chat.coupleSpace.question', AppID.GroupChat, '絮语', '情侣空间', '回答提问箱', ['絮语', '情侣空间', '提问箱'], 'aux'),
    feature('chat.coupleSpace.compat', AppID.GroupChat, '絮语', '情侣空间', '默契大考验', ['絮语', '情侣空间', '默契大考验'], 'aux'),
    feature('chat.coupleSpace.autoCare', AppID.GroupChat, '絮语', '情侣空间', '后台自经营', ['絮语', '情侣空间', '后台自经营'], 'aux'),
    feature('chat.coupleSpace.recap', AppID.GroupChat, '絮语', '情侣空间', '生成关系回顾', ['絮语', '情侣空间', '回顾'], 'aux'),
    feature('chat.tabloid', AppID.GroupChat, '絮语', '关系回顾', '生成日周月回顾摘要', ['絮语', '聊天设置', '回顾摘要'], 'aux'),
    feature('chat.translation', AppID.GroupChat, '絮语', '聊天翻译', '翻译消息', ['絮语', '聊天', '翻译'], 'custom', false, '翻译 API'),
    feature('chat.relationshipNetwork', AppID.GroupChat, '絮语', '关系网', '后台生成角色互动', ['絮语', '关系网', '后台互动'], 'aux'),
    feature('chat.recenter', AppID.GroupChat, '絮语', '回神', '角色自我校准', ['絮语', '聊天工具', '回神'], 'main', false),
    feature('chat.offlineMode', AppID.GroupChat, '絮语', '线下模式', '生成线下面对面情景', ['絮语', '聊天工具', '线下模式'], 'main', false),
    feature('chat.groupOfflineMode', AppID.GroupChat, '絮语', '群聊线下模式', '生成群体见面情景', ['絮语', '群聊', '线下模式'], 'main', false),
    feature('chat.inputAnimation', AppID.GroupChat, '絮语', '聊天外观', '生成输入栏动效', ['絮语', '聊天设置', '输入动效'], 'aux', false),
    feature('chat.userActionSuggest', AppID.GroupChat, '絮语', '行动选择器', '生成用户可选回复', ['絮语', '聊天', '行动选择器'], 'aux', false),
    feature('chat.memoGenerate', AppID.GroupChat, '絮语', '角色备忘录', '生成角色备忘录', ['絮语', '聊天设置', '角色备忘录'], 'aux', false),
    feature('chat.friendVerify', AppID.GroupChat, '絮语', '好友验证', '判断好友验证', ['絮语', '加好友', '好友验证'], 'aux', false),
    feature('chat.lockScreen', AppID.GroupChat, '絮语', '锁屏互动', '生成锁屏内容', ['絮语', '聊天设置', '锁屏互动'], 'main', false),
    feature('chat.userScreenWatch.comment', AppID.GroupChat, '絮语', '观屏评论', '生成实时短评', ['絮语', '私聊工具', '观屏评论'], 'main', false),
    feature('chat.conversationSettings', AppID.GroupChat, '絮语', '聊天设置', '生成设置建议', ['絮语', '聊天设置'], 'main', false),
    feature('chat.emotionApi.fetchModels', AppID.GroupChat, '絮语', '聊天设置', '拉取日程 / 心情 API 模型', ['絮语', '聊天设置', '日程 / 心情 API', '拉取模型'], 'custom', false, '日程 / 心情 API'),
    feature('chat.proactiveApi.fetchModels', AppID.GroupChat, '絮语', '主动消息', '拉取主动消息 API 模型', ['絮语', '聊天设置', '主动消息', '副 API', '拉取模型'], 'custom', false, '主动消息 API'),
    feature('chat.activeMsg2Api.fetchModels', AppID.GroupChat, '絮语', '主动消息 2.0', '拉取主动消息 2.0 API 模型', ['絮语', '聊天设置', '主动消息 2.0', '单独 API', '拉取模型'], 'custom', false, '主动消息 2.0 API'),

    feature('memoryPalace.topicSplit', AppID.MemoryPalace, '回忆标本馆', '后台整理', '话题切分', ['回忆标本馆', '后台整理', '话题切分'], 'aux'),
    feature('memoryPalace.extraction', AppID.MemoryPalace, '回忆标本馆', '后台整理', '记忆提取', ['回忆标本馆', '后台整理', '记忆提取'], 'aux'),
    feature('memoryPalace.eventBoxCompression', AppID.MemoryPalace, '回忆标本馆', '后台整理', '事件盒压缩', ['回忆标本馆', '后台整理', '事件盒压缩'], 'aux'),
    feature('memoryPalace.links', AppID.MemoryPalace, '回忆标本馆', '后台整理', '关联分析', ['回忆标本馆', '后台整理', '关联分析'], 'aux'),
    feature('memoryPalace.cognition', AppID.MemoryPalace, '回忆标本馆', '后台整理', '认知消化', ['回忆标本馆', '后台整理', '认知消化'], 'aux'),
    feature('memoryPalace.personality', AppID.MemoryPalace, '回忆标本馆', '后台整理', '人格检测', ['回忆标本馆', '后台整理', '人格检测'], 'aux'),
    feature('memoryPalace.groupExtraction', AppID.MemoryPalace, '回忆标本馆', '群聊记忆', '群聊记忆处理', ['回忆标本馆', '群聊记忆'], 'aux'),
    feature('memoryPalace.migration', AppID.MemoryPalace, '回忆标本馆', '导入旧记忆', '重处理旧记忆', ['回忆标本馆', '设置', '导入旧记忆'], 'aux'),

    feature('character.create', AppID.Personas, '剪影集', '登场人物', '生成角色卡', ['剪影集', '登场人物', '生成角色'], 'aux', false),
    feature('character.refine', AppID.Personas, '剪影集', '登场人物', '润色角色卡', ['剪影集', '登场人物', '润色'], 'aux', false),
    feature('character.importParse', AppID.Personas, '剪影集', '登场人物', '解析导入文本', ['剪影集', '登场人物', '导入'], 'aux', false),
    feature('character.lifeProfile', AppID.Personas, '剪影集', '登场人物', '生成生活侧写', ['剪影集', '登场人物', '生活侧写'], 'aux'),
    feature('character.appearanceTags', AppID.Personas, '剪影集', '登场人物', '生成外貌标签', ['剪影集', '登场人物', '扮相手账'], 'aux'),
    feature('character.memoryArchive', AppID.Personas, '剪影集', '登场人物', '整理核心记忆', ['剪影集', '登场人物', '记忆整理'], 'aux'),

    feature('almanac.scheduleGenerate', AppID.Almanac, '岁时记', '时光契约', '生成日程', ['岁时记', '时光契约', '日程表'], 'aux'),
    feature('almanac.scheduleReconcile', AppID.Almanac, '岁时记', '时光契约', '日程协调', ['岁时记', '时光契约', '日程协调'], 'aux'),
    feature('almanac.flowNarrative', AppID.Almanac, '岁时记', '时光契约', '进化意识流独白', ['岁时记', '时光契约', '意识流独白'], 'aux'),
    feature('almanac.calendarMarks', AppID.Almanac, '岁时记', '共享月历', '生成角色标记', ['岁时记', '共享月历'], 'aux'),

    feature('date.worldEngine', AppID.LifeSim, '街角', '世界引擎', '调度场景', ['街角', '约会世界', '世界引擎'], 'aux'),
    feature('date.scene', AppID.LifeSim, '街角', '约会场景', '生成场景', ['街角', '约会世界', '场景'], 'aux'),
    feature('date.reply', AppID.LifeSim, '街角', '约会回复', '生成约会回复', ['街角', '约会世界', '对话'], 'aux', false),
    feature('date.summary', AppID.LifeSim, '街角', '会话总结', '总结约会上文', ['街角', '约会世界', '总结'], 'aux'),
    feature('date.memory', AppID.LifeSim, '街角', '后台记忆', '处理约会记忆', ['街角', '约会世界', '后台记忆'], 'aux'),
    feature('date.independentApi.fetchModels', AppID.LifeSim, '街角', '独立 API', '拉取街角独立 API 模型', ['街角', '设定', '独立 API', '拉取模型'], 'custom', false, '街角独立 API'),

    feature('theater.guidebook', AppID.Theater, '折子戏', '攻略本', '生成攻略内容', ['折子戏', '攻略本'], 'aux', false),
    feature('theater.extra', AppID.Theater, '折子戏', '番外', '生成番外内容', ['折子戏', '番外'], 'aux', false),
    feature('theater.divination', AppID.Theater, '折子戏', '占卜', '解读牌面', ['折子戏', '占卜'], 'aux', false),
    feature('theater.talkTherapy', AppID.Theater, '折子戏', '谈心', '生成谈心回复', ['折子戏', '谈心'], 'aux', false),
    feature('theater.trpg', AppID.Theater, '折子戏', 'TRPG', '生成跑团内容', ['折子戏', 'TRPG'], 'aux', false),
    feature('theater.timeline', AppID.Theater, '折子戏', '轨迹', '生成轨迹片段', ['折子戏', '轨迹'], 'aux', false),
    feature('theater.reflection', AppID.Theater, '折子戏', '对影', '生成对影内容', ['折子戏', '对影'], 'aux', false),
    feature('theater.werewolf', AppID.Theater, '折子戏', '狼人杀', '生成对局行动', ['折子戏', '狼人杀'], 'aux', false),
    feature('theater.truthDare', AppID.Theater, '折子戏', '真心话大冒险', '生成题目与回答', ['折子戏', '真心话大冒险'], 'aux', false),

    feature('bank.lifeAi', AppID.Bank, '人生拟', '人生拟', '生成资产与经营文本', ['人生拟', '资产与经营'], 'aux'),
    feature('bank.jobSearch', AppID.Bank, '人生拟', '求职', 'AI 找岗位', ['人生拟', '求职', 'AI 找岗位'], 'aux'),
    feature('bank.resumeReview', AppID.Bank, '人生拟', '求职', '评估简历匹配', ['人生拟', '求职', '简历匹配'], 'aux'),
    feature('bank.recruiterChat', AppID.Bank, '人生拟', '求职', '生成 HR 回复', ['人生拟', '求职', 'HR 沟通'], 'aux'),
    feature('bank.jobStage', AppID.Bank, '人生拟', '求职', '判定求职阶段', ['人生拟', '求职', '阶段推进'], 'aux'),
    feature('bank.dashboardInsight', AppID.Bank, '人生拟', '首页看板', '生成资产建议', ['人生拟', '首页', 'AI 建议'], 'aux'),
    feature('bank.shopAction', AppID.Bank, '人生拟', '经营', '生成经营点评', ['人生拟', '经营', '动作点评'], 'aux'),
    feature('bank.investAdvice', AppID.Bank, '人生拟', '投资', '生成行情点评', ['人生拟', '投资', '行情点评'], 'aux'),
    feature('bank.stockOrder', AppID.Bank, '人生拟', '投资', '生成订单点评', ['人生拟', '投资', '订单点评'], 'aux'),
    feature('bank.companyAction', AppID.Bank, '人生拟', '公司', '生成公司事项点评', ['人生拟', '公司', '动作点评'], 'aux'),
    feature('bank.loanReview', AppID.Bank, '人生拟', '借款', '审核虚拟借款', ['人生拟', '借款', '审核'], 'aux'),
    feature('bank.ledgerInsight', AppID.Bank, '人生拟', '账本', '生成账本洞察', ['人生拟', '账本', 'AI 洞察'], 'aux'),
    feature('browser.answer', AppID.Browser, '浏览器', '浏览器', '生成网页 / 搜索内容', ['浏览器', '搜索'], 'aux', false),
    feature('gallery.caption', AppID.Gallery, '相册', '相册 / 相机', '识图与点评', ['相册', '图片识别'], 'main', false),
    feature('checkPhone.generate', AppID.CheckPhone, '查岗', '查岗', '生成手机内容', ['絮语', '聊天', '查岗'], 'aux', false),
    feature('room.generate', AppID.Room, '栖居志', '栖居志', '生成房间内容', ['栖居志'], 'aux', false),
    feature('room.decoration', AppID.Room, '栖居志', '房间布置', '角色自主装修', ['栖居志', '房间布置'], 'aux'),
    feature('study.generate', AppID.Study, '自习室', '自习室', '生成学习陪伴', ['自习室'], 'aux', false),
    feature('study.dedicatedApi.fetchModels', AppID.Study, '自习室', '专用 API', '拉取学习社专用 API 模型', ['自习室', '设置', '专用 API', '拉取模型'], 'custom', false, '学习社专用 API'),
    feature('journal.generate', AppID.Journal, '日记', '日记', '生成日记内容', ['日记'], 'aux', false),
    feature('social.generate', AppID.Social, '见闻簿', '见闻簿', '生成信息流 / 熟人近况', ['见闻簿', '熟人近况'], 'aux'),
    feature('social.reply', AppID.Social, '见闻簿', '见闻簿', '生成作者评论回复', ['见闻簿', '评论'], 'aux', false),
    feature('social.profile', AppID.Social, '见闻簿', '角色主页', '生成社交资料', ['见闻簿', '角色主页'], 'aux', false),
    feature('social.dating', AppID.Social, '见闻簿', '交友', '生成交友卡片 / 回复', ['见闻簿', '交友'], 'aux', false),
    feature('social.dedicatedApi.fetchModels', AppID.Social, '见闻簿', '专用 API', '拉取模型列表', ['见闻簿', '右上角', '专用 API', '拉取模型'], 'custom', false, '见闻簿专用 API'),
    feature('coview.discuss', AppID.CoView, '共览', '共览讨论', '生成角色共看 / 共读回应，可携带影院视觉帧', ['共览', '影院 / 阅读', '共览讨论'], 'aux', false),
    feature('coview.search', AppID.CoView, '共览', '影院搜索', '搜索共看影片资料', ['共览', '影院', '搜索'], 'aux', false),
    feature('takeout.generate', AppID.Takeout, '饭票', '饭票', '生成店铺 / 订单内容', ['饭票'], 'aux', false),
    feature('shop.generate', AppID.Shop, '心意铺', '心意铺', '生成商品 / 反馈内容', ['心意铺'], 'aux'),
    feature('forum.generate', AppID.Forum, '茶话亭', '茶话亭', '生成论坛内容', ['茶话亭'], 'aux'),
    feature('twitter.generate', AppID.Twitter, '推特', '推特', '生成时间线内容', ['推特'], 'aux'),
    feature('xunji.generate', AppID.Xunji, '循迹', '循迹', '生成 Screenlife 内容', ['循迹'], 'aux', false),
    feature('xhsFreeRoam.generate', AppID.CoView, '共览', '自由活动', '生成小红书行动', ['共览', '自由活动'], 'aux'),
    feature('theater.extraApi.fetchModels', AppID.Theater, '折子戏', '番外专用 API', '拉取模型列表', ['折子戏', '番外', '专用 API', '拉取模型'], 'custom', false, '折子戏番外专用 API'),
    feature('vrWorld.session', AppID.VRWorld, '页外', '页外', '角色自主登录', ['页外', '角色活动'], 'custom'),
    feature('vrWorld.theater', AppID.VRWorld, '页外', '彼方·剧院', '编排剧本与演员意见', ['页外', '彼方·剧院'], 'custom', false, '彼方独立 API'),
    feature('special.valentineApi.fetchModels', AppID.SpecialMoments, '岁时记', '情人节活动', '拉取情人节活动 API 模型', ['岁时记', '特别时光', '情人节', 'API 配置', '拉取模型'], 'main', false, '情人节活动 API'),
    feature('special.whiteDayApi.fetchModels', AppID.SpecialMoments, '岁时记', '白色情人节活动', '拉取白色情人节活动 API 模型', ['岁时记', '特别时光', '白色情人节', 'API 配置', '拉取模型'], 'main', false, '白色情人节活动 API'),
    feature('special.valentine.generate', AppID.SpecialMoments, '岁时记', '情人节活动', '生成活动剧情', ['岁时记', '特别时光', '情人节'], 'main', false, '情人节活动 API'),
    feature('special.whiteDay.generate', AppID.SpecialMoments, '岁时记', '白色情人节活动', '生成活动剧情', ['岁时记', '特别时光', '白色情人节'], 'main', false, '白色情人节活动 API'),
    feature('special.like520Api.fetchModels', AppID.SpecialMoments, '岁时记', '520 活动', '拉取 520 活动 API 模型', ['岁时记', '特别时光', '520 活动', 'API 配置', '拉取模型'], 'main', false, '520 活动 API'),
    feature('special.like520.generate', AppID.SpecialMoments, '岁时记', '520 活动', '生成活动剧情', ['岁时记', '特别时光', '520 活动'], 'main', false, '520 活动 API'),
    feature('pixelHome.memoryDive.explore', AppID.Room, '栖居志', '记忆潜行', '生成探访对话', ['栖居志', '记忆潜行', '探访'], 'aux'),
    feature('pixelHome.memoryDive.script', AppID.Room, '栖居志', '记忆潜行', '生成房间剧本', ['栖居志', '记忆潜行', '剧本'], 'aux'),
    feature('pixelHome.memoryDive.buff', AppID.Room, '栖居志', '记忆潜行', '结算情绪影响', ['栖居志', '记忆潜行', '情绪结算'], 'aux'),
    feature('creative.novel', AppID.Creative, '创作社', '笔友会', '生成小说内容', ['创作社', '笔友会'], 'aux', false),
    feature('creative.songwriting', AppID.Creative, '创作社', '写歌', '生成歌词 / 编曲文案', ['创作社', '写歌'], 'aux', false),
    feature('handbook.compose', AppID.Handbook, '手账', '手账编排', '填充手账版式槽位', ['手账', '自动编排'], 'aux'),
    feature('handbook.userDiary', AppID.Handbook, '手账', '用户日记', '生成用户手账碎片', ['手账', '用户日记'], 'aux'),
    feature('handbook.lifeStream', AppID.Handbook, '手账', '角色生活流', '生成角色手账碎片', ['手账', '角色生活流'], 'aux'),
    feature('music.persona', AppID.Music, '音乐', '角色音乐主页', '初始化音乐人格', ['音乐', '角色主页', '初始化'], 'aux', false),
    feature('music.listenTogether', AppID.Music, '音乐', '一起听', '生成听歌对话与控制', ['音乐', '一起听'], 'aux', false),
    feature('music.comment', AppID.Music, '音乐', '评论区', '生成角色乐评', ['音乐', '评论区', '角色乐评'], 'aux', false),
    feature('music.commentReply', AppID.Music, '音乐', '评论区', '回复用户留言', ['音乐', '评论区', '回复'], 'aux', false),
    feature('manual.unknownLlm', AppID.Manual, '说明书', '未归类 LLM', '兼容旧调用', ['说明书', '旧记录'], 'custom'),
] as const satisfies readonly ApiUsageFeature[];

const CATALOG_BY_ID = new Map<string, ApiUsageFeature>(API_USAGE_CATALOG.map(item => [item.featureId, item]));

export function getApiUsageFeature(featureId?: string): ApiUsageFeature | undefined {
    return featureId ? CATALOG_BY_ID.get(featureId) : undefined;
}

export function isApiUsageFeatureId(featureId?: string): boolean {
    return !!getApiUsageFeature(featureId);
}

export function normalizeApiRole(role?: string, fallback: ApiRole = 'custom'): ApiRole {
    return role === 'main' || role === 'aux' || role === 'custom' ? role : fallback;
}

export function makeApiUsageMeta(featureId: string, context: ApiUsageContext = {}): ApiCallMeta {
    const feature = getApiUsageFeature(featureId);
    const apiRole = normalizeApiRole(context.apiRole, feature?.defaultApiRole ?? 'custom');
    const apiBinding = context.apiBinding || (context.apiRole && !['main', 'aux', 'custom'].includes(context.apiRole)
        ? context.apiRole
        : undefined);
    if (!feature) {
        return {
            featureId,
            charId: context.charId,
            charName: context.charName,
            apiRole,
            apiBinding,
            isBackgroundTask: context.isBackgroundTask,
        };
    }
    return {
        featureId,
        appId: feature.appId,
        appName: feature.appName,
        charId: context.charId,
        charName: context.charName,
        purpose: `${feature.featureName} · ${feature.actionName}`,
        apiRole,
        apiBinding: apiBinding || feature.apiBinding,
        isBackgroundTask: context.isBackgroundTask ?? feature.isBackgroundTask,
    };
}

export function hydrateApiUsageMeta(meta?: ApiCallMeta): ApiCallMeta {
    const feature = getApiUsageFeature(meta?.featureId);
    if (!feature) {
        const apiRole = normalizeApiRole(meta?.apiRole, 'custom');
        return {
            ...meta,
            apiRole,
            apiBinding: meta?.apiBinding || (meta?.apiRole && meta.apiRole !== apiRole ? meta.apiRole : undefined),
        };
    }
    const apiRole = normalizeApiRole(meta?.apiRole, feature.defaultApiRole);
    return {
        ...meta,
        appId: feature.appId,
        appName: feature.appName,
        purpose: meta?.purpose || `${feature.featureName} · ${feature.actionName}`,
        apiRole,
        apiBinding: meta?.apiBinding || feature.apiBinding || (meta?.apiRole && meta.apiRole !== apiRole ? meta.apiRole : undefined),
        isBackgroundTask: meta?.isBackgroundTask ?? feature.isBackgroundTask,
        featureName: feature.featureName,
        actionName: feature.actionName,
        entryPath: feature.entryPath,
    };
}
