# 名册·新的朋友 · 拉黑/验证

> **历史说明：「创建/导入角色后必须先加好友才能聊天」的闸门已移除。**
> 曾经新建/导入的角色一律 `friendStatus:'pending'`，要先在名册通过好友验证才能聊天；
> 现已删除该 `friendStatus` 字段与全部 pending 闸门。新建（`OSContext.addCharacter`）/
> 导入（`OSContext.importCharacter`，含 Character App 的角色卡导入）的角色一律 `addedToChat:true`，
> **直接出现在「往来」并可立即开聊**，不再需要任何好友验证。

## 名册·新的朋友（收录待处理的角色）
`apps/ChatHub.tsx` 的「名册」tab 顶部「新的朋友」分组，收录两类需要处理的角色：
- `charBlock.active`（角色把你拉黑）→「验证」按钮，走 `FriendVerifyModal`（好友验证）。
- `blacklisted`（你把角色拉黑）→「解除拉黑」按钮，直接 `updateCharacter({blacklisted:false})`。

## 好友验证（`components/chat/FriendVerifyModal.tsx`）
- 用途：**被角色拉黑后重新申请**（reblock）。入口：名册「新的朋友」的「验证」按钮 / 聊天页被拉黑横幅「发送好友验证」/ `ChatHub.openPrivateChat` 对 `charBlock.active` 自动转入。
- 用户写一条验证消息 → 角色按人设 + 拉黑前的聊天语境（副 API，未配则回退主 API）决定是否把你拉回，并在验证里回复。
- 通过：解除 `charBlock` / `blacklisted` + `addedToChat:true`，落「验证 + 系统提示 + 角色回应」。
- **拒绝也把角色的回应落库**（`friendVerifyReply`）—— 修复「角色拒绝/拉黑后用户收不到角色验证消息」。

## 文具盒（设置）全屏
`PhoneShell` 把 `AppID.Settings` 加入「自理安全区」白名单（不再由外壳加 padding），`Settings` 根节点自己 `paddingTop/Bottom = var(--safe-*)` → 背景铺满全屏、内容避让安全区。

## 清空记录（`Chat.tsx:handleClearHistory`）
彻底清空（未勾「留最近 10 条」）时，除删消息外还重置本会话沉淀：好感 / 心情 / 关系 / 婚姻、以及 **TA 对你的备注**（`convoSettings.userNickname` 及其历史/动机），并清空偷看心声历史（`DB.clearInnerVoicesByCharId`）。

## 岁时记·喜事
仅当有角色 `marriage.active`（求婚成功）时，封面才出现「喜事」入口（`apps/AlmanacApp.tsx:hasWedding` 同时把守入口卡与 section 渲染）。
