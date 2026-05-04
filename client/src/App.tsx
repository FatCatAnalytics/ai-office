import { useState } from "react";
import { Router, Switch, Route } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import OfficeDashboard from "./pages/OfficeDashboard";
import AgentsPage from "./pages/AgentsPage";
import TaskBoardPage from "./pages/TaskBoardPage";
import SettingsPage from "./pages/SettingsPage";
import BudgetPage from "./pages/BudgetPage";
import FilesPage from "./pages/FilesPage";
import ProjectsPage from "./pages/ProjectsPage";
import TemplatesPage from "./pages/TemplatesPage";
import FailoverModal from "./components/FailoverModal";
import { useWebSocket } from "./hooks/useWebSocket";
import {
  LayoutDashboard, Users, LayoutGrid, Settings, Send, DollarSign, FolderOpen,
  Wifi, WifiOff, Folders, LogOut, CalendarClock,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import type { Project } from "./types";

// ─── Shared shell around all routes ──────────────────────────────────────────
function AppShell() {
  const { agents, events, project, tasks, connected, agentMode, setAgentMode, liveStreams } = useWebSocket();
  const [showModal, setShowModal] = useState(false);
  const [location] = useLocation();

  // All projects list (for Files page project selector)
  const { data: allProjects = [] } = useQuery<Project[]>({
    queryKey: ["/api/projects"],
    queryFn: () => apiRequest("GET", "/api/projects").then(r => r.json()),
    refetchInterval: 15000,
  });

  const navItems = [
    { href: "/", icon: LayoutDashboard, label: "Office Floor" },
    { href: "/projects", icon: Folders, label: "Projects" },
    { href: "/templates", icon: CalendarClock, label: "Templates" },
    { href: "/board", icon: LayoutGrid, label: "Task Board" },
    { href: "/agents", icon: Users, label: "Agents" },
    { href: "/files", icon: FolderOpen, label: "Files" },
    { href: "/budget", icon: DollarSign, label: "Budget" },
    { href: "/settings", icon: Settings, label: "Settings" },
  ];

  // Sidebar no longer renders per-agent live counts — those moved to the top
  // stats bar. Header counters are derived inside OfficeDashboard.

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden" style={{ fontFamily:"Inter, sans-serif" }}>
      {/* ── Sidebar ── */}
      <aside className="flex flex-col w-52 border-r border-slate-800 bg-slate-900/70 backdrop-blur flex-shrink-0">
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-4 py-4 border-b border-slate-800">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background:"linear-gradient(135deg, #06b6d4, #8b5cf6)" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 7l10 5 10-5-10-5z" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/>
              <path d="M2 17l10 5 10-5" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/>
              <path d="M2 12l10 5 10-5" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/>
            </svg>
          </div>
          <div>
            <div className="text-sm font-bold text-slate-100">AI Office</div>
            <div className="text-xs text-slate-500">Virtual Workspace</div>
          </div>
        </div>

        {/* Active project */}
        {project && (
          <div className="mx-3 mt-3 p-3 rounded-xl border border-cyan-500/20 bg-cyan-500/5">
            <div className="flex items-center gap-1.5 mb-1">
              <div className="live-dot" style={{ width:6, height:6 }}/>
              <span className="text-xs font-semibold text-cyan-400 uppercase tracking-wider">Active</span>
            </div>
            <div className="text-xs font-semibold text-slate-200 mb-1 truncate">{project.name}</div>
            <div className="flex items-center gap-2 mt-2">
              <div className="flex-1 h-1 rounded-full bg-slate-700 overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500"
                  style={{ width:`${project.progress}%`, background:"linear-gradient(90deg, #06b6d4, #8b5cf6)" }}/>
              </div>
              <span className="text-xs font-mono text-cyan-400 font-bold">{project.progress}%</span>
            </div>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 px-3 py-3 space-y-1">
          {navItems.map(item => {
            const active = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href}>
                <div className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                  active
                    ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                    : "text-slate-500 hover:text-slate-300 hover:bg-slate-800"
                }`} data-testid={`nav-${item.href.replace("/","") || "home"}`}>
                  <item.icon size={14}/>
                  {item.label}
                </div>
              </Link>
            );
          })}
        </nav>

        {/* Agent status list removed in Stage 5.x.11 — agent presence is now
            shown on the office floor itself; the sidebar list was redundant. */}

        {/* Connection + new project */}
        <div className="px-3 pb-4 space-y-2">
          <div className="flex items-center justify-between gap-1.5 text-xs px-2">
            <div className="flex items-center gap-1.5">
              {connected
                ? <><Wifi size={11} className="text-emerald-400"/><span className="text-emerald-400">Live</span></>
                : <><WifiOff size={11} className="text-slate-500"/><span className="text-slate-500">Offline</span></>}
            </div>
            <button
              onClick={async () => {
                try {
                  await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
                } catch { /* ignore network errors */ }
                window.location.replace("/login.html");
              }}
              className="flex items-center gap-1 text-slate-500 hover:text-slate-300 transition-colors"
              title="Sign out"
              data-testid="button-sign-out">
              <LogOut size={11}/>
              <span>Sign out</span>
            </button>
          </div>
          <button onClick={() => setShowModal(true)}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all hover:opacity-90"
            style={{ background:"linear-gradient(135deg, #06b6d4, #8b5cf6)", color:"#fff" }}
            data-testid="button-new-project">
            <Send size={12}/> New Project
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <Switch>
          <Route path="/">
            <OfficeDashboard
              agents={agents} events={events} project={project} tasks={tasks}
              connected={connected} showModal={showModal} setShowModal={setShowModal}
              agentMode={agentMode} setAgentMode={setAgentMode}
              liveStreams={liveStreams}
            />
          </Route>
          <Route path="/projects" component={ProjectsPage} />
          <Route path="/templates" component={TemplatesPage} />
          <Route path="/board">
            <TaskBoardPage tasks={tasks} project={project} agents={agents}/>
          </Route>
          <Route path="/agents" component={AgentsPage}/>
          <Route path="/files">
            <FilesPage projects={allProjects} />
          </Route>
          <Route path="/budget" component={BudgetPage}/>
          <Route path="/settings" component={SettingsPage}/>
        </Switch>
      </div>

      {/* Global failover modal — listens for `aioffice:failover_required` */}
      <FailoverModal/>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router hook={useHashLocation}>
        <AppShell/>
      </Router>
      <Toaster/>
    </QueryClientProvider>
  );
}

export default App;
