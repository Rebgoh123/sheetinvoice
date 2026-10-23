import { normalizeDesign } from './invoice-design.mjs';
import { MAX_SIGNATURE_LENGTH, normalizeSignatureImage } from './invoice-signature.mjs';

export const MAX_ITEMS = 40;
// One definition for the form, readable Sheet settings and stored invoice profiles.
export const SELLER_FIELDS = {
  name: { label: 'Business name', id: 'seller-name', limit: 120 },
  address: { label: 'Business address', id: 'seller-address', limit: 240 },
  contact: { label: 'Contact name', id: 'seller-contact', limit: 50 },
  phoneLabel: { label: 'Phone label', id: 'seller-phone-label', limit: 40, default: 'Contact', isLabel: true },
  phone: { label: 'Phone number', sheetKey: 'Business phone', id: 'seller-phone', limit: 60 },
  email: { label: 'Business email', id: 'seller-email', limit: 120 },
  registrationLabel: { label: 'Registration label', id: 'seller-registration-label', limit: 40, default: 'UEN / Registration No', isLabel: true },
  registration: { label: 'Registration number', sheetKey: 'UEN / registration', id: 'seller-registration', limit: 80 },
  payment: { label: 'Payment instructions', id: 'seller-payment', limit: 800 },
  terms: { label: 'Invoice footer', id: 'seller-terms', limit: 240 },
  signature: { label: 'Authorised signature', id: 'seller-signature', limit: 60 },
  signatureImage: { label: 'Signature image', id: 'seller-signature-image', limit: MAX_SIGNATURE_LENGTH, isImage: true },
  messagePrefix: { label: 'WhatsApp message prefix (optional)', sheetKey: 'WhatsApp message prefix', id: 'seller-message-prefix', limit: 1000 },
  reviewUrl: { label: 'Review link (optional)', sheetKey: 'Review link', id: 'seller-review-url', limit: 1000 },
};
export const defaultSeller = Object.fromEntries(Object.entries(SELLER_FIELDS).map(([key, field]) => [key, field.default ?? '']));
export const sellerLimits = Object.fromEntries(Object.entries(SELLER_FIELDS).map(([key, field]) => [key, field.limit]));
export function normalizeSeller(source) {
  return Object.fromEntries(Object.entries(SELLER_FIELDS).map(([key, field]) => {
    const value = typeof source?.[key] === 'string' ? source[key] : field.default ?? '';
    if (field.isImage) return [key, normalizeSignatureImage(value)];
    return [key, (field.isLabel ? value.replace(/\s+/g, ' ').trim() : value).slice(0, field.limit)];
  }));
}
export function sellerHeaderLines(source) {
  const seller = normalizeSeller(source);
  const labelled = (label, value) => {
    if (!value.trim()) return '';
    const prefix = label.replace(/[:：]+\s*$/u, '').trim();
    return prefix ? `${prefix}: ${value.trim()}` : value.trim();
  };
  return [seller.address, [seller.contact.trim(), labelled(seller.phoneLabel, seller.phone)].filter(Boolean).join(' | '),
    seller.email, labelled(seller.registrationLabel, seller.registration)].filter(value => value.trim());
}
export function validateSeller(seller) {
  const errors = [];
  if (typeof seller?.name !== 'string' || !seller.name.trim()) errors.push('Enter your business name in Settings.');
  for (const [key, limit] of Object.entries(sellerLimits)) {
    if (typeof seller?.[key] !== 'string' || seller[key].length > limit) errors.push(`${SELLER_FIELDS[key].label} is too long or invalid.`);
  }
  if (seller?.signatureImage && !normalizeSignatureImage(seller.signatureImage)) errors.push('Upload a valid signature image in Settings.');
  if (seller?.reviewUrl?.trim()) {
    try {
      const link = new URL(seller.reviewUrl.trim());
      if (link.protocol !== 'https:' || link.username || link.password) throw new Error();
    } catch { errors.push('Use a complete HTTPS URL for the review link, or leave it blank.'); }
  }
  return errors;
}

export function singaporeDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

export function newInvoice(seller = defaultSeller, now = new Date(), design) {
  const suffix = globalThis.crypto.randomUUID().slice(0, 6).toUpperCase();
  return {
    number: `${singaporeDate(now).replaceAll("-", "").slice(2)}-${suffix}`,
    date: singaporeDate(now),
    status: "unpaid",
    customer: { name: "", phone: "", address: "" },
    items: [{ description: "", quantity: "1", price: "" }],
    notes: "",
    seller: normalizeSeller(seller),
    design: normalizeDesign(design),
  };
}

export function invoiceNumberStartError(value) {
  if (value === '') return '';
  const parts = typeof value === 'string' && value.length <= 70 && !/[\r\n]/.test(value) && value.match(/^(.*?)(\d+)$/);
  return parts && BigInt(parts[2]) > 0n ? '' : 'Use a starting invoice number ending in a positive number, such as 40108 or INV-0001 (up to 70 characters).';
}

export function nextInvoiceNumber(start, savedNumbers = []) {
  if (!start) return null;
  const error = invoiceNumberStartError(start);
  if (error) throw new Error(error);
  const [, prefix, digits] = start.match(/^(.*?)(\d+)$/);
  let next = BigInt(digits);
  for (const value of savedNumbers) {
    const number = String(value ?? '').trim();
    if (number.length > 70 || number.slice(0, prefix.length).toUpperCase() !== prefix.toUpperCase()) continue;
    const suffix = number.slice(prefix.length);
    if (/^\d+$/.test(suffix) && BigInt(suffix) >= next) next = BigInt(suffix) + 1n;
  }
  const result = prefix + String(next).padStart(digits.length, '0');
  if (result.length > 70) throw new Error('This invoice number series is full. Choose a shorter starting number or a new prefix in Business details.');
  return result;
}

// Work in integer cents: 0.10 + 0.20 must always produce exactly 0.30.
export function priceInCents(value) {
  const input = String(value).trim();
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(input)) return null;
  const [whole, fraction = ""] = input.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

export function lineTotal(item) {
  const cents = priceInCents(item.price);
  const quantity = String(item.quantity);
  if (cents === null || !/^\d{1,3}$/.test(quantity) || Number(quantity) < 1) return null;
  return cents * Number(quantity);
}

export const invoiceTotal = (invoice) => invoice.items.reduce((sum, item) => sum + (lineTotal(item) ?? 0), 0);
export const formatMoney = (cents) => `S$${(cents / 100).toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const displayDate = (date) => new Intl.DateTimeFormat("en-SG", {
  day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Singapore",
}).format(new Date(`${date}T12:00:00+08:00`));

export function whatsappNumber(value) {
  const input = String(value).trim();
  if (!input) return "";
  if (!/^\+?[\d\s()-]+$/.test(input)) return null;
  let digits = input.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 8 && !input.startsWith("+")) digits = `65${digits}`;
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

export function validateInvoice(invoice) {
  const errors = [];
  const bounded = (value, max) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
  if (!bounded(invoice.customer?.name, 120)) errors.push("Enter a customer name (up to 120 characters).");
  errors.push(...validateSeller(invoice.seller));
  if (!bounded(invoice.number, 70) || /[\r\n]/.test(invoice.number)) errors.push("Enter an invoice number (up to 70 characters).");
  if (invoice.status !== undefined && !['unpaid', 'paid'].includes(invoice.status)) errors.push("Choose Unpaid or Paid for the payment status.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(invoice.date) || !Number.isFinite(Date.parse(invoice.date)) || new Date(invoice.date).toISOString().slice(0, 10) !== invoice.date) errors.push("Choose a valid invoice date.");
  if (whatsappNumber(invoice.customer?.phone ?? "") === null) errors.push("Enter a valid WhatsApp number, or leave it blank. Include the country code for numbers outside Singapore.");
  if (!Array.isArray(invoice.items) || !invoice.items.length || invoice.items.length > MAX_ITEMS) {
    errors.push(`Add between 1 and ${MAX_ITEMS} invoice items.`);
  } else invoice.items.forEach((item, index) => {
    if (!bounded(item.description, 240)) errors.push(`Item ${index + 1}: enter a description (up to 240 characters).`);
    if (lineTotal(item) === null) errors.push(`Item ${index + 1}: use a quantity from 1 to 999 and a price with up to two decimal places.`);
  });
  for (const [value, max, label] of [
    [invoice.customer?.address, 400, "Service address"], [invoice.customer?.phone, 40, "Customer phone"],
    [invoice.notes, 1200, "Notes"],
  ]) if (typeof value !== "string" || value.length > max) errors.push(`${label} is too long or invalid.`);
  return errors;
}

export function invoiceSummary(invoice) {
  return [
    ...(invoice.seller.messagePrefix?.trim() ? [invoice.seller.messagePrefix.trim(), ''] : []),
    `Hi ${invoice.customer.name.trim()},`, "",
    `Invoice ${invoice.number} | ${displayDate(invoice.date)}`,
    ...invoice.items.map((item) => `${item.description.trim()}${Number(item.quantity) > 1 ? ` x ${item.quantity}` : ""}: ${formatMoney(lineTotal(item))}`),
    "", `Total: ${formatMoney(invoiceTotal(invoice))}`,
    `Payment status: ${invoice.status === 'paid' ? 'Paid' : 'Unpaid'}`,
    ...(invoice.status !== 'paid' && invoice.seller.payment.trim() ? ["", invoice.seller.payment.trim()] : []),
    "", "Please see the invoice for details.", `Thank you, ${invoice.seller.name.trim()}.`,
    ...(invoice.seller.reviewUrl?.trim() ? ["", "We'd appreciate a review of our service:", invoice.seller.reviewUrl.trim()] : []),
  ].join("\n");
}

export function whatsappUrl(invoice) {
  const number = whatsappNumber(invoice.customer.phone);
  if (number === null) throw new Error("Invalid WhatsApp number.");
  return `https://wa.me/${number}?text=${encodeURIComponent(invoiceSummary(invoice))}`;
}

export function invoiceFilename(invoice, format = 'pdf', page = null) {
  const safe = invoice.number.replace(/[^a-z0-9_-]/gi, "-").replace(/-+/g, "-").slice(0, 70) || "invoice";
  return `${safe}${page === null ? '' : `-page-${page}`}.${format === 'jpg' ? 'jpg' : 'pdf'}`;
}

// Only restore the shape we own, with length limits; stored data never becomes HTML.
export function restoreDraft(raw, { preserveLegacyLabels = true } = {}) {
  try {
    const saved = JSON.parse(raw);
    if (saved.version !== 1 || !saved.invoice || !Array.isArray(saved.invoice.items)) return null;
    const source = saved.invoice;
    if (source.status !== undefined && !['unpaid', 'paid'].includes(source.status)) return null;
    const take = (value, max, fallback = "") => typeof value === "string" ? value.slice(0, max) : fallback;
    return {
      number: take(source.number, 70), date: take(source.date, 10),
      status: source.status || 'unpaid',
      customer: { name: take(source.customer?.name, 120), phone: take(source.customer?.phone, 40), address: take(source.customer?.address, 400) },
      seller: normalizeSeller({ ...source.seller, ...(preserveLegacyLabels ? {
        // Historical snapshots predate configurable labels; retain their printed wording.
        phoneLabel: source.seller?.phoneLabel ?? '', registrationLabel: source.seller?.registrationLabel ?? 'Registration',
      } : {}) }),
      design: normalizeDesign(source.design),
      items: source.items.slice(0, MAX_ITEMS).map((item) => ({ description: take(item?.description, 240), quantity: take(item?.quantity, 3, "1"), price: take(item?.price, 10) })),
      notes: take(source.notes, 1200),
    };
  } catch { return null; }
}
