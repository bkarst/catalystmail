// Companies (spec §6.4, §12.1, §15.14).

import { z } from 'zod';

import { id, timestamp } from '../common.ts';

/** A host name such as `globex.com`, lower-cased on write. */
export const domainName = (description: string) =>
  z
    .string()
    .max(253)
    .regex(/^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/, 'Not a domain name')
    .meta({ description, examples: ['globex.com'] });

const companyFields = {
  name: z.string().min(1).max(200).meta({ description: 'Company name.', examples: ['Globex'] }),
  domain: domainName('Email and web domain. Contacts with addresses at this domain are linked to the company automatically; free-mail domains never are.').nullable(),
  website: z.url().max(2000).nullable().meta({ description: 'Website URL.', examples: ['https://globex.com'] }),
  industry: z.string().max(120).nullable().meta({ description: 'Industry, free text.', examples: ['SaaS'] }),
  employee_range: z.string().max(40).nullable().meta({ description: 'Head-count band, free text.', examples: ['200-500'] }),
  country: z.string().length(2).nullable().meta({ description: 'ISO 3166-1 alpha-2 country code.', examples: ['US'] }),
  notes: z.string().max(10_000).nullable().meta({ description: 'Free-text notes. The agent may use them for personalization.' }),
  custom_fields: z.record(z.string(), z.unknown()).meta({ description: 'Values of the custom fields defined for companies, by field key.', examples: [{ tier: 'enterprise' }] }),
};

export const companySchema = z
  .object({
    id: id('company'),
    ...companyFields,
    contact_count: z.int().min(0).meta({ description: 'How many contacts belong to the company.' }),
    created_at: timestamp('When the company was created.'),
    updated_at: timestamp('When the company last changed.'),
  })
  .meta({ id: 'Company', description: 'An organisation that contacts belong to.' });
export type Company = z.infer<typeof companySchema>;

export const createCompanySchema = z
  .strictObject({ name: companyFields.name, ...z.object(companyFields).omit({ name: true }).partial().shape })
  .meta({ id: 'CreateCompany', description: 'A new company. Only `name` is required.' });

export const updateCompanySchema = z
  .strictObject(companyFields)
  .partial()
  .meta({ id: 'UpdateCompany', description: 'The fields to change. Fields left out stay as they are.' });

export const companyExample: Company = {
  id: 'co_01jd3x5k8qf7tb9w2m4n6p8r0s',
  name: 'Globex',
  domain: 'globex.com',
  website: 'https://globex.com',
  industry: 'SaaS',
  employee_range: '200-500',
  country: 'US',
  notes: null,
  custom_fields: { tier: 'enterprise' },
  contact_count: 3,
  created_at: '2026-10-02T15:04:00Z',
  updated_at: '2026-10-02T15:04:00Z',
};
