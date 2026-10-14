import { Throttle } from '@nestjs/throttler';
import { EXPORT_LIMIT } from '../../common/throttle-limits';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { RequireFeature } from '../access/decorators/access.decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { BillingService } from './billing.service';
import {
  GenerateInvoiceDto,
  InvoiceActionDto,
  ListInvoicesQuery,
  SetSubscriptionDto,
  UpsertPlanDto,
  UsageQuery,
} from './dto/billing.dto';
import { UsageService } from './usage.service';

@ApiTags('Billing')
@ApiBearerAuth('bearer')
@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly usage: UsageService,
  ) {}

  @Get('plans')
  @RequireFeature('billing.view')
  @ApiOperation({ summary: 'The plans a district can be on' })
  plans(@CurrentUser() actor: AuthenticatedUser) {
    return this.billing.plans(actor.role === 'SUPER_ADMIN');
  }

  @Put('plans')
  @RequireFeature('billing.manage')
  @ApiOperation({
    summary: 'Create or change a plan by code (platform administrator)',
  })
  upsertPlan(
    @Body() dto: UpsertPlanDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.billing.upsertPlan(dto, actor);
  }

  @Get('overview')
  @RequireFeature('billing.manage')
  @ApiOperation({
    summary:
      'Every district, its plan and status, recurring revenue and what is open or overdue',
  })
  overview() {
    return this.billing.overview();
  }

  @Get('subscription')
  @RequireFeature('billing.view')
  @ApiOperation({
    summary:
      'The district subscription (?tenantId for the platform administrator), seats now and the monthly estimate',
  })
  subscription(
    @Query('tenantId') tenantId: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.billing.subscription(actor, tenantId || undefined);
  }

  @Put('subscription')
  @HttpCode(201)
  @RequireFeature('billing.manage')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({
    summary: 'Start or change the subscription (idempotent by Idempotency-Key)',
  })
  async setSubscription(
    @Body() dto: SetSubscriptionDto,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const out = await this.billing.withIdempotency(
      actor,
      'PUT /billing/subscription',
      key,
      dto,
      () => this.billing.setSubscription(dto, actor),
    );
    res.status(out.status);
    res.setHeader('Idempotent-Replayed', out.replayed ? 'true' : 'false');
    return out.body;
  }

  @Post('subscription/cancel')
  @RequireFeature('billing.manage')
  @ApiOperation({ summary: 'Cancel at once; invoices already issued stay due' })
  cancel(
    @Query('tenantId') tenantId: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.billing.cancelSubscription(actor, tenantId || undefined);
  }

  @Get('invoices')
  @RequireFeature('billing.view')
  @ApiOperation({
    summary:
      'Invoices for the district (platform administrator: all, or ?tenantId)',
  })
  invoices(
    @Query() q: ListInvoicesQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.billing.invoices(q, actor);
  }

  @Post('invoices')
  @RequireFeature('billing.manage')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({
    summary:
      'Issue the invoice for the current (or a named) period; one per period',
  })
  async generate(
    @Body() dto: GenerateInvoiceDto,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const out = await this.billing.withIdempotency(
      actor,
      'POST /billing/invoices',
      key,
      dto,
      () => this.billing.generateInvoice(dto, actor),
    );
    res.status(out.status);
    res.setHeader('Idempotent-Replayed', out.replayed ? 'true' : 'false');
    return out.body;
  }

  @Get('invoices/:id')
  @RequireFeature('billing.view')
  @ApiOperation({ summary: 'One invoice with its lines' })
  invoice(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.billing.invoice(id, actor);
  }

  @Get('invoices/:id/pdf')
  @Throttle(EXPORT_LIMIT)
  @RequireFeature('billing.view')
  @ApiOperation({ summary: 'The invoice as a PDF (audited)' })
  async pdf(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const out = await this.billing.invoicePdf(id, actor);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${out.fileName}"`,
    );
    res.send(out.buffer);
  }

  @Post('invoices/:id/pay')
  @RequireFeature('billing.manage')
  @ApiOperation({ summary: 'Record a payment received outside the platform' })
  pay(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InvoiceActionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.billing.markPaid(id, dto, actor);
  }

  @Post('invoices/:id/void')
  @RequireFeature('billing.manage')
  @ApiOperation({ summary: 'Void an unpaid invoice' })
  voidInvoice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InvoiceActionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.billing.voidInvoice(id, dto, actor);
  }

  @Get('usage')
  @RequireFeature('billing.view')
  @ApiOperation({
    summary: 'Metered usage by day and by school (from, to, tenantId)',
  })
  async usageReport(
    @Query() q: UsageQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    await this.usage.flush();
    return this.billing.usage(q, actor);
  }

  @Post('usage/snapshot')
  @RequireFeature('billing.manage')
  @ApiOperation({
    summary:
      'Record active students and storage per school now (runs nightly on its own)',
  })
  async snapshot() {
    await this.usage.flush();
    return { schools: await this.usage.snapshot() };
  }

  @Post('webhooks/provider')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Payment provider webhook (signature required); invoice.paid marks the matching invoice paid',
  })
  webhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('stripe-signature') signature: string | undefined,
    @Body() body: unknown,
  ) {
    const raw = req.rawBody
      ? req.rawBody.toString('utf8')
      : JSON.stringify(body ?? {});
    return this.billing.providerWebhook(raw, signature);
  }
}
