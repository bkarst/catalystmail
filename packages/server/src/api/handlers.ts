// One handler per operation in the contract. The type makes a missing handler a compile error,
// and the same map will serve the MCP endpoint, which calls operations without going through HTTP.

import { buildOpenApiDocument } from '@catalyst/contract';

import * as emails from '../campaigns/emails.ts';
import * as goals from '../campaigns/goals.ts';
import * as launch from '../campaigns/launch.ts';
import * as campaigns from '../campaigns/service.ts';
import * as companies from '../companies/service.ts';
import * as agentRequests from '../agent/requests.ts';
import * as analytics from '../analytics/service.ts';
import * as bulk from '../contacts/bulk.ts';
import * as merge from '../contacts/merge.ts';
import * as privacy from '../contacts/privacy.ts';
import * as contacts from '../contacts/service.ts';
import * as timeline from '../contacts/timeline.ts';
import * as customFields from '../custom-fields/service.ts';
import * as importing from '../imports/service.ts';
import * as jobsService from '../meta/jobs.ts';
import * as polling from '../inbound/poll.ts';
import * as integrationsService from '../integrations/service.ts';
import * as knowledge from '../knowledge/service.ts';
import * as unmatched from '../inbound/unmatched.ts';
import * as manual from '../outbound/manual.ts';
import * as lists from '../lists/service.ts';
import * as search from '../search/service.ts';
import * as settings from '../settings/service.ts';
import * as connection from '../sending/connection-test.ts';
import * as escalationsService from '../escalations/service.ts';
import * as deliverability from '../deliverability/views.ts';
import * as domains from '../sending/domains.ts';
import * as mailboxes from '../sending/mailboxes.ts';
import * as suppressions from '../suppressions/service.ts';
import * as threads from '../threads/service.ts';
import * as team from '../users/service.ts';
import * as webhooks from '../webhooks/service.ts';
import * as workQueue from '../work-queue/service.ts';
import * as aiUsage from '../agent/usage.ts';
import * as push from '../notifications/push-subscriptions.ts';
import * as apiKeys from '../api-keys/service.ts';
import { openEventStream } from '../events/stream.ts';
import type { AppDeps } from '../runtime.ts';
import { makeRoute, type Handlers } from './route.ts';

/** What sending by hand needs from the runtime. */
const manualDeps = (deps: AppDeps, now: Date): manual.ManualDeps => ({ jobs: deps.jobs, rng: Math.random, trackingSecret: deps.config.trackingSecret ?? null, appHost: deps.config.appHost, now });
/** What the agent needs from the runtime, on request (§11.3). */
async function afterGoalChange<T>(deps: AppDeps, campaignId: string, result: T): Promise<T> {
  if (deps.jev && deps.config.jevModel) await deps.jobs.enqueue('ai.reclassify_campaign', { campaign_id: campaignId });
  return result;
}

const agentDeps = (deps: AppDeps, now: Date) => ({ ...manualDeps(deps, now), claude: deps.claude, canarySecret: deps.config.canarySecret ?? 'catalyst-canary', jev: deps.jev, jevModel: deps.config.jevModel ?? null });

export const handlers: Handlers = {
  getOpenApiDocument: async () => ({ ...buildOpenApiDocument() }),

  getCurrentPrincipal: async ({ principal }) => ({
    kind: principal.kind,
    id: principal.id,
    name: principal.name,
    role: principal.role,
    scopes: principal.scopes,
    workspace: principal.workspace,
    two_factor_required: principal.needsTwoFactor === true,
  }),

  searchAll: ({ db, principal, query }) => search.searchAll(db, principal, query),
  getWorkQueue: ({ db, principal, query, now }) => workQueue.getWorkQueue(db, principal.workspace.id, query, now),
  streamEvents: async ({ db, deps, principal, headers }) => ({ body: openEventStream(db, deps.activityFeed, principal.workspace.id, { lastEventId: headers.get('last-event-id') }) }),
  getJob: ({ db, principal, params }) => jobsService.getJob(db, principal.workspace.id, params.jobId),

  // Contacts
  listContacts: ({ db, principal, query, now }) => contacts.listContacts(db, principal.workspace.id, query, now),
  createContact: ({ db, deps, principal, body, now }) => contacts.createContact(db, principal, body, now, deps.jobs),
  getContact: ({ db, principal, params }) => contacts.getContact(db, principal.workspace.id, params.contactId),
  updateContact: ({ db, deps, principal, params, body, ifMatch, now }) => contacts.updateContact(db, principal, params.contactId, body, ifMatch, now, deps.jobs),
  deleteContact: ({ db, deps, principal, params, now }) => contacts.deleteContact(db, principal, params.contactId, now, deps.jobs),
  eraseContact: ({ db, deps, principal, params, now }) => privacy.eraseContact(db, principal, params.contactId, now, deps.jobs),
  upsertContacts: ({ db, deps, principal, body, now }) => bulk.upsertContacts(db, principal, body, now, deps.jobs),
  applyContactBulkAction: ({ db, deps, principal, body, now }) => bulk.applyContactBulkAction(db, principal, body, deps, now),
  mergeContacts: ({ db, deps, principal, params, body, now }) => merge.mergeContacts(db, principal, params.contactId, body, now, deps.jobs),
  listContactTimeline: ({ db, principal, params, query }) => timeline.listContactTimeline(db, principal.workspace.id, params.contactId, query),
  addContactNote: ({ db, principal, params, body, now }) => timeline.addContactNote(db, principal, params.contactId, body.text, now),
  verifyContactEmail: ({ db, deps, principal, params, now }) => timeline.verifyContactEmail(db, principal, params.contactId, deps.dns, now),
  exportContactData: ({ db, principal, params, now }) => privacy.exportContactData(db, principal.workspace.id, params.contactId, now),
  listDuplicateContacts: ({ db, principal, query }) => merge.listDuplicateContacts(db, principal.workspace.id, query),

  // Imports
  createImport: ({ db, deps, principal, body, now }) => importing.createImport(db, principal, body, deps.storage, now),
  getImport: ({ db, principal, params }) => importing.getImport(db, principal.workspace.id, params.importId),
  previewImport: ({ db, deps, principal, params, body }) => importing.previewImport(db, principal, params.importId, body, deps.storage),
  commitImport: ({ db, deps, principal, params, body }) => importing.commitImport(db, principal, params.importId, body, deps.jobs),

  // Companies
  listCompanies: ({ db, principal, query }) => companies.listCompanies(db, principal.workspace.id, query),
  createCompany: ({ db, principal, body, now }) => companies.createCompany(db, principal, body, now),
  getCompany: ({ db, principal, params }) => companies.getCompany(db, principal.workspace.id, params.companyId),
  updateCompany: ({ db, principal, params, body, ifMatch, now }) => companies.updateCompany(db, principal, params.companyId, body, ifMatch, now),
  deleteCompany: ({ db, principal, params, now }) => companies.deleteCompany(db, principal, params.companyId, now),

  // Tags
  listTags: ({ db, principal, query }) => contacts.listTags(db, principal.workspace.id, query),
  createTag: ({ db, principal, body }) => contacts.createTag(db, principal.workspace.id, body),
  deleteTag: ({ db, principal, params }) => contacts.deleteTag(db, principal.workspace.id, params.tagId),

  // Lists and segments
  listLists: ({ db, principal, query, now }) => lists.listLists(db, principal.workspace.id, query, now),
  createList: ({ db, principal, body, now }) => lists.createList(db, principal, body, now),
  getList: ({ db, principal, params, now }) => lists.getList(db, principal.workspace.id, params.listId, now),
  updateList: ({ db, principal, params, body, ifMatch, now }) => lists.updateList(db, principal, params.listId, body, ifMatch, now),
  deleteList: ({ db, principal, params }) => lists.deleteList(db, principal.workspace.id, params.listId),
  listListMembers: ({ db, principal, params, query, now }) => lists.listListMembers(db, principal.workspace.id, params.listId, query, now),
  addListMembers: ({ db, principal, params, body, now }) => lists.addListMembers(db, principal.workspace.id, params.listId, body.contact_ids, now),
  removeListMembers: ({ db, principal, params, query, now }) => lists.removeListMembers(db, principal.workspace.id, params.listId, query.contact_ids, now),
  previewSegment: ({ db, principal, body, now }) => lists.previewSegment(db, principal.workspace.id, body.filter, now),

  // Custom fields
  listCustomFields: ({ db, principal, query }) => customFields.listCustomFields(db, principal.workspace.id, query),
  createCustomField: ({ db, principal, body }) => customFields.createCustomField(db, principal.workspace.id, body),
  updateCustomField: ({ db, principal, params, body }) => customFields.updateCustomField(db, principal.workspace.id, params.fieldId, body),
  deleteCustomField: ({ db, principal, params }) => customFields.deleteCustomField(db, principal.workspace.id, params.fieldId),

  // Suppressions
  listSuppressions: ({ db, principal, query }) => suppressions.listSuppressions(db, principal.workspace.id, query),
  createSuppression: ({ db, deps, principal, body, now }) => suppressions.createSuppression(db, principal, body, now, deps.jobs),
  deleteSuppression: ({ db, deps, principal, params, now }) => suppressions.deleteSuppression(db, principal, params.suppressionId, now, deps.jobs),
  checkSuppression: ({ db, principal, query }) => suppressions.checkSuppression(db, principal.workspace.id, query.email),

  // Campaigns
  listCampaigns: ({ db, principal, query }) => campaigns.listCampaigns(db, principal.workspace.id, query),
  createCampaign: ({ db, principal, body, now }) => campaigns.createCampaign(db, principal, body, now),
  getCampaign: ({ db, principal, params }) => campaigns.getCampaign(db, principal.workspace.id, params.campaignId),
  updateCampaign: ({ db, principal, params, body, ifMatch, now }) => campaigns.updateCampaign(db, principal, params.campaignId, body, ifMatch, now),
  deleteCampaign: ({ db, principal, params, now }) => campaigns.deleteCampaign(db, principal, params.campaignId, now),
  archiveCampaign: ({ db, deps, principal, params, now }) => campaigns.archiveCampaign(db, principal, params.campaignId, now, deps.jobs),
  runCampaignPreflight: ({ db, deps, principal, params, now }) => launch.campaignPreflight(db, principal.workspace.id, params.campaignId, now, deps.config.appHost),
  launchCampaign: ({ db, deps, principal, params, now }) =>
    campaigns.launchCampaign(db, principal, params.campaignId, now, { jobs: deps.jobs, preflight: (tx, row) => launch.runPreflight(tx, row, now, deps.config.appHost) }),
  pauseCampaign: ({ db, deps, principal, params, now }) => campaigns.pauseCampaign(db, principal, params.campaignId, now, deps.jobs),
  resumeCampaign: ({ db, deps, principal, params, now }) => campaigns.resumeCampaign(db, principal, params.campaignId, now, deps.jobs),
  listCampaignGoals: ({ db, principal, params }) => goals.listGoals(db, principal.workspace.id, params.campaignId),
  // A goal change has the campaign's open conversations read again (§10.4), once Jev is set up.
  createCampaignGoal: async ({ db, deps, principal, params, body }) => afterGoalChange(deps, params.campaignId, await goals.createGoal(db, principal, params.campaignId, body)),
  updateCampaignGoal: async ({ db, deps, principal, params, body }) => afterGoalChange(deps, params.campaignId, await goals.updateGoal(db, principal, params.campaignId, params.goalId, body)),
  deleteCampaignGoal: async ({ db, deps, principal, params }) => afterGoalChange(deps, params.campaignId, await goals.deleteGoal(db, principal, params.campaignId, params.goalId)),
  reorderCampaignGoals: async ({ db, deps, principal, params, body }) => afterGoalChange(deps, params.campaignId, await goals.reorderGoals(db, principal, params.campaignId, body.goal_ids)),
  getInitialEmail: ({ db, principal, params }) => emails.getInitialEmail(db, principal.workspace.id, params.campaignId),
  updateInitialEmail: ({ db, principal, params, body }) => emails.updateInitialEmail(db, principal, params.campaignId, body),
  listFollowUpSequences: ({ db, principal, params }) => emails.listSequences(db, principal.workspace.id, params.campaignId),
  createFollowUpSequence: ({ db, principal, params, body, now }) => emails.createSequence(db, principal, params.campaignId, body, now),
  getFollowUpSequence: ({ db, principal, params }) => emails.getSequence(db, principal.workspace.id, params.campaignId, params.sequenceId),
  updateFollowUpSequence: ({ db, principal, params, body, now }) => emails.updateSequence(db, principal, params.campaignId, params.sequenceId, body, now),
  deleteFollowUpSequence: ({ db, principal, params }) => emails.deleteSequence(db, principal, params.campaignId, params.sequenceId),
  createFollowUpStep: ({ db, principal, params, body, now }) => emails.createStep(db, principal, params.campaignId, params.sequenceId, body, now),
  updateFollowUpStep: ({ db, principal, params, body, now }) => emails.updateStep(db, principal, params.campaignId, params.sequenceId, params.stepId, body, now),
  deleteFollowUpStep: ({ db, principal, params }) => emails.deleteStep(db, principal, params.campaignId, params.sequenceId, params.stepId),
  reorderFollowUpSteps: ({ db, principal, params, body, now }) => emails.reorderSteps(db, principal, params.campaignId, params.sequenceId, body.step_ids, now),
  createStepVariant: ({ db, principal, params, body }) => emails.createVariant(db, principal, params.campaignId, params.stepId, body),
  updateStepVariant: ({ db, principal, params, body }) => emails.updateVariant(db, principal, params.campaignId, params.stepId, params.variantId, body),
  deleteStepVariant: ({ db, principal, params }) => emails.deleteVariant(db, principal, params.campaignId, params.stepId, params.variantId),
  previewCampaignStep: ({ db, deps, principal, params, body }) => launch.previewStep(db, principal.workspace.id, params.campaignId, params.stepId, body, deps.config.appHost),
  setCampaignMailboxes: ({ db, principal, params, body, now }) => campaigns.setCampaignMailboxes(db, principal, params.campaignId, body, now),
  enrollContacts: ({ db, deps, principal, params, body, now }) => launch.enrollContacts(db, principal, params.campaignId, body, deps.jobs, now),

  // Threads
  listThreads: ({ db, principal, query }) => threads.listThreads(db, principal.workspace.id, query),
  getThread: ({ db, principal, params }) => threads.getThread(db, principal.workspace.id, params.threadId),
  updateThread: ({ db, deps, principal, params, body, ifMatch, now }) => threads.updateThread(db, principal, params.threadId, body, ifMatch, { jobs: deps.jobs, now }),
  getThreadContext: ({ db, principal, params }) => threads.getThreadContext(db, principal.workspace.id, params.threadId),
  listThreadMessages: ({ db, principal, params, query }) => threads.listThreadMessages(db, principal.workspace.id, params.threadId, query),
  listThreadActivity: ({ db, principal, params, query }) => threads.listThreadActivity(db, principal.workspace.id, params.threadId, query),
  listThreadClassifications: ({ db, principal, params, query }) => threads.listThreadClassifications(db, principal.workspace.id, params.threadId, query),
  markGoalAchieved: ({ db, deps, principal, params, body, now }) => threads.markGoalAchieved(db, principal, params.threadId, params.goalId, body, { jobs: deps.jobs, now }),
  revokeGoalAchievement: ({ db, deps, principal, params, query, now }) => threads.revokeGoalAchievement(db, principal, params.threadId, params.goalId, query, { jobs: deps.jobs, now }),
  setThreadStageFloor: ({ db, deps, principal, params, body, now }) => threads.setThreadStageFloor(db, principal, params.threadId, body, { jobs: deps.jobs, now }),
  pauseThread: ({ db, deps, principal, params, now }) => threads.pauseThread(db, principal, params.threadId, { jobs: deps.jobs, now }),
  resumeThread: ({ db, deps, principal, params, now }) => threads.resumeThread(db, principal, params.threadId, { jobs: deps.jobs, now }),
  closeThread: ({ db, deps, principal, params, body, now }) => threads.closeThread(db, principal, params.threadId, body, { jobs: deps.jobs, now }),
  stopFollowUps: ({ db, deps, principal, params, now }) => threads.stopFollowUps(db, principal, params.threadId, { jobs: deps.jobs, now }),
  scheduleCheckIn: ({ db, deps, principal, params, body, now }) => threads.scheduleCheckIn(db, principal, params.threadId, body, { jobs: deps.jobs, now }),
  cancelCheckIn: ({ db, deps, principal, params, now }) => threads.cancelCheckIn(db, principal, params.threadId, { jobs: deps.jobs, now }),
  resumeFollowUps: ({ db, deps, principal, params, now }) => threads.resumeFollowUps(db, principal, params.threadId, { jobs: deps.jobs, now }),
  skipNextAction: ({ db, deps, principal, params, now }) => threads.skipNextAction(db, principal, params.threadId, { jobs: deps.jobs, now }),
  rescheduleNextAction: ({ db, deps, principal, params, body, now }) => threads.rescheduleNextAction(db, principal, params.threadId, body, { jobs: deps.jobs, now }),
  getMessage: ({ db, principal, params }) => threads.getMessage(db, principal.workspace.id, params.messageId),
  getMessageRaw: ({ db, deps, principal, params }) => threads.getMessageRaw(db, deps.storage, principal.workspace.id, params.messageId),
  createReply: ({ db, deps, principal, params, body, idempotencyKey, now }) => manual.createReply(db, principal, params.threadId, body, idempotencyKey, manualDeps(deps, now)),
  listPendingDrafts: ({ db, principal, query }) => manual.listPendingDrafts(db, principal.workspace.id, query),
  generateAiDraft: ({ db, deps, principal, params, body, now }) => agentRequests.generateAiDraft(db, principal, params.threadId, body, agentDeps(deps, now)),
  reclassifyThread: ({ db, deps, principal, params, now }) => agentRequests.reclassifyThread(db, principal, params.threadId, agentDeps(deps, now)),
  testKnowledge: ({ db, deps, principal, body, now }) => agentRequests.testKnowledge(db, principal, body, agentDeps(deps, now)),
  updateDraft: ({ db, deps, principal, params, body, ifMatch, now }) => manual.updateDraft(db, principal, params.messageId, body, ifMatch, now, deps.config.trackingSecret ?? null),
  approveDraft: ({ db, deps, principal, params, body, now }) => manual.approveDraft(db, principal, params.messageId, body, manualDeps(deps, now)),
  rejectDraft: ({ db, deps, principal, params, body, now }) => manual.rejectDraft(db, principal, params.messageId, body, { jobs: deps.jobs, now }),
  cancelScheduledMessage: ({ db, deps, principal, params, now }) => manual.cancelScheduledMessage(db, principal, params.messageId, { jobs: deps.jobs, now }),
  lintMessage: ({ db, principal, body }) => manual.lintText(db, principal.workspace.id, body),
  sendNextActionNow: ({ db, deps, principal, params, now }) => manual.sendNextActionNow(db, principal, params.threadId, manualDeps(deps, now)),
  listActivities: ({ db, principal, query }) => threads.listActivities(db, principal.workspace.id, query),

  listUnmatchedMessages: ({ db, principal, query }) => unmatched.listUnmatchedMessages(db, principal.workspace.id, query),
  attachMessageToThread: ({ db, deps, principal, params, body, now }) => unmatched.attachMessageToThread(db, principal, params.messageId, body, { jobs: deps.jobs, now }),
  ignoreUnmatchedMessage: ({ db, principal, params, now }) => unmatched.ignoreUnmatchedMessage(db, principal, params.messageId, now),

  // Escalations
  listEscalations: ({ db, principal, query, now }) => escalationsService.listEscalations(db, principal.workspace.id, query, now),
  getEscalation: ({ db, principal, params, now }) => escalationsService.getEscalation(db, principal.workspace.id, params.escalationId, now),
  resolveEscalation: ({ db, deps, principal, params, body, now }) => escalationsService.resolveEscalation(db, principal, params.escalationId, body, { jobs: deps.jobs, now }),
  snoozeEscalation: ({ db, deps, principal, params, body, now }) => escalationsService.snoozeEscalation(db, principal, params.escalationId, body, { jobs: deps.jobs, now }),
  assignEscalation: ({ db, deps, principal, params, body, now }) => escalationsService.assignEscalation(db, principal, params.escalationId, body, { jobs: deps.jobs, now }),
  dismissEscalation: ({ db, deps, principal, params, body, now }) => escalationsService.dismissEscalation(db, principal, params.escalationId, body, { jobs: deps.jobs, now }),
  answerEscalation: ({ db, deps, principal, params, body, now }) => agentRequests.answerEscalation(db, principal, params.escalationId, body, agentDeps(deps, now)),

  // Mailboxes
  listMailboxes: ({ db, principal, query }) => mailboxes.listMailboxes(db, principal.workspace.id, query),
  createMailbox: ({ db, deps, principal, body, now }) => mailboxes.createMailbox(db, principal, body, deps.secrets, now),
  getMailbox: ({ db, principal, params }) => mailboxes.getMailbox(db, principal.workspace.id, params.mailboxId),
  updateMailbox: ({ db, deps, principal, params, body, ifMatch, now }) => mailboxes.updateMailbox(db, principal, params.mailboxId, body, ifMatch, deps.secrets, now),
  deleteMailbox: ({ db, principal, params, now }) => mailboxes.deleteMailbox(db, principal, params.mailboxId, now),
  pauseMailbox: ({ db, principal, params, body, now }) => mailboxes.pauseMailbox(db, principal, params.mailboxId, body, now),
  resumeMailbox: ({ db, principal, params, body, now }) => mailboxes.resumeMailbox(db, principal, params.mailboxId, body, now),
  createMailboxDkimKey: ({ db, deps, principal, params, body, now }) => mailboxes.createMailboxDkimKey(db, principal, params.mailboxId, body, { secrets: deps.secrets }, now),
  deleteMailboxDkimKey: ({ db, principal, params, now }) => mailboxes.deleteMailboxDkimKey(db, principal, params.mailboxId, now),
  testMailboxConnection: ({ db, deps, principal, params }) => connection.testMailboxConnection(db, principal, params.mailboxId, deps),
  pollMailboxNow: ({ db, deps, principal, params, now }) => polling.pollMailboxNow(db, principal, params.mailboxId, deps.jobs, now),

  // Webhooks
  listWebhookEndpoints: ({ db, principal, query }) => webhooks.listWebhookEndpoints(db, principal.workspace.id, query),
  createWebhookEndpoint: ({ db, deps, principal, body, now }) => webhooks.createWebhookEndpoint(db, principal, body, { net: deps.webhookNet, secrets: deps.secrets }, now),
  updateWebhookEndpoint: ({ db, deps, principal, params, body, now }) => webhooks.updateWebhookEndpoint(db, principal, params.endpointId, body, { net: deps.webhookNet }, now),
  deleteWebhookEndpoint: ({ db, principal, params, now }) => webhooks.deleteWebhookEndpoint(db, principal, params.endpointId, now),
  testWebhookEndpoint: ({ db, deps, principal, params }) => webhooks.testWebhookEndpoint(db, principal, params.endpointId, { net: deps.webhookNet, secrets: deps.secrets, jobs: deps.jobs, now: () => new Date() }),
  listWebhookDeliveries: ({ db, principal, params, query }) => webhooks.listWebhookDeliveries(db, principal.workspace.id, params.endpointId, query),
  redeliverWebhook: ({ db, deps, principal, params }) => webhooks.redeliverWebhook(db, principal, params.deliveryId, { jobs: deps.jobs, now: () => new Date() }),

  // Integrations
  listIntegrations: ({ db, principal }) => integrationsService.listIntegrations(db, principal.workspace.id),
  createIntegration: ({ db, deps, principal, body, now }) => integrationsService.createIntegration(db, principal, body, deps.secrets, now),
  deleteIntegration: ({ db, principal, params, now }) => integrationsService.deleteIntegration(db, principal, params.integrationId, now),
  listIntegrationEvents: ({ db, principal, query }) => integrationsService.listIntegrationEvents(db, principal.workspace.id, query),
  attachIntegrationEvent: ({ db, deps, principal, params, body, now }) => integrationsService.attachIntegrationEvent(db, principal, params.eventId, body, { jobs: deps.jobs, now }),
  ingestIntegrationEvent: ({ db, deps, headers, text, body, now }) => integrationsService.ingestIntegrationEvent(db, headers, text, body, { secrets: deps.secrets, jobs: deps.jobs, now }),
  receiveStripeWebhook: ({ db, deps, headers, text, query, now }) => integrationsService.receiveProviderWebhook(db, 'stripe', query.integration_id, headers, text, { secrets: deps.secrets, jobs: deps.jobs, now }),
  receiveCalcomWebhook: ({ db, deps, headers, text, query, now }) => integrationsService.receiveProviderWebhook(db, 'calcom', query.integration_id, headers, text, { secrets: deps.secrets, jobs: deps.jobs, now }),
  receiveCalendlyWebhook: ({ db, deps, headers, text, query, now }) => integrationsService.receiveProviderWebhook(db, 'calendly', query.integration_id, headers, text, { secrets: deps.secrets, jobs: deps.jobs, now }),

  // Analytics
  getDashboardOverview: ({ db, principal, query, now }) => analytics.getDashboardOverview(db, principal.workspace.id, query, now),
  getFunnel: ({ db, principal, query, now }) => analytics.getFunnel(db, principal.workspace.id, query, now),
  listKnowledgeGaps: ({ db, principal, query, now }) => analytics.listKnowledgeGaps(db, principal.workspace.id, query, now),
  getCampaignStats: ({ db, principal, params, query, now }) => analytics.getCampaignStats(db, principal.workspace.id, params.campaignId, query, now),

  // Knowledge
  listKnowledgeItems: ({ db, principal, query }) => knowledge.listKnowledgeItems(db, principal.workspace.id, query),
  createKnowledgeItem: ({ db, principal, body, now }) => knowledge.createKnowledgeItem(db, principal, body, now),
  getKnowledgeItem: ({ db, principal, params }) => knowledge.getKnowledgeItem(db, principal.workspace.id, params.itemId),
  updateKnowledgeItem: ({ db, principal, params, body, ifMatch, now }) => knowledge.updateKnowledgeItem(db, principal, params.itemId, body, ifMatch, now),
  deleteKnowledgeItem: ({ db, principal, params, now }) => knowledge.deleteKnowledgeItem(db, principal, params.itemId, now),

  // Settings
  getWorkspaceSettings: ({ db, deps, principal, now }) => settings.getWorkspaceSettings(db, principal.workspace.id, now, deps.config.jevModel ?? null),
  getAiUsage: ({ db, principal, query, now }) => aiUsage.getAiUsage(db, principal.workspace.id, query, now),
  updateWorkspaceSettings: ({ db, deps, principal, body, ifMatch, now }) => settings.updateWorkspaceSettings(db, principal, body, ifMatch, { secrets: deps.secrets, net: deps.webhookNet, jevModel: deps.config.jevModel ?? null }, now),

  // Team
  listUsers: ({ db, principal, query }) => team.listUsers(db, principal.workspace.id, query),
  inviteUser: ({ db, principal, body, now }) => team.inviteUser(db, principal, body, now),
  listApiKeys: ({ db, principal, query }) => apiKeys.listApiKeys(db, principal, query),
  getPushSettings: ({ db, deps, principal }) => push.getPushSettings(db, principal, deps.config.vapid),
  createPushSubscription: ({ db, deps, principal, body, headers, now }) => push.createPushSubscription(db, principal, body, headers.get('user-agent'), deps.config.vapid, now),
  deletePushSubscription: ({ db, principal, params }) => push.deletePushSubscription(db, principal, params.subscriptionId),
  createApiKey: ({ db, principal, body, now }) => apiKeys.createApiKey(db, principal, body, now),
  revokeApiKey: ({ db, principal, params, now }) => apiKeys.revokeApiKey(db, principal, params.keyId, now),
  updateUser: ({ db, principal, params, body, now }) => team.updateUser(db, principal, params.userId, body, now),
  removeUser: ({ db, principal, params, now }) => team.removeUser(db, principal, params.userId, now),

  // Deliverability
  getSendingCapacity: ({ db, principal, query, now }) => deliverability.getSendingCapacity(db, principal.workspace.id, query, now),
  getDeliverabilityOverview: ({ db, principal, now }) => deliverability.getDeliverabilityOverview(db, principal.workspace.id, now),
  listPollRuns: ({ db, principal, params, query }) => mailboxes.listPollRuns(db, principal.workspace.id, params.mailboxId, query),
  getMailboxStats: ({ db, principal, params, query, now }) => mailboxes.getMailboxStats(db, principal.workspace.id, params.mailboxId, query, now),

  // Domains
  listDomains: ({ db, principal, query, now }) => domains.listDomains(db, principal.workspace.id, query, now),
  createDomain: ({ db, principal, body, now }) => domains.createDomain(db, principal, body, now),
  getDomain: ({ db, principal, params, now }) => domains.getDomain(db, principal.workspace.id, params.domainId, now),
  deleteDomain: ({ db, principal, params, now }) => domains.deleteDomain(db, principal, params.domainId, now),
  checkDomainDns: ({ db, deps, principal, params, now }) => domains.checkDomain(db, principal.workspace.id, params.domainId, { domainDns: deps.domainDns, trackingTarget: deps.config.trackingTarget }, now),
  resumeDomainFirstTouches: ({ db, principal, params, body, now }) => domains.resumeDomainFirstTouches(db, principal, params.domainId, body, now),
  getDomainReputation: ({ db, principal, params, now }) => domains.getDomainReputation(db, principal.workspace.id, params.domainId, now),
  getDomainRamp: ({ db, principal, params, now }) => domains.getDomainRamp(db, principal.workspace.id, params.domainId, now),
  updateDomainRamp: ({ db, principal, params, body, now }) => domains.updateDomainRamp(db, principal, params.domainId, body, now),
  holdDomainRamp: ({ db, principal, params, body, now }) => domains.holdDomainRamp(db, principal, params.domainId, body, now),
  resumeDomainRamp: ({ db, principal, params, body, now }) => domains.resumeDomainRamp(db, principal, params.domainId, body, now),
  stepBackDomainRamp: ({ db, principal, params, body, now }) => domains.stepBackDomainRamp(db, principal, params.domainId, body, now),
  setDomainCapOverride: ({ db, principal, params, body, now }) => domains.setDomainCapOverride(db, principal, params.domainId, body, now),
  clearDomainCapOverride: ({ db, principal, params, now }) => domains.clearDomainCapOverride(db, principal, params.domainId, now),
};

/** `export const GET = route('listContacts')` in a route file. */
export const route = makeRoute(handlers);
