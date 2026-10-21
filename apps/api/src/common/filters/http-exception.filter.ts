import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditAction } from '@prisma/client';
import type { Response } from 'express';
import type { AuthedRequest } from '../decorators';
import { AuditService } from '../../modules/audit/audit.service';
import { captureException } from '../sentry';

interface ErrorBody {
  statusCode: number;
  message: string;
  code?: string;
  details?: unknown;
}

/** Uniform JSON error shape with Persian messages; logs 403s to the audit trail (PRD §94). */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  constructor(private readonly audit: AuditService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<AuthedRequest>();
    const body = this.toBody(exception);

    if (body.statusCode === HttpStatus.FORBIDDEN) {
      void this.audit.log({
        action: AuditAction.ACCESS_DENIED,
        actorUserId: req.auth?.userId ?? null,
        entityType: 'HttpRequest',
        metadata: { method: req.method, path: req.originalUrl?.split('?')[0], code: body.code },
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    if (body.statusCode >= 500) {
      this.logger.error(`${req.method} ${req.originalUrl} → ${(exception as Error)?.stack ?? exception}`);
      captureException(exception);
    }
    if (!res.headersSent) res.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown): ErrorBody {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      // Plain-string responses come from framework exceptions (e.g. the throttler) and are English.
      if (typeof response === 'string')
        return { statusCode: status, message: defaultMessage(status), code: defaultCode(status) };
      const r = response as { message?: string | string[]; code?: string; details?: unknown };
      if (Array.isArray(r.message)) {
        return {
          statusCode: status,
          message: 'اطلاعات ارسال‌شده معتبر نیست.',
          code: 'VALIDATION',
          details: r.message,
        };
      }
      return {
        statusCode: status,
        message: r.message ?? defaultMessage(status),
        code: r.code ?? defaultCode(status),
        details: r.details,
      };
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          return {
            statusCode: HttpStatus.CONFLICT,
            message: 'رکوردی با این مشخصات از قبل وجود دارد.',
            code: 'DUPLICATE',
            details: exception.meta?.target,
          };
        case 'P2025':
          return { statusCode: HttpStatus.NOT_FOUND, message: 'مورد درخواستی یافت نشد.', code: 'NOT_FOUND' };
        case 'P2003':
          return {
            statusCode: HttpStatus.BAD_REQUEST,
            message: 'یکی از ارجاع‌های ارسال‌شده معتبر نیست.',
            code: 'INVALID_REFERENCE',
          };
      }
    }
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'خطای داخلی سرور. لطفاً دوباره تلاش کنید.',
      code: 'INTERNAL',
    };
  }
}

function defaultMessage(status: number): string {
  switch (status) {
    case 400:
      return 'درخواست نامعتبر است.';
    case 401:
      return 'ابتدا وارد سامانه شوید.';
    case 403:
      return 'شما مجوز انجام این عملیات را ندارید.';
    case 404:
      return 'مورد درخواستی یافت نشد.';
    case 409:
      return 'تداخل در داده‌ها.';
    case 413:
      return 'حجم فایل بیش از حد مجاز است.';
    case 429:
      return 'تعداد درخواست‌ها بیش از حد مجاز است. کمی بعد تلاش کنید.';
    default:
      return 'خطا در پردازش درخواست.';
  }
}

function defaultCode(status: number): string {
  return (
    (
      {
        400: 'BAD_REQUEST',
        401: 'UNAUTHORIZED',
        403: 'FORBIDDEN',
        404: 'NOT_FOUND',
        409: 'CONFLICT',
        413: 'PAYLOAD_TOO_LARGE',
        429: 'RATE_LIMITED',
      } as Record<number, string>
    )[status] ?? 'ERROR'
  );
}
