'use client';

// A segment's live count and sample (spec §15.14): previewSegment a moment after the filter stops
// changing, with the server's words when the filter isn't valid yet.

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { api, unwrap } from '../lib/api.ts';
import { contactName } from './contact-bits.tsx';
import { ErrorText } from './ui.tsx';

export function SegmentPreview({ filter }: { filter: unknown }) {
  const [settled, setSettled] = useState(() => JSON.stringify(filter));
  useEffect(() => {
    const timer = setTimeout(() => setSettled(JSON.stringify(filter)), 400);
    return () => clearTimeout(timer);
  }, [filter]);
  const preview = useQuery({ queryKey: ['segment-preview', settled], queryFn: () => unwrap(api.POST('/lists/preview', { body: { filter: JSON.parse(settled) as Record<string, unknown> } })), retry: false });
  return (
    <div aria-live="polite" className="space-y-1 rounded-[var(--radius-card)] bg-zinc-50 p-3 dark:bg-zinc-900/50">
      {preview.isPending && <p className="text-zinc-500 dark:text-zinc-400">Counting…</p>}
      <ErrorText error={preview.error} onRetry={() => void preview.refetch()} />
      {preview.data && (
        <>
          <p className="font-medium tabular-nums">
            {preview.data.count} contact{preview.data.count === 1 ? '' : 's'} match
          </p>
          {preview.data.sample.length > 0 && (
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              {preview.data.sample.map((contact, index) => (
                <span key={contact.id}>
                  {index > 0 && ', '}
                  <Link href={`/contacts/${contact.id}`} className="hover:underline">
                    {contactName(contact)}
                  </Link>
                </span>
              ))}
              {preview.data.count > preview.data.sample.length && '…'}
            </p>
          )}
        </>
      )}
    </div>
  );
}
