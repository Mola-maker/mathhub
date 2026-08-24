const EXECUTABLE_FENCE_SOURCE = 'tikz-agent-tool|tikz-action|tikz-patch|tikz-construction-plan|tikz-construction-intent|tikz-managed-presentation|tikz-geometry-intent';
const HIDDEN_THINK_OPEN_PATTERN = /<(?:mm:)?think\b[^>]*>/iu;
const HIDDEN_THINK_CLOSE_PATTERN = /<\/(?:mm:)?think\s*>/iu;
const FENCE_PREFIX_RESERVE = 40;
// Unlabelled Markdown fences need a small transaction window: releasing their
// first chunk immediately would leak a TikZ candidate into the assistant
// transcript, while retaining an unbounded provider response would let a
// malformed model output grow the browser/server buffer forever.
const MAX_UNLABELED_FENCE_BUFFER = 32 * 1024;
const UNLABELED_FENCE_OPEN_PATTERN = /```[ \t]*(?:\r?\n|$)/u;
const BARE_TIKZ_OPEN_PATTERN = /\\begin\s*\{\s*tikzpicture\s*\}/iu;
const BARE_TIKZ_CLOSE_PATTERN = /\\end\s*\{\s*tikzpicture\s*\}/iu;
const TIKZ_TEX_COMMAND_PATTERN = /\\(?:draw|path|fill(?:draw)?|shade(?:draw)?|clip|node|coordinate|foreach|matrix|graph|tikzset|usetikzlibrary|useasboundingbox|pgf(?:keys|math)\w*|newcommand|renewcommand|documentclass|usepackage|frac|sqrt|text|mathrm|mathbf|begin|end)\b/iu;

export function containsTikzOrTexCommand(value: string): boolean {
  return TIKZ_TEX_COMMAND_PATTERN.test(value)
    || /\\begin\s*\{\s*tikzpicture\s*\}/iu.test(value)
    || /\\end\s*\{\s*tikzpicture\s*\}/iu.test(value);
}

type HiddenMode = 'fence' | 'think' | 'unlabeled-fence' | 'bare-tikz';

/**
 * Streams conversational prose immediately while withholding executable
 * action envelopes from the chat surface. The complete provider response is
 * still returned separately for trusted server-side extraction and lowering.
 */
export function createAgentVisibleOutputStream(
  send: (token: string) => void,
) {
  // Code is an artifact, not conversational prose. Ordinary TikZ examples
  // are withheld too and may be surfaced by the host as a collapsed widget.
  const fenceLabels = `${EXECUTABLE_FENCE_SOURCE}|tikz-agent-widget|tikz(?!-)|latex|tex`;
  const hiddenFencePattern = new RegExp(`\`\`\`(?:${fenceLabels})\\b`, 'iu');
  let pending = '';
  let hidden: HiddenMode | null = null;
  let hiddenOpening = '';
  let hiddenHasTikz = false;

  const push = (token: string) => {
    pending += token;
    for (;;) {
      if (hidden) {
        const close = hidden === 'fence'
          ? (() => {
              const index = pending.indexOf('```');
              return index < 0 ? null : { index, length: 3 };
            })()
          : hidden === 'think'
            ? (() => {
                const match = HIDDEN_THINK_CLOSE_PATTERN.exec(pending);
                return match?.index === undefined
                  ? null
                  : { index: match.index, length: match[0].length };
              })()
            : hidden === 'unlabeled-fence'
              ? (() => {
                  const index = pending.indexOf('```');
                  return index < 0 ? null : { index, length: 3 };
                })()
              : (() => {
                  const match = BARE_TIKZ_CLOSE_PATTERN.exec(pending);
                  return match?.index === undefined
                    ? null
                    : { index: match.index, length: match[0].length };
                })();
        if (!close) {
          if (hidden === 'unlabeled-fence' || hidden === 'bare-tikz') {
            hiddenHasTikz ||= containsTikzOrTexCommand(pending);
            if (pending.length > MAX_UNLABELED_FENCE_BUFFER) {
              // For an ordinary, very large fence release the already scanned
              // prefix so Markdown is not swallowed. If a TikZ/TeX command has
              // appeared, keep only a close-marker window and hide the rest.
              if (hidden === 'unlabeled-fence' && !hiddenHasTikz) {
                const safeEnd = pending.length - FENCE_PREFIX_RESERVE;
                if (safeEnd > 0) {
                  send(`${hiddenOpening}${pending.slice(0, safeEnd)}`);
                  hiddenOpening = '';
                }
              }
              pending = pending.slice(-FENCE_PREFIX_RESERVE);
            }
          } else if (pending.length > FENCE_PREFIX_RESERVE) {
            pending = pending.slice(-FENCE_PREFIX_RESERVE);
          }
          return;
        }
        if (hidden === 'unlabeled-fence') {
          const candidate = pending.slice(0, close.index);
          const containsTikz = hiddenHasTikz || containsTikzOrTexCommand(candidate);
          if (!containsTikz) {
            // Ordinary Markdown is not an artifact. Re-emit it byte-for-byte
            // after the bounded look-ahead proves it is safe to show.
            send(`${hiddenOpening}${candidate}${pending.slice(close.index, close.index + close.length)}`);
          }
        }
        pending = pending.slice(close.index + close.length);
        hidden = null;
        hiddenOpening = '';
        hiddenHasTikz = false;
        continue;
      }

      const fenceOpening = hiddenFencePattern.exec(pending);
      const unlabeledFenceOpening = UNLABELED_FENCE_OPEN_PATTERN.exec(pending);
      const thinkOpening = HIDDEN_THINK_OPEN_PATTERN.exec(pending);
      const strayThinkClose = HIDDEN_THINK_CLOSE_PATTERN.exec(pending);
      const bareTikzOpening = BARE_TIKZ_OPEN_PATTERN.exec(pending);
      const candidates = [
        fenceOpening?.index === undefined ? null : {
          index: fenceOpening.index,
          length: fenceOpening[0].length,
          kind: 'fence' as const,
        },
        unlabeledFenceOpening?.index === undefined ? null : {
          index: unlabeledFenceOpening.index,
          length: unlabeledFenceOpening[0].length,
          kind: 'unlabeled-fence' as const,
        },
        thinkOpening?.index === undefined ? null : {
          index: thinkOpening.index,
          length: thinkOpening[0].length,
          kind: 'think' as const,
        },
        strayThinkClose?.index === undefined ? null : {
          index: strayThinkClose.index,
          length: strayThinkClose[0].length,
          kind: null,
        },
        bareTikzOpening?.index === undefined ? null : {
          index: bareTikzOpening.index,
          length: bareTikzOpening[0].length,
          kind: 'bare-tikz' as const,
        },
      ].filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
        .sort((left, right) => left.index - right.index);
      const opening = candidates[0];
      if (opening) {
        const visible = pending.slice(0, opening.index);
        if (visible) send(visible);
        if (opening.kind === 'unlabeled-fence') {
          hiddenOpening = pending.slice(opening.index, opening.index + opening.length);
          hiddenHasTikz = false;
        }
        pending = pending.slice(opening.index + opening.length);
        hidden = opening.kind;
        continue;
      }

      if (pending.length <= FENCE_PREFIX_RESERVE) return;
      const visibleEnd = pending.length - FENCE_PREFIX_RESERVE;
      send(pending.slice(0, visibleEnd));
      pending = pending.slice(visibleEnd);
      return;
    }
  };

  const flush = () => {
    if (hidden === 'unlabeled-fence') {
      const containsTikz = hiddenHasTikz || containsTikzOrTexCommand(pending);
      if (!containsTikz && (hiddenOpening || pending)) send(`${hiddenOpening}${pending}`);
    } else if (!hidden && pending) {
      send(pending);
    }
    pending = '';
    hidden = null;
    hiddenOpening = '';
    hiddenHasTikz = false;
  };

  return { push, flush };
}
