import type { ItemCandidate, ItemMatch, RequirementLine } from "@/lib/types";

/** Pure helpers for item-code matching. No LLM and no I/O in this module. */

export const MAX_CANDIDATES = 6;

/** Shown to the UI when the ERP list returned nothing; `best` is not optional. */
export const NO_CANDIDATE: ItemCandidate = { item_code: "", description: "", score: 0 };

export interface RpcCandidateRow {
  item_code: string;
  description: string;
  score: number | string;
}

export function toCandidate(row: RpcCandidateRow): ItemCandidate {
  return {
    item_code: row.item_code,
    description: row.description,
    score: Number(row.score),
  };
}

/**
 * The ERP export repeats rows verbatim (e.g. WP.01.A twice). Collapse exact
 * (code, description) repeats so candidate slots aren't wasted, keeping order.
 * duplicate_cluster is NOT deduplicated: repeats there are the signal.
 */
export function dedupeCandidates(
  rows: RpcCandidateRow[],
  limit = MAX_CANDIDATES,
): ItemCandidate[] {
  const seen = new Set<string>();
  const out: ItemCandidate[] = [];
  for (const row of rows) {
    const key = `${row.item_code}\u0000${row.description}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(toCandidate(row));
    if (out.length === limit) break;
  }
  return out;
}

export interface RawDecision {
  decision: "matched" | "new_code_suggested";
  candidate_index: number | null;
  suggested_new_code: string | null;
}

/** Guards the tool output. Invalid individual entries are skipped, not fatal. */
export function parseDecisions(input: unknown): Map<string, RawDecision> {
  const obj = input as { decisions?: unknown } | null;
  if (!obj || !Array.isArray(obj.decisions)) {
    throw new Error("match: model returned malformed output (no `decisions` array).");
  }

  const out = new Map<string, RawDecision>();
  for (const item of obj.decisions as unknown[]) {
    const d = item as Record<string, unknown> | null;
    if (!d || typeof d.line_id !== "string") continue;
    if (d.decision !== "matched" && d.decision !== "new_code_suggested") continue;
    const idx = typeof d.candidate_index === "number" ? d.candidate_index : null;
    const code =
      typeof d.suggested_new_code === "string" && d.suggested_new_code.trim()
        ? d.suggested_new_code.trim()
        : null;
    out.set(d.line_id, {
      decision: d.decision,
      candidate_index: idx !== null && Number.isInteger(idx) ? idx : null,
      suggested_new_code: code,
    });
  }
  return out;
}

/**
 * Returns a suggested code that collides with nothing in `taken`, bumping the
 * last number in it (WP.07 -> WP.08, keeping zero padding). The chosen code is
 * added to `taken` so two suggestions in one batch never collide.
 */
export function allocateNewCode(suggested: string, taken: Set<string>): string {
  let code = suggested;
  for (let i = 0; i < 1000 && taken.has(code); i++) {
    const m = code.match(/(\d+)(?!.*\d)/);
    if (m && m.index !== undefined) {
      const next = String(Number(m[1]) + 1).padStart(m[1].length, "0");
      code = code.slice(0, m.index) + next + code.slice(m.index + m[1].length);
    } else {
      code = `${code}.01`;
    }
  }
  taken.add(code);
  return code;
}

export interface AssembledMatch {
  match: ItemMatch;
  /** True when the model gave no usable decision for this line. */
  unresolved: boolean;
}

/**
 * Builds one ItemMatch. The model only chooses an index into `candidates`;
 * best.score therefore always comes from the RPC. A missing or invalid decision
 * degrades to "new_code_suggested" with no suggested code (a human reviews it)
 * rather than guessing a match.
 */
export function assembleItemMatch(
  line: RequirementLine,
  candidates: ItemCandidate[],
  duplicateCluster: ItemCandidate[],
  raw: RawDecision | undefined,
  taken: Set<string>,
): AssembledMatch {
  const base = {
    requirement_line_id: line.id,
    query_text: line.description,
    candidates,
    duplicate_cluster: duplicateCluster,
  };

  if (raw?.decision === "matched") {
    const best = raw.candidate_index === null ? undefined : candidates[raw.candidate_index];
    if (best) {
      return { match: { ...base, best, decision: "matched" }, unresolved: false };
    }
  }

  const best = candidates[0] ?? NO_CANDIDATE;
  const match: ItemMatch = { ...base, best, decision: "new_code_suggested" };
  if (raw?.decision === "new_code_suggested" && raw.suggested_new_code) {
    match.suggested_new_code = allocateNewCode(raw.suggested_new_code, taken);
  }
  return { match, unresolved: raw?.decision !== "new_code_suggested" };
}

/** The code to write back to requirement_lines.matched_item_code, if any. */
export function codeToPersist(match: ItemMatch): string | undefined {
  if (match.decision === "matched") return match.best.item_code || undefined;
  return match.suggested_new_code;
}
