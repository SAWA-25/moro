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

type ManualCategory = 'daily' | 'social' | 'creation' | 'roleplay' | 'system';

interface ManualEntry {
  app: string;
  en: string;
  category: ManualCategory;
  summary: string;
  features: string[];
  tips?: string[];
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
    app: '桌面 / 锁屏',
    en: 'Home & Lock',
    category: 'system',
    summary: '手机系统的第一层入口：桌面组件、Dock、壁纸、锁屏和通知都在这里操作。',
    features: [
      '点击图标打开 App；长按桌面图标进入整理模式，拖动调整桌面顺序和位置。',
      '桌面小组件包含时间、日程、音乐、天气、角色消息卡、照片和便签。',
      '锁屏可显示角色消息通知；点通知可解锁并跳到对应聊天。',
      '锁屏密码默认可在「文具盒」里修改或关闭，桌面时钟卡右上角可一键锁屏。',
    ],
    tips: ['外观相关入口集中在「拼贴册」；系统配置集中在「文具盒」。'],
  },
  {
    app: '说明书',
    en: 'Manual',
    category: 'system',
    summary: '当前这本 App 功能手册，按分类收纳整机可操作入口。',
    features: [
      '左侧按 App / 入口浏览，右侧查看功能清单。',
      '顶部搜索可按 App 名、功能词、子玩法和隐藏入口查找。',
      '分类按钮可切换日常与陪伴、社交与消息、创作与记录、剧场与世界、系统与工具。',
      '说明书同时记录桌面 App、合并入口里的子 App，以及聊天 / 设置等深链功能。',
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
      '「此刻 / 朋友圈」让角色和用户发布动态、评论互动，并能把相关生活片段注入聊天上下文。',
      '情侣空间从来往相关入口进入，可绑定另一半、看恋爱天数 / 亲密度、写留言板、相册、纪念日、每日互动、任务和悄悄话。',
    ],
    tips: ['聊天 AI 的 API 基础配置在「文具盒」，角色和人设在「剪影集」。'],
  },
  {
    app: '剪影集',
    en: 'Persona Hub',
    category: 'system',
    summary: '角色档案与用户人设的合并入口，决定聊天里“对面是谁”和“你是谁”。',
    features: [
      '「登场人物」中新建、编辑、删除角色，导入 SillyTavern 角色卡，设置头像、人设、开场白、城市、语音和生活侧写。',
      '角色档案可管理长期关系、记忆、备注、表情、相册、声音、见面立绘等角色相关资料。',
      '「扮相手账」管理多套用户身份：名字、头像、自述、注入位置、默认身份和角色 / 群聊绑定。',
      '可给人设绑定世界书分组，让对应身份自带额外设定。',
    ],
  },
  {
    app: '剪报夹',
    en: 'Worldbook',
    category: 'system',
    summary: '世界书管理器，用条目把设定、背景、规则和私货注入聊天。',
    features: [
      '创建世界书分组和条目，设置关键词、内容、启用状态、全局 / 局部作用域。',
      '支持 SillyTavern 式插入位置、@Depth 深度、角色 / 群聊挂载和群聊去重。',
      '用于补充世界观、关系背景、剧情规则、禁忌、记忆线索或长期设定。',
    ],
    tips: ['世界书内容会影响模型行为，写得越具体越稳定。'],
  },
  {
    app: '活字盘',
    en: 'Presets',
    category: 'system',
    summary: 'SillyTavern 式提示词预设与采样参数管理器。',
    features: [
      '导入 / 导出酒馆 Chat Completion 预设 JSON。',
      '编辑提示词管理器：main、jailbreak、chatHistory、charDescription、personaDescription 等 marker 的顺序与开关。',
      '设置温度、top_p、max tokens 等采样参数，并可绑定「文具盒」里的 API 预设。',
      '预设自带正则脚本会和「补丁铺」协同生效。',
    ],
  },
  {
    app: '补丁铺',
    en: 'Regex',
    category: 'system',
    summary: 'SillyTavern Regex Script 移植，用正则改写输入、输出、提示词或显示内容。',
    features: [
      '管理全局、预设、角色局部的正则脚本。',
      '支持导入酒馆正则 JSON，编辑查找式、替换文本、作用位置、深度、宏替换和启用状态。',
      '可用于清洗回复、屏蔽格式、替换口癖、隐藏标签、修正提示词或美化显示。',
    ],
    tips: ['正则影响链路较深，建议每次只改一两条并测试聊天效果。'],
  },
  {
    app: '文具盒',
    en: 'Settings',
    category: 'system',
    summary: '系统设置中心，集中管理 API、备份、实时感知、通知和安全。',
    features: [
      '配置主 API 与副 API，管理多个 API 预设，并查看 API 调用日志。',
      '导入 / 导出本地备份，恢复角色、聊天、设置和素材。',
      '配置实时感知：天气、新闻热点、Notion / 飞书笔记、小红书 / 麦当劳等外部服务。',
      '设置主动消息、Instant Push、浏览器通知、锁屏密码、版本信息和开发调试入口。',
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
      '支持网易云资料 / 评论相关页面，以及写歌作品进入音乐库。',
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
      '帮助排查角色复读、忘事、记错或召回疲劳。',
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
      '像素小家可编辑像素角色、房间、素材库和记忆潜入相关内容。',
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
      '支持从聊天、节日、交换日记等场景形成可回看的记录。',
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
      '活动结果会注入聊天和记忆，让角色像真的在页外生活过。',
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
      '角色与匿名网友会用副 API 盖楼、开帖、争论或围观。',
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
  {
    app: '捏脸·开发',
    en: 'Character Dev',
    category: 'system',
    summary: '开发调试入口，用于向像素捏人器追加自定义部件。',
    features: [
      '仅开发调试可见。',
      '上传、预览、删除捏脸素材部件。',
      '适合调试像素角色资产，不是普通用户日常入口。',
    ],
  },
  {
    app: '隐藏 / 深链功能',
    en: 'Hidden Routes',
    category: 'system',
    summary: '部分功能没有独立桌面图标，但会从聊天、合并入口或系统事件打开。',
    features: [
      '「神经链接」已并入「剪影集 → 登场人物」。',
      '「扮相手账」已并入「剪影集 → 扮相手账」。',
      '「浏览器 / 查岗」从聊天 + 号面板进入，用来让角色查看自己的手机侧内容。',
      '「见面」从聊天 + 号面板或自动线下触发进入。',
      '「捏声音」从角色档案进入，用 MiniMax 设计、试听、克隆或应用角色声线。',
      '「视频通话」从聊天资料页发起，支持开关摄像头、麦克风和翻转镜头。',
      '「语音通话」从聊天、回声亭或来电浮层进入。',
      '「主题工坊」保留为内部主题制作组件，日常外观调整走「拼贴册」。',
      '「交换日记」用于多角色交换日记本与每日对话总结，当前作为兼容 / 深链能力保留。',
      '「手账 / QQ 桥」保留数据或路由兼容，当前不在桌面默认展示。',
    ],
  },
];

const CATEGORY_ORDER: Array<'all' | ManualCategory> = ['all', 'daily', 'social', 'creation', 'roleplay', 'system'];

const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, '');

const ManualApp: React.FC = () => {
  const { closeApp } = useOS();
  const [category, setCategory] = useState<'all' | ManualCategory>('all');
  const [query, setQuery] = useState('');
  const [activeApp, setActiveApp] = useState(MANUAL_ENTRIES[0]?.app || '');

  const filteredEntries = useMemo(() => {
    const q = normalize(query);
    return MANUAL_ENTRIES.filter((entry) => {
      if (category !== 'all' && entry.category !== category) return false;
      if (!q) return true;
      const haystack = normalize([
        entry.app,
        entry.en,
        entry.summary,
        ...entry.features,
        ...(entry.tips || []),
        CATEGORY_META[entry.category].label,
      ].join(' '));
      return haystack.includes(q);
    });
  }, [category, query]);

  const activeEntry = useMemo(() => {
    if (filteredEntries.length === 0) return null;
    return filteredEntries.find((entry) => entry.app === activeApp) || filteredEntries[0];
  }, [activeApp, filteredEntries]);

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
                  <div className="shrink-0 w-10 h-10 rounded-full bg-[#23211d] text-white flex items-center justify-center">
                    {React.createElement(CATEGORY_META[activeEntry.category].Icon, { size: 20, weight: 'bold' })}
                  </div>
                </div>

                <p className="mt-4 text-[13px] leading-relaxed text-[#5c5143]">
                  {activeEntry.summary}
                </p>

                <div className="mt-5">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="h-px flex-1 bg-black/10" />
                    <span className="label-mono text-[9px] tracking-[0.24em] text-[#9a8c75]">功能清单</span>
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
