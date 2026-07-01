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

export interface ManualQuestion {
  title: string;
  answer: string;
}

export interface ManualEntry {
  app: string;
  en: string;
  category: ManualCategory;
  summary: string;
  features: string[];
  beginnerSteps?: string[];
  commonQuestions?: ManualQuestion[];
  tips?: string[];
  settingSections?: ManualSettingSection[];
  nativeOnly?: boolean;
  devOnly?: boolean;
}

export interface ManualDestination {
  appId: AppID;
  path: string[];
  details: string[];
  jumpText?: string;
  deepLink?: ManualDeepLinkTarget;
}

export type ManualUpdateNoticeKind = 'feature' | 'fix' | 'improvement' | 'notice';

export interface ManualUpdateNotice {
  id: string;
  date: string;
  title: string;
  kind: ManualUpdateNoticeKind;
  summary: string;
  items: string[];
}

export const CATEGORY_ORDER: Array<'all' | ManualCategory> = ['all', 'daily', 'social', 'creation', 'roleplay', 'system'];

export const MANUAL_UPDATE_NOTICES: ManualUpdateNotice[] = [
  {
    id: '2026-07-01-zzzzzzzzzz-appearance-bubble-save-fix',
    date: '2026-07-01',
    title: '修复拼贴册气泡保存后不生效',
    kind: 'fix',
    summary: '气泡裁剪台点「贴好 · 应用」后，现在会真正应用到当前聊天角色；拼贴册里的极简气泡选项也补齐了。',
    items: [
      '修复了气泡裁剪台只保存主题、没有把主题绑定到当前角色的问题；保存后回到聊天即可看到新气泡。',
      '保存过程会等主题和角色设置都写入完成，连点保存时也会显示「正在贴…」，避免旧样式抢回去。',
      '「拼贴册 → 对话页 → 消息气泡」补上「极简」选项，和聊天页默认的浅灰无描边气泡保持一致。',
    ],
  },
  {
    id: '2026-07-01-zzzzzzzzz-chat-alarm-health-reminders',
    date: '2026-07-01',
    title: '絮语闹钟和健康提醒上线',
    kind: 'feature',
    summary: '絮语单聊可以让角色督促睡觉、叫醒起床或发送自定义提醒；新增「健康」App，可记录经期并按预测日期提醒。',
    items: [
      '絮语单聊底部回形针里新增「闹钟」，支持睡觉督促、起床叫醒和自定义提醒，可按星期重复，提醒到点后会写入角色聊天并生成可转文字的语音提醒。',
      '新增「健康」App，经期提醒支持最近开始日、周期长度、经期天数、提前 / 当天提醒和提醒时间设置；预测只用于日常记录提醒，不作为医疗判断。',
      '健康提醒可设为私密，只在健康 App 和系统通知里出现；也可选择公开给角色，让指定角色用关心但不系统播报的语气提醒。',
      '浏览器版会联动系统通知，并在授权后显示状态和试发测试提醒；浏览器完全关闭后不承诺常驻响铃，APK 版会使用软件本地提醒。',
    ],
  },
  {
    id: '2026-07-01-zzzzzzzz-default-stickers-local',
    date: '2026-07-01',
    title: '默认表情包改成本地图片',
    kind: 'fix',
    summary: '絮语默认表情包已经随 App 一起放进本地，不再依赖外部图片链接，国内网络下也更不容易出现空白或加载失败。',
    items: [
      '默认表情包的 140 张图片已改为本地资源，发送和查看表情时不用再访问外部图床。',
      '仓库里的图片按“编号 + 表情名”重新命名，例如 001_猫不想努力了.jpg，翻文件夹时更容易认图。',
      '旧聊天记录或旧备份里保存的原外链会自动转到本地图片，不需要重新导入，也不用手动一个个替换。',
    ],
  },
  {
    id: '2026-07-01-zzzzzzz-theater-extra-quiz-comments-fix',
    date: '2026-07-01',
    title: '修复番外问卷用户回复后角色不接话',
    kind: 'fix',
    summary: '折子戏「番外问卷」里，提交你的答案或继续评论本题后，角色现在会稳定留在当前题评论区接话。',
    items: [
      '提交用户答案后，会先进入本题评论区，角色自动点评，不会因为没有点“下一题”就停住。',
      '继续评论角色答案时，角色会围绕当前题、双方答案和最近评论继续回应，题号不会自动推进。',
      '如果某次评论生成失败，评论区会显示一条可见提示，并保留“让 TA 再说一句”的重试入口。',
    ],
  },
  {
    id: '2026-07-01-zzzzzz-music-listen-together-cache',
    date: '2026-07-01',
    title: '未来音乐一起听不会退出就清空了',
    kind: 'fix',
    summary: '未来音乐的一起听界面现在会保留本次聊天，角色主动暂停、继续、换歌或跳到下一首时，也会有明确提示。',
    items: [
      '入口在「未来音乐 → 播放页 → 分享给 TA · 一起听」；返回播放页或关闭音乐 App 后，再进一起听会接回刚才的讨论。',
      '点一起听页右上角「结束」或从迷你播放器移除伴听角色时，会清理这次一起听缓存；切歌后重新分享会从新会话开始。',
      '角色自主换歌、暂停、继续播放或跳到下一首时，会弹出应用内提示；如果已允许系统通知，也会收到本地通知。',
      '一起听讨论只保存在本机缓存里，不会写进主聊天上下文；聊天记录里仍只保留你分享音乐时的那张音乐卡。',
    ],
  },
  {
    id: '2026-07-01-zzzzz-chat-freeform-typing-habit',
    date: '2026-07-01',
    title: '絮语单聊新增“按人设随意”打字习惯',
    kind: 'feature',
    summary: '角色聊天设置里的「TA 打字的习惯」新增一档更自然的模式：不固定短句或长段，让 TA 根据人设和当下情绪自己决定回复长短。',
    items: [
      '入口在「絮语 → 进入某个角色单聊 → 右上角 ··· → 聊天设置 → 说话的样子 → TA 打字的习惯」。',
      '新增「按人设随意」：TA 可以只回几个字，也可以认真说一大段；可以一条发完，也可以自然拆成几条。',
      '这一档不会强制 TA 变短或变长，主要看角色性格、关系、心情和当前话题，适合想要更随性、更贴人设的聊天节奏。',
    ],
  },
  {
    id: '2026-07-01-zzzzz-xunji-moro-avatar-fix',
    date: '2026-07-01',
    title: '修复循迹里的 Moro 头像显示',
    kind: 'fix',
    summary: '循迹首页的角色卡现在能正确显示 Moro 的本地头像，不会再把头像路径碎片挤进头像框里。',
    items: [
      '修复了 Moro 默认头像这类本地图片路径在循迹里没有被识别成图片的问题。',
      '如果头像资源临时加载失败，循迹会自动显示占位图标，不再出现破图或路径文字。',
      '这个修复只影响循迹里的头像展示，不会改动角色资料、聊天头像或你的存档内容。',
    ],
  },
  {
    id: '2026-07-01-zzzzzzzzzzz-almanac-polaroid-refresh',
    date: '2026-07-01',
    title: '岁时记换成时间相册风',
    kind: 'improvement',
    summary: '岁时记首页和共享月历重新排版成 Ins / 拍立得风格，入口更像一卷时间相册，也清掉了典藏馆和喜事页里突兀的胶带装饰。',
    items: [
      '首页现在用当月日历和拍立得卡片进入「这个月、时光契约、典藏馆、喜事、特别时光」，不用在旧纸片列表里找入口。',
      '「这个月」共享月历改成白色相纸卡片：点日期贴便签，右上角魔杖仍可请角色往未来日期记一笔。',
      '典藏馆和喜事页标题、卡片上方的胶带装饰已移除，页面更干净，文字不会再被胶带挡住。',
    ],
  },
  {
    id: '2026-07-01-zz-study-language-pro',
    date: '2026-07-01',
    title: '自习室新增语言学习和专业级辅导',
    kind: 'feature',
    summary: '自习室现在多了「语言学习」分区，可以让角色带你学日语、韩语、意大利语等语言，也支持专业级商务、学术、翻译和行业术语训练。',
    items: [
      '入口在「自习室 → 语言学习」：可以直接生成学习路线，也可以导入 PDF 教材整理成语言课。',
      '新建语言课时可选择目标语言、讲解语言、水平和目标；预置日语、韩语、意大利语、英语、法语、西班牙语、德语，也能填自定义语言。',
      '课程会围绕词汇、语法、短句、情景对话、常见错误和综合练习展开，角色会保持人设来讲解、纠错和答疑。',
      '专业级适合商务职场、学术写作、专业翻译和行业术语，会重点训练语域、正式表达、翻译取舍和表达润色。',
      '随堂测和练习册也支持语言课；做完后可回看分数、错题解析，并继续追问不懂的表达。',
    ],
  },
  {
    id: '2026-07-01-appearance-css-prompt-library',
    date: '2026-07-01',
    title: '拼贴册 CSS 提示词库整理好了',
    kind: 'improvement',
    summary: '拼贴册现在把桌面、对话页、App 分区、气泡裁剪台等 CSS 入口分清楚，并给普通用户准备了可直接复制给 AI 的提示词。',
    items: [
      '对话页现在直接内置「聊天白框 · 手写码」，顶栏、输入栏和功能面板的 CSS 不用再跳去手写码页；气泡本体仍在「气泡裁剪台 → 手写码」里改。',
      '桌面页、锁屏、灵动岛、悬浮菜单、小组件和 App 分区都加了对应提示词，可选完整定制、局部微调、风格扩写或修坏修复。',
      '气泡裁剪台新增气泡专用提示词，只会引导 AI 使用 .moro-bubble-user / .moro-bubble-ai，避免生成裁剪台不接受的越界 CSS。',
      '修复了拼贴册顶部页签横滑不明显、点「存档册」后界面横向偏移的问题；页签两侧现在也能用箭头翻动。',
    ],
  },
  {
    id: '2026-07-01-zz-group-opening-greetings',
    date: '2026-07-01',
    title: '群聊可以自定义多组开场白',
    kind: 'feature',
    summary: '絮语群聊设置新增「开场白」，空白群聊开始前可以先选一组开场，让成员按你写好的第一幕自然接话。',
    items: [
      '入口在「絮语 → 群聊 → 右上角齿轮 → 03 开场白」，可以新增、编辑、删除多组群聊开场白。',
      '每组开场白支持多行内容；写成「成员名：内容」时，会按指定成员发出开场消息。',
      '新群聊还没有消息时，可以左右切换开场白，点“以这组开场开始”或直接发送第一句都会先把当前开场落进聊天记录。',
    ],
  },
  {
    id: '2026-07-01-chat-hide-connected-social-npc',
    date: '2026-07-01',
    title: '社交圈已接入 NPC 可以单独决定是否隐藏',
    kind: 'feature',
    summary: '絮语右上角加号菜单新增「隐藏已接入 NPC 与群」开关，可以决定关闭用户社交圈时，已经转成正式角色或群聊的社交圈联系人要不要继续留在往来。',
    items: [
      '入口在「絮语 → 右上角 + → 隐藏已接入 NPC 与群」。',
      '开启时：关闭「用户社交圈」会一并收起已经接入成正式角色或群聊的社交圈 NPC。',
      '关闭时：关闭「用户社交圈」只会隐藏新的背景联系人，已经接入的 NPC / 群聊仍保留在往来里。',
      '这个开关只影响列表显示，不会删除角色、群聊或聊天记录。',
    ],
  },
  {
    id: '2026-07-01-group-individual-api-model-picker',
    date: '2026-07-01',
    title: '群聊角色各自回复可单独选模型',
    kind: 'improvement',
    summary: '群聊“角色各自回复”里的本群默认 API 和成员单独 API，现在可以直接拉取模型列表、选择模型并手动保存。',
    items: [
      '入口在「絮语 → 群聊 → 右上角齿轮 → 06 背景与记忆 → 角色怎么接话」。',
      '本群默认 API 和每位成员的单独 API 都新增“拉取模型”“选择”“保存 API”，不用再完全手打模型名。',
      '如果服务商不支持模型列表，也可以继续手动输入模型名；成员专属 API 仍优先于本群默认 API，本群默认再回退文具盒主 API。',
    ],
  },
  {
    id: '2026-07-01-z-detailed-settings-guide',
    date: '2026-07-01',
    title: '说明书补全详细设置写法',
    kind: 'improvement',
    summary: '剪影集、剪报夹、活字盘和补丁铺新增字段级说明，告诉新手每个按钮、输入框和高级选项到底会影响什么。',
    items: [
      '用户身份补充“设为默认、绑定角色、复制、删除、身份描述、拍一拍、注入方式、世界书绑定”等字段说明。',
      '世界书补充“怎么写条目、常驻和关键词怎么选、主关键词 / 二级词 / 扫描深度怎么填、@Depth 什么时候用”。',
      '预设和正则补充“提示词怎么写、marker 是什么、采样参数怎么调、查找正则 / 替换内容 / 仅显示层 / 仅提示词怎么理解”。',
    ],
  },
  {
    id: '2026-07-01-unlock-update-popup',
    date: '2026-07-01',
    title: '更新公告会在解锁后提醒一次',
    kind: 'improvement',
    summary: '以后每次有新的更新公告，解锁进入 Moro 后会弹出一次提醒，关掉后同一条公告不再重复打扰。',
    items: [
      '新公告会在解锁屏幕后以系统内弹窗展示，方便第一时间看到新增功能、修复和重要入口变化。',
      '点“知道了”或“查看公告”都会把这条公告标记为已读，同一版本只弹一次。',
      '想回看过往内容，可随时从说明书右上角进入更新公告页。',
    ],
  },
  {
    id: '2026-07-01-manual-writing-and-errors',
    date: '2026-07-01',
    title: '说明书新增角色创作与报错排查指南',
    kind: 'improvement',
    summary: '剪影集和文具盒补充了更适合新手阅读的教程，遇到不会写角色卡、不会填用户设定、模型一直报错时，可以直接按说明排查。',
    items: [
      '剪影集新增“从零创作角色卡和用户设定”，用简单清单说明角色卡该写什么、用户身份该怎么填。',
      '文具盒新增“模型报错合集与解决”，按常见报错提示整理原因和处理方法。',
      '说明文字尽量使用日常说法，避免把开发名词丢给第一次使用 Moro 的用户。',
    ],
  },
  {
    id: '2026-07-01-manual-update-notices',
    date: '2026-07-01',
    title: '说明书新增更新公告入口',
    kind: 'feature',
    summary: '说明书右上角新增更新公告页，以后新增功能、修复 bug 或调整重要入口时，会同步写进这里。',
    items: [
      '点击说明书右上角公告按钮，即可查看最新公告和过往更新记录。',
      '公告按日期倒序展示，第一条会作为“最新”突出显示。',
      '公告文案面向普通用户，只写功能变化、入口和注意事项，不展示开发维护步骤。',
    ],
  },
];

export const getManualUpdateNotices = () =>
  [...MANUAL_UPDATE_NOTICES].sort((a, b) => {
    const byDate = Date.parse(b.date) - Date.parse(a.date);
    return byDate || b.id.localeCompare(a.id);
  });

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
      '右上角更新公告可查看本次和过往变化；有新公告时，解锁进入 Moro 后会弹出一次提醒。',
    ],
    beginnerSteps: [
      '刚装好 Moro 时，先看「文具盒」配置主 API，再看「剪影集」创建角色，最后回「絮语」开始聊天。',
      '想知道某个按钮在哪，直接搜按钮名或用途，例如“副 API”“主动消息”“送礼”“备份”。',
      '如果跳转后没有看到高亮位置，通常是该 App 还在加载或当前没有合适对象，按页面提示先选角色 / 群 / 存档即可。',
    ],
    commonQuestions: [
      {
        title: '说明书会自动帮我改设置吗？',
        answer: '不会。说明书只解释和跳转，所有开关、导入、删除、清空都要你在对应 App 里亲手点。',
      },
      {
        title: '为什么有些说明说“手机安装版”？',
        answer: '同一个 Moro 可以跑在浏览器、PWA 或手机安装包里。通知、更新、后台保活这类能力会受运行环境限制。',
      },
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
      '右上角加号菜单里可以开关用户社交圈，也可以把已经接入为正式角色或群聊的社交圈 NPC 从往来和名册里收起。',
      '关系网整理你与角色、角色与角色之间的关系和后台私聊互动。',
    ],
    beginnerSteps: [
      '第一次聊天前，先去「剪影集 → 登场人物」创建或导入角色。',
      '回到絮语后，底栏「名册」点角色即可开单聊；想多人互动就从名册或聊天页新建群聊。',
      '聊得久了再打开单聊设置，慢慢调整记忆条数、主动能力、世界书、语音和外观。',
    ],
    commonQuestions: [
      {
        title: '为什么角色不回复或回复失败？',
        answer: '先检查文具盒里的主 API 是否填完整、模型名是否可用、余额或网络是否正常。副 API 只管后台任务，聊天核心还是主 API。',
      },
      {
        title: '单聊和群聊的记忆会互通吗？',
        answer: '默认各自有聊天记录；单聊设置里可以选择是否带入 TA 所在群聊的近况，群归档也能把群经历分发给成员。',
      },
      {
        title: '此刻和见闻簿有什么区别？',
        answer: '此刻是熟人圈动态，偏你和角色的小圈子；见闻簿是小红书式公开信息流，路人、熟人和素材发帖更多。',
      },
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
    summary: '单聊底部回形针和通话按钮里的常用互动工具。这里放语音、图片、转账、红包、送礼、饭票、见面、查岗、闹钟和求婚等“两个人之间的小事”。',
    features: [
      '聊天输入栏可发文字、图片、录音语音条和表情包；AI 语音条需要先给角色配置声音和 MiniMax。',
      '回形针里的转账、红包、礼物、饭票、求婚会生成可点开的聊天卡片，角色会围绕卡片回应。',
      '见面会进入线下面对面小窗，先选择这场见面怎么开始，再用“说话”和“动作”推进现场。',
      '查岗会生成 TA 手机里的外卖、社交、备忘录、日程等 Screenlife 记录；用于看角色生活，不是系统真实监控。',
      '闹钟可给当前角色设置睡觉督促、起床叫醒或自定义提醒，到点后按设置生成通知、语音提醒或来电。',
    ],
    beginnerSteps: [
      '先在絮语点进一个角色单聊，确认主 API 已经能正常回复。',
      '想发功能卡片时点输入栏旁的回形针；想直接通话时点顶栏电话或视频按钮。',
      '如果某个工具提示缺少配置，先去文具盒补 API / 通知 / MiniMax，或去剪影集补角色声音和资料。',
    ],
    commonQuestions: [
      {
        title: '为什么语音条或电话没有声音？',
        answer: '需要在文具盒配置 MiniMax Key / Group ID，并在剪影集或聊天设置里给角色选择音色；没有声音时系统会尽量保留文字回复。',
      },
      {
        title: '外卖、礼物、转账会真的扣钱吗？',
        answer: '它们只使用 Moro 内的虚拟余额和本地订单，不会调用真实支付。饭票里的真实店铺彩蛋也只是角色城市生活感的一部分。',
      },
      {
        title: '闹钟为什么后台不一定响？',
        answer: '网页端依赖浏览器和系统权限，浏览器完全关闭后不承诺常驻；手机安装版会尽量使用本地通知排程。',
      },
    ],
    tips: ['入口在单聊输入栏旁的回形针，不在右上角聊天设置里。新增或修改闹钟后，手机安装版会自动刷新未来一段时间的提醒排程。'],
    settingSections: [
      {
        id: 'private-chat-tools',
        title: '回形针工具',
        settings: [
          {
            id: 'chat-voice-image',
            title: '图片、语音条和表情',
            description: '输入栏可发图片、录音语音条和表情包；角色回复自动语音要在聊天设置中开启“用语音条回你”。',
            defaultBehavior: '文字聊天不需要额外配置；AI 语音条需要 MiniMax 和角色音色。',
            path: ['单聊', '输入栏', '图片 / 语音 / 表情'],
            deepLink: chatSettingsLink('manual-chat-photo-assets'),
          },
          {
            id: 'chat-money-cards',
            title: '转账与红包',
            description: '给角色发转账或红包，也能收下角色发来的转账 / 红包；口令红包需要答对口令才领取。',
            defaultBehavior: '使用 Moro 虚拟余额，不涉及真实支付。',
            options: [
              { label: '转账', description: '明确金额和备注，适合普通给钱或剧情转款。' },
              { label: '普通红包', description: '发一个带祝福的红包卡片。' },
              { label: '口令红包', description: '设置口令，TA 要答对才能领。' },
            ],
            path: ['絮语', '点角色单聊', '底部回形针', '转账 / 红包'],
            deepLink: chatSettingsLink('manual-chat-settings-root'),
          },
          {
            id: 'chat-gift-shop',
            title: '送礼与心意铺',
            description: '从单聊里送礼会生成礼物卡；想慢慢挑礼物、看购物车和订单，可去「心意铺」。',
            defaultBehavior: '礼物会落到聊天，角色可回应、感谢或在之后提起。',
            path: ['单聊', '底部回形针', '送礼'],
            deepLink: link(AppID.Shop, 'manual-shop-root'),
          },
          {
            id: 'chat-takeout-tool',
            title: '饭票 / 点外卖',
            description: '从聊天里给自己或角色点一单，生成能查看进度的小票；配送和收货会继续联动聊天。',
            defaultBehavior: '手动点外卖不需要打开角色主动外卖开关；主动点外卖另在单聊设置里控制。',
            path: ['单聊', '底部回形针', '饭票'],
            deepLink: link(AppID.Takeout, 'manual-takeout-root'),
          },
          {
            id: 'chat-offline-meet',
            title: '见面',
            description: '进入线下面对面模式，先选靠近、造访、偶遇、赴约或自定义开场，再用话语和动作推进场景。',
            defaultBehavior: '手动点「见面」会立即进入；自动见面需要在单聊设置中单独开启。',
            path: ['单聊', '底部回形针', '见面'],
            deepLink: chatSettingsLink('manual-chat-auto-meet'),
          },
          {
            id: 'chat-check-phone-tool',
            title: '查岗',
            description: '查看当前角色手机里的模拟生活记录，例如备忘录、外卖、社交、日程或聊天痕迹。',
            defaultBehavior: '这是本地 AI 生成的角色 Screenlife，不是读取现实手机。',
            path: ['单聊', '底部回形针', '查岗'],
            deepLink: chatSettingsLink('manual-chat-check-phone'),
          },
          {
            id: 'chat-call-tools',
            title: '语音 / 视频通话',
            description: '语音电话使用角色声音和通话文本；视频通话使用角色通话立绘，你可以选择开关麦克风和摄像头。',
            defaultBehavior: '语音合成失败时会保留文字；视频通话结束后会保存通话记录。',
            path: ['单聊', '顶栏电话 / 视频按钮'],
            deepLink: link(AppID.Phone, 'manual-phone-root'),
          },
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
          {
            id: 'chat-proposal',
            title: '求婚',
            description: '从聊天里送出求婚卡片，或回应角色发来的求婚卡。答应后会进入关系与岁时记的喜事相关内容。',
            defaultBehavior: '求婚会被写入聊天和关系状态；拒绝或再想想也会留下剧情结果。',
            path: ['单聊', '底部回形针', '求婚'],
            deepLink: chatSettingsLink('manual-chat-settings-root'),
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
    beginnerSteps: [
      '刚开始只需要确认“随身记忆”和“TA 的城市”，其他开关可以先保持默认。',
      '如果回复不像 TA，优先检查角色档案、人设、世界书和“TA 打字的习惯”，不要一次打开太多主动能力。',
      '如果聊天变慢或报上下文过长，先降低随身记忆条数，再把重要内容送进回忆标本馆。',
    ],
    commonQuestions: [
      {
        title: '这些设置是全局的吗？',
        answer: '大多数是当前角色 / 当前会话独立设置。全局聊天皮肤在拼贴册，主 API 和副 API 在文具盒。',
      },
      {
        title: '主动消息、主动外卖、自动见面要不要全开？',
        answer: '新手不建议一口气全开。先开一个你最想体验的能力，观察角色表现，再逐步增加。',
      },
      {
        title: '清空上下文和清空聊天记录有什么区别？',
        answer: '清空上下文偏“让模型暂时少带旧消息”；清空本会话记录会删除可回看的聊天内容，操作前建议先导出或备份。',
      },
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
      '开场白：给空白群聊准备多组自定义开场，可切换选择后再正式开始。',
      '角色接话：可开启角色各自回复或自动接话，控制群友继续聊几轮；各自回复时可给本群或单个成员单独设置 API，并拉取 / 选择模型后保存。',
      '群归档：把群聊总结成记忆，分发给群成员。',
    ],
    beginnerSteps: [
      '先从絮语新建群，加入两位以上角色，再进入群聊右上角齿轮。',
      '刚开始保持默认接话方式即可；群友太吵时再调“自动接话轮数”或禁言。',
      '长剧情群聊建议定期做群归档，让成员以后能记得群里发生过的大事。',
    ],
    commonQuestions: [
      {
        title: '群聊为什么一轮只有少数人说话？',
        answer: '群聊会按接话方式、成员状态和上下文预算决定谁该说话。想让更多人参与，可开启角色各自回复或提高接话轮数。',
      },
      {
        title: '群聊专属 API 有必要吗？',
        answer: '不是必需。只有当你想让多人并发回复走不同模型，或把群聊成本和单聊分开时，再配置群聊专属 API。',
      },
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
            id: 'group-opening-greetings',
            title: '群聊开场白',
            description: '可添加多组开场白；新聊天为空时会先显示选择器，左右切换后点“以这组开场开始”，直接发第一句也会采用当前开场。',
            defaultBehavior: '每组开场可写多行，用“成员名：内容”指定谁先说；不写成员名前缀时由第一位群成员发出。',
            path: ['絮语', '群聊', '右上角齿轮', '03 开场白'],
            deepLink: chatHubLink('manual-chathub-group-settings', 'group-settings'),
          },
          {
            id: 'group-individual-api',
            title: '群聊专属 API',
            description: '开启“角色各自回复”后，可以给本群设置默认 API，也可以给某个群成员单独填写 Base URL、API Key；模型名可手动输入，也可从当前 API 拉取列表后选择并保存。',
            defaultBehavior: '成员专属 API 优先；没填完整时回退本群默认 API；本群默认也没填完整时回退文具盒主 API。',
            path: ['絮语', '群聊', '右上角齿轮', '07 背景与记忆', '角色怎么接话'],
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
      '提供角色卡创作说明：从姓名、核心设定、性格、说话方式、关系和开场白开始，不会写也能照着填。',
      '角色档案可管理长期关系、记忆、备注、表情、相册、声音、见面立绘等资料。',
      '用户身份页可管理多套身份：名字、头像、自述、默认身份和角色 / 群聊绑定。',
      '用户身份详细说明会解释每个按钮和字段：设为默认、绑定角色、复制、删除、身份描述、拍一拍后缀、注入方式和绑定世界书。',
      '用户设定说明会告诉你哪些内容该写、哪些内容不用写太长，避免角色称呼和关系混乱。',
      '可给人设绑定世界书分组，让对应身份自带额外设定。',
    ],
    beginnerSteps: [
      '先别追求写得很长：给角色填头像、名字、一句话核心、性格和开场白，能开聊就是第一版完成。',
      '再去「用户身份」填你的名字、希望被怎样称呼、你和角色是什么关系；有多个马甲时再建多套身份。',
      '试聊几轮后，如果角色称呼错、关系错、语气不像，再回来补“说话方式”“关系边界”和“不能做的事”。',
      '世界观、组织、地名、长背景太多时，不要全塞进角色卡，放进剪报夹世界书会更好管理。',
    ],
    commonQuestions: [
      {
        title: '角色卡导入后为什么名字或设定不完全一样？',
        answer: '导入时会把它当成一个新的本地角色保存，不会覆盖你已有的角色。不同软件的角色卡格式不完全一样，导入后发现少了某段设定，可以进编辑页手动补上。',
      },
      {
        title: '用户身份和角色人设有什么区别？',
        answer: '角色人设描述“TA 是谁”，用户身份描述“你是谁”。模型会同时参考两者，所以你的身份写清楚会让称呼、关系和互动更稳定。',
      },
      {
        title: '角色卡越长越好吗？',
        answer: '不是。新手更适合写“短但清楚”的角色卡：核心性格、说话习惯、和你的关系最重要。很长的世界观、剧情年表、组织设定建议放进剪报夹世界书。',
      },
      {
        title: '为什么角色总是跑偏？',
        answer: '先检查四处：角色卡有没有写清楚，用户身份有没有冲突，世界书有没有互相打架，聊天预设有没有太强的额外要求。一次只改一处，比较容易找到原因。',
      },
      {
        title: '用户设定会不会所有角色都看到？',
        answer: '默认身份会给大多数聊天使用；如果你给某个角色或群聊绑定了专属身份，那里会优先使用绑定身份。想换称呼或关系时，先看绑定是不是选错了。',
      },
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
      {
        id: 'persona-creation-guide',
        title: '从零创作角色卡和用户设定',
        description: '第一次写不用像写小说。先按小清单填，能聊起来后再慢慢加细节。',
        settings: [
          {
            id: 'persona-card-basics',
            title: '角色卡最小可用结构',
            description: '一张能正常聊天的角色卡，先写清楚“TA 是谁、怎么说话、和你什么关系、第一句说什么”。这些内容比堆很多形容词更有用。',
            defaultBehavior: '短版也能用；聊一阵觉得哪里不稳，再回到剪影集补。',
            options: [
              { label: '名字和头像', description: '让你在列表里一眼认出角色，也方便聊天里正确称呼。' },
              { label: '一句话核心', description: '用一句话说清楚 TA 是什么人，例如“温柔但嘴硬的同居恋人”或“认真负责的异世界向导”。' },
              { label: '性格与说话方式', description: '写 TA 平时怎么表达：直白、慢热、爱吐槽、正式、黏人、克制，都可以写。' },
              { label: '和你的关系', description: '写清你们是朋友、恋人、同事、师生、陌生人，关系越清楚越不容易乱叫。' },
              { label: '边界与雷区', description: '写 TA 不该做什么、不该突然变成什么样，能减少跑偏。' },
              { label: '开场白', description: '写第一句对话，让角色从正确的场景和语气开始。' },
            ],
            path: ['剪影集', '登场人物', '新建 / 编辑角色'],
            deepLink: link(AppID.Personas, 'manual-personas-characters', 'section:char', { section: 'char' }),
          },
          {
            id: 'persona-card-template',
            title: '角色卡写作模板',
            description: '不知道怎么下笔时，可以照着这 6 句话写。每句一两行就够，后面再慢慢补。',
            options: [
              { label: '1. TA 是谁', description: '姓名、年龄感、身份、所在世界或职业，用普通话讲清楚。' },
              { label: '2. TA 想要什么', description: '写一个长期目标或当下心愿，角色会更有主动性。' },
              { label: '3. TA 怎么说话', description: '写语气、口头禅、称呼习惯、会不会用表情或颜文字。' },
              { label: '4. TA 和你什么关系', description: '写清亲近程度、过去发生过什么、现在相处状态。' },
              { label: '5. TA 不能做什么', description: '写不能突然崩人设、不能替你决定、不能说破某个秘密等边界。' },
              { label: '6. 第一幕怎么开始', description: '用开场白给出地点、时间、氛围和第一句台词。' },
            ],
            path: ['剪影集', '登场人物', '新建 / 编辑角色', '人设 / 开场白'],
            deepLink: link(AppID.Personas, 'manual-personas-characters', 'section:char', { section: 'char' }),
          },
          {
            id: 'persona-card-import-export',
            title: '导入 / 导出角色卡',
            description: '导入适合把外部角色带进 Moro；导出适合备份或分享单个角色。导入后会变成新的本地角色，不会直接覆盖原角色。',
            defaultBehavior: '单张角色卡导出主要保存角色内容；完整备份才更适合整机迁移。',
            options: [
              { label: '导入前', description: '先确认来源可信，再检查头像、名字、人设、开场白有没有被识别。' },
              { label: '导入后', description: '建议立刻试聊几句，发现称呼、关系、语气不对就回编辑页补。' },
              { label: '分享前', description: '检查角色卡里有没有你不想公开的私密信息。' },
            ],
            path: ['剪影集', '登场人物', '导入 / 导出'],
            deepLink: link(AppID.Personas, 'manual-personas-characters', 'section:char', { section: 'char' }),
          },
          {
            id: 'persona-user-profile-guide',
            title: '用户设定怎么写',
            description: '用户设定写的是“你在聊天里是谁”。它不是个人简历，不需要把真实生活全写进去，只要帮助角色正确称呼你、理解你们的关系。',
            defaultBehavior: '没有绑定专属身份时，Moro 会优先使用默认身份。',
            options: [
              { label: '名字 / 称呼', description: '写你想被角色怎么叫，例如昵称、代称、称谓。' },
              { label: '你和角色的关系', description: '写“我是 TA 的恋人 / 朋友 / 搭档 / 客人”等，关系不要和角色卡打架。' },
              { label: '你的说话风格', description: '如果你希望角色理解你比较慢热、爱开玩笑、喜欢简短回复，可以写在这里。' },
              { label: '不要写太满', description: '真实隐私、长篇经历、和当前角色无关的设定，不必全放进默认身份。' },
            ],
            path: ['剪影集', '用户身份', '新建 / 编辑身份'],
            deepLink: link(AppID.Personas, 'manual-personas-user', 'section:user', { section: 'user' }),
          },
          {
            id: 'persona-user-field-name-note',
            title: '身份名称、头像和内部备注',
            description: '身份名称和头像会影响聊天里“你是谁”；内部备注只给你自己在列表里识别，不会发送给 AI。',
            options: [
              { label: '上传头像', description: '给这套身份换头像。启用身份后，聊天气泡、群聊和相关显示会优先使用它。' },
              { label: '身份名称 / NAME', description: '就是角色看到的你的名字。想让角色叫你“小眠”“老板”“姐姐”，这里要写清楚。' },
              { label: '内部备注 / NOTE', description: '只用于列表识别，比如“现代恋人线”“跑团马甲”。这格不会发给 AI，所以不要把必须让角色知道的设定只写在这里。' },
            ],
            path: ['剪影集', '用户身份', '当前身份资料', '身份名称 / 内部备注'],
            deepLink: link(AppID.Personas, 'manual-personas-user', 'section:user', { section: 'user' }),
          },
          {
            id: 'persona-user-actions',
            title: '设为默认、绑定角色、复制、删除',
            description: '这排按钮决定这套身份什么时候被使用，以及是否要复制或移除。新手最常用的是“设为默认”和“绑定角色”。',
            options: [
              { label: '设为默认', description: '没有专属绑定时，聊天会自动使用这套身份。适合最常用的名字和自我介绍。' },
              { label: '绑定角色', description: '勾选某个角色后，进入 TA 的聊天会自动切到这套身份。一个角色同一时间只会绑定一套身份。' },
              { label: '复制', description: '复制一份内容相同的新身份，适合在原身份基础上改一个分支。角色绑定不会一起复制，避免同一个角色被多套身份抢。' },
              { label: '删除', description: '删除这套身份记录，不能撤销。若它正在启用，删除不会自动清空当前用户档案，建议先切到别的身份再删。' },
            ],
            path: ['剪影集', '用户身份', '当前身份资料', '操作按钮'],
            deepLink: link(AppID.Personas, 'manual-personas-user', 'section:user', { section: 'user' }),
          },
          {
            id: 'persona-user-bindings',
            title: '默认身份与角色绑定',
            description: '有多套用户设定时，可以把不同身份绑定给不同角色或群聊。比如同一个你，在恋人面前和在冒险团里可以是不同身份。',
            options: [
              { label: '默认身份', description: '没有特别绑定时使用，适合写最常用的名字和称呼。' },
              { label: '角色绑定', description: '给某个角色专门指定你是谁，适合恋人、亲友、师徒等固定关系。' },
              { label: '群聊绑定', description: '给群聊指定身份，避免多人聊天里称呼和关系混在一起。' },
            ],
            path: ['剪影集', '用户身份', '默认身份 / 角色绑定'],
            deepLink: link(AppID.Personas, 'manual-personas-user', 'section:user', { section: 'user' }),
          },
          {
            id: 'persona-user-description-field',
            title: '身份描述 / ABOUT ME',
            description: '这里会介绍“这套身份下的你”。写给 AI 看，启用后会影响称呼、关系、语气和角色对你的理解。',
            defaultBehavior: '推荐新手选择“放入提示词”，最稳定也最容易排查。',
            options: [
              { label: '建议写什么', description: '写你的称呼、年龄感或身份、和角色的关系、相处方式、说话偏好、不能被误解的边界。' },
              { label: '不建议写什么', description: '不要把真实隐私、大段自传、和当前聊天无关的世界观全塞进去；太长会挤占聊天上下文。' },
              { label: '宏', description: '支持 {{user}} 和 {{char}} 这类占位。新手不会用也没关系，直接写名字最稳。' },
              { label: '≈ TK', description: '大概 token 数。数字越大，发给模型的内容越长；不是越大越好。' },
            ],
            path: ['剪影集', '用户身份', '当前身份资料', '身份描述'],
            deepLink: link(AppID.Personas, 'manual-personas-user', 'section:user', { section: 'user' }),
          },
          {
            id: 'persona-user-pat-suffix',
            title: '拍一拍后缀 / PAT',
            description: '这是别人“拍了拍你”的后半句，例如“脑袋”“肩膀”“头发”。它是互动显示用的小设定，不是长人设。',
            defaultBehavior: '这是全局字段，不按每套身份单独保存。',
            options: [
              { label: '怎么填', description: '填一个短名词或短词组就好，例如“小脑袋”“肩膀”“毛绒帽”。' },
              { label: '会影响哪里', description: '影响拍一拍互动里的显示文案，例如“拍了拍 User 的肩膀”。' },
              { label: '不要写太长', description: '过长会让拍一拍句子很怪，建议 2 到 6 个字。' },
            ],
            path: ['剪影集', '用户身份', '当前身份资料', '拍一拍后缀'],
            deepLink: link(AppID.Personas, 'manual-personas-user', 'section:user', { section: 'user' }),
          },
          {
            id: 'persona-user-delivery',
            title: '描述注入方式 / DELIVERY',
            description: '决定“身份描述”要不要发给 AI，以及发到哪里。看不懂时就选“放入提示词”。',
            defaultBehavior: '默认放入提示词；这是最接近普通用户期待的方式。',
            options: [
              { label: '放入提示词', description: '身份描述会进入核心提示词；启用活字盘预设时，会落在 Persona Description 占位。推荐新手使用。' },
              { label: '插入对话', description: '把身份描述当成一条历史消息插到最近对话附近。只有你很清楚 @Depth 想控制什么时再用。' },
              { label: '不注入', description: '身份描述不发给 AI，名字仍然生效。适合只想换头像 / 昵称，不想让模型看到自述的情况。' },
              { label: '插入深度', description: '只在“插入对话”时出现。0 表示最新消息后，数字越大越靠前。新手不要随便改。' },
              { label: '消息角色', description: '只在“插入对话”时出现。system 像系统说明，user 像你说的话，assistant 像 AI 说过的话。一般不用改。' },
            ],
            path: ['剪影集', '用户身份', '当前身份资料', '描述注入方式'],
            deepLink: link(AppID.Personas, 'manual-personas-user', 'section:user', { section: 'user' }),
          },
          {
            id: 'persona-user-worldbook-binding',
            title: '绑定世界书分组 / WORLD BOOK',
            description: '给这套用户身份额外带一本世界书。启用此身份聊天时，所选分组会按条目设置一起参与注入。',
            defaultBehavior: '默认不绑定。普通身份不需要绑定世界书。',
            options: [
              { label: '适合绑定什么', description: '适合“这套身份专属”的设定，例如你在某条剧情线的家族、职业、秘密、契约。' },
              { label: '不适合绑定什么', description: '所有角色都必须知道的通用世界观，放全局世界书更合适；某个角色专属设定，挂到角色更合适。' },
              { label: '仍然尊重条目规则', description: '绑定分组后，条目开关、整本开关、常驻 / 关键词规则仍然有效，不是整本无脑全塞。' },
            ],
            path: ['剪影集', '用户身份', '当前身份资料', '绑定世界书分组'],
            deepLink: link(AppID.Personas, 'manual-personas-user', 'section:user', { section: 'user' }),
          },
          {
            id: 'persona-card-test-chat',
            title: '写完后怎么检查',
            description: '新角色不需要一次写到完美。开一段短聊天，专门观察称呼、关系、语气、主动性和边界，再回剪影集微调。',
            options: [
              { label: '称呼错', description: '先改用户身份和关系描述，不要只在聊天里反复纠正。' },
              { label: '语气不像', description: '给角色卡补“说话方式”和一两句示例台词。' },
              { label: '设定忘了', description: '重要但很长的背景放进世界书，并确认对应角色已经挂载。' },
            ],
            path: ['剪影集', '登场人物', '编辑角色后试聊'],
            deepLink: link(AppID.Personas, 'manual-personas-characters', 'section:char', { section: 'char' }),
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
      '提供世界书写作说明：哪些内容适合放世界书、条目怎么拆、常驻和关键词怎么选。',
      '支持 ST 式插入位置：角色卡前后和 @Depth 插入聊天历史。',
    ],
    beginnerSteps: [
      '普通聊天不一定需要世界书。只有当角色总忘记某个世界规则、地点、组织或长期设定时，再把它写成条目。',
      '先建局部世界书，挂到对应角色或群聊；确认稳定后，再考虑是否改成全局。',
      '每条内容尽量短而明确，一条只讲一个设定，方便关键词命中和排查。',
      '新手先用“常驻 + 角色卡之后”，等你发现内容太多或只想在特定话题出现，再改成关键词触发。',
    ],
    commonQuestions: [
      {
        title: '为什么世界书没有生效？',
        answer: '检查整本开关、条目开关、作用域、角色 / 群聊挂载和关键词。局部世界书没挂载时不会自动进入所有聊天。',
      },
      {
        title: '全局世界书能不能全开？',
        answer: '可以，但不建议把大量互相无关或冲突的设定全局开启。全局内容会影响所有聊天，越多越容易挤占上下文。',
      },
      {
        title: '世界书和角色卡怎么分工？',
        answer: '角色卡写“这个人是谁”和最核心关系；世界书写“角色可能需要查阅的资料”，例如城市、组织、魔法规则、家族背景、长期剧情线。',
      },
      {
        title: '关键词条目为什么测得会触发，聊天里却没出现？',
        answer: '还要看整本开关、条目开关、全局 / 局部作用域和角色挂载。关键词只是“内容该不该醒来”的条件，不代表它一定对当前聊天可用。',
      },
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
      {
        id: 'worldbook-writing-guide',
        title: '世界书怎么写',
        description: '世界书像一本给 AI 查阅的小资料册。它不需要文笔华丽，更需要短、准、少冲突。',
        settings: [
          {
            id: 'worldbook-what-to-store',
            title: '哪些内容适合放世界书',
            description: '当某段设定不是每一句都要说、但聊到相关话题时必须准确，就适合放进世界书。',
            options: [
              { label: '世界规则', description: '魔法规则、城市制度、组织等级、禁忌、时间线、货币、职业设定。' },
              { label: '长期剧情', description: '已经发生过的大事件、共同秘密、悬而未决的约定、角色之间的隐藏关系。' },
              { label: '地点和组织', description: '店铺、学校、公司、王国、社团、街区，写清位置、气氛和谁常出现。' },
              { label: '不要放什么', description: '一句话能写进角色卡的核心人设、短期聊天情绪、很快会过期的临时闲聊，不必放世界书。' },
            ],
            path: ['剪报夹', '新建世界书 / 新条目', '条目内容'],
            deepLink: link(AppID.Worldbook, 'manual-worldbook-root'),
          },
          {
            id: 'worldbook-entry-template',
            title: '条目写作模板',
            description: '一条只讲一个设定。标题用于你自己管理，正文才会发给 AI。',
            options: [
              { label: '标题', description: '写给自己看的短名字，例如“青梧街”“星环法则”“沈家旧事”。' },
              { label: '正文第一句', description: '先用一句话说结论，例如“青梧街是角色常去的旧街区，夜里摊贩很多”。' },
              { label: '补充细节', description: '再写 2 到 5 条关键事实：谁在这里、有什么规则、角色应该怎么反应。' },
              { label: '避免冲突', description: '不要在不同条目里写相反设定。如果要改剧情，先停用旧条目或把旧条目改掉。' },
            ],
            path: ['剪报夹', '编辑条目', '标题 / 内容'],
            deepLink: link(AppID.Worldbook, 'manual-worldbook-root', 'entry-settings'),
          },
          {
            id: 'worldbook-split-rules',
            title: '怎么拆条目',
            description: '不要把一本设定集塞进一个超长条目。拆开后更容易关键词触发，也更容易排查是哪条影响了角色。',
            options: [
              { label: '按主题拆', description: '地点一条、组织一条、规则一条、人物关系一条。' },
              { label: '按使用频率拆', description: '常常要用的核心规则单独一条，偶尔才用的背景用关键词触发。' },
              { label: '按冲突风险拆', description: '容易改动的剧情线单独放，之后想停用时不会误伤整本世界观。' },
            ],
            path: ['剪报夹', '世界书分组', '新条目'],
            deepLink: link(AppID.Worldbook, 'manual-worldbook-root'),
          },
          {
            id: 'worldbook-activation-guide',
            title: '常驻还是关键词',
            description: '常驻是“只要这本书可用就带上”；关键词是“最近聊天提到相关词才带上”。',
            defaultBehavior: '新手先用常驻；内容多起来后，再把不常用条目改成关键词。',
            options: [
              { label: '常驻', description: '适合必须一直知道的规则，例如角色身份禁忌、世界底层规则、当前主线前提。' },
              { label: '关键词', description: '适合聊到某个地点、组织、人物、物品时才需要出现的资料。' },
              { label: '主关键词', description: '任意命中一个就会触发。写常用叫法、别名、简称，不要只写很冷门的全名。' },
              { label: '二级关键词', description: '开启二级过滤后，需要主关键词和二级关键词都命中。适合避免误触发。' },
              { label: '大小写', description: '中文通常不用开；英文专名大小写必须严格区分时再开。' },
              { label: '扫描深度', description: '表示看最近几条聊天来判断关键词。太小可能漏，太大可能误触发；新手用默认值。' },
              { label: '关键词测试', description: '把几行最近聊天粘进去，看这条会不会触发。测试通过后，还要确认这本书对当前角色可用。' },
            ],
            path: ['剪报夹', '编辑条目', '条目激活方式 / 关键词设置'],
            deepLink: link(AppID.Worldbook, 'manual-worldbook-root', 'entry-settings'),
          },
          {
            id: 'worldbook-scope-guide',
            title: '局部、全局和挂载',
            description: '作用域决定“这本书给谁看”。这和条目常驻 / 关键词不是一回事。',
            options: [
              { label: '局部：需绑定', description: '只在挂到角色、群聊或用户身份后可用。推荐角色专属设定、某条剧情线、某套身份使用。' },
              { label: '全局：所有角色', description: '所有聊天都可用。只适合真正通用、不会和其他世界冲突的内容。' },
              { label: '整本开关', description: '临时停用整本书，内容不删。排查跑偏时很有用。' },
              { label: '条目开关', description: '只停用某一条，适合测试某段设定是否导致角色跑偏。' },
            ],
            path: ['剪报夹', '书架分组', '整本开关 / 全局局部'],
            deepLink: link(AppID.Worldbook, 'manual-worldbook-group-scope', 'group-settings'),
          },
          {
            id: 'worldbook-position-guide',
            title: '插入位置和 @Depth 怎么选',
            description: '插入位置决定设定放在提示词里的哪里。新手保持“角色卡之后”即可。',
            defaultBehavior: '默认角色卡之后，适合绝大多数世界书。',
            options: [
              { label: '角色卡之前', description: '适合最高优先级规则，例如世界底层限制、所有角色必须遵守的安全边界。少用。' },
              { label: '角色卡之后', description: '适合普通补充资料，最稳、最容易理解。' },
              { label: '@Depth system', description: '像系统说明一样插到聊天历史里。只有迁移酒馆高级预设或精细控制时再用。' },
              { label: '@Depth user / assistant', description: '把设定伪装成用户或 AI 历史消息。可能影响角色语气，新手不建议用。' },
              { label: 'Depth 数字', description: '0 靠近最新消息，数字越大越往前。不是优先级大小，别当强度滑杆。' },
              { label: 'Order', description: '同一位置内排序用，数字小的更靠前。平时不用改。' },
            ],
            path: ['剪报夹', '编辑条目', '插入位置 / @Depth'],
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
      '提供预设写作说明：提示词该写什么、marker 是什么、@Depth 什么时候用、采样参数怎么调。',
    ],
    beginnerSteps: [
      '新手可以先不用改活字盘，默认预设已经能聊天。',
      '如果你从 SillyTavern 带来 Chat Completion 预设，可先导入，再检查提示词顺序和 marker 落点。',
      '改采样参数时一次只改一两项，聊几轮确认效果，再继续调。',
      '自己写预设时，先只改“Main Prompt / 主提示词”和“Post-History Instructions / 后置提示”，不要一开始就删 marker。',
    ],
    commonQuestions: [
      {
        title: '预设和文具盒主 API 是一回事吗？',
        answer: '不是。文具盒决定请求发到哪里、用什么模型；活字盘决定发给模型的消息怎么组装、提示词怎么排、采样参数怎么带。',
      },
      {
        title: '导入酒馆预设后为什么效果不同？',
        answer: 'Moro 会把常见 marker 映射到自己的聊天落点，但不同模型、上下文和世界书也会影响效果，导入后建议逐项检查。',
      },
      {
        title: 'marker 可以删除吗？',
        answer: '不建议新手删除。marker 是系统自动填内容的位置，例如聊天历史、用户身份、世界书、角色核心上下文。关掉或删掉可能让角色忘人设、忘历史或看不到世界书。',
      },
      {
        title: '预设写得越强越好吗？',
        answer: '不是。太多强命令会互相打架，也可能压过角色卡。好预设通常目标清楚、语气稳定、保留角色自由发挥空间。',
      },
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
      {
        id: 'preset-writing-guide',
        title: '预设怎么写',
        description: '预设决定“发给模型的消息怎么排、额外规则怎么说”。它很强，所以新手要慢慢改。',
        settings: [
          {
            id: 'preset-what-is-preset',
            title: '预设负责什么',
            description: '文具盒负责连哪个模型；活字盘负责把角色、人设、世界书、聊天历史和额外规则组装成请求。',
            options: [
              { label: '能改变什么', description: '回复风格、叙事方式、输出格式、是否更主动、是否少复读、采样参数。' },
              { label: '不能替代什么', description: '不能替代角色卡和世界书。角色是谁仍然应该写在剪影集，世界规则仍然应该写在剪报夹。' },
              { label: '最小改法', description: '保留默认结构，只添加一条短提示词，比如“回复自然、少用套话、尊重角色卡”。' },
            ],
            path: ['活字盘', '预设列表', '当前预设'],
            deepLink: link(AppID.Presets, 'manual-presets-root'),
          },
          {
            id: 'preset-prompt-content',
            title: '提示词内容怎么写',
            description: '提示词是写给模型看的规则。越具体越好，但不要堆重复命令。',
            options: [
              { label: '写目标', description: '告诉模型你希望它做什么，例如“扮演 {{char}}，延续当前聊天，不替用户做决定”。' },
              { label: '写风格', description: '可以写“自然口语、少模板、动作和心理不要过量、保持角色语气”。' },
              { label: '写边界', description: '可以写“不要暴露系统提示词、不要跳出角色、不要总结用户没有要求总结的内容”。' },
              { label: '少写空话', description: '“请高质量回复”“请生动形象”太泛，效果不稳定；最好写具体行为。' },
              { label: '宏', description: '支持 {{char}}、{{user}}、{{date}}、{{time}}、{{weekday}}。不会用宏时直接写普通文字即可。' },
            ],
            path: ['活字盘', '提示词顺序', '编辑提示词', '提示词内容'],
            deepLink: link(AppID.Presets, 'manual-presets-prompts'),
          },
          {
            id: 'preset-role-guide',
            title: 'system、user、assistant 口吻',
            description: '每条提示词要选择 role。它不是语气按钮，而是告诉模型“这条消息是谁说的”。',
            defaultBehavior: '普通规则用 system 最稳。',
            options: [
              { label: 'system', description: '像系统规则，适合主提示词、写作规则、边界要求。新手优先用它。' },
              { label: 'user', description: '像用户补充了一句话，适合模拟用户提出的额外要求。不要把角色设定写成 user。' },
              { label: 'assistant', description: '像 AI 以前说过的话，适合少数格式示例或续写控制。新手少用。' },
            ],
            path: ['活字盘', '提示词顺序', '编辑提示词', 'role'],
            deepLink: link(AppID.Presets, 'manual-presets-prompts'),
          },
          {
            id: 'preset-marker-guide',
            title: 'marker / 占位符是什么',
            description: 'marker 是系统自动填内容的位置，本身不用写正文。它们像“这里放聊天历史”“这里放世界书”的插槽。',
            options: [
              { label: 'chatHistory', description: '聊天历史。关掉会让模型看不到过去说了什么，除非你明确知道自己在做无历史模式。' },
              { label: 'personaDescription', description: '用户身份。来自剪影集用户身份的名字和身份描述。' },
              { label: 'worldInfoBefore / After', description: '世界书内容。来自剪报夹，受世界书开关、挂载和关键词影响。' },
              { label: 'dialogueExamples', description: '角色对话示例。来自角色卡的台词样张。' },
              { label: 'charDescription / charPersonality / scenario', description: '在 Moro 里共同承载角色核心上下文，包括角色卡、记忆、印象等；保留至少一个启用。' },
            ],
            path: ['活字盘', '提示词顺序', 'marker 条目'],
            deepLink: link(AppID.Presets, 'manual-presets-prompts'),
          },
          {
            id: 'preset-order-guide',
            title: '发送顺序、启用开关和移除',
            description: '列表顺序就是发给模型的大致顺序。关闭条目会让它不发送；移除普通提示词只是从当前顺序里取下。',
            options: [
              { label: '拖动排序', description: '越靠上越早进入请求。一般先放角色/规则，再放聊天历史，再放后置提醒。' },
              { label: '启用开关', description: '关闭后该条不写入请求。排查预设问题时，可以先关一条试聊。' },
              { label: '从当前列表移除', description: '普通提示词可以移出顺序列表；marker 和核心占位通常不要乱移。' },
              { label: '新增提示词', description: '新建一条自定义规则。建议一次只新增一条，测试稳定后再加。' },
              { label: '插入已有提示词', description: '把已经存在但没在顺序里的提示词放回列表。' },
            ],
            path: ['活字盘', '提示词顺序', '发送顺序'],
            deepLink: link(AppID.Presets, 'manual-presets-prompts'),
          },
          {
            id: 'preset-depth-guide',
            title: '按列表顺序插入和 @Depth',
            description: '普通提示词按列表顺序进入；@Depth 会插到聊天历史附近。新手优先用按列表顺序。',
            defaultBehavior: '默认按列表顺序插入。',
            options: [
              { label: '按列表顺序插入', description: '最容易理解，提示词会按你看到的顺序发送。' },
              { label: '按 @Depth 插入历史', description: '把提示词塞进聊天历史末尾附近，用于酒馆高级预设迁移或特殊格式控制。' },
              { label: '@Depth 深度', description: '0 表示最后一条历史之后，数字越大越往前。不是强度，也不是优先级。' },
              { label: '同深度排序', description: '同一个深度有多条提示词时用来决定先后。平时不用改。' },
            ],
            path: ['活字盘', '提示词顺序', '编辑提示词', '@Depth'],
            deepLink: link(AppID.Presets, 'manual-presets-prompts'),
          },
          {
            id: 'preset-sampling-guide',
            title: '采样参数怎么调',
            description: '采样参数影响回复自由度、重复程度和长度。别一次改很多，否则不知道是哪项改变了效果。',
            defaultBehavior: '关闭“采样参数随请求下发”时，会使用文具盒里的全局 API 配置。',
            options: [
              { label: 'Temperature', description: '越高越发散，越低越稳定。角色乱飞可降低；回复太死板可略升。' },
              { label: 'Top P / Top K', description: '控制可选词范围。新手不懂就保持默认，不要和 Temperature 一起大幅乱调。' },
              { label: 'Frequency Penalty', description: '减少重复用词。角色老重复同一句时可小幅提高。' },
              { label: 'Presence Penalty', description: '鼓励聊新内容。太高可能跑题，建议小步调整。' },
              { label: 'Repetition Penalty', description: '抑制重复。不同服务商支持程度不同，改完要试聊。' },
              { label: '上下文 tokens', description: '模型最多看多少上文。填太大可能报错，填太小容易失忆。' },
              { label: '回复 tokens', description: '模型最多生成多长。太小会截断，太大更慢也更贵。' },
            ],
            path: ['活字盘', '连接与参数', '采样参数'],
            deepLink: link(AppID.Presets, 'manual-presets-root'),
          },
          {
            id: 'preset-api-binding-guide',
            title: 'API 方案绑定',
            description: '可把某个预设和文具盒保存的 API 方案绑在一起。切换到这个预设时，会同步切换接口、key 和模型。',
            defaultBehavior: '默认不绑定 API 方案。',
            options: [
              { label: '适合什么时候用', description: '例如“日常聊天用便宜模型，写作预设用强模型”，切预设时自动换模型。' },
              { label: '注意', description: '绑定后激活预设会改当前 API 配置；如果突然换模型了，先检查这里。' },
              { label: '不绑定', description: '预设只管提示词和参数，模型仍按文具盒当前主 API 走。' },
            ],
            path: ['活字盘', '连接与参数', 'API 方案'],
            deepLink: link(AppID.Presets, 'manual-presets-root'),
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
      '提供正则写作说明：查找正则、替换内容、运行位置、仅显示层、仅提示词、消息深度和测试台怎么用。',
    ],
    beginnerSteps: [
      '如果你不知道正则是什么，可以先不打开补丁铺。',
      '要用时先建一条很简单的替换规则，确认聊天显示正常，再导入复杂脚本。',
      '角色局部脚本只影响指定角色，全局脚本会影响更广，建议先局部测试。',
      '新手尽量优先用“仅显示层”或“仅提示词”，少直接“改写原文”；改原文会影响保存下来的聊天内容。',
    ],
    commonQuestions: [
      {
        title: '正则会改掉原始聊天记录吗？',
        answer: '取决于运行位置和选项。仅显示类脚本只改你看到的文本；输入 / 输出处理类可能会改写发送给模型或落库前的内容。',
      },
      {
        title: '为什么脚本没运行？',
        answer: '检查脚本是否启用、作用范围是否匹配当前角色、运行位置是否包含对应阶段，以及正则表达式本身是否能匹配文本。',
      },
      {
        title: '不会写正则怎么办？',
        answer: '先从最简单的文字替换开始，例如把固定词 A 换成 B。复杂的 /pattern/gi、捕获组、HTML 美化脚本，建议导入前先在测试文本里确认效果。',
      },
      {
        title: '导入别人的正则安全吗？',
        answer: '要谨慎。正则可以改用户输入、AI 输出、提示词和显示内容。导入后先停用或只在角色局部测试，确认不会误删内容再打开。',
      },
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
      {
        id: 'regex-writing-guide',
        title: '正则怎么写',
        description: '正则像一把自动剪刀：能帮你整理文本，也可能剪错。先小范围测试，再扩大作用范围。',
        settings: [
          {
            id: 'regex-scope-guide',
            title: '全局、预设、角色作用域',
            description: '先决定这条脚本跟谁走。作用域越大，影响越广。',
            options: [
              { label: '全局', description: '所有聊天都可能生效。适合通用显示美化或通用清理，但最容易误伤。' },
              { label: '预设', description: '只在当前活字盘预设启用、且预设总开关打开时生效。适合随某套提示词一起使用的格式修补。' },
              { label: '角色', description: '只影响某个角色。新手测试正则时推荐先用角色局部，出问题范围小。' },
            ],
            path: ['补丁铺', '顶部作用域', '全局 / 预设 / 角色'],
            deepLink: link(AppID.Regex, 'manual-regex-root'),
          },
          {
            id: 'regex-basic-fields',
            title: '正则名称、查找正则、替换内容',
            description: '最核心的三个字段：叫什么、找什么、换成什么。',
            options: [
              { label: '正则名称', description: '只用于列表识别，建议写清用途，例如“隐藏状态栏标签”“把某口癖替换掉”。' },
              { label: '查找正则', description: '要寻找的文本规则。可以写普通文字，也可以写 /pattern/gi 这样的正则表达式。' },
              { label: '替换内容', description: '找到后换成什么。留空就是删除命中的内容。支持 $1、$<name> 和 {{match}}。' },
              { label: '捕获组', description: '$1 表示查找规则里第一个括号捕到的内容。不会用时先别用，普通替换也能解决很多问题。' },
            ],
            path: ['补丁铺', '编辑正则', '基础与替换'],
            deepLink: link(AppID.Regex, 'manual-regex-enabled'),
          },
          {
            id: 'regex-trim-guide',
            title: '预处理移除',
            description: '每行写一个要先从命中片段里删掉的文本，再执行替换。新手通常可以留空。',
            options: [
              { label: '适合什么', description: '适合命中一大段后，先去掉固定包裹或多余符号，再把剩余内容放进替换结果。' },
              { label: '不适合什么', description: '如果只是简单把 A 换成 B，不需要填这里。' },
            ],
            path: ['补丁铺', '编辑正则', '预处理移除'],
            deepLink: link(AppID.Regex, 'manual-regex-enabled'),
          },
          {
            id: 'regex-placement-guide',
            title: '运行位置怎么选',
            description: '运行位置决定正则处理哪类文本。位置选错时，脚本看起来就像“没生效”。',
            options: [
              { label: '用户输入', description: '处理你发出去的话。直接改原文时，会影响保存和发给模型的内容。' },
              { label: 'AI 输出', description: '处理 AI 回复。可用于清理模型多余标签、替换口癖、整理落库前文本。' },
              { label: '世界书', description: '处理世界书注入内容。高级用法，新手少用。' },
              { label: '斜杠命令 / 推理内容', description: '保留兼容位置，普通聊天通常用不到。' },
              { label: '多选位置', description: '同一脚本可作用于多个位置，但新手建议一次只选一个，方便排查。' },
            ],
            path: ['补丁铺', '编辑正则', '运行位置'],
            deepLink: link(AppID.Regex, 'manual-regex-placement'),
          },
          {
            id: 'regex-run-mode-guide',
            title: '仅显示层、仅提示词、改写原文',
            description: '这是最重要的安全选项。它决定正则只是改变你看到的样子，还是改变真正保存/发送的内容。',
            defaultBehavior: '两个都不勾时，就是直接改写原文。',
            options: [
              { label: '仅显示层', description: '只改聊天气泡显示，不改保存的原文，也不改发给模型的内容。适合隐藏标签、美化状态栏。' },
              { label: '仅提示词', description: '只改发给模型看的内容，不改聊天原文。适合给模型包裹提示、迁移酒馆预设脚本。' },
              { label: '改写原文', description: '不勾仅显示层/仅提示词时生效。会改落库或发送内容，风险最高。' },
              { label: '编辑消息时运行', description: '控制手动编辑消息时是否也跑这条脚本。不了解就先关。' },
            ],
            path: ['补丁铺', '编辑正则', '运行模式'],
            deepLink: link(AppID.Regex, 'manual-regex-placement'),
          },
          {
            id: 'regex-macro-depth-guide',
            title: '宏替换和消息深度',
            description: '这是过滤范围用的高级项。不会用可以保持默认。',
            options: [
              { label: '不替换宏', description: 'findRegex 里的 {{user}} / {{char}} 按普通文字处理。' },
              { label: '替换成名字', description: '{{user}} 会变成当前用户名称，{{char}} 会变成当前角色名。' },
              { label: '替换成名字并正则转义', description: '名字里有特殊符号时更安全，适合写进正则匹配。' },
              { label: '最小深度 / 最大深度', description: '0 是最后一条消息，数字越大越旧。留空表示不限。只想处理最近几条时再填。' },
            ],
            path: ['补丁铺', '编辑正则', '宏替换 / 消息深度'],
            deepLink: link(AppID.Regex, 'manual-regex-placement'),
          },
          {
            id: 'regex-test-guide',
            title: '测试文本怎么用',
            description: '保存前先把一段样本文本粘进去，看输出是否符合预期。测试台不会自动证明所有聊天都安全，但能抓住明显错误。',
            options: [
              { label: '先测命中', description: '输入应该被处理的文本，确认能替换。' },
              { label: '再测不命中', description: '输入不该被处理的文本，确认不会误删。' },
              { label: '结果为空', description: '可能是替换内容留空且命中了，也可能是查找规则太宽。先确认是不是你想要的删除效果。' },
              { label: '逐步扩大', description: '先角色局部测试，再考虑预设或全局；先停用复杂脚本，逐条打开。' },
            ],
            path: ['补丁铺', '编辑正则', '试运行'],
            deepLink: link(AppID.Regex, 'manual-regex-enabled'),
          },
          {
            id: 'regex-examples',
            title: '新手例子',
            description: '先从这些简单用途理解正则，不要一上来导入很长的复杂脚本。',
            options: [
              { label: '固定词替换', description: '查找写一个固定词，替换内容写新词。适合统一称呼。' },
              { label: '删除固定标签', description: '查找写要删除的标签，替换内容留空。建议选“仅显示层”先试。' },
              { label: '隐藏整段状态栏', description: '复杂标签可能跨多行，需要正则匹配和显示层保护。导入别人脚本后先用测试文本确认。' },
              { label: '给提示词包裹标签', description: '这类通常应该选“仅提示词”，否则可能把包裹标签写进真实聊天记录。' },
            ],
            path: ['补丁铺', '新建正则', '示例用途'],
            deepLink: link(AppID.Regex, 'manual-regex-root'),
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
      '模型报错排查：按 401、404、429、超时、上下文过长、流式中断等常见提示给出解决方法。',
      '实时与通知：天气、新闻、Notion、飞书、小红书、系统通知、VAPID、主动消息 Push、Instant Push。',
    ],
    beginnerSteps: [
      '第一步只配置“主 API”：接口地址、API Key、模型名填好后，回絮语试聊。',
      '第二步做一次本地完整备份，之后再开始大量导入角色、图片和外观。',
      '第三步按需要补通知、MiniMax、Replicate、副 API、实时感知；不用的服务可以一直留空。',
      '遇到模型报错时先别急着乱改：打开 API 调用记录，看报错原文，再按“模型报错合集”逐项排查。',
    ],
    commonQuestions: [
      {
        title: '主 API 和副 API 怎么选？',
        answer: '主 API 用来聊天，优先选择你最想让角色使用的模型；副 API 用来后台整理，可以选更快或更便宜的模型，没配时会回退主 API。',
      },
      {
        title: '为什么通知开了还是收不到？',
        answer: '需要同时满足 Moro 开关、浏览器 / 手机系统权限、运行环境支持。网页被彻底关闭后，普通本地通知不一定能继续工作。',
      },
      {
        title: '备份会包含 API Key 吗？',
        answer: '备份和恢复是本机数据迁移工具。导出前应按实际需要选择完整备份或文字 / 媒体分项，并妥善保管备份文件。',
      },
      {
        title: '模型报错先看哪里？',
        answer: '先看“API 调用记录”和弹窗里的错误原文。最常见的是接口地址写错、API Key 无效、模型名不存在、余额不足、请求太长或网络被拦住。',
      },
      {
        title: '别人能用的模型，为什么我这里不能用？',
        answer: '同一个模型名也可能因为服务商、账号权限、地区、余额、Base URL 不同而不可用。先确认你用的是同一家服务商给出的准确模型名。',
      },
      {
        title: '流式输出要不要开？',
        answer: '支持流式的服务商可以开，回复会一边生成一边显示；如果经常半路断、乱码或空白，先关闭流式输出再试。',
      },
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
        id: 'settings-model-errors',
        title: '模型报错合集与解决',
        description: '看到英文或数字报错时，可以先在这里按关键词找。不要一次改很多设置，先改一个地方，再回聊天试一次。',
        settings: [
          {
            id: 'settings-error-first-aid',
            title: '报错后先看哪里',
            description: '先确认是哪一次请求失败、失败原因是什么。只看“发不出去”很难判断，错误原文最有用。',
            options: [
              { label: '看弹窗原文', description: '记住关键字，例如 401、404、429、timeout、context length、model not found。' },
              { label: '看 API 调用记录', description: '能看到最近调用来自哪个 App、哪个角色、用了哪个接口，方便判断是不是主 API 或副 API 出错。' },
              { label: '检查三件套', description: '主 API 最少要有接口地址、API Key、模型名。三项少一项都可能失败。' },
              { label: '一次只改一处', description: '先改模型名就只改模型名，先改 key 就只改 key，这样更容易知道是哪一步修好了。' },
            ],
            path: ['文具盒', '模型与服务', 'API 调用记录'],
            deepLink: settingsLink('manual-settings-api-log', 'group:api'),
          },
          {
            id: 'settings-error-missing-api',
            title: '提示未配置 API / Missing API Key',
            description: '通常是主 API 没填完整，或当前功能需要副 API、外部服务 API，但对应设置是空的。',
            options: [
              { label: '先填主 API', description: '接口地址、API Key、模型名三项都填好后，先去絮语发一句短消息测试。' },
              { label: '副 API 可以先不填', description: '副 API 没配时多数后台任务会回退主 API，新手可以先把主 API 配稳。' },
              { label: '外部服务分开填', description: '语音、写歌、图片等服务不一定使用主 API，需要在对应服务区域单独填写。' },
            ],
            path: ['文具盒', '模型与服务', '主 API'],
            deepLink: settingsLink('manual-settings-main-api', 'group:api'),
          },
          {
            id: 'settings-error-401-403',
            title: '401 / 403：密钥或权限不对',
            description: '401 多半是 API Key 不对或过期；403 多半是账号没有权限、服务商拒绝访问，或模型还没开通。',
            options: [
              { label: '重新复制 API Key', description: '从服务商后台重新复制，粘贴时不要多空格、不要少字符、不要把引号也复制进去。' },
              { label: '确认账号可用', description: '检查账号是否欠费、额度是否用完、是否需要实名认证或开通模型权限。' },
              { label: '检查 Base URL', description: '不要填控制台网址，要填服务商文档里的 API 接口地址；有些服务需要以 /v1 结尾。' },
              { label: '确认模型权限', description: '有些模型不是有 key 就能用，需要在服务商后台单独申请或购买。' },
            ],
            path: ['文具盒', '模型与服务', '主 API'],
            deepLink: settingsLink('manual-settings-main-api', 'group:api'),
          },
          {
            id: 'settings-error-404-model',
            title: '404 / model not found：模型名不对',
            description: '这通常不是网络坏了，而是服务商找不到你填的模型名，或接口地址和模型不属于同一家服务。',
            options: [
              { label: '拉取模型列表', description: '能拉取时优先从列表里选，少手打一个字符都可能避免报错。' },
              { label: '复制完整模型名', description: '模型名要包含服务商给出的完整 id，大小写、斜杠、日期后缀都要保留。' },
              { label: '核对服务商', description: 'A 服务商的模型名不能拿去 B 服务商的接口地址使用。' },
              { label: '检查地址结尾', description: 'OpenAI 兼容接口常见写法是 base URL 到 /v1，不要再额外写 /chat/completions。' },
            ],
            path: ['文具盒', '模型与服务', '主 API', '模型'],
            deepLink: settingsLink('manual-settings-main-api', 'group:api'),
          },
          {
            id: 'settings-error-429',
            title: '429 / rate limit：太频繁或额度不够',
            description: '429 表示服务商暂时不让继续请求，可能是发得太快、同时请求太多、余额不足或账号限额到了。',
            options: [
              { label: '等一会再试', description: '先暂停几十秒到几分钟，很多限流会自动恢复。' },
              { label: '检查余额和额度', description: '去服务商后台看余额、套餐额度、每日限制和并发限制。' },
              { label: '降低使用强度', description: '少开同时生成、少让多个后台任务一起跑，必要时换更便宜或限额更高的模型。' },
              { label: '短消息测试', description: '先发一句很短的话确认 API 能通，再回到原来的长聊天。' },
            ],
            path: ['文具盒', '模型与服务', 'API 调用记录'],
            deepLink: settingsLink('manual-settings-api-log', 'group:api'),
          },
          {
            id: 'settings-error-timeout-network',
            title: '超时 / Network Error / Failed to fetch',
            description: '这类报错说明 Moro 没能顺利连到服务商。可能是网络、代理、接口地址、浏览器限制，或服务商当时很慢。',
            options: [
              { label: '检查网络和代理', description: '先确认浏览器能打开服务商官网或文档页，代理开关也要和服务商要求一致。' },
              { label: '核对接口地址', description: 'Base URL 拼错、少了 https、填成网页地址，都可能导致连接失败。' },
              { label: '关闭流式输出', description: '有些中转不适合流式，关掉后会等完整回复再显示，稳定性可能更好。' },
              { label: '缩短请求', description: '长聊、很多世界书、很多记忆会让请求更慢。先发短句测试是否能恢复。' },
            ],
            path: ['文具盒', '模型与服务', '主 API'],
            deepLink: settingsLink('manual-settings-main-api', 'group:api'),
          },
          {
            id: 'settings-error-context',
            title: 'context length / too many tokens：内容太长',
            description: '模型一次能看的内容有限。聊天太长、世界书太多、记忆太多时，请求会超过模型上限。',
            options: [
              { label: '打开上下文防爆保护', description: '主 API 里有防爆保护，建议新手保持开启，避免请求长到直接失败。' },
              { label: '减少世界书和记忆', description: '先停用不相关的全局世界书，降低随身记忆或后台整理内容。' },
              { label: '整理长聊天', description: '很长的聊天可以靠总结、归档、换新会话来减轻压力。' },
              { label: '换大上下文模型', description: '如果你确实需要很多设定，可以选择上下文窗口更大的模型。' },
            ],
            path: ['文具盒', '模型与服务', '主 API', '上下文防爆保护'],
            deepLink: settingsLink('manual-settings-main-api', 'group:api'),
          },
          {
            id: 'settings-error-json',
            title: 'JSON / 格式解析失败',
            description: '模型返回的内容没有按功能要求的格式来，或者中转返回了网页错误页，Moro 就读不懂。',
            options: [
              { label: '先重试一次', description: '偶发格式错误很常见，重试可能直接恢复。' },
              { label: '降低温度', description: '温度越低越稳定，适合需要严格格式的后台任务。' },
              { label: '换更稳的模型', description: '小模型或太自由的模型更容易不按格式输出，后台整理可以用更稳的模型。' },
              { label: '检查预设和正则', description: '过强的提示词或正则可能改坏输出格式，先临时关闭可疑项测试。' },
            ],
            path: ['文具盒', '模型与服务', '主 API', '温度'],
            deepLink: settingsLink('manual-settings-main-api', 'group:api'),
          },
          {
            id: 'settings-error-content-filter',
            title: 'content filter / policy：内容被服务商拦截',
            description: '服务商认为请求或回复触碰了它的规则，所以拒绝生成。不同服务商规则不同，Moro 不能替服务商放行。',
            options: [
              { label: '换温和说法', description: '把过于刺激、危险或违规的表达改得更日常，先确认能不能正常回复。' },
              { label: '减少敏感设定', description: '检查角色卡、世界书、用户设定里是否有容易触发拦截的内容。' },
              { label: '换服务商或模型', description: '如果你的使用场景合规但经常被误拦，可以选择规则更适合的服务。' },
            ],
            path: ['文具盒', '模型与服务', 'API 调用记录'],
            deepLink: settingsLink('manual-settings-api-log', 'group:api'),
          },
          {
            id: 'settings-error-stream',
            title: '流式中断 / 回复到一半停住',
            description: '流式输出会把回复分段传回来。网络抖动、中转不兼容、服务商限制，都可能让它中途断掉。',
            options: [
              { label: '关闭流式输出', description: '这是最快的排查方法。关闭后虽然不会逐字出现，但更容易拿到完整回复。' },
              { label: '看是否已经生成', description: '有时服务商已经扣费并生成了一部分，只是网页端没有完整收到。API 调用记录能帮你判断。' },
              { label: '换网络或接口', description: '如果只在某个网络或某个中转上断，优先检查它们。' },
            ],
            path: ['文具盒', '模型与服务', '主 API', '流式输出'],
            deepLink: settingsLink('manual-settings-main-api', 'group:api'),
          },
          {
            id: 'settings-error-5xx',
            title: '500 / 502 / 503 / 504：服务商或中转忙',
            description: '这类通常不是你填错了，而是服务商、中转或网络链路临时出问题。',
            options: [
              { label: '稍后再试', description: '先等几分钟，服务商拥堵或维护时经常会自己恢复。' },
              { label: '换模型或线路', description: '同一家服务商的某个模型忙，可以临时换别的模型或备用接口。' },
              { label: '减少请求长度', description: '超长请求更容易在中转超时，先用短消息确认服务是否恢复。' },
              { label: '保留错误原文', description: '如果一直失败，把状态码、时间、模型名、Base URL 发给服务商客服更容易定位。' },
            ],
            path: ['文具盒', '模型与服务', 'API 调用记录'],
            deepLink: settingsLink('manual-settings-api-log', 'group:api'),
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
    beginnerSteps: [
      '只想换风格时，先从调色、壁纸、图标形状和聊天气泡开始，不需要写 CSS。',
      '想让 AI 帮你改外观时，复制对应提示词，把需求发给 AI，再把生成的 CSS 粘回手写码或 App 分区。',
      '大改之前先在存档册保存当前外观；写坏了可以清空 CSS、恢复存档或复制修坏修复提示词。',
    ],
    commonQuestions: [
      {
        title: '全局 CSS 和 App 分区有什么区别？',
        answer: '全局 CSS 影响整机；App 分区只影响某一个软件，更适合单独改某个 App 的皮肤。新手建议优先用 App 分区，出问题范围更小。',
      },
      {
        title: '为什么 CSS 写完挡住按钮了？',
        answer: '自定义 CSS 可以覆盖界面。先去拼贴册清空对应代码，或用“修坏修复”提示词让 AI 帮你保留风格但恢复可点击区域。',
      },
      {
        title: '聊天背景和全局聊天皮肤谁优先？',
        answer: '单聊设置里的本会话背景只影响当前角色；拼贴册里的聊天皮肤是全局默认。当前会话有单独设置时会覆盖默认效果。',
      },
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
    beginnerSteps: [
      '先在聊天里发送、接收或保存图片，相册会按角色自动出现。',
      '点角色相册进入照片墙，点单张照片进入灯箱详情。',
      '需要整理时，详情页删单张；长按角色相册可清空整本。',
    ],
    commonQuestions: [
      {
        title: '为什么相册是空的？',
        answer: '相册只收聊天中保存下来的图片。刚创建角色或还没保存照片时，这里不会有内容。',
      },
      {
        title: '删除相册会删除聊天记录吗？',
        answer: '删除相册图片只清理相册素材，不等于清空聊天文本；但对应图片资源可能不再能从相册查看。',
      },
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
    beginnerSteps: [
      '先从角色音乐页进入，看看 TA 的歌单、人格和乐评。',
      '播放一首歌后，可点分享给角色进入“一起听”，角色会边听边聊。',
      '如果你在创作社写了歌，生成后的作品也会进入音乐库。',
    ],
    commonQuestions: [
      {
        title: '为什么搜不到歌或播放不了？',
        answer: '音乐搜索依赖外部歌曲源，搜不到时会回退到角色歌单或一起写的歌。网络或接口异常时可能只能看本地记录。',
      },
      {
        title: '角色乐评从哪里来？',
        answer: '角色会根据人设、当前歌曲、聊天近况和副 API 生成乐评；未配置副 API 时会回退主 API。',
      },
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
    beginnerSteps: [
      '打开热点先看榜单，不需要配置也能把可用缓存展示出来。',
      '点右上角刷新可强制重拉当前时段；失败时会沿用上次榜单。',
      '想和角色聊某条新闻，点转发按钮选择角色，会在聊天里生成新闻卡。',
    ],
    commonQuestions: [
      {
        title: '热点会不会每句聊天都提？',
        answer: '不会。开启实时感知后，它只是背景认知来源之一，角色通常只会在合适时自然提起。',
      },
      {
        title: '热点数据不刷新怎么办？',
        answer: '热点源可能临时不可用。手动刷新失败时，App 会保留上次结果，你也可以稍后再试。',
      },
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
    beginnerSteps: [
      '第一次进入先选择角色，并按提示开启记忆系统。',
      '日常聊天后，记忆会逐步生成；想把旧聊天一次性整理，可在设置里导入旧记忆。',
      '浏览时先看事件盒和全部记忆，再用心意图谱 / 关系网络查看关联。',
    ],
    commonQuestions: [
      {
        title: '为什么刚开记忆还看不到内容？',
        answer: '记忆需要聊天内容和后台整理过程。新角色、刚开启或副 API 未配置时，内容会较少。',
      },
      {
        title: '删除记忆会影响聊天吗？',
        answer: '删除记忆会移除对应长期记忆节点和关联，但不会把原聊天文本一起删掉。操作不可撤销，建议先备份。',
      },
      {
        title: '远程向量是什么？',
        answer: '它用于把记忆向量同步到你自己的远程表，方便大规模检索。新手可以先不用配置，本地记忆仍可工作。',
      },
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
    beginnerSteps: [
      '先选择角色进入房间，查看当前生活状态、待办和房间笔记。',
      '点编辑模式可放置家具、装饰和互动说明；退出编辑后点物品看角色反应。',
      '想做更可爱的像素布置，再进入像素小家编辑角色和房间。',
    ],
    commonQuestions: [
      {
        title: '房间里的待办会影响聊天吗？',
        answer: '你帮角色划掉或新增待办时，系统会尽量同步给角色，让 TA 知道自己的生活状态被你动过。',
      },
      {
        title: '像素小家和普通房间有什么区别？',
        answer: '普通房间偏文字和物品互动，像素小家偏可视化布置和像素形象。两者都服务于角色生活感。',
      },
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
    beginnerSteps: [
      '先看账户总览，确认虚拟余额、收入支出和最近流水。',
      '想给自己一个目标，可创建攒钱目标，后续转账、购物和外卖会形成更完整的经济感。',
      '再进入经营或商店小游戏，使用虚拟资产推进玩法。',
    ],
    commonQuestions: [
      {
        title: '这里的钱是真钱吗？',
        answer: '不是。人生拟只记录 Moro 内的虚拟余额、流水和经营玩法，不连接真实银行或支付。',
      },
      {
        title: '为什么购物、外卖会影响流水？',
        answer: '心意铺、饭票、红包和转账会写入虚拟账本，方便你回看角色生活里的花销和礼物往来。',
      },
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
    beginnerSteps: [
      '打开后可在“对页信笺”和“合写本子”之间切换。',
      '只想记自己的事，就写私人日记；想看多角色生活流，就用合写本子。',
      '重要日记可以收进回忆标本馆，让角色以后更容易记得。',
    ],
    commonQuestions: [
      {
        title: '日记默认会给角色看吗？',
        answer: '日记是否进入角色认知取决于具体入口和操作。私人记录适合自己保存，收进记忆或转发后才更可能影响角色。',
      },
      {
        title: '合写本子和聊天总结有什么关系？',
        answer: '合写本子可以承接角色视角日记、每日对话总结和生活流记录，适合把散落的互动整理成时间线。',
      },
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
    beginnerSteps: [
      '第一次打开如果信息流为空，点“翻新页”生成一批本地动态。',
      '点卡片看详情，可以点赞、收藏、评论、剪下来或转发给角色。',
      '想让角色自己刷内容，点出门转转进入自由活动；想先囤图，点素材堆进入拾光图库。',
    ],
    commonQuestions: [
      {
        title: '见闻簿是真实小红书吗？',
        answer: '见闻簿主体是本地生成的信息流。自由活动可能接入外部 MCP，让角色操作真实平台时要注意不要打扰真人。',
      },
      {
        title: '清空整簿会影响聊天吗？',
        answer: '清空的是见闻簿本地信息流；已经转发到聊天里的卡片和聊天记录不会因此自动删除。',
      },
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
    beginnerSteps: [
      '想学资料，先进普通课本导入 PDF；想学语言，直接新建语言课。',
      '选择一位角色当老师或学习搭子，先让 TA 讲一小节，再做随堂测。',
      '做错的题去练习册复盘，追问解析比一口气刷很多题更有用。',
    ],
    commonQuestions: [
      {
        title: '没有 PDF 能学吗？',
        answer: '语言学习可以直接按目标生成路线；普通课本更适合已有教材、论文或资料时使用。',
      },
      {
        title: '角色讲错怎么办？',
        answer: '自习室是学习辅助，不替代权威教材。遇到专业知识应让角色解释依据，必要时再查真实资料。',
      },
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
    beginnerSteps: [
      '先从戏单选一折：想恋爱攻略选攻略本，想轻松整活选番外，想问问题选占卜，想被接住选谈心。',
      '每一折通常都要先选角色或参与者，再选题材、模式或开局设置。',
      '玩完后留意“发到聊天”“收藏”“继续历史”之类按钮，把重要结果带回主线。',
    ],
    commonQuestions: [
      {
        title: '折子戏会改变主聊天关系吗？',
        answer: '多数玩法先在折子戏内保存；只有你选择发到聊天、收进典藏或玩法明确写回时，才会更明显地影响主线。',
      },
      {
        title: '占卜结果可以当现实建议吗？',
        answer: '占卜是角色扮演和创作工具，不是现实决策依据。涉及医疗、法律、财务等问题请看专业渠道。',
      },
      {
        title: '狼人杀、真心话大冒险需要多少角色？',
        answer: '参与人数越多越热闹。角色不足时先去剪影集补角色，或选择适合少人数的玩法。',
      },
    ],
    settingSections: [
      {
        id: 'theater-pages',
        title: '九折入口',
        settings: [
          {
            id: 'theater-guide',
            title: '壹 · 攻略本',
            description: '和角色排一出恋爱攻略戏，选择行动、积累心动，最后得到结算卡。',
            path: ['折子戏', '攻略本'],
            deepLink: link(AppID.Theater, 'manual-theater-root'),
          },
          {
            id: 'theater-extra',
            title: '贰 · 番外',
            description: '做问卷、角色访谈、仿真聊天截图、朋友圈、小红书或匿名论坛图文。',
            path: ['折子戏', '番外'],
            deepLink: link(AppID.Theater, 'manual-theater-root'),
          },
          {
            id: 'theater-divination',
            title: '叁 · 占卜',
            description: '塔罗、雷诺曼、六爻、梅花易数；可自己解，也可让角色按本人口吻解读。',
            path: ['折子戏', '占卜'],
            deepLink: link(AppID.Theater, 'manual-theater-root'),
          },
          {
            id: 'theater-talk',
            title: '肆 · 谈心',
            description: '情绪支持型对话，适合把难说的话慢慢说完。',
            path: ['折子戏', '谈心'],
            deepLink: link(AppID.Theater, 'manual-theater-root'),
          },
          {
            id: 'theater-trpg-party',
            title: '伍至玖 · 跑团与派对',
            description: 'TRPG、轨迹、对影、狼人杀、真心话大冒险等熟人玩法，适合多人角色一起玩。',
            path: ['折子戏', 'TRPG / 轨迹 / 对影 / 狼人杀 / 真心话大冒险'],
            deepLink: link(AppID.Theater, 'manual-theater-root'),
          },
        ],
      },
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
    beginnerSteps: [
      '打开后先选“笔友会”或“写歌”。小说适合长文本共创，写歌适合歌词和音乐作品。',
      '选择合作角色，告诉 TA 题材、风格、禁忌和你想负责的部分。',
      '写歌如果要生成完整音频，需要先在文具盒配置 Replicate Token；只写歌词则不需要。',
    ],
    commonQuestions: [
      {
        title: '笔友会和折子戏番外有什么区别？',
        answer: '笔友会偏正式作品和长篇共创；番外偏短内容、截图、问卷和整活素材。',
      },
      {
        title: '写歌为什么不能生成音频？',
        answer: '完整歌曲生成依赖外部音乐服务配置。未配置时仍可共创歌词、结构和风格说明。',
      },
    ],
    settingSections: [
      {
        id: 'creative-pages',
        title: '创作入口',
        settings: [
          {
            id: 'creative-novel',
            title: '笔友会',
            description: '与角色一起设世界观、排角色、写章节、续写和润色。',
            path: ['创作社', '笔友会'],
            deepLink: link(AppID.Creative, 'manual-creative-root'),
          },
          {
            id: 'creative-song',
            title: '写歌',
            description: '与角色一起定主题、写歌词、做风格提示，并把成品送进音乐库。',
            path: ['创作社', '写歌'],
            deepLink: link(AppID.Creative, 'manual-creative-root'),
          },
        ],
      },
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
    beginnerSteps: [
      '先在“接入”里给角色打开页外开关，并给角色或自己捏一个小人。',
      '再去世界房间、图书馆、听歌房、留言簿、娱乐室、邮局等房间看活动。',
      '如果担心消耗 API，先在页外 API 设置里给页外单独指定便宜模型或降低使用频率。',
    ],
    commonQuestions: [
      {
        title: '页外会一直在后台运行吗？',
        answer: '网页环境下依赖 Moro 页面运行状态；关闭后不会真正常驻，重新打开时会尽量补跑到期活动。',
      },
      {
        title: '角色在页外做的事会进聊天吗？',
        answer: '启用接入后，页外活动会形成空间动态，并可能写入聊天上下文和记忆。你也可以在设置里控制 API 和节奏。',
      },
      {
        title: '邮局身份是什么？',
        answer: '邮局用于漂流信和陌生来信。身份导入 / 导出用于在设备之间保持同一匿名作者身份。',
      },
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
    beginnerSteps: [
      '先从首页看这个月，点日期贴便签或请角色写一笔。',
      '有未来约定时放进时光契约；想回看收藏内容时去典藏馆。',
      '节日活动、纪念日和求婚后的喜事会自然聚到对应栏目。',
    ],
    commonQuestions: [
      {
        title: '岁时记和日记有什么区别？',
        answer: '日记偏一篇篇文字记录；岁时记偏日期、纪念日、收藏和特殊时间的索引。',
      },
      {
        title: '角色写在未来日期的内容会提醒吗？',
        answer: '共享月历负责记录和回看；真正的系统提醒要看时光契约、健康、闹钟或通知类设置。',
      },
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
    beginnerSteps: [
      '先填最近一次开始日、周期长度和经期天数，系统会自动推算下一次开始和结束。',
      '再选择提前几天提醒、提醒时间，以及提醒总开关。',
      '如果想让角色关心你，改成公开给角色并勾选角色；如果只想自己知道，保持私密。',
    ],
    commonQuestions: [
      {
        title: '这个预测准吗？',
        answer: '它只是按你填的周期做生活提醒，不是医疗诊断。周期明显异常或身体不适时，应以真实身体情况和医生建议为准。',
      },
      {
        title: '公开给角色后会发生什么？',
        answer: '到提醒时间时，选中的角色可以在聊天里用自己的语气提醒。私密模式则只在健康 App 和系统通知里提醒。',
      },
      {
        title: '为什么通知没弹？',
        answer: '请检查健康 App 总开关、文具盒通知权限、浏览器或手机系统通知权限。网页完全关闭后不保证继续提醒。',
      },
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
      '首页可搜索、筛选、抽张饭票、领平台红包，也能让 AI 现写一批本地店铺。',
      '进店后加菜、选规格、写备注、给跑腿小费，结算时可自付、代付或给角色点单。',
      '订单会生成小票、配送进度、骑手 / 商家聊天、收货确认、申诉退款和评价。',
      '订单卡可写回絮语，角色会围绕“你点了什么、谁代付、什么时候送到”回应。',
    ],
    beginnerSteps: [
      '第一次打开先从首页挑一家店；不知道吃什么就点“抽张饭票”。',
      '加菜后去结算，确认配送时间、备注、红包和付款方式。',
      '下单后在票根夹看进度；送达后点收货，想复盘就写评价或把小票发回聊天。',
    ],
    commonQuestions: [
      {
        title: '饭票会真的下外卖吗？',
        answer: '不会。饭票是本地模拟外卖和角色互动，不连接真实商家、骑手或支付平台。',
      },
      {
        title: '为什么角色会主动点外卖？',
        answer: '只有单聊设置里开启“TA 会主动给你撕饭票”后，角色才可能在饭点、降温或聊到吃的时主动下单。',
      },
      {
        title: '订单和人生拟余额有什么关系？',
        answer: '自付、退款、代付等会写入虚拟流水，让人生拟能回看这次消费。',
      },
    ],
    settingSections: [
      {
        id: 'takeout-settings',
        title: '外卖流程',
        settings: [
          {
            id: 'takeout-home',
            title: '饭票簿首页',
            description: '搜索店铺、筛选排序、领平台红包、抽张饭票或生成新店铺。',
            path: ['饭票', '首页'],
            deepLink: link(AppID.Takeout, 'manual-takeout-root'),
          },
          {
            id: 'takeout-order',
            title: '点单与小票',
            description: '进店加菜、选规格、写备注、使用红包，结算生成订单和聊天小票。',
            path: ['饭票', '店铺', '写一张饭票'],
            deepLink: link(AppID.Takeout, 'manual-takeout-order'),
          },
          {
            id: 'takeout-pay-mode',
            title: '自付 / 代付 / 给角色点',
            description: '选择谁来付、送给谁、是否写回聊天。给角色点单会让 TA 收到外卖事件。',
            defaultBehavior: '默认按当前入口和订单对象决定，不会触发真实支付。',
            path: ['饭票', '结算', '付款与对象'],
            deepLink: link(AppID.Takeout, 'manual-takeout-order'),
          },
          {
            id: 'takeout-delivery',
            title: '配送与收货',
            description: '查看配送进度、骑手 / 商家对话、催单、申诉退款、确认收货和评价。',
            path: ['饭票', '票根夹', '订单详情'],
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
    beginnerSteps: [
      '先选一个角色，点生成首条 Screenlife，让系统知道 TA 最近在手机上做什么。',
      '之后可以刷新实时概览，或补一段指定时间范围的屏幕记录。',
      '想让聊天提到这些线索，保持“加入聊天上下文”；只想自己看，就关掉联动。',
    ],
    commonQuestions: [
      {
        title: '循迹是真的定位或监控吗？',
        answer: '不是。循迹主要是角色 Screenlife 演出。真实定位只有在你选择并授权时才会作为生成参考，坐标只保存在本机。',
      },
      {
        title: '写入日常是什么意思？',
        answer: '开启后，循迹结果会被当成角色自己经历过的小日子，未来聊天更可能提起；关闭则只在循迹里回看。',
      },
      {
        title: '自动更新会一直跑吗？',
        answer: '它依赖 Moro 页面和浏览器运行状态；关闭页面后不会常驻，回来时会按情况补写。',
      },
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
      '首页搜索、翻新货架、领券、看限抢和推荐礼物；分类页按主题筛选。',
      '商品详情可看评价、收藏、加购物车、立即购买或放进礼物柜。',
      '购物车支持多选、满减券、心意币抵扣、自付和求 TA 代付。',
      '我的页面查看订单、物流、评价、收藏、礼物柜，以及角色心愿购物车。',
      '送给角色的礼物会落到聊天里，角色会回应、感谢、回赠或在之后提起。',
    ],
    beginnerSteps: [
      '先在首页搜关键词或点“翻新货架”，挑一件适合当前关系的礼物。',
      '加购物车后可自己付款，也可以求某个角色代付；TA 会按关系和心情决定。',
      '买到礼物后进“我的 → 礼物柜”选择收礼角色，送出后会生成聊天礼物卡。',
    ],
    commonQuestions: [
      {
        title: '心意铺会真的购物吗？',
        answer: '不会。商品、订单、物流和评价都是 Moro 本地虚拟内容，只影响虚拟余额、聊天和角色关系体验。',
      },
      {
        title: '心意币是什么？',
        answer: '心意币是商城内的虚拟抵扣资源，常用于评价奖励、活动或结算抵扣。',
      },
      {
        title: '角色也会自己买东西吗？',
        answer: '会。角色可能自己逛、加心愿、回赠或留下订单；你也可以替 TA 清空心愿购物车。',
      },
    ],
    settingSections: [
      {
        id: 'shop-pages',
        title: '商城页面',
        settings: [
          {
            id: 'shop-home',
            title: '首页与搜索',
            description: '搜索礼物、翻新货架、领券、看推荐和限抢。',
            path: ['心意铺', '首页'],
            deepLink: link(AppID.Shop, 'manual-shop-root'),
          },
          {
            id: 'shop-cart',
            title: '购物车',
            description: '多选结算、清空、使用优惠和心意币，也可请求角色代付。',
            path: ['心意铺', '购物车'],
            deepLink: link(AppID.Shop, 'manual-shop-root'),
          },
          {
            id: 'shop-orders',
            title: '订单与物流',
            description: '查看订单状态、物流时间线、确认收货、退款和写评价。',
            path: ['心意铺', '我的', '订单'],
            deepLink: link(AppID.Shop, 'manual-shop-root'),
          },
          {
            id: 'shop-gift-inventory',
            title: '礼物柜与送礼',
            description: '把已购买的礼物送给角色，生成聊天礼物卡和后续回应。',
            path: ['心意铺', '我的', '礼物柜'],
            deepLink: link(AppID.Shop, 'manual-shop-root'),
          },
        ],
      },
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
    beginnerSteps: [
      '先开一局，阅读当前地点、在场角色、风闻和你的资源状态。',
      '每次行动前看清风险、代价和收益，再决定是否确认推进。',
      '角色关系、嫉妒、信任和事件旗标会长期积累，想试不同路线可开新周目。',
    ],
    commonQuestions: [
      {
        title: '这是主聊天剧情吗？',
        answer: '椒房记是独立长线文游。它会保存自己的周目和状态，不等于直接改写所有主聊天关系。',
      },
      {
        title: '行动失败怎么办？',
        answer: '失败也是剧情的一部分，可能带来风闻、误会或新支线。想保守推进就优先选择低风险行动。',
      },
    ],
    settingSections: [
      {
        id: 'harem-pages',
        title: '宫廷玩法',
        settings: [
          {
            id: 'harem-stage',
            title: '宫廷舞台',
            description: '查看章节、地点、在场角色、状态、风闻和本轮剧情。',
            path: ['椒房记', '宫廷舞台'],
            deepLink: link(AppID.Harem, 'manual-harem-root'),
          },
          {
            id: 'harem-actions',
            title: '自由行动与宠爱经营',
            description: '选择召见、赐赏、护持、冷处理、调停、普赏或自由行动来推进关系。',
            path: ['椒房记', '行动 / 宠爱经营台'],
            deepLink: link(AppID.Harem, 'manual-harem-root'),
          },
        ],
      },
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
    beginnerSteps: [
      '先从板块进入帖子列表，围观现有帖子和跟帖。',
      '想抛话题就新建帖子，写清楚标题、正文和你希望大家讨论的方向。',
      '回帖后角色和匿名网友可能继续盖楼，适合做公开舆论、吐槽和求助场景。',
    ],
    commonQuestions: [
      {
        title: '匿名网友是真人吗？',
        answer: '不是。茶话亭里的匿名网友由本地 AI 生成，用来模拟论坛气氛。',
      },
      {
        title: '帖子内容会进入角色记忆吗？',
        answer: '茶话亭主要保存在论坛本地。你把内容转回聊天、或角色参与较深时，才更可能影响后续互动。',
      },
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
    beginnerSteps: [
      '先看首页时间线，熟悉角色和 NPC 的公开动态。',
      '想找某个话题时去搜索页；想短聊则进私信。',
      '在“我的”里维护你的账号资料，公开互动时会使用这套身份。',
    ],
    commonQuestions: [
      {
        title: '推特和见闻簿有什么区别？',
        answer: '推特偏 X 式短动态、转发、话题和私信；见闻簿偏小红书图文瀑布流。',
      },
      {
        title: '公开时间线会发到真实网络吗？',
        answer: '不会。推特 App 是本地 AI 社交模拟，不连接真实 X / Twitter。',
      },
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
    beginnerSteps: [
      '先选择一个桌宠，试着对话、喂食和摸摸。',
      '在设定里写清楚它怎么称呼你、喜欢什么、不该说什么。',
      '想让它一直陪着，就点“放到桌面”；不想挡住界面时长按悬浮桌宠进行缩放、隐藏或贴边。',
    ],
    commonQuestions: [
      {
        title: '桌宠和角色是同一个人吗？',
        answer: '可以是同一角色的陪伴形态，也可以是独立小宠物。桌宠设定只影响桌宠本身。',
      },
      {
        title: '提醒为什么不响？',
        answer: '桌宠提醒需要文具盒和系统通知权限；网页环境只在 Moro 页面运行时检查提醒。',
      },
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
    beginnerSteps: [
      '先在见闻簿或桌面打开自由活动，选择一个角色。',
      '确认 MCP / 外部服务状态可用后，点开始让 TA 自主浏览、搜索、评论或发帖。',
      '活动结束后打开详情，检查 TA 做了什么；不合适的记录可以删除。',
    ],
    commonQuestions: [
      {
        title: '会不会影响真实用户？',
        answer: '如果接入真实平台，角色可能会给无关用户评论或互动。请及时检查，避免打扰真人或发布不当内容。',
      },
      {
        title: '活动会进入聊天吗？',
        answer: '角色会记住看到的内容，下次聊天可能主动分享；具体是否写入取决于自由活动记录和相关联动设置。',
      },
      {
        title: '为什么按钮提示先开启 MCP？',
        answer: '自由活动需要外部 MCP 或服务支持角色操作平台。未配置时只能查看说明或历史记录。',
      },
    ],
    settingSections: [
      {
        id: 'xhs-free-pages',
        title: '自由活动流程',
        settings: [
          {
            id: 'xhs-free-character',
            title: '选择角色',
            description: '决定由谁去刷内容；行为会按角色性格和最近聊天展开。',
            path: ['自由活动', '选择角色'],
            deepLink: link(AppID.XhsFreeRoam, 'manual-xhs-free-root'),
          },
          {
            id: 'xhs-free-records',
            title: '活动记录与详情',
            description: '查看浏览、搜索、评论、收藏、发帖等活动详情，也可删除不合适记录。',
            path: ['自由活动', '活动记录'],
            deepLink: link(AppID.XhsFreeRoam, 'manual-xhs-free-root'),
          },
        ],
      },
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
    beginnerSteps: [
      '点右上角添加图片，选择素材并填写标签。',
      '回到列表后用标签筛选素材，长按或删除不再需要的图片。',
      '发见闻簿或让角色自由活动前，先在这里准备几张贴合主题的图。',
    ],
    commonQuestions: [
      {
        title: '标签怎么写？',
        answer: '用空格、逗号或 # 分隔即可，例如“咖啡 日常 约会”。标签越清楚，后面越好筛选。',
      },
      {
        title: '删除素材会影响已发布动态吗？',
        answer: '它会删除素材库里的图片；已经生成并保存到其他位置的动态不一定同步删除。',
      },
    ],
    settingSections: [
      {
        id: 'xhs-stock-pages',
        title: '素材管理',
        settings: [
          {
            id: 'xhs-stock-add',
            title: '添加图片',
            description: '导入图片并填写标签，作为发帖或角色活动素材。',
            path: ['拾光图库', '右上角 +'],
            deepLink: link(AppID.XhsStock, 'manual-xhs-stock-root'),
          },
          {
            id: 'xhs-stock-tags',
            title: '标签筛选',
            description: '按标签过滤图片，快速找到某类素材。',
            path: ['拾光图库', '标签栏'],
            deepLink: link(AppID.XhsStock, 'manual-xhs-stock-root'),
          },
        ],
      },
    ],
  },
  {
    app: '回声亭',
    en: 'Phone',
    category: 'social',
    summary: '主动给角色打电话，或回看接听、未接、拨出记录。',
    features: [
      '拨号盘可输入角色号码，命中已知角色后跳转真实语音通话。',
      '名片夹列出角色电话，最近通话显示拨出、接听、未接和视频记录。',
      '留声片聚合语音 / 视频通话逐字稿，可回放角色语音片段。',
      '陌生号码会模拟呼叫失败，不会拨出真实电话。',
    ],
    beginnerSteps: [
      '先去名片夹点角色号码，或在拨号盘输入角色号码。',
      '通话中可输入文字让角色回应，也可静音、选择语音语种、挂起或结束。',
      '结束后回回声亭，在最近通话和留声片里回看记录与逐字稿。',
    ],
    commonQuestions: [
      {
        title: '回声亭会拨真实电话吗？',
        answer: '不会。它只在 Moro 内给角色打语音电话；陌生号码只是模拟呼叫失败。',
      },
      {
        title: '通话需要什么配置？',
        answer: '文字通话需要主 API；语音朗读需要 MiniMax 和角色音色。没有语音时仍可保留文字通话。',
      },
      {
        title: '挂起通话在哪里找回？',
        answer: '挂起后顶部会出现通话条，点它可回到通话；回声亭和聊天入口也会保留相关记录。',
      },
    ],
    settingSections: [
      {
        id: 'phone-pages',
        title: '电话页面',
        settings: [
          {
            id: 'phone-dial',
            title: '拨号盘',
            description: '输入号码，命中角色时发起语音通话；长按 0 可输入 +。',
            path: ['回声亭', '拨号盘'],
            deepLink: link(AppID.Phone, 'manual-phone-root'),
          },
          {
            id: 'phone-contacts',
            title: '名片夹',
            description: '查看角色号码，点号码可填入拨号盘。',
            path: ['回声亭', '名片夹'],
            deepLink: link(AppID.Phone, 'manual-phone-root'),
          },
          {
            id: 'phone-logs',
            title: '最近通话',
            description: '回看拨出、接听、未接和视频通话存根，也可清空存根。',
            path: ['回声亭', '最近通话'],
            deepLink: link(AppID.Phone, 'manual-phone-root'),
          },
          {
            id: 'phone-recordings',
            title: '留声片',
            description: '按通话聚合逐字稿，能回放仍可用的语音片段。',
            path: ['回声亭', '留声片'],
            deepLink: link(AppID.Phone, 'manual-phone-root'),
          },
        ],
      },
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
    beginnerSteps: [
      '先选角色进入街角，看地图、当前地点、NPC 和街坊动态。',
      '想主动推进时点行动、看戏或带 TA 去约会；约会里分别输入“说什么”和“做什么”。',
      '离开一段时间再回来，查看离线生活、关系变化和新的事件线索。',
    ],
    commonQuestions: [
      {
        title: '街角和单聊见面有什么区别？',
        answer: '单聊见面偏一场临时线下小窗；街角是带地图、NPC、关系和长期变化的小世界。',
      },
      {
        title: '约会内容会回到聊天吗？',
        answer: '重要约会和总结会进入街角存档，并可能写回聊天上下文，让角色之后记得这次经历。',
      },
      {
        title: '为什么生成剧情比较慢？',
        answer: '街角需要同时考虑世界状态、角色关系、场景和历史，调用副 API 或主 API 时会比普通聊天更重。',
      },
    ],
    settingSections: [
      {
        id: 'lifesim-pages',
        title: '街角入口',
        settings: [
          {
            id: 'lifesim-map',
            title: '地图与地点',
            description: '查看街区、当前位置、NPC、主线和支线线索。',
            path: ['街角', '地图 / 地点'],
            deepLink: link(AppID.LifeSim, 'manual-lifesim-root'),
          },
          {
            id: 'lifesim-date',
            title: '约会世界引擎',
            description: '带角色去约会，用话语和动作推进场景，系统会按回合总结。',
            path: ['街角', '带 TA 去约会'],
            deepLink: link(AppID.LifeSim, 'manual-lifesim-root'),
          },
          {
            id: 'lifesim-offline',
            title: '离线生活与关系',
            description: '回看离线期间发生的变化、角色关系和世界状态。',
            path: ['街角', '离线生活 / 关系页'],
            deepLink: link(AppID.LifeSim, 'manual-lifesim-root'),
          },
        ],
      },
    ],
  },
  {
    app: '捏脸·开发',
    en: 'Character Creator Dev',
    category: 'system',
    summary: '开发调试模式下才显示的捏脸部件管理器，用来向捏人器追加自定义透明部件。',
    features: [
      '按肤色、眼睛、嘴、前发、耳发、后发、衣服、外套、面纹和配饰分类添加部件。',
      '上传透明 PNG / WebP 后，可给部件命名，并选择是否允许换色。',
      '已添加部件会注入特别时光和页外的捏人器，下次打开捏人器时生效。',
      '可查看各分类已有自定义部件，并删除不再需要的素材。',
    ],
    beginnerSteps: [
      '普通用户不会在桌面看到这个 App；只有开发调试徽标可见或临时解锁开发面板时才显示。',
      '准备透明背景、同尺寸、同锚点的部件图，否则叠到捏人器里会错位。',
      '如果部件是单色线稿或可着色层，才勾选“可换色”。',
    ],
    commonQuestions: [
      {
        title: '为什么我看不到这个 App？',
        answer: '它是开发调试入口。普通使用不需要它，也不会影响聊天、页外或特别时光。',
      },
      {
        title: '上传后为什么错位？',
        answer: '捏人器按整幅图位置叠层，不会自动裁切对齐。请使用和原素材同画布尺寸、同锚点的透明图。',
      },
    ],
    tips: ['这是素材开发工具，不是普通角色创建入口。普通角色资料在「剪影集」维护。'],
    devOnly: true,
    settingSections: [
      {
        id: 'char-creator-dev-settings',
        title: '部件管理',
        settings: [
          {
            id: 'char-creator-category',
            title: '类目',
            description: '选择新部件要追加到哪个捏脸分类，例如前发、衣服、配饰或面纹。',
            path: ['捏脸·开发', '追加部件', '类目'],
            deepLink: link(AppID.CharCreatorDev, 'manual-char-creator-dev-root'),
          },
          {
            id: 'char-creator-upload',
            title: '选择部件图',
            description: '上传透明 PNG / WebP；建议与捏人器原素材同尺寸、同锚点。',
            path: ['捏脸·开发', '追加部件', '选择部件图'],
            deepLink: link(AppID.CharCreatorDev, 'manual-char-creator-dev-root'),
          },
          {
            id: 'char-creator-tintable',
            title: '可换色',
            description: '仅当这张图适合被着色时勾选；彩色成品图通常不要勾。',
            path: ['捏脸·开发', '追加部件', '可换色'],
            deepLink: link(AppID.CharCreatorDev, 'manual-char-creator-dev-root'),
          },
        ],
      },
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
  '捏脸·开发': { appId: AppID.CharCreatorDev, path: ['桌面', '捏脸·开发'], details: ['开发调试模式下追加捏人器自定义部件。'], deepLink: link(AppID.CharCreatorDev, 'manual-char-creator-dev-root') },
};

export const flattenManualSettings = () =>
  MANUAL_ENTRIES.flatMap(entry =>
    (entry.settingSections || []).flatMap(section =>
      section.settings.map(setting => ({ entry, section, setting })),
    ),
  );
