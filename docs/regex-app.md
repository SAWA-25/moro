# 正则 App（SillyTavern Regex 移植）

SillyTavern 正则脚本系统的完整移植：脚本数据结构、执行引擎与 ST 对齐，
酒馆导出的正则 JSON（单条对象或数组）可直接导入，角色卡内自带的正则
（`data.extensions.regex_scripts`）随卡导入时自动同步为角色局部脚本。

## 文件地图

| 文件 | 职责 |
|------|------|
| `utils/regex/engine.ts` | 纯函数引擎：`regexFromString` / `runRegexScript` / `getRegexedString` / `normalizeRegexScript`，与 ST `extensions/regex/engine.js` 一一对应 |
| `utils/regex/store.ts` | 全局脚本存取（localStorage `moro_global_regex_scripts`）、预设自带脚本运行时缓存（`presetCache` / `setPresetRegexScripts` / `getPresetRegexScripts`）、`applyRegexToText` 一站式入口、导入导出 |
| `apps/RegexApp.tsx` | 补丁铺 App UI：全局/预设/角色三个作用域、增删改、启停、导入导出、实时测试 |
| `components/regex/RegexEditor.tsx` | 共用正则编辑弹层：补丁铺的全局 / 预设 / 角色脚本统一用这一套 |
| `types.ts` | `RegexScriptData` 接口、`AppID.Regex`、`CharacterProfile.regexScripts` |

## 三个作用域（同 ST GLOBAL / PRESET / SCOPED）

- **全局**：对所有角色生效，存 localStorage。保存后广播
  `REGEX_SCRIPTS_UPDATED_EVENT`，聊天页监听刷新显示层。
- **预设自带**：`preset.regexScripts`，随预设导入（解析预设 JSON 的
  `extensions.regex_scripts`），**只有该预设被激活、且印坊开印时生效**。运行时是
  同步管线、取不到 async 的激活预设，所以 `store.ts` 维持一份模块级缓存 `presetCache`，
  由 `presets.ts` 的 `refreshPresetRegexCache`（App 启动）、`chatRequestPayload`
  （每次发送复用已取到的激活预设）、活字盘（选预设 / 开关印坊）、补丁铺（编辑预设脚本）刷新。
  详见 [`preset-app.md`](./preset-app.md)。
- **角色局部**：`char.regexScripts`，随角色进 IndexedDB / 备份。
  ST 卡导入时 `sillyTavernCard.ts` 解析 `extensions.regex_scripts` 填充。

执行顺序：全局 → 预设 → 角色局部（对齐 ST `getRegexScripts` 的 GLOBAL→PRESET→SCOPED）。

## 聊天管线四个挂载点

脚本的 `markdownOnly` / `promptOnly` 决定它落在哪个挂载点（与 ST 语义一致，
两者都不勾 = 直接改写消息原文）：

1. **用户发送** `apps/Chat.tsx` handleSendText — `USER_INPUT`，落库前改写原文
2. **AI 输出** `utils/applyAssistantPostProcessing.ts` Step 1.4 — `AI_OUTPUT`，落库前改写原文（在 BLOCK_USER 等指令剥离之前）
3. **提示词组装** `utils/chatPrompts.ts` buildMessageHistory — 仅 `promptOnly` 脚本，带 `depth`（0 = 最后一条）供 minDepth/maxDepth 过滤
4. **气泡渲染** `apps/Chat.tsx` displayMessages — 仅 `markdownOnly` 脚本，传给 MessageItem 前替换 content，不动原文；带 `depth`（0 = 最后一条）供 minDepth/maxDepth 过滤

另外世界书注入走 `utils/worldbookRuntime.ts` resolveForChar 末尾的
`WORLD_INFO` placement。

## 显示层脚本 × 富渲染（分泡保护）

ST 单条消息不拆泡，Moro 的 AI 回复落库前会被 `chunkText` 按换行拆成多条气泡。
若 `markdownOnly` 脚本要匹配的片段（如 `<status>…</status>` 状态栏伪 XML）被拆散，
挂载点 4 的渲染层正则永远匹配不上，美化脚本注入的 HTML 也渲染不出来。

所以 `applyAssistantPostProcessing` 在拆泡前，用
`utils/regex/store.ts` 的 `splitOutDisplayRegexSegments`（基于
`findDisplayRegexSpans`，编译逻辑与执行时共用 `getScriptFindRegex`）把
「显示层脚本能命中的整段」当富块整块保护：不拆泡、不被 sanitize 误伤，
落库后由挂载点 4 在渲染时整段替换，输出的 HTML 走 `RichCodeBlock` 的
iframe 渲染（脚本可执行，详见 `utils/chatRichContent.ts` 头注）。

## 与 ST 的差异

- 宏只支持 `{{user}}` / `{{char}}` / `{{match}}`（Moro 没有完整宏系统）
- `SLASH_COMMAND` / `REASONING` placement 可勾选但暂无挂载点
- 没有 ST 的「角色卡脚本需用户授权」弹窗：随卡导入的脚本直接生效，
  可在正则 App「角色」标签里逐条停用/删除。预设自带正则同理 —— 随预设导入直接生效
  （无 ST 的 `preset_allowed_regex` 授权门），在补丁铺「预设脚本」作用域里逐条新增/编辑/停用/拆除
- **内置显示层剥离 + 误配置徽章**（防御预设作者把「`<Human_inputs>` 包裹」配成改原文）：

  - `utils/regex/store.ts` 的 `BUILTIN_DISPLAY_STRIPS` 是一组 `markdownOnly=true` 的内置脚本，
    透明剥离 6 对 LLM 提示词工程包裹标签的「配对」出现：
    `<Human_inputs>…</Human_inputs>` / `<user_input>…</user_input>` / `<User>…</User>` /
    `<Assistant_response>…</Assistant_response>` / `<assistant_output>…</assistant_output>` /
    `<Assistant>…</Assistant>`。只动气泡渲染、不动落库原文、不动发给 LLM 的 prompt；
    用户脚本先执行，内置脚本最后兜底（不会与用户的同名替换抢手）。只剥配对，不剥裸单 tag，
    避免误伤用户真发的 XML 教学。被排除在 `findDisplayRegexSpans` 的分泡保护之外，
    不会把命中区间当 rich-block 阻碍正常拆泡
  - `utils/regex/engine.looksLikeWrapMisconfig` 启发：`placement.includes(USER_INPUT)` +
    `!markdownOnly && !promptOnly` + `replaceString.length > findRegex.length` → 多半是
    预设作者把「包裹」配成了「改原文」（ST/Moro 语义都会落库）。命中时补丁铺
    （`apps/RegexApp.tsx`）的卡片上显示「⚠ 像在改原文？一键改」
    黄色徽章，点击 → confirm → `promptOnly` 置 true
  - Dev 调试：浏览器控制台 `window.__moroDebugRegex = true`，之后每次正则入口
    （USER_INPUT / AI_OUTPUT 落库前、prompt 组装、气泡渲染）有命中改写时
    `console.debug` 一行 `{ placement, scripts, in, out, isMarkdown, isPrompt }`，
    用于排查「脚本没生效 / 包裹没剥干净」类问题（更全的调试约定见 `docs/dev-debug.md`）

## 界面命名（黑白拼贴手账重构）

桌面入口现名「**补丁铺**」。界面词对照：补丁 = 一条正则脚本、满铺通用 / 随预设 / 只缝给 TA =
全局 / 预设 / 角色作用域、要找的线头 = findRegex、缝上去的布 = replaceString、先剪掉的
线头 = trimStrings、补在哪些布上 = placement、只改表面 / 只改寄出的信 =
markdownOnly / promptOnly、试缝台 = 实时测试、收一箱 / 装箱带走 = 导入 / 导出。
数据结构与挂载点语义不变。
