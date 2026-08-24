import { parser } from '../editor/tikz-parser';

/**
 * Return the UTF-16 offset of the parsed top-level `\\end{tikzpicture}`.
 * Textual lastIndexOf is unsafe because comments, nodes and opaque TeX can
 * contain the same bytes without closing the active picture environment.
 */
export function tikzPictureBodyEndOffset(source: string): number | null {
  const tree = parser.parse(source);
  let offset: number | null = null;
  let beginCount = 0;
  let endCount = 0;
  tree.iterate({
    enter(node) {
      // Unsupported TikZ/TeX inside a structurally recognized picture is an
      // opaque semantic region, not evidence that the outer insertion point
      // disappeared. Requiring an error-free whole tree made composite
      // managed writers (for example \path let ... \n1=...) permanently
      // disable every later construction/label insertion.
      if (node.name === 'BeginTikz') beginCount += 1;
      if (node.name === 'EndTikz') {
        endCount += 1;
        offset = node.from;
      }
    },
  });
  return beginCount !== 1 || endCount !== 1 ? null : offset;
}
