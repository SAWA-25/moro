# 回神 + 日程锚点 + 副 API + 生活侧写

这份文档讲几件「让角色在长聊里更稳、更像自己」的机制：**回神**（角色自我校准）、**日程锚点协调**（日程随聊天自动对齐）、**副 API**（处理主聊天以外的辅助任务）、**角色生活侧写**（帮角色更了解自己）。改主聊天自我校准 / 日程联动 / 副 API / 生活侧写前看这里。

> 配套的记忆侧「防复读」（召回疲劳 + 锚点节流）见 [`memory-system-overview.md`](./memory-system-overview.md) 的「召回疲劳 / 习惯化」一节。

---

## 一、回神（Recenter）— 角色自我校准

### 解决什么

长对话里角色「说话的味道」几乎一定会慢慢漂：某句话突然不像本人、表达越来越僵硬模板化、措辞让用户隐隐不适、渐渐滑向一个完美的讨好型人格丢了棱角。过去用户只能删消息 / 反复重生成 / 重写人设来纠。「回神」给一条更优雅的路径：**让角色自己暂停、第一人称审视哪里偏了、再悄悄调回去**。

### 链路

| 环节 | 位置 |
|------|------|
| 触发按钮「回个神」 | `components/chat/ChatInputArea.tsx`（文具盒面板 ·「这本手帐」区） → `onPanelAction('recenter')` |
| 处理器 `handleRecenter` | `apps/Chat.tsx`：拉最近 60 条 → `runRecenter` → 写 `char.recenterCalibration` → 弹窗 |
| LLM 调用 `runRecenter` | `utils/recenter.ts`：**主 API**（角色自己的声音），拿核心人设当锚审视近 24 条对话 |
| 注入 | `utils/context.ts` `buildCoreContext`：`recenterCalibration.turnsLeft > 0` 时注入「### 回神校准」段 |
| 衰减 | `hooks/useChatAI.ts` `triggerAI` 的 `finally`：每回复一轮 `turnsLeft--`，归零清除（自然淡出） |

### 产物（`RecenterResult`）

- `monologue`：第一人称内心独白——**给用户看**的情感落点（ta 当着你的面意识到了问题），弹窗展示。
- `drift`：察觉到的偏移点（2-4 条，展示用）。
- `calibration`：一句话校准方向——**注入** system prompt 让 ta 真的调回来，但 ta 不会说出口、不会提「回神」本身。

### 数据结构

`CharacterProfile.recenterCalibration?: { note; monologue?; drift?; createdAt; turnsLeft }`（运行时字段，会持久化）。生效 `RECENTER_DEFAULT_TURNS = 4` 轮后自动清除。

### 关键点

- 用**主 API**，不是副 API：回神是角色本人在说话。
- 「悄悄」是设计核心：注入段明确要求**不解释、不提回神**，只自然回到本来的语气与棱角。
- 没明显跑偏时 `runRecenter` 仍可能返回（monologue 写「其实还好」），`calibration` 给个温和兜底。

---

## 二、日程锚点协调（Schedule Anchor）

### 解决什么

角色的日程由 ta 自己安排（`generateDailyScheduleForChar`，一天一份），但聊天里常冒出跟「今天」直接相关的约定/变更——「晚上八点一起看电影」「我今天不去公司了」「等下我去接你」。这些以前**不会落进日程**，导致日程卡片和聊天各说各话。现在它们会**自动协调进日程**，成为优先级最高的「锚点」，角色再围着锚点安排其它时段。

### 链路

| 环节 | 位置 |
|------|------|
| 廉价信号闸 `chatHasScheduleSignal` | `utils/scheduleGenerator.ts`：关键词正则扫最近 8 条，命中才值得花 LLM |
| 协调 `reconcileScheduleWithChat` | `utils/scheduleGenerator.ts`：走「今日作息」底部日程 API；日程 API 留空时直接使用主 API，对照聊天产出协调后的完整日程；无需改动返回 `changed:false` |
| 触发 | `apps/Chat.tsx`：`messages` 变化的 effect，过信号闸 + 每角色 8 分钟冷却（localStorage）后台跑；不再要求全局副 API 开启 |
| 注入 | `utils/context.ts` `buildScheduleInjection`：锚点单独提到最前（「今天你和对方约定/已定下的事」） |
| 入口 | 聊天右上角设置 → `ConvoSettingsPanel`「TA 的日程表」（开关 + 翻开今日日程 + 日程 API / 心情 API 配置） |

### 锚点标记

`ScheduleSlot` 新增 `source?: 'self' | 'chat'` 与 `anchored?: boolean`。聊天协调出来的时段标 `source='chat' + anchored=true`，角色把它当「已经定下、要遵守」的事。

### 关键点

- **角色自治优先**：没被聊天触及的时段原样保留，只动需要动的；用户不是日程主语。
- **别把锚点变成另一种揪着不放**：注入文案明确要求「记着、围着它走，不用反复主动提起或催问」。
- **成本可控 + 明确线路**：今日作息底部日程 API 填齐就走自定义线路，留空直接走主 API；触发仍先过信号闸（正则，0 成本）→ 命中 → 8 分钟冷却 → 才一次 LLM 调用；不每轮都调。

---

## 三、副 API + 角色生活侧写

### 副 API（全局，在「文具盒 → 副线盒」配置）

`AuxApiConfig { enabled, baseUrl, apiKey, model }`（OSContext，持久化 `os_aux_api_config`）。负责「主聊天对话以外」的**所有** LLM 任务——把主线（聊天）的额度与注意力让出来。

- 解析：`utils/auxApi.ts` `resolveAuxApi(aux, main)` —— 副 API 开且填齐就用副 API，否则回退主 `apiConfig`（**没配副 API 时行为与改造前完全一致**）；`isAuxApiOn(aux)` 判断是否「真正可用」。
- 默认形态：每个消费方在组件顶部取 `const auxApi = { ...apiConfig, ...resolveAuxApi(auxApiConfig, apiConfig) }`（保留 `temperature/stream/minimax` 等形状，只替换 `baseUrl/apiKey/model` 三件套），再喂给共享 LLM 客户端或工具函数。
- OpenAI 兼容入口统一走 `utils/openAiCompat.ts` + `utils/llmClient.ts`：Base URL 可填根地址、`/v1`、完整聊天端点、模型列表端点或图片生成端点，统一归一化后再拼路径；空 Key 的本地/免鉴权接口会用 `sk-none` 兜底 header。
- 模型列表、连接测试和聊天补全共用 `fetchModelList` / `testChatConnection` / `callChatCompletion` / `llmComplete`。服务商不支持模型列表时只提示手动输入模型名，不阻断保存。
- `resolveAuxApi` 返回的 `ResolvedApi` 会标注 `apiRole`、`apiBinding` 和 `fallbackFromAux`：API 后台流水能区分「副 API 可用」「副 API 未配置而回退主 API」以及角色级/场景级自定义 API。

#### 边界：什么走主 API、什么走副 API

- **主 API（聊天体验本身）**：私聊正文回复（`hooks/useChatAI.ts`）、群聊回复（`apps/ChatHub.tsx`）、主动消息（`utils/activeMsgRuntime.ts`）、Instant Push、QQ 桥（`apps/QQBridge.tsx`）、电话（`apps/CallApp.tsx` 实时通话）、聊天内的角色反应（求婚回应 `decideCharProposal`、红包过期反应、外卖/礼物反应）、偷看心声 `generateInnerVoice`、回神 `runRecenter`。
- **副 API（其余全部功能 / App）**：浏览器、银行、TRPG/游戏、相机·查手机生成（`CheckPhone`，注意 `CameraApp` 多模态识图仍走主 API）、交换日记/日记社、小说、写歌歌词·Prompt、攻略本/手账、岁时记日历、约会/街角/记忆潜入、回忆标本馆（记忆提取、关联分析、认知消化和本地整理均复用文具盒副 API 的 Base URL / API Key）、小红书自由活动、页外剧院/VR·轨迹·对影、朋友圈生成、情侣空间、占卜、谈心、世界书/好友验证决策、番外仿真、角色卡生成/润色/导入、角色音乐主页、TTS 台词翻译、整理归档总结，等等。
- **保持原样（各有独立配置 / 非文本线路）**：图片生成 `generateImage`、MiniMax 语音 / ACE 音乐合成；多模态识图（相机/相册/白色情人节巧克力）因需 vision 能力暂留主 API；情人节/白色情人节/520 等节日事件作为「聊天体验」的一部分暂留主 API。
- **絮语今日作息 / 心情 buff**：`apps/Chat.tsx` 的日程生成、日程协调走 `emotionConfig.scheduleApi`；情绪评估、心情 buff 与意识流走 `emotionConfig.moodApi`。旧版 `emotionConfig.api` 只作历史兜底；任一项留空时直接使用主 API，不再默认回落全局副 API。
- 早期消费方（仍然适用）：`apps/Character.tsx` 的生活侧写。

### 角色生活侧写（剪影集 → 登场人物 → 底稿页）

一份帮角色「更了解自己」的生活速写（日常节奏 / 习惯癖好 / 在意的事 / 与用户关系底色 / 情绪走向）。

| 环节 | 位置 |
|------|------|
| 生成 `generateLifeProfile` | `utils/lifeProfile.ts`：副 API（回退主），依据人设 + 月度核心记忆 + 近期碎片，用**第二人称「你」**写 350-600 字 markdown |
| 数据 | `CharacterProfile.lifeProfile { content, generatedAt, edited }`（手动改过 `edited=true`） |
| 编辑 | `apps/Character.tsx` 底稿页「生活侧写」卡：✎ 写一份 / ↻ 重写 / 直接手写，改完随 formData 自动存 |
| 注入 | `utils/context.ts` `buildCoreContext`：像「内在认知」一样垫在角色设定下方（### 你的生活侧写） |
