import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { AppConfigModule } from './config/config.module';
import { AppConfigService } from './config/app-config.service';
import { CaptchaModule } from './infra/captcha/captcha.module';
import { CryptoModule } from './infra/crypto/crypto.module';
import { MailModule } from './infra/mail/mail.module';
import { PrismaModule } from './infra/prisma/prisma.module';
import { AccessModule } from './modules/access/access.module';
import { AccessGuard } from './modules/access/guards/access.guard';
import { AuditInterceptor } from './modules/audit/audit.interceptor';
import { AssignmentsModule } from './modules/assignments/assignments.module';
import { AiModule } from './modules/ai/ai.module';
import { AnnouncementsModule } from './modules/announcements/announcements.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { RosterModule } from './modules/roster/roster.module';
import { SsoModule } from './modules/sso/sso.module';
import { SchoolModule } from './modules/school/school.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { GradebookModule } from './modules/gradebook/gradebook.module';
import { StandardsModule } from './modules/standards/standards.module';
import { ReportCardsModule } from './modules/report-cards/report-cards.module';
import { SupportModule } from './modules/support/support.module';
import { FamilyModule } from './modules/family/family.module';
import { SummariesModule } from './modules/summaries/summaries.module';
import { MotivationModule } from './modules/motivation/motivation.module';
import { AssistantModule } from './modules/assistant/assistant.module';
import { ComplianceModule } from './modules/compliance/compliance.module';
import { InsightModule } from './modules/insight/insight.module';
import { MobileModule } from './modules/mobile/mobile.module';
import { PushModule } from './modules/push/push.module';
import { LearningModule } from './modules/learning/learning.module';
import { H5pModule } from './modules/h5p/h5p.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { AuditModule } from './modules/audit/audit.module';
import { ClassesModule } from './modules/classes/classes.module';
import { CoursesModule } from './modules/courses/courses.module';
import { FilesModule } from './modules/files/files.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { HealthModule } from './modules/health/health.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { StudentsModule } from './modules/students/students.module';
import { UsersModule } from './modules/users/users.module';

/**
 * Module registration follows the bounded contexts in docs/01 section 4.2.
 * Guards run in order: throttling, JWT authentication (skipped for @Public), access (roles,
 * feature codes, flags). The audit interceptor writes rows for @Audit handlers on success.
 */
@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL'),
          transport: config.isDevelopment
            ? {
                target: 'pino-pretty',
                options: { singleLine: true, colorize: true },
              }
            : undefined,
          autoLogging: {
            ignore: (req) =>
              (req.url ?? '').startsWith('/health') ||
              (req.url ?? '').startsWith('/metrics'),
          },
          redact: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.body.password',
            'req.body.newPassword',
            'req.body.currentPassword',
          ],
        },
      }),
    }),
    ThrottlerModule.forRoot({
      throttlers: [
        {
          name: 'default',
          ttl: 60_000,
          limit: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 100),
        },
      ],
    }),
    EventEmitterModule.forRoot({ wildcard: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    CryptoModule,
    CaptchaModule,
    MailModule,
    AuditModule,
    AccessModule,
    AuthModule,
    UsersModule,
    OrganizationsModule,
    StudentsModule,
    CoursesModule,
    ClassesModule,
    FilesModule,
    AssignmentsModule,
    AttendanceModule,
    H5pModule,
    AiModule,
    RealtimeModule,
    NotificationsModule,
    AnnouncementsModule,
    MessagingModule,
    RosterModule,
    SsoModule,
    SchoolModule,
    CalendarModule,
    GradebookModule,
    StandardsModule,
    ReportCardsModule,
    SupportModule,
    FamilyModule,
    SummariesModule,
    MotivationModule,
    AssistantModule,
    LearningModule,
    InsightModule,
    PushModule,
    MobileModule,
    ComplianceModule,
    HealthModule,
    MetricsModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: AccessGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
