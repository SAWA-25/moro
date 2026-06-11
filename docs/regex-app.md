# 正则 App（SillyTavern Regex 移植）

SillyTavern 正则脚本系统的完整移植：脚本数据结构、执行引擎与 ST 对齐，
酒馆导出的正则 JSON（单条对象或数组）可直接导入，角色卡内自带的正则
（`data.extensions.regex_scripts`）随卡导入时自动同步为角色局部脚本。

## 文件地图

| 文件 | 职责 |
|------|------|
| `utils/regex/engine.ts` | 纯函数引擎：`regexFromString` / `runRegexScript` / `getRegexedString` / `normalizeRegexScript`，与 ST `extensions/regex/engine.js` 一一对应 |
| `utils/regex/store.ts` | 全局脚本存取（localStorage `moro_global_regex_scripts`）、`applyRegexToText` 一站式入口、导入导出 |
| `apps/RegexApp.tsx` | 正则 App UI：全局/角色两个作用域、增删改、启停、导入导出、实时测试 |
| `types.ts` | `RegexScriptData` 接口、`AppID.Regex`、`CharacterProfile.regexScripts` |

## 两个作用域（同 ST GLOBAL / SCOPED）

- **全局**：对所有角色生效，存 localStorage。保存后广播
  `REGEX_SCRIPTS_UPDATED_EVENT`，聊天页监听刷新显示层。
- **角色局部**：`char.regexScripts`，随角色进 IndexedDB / 备份。
  ST 卡导入时 `sillyTavernCard.ts` 解析 `extensions.regex_scripts` 填充。

执行顺序：全局在前、局部在后。

## 聊天管线四个挂载点

脚本的 `markdownOnly` / `promptOnly` 决定它落在哪个挂载点（与 ST 语义一致，
两者都不勾 = 直接改写消息原文）：

1. **用户发送** `apps/Chat.tsx` handleSendText — `USER_INPUT`，落库前改写原文
2. **AI 输出** `utils/applyAssistantPostProcessing.ts` Step 1.4 — `AI_OUTPUT`，落库前改写原文（在 BLOCK_USER 等指令剥离之前）
3. **提示词组装** `utils/chatPrompts.ts` buildMessageHistory — 仅 `promptOnly` 脚本，带 `depth`（0 = 最后一条）供 minDepth/maxDepth 过滤
4. **气泡渲染** `apps/Chat.tsx` displayMessages — 仅 `markdownOnly` 脚本，传给 MessageItem 前替换 content，不动原文

另外世界书注入走 `utils/worldbookRuntime.ts` resolveForChar 末尾的
`WORLD_INFO` placement。

## 与 ST 的差异

- 宏只支持 `{{user}}` / `{{char}}` / `{{match}}`（Moro 没有完整宏系统）
- `SLASH_COMMAND` / `REASONING` placement 可勾选但暂无挂载点
- 没有 ST 的「角色卡脚本需用户授权」弹窗：随卡导入的脚本直接生效，
  可在正则 App「角色」标签里逐条停用/删除
