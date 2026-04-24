import { useEffect, useRef, useCallback, useState } from "react";
import type { AgentState, AgentEvent, Project } from "../types";

type WSMessage =
  | { type: "init"; agents: AgentState[] }
  | { type: "event"; event: AgentEvent }
  | { type: "agent_update"; agentId: string; status: string; currentTask: string | null }
  | { type: "new_project"; project: Project }
  | { type: "project_init"; project: Project }
  | { type: "project_update"; projectId: number; status?: string; progress?: number; tasksCompleted?: number };

interface UseWebSocketReturn {
  agents: AgentState[];
  events: AgentEvent[];
  project: Project | null;
  connected: boolean;
}

// Resolve the API base the same way queryClient.ts does:
// In deployed pplx.app, __PORT_5000__ is replaced with the proxy base URL.
// In dev (localhost), it stays empty string (relative paths).
const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

function getWsUrl(): string {
  if (API_BASE) {
    // Deployed: API_BASE is like "https://sites.pplx.app/sites/proxy/.../port/5000"
    // Convert https → wss (or http → ws) and append /ws
    return API_BASE.replace(/^http/, "ws") + "/ws";
  }
  // Local dev: connect to the same host on the same port
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

export function useWebSocket(): UseWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [agents, setAgents] = useState<AgentState[]>([]);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [connected, setConnected] = useState(false);

  // Load initial agent state via HTTP on mount (works even before WS connects)
  useEffect(() => {
    fetch(`${API_BASE}/api/agents`)
      .then((r) => r.json())
      .then((data: AgentState[]) => {
        if (Array.isArray(data) && data.length > 0) {
          setAgents(data);
        }
      })
      .catch(() => {});

    // Also load most recent project if any
    fetch(`${API_BASE}/api/projects`)
      .then((r) => r.json())
      .then((data: Project[]) => {
        if (Array.isArray(data) && data.length > 0) {
          const latest = data[data.length - 1];
          setProject(latest);
          // Load its events
          return fetch(`${API_BASE}/api/projects/${latest.id}/events`);
        }
      })
      .then((r) => r?.json())
      .then((evts: AgentEvent[] | undefined) => {
        if (Array.isArray(evts)) {
          setEvents(evts); // already desc ordered from API
        }
      })
      .catch(() => {});
  }, []);

  const connect = useCallback(() => {
    // Clear any pending reconnect
    if (reconnectRef.current) clearTimeout(reconnectRef.current);

    const wsUrl = getWsUrl();
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      // Can't construct WS (e.g. invalid URL in some environments), retry later
      reconnectRef.current = setTimeout(connect, 5000);
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);

    ws.onclose = () => {
      setConnected(false);
      reconnectRef.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      // onerror always fires before onclose, let onclose handle reconnect
    };

    ws.onmessage = (e) => {
      try {
        const msg: WSMessage = JSON.parse(e.data);
        switch (msg.type) {
          case "init":
            setAgents(msg.agents);
            break;
          case "event":
            setEvents((prev) => [msg.event, ...prev].slice(0, 100));
            break;
          case "agent_update":
            setAgents((prev) =>
              prev.map((a) =>
                a.id === msg.agentId
                  ? { ...a, status: msg.status as AgentState["status"], currentTask: msg.currentTask }
                  : a
              )
            );
            break;
          case "new_project":
          case "project_init":
            setProject(msg.project);
            setEvents([]);
            break;
          case "project_update":
            setProject((prev) => {
              if (!prev || prev.id !== msg.projectId) return prev;
              return {
                ...prev,
                ...(msg.status && { status: msg.status }),
                ...(msg.progress !== undefined && { progress: msg.progress }),
                ...(msg.tasksCompleted !== undefined && { tasksCompleted: msg.tasksCompleted }),
              };
            });
            break;
        }
      } catch {}
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { agents, events, project, connected };
}
