Original prompt: 先继续优化都市人生 simsapp：去掉 pics 里的丑像素家具/房屋贴图，改成自己画的像素图；并把“吃瓜”从单纯调用 API 引导 char 行动，升级为随机触发“角色剧情”或“主线剧情”，主线剧情要有明显标题和附件栏，附件可包含图片、道具、证据、同人文等。

2026-03-19
- Removed the hardcoded building PNG override in `utils/tinyTownTiles.ts` so LifeSim now uses generated pixel-style town tiles instead of `pics` house textures.
- Added story attachment types, world-drama prompt helpers, fallback attachment generation, and `materializeStoryAttachments` so main-plot events can drop image/item/evidence/fanfic payloads.
- Added `apps/lifesim/StoryAttachments.tsx` for compact attachment cards plus a modal detail viewer.
- Wired `apps/LifeSimApp.tsx` so `吃瓜` now randomly branches into either normal char-driven drama or a no-char main-plot event from `主线编剧室`.
- Seeded replay actions correctly for the new branch and moved `runCharTurns` above the user action handlers to avoid referencing it before initialization.
- Added a no-API fallback for char turns so the sim no longer gets stuck when external model settings are empty; chars will still produce lightweight “围观” replay entries.
- Updated the drama feed and replay overlay to surface main-plot badges, headlines, and attachment shelves.
- `npm run build` passes after the LifeSim changes.
- Automated Playwright validation is currently blocked because `C:\Users\tiaotiao\.codex\skills\develop-web-game\scripts\web_game_playwright_client.js` cannot resolve the `playwright` package in this environment.
- Added drama filters (`全部 / 角色 / 主线 / 系统`) and changed the normal drama log to keep the full scrollable history instead of truncating to 50.
- Added a LifeSim settings panel for selecting which external characters are allowed to participate in the sim.
- Added long-press NPC editing so residents can be edited in-place for this run (name / gender / personality / bio / backstory).
- Replaced the browser-native reset confirm with a custom retro dialog that can either reset directly or generate a LifeSim ending summary card before resetting.
- Added a new `lifesim_reset_card` score-card payload and wired it through chat rendering plus readable archive/context formatting in Chat / Character / chat prompt history.
- Text attachments like fanfic/evidence now surface the original text as the primary reading area in the attachment modal.
- Adjusted `apps/lifesim/DramaFeed.tsx` so main-plot actions also remain visible in the left-hand dynamic stream under `全部 / 主线`, instead of being excluded from `drama.log`.
- Restyled the LifeSim reset summary card in `components/chat/MessageItem.tsx` to look more like the game's retro pseudo-window UI (sharper borders, title bar, grid texture, status bar).
- `npm run build` still passes after the latest DramaFeed + chat-card styling changes.
- Automated browser validation is still blocked locally because `require('playwright')` fails with `MODULE_NOT_FOUND`.

- Removed LifeSim's autonomous NPC interaction step from the main turn flow, so only user-triggered actions and char/main-plot API turns advance the story now.
- Added LifeSim-specific independent API settings with global preset loading and a Gemini Flash recommendation, and persisted them on the LifeSim state so city resets do not wipe the app-specific config.
- Reworked `apps/lifesim/DramaFeed.tsx` again so `主线历史` appears above the current main-plot detail view, while keeping the archive separate from the general drama stream.
- Tightened LifeSim scroll behavior across the main panel, settings panel, action panel, and attachment viewer by hiding scrollbars and blocking horizontal overflow except for the attachment strip itself.
- `npm run build` passes after the latest LifeSim logic + layout + settings changes.

TODO
- If local browser testing is possible, verify both `吃瓜 -> 角色剧情` and `吃瓜 -> 主线剧情` paths and inspect attachment modal behavior.
- Install or provide `playwright` if automated screenshot-based UI validation is needed later.

2026-03-21
- Added a new global chat appearance setting, [0mchatAvatarMode[0m, so users can choose between grouped avatars and showing an avatar on every message.
- Rebuilt components/appearance/ChatAppearanceEditor.tsx into a clean modular version and updated the live preview so repeated-message avatar behavior is visible before applying.
- Wired the new avatar mode into pps/Chat.tsx and components/chat/MessageItem.tsx, including React.memo comparisons so appearance toggles reliably re-render existing messages.
- 
pm run build passes after the chat-avatar-frequency changes.
- Playwright validation is still blocked locally because the skill client cannot resolve the playwright package in this environment (ERR_MODULE_NOT_FOUND).

- Updated chat message grouping in pps/Chat.tsx so consecutive messages now split not only by sender role but also by a 30-minute time gap, preventing early messages from visually merging into much later ones on either side of the conversation.
- 
pm run build passes after the time-gap grouping fix.

2026-06-23
- Added 角色关系网 (Character Relationship Network): a new `components/chat/RelationshipNetwork.tsx` that renders the user at the center of a radial graph with every character around them. Edge color/dashing comes from the relationship stage, line thickness/node distance from affection, so closeness reads at a glance.
- Tapping a character node opens a detail card (affection bar, relationship label, days-together for lover+, current mood, recent relationship-change history) with a one-tap "进入聊天" jump.
- Surfaced via a 关系网 button in the ChatHub 名册 (contacts) tab header; opens as a full-screen overlay over the list.
- Added reusable stage visuals (`STAGE_NETWORK_META`, `STAGE_DASHED`) to `utils/relationship.ts`, reusing existing `STAGE_DEFAULT_LABEL` / `inferStageFromAffection`.
- `pnpm tsc --noEmit` is clean and `vite build` passes.

- Added 购物商城「心意铺」(virtual gift shop): new `apps/ShopApp.tsx` + `utils/shop.ts` (built-in gift catalog with emoji/price/categories, receipt + owned-item + gift-card-meta helpers, char-shopping prompt/parser).
- User flow: browse → buy with wallet balance (`adjustUserBalance`) → 背包 → 送给角色 (pick char + 赠言). Gifting drops a `gift_card` message into that char's chat and records a receipt on both sides.
- Char flow: 「邀请 TA 逛商城」uses the aux API (`resolveAuxApi` + `llmComplete`) to let the character pick one item to self-buy or gift back to the user (gift-back adds to user inventory + drops an assistant `gift_card` into chat). Robust JSON parse with a random fallback.
- 购物小票: per-user and per-character receipt history (查角色买/收了什么).
- New `gift_card` MessageType rendered in `components/chat/MessageItem.tsx`; serialized for the LLM in `utils/chatPrompts.ts` (history builder + quote/summary switch) and `utils/messageFormat.ts`; received gifts injected into char context via `utils/context.ts` so the character naturally thanks/responds (can write a short 感谢信).
- Registered AppID.Shop (icon `ShoppingBagOpen`) in `types.ts` / `constants.tsx` / `components/PhoneShell.tsx`.
- `pnpm tsc --noEmit` clean, `vite build` passes, all 487 unit tests green.

- Added 椒房记 (Harem-cultivation text-card game): new `apps/HaremApp.tsx` + `utils/haremGame.ts` (pure, serializable engine) + `utils/haremGame.test.ts`.
- Pick characters into a "后宫"; each 日 has 行动点 and a hand of 文字卡 (同游/夜话/赐礼/独宠/设宴/冷落/抚慰…). Play cards on members to raise 宠爱/心情; crossing favor thresholds promotes 位分 (答应→…→皇贵妃). 独宠 cards ripple onto everyone else.
- 「就寝」advances the day and may roll a night event (争宠/吃醋/谗言/侍寝/喜讯) with branching choices that reshape the court.
- Game state is isolated from real affection (only seeded from it) and persisted to localStorage; not written back to character profiles.
- Registered AppID.Harem (icon `Crown`) in `types.ts` / `constants.tsx` / `components/PhoneShell.tsx`.
- `pnpm tsc --noEmit` clean, `vite build` passes, 498 unit tests green (incl. 11 new for the engine).

- Added 悬浮窗快捷菜单 (Floating quick-menu): new `components/os/FloatingQuickMenu.tsx` — a global draggable bubble that expands into shortcuts (来往 / 心意铺 / 相册 / 文具盒 / 回桌面 / 收起).
- Drag to move (position persisted to localStorage), tap to expand/collapse (menu auto-flips up/down + left/right by where the bubble sits), long-press to hide; outside-tap closes.
- Gated by new `OSTheme.floatingQuickMenu` (default on; hidden on lock screen). Re-enable / toggle from a new switch in 拼贴册 (Appearance) above 灵动岛.
- Rendered as a PhoneShell overlay next to DynamicIsland.
- `pnpm tsc --noEmit` clean, `vite build` passes, 498 unit tests green.

- Added 茶话亭 (persistent forum App): new `apps/ForumApp.tsx` + `utils/forum.ts` — distinct from the one-shot faux forum in 折子戏. Boards (水区/树洞/吃瓜/同好/求助) → threads → floors.
- User posts threads + replies; 「召唤网友盖楼」uses the aux API to generate a mix of in-character replies (your characters, real name + avatar) and anonymous netizens, with a template fallback when API is off/fails. 「让角色发帖」(header refresh) has a random character start a thread.
- State persisted to localStorage; seeded with two ambient threads so it's not empty on first open.
- Registered AppID.Forum (icon `ChatsCircle`) in `types.ts` / `constants.tsx` / `components/PhoneShell.tsx`.
- `pnpm tsc --noEmit` clean, `vite build` passes, 498 unit tests green.

- Added 视频通话 (video call): new `apps/VideoCallApp.tsx`, launched from the chat character profile (new video button next to 打电话).
- Character side uses 通话立绘 (`convoSettings.callSprites['默认']`) → 立绘 → 头像 as the remote feed. User side: camera defaults OFF and is opt-in ("可选摄像头 / 只开一下就关了") via `getUserMedia`; toggling off stops the track; front/back flip; selfie mirror; mic is a visual mute. All tracks stopped on hang up / unmount.
- Wired `onVideoCall` through `components/character/CharacterProfilePage.tsx` (optional prop) and `apps/Chat.tsx`; registered AppID.VideoCall (chat-launched, like Call) in `types.ts` / `components/PhoneShell.tsx`.
- `pnpm tsc --noEmit` clean, `vite build` passes, 498 unit tests green.

- Added 天气预报 (multi-day weather forecast): the desktop weather widget was current-conditions-only; tapping it now opens a full 天气预报 detail page (未来七天) instead of silently re-fetching.
- Data layer in `utils/realtimeContext.ts`: new `WeatherForecastDay` / `WeatherForecast` types + `RealtimeContextManager.fetchWeatherForecast` (keyless Open-Meteo `daily=…&forecast_days=7`). Coordinates come from geo/IP locate (geo mode) or Open-Meteo geocoding of the typed city (manual mode) — so the forecast needs no API key in either mode. Extracted a pure `parseOpenMeteoForecast` + `forecastDayLabel` (今天/明天/后天→周几) for unit testing; forecast cache reuses `cacheMinutes` and also refreshes the current-weather cache.
- New `components/os/WeatherDetail.tsx`: portaled full-screen overlay (escapes the app container's `contain` clip) with condition-themed sky gradient, current hero (temp/feels-like/humidity) + 出行建议 (reuses `generateWeatherAdvice`), and a 7-day list with per-day icon, precip %, and a min→max temp bar. Loading / error (retry + 去配置) / ready states.
- Extracted the shared `WeatherGlyph` into `components/os/WeatherGlyph.tsx` (used by both widget + detail, avoids a circular import); `WeatherWidget.tsx` now imports it and opens the detail.
- `pnpm tsc --noEmit` clean (only pre-existing `api/` node-type errors remain), `vite build` passes, 506 unit tests green (incl. 8 new for the forecast parser).

- 反查岗·代发朋友圈: char browsing your phone (`CharPhoneCheckOverlay.tsx`) could already reply / 拉黑 / 删好友 on your behalf in chat threads, but couldn't post a 朋友圈 for you. Added a `post_moment` script action.
- On a `moments` step the generated script may include `{"type":"post_moment","content":"…"}`; applying it saves a public `SocialPost` authored as the user (so characters see it in context), prepends it to the on-screen 此刻 snapshot, and records it in the browse action log + the synthesized 查手机记录 system message. Personality still gates it (gentle chars just look; possessive/jealous ones grab the phone to reply, block, or post a relationship-flaunting moment).
- Updated the script-gen prompt (action options, guidance, JSON example) so the model knows the new moments action.
- `pnpm tsc --noEmit` clean, `vite build` passes, 506 unit tests green.

- 消息撤回 (message recall, QQ/微信 对标): the long-press message menu had 多选/引用/编辑/复制/删除 but no recall. Added 撤回 for your own messages in both 单聊 (`apps/Chat.tsx` + `MessageItem.tsx`) and 群聊 (`apps/ChatHub.tsx` + its `GroupMessageItem`).
- Recalling sets `metadata.recalled` + stashes the original in `metadata.recalledContent`; the bubble (any type) collapses to a centered "你/对方/成员名 撤回了一条消息" hint, with a 微信式「重新编辑」link that restores the original text to the input box (appends after a newline if a draft exists).
- The original text is hidden from the model everywhere it could leak: single-chat live history (`chatPrompts.ts`), group live transcript (`ChatHub.tsx`), the shared serializer used by archives + single-chat memory (`messageFormat.ts`), cross-group context (`summarizeGroupMsgContent`), and group memory extraction (`groupExtraction.ts`) — all emit only "[…撤回了一条消息]", so the character knows you recalled something (and can be curious) but can't read it.
- Extended both `React.memo` comparators so a recall (metadata-only change) actually re-renders the bubble.
- `pnpm tsc --noEmit` clean, `vite build` passes, 506 unit tests green.

- 角色撤回 + 用户偷看 (char-initiated recall + user peek): the character can now take back its own last message, and you can sneak a look at what it recalled (防撤回). Single chat for now.
- New `utils/messageWithdraw.ts` (`[[WITHDRAW]]` directive — deliberately NOT `[[RECALL]]`, which already means memory-retrieval). `applyAssistantPostProcessing` strips it pre-render and dispatches `CHAR_WITHDRAW_EVENT` (mirrors the `[[CHECK_PHONE]]` flow); `sanitize.ts` also strips it so it never leaks as literal text on any path.
- `Chat.tsx` listens and marks the char's most-recent non-recalled assistant message as recalled via `setMessages(prev=>…)`. The event fires before the new reply is persisted, so `prev`'s last assistant message is correctly the char's *prior* line.
- `MessageItem`: char-recalled bubbles show "{charName}撤回了一条消息" + a 「点击查看」 that reveals the stashed `recalledContent` in an amber 偷看 box (your own recalled messages still show 「重新编辑」). The model still only ever sees "撤回了一条消息".
- Added a `[[WITHDRAW]]` capability line to the system prompt (low-frequency, emotion-driven). New `messageWithdraw.test.ts` (5 tests, incl. guarding against `[[RECALL: YYYY-MM]]` false-positives).
- `pnpm tsc --noEmit` clean, `vite build` passes, 511 unit tests green.

- 单条消息转发 (forward a single message): the long-press menu only had 多选→转发 for bulk forwarding; added a direct 转发 entry. It seeds the selection with just that one message and opens the existing forward picker, reusing the same `handleForwardToCharacter` → `chat_forward` card flow (no new forwarding infra). Single chat (groups have no forward-to-character flow yet).
- `pnpm tsc --noEmit` clean, `vite build` passes, 511 unit tests green.

- 消息表情回应 (message emoji reactions, QQ/微信 tap-to-react): long-press a message → quick emoji bar; tap to react. Reactions show as small pills under the bubble (emoji + count when >1); tapping a pill toggles your own reaction. Works in 单聊 + 群聊.
- New `utils/messageReactions.ts`: `MessageReaction` shape (`metadata.reactions = {emoji,by[]}[]`, by holds 'user'/charId), pure `toggleReaction`, `REACTION_EMOJIS` quick-set, and the `[[REACT: 表情]]` directive (`extractReactDirective` + `CHAR_REACT_EVENT`). New `messageReactions.test.ts` (9 tests).
- Char-side: the character can react to your latest message by emitting `[[REACT: 👍]]` — `applyAssistantPostProcessing` strips + dispatches, `Chat.tsx` adds it to your most-recent message; `sanitize.ts` strips the tag everywhere (also propagated into `worker.bundle.js`). Capability line added to the system prompt. (Char-side reactions in groups deferred.)
- Context: the char is told when you react to its messages via a concise note in `chatPrompts.ts` live history (so it can play off your 👍/❤️). Both `MessageItem` and `GroupMessageItem` memo comparators now diff `reactions` so pills update.
- `pnpm tsc --noEmit` clean, `vite build` passes, 520 unit tests green.

- 群聊补全 + 拍一拍后缀 (4 features in one pass):
  1. **拍一拍后缀** (WeChat-style pat): `patSuffix` on `UserProfile` + `CharacterProfile`. User pats char → 「你 拍了拍 X 的<char.patSuffix>」; char pats user via `[[PAT]]` → 「X 拍了拍 你 的<userProfile.patSuffix>」. Char self-changes its own via `[[PAT_SUFFIX: 后缀]]` (`utils/patSuffix.ts` + `CHAR_PAT_SUFFIX_EVENT` handled in `OSContext`); user sets their own in 文具盒·我 (PersonaApp, global field). New `patSuffix.test.ts` (6 tests). Old 戳一戳 messages without patSuffix still render 「戳了戳」.
  2. **群聊·角色撤回**: group director can emit `[[WITHDRAW]]` per member → recalls that member's last group message (parsed in the action loop; doc added to the director prompt).
  3. **群聊·角色表情回应**: `[[REACT: 表情]]` per member → reacts (by charId) to the most recent non-self group message.
  4. **群聊·单条转发**: new 转发 entry in the group message menu → character picker → drops a `chat_forward` card into that character's private chat (reuses the single-chat card shape; groups had no forward infra before).
- `[[PAT]]` / `[[PAT_SUFFIX]]` / `[[WITHDRAW]]` / `[[REACT]]` all stripped in `sanitize.ts` (propagated to `worker.bundle.js`). Capability lines added to both the single-chat system prompt and the group director prompt.
- `pnpm tsc --noEmit` clean, `vite build` passes, 526 unit tests green (6 new).

- 心意铺·购物车 + 代付 (对标淘宝): the shop only had instant buy + bag; added a full cart flow.
  - `ShopCartLine` on `UserProfile` + `CharacterProfile`; pure cart helpers in `utils/shop.ts` (`addToCart` / `setCartQty` / `removeFromCart` / `cartCount` / `cartTotal` / `resolveCart` / `expandCart`). New `shopCart.test.ts` (7 tests).
  - **购物车 tab** (badge with count): 商城 items now have 加购物车 + 购买; cart view has per-line qty steppers (− qty +, 0 removes) + 清空; a fixed bottom 结算条 with the total and two checkout paths.
  - **结算**: 「自己支付」deducts wallet → whole cart into 背包 with receipts; 「求 TA 代付」opens a character picker → drops a 求代付 message in that char's chat, then a 副 API call lets the char decide (by persona / affection / amount) whether to pay — on yes, the cart lands in your 背包 with 代付 receipts on both sides + a chat reply; on no, a declining reply.
  - **角色心愿购物车**: 邀请 TA 逛商城 can now `want`-add to the char's own cart; the 小票·角色 tab shows 「TA 的心愿购物车」with 「帮 TA 清空购物车（代付）」 (user pays, char gets a 你代付 receipt + system note).
  - **联动查手机 (反查岗)**: `CharPhoneCheckOverlay` now gets the user's cart in its browse prompt + a `clear_cart` script action — a doting/generous char may 「帮 TA 清空购物车」 while snooping (whole cart → your 背包, 代付 receipts both sides, logged in the 查手机记录).
  - `pnpm tsc --noEmit` clean, `vite build` passes, 533 unit tests green (7 new).

- 心意铺·淘宝化界面革新 (搜索 / 详情页 / 收藏 / 月销·评价):
  - Pure helpers in `utils/shop.ts`: deterministic `monthlySales` (cheaper sells more), `itemRating` (4.6–5.0), `getItemReviews` (seeded buyer reviews), `searchShopItems`, `formatSales` (万级). New `shopBrowse.test.ts` (6 tests).
  - **搜索**: a Taobao-style search pill at the top of 商城 — filters by name / 描述 / 分类 / emoji.
  - **商品卡革新**: big emoji 主图 with a 收藏 ❤️ corner button, ⭐ 评分 · 月销 line, Taobao 红 (#ee0a24) price + 购买 button; tap the card → 详情页.
  - **商品详情页 (PDP)**: full-screen overlay — 大图 hero, price + 评分/月销, 标题/描述, 宝贝评价 list (stars + buyer), bottom bar with 收藏 / 加入购物车 / 立即购买.
  - **收藏**: `shopFavorites` on `UserProfile`; ❤️ toggle on cards + PDP, and a 收藏 chip in the category row to filter to favorites.
  - `pnpm tsc --noEmit` clean, `vite build` passes, 539 unit tests green (6 new).

- 心意铺·商品 + 评价全部改为 AI 实时生成:
  - `utils/shop.ts`: `buildGenerateItemsPrompt` / `parseGeneratedItems` (robust JSON → `ShopItem[]`, stable `gen_` ids by name+category, dedupe, field validation) and `buildItemReviewsPrompt` / `parseGeneratedReviews`. New `shopGen.test.ts` (5 tests).
  - **Dynamic item registry**: AI items are registered (`registerShopItems`) + persisted to localStorage so cart / 收藏 / 小票 ids still resolve via `getShopItem` after 换一批 or reopen.
  - `ShopItem` gained `image?` (real image URL — rendered when present) + `generated?`; emoji stays the「文字图」fallback. 「图片可以用文字代替，有图就放图片」.
  - **ShopApp**: catalog is now state-driven — on open it uses the last cached batch, else 实时生成 ≥20 件 (副 API; pads with built-ins if the model returns fewer); a 换一批 button regenerates a fresh batch with a loading state. Search/category/收藏 filter the live catalog (收藏 resolves globally via `getShopItem`).
  - **PDP 评价**: generated in real-time per product on open (loading spinner), falling back to seeded reviews when 副 API is off/fails.
  - `pnpm tsc --noEmit` clean, `vite build` passes, 544 unit tests green (5 new).

- 心意铺·我的订单 + 物流配送进度 (淘宝式):
  - `ShopOrder` / `ShopOrderItem` types + `userProfile.shopOrders`. Pure helpers in `utils/shop.ts`: `makeOrder` (12–30 min ETA), `orderProgress` (time-based 已下单→已发货→运输中→派送中→已送达, then 待收货 until confirmed), `orderReceivePayload` (确认收货 → 背包 + 双方小票). New `shopOrder.test.ts` (6 tests).
  - **All purchases now ship**: 立即购买 / 商城购买 / 购物车自己支付 / 求代付成功 all create a 待收货 order instead of dropping straight into 背包; items land in 背包 only on **确认收货** (代付订单在收货时给代付角色记一笔「赠出」小票).
  - New **订单 tab** (active-order badge): each order shows status + 商品 + a 红色物流进度条 with 5 stage dots + ETA text + 确认收货 button; a 30s ticker advances in-flight orders. Tab row is now horizontally scrollable for 5 tabs.
  - `pnpm tsc --noEmit` clean, `vite build` passes, 550 unit tests green (6 new).

- 心意铺·优惠券 + 秒杀/banner + 猜你喜欢 + AI 仿真好坏 (一批做完):
  - **AI 商品/评价仿真有好有坏**: `ShopItem.rating` (1.0–5.0); the gen prompt now asks for a quality spread (好物/普通/踩雷·智商税) with a `rating` field, parsed + clamped. `itemRating` uses it (fallback widened to 3.0–5.0). Reviews prompt distributes by rating (低分→差评为主) and `parseGeneratedReviews` keeps 1–5 stars; seeded fallback `getItemReviews` mixes good/bad by rating.
  - **优惠券/满减**: `ShopCoupon` + `SHOP_COUPONS`; `bestCoupon` / `applyCoupon` (pure). 领券中心 strip on the storefront; the cart 结算条 auto-applies the best claimed 满减券 (shows 已省 + 实付 vs 划线原价) and deducts the discounted total.
  - **限时秒杀 + banner 轮播**: auto-rotating `ShopBanner`; `flashDeals` (整点一轮, deterministic pick + 20–60% off) rendered as a 秒杀 strip with a live 倒计时, buy at 秒杀价 (`buyItem` gained a price override).
  - **猜你喜欢**: `recommendItems` (收藏分类加权 + 半小时打散) rendered as a feed under the catalog.
  - New `shopPromo.test.ts` (7 tests); updated `shopBrowse`/`shopGen` tests for the wider rating/star ranges.
  - `pnpm tsc --noEmit` clean, `vite build` passes, 557 unit tests green (7 new).

- 饭票(外卖)·商品 + 食评全部 AI 实时生成 (对标美团第一步):
  - Stores+dishes were already AI (`generateStoresAI`); bumped batches to **≥20 家/批**, and made the storefront **cache-first** (`moro_takeout_stores_v1`): open uses the last live batch (no local-seed flash / no API burn), 换一条街 regenerates ≥20 and re-caches.
  - **食评改为 AI 实时生成**: new `generateStoreReviewsAI` (mirrors `generateStoresAI`: `safeFetchJson` + `extractJson`), 仿真**有好有坏**——好坏比例按店铺评分/红旗调（低分/黑心店多差评：缺斤少两/图文不符/送得慢凉了/卫生差），1~5 星，可含商家回复。进店时实时生成（先用算法版垫场 + 「现写食评中…」提示），失败/无 API 回退算法版 `generateStoreReviews`. New fallback test.
  - `pnpm tsc --noEmit` clean, `vite build` passes, 558 unit tests green (1 new).

- 饭票·美团式四件套 (排序/筛选 · 满减红包 · 菜单分组/猜你喜欢 · 界面革新, 一批做完):
  - Pure helpers in `utils/takeout.ts`: `sortStores` (综合/销量/评分/距离/最快), `filterStores` (免配送费/0起送/有优惠/4.5+), `parseStorePromo` + `storePromoDiscount` (把店铺「满X减Y / 立减N」文案落实成结算抵扣), `TAKEOUT_REDPACKETS` + `bestRedpacket`, `recommendStores`, `groupDishes` (招牌/主食/饮品/小食). New `takeoutMeituan.test.ts` (7 tests).
  - **首页革新**: 排序条 + 筛选 chips（红色高亮）; 自动轮播 `TakeoutBanner`; 平台红包·领券 strip; 底部「猜你喜欢」横滑推荐。
  - **满减 + 红包落地**: 结算页明细新增「店铺满减」「平台红包」两行抵扣，实付按 `storePromoDiscount + bestRedpacket` 扣减（`placeOrder` 同步）。`takeoutRedpackets` 存已领红包。
  - **店内菜单分组**: 菜牌按 `groupDishes` 分「招牌/主食/饮品/小食/汤…」分组展示（含每组计数）。
  - `pnpm tsc --noEmit` clean, `vite build` passes, 565 unit tests green (7 new).

- 搜索栏实时生成 + 饭票·药品栏目:
  - **饭票/心意铺 搜索即现搜**: 输入关键词回车（或点 CTA）就实时生成一批**紧扣该词**的相关结果——饭票现搜全城相关店铺（`generateStoresAI(api, 20, query)` 的 prompt 加了「本次搜 X，让这批都紧扣 X」），心意铺现搜相关礼物（`generateCatalog` 传强关键词 hint）；生成后清掉文字过滤直接展示这批结果。空结果态也给「现搜全城」入口。
  - **饭票·药品栏目**: `CATS` 加入「药品」品类（顶部多一个药品 chip）；`generateStoresAI` 的 prompt 增加「药品＝药店」规则（卖感冒灵/布洛芬/连花清瘟/创可贴/口罩/维C 等非处方药与医疗用品，价格/规格/emoji 贴现实），正常批次放 1~2 家药店、搜买药相关词时多生成几家。
  - `pnpm tsc --noEmit` clean, `vite build` passes, 565 unit tests green.

- 茶话亭(论坛)·全 AI 实时生成 + 贴吧式盖楼 (对标百度贴吧, 界面革新):
  - **帖子列表全 AI 实时生成、cache-first**: 进一个「吧」(板块) 自动一次性生成 **≥10 个帖子** (`buildThreadsPrompt`/`parseThreads`/`materializeThreads`, `THREAD_BATCH=12`)，话题不重复、长短不一；空时不再只靠 2 条种子。每个吧底栏「换一批」重生成并替换该吧的生成帖。无 API/失败回退 `fallbackThreads`(每吧 10 条模板) 兜满，不留空屏。
  - **楼层根据帖子生成、30~几百楼、懒加载**: `targetFloorCount()` 给每帖一个「声称总楼数」(`replyCount`，加权 30~150、少数爆楼到 ~588，**最低 30**)；进帖自动盖第一批楼，「加载更多楼层」按 `FLOOR_BATCH=12` 续盖直到 `replyCount`，到顶显示「已经到底了，共 X 楼」。`buildForumPrompt` 现接 `startFloor`，按真实楼号区间出题。
  - **楼中楼 + 楼主 + 只看楼主 + 点赞 (贴吧式)**: 跟帖支持 `reply_to` → `materializeReplies` 落成嵌套 `subReplies`(不占楼号、缩进「X 回复 Y：」渲染)，命中楼主名标 `isOp`(👑楼主标)；详情页「只看楼主」过滤、楼号(1楼=楼主主楼, 跟帖 2楼+)、点赞、爆楼标记、热帖🔥。
  - **界面革新**: 贴吧蓝 `#2b6fe0`；顶部搜索栏(搜帖子/网友)、板块 chip 选中显「X吧」、吧介绍条 + 换一批、列表头像/作者/楼数/赞数/爆楼角标、生成中骨架、`kFmt`(w/k 计数)、详情页 4px 分隔的楼主主楼 + 楼层流 + 楼中楼卡 + 回帖框。
  - 纯函数全部进 `utils/forum.ts`，新增 `utils/forum.test.ts` (12 tests：楼数区间/解析夹紧/落地/楼中楼/兜底)。
  - `pnpm tsc --noEmit` clean, `vite build` passes, 577 unit tests green (12 new)。

- 椒房记(后宫养成)·全面引入 AI 生成 + 子嗣/选秀/史官评 (对标后宫养成模拟器, 界面革新):
  - **AI 妃嫔台词**: 打出定向卡后，被宠/被冷落的妃嫔按人设 + 当前宠爱/心情用副 API 现说一句（`buildConcubineLinePrompt`/`parseConcubineLine`，去代码块/引号/「名字：」前缀取首行），落「起居注」speech 气泡；失败回退 `fallbackConcubineLine`（好/冷/中三套话术）。
  - **AI 夜间事件**: 「就寝」先依当前后宫格局现拟一桩宫闱事（`buildAINightEventPrompt`/`parseAINightEvent`：名字→charId 映射、favor 夹 -20~20 / mood 夹 -25~25、按净值定 tone，选项<2 或非 JSON 返回 null），2~3 抉择各带数值后果 + 结果叙述；失败回退原模板事件 roller（含 50% 平安夜）。事件落地走新 `HaremPendingEvent.type:'ai'` + `ai:HaremAIResult[]`，`resolveHaremEvent` 套用该选项 effects。
  - **子嗣系统**: `HaremMember` 加 `pregnant`/`heirs`；亲密类卡（独宠/夜话/同辇）与「侍寝·传召」记 `lastNightWith`，次日 `advanceDay` 结算 `maybeConceive`（宠≥50 起、宠/心情加权概率、可注入 rng），孕 3 日临盆 `progressPregnancies` 诞皇子/公主、母凭子贵涨宠涨心情。名册 🤰 标 + 皇嗣计数 + 顶栏皇嗣总数。
  - **选秀**: `addMembers`（按 charId 去重并入、记起居注）中途纳新人，后宫上限提到 9 位；复用 `PickGrid` 选人。
  - **史官评(结局)**: 「封笔修史」按钮 AI 为这段后宫岁月作传（`buildEndingPrompt`/`parseEnding` → 总评 + 每人定评，非 JSON 当总评兜底；`fallbackEnding` 按数据现写），米黄卷轴弹窗呈现，可继续临朝 / 改元重开。
  - **头衔**: `memberTitles`（宠冠 / 协理六宫 / 有孕 / 皇嗣×n）纯计算，名册彩色徽章。
  - **界面革新**: 顶栏日/行动点/皇嗣/宠冠状态条、差评卡描红、AI 拟旨「朱笔御批·拟旨中…」loader、妃嫔台词气泡、选秀底抽屉、史官卷轴结局；保留椒房宫红×金主色。
  - 纯逻辑全进 `utils/haremGame.ts`，`utils/haremGame.test.ts` +11（受孕/临盆/选秀/头衔/AI 解析/兜底）。
  - `pnpm tsc --noEmit` clean, `vite build` passes, 588 unit tests green (11 new)。

- 杂项修复（5 项）：桌面小组件页 / 饭票心意铺现写无反应 / 茶话亭见闻簿字数限制 / 自主生活标签截断 / 见闻簿生成失败:
  - **删桌面第四页**：Launcher 移除「日历 + Upcoming Events」小组件页（`WidgetsPage` 组件 + 渲染 + `totalPages` -1 + 清理 `anniversaries` 取数/状态/import）。
  - **饭票/心意铺「现写无反应只剩离线店」根因＝截断后静默回退**：
    - `utils/shop.ts` 新增 `salvageObjects`：整体 JSON.parse 失败时逐个抠出完整 `{…}` 救回（被 max_tokens 截断也不整批丢），`parseGeneratedItems`/`parseGeneratedReviews` 改用它。
    - 心意铺 `generateCatalog` 删掉「不足 20 件就拿内置商品补足」的假成功逻辑（之前截断→0 件→被内置商品垫场冒充上新）；解析为 0 改为明确报错让用户重试；`maxTokens` 2200→6000。
    - 饭票 `generateStoresAI`：`max_tokens` 3200→8000、改用 `extractContent`、解析为 0 **抛错**而非静默回退本地种子；`loadStoresAI` 成功/失败都给 toast、失败保留现有列表。
  - **删字数限制**：茶话亭（`forum.ts` 跟帖/标题/正文 parse 去掉 `.slice` 硬截断、prompt 去掉「≤N字」；`ForumApp` 发帖输入去掉 `maxLength`）+ 见闻簿（`xhsFeed.ts` 标题/正文/评论/回复 parse 去截断、prompt 去「title≤20/body80~300字、回复≤80字」；`SocialApp` 转发去截断）。
  - **见闻簿生成失败**：`xhsFeed.ts` `parseJsonLoose` 新增 `unwrapArray`——模型把数组包进 `{"posts":[…]}` 时取出其中数组（之前返回对象→`generateFeedBatch` 抛「生成结果为空」），并加无 `[` 时从首个 `{` 打捞兜底。
  - **自主生活标签截断**：`ChatHub` 聊天列表「此刻 · …」状态从单行 `truncate` 改为 `items-start + 多行 break-words`，完整显示不再被切。
  - `pnpm tsc --noEmit` clean, `vite build` passes, 589 unit tests green（+1：商品截断打捞）。

- 修复 2 项：自主生活轨迹「离线即生成」 + 清空上下文清除不干净:
  - **自主生活轨迹无反应 → 用户一离线就自主生成**：之前角色生活只在「主动消息触发」或「用户回来时 catchUpOfflineLife 补齐（且 gap ≥2h）」才生成，用户离开当下毫无动静、短时离线永远不生成 → 体感「无反应」。现在 `OSContext` 在页面转入后台（`visibilitychange→hidden`）或窗口失焦（`blur`）时调用新增的 `runOnLeave`：为每个开了自主生活、未拉黑、配了线（副 API 优先）的角色**立刻** `advanceLife` 过一格日子（fire-and-forget，趁挂起前发出），并广播 `autonomous-life-advanced`。每角色 30 分钟节流（`LEAVE_MIN_GAP_MS`）防快速切后台刷爆 API；回来时的 `catchUpOfflineLife` 仍补齐更长 gap。
  - **清空上下文清除不干净 → 连日常/自主轨迹一并清**：`Chat.tsx handleClearHistory` 的「全部清除」分支（未勾「留最近10条」）此前只清消息 + 心情/buff + 日程，残留**角色备忘录（memos，会注入 context.ts）** 与**离线自主生活轨迹（CharLifeEvents，经 buildRecentLifeContextBlock 注入 + 喂主动消息）**，导致清空后角色仍「记得」已删的事、列表「此刻」状态还在。现一并 `updateCharacter({…, memos: []})` + `DB.deleteLifeEventsForChar(char.id)`，toast 改为「已彻底清空（含心情·日程·备忘录·自主生活轨迹）」。
  - `pnpm tsc --noEmit` clean, `vite build` passes, 589 unit tests green。

- 修复见闻簿/饭票/心意铺「生成 JSON 不合法」（API 调用记录显示成功、输出≈max_tokens）:
  - **根因＝输出被 max_tokens 截断**：API 记录里输出 token ≈ 7996 ≈ 旧上限 8000，模型（gemini-3.1-pro 等会一路写到上限）把 JSON 截在半个对象里 → 整批不合法。上次给见闻簿改「正文不限字数」更是雪上加霜（首个对象就写超、打捞不到任何完整对象 → 报「生成结果不是合法 JSON」）。
  - **提高 token 预算**：见闻簿 callLlm 8000→16000、饭票 generateStoresAI 8000→16000、心意铺 generateCatalog 6000→12000、茶话亭 帖子 1400→6000 / 楼层 900→4000。
  - **收敛单条体量 + 硬约束写完**：见闻簿评论 8~16→3~6、正文回到「几十到一百多字、别长篇大论」；饭票每店菜品 5~9→4~6；三处 prompt 均加「务必输出完整合法、紧凑无空白、把 N 条全部写完再收尾、绝不中途截断」。
  - **打捞兜底全覆盖**：饭票新增 `salvageStoreObjects`（深度遍历抠出已写完的店铺对象，正确处理字符串/转义/嵌套 dishes），解析为空时启用；茶话亭 `parseThreads`/`parseForumReplies` 改用新 `salvageFlat`（扁平对象逐个救回），不再「截断＝整批丢」。见闻簿已有 `salvageObjects`、心意铺已有 `salvageObjects`。
  - 新增 2 条回归测试（forum 截断打捞）。`pnpm tsc --noEmit` clean, `vite build` passes, 591 tests green (+2)。

- 修复茶话亭帖子质量（全是水贴/无长贴/重复话题角色/八卦只有标题/毫无新意）:
  - **prompt 大改 buildThreadsPrompt**：① 新增 per-board `BOARD_BRIEF`，按板块给「该长什么样」的实质指引——吃瓜=把一桩完整的瓜讲清楚（人物关系/起因/经过/爆点/钩子，严禁只标题或一句话）、树洞=有情境有细节的中长心事、求助=交代背景+已试+卡点、同好=具体干货、水区=具体一件事；② 硬性「长短结合」：至少四成（`Math.round(count*0.4)`，≥3）是 150~400 字、分段、有细节有钩子的**长贴**，其余短帖也得是具体的事不能空泛模板；③「话题各不相同有新意」「同一实名角色最多发 1 帖、网名各异、不撞车」「写完再用 ] 收尾」。system 改成「资深泡吧网友、最懂真实帖子长什么样、坚决避免空壳帖」。
  - **去重**：`parseThreads` 按标题归一化去重复话题；`materializeThreads` 用 `usedChar` 保证同一实名角色一批里只当一次楼主（其余转匿名），治「重复角色的帖子」。
  - `ForumApp` 帖子生成 maxTokens 6000→8000、temperature 1.05（容纳长贴 + 更有新意）。
  - 新增 2 条回归测试（标题去重 / 角色去重）。`pnpm tsc --noEmit` clean, `vite build` passes, 593 tests green (+2)。

- 见闻簿（小红书）帖子质量大改 + 新增「交友·发现身边的人」系统:
  - **帖子质量**（对标真实小红书）：`buildFeedSystemPrompt` 重写——system 改「资深博主、坚决避免空壳帖」；硬性「长短结合」≥四成是 150~400 字、分段、有背景/过程/细节/钩子的长帖；情感/八卦/树洞类必须把事讲完整、绝不只标题一句话；题材拉开差距要有新意；不重复（标题/题材/昵称）、同一角色最多 1 帖。`generateFeedBatch` 加去重（标题归一化去重 + 同一实名角色只当一次作者，其余转 NPC）。
  - **新增交友系统**（参考探探/Soul/陌陌）：`utils/socialDating.ts`——`DATING_INTENTS`（找对象/恋爱/随缘约会/**圈内·SM**/单纯无聊/游戏·饭·运动·学习搭子/灵魂共鸣/线下面基，不限题材）、`DatingProfile`、`buildDatingPrompt`（要求人物多样、目的五花八门含成人向 SM 点到为止、bio 有实质内容像真人自我介绍、各异不套模板）、`parseDatingProfiles`（校验/夹紧/截断打捞/去重昵称+角色只出镜一次/命中角色带头像）、`fallbackDatingProfiles`（12 张各异兜底）、`generateDatingBatch`（max_tokens 12000）。
  - **UI**：`SocialApp` 加「📓见闻 / 💘交友」TabBar；交友页是探探式单卡浏览（头图/距离/在线/目的徽章/熟人标/年龄性别/标签/简介 + 跳过·打招呼·喜欢三键 + 换一批），cache-first localStorage、空/失败回退兜底卡。打招呼对熟人提示去「来往」找 TA。
  - 新增 `utils/socialDating.test.ts`（8 测）。`pnpm tsc --noEmit` clean, `vite build` passes, 601 tests green (+8)。

- 修复絮语「帮 user 想接下来说啥」后台成功但前台空白/失败 + 交友系统 3 项增强:
  - **帮 user 回复候选 空白/失败修复**（根因＝思考型模型）：`gemini-3.1-pro` 等推理模型把 1000 的 max_tokens 几乎全用在推理上、正文 JSON 数组被截断→解析空→前台「没想出来」。① `requestActionsOnce` max_tokens 1000→4000；② `extractContent` 加固：content 为「分片数组(Gemini 风)」时拍平拼接（旧实现遇数组会让后续 .trim() 崩→空白）、空时回退 `reasoning_content`/`reasoning`/`choices[0].text`；③ `parseActions` 支持对象包裹 `{"actions":[…]}/{"suggestions":[…]}`。新增 7 测（对象包裹 + extractContent 分片/回退/去 think）。
  - **交友系统 3 项增强**：① 「我喜欢的」列表（右上 ♥ 入口，localStorage 持久化，显示已匹配/目的/简介），喜欢时按目的+熟人 `isMatch` 判定「🎉 匹配成功」；② 打招呼 → 对方 `generateDatingReply` AI 实时回应（弹窗气泡，熟人附「进来往聊」一键 `setActiveCharacterId`+开 Chat）；③ 按目的筛选卡片（全部 + 各 intent chip，含只看游戏搭子/SM）。`socialDating.ts` 加 `isMatch`/`generateDatingReply`/`fallbackDatingReply`。
  - `pnpm tsc --noEmit` clean, `vite build` passes, 608 tests green (+7)。

- 心意铺·全面对标淘宝（功能 + 界面，一批做完）:
  - **淘宝式底部导航栏**：整个 App 改成 `首页 / 分类 / 购物车 / 我的` 四 tab 底栏（红色高亮 + 购物车角标），顶栏精简为标题 + 🪙淘金币 + ¥钱包。原「订单/背包/小票」收进「我的」。
  - **「我的」个人中心**：渐变会员卡（头像/昵称/钱包/淘金币 + 每日签到领币）；「我的订单」四宫格快捷入口（待收货/待评价/退款售后/已完成，带角标，点入直达过滤后的订单）；「我的工具」九宫格（背包/收藏/足迹/领券/小票/角色逛铺）。
  - **分类页**：淘宝式左侧分类竖栏 + 右侧商品网格，按 `SHOP_CATEGORIES` 切换。
  - **商品评价系统**：确认收货后订单进「待评价」，可写评价（1~5 星 + 文案，奖励 5 淘金币）；`shopReviews` 存 `UserProfile`，PDP 把「我的评价」置顶并显示**好评率**。pure：`makeUserReview`/`userReviewsForItem`/`isItemReviewed`/`pendingReviewItems`/`goodRate`。
  - **选规格/数量 sheet**（淘宝式底部弹层）：加购/立即购买前选款式（`itemSpecs` 按分类派生）+ 数量；卡片「购买」/PDP 两键都走它。
  - **购物车多选结算**：每行勾选框 + 全选，结算仅算勾选项；单行减到 1 再点变删除；满减券基础上叠加**淘金币抵现**（`coinsToYuan`，最多抵实付 50%）。
  - **物流详情**：`orderTrace` 生成带时间戳的轨迹时间轴（运单号 + 节点高亮），订单卡「查看物流」打开。
  - **退款/售后**：自己支付且未收货的订单可「申请退款」，退回钱包 + 返还所用金币 + 标记 `refundedAt`；「我的→退款/售后」可查。
  - **浏览足迹 + 淘金币**：打开详情记 `shopFootprints`（去重置顶限量），「我的→浏览足迹」可看/清空；`shopCoins`/`shopCheckinAt` + `checkinAvailable`/`dailyCheckinReward`（当日确定性 10~60）。
  - types：`UserProfile` 加 `shopFootprints/shopReviews/shopCoins/shopCheckinAt`；`ShopOrder` 加 `refundedAt/coinDiscount`；新增 `ShopFootprint`/`ShopUserReview`。新 `shopMy.test.ts`（15 测）。
  - `pnpm tsc --noEmit` clean, `vite build` passes, 623 tests green (+15)。
