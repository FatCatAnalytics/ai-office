export interface AgentState {
  id: string;
  name: string;
  role: string;
  status: "idle" | "working" | "thinking" | "blocked" | "done";
  currentTask: string | null;
  color: string;
  icon: string;
}

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
  status: string;
  progress: number;
  tasksTotal: number;
  tasksCompleted: number;
  tokensUsed: number;
  costToday: number;
  avgResponseTime: number;
}
