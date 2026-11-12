'use client';

// Builder step 2, Goals (spec §15.10, §5.2): what success looks like, in order. Each goal has a
// name and key, when it counts as achieved, how it can be detected, the playbook the agent
// follows toward it, and what reaching it does (lifecycle, customer, value). Goals can be added,
// moved up or down, and deleted while no thread has reached them.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { api, unwrap, type Schemas } from '../../lib/api.ts';
import { cn } from '../../lib/cn.ts';
import { words } from '../../lib/format.ts';
import { Button, ErrorText, inputClass, Loading, Pill, textareaClass } from '../ui.tsx';
import { Card, fieldClass, Labeled } from './common.tsx';

type Goal = Schemas['Goal'];
const METHODS = { ai: 'AI reading replies', external_event: 'Booking or payment event', link_click: 'Link click', manual: 'Manual' } as const;
const LIFECYCLE = ['lead', 'prospect', 'engaged', 'opportunity', 'customer'] as const;
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^[^a-z]+/, '').slice(0, 40) || 'goal';

export function GoalsStep({ campaign }: { campaign: Schemas['Campaign'] }) {
  const client = useQueryClient();
  const campaignId = campaign.id;
  const goals = useQuery({ queryKey: ['campaign', campaignId, 'goals'], queryFn: () => unwrap(api.GET('/campaigns/{campaignId}/goals', { params: { path: { campaignId } } })) });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['campaign', campaignId] });
  };
  const reorder = useMutation({ mutationFn: (goal_ids: string[]) => unwrap(api.POST('/campaigns/{campaignId}/goals/reorder', { params: { path: { campaignId } }, body: { goal_ids } })), onSuccess: refresh });
  const [adding, setAdding] = useState(false);
  if (goals.isPending) return <Loading />;
  if (goals.isError) return <ErrorText error={goals.error} onRetry={() => void goals.refetch()} />;
  const list = [...goals.data.data].sort((a, b) => a.position - b.position);
  const move = (index: number, by: -1 | 1) => {
    const ids = list.map((goal) => goal.id);
    [ids[index], ids[index + by]] = [ids[index + by]!, ids[index]!];
    reorder.mutate(ids);
  };

  return (
    <div className="space-y-4">
      <Card title="2 · Goals: what does success look like?" description="In order: reaching a goal counts every goal before it, and the last one completes the conversation. A thread’s stage is “⟨goal⟩ achieved” for the highest one reached.">
        {list.length === 0 && <p className="text-zinc-500 dark:text-zinc-400">No goals yet. Most campaigns have one or two, such as “Call booked”, then “Paid”.</p>}
        <ol className="space-y-3">
          {list.map((goal, index) => (
            <li key={goal.id}>
              <GoalEditor campaignId={campaignId} goal={goal} final={index === list.length - 1} onMove={(by) => move(index, by)} canUp={index > 0} canDown={index < list.length - 1} moving={reorder.isPending} />
            </li>
          ))}
        </ol>
        <ErrorText error={reorder.error} />
        {adding ? (
          <NewGoal campaignId={campaignId} onDone={() => setAdding(false)} />
        ) : (
          <Button onClick={() => setAdding(true)} disabled={list.length >= 10}>
            <Plus aria-hidden className="size-4" /> Add goal
          </Button>
        )}
      </Card>
    </div>
  );
}

function GoalFields({ value, onChange, keyEditable }: { value: GoalDraft; onChange: (draft: GoalDraft) => void; keyEditable: boolean }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-3">
        <Labeled label="Name" className="block">
          <input required maxLength={100} value={value.name} onChange={(event) => onChange({ ...value, name: event.target.value, ...(keyEditable && !value.keyTouched && { key: slug(event.target.value) }) })} placeholder="Discovery call booked" className={cn(inputClass, fieldClass, 'w-72')} />
        </Labeled>
        <Labeled label="Key (for integrations)" className="block">
          <input required pattern="[a-z][a-z0-9_]{0,39}" value={value.key} onChange={(event) => onChange({ ...value, key: event.target.value, keyTouched: true })} className={cn(inputClass, fieldClass, 'w-48 font-mono text-xs')} />
        </Labeled>
        <Labeled label="Value each (USD, optional)" className="block">
          <input type="number" min={0} value={value.value} onChange={(event) => onChange({ ...value, value: event.target.value })} className={cn(inputClass, fieldClass, 'w-32')} />
        </Labeled>
      </div>
      <Labeled label="Achieved when" hint="In words; the AI checks replies against it.">
        <textarea required maxLength={2000} value={value.success_criteria} onChange={(event) => onChange({ ...value, success_criteria: event.target.value })} placeholder="The contact books via the calendar link or agrees a specific time." className={cn(textareaClass, fieldClass, 'min-h-14')} />
      </Labeled>
      <fieldset className="flex flex-wrap items-center gap-3">
        <legend className="mb-1 text-xs text-zinc-500 dark:text-zinc-400">Detect via</legend>
        {(Object.keys(METHODS) as (keyof typeof METHODS)[]).map((method) => (
          <label key={method} className="flex items-center gap-1">
            <input type="checkbox" checked={value.detection_methods.includes(method)} onChange={(event) => onChange({ ...value, detection_methods: event.target.checked ? [...value.detection_methods, method] : value.detection_methods.filter((entry) => entry !== method) })} /> {METHODS[method]}
          </label>
        ))}
        {value.detection_methods.includes('ai') && (
          <label className="flex items-center gap-1 text-zinc-600 dark:text-zinc-400">
            <input type="checkbox" checked={value.auto_confirm} onChange={(event) => onChange({ ...value, auto_confirm: event.target.checked })} /> the AI may confirm it alone when sure
          </label>
        )}
      </fieldset>
      <Labeled label="Playbook" hint="How the agent moves a contact toward this goal.">
        <textarea required maxLength={10_000} value={value.playbook} onChange={(event) => onChange({ ...value, playbook: event.target.value })} placeholder="Answer their question briefly, then offer the booking link." className={cn(textareaClass, fieldClass, 'min-h-16')} />
      </Labeled>
      <div className="flex flex-wrap items-center gap-4">
        <Labeled label="Moves the contact to" className="block">
          <select value={value.lifecycle} onChange={(event) => onChange({ ...value, lifecycle: event.target.value })} className={cn(inputClass, fieldClass, 'w-auto')}>
            <option value="">No change</option>
            {LIFECYCLE.map((stage) => (
              <option key={stage} value={stage}>
                {words(stage)}
              </option>
            ))}
          </select>
        </Labeled>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={value.marks_customer} onChange={(event) => onChange({ ...value, marks_customer: event.target.checked })} /> Marks the contact a customer (final goal)
        </label>
      </div>
    </div>
  );
}

type GoalDraft = { name: string; key: string; keyTouched: boolean; success_criteria: string; playbook: string; detection_methods: (keyof typeof METHODS)[]; auto_confirm: boolean; lifecycle: string; marks_customer: boolean; value: string };

const draftOf = (goal: Goal): GoalDraft => ({
  name: goal.name,
  key: goal.key,
  keyTouched: true,
  success_criteria: goal.success_criteria,
  playbook: goal.playbook,
  detection_methods: goal.detection_methods,
  auto_confirm: goal.auto_confirm,
  lifecycle: goal.lifecycle_stage_on_achieve ?? '',
  marks_customer: goal.marks_customer,
  value: goal.value_cents === null ? '' : String(goal.value_cents / 100),
});
const bodyOf = (draft: GoalDraft) => ({
  name: draft.name.trim(),
  key: draft.key,
  success_criteria: draft.success_criteria.trim(),
  playbook: draft.playbook.trim(),
  detection_methods: draft.detection_methods,
  auto_confirm: draft.auto_confirm,
  lifecycle_stage_on_achieve: (draft.lifecycle || null) as Goal['lifecycle_stage_on_achieve'],
  marks_customer: draft.marks_customer,
  value_cents: draft.value === '' ? null : Math.round(Number(draft.value) * 100),
});

function GoalEditor({ campaignId, goal, final, onMove, canUp, canDown, moving }: { campaignId: string; goal: Goal; final: boolean; onMove: (by: -1 | 1) => void; canUp: boolean; canDown: boolean; moving: boolean }) {
  const client = useQueryClient();
  const [draft, setDraft] = useState(() => draftOf(goal));
  const [deleting, setDeleting] = useState(false);
  const path = { params: { path: { campaignId, goalId: goal.id } } };
  const refresh = () => void client.invalidateQueries({ queryKey: ['campaign', campaignId] });
  const save = useMutation({ mutationFn: () => unwrap(api.PATCH('/campaigns/{campaignId}/goals/{goalId}', { ...path, body: bodyOf(draft) })), onSuccess: refresh });
  const remove = useMutation({ mutationFn: () => unwrap(api.DELETE('/campaigns/{campaignId}/goals/{goalId}', path)), onSuccess: refresh });
  return (
    <form
      aria-label={`Goal ${goal.position}: ${goal.name}`}
      className="space-y-2 rounded-[var(--radius-card)] border border-zinc-200 p-3 dark:border-zinc-800"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <div className="flex items-center gap-2">
        <span className="font-medium">Goal {goal.position}</span>
        {final && <Pill tone="emerald">Final</Pill>}
        <span className="ml-auto flex gap-1">
          <Button size="sm" variant="ghost" aria-label="Move up" disabled={!canUp || moving} onClick={() => onMove(-1)}>
            <ArrowUp aria-hidden className="size-3.5" />
          </Button>
          <Button size="sm" variant="ghost" aria-label="Move down" disabled={!canDown || moving} onClick={() => onMove(1)}>
            <ArrowDown aria-hidden className="size-3.5" />
          </Button>
        </span>
      </div>
      <GoalFields value={draft} onChange={setDraft} keyEditable={false} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={save.isPending || draft.detection_methods.length === 0}>
          Save goal
        </Button>
        {save.isSuccess && (
          <span role="status" className="text-emerald-700 dark:text-emerald-400">
            Saved.
          </span>
        )}
        {deleting ? (
          <Button size="sm" variant="danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
            Delete “{goal.name}”
          </Button>
        ) : (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setDeleting(true)}>
            Delete…
          </Button>
        )}
      </div>
      <ErrorText error={save.error ?? remove.error} />
    </form>
  );
}

function NewGoal({ campaignId, onDone }: { campaignId: string; onDone: () => void }) {
  const client = useQueryClient();
  const [draft, setDraft] = useState<GoalDraft>({ name: '', key: '', keyTouched: false, success_criteria: '', playbook: '', detection_methods: ['ai', 'manual'], auto_confirm: true, lifecycle: 'opportunity', marks_customer: false, value: '' });
  const create = useMutation({ mutationFn: () => unwrap(api.POST('/campaigns/{campaignId}/goals', { params: { path: { campaignId } }, body: bodyOf(draft) })), onSuccess: () => (void client.invalidateQueries({ queryKey: ['campaign', campaignId] }), onDone()) });
  return (
    <form
      aria-label="New goal"
      className="space-y-2 rounded-[var(--radius-card)] border border-indigo-200 p-3 dark:border-indigo-900"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        create.mutate();
      }}
    >
      <p className="font-medium">New goal</p>
      <GoalFields value={draft} onChange={setDraft} keyEditable />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={create.isPending || draft.detection_methods.length === 0}>
          Add goal
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
      <ErrorText error={create.error} />
    </form>
  );
}
