// @catalyst/server: the API runtime and the services behind it. The web app mounts the route
// handlers; the worker calls the same services from its jobs.

export { handlers, route } from './api/handlers.ts';
export { authenticate, generateApiKey, hashApiKey, type Principal } from './api/auth.ts';
export { ApiError, problemResponse } from './api/errors.ts';
export { authHandler, getDb, getDeps, setDb, setDeps, signedInPerson, type AppConfig, type AppDeps } from './runtime.ts';
export { mcpEndpoint } from './mcp/endpoint.ts';
export { verifyContactById } from './contacts/timeline.ts';
export { processImport } from './imports/service.ts';
export { evaluateThread, type Evaluation } from './threads/evaluate.ts';
export { escalationSlaCheck } from './escalations/service.ts';
export { dailyCapacityPlan, type DailyResult } from './deliverability/daily.ts';
export { rollupWorkspaceNow, statsRollup, type RollupResult } from './deliverability/rollup.ts';
export { blocklistCheck, dailyDnsCheck } from './deliverability/checks.ts';
export { deliverWebhook, dispatchWebhooks, type WebhookDeps } from './webhooks/delivery.ts';
export { dailyDigest, dispatchNotifications, type NotifyDeps } from './notifications/dispatch.ts';
export { processInboundReply, type AgentDeps, type AgentOutcome } from './agent/inbound.ts';
export { composeWithAgent } from './agent/compose.ts';
export { summarizeThread } from './agent/summarize.ts';
export { composeCheckIn } from './agent/check-in.ts';
export { httpsWebhookNet, type WebhookNet } from './webhooks/net.ts';
export { clickToken, openPixel, openToken, recordFetch, trackedClick, unsubscribePage, unsubscribePost, unsubscribeToken, type PublicDeps } from './public/tracking.ts';

import { getDb, getDeps } from './runtime.ts';
import type { PublicDeps } from './public/tracking.ts';

/** What the public tracking and unsubscribe routes need, from the process-wide runtime. */
export async function publicDeps(defer: PublicDeps['defer']): Promise<PublicDeps> {
  const deps = await getDeps();
  return { db: getDb(), jobs: deps.jobs, secret: deps.config.trackingSecret ?? null, now: new Date(), defer };
}
export { schedulerTick, type SchedulerDeps, type TickResult } from './outbound/scheduler.ts';
export { mailboxesToPoll, pollMailbox, POLL_INTERVAL_MS, type PollDeps, type PollResult, type PollTrigger } from './inbound/poll.ts';
export { appendToSent, reconcileUnknownSend, type ReconcileOutcome, type SentFolderDeps } from './outbound/sent-folder.ts';
export { sendMessage, sweepStuckSends, type SendDeps, type SendOutcome } from './outbound/send.ts';
export { createSecretBox, parseEncryptionKeys, secretBoxFromEnv, type SecretBox } from './secrets.ts';
export { configFromEnv } from './runtime.ts';
export { runRetention } from './maintenance/retention.ts';
export { finishOAuth, isOAuthProvider, oauthFromEnv, startMailboxOAuth, type OAuthConfig, type OAuthHttp } from './sending/oauth.ts';
export { oauthCallback, oauthStart, postmasterConnect } from './sending/oauth-routes.ts';
export { checkDomain } from './sending/domains.ts';
export { fetchPostmasterHttp, syncPostmaster, type PostmasterHttp } from './deliverability/postmaster.ts';
export { classifyAfterOutbound, classifyForHarness, reclassifyCampaign } from './agent/after-outbound.ts';
