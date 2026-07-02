# 来往·情侣空间 2.0（Couple Space）

> 改情侣空间相关逻辑前必读。一句话：情侣空间仍挂在 `CharacterProfile.coupleSpace` 上，但「来往」底栏入口现在是一个多空间手账目录，可以浏览、创建、切换多个角色空间，并把动态、约会、饭票、回顾等关系痕迹沉淀进聊天上下文。

## 入口与多空间模型

- 入口仍在「来往」App（`apps/ChatHub.tsx`）底栏「情侣空间」，不新增独立 AppID。
- `localStorage['moro_couple_partner_id']` 只保留为「当前打开的空间」兼容指针，不再代表唯一绑定关系。
- 进入情侣空间先显示空间目录：已有 `CharacterProfile.coupleSpace` 的角色显示为已开空间，没有的角色可点「开空间」初始化。
- 详情页左上可返回目录；右上菜单里的「回到空间目录」只是退出当前查看，不删除该角色已有回忆。
- 数据仍按角色存放：每个角色自己的 `coupleSpace` 独立保存动态、相册、约定、档案、回顾和自动经营状态。

## 数据模型（`types.ts`）

`CoupleSpace` 旧字段继续保留：

- `anniversaryDate`、`intimacy`
- `moments`、`anniversaries`、`photos`、`tasks`
- `whispers`、`wishes`、`questions`、`plant`、`compatBest`
- `interactions`、`createdAt`、`updatedAt`

2.0 新增可选字段，旧空间由 `ensureCoupleSpace()` 兼容补齐：

- `settings?: CoupleSpaceSettings`
  - `autoCareEnabled?: boolean`：`undefined` 视为开启，旧空间和新空间默认允许后台自经营。
  - `theme?: 'scrapbook'`
- `profile?: CoupleProfile`
  - `homeName`、`userNickname`、`charNickname`、`rituals`、`loveLanguage`、`updatedAt`
- `memoryCards?: CoupleMemoryCard[]`
  - 来自约会、饭票、回顾、动态或手动记录，可 `pinned`
- `recaps?: CoupleRecap[]`
  - 周/月关系回顾小报，含 `highlights`、`suggestedTasks`、`suggestedWishes`
- `dailyCheckins?: CoupleDailyCheckin[]`
  - 每日情侣打卡，按 `ymd` 去重
- `autoCare?: CoupleAutoCareState`
  - 记录 `lastRunAt`、`lastMomentAt`、`lastRecapAt`、`lastSource`、`lastSummary`

## 主要视图（`components/couple/CoupleSpace.tsx`）

界面统一为黑白拼贴手账风格，复用 `apps/theater/scrapbook.tsx` 的 `PaperCard`、`ScrapButton`、`Polaroid`、`Stamp` 等组件。照片和头像在目录中可灰阶展示，强调色改为墨黑、米白纸面和灰阶胶带。

页签调整为：

- `今日`：恋爱天数、亲密度、记忆卡数量、今日打卡、每日互动、后台自经营状态、去约会/翻回顾入口、待完成事项。
- `动态`：情侣动态、留言、点赞、评论、心声、多媒体卡片和「请 TA 冒个泡」。
- `相册`：九宫格照片与图片说明。
- `约定`：约定任务和心愿清单合并在同一页。
- `纪念`：在一起纪念日、生日、约定日和 7 天内提醒横幅。
- `档案`：空间名、互相称呼、恋爱小习惯、相处方式，以及最近记忆卡。
- `回顾`：手动生成周回顾，展示历史关系小报。
- `游戏`：默契大考验、街角约会入口、情侣盆栽和成就。

浮动入口仍保留：

- 提问箱：你问 TA 答，答案会进入聊天上下文。
- 悄悄话信箱：更私密的小纸条。

## 后台自经营

后台自经营不新增常驻定时器，只接在现有主动消息 / 离线生活 / 页面离开生活事件链路之后：

- `OSContext` 主动消息成功落库后，会调用 `maybeRunCoupleAutoCare` 对应逻辑。
- 离线生活补齐、离开页面记录、饭票送达等事件也可轻量沉淀到该角色的情侣空间。
- 自动产物只写入情侣空间，不强制额外发聊天消息；原本主动消息会发送时仍走原聊天链路。
- 失败全吞，不阻塞主动消息、离线补齐或饭票流程。

节流策略：

- 每个角色每天最多 1 条自动情侣动态（`lastMomentAt` 按本地日期判断）。
- 每 3 天最多 1 条自动回顾建议（`lastRecapAt`）。
- `settings.autoCareEnabled === false` 时不触发后台自经营。
- 用户手动点「生成周回顾」属于显式操作，不受后台冷却和关闭开关影响。

相关函数在 `utils/coupleSpace.ts`：

- `isCoupleAutoCareEnabled`
- `shouldRunCoupleAutoCare`
- `generateCharCoupleAutoCare`
- `generateCoupleRecap`
- `applyCoupleAutoCareDraft`
- `buildCoupleDateMemoryCard`
- `buildCoupleTakeoutMemoryCard`

新增 API usage id：

- `chat.coupleSpace.autoCare`
- `chat.coupleSpace.recap`

## 聊天上下文注入

`buildCoupleSpacePromptBlock()` 仍只在单聊上下文注入，并且只有空间真正有内容时才注入，避免空噪声。

注入内容包括：

- 恋爱天数、亲密度等级、最近 3 条动态。
- 最近纪念日、未完成约定、未实现心愿。
- 最近提问箱问答、盆栽阶段、未回复悄悄话。
- 2.0 新增：情侣档案固定设定、最多 3 张记忆卡、最多 2 份关系回顾。

提示词文案集中在 `utils/laiwangPrompts.ts` 的情侣空间分区，不在业务 util 内散写 prompt。

## 互动与联动

- 默契大考验题库扩展，`compatBest` 继续记录历史最好成绩。
- 每日情侣打卡写入 `dailyCheckins`，给今日页和回顾生成提供素材。
- 从情侣空间点「去约会」会写入 `localStorage['moro_date_intent_v1']` 并打开 `LifeSim` 的约会视图。
- 街角约会页可点「收进空间」，把当前世界线摘要保存为 `CoupleMemoryCard(kind:'date')`。
- 饭票送达或投喂完成后，如果该角色已有情侣空间，会自动保存一张 `CoupleMemoryCard(kind:'takeout')`。

## 写库并发安全

- UI 内所有空间写入继续走 `mutate(fn, addIntimacy?)`，从 `charactersRef.current` 读取最新角色，再 `updateCharacter(partnerId, { coupleSpace })`。
- 一个同步用户动作尽量只做一次 `mutate`，避免 React 尚未重渲染时用旧 ref 互相覆盖。
- 异步流程中第二次写入放在 `await` 之后，依然基于最新角色数据。

## 关键代码位置

| 文件 | 关键点 |
|------|-------|
| [`components/couple/CoupleSpace.tsx`](../components/couple/CoupleSpace.tsx) | 多空间目录、手账 UI、今日/档案/回顾/游戏页、打卡、设置开关、约会入口 |
| [`utils/coupleSpace.ts`](../utils/coupleSpace.ts) | 数据兼容、提示词注入、角色侧 LLM 调用、自动经营、回顾、记忆卡构建 |
| [`utils/laiwangPrompts.ts`](../utils/laiwangPrompts.ts) | 情侣空间 prompt 文案中心 |
| [`context/OSContext.tsx`](../context/OSContext.tsx) | 主动消息、离线生活、饭票送达后的自动经营接入 |
| [`apps/lifesim/DateView.tsx`](../apps/lifesim/DateView.tsx) | 「收进情侣空间」约会记忆卡 |
| [`apps/LifeSimApp.tsx`](../apps/LifeSimApp.tsx) | 消费情侣空间约会 intent 并打开约会视图 |
| [`types.ts`](../types.ts) | `CoupleSpace` 及 v2 新增子类型 |
