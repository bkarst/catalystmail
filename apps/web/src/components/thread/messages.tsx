'use client';

// The conversation in the Thread view (spec §15.7): each email with its author badge, step label
// and status chips, folded except the latest; stage and state changes as hairline dividers between
// them; and drafts waiting for approval as cards with Approve, Edit, Regenerate and Reject.
// Inbound mail shows as text: the API serves no HTML part, so no remote content ever loads.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bot, CheckCircle2, FileCode2, Paperclip, Pencil, RefreshCw, Send, Sparkles, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { activityText, isDivider } from '../../lib/activity.ts';
import { api, idempotencyKey, unwrap, type Schemas } from '../../lib/api.ts';
import { cn } from '../../lib/cn.ts';
import { AUTHOR, dateTime, fromLocalInput, toLocalInput, words } from '../../lib/format.ts';
import { usePerson } from '../../lib/person.tsx';
import { Button, ErrorText, inputClass, Pill, textareaClass, type Tone } from '../ui.tsx';

type Message = Schemas['Message'];
type Activity = Schemas['Activity'];

const AUTHOR_TONE: Record<string, Tone> = { template: 'sky', ai: 'indigo', human_app: 'emerald', human_external: 'emerald', contact: 'zinc', third_party: 'amber', system: 'zinc' };
const STATUS_TONE: Record<string, Tone> = { sent: 'zinc', scheduled: 'sky', sending: 'sky', bounced: 'rose', failed: 'rose', cancelled: 'zinc', superseded: 'zinc', send_unknown: 'amber', draft: 'amber', pending_approval: 'amber', received: 'zinc' };

const DRAFT = new Set(['draft', 'pending_approval']);

/** Emails and dividers in time order. Drafts are left out: they show as cards below. */
export function Conversation({ messages, activity, goalName, stepLabel }: { messages: Message[]; activity: Activity[]; goalName: (id: string) => string | undefined; stepLabel: (stepId: string | null) => string | null }) {
  const shown = messages.filter((message) => !DRAFT.has(message.status));
  const latest = shown.at(-1)?.id;
  const at = (message: Message) => message.sent_at ?? message.received_at ?? message.scheduled_for ?? message.created_at;
  type Item = { kind: 'message'; at: string; message: Message } | { kind: 'divider'; at: string; divider: Activity };
  const items: Item[] = [
    ...shown.map((message) => ({ kind: 'message' as const, at: at(message), message })),
    ...activity.filter(isDivider).map((entry) => ({ kind: 'divider' as const, at: entry.occurred_at, divider: entry })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  if (items.length === 0) return <p className="text-zinc-500 dark:text-zinc-400">Nothing has been sent yet.</p>;
  return (
    <ol className="space-y-3">
      {items.map((item) =>
        item.kind === 'message' ? (
          <li key={item.message.id}>
            <MessageItem message={item.message} open={item.message.id === latest} step={stepLabel(item.message.step_id)} />
          </li>
        ) : (
          <li key={item.divider.id} className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
            <span aria-hidden className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
            {activityText(item.divider, goalName)} · {dateTime(item.divider.occurred_at)}
            <span aria-hidden className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
          </li>
        ),
      )}
    </ol>
  );
}

function MessageItem({ message, open, step }: { message: Message; open: boolean; step: string | null }) {
  const client = useQueryClient();
  const person = usePerson();
  const inbound = message.direction === 'inbound';
  const when = message.sent_at ?? message.received_at ?? message.scheduled_for ?? message.created_at;
  const text = inbound ? (message.stripped_text ?? message.body_text) : message.body_text;
  const cancel = useMutation({
    mutationFn: () => unwrap(api.POST('/messages/{messageId}/cancel', { params: { path: { messageId: message.id } } })),
    onSuccess: () => client.invalidateQueries({ queryKey: ['thread', message.thread_id] }),
  });
  const [full, setFull] = useState(false);

  return (
    <details open={open} className={cn('group rounded-[var(--radius-card)] border border-zinc-200 dark:border-zinc-800', inbound && 'bg-zinc-50 dark:bg-zinc-900/40')}>
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2.5 [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="text-zinc-500 dark:text-zinc-400 transition-transform group-open:rotate-90">
          ▸
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">{message.subject}</span>
        <Pill tone={AUTHOR_TONE[message.author] ?? 'zinc'}>{AUTHOR[message.author] ?? message.author}</Pill>
        {step && <Pill>{step}</Pill>}
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{dateTime(when)}</span>
      </summary>
      <div className="space-y-3 border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {message.from_name ? `${message.from_name} <${message.from_email}>` : message.from_email} → {(message.to_emails as string[]).join(', ')}
        </p>
        <div className="whitespace-pre-wrap break-words leading-relaxed">{full ? message.body_text : text}</div>
        {inbound && message.stripped_text && message.body_text && message.body_text !== message.stripped_text && (
          <button type="button" className="text-xs text-zinc-500 dark:text-zinc-400 hover:underline" onClick={() => setFull(!full)}>
            {full ? 'Hide quoted text' : 'Show quoted text'}
          </button>
        )}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <Pill tone={STATUS_TONE[message.status] ?? 'zinc'}>{message.status === 'scheduled' ? `Scheduled ${dateTime(message.scheduled_for)}` : words(message.status)}</Pill>
          {!inbound && message.open_count > 0 && <Pill tone={message.human_open ? 'emerald' : 'zinc'}>{message.human_open ? `Opened ${message.open_count}×` : 'Opened (auto)'}</Pill>}
          {inbound && message.inbound_kind && <Pill>{words(message.inbound_kind)}</Pill>}
          {message.has_attachments && (
            <Pill>
              <Paperclip aria-hidden className="size-3" /> Attachments
            </Pill>
          )}
          {message.error && <Pill tone="rose">{message.error}</Pill>}
          {message.status !== 'scheduled' && message.status !== 'cancelled' && (
            <a href={`/api/v1/messages/${message.id}/raw`} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-zinc-500 dark:text-zinc-400 hover:underline">
              <FileCode2 aria-hidden className="size-3" /> View original
            </a>
          )}
          {message.status === 'scheduled' && person.can('threads:write') && (
            <Button size="sm" variant="ghost" className="ml-auto" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
              Cancel sending
            </Button>
          )}
        </div>
        <ErrorText error={cancel.error} />
      </div>
    </details>
  );
}

/** A draft or an email waiting for approval (§15.5 "Review drafts", §15.7 "Suggested reply"). */
export function DraftCard({ draft, showThreadLink = false }: { draft: Message; showThreadLink?: boolean }) {
  const client = useQueryClient();
  const person = usePerson();
  const [mode, setMode] = useState<'view' | 'edit' | 'reject' | 'regenerate'>('view');
  const [body, setBody] = useState(draft.body_text ?? '');
  const [reason, setReason] = useState('');
  const [feedback, setFeedback] = useState('');
  const [later, setLater] = useState<string | null>(null);
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['thread', draft.thread_id] });
    void client.invalidateQueries({ queryKey: ['work-queue'] });
    void client.invalidateQueries({ queryKey: ['message', draft.id] });
    void client.invalidateQueries({ queryKey: ['threads'] });
  };
  const messageId = draft.id;
  const approve = useMutation({
    mutationFn: () => unwrap(api.POST('/messages/{messageId}/approve', { params: { path: { messageId }, header: idempotencyKey() }, body: later ? { send_at: fromLocalInput(later) } : {} })),
    onSuccess: refresh,
  });
  const save = useMutation({
    mutationFn: () => unwrap(api.PATCH('/messages/{messageId}', { params: { path: { messageId } }, body: { body_text: body.trim() } })),
    onSuccess: () => {
      setMode('view');
      refresh();
    },
  });
  const reject = useMutation({
    mutationFn: async (regenerate: boolean) => {
      // "Regenerate with feedback": the agent drafts again with the feedback as its guidance, and
      // only then is this draft rejected, so a failed redraft loses nothing.
      if (regenerate && draft.thread_id) await unwrap(api.POST('/threads/{threadId}/ai-draft', { params: { path: { threadId: draft.thread_id } }, body: feedback.trim() ? { guidance: feedback.trim() } : {} }));
      return unwrap(api.POST('/messages/{messageId}/reject', { params: { path: { messageId } }, body: { reason: regenerate ? 'Regenerated with feedback' : reason.trim(), ...(feedback.trim() && { feedback: feedback.trim() }) } }));
    },
    onSettled: refresh,
  });
  const busy = approve.isPending || save.isPending || reject.isPending;
  const blockers = (draft.lint ?? []).filter((finding) => finding.severity === 'blocker');
  const warnings = (draft.lint ?? []).filter((finding) => finding.severity === 'warning');

  return (
    <article aria-label={`Draft: ${draft.subject}`} className="space-y-3 rounded-[var(--radius-card)] border border-indigo-200 bg-indigo-50/40 p-4 dark:border-indigo-900 dark:bg-indigo-950/30">
      <header className="flex flex-wrap items-center gap-2">
        {draft.author === 'ai' ? <Bot aria-hidden className="size-4 text-indigo-600" /> : <Pencil aria-hidden className="size-4 text-zinc-500 dark:text-zinc-400" />}
        <span className="font-medium">{draft.author === 'ai' ? 'Suggested reply (AI)' : 'Your draft'}</span>
        <Pill tone="amber">{draft.status === 'pending_approval' ? 'Waiting for approval' : 'Draft'}</Pill>
        <span className="ml-auto text-xs text-zinc-500 dark:text-zinc-400">{dateTime(draft.created_at)}</span>
      </header>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{draft.subject}</p>
      {mode === 'edit' ? (
        <textarea aria-label="Draft text" value={body} onChange={(event) => setBody(event.target.value)} className={cn(textareaClass, 'min-h-48')} />
      ) : (
        <div className="whitespace-pre-wrap break-words leading-relaxed">{draft.body_text}</div>
      )}
      <div className="flex flex-wrap gap-1.5 text-xs">
        {draft.lint === null ? null : blockers.length === 0 && warnings.length === 0 ? (
          <Pill tone="emerald">
            <CheckCircle2 aria-hidden className="size-3" /> Lint ✓
          </Pill>
        ) : (
          [...blockers, ...warnings].map((finding) => (
            <Pill key={finding.rule + finding.message} tone={finding.severity === 'blocker' ? 'rose' : 'amber'} title={finding.rule}>
              {finding.severity === 'blocker' && <XCircle aria-hidden className="size-3" />}
              {finding.message}
            </Pill>
          ))
        )}
      </div>

      {person.can('threads:write') && (
        <div className="space-y-2">
          {mode === 'view' && (
            <div className="flex flex-wrap items-center gap-2">
              {person.can('messages:send') && (
                <Button variant="primary" data-shortcut="approve" disabled={busy || blockers.length > 0} onClick={() => approve.mutate()} title={blockers.length ? 'Fix the blockers first' : 'Approve (e)'}>
                  <Send aria-hidden className="size-3.5" /> {later ? 'Approve and schedule' : 'Approve and send'}
                </Button>
              )}
              {person.can('messages:send') && (
                <label className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                  <input type="checkbox" checked={later !== null} onChange={(event) => setLater(event.target.checked ? toLocalInput(new Date(Date.now() + 3_600_000)) : null)} /> Later
                </label>
              )}
              {later !== null && <input type="datetime-local" aria-label="Send at" value={later} onChange={(event) => setLater(event.target.value)} className={cn(inputClass, 'w-auto py-1')} />}
              <Button disabled={busy} onClick={() => setMode('edit')}>
                Edit
              </Button>
              {draft.author === 'ai' && (
                <Button disabled={busy} onClick={() => setMode('regenerate')}>
                  <RefreshCw aria-hidden className="size-3.5" /> Regenerate
                </Button>
              )}
              <Button variant="danger" disabled={busy} onClick={() => setMode('reject')}>
                Reject
              </Button>
              {showThreadLink && draft.thread_id && (
                <Link href={`/threads/${draft.thread_id}`} className="ml-auto text-xs text-indigo-700 hover:underline dark:text-indigo-300">
                  View thread →
                </Link>
              )}
            </div>
          )}
          {mode === 'edit' && (
            <div className="flex gap-2">
              <Button variant="primary" disabled={busy || !body.trim()} onClick={() => save.mutate()}>
                Save
              </Button>
              <Button variant="ghost" onClick={() => (setMode('view'), setBody(draft.body_text ?? ''))}>
                Cancel
              </Button>
            </div>
          )}
          {(mode === 'reject' || mode === 'regenerate') && (
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                reject.mutate(mode === 'regenerate');
              }}
            >
              {mode === 'reject' && <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why (for the log)" aria-label="Why it is rejected" className={inputClass} minLength={3} required />}
              <textarea value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder={mode === 'regenerate' ? 'What the new draft should do differently, e.g. “answer the SSO question first”' : 'What a redraft should do differently (optional)'} aria-label="Feedback" className={cn(textareaClass, 'min-h-16')} required={mode === 'regenerate'} />
              <div className="flex gap-2">
                <Button type="submit" variant={mode === 'reject' ? 'danger' : 'primary'} disabled={busy}>
                  {mode === 'regenerate' ? (
                    <>
                      <Sparkles aria-hidden className="size-3.5" /> {reject.isPending ? 'Drafting…' : 'Regenerate'}
                    </>
                  ) : (
                    'Reject'
                  )}
                </Button>
                <Button variant="ghost" onClick={() => setMode('view')}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
          <ErrorText error={approve.error ?? save.error ?? reject.error} />
        </div>
      )}
    </article>
  );
}
