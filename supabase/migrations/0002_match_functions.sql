-- Trigram helpers the backend calls via supabase.rpc(). No embedding provider
-- needed: 76 short ERP codes match well on pg_trgm similarity.

-- Top-k item-code candidates for a requirement line.
create or replace function vinayak.match_item_code(query text, k integer default 6)
returns table(item_code text, description text, score real)
language sql stable
set search_path = vinayak, extensions, public
as $$
  select item_code, description,
         greatest(similarity(description, query), similarity(item_code, query)) as score
  from vinayak.item_codes
  order by greatest(similarity(description, query), similarity(item_code, query)) desc
  limit k;
$$;

-- Likely-duplicate ERP entries for a description (literal repeated codes AND
-- near-duplicate descriptions under different codes).
create or replace function vinayak.duplicate_candidates(ref text, min_sim real default 0.55)
returns table(item_code text, description text, score real)
language sql stable
set search_path = vinayak, extensions, public
as $$
  select item_code, description, similarity(description, ref) as score
  from vinayak.item_codes
  where similarity(description, ref) >= min_sim
  order by similarity(description, ref) desc;
$$;

grant execute on all functions in schema vinayak to anon, authenticated, service_role;
