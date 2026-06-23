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
