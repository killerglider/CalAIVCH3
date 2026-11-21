import { InputError } from "@/lib/comparative";
import { loadQuotes, persistStatement, runComparative } from "@/lib/server/comparative";
import { loadRequirement } from "@/lib/server/intake";
import { runMatch } from "@/lib/server/match";
import { persistRecommendation, runRecommend } from "@/lib/server/recommend";
import type { ComparativeStatement, ItemMatch, Recommendation, Requirement } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Stage = "load" | "match" | "comparative" | "recommend";

type StreamEvent =
  | { type: "stage"; stage: Stage; status: "running" }
  | { type: "stage"; stage: "load"; status: "done"; ms: number }
  | { type: "stage"; stage: "match"; status: "done"; ms: number; data: ItemMatch[] }
  | { type: "stage"; stage: "comparative"; status: "done"; ms: number; data: ComparativeStatement }
  | { type: "stage"; stage: "recommend"; status: "done"; ms: number; data: Recommendation }
  | {
      type: "done";
      result: {
        requirement: Requirement;
        matches: ItemMatch[];
        comparative: ComparativeStatement;
        recommendation: Recommendation;
      };
      timings_ms: Record<Stage | "total", number>;
    }
  | { type: "error"; stage: Stage; error: string; name: string };

const json = (body: unknown, status: number): Response =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Malformed requests are rejected with a normal 400 before any stream starts. */
async function readRequirementId(req: Request): Promise<string> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new InputError("Body must be JSON: { requirement_id }.");
  }
  const id = (body as { requirement_id?: unknown } | null)?.requirement_id;
  if (typeof id !== "string" || !UUID_RE.test(id)) {
    throw new InputError("requirement_id must be a UUID.");
  }
  return id;
}

/**
 * Same work as POST /api/pipeline, but sequential, with a real event around
 * each stage. Persistence is identical: matched_item_code is written back by
 * runMatch, and the statement and recommendation are saved.
 */
export async function POST(req: Request): Promise<Response> {
  let requirementId: string;
  try {
    requirementId = await readRequirementId(req);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    return json({ error: error.message, name: error.name }, error instanceof InputError ? 400 : 500);
  }

  const encoder = new TextEncoder();
  /** Set when the client disconnects, so we stop doing work nobody will read. */
  let cancelled = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let currentStage: Stage = "load";

      // Every event is enqueued the moment it is emitted; nothing is batched.
      const emit = (evt: StreamEvent): void => {
        if (closed || cancelled) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`));
        } catch {
          closed = true; // controller already closed by the client going away
        }
      };
      const close = (): void => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      const stopIfCancelled = (): void => {
        if (cancelled) throw new Error("Client disconnected.");
      };

      const started = Date.now();
      const timings = { load: 0, match: 0, comparative: 0, recommend: 0, total: 0 };

      try {
        // ---- load -------------------------------------------------------
        currentStage = "load";
        emit({ type: "stage", stage: "load", status: "running" });
        let t = Date.now();
        const [requirement, quotes] = await Promise.all([
          loadRequirement(requirementId), // InputError if the requirement does not exist
          loadQuotes(requirementId), // InputError if it has no quotes
        ]);
        timings.load = Date.now() - t;
        emit({ type: "stage", stage: "load", status: "done", ms: timings.load });
        stopIfCancelled();

        // ---- match ------------------------------------------------------
        currentStage = "match";
        emit({ type: "stage", stage: "match", status: "running" });
        t = Date.now();
        const { matches } = await runMatch(requirement.lines, requirementId);
        timings.match = Date.now() - t;
        emit({ type: "stage", stage: "match", status: "done", ms: timings.match, data: matches });
        stopIfCancelled();

        // ---- comparative ------------------------------------------------
        currentStage = "comparative";
        emit({ type: "stage", stage: "comparative", status: "running" });
        t = Date.now();
        const comparative = await runComparative(requirementId, quotes);
        await persistStatement(comparative, requirementId);
        timings.comparative = Date.now() - t;
        emit({ type: "stage", stage: "comparative", status: "done", ms: timings.comparative, data: comparative });
        stopIfCancelled();

        // ---- recommend --------------------------------------------------
        currentStage = "recommend";
        emit({ type: "stage", stage: "recommend", status: "running" });
        t = Date.now();
        const recommendation = await runRecommend(comparative);
        await persistRecommendation(recommendation, requirementId);
        timings.recommend = Date.now() - t;
        emit({ type: "stage", stage: "recommend", status: "done", ms: timings.recommend, data: recommendation });

        // ---- final ------------------------------------------------------
        timings.total = Date.now() - started;
        emit({
          type: "done",
          result: { requirement, matches, comparative, recommendation },
          timings_ms: timings,
        });
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        if (!(error instanceof InputError)) console.error(`[pipeline/stream:${currentStage}]`, error);
        emit({ type: "error", stage: currentStage, error: error.message, name: error.name });
      } finally {
        close();
      }
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Stop reverse proxies (nginx) from buffering the stream.
      "X-Accel-Buffering": "no",
    },
  });
}
