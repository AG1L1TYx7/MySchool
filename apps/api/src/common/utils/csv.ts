/**
 * Small RFC 4180 CSV reader and writer: quoted fields, embedded commas, quotes and newlines,
 * CRLF or LF line endings, optional UTF-8 BOM. Imports and exports never need more than this.
 */

export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Header row plus one object per data row, keyed by normalised header (lowercase, no spaces or underscores). */
export function csvRecords(text: string): {
  headers: string[];
  rows: Array<{ line: number; values: Record<string, string> }>;
} {
  const rows = parseCsv(text);
  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = rows[0].map(normaliseHeader);
  const data = rows.slice(1).map((cells, idx) => {
    const values: Record<string, string> = {};
    headers.forEach((h, i) => {
      values[h] = (cells[i] ?? '').trim();
    });
    return { line: idx + 2, values };
  });
  return { headers, rows: data };
}

export function normaliseHeader(header: string): string {
  return header
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

export function toCsv(
  rows: Array<Array<string | number | boolean | null | undefined>>,
): string {
  return rows.map((r) => r.map(escapeCell).join(',')).join('\r\n') + '\r\n';
}

function escapeCell(
  value: string | number | boolean | null | undefined,
): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  // Neutralise spreadsheet formula injection as well as quoting.
  const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(guarded)
    ? `"${guarded.replace(/"/g, '""')}"`
    : guarded;
}
