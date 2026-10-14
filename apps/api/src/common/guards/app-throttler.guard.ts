import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { throttleTracker } from '../request-rules';

/**
 * The rate limiter keyed by the client address Express derives under `trust proxy` (never by a header the
 * client wrote), and for sign-in routes by address and account together (docs/21 F03).
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(req: Request): Promise<string> {
    return Promise.resolve(
      throttleTracker(req.ip, req.path ?? req.url ?? '', req.body),
    );
  }
}
