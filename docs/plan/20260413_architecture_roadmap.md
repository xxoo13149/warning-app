## 1. 目标与背景
- 整体目标：在 Polymarket 天气监控桌面端里，把“性能+可扩展”问题拆成阶段性可交付模块，逐步从 V1 的稳定监控过渡到 V3 的多地域、多事件、可扩缩运维。
- 当前主要约束：Windows/Electron 单体架构、47 城 token 级订阅、实时告警、资源占用紧张、需要在本地打包成 EXE。

## 2. 阶段路线

### V1：轻量稳定的本地监控核心
- 目标：确保窗口/托盘可观察，启动有进度提示，告警、音效、通知可控，内存/CPU 在合理范围，解决“连接一直在 connecting”问题。
- 工作包：
  1. 帧级启动状态管线：主进程 `startMonitoring` 先 stop 再 start，health 增加 `startupPhase/diagnostic`；Renderer 侧 `useMonitorConsole` 用状态反馈+进度条；新增失败说明文案。
  2. 后台进程隔离：Core worker 保持 token 级索引缓存，新增 `prunePriceTicks`、`marketState.recordTick`；IPC 只暴露 `app.getHealth`/`app.control`，避免多余合约。
  3. 轻量数据流：WebSocket 每 300 token 分片；断连用 `GET /prices` 补，watchlist 深度按需；Renderer 端合并 tick、market explorer memo，减少 render。
  4. 可选配置：设置页新增通知开关+进程健康组件，支持关闭通知/退出后台。
- 风险：Polymarket token 瞬时爆发导致 GC；音频窗口隐藏后播放失败；IPC 状态不同步。
- 验收：完成 smoke test（启动/重启/停止/通知开关），`npm run test` 全绿，`npm run package` 能产生 EXE 并可在桌面快捷方式打开，启用「重新启动监控」后有进度反馈和失败 diagnostics。

### V2：并行性优化与资源节约
- 目标：让 47 城全量订阅多小时运行不爆内存，减少 renderer 渲染频次，优化数据层索引和缓存。
- 工作包：
  1. Worker 端批量发送：tick 合并 300ms 发送、price tick 表定期 prune、trackedMarket cache 索引；新增 `token_state` 索引同步更新。
  2. Renderer 差分渲染：MarketExplorer 组件 memo，对 Dashboard/Rules 列表维持缓存排序，Renderer Hooks 120ms flush；IPC 增加 `markets.query` 缓存。
  3. 监控粒度服务：增加 feed health evaluator（connecting/timeout/diagnostic）和 watchlist-only 深度订阅。
  4. 资源控制：设置页增加“后台低频模式”开关（降低 tick 合并速率、延长 reconnect backoff），并同步更新 `feed_health` 表。
- 风险：过度合并导致 UI 不响应；缓存失效而展示旧数据；低频模式下告警漏报。
- 验收：连续监控 6 小时，内存保持稳定，SQLite size 受控，Renderer FPS 无明显掉帧；后端日志 `feed_health` 无持续 error；低频模式下告警仍在 cooldown 内触发。

### V3：可扩展多业务适配
- 目标：为未来再加地区/产品线（如降水/赛事）预留 hook，支持多 worker 实例和配置热更新。
- 工作包：
  1. 数据模型抽象：把 `CityConfig/TrackedMarket` 做成可拓展 DSL，支持在 settings 里导入城市-机场映射，设置 `resolutionSourceOverride`。
  2. Worker 横向拆分：按 token shard 划分子 worker，coordinator 管理 shards（可以用 worker_threads pool 或 child_process）；引入 `market_shard` 表记录订阅状态。
  3. 插件式告警：规则引擎支持 scope、sound profile、冷却、静音；提供 REST/IPC API 让 frontend 动态管理。
  4. 运维感知：新增健康 dashboard + log rotation + 自动重启策略，可导出 `price_ticks` 历史片段供分析。
- 风险：多 worker 线程通信复杂；配置热更失败可能阻塞所有订阅；插件化规则影响性能。
- 验收：能够动态切换城市组合并热刷新 worker 订阅；新增事件（如 precipitation-daily）也能纳入 watchlist；系统支持在 settings 里导入/导出 city config JSON；规则变更立即生效。

## 3. 验证与交付节奏
- 每阶段都需要并行子代理协作：观察 metrics、renderer 性能、worker 健康；每个阶段完成后生成小结并附带 `npm run test && npm run lint` 报告。
- 建议顺序：先完成 V1 并打包，确认快捷方式可用；接着 V2 开启性能监控跑 6 小时；最后整理 V3 文档与可扩展接口。

## 4. 任务拆分提示
- 任务 A：主进程/IPC + health 状态+设置页控制项（归 V1）。
- 任务 B：Worker 缓存、tick prune、token 状态索引（V1/V2 过渡）。
- 任务 C：Renderer 表现+hook  debounce（V1/V2）。
- 任务 D：设置页/规则引擎/音频控制（V1/V3）。
- 任务 E：多 worker 拆分/配置热更/导出（V3）。

## 5. 风险缓解
- 定期 sampling health diagnostics：Renderer 侧显示 `diagnostic` 字段并建议用户再试（V1）。
- 限制 worker memory：若 `price_ticks` size ＞ 7 天阈值即 prune、并记录 `feed_health` 事件（V1/V2）。
- 预留 metrics：打开 `feed_health` 表并持续采集 `backendStart`/`backendStop`，便于后续自动化告警（贯穿各阶段）。
