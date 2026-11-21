import { NextResponse } from "next/server";

import { buildComparativeStatement, coerceQuotes, InputError } from "@/lib/comparative";
import { mockComparativeStatement } from "@/lib/mocks";
import { supabaseServer } from "@/lib/supabase/server";
import type { ComparativeStatement, NormalizedQuoteLine, Vendor } from "@/lib/types";

export const runtime = "nodejs";

const MAX_QUOTES = 2000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ParsedRequest {
  quotes: NormalizedQuoteLine[];
  /** Present when the caller gave a UUID requirement_id. */
  requirementId?: string;
}

interface QuoteRow {
  vendor: string;
  source_file: string;
  item_label: string;
  matched_item_code: string | null;
  uom_original: string;
  qty_original: number | string | null;
  rate_original: number | string | null;
  qty_norm: number | string | null;
  unit_rate_norm: number | string | null;
  gst_pct: number | string | null;
  freight: number | string | null;
  payment_terms: string | null;
  delivery_days: number | string | null;
  confidence: number | string;
  flags: string[] | null;
}

const numOrNull = (v: number | string | null): number | null => (v === null ? null : Number(v));

function rowToLine(r: QuoteRow): NormalizedQuoteLine {
  const line: NormalizedQuoteLine = {
    vendor: r.vendor,
    source_file: r.source_file,
    item_label: r.item_label,
    uom_original: r.uom_original,
    qty_original: numOrNull(r.qty_original),
    rate_original: numOrNull(r.rate_original),
    uom_norm: "SQM",
    qty_norm: numOrNull(r.qty_norm),
    unit_rate_norm: numOrNull(r.unit_rate_norm),
    gst_pct: numOrNull(r.gst_pct),
    freight: numOrNull(r.freight),
    payment_terms: r.payment_terms,
    delivery_days: numOrNull(r.delivery_days),
    confidence: Number(r.confidence),
    flags: r.flags ?? [],
  };
  if (r.matched_item_code) line.matched_item_code = r.matched_item_code;
  return line;
}

async function loadQuotes(requirementId: string): Promise<NormalizedQuoteLine[]> {
  const { data, error } = await supabaseServer
    .from("quotes")
    .select(
      "vendor, source_file, item_label, matched_item_code, uom_original, qty_original, rate_original, qty_norm, unit_rate_norm, gst_pct, freight, payment_terms, delivery_days, confidence, flags",
    )
    .eq("requirement_id", requirementId)
    .order("id", { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as QuoteRow[];
  if (rows.length === 0) throw new InputError("No quotes found for that requirement_id.");
  return rows.map(rowToLine);
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

async function loadVendors(): Promise<Vendor[]> {
  const { data, error } = await supabaseServer
    .from("vendors")
    .select("name, category, contact, on_time_pct, rate_variance_pct, rework_count, quality_1_5");
  if (error) throw error;
  return (
    (data ?? []) as {
      name: string;
      category: string;
      contact: string | null;
      on_time_pct: number | string;
      rate_variance_pct: number | string;
      rework_count: number | string;
      quality_1_5: number | string;
    }[]
  ).map((v) => {
    const vendor: Vendor = {
      name: v.name,
      category: v.category,
      performance: {
        on_time_pct: Number(v.on_time_pct),
        rate_variance_pct: Number(v.rate_variance_pct),
        rework_count: Number(v.rework_count),
        quality_1_5: Number(v.quality_1_5),
      },
    };
    if (v.contact) vendor.contact = v.contact;
    return vendor;
  });
}

/** ERP descriptions for the matched codes. Best effort: falls back to the item_label. */
async function loadItemDescriptions(quotes: NormalizedQuoteLine[]): Promise<Map<string, string>> {
  const codes = Array.from(new Set(quotes.map((q) => q.matched_item_code).filter((c): c is string => !!c)));
  const out = new Map<string, string>();
  if (codes.length === 0) return out;
  try {
    const { data, error } = await supabaseServer
      .from("item_codes")
      .select("item_code, description")
      .in("item_code", codes)
      .order("id", { ascending: true });
    if (error) throw error;
    for (const r of (data ?? []) as { item_code: string; description: string }[]) {
      if (!out.has(r.item_code)) out.set(r.item_code, r.description); // codes repeat: keep the first
    }
  } catch (err) {
    console.error("[comparative] loading item descriptions failed:", err);
  }
  return out;
}

/**
 * Saves the statement as jsonb. Inserts first and prunes older statements for
 * the requirement afterwards, so a failed insert never leaves it with none.
 */
async function persistStatement(statement: ComparativeStatement, requirementId: string): Promise<boolean> {
  try {
    const inserted = await supabaseServer
      .from("comparative_statements")
      .insert({ requirement_id: requirementId, statement })
      .select("id")
      .single();
    if (inserted.error) throw inserted.error;

    const pruned = await supabaseServer
      .from("comparative_statements")
      .delete()
      .eq("requirement_id", requirementId)
      .neq("id", inserted.data.id);
    if (pruned.error) throw pruned.error;
    return true;
  } catch (err) {
    console.error("[comparative] persisting statement failed:", err);
    return false;
  }
}

type ComparativeResponse = ComparativeStatement | { error: string; name: string };

export async function POST(req: Request): Promise<NextResponse<ComparativeResponse>> {
  try {
    const parsed = await parseRequest(req);

    // No input: serve the mock so the existing page renders with no body and no keys.
    if (!parsed) {
      return NextResponse.json(mockComparativeStatement, { headers: { "X-Mock": "true" } });
    }

    const [vendors, itemDescriptions] = await Promise.all([
      loadVendors(),
      loadItemDescriptions(parsed.quotes),
    ]);

    const statement = buildComparativeStatement({
      requirementId: parsed.requirementId ?? "demo",
      quotes: parsed.quotes,
      vendors,
      itemDescriptions,
    });

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
