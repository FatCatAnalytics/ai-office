// Stage 6: Investment Memos — all generated memos, with deep links to runs.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { FileText } from "lucide-react";
import { getJson, fmtDate, INVESTMENT_DISCLAIMER } from "@/lib/investment";
import type { InvestmentMemo, Company } from "@/lib/investment";

export default function InvestmentMemosPage() {
  const { data: memos } = useQuery<InvestmentMemo[]>({
    queryKey: ["/api/investment/memos"],
    queryFn: () => getJson("/api/investment/memos"),
    refetchInterval: 15_000,
  });
  const { data: companies } = useQuery<Company[]>({
    queryKey: ["/api/investment/companies"],
    queryFn: () => getJson("/api/investment/companies"),
  });
  const [openId, setOpenId] = useState<number | null>(null);

  const open = memos?.find((m) => m.id === openId);

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6" data-testid="page-memos">
      <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
        <FileText className="text-cyan-400" size={22}/> Investment Memos
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/50" data-testid="panel-memo-list">
          <div className="text-sm font-semibold text-slate-200 mb-3">All memos</div>
          {(memos ?? []).length === 0 && <p className="text-xs text-slate-500">No memos yet.</p>}
          <div className="space-y-2">
            {(memos ?? []).map((m) => {
              const co = companies?.find((c) => c.id === m.companyId);
              return (
                <div key={m.id} className="p-3 rounded-lg bg-slate-800/50 flex items-center justify-between" data-testid={`row-memo-${m.id}`}>
                  <div className="flex-1 cursor-pointer" onClick={() => setOpenId(m.id)}>
                    <div className="text-sm font-semibold text-slate-200">{m.title}</div>
                    <div className="text-xs text-slate-500">{co?.name ?? `Company #${m.companyId}`} · {fmtDate(m.createdAt)} · rec: {m.recommendation}</div>
                  </div>
                  <Link href={`/diligence/${m.diligenceRunId}`}>
                    <button className="text-xs text-cyan-400 hover:text-cyan-300">View run →</button>
                  </Link>
                </div>
              );
            })}
          </div>
        </div>

        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/50" data-testid="panel-memo-body">
          <div className="text-sm font-semibold text-slate-200 mb-3">Memo preview</div>
          {!open ? <p className="text-xs text-slate-500">Select a memo to preview.</p> : (
            <>
              <pre className="text-xs text-slate-300 whitespace-pre-wrap bg-slate-950 p-3 rounded-lg border border-slate-800 max-h-[500px] overflow-y-auto" data-testid={`memo-body-${open.id}`}>
                {open.body}
              </pre>
              <div className="text-[11px] text-slate-600 italic mt-3">{open.disclaimer || INVESTMENT_DISCLAIMER}</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
