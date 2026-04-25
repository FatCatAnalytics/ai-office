import { useState, useEffect, useRef, useCallback } from "react";
import type { Agent, AgentEvent, Project, Task } from "../types";

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

  return { agents, events, project, tasks, connected };
}
