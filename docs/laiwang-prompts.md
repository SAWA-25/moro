# 来往 App · Prompt 中心

> 想改「来往」聊天 AI 的说话规则 / 语气 / 指令？**只改一个文件**：[`utils/laiwangPrompts.ts`](../utils/laiwangPrompts.ts)。
> 各功能都从它 import，改了即生效，不必再去各 util 里翻内联文案。

## 它是什么

`utils/laiwangPrompts.ts` 是「来往」App（私聊 + 群聊 + 聊天相关 AI 行为）**全部 prompt 文案的唯一可改处**。
原先这些文案散在 `context.ts` / `coupleSpace.ts` / `autonomousLife.ts` / `recenter.ts` / … 各自内联，
现在统一搬进这一个带分区注释的文件；原文件改成「取数据 + 调中心文案函数」的薄壳。

- **纯文案层**：只依赖 `./types`，不 import 任何功能 util（避免循环依赖）。
- **纯静态文案** → 导出常量字符串；**含动态值/条件** → 导出 `(参数) => string` 模板函数，函数体里就是可改的中文。
- `${xxx}` 是会被替换的占位变量（角色名 / 用户名 / 好感度…），**别删花括号**，其余中文随便改。

## 分区目录（文件内有同名注释块）

| 区段 | 内容 | 落到哪个功能 |
|------|------|-------------|
| **[1] 关系与感情** | 好感 / 关系推进([[REL]]) / 求婚([[PROPOSE]]) / 婚姻筹备([[WEDDING_PLAN]]) 注入块 | `utils/context.ts` |
| **[2] 情侣空间** | 上下文注入块 + 角色主动互动（评论/回悄悄话/反应互动/冒泡发动态）的 LLM 文案 | `utils/coupleSpace.ts` |
| **[3] 自主生活** | 离线/主动取材 v2：单条 `AUTONOMOUS_SINGLE_SYSTEM` / 批量 `AUTONOMOUS_BATCH_SYSTEM` / 主动消息 hint / **`recentLifeContextIntro`（把近来线下生活注入线上聊天的引导语）**。JSON 字段包含 `activity`/`mood`/`location`/`summary` 以及可选的 `eventKind`/`energy`/`intensity`/`shareWillingness`/`thread`/`proactiveAngle` | `utils/autonomousLife.ts` |
| **[4] 回神** | 长聊跑味后的自我校准 system | `utils/recenter.ts` |
| **[5] 思考链** | `<think>` 阶段「角色脑内活动」规则 | `utils/thinkingChainPrompt.ts` |
| **[6] 行动建议** | 「帮我想想接下来说啥」候选生成 system + user | `utils/userActionSuggest.ts` |
| **[7] 核心系统提示词** | buildCoreContext 各区块固定文案：身份提醒 / 自我领悟引导 / 生活侧写引导 / 回神校准 / 柔顺奉养 / **会话设定各行**(`convoLines`) / 记忆空兜底 | `utils/context.ts` |
| **[8] 主动消息 / 系统提示** | 时间间隔 hint / 主动消息兜底 hint / 收到外卖 hint / 求婚结果 hint | `OSContext.tsx` · `chatPrompts.ts` · `takeout.ts` · `Chat.tsx` |
| **[9] 偷看心声** | 内心独白 + 好感/心情/关系评估任务块 | `apps/Chat.tsx` |

## 改文案的注意点

- **保留占位变量与指令标记**：`${userName}`、`[[REL: …]]`、`[[PROPOSE: …]]`、`[[TAKEOUT_ORDER: …]]`、`[[CALL_USER]]`、`[[OFFLINE_START]]` 等是功能落点，删了对应功能就不触发。
- **JSON 输出格式别动结构**：[3]/[6]/[9] 等要求模型「只输出 JSON」，字段名（`activity`/`voice`/`affection`/`relationship`…）被解析逻辑依赖，改措辞可以、改字段名要同步改解析处。
- 关系阶段枚举（`stranger/acquaintance/friend/close/crush/lover/engaged/married/ex/estranged`）由 `utils/relationship.ts` 约束，[1]/[9] 里提到它们时保持一致。
- 改完跑 `pnpm exec tsc --noEmit` 确认没把模板字符串写崩。

## 没收进来的

纯数据拼装（记忆库/日程/音乐注入里对 `char.*` 字段的罗列、世界书运行时、消息历史格式化）不是「可调文案」，仍留在原处；中心文件只收**会影响角色说话方式的指令性文字**。
