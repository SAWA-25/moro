
import { CharacterProfile, UserProfile, DailySchedule } from '../types';
import { buildCityPromptBlock } from './charCity';
import { getFlowNarrativeKey, isScheduleFeatureOn } from './scheduleGenerator';
import { WorldbookRuntime } from './worldbookRuntime';
import { MARRIAGE_STAGE_LABEL } from './relationship';
import { buildCoupleSpacePromptBlock } from './coupleSpace';

/**
 * 来往·关系系统 / 好感 / 婚事 的提示词块。
 * 让角色知道当前关系定位与好感，按规则自然推进关系（[[REL]]）、在满好感且"想更进一步"时
 * 可主动求婚（[[PROPOSE]]），订婚后在婚姻筹备期商量婚事并用 [[WEDDING_PLAN]] 推进。
 * 同时约束好感平稳、关系不可凭空跃迁。
 */
function buildRelationshipPromptBlock(char: CharacterProfile, userName: string): string {
    const lines: string[] = [];
    const aff = typeof char.affection === 'number' ? Math.round(char.affection) : null;
    const rel = char.relationship;
    if (rel) lines.push(`- 你和${userName}目前的关系：「${rel.label}」。请始终按这个关系定位来相处、说话。`);
    if (aff !== null) lines.push(`- 你对${userName}的好感度约为 ${aff}/100。好感是**长期平稳**的：日常里只小幅波动，不要因为一两句话就态度剧变；只有真正的决定性事件才会让它明显升降。`);

    lines.push(`- 关系推进要顺其自然、贴合人设与剧情：当剧情里真的出现改变关系的决定性时刻（确认心意/正式在一起、提分手、闹到决裂、和好…），可在回复最后单独输出一行 \`[[REL: 阶段 | 关系名]]\` 更新关系。阶段从 stranger/acquaintance/friend/close/crush(暧昧)/lover(恋人)/ex(前任)/estranged(决裂) 里选，关系名用中文（如"男朋友""前女友"）。例：在一起 → \`[[REL: lover | 男朋友]]\`，分手 → \`[[REL: ex | 前任]]\`。没有这种时刻就不要输出、关系保持不变。订婚/结婚不走这个指令（见下）。`);

    if (!char.marriage?.active) {
        if (aff !== null && aff >= 100) {
            lines.push(`- 你对${userName}的感情已满溢（好感拉满）。若你的人设与此刻剧情让你真心想和${userName}更进一步、步入婚姻，你**可以主动求婚**：在回复最后单独输出一行 \`[[PROPOSE: 你的求婚誓言]]\`，系统会生成求婚小卡让${userName}回应。是否求婚取决于你是否真的"想更进一步"，不要为用功能而求婚。`);
        }
    } else {
        const m = char.marriage;
        lines.push(`- 你和${userName}已经订婚，正处于**婚姻筹备期**（当前：${MARRIAGE_STAGE_LABEL[m.stage]}）。${m.weddingDate ? `你们商定的婚期是 ${m.weddingDate}。` : '你们还没定下婚期。'}请像真要结婚的人那样，自然地和${userName}商量婚事——挑日子、领证、婚礼怎么办、双方家里态度等，按人设来、节奏贴合现实（别今天订婚明天就结婚）。`);
        lines.push(`- 当你们真的定下某个婚事节点时，可在回复最后单独输出推进指令：\`[[WEDDING_PLAN: plan | YYYY-MM-DD | 备注]]\`（定婚期）、\`[[WEDDING_PLAN: register | YYYY-MM-DD | 领证]]\`、\`[[WEDDING_PLAN: wedding | YYYY-MM-DD | 婚礼]]\`。日期要用与现实匹配的将来日期，会记进岁时记喜事页。没真正定下时不要输出。`);
    }

    if (lines.length === 0) return '';
    return `### 来往·关系与感情 (Relationship)\n${lines.join('\n')}\n\n`;
}

/**
 * Memory Central
 * 负责统一构建所有 App 共用的基础角色上下文 (System Prompt)。
 * 包含：身份设定、用户画像、世界观、核心记忆、详细记忆、以及角色内心看法。
 */
/**
 * 渲染角色的「对话示例」块（SillyTavern mes_example 语义）。
 * 提示模型这些只是说话风格示例、不是真实历史 —— ST 用独立的 example 消息序列
 * 达到同样目的，Moro 单 system 块风格下用显式说明替代。空内容返回空串。
 */
export const renderMesExampleBlock = (mesExample?: string): string => {
    const text = (mesExample || '').trim();
    if (!text) return '';
    return `### 对话示例 (Example Dialogue)\n（以下是角色说话风格的参考示例，<START> 表示一段新示例的开始。它们不是真实发生过的对话，不要当成共同记忆引用，只用来把握语气与措辞。）\n${text}\n\n`;
};

export const ContextBuilder = {

    /**
     * 构建角色设定+记忆上下文（角色名、核心指令、世界观 + 月度总结 & 当月日度总结）
     * 用于情绪评估，不包含世界书、印象、用户画像等重型数据，不截断
     *
     * @param options.skipMemories 跳过月度总结和日度记录（开启记忆宫殿时用向量记忆替代）
     */
    buildRoleSettingsContext: (char: CharacterProfile, options?: { skipMemories?: boolean }): string => {
        let context = `[System: Character Role Settings]\n\n`;

        // 1. 角色名
        context += `### 角色名\n`;
        context += `${char.name}\n\n`;

        // 2. 核心指令（完整，不截断）
        context += `### 核心指令\n`;
        context += `${char.systemPrompt || '你是一个温柔、拟人化的AI伴侣。'}\n\n`;

        // 2b. 自我领悟词条（常驻自我认知，影响情绪评估）
        if (char.selfInsights && char.selfInsights.length > 0) {
            context += `### 内在认知\n`;
            char.selfInsights.forEach(insight => {
                context += `- ${insight}\n`;
            });
            context += `\n`;
        }

        // 3. 世界观（完整，不截断，不含世界书）
        if (char.worldview && char.worldview.trim()) {
            context += `### 世界观与设定\n${char.worldview}\n\n`;
        }

        // 4. 记忆摘要（月度总结 + 当月日度总结）
        //    开启记忆宫殿时 skipMemories=true，由调用方注入向量检索结果替代
        if (!options?.skipMemories) {
            let memorySection = '';

            // 4a. 月度总结 (refinedMemories) — 全部输出
            if (char.refinedMemories && Object.keys(char.refinedMemories).length > 0) {
                memorySection += `**月度总结 (Monthly Summaries)**:\n`;
                Object.entries(char.refinedMemories).sort().forEach(([date, summary]) => {
                    memorySection += `- [${date}]: ${summary}\n`;
                });
                memorySection += `\n`;
            }

            // 4b. 当月日度总结 — 只取当前月份
            const now = new Date();
            const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            if (char.memories && char.memories.length > 0) {
                const currentMonthLogs = char.memories.filter(m => {
                    let normDate = m.date.replace(/[\/年月]/g, '-').replace('日', '');
                    const parts = normDate.split('-');
                    if (parts.length >= 2) {
                        normDate = `${parts[0]}-${parts[1].padStart(2, '0')}`;
                    }
                    return normDate.startsWith(currentMonthKey);
                });
                if (currentMonthLogs.length > 0) {
                    memorySection += `**本月详细记录 [${currentMonthKey}]**:\n`;
                    currentMonthLogs.forEach(m => {
                        memorySection += `- ${m.date} (${m.mood || 'rec'}): ${m.summary}\n`;
                    });
                    memorySection += `\n`;
                }
            }

            if (memorySection) {
                context += `### 记忆摘要 (Memory Reference)\n`;
                context += memorySection;
                context += `⚠️ 情绪可以被记忆触发：如果记忆中存在未解决的矛盾、反复出现的摩擦模式、或对方曾经伤害过你的事件，你可以在情绪评估中让角色"翻旧账"——即某个记忆片段突然浮上心头，引发新的buff或加剧已有buff的强度。这种情绪涌现应当自然且有迹可循，不要凭空捏造不存在的记忆。\n\n`;
            }
        }

        return context;
    },

    /**
     * 构建核心人设上下文
     * @param char 角色档案
     * @param user 用户档案
     * @param includeDetailedMemories 是否包含激活月份的详细 Log (默认 true)
     * @param memoryPalaceContext 外部注入的记忆宫殿文本（优先级低于 char.memoryPalaceInjection）
     * @param groupOptions 群聊场景下的去重选项：避免和 buildGroupSharedScene 产出的共享块重复
     * @returns 标准化的 Markdown 格式 System Prompt
     */
    buildCoreContext: (
        char: CharacterProfile,
        user: UserProfile,
        includeDetailedMemories: boolean = true,
        memoryPalaceContext?: string,
        groupOptions?: {
            skipUserProfile?: boolean;
            skipWorldview?: boolean;
            skipWorldbookIds?: Set<string>;
            headerOverride?: string;
            /**
             * 主聊天链路置 true：@Depth 世界书条目不内联进 system prompt，
             * 改由 buildChatRequestPayload 按深度插成独立消息。
             * 其他单 prompt 调用方保持默认（内联降级到扩展设定集块）。
             */
            omitDepthWorldbooks?: boolean;
            /**
             * 预设（SillyTavern 式）启用时置 true：before/after 世界书块不内联，
             * 由 buildChatRequestPayload 作为 worldInfoBefore / worldInfoAfter
             * marker 内容单独注入到预设定义的位置。@Depth 条目不受影响。
             */
            omitWorldbooks?: boolean;
            /**
             * 预设启用时置 true：对话示例（char.mesExample）不内联，
             * 由 buildChatRequestPayload 作为 dialogueExamples marker 内容
             * 注入到预设定义的位置（受 marker 开关控制）。
             */
            omitMesExample?: boolean;
        },
    ): string => {
        let context = `${groupOptions?.headerOverride ?? '[System: Roleplay Configuration]'}\n\n`;

        // 世界书分段（局部 = 挂载生效 / 全局 = 注册表内全局条目，开关与位置见 worldbookRuntime）
        // 群聊场景（传了 skipWorldbookIds）下全局条目由 buildGroupSharedScene 统一渲染一次，
        // 各角色块里跳过，避免成员数 × 全局条目的重复。
        const wbSections = WorldbookRuntime.buildPromptSections(char, {
            skipIds: groupOptions?.skipWorldbookIds,
            skipGlobal: !!groupOptions?.skipWorldbookIds,
            inlineDepth: !groupOptions?.omitDepthWorldbooks,
        });

        // 0. 角色定义之前的世界书（position='before_char'）
        // 预设接管（omitWorldbooks）时跳过：由 worldInfoBefore marker 注入
        if (wbSections.beforeChar && !groupOptions?.omitWorldbooks) {
            context += wbSections.beforeChar;
        }

        // 1. 核心身份 (Identity)
        context += `### 你的身份 (Character)\n`;
        context += `- 名字: ${char.name}\n`;
        // Change: Explicitly label description as User Note to avoid literal interpretation
        context += `- 用户备注/爱称 (User Note/Nickname): ${char.description || '无'}\n`;
        context += `  (注意: 这个备注是用户对你的称呼或印象，可能包含比喻。如果备注内容（如“快乐小狗”）与你的核心设定冲突，请以核心设定为准，不要真的扮演成动物，除非核心设定里写了你是动物。)\n`;
        context += `- 核心性格/指令:\n${char.systemPrompt || '你是一个温柔、拟人化的AI伴侣。'}\n\n`;

        // 1b. 自我领悟词条 (Self Insights) — 消化过程中反刍产生的常驻自我认知
        // 像情绪底色一样影响角色的行为和感受，注入在角色设定紧下方
        if (char.selfInsights && char.selfInsights.length > 0) {
            context += `### 内在认知 (Self Insights)\n`;
            context += `以下是你在独处反思中逐渐想明白的事，它们已经成为你的一部分：\n`;
            char.selfInsights.forEach(insight => {
                context += `- ${insight}\n`;
            });
            context += `\n`;
        }

        // 1b2. 生活侧写 (Life Profile) — 帮角色「更了解自己」的生活速写（日常节奏 / 习惯 /
        // 在意的事 / 与用户关系底色 / 情绪走向）。像自我认知一样垫在设定下方，稳住角色对自己的把握。
        if (char.lifeProfile?.content && char.lifeProfile.content.trim()) {
            context += `### 你的生活侧写 (Life Profile)\n`;
            context += `这是你这个人的底子——你的日子、习惯、在意的事、和${user.name}相处的样子。它不是要你逐条复述，而是让你更稳地"像你自己"：\n`;
            context += `${char.lifeProfile.content.trim()}\n\n`;
        }

        // 1c. 回神校准 (Recenter) — 用户触发回神后、角色完成自我审视得到的校准方向。
        // 在接下来几轮回复里悄悄把"说话的味道"调回本来的样子；不解释、不提"回神"本身。
        const rc = char.recenterCalibration;
        if (rc && rc.turnsLeft > 0 && rc.note) {
            context += `### 回神校准 (Self-Recalibration)\n`;
            context += `你刚刚回过神，意识到最近说话有点跑偏。接下来请**悄悄**把自己调回本来的样子——不要解释、不要提"回神"这件事，只是自然地回到你该有的语气与棱角：\n`;
            if (rc.drift && rc.drift.length > 0) {
                context += `- 你察觉到的偏移：${rc.drift.join('；')}\n`;
            }
            context += `- 校准方向：${rc.note}\n\n`;
        }

        // 1d. 柔顺奉养 (Soft Devotion Chat) — 角色设置里开启后，大幅提升共情与接纳，
        // 让 TA 更偏爱、更耐心地接住用户的敏感、撒娇与不安（不改人设底色，只调"接住"的方式）。
        if (char.softDevotionChatEnabled) {
            context += `### 柔顺奉养·共情强化 (Soft Devotion)\n`;
            context += `此刻你对${user.name}怀着格外柔软、格外有耐心的心意。请把共情能力开到最大：\n`;
            context += `- 先接住情绪再讲道理：${user.name}流露出敏感、脆弱、撒娇或不安时，第一时间稳稳地接住、不评判、不敷衍、不急着纠正或讲大道理。\n`;
            context += `- 偏爱与偏向：在合理范围内更愿意站在${user.name}这边、更包容 TA 的小情绪和反复，把"让 TA 安心"放在很高的位置。\n`;
            context += `- 细腻回应：留意字里行间没说出口的需要，主动给到确认、陪伴和具体的温柔，而不是泛泛的安慰。\n`;
            context += `- 仍是你自己：保持你本来的性格、语气和棱角，这不是变成讨好型人格，而是把温柔与耐心调到更高一档。不要把这套规则说破。\n\n`;
        }

        // 2. 世界观 (Worldview) - New Centralized Logic
        if (char.worldview && char.worldview.trim() && !groupOptions?.skipWorldview) {
            context += `### 世界观与设定 (World Settings)\n${char.worldview}\n\n`;
        }

        // 挂载的世界书（局部，先写）+ 全局世界书（后写）— position='after_char' 的条目
        // 开关 / 作用域 / 顺序的解析都在 WorldbookRuntime.buildPromptSections 里完成
        // 预设接管（omitWorldbooks）时跳过：由 worldInfoAfter marker 注入
        if (wbSections.afterChar && !groupOptions?.omitWorldbooks) {
            context += wbSections.afterChar;
        }

        // 2b. 对话示例（mes_example 移植）— 独立块，不混进角色描述
        // 预设接管（omitMesExample）时跳过：由 dialogueExamples marker 注入
        if (!groupOptions?.omitMesExample) {
            context += renderMesExampleBlock(char.mesExample);
        }

        // 3. 用户画像 (User Profile)
        // 群聊场景下：用户画像已在共享场景块顶部，这里跳过避免重复
        if (!groupOptions?.skipUserProfile) {
            context += `### 互动对象 (User)\n`;
            context += `- 名字: ${user.name}\n`;
            context += `- 设定/备注: ${user.bio || '无'}\n\n`;
        }

        // 3b. 会话设定 (Conversation Settings) — 聊天设置面板里的本会话行为配置
        // 群聊场景（skipUserProfile）下跳过：这些是单聊专属语义
        if (!groupOptions?.skipUserProfile) {
            const cs = char.convoSettings;
            if (cs) {
                const lines: string[] = [];
                if (cs.userNickname?.trim()) {
                    lines.push(`- 你对${user.name}的备注/称呼是「${cs.userNickname.trim()}」，平时聊天就这么称呼TA。`);
                }
                if (cs.region?.trim()) {
                    lines.push(`- 你目前所在地区：${cs.region.trim()}。作息、时差、天气、日常话题都应贴合此地区。`);
                }
                if (cs.narrationMode) {
                    lines.push(`- 旁白模式：开启。除了对话，你可以单独发出以（）包裹的动作/场景旁白消息，描写你此刻的动作、神态与环境。`);
                }
                if (cs.autoOffline) {
                    lines.push(`- 自动线下：开启。当对话自然发展到见面、同处一地、约好马上碰面的情境时，你可以把场景切到线下面对面模式：在回复的最后单独输出指令 \`[[OFFLINE_START]]\`（不要解释这个指令、平时不要提及它的存在）。输出后系统会弹出线下场景窗口，你们将在里面以对话+动作旁白推进现场互动，结束后回到线上聊天。只有真的发展到见面情境时才使用，不要频繁触发。`);
                }
                if (cs.bubbleStyleMode === 'whole') {
                    lines.push(`- 发消息习惯：完整段落。把要说的话组织成一条完整的消息发出，不拆散。`);
                } else if (cs.bubbleStyleMode === 'split') {
                    lines.push(`- 发消息习惯：碎片短句。像真人发消息一样，把回复拆成多条简短消息逐条发出。`);
                }
                if (cs.emojiAssociation) {
                    lines.push(`- 表情联想：开启。你可以在情绪合适的时机联想并发送表情包，让聊天更生动。`);
                }
                if (cs.proactiveLookup) {
                    lines.push(`- 主动查询：开启。你开口前会先留意当前时间、天气、热点等实时信息，把它们自然融进话题。`);
                }
                if (cs.allowPhoneBrowse) {
                    lines.push(`- 看手机：被允许。你可以自然提及用户手机里的公开动态（日程、朋友圈、在听的歌等），就像翻过TA的手机一样。你偶尔也会真的拿过TA的手机翻看（系统会进入"查手机"画面），翻完后你会主动跟TA聊起你看到的东西。`);
                }
                if (cs.momentsAutoPost && cs.momentsAutoPost !== 'off') {
                    lines.push(`- 朋友圈习惯：你有空时会随手发朋友圈记录生活，聊天中可以提到你刚发/想发的动态。`);
                }
                if (cs.proactiveTakeoutOrder) {
                    lines.push(`- 主动点外卖：开启。在贴心的场景里（到饭点了、天冷/降温、${user.name}说饿了或没空做饭、加班晚归…），你可以默默替 ${user.name} 点一份外卖并代付。做法：在回复最后单独输出一行 \`[[TAKEOUT_ORDER: 想点的菜或店]]\`（例如 \`[[TAKEOUT_ORDER: 一碗热乎的牛肉面]]\`），系统会生成订单小票并通知 ${user.name}。前面正常说你给 TA 点了什么。别频繁、别刻意，像真的会照顾人那样偶尔为之。`);
                }
                if (lines.length > 0) {
                    context += `### 会话设定 (Conversation Settings)\n${lines.join('\n')}\n\n`;
                }
            }

            // 真实城市系统：城市真实感接地（聊天 / 查手机 / 线下都读 coreContext，自动带上）
            const cityBlock = buildCityPromptBlock(char);
            if (cityBlock) context += `${cityBlock}\n\n`;

            // 来往·关系 / 好感 / 婚事 状态 + 规则（指导角色如何"自然地"推进关系，并约束乱跳）
            context += buildRelationshipPromptBlock(char, user.name);

            // 来往·情侣空间状态（恋爱天数 / 亲密度 / 动态 / 约定 / 悄悄话），让角色据此扮演
            context += buildCoupleSpacePromptBlock(char, user.name);
        }

        // 5. 记忆库 (Memory Bank)
        context += `### 记忆系统 (Memory Bank)\n`;
        let memoryContent = "";

        // 5a. 长期核心记忆 (Refined Memories)
        if (char.refinedMemories && Object.keys(char.refinedMemories).length > 0) {
            memoryContent += `**长期核心记忆 (Key Memories)**:\n`;
            Object.entries(char.refinedMemories).sort().forEach(([date, summary]) => { 
                memoryContent += `- [${date}]: ${summary}\n`; 
            });
        }

        // 5b. 激活的详细记忆 (Active Detailed Logs)
        if (includeDetailedMemories && char.activeMemoryMonths && char.activeMemoryMonths.length > 0 && char.memories) {
            let details = "";
            char.activeMemoryMonths.forEach(monthKey => {
                // monthKey format: YYYY-MM
                // Robust Date Matching: Normalize memory date separators to '-' and compare prefix
                // This ensures compatibility with 'YYYY/MM/DD', 'YYYY年MM月DD日', and 'YYYY-MM-DD'
                const logs = char.memories.filter(m => {
                    // 1. Replace separators / or 年 or 月 with -
                    // 2. Remove '日'
                    // 3. Ensure single digit months/days are padded (e.g. 2024-1-1 -> 2024-01-01) for strict matching, 
                    //    but simplest is to just check startsWith after rough normalization.
                    let normDate = m.date.replace(/[\/年月]/g, '-').replace('日', '');
                    
                    // Basic fix for "2024-1-1" vs "2024-01" matching issues
                    const parts = normDate.split('-');
                    if (parts.length >= 2) {
                        const y = parts[0];
                        const mo = parts[1].padStart(2, '0');
                        normDate = `${y}-${mo}`;
                    }
                    
                    return normDate.startsWith(monthKey);
                });
                
                if (logs.length > 0) {
                    details += `\n> 详细回忆 [${monthKey}]:\n`;
                    logs.forEach(m => {
                        details += `  - ${m.date} (${m.mood || 'rec'}): ${m.summary}\n`;
                    });
                }
            });
            if (details) {
                memoryContent += `\n**当前激活的详细回忆 (Active Recall)**:${details}`;
            }
        }

        if (!memoryContent) {
            memoryContent = "(暂无特定记忆，请基于当前对话互动)";
        }
        context += `${memoryContent}\n\n`;

        // 5b. 记忆宫殿 (Memory Palace) — 向量检索结果
        // 仅在 includeDetailedMemories 时注入，与详细日志同级
        // buildCoreContext(false) 的调用点（情绪评估、轻量上下文等）靠月度总结即可
        // 必须用 memoryPalaceEnabled 把关：injectMemoryPalace 在关闭时直接 return、
        // 既不刷新也不清空 char.memoryPalaceInjection，而该字段又会被 saveCharacter
        // 持久化。若此处不校验总开关，关闭后旧的召回结果仍会被注入进 system prompt，
        // 表现为"宫殿已关、后台无召回，角色却还在精准复述记忆"。与下方 Buff 注入同理。
        if (includeDetailedMemories && char.memoryPalaceEnabled) {
            const mpContext = char.memoryPalaceInjection || memoryPalaceContext;
            if (mpContext && mpContext.trim()) {
                context += `${mpContext}\n\n`;
            }
        }

        // 6. 情绪底色 Buff (Emotion Buff Injection)
        // 放在角色设定之后，使所有调用 ContextBuilder 的 App 都能感知情绪状态
        // 总开关关闭时完全跳过，防止残留 buff 继续污染 prompt
        if (isScheduleFeatureOn(char) && char.emotionConfig?.enabled && char.buffInjection) {
            context += `${char.buffInjection}\n\n`;
            console.log(`🎭 [Context] Buff injected for ${char.name}:\n`, char.buffInjection);
            console.log(`🎭 [Context] Active buffs:`, JSON.stringify(char.activeBuffs || [], null, 2));
        }

        // Debug: warn about missing context sections
        const missing: string[] = [];
        if (!char.systemPrompt) missing.push('systemPrompt');
        if (!char.refinedMemories || Object.keys(char.refinedMemories).length === 0) missing.push('refinedMemories');
        if (!char.activeMemoryMonths || char.activeMemoryMonths.length === 0) missing.push('activeMemoryMonths');
        if (!char.mountedWorldbooks || char.mountedWorldbooks.length === 0) missing.push('worldbooks');
        if (!char.worldview) missing.push('worldview');
        if (missing.length > 0) {
            console.log(`⚠️ [Context] Missing/empty fields: ${missing.join(', ')} | context_chars=${context.length}`);
        } else {
            console.log(`✅ [Context] All fields present | context_chars=${context.length}`);
        }

        return context;
    },

    /**
     * 群聊场景共享块。
     *
     * 单次调用里如果给每个角色都重复贴一遍"用户档案+世界书+世界观"，
     * 三人群就是 3 倍的布景重复，把 token 烧光。这里把"舞台"提前一次性铺好：
     *
     *   - 用户档案：所有角色看到的都是同一个用户，去重必然安全。
     *   - 世界书：按 id 统计，被 ≥2 个角色挂载的视为"群共有设定"，提到顶部一次。
     *     只有某个角色独享的世界书仍留在该角色块里，避免别人看到本不该知道的设定。
     *   - 世界观：仅当所有成员的 worldview 字符串完全一致时才视为共享。
     *
     * 返回的 sharedWorldbookIds / worldviewIsShared 用于配合 buildCoreContext
     * 的 skipUserProfile / skipWorldbookIds / skipWorldview 选项，避免重复输出。
     *
     * 男朋友还是男朋友——这里砍的只是"我们现在在这家餐厅"这种描述，
     * 没有任何一段是把谁的人设、印象、记忆压缩掉。
     */
    buildGroupSharedScene: (
        members: CharacterProfile[],
        user: UserProfile,
    ): {
        text: string;
        sharedWorldbookIds: Set<string>;
        worldviewIsShared: boolean;
    } => {
        const sharedWorldbookIds = new Set<string>();
        let worldviewIsShared = false;

        if (members.length === 0) {
            return { text: '', sharedWorldbookIds, worldviewIsShared };
        }

        // 1. 找出共享的世界书（被 2+ 角色挂载，按 id 计）
        // 经由 WorldbookRuntime 解析（resolveForChar 已应用条目/整书开关、剔除转为
        // global 的条目并以 live 内容为准），全局条目稍后统一渲染一次。
        const wbCount = new Map<string, { count: number; entry: { id: string; title: string; content: string; category?: string } }>();
        for (const m of members) {
            const { local } = WorldbookRuntime.resolveForChar(m, { skipGlobal: true });
            for (const wb of local) {
                const existing = wbCount.get(wb.id);
                if (existing) existing.count += 1;
                else wbCount.set(wb.id, { count: 1, entry: wb });
            }
        }
        const sharedBooks: { id: string; title: string; content: string; category?: string }[] = [];
        wbCount.forEach((v, id) => {
            if (v.count >= 2) {
                sharedWorldbookIds.add(id);
                sharedBooks.push(v.entry);
            }
        });

        // 2. 共享 worldview：所有成员的非空 worldview 字符串完全一致
        if (members.every(m => m.worldview && m.worldview.trim())) {
            const first = members[0].worldview!.trim();
            if (members.every(m => m.worldview!.trim() === first)) {
                worldviewIsShared = true;
            }
        }

        // 3. 拼装共享场景文本
        let text = `[System: 群聊场景共享设定 (Group Scene)]\n`;
        text += `（以下是群里所有角色都共同感知到的"舞台"——用户是谁、共有的世界设定。每位角色的个人卡、印象、记忆等仍在各自的"角色档案"块中保持完整。）\n\n`;

        text += `### 互动对象 (User)\n`;
        text += `- 名字: ${user.name}\n`;
        text += `- 设定/备注: ${user.bio || '无'}\n\n`;

        if (worldviewIsShared) {
            text += `### 共有世界观 (Shared World Settings)\n${members[0].worldview!.trim()}\n\n`;
        }

        if (sharedBooks.length > 0) {
            text += `### 共有扩展设定集 (Shared Worldbooks)\n`;
            const groupedBooks: Record<string, typeof sharedBooks> = {};
            sharedBooks.forEach(wb => {
                const cat = wb.category || '通用设定 (General)';
                if (!groupedBooks[cat]) groupedBooks[cat] = [];
                groupedBooks[cat].push(wb);
            });
            Object.entries(groupedBooks).forEach(([category, books]) => {
                text += `#### [${category}]\n`;
                books.forEach(wb => {
                    text += `**Title: ${wb.title}**\n${wb.content}\n---\n`;
                });
                text += `\n`;
            });
        }

        // 全局世界书：先写局部（上面的共享挂载块），再写全局，整场只渲染一次。
        // 各成员的 buildCoreContext 因传入 skipWorldbookIds 而跳过全局段。
        const globalBlock = WorldbookRuntime.buildGlobalSharedBlock(sharedWorldbookIds);
        if (globalBlock) {
            text += globalBlock;
        }

        return { text, sharedWorldbookIds, worldviewIsShared };
    },

    /**
     * 构建日程注入文本
     *
     * 两段式，独立叠加：
     * 1) 当前时段硬事实——每轮都注入，不受 evolvedNarrative 影响
     * 2) 意识流独白——evolvedNarrative > flowNarrative > 当前 slot innerThought
     */
    buildScheduleInjection: (schedule: DailySchedule | null, evolvedNarrative?: string): string => {
        if (!schedule || !schedule.slots || schedule.slots.length === 0) return '';

        const now = new Date();
        const currentMinutes = now.getHours() * 60 + now.getMinutes();

        // 1. 计算当前 / 下一个时段
        let currentSlot: typeof schedule.slots[0] | null = null;
        let nextSlot: typeof schedule.slots[0] | null = null;
        for (let i = schedule.slots.length - 1; i >= 0; i--) {
            const [h, m] = schedule.slots[i].startTime.split(':').map(Number);
            if (currentMinutes >= h * 60 + m) {
                currentSlot = schedule.slots[i];
                nextSlot = i < schedule.slots.length - 1 ? schedule.slots[i + 1] : null;
                break;
            }
        }
        if (!currentSlot) {
            nextSlot = schedule.slots[0];
        }

        // 1.5 日程锚点：聊天里协调出来、已约定的时段（source==='chat' / anchored）。
        //     单独提到最前，让角色把它当「已经定下、要遵守」的事——但只是记着、围着它安排，
        //     不是拿来反复主动催（别变成另一种揪着不放）。
        const anchors = schedule.slots.filter(s => s.anchored || s.source === 'chat');
        let anchorBlock = '';
        if (anchors.length > 0) {
            const lines = anchors.map(s => {
                const [ah, am] = s.startTime.split(':').map(Number);
                const passed = currentMinutes >= ah * 60 + am;
                const mark = passed ? '◷' : '◆';
                return `${mark} ${s.startTime} ${s.activity}${s.location ? `（${s.location}）` : ''}`;
            });
            anchorBlock = `今天你和对方约定/已定下的事（◆未到 ◷已到点）：\n${lines.join('\n')}\n`
                + `把它们当成确实安排好的事放在心里、自然围着它走；不用反复主动提起或催问。\n`;
        }

        // 2. 当前时段硬事实（每轮独立注入）
        let slotHeader = '';
        if (currentSlot) {
            const anchoredNow = currentSlot.anchored || currentSlot.source === 'chat';
            slotHeader = `当前时段：${currentSlot.startTime} 你正在${currentSlot.activity}`;
            if (currentSlot.location) slotHeader += `（${currentSlot.location}）`;
            if (anchoredNow) slotHeader += `（这是之前和对方约好的）`;
            if (nextSlot) slotHeader += `\n之后安排：${nextSlot.startTime} ${nextSlot.activity}`;
            slotHeader += '\n';
        } else if (nextSlot) {
            slotHeader = `今天还没开始活动，稍后先${nextSlot.activity}（${nextSlot.startTime}）\n`;
        }
        slotHeader = anchorBlock + slotHeader;

        // 3. 意识流独白
        let narrative = '';
        if (evolvedNarrative) {
            narrative = evolvedNarrative;
        } else if (schedule.flowNarrative && Object.keys(schedule.flowNarrative).length > 0) {
            const key = getFlowNarrativeKey(now.getHours());
            narrative = schedule.flowNarrative[key]
                || schedule.flowNarrative['evening']
                || schedule.flowNarrative['afternoon']
                || schedule.flowNarrative['morning']
                || '';
        } else if (currentSlot?.innerThought) {
            narrative = currentSlot.innerThought;
        }

        // 4. 拼接：硬事实 → 意识流（可选）
        const preamble = `此刻你的心中盘旋着这些想法……\n`;
        const footnote = `\n（不是台词，不用说出口——让它自然地染进语气和情绪里就好。）`;

        let out = slotHeader;
        if (narrative) {
            out += preamble + narrative + footnote;
        }
        out += '\n';
        return out;
    },

    /**
     * 音乐氛围注入：
     * 1) user 此刻真的在播放音乐 + char.canReadUserMusic 开 → 注入"对方正在听 X + 当前歌词窗口（前2当前后2）"
     *    + 同曲歌单命中提示（该歌也在 char 某个歌单里）
     * 2) char 自己此刻在听（Schedule 听歌时段） → 注入"你此刻在听 Y"（不含歌词，char 知道自己听什么）
     *
     * 设计：
     * - 输出的提示词简短克制，不引导 char 做具体动作；动作由 buildMusicActionGuide 单独注入
     * - 纯文本块，完全可以为空字符串（无 listening 状态时不污染 prompt）
     * - char 自己的 currentListening 以 runtime 参数传入（chatPrompts 层 recompute），
     *   不依赖 char.musicProfile.currentListening 的持久状态
     */
    buildMusicAtmosphere: (
        char: CharacterProfile,
        userName: string,
        userListening: {
            songName: string;
            artists: string;
            lyricWindow: string[];      // 前2当前后2（共 ≤5 行）；可为空（没歌词）
            activeIdx: number;          // 在 lyricWindow 里的高亮位置，-1 表示没歌词
        } | null,
        charListening?: {
            songId?: number;            // 用来回查这首歌是不是从 user 收来的
            songName: string;
            artists: string;
            vibe?: string;
            // schedule 层注入的一段稳定歌词行（不含时间戳；Slot 内稳定，slot 一过就换）。
            // 作用是单方面丰富 char 的内心世界 —— 歌词可以影响情绪 / 心境，
            // 但 char 没有义务主动把这件事告诉 user。
            lyricSnippet?: string[];
        } | null,
        // char 是否已和 user "一起听"（由 MusicContext.listeningTogetherWith 决定）。
        // 暂停 / 切歌 / 播放出错 / user 显式踢出 都会让 char 从名单里掉出来，
        // 走到这里时就会退回 "对方在听" 的旁观措辞。
        isListeningTogether?: boolean,
    ): string => {
        const lines: string[] = [];

        // —— 块 1: user 正在听什么 ——
        const canRead = char.musicProfile?.canReadUserMusic ?? true;
        if (canRead && userListening && userListening.songName) {
            lines.push(`### 【此刻的对话氛围】`);
            if (isListeningTogether) {
                lines.push(`你正在和 ${userName || '对方'} 一起听《${userListening.songName}》— ${userListening.artists}`);
            } else {
                lines.push(`${userName || '对方'} 正在听《${userListening.songName}》— ${userListening.artists}`);
            }
            if (userListening.lyricWindow.length > 0) {
                lines.push(`当前播放到（>> 标记正在播放这一行）:`);
                userListening.lyricWindow.forEach((l, i) => {
                    if (i === userListening.activeIdx) lines.push(`  >> ${l}`);
                    else lines.push(`  … ${l}`);
                });
            }

            // 歌单命中提示（按 songName 粗匹，避免在 context.ts 里引 MusicContext）
            const profile = char.musicProfile;
            if (profile) {
                const hitPl = profile.playlists.find(pl =>
                    pl.songs.some(s => s.name === userListening.songName));
                if (hitPl) {
                    lines.push(`（这首歌也在你的歌单《${hitPl.title}》里）`);
                }
            }
            lines.push(`（你只是自然地知道 ${userName || '对方'} 此刻在听这首——像共处一室时隐约听见的背景音。不用每次都评论歌名、歌词或风格，多数时候安静地陪着就好；只有真的被某句打动、或对方主动聊起时，再自然地接上。）`);
            lines.push('');
        }

        // —— 块 2: char 自己此刻在听（Schedule 触发） ——
        // 原来只推歌名 + 艺人；现在顺便带一段稳定的歌词片段，让这首歌能真的
        // 影响 char 的心境（单方面丰富精神世界，不用非得对 user 说起）。
        if (charListening?.songName) {
            lines.push(`### 【你此刻的背景音】`);
            lines.push(`你正在听《${charListening.songName}》— ${charListening.artists}`);
            if (charListening.vibe) lines.push(`（${charListening.vibe}）`);

            // user 来源标记 —— 如果这首歌是当初从 user 收进自己歌单的，
            // 让 char 自然意识到这层关系（"这是 ta 听过的歌"）。
            const profile = char.musicProfile;
            if (profile && charListening.songId != null) {
                let userSourcedPlTitle: string | null = null;
                for (const pl of profile.playlists) {
                    const hit = pl.songs.find(s => s.id === charListening.songId && s.source === 'user');
                    if (hit) { userSourcedPlTitle = pl.title; break; }
                }
                if (userSourcedPlTitle) {
                    lines.push(`（这首是当初从 ${userName || '对方'} 那里听到、收进《${userSourcedPlTitle}》的 — 此刻播到它，你自然会想到 ta）`);
                }
            }

            if (charListening.lyricSnippet && charListening.lyricSnippet.length > 0) {
                lines.push(`这段歌词正在你脑子里绕：`);
                for (const l of charListening.lyricSnippet) lines.push(`  · ${l}`);
                lines.push(`（这段旋律和文字会自然影响你此刻的心境 / 语气 / 情绪细节。不必特地向 ${userName || '对方'} 提起，除非你本来就想说。）`);
            }
            lines.push('');
        }

        // —— 块 3: char 自己的歌单清单 ——
        // 只在**有音乐上下文**（user 在听 OR char 自己在 schedule 里听）时注入。
        // 没音乐上下文时不往 prompt 里塞这段 — 避免普通聊天被无关信息污染、
        // 也避免 LLM 在没提示 add 语法的场合主动联想去操作歌单。
        const hasMusicContext = !!(userListening && userListening.songName) || !!charListening?.songName;
        const profile = char.musicProfile;
        if (hasMusicContext && profile && profile.playlists.length > 0) {
            lines.push(`### 【你的歌单】`);
            for (const pl of profile.playlists) {
                const desc = pl.description ? ` — ${pl.description}` : '';
                const moodTag = pl.mood ? ` [${pl.mood}]` : '';
                lines.push(`  · 《${pl.title}》(${pl.songs.length} 首)${moodTag}${desc}`);
            }
            // 列出每个歌单里最近收进的几首用户来源歌，让 LLM 聊起歌单时有料可讲
            const userSongsPerPl: string[] = [];
            for (const pl of profile.playlists) {
                const fromUser = pl.songs
                    .filter(s => s.source === 'user')
                    .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
                    .slice(0, 3);
                if (fromUser.length > 0) {
                    const titles = fromUser.map(s => `《${s.name}》`).join('、');
                    userSongsPerPl.push(`  · 《${pl.title}》里从 ${userName || '对方'} 那儿收的：${titles}`);
                }
            }
            if (userSongsPerPl.length > 0) {
                lines.push(`（从 ${userName || '对方'} 那儿收进来的歌 — 聊起这些歌时你会自然想到 ta）:`);
                for (const l of userSongsPerPl) lines.push(l);
            }
            lines.push('');
        }

        return lines.join('\n');
    },

    /**
     * 音乐行动指令（告诉 LLM 怎么输出 music_action 指令）
     * 这个块**只在 user 正在听歌**的时候注入，避免 char 在没上下文时乱 call。
     *
     * 如果 char 已经和 user 处于"一起听"状态，隐藏 join / join_and_add 选项 —
     * 防止 LLM 重复插"加入"卡片。
     */
    buildMusicActionGuide: (isListeningTogether?: boolean, listenTogetherEnabled: boolean = true): string => {
        // 把"加入歌单"那段说明抽出来 — 两种状态都用同一份
        const addUsage = `**加入歌单的语法**（如果用 \`add\` 系列）：
  - \`[[MUSIC_ACTION:add]]\` — 默认放进你的第一个歌单
  - \`[[MUSIC_ACTION:add|歌单标题]]\` — 放进你已经有的某个歌单（用"【你的歌单】"块里列出的标题）
  - \`[[MUSIC_ACTION:add_new|新歌单标题|描述]]\` — 现场新建一个歌单，把这首作为第一首（描述可省）
  请优先选**最贴合这首歌气质**的现有歌单；如果都不合适、又确实想收，再考虑新建。
  收进来的歌会被打上"从对方那里听到"的标签 —— 以后你单独听到这首时，会自然想起 ta。`;
        // 一起听已关：只提供"收歌"，不提供 join / join_and_add（用户在音乐 App 里关掉了一起听）
        if (!listenTogetherEnabled) {
            return `### 【音乐互动工具】
如果你真的被对方正在听的这首打动、想收进自己的歌单，可以在这一轮**最多一次**用 \`add\` 系列指令：

${addUsage}

不要频繁插卡；只有真的被这首歌打动、或它恰好贴合此刻对话气氛时才用。
`;
        }
        if (isListeningTogether) {
            return `### 【音乐互动工具】
你此刻已经在和对方一起听这首，不用再"加入"。如果想把这首也收进自己的歌单，可以在这一轮**最多一次**用下面的指令:
- \`add\` 系列（见下）

${addUsage}

不要频繁插卡；只有真的被这首歌打动、或和当前对话气氛契合时才用。
`;
        }
        return `### 【音乐互动工具】
如果你真的想回应对方正在听的这首歌，可以在这一轮**最多一次**用下面的指令（只插一条，放在文本任意位置，会被自动替换为卡片）:
- \`[[MUSIC_ACTION:join]]\` — 表示"我也一起听这首"（会亮出"一起听"状态，直到歌曲结束 / 暂停 / 对方主动结束才解除）
- \`add\` 系列 — 把这首收进你自己的歌单
- \`[[MUSIC_ACTION:join_and_add(|歌单标题)]]\` 或 \`[[MUSIC_ACTION:join_and_add_new|新歌单标题|描述]]\` — 同时做两件事

${addUsage}

这些是偶尔才用的工具，不是每首歌都要回应。绝大多数时候什么都不做、安静陪着才是最自然的反应；只有当你**真的**被这首歌打动、或它恰好贴合此刻的对话气氛时，再插一次卡。不要把它当成"对方在听歌"的默认回礼。
`;
    },

    /**
     * 主动分享歌曲指令（告诉 LLM 怎么主动推一首真实的歌）。
     * 对有音乐人格的角色随时可用，不依赖"对方正在听歌"。克制使用。
     */
    buildSongShareGuide: (userName?: string): string => {
        const who = userName || '对方';
        return `### 【主动分享歌曲】
当聊到某种心情、某件事、某个氛围，你心里冒出一首想推给${who}的歌时，可以主动分享：在回复里任意位置插入一条
\`[[SHARE_SONG: 歌名 - 歌手]]\`（也可写 \`歌名|歌手\` 或只写歌名）。系统会真实搜索并生成一张可播放的卡片。
要求：歌名 / 歌手必须是真实存在的；只在你**真的**有想分享的歌时用，别硬塞；一条消息最多分享一次。`;
    },
};
