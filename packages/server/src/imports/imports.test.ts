import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { detectDelimiter, parseCsv, parseRecords } from './csv.ts';
import { countryCode, mappingProblems, mapRow, suggestMapping } from './mapping.ts';

const defs = [
  { id: 'cfd_1', workspace_id: 'wsp_1', entity: 'contact', key: 'industry', label: 'Industry', type: 'select', options: ['SaaS', 'Agency'], required: false },
  { id: 'cfd_2', workspace_id: 'wsp_1', entity: 'contact', key: 'seats', label: 'Seat count', type: 'number', options: null, required: false },
];

describe('CSV parsing (§12.3)', () => {
  it('handles quotes, escaped quotes, embedded newlines and every line ending', () => {
    assert.deepEqual(parseRecords('a,b\r\n"x, y","say ""hi"""\n"multi\nline",z\rlast,row', ','), [
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['multi\nline', 'z'],
      ['last', 'row'],
    ]);
  });

  it('detects the delimiter from the header, ignoring quoted text', () => {
    assert.equal(detectDelimiter('email;name\nx;y'), ';');
    assert.equal(detectDelimiter('email\tname'), '\t');
    assert.equal(detectDelimiter('"a,b,c";d;e\n'), ';');
    assert.equal(detectDelimiter('email'), ',');
  });

  it('strips a BOM, drops blank lines, pads short rows and names unnamed or repeated headers', () => {
    const parsed = parseCsv('﻿Email,Name,,Email\n\npriya@globex.com,Priya\n  \n,,,\ndana@northwind.com,Dana,x,y,extra\n');
    assert.deepEqual(parsed.headers, ['Email', 'Name', 'Column 3', 'Email (2)']);
    assert.deepEqual(parsed.rows, [
      ['priya@globex.com', 'Priya', '', ''],
      ['dana@northwind.com', 'Dana', 'x', 'y'],
    ]);
  });
});

describe('column mapping (§12.3)', () => {
  it('suggests fields from header names, custom field keys and labels, and sample values', () => {
    const mapping = suggestMapping(['Work Email', 'Full Name', 'Organisation', 'Seat Count', 'industry', 'Notes', 'Favourite colour'], [], defs as never);
    assert.deepEqual(mapping, {
      'Work Email': 'email',
      'Full Name': 'full_name',
      Organisation: 'company',
      'Seat Count': 'custom.seats',
      industry: 'custom.industry',
      Notes: 'notes',
      'Favourite colour': null,
    });
    const bySample = suggestMapping(['Who', 'Contact info'], [['Priya', 'priya@globex.com'], ['Dana', '']], []);
    assert.equal(bySample['Contact info'], 'email');
    assert.equal(bySample.Who, null);
  });

  it('maps a row, normalising countries, splitting names and typing custom values', () => {
    const headers = ['Email', 'Name', 'Country', 'Seats', 'Industry', 'Tags', 'LinkedIn'];
    const mapping = { Email: 'email', Name: 'full_name', Country: 'country', Seats: 'custom.seats', Industry: 'custom.industry', Tags: 'tags', LinkedIn: 'linkedin_url' };
    const row = mapRow(['Priya@Globex.com', 'Priya van Natarajan', 'United States', '1,200', 'SaaS', 'webinar; q4;webinar', 'linkedin.com/in/priya'], headers, mapping, defs as never, 2);
    assert.ok(!Array.isArray(row));
    assert.deepEqual(row, {
      row: 2,
      email: 'priya@globex.com',
      fields: { first_name: 'Priya', last_name: 'van Natarajan', country: 'US', linkedin_url: 'https://linkedin.com/in/priya' },
      customFields: { seats: 1200, industry: 'SaaS' },
      companyName: null,
      tagNames: ['webinar', 'q4'],
    });
    assert.equal(countryCode('uk'), 'GB');
    assert.equal(countryCode('de'), 'DE');
    assert.equal(countryCode('Germany'), 'DE');
    assert.equal(countryCode('Atlantis'), null);
  });

  it('reports every problem in a row against its row number and column', () => {
    const headers = ['Email', 'Country', 'Industry', 'Timezone'];
    const mapping = { Email: 'email', Country: 'country', Industry: 'custom.industry', Timezone: 'timezone' };
    const errors = mapRow(['not-an-email', 'Atlantis', 'Retail', 'Mars/Base'], headers, mapping, defs as never, 7);
    assert.ok(Array.isArray(errors));
    assert.deepEqual(errors.map((error) => [error.row, error.column]), [[7, 'Country'], [7, 'Industry'], [7, 'Timezone'], [7, 'Email']]);
    const missing = mapRow(['', 'US', '', ''], headers, mapping, defs as never, 8);
    assert.ok(Array.isArray(missing) && missing[0]!.message === 'No email address.');
  });

  it('checks a mapping: one email column, known fields, no field twice', () => {
    const headers = ['Email', 'Name', 'Other'];
    assert.deepEqual(mappingProblems({ Email: 'email', Name: 'full_name' }, headers, []), []);
    const problems = mappingProblems({ Name: 'first_name', Other: 'first_name', Missing: 'title', Email: 'custom.nope' }, headers, []).map((problem) => problem.path);
    assert.deepEqual(problems, ['body.mapping.Other', 'body.mapping.Missing', 'body.mapping.Email', 'body.mapping']);
  });
});
