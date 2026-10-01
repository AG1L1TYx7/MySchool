import {
  contentDisposition,
  extensionOf,
  isAllowedExtension,
  sanitizeFilename,
  storagePath,
} from './file-rules';

describe('file rules', () => {
  it('extracts and validates extensions against the allowlist and the forbidden set', () => {
    expect(extensionOf('Essay.Final.PDF')).toBe('pdf');
    expect(extensionOf('noext')).toBe('');
    expect(isAllowedExtension('pdf', [])).toBe(true);
    expect(isAllowedExtension('exe', [])).toBe(false);
    expect(isAllowedExtension('js', ['js'])).toBe(false);
    expect(isAllowedExtension('csv', ['.csv', 'pdf'])).toBe(true);
    expect(isAllowedExtension('png', ['csv'])).toBe(false);
    expect(isAllowedExtension('', [])).toBe(false);
  });

  it('sanitises file names without losing the extension', () => {
    expect(sanitizeFilename('..\\..\\windows\\evil<script>.pdf')).toBe(
      'evilscript.pdf',
    );
    expect(sanitizeFilename('/tmp/  my   essay .docx')).toBe('my essay.docx');
    expect(sanitizeFilename('')).toBe('file');
    expect(
      sanitizeFilename('x'.repeat(300) + '.txt').length,
    ).toBeLessThanOrEqual(154);
  });

  it('builds collision-free storage paths and a safe content disposition', () => {
    expect(
      storagePath('org1', 'abc', 'pdf', new Date('2026-10-01T00:00:00Z')),
    ).toBe('org1/2026/10/abc.pdf');
    expect(storagePath(null, 'abc', '', new Date('2026-01-05T00:00:00Z'))).toBe(
      'shared/2026/01/abc',
    );
    expect(contentDisposition('résumé "final".pdf')).toBe(
      'attachment; filename="r_sum_ _final_.pdf"; filename*=UTF-8\'\'r%C3%A9sum%C3%A9%20%22final%22.pdf',
    );
  });
});
