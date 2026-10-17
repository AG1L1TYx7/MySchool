/**
 * The seam to a card payment provider (slice 30, docs/04 section 8). Billing creates invoices and records
 * payments; a provider only turns an open invoice into a hosted checkout and reports back by signed
 * webhook. Nothing else in the product knows the provider.
 */

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export interface CheckoutRequest {
  invoiceId: string;
  invoiceNumber: string;
  description: string;
  amountCents: number;
  currency: string;
  customerEmail: string | null;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSession {
  id: string;
  url: string;
}

export interface PaymentProvider {
  readonly name: string;
  readonly configured: boolean;
  createCheckout(request: CheckoutRequest): Promise<CheckoutSession>;
  /** Refunds a payment in full; `paymentRef` is what the webhook handed us when the checkout completed. */
  refund(paymentRef: string): Promise<{ id: string }>;
  /** A hosted page where the customer manages payment methods and sees receipts. */
  createPortalSession(
    customerRef: string,
    returnUrl: string,
  ): Promise<{ url: string }>;
}

/** When no provider is configured: invoices are paid outside the platform and recorded by hand. */
export class NoPaymentProvider implements PaymentProvider {
  readonly name = 'none';
  readonly configured = false;

  createCheckout(): Promise<CheckoutSession> {
    return Promise.reject(new Error('No payment provider is configured.'));
  }

  refund(): Promise<{ id: string }> {
    return Promise.reject(new Error('No payment provider is configured.'));
  }

  createPortalSession(): Promise<{ url: string }> {
    return Promise.reject(new Error('No payment provider is configured.'));
  }
}
