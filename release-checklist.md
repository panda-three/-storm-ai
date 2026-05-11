# 上线验收清单

## 必需环境变量

- `APIMART_API_KEY`：APIMart 服务端密钥，只能放在服务端环境变量中。
- `APIMART_BASE_URL`：默认 `https://api.apimart.ai/v1`。
- `APIMART_PROXY_URL`：本地开发如需代理可填 `http://127.0.0.1:7890`，线上通常留空。
- `MENGFACTORY_API_KEY`：MengFactory 服务端密钥，只能放在服务端环境变量中。
- `MENGFACTORY_BASE_URL`：默认 `https://api.mengfactory.cn`。
- `SUPABASE_SERVICE_ROLE_KEY`：服务端专用 Supabase service role key，不能暴露到前端。
- `SUPABASE_GENERATED_IMAGES_BUCKET`：生成图片存储桶，默认 `generated-images`。
- `CRON_SECRET`：外部定时器调用 `/api/cron/sync-generation-jobs` 时使用的 Bearer 密钥。
- `APIMART_SYNC_BATCH_SIZE`：每次同步的 APIMart 任务数量，建议先用 `20`。

## 数据库发布顺序

本次生成任务修复依赖数据库字段和 RPC 签名变更，必须先执行 Supabase SQL，再部署应用代码。

- 先在 Supabase SQL Editor 执行 `supabase-schema.sql`，确认以下对象已存在：
  - `generation_jobs.client_request_id`、`expires_at`、`storage_urls`。
  - `generation_jobs_user_client_request_id_unique_idx`，用于同一用户同一次前端请求去重。
  - `generation_jobs_expires_at_idx`，用于清理 24 小时后过期的生成历史。
  - `create_generation_job_with_billing(..., p_client_request_id text default null)` 新签名。
  - `fail_generation_job_with_refund(uuid, text)`，用于超时或失败时退款。
- SQL 执行成功后再部署 Next.js 代码；否则新代码调用 RPC 时会因为参数不匹配失败。
- 如果线上数据库已有历史 `generation_jobs` 数据，SQL 会给已终态任务补 `expires_at = completed_at/created_at + 24 hours`。

## 定时任务配置

- 推荐每分钟调用一次 `GET /api/cron/sync-generation-jobs`。
- 请求头必须包含 `Authorization: Bearer <CRON_SECRET>`。
- 老地址 `/api/cron/sync-apimart-tasks` 仍保留兼容，但新部署建议改到 `/api/cron/sync-generation-jobs`。
- 定时任务会做三件事：
  - 同步 APIMart / MengFactory 未终态任务。
  - 对超过服务端超时阈值仍无终态的任务标记失败并退款。
  - 清理终态 24 小时后的生成历史和已上传文件。
- Vercel Hobby Cron 不能每分钟运行；生产环境建议使用外部 cron 服务。

## 生成任务策略

- 前端每次提交都会生成 `clientRequestId`，服务端保存到 `generation_jobs.client_request_id`。
- 同一用户同一个 `clientRequestId` 在数据库层唯一，避免刷新、重试、同步历史时产生重复业务记录。
- 历史合并时优先用 `clientRequestId`、服务端 `taskId`、上游任务 ID 去重。
- 对旧版本浏览器缓存里没有 `clientRequestId` 的 `pending-*` 记录，会用 `type + model + prompt/title` 和服务端历史做一次兼容清理。
- 作品在服务器只保留 24 小时，界面会提示用户及时下载。

## 功能验收

- 生图：选择 Gemini Nano Banana Pro 或 GPT-Image-2，提交任务后能轮询并展示真实图片；选择 Gemini 3.1 Flash Image Preview 后能直接返回 Supabase Storage 图片 URL。
- 视频：选择 VEO3 或 Grok Imagine，提交任务后能轮询并展示真实视频。
- 历史项目：生成结果、任务 ID、上游任务 ID、预览 URL、失败原因可保存并查看；刷新后不应同时出现同一任务的“已完成”和“生成中”重复记录。
- 点数兑换：有效兑换码可增加点数，重复兑换会被拦截，兑换流水可查看。
- 本地持久化和 Supabase 同步：刷新页面后点数、历史项目、兑换记录不丢失；服务端生成历史能覆盖本地旧 pending 记录。

## 上线前确认

- 替换正式客服微信二维码。
- 确认点数扣减规则和不同模型价格。
- 配置生产环境变量，确认 API Key 不进入前端代码和仓库。
- 确认 APIMart 额度、并发限制、失败重试和超时策略。
- 确认 MengFactory 额度、并发限制、失败重试和超时策略。
- 配置外部 cron 每分钟调用 `/api/cron/sync-generation-jobs`，请求头为 `Authorization: Bearer <CRON_SECRET>`。
- 部署后手动调用一次 `/api/cron/sync-generation-jobs`，用于立刻同步未终态任务、处理超时退款和清理过期历史。
- 使用一个新账号和一个已有历史缓存的浏览器分别验收，确认历史列表不会出现同一生成任务的重复 pending 项。

## 验证命令

- `pnpm lint`
- `pnpm exec tsc --noEmit`
- `pnpm build`

## 当前限制

- 兑换码仍是前端 mock 数据，正式上线需要后台生成和数据库校验。
- 浏览器本地仍会保存部分账户状态和删除墓碑；服务端生成历史是权威来源，非删除态的服务端任务不会被本地旧状态覆盖。
- 旧版本已经写入浏览器缓存的 `pending-*` 记录只能在用户再次打开并完成历史同步后被前端清理。
