import { config } from '../config.js';
import { requestJson } from '../http.js';
import { logger } from '../logger.js';

const base = () => config.ghl.baseUrl.replace(/\/$/, '');

function headers() {
  return {
    Authorization: `Bearer ${config.ghl.token}`,
    Version: config.ghl.apiVersion
  };
}

let fieldCache = null;

async function loadCustomFields() {
  if (fieldCache) return fieldCache;
  const response = await requestJson(
    `${base()}/locations/${config.ghl.locationId}/customFields`,
    { headers: headers(), label: 'GHL list custom fields' }
  );
  fieldCache = response?.customFields ?? [];
  return fieldCache;
}

/** Resolves a contact custom field ID from its name or field key. */
export async function resolveFieldId(explicitId, nameOrKey) {
  if (explicitId) return explicitId;
  if (!nameOrKey) return null;
  const wanted = nameOrKey.toLowerCase();
  const fields = await loadCustomFields();
  const match = fields.find(
    (field) =>
      String(field.name || '').toLowerCase() === wanted ||
      String(field.fieldKey || '').toLowerCase().endsWith(wanted.replace(/\s+/g, '_'))
  );
  if (!match) {
    logger.warn('GHL custom field not found', { nameOrKey });
    return null;
  }
  return match.id;
}

/** Workflow step 5: Find Contact by email. */
export async function findContactByEmail(email) {
  if (!email) return null;
  const url = `${base()}/contacts/?locationId=${encodeURIComponent(
    config.ghl.locationId
  )}&query=${encodeURIComponent(email)}&limit=20`;
  const response = await requestJson(url, { headers: headers(), label: 'GHL find contact' });
  const contacts = response?.contacts ?? [];
  const wanted = email.toLowerCase();
  return contacts.find((contact) => String(contact.email || '').toLowerCase() === wanted) ?? null;
}

/** Workflow step 6: Create contact when none was found. */
export async function createContact({ firstName, lastName, email, gradeLevel }) {
  const customFields = [];
  const gradeFieldId = await resolveFieldId(
    config.ghl.gradeLevelFieldId,
    config.ghl.gradeLevelFieldName
  );
  if (gradeFieldId && gradeLevel) customFields.push({ id: gradeFieldId, value: gradeLevel });

  const response = await requestJson(`${base()}/contacts/`, {
    method: 'POST',
    headers: headers(),
    label: 'GHL create contact',
    body: {
      locationId: config.ghl.locationId,
      firstName,
      lastName,
      email,
      customFields
    }
  });
  return response?.contact ?? response;
}

/** Workflow steps 9-16: Update contact field (FW Program). */
export async function updateContactCustomField(contactId, fieldId, value) {
  if (!fieldId) return null;
  return requestJson(`${base()}/contacts/${contactId}`, {
    method: 'PUT',
    headers: headers(),
    label: 'GHL update contact field',
    body: { customFields: [{ id: fieldId, value }] }
  });
}

export function contactName(contact) {
  if (!contact) return '';
  const full = contact.contactName || `${contact.firstName || ''} ${contact.lastName || ''}`;
  return full.replace(/\s+/g, ' ').trim();
}

export function contactTags(contact) {
  return (contact?.tags ?? []).map((tag) => String(tag).toLowerCase().trim());
}

export function customFieldValue(contact, fieldId) {
  const fields = contact?.customFields ?? contact?.customField ?? [];
  const match = fields.find((field) => field.id === fieldId);
  return match?.value ?? match?.fieldValue ?? '';
}

export const ghl = {
  findContactByEmail,
  createContact,
  updateContactCustomField,
  resolveFieldId,
  contactName,
  contactTags,
  customFieldValue
};
