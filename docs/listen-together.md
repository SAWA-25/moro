# 音乐·一起听歌

在音乐 App 里和角色「一起听歌」：角色和用户在专门界面讨论正在放的歌，并能**主动换歌 / 暂停 / 继续 / 下一首**。

## 入口
- 音乐主页（`apps/music/NeteaseProfilePage.tsx`）顶栏「🎧 一起听」按钮 → `onListenTogether`。
- 播放页（`apps/MusicApp.tsx:renderPlayer`）底部「和 TA 一起听」按钮。
- 都走 `enterListenTogether(charId)`；没指定角色时弹角色选择器 `showListenPicker`。

## 界面（`view === 'listen_together'`，在 `apps/MusicApp.tsx`）
- 顶部「正在播放」条：封面（播放时旋转）+ 歌名/歌手 + 播放/暂停 + 下一首。
- 中间讨论区：用户气泡（右）/ 角色气泡（左带头像），角色动作以小徽标展示（🎵换歌 / ⏸暂停 / ▶️继续 / ⏭下一首）。
- 底部：输入框 + 发送 +「🎲 TA 来挑」（把选歌权交给角色）。

## AI + 播放控制
- `utils/listenTogether.ts:discussMusic` 一次性调用（不走主聊天管线）：传角色人设（`buildCoreContext`，含关系）+ 音乐口味（`char.musicProfile`）+ 当前歌 + 歌词片段 + 最近讨论 + 触发场景，返回 `{ reply, action }`。
- `action`：`change_song`(query) / `pause` / `resume` / `next` / `none`。
- 触发场景 `trigger`：
  - `enter` 进入时角色先开口（可能直接挑首歌）；
  - `user` 回应用户发言；
  - `take_over`（TA 来挑）角色主动安排（换歌/暂停）；
  - `song_changed` 歌曲自然切换时角色随口评一句（角色自己换的歌用 `charInitiatedRef` 去重，避免重复发言）。
- `executeListenAction`：`change_song` 先 `musicApi.search` 取真实歌曲播放，搜不到回退角色歌单 / 一起写的歌；其余直接调 `togglePlay` / `nextSong`。

> 讨论内容是会话内临时态（不落库、不进主聊天上下文）。一起听的角色会调用 `addListeningPartner` 在迷你播放器上显示「一起听」徽标。
