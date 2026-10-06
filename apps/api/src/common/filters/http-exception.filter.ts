import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

/**
 * RFC 9457 problem details for every error (docs/09 section 1, ADR-020):
 * { type, title, status, detail, instance, code, errors?, traceId }
 * `code` is a stable machine string; `traceId` matches the request log line.
 * Unexpected errors never leak internals.
 */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  code: string;
  errors?: string[];
  traceId: string;
}

const TYPE_BASE = 'https://docs.smartschool.local/errors/';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();
    const traceId = typeof req.id === 'string' ? req.id : randomUUID();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const payload =
        typeof body === 'string'
          ? { message: body }
          : (body as Record<string, unknown>);
      const validationErrors = Array.isArray(payload.message)
        ? (payload.message as string[])
        : undefined;
      const detail = validationErrors
        ? 'One or more fields are invalid.'
        : ((payload.detail as string) ??
          (payload.message as string) ??
          exception.message);
      const code =
        (payload.code as string) ??
        (validationErrors ? 'validation.failed' : defaultCode(status));
      const errors =
        validationErrors ?? (payload.errors as string[] | undefined);

      this.send(res, {
        type: TYPE_BASE + code,
        title: titleFor(status),
        status,
        detail,
        instance: req.originalUrl ?? req.url,
        code,
        ...(errors ? { errors } : {}),
        traceId,
      });
      return;
    }

    // Database errors that mean the request, not the server, was wrong (docs/09 section 4).
    const prismaCode = (exception as { code?: unknown } | null)?.code;
    if (typeof prismaCode === 'string' && /^P2\d{3}$/.test(prismaCode)) {
      const mapped =
        prismaCode === 'P2025'
          ? {
              status: 404,
              code: 'resource.not_found',
              detail: 'The record does not exist.',
            }
          : prismaCode === 'P2002'
            ? {
                status: 409,
                code: 'resource.conflict',
                detail: 'A record with the same value already exists.',
              }
            : prismaCode === 'P2003'
              ? {
                  status: 409,
                  code: 'resource.in_use',
                  detail: 'The record is referenced by another record.',
                }
              : null;
      if (mapped) {
        this.send(res, {
          type: TYPE_BASE + mapped.code,
          title: titleFor(mapped.status),
          status: mapped.status,
          detail: mapped.detail,
          instance: req.originalUrl ?? req.url,
          code: mapped.code,
          traceId,
        });
        return;
      }
    }

    this.logger.error(
      `Unhandled error ${traceId} on ${req.method} ${req.url}`,
      exception instanceof Error ? exception.stack : String(exception),
    );
    this.send(res, {
      type: TYPE_BASE + 'internal.error',
      title: 'Internal Server Error',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      detail:
        'An unexpected error occurred. Quote the trace id when reporting it.',
      instance: req.originalUrl ?? req.url,
      code: 'internal.error',
      traceId,
    });
  }

  private send(res: Response, problem: ProblemDetails): void {
    res.status(problem.status).type('application/problem+json').json(problem);
  }
}

function defaultCode(status: number): string {
  switch (status) {
    case 400:
      return 'request.invalid';
    case 401:
      return 'auth.unauthorized';
    case 403:
      return 'authz.forbidden';
    case 404:
      return 'resource.not_found';
    case 409:
      return 'resource.conflict';
    case 422:
      return 'validation.failed';
    case 429:
      return 'rate.limited';
    case 501:
      return 'feature.not_implemented';
    case 503:
      return 'service.unavailable';
    default:
      return `http.${status}`;
  }
}

function titleFor(status: number): string {
  const titles: Record<number, string> = {
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    409: 'Conflict',
    422: 'Unprocessable Content',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    501: 'Not Implemented',
    503: 'Service Unavailable',
  };
  return titles[status] ?? `HTTP ${status}`;
}
