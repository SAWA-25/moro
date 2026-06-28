# 预设 App（SillyTavern Chat Completion 预设移植）

把酒馆（SillyTavern）的 Chat Completion 预设 + 提示词管理器搬进 Moro：
桌面入口现名「**活字盘**」（黑白拼贴手账风 UI），可以直接导入酒馆导出的预设
JSON，逐条开关 / 拖拽排序 / 编辑提示词，并接管聊天请求的采样参数。

UI 文案与功能术语对照（数据结构 / ST 语义不变，只换了说法）：

| 界面词 | 实际语义 |
|--------|----------|
| 字版 | 一份预设（`TavernPreset`） |
| 开印 / 歇业 | 预设总开关（`PresetRuntime.setEnabled`） |
| 排字架 | 提示词管理器（`prompt_order`） |
| 字条 / 占位铅块 | 提示词 / marker |
| 口吻：旁白 / 你 / TA | role：system / user / assistant |
| 火候 | 生成（采样）参数 |
| 新刻 / 收进 / 拓出 / 翻刻 / 销版 | 新建 / 导入 / 导出 / 另存为 / 删除 |
| 从架上取下 / 从字库里捡一枚 | 移出列表（保留定义）/ 插入已有提示词 |

## 文件地图

| 文件 | 职责 |
|------|------|
| `apps/PresetApp.tsx` | UI：预设条（新建/导入/导出/重命名/另存为/删除）、生成参数滑条、提示词管理器（拖拽/开关/编辑/插入/移除） |
| `utils/presets.ts` | 导入导出（含 `extensions.regex_scripts` 解析/写回）、运行时组装（`applyPresetToMessages`）、采样参数（`getPresetGenParams`）、`PresetRuntime` 开关读写、`refreshPresetRegexCache`（预热预设正则缓存） |
| `utils/presets.test.ts` | 导入映射 / 组装语义（含 @Depth 注入次序）/ 预设自带正则往返的单测 |
| `types.ts` | `TavernPreset`（含 `regexScripts`）/ `PresetPrompt` / `PresetPromptOrderCharacter`（字段名与 ST 对齐，snake_case） |
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

主聊天链路（buildChatRequestPayload）现在按 marker **真实拆分**注入：

| ST marker | Moro 落点 |
|-----------|----------|
| `chatHistory` | 聊天历史消息（@Depth 世界书已先注入其中） |
| `worldInfoBefore` / `worldInfoAfter` | 世界书 before/after 块（含关键词激活过滤后的条目），在各自 order 位置注入，受 marker 开关控制 |
| `personaDescription` | 用户人设块（名字 + 设定/备注）。「人设」App 有激活人设时用人设的名字/描述（位置=嵌入提示词时），否则回落「档案」App 的内容，详见 `docs/persona-app.md` |
| `dialogueExamples` | 角色的对话示例块（`CharacterProfile.mesExample`，即角色卡 mes_example / 登场人物「台词样张」栏），在自己的 order 位置注入，受 marker 开关控制 |
| `charDescription` `charPersonality` `scenario` | 共同映射到 Moro 的角色核心上下文（人设/内在认知/世界观/印象/记忆），注入在其中**第一个启用**的 marker 处，其余仅作排序占位 |

实现：预设激活时 `ChatPrompts.buildSystemPrompt(presetMarkerSplit=true)` →
`buildCoreContext({ omitWorldbooks, skipUserProfile })` 把世界书与用户档案从核心块
里拆出，`applyPresetToMessages` 的 `markerContents` 选项把它们放回 marker 位置。

兜底规则（偏安全而不偏 ST 字面语义）：
- 核心 marker 全被关掉时核心上下文仍注入到最前（否则人设/记忆静默丢失极难排查）
- marker **不在 order 里**（残缺/旧版预设）时，其内容回折进核心块不丢失
  （worldInfoBefore 折前、其余折后）；marker 在 order 里但**被关掉**则按 ST
  语义丢弃（开关真的管用）
- order 里没有 `chatHistory` 时历史追加到末尾；被显式关掉则尊重设置不发历史

## 宏（{{user}} / {{char}} 通用化）

`utils/macros.ts` 的 `substituteMacros` 是全链路统一入口：最终 system prompt
（人设/世界观/世界书/用户档案都在里面）、@Depth 世界书消息、预设提示词、marker
内容都过同一遍替换。支持 `{{char}} {{user}} {{date}} {{time}} {{weekday}}
{{newline}}` 与 ST 旧版 `<char> <bot> <user>` 标记，大小写不敏感，未知宏原样保留。

## 预设自带正则（extensions.regex_scripts，ST PRESET 作用域）

酒馆预设可在 `extensions.regex_scripts` 里夹带正则脚本（ST 的 PRESET 作用域）。导入
预设时一并解析、规范化后挂到 `preset.regexScripts`（复用 `utils/regex/engine.ts` 的
`normalizeRegexScript`，与全局 / 角色卡正则同一套）：

- **只跟着这副字版走**：仅当本预设被激活、且印坊开印（`os_preset_enabled`）时生效。
  执行顺序排在补丁铺「满铺通用」（全局）之后、角色「只缝给 TA」（局部）之前 —— 对齐
  ST `getRegexScripts` 的 GLOBAL→PRESET→SCOPED。
- **运行时缓存**：聊天管线四个挂载点是同步的、取不到 async 的激活预设，所以
  `utils/regex/store.ts` 维持一份模块级 `presetCache`（`setPresetRegexScripts` 写、
  `getPresetRegexScripts` 读、`collectRegexScripts` 合并）。缓存刷新三处：App 启动
  （`refreshPresetRegexCache`，OSContext）、每次发送（`buildChatRequestPayload` 复用
  已 await 的激活预设，免再读库）、活字盘里选预设 / 开关印坊、补丁铺里编辑预设脚本（即时反映到
  聊天与气泡渲染；靠内容指纹去重，避免每条消息都触发显示层重渲染）。
- **管理**：补丁铺的「预设脚本」作用域可逐条**新增 / 编辑 / 启停 / 拆除**
  （点一条即打开 `components/regex/RegexEditor.tsx`；只动选中的活字盘预设，
  不碰补丁铺里的全局脚本或角色脚本）。改动写回 `preset.regexScripts` 并触发 `refreshPresetRegexCache`，
  即时反映到聊天与气泡渲染（见下「运行时缓存」与刷新指纹）。没有 ST 的「预设脚本需授权」
  弹窗 —— 随预设导入直接生效（与角色卡正则「随卡直接生效」一致）。
- **改了就生效**：`utils/regex/store.ts` 的缓存刷新指纹（`presetCacheSignature`）覆盖
  **全部影响执行/显示的字段**（placement / markdownOnly / promptOnly / trimStrings /
  substituteRegex / 深度 / runOnEdit，而非只看 find/replace）—— 否则在补丁铺里只改
  placement、只勾「只改显示」等会因指纹不变被早退跳过，出现「编辑了却不替换」。
- **往返**：`exportTavernPreset` 把 `preset.regexScripts` 写回
  `extensions.regex_scripts`（权威源，覆盖 raw 里可能过期的副本；清空后连旧副本一并
  抹掉），导出物可拿回酒馆继续用。

## API 联动

- 预设可绑定「设置 → API 配置」里保存的 API 预设（`moroApiPresetId`，Moro 本地
  字段不随酒馆 JSON 导出）：激活预设 / 修改绑定时自动 `updateApiConfig` 套用
  对应 baseUrl/key/model —— 类似 ST 切连接档案。
- 设置 App 的温度滑条上方会提示「采样参数当前由预设 X 接管」并附跳转按钮
  （预设开 + 采样下发开 + 有激活预设时显示）。

## 开关存储

- `os_preset_enabled`：总开关（'1' 开）
- `os_preset_active_id`：激活预设 id
- `os_preset_apply_sampling`：采样参数是否随请求下发（缺省开）

预设本体存 IndexedDB `llm_presets` store，App 内所有改动即时落库（没有 ST 的
「设置区 vs 预设文件」双层，故无手动「更新预设」按钮）。
