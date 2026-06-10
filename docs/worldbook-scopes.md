# 世界书：开关 / 作用域 / 插入位置

世界书的「一本书」= 一个分组（`Worldbook.category`）。每条 `Worldbook` 记录是书里的一个**条目**。
SillyTavern 角色卡导入时：`character_book` 的书名（无书名则 `{角色名} 的世界书`）作为分组，每个 lorebook entry 是一条条目（原始 ST 设置完整保留在 `stData`）。

## 三层开关

| 开关 | 存哪 | 语义 |
|------|------|------|
| 条目开关 `wb.enabled` | worldbooks store | `false` = 任何场景都不注入。`undefined` 视为开（向后兼容） |
| 整书开关 | localStorage `worldbook_group_toggles`（按 category）| `false` = 整本书的所有条目（含全局条目）暂停注入 |
| 作用域 `wb.scope` | worldbooks store | `'local'`（默认）需角色挂载；`'global'` 任意消息都注入、无需挂载 |

- **局部**：仅当神经链接 App「扩展设定」里挂载（`char.mountedWorldbooks`）后才随系统提示注入。挂载按**整本书**操作（同分组条目一起挂/卸），注入时逐条对照 live 记录过滤开关与作用域。
- **全局**：注册表里所有 `scope='global'` 且生效的条目，任何角色任何消息都带上。
- **两者同时生效时，系统提示先写局部绑定、再写全局**（每个插入位置内都遵守此序）。
- 挂载快照在 live 记录存在时永远以 live 内容/设置为准；live 记录被删（或卡片自带快照）时按快照原样生效（旧行为）。

## 插入位置（对齐 SillyTavern）

`wb.position`（`types.ts` 的 `WorldbookPosition`）：

| 值 | 对应 ST | 注入点 |
|----|---------|--------|
| `before_char` | ↑Char (0) | system prompt 里「### 你的身份」之前 |
| `after_char`（默认） | ↓Char (1) | 原「扩展设定集」块的位置 |
| `depth_system` / `depth_user` / `depth_assistant` | @D⚙️/@D👤/@D🤖 (4 + role) | 以对应 role 插到聊天历史倒数第 `wb.depth` 条处（depth 0 = 最末尾，默认 4） |

ST 的作者注释 / 示例消息锚点（2/3/5/6/7）导入时降级为 `after_char`。
`wb.order`：同一位置内**小的在前**（与 ST 排序后的净效果一致），默认 100。

## @Depth 的双通道（防止双重注入）

- **主聊天**（`buildChatRequestPayload`）：`buildSystemPrompt(..., omitDepthWorldbooks=true)` 让 @Depth 条目**不**内联进 system prompt，组装 `fullMessages` 后由 `WorldbookRuntime.spliceDepthMessages` 按深度插成独立消息（同 role+depth 合并为一条，永不插到首条 system 之前）。
- **其他单 prompt 调用方**（日记、小说、主动消息文本化 prompt 等）：默认内联降级——@Depth 条目排进「扩展设定集」块尾部，内容不丢。
- **群聊**（`buildGroupSharedScene` + 各成员 `buildCoreContext(skipWorldbookIds)`）：全局条目在共享场景块渲染**一次**，成员个人块跳过全局段，避免成员数 × 全局条目的重复。

## 数据流

```
OSContext (worldbooks state + 整书开关 state)
   └─ useEffect → WorldbookRuntime.sync()      // 模块级注册表镜像
        ├─ ContextBuilder.buildCoreContext     // beforeChar / afterChar 分段
        ├─ ContextBuilder.buildGroupSharedScene// 共享挂载块 + 全局块（一次）
        └─ buildChatRequestPayload             // @Depth 消息注入
```

改注入逻辑前先看 `utils/worldbookRuntime.ts`（含完整规则注释）与 `utils/worldbookRuntime.test.ts`。
