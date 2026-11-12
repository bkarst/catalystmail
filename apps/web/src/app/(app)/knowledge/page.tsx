'use client';

// V15 Knowledge base (spec §15.17): items grouped by kind on the left, filtered by scope, source
// and active state ("Learned from escalations" marked); the editor on the right with title, kind,
// scope and visibility (Shareable or Internal, explained) over markdown content. "Test the agent"
// asks the agent a prospect's question (it calls Claude, so it is billed and needs the agent on),
// and "Knowledge gaps" lists the questions it couldn't answer.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, GraduationCap, Plus, Search } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';

import { Button, ErrorText, inputClass, Loading, Pill, textareaClass } from '../../../components/ui.tsx';
import { api, unwrap, type Schemas } from '../../../lib/api.ts';
import { cn } from '../../../lib/cn.ts';
import { ago, words } from '../../../lib/format.ts';
import { usePerson } from '../../../lib/person.tsx';

type Item = Schemas['KnowledgeItem'];
const KINDS = ['product', 'pricing', 'faq', 'objection', 'policy', 'case_study', 'link', 'other'] as const;
type Kind = (typeof KINDS)[number];
type Draft = { kind: Kind; title: string; content: string; campaign_id: string; visibility: 'shareable' | 'internal'; tags: string; active: boolean };
const EMPTY: Draft = { kind: 'faq', title: '', content: '', campaign_id: '', visibility: 'shareable', tags: '', active: true };

export default function KnowledgePage() {
  const person = usePerson();
  const [filters, setFilters] = useState({ scope: '', source: '', active: '', q: '' });
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const campaigns = useQuery({ queryKey: ['campaigns', 'options'], queryFn: () => unwrap(api.GET('/campaigns', { params: { query: { limit: 100 } } })), staleTime: 300_000 });
  const items = useQuery({
    queryKey: ['knowledge', filters],
    queryFn: () =>
      unwrap(
        api.GET('/knowledge', {
          params: {
            query: {
              limit: 100,
              ...(filters.scope && { scope: filters.scope }),
              ...(filters.source && { source: filters.source as 'manual' | 'escalation' | 'import' | 'api' }),
              ...(filters.active && { active: filters.active as 'true' | 'false' }),
              ...(filters.q.trim() && { q: filters.q.trim() }),
            },
          },
        }),
      ),
  });
  const list = items.data?.data ?? [];
  const campaignName = (id: string | null) => (id ? (campaigns.data?.data.find((campaign) => campaign.id === id)?.name ?? 'A campaign') : 'Every campaign');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Knowledge</h1>
        {person.can('knowledge:write') && (
          <Button variant="primary" className="ml-auto" onClick={() => setSelected('new')}>
            <Plus aria-hidden className="size-4" /> New item
          </Button>
        )}
      </div>
      <Gaps />
      <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <aside aria-label="Knowledge items" className="space-y-3">
          <div className="space-y-2">
            <label className="relative flex items-center">
              <Search aria-hidden className="pointer-events-none absolute left-2.5 size-4 text-zinc-500 dark:text-zinc-400" />
              <span className="sr-only">Search knowledge</span>
              <input type="search" value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} placeholder="Search titles and text…" className={cn(inputClass, 'pl-8')} />
            </label>
            <div className="flex flex-wrap gap-2">
              <select aria-label="Scope" value={filters.scope} onChange={(event) => setFilters({ ...filters, scope: event.target.value })} className={cn(inputClass, 'w-auto py-1')}>
                <option value="">Any scope</option>
                <option value="workspace">Every campaign</option>
                {campaigns.data?.data.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </option>
                ))}
              </select>
              <select aria-label="Source" value={filters.source} onChange={(event) => setFilters({ ...filters, source: event.target.value })} className={cn(inputClass, 'w-auto py-1')}>
                <option value="">Any source</option>
                <option value="manual">Written by a person</option>
                <option value="escalation">Learned from escalations</option>
                <option value="import">Imported</option>
                <option value="api">From the API</option>
              </select>
              <select aria-label="Active" value={filters.active} onChange={(event) => setFilters({ ...filters, active: event.target.value })} className={cn(inputClass, 'w-auto py-1')}>
                <option value="">Active or not</option>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </div>
          </div>
          {items.isPending && <Loading />}
          <ErrorText error={items.error} onRetry={() => void items.refetch()} />
          {items.data && list.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-zinc-500 dark:text-zinc-400">
              <BookOpen aria-hidden className="size-8" />
              <p>No knowledge yet. Add what the agent should know: the product, pricing, common questions.</p>
            </div>
          )}
          {KINDS.filter((kind) => list.some((item) => item.kind === kind)).map((kind) => (
            <section key={kind} aria-label={words(kind)}>
              <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{words(kind)}</h2>
              <ul className="mt-1 space-y-0.5">
                {list
                  .filter((item) => item.kind === kind)
                  .map((item) => (
                    <li key={item.id}>
                      <button type="button" aria-current={selected === item.id ? 'true' : undefined} onClick={() => setSelected(item.id)} className={cn('block w-full rounded-[var(--radius-pill)] px-2 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-900', selected === item.id && 'bg-indigo-50 dark:bg-indigo-950/40', !item.active && 'text-zinc-500 dark:text-zinc-400')}>
                        <span className="block truncate font-medium">{item.title}</span>
                        <span className="flex flex-wrap items-center gap-1 text-xs text-zinc-600 dark:text-zinc-400">
                          {campaignName(item.campaign_id)}
                          {item.visibility === 'internal' && <Pill>Internal</Pill>}
                          {item.source === 'escalation' && (
                            <Pill tone="indigo">
                              <GraduationCap aria-hidden className="size-3" /> Learned from escalations
                            </Pill>
                          )}
                          {!item.active && <Pill>Inactive</Pill>}
                        </span>
                      </button>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        </aside>
        <div className="min-w-0 space-y-4">
          {selected === 'new' ? (
            <Editor key="new" item={null} campaigns={campaigns.data?.data ?? []} onSaved={(item) => setSelected(item.id)} onDeleted={() => setSelected(null)} />
          ) : selected ? (
            <EditorFor id={selected} campaigns={campaigns.data?.data ?? []} onDeleted={() => setSelected(null)} />
          ) : (
            <p className="text-zinc-500 dark:text-zinc-400">Choose an item, or add one.</p>
          )}
          <TestAgent campaigns={campaigns.data?.data ?? []} />
        </div>
      </div>
    </div>
  );
}

function EditorFor({ id, campaigns, onDeleted }: { id: string; campaigns: Schemas['Campaign'][]; onDeleted: () => void }) {
  const item = useQuery({ queryKey: ['knowledge-item', id], queryFn: () => unwrap(api.GET('/knowledge/{itemId}', { params: { path: { itemId: id } } })) });
  if (item.isPending) return <Loading />;
  if (item.isError) return <ErrorText error={item.error} onRetry={() => void item.refetch()} />;
  return <Editor key={item.data.id + item.data.updated_at} item={item.data} campaigns={campaigns} onSaved={() => undefined} onDeleted={onDeleted} />;
}

function Editor({ item, campaigns, onSaved, onDeleted }: { item: Item | null; campaigns: Schemas['Campaign'][]; onSaved: (item: Item) => void; onDeleted: () => void }) {
  const person = usePerson();
  const client = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => (item ? { kind: item.kind as Kind, title: item.title, content: item.content, campaign_id: item.campaign_id ?? '', visibility: item.visibility, tags: item.tags.join(', '), active: item.active } : EMPTY));
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => setSaved(false), [draft]);
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['knowledge'] });
    void client.invalidateQueries({ queryKey: ['knowledge-item'] });
  };
  const body = { kind: draft.kind, title: draft.title.trim(), content: draft.content, campaign_id: draft.campaign_id || null, visibility: draft.visibility, tags: draft.tags.split(',').map((tag) => tag.trim()).filter(Boolean), active: draft.active };
  const save = useMutation({
    mutationFn: () => (item ? unwrap(api.PATCH('/knowledge/{itemId}', { params: { path: { itemId: item.id } }, body })) : unwrap(api.POST('/knowledge', { body: { ...body, campaign_id: draft.campaign_id || undefined } }))),
    onSuccess: (result) => (setSaved(true), refresh(), onSaved(result)),
  });
  const remove = useMutation({ mutationFn: () => unwrap(api.DELETE('/knowledge/{itemId}', { params: { path: { itemId: item!.id } } })), onSuccess: () => (refresh(), onDeleted()) });
  const may = person.can('knowledge:write');

  return (
    <form
      aria-label={item ? `Edit ${item.title}` : 'New knowledge item'}
      className="space-y-3 rounded-[var(--radius-card)] border border-zinc-200 p-4 dark:border-zinc-800"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <label className="block text-xs text-zinc-500 dark:text-zinc-400">
        Title
        <input required disabled={!may} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} className={cn(inputClass, 'mt-0.5 text-sm text-zinc-900 dark:text-zinc-100')} maxLength={200} />
      </label>
      <div className="flex flex-wrap gap-3">
        <label className="text-xs text-zinc-500 dark:text-zinc-400">
          Kind
          <select disabled={!may} value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as Kind })} className={cn(inputClass, 'mt-0.5 w-auto text-sm text-zinc-900 dark:text-zinc-100')}>
            {KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {words(kind)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-zinc-500 dark:text-zinc-400">
          Applies to
          <select disabled={!may} value={draft.campaign_id} onChange={(event) => setDraft({ ...draft, campaign_id: event.target.value })} className={cn(inputClass, 'mt-0.5 w-auto text-sm text-zinc-900 dark:text-zinc-100')}>
            <option value="">Every campaign</option>
            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-zinc-500 dark:text-zinc-400">
          Tags
          <input disabled={!may} value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} placeholder="sso, security" className={cn(inputClass, 'mt-0.5 w-56 text-sm text-zinc-900 dark:text-zinc-100')} />
        </label>
      </div>
      <fieldset className="space-y-1">
        <legend className="text-xs text-zinc-500 dark:text-zinc-400">Visibility</legend>
        <label className="flex items-start gap-2">
          <input type="radio" name="visibility" className="mt-1" disabled={!may} checked={draft.visibility === 'shareable'} onChange={() => setDraft({ ...draft, visibility: 'shareable' })} />
          <span>
            Shareable <span className="text-zinc-500 dark:text-zinc-400">· the agent may quote it to prospects</span>
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" name="visibility" className="mt-1" disabled={!may} checked={draft.visibility === 'internal'} onChange={() => setDraft({ ...draft, visibility: 'internal' })} />
          <span>
            Internal <span className="text-zinc-500 dark:text-zinc-400">· for people only; never sent to the model</span>
          </span>
        </label>
      </fieldset>
      <label className="block text-xs text-zinc-500 dark:text-zinc-400">
        Content (markdown)
        <textarea required disabled={!may} value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} className={cn(textareaClass, 'mt-0.5 min-h-56 font-mono text-sm text-zinc-900 dark:text-zinc-100')} />
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" disabled={!may} checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} /> Active: the agent uses it
      </label>
      {item && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {item.source === 'escalation' ? 'Learned from an answered escalation' : words(item.source)} · changed {ago(item.updated_at)}
        </p>
      )}
      {may && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" disabled={save.isPending}>
            {item ? 'Save' : 'Add'}
          </Button>
          {saved && (
            <span role="status" className="text-emerald-700 dark:text-emerald-400">
              Saved.
            </span>
          )}
          {item &&
            (deleting ? (
              <>
                <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
                  Delete: the agent stops using it at once
                </Button>
                <Button variant="ghost" onClick={() => setDeleting(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button variant="ghost" className="ml-auto" onClick={() => setDeleting(true)}>
                Delete…
              </Button>
            ))}
        </div>
      )}
      <ErrorText error={save.error ?? remove.error} />
    </form>
  );
}

function TestAgent({ campaigns }: { campaigns: Schemas['Campaign'][] }) {
  const [question, setQuestion] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const test = useMutation({ mutationFn: () => unwrap(api.POST('/knowledge/test', { body: { question: question.trim(), ...(campaignId && { campaign_id: campaignId }) } })) });
  return (
    <section aria-label="Test the agent" className="space-y-2 rounded-[var(--radius-card)] border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="font-medium">Test the agent</h2>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">Ask a question as a prospect might. The agent answers from the shareable knowledge, or says it would escalate. Each test is one Claude call.</p>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          test.mutate();
        }}
      >
        <input required minLength={3} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Do you support SAML SSO?" aria-label="Question" className={cn(inputClass, 'min-w-64 flex-1')} />
        <select aria-label="Campaign" value={campaignId} onChange={(event) => setCampaignId(event.target.value)} className={cn(inputClass, 'w-auto')}>
          <option value="">Workspace knowledge</option>
          {campaigns.map((campaign) => (
            <option key={campaign.id} value={campaign.id}>
              {campaign.name}
            </option>
          ))}
        </select>
        <Button type="submit" disabled={test.isPending}>
          {test.isPending ? 'Asking…' : 'Ask'}
        </Button>
      </form>
      <ErrorText error={test.error} />
      {test.data && (
        <div className="space-y-1">
          {test.data.answerable ? <Pill tone="emerald">Answerable ✓</Pill> : <Pill tone="amber">Would escalate: knowledge gap</Pill>}
          {test.data.answer && <p className="whitespace-pre-wrap rounded-[var(--radius-card)] bg-zinc-50 p-3 dark:bg-zinc-900/50">{test.data.answer}</p>}
          {test.data.citations.length > 0 && <p className="text-xs text-zinc-500 dark:text-zinc-400">Cites: {test.data.citations.map((citation) => citation.title).join(', ')}</p>}
        </div>
      )}
    </section>
  );
}

function Gaps() {
  const gaps = useQuery({ queryKey: ['knowledge-gaps'], queryFn: () => unwrap(api.GET('/analytics/knowledge-gaps', { params: { query: { days: 90, limit: 20 } } })), retry: false });
  const open = (gaps.data?.data ?? []).filter((gap) => !gap.answered);
  if (!gaps.data || open.length === 0) return null;
  return (
    <details className="rounded-[var(--radius-card)] border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950">
      <summary className="cursor-pointer font-medium text-amber-800 dark:text-amber-200">Knowledge gaps: {open.length} question{open.length === 1 ? '' : 's'} the agent couldn’t answer in the last 90 days</summary>
      <ul className="mt-2 space-y-1">
        {open.map((gap) => (
          <li key={gap.question} className="flex flex-wrap items-baseline gap-2">
            <span>{gap.question}</span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              asked {gap.asked}× · {gap.open} open · last {ago(gap.last_asked_at)}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
