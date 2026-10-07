import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { AppConfigService } from '../../config/app-config.service';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Files to attach, for scheduled reports; nodemailer takes content as a string or Buffer. */
  attachments?: Array<{
    filename: string;
    content: string | Buffer;
    contentType?: string;
  }>;
}

/**
 * Outbound email. SMTP when SMTP_HOST is set; otherwise messages are logged and
 * reported as "not delivered" so callers can behave honestly (docs/04 section 8).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;

  constructor(private readonly config: AppConfigService) {
    this.transporter = config.providers.smtp
      ? nodemailer.createTransport({
          host: config.get('SMTP_HOST'),
          port: config.get('SMTP_PORT'),
          secure: config.get('SMTP_PORT') === 465,
        })
      : null;
  }

  get enabled(): boolean {
    return this.transporter !== null;
  }

  /** Returns true when the message was handed to a real transport. */
  async send(message: MailMessage): Promise<boolean> {
    const from = `"${this.config.get('MAIL_FROM_NAME')}" <${this.config.get('MAIL_FROM')}>`;
    if (!this.transporter) {
      this.logger.warn(
        `Mail transport disabled; not delivered to ${message.to}: ${message.subject}`,
      );
      return false;
    }
    await this.transporter.sendMail({ from, ...message });
    return true;
  }
}
