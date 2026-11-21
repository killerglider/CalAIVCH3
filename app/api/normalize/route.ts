import { NextResponse } from "next/server";

import { mockNormalizedQuoteLines } from "@/lib/mocks";
import type { NormalizedQuoteLine } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(): Promise<NextResponse<NormalizedQuoteLine[]>> {
  return NextResponse.json(mockNormalizedQuoteLines);
}
