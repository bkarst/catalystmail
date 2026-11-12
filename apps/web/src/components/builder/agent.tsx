'use client';

// Builder step 5, Agent (spec §15.10, §15.9 "Agent", §10.7): who writes (the built-in agent or
// the campaign's own through the API and MCP), autonomy with what each level means, the persona,
// campaign instructions, the links the agent may use, reply timing and limits, and a starter
// checklist for the knowledge base.

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { api, unwrap, type Schemas } from '../../lib/api.ts';
import { cn } from '../../lib/cn.ts';
import { Button, ErrorText, inputClass, textareaClass } from '../ui.tsx';
import { AUTONOMY } from '../campaign/bits.tsx';
import { Card, fieldClass, Labeled, useUpdateCampaign } from './common.tsx';

export function AgentStep({ campaign }: { campaign: Schemas['Campaign'] }) {
  const update = useUpdateCampaign(campaign.id);
  const persona = campaign.persona as Record<string, string | null | undefined>;
  const [form, setForm] = useState({
    sender_role: persona.sender_role ?? '',
    tone: persona.tone ?? '',
    language: persona.language ?? '',
    sign_off: persona.sign_off ?? '',
    style_notes: persona.style_notes ?? '',
    agent_instructions: campaign.agent_instructions ?? '',
    links: Object.entries(campaign.links as Record<string, string>).map(([key, url]) => ({ key, url })),
    reply_delay_min_minutes: String(campaign.reply_delay_min_minutes),
    reply_delay_max_minutes: String(campaign.reply_delay_max_minutes),
    max_ai_replies_per_thread: String(campaign.max_ai_replies_per_thread),
    on_not_interested: campaign.on_not_interested,
    pause_on_manual_reply: campaign.pause_on_manual_reply,
  });
  const knowledge = useQuery({ queryKey: ['knowledge', 'checklist'], queryFn: () => unwrap(api.GET('/knowledge', { params: { query: { limit: 100, active: 'true' } } })) });
  const has = (kind: string) => (knowledge.data?.data ?? []).some((item) => item.kind === kind && (item.campaign_id === null || item.campaign_id === campaign.id));
  const faqs = (knowledge.data?.data ?? []).filter((item) => item.kind === 'faq' && (item.campaign_id === null || item.campaign_id === campaign.id)).length;

  const save = (event: FormEvent) => {
    event.preventDefault();
    update.mutate({
      persona: { sender_role: form.sender_role.trim() || null, tone: form.tone.trim() || null, language: form.language.trim() || null, sign_off: form.sign_off.trim() || null, style_notes: form.style_notes.trim() || null },
      agent_instructions: form.agent_instructions.trim() || null,
      links: Object.fromEntries(form.links.filter((link) => link.key.trim() && link.url.trim()).map((link) => [link.key.trim(), link.url.trim()])),
      reply_delay_min_minutes: Number(form.reply_delay_min_minutes),
      reply_delay_max_minutes: Number(form.reply_delay_max_minutes),
      max_ai_replies_per_thread: Number(form.max_ai_replies_per_thread),
      on_not_interested: form.on_not_interested,
      pause_on_manual_reply: form.pause_on_manual_reply,
    });
  };

  return (
    <div className="space-y-4">
      <Card title="5 · Agent: who writes, and how much it may send alone">
        <fieldset className="space-y-2">
          <legend className="sr-only">Who writes</legend>
          <label className="flex items-start gap-2">
            <input type="radio" name="agent_mode" className="mt-1" checked={campaign.agent_mode === 'built_in'} disabled={update.isPending} onChange={() => update.mutate({ agent_mode: 'built_in' })} />
            <span>Catalyst’s agent writes replies and AI follow-ups.</span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" name="agent_mode" className="mt-1" checked={campaign.agent_mode === 'external'} disabled={update.isPending} onChange={() => update.mutate({ agent_mode: 'external' })} />
            <span>
              Your own agent writes them through the API or MCP, such as Claude Code. <span className="text-zinc-500 dark:text-zinc-400">Catalyst’s agent writes nothing; replies and due follow-ups wait in Needs you for yours.</span>
            </span>
          </label>
        </fieldset>
        {campaign.agent_mode === 'built_in' && (
          <fieldset className="space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <legend className="mb-1 font-medium">Autonomy</legend>
            {(['manual', 'assisted', 'autonomous'] as const).map((level) => (
              <label key={level} className="flex items-start gap-2">
                <input type="radio" name="autonomy" className="mt-1" checked={campaign.autonomy === level} disabled={update.isPending} onChange={() => update.mutate({ autonomy: level })} />
                <span>
                  <span className="font-medium">{level === 'manual' ? 'Manual' : level === 'assisted' ? 'Assisted (recommended)' : 'Autonomous'}</span> · <span className="text-zinc-600 dark:text-zinc-400">{AUTONOMY[level]}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        <ErrorText error={update.error} />
      </Card>

      <Card title="Persona and rules">
        <form onSubmit={save} className="space-y-3">
          <div className="flex flex-wrap gap-3">
            <Labeled label="Sender’s role" className="block">
              <input value={form.sender_role} onChange={(event) => setForm({ ...form, sender_role: event.target.value })} placeholder="Founder" className={cn(inputClass, fieldClass, 'w-48')} maxLength={200} />
            </Labeled>
            <Labeled label="Tone" className="block">
              <input value={form.tone} onChange={(event) => setForm({ ...form, tone: event.target.value })} placeholder="warm, direct, no jargon" className={cn(inputClass, fieldClass, 'w-64')} maxLength={200} />
            </Labeled>
            <Labeled label="Language" className="block">
              <input value={form.language} onChange={(event) => setForm({ ...form, language: event.target.value })} placeholder="en" className={cn(inputClass, fieldClass, 'w-20')} maxLength={20} />
            </Labeled>
            <Labeled label="Sign-off" className="block">
              <input value={form.sign_off} onChange={(event) => setForm({ ...form, sign_off: event.target.value })} placeholder="Best, Alex" className={cn(inputClass, fieldClass, 'w-48')} maxLength={200} />
            </Labeled>
          </div>
          <Labeled label="Style notes">
            <textarea value={form.style_notes} onChange={(event) => setForm({ ...form, style_notes: event.target.value })} className={cn(textareaClass, fieldClass, 'min-h-14')} maxLength={2000} />
          </Labeled>
          <Labeled label="Campaign instructions" hint="Rules for every email in this campaign, e.g. “never offer a discount”.">
            <textarea value={form.agent_instructions} onChange={(event) => setForm({ ...form, agent_instructions: event.target.value })} className={cn(textareaClass, fieldClass, 'min-h-20')} maxLength={10_000} />
          </Labeled>
          <fieldset className="space-y-1">
            <legend className="text-xs text-zinc-500 dark:text-zinc-400">Links the agent may use (templates use {'{{ campaign.links.<key> }}'})</legend>
            {form.links.map((link, index) => (
              <div key={index} className="flex gap-2">
                <input aria-label="Key" value={link.key} onChange={(event) => setForm({ ...form, links: form.links.map((entry, at) => (at === index ? { ...entry, key: event.target.value } : entry)) })} placeholder="booking" pattern="[a-z][a-z0-9_]{0,39}" className={cn(inputClass, 'w-32 py-1 font-mono text-xs')} />
                <input aria-label="URL" type="url" value={link.url} onChange={(event) => setForm({ ...form, links: form.links.map((entry, at) => (at === index ? { ...entry, url: event.target.value } : entry)) })} placeholder="https://cal.com/acme/intro" className={cn(inputClass, 'py-1')} />
                <Button size="sm" variant="ghost" onClick={() => setForm({ ...form, links: form.links.filter((_, at) => at !== index) })}>
                  Remove
                </Button>
              </div>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setForm({ ...form, links: [...form.links, { key: '', url: '' }] })}>
              + Add link
            </Button>
          </fieldset>
          <div className="flex flex-wrap items-end gap-3">
            <Labeled label="Reply delay, minutes" className="block">
              <span className="flex items-center gap-1">
                <input type="number" min={1} max={240} value={form.reply_delay_min_minutes} onChange={(event) => setForm({ ...form, reply_delay_min_minutes: event.target.value })} className={cn(inputClass, fieldClass, 'w-20')} />
                to
                <input type="number" min={1} max={480} value={form.reply_delay_max_minutes} onChange={(event) => setForm({ ...form, reply_delay_max_minutes: event.target.value })} className={cn(inputClass, fieldClass, 'w-20')} />
              </span>
            </Labeled>
            <Labeled label="AI replies per thread, at most" className="block">
              <input type="number" min={0} max={50} value={form.max_ai_replies_per_thread} onChange={(event) => setForm({ ...form, max_ai_replies_per_thread: event.target.value })} className={cn(inputClass, fieldClass, 'w-20')} />
            </Labeled>
            <Labeled label="When someone clearly declines" className="block">
              <select value={form.on_not_interested} onChange={(event) => setForm({ ...form, on_not_interested: event.target.value as typeof form.on_not_interested })} className={cn(inputClass, fieldClass, 'w-auto')}>
                <option value="close_silently">Close the thread without replying</option>
                <option value="send_polite_close">Send a short polite reply, then close</option>
              </select>
            </Labeled>
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.pause_on_manual_reply} onChange={(event) => setForm({ ...form, pause_on_manual_reply: event.target.checked })} /> When you reply from your own mail client, the agent stands back on that thread
          </label>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={update.isPending}>
              Save
            </Button>
            {update.isSuccess && (
              <span role="status" className="text-emerald-700 dark:text-emerald-400">
                Saved.
              </span>
            )}
          </div>
        </form>
      </Card>

      <Card title="Knowledge base starter" description="What the agent can answer without escalating. Shareable items for every campaign or this one count.">
        <ul className="space-y-1">
          <li>{has('pricing') ? '✓' : '○'} Pricing</li>
          <li>{has('product') ? '✓' : '○'} A product summary</li>
          <li>
            {faqs >= 5 ? '✓' : '○'} The top 5 questions ({faqs} so far)
          </li>
        </ul>
        <Link href="/knowledge" className="text-indigo-700 hover:underline dark:text-indigo-300">
          Open Knowledge →
        </Link>
      </Card>
    </div>
  );
}
