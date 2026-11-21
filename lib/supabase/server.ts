import "server-only";

import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "mock-service-role-key";
const schema = process.env.SUPABASE_DB_SCHEMA ?? "vinayak";

/**
 * Server-only administrative client. Never import this module from a Client
 * Component: the service-role key bypasses Row Level Security.
 */
export const supabaseServer = createClient(supabaseUrl, serviceRoleKey, {
  db: { schema },
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
