// Stage 6.15.1 — unit tests for the live workflow panels.
//
// We test the pure data-shape helpers (classifyPhase, bucketTasks, buildStream,
// formatRelative, statusToPercent) and source-shape contracts for the two
// panel components, matching the convention used for MissionControlCanvas.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import type { Task, Agent } from "../../types";
import {
  classifyPhase, bucketTasks, WORKFLOW_PHASES,
} from "./WorkflowOverviewPanel";
import {
  buildStream, formatRelative, statusToPercent,
} from "./TaskStreamPanel";

const here = dirname(fileURLToPath(import.meta.url));
const WF_PANEL = resolve(here, "WorkflowOverviewPanel.tsx");
const TS_PANEL = resolve(here, "TaskStreamPanel.tsx");
const read = (p: string) => readFileSync(p, "utf-8");

// ─── Test fixture ────────────────────────────────────────────────────────────
function mkTask(overrides: Partial<Task>): Task {
  return {
    id: 1,
    title: "Task",
    description: "",
    projectId: 1,
    assignedTo: "manager",
    assignedBy: "manager",
    status: "todo",
    priority: "normal",
    deadline: null,
    blockedReason: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

// ─── classifyPhase ───────────────────────────────────────────────────────────

describe("WorkflowOverviewPanel — classifyPhase", () => {
  it("maps 'analyze' / 'research' / 'gather' to ANALYZE", () => {
    expect(classifyPhase({ title: "Analyze trends", description: "" })).toBe("analyze");
    expect(classifyPhase({ title: "Research the market", description: "" })).toBe("analyze");
    expect(classifyPhase({ title: "Gather competitive data", description: "" })).toBe("analyze");
  });

  it("maps 'verify' / 'validate' / 'fact-check' / 'test' to VERIFY", () => {
    expect(classifyPhase({ title: "Verify sources", description: "" })).toBe("verify");
    expect(classifyPhase({ title: "Validate the data", description: "" })).toBe("verify");
    expect(classifyPhase({ title: "Fact-check claims", description: "" })).toBe("verify");
    // "test" / "tests" is QA work — must classify as VERIFY (regression: previously
    // matched `write` in the description and bled into SYNTHESIZE).
    expect(classifyPhase({
      title: "QA & integration tests",
      description: "Write unit tests, integration tests and E2E test suite.",
    })).toBe("verify");
  });

  it("maps 'synthesize' / 'summarize' / 'draft' to SYNTHESIZE", () => {
    expect(classifyPhase({ title: "Synthesize findings", description: "" })).toBe("synthesize");
    expect(classifyPhase({ title: "Summarize report", description: "" })).toBe("synthesize");
    expect(classifyPhase({ title: "Draft email", description: "" })).toBe("synthesize");
  });

  it("maps 'deliver' / 'publish' / 'export' to DELIVER", () => {
    expect(classifyPhase({ title: "Deliver report", description: "" })).toBe("deliver");
    expect(classifyPhase({ title: "Publish results", description: "" })).toBe("deliver");
    expect(classifyPhase({ title: "Export PDF", description: "" })).toBe("deliver");
  });

  it("falls back to INTAKE for unclassifiable tasks", () => {
    expect(classifyPhase({ title: "Set up project", description: "" })).toBe("intake");
    expect(classifyPhase({ title: "", description: "" })).toBe("intake");
  });

  it("prefers DELIVER over earlier phases (deliver beats analyze)", () => {
    // A task to 'deliver an analyzed summary' should be DELIVER, not ANALYZE.
    expect(
      classifyPhase({ title: "Deliver an analyzed summary", description: "" })
    ).toBe("deliver");
  });

  it("matches against title AND description (case-insensitive)", () => {
    expect(
      classifyPhase({ title: "Q3 review", description: "VERIFY all numbers against ledger" })
    ).toBe("verify");
  });
});

// ─── bucketTasks ─────────────────────────────────────────────────────────────

describe("WorkflowOverviewPanel — bucketTasks", () => {
  it("counts done / active / queued / blocked separately", () => {
    const tasks: Task[] = [
      mkTask({ id: 1, title: "Analyze trends", status: "in_progress" }),
      mkTask({ id: 2, title: "Analyze the market", status: "done" }),
      mkTask({ id: 3, title: "Verify claims", status: "todo" }),
      mkTask({ id: 4, title: "Verify data", status: "blocked" }),
      mkTask({ id: 5, title: "Deliver pdf", status: "done" }),
    ];
    const { byPhase, totals } = bucketTasks(tasks);
    expect(totals.active).toBe(1);
    expect(totals.done).toBe(2);
    expect(totals.queued).toBe(1);
    expect(totals.blocked).toBe(1);
    expect(byPhase.analyze).toEqual({ total: 2, done: 1, active: 1 });
    expect(byPhase.verify).toEqual({ total: 2, done: 0, active: 0 });
    expect(byPhase.deliver).toEqual({ total: 1, done: 1, active: 0 });
    expect(byPhase.synthesize).toEqual({ total: 0, done: 0, active: 0 });
    expect(byPhase.intake).toEqual({ total: 0, done: 0, active: 0 });
  });

  it("returns zero counts for empty input without crashing", () => {
    const { byPhase, totals } = bucketTasks([]);
    expect(totals).toEqual({ active: 0, queued: 0, done: 0, blocked: 0 });
    for (const p of WORKFLOW_PHASES) {
      expect(byPhase[p.key]).toEqual({ total: 0, done: 0, active: 0 });
    }
  });
});

// ─── statusToPercent ─────────────────────────────────────────────────────────

describe("TaskStreamPanel — statusToPercent", () => {
  it("done = 100, in_progress = 60, blocked = 30, todo = 0", () => {
    expect(statusToPercent("done")).toBe(100);
    expect(statusToPercent("in_progress")).toBe(60);
    expect(statusToPercent("blocked")).toBe(30);
    expect(statusToPercent("todo")).toBe(0);
  });
});

// ─── formatRelative ──────────────────────────────────────────────────────────

describe("TaskStreamPanel — formatRelative", () => {
  const NOW = 1_700_000_000_000;
  it("formats seconds / minutes / hours / days", () => {
    expect(formatRelative(NOW - 5_000, NOW)).toBe("5s ago");
    expect(formatRelative(NOW - 90_000, NOW)).toBe("1m ago");
    expect(formatRelative(NOW - 60 * 60 * 1000 * 3, NOW)).toBe("3h ago");
    expect(formatRelative(NOW - 60 * 60 * 1000 * 25, NOW)).toBe("1d ago");
  });
  it("clamps negative diffs to 0s", () => {
    expect(formatRelative(NOW + 5_000, NOW)).toBe("0s ago");
  });
});

// ─── buildStream ─────────────────────────────────────────────────────────────

describe("TaskStreamPanel — buildStream", () => {
  it("returns at most `limit` rows, sorted by updatedAt desc", () => {
    const tasks: Task[] = [
      mkTask({ id: 1, title: "old",   updatedAt: 1000 }),
      mkTask({ id: 2, title: "newer", updatedAt: 3000 }),
      mkTask({ id: 3, title: "mid",   updatedAt: 2000 }),
      mkTask({ id: 4, title: "newest",updatedAt: 4000 }),
    ];
    const out = buildStream(tasks, 3);
    expect(out.map((r) => r.id)).toEqual([4, 2, 3]);
    expect(out.map((r) => r.title)).toEqual(["newest", "newer", "mid"]);
  });

  it("each row carries phase + percent + agentId + updatedAt", () => {
    const t = mkTask({
      id: 9,
      title: "Verify the financials",
      assignedTo: "qa",
      status: "in_progress",
      updatedAt: 9_999,
    });
    const [row] = buildStream([t]);
    expect(row).toEqual({
      id: 9,
      title: "Verify the financials",
      phase: "verify",
      status: "in_progress",
      percent: 60,
      agentId: "qa",
      updatedAt: 9_999,
    });
  });

  it("does not mutate the source array", () => {
    const tasks: Task[] = [
      mkTask({ id: 1, updatedAt: 1 }),
      mkTask({ id: 2, updatedAt: 2 }),
    ];
    const before = tasks.map((t) => t.id);
    buildStream(tasks);
    expect(tasks.map((t) => t.id)).toEqual(before);
  });
});

// ─── Source-shape tests (match the MissionControlCanvas convention) ──────────

describe("WorkflowOverviewPanel — source shape", () => {
  it("exports WORKFLOW_PHASES with all five phase keys in order", () => {
    expect(WORKFLOW_PHASES.map((p) => p.key)).toEqual([
      "intake", "analyze", "verify", "synthesize", "deliver",
    ]);
  });

  it("renders a 'LIVE TASK FLOW' header inside the panel", () => {
    const src = read(WF_PANEL);
    expect(src).toMatch(/LIVE TASK FLOW/);
  });

  it("renders a phase row per WORKFLOW_PHASES entry (data-fc-phase attr)", () => {
    const src = read(WF_PANEL);
    expect(src).toMatch(/data-fc-phase=\{key\}/);
    expect(src).toMatch(/WORKFLOW_PHASES\.map/);
  });

  it("uses transparent background so the painted panel chrome shows through", () => {
    const src = read(WF_PANEL);
    expect(src).toMatch(/background:\s*"transparent"/);
  });

  it("renders an SVG mini-graph (LiveFlowGraph) of the 5 phase nodes", () => {
    const src = read(WF_PANEL);
    expect(src).toMatch(/function LiveFlowGraph/);
    expect(src).toMatch(/<svg/);
  });
});

describe("TaskStreamPanel — source shape", () => {
  it("imports phase classifier + WORKFLOW_PHASES from the workflow panel module", () => {
    const src = read(TS_PANEL);
    expect(src).toMatch(/import \{ classifyPhase[\s\S]*from\s+"\.\/WorkflowOverviewPanel"/);
  });

  it("uses transparent background so the painted panel chrome shows through", () => {
    const src = read(TS_PANEL);
    expect(src).toMatch(/background:\s*"transparent"/);
  });

  it("renders a verb chip + agent name + progress bar + relative time per row", () => {
    const src = read(TS_PANEL);
    expect(src).toMatch(/data-fc-task-row=\{r\.id\}/);
    expect(src).toMatch(/formatRelative\(r\.updatedAt, now\)/);
    expect(src).toMatch(/agentName\(r\.agentId\)/);
  });

  it("accepts a `nowMs` override for deterministic tests", () => {
    const src = read(TS_PANEL);
    expect(src).toMatch(/nowMs\?\: number/);
    expect(src).toMatch(/nowMs \?\? Date\.now\(\)/);
  });

  it("displays an empty-state message when there are no tasks", () => {
    const src = read(TS_PANEL);
    expect(src).toMatch(/NO ACTIVE TASKS/);
  });
});

// Mark `Agent` as referenced so the import isn't pruned by the type checker.
type _AgentTouch = Agent;
