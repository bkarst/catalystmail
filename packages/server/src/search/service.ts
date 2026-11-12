// ⌘K search (spec §12.2): contacts, companies, threads and campaigns in one list. Postgres
// full-text search plus trigram similarity, so partial words and small typos still match.

import { type Db } from '@catalyst/db';
import { sql } from 'drizzle-orm';

import type { Principal } from '../api/auth.ts';
import { escapeLike } from '../shared.ts';

export type SearchResult = {
  kind: 'contact' | 'company' | 'thread' | 'campaign';
  id: string;
  title: string;
  subtitle: string | null;
};

export async function searchAll(db: Db, principal: Principal, query: { q: string; limit: number }): Promise<{ data: SearchResult[] }> {
  const workspaceId = principal.workspace.id;
  const term = query.q.trim();
  if (!term) return { data: [] };
  const like = `%${escapeLike(term)}%`;
  const prefix = `${escapeLike(term)}%`;
  const scopes = principal.scopes;

  // Each part scores its rows: an exact or prefix match beats a substring, which beats a fuzzy one.
  const parts = [
    sql`
      select 'contact' as kind, c.id,
        coalesce(nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), ''), c.email::text) as title,
        concat_ws(' · ', nullif(c.title, ''), co.name, c.email::text) as subtitle,
        greatest(
          case when c.email::text ilike ${prefix} or c.first_name ilike ${prefix} or c.last_name ilike ${prefix} then 1.0 else 0 end,
          case when c.email::text ilike ${like} or (coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')) ilike ${like} or co.name ilike ${like} then 0.8 else 0 end,
          ts_rank(c.search, plainto_tsquery('simple', ${term})),
          word_similarity(${term}, coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')) * 0.7
        ) as score
      from contacts c left join companies co on co.id = c.company_id and co.deleted_at is null
      where c.workspace_id = ${workspaceId} and c.deleted_at is null and (
        c.search @@ plainto_tsquery('simple', ${term}) or c.email::text ilike ${like}
        or (coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')) ilike ${like} or co.name ilike ${like}
        or word_similarity(${term}, coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')) > 0.5)`,
    sql`
      select 'company', id, name, domain::text,
        greatest(case when name ilike ${prefix} or domain::text ilike ${prefix} then 1.0 else 0 end,
                 case when name ilike ${like} or domain::text ilike ${like} then 0.8 else 0 end,
                 word_similarity(${term}, name) * 0.7)
      from companies where workspace_id = ${workspaceId} and deleted_at is null
        and (name ilike ${like} or domain::text ilike ${like} or word_similarity(${term}, name) > 0.5)`,
  ];
  if (scopes.includes('threads:read')) {
    parts.push(sql`
      select 'thread', t.id, coalesce(nullif(t.subject, ''), '(no subject)'),
        concat_ws(' · ', nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), ''), cm.name),
        case when t.subject ilike ${like} then 0.7 else 0.5 end
      from threads t join contacts c on c.id = t.contact_id join campaigns cm on cm.id = t.campaign_id
      where t.workspace_id = ${workspaceId} and (
        t.subject ilike ${like}
        or exists (select 1 from messages m where m.thread_id = t.id and m.snippet ilike ${like}))`);
  }
  if (scopes.includes('campaigns:read')) {
    parts.push(sql`
      select 'campaign', id, name, status::text,
        greatest(case when name ilike ${prefix} then 1.0 else 0 end, case when name ilike ${like} then 0.8 else 0 end, word_similarity(${term}, name) * 0.7)
      from campaigns where workspace_id = ${workspaceId} and deleted_at is null and (name ilike ${like} or word_similarity(${term}, name) > 0.5)`);
  }

  const result = await db.execute<SearchResult & { score: number }>(
    sql`select kind, id, title, subtitle, score from (${sql.join(parts, sql` union all `)}) results order by score desc, title asc limit ${query.limit}`,
  );
  return { data: result.rows.map(({ kind, id, title, subtitle }) => ({ kind, id, title, subtitle: subtitle || null })) };
}
