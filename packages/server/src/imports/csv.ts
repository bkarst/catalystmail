// CSV parsing for imports (spec §12.3): RFC 4180 quoting, any of the common delimiters, a byte-order
// mark, and \r\n, \n or \r line endings. Pure, so it is tested on its own.

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
  delimiter: string;
}

const CANDIDATE_DELIMITERS = [',', ';', '\t', '|'];

/** The delimiter that splits the header line into the most fields, ignoring quoted text. */
export function detectDelimiter(text: string): string {
  const firstLine = text.slice(0, text.search(/\r\n|\n|\r|$/));
  let best = ',';
  let bestCount = 0;
  for (const delimiter of CANDIDATE_DELIMITERS) {
    let count = 0;
    let quoted = false;
    for (const character of firstLine) {
      if (character === '"') quoted = !quoted;
      else if (character === delimiter && !quoted) count += 1;
    }
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }
  return best;
}

/** Splits CSV text into records of fields. Blank lines are dropped. */
export function parseRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  let fieldStarted = false;

  const endField = () => {
    record.push(field);
    field = '';
    fieldStarted = false;
  };
  const endRecord = () => {
    endField();
    if (record.some((value) => value.trim() !== '')) records.push(record);
    record = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else quoted = false;
      } else field += character;
      continue;
    }
    if (character === '"' && !fieldStarted && field.trim() === '') {
      // An opening quote; whitespace before it is not part of the value.
      field = '';
      quoted = true;
      fieldStarted = true;
    } else if (character === delimiter) endField();
    else if (character === '\r' || character === '\n') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      endRecord();
    } else {
      field += character;
      fieldStarted = true;
    }
  }
  if (field !== '' || record.length > 0) endRecord();
  return records;
}

export function parseCsv(input: string): ParsedCsv {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const delimiter = detectDelimiter(text);
  const [header = [], ...rows] = parseRecords(text, delimiter);
  // Headers name the columns in a mapping, so each must be unique.
  const seen = new Map<string, number>();
  const headers = header.map((name, index) => {
    const base = name.trim() || `Column ${index + 1}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base} (${count})`;
  });
  // Short rows are padded; extra cells beyond the header are ignored.
  return { headers, rows: rows.map((row) => headers.map((_, index) => (row[index] ?? '').trim())), delimiter };
}
