import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class PaginationQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize: number = 25;
}

/** Query-string boolean: accepts true/false/1/0. */
export const ToBoolean = () =>
  Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'boolean') return value;
    return ['true', '1', 'yes'].includes(String(value).toLowerCase());
  });

/** Query-string list: accepts `a,b` or repeated params. */
export const ToArray = () =>
  Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    const list = Array.isArray(value) ? value : String(value).split(',');
    return list.map((v) => String(v).trim()).filter(Boolean);
  });

/** Trims strings; empty → undefined. */
export const Trim = () =>
  Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const t = value.trim();
    return t === '' ? undefined : t;
  });
