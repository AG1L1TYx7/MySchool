import {
  allowedVisibilities,
  averageRating,
  canEdit,
  canReview,
  canSee,
  docIdFor,
  embeddingText,
  isNewVersion,
  isSafeUrl,
  itemIdFromDocId,
  mergeSearch,
  parseList,
  requiresReview,
  statusAfterVisibilityChange,
  type Viewer,
  type VisibleItem,
} from './library-rules';

const viewer = (over: Partial<Viewer>): Viewer => ({
  id: 'u1',
  role: 'TEACHER',
  organizationId: 'o1',
  tenantId: 't1',
  ...over,
});
const item = (over: Partial<VisibleItem>): VisibleItem => ({
  createdById: 'creator',
  organizationId: 'o1',
  tenantId: 't1',
  visibility: 'school',
  status: 'published',
  ...over,
});

describe('library visibility', () => {
  it('shows published items by reach and always to creators and school administrators', () => {
    expect(canSee(item({}), viewer({}))).toBe(true);
    expect(canSee(item({ organizationId: 'o2' }), viewer({}))).toBe(false);
    expect(
      canSee(
        item({ organizationId: 'o2', visibility: 'district' }),
        viewer({}),
      ),
    ).toBe(true);
    expect(
      canSee(
        item({ organizationId: 'o2', tenantId: 't2', visibility: 'district' }),
        viewer({}),
      ),
    ).toBe(false);
    expect(
      canSee(
        item({ organizationId: 'o2', tenantId: 't2', visibility: 'public' }),
        viewer({}),
      ),
    ).toBe(true);
    expect(canSee(item({ visibility: 'private' }), viewer({}))).toBe(false);
    expect(
      canSee(item({ visibility: 'private' }), viewer({ id: 'creator' })),
    ).toBe(true);
    expect(canSee(item({ status: 'draft' }), viewer({}))).toBe(false);
    expect(
      canSee(item({ status: 'draft' }), viewer({ role: 'PRINCIPAL' })),
    ).toBe(true);
    expect(
      canSee(
        item({ status: 'draft', organizationId: 'o2' }),
        viewer({ role: 'SUPERINTENDENT', tenantOrganizationIds: ['o1', 'o2'] }),
      ),
    ).toBe(true);
    expect(
      canSee(item({ deletedAt: new Date() }), viewer({ id: 'creator' })),
    ).toBe(false);
  });

  it('lets creators and administrators edit, students never', () => {
    expect(canEdit(item({}), viewer({ id: 'creator' }))).toBe(true);
    expect(canEdit(item({}), viewer({ id: 'creator', role: 'STUDENT' }))).toBe(
      false,
    );
    expect(canEdit(item({}), viewer({ role: 'TEACHER' }))).toBe(false);
    expect(canEdit(item({}), viewer({ role: 'PRINCIPAL' }))).toBe(true);
    expect(
      canEdit(item({ organizationId: 'o2' }), viewer({ role: 'PRINCIPAL' })),
    ).toBe(false);
    expect(
      canEdit(
        item({ organizationId: 'o2' }),
        viewer({ role: 'SUPER_ADMIN', organizationId: null, tenantId: null }),
      ),
    ).toBe(true);
  });

  it('decides when a review is needed and who gives it', () => {
    expect(requiresReview('school', viewer({}))).toBe(false);
    expect(requiresReview('district', viewer({}))).toBe(true);
    expect(requiresReview('district', viewer({ role: 'PRINCIPAL' }))).toBe(
      false,
    );
    expect(requiresReview('public', viewer({ role: 'PRINCIPAL' }))).toBe(true);
    expect(requiresReview('public', viewer({ role: 'SUPERINTENDENT' }))).toBe(
      false,
    );
    expect(
      canReview(
        item({ visibility: 'district' }),
        viewer({ role: 'PRINCIPAL' }),
      ),
    ).toBe(true);
    expect(
      canReview(item({ visibility: 'public' }), viewer({ role: 'PRINCIPAL' })),
    ).toBe(false);
    expect(
      canReview(
        item({ visibility: 'public' }),
        viewer({ role: 'SUPERINTENDENT' }),
      ),
    ).toBe(true);
    expect(
      canReview(
        item({ visibility: 'public', tenantId: 't2' }),
        viewer({ role: 'SUPERINTENDENT' }),
      ),
    ).toBe(false);
  });

  it('keeps a published item published unless its reach grows past what the editor may grant', () => {
    expect(
      statusAfterVisibilityChange(
        { status: 'published', visibility: 'district' },
        'school',
        viewer({}),
      ),
    ).toBe('published');
    expect(
      statusAfterVisibilityChange(
        { status: 'published', visibility: 'school' },
        'district',
        viewer({}),
      ),
    ).toBe('pending_review');
    expect(
      statusAfterVisibilityChange(
        { status: 'published', visibility: 'school' },
        'district',
        viewer({ role: 'PRINCIPAL' }),
      ),
    ).toBe('published');
    expect(
      statusAfterVisibilityChange(
        { status: 'draft', visibility: 'school' },
        'public',
        viewer({}),
      ),
    ).toBe('draft');
    expect(allowedVisibilities(viewer({ role: 'STUDENT' }))).toEqual([
      'private',
    ]);
    expect(allowedVisibilities(viewer({}))).toContain('public');
  });
});

describe('library versions, text and search', () => {
  it('treats content changes as a new version and keyword edits as none', () => {
    const before = {
      title: 'A',
      description: 'd',
      keywords: 'k',
      topics: '["x"]',
    };
    expect(isNewVersion(before, { keywords: 'k2' })).toBe(false);
    expect(isNewVersion(before, { title: 'A' })).toBe(false);
    expect(isNewVersion(before, { title: 'B' })).toBe(true);
    expect(isNewVersion(before, { parameters: { q: 1 } })).toBe(true);
  });

  it('parses lists from JSON or commas and builds the embedding text', () => {
    expect(parseList('["a","b"]')).toEqual(['a', 'b']);
    expect(parseList('a, b ,,c')).toEqual(['a', 'b', 'c']);
    expect(parseList(null)).toEqual([]);
    const text = embeddingText({
      title: 'Fractions quiz',
      description: 'Ten items',
      subject: 'Math',
      gradeLevel: '5',
      topics: '["fractions"]',
      standards: '["5.NF.1"]',
      keywords: 'denominator',
      kind: 'h5p',
    });
    expect(text).toContain('Fractions quiz');
    expect(text).toContain('Standards: 5.NF.1');
    expect(text).toContain('Grade 5');
  });

  it('merges semantic hits ahead of keyword rows without duplicates', () => {
    const byId = new Map([
      ['a', { id: 'a' }],
      ['b', { id: 'b' }],
      ['c', { id: 'c' }],
    ]);
    const merged = mergeSearch(
      [
        { itemId: 'b', score: 0.5 },
        { itemId: 'a', score: 0.9 },
        { itemId: 'zzz', score: 0.8 },
      ],
      [{ id: 'a' }, { id: 'c' }],
      byId,
    );
    expect(merged.map((m) => [m.id, m.score])).toEqual([
      ['a', 0.9],
      ['b', 0.5],
      ['c', null],
    ]);
    expect(averageRating(9, 2)).toBe(4.5);
    expect(averageRating(0, 0)).toBeNull();
    expect(itemIdFromDocId(docIdFor('x1', 'public'))).toBe('x1');
    expect(itemIdFromDocId('other:x')).toBeNull();
    expect(isSafeUrl('https://khanacademy.org/x')).toBe(true);
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
  });
});
