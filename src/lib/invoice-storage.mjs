import { normalizeSeller, priceInCents, restoreDraft } from './invoice.mjs';
import { normalizeDesign } from './invoice-design.mjs';

const KEY = 'sheetinvoice-device-v1';
export const FORGET_KEY = 'sheetinvoice-forget-v1';
const uuid = value => typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value);
const fileId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{10,200}$/.test(value);

export function loadDevice(storage) {
  try {
    storage ??= globalThis.localStorage;
    const raw = storage.getItem(KEY);
    if (!raw || raw.length > 150000) return null;
    const saved = JSON.parse(raw);
    if (saved.version !== 1) return null;
    const invoice = restoreDraft(JSON.stringify({ version: 1, invoice: saved.invoice }));
    if (!invoice || !invoice.items.length) return null;
    const accountId = typeof saved.accountId === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(saved.accountId) ? saved.accountId : null;
    const workbookId = accountId && fileId(saved.workbookId) ? saved.workbookId : null;
    const items = Array.isArray(saved.savedItems) ? saved.savedItems.slice(0, 100).filter(item =>
      typeof item?.description === 'string' && item.description.trim() && item.description.length <= 240 &&
      typeof item.quantity === 'string' && /^\d{1,3}$/.test(item.quantity) && Number(item.quantity) >= 1 &&
      typeof item.price === 'string' && (item.price === '' || priceInCents(item.price) !== null))
      .map(({ description, quantity, price }) => ({ description, quantity, price })) : [];
    return { invoice, business: normalizeSeller(saved.business), design: normalizeDesign(saved.design),
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
  try {
    storage ??= globalThis.localStorage;
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
    for (const key of keys) if (key === KEY || key?.startsWith('sheetinvoice-sheet-')) storage.removeItem(key);
    if (broadcast) storage.setItem(FORGET_KEY, crypto.randomUUID());
    return true;
  } catch { return false; }
}
