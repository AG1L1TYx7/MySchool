import { Logger } from '@nestjs/common';
import type {
  CheckoutRequest,
  CheckoutSession,
  PaymentProvider,
} from './payment-provider';

/**
 * Stripe Checkout through its REST API (no SDK): one hosted session per open invoice, in payment mode,
 * with the invoice number in the session's metadata so the webhook can mark the invoice paid.
 */
export class StripeProvider implements PaymentProvider {
  readonly name = 'stripe';
  readonly configured = true;
  private readonly log = new Logger(StripeProvider.name);

  constructor(
    private readonly secretKey: string,
    private readonly baseUrl = 'https://api.stripe.com',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
    const form = new URLSearchParams({
      mode: 'payment',
      success_url: request.successUrl,
      cancel_url: request.cancelUrl,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': request.currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(request.amountCents),
      'line_items[0][price_data][product_data][name]':
        request.description.slice(0, 250),
      'metadata[invoiceNumber]': request.invoiceNumber,
      'metadata[invoiceId]': request.invoiceId,
      'payment_intent_data[metadata][invoiceNumber]': request.invoiceNumber,
      client_reference_id: request.invoiceNumber,
      customer_creation: 'always',
      ...(request.customerEmail
        ? { customer_email: request.customerEmail }
        : {}),
    });
    const res = await this.fetchImpl(
      `${this.baseUrl.replace(/\/$/, '')}/v1/checkout/sessions`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.secretKey}`,
          'content-type': 'application/x-www-form-urlencoded',
          'idempotency-key': `checkout-${request.invoiceId}-${request.amountCents}`,
        },
        body: form.toString(),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!res.ok) {
      const text = (await res.text()).slice(0, 300);
      this.log.warn(`Stripe checkout session refused: ${res.status} ${text}`);
      throw new Error(`The payment provider answered ${res.status}.`);
    }
    const body = (await res.json()) as { id?: string; url?: string };
    if (!body.id || !body.url)
      throw new Error('The payment provider answered without a session.');
    return { id: body.id, url: body.url };
  }

  async refund(paymentRef: string): Promise<{ id: string }> {
    const body = await this.post<{ id?: string }>('/v1/refunds', {
      payment_intent: paymentRef,
    });
    if (!body.id)
      throw new Error('The payment provider answered without a refund.');
    return { id: body.id };
  }

  async createPortalSession(
    customerRef: string,
    returnUrl: string,
  ): Promise<{ url: string }> {
    const body = await this.post<{ url?: string }>(
      '/v1/billing_portal/sessions',
      {
        customer: customerRef,
        return_url: returnUrl,
      },
    );
    if (!body.url)
      throw new Error('The payment provider answered without a portal page.');
    return { url: body.url };
  }

  private async post<T>(
    path: string,
    fields: Record<string, string>,
  ): Promise<T> {
    const res = await this.fetchImpl(
      `${this.baseUrl.replace(/\/$/, '')}${path}`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.secretKey}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(fields).toString(),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!res.ok) {
      const text = (await res.text()).slice(0, 300);
      this.log.warn(`Stripe ${path} refused: ${res.status} ${text}`);
      throw new Error(`The payment provider answered ${res.status}.`);
    }
    return (await res.json()) as T;
  }
}
