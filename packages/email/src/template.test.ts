import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { checkTemplate, renderTemplate, sampleContext, templateVariables, type TemplateContext } from './template.ts';

const vocabulary = { contactCustom: ['industry'], companyCustom: [], links: ['booking'] };
const context = (overrides: Partial<TemplateContext['contact']> = {}): TemplateContext => {
  const base = sampleContext(vocabulary);
  return { ...base, contact: { ...base.contact, ...overrides, custom: { industry: 'SaaS' } } };
};

describe('templates (§22.A, §19.2 template rendering)', () => {
  it('renders the documented variables and filters as plain text, without HTML escaping', () => {
    const result = renderTemplate('Hi {{ contact.first_name | capitalize }}, how is {{ company.name }} handling {{ contact.custom.industry | downcase }} & ops? {{ campaign.links.booking }}', context({ first_name: 'priya' }));
    assert.deepEqual(result, { output: 'Hi Priya, how is Globex handling saas & ops? https://example.com/booking', issues: [] });
    assert.equal(renderTemplate('{{ contact.title | truncate: 6 }}', context()).output, 'VP ...');
  });

  it('uses the fallback when a value is empty, and blocks an empty value without one', () => {
    assert.equal(renderTemplate('Hi {{ contact.first_name | default: "there" }},', context({ first_name: null })).output, 'Hi there,');
    const blocked = renderTemplate('Hi {{ contact.first_name }},', context({ first_name: '' }));
    assert.equal(blocked.output, null);
    assert.deepEqual(blocked.issues.map((issue) => [issue.code, issue.variable]), [['empty_variable', 'contact.first_name']]);
    assert.match(blocked.issues[0]!.message, /default: "…"/);
  });

  it('refuses unknown variables, filters and tags, and Liquid syntax errors', () => {
    const codes = (source: string) => checkTemplate(source, vocabulary).map((issue) => issue.code);
    assert.deepEqual(codes('{{ contact.nickname }} {{ contact.custom.seats }} {{ campaign.links.pricing }}'), ['unknown_variable', 'unknown_variable', 'unknown_variable']);
    assert.deepEqual(codes('{{ contact.first_name | upcase }}'), ['unknown_filter']);
    assert.deepEqual(codes('{% for x in contact %}{% endfor %}'), ['unsupported_tag', 'unsupported_tag']);
    assert.deepEqual(codes('{% include "x" %}'), ['unsupported_tag']);
    assert.deepEqual(codes('Hi {{ contact.first_name'), ['syntax']);
    assert.deepEqual(codes('{% if contact.title %}Hi{% endif %}'), []);
    assert.deepEqual(codes('{% if contact.secret %}x{% endif %}'), ['unknown_variable']);
    assert.deepEqual(codes('{% if contact.title %}unclosed'), ['syntax']);
    assert.equal(renderTemplate('{{ contact.nickname }}', context()).output, null);
  });

  it('never leaks {{ into the output', () => {
    for (const source of ['{{ "{{" }}', 'Plain text with no variables.', '{% if contact.title %}{{ contact.title }}{% else %}there{% endif %}']) {
      const result = renderTemplate(source, context());
      if (result.output !== null) assert.ok(source.includes('"{{"') || !result.output.includes('{{'), source);
    }
    assert.equal(renderTemplate('{% unless contact.city %}somewhere{% endunless %}{% if contact.city %}{{ contact.city }}{% endif %}', context()).output, 'San Francisco');
  });

  it('lists the variables an editor can offer', () => {
    const variables = templateVariables(vocabulary);
    assert.ok(variables.includes('contact.custom.industry') && variables.includes('campaign.links.booking') && variables.includes('unsubscribe_url'));
  });
});
