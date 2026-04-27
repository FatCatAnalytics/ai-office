// ─── Stage 4.15 — Deliverable Manifest ───────────────────────────────────────
// Structured contract that research agents emit so that one model output can
// be deterministically rendered into Markdown, CSV, Excel, PDF, and JSON
// without per-format prompt hacks.
//
// Why:
//   Stage 4.13 added Tavily tools but the final formatter (doc-specialist)
//   was returning ONE text blob that we then naively wrote to every selected
//   format. Result: a "CSV" file that contained markdown prose, an Excel
//   that was mostly chrome, and truncated reports. Stage 4.15 fixes this by
//   making the agent emit a JSON manifest that the renderer fans out to
//   every requested format with format-appropriate output.
//
// Contract is OPTIONAL — if an agent (e.g. frontend, backend, manager) does
// not emit a manifest, the legacy text-based render path still runs.
// ─────────────────────────────────────────────────────────────────────────────

export interface DeliverableTable {
  /** Sheet name in Excel + section heading in Markdown/PDF. Keep ≤ 31 chars. */
  name: string;
  /** Column headers, in order. */
  columns: string[];
  /** Row values, aligned to columns by index. null for missing cells. */
  rows: (string | number | null)[][];
  /** Optional sub-caption shown under the table heading. */
  caption?: string;
}

export interface DeliverableSource {
  url: string;
  title?: string;
  accessed?: string;
}

export interface DeliverableManifest {
  /** Document title — used as PDF title, Excel workbook title, MD H1. */
  title: string;
  /** Markdown narrative (executive summary, methodology, findings). */
  summary_md: string;
  /** Zero or more tables. Each becomes a sheet in Excel + a section in MD/PDF. */
  tables?: DeliverableTable[];
  /** Source URLs cited in the deliverable. Rendered as a References section. */
  sources?: DeliverableSource[];
}

// ─── Prompt injection ───────────────────────────────────────────────────────
// We append this block to research-agent user prompts so the model knows the
// exact shape to produce. The format-specific instructions are intentionally
// short so we don't blow the context budget on every call.

export const MANIFEST_INSTRUCTIONS = `
## Output Contract (REQUIRED)

You MUST end your response with a single fenced JSON code block matching this shape exactly:

\`\`\`json
{
  "title": "Short document title",
  "summary_md": "Markdown prose with sections. Use ## subheadings, **bold**, lists, and inline source links [Source Name](https://url).",
  "tables": [
    {
      "name": "Sheet Name (≤31 chars)",
      "caption": "Optional one-line description",
      "columns": ["Column 1", "Column 2", "Column 3"],
      "rows": [
        ["row1col1", "row1col2", "row1col3"],
        ["row2col1", "row2col2", "row2col3"]
      ]
    }
  ],
  "sources": [
    { "url": "https://example.com", "title": "Page title", "accessed": "2026-04-27" }
  ]
}
\`\`\`

Rules:
- The JSON must be the LAST thing in your response. You may write reasoning before it, but the renderer only reads the final fenced JSON block.
- All cells in a row must align to the column count. Use null for missing values, never empty string for "unknown".
- Numbers must be JSON numbers, not strings. Currency: include the unit in the column header ("AUM (USD bn)") and put the bare number in the cell.
- Every fact in summary_md and every row in tables must be backed by an entry in sources.
- If a task does not warrant a table (pure prose narrative), omit the "tables" field entirely. Do not produce empty tables.
- DO NOT wrap the JSON in extra markdown. DO NOT emit multiple JSON blocks. ONE block, at the end.
`.trim();

// ─── Parser ─────────────────────────────────────────────────────────────────
// Pulls the LAST fenced JSON block from the response and validates it against
// the manifest shape. Returns null if no valid manifest is present, in which
// case the caller should fall back to legacy text rendering.

export function extractManifest(raw: string): DeliverableManifest | null {
  if (!raw || typeof raw !== "string") return null;

  // Find the last ```json ... ``` (or bare ``` ... ```) block. Research agents
  // are instructed to put it last; we honour that so any earlier scratch JSON
  // they produce while reasoning doesn't shadow the real manifest.
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/g;
  const matches: string[] = [];
  let m;
  while ((m = fenceRegex.exec(raw)) !== null) matches.push(m[1]);

  // Try the matches from last → first; first parseable manifest wins.
  for (let i = matches.length - 1; i >= 0; i--) {
    const parsed = tryParseManifest(matches[i]);
    if (parsed) return parsed;
  }

  // Last resort: scan for the largest balanced { … } in the raw text. Helps
  // when the model forgot the fence but still produced JSON.
  const start = raw.indexOf("{");
  if (start >= 0) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < raw.length; i++) {
      const ch = raw[i];
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const candidate = raw.slice(start, i + 1);
          const parsed = tryParseManifest(candidate);
          if (parsed) return parsed;
        }
      }
    }
  }
  return null;
}

function tryParseManifest(jsonText: string): DeliverableManifest | null {
  let parsed: unknown;
  try { parsed = JSON.parse(jsonText.trim()); } catch { return null; }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.title !== "string" || typeof obj.summary_md !== "string") return null;

  const tables: DeliverableTable[] = [];
  if (Array.isArray(obj.tables)) {
    for (const t of obj.tables) {
      if (!t || typeof t !== "object") continue;
      const tab = t as Record<string, unknown>;
      if (typeof tab.name !== "string") continue;
      if (!Array.isArray(tab.columns)) continue;
      if (!Array.isArray(tab.rows)) continue;
      const columns = (tab.columns as unknown[]).map(String);
      // Coerce row cells to allowed primitive shapes; reject malformed rows.
      const rows: (string | number | null)[][] = [];
      for (const r of tab.rows as unknown[]) {
        if (!Array.isArray(r)) continue;
        const cells: (string | number | null)[] = (r as unknown[]).map(c => {
          if (c === null || c === undefined) return null;
          if (typeof c === "number" || typeof c === "boolean") return c as number;
          return String(c);
        });
        rows.push(cells);
      }
      tables.push({
        name: tab.name.slice(0, 31), // Excel sheet name limit
        caption: typeof tab.caption === "string" ? tab.caption : undefined,
        columns,
        rows,
      });
    }
  }

  const sources: DeliverableSource[] = [];
  if (Array.isArray(obj.sources)) {
    for (const s of obj.sources as unknown[]) {
      if (!s || typeof s !== "object") continue;
      const src = s as Record<string, unknown>;
      if (typeof src.url !== "string") continue;
      sources.push({
        url: src.url,
        title: typeof src.title === "string" ? src.title : undefined,
        accessed: typeof src.accessed === "string" ? src.accessed : undefined,
      });
    }
  }

  return {
    title: obj.title,
    summary_md: obj.summary_md,
    tables: tables.length > 0 ? tables : undefined,
    sources: sources.length > 0 ? sources : undefined,
  };
}

// ─── Format converters ──────────────────────────────────────────────────────

/** Render the manifest to a complete Markdown document. */
export function manifestToMarkdown(m: DeliverableManifest): string {
  const lines: string[] = [];
  lines.push(`# ${m.title}`, "");
  lines.push(m.summary_md.trim(), "");

  for (const t of m.tables ?? []) {
    lines.push(`## ${t.name}`, "");
    if (t.caption) lines.push(`_${t.caption}_`, "");
    if (t.columns.length > 0) {
      lines.push("| " + t.columns.join(" | ") + " |");
      lines.push("|" + t.columns.map(() => "---").join("|") + "|");
      for (const row of t.rows) {
        const padded = t.columns.map((_, i) => formatCellMd(row[i]));
        lines.push("| " + padded.join(" | ") + " |");
      }
      lines.push("");
    }
  }

  if (m.sources && m.sources.length > 0) {
    lines.push("## Sources", "");
    for (const s of m.sources) {
      const label = s.title ?? s.url;
      lines.push(`- [${label}](${s.url})${s.accessed ? ` _(accessed ${s.accessed})_` : ""}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function formatCellMd(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  // Escape pipes inside cells so they don't break the table layout.
  return String(v).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/**
 * Render the manifest to CSV. If the manifest has multiple tables we
 * concatenate them with a blank line + comment header between tables —
 * Excel and most CSV readers treat them as a single sheet still.
 */
export function manifestToCsv(m: DeliverableManifest): string {
  const tables = m.tables ?? [];
  if (tables.length === 0) {
    // No tables → emit a single-column CSV of the prose so the .csv at least
    // contains the deliverable text rather than being empty.
    const lines = m.summary_md.split(/\r?\n/);
    return ["content", ...lines.map(csvEscape)].join("\n");
  }

  const out: string[] = [];
  for (let i = 0; i < tables.length; i++) {
    const t = tables[i];
    if (i > 0) out.push(""); // blank line between tables
    out.push(`# ${t.name}${t.caption ? ` — ${t.caption}` : ""}`);
    out.push(t.columns.map(csvEscape).join(","));
    for (const row of t.rows) {
      out.push(t.columns.map((_, idx) => csvEscape(row[idx])).join(","));
    }
  }
  return out.join("\n");
}

function csvEscape(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/** Render the manifest as a JSON string for the .json output format. */
export function manifestToJson(m: DeliverableManifest): string {
  return JSON.stringify(m, null, 2);
}
