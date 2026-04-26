import { useState, useEffect, useRef, useCallback } from "react";
import type { Agent, AgentEvent, Project, Task } from "../types";

// Live streaming state per agent. Cleared when the task completes.
export interface LiveStream {
  agentId: string;
  agentName: string;
  taskTitle: string;
  text: string;
  updatedAt: number;
}

function getWsUrl() {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host;
  const raw = `${proto}//${host}/ws`;
  // __PORT_5000__ replacement happens at deploy time via deploy_website
  return raw.replace("__PORT_5000__", window.location.host);
}

export function useWebSocket() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [connected, setConnected] = useState(false);
  const [agentMode, setAgentMode] = useState<"simulation" | "live">("simulation");
  const [liveStreams, setLiveStreams] = useState<Record<string, LiveStream>>({});
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<NodeJS.Timeout | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(getWsUrl());
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        reconnectRef.current = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws.close();

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);

          switch (msg.type) {
            case "init":
              if (msg.agents) setAgents(msg.agents);
              break;

            case "project_init":
              if (msg.project) setProject(msg.project);
              if (msg.tasks) setTasks(msg.tasks);
              if (msg.events) setEvents(msg.events.slice().reverse());
              break;

            case "new_project":
              setProject(msg.project);
              setTasks([]);
              setEvents([]);
              break;

            case "project_update":
              setProject((prev) => prev ? { ...prev, ...msg } : prev);
              // Notify any list views that a project changed.
              window.dispatchEvent(new CustomEvent("aioffice:project_update", { detail: msg }));
              break;

            case "project_deleted":
              setProject((prev) => prev && prev.id === msg.projectId ? null : prev);
              setTasks((prev) => prev.filter(t => t.projectId !== msg.projectId));
              window.dispatchEvent(new CustomEvent("aioffice:project_deleted", { detail: msg }));
              break;

            case "agent_update":
              setAgents((prev) =>
                prev.map((a) =>
                  a.id === msg.agentId
                    ? { ...a, status: msg.status, currentTask: msg.currentTask ?? null }
                    : a
                )
              );
              break;

            case "agent_created":
              setAgents((prev) => {
                if (prev.find((a) => a.id === msg.agent.id)) return prev;
                return [...prev, msg.agent];
              });
              break;

            case "agent_updated":
              setAgents((prev) => prev.map((a) => a.id === msg.agent.id ? { ...a, ...msg.agent } : a));
              break;

            case "agent_deleted":
              setAgents((prev) => prev.filter((a) => a.id !== msg.agentId));
              break;

            case "event":
              setEvents((prev) => [msg.event, ...prev].slice(0, 200));
              break;

            case "task_created":
              setTasks((prev) => [...prev, msg.task]);
              break;

            case "task_update":
              setTasks((prev) =>
                prev.map((t) => (t.id === msg.task.id ? { ...t, ...msg.task } : t))
              );
              break;

            case "mode_update":
              if (msg.agentMode === "simulation" || msg.agentMode === "live") {
                setAgentMode(msg.agentMode);
              }
              break;

            // file_created — handled by FilesPage via its own polling/query invalidation
            // We emit a custom event so any mounted FileList component can react
            case "file_created":
              window.dispatchEvent(new CustomEvent("aioffice:file_created", { detail: msg }));
              break;

            // budget_update — fan out to BudgetPage which can re-fetch on demand
            case "budget_update":
              window.dispatchEvent(new CustomEvent("aioffice:budget_update", { detail: msg }));
              break;

            // QA sign-off verdict broadcast at the end of a project
            case "qa_review":
              window.dispatchEvent(new CustomEvent("aioffice:qa_review", { detail: msg }));
              break;

            // Daily/manual model registry refresh completed
            case "models_refreshed":
              window.dispatchEvent(new CustomEvent("aioffice:models_refreshed", { detail: msg }));
              break;

            // Live token streaming — accumulate per-agent buffer for the activity feed
            case "stream":
              if (msg.agentId && typeof msg.delta === "string") {
                setLiveStreams((prev) => {
                  const existing = prev[msg.agentId];
                  // If the task changed, reset the buffer
                  if (!existing || existing.taskTitle !== msg.taskTitle) {
                    return {
                      ...prev,
                      [msg.agentId]: {
                        agentId: msg.agentId,
                        agentName: msg.agentName ?? msg.agentId,
                        taskTitle: msg.taskTitle ?? "",
                        text: msg.delta,
                        updatedAt: Date.now(),
                      },
                    };
                  }
                  return {
                    ...prev,
                    [msg.agentId]: {
                      ...existing,
                      text: existing.text + msg.delta,
                      updatedAt: Date.now(),
                    },
                  };
                });
              }
              break;
          }
        } catch {
          // ignore parse errors
        }
      };
    } catch {
      reconnectRef.current = setTimeout(connect, 3000);
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      reconnectRef.current && clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  // Auto-clear stale streams once an agent goes idle/done
  useEffect(() => {
    setLiveStreams((prev) => {
      let changed = false;
      const next: Record<string, LiveStream> = {};
      for (const [agentId, stream] of Object.entries(prev)) {
        const agent = agents.find((a) => a.id === agentId);
        // Drop the buffer once the agent goes back to idle/done so the next task
        // starts with a clean slate. Also drop anything older than 60s with no agent activity.
        if (!agent || agent.status === "idle" || agent.status === "done") {
          changed = true;
          continue;
        }
        if (Date.now() - stream.updatedAt > 60_000) {
          changed = true;
          continue;
        }
        next[agentId] = stream;
      }
      return changed ? next : prev;
    });
  }, [agents]);

  return { agents, events, project, tasks, connected, agentMode, setAgentMode, liveStreams };
}
