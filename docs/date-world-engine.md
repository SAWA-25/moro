# 街角 · 约会世界引擎

`char 带着 user 在场景里溜达`的日常陪伴向约会。入口在 **街角（LifeSimApp）顶栏的 ♥ 按钮**（出门逛逛旁边）。改约会/场景/世界线/约会 BGM·语音前看这里。

> 副 API（文具盒 → 副线盒）当世界引擎；没开则回退主 API 也能玩。见 [`recenter-and-schedule-anchor.md`](./recenter-and-schedule-anchor.md) 的副 API 一节。

## 一句话

每回合，世界引擎（副 API）在角色的回应之外，还负责**场景调度**（让街角活着）+ 给一个**氛围关键词**（喂 BGM）；user 的「话」和「动作」**分开输入**、角色**一一回应**；每 **20 回合**自动把上文总结成「前情提要」并**隐藏旧消息**，保持低 token 的灵动感。

## 数据模型（types.ts）

| 类型 | 说明 |
|------|------|
| `DateScene` | 场景：内置（`BUILTIN_DATE_SCENES`）或自定义（`makeCustomScene`）。含 name/emoji/vibe/opening |
| `DateMessage` | 一条消息：`role` = `user`(话+动作) / `char`(回应) / `world`(世界引擎旁白) |
| `DateWorldline` | **一条世界线 = 一个剧情分支**。含 messages / vibe / turnCount / recap / parentId(分叉来源) / bgmAssetKey |

多世界线 = 同一角色下多条 `DateWorldline`；从任一条消息处可 `forkWorldline` 分叉出新走向。

## 链路

| 环节 | 位置 |
|------|------|
| 世界引擎回合 `runDateTurn` | `utils/dateEngine.ts`：副 API → JSON `{char_speech, char_action, world, vibe, title?}`；prompt 强调日常陪伴向 + 话/动作一一回应 + 克制的场景调度 |
| 20 回合总结 `runDateRecap` | `utils/dateEngine.ts`：浓缩前文 → `worldline.recap`，可见消息只留尾部 `DATE_KEEP_TAIL` 条（隐藏上文、降 token） |
| 氛围 BGM | `utils/dateEngine.ts` `buildDateBgmPrompt` + `utils/minimaxMusic.ts` `synthesizeSongMinimax`（instrumental），按当前 vibe 生成专属恋爱 BGM，缓存 assetKey 复用 |
| 语音 | `utils/minimaxTts.ts` `synthesizeSpeech`：开「🔊 有声」后角色台词逐句 TTS 播放（用角色 voiceProfile）。**用户语音输入**：💬输入框旁 🎤 用浏览器 Web Speech API（`webkitSpeechRecognition`，zh-CN）实时转写进「说点什么」 |
| 持久化 | `utils/dateStore.ts`：localStorage 按角色存多条世界线（list/save/create/fork/delete/rename） |
| UI | `apps/lifesim/DateView.tsx`：地图式场景选择 / 地图式世界线入口 + **分叉树**（`buildForest` + `WorldlineNode` 递归缩进展示血缘）/ 约会会话（消息流 + 话·动作分输入 + 🎤语音输入 + BGM/语音/分叉）|
| 入口 | `apps/LifeSimApp.tsx`：顶栏 ♥ 按钮 → `showDate` 覆盖层 |
| 情侣空间联动 | `components/couple/CoupleSpace.tsx` 写入 `moro_date_intent_v1` 后打开 `LifeSim`，`apps/LifeSimApp.tsx` 消费 intent 直接进入约会；`apps/lifesim/DateView.tsx` 可把当前世界线摘要「收进情侣空间」为 `CoupleMemoryCard(kind:'date')` |

## 几个有意的设计点

- **场景调度只在 `world` 字段**，且要求「克制、不喧宾夺主」——日常向，不强行制造大戏。
- **话/动作分输入**：两个输入框（💬说点什么 / 🤍做个动作），可只填其一；prompt 要求角色把两者都接住。
- **分叉**：每条角色消息下有「⑂ 从这儿分叉」，复制到该点为止的消息另起一条世界线，BGM 不继承（氛围会变）。
- **副 API 门控是软的**：没开副 API 也能用（回退主 API），列表页给一句提示引导去开副线盒。
- **BGM/语音都走 MiniMax**，需要在「文具盒」配 MiniMax Key；语音还需角色配 voiceProfile 音色。

## 语音的两端

- **角色台词语音输出**：开「🔊 有声」，角色每句话经 MiniMax TTS 念出来（需角色 voiceProfile 音色）。
- **用户语音输入（STT）**：💬旁的 🎤 用浏览器 `webkitSpeechRecognition`（zh-CN）实时把你说的话转写进「说点什么」；不支持的浏览器（Firefox / 部分 WebView）自动隐藏该按钮。免费、本地，不走 API。

## 后续可扩展

- 把约会里的高光继续沉淀进情侣空间记忆卡 / 回忆标本馆；
- 分叉树的可视化连线再精细些（目前是缩进 + 血缘标注）。
