import "server-only";

import { supabaseServer } from "@/lib/supabase/server";
import type { NormalizedQuoteLine } from "@/lib/types";

/**
 * Persists normalised lines into vinayak.quotes, idempotently per
 * (requirement_id, vendor, source_file). With no requirement_id the key is
 * (requirement_id IS NULL, vendor, source_file), so attached quotes are never
 * touched by a demo re-run.
 *
 * New rows are inserted first and older rows with the same key are pruned
 * afterwards, so a failed insert never leaves a vendor with no quotes.
 */
export async function persistQuotes(
  lines: NormalizedQuoteLine[],
  requirementId?: string,
): Promise<boolean> {
  if (lines.length === 0) return true;

  try {
    // quotes.vendor has an FK to vendors(name); keep existing vendor rows untouched.
    const vendors = Array.from(new Set(lines.map((l) => l.vendor))).map((name) => ({
      name,
      category: "Uncategorised",
    }));
    const v = await supabaseServer
      .from("vendors")
      .upsert(vendors, { onConflict: "name", ignoreDuplicates: true });
    if (v.error) throw v.error;

    const inserted = await supabaseServer
      .from("quotes")
      .insert(
        lines.map((l) => ({
          requirement_id: requirementId ?? null,
          vendor: l.vendor,
          source_file: l.source_file,
          item_label: l.item_label,
          matched_item_code: l.matched_item_code ?? null,
          uom_original: l.uom_original,
          qty_original: l.qty_original,
          rate_original: l.rate_original,
          uom_norm: l.uom_norm,
          qty_norm: l.qty_norm,
          unit_rate_norm: l.unit_rate_norm,
          gst_pct: l.gst_pct,
          freight: l.freight,
          payment_terms: l.payment_terms,
          delivery_days: l.delivery_days,
          confidence: l.confidence,
          flags: l.flags,
        })),
      )
      .select("id, vendor, source_file");
    if (inserted.error) throw inserted.error;

    // Prune superseded rows for each (vendor, source_file) pair we just wrote.
    const newIds = new Map<string, { vendor: string; source_file: string; ids: number[] }>();
    for (const row of inserted.data as { id: number; vendor: string; source_file: string }[]) {
      const key = `${row.vendor}\u0000${row.source_file}`;
      const entry = newIds.get(key) ?? { vendor: row.vendor, source_file: row.source_file, ids: [] };
      entry.ids.push(row.id);
      newIds.set(key, entry);
    }

    for (const { vendor, source_file, ids } of Array.from(newIds.values())) {
      let del = supabaseServer
        .from("quotes")
        .delete()
        .eq("vendor", vendor)
        .eq("source_file", source_file)
        .not("id", "in", `(${ids.join(",")})`);
      del = requirementId
        ? del.eq("requirement_id", requirementId)
        : del.is("requirement_id", null);
      const d = await del;
      if (d.error) throw d.error;
    }

    return true;
  } catch (err) {
    console.error("[quotes-store] persisting quotes failed:", err);
    return false;
  }
}
