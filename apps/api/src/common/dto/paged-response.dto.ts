import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Query parameters accepted by every table-style list endpoint (docs/09 section 1). */
export class PagedQueryDto {
  @ApiProperty({ required: false, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiProperty({ required: false, default: 20, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize = 20;

  @ApiProperty({
    required: false,
    description:
      'Comma-separated fields; prefix with - for descending, e.g. -createdAt,lastName',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  sort?: string;

  get skip(): number {
    return (this.page - 1) * this.pageSize;
  }

  /** Parses `sort` into ordered field/direction pairs, restricted to an allowlist. */
  orderBy(
    allowed: readonly string[],
  ): Array<{ field: string; direction: 'asc' | 'desc' }> {
    if (!this.sort) return [];
    return this.sort
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => ({
        field: s.startsWith('-') ? s.slice(1) : s,
        direction: s.startsWith('-') ? ('desc' as const) : ('asc' as const),
      }))
      .filter((o) => allowed.includes(o.field));
  }
}

export interface PageMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

/** List response shape: { data, meta } (docs/09 section 1). */
export class PagedResponse<T> {
  data: T[];
  meta: PageMeta;

  constructor(data: T[], page: number, pageSize: number, totalItems: number) {
    this.data = data;
    this.meta = {
      page,
      pageSize,
      totalItems,
      totalPages: pageSize > 0 ? Math.ceil(totalItems / pageSize) : 0,
    };
  }

  static of<T>(
    data: T[],
    query: { page: number; pageSize: number },
    totalItems: number,
  ): PagedResponse<T> {
    return new PagedResponse(data, query.page, query.pageSize, totalItems);
  }
}

/** Cursor-paginated feed shape for message history and activity feeds. */
export class CursorResponse<T> {
  data: T[];
  meta: { nextCursor: string | null };

  constructor(data: T[], nextCursor: string | null) {
    this.data = data;
    this.meta = { nextCursor };
  }
}
