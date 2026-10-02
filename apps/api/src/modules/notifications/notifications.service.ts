import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Notification, Prisma } from '../../generated/prisma/client';
import { PagedResponse } from '../../common/dto/paged-response.dto';
import { newId } from '../../common/utils/ids';
import { AppConfigService } from '../../config/app-config.service';
import { MailService } from '../../infra/mail/mail.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  ListNotificationsQuery,
  SetPreferencesDto,
  toCategory,
} from './dto/notifications.dto';
import {
  deliveryFor,
  mergePreferences,
  summarise,
  type Category,
  type Preference,
} from './notification-rules';
import { NotificationsGateway } from './notifications.gateway';

export interface PublicNotification {
  id: string;
  category: string;
  title: string;
  body: string | null;
  link: string | null;
  entityType: string | null;
  entityId: string | null;
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
}

export interface NotifyInput {
  category: Category;
  title: string;
  body?: string | null;
  link?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  /** Always deliver in-app and by email regardless of preferences (emergencies, security). */
  forceEmail?: boolean;
}

/**
 * Creates, lists and delivers notifications. Delivery honours each recipient's preferences (docs/09):
 * in-app rows are pushed live over the notifications hub; email is best-effort through the mail service.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
    private readonly mail: MailService,
    private readonly config: AppConfigService,
  ) {}

  /** Fan-out to many recipients; returns how many in-app rows were written. */
  async notify(recipientIds: string[], input: NotifyInput): Promise<number> {
    const ids = [...new Set(recipientIds.filter(Boolean))];
    if (ids.length === 0) return 0;
    const [prefs, users] = await Promise.all([
      this.prisma.notificationPreference.findMany({
        where: { userId: { in: ids }, category: input.category },
      }),
      this.prisma.user.findMany({
        where: { id: { in: ids }, status: 'ACTIVE', deletedAt: null },
        select: { id: true, email: true, firstName: true },
      }),
    ]);
    const prefByUser = new Map(
      prefs.map((p) => [
        p.userId,
        {
          category: p.category,
          inApp: p.inApp,
          email: p.email,
        } satisfies Preference,
      ]),
    );
    const rows: Prisma.NotificationCreateManyInput[] = [];
    const emails: Array<{ to: string; firstName: string }> = [];
    const now = new Date();
    for (const user of users) {
      const delivery = deliveryFor({
        category: input.category,
        preference: prefByUser.get(user.id) ?? null,
        forceEmail: input.forceEmail,
      });
      if (delivery.inApp)
        rows.push({
          id: newId(),
          recipientId: user.id,
          category: input.category,
          title: input.title.slice(0, 200),
          body: input.body ?? null,
          link: input.link ?? null,
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
          createdAt: now,
        });
      if (delivery.email)
        emails.push({ to: user.email, firstName: user.firstName });
    }
    if (rows.length) {
      await this.prisma.notification.createMany({ data: rows });
      for (const row of rows) {
        this.gateway.push([row.recipientId], {
          id: row.id,
          category: input.category.toLowerCase(),
          title: row.title,
          body: row.body ?? null,
          link: row.link ?? null,
          entityType: row.entityType ?? null,
          entityId: row.entityId ?? null,
          isRead: false,
          readAt: null,
          createdAt: now,
        });
      }
    }
    if (emails.length) {
      const base = this.config.get('WEB_APP_URL').replace(/\/$/, '');
      void Promise.allSettled(
        emails.map((e) =>
          this.mail.send({
            to: e.to,
            subject: `[SmartSchool] ${input.title}`,
            text: `Hi ${e.firstName},\n\n${input.title}\n${input.body ?? ''}\n\n${input.link ? `${base}${input.link}` : base}\n\nYou can change which notices reach your inbox under Notifications > Preferences.`,
          }),
        ),
      ).then((results) => {
        const failed = results.filter(
          (r) => r.status === 'rejected' || r.value === false,
        ).length;
        if (failed)
          this.logger.warn(
            `${failed} of ${emails.length} notification emails failed to send`,
          );
      });
    }
    return rows.length;
  }

  async list(
    q: ListNotificationsQuery,
    actor: AuthenticatedUser,
  ): Promise<PagedResponse<PublicNotification>> {
    const where: Prisma.NotificationWhereInput = { recipientId: actor.id };
    if (q.unreadOnly) where.isRead = false;
    if (q.category) where.category = toCategory(q.category);
    const [rows, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.notification.count({ where }),
    ]);
    return PagedResponse.of(rows.map(toPublic), q, total);
  }

  async summary(actor: AuthenticatedUser) {
    const [unreadRows, latest] = await Promise.all([
      this.prisma.notification.findMany({
        where: { recipientId: actor.id, isRead: false },
        select: { category: true, isRead: true },
        take: 1000,
      }),
      this.prisma.notification.findMany({
        where: { recipientId: actor.id },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
    ]);
    const s = summarise(
      unreadRows.map((r) => ({
        category: r.category,
        isRead: r.isRead,
      })),
    );
    return {
      unread: s.unread,
      byCategory: Object.fromEntries(
        Object.entries(s.byCategory).map(([k, v]) => [k.toLowerCase(), v]),
      ),
      latest: latest.map(toPublic),
    };
  }

  async markRead(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<PublicNotification> {
    const row = await this.prisma.notification.findFirst({
      where: { id, recipientId: actor.id },
    });
    if (!row)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Notification not found.',
      });
    const updated = row.isRead
      ? row
      : await this.prisma.notification.update({
          where: { id },
          data: { isRead: true, readAt: new Date() },
        });
    this.gateway.summaryChanged(actor.id);
    return toPublic(updated);
  }

  async markAllRead(actor: AuthenticatedUser): Promise<{ updated: number }> {
    const r = await this.prisma.notification.updateMany({
      where: { recipientId: actor.id, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    this.gateway.summaryChanged(actor.id);
    return { updated: r.count };
  }

  async preferences(
    actor: AuthenticatedUser,
  ): Promise<Array<{ category: string; inApp: boolean; email: boolean }>> {
    const stored = await this.prisma.notificationPreference.findMany({
      where: { userId: actor.id },
    });
    return mergePreferences(
      stored.map((s) => ({
        category: s.category,
        inApp: s.inApp,
        email: s.email,
      })),
    ).map((p) => ({ ...p, category: p.category.toLowerCase() }));
  }

  async setPreferences(dto: SetPreferencesDto, actor: AuthenticatedUser) {
    for (const p of dto.preferences) {
      const category = toCategory(p.category);
      await this.prisma.notificationPreference.upsert({
        where: { userId_category: { userId: actor.id, category } },
        create: {
          id: newId(),
          userId: actor.id,
          category,
          inApp: p.inApp,
          email: p.email,
        },
        update: { inApp: p.inApp, email: p.email },
      });
    }
    return this.preferences(actor);
  }
}

export function toPublic(n: Notification): PublicNotification {
  return {
    id: n.id,
    category: n.category.toLowerCase(),
    title: n.title,
    body: n.body,
    link: n.link,
    entityType: n.entityType,
    entityId: n.entityId,
    isRead: n.isRead,
    readAt: n.readAt,
    createdAt: n.createdAt,
  };
}
