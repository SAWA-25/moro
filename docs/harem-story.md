# 椒房记（AI 后宫恋爱文字游戏）设计与实现

椒房记是一套由 **AI 实时生成剧情**的后宫恋爱互动小说。入口 `apps/HaremApp.tsx` 直接进入游戏，引擎 `utils/haremStory.ts`，UI `apps/harem/StoryMode.tsx`。

> **改椒房记前必读本文。** 纯逻辑全部在 `utils/haremStory.ts`（可单测，见 `utils/haremStory.test.ts`）；表现层在 `apps/harem/StoryMode.tsx`。游戏存档在 `moro_harem_story`（live 档）+ `moro_harem_story_saves`（多档），不回写真实角色档案（只在开局拿真实 `affection` 当起点）。

游戏目标：后宫恋爱文字互动 + 长线主线探索养成；多角色可攻略；玩家用选择、宫苑行动与宠爱经营台影响剧情；AI 依据**当前 state** 实时生成下一段剧情；游戏记录好感度 / 信任值 / 嫉妒值 / 章节 / 目标 / 资源 / 地图 / 背包线索 / 成就 / 恩宠账 / 记忆 / 事件 flag。

---

## 一、12 个模块（职责 · 输入 · 输出 · 数据格式 · 连接）

| # | 模块 | 落点 | 职责 / 输入 → 输出 |
|---|------|------|--------------------|
| ① | UI 显示 | `apps/harem/StoryMode.tsx` | 消费 `StoryState` 渲染状态栏 / 立绘 / 对话框 / 选项；输入＝state + 用户点击，输出＝调用引擎函数 |
| ② | 剧情推进 | `determineTurnType` + `scheduleCast` + `advanceTime` + `applyChoice` | 输入＝当前 state（+rng）→ 输出＝下一回合的「类型 / 登场角色 / 时辰地点」与落地后的新 state |
| ③ | 角色状态 | `StoryChar` + `deriveAttitude` + `stageOf` | 输入＝四维变量 → 输出＝态度标签 / 关系阶段 |
| ④ | 好感度系统 | `applyChoice` 内 effects 落地 + `clamp100` | 输入＝choice.effects → 输出＝`affection` 增减（0~100 钳制） |
| ⑤ | 信任值系统 | 同 ④（`trust` 维度） | 夜谈 / 破冰 / 危机同舟显著加，背叛 / 谗言显著减 |
| ⑥ | 嫉妒值系统 | 同 ④ + `applyChoice` 的「连带嫉妒」 | 偏宠一人时，在场被冷落者按其好感自动生醋意（落实规则 ⑤⑥） |
| ⑦ | 记忆系统 | `StoryMemory` + `consolidateMemories` | 全局长期记忆 + 角色独立记忆；超上限按「权重 + 近期」固化裁剪 |
| ⑧ | 事件 flag | `state.flags` + `scene.flagUpdates` | AI 标记 / 引擎读取的剧情开关（如 `met_a` / `confessed`） |
| ⑨ | AI 请求 | `buildScenePrompt` | 输入＝state → 输出＝`{system,user}`（把 15 条铁律 + 输出 schema 烧进 prompt），app 用副 API（`resolveAuxApi`+`llmComplete`）发请求 |
| ⑩ | AI 输出解析 | `parseScene` / `fallbackScene` | 输入＝AI 原始文本 → 输出＝稳定 `StoryScene`（恒 3 选项、数值钳制、speaker→charId、空白/坏 JSON 回退兜底） |
| ⑪ | 存档读档 | `reviveStory` / `saveMetaOf` + app 层 localStorage | 全 state 可 JSON 序列化；多档（`moro_harem_story_saves`）由 app 管理；旧档宽松迁移 |
| ⑫ | 结局判定 | `ENDING_DEFS` + `checkEndings` + `computeEndingProgress` | 输入＝state → 输出＝触发的结局 def / 各结局进度 0~100；`buildStoryEndingPrompt`+`parseStoryEnding` 出尾声文 |

**数据流**：`initStory` → `buildScenePrompt` →(AI)→ `parseScene` → 玩家选 → `applyChoice`（落地变量/记忆/flag、推进时辰、定下一回合）→ 回到 `buildScenePrompt`，循环。`determineTurnType` 命中硬结局条件或玩家手动收束时 → `checkEndings` → 结局。

---

## 二、游戏状态 `StoryState`（完整字段）

```jsonc
{
  "version": 1,
  "playthrough": 1,                  // 周目（多周目版，1 起）
  "player": { "name": "萧珩", "title": "陛下", "gender": "female", "persona": "（可选）侧写" },  // 性别开放：male/female/unknown
  "settings": { "style": "dark", "heat": 2, "pace": "mid", "premise": "架空王朝，女帝篡位…" },  // 玩家自定义叙事：风格/尺度0-3/节奏/开场设定
  "day": 3,                          // 第几日
  "time": "晚",                       // 时辰：晨/午/晚/夜（advanceTime 推进）
  "location": "湖心亭",               // 当前场景地点
  "turnType": "date",                // 「即将呈现」这一回合的节奏类型（10 选 1）
  "turnCount": 11,                   // 已经历几幕
  "currentScene": { /* StoryScene，见下 */ },  // 当前展示的 AI 剧情；存档随之保存
  "activeCharacters": ["a"],          // 本回合在场角色 charId（只写在场者，规则 ⑤）
  "characters": {
    "a": {                           // ③ 角色状态
      "charId": "a", "name": "裴砚", "avatar": "…", "gender": "male", "persona": "温润…",  // 性别开放
      "affection": 58,               // ④ 好感 0-100
      "trust": 44,                   // ⑤ 信任 0-100
      "jealousy": 22,                // ⑥ 嫉妒 0-100
      "mood": 63,                    // 心情 0-100
      "attitude": "若即若离",         // 由四维推导（deriveAttitude）
      "stage": "tender",             // 关系阶段 key（stageOf：陌路/相识/亲厚/暧昧/心动/挚爱）
      "memories": [ /* 角色独立记忆 StoryMemory[] */ ],
      "presentStreak": 0,            // 连续未登场幕数（调度公平用）
      "estranged": false,            // 离心：嫉妒爆表 + 久遭冷落 → 淡出后宫
      "flags": { "broke": true }      // 角色级 flag（已突破/已表白…）
    }
  },
  "relationships": [ { "a": "a", "b": "b", "bond": -2 } ],  // 角色之间羁绊（负=不睦正=交好，updateRelationships 演化）
  "focusHint": null,                 // 玩家主动「择幸」指定的下一场焦点角色（一次性，用后即清）
  "memories": [                      // ⑦ 长期/全局记忆（新在前，上限 40 固化）
    { "id": "…", "day": 2, "text": "湖心亭共赏烟火", "weight": 3, "kind": "intimacy", "charId": "a" }
  ],
  "flags": { "met_a": true, "佳节": "上元" },  // ⑧ 全局事件标记
  "history": [                       // 近期回合（滚动 18 条，规则 ⑧「延续历史」）
    { "day": 2, "time": "夜", "location": "寝殿", "turnType": "night_talk",
      "sceneTitle": "灯下私语", "choiceText": "以心换心", "tone": "真诚", "nextIntent": "加深信任" }
  ],
  "route": { "locked": false, "charId": null, "progress": 42 },  // 路线锁定状态 + 进度 0-100
  "endingProgress": { "true_love": 51, "harem": 30, "jealousy_ruin": 22, "cold_lonely": 8 }, // ⑫
  "lastTurn": { "choiceText": "以心换心", "tone": "真诚", "nextIntent": "加深信任" }, // 喂下一轮
  "favorLedger": [ { "day": 3, "time": "晚", "type": "reward", "actionText": "赐赏裴砚", "targetCharIds": ["a"] } ], // 宠爱经营台恩宠账
  "carry": { "fromPlaythrough": 1, "notes": ["你曾独宠沈鸢"] },  // 多周目继承包（首周目为 null）
  "createdAt": 1700000000000
}
```

字段作用速记：`player` 君主身份；`day/time/location` 时空（驱动氛围与节奏）；`turnType/turnCount` 节奏；`currentScene` 当前剧情；`activeCharacters` 在场名单；`characters` 各人四维状态 + 独立记忆；`relationships` 角色间关系；`favorLedger` 恩宠/赏罚/调停记录；`memories` 长期记忆；`flags` 剧情开关；`history` 近期延续；`route` 路线；`endingProgress` 各结局进度；`lastTurn` 上一抉择；`carry` 周目继承。

---

## 三、AI 生成 15 条铁律（写进 `buildScenePrompt` 的 `RULES`）

1. 只能根据当前 state 生成剧情；2. 不能忽略角色设定；3. 不能替玩家做决定（旁白/对白不代玩家行动表态）；4. 不能突然让角色爱上玩家；5. 不能让所有角色都围着玩家转（只写在场角色，允许角色之间有自己的心思）；6. 不能输出超出当前好感/信任阶段的亲密行为；7. 必须依据好感/信任/嫉妒改变态度言行；8. 必须延续最近历史；9. 必须避免重复剧情；10. 每轮输出稳定可 `JSON.parse` 的 JSON 且只输出该 JSON；11. 每轮恰好 3 个选项；12. 每个选项必须有变量影响（effects 至少作用一位在场角色）；13. 可更新记忆 / flag（按需）；14. 不允许直接跳结局——除非本回合 `turnType` 已是 `ending`；15. 必须写成长剧情单幕，有铺垫、动作、情绪推进和回合末尾的选择压力，不得只写剧情梗概。

**节奏由引擎掌控、AI 只管文笔**：`turnType / activeCharacters / time / location` 都在外部（引擎+玩家）定好后才喂给 AI，AI 不能擅自换场或跳结局，从结构上根治「AI 暴走」。解析层 `parseScene` 再兜一道（强制 3 选项、钳制数值、坏 JSON 回退 `fallbackScene`），保证「报错也能玩」。

---

## 四、AI 输出格式 `StoryScene`（稳定 JSON）

```jsonc
{
  "sceneTitle": "灯下私语",
  "mood": "静谧",                                       // 本场氛围词（驱动 UI 氛围条 / 背景微染，可选）
  "narration": "夜雨敲窗，裴砚替你研墨，欲言又止。\\n\\n宫灯照在案角，旧日余波仍压在他眉间……",      // 旁白（2~4 段长剧情，不替玩家说话）
  "dialogues": [ { "speaker": "裴砚", "text": "陛下今夜，怎么睡不着？", "emotion": "柔", "inner": "其实我只想多陪你片刻…" } ],  // inner=没说出口的心声（玩家可偷看，可选）
  "choices": [                                          // 恒 3 个
    { "text": "握住她研墨的手", "tone": "温柔",
      "effects": [ { "charId": "a", "affection": 7, "trust": 4 } ],
      "risk": "mid", "nextIntent": "趁夜色拉近" },
    { "text": "只说些朝政烦心事", "tone": "疏离",
      "effects": [ { "charId": "a", "trust": 2, "mood": -2 } ], "risk": "low", "nextIntent": "维持距离" },
    { "text": "问她可有心事", "tone": "关切",
      "effects": [ { "charId": "a", "trust": 6 } ], "risk": "low", "nextIntent": "引她吐露" }
  ],
  "effectsPreview": "一念之间，亲疏立判",                 // 朦胧提示（不写精确数字）
  "memoryUpdates": [ { "charId": "a", "text": "雨夜替君研墨", "kind": "intimacy", "weight": 3 } ],
  "flagUpdates": { "rainy_night": true },
  "nextSceneHint": "若亲近，可往定情铺垫"
}
```

约束：方便 `JSON.parse`；无多余解释 / 无 Markdown / 无代码块；所有文本都在字段里；`choices` 必为 3；每个 choice 含 `text/tone/effects/risk/nextIntent`。`parseScene` 用 `extractJson`（截断修复 / 去围栏 / 转义内引号）兜底，并 `speaker→charId` 映射、`effects` 数值钳制（好感/信任 ±12、嫉妒/心情 ±15）。

---

## 五、剧情节奏：10 种回合（`TURN_META` + `determineTurnType`）

| 回合 | 触发条件（`determineTurnType`） | 适合角色 | 宜升 | 宜降 |
|------|------|------|------|------|
| 日常 `daily` | 兜底加权随机 | 1~2 人（偏久未登场者） | 好感/信任（小） | — |
| 单人约会 `date` | 加权随机；高好感或久未登场者 | 1 人独处 | 好感(中)/信任/心情 | 撞见则他人嫉妒 |
| 多人同场 `group` | ≥2 角色时进池 | 2~3 人（主角+被冷落者） | 气氛/个别好感 | 被冷落者好感心情、竞争者嫉妒 |
| 嫉妒爆发 `jealousy` | 有人嫉妒≥70 且非刚发作 | 最妒者 + 对手 | 处理得当则信任回升 | 失当则好感信任骤降 |
| 冷战 `cold_war` | 好感尚可但信任<22 或心情<22 | 心情谷底者 1 人 | 破冰则信任大涨 | 僵持则好感心情下滑 |
| 夜谈 `night_talk` | 时辰=夜 且在场有好感≥40 者 | 1 人交心 | 信任(大)/好感/心情 | — |
| 关系突破 `breakthrough` | 在场某人好感≥66 信任≥50 且未突破过 | 该主角 1 人 | 好感信任(大)/阶段跃迁 | 在意者嫉妒上扬 |
| 事件危机 `crisis` | 中期（day≥4、幕≥6）低概率 | 2 人 | 同舟者信任 | 处置不公者好感 |
| 路线锁定 `route_lock` | 领先者好感≥82 信任≥68、领先≥16、day≥6、未锁线 | 该主角 1 人 | 所选之人好感信任封顶 | 落选者好感大跌、嫉妒可能爆 |
| 结局判定 `ending` | `endingReady`（命中任一硬结局条件）或玩家手动收束 | 路线主角 / 全员 | — | — |

每回合的「AI 应该 / 不应该怎么写」写在 `TURN_META[t].guide / avoid`，连同 `raise/lower` 取向一起进 prompt。优先级：结局 > 嫉妒爆发 > 冷战 > 危机 > 路线锁定 > 关系突破 > 夜谈 > 约会/多人/日常（避免与最近一回合重复，落实规则 ⑨）。

---

## 六、UI（`apps/harem/StoryMode.tsx`，宫廷红金纸本文游皮肤）

1. **顶部状态栏**：第 N 日 · 时辰 · 地点 + 菜单钮；下一行是回合徽章 + **氛围徽章(mood)** + 在场角色关系小条 + **「换种写法」**重抽钮。
2. **宫廷舞台**：主界面上半区不再只放空背景，而是固定高度的信息舞台；场景牌显示本场标题、地点、时辰、氛围、章节进度和下一步暗示。
3. **在场角色面板**：在场角色以头像 / 立绘卡展示，说话者描边高亮 + 胶带标记 + 情绪小标 + 离心碎心标；卡内直接显示好感、信任、嫉妒、心情迷你条，并提供「密令」「去见」快捷按钮。
4. **宫廷情报栏**：舞台内展示当前主线 / 支线目标、最近恩宠账、风闻 / 暗线、关系摘要；点情报可打开章节卷轴、宠爱经营台或宫苑地图。
5. **快捷入口**：舞台底部提供「择见」「宠爱」「地图」「章卷」，读完当前一幕即可直接操作，减少只读不玩的空白感。
6. **对话框**：米白纸面大框（小屏会在剩余空间内滚动），旁白斜体、对白墨色；**打字机逐字**（可关）+ **点击推进** + **双击全文**；对白下可浮「👁 心声」。
7. **选项按钮**：读完才出现，3 张大纸卡，附语气 chip、风险三点（稳妥/微澜/行险）、变量影响预览。下方还有**自由行动输入框**、**宠爱经营台**与**「主动去见…」**择幸钮。
8. **菜单按钮**：右上 `List` → 掌事菜单（宠爱经营台 / 宫苑地图 / 章节卷轴 / 背包线索 / 成就册 / 存档读档 / 后宫诸位 / 记忆回顾 / 收束判结局 / 另起新局）。
9. **存档读档界面**：底部纸抽屉，誊抄新页 + 每页（周目/日/幕/君心/定情/时间）读取 / 写覆 / 删除；多档存 `moro_harem_story_saves`（上限 12）。
10. **状态与记忆界面**：角色状态页展示 4 条变量、阶段、态度、离心和记忆；记忆回顾长卷按长期记忆 / 各角色分页显示。

交互要点：第一屏有场景、有角色、有情报、有入口；按钮大、文字清晰、点击推进、双击全文、本地存档——全部满足。

---

## 七、三个增强版（已内置）

- **长期记忆版**：`state.memories` 全局长期记忆，`consolidateMemories` 在超 40 条时按「权重×10 + 近期加成 + 头部加成」打分保留高价值的、丢弃低权重久远的，喂回 prompt 的「近期记忆」。
- **角色独立记忆版**：每个 `StoryChar.memories` 是该角色**自己**记得的事（上限 14），`memoryUpdates` 带 `charId` 时同时写全局与该角色；prompt 的角色名册里以「ta 记得：…」注入，角色据此各有各的记性。
- **多周目版（New Game+）**：结局后「下一周目」→ `startNewGamePlus`/`buildCarry` 抽取上盘高权重记忆 + 锁定路线，打成 `carry`「前尘旧梦」注入下一盘 prompt（角色仍从真实好感重新起步，只带一点「似曾相识」）；`playthrough` 逐周目 +1。

---

## 八、离线兜底

副 API 未配置 / 失败时：剧情走 `fallbackScene`（按当前回合与在场角色现编较完整的兜底小幕 + 3 个温和选项），结局走 `fallbackStoryEnding`（按数据现写尾声 + 每人定语）。全程不卡死，「报错也能玩」。

---

## 九、性别开放 + 玩法增强

### 性别完全开放（不限定玩家与角色性别）

- 类型 `Gender = 'male' | 'female' | 'unknown'`；`player.gender` 与每个 `StoryChar.gender` 各自独立设定，支持 **女帝男妃 / 男帝女妃 / 同性 / 混合后宫** 任意组合。`unknown` = 不指定，由 AI 依人设自行判断。
- 开局 UI：`RULER_PRESETS` 一键选身份（帝王 / 女帝 / 主君 / 女君 / 不限，各带默认称谓），再用 `GenderCycle`（未定 ⇄ 男 ⇄ 女）微调；入选诸位逐位一个 `GenderCycle` 设性别。
- Prompt：system 专设【身份与性别】段，列明玩家与各角色性别、要求**按性别选用相称的称谓与自称**，并**明令「绝不默认所有角色为女性、不默认玩家为男性」**；`unknown` 者让 AI 依人设判断并前后一致。`rosterBlock`/`playerIdentity`/结局 prompt/兜底文案全部去性别化。

### 自由行动（自陈心意）

3 个选项之外，玩家可直接输入一段想做的事 → `applyCustomAction`：以温和效果落地、标记 `lastTurn.custom`、把动作文本作为 `nextIntent` 喂给下一轮（prompt 标注「自由行动」让 AI 顺势展开后果，但仍不替玩家做新决定）。**高自由度，不再被 3 个选项框死。**

### 主动择幸（指定去见谁）

「主动去见…」选一位 → `visitCharacter`（或自由行动里点名某角色被自动识别）→ 设 `focusHint`，下一回合 `determineTurnType`/`scheduleCast` 优先安排与 ta 独处（夜则夜谈），用后即清。把「下一场见谁」的主动权交还玩家。

### 角色羁绊（盟友 / 宿敌）

`relationships` 由预留转为**实用**：`updateRelationships` 每回合按同场 + 嫉妒格局演化 pairwise `bond`（同处且都善妒→结怨、心情都好→生情谊）；`relationshipSummary` 把显著关系（`bondLabel`：知己 / 交好 / 暗中较劲 / 势同水火）注入 prompt 与「后宫诸位」状态页，让后宫有自己的暗流（强化规则 ⑤）。

### 离心 / 回心（冷落的代价）

嫉妒爆表 + 心死（jealousy≥95、mood≤18、trust<25）→ `estranged=true`，该角色淡出日常调度（危机/嫉妒仍可能卷回）；若重获信任与好心情（trust≥42、mood≥46）→ 回心转意。状态页打「离心」标。给「雨露均沾 vs 偏宠」实打实的后果与张力。

### 更多结局

`ENDING_DEFS` 去性别化并新增 **`estranged_collapse`「人心尽失」**（过半角色离心的 bad end）；旧「红颜祸水 / 齐人之福」改中性「醋海覆舟 / 众芳同辉」。

### 叙事设定（自由度：风格 / 尺度 / 节奏 / 开场设定）

`StorySettings = { style, heat 0-3, pace, premise? }`。开局可选**叙事风格**（含蓄古风 / 直白热烈 / 轻松甜宠 / 暗黑虐心 / 江湖侠气）、**尺度**滑杆（清淡→浓烈，亲密描写的上限——但**始终受铁律 ⑥「不得超出当前好感阶段」约束**）、**节奏**（慢热 / 适中 / 迅疾），以及一段**开场设定 / 世界观**自由文本。全部注入 `buildScenePrompt`，让同一批角色能演出截然不同的故事。`reviveStory` 迁移、多周目沿用。

### 富 AI 输出 → 富界面

- **长剧情单幕**：`buildScenePrompt` 要求每幕 `narration` 2~4 段、`dialogues` 4~8 条，包含场景细节、角色动作、话外情绪、关系暗流、上回合后果回响和结尾选择压力；App 请求正文时使用更高 `maxTokens` 与续写轮次，避免只生成剧情梗概。
- **氛围 `mood`**：每场一个氛围词，渲染成状态栏氛围徽章。
- **角色心声 `dialogues[].inner`**：角色没说出口的内心戏，对话读完后以「👁 心声：…」浮现（呼应 App 的「偷看心声」主题）。
- **情绪 `emotion`**：说话者立绘下挂一枚情绪小标。

### 富界面互动

- **打字机逐字显示**：当前一拍逐字浮现，轻点先打完、再点推进、双击全文；菜单里可一键关（偏好持久化 `moro_harem_tw`）。
- **点立绘速览**：点任一在场角色 → 弹出 ta 的四维速览 + 「详看全部 / 去见 ta」。
- **换一种写法**：对当前这场不满意，顶栏「换种写法」用**相同状态**重抽一遍（`requestScene` 不推进剧情，只换文笔）。
- 立绘说话者上浮高亮 + 情绪标 + 离心碎心标。

---

## 十、长线主线探索养成大版本

### 新增状态

`StoryState` 新增：

- `chapter`：8 章长线结构，终章「终局定鼎」在第 60 日后进入收束窗口。
- `objectives`：主线 / 支线目标，记录进度、完成状态与资源奖励。
- `resources`：轻量养成资源，含 `power` 宫权、`reputation` 声望、`silver` 库银、`energy` 心力、`rumor` 风闻。
- `map`：宫苑地点解锁、访问次数与最后访问地点。
- `inventory`：线索、信物、诏令、赏赐等剧情物。
- `achievements`：成就册与结局收藏。
- `mapIntent`：玩家本次从地图选择的探索意图，喂给下一轮 AI，一次性使用。

旧档由 `reviveStory` 自动迁移：缺字段时补初始章节、默认资源、初始地图、空背包、空成就，不要求清档。

### 宫苑地图

地图地点由 `PALACE_LOCATIONS` 管理，随日期与章节解锁：

- 初始：椒房殿、御花园。
- 中期：尚宫局、藏书阁、掖庭回廊、太医署、内府宝库。
- 后期：宗祠、前朝丹陛。

玩家读完当前一幕后可打开「宫苑地图」，选择探访、会面、理宫务、听风闻、赐物、休整、推进主线等行动。`applyMapAction` 会把行动转成一次合规回合：消耗或恢复资源、记录访问、指定下一幕地点与节奏，并把 `mapIntent` 注入 prompt。

### 宠爱经营台

`favorLedger` 记录最近 60 条恩宠、赏罚与调停。顶部快捷入口、剧情底部快捷入口和掌事菜单都可打开「宠爱经营台」。预设谕旨是确定性机制，先走 `previewFavorAction` 展示资源、角色与关系后果，确认后 `applyFavorAction` 转成 synthetic scene，经 `resolveTurn` 统一推进时辰、资源、记忆、章节与下一幕意图。

预设谕旨：

- `summon` 召见：心力 -8、风闻 +2；目标好感 +4、信任 +1、心情 +2。近两日反复召见同一人时风闻额外 +3，高好感旁人嫉妒 +2。
- `reward` 赐赏：库银 -12、风闻 +1；目标好感 +5、心情 +4；高好感旁人嫉妒 +2。
- `protect` 护持：宫权 -8、声望 -2；目标信任 +6、嫉妒 -4、心情 +3。
- `cool` 冷处理：声望 +1、风闻 -4、心力 +4；目标好感 -3、信任 -2、嫉妒 -10、心情 -4。
- `mediate` 调停：心力 -10、声望 +3、风闻 -4；双方信任 +2、嫉妒 -6、心情 +2，双方 `bond` +10。
- `balance` 普赏安宫：库银 -18、心力 -8、声望 +4、风闻 -6；最多 6 人好感 +1、心情 +3、嫉妒 -4。

自拟谕旨走 AI 判官入口 `entryPoint: "favor"`，确认后同样写入 `favorLedger`。`buildScenePrompt` 与 `buildActionJudgementPrompt` 都注入最近 8 条恩宠账，让 AI 后续能接住偏宠、赏罚、护持与调停的后果。

### AI 输出扩展

`StoryScene` 仍以 narration / dialogues / choices 为核心，但允许 AI 额外返回：

- `resourceDelta`：资源变化；解析层只接收白名单键并钳制幅度。
- `objectiveUpdates`：目标进度；无 id 时默认推进当前主线。
- `inventoryUpdates`：线索 / 信物；写入 `inventory`，按 id 去重。
- `achievementUpdates`：成就落印；写入 `achievements`，按 id 去重。

AI 只建议变化，实际落地统一走 `parseScene` 与 `resolveTurn` 的钳制逻辑。章节、地图、终局窗口仍由引擎控制，避免 AI 跑偏。

### AI 判官 / 宫廷导演

自由行动不再只走温和兜底。玩家从多个入口发起行动时，UI 先调用副 API 的「宫廷判官」流程：

1. `buildActionJudgementPrompt` 将当前章节、资源、地图、目标、角色关系、背包线索、已有暗线 / 风闻 / 临时 NPC 与玩家行动一起喂给 AI。
2. AI 只返回结构化 `StoryActionJudgement`，不写下一幕正文。
3. `parseActionJudgement` 用白名单解析资源、角色、地点、目标、线索、成就、暗线、风闻和 NPC；非法 id 忽略，过大数值钳制，坏 JSON 返回 `null`。
4. UI 展示「判词预览」：风险、代价、收益、牵动人物、可能入库内容。玩家确认后才调用 `applyActionJudgement` 落地；取消不改存档。
5. 判词流程失败时，剧情自由行动回退旧 `applyCustomAction`；其它入口只提示失败，不落档。

新增状态：

- `generatedHooks`：AI 半自动生成的支线 / 阴谋 / 地点事件 / 角色事件钩子，带稳定 id、来源、生成日、过期日、摘要与可选关联地点 / 角色。
- `rumors`：宫中风闻，带热度、真相摘要、来源和有效期。
- `npcStubs`：局内临时 NPC 名片，不回写真实角色档案。
- `pendingJudgement`：UI 判词预览暂存，确认后清空。
- `favorLedger`：宠爱经营台恩宠账，记录预设谕旨与自拟谕旨的对象、资源变化、人物影响与关系影响。

新增入口：

- 剧情底部自由行动。
- 宠爱经营台的自拟谕旨。
- 宫苑地图每个地点的「谋划」。
- 角色抽屉 / 立绘速览的「密令 / 邀约」。
- 背包线索的「追查 / 使用」。
- 章节目标的「请 AI 出谋划策」。

`expireGeneratedHooks` 会按 `expiresDay` 清理过期暗线、风闻和临时 NPC；`reviveStory` 会为旧档补空数组、空 `pendingJudgement` 和空 `favorLedger`。

### 终局节奏

普通圆满结局不再在前期触发：`true_love`、`harem`、新增 `imperial_pact`「凤阙定鼎」等需要第 60 日后或 `chapter.finaleReady`。灾难结局仍可较早出现，但阈值后移，给长线养成留出空间。

### UI

`apps/harem/palaceSkin.tsx` 是椒房记专用宫廷红金组件，不改共享 `insScrapKit`，避免影响其它 App。`StoryMode` 新增：

- 顶栏章节进度 + 五项资源。
- 宠爱经营台抽屉：恩宠格局摘要、六种预设谕旨、角色列表、自拟谕旨、最近恩宠账。
- 宫苑地图抽屉。
- 章节卷轴抽屉。
- 背包线索抽屉。
- 成就册抽屉。
- 判词预览弹窗：展示 AI 判官对自由行动的风险、代价、收益与入库内容，确认后才落地。
