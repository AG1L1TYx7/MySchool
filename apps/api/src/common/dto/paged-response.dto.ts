import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** Query parameters accepted by every list endpoint. Names match the previous API. */
export class PagedQueryDto {
  @ApiProperty({ required: false, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageNumber = 1;

  @ApiProperty({ required: false, default: 20, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize = 20;

  get skip(): number {
    return (this.pageNumber - 1) * this.pageSize;
  }
}

/** Response shape preserved from the previous API (docs/01 section 8). */
export class PagedResponse<T> {
  data: T[];
  pageNumber: number;
  pageSize: number;
  totalRecords: number;
  totalPages: number;
  hasPrevious: boolean;
  hasNext: boolean;

  constructor(
    data: T[],
    pageNumber: number,
    pageSize: number,
    totalRecords: number,
  ) {
    this.data = data;
    this.pageNumber = pageNumber;
    this.pageSize = pageSize;
    this.totalRecords = totalRecords;
    this.totalPages = pageSize > 0 ? Math.ceil(totalRecords / pageSize) : 0;
    this.hasPrevious = pageNumber > 1;
    this.hasNext = pageNumber < this.totalPages;
  }
}
