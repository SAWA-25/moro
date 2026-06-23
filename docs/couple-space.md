# 来往·情侣空间（Couple Space）

> 改情侣空间相关逻辑前必读。一句话：在「来往」App 里给 user 和某个 char 开一个**类似 QQ 情侣空间**的小天地
> —— 恋爱天数、亲密度、情侣动态、纪念日倒计时、九宫格相册、每日互动、约定、悄悄话，
> 数据持久化并注入聊天上下文，让 char「知道」并据此扮演 + 主动互动。

## 入口与导航

- 入口在「来往」App（`apps/ChatHub.tsx`）聊天列表底部导航，**「此刻」右侧**新增第 4 个 tab「情侣空间」（粉色 `Heart` 图标）。
- 底部导航从 `grid-cols-3` 改为 `grid-cols-4`；`hubTab` 类型加 `'couple'`；顶部标题栏 / 返回按钮 / 状态栏复用列表视图原有结构（与其它 tab 一致）。
- tab 选中时内嵌渲染 `<CoupleSpace />`（与「此刻」内嵌 `MomentsFeed` 同一套做法），不新增独立 AppID。

## 绑定模型

- **一次绑定一位「另一半」**：当前绑定的 charId 存在 `localStorage['moro_couple_partner_id']`（UI 指针）。
- **数据按角色存**：情侣空间数据挂在 `CharacterProfile.coupleSpace`（每个角色一份）。所以**解绑不丢回忆**——
  重新绑定同一个 char 时动态/纪念日/相册都还在；换人只是切换展示的那份数据。
- 未绑定时显示「选择另一半」列表（恋人/暧昧/订婚/已婚关系的角色排前面，带 💗 标记）。首次绑定给该角色初始化一份空 `coupleSpace`。

## 数据模型（`types.ts`）

`CoupleSpace` 挂在角色上，含：`anniversaryDate`（在一起纪念日 YYYY-MM-DD）、`intimacy`（亲密度，0 起无上限）、
`moments`（动态/留言板）、`anniversaries`（纪念日/生日/约定日）、`photos`（九宫格相册）、`tasks`（约定）、
`whispers`（悄悄话信箱）、`wishes`（愿望清单/心愿）、`questions`（提问箱问答）、`interactions`（每日互动记录）。
子类型：`CoupleMoment` / `CoupleComment` / `CoupleAnniversary` / `CouplePhoto` / `CoupleTask` / `CoupleWhisper` /
`CoupleWish` / `CoupleQuestion` / `CoupleInteraction`。

> **子功能（标签页 / 浮窗）**：动态 · 纪念日 · 相册 · 约定 · **心愿（愿望清单）** · **成就（里程碑徽章，纯计算）**
> ＋浮窗：**提问箱（你问 TA 用 AI 答）** · 悄悄话信箱。

- `CoupleMoment` 额外带 `media?: CoupleMedia`（多媒体卡片：`voice` 语音条 / `music` 音乐 / `item` 物件·照片，
  含 `name`、语音另有 `duration`）和 `innerVoice?`（角色对该条动态的「心声」独白，**点击多媒体块时懒生成、缓存后复用**）。

## UI·极简白 + 粉紫渐变皮肤（`components/couple/CoupleSpace.tsx`）

整套界面走「干净极简白（`#FAFAFA`）+ 温柔粉紫渐变强调（`ACCENT = linear-gradient(135deg,#ff9a9e→#fecfef)`）」，
圆润无衬线字（Quicksand / PingFang SC），正文 `#333`、次要信息 `#999`，容器 `max-w-[480px] mx-auto` 居中适配 PC 预览。

- **顶部羁绊区**：右上角菜单（`List ≡`，开设置/解绑；返回 `<` 由 ChatHub 外层标题栏提供）、两枚 50px 头像（粉色发光阴影
  `0 4px 12px rgba(255,182,193,.4)`）中间一条 **SVG 心电图（ECG）连线**——`stroke-dasharray`+`stroke-dashoffset`
  做 `@keyframes csEcg` 亮色脉冲从左向右持续流动；下方居中「在一起 X 天」+ 纤细亲密度条。
- **时间线动态卡**：顶部居右绝对时间戳（`YYYY.MM.DD HH:mm`，12px `#A0A0A0`）、左侧 30px 头像、加粗昵称、正文，
  多媒体块（语音/音乐/物件卡，圆角 12px、极浅粉紫底、`active:scale-[0.98]` 按压反馈）、评论区（`昵称：内容`，昵称加粗）。
- **「心声」弹窗**（隐藏交互，点任意多媒体块 / 图片 / 卡片底「心声」触发）：毛玻璃遮罩
  （`rgba(255,255,255,.8)`+`backdrop-filter:blur(8px)`）右上 `X`；**两阶段**——阶段 1 几根粉色竖条（音轨均衡器
  `@keyframes csEq`）跳动约 1.5s「读取心声中」；阶段 2 黑色心声卡（`#222`/白字/圆角 16/深阴影）以
  `translateY(20px)→0`+`opacity 0→1`（`@keyframes csVoiceCard` 0.4s ease-out）浮现，顶部「{TA} の 心声」+ 一段独白。

- **亲密度**按每 `INTIMACY_PER_LEVEL=100` 一级展示（Lv + 头衔「初识→神仙眷侣」+ 级内进度条）。
  增长来源：每日互动（亲 6 / 抱 5 / 牵手 4 / 礼物 8）、完成约定 +5、**实现心愿 +8**、发动态 +3、**提问箱提问 +3**、角色互动/评论 +1~2、发悄悄话 +2。
  这是情侣空间**独立的**度量，**不**走 `utils/relationship.ts` 的好感框架（affection），互不干扰。

## 角色侧「主动互动」（`utils/coupleSpace.ts`）

一组**失败全吞**的一次性 LLM 调用（走全局副 API，`resolveAuxApi(auxApiConfig, apiConfig)`；失败时组件用模板兜底）：

| 触发 | 函数 | 行为 |
|------|------|------|
| 用户发动态 | `generateCharCoupleComment` | 角色自动点赞 + 评论那条动态 |
| 用户留悄悄话 | `generateCharWhisperReply` | 角色回一条悄悄话 |
| 用户在提问箱提问 | `generateCharQuestionAnswer` | 角色以恋人身份答一句（失败用 `fallbackQuestionAnswer` 兜底） |
| 用户亲一下/抱一下/… | `generateCharInteractionNote` | 角色给一句即时反应（节流 6s，过频用模板，避免刷 token） |
| 点「请 TA 冒个泡」 | `generateCharMoment` | 角色**主动发**一条情侣动态（JSON `{text, mood, media?}`，可选附带语音/音乐/物件卡） |
| 点多媒体块 / 「心声」 | `generateCharInnerVoice` | 角色对该条动态的私密内心独白（点击触发，懒生成→写回 `moment.innerVoice` 缓存；失败用 `fallbackInnerVoice` 兜底） |

> 这些是 char「在情侣空间发动态 / 回复留言 / 发起互动」的落点。没做后台自主调度（不挤占 token / 不动 OSContext 调度器）——
> char 自发内容由「请 TA 冒个泡」按钮显式触发，对用户动作的回应则即时跟随。

## 注入聊天上下文（`utils/coupleSpace.ts:buildCoupleSpacePromptBlock`）

- `utils/context.ts` 在 `buildRelationshipPromptBlock` 之后、**仅单聊**（`!groupOptions?.skipUserProfile`）注入一段
  「来往·情侣空间」系统提示：恋爱天数、亲密度等级、最近 3 条动态、最近的纪念日倒计时、未完成约定、**未实现的心愿**、
  **提问箱近来的问答（让 char 言行与自己答过的话保持一致）**、用户**还没被回**的悄悄话。
- 只有空间真正有内容（设了纪念日 / 亲密度>0 / 有任意条目）才注入，避免空噪声。
- 让 char 把这些当真实恋爱点滴，聊天里自然提起（某条动态、快到的纪念日、没做完的约定、想圆的心愿、答过的问题、TA 的悄悄话）。

## 写库并发安全（`components/couple/CoupleSpace.tsx`）

- 所有写入走 `mutate(fn, addIntimacy?)`：从 `charactersRef.current`（最新角色）读出 `coupleSpace`，
  经 `fn` 合成新值后 `updateCharacter(partnerId, { coupleSpace })`。
- **一个用户动作只做一次同步 `mutate`**：两次连续同步写会因 React 尚未重渲染读到旧 ref 而互相覆盖
  （已踩坑修复 `toggleTask` 完成加分、`doInteraction` 节流分支——都合并成单次写入）。
  异步流程（发动态→角色评论、发悄悄话→角色回信、互动→角色反应）中两次写之间隔着 `await`，重渲染已发生，安全。

## 关键代码位置

| 文件 | 关键点 |
|------|-------|
| [`components/couple/CoupleSpace.tsx`](../components/couple/CoupleSpace.tsx) | 主 UI：绑定页 / 双头像+恋爱天数+亲密度头卡 / 每日互动 / 动态·纪念日·相册·约定·心愿·成就 子 tab / 提问箱·悄悄话信箱浮窗 / 各弹窗 |
| [`utils/coupleSpace.ts`](../utils/coupleSpace.ts) | 纯逻辑：默认值、恋爱天数、纪念日倒计时、亲密度等级、互动定义、提示词块、角色侧 LLM 生成 |
| [`apps/ChatHub.tsx`](../apps/ChatHub.tsx) | 底部导航第 4 个入口 + 标题 + 内嵌渲染 |
| [`utils/context.ts`](../utils/context.ts) | 单聊上下文里注入 `buildCoupleSpacePromptBlock` |
| [`types.ts`](../types.ts) | `CoupleSpace` 及子类型；`CharacterProfile.coupleSpace` |
