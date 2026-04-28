# 长时间运行卡顿与内存膨胀调研

日期：2026-04-28

## 结论

当前这次“运行 1-2 小时后卡顿、内存涨到约 3.7 GB”的核心问题，不像是单一的 SQLite 文件变大，也不像是简单的缓存没清掉。

更像是 3 类问题叠加：

1. 内存常驻对象缺少硬上界，尤其是 renderer 侧实时告警列表。
2. 高频热路径存在全量重算，运行越久越重。
3. 缺少进程级与页面级内存观测，问题只能等用户体感爆炸后才暴露。

## 本地代码证据

### 1. worker 侧长期保留 24 小时 tick 历史

- `MarketStateStore` 默认保留 24 小时历史。
- 每次 `recordTick()` 都把 snapshot 推入 `historyByToken`。
- 规则引擎虽然只按窗口读取历史，但底层常驻保留窗口更大。

参考：
- [market-state.ts](/D:/warning app/src/core/state/market-state.ts:27)
- [engine.ts](/D:/warning app/src/core/alerts/engine.ts:33)

### 2. renderer 侧实时告警数组没有硬上界

- 初始化只拉 `200` 条。
- 但后续每个 `alerts.new` 都继续 prepend 到 `alertsRef.current`。
- 这里没有看到固定上限、环形缓冲或按时间窗口淘汰。

参考：
- [useMonitorConsole.ts](/D:/warning app/src/renderer/hooks/useMonitorConsole.ts:367)
- [useMonitorConsole.ts](/D:/warning app/src/renderer/hooks/useMonitorConsole.ts:694)
- [useMonitorConsole.ts](/D:/warning app/src/renderer/hooks/useMonitorConsole.ts:718)
- [useMonitorConsole.ts](/D:/warning app/src/renderer/hooks/useMonitorConsole.ts:1264)

### 3. 告警中心会对不断增大的 alerts 做全量加工与渲染

- `AlertCenterView` 会复制数组、逐条构建 presentation、排序、统计、过滤。
- 视图层直接 `visibleAlerts.map(...)`，没有虚拟化。

参考：
- [AlertCenterView.tsx](/D:/warning app/src/renderer/views/AlertCenterView.tsx:352)
- [AlertCenterView.tsx](/D:/warning app/src/renderer/views/AlertCenterView.tsx:372)
- [AlertCenterView.tsx](/D:/warning app/src/renderer/views/AlertCenterView.tsx:587)

### 4. dashboard 查询会全量扫未确认告警

- `queryDashboard()` 每次都会 `queryAllAlertEventRows({ acknowledged: false })`。
- 这个辅助函数会一直翻页，把符合条件的所有告警都读出来。
- 如果 UI 里很少确认告警，这条路径会随时间单调变重。

参考：
- [worker-runtime.ts](/D:/warning app/src/core/worker-runtime.ts:1558)
- [worker-runtime.ts](/D:/warning app/src/core/worker-runtime.ts:1586)
- [worker-runtime.ts](/D:/warning app/src/core/worker-runtime.ts:1760)

### 5. 气泡评分每 60 秒全量扫一遍告警历史

- `BUBBLE_SCORE_RECOMPUTE_INTERVAL_MS = 60 * 1000`
- `BUBBLE_ALERT_HISTORY_START_MS = 0`
- `queryRecentAlertEventsForScoring()` 从 `triggeredAt >= 0` 开始查全部匹配告警。

参考：
- [worker-runtime.ts](/D:/warning app/src/core/worker-runtime.ts:502)
- [worker-runtime.ts](/D:/warning app/src/core/worker-runtime.ts:911)
- [repository.ts](/D:/warning app/src/core/db/repository.ts:486)

### 6. dashboard tick 频率高，renderer 会反复整页重拉

- worker 侧市场变更后会发 `dashboard.tick`。
- renderer 侧收到后，180ms 防抖再重新 `loadSnapshot()`。

参考：
- [worker-runtime.ts](/D:/warning app/src/core/worker-runtime.ts:2417)
- [DashboardView.tsx](/D:/warning app/src/renderer/views/DashboardView.tsx:197)

### 7. 当前缺少正式内存遥测

仓库内未检索到：

- `app.getAppMetrics`
- `process.getProcessMemoryInfo`
- `process.getBlinkMemoryInfo`
- `webFrame.getResourceUsage`

这意味着目前无法把问题快速分流到 Browser 进程还是 Tab 进程。

## 外部官方资料结论

### Electron

- 官方建议优先建立性能测量，而不是凭体感调参。
- `app.getAppMetrics()` 适合看进程级指标。
- `process.getProcessMemoryInfo()` 可看当前进程内存。
- `webFrame.clearCache()` 不是通用内存修复，盲清可能让应用变慢。

### React / web.dev

- `startTransition` 和 `useDeferredValue` 的价值是降低交互阻塞，不是减少总工作量。
- 长列表真正有效的手段通常是虚拟化，而不是继续堆 `memo`。
- 高频数据不应该让整棵 React 树同步承压，不参与渲染的数据更适合放到 `ref` 或局部状态。

### SQLite

- `WAL`、`checkpoint`、`journal_size_limit` 主要影响磁盘与写入节奏，不是解决多 GB 运行内存的主药。
- `cache_size` 只会影响 SQLite 页缓存这一部分，不会解决 JS Map、Array、渲染树、业务常驻对象的膨胀。

## 优先级排序

### 第一优先级

1. 给 renderer 告警缓存加硬上界。
2. 告警中心列表虚拟化，并去掉全量重建热点。
3. dashboard 不再每次全量扫未确认告警。
4. bubble 评分改成增量计算，不再从 0 全表重扫。
5. 增加 Electron 进程级与 renderer 级内存埋点。

### 第二优先级

1. 把 worker 内 tick 历史从 24h 常驻，改成按规则窗口或 ring buffer。
2. 降低整页 snapshot 重拉频率，改成更增量的 dashboard 更新。
3. 复核相关查询索引与 `EXPLAIN QUERY PLAN`。

### 第三优先级

1. SQLite `WAL`/checkpoint/压缩策略。
2. HTTP cache / Blink cache 清理策略。
3. 更重的后台隔离，如评估 `utilityProcess`。

## 哪些方向帮助大，哪些帮助有限

帮助最大的方向：

- 限制常驻内存上界
- 干掉全量扫描
- 干掉全量列表渲染
- 增加正式遥测

帮助有限的方向：

- 单纯迁库到 D 盘
- 单纯清缓存
- 单纯调 SQLite WAL
- 单纯给 React 组件包一层 `memo`

## 关键来源

- [Electron Performance](https://www.electronjs.org/docs/latest/tutorial/performance)
- [Electron process API](https://www.electronjs.org/docs/latest/api/process)
- [Electron app.getAppMetrics](https://www.electronjs.org/docs/latest/api/app#appgetappmetrics)
- [Electron webFrame API](https://www.electronjs.org/docs/latest/api/web-frame)
- [Electron session API](https://www.electronjs.org/docs/latest/api/session)
- [Chrome DevTools Memory](https://developer.chrome.com/docs/devtools/memory/)
- [Chrome DevTools Performance Monitor](https://developer.chrome.com/docs/devtools/performance-monitor)
- [React startTransition](https://react.dev/reference/react/startTransition)
- [React useDeferredValue](https://react.dev/reference/react/useDeferredValue)
- [React memo](https://react.dev/reference/react/memo)
- [React useRef](https://react.dev/reference/react/useRef)
- [web.dev react-window virtualization](https://web.dev/articles/virtualize-long-lists-react-window)
- [web.dev animation performance guide](https://web.dev/articles/animations-guide)
- [SQLite WAL](https://sqlite.org/wal.html)
- [SQLite PRAGMA](https://sqlite.org/pragma.html)
- [SQLite mmap](https://sqlite.org/mmap.html)
- [SQLite EXPLAIN QUERY PLAN](https://sqlite.org/eqp.html)

