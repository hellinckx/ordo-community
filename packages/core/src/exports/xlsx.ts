import { fromCents } from "../model/money";

export interface SheetSpec {
  name: string;
  columns: { header: string; key: string; width?: number; money?: boolean }[];
  rows: Record<string, unknown>[];
  /** Optional sum row for money columns. */
  totals?: boolean;
}

/** Builds an .xlsx file with one sheet per spec. Money values are given in cents and converted to EUR cells. */
export async function buildXlsx(sheets: SheetSpec[], meta: { creator?: string; title?: string } = {}): Promise<Uint8Array> {
  const ExcelJS = (await import("exceljs")).default ?? (await import("exceljs"));
  const wb = new ExcelJS.Workbook();
  wb.creator = meta.creator ?? "Summa";
  wb.created = new Date();
  if (meta.title) wb.title = meta.title;
  for (const spec of sheets) {
    const ws = wb.addWorksheet(spec.name.slice(0, 31));
    ws.columns = spec.columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? Math.max(12, c.header.length + 2) }));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    for (const r of spec.rows) {
      const row: Record<string, unknown> = {};
      for (const c of spec.columns) {
        const v = r[c.key];
        row[c.key] = c.money && typeof v === "number" ? fromCents(v) : v;
      }
      ws.addRow(row);
    }
    for (const c of spec.columns) {
      if (c.money) ws.getColumn(c.key).numFmt = '#,##0.00 "€"';
    }
    if (spec.totals && spec.rows.length) {
      const totalRow: Record<string, unknown> = {};
      for (const c of spec.columns) {
        if (c.money) {
          const col = ws.getColumn(c.key).letter;
          totalRow[c.key] = { formula: `SUM(${col}2:${col}${spec.rows.length + 1})` };
        }
      }
      const first = spec.columns[0]!.key;
      if (!(first in totalRow)) totalRow[first] = "Summe";
      const r = ws.addRow(totalRow);
      r.font = { bold: true };
    }
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: spec.columns.length } };
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}
