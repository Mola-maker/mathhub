# Math GeoHub

`mathhub/` is the only landing-page frontend. It is a Vite workspace that builds
to `public/mathhub/`; the Next.js service keeps `/` as the canonical public URL
and internally serves that artifact. The real studios remain same-origin at
`/math` and `/tikz`. The retired `Herodeisgn` and `/hero-demo` frontends have been
removed.

## Local startup without Docker

Install the root workspace once:

```powershell
Set-Location E:\Portaitsweb\math_geohub
npm install
Copy-Item .env.example .env.local
```

Start the landing-page source and the Next.js application in two terminals:

```powershell
# Terminal 1
npm run dev:mathhub
```

```powershell
# Terminal 2
npm run dev
```

Open <http://localhost:3000>. Next proxies `/` and `/mathhub/*` to the local Vite
server configured by `MATHHUB_DEV_ORIGIN`. Do not browse port 5173 as the product
address; it is only the internal development origin.

Production `npm run build` builds MathHub first and then Next.js. The generated
`public/mathhub/` directory is copied into the standalone ECS image and can be
served by the CDN. Only its fingerprinted `/mathhub/assets/*` files are
immutable; the entry HTML must be revalidated.

## API key

Configure the server-side key in `.env.local`:

```dotenv
LLM_RELAY_API_KEY=your_api_key
LLM_RELAY_MODEL=
LLM_RELAY_VISION_MODEL=
```

All upstream model requests are locked to `https://api.molamaker.cn`. Never use a
`NEXT_PUBLIC_` key; the browser may only select models returned by the server.

---

Math GeoHub 提供两个浏览器画板：

- Math Studio：通过 `api.molamaker.cn` 获取实时模型目录并生成 GeoGebra 构造；
- TikZ Studio：AI 生成 TikZ 源码，源码作为唯一真源，并提供低延迟交互 SVG、
  画板创作、属性写回与独立精确 TeX 预览。

正式生产目标是 ECS + OSS + CDN；不是私有化部署，也不依赖 Sites/边缘运行时。

## 本地启动（不使用 Docker）

要求 Node.js 22+、npm 10+。

```powershell
Set-Location E:\Portaitsweb\math_geohub
Copy-Item .env.example .env.local
```

在 `.env.local` 配置自己的 MolaMaker API key：

```dotenv
LLM_RELAY_API_KEY=你的_API_KEY
LLM_RELAY_MODEL=
```

上游地址在服务端硬锁为 `https://api.molamaker.cn`。密钥只能使用
`LLM_RELAY_API_KEY`，不要加 `NEXT_PUBLIC_`。浏览器不会拿到 key；
两个画板都由服务端读取 `api.molamaker.cn/v1/models`，客户端只能从返回的实时目录
选择模型。

首次安装依赖：

```powershell
npm install
```

然后在两个终端启动，浏览器只访问 Next 的 3000 端口：

```powershell
# 终端 1
npm run dev:mathhub
```

```powershell
# 终端 2
npm run dev
```

访问 [http://localhost:3000](http://localhost:3000)。5173 仅是 Next 内部代理到
MathHub 的开发源，不作为产品地址。如果已经修改 `.env.local`，需要重启开发服务器。

## TikZ 的两条渲染路径

- 交互路径：本地语义投影 → SVG。用于选择、拖拽、创建点/线/圆/多边形/角、
  中点/垂足和属性编辑；每次操作只写回最小 TikZ 源码范围。
- 精确路径：Next.js → 内网 compiler API → Redis → 隔离 Worker
  （Tectonic/dvisvgm）→ OSS/CDN。

本地只启动 Next.js 时，交互画板可以完整使用；只有点击“精确预览”才需要独立
compiler service。没有 compiler service 时精确预览返回 503 是预期的环境缺失，
不会再阻塞交互画板。

## 常用命令

```powershell
npm run dev
npm test
npm run test:compiler
npm run lint
npm run build
```

按当前协作约定，完整测试、Docker/compiler 容器和 ECS 验收由产品方执行。部署拓扑、
密钥、Redis、OSS 与 CDN 配置见
[deploy/ecs/README.md](deploy/ecs/README.md)；架构真源见
[TikZ Studio v3 规格](docs/superpowers/specs/2026-07-27-tikz-studio-v3-architecture-design.md)。
