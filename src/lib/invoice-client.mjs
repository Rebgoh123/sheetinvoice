import {
  MAX_ITEMS, newInvoice, normalizeSeller, validateSeller, invoiceTotal, lineTotal,
  formatMoney, displayDate, validateInvoice, invoiceSummary, whatsappUrl, invoiceFilename,
} from "./invoice.mjs";
import { InvoiceSheets } from './invoice-sheets.mjs';
import { prepareGoogle, preparePicker, chooseSheet } from './invoice-google.mjs';

const $ = (id) => document.getElementById(id);
const form = $("invoice-form");
// Records and access tokens are kept in memory, never cached in browser storage.
// The only remembered value is the chosen Sheet ID, scoped to the Google user ID.
function stored(key) { try { return localStorage.getItem(key); } catch { return null; } }
let invoice = newInvoice();
let business = normalizeSeller(), profileDirty = false;
if (!invoice.items.length) invoice.items.push({ description: "", quantity: "1", price: "" });
let generated = null, objectUrl = null, revision = 0, generating = false, sharing = false;
let sheets = null, workbook = null, googleUser = null, tokenClient = null, googleBusy = false, pickerReady = false, googleLoadFailed = false;
let connectionEpoch = 0, expiryTimer = null, requiresSheetSave = false, dirty = false;
let checkingAccess = false;
let recordId = crypto.randomUUID(), recordRevision = crypto.randomUUID(), customerId = null, recordWorkbookId = null;
let baseRevision = null, historyPage = 0;
let activeView = 'invoice', previousView = 'invoice', customerMode = 'new', historyStatus = 'all';
const paymentRetries = new Map();
const googleConfig = JSON.parse($('invoice-google-config').textContent);
const pdfLabel = () => requiresSheetSave ? 'Save & PDF' : 'Generate PDF';

const fields = {
  "customer-name": ["customer", "name"], "customer-phone": ["customer", "phone"], "customer-address": ["customer", "address"],
};
const sellerFields = { name: 'seller-name', address: 'seller-address', contact: 'seller-contact', phone: 'seller-phone', email: 'seller-email', registration: 'seller-registration', payment: 'seller-payment', terms: 'seller-terms', reviewUrl: 'seller-review-url' };
function fillBusinessForm() {
  for (const [key, id] of Object.entries(sellerFields)) $(id).value = business[key];
}
function readBusinessForm() {
  business = normalizeSeller(Object.fromEntries(Object.entries(sellerFields).map(([key, id]) => [key, $(id).value])));
}
function resetBusinessProfile() { business = normalizeSeller(); profileDirty = false; fillBusinessForm(); }
function businessChanged() {
  readBusinessForm(); profileDirty = true; invoice.seller = { ...business };
  revision++; recordRevision = crypto.randomUUID(); dirty = true;
  discardPdf(); errors(); persist();
  $('business-save-status').textContent = workbook ? 'Unsaved business details.' : 'Used in this tab. Connect a Sheet to save for next time.';
}
function showView(view, focus = true) {
  if (view === 'settings' && activeView !== 'settings') previousView = activeView;
  if (view === 'pdf' && !generated) view = 'invoice';
  activeView = view;
  for (const [name, id] of [['invoice', 'invoice-panel'], ['history', 'history-panel'], ['settings', 'settings-panel'], ['pdf', 'pdf-result']]) $(id).hidden = view !== name;
  for (const name of ['invoice', 'history']) {
    const selected = name === view || (name === 'invoice' && view === 'pdf');
    $(`${name}-tab`).setAttribute('aria-selected', String(selected));
    const settingsReturn = view === 'settings' && name === (previousView === 'history' ? 'history' : 'invoice');
    $(`${name}-tab`).tabIndex = selected || settingsReturn ? 0 : -1;
  }
  $('settings-button').setAttribute('aria-expanded', String(view === 'settings'));
  if (focus) {
    const heading = $(view === 'pdf' ? 'pdf-result' : `${view}-panel`).querySelector('h1');
    heading.tabIndex = -1; heading.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'instant' });
  }
}
function updateCustomerControls() {
  const hasCustomers = !!workbook?.customers.length;
  if (!hasCustomers) customerMode = 'new';
  const saved = hasCustomers && customerMode === 'saved';
  $('saved-customer-field').hidden = !saved; $('saved-customer').required = saved;
  $('customer-name-field').hidden = saved; $('customer-name').required = !saved;
  $('customer-label').htmlFor = saved ? 'saved-customer' : 'customer-name';
  $('new-customer').hidden = !hasCustomers;
  $('new-customer').textContent = saved ? '+ New customer' : 'Saved customers';
}
function fillForm() {
  for (const [id, [group, field]] of Object.entries(fields)) $(id).value = invoice[group][field];
  $("invoice-number").value = invoice.number;
  $("invoice-date").value = invoice.date;
  $('payment-status').checked = invoice.status === 'paid';
  $("notes").value = invoice.notes;
  $('saved-customer').value = customerId || '';
  customerMode = customerId || (!invoice.customer.name.trim() && workbook?.customers.length) ? 'saved' : 'new';
  updateCustomerControls();
  renderItems(); updateTotals();
}
function readForm() {
  for (const [id, [group, field]] of Object.entries(fields)) invoice[group][field] = $(id).value;
  invoice.number = $("invoice-number").value;
  invoice.date = $("invoice-date").value;
  invoice.status = $('payment-status').checked ? 'paid' : 'unpaid';
  invoice.notes = $("notes").value;
  invoice.items = [...$("items").children].map((row) => ({
    description: row.querySelector(".item-description").value,
    quantity: row.querySelector(".item-quantity").value,
    price: row.querySelector(".item-price").value,
  }));
}
function persist() {
  $('draft-status').textContent = dirty ? 'Unsaved changes' : '';
  $('draft-status').hidden = !dirty;
  $('invoice-heading').textContent = baseRevision ? 'Edit invoice' : 'New invoice';
  $('business-hint').hidden = !!invoice.seller.name.trim();
}
function errors(messages = []) {
  const box = $("error-box"); box.replaceChildren(); box.hidden = !messages.length;
  if (!messages.length) return;
  showView('invoice', false);
  const list = document.createElement("ul");
  for (const message of messages) { const li = document.createElement("li"); li.textContent = message; list.append(li); }
  box.append(list); box.focus();
}
function discardPdf() {
  generated = null;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = null;
  $("pdf-result").hidden = true;
  $("share-status").textContent = "";
  for (const id of ["view-pdf", "download-pdf", "open-whatsapp"]) $(id).removeAttribute("href");
  $("whatsapp-summary").value = "";
  $('sheet-save-status').textContent = '';
  $('invoice-save-status').textContent = '';
  $('invoice-save-status').hidden = true;
  if (activeView === 'pdf') showView('invoice', false);
  if (!generating) $("generate-pdf").querySelector("span").textContent = pdfLabel();
}
function changed() {
  readForm(); revision++; recordRevision = crypto.randomUUID(); dirty = true;
  const selected = workbook?.customers.find(customer => customer.id === customerId);
  if (selected && selected.name !== invoice.customer.name) { customerId = null; $('saved-customer').value = ''; }
  discardPdf(); errors(); updateTotals(); persist();
}
function renderItems(focusIndex) {
  const container = $("items"); container.replaceChildren();
  invoice.items.forEach((item, index) => {
    const row = $("item-template").content.firstElementChild.cloneNode(true);
    for (const [key, label] of [["description", "description"], ["quantity", "quantity"], ["price", "price"]]) {
      const input = row.querySelector(`.item-${key}`);
      input.id = `item-${key}-${index}`; input.name = `items[${index}][${key}]`; input.value = item[key];
      input.setAttribute('aria-label', `${label} for item ${index + 1}`);
      row.querySelector(`.${label}-label`).htmlFor = input.id;
    }
    const remove = row.querySelector(".remove-item");
    remove.disabled = invoice.items.length === 1;
    remove.setAttribute("aria-label", `Remove item ${index + 1}`);
    remove.addEventListener("click", () => {
      readForm(); invoice.items.splice(index, 1); renderItems(Math.min(index, invoice.items.length - 1)); changed();
    });
    container.append(row);
  });
  $("add-item").disabled = invoice.items.length >= MAX_ITEMS;
  if (focusIndex !== undefined) container.children[focusIndex]?.querySelector(".item-description").focus();
}
function updateTotals() {
  invoice.items.forEach((item, index) => {
    const total = lineTotal(item);
    $('items').children[index].querySelector('.line-total strong').textContent = total === null ? '—' : formatMoney(total);
  });
  $('action-total').textContent = formatMoney(invoiceTotal(invoice));
}

form.addEventListener("input", changed);
form.addEventListener("change", changed);
$('business-form').addEventListener('input', businessChanged);
$('business-form').addEventListener('change', businessChanged);
$("add-item").addEventListener("click", () => {
  readForm(); if (invoice.items.length >= MAX_ITEMS) return;
  invoice.items.push({ description: "", quantity: "1", price: "" });
  renderItems(invoice.items.length - 1); changed();
});
async function completeInvoice({ pdf = true } = {}) {
  if (generating || (googleBusy && sheets)) return;
  $('google-error').hidden = true;
  if (requiresSheetSave && (!sheets || !workbook)) { cloudError(new Error('Reconnect Google and choose your Sheet before saving. Your draft is still in this tab.')); return; }
  if (!pdf && !workbook) return;
  readForm(); errors();
  const validation = validateInvoice(invoice);
  if (validation.length) { errors(validation); return; }
  generating = true;
  updateCloudControls();
  const button = $("generate-pdf"); button.disabled = true; button.querySelector("span").textContent = pdf ? "Creating PDF…" : "Saving…";
  const version = revision, snapshot = structuredClone(invoice), saveRecord = { id: recordId, revision: recordRevision, baseRevision, customerId, invoice: snapshot };
  const activeSheets = sheets, activeWorkbook = workbook, epoch = connectionEpoch;
  discardPdf();
  try {
    let savedToSheet = false;
    if (activeSheets && activeWorkbook) {
      button.querySelector('span').textContent = 'Saving…';
      const saved = await activeSheets.save(activeWorkbook.id, saveRecord);
      if (epoch !== connectionEpoch) return;
      workbook = saved.workbook; savedToSheet = true;
      if (recordId === saveRecord.id) baseRevision = saveRecord.revision;
      if (version === revision) { customerId = saved.customerId; dirty = false; }
      renderCloudRecords();
    }
    if (!pdf) {
      $('invoice-save-status').hidden = false;
      if (version !== revision) { $('invoice-save-status').textContent = 'Earlier details saved. Your latest changes still need saving.'; return; }
      $('invoice-save-status').textContent = `Saved to Sheet · ${snapshot.status === 'paid' ? 'Paid' : 'Unpaid'}`;
      persist(); return;
    }
    button.querySelector('span').textContent = 'Creating PDF…';
    const { generateInvoicePdf } = await import("./invoice-pdf.mjs");
    const bytes = await generateInvoicePdf(snapshot);
    if (epoch !== connectionEpoch) return;
    if (version !== revision) { errors([savedToSheet ? 'Earlier details saved. Choose Save & PDF again for your latest edits.' : 'The details changed. Generate the PDF again.']); return; }
    const file = new File([bytes], invoiceFilename(snapshot), { type: "application/pdf" });
    generated = { file, invoice: snapshot };
    objectUrl = URL.createObjectURL(file);
    $("download-pdf").href = objectUrl; $("download-pdf").download = file.name;
    $("view-pdf").href = objectUrl;
    $("whatsapp-summary").value = invoiceSummary(snapshot);
    $("open-whatsapp").href = whatsappUrl(snapshot);
    $("result-description").textContent = `${snapshot.customer.name.trim()} · ${formatMoney(invoiceTotal(snapshot))} · ${(file.size / 1024).toFixed(0)} KB PDF`;
    $('result-filename').textContent = file.name;
    $('result-payment-status').textContent = snapshot.status === 'paid' ? 'Paid' : 'Unpaid';
    $('result-payment-status').className = `iv-small-badge iv-badge-${snapshot.status}`;
    $('sheet-save-status').textContent = savedToSheet ? 'Saved to your Google Sheet.' : 'PDF only. This invoice has not been saved to Google Sheets.';
    const canShare = supportsFileShare(file);
    $("share-pdf").querySelector("span").textContent = canShare ? "Share PDF" : "Download PDF to share";
    $("share-help").textContent = canShare
      ? 'Choose WhatsApp from the share menu.'
      : 'Download the PDF, then attach it in WhatsApp.';
    showView('pdf');
    persist();
  } catch (error) {
    if (epoch !== connectionEpoch) return;
    if (error.name === 'SheetsError') cloudError(error);
    else errors(["The PDF could not be created. Your draft is still here. If the Sheet save completed, it remains in invoice history. Please try again."]);
  } finally {
    generating = false; button.disabled = false; button.querySelector("span").textContent = pdfLabel(); updateCloudControls(); persist();
  }
}
form.addEventListener('submit', event => {
  event.preventDefault();
  return completeInvoice({ pdf: event.submitter?.value !== 'save-only' });
});
$('edit-invoice').addEventListener('click', () => showView('invoice'));
for (const name of ['invoice', 'history']) $(`${name}-tab`).addEventListener('click', () => showView(name));
document.querySelectorAll('[role=tab]').forEach((tab, index, tabs) => tab.addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + 1) % tabs.length;
  tabs[next].click(); tabs[next].focus();
}));
$('settings-button').addEventListener('click', () => showView(activeView === 'settings' ? previousView : 'settings'));
$('settings-done').addEventListener('click', () => showView(previousView));
document.querySelectorAll('[data-open-settings]').forEach(button => button.addEventListener('click', () => showView('settings')));
$('new-customer').addEventListener('click', () => {
  if (customerMode === 'saved') {
    customerMode = 'new'; customerId = null; $('saved-customer').value = '';
    $('customer-name').value = ''; $('customer-phone').value = ''; changed();
  } else customerMode = 'saved';
  updateCustomerControls(); $('saved-customer-field').hidden ? $('customer-name').focus() : $('saved-customer').focus();
});

function supportsFileShare(file) {
  try { return !!(window.isSecureContext && navigator.share && navigator.canShare?.({ files: [file] })); } catch { return false; }
}
$("share-pdf").addEventListener("click", async () => {
  if (!generated || sharing) return;
  const { file } = generated;
  if (!supportsFileShare(file)) {
    $("download-pdf").click();
    $("share-status").textContent = "Save the PDF, then tap Open WhatsApp and attach it to the message.";
    return;
  }
  sharing = true; $("share-pdf").disabled = true;
  try {
    // File is prepared before this click, preserving the required user gesture.
    await navigator.share({ files: [file], title: `Invoice ${generated.invoice.number}`, text: invoiceSummary(generated.invoice) });
    $("share-status").textContent = "Share menu closed. Check WhatsApp to confirm the invoice was sent.";
  } catch (error) {
    $("share-status").textContent = error.name === "AbortError"
      ? "Sharing cancelled. Your PDF is still ready."
      : "File sharing wasn’t available. Download the PDF and attach it in WhatsApp instead.";
  } finally { sharing = false; $("share-pdf").disabled = false; }
});
$("copy-summary").addEventListener("click", async () => {
  if (!generated) return;
  const summary = $("whatsapp-summary");
  try {
    await navigator.clipboard.writeText(summary.value);
    $("share-status").textContent = "Summary copied. You can paste it into WhatsApp.";
  } catch {
    summary.focus(); summary.select(); summary.setSelectionRange(0, summary.value.length);
    $("share-status").textContent = "Select and copy the summary above, then paste it into WhatsApp.";
  }
});
function startInvoice(selectedCustomer) {
  if ((dirty || generated) && !window.confirm('Start a new invoice? Unsaved changes will be replaced.')) return;
  readForm(); const seller = { ...business };
  revision++; recordId = crypto.randomUUID(); baseRevision = null; recordRevision = crypto.randomUUID(); customerId = null; dirty = false; $('saved-customer').value = ''; discardPdf(); errors(); invoice = newInvoice(seller); fillForm(); persist();
  if (selectedCustomer) {
    const customer = workbook?.customers.find(customer => customer.id === selectedCustomer);
    if (customer) { customerId = customer.id; invoice.customer = { name: customer.name, phone: customer.phone, address: customer.address }; fillForm(); renderCloudRecords(); }
  }
  showView('invoice'); $('saved-customer-field').hidden ? $('customer-name').focus() : $('saved-customer').focus();
}
$('new-invoice').addEventListener('click', () => startInvoice());
$('history-new-invoice').addEventListener('click', () => startInvoice($('history-customer').value));
$("clear-device").addEventListener("click", () => {
  if (!window.confirm('Clear this tab’s invoice? This does not delete records in Google Sheets. Download any PDF you need first.')) return;
  revision++; recordId = crypto.randomUUID(); baseRevision = null; recordRevision = crypto.randomUUID(); customerId = null; dirty = false;
  business = normalizeSeller(workbook?.seller); profileDirty = false; fillBusinessForm();
  discardPdf(); errors(); invoice = newInvoice(business); fillForm(); persist(); showView('invoice');
});
window.addEventListener("pagehide", () => { if (objectUrl) URL.revokeObjectURL(objectUrl); });
window.addEventListener("pageshow", (event) => { if (event.persisted && generated) {
  objectUrl = URL.createObjectURL(generated.file); $("view-pdf").href = objectUrl; $("download-pdf").href = objectUrl;
} });
fillBusinessForm(); fillForm(); $("invoice-app").hidden = false; persist();

function updateCloudControls() {
  $('connect-google').disabled = (!tokenClient && !googleLoadFailed) || googleBusy || generating;
  $('connect-google').hidden = !!sheets;
  $('disconnect-google').hidden = !sheets && !googleUser;
  for (const id of ['create-sheet', 'refresh-sheet', 'change-sheet', 'save-business-defaults', 'disconnect-google']) $(id).disabled = googleBusy || generating;
  $('choose-sheet').disabled = !pickerReady || !sheets || googleBusy || generating;
  $('use-existing-sheet').disabled = !sheets || !$('existing-sheet').value || googleBusy || generating;
  $('generate-pdf').disabled = generating || (googleBusy && !!sheets) || (requiresSheetSave && !workbook);
  $('save-invoice').disabled = generating || googleBusy || !workbook;
  $('history-customer').disabled = !workbook || googleBusy || generating;
  document.querySelectorAll('[data-status]').forEach(button => button.disabled = !workbook || googleBusy || generating);
  for (const button of $('history-list').querySelectorAll('button')) button.disabled = googleBusy || generating;
  $('history-previous').disabled = googleBusy || generating || historyPage === 0;
  $('history-next').disabled = googleBusy || generating || historyPage >= Math.ceil(filteredHistory().length / 10) - 1;
  for (const id of ['new-invoice', 'history-new-invoice', 'new-customer', 'clear-device', 'saved-customer']) $(id).disabled = (googleBusy && !!sheets) || generating;
  $('connection-label').textContent = workbook ? 'Sheet connected' : googleBusy ? 'Connecting…' : sheets ? 'Choose a Sheet' : requiresSheetSave ? 'Reconnect Google' : 'Not connected';
  $('connection-status').dataset.connected = String(!!workbook);
  $('connect-hint').hidden = !!workbook;
  $('history-connect').hidden = !!workbook;
  $('connect-hint-text').textContent = requiresSheetSave ? 'Reconnect Google to save this draft.' : 'Connect Google to save invoices.';
}
function cloudError(error) {
  $('google-error').textContent = error.message || 'Google could not finish this action. Your draft is still here.';
  $('google-error').hidden = false;
  if (['expired', 'permission', 'privacy'].includes(error.code) && sheets) {
    const expired = error.code === 'expired';
    sheets.disconnect(); sheets = null; workbook = null; connectionEpoch++; clearTimeout(expiryTimer);
    renderCloudRecords(); $('sheet-setup').hidden = true; $('sheet-connected').hidden = true;
    if (!expired || (!dirty && !profileDirty)) { dirty = false; resetBusinessProfile(); invoice = newInvoice(); customerId = null; recordId = crypto.randomUUID(); baseRevision = null; recordRevision = crypto.randomUUID(); recordWorkbookId = null; revision++; discardPdf(); fillForm(); }
    $('open-sheet').removeAttribute('href'); $('connected-sheet-name').textContent = ''; $('business-save-status').textContent = '';
    $('google-status').textContent = expired ? 'Google disconnected. Reconnect to continue saving your draft.' : 'Sheet access is unavailable. Connect again after checking its sharing settings.';
  }
  updateCloudControls(); persist(); $('google-error').focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'instant' });
}
async function cloudAction(action) {
  if (googleBusy || generating) return;
  googleBusy = true; $('google-error').hidden = true; updateCloudControls();
  try { await action(); } catch (error) { cloudError(error); }
  finally { googleBusy = false; updateCloudControls(); }
}
function renderCloudRecords() {
  const selectedFilter = $('history-customer').value;
  const placeholder = new Option('Choose a customer', ''); placeholder.disabled = true;
  $('saved-customer').replaceChildren(placeholder);
  $('history-customer').replaceChildren(new Option('All customers', ''));
  for (const customer of workbook?.customers || []) {
    $('saved-customer').add(new Option(customer.name, customer.id));
    $('history-customer').add(new Option(customer.name, customer.id));
  }
  $('saved-customer').value = customerId || '';
  $('history-customer').value = workbook?.customers.some(customer => customer.id === selectedFilter) ? selectedFilter : '';
  if (!workbook) {
    historyStatus = 'all'; historyPage = 0; paymentRetries.clear();
    $('history-feedback').textContent = ''; $('history-feedback').hidden = true;
  }
  updateCustomerControls(); renderHistory();
  $('history-count').textContent = workbook ? String(workbook.invoices.length) : '';
  $('history-count').hidden = !workbook;
  $('save-business-defaults').hidden = !workbook;
  updateCloudControls();
}
function filteredHistory() {
  const customer = $('history-customer').value;
  return (workbook?.invoices || []).filter(record => (!customer || record.customerId === customer)
    && (historyStatus === 'all' || (record.invoice.status || 'unpaid') === historyStatus));
}
function renderHistory() {
  const records = filteredHistory(), list = $('history-list'); list.replaceChildren();
  historyPage = Math.min(historyPage, Math.max(0, Math.ceil(records.length / 10) - 1));
  $('history-empty').hidden = !workbook || records.length > 0;
  $('history-empty').textContent = workbook?.invoices.length ? 'No transactions for this selection.' : 'No saved invoices yet.';
  $('history-head').hidden = !records.length;
  $('history-summary').hidden = !workbook;
  const unpaid = records.filter(record => record.invoice.status !== 'paid').reduce((sum, record) => sum + invoiceTotal(record.invoice), 0);
  $('history-summary').textContent = `${records.length} ${records.length === 1 ? 'invoice' : 'invoices'} · ${formatMoney(unpaid)} unpaid`;
  document.querySelectorAll('[data-status]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.status === historyStatus)));
  for (const record of records.slice(historyPage * 10, historyPage * 10 + 10)) {
    const saved = record.invoice, paid = saved.status === 'paid';
    const row = document.createElement('li'); row.className = 'iv-history-row';
    const id = document.createElement('div'); id.className = 'iv-history-id';
    const number = document.createElement('strong'); number.textContent = saved.number;
    const date = document.createElement('small'); date.textContent = displayDate(saved.date); id.append(number, date);
    const customer = document.createElement('div'); customer.className = 'iv-history-customer';
    const name = document.createElement('strong'); name.textContent = saved.customer.name;
    const service = document.createElement('small'); service.textContent = saved.items.map(item => item.description).join(', '); customer.append(name, service);
    const amount = document.createElement('div'); amount.className = 'iv-history-amount'; amount.textContent = formatMoney(invoiceTotal(saved));
    const status = document.createElement('div'); status.className = 'iv-history-status';
    const badge = document.createElement('span'); badge.className = `iv-small-badge iv-badge-${paid ? 'paid' : 'unpaid'}`; badge.textContent = paid ? 'Paid' : 'Unpaid'; status.append(badge);
    const actions = document.createElement('div'); actions.className = 'iv-history-actions';
    const open = document.createElement('button'); open.type = 'button'; open.className = 'iv-text-button'; open.textContent = 'Open'; open.setAttribute('aria-label', `Open invoice ${saved.number}`);
    open.addEventListener('click', () => openRecord(record)); actions.append(open);
    if (!paid) {
      const pay = document.createElement('button'); pay.type = 'button'; pay.className = 'iv-text-button'; pay.textContent = 'Mark paid'; pay.setAttribute('aria-label', `Mark invoice ${saved.number} paid`);
      pay.addEventListener('click', () => markRecordPaid(record)); actions.append(pay);
    }
    row.append(id, customer, amount, status, actions); list.append(row);
  }
  $('history-pagination').hidden = records.length <= 10;
  $('history-page').textContent = records.length ? `${historyPage * 10 + 1}–${Math.min((historyPage + 1) * 10, records.length)} of ${records.length}` : '';
}
function openRecord(record) {
  if (googleBusy || generating || (dirty && !window.confirm('Open this invoice and discard your unsaved changes?'))) return false;
  invoice = structuredClone(record.invoice); invoice.status ||= 'unpaid'; recordId = record.id; recordRevision = record.revision; baseRevision = record.revision; customerId = record.customerId; dirty = false; revision++; discardPdf(); errors(); fillForm(); renderCloudRecords(); persist(); showView('invoice');
  return true;
}
async function markRecordPaid(record) {
  if (!workbook || !sheets) return;
  return cloudAction(async () => {
    const epoch = connectionEpoch, key = `${workbook.id}:${record.id}:${record.revision}`;
    if (!paymentRetries.has(key)) paymentRetries.set(key, crypto.randomUUID());
    const nextRevision = paymentRetries.get(key);
    $('history-feedback').hidden = true;
    const saved = await sheets.save(workbook.id, { id: record.id, revision: nextRevision, baseRevision: record.revision, customerId: record.customerId, invoice: { ...structuredClone(record.invoice), status: 'paid' } }, { updateCustomer: false });
    if (epoch !== connectionEpoch) return;
    workbook = saved.workbook; paymentRetries.delete(key);
    if (recordId === record.id) {
      invoice.status = 'paid'; $('payment-status').checked = true; baseRevision = nextRevision;
      recordRevision = dirty ? crypto.randomUUID() : nextRevision; revision++; discardPdf(); updateTotals(); persist();
    }
    renderCloudRecords(); $('history-feedback').textContent = `${record.invoice.number} marked paid.`; $('history-feedback').hidden = false;
  });
}
$('history-customer').addEventListener('change', () => { historyPage = 0; renderHistory(); updateCloudControls(); });
document.querySelectorAll('[data-status]').forEach(button => button.addEventListener('click', () => { historyStatus = button.dataset.status; historyPage = 0; renderHistory(); updateCloudControls(); }));
for (const [id, direction] of [['history-previous', -1], ['history-next', 1]]) $(id).addEventListener('click', () => { historyPage += direction; renderHistory(); updateCloudControls(); });
function useWorkbook(next) {
  if (recordWorkbookId && recordWorkbookId !== next.id) {
    recordId = crypto.randomUUID(); baseRevision = null; recordRevision = crypto.randomUUID(); customerId = null;
  }
  if (!workbook || workbook.id !== next.id) { revision++; discardPdf(); }
  const changedWorkbook = recordWorkbookId !== next.id;
  recordWorkbookId = next.id;
  workbook = next; requiresSheetSave = true;
  if (!profileDirty || changedWorkbook) { business = normalizeSeller(next.seller); profileDirty = false; fillBusinessForm(); }
  if ((!dirty && !baseRevision) || changedWorkbook) { invoice.seller = { ...business }; fillForm(); }
  $('sheet-setup').hidden = true; $('sheet-connected').hidden = false;
  $('connected-sheet-name').textContent = next.name;
  $('open-sheet').href = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(next.id)}/edit`;
  $('google-status').textContent = googleUser.email;
  try { localStorage.setItem(`sheetinvoice-sheet-${googleUser.id}`, next.id); } catch { /* Remembering a Sheet ID is optional. */ }
  renderCloudRecords(); $('generate-pdf').querySelector('span').textContent = pdfLabel(); persist();
}
async function showSheetSetup() {
  const active = sheets, epoch = connectionEpoch;
  const files = await active.list();
  if (epoch !== connectionEpoch) return;
  $('existing-sheet').replaceChildren(new Option('Choose a workbook', ''));
  for (const file of files) $('existing-sheet').add(new Option(file.name, file.id));
  $('sheet-setup').hidden = false;
  $('google-status').textContent = `${googleUser.email} · Choose or create your invoice Sheet.`;
}
async function connected(token) {
  const active = new InvoiceSheets(token), epoch = ++connectionEpoch;
  sheets?.disconnect(); sheets = active;
  googleBusy = true; $('google-error').hidden = true; updateCloudControls();
  try {
    const nextUser = await active.user();
    if (epoch !== connectionEpoch) return;
    if (googleUser && googleUser.id !== nextUser.id) {
      if ((dirty || profileDirty) && !window.confirm('This is a different Google account. Discard your unsaved draft and switch accounts?')) { active.disconnect(); sheets = null; return; }
      resetBusinessProfile(); invoice = newInvoice(); dirty = false; customerId = null; recordId = crypto.randomUUID(); baseRevision = null; recordRevision = crypto.randomUUID(); revision++; discardPdf(); fillForm();
    }
    googleUser = nextUser;
    clearTimeout(expiryTimer);
    expiryTimer = setTimeout(() => cloudError(Object.assign(new Error('Your Google connection expired. Reconnect to continue. Your unsaved draft remains in this tab.'), { code: 'expired' })), Math.max(0, token.expiresAt - Date.now()));
    await showSheetSetup();
    const previous = stored(`sheetinvoice-sheet-${googleUser.id}`);
    if (previous && epoch === connectionEpoch) { const next = await active.load(previous); if (epoch === connectionEpoch) useWorkbook(next); }
  } catch (error) { if (epoch === connectionEpoch) cloudError(error); }
  finally { googleBusy = false; updateCloudControls(); }
}
$('connect-google').addEventListener('click', () => {
  if (googleBusy) return;
  if (!tokenClient) { if (googleLoadFailed) initializeGoogle(); return; }
  googleBusy = true; $('google-error').hidden = true; updateCloudControls();
  tokenClient.requestAccessToken({ prompt: 'select_account', ...(googleUser ? { hint: googleUser.email } : {}) });
});
$('disconnect-google').addEventListener('click', () => {
  if ((dirty || profileDirty) && !window.confirm('Disconnect and clear this tab? Unsaved changes will be lost. Saved Google Sheets records will stay.')) return;
  connectionEpoch++; clearTimeout(expiryTimer); sheets?.disconnect(); sheets = null; workbook = null; googleUser = null; requiresSheetSave = false; googleBusy = false;
  resetBusinessProfile(); invoice = newInvoice(); dirty = false; customerId = null; recordId = crypto.randomUUID(); baseRevision = null; recordRevision = crypto.randomUUID(); revision++; discardPdf(); fillForm();
  $('sheet-setup').hidden = true; $('sheet-connected').hidden = true; $('existing-sheet').replaceChildren(new Option('Choose a workbook', ''));
  $('open-sheet').removeAttribute('href'); $('connected-sheet-name').textContent = ''; $('business-save-status').textContent = '';
  $('google-error').hidden = true; $('google-status').textContent = 'Disconnected. Records and PDFs have been cleared from this tab. Your Sheet is unchanged.';
  renderCloudRecords(); persist();
});
$('create-sheet-form').addEventListener('submit', event => { event.preventDefault(); cloudAction(async () => {
  readForm(); readBusinessForm(); const active = sheets, epoch = connectionEpoch;
  $('google-status').textContent = 'Creating your private invoice Sheet…';
  const next = await active.create($('sheet-name').value, business);
  if (epoch === connectionEpoch) { useWorkbook(next); $('business-save-status').textContent = 'Review and save your business details below.'; }
}); });
$('existing-sheet').addEventListener('change', updateCloudControls);
$('use-existing-sheet').addEventListener('click', () => cloudAction(async () => { const epoch = connectionEpoch, next = await sheets.load($('existing-sheet').value); if (epoch === connectionEpoch) useWorkbook(next); }));
$('choose-sheet').addEventListener('click', () => cloudAction(async () => { const epoch = connectionEpoch, id = await chooseSheet(googleConfig, sheets.token); if (!id || epoch !== connectionEpoch) return; const next = await sheets.load(id); if (epoch === connectionEpoch) useWorkbook(next); }));
$('refresh-sheet').addEventListener('click', () => cloudAction(async () => { const epoch = connectionEpoch, next = await sheets.load(workbook.id); if (epoch === connectionEpoch) useWorkbook(next); }));
$('change-sheet').addEventListener('click', () => cloudAction(async () => {
  if ((dirty || profileDirty) && !window.confirm('Change Sheet and discard this unsaved draft?')) return;
  workbook = null; resetBusinessProfile(); invoice = newInvoice(); dirty = false; customerId = null; recordId = crypto.randomUUID(); baseRevision = null; recordRevision = crypto.randomUUID(); revision++; discardPdf(); fillForm(); renderCloudRecords(); $('sheet-connected').hidden = true;
  await showSheetSetup();
}));
$('saved-customer').addEventListener('change', () => {
  readForm(); const address = invoice.customer.address;
  const previous = workbook?.customers.find(customer => customer.id === customerId);
  const selected = workbook?.customers.find(customer => customer.id === $('saved-customer').value);
  if (selected) invoice.customer = { name: selected.name, phone: selected.phone, address: selected.address };
  else invoice.customer = { name: '', phone: '', address: '' };
  // A customer can have jobs at different addresses; preserve an address already entered for this job.
  if (address.trim() && address !== previous?.address) invoice.customer.address = address;
  for (const field of ['name', 'phone', 'address']) $(`customer-${field}`).value = invoice.customer[field];
  customerId = selected?.id || null; changed();
  customerMode = selected ? 'saved' : 'new'; updateCustomerControls();
});
$('business-form').addEventListener('submit', event => { event.preventDefault(); return cloudAction(async () => {
  readBusinessForm(); const errors = validateSeller(business);
  if (errors.length) throw new Error(errors.join(' '));
  if (!workbook || !sheets) { $('business-save-status').textContent = 'Used in this tab. Connect a Sheet to save for next time.'; return; }
  const epoch = connectionEpoch, next = await sheets.saveSeller(workbook.id, business);
  if (epoch === connectionEpoch) { workbook = next; profileDirty = false; $('business-save-status').textContent = 'Business details saved to this Google Sheet.'; }
}); });
window.addEventListener('beforeunload', event => { if (dirty || profileDirty) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('focus', () => {
  if (!sheets || !workbook || checkingAccess || googleBusy || generating) return;
  const active = sheets, id = workbook.id, epoch = connectionEpoch;
  checkingAccess = true;
  // Access is also checked by every read/save. A background focus check must not swallow the next click.
  active.privateFile(id).catch(error => { if (epoch === connectionEpoch && sheets === active && workbook?.id === id) cloudError(error); }).finally(() => { checkingAccess = false; });
});
async function initializeGoogle() {
  googleBusy = true; googleLoadFailed = false; $('connect-google').textContent = 'Loading Google…'; updateCloudControls();
  try {
    tokenClient = await prepareGoogle(googleConfig, connected, error => { googleBusy = false; cloudError(error); });
    $('connect-google').textContent = 'Connect Google';
  } catch (error) {
    googleLoadFailed = error.code !== 'configuration';
    $('connect-google').textContent = googleLoadFailed ? 'Retry Google connection' : 'Google setup needed';
    $('google-status').textContent = error.message;
  } finally { googleBusy = false; updateCloudControls(); }
}
initializeGoogle();
if (googleConfig.apiKey && googleConfig.appId) preparePicker(googleConfig).then(() => { pickerReady = true; updateCloudControls(); }).catch(cloudError);
