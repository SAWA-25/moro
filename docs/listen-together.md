# 音乐·一起听歌

在音乐 App 里和角色「一起听歌」：把正在放的歌**分享给角色**，随即和 ta 进入专门的一起听界面讨论这首歌；角色还能**主动换歌 / 暂停 / 继续 / 下一首**。

## 入口（分享给角色 → 进入一起听）
- 播放页（`apps/MusicApp.tsx:renderPlayer`）：顶栏 `UsersThree` 图标按钮 + 底部「分享给 TA · 一起听」胶囊按钮，都走 `openListenTogether`。
- `openListenTogether`：若已和某角色一起听（`listenCharId` 仍在 `listeningTogetherWith` 里）→ 直接回到一起听界面；否则弹底部角色选择器 `showSharePicker`。
- 选中角色 → `shareAndListen(charId)`：
  1. 往该角色聊天落一张 `music_card`（`role:'user'`、`intent:'join'`，复用 `components/chat/MessageItem.tsx` 的「Listening Together」双头像卡）；
  2. `addListeningPartner(charId)` 标记伴听徽标（迷你播放器 / 播放页可见）；
  3. 进入 `view==='listen_together'`，并以 `trigger:'enter'` 让角色先开口（可能直接挑首歌）。

## 界面（`view === 'listen_together'`，在 `apps/MusicApp.tsx:renderListenTogether`）
- 顶部「正在播放」条：封面（播放时旋转的圆碟）+ 歌名/歌手 + 播放/暂停 + 下一首。
- 「你 ♥ TA」一起听小标识（用户头像 + 心 + 角色头像）。
- 中间讨论区：用户气泡（右）/ 角色气泡（左带头像），角色动作以小徽标展示（🎵换歌 / ⏸暂停 / ▶️继续 / ⏭下一首）；等待回复时显示打字气泡。
- 底部：输入框 + 发送 +「🎲 TA 来挑」（`DiceFive`，把选歌权交给角色）。
- 顶栏「结束」按钮 = `removeListeningPartner` + 清理本次一起听缓存后回播放页；返回箭头则保留伴听徽标和讨论缓存，之后可再进入。

## AI + 播放控制
- `utils/listenTogether.ts:discussMusic` 一次性调用（不走主聊天管线）：传角色人设（`buildCoreContext`，含关系）+ 音乐口味（`char.musicProfile`）+ 当前歌 + 歌词片段 + 最近讨论 + 触发场景，返回 `{ reply, action }`。
- `action`：`change_song`(query) / `pause` / `resume` / `next` / `none`。
- 触发场景 `trigger`：
  - `enter` 分享进入时角色先开口（可能直接挑首歌）；
  - `user` 回应用户发言；
  - `take_over`（TA 来挑）角色主动安排（换歌/暂停）；
  - `song_changed` 歌曲自然切换时角色随口评一句（角色自己换/跳的歌用 `suppressSongChangedRef` 抑制，避免重复发言或连锁触发）。
- `executeListenAction`：`change_song` 先 `musicApi.search` 取真实歌曲播放，搜不到回退角色歌单 / 一起写的歌；`next` 调 `nextSong`，`pause`/`resume` 调 `togglePlay`；角色主动执行换歌 / 暂停 / 继续 / 下一首时会同时发 toast 和本地系统通知（若已授权）。

> 讨论内容会缓存在本机 localStorage，退出一起听界面或关闭音乐 App 后再进入仍能接上；但它不落入主聊天上下文，也不会写进角色聊天记录。分享时落到角色聊天的那张「一起听」音乐卡仍是主聊天里的唯一记录；点「结束」会清理本次一起听缓存。
