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
 * Error envelope shared by v1 and v2 routes (docs/01 section 8):
 * { success:false, message, errorCode, errors?, timestamp, referenceId? }
 * v1 clients read `message`; v2 clients read the whole envelope.
 * Unexpected errors never leak internals: they get a referenceId that is also logged.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const payload =
        typeof body === 'string'
          ? { message: body }
          : (body as Record<string, unknown>);
      const message = Array.isArray(payload.message)
        ? 'Validation failed'
        : ((payload.message as string) ?? exception.message);
      const errors = Array.isArray(payload.message)
        ? (payload.message as string[])
        : (payload.errors as string[] | undefined);
      res.status(status).json({
        success: false,
        message,
        errorCode: (payload.errorCode as string) ?? defaultErrorCode(status),
        ...(errors ? { errors } : {}),
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const referenceId = randomUUID();
    this.logger.error(
      `Unhandled error ${referenceId} on ${req.method} ${req.url}`,
      exception instanceof Error ? exception.stack : String(exception),
    );
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      success: false,
      message:
        'An unexpected error occurred. Quote the reference id when reporting it.',
      errorCode: 'INTERNAL_ERROR',
      referenceId,
      timestamp: new Date().toISOString(),
    });
  }
}

function defaultErrorCode(status: number): string {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 429:
      return 'RATE_LIMITED';
    case 501:
      return 'NOT_IMPLEMENTED';
    case 503:
      return 'SERVICE_UNAVAILABLE';
    default:
      return `HTTP_${status}`;
  }
}
