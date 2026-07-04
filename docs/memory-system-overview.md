# 记忆系统概览

Moro 现在包含两层长期记忆：

- **Legacy 日度 / 月度总结**：老的 `MemoryFragment[]` 与 `refinedMemories`，仍用于兼容、手动归档和旧资料迁移。
- **回忆标本馆 / Cognitive Flow**：主系统，本地 IndexedDB 存储，使用副 API 做文本提取、关联分析、认知消化和梦境消化。检索只走本地文本索引，不连接云端检索库。

## 系统一：Legacy 日度 / 月度总结

### 数据结构

- `memories: MemoryFragment[]`：每日记录，含 date / mood / summary。
- `refinedMemories: Record<string, string>`：月度精炼总结。
- `activeMemoryMonths: string[]`：哪些月份的详细日记要注入上下文。

### 注入方式

- `buildRoleSettingsContext(char)`：注入月度总结与当前月日度记录，用于角色设置分析。
- `buildCoreContext(char, user, true)`：注入长期核心记忆与激活月份详情。
- AI 仍可用 `[[RECALL: YYYY-MM]]` 主动拉取某月详细日志。

Legacy 数据可通过回忆标本馆设置里的「导入旧记忆」重新提取成 `MemoryNode`。新迁移数据会写 `source.kind='legacy_memory'`，便于之后安全清理。

## 系统二：回忆标本馆 / Cognitive Flow

### 七个房间

| 房间 | 用途 | 衰减 |
|------|------|------|
| `living_room` 客厅 | 日常闲聊、近期互动 | 有容量和衰减 |
| `bedroom` 卧室 | 亲密情感、深层羁绊 | 慢衰减 |
| `study` 书房 | 工作、学习、技能成长 | 慢衰减 |
| `user_room` 用户房间 | 用户个人信息、习惯、人际关系 | 慢衰减 |
| `self_room` 自我房间 | 角色自我认同、长期认知 | 不主动衰减 |
| `attic` 阁楼 | 未消化的困惑、创伤、潜意识 | 不主动衰减 |
| `windowsill` 窗台 | 期盼、目标、愿望 | 不主动衰减 |

## 存入管线

### 1. 缓冲区与高水位

- 最近 200 条语义消息是热区，继续留在聊天上下文，不整理。
- 热区之前的旧聊天进入缓冲区。
- 自动整理阈值是 100 条；手动整理最低 10 条。
- `mp_lastMsgId_<charId>` 记录处理高水位，避免重复整理。

### 2. LLM 提取

`extraction.ts` 使用文具盒副 API，让模型把一段旧聊天提取为 `MemoryNode[]`：

- 第一人称叙事，用户用稳定称呼。
- 写入房间、重要性、情绪、标签。
- 尽量保存 `sourceQuote`、`genNote`、`sourceMessageIds`，供证据链回看。
- 可带 `relatedTo`、`corrections`，用于跨时间事件盒关联和旧记忆纠错。

### 3. 本地保存与关联

新节点直接写入 IndexedDB：

- `MemoryNodeDB.saveMany(memories)`
- `eventBox.ts` / `links.ts` 建立事件盒和结构关联。
- 不生成额外检索索引，不写远程表。

### 4. 事件盒压缩

EventBox 把同一件事的多条记忆绑在一起：

- 活节点达到阈值后，副 API 把旧 summary + 活节点压缩成新的整合回忆。
- 原活节点标记 `archived=true`，默认不再单独普通浮现，但可在 UI 里复活。
- 事件盒支持手动改名、改标签、封盒、解封、移出成员。

## 检索管线

检索全程本地计算：

1. 从最近消息或 `queryHint` 构造查询文本。
2. `hybridSearch.ts` 使用 BM25 / 关键词 / tag / room 权重打分。
3. `dateResolver.ts` 对“去年 12 月”“昨天”等日期表达做额外时间范围召回。
4. `activation.ts` 做扩散激活，沿 MemoryLink 和 EventBox 找相关记忆。
5. `priming.ts` 做情绪启动与反刍概率。
6. `recallFatigue.ts` 根据召回回执降权近期反复出现的同一条记忆。
7. `cognition.ts` 的工作记忆快照让下一轮沿着相近语义延续。
8. `formatter.ts` 把结果格式化后注入 system prompt。

## Cognitive Flow 层级

`MemoryNode.cognitiveLayer` 用于区分不同长期记忆层：

- `event`：可追溯的原子事件 / 事实。
- `episode`：一段连续互动或事件盒片段。
- `episode_summary`：事件盒压缩后的剧情片段摘要。
- `saga`：跨周/月的长期主线。
- `feel`：角色第一人称沉淀下来的感受，普通召回更克制。

## 认知消化

### 普通认知消化

`digestion.ts` 会定期或手动触发：

- 阁楼困惑：解决、加深或淡化。
- 窗台期盼：达成或落空。
- 书房知识：内化为自我理解。
- 强共激活簇可被 `cognition.ts` 提炼成稳定认知，落入 `self_room`。

### 本地梦境消化

`dreamDigestion.ts` 只调用副 API：

- 从已有记忆中挑选材料。
- 生成 `feel` 感受层和少量 `saga` 主线。
- 继承源记忆线索和证据链。
- 将普通源记忆标记为已内化 / 已解决，让低权重旧事更少反复冒出。

## UI 与维护

回忆标本馆 UI 在 `apps/MemoryPalaceApp.tsx`：

- **记忆浏览器**：按房间、层级、关键词浏览；展开可看原文、碎碎念和证据链。
- **心意图谱**：展示 MemoryLink 和 EventBox 合成边，解释记忆为什么连在一起。
- **事件盒**：查看整合回忆、活节点、归档节点，支持封盒 / 解封 / 复活 / 移出。
- **体检 / 修复**：只做本地结构检查和安全修复，包含高水位、热区、可处理缓冲、断链、坏事件盒引用、节点盒关系不一致等。
- **危险区清空**：清空本地记忆节点、关联、事件盒、期盼、高水位，并移除旧版本留下的本地索引残留表数据。

## 关键文件索引

| 文件 | 职责 |
|------|------|
| `types.ts` | MemoryNode / EventBox / MemoryLink 等类型 |
| `db.ts` | IndexedDB CRUD 与旧数据清理 |
| `pipeline.ts` | 存入、检索、注入、日记吞吐 |
| `extraction.ts` | 副 API 记忆提取 |
| `eventBox.ts` / `eventBoxCompression.ts` | 事件盒创建、绑定、压缩 |
| `links.ts` | 结构关联 |
| `hybridSearch.ts` / `bm25.ts` / `bm25Index.ts` | 本地文本检索 |
| `activation.ts` / `priming.ts` | 扩散激活、情绪启动、反刍 |
| `recallFatigue.ts` / `recallReceipts.ts` | 防复读和召回回执 |
| `formatter.ts` | 注入文本格式化 |
| `digestion.ts` / `dreamDigestion.ts` | 认知消化与本地梦境消化 |
| `cognition.ts` / `cognitiveFlow.ts` | 工作记忆快照、长期认知、模式判断 |
| `migration.ts` | 旧日度 / 月度记忆迁移 |
| `maintenance.ts` | 体检、结构修复、旧聊天追平 |
