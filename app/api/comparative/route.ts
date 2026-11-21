import { NextResponse } from "next/server";

import { coerceQuotes, InputError } from "@/lib/comparative";
import { mockComparativeStatement } from "@/lib/mocks";
import { loadQuotes, persistStatement, runComparative } from "@/lib/server/comparative";
import type { ComparativeStatement, NormalizedQuoteLine } from "@/lib/types";

export const runtime = "nodejs";

const MAX_QUOTES = 2000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ParsedRequest {
  quotes: NormalizedQuoteLine[];
  /** Present when the caller gave a UUID requirement_id. */
  requirementId?: string;
}

/** Returns null when the request carries no input at all. */
async function parseRequest(req: Request): Promise<ParsedRequest | null> {
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) return null;

  let body: { requirement_id?: unknown; quotes?: unknown };
  try {
    body = await req.json();
  } catch {
    throw new InputError("Body is not valid JSON.");
  }

  let requirementId: string | undefined;
  if (body.requirement_id !== undefined && body.requirement_id !== null && body.requirement_id !== "") {
    if (typeof body.requirement_id !== "string" || !UUID_RE.test(body.requirement_id)) {
      throw new InputError("requirement_id must be a UUID.");
    }
    requirementId = body.requirement_id;
  }

  if (body.quotes !== undefined) {
    const quotes = coerceQuotes(body.quotes);
    if (quotes.length === 0) throw new InputError("`quotes` is empty.");
    if (quotes.length > MAX_QUOTES) {
      throw new InputError(`At most ${MAX_QUOTES} quote lines per request.`);
    }
    return { quotes, requirementId };
  }
  if (requirementId) return { quotes: await loadQuotes(requirementId), requirementId };
  return null;
}

type ComparativeResponse = ComparativeStatement | { error: string; name: string };

export async function POST(req: Request): Promise<NextResponse<ComparativeResponse>> {
  try {
    const parsed = await parseRequest(req);

    // No input: serve the mock so the existing page renders with no body and no keys.
    if (!parsed) {
      return NextResponse.json(mockComparativeStatement, { headers: { "X-Mock": "true" } });
    }

    const statement = await runComparative(parsed.requirementId ?? "demo", parsed.quotes);

    const headers: Record<string, string> = {};
    if (parsed.requirementId) {
      headers["X-Statement-Persisted"] = String(
        await persistStatement(statement, parsed.requirementId),
      );
    }
    return NextResponse.json(statement, { headers });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const status = error instanceof InputError ? 400 : 500;
    if (status === 500) console.error("[comparative]", error);
    return NextResponse.json({ error: error.message, name: error.name }, { status });
  }
}
