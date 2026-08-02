import { parser } from '../editor/tikz-parser';

/**
 * Return the UTF-16 offset of the parsed top-level `\\end{tikzpicture}`.
 * Textual lastIndexOf is unsafe because comments, nodes and opaque TeX can
 * contain the same bytes without closing the active picture environment.
 */
export function tikzPictureBodyEndOffset(source: string): number | null {
  const tree = parser.parse(source);
  let offset: number | null = null;
  let hasError = false;
  let endCount = 0;
  tree.iterate({
    enter(node) {
      if (node.type.isError) {
        hasError = true;
        return;
      }
      if (node.name === 'EndTikz') {
        endCount += 1;
        offset = node.from;
      }
    },
  });
  return hasError || endCount !== 1 ? null : offset;
}
