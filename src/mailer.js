import nodemailer from 'nodemailer';
import { config } from './config.js';
import { logger } from './logger.js';

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (config.mail.transport === 'console') {
    transporter = {
      sendMail: async (message) => {
        logger.info('Email (console transport)', { message });
        return { messageId: 'console' };
      }
    };
    return transporter;
  }
  const { host, port, secure, user, pass } = config.mail.smtp;
  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user ? { user, pass } : undefined
  });
  return transporter;
}

export async function sendMail({ to, cc, bcc, subject, text, html }) {
  const recipients = [to, cc].filter(Boolean);
  if (!recipients.length && !bcc) {
    logger.warn('Skipping email with no recipients', { subject });
    return null;
  }
  const message = {
    from: config.mail.from,
    to,
    cc: cc || undefined,
    bcc: bcc || undefined,
    replyTo: config.mail.replyTo || undefined,
    subject,
    text,
    html: html || undefined
  };
  const result = await getTransporter().sendMail(message);
  logger.info('Email sent', { to, cc, bcc, subject, messageId: result?.messageId });
  return result;
}

export const mailer = { sendMail };
