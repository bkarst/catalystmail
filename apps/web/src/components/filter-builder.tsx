'use client';

// The FilterBuilder (spec §12.2, §15.14): a segment as conditions joined by AND or OR, each a
// field, an operator that fits it, and a value. Fields are the contact's own, a tag, a list, or a
// custom field (`custom.<key>`). Times take an ISO date or an age such as -30d. One group deep;
// filters with nested groups are shown as JSON.

import { Plus, X } from 'lucide-react';

import { cn } from '../lib/cn.ts';
import { words } from '../lib/format.ts';
import { Button, inputClass } from './ui.tsx';

export type Condition = { field: string; op: string; value?: unknown };
export type Filter = { and: Condition[] } | { or: Condition[] };

type Kind = 'text' | 'enum' | 'boolean' | 'timestamp' | 'tag' | 'custom';
const ENUMS: Record<string, string[]> = {
  lifecycle_stage: ['lead', 'prospect', 'engaged', 'opportunity', 'customer', 'churned', 'disqualified'],
  email_verification: ['unverified', 'valid', 'risky', 'catch_all', 'invalid', 'bounced'],
  subscription_status: ['subscribed', 'unsubscribed', 'complained'],
  consent_basis: ['legitimate_interest', 'consent', 'existing_relationship', 'unknown'],
};
const FIELDS: { field: string; label: string; kind: Kind }[] = [
  { field: 'lifecycle_stage', label: 'Lifecycle stage', kind: 'enum' },
  { field: 'tag_id', label: 'Tag', kind: 'tag' },
  { field: 'email', label: 'Email', kind: 'text' },
  { field: 'first_name', label: 'First name', kind: 'text' },
  { field: 'last_name', label: 'Last name', kind: 'text' },
  { field: 'title', label: 'Title', kind: 'text' },
  { field: 'city', label: 'City', kind: 'text' },
  { field: 'country', label: 'Country', kind: 'text' },
  { field: 'source', label: 'Source', kind: 'text' },
  { field: 'email_verification', label: 'Email status', kind: 'enum' },
  { field: 'subscription_status', label: 'Subscription', kind: 'enum' },
  { field: 'consent_basis', label: 'Consent', kind: 'enum' },
  { field: 'do_not_contact', label: 'Do not contact', kind: 'boolean' },
  { field: 'created_at', label: 'Created', kind: 'timestamp' },
  { field: 'last_contacted_at', label: 'Last emailed', kind: 'timestamp' },
  { field: 'last_replied_at', label: 'Last replied', kind: 'timestamp' },
  { field: 'last_opened_at', label: 'Last opened', kind: 'timestamp' },
  { field: 'custom.', label: 'Custom field…', kind: 'custom' },
];
const OPS: Record<Kind, string[]> = {
  text: ['eq', 'neq', 'contains', 'starts_with', 'ends_with', 'in', 'not_in', 'is_null', 'is_not_null'],
  enum: ['eq', 'neq', 'in', 'not_in'],
  boolean: ['eq'],
  timestamp: ['gt', 'lt', 'is_null', 'is_not_null'],
  tag: ['eq', 'neq'],
  custom: ['eq', 'neq', 'contains', 'gt', 'lt', 'in', 'not_in', 'is_null', 'is_not_null'],
};
const OP_LABEL: Record<string, string> = { eq: 'is', neq: 'is not', contains: 'contains', starts_with: 'starts with', ends_with: 'ends with', in: 'is one of', not_in: 'is none of', is_null: 'is empty', is_not_null: 'is not empty', gt: 'after / above', lt: 'before / below' };

const kindOf = (field: string): Kind => (field.startsWith('custom.') ? 'custom' : (FIELDS.find((entry) => entry.field === field)?.kind ?? 'text'));
const LIST_OPS = new Set(['in', 'not_in']);
const NO_VALUE = new Set(['is_null', 'is_not_null']);

/** True when the builder can show the filter: one group of plain conditions. */
export function isSimple(filter: unknown): filter is Filter {
  if (!filter || typeof filter !== 'object') return false;
  const group = (filter as { and?: unknown; or?: unknown }).and ?? (filter as { or?: unknown }).or;
  return Array.isArray(group) && group.every((entry) => entry && typeof entry === 'object' && 'field' in entry && 'op' in entry);
}

export function FilterBuilder({ value, onChange, tags, disabled }: { value: Filter; onChange: (filter: Filter) => void; tags: { id: string; name: string }[]; disabled?: boolean }) {
  const join = 'and' in value ? 'and' : 'or';
  const conditions = 'and' in value ? value.and : value.or;
  const set = (next: Condition[], nextJoin = join) => onChange(nextJoin === 'and' ? { and: next } : { or: next });
  const update = (index: number, patch: Partial<Condition>) => set(conditions.map((condition, at) => (at === index ? { ...condition, ...patch } : condition)));

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
        Contacts matching
        <select disabled={disabled} value={join} onChange={(event) => set(conditions, event.target.value as 'and' | 'or')} className={cn(inputClass, 'w-auto py-1')}>
          <option value="and">all of</option>
          <option value="or">any of</option>
        </select>
        these:
      </label>
      <ol className="space-y-1">
        {conditions.map((condition, index) => {
          const kind = kindOf(condition.field);
          const ops = OPS[kind];
          return (
            <li key={index} className="flex flex-wrap items-center gap-1.5">
              <select
                aria-label="Field"
                disabled={disabled}
                value={kind === 'custom' ? 'custom.' : condition.field}
                onChange={(event) => {
                  const field = event.target.value;
                  const nextKind = kindOf(field);
                  update(index, { field, op: OPS[nextKind][0]!, value: nextKind === 'boolean' ? true : nextKind === 'enum' ? ENUMS[field]?.[0] : '' });
                }}
                className={cn(inputClass, 'w-auto py-1')}
              >
                {FIELDS.map((entry) => (
                  <option key={entry.field} value={entry.field}>
                    {entry.label}
                  </option>
                ))}
              </select>
              {kind === 'custom' && <input aria-label="Custom field key" disabled={disabled} value={condition.field.slice('custom.'.length)} onChange={(event) => update(index, { field: `custom.${event.target.value.trim()}` })} placeholder="industry" className={cn(inputClass, 'w-28 py-1')} />}
              <select aria-label="Operator" disabled={disabled} value={condition.op} onChange={(event) => update(index, { op: event.target.value, ...(NO_VALUE.has(event.target.value) ? { value: undefined } : LIST_OPS.has(event.target.value) && !Array.isArray(condition.value) ? { value: condition.value ? [condition.value] : [] } : !LIST_OPS.has(event.target.value) && Array.isArray(condition.value) ? { value: condition.value[0] ?? '' } : {}) })} className={cn(inputClass, 'w-auto py-1')}>
                {ops.map((op) => (
                  <option key={op} value={op}>
                    {OP_LABEL[op] ?? op}
                  </option>
                ))}
              </select>
              {!NO_VALUE.has(condition.op) && <ValueInput condition={condition} kind={kind} tags={tags} disabled={disabled} onChange={(next) => update(index, { value: next })} />}
              <Button size="sm" variant="ghost" disabled={disabled} aria-label="Remove condition" onClick={() => set(conditions.filter((_, at) => at !== index))}>
                <X aria-hidden className="size-3.5" />
              </Button>
            </li>
          );
        })}
      </ol>
      <Button size="sm" variant="ghost" disabled={disabled} onClick={() => set([...conditions, { field: 'lifecycle_stage', op: 'eq', value: 'lead' }])}>
        <Plus aria-hidden className="size-3.5" /> Add condition
      </Button>
    </div>
  );
}

function ValueInput({ condition, kind, tags, disabled, onChange }: { condition: Condition; kind: Kind; tags: { id: string; name: string }[]; disabled?: boolean; onChange: (value: unknown) => void }) {
  const many = LIST_OPS.has(condition.op);
  if (kind === 'boolean')
    return (
      <select aria-label="Value" disabled={disabled} value={String(condition.value ?? true)} onChange={(event) => onChange(event.target.value === 'true')} className={cn(inputClass, 'w-auto py-1')}>
        <option value="true">yes</option>
        <option value="false">no</option>
      </select>
    );
  if (kind === 'tag')
    return (
      <select aria-label="Value" disabled={disabled} value={String(condition.value ?? '')} onChange={(event) => onChange(event.target.value)} className={cn(inputClass, 'w-auto py-1')}>
        <option value="">Choose a tag…</option>
        {tags.map((tag) => (
          <option key={tag.id} value={tag.id}>
            {tag.name}
          </option>
        ))}
      </select>
    );
  if (kind === 'enum' && !many)
    return (
      <select aria-label="Value" disabled={disabled} value={String(condition.value ?? '')} onChange={(event) => onChange(event.target.value)} className={cn(inputClass, 'w-auto py-1')}>
        {(ENUMS[condition.field] ?? []).map((option) => (
          <option key={option} value={option}>
            {words(option)}
          </option>
        ))}
      </select>
    );
  const text = Array.isArray(condition.value) ? condition.value.join(', ') : String(condition.value ?? '');
  return (
    <input
      aria-label="Value"
      disabled={disabled}
      value={text}
      onChange={(event) => onChange(many ? event.target.value.split(',').map((part) => part.trim()).filter(Boolean) : event.target.value)}
      placeholder={kind === 'timestamp' ? '-30d or 2026-10-01' : many ? 'a, b, c' : ''}
      className={cn(inputClass, 'w-48 py-1')}
    />
  );
}
