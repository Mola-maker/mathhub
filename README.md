# Math GeoHub

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

然后启动：

```powershell
npm install
npm run dev
```

访问 [http://localhost:3000](http://localhost:3000)。如果已经修改 `.env.local`，
需要重启开发服务器。

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
