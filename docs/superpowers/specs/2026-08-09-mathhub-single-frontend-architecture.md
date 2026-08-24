# MathHub 单一前端入口架构

日期：2026-08-09
状态：已落地的架构约束

## 决策

`mathhub/` 是产品唯一的首页前端源码，公开入口固定为同一站点根路径 `/`。
Next.js 继续承载 `/math`、`/tikz`、API 与服务端能力，但不再维护第二套 Hero 首页。
历史 `Herodeisgn/`、`components/hero/`、`app/hero-demo/` 与旧 `app/page.tsx`
全部退出运行时和源码拓扑。

该决策采用“单一公开源站、双构建产物”，不是微前端运行时拼装：

```text
mathhub/ (Vite source)
        |
        | vite build, base=/mathhub/
        v
public/mathhub/ (generated static files)
        |
        | next build
        v
Next.js standalone + public/
        |
        v
ECS / Nginx / CDN -- /, /math, /tikz, /api
```

## 路由合同

| 浏览器路径 | 所有者 | 用途 |
|---|---|---|
| `/` | MathHub，经 Next 内部 rewrite | 唯一产品首页 |
| `/mathhub/*` | MathHub 静态产物 | JS、CSS、字体、音频与首页 shell |
| `/math` | Next.js | Math Studio |
| `/tikz` | Next.js | TikZ Studio |
| `/api/*` | Next.js / ECS 服务 | 动态 API，不进入公开 CDN 缓存 |

MathHub 内所有工作区链接只能写同源相对路径 `/math`、`/tikz`。生产代码不得写死
`localhost`、独立 Vite 域名或第二个公开回调域名。

## 本地开发

本地开发使用两个进程，但浏览器仍只访问 Next.js：

```powershell
npm run dev:mathhub
npm run dev
```

开发环境默认使用 `MATHHUB_DEV_ORIGIN=http://127.0.0.1:5173`；该变量可覆盖端口。
它只允许 Next 在开发环境中把
`/` 和 `/mathhub/*` 代理到 Vite。它是服务端开发代理地址，不是产品公开地址，也不在
生产环境启用。

## 生产构建与发布

根 `npm run build` 顺序固定为：

1. workspace `mathhub` 执行 Vite 构建；
2. 产物写入生成目录 `public/mathhub/`；
3. Next.js 构建 standalone 服务；
4. ECS Web 镜像复制 `.next/standalone`、`.next/static` 与完整 `public/`。

`public/mathhub/` 不提交 Git，也不接受人工修改。源码、字体、音频与场景定义都留在
`mathhub/`；每次部署从源码重新生成。

## CDN 缓存合同

- `/_next/static/*`：一年 immutable；
- `/mathhub/assets/*`：Vite 内容指纹文件，一年 immutable；
- `/mathhub/fonts/*`、`/mathhub/audio/*`：稳定文件名，一天短缓存；
- `/`、`/mathhub/index.html`：必须重新验证，绝不 immutable；
- `/api/*`、HTML/RSC、用户私有产物：不做公开缓存。

HTML shell 只能短暂或重新验证，因为它决定当前指纹资源图。先缓存 shell 一年会在发布后
把用户锁在旧资源集合中。

## 信息架构边界

首页级数据（近期项目、语义热力图、能力覆盖、全局健康与跨画板入口）逐步迁移到
MathHub。TikZ Studio 只保留当前文档的画板、源码、AI 命令、对象检查器与精确预览。
首页读取 revision-bound 的只读语义快照，不维护或写入第二份 TikZ 源码。

旧 `components/home/` 与 `app/home-dashboard.css` 已从源码树删除；不得重新接到 `/`
或创建替代首页。热力图等全局能力只能按 MathHub 场景和 token 系统重建，并且只读取
Studio 发布的 revision-bound 只读语义快照。

## 架构验收条件

- 仓库不存在可路由的 Hero 替代首页；
- `/` 的地址栏不跳转到第二域名或 `/mathhub/index.html`；
- MathHub 的 `/math`、`/tikz` 入口在同标签页、同源导航；
- 根构建能够生成 `public/mathhub/`，standalone 镜像包含该目录；
- CDN 只长期缓存有内容指纹的 MathHub 资源，不长期缓存入口 HTML；
- 清理 `public/mathhub/` 后可完全从 `mathhub/` 源码重建；
- 后续首页功能只在 `mathhub/` 演进，不恢复 `Herodeisgn` 或 `app/page.tsx`。

## 验证边界

本轮遵循产品方测试边界，不执行 build、lint、typecheck、测试、TeX 或 Docker。
产品方验证时应至少检查根入口、两个 Studio 返回首页、刷新深链、静态资源缓存头和 ECS
standalone 镜像内的 `public/mathhub/index.html`。
