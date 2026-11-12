// The team (spec §13.4, §15.18): the people in the workspace and their roles. Removing someone
// deactivates them: approvals, resolutions and audit entries still name them.

import { z } from 'zod';

import { id, paginated, paginationQuery, timestamp } from '../common.ts';
import { defineOperation } from '../operation.ts';
import { userRoleSchema } from './meta.ts';

const userSchema = z
  .object({
    id: id('user'),
    email: z.string(),
    name: z.string(),
    role: userRoleSchema,
    timezone: z.string().nullable().meta({ description: 'Their own IANA zone; null means the workspace’s.' }),
    notifications: z.object({ email: z.boolean().meta({ description: 'Alerts and the daily digest by email.' }), digest: z.boolean().meta({ description: 'The daily digest.' }) }),
    last_login_at: timestamp('When they last signed in.').nullable(),
    deactivated_at: timestamp('When they were removed from the team.').nullable(),
    created_at: timestamp('When they were added.'),
  })
  .meta({ id: 'User', description: 'A person in the workspace.' });
const example = {
  id: 'usr_01jd3x5k8qf7tb9w2m4n6p8r0s',
  email: 'sam@getacme.com',
  name: 'Sam Lee',
  role: 'member' as const,
  timezone: null,
  notifications: { email: true, digest: true },
  last_login_at: null,
  deactivated_at: null,
  created_at: '2026-11-10T08:00:00Z',
};
const userParams = z.object({ userId: id('user', 'The person.') });

export const listUsers = defineOperation({
  operationId: 'listUsers',
  method: 'get',
  path: '/users',
  tag: 'Settings',
  summary: 'List the team',
  description: 'The people in the workspace with their roles, by name. Removed people are left out unless `include_removed=true`.',
  access: 'scoped',
  scopes: ['settings:manage'],
  query: z.object({ ...paginationQuery, include_removed: z.enum(['true', 'false']).optional().meta({ description: 'Also people removed from the team.', 'x-enum-descriptions': { true: 'Include them.', false: 'Leave them out (the default).' } }) }),
  response: { status: 200, description: 'A page of people.', schema: paginated(userSchema, 'User'), example: { data: [example], next_cursor: null } },
  mcp: { toolset: 'admin' },
});

export const inviteUser = defineOperation({
  operationId: 'inviteUser',
  method: 'post',
  path: '/users',
  tag: 'Settings',
  summary: 'Add someone to the team',
  description: 'Adds a person with a role and emails them an invitation through the system SMTP. Someone removed earlier with the same email is brought back with the new role.',
  access: 'scoped',
  scopes: ['settings:manage'],
  idempotencyKey: 'optional',
  body: { schema: z.object({ email: z.email().meta({ description: 'Their work email.' }), name: z.string().trim().min(1).max(100), role: userRoleSchema }).strict(), example: { email: 'sam@getacme.com', name: 'Sam Lee', role: 'member' } },
  response: { status: 201, description: 'The person.', schema: userSchema, example },
  errors: [409],
  mcp: { toolset: 'admin' },
});

export const updateUser = defineOperation({
  operationId: 'updateUser',
  method: 'patch',
  path: '/users/{userId}',
  tag: 'Settings',
  summary: 'Change someone’s role or preferences',
  description: 'Changes a person’s name, role, timezone or notification preferences. The last owner can’t be demoted (409).',
  access: 'scoped',
  scopes: ['settings:manage'],
  params: userParams,
  body: {
    schema: z
      .object({
        name: z.string().trim().min(1).max(100).optional(),
        role: userRoleSchema.optional(),
        timezone: z.string().min(1).max(64).nullable().optional().meta({ description: 'An IANA zone, or null for the workspace’s.' }),
        notifications: z.object({ email: z.boolean().optional(), digest: z.boolean().optional() }).strict().optional().meta({ description: 'Which mail they get.' }),
      })
      .strict(),
    example: { role: 'admin' },
  },
  response: { status: 200, description: 'The person.', schema: userSchema, example: { ...example, role: 'admin' } },
  errors: [404, 409],
  mcp: { toolset: 'admin' },
});

export const removeUser = defineOperation({
  operationId: 'removeUser',
  method: 'delete',
  path: '/users/{userId}',
  tag: 'Settings',
  summary: 'Remove someone from the team',
  description: 'Removes a person: they get no more mail, their threads, open escalations, campaigns and mailboxes lose them as assignee or owner (escalations fall back to the workspace owners). Their name stays on what they did. The last owner can’t be removed (409).',
  access: 'scoped',
  scopes: ['settings:manage'],
  params: userParams,
  response: { status: 204, description: 'Removed.' },
  errors: [404, 409],
  mcp: { toolset: 'admin', destructive: true },
});
