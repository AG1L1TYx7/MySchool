import { Module } from '@nestjs/common';
import {
  DetailedHealthController,
  HealthController,
} from './health.controller';
import { HealthService } from './health.service';

@Module({
  controllers: [HealthController, DetailedHealthController],
  providers: [HealthService],
})
export class HealthModule {}
