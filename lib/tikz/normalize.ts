const LEGACY_THROUGH_CIRCLE =
  /\\(draw|path)(\s*\[([^\]\r\n]*)\])?\s*(\(\s*[A-Za-z][A-Za-z0-9_]*\s*\))\s+circle\s*\[\s*through\s*=\s*(\(\s*[A-Za-z][A-Za-z0-9_]*\s*\))\s*\]\s*;/g;

/**
 * Migrate the v1 pseudo-TikZ through-circle form to the real PGF/TikZ node
 * option defined by the through library.
 */
export function canonicalizeTikz(source: string): string {
  return source
    .replace(/^\uFEFF/, '')
    .replace(
      LEGACY_THROUGH_CIRCLE,
      (_match, command: 'draw' | 'path', _bracket: string, rawOptions: string, center: string, through: string) => {
        const options = [
          rawOptions?.trim(),
          command === 'draw' ? 'draw' : '',
          `circle through=${through}`,
        ].filter(Boolean);
        return `\\node[${options.join(',')}] at ${center} {};`;
      },
    );
}
