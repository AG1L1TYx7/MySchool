import { csvRecords, normaliseHeader, parseCsv, toCsv } from './csv';

describe('csv', () => {
  it('parses quoted fields, embedded commas, quotes and newlines, CRLF and BOM', () => {
    const text = '﻿a,b,c\r\n1,"x, y","say ""hi"""\n2,"multi\nline",\r\n';
    expect(parseCsv(text)).toEqual([
      ['a', 'b', 'c'],
      ['1', 'x, y', 'say "hi"'],
      ['2', 'multi\nline', ''],
    ]);
  });

  it('skips blank lines and keeps the last unterminated row', () => {
    expect(parseCsv('a,b\n\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('builds records keyed by normalised headers with source line numbers', () => {
    const { headers, rows } = csvRecords(
      'Student Number, First_Name ,last-name\n S1 , Ada ,Lovelace\n',
    );
    expect(headers).toEqual(['studentnumber', 'firstname', 'lastname']);
    expect(rows).toEqual([
      {
        line: 2,
        values: { studentnumber: 'S1', firstname: 'Ada', lastname: 'Lovelace' },
      },
    ]);
    expect(normaliseHeader('\uFEFF Date of Birth ')).toBe('dateofbirth');
  });

  it('writes CSV with quoting and formula guarding', () => {
    expect(
      toCsv([
        ['a', 'b'],
        ['x, y', '=1+1'],
        [null, 'q"q'],
      ]),
    ).toBe('a,b\r\n"x, y",\'=1+1\r\n,"q""q"\r\n');
  });
});
