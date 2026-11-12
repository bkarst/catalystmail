// Contact imports (spec §12.3, §13.4, §15.13): upload → mapping → options → dry run → commit.

import { z } from 'zod';

import { describedEnum, id, timestamp } from '../common.ts';
import { defineOperation } from '../operation.ts';
import { consentBasisSchema, dedupeStrategySchema } from '../schemas/contacts.ts';

export const MAX_IMPORT_ROWS = 50_000;
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

const importField = z
  .string()
  .regex(/^(email|first_name|last_name|full_name|title|phone|linkedin_url|company|city|country|timezone|lifecycle_stage|notes|tags|do_not_contact|custom\.[a-z][a-z0-9_]{0,59})$/)
  .nullable()
  .meta({
    description:
      'A contact field: email, first_name, last_name, full_name (split into first and last), title, phone, linkedin_url, company (matched by name, created if new), city, country (name or code), timezone, lifecycle_stage, notes, tags (separated by ; or ,), do_not_contact, or custom.<key>. Null skips the column.',
    examples: ['email'],
  });

export const columnMappingSchema = z.record(z.string(), importField).meta({
  id: 'ColumnMapping',
  description: 'Which contact field each column of the file fills, by column header. Columns left out are skipped.',
  examples: [{ Email: 'email', Name: 'full_name', Company: 'company', Industry: 'custom.industry', Notes: null }],
});

export const importErrorSchema = z
  .object({
    row: z.int().meta({ description: 'Row number in the file; the header is row 1.' }),
    column: z.string().nullable().meta({ description: 'The column at fault, if one is.' }),
    message: z.string().meta({ description: 'What is wrong.' }),
  })
  .meta({ id: 'ImportError' });

export const importOptionsSchema = z
  .strictObject({
    mapping: columnMappingSchema,
    dedupe_strategy: dedupeStrategySchema.optional().meta({ description: 'What to do with addresses that already exist. Defaults to skip.' }),
    tag_ids: z.array(id('tag')).max(20).optional().meta({ description: 'Tags every imported contact gets.' }),
    list_id: id('list', 'A static list every imported contact is added to.').optional(),
    consent_basis: consentBasisSchema.optional().meta({ description: 'Legal basis recorded on new contacts. Defaults to unknown.' }),
    owner_user_id: id('user', 'Owner of new contacts.').optional(),
  })
  .meta({ id: 'ImportOptions', description: 'How to apply the file.' });

export const importSummarySchema = z
  .object({
    new: z.int().min(0).meta({ description: 'Rows that would create a contact.' }),
    update: z.int().min(0).meta({ description: 'Rows that match an existing contact and would change it.' }),
    skip: z.int().min(0).meta({ description: 'Rows that match an existing contact and leave it alone (dedupe strategy skip).' }),
    invalid: z.int().min(0).meta({ description: 'Rows with a problem; they are not imported.' }),
    suppressed: z.int().min(0).meta({ description: 'Rows whose address or domain is suppressed; they are not imported.' }),
    duplicates_in_file: z.int().min(0).meta({ description: 'Rows repeating an address that appears earlier in the file; the first one wins.' }),
    errors: z.array(importErrorSchema).meta({ description: 'The first 100 problems.' }),
  })
  .meta({ id: 'ImportSummary', description: 'What committing the import would do (a dry run).' });

export const importSchema = z
  .object({
    id: id('import'),
    filename: z.string().meta({ description: 'Name of the uploaded file.', examples: ['webinar.csv'] }),
    status: describedEnum(
      {
        uploaded: 'The file is stored and waiting for a mapping.',
        mapped: 'A dry run was made with a mapping; not committed yet.',
        processing: 'Committed; contacts are being written.',
        done: 'Finished. See the counts and errors.',
        failed: 'Stopped by an error; see errors. Contacts written before it stay.',
      },
      { description: 'Where the import stands.' },
    ),
    headers: z.array(z.string()).meta({ description: 'The column headers of the file, in order.' }),
    sample_rows: z.array(z.array(z.string())).meta({ description: 'The first 5 data rows, for checking the mapping.' }),
    suggested_mapping: columnMappingSchema.meta({ description: 'A mapping guessed from the headers and samples.' }),
    mapping: columnMappingSchema.nullable().meta({ description: 'The mapping last previewed or committed.' }),
    dedupe_strategy: dedupeStrategySchema,
    tag_ids: z.array(z.string()).meta({ description: 'Tags given to every imported contact.' }),
    list_id: z.string().nullable().meta({ description: 'The static list contacts are added to.' }),
    total_rows: z.int().min(0).meta({ description: 'Data rows in the file.' }),
    processed_rows: z.int().min(0).meta({ description: 'Rows handled so far while processing.' }),
    created_count: z.int().min(0).meta({ description: 'Contacts created.' }),
    updated_count: z.int().min(0).meta({ description: 'Existing contacts changed.' }),
    skipped_count: z.int().min(0).meta({ description: 'Rows not imported: existing contacts left alone, suppressed addresses and repeats.' }),
    error_count: z.int().min(0).meta({ description: 'Rows with problems.' }),
    errors: z.array(importErrorSchema).meta({ description: 'Row problems, up to 1,000, for the error report.' }),
    created_at: timestamp('When the file was uploaded.'),
    finished_at: timestamp('When processing finished.').nullable(),
  })
  .meta({ id: 'Import', description: 'An uploaded contact file and what became of it.' });
export type Import = z.infer<typeof importSchema>;

const importExample: Import = {
  id: 'imp_01jd3x5k8qf7tb9w2m4n6p8r0s',
  filename: 'webinar.csv',
  status: 'done',
  headers: ['Email', 'Name', 'Company'],
  sample_rows: [['priya@globex.com', 'Priya Natarajan', 'Globex']],
  suggested_mapping: { Email: 'email', Name: 'full_name', Company: 'company' },
  mapping: { Email: 'email', Name: 'full_name', Company: 'company' },
  dedupe_strategy: 'skip',
  tag_ids: [],
  list_id: null,
  total_rows: 1310,
  processed_rows: 1310,
  created_count: 1204,
  updated_count: 0,
  skipped_count: 94,
  error_count: 12,
  errors: [{ row: 17, column: 'Email', message: '"priya@globex" is not a valid email address.' }],
  created_at: '2026-11-10T18:00:00Z',
  finished_at: '2026-11-10T18:01:12Z',
};

const importParams = z.object({ importId: id('import', 'The import to act on.') });
const optionsExample = { mapping: { Email: 'email', Name: 'full_name', Company: 'company' }, dedupe_strategy: 'fill_empty', tag_ids: ['tag_01jd3x5k8qf7tb9w2m4n6p8r0s'] };

export const createImport = defineOperation({
  operationId: 'createImport',
  method: 'post',
  path: '/imports',
  tag: 'Imports',
  summary: 'Upload a CSV file of contacts',
  description: `Stores a CSV file (up to ${MAX_IMPORT_ROWS.toLocaleString('en-US')} rows) and returns its headers, sample rows and a suggested column mapping. Nothing is imported yet: check the mapping with previewImport, then commitImport.`,
  access: 'scoped',
  scopes: ['contacts:write'],
  idempotencyKey: 'optional',
  body: {
    schema: z
      .strictObject({
        filename: z.string().min(1).max(255).meta({ description: 'The file name, for the record.', examples: ['webinar.csv'] }),
        content: z.string().min(1).max(MAX_IMPORT_BYTES).meta({ description: 'The CSV text, with a header row. Comma, semicolon, tab or pipe separated.' }),
      })
      .meta({ id: 'CreateImport' }),
    example: { filename: 'webinar.csv', content: 'Email,Name,Company\npriya@globex.com,Priya Natarajan,Globex\n' },
  },
  response: { status: 201, description: 'The stored file and a suggested mapping.', schema: importSchema, example: { ...importExample, status: 'uploaded', mapping: null, processed_rows: 0, created_count: 0, skipped_count: 0, error_count: 0, errors: [], finished_at: null } },
  mcp: { toolset: 'contacts' },
});

export const getImport = defineOperation({
  operationId: 'getImport',
  method: 'get',
  path: '/imports/{importId}',
  tag: 'Imports',
  summary: 'Get an import with its progress and errors',
  description: 'Returns an import: its status, progress while processing, the counts when done, and the row problems for the error report. Poll it after commitImport.',
  access: 'scoped',
  scopes: ['contacts:read'],
  params: importParams,
  response: { status: 200, description: 'The import.', schema: importSchema, example: importExample },
  mcp: { toolset: 'contacts' },
});

export const previewImport = defineOperation({
  operationId: 'previewImport',
  method: 'post',
  path: '/imports/{importId}/preview',
  tag: 'Imports',
  summary: 'Dry-run an import: what it would create, update and skip',
  description:
    'Applies the mapping and options to the whole file without writing any contact, and counts new, updated, skipped, invalid, suppressed and repeated rows, with the first problems. Saves the mapping on the import. Run it before commitImport.',
  access: 'scoped',
  scopes: ['contacts:write'],
  params: importParams,
  body: { schema: importOptionsSchema, example: optionsExample },
  response: {
    status: 200,
    description: 'The dry-run counts.',
    schema: importSummarySchema,
    example: { new: 1204, update: 88, skip: 0, invalid: 12, suppressed: 7, duplicates_in_file: 3, errors: [{ row: 17, column: 'Email', message: '"priya@globex" is not a valid email address.' }] },
  },
  mcp: { toolset: 'contacts' },
});

export const commitImport = defineOperation({
  operationId: 'commitImport',
  method: 'post',
  path: '/imports/{importId}/commit',
  tag: 'Imports',
  summary: 'Import the contacts in an uploaded file',
  description:
    'Starts writing the contacts in the background and returns at once (202). Poll getImport for progress. Invalid and suppressed rows are skipped and reported; existing contacts follow `dedupe_strategy`. New addresses are verified afterwards. Sends no email. An import can be committed only once.',
  access: 'scoped',
  scopes: ['contacts:write'],
  params: importParams,
  idempotencyKey: 'optional',
  body: { schema: importOptionsSchema, example: optionsExample },
  response: { status: 202, description: 'The import, now processing.', schema: importSchema, example: { ...importExample, status: 'processing', processed_rows: 0, finished_at: null } },
  errors: [409],
  mcp: { toolset: 'contacts' },
});
