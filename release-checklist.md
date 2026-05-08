# 上线验收清单

## 必需环境变量

- `APIMART_API_KEY`：APIMart 服务端密钥，只能放在服务端环境变量中。
- `APIMART_BASE_URL`：默认 `https://api.apimart.ai/v1`。
- `APIMART_PROXY_URL`：本地开发如需代理可填 `http://127.0.0.1:7890`，线上通常留空。
- `MENGFACTORY_API_KEY`：MengFactory 服务端密钥，只能放在服务端环境变量中。
- `MENGFACTORY_BASE_URL`：默认 `https://api.mengfactory.cn`。
- `SUPABASE_SERVICE_ROLE_KEY`：服务端专用 Supabase service role key，不能暴露到前端。
- `SUPABASE_GENERATED_IMAGES_BUCKET`：生成图片存储桶，默认 `generated-images`。
- `CRON_SECRET`：外部定时器调用 `/api/cron/sync-apimart-tasks` 时使用的 Bearer 密钥。
- `APIMART_SYNC_BATCH_SIZE`：每次同步的 APIMart 任务数量，建议先用 `20`。

## 功能验收

- 生图：选择 Gemini Nano Banana Pro 或 GPT-Image-2，提交任务后能轮询并展示真实图片；选择 Gemini 3.1 Flash Image Preview 后能直接返回 Supabase Storage 图片 URL。
- 视频：选择 VEO3 或 Grok Imagine，提交任务后能轮询并展示真实视频。
- 历史项目：生成结果、任务 ID、预览 URL、失败原因可保存并查看。
- 点数兑换：有效兑换码可增加点数，重复兑换会被拦截，兑换流水可查看。
- 本地持久化：刷新页面后点数、历史项目、兑换记录不丢失。

## 上线前确认

- 替换正式客服微信二维码。
- 确认点数扣减规则和不同模型价格。
- 将本地 `localStorage` 持久化替换为登录账户和数据库。
- 配置生产环境变量，确认 API Key 不进入前端代码和仓库。
- 确认 APIMart 额度、并发限制、失败重试和超时策略。
- Hobby 版 Vercel Cron 不能每分钟运行；需要用外部 cron 服务每分钟调用 `/api/cron/sync-apimart-tasks`，请求头为 `Authorization: Bearer <CRON_SECRET>`。

## 验证命令

- `pnpm lint`
- `pnpm exec tsc --noEmit`
- `pnpm build`

## 当前限制

- 用户账户为本地浏览器账户，换设备或清理浏览器数据会丢失。
- 兑换码仍是前端 mock 数据，正式上线需要后台生成和数据库校验。
- 历史项目保存在浏览器 `localStorage`，尚未接入云端数据库。
