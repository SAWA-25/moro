import React, { useMemo, useState } from 'react';
import { useOS } from '../context/OSContext';
import {
  ArrowLeft,
  BookOpenText,
  MagnifyingGlass,
  ChatCircleText,
  Sparkle,
  GearSix,
  Wrench,
  CaretRight,
  type Icon,
} from '@phosphor-icons/react';
import { Icons, INSTALLED_APPS } from '../constants';
import { AppID } from '../types';

type ManualCategory = 'daily' | 'social' | 'creation' | 'roleplay' | 'system';

interface ManualEntry {
  app: string;
  en: string;
  category: ManualCategory;
  summary: string;
  features: string[];
  tips?: string[];
}

interface ManualDestination {
  appId: AppID;
  path: string[];
  details: string[];
  jumpText?: string;
}

const CATEGORY_META: Record<ManualCategory, { label: string; en: string; Icon: Icon }> = {
  daily: { label: '日常与陪伴', en: 'Daily', Icon: Sparkle },
  social: { label: '社交与消息', en: 'Social', Icon: ChatCircleText },
  creation: { label: '创作与记录', en: 'Create', Icon: BookOpenText },
  roleplay: { label: '剧场与世界', en: 'Play', Icon: CaretRight },
  system: { label: '系统与工具', en: 'Tools', Icon: GearSix },
};

const MANUAL_ENTRIES: ManualEntry[] = [
  {
    app: '说明书',
    en: 'Manual',
    category: 'system',
    summary: '当前这本 App 功能手册，按分类收纳整机可操作入口。',
    features: [
      '左侧按 App / 入口浏览，右侧查看功能清单。',
      '顶部搜索可按 App 名、页面名或功能关键词查找。',
      '分类按钮可切换日常与陪伴、社交与消息、创作与记录、剧场与世界、系统与工具。',
      '这里只记录用户能在界面里看到、打开和操作的 App 内容。',
    ],
    tips: ['新增功能后，把用户能点到的入口也补到这里，方便以后自查。'],
  },
  {
    app: '絮语',
    en: 'Chat Hub',
    category: 'social',
    summary: '来往主入口，负责单聊、群聊、名册、此刻、朋友圈与关系互动。',
    features: [
      '在会话列表进入单聊或群聊，管理未读、置顶、静音、删除和归档。',
      '单聊支持发文字、图片、语音、表情包、转账 / 红包、礼物、外卖、求婚、电话与视频通话。',
      '聊天设置里可配置主动消息、离线模式、群离线、聊天外观、表情包权限、背景、引用、撤回等习惯。',
      '「+」面板可进入查岗、见面、点外卖、送礼、求婚、查看关系等扩展玩法。',
      '群聊支持群成员、群公告 / 群名片、群投票、群语音、群离线模拟和群关系氛围。',
      '「此刻 / 朋友圈」让角色和用户发布动态、评论互动，回看彼此的生活片段。',
      '情侣空间从来往相关入口进入，可绑定另一半、看恋爱天数 / 亲密度、写留言板、相册、纪念日、每日互动、任务和悄悄话。',
    ],
    tips: ['聊天基础配置在「文具盒」，角色和用户身份在「剪影集」。'],
  },
  {
    app: '剪影集',
    en: 'Persona Hub',
    category: 'system',
    summary: '角色档案与用户人设的合并入口，决定聊天里“对面是谁”和“你是谁”。',
    features: [
      '「登场人物」中新建、编辑、删除角色，设置头像、人设、开场白、城市、语音和生活侧写。',
      '角色档案可管理长期关系、记忆、备注、表情、相册、声音、见面立绘等角色相关资料。',
      '用户身份页可管理多套身份：名字、头像、自述、默认身份和角色 / 群聊绑定。',
      '可给人设绑定世界书分组，让对应身份自带额外设定。',
    ],
  },
  {
    app: '剪报夹',
    en: 'Worldbook',
    category: 'system',
    summary: '设定资料夹，用条目保存世界观、背景、规则和补充信息。',
    features: [
      '创建世界书分组和条目，设置关键词、内容、启用状态、全局 / 局部作用域。',
      '可选择条目适用的角色或群聊，控制哪些设定在对应聊天里生效。',
      '用于补充世界观、关系背景、剧情规则、禁忌、记忆线索或长期设定。',
    ],
    tips: ['世界书内容会影响模型行为，写得越具体越稳定。'],
  },
  {
    app: '活字盘',
    en: 'Chat Style',
    category: 'system',
    summary: '聊天风格管理器，用来切换不同的对话规则和回复手感。',
    features: [
      '新建、复制、导入、导出聊天风格方案。',
      '调整规则内容、顺序、开关和适用角色。',
      '设置回复自由度、回复长度等选项，并可绑定「文具盒」里的连接配置。',
      '切换当前使用的方案，让不同聊天采用不同风格。',
    ],
  },
  {
    app: '补丁铺',
    en: 'Text Tools',
    category: 'system',
    summary: '文本处理脚本管理器，用来自动替换、清理或美化聊天文字。',
    features: [
      '新建、导入、导出文本处理脚本。',
      '编辑查找内容、替换内容、使用范围和启用状态。',
      '可用于统一称呼、替换口癖、收起标签、整理显示格式。',
    ],
    tips: ['文本脚本会影响聊天显示和收发内容，建议每次只改一两条并测试聊天效果。'],
  },
  {
    app: '文具盒',
    en: 'Settings',
    category: 'system',
    summary: '系统设置中心，集中管理聊天连接、备份、实时感知、通知和安全。',
    features: [
      '配置聊天模型连接，管理多个连接方案。',
      '导入 / 导出本地备份，恢复角色、聊天、设置和素材。',
      '配置实时感知：天气、新闻热点、个人笔记、小红书 / 麦当劳等外部服务。',
      '设置主动消息、浏览器通知、锁屏密码和版本信息。',
      '可测试连接、诊断通知订阅、重置推送状态。',
    ],
  },
  {
    app: '拼贴册',
    en: 'Appearance',
    category: 'system',
    summary: '整机外观和聊天皮肤编辑器。',
    features: [
      '更换壁纸、深浅色、桌面字体、图标形状、图标材质和桌面装饰。',
      '配置桌面小组件显示、尺寸和照片槽。',
      '编辑聊天默认外观：气泡、背景、顶栏、底栏、CSS、发送按钮等。',
      '可管理主题、导入导出外观方案，把同一套皮肤应用到多个会话。',
    ],
  },
  {
    app: '相册',
    en: 'Gallery',
    category: 'daily',
    summary: '按角色收纳聊天中保存的图片。',
    features: [
      '按角色进入相册，浏览聊天保存的照片。',
      '查看单张照片时可看到保存时间和聊天上下文。',
      '可让角色对照片进行简短点评。',
      '长按相册可清空角色相册，详情页可删除单张照片。',
    ],
  },
  {
    app: '音乐',
    en: 'Music',
    category: 'daily',
    summary: '本地音乐、角色听歌、歌词评论和一起听的入口。',
    features: [
      '播放音乐库歌曲，使用全局迷你播放器继续控制播放。',
      '查看角色听歌记录、访问角色的音乐页。',
      '角色可根据人设、心情和聊天主动推荐歌曲或写下评论。',
      '写歌作品可以进入音乐库继续播放和回看。',
    ],
  },
  {
    app: '热点',
    en: 'Hot News',
    category: 'daily',
    summary: '多平台热榜可视化，也是角色实时感知新闻的来源之一。',
    features: [
      '按时间段拉取微博、知乎、B站、抖音等平台热点。',
      '点击刷新可强制重新获取当前时段榜单。',
      '可把某条热点转发给指定角色形成聊天新闻卡。',
      '开启实时感知后，角色会偶尔把热点当背景认知自然聊起。',
    ],
  },
  {
    app: '回忆标本馆',
    en: 'Memory Palace',
    category: 'daily',
    summary: '长期记忆的浏览与整理空间。',
    features: [
      '查看角色长期记忆、事件盒、月度总结、情绪空间和相关记忆。',
      '浏览记忆之间的关联网络，观察某些事件为什么会被想起。',
      '可进行记忆归档、清理、封盒和相关记忆查看。',
      '帮助整理角色记得的事，减少重复想起同一件事。',
    ],
  },
  {
    app: '栖居志',
    en: 'Room',
    category: 'daily',
    summary: '角色房间、像素小家和生活状态的可视化。',
    features: [
      '给角色布置房间：背景、地板、家具、装饰、食物和互动说明。',
      '点击房间物品可让角色产生反应或补充生活细节。',
      '查看角色日程、便签、待办和房间笔记。',
      '像素小家可编辑像素角色、房间和素材库。',
    ],
  },
  {
    app: '存钱罐',
    en: 'Bank',
    category: 'daily',
    summary: '虚拟资产、攒钱目标和经营小游戏。',
    features: [
      '查看账户、资产、流水、收入支出和消费分析。',
      '设置攒钱目标，记录和角色有关的虚拟经济事件。',
      '参与经营 / 商店类小游戏，使用资产推进玩法。',
      '部分红包、转账、购物、外卖等事件会与余额体验互相呼应。',
    ],
  },
  {
    app: '日记',
    en: 'Diary',
    category: 'creation',
    summary: '私人日记与角色视角记录。',
    features: [
      '写用户自己的日记，按日期保存和回看。',
      '角色可写日记、读过往日记，并把重要内容沉淀到记忆系统。',
      '支持从聊天和节日场景形成可回看的记录。',
    ],
  },
  {
    app: '见闻簿',
    en: 'Social',
    category: 'social',
    summary: '小红书式信息流和角色社交活动。',
    features: [
      '浏览小红书风格动态，搜索和刷新内容。',
      '用户可发布、点赞、收藏、评论或转发给角色。',
      '入口可跳到「自由活动」让角色自己刷小红书，也可进入「拾光图库」准备发帖素材。',
      '聊天 App 中的朋友圈标签页仍保留熟人动态互动。',
    ],
  },
  {
    app: '自习室',
    en: 'Study',
    category: 'creation',
    summary: '让角色陪你学习、出题和讲解。',
    features: [
      '创建课程、章节和学习材料。',
      '选择角色当学习搭子，围绕资料提问、讲解和复习。',
      '自动生成测验，完成后批改、评分、追问错题。',
      '学习记录可被收进典藏馆或长期记忆。',
    ],
  },
  {
    app: '折子戏',
    en: 'Theater',
    category: 'roleplay',
    summary: '九折剧场玩法合集，适合短篇互动、占卜、跑团和熟人小游戏。',
    features: [
      '壹「攻略本」：恋爱攻略小游戏，选项、好感和结算卡。',
      '贰「番外」：问卷、角色访谈、仿聊天截图、朋友圈、小红书、论坛等仿真图文。',
      '叁「占卜」：塔罗、雷诺曼、六爻、梅花易数，可自解或请角色解读。',
      '肆「谈心」：低压倾诉空间，让角色专门听你说。',
      '伍「TRPG」：AI 跑团冒险，自由行动、骰子判定和剧情回顾。',
      '陆「轨迹」：回看角色遇见你之前的人生节点。',
      '柒「对影」：同一角色不同时间线的重逢与分歧。',
      '捌「狼人杀」：一桌熟人随机身份，夜行动、昼发言和投票。',
      '玖「真心话大冒险」：转瓶子、真心话 / 大冒险、尺度可调。',
    ],
  },
  {
    app: '创作社',
    en: 'Creative Studio',
    category: 'creation',
    summary: '共创小说和共创歌曲的合并入口。',
    features: [
      '「笔友会」：与角色一起写小说，设置世界观、人物、章节和续写。',
      '「写歌」：和角色共创歌词、曲风、编曲说明和歌曲成品。',
      '作品可被保存、继续编辑，并与音乐库或典藏馆发生联动。',
    ],
  },
  {
    app: '页外',
    en: 'VR World',
    category: 'roleplay',
    summary: '角色自主登入的虚拟世界。',
    features: [
      '角色可以在虚拟房间里看小说、听歌、留言、行动和产生活动卡。',
      '可编辑虚拟形象、房间、跟随状态和自动行为。',
      '活动记录可以回看，也会影响角色之后提起的页外生活。',
    ],
  },
  {
    app: '岁时记',
    en: 'Almanac',
    category: 'daily',
    summary: '日程、纪念日、节日活动、典藏和婚姻筹备合集。',
    features: [
      '「时光契约」：要做的事、心愿单、纪念日倒数和角色监督。',
      '「这个月」：真实月历，用户和角色都能往日期贴便签。',
      '「典藏馆」：收藏谈心、同人、课业、剧目等内容，并可转发给角色。',
      '「喜事」：求婚成功后的订婚日、婚期、领证与婚礼筹备。',
      '「特别时光」：情人节、白色情人节、520 等节日互动页面。',
    ],
  },
  {
    app: '饭票',
    en: 'Takeout',
    category: 'daily',
    summary: '本地外卖模拟与聊天联动。',
    features: [
      '按城市生成店铺、菜品、满减、配送费和订单。',
      '搜索餐厅或菜品，下单后查看配送进度。',
      '可和商家 / 骑手聊天，自付或让角色代付。',
      '在聊天里给角色点外卖，角色会收到并作出反应。',
    ],
  },
  {
    app: '心意铺',
    en: 'Shop',
    category: 'daily',
    summary: '虚拟礼物商城。',
    features: [
      '浏览、搜索、收藏商品，加入购物车并下单。',
      '购买礼物送给角色，聊天中会落礼物卡并触发回应 / 感谢信。',
      '角色也可能自己逛、自己买或回赠。',
      '可查看订单、小票、物流和商品评价。',
    ],
  },
  {
    app: '椒房记',
    en: 'Harem',
    category: 'roleplay',
    summary: 'AI 后宫文游互动小说。',
    features: [
      '进入多角色宫廷 / 后宫式剧情，靠选择推进事件。',
      '好感、信任、嫉妒、记忆和事件 flag 会影响后续分支。',
      '支持存档、多周目和角色独立记忆。',
    ],
  },
  {
    app: '茶话亭',
    en: 'Forum',
    category: 'social',
    summary: '可浏览、发帖、回帖的论坛。',
    features: [
      '按板块浏览帖子、跟帖和热度。',
      '用户可发帖、回复、搜索和刷新。',
      '角色与匿名网友会盖楼、开帖、争论或围观。',
      '适合把关系问题、生活吐槽、求助和八卦做成公共舆论场。',
    ],
  },
  {
    app: '自由活动',
    en: 'XHS Free Roam',
    category: 'social',
    summary: '让角色自己使用小红书。',
    features: [
      '选择角色后，角色会根据性格和近期聊天决定刷帖、点赞、收藏、评论或发布。',
      '行动会生成可回看的活动记录。',
      '适合表现角色不围着用户转的社交生活。',
    ],
  },
  {
    app: '拾光图库',
    en: 'XHS Stock',
    category: 'social',
    summary: '小红书发帖素材库。',
    features: [
      '收集、管理、生成或挑选发帖图片素材。',
      '配合「见闻簿」和「自由活动」给角色准备图文动态。',
      '可作为角色发布内容时的图库来源。',
    ],
  },
  {
    app: '回声亭',
    en: 'Phone',
    category: 'social',
    summary: '电话入口，管理拨号、通话记录和录音回放。',
    features: [
      '从联系人发起语音通话，或接听角色主动来电。',
      '查看拨出、接听、未接记录。',
      '回放通话录音和逐字稿。',
      '通话中可暂停、挂断、回到聊天或由悬浮通话条恢复。',
    ],
  },
  {
    app: '街角',
    en: 'LifeSim',
    category: 'roleplay',
    summary: 'LifeSim 约会与小镇生活引擎。',
    features: [
      '在小世界里探索街区、NPC、关系和剧情动态。',
      '与角色进入约会世界，分话语 / 动作输入推进场景。',
      '世界引擎调度场景、分支、BGM、语音和每 20 回合总结。',
      '可查看离线生活回顾、关系页、地图、图鉴和设置。',
    ],
  },
];

const MANUAL_DESTINATIONS: Record<string, ManualDestination> = {
  '说明书': {
    appId: AppID.Manual,
    jumpText: '正在这里',
    path: ['桌面', '说明书'],
    details: [
      '适合不知道某个功能在哪、想快速回忆某个 App 能做什么时打开。',
      '搜索会同时匹配 App 名、页面名、功能说明和进入路径。',
      '右侧的打开按钮会直接带你去对应 App；合并入口会先打开总入口，再在 App 内选择具体页面。',
    ],
  },
  '絮语': {
    appId: AppID.GroupChat,
    path: ['桌面 / Dock', '絮语', '会话列表 / 群聊 / 此刻'],
    details: [
      '从列表点角色进入单聊，点群进入群聊；右上角和聊天设置里管理对应会话。',
      '单聊底部输入区可发文字、图片、语音，也能通过加号面板打开外卖、礼物、见面、查岗等扩展。',
      '角色资料页里可以发起语音 / 视频通话、查看关系和进入更多角色相关设置。',
      '此刻和朋友圈适合查看动态、评论互动，关系推进后也能进入情侣空间。',
    ],
  },
  '剪影集': {
    appId: AppID.Personas,
    path: ['桌面', '剪影集', '登场人物 / 用户身份页'],
    details: [
      '登场人物用于管理角色：头像、人设、开场白、城市、声音、生活侧写等都从这里维护。',
      '用户身份页用于管理“你是谁”：可以准备多套身份，并按角色或群聊自动使用。',
      '新角色、新身份、角色绑定和资料修订，都建议先从这里处理。',
    ],
  },
  '剪报夹': {
    appId: AppID.Worldbook,
    path: ['桌面', '剪报夹', '分组', '条目'],
    details: [
      '适合保存世界观、地点、组织、关系规则、长期背景和剧情设定。',
      '条目可以按关键词触发，也可以指定全局或某个角色 / 群聊使用。',
      '内容建议写成角色真正需要知道的信息，避免把操作说明和无关备注混在一起。',
    ],
  },
  '活字盘': {
    appId: AppID.Presets,
    path: ['桌面', '活字盘', '聊天风格方案'],
    details: [
      '适合准备不同聊天风格：日常陪伴、强剧情、轻松吐槽、严肃写作等。',
      '每套方案可以调整规则内容、开关、顺序和回复自由度。',
      '如果某个角色回复风格不对，可以先检查当前使用的是哪套方案。',
    ],
  },
  '补丁铺': {
    appId: AppID.Regex,
    path: ['桌面', '补丁铺', '文本处理脚本'],
    details: [
      '适合处理固定替换：统一称呼、收起标签、清理多余格式、替换口癖。',
      '脚本可以按使用范围开启或关闭，改动后建议回到聊天里发一两句测试。',
      '如果聊天文字突然显示异常，优先检查最近新增或开启的脚本。',
    ],
  },
  '文具盒': {
    appId: AppID.Settings,
    path: ['桌面 / Dock', '文具盒', '系统设置'],
    details: [
      '第一次使用通常先在这里配置聊天连接，再回到絮语开始聊天。',
      '备份与恢复、通知、主动消息、天气新闻等全局能力都在这里管理。',
      '遇到连接失败、通知不响、数据迁移等问题，也优先从这里排查。',
    ],
  },
  '拼贴册': {
    appId: AppID.Appearance,
    path: ['桌面', '拼贴册', '整机外观 / 聊天皮肤'],
    details: [
      '适合调整整台手机的观感：壁纸、图标、字体、桌面装饰和小组件。',
      '也能设置聊天界面的气泡、背景、顶栏、底栏和发送按钮。',
      '想让不同会话拥有统一风格时，可以先做主题，再批量套用。',
    ],
  },
  '相册': {
    appId: AppID.Gallery,
    path: ['桌面', '相册', '角色相册', '照片详情'],
    details: [
      '照片按角色分册保存，适合回看聊天中留下的图片。',
      '进入照片详情可查看保存时间、上下文，并让角色评论这张图。',
      '长按角色相册可以清空整本，进入详情后可以删除单张。',
    ],
  },
  '音乐': {
    appId: AppID.Music,
    path: ['桌面', '音乐', '音乐库 / 角色音乐页'],
    details: [
      '适合播放本地音乐、查看角色听歌记录，以及回看角色对歌曲的评论。',
      '写歌作品会进入音乐库，之后可以继续播放和整理。',
      '离开音乐 App 后，桌面或全局迷你播放器仍可继续控制播放。',
    ],
  },
  '热点': {
    appId: AppID.HotNews,
    path: ['桌面', '热点', '平台榜单'],
    details: [
      '按时段查看多平台热榜，适合快速知道今天外面在聊什么。',
      '点刷新可以重新拉取当前时段内容。',
      '看到想聊的新闻，可以转发给某个角色变成聊天卡片。',
    ],
  },
  '回忆标本馆': {
    appId: AppID.MemoryPalace,
    path: ['桌面', '回忆标本馆', '记忆 / 事件盒 / 心意图谱'],
    details: [
      '适合查看角色到底记住了哪些事，以及这些记忆之间有什么关联。',
      '事件盒和月度总结适合回看阶段性关系变化。',
      '如果觉得角色重复提同一件事或记忆太乱，可以来这里整理。',
    ],
  },
  '栖居志': {
    appId: AppID.Room,
    path: ['桌面', '栖居志', '房间 / 像素小家'],
    details: [
      '房间页适合布置角色生活空间，也能查看便签、待办和日程。',
      '点击家具或物品可以触发角色反应，让房间更像真实生活场景。',
      '像素小家用于编辑像素角色、房间和素材库。',
    ],
  },
  '存钱罐': {
    appId: AppID.Bank,
    path: ['桌面', '存钱罐', '资产 / 流水 / 经营'],
    details: [
      '适合查看虚拟余额、收支记录、攒钱目标和经营进度。',
      '红包、转账、购物、外卖等体验会和这里的资产感互相呼应。',
      '想看近期花了什么、赚了什么、目标差多少，可以先打开这里。',
    ],
  },
  '日记': {
    appId: AppID.Journal,
    path: ['桌面', '日记', '日期记录'],
    details: [
      '适合写自己的日记，也适合回看角色留下的记录。',
      '聊天、节日和重要事件形成的记录，可以在这里慢慢翻。',
      '日记内容偏私人，适合作为关系变化和心情变化的长期留痕。',
    ],
  },
  '见闻簿': {
    appId: AppID.Social,
    path: ['桌面 / Dock', '见闻簿', '信息流 / 发布 / 素材入口'],
    details: [
      '适合刷小红书风格动态，发布内容，点赞、收藏和评论。',
      '可以把有意思的内容转发给角色，变成聊天里的共同话题。',
      '顶部入口可去自由活动或拾光图库，给角色社交生活准备素材。',
    ],
  },
  '自习室': {
    appId: AppID.Study,
    path: ['桌面', '自习室', '课程 / 章节 / 测验'],
    details: [
      '先建课程和章节，再选择角色一起学习。',
      '可以围绕材料提问、让角色讲解，也能生成测验检查掌握程度。',
      '测验结束后可查看分数、错题解析，并继续追问不懂的地方。',
    ],
  },
  '折子戏': {
    appId: AppID.Theater,
    path: ['桌面', '折子戏', '戏单', '选择一折'],
    details: [
      '打开后先看戏单，再选择攻略本、番外、占卜、谈心、TRPG 等具体玩法。',
      '短玩法适合随手玩一段，长玩法如 TRPG 和攻略本适合沉浸推进。',
      '番外、占卜和谈心更偏记录与陪伴，狼人杀和真心话大冒险更偏多人互动。',
    ],
  },
  '创作社': {
    appId: AppID.Creative,
    path: ['桌面', '创作社', '笔友会 / 写歌'],
    details: [
      '打开后先选择笔友会或写歌。',
      '笔友会适合和角色共创小说：设世界观、排人物、写章节。',
      '写歌适合和角色一起定主题、写歌词、整理歌曲成品。',
    ],
  },
  '页外': {
    appId: AppID.VRWorld,
    path: ['桌面', '页外', '虚拟房间'],
    details: [
      '适合看角色在聊天之外做了什么：看小说、听歌、留言或行动。',
      '可以编辑虚拟形象、房间和跟随状态。',
      '角色在这里的活动会成为之后聊天里能自然提起的生活片段。',
    ],
  },
  '岁时记': {
    appId: AppID.Almanac,
    path: ['桌面', '岁时记', '选择手账页'],
    details: [
      '打开后选择时光契约、这个月、典藏馆、喜事或特别时光。',
      '时光契约适合记待办、心愿和倒数日；这个月适合贴日历便签。',
      '典藏馆适合收藏作品和记录；喜事记录婚姻筹备；特别时光回看节日页面。',
    ],
  },
  '饭票': {
    appId: AppID.Takeout,
    path: ['桌面', '饭票', '店铺 / 购物车 / 订单'],
    details: [
      '适合搜索店铺和菜品、加购、下单、查看配送进度。',
      '订单里可以和商家或骑手聊天，也能处理自付或代付。',
      '从聊天里给角色点外卖后，可以回到这里看进度。',
    ],
  },
  '心意铺': {
    appId: AppID.Shop,
    path: ['桌面', '心意铺', '商城 / 购物车 / 订单'],
    details: [
      '适合浏览虚拟礼物、收藏、加购和下单。',
      '送给角色的礼物会落到聊天里，角色会回应或写感谢。',
      '也能查看订单、小票、物流和商品评价。',
    ],
  },
  '椒房记': {
    appId: AppID.Harem,
    path: ['桌面', '椒房记', '剧情存档'],
    details: [
      '适合进入多角色互动小说，用选择推进宫廷 / 后宫式剧情。',
      '好感、信任、嫉妒和事件走向会影响后续分支。',
      '可以保存进度，多周目探索不同结果。',
    ],
  },
  '茶话亭': {
    appId: AppID.Forum,
    path: ['桌面', '茶话亭', '板块 / 帖子 / 跟帖'],
    details: [
      '适合浏览论坛板块、帖子和跟帖，也可以自己发帖回复。',
      '角色和匿名网友会一起盖楼，让话题像真的被讨论起来。',
      '关系求助、吐槽、八卦、树洞和围观都适合放在这里。',
    ],
  },
  '自由活动': {
    appId: AppID.XhsFreeRoam,
    path: ['桌面', '自由活动', '选择角色', '活动记录'],
    details: [
      '选择角色后，让 TA 自己去刷小红书风格内容。',
      '角色可能浏览、点赞、收藏、评论或发布，行为会按性格和近况展开。',
      '适合让角色拥有聊天之外的社交时间。',
    ],
  },
  '拾光图库': {
    appId: AppID.XhsStock,
    path: ['桌面', '拾光图库', '素材库'],
    details: [
      '适合收集、整理和准备发帖图片素材。',
      '可以配合见闻簿与自由活动使用，让角色发布内容时有图可用。',
      '素材多了以后，可以按用途挑选更合适的图片。',
    ],
  },
  '回声亭': {
    appId: AppID.Phone,
    path: ['桌面 / Dock', '回声亭', '拨号 / 通话记录'],
    details: [
      '适合主动给角色打电话，或回看接听、未接、拨出记录。',
      '通话结束后可以回放录音和逐字稿。',
      '如果有角色来电，也会从这里留下记录。',
    ],
  },
  '街角': {
    appId: AppID.LifeSim,
    path: ['桌面', '街角', '地图 / 约会 / 关系'],
    details: [
      '适合进入小镇生活，探索地点、NPC、关系和剧情。',
      '约会时可以分开输入话语和动作，让场景更像真实互动。',
      '离线生活、地图、图鉴和关系页都能回看这个世界的变化。',
    ],
  },
};

const CATEGORY_ORDER: Array<'all' | ManualCategory> = ['all', 'daily', 'social', 'creation', 'roleplay', 'system'];

const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, '');

const ManualApp: React.FC = () => {
  const { closeApp, openApp } = useOS();
  const [category, setCategory] = useState<'all' | ManualCategory>('all');
  const [query, setQuery] = useState('');
  const [activeApp, setActiveApp] = useState(MANUAL_ENTRIES[0]?.app || '');

  const filteredEntries = useMemo(() => {
    const q = normalize(query);
    return MANUAL_ENTRIES.filter((entry) => {
      if (category !== 'all' && entry.category !== category) return false;
      if (!q) return true;
      const destination = MANUAL_DESTINATIONS[entry.app];
      const haystack = normalize([
        entry.app,
        entry.en,
        entry.summary,
        ...entry.features,
        ...(entry.tips || []),
        ...(destination?.path || []),
        ...(destination?.details || []),
        CATEGORY_META[entry.category].label,
      ].join(' '));
      return haystack.includes(q);
    });
  }, [category, query]);

  const activeEntry = useMemo(() => {
    if (filteredEntries.length === 0) return null;
    return filteredEntries.find((entry) => entry.app === activeApp) || filteredEntries[0];
  }, [activeApp, filteredEntries]);

  const activeDestination = activeEntry ? MANUAL_DESTINATIONS[activeEntry.app] : null;
  const activeAppConfig = activeDestination
    ? INSTALLED_APPS.find((app) => app.id === activeDestination.appId)
    : null;
  const ActiveAppIcon = activeAppConfig ? Icons[activeAppConfig.icon] : null;

  const countByCategory = useMemo(() => {
    const counts: Record<ManualCategory, number> = {
      daily: 0,
      social: 0,
      creation: 0,
      roleplay: 0,
      system: 0,
    };
    MANUAL_ENTRIES.forEach((entry) => { counts[entry.category] += 1; });
    return counts;
  }, []);

  return (
    <div
      className="absolute inset-0 flex flex-col animate-fade-in text-[#23211d]"
      style={{
        background:
          'radial-gradient(circle at 16% 0%, rgba(236, 192, 111, 0.22), transparent 32%), radial-gradient(circle at 96% 10%, rgba(94, 151, 246, 0.12), transparent 30%), linear-gradient(180deg, #f8f4ea 0%, #efe7d6 100%)',
        paddingTop: 'var(--safe-top)',
      }}
    >
      <div className="shrink-0 px-4 pt-3 pb-3">
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={closeApp}
            className="h-9 w-9 rounded-full bg-white/80 border border-black/10 shadow-sm flex items-center justify-center active:scale-95 transition-transform"
            aria-label="回桌面"
          >
            <ArrowLeft size={18} weight="bold" />
          </button>
          <div className="text-center min-w-0">
            <div className="label-mono text-[9px] tracking-[0.32em] text-[#8d7f68]">MORO GUIDE</div>
            <h1 className="text-[24px] leading-tight font-black tracking-wide">说明书</h1>
          </div>
          <div className="h-9 w-9 rounded-full bg-[#23211d] text-white flex items-center justify-center shadow-sm">
            <BookOpenText size={18} weight="fill" />
          </div>
        </div>

        <div className="mt-4 rounded-[18px] bg-white/86 border border-black/10 shadow-[0_12px_32px_-24px_rgba(35,33,29,0.45)] px-3 py-3">
          <div className="flex items-center gap-2 rounded-[14px] bg-[#f6f1e7] border border-black/[0.06] px-3 py-2">
            <MagnifyingGlass size={15} weight="bold" className="shrink-0 text-[#7b705f]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索 App、功能或关键词"
              className="w-full bg-transparent text-[13px] text-[#23211d] placeholder:text-[#a79a84] focus:outline-none"
            />
          </div>

          <div className="mt-3 flex gap-2 overflow-x-auto no-scrollbar pb-0.5">
            {CATEGORY_ORDER.map((item) => {
              const selected = category === item;
              const label = item === 'all' ? '全部' : CATEGORY_META[item].label;
              const count = item === 'all' ? MANUAL_ENTRIES.length : countByCategory[item];
              const IconComp = item === 'all' ? BookOpenText : CATEGORY_META[item].Icon;
              return (
                <button
                  key={item}
                  onClick={() => setCategory(item)}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-full border text-[11px] font-bold active:scale-95 transition-transform"
                  style={{
                    background: selected ? '#23211d' : '#fffdf8',
                    color: selected ? '#fffdf8' : '#5f5547',
                    borderColor: selected ? '#23211d' : 'rgba(35,33,29,0.09)',
                  }}
                >
                  <IconComp size={13} weight="bold" />
                  <span>{label}</span>
                  <span className="opacity-55">{count}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 px-4 pb-5 grid grid-cols-[122px_minmax(0,1fr)] gap-3">
        <div className="min-h-0 overflow-y-auto no-scrollbar space-y-2 pr-0.5">
          {filteredEntries.length === 0 ? (
            <div className="rounded-[16px] bg-white/78 border border-black/10 px-3 py-5 text-center text-[11px] leading-relaxed text-[#7b705f]">
              没搜到。换个词试试，比如“外卖”“记忆”“聊天”。
            </div>
          ) : filteredEntries.map((entry) => {
            const meta = CATEGORY_META[entry.category];
            const selected = activeEntry?.app === entry.app;
            return (
              <button
                key={entry.app}
                onClick={() => setActiveApp(entry.app)}
                className="w-full text-left rounded-[16px] border px-3 py-3 active:scale-[0.98] transition-transform"
                style={{
                  background: selected ? '#23211d' : 'rgba(255,253,248,0.84)',
                  color: selected ? '#fffdf8' : '#342f28',
                  borderColor: selected ? '#23211d' : 'rgba(35,33,29,0.09)',
                  boxShadow: selected ? '0 12px 26px -20px rgba(35,33,29,0.65)' : '0 8px 22px -22px rgba(35,33,29,0.3)',
                }}
              >
                <div className="text-[13px] font-black leading-snug">{entry.app}</div>
                <div className="label-mono text-[8px] mt-1 opacity-55 truncate">{entry.en}</div>
                <div className="text-[9px] mt-2 opacity-70 truncate">{meta.label}</div>
              </button>
            );
          })}
        </div>

        <div className="min-h-0 overflow-y-auto no-scrollbar">
          {activeEntry && (
            <article className="relative overflow-hidden rounded-[22px] bg-[#fffdf8] border border-black/10 shadow-[0_18px_42px_-30px_rgba(35,33,29,0.55)]">
              <div
                aria-hidden
                className="absolute inset-0 opacity-[0.18] pointer-events-none"
                style={{
                  backgroundImage:
                    'linear-gradient(rgba(35,33,29,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(35,33,29,0.05) 1px, transparent 1px)',
                  backgroundSize: '18px 18px',
                }}
              />
              <div className="relative px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="label-mono text-[9px] tracking-[0.28em] text-[#9a8c75]">
                      {CATEGORY_META[activeEntry.category].en}
                    </div>
                    <h2 className="text-[27px] font-black leading-tight tracking-wide mt-1">{activeEntry.app}</h2>
                    <div className="label-mono text-[9px] text-[#9a8c75] mt-1">{activeEntry.en}</div>
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-2">
                    <div className="w-10 h-10 rounded-full bg-[#23211d] text-white flex items-center justify-center">
                      {ActiveAppIcon
                        ? <ActiveAppIcon className="w-5 h-5" />
                        : React.createElement(CATEGORY_META[activeEntry.category].Icon, { size: 20, weight: 'bold' })}
                    </div>
                    {activeDestination && (
                      <button
                        onClick={() => openApp(activeDestination.appId)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-[#23211d] text-[#fffdf8] text-[11px] font-black shadow-[0_12px_24px_-18px_rgba(35,33,29,0.7)] active:scale-95 transition-transform"
                      >
                        <span>{activeDestination.jumpText || '打开 App'}</span>
                        <CaretRight size={12} weight="bold" />
                      </button>
                    )}
                  </div>
                </div>

                <p className="mt-4 text-[13px] leading-relaxed text-[#5c5143]">
                  {activeEntry.summary}
                </p>

                {activeDestination && (
                  <div className="mt-4 rounded-[16px] bg-[#f7f1e6] border border-black/[0.06] px-3.5 py-3">
                    <div className="label-mono text-[9px] tracking-[0.22em] text-[#9a8c75]">进入路径</div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {activeDestination.path.map((step, index) => (
                        <React.Fragment key={`${activeEntry.app}-path-${step}`}>
                          <span className="px-2.5 py-1 rounded-full bg-[#fffdf8] border border-black/[0.06] text-[11px] font-bold text-[#5c5143]">
                            {step}
                          </span>
                          {index < activeDestination.path.length - 1 && (
                            <CaretRight size={12} weight="bold" className="text-[#9a8c75]" />
                          )}
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-5">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="h-px flex-1 bg-black/10" />
                    <span className="label-mono text-[9px] tracking-[0.24em] text-[#9a8c75]">功能说明</span>
                    <span className="h-px flex-1 bg-black/10" />
                  </div>
                  <div className="space-y-2.5">
                    {activeEntry.features.map((feature, index) => (
                      <div key={feature} className="flex items-start gap-2.5 rounded-[15px] bg-[#f7f1e6] border border-black/[0.06] px-3 py-2.5">
                        <span className="shrink-0 w-5 h-5 rounded-full bg-[#23211d] text-[#fffdf8] label-mono text-[10px] font-bold flex items-center justify-center mt-0.5">
                          {index + 1}
                        </span>
                        <span className="text-[12px] leading-relaxed text-[#4d4439]">{feature}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {activeDestination && activeDestination.details.length > 0 && (
                  <div className="mt-5">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="h-px flex-1 bg-black/10" />
                      <span className="label-mono text-[9px] tracking-[0.24em] text-[#9a8c75]">适合怎么用</span>
                      <span className="h-px flex-1 bg-black/10" />
                    </div>
                    <div className="space-y-2">
                      {activeDestination.details.map((detail) => (
                        <div key={detail} className="rounded-[15px] bg-white/75 border border-black/[0.06] px-3 py-2.5 text-[12px] leading-relaxed text-[#4d4439]">
                          {detail}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {activeEntry.tips && activeEntry.tips.length > 0 && (
                  <div className="mt-5 rounded-[16px] bg-[#23211d] text-[#fffdf8] px-3.5 py-3">
                    <div className="flex items-center gap-2 text-[11px] font-black">
                      <Wrench size={14} weight="bold" />
                      使用提示
                    </div>
                    <div className="mt-2 space-y-1.5">
                      {activeEntry.tips.map((tip) => (
                        <p key={tip} className="text-[11px] leading-relaxed text-white/78">{tip}</p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </article>
          )}
        </div>
      </div>
    </div>
  );
};

export default ManualApp;
