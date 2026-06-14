# 加好友才能聊天 · 名册·新的朋友 · 拉黑/验证

## 必须先加好友才能聊天
- `CharacterProfile.friendStatus`：`'pending'`（待加好友）/ `'friend'`（已是好友）。旧数据无此字段 → 按「已是好友」处理（向后兼容，不动存量角色）。
- 新建（`OSContext.addCharacter`）和导入（`OSContext.importCharacter`，含 Character App 的角色卡导入）的角色一律 `friendStatus:'pending'`。
- 聊天闸门：
  - `ChatHub.openPrivateChat` 对 pending → 转「添加好友」验证、对 `charBlock.active` → 转「好友验证」。
  - `Chat.tsx`：pending 时整屏挂 `FriendVerifyModal mode="add"`（拦在聊天前，覆盖一切入口包括 Character App 的「进入聊天」）；`handleSendText` 也兜底拦截。

## 名册·新的朋友（收录好友验证）
`apps/ChatHub.tsx` 的「名册」tab 顶部新增「新的朋友」分组，收录三类需要处理的角色：
- pending（待验证）→「加好友」按钮，走 `FriendVerifyModal mode="add"`。
- `charBlock.active`（角色把你拉黑）→「验证」按钮，走 `mode="reblock"`。
- `blacklisted`（你把角色拉黑）→「解除拉黑」按钮，直接 `updateCharacter({blacklisted:false})`。

## 好友验证（`components/chat/FriendVerifyModal.tsx`）
- `mode`：`'add'`（初次加好友）/ `'reblock'`（被角色拉黑后重新申请）。
- `'add'` 没配 API 时直接通过（新朋友默认接受，避免没 API 被卡在无法聊天）；配了 API 则按人设判定（一般通过）。
- 通过：`friendStatus:'friend'` + 解除 `charBlock` / `blacklisted`，落「申请/验证 + 系统提示 + 角色回应」。
- **拒绝也把角色的回应落库**（`friendVerifyReply`）—— 修复「角色拒绝/拉黑后用户收不到角色验证消息」。

## 文具盒（设置）全屏
`PhoneShell` 把 `AppID.Settings` 加入「自理安全区」白名单（不再由外壳加 padding），`Settings` 根节点自己 `paddingTop/Bottom = var(--safe-*)` → 背景铺满全屏、内容避让安全区。

## 清空记录（`Chat.tsx:handleClearHistory`）
彻底清空（未勾「留最近 10 条」）时，除删消息外还重置本会话沉淀：好感 / 心情 / 关系 / 婚姻、以及 **TA 对你的备注**（`convoSettings.userNickname` 及其历史/动机），并清空偷看心声历史（`DB.clearInnerVoicesByCharId`）。

## 岁时记·喜事
仅当有角色 `marriage.active`（求婚成功）时，封面才出现「喜事」入口（`apps/AlmanacApp.tsx:hasWedding` 同时把守入口卡与 section 渲染）。
