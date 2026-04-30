# 异常彩票监控研究与实现

日期：2026-04-29

## 结论

“异常彩票”最合适的定义，不是泛化后的 `volume_pricing`，而是它的一个超低价特化队列：

- 先限定在超低价参考卖一：`reference ask <= 4c`
- 再观察短时间内是否被明显推高
- 价格越低，触发越敏感
- 只靠价格不够，还要有成交、旧档被吃掉、或盘口深度中的至少一种确认

当前落地规则：

- 参考卖一不高于 `4c`
- 观察窗口 `60s`
- 当前卖一不高于 `18c`
- 数据新鲜度 `30s`
- 价差上限 `10c`
- 分层推高阈值
  - `1c-2c` 参考价：推高 `3c` 触发
  - `3c-4c` 参考价：推高 `4c` 触发
- 确认来源
  - `edge_volume`：旧卖一档被吃掉
  - `trade_confirmed`：成交确认
  - `book_depth`：盘口深度仍显示足够承接

这套阈值是产品规则推断，不是 Polymarket 官方定义；它是基于官方市场结构能力，加上你对“超低价被买起来”的业务语义做的监控设计。

## 四位专家结论

### 1. 监控定义

- 核心对象必须是“极小概率、超低价”的温度结果，而不是所有带量推价。
- 最适合的参考锚点是 `best ask`，因为你关心的是超低价卖单被抬走后的新卖一。
- 参考价既可以来自最近被移除的旧卖一，也可以来自最近 `60s` 的盘口历史。
- 低价区间要单独处理，原因是 Polymarket 官方会在价格进入 `< 0.04` 或 `> 0.96` 时触发 `tick_size_change`，说明低价区是特殊微观结构区间。

### 2. 筛选简化

- 操作台不应该让人先想规则名，而应该先做运营分流。
- 最简可用筛选应收敛为：
  - 搜索
  - 日期
  - 预设模式
  - 排序
- 预设模式保留三类即可：
  - `全部盘口`
  - `异常彩票`
  - `关注队列`
- 异常彩票模式下，方向筛选应该让位于异常队列本身，因此默认锁定并按 `lotteryLift desc` 排序。

### 3. 页面呈现

- 主界面应该把它当成运营队列，而不是再增加一张普通告警卡。
- 最适合的主承载页是 `Market Explorer`。
- 页面应同时让人一眼看出三件事：
  - 有多少异常候选
  - 最强的是哪几个
  - 这个异常是如何被确认的
- 因此当前实现增加了：
  - 预设模式按钮
  - 异常彩票摘要卡
  - 城市分组优先级按异常数量和最大推高排序
  - 盘口徽标：推高幅度、确认来源、价格路径
  - 右侧检视面板：参考价、当前价、确认路径、有效数量、有效金额、信号时间

### 4. 实际效果评估

- 当前仓库已经具备基础复盘能力，可以用 `alert_events + price_ticks` 做事后评估。
- 可以先追踪四类效果指标：
  - 异常候选数量
  - 确认率
  - 从旧卖一到触发的耗时
  - 触发后是否继续上冲
- 如果要做严格回放，还需要额外长期持久化更多盘口深度字段，而不仅是最新快照。

## 为什么这样定义更贴近交易语义

- 如果一个温度结果原本只有 `1c-2c`，它本质上已经被市场视为极小概率事件。
- 这类价格一旦被买到 `4c-5c`，绝对涨幅未必比普通盘口大，但语义变化非常大。
- 所以这里不适合只用统一的 `+5c`，而更适合做低价越低、阈值越小的分层检测。
- 这也让它和普通 `volume_pricing` 分开：
  - `volume_pricing` 更像一般性的带量推价
  - `异常彩票` 更像超低价尾部事件被突然重估

## 本次实现映射

- 后端定义与计算
  - `src/core/worker-runtime.ts`
- 查询契约与市场字段
  - `src/shared/monitor-contracts.ts`
- Explorer 查询状态
  - `src/renderer/hooks/useMonitorConsole.ts`
- Explorer 主界面
  - `src/renderer/views/MarketExplorerView.tsx`
- 样式
  - `src/renderer/styles/monitor.css`

## 后续建议

- 第一阶段先稳定观察 `3c/4c` 分层阈值，不急着继续变细。
- 如果误报偏多，可以优先收紧确认条件，而不是先把价格阈值重新调大。
- 如果漏报偏多，可以再试一个更激进的版本：
  - `1c` 参考价：`+2c`
  - `2c` 参考价：`+3c`
  - `3c-4c` 参考价：`+4c`

## 来源

- [Polymarket Docs: Market Channel](https://docs.polymarket.com/market-data/websocket/market-channel)
- [Polymarket Docs: Prices & Orderbook](https://docs.polymarket.com/concepts/prices-orderbook)
- [Polymarket Docs: Orderbook](https://docs.polymarket.com/trading/orderbook)
- [Polymarket Docs: Create Order / Tick Sizes](https://docs.polymarket.com/trading/orders/create)
