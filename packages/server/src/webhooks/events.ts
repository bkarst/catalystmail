// Which activities become which webhook events (spec §13.6). The activity log already records
// every one of them, so webhooks are read from it rather than raised at each place in the code.

import type { WebhookEventType } from '@catalyst/contract';
import type { activities } from '@catalyst/db';

type ActivityRow = typeof activities.$inferSelect;

const SAME_NAME: readonly WebhookEventType[] = [
  'thread.stage_changed',
  'thread.state_changed',
  'thread.classified',
  'message.sent',
  'message.received',
  'message.opened',
  'message.bounced',
  'escalation.created',
  'escalation.resolved',
  'contact.created',
  'contact.unsubscribed',
  'mailbox.health_changed',
  'mailbox.poll_failed',
  'deliverability.breaker_tripped',
  'domain.reputation_changed',
];

/** Activities renamed as an event, with what they add to its data. */
const RENAMED: Record<string, { type: WebhookEventType; data: Record<string, unknown> }> = {
  'goal.achieved': { type: 'thread.goal_achieved', data: {} },
  'message.pending_approval': { type: 'draft.pending_approval', data: {} },
  'campaign.launched': { type: 'campaign.status_changed', data: { status: 'active', change: 'launched' } },
  'campaign.paused': { type: 'campaign.status_changed', data: { status: 'paused', change: 'paused' } },
  'campaign.resumed': { type: 'campaign.status_changed', data: { status: 'active', change: 'resumed' } },
  'campaign.completed': { type: 'campaign.status_changed', data: { status: 'completed', change: 'completed' } },
  'campaign.archived': { type: 'campaign.status_changed', data: { status: 'archived', change: 'archived' } },
  'campaign.breaker_tripped': { type: 'campaign.status_changed', data: { status: 'paused', change: 'breaker_tripped' } },
  'domain.ramp_advanced': { type: 'domain.ramp_changed', data: { action: 'advanced' } },
  'domain.ramp_held': { type: 'domain.ramp_changed', data: { action: 'held' } },
  'domain.ramp_stepped_back': { type: 'domain.ramp_changed', data: { action: 'stepped_back' } },
  'domain.ramp_resumed': { type: 'domain.ramp_changed', data: { action: 'resumed' } },
  'domain.ramp_plan_changed': { type: 'domain.ramp_changed', data: { action: 'plan_changed' } },
  'domain.cap_overridden': { type: 'domain.ramp_changed', data: { action: 'cap_overridden' } },
};

export function eventFor(activityType: string): { type: WebhookEventType; data: Record<string, unknown> } | null {
  if ((SAME_NAME as readonly string[]).includes(activityType)) return { type: activityType as WebhookEventType, data: {} };
  return RENAMED[activityType] ?? null;
}

/** The activity types that produce any of these events. */
export function activityTypesFor(events: readonly string[]): string[] {
  const wanted = new Set(events);
  return [...SAME_NAME.filter((type) => wanted.has(type)), ...Object.entries(RENAMED).filter(([, event]) => wanted.has(event.type)).map(([activity]) => activity)];
}

/** One event ID per activity, the same for every endpoint. */
export const eventIdFor = (activityId: string) => `evt_${activityId.slice(activityId.indexOf('_') + 1)}`;

/** The §13.6 envelope. */
export function envelopeFor(activity: ActivityRow) {
  const event = eventFor(activity.type)!;
  return {
    id: eventIdFor(activity.id),
    type: event.type,
    created_at: activity.occurred_at.toISOString(),
    workspace_id: activity.workspace_id,
    data: {
      ...(activity.data as Record<string, unknown>),
      ...event.data,
      ...(activity.thread_id && { thread_id: activity.thread_id }),
      ...(activity.contact_id && { contact_id: activity.contact_id }),
      ...(activity.campaign_id && { campaign_id: activity.campaign_id }),
    },
  };
}
