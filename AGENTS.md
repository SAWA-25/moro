# AGENTS.md

给 Codex 的项目导航。Moro 是装在浏览器里的虚拟手机系统（React + TS + Vite，local-first，IndexedDB 存储）。详细介绍见 [`README.md`](./README.md)。

这份文件只做一件事：**告诉你遇到某类问题该去翻哪份文档**，别在代码里瞎逛。

> 包管理器统一用 **pnpm**：装依赖 `pnpm install`、跑测试 `pnpm vitest run`、跑脚本 `pnpm <script>`。别用 npm / yarn（仓库里是 `pnpm-lock.yaml`）。

> 更新公告同步约定：任何代码、文案、配置、数据、测试、构建脚本或文档改动，都必须在 `apps/manual/manualData.ts` 的 `MANUAL_UPDATE_NOTICES` 追加/更新一条面向普通用户的更新公告；同一次改动可合并成一条公告，但不能漏记。公告只写用户能理解的变化、影响和注意事项，不写开发步骤、commit 号或内部实现细节。新增、改名、合并或明显调整任何用户可见 App / 桌面软件 / 子功能入口时，还必须同步更新同文件里的 `MANUAL_ENTRIES` 和 `MANUAL_DESTINATIONS`，讲清楚入口、用途、常用设置和注意事项。

> 完整角色 / 用户设定调用约定：凡是新增或改动会让模型扮演、判断、代入、建议、生成正式角色行为/口吻/关系/记忆的功能，都必须给 LLM 完整角色设定和完整用户设定，不能只传 `description`、`systemPrompt`、`worldview`、`user.bio`、短简介、摘要或截断版。优先走已有统一入口：聊天/主动消息/页外等完整消息流用 `buildChatRequestPayload`；单 prompt 角色任务用 `ContextBuilder.buildFullCoreContext`；确实不需要聊天历史的结构化任务至少拼入 `buildFullCharacterSetting(..., { includeMemos: true })` 和 `buildFullActiveUserSetting` / `buildFullUserSetting`。预设总开关、作用范围或当前预设没打开时，可以回到功能默认 prompt，但默认 prompt 仍必须调用完整角色设定和完整用户设定；活字盘 marker 关闭只能影响预设骨架落点，不能让角色卡/用户设定退化成摘要。正式角色相关世界书必须按 `WorldbookRuntime` 的整书/条目开关、挂载、全局、关键词和 @Depth 规则生效。若某个 LLM 入口刻意不接正式角色设定（例如翻译、模型连接测试、独立桌宠、随机路人 NPC、店铺/骑手/客服等非正式角色），代码注释或文档里要说明它不属于正式角色卡范围；否则一律按完整设定处理，并补对应测试或静态断言。

> 活字盘预设调用约定：凡是新增或改动需要正式角色出声、行动、判断、共创、社交发帖/回帖、场景推进、主动消息、电话、群聊、约会、页外或其它角色代入的 LLM 入口，都必须按任务语义接入活字盘预设作用范围（`PresetScopeKey`），让当前预设在对应范围开启时能参与提示词组装和采样参数下发。聊天类完整消息流优先用 `buildChatRequestPayload`；非聊天但角色代入的单 prompt 调用要么走 `callChatCompletion`/`completeText` 的 `presetScope`，要么显式 `PresetRuntime.getActivePresetForScope` + `applyPresetToMessages`，并保留功能自己的必要指令、输出格式和完整角色/用户设定。只有纯功能性 App prompt 可以不套角色预设或走结构化保护范围，例如翻译、摘要、分类、标签、抽取、模型连接测试、固定 JSON 解析、店铺/骑手/客服/随机路人等不扮演正式角色的任务；这类例外要在代码注释或文档中说明。不允许因为“这是某个 App 的专用 prompt”就绕过预设：只要模型需要代入正式角色，就必须结合活字盘预设；预设未启用时再回到该功能默认 prompt。

> 角色内置 ID / 身份锚约定：`CharacterProfile.modelId` 是给模型看的稳定身份锚，`id` 仍是 IndexedDB、消息、群成员等本地外键。凡是创建角色、导入角色、生成角色、把影子联系人转成正式角色、批量恢复/迁移角色列表，写入 state 或 `DB.saveCharacter` 前都必须走 `ensureCharacterModelId` / `normalizeCharacterDefaults`；内置角色要显式写 `modelId`。单张角色卡导出不要带 `id` / `modelId`，单卡导入要生成新的本地锚；完整备份恢复可保留原锚但要补缺。任何给 LLM 的角色列表、群成员花名册、社交 feed 作者列表必须用 `formatCharacterWithId` / `getCharacterModelId` 展示身份锚；模型返回的 `charId` 若来自这个锚，落库前必须映射回本地 `id`。相关入口先看 `utils/characterIdentity.ts`、`utils/impression.ts`、`utils/db.ts` 和 `context/OSContext.tsx`。

## 文档地图

| 主题 | 文档 | 什么时候看 |
|------|------|-----------|
| **开发调试面板 / 开关** | [`docs/dev-debug.md`](./docs/dev-debug.md) | 加 dev-only 开关、加调试日志、排查"角色怎么又不说话了"。含逐步指南 |
| **记忆系统** | [`docs/memory-system-overview.md`](./docs/memory-system-overview.md) | 涉及长期记忆、月度总结、向量化回忆标本馆、情感空间、召回疲劳/防复读、认知网络 UI（记忆浏览器 + 心意图谱）。改记忆相关逻辑前必读 |
| **回神 + 日程锚点 + 副 API + 生活侧写** | [`docs/recenter-and-schedule-anchor.md`](./docs/recenter-and-schedule-anchor.md) | 回神（长聊跑味后自我校准）、日程随聊天自动协调、副 API（文具盒里配，处理主聊天以外的辅助任务，`utils/auxApi.ts`）、角色生活侧写（剪影集→登场人物，帮角色更懂自己）。改这些前必读 |
| **世界书开关/作用域/位置** | [`docs/worldbook-scopes.md`](./docs/worldbook-scopes.md) | 条目/整书开关、局部 vs 全局、ST 式插入位置（@Depth）、群聊去重。改世界书注入前必读 |
| **预设 App（酒馆预设）** | [`docs/preset-app.md`](./docs/preset-app.md) | SillyTavern Chat Completion 预设导入、提示词管理器、@Depth 注入语义、marker→Moro 落点映射。改预设/消息组装前必读 |
| **人设 App（用户人设）** | [`docs/persona-app.md`](./docs/persona-app.md) | SillyTavern Persona 管理移植：多套用户身份、角色绑定自动切换、描述注入位置、人设世界书、角色卡开场白选择。改人设/用户档案注入前必读 |
| **正则 App（ST 正则脚本）** | [`docs/regex-app.md`](./docs/regex-app.md) | SillyTavern Regex 移植：全局/角色局部脚本、酒馆 JSON 导入、角色卡正则同步、聊天管线四个挂载点。改消息收发/渲染管线前必读 |
| **Instant Push SSE↔Push 契约** | [`docs/instant-push-dual-channel.md`](./docs/instant-push-dual-channel.md) | **改 instant push 路径或排查「报错但收到消息」类 bug 前必读**。SSE ≠ 送达判定通道、catch 不能直接判 send-failed |
| **Instant Push 通道** | [`docs/instant-push-branch-notes.md`](./docs/instant-push-branch-notes.md)、[`worker/instant-push/README.md`](./worker/instant-push/README.md) | LLM-driven Web Push、worker 端 agentic loop / reasoning / 副作用 directive |
| **角色离线自主生活 + 离线弹窗授权** | [`docs/autonomous-life.md`](./docs/autonomous-life.md) | 来往·让角色离线时「过自己的日子」（主动消息从生活取材、不围着用户转）、离线动态回顾时间线、浏览器通知授权（Chrome/Edge）。改主动消息 / 离线推送 / 角色日常前必读 |
| **角色真实城市系统** | [`docs/char-city.md`](./docs/char-city.md) | 真实/架空城市选择 + 原型城市 + 虚拟程度、实时天气按角色城市取、查手机外卖彩蛋（真实本地店）。改角色城市 / 实时接地前看 |
| **街角·约会世界引擎** | [`docs/date-world-engine.md`](./docs/date-world-engine.md) | 街角（LifeSim）里 char 带 user 约会：副 API 世界引擎做场景调度、内置/自定义场景、多世界线分支、话/动作分输入、MiniMax 氛围 BGM、角色台词语音、每 20 回合总结隐藏上文。改约会前必读 |
| **外卖联动 / 好感框架 / 关系 / 求婚婚姻** | [`docs/takeout-relationship-marriage.md`](./docs/takeout-relationship-marriage.md) | 外卖送达与现实同步+收货确认+角色收到外卖反应、回形针点外卖与订单小票、聊天设置「角色主动点外卖」开关、好感度加减框架、来往·偷看心声关系系统、回形针求婚+浪漫界面、求婚成功进婚姻筹备期+岁时记「喜事」栏目。改这些前必读 |
| **情侣空间（QQ 式）** | [`docs/couple-space.md`](./docs/couple-space.md) | 来往·情侣空间：聊天列表底栏「此刻」旁的入口、绑定另一半、恋爱天数/亲密度、情侣动态留言板、纪念日倒计时、九宫格相册、每日互动（亲亲抱抱牵手送礼）、约定任务、悄悄话信箱；数据注入聊天上下文 + 角色主动发动态/回留言/互动。改情侣空间前必读 |
| **聊天界面·极简皮肤** | [`docs/chat-minimal-skin.md`](./docs/chat-minimal-skin.md) | 私聊默认观感：浅灰白 #EDEDED 背景、白色悬浮圆角顶栏 + 居中头像、纯浅灰无描边软胶囊气泡（新增 `bubbleVariant:'plain'`，昵称标签 + 时间戳移到该组上方）、长句拆短气泡、顶/底状态签名、颜文字占位符 + 爱心发送键。改聊天界面默认样式 / 气泡变体前必读 |
| **折子戏·占卜 + 番外仿真图文 + 牌面美化** | [`docs/divination-and-faux.md`](./docs/divination-and-faux.md) | 占卜（塔罗78/雷诺曼36/六爻金钱卦/梅花易数，抽牌起卦 + 手动/API 解牌走世界书）、番外仿真图文（仿微信聊天截图/朋友圈/小红书/匿名论坛）、主题 App「牌面」美化（牌背/边框/风格）。改占卜引擎 / 牌库 / 番外仿真渲染前必读 |
| **折子戏·黑白拼贴手账** | `apps/TheaterApp.tsx` + `apps/theater/scrapbook.tsx` | 折子戏（戏单首页 + 九折：攻略本/番外/占卜/谈心/TRPG/轨迹/对影/狼人杀/真心话大冒险）。统一皮肤＝黑白拼贴手账，复用积木都在 `theater/scrapbook.tsx`（米白报纸 + 墨黑 + 牛皮胶带 + 邮票 + 拍立得；PaperShell/ScrapHeader/PaperCard/Polaroid/ScrapButton…），照片一律 grayscale。攻略本/TRPG 体量大，走根级 grayscale + GAME_THEMES 灰阶重映射落「黑白默片」。狼人杀（捌）＝`apps/theater/WerewolfApp.tsx` + 引擎 `utils/theaterWerewolf.ts`（一桌熟人开局，AI 按隐藏身份夜行动/昼发言/投票，对局存 IndexedDB）。真心话大冒险（玖）＝`apps/theater/TruthDareApp.tsx` + 引擎 `utils/theaterTruthDare.ts`（围圈转瓶子，受题者挑真心话/大冒险、另一人出题作答，尺度可调，存 IndexedDB）。改折子戏外观前看这里 |
| **来往 Prompt 中心** | [`docs/laiwang-prompts.md`](./docs/laiwang-prompts.md) | 改聊天 AI 的说话规则/语气/指令前必读。`utils/laiwangPrompts.ts` 是来往全部 prompt 文案的唯一可改处（关系/情侣空间/自主生活/回神/思考链/行动建议/核心系统提示/主动消息/偷看心声 分区注释），各功能从它 import、改了即生效 |
| **折子戏 Prompt 中心** | `utils/theaterPrompts.ts` | 改折子戏（九折）AI 文案前必读。番外/占卜/谈心/TRPG/轨迹/对影/狼人杀/真心话大冒险 的全部 prompt 集中在此（按折分区、逐项注释），各功能从它 import、改了即生效；攻略本文案体量大、仍在 `utils/guidebookPrompts.ts`（已被中心 re-export）。番外的「题库 / 番外指令」内容仓库另见 `utils/theaterExtraBank.ts` |
| **二改 / 加 App / 数据流 / 后端 Worker** | [`README.md`](./README.md) 「给想二改的人」一节 | 新增 App、build badge、sfworker 代理替换、开源协议 |

> README 的「给想二改的人」区域信息量很大（数据流、ContextBuilder、Instant Push Phase 2、sfworker 清单），动后端 / 加功能前先扫一遍。
