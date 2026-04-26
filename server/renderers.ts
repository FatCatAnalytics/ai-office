// ─── Output renderers ────────────────────────────────────────────────────────
// Stage 4: Real PDF (via pdfkit) and XLSX (via exceljs) rendering for live
// agent outputs. All renderers return Buffers so storage can size + persist
// without re-reading.
//
// Design notes:
// - PDF: simple but well-typeset. Title block, project metadata, then the
//   raw content rendered as paragraphs with basic markdown awareness
//   (#/##/### headings, fenced code blocks rendered in monospace, lists).
// - XLSX: detect intent from content. If the worker output contains a
//   markdown table or CSV-like fenced block, render rows into a styled
//   sheet. Otherwise fall back to a single-cell "Output" sheet so the
//   file is still valid.
// ─────────────────────────────────────────────────────────────────────────────

import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";

export interface RenderMeta {
  projectName: string;
  projectDescription: string;
  taskTitle: string;
  agentName: string;
  modelId: string;
  generatedAt: Date;
}

// ─── PDF ────────────────────────────────────────────────────────────────────

export async function renderPdf(content: string, meta: RenderMeta): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margins: { top: 64, bottom: 64, left: 64, right: 64 },
        info: {
          Title: meta.taskTitle,
          Author: `${meta.agentName} (${meta.modelId})`,
          Subject: meta.projectName,
          Producer: "AI Office (Live)",
        },
      });

      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      // ── Title block ──────────────────────────────────────────────────
      doc.font("Helvetica-Bold").fontSize(20).fillColor("#0f172a").text(meta.taskTitle, { align: "left" });
      doc.moveDown(0.4);
      doc.font("Helvetica").fontSize(10).fillColor("#475569");
      doc.text(`${meta.projectName}    •    ${meta.agentName} (${meta.modelId})    •    ${meta.generatedAt.toLocaleString()}`);
      doc.moveDown(0.2);
      // horizontal rule
      doc.moveTo(doc.page.margins.left, doc.y + 4)
         .lineTo(doc.page.width - doc.page.margins.right, doc.y + 4)
         .strokeColor("#e2e8f0").lineWidth(0.7).stroke();
      doc.moveDown(0.8);

      // ── Body ─────────────────────────────────────────────────────────
      renderMarkdownishToPdf(doc, content);

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

// Lightweight markdown renderer: headings, paragraphs, lists, fenced code.
// Not pretending to be perfect markdown — just makes typical LLM output
// readable in print form.
function renderMarkdownishToPdf(doc: PDFKit.PDFDocument, src: string): void {
  const lines = src.split(/\r?\n/);
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    const fenceOpen = line.match(/^```(\w+)?\s*$/);
    if (fenceOpen) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence (or EOF)
      writeCodeBlock(doc, codeLines.join("\n"), fenceOpen[1] ?? "");
      continue;
    }

    // Headings
    if (/^###\s+/.test(line)) {
      doc.moveDown(0.4).font("Helvetica-Bold").fontSize(12).fillColor("#0f172a")
         .text(line.replace(/^###\s+/, ""));
      doc.moveDown(0.2);
      i++; continue;
    }
    if (/^##\s+/.test(line)) {
      doc.moveDown(0.6).font("Helvetica-Bold").fontSize(14).fillColor("#0f172a")
         .text(line.replace(/^##\s+/, ""));
      doc.moveDown(0.2);
      i++; continue;
    }
    if (/^#\s+/.test(line)) {
      doc.moveDown(0.8).font("Helvetica-Bold").fontSize(16).fillColor("#0f172a")
         .text(line.replace(/^#\s+/, ""));
      doc.moveDown(0.3);
      i++; continue;
    }

    // List item (bullet or numbered)
    const bullet = line.match(/^\s*([-*+])\s+(.*)$/);
    const numbered = line.match(/^\s*(\d+)\.\s+(.*)$/);
    if (bullet || numbered) {
      const marker = bullet ? "•" : `${numbered![1]}.`;
      const text = bullet ? bullet[2] : numbered![2];
      doc.font("Helvetica").fontSize(11).fillColor("#1e293b")
         .text(`${marker}  ${stripInlineMd(text)}`, {
           indent: 12,
           paragraphGap: 2,
         });
      i++; continue;
    }

    // Blank line → paragraph break
    if (line.trim() === "") {
      doc.moveDown(0.4);
      i++; continue;
    }

    // Plain paragraph (collect until blank line)
    const paraLines: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^#{1,3}\s+/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^\s*([-*+]|\d+\.)\s+/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    doc.font("Helvetica").fontSize(11).fillColor("#1e293b")
       .text(stripInlineMd(paraLines.join(" ")), { paragraphGap: 4, align: "left" });
  }
}

function writeCodeBlock(doc: PDFKit.PDFDocument, code: string, lang: string): void {
  doc.moveDown(0.3);
  const startY = doc.y;
  doc.font("Courier").fontSize(9).fillColor("#0f172a");

  // Render text first to measure height
  const opts = { width: doc.page.width - doc.page.margins.left - doc.page.margins.right - 16 };
  const text = code.replace(/\t/g, "  ");
  const height = doc.heightOfString(text, opts);

  // Draw background
  doc.rect(
    doc.page.margins.left - 4, startY - 4,
    doc.page.width - doc.page.margins.left - doc.page.margins.right + 8,
    height + 12
  ).fillColor("#f1f5f9").fill();

  // Draw text on top
  doc.fillColor("#0f172a");
  if (lang) {
    doc.font("Courier-Bold").fontSize(8).fillColor("#64748b").text(lang.toUpperCase(), { continued: false });
    doc.font("Courier").fontSize(9).fillColor("#0f172a");
  }
  doc.text(text, doc.page.margins.left, startY + 2, opts);
  doc.moveDown(0.5);
}

// Strip inline markdown markers — not a full parser, just enough to keep
// LLM-generated text readable when emphasis is sprinkled around.
function stripInlineMd(s: string): string {
  return s
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1");
}

// ─── XLSX ───────────────────────────────────────────────────────────────────
// Rendering strategy:
//   1. Try to find a fenced csv/tsv block — parse rows.
//   2. Else try to find a markdown table.
//   3. Else fall back to a single cell with the raw output.
// All paths produce a metadata sheet with project/task/agent context.

export async function renderXlsx(content: string, meta: RenderMeta): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = `${meta.agentName} (${meta.modelId})`;
  wb.created = meta.generatedAt;

  const data = extractTabular(content);
  const dataSheet = wb.addWorksheet(data.sheetName ?? "Data");

  if (data.rows.length > 0) {
    const headers = data.rows[0];
    dataSheet.addRow(headers);
    for (let r = 1; r < data.rows.length; r++) dataSheet.addRow(data.rows[r]);

    // Style header row
    const headerRow = dataSheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF0F172A" },
    };
    headerRow.alignment = { vertical: "middle", horizontal: "left" };
    headerRow.height = 22;

    // Auto-fit columns roughly
    headers.forEach((h, idx) => {
      const col = dataSheet.getColumn(idx + 1);
      let max = String(h ?? "").length;
      for (let r = 1; r < data.rows.length; r++) {
        const v = data.rows[r][idx];
        const len = v == null ? 0 : String(v).length;
        if (len > max) max = len;
      }
      col.width = Math.min(60, Math.max(10, max + 2));
    });

    // Freeze header + autofilter
    dataSheet.views = [{ state: "frozen", ySplit: 1 }];
    dataSheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: headers.length },
    };
  } else {
    dataSheet.getCell("A1").value = "Output (no tabular content detected)";
    dataSheet.getCell("A1").font = { bold: true };
    dataSheet.getColumn(1).width = 100;
    const lines = content.split(/\r?\n/);
    lines.forEach((ln, i) => { dataSheet.getCell(i + 2, 1).value = ln; });
  }

  // Metadata sheet
  const metaSheet = wb.addWorksheet("Info");
  metaSheet.columns = [
    { header: "Field", key: "field", width: 18 },
    { header: "Value", key: "value", width: 80 },
  ];
  metaSheet.getRow(1).font = { bold: true };
  metaSheet.addRow({ field: "Project",     value: meta.projectName });
  metaSheet.addRow({ field: "Description", value: meta.projectDescription });
  metaSheet.addRow({ field: "Task",        value: meta.taskTitle });
  metaSheet.addRow({ field: "Agent",       value: meta.agentName });
  metaSheet.addRow({ field: "Model",       value: meta.modelId });
  metaSheet.addRow({ field: "Generated",   value: meta.generatedAt.toLocaleString() });
  metaSheet.addRow({ field: "Source",      value: data.source });

  const arr = await wb.xlsx.writeBuffer();
  return Buffer.from(arr);
}

interface ExtractedTable {
  rows: (string | number | null)[][];
  source: "csv-fence" | "markdown-table" | "tsv-fence" | "none";
  sheetName?: string;
}

function extractTabular(text: string): ExtractedTable {
  // 1. Fenced csv
  const csvFence = text.match(/```csv\s*([\s\S]*?)```/i);
  if (csvFence) return { rows: parseCsv(csvFence[1]), source: "csv-fence", sheetName: "Data" };

  // 2. Fenced tsv
  const tsvFence = text.match(/```tsv\s*([\s\S]*?)```/i);
  if (tsvFence) {
    const rows = tsvFence[1].split(/\r?\n/).filter(l => l.trim()).map(l => l.split("\t"));
    return { rows, source: "tsv-fence", sheetName: "Data" };
  }

  // 3. Markdown table
  const mdTable = findMarkdownTable(text);
  if (mdTable) return { rows: mdTable, source: "markdown-table", sheetName: "Data" };

  // 4. Try plain CSV-looking content (3+ comma-separated lines in a row)
  const lines = text.split(/\r?\n/);
  let bestStart = -1;
  let bestLen = 0;
  let i = 0;
  while (i < lines.length) {
    if (lines[i].includes(",") && lines[i].split(",").length >= 2) {
      let j = i;
      while (j < lines.length && lines[j].includes(",") && lines[j].split(",").length >= 2) j++;
      if (j - i > bestLen) { bestLen = j - i; bestStart = i; }
      i = j;
    } else { i++; }
  }
  if (bestStart >= 0 && bestLen >= 3) {
    const slice = lines.slice(bestStart, bestStart + bestLen).join("\n");
    return { rows: parseCsv(slice), source: "csv-fence", sheetName: "Data" };
  }

  return { rows: [], source: "none" };
}

// Minimal CSV parser. Handles quoted fields, embedded commas, escaped quotes.
function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = input.replace(/^\s+|\s+$/g, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === "\r") { /* skip */ }
      else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(cell => cell !== ""));
}

function findMarkdownTable(text: string): string[][] | null {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length - 1; i++) {
    const header = lines[i];
    const sep = lines[i + 1];
    if (
      /^\s*\|.+\|\s*$/.test(header) &&
      /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(sep)
    ) {
      const splitMd = (s: string) => s.replace(/^\s*\||\|\s*$/g, "").split("|").map(c => c.trim());
      const rows: string[][] = [splitMd(header)];
      let j = i + 2;
      while (j < lines.length && /^\s*\|.+\|\s*$/.test(lines[j])) {
        rows.push(splitMd(lines[j]));
        j++;
      }
      if (rows.length >= 2) return rows;
    }
  }
  return null;
}
