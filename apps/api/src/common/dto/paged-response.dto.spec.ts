import { PagedQueryDto, PagedResponse } from './paged-response.dto';

describe('PagedResponse', () => {
  it('computes meta for a middle page', () => {
    const page = new PagedResponse([1, 2, 3], 2, 3, 8);
    expect(page.meta).toEqual({
      page: 2,
      pageSize: 3,
      totalItems: 8,
      totalPages: 3,
    });
  });

  it('handles empty results', () => {
    expect(new PagedResponse([], 1, 20, 0).meta.totalPages).toBe(0);
  });
});

describe('PagedQueryDto', () => {
  it('computes skip from page and pageSize', () => {
    const q = Object.assign(new PagedQueryDto(), { page: 3, pageSize: 25 });
    expect(q.skip).toBe(50);
  });

  it('parses sort with direction and enforces the allowlist', () => {
    const q = Object.assign(new PagedQueryDto(), {
      sort: '-createdAt, lastName,hacker',
    });
    expect(q.orderBy(['createdAt', 'lastName'])).toEqual([
      { field: 'createdAt', direction: 'desc' },
      { field: 'lastName', direction: 'asc' },
    ]);
  });
});
