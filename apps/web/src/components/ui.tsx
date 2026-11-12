// The UI's small set of primitives (spec §15.2): buttons, pills, collapsible panel sections and
// form fields, on the design tokens in globals.css. Colour never carries meaning alone: every
// status pill has words, and the priority pills an icon too.

import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '../lib/cn.ts';

const BUTTON = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-700 disabled:hover:bg-indigo-600',
  secondary: 'border border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900',
  ghost: 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900',
  danger: 'border border-rose-200 text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950',
} as const;

export function Button({ variant = 'secondary', size = 'md', className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BUTTON; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-pill)] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5',
        BUTTON[variant],
        className,
      )}
    />
  );
}

const TONE = {
  zinc: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300',
  indigo: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
  emerald: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  amber: 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  rose: 'bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
  sky: 'bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
} as const;
export type Tone = keyof typeof TONE;

export function Pill({ tone = 'zinc', className, children, title }: { tone?: Tone; className?: string; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cn('inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-[var(--radius-pill)] px-1.5 text-xs font-medium', TONE[tone], className)}>
      {children}
    </span>
  );
}

/** A right-panel section that folds (§15.7). Open by default. */
export function Section({ title, children, open = true, action }: { title: string; children: ReactNode; open?: boolean; action?: ReactNode }) {
  return (
    <details open={open} className="group relative border-b border-zinc-200 py-3 last:border-b-0 dark:border-zinc-800">
      <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 [&::-webkit-details-marker]:hidden">
        <span>
          <span aria-hidden className="mr-1 inline-block transition-transform group-open:rotate-90">
            ▸
          </span>
          {title}
        </span>
      </summary>
      {/* Beside the title, but outside the summary: a summary is itself a control, and controls don't nest (WCAG 4.1.2). */}
      {action && <div className="absolute right-0 top-2">{action}</div>}
      <div className="mt-2 space-y-2">{children}</div>
    </details>
  );
}

/** An error in plain words (spec §15.20), with the request ID to quote and, for a query, Retry. */
export function ErrorText({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  const requestId = (error as { requestId?: string | null }).requestId;
  return (
    <div role="alert" className="space-y-0.5 text-rose-700 dark:text-rose-300">
      <p>{error instanceof Error ? error.message : String(error)}</p>
      {(requestId || onRetry) && (
        <p className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          {onRetry && (
            <button type="button" onClick={onRetry} className="font-medium text-rose-700 underline dark:text-rose-300">
              Retry
            </button>
          )}
          {requestId && <span>Request {requestId}</span>}
        </p>
      )}
    </div>
  );
}

export const Loading = ({ label = 'Loading…' }: { label?: string }) => <p className="text-zinc-500 dark:text-zinc-400">{label}</p>;

export const inputClass = 'block w-full rounded-[var(--radius-pill)] border border-zinc-200 bg-white px-2.5 py-1.5 dark:border-zinc-800 dark:bg-zinc-950';
export const textareaClass = cn(inputClass, 'min-h-28 rounded-[var(--radius-card)] leading-relaxed');
