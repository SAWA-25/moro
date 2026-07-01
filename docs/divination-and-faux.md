# 折子戏·占卜 + 番外仿真图文 + 牌面美化

折子戏（`apps/TheaterApp.tsx`）新增的两块内容：**占卜**（和角色一起抽牌/起卦 + 解牌）与**番外·仿真图文**（仿微信/朋友圈/小红书/论坛，也可扩到微博热搜、QQ 空间、豆瓣小组、校园墙、备忘录、日程表、订单小票和搜索页）。牌面外观在主题 App（`apps/Appearance.tsx`「牌面」页）美化。改这些前看这里。

## 占卜（折子戏 → 占卜）

入口：`TheaterApp` 的 `section='divination'` → `apps/theater/DivinationApp.tsx`。

### 四种模式（`utils/divination/`）

| 模式 | 引擎函数 | 说明 |
|------|---------|------|
| 塔罗(78) | `drawTarot(spread)` | 韦特 78 张，正逆位 + 牌阵（单张/三张/圣三角/关系镜像/双路抉择/七日流向/凯尔特十字） |
| 雷诺曼(36) | `drawLenormand(spread)` | 36 张，牌阵（单张/三张串读/五张线列/小十字/七张线列/九宫格） |
| 六爻金钱卦 | `castLiuyao()` | 三枚铜钱摇六爻（6 老阴 / 7 少阳 / 8 少阴 / 9 老阳），保留每爻三枚铜钱字背 + 本卦 + 动爻 + 变卦 |
| 梅花易数 | `castMeihua({method})` | `time`(时间起卦) / `number`(报数起卦)，体用 + 互卦 + 变卦；UI 支持随机报数 |

- **数据**：`utils/divination/cards.ts` —— `TAROT_78` / `LENORMAND_36` 牌义，`HEXAGRAM_BY_KEY`(64 卦，按「上卦bits_下卦bits」查) / `TRIGRAM_BY_BITS` / 先天八卦数映射。三爻 bits 约定：**下爻 = 最低位，阳 = 1**。
- **随机**：`crypto.getRandomValues` + 拒绝采样去偏 + Fisher–Yates（`engines.ts`）。注意这是 app 运行时，可用 crypto；Workflow 脚本里才禁 `Math.random`。
- **本地速读**：`utils/divination/insights.ts` —— 抽牌 / 起卦后不等 API，先给本地可读的提要与追问建议。塔罗看大阿卡纳比例、主花色、逆位和落点；雷诺曼看首尾事件链、中心牌和关键牌；六爻看铜钱轨迹、动爻层级、本卦/变卦；梅花看体用五行关系、互卦和变卦。UI 在 `DivinationApp` 的结果卡里显示「LOCAL READING」，追问建议会填入问题或追问框。
- **解牌**：`utils/divination/interpret.ts` `interpretReading()` —— 走 `resolveAuxApi`（副 API 优先、回退主 API），把牌面/卦象文字 + 问题 + 角色人设 + **世界书**（`WorldbookRuntime.resolveForChar` 取 local+global）组进 prompt，以角色口吻输出。`*ToText()` 把结果转可读文字（解读 + 发到聊天共用）。
  - ⚠️ **解牌截断**：推理模型先在 `<think>` 里吃掉一大截 token，预算太小正文只显示半句。解牌走 `utils/llmComplete.ts` 的 `llmComplete`（`maxTokens:4096 + continueRounds:3`）：被 `finish_reason='length'` 截断会**自动接着写完**。⚠️ 很多 OpenAI 兼容代理 `stream:false` 下**不回 `finish_reason`**（给 null），这时 `llmComplete` 用启发式兜底——正文停在半句（结尾不是句末标点 / 引号 / 收尾括号）就继续续写（`looksTruncated`，有单测 `utils/llmComplete.test.ts`）；`finish_reason='stop'` 则一律信任、不强续。改解牌长度/续写策略去那里，别只调一个 `max_tokens`。
- **解牌 + 抽牌后「继续和角色对话」**：UI 入口「让 TA 解牌」(API) 给一段完整解读后，下面变成一个**对话框**——可继续追问，角色顺着**同一副牌**口语化回应（不再有旧的「自己解」手写框，已删）。
  - 实现：`DivinationApp` 持 `convo:{role:'user'|'char';text}[]`，`ask(userMessage?)` 统一处理「首解 / 追问」：把 `convo` 映射成 `ReadingTurn[]` 历史传给 `interpretReading({..., history})`；`history` 非空时 `divinationInterpretSys({conversational:true})` 让角色围绕已抽的牌继续聊、篇幅可短。回车 / 点发送即追问。整段对话「发到聊天」。
- **洗牌 + 抽牌交互**：塔罗/雷诺曼点「抽牌」进 `components/theater/divination/CardPicker.tsx`——**全屏接管**（`absolute inset-0 z-[80]`，盖住整个占卜页，不再挤在小拼贴框里；`DivinationApp` 把它作为 `<PaperShell>` 的兄弟 overlay 渲染）。两段式，仿实体占卜 App 的「洗牌花 + 抽牌牌轮」：
  - **① 洗牌（bloom）**：一朵向日葵螺旋铺开的「牌花」，点牌堆 / 点「洗牌」即重洗——整朵旋转重排（可反复），洗到有感觉再「下一步·抽牌」。牌花整朵轻微摇曳（`animate-sway`）+ 呼吸光晕（`animate-tarot-glow`）+ 散落星芒明灭（`animate-tarot-twinkle`），idle 也有仪式感。
  - **② 抽牌（wheel）**：一个巨大的「牌轮」——背面牌沿大圆弧排成密环、只露顶部一段（区域 `flex-1` 撑满全屏剩余高度），左右**拖动转动**（pointer 拖拽，松手吸附到最近一张），正中那张放大 + 上浮 + 强光晕 + 高光循环扫过（`animate-tarot-sheen`）+ 轻盈浮动（`animate-tarot-float`）、落在顶部聚光里、顶上有指针；凭直觉**点一张抽出**，按牌阵位置逐张抽，抽中的牌 `dealIn` 落进上方位置格子，抽满翻开。
  - **牌的尺寸（仿 Quin 等占卜 App 的大牌堆手感）**：牌花/牌轮的牌都做大了一圈，几何常量在文件顶部 —— `BLOOM_CARD_W`(牌花单牌宽)、`WHEEL_CARD_W` + `WHEEL_FOCUS_GROW`(牌轮单牌宽/聚焦额外加宽)、`BLOOM_SIZE/MAX_R`、`WHEEL_R/STEP/VIS` 集中可调。
  - ⚠️ **不溢出**：牌花与牌轮都裹在 `overflow:hidden` 容器里，牌再多 / 再大也只在框内被裁掉；放大牌时同步调 `BLOOM_SIZE`/`WHEEL_TOP_PAD` 留白即可。牌轮点选靠容器 pointer 事件在 pointerdown 时抓 `data-cidx`，不依赖 click 合成（pointer capture 也不影响）。聚焦牌的浮动动画放在**内层**包裹元素（不与外层定位 transform 打架）。顶部留白用 `--chrome-top` 让开 Moro 状态栏。
  - ⚠️ keyframe（`tarotSheen`/`tarotTwinkle`/`tarotFloat` 等）定义在 `index.html` 的 Tailwind 配置里，新增动画去那加。
  - 皮肤＝折子戏黑白拼贴深底 + 去色牌背（牌背图同 skin，取不到回退 CSS 黑白牌背）。`DivinationApp` 只持有当前洗好的那副牌，CardPicker 回传「按位置选中的索引序列」→ `tarotFromPicks`/`lenormandFromPicks` 落阵。六爻/梅花仍是直接起卦、无挑牌。

### 牌库（图）

- **内置默认塔罗牌面**：仓库自带整副公版韦特塔罗（Rider–Waite–Smith，1909 公有领域），放在 `public/tarot/0.jpg`~`77.jpg`，按 `TAROT_78` 的 index 命名（0~21 大阿卡纳、22~35 权杖、36~49 圣杯、50~63 宝剑、64~77 星币；小牌 01=Ace…10=Ten、11=侍从、12=骑士、13=王后、14=King）。`TarotCard.tsx` 的 `defaultTarotFace(index)` 给出 `/tarot/${index}.jpg`。**开箱即用、不必导入**。
- **内置默认雷诺曼牌面**：雷诺曼没有自带牌面图，于是用每张牌「传统对应的那张扑克牌」当牌面代替（36 张 Petit Lenormand 牌角自古就印着一张小扑克：1骑士=9♥、2三叶草=6♦…）。仓库自带整副公版扑克牌图（Byron Knoll 扑克牌，公有领域，来源 GitHub `hayeah/playing-cards-assets`），放在 `public/lenormand/{number}.png`（按 `LENORMAND_36` 的 number 1~36 命名），`TarotCard.tsx` 的 `defaultLenormandFace(number)` 给出 `/lenormand/${number}.png`，**开箱即用、不必导入**；牌号·牌名由 `CardFace` 显示在牌面下方。`LenormandSpreadView` 给 `CardFace` 传 `aspect="222 / 323"`(扑克牌比例，不裁切) + `faceBg`(米白底，衬透明圆角)。映射表 `LENORMAND_PIP` 与纯 CSS 扑克牌组件 `LenormandDefaultFace`（牌角索引 + 居中大点数/花色）也在 `TarotCard.tsx`，作图加载失败时的兜底。
- 牌面取图优先级：**用户导入的自定义图 → 内置默认牌面（塔罗=韦特图 / 雷诺曼=对应扑克牌 PNG）→ CSS 兜底牌面 → 文字占位**（`CardFace` 无 `img` / `<img onError>` 时走 `fallback`，雷诺曼即 CSS 扑克牌 `LenormandDefaultFace`；连 `fallback` 都没有才回退 🔮 占位）。
- 塔罗 78 张命名 `0.jpg`~`77.jpg`、雷诺曼 36 张命名 `1.jpg`~`36.jpg`，在占卜 app 的「牌库」子页（`components/theater/divination/CardDeckManager.tsx`）`<input multiple>` 批量导入即可**覆盖**内置图：`processImage` 压成 dataURL → `DB.bulkSaveDivinationCards`。按文件名首个数字解析 index。
- 存储：IndexedDB `divination_cards` store（`db.ts` v72，keyPath `id=${deck}_${index}`，建 `deck` 索引）。CRUD：`getDivinationCards(deck)` / `saveDivinationCard` / `bulkSaveDivinationCards` / `deleteDivinationDeck`。
- ⚠️ 用户导入的牌库**不进全量备份**（与 takeout 同策略）：图是大 base64、可重新导入，避免撑爆导出。内置默认牌面是静态资源，不入库。

### 牌面美化（主题 App「牌面」页）

`apps/Appearance.tsx` 的 `TarotSkinEditor` → 写 `theme.tarotSkin`：`cardBack`(牌背图 dataURL) / `frame`(none/gold/ink/film) / `renderStyle`(classic/minimal/mystic)。占卜 app 的 `components/theater/divination/TarotCard.tsx` 读这份 skin 渲染牌面。
- **抽牌结果＝大牌面 + 3D 翻牌揭示**（仿 Quin 等实体占卜 App）：`CardFace` 先背面朝上（牌背图 = `skin.cardBack` 或 `DEFAULT_CARD_BACK`），逐张错峰 `rotateY(180→0)` 翻面（`backface-visibility:hidden` + `preserve-3d`），配柔光光晕（`animate-tarot-glow`）+ 一次性高光扫过（`animate-tarot-shine`）+ 轻微浮动（`animate-tarot-bob`，错峰相位）。三个 keyframe 定义在 `index.html` 的 Tailwind 配置里。
- 牌面尺寸按牌阵张数自适应（`widthFor`：单张最大 200px、越多越小、横向可滚），比旧版（112px）明显增大。逆位＝牌面 `rotate(180deg)` + 右上「逆位」角标。`TarotSpreadView` / `LenormandSpreadView` 接收 `cardBack` 作翻牌背面。

## 番外 · 工坊（折子戏 → 番外 → 番外工坊）

入口：`apps/theater/ExtraApp.tsx` 的 `mode='piece'`（番外首页「番外工坊」卡）。

- 纯文本生成：`utils/theaterExtra.ts` `genExtraPiece()` —— 走副 API，生成后可「再生成」或「发到聊天」落 system 消息。
- 模板类型：`ExtraKind` 目前包含 `tieba`(贴吧帖) / `chatlog`(聊天记录) / `meme`(热梗) / `interview`(采访稿) / `barrage`(弹幕实况) / `diary`(私密日记) / `letter`(未寄信) / `tabloid`(小报) / `timeline`(时间线) / `script`(脚本) / `casefile`(档案) / `custom`(自定义)。
- 工坊调味：UI 里有 `tone`（原味 / 甜 / 整活 / 酸涩 / 悬疑）、`length`（短 / 标准 / 长篇）、`pov`（自动 / TA / 我 / 第三 / 旁观）。这些参数以 `ExtraWorkshopOptions` 传给 `utils/theaterPrompts.ts` 的 `extraPiecePrompt()`，作为软约束；`custom` 里若用户长指令和调味冲突，以用户指令为准。
- 长篇策略仍在 `utils/theaterExtra.ts`：`genExtraPiece()` 使用 `maxTokens:4096 + continueRounds:5`，适合承接「不少于 N 千字」的长篇番外指令；改截断续写策略去 `utils/llmComplete.ts`。
- UI 注意：`PIECE_TABS`、调味选项常量放在模块级；不要把可作为 JSX 元素的组件定义进 `ExtraApp` 组件体内，避免 `useOS()` 每秒 re-render 时重挂子树闪屏。

## 番外 · 仿真图文（折子戏 → 番外 → 仿真图文）

入口：`apps/theater/ExtraApp.tsx` 的 `mode='faux'`（番外首页新增「仿真图文」卡）。

- 十二类：`wechat`(仿"捡手机"微信聊天截图) / `moments`(朋友圈) / `xhs`(小红书图文) / `forum`(匿名论坛) / `weibo`(微博热搜) / `qzone`(QQ 空间) / `douban`(豆瓣小组) / `campus`(校园墙) / `memo`(备忘录) / `schedule`(日程表) / `receipt`(订单小票) / `browser`(搜索页)。
- 生成：`utils/theaterExtra.ts` `genFauxPiece()` —— 走副 API，prompt 要求**返回结构化 JSON**，用 `safeApi.extractJson` 容错解析，再经 `normalizeFauxData(kind, data)` 轻量兜底数组长度、数字和缺失字段。支持「深扒 char/user 八卦」（注入双方人设 + 关键词）。
- 渲染：`components/theater/faux/FauxRenderers.tsx`（`WeChatScreenshot` / `MomentsCard` / `XhsCard` / `ForumThread` / `WeiboHotCard` / `QzoneCard` / `DoubanThread` / `CampusWallCard` / `MemoScreen` / `ScheduleScreen` / `ReceiptScreen` / `BrowserResults`）。**仿真 UI**，配图用灰块占位（无截图库依赖）；用户用手机系统截屏保存。
- **JSON 解析失败兜底**：`FauxResult.data=null` 时退回 `fallbackText` 纯文本展示，不报错。
- **本地历史**：每次生成都会保存为 `TheaterFauxPiece` 到 IndexedDB `theater_faux_pieces`，最近生成排在前，可打开预览、删除、按原模板和关键词再生成，也会进入全量备份 / 恢复。
- 发到聊天：落 system 消息，使用 `formatFauxExport(piece)` 生成可读摘要；结构化结果不再直接把原始 JSON 丢进聊天。
- ⚠️ **闪屏坑（已修）**：`ExtraApp` 里 `Page` / `CharPicker` / `InstructionRow` 这类积木**必须放在组件外**（模块级）。放进组件体内 → 每次 render 都是新组件标识 → React 把 `<Page>` 整棵子树（含 `PaperShell` 的 `animate-fade-in`）卸载重挂；而 `useOS()` 的 `virtualTime` 每秒一跳逼着 `ExtraApp` 每秒 re-render，于是问卷/工坊/仿真图文三个子页**每秒重放淡入＝一直闪屏**。任何用 `useOS()` 的全屏 App 都别在组件体内定义会被当 JSX 元素用的子组件。

## 番外 · 题库 & 番外指令库（用户内容仓库）

入口（改内容处）：[`utils/theaterExtraBank.ts`](../utils/theaterExtraBank.ts) —— 一份**给用户填内容**的文件，注释逐项说明怎么加。

- **题库 `QUESTION_BANK`**：`Record<问卷名, 题目[]>`。问卷名自动进「问卷番外」的快捷选项（带「题库」小标）。
  做这份问卷时 `genNextQuestion` **优先按顺序取题库的题、不调 AI**；题库取完（用户想要的题量更多）才自动用 AI 续题；角色仍逐题作答。
  - 题库元信息在 `QUESTION_BANK_META`：标题、标签、说明、推荐人数会展示在新建问卷页；`quizBankMeta()` 会自动补 `questionCount`，没有元信息的旧 / 自定义题库仍按「自定义问卷」兼容。
  - 标签筛选走 `bankQuizTags()` / `bankQuizNamesByTag(tag)`；当前内置题库包括恋爱相性、同居日常、吃醋与安全感、吵架复盘、未来计划、朋友局互损、无厘头默契和深夜灵魂拷问。
  - ⚠️ **角色作答/AI 出题防截断**（修「回答显示不全」）：`genCharAnswer`（`maxTokens:1200 + continueRounds:3`）、`genNextQuestion`（`maxTokens:800 + continueRounds:2`）都走 `utils/llmComplete.ts`——推理模型先在 `<think>` 里吃 token，预算太小正文只剩半句；被长度截断会自动续写写完（同解牌那条坑）。改作答/出题长度去这两处，别只调一个 `maxTokens`。
- **问卷访谈测试数据兼容**：不新增 IndexedDB store，也不升 `DB_VERSION`；只扩展 `TheaterQuizSession` 可选字段。
  - 新问卷默认写入 `settings:{ flow:'interview_test', hostEnabled:true, peerReviewEnabled:true, resultEnabled:true, contentScale:'mixed' }`；旧历史缺 `settings` 时由 `normalizeTheaterQuizSession()` 归一化为 `classic` 轻量问卷，关闭主持、互评和结尾画像。
  - 每题可带 `TheaterQuizItem.hostNote`，由 `genQuizHostNote()` 生成主持开场 / 转场短句。UI 只在有内容时显示，旧题没有也能打开。
  - 角色互评走 `genCharPeerReview()`：支持「回应我」「回应 TA」和「全员互评一轮」，结果仍落在本题 `comments`，用 `targetSpeakerId` 标记回应对象。
  - 完成报告走 `genQuizResult()`，结果存 `TheaterQuizSession.result`，包含总分、维度分、亮点、摩擦点和建议；`parseQuizResult()` 优先解析结构化 JSON，解析失败时把原文放进 `fallbackText` 作为纯文本画像展示。
  - 画像报告是娱乐向总结，不作为严肃心理测评、关系判断或现实建议。
- **番外指令库 `EXTRA_INSTRUCTIONS`**：`{ kind, label, instruction }[]`，`kind` 对应番外工坊的纯文本模板（tieba/chatlog/meme/interview/barrage/diary/letter/tabloid/timeline/script/casefile/custom）和仿真图文模板（wechat/moments/xhs/forum/weibo/qzone/douban/campus/memo/schedule/receipt/browser）。
  「番外工坊」「仿真图文」里渲染成芯片：点芯片＝自己挑，点「🎲 随机挑一条」＝系统（`pickInstruction`）从你的列表里替你选；选中即填进输入框、可再编辑。
  - **长篇番外指令**（`kind:'custom'`，如「不少于 10000 字」的整段创作简报）：番外工坊「自定义」的 `genExtraPiece` 已放宽到 `maxTokens:4096 + continueRounds:5`（`utils/llmComplete.ts`），被长度截断会自动续写写完；`custom` 的 sys 文案（`utils/theaterPrompts.ts` 的 `extraPiecePrompt`）也要求严格照办指令里的字数/格式/不得 OOC。
- 读取帮手：`bankQuizNames()` / `quizBankMeta(topic)` / `bankQuizTags()` / `bankQuizNamesByTag(tag)` / `getBankQuestions(topic)` / `isBankQuiz` / `instructionsForKind(kind)` / `pickInstruction(kind)`。
- 与 prompt 中心的分工：**这里只放「内容」（题、指令）**；番外实际生成用的 prompt 模板在 `utils/theaterPrompts.ts`（[贰] 番外）。

## 验证

`pnpm vitest run utils/divination`（引擎单测：抽牌不重复、扩展牌阵位置数量一致、六爻铜钱轨迹齐全、梅花体用/互卦/变卦、卦序映射、本地速读有提要和追问建议）。手动：四种占卜各跑一遍；导入几张图测牌库；检查问法灵感、随机报数、本地速读追问芯片；手动 + API 解牌（开/不开副 API、开/不开世界书）；番外工坊挑几类模板生成并切换调味确认 prompt 生效；仿真图文挑几类模板各生成一次确认仿真渲染 + JSON 失败回退；主题「牌面」改牌背/边框/风格回占卜确认生效。
