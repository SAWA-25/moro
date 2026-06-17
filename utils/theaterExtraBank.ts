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
 *    - kind  决定它出现在哪个分类下（见下方 ExtraBankKind 的 8 个值）。
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
    // —— 示例问卷 1：照着往下加题即可 ——
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

    // —— 示例问卷 2 ——
    '深夜灵魂拷问': [
        '你最近一次真正放声大笑是什么时候？',
        '有没有一件事，你一直没敢告诉任何人？',
        '如果明天就是世界末日，你今晚会去做什么？',
        '你最怕变成什么样的大人？',
        '你觉得现在的自己，对得起小时候的自己吗？',
        '有没有一个人，你到现在都没能好好说再见？',
        '你最近一次为别人撒的善意谎言是什么？',
        '夜里睡不着的时候，你的脑子里一般在想什么？',
    ],

    // —— 在这里继续加你的问卷 ——
    // '你的问卷名': [
    //     '第一题…',
    //     '第二题…',
    // ],
};


// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ 二、番外指令库 (Extra Instructions)                                        ║
// ║   你列举的一条条「番外灵感/指令」。番外工坊 & 仿真图文里：                   ║
// ║     · 芯片点一下 → 把 instruction 填进输入框；                              ║
// ║     · 『从指令库随机挑一条』→ 系统从你这份列表里替你选一条。                 ║
// ╚══════════════════════════════════════════════════════════════════════════╝

/**
 * 番外指令适用的分类（对应番外里的 8 个 tab）：
 *  番外工坊：tieba(贴吧帖) / chatlog(聊天记录) / meme(热梗) / custom(自定义)
 *  仿真图文：wechat(微信) / moments(朋友圈) / xhs(小红书) / forum(匿名论坛)
 */
export type ExtraBankKind = 'tieba' | 'chatlog' | 'meme' | 'custom' | 'wechat' | 'moments' | 'xhs' | 'forum';

export interface ExtraInstruction {
    /** 出现在哪个分类下（见上 8 个值）。 */
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

    // —— 自定义（通用：什么番外都行）——
    { kind: 'custom', label: '如果是现代上班族', instruction: '写一段番外：如果 TA 生活在现代、是个普通上班族，TA 的一天会是怎样' },
    { kind: 'custom', label: '十年后重逢', instruction: '写一段番外：十年后我和 TA 在某个意想不到的地方重逢' },

    // —— 微信聊天 ——
    { kind: 'wechat', label: '深夜报备', instruction: '深夜报备：今天发生的事、想你了，藏着没说出口的在意' },
    { kind: 'wechat', label: '吵架冷战', instruction: '一次别扭的吵架冷战，谁也不肯先低头，但其实都在等对方先开口' },

    // —— 朋友圈 ——
    { kind: 'moments', label: '含蓄秀恩爱', instruction: '一条含蓄到不行的秀恩爱朋友圈，配图 + 评论区一群人起哄' },

    // —— 小红书 ——
    { kind: 'xhs', label: '深扒我对象', instruction: '以「深扒我对象」为主题写一篇小红书，标题党 + 细节 + 评论催更' },

    // —— 匿名论坛 ——
    { kind: 'forum', label: '吃瓜·关于 TA 的瓜', instruction: '开个匿名吃瓜帖，多层跟帖深扒 TA 和我之间的瓜' },

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
