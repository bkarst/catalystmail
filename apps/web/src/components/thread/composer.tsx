'use client';

// The Thread view's composer (spec §15.7, §11.4 "Reply myself"): write a reply and send it now,
// schedule it, or save it as a draft; or ask the agent to draft one, with optional guidance. The
// text is linted as you write; blockers disable sending, and the server checks again (§7.2).
// Catalyst adds the signature and, where the campaign uses one, the compliance footer.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Send, Sparkles } from 'lucide-react';
import { forwardRef, useEffect, useState } from 'react';

import { api, idempotencyKey, unwrap, type Schemas } from '../../lib/api.ts';
import { cn } from '../../lib/cn.ts';
import { fromLocalInput, toLocalInput } from '../../lib/format.ts';
import { usePerson } from '../../lib/person.tsx';
import { Button, ErrorText, inputClass, Pill, textareaClass } from '../ui.tsx';

type Mode = 'send_now' | 'schedule' | 'draft';

export const Composer = forwardRef<HTMLTextAreaElement, { thread: Schemas['Thread'] }>(function Composer({ thread }, ref) {
  const person = usePerson();
  const client = useQueryClient();
  const [body, setBody] = useState('');
  const [mode, setMode] = useState<Mode>(person.can('messages:send') ? 'send_now' : 'draft');
  const [at, setAt] = useState(() => toLocalInput(new Date(Date.now() + 3_600_000)));
  const [guidance, setGuidance] = useState('');
  const [asking, setAsking] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  // Lint a moment after typing stops.
  const [linted, setLinted] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setLinted(body.trim()), 600);
    return () => clearTimeout(timer);
  }, [body]);
  const lint = useQuery({
    queryKey: ['lint', thread.id, linted],
    enabled: linted.length > 0,
    queryFn: () => unwrap(api.POST('/messages/lint', { body: { subject: `Re: ${thread.subject ?? ''}`.slice(0, 200), body_text: linted } })),
    staleTime: Infinity,
  });

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['thread', thread.id] });
    void client.invalidateQueries({ queryKey: ['work-queue'] });
    void client.invalidateQueries({ queryKey: ['threads'] });
  };
  const reply = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/threads/{threadId}/replies', {
          params: { path: { threadId: thread.id }, ...(mode !== 'draft' && { header: idempotencyKey() }) },
          body: { body_text: body.trim(), mode, ...(mode === 'schedule' && { send_at: fromLocalInput(at) }) },
        }),
      ),
    onSuccess: (message) => {
      setBody('');
      setSent(message.status === 'draft' ? 'Saved as a draft below.' : message.status === 'scheduled' && mode === 'schedule' ? 'Scheduled.' : 'Sending.');
      refresh();
    },
  });
  const draft = useMutation({
    mutationFn: () => unwrap(api.POST('/threads/{threadId}/ai-draft', { params: { path: { threadId: thread.id } }, body: guidance.trim() ? { guidance: guidance.trim() } : {} })),
    onSuccess: () => {
      setAsking(false);
      setGuidance('');
      setSent('The agent drafted a reply; it waits for your approval below.');
      refresh();
    },
  });

  if (!person.can('threads:write')) return null;
  const blockers = lint.data?.findings.filter((finding) => finding.severity === 'blocker') ?? [];
  const warnings = lint.data?.findings.filter((finding) => finding.severity === 'warning') ?? [];
  const busy = reply.isPending || draft.isPending;

  return (
    <form
      id="composer"
      aria-label="Reply"
      className="space-y-2 rounded-[var(--radius-card)] border border-zinc-200 p-3 dark:border-zinc-800"
      onSubmit={(event) => {
        event.preventDefault();
        if (body.trim()) reply.mutate();
      }}
    >
      <textarea
        ref={ref}
        aria-label="Your reply"
        value={body}
        onChange={(event) => (setBody(event.target.value), setSent(null))}
        placeholder={`Reply to ${thread.contact.name ?? thread.contact.email}… (your signature is added)`}
        className={textareaClass}
        maxLength={5000}
      />
      {(blockers.length > 0 || warnings.length > 0) && (
        <ul aria-label="Lint" className="flex flex-wrap gap-1.5 text-xs">
          {[...blockers, ...warnings].map((finding) => (
            <li key={finding.rule + finding.message}>
              <Pill tone={finding.severity === 'blocker' ? 'rose' : 'amber'} title={finding.rule}>
                {finding.message}
              </Pill>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" disabled={busy || !body.trim() || (mode !== 'draft' && blockers.length > 0)}>
          <Send aria-hidden className="size-3.5" />
          {reply.isPending ? 'One moment…' : mode === 'send_now' ? 'Send' : mode === 'schedule' ? 'Schedule' : 'Save draft'}
        </Button>
        <label className="flex items-center gap-1 text-zinc-500 dark:text-zinc-400">
          <span className="sr-only">How to send</span>
          <select value={mode} onChange={(event) => setMode(event.target.value as Mode)} className={cn(inputClass, 'w-auto py-1')}>
            {person.can('messages:send') && <option value="send_now">Send now</option>}
            {person.can('messages:send') && <option value="schedule">Schedule…</option>}
            <option value="draft">Save as draft</option>
          </select>
        </label>
        {mode === 'schedule' && <input type="datetime-local" aria-label="Send at" value={at} onChange={(event) => setAt(event.target.value)} className={cn(inputClass, 'w-auto py-1')} />}
        {!thread.ai_paused && (
          <Button variant="ghost" className="ml-auto" disabled={busy} onClick={() => setAsking(!asking)}>
            <Sparkles aria-hidden className="size-3.5" /> Ask AI to draft
          </Button>
        )}
      </div>
      {asking && (
        <div className="flex gap-2">
          <input value={guidance} onChange={(event) => setGuidance(event.target.value)} placeholder="Guidance, optional: “mention the case study”" aria-label="Guidance for the agent" className={inputClass} maxLength={2000} />
          <Button disabled={busy} onClick={() => draft.mutate()}>
            {draft.isPending ? 'Drafting…' : 'Draft'}
          </Button>
        </div>
      )}
      <ErrorText error={reply.error ?? draft.error} />
      {sent && <p className="text-emerald-700 dark:text-emerald-400">{sent}</p>}
    </form>
  );
});
