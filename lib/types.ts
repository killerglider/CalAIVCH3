export type RequirementSource = "form" | "whatsapp" | "voice";

export interface RequirementLine {
  id: string;
  description: string;
  uom: string;
  qty: number | null;
  wo_code?: string;
}

export interface Requirement {
  id: string;
  source: RequirementSource;
  project: string;
  raw_text: string;
  lines: RequirementLine[];
  created_at: string;
}

export interface ItemCandidate {
  item_code: string;
  description: string;
  score: number;
}

export interface ItemMatch {
  requirement_line_id: string;
  query_text: string;
  best: ItemCandidate;
  candidates: ItemCandidate[];
  decision: "matched" | "new_code_suggested";
  suggested_new_code?: string;
  duplicate_cluster: ItemCandidate[];
}

export interface NormalizedQuoteLine {
  vendor: string;
  source_file: string;
  item_label: string;
  matched_item_code?: string;
  uom_original: string;
  qty_original: number | null;
  rate_original: number | null;
  uom_norm: "SQM";
  qty_norm: number | null;
  unit_rate_norm: number | null;
  gst_pct: number | null;
  freight: number | null;
  payment_terms: string | null;
  delivery_days: number | null;
  confidence: number;
  flags: string[];
}

export interface ComparativeStatement {
  requirement_id: string;
  items: {
    item_code: string;
    description: string;
    uom: "SQM";
    qty: number | null;
    vendor_rates: {
      vendor: string;
      unit_rate_norm: number | null;
      flags: string[];
    }[];
  }[];
  vendor_summary: {
    vendor: string;
    score: number;
    rank: number;
    rate_index: number;
    performance_score: number;
    notes: string;
  }[];
}

export interface Recommendation {
  requirement_id: string;
  recommended_vendor: string;
  reasoning: string;
  caveats: string[];
}

export interface RfqDraft {
  item_code: string;
  subject: string;
  body: string;
  standard_terms: string[];
}

export interface Vendor {
  name: string;
  category: string;
  contact?: string;
  performance: {
    on_time_pct: number;
    rate_variance_pct: number;
    rework_count: number;
    quality_1_5: number;
  };
}
