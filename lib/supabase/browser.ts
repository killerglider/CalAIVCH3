import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const anonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "mock-anon-key";

/**
 * Public browser client. Local fallback values keep mock-only screens usable
 * without configuration; no request is made until a query is executed.
 */
export const supabaseBrowser = createClient(supabaseUrl, anonKey);
