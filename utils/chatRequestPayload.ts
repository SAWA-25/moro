/**
 * 聊天请求载荷统一构造器
 *
 * 设计目标：让"正常聊天"、"主动消息"、"emotion 副 API 评估"三条路径吃到的
 * 上下文材料完全一致——区别只在末尾各自追加的"现在你要做什么"指令。
 *
 * 三条路径过去各拼一遍 system prompt + 消息历史，导致主动消息缺音乐共听 /
 * HTML 模式 / 双语模式 / 麦当劳小程序等块；emotion eval 也容易跟主路径分叉。
 * 现在统一从这里走，避免再分叉。
 *
 * 顺序严格对齐 useChatAI.ts 的现有实现（line 629–793），保证现有行为字节级
 * 等价。新增 caller（runProactive）只是补齐了过去缺的字段。
 */

import type { CharacterProfile, UserProfile, GroupProfile, Emoji, EmojiCategory, Message, RealtimeConfig, TranslationConfig } from '../types';
import { ChatPrompts } from './chatPrompts';
import { injectMemoryPalace } from './memoryPalace/pipeline';
import { buildHtmlPrompt } from './htmlPrompt';
import { buildThinkingChainPrompt } from './thinkingChainPrompt';
import { buildMcdMiniAppContextBlock } from './mcdToolBridge';
import type { McdMiniAppSnapshot } from './mcdToolBridge';
import type { MusicCfg, Song, LyricLine, MusicPlaybackSnapshot } from '../context/MusicContext';
import { isPromptBuildSkipped } from './devDebug';
import { renderMesExampleBlock } from './context';
import { WorldbookRuntime } from './worldbookRuntime';
import { PresetRuntime, applyPresetToMessages } from './presets';
import { setPresetRegexScripts } from './regex/store';
import { PersonaRuntime, normalizePersonaPosition } from './personas';
import { PERSONA_POSITION } from '../types';
import { substituteMacros } from './macros';
import { buildBlockPromptSection } from './blockSystem';

export interface UserListeningContext {
    songName: string;
    artists: string;
    lyricWindow: string[];
    activeIdx: number;
}

export interface BuildChatPayloadInput {
    char: CharacterProfile;
    userProfile: UserProfile;
    groups: GroupProfile[];
    emojis: Emoji[];
    categories: EmojiCategory[];
    /** 给 buildMessageHistory 用的完整历史（≤ contextLimit） */
    historyMsgs: Message[];
    /**
     * 给 buildSystemPrompt + memoryPalace 召回用的"较短近窗"。不传则等于 historyMsgs。
     * useChatAI 主路径里 React state 上限 200 条，DB 历史可能更长——保留这个区分。
     */
    recentMsgsHint?: Message[];
    contextLimit: number;
    /**
     * 额外的记忆召回提示词（拼进向量/BM25 检索的 context query）。
     * 用途：彼方等场景下，把"此刻在场的其他玩家名字 / 房间上下文"塞进召回 query，
     * 让角色能回忆起自己跟对面这些人的关系，而不是只按聊天历史召回。
     */
    recallQueryHint?: string;

    // 实时世界 / 角色情绪
    realtimeConfig?: RealtimeConfig;
    /** 上一轮 emotion eval 产出的内心独白 */
    innerState?: string;

    // user 共听上下文（非 React 调用方可传 musicSnapshot 让 helper 自动算）
    userListeningContext?: UserListeningContext | null;
    isListeningTogether?: boolean;
    musicCfg?: MusicCfg;
    /** 备选：传一份原始播放快照，helper 内部按主路径同样的逻辑算 listening 三件套 */
    musicSnapshot?: MusicPlaybackSnapshot | null;

    // 模式开关
    translationConfig?: TranslationConfig | { enabled: boolean; sourceLang: string; targetLang: string; style?: string };
    htmlMode?: { enabled: boolean; customPrompt?: string };
    thinkingChain?: { enabled: boolean; customPrompt?: string };
    mcdMiniSnap?: McdMiniAppSnapshot;
}

export interface BuildChatPayloadResult {
    /** 完整 system prompt（含所有可选块） */
    systemPrompt: string;
    /** 已剥离双语标签的历史消息（emotion eval 也吃这份） */
    cleanedApiMessages: Array<{ role: string; content: any }>;
    /** [system, ...cleanedApiMessages, 末尾 bilingual reminder?] —— 主 API 直接发这个 */
    fullMessages: Array<{ role: string; content: any }>;
    /** 调试用：bilingual / mcd 是否实际注入 */
    flags: {
        bilingualActive: boolean;
        mcdActive: boolean;
        htmlActive: boolean;
        thinkingActive: boolean;
        promptBuildSkipped: boolean;
    };
}

/**
 * 用 MusicPlaybackSnapshot 算 user 共听上下文 —— 与 useChatAI.ts:636–666 行为一致。
 */
function deriveListeningFromSnapshot(
    snap: MusicPlaybackSnapshot | null | undefined,
    charId: string,
): { userListeningContext: UserListeningContext | null; isListeningTogether: boolean; musicCfg?: MusicCfg } {
    if (!snap) return { userListeningContext: null, isListeningTogether: false };
    const { current, playing, lyric, activeLyricIdx, listeningTogetherWith, cfg } = snap;
    let userListeningContext: UserListeningContext | null = null;
    if (current && playing && lyric.length > 0) {
        const idx = activeLyricIdx;
        if (idx >= 0) {
            const from = Math.max(0, idx - 2);
            const to = Math.min(lyric.length, idx + 2 + 1);
            const window = lyric.slice(from, to).map((l: LyricLine) => l.text);
            const activeIdx = idx - from;
            userListeningContext = {
                songName: current.name,
                artists: current.artists,
                lyricWindow: window,
                activeIdx,
            };
        }
    } else if (current && playing) {
        userListeningContext = {
            songName: current.name,
            artists: current.artists,
            lyricWindow: [],
            activeIdx: -1,
        };
    }
    const isListeningTogether = !!(userListeningContext && listeningTogetherWith.includes(charId));
    return { userListeningContext, isListeningTogether, musicCfg: cfg };
}

function cleanApiMessages(apiMessages: Array<{ role: string; content: any }>): Array<{ role: string; content: any }> {
    return apiMessages.map((msg: any) => {
        if (typeof msg.content !== 'string') return msg;
        let c: string = msg.content;
        if (c.toLowerCase().includes('%%bilingual%%')) {
            const idx = c.toLowerCase().indexOf('%%bilingual%%');
            c = c.substring(0, idx).trim();
        }
        if (c.includes('<翻译>')) {
            c = c.replace(/<翻译>\s*<原文>([\s\S]*?)<\/原文>\s*<译文>[\s\S]*?<\/译文>\s*<\/翻译>/g, '$1').trim();
        }
        return { ...msg, content: c };
    });
}

/**
 * 构造完整 chat 请求载荷。顺序严格对齐 useChatAI.ts 现有实现：
 *
 *   1. injectMemoryPalace（向量召回挂到 char.memoryPalaceInjection）
 *   2. ChatPrompts.buildSystemPrompt（核心人设 + 实时 + 记忆 + 音乐 + 日程内心独白）
 *   3. += 双语指令
 *   4. += HTML 模式提示词
 *   5. += 思考链提示词（+ 用户额外要求）
 *   6. ChatPrompts.buildMessageHistory → apiMessages
 *   7. 剥离 apiMessages 里旧的双语标签 → cleanedApiMessages
 *   8. += 麦当劳小程序上下文（注意：在 6/7 之后追加到 systemPrompt）
 *   9. fullMessages = [system, ...cleanedApiMessages]
 *  10. fullMessages.push（末尾双语 reminder，不进 systemPrompt）
 *
 * emotion eval 应当吃 (systemPrompt, cleanedApiMessages) —— 与主 API 看到的完全一致。
 */
export async function buildChatRequestPayload(input: BuildChatPayloadInput): Promise<BuildChatPayloadResult> {
    const {
        char, userProfile, groups, emojis, categories, historyMsgs, contextLimit,
        realtimeConfig, innerState,
        translationConfig, htmlMode, thinkingChain, mcdMiniSnap,
    } = input;
    const recentMsgsHint = input.recentMsgsHint ?? historyMsgs;

    if (isPromptBuildSkipped()) {
        const { apiMessages } = ChatPrompts.buildMessageHistory(historyMsgs, contextLimit, char, userProfile, emojis);
        const cleanedApiMessages = cleanApiMessages(apiMessages);
        console.warn('[DevDebug] Prompt Build skipped: sending chat history without system prompt injection.');
        return {
            systemPrompt: '',
            cleanedApiMessages,
            fullMessages: [...cleanedApiMessages],
            flags: {
                bilingualActive: false,
                mcdActive: false,
                htmlActive: false,
                thinkingActive: false,
                promptBuildSkipped: true,
            },
        };
    }

    // ── 1. Memory Palace 向量召回 ─────────────────────────
    await injectMemoryPalace(char, recentMsgsHint, input.recallQueryHint, userProfile?.name);

    // ── 2. 解析音乐共听（如果 caller 没显式给，就从 snapshot 推） ──
    let userListeningContext = input.userListeningContext;
    let isListeningTogether = input.isListeningTogether;
    let musicCfg = input.musicCfg;
    if (userListeningContext === undefined && input.musicSnapshot !== undefined) {
        const derived = deriveListeningFromSnapshot(input.musicSnapshot, char.id);
        userListeningContext = derived.userListeningContext;
        isListeningTogether = derived.isListeningTogether;
        musicCfg = derived.musicCfg ?? musicCfg;
    }

    // ── 2.5 预设 + 人设 + 世界书关键词扫描上下文 ─────────────────
    // 预设要在 buildSystemPrompt 之前取：启用时核心上下文按 marker 拆分构建
    // （世界书 / 用户档案块单独产出，由预设的 worldInfo* / personaDescription
    // marker 决定位置与开关）。
    const activePreset = await PresetRuntime.getActivePreset();

    // 预设自带正则（PRESET 作用域）随激活预设进运行时缓存：聊天管线四个挂载点
    // （USER_INPUT / AI_OUTPUT / 组装 / 渲染）是同步的、取不到 async 预设，这里用
    // 已取到的 activePreset 把它的 regexScripts 推进缓存（歇业 / 无激活 → 清空）。
    setPresetRegexScripts(activePreset?.regexScripts ?? null);

    // 人设（SillyTavern Persona 移植）：激活时名字/头像/描述覆盖档案，
    // 描述按 position 语义落点（嵌入提示词 / @Depth / 不注入），
    // 绑定的世界书分组经 setExtraCategories 走世界书运行时统一注入。
    const activePersona = await PersonaRuntime.getActivePersona();
    const personaPosition = activePersona ? normalizePersonaPosition(activePersona.position) : PERSONA_POSITION.IN_PROMPT;
    const personaDesc = activePersona ? (activePersona.description || '').trim() : (userProfile?.bio || '').trim();
    // 描述进核心上下文 / personaDescription marker 的条件：无人设（沿用档案 bio）或位置=嵌入提示词
    const personaDescInPrompt = personaPosition === PERSONA_POSITION.IN_PROMPT;
    const effectiveUser = activePersona
        ? {
            ...userProfile,
            name: (activePersona.name || '').trim() || userProfile?.name || '用户',
            avatar: activePersona.avatar || userProfile?.avatar || '',
            bio: personaDescInPrompt ? personaDesc : '',
        }
        : userProfile;

    const macroCtx = {
        charName: char.name || '角色',
        userName: (effectiveUser?.name && effectiveUser.name.trim()) || '用户',
        personaDescription: personaDesc,
    };

    // 关键词扫描上下文（ST 世界书绿灯条目移植）：喂入最近消息文本，
    // activation='keyword' 的条目在本次构建中按命中结果决定是否注入。
    const scanTexts = historyMsgs
        .slice(-20)
        .map(m => (typeof (m as any).content === 'string' ? (m as any).content as string : ''))
        .filter(Boolean);
    WorldbookRuntime.setScanContext(scanTexts);
    // 人设世界书（=ST persona lorebook）：激活人设绑定的分组在本次构建中视同已挂载
    WorldbookRuntime.setExtraCategories(activePersona?.lorebookCategory ? [activePersona.lorebookCategory] : null);

    // ── 3. buildSystemPrompt 核心（+ 世界书分段，同一扫描上下文内完成） ──
    let systemPrompt = '';
    let depthSections!: ReturnType<typeof WorldbookRuntime.buildPromptSections>;
    try {
        // before/after/@Depth 分段在这里统一解析一次：@Depth 条目第 10 步插消息；
        // 预设启用时 before/after 块作为 marker 内容用，未启用时它们已内联在核心上下文里。
        depthSections = WorldbookRuntime.buildPromptSections(char, { inlineDepth: false });
        systemPrompt = await ChatPrompts.buildSystemPrompt(
            char, effectiveUser, groups, emojis, categories, recentMsgsHint,
            realtimeConfig, innerState || undefined,
            userListeningContext ?? null,
            !!isListeningTogether,
            musicCfg,
            /* omitDepthWorldbooks */ true,  // @Depth 世界书在第 10 步插成独立消息
            /* presetMarkerSplit */ !!activePreset,
        );
    } finally {
        WorldbookRuntime.setScanContext(null);
        WorldbookRuntime.setExtraCategories(null);
    }

    // ── 4. 双语指令注入 ───────────────────────────────────
    const bilingualActive = !!(translationConfig?.enabled && translationConfig.sourceLang && translationConfig.targetLang);
    if (bilingualActive && translationConfig) {
        const emojiAssociationEnabled = !!char.convoSettings?.emojiAssociation;
        systemPrompt += `\n\n[CRITICAL: 双语输出模式 - 必须严格遵守]
你的每句话都必须用以下XML标签格式输出双语内容：
<翻译>
<原文>${translationConfig.sourceLang}内容</原文>
<译文>${translationConfig.targetLang}内容</译文>
</翻译>

规则：
- 每句话单独包裹一个<翻译>标签
- 多句话就输出多个<翻译>标签，一句一个
- <翻译>标签外不要写任何文字
${emojiAssociationEnabled ? '- 表情包命令 [[SEND_EMOJI: ...]] 放在所有<翻译>标签外面\n' : ''}- 引用命令 [[QUOTE: ...]] 也放在所有<翻译>标签外面；引用内容请原样照抄用户说过的原文（不要翻译、不要包<翻译>标签）

示例（${translationConfig.sourceLang}→${translationConfig.targetLang}）：
<翻译>
<原文>こんにちは！</原文>
<译文>你好！</译文>
</翻译>
<翻译>
<原文>今日は何する？</原文>
<译文>今天做什么？</译文>
</翻译>`;
        // 会话设置「译文风格」：追加进双语指令
        const tStyle = (translationConfig as { style?: string }).style?.trim();
        if (tStyle) {
            systemPrompt += `\n- 译文风格要求：${tStyle}`;
        }
    }

    // ── 5. HTML 卡片模式 ─────────────────────────────────
    const htmlActive = !!htmlMode?.enabled;
    if (htmlActive) {
        systemPrompt += `\n\n${buildHtmlPrompt(htmlMode?.customPrompt)}`;
    }

    // ── 6. 思考链提示词 ───────────────────────────────────
    const thinkingActive = !!thinkingChain?.enabled;
    if (thinkingActive) {
        const userName = macroCtx.userName;
        systemPrompt += `\n\n${buildThinkingChainPrompt(char.name, userName)}`;
        const extra = (thinkingChain?.customPrompt || '').trim();
        if (extra) {
            systemPrompt += `\n\n## 用户对内心独白的额外要求\n${extra}`;
        }
    }

    // ── 6.5 拉黑系统状态 / 能力注入（私聊专用） ─────────────
    // 用户已拉黑角色 → 告知角色被拉黑；未拉黑且「拉黑保护」未开 → 授予 [[BLOCK_USER]] 能力
    const blockSection = buildBlockPromptSection(char, macroCtx.userName);
    if (blockSection) {
        systemPrompt += `\n\n${blockSection}`;
    }

    // ── 7. 历史消息构造 ───────────────────────────────────
    const { apiMessages } = ChatPrompts.buildMessageHistory(historyMsgs, contextLimit, char, effectiveUser, emojis);

    // ── 8. 剥离历史里旧的双语标签 ─────────────────────────
    const cleanedApiMessages = cleanApiMessages(apiMessages);

    // ── 9. 麦当劳小程序上下文（在 cleanedApiMessages 之后追加到 systemPrompt） ──
    const mcdActive = !!mcdMiniSnap?.open;
    if (mcdActive) {
        const block = buildMcdMiniAppContextBlock(mcdMiniSnap, macroCtx.userName);
        if (block) {
            systemPrompt += block;
        }
    }

    // ── 10. 组装 fullMessages + 末尾双语 reminder ─────────
    // 宏通用化（同 ST substituteParams）：人设 / 世界观 / 世界书 / 用户档案里写的
    // {{user}} {{char}} <user> <char> 在最终 system prompt 上统一替换一次。
    systemPrompt = substituteMacros(systemPrompt, macroCtx);

    let fullMessages: Array<{ role: string; content: any }> = [
        { role: 'system', content: systemPrompt },
        ...cleanedApiMessages,
    ];

    // @Depth 世界书条目：以指定 role 插到聊天历史的对应深度（同 ST 的 @D 语义）。
    // buildSystemPrompt 已用 omitDepthWorldbooks 跳过内联，这里是唯一注入点。
    // 分段在第 3 步的扫描上下文内解析（关键词条目已按命中过滤），内容做宏替换。
    const depthEntries = depthSections.depthEntries.map(e => ({
        ...e,
        content: substituteMacros(e.content, macroCtx),
    }));
    WorldbookRuntime.spliceDepthMessages(fullMessages, depthEntries);

    // 人设描述 @Depth 注入（position=4，同 ST persona_description_positions.AT_DEPTH）：
    // 以人设指定的 role 插到聊天历史对应深度。必须在预设骨架（第 11 步）之前 ——
    // applyPresetToMessages 会把 [system, ...history] 整段重排，深度消息要先进历史段。
    if (activePersona && personaPosition === PERSONA_POSITION.AT_DEPTH && personaDesc) {
        const rolePos = activePersona.role === 1 ? 'depth_user' as const
            : activePersona.role === 2 ? 'depth_assistant' as const
            : 'depth_system' as const;
        WorldbookRuntime.spliceDepthMessages(fullMessages, [{
            id: `persona-${activePersona.id}`,
            title: activePersona.name,
            category: '人设',
            scope: 'local',
            position: rolePos,
            depth: activePersona.depth ?? 2,
            order: 100,
            content: substituteMacros(personaDesc, macroCtx),
        }]);
    }

    // ── 11. 预设（SillyTavern 式）骨架 ───────────────────
    // 启用预设时把 [system, ...history] 重排成 prompt_order 定义的消息流：
    // 相对提示词按序展开、世界书 before/after 与用户档案块落到各自 marker 的
    // 位置（受 marker 开关控制）、核心上下文落在第一个启用的核心 marker、
    // 绝对提示词 @Depth 注入历史段。未启用时数组原样不动。注意要在双语
    // reminder 之前做，保证 reminder 始终钉在最末尾。
    // personaDescription marker 内容：嵌入提示词时带描述；@Depth / 不注入时只保留名字
    // （描述分别已插进历史 / 按 ST 语义彻底不发）。
    const personaBlock = `### 互动对象 (User)\n- 名字: ${macroCtx.userName}\n- 设定/备注: ${(personaDescInPrompt && personaDesc) ? personaDesc : '无'}`;
    // 对话示例块（mes_example）：预设启用时核心上下文已拆出（omitMesExample），
    // 在 dialogueExamples marker 的位置注入，受 marker 开关控制（ST 语义）。
    const mesExampleBlock = renderMesExampleBlock(char.mesExample);
    if (activePreset) {
        fullMessages = applyPresetToMessages(fullMessages, activePreset, {
            macros: macroCtx,
            markerContents: {
                worldInfoBefore: substituteMacros(depthSections.beforeChar, macroCtx),
                worldInfoAfter: substituteMacros(depthSections.afterChar, macroCtx),
                personaDescription: substituteMacros(personaBlock, macroCtx),
                dialogueExamples: substituteMacros(mesExampleBlock, macroCtx),
            },
        });
    }

    if (bilingualActive) {
        fullMessages.push({
            role: 'system',
            content: `[Reminder: 每句话必须用 <翻译><原文>...</原文><译文>...</译文></翻译> 标签包裹。一句一个标签。绝对不能省略。]`,
        });
    }

    // 思维链语言 reminder：钉在消息流最末尾（最高 salience）。reasoning 模型默认切
    // 英文的坏习惯，靠 system prompt 中段的「语言铁律」常压不住——末尾 reminder 是和
    // 上面双语 reminder 同样的兜底手法，紧贴生成位置，强制 thinking 跟随用户最近一条
    // 消息的语言。放在双语 reminder 之后 → thinking 语言指令成为整条流的最后一句。
    if (thinkingActive) {
        let lastUserText = '';
        for (let i = historyMsgs.length - 1; i >= 0; i--) {
            if (historyMsgs[i]?.role !== 'user') continue;
            const t = (historyMsgs[i].content || '').replace(/<[^>]+>/g, '').trim();
            if (t) { lastUserText = t; break; }
        }
        const hanCount = (lastUserText.match(/[一-鿿㐀-䶿豈-﫿]/g) || []).length;
        const latinCount = (lastUserText.match(/[A-Za-z]/g) || []).length;
        // 有中文且不弱于英文，或整条没拉丁字母 → 判中文（应用主受众为中文）
        const isZh = hanCount > 0 ? hanCount >= latinCount : latinCount === 0;
        fullMessages.push({
            role: 'system',
            content: isZh
                ? `[Reminder｜思维链语言（最高优先级）：你的 thinking / reasoning（<think> 标签内 / reasoning channel）必须从第一个字到最后一个字全程中文。绝对禁止默认切英文。哪怕句中有英文术语 / 代码 / 品牌名，原样嵌进中文即可，不要因此切语言。若 thinking 第一句冒出英文，立刻删掉用中文重写。]`
                : `[Reminder｜Thinking-channel language (highest priority): Your thinking / reasoning (inside <think> tags / reasoning channel) MUST be written in the SAME language as my latest message above, character for character. Do not default to another language. If the first sentence of your thinking comes out in the wrong language, delete it and rewrite it in the correct one.]`,
        });
    }

    // 预设接管时核心 systemPrompt 不含世界书 / 用户档案（它们以 marker 消息注入）。
    // 返回值的 systemPrompt 字段还有两个消费者 —— 情绪评估和 Dev 调试查看器 ——
    // 它们吃的是单块文本，这里把拆出去的块拼回去，保证两边看到的"材料"不缺。
    // fullMessages 不受影响（上面已按 marker 结构组装完）。
    if (activePreset) {
        systemPrompt = [
            substituteMacros(depthSections.beforeChar, macroCtx),
            systemPrompt,
            substituteMacros(depthSections.afterChar, macroCtx),
            substituteMacros(mesExampleBlock, macroCtx),
            substituteMacros(personaBlock, macroCtx),
        ].filter(s => s && s.trim()).join('\n\n');
    }

    return {
        systemPrompt,
        cleanedApiMessages,
        fullMessages,
        flags: { bilingualActive, mcdActive, htmlActive, thinkingActive, promptBuildSkipped: false },
    };
}
