export const SAMPLE_TIKZ = `\\begin{tikzpicture}
  \\coordinate (A) at (0,0);
  \\coordinate (B) at (4,0);
  \\coordinate (C) at (1.2,2.8);
  \\coordinate (M) at ($(A)!0.5!(B)$);
  \\coordinate (H) at ($(A)!(C)!(B)$);
  \\draw[thick] (A) -- (B) -- (C) -- cycle;
  \\draw[dashed,red] (C) -- (H);
  \\draw[blue] (C) -- (M);
  \\pic[draw] {right angle = C--H--B};
  \\node[below left] at (A) {$A$};
  \\node[below right] at (B) {$B$};
  \\node[above] at (C) {$C$};
  \\node[below] at (M) {$M$};
  \\node[below] at (H) {$H$};
\\end{tikzpicture}`;

