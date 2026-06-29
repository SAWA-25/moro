# AGENTS.md

给 Codex 的项目导航。Moro 是装在浏览器里的虚拟手机系统（React + TS + Vite，local-first，IndexedDB 存储）。详细介绍见 [`README.md`](./README.md)。

这份文件只做一件事：**告诉你遇到某类问题该去翻哪份文档**，别在代码里瞎逛。

> 包管理器统一用 **pnpm**：装依赖 `pnpm install`、跑测试 `pnpm vitest run`、跑脚本 `pnpm <script>`。别用 npm / yarn（仓库里是 `pnpm-lock.yaml`）。

> 说明书同步约定：新增、改名、合并或明显调整任何用户可见 App / 桌面软件 / 子功能入口时，必须同步更新 `apps/ManualApp.tsx` 里的 `MANUAL_ENTRIES` 和 `MANUAL_DESTINATIONS`。内容写给普通用户看，讲清楚入口、用途、常用设置和注意事项；不要把开发维护步骤写进说明书 App。

## 文档地图

| 主题 | 文档 | 什么时候看 |
|------|------|-----------|
| **开发调试面板 / 开关** | [`docs/dev-debug.md`](./docs/dev-debug.md) | 加 dev-only 开关、加调试日志、排查"角色怎么又不说话了"。含逐步指南 |
| **记忆系统** | [`docs/memory-system-overview.md`](./docs/memory-system-overview.md) | 涉及长期记忆、月度总结、向量化记忆宫殿、情感空间、召回疲劳/防复读、认知网络 UI（记忆浏览器 + 心意图谱）。改记忆相关逻辑前必读 |
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
