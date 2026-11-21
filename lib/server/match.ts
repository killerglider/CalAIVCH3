import "server-only";

import { InputError } from "@/lib/comparative";
import { extractJSON } from "@/lib/llm/anthropic";
import {
  assembleItemMatch,
  codeToPersist,
  dedupeCandidates,
  parseDecisions,
  toCandidate,
  type RpcCandidateRow,
} from "@/lib/match";
import { supabaseServer } from "@/lib/supabase/server";
import type { ItemCandidate, ItemMatch, RequirementLine } from "@/lib/types";

/** One batched LLM call must fit its output budget; see MAX_TOKENS in the wrapper. */
export const MAX_MATCH_LINES = 60;
/** Oversample so that exact ERP repeats can be collapsed and still leave 6. */
const RETRIEVAL_K = 12;
const DUPLICATE_MIN_SIM = 0.55;

const SYSTEM_PROMPT = `You map construction requirement lines to existing ERP item codes for an Indian construction company.

For each requirement line you get a numbered list of candidate ERP items retrieved by text similarity. Decide per line:
- "matched": a candidate clearly denotes the SAME work (same activity and same location/element, e.g. toilet FLOOR vs toilet WALL are different). Give its candidate_index.
- "new_code_suggested": no candidate fits. Give suggested_new_code instead.

Rules:
- You choose only among the listed candidates by candidate_index. Never invent or alter a match.
- Similarity scores are hints, not decisions. A high score on a different element is not a match.
- If several candidates are clearly the same work, choose the one with the highest score.
- If a line has no candidates, it is "new_code_suggested".
- suggested_new_code: a short code in the company's style, letters then a dot then a number, e.g. "WP.12", reusing the prefix of the closest candidates. A free number is assigned afterwards, so a plausible one is enough.
- Return exactly one decision per line_id.`;

const DECISION_TOOL = {
  name: "record_match_decisions",
  description: "Record, for every requirement line, whether it matches a candidate or needs a new code.",
  input_schema: {
    type: "object" as const,
    properties: {
      decisions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            line_id: { type: "string" },
            decision: { type: "string", enum: ["matched", "new_code_suggested"] },
            candidate_index: { type: ["integer", "null"] },
            suggested_new_code: { type: ["string", "null"] },
          },
          required: ["line_id", "decision", "candidate_index", "suggested_new_code"],
        },
      },
    },
    required: ["decisions"],
  },
};

export async function loadRequirementLines(requirementId: string): Promise<RequirementLine[]> {
  const { data, error } = await supabaseServer
    .from("requirement_lines")
    .select("id, description, uom, qty, wo_code")
    .eq("requirement_id", requirementId)
    .order("created_at", { ascending: true });
  if (error) throw error;

  const rows = (data ?? []) as {
    id: string;
    description: string;
    uom: string;
    qty: number | string | null;
    wo_code: string | null;
  }[];
  if (rows.length === 0) {
    throw new InputError("No requirement_lines found for that requirement_id.");
  }
  return rows.map((r) => {
    const line: RequirementLine = {
      id: r.id,
      description: r.description,
      uom: r.uom,
      qty: r.qty === null ? null : Number(r.qty),
    };
    if (r.wo_code) line.wo_code = r.wo_code;
    return line;
  });
}

async function rpcRows(fn: string, args: Record<string, unknown>): Promise<RpcCandidateRow[]> {
  const { data, error } = await supabaseServer.rpc(fn, args);
  if (error) throw error;
  return (data ?? []) as RpcCandidateRow[];
}

interface Retrieved {
  candidates: ItemCandidate[];
  cluster: ItemCandidate[];
}

/** Deterministic retrieval. A failure is thrown: empty lists would read as "no match". */
async function retrieve(line: RequirementLine): Promise<Retrieved> {
  const candidates = dedupeCandidates(
    await rpcRows("match_item_code", { query: line.description, k: RETRIEVAL_K }),
  );
  const cluster = (
    await rpcRows("duplicate_candidates", {
      ref: candidates[0]?.description ?? line.description,
      min_sim: DUPLICATE_MIN_SIM,
    })
  ).map(toCandidate);
  return { candidates, cluster };
}

function truncate(text: string, max = 240): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function buildPrompt(lines: RequirementLine[], retrieved: Retrieved[]): string {
  const payload = lines.map((l, i) => ({
    line_id: l.id,
    description: l.description,
    uom: l.uom,
    qty: l.qty,
    candidates: retrieved[i].candidates.map((c, index) => ({
      candidate_index: index,
      item_code: c.item_code,
      description: truncate(c.description),
      score: Math.round(c.score * 100) / 100,
    })),
  }));
  return `Decide for each of these ${lines.length} requirement line(s):\n${JSON.stringify(payload, null, 2)}`;
}

/** Every ERP code, so a suggested new code can be made unique. */
async function loadTakenCodes(): Promise<Set<string>> {
  const { data, error } = await supabaseServer.from("item_codes").select("item_code").limit(10000);
  if (error) throw error;
  return new Set(((data ?? []) as { item_code: string }[]).map((r) => r.item_code));
}

async function persistMatches(matches: ItemMatch[], requirementId: string): Promise<boolean> {
  try {
    const results = await Promise.all(
      matches.map(async (m) => {
        const code = codeToPersist(m);
        if (!code) return true;
        const { data, error } = await supabaseServer
          .from("requirement_lines")
          .update({ matched_item_code: code })
          .eq("id", m.requirement_line_id)
          .eq("requirement_id", requirementId)
          .select("id");
        if (error) throw error;
        return (data?.length ?? 0) > 0;
      }),
    );
    if (results.includes(false)) {
      console.error("[match] some lines were not found under that requirement_id");
    }
    return !results.includes(false);
  } catch (err) {
    console.error("[match] persisting matched_item_code failed:", err);
    return false;
  }
}

export interface MatchRun {
  matches: ItemMatch[];
  /** line_ids for which the model gave no usable decision (they became new_code_suggested). */
  unresolved: string[];
  /** null when no requirementId was given (nothing to persist). */
  persisted: boolean | null;
}

/**
 * Retrieval (deterministic) + one batched model decision call + assembly.
 * Writes matched_item_code back to requirement_lines when requirementId is given.
 */
export async function runMatch(lines: RequirementLine[], requirementId?: string): Promise<MatchRun> {
  if (lines.length === 0) throw new InputError("`lines` is empty.");
  if (lines.length > MAX_MATCH_LINES) {
    throw new InputError(`At most ${MAX_MATCH_LINES} lines per request (got ${lines.length}).`);
  }

  const retrieved = await Promise.all(lines.map(retrieve));

  const raw = await extractJSON<unknown>({
    system: SYSTEM_PROMPT,
    userText: buildPrompt(lines, retrieved),
    tool: DECISION_TOOL,
  });
  const decisions = parseDecisions(raw);

  const taken = Array.from(decisions.values()).some((d) => d.decision === "new_code_suggested")
    ? await loadTakenCodes()
    : new Set<string>();

  const unresolved: string[] = [];
  const matches = lines.map((line, i) => {
    const result = assembleItemMatch(
      line,
      retrieved[i].candidates,
      retrieved[i].cluster,
      decisions.get(line.id),
      taken,
    );
    if (result.unresolved) unresolved.push(line.id);
    return result.match;
  });
  if (unresolved.length > 0) {
    console.warn(`[match] no usable model decision for ${unresolved.length} line(s):`, unresolved);
  }

  const persisted = requirementId ? await persistMatches(matches, requirementId) : null;
  return { matches, unresolved, persisted };
}
