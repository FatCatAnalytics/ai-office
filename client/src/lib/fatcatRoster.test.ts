import { describe, it, expect } from "vitest";
import {
  classifyWorkflow,
  buildRoster,
  mapAgentStatus,
  workflowLabel,
  archetypeColor,
  isActiveStatus,
  type RosterContext,
} from "./fatcatRoster";
import type { Agent, Project } from "../types";

function mkProject(p: Partial<Project>): Project {
  return {
    id: 1,
    name: "",
    description: "",
    priority: "normal",
    status: "active",
    progress: 0,
    deadline: null,
    outputFormats: "[]",
    tasksTotal: 0,
    tasksCompleted: 0,
    tokensUsed: 0,
    costToday: 0,
    avgResponseTime: 0,
    createdAt: 0,
    ...p,
  };
}

function mkAgent(p: Partial<Agent>): Agent {
  return {
    id: "a1",
    name: "Agent",
    role: "Agent",
    spriteType: "manager",
    provider: "anthropic",
    modelId: "claude-opus-4-7",
    systemPrompt: "",
    capabilities: "[]",
    reportsTo: null,
    status: "idle",
    currentTask: null,
    color: "#6366f1",
    icon: "Crown",
    createdAt: 0,
    ...p,
  };
}

describe("classifyWorkflow", () => {
  it("classifies The Analytical Banker", () => {
    expect(classifyWorkflow({ name: "Weekly Analytical Banker" })).toBe("analytical-banker");
    expect(classifyWorkflow({ templateName: "The Analytical Banker" })).toBe("analytical-banker");
  });

  it("classifies SME Analytics (and not as banker)", () => {
    expect(classifyWorkflow({ name: "Weekly SME Analytics" })).toBe("sme-analytics");
    expect(classifyWorkflow({ name: "SME Analytics Report" })).toBe("sme-analytics");
    expect(classifyWorkflow({ templateName: "SME-Analytics Weekly" })).toBe("sme-analytics");
  });

  it("classifies Startup Due Diligence", () => {
    expect(classifyWorkflow({ name: "Startup Due Diligence — Acme" })).toBe("startup-due-diligence");
    expect(classifyWorkflow({ name: "Seed-stage diligence on Foo" })).toBe("startup-due-diligence");
    expect(classifyWorkflow({ description: "Due diligence on a startup target" })).toBe("startup-due-diligence");
  });

  it("classifies Public Company Thesis Review", () => {
    expect(classifyWorkflow({ name: "Public Company Thesis Review: NVDA" })).toBe("public-company-thesis");
    expect(classifyWorkflow({ name: "Thesis Review — listed equity" })).toBe("public-company-thesis");
  });

  it("falls back to generic for unknown", () => {
    expect(classifyWorkflow({ name: "Build a mobile app" })).toBe("generic");
    expect(classifyWorkflow({})).toBe("generic");
  });
});

describe("buildRoster — plan shapes", () => {
  const empty = (project: Project | null, templateName?: string): RosterContext => ({
    project,
    agents: [],
    templateName,
  });

  it("Analytical Banker shows research/editor/writer/QA/fact-check/publishing", () => {
    const roster = buildRoster(empty(mkProject({ name: "Weekly Analytical Banker" })));
    const archetypes = roster.map((r) => r.archetype);
    expect(archetypes[0]).toBe("manager");
    expect(archetypes).toEqual(
      expect.arrayContaining(["research", "editor", "writer", "qa", "factcheck", "publish"]),
    );
  });

  it("SME Analytics shows the editorial roster", () => {
    const roster = buildRoster(empty(mkProject({ name: "Weekly SME Analytics" })));
    expect(roster[0].archetype).toBe("manager");
    expect(roster.map((r) => r.archetype)).toEqual(
      expect.arrayContaining(["research", "editor", "writer", "qa", "factcheck", "publish"]),
    );
  });

  it("Startup Due Diligence shows diligence/source/financial/risk/market/memo/CIO", () => {
    const roster = buildRoster(empty(mkProject({ name: "Startup Due Diligence — Acme" })));
    expect(roster[0].archetype).toBe("manager");
    expect(roster.map((r) => r.archetype)).toEqual(
      expect.arrayContaining(["diligence", "sourceverify", "financial", "risk", "market", "memo", "cio"]),
    );
  });

  it("Public Company Thesis Review shows thesis/valuation/contrarian/source/risk/memo/CIO", () => {
    const roster = buildRoster(empty(mkProject({ name: "Public Company Thesis Review: NVDA" })));
    expect(roster[0].archetype).toBe("manager");
    expect(roster.map((r) => r.archetype)).toEqual(
      expect.arrayContaining(["research", "valuation", "contrarian", "sourceverify", "risk", "memo", "cio"]),
    );
  });

  it("generic project shows manager/research/writer/analyst/QA/engineer", () => {
    const roster = buildRoster(empty(mkProject({ name: "Build a mobile app" })));
    expect(roster.map((r) => r.archetype)).toEqual(
      ["manager", "research", "writer", "analyst", "qa", "engineer"],
    );
  });

  it("manager is always central (first slot)", () => {
    for (const name of [
      "Weekly Analytical Banker",
      "Weekly SME Analytics",
      "Startup Due Diligence",
      "Public Company Thesis Review",
      "Random project",
    ]) {
      expect(buildRoster(empty(mkProject({ name })))[0].archetype).toBe("manager");
    }
  });

  it("returns a roster even with no project", () => {
    const roster = buildRoster(empty(null));
    expect(roster.length).toBeGreaterThan(0);
    expect(roster[0].archetype).toBe("manager");
  });

  it("every slot has a colour", () => {
    const roster = buildRoster(empty(mkProject({ name: "Startup Due Diligence" })));
    for (const slot of roster) {
      expect(slot.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(archetypeColor(slot.archetype)).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe("buildRoster — live agent matching", () => {
  it("binds a live research agent onto the research slot with its status/task", () => {
    const agents: Agent[] = [
      mkAgent({ id: "mgr", name: "Boss Cat", role: "Manager", spriteType: "manager", status: "working" }),
      mkAgent({ id: "res", name: "Scout Cat", role: "Researcher", spriteType: "datascientist", status: "thinking", currentTask: "Deep search" }),
    ];
    const roster = buildRoster({ project: mkProject({ name: "Weekly Analytical Banker" }), agents });
    const research = roster.find((r) => r.archetype === "research")!;
    expect(research.live).toBe(true);
    expect(research.name).toBe("Scout Cat");
    expect(research.status).toBe("verifying"); // thinking -> verifying
    expect(research.task).toBe("Deep search");
    expect(research.agent?.id).toBe("res");
  });

  it("fills unmatched slots with derived (non-live) FatCats", () => {
    const roster = buildRoster({ project: mkProject({ name: "Startup Due Diligence" }), agents: [] });
    expect(roster.every((r) => !r.live)).toBe(true);
    // CIO archetype now uses the pun-name "CIO Whiskerstone" from ARCHETYPE_FALLBACK_NAME
    expect(roster.find((r) => r.archetype === "cio")?.name).toBe("CIO Whiskerstone");
  });

  it("derives a working frontier from project progress when no live agents", () => {
    const roster = buildRoster({
      project: mkProject({ name: "Startup Due Diligence", status: "active", progress: 50 }),
      agents: [],
    });
    expect(roster.some((r) => r.status === "complete")).toBe(true);
    expect(roster.some((r) => r.status === "working" || r.status === "verifying")).toBe(true);
  });

  it("marks all slots complete when project is completed", () => {
    const roster = buildRoster({
      project: mkProject({ name: "Generic", status: "completed", progress: 100 }),
      agents: [],
    });
    expect(roster.every((r) => r.status === "complete")).toBe(true);
  });

  it("two same-archetype agents claim slots deterministically (stable by id)", () => {
    const agents: Agent[] = [
      mkAgent({ id: "z-res", name: "Zed", role: "Researcher", spriteType: "datascientist" }),
      mkAgent({ id: "a-res", name: "Ann", role: "Researcher", spriteType: "datascientist" }),
    ];
    const r1 = buildRoster({ project: mkProject({ name: "Generic" }), agents });
    const r2 = buildRoster({ project: mkProject({ name: "Generic" }), agents: [...agents].reverse() });
    expect(r1.find((s) => s.archetype === "research")?.name).toBe("Ann");
    expect(r2.find((s) => s.archetype === "research")?.name).toBe("Ann");
  });
});

describe("helpers", () => {
  it("mapAgentStatus maps live statuses", () => {
    expect(mapAgentStatus("working")).toBe("working");
    expect(mapAgentStatus("thinking")).toBe("verifying");
    expect(mapAgentStatus("blocked")).toBe("blocked");
    expect(mapAgentStatus("done")).toBe("complete");
    expect(mapAgentStatus("idle")).toBe("idle");
  });

  it("workflowLabel returns readable names", () => {
    expect(workflowLabel("analytical-banker")).toMatch(/Analytical Banker/);
    expect(workflowLabel("generic")).toBeTruthy();
  });

  it("isActiveStatus only treats live work states as active", () => {
    // Live states earn a persistent (quiet) overlay marker.
    expect(isActiveStatus("working")).toBe(true);
    expect(isActiveStatus("verifying")).toBe(true);
    expect(isActiveStatus("blocked")).toBe(true);
    // Waiting/idle and settled/complete must stay visually quiet by default.
    expect(isActiveStatus("idle")).toBe(false);
    expect(isActiveStatus("complete")).toBe(false);
  });
});
