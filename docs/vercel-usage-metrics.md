# Vercel Usage 指标说明

本文解释 Vercel Usage 页面中常见资源指标的含义，并结合本项目给出排查和优化方向。截图中的这些指标主要覆盖 CDN 数据传输、Edge 请求、ISR 缓存和 Fluid Compute / Serverless Function 执行资源。

## 指标速览

| 指标                        | 含义                                              | 主要消耗来源                                          | 对本项目的影响                                     |
| ------------------------- | ----------------------------------------------- | ----------------------------------------------- | ------------------------------------------- |
| Fast Data Transfer        | Vercel 边缘网络向用户传出的加速数据量。                         | 页面 HTML、JS/CSS、图片、视频、接口响应、静态资源下载。               | 生成图片或视频结果如果直接由 Vercel 转发给用户，会增加该用量。         |
| Fast Origin Transfer      | Vercel 从源站或后端取回并通过边缘网络分发的数据量。                   | 未命中缓存的页面、API 响应、动态资源、从外部源拉取后返回给用户的内容。           | API Route 代理上游图片/视频、或动态返回大体积文件时会增长。         |
| Edge Requests             | 到达 Vercel Edge Network 的请求次数。                   | 页面访问、静态资源请求、API 请求、图片优化请求、预检请求。                 | 用户打开页面、轮询任务状态、加载资源都会计入。                     |
| Edge Request CPU Duration | Edge Middleware / Edge Function 在边缘侧消耗的 CPU 时间。 | Middleware 鉴权、重写、跳转、A/B 分流、Edge Runtime 逻辑。     | 如果后续增加中间件鉴权或边缘逻辑，该项会随请求量和计算复杂度上升。           |
| Microfrontends Routing    | Vercel Microfrontends 路由调用次数。                   | 使用 Vercel Microfrontends 功能进行跨应用路由时产生。          | 当前项目未使用该能力，正常应接近 0。                         |
| ISR Reads                 | 读取 ISR 缓存产物的次数。                                 | 访问使用 Incremental Static Regeneration 的页面或数据缓存。  | 如果页面使用 `revalidate` 或静态再生成，访问缓存版本会计入。       |
| ISR Writes                | 写入或重新生成 ISR 缓存产物的次数。                            | 首次生成、过期后再生成、按需 revalidate。                      | 动态内容页面如果设置 ISR，重新生成次数会增加。                   |
| Function Invocations      | Serverless / Fluid Compute 函数被调用的次数。            | Next.js API Route、Server Action、动态渲染页面、cron 接口。 | `/api/generate/image`、任务同步 cron、后续视频接口都会计入。 |
| Function Duration         | 函数执行时长按内存规格折算后的资源用量，常以 GB-Hrs 计。                | 长时间运行的 API、等待上游接口、轮询、同步任务、文件处理。                 | 上游生成任务如果在请求中阻塞等待，会明显增加该项。                   |
| Fluid Provisioned Memory  | Fluid Compute 函数执行期间被分配的内存资源时长。                 | 函数实例运行、并发请求、较高内存配置。                             | 大对象处理、图片/视频中转、长任务会推高内存资源消耗。                 |
| Fluid Active CPU          | Fluid Compute 中函数实际活跃使用 CPU 的时间。                | JSON 处理、鉴权、数据库读写、图片处理、加密签名、任务同步逻辑。              | 复杂服务端计算或高频 cron 会增加该项。                      |

## 逐项解释

### Fast Data Transfer

表示 Vercel 边缘网络向终端用户传出的数据量。它关注的是“发给用户多少数据”，不只是页面本身，也包括 JS、CSS、字体、图片、视频、API JSON、下载文件等。

本项目是 AI 生图和视频生成站点，最需要注意的是生成结果的传输方式。若图片或视频文件通过 Vercel API Route 读取后再返回给浏览器，数据会经过 Vercel，传输量增长会很快。更推荐将生成结果存入对象存储或上游文件地址，并让前端直接加载可控的公开或签名 URL。

截图示例：`602.11 MB / 100 GB`，当前只使用了很小比例。

### Fast Origin Transfer

表示 Vercel 从源站、函数或后端取回内容后再分发的数据量。简单理解，缓存未命中、动态渲染、API Route 返回内容、从外部服务取回再响应给用户，都可能增加这个指标。

如果项目将 APIMart、MengFactory、Supabase Storage 等上游内容先拉到 Vercel 服务端，再由 Vercel 返回给用户，就容易同时增加 Origin Transfer 和 Data Transfer。

截图示例：`299.95 MB / 10 GB`，比 Fast Data Transfer 配额更小，需要更早关注。

### Edge Requests

表示进入 Vercel Edge Network 的请求次数。一次页面访问通常不只产生一次请求，因为浏览器还会请求 JS、CSS、图片、字体、接口和预检请求。

本项目里会增加该指标的常见场景：

- 用户访问首页和静态资源。
- 前端调用 `/api/generate/image`。
- 任务状态轮询或 cron 同步接口访问。
- 图片、视频预览地址如果走 Vercel 域名，也会形成请求。

截图示例：`14K / 1M`，当前请求量较低。

### Edge Request CPU Duration

表示边缘侧代码消耗的 CPU 时间，通常与 Middleware、Edge Runtime、Edge Function 有关。只有请求次数高不一定会让该项很高，真正影响它的是边缘代码做了多少计算。

本项目如果后续添加以下能力，需要关注该项：

- Middleware 登录态校验。
- 按用户、地区或设备做重写和跳转。
- Edge Runtime 中执行复杂鉴权、签名、解析或外部请求。

截图示例：`2s / 1h`，当前几乎没有压力。

### Microfrontends Routing

表示 Vercel Microfrontends 路由能力的使用次数。该能力用于将多个前端应用组合成一个统一站点，并由 Vercel 处理跨应用路由。

当前项目是单体 Next.js 应用，没有使用 Microfrontends，正常情况下该项应为 0。

截图示例：`0 / 50K`。

### ISR Reads

表示读取 ISR 缓存内容的次数。ISR 是 Incremental Static Regeneration，用于让静态页面在部署后按需或按时间重新生成。

如果 Next.js 页面或数据请求使用了 `revalidate`，用户命中已生成的缓存页面时会产生 ISR Reads。

当前项目主要是客户端工作台和 API Route。若后续新增公开作品页、模型介绍页、价格页等可缓存页面，可以考虑 ISR，但要避免对实时用户数据使用 ISR。

截图示例：`213 / 1M`。

### ISR Writes

表示写入或重新生成 ISR 缓存产物的次数。常见来源包括首次访问生成静态页面、缓存过期后的后台再生成、调用按需 revalidate。

如果后续做公开图库、作品详情页、SEO 页面，ISR Writes 会随着页面数量、更新频率和访问模式增加。

截图示例：`0 / 200K`。

### Function Invocations

表示服务端函数被调用的次数。在 Next.js 项目中，常见来源包括：

- `app/api/**/route.ts`。
- 动态渲染页面。
- Server Actions。
- 定时任务接口。

本项目已有 `/api/generate/image` 和 `/api/cron/sync-apimart-tasks`，后续视频生成、兑换码、用户系统、任务查询接口都会继续增加函数调用次数。

截图示例：`9.2K / 1M`。

### Function Duration

表示函数执行时长按内存规格折算后的资源消耗。它不是单纯的调用次数，而是和函数运行多久、分配多少内存有关。

风险较高的写法：

- 在一次请求中长时间等待 AI 生成完成。
- 高频轮询上游任务状态。
- 服务端下载、处理、再上传大文件。
- 在 API Route 中串行执行多个慢请求。

更稳妥的做法：

- 提交任务后尽快返回任务 ID。
- 用 cron 或后台同步更新任务状态。
- 文件尽量走对象存储直传或前端直连受控 URL。
- 对外部 API 设置超时和错误处理。

截图示例：`0 GB-Hrs / 100 GB-Hrs`，表示当前几乎没有函数时长资源消耗。

### Fluid Provisioned Memory

表示 Fluid Compute 函数运行时被分配的内存资源时长。即使 CPU 不一直满载，只要函数实例在运行并占用内存，就会产生这类资源消耗。

本项目应避免在服务端长时间持有大图片、视频 buffer，尤其不要把大文件完整读入内存再返回给用户。图片和视频结果应优先存储在 Supabase Storage、上游 CDN 或其他对象存储中。

截图示例：`2.2 GB-Hrs / 360 GB-Hrs`。

### Fluid Active CPU

表示 Fluid Compute 函数实际活跃使用 CPU 的时间。与 Function Duration 不同，它更关注 CPU 真正在工作多久。

本项目中会增加 CPU 的操作包括：

- 大量 JSON 解析和数据转换。
- 图片元数据处理或压缩。
- 复杂鉴权、加密签名、哈希计算。
- 大批量同步 APIMart 任务状态。

截图示例：`2m 51s / 4h`。

## 当前截图解读

从截图看，当前用量整体很低，没有接近配额上限的项目。需要优先关注的是：

1. `Fast Origin Transfer` 的额度是 `10 GB`，比 `Fast Data Transfer` 的 `100 GB` 小。AI 图片、视频如果经由 Vercel 服务端中转，容易先碰到这个限制。
2. `Function Invocations` 已有 `9.2K`，说明接口或动态函数已有一定调用量。后续任务轮询、cron 同步、用户系统上线后，需要避免无意义高频请求。
3. `Fluid Provisioned Memory` 和 `Fluid Active CPU` 当前很低，但视频生成、文件转存、批量同步任务上线后需要观察变化。

## 本项目优化建议

- 生成任务提交后立即返回任务 ID，不要在 API 请求里等待长时间生成完成。
- 任务状态查询设置合理轮询间隔，例如生成中 3-5 秒一次，失败或完成后停止轮询。
- 图片和视频结果优先存入 Supabase Storage 或上游 CDN，前端直接读取文件 URL。
- 避免通过 Vercel API Route 代理大文件下载或播放。
- 对 `/api/cron/sync-apimart-tasks` 控制 batch size、超时和调用频率。
- 对公开静态页面使用缓存或 ISR；对用户余额、历史项目、兑换记录等强实时数据不要使用 ISR。
- 上线后定期查看 Vercel Usage，重点观察 `Fast Origin Transfer`、`Function Invocations`、`Function Duration` 三项。

## 参考资料

- Vercel Usage 文档：https://vercel.com/docs/pricing/usage
- Vercel Limits 文档：https://vercel.com/docs/limits
- Vercel Fluid Compute 文档：https://vercel.com/docs/functions/fluid-compute
- Next.js ISR 文档：https://nextjs.org/docs/app/building-your-application/data-fetching/incremental-static-regeneration
