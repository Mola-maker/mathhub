export interface TikzRecipe {
  id: string;
  keywords: string[];
  title: string;
  snippet: string;
}

export const TIKZ_RECIPES: TikzRecipe[] = [
  {
    id: 'fermat-point',
    keywords: ['费马点', '托里拆利点', 'Fermat point', 'Torricelli point'],
    title: '费马–托里拆利点（120° 分支构造）',
    snippet: `Use exactly one GeometryIntent/v2 construct operation with toolId "fermat-point"
and inputRefs for the three ordered, non-collinear triangle vertices. The trusted
Catalog chooses the interior Torricelli construction or the >=120-degree
vertex branch atomically. Never expand this construction into raw TikZ.`,
  },
  {
    id: 'nine-point-circle',
    keywords: ['九点圆', '九点圆心', 'nine-point', 'nine point'],
    title: '九点圆（九个派生点 + 三边中点外接圆）',
    snippet: `Use exactly one GeometryIntent/v2 construct operation with toolId "nine-point-circle"
and inputRefs for the three ordered, non-collinear triangle vertices. The trusted
Catalog creates the complete managed construction atomically. Never expand a
nine-point circle into raw TikZ statements, multiple action fences, or a direct
construction-plan create proposal.`,
  },
  {
    id: 'simson-line',
    keywords: ['西姆松线', '辛普森线', 'Simson line', 'pedal feet'],
    title: '西姆松线（三垂足共线）',
    snippet: `Use exactly one GeometryIntent/v2 construct operation with toolId "simson-line"
and inputRefs for the three ordered, non-collinear triangle vertices. The trusted
Catalog creates a constrained point on the circumcircle, its three pedal feet,
and their collinear line atomically. In semantic revision 1 the circle point is
derived/read-only, not draggable. Never expand this into raw TikZ.`,
  },
  {
    id: 'midpoint',
    keywords: ['中点', '中线', 'midpoint'],
    title: '中点（插值）',
    snippet: '\\coordinate (M) at ($(A)!0.5!(B)$);  % A,B 的中点；任意定比用 !t!',
  },
  {
    id: 'foot',
    keywords: ['垂足', '高线', '垂心', 'altitude'],
    title: '垂足与高线（投影）',
    snippet: '\\coordinate (H) at ($(A)!(C)!(B)$);  % C 到 AB 的垂足\n\\draw[dashed] (C) -- (H);  % 高线\n\\pic[draw] {right angle = C--H--B};  % 直角符号',
  },
  {
    id: 'circumcenter',
    keywords: ['外心', '外接圆', '中垂线', 'circumcenter'],
    title: '外心与外接圆（中垂线求交 + through 圆）',
    snippet: '\\coordinate (M1) at ($(A)!0.5!(B)$);\n\\coordinate (M2) at ($(B)!0.5!(C)$);\n\\path[name path=p1] ($(M1)!-1!90:(A)$) -- ($(M1)!2!90:(A)$);  % AB 中垂线（画长）\n\\path[name path=p2] ($(M2)!-1!90:(B)$) -- ($(M2)!2!90:(B)$);\n\\path[name intersections={of=p1 and p2}] (intersection-1) coordinate (O);\n\\node[draw,circle through=(A)] at (O) {};',
  },
  {
    id: 'incenter',
    keywords: ['内心', '角平分线', 'incenter', 'bisector'],
    title: '内心（受限 let 边长加权）',
    snippet: '% I = (a·A + b·B + c·C)/(a+b+c)，a=|BC|, b=|CA|, c=|AB|\n\\path let \\p1=($(B)-(C)$), \\p2=($(A)-(C)$), \\p3=($(A)-(B)$),\n  \\n1={veclen(\\x1,\\y1)}, \\n2={veclen(\\x2,\\y2)}, \\n3={veclen(\\x3,\\y3)}\n  in coordinate (I) at ($({(\\n1*0+\\n2*4+\\n3*0)/(\\n1+\\n2+\\n3)},{(\\n1*0+\\n2*0+\\n3*3)/(\\n1+\\n2+\\n3)})$);  % 坐标按题面代入',
  },
  {
    id: 'centroid',
    keywords: ['重心', 'centroid'],
    title: '重心（中线 2:1）',
    snippet: '\\coordinate (M) at ($(B)!0.5!(C)$);\n\\coordinate (G) at ($(A)!0.6667!(M)$);  % 或两条中线求交',
  },
  {
    id: 'tangent',
    keywords: ['切线', '切点', '相切', 'tangent'],
    title: '圆的切点（直径圆求交，尺规标准作法）',
    snippet: '\\coordinate (M) at ($(O)!0.5!(P)$);  % OP 中点\n\\node[name path=dm,circle through=(O)] at (M) {};  % 以 OP 为直径的圆\n\\path[name intersections={of=dm and c1}] (intersection-1) coordinate (T1) (intersection-2) coordinate (T2);\n\\draw (P) -- (T1) (P) -- (T2);  % 两条切线',
  },
  {
    id: 'radical',
    keywords: ['根轴', '圆幂', 'radical'],
    title: '两圆交点与根轴',
    snippet: '\\path[name intersections={of=c1 and c2}] (intersection-1) coordinate (P) (intersection-2) coordinate (Q);\n\\draw[red] (P) -- (Q);  % 根轴即公共弦所在直线',
  },
  {
    id: 'rotate-homothety',
    keywords: ['旋转', '位似', '等边', '正方形', 'homothety'],
    title: '旋转与位似（旋转插值）',
    snippet: '\\coordinate (C) at ($(A)!1!60:(B)$);  % 等边三角形第三顶点（绕 A 转 60°）\n\\coordinate (P2) at ($(O)!2!(P)$);  % 以 O 为中心、比 2 的位似像',
  },
];
