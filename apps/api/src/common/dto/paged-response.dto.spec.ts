import { PagedResponse } from './paged-response.dto';

describe('PagedResponse', () => {
  it('computes totals and navigation flags like the previous API', () => {
    const page = new PagedResponse([1, 2, 3], 2, 3, 8);
    expect(page.totalPages).toBe(3);
    expect(page.hasPrevious).toBe(true);
    expect(page.hasNext).toBe(true);
  });

  it('handles the last page and empty results', () => {
    expect(new PagedResponse([], 1, 20, 0)).toMatchObject({
      totalPages: 0,
      hasPrevious: false,
      hasNext: false,
    });
    expect(new PagedResponse([1], 3, 3, 7)).toMatchObject({
      totalPages: 3,
      hasPrevious: true,
      hasNext: false,
    });
  });
});
