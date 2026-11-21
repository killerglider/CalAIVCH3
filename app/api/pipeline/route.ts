import { NextResponse } from "next/server";

import { InputError } from "@/lib/comparative";
import { cleanString, coerceFormLines, describeLines } from "@/lib/intake";
import {
  mockComparativeStatement,
  mockItemMatches,
  mockRecommendation,
  mockRequirement,
} from "@/lib/mocks";
import { DEFAULT_PROJECT } from "@/lib/rfq";
import { loadQuotes, persistStatement, runComparative } from "@/lib/server/comparative";
import { loadRequirement, persistRequirement } from "@/lib/server/intake";
import { runMatch } from "@/lib/server/match";
import { persistRecommendation, runRecommend } from "@/lib/server/recommend";
import type { ComparativeStatement, ItemMatch, Recommendation, Requirement } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PipelineResult {
  requirement: Requirement;
  matches: ItemMatch[];
  /** null only for the inline-lines mode, where no quotes can exist yet. */
  comparative: ComparativeStatement | null;
  recommendation: Recommendation | null;
  /** Human-readable remarks, e.g. why a stage was skipped. Empty on the normal path. */
  notes: string[];
  timings_ms: Record<string, number>;
}

type PipelineResponse = PipelineResult | { error: string; name: string; stage?: string };

type ParsedRequest =
  | { kind: "requirement"; requirementId: string }
  | { kind: "inline"; lines: unknown; project: string };

/** Returns null when the request carries no input at all (mock path). */
async function parseRequest(req: Request): Promise<ParsedRequest | null> {
  const text = await req.text();
  if (!text.trim()) return null;

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new InputError("Body is not valid JSON.");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new InputError("Body must be a JSON object.");
  }
  const o = body as Record<string, unknown>;
  if (Object.keys(o).length === 0) return null;

  const hasId = o.requirement_id !== undefined && o.requirement_id !== null && o.requirement_id !== "";
  if (hasId && o.lines !== undefined) {
    throw new InputError("Send either `requirement_id` or `lines`, not both.");
  }
  if (hasId) {
    if (typeof o.requirement_id !== "string" || !UUID_RE.test(o.requirement_id)) {
      throw new InputError("requirement_id must be a UUID.");
    }
    return { kind: "requirement", requirementId: o.requirement_id };
  }
  if (o.lines !== undefined) {
    return { kind: "inline", lines: o.lines, project: cleanString(o.project) ?? DEFAULT_PROJECT };
  }
  throw new InputError("Send `requirement_id` (with persisted quotes) or `lines`.");
}

/** Error that remembers which stage failed, without losing the original error class. */
class StageError extends Error {
  constructor(
    readonly stage: string,
    readonly original: Error,
  ) {
    super(original.message);
    this.name = original.name;
  }
}

/** Runs one stage, records its wall time, and tags any failure with the stage name. */
async function stage<T>(name: string, timings: Record<string, number>, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    return await fn();
  } catch (err) {
    throw new StageError(name, err instanceof Error ? err : new Error(String(err)));
  } finally {
    timings[name] = Date.now() - start;
  }
}

/**
 * Persisted quotes -> comparative -> recommendation, with match running beside
 * them (they do not depend on each other). Normalise is deliberately not run.
 */
async function runForRequirement(requirementId: string, timings: Record<string, number>) {
  // Cheap reads first: a missing requirement or no quotes fails fast, before any model call.
  const [requirement, quotes] = await stage("load", timings, () =>
    Promise.all([loadRequirement(requirementId), loadQuotes(requirementId)]),
  );

  const matchRun = stage("match", timings, () => runMatch(requirement.lines, requirementId));

  const compareAndRecommend = (async () => {
    const comparative = await stage("comparative", timings, async () => {
      const statement = await runComparative(requirementId, quotes);
      await persistStatement(statement, requirementId);
      return statement;
    });
    const recommendation = await stage("recommendation", timings, async () => {
      const rec = await runRecommend(comparative);
      await persistRecommendation(rec, requirementId);
      return rec;
    });
    return { comparative, recommendation };
  })();

  const [match, { comparative, recommendation }] = await Promise.all([matchRun, compareAndRecommend]);
  return { requirement, match, comparative, recommendation };
}

/** Inline lines: create the requirement and match it. No quotes exist yet, so no comparison. */
async function runInline(lines: unknown, project: string, timings: Record<string, number>) {
  const draft = coerceFormLines(lines);
  const requirement = await stage("intake", timings, () =>
    persistRequirement({ source: "form", project, raw_text: describeLines(draft), lines: draft }),
  );
  const match = await stage("match", timings, () => runMatch(requirement.lines, requirement.id));
  return { requirement, match };
}

export async function POST(req: Request): Promise<NextResponse<PipelineResponse>> {
  const started = Date.now();
  try {
    const parsed = await parseRequest(req);

    // No input: serve the mocks so a ping with no body still renders.
    if (!parsed) {
      const mock: PipelineResult = {
        requirement: mockRequirement,
        matches: mockItemMatches,
        comparative: mockComparativeStatement,
        recommendation: mockRecommendation,
        notes: [],
        timings_ms: {},
      };
      return NextResponse.json(mock, { headers: { "X-Mock": "true" } });
    }

    const timings: Record<string, number> = {};
    let result: PipelineResult;
    let unresolved = 0;

    if (parsed.kind === "requirement") {
      const r = await runForRequirement(parsed.requirementId, timings);
      unresolved = r.match.unresolved.length;
      result = {
        requirement: r.requirement,
        matches: r.match.matches,
        comparative: r.comparative,
        recommendation: r.recommendation,
        notes: [],
        timings_ms: timings,
      };
    } else {
      const r = await runInline(parsed.lines, parsed.project, timings);
      unresolved = r.match.unresolved.length;
      result = {
        requirement: r.requirement,
        matches: r.match.matches,
        comparative: null,
        recommendation: null,
        notes: [
          "Inline lines create a new requirement, which has no quotes yet, so comparative and recommendation were skipped. Send { requirement_id } for a requirement whose quotes are already normalised.",
        ],
        timings_ms: timings,
      };
    }

    result.timings_ms = { ...timings, total: Date.now() - started };
    const headers: Record<string, string> = {};
    if (unresolved > 0) headers["X-Unresolved-Lines"] = String(unresolved);
    return NextResponse.json(result, { headers });
  } catch (err) {
    const tagged = err instanceof StageError ? err : null;
    const error = tagged?.original ?? (err instanceof Error ? err : new Error(String(err)));
    const status = error instanceof InputError ? 400 : 500;
    if (status === 500) console.error(`[pipeline${tagged ? `:${tagged.stage}` : ""}]`, error);
    return NextResponse.json(
      { error: error.message, name: error.name, ...(tagged ? { stage: tagged.stage } : {}) },
      { status },
    );
  }
}
