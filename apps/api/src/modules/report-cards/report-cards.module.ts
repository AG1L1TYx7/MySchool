import { Module } from '@nestjs/common';
import { GradebookModule } from '../gradebook/gradebook.module';
import { ReportCardsController } from './report-cards.controller';
import { ReportCardsService } from './report-cards.service';

@Module({
  imports: [GradebookModule],
  controllers: [ReportCardsController],
  providers: [ReportCardsService],
  exports: [ReportCardsService],
})
export class ReportCardsModule {}
