import assert from 'node:assert/strict';

import { describe, it } from 'vitest';
import { z } from 'zod';

import { buildOpenApiDocument, errorStatuses, headerParams } from './openapi.ts';
import { mcpAnnotations, TOOLSETS, toolName, type Operation } from './operation.ts';
import { createContact, listContacts, operations as registry } from './operations/index.ts';
import { WEBHOOK_EVENTS } from './schemas/webhooks.ts';

type Json = Record<string, any>;
// Typed as plain operations: the registry's literal types don't all have every optional field.
const operations: readonly Operation[] = registry;
const document = buildOpenApiDocument() as Json;
const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'];

/** Every operation object in the document, with where it lives. */
const documented = Object.entries(document.paths as Json).flatMap(([path, item]) =>
  HTTP_METHODS.filter((method) => item[method]).map((method) => ({ path, method, operation: item[method] as Json })),
);

/** Visits every object nested in a JSON value. */
function walk(value: unknown, visit: (node: Json, path: string) => void, path = '#'): void {
  if (Array.isArray(value)) value.forEach((entry, index) => walk(entry, visit, `${path}/${index}`));
  else if (value !== null && typeof value === 'object') {
    visit(value as Json, path);
    for (const [key, entry] of Object.entries(value)) walk(entry, visit, `${path}/${key}`);
  }
}

const bodyKeys = (operation: Operation) => (operation.body?.schema instanceof z.ZodObject ? Object.keys(operation.body.schema.shape) : []);

describe('operation registry', () => {
  it('lists the operations declared so far, in catalog order', () => {
    assert.deepEqual(
      operations.map((operation) => `${operation.method.toUpperCase()} ${operation.path} ${operation.operationId}`),
      [
        'GET /openapi.json getOpenApiDocument',
        'GET /me getCurrentPrincipal',
        'GET /work-queue getWorkQueue',
        'GET /events/stream streamEvents',
        'GET /jobs/{jobId} getJob',
        'GET /search searchAll',
        'GET /contacts listContacts',
        'POST /contacts createContact',
        'GET /contacts/{contactId} getContact',
        'PATCH /contacts/{contactId} updateContact',
        'DELETE /contacts/{contactId} deleteContact',
        'POST /contacts/{contactId}/erase eraseContact',
        'POST /contacts/bulk-upsert upsertContacts',
        'POST /contacts/bulk-actions applyContactBulkAction',
        'POST /contacts/{contactId}/merge mergeContacts',
        'GET /contacts/{contactId}/timeline listContactTimeline',
        'POST /contacts/{contactId}/notes addContactNote',
        'POST /contacts/{contactId}/verify verifyContactEmail',
        'GET /contacts/{contactId}/export exportContactData',
        'GET /contacts/duplicates listDuplicateContacts',
        'POST /imports createImport',
        'GET /imports/{importId} getImport',
        'POST /imports/{importId}/preview previewImport',
        'POST /imports/{importId}/commit commitImport',
        'GET /companies listCompanies',
        'POST /companies createCompany',
        'GET /companies/{companyId} getCompany',
        'PATCH /companies/{companyId} updateCompany',
        'DELETE /companies/{companyId} deleteCompany',
        'GET /tags listTags',
        'POST /tags createTag',
        'DELETE /tags/{tagId} deleteTag',
        'GET /lists listLists',
        'POST /lists createList',
        'GET /lists/{listId} getList',
        'PATCH /lists/{listId} updateList',
        'DELETE /lists/{listId} deleteList',
        'GET /lists/{listId}/members listListMembers',
        'POST /lists/{listId}/members addListMembers',
        'DELETE /lists/{listId}/members removeListMembers',
        'POST /lists/preview previewSegment',
        'GET /custom-fields listCustomFields',
        'POST /custom-fields createCustomField',
        'PATCH /custom-fields/{fieldId} updateCustomField',
        'DELETE /custom-fields/{fieldId} deleteCustomField',
        'GET /suppressions listSuppressions',
        'POST /suppressions createSuppression',
        'DELETE /suppressions/{suppressionId} deleteSuppression',
        'GET /suppressions/check checkSuppression',
        'GET /campaigns listCampaigns',
        'POST /campaigns createCampaign',
        'GET /campaigns/{campaignId} getCampaign',
        'PATCH /campaigns/{campaignId} updateCampaign',
        'DELETE /campaigns/{campaignId} deleteCampaign',
        'POST /campaigns/{campaignId}/archive archiveCampaign',
        'GET /campaigns/{campaignId}/preflight runCampaignPreflight',
        'POST /campaigns/{campaignId}/launch launchCampaign',
        'POST /campaigns/{campaignId}/pause pauseCampaign',
        'POST /campaigns/{campaignId}/resume resumeCampaign',
        'GET /campaigns/{campaignId}/goals listCampaignGoals',
        'POST /campaigns/{campaignId}/goals createCampaignGoal',
        'PATCH /campaigns/{campaignId}/goals/{goalId} updateCampaignGoal',
        'DELETE /campaigns/{campaignId}/goals/{goalId} deleteCampaignGoal',
        'POST /campaigns/{campaignId}/goals/reorder reorderCampaignGoals',
        'GET /campaigns/{campaignId}/initial-email getInitialEmail',
        'PUT /campaigns/{campaignId}/initial-email updateInitialEmail',
        'GET /campaigns/{campaignId}/follow-up-sequences listFollowUpSequences',
        'POST /campaigns/{campaignId}/follow-up-sequences createFollowUpSequence',
        'GET /campaigns/{campaignId}/follow-up-sequences/{sequenceId} getFollowUpSequence',
        'PATCH /campaigns/{campaignId}/follow-up-sequences/{sequenceId} updateFollowUpSequence',
        'DELETE /campaigns/{campaignId}/follow-up-sequences/{sequenceId} deleteFollowUpSequence',
        'POST /campaigns/{campaignId}/follow-up-sequences/{sequenceId}/steps createFollowUpStep',
        'PATCH /campaigns/{campaignId}/follow-up-sequences/{sequenceId}/steps/{stepId} updateFollowUpStep',
        'DELETE /campaigns/{campaignId}/follow-up-sequences/{sequenceId}/steps/{stepId} deleteFollowUpStep',
        'POST /campaigns/{campaignId}/follow-up-sequences/{sequenceId}/steps/reorder reorderFollowUpSteps',
        'POST /campaigns/{campaignId}/steps/{stepId}/variants createStepVariant',
        'PATCH /campaigns/{campaignId}/steps/{stepId}/variants/{variantId} updateStepVariant',
        'DELETE /campaigns/{campaignId}/steps/{stepId}/variants/{variantId} deleteStepVariant',
        'POST /campaigns/{campaignId}/steps/{stepId}/preview previewCampaignStep',
        'PUT /campaigns/{campaignId}/mailboxes setCampaignMailboxes',
        'POST /campaigns/{campaignId}/enrollments enrollContacts',
        'GET /threads listThreads',
        'GET /threads/{threadId} getThread',
        'PATCH /threads/{threadId} updateThread',
        'GET /threads/{threadId}/context getThreadContext',
        'GET /threads/{threadId}/messages listThreadMessages',
        'GET /threads/{threadId}/activity listThreadActivity',
        'GET /threads/{threadId}/classifications listThreadClassifications',
        'POST /threads/{threadId}/classify reclassifyThread',
        'POST /threads/{threadId}/goals/{goalId}/achieve markGoalAchieved',
        'DELETE /threads/{threadId}/goals/{goalId}/achieve revokeGoalAchievement',
        'POST /threads/{threadId}/stage-floor setThreadStageFloor',
        'POST /threads/{threadId}/pause pauseThread',
        'POST /threads/{threadId}/resume resumeThread',
        'POST /threads/{threadId}/close closeThread',
        'POST /threads/{threadId}/follow-ups/stop stopFollowUps',
        'POST /threads/{threadId}/follow-ups/resume resumeFollowUps',
        'POST /threads/{threadId}/next-action/skip skipNextAction',
        'POST /threads/{threadId}/check-in scheduleCheckIn',
        'DELETE /threads/{threadId}/check-in cancelCheckIn',
        'PATCH /threads/{threadId}/next-action rescheduleNextAction',
        'POST /threads/{threadId}/next-action/send-now sendNextActionNow',
        'POST /threads/{threadId}/replies createReply',
        'POST /threads/{threadId}/ai-draft generateAiDraft',
        'GET /messages/{messageId} getMessage',
        'GET /messages/{messageId}/raw getMessageRaw',
        'GET /drafts listPendingDrafts',
        'PATCH /messages/{messageId} updateDraft',
        'POST /messages/{messageId}/approve approveDraft',
        'POST /messages/{messageId}/reject rejectDraft',
        'POST /messages/{messageId}/cancel cancelScheduledMessage',
        'POST /messages/lint lintMessage',
        'GET /messages/unmatched listUnmatchedMessages',
        'POST /messages/{messageId}/attach attachMessageToThread',
        'POST /messages/{messageId}/ignore ignoreUnmatchedMessage',
        'GET /activities listActivities',
        'GET /escalations listEscalations',
        'GET /escalations/{escalationId} getEscalation',
        'POST /escalations/{escalationId}/resolve resolveEscalation',
        'POST /escalations/{escalationId}/snooze snoozeEscalation',
        'POST /escalations/{escalationId}/assign assignEscalation',
        'POST /escalations/{escalationId}/dismiss dismissEscalation',
        'POST /escalations/{escalationId}/answer answerEscalation',
        'GET /mailboxes listMailboxes',
        'POST /mailboxes createMailbox',
        'GET /mailboxes/{mailboxId} getMailbox',
        'PATCH /mailboxes/{mailboxId} updateMailbox',
        'DELETE /mailboxes/{mailboxId} deleteMailbox',
        'POST /mailboxes/{mailboxId}/pause pauseMailbox',
        'POST /mailboxes/{mailboxId}/resume resumeMailbox',
        'POST /mailboxes/{mailboxId}/dkim createMailboxDkimKey',
        'DELETE /mailboxes/{mailboxId}/dkim deleteMailboxDkimKey',
        'POST /mailboxes/{mailboxId}/test testMailboxConnection',
        'POST /mailboxes/{mailboxId}/poll pollMailboxNow',
        'GET /deliverability getDeliverabilityOverview',
        'GET /capacity getSendingCapacity',
        'GET /mailboxes/{mailboxId}/poll-runs listPollRuns',
        'GET /mailboxes/{mailboxId}/stats getMailboxStats',
        'GET /domains listDomains',
        'POST /domains createDomain',
        'GET /domains/{domainId} getDomain',
        'DELETE /domains/{domainId} deleteDomain',
        'POST /domains/{domainId}/check checkDomainDns',
        'POST /domains/{domainId}/first-touches/resume resumeDomainFirstTouches',
        'GET /domains/{domainId}/reputation getDomainReputation',
        'GET /domains/{domainId}/ramp getDomainRamp',
        'PATCH /domains/{domainId}/ramp updateDomainRamp',
        'POST /domains/{domainId}/ramp/hold holdDomainRamp',
        'POST /domains/{domainId}/ramp/resume resumeDomainRamp',
        'POST /domains/{domainId}/ramp/step-back stepBackDomainRamp',
        'PUT /domains/{domainId}/cap-override setDomainCapOverride',
        'DELETE /domains/{domainId}/cap-override clearDomainCapOverride',
        'GET /webhooks listWebhookEndpoints',
        'POST /webhooks createWebhookEndpoint',
        'PATCH /webhooks/{endpointId} updateWebhookEndpoint',
        'DELETE /webhooks/{endpointId} deleteWebhookEndpoint',
        'POST /webhooks/{endpointId}/test testWebhookEndpoint',
        'GET /webhooks/{endpointId}/deliveries listWebhookDeliveries',
        'POST /webhook-deliveries/{deliveryId}/redeliver redeliverWebhook',
        'GET /integrations listIntegrations',
        'POST /integrations createIntegration',
        'DELETE /integrations/{integrationId} deleteIntegration',
        'GET /integration-events listIntegrationEvents',
        'POST /integration-events/{eventId}/attach attachIntegrationEvent',
        'POST /integrations/events ingestIntegrationEvent',
        'POST /integrations/stripe/webhook receiveStripeWebhook',
        'POST /integrations/calcom/webhook receiveCalcomWebhook',
        'POST /integrations/calendly/webhook receiveCalendlyWebhook',
        'GET /analytics/overview getDashboardOverview',
        'GET /analytics/funnel getFunnel',
        'GET /campaigns/{campaignId}/stats getCampaignStats',
        'GET /analytics/knowledge-gaps listKnowledgeGaps',
        'GET /knowledge listKnowledgeItems',
        'POST /knowledge createKnowledgeItem',
        'GET /knowledge/{itemId} getKnowledgeItem',
        'PATCH /knowledge/{itemId} updateKnowledgeItem',
        'DELETE /knowledge/{itemId} deleteKnowledgeItem',
        'POST /knowledge/test testKnowledge',
        'GET /settings getWorkspaceSettings',
        'PATCH /settings updateWorkspaceSettings',
        'GET /users listUsers',
        'POST /users inviteUser',
        'PATCH /users/{userId} updateUser',
        'DELETE /users/{userId} removeUser',
        'GET /api-keys listApiKeys',
        'POST /api-keys createApiKey',
        'DELETE /api-keys/{keyId} revokeApiKey',
        'GET /settings/ai/usage getAiUsage',
        'GET /me/push getPushSettings',
        'POST /me/push/subscriptions createPushSubscription',
        'DELETE /me/push/subscriptions/{subscriptionId} deletePushSubscription',
      ],
    );
  });

  it('gives every operation a unique camelCase operationId that makes a valid tool name', () => {
    const ids = operations.map((operation) => operation.operationId);
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) {
      assert.match(id, /^[a-z][a-zA-Z0-9]*$/, id);
      assert.match(toolName(id), /^[a-z0-9_]{1,64}$/, id);
    }
    assert.equal(toolName('listContacts'), 'list_contacts');
    const routes = operations.map((operation) => `${operation.method} ${operation.path}`);
    assert.equal(new Set(routes).size, routes.length);
  });

  it('writes summaries of at most 80 characters and descriptions of at least 40', () => {
    for (const operation of operations) {
      assert.ok(operation.summary.length <= 80, `${operation.operationId}: summary is ${operation.summary.length} characters`);
      assert.ok(operation.description.length >= 40, `${operation.operationId}: description is too short`);
      assert.ok(!operation.summary.endsWith('.'), `${operation.operationId}: summary ends with a full stop`);
    }
  });

  it('declares access and scopes consistently', () => {
    for (const operation of operations) {
      if (operation.access === 'scoped') assert.ok(operation.scopes.length > 0, `${operation.operationId}: scoped without scopes`);
      else assert.deepEqual([...operation.scopes], [], `${operation.operationId}: scopes on a ${operation.access} operation`);
      // Reading needs a read scope; changing needs a write scope.
      for (const scope of operation.scopes) {
        if (operation.method === 'get') assert.ok(!scope.endsWith(':write'), `${operation.operationId}: a GET asks for ${scope}`);
      }
    }
  });

  it('matches path placeholders to path parameters', () => {
    for (const operation of operations) {
      const placeholders = [...operation.path.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
      assert.deepEqual(Object.keys(operation.params?.shape ?? {}), placeholders, operation.operationId);
    }
  });

  it('keeps bodies off GET and DELETE, and returns nothing with 204', () => {
    for (const operation of operations) {
      if (operation.method === 'get' || operation.method === 'delete') assert.equal(operation.body, undefined, operation.operationId);
      // Only 204 has no body; a non-JSON answer declares its media type instead of a schema.
      assert.equal(operation.response.status === 204, operation.response.schema === undefined && operation.response.mediaType === undefined, operation.operationId);
      if (operation.idempotencyKey) assert.equal(operation.method, 'post', operation.operationId);
      if (operation.ifMatch) assert.ok(['patch', 'put'].includes(operation.method), operation.operationId);
    }
  });

  it('has no parameter that collides with a body property, so MCP inputs can be one flat object', () => {
    for (const operation of operations) {
      const parameters = [
        ...Object.keys(operation.params?.shape ?? {}),
        ...Object.keys(operation.query?.shape ?? {}),
        ...Object.keys(headerParams(operation)?.shape ?? {}),
      ];
      const clashes = parameters.filter((name) => bodyKeys(operation).includes(name));
      assert.deepEqual(clashes, [], operation.operationId);
      assert.equal(new Set(parameters).size, parameters.length, operation.operationId);
    }
  });

  it('gives every operation an example that its own schema accepts', () => {
    for (const operation of operations) {
      if (operation.response.schema) {
        assert.notEqual(operation.response.example, undefined, `${operation.operationId}: no response example`);
        const parsed = operation.response.schema.safeParse(operation.response.example);
        assert.ok(parsed.success, `${operation.operationId} response example: ${parsed.error?.message}`);
      }
      if (operation.body) {
        const parsed = operation.body.schema.safeParse(operation.body.example);
        assert.ok(parsed.success, `${operation.operationId} body example: ${parsed.error?.message}`);
      }
    }
  });

  it('rejects unknown properties in request bodies', () => {
    for (const operation of operations) {
      if (!operation.body) continue;
      const parsed = operation.body.schema.safeParse({ ...(operation.body.example as object), not_a_field: true });
      assert.equal(parsed.success, false, `${operation.operationId} accepted an unknown property`);
    }
  });

  it('maps HTTP methods to MCP annotations', () => {
    const by = (id: string) => mcpAnnotations(operations.find((operation) => operation.operationId === id)!);
    assert.deepEqual(by('listContacts'), { readOnlyHint: true, idempotentHint: false, destructiveHint: false, openWorldHint: false });
    assert.deepEqual(by('updateContact'), { readOnlyHint: false, idempotentHint: true, destructiveHint: false, openWorldHint: false });
    assert.deepEqual(by('deleteContact'), { readOnlyHint: false, idempotentHint: false, destructiveHint: true, openWorldHint: false });
    assert.equal(by('getOpenApiDocument'), null);
    for (const operation of operations) {
      if (operation.mcp !== false) assert.ok(TOOLSETS.includes(operation.mcp.toolset), operation.operationId);
    }
  });
});

describe('OpenAPI document', () => {
  it('is OpenAPI 3.1 and documents every operation in the registry, and nothing else', () => {
    assert.equal(document.openapi, '3.1.0');
    assert.deepEqual(document.servers, [{ url: '/api/v1' }]);
    assert.deepEqual(
      documented.map(({ operation }) => operation.operationId).sort(),
      operations.map((operation) => operation.operationId).sort(),
    );
  });

  it('declares every webhook event under `webhooks`, each with the shared envelope (§13.6)', () => {
    const webhooks = (document as unknown as { webhooks: Record<string, { post: { requestBody: { content: { 'application/json': { schema: { properties: Record<string, unknown>; required: string[] } } } } } }> }).webhooks;
    assert.deepEqual(Object.keys(webhooks).sort(), Object.keys(WEBHOOK_EVENTS).sort());
    for (const entry of Object.values(webhooks)) assert.deepEqual([...entry.post.requestBody.content['application/json'].schema.required].sort(), ['created_at', 'data', 'id', 'type', 'workspace_id']);
  });

  it('carries summary, description, tag, scopes and MCP mapping on every operation', () => {
    for (const { operation } of documented) {
      const declared = operations.find((entry) => entry.operationId === operation.operationId)!;
      assert.equal(operation.summary, declared.summary);
      assert.equal(operation.description, declared.description);
      assert.deepEqual(operation.tags, [declared.tag]);
      assert.deepEqual(operation['x-required-scopes'], [...declared.scopes]);
      assert.ok(operation['x-mcp'] === false || typeof operation['x-mcp'].tool === 'string', operation.operationId);
      assert.deepEqual(operation.security, declared.access === 'public' ? [] : declared.access === 'session' ? [{ sessionCookie: [] }] : [{ bearerAuth: [] }, { sessionCookie: [] }]);
    }
    assert.deepEqual(Object.keys(document.components.securitySchemes), ['bearerAuth', 'sessionCookie']);
  });

  it('describes every parameter', () => {
    for (const { operation } of documented) {
      for (const parameter of operation.parameters ?? []) {
        assert.ok(parameter.description?.length > 0, `${operation.operationId}: parameter ${parameter.name} has no description`);
      }
    }
  });

  it('describes every enum value', () => {
    let enums = 0;
    walk(document, (node, path) => {
      if (!Array.isArray(node.enum)) return;
      enums += 1;
      assert.deepEqual(Object.keys(node['x-enum-descriptions'] ?? {}), node.enum, `${path}: enum values without descriptions`);
    });
    assert.ok(enums >= 8);
  });

  it('answers every error with a problem document, and every operation with its standard errors', () => {
    for (const { operation } of documented) {
      const declared = operations.find((entry) => entry.operationId === operation.operationId)!;
      const errors = Object.keys(operation.responses).map(Number).filter((status) => status >= 400);
      assert.deepEqual(errors, errorStatuses(declared), operation.operationId);
      for (const status of errors) {
        assert.deepEqual(Object.keys(operation.responses[status].content), ['application/problem+json'], `${operation.operationId} ${status}`);
        assert.deepEqual(operation.responses[status].content['application/problem+json'].schema, { $ref: '#/components/schemas/Problem' });
      }
    }
    const statuses = (id: string) => errorStatuses(operations.find((operation) => operation.operationId === id)!);
    assert.deepEqual(statuses('getOpenApiDocument'), [429, 500]);
    assert.deepEqual(statuses('getCurrentPrincipal'), [401, 429, 500]);
    assert.deepEqual(statuses('createContact'), [400, 401, 403, 409, 422, 429, 500]);
    assert.deepEqual(statuses('updateContact'), [400, 401, 403, 404, 409, 412, 429, 500]);
  });

  it('resolves every $ref to a component', () => {
    let refs = 0;
    walk(document, (node, path) => {
      if (typeof node.$ref !== 'string') return;
      refs += 1;
      const name = /^#\/components\/schemas\/(\w+)$/.exec(node.$ref)?.[1];
      assert.ok(name && document.components.schemas[name], `${path}: ${node.$ref} does not resolve`);
    });
    assert.ok(refs > 20);
  });

  it('names the shared schemas as components', () => {
    for (const name of ['Problem', 'ProblemCode', 'Scope', 'Principal', 'Contact', 'ContactPage', 'CreateContact', 'UpdateContact', 'Tag', 'LifecycleStage']) {
      assert.ok(document.components.schemas[name], `${name} is not a component`);
    }
    assert.equal(document.components.schemas.CreateContact.additionalProperties, false);
    assert.deepEqual(document.components.schemas.CreateContact.required, ['email']);
    assert.equal(document.components.schemas.UpdateContact.required, undefined);
    assert.equal(document.components.schemas.Contact.properties.id.pattern, '^ctc_[0-9a-z]{26}$');
  });

  it('documents the idempotency and concurrency headers', () => {
    const header = (path: string, method: string, name: string) =>
      (document.paths[path][method].parameters as Json[]).find((parameter) => parameter.in === 'header' && parameter.name === name);
    assert.equal(header('/contacts', 'post', 'Idempotency-Key')?.required ?? false, false);
    assert.ok(header('/contacts/{contactId}', 'patch', 'If-Match'));
    assert.equal(header('/contacts', 'get', 'Idempotency-Key'), undefined);
  });

  it('is stable: building twice gives the same document', () => {
    assert.deepEqual(buildOpenApiDocument(), document);
  });
});

describe('request validation', () => {
  it('coerces and bounds pagination parameters', () => {
    assert.deepEqual(listContacts.query.parse({}), { limit: 25 });
    assert.equal(listContacts.query.parse({ limit: '100' }).limit, 100);
    assert.equal(listContacts.query.safeParse({ limit: '101' }).success, false);
    assert.equal(listContacts.query.safeParse({ limit: '0' }).success, false);
    assert.equal(listContacts.query.safeParse({ sort: 'name' }).success, false);
    assert.equal(listContacts.query.safeParse({ tag_id: 'ctc_01jd3x5k8qf7tb9w2m4n6p8r0s' }).success, false);
  });

  it('requires a valid email to create a contact', () => {
    assert.equal(createContact.body.schema.safeParse({ email: 'not-an-email' }).success, false);
    assert.equal(createContact.body.schema.safeParse({ first_name: 'Priya' }).success, false);
    assert.equal(createContact.body.schema.safeParse({ email: 'priya@globex.com', lifecycle_stage: 'vip' }).success, false);
    assert.equal(createContact.body.schema.safeParse({ email: 'priya@globex.com', company_id: null }).success, true);
  });
});
