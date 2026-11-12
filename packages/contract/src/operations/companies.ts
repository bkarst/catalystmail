// Company operations (spec §13.4).

import { z } from 'zod';

import { describedEnum, id, paginated, paginationQuery } from '../common.ts';
import { defineOperation } from '../operation.ts';
import { companyExample, companySchema, createCompanySchema, updateCompanySchema } from '../schemas/companies.ts';

const companyParams = z.object({ companyId: id('company', 'The company to act on.') });

export const listCompanies = defineOperation({
  operationId: 'listCompanies',
  method: 'get',
  path: '/companies',
  tag: 'Companies',
  summary: 'List and search companies',
  description:
    'Returns companies one page at a time, by name unless `sort` says otherwise. Deleted companies are never returned. To list the people at a company use listContacts with `company_id`.',
  access: 'scoped',
  scopes: ['contacts:read'],
  query: z.object({
    ...paginationQuery,
    q: z.string().optional().meta({ description: 'Search text matched against name and domain.', examples: ['globex'] }),
    sort: describedEnum({ name: 'By name, A to Z (default).', '-created_at': 'Newest first.' }, { description: 'Sort order.' })
      .optional()
      .meta({ description: 'Sort order. Defaults to name.' }),
  }),
  response: { status: 200, description: 'A page of companies.', schema: paginated(companySchema, 'Company'), example: { data: [companyExample], next_cursor: null } },
  mcp: { toolset: 'contacts' },
});

export const createCompany = defineOperation({
  operationId: 'createCompany',
  method: 'post',
  path: '/companies',
  tag: 'Companies',
  summary: 'Create a company',
  description:
    'Creates a company. When it has a `domain` that is not a free-mail provider, existing contacts at that domain without a company are linked to it, and so are contacts created later. Fails with `conflict` if another company already has the domain.',
  access: 'scoped',
  scopes: ['contacts:write'],
  idempotencyKey: 'optional',
  body: { schema: createCompanySchema, example: { name: 'Globex', domain: 'globex.com', industry: 'SaaS' } },
  response: { status: 201, description: 'The company that was created.', schema: companySchema, example: companyExample },
  errors: [409],
  mcp: { toolset: 'contacts' },
});

export const getCompany = defineOperation({
  operationId: 'getCompany',
  method: 'get',
  path: '/companies/{companyId}',
  tag: 'Companies',
  summary: 'Get one company',
  description: 'Returns a company by ID with how many contacts belong to it. Use listContacts with `company_id` for the contacts themselves.',
  access: 'scoped',
  scopes: ['contacts:read'],
  params: companyParams,
  response: { status: 200, description: 'The company.', schema: companySchema, example: companyExample },
  mcp: { toolset: 'contacts' },
});

export const updateCompany = defineOperation({
  operationId: 'updateCompany',
  method: 'patch',
  path: '/companies/{companyId}',
  tag: 'Companies',
  summary: 'Change fields on a company',
  description:
    'Changes only the fields you send. Changing `domain` links contacts at the new domain that have no company; contacts already linked stay linked. Fails with `conflict` if another company has the domain.',
  access: 'scoped',
  scopes: ['contacts:write'],
  params: companyParams,
  ifMatch: true,
  body: { schema: updateCompanySchema, example: { employee_range: '500-1000' } },
  response: { status: 200, description: 'The company after the change.', schema: companySchema, example: companyExample },
  errors: [409],
  mcp: { toolset: 'contacts' },
});

export const deleteCompany = defineOperation({
  operationId: 'deleteCompany',
  method: 'delete',
  path: '/companies/{companyId}',
  tag: 'Companies',
  summary: 'Delete a company',
  description: 'Soft-deletes the company and unlinks its contacts. The contacts themselves are kept and can still be emailed.',
  access: 'scoped',
  scopes: ['contacts:write'],
  params: companyParams,
  response: { status: 204, description: 'The company was deleted.' },
  mcp: { toolset: 'contacts' },
});
