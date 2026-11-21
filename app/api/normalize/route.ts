import { NextResponse } from "next/server";

import { extractJSON, readSamplePdfBase64 } from "@/lib/llm/anthropic";
import { mockNormalizedQuoteLines } from "@/lib/mocks";
import {
  acceptMatch,
  applyRateReliabilityGuard,
  canonicalVendor,
  flagScopeMismatch,
  matchQueryFor,
  normalizeLine,
  parseRawExtraction,
  resolveVendor,
  vendorHintFromFile,
} from "@/lib/normalize";
import { persistQuotes } from "@/lib/quotes-store";
import type { NormalizationEvent } from "@/lib/normalization-events";
import { listQuotes } from "@/lib/server/comparative";
import { supabaseServer } from "@/lib/supabase/server";
import type { NormalizedQuoteLine } from "@/lib/types";

export const runtime = "nodejs";
// PDF vision calls can take a while; Vercel's default is far shorter.
export const maxDuration = 60;

const SAMPLE_DIR = "06_quotations";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class BadRequestError extends Error {}

interface QuoteInput {
  sourceFile: string;
  pdfBase64: string;
}

interface ParsedRequest {
  inputs: QuoteInput[];
  vendor?: string;
  requirementId?: string;
}

const SYSTEM_PROMPT = `You extract raw line items from a vendor quotation PDF for a construction company in India.
The document may be a scan; read it visually.

Rules:
- Return ONLY values exactly as printed. Do NOT compute, convert, total, round or normalise anything. Keep rates and quantities as printed and keep the printed unit of measure (e.g. "SQFT", "Sq.Ft", "SQM", "RMT", "Nos") in uom_original.
- One entry per priced line item. Put the full item description, including relevant spec text, in item_label.
- item_heading is ONLY the short heading of the item as printed (e.g. "WATERPROOFING AT TOILET FLOOR"), without the specification paragraph, method statement or scope notes that follow it. Copy it; do not paraphrase.
- If a value is not printed, use null. Never guess a rate or quantity.
- A rate cell that is blank, cropped, cut off or illegible is null. A stray or partial number near the table, or a figure that belongs to another row or column, is NOT a rate. Only use a rate you can read in that line's own RATE cell. Do not copy one line's rate onto other lines unless each line prints it.
- freight, payment_terms and delivery_days are usually quote-level: repeat them on every line they apply to. delivery_days only if the delivery period is printed in days, otherwise null.
- gst_pct is the percentage number (18, not 0.18).
- vendor is the quoting company from the letterhead.
- confidence (0 to 1) is your confidence that the line was read correctly.
- source_looks_scanned is true if the document is a scan or photo, or text is garbled or unclear.`;

const EXTRACT_TOOL = {
  name: "record_quote_lines",
  description: "Record the raw line items printed on the vendor quotation.",
  input_schema: {
    type: "object" as const,
    properties: {
      source_looks_scanned: { type: "boolean" },
      lines: {
        type: "array",
        items: {
          type: "object",
          properties: {
            vendor: { type: ["string", "null"] },
            item_label: { type: "string" },
            item_heading: { type: ["string", "null"] },
            uom_original: { type: ["string", "null"] },
            qty_original: { type: ["number", "null"] },
            rate_original: { type: ["number", "null"] },
            gst_pct: { type: ["number", "null"] },
            freight: { type: ["number", "null"] },
            payment_terms: { type: ["string", "null"] },
            delivery_days: { type: ["number", "null"] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
          required: ["item_label", "uom_original", "qty_original", "rate_original", "confidence"],
        },
      },
    },
    required: ["source_looks_scanned", "lines"],
  },
};

async function loadSample(name: string): Promise<QuoteInput> {
  if (!/^[\w][\w .-]*\.pdf$/i.test(name)) {
    throw new BadRequestError(`Invalid sampleFile name: ${name}`);
  }
  try {
    return {
      sourceFile: name,
      pdfBase64: await readSamplePdfBase64(`${SAMPLE_DIR}/${name}`),
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new BadRequestError(`Sample file not found in data/${SAMPLE_DIR}: ${name}`);
    }
    throw err;
  }
}

function checkRequirementId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw new BadRequestError("requirement_id must be a UUID.");
  }
  return value;
}

/** Returns null when the request carries no input at all. */
async function parseRequest(req: Request): Promise<ParsedRequest | null> {
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const inputs: QuoteInput[] = [];
    for (const entry of form.getAll("file")) {
      if (typeof entry === "string") continue;
      const isPdf = entry.type === "application/pdf" || /\.pdf$/i.test(entry.name);
      if (!isPdf) throw new BadRequestError(`Not a PDF: ${entry.name}`);
      inputs.push({
        sourceFile: entry.name,
        pdfBase64: Buffer.from(await entry.arrayBuffer()).toString("base64"),
      });
    }
    if (inputs.length === 0) return null;
    const vendor = form.get("vendor");
    return {
      inputs,
      vendor: typeof vendor === "string" ? vendor : undefined,
      requirementId: checkRequirementId(form.get("requirement_id")),
    };
  }

  if (contentType.includes("application/json")) {
    let body: {
      sampleFile?: unknown;
      sampleFiles?: unknown;
      vendor?: unknown;
      requirement_id?: unknown;
    };
    try {
      body = await req.json();
    } catch {
      throw new BadRequestError("Body is not valid JSON.");
    }
    const names: string[] = [];
    if (typeof body.sampleFile === "string") names.push(body.sampleFile);
    if (Array.isArray(body.sampleFiles)) {
      for (const n of body.sampleFiles) {
        if (typeof n !== "string") throw new BadRequestError("sampleFiles must be strings.");
        names.push(n);
      }
    }
    const requirementId = checkRequirementId(body.requirement_id);
    if (names.length === 0 && !requirementId) return null;
    return {
      inputs: await Promise.all(names.map(loadSample)),
      vendor: typeof body.vendor === "string" ? body.vendor : undefined,
      requirementId,
    };
  }

  return null;
}

interface ExtractedLine {
  line: NormalizedQuoteLine;
  /** What to match against the ERP list (short heading, not the spec paragraph). */
  matchQuery: string;
}

/** Existing vendor names, to map inferred letterhead names onto. Best effort. */
async function loadKnownVendors(): Promise<string[]> {
  try {
    const { data, error } = await supabaseServer.from("vendors").select("name");
    if (error) throw error;
    return ((data ?? []) as { name: string }[]).map((v) => v.name);
  } catch (err) {
    console.error("[normalize] loading vendors failed:", err);
    return [];
  }
}

/** One LLM call per PDF; everything after extraction is deterministic. */
async function extractFile(
  input: QuoteInput,
  knownVendors: string[],
  suppliedVendor?: string,
): Promise<ExtractedLine[]> {
  const raw = await extractJSON<unknown>({
    system: SYSTEM_PROMPT,
    userText: `Extract every line item from this quotation (${input.sourceFile}).`,
    pdfBase64: input.pdfBase64,
    tool: EXTRACT_TOOL,
  });
  const { lines, source_looks_scanned } = parseRawExtraction(raw);
  const vendor = canonicalVendor(
    resolveVendor(lines, suppliedVendor, vendorHintFromFile(input.sourceFile)),
    knownVendors,
  );
  return lines.map((l) => ({
    line: normalizeLine(l, { vendor, sourceFile: input.sourceFile, scanned: source_looks_scanned }),
    matchQuery: matchQueryFor(l),
  }));
}

/**
 * Top-1 item code via the match_item_code RPC, accepted only at or above
 * MIN_MATCH_SCORE. A failure or weak match leaves the line unmatched.
 */
async function matchItemCode(itemLabel: string): Promise<string | undefined> {
  try {
    const { data, error } = await supabaseServer.rpc("match_item_code", {
      query: itemLabel,
      k: 1,
    });
    if (error) throw error;
    return acceptMatch((data as { item_code: string; score: number }[] | null)?.[0]);
  } catch (err) {
    console.error("[normalize] match_item_code failed:", err);
    return undefined;
  }
}

async function normalize(parsed: ParsedRequest, report?: (event: NormalizationEvent) => void) {
  const fileCount = parsed.inputs.length;
  let completed = 0;
  const progress = (label: string) => report?.({ type: "progress", completed, total: fileCount + 2, label });
  progress("Reading vendor quotations");
  const vendors = await loadKnownVendors();
  const perFile = await Promise.all(parsed.inputs.map(async (input) => {
    const lines = await extractFile(input, vendors, parsed.vendor);
    completed++;
    progress(completed === fileCount ? "Matching ERP codes" : `Read ${completed} of ${fileCount} quotations`);
    return lines;
  }));
  const extracted = perFile.flat();
  const queries = Array.from(new Set(extracted.map((entry) => entry.matchQuery)));
  const codes = new Map(await Promise.all(queries.map(async (query) => [query, await matchItemCode(query)] as const)));
  const matched = extracted.map(({ line, matchQuery }) => {
    const code = codes.get(matchQuery);
    return code ? { ...line, matched_item_code: code } : line;
  });
  const lines = applyRateReliabilityGuard(flagScopeMismatch(matched));
  completed++;
  progress("Saving normalized quotes");
  const persisted = await persistQuotes(lines, parsed.requirementId);
  return { lines, persisted };
}

function streamNormalization(parsed: ParsedRequest): Response {
  const encoder = new TextEncoder();
  let disconnected = false;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: NormalizationEvent) => {
        if (!disconnected) controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };
      try {
        const { lines, persisted } = await normalize(parsed, emit);
        if (!persisted) throw new Error("Could not save the normalized quotes. Please retry.");
        emit({ type: "done", lines });
      } catch (error) {
        emit({ type: "error", error: error instanceof Error ? error.message : "Could not normalize quotes." });
      } finally {
        if (!disconnected) controller.close();
      }
    },
    cancel() { disconnected = true; },
  });
  return new Response(body, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
}

export async function POST(req: Request): Promise<Response> {
  try {
    const parsed = await parseRequest(req);

    // No input: serve the mock so the existing pages render with no PDF and no keys.
    if (!parsed) {
      return NextResponse.json(mockNormalizedQuoteLines, { headers: { "X-Mock": "true" } });
    }
    if (parsed.requirementId && parsed.inputs.length === 0) {
      return NextResponse.json(await listQuotes(parsed.requirementId));
    }
    if (parsed.vendor && parsed.inputs.length > 1) {
      throw new BadRequestError("`vendor` can only be supplied with a single file.");
    }

    if (req.headers.get("accept") === "application/x-ndjson") return streamNormalization(parsed);
    const { lines, persisted } = await normalize(parsed);

    return NextResponse.json(lines, { headers: { "X-Quotes-Persisted": String(persisted) } });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const status = error instanceof BadRequestError ? 400 : 500;
    if (status === 500) console.error("[normalize]", error);
    return NextResponse.json({ error: error.message, name: error.name }, { status });
  }
}
