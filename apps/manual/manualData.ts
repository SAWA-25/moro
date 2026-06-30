import { AppID } from '../../types';
import type { ManualDeepLinkTarget } from '../../utils/manualDeepLink';
export type { ManualDeepLinkTarget } from '../../utils/manualDeepLink';

export type ManualCategory = 'daily' | 'social' | 'creation' | 'roleplay' | 'system';

export interface ManualSettingOption {
  label: string;
  description: string;
}

export interface ManualSetting {
  id: string;
  title: string;
  description: string;
  defaultBehavior?: string;
  options?: ManualSettingOption[];
  path?: string[];
  deepLink?: ManualDeepLinkTarget;
  nativeOnly?: boolean;
}

export interface ManualSettingSection {
  id: string;
  title: string;
  description?: string;
  settings: ManualSetting[];
}

export interface ManualEntry {
  app: string;
  en: string;
  category: ManualCategory;
  summary: string;
  features: string[];
  tips?: string[];
  settingSections?: ManualSettingSection[];
  nativeOnly?: boolean;
}

export interface ManualDestination {
  appId: AppID;
  path: string[];
  details: string[];
  jumpText?: string;
  deepLink?: ManualDeepLinkTarget;
}

export const CATEGORY_ORDER: Array<'all' | ManualCategory> = ['all', 'daily', 'social', 'creation', 'roleplay', 'system'];

const link = (appId: AppID, anchorId: string, route?: string, payload?: Record<string, unknown>): ManualDeepLinkTarget => ({
  appId,
  route,
  anchorId,
  payload,
});

const settingsLink = (anchorId: string, route?: string, payload?: Record<string, unknown>) =>
  link(AppID.Settings, anchorId, route, payload);

const chatHubLink = (anchorId: string, route?: string, payload?: Record<string, unknown>) =>
  link(AppID.GroupChat, anchorId, route, payload);

const chatSettingsLink = (anchorId: string, payload?: Record<string, unknown>) =>
  link(AppID.Chat, anchorId, 'chat-settings', payload);

const chatAlarmLink = (anchorId: string, payload?: Record<string, unknown>) =>
  link(AppID.Chat, anchorId, 'chat-alarm', payload);

const appearanceLink = (anchorId: string, tab?: string) =>
  link(AppID.Appearance, anchorId, tab ? `tab:${tab}` : undefined, tab ? { tab } : undefined);

export const MANUAL_ENTRIES: ManualEntry[] = [
  {
    app: '说明书',
    en: 'Manual',
    category: 'system',
    summary: '当前这本 App 功能手册，按分类收纳整机可操作入口，也能跳到对应设置位置。',
    features: [
      '左侧按 App / 子入口浏览，右侧查看用途、入口路径、功能说明和设置开关。',
      '顶部搜索可按 App 名、子页名、功能说明、设置名、开关说明、选项说明和路径查找。',
      '「跳到这里」只负责打开并高亮对应界面，不会替你启用、关闭或改写任何设置。',
    ],
    tips: ['这里写给普通用户看，只收录界面里能看到、能点到的 App 和子功能。'],
  },
  {
    app: '絮语',
    en: 'Chat Hub',
    category: 'social',
    summary: 'Moro 的聊天总入口。你在这里找角色单聊、开群聊、看此刻，也能进入情侣空间和关系网。',
    features: [
      '底部有聊天、名册、此刻和情侣空间入口：想聊天点会话，想找人点名册，想看动态点此刻。',
      '单聊可以发文字、图片、语音、表情包，也能转账、红包、送礼、点外卖、设闹钟、求婚、语音或视频通话。',
      '群聊支持建群、改群名、公告、群名片、@人、投票、群语音、红包、AA 收款和群归档。',
      '关系网整理你与角色、角色与角色之间的关系和后台私聊互动。',
    ],
    tips: ['先把「文具盒」里的主 API 配好，再回到絮语开聊；角色资料和你的身份在「剪影集」里维护。'],
    settingSections: [
      {
        id: 'chat-hub-pages',
        title: '页面入口',
        settings: [
          {
            id: 'chat-hub-list',
            title: '聊天列表',
            description: '管理单聊、群聊、未读、置顶和静音状态。',
            path: ['絮语', '底栏：聊天'],
            deepLink: chatHubLink('manual-chathub-chats', 'tab:chats', { tab: 'chats' }),
          },
          {
            id: 'chat-hub-contacts',
            title: '名册',
            description: '找角色、创建群聊、添加社交圈联系人或进入角色资料。',
            path: ['絮语', '底栏：名册'],
            deepLink: chatHubLink('manual-chathub-contacts', 'tab:contacts', { tab: 'contacts' }),
          },
          {
            id: 'chat-hub-moments',
            title: '此刻',
            description: '查看、发布和互动熟人动态，角色也会点赞、评论或自己发生活片段。',
            path: ['絮语', '底栏：此刻'],
            deepLink: chatHubLink('manual-chathub-moments', 'tab:moments', { tab: 'moments' }),
          },
          {
            id: 'chat-hub-couple',
            title: '情侣空间',
            description: '记录恋爱天数、纪念日、相册、留言、每日互动和悄悄话。',
            path: ['絮语', '底栏：情侣空间'],
            deepLink: chatHubLink('manual-chathub-couple', 'tab:couple', { tab: 'couple' }),
          },
          {
            id: 'chat-hub-relationship',
            title: '关系网',
            description: '查看和整理用户、角色、NPC 之间的关系，也能管理角色间私聊与后台生成。',
            path: ['絮语', '右上角关系网入口'],
            deepLink: chatHubLink('manual-chathub-relationship-network', 'relationship-network'),
          },
        ],
      },
    ],
  },
  {
    app: '絮语·单聊工具',
    en: 'Private Chat Tools',
    category: 'social',
    summary: '单聊底部回形针里的常用互动工具。这里放转账、外卖、见面、查岗、闹钟等更像“两个人之间的小事”的入口。',
    features: [
      '闹钟可给当前角色设置睡觉督促、起床叫醒或自定义提醒，默认按星期重复。',
      '到点后角色会用自己的语气在聊天里提醒你；起床闹钟可优先走语音来电。',
      '浏览器版会联动系统通知；手机安装版会排本地通知。浏览器完全关闭后不承诺常驻响铃。',
      '拉黑或被拉黑期间，闹钟只做本地通知，不生成聊天或来电。',
    ],
    tips: ['入口在单聊输入栏旁的回形针，不在右上角聊天设置里。新增或修改闹钟后，手机安装版会自动刷新未来一段时间的提醒排程。'],
    settingSections: [
      {
        id: 'private-chat-tools',
        title: '回形针工具',
        settings: [
          {
            id: 'chat-alarm',
            title: '闹钟',
            description: '为当前角色设置睡觉、起床或自定义提醒；可选每天、工作日或指定星期，以及自动、提醒、来电三种方式。',
            defaultBehavior: '新建睡觉督促默认 23:30，起床叫醒默认 07:30，默认每天启用。',
            options: [
              { label: '自动', description: '睡觉 / 自定义走语音提醒，起床优先走语音来电。' },
              { label: '闹钟提醒', description: '始终生成角色语音提醒气泡。' },
              { label: '语音来电', description: '前台可见时弹来电，后台退回通知和未接提示。' },
            ],
            path: ['絮语', '点角色单聊', '底部回形针', '两个人的事', '闹钟'],
            deepLink: chatAlarmLink('manual-chat-alarm-root'),
          },
        ],
      },
    ],
  },
  {
    app: '絮语·单聊设置',
    en: 'Private Chat Settings',
    category: 'social',
    summary: '每个角色独立的聊天设置。想调称呼、记忆、主动能力、世界书、外观和档案，都从聊天右上角进入。',
    features: [
      '名字与名片：给 TA 备注名，查看 TA 怎么称呼你，维护微信号、地区和签名。',
      '记性与说话方式：控制上下文条数、群聊近况、翻译、旁白、心声、表情联想和表情包权限。',
      'TA 的小日子：控制城市、真实时间、日程协调、主动来电、主动点外卖、查岗、自动见面和小红书能力。',
      '背景与外观：替本会话设置头像覆盖、聊天壁纸、顶栏背景、输入栏背景和全局聊天皮肤入口。',
      '私聊档案与数据管理：同一角色可保留多份聊天，支持导入、导出、改名、置顶和清理。',
    ],
    tips: ['设置会自动保存。刚开始不用全开，哪里觉得“不像 TA”或“不方便”，再回来慢慢调。'],
    settingSections: [
      {
        id: 'private-chat-identity',
        title: '名字与名片',
        settings: [
          {
            id: 'chat-remark-name',
            title: '给 TA 起的小名',
            description: '只改变本会话顶栏和会话列表里的显示名，不改角色本名。',
            defaultBehavior: '留空时显示角色原名。',
            path: ['单聊', '右上角 ···', '聊天设置', '01 名字与名片'],
            deepLink: chatSettingsLink('manual-chat-remark-name'),
          },
          {
            id: 'chat-user-remark',
            title: 'TA 怎么称呼你',
            description: '展示 TA 当前给你的备注和改名原因，聊天里 TA 可以根据相处主动调整。',
            defaultBehavior: '默认按你的个人资料称呼你。',
            path: ['单聊', '聊天设置', '01 名字与名片'],
            deepLink: chatSettingsLink('manual-chat-user-remark'),
          },
          {
            id: 'chat-profile-card',
            title: 'TA 的名片',
            description: '维护微信号、地区和签名；空着就不在角色主页展示。',
            path: ['单聊', '聊天设置', '01 名字与名片'],
            deepLink: chatSettingsLink('manual-chat-profile-card'),
          },
        ],
      },
      {
        id: 'private-chat-memory',
        title: '记忆与上下文',
        settings: [
          {
            id: 'chat-context-limit',
            title: '随身记忆',
            description: '控制每次对话随身带入最近多少条消息；更早的往事交给摘要和回忆标本馆补全。',
            defaultBehavior: '使用角色当前上下文条数。',
            options: [
              { label: '20-5000 条', description: '常规范围，越多越完整，也越消耗上下文。' },
              { label: '不设上限', description: '尽量带入全部聊天，长聊时可能变慢或超出模型上下文。' },
            ],
            path: ['单聊', '聊天设置', '03 记性'],
            deepLink: chatSettingsLink('manual-chat-context-limit'),
          },
          {
            id: 'chat-group-memory',
            title: '群里的事要不要带过来',
            description: '单聊时是否把 TA 所在群聊的近期动静当作背景。',
            defaultBehavior: '按当前会话设置决定。',
            options: [
              { label: '全都带上', description: 'TA 会知道自己所在群的近期动静。' },
              { label: '都不带', description: '这段单聊不参考群里发生过的事。' },
              { label: '挑几个群', description: '只带入你勾选的群聊近况。' },
            ],
            path: ['单聊', '聊天设置', '03 记性'],
            deepLink: chatSettingsLink('manual-chat-group-memory'),
          },
          {
            id: 'chat-memo',
            title: 'TA 的备忘录',
            description: 'TA 手机备忘录里的待办、随手记和小心事；你也能帮 TA 记一条。',
            path: ['单聊', '聊天设置', '03 记性'],
            deepLink: chatSettingsLink('manual-chat-memo'),
          },
        ],
      },
      {
        id: 'private-chat-style',
        title: '说话方式',
        settings: [
          {
            id: 'chat-bubble-style',
            title: 'TA 打字的习惯',
            description: '控制 TA 更常用的消息节奏。',
            options: [
              { label: '一句一句蹦', description: '更像即时聊天，长句会拆成短气泡。' },
              { label: '一大段说完', description: '更像写完整段落。' },
              { label: '按人设随意', description: '让长度和拆条跟随角色状态自然变化。' },
            ],
            path: ['单聊', '聊天设置', '04 说话的样子'],
            deepLink: chatSettingsLink('manual-chat-bubble-style'),
          },
          {
            id: 'chat-translation',
            title: '对照翻译',
            description: '在聊天里显示源语言与目标语言的对照翻译，适合跨语言角色。',
            options: [
              { label: '关闭', description: '只显示原消息。' },
              { label: '开启', description: '按选择的源语言、目标语言显示对照。' },
            ],
            path: ['单聊', '聊天设置', '04 说话的样子'],
            deepLink: chatSettingsLink('manual-chat-translation'),
          },
          {
            id: 'chat-inner-voice',
            title: '心声手记',
            description: '让 TA 在合适时记录更私密的想法，供你回看。',
            path: ['单聊', '聊天设置', '04 说话的样子'],
            deepLink: chatSettingsLink('manual-chat-inner-voice'),
          },
          {
            id: 'chat-emoji-access',
            title: '表情包权限',
            description: '选择哪些表情分类允许 TA 使用；划线分类暂时不可用。',
            path: ['单聊', '聊天设置', '04 说话的样子'],
            deepLink: chatSettingsLink('manual-chat-emoji-access'),
          },
        ],
      },
      {
        id: 'private-chat-life',
        title: 'TA 的小日子',
        settings: [
          {
            id: 'chat-city',
            title: 'TA 的城市',
            description: '真实城市会接入天气、本地时间和真实外卖彩蛋；架空城市可借用原型城市风物。',
            options: [
              { label: '真实城市', description: '使用真实天气、本地时间和本地生活信息。' },
              { label: '架空城市', description: '保留虚构设定，可选择原型城市和虚拟程度。' },
            ],
            path: ['单聊', '聊天设置', '05 TA 的小日子'],
            deepLink: chatSettingsLink('manual-chat-city'),
          },
          {
            id: 'chat-time-sense',
            title: 'TA 对时间的感知',
            description: '让 TA 知道现在几点、两次聊天间隔多久，以及未跟进的约定过了多久。',
            options: [
              { label: '实时感知', description: '明确告诉 TA 当前时间。' },
              { label: '时间流逝感知', description: '让 TA 感知两次互动之间隔了多久。' },
            ],
            path: ['单聊', '聊天设置', '05 TA 的小日子'],
            deepLink: chatSettingsLink('manual-chat-time-sense'),
          },
          {
            id: 'chat-schedule',
            title: 'TA 的日程表',
            description: '查看和协调 TA 的当天安排，可配合副 API 做日程生成和协调。',
            path: ['单聊', '聊天设置', '05 TA 的小日子'],
            deepLink: chatSettingsLink('manual-chat-schedule'),
          },
          {
            id: 'chat-proactive',
            title: '主动来找你',
            description: '允许 TA 在合适时主动发消息、来电或在动态中出现。',
            defaultBehavior: '按角色当前设置，不会自动替你开启。',
            path: ['单聊', '聊天设置', '05 TA 的小日子'],
            deepLink: chatSettingsLink('manual-chat-proactive'),
          },
          {
            id: 'chat-takeout',
            title: 'TA 会主动给你撕饭票',
            description: '允许 TA 主动点外卖或围绕外卖事件回应；外卖送达、收货和小票会联动聊天。',
            defaultBehavior: '关闭时 TA 不会主动替你点外卖，但你仍可手动从「+」面板点外卖。',
            path: ['单聊', '聊天设置', '05 TA 的小日子'],
            deepLink: chatSettingsLink('manual-chat-takeout'),
          },
          {
            id: 'chat-check-phone',
            title: '允许 TA 查岗',
            description: '允许 TA 反过来看你的手机；你主动查 TA 手机仍从聊天工具里发起。',
            defaultBehavior: '关闭时 TA 不会主动查岗。',
            path: ['单聊', '聊天设置', '05 TA 的小日子'],
            deepLink: chatSettingsLink('manual-chat-check-phone'),
          },
          {
            id: 'chat-auto-meet',
            title: '聊着聊着就见面',
            description: '允许对话自然进入线下面对面模式；退出后这段经历会回到聊天上下文。',
            defaultBehavior: '关闭时只会在你手动点「见面」时进入。',
            path: ['单聊', '聊天设置', '05 TA 的小日子'],
            deepLink: chatSettingsLink('manual-chat-auto-meet'),
          },
        ],
      },
      {
        id: 'private-chat-visuals',
        title: '图片、世界书与数据',
        settings: [
          {
            id: 'chat-photo-assets',
            title: '照片与立绘',
            description: '设置聊天立绘、通话表情和生图底图。',
            path: ['单聊', '聊天设置', '06 照片与立绘'],
            deepLink: chatSettingsLink('manual-chat-photo-assets'),
          },
          {
            id: 'chat-worldbook',
            title: '世界书挂载',
            description: '把剪报夹里的局部设定挂到这个角色身上，让本会话额外知道某些背景。',
            path: ['单聊', '聊天设置', '07 世界书挂载'],
            deepLink: chatSettingsLink('manual-chat-worldbook'),
          },
          {
            id: 'chat-wallpaper',
            title: '聊天背景',
            description: '设置本会话头像覆盖、聊天壁纸、顶栏背景、输入栏背景和分隔条。',
            path: ['单聊', '聊天设置', '08 界面背景'],
            deepLink: chatSettingsLink('manual-chat-wallpaper'),
          },
          {
            id: 'chat-appearance',
            title: '全局聊天外观',
            description: '气泡、头像、顶栏、输入栏等全局聊天皮肤在「拼贴册」里设置。',
            path: ['单聊', '聊天设置', '09 外观设置'],
            deepLink: chatSettingsLink('manual-chat-appearance'),
          },
          {
            id: 'chat-archives',
            title: '私聊档案',
            description: '给同一个角色保留多份私聊，支持新建、打开、改名、置顶、导入、导出和删除。',
            path: ['单聊', '聊天设置', '11 私聊档案'],
            deepLink: chatSettingsLink('manual-chat-archives'),
          },
          {
            id: 'chat-data',
            title: '数据管理',
            description: '导出聊天记录、送进回忆标本馆、清空上下文或清空本会话记录。',
            path: ['单聊', '聊天设置', '12 数据管理'],
            deepLink: chatSettingsLink('manual-chat-data'),
          },
        ],
      },
    ],
  },
  {
    app: '絮语·群聊设置',
    en: 'Group Chat Settings',
    category: 'social',
    summary: '群聊右上角齿轮里的管理页。它决定群名、成员权限、公告、接话方式和群记录怎么保存。',
    features: [
      '群信息：修改群名、群头像、群聊背景、你的群名片和当前群聊记录标题。',
      '成员管理：群主 / 管理员可改群名片、头衔、禁言、移除成员和转让群主。',
      '角色接话：可开启角色各自回复或自动接话，控制群友继续聊几轮；各自回复时可给本群或单个成员单独设置 API。',
      '群归档：把群聊总结成记忆，分发给群成员。',
    ],
    tips: [
      '群设置里的改名、禁言、公告、移除成员等操作会变成系统通知，角色下一轮会“看到”这些变化。',
      '群聊专属 API 只影响这个群的“角色各自回复”；普通导演统筹、私聊和其他群仍按原来的 API 设置走。',
    ],
    settingSections: [
      {
        id: 'group-settings',
        title: '群聊管理',
        settings: [
          {
            id: 'group-open-settings',
            title: '打开当前群设置',
            description: '优先打开当前群；没有当前群时回到群聊列表。',
            path: ['絮语', '群聊', '右上角齿轮'],
            deepLink: chatHubLink('manual-chathub-group-settings', 'group-settings'),
          },
          {
            id: 'group-individual-api',
            title: '群聊专属 API',
            description: '开启“角色各自回复”后，可以给本群设置默认 API，也可以给某个群成员单独填写 Base URL、API Key 和模型名。',
            defaultBehavior: '成员专属 API 优先；没填完整时回退本群默认 API；本群默认也没填完整时回退文具盒主 API。',
            path: ['絮语', '群聊', '右上角齿轮', '06 背景与记忆', '角色怎么接话'],
            deepLink: chatHubLink('manual-chathub-group-settings', 'group-settings'),
          },
        ],
      },
    ],
  },
  {
    app: '剪影集',
    en: 'Persona Hub',
    category: 'system',
    summary: '角色档案与用户人设的合并入口，决定聊天里“对面是谁”和“你是谁”。',
    features: [
      '登场人物中新建、编辑、删除角色，设置头像、人设、开场白、城市、语音和生活侧写。',
      '角色档案可管理长期关系、记忆、备注、表情、相册、声音、见面立绘等资料。',
      '用户身份页可管理多套身份：名字、头像、自述、默认身份和角色 / 群聊绑定。',
      '可给人设绑定世界书分组，让对应身份自带额外设定。',
    ],
    settingSections: [
      {
        id: 'persona-sections',
        title: '主要页面',
        settings: [
          {
            id: 'persona-characters',
            title: '登场人物',
            description: '角色新建、导入、编辑和生活侧写都在这里。',
            path: ['剪影集', '登场人物'],
            deepLink: link(AppID.Personas, 'manual-personas-characters', 'section:char', { section: 'char' }),
          },
          {
            id: 'persona-user',
            title: '用户身份',
            description: '维护多套用户人设、默认身份、角色绑定和世界书绑定。',
            path: ['剪影集', '用户身份'],
            deepLink: link(AppID.Personas, 'manual-personas-user', 'section:user', { section: 'user' }),
          },
        ],
      },
    ],
  },
  {
    app: '剪报夹',
    en: 'Worldbook',
    category: 'system',
    summary: '设定资料夹，用条目保存世界观、背景、规则、禁忌和长期补充信息。',
    features: [
      '创建世界书分组和条目，设置关键词、内容、启用状态、全局 / 局部作用域。',
      '可选择条目适用的角色或群聊，控制哪些设定在对应聊天里生效。',
      '支持 ST 式插入位置：角色卡前后和 @Depth 插入聊天历史。',
    ],
    tips: ['世界书内容会影响模型行为，写得越具体越稳定；不要把互相冲突的设定同时开成全局。'],
    settingSections: [
      {
        id: 'worldbook-settings',
        title: '世界书开关与注入',
        settings: [
          {
            id: 'worldbook-group-toggle',
            title: '整本世界书开关',
            description: '控制某个分组整本是否启用。关闭整本后，该分组下条目不会注入聊天。',
            defaultBehavior: '新分组默认启用。',
            options: [
              { label: '开启', description: '分组内启用条目可按规则注入。' },
              { label: '关闭', description: '整本暂停，不删除条目。' },
            ],
            path: ['剪报夹', '书架分组', '整本开关'],
            deepLink: link(AppID.Worldbook, 'manual-worldbook-group-toggle', 'group-settings'),
          },
          {
            id: 'worldbook-group-scope',
            title: '整本全局 / 局部',
            description: '全局书默认影响所有聊天；局部书需要挂到角色、群聊或人设后才生效。',
            defaultBehavior: '新分组默认局部。',
            options: [
              { label: '局部世界书', description: '更适合角色专属设定、某个群的背景或某套人设。' },
              { label: '全局世界书', description: '更适合所有聊天都必须知道的世界规则。' },
            ],
            path: ['剪报夹', '书架分组', '整本全局 / 局部'],
            deepLink: link(AppID.Worldbook, 'manual-worldbook-group-scope', 'group-settings'),
          },
          {
            id: 'worldbook-entry-toggle',
            title: '条目开关',
            description: '单条启用 / 停用。停用不会删除内容，适合临时试错。',
            defaultBehavior: '新条目默认启用。',
            path: ['剪报夹', '条目卡片', '条目开关'],
            deepLink: link(AppID.Worldbook, 'manual-worldbook-entry-toggle', 'entry-settings'),
          },
          {
            id: 'worldbook-position',
            title: '插入位置',
            description: '决定条目放在角色卡前后，或以 @Depth 方式插进聊天历史。',
            defaultBehavior: '默认在角色卡之后。',
            options: [
              { label: '角色卡之前', description: '适合高优先级世界规则。' },
              { label: '角色卡之后', description: '常规补充设定。' },
              { label: '@Depth system/user/assistant', description: '按指定 role 插入到聊天历史深度。' },
            ],
            path: ['剪报夹', '编辑条目', '插入位置'],
            deepLink: link(AppID.Worldbook, 'manual-worldbook-position', 'entry-settings'),
          },
        ],
      },
    ],
  },
  {
    app: '活字盘',
    en: 'Presets',
    category: 'system',
    summary: 'SillyTavern 式 Chat Completion 预设管理器，用来维护提示词、消息组装和采样参数。',
    features: [
      '新建、复制、导入、导出聊天预设。',
      '管理提示词条目、marker、启用状态和顺序。',
      '设置温度、长度等采样参数，并选择当前使用方案。',
    ],
    settingSections: [
      {
        id: 'preset-settings',
        title: '预设管理',
        settings: [
          {
            id: 'preset-library',
            title: '预设列表',
            description: '选择当前预设，或导入酒馆预设 JSON。',
            path: ['活字盘', '预设列表'],
            deepLink: link(AppID.Presets, 'manual-presets-library'),
          },
          {
            id: 'preset-prompts',
            title: '提示词管理器',
            description: '编辑提示词条目、启用状态、顺序和 marker 落点。',
            path: ['活字盘', '提示词管理器'],
            deepLink: link(AppID.Presets, 'manual-presets-prompts'),
          },
        ],
      },
    ],
  },
  {
    app: '补丁铺',
    en: 'Regex',
    category: 'system',
    summary: 'SillyTavern 式正则脚本管理器，用来自动替换、清理或美化聊天文字。',
    features: [
      '新建、导入、导出全局或角色局部正则。',
      '编辑查找内容、替换内容、运行位置、启用状态和作用范围。',
      '可用于统一称呼、替换口癖、收起标签、整理显示格式。',
    ],
    tips: ['正则会影响聊天显示和收发内容，建议每次只改一两条并测试聊天效果。'],
    settingSections: [
      {
        id: 'regex-settings',
        title: '脚本开关与范围',
        settings: [
          {
            id: 'regex-enabled',
            title: '脚本启用状态',
            description: '停用后脚本保留但不会运行。',
            path: ['补丁铺', '脚本编辑', '启用状态'],
            deepLink: link(AppID.Regex, 'manual-regex-enabled'),
          },
          {
            id: 'regex-placement',
            title: '运行位置',
            description: '选择脚本作用于用户输入、AI 输出、提示词或聊天显示。',
            path: ['补丁铺', '脚本编辑', '运行位置'],
            deepLink: link(AppID.Regex, 'manual-regex-placement'),
          },
        ],
      },
    ],
  },
  {
    app: '文具盒',
    en: 'Settings',
    category: 'system',
    summary: '系统设置中心，集中管理界面、安全、备份、聊天连接、实时感知、通知和外部服务。',
    features: [
      '基础与安全：界面全屏、顶部状态栏、手机安装版更新、锁屏密码。',
      '备份与恢复：本地 ZIP、文字数据、媒体与外观、云端备份和恢复。',
      '模型与服务：主 API、副 API、API 调用记录、MiniMax、Replicate / ACE-Step 等外部服务。',
      '实时与通知：天气、新闻、Notion、飞书、小红书、系统通知、VAPID、主动消息 Push、Instant Push。',
    ],
    tips: ['手机安装版更新需要系统确认安装；备份文件和 API 凭据只保存在你的设备或你自己的云端账号下。'],
    settingSections: [
      {
        id: 'settings-basic',
        title: '基础、安全与更新',
        settings: [
          {
            id: 'settings-fullscreen',
            title: '界面全屏',
            description: '让 Moro 网页铺满屏幕，尽量隐藏浏览器地址栏和系统栏。',
            defaultBehavior: '默认不强制全屏。',
            options: [
              { label: '开启', description: '进入浏览器全屏；再次点击或按返回退出。' },
              { label: '关闭', description: '保持浏览器普通显示。' },
            ],
            path: ['文具盒', '基础与安全', '界面全屏'],
            deepLink: settingsLink('manual-settings-fullscreen', 'group:basic'),
          },
          {
            id: 'settings-statusbar',
            title: '顶部状态栏',
            description: '藏起 Moro 自带的时间、电量和网络状态栏。',
            defaultBehavior: '默认显示。',
            options: [
              { label: '显示', description: '保留 Moro 顶部状态信息。' },
              { label: '隐藏', description: '收起状态栏，适合沉浸式或手机 PWA。' },
            ],
            path: ['文具盒', '基础与安全', '顶部状态栏'],
            deepLink: settingsLink('manual-settings-statusbar', 'group:basic'),
          },
          {
            id: 'settings-apk-update',
            title: '应用更新',
            description: '检查开发者发布的新版本，下载新版安装包；国内线路只是下载通道不同，版本相同。',
            path: ['文具盒', '基础与安全', '应用更新'],
            deepLink: settingsLink('manual-settings-update', 'group:basic'),
            nativeOnly: true,
          },
          {
            id: 'settings-lock',
            title: '锁屏密码',
            description: '开启后，解锁 Moro 需要输入 4 位数字密码。',
            defaultBehavior: '默认关闭；默认密码是系统内置的 4 位密码，开启后建议立即修改。',
            options: [
              { label: '关闭', description: '点按即可进入。' },
              { label: '开启', description: '进入前需要输入 4 位数字密码。' },
              { label: '更新密码', description: '输入当前密码和新的 4 位数字后保存。' },
            ],
            path: ['文具盒', '基础与安全', '锁屏与密码'],
            deepLink: settingsLink('manual-settings-lock', 'group:basic'),
          },
        ],
      },
      {
        id: 'settings-backup',
        title: '备份与恢复',
        settings: [
          {
            id: 'settings-local-backup',
            title: '本地备份（ZIP）',
            description: '导出或导入本机数据，适合迁移设备或保存快照。',
            options: [
              { label: '完整备份', description: '文字数据与媒体资源一起导出，适合迁移。' },
              { label: '文字数据', description: '聊天、角色、剧情和设置，不包含图片。' },
              { label: '媒体与外观', description: '相册、表情、聊天图片、头像、主题气泡、壁纸、图标等。' },
              { label: '导入备份', description: '支持新版 ZIP 和旧版 JSON。' },
            ],
            path: ['文具盒', '备份与恢复', '本地备份'],
            deepLink: settingsLink('manual-settings-local-backup', 'group:backup'),
          },
          {
            id: 'settings-cloud-backup',
            title: '云端备份',
            description: '把备份保存到你自己的 GitHub 或 WebDAV 账号，便于换设备或恢复。',
            defaultBehavior: '默认仅本地备份。',
            options: [
              { label: 'GitHub', description: '推荐，可直连，备份存到 releases。' },
              { label: 'WebDAV', description: '适合 NAS 或自有网盘，可能需要代理。' },
              { label: '上传文字 / 完整备份', description: '按体积和用途选择上传内容。' },
              { label: '从云端恢复', description: '从云端列表选择备份恢复到本机。' },
            ],
            path: ['文具盒', '备份与恢复', '云端备份'],
            deepLink: settingsLink('manual-settings-cloud-backup', 'group:backup'),
          },
        ],
      },
      {
        id: 'settings-api',
        title: '模型与外部服务',
        settings: [
          {
            id: 'settings-main-api',
            title: '主 API',
            description: '用于私聊、群聊、电话等核心对话生成。',
            options: [
              { label: '接口地址', description: 'OpenAI 兼容接口的 base URL。' },
              { label: 'API Key', description: '你的模型服务密钥，只保存在本机。' },
              { label: '模型', description: '从接口拉取或手动输入模型名。' },
              { label: '流式输出', description: '开启后边生成边显示；不支持时可关闭。' },
              { label: '温度', description: '越高越发散，越低越稳定。' },
              { label: '上下文防爆保护', description: '防止请求过长导致模型报错。' },
            ],
            path: ['文具盒', '模型与服务', '主 API'],
            deepLink: settingsLink('manual-settings-main-api', 'group:api'),
          },
          {
            id: 'settings-aux-api',
            title: '副 API',
            description: '用于日程生成、日程协调、生活侧写、记忆整理等聊天以外的后台任务。',
            defaultBehavior: '关闭或未填完整时自动回退主 API。',
            options: [
              { label: '关闭', description: '所有辅助任务回退主 API。' },
              { label: '开启', description: '后台任务优先使用副 API，可选更快或更便宜的模型。' },
              { label: '复制主 API', description: '快速复用主 API 地址和密钥。' },
            ],
            path: ['文具盒', '模型与服务', '副 API'],
            deepLink: settingsLink('manual-settings-aux-api', 'group:api'),
          },
          {
            id: 'settings-api-log',
            title: 'API 调用记录',
            description: '查看最近 5 天的调用时间、接口、应用、角色和用途。',
            path: ['文具盒', '模型与服务', 'API 调用记录'],
            deepLink: settingsLink('manual-settings-api-log', 'group:api'),
          },
          {
            id: 'settings-other-services',
            title: '其他服务 API',
            description: '配置语音、写歌等非 LLM 类服务；这些配置不会随 API 预设切换。',
            options: [
              { label: 'MiniMax 服务器', description: '国服 / 海外二选一。' },
              { label: 'MiniMax Key / Group ID', description: '电话、音色和 TTS 相关功能使用。' },
              { label: 'Replicate Token', description: '写歌 App 调用 ACE-Step 生成完整歌曲。' },
            ],
            path: ['文具盒', '模型与服务', '其他服务 API'],
            deepLink: settingsLink('manual-settings-other-services', 'group:api'),
          },
        ],
      },
      {
        id: 'settings-live',
        title: '实时感知与通知',
        settings: [
          {
            id: 'settings-realtime',
            title: '实时感知',
            description: '让角色在聊天中使用真实世界信息：天气、新闻热点、当前时间，以及 Notion / 飞书 / 小红书等数据源。',
            options: [
              { label: '天气', description: '按角色城市或配置位置提供天气。' },
              { label: '新闻', description: '让角色自然知道热点背景。' },
              { label: 'Notion / 飞书', description: '把你的笔记作为可选实时资料源。' },
              { label: '小红书', description: '接入小红书相关外部服务。' },
            ],
            path: ['文具盒', '实时与通知', '实时感知'],
            deepLink: settingsLink('manual-settings-realtime', 'group:live'),
          },
          {
            id: 'settings-notification',
            title: '系统通知',
            description: '聊天生成完成后发送系统通知；网页端取决于浏览器权限，手机安装版取决于手机系统权限。',
            options: [
              { label: '开启系统通知权限', description: '首次使用会弹出系统或浏览器授权。' },
              { label: '后台回复通知', description: '普通聊天切后台后，回复完成时尝试进入通知栏。' },
            ],
            path: ['文具盒', '实时与通知', '系统通知'],
            deepLink: settingsLink('manual-settings-notification', 'group:live'),
          },
          {
            id: 'settings-vapid',
            title: '推送凭据（VAPID）',
            description: 'Proactive Push 和 Instant Push 共用的 Web Push 密钥对。',
            defaultBehavior: '未配置时 Web Push 相关能力不可用。',
            path: ['文具盒', '实时与通知', '推送凭据'],
            deepLink: settingsLink('manual-settings-vapid', 'group:live'),
          },
          {
            id: 'settings-proactive-push',
            title: '主动消息 Push 加速',
            description: '让主动消息在浏览器后台标签中按计划触发；浏览器完全关闭后仍会在下次打开时补跑。',
            defaultBehavior: '未启用时使用本地计时器。',
            path: ['文具盒', '实时与通知', '主动消息 Push 加速'],
            deepLink: settingsLink('manual-settings-proactive-push', 'group:live'),
          },
          {
            id: 'settings-instant-push',
            title: 'Instant Push',
            description: '配置自部署 Worker 驱动的即时 Web Push 回复。',
            path: ['文具盒', '实时与通知', 'Instant Push'],
            deepLink: settingsLink('manual-settings-instant-push', 'group:live'),
          },
        ],
      },
    ],
  },
  {
    app: '拼贴册',
    en: 'Appearance',
    category: 'system',
    summary: '整机外观和聊天皮肤编辑器，管理壁纸、图标、桌面、小组件、聊天气泡、每个 App 的自定义 CSS 和可复制给 AI 的 CSS 提示词库。',
    features: [
      '调色页更换整机色调、深浅色和内容文字颜色。',
      '桌面页配置壁纸、图标形状、图标材质、图标大小、Dock、编辑效果和小组件，并提供桌面、小组件、锁屏、灵动岛、悬浮菜单等 CSS 提示词。',
      '对话页编辑聊天默认外观：气泡、背景、顶栏、底栏、头像、发送按钮等；聊天白框 CSS 也直接在这里写，气泡 CSS 去气泡裁剪台。',
      'App 分区可给每个软件单独写 CSS，并按当前 App 自动生成完整定制、局部微调和修坏修复提示词。',
      '手写码页提供整机 CSS、教程代码和新手一句话、完整定制、风格扩写、修坏修复等提示词模板。',
      '存档册可导入导出外观方案，包含每个 App 的 CSS 设置。',
    ],
    settingSections: [
      {
        id: 'appearance-settings',
        title: '外观页签',
        settings: [
          {
            id: 'appearance-theme',
            title: '调色页',
            description: '调整整机主色、深浅色、内容文字颜色和默认壁纸。',
            path: ['拼贴册', '调色页'],
            deepLink: appearanceLink('manual-appearance-theme', 'theme'),
          },
          {
            id: 'appearance-desktop',
            title: '桌面页',
            description: '设置桌面壁纸、Dock、图标大小、标签、拖拽模式、编辑动效和小组件；桌面整体、小组件、锁屏、灵动岛、悬浮菜单和线下弹窗都有可复制给 AI 的 CSS 提示词。',
            path: ['拼贴册', '桌面页'],
            deepLink: appearanceLink('manual-appearance-desktop', 'desktop'),
          },
          {
            id: 'appearance-chat',
            title: '聊天气泡与对话页',
            description: '配置聊天气泡、背景、顶栏、底栏、输入栏、头像、发送按钮和默认聊天皮肤；聊天白框 CSS 直接在本页写，气泡 CSS 去气泡裁剪台。',
            path: ['拼贴册', '对话页'],
            deepLink: appearanceLink('manual-appearance-chat', 'chat'),
          },
          {
            id: 'appearance-css',
            title: '手写码',
            description: '为整机写自定义 CSS，并查看 DIY 教程代码和提示词库；流程是复制提示词 → 发给 AI → 把生成的 CSS 粘回代码框，写坏时可清空或用修坏修复提示词恢复。聊天白框 CSS 已移到对话页。',
            path: ['拼贴册', '手写码'],
            deepLink: appearanceLink('manual-appearance-css', 'css'),
          },
          {
            id: 'appearance-apps',
            title: 'App 分区',
            description: '按软件分区写 CSS。每个 App 都有 [data-moro-app="应用ID"]、.moro-app-shell-应用ID 等稳定钩子，也能一键复制当前 App 的完整定制、局部微调和修坏修复提示词给 AI。',
            path: ['拼贴册', 'App 分区'],
            deepLink: appearanceLink('manual-appearance-apps', 'apps'),
          },
          {
            id: 'appearance-icons',
            title: '图标贴',
            description: '给桌面 App 换自定义图标。',
            path: ['拼贴册', '图标贴'],
            deepLink: appearanceLink('manual-appearance-icons', 'icons'),
          },
          {
            id: 'appearance-tarot',
            title: '牌面',
            description: '美化折子戏占卜用的牌背、边框和牌面风格。',
            path: ['拼贴册', '牌面'],
            deepLink: appearanceLink('manual-appearance-tarot', 'tarot'),
          },
          {
            id: 'appearance-presets',
            title: '存档册',
            description: '保存、应用、导入、导出和重置外观方案。',
            path: ['拼贴册', '存档册'],
            deepLink: appearanceLink('manual-appearance-presets', 'presets'),
          },
        ],
      },
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
    settingSections: [
      {
        id: 'music-settings',
        title: '音乐设置',
        settings: [
          {
            id: 'music-library',
            title: '音乐库与播放',
            description: '管理歌曲、播放队列和全局迷你播放器。',
            path: ['音乐', '音乐库'],
            deepLink: link(AppID.Music, 'manual-music-library'),
          },
          {
            id: 'music-character',
            title: '角色音乐页',
            description: '查看角色听歌、评论和推荐记录。',
            path: ['音乐', '角色音乐页'],
            deepLink: link(AppID.Music, 'manual-music-character'),
          },
        ],
      },
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
      '后台整理统一使用「文具盒」里的副 API；未配置时不会另开标本馆专属通道。',
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
    settingSections: [
      {
        id: 'room-settings',
        title: '房间与像素小家',
        settings: [
          {
            id: 'room-layout',
            title: '房间布置',
            description: '调整房间背景、家具、装饰和可互动说明。',
            path: ['栖居志', '角色房间'],
            deepLink: link(AppID.Room, 'manual-room-layout'),
          },
          {
            id: 'room-pixel-home',
            title: '像素小家',
            description: '编辑像素角色、房间模板和素材库。',
            path: ['栖居志', '像素小家'],
            deepLink: link(AppID.Room, 'manual-room-pixel-home'),
          },
        ],
      },
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
      '红包、转账、购物、外卖等事件会与余额体验互相呼应。',
    ],
    settingSections: [
      {
        id: 'bank-settings',
        title: '资产页面',
        settings: [
          {
            id: 'bank-dashboard',
            title: '账户总览',
            description: '查看余额、资产、收入支出和分析图。',
            path: ['人生拟', '账户总览'],
            deepLink: link(AppID.Bank, 'manual-bank-dashboard'),
          },
          {
            id: 'bank-goals',
            title: '攒钱目标',
            description: '设定和追踪虚拟攒钱目标。',
            path: ['人生拟', '攒钱目标'],
            deepLink: link(AppID.Bank, 'manual-bank-goals'),
          },
        ],
      },
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
      '絮语中的此刻仍保留熟人动态互动。',
    ],
  },
  {
    app: '自习室',
    en: 'Study',
    category: 'creation',
    summary: '让角色陪你学习、讲解资料、出题复习，也能开语言课。',
    features: [
      '普通课本可导入 PDF，角色会帮你拆章节、讲解、答疑和生成随堂测。',
      '语言学习分区可直接生成日语、韩语、意大利语等学习路线，也能导入教材整理成语言课。',
      '语言课会围绕词汇、语法、短句、情景对话和常见错误练习，角色会按人设辅导和纠错。',
      '专业级语言学习会强化语域、行业术语、正式写作、商务/学术表达、翻译取舍和表达润色。',
      '练习册会保存测验分数、错题解析和追问记录，方便回头复习。',
    ],
    settingSections: [
      {
        id: 'study-settings',
        title: '学习入口',
        settings: [
          {
            id: 'study-courses',
            title: '普通课本',
            description: '导入 PDF 后生成课程章节，让角色讲课、答疑和出题。',
            path: ['自习室', '普通课本', '收一本 PDF'],
            deepLink: link(AppID.Study, 'manual-study-courses'),
          },
          {
            id: 'study-language',
            title: '语言学习',
            description: '选择语言、水平和目标，生成学习路线；专业级适合商务、学术、翻译和行业术语训练，也可以导入教材做语言课。',
            path: ['自习室', '语言学习', '新建语言课 / 导入教材'],
            deepLink: link(AppID.Study, 'manual-study-language'),
          },
          {
            id: 'study-workbook',
            title: '练习册',
            description: '回看随堂测、分数、错题解析和追问记录。',
            path: ['自习室', '右上角练习册'],
            deepLink: link(AppID.Study, 'manual-study-workbook'),
          },
        ],
      },
    ],
  },
  {
    app: '折子戏',
    en: 'Theater',
    category: 'roleplay',
    summary: '黑白拼贴手账风的剧场入口，收纳攻略本、番外、占卜、谈心、TRPG、轨迹、对影、狼人杀和真心话大冒险。',
    features: [
      '戏单首页选择九折玩法，每一折保留独立存档和风格。',
      '占卜支持塔罗、雷诺曼、六爻和梅花易数。',
      '番外可生成仿微信聊天截图、朋友圈、小红书或匿名论坛图文；问卷支持单角色 / 多角色一起答题。',
      '问卷里提交你的答案后会进入本题评论区，角色会自动点评，你也可以继续评论角色答案；只有点下一题才推进。',
      '问卷历史会保存，可续做、回看或删除；导出到聊天时可选择简洁摘要或完整对话。',
      '狼人杀和真心话大冒险可围绕熟人角色开局。',
    ],
  },
  {
    app: '创作社',
    en: 'Creative Studio',
    category: 'creation',
    summary: '共创小说与写歌的合并入口。',
    features: [
      '笔友会用于共创小说、章节和角色文本。',
      '写歌可写歌词、编曲，并在配置 Replicate Token 后生成完整歌曲。',
      '作品可保存、回看，歌曲可进入音乐库继续播放。',
    ],
  },
  {
    app: '页外',
    en: 'VR World',
    category: 'roleplay',
    summary: '角色自主登入的虚拟世界，房间里看小说、听歌、留言并产生活动卡。',
    features: [
      '角色可在页外自主活动，产出片段注入聊天和记忆。',
      '可以查看房间、留言、活动和时间线。',
      '定时驱动依赖浏览器运行状态，回到前台时会补跑到期任务。',
    ],
    settingSections: [
      {
        id: 'vrworld-settings',
        title: '页外设置',
        settings: [
          {
            id: 'vrworld-schedule',
            title: '自主登入与活动',
            description: '控制角色进入页外、活动记录和回写聊天的节奏。',
            path: ['页外', '设置 / 活动'],
            deepLink: link(AppID.VRWorld, 'manual-vrworld-schedule'),
          },
        ],
      },
    ],
  },
  {
    app: '岁时记',
    en: 'Almanac',
    category: 'daily',
    summary: '时间相册式入口，用拍立得卡片收纳共享月历、时光契约、典藏馆、喜事和特别时光。',
    features: [
      '首页以当月日历和拍立得入口展示：点月历格进入共享月历，点相片卡进入对应栏目。',
      '共享月历可给任意日期贴便签，也能请角色按自己的语气往未来日期记下期待。',
      '时光契约记录日程、心愿单和纪念日倒数；特别时光收纳节日活动和回忆。',
      '典藏馆收纳谈心、创作社、自习室和折子戏里的收藏内容。',
      '求婚成功后会进入喜事 / 婚姻筹备相关内容。',
    ],
    settingSections: [
      {
        id: 'almanac-pages',
        title: '页面入口',
        settings: [
          {
            id: 'almanac-calendar',
            title: '这个月 / 共享月历',
            description: '按真实月份显示日历；点日期贴便签，右上角魔杖可请角色记一笔。',
            path: ['岁时记', '这个月'],
            deepLink: link(AppID.Almanac, 'manual-almanac-calendar-root', 'calendar'),
          },
          {
            id: 'almanac-schedule',
            title: '时光契约',
            description: '记录要做的事、监督人、心愿单和纪念日倒数。',
            path: ['岁时记', '时光契约'],
            deepLink: link(AppID.Almanac, 'manual-almanac-schedule-card', 'schedule'),
          },
          {
            id: 'almanac-collection',
            title: '典藏馆',
            description: '回看已收进来的谈心、同人、课业和剧场内容，也能转发给角色。',
            path: ['岁时记', '典藏馆'],
            deepLink: link(AppID.Almanac, 'manual-almanac-collection-card', 'collection'),
          },
          {
            id: 'almanac-wedding',
            title: '喜事',
            description: '求婚成功后查看订婚日、婚期、领证、婚礼和婚事时间线。',
            path: ['岁时记', '喜事'],
            deepLink: link(AppID.Almanac, 'manual-almanac-wedding-card', 'wedding'),
          },
          {
            id: 'almanac-moments',
            title: '特别时光',
            description: '回看情人节、白色情人节、520 等节日活动留下的页面。',
            path: ['岁时记', '特别时光'],
            deepLink: link(AppID.Almanac, 'manual-almanac-moments-card', 'moments'),
          },
        ],
      },
    ],
  },
  {
    app: '健康',
    en: 'Health',
    category: 'daily',
    summary: '经期记录与提醒工具：按最近一次开始日、周期和提醒时间预测下一次经期。',
    features: [
      '首页直接设置最近一次开始日、周期长度、经期天数、提醒时间和提前提醒日。',
      '默认按 28 天周期、5 天经期预测，提前 2 天和当天 09:00 提醒；预测只做生活提醒，不是医疗诊断。',
      '浏览器版会在 Moro 标签页或 PWA 仍运行时弹系统通知；浏览器完全关闭后不承诺常驻提醒。',
      '手机安装版会用软件本地通知排程；点击通知会回到健康 App。',
      '选择「公开给角色」后，可让选中的角色用自己的语气关心提醒；私密模式不会写入聊天，也不会告诉角色。',
    ],
    tips: ['如果手账里有「经期」打卡，点「今天开始 / 今天结束」时会尽量同步；没有也不影响健康 App 独立保存记录。'],
    settingSections: [
      {
        id: 'health-period-reminders',
        title: '经期提醒',
        settings: [
          {
            id: 'health-period-settings',
            title: '周期与提醒',
            description: '填写最近一次经期开始日、周期长度、经期天数、提醒时间和提前几天提醒。',
            defaultBehavior: '默认周期 28 天、经期 5 天、提醒日为提前 2 天和当天、提醒时间 09:00。',
            path: ['健康', '经期提醒设置'],
            deepLink: link(AppID.Health, 'manual-health-period-root'),
          },
          {
            id: 'health-period-privacy',
            title: '公开 / 私密',
            description: '决定提醒是否能被角色知道，以及只弹系统通知、只由角色提醒或两者都要。',
            options: [
              { label: '私密', description: '只在健康 App 和本地系统通知里提醒，不进入角色上下文。' },
              { label: '公开给角色', description: '到点后选中的角色可以在聊天里用关心的语气提醒。' },
            ],
            path: ['健康', '公开与提醒方式'],
            deepLink: link(AppID.Health, 'manual-health-privacy'),
          },
        ],
      },
    ],
  },
  {
    app: '饭票',
    en: 'Takeout',
    category: 'daily',
    summary: '美团式外卖联动：本地生成店铺、点菜下单、配送进度，并与聊天联动。',
    features: [
      '选择店铺、商品和配送方式，生成订单小票。',
      '订单可与现实配送节奏同步，支持收货确认。',
      '可给角色点单或让角色围绕外卖事件回应。',
    ],
    settingSections: [
      {
        id: 'takeout-settings',
        title: '外卖流程',
        settings: [
          {
            id: 'takeout-order',
            title: '点单与小票',
            description: '生成店铺、菜品、订单和聊天小票。',
            path: ['饭票', '点单'],
            deepLink: link(AppID.Takeout, 'manual-takeout-order'),
          },
          {
            id: 'takeout-delivery',
            title: '配送与收货',
            description: '查看配送进度、骑手 / 商家对话和收货确认。',
            path: ['饭票', '订单详情'],
            deepLink: link(AppID.Takeout, 'manual-takeout-delivery'),
          },
        ],
      },
    ],
  },
  {
    app: '循迹',
    en: 'Xunji',
    category: 'daily',
    summary: '角色 Screenlife 演出与异地恋式监视 / 报备模拟。',
    features: [
      '选择角色，生成屏幕记录或刷新实时概览。',
      '生成页可补一段指定时间范围的 Screenlife。',
      '报备页查看事件提醒，也能按规则生成新报备、标记已读或写回角色日常。',
      '絮语联动决定这些线索是否进入聊天上下文。',
    ],
    settingSections: [
      {
        id: 'xunji-settings',
        title: '循迹设置',
        settings: [
          {
            id: 'xunji-chat-context',
            title: '加入聊天上下文',
            description: '控制屏幕记录、实时数据和提醒是否加入絮语聊天上下文。',
            defaultBehavior: '默认加入。',
            options: [
              { label: '开启', description: '角色聊天时能参考循迹线索。' },
              { label: '关闭', description: '循迹内容只在 App 内回看。' },
            ],
            path: ['循迹', '絮语联动', '加入聊天上下文'],
            deepLink: link(AppID.Xunji, 'manual-xunji-chat-context', 'settings'),
          },
          {
            id: 'xunji-auto-trace',
            title: '自动更新',
            description: '生成过首条记录后，后续可按时间自动续写角色的屏幕生活。',
            defaultBehavior: '默认开启。',
            path: ['循迹', '絮语联动', '自动更新'],
            deepLink: link(AppID.Xunji, 'manual-xunji-auto-trace', 'settings'),
          },
          {
            id: 'xunji-writeback',
            title: '循迹写入日常',
            description: '把最新痕迹写回角色日常，让 TA 当成自己经历过的小日子。',
            defaultBehavior: '关闭时只在循迹本地保存，不惊动 TA 的日常。',
            options: [
              { label: '仅本地', description: '只在循迹里翻看。' },
              { label: '写入日常', description: '角色会把它当成自己的生活经历。' },
            ],
            path: ['循迹', '絮语联动', '写入日常'],
            deepLink: link(AppID.Xunji, 'manual-xunji-writeback', 'settings'),
          },
          {
            id: 'xunji-location',
            title: '位置来源',
            description: '决定循迹生成时参考角色设定位置，还是使用浏览器真实定位。',
            options: [
              { label: '角色设定', description: '按角色城市或手动位置生成。' },
              { label: '真实定位', description: '需要浏览器授权，仅在本机保存坐标。' },
            ],
            path: ['循迹', '设置', '位置来源'],
            deepLink: link(AppID.Xunji, 'manual-xunji-location', 'settings'),
          },
          {
            id: 'xunji-density',
            title: '默认密度',
            description: '控制 Screenlife 生成的细节密度。',
            options: [
              { label: '轻量', description: '更短、更概括。' },
              { label: '标准', description: '常规细节。' },
              { label: '详细', description: '更密集、更像完整屏幕生活片段。' },
            ],
            path: ['循迹', '设置', '默认密度'],
            deepLink: link(AppID.Xunji, 'manual-xunji-density', 'settings'),
          },
        ],
      },
    ],
  },
  {
    app: '心意铺',
    en: 'Shop',
    category: 'daily',
    summary: '虚拟礼物商城：买礼物送角色，角色也会自己逛、回赠或留下订单。',
    features: [
      '浏览商品、收藏、加购和下单。',
      '送给角色的礼物会落到聊天里，角色会回应或写感谢。',
      '查看订单、小票、物流和商品评价。',
    ],
  },
  {
    app: '椒房记',
    en: 'Harem',
    category: 'roleplay',
    summary: 'AI 后宫文游，用选择、恩宠、赏罚和宫苑行动推进长线剧情。',
    features: [
      '宫廷舞台展示本场标题、地点、章节进度、在场角色状态和风闻。',
      '自由行动会先显示风险、代价和收益，确认后推进剧情。',
      '宠爱经营台可召见、赐赏、护持、冷处理、调停和普赏。',
      '多周目保存进度，探索不同结局。',
    ],
  },
  {
    app: '茶话亭',
    en: 'Forum',
    category: 'social',
    summary: '可浏览的论坛：板块、帖子和跟帖，用户发帖回帖，角色与匿名网友一起盖楼。',
    features: [
      '浏览论坛板块、帖子和跟帖。',
      '自己发帖回复，角色和匿名网友会参与讨论。',
      '关系求助、吐槽、八卦、树洞和围观都适合放在这里。',
    ],
    settingSections: [
      {
        id: 'forum-settings',
        title: '论坛入口',
        settings: [
          {
            id: 'forum-board',
            title: '板块 / 帖子 / 跟帖',
            description: '进入论坛板块、发帖、回帖或围观角色与匿名网友讨论。',
            path: ['茶话亭', '板块 / 帖子 / 跟帖'],
            deepLink: link(AppID.Forum, 'manual-forum-board'),
          },
        ],
      },
    ],
  },
  {
    app: '推特',
    en: 'Twitter',
    category: 'social',
    summary: '本地 AI 生成的 X / Twitter 式时间线，角色、NPC 和用户可自由发推互动。',
    features: [
      '首页浏览公开时间线，包含碎碎念、争论、转发、投票和链接卡。',
      '搜索页查关键词、话题、账号、媒体和趋势分组。',
      '私信页适合和角色进行 X 风格短对话。',
      '我的页面维护用户账号资料、语言、收藏、喜欢和引用记录。',
    ],
    settingSections: [
      {
        id: 'twitter-settings',
        title: '推特页面',
        settings: [
          {
            id: 'twitter-home',
            title: '首页时间线',
            description: '查看公开动态、点赞、转发、回复和引用。',
            path: ['推特', '首页'],
            deepLink: link(AppID.Twitter, 'manual-twitter-home'),
          },
          {
            id: 'twitter-profile',
            title: '我的账号',
            description: '维护用户账号资料、语言、收藏、喜欢和引用记录。',
            path: ['推特', '我的'],
            deepLink: link(AppID.Twitter, 'manual-twitter-profile'),
          },
        ],
      },
    ],
  },
  {
    app: '桌宠',
    en: 'Desktop Pet',
    category: 'daily',
    summary: 'DyberPet 桌面宠物：喂食、摸摸、提醒和跨 App 悬浮陪伴。',
    features: [
      '打开后选择桌宠，直接对话、喂食或摸摸。',
      '桌宠设定只作用于当前桌宠，可写对话风格、称呼、偏好或禁忌。',
      '点「放到桌面」后可跨 App 悬浮，长按显示状态栏、快速喂食、缩放、隐藏和贴边按钮。',
      '提醒需要通知权限；网页只在 Moro 页面运行时检查提醒。',
    ],
    settingSections: [
      {
        id: 'pet-settings',
        title: '桌宠设置',
        settings: [
          {
            id: 'pet-profile',
            title: '桌宠设定',
            description: '设置当前桌宠的对话风格、称呼、偏好和不该说的话。',
            path: ['桌宠', '设定'],
            deepLink: link(AppID.DesktopPet, 'manual-pet-profile'),
          },
          {
            id: 'pet-floating',
            title: '悬浮桌宠',
            description: '控制跨 App 悬浮、大小、贴边和隐藏。',
            path: ['桌宠', '放到桌面 / 悬浮设置'],
            deepLink: link(AppID.DesktopPet, 'manual-pet-floating'),
          },
          {
            id: 'pet-reminders',
            title: '提醒',
            description: '桌宠提醒需要系统通知权限。',
            path: ['桌宠', '提醒'],
            deepLink: link(AppID.DesktopPet, 'manual-pet-reminders'),
          },
        ],
      },
    ],
  },
  {
    app: '自由活动',
    en: 'XHS Free Roam',
    category: 'social',
    summary: '让角色自己刷小红书风格内容，浏览、点赞、收藏、评论或发布。',
    features: [
      '选择角色后，让 TA 自己去刷小红书风格内容。',
      '角色行为会按性格和近况展开。',
      '适合让角色拥有聊天之外的社交时间。',
    ],
  },
  {
    app: '拾光图库',
    en: 'XHS Stock',
    category: 'social',
    summary: '收集、整理和准备发帖图片素材。',
    features: [
      '整理发帖图片素材。',
      '配合见闻簿与自由活动使用，让角色发布内容时有图可用。',
      '素材多了以后，可以按用途挑选更合适的图片。',
    ],
  },
  {
    app: '回声亭',
    en: 'Phone',
    category: 'social',
    summary: '主动给角色打电话，或回看接听、未接、拨出记录。',
    features: [
      '拨号给角色，或接续悬挂通话。',
      '通话结束后可回放录音和逐字稿。',
      '角色来电也会在这里留下记录。',
    ],
  },
  {
    app: '街角',
    en: 'LifeSim',
    category: 'roleplay',
    summary: '与角色共同经营的小世界，探索地点、NPC、关系和约会剧情。',
    features: [
      '进入小镇生活，探索地点、NPC、关系和剧情。',
      '约会时分开输入话语和动作，让场景更像真实互动。',
      '离线生活、地图、图鉴和关系页都能回看世界变化。',
    ],
  },
];

export const MANUAL_DESTINATIONS: Record<string, ManualDestination> = {
  '说明书': {
    appId: AppID.Manual,
    path: ['桌面', '说明书'],
    details: ['查看整机 App 与设置说明，也可以搜索关键词并跳到对应界面。'],
    deepLink: link(AppID.Manual, 'manual-root'),
  },
  '絮语': {
    appId: AppID.GroupChat,
    path: ['Dock / 桌面', '絮语'],
    details: ['聊天、名册、此刻、情侣空间和关系网都从这里进。'],
    deepLink: chatHubLink('manual-chathub-root', 'tab:chats', { tab: 'chats' }),
  },
  '絮语·单聊工具': {
    appId: AppID.Chat,
    path: ['絮语', '点角色单聊', '底部回形针'],
    details: ['打开当前角色的单聊工具；闹钟在「两个人的事」分组里，可设置睡觉、起床和自定义提醒。'],
    jumpText: '打开闹钟',
    deepLink: chatAlarmLink('manual-chat-alarm-root'),
  },
  '絮语·单聊设置': {
    appId: AppID.Chat,
    path: ['絮语', '点角色单聊', '右上角 ···', '聊天设置'],
    details: ['打开当前角色的聊天设置；如果当前没有角色，会先回到絮语名册。'],
    jumpText: '打开聊天设置',
    deepLink: chatSettingsLink('manual-chat-settings-root'),
  },
  '絮语·群聊设置': {
    appId: AppID.GroupChat,
    path: ['絮语', '群聊', '右上角齿轮'],
    details: ['优先打开当前群设置；没有当前群时跳到群聊列表。'],
    jumpText: '打开群设置',
    deepLink: chatHubLink('manual-chathub-group-settings', 'group-settings'),
  },
  '剪影集': {
    appId: AppID.Personas,
    path: ['桌面', '剪影集'],
    details: ['维护角色档案、用户身份和身份绑定。'],
    deepLink: link(AppID.Personas, 'manual-personas-root'),
  },
  '剪报夹': {
    appId: AppID.Worldbook,
    path: ['桌面', '剪报夹'],
    details: ['管理世界书分组、条目、全局 / 局部作用域和插入位置。'],
    deepLink: link(AppID.Worldbook, 'manual-worldbook-root'),
  },
  '活字盘': {
    appId: AppID.Presets,
    path: ['桌面', '活字盘'],
    details: ['管理聊天预设、提示词和采样参数。'],
    deepLink: link(AppID.Presets, 'manual-presets-root'),
  },
  '补丁铺': {
    appId: AppID.Regex,
    path: ['桌面', '补丁铺'],
    details: ['管理正则脚本和运行位置。'],
    deepLink: link(AppID.Regex, 'manual-regex-root'),
  },
  '文具盒': {
    appId: AppID.Settings,
    path: ['Dock / 桌面', '文具盒'],
    details: ['配置整机基础、安全、备份、API、实时感知和通知。'],
    deepLink: settingsLink('manual-settings-root'),
  },
  '拼贴册': {
    appId: AppID.Appearance,
    path: ['桌面', '拼贴册'],
    details: ['编辑整机外观、桌面、图标、聊天皮肤、CSS、牌面和外观存档。'],
    deepLink: appearanceLink('manual-appearance-root', 'theme'),
  },
  '相册': { appId: AppID.Gallery, path: ['桌面', '相册'], details: ['按角色查看聊天中保存的图片。'], deepLink: link(AppID.Gallery, 'manual-gallery-root') },
  '音乐': { appId: AppID.Music, path: ['桌面', '音乐'], details: ['播放音乐、查看角色音乐页和一起听记录。'], deepLink: link(AppID.Music, 'manual-music-root') },
  '热点': { appId: AppID.HotNews, path: ['桌面', '热点'], details: ['浏览多平台热榜并转发给角色。'], deepLink: link(AppID.HotNews, 'manual-hotnews-root') },
  '回忆标本馆': { appId: AppID.MemoryPalace, path: ['桌面', '回忆标本馆'], details: ['浏览长期记忆、事件盒、月度总结和关系网络。'], deepLink: link(AppID.MemoryPalace, 'manual-memory-root') },
  '栖居志': { appId: AppID.Room, path: ['桌面', '栖居志'], details: ['查看和布置角色房间、像素小家和生活状态。'], deepLink: link(AppID.Room, 'manual-room-root') },
  '人生拟': { appId: AppID.Bank, path: ['桌面', '人生拟'], details: ['查看虚拟资产、流水、攒钱目标和经营小游戏。'], deepLink: link(AppID.Bank, 'manual-bank-root') },
  '日记': { appId: AppID.Journal, path: ['桌面', '日记'], details: ['写私人日记或查看角色视角记录。'], deepLink: link(AppID.Journal, 'manual-diary-root') },
  '见闻簿': { appId: AppID.Social, path: ['Dock / 桌面', '见闻簿'], details: ['浏览、发布、点赞、收藏、评论或转发小红书风格动态。'], deepLink: link(AppID.Social, 'manual-social-root') },
  '自习室': {
    appId: AppID.Study,
    path: ['桌面', '自习室', '普通课本 / 语言学习'],
    details: [
      '普通课本可导入 PDF，让角色讲课、提问和出随堂测。',
      '语言学习可直接生成日语、韩语、意大利语等路线，也能导入教材整理成语言课。',
      '专业级适合练商务职场、学术写作、专业翻译和行业术语。',
      '右上角练习册可回看测验、分数、错题解析和追问记录。',
    ],
    deepLink: link(AppID.Study, 'manual-study-root'),
  },
  '折子戏': {
    appId: AppID.Theater,
    path: ['桌面', '折子戏'],
    details: [
      '进入九折剧场玩法。',
      '番外问卷适合做角色访谈、相性测试或多人围观答题；不想进入下一题时，可以留在当前题评论区继续聊。',
      '问卷可从历史里继续，完成后可把摘要或完整评论对话发到聊天。',
    ],
    deepLink: link(AppID.Theater, 'manual-theater-root'),
  },
  '创作社': { appId: AppID.Creative, path: ['桌面', '创作社'], details: ['进入共创小说或写歌。'], deepLink: link(AppID.Creative, 'manual-creative-root') },
  '页外': { appId: AppID.VRWorld, path: ['桌面', '页外'], details: ['查看角色自主登入虚拟世界后的活动。'], deepLink: link(AppID.VRWorld, 'manual-vrworld-root') },
  '岁时记': { appId: AppID.Almanac, path: ['桌面', '岁时记'], details: ['打开时间相册首页；从拍立得入口进入共享月历、时光契约、典藏馆、喜事和特别时光。'], deepLink: link(AppID.Almanac, 'manual-almanac-root') },
  '健康': { appId: AppID.Health, path: ['桌面', '健康'], details: ['记录最近经期、设置提前提醒和公开 / 私密模式；提醒预测不是医疗诊断。'], deepLink: link(AppID.Health, 'manual-health-root') },
  '饭票': { appId: AppID.Takeout, path: ['桌面', '饭票'], details: ['点外卖、查看小票、配送和收货。'], deepLink: link(AppID.Takeout, 'manual-takeout-root') },
  '循迹': { appId: AppID.Xunji, path: ['桌面', '循迹'], details: ['生成和查看角色 Screenlife、报备和聊天联动。'], deepLink: link(AppID.Xunji, 'manual-xunji-root') },
  '心意铺': { appId: AppID.Shop, path: ['桌面', '心意铺'], details: ['浏览礼物、购物车、订单和送礼记录。'], deepLink: link(AppID.Shop, 'manual-shop-root') },
  '椒房记': { appId: AppID.Harem, path: ['桌面', '椒房记'], details: ['进入宫廷长线文游。'], deepLink: link(AppID.Harem, 'manual-harem-root') },
  '茶话亭': { appId: AppID.Forum, path: ['桌面', '茶话亭'], details: ['浏览板块、帖子和跟帖。'], deepLink: link(AppID.Forum, 'manual-forum-root') },
  '推特': { appId: AppID.Twitter, path: ['桌面', '推特'], details: ['浏览时间线、搜索、通知、私信和我的账号。'], deepLink: link(AppID.Twitter, 'manual-twitter-root') },
  '桌宠': { appId: AppID.DesktopPet, path: ['桌面', '桌宠'], details: ['对话、喂食、提醒和放到桌面悬浮。'], deepLink: link(AppID.DesktopPet, 'manual-pet-root') },
  '自由活动': { appId: AppID.XhsFreeRoam, path: ['桌面', '自由活动'], details: ['让角色自主刷小红书风格内容。'], deepLink: link(AppID.XhsFreeRoam, 'manual-xhs-free-root') },
  '拾光图库': { appId: AppID.XhsStock, path: ['桌面', '拾光图库'], details: ['整理发帖图片素材。'], deepLink: link(AppID.XhsStock, 'manual-xhs-stock-root') },
  '回声亭': { appId: AppID.Phone, path: ['Dock / 桌面', '回声亭'], details: ['拨号、通话记录、录音和逐字稿。'], deepLink: link(AppID.Phone, 'manual-phone-root') },
  '街角': { appId: AppID.LifeSim, path: ['桌面', '街角'], details: ['进入小镇生活、约会和关系页。'], deepLink: link(AppID.LifeSim, 'manual-lifesim-root') },
};

export const flattenManualSettings = () =>
  MANUAL_ENTRIES.flatMap(entry =>
    (entry.settingSections || []).flatMap(section =>
      section.settings.map(setting => ({ entry, section, setting })),
    ),
  );
