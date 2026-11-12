'use client';

// Builder step 4, Emails (spec §15.10, §15.9 "Emails tab", §5.10): the initial email (mode, A/B
// variants, a rendered preview with its template problems and lint), then each follow-up sequence
// in stage order: its steps (wait, mode, subject unless sent as a reply, text or brief, AI
// guidance), adding and removing steps, and what happens after the last one. A stage without a
// sequence can get one. The defaults of §5.10 were made with the campaign.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { api, unwrap, type Schemas } from '../../lib/api.ts';
import { cn } from '../../lib/cn.ts';
import { Button, ErrorText, inputClass, Loading, Pill, textareaClass } from '../ui.tsx';
import { FINISH, MODE, stageName, waitText } from '../campaign/bits.tsx';
import { Card, fieldClass, Labeled } from './common.tsx';

type Step = Schemas['Step'];
type Variant = Schemas['Variant'];
const VARIABLES = ['{{ contact.first_name | default: "there" }}', '{{ company.name }}', '{{ contact.title }}', '{{ sender.first_name }}', '{{ campaign.links.booking }}'];
const MODES = Object.keys(MODE) as (keyof typeof MODE)[];

export function EmailsStep({ campaign }: { campaign: Schemas['Campaign'] }) {
  const campaignId = campaign.id;
  const initial = useQuery({ queryKey: ['campaign', campaignId, 'initial-email'], queryFn: () => unwrap(api.GET('/campaigns/{campaignId}/initial-email', { params: { path: { campaignId } } })), retry: false });
  const sequences = useQuery({ queryKey: ['campaign', campaignId, 'steps'], queryFn: () => unwrap(api.GET('/campaigns/{campaignId}/follow-up-sequences', { params: { path: { campaignId } } })) });
  const goals = useQuery({ queryKey: ['campaign', campaignId, 'goals'], queryFn: () => unwrap(api.GET('/campaigns/{campaignId}/goals', { params: { path: { campaignId } } })) });
  const goalList = [...(goals.data?.data ?? [])].sort((a, b) => a.position - b.position);
  const stageOrder = ['sent', 'received', 'responded', ...goalList.slice(0, -1).map((goal) => `goal:${goal.key}`)];
  const covered = new Set((sequences.data?.data ?? []).flatMap((sequence) => sequence.stages));

  return (
    <div className="space-y-4">
      <Card title="4 · Emails" description="Templates use Liquid: variables in {{ }}, with a default for anything that may be empty.">
        <p className="flex flex-wrap gap-1 text-xs">
          {VARIABLES.map((variable) => (
            <code key={variable} className="rounded-[var(--radius-pill)] bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-900">
              {variable}
            </code>
          ))}
        </p>
      </Card>
      <Card title="Initial email">{initial.isPending ? <Loading /> : initial.isError ? <ErrorText error={initial.error} onRetry={() => void initial.refetch()} /> : <InitialEmail campaignId={campaignId} step={initial.data} />}</Card>
      {sequences.isPending && <Loading />}
      <ErrorText error={sequences.error} onRetry={() => void sequences.refetch()} />
      {[...(sequences.data?.data ?? [])]
        .sort((a, b) => Math.min(...a.stages.map((stage) => stageOrder.indexOf(stage))) - Math.min(...b.stages.map((stage) => stageOrder.indexOf(stage))))
        .map((sequence) => (
          <SequenceEditor key={sequence.id} campaignId={campaignId} sequence={sequence} goals={goalList} stageOrder={stageOrder} others={(sequences.data?.data ?? []).filter((other) => other.id !== sequence.id)} />
        ))}
      {stageOrder
        .filter((stage) => !covered.has(stage))
        .map((stage) => (
          <NewSequence key={stage} campaignId={campaignId} stage={stage} goals={goalList} />
        ))}
    </div>
  );
}

function InitialEmail({ campaignId, step }: { campaignId: string; step: Step }) {
  const client = useQueryClient();
  const refresh = () => void client.invalidateQueries({ queryKey: ['campaign', campaignId] });
  const [guidance, setGuidance] = useState(step.ai_guidance ?? '');
  const setMode = useMutation({ mutationFn: (body: { mode: 'template' | 'ai_opening_line' | 'ai_adapt' | 'ai_write'; ai_guidance?: string | null }) => unwrap(api.PUT('/campaigns/{campaignId}/initial-email', { params: { path: { campaignId } }, body })), onSuccess: refresh });
  const addVariant = useMutation({ mutationFn: () => unwrap(api.POST('/campaigns/{campaignId}/steps/{stepId}/variants', { params: { path: { campaignId, stepId: step.id } }, body: { subject_template: step.variants[0]?.subject_template ?? 'Quick question', body_template: step.variants[0]?.body_template ?? 'Hi {{ contact.first_name | default: "there" }},' } })), onSuccess: refresh });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <Labeled label="How it’s written" className="block">
          <select value={step.mode} disabled={setMode.isPending} onChange={(event) => setMode.mutate({ mode: event.target.value as 'template' | 'ai_opening_line' })} className={cn(inputClass, fieldClass, 'w-auto')}>
            <option value="template">Template: sent as written, variables filled in</option>
            <option value="ai_opening_line">AI opening line: the template plus a first line about the contact</option>
            <option value="ai_write">AI writes: from the guidance and the first goal’s playbook</option>
          </select>
        </Labeled>
        {step.mode !== 'template' && (
          <form
            className="flex flex-1 items-end gap-2"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              setMode.mutate({ mode: step.mode, ai_guidance: guidance.trim() || null });
            }}
          >
            <Labeled label="Guidance for the AI" className="block flex-1">
              <input value={guidance} onChange={(event) => setGuidance(event.target.value)} placeholder="Mention something specific from their title or company." className={cn(inputClass, fieldClass)} maxLength={4000} />
            </Labeled>
            <Button type="submit" size="sm" disabled={setMode.isPending}>
              Save
            </Button>
          </form>
        )}
      </div>
      <ErrorText error={setMode.error} />
      {step.variants.map((variant) => (
        <VariantEditor key={variant.id} campaignId={campaignId} step={step} variant={variant} subject canDelete={step.variants.length > 1} />
      ))}
      <Button size="sm" variant="ghost" disabled={addVariant.isPending} onClick={() => addVariant.mutate()}>
        <Plus aria-hidden className="size-3.5" /> Add A/B variant
      </Button>
      <ErrorText error={addVariant.error} />
      <Preview campaignId={campaignId} stepId={step.id} />
    </div>
  );
}

function VariantEditor({ campaignId, step, variant, subject, canDelete }: { campaignId: string; step: Step; variant: Variant; subject: boolean; canDelete: boolean }) {
  const client = useQueryClient();
  const [form, setForm] = useState({ subject: variant.subject_template ?? '', body: variant.body_template, weight: String(variant.weight), active: variant.active });
  const path = { params: { path: { campaignId, stepId: step.id, variantId: variant.id } } };
  const refresh = () => void client.invalidateQueries({ queryKey: ['campaign', campaignId] });
  const save = useMutation({ mutationFn: () => unwrap(api.PATCH('/campaigns/{campaignId}/steps/{stepId}/variants/{variantId}', { ...path, body: { ...(subject && { subject_template: form.subject }), body_template: form.body, weight: Number(form.weight), active: form.active } })), onSuccess: refresh });
  const remove = useMutation({ mutationFn: () => unwrap(api.DELETE('/campaigns/{campaignId}/steps/{stepId}/variants/{variantId}', path)), onSuccess: refresh });
  return (
    <form
      aria-label={`Variant ${variant.label}`}
      className="space-y-2 rounded-[var(--radius-card)] border border-zinc-200 p-3 dark:border-zinc-800"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        {step.variants.length > 1 && <Pill>Variant {variant.label}</Pill>}
        {step.variants.length > 1 && (
          <label className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
            Weight <input type="number" min={0} max={100} value={form.weight} onChange={(event) => setForm({ ...form, weight: event.target.value })} className={cn(inputClass, 'w-16 py-0.5')} />
          </label>
        )}
        <label className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          <input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} /> Active
        </label>
      </div>
      {subject && (
        <Labeled label="Subject">
          <input required maxLength={300} value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} className={cn(inputClass, fieldClass)} />
        </Labeled>
      )}
      <Labeled label={step.mode === 'ai_adapt' || step.mode === 'ai_write' ? 'Brief for the AI' : 'Text'}>
        <textarea required value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} className={cn(textareaClass, fieldClass, 'min-h-32 font-mono')} maxLength={20_000} />
      </Labeled>
      {variant.issues.length > 0 && (
        <ul className="text-xs text-rose-700 dark:text-rose-300">
          {variant.issues.map((issue) => (
            <li key={issue.code + issue.message}>{issue.message}</li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={save.isPending}>
          Save
        </Button>
        {save.isSuccess && (
          <span role="status" className="text-xs text-emerald-700 dark:text-emerald-400">
            Saved.
          </span>
        )}
        {canDelete && (
          <Button size="sm" variant="ghost" className="ml-auto" disabled={remove.isPending} onClick={() => remove.mutate()}>
            Delete variant
          </Button>
        )}
      </div>
      <ErrorText error={save.error ?? remove.error} />
    </form>
  );
}

/** The step rendered for an enrolled contact (or a sample), with problems and lint (§15.9). */
function Preview({ campaignId, stepId }: { campaignId: string; stepId: string }) {
  const [shown, setShown] = useState(false);
  // For a sample contact, or for someone already in the campaign (§15.10: "preview against a real thread").
  const [contactId, setContactId] = useState('');
  const threads = useQuery({ queryKey: ['threads', 'preview-for', campaignId], enabled: shown, queryFn: () => unwrap(api.GET('/threads', { params: { query: { campaign_id: campaignId, limit: 20 } } })) });
  const preview = useQuery({
    queryKey: ['campaign', campaignId, 'preview', stepId, contactId],
    enabled: shown,
    queryFn: () => unwrap(api.POST('/campaigns/{campaignId}/steps/{stepId}/preview', { params: { path: { campaignId, stepId } }, body: contactId ? { contact_id: contactId } : {} })),
  });
  if (!shown)
    return (
      <Button size="sm" variant="ghost" onClick={() => setShown(true)}>
        Preview
      </Button>
    );
  return (
    <div className="space-y-1 rounded-[var(--radius-card)] bg-zinc-50 p-3 dark:bg-zinc-900/50">
      <label className="flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-400">
        Preview for
        <select value={contactId} onChange={(event) => setContactId(event.target.value)} className={cn(inputClass, 'w-auto py-0.5')}>
          <option value="">A sample contact</option>
          {threads.data?.data.map((thread) => (
            <option key={thread.id} value={thread.contact.id}>
              {thread.contact.name ?? thread.contact.email}
            </option>
          ))}
        </select>
      </label>
      {preview.isPending && <Loading />}
      <ErrorText error={preview.error} onRetry={() => void preview.refetch()} />
      {preview.data && (
        <>
          <p className="flex items-center gap-2">
            {preview.data.sendable ? <Pill tone="emerald">Sendable</Pill> : <Pill tone="rose">Blocked</Pill>}
            <span className="font-medium">{preview.data.subject ?? '(sent as a reply)'}</span>
          </p>
          {preview.data.body_text && <pre className="whitespace-pre-wrap font-sans leading-relaxed">{preview.data.body_text}</pre>}
          {preview.data.note && <p className="text-xs text-zinc-500 dark:text-zinc-400">{preview.data.note}</p>}
          {[...preview.data.template_issues.map((issue) => ({ key: issue.message, text: issue.message, blocker: true })), ...preview.data.lint.map((finding) => ({ key: finding.rule + finding.message, text: finding.message, blocker: finding.severity === 'blocker' }))].map((entry) => (
            <Pill key={entry.key} tone={entry.blocker ? 'rose' : 'amber'}>
              {entry.text}
            </Pill>
          ))}
          <Button size="sm" variant="ghost" onClick={() => void preview.refetch()}>
            Refresh
          </Button>
        </>
      )}
    </div>
  );
}

function SequenceEditor({ campaignId, sequence, goals, stageOrder, others }: { campaignId: string; sequence: Schemas['FollowUpSequence']; goals: Schemas['Goal'][]; stageOrder: string[]; others: Schemas['FollowUpSequence'][] }) {
  const client = useQueryClient();
  const refresh = () => void client.invalidateQueries({ queryKey: ['campaign', campaignId] });
  const path = { params: { path: { campaignId, sequenceId: sequence.id } } };
  const [finish, setFinish] = useState({ finish: sequence.finish, amount: String(sequence.final_wait.amount) });
  const update = useMutation({ mutationFn: (body: { finish?: Schemas['FollowUpSequence']['finish']; final_wait?: Schemas['Wait']; active?: boolean; stages?: string[] }) => unwrap(api.PATCH('/campaigns/{campaignId}/follow-up-sequences/{sequenceId}', { ...path, body })), onSuccess: refresh });
  const addStep = useMutation({ mutationFn: () => unwrap(api.POST('/campaigns/{campaignId}/follow-up-sequences/{sequenceId}/steps', { ...path, body: { wait: { amount: 4, unit: 'business_days' }, variant: { body_template: 'Hi {{ contact.first_name | default: "there" }}, closing the loop here.' } } })), onSuccess: refresh });
  const remove = useMutation({ mutationFn: () => unwrap(api.DELETE('/campaigns/{campaignId}/follow-up-sequences/{sequenceId}', path)), onSuccess: refresh });
  const [deleting, setDeleting] = useState(false);
  return (
    <Card title={sequence.stages.map((stage) => stageName(stage, goals)).join(' · ')} description={sequence.name}>
      {/* §5.10: a stage has at most one active sequence; a stage another one covers is shown, not offered. */}
      <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <legend className="sr-only">Stages this sequence follows up at</legend>
        <span className="text-zinc-500 dark:text-zinc-400">At</span>
        {stageOrder.map((stage) => {
          const owner = others.find((other) => other.active && other.stages.includes(stage));
          const mine = sequence.stages.includes(stage);
          return (
            <label key={stage} className={cn('flex items-center gap-1', owner && 'text-zinc-500 dark:text-zinc-400')} title={owner ? `Used by “${owner.name}”` : undefined}>
              <input
                type="checkbox"
                checked={mine}
                disabled={Boolean(owner) || update.isPending || (mine && sequence.stages.length === 1)}
                onChange={(event) => update.mutate({ stages: event.target.checked ? stageOrder.filter((entry) => entry === stage || sequence.stages.includes(entry)) : sequence.stages.filter((entry) => entry !== stage) })}
              />
              {stageName(stage, goals)}
              {owner && <span>(used by “{owner.name}”)</span>}
            </label>
          );
        })}
      </fieldset>
      <ol className="space-y-3">
        {[...sequence.steps]
          .sort((a, b) => a.position - b.position)
          .map((step) => (
            <li key={step.id}>
              <StepEditor campaignId={campaignId} sequenceId={sequence.id} step={step} canDelete={sequence.steps.length > 1} />
            </li>
          ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" disabled={addStep.isPending || sequence.steps.length >= 6} onClick={() => addStep.mutate()}>
          <Plus aria-hidden className="size-3.5" /> Add step
        </Button>
        <span className="ml-auto flex flex-wrap items-center gap-1">
          Then wait
          <input type="number" min={1} max={365} aria-label="Final wait" value={finish.amount} onChange={(event) => setFinish({ ...finish, amount: event.target.value })} className={cn(inputClass, 'w-16 py-1')} />
          business days →
          <select aria-label="Finish rule" value={finish.finish} onChange={(event) => setFinish({ ...finish, finish: event.target.value as typeof finish.finish })} className={cn(inputClass, 'w-auto py-1')}>
            {Object.entries(FINISH).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <Button size="sm" disabled={update.isPending} onClick={() => update.mutate({ finish: finish.finish, final_wait: { amount: Number(finish.amount), unit: 'business_days' } })}>
            Save
          </Button>
        </span>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={sequence.active} disabled={update.isPending} onChange={(event) => update.mutate({ active: event.target.checked })} /> Active
        </label>
        {deleting ? (
          <Button size="sm" variant="danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
            Delete this sequence
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setDeleting(true)}>
            Delete…
          </Button>
        )}
      </div>
      <ErrorText error={update.error ?? addStep.error ?? remove.error} />
    </Card>
  );
}

function StepEditor({ campaignId, sequenceId, step, canDelete }: { campaignId: string; sequenceId: string; step: Step; canDelete: boolean }) {
  const client = useQueryClient();
  const refresh = () => void client.invalidateQueries({ queryKey: ['campaign', campaignId] });
  const [form, setForm] = useState({ amount: String(step.wait.amount), unit: step.wait.unit, wait_from: step.wait_from, send_as_reply: step.send_as_reply, mode: step.mode, ai_guidance: step.ai_guidance ?? '' });
  const save = useMutation({
    mutationFn: () => unwrap(api.PATCH('/campaigns/{campaignId}/follow-up-sequences/{sequenceId}/steps/{stepId}', { params: { path: { campaignId, sequenceId, stepId: step.id } }, body: { wait: { amount: Number(form.amount), unit: form.unit }, wait_from: form.wait_from, send_as_reply: form.send_as_reply, mode: form.mode, ai_guidance: form.ai_guidance.trim() || null } })),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: () => unwrap(api.DELETE('/campaigns/{campaignId}/follow-up-sequences/{sequenceId}/steps/{stepId}', { params: { path: { campaignId, sequenceId, stepId: step.id } } })), onSuccess: refresh });
  return (
    <div className="space-y-2 rounded-[var(--radius-card)] border border-zinc-200 p-3 dark:border-zinc-800">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <span className="font-medium tabular-nums">{step.position}</span>
        <span className="text-zinc-500 dark:text-zinc-400">{waitText(step.wait, step.wait_from)} →</span>
        <input type="number" min={0} max={365} aria-label="Wait" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} className={cn(inputClass, 'w-16 py-1')} />
        <select aria-label="Unit" value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value as typeof form.unit })} className={cn(inputClass, 'w-auto py-1')}>
          <option value="business_days">business days</option>
          <option value="days">days</option>
          <option value="hours">hours</option>
        </select>
        <select aria-label="Counted from" value={form.wait_from} onChange={(event) => setForm({ ...form, wait_from: event.target.value as typeof form.wait_from })} className={cn(inputClass, 'w-auto py-1')}>
          <option value="last_message">after the last message</option>
          <option value="goal_event">after the goal’s event</option>
        </select>
        <select aria-label="Mode" value={form.mode} onChange={(event) => setForm({ ...form, mode: event.target.value as typeof form.mode })} className={cn(inputClass, 'w-auto py-1')}>
          {MODES.map((mode) => (
            <option key={mode} value={mode}>
              {MODE[mode]}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" checked={form.send_as_reply} onChange={(event) => setForm({ ...form, send_as_reply: event.target.checked })} /> as a reply
        </label>
        <Button type="submit" size="sm" disabled={save.isPending}>
          Save
        </Button>
        {canDelete && (
          <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate()}>
            Remove step
          </Button>
        )}
      </form>
      {form.mode !== 'template' && (
        <input aria-label="Guidance for the AI" value={form.ai_guidance} onChange={(event) => setForm({ ...form, ai_guidance: event.target.value })} placeholder="Guidance for the AI, e.g. “resend the booking link”" className={cn(inputClass, 'py-1')} maxLength={4000} />
      )}
      <ErrorText error={save.error ?? remove.error} />
      {step.variants.map((variant) => (
        <VariantEditor key={variant.id} campaignId={campaignId} step={step} variant={variant} subject={!step.send_as_reply} canDelete={step.variants.length > 1} />
      ))}
      <Preview campaignId={campaignId} stepId={step.id} />
    </div>
  );
}

function NewSequence({ campaignId, stage, goals }: { campaignId: string; stage: string; goals: Schemas['Goal'][] }) {
  const client = useQueryClient();
  const create = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/campaigns/{campaignId}/follow-up-sequences', {
          params: { path: { campaignId } },
          body: { name: `Follow-ups at ${stageName(stage, goals)}`, stages: [stage], steps: [{ wait: { amount: 3, unit: 'business_days' }, mode: stage === 'sent' || stage === 'received' ? 'template' : 'ai_adapt', variant: { body_template: 'Hi {{ contact.first_name | default: "there" }}, following up on my note.' } }] },
        }),
      ),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['campaign', campaignId] }),
  });
  return (
    <section aria-label={stageName(stage, goals)} className="flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-dashed border-zinc-300 px-4 py-3 text-zinc-500 dark:text-zinc-400 dark:border-zinc-700">
      <span className="font-medium text-zinc-700 dark:text-zinc-300">{stageName(stage, goals)}</span> · No follow-ups at this stage.
      <Button size="sm" className="ml-auto" disabled={create.isPending} onClick={() => create.mutate()}>
        Create sequence
      </Button>
      <ErrorText error={create.error} />
    </section>
  );
}
