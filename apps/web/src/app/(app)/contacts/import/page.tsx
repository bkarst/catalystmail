'use client';

// V10 Import (spec §15.13), four steps on one page: the file (dropped or chosen) → the mapping,
// column by column with sample values, from the suggested one → options (duplicates, tags, a
// list, consent basis, owner) → the dry run's counts and first problems → Import. Then a progress
// bar while it runs, and the result with its problems to download.

import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Upload } from 'lucide-react';
import Link from 'next/link';
import { useState, type DragEvent, type FormEvent, type ReactNode } from 'react';

import { Button, ErrorText, inputClass, Loading, Pill } from '../../../../components/ui.tsx';
import { api, idempotencyKey, unwrap, type Schemas } from '../../../../lib/api.ts';
import { cn } from '../../../../lib/cn.ts';
import { words } from '../../../../lib/format.ts';

const FIELDS = ['email', 'first_name', 'last_name', 'full_name', 'title', 'phone', 'linkedin_url', 'company', 'city', 'country', 'timezone', 'lifecycle_stage', 'notes', 'tags', 'do_not_contact'];
const MAX_BYTES = 20 * 1024 * 1024;
type Options = { dedupe_strategy: 'skip' | 'fill_empty' | 'overwrite'; tag_ids: string[]; list_id: string; consent_basis: 'legitimate_interest' | 'consent' | 'existing_relationship' | 'unknown'; owner_user_id: string };

export default function ImportPage() {
  const [upload, setUpload] = useState<Schemas['Import'] | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [options, setOptions] = useState<Options>({ dedupe_strategy: 'skip', tag_ids: [], list_id: '', consent_basis: 'unknown', owner_user_id: '' });
  const [summary, setSummary] = useState<Schemas['ImportSummary'] | null>(null);
  const [committed, setCommitted] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const tags = useQuery({ queryKey: ['tags'], queryFn: () => unwrap(api.GET('/tags', { params: { query: { limit: 100 } } })), staleTime: 300_000 });
  const lists = useQuery({ queryKey: ['lists', 'static'], queryFn: () => unwrap(api.GET('/lists', { params: { query: { limit: 100, kind: 'static' } } })) });
  const users = useQuery({ queryKey: ['users'], queryFn: () => unwrap(api.GET('/users', { params: { query: { limit: 100 } } })), retry: false });

  const create = useMutation({
    mutationFn: ({ filename, content }: { filename: string; content: string }) => unwrap(api.POST('/imports', { params: { header: idempotencyKey() }, body: { filename, content } })),
    onSuccess: (created) => {
      setUpload(created);
      setMapping({ ...Object.fromEntries(created.headers.map((header) => [header, null])), ...created.suggested_mapping });
      setSummary(null);
    },
  });
  const body = () => ({
    mapping,
    dedupe_strategy: options.dedupe_strategy,
    consent_basis: options.consent_basis,
    ...(options.tag_ids.length && { tag_ids: options.tag_ids }),
    ...(options.list_id && { list_id: options.list_id }),
    ...(options.owner_user_id && { owner_user_id: options.owner_user_id }),
  });
  // The import's ID travels with each call, so a click can never act on an earlier file.
  const preview = useMutation({ mutationFn: (importId: string) => unwrap(api.POST('/imports/{importId}/preview', { params: { path: { importId } }, body: body() })), onSuccess: setSummary });
  const commit = useMutation({ mutationFn: (importId: string) => unwrap(api.POST('/imports/{importId}/commit', { params: { path: { importId }, header: idempotencyKey() }, body: body() })), onSuccess: (started) => setCommitted(started.id) });

  const read = async (file: File | undefined) => {
    setFileError(null);
    if (!file) return;
    if (file.size > MAX_BYTES) return setFileError('The file is larger than 20 MB. Split it into parts.');
    create.mutate({ filename: file.name, content: await file.text() });
  };
  const hasEmail = Object.values(mapping).includes('email');

  if (committed) return <Progress importId={committed} />;

  return (
    <div className="max-w-5xl space-y-4">
      <Link href="/contacts" className="inline-flex items-center gap-1 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">
        <ArrowLeft aria-hidden className="size-4" /> Contacts
      </Link>
      <h1 className="text-xl font-semibold">Import contacts</h1>

      <Step number={1} title="The file">
        <label
          onDragOver={(event: DragEvent) => (event.preventDefault(), setDragging(true))}
          onDragLeave={() => setDragging(false)}
          onDrop={(event: DragEvent) => {
            event.preventDefault();
            setDragging(false);
            void read(event.dataTransfer.files[0]);
          }}
          className={cn('flex cursor-pointer flex-col items-center gap-2 rounded-[var(--radius-card)] border-2 border-dashed p-8 text-center', dragging ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40' : 'border-zinc-300 dark:border-zinc-700')}
        >
          <Upload aria-hidden className="size-6 text-zinc-500 dark:text-zinc-400" />
          <span>{upload ? `${upload.filename}: ${upload.total_rows} rows. Drop another file to start again.` : 'Drop a CSV here, or choose one'}</span>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">A header row; comma, semicolon, tab or pipe separated; up to 50,000 rows and 20 MB.</span>
          <input type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={(event) => void read(event.target.files?.[0])} />
        </label>
        {create.isPending && <Loading label="Reading the file…" />}
        <ErrorText error={fileError ?? create.error} />
      </Step>

      {upload && (
        <Step number={2} title="Which field each column fills">
          <div className="relative overflow-x-auto">
            <table className="w-full text-left">
              <thead className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                <tr>
                  <th className="py-1 pr-3 font-medium">Column</th>
                  <th className="py-1 pr-3 font-medium">Sample values</th>
                  <th className="py-1 pr-3 font-medium">Field</th>
                </tr>
              </thead>
              <tbody>
                {upload.headers.map((header, index) => {
                  const value = mapping[header] ?? '';
                  const custom = value.startsWith('custom.');
                  return (
                    <tr key={header} className="border-t border-zinc-200 dark:border-zinc-800">
                      <td className="py-1.5 pr-3 font-medium">{header}</td>
                      <td className="max-w-72 truncate pr-3 text-zinc-500 dark:text-zinc-400">{upload.sample_rows.map((row) => row[index]).filter(Boolean).slice(0, 3).join(' · ')}</td>
                      <td className="pr-3">
                        <span className="flex items-center gap-1">
                          <select aria-label={`Field for ${header}`} value={custom ? 'custom.' : value} onChange={(event) => setMapping({ ...mapping, [header]: event.target.value === '' ? null : event.target.value === 'custom.' ? `custom.${header.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'field'}` : event.target.value })} className={cn(inputClass, 'w-auto py-1')}>
                            <option value="">Skip this column</option>
                            {FIELDS.map((field) => (
                              <option key={field} value={field}>
                                {words(field)}
                              </option>
                            ))}
                            <option value="custom.">Custom field…</option>
                          </select>
                          {custom && <input aria-label={`Custom field key for ${header}`} value={value.slice(7)} onChange={(event) => setMapping({ ...mapping, [header]: `custom.${event.target.value.toLowerCase()}` })} pattern="[a-z][a-z0-9_]{0,59}" className={cn(inputClass, 'w-36 py-1 font-mono text-xs')} />}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!hasEmail && <p className="text-amber-700 dark:text-amber-300">One column must be the email address.</p>}
          <p className="text-xs text-zinc-500 dark:text-zinc-400">A custom field must exist for contacts with that key (it isn’t made here).</p>
        </Step>
      )}

      {upload && (
        <Step number={3} title="Options">
          <div className="flex flex-wrap gap-4">
            <label className="text-xs text-zinc-500 dark:text-zinc-400">
              When a contact already exists
              <select value={options.dedupe_strategy} onChange={(event) => setOptions({ ...options, dedupe_strategy: event.target.value as Options['dedupe_strategy'] })} className={cn(inputClass, 'mt-0.5 w-auto text-sm text-zinc-900 dark:text-zinc-100')}>
                <option value="skip">Leave it as it is</option>
                <option value="fill_empty">Fill its empty fields</option>
                <option value="overwrite">Overwrite it</option>
              </select>
            </label>
            <label className="text-xs text-zinc-500 dark:text-zinc-400">
              Consent basis for new contacts
              <select value={options.consent_basis} onChange={(event) => setOptions({ ...options, consent_basis: event.target.value as Options['consent_basis'] })} className={cn(inputClass, 'mt-0.5 w-auto text-sm text-zinc-900 dark:text-zinc-100')}>
                <option value="unknown">Not recorded</option>
                <option value="legitimate_interest">Legitimate interest</option>
                <option value="consent">Consent</option>
                <option value="existing_relationship">Existing relationship</option>
              </select>
            </label>
            <label className="text-xs text-zinc-500 dark:text-zinc-400">
              Add to a list
              <select value={options.list_id} onChange={(event) => setOptions({ ...options, list_id: event.target.value })} className={cn(inputClass, 'mt-0.5 w-auto text-sm text-zinc-900 dark:text-zinc-100')}>
                <option value="">No list</option>
                {lists.data?.data.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name}
                  </option>
                ))}
              </select>
            </label>
            {users.data && (
              <label className="text-xs text-zinc-500 dark:text-zinc-400">
                Owner
                <select value={options.owner_user_id} onChange={(event) => setOptions({ ...options, owner_user_id: event.target.value })} className={cn(inputClass, 'mt-0.5 w-auto text-sm text-zinc-900 dark:text-zinc-100')}>
                  <option value="">Nobody</option>
                  {users.data.data
                    .filter((user) => !user.deactivated_at)
                    .map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
          </div>
          {(tags.data?.data.length ?? 0) > 0 && (
            <fieldset className="flex flex-wrap items-center gap-3">
              <legend className="mb-1 text-xs text-zinc-500 dark:text-zinc-400">Tag every imported contact</legend>
              {tags.data!.data.map((tag) => (
                <label key={tag.id} className="flex items-center gap-1">
                  <input type="checkbox" checked={options.tag_ids.includes(tag.id)} onChange={(event) => setOptions({ ...options, tag_ids: event.target.checked ? [...options.tag_ids, tag.id] : options.tag_ids.filter((id) => id !== tag.id) })} /> {tag.name}
                </label>
              ))}
            </fieldset>
          )}
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Contacts with no consent basis can’t be enrolled where consent is required, such as Canada.</p>
        </Step>
      )}

      {upload && (
        <Step number={4} title="Check, then import">
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              preview.mutate(upload.id);
            }}
          >
            <Button type="submit" disabled={!hasEmail || preview.isPending}>
              {preview.isPending ? 'Checking…' : 'Check (dry run)'}
            </Button>
            {summary && (
              <Button variant="primary" disabled={commit.isPending} onClick={() => commit.mutate(upload.id)}>
                Import {summary.new + summary.update} contact{summary.new + summary.update === 1 ? '' : 's'}
              </Button>
            )}
          </form>
          <ErrorText error={preview.error ?? commit.error} />
          {summary && (
            <div className="space-y-2">
              <p className="flex flex-wrap gap-2 tabular-nums">
                <Pill tone="emerald">{summary.new} new</Pill>
                <Pill tone="sky">{summary.update} update</Pill>
                <Pill>{summary.skip} unchanged</Pill>
                <Pill tone={summary.invalid ? 'rose' : 'zinc'}>{summary.invalid} invalid</Pill>
                <Pill tone={summary.suppressed ? 'amber' : 'zinc'}>{summary.suppressed} suppressed</Pill>
                <Pill>{summary.duplicates_in_file} duplicates in file</Pill>
              </p>
              <Problems errors={summary.errors} />
            </div>
          )}
        </Step>
      )}
    </div>
  );
}

function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-3 rounded-[var(--radius-card)] border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="font-medium">
        <span className="mr-2 text-zinc-500 dark:text-zinc-400">{number}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Problems({ errors }: { errors: Schemas['ImportError'][] }) {
  if (errors.length === 0) return null;
  const csv = ['row,column,problem', ...errors.map((error) => [error.row, error.column ?? '', error.message].map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','))].join('\n');
  return (
    <div className="space-y-1">
      <ul className="max-h-48 space-y-0.5 overflow-y-auto text-xs">
        {errors.map((error) => (
          <li key={`${error.row}:${error.column}:${error.message}`}>
            Row {error.row}
            {error.column && ` (${error.column})`}: {error.message}
          </li>
        ))}
      </ul>
      <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`} download="import-problems.csv" className="text-xs text-indigo-700 underline dark:text-indigo-300">
        Download the problems (CSV)
      </a>
    </div>
  );
}

function Progress({ importId }: { importId: string }) {
  const job = useQuery({
    queryKey: ['import', importId],
    queryFn: () => unwrap(api.GET('/imports/{importId}', { params: { path: { importId } } })),
    refetchInterval: (query) => (query.state.data && (query.state.data.status === 'done' || query.state.data.status === 'failed') ? false : 1500),
  });
  if (job.isPending) return <Loading />;
  if (job.isError) return <ErrorText error={job.error} onRetry={() => void job.refetch()} />;
  const data = job.data;
  const share = data.total_rows ? Math.round((data.processed_rows / data.total_rows) * 100) : 0;
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Importing {data.filename}</h1>
      <div aria-label="Progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={share} className="h-2 rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div className="h-2 rounded-full bg-indigo-500 transition-all" style={{ width: `${data.status === 'done' ? 100 : share}%` }} />
      </div>
      <p className="tabular-nums">
        {data.status === 'processing' ? `${data.processed_rows} of ${data.total_rows} rows` : data.status === 'done' ? 'Done.' : data.status === 'failed' ? 'Stopped by an error; contacts written before it stay.' : words(data.status)}
      </p>
      {(data.status === 'done' || data.status === 'failed') && (
        <>
          <p className="flex flex-wrap gap-2 tabular-nums">
            <Pill tone="emerald">{data.created_count} created</Pill>
            <Pill tone="sky">{data.updated_count} updated</Pill>
            <Pill>{data.skipped_count} skipped</Pill>
            <Pill tone={data.error_count ? 'rose' : 'zinc'}>{data.error_count} with problems</Pill>
          </p>
          <Problems errors={data.errors} />
          <Link href="/contacts" className="inline-flex items-center rounded-[var(--radius-pill)] bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-700">
            See the contacts
          </Link>
        </>
      )}
    </div>
  );
}
