# 聊天界面·极简「此刻」皮肤

> 改聊天界面默认观感前必读。一句话：私聊（`apps/Chat.tsx`）默认走一套**浅灰白 + 无边框软胶囊**的极简风格
> ——白色悬浮圆角顶栏 + 居中头像、纯浅灰胶囊气泡（昵称标签 + 时间戳在该组消息上方）、爱心发送键。
> 全部是「默认值」，用户在「主题 / 外观」里改过仍尊重其配置。

## 这套皮肤由哪些既有开关拼成

大部分能力本就存在，这次只是把默认值调到位 + 补了一个无边框气泡变体：

| 观感点 | 由谁实现 | 默认值 |
|--------|----------|--------|
| 背景 #EDEDED 纯色 | `apps/Chat.tsx` `chatRootClass`（`chromeStyle==='soft'`）| `bg-[#ededed]`（原 `#fafafa`）|
| 白色悬浮圆角顶栏 + 居中头像（下沉叠在下边缘）+ 细线灰图标 + 右侧 ☰ | `components/chat/ChatHeaderShell.tsx`（`headerStyle==='minimal'` + `headerAlign==='center'`）| 已是默认 |
| 顶部状态签名（顶栏上方居中小灰字）| `ConvoSettings.headerDecorText` → `ChatHeaderShell` `decorText` | 用户自定义（每会话）|
| 日期分割「🤍 Today 22:28 💬」| `apps/Chat.tsx` 消息流时间分割线 | 已有爱心 + 对话气泡图标 |
| 纯浅灰胶囊气泡·无描边无阴影 | `components/chat/MessageItem.tsx` 新增 `bubbleVariant: 'plain'` | 默认（`osTheme.chatBubbleStyle \|\| 'plain'`）|
| 长句拆成多条短气泡 | `ConvoSettings.bubbleStyleMode='split'`（提示词 + `applyAssistantPostProcessing` 切块）| 已是默认 split |
| 昵称标签 + 时间戳在该组消息**上方** | `MessageItem.tsx`（`isPlainBubble` 时）| 随 plain 生效 |
| 底部状态签名（输入栏上方居中小灰字）| `ConvoSettings.footerDecorText` | 用户自定义（每会话）|
| 颜文字占位符 + 爱心发送键 | `components/chat/ChatInputArea.tsx`（占位符默认 `ʕ•ﻌ•ʔ 说点什么…`；空输入时发送键渲染实心 `Heart`）| 默认 |

## 新增的 `plain` 气泡变体（`MessageItem.tsx`）

- `bubbleVariant` 类型加 `'plain'`：`containerStyle` 里 `boxShadow:'none' + border:'none'`，外层 className 也不加 `shadow-sm` / `border-black/5`——即**纯浅灰底、无描边、无阴影**（气泡底色 / 圆角仍来自 `activeTheme`，默认 `PRESET_THEMES.default` 的奶白手帐配色，圆角 22）。
- `isPlainBubble` 时的布局调整（仅影响这套皮肤，其它 `wechat/ios/...` 变体不变）：
  - 对方（char）**不逐条显示头像**（`!isUser && !isPlainBubble` 才渲染），内容左缩进从 `ml-12` 收到 `ml-1`；身份改由组上方的**昵称标签**（浅灰小圆角块）承载。
  - 该组**第一条**消息上方渲染 `昵称标签 + 时间戳`（对方）/ `时间戳`（我方，右对齐）。
  - 组下方不再重复时间戳（仅保留发送 / 已读 ticks）。
- 我方（user）头像保留在右下（保住「点头像 → 帮我想想接下来说什么」入口）。

## 想换回老样子 / 别的皮肤

外观设置里改这些键即可（都是 `osTheme.*`，非破坏性）：
- `chatBubbleStyle`：`wechat`（带细描边）/ `ios` / `modern` / `shadow` / `outline` / `plain`…
- `chatChromeStyle`：`soft`(默认极简灰) / `flat`(纯白) / `floating`(淡靛) / `pixel`。
- `chatBackgroundStyle`：`plain` / `grid` / `paper` / `mesh`，或给角色单设 `char.chatBackground` 背景图。
- 顶 / 底状态签名：聊天设置面板的「顶栏文案 / 底部文案」（`headerDecorText` / `footerDecorText`）。

## 顶栏极简化细节（`ChatHeaderShell.tsx`）

对齐参考图，仅在 `headerStyle==='minimal'`（默认）下生效，其它顶栏风格不变：

- **右侧单个 ☰**：菜单按钮图标由 `DotsThreeVertical`（⋮）换成 `List`（☰）。Chat.tsx 只传 `onOpenSettings`（聊天设置），故右侧本就是单个按钮。
- **居中头像下沉叠放**：`sinkAvatar = useCenteredLayout && headerStyle==='minimal'`。此时只渲染一枚大头像（`w-16`），用 `translate-y-[26px]` 把它压到白色顶栏下边缘、叠出卡片之外（transform 不影响布局、不会撑高顶栏；根容器 `overflow-hidden` 只裁屏幕边缘，卡片内的上下叠放不受影响）。
- **省去顶栏内角色名**：下沉布局里不再显示 `activeCharacter.name`（参考图顶栏无名字）；昵称改由消息气泡上方的标签承载。若有情绪 buff，则把 buff 行放到头像上方空白处保留显示。
- 想恢复「顶栏显示名字 / 非下沉头像」：把 `osTheme.chatHeaderStyle` 从 `minimal` 切到 `default`/`wechat` 等，或 `chatHeaderAlign` 改 `left`。
