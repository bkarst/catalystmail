// Starting text for the default follow-up sequences (§5.10). Template steps are usable as written,
// except where a bracketed instruction marks text only the operator can supply; preflight refuses
// to launch while one is left in. AI steps hold a brief, not a message.

/** Marks default text that must be replaced before launch. */
export const PLACEHOLDER_MARK = '[Replace';

export const DEFAULT_STEP_TEXT = {
  no_reply: [
    'Hi {{ contact.first_name | default: "there" }},\n\nJust bumping this up in case it got buried. Worth a quick look?\n\n{{ sender.first_name }}',
    'Hi {{ contact.first_name | default: "there" }},\n\n[Replace this with a new angle: a short proof point or result from a similar company.]\n\n{{ sender.first_name }}',
    'Hi {{ contact.first_name | default: "there" }},\n\nI’ll stop here so I don’t crowd your inbox. If it becomes a priority for {{ company.name | default: "your team" }}, just reply and I’ll pick it up.\n\n{{ sender.first_name }}',
  ],
  responded: [
    'Follow up on the question they asked or the call we proposed. Two or three sentences, one clear ask.',
    'Offer the booking link again, and two specific time windows if email is easier for them.',
  ],
  goal: [
    'Recap the call in two sentences and confirm the agreed next step.',
    'Answer any open questions about plans, then resend the checkout link.',
  ],
} as const;
