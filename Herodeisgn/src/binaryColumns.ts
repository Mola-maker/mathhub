// Binary "data-storm" columns — pure DOM. Four columns of fixed-width
// 4-character binary strings, one highlighted "now reading" digit per
// column. All content is hard-coded so SSR (none here) and CSR agree.

type Column = {
  /** 24 rows of exactly 4-character binary strings. */
  rows: readonly string[];
  /** Row index of the highlighted digit. */
  highlightRow: number;
  /** Column index within the digit string. -1 = none. */
  highlightCol: number;
};

// Deterministic 24×4 binary data, four columns. Each row is exactly 4
// characters of 0/1. The matrices are not random — chosen by hand so
// the columns feel like a log feed: mostly sparse, occasional dense
// rows, an intentional burst (the long binary-looking string at one
// row of each column reads as a packet header).
const COLUMNS: readonly Column[] = [
  {
    rows: [
      '0100', '1000', '0101', '0111',
      '1100', '1000', '0111', '0001',
      '0110', '0100', '1111', '0010',
      '0010', '0111', '1000', '0100',
      '0101', '1100', '0001', '0110',
      '1000', '0000', '0111', '1001',
    ],
    highlightRow: 10,
    highlightCol: 2,
  },
  {
    rows: [
      '0110', '0101', '0101', '0111',
      '0001', '1001', '0111', '0100',
      '0100', '1000', '0111', '1001',
      '1000', '1100', '0010', '1011',
      '0000', '0010', '0010', '0110',
      '1001', '1000', '1000', '1100',
    ],
    highlightRow: 5,
    highlightCol: 1,
  },
  {
    rows: [
      '1000', '0000', '0001', '0011',
      '0101', '0101', '0011', '0110',
      '0010', '0101', '1011', '1010',
      '1011', '0010', '0001', '0101',
      '0011', '0010', '0101', '0110',
      '0111', '0010', '1100', '1010',
    ],
    highlightRow: 14,
    highlightCol: 0,
  },
  {
    rows: [
      '1000', '0001', '0011', '0010',
      '0101', '0010', '0011', '0001',
      '1010', '1001', '1011', '0010',
      '0110', '0100', '0110', '0101',
      '1001', '0110', '0110', '0111',
      '0010', '0100', '0001', '0101',
    ],
    highlightRow: 2,
    highlightCol: 3,
  },
];

function renderRow(
  row: string,
  hiRow: number,
  hiCol: number,
  rowIdx: number,
): HTMLElement {
  const el = document.createElement('div');
  el.className = rowIdx === hiRow ? 'hb-row hb-row--hi' : 'hb-row';
  if (rowIdx === hiRow && hiCol >= 0) {
    const safeCol = Math.min(Math.max(hiCol, 0), Math.max(row.length - 1, 0));
    const before = document.createTextNode(row.slice(0, safeCol));
    const ch = row[safeCol] ?? '0';
    const span = document.createElement('span');
    span.className = 'hb-row__hi-digit';
    span.textContent = ch;
    const after = document.createTextNode(row.slice(safeCol + 1));
    el.append(before, span, after);
  } else {
    el.textContent = row;
  }
  return el;
}

/** Inject the four columns into the host element. Idempotent. */
export function mountBinaryColumns(host: HTMLElement): void {
  host.replaceChildren();
  COLUMNS.forEach((col, colIdx) => {
    const colEl = document.createElement('div');
    colEl.className = 'hb-col';
    colEl.style.setProperty('--hb-col-i', String(colIdx));
    col.rows.forEach((row, rowIdx) => {
      colEl.appendChild(renderRow(row, col.highlightRow, col.highlightCol, rowIdx));
    });
    host.appendChild(colEl);
  });
}