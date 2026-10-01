import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaClient } from '../../generated/prisma/client';
import { createAdapter } from './connection';

/**
 * Single Prisma client for the application (Prisma 7, MariaDB/MySQL driver adapter).
 *
 * Global behaviours that EF Core implemented as query filters and interceptors
 * (soft delete, tenant injection) are added here as client extensions once those
 * models exist in the schema; see docs/03 section 4.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: AppConfigService) {
    super({
      adapter: createAdapter(config.get('DATABASE_URL')),
      log: config.isDevelopment
        ? [
            { level: 'warn', emit: 'event' },
            { level: 'error', emit: 'event' },
          ]
        : [{ level: 'error', emit: 'event' }],
    });
  }

  async onModuleInit(): Promise<void> {
    // A missing database must not kill the process: /health/ready reports it as
    // unhealthy (503) and the connection is retried lazily on the next query.
    try {
      await this.$connect();
      this.logger.log('Database connection established');
    } catch (err) {
      this.logger.error(
        'Database connection failed at startup; health will report it: ' +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Cheap liveness probe used by the health endpoint. */
  async ping(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
