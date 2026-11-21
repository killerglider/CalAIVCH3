import { NextResponse } from "next/server";

import { InputError } from "@/lib/comparative";
import { mockItemMatches } from "@/lib/mocks";
import { loadRequirementLines, runMatch } from "@/lib/server/match";
import type { ItemMatch, RequirementLine } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ParsedRequest {
  lines: RequirementLine[];
  requirementId?: string;
}

function checkLine(raw: unknown, i: number): RequirementLine {
  const l = raw as Record<string, unknown> | null;
  if (!l || typeof l.id !== "string" || !l.id) {
    throw new InputError(`lines[${i}].id must be a non-empty string.`);
  }
  if (typeof l.description !== "string" || !l.description.trim()) {
    throw new InputError(`lines[${i}].description must be a non-empty string.`);
  }
  const qty = l.qty === undefined ? null : l.qty;
  if (qty !== null && (typeof qty !== "number" || !Number.isFinite(qty))) {
    throw new InputError(`lines[${i}].qty must be a number or null.`);
  }
  const line: RequirementLine = {
    id: l.id,
    description: l.description.trim(),
    uom: typeof l.uom === "string" ? l.uom : "",
    qty,
  };
  if (typeof l.wo_code === "string" && l.wo_code) line.wo_code = l.wo_code;
  return line;
}

/** Returns null when the request carries no input at all. */
async function parseRequest(req: Request): Promise<ParsedRequest | null> {
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) return null;

  let body: { lines?: unknown; requirement_id?: unknown };
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

  if (body.lines !== undefined) {
    if (!Array.isArray(body.lines)) throw new InputError("`lines` must be an array.");
    return { lines: body.lines.map(checkLine), requirementId };
  }
  if (requirementId) {
    return { lines: await loadRequirementLines(requirementId), requirementId };
  }
  return null;
}

type MatchResponse = ItemMatch[] | { error: string; name: string };

export async function POST(req: Request): Promise<NextResponse<MatchResponse>> {
  try {
    const parsed = await parseRequest(req);

    // No input: serve the mock so the existing pages render with no body and no keys.
    if (!parsed) {
      return NextResponse.json(mockItemMatches, { headers: { "X-Mock": "true" } });
    }

    const { matches, unresolved, persisted } = await runMatch(parsed.lines, parsed.requirementId);

    const headers: Record<string, string> = {};
    if (persisted !== null) headers["X-Matches-Persisted"] = String(persisted);
    if (unresolved.length > 0) headers["X-Unresolved-Lines"] = String(unresolved.length);

    return NextResponse.json(matches, { headers });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const status = error instanceof InputError ? 400 : 500;
    if (status === 500) console.error("[match]", error);
    return NextResponse.json({ error: error.message, name: error.name }, { status });
  }
}
