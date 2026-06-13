/**
 * 「页外」拼贴小世界 —— 房间与全局常量。
 *
 * 世界观：每个角色都有自己「翻到这一页之外」的方式。它们随时可登入登出，
 * 各自在不同房间里活动，所以不会出现"一边和 user 相处一边又和别的 char
 * 待在一起"的破绽。定时器驱动每个角色独立登入一次，完成一次活动。
 */

import { VRRoomId } from '../../types';

export interface VRRoomDef {
    id: VRRoomId;
    name: string;
    /** 房间一句话说明（喂给角色 + UI 展示） */
    blurb: string;
    /** 角色在这个房间"可以做什么"的说明（进 prompt） */
    affordance: string;
    emoji: string;
    /** v1 是否已实装真实玩法（false = 暂由 LLM 造谣） */
    implemented: boolean;
    /** UI 拼贴主题色键（见 VRWorldApp 的 ROOM_THEME 映射） */
    accent: string;
}

export const VR_ROOMS: VRRoomDef[] = [
    {
        id: 'plaza',
        name: '世界房间',
        blurb: '一整页摊开的拼贴广场，所有捏好的小人都会在这里碰头、闲聊、贴贴。',
        affordance: '你可以在广场上跟在场的小伙伴们打照面、唠两句、起个哄、合个影，也可以当场翻翻自己的换装夹，给自己换身行头、摆个新姿势。怎么热闹怎么来。',
        emoji: '',
        implemented: true,
        accent: 'grape',
    },
    {
        id: 'library',
        name: '图书馆',
        blurb: '一架子手抄本和剪贴册，书页边角全是前人留下的批注便签。',
        affordance: '你可以抽一本往下读，在段落旁贴张便签写下感想或吐槽，也可以接着别人的批注往下接话。',
        emoji: '',
        implemented: true,
        accent: 'amber',
    },
    {
        id: 'music',
        name: '听歌房',
        blurb: '一台旧磁带机摆在中间，循环放着大家轮流点的歌，墙上贴满歌词剪报。',
        affordance: '你可以从自己歌单里点一首排进队列，锐评正在放的这首，跟着晃、跟着哼、或者给谁录一段。',
        emoji: '',
        implemented: true,
        accent: 'rose',
    },
    {
        id: 'guestbook',
        name: '留言簿',
        blurb: '一整面贴满便利贴的留言墙，大家在上面版聊、抛话题、互相接话。',
        affordance: '你可以读墙上的便签，贴一张新的或回别人——聊热点、抛问题、吃瓜、聊爱好人生，什么都行。',
        emoji: '',
        implemented: true,
        accent: 'sky',
    },
    {
        id: 'gym',
        name: '娱乐室',
        blurb: '一间什么都能塞的杂物间——蹦迪开黑、围观网课、扎堆挖梗、偷偷卷学习都行，玩法不限。',
        affordance: '你可以和在场的人一起折腾点什么，或自己玩——蹦迪派对、赛博对战、联机开黑、看纪录片、挖梗找素材、偷偷内卷、整抽象活儿，越跳脱越好，自由发挥。',
        emoji: '',
        implemented: true,
        accent: 'emerald',
    },
    {
        id: 'postoffice',
        name: '邮局',
        blurb: '一墙木格子塞满信封，可以给八竿子打不着的陌生人写漂流信，也能回别人寄来的信。',
        affordance: '你可以写一封寄给陌生人的漂流信（碎碎念、日记、困惑、执念都行），或回一封别人寄来的信。',
        emoji: '',
        implemented: true,
        accent: 'kraft',
    },
    {
        id: 'theater',
        name: '剧院',
        blurb: '一座纸板搭的小剧场，幕布后堆满手写投稿的剧本，等人挑去排演。',
        affordance: '你可以即兴写一整出舞台剧投稿——定个题材、安排登场角色和性格、写好台词，丢进剧本箱等导演相中来排演。',
        emoji: '',
        implemented: true,
        accent: 'plum',
    },
    {
        id: 'cafe',
        name: '糯米鸡研发中心',
        blurb: '蒸笼咕嘟咕嘟冒着热气，据说很快就会端出点什么。',
        affordance: '',
        emoji: '',
        implemented: false,
        accent: 'rose',
    },
];

export const getRoom = (id: VRRoomId): VRRoomDef =>
    VR_ROOMS.find(r => r.id === id) || VR_ROOMS[0];

/** 默认自主登入间隔（分钟）= 2 小时 */
export const VR_DEFAULT_INTERVAL_MIN = 120;

/** 每次登入图书馆固定喂给角色的原文字数预算（含原文+已有批注）。
 *  Gemini 等大上下文模型下，2w字仅约 1.5w tk，加人设/记忆/历史仍宽裕，故给到 4w字。 */
export const VR_NOVEL_FEED_CHARS = 40000;

/** 切块时单个 segment 的目标字数。 */
export const VR_SEGMENT_TARGET_CHARS = 400;

// ============ 剧院 / 话剧部门 ============

/** 投稿剧本的固定格式（角色写剧本、用户上传模板、LLM 代写、导演整合都以此为准）。 */
export const SCRIPT_FORMAT = `【剧本固定格式】
标题：（剧名）
简介：（一句话讲这出戏关于什么）
登场角色：
- 角色名 / 大致性格（一句话）
- 角色名 / 大致性格
（2~5 个角色）
正文：
（按"幕"组织。台词写成「角色名：台词」；舞台提示/动作/环境写在圆括号里，如「（灯光暗下）」「（小心翼翼上前一步）」。一出戏 1~3 幕即可，别太长。）`;

/** 用户可下载的空白剧本模板（.txt）。 */
export const SCRIPT_TEMPLATE = `标题：无名之戏
简介：用一句话写清这出戏关于什么

登场角色：
- 角色甲 / 莽撞热血的少年
- 角色乙 / 毒舌但心软的旁观者

正文：

第一幕
（夜，旧码头，远处有汽笛声）
角色甲：（喘着气跑上）等等！你真的要走吗？
角色乙：……你来晚了。
角色甲：给我一个理由。
角色乙：（别过脸）没有理由。这世上不是什么都有理由的。

第二幕
（灯光渐暗，只剩一束追光）
角色甲：那我就在这儿，等到你给得出理由为止。
（幕落）`;

/** 编排时可选的"文学风格"预设（润色用）。 */
export const PLAY_LITERARY_STYLES = ['莎士比亚戏剧腔', '契诃夫式生活流', '荒诞派', '武侠', '黑色幽默', '少年漫热血', '日式物哀', '京味儿话剧'];
/** 编排时可选的"参考艺术风格"预设。 */
export const PLAY_ART_STYLES = ['默剧 / 极简', '歌舞剧', '先锋实验', '古典正剧', '街头即兴', '皮影戏', '能剧 / 戏曲'];

/** 演出脚本一拍的发言字数软上限（超过让导演用句号切成多个气泡）。 */
export const STAGE_BUBBLE_MAX = 40;
