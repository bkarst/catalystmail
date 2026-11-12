// Mapping CSV columns to contact fields (spec §12.3, §15.13): suggested from header names and sample
// values, then applied row by row with every problem reported against its row and column.

import { isValidAddressSyntax } from '@catalyst/email';

import { customValueError, type CustomFieldDefs } from '../custom-fields/service.ts';

/** Contact fields a column can map to, besides `custom.<key>`. */
export const IMPORT_FIELDS = [
  'email', 'first_name', 'last_name', 'full_name', 'title', 'phone', 'linkedin_url', 'company', 'city', 'country', 'timezone',
  'lifecycle_stage', 'notes', 'tags', 'do_not_contact',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number] | `custom.${string}`;
export type ColumnMapping = Record<string, string | null>;

const normalize = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, '');

const SYNONYMS: Record<(typeof IMPORT_FIELDS)[number], string[]> = {
  email: ['email', 'emailaddress', 'mail', 'workemail', 'businessemail', 'emailid'],
  first_name: ['firstname', 'first', 'givenname', 'forename', 'fname'],
  last_name: ['lastname', 'last', 'surname', 'familyname', 'lname'],
  full_name: ['name', 'fullname', 'contactname', 'contact'],
  title: ['title', 'jobtitle', 'position', 'role', 'jobrole'],
  phone: ['phone', 'phonenumber', 'mobile', 'telephone', 'tel', 'cell'],
  linkedin_url: ['linkedin', 'linkedinurl', 'linkedinprofile', 'linkedinprofileurl'],
  company: ['company', 'companyname', 'organization', 'organisation', 'account', 'accountname', 'employer'],
  city: ['city', 'town', 'locality'],
  country: ['country', 'countrycode', 'nation'],
  timezone: ['timezone', 'tz', 'zone'],
  lifecycle_stage: ['lifecyclestage', 'lifecycle', 'stage'],
  notes: ['notes', 'note', 'comments', 'comment'],
  tags: ['tags', 'tag', 'labels'],
  do_not_contact: ['donotcontact', 'dnc', 'optout'],
};

const LIFECYCLE = ['lead', 'prospect', 'engaged', 'opportunity', 'customer', 'churned', 'disqualified'];

/** A column → field mapping guessed from header names, custom field keys and labels, and sample values. */
export function suggestMapping(headers: readonly string[], samples: readonly string[][], defs: CustomFieldDefs): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<string>();
  const take = (header: string, field: ImportField) => {
    if (used.has(field)) return false;
    mapping[header] = field;
    used.add(field);
    return true;
  };
  for (const header of headers) {
    mapping[header] = null;
    const key = normalize(header);
    const standard = IMPORT_FIELDS.find((field) => SYNONYMS[field].includes(key));
    if (standard && take(header, standard)) continue;
    const def = defs.find((entry) => normalize(entry.key) === key || normalize(entry.label) === key);
    if (def) take(header, `custom.${def.key}`);
  }
  // A column of addresses is the email column even under an unexpected header.
  if (!used.has('email')) {
    const column = headers.findIndex((header, index) => mapping[header] === null && samples.length > 0 && samples.every((row) => !row[index] || isValidAddressSyntax(row[index]!)) && samples.some((row) => row[index]));
    if (column >= 0) take(headers[column]!, 'email');
  }
  return mapping;
}

// ── Countries ──────────────────────────────────────────────────────────────────────────────────

let countryCodes: Map<string, string> | undefined;

/** ISO 3166-1 alpha-2 from a code or an English country name ("United States", "UK"). */
export function countryCode(value: string): string | null {
  if (!countryCodes) {
    countryCodes = new Map();
    const names = new Intl.DisplayNames(['en'], { type: 'region' });
    for (let first = 65; first <= 90; first += 1) {
      for (let second = 65; second <= 90; second += 1) {
        const code = String.fromCharCode(first, second);
        const name = names.of(code);
        if (name && name !== code) {
          countryCodes.set(code.toLowerCase(), code);
          countryCodes.set(normalize(name), code);
        }
      }
    }
    for (const [alias, code] of Object.entries({ usa: 'US', unitedstatesofamerica: 'US', america: 'US', uk: 'GB', greatbritain: 'GB', england: 'GB', scotland: 'GB', wales: 'GB' })) {
      countryCodes.set(alias, code);
    }
  }
  return countryCodes.get(normalize(value)) ?? countryCodes.get(value.trim().toLowerCase()) ?? null;
}

// ── Rows ───────────────────────────────────────────────────────────────────────────────────────

export interface RowError {
  /** 1-based row number in the file, counting the header as row 1. */
  row: number;
  column: string | null;
  message: string;
}

export interface MappedRow {
  /** 1-based row number in the file. */
  row: number;
  email: string;
  fields: Record<string, unknown>;
  customFields: Record<string, unknown>;
  companyName: string | null;
  tagNames: string[];
}

function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Turns a text cell into the value a custom field's type expects. */
function customValue(type: string, text: string): unknown {
  if (type === 'number') {
    const number = Number(text.replace(/,/g, ''));
    return Number.isFinite(number) ? number : text;
  }
  if (type === 'boolean') {
    const lower = text.toLowerCase();
    if (['true', 'yes', 'y', '1'].includes(lower)) return true;
    if (['false', 'no', 'n', '0'].includes(lower)) return false;
  }
  return text;
}

const TRUE = ['true', 'yes', 'y', '1', 'x'];

/**
 * Applies the mapping to one row. Empty cells are left out, so an import never clears a value.
 * Returns the row, or the problems that stop it from being imported.
 */
export function mapRow(cells: readonly string[], headers: readonly string[], mapping: ColumnMapping, defs: CustomFieldDefs, row: number): MappedRow | RowError[] {
  const errors: RowError[] = [];
  const fields: Record<string, unknown> = {};
  const customFields: Record<string, unknown> = {};
  let email = '';
  let companyName: string | null = null;
  let tagNames: string[] = [];

  headers.forEach((header, index) => {
    const field = mapping[header];
    const value = cells[index]?.trim() ?? '';
    if (!field || value === '') return;
    const fail = (message: string) => errors.push({ row, column: header, message });

    if (field.startsWith('custom.')) {
      const key = field.slice('custom.'.length);
      const def = defs.find((entry) => entry.key === key);
      const converted = def ? customValue(def.type, value) : value;
      const problem = def ? customValueError(def, converted) : null;
      if (problem) fail(problem);
      else customFields[key] = converted;
      return;
    }
    switch (field) {
      case 'email':
        email = value.toLowerCase();
        break;
      case 'full_name': {
        const [first, ...rest] = value.split(/\s+/);
        if (fields.first_name === undefined) fields.first_name = first;
        if (rest.length > 0 && fields.last_name === undefined) fields.last_name = rest.join(' ');
        break;
      }
      case 'company':
        companyName = value.slice(0, 200);
        break;
      case 'tags':
        tagNames = [...new Set(value.split(/[;,|]/).map((name) => name.trim()).filter(Boolean))];
        break;
      case 'country': {
        const code = countryCode(value);
        if (code) fields.country = code;
        else fail(`"${value}" is not a country name or two-letter code.`);
        break;
      }
      case 'timezone':
        if (isTimeZone(value)) fields.timezone = value;
        else fail(`"${value}" is not an IANA timezone such as Europe/Berlin.`);
        break;
      case 'lifecycle_stage':
        if (LIFECYCLE.includes(value.toLowerCase())) fields.lifecycle_stage = value.toLowerCase();
        else fail(`Expected one of: ${LIFECYCLE.join(', ')}.`);
        break;
      case 'linkedin_url':
        try {
          fields.linkedin_url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).toString();
        } catch {
          fail('Not a URL.');
        }
        break;
      case 'do_not_contact':
        fields.do_not_contact = TRUE.includes(value.toLowerCase());
        break;
      case 'notes':
        fields.notes = value.slice(0, 10_000);
        break;
      default:
        fields[field] = value.slice(0, 200);
    }
  });

  if (!email) errors.push({ row, column: Object.keys(mapping).find((header) => mapping[header] === 'email') ?? null, message: 'No email address.' });
  else if (!isValidAddressSyntax(email)) errors.push({ row, column: Object.keys(mapping).find((header) => mapping[header] === 'email') ?? null, message: `"${email}" is not a valid email address.` });
  if (errors.length > 0) return errors;
  return { row, email, fields, customFields, companyName, tagNames };
}

/** Checks a mapping against the file's headers and the fields that exist. */
export function mappingProblems(mapping: ColumnMapping, headers: readonly string[], defs: CustomFieldDefs): { path: string; message: string }[] {
  const problems: { path: string; message: string }[] = [];
  const targets = new Map<string, string>();
  for (const [header, field] of Object.entries(mapping)) {
    const path = `body.mapping.${header}`;
    if (!headers.includes(header)) problems.push({ path, message: 'The file has no such column.' });
    if (field === null) continue;
    if (field.startsWith('custom.')) {
      if (!defs.some((def) => `custom.${def.key}` === field)) problems.push({ path, message: `No custom field ${field.slice(7)} is defined for contacts. Create it first.` });
    } else if (!(IMPORT_FIELDS as readonly string[]).includes(field)) problems.push({ path, message: `Unknown field "${field}".` });
    const other = targets.get(field);
    if (other && field !== 'tags') problems.push({ path, message: `"${other}" is already mapped to ${field}.` });
    targets.set(field, header);
  }
  if (!targets.has('email')) problems.push({ path: 'body.mapping', message: 'One column must map to email.' });
  return problems;
}
