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
  outputFormats: string; // JSON array string e.g. '["pdf","csv"]'
  tasksTotal: number;
  tasksCompleted: number;
  tokensUsed: number;
  costToday: number;
  avgResponseTime: number;
  createdAt: number;
}

export interface ProjectFile {
  id: number;
  projectId: number;
  taskId: number | null;
  agentId: string;
  filename: string;
  fileType: string;
  mimeType: string;
  sizeBytes: number;
  filePath: string;
  description: string;
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
  /** JSON-encoded array of task IDs (or planner-local keys) this task depends on. */
  dependsOn?: string;
  /** 0-based wave index assigned by the topological sort. null while planning. */
  waveIndex?: number | null;
  createdAt: number;
  updatedAt: number;
}

export const MODEL_CATALOG: Record<string, { label: string; models: string[] }> = {
  anthropic: {
    label: "Anthropic",
    models: [
      "claude-opus-4-7",   // latest flagship
      "claude-sonnet-4-6", // latest balanced
      "claude-haiku-3-5",  // fast + cheap
    ],
  },
  openai: {
    label: "OpenAI",
    models: [
      "gpt-4.1",       // latest GPT-4 class
      "gpt-4.1-mini",  // cost-efficient
      "o4-mini",       // fast reasoning
      "o3",            // advanced reasoning
    ],
  },
  google: {
    label: "Google",
    models: [
      "gemini-2.5-pro",    // flagship
      "gemini-2.5-flash",  // fast + cheap
      "gemini-2.0-flash",  // stable
    ],
  },
  kimi: {
    label: "Kimi (Moonshot)",
    models: [
      "moonshot-v1-128k",
      "moonshot-v1-32k",
    ],
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
