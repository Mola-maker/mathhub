import type { CSSProperties, ReactNode } from "react";
import "./fragments.css";

/* ============================================================
   Floating UI fragment primitives.
   Open layout: thin rules, tiny uppercase metadata, NO cards.
   ============================================================ */

type FragEdge = "top" | "bottom" | "left" | "right";

export interface FragProps {
  /** Position in % of the parent stage (which must be position:relative). */
  x: number;
  y: number;
  /** Optional tiny uppercase label rendered above the content. */
  label?: string;
  /** Hairline borders — at most 2 sides. */
  edges?: FragEdge[];
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function Frag({
  x,
  y,
  label,
  edges = [],
  children,
  className,
  style,
}: FragProps) {
  const edgeClass = edges
    .slice(0, 2) // hard rule: never more than two hairline sides
    .map((e) => `frag--edge-${e}`)
    .join(" ");
  return (
    <div
      className={["frag", edgeClass, className].filter(Boolean).join(" ")}
      style={{ left: `${x}%`, top: `${y}%`, ...style }}
    >
      {label && (
        <span className="frag__label tinylabel">{label}</span>
      )}
      {children}
    </div>
  );
}

export interface TinyLabelProps {
  children: ReactNode;
  active?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function TinyLabel({ children, active, className, style }: TinyLabelProps) {
  return (
    <span
      className={["tinylabel", active ? "tinylabel--active" : "", className]
        .filter(Boolean)
        .join(" ")}
      style={style}
    >
      {children}
    </span>
  );
}

export interface SourceLineProps {
  children: ReactNode;
  dim?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** Monospace source text — the editorial voice of the geometry. */
export function SourceLine({ children, dim, className, style }: SourceLineProps) {
  return (
    <div
      className={["sourceline", dim ? "sourceline--dim" : "", className]
        .filter(Boolean)
        .join(" ")}
      style={style}
    >
      {children}
    </div>
  );
}

export interface KeyHintProps {
  /** Key legend, e.g. "⌘" and "K" → renders ⌘ K */
  keys: string[];
  /** Optional trailing description. */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

export function KeyHint({ keys, label, className, style }: KeyHintProps) {
  return (
    <span className={["keyhint", className].filter(Boolean).join(" ")} style={style}>
      {keys.map((k, i) => (
        <kbd key={i} className="keyhint__key">
          {k}
        </kbd>
      ))}
      {label && <span>{label}</span>}
    </span>
  );
}
