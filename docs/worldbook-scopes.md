# 世界书：开关 / 作用域 / 插入位置

世界书的「一本书」= 一个分组（`Worldbook.category`）。每条 `Worldbook` 记录是书里的一个**条目**。
桌面入口现名「**剪报夹**」（Ins / 拍立得风 UI）。界面使用功能性命名：世界书 = 分组，
条目 = 可注入的一段设定；条目激活方式分为常驻（ST constant / 蓝灯）与关键词（ST key / 绿灯）。
SillyTavern 角色卡导入时：`character_book` 的书名（无书名则 `{角色名} 的世界书`）作为分组，每个 lorebook entry 是一条条目（原始 ST 设置完整保留在 `stData`）。

## 三层开关

| 开关 | 存哪 | 语义 |
|------|------|------|
| 条目开关 `wb.enabled` | worldbooks store | `false` = 任何场景都不注入。`undefined` 视为开（向后兼容） |
| 整书开关 | localStorage `worldbook_group_toggles`（按 category）| `false` = 整本书的所有条目暂停注入 |
| 整本作用域 | localStorage `worldbook_group_scopes`（按 category） | `local` / 未记录 = 需要绑定到角色或会话；`global` = 所有角色都可使用这本书 |

- **局部书**：仅当在「聊天设置 → 世界书挂载」里绑定（`char.mountedWorldbooks`）后才随系统提示注入。绑定按**整本书**操作（同分组条目一起挂/卸），注入时逐条对照 live 记录过滤条目开关、整书开关与关键词激活。
- **全局书**：整本作用域为 `global` 的分组对所有角色可用，无需绑定；书内条目仍各自按常驻 / 关键词规则决定是否注入。
- **整本作用域不会批量修改条目**：切换一本书的全局 / 局部只改变这本书的可用范围，不会把书内条目改成全局、常驻或关键词。
- **两者同时生效时，系统提示先写局部绑定、再写全局**（每个插入位置内都遵守此序）。
- 挂载快照在 live 记录存在时永远以 live 内容/设置为准；live 记录被删（或卡片自带快照）时按快照原样生效（旧行为）。
- **整本挂载实况同步**：挂载记录的语义是「绑定整本书（分组）」。`resolveForChar` 会按挂载条目推导出已绑定的分组，把该分组下**后来新增的 live 条目**也一并注入（仍尊重条目/整书开关与关键词激活）——世界书 App 里的增删改与聊天注入实时一致。
- 未填分组的条目按 **`未分类设定 (General)`**（`DEFAULT_WB_CATEGORY`）归组；整书开关 / 运行时 / 各面板的兜底分组名必须用这同一个常量，否则会出现「整书已关却仍注入」。

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
OSContext (worldbooks state + 整书开关 state + 整本作用域 state)
   └─ useEffect → WorldbookRuntime.sync()      // 模块级注册表镜像
        ├─ ContextBuilder.buildCoreContext     // beforeChar / afterChar 分段
        ├─ ContextBuilder.buildGroupSharedScene// 共享挂载块 + 全局块（一次）
        └─ buildChatRequestPayload             // @Depth 消息注入
```

改注入逻辑前先看 `utils/worldbookRuntime.ts`（含完整规则注释）与 `utils/worldbookRuntime.test.ts`。

## 关键词激活（ST 蓝灯/绿灯，已移植）

`wb.activation`：

| 值 | 对应 ST | 语义 |
|----|---------|------|
| `'always'`（缺省） | 🔵 常驻 (constant) | 开关开着就注入 |
| `'keyword'` | 🟢 关键词触发 | 扫描最近聊天消息，命中关键词才注入 |

相关字段：`keys`（主关键词，任一命中即激活）、`secondaryKeys` + `selective`
（开 selective 后需主词 + 任一二级词同时命中）、`caseSensitive`（默认不敏感）、
`scanDepth`（扫最近 N 条消息，默认 4）。

实现要点：

- 扫描上下文由 **`buildChatRequestPayload`** 在构建 prompt 前通过
  `WorldbookRuntime.setScanContext(最近消息文本[])` 喂入，构建结束即清空
  （try/finally）。判定在 `WorldbookRuntime.isEntryTriggered`。
- **没有扫描上下文的调用方**（约会等单 prompt 场景）不注入关键词条目 ——
  同 ST：没有可扫描的文本就没有命中。常驻条目不受影响。
- **ST 角色卡导入**：新导入自动映射（constant→常驻；有 keys 且非 constant→关键词）。
  旧导入条目仍按常驻运行，在世界书 App 编辑器里打开一次（字段自动从 `stData`
  回填）保存即可接上关键词激活。
- 预设 App 启用时，命中的 before/after 条目作为 `worldInfoBefore` /
  `worldInfoAfter` marker 内容注入到预设 prompt_order 定义的位置（见
  `docs/preset-app.md`）。
