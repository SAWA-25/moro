# 角色真实城市系统

> 改「角色城市 / 实时天气接地 / 查手机外卖彩蛋」相关逻辑前看这份。

给角色一座「所在城市」，让生活有真实质感。两种模式：

- **真实城市**（现实世界角色）：直接选真实城市（上海 / 成都 / 东京…）。实时天气按这座城市取，
  本地街区、小吃、餐厅、外卖都按真实情况由 LLM 接地。
- **架空城市**（虚拟/架空角色）：可选「原型城市」+「虚拟程度 0~100」。借原型的真实风物，
  但按虚拟程度决定是直接挪用真实地名/店名（低）还是改写化用成自己的设定（高），对外只称虚拟名。

## 设计

纯**提示词接地 + 复用现有实时基础设施**，不引入新外部 API（对应需求「复用现有 + LLM 接地」）：

- 城市块由 `ContextBuilder.buildCoreContext` 注入 → 聊天、查手机(CheckPhone)、线下模式等所有读
  coreContext 的地方自动带上城市真实感。
- **实时天气**：真实城市角色在 `chatPrompts` 里把 `realtimeConfig.weatherCity` 覆盖成 TA 自己的城市
  （复用 `realtimeContext` 的 OpenWeatherMap，需用户已配天气源）；虚拟城市不把原型暴露给天气块，
  由城市块按虚拟程度让 LLM 接地气候。
- **外卖彩蛋**：CheckPhone 的「外卖 / 购物」生成 prompt 追加 `buildPhoneCityHint`，让订单落到角色城市
  真实存在的店与本地特色上（虚拟城市按虚拟程度改写）。因为 CheckPhone 本就是 LLM 驱动，"真实外卖"
  即来自模型对真实城市的知识。

## 数据模型

`CharacterProfile.cityConfig`（`types.ts` 的 `CharCityConfig`）：

```ts
{ mode: 'real' | 'virtual';
  realCity?: string;        // real：真实城市名
  virtualName?: string;     // virtual：架空城市显示名
  prototypeCity?: string;   // virtual：原型真实城市
  fictionLevel?: number; }  // virtual：虚拟程度 0~100
```

## 关键文件

| 文件 | 关键点 |
|------|-------|
| [`utils/charCity.ts`](../utils/charCity.ts) | `resolveCity` / `buildCityPromptBlock`（城市块）/ `getWeatherCity`（真实城市天气）/ `buildPhoneCityHint`（外卖彩蛋） |
| [`utils/context.ts`](../utils/context.ts) | `buildCoreContext` 注入城市块（贴着会话设定 region 之后） |
| [`utils/chatPrompts.ts`](../utils/chatPrompts.ts) | 真实城市角色：天气 city 覆盖为角色城市 |
| [`apps/CheckPhone.tsx`](../apps/CheckPhone.tsx) | 外卖/购物 prompt 追加城市提示 |
| [`components/chat/ConvoSettingsPanel.tsx`](../components/chat/ConvoSettingsPanel.tsx) | P.05「TA 的城市」配置 UI（真实/架空/原型/虚拟程度滑杆） |
| [`types.ts`](../types.ts) | `CharCityConfig` + `CharacterProfile.cityConfig` |

## 入口

聊天 → ··· → 聊天设置 → P.05「TA 的小日子」→「TA 的城市」：不设定 / 真实城市 / 架空城市。
