import ExcelJS from 'exceljs';

export type Cell = string | number | null | undefined;

function csvCell(value: Cell): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  // Neutralize spreadsheet formula injection.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** UTF-8 CSV with BOM so Excel renders Persian text correctly. */
export function toCsv(headers: string[], rows: Cell[][]): Buffer {
  const lines = [headers, ...rows].map((r) => r.map(csvCell).join(','));
  return Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8');
}

/** Right-to-left XLSX workbook with a bold header row. */
export async function toXlsx(sheetName: string, headers: string[], rows: Cell[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Karban';
  wb.created = new Date();
  const ws = wb.addWorksheet(sheetName.slice(0, 31), { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  ws.addRow(headers).font = { bold: true };
  for (const r of rows) {
    ws.addRow(r.map((c) => (typeof c === 'string' && /^[=+\-@]/.test(c) ? `'${c}` : (c ?? ''))));
  }
  headers.forEach((h, i) => {
    const longest = Math.max(h.length, ...rows.slice(0, 200).map((r) => String(r[i] ?? '').length));
    ws.getColumn(i + 1).width = Math.min(60, Math.max(10, longest + 2));
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export const EXPORT_MIME = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const;
