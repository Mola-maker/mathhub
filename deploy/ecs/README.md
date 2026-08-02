# ECS + OSS + CDN 交付说明

该目录是正式生产部署骨架。`.openai/hosting.json` 仅保留预览用途，生产运行时是
Next.js Node standalone + 独立 TikZ compiler API/Worker。

## 生产组件

| 组件 | 暴露方式 | 状态存储 | 扩容信号 |
|---|---|---|---|
| Web | CDN → ALB/SLB/Nginx | 无本地持久状态 | CPU、请求数、p95 |
| Compiler API | 仅 VPC 内网 | Redis job metadata | API CPU/延迟 |
| Compiler Worker | 不开放端口 | Redis lease + OSS artifact | queue depth、oldest job |
| Redis | ApsaraDB private endpoint | active jobs/短期结果 | 连接、内存、延迟 |
| OSS | private bucket/internal endpoint | content-addressed SVG | 容量、4xx/5xx |

小规模首发可在一台 ECS 上运行生产 Compose；公开流量只进入 Nginx/Web。高可用阶段
应至少两台 Web ECS，并把 Worker 池独立扩容。Redis 与 OSS 不应部署在同一台主机。

## 镜像

- 根目录 `Dockerfile`：Next.js standalone Web；
- `services/tikz-compiler/Dockerfile --target api`：不含 TeX 的 compiler API；
- `services/tikz-compiler/Dockerfile --target worker`：固定版本 Tectonic/dvisvgm。

上传 ACR 后，`WEB_IMAGE`、`COMPILER_API_IMAGE` 必须使用不可变 digest。
`COMPILER_WORKER_IMAGE_REF` 必须是完整的 `repo@sha256:...`；生产 Compose 用同一个
变量选择实际 Worker 镜像，并从它解析 attestation/cache namespace 所需 digest，
因此不能分别配置“实际镜像”和“声明 digest”。

## 密钥与上游

- 两个画板的模型发现与生成统一走 `https://api.molamaker.cn`；
- 你自己的 MolaMaker API key 配在运行时 `LLM_RELAY_API_KEY`；
- 不要使用 `NEXT_PUBLIC_` 前缀，否则 key 会进入浏览器 bundle；
- `TIKZ_COMPILER_TOKEN` 是 Web ↔ compiler API 的内部随机密钥；
- Web 限流通过 `RATE_LIMIT_REDIS_URL` 连接同 VPC 的 Tair/Redis，所有 ECS
  副本共享原子计数；生产缺失或失联时 API 明确返回 503，不退回单机内存计数；
- 限流 key 只存储客户端标识的 SHA-256，不把原始 IP 写入 Redis；
- OSS 使用 ECS RAM role 派生的短期 STS；
- `ali-oss` 可通过 `OSS_STS_REFRESH_URL` 调用内网 STS broker 自动刷新；
- 长期 AccessKey、`.env.local` 和生产 secret 不进入 Git/ACR。

仓库根目录 `.env.example` 是本地字段说明。生产值通过 ECS secret、systemd
EnvironmentFile（权限 0600）或同等级 secret manager 注入。

## OSS 与 CDN

1. 创建 private OSS bucket，启用服务端加密与最小权限 bucket policy；
2. ECS 通过 internal endpoint 或 PrivateLink 访问；
3. CDN 配置 private bucket 回源鉴权；
4. `/_next/static/*` 使用一年 immutable；
5. 仅公开文档的 `/tikz/v1/public/<sha256>.svg` 使用一年 immutable；
   `/tikz/v1/private/*` 永远不配置公开 CDN behavior；
6. `/api/*`、HTML/RSC、用户私有产物绕过 CDN 缓存；
7. CDN cache key 不得丢弃 artifact hash，不得把鉴权 header 纳入公开缓存变体；
8. 配置 hotlink protection、HTTPS、压缩和访问日志。

## 首次部署顺序

1. 准备 ApsaraDB Redis、private OSS、CDN、ACR、TLS 与安全组；
2. 构建并推送三个镜像，记录 digest；
3. 准备只在 ECS 上存在的生产环境文件；
4. 按 `compose.production.yaml` 启动 compiler API/Worker 与 Web；
5. Nginx 使用 `nginx/math-geohub.conf`，健康检查 `/healthz`；
6. 先用内部域名验收，再把 CDN origin/正式域名切到 SLB/Nginx；
7. 灰度期间保留上一组 image digest，失败时整体回滚。

## 产品方验证命令

按用户要求，本次实现没有运行 Docker、Vitest、compiler test、lint、build 或压测；
2026-07-28 仅执行了非 Docker 的本地 Edge/Playwright CLI 阶段验证。以下完整门禁由
产品方在目标环境执行：

```powershell
npm test
npm run test:compiler
npm run lint
npm run build
npm run audit:cdn

docker build -t math-geohub-web .
docker build --target api -f services/tikz-compiler/Dockerfile .
docker build --target worker -f services/tikz-compiler/Dockerfile .
```

目标环境验收至少覆盖：

- “画一个九点圆”能从 AI 源码进入交互或精确 SVG；
- 旧 revision 的 exact job 不能覆盖新源码；
- kill Worker 后 job 租约过期并回队；
- 两个 Worker 同时处理同一源码不会互相覆盖；
- queue 满载返回 429；
- private SVG 不产生公开 CDN URL；
- public immutable SVG 命中 CDN；
- Web、API、Worker 日志中没有 API key、compiler token、STS；
- 回滚到上一 digest 后服务和旧 artifact 仍可访问。
