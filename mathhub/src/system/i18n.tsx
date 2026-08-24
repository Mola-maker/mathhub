import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/* ============================================================
   i18n — zh/en language-switch foundation.
   LanguageProvider + useLang() + the complete copy dictionary.

   Key scheme: <area>.<thing>[.<part>]
     nav.*        header wordmark nav labels
     header.*     header chrome (entry action, toggle)
     chapter.*    SceneShell chapter titles
     s1..s6.*     per-scene strings, grouped by region

   Mathematical notation (A = point(...), ⌘K, AB = AC, Δ A) is
   NEVER translated — it stays identical in both languages.
   ============================================================ */

export type Lang = "zh" | "en";

const STORAGE_KEY = "mathhub-lang";

/* ---------- English (source of truth for keys) ---------- */
const en = {
  /* Header */
  "nav.workspace": "Workspace",
  "nav.examples": "Examples",
  "nav.principles": "Principles",
  "nav.docs": "Docs",
  "header.enter": "Enter workspace ↗",

  /* Chapter titles (SceneShell) */
  "chapter.origin": "Origin",
  "chapter.gesture": "Gesture",
  "chapter.entries": "Entries",
  "chapter.convergence": "Convergence",
  "chapter.workspace": "Workspace",
  "chapter.instruments": "Instruments",

  /* Scene 1 — Origin (brand wordmark Math/Hub is hardcoded in
     Scene 1 — it stays English in both languages by design) */
  "s1.standfirst": "Geometry, from source.",
  "s1.cta": "Enter workspace ↗",
  "s1.fig": "Fig. 01 — Circumcircle of ABC",
  "s1.frag.live": "Live",
  "s1.mode.navigate": "Navigate",
  "s1.mode.primitive": "Primitive",
  "s1.mode.constraint": "Constraint",
  "s1.mode.transform": "Transform",

  /* Scene 2 — Gesture */
  "s2.frag.source": "Source",
  "s2.hint": "drag A",
  "s2.fig": "Fig. 02 — Gesture → source → geometry",

  /* Scene 3 — Entries */
  "s3.kicker": "03 — Many ways in",
  "s3.headline.a": "Five ways in.",
  "s3.headline.b": "One source of truth.",
  "s3.sub":
    "Every gesture — click, keystroke, prompt, drag, edit — lands on the same construction.",
  "s3.frag.command": "COMMAND",
  "s3.frag.ai": "AI",
  "s3.frag.keys": "KEYS",
  "s3.frag.canvas": "CANVAS",
  "s3.frag.source": "SOURCE",
  "s3.command.text": "Construct circumcircle",
  "s3.ai.prompt": "› Circumcircle of ABC · circumcenter O",

  /* Scene 4 — Convergence */
  "s4.echo.command": "Command",
  "s4.echo.ai": "AI command",
  "s4.echo.keys": "Keys",
  "s4.echo.canvas": "Canvas",
  "s4.echo.source": "Source",
  "s4.command.move": "move A →",
  "s4.ai.prompt": "› Circumcircle of ABC · circumcenter O",
  "s4.keys.label": "circumcircle",
  "s4.tx.label": "Source transaction",
  "s4.tx.move": "move A → point(",
  "s4.quiet": "Every gesture. Every command. One source of truth.",

  /* Scene 5 — Workspace (real studio vocabulary only) */
  "s5.tool.select": "Select V",
  "s5.tool.segment": "Segment L",
  "s5.tool.circle": "Circle C",
  "s5.tool.midpoint": "Midpt M",
  "s5.tool.perpbisect": "Perp-bisect B",
  "s5.tool.invert": "Invert I",
  "s5.deck.label": "Command deck",
  "s5.deck.prompt": "Search inversion, quadrilateral, perpendicular…",
  "s5.history.ai": "Circumcircle of ABC · circumcenter O",
  "s5.history.circle": "Circle(A, B, C)",
  "s5.history.center": "O = TriangleCenter(A, B, C, 3)",
  "s5.history.badge": "proposal ✓ binding matched",
  "s5.inspector.label": "Inspector",
  "s5.inspector.tab.geometry": "Geometry",
  "s5.inspector.tab.style": "Style",
  "s5.inspector.tab.relations": "Relations",
  "s5.rel.deftype": "Definition · derived point",
  "s5.rel.writeback": "Write-back · coordinate literals",
  "s5.rel.upstream": "Upstream A, B",
  "s5.rel.downstream": "Downstream M, H",
  "s5.rel.dof": "DOF · derived · solver keeps constraints while dragging",
  "s5.solver.label": "Solver",
  "s5.solver.dragging": "Holding constraints while dragging H…",
  "s5.solver.held": "Constraints held",
  "s5.canvas.meta": "6 points · 9 elements",
  "s5.chip.steps": "☷ Steps",
  "s5.chip.preview": "⌁ Exact preview",
  "s5.source.label": "TikZ source · sole truth",
  "s5.enter": "Enter workspace ↗",

  /* Scene 6 — Instruments (finale: two real studio gateways) */
  "s6.kicker": "06 — Instruments",
  "s6.geo.name": "GeoGebra Studio",
  "s6.geo.desc": "Many ways to construct — every element directly manipulable.",
  "s6.geo.hint": "drag",
  "s6.geo.cta": "Open board ↗",
  "s6.tikz.name": "TikZ Studio",
  "s6.tikz.desc": "Source-first — publication-grade output.",
  "s6.tikz.cta": "Open studio ↗",
} as const;

export type I18nKey = keyof typeof en;

/* ---------- Chinese — quiet, editorial, concise ---------- */
const zh: Record<I18nKey, string> = {
  /* Header */
  "nav.workspace": "工作区",
  "nav.examples": "示例",
  "nav.principles": "原则",
  "nav.docs": "文档",
  "header.enter": "进入工作区 ↗",

  /* Chapter titles */
  "chapter.origin": "起点",
  "chapter.gesture": "手势",
  "chapter.entries": "入口",
  "chapter.convergence": "汇聚",
  "chapter.workspace": "工作区",
  "chapter.instruments": "乐器",

  /* Scene 1 — 起点 */
  "s1.standfirst": "几何，源于源码。",
  "s1.cta": "进入工作区 ↗",
  "s1.fig": "图 01 —— ABC 的外接圆",
  "s1.frag.live": "实时",
  "s1.mode.navigate": "导航",
  "s1.mode.primitive": "图元",
  "s1.mode.constraint": "约束",
  "s1.mode.transform": "变换",

  /* Scene 2 — 手势 */
  "s2.frag.source": "源码",
  "s2.hint": "拖动 A",
  "s2.fig": "图 02 —— 手势 → 源码 → 几何",

  /* Scene 3 — 入口 */
  "s3.kicker": "03 —— 多种入口",
  "s3.headline.a": "五种入口。",
  "s3.headline.b": "同一个真源。",
  "s3.sub": "每一次操作——点击、按键、指令、拖动、编辑——都落在同一个构造上。",
  "s3.frag.command": "命令",
  "s3.frag.ai": "AI",
  "s3.frag.keys": "按键",
  "s3.frag.canvas": "画布",
  "s3.frag.source": "源码",
  "s3.command.text": "构造外接圆",
  "s3.ai.prompt": "› 作三角形 ABC 的外接圆并标出外心",

  /* Scene 4 — 汇聚 */
  "s4.echo.command": "命令",
  "s4.echo.ai": "AI 指令",
  "s4.echo.keys": "按键",
  "s4.echo.canvas": "画布",
  "s4.echo.source": "源码",
  "s4.command.move": "移动 A →",
  "s4.ai.prompt": "› 作三角形 ABC 的外接圆并标出外心",
  "s4.keys.label": "外接圆",
  "s4.tx.label": "源码事务",
  "s4.tx.move": "移动 A → point(",
  "s4.quiet": "每个手势。每条指令。同一个真源。",

  /* Scene 5 — 工作区（只用真实工作室词汇；数学记号不翻译） */
  "s5.tool.select": "选择 V",
  "s5.tool.segment": "线段 L",
  "s5.tool.circle": "圆 C",
  "s5.tool.midpoint": "中点 M",
  "s5.tool.perpbisect": "中垂线 B",
  "s5.tool.invert": "反演 I",
  "s5.deck.label": "命令面板",
  "s5.deck.prompt": "搜索反演、四边形、垂线、inversion…",
  "s5.history.ai": "作三角形 ABC 的外接圆并标出外心",
  "s5.history.circle": "Circle(A, B, C)",
  "s5.history.center": "O = TriangleCenter(A, B, C, 3)",
  "s5.history.badge": "proposal ✓ binding 匹配",
  "s5.inspector.label": "检查器",
  "s5.inspector.tab.geometry": "几何",
  "s5.inspector.tab.style": "样式",
  "s5.inspector.tab.relations": "关系",
  "s5.rel.deftype": "定义类型 · 派生点",
  "s5.rel.writeback": "写回策略 · 坐标字面量",
  "s5.rel.upstream": "上游构造 A, B",
  "s5.rel.downstream": "下游对象 M, H",
  "s5.rel.dof": "自由度 · 派生对象 · 拖动时由求解器保持约束",
  "s5.solver.label": "求解器",
  "s5.solver.dragging": "正在保持约束拖动 H…",
  "s5.solver.held": "约束已保持",
  "s5.canvas.meta": "6 点 · 9 图元",
  "s5.chip.steps": "☷ 步骤",
  "s5.chip.preview": "⌁ 精确预览",
  "s5.source.label": "TikZ 源码 · 唯一真源",
  "s5.enter": "进入工作区 ↗",

  /* Scene 6 — 乐器（终章：两个真实工作室入口） */
  "s6.kicker": "06 —— 两件乐器",
  "s6.geo.name": "GeoGebra Studio · 动态几何画板",
  "s6.geo.desc": "多种构造方式，每个元素都可直接操纵。",
  "s6.geo.hint": "拖拽",
  "s6.geo.cta": "打开画板 ↗",
  "s6.tikz.name": "TikZ Studio · 排版级几何源码",
  "s6.tikz.desc": "源码先行，出版级排版输出。",
  "s6.tikz.cta": "打开工作室 ↗",
};

/* Full dictionary, exported so scenes/tests can introspect keys. */
export const dict: Record<Lang, Record<I18nKey, string>> = { en, zh };

/* ---------- Context ---------- */

interface LangContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: I18nKey) => string;
}

const LangContext = createContext<LangContextValue | null>(null);

function readInitialLang(): Lang {
  try {
    if (typeof window === "undefined") return "zh";
    return window.localStorage.getItem(STORAGE_KEY) === "en" ? "en" : "zh";
  } catch {
    return "zh";
  }
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  /* Default language is zh — the user is Chinese-speaking. */
  const [lang, setLangState] = useState<Lang>(readInitialLang);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable — language simply won't persist */
    }
  }, []);

  const t = useCallback(
    (key: I18nKey): string => dict[lang][key] ?? dict.en[key] ?? key,
    [lang],
  );

  const value = useMemo(
    () => ({ lang, setLang, t }),
    [lang, setLang, t],
  );

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangContextValue {
  const ctx = useContext(LangContext);
  if (!ctx) {
    throw new Error("useLang() must be used inside <LanguageProvider>");
  }
  return ctx;
}
