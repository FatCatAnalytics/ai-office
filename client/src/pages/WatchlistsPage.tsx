// Stage 6: Watchlists — group companies under a thesis.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Plus, Trash2 } from "lucide-react";
import { getJson, postJson } from "@/lib/investment";
import { apiRequest } from "@/lib/queryClient";
import type { Watchlist, Company } from "@/lib/investment";

export default function WatchlistsPage() {
  const qc = useQueryClient();
  const { data: lists } = useQuery<Watchlist[]>({
    queryKey: ["/api/investment/watchlists"],
    queryFn: () => getJson("/api/investment/watchlists"),
    refetchInterval: 15_000,
  });
  const { data: companies } = useQuery<Company[]>({
    queryKey: ["/api/investment/companies"],
    queryFn: () => getJson("/api/investment/companies"),
  });

  const [name, setName] = useState("");
  const [thesis, setThesis] = useState("");

  const addList = async () => {
    if (!name.trim()) return;
    await postJson("/api/investment/watchlists", { name: name.trim(), thesis: thesis.trim() });
    setName(""); setThesis("");
    qc.invalidateQueries({ queryKey: ["/api/investment/watchlists"] });
  };

  const addItem = async (watchlistId: number, companyId: number) => {
    await postJson(`/api/investment/watchlists/${watchlistId}/items`, { companyId });
    qc.invalidateQueries({ queryKey: ["/api/investment/watchlists"] });
  };

  const removeItem = async (id: number) => {
    await apiRequest("DELETE", `/api/investment/watchlist-items/${id}`);
    qc.invalidateQueries({ queryKey: ["/api/investment/watchlists"] });
  };

  const removeList = async (id: number) => {
    await apiRequest("DELETE", `/api/investment/watchlists/${id}`);
    qc.invalidateQueries({ queryKey: ["/api/investment/watchlists"] });
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6" data-testid="page-watchlists">
      <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
        <Eye className="text-cyan-400" size={22}/> Watchlists
      </h1>

      <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/50" data-testid="panel-new-watchlist">
        <div className="text-sm font-semibold text-slate-200 mb-3">New watchlist</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <input className="px-3 py-2 rounded-lg bg-slate-800 text-sm text-slate-200" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} data-testid="input-watchlist-name"/>
          <input className="md:col-span-2 px-3 py-2 rounded-lg bg-slate-800 text-sm text-slate-200" placeholder="Thesis (optional)" value={thesis} onChange={(e) => setThesis(e.target.value)} data-testid="input-watchlist-thesis"/>
        </div>
        <button onClick={addList} className="mt-2 px-3 py-1.5 rounded-lg text-xs font-semibold text-white"
          style={{ background: "linear-gradient(135deg, #06b6d4, #8b5cf6)" }}
          data-testid="button-add-watchlist">
          <Plus size={12} className="inline mr-1"/> Create
        </button>
        <p className="text-xs text-slate-500 mt-2">
          Scheduled monitoring across watchlists is on the Stage 6 roadmap (Milestone 3) — for now you can add companies and review them manually.
        </p>
      </div>

      <div className="space-y-4">
        {(lists ?? []).map((w) => (
          <div key={w.id} className="p-4 rounded-xl border border-slate-800 bg-slate-900/50" data-testid={`watchlist-${w.id}`}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-sm font-semibold text-slate-200">{w.name}</div>
                {w.thesis && <div className="text-xs text-slate-500">{w.thesis}</div>}
              </div>
              <button onClick={() => removeList(w.id)} className="text-rose-400 hover:text-rose-300" data-testid={`delete-watchlist-${w.id}`}>
                <Trash2 size={14}/>
              </button>
            </div>
            <div className="space-y-1 mb-3">
              {w.items.length === 0 ? <p className="text-xs text-slate-500">No companies yet.</p> :
                w.items.map((it) => {
                  const co = companies?.find((c) => c.id === it.companyId);
                  return (
                    <div key={it.id} className="flex items-center justify-between p-2 rounded-lg bg-slate-800/50 text-sm text-slate-300" data-testid={`watchlist-item-${it.id}`}>
                      <span>{co?.name ?? `Company #${it.companyId}`}</span>
                      <button onClick={() => removeItem(it.id)} className="text-slate-500 hover:text-rose-400">
                        <Trash2 size={12}/>
                      </button>
                    </div>
                  );
                })}
            </div>
            <AddCompanyToList list={w} companies={companies ?? []} onAdd={(cid) => addItem(w.id, cid)}/>
          </div>
        ))}
      </div>
    </div>
  );
}

function AddCompanyToList({ list, companies, onAdd }: { list: Watchlist; companies: Company[]; onAdd: (id: number) => void }) {
  const [pick, setPick] = useState<number | "">("");
  const taken = new Set(list.items.map((i) => i.companyId));
  const options = companies.filter((c) => !taken.has(c.id));
  return (
    <div className="flex items-center gap-2">
      <select value={pick} onChange={(e) => setPick(e.target.value ? parseInt(e.target.value, 10) : "")}
        className="px-3 py-2 rounded-lg bg-slate-800 text-sm text-slate-200" data-testid={`select-company-${list.id}`}>
        <option value="">— add a company —</option>
        {options.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <button disabled={!pick} onClick={() => { if (pick) onAdd(pick); setPick(""); }}
        className="px-3 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-40"
        style={{ background: "linear-gradient(135deg, #06b6d4, #8b5cf6)" }}
        data-testid={`button-add-to-list-${list.id}`}>
        Add
      </button>
    </div>
  );
}
