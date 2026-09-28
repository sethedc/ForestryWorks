import { createHmac } from 'node:crypto';
import { config } from './config.js';
import { logger } from './logger.js';
import { requestJson } from './http.js';

/**
 * Structured payload for whatever system sends the teacher email. Everything the
 * notifier needs is on the payload, so it never has to call Airtable itself.
 */
export function buildNotification({
  status,
  student,
  teacher,
  assessment,
  result,
  record,
  school
}) {
  return {
    event: 'brillium.quiz.completed',
    status, // matched | needs_review
    sent_at: new Date().toISOString(),
    student: {
      record_id: student?.recordId ?? null,
      name: student?.name ?? '',
      email: student?.email ?? '',
      grade_level: student?.gradeLevel ?? ''
    },
    teacher: {
      record_id: teacher?.recordId ?? null,
      name: teacher?.name ?? '',
      school_email: teacher?.schoolEmail ?? '',
      alternate_email: teacher?.alternateEmail ?? '',
      phone: teacher?.phone ?? '',
      school: school ?? ''
    },
    assessment: {
      id: assessment?.id ?? '',
      name: assessment?.name ?? '',
      type: assessment?.type ?? '',
      program: assessment?.program ?? null,
      passing_score: assessment?.passingScore ?? null
    },
    result: {
      score: result?.score ?? '',
      pass_fail: result?.passFail ?? '',
      attempt: result?.attempt ?? '',
      attempt_date: result?.attemptDate ?? '',
      brillium_guid: result?.guid ?? ''
    },
    student_record: {
      id: record?.id ?? null,
      url: record?.url ?? null
    }
  };
}

export async function sendNotification(payload) {
  if (!config.notify.url) {
    logger.debug('No NOTIFY_WEBHOOK_URL set, skipping notification');
    return { skipped: 'no_url' };
  }
  if (config.notify.on === 'matched' && payload.status !== 'matched') {
    logger.info('Skipping notification for unmatched result', { status: payload.status });
    return { skipped: 'filtered' };
  }

  const headers = {};
  if (config.notify.token) headers.Authorization = `Bearer ${config.notify.token}`;
  if (config.notify.secret) {
    const signature = createHmac('sha256', config.notify.secret)
      .update(JSON.stringify(payload))
      .digest('hex');
    headers[config.notify.signatureHeader] = `sha256=${signature}`;
  }

  await requestJson(config.notify.url, {
    method: 'POST',
    headers,
    body: payload,
    label: 'Outbound notification webhook'
  });
  logger.info('Notification sent', { status: payload.status, url: config.notify.url });
  return { sent: true };
}

export const notifier = { buildNotification, sendNotification };
