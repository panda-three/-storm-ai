# Vercel 错误排查指南

这份文档记录在 Vercel 上排查单次请求问题的标准流程。适用于本项目的 Next.js API Route、Server Action、动态页面和定时任务。

## 先看什么

先在 Vercel Logs 里找到对应请求，再按下面顺序看：

1. `Request ID`
2. `Path`
3. `Status`
4. `Execution Duration / Maximum`
5. `External APIs`
6. `Logs`
7. `Function Invocation`

其中最有用的是：

- `Logs`：代码里的 `console.log` / `console.error`
- `External APIs`：下游服务是否异常
- `Execution Duration`：是否超时
- `Memory` / `Runtime`：是否资源问题

## Logs 在哪里

`Logs` 不在顶部那张请求信息卡里，而是在页面下方的独立区域。

常见路径是：

1. 点中某条请求
2. 看右侧详情
3. 继续往下滚
4. 找到标题为 `Logs` 的区域
5. 展开 `Vercel Function`
6. 查看每一条日志输出

如果你只看到了请求摘要，没有看到日志列表，通常是因为还没滚到 `Logs` 区域，或者这次请求根本没有打印任何日志。

## 本项目里的源码位置

如果请求路径是：

`/api/generate/image`

对应源码通常在：

`app/api/generate/image/route.ts`

这是仓库里的源码文件，不在 Vercel 控制台里。

## 这个接口怎么和日志对应

在 `app/api/generate/image/route.ts` 里，这个接口会打出三类关键日志：

- `input`
- `generation input`
- `output`
- `error`

对应代码里的日志函数是：

```ts
logGenerateImage(label, value)
```

它只在环境变量开启时输出：

```ts
process.env.LOG_GENERATION_DEBUG === "1"
```

所以如果你在 Vercel 里看不到日志，先确认：

1. 这次请求确实走到了这个接口
2. 环境变量 `LOG_GENERATION_DEBUG` 是否开启
3. `console.log` 是否真的被执行

## 这个接口里要重点看什么

`route.ts` 里最关键的是这些阶段：

- `authenticate`
- `parse_input`
- `validate_reference_images`
- `load_pricing`
- `load_membership`
- `prepare_reference_images`
- `create_generation_job_with_billing`
- `submit_mengfactory_generation`
- `submit_apimart_generation`

如果报错了，代码会把失败阶段和上游任务信息拼进错误消息里，便于你在 Vercel Logs 里对照。

## 你发给我时，最少提供什么

最少发这 4 项就够开始排查：

```text
Request ID:
Path:
Logs 截图:
route.ts:
```

如果是生成类请求，最好再补两项：

```text
External APIs 截图:
页面现象:
```

## 截图建议

最实用的是分三张截：

1. 请求顶部信息，包含 `Request ID` 和 `Path`
2. `Function Invocation` 区域，包含 `Execution Duration` 和 `External APIs`
3. `Logs` 区域，包含完整日志行

如果日志很多，就截连续两张，保证报错前后文完整。

## 这个项目的排查顺序

1. 先确认请求是否成功返回
2. 再看 `Logs` 里有没有报错或关键输出
3. 再看 `External APIs` 哪个下游异常
4. 打开对应的 `route.ts` 对照阶段和参数
5. 最后判断是参数问题、外部服务问题、超时问题，还是资源问题

## 标准排查模板

```text
Request ID:
Time:
Path:
Status:
Execution Duration:
External APIs:
Logs:
route.ts:
现象描述:
```

