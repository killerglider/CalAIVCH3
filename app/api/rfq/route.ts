import { NextResponse } from "next/server";

import { mockRfqDraft } from "@/lib/mocks";
import type { RfqDraft } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(): Promise<NextResponse<RfqDraft>> {
  return NextResponse.json(mockRfqDraft);
}
