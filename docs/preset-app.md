# 预设 App（SillyTavern Chat Completion 预设移植）

把酒馆（SillyTavern）的 Chat Completion 预设 + 提示词管理器搬进 Moro：
桌面新增「预设」App，可以直接导入酒馆导出的预设 JSON，逐条开关 / 拖拽排序 /
编辑提示词，并接管聊天请求的采样参数。

## 文件地图

| 文件 | 职责 |
|------|------|
| `apps/PresetApp.tsx` | UI：预设条（新建/导入/导出/重命名/另存为/删除）、生成参数滑条、提示词管理器（拖拽/开关/编辑/插入/移除） |
| `utils/presets.ts` | 导入导出、运行时组装（`applyPresetToMessages`）、采样参数（`getPresetGenParams`）、`PresetRuntime` 开关读写 |
| `utils/presets.test.ts` | 导入映射 / 组装语义（含 @Depth 注入次序）的单测 |
| `types.ts` | `TavernPreset` / `PresetPrompt` / `PresetPromptOrderCharacter`（字段名与 ST 对齐，snake_case） |
| `utils/db.ts` | `llm_presets` store（v64）+ `DB.getAllPresets/getPreset/savePreset/deletePreset`，备份导入导出已接入 |

## 接入点（谁在用预设）

1. **消息骨架** —— `utils/chatRequestPayload.ts` 第 11 步：`PresetRuntime.getActivePreset()`
   非空时用 `applyPresetToMessages` 把 `[system(核心上下文), ...history]` 重排成
   prompt_order 定义的消息流。双语 reminder 仍钉在最末尾。
2. **采样参数** —— `hooks/useChatAI.ts`：`PresetRuntime.getActiveGenParams()` 覆盖
   temperature / top_p / 惩罚 / max_tokens 等（本地 fetch 与 instant push 两条路都吃）。
   预设里的「采样参数随请求下发」开关可以只用提示词、参数仍走全局设置。

## 与 ST 的语义对齐

- `prompt_order`：character_id 100000（单聊）/ 100001（群聊）原样保留；Moro 的
  UI 改单聊那份时两份同步（群聊链路目前不走预设）。
- 相对提示词（injection_position=0）按列表顺序展开成独立消息，role 取各自设定。
- 绝对提示词（injection_position=1，即 In-Chat @Depth）：深度从**聊天历史末尾**数
  （depth 0 = 最后一条历史之后、post-history 提示词之前）；同深度 order 大的更靠近
  末尾；同 order 内时间顺序 assistant→user→system —— 与 ST
  `populationInjectionPrompts` 逐条对齐（含 totalInsertedMessages 补偿）。
- 宏：`{{char}} {{user}} {{date}} {{time}} {{weekday}} {{newline}}`，大小写不敏感，
  未知宏原样保留。
- 导入：未映射的 ST 字段（utility prompts、模型选择等）全量存进 `preset.raw`，
  导出时合并回去 —— 导入再导出不丢字段，文件可以拿回酒馆继续用。

## marker 映射（ST 占位符在 Moro 的落点）

| ST marker | Moro 落点 |
|-----------|----------|
| `chatHistory` | 聊天历史消息（@Depth 世界书已先注入其中） |
| `charDescription` `charPersonality` `scenario` `personaDescription` `worldInfoBefore` `worldInfoAfter` `dialogueExamples` | 共同映射到 Moro 的角色核心上下文（`ContextBuilder.buildCoreContext` 的整块 system），注入在 prompt_order 中**第一个启用**的核心 marker 处，其余仅作排序占位 |

兜底规则（偏安全而不偏 ST 字面语义）：核心 marker 全被关掉时核心上下文仍注入到
最前（否则人设/记忆静默丢失极难排查）；order 里没有 `chatHistory` 时历史追加到
末尾；被显式关掉则尊重设置不发历史。

## 开关存储

- `os_preset_enabled`：总开关（'1' 开）
- `os_preset_active_id`：激活预设 id
- `os_preset_apply_sampling`：采样参数是否随请求下发（缺省开）

预设本体存 IndexedDB `llm_presets` store，App 内所有改动即时落库（没有 ST 的
「设置区 vs 预设文件」双层，故无手动「更新预设」按钮）。
