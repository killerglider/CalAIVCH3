import { NextResponse } from "next/server";

import { InputError } from "@/lib/comparative";
import { extractJSON, type ExtractionTool } from "@/lib/llm/anthropic";
import { mockRecommendation } from "@/lib/mocks";
import {
  assemble,
  coerceStatement,
  parseProse,
  pickRunnerUp,
  pickWinner,
  type ModelProse,
} from "@/lib/recommend";
import { supabaseServer } from "@/lib/supabase/server";
import type { ComparativeStatement, Recommendation } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SYSTEM = `You write the explanation for a procurement recommendation. The winning vendor has ALREADY been chosen by a deterministic ranking; you never choose or change it.

You receive a JSON comparative statement and the name of the recommended vendor (the top vendor by score). Use only figures present in the JSON; never invent numbers.

reasoning: 2 to 4 sentences justifying the recommended vendor using its actual score, rate_index and performance_score, and how it compares with the runner-up (name the runner-up and quote its score). If there is only one vendor, say so instead of comparing.

caveats: a list of short, specific strings. Include, when the data supports them:
- every vendor whose item flags include "needs_manual_review" (or whose notes say manual review): name it and say its quote is a scanned document, the rates were not read, and it is excluded from rate ranking.
- every item where any vendor's flags include "uom_unsupported": name the item_code and description and say it was dropped from rate comparison because vendors quoted different units (for example RMT versus SQM), so the rates are not comparable. Name the vendors involved.
- every vendor whose items carry the "scope_mismatch" flag (or whose notes say scope differs): name the vendor and say its lower total reflects a smaller scope, not a better rate.
- for the recommended vendor, every item_code where unit_rate_norm is null or the flags include "missing_rate" or "gst_extra", other than items already covered above (list the item codes and what is missing).
- ALWAYS, as the last caveat: vendor performance scores are seeded demo data, not Vinayak's own records.
Do not pad with generic advice. Omit a caveat whose condition is not present in the data (except the seeded-data one).`;

const TOOL: ExtractionTool = {
  name: "record_recommendation",
  description: "Record the prose explanation for the already-chosen vendor.",
  input_schema: {
    type: "object",
    properties: {
      reasoning: { type: "string", description: "2-4 sentences justifying the recommended (top-score) vendor with real numbers." },
      caveats: { type: "array", items: { type: "string" } },
    },
    required: ["reasoning", "caveats"],
  },
};

interface ParsedRequest {
  statement: ComparativeStatement;
  /** UUID to persist under; absent for inline statements without one. */
  persistFor?: string;
}

/** Latest stored statement for the requirement. */
async function loadLatestStatement(requirementId: string): Promise<ComparativeStatement> {
  const { data, error } = await supabaseServer
    .from("comparative_statements")
    .select("statement")
    .eq("requirement_id", requirementId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = (data ?? [])[0] as { statement: unknown } | undefined;
  if (!row) {
    throw new InputError("No comparative statement found for that requirement_id. Run /api/comparative first.");
  }
  return coerceStatement(row.statement);
}

/** Returns null when the request carries no input at all. */
async function parseRequest(req: Request): Promise<ParsedRequest | null> {
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) return null;

  let body: { requirement_id?: unknown; statement?: unknown };
  try {
    body = await req.json();
  } catch {
    throw new InputError("Body is not valid JSON.");
  }
  if (body === null || typeof body !== "object") throw new InputError("Body must be a JSON object.");

  if (body.statement !== undefined) {
    const statement = coerceStatement(body.statement);
    return { statement, persistFor: UUID_RE.test(statement.requirement_id) ? statement.requirement_id : undefined };
  }

  if (body.requirement_id !== undefined && body.requirement_id !== null && body.requirement_id !== "") {
    if (typeof body.requirement_id !== "string" || !UUID_RE.test(body.requirement_id)) {
      throw new InputError("requirement_id must be a UUID.");
    }
    return { statement: await loadLatestStatement(body.requirement_id), persistFor: body.requirement_id };
  }
  return null;
}

/** Inserts first, then prunes older recommendations for the requirement. */
async function persistRecommendation(rec: Recommendation, requirementId: string): Promise<boolean> {
  try {
    const inserted = await supabaseServer
      .from("recommendations")
      .insert({ requirement_id: requirementId, recommendation: rec })
      .select("id")
      .single();
    if (inserted.error) throw inserted.error;

    const pruned = await supabaseServer
      .from("recommendations")
      .delete()
      .eq("requirement_id", requirementId)
      .neq("id", inserted.data.id);
    if (pruned.error) throw pruned.error;
    return true;
  } catch (err) {
    console.error("[recommend] persisting recommendation failed:", err);
    return false;
  }
}

type RecommendResponse = Recommendation | { error: string; name: string };

export async function POST(req: Request): Promise<NextResponse<RecommendResponse>> {
  try {
    const parsed = await parseRequest(req);

    // No input: serve the mock so the existing page renders with no body and no keys.
    if (!parsed) return NextResponse.json(mockRecommendation, { headers: { "X-Mock": "true" } });

    const { statement } = parsed;
    const winner = pickWinner(statement);
    const runnerUp = pickRunnerUp(statement, winner);

    const userText = [
      `Recommended vendor (top score, fixed): ${winner.vendor}`,
      `Runner-up (next highest score): ${runnerUp ? runnerUp.vendor : "none"}`,
      "",
      "Comparative statement JSON:",
      JSON.stringify(statement),
    ].join("\n");

    const raw = await extractJSON<ModelProse>({ system: SYSTEM, userText, tool: TOOL });
    const recommendation = assemble(statement, winner, parseProse(raw));

    const headers: Record<string, string> = {};
    if (parsed.persistFor) {
      headers["X-Recommendation-Persisted"] = String(
        await persistRecommendation(recommendation, parsed.persistFor),
      );
    }
    return NextResponse.json(recommendation, { headers });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const status = error instanceof InputError ? 400 : 500;
    if (status === 500) console.error("[recommend]", error);
    return NextResponse.json({ error: error.message, name: error.name }, { status });
  }
}
