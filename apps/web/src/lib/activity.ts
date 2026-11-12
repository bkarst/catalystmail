// An activity entry (spec §22.C) as one line of words, for the thread's timeline and the inline
// dividers between emails (§15.7).

import type { Schemas } from './api.ts';
import { THREAD_STATE, words } from './format.ts';

type Activity = Schemas['Activity'];

const str = (value: unknown) => (typeof value === 'string' ? value : null);

const FIXED: Record<string, string> = {
  'thread.enrolled': 'Enrolled',
  'thread.classified': 'Classified',
  'thread.classification_fallback': 'Classified by Claude only',
  'thread.assigned': 'Assigned',
  'thread.ai_paused': 'You took over; the agent stands back',
  'thread.ai_resumed': 'The agent is back on',
  'message.composed': 'Email written',
  'message.pending_approval': 'Draft waiting for approval',
  'message.approved': 'Draft approved',
  'message.rejected': 'Draft rejected',
  'message.scheduled': 'Email scheduled',
  'message.sent': 'Email sent',
  'message.failed': 'Email failed',
  'message.bounced': 'Email bounced',
  'message.received': 'Reply received',
  'message.opened': 'Opened',
  'message.clicked': 'Link clicked',
  'message.edited': 'Email edited',
  'message.cancelled': 'Email cancelled',
  'message.attached': 'Email attached by hand',
  'message.send_retried': 'Send retried',
  'goal.achieved': 'Goal reached',
  'goal.revoked': 'Goal revoked',
  'escalation.created': 'Escalated',
  'escalation.resolved': 'Escalation resolved',
  'escalation.sla_breached': 'Escalation overdue',
  'escalation.snoozed': 'Escalation snoozed',
  'escalation.assigned': 'Escalation assigned',
  'knowledge.created_from_escalation': 'Answer saved to the knowledge base',
  'follow_up.scheduled': 'Follow-up scheduled',
  'follow_up.cancelled': 'Follow-up cancelled',
  'follow_up.skipped': 'Follow-up skipped',
  'follow_up.sequence_switched': 'Follow-up sequence switched',
  'follow_up.sequence_finished': 'Follow-ups finished',
  'follow_up.stopped': 'Follow-ups stopped',
  'follow_up.resumed': 'Follow-ups resumed',
  'follow_up.check_in_scheduled': 'Check-in scheduled',
  'follow_up.check_in_cancelled': 'Check-in cancelled',
  'thread.paused': 'Thread paused',
  'thread.resumed': 'Thread resumed',
  'thread.closed': 'Thread closed',
  'thread.stage_floor_set': 'Stage set by hand',
  'contact.unsubscribe_undone': 'Unsubscribe undone',
  'user.removed': 'Removed from the team',
  'domain.ramp_advanced': 'Ramp moved up a step',
  'domain.ramp_held': 'Ramp held',
  'domain.ramp_resumed': 'Ramp moving again',
  'domain.ramp_stepped_back': 'Ramp stepped back',
  'domain.ramp_plan_changed': 'Ramp plan changed',
  'domain.cap_overridden': 'Cap overridden',
  'domain.delisted': 'Off the blocklists',
  'domain.dns_changed': 'DNS records changed',
  'domain.first_touches_resumed': 'First emails resumed',
  'domain.postmaster_disconnected': 'Postmaster Tools disconnected',
  'mailbox.paused': 'Mailbox paused',
  'mailbox.resumed': 'Mailbox resumed',
  'mailbox.warmup_held': 'Warm-up held',
  'mailbox.connection_tested': 'Connection tested',
  'mailbox.poll_failed': 'Poll failed',
  'deliverability.junk_reply': 'A reply landed in Junk',
  'deliverability.breaker_tripped': 'Breaker tripped',
  'campaign.breaker_tripped': 'Campaign breaker tripped',
  'contact.created': 'Contact created',
  'contact.merged': 'Merged with a duplicate',
  'contact.deleted': 'Contact deleted',
  'contact.erased': 'Personal data erased',
  'contact.unsubscribed': 'Contact unsubscribed',
  'contact.note_added': 'Note added',
};

/** `goalName` names a goal by ID, for "Stage → Call booked achieved". */
export function activityText(activity: Activity, goalName: (id: string) => string | undefined = () => undefined): string {
  const data = activity.data as Record<string, unknown>;
  switch (activity.type) {
    case 'thread.stage_changed': {
      const goal = str(data.goal_id) && data.to === 'goal_achieved' ? goalName(str(data.goal_id)!) : undefined;
      return `Stage → ${goal ? `${goal} achieved` : words(str(data.to) ?? '')}`;
    }
    case 'goal.achieved':
    case 'goal.revoked': {
      const goal = str(data.goal_id) ? goalName(str(data.goal_id)!) : undefined;
      return `${activity.type === 'goal.achieved' ? 'Goal reached' : 'Goal revoked'}${goal ? `: ${goal}` : ''}`;
    }
    case 'thread.state_changed': {
      const to = str(data.to) ?? '';
      const reason = str(data.reason);
      return `${THREAD_STATE[to] ?? words(to)}${reason ? `: ${words(reason)}` : ''}`;
    }
    case 'thread.classified': {
      const intent = str(data.intent);
      return intent ? `Classified: ${words(intent)}${typeof data.p === 'number' ? ` ${Math.round(data.p * 100)}%` : ''}` : 'Classified';
    }
    case 'escalation.created': {
      const reason = str(data.reason);
      return reason ? `Escalated: ${words(reason)}${str(data.priority) ? ` (${str(data.priority)})` : ''}` : 'Escalated';
    }
    case 'follow_up.cancelled':
      return str(data.reason) ? `Follow-up cancelled: ${words(str(data.reason)!)}` : 'Follow-up cancelled';
    case 'contact.updated': {
      const fields = Array.isArray(data.fields) ? (data.fields as string[]) : [];
      const named = fields.map((field) => (field === 'tag_ids' ? 'tags' : words(field).toLowerCase()));
      return named.length ? `Changed ${named.join(', ')}${data.via === 'bulk_action' ? ' (bulk)' : ''}` : 'Details changed';
    }
    case 'domain.reputation_changed':
    case 'mailbox.health_changed': {
      const what = activity.type === 'domain.reputation_changed' ? 'Reputation' : 'Health';
      return `${what} ${words(str(data.from) ?? '?')} → ${words(str(data.to) ?? '?')}${typeof data.score === 'number' ? ` (${data.score})` : ''}`;
    }
    case 'contact.note_added':
      return str(data.text) ? `Note: ${data.text}` : 'Note added';
    default:
      return FIXED[activity.type] ?? words(activity.type.replace('.', ': '));
  }
}

/** The changes shown as hairline dividers between emails (§15.7). */
export const isDivider = (activity: Activity) => activity.type === 'thread.stage_changed' || activity.type === 'thread.state_changed' || activity.type === 'goal.achieved' || activity.type === 'goal.revoked';
