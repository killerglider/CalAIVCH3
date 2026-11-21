import type {
  ComparativeStatement,
  ItemCandidate,
  ItemMatch,
  NormalizedQuoteLine,
  Recommendation,
  Requirement,
  RequirementLine,
  RfqDraft,
  Vendor,
} from "@/lib/types";

export const mockRequirementLine: RequirementLine = {
  id: "req-line-001",
  description: "12 mm waterproof plywood for kitchen cabinetry",
  uom: "SQM",
  qty: 180,
  wo_code: "WO-KITCHEN-24",
};

export const mockRequirement: Requirement = {
  id: "req-2026-001",
  source: "whatsapp",
  project: "Vinayak Riverside Residences",
  raw_text:
    "Need 180 sqm 12mm waterproof plywood for kitchen work. Delivery by next Friday.",
  lines: [mockRequirementLine],
  created_at: "2026-11-21T05:30:00.000Z",
};

export const mockItemCandidate: ItemCandidate = {
  item_code: "WP.01",
  description: "Waterproof plywood, 12 mm, IS 710 grade",
  score: 0.96,
};

export const mockItemMatch: ItemMatch = {
  requirement_line_id: mockRequirementLine.id,
  query_text: mockRequirementLine.description,
  best: mockItemCandidate,
  candidates: [
    mockItemCandidate,
    {
      item_code: "WP.02",
      description: "Waterproof plywood, 18 mm, IS 710 grade",
      score: 0.81,
    },
  ],
  decision: "matched",
  duplicate_cluster: [
    mockItemCandidate,
    {
      item_code: "W.P.01",
      description: "Water proof ply 12mm",
      score: 0.93,
    },
    {
      item_code: "WP.01.A",
      description: "12 mm BWP plywood",
      score: 0.91,
    },
  ],
};

export const mockItemMatches: ItemMatch[] = [mockItemMatch];

export const mockNormalizedQuoteLine: NormalizedQuoteLine = {
  vendor: "Shree Timber Traders",
  source_file: "shree-timber-quote-nov-2026.pdf",
  item_label: "BWP Ply 12 MM",
  matched_item_code: "WP.01",
  uom_original: "SQFT",
  qty_original: 1937.5,
  rate_original: 128,
  uom_norm: "SQM",
  qty_norm: 180,
  unit_rate_norm: 1377.78,
  gst_pct: 18,
  freight: 4500,
  payment_terms: "30% advance, balance within 15 days",
  delivery_days: 7,
  confidence: 0.94,
  flags: ["unit_converted"],
};

export const mockScopeMismatchQuoteLine: NormalizedQuoteLine = {
  vendor: "Omkar Building Supplies",
  source_file: "omkar-whatsapp-quote.jpg",
  item_label: "Commercial ply 12 MM including installation",
  uom_original: "SQM",
  qty_original: 180,
  rate_original: 1190,
  uom_norm: "SQM",
  qty_norm: 180,
  unit_rate_norm: 1190,
  gst_pct: 18,
  freight: null,
  payment_terms: "Full payment before dispatch",
  delivery_days: 5,
  confidence: 0.68,
  flags: ["scope_mismatch"],
};

export const mockNormalizedQuoteLines: NormalizedQuoteLine[] = [
  mockNormalizedQuoteLine,
  mockScopeMismatchQuoteLine,
];

export const mockComparativeStatement: ComparativeStatement = {
  requirement_id: mockRequirement.id,
  items: [
    {
      item_code: "WP.01",
      description: "Waterproof plywood, 12 mm, IS 710 grade",
      uom: "SQM",
      qty: 180,
      vendor_rates: [
        {
          vendor: "Shree Timber Traders",
          unit_rate_norm: 1377.78,
          flags: ["unit_converted"],
        },
        {
          vendor: "Omkar Building Supplies",
          unit_rate_norm: 1190,
          flags: ["scope_mismatch"],
        },
      ],
    },
  ],
  vendor_summary: [
    {
      vendor: "Shree Timber Traders",
      score: 88,
      rank: 1,
      rate_index: 92,
      performance_score: 91,
      notes: "Compliant IS 710 scope and dependable delivery history.",
    },
    {
      vendor: "Omkar Building Supplies",
      score: 69,
      rank: 2,
      rate_index: 100,
      performance_score: 75,
      notes: "Lowest rate, but quoted material and installation scope differ.",
    },
  ],
};

export const mockRecommendation: Recommendation = {
  requirement_id: mockRequirement.id,
  recommended_vendor: "Shree Timber Traders",
  reasoning:
    "The quote matches the requested IS 710 specification and has the strongest combined commercial and delivery score.",
  caveats: [
    "Confirm freight allocation before issuing the purchase order.",
    "Recommendation is mock data and has not been approved by procurement.",
  ],
};

export const mockRfqDraft: RfqDraft = {
  item_code: "WP.01",
  subject: "RFQ: 12 mm waterproof plywood — Riverside Residences",
  body:
    "Please quote your best rate for 180 SQM of 12 mm IS 710 grade waterproof plywood, delivered to the Riverside Residences site.",
  standard_terms: [
    "Quote rates exclusive of GST and show GST separately.",
    "State freight, payment terms, and committed delivery date.",
    "Offer validity must be at least 30 days.",
  ],
};

export const mockVendor: Vendor = {
  name: "Shree Timber Traders",
  category: "Plywood and boards",
  contact: "sales@shreetimber.example",
  performance: {
    on_time_pct: 94,
    rate_variance_pct: 2.4,
    rework_count: 1,
    quality_1_5: 4.6,
  },
};
