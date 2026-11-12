'use client';

// A campaign's Board (spec §15.9): one column per stage, then one per goal; Queued is folded by
// default. Cards show the contact, company, opens, state, next action and temperature; a column
// sorts by temperature on request. Dragging a card forward onto a goal asks "Mark ⟨goal⟩
// achieved?"; dragging it back from a goal asks "Revoke ⟨goal⟩?". Both can be undone. Each card's
// "Move to…" menu does the same from the keyboard. Columns show up to 50 cards.

import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import { Flame } from 'lucide-react';
import Link from 'next/link';
import { useState, type DragEvent } from 'react';

import { api, idempotencyKey, unwrap, type Schemas } from '../../lib/api.ts';
import { cn } from '../../lib/cn.ts';
import { dateTime } from '../../lib/format.ts';
import { usePerson } from '../../lib/person.tsx';
import { OpenMark, StatePill, TemperatureDots } from '../thread-bits.tsx';
import { Button, ErrorText, inputClass, Loading } from '../ui.tsx';

type Thread = Schemas['Thread'];
type Column = { key: string; name: string; rank: number; goal?: Schemas['Goal'] };
type Pending = { kind: 'mark'; thread: Thread; goal: Schemas['Goal'] } | { kind: 'revoke'; thread: Thread; goal: Schemas['Goal'] };

const STAGES = [
  { key: 'queued', name: 'Queued', rank: 0 },
  { key: 'sent', name: 'Sent', rank: 1 },
  { key: 'received', name: 'Received', rank: 2 },
  { key: 'responded', name: 'Responded', rank: 3 },
] as const;

export function Board({ campaign, goals }: { campaign: Schemas['Campaign']; goals: Schemas['Goal'][] }) {
  const person = usePerson();
  const client = useQueryClient();
  const [showQueued, setShowQueued] = useState(false);
  const [byTemperature, setByTemperature] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<Pending | null>(null);
  const [note, setNote] = useState('');
  const [undo, setUndo] = useState<{ text: string; run: () => Promise<unknown> } | null>(null);
  const columns: Column[] = [...STAGES, ...goals.map((goal) => ({ key: `goal:${goal.id}`, name: goal.name, rank: 3 + goal.position, goal }))];

  const queries = useQueries({
    queries: [...STAGES.map((stage) => stage.key), 'goal_achieved'].map((stage) => ({
      queryKey: ['threads', 'board', { campaign_id: campaign.id, stage }],
      queryFn: () => unwrap(api.GET('/threads', { params: { query: { campaign_id: campaign.id, stage: stage as Thread['stage'], limit: 50 } } })),
    })),
  });
  const cardsFor = (column: Column): Thread[] => {
    const list = column.goal ? (queries[4]?.data?.data ?? []).filter((thread) => thread.achieved_goal_id === column.goal!.id) : (queries[STAGES.findIndex((stage) => stage.key === column.key)]?.data?.data ?? []);
    return byTemperature[column.key] ? [...list].sort((a, b) => (b.classification.temperature ?? -1) - (a.classification.temperature ?? -1)) : list;
  };
  const more = (column: Column) => (column.goal ? queries[4]?.data?.next_cursor : queries[STAGES.findIndex((stage) => stage.key === column.key)]?.data?.next_cursor);

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['threads'] });
    void client.invalidateQueries({ queryKey: ['campaign', campaign.id] });
  };
  const mark = (thread: Thread, goal: Schemas['Goal'], evidence?: string) =>
    unwrap(api.POST('/threads/{threadId}/goals/{goalId}/achieve', { params: { path: { threadId: thread.id, goalId: goal.id }, header: idempotencyKey() }, body: evidence ? { note: evidence } : {} }));
  const revoke = (thread: Thread, goal: Schemas['Goal'], reason: string) => unwrap(api.DELETE('/threads/{threadId}/goals/{goalId}/achieve', { params: { path: { threadId: thread.id, goalId: goal.id }, query: { reason } } }));
  const act = useMutation({
    mutationFn: async (action: Pending) => {
      const name = action.thread.contact.name ?? action.thread.contact.email;
      if (action.kind === 'mark') {
        await mark(action.thread, action.goal, note.trim() || undefined);
        setUndo({ text: `${name}: “${action.goal.name}” marked achieved.`, run: () => revoke(action.thread, action.goal, 'Undone on the Board') });
      } else {
        await revoke(action.thread, action.goal, note.trim());
        setUndo({ text: `${name}: “${action.goal.name}” revoked.`, run: () => mark(action.thread, action.goal, 'Restored on the Board') });
      }
    },
    onSuccess: () => {
      setPending(null);
      setNote('');
      refresh();
    },
  });
  const undoIt = useMutation({ mutationFn: () => undo!.run(), onSuccess: () => (setUndo(null), refresh()) });

  /** What dropping a card on a column means, if anything. */
  const intent = (thread: Thread, target: Column): Pending | null => {
    const current = thread.achieved_goal_id ? goals.find((goal) => goal.id === thread.achieved_goal_id) : undefined;
    if (target.goal && target.rank > thread.stage_rank && thread.mailbox_id) return { kind: 'mark', thread, goal: target.goal };
    if (current && target.rank < thread.stage_rank) return { kind: 'revoke', thread, goal: current };
    return null;
  };
  const may = person.can('threads:write');
  const onDrop = (event: DragEvent, target: Column) => {
    event.preventDefault();
    const thread = JSON.parse(event.dataTransfer.getData('application/json') || 'null') as Thread | null;
    if (thread && may) setPending(intent(thread, target));
  };

  if (queries.some((query) => query.isPending)) return <Loading />;
  const failed = queries.find((query) => query.isError);
  if (failed) return <ErrorText error={failed.error} />;

  return (
    <div className="space-y-3">
      {pending && (
        <form
          role="alertdialog"
          aria-label={pending.kind === 'mark' ? `Mark ${pending.goal.name} achieved?` : `Revoke ${pending.goal.name}?`}
          className="flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-indigo-200 bg-indigo-50/50 p-3 dark:border-indigo-900 dark:bg-indigo-950/40"
          onSubmit={(event) => {
            event.preventDefault();
            act.mutate(pending);
          }}
        >
          <span className="font-medium">
            {pending.kind === 'mark' ? 'Mark' : 'Revoke'} “{pending.goal.name}” {pending.kind === 'mark' ? 'achieved' : ''} for {pending.thread.contact.name ?? pending.thread.contact.email}?
          </span>
          <input value={note} onChange={(event) => setNote(event.target.value)} placeholder={pending.kind === 'mark' ? 'Evidence (optional)' : 'Why it was wrong'} aria-label={pending.kind === 'mark' ? 'Evidence' : 'Why it was wrong'} className={cn(inputClass, 'w-64 py-1')} required={pending.kind === 'revoke'} minLength={pending.kind === 'revoke' ? 3 : undefined} />
          <Button type="submit" variant={pending.kind === 'mark' ? 'primary' : 'danger'} disabled={act.isPending}>
            {pending.kind === 'mark' ? 'Mark achieved' : 'Revoke'}
          </Button>
          <Button variant="ghost" onClick={() => setPending(null)}>
            Cancel
          </Button>
          <ErrorText error={act.error} />
        </form>
      )}
      {undo && (
        <p role="status" className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
          {undo.text}
          <Button size="sm" variant="ghost" disabled={undoIt.isPending} onClick={() => undoIt.mutate()}>
            Undo
          </Button>
          <ErrorText error={undoIt.error} />
        </p>
      )}
      <div className="flex gap-3 relative overflow-x-auto pb-2">
        {columns.map((column) => {
          const cards = cardsFor(column);
          const folded = column.key === 'queued' && !showQueued;
          return (
            <section
              key={column.key}
              aria-label={column.name}
              onDragOver={(event) => may && event.preventDefault()}
              onDrop={(event) => onDrop(event, column)}
              className={cn('flex shrink-0 flex-col rounded-[var(--radius-card)] border border-zinc-200 bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-900/30', folded ? 'w-12' : 'w-64')}
            >
              <header className="flex items-center gap-1 border-b border-zinc-200 px-2 py-2 dark:border-zinc-800">
                {folded ? (
                  <button type="button" onClick={() => setShowQueued(true)} className="w-full text-xs text-zinc-500 dark:text-zinc-400 [writing-mode:vertical-rl]" title="Show Queued">
                    Queued {cards.length}
                    {more(column) ? '+' : ''}
                  </button>
                ) : (
                  <>
                    <h2 className="flex-1 truncate font-medium">
                      {column.name} <span className="font-normal text-zinc-500 dark:text-zinc-400">{cards.length}{more(column) ? '+' : ''}</span>
                    </h2>
                    <button type="button" title="Sort by temperature" aria-pressed={Boolean(byTemperature[column.key])} onClick={() => setByTemperature({ ...byTemperature, [column.key]: !byTemperature[column.key] })} className={cn('rounded-[var(--radius-pill)] p-1 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900', byTemperature[column.key] && 'text-amber-600')}>
                      <Flame aria-hidden className="size-3.5" />
                      <span className="sr-only">Sort by temperature</span>
                    </button>
                    {column.key === 'queued' && (
                      <button type="button" onClick={() => setShowQueued(false)} className="text-xs text-zinc-500 dark:text-zinc-400 hover:underline">
                        Fold
                      </button>
                    )}
                  </>
                )}
              </header>
              {!folded && (
                <ul className="flex-1 space-y-2 p-2">
                  {cards.map((thread) => (
                    <BoardCard key={thread.id} thread={thread} columns={columns} may={may} onMove={(target) => setPending(intent(thread, target))} canMoveTo={(target) => intent(thread, target) !== null} />
                  ))}
                  {cards.length === 0 && <li className="px-1 text-xs text-zinc-500 dark:text-zinc-400">None</li>}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

const NEXT: Record<string, string> = { send_initial: 'Initial email', send_reply: 'Reply', send_follow_up: 'Follow-up', await_reply: 'Waiting', none: '' };

function BoardCard({ thread, columns, may, onMove, canMoveTo }: { thread: Thread; columns: Column[]; may: boolean; onMove: (target: Column) => void; canMoveTo: (target: Column) => boolean }) {
  // Forward: each later goal. Back: one entry, since revoking drops to the highest remaining fact.
  const forward = columns.filter((column) => column.goal && column.rank > thread.stage_rank && canMoveTo(column));
  const back = columns.find((column) => column.rank < thread.stage_rank && canMoveTo(column));
  const current = columns.find((column) => column.goal?.id === thread.achieved_goal_id);
  return (
    <li
      draggable={may}
      onDragStart={(event) => {
        event.dataTransfer.setData('application/json', JSON.stringify(thread));
        event.dataTransfer.effectAllowed = 'move';
      }}
      className={cn('space-y-1 rounded-[var(--radius-card)] border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-950', may && 'cursor-grab active:cursor-grabbing')}
    >
      <div className="flex items-start justify-between gap-2">
        <Link href={`/threads/${thread.id}`} className="min-w-0 truncate font-medium hover:underline">
          {thread.contact.name ?? thread.contact.email}
        </Link>
        <OpenMark open={thread.open} />
      </div>
      {thread.contact.company && <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{thread.contact.company}</p>}
      <div className="flex flex-wrap items-center gap-1">
        <StatePill thread={thread} />
      </div>
      {thread.next_action.type !== 'none' && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {NEXT[thread.next_action.type]}
          {thread.next_action.at && ` · ${dateTime(thread.next_action.at)}`}
        </p>
      )}
      {thread.classification.temperature !== null && (
        <div className="text-xs">
          <TemperatureDots value={thread.classification.temperature} />
        </div>
      )}
      {may && (forward.length > 0 || back) && (
        <label className="block text-xs">
          <span className="sr-only">Move {thread.contact.name ?? thread.contact.email} to</span>
          <select
            value=""
            onChange={(event) => {
              const target = columns.find((column) => column.key === event.target.value);
              if (target) onMove(target);
            }}
            className="w-full rounded-[var(--radius-pill)] bg-transparent py-0.5 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            <option value="">Move to…</option>
            {forward.map((column) => (
              <option key={column.key} value={column.key}>
                {column.name}: mark achieved
              </option>
            ))}
            {back && current && <option value={back.key}>Back: revoke “{current.name}”</option>}
          </select>
        </label>
      )}
    </li>
  );
}
