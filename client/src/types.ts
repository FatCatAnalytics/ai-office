export interface Agent {
  id: string;
  name: string;
  role: string;
  spriteType: string;
  provider: string;
  modelId: string;
  systemPrompt: string;
  capabilities: string; // JSON string of string[]
  reportsTo: string | null;
  status: "idle" | "working" | "thinking" | "blocked" | "done";
  currentTask: string | null;
  color: string;
  icon: string;
  createdAt: number;
}

// Backward compat — AgentState = Agent
export type AgentState = Agent;

export interface AgentEvent {
  id: number;
  projectId: number;
  agentId: string;
  agentName: string;
  action: string;
  detail: string;
  status: "info" | "success" | "warning" | "error";
  timestamp: number;
}

export interface Project {
  id: number;
  name: string;
  description: string;
  priority: string;
  status: string;
  progress: number;
  deadline: number | null;
  tasksTotal: number;
  tasksCompleted: number;
  tokensUsed: number;
  costToday: number;
  avgResponseTime: number;
  createdAt: number;
}

export interface Task {
  id: number;
  title: string;
  description: string;
  projectId: number;
  assignedTo: string;
  assignedBy: string;
  status: "todo" | "in_progress" | "blocked" | "done";
  priority: "critical" | "high" | "normal" | "low";
  deadline: number | null;
  blockedReason: string | null;
  createdAt: number;
  updatedAt: number;
}

export const MODEL_CATALOG: Record<string, { label: string; models: string[] }> = {
  anthropic: {
    label: "Anthropic",
    models: ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-3-5"],
  },
  openai: {
    label: "OpenAI",
    models: ["gpt-4o", "gpt-4o-mini", "o3", "o1"],
  },
  google: {
    label: "Google",
    models: ["gemini-2.5-pro", "gemini-2.0-flash"],
  },
  kimi: {
    label: "Kimi (Moonshot)",
    models: ["moonshot-v1-128k"],
  },
};

export const SPRITE_TYPES = [
  "manager", "frontend", "backend", "qa", "uiux", "devops",
  "dbarchitect", "datascientist", "secengineer", "pm",
];

export const PROVIDER_COLORS: Record<string, string> = {
  anthropic: "#c07b4a",
  openai: "#10a37f",
  google: "#4285f4",
  kimi: "#7c3aed",
};
