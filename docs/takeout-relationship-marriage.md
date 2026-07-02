# 外卖联动 · 好感框架 · 关系系统 · 求婚与婚姻筹备

这一套把「外卖 App」「来往·偷看心声」「聊天回形针」「岁时记」串成一条感情线。改这些前先读本篇。

> **⚠️ 外卖 App 已更名「饭票」并整体换肤为「黑白拼贴手账」。** 桌面名 `饭票`（`constants.tsx`，图标 `ForkKnife`）。
> `apps/TakeoutApp.tsx` 完全重写界面与文案（店名/按键图案/按键位置/口吻全部原创为手账口吻），但**不改、不减任何原功能**；
> 视觉积木复用 `apps/theater/scrapbook.tsx`（与折子戏同一套黑白拼贴手账套件），食物 emoji 一律去色成灰阶。
> 文案词表：订单＝「饭票/票根」、订单列表＝「票根夹」、菜篮/购物车、撕票下单、盖章签收、食评/食客留言墙、申诉条、跑腿（骑手）/铺子（商家）/平台。
> 状态词集中在 `utils/takeout.ts:STATUS_LABEL`/`etaText`（灶上忙着/跑腿在路上/到门口·待签收/已签收/已作废），改这里即同步聊天小票（`MessageItem`）与灵动岛（`DynamicIsland`）。
> 聊天小票（`MessageItem.tsx:TakeoutCardView`）同步换成黑白「饭票·票根」纸票。

## 1. 外卖：送达与现实同步 + 收货才能确认

- 状态机在 `utils/takeout.ts:liveTakeoutStatus`。新增 `arrived`（已到达·待收货）：`now >= etaAt` 只进 `arrived`，**不再自动 `delivered`**。`delivered` 必须有 `deliveredAt`（用户手动确认，或给角色点的单到点后系统自动签收）。
- `TakeoutOrder` 新增 `initiatedBy`('user'|'char')、`cardPosted`、`reactionPosted`（见 `types.ts`）。
- 外卖 App 详情页（`apps/TakeoutApp.tsx`）：`recipient==='me'` 时，确认收货按钮只在 `arrived` 后可点；未到点显示倒计时禁用态。给角色点的单不显示按钮（角色自己签收）。

### 角色收到外卖 → 聊天里反应
`context/OSContext.tsx` 的主动消息 effect 里加了 **takeout watcher**（每 30s + 启动一次）：扫描 `recipient===charId` 且到点未签收的单 → 自动 `delivered` + `reactionPosted`，并用 `runProactive(charId, { customHint })` 让角色像真人收到外卖那样在聊天里反应（`buildTakeoutReceivedHint`）。即使外卖 App 没开也会触发。收到对方点的外卖还会走好感框架 `+2`（日常小温暖）。

`runProactive` 新增第二参 `opts.customHint`：传了就用它当 hint，并跳过「主动消息开关 / 随机模式近期已回复 / 生活事件」等限制（事件驱动的即时反应）。

如果收货角色已经开过「来往·情侣空间」，送达 / 投喂完成还会额外沉淀一张情侣记忆卡（`CoupleMemoryCard(kind:'takeout')`）。这张卡只写进对应角色的 `CharacterProfile.coupleSpace.memoryCards`，不强制额外发聊天消息；之后情侣空间「档案」页和聊天上下文会把它当作两个人的日常痕迹。

## 2. 聊天回形针「点外卖」+ 外卖订单小票（实时 + 灵动岛）

- 回形针「特别通道」加了 **点外卖**（`components/chat/ChatInputArea.tsx` → `onPanelAction('takeout')`）。Chat 里 `handlePanelAction('takeout')` 用 `setTakeoutIntent({recipientCharId})` 存一次性意图后 `openApp(Takeout)`；`TakeoutApp` 挂载时 `consumeTakeoutIntent()` 预设收货角色。
- 下单（关联角色时）在聊天里生成 **外卖订单小票卡片**：`utils/takeout.ts:postTakeoutPlacedToChat` 落 `type:'takeout_card'` 消息（角色为用户点 = assistant 侧；用户为角色点 = user 侧）。
- **小票实时更新**：`components/chat/MessageItem.tsx:TakeoutCardView` 自带 10s 计时 + 监听 `TAKEOUT_UPDATED_EVENT`，从 DB（`DB.getTakeoutOrder`）拉最新订单，状态/ETA/进度条跟现实同步刷新；查不到回退快照。点小票 → `Chat.tsx:handleOpenTakeoutCard` 弹详情。
- **灵动岛 Live Activity**：`components/os/DynamicIsland.tsx` 在有进行中订单（`pickActiveOrders`）时，于胶囊下方显示一枚骑手胶囊（店名 + 状态 + ETA + 跑动进度点），点开进外卖 App；送达/确认后自动消失。
- 订单变化用 `notifyTakeoutUpdated()` 广播（下单 / 送达 / 评价 / 角色代点），小票与灵动岛即时刷新。

## 2b. 外卖 App 丰富化 + 评价 + 其它 NPC 评论

- 更多店铺品类与菜品（早餐 / 西餐 / 麻辣烫 等，`SEEDS` + `CATS`）。
- **店铺评价**：店铺详情页底部「大家的评价」展示按店名稳定生成的 NPC 评价（`generateStoreReviews`：评分向店铺整体分靠拢、含商家回复、点赞数）。
- **订单评价**：送达后（仅自己那份）可「评价此单」——星级 + 快捷标签（`reviewQuickTags`）+ 文字，存 `TakeoutOrder.review`。
- **其它 NPC 评论**：发表评价后 `generateReviewReplies` 生成商家回复 + 1~2 条其它食客评论，挂在 `review.replies`，在订单详情里展示。

## 2c. 「饭票」换肤时新增的玩法（不改原功能，纯增量）

- **抽张饭票**（首页）：替你随机翻一家进店点菜（在当前筛选结果里随机），治选择困难。
- **钉在墙上的常去铺子**：店铺详情可「钉住」，按店名存 `localStorage('moro_takeout_pinned_v1')`（`getPinnedStores`/`togglePinnedStore`）；首页顶端列出钉住的铺子，点一下直达（不在当前街上就转成搜索词）。
- **照着再撕一张（再来一单）**：订单详情按旧票重建一个临时铺子 + 菜篮，直接进结算。
- **备注快捷条**：结算页一串可点的备注芯片（少辣/多放饭/放门口…）追加进留言。
- **给跑腿塞小费**：结算页可选小费（`TakeoutOrder.tip`，计入 `total`，被强制砍单时随 `total` 原路退回）；靠谱跑腿收到小费后回话更暖（`buildDeliveryReply` 注入 tip 提示，含本地兜底 `CANNED_RIDER_TIPPED`）。
- **Prompt 加料**：`generateStoresAI`（店名更有烟火气/菜品写卖点/黑心店伪装更真）、`buildDeliveryReply`（跑腿/铺子/平台人设更鲜活 + 小费感知）、`laiwangPrompts.ts` 的 `proactiveTakeoutOrder`/`takeoutReceivedHint`（按天气时辰挑吃食、收到投喂的反应更具体）。

## 2d. 对标美团外卖的功能/界面补全（不改原功能，纯增量；统一黑白拼贴手账皮肤）

> 设计哲学不变：**保留美团的「功能」，把「外观」换成手账皮肤**。这一批把美团点餐里仍缺的环节补齐，新增逻辑全在 `utils/takeout.ts`（纯函数，带 `takeoutSku.test.ts`），界面落在 `apps/TakeoutApp.tsx`，视觉积木继续复用 `theater/scrapbook.tsx`。

- **首页金刚区（品类宫格）**：`KINGKONG`（App 内常量）一格直达一类铺子（美食/早餐/汉堡快餐/奶茶/甜品/麻辣烫/烧烤夜宵/火锅/轻食/买药），用 `Stamp` 邮票格呈现，点一下 `setCat`。`CATS` 顶部 chip 补上「药品」。
- **搜索历史 + 热门搜索**：搜索框聚焦且为空时弹一张纸卡——`getSearchHistory`/`pushSearchHistory`(去重置顶,上限10,`localStorage moro_takeout_search_history_v1`)/`clearSearchHistory` + `TAKEOUT_HOT_SEARCHES`。点词即现搜全城。
- **菜品选规格 / 加料（SKU 弹层）**：`TakeoutDish` 新增 `specs?`(单选组,选项带 `priceDelta`)、`addons?`(多选,按份加价)、`monthlySales?`。`deriveDishOptions(name)` 按菜名确定性推断（饮品→甜度/冰量+小料；饭/面→份量[+辣度]+加料；麻辣烫/串→辣度+加料；普通辣菜→辣度）；`decorateDishes` 在本地种子与 AI 现搓店两条管线统一挂载。点「选规格」开 `PaperSheet`，`dishUnitPrice`/`formatSpecAddon`/`cartLineKey` 算单价、落人话描述、按「菜+规格+加料」分行 key。`TakeoutOrderItem` 新增 `spec?`/`addons?`（`price` 已含差价，聊天小票/详情向后兼容）。
- **购物车浮层**：菜篮袋点开 `PaperSheet`，逐行 +/-、清空饭篮、去结算。购物车状态由 `Record<dishId,number>` 升级为 `Record<lineKey,CartLine>`（同菜不同规格各占一行）。
- **店铺分页（点餐 / 评价 / 商家）**：`storeTab` 切换；评价页＝原食客留言墙，商家页＝品类/评分/月售/送达/起送/距离/营业/优惠 + 街坊提醒。菜篮搁板上方显示**满减凑单进度**（`parseStorePromo`：「再买 ¥X 享…」/「已享…省 ¥X」）。
- **结算补全**：**预约送达**（`deliveryTimeSlots` 生成「尽快 + 今日半点时段」，落 `TakeoutOrder.scheduledAt` 并据此定 `etaAt`，详情显示「预约 HH:MM 送达」）；**餐具份数**（`TakeoutOrder.tableware`，0＝无需餐具）；**地址卡**（`TakeoutAddressCard` + `getAddressCards`/`saveAddressCard`/`deleteAddressCard`/`setDefaultAddressCard`，`localStorage moro_takeout_address_cards_v1`，自己和每个角色各有独立虚拟收货点；旧 `moro_takeout_addresses_v1` 字符串地址会自动迁移，旧订单只保留 `TakeoutOrder.address` 快照）。
- **订单骑手实时轨迹小地图**：`RiderTrackMap`（铺子🏪→你家🏠 虚线路线 + 跑腿按时间进度跑动），配在详情进度条上方；送达后隐藏。

## 3. 聊天设置「角色主动为用户点外卖」开关

`ConvoSettings.proactiveTakeoutOrder`（`types.ts`），开关在 `components/chat/ConvoSettingsPanel.tsx`。开启后：
- `utils/context.ts` 注入提示词，允许角色输出 `[[TAKEOUT_ORDER: 菜品/店铺]]`。
- 后处理 `utils/applyAssistantPostProcessing.ts`（Step 1.75）剥离并派发 `TAKEOUT_ORDER_EVENT`；`OSContext` 监听 → `synthesizeCharOrder` 合成订单（recipient=me, payer=char）+ 落小票。
- 关闭则 `OSContext` 的 handler 直接 return，永不触发。

## 4. 好感度加减框架（`utils/relationship.ts`）

- `applyAffectionEval(prev, proposed, {decisive})`：把模型给的好感**绝对值**收敛——日常每次变化 ≤ `AFFECTION_DAILY_CAP(5)`，决定性事件放宽到 `AFFECTION_DECISIVE_CAP(35)`。首次评估直接采纳基准。
- `applyAffectionDelta(prev, delta, {decisive})`：事件驱动的增减（如收到外卖 +2），同样按 cap 截断。
- 接入点：`apps/Chat.tsx:generateInnerVoice`（偷看心声评估链路）。提示词强调好感长期平稳、只有决定性事件才大波动，并让模型给 `decisive` 标记。

## 5. 关系系统（来往·偷看心声）

- `CharacterProfile.relationship: RelationshipState`（stage + 中文 label + 变更简史），阶段见 `RelationshipStage`。
- AI 自动更新两条路：
  1. **偷看心声评估**（`generateInnerVoice`）顺带给 `relationship`，经 `sanitizeRelationshipUpdate` 收敛——`lover/ex/estranged` 只能在 decisive 时进入；`engaged/married` 评估链路一律拒绝；高好感未交往兜底成 `crush`(暧昧)。
  2. **聊天决定性指令** `[[REL: stage | label]]`（表白/分手/决裂）→ 后处理派发 `RELATIONSHIP_EVENT` → `OSContext` 落库。
- 展示在偷看心声面板（`apps/Chat.tsx` 心声 modal 的「你们的关系」徽标）。

## 6. 求婚（回形针 + 浪漫界面）

- 前提：`canPropose(char)` = 好感满 100 且未订婚/已婚、非断裂态。
- 用户发起：回形针「求婚」→ 撰写誓言 → `sendUserProposal` 落 `proposal_card`(from:user) → `decideCharProposal`（专用一次性 AI 调用，按人设/剧情决定 accept/reject + 台词）→ 更新卡片 + 角色回应 +（成功）订婚。
- 角色发起：满好感且「想更进一步」时输出 `[[PROPOSE: 誓言]]` → 后处理派发 `PROPOSAL_EVENT` → `OSContext` 生成 `proposal_card`(from:char)。
- 任一方的小卡点开 → `components/chat/ProposalOverlay.tsx` 浪漫全屏界面。角色求婚时用户在此「我愿意 / 再想想」（`respondToCharProposal`，注入隐藏提示后 `triggerAI` 让角色反应）。

## 7. 婚姻筹备期 + 岁时记·喜事页

- 求婚成功 → `finalizeEngagement`：relationship=engaged，`CharacterProfile.marriage: MarriageState`（stage/proposalBy/engagedAt/weddingDate/milestones），并写岁时记纪念日 + 日历贴纸。
- 婚姻筹备期聊天上下文（`utils/context.ts:buildRelationshipPromptBlock`）让角色商量婚期/领证/婚礼，节奏贴合现实，用 `[[WEDDING_PLAN: kind | YYYY-MM-DD | 备注]]` 推进（`MARRIAGE_PLAN_EVENT` → `OSContext` 更新里程碑/阶段 + 岁时记）。
- 岁时记新增「喜事」栏目：`apps/almanac/WeddingSection.tsx`（在 `apps/AlmanacApp.tsx` 注册），按角色展示订婚日、关系、婚期倒计时（与现实匹配）与婚事时间线。

## 跨模块事件名

定义在 `utils/relationship.ts` / `utils/takeout.ts`，由后处理派发、`OSContext` 监听：
`RELATIONSHIP_EVENT` / `PROPOSAL_EVENT` / `MARRIAGE_PLAN_EVENT` / `TAKEOUT_ORDER_EVENT`。
新增指令记得同步加进 `utils/sanitize.ts` 的兜底剥离，避免标签泄漏到气泡。
