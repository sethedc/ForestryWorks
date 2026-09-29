import { logger } from './logger.js';

export class HttpError extends Error {
  constructor(label, status, body) {
    super(`${label} failed with HTTP ${status}: ${String(body).slice(0, 500)}`);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * JSON HTTP call with timeout and backoff on transient failures.
 */
export async function requestJson(url, options = {}) {
  const {
    method = 'GET',
    headers = {},
    body,
    timeoutMs = 20000,
    retries = 3,
    label = `${method} ${url}`
  } = options;

  const payload = body === undefined ? undefined : JSON.stringify(body);
  const finalHeaders = { Accept: 'application/json', ...headers };
  if (payload !== undefined) finalHeaders['Content-Type'] = 'application/json';

  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers: finalHeaders,
        body: payload,
        signal: controller.signal
      });
      const text = await response.text();
      if (!response.ok) {
        if (RETRY_STATUS.has(response.status) && attempt < retries) {
          lastError = new HttpError(label, response.status, text);
          logger.warn('Retrying HTTP call', { label, status: response.status, attempt });
          await sleep(500 * 2 ** (attempt - 1));
          continue;
        }
        throw new HttpError(label, response.status, text);
      }
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    } catch (error) {
      if (error instanceof HttpError) throw error;
      lastError = error;
      if (attempt >= retries) break;
      logger.warn('Retrying HTTP call after network error', {
        label,
        attempt,
        error: error.message
      });
      await sleep(500 * 2 ** (attempt - 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new Error(`${label} failed`);
}
