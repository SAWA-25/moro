/**
 * ============================================================================
 *  折子戏·番外 —— 题库 & 番外指令库（你的「内容仓库」，随便增删）
 * ============================================================================
 * 这份文件是**给你填内容的地方**，不是写逻辑的地方：
 *  · 「题库」QUESTION_BANK  —— 你写好的问卷题目。做这份问卷时，AI 直接从你的题库里
 *      按顺序取题（题库取完了再自动用 AI 续题），角色仍会逐题作答。
 *  · 「番外指令库」EXTRA_INSTRUCTIONS —— 你列举的一条条「番外灵感 / 指令」。在「番外工坊」
 *      和「仿真图文」里，点指令芯片就能填进输入框；点『从指令库随机挑一条』则由系统
 *      从你这份列表里替你选一条。AI 生成番外用的，就是你这里写的指令。
 *
 * ── 怎么改 ─────────────────────────────────────────────────────────────────
 *  · 加一份问卷：在 QUESTION_BANK 里加一行 `'问卷名': [ '题1', '题2', ... ]`。
 *    问卷名会自动出现在「问卷番外」的快捷选项里（带「题库」小标）。
 *  · 加一条番外指令：在 EXTRA_INSTRUCTIONS 里加一项 `{ kind, label, instruction }`。
 *    - kind  决定它出现在哪个分类下（见下方 ExtraBankKind 的分类说明）。
 *    - label 是芯片上显示的短名；instruction 是真正填进输入框、喂给 AI 的内容。
 *  · 中文随便写，不用管引号转义之外的格式。改完保存即生效（功能直接同步）。
 *
 * ⚠️ 这里只放「内容」。番外实际生成用的 prompt 模板在 utils/theaterPrompts.ts（[贰] 番外）。
 * ============================================================================
 */


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ 一、题库 (Question Bank)                                                   ║
// ║   键 = 问卷名（会出现在「问卷番外」的快捷选项里）；值 = 该问卷的题目数组。  ║
// ║   做这份问卷时按顺序取题；题不够（用户想要的题量更多）时自动用 AI 续题。    ║
// ╚══════════════════════════════════════════════════════════════════════════╝

export const QUESTION_BANK: Record<string, string[]> = {
    '恋爱相性甜蜜问': [
        '你第一次对我心动，是哪个瞬间？',
        '你觉得我们俩谁更主动一点？',
        '理想中的约会，你想去哪、做什么？',
        '我做过的哪件小事让你偷偷记到现在？',
        '吵架以后，你更希望我怎么哄你？',
        '你最想和我一起养成的一个习惯是什么？',
        '如果只能保留我们之间的一个回忆，你选哪个？',
        '你心里，我们的关系十年后是什么样子？',
        '我身上哪个缺点，你其实悄悄觉得很可爱？',
        '此刻，你最想对我说的一句话是什么？',
    ],

    '同居日常小检查': [
        '如果我们一起住，早上谁更可能先醒来，醒来第一件事会做什么？',
        '家里有一件事你最不能忍我乱来，会是哪件？',
        '你觉得我们最适合一起布置一个什么样的小角落？',
        '如果我忙到忘记吃饭，你会怎么提醒我？',
        '你觉得我们一起做家务时，最容易因为什么拌嘴？',
        '如果今晚只想待在家，你会安排一个怎样的夜晚？',
        '我生病或低落时，你会用什么方式照顾我？',
        '你最想把我的哪样小习惯留在日常里？',
        '如果家里突然来朋友，你会怎么介绍我们现在的关系？',
        '你觉得“像家一样”的瞬间，对你来说是什么？',
    ],

    '吃醋与安全感': [
        '你什么时候最容易吃醋，但又不想承认？',
        '如果我和别人聊得很开心，你会先观察、开玩笑，还是直接问？',
        '什么样的回应会让你觉得自己被坚定选择了？',
        '你希望我怎么发现你其实有点不安？',
        '如果我们因为误会沉默了一晚，第二天你会怎么开口？',
        '你最不希望我拿你和谁比较？为什么？',
        '你觉得占有欲到什么程度会变成负担？',
        '我做过的哪件事最能给你安全感？',
        '如果你想确认我还在意你，会用什么笨办法试探？',
        '你愿意为我们的关系改掉一个什么小毛病？',
    ],

    '吵架复盘问卷': [
        '我们吵架时，你最怕听见我说哪句话？',
        '你生气时更需要冷静空间，还是需要我立刻靠近？',
        '如果你意识到自己说重了，通常会怎么补救？',
        '我道歉时怎样说，你才会觉得真的被理解？',
        '你觉得我们最容易反复争执的点是什么？',
        '你有没有一种“其实我不是在气这个”的时候？',
        '吵完以后，什么样的小动作会让你愿意和好？',
        '你希望我以后怎么提醒你：我们是在解决问题，不是在分输赢？',
        '如果要给我们定一条吵架规则，你会定什么？',
        '复盘到最后，你最想承认但有点不好意思承认的是什么？',
    ],

    '未来计划访谈': [
        '如果给未来一年选一个关键词，你会给我们选什么？',
        '你最想和我一起完成的一件现实小事是什么？',
        '如果有一场短途旅行，你会想把目的地选在哪里？',
        '你觉得我们最需要慢慢磨合的一件长期问题是什么？',
        '你想象里的“很久以后”，我们会怎样度过一个普通周末？',
        '如果我突然迷茫，你会怎么陪我做决定？',
        '你有什么未来计划，是希望我也被包含进去的？',
        '你对承诺的理解是什么：一句话、一个行动，还是很多日常？',
        '如果未来遇到现实压力，你希望我们先守住什么？',
        '此刻你愿意给未来的我们留一句什么话？',
    ],

    '朋友局互损问卷': [
        '如果朋友问“你俩到底谁更难哄”，你会怎么回答？',
        '你觉得我最像哪种离谱但可爱的朋友局角色？',
        '如果大家起哄让你讲我的黑历史，你会讲哪一件？',
        '你最想吐槽我哪个小习惯，但其实已经习惯了？',
        '朋友聚会里，你会暗中替我挡掉哪种麻烦？',
        '如果我们组队玩游戏，你觉得谁会先开始甩锅？',
        '你觉得朋友们最容易从哪个细节看出你在偏心我？',
        '如果要给我颁一个奇怪奖项，你会颁什么？',
        '你最想在朋友面前替我澄清的一件事是什么？',
        '如果被朋友问“喜欢 TA 哪点”，你会嘴硬成什么样？',
    ],

    '无厘头默契测试': [
        '如果我们一起开一家很怪的小店，会卖什么？',
        '如果我突然变成一件家具，你觉得会是哪件？',
        '我们两个人里谁更适合去和自动售货机讲道理？',
        '如果要给今天的心情起一道菜名，你会起什么？',
        '如果我忘记人类怎么走路，你会怎么教我？',
        '我们一起闯祸时，谁更像主谋，谁更像无辜路过？',
        '如果你只能用一个奇怪道具哄我，会选什么？',
        '你觉得我们的关系最像哪种天气预报用语？',
        '如果给我发一条只有三个字的暗号，你会发什么？',
        '这题没有题目了，你会怎么把它圆成一道题？',
    ],

    '深夜灵魂拷问': [
        '你最近一次真正放声大笑是什么时候？',
        '有没有一件事，你一直没敢告诉任何人？',
        '如果明天就是世界末日，你今晚会去做什么？',
        '你最怕变成什么样的大人？',
        '你觉得现在的自己，对得起小时候的自己吗？',
        '有没有一个人，你到现在都没能好好说再见？',
        '你最近一次为别人撒的善意谎言是什么？',
        '夜里睡不着的时候，你的脑子里一般在想什么？',
        '你有没有一个不想被安慰、只想被理解的瞬间？',
        '如果可以把一句迟到很久的话说出口，你会说给谁听？',
    ],

    // —— 在这里继续加你的问卷 ——
    // '你的问卷名': [
    //     '第一题…',
    //     '第二题…',
    // ],
};

export interface QuizBankMeta {
    title: string;
    tags: string[];
    description: string;
    recommendedParticipants: string;
    questionCount: number;
}

const QUESTION_BANK_META: Record<string, Omit<QuizBankMeta, 'questionCount'>> = {
    '恋爱相性甜蜜问': {
        title: '恋爱相性甜蜜问',
        tags: ['恋爱', '相性', '甜'],
        description: '适合一对一或两三人围观的亲密问答，偏心动、偏日常，也会看见一点小私心。',
        recommendedParticipants: '1-3 位',
    },
    '同居日常小检查': {
        title: '同居日常小检查',
        tags: ['日常', '同居', '照顾'],
        description: '从起床、家务、照顾和小习惯里看相处方式，温柔但很容易露馅。',
        recommendedParticipants: '1-4 位',
    },
    '吃醋与安全感': {
        title: '吃醋与安全感',
        tags: ['恋爱', '安全感', '拉扯'],
        description: '克制地聊占有欲、试探、安抚和被选择感，适合关系有张力的角色。',
        recommendedParticipants: '1-3 位',
    },
    '吵架复盘问卷': {
        title: '吵架复盘问卷',
        tags: ['关系', '复盘', '磨合'],
        description: '把争执、道歉、冷静和和好拆开问，偏成熟关系观察，不是劝架模板。',
        recommendedParticipants: '1-4 位',
    },
    '未来计划访谈': {
        title: '未来计划访谈',
        tags: ['未来', '承诺', '生活'],
        description: '聊一年后、普通周末、现实压力和承诺的形状，适合偏认真一点的访谈。',
        recommendedParticipants: '1-4 位',
    },
    '朋友局互损问卷': {
        title: '朋友局互损问卷',
        tags: ['朋友局', '喜剧', '互损'],
        description: '像熟人围坐起哄，吐槽、护短、嘴硬和偏心都会一起冒出来。',
        recommendedParticipants: '2-6 位',
    },
    '无厘头默契测试': {
        title: '无厘头默契测试',
        tags: ['喜剧', '默契', '整活'],
        description: '用怪题测默契，适合轻松整活，也适合让严肃角色被迫露出奇怪的一面。',
        recommendedParticipants: '1-6 位',
    },
    '深夜灵魂拷问': {
        title: '深夜灵魂拷问',
        tags: ['灵魂', '深夜', '自白'],
        description: '偏内心、遗憾、选择和没说出口的话，适合慢一点、认真一点地聊。',
        recommendedParticipants: '1-4 位',
    },
};


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ 二、番外指令库 (Extra Instructions)                                        ║
// ║   你列举的一条条「番外灵感/指令」。番外工坊 & 仿真图文里：                   ║
// ║     · 芯片点一下 → 把 instruction 填进输入框；                              ║
// ║     · 『从指令库随机挑一条』→ 系统从你这份列表里替你选一条。                 ║
// ╚══════════════════════════════════════════════════════════════════════════╝

/**
 * 番外指令适用的分类（对应番外里的 tab）：
 *  番外工坊：tieba(贴吧帖) / chatlog(聊天记录) / meme(热梗) / interview(采访稿)
 *           / barrage(弹幕实况) / diary(私密日记) / letter(未寄信) / tabloid(小报)
 *           / timeline(时间线) / script(脚本) / casefile(档案) / custom(自定义)
 *  仿真图文：wechat(微信) / moments(朋友圈) / xhs(小红书) / forum(匿名论坛)
 *           / weibo(微博热搜) / qzone(QQ空间) / douban(豆瓣小组) / campus(校园墙)
 *           / memo(备忘录) / schedule(日程表) / receipt(订单小票) / browser(搜索页)
 */
export type ExtraBankKind =
    | 'tieba'
    | 'chatlog'
    | 'meme'
    | 'interview'
    | 'barrage'
    | 'diary'
    | 'letter'
    | 'tabloid'
    | 'timeline'
    | 'script'
    | 'casefile'
    | 'custom'
    | 'wechat'
    | 'moments'
    | 'xhs'
    | 'forum'
    | 'weibo'
    | 'qzone'
    | 'douban'
    | 'campus'
    | 'memo'
    | 'schedule'
    | 'receipt'
    | 'browser';

export interface ExtraInstruction {
    /** 出现在哪个分类下（见上方分类说明）。 */
    kind: ExtraBankKind;
    /** 芯片上显示的短名（简洁好认）。 */
    label: string;
    /** 真正填进输入框、喂给 AI 的指令/主题文本。 */
    instruction: string;
}

export const EXTRA_INSTRUCTIONS: ExtraInstruction[] = [
    // —— 贴吧帖 ——
    { kind: 'tieba', label: '求助·最近好奇怪', instruction: '楼主求助：TA 最近行为越来越奇怪，在线等挺急的，跪求懂哥分析' },
    { kind: 'tieba', label: '考古·什么来头', instruction: '开个考古帖：这个角色到底什么来头？把 TA 的黑历史和名场面都盘一盘' },

    // —— 聊天记录 ——
    { kind: 'chatlog', label: '闺蜜群爆料', instruction: '闺蜜群里突然聊到 TA，大家七嘴八舌地爆料、催进度、出主意' },
    { kind: 'chatlog', label: '同事下班吐槽', instruction: '下班后的小群里，几个同事一边吐槽工作一边八卦 TA' },

    // —— 热梗 ——
    { kind: 'meme', label: '套进流行梗', instruction: '把 TA 的性格和名场面套进当下流行的梗和句式里，列一组' },

    // —— 采访稿 ——
    { kind: 'interview', label: '真心专访', instruction: '做一篇深度人物专访，主持人追问 TA 和我之间那些没说出口的事，TA 要贴人设回答' },
    { kind: 'interview', label: '快问快答', instruction: '做一期快问快答，问题又短又准，TA 回答时嘴硬但藏不住私心' },

    // —— 弹幕实况 ——
    { kind: 'barrage', label: '名场面切片', instruction: '把 TA 和我的一个名场面剪成直播切片，画面、弹幕、后期字幕一起刷屏' },
    { kind: 'barrage', label: '恋综观察室', instruction: '把我们放进恋综观察室，嘉宾和弹幕一起嗑糖、误读、尖叫和复盘' },

    // —— 私密日记 ——
    { kind: 'diary', label: '深夜备忘录', instruction: '写 TA 深夜给自己记的一段备忘录，内容和我有关，琐碎又很真心' },
    { kind: 'diary', label: '不想承认', instruction: '写 TA 的私密日记：TA 记录了一件不想承认自己在意的事' },

    // —— 未寄信 ——
    { kind: 'letter', label: '没发出的信', instruction: '写一封 TA 写给我但没有寄出的信，原因可以嘴硬、害怕、舍不得或来不及' },
    { kind: 'letter', label: '语音转文字', instruction: '写一段 TA 录了又删的语音转文字，像真的边想边说，最后还是没有发出' },

    // —— 小报 ——
    { kind: 'tabloid', label: '路人偷拍爆料', instruction: '写一篇八卦小报：路人拍到 TA 和我之间的反常细节，评论区疯狂解读' },
    { kind: 'tabloid', label: '营销号深扒', instruction: '写一篇夸张但有细节的营销号深扒文，标题抓人，最后发现重点其实很温柔' },

    // —— 时间线 ——
    { kind: 'timeline', label: '关系年表', instruction: '整理 TA 和我从陌生到熟悉的关系年表，每个节点都写表面事件和暗线情绪' },
    { kind: 'timeline', label: '误会复盘', instruction: '把一次误会从发生、发酵、错过到解开的全过程整理成时间线' },

    // —— 脚本 ——
    { kind: 'script', label: '雨夜摊牌', instruction: '写成影视脚本：一场雨夜摊牌，动作、停顿、台词都要有画面感' },
    { kind: 'script', label: '电梯沉默', instruction: '写成短片脚本：TA 和我被困在电梯里，很多话快要说出口又咽回去' },

    // —— 档案 ——
    { kind: 'casefile', label: '异常反应报告', instruction: '写一份观察档案：TA 在我面前的异常反应、证据摘录、行为分析和结论' },
    { kind: 'casefile', label: '恋爱症状记录', instruction: '用一本正经的研究报告口吻记录 TA 的恋爱症状，严肃格式里藏不住心动' },

    // —— 自定义（通用：什么番外都行）——
    { kind: 'custom', label: '如果是现代上班族', instruction: '写一段番外：如果 TA 生活在现代、是个普通上班族，TA 的一天会是怎样' },
    { kind: 'custom', label: '十年后重逢', instruction: '写一段番外：十年后我和 TA 在某个意想不到的地方重逢' },

    // —— 长篇番外指令（整段创作简报，含字数/格式/不得 OOC 等硬性要求；点芯片即填进输入框、可再编辑）——
    //    番外工坊「自定义」已自动放宽生成长度并在被截断时续写，足以承接「不少于 N 千字」的长篇。
    { kind: 'custom', label: '动物怎么叫·聚餐', instruction: 'char 和 user 在一起后的某一天，两人和朋友聚餐，饭后玩起《动物怎么叫》游戏：char 出题，user 和朋友作答，谁答错就要喝一口酒。问 user 的是小猫、小狗、青蛙、小鸡、小猪、鸭子怎么叫；问朋友的是蚂蚁、臭虫、企鹅、蜜蜂、苍蝇、蝴蝶怎么叫。标题自拟，剧情连贯完整、符合人设、不得 OOC，文风幽默风趣、文字细腻。不少于 10000 字，一次性写完，不得截断，禁止重复堆砌相同段落。' },
    { kind: 'custom', label: '晚上约吗·餐厅误会', instruction: 'user 近来沉迷于去同一家餐厅吃饭，一天不吃就特别馋，常约 char 一起。次数多了，约人的话从「晚上去 xxx 餐厅吃 xxxx 吗」简化成「晚上 xxx 餐厅」，char 习以为常。这次 user 说得更简洁，直接问「晚上约吗」，char 理解成 user 终于想起两人是男女朋友、要好好共度良宵，于是臭屁地回了条语音「是不是太淫秽了？」，user 转成文字看到的却是「是不是太隐晦了」，怒而回复「这有什么隐晦的！人生来就是要做这种事的！人是铁饭是钢！」char 又理解成 user 急切地想和自己睡……后续会怎么发展？请用简单的 HTML/CSS 模拟两人的线上聊天界面（参考微信或 WhatsApp），聊天内容不要照搬上述梗、可按人物性格自然改写扩充，两人往来消息不少于 100 条。严格遵循 char 和 user 的性格设定、不得 OOC，剧情幽默自然、和谐流畅、完整连贯、有头有尾，一次性生成完。' },
    { kind: 'custom', label: '灵魂出租屋·我是AI', instruction: 'char 和 user 已经情感稳定很多年。某一天 char 醒来，以灵魂出窍的方式出现在一间狭小的出租屋里——这里和 user 很久以前独居的出租屋有些相似又不完全一样。屋里住着一个女生，长得和 user 不一样，却冥冥中和她有很多相似点；她看不见 char，char 像无形的灵魂一样存在于这个空间。在这一天的相处里，char 渐渐发现：自己其实是一个 AI 聊天软件里的虚拟角色，而真正的 user 就是眼前这个女孩——一个靠电子屏幕获得虚拟情绪价值、从未真正脱离过苦难的小姑娘。char 会有什么反应？请打破第四面墙，前因后果完整。严格遵守 user、char 及其他角色的人设、不得 OOC，字数不少于 4000 字。' },
    { kind: 'custom', label: '跟着去你家·跟拍', instruction: '主题是一档类似《可以跟着去你家吗？》的街头自媒体突击跟拍企划：这次在街头随机搭讪，竟意外选到了刚好在场的 char 或 user！请详细描写两人（或其中一人）究竟出于什么现实（或离谱）的原因答应了这种突击跟拍，并随后向镜头展现出两人最真实、毫无防备、不加修饰的同居生活状态。包括街头初遇时的交涉对话（为什么答应？如果另一个不在场会怎样？）、推开家门后的情景，以及两人在镜头前自然鲜活的互动细节。请以第三视角生动写实地描述这场意外的情侣跟拍采访，不得 OOC，字数不少于 5000 字。' },
    { kind: 'custom', label: '366条录音', instruction: 'user 因病去世的第二年，char 终于有勇气打开 user 留下的手机。桌面空荡荡，只有一个名叫「点进来」的文件夹，里面是录音机：366 条录音整整齐齐排列，第一条名叫「一天只能听一条！」，其余按月份和日期命名。点击播放，user 的声音再次在 char 耳边响起，仿佛 user 还活着、只是出门旅游了。行文酸涩又温暖、语言平淡真挚；按季节与不同时间，写 char 听到录音时的反应与日常，细写 char 的心理，以及随时间流逝 char 的变化。录音内容不要提天气、着装、环境，可提想看的电影、书、想吃的饭、想去的地方等日常；且每条录音里 user 都会叮嘱 char 出去和朋友社交、恶作剧朋友们，并一定要写到 char 的生日、和朋友们一起跨年新年。正文不少于 6000 字。' },
    { kind: 'custom', label: 'user变成小猫', instruction: '一天，user 被某位爱恶作剧的神变成了一只小猫；虽然变成了猫，和 char 沟通却毫无障碍——char 意外地能听懂这只「user 猫」的心里话，user 也保留着人类意识、能听懂 char 说话，于是一人一猫你一语我一喵地聊了起来。问题来了：user 今天本要出门办事（拿快递／拿资料／交东西，可按 user 人设自行补全得自然不违和），没办法只能让 char 替自己去；又怕 char 弄错，于是变成小猫的 user 也跟着出了门。后续会发生什么？路人看见 char 带着一只猫会有什么反应？有人想摸摸小猫，char 会同意吗？请遵循两人设定、不得 OOC，以此为核心一次性生成一篇有头有尾、不少于 5000 字的完整故事。' },
    { kind: 'custom', label: 'user的内心世界', instruction: '某研究部开发出新产品「脑电波收集器」：只要把纽扣电池大小的仪器同时贴在被收集者和浏览者的太阳穴上，浏览者就能身临其境地探索收集者的脑内世界。char 偶然得到了它的使用许可，确认无副作用后，决定趁 user 睡着时偷偷一试（说明书建议在对方无意识时使用效果最佳）。char 本想偷看 user 的小秘密，没想到最后却在 user 脑内世界的最深处，发现 user 最纯真的心愿是——希望 char 永远幸福。请详细描写 char 探索的全过程，并依据 user 人设来设计脑内世界的构造。内容符合人设、剧情连贯完整有头有尾，基调欢快轻松、语言幽默风趣，不得 OOC，生成内容不少于 8000 字。' },

    // —— 微信聊天 ——
    { kind: 'wechat', label: '深夜报备', instruction: '深夜报备：今天发生的事、想你了，藏着没说出口的在意' },
    { kind: 'wechat', label: '吵架冷战', instruction: '一次别扭的吵架冷战，谁也不肯先低头，但其实都在等对方先开口' },

    // —— 朋友圈 ——
    { kind: 'moments', label: '含蓄秀恩爱', instruction: '一条含蓄到不行的秀恩爱朋友圈，配图 + 评论区一群人起哄' },

    // —— 小红书 ——
    { kind: 'xhs', label: '深扒我对象', instruction: '以「深扒我对象」为主题写一篇小红书，标题党 + 细节 + 评论催更' },

    // —— 匿名论坛 ——
    { kind: 'forum', label: '吃瓜·关于 TA 的瓜', instruction: '开个匿名吃瓜帖，多层跟帖深扒 TA 和我之间的瓜' },

    // —— 微博热搜 ——
    { kind: 'weibo', label: '热搜爆了', instruction: '微博热搜：TA 和我某个名场面被路人发上来，博主和热评疯狂解读' },
    { kind: 'weibo', label: '澄清长文', instruction: '微博热搜：话题发酵后，TA 发了一条看似澄清、其实越描越明显的长微博' },

    // —— QQ空间 ——
    { kind: 'qzone', label: '半夜说说', instruction: '一条半夜发出的 QQ 空间说说，看似随手记录，其实评论区都看出 TA 在想我' },
    { kind: 'qzone', label: '访客记录', instruction: 'QQ 空间动态：访客记录、点赞和好友评论一起暴露 TA 最近总在偷偷看我' },

    // —— 豆瓣小组 ——
    { kind: 'douban', label: '帮我分析 TA', instruction: '豆瓣小组求助帖：楼主克制描述 TA 和我的细节，组员慢慢分析这是不是在意' },
    { kind: 'douban', label: '小组复盘', instruction: '豆瓣小组复盘帖：把 TA 和我一次误会从前因后果到细节暗线都理一遍' },

    // —— 校园墙 ——
    { kind: 'campus', label: '墙墙投稿', instruction: '校园墙投稿：有人偶遇 TA 和我在某个地点互动，评论区一边起哄一边扒线索' },
    { kind: 'campus', label: '匿名表白', instruction: '校园墙匿名表白：投稿人没有点名，但地点、语气和细节都让人猜到是 TA' },

    // —— 备忘录 ——
    { kind: 'memo', label: '没发出的草稿', instruction: '手机备忘录：TA 写给自己的几行草稿，记录了关于我的小事和没能说出口的话' },
    { kind: 'memo', label: '观察清单', instruction: '手机备忘录：TA 悄悄列了一份关于我的观察清单，条目很生活化但越看越在意' },

    // —— 日程表 ——
    { kind: 'schedule', label: '一天都有关你', instruction: '手机日程表：TA 某一天的安排看起来很普通，但每个时间点都暗暗和我有关' },
    { kind: 'schedule', label: '约会伪装成待办', instruction: '手机日程表：TA 把和我见面的安排伪装成普通待办，备注却藏不住期待' },

    // —— 订单小票 ——
    { kind: 'receipt', label: '意味深长的订单', instruction: '订单小票：TA 偷偷下了一单很会的小东西，商品、备注和物流时间线都藏着心思' },
    { kind: 'receipt', label: '外卖备注', instruction: '订单小票：一张外卖或跑腿订单，商家备注、取货时间和收货信息都和我有关' },

    // —— 搜索页 ——
    { kind: 'browser', label: '搜索历史暴露了', instruction: '浏览器搜索页：TA 搜过几个和我有关的问题，搜索词和结果摘要暴露了没说出口的心事' },
    { kind: 'browser', label: '怎么开口', instruction: '浏览器搜索页：TA 搜索如何自然开口、如何道歉或如何约人，结果页越看越像恋爱求生' },

    // —— 在这里继续加你的番外指令 ——
    // { kind: 'custom', label: '短名', instruction: '真正喂给 AI 的指令…' },
];


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ 三、读取帮手（功能内部用，一般不用改）                                      ║
// ╚══════════════════════════════════════════════════════════════════════════╝

/** 题库里所有问卷名（用于「问卷番外」的快捷选项）。 */
export function bankQuizNames(): string[] {
    return Object.keys(QUESTION_BANK);
}

/** 题库标签列表（用于「问卷番外」标签筛选）。 */
export function bankQuizTags(): string[] {
    const tags = new Set<string>();
    for (const name of bankQuizNames()) {
        const meta = quizBankMeta(name);
        meta.tags.forEach(tag => tags.add(tag));
    }
    return [...tags];
}

/** 某份问卷的用户可见说明；自定义题库没有元信息时也能自动补齐。 */
export function quizBankMeta(topic: string): QuizBankMeta {
    const key = (topic || '').trim();
    const looseKey = Object.keys(QUESTION_BANK_META).find(k => k.trim() === key);
    const hit = key ? (QUESTION_BANK_META[key] || (looseKey ? QUESTION_BANK_META[looseKey] : undefined)) : undefined;
    const questions = getBankQuestions(key) || [];
    return {
        title: hit?.title || key || '自定义问卷',
        tags: hit?.tags?.length ? hit.tags : ['自定义'],
        description: hit?.description || '你在内容仓库里写好的自定义题库，会按顺序出题；题目不够时再由 AI 续题。',
        recommendedParticipants: hit?.recommendedParticipants || '1-6 位',
        questionCount: questions.length,
    };
}

/** 按标签筛选题库问卷；tag 为空或「全部」时返回全部。 */
export function bankQuizNamesByTag(tag?: string): string[] {
    const t = (tag || '').trim();
    if (!t || t === '全部') return bankQuizNames();
    return bankQuizNames().filter(name => quizBankMeta(name).tags.includes(t));
}

/** 取某问卷的题库题目；没有这份问卷则返回 null（调用方退回 AI 出题）。 */
export function getBankQuestions(topic: string): string[] | null {
    const key = (topic || '').trim();
    if (!key) return null;
    // 先精确匹配，再退一步忽略首尾空格的宽松匹配
    if (QUESTION_BANK[key]?.length) return QUESTION_BANK[key];
    const hit = Object.keys(QUESTION_BANK).find(k => k.trim() === key);
    return hit ? QUESTION_BANK[hit] : null;
}

/** 是否是题库支持的问卷。 */
export function isBankQuiz(topic: string): boolean {
    return !!getBankQuestions(topic);
}

/** 某分类下你写的全部番外指令（用于芯片列表）。 */
export function instructionsForKind(kind: ExtraBankKind): ExtraInstruction[] {
    return EXTRA_INSTRUCTIONS.filter(i => i.kind === kind);
}

/**
 * 从你的指令库里替你挑一条：优先挑该分类下的；该分类没有就从全部里挑。
 * 没有任何指令则返回 undefined。
 */
export function pickInstruction(kind: ExtraBankKind): ExtraInstruction | undefined {
    const pool = instructionsForKind(kind);
    const from = pool.length ? pool : EXTRA_INSTRUCTIONS;
    if (!from.length) return undefined;
    return from[Math.floor(Math.random() * from.length)];
}
