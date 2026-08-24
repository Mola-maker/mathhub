# TikZ compiler service

这是 TikZ Studio 精确预览使用的独立编译服务。Next.js Web 容器不携带 TeX
运行时，只通过内网调用 compiler API：

1. API 校验源码，将 content-addressed job 写入 Redis；
2. Worker 通过可靠队列领取任务，执行 Tectonic + dvisvgm；
3. SVG 写入本地开发卷或 OSS；
4. API 返回任务状态，并为私有产物提供鉴权回源。

队列采用 `waiting list -> processing list -> running lease` 模型。Worker 崩溃后，
过期任务会自动回队；每次领取都会增加 `attempt`，旧 Worker 不能覆盖新尝试的结果。

## 两个不可混用的精确编译 profile

源码在 Web 边界按实际语法能力选择编译器，而不是让一个运行时“试试看”：

- `tikz-standard-v1`：Tectonic `--untrusted --only-cached`，覆盖普通 TikZ、
  `graphs` 与 `graphs.standard`；
- `tikz-luatex-graphdrawing-v1`：不可变 TeX Live/LuaLaTeX 包树，覆盖
  `graphdrawing`、`\usegdlibrary` 与 Lua 布局算法。

普通 `\graph` 不会误触发 LuaTeX；只有 graphdrawing 库、算法库或布局键会分流。
两个 profile 分别绑定 wrapper digest、manifest digest、Worker image digest、Redis
namespace 和 artifact attestation。未配置 companion 服务时返回
`GRAPHDRAWING_COMPILER_NOT_CONFIGURED`，不会把源码降级到 Tectonic 或伪称精确成功。
用户源码中的 `\directlua` 等任意 Lua 入口始终由 source policy 拒绝；只有固定镜像内
PGF graph drawing 包自身的 Lua 代码能够执行。

## 本地启动

### 推荐：一条命令启动 Studio 与精准编译服务

本机安装了 dvisvgm，并具备至少一个受支持 TeX 引擎时，直接运行：

```powershell
npm run dev:tikz
```

该入口会启动 Next.js 和 development-only compiler，并为两者注入一致的
`TIKZ_COMPILER_URL/TOKEN`。如果 8787 已有 compiler，它会复用现有服务。
compiler 会在监听前检查引擎与 dvisvgm。标准 profile 默认依次选择
Tectonic、XeLaTeX、pdfLaTeX；graphdrawing profile 只接受 LuaLaTeX。实际选中的
引擎会写入 `/healthz`、renderer 与本地产物 identity，绝不会把回退结果伪装成
Tectonic。工具缺失时交互画板仍可使用，
`/healthz` 与精准预览会明确返回缺失的运行时，而不会把环境问题报告成 TikZ
语法错误。Windows/MiKTeX 的维护日志会写入系统临时目录，避免默认 AppData 日志
不可写时把一个可用引擎误判成崩溃；缺包安装器会被禁用，编译超时会终止完整
进程树并保留受限长度的诊断日志。MiKTeX 的 LuaLaTeX 首次运行可能阻塞在 format
生成/发行版维护阶段，因此 graphdrawing 本地服务默认把它报告为未验证，而不是
伪装成 ready。生产 graphdrawing 始终使用镜像中预热的 TeX Live；已经自行完成
MiKTeX format 与 graphdrawing 验证的开发机可显式设置
`TIKZ_ALLOW_MIKTEX_GRAPHDRAWING=1`。生产 `tikz-standard-v1` 仍固定使用隔离的
Tectonic `--untrusted --only-cached` + dvisvgm profile；本地 XeLaTeX/pdfLaTeX
回退只用于开发预览，并以独立 renderer/identity 呈现。

可用以下变量覆盖自动选择：

```dotenv
TIKZ_LOCAL_TEX_ENGINE=auto
TECTONIC_PATH=C:\path\to\tectonic.exe
XELATEX_PATH=xelatex
PDFLATEX_PATH=pdflatex
LUALATEX_PATH=lualatex
DVISVGM_PATH=dvisvgm
```

### 方式一：由产品方验证容器环境

```powershell
$env:TIKZ_COMPILER_TOKEN = 'local-tikz-compiler-token'
docker compose -f services/tikz-compiler/compose.yaml up --build -d
```

在项目的 `.env.local` 中加入：

```dotenv
TIKZ_COMPILER_URL=http://127.0.0.1:8787
TIKZ_COMPILER_TOKEN=local-tikz-compiler-token
```

然后正常运行 `npm run dev`。健康检查：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/healthz
```

### 方式二：不用容器、分别启动服务

生产式队列调试需确保 Redis、Tectonic 和 dvisvgm 已安装，再分别启动 Worker 与 API。

Worker 终端：

```powershell
$env:REDIS_URL = 'redis://127.0.0.1:6379'
$env:ARTIFACT_DRIVER = 'local'
$env:ARTIFACT_LOCAL_DIR = 'E:\temp\math-geohub-tikz-artifacts'
$env:TECTONIC_PATH = 'C:\path\to\tectonic.exe'
$env:DVISVGM_PATH = 'dvisvgm'
$env:JOB_LEASE_MS = '90000'
node services/tikz-compiler/worker.mjs
```

API 终端：

```powershell
$env:REDIS_URL = 'redis://127.0.0.1:6379'
$env:ARTIFACT_DRIVER = 'local'
$env:ARTIFACT_LOCAL_DIR = 'E:\temp\math-geohub-tikz-artifacts'
$env:COMPILER_TOKEN = 'local-tikz-compiler-token'
$env:COMPILER_WORKER_IMAGE_REF = 'dev-tectonic-0.17.0-dvisvgm'
$env:PORT = '8787'
node services/tikz-compiler/server.mjs
```

仅调试本机同步 compiler API、无需 Redis 时，也可以单独运行：

```powershell
npm run dev:compiler:native
```

## ECS 运行约束

- `compiler-api` 与 `compiler-worker` 使用不同任务定义。API 镜像不包含 TeX，
  Worker 不监听公网端口。
- Lua graph drawing 使用第二组 `api-graphdrawing` / `worker-graphdrawing` 任务定义，
  Web 只通过 `TIKZ_GRAPHDRAWING_COMPILER_URL/TOKEN` 访问；不得与标准队列共享
  Worker image reference 或 Redis prefix。
- Web 任务只通过 VPC 内网访问 compiler API 8080，不允许公网直接调用。
- Web 的 `TIKZ_COMPILER_TOKEN` 与 API 的 `COMPILER_TOKEN` 是同一个随机密钥，
  通过 ECS Secrets 注入。
- API 与 Worker 使用同一个 ApsaraDB for Redis、OSS bucket 和 Redis prefix。
- 生产环境只配置一个 `COMPILER_WORKER_IMAGE_REF=repo@sha256:...`。Compose 同时
  用它选择实际 Worker 镜像，API/Worker 从同一引用解析 digest 并生成队列 namespace
  和 job hash；镜像选择与证明声明无法分叉。
- Worker 使用只读根文件系统、`/tmp` 临时卷、无新增 capability；安全组仅允许
  Redis、OSS 内网 endpoint 和必要的日志出口。
- Redis 保存 active job、有限队列、租约和短期失败缓存；OSS key 是内容寻址的。
- 公共产物可以经 CDN 永久缓存；私有产物只能从鉴权 API 回源。

## 产物证明与 CDN 完整性

成功任务返回 `tikz-artifact-attestation/v1`。证明链包含：

- 经过服务端校验和规范化后的 TikZ `sourceDigest`；
- Worker 镜像、profile、visibility 与源摘要形成的 `cacheKeyDigest`；
- 实际写入 OSS/本地存储的 SVG 字节摘要 `artifactDigest`；
- renderer、SVG 字节数、完成时间与编译器镜像摘要。

OSS key 使用 `tikz/v1/public/<artifactDigest>.svg` 或
`tikz/v1/private/<artifactDigest>.svg`。只有 public namespace 可产生 CDN URL
并使用 `immutable` 缓存；private namespace 仅通过鉴权 API、`no-store` 返回。
Compiler API 回源时会先重新计算对象摘要；Web 服务取回
SVG 后还会再次核对响应头、内容 SHA-256 与字节数，验证通过后才交给浏览器。
`jobId` 仍按 cache key 寻址，不能替代 artifact 内容摘要。

生产 OSS 环境变量：

```dotenv
ARTIFACT_DRIVER=oss
OSS_REGION=oss-cn-hangzhou
OSS_BUCKET=your-private-bucket
OSS_ACCESS_KEY_ID=short-lived-sts-access-key
OSS_ACCESS_KEY_SECRET=short-lived-sts-secret
OSS_STS_TOKEN=short-lived-sts-token
OSS_STS_REFRESH_URL=http://internal-sts-broker/v1/oss-credentials
OSS_STS_REFRESH_TOKEN=internal-broker-bearer
OSS_INTERNAL=true
OSS_CDN_BASE_URL=https://static.example.com
OSS_ALLOW_PUBLIC_ACL=false
```

建议使用 ECS RAM role 派生的短期 STS，并通过内网 STS broker 自动刷新。默认
`OSS_ALLOW_PUBLIC_ACL=false`，即使公开产物也保持 OSS 对象为 private，由 CDN
的私有源站鉴权读取。任何凭据都不得写入镜像或仓库。

## 产品方验证清单

以下命令由产品方在目标环境执行；本次实现未代替产品验收：

```powershell
npm run test:compiler
npm test
npm run lint
npm run build

docker compose -f services/tikz-compiler/compose.yaml build
docker compose -f services/tikz-compiler/compose.yaml up -d

docker build --target api-graphdrawing -f services/tikz-compiler/Dockerfile .
docker build --target worker-graphdrawing -f services/tikz-compiler/Dockerfile .

& .\tools\benchmark-tikz-compiler.ps1 `
  -TectonicPath 'C:\path\to\tectonic.exe' `
  -OnlyCached
```

`worker-graphdrawing` 在镜像构建期用 `spring layout` 执行 LuaLaTeX → DVI →
dvisvgm warmup。只有该门禁与 compiler-isolation 测试通过后才配置 Web 的 companion
URL。

容器启动后，在 `/tikz` 输入“画一个九点圆”。确认：

- 交互解析不能完整覆盖时，会切换到 `tectonic-dvisvgm` 精确 SVG；
- 连续编辑不会回闪到旧 revision；
- 杀掉正在编译的 Worker 后，租约过期的 job 会重新进入队列；
- 同一源码、profile、visibility 与 Worker 镜像 digest 命中同一 job；
- CDN 仅对 `/tikz/v1/public/<sha256>.svg` 使用 immutable 缓存；
  `/tikz/v1/private/*` 和 API 状态响应都不缓存。

## Artifact retention

- Redis succeeded-job records are short-lived coordination data, not the
  artifact retention authority.
- Public content-addressed objects are retained while referenced by a published
  document or release manifest. Removal is a separate mark-and-sweep job with
  a minimum 30-day grace window.
- Private objects use a configurable lifecycle policy and are never promoted by
  changing metadata in place; publication creates the corresponding immutable
  object under the public namespace.
- Stale Worker writes and unreferenced objects are collected only after the
  reference index and access logs agree they are outside the grace window.
