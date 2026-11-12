// Email templates (spec §12.4, §22.A): Liquid in strict mode. Only the documented variables,
// filters (`default`, `capitalize`, `downcase`, `truncate`) and the `if`/`unless` tags are allowed;
// anything else is a lint blocker (§8.7), and so is a variable that renders empty without a
// `default` fallback. Templates render to plain text; the HTML part is built from that text.

import { Liquid } from 'liquidjs';

export interface TemplateVocabulary {
  /** Keys of the custom fields defined for contacts and companies. */
  contactCustom: readonly string[];
  companyCustom: readonly string[];
  /** Keys of `campaign.links`. */
  links: readonly string[];
}

export type TemplateIssueCode = 'syntax' | 'unknown_variable' | 'unknown_filter' | 'unsupported_tag' | 'empty_variable';

export interface TemplateIssue {
  code: TemplateIssueCode;
  message: string;
  /** The variable involved, such as `contact.first_name`. */
  variable?: string;
}

export interface TemplateContext {
  contact: {
    first_name: string | null;
    last_name: string | null;
    full_name: string | null;
    title: string | null;
    email: string;
    city: string | null;
    country: string | null;
    custom: Record<string, unknown>;
  };
  company: { name: string | null; domain: string | null; custom: Record<string, unknown> };
  sender: { first_name: string | null; full_name: string | null; title: string | null; signature: string | null };
  campaign: { name: string; links: Record<string, string> };
  ai: { opening_line: string | null };
  unsubscribe_url: string;
  workspace: { name: string; physical_address: string };
}

const FILTERS = new Set(['default', 'capitalize', 'downcase', 'truncate']);
const TAGS = new Set(['if', 'elsif', 'else', 'endif', 'unless', 'endunless']);

const FIXED_VARIABLES = new Set([
  'contact.first_name', 'contact.last_name', 'contact.full_name', 'contact.title', 'contact.email', 'contact.city', 'contact.country',
  'company.name', 'company.domain',
  'sender.first_name', 'sender.full_name', 'sender.title', 'sender.signature',
  'campaign.name',
  'ai.opening_line',
  'unsubscribe_url',
  'workspace.name', 'workspace.physical_address',
]);

/** Every variable a template may use with this vocabulary, for the editor's variable picker. */
export function templateVariables(vocabulary: TemplateVocabulary): string[] {
  return [
    ...FIXED_VARIABLES,
    ...vocabulary.contactCustom.map((key) => `contact.custom.${key}`),
    ...vocabulary.companyCustom.map((key) => `company.custom.${key}`),
    ...vocabulary.links.map((key) => `campaign.links.${key}`),
  ];
}

function isKnown(variable: string, vocabulary: TemplateVocabulary): boolean {
  if (FIXED_VARIABLES.has(variable)) return true;
  const custom = /^(contact|company)\.custom\.([A-Za-z0-9_]+)$/.exec(variable);
  if (custom) return (custom[1] === 'contact' ? vocabulary.contactCustom : vocabulary.companyCustom).includes(custom[2]!);
  const link = /^campaign\.links\.([A-Za-z0-9_]+)$/.exec(variable);
  return link ? vocabulary.links.includes(link[1]!) : false;
}

interface Output {
  variable: string | null;
  filters: string[];
}

const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const LITERAL = /^(?:"[^"]*"|'[^']*'|-?\d+(?:\.\d+)?|true|false|nil|null)$/;

/** Splits on `|` outside quotes. */
function splitFilters(expression: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (const character of expression) {
    if (quote) {
      if (character === quote) quote = null;
      current += character;
    } else if (character === '"' || character === "'") {
      quote = character;
      current += character;
    } else if (character === '|') {
      parts.push(current.trim());
      current = '';
    } else current += character;
  }
  parts.push(current.trim());
  return parts;
}

/** The outputs and tags in a template, and the problems a static read can find. */
function scan(source: string, vocabulary: TemplateVocabulary): { outputs: Output[]; issues: TemplateIssue[] } {
  const outputs: Output[] = [];
  const issues: TemplateIssue[] = [];
  const pattern = /\{\{-?([\s\S]*?)-?\}\}|\{%-?([\s\S]*?)-?%\}/g;
  let rest = source.replace(pattern, '');
  if (/\{\{|\}\}|\{%|%\}/.test(rest)) issues.push({ code: 'syntax', message: 'A {{ or {% is not closed (or a }} or %} is not opened).' });
  rest = '';
  for (const match of source.matchAll(pattern)) {
    if (match[1] !== undefined) {
      const [expression = '', ...filterParts] = splitFilters(match[1]);
      const filters = filterParts.map((part) => part.split(':')[0]!.trim());
      for (const filter of filters) {
        if (!FILTERS.has(filter)) issues.push({ code: 'unknown_filter', message: `The filter "${filter}" isn't available. Use default, capitalize, downcase or truncate.` });
      }
      if (LITERAL.test(expression)) {
        outputs.push({ variable: null, filters });
      } else if (VARIABLE.test(expression)) {
        if (!isKnown(expression, vocabulary)) issues.push({ code: 'unknown_variable', variable: expression, message: `{{ ${expression} }} is not a template variable.` });
        outputs.push({ variable: expression, filters });
      } else issues.push({ code: 'syntax', message: `"{{${match[1]}}}" is not a variable or a value.` });
    } else {
      const body = match[2]!.trim();
      const tag = body.split(/\s+/)[0] ?? '';
      if (!TAGS.has(tag)) {
        issues.push({ code: 'unsupported_tag', message: `{% ${tag} %} isn't supported. Templates can use if, elsif, else and unless.` });
        continue;
      }
      // Conditions may only test template variables.
      for (const word of body.slice(tag.length).split(/[\s=!<>]+/).filter(Boolean)) {
        if (['and', 'or', 'contains', 'blank', 'empty'].includes(word) || LITERAL.test(word)) continue;
        if (VARIABLE.test(word) && !isKnown(word, vocabulary)) issues.push({ code: 'unknown_variable', variable: word, message: `${word} is not a template variable.` });
      }
    }
  }
  return { outputs, issues };
}

/** Problems a template has regardless of who it is rendered for: run at edit time and at preflight. */
export function checkTemplate(source: string, vocabulary: TemplateVocabulary): TemplateIssue[] {
  const { issues } = scan(source, vocabulary);
  if (issues.some((issue) => issue.code === 'syntax')) return issues;
  try {
    engine.parse(source);
  } catch (error) {
    issues.push({ code: 'syntax', message: (error as Error).message.split('\n')[0]! });
  }
  return issues;
}

const engine = new Liquid({ strictVariables: true, strictFilters: true, ownPropertyOnly: true, greedy: false });

const valueAt = (context: TemplateContext, variable: string): unknown =>
  variable.split('.').reduce<unknown>((value, key) => (value !== null && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined), context);

const isEmpty = (value: unknown) => value === null || value === undefined || (typeof value === 'string' && value.trim() === '');

export interface RenderResult {
  /** The rendered text; null when a blocker stopped rendering. */
  output: string | null;
  issues: TemplateIssue[];
}

export function vocabularyOf(context: TemplateContext): TemplateVocabulary {
  return { contactCustom: Object.keys(context.contact.custom), companyCustom: Object.keys(context.company.custom), links: Object.keys(context.campaign.links) };
}

/**
 * Renders a template for one recipient. Every issue is a lint blocker: unknown variables or
 * filters, unsupported tags, Liquid errors, and variables that come out empty without a fallback.
 */
export function renderTemplate(source: string, context: TemplateContext, vocabulary: TemplateVocabulary = vocabularyOf(context)): RenderResult {
  const { outputs, issues } = scan(source, vocabulary);
  for (const output of outputs) {
    if (!output.variable || output.filters.includes('default') || issues.some((issue) => issue.variable === output.variable)) continue;
    if (isEmpty(valueAt(context, output.variable))) {
      issues.push({
        code: 'empty_variable',
        variable: output.variable,
        message: `{{ ${output.variable} }} is empty for this recipient. Add a fallback, e.g. {{ ${output.variable} | default: "…" }}.`,
      });
    }
  }
  if (issues.length > 0) return { output: null, issues: dedupe(issues) };
  try {
    return { output: engine.parseAndRenderSync(source, context) as string, issues: [] };
  } catch (error) {
    return { output: null, issues: [{ code: 'syntax', message: (error as Error).message.split('\n')[0]! }] };
  }
}

function dedupe(issues: TemplateIssue[]): TemplateIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}:${issue.variable ?? issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** A recipient-free sample context, for previews before any contact is enrolled. */
export function sampleContext(vocabulary: TemplateVocabulary): TemplateContext {
  return {
    contact: { first_name: 'Priya', last_name: 'Natarajan', full_name: 'Priya Natarajan', title: 'VP Operations', email: 'priya@globex.com', city: 'San Francisco', country: 'US', custom: Object.fromEntries(vocabulary.contactCustom.map((key) => [key, `[${key}]`])) },
    company: { name: 'Globex', domain: 'globex.com', custom: Object.fromEntries(vocabulary.companyCustom.map((key) => [key, `[${key}]`])) },
    sender: { first_name: 'Alex', full_name: 'Alex Rivera', title: 'Founder', signature: 'Alex Rivera\nAcme' },
    campaign: { name: 'Sample campaign', links: Object.fromEntries(vocabulary.links.map((key) => [key, `https://example.com/${key}`])) },
    ai: { opening_line: 'Saw that Globex is growing its operations team.' },
    unsubscribe_url: 'https://go.example.com/u/sample',
    workspace: { name: 'Acme', physical_address: '500 Howard St, San Francisco' },
  };
}
