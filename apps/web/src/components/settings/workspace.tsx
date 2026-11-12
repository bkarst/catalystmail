'use client';

// Settings → Workspace (spec §15.18): the name, the postal address in every compliance footer, the
// default timezone, and the business hours escalation SLAs count in (§11.1).

import { useState, type FormEvent } from 'react';

import { cn } from '../../lib/cn.ts';
import { Button, ErrorText, inputClass, Loading } from '../ui.tsx';
import { Field, Panel, Saved, useSettings, useUpdateSettings } from './common.tsx';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const ZONES: string[] = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];

type Settings = NonNullable<ReturnType<typeof useSettings>['data']>;

export function WorkspaceSection() {
  const settings = useSettings();
  if (settings.isPending) return <Loading />;
  if (settings.isError) return <ErrorText error={settings.error} />;
  return <WorkspaceForm settings={settings.data} />;
}

/** Starts from the settings once, so a refetch never overwrites what is being typed. */
function WorkspaceForm({ settings }: { settings: Settings }) {
  const update = useUpdateSettings();
  const [form, setForm] = useState(() => ({ name: settings.name, physical_address: settings.physical_address, default_timezone: settings.default_timezone, days: settings.business_hours.days, start: settings.business_hours.start, end: settings.business_hours.end }));
  const [saved, setSaved] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSaved(false);
    update.mutate(
      { name: form.name.trim(), physical_address: form.physical_address.trim(), default_timezone: form.default_timezone, business_hours: { days: [...form.days].sort(), start: form.start, end: form.end } },
      { onSuccess: () => setSaved(true) },
    );
  };

  return (
    <Panel title="Workspace">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Name">
          <input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={inputClass} maxLength={100} />
        </Field>
        <Field label="Postal address" hint="Shown in the compliance footer of every email (CAN-SPAM). Changes apply from the next email.">
          <textarea required minLength={10} maxLength={300} value={form.physical_address} onChange={(event) => setForm({ ...form, physical_address: event.target.value })} className={cn(inputClass, 'min-h-16')} />
        </Field>
        <Field label="Timezone" hint="The workspace’s day, and the zone for contacts without their own.">
          <input required list="zones" value={form.default_timezone} onChange={(event) => setForm({ ...form, default_timezone: event.target.value })} className={inputClass} />
          <datalist id="zones">
            {ZONES.map((zone) => (
              <option key={zone} value={zone} />
            ))}
          </datalist>
        </Field>
        <fieldset className="max-w-xl space-y-1">
          <legend className="text-zinc-600 dark:text-zinc-400">Business hours</legend>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((day, index) => (
              <label key={day} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={form.days.includes(index + 1)}
                  onChange={(event) => setForm({ ...form, days: event.target.checked ? [...form.days, index + 1] : form.days.filter((value) => value !== index + 1) })}
                />
                {day}
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input type="time" aria-label="Start" value={form.start} onChange={(event) => setForm({ ...form, start: event.target.value })} className={cn(inputClass, 'w-auto')} />
            to
            <input type="time" aria-label="End" value={form.end} onChange={(event) => setForm({ ...form, end: event.target.value })} className={cn(inputClass, 'w-auto')} />
          </div>
          <span className="block text-xs text-zinc-500 dark:text-zinc-400">Escalation deadlines count only these hours, in the workspace’s timezone. Applies to escalations raised from now on.</span>
        </fieldset>
        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" disabled={update.isPending || form.days.length === 0}>
            Save
          </Button>
          <Saved show={saved} />
        </div>
        <ErrorText error={update.error} />
      </form>
    </Panel>
  );
}
