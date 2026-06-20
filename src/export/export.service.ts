/**
 * Excel / PDF generation over the `exportData()` hook. `exceljs` and `pdfkit`
 * are **optional** peer dependencies, loaded lazily — the library works without
 * them; only the export endpoints require them installed.
 *
 *   npm install exceljs pdfkit
 *
 * @author Charlietyn (TypeScript/TypeORM port)
 */

export interface ExportFile {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

export interface ExportOptions {
  filename?: string;
  title?: string;
  sheetName?: string;
}

/** Read a (possibly dotted) column path from a plain row object. */
function pick(row: Record<string, unknown>, path: string): unknown {
  if (!path.includes('.')) return row?.[path];
  return path.split('.').reduce<unknown>((acc, seg) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[seg];
    return undefined;
  }, row);
}

function toCell(value: unknown): string | number | boolean | Date | null {
  if (value === null || value === undefined) return null;
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value instanceof Date
  ) {
    return value as string | number | boolean | Date;
  }
  return JSON.stringify(value);
}

function requireOptional<T = unknown>(name: string): T {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(name) as T;
  } catch {
    throw new Error(
      `Optional dependency '${name}' is required for this export. Install it with: npm install ${name}`,
    );
  }
}

export class ExportService {
  /** Build an .xlsx workbook from rows + columns. */
  static async toExcel(
    data: Record<string, unknown>[],
    columns: string[],
    options: ExportOptions = {},
  ): Promise<ExportFile> {
    const ExcelJS = requireOptional<any>('exceljs');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(options.sheetName ?? 'Sheet1');

    sheet.columns = columns.map((c) => ({ header: c, key: c, width: Math.max(12, c.length + 2) }));
    sheet.getRow(1).font = { bold: true };

    for (const row of data) {
      const record: Record<string, unknown> = {};
      for (const col of columns) record[col] = toCell(pick(row, col));
      sheet.addRow(record);
    }

    const buffer = (await workbook.xlsx.writeBuffer()) as Buffer;
    return {
      buffer: Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer),
      filename: options.filename ?? 'export.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  /** Build a simple tabular PDF from rows + columns. */
  static async toPdf(
    data: Record<string, unknown>[],
    columns: string[],
    options: ExportOptions = {},
  ): Promise<ExportFile> {
    const PDFDocument = requireOptional<any>('pdfkit');

    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ margin: 36, size: 'A4', layout: 'landscape' });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      if (options.title) {
        doc.fontSize(16).text(options.title, { align: 'center' }).moveDown(0.5);
      }

      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const colWidth = pageWidth / Math.max(columns.length, 1);
      const rowHeight = 20;
      let y = doc.y;

      const drawRow = (values: string[], bold = false): void => {
        doc.fontSize(9).font(bold ? 'Helvetica-Bold' : 'Helvetica');
        let x = doc.page.margins.left;
        for (const value of values) {
          doc.text(value, x + 2, y + 5, { width: colWidth - 4, height: rowHeight, ellipsis: true });
          x += colWidth;
        }
        doc
          .moveTo(doc.page.margins.left, y + rowHeight)
          .lineTo(doc.page.margins.left + colWidth * columns.length, y + rowHeight)
          .strokeColor('#cccccc')
          .stroke();
        y += rowHeight;
        if (y > doc.page.height - doc.page.margins.bottom - rowHeight) {
          doc.addPage();
          y = doc.page.margins.top;
        }
      };

      drawRow(columns, true);
      for (const row of data) {
        drawRow(columns.map((c) => String(pick(row, c) ?? '')));
      }

      doc.end();
    });

    return {
      buffer,
      filename: options.filename ?? 'export.pdf',
      mimeType: 'application/pdf',
    };
  }
}
