export const MAX_ITEMS = 40;
export const defaultSeller = {
  name: "", address: "", contact: "", phone: "", email: "",
  registration: "", payment: "", terms: "", reviewUrl: "",
};
export const sellerLimits = { name: 120, address: 240, contact: 50, phone: 60, email: 120, registration: 80, payment: 800, terms: 240, reviewUrl: 1000 };
export function normalizeSeller(source) {
  return Object.fromEntries(Object.entries(defaultSeller).map(([key, fallback]) => [key, typeof source?.[key] === "string" ? source[key].slice(0, sellerLimits[key]) : fallback]));
}
export function validateSeller(seller) {
  const errors = [];
  if (typeof seller?.name !== 'string' || !seller.name.trim()) errors.push('Enter your business name in Settings.');
  for (const [key, limit] of Object.entries(sellerLimits)) {
    if (typeof seller?.[key] !== 'string' || seller[key].length > limit) errors.push(`Business ${key} is too long or invalid.`);
  }
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

export function newInvoice(seller = defaultSeller, now = new Date()) {
  const suffix = globalThis.crypto.randomUUID().slice(0, 6).toUpperCase();
  return {
    number: `${singaporeDate(now).replaceAll("-", "").slice(2)}-${suffix}`,
    date: singaporeDate(now),
    status: "unpaid",
    customer: { name: "", phone: "", address: "" },
    items: [{ description: "", quantity: "1", price: "" }],
    notes: "",
    seller: normalizeSeller(seller),
  };
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
    [invoice.seller?.phone, 60, "Business phone"], [invoice.seller?.email, 120, "Business email"],
    [invoice.seller?.registration, 80, "Business registration"], [invoice.seller?.payment, 800, "Payment instructions"],
    [invoice.seller?.address, 240, "Business address"], [invoice.seller?.contact, 50, "Contact name"], [invoice.seller?.terms, 240, "Invoice footer"],
    [invoice.notes, 1200, "Notes"],
  ]) if (typeof value !== "string" || value.length > max) errors.push(`${label} is too long or invalid.`);
  return errors;
}

export function invoiceSummary(invoice) {
  return [
    `Hi ${invoice.customer.name.trim()},`, "",
    `Invoice ${invoice.number} | ${displayDate(invoice.date)}`,
    ...invoice.items.map((item) => `${item.description.trim()}${Number(item.quantity) > 1 ? ` x ${item.quantity}` : ""}: ${formatMoney(lineTotal(item))}`),
    "", `Total: ${formatMoney(invoiceTotal(invoice))}`,
    `Payment status: ${invoice.status === 'paid' ? 'Paid' : 'Unpaid'}`,
    ...(invoice.status !== 'paid' && invoice.seller.payment.trim() ? ["", invoice.seller.payment.trim()] : []),
    "", "Please see the PDF invoice for details.", `Thank you, ${invoice.seller.name.trim()}.`,
    ...(invoice.seller.reviewUrl?.trim() ? ["", "We'd appreciate a review of our service:", invoice.seller.reviewUrl.trim()] : []),
  ].join("\n");
}

export function whatsappUrl(invoice) {
  const number = whatsappNumber(invoice.customer.phone);
  if (number === null) throw new Error("Invalid WhatsApp number.");
  return `https://wa.me/${number}?text=${encodeURIComponent(invoiceSummary(invoice))}`;
}

export function invoiceFilename(invoice) {
  const safe = invoice.number.replace(/[^a-z0-9_-]/gi, "-").replace(/-+/g, "-").slice(0, 70) || "invoice";
  return `${safe}.pdf`;
}

// Only restore the shape we own, with length limits; stored data never becomes HTML.
export function restoreDraft(raw) {
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
      seller: normalizeSeller(source.seller),
      items: source.items.slice(0, MAX_ITEMS).map((item) => ({ description: take(item?.description, 240), quantity: take(item?.quantity, 3, "1"), price: take(item?.price, 10) })),
      notes: take(source.notes, 1200),
    };
  } catch { return null; }
}
