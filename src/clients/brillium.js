import { config } from '../config.js';
import { requestJson } from '../http.js';

function authHeaders() {
  const { authHeader, apiKey, apiKeyHeader, username, password } = config.brillium;
  if (authHeader) return { Authorization: authHeader };
  if (apiKey) return { [apiKeyHeader]: apiKey };
  if (username) {
    const encoded = Buffer.from(`${username}:${password}`).toString('base64');
    return { Authorization: `Basic ${encoded}` };
  }
  return {};
}

function buildUrl(template, values) {
  const path = template.replace(/\{(\w+)\}/g, (_, key) =>
    encodeURIComponent(String(values[key] ?? ''))
  );
  return `${config.brillium.baseUrl.replace(/\/$/, '')}${path}`;
}

/** Workflow step 1: Get Quiz Name. */
export async function getAssessment(assessmentId) {
  const response = await requestJson(buildUrl(config.brillium.assessmentsPath, { aid: assessmentId }), {
    headers: authHeaders(),
    label: 'Brillium get assessment'
  });
  // Workflow step 3: Extract Quiz Details (first assessment in the response).
  const assessments = response?.Assessments ?? response?.assessments ?? [];
  return Array.isArray(assessments) ? assessments[0] ?? null : assessments;
}

/** Workflow step 2: Check # of Attempts. */
export async function getRespondent(guid) {
  const response = await requestJson(buildUrl(config.brillium.respondentsPath, { guid }), {
    headers: authHeaders(),
    label: 'Brillium get respondent'
  });
  // Workflow step 4: Extract # of Attempts (first respondent in the response).
  const respondents = response?.Respondents ?? response?.respondents ?? [];
  return Array.isArray(respondents) ? respondents[0] ?? null : respondents;
}

export const brillium = { getAssessment, getRespondent };
