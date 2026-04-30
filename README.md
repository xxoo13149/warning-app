# 天气监控桌面应用

面向 Polymarket 天气市场的本地桌面监控工具，基于 `Electron + React + TypeScript` 构建。

项目当前聚焦四件事：

- 实时订阅和监控天气市场
- 将盘口异动转成可执行的告警和运营视图
- 以本地 SQLite 持久化运行数据、规则和告警
- 提供可长期驻留的 Windows 桌面应用，而不是网页原型

本项目不包含自动下单、钱包连接或自动交易能力。

## 当前进度

截至 `2026-05-01`，当前主线能力已经覆盖：

- Polymarket 天气市场发现、分片订阅和行情状态维护
- 实时告警引擎
  - `feed_stale`
  - `liquidity_kill`
  - `volume_pricing`
  - `spread_threshold`
  - `price_change_5m`
- Dashboard 风险总览
- Market Explorer 市场总览、搜索、日期过滤、排序和运营视图
- Alert Center 告警中心、分页、历史查看和确认
- Rules Settings 规则管理、内置规则和自定义规则编辑
- SQLite 持久化、归档、维护和运行诊断
- Windows 桌面打包、快捷方式更新和单机部署

## 最近更新

这轮更新的重点是把“异常彩票”从泛化的带量定价中拆出来，做成独立监控和独立运营视图。

### 已实现

- 新增“异常彩票”监控字段和查询契约
- 新增 `lotteryOnly` 过滤与 `lotteryLift` 排序
- 新增超低价异常定义
  - 参考卖一价格不高于 `4c`
  - 观察窗口 `60s`
  - 当前卖一不高于 `18c`
  - 低价越低越敏感
    - `1c-2c` 推高 `3c` 触发
    - `3c-4c` 推高 `4c` 触发
  - 至少有一种确认来源
    - `edge_volume`
    - `trade_confirmed`
    - `book_depth`
- Market Explorer 新增三种预设模式
  - `全部盘口`
  - `异常彩票`
  - `关注队列`
- Market Explorer 新增异常徽标、价格路径、确认来源和检视面板
- 新增项目研究文档：
  - [docs/research/20260429154818159_abnormal-lottery-monitoring.md](docs/research/20260429154818159_abnormal-lottery-monitoring.md)

### 同期增强

- 默认排序从 `volume24h` 调整为更实用的 `updatedAt`
- Dashboard 和运行时索引改成更多依赖内存缓存，减少重复扫描
- 增加运行时内存遥测相关代码和测试骨架

## 主要页面

### 1. Dashboard

用于快速感知：

- 哪些城市当前更热
- 哪些市场风险更高
- 哪些告警未处理

### 2. Market Explorer

这是当前最重要的运营工作台，用于：

- 搜索城市、机场、日期
- 查看市场排序和分组
- 进入异常彩票模式做超低价异动筛查
- 查看单个盘口的价格、确认路径、有效数量和更新时间

### 3. Alert Center

用于：

- 查看实时告警流
- 按规则或市场回看历史
- 确认和处理告警

### 4. Rules Settings

用于：

- 管理内置和自定义规则
- 调整阈值、窗口、冷却时间和权重
- 查看运行诊断和配置

## 技术架构

- `Electron`
  - 主进程、窗口、托盘、通知、打包
- `React + TypeScript + Vite`
  - 前端页面、状态呈现和交互
- `worker_threads`
  - 市场发现、WebSocket 订阅、规则计算、后台运行
- `better-sqlite3 + Drizzle`
  - 本地数据库、迁移、查询和维护

## 仓库结构

- `src/`
  - 应用源代码
- `tests/`
  - 单元测试与行为测试
- `docs/`
  - 研究、说明、方案和过程文档
- `scripts/`
  - 打包、验证、运行时准备和快捷方式脚本

## 快速开始

### 环境要求

- Node.js 18+
- Windows
- 可用的 Electron 原生模块运行环境
- 如果本机访问 Polymarket 需要代理，请先配置系统代理或相关环境变量

### 安装依赖

```bash
npm install
```

### 开发启动

```bash
npm run start
```

### 常用命令

```bash
npm run lint
npm run typecheck
npm run test
npm run package
npm run make
```

## 打包说明

- `npm run package`
  - 生成可直接运行的桌面包
- `npm run make`
  - 生成安装包和发布产物
- `npm run shortcuts:update`
  - 更新 Windows 桌面和开始菜单快捷方式

当前桌面应用默认会打包到上一级目录下的 `warning-app-artifacts`。

## 数据与隐私

- 项目使用本地 SQLite，不依赖独立云端数据库
- 运行时日志、数据库、缓存和会话文件不应提交到仓库
- 仓库只保留源码、测试、脚本和文档，不包含个人运行数据

## 当前已验证内容

最近一轮与“异常彩票”相关的关键验证已经通过：

- `npm run typecheck`
- `npm test -- tests/core/worker-runtime.market-query.test.ts tests/renderer/MarketExplorerView.test.tsx`
- `npm test -- tests/renderer/useMonitorConsole.test.tsx`

## 下一步重点

- 继续用真实运行数据校准“异常彩票”阈值，降低误报和漏报
- 完成内存遥测与更长时间运行稳定性观察
- 继续统一规则配置、运行诊断和历史回放能力
- 逐步补足产品化文档和发布流程

## 许可证

`MIT`
