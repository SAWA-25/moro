# 人设 App（SillyTavern Persona Management 移植）

把酒馆（SillyTavern）的用户人设管理搬进 Moro：桌面入口现名「**剪影集**」
（PersonaHubApp，黑白拼贴手账风封面页），内含「登场人物」（角色档案，
Character.tsx）与「**扮相手账**」（用户人设，PersonaApp.tsx）。扮相手账可以保存
多套「你是谁」（署名 / 照片 / 页角注记 / 自述），点击即启用，支持绑定角色（进
对应聊天自动切换）、默认人设、描述注入位置（嵌入提示词 / @Depth / 不注入）、
绑定世界书分组（=ST 人设世界书）、备份恢复。

UI 文案与功能术语对照（代码字段 / ST 语义不变，只换了说法）：

| 界面词 | 实际语义 |
|--------|----------|
| 一页扮相 | 一条 `Persona` 记录 |
| 戴上 / 佩戴中 | 激活人设（`os_active_persona_id`） |
| 钉为常驻（图钉） | 默认人设（`os_default_persona_id`） |
| 别在角色上（别针） | `Persona.connections` 角色绑定 |
| 剪一份 / 撕掉 | 复制 / 删除 |
| 署名 / 页角注记 / 自述拼贴 | name / title / description |
| 自述寄往何处：缝进提示词 / 夹进对话 / 压在箱底 | position：IN_PROMPT / AT_DEPTH / NONE |
| 以谁的口吻 | depth role（system / user / assistant） |
| 随页夹带的世界书 | `Persona.lorebookCategory` |
| 整本装箱 / 拆箱回填 | JSON 备份 / 恢复 |

## 文件地图

| 文件 | 职责 |
|------|------|
| `apps/PersonaApp.tsx` | UI：列表（搜索/排序/网格）、编辑面板（头像/名字/标题/描述/位置/世界书）、默认/绑定/复制/删除、备份恢复 |
| `utils/personas.ts` | `PersonaRuntime`（激活/默认 id 读写 + DB 取数）、`pickPersonaForConnection`（自动切换优先级）、位置归一化 |
| `utils/personas.test.ts` | 自动切换优先级 / 位置兼容的单测 |
| `types.ts` | `Persona` / `PersonaConnection` / `PERSONA_POSITION` |
| `utils/db.ts` | `personas` store（v65）+ `DB.getAllPersonas/getPersona/savePersona/deletePersona`，备份导入导出已接入 |

## 核心设计：激活 = 写入档案

激活人设时把 name / avatar / description 写进 `UserProfile`（档案 App 的数据）。
聊天气泡头像、群聊、Instant Push、所有读 `userProfile` 的链路**立即生效**，
不需要每个调用方感知人设系统。人设记录本身保留位置 / 深度 / 世界书等高级语义，
由主聊天链路（`buildChatRequestPayload`）按激活 id 反查解析：

- 在人设 App 里编辑「当前启用」的人设 → 档案同步更新；
- 档案 App 里手动改 → 不回写人设（人设是档案的「存档」，档案是运行时值）。

## 与 ST 的语义对齐

| ST | Moro |
|----|------|
| `power_user.personas` / `persona_descriptions` | IndexedDB `personas` store（`Persona` 记录） |
| `user_avatar`（当前人设） | localStorage `os_active_persona_id` |
| `default_persona` | localStorage `os_default_persona_id` |
| connections（角色锁） | `Persona.connections`，进聊天时 Chat.tsx 调 `resolveForConnection` 自动切换（绑定 > 默认 > 不动），切换时 toast 提示 |
| `persona_description_position` | `Persona.position`，保留原始数值：0=嵌入提示词，4=@Depth，9=不注入；ST 的 1（废弃）/ 2 / 3（作者注释，Moro 无锚点）导入时归一为 0 |
| `persona_description_depth` / `role` | `Persona.depth`（默认 2）/ `Persona.role`（0=system 1=user 2=assistant），@Depth 时经 `WorldbookRuntime.spliceDepthMessages` 插进聊天历史 |
| persona lorebook | `Persona.lorebookCategory`（世界书分组名）。主聊天链路用 `WorldbookRuntime.setExtraCategories` 让该分组的局部条目视同已挂载（仍尊重条目/整书开关与关键词激活），构建完清空 |
| `{{persona}}` 宏 | `utils/macros.ts` 支持，替换为当前人设描述（无人设时为档案 bio） |
| 一角色一人设（multi connections 关闭） | 绑定角色时自动从其他人设上解绑该角色 |

## 注入位置语义（buildChatRequestPayload）

- **嵌入提示词（0，默认）**：描述进核心上下文的「互动对象」块；预设启用时落在
  `personaDescription` marker 的位置（受 marker 开关控制）。
- **@Depth（4）**：核心上下文 / marker 里的「设定/备注」为「无」，描述以指定
  role 插到聊天历史对应深度 —— 在预设骨架（applyPresetToMessages）之前插，
  保证深度消息进历史段。
- **不注入（9）**：描述彻底不发；名字仍然生效（{{user}} 宏、互动对象块的名字行）。

群聊与情绪评估等次级链路读 `userProfile`（已被激活人设覆盖），等价于「嵌入提示词」。

## 与其他 App 的联动

- **聊天**：进入角色聊天时按 绑定 > 默认 自动切换人设（见 `Chat.tsx` 的
  resolveForConnection effect）；切换写档案 + toast。
- **预设**：`personaDescription` marker 注入人设块（名字 + 描述）。
- **世界书**：人设可绑定一个分组（一本书），激活时整组按原位置注入。
- **档案**：底部入口跳人设 App；空人设列表时可一键「把当前档案保存为人设」
  （=ST 的 migrateNonPersonaUser）。
- **登场人物（原神经链接）**：角色卡的开场白（first_mes / alternate_greetings）独立存储
  （`CharacterProfile.firstMes` / `alternateGreetings`），进入空聊天时左右切换
  选择开场白，宏（{{user}}）按当时启用的人设名替换；对话示例（mes_example）
  同样独立存储（`CharacterProfile.mesExample`），未启用预设时作为「对话示例」块
  注入核心上下文，启用预设时落在 dialogueExamples 占位。

## 开关存储

- `os_active_persona_id`：当前启用人设 id
- `os_default_persona_id`：默认人设 id

人设本体存 IndexedDB `personas` store（v65），App 内所有改动即时落库；
完整备份（设置 App）与人设 App 自带的 JSON 备份都包含全部人设。
