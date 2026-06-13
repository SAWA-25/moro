# CLAUDE.md

给 Claude Code 的项目导航。Moro 是装在浏览器里的虚拟手机系统（React + TS + Vite，local-first，IndexedDB 存储）。详细介绍见 [`README.md`](./README.md)。

这份文件只做一件事：**告诉你遇到某类问题该去翻哪份文档**，别在代码里瞎逛。

> 包管理器统一用 **pnpm**：装依赖 `pnpm install`、跑测试 `pnpm vitest run`、跑脚本 `pnpm <script>`。别用 npm / yarn（仓库里是 `pnpm-lock.yaml`）。

## 文档地图

| 主题 | 文档 | 什么时候看 |
|------|------|-----------|
| **开发调试面板 / 开关** | [`docs/dev-debug.md`](./docs/dev-debug.md) | 加 dev-only 开关、加调试日志、排查"角色怎么又不说话了"。含逐步指南 |
| **记忆系统** | [`docs/memory-system-overview.md`](./docs/memory-system-overview.md) | 涉及长期记忆、月度总结、向量化记忆宫殿、情感空间。改记忆相关逻辑前必读 |
| **世界书开关/作用域/位置** | [`docs/worldbook-scopes.md`](./docs/worldbook-scopes.md) | 条目/整书开关、局部 vs 全局、ST 式插入位置（@Depth）、群聊去重。改世界书注入前必读 |
| **预设 App（酒馆预设）** | [`docs/preset-app.md`](./docs/preset-app.md) | SillyTavern Chat Completion 预设导入、提示词管理器、@Depth 注入语义、marker→Moro 落点映射。改预设/消息组装前必读 |
| **人设 App（用户人设）** | [`docs/persona-app.md`](./docs/persona-app.md) | SillyTavern Persona 管理移植：多套用户身份、角色绑定自动切换、描述注入位置、人设世界书、角色卡开场白选择。改人设/用户档案注入前必读 |
| **正则 App（ST 正则脚本）** | [`docs/regex-app.md`](./docs/regex-app.md) | SillyTavern Regex 移植：全局/角色局部脚本、酒馆 JSON 导入、角色卡正则同步、聊天管线四个挂载点。改消息收发/渲染管线前必读 |
| **Instant Push SSE↔Push 契约** | [`docs/instant-push-dual-channel.md`](./docs/instant-push-dual-channel.md) | **改 instant push 路径或排查「报错但收到消息」类 bug 前必读**。SSE ≠ 送达判定通道、catch 不能直接判 send-failed |
| **Instant Push 通道** | [`docs/instant-push-branch-notes.md`](./docs/instant-push-branch-notes.md)、[`worker/instant-push/README.md`](./worker/instant-push/README.md) | LLM-driven Web Push、worker 端 agentic loop / reasoning / 副作用 directive |
| **角色离线自主生活 + 离线弹窗授权** | [`docs/autonomous-life.md`](./docs/autonomous-life.md) | 来往·让角色离线时「过自己的日子」（主动消息从生活取材、不围着用户转）、离线动态回顾时间线、浏览器通知授权（Chrome/Edge）。改主动消息 / 离线推送 / 角色日常前必读 |
| **角色真实城市系统** | [`docs/char-city.md`](./docs/char-city.md) | 真实/架空城市选择 + 原型城市 + 虚拟程度、实时天气按角色城市取、查手机外卖彩蛋（真实本地店）。改角色城市 / 实时接地前看 |
| **二改 / 加 App / 数据流 / 后端 Worker** | [`README.md`](./README.md) 「给想二改的人」一节 | 新增 App、build badge、sfworker 代理替换、开源协议 |

> README 的「给想二改的人」区域信息量很大（数据流、ContextBuilder、Instant Push Phase 2、sfworker 清单），动后端 / 加功能前先扫一遍。