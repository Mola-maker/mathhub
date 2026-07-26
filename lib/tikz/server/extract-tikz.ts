const FORBIDDEN: RegExp[] = [
  /\\(?:input|include)\s*(?:\{[^{}\r\n]*\}|[^\s%]+)/g,
  /\\write18\s*(?:=\s*)?(?:\{[^{}\r\n]*\}|[^\s%]*)/g,
  /\\(?:def|newcommand|renewcommand)\b[^\r\n]*/g,
  /\\(?:usepackage|documentclass|usetikzlibrary)\b[^\r\n]*/g,
];

const PREVIEW_ONLY_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: '\\foreach', pattern: /\\foreach\b/ },
  { label: 'plot', pattern: /\bplot\b/ },
  { label: '\\begin{scope}', pattern: /\\begin\{scope\}/ },
  { label: '\\clip', pattern: /\\clip\b/ },
  { label: '\\arc', pattern: /\\arc\s*\(/ },
  { label: '\\tdplot', pattern: /\\tdplot/ },
  { label: 'controls', pattern: /\.\.\s*controls\b/ },
];

export function extractTikzBlock(text: string): string | null {
  const fenced = /```(?:tikz|latex|tex)\s*\r?\n([\s\S]*?)```/i.exec(text);
  if (fenced) return fenced[1].trim();
  const bare = /\\begin\{tikzpicture\}[\s\S]*?\\end\{tikzpicture\}/.exec(text);
  return bare ? bare[0] : null;
}

export function sanitizeTikz(code: string): { code: string; stripped: string[] } {
  const stripped: string[] = [];
  let sanitized = code;
  for (const pattern of FORBIDDEN) {
    sanitized = sanitized.replace(pattern, (match) => {
      const command = /^\\[A-Za-z0-9]+/.exec(match)?.[0] ?? match;
      stripped.push(command);
      return '% [已移除危险命令]';
    });
  }
  return { code: sanitized, stripped: [...new Set(stripped)] };
}

export function detectPreviewOnly(code: string): string[] {
  return PREVIEW_ONLY_PATTERNS
    .filter(({ pattern }) => pattern.test(code))
    .map(({ label }) => label);
}
