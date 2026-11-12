'use client';

// Settings → AI (spec §15.18, §10.2, §10.4): the monthly budget and what the agent cost, by day
// and by task; each Claude task's model and effort; whether AI-written email says so; Jev's pinned
// version, its thresholds (editable within §22.B's guardrails), and the fallback and Jev/Claude
// disagreement rates for the last 7 days.

import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { api, unwrap } from '../../lib/api.ts';
import { cn } from '../../lib/cn.ts';
import { dateTime, percent, words } from '../../lib/format.ts';
import { Button, ErrorText, inputClass, Loading, Pill } from '../ui.tsx';
import { Field, Panel, Saved, useSettings, useUpdateSettings, type SettingsPatch } from './common.tsx';

const usd = (value: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(value);
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
const TASK_LABEL: Record<string, string> = {
  analyze_inbound: 'Reading replies',
  draft_reply: 'Drafting replies',
  draft_follow_up: 'AI follow-ups and check-ins',
  personalize: 'Personalizing first emails',
  summarize: 'Thread summaries',
  kb_test: 'Testing the knowledge base',
};
const taskLabel = (task: string) => TASK_LABEL[task] ?? words(task);
const THRESHOLD_ORDER = ['unsubscribeAct', 'unsubscribeAsk', 'autoReply', 'needsReplyDraft', 'needsReplyNone', 'mandatoryEscalate', 'otherEscalate', 'escalationFlag', 'goalAsk', 'notInterestedClose', 'notInterestedAsk', 'notNow', 'autoSendIntent'];
const THRESHOLD_LABEL: Record<string, string> = {
  unsubscribeAct: 'Unsubscribe at or above',
  unsubscribeAsk: 'Ask a person about unsubscribing from',
  autoReply: 'Settle an out-of-office or auto-reply at or above',
  needsReplyDraft: 'Draft a reply at or above',
  needsReplyNone: 'No reply needed below',
  mandatoryEscalate: 'Escalate complaints, legal, pricing, a person asked for (never higher than 0.5)',
  otherEscalate: 'Escalate high value and meeting logistics at or above',
  escalationFlag: 'Hold auto-send for any escalation from',
  goalAsk: 'Ask a person to confirm a goal from',
  notInterestedClose: 'Close as not interested at or above',
  notInterestedAsk: 'Ask a person about closing from',
  notNow: 'Schedule a check-in for “not now” at or above',
  autoSendIntent: 'Let a reply send on its own when the intent is at least',
};

export function AiSection() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const usage = useQuery({ queryKey: ['settings', 'ai-usage', 30], queryFn: () => unwrap(api.GET('/settings/ai/usage', { params: { query: { days: 30 } } })) });
  const week = useQuery({ queryKey: ['settings', 'ai-usage', 7], queryFn: () => unwrap(api.GET('/settings/ai/usage', { params: { query: { days: 7 } } })) });
  // The fields start from the settings once (on mount, or when they first arrive), so a refetch
  // never overwrites what is being typed.
  const start = settings.data?.ai;
  const [budget, setBudget] = useState(() => (start?.monthly_budget_usd == null ? '' : String(start.monthly_budget_usd)));
  const [tasks, setTasks] = useState<Record<string, { model: string; effort: string }>>(() => Object.fromEntries((start?.tasks ?? []).map((task) => [task.task, { model: task.model, effort: task.effort }])));
  const [jevModel, setJevModel] = useState(() => (start?.jev.pinned_by === 'workspace' ? (start.jev.model ?? '') : ''));
  const [thresholds, setThresholds] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(start?.jev.thresholds ?? {}).map(([name, value]) => [name, String(value)])));
  const [saved, setSaved] = useState<string | null>(null);
  const filled = useRef(Boolean(start));
  useEffect(() => {
    const ai = settings.data?.ai;
    if (!ai || filled.current) return;
    filled.current = true;
    setBudget(ai.monthly_budget_usd === null ? '' : String(ai.monthly_budget_usd));
    setTasks(Object.fromEntries(ai.tasks.map((task) => [task.task, { model: task.model, effort: task.effort }])));
    setJevModel(ai.jev.pinned_by === 'workspace' ? (ai.jev.model ?? '') : '');
    setThresholds(Object.fromEntries(Object.entries(ai.jev.thresholds).map(([name, value]) => [name, String(value)])));
  }, [settings.data]);

  if (settings.isPending) return <Loading />;
  if (settings.isError) return <ErrorText error={settings.error} />;
  const ai = settings.data.ai;
  const save = (body: NonNullable<SettingsPatch['ai']>, what: string) => {
    setSaved(null);
    update.mutate({ ai: body }, { onSuccess: () => setSaved(what) });
  };
  const days = usage.data?.by_day ?? [];
  const peak = Math.max(0.01, ...days.map((day) => day.cost_usd));

  return (
    <div className="space-y-4">
      <Panel title="Budget and spend">
        <p>
          <span className="text-lg font-semibold tabular-nums">{usd(ai.spent_usd)}</span> spent in {ai.month}
          {ai.monthly_budget_usd !== null && (
            <>
              {' '}
              of {usd(ai.monthly_budget_usd)}{' '}
              <Pill tone={ai.level === 'exhausted' ? 'rose' : ai.level === 'warning' ? 'amber' : 'emerald'}>{ai.level === 'exhausted' ? 'Spent: the agent has stopped' : ai.level === 'warning' ? `${percent(ai.used)} used` : `${percent(ai.used)} used`}</Pill>
            </>
          )}
        </p>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            save({ monthly_budget_usd: budget.trim() === '' ? null : Number(budget) }, 'budget');
          }}
        >
          <Field label="Monthly budget (USD)" hint="Leave empty for no cap. At 80% owners and admins are told; at 100% the agent stops until the month turns or the budget is raised.">
            <input type="number" min="1" step="1" value={budget} onChange={(event) => setBudget(event.target.value)} className={cn(inputClass, 'w-40')} placeholder="No cap" />
          </Field>
          <Button type="submit" disabled={update.isPending}>
            Save
          </Button>
          <Saved show={saved === 'budget'} />
        </form>
        {usage.data && (
          <figure className="space-y-1">
            <figcaption className="text-xs text-zinc-500 dark:text-zinc-400">
              Last 30 days: {usd(usage.data.total.cost_usd)} over {usage.data.total.runs} runs
            </figcaption>
            {days.length === 0 ? (
              <p className="text-zinc-500 dark:text-zinc-400">No AI runs in the last 30 days.</p>
            ) : (
              <div aria-hidden className="flex h-24 items-end gap-0.5">
                {days.map((day) => (
                  <span key={day.day} title={`${day.day}: ${usd(day.cost_usd)}, ${day.runs} runs`} className="w-3 rounded-t-sm bg-indigo-500" style={{ height: `${Math.max(2, Math.round((day.cost_usd / peak) * 100))}%` }} />
                ))}
              </div>
            )}
            <table className="sr-only">
              <tbody>
                {days.map((day) => (
                  <tr key={day.day}>
                    <td>{day.day}</td>
                    <td>{usd(day.cost_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </figure>
        )}
        <ErrorText error={usage.error} onRetry={() => void usage.refetch()} />
      </Panel>

      <Panel title="Models" description="Each Claude task’s model and effort. Move reading replies to a smaller model only once the evals show it does as well (§10.2).">
        <form
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            const changes = Object.fromEntries(
              ai.tasks
                .filter((task) => tasks[task.task] && (tasks[task.task]!.model !== task.model || tasks[task.task]!.effort !== task.effort))
                .map((task) => [task.task, { model: tasks[task.task]!.model.trim(), effort: tasks[task.task]!.effort as (typeof EFFORTS)[number] }]),
            );
            save({ tasks: changes }, 'models');
          }}
          className="space-y-2"
        >
          <table className="w-full max-w-3xl text-left">
            <thead className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              <tr>
                <th className="py-1 font-medium">Task</th>
                <th className="py-1 font-medium">Model</th>
                <th className="py-1 font-medium">Effort</th>
                <th className="py-1 font-medium">30 days</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {ai.tasks.map((task) => {
                const stats = usage.data?.by_task.find((entry) => entry.task === task.task);
                return (
                  <tr key={task.task} className="border-t border-zinc-200 dark:border-zinc-800">
                    <td className="py-1.5 pr-3">{taskLabel(task.task)}</td>
                    <td className="pr-3">
                      <input aria-label={`Model for ${taskLabel(task.task)}`} value={tasks[task.task]?.model ?? ''} onChange={(event) => setTasks({ ...tasks, [task.task]: { ...tasks[task.task]!, model: event.target.value } })} className={cn(inputClass, 'py-1 font-mono text-xs')} pattern="claude-[a-z0-9-]+" />
                    </td>
                    <td className="pr-3">
                      <select aria-label={`Effort for ${taskLabel(task.task)}`} value={tasks[task.task]?.effort ?? 'medium'} onChange={(event) => setTasks({ ...tasks, [task.task]: { ...tasks[task.task]!, effort: event.target.value } })} className={cn(inputClass, 'w-auto py-1')}>
                        {EFFORTS.map((effort) => (
                          <option key={effort}>{effort}</option>
                        ))}
                      </select>
                    </td>
                    <td className="pr-3 text-xs text-zinc-600 tabular-nums dark:text-zinc-400">{stats ? `${stats.runs} runs · ${usd(stats.cost_usd)}${stats.failed ? ` · ${stats.failed} failed` : ''}${stats.guardrail_blocked ? ` · ${stats.guardrail_blocked} blocked` : ''}` : '–'}</td>
                    <td>
                      {task.overridden && (
                        <Button size="sm" variant="ghost" onClick={() => save({ tasks: { [task.task]: null } }, 'models')}>
                          Default
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={update.isPending}>
              Save models
            </Button>
            <Saved show={saved === 'models'} />
          </div>
        </form>
      </Panel>

      <Panel title="Disclosure" description="Whether email the agent wrote says so (§10.9). Whatever the setting, the agent never claims to be a person.">
        <select aria-label="Disclosure" value={ai.disclosure} disabled={update.isPending} onChange={(event) => save({ disclosure: event.target.value as 'none' | 'signature_line' }, 'disclosure')} className={cn(inputClass, 'w-auto')}>
          <option value="none">Nothing is added</option>
          <option value="signature_line">“Written with help from an AI assistant.” under the signature</option>
        </select>
        <Saved show={saved === 'disclosure'} />
      </Panel>

      <Panel title="Jev, the classifier" description="Jev classifies every reply first; Claude classifies alone only while Jev is unavailable (§10.4).">
        <dl className="grid max-w-xl grid-cols-[12rem_1fr] gap-y-1">
          <dt className="text-zinc-500 dark:text-zinc-400">Version</dt>
          <dd>{ai.jev.model ? `${ai.jev.model} (pinned by ${ai.jev.pinned_by === 'workspace' ? 'this workspace' : 'the server'})` : <span className="text-amber-700 dark:text-amber-300">Not set up: Claude classifies alone</span>}</dd>
          <dt className="text-zinc-500 dark:text-zinc-400">Claude alone, 7 days</dt>
          <dd className="tabular-nums">{week.data ? percent(week.data.classification_fallback_rate, 1) : '…'}</dd>
          <dt className="text-zinc-500 dark:text-zinc-400">Jev and Claude disagree, 7 days</dt>
          <dd className="tabular-nums">{week.data ? percent(week.data.disagreement_rate, 1) : '…'}</dd>
          <dt className="text-zinc-500 dark:text-zinc-400">Thresholds last changed</dt>
          <dd>{ai.jev.thresholds_updated_at ? dateTime(ai.jev.thresholds_updated_at) : 'Never: the defaults'}</dd>
        </dl>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            save({ jev_model: jevModel.trim() || null }, 'jev');
          }}
        >
          <Field label="Pin this workspace to a version" hint="An exact version such as jev-1.14.0, never jev-latest. Empty follows the server’s. Move only once the evals pass (§19.7).">
            <input value={jevModel} onChange={(event) => setJevModel(event.target.value)} pattern="jev-\d+\.\d+\.\d+" placeholder="Follow the server" className={cn(inputClass, 'w-48 font-mono text-xs')} />
          </Field>
          <Button type="submit" disabled={update.isPending}>
            Save
          </Button>
          <Saved show={saved === 'jev'} />
        </form>
        <form
          className="space-y-2"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            const changed = Object.fromEntries(Object.entries(thresholds).filter(([name, value]) => Number(value) !== ai.jev.thresholds[name]).map(([name, value]) => [name, Number(value)]));
            save({ thresholds: changed }, 'thresholds');
          }}
        >
          <h3 className="pt-2 font-medium">Thresholds</h3>
          <table className="w-full max-w-3xl text-left">
            <tbody>
              {THRESHOLD_ORDER.filter((name) => name in thresholds).map((name) => (
                <tr key={name} className="border-t border-zinc-200 dark:border-zinc-800">
                  <td className="py-1 pr-3">{THRESHOLD_LABEL[name] ?? name}</td>
                  <td className="w-28">
                    <input type="number" aria-label={THRESHOLD_LABEL[name] ?? name} min="0" max="1" step="0.01" value={thresholds[name]} onChange={(event) => setThresholds({ ...thresholds, [name]: event.target.value })} className={cn(inputClass, 'py-1 tabular-nums')} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={update.isPending}>
              Save thresholds
            </Button>
            {ai.jev.thresholds_updated_at && (
              <Button variant="ghost" disabled={update.isPending} onClick={() => save({ thresholds: null }, 'thresholds')}>
                Back to the defaults
              </Button>
            )}
            <Saved show={saved === 'thresholds'} />
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Each “ask a person” band must stay below its act band, and the mandatory escalations can’t be made harder to raise.</p>
        </form>
      </Panel>
      <ErrorText error={update.error} />
    </div>
  );
}
