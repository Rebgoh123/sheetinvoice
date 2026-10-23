import { normalizeSeller, priceInCents, restoreDraft } from './invoice.mjs';
import { normalizeDesign } from './invoice-design.mjs';

const KEY = 'sheetinvoice-device-v1';
const SESSION_KEY = 'sheetinvoice-google-tab-v1';
const MAX_SESSION_MS = 60 * 60 * 1000;
export const FORGET_KEY = 'sheetinvoice-forget-v1';
const uuid = value => typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value);
const fileId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{10,200}$/.test(value);

function validSession(value, clientId, forgetMarker) {
  const now = Date.now();
  return value?.version === 1 && typeof clientId === 'string' && !!clientId && value.clientId === clientId &&
    value.forgetMarker === (forgetMarker ?? null) && typeof value.accountId === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(value.accountId) &&
    typeof value.token === 'string' && /^[a-zA-Z0-9._~+/-]{1,8192}={0,2}$/.test(value.token) &&
    Number.isFinite(value.expiresAt) && value.expiresAt > now && value.expiresAt <= now + MAX_SESSION_MS;
}
export function loadGoogleSession(clientId, forgetMarker, storage) {
  try {
    storage ??= globalThis.sessionStorage;
    const raw = storage.getItem(SESSION_KEY);
    if (!raw) return null;
    const value = raw.length <= 12000 ? JSON.parse(raw) : null;
    if (validSession(value, clientId, forgetMarker)) return { token: value.token, expiresAt: value.expiresAt, accountId: value.accountId };
    storage.removeItem(SESSION_KEY);
  } catch { clearGoogleSession(storage); }
  return null;
}
export function saveGoogleSession(value, clientId, forgetMarker, storage) {
  try {
    storage ??= globalThis.sessionStorage;
    const saved = { version: 1, clientId, forgetMarker: forgetMarker ?? null, accountId: value.accountId,
      token: value.token, expiresAt: Math.min(value.expiresAt, Date.now() + MAX_SESSION_MS) };
    if (!validSession(saved, clientId, forgetMarker)) return false;
    storage.setItem(SESSION_KEY, JSON.stringify(saved));
    return true;
  } catch { return false; }
}
export function clearGoogleSession(storage) {
  try { storage ??= globalThis.sessionStorage; storage?.removeItem(SESSION_KEY); return true; } catch { return false; }
}

export function loadDevice(storage) {
  try {
    storage ??= globalThis.localStorage;
    const raw = storage.getItem(KEY);
    if (!raw || raw.length > 150000) return null;
    const saved = JSON.parse(raw);
    if (saved.version !== 1) return null;
    const invoice = restoreDraft(JSON.stringify({ version: 1, invoice: saved.invoice }), { preserveLegacyLabels: uuid(saved.baseRevision) });
    if (!invoice || !invoice.items.length) return null;
    const accountId = typeof saved.accountId === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(saved.accountId) ? saved.accountId : null;
    const workbookId = accountId && fileId(saved.workbookId) ? saved.workbookId : null;
    const items = Array.isArray(saved.savedItems) ? saved.savedItems.slice(0, 100).filter(item =>
      typeof item?.description === 'string' && item.description.trim() && item.description.length <= 240 &&
      typeof item.quantity === 'string' && /^\d{1,3}$/.test(item.quantity) && Number(item.quantity) >= 1 &&
      typeof item.price === 'string' && (item.price === '' || priceInCents(item.price) !== null))
      .map(({ description, quantity, price }) => ({ description, quantity, price })) : [];
    return { invoice, business: normalizeSeller(saved.business), design: normalizeDesign(saved.design), exportFormat: saved.exportFormat === 'jpg' ? 'jpg' : 'pdf',
      numberStart: typeof saved.numberStart === 'string' ? saved.numberStart.slice(0, 70) : '',
      automaticNumber: typeof saved.automaticNumber === 'string' && saved.automaticNumber === invoice.number ? invoice.number : null,
      savedItems: workbookId ? items : [], accountId, workbookId,
      recordId: uuid(saved.recordId) ? saved.recordId : crypto.randomUUID(),
      recordRevision: uuid(saved.recordRevision) ? saved.recordRevision : crypto.randomUUID(),
      baseRevision: workbookId && uuid(saved.recordId) && uuid(saved.baseRevision) ? saved.baseRevision : null,
      customerId: workbookId && uuid(saved.customerId) ? saved.customerId : null,
      dirty: saved.dirty === true, profileDirty: saved.profileDirty === true };
  } catch { return null; }
}
export function saveDevice(value, storage) {
  try {
    storage ??= globalThis.localStorage;
    if (value) storage.setItem(KEY, JSON.stringify({ ...value, version: 1 }));
    else storage.removeItem(KEY);
    return true;
  } catch { return false; }
}
export function forgetDevice(storage, broadcast = true) {
  const sessionCleared = clearGoogleSession();
  try {
    storage ??= globalThis.localStorage;
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
    for (const key of keys) if (key === KEY || key?.startsWith('sheetinvoice-sheet-')) storage.removeItem(key);
    if (broadcast) storage.setItem(FORGET_KEY, crypto.randomUUID());
    return sessionCleared;
  } catch { return false; }
}
