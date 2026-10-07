import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createSign } from 'node:crypto';
import { newId } from '../../common/utils/ids';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { assertOrganizationAccess, isDistrictRole } from '../access/scope';
import type { AuthenticatedUser } from '../auth/auth.types';
import { RegisterDeviceDto } from './dto/push.dto';
import {
  base64url,
  fcmMessage,
  isDeadTokenError,
  isStaleDevice,
  jwtClaims,
  normalizeToken,
  serviceAccountFrom,
  STALE_DAYS,
  type PushPayload,
  type ServiceAccount,
} from './push-rules';

export interface PublicDevice {
  id: string;
  platform: string;
  name: string | null;
  appVersion: string | null;
  locale: string | null;
  lastSeenAt: Date;
  active: boolean;
  createdAt: Date;
}

/**
 * Push notifications over Firebase Cloud Messaging (docs/04): real sends when FIREBASE_SERVICE_ACCOUNT_JSON is set,
 * otherwise every push is logged as simulated so the product behaves honestly without a key. Devices register
 * with their token, dead tokens are switched off on the first failure, and silent devices after ninety days.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly account: ServiceAccount | null;
  private accessToken: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {
    this.account = serviceAccountFrom(
      config.get('FIREBASE_SERVICE_ACCOUNT_JSON'),
    );
  }

  get enabled(): boolean {
    return this.account !== null;
  }

  // ---------------------------------------------------------------------------
  // Devices
  // ---------------------------------------------------------------------------

  async register(
    dto: RegisterDeviceDto,
    actor: AuthenticatedUser,
  ): Promise<PublicDevice> {
    const token = normalizeToken(dto.token);
    if (!token)
      throw new NotFoundException({
        code: 'request.invalid',
        detail: 'That does not look like a push token.',
      });
    const row = await this.prisma.pushDevice.upsert({
      where: { token },
      create: {
        id: newId(),
        userId: actor.id,
        platform: dto.platform,
        token,
        name: dto.name ?? null,
        appVersion: dto.appVersion ?? null,
        locale: dto.locale ?? null,
      },
      // A token that moves to another account (shared tablet) follows the person who signed in last.
      update: {
        userId: actor.id,
        platform: dto.platform,
        name: dto.name ?? undefined,
        appVersion: dto.appVersion ?? undefined,
        locale: dto.locale ?? undefined,
        lastSeenAt: new Date(),
        disabledAt: null,
      },
    });
    return this.toPublic(row);
  }

  async devices(actor: AuthenticatedUser): Promise<PublicDevice[]> {
    const rows = await this.prisma.pushDevice.findMany({
      where: { userId: actor.id },
      orderBy: { lastSeenAt: 'desc' },
    });
    return rows.map((r) => this.toPublic(r));
  }

  async remove(id: string, actor: AuthenticatedUser): Promise<void> {
    const row = await this.prisma.pushDevice.findFirst({
      where: { id, userId: actor.id },
      select: { id: true },
    });
    if (!row)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Device not found.',
      });
    await this.prisma.pushDevice.delete({ where: { id } });
  }

  /** Sends a test push to the signed-in person's own devices and says what happened. */
  async test(actor: AuthenticatedUser) {
    const result = await this.send(
      [actor.id],
      {
        title: 'SmartSchool test',
        body: 'Push notifications reach this device.',
        link: '/notifications',
        category: 'system',
      },
      true,
    );
    return { configured: this.enabled, ...result };
  }

  async status(organizationId: string, actor: AuthenticatedUser) {
    if (!isDistrictRole(actor)) assertOrganizationAccess(actor, organizationId);
    const since = new Date(Date.now() - 7 * 86_400_000);
    const [devices, active, logs] = await Promise.all([
      this.prisma.pushDevice.count({ where: { user: { organizationId } } }),
      this.prisma.pushDevice.count({
        where: { user: { organizationId }, disabledAt: null },
      }),
      this.prisma.pushLog.groupBy({
        by: ['status'],
        where: { user: { organizationId }, createdAt: { gte: since } },
        _count: { _all: true },
      }),
    ]);
    return {
      configured: this.enabled,
      devices,
      activeDevices: active,
      last7Days: Object.fromEntries(
        logs.map((l) => [l.status, l._count._all]),
      ) as Record<string, number>,
      staleAfterDays: STALE_DAYS,
    };
  }

  // ---------------------------------------------------------------------------
  // Sending
  // ---------------------------------------------------------------------------

  /** Pushes one payload to every active device of the given people. Never throws: delivery is best effort. */
  async send(
    userIds: string[],
    payload: PushPayload,
    force = false,
  ): Promise<{
    devices: number;
    sent: number;
    simulated: number;
    failed: number;
  }> {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (ids.length === 0)
      return { devices: 0, sent: 0, simulated: 0, failed: 0 };
    const devices = await this.prisma.pushDevice.findMany({
      where: { userId: { in: ids }, disabledAt: null },
    });
    const out = { devices: devices.length, sent: 0, simulated: 0, failed: 0 };
    if (devices.length === 0) return out;
    const webAppUrl = this.config.get('WEB_APP_URL');
    const logs: Array<{
      id: string;
      userId: string;
      deviceId: string;
      notificationId: string | null;
      title: string;
      status: string;
      error: string | null;
    }> = [];
    for (const d of devices) {
      if (!this.account) {
        this.logger.log(
          `Simulated push to ${d.platform} device of ${d.userId}: ${payload.title}`,
        );
        logs.push({
          id: newId(),
          userId: d.userId,
          deviceId: d.id,
          notificationId: payload.notificationId ?? null,
          title: payload.title.slice(0, 200),
          status: 'simulated',
          error: null,
        });
        out.simulated += 1;
        continue;
      }
      try {
        await this.deliver(d.token, payload, webAppUrl);
        logs.push({
          id: newId(),
          userId: d.userId,
          deviceId: d.id,
          notificationId: payload.notificationId ?? null,
          title: payload.title.slice(0, 200),
          status: 'sent',
          error: null,
        });
        out.sent += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const code = /"status":\s*"([A-Z_]+)"/.exec(message)?.[1] ?? null;
        if (isDeadTokenError(code))
          await this.prisma.pushDevice.update({
            where: { id: d.id },
            data: { disabledAt: new Date() },
          });
        logs.push({
          id: newId(),
          userId: d.userId,
          deviceId: d.id,
          notificationId: payload.notificationId ?? null,
          title: payload.title.slice(0, 200),
          status: 'failed',
          error: message.slice(0, 500),
        });
        out.failed += 1;
        this.logger.warn(
          `Push failed for device ${d.id}: ${message.slice(0, 200)}`,
        );
      }
    }
    if (logs.length) await this.prisma.pushLog.createMany({ data: logs });
    if (!force && !this.account) {
      /* already logged as simulated */
    }
    return out;
  }

  private async deliver(
    token: string,
    payload: PushPayload,
    webAppUrl: string,
  ): Promise<void> {
    const account = this.account;
    if (!account) return;
    const access = await this.googleAccessToken(account);
    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${account.projectId}/messages:send`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${access}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: fcmMessage(token, payload, webAppUrl),
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok)
      throw new Error(`FCM ${res.status}: ${(await res.text()).slice(0, 400)}`);
  }

  /** A service-account JWT (RS256, signed here with node crypto) exchanged for a one-hour access token. */
  private async googleAccessToken(account: ServiceAccount): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.accessToken && this.accessToken.expiresAt > now + 60)
      return this.accessToken.value;
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64url(JSON.stringify(jwtClaims(account, now)));
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${claims}`);
    const signature = base64url(signer.sign(account.privateKey));
    const assertion = `${header}.${claims}.${signature}`;
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok)
      throw new Error(
        `Google token ${res.status}: ${(await res.text()).slice(0, 300)}`,
      );
    const body = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.accessToken = {
      value: body.access_token,
      expiresAt: now + body.expires_in,
    };
    return body.access_token;
  }

  /** Nightly at 03:20: switch off devices that have not checked in for ninety days and drop old logs. */
  @Cron('20 3 * * *')
  async cleanup(): Promise<{ disabled: number; logsRemoved: number }> {
    const now = new Date();
    const stale = await this.prisma.pushDevice.findMany({
      where: { disabledAt: null },
      select: { id: true, lastSeenAt: true },
    });
    const ids = stale
      .filter((d) => isStaleDevice(d.lastSeenAt, now))
      .map((d) => d.id);
    const disabled = ids.length
      ? (
          await this.prisma.pushDevice.updateMany({
            where: { id: { in: ids } },
            data: { disabledAt: now },
          })
        ).count
      : 0;
    const logsRemoved = (
      await this.prisma.pushLog.deleteMany({
        where: { createdAt: { lt: new Date(now.getTime() - 60 * 86_400_000) } },
      })
    ).count;
    return { disabled, logsRemoved };
  }

  private toPublic(r: {
    id: string;
    platform: string;
    name: string | null;
    appVersion: string | null;
    locale: string | null;
    lastSeenAt: Date;
    disabledAt: Date | null;
    createdAt: Date;
  }): PublicDevice {
    return {
      id: r.id,
      platform: r.platform,
      name: r.name,
      appVersion: r.appVersion,
      locale: r.locale,
      lastSeenAt: r.lastSeenAt,
      active: r.disabledAt === null,
      createdAt: r.createdAt,
    };
  }
}
