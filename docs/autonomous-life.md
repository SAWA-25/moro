# 来往·角色离线自主生活（Autonomous Life）

> 改「主动消息 / 离线推送 / 角色日常」相关逻辑前必读。
> 一句话：让聊天角色在用户离线时**过自己的日子**，主动消息从 TA 正在经历的生活里取材，
> 而不是每次到点就「你怎么不理我」式地围着用户转。

## 它解决什么

旧的主动消息（「悄悄来信」）到点时，会给角色注入一条 *「现在主动找用户」* 的系统提示
（`OSContext.tsx` 的 proactive 流程），本质就是催用户回复。久了角色显得很「黏人」、没有自己的生活。

自主生活在这条链路前面插了一个 **agent**：先让角色的生活往前走一格（生成一件 TA 正在经历的小事），
主动消息再从这件事取材——角色于是「分享自己的生活」，也可能只是顺口说说自己，不一定扯到用户身上。

## 三个出口

1. **主动消息取材**（在线 / 离线推送都走这条）
   - proactive 触发 → `advanceLife()` 生成 1 条 `CharLifeEvent` 落库 → `buildAutonomousProactiveHint()`
     把这件事包成系统提示 → 角色基于「我刚刚/正在做 X」开口。
   - 这条事件标记 `surfacedAsMsg = true`（回顾里显示「已跟你说过」）。

2. **离线动态回顾**（「你不在时 TA 经历了…」时间线）
   - 用户离线 ≥ `CATCHUP_MIN_GAP_MS`（默认 2 小时）回来时，`catchUpOfflineLife()` 一次 LLM 调用
     补齐这段时间发生的若干件事（按时间均匀铺开，已扣掉 proactive 期间生成的，避免重复）。
   - 聊天顶部出现「🌱 TA 在你离开时经历了 N 件事」横幅 → 点开 `LifeRecapModal` 看时间线。

3. **线上聊天上下文注入**（线下 ↔ 线上「关联」的关键）
   - 进入正常聊天时，`buildRecentLifeContextBlock()` 把角色近 ~36h 的若干条生活事件拼成一段
     注入 system prompt（文案 `recentLifeContextIntro`，见 laiwangPrompts [3]），由 `chatPrompts.ts`
     的 `buildSystemPrompt` 与天气/日程/日记等并发取数后一起拼上。于是**线上聊天时角色知道自己
     这段时间在过什么日子**，能自然提起 / 被影响，而不是线上、线下两套互不相通。仅对开了自主生活、
     且近期确有事件的角色生效；失败/无事件返回空串、绝不拦主 prompt。
   - UI 侧：`往来`（ChatHub）会话列表对开了自主生活的角色显示一行「此刻 · TA 在做什么」绿点状态
     （最近一条事件、够新才显示），把线下生活一眼带到列表里。

## 开关与成本

- 入口：聊天「悄悄来信」弹窗里的 **「让 TA 过自己的生活」** 开关（`proactiveConfig.autonomousLifeEnabled`，
  `undefined` 视为开启）。它是「悄悄来信」的子特性——必须先开启主动消息。
- **「线下」生成默认走副 API**（`resolveLifeApi` 优先级：角色自带副 API `proactiveConfig.secondaryApi`
  > 全局副 API `auxApiConfig`（文具盒）> 主 API 兜底）。即只要文具盒配了副 API，离线生活/补齐就默认
  走副 API——和占卜/生活侧写等「主聊天以外的辅助任务」一致，省主 API 额度、也不与线上聊天抢同一根线。
- prompt 短、`max_tokens` 小、失败全吞。**自主生活只是锦上添花，绝不能影响主聊天**——生成失败时
  proactive 自动回退到旧的「主动找用户」hint。
- 每个角色最多保留 `MAX_KEPT_EVENTS`（默认 200）条，超出由 `DB.pruneLifeEvents` 修剪。

## 离线弹窗 + 浏览器授权（Chrome / Edge）

- 离线消息的系统通知走**已有链路**：`OSContext` 的 `proactive-message-sent` → Service Worker
  `registration.showNotification`（页面级 `new Notification` 在后台/PWA 会静默失败）。
- 缺的是**授权引导**：以前权限没给就静默 no-op。现在「悄悄来信」弹窗里加了
  **「离线也能收到弹窗」** 卡片，一键 `Notification.requestPermission()`，并按 `detectBrowser()`
  提示「电脑版 Chrome / Edge 体验最好」。helper 在 `utils/browserNotify.ts`。
- 不强制部署任何 worker：本地标签页/SW 活着即可弹窗；要「浏览器完全关闭也能收」仍可叠加部署
  `worker/proactive-push`（见其 README）。

## 关键代码位置

| 文件 | 关键点 |
|------|-------|
| [`utils/autonomousLife.ts`](../utils/autonomousLife.ts) | agent 本体：`advanceLife` / `catchUpOfflineLife` / `buildAutonomousProactiveHint` / **`buildRecentLifeContextBlock`（线下→线上注入）** / `isAutonomousLifeEnabled` / `resolveLifeApi`（**默认副 API**）；prompt、JSON 解析、时间戳铺排都在这 |
| [`utils/chatPrompts.ts`](../utils/chatPrompts.ts) | `buildSystemPrompt` 里调 `buildRecentLifeContextBlock` 把「近来的线下生活」并进线上聊天 system prompt（与天气/日程/日记并发取数后拼接） |
| [`utils/browserNotify.ts`](../utils/browserNotify.ts) | 通知权限查询/申请、Chrome/Edge 识别、`showLocalNotification`（SW 优先） |
| [`apps/ChatHub.tsx`](../apps/ChatHub.tsx) | 「往来」会话列表：私聊行显示「此刻 · …」线下生活状态绿点（`lifeStatus`）；列表行错峰淡入 + 底栏 tab 选中动效 |
| [`context/OSContext.tsx`](../context/OSContext.tsx) | proactive 触发处接 `advanceLife`（走 `resolveLifeApi`→默认副 API）+ 生成 hint；另有「离线回看补齐」useEffect（可见性/focus/启动时按 gap 触发 `catchUpOfflineLife`，派发 `autonomous-life-catchup` 事件） |
| [`components/chat/LifeRecapModal.tsx`](../components/chat/LifeRecapModal.tsx) | 回顾时间线 UI；`countUnseenCatchup` / `markLifeRecapSeen` 给横幅用 |
| [`components/chat/ProactiveSettingsModal.tsx`](../components/chat/ProactiveSettingsModal.tsx) | 「让 TA 过自己的生活」开关 + 浏览器通知授权卡片 |
| [`apps/Chat.tsx`](../apps/Chat.tsx) | 顶部回看横幅、`life-recap` 面板动作、`LifeRecapModal` 挂载 |
| [`utils/db.ts`](../utils/db.ts) | `char_life_events` store（v69）+ `saveLifeEvent` / `getLifeEvents` / `getLifeEventsSince` / `markLifeEventSurfaced` / `pruneLifeEvents` / `deleteLifeEventsForChar` |
| [`types.ts`](../types.ts) | `CharLifeEvent` 接口；`proactiveConfig.autonomousLifeEnabled` |

## 数据流速记

```
[fixed/random 间隔到点 or 离线 wake push]
        │
        ▼  OSContext proactive 触发
  isAutonomousLifeEnabled(char)? ──否──▶ 旧 hint：「现在主动找用户」
        │是
        ▼
  advanceLife() ──失败──▶ 旧 hint（回退）
        │成功（得到 CharLifeEvent）
        ▼
  buildAutonomousProactiveHint() → 角色「分享自己的生活」→ 正常 AI 流程发消息
        │
        └─ 事件标记 surfacedAsMsg

[用户离线 ≥2h 回来 / 重开页面]
        │
        ▼  OSContext「回看补齐」useEffect（每段 gap 只补一次，localStorage 互斥）
  catchUpOfflineLife() → 批量补齐离线事件（扣掉已生成的）
        │
        ▼  派发 autonomous-life-catchup
  Chat.tsx 顶部横幅「TA 在你离开时经历了 N 件事」→ LifeRecapModal 时间线
```
