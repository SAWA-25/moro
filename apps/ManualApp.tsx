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
    summary: 'Moro 的聊天总入口。你在这里找角色单聊、开群聊、看朋友圈 / 此刻，也能进入情侣空间和各种关系互动。',
    features: [
      '底部有聊天、名册、此刻 / 朋友圈等入口：想聊天点会话，想找人点名册，想看动态点此刻。',
      '单聊里可以发文字、图片、语音、表情包，也能转账 / 红包、送礼物、点外卖、求婚、打语音或视频电话。',
      '每个角色都有自己的「聊天设置」：改称呼、改背景、管记忆、开主动消息、开查岗、开自动见面，都在右上角 ··· 里。',
      '群聊像 QQ / 微信群：能建群、改群名、发公告、改群名片、@人、发投票、群语音、红包、AA 收款、群归档。',
      '消息可以长按处理：引用、撤回、重新编辑、表情回应、删除；群聊里也能搜索历史记录。',
      '关系网可以从会话列表右上角进入，用来查看用户与角色、角色与角色之间的关系和私聊互动。',
      '情侣空间从关系相关入口进入，适合记录恋爱天数、纪念日、留言、相册、每日互动和悄悄话。',
    ],
    tips: ['先把「文具盒」里的聊天 API 配好，再回到絮语开聊；角色资料和你的身份在「剪影集」里维护。'],
  },
  {
    app: '絮语·会话列表',
    en: 'Chat List',
    category: 'social',
    summary: '打开絮语后最先看到的页面。这里像手机聊天软件首页，用来管理所有单聊、群聊和未读消息。',
    features: [
      '点角色头像或会话卡进入单聊；点群聊卡进入群聊。',
      '会话列表会显示最后一条消息、未读数、置顶状态和静音状态，方便你判断谁在等你回。',
      '名册页用来找还没聊过的人、创建群聊，或者进入角色资料。',
      '此刻 / 朋友圈页用来发布和查看动态，角色也会点赞、评论、转发或自己发生活片段。',
      '右上角的添加入口可以添加好友或创建群聊；群聊创建时可以指定群主和管理员。',
    ],
    tips: ['找不到某个角色时，先去「名册」页看；如果角色根本不存在，就去「剪影集」新建或导入。'],
  },
  {
    app: '絮语·单聊设置',
    en: 'Private Chat Settings',
    category: 'social',
    summary: '每个角色独立的聊天说明书。想调这个角色怎么称呼你、记多少、能不能主动找你、界面长什么样，都从这里进。',
    features: [
      '名字与名片：给 TA 备注名，查看 TA 怎么称呼你，也能维护 TA 的微信号、地区和签名。',
      '氛围布置：改顶栏文案、底部文案、输入框提示语、消息铃声，以及是否隐藏消息时间。',
      '记性：调整随身携带的最近聊天条数，决定单聊时要不要带入 TA 所在群聊的近况。',
      '说话的样子：设置对照翻译、翻译语言、译文风格、旁白模式、心声手记、表情联想和表情包权限。',
      'TA 的小日子：管理城市、真实时间感、日程协调、主动看天气热点、主动来电、主动点外卖、发此刻、查岗、自动见面、小红书能力。',
      '照片与立绘 / 界面背景：给本会话换头像、聊天壁纸、顶栏背景、输入栏背景、立绘和通话表情图。',
      '世界书挂载：把剪报夹里的局部设定挂到这个角色身上，让本会话额外知道某些背景。',
      '私聊档案 / 数据管理：同一个角色可以保留多份聊天，支持新建、切换、改名、置顶、导入、导出、清理和归档。',
    ],
    tips: ['设置会自动保存。刚开始不用全开，哪里觉得“不像 TA”或“不方便”，再回来慢慢调。'],
  },
  {
    app: '絮语·单聊工具',
    en: 'Private Chat Tools',
    category: 'social',
    summary: '单聊底部「+」面板里的扩展玩法。它们不是普通发消息，而是会把事件、卡片或小窗接进聊天剧情。',
    features: [
      '查岗：你主动看 TA 的手机；如果聊天设置允许，TA 也可能反过来看你的手机。',
      '窥屏：生成一张跟随当前剧情的 TA 手机屏幕截图卡，默认只作为可视卡片保存，不主动塞进聊天上下文。',
      '见面：进入线下面对面模式，你可以分开说话和行动，退出后这段经历会回到聊天上下文里。',
      '点外卖 / 送礼：从「饭票」或「心意铺」生成小票卡，角色收到后会自然回应。',
      '转账 / 红包：和用户钱包联动，聊天里会留下转账、红包或收款记录。',
      '求婚：触发求婚界面，成功后会进入岁时记的喜事 / 婚姻筹备内容。',
      '展示思考 / 回神 / 日常回顾等辅助入口，用来查看思绪、校准跑偏的对话，或回看 TA 离线时的生活。',
    ],
    tips: ['这些工具会改变剧情和上下文；如果只是普通聊天，直接在输入框发消息就好。'],
  },
  {
    app: '絮语·关系网',
    en: 'Relationship Network',
    category: 'social',
    summary: '从絮语会话列表进入的关系总览，整理用户、角色和角色之间的关系、私聊与后台互动。',
    features: [
      'AI 整理会读取角色人设、生活侧写和绑定世界书，生成角色之间的关系边、摘要、亲密 / 冲突信号和置信度。',
      '点角色之间的连线可查看详情，也能进入两人私聊记录，手动生成一段角色间互动。',
      '后台生成可勾选需要自动活跃的角色，并设置全局间隔、单角色冷却和单 pair 冷却。',
      '后台生成的角色私聊会写入完整记录；角色可能只截取自己想给你看的片段，作为转发卡发到与你的单聊。',
      '完整角色间私聊只在关系网里查看，聊天里看到的转发片段不一定完整。',
    ],
    tips: ['后台生成沿用浏览器页面可运行时的能力：页面打开或回到前台时会补跑到期任务，不承诺浏览器完全关闭后的常驻执行。'],
  },
  {
    app: '絮语·群聊设置',
    en: 'Group Chat Settings',
    category: 'social',
    summary: '群聊右上角齿轮里的管理页。它决定这个群叫什么、谁能管、每个人在群里叫什么，以及群记录怎么保存。',
    features: [
      '群信息：修改群名、群头像、群聊背景、你的群名片，以及这份群聊记录的标题。',
      '聊天记录：同一个群可以有多份记录，支持新建、打开、改名、置顶、导入、导出和删除。',
      '群公告：群主或管理员可以发布、修改、撤下公告；公告会置顶展示，角色也会在群聊里自然看见。',
      '成员管理：点成员头像可查看成员资料；群主 / 管理员可以替成员改群名片、设头衔、禁言、移出群聊。',
      '角色之间的关系：按“从谁的视角写”记录 TA 眼里其他成员是谁、熟不熟、有没有过节；这些只影响对应角色发言，不会公开进群记录。',
      '权限管理：群主可以任命 / 收回管理员，也可以把群主转让给某个角色。',
      '全员禁言：开启后群成员暂时不会发言，适合需要安静整理记录的时候。',
      '角色接话：可开启“角色各自回复”，让每个成员独立调用 API 决定要不要说话；也可开启“自动接话”，设置你发言后角色之间继续自然对话的轮数。',
      '特别关心：把某些角色设为特别关心后，TA 的消息会更显眼，也可以触发特别关心提醒。',
      '群归档：把群聊总结成记忆，分发给群成员，让他们以后记得这段群聊发生过什么。',
    ],
    tips: ['自动接话轮数越多，角色之间越像在自己聊天，也会消耗更多 API 调用；群设置里的改名、禁言、公告、移除成员等操作会变成系统通知，角色下一轮会“看到”这些变化。'],
  },
  {
    app: '絮语·群聊工具',
    en: 'Group Chat Tools',
    category: 'social',
    summary: '群聊底部工具和消息操作。适合做多人互动、投票、群语音和群内小事件。',
    features: [
      '发消息时可以 @某个成员；被点名的人本轮更容易回应。群主 / 管理员也可以 @全体成员。',
      '群投票支持 2 到 6 个选项，角色会按性格投票，点投票卡可以看票数和理由。',
      '群语音会让多个成员像接电话一样短句发言，结束后留下群聊电话记录。',
      '红包、拼手气红包、AA 收款会和用户钱包联动，适合群内聚餐、活动或玩笑转账。',
      '群聊记录搜索可以搜全部历史，点结果会跳回对应消息并高亮。',
      '成员可自己改群名片；如果 TA 带了“改名小心思”，系统提示可以点开看原因。',
      '已解散的群会保留历史只读；彻底删除群时才会清掉群资料和相关群记忆。',
    ],
    tips: ['群聊不是每个角色每轮都必须说话；沉默、复读、接梗、只发一个表情，反而更像真的群。'],
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
    summary: '正则管理器，用来自动替换、清理或美化聊天文字。',
    features: [
      '新建、导入、导出正则。',
      '编辑查找内容、替换内容、使用范围和启用状态。',
      '可用于统一称呼、替换口癖、收起标签、整理显示格式。',
    ],
    tips: ['正则会影响聊天显示和收发内容，建议每次只改一两条并测试聊天效果。'],
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
    app: '人生拟',
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
    app: '循迹',
    en: 'Screenlife Trace',
    category: 'daily',
    summary: '角色 Screenlife 演出与异地恋式报备模拟，用来生成 TA 的手机使用、位置、健康和生活线索。',
    features: [
      '选择角色后生成屏幕记录，回看指定时间段内 TA 打开过的 App、聊天片段、浏览内容和随手备忘。',
      '实时概览可刷新位置、设备、电量、网络、健康、通话、睡眠和移动状态。',
      '关系线索会整理情绪、亲近信号、迟疑点和下一次聊天可接的话题。',
      '浮窗动态会把短事件做成提醒卡，报备页可生成解锁、网络、软件、电量、移动、电话和睡眠提醒。',
      '「絮语联动」可控制循迹内容是否进入聊天上下文、是否自动续写、是否写入角色日常。',
    ],
    tips: ['循迹不是读取真实设备数据，而是按角色人设、城市、生活侧写和近期互动生成的本地模拟。'],
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
    summary: '宫廷红金风长线后宫文游。',
    features: [
      '进入 60 日以上长线宫廷文游，靠剧情选择、宫苑地图和宠爱经营台推进章节。',
      '主界面的宫廷舞台会集中显示本场标题、地点氛围、章节进度、在场角色状态、风闻暗线和最近恩宠账。',
      '自由行动会先出「判词预览」，确认后才落子；可让 AI 判官评估风险、代价和牵动的人。',
      '宠爱经营台可处理召见、赐赏、护持、冷处理、调停和普赏安宫，并把结果写入恩宠账。',
      '宫权、声望、库银、心力和风闻会影响危机、主线目标和终局走向。',
      '可在宫苑地图探访、会面、理宫务、听风闻、赐物、休整或推进主线。',
      '可从地图谋划、角色密令 / 邀约、背包追查 / 使用、章节目标出谋划策等入口发起自由行动。',
      '好感、信任、嫉妒、角色独立记忆、线索背包和成就册会持续影响后续分支。',
      '支持存档、多周目、结局收束和换一种写法。',
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
    app: '推特',
    en: 'X / Twitter',
    category: 'social',
    summary: '本地 AI 生成的 X / Twitter 式时间线，让角色、用户和虚拟账号自由发推、互动和私信。',
    features: [
      '首页分 For You / Following 浏览时间线，可刷新生成角色与 NPC 的新推文。',
      '发推可附带图片、视频、GIF、真实链接预览或投票；转推可选择直接转推或引用补一句。',
      '用户可以回复、引用、转发、点赞、收藏、投票和私信分享，角色会按人设产生互动反馈。',
      '搜索页支持关键词、话题、账号、媒体、投票、链接卡和语言筛选，也能点「AI 补充」扩展搜索结果。',
      '通知页集中展示回复、点赞、引用、转推、提及、关注和私信提醒。',
      '私信页可和角色或虚拟账号开 DM，显示发送/已读状态，也能把推文私信分享出去。',
      '每个角色都有完整个人主页，可查看资料、城市、关系提示、Posts / Replies / Media / Likes / Quotes 和「关于」。',
      '个人页可编辑用户账号资料、查看 posts / replies / media / likes / quotes / bookmarks，并设置翻译目标语言。',
    ],
    tips: ['推特内容保存在本机，可给聊天提供社交上下文；需要生成新时间线、角色回复或私信回应时会使用主 / 副 API。'],
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
      '第一次进来可以先从名册找角色，点开后开始单聊；以后这个会话会留在聊天列表里。',
      '单聊右上角 ··· 是这个角色的专属设置；群聊右上角齿轮是群设置。',
      '底部输入框旁的「+」是扩展工具入口，适合点外卖、送礼、见面、查岗、转账、求婚等。',
      '此刻 / 朋友圈适合看生活动态；关系推进后，也可以从相关入口进入情侣空间。',
    ],
  },
  '絮语·会话列表': {
    appId: AppID.GroupChat,
    path: ['桌面 / Dock', '絮语', '聊天 / 名册 / 此刻'],
    details: [
      '想继续聊天：在聊天列表点会话卡。单聊和群聊会混排，最近有消息的会排在前面。',
      '想找人：进名册页。没聊过的角色通常在这里，点角色可进入资料或开聊。',
      '想看动态：进此刻 / 朋友圈页。这里更像熟人动态，和「见闻簿」的小红书信息流不是同一个东西。',
      '想建群：用右上角添加入口，选择成员、群名、群主和管理员。',
      '会话太多时，优先用置顶、静音、归档和删除整理列表。',
    ],
  },
  '絮语·单聊设置': {
    appId: AppID.GroupChat,
    path: ['桌面 / Dock', '絮语', '进入某个角色单聊', '右上角 ···', '聊天设置'],
    details: [
      '想改“这个角色怎么显示”：看名字与名片、照片与立绘、界面背景、外观设置。',
      '想改“这个角色怎么说话”：看说话的样子，里面有翻译、旁白、心声、表情联想和表情包权限。',
      '想改“这个角色能知道什么”：看记性、世界书挂载、群里的事要不要带过来。',
      '想改“这个角色会不会主动做事”：看 TA 的小日子，里面有主动消息相关、查岗、自动见面、主动来电、主动点外卖等开关。',
      '想整理聊天记录：看私聊档案和数据管理，可以新建另一份聊天、导入导出、清理上下文或归档。',
    ],
  },
  '絮语·单聊工具': {
    appId: AppID.GroupChat,
    path: ['桌面 / Dock', '絮语', '进入单聊', '底部 + 面板'],
    details: [
      '普通聊天只要直接发消息；需要一个“事件”时再打开 + 面板。',
      '查岗、见面、求婚、点外卖、送礼这些工具会写入聊天记录，角色之后可能会继续提起。',
      '窥屏会生成 TA 当前手机屏幕截图卡；电话和视频通话会跳到通话界面，视频通话可先挂起成小窗再恢复。',
      '如果某个主动能力不想让 TA 自动触发，去「聊天设置」里关掉对应开关。',
      '遇到对话跑偏，可以用回神 / 调试类入口让 TA 重新校准当前关系和语气。',
    ],
  },
  '絮语·关系网': {
    appId: AppID.GroupChat,
    path: ['桌面 / Dock', '絮语', '会话列表右上角', '关系网'],
    details: [
      '适合查看所有角色之间是否认识、亲近、紧张或有冲突。',
      '点 AI 整理可以让副 API 优先、主 API 回退地重建关系边。',
      '点角色之间的连线可看关系摘要和完整私聊，也能手动生成一段互动。',
      '后台生成设置里勾选角色并设置间隔 / 冷却；生成后会弹窗提醒，角色也可能把自己挑选的片段转发给你。',
      '聊天里看到的转发卡通常只是片段，完整记录回关系网查看。',
    ],
  },
  '絮语·群聊设置': {
    appId: AppID.GroupChat,
    path: ['桌面 / Dock', '絮语', '进入群聊', '右上角齿轮', '群设置'],
    details: [
      '群信息页适合改群名、头像、背景、自己的群名片，以及当前这份聊天记录的标题。',
      '聊天记录页适合给同一个群开多份记录：比如“日常群”“旅行群”“剧情线 A”。',
      '群公告发布后会置顶展示，也会作为系统通知进入群历史，成员会按性格自然回应。',
      '成员资料里能管理单个成员：改群名片、设头衔、禁言、移出、任命管理员或转让群主。',
      '“角色之间的关系”页写的是私密视角：例如 A 眼里的 B 是老同事、暧昧对象、刚认识或有旧账；只有 A 发言时会参考。',
      '“角色各自回复”会把一轮群聊拆成每个角色各自一次 API 调用；“自动接话”会在你发言后继续跑指定轮数，让角色互相接话，你更像旁观者。',
      '特别关心不是强制 TA 说话，而是让 TA 的发言更容易被你注意到。',
      '群归档会把群聊摘要写进成员记忆，适合大段剧情或重要事件结束后使用。',
    ],
  },
  '絮语·群聊工具': {
    appId: AppID.GroupChat,
    path: ['桌面 / Dock', '絮语', '进入群聊', '底部输入区 / 回形针 / 长按消息'],
    details: [
      '群里直接写 @名字 可以点名；@全体成员适合通知大家，但别太频繁。',
      '发起投票适合让角色按各自性格做选择，例如去哪吃饭、谁负责某件事、下一步剧情怎么走。',
      '群语音适合短促热闹的多人电话；它和普通文字群聊不是同一种语气。',
      '红包和 AA 收款会影响钱包余额，适合群内聚餐、礼物、活动经费等场景。',
      '长按消息可以撤回、编辑、删除或表情回应；撤回后群成员只知道“撤回了一条消息”。',
      '右上角搜索可以查整段群历史，适合找以前说过的话。',
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
    path: ['桌面', '补丁铺', '正则'],
    details: [
      '适合处理固定替换：统一称呼、收起标签、清理多余格式、替换口癖。',
      '正则可以按使用范围开启或关闭，改动后建议回到聊天里发一两句测试。',
      '如果聊天文字突然显示异常，优先检查最近新增或开启的正则。',
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
  '人生拟': {
    appId: AppID.Bank,
    path: ['桌面', '人生拟', '人生 / 求职 / 经营 / 投资 / 公司 / 借款 / 账本'],
    details: [
      '适合推进虚拟人生日期，求职、开店、投资、开公司和管理借款。',
      '钱包变动会自动沉淀到账本，商城、外卖、红包等消费也会留下来源。',
      '攒够启动金后，可以选择业态、命名店铺并开始营业。',
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
  '循迹': {
    appId: AppID.Xunji,
    path: ['桌面', '循迹', '选择角色', '总览 / 生成 / 实时 / 絮语联动'],
    details: [
      '适合想看角色今天手机里发生了什么：先选角色，再生成屏幕记录或刷新实时概览。',
      '生成页可补一段指定时间范围的 Screenlife，适合补完“TA 刚才在忙什么”。',
      '报备页适合查看事件提醒，也能按规则生成新报备、标记已读或写回角色日常。',
      '絮语联动里可以决定这些线索是否进入聊天上下文；关闭后仍可在循迹里单独回看。',
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
    path: ['桌面', '椒房记', '宫廷舞台 / 宠爱经营台 / 宫苑地图 / 章节卷轴 / 剧情存档'],
    details: [
      '适合进入宫廷 / 后宫式长线文游，用选择和宫苑地点行动推进章节。',
      '主界面上半区是宫廷舞台，可看本场标题、地点氛围、章节进度、在场角色四维、最近恩宠、风闻暗线和关系摘要。',
      '自由行动会先显示判词预览，列出风险、代价、收益和牵动对象；确认后才会推进剧情。',
      '宠爱经营台可从顶部、剧情底部或掌事菜单打开；预设谕旨包括召见、赐赏、护持、冷处理、调停和普赏安宫。',
      '每次确认的恩宠、赏罚或调停都会写入恩宠账，后续剧情会参考最近记录续写偏宠、安抚或宫中议论。',
      '读完当前一幕后，可打开宫苑地图选择探访、会面、理宫务、听风闻、赐物、休整或推进主线。',
      '地图可点「谋划」，角色可走「密令 / 邀约」，背包线索可追查 / 使用，章节目标可请 AI 出谋划策。',
      '章节卷轴会显示主线 / 支线目标；背包线索收纳暗线、信物和诏令；成就册记录重要印记。',
      'AI 可能生成局内支线、风闻或临时人物，这些只属于当前椒房记存档，不会改真实角色档案。',
      '好感、信任、嫉妒、宫权、声望、库银、心力和风闻都会影响后续分支与结局。',
      '可以保存进度，多周目探索不同结果；第 60 日后会进入更完整的终局收束窗口。',
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
  '推特': {
    appId: AppID.Twitter,
    path: ['桌面', '推特', '首页 / 搜索 / 通知 / 私信 / 我的'],
    details: [
      '适合看角色和虚拟账号在公开时间线上的碎碎念、争论、转发、投票、链接卡和日常动态。',
      '想主动参与时，可从右下角发推，添加媒体/链接/投票，或进入推文详情回复、引用、点赞、收藏。',
      '点头像进入账号页；正式角色会有完整主页，能看资料、关系提示、话题标签、回复、媒体、引用和关于页。',
      '搜索页可查关键词、话题、账号、媒体和趋势分组；本地结果不够时，点 AI 补充生成更完整的时间线。',
      '私信页适合和角色进行 X 风格短对话，也可以把看到的推文转发给聊天角色或角色的推特私信。',
      '我的页面用于维护用户账号资料、语言、收藏、喜欢和引用记录。',
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
