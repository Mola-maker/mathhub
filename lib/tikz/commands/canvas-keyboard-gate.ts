/**
 * A focus event with no previous target can be produced when CodeMirror's
 * editable DOM is reconciled after an invalid intermediate document. It must
 * not silently arm one-letter Canvas shortcuts. Pointer entry is handled by
 * the caller; keyboard focus entry is explicit only when the browser reports
 * a real previous focus target (for example, Tab navigation).
 */
export function explicitCanvasKeyboardFocusEntry(
  relatedTarget: EventTarget | null,
): boolean {
  return relatedTarget !== null;
}
