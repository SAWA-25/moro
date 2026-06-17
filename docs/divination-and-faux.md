# 小剧场·占卜 + 番外仿真图文 + 牌面美化

小剧场（`apps/TheaterApp.tsx`）新增的两块内容：**占卜**（和角色一起抽牌/起卦 + 解牌）与**番外·仿真图文**（仿微信/朋友圈/小红书/论坛）。牌面外观在主题 App（`apps/Appearance.tsx`「牌面」页）美化。改这些前看这里。

## 占卜（小剧场 → 占卜）

入口：`TheaterApp` 的 `section='divination'` → `apps/theater/DivinationApp.tsx`。

### 四种模式（`utils/divination/`）

| 模式 | 引擎函数 | 说明 |
|------|---------|------|
| 塔罗(78) | `drawTarot(spread)` | 韦特 78 张，正逆位 + 牌阵（单张/三张/圣三角/凯尔特十字） |
| 雷诺曼(36) | `drawLenormand(spread)` | 36 张，牌阵（单张/三张串读/九宫格） |
| 六爻金钱卦 | `castLiuyao()` | 三枚铜钱摇六爻（6 老阴 / 7 少阳 / 8 少阴 / 9 老阳），本卦 + 动爻 + 变卦 |
| 梅花易数 | `castMeihua({method})` | `time`(时间起卦) / `number`(报数起卦)，体用 + 互卦 + 变卦 |

- **数据**：`utils/divination/cards.ts` —— `TAROT_78` / `LENORMAND_36` 牌义，`HEXAGRAM_BY_KEY`(64 卦，按「上卦bits_下卦bits」查) / `TRIGRAM_BY_BITS` / 先天八卦数映射。三爻 bits 约定：**下爻 = 最低位，阳 = 1**。
- **随机**：`crypto.getRandomValues` + 拒绝采样去偏 + Fisher–Yates（`engines.ts`）。注意这是 app 运行时，可用 crypto；Workflow 脚本里才禁 `Math.random`。
- **解牌**：`utils/divination/interpret.ts` `interpretReading()` —— 走 `resolveAuxApi`（副 API 优先、回退主 API），把牌面/卦象文字 + 问题 + 角色人设 + **世界书**（`WorldbookRuntime.resolveForChar` 取 local+global）组进 prompt，以角色口吻输出。`*ToText()` 把结果转可读文字（解读 + 发到聊天共用）。
- **手动 vs API 解牌**：UI 两个入口——「让 TA 解牌」(API) / `<details>` 里「自己解」(手写 textarea)。解读 + 牌面摘要可「发到聊天」(`DB.saveMessage` system 消息)。

### 牌库（图）

- 塔罗 78 张命名 `0.jpg`~`77.jpg`、雷诺曼 36 张命名 `1.jpg`~`36.jpg`，在占卜 app 的「牌库」子页（`components/theater/divination/CardDeckManager.tsx`）`<input multiple>` 批量导入：`processImage` 压成 dataURL → `DB.bulkSaveDivinationCards`。按文件名首个数字解析 index。
- 存储：IndexedDB `divination_cards` store（`db.ts` v72，keyPath `id=${deck}_${index}`，建 `deck` 索引）。CRUD：`getDivinationCards(deck)` / `saveDivinationCard` / `bulkSaveDivinationCards` / `deleteDivinationDeck`。**未导入也能占卜**（牌面退回文字牌义占位）。
- ⚠️ 牌库**不进全量备份**（与 takeout 同策略）：图是大 base64、可重新导入，避免撑爆导出。

### 牌面美化（主题 App「牌面」页）

`apps/Appearance.tsx` 的 `TarotSkinEditor` → 写 `theme.tarotSkin`：`cardBack`(牌背图 dataURL) / `frame`(none/gold/ink/film) / `renderStyle`(classic/minimal/mystic)。占卜 app 的 `components/theater/divination/TarotCard.tsx` 读这份 skin 渲染牌面（逆位 `rotate-180`）。

## 番外 · 仿真图文（小剧场 → 番外 → 仿真图文）

入口：`apps/theater/ExtraApp.tsx` 的 `mode='faux'`（番外首页新增「仿真图文」卡）。

- 四类：`wechat`(仿"捡手机"微信聊天截图) / `moments`(朋友圈) / `xhs`(小红书图文) / `forum`(匿名论坛)。
- 生成：`utils/theaterExtra.ts` `genFauxPiece()` —— 走副 API，prompt 要求**返回结构化 JSON**，用 `safeApi.extractJson` 容错解析。支持「深扒 char/user 八卦」（注入双方人设 + 关键词）。
- 渲染：`components/theater/faux/FauxRenderers.tsx`（`WeChatScreenshot` / `MomentsCard` / `XhsCard` / `ForumThread`）。**仿真 UI**，配图用灰块占位（无截图库依赖）；用户用手机系统截屏保存。
- **JSON 解析失败兜底**：`FauxResult.data=null` 时退回 `fallbackText` 纯文本展示，不报错。
- 发到聊天：落 system 消息（结构化时发 JSON 文本摘要）。

## 番外 · 题库 & 番外指令库（用户内容仓库）

入口（改内容处）：[`utils/theaterExtraBank.ts`](../utils/theaterExtraBank.ts) —— 一份**给用户填内容**的文件，注释逐项说明怎么加。

- **题库 `QUESTION_BANK`**：`Record<问卷名, 题目[]>`。问卷名自动进「问卷番外」的快捷选项（带「题库」小标）。
  做这份问卷时 `genNextQuestion` **优先按顺序取题库的题、不调 AI**；题库取完（用户想要的题量更多）才自动用 AI 续题；角色仍逐题作答。
- **番外指令库 `EXTRA_INSTRUCTIONS`**：`{ kind, label, instruction }[]`，`kind` 对应番外 8 个 tab（tieba/chatlog/meme/custom + wechat/moments/xhs/forum）。
  「番外工坊」「仿真图文」里渲染成芯片：点芯片＝自己挑，点「🎲 随机挑一条」＝系统（`pickInstruction`）从你的列表里替你选；选中即填进输入框、可再编辑。
- 读取帮手：`bankQuizNames()` / `getBankQuestions(topic)` / `isBankQuiz` / `instructionsForKind(kind)` / `pickInstruction(kind)`。
- 与 prompt 中心的分工：**这里只放「内容」（题、指令）**；番外实际生成用的 prompt 模板在 `utils/theaterPrompts.ts`（[贰] 番外）。

## 验证

`pnpm vitest run utils/divination`（引擎单测：抽牌不重复、六爻齐全、梅花体用/互卦/变卦、卦序映射）。手动：四种占卜各跑一遍；导入几张图测牌库；手动 + API 解牌（开/不开副 API、开/不开世界书）；番外四类各生成一次确认仿真渲染 + JSON 失败回退；主题「牌面」改牌背/边框/风格回占卜确认生效。
