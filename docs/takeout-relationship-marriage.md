# 外卖联动 · 好感框架 · 关系系统 · 求婚与婚姻筹备

这一套把「外卖 App」「来往·偷看心声」「聊天回形针」「岁时记」串成一条感情线。改这些前先读本篇。

## 1. 外卖：送达与现实同步 + 收货才能确认

- 状态机在 `utils/takeout.ts:liveTakeoutStatus`。新增 `arrived`（已到达·待收货）：`now >= etaAt` 只进 `arrived`，**不再自动 `delivered`**。`delivered` 必须有 `deliveredAt`（用户手动确认，或给角色点的单到点后系统自动签收）。
- `TakeoutOrder` 新增 `initiatedBy`('user'|'char')、`cardPosted`、`reactionPosted`（见 `types.ts`）。
- 外卖 App 详情页（`apps/TakeoutApp.tsx`）：`recipient==='me'` 时，确认收货按钮只在 `arrived` 后可点；未到点显示倒计时禁用态。给角色点的单不显示按钮（角色自己签收）。

### 角色收到外卖 → 聊天里反应
`context/OSContext.tsx` 的主动消息 effect 里加了 **takeout watcher**（每 30s + 启动一次）：扫描 `recipient===charId` 且到点未签收的单 → 自动 `delivered` + `reactionPosted`，并用 `runProactive(charId, { customHint })` 让角色像真人收到外卖那样在聊天里反应（`buildTakeoutReceivedHint`）。即使外卖 App 没开也会触发。收到对方点的外卖还会走好感框架 `+2`（日常小温暖）。

`runProactive` 新增第二参 `opts.customHint`：传了就用它当 hint，并跳过「主动消息开关 / 随机模式近期已回复 / 生活事件」等限制（事件驱动的即时反应）。

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
