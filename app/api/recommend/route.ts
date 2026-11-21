import { NextResponse } from "next/server";

import { InputError } from "@/lib/comparative";
import { mockRecommendation } from "@/lib/mocks";
import { coerceStatement } from "@/lib/recommend";
import { loadLatestStatement, persistRecommendation, runRecommend } from "@/lib/server/recommend";
import type { ComparativeStatement, Recommendation } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ParsedRequest {
  statement: ComparativeStatement;
  /** UUID to persist under; absent for inline statements without one. */
  persistFor?: string;
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

type RecommendResponse = Recommendation | { error: string; name: string };

export async function POST(req: Request): Promise<NextResponse<RecommendResponse>> {
  try {
    const parsed = await parseRequest(req);

    // No input: serve the mock so the existing page renders with no body and no keys.
    if (!parsed) return NextResponse.json(mockRecommendation, { headers: { "X-Mock": "true" } });

    const recommendation = await runRecommend(parsed.statement);

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
