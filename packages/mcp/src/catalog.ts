// MCP resources and prompts (spec §14.3). Each names the tools it relies on, and is offered only
// when the caller can use all of them, so a key never sees a prompt it cannot follow.

export interface ResourceTemplate {
  uriTemplate: string;
  name: string;
  description: string;
  /** Matches a concrete URI; named groups become the tool's arguments. */
  pattern: RegExp;
  tool: string;
}

export const RESOURCE_TEMPLATES: readonly ResourceTemplate[] = [
  {
    uriTemplate: 'catalyst://campaigns/{campaignId}',
    name: 'Campaign',
    description: 'A campaign with its goals, emails and settings.',
    pattern: /^catalyst:\/\/campaigns\/(?<campaignId>cmp_[0-9a-z]{26})$/,
    tool: 'get_campaign',
  },
  {
    uriTemplate: 'catalyst://threads/{threadId}/context',
    name: 'Thread context',
    description: 'An LLM-ready bundle for one conversation: contact, campaign, goals, transcript and classification.',
    pattern: /^catalyst:\/\/threads\/(?<threadId>thr_[0-9a-z]{26})\/context$/,
    tool: 'get_thread_context',
  },
];

export interface PromptDefinition {
  name: string;
  description: string;
  arguments: { name: string; description: string; required: boolean }[];
  tools: string[];
  render: (args: Record<string, string>) => string;
}

export const PROMPTS: readonly PromptDefinition[] = [
  {
    name: 'triage_attention_queue',
    description: 'Work through everything in Catalyst that needs a person, most urgent first.',
    arguments: [],
    tools: ['get_work_queue', 'get_thread_context'],
    render: () =>
      [
        'Triage my Catalyst attention queue.',
        '1. Call get_work_queue and group the items by priority (urgent, high, normal).',
        '2. For each item, call get_thread_context and summarise in one line what the contact wants and what the agent needs.',
        '3. Suggest an action for each, naming the tool you would use (answer_escalation, approve_draft, resolve_escalation, …).',
        'Do not send, approve or resolve anything until I confirm.',
      ].join('\n'),
  },
  {
    name: 'draft_campaign_from_brief',
    description: 'Turn a short brief into a draft campaign with goals, an initial email and follow-ups.',
    arguments: [{ name: 'brief', description: 'What you are selling, to whom, and what success looks like.', required: true }],
    tools: ['create_campaign', 'create_campaign_goal', 'update_initial_email', 'run_campaign_preflight'],
    render: (args) =>
      [
        `Draft a Catalyst campaign from this brief:\n\n${args.brief ?? ''}`,
        '1. create_campaign with a name and a plain-language objective.',
        '2. create_campaign_goal for each milestone, in order (for example "Call booked", then "Paid").',
        '3. update_initial_email with a short, personal first email using {{contact.first_name}} and {{company.name}}.',
        '4. Keep the default follow-up sequences unless the brief says otherwise.',
        '5. run_campaign_preflight and report what still fails. Leave the campaign as a draft: do not launch it.',
      ].join('\n'),
  },
  {
    name: 'weekly_pipeline_review',
    description: 'Review the last week: funnel, replies, goals reached and deliverability.',
    arguments: [],
    tools: ['get_dashboard_overview', 'get_funnel', 'list_threads'],
    render: () =>
      [
        'Give me a weekly pipeline review from Catalyst.',
        '1. get_dashboard_overview for the last 7 days.',
        '2. get_funnel for each active campaign, and note where conversion drops.',
        '3. list_threads with min_temperature=2 to find the hottest conversations, and list them with their next action.',
        'Finish with three concrete suggestions.',
      ].join('\n'),
  },
];
