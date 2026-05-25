// Stage 6.7 — storage-aware wrapper around the pure novelty helpers.
//
// novelty.ts is deliberately storage-free so it can be unit-tested without
// a sqlite handle. This file is the thin glue that asks `storage` for
// "every issue-*.md file produced by a prior project using template X"
// and hands the result to buildRecentIssuesFromFiles().

import { storage } from "../storage";
import {
  buildRecentIssuesFromFiles,
  isIssueFilename,
  isRunnerUpFilename,
  RECENT_ISSUE_LIMIT,
  type RecentIssue,
} from "./novelty";

export interface LoadRecentForTemplateOpts {
  // Cap on number of issues to load (newest-first).
  limit?: number;
  // Exclude files from this project id (used after the current week's
  // final task emits its own issue, so the runner-up check doesn't
  // flag the runner-up against the issue we JUST wrote alongside it
  // — that pairing is handled by a separate same-project comparison).
  excludeProjectId?: number;
  // Filter to either issues, runner-ups, or both. Defaults to issues only.
  // The novelty guard for the angle/final prompt uses issues only; the
  // runner-up self-check sweeps both so a candidate that revives last
  // week's runner-up wholesale is also caught.
  include?: "issues" | "runner-ups" | "both";
}

// Walk every prior project spawned from `templateId`, gather their
// markdown files, and return the parsed issue signatures (newest-first,
// capped at `limit`). Returns an empty array when:
//   - templateId is null (manual project)
//   - no prior projects exist for that template
//   - no project produced an issue-*.md file yet
export function loadRecentIssuesForTemplate(
  templateId: number | null | undefined,
  opts: LoadRecentForTemplateOpts = {},
): RecentIssue[] {
  if (templateId == null) return [];
  const limit = opts.limit ?? RECENT_ISSUE_LIMIT;

  const projects = storage
    .getProjects()
    .filter(p => p.templateId === templateId)
    // Skip the current run if asked — its own files shouldn't be matched
    // against itself.
    .filter(p => opts.excludeProjectId == null || p.id !== opts.excludeProjectId);

  // Collect every markdown file from each project. We over-fetch (no
  // per-project limit) then sort + slice at the end so the global newest-
  // first ordering survives projects firing out of order.
  type CandidateFile = {
    filename: string; filePath: string; projectId: number; createdAt: number;
  };
  const allFiles: CandidateFile[] = [];
  for (const p of projects) {
    const files = storage.getProjectFiles(p.id);
    for (const f of files) {
      if (f.fileType !== "markdown") continue;
      allFiles.push({
        filename: f.filename,
        filePath: f.filePath,
        projectId: f.projectId,
        createdAt: f.createdAt,
      });
    }
  }

  const include = opts.include ?? "issues";
  const match =
    include === "issues" ? isIssueFilename
    : include === "runner-ups" ? isRunnerUpFilename
    : (name: string) => isIssueFilename(name) || isRunnerUpFilename(name);

  return buildRecentIssuesFromFiles(allFiles, { match, limit });
}
