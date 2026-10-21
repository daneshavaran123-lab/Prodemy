import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

/**
 * Domain errors with Persian, user-facing messages and stable machine codes.
 * The web app shows `message` directly and may branch on `code`.
 */
export const Errors = {
  unauthorized: (message = 'ابتدا وارد سامانه شوید.') => new UnauthorizedException({ message, code: 'UNAUTHORIZED' }),
  forbidden: (message = 'شما مجوز انجام این عملیات را ندارید.', code = 'FORBIDDEN') =>
    new ForbiddenException({ message, code }),
  notFound: (entity = 'مورد درخواستی') => new NotFoundException({ message: `${entity} یافت نشد.`, code: 'NOT_FOUND' }),
  validation: (message: string, details?: unknown) => new BadRequestException({ message, code: 'VALIDATION', details }),
  conflict: (message: string, code = 'CONFLICT') => new ConflictException({ message, code }),
  staleVersion: () =>
    new ConflictException({
      message: 'این وظیفه هم‌زمان توسط کاربر دیگری تغییر کرده است. صفحه را بازخوانی کنید و دوباره تلاش کنید.',
      code: 'STALE_VERSION',
    }),
};
