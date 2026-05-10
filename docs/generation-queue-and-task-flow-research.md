# 生成任务队列与体验优化研究

## 背景

当前项目的生成体验问题主要不是路由慢，而是提交按钮会等待 `/api/generate/image` 或 `/api/generate/video` 返回后才进入结果页。尤其是 MengFactory 同步生图分支，会在 API 请求内等待图片生成、上传 Supabase Storage、更新任务后才返回，用户会感觉点击后长时间没有进入结果状态。

吉梦的生成流程更像“任务资产流”：点击生成后任务立即进入“今天”列表，先展示任务元信息和生成中状态，再用固定尺寸占位图承接等待，最终结果原地替换占位内容。它不一定展示真实生成过程，但它把等待转换成了可感知的任务流。

## 专业队列方案：pg-boss / Graphile Worker + 独立 Worker

### 架构

- `Next.js App`：负责登录、参数校验、扣点、创建 `generation_jobs`、上传参考图、入队并立刻返回 `taskId`。
- `Postgres Queue`：使用 Supabase Postgres 承载队列表，由 `pg-boss` 或 `Graphile Worker` 管理任务锁、重试、并发和失败记录。
- `Worker Service`：独立 Node 进程，部署在 Railway、Render、Fly.io、VPS 或 Docker 容器中，持续消费队列并调用 MengFactory/APIMart。

用户点击生成后的理想链路：

```text
校验参数 -> 扣点 -> 保存 generation_jobs -> 入队 -> 立即返回 taskId
```

Worker 后台执行：

```text
取队列任务 -> 标记 processing -> 调上游生成 -> 上传结果 -> 更新 generation_jobs -> 清理临时文件
```

### pg-boss 与 Graphile Worker 对比

`pg-boss` 更偏 Node 应用队列，基于 PostgreSQL `SKIP LOCKED`，支持重试、cron、优先级、死信队列、限流等。优点是 Node API 直观，适合直接在 worker 里消费任务。

`Graphile Worker` 更偏 Postgres-first，支持从 JavaScript 或 SQL 入队，支持 `LISTEN/NOTIFY`、重试、定时任务、`jobKey` 去重和队列串行执行。它更适合当前项目这种 Supabase/Postgres 已经是核心状态源的架构。

当前项目如果要上专业队列，优先建议评估 `Graphile Worker`，备选 `pg-boss`。

### 需要改造的内容

- 数据库：给 `generation_jobs` 增加 `input jsonb`、`worker_job_id text`、`started_at timestamptz`，可选增加 `stage text`。
- Storage：新增私有参考图 bucket 或路径，保存用户上传的参考图，供 worker 后台读取。
- API：`/api/generate/image` 和 `/api/generate/video` 改为创建任务并入队后快速返回。
- Worker：新增 `worker` 入口脚本，处理 `generate-image`、`generate-video`、`sync-upstream-task` 等任务。
- 部署：Next.js 继续部署在 Vercel，Worker 单独部署为长期运行服务，并配置同一套服务端环境变量。

### 关键风险

- 开源队列库不能单独解决问题，必须有长期运行的 worker 服务。
- 即使用专业队列，也无法从本地系统 100% 保证外部生成接口 exactly once。
- 如果 worker 已经调用 MengFactory 成功，但写库前进程崩溃，队列重试可能导致重复调用上游，除非上游支持幂等 key。
- 同步生图模型建议设置 `maxAttempts: 1`，失败后退款，不自动重试，避免重复成本。
- Worker 需要正确使用 Supabase/Postgres 连接。长期服务优先使用 direct connection；如果部署环境不支持 IPv6，再评估 session pooler。

### 难度评估

- 最小可用版：2-4 天。完成队列接入、worker 部署、图片任务异步化、结果轮询。
- 稳定上线版：5-8 天。补齐失败退款、参考图清理、任务去重、并发限制、worker 日志和失败任务查看。
- 产品级版本：1-2 周。增加任务流 UI、失败重试按钮、队列监控、死信处理、告警、成本保护和统计。

## 当前阶段暂不采用队列的推荐方案

当前项目暂不引入专业队列，优先做“轻量任务流 + 现有 cron/轮询”的体验优化。目标不是实时展示真实生成过程，而是让用户点击后立即看到任务已进入创作流。

### 产品体验

- 点击生成后，当前工作台立即新增一条“生成中任务卡”。
- 任务卡显示提示词、模型、比例、清晰度、张数、创建时间。
- 图片任务按最终张数和比例展示固定尺寸骨架占位。
- 视频任务按最终比例展示固定尺寸视频占位。
- 状态文案采用可信阶段：`已提交`、`排队中`、`智能创意中`、`保存结果中`、`已完成`、`失败`。
- 结果生成后原地替换占位图，不让布局跳动。
- `/results/:taskId` 保留为详情页，但不再承担唯一等待反馈。
- 历史项目页和当前任务流尽量复用同一套任务卡组件。

### 技术方案

- APIMart/Grok/VEO 这类本身能返回上游 task id 的模型，继续使用现有 `generation_jobs` + `/api/tasks/:id` 轮询。
- 现有 `/api/cron/sync-apimart-tasks` 继续负责 APIMart 任务同步，可后续扩展为更通用的 `/api/cron/sync-generation-jobs`。
- 当前定时任务来源采用 `cron-job.org`，不是 Vercel Cron。
- 在 cron-job.org 中每分钟调用一次适合作为当前折中方案：平均排队约 30 秒，最坏约 60 秒。更低频会让用户明显感到卡在排队。
- MengFactory 同步生图暂时保留现状或做保守异步化。若不引入 worker，不能可靠地在请求返回后继续执行长任务。
- 对 MengFactory 同步生图，如果要避免按钮长时间 loading，建议先把默认模型切到异步上游，或接受它在当前阶段仍是体验短板。

### 为什么先这么做

- 改动范围小，不需要新增部署单元。
- 能快速学习吉梦的关键体验：任务立即出现、占位稳定、结果原地替换。
- 不会引入 worker 运维、队列表迁移、连接池、死信和监控等复杂度。
- 为未来专业队列预留结构：任务卡、`generation_jobs` 状态、结果页轮询都能复用。

## 后续研究问题

- 是否愿意新增长期运行的 worker 部署平台。
- 选择 `Graphile Worker` 还是 `pg-boss`。
- Supabase Postgres 连接方式和连接数预算。
- MengFactory 是否提供异步生图接口或幂等请求能力。
- 是否需要任务失败人工处理后台。
- 是否需要队列监控、告警和成本保护。
