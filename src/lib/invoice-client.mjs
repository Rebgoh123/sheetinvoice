import {
  MAX_ITEMS, SELLER_FIELDS, newInvoice, normalizeSeller, validateSeller, invoiceTotal, lineTotal,
  formatMoney, displayDate, validateInvoice, invoiceSummary, whatsappUrl, invoiceFilename, priceInCents,
  nextInvoiceNumber, invoiceNumberStartError,
} from "./invoice.mjs";
import { InvoiceSheets, SAVED_ITEMS_TAB, DESIGN_TAB } from './invoice-sheets.mjs';
import { normalizeDesign } from './invoice-design.mjs';
import { prepareGoogle, preparePicker, chooseSheet } from './invoice-google.mjs';
import { loadDevice, saveDevice, forgetDevice, FORGET_KEY, loadGoogleSession, saveGoogleSession, clearGoogleSession } from './invoice-storage.mjs';

const $ = (id) => document.getElementById(id);
const form = $("invoice-form");
// Drafts/defaults use local storage. A short-lived Google token uses this tab's session storage.
function stored(key) { try { return localStorage.getItem(key); } catch { return null; } }
const remembered = loadDevice();
let forgetMarker = stored(FORGET_KEY);
let invoice = remembered?.invoice || newInvoice();
let automaticNumber = remembered ? remembered.automaticNumber : invoice.number;
let numberStart = remembered?.numberStart || '';
let business = remembered?.business || normalizeSeller(), profileDirty = remembered?.profileDirty || false;
let cachedItems = remembered?.savedItems || [], cachedDesign = remembered?.design || normalizeDesign(), cacheAccountId = remembered?.accountId || null, deviceSaved = false;
if (!invoice.items.length) invoice.items.push({ description: "", quantity: "1", price: "" });
let generated = null, objectUrls = [], exportPage = 0, revision = 0, generating = false, sharing = false;
let exportFormat = remembered?.exportFormat || 'pdf';
$('export-format').value = exportFormat;
let sheets = null, workbook = null, googleUser = null, tokenClient = null, googleBusy = false, pickerReady = false, googleLoadFailed = false;
let restoringSession = false;
let connectionEpoch = 0, loginEpoch = null, expiryTimer = null, requiresSheetSave = !!remembered?.workbookId, dirty = remembered?.dirty || false;
let checkingAccess = false;
let recordId = remembered?.recordId || crypto.randomUUID(), recordRevision = remembered?.recordRevision || crypto.randomUUID(), customerId = remembered?.customerId || null, recordWorkbookId = remembered?.workbookId || null;
let baseRevision = remembered?.baseRevision || null, historyPage = 0;
let activeView = 'invoice', previousView = 'invoice', customerMode = 'new', historyStatus = 'all';
const paymentRetries = new Map();
const googleConfig = JSON.parse($('invoice-google-config').textContent);
const exportLabel = () => `${workbook ? 'Save &' : 'Generate'} ${exportFormat.toUpperCase()}`;
const savedItems = () => workbook?.savedItems ?? cachedItems;
const sheetDesign = () => workbook?.design ?? cachedDesign;

const fields = {
  "customer-name": ["customer", "name"], "customer-phone": ["customer", "phone"], "customer-address": ["customer", "address"],
};
const sellerFields = Object.fromEntries(Object.entries(SELLER_FIELDS).map(([key, field]) => [key, field.id]));
function fillBusinessForm() {
  for (const [key, id] of Object.entries(sellerFields)) $(id).value = business[key];
  $('invoice-number-start').value = numberStart;
  updateNumberingWarning();
}
function readBusinessForm() {
  business = normalizeSeller(Object.fromEntries(Object.entries(sellerFields).map(([key, id]) => [key, $(id).value])));
  numberStart = $('invoice-number-start').value.trim();
  updateNumberingWarning();
}
function updateNumberingWarning(message = invoiceNumberStartError(numberStart)) {
  $('invoice-number-start').setCustomValidity(invoiceNumberStartError(numberStart));
  $('numbering-warning').textContent = message;
  $('numbering-warning').hidden = !message;
}
function suggestedNumber(next = workbook) { return next ? nextInvoiceNumber(next.numberStart, next.tables.Invoices.map(row => row[3])) : null; }
function applyNumbering(next) {
  if (baseRevision || automaticNumber !== invoice.number || next.tables.Invoices.some(row => row[0] === recordId)) return;
  try {
    const number = suggestedNumber(next);
    if (!number || number === invoice.number) return;
    invoice.number = number; automaticNumber = number; $('invoice-number').value = number;
    revision++; recordRevision = crypto.randomUUID(); discardExport();
  } catch (error) { updateNumberingWarning(error.message); }
}
function resetBusinessProfile() { business = normalizeSeller(); numberStart = ''; profileDirty = false; fillBusinessForm(); }
function businessChanged(event) {
  readBusinessForm(); profileDirty = true;
  if (event.target.id !== 'invoice-number-start') {
    invoice.seller = { ...business }; revision++; recordRevision = crypto.randomUUID(); dirty = true;
    discardExport(); errors();
  }
  persist();
  $('business-save-status').textContent = workbook ? 'Saved on this device. Save business details to update your Sheet.' : 'Remembered on this device. Connect a Sheet to sync your defaults.';
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
  if (googleUser) cacheAccountId = googleUser.id;
  if (workbook) { cachedItems = workbook.savedItems; cachedDesign = normalizeDesign(workbook.design); }
  const hasData = exportFormat !== 'pdf' || dirty || profileDirty || recordWorkbookId || Object.entries(business).some(([key, value]) => !SELLER_FIELDS[key].isLabel && value.trim()) || cachedItems.length || Object.values(invoice.customer).some(value => value.trim()) || invoice.items.some(item => !isBlankItem(item)) || invoice.notes.trim();
  deviceSaved = saveDevice(hasData ? { invoice, business, exportFormat, numberStart, automaticNumber, design: cachedDesign, savedItems: cachedItems, accountId: cacheAccountId, workbookId: recordWorkbookId,
    recordId, recordRevision, baseRevision, customerId, dirty, profileDirty } : null);
  $('device-storage-status').textContent = deviceSaved ? '' : 'This browser could not save on this device. Keep the tab open or save to Google Sheets.';
  $('draft-status').textContent = dirty ? (deviceSaved ? 'Saved on device' : 'Unsaved changes') : '';
  $('draft-status').hidden = !dirty;
  $('invoice-heading').textContent = baseRevision ? 'Edit invoice' : 'New invoice';
  $('invoice-details-summary').textContent = [invoice.number, invoice.date].filter(Boolean).join(' · ');
}
function errors(messages = []) {
  const box = $("error-box"); box.replaceChildren(); box.hidden = !messages.length;
  if (!messages.length) return;
  showView('invoice', false);
  const list = document.createElement("ul");
  for (const message of messages) { const li = document.createElement("li"); li.textContent = message; list.append(li); }
  box.append(list); box.focus();
}
function clearExportUrls() {
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls = []; $('invoice-image').removeAttribute('src');
}
function showExportPage(index = 0) {
  if (!generated) return;
  exportPage = Math.max(0, Math.min(index, generated.files.length - 1));
  const file = generated.files[exportPage], url = objectUrls[exportPage], image = generated.format === 'jpg';
  $('download-pdf').href = url; $('download-pdf').download = file.name;
  $('download-pdf').querySelector('span').textContent = generated.files.length > 1 ? `Download page ${exportPage + 1}` : `Download ${generated.format.toUpperCase()}`;
  $('view-pdf').href = url; $('view-pdf').querySelector('span').textContent = image ? 'View JPG' : 'View PDF';
  $('result-filename').textContent = file.name;
  $('invoice-image').hidden = !image;
  if (image) { $('invoice-image').src = url; $('invoice-image').alt = `Invoice ${generated.invoice.number}, page ${exportPage + 1} of ${generated.files.length}`; }
  $('image-page-controls').hidden = !image || generated.files.length < 2;
  $('image-page').textContent = `Page ${exportPage + 1} of ${generated.files.length}`;
  $('image-previous').disabled = exportPage === 0; $('image-next').disabled = exportPage === generated.files.length - 1;
}
function discardExport() {
  generated = null;
  clearExportUrls(); exportPage = 0;
  $('invoice-image').hidden = true; $('image-page-controls').hidden = true;
  $("pdf-result").hidden = true;
  $("share-status").textContent = "";
  for (const id of ["view-pdf", "download-pdf", "open-whatsapp"]) $(id).removeAttribute("href");
  $("whatsapp-summary").value = "";
  $('sheet-save-status').textContent = '';
  $('invoice-save-status').textContent = '';
  $('invoice-save-status').hidden = true;
  if (activeView === 'pdf') showView('invoice', false);
  if (!generating) $("generate-pdf").querySelector("span").textContent = exportLabel();
}
function changed(event) {
  if (event?.target?.id === 'export-format') return;
  if (event?.target?.id === 'invoice-number') automaticNumber = null;
  readForm(); revision++; recordRevision = crypto.randomUUID(); dirty = true;
  const selected = workbook?.customers.find(customer => customer.id === customerId);
  if (selected && selected.name !== invoice.customer.name) { customerId = null; $('saved-customer').value = ''; }
  discardExport(); errors(); updateTotals(); persist();
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
  updateSavedItemControl();
}
function updateSavedItemControl() {
  const items = savedItems();
  for (const button of $('saved-item-tags').children) {
    const item = items[Number(button.dataset.item)];
    if (!item) { button.disabled = true; continue; }
    const index = invoice.items.findIndex(line => sameItem(line, item));
    const quantity = index < 0 ? 0 : Number(invoice.items[index].quantity);
    button.disabled = (googleBusy && !!sheets) || generating || (index >= 0 ? quantity + Number(item.quantity) > 999 : invoice.items.length >= MAX_ITEMS && !invoice.items.some(isBlankItem));
    const count = button.querySelector('.iv-tag-count');
    count.hidden = !quantity; count.textContent = `×${quantity}`;
    button.setAttribute('aria-label', `Add ${item.description}${item.price ? `, ${formatMoney(priceInCents(item.price))}` : ''}${quantity ? `. Quantity ${quantity} in invoice` : ''}`);
  }
}
function isBlankItem(item) { return !item.description.trim() && !item.price.trim() && item.quantity === '1'; }
function sameItem(line, preset) { return preset && line.description.trim() === preset.description.trim() && priceInCents(line.price) === priceInCents(preset.price) && /^\d{1,3}$/.test(line.quantity) && Number(line.quantity) >= 1; }
function renderSavedItems() {
  const items = savedItems();
  $('saved-item-tags').replaceChildren();
  items.forEach((item, index) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'iv-item-tag'; button.dataset.item = String(index);
    const label = document.createElement('span'); label.textContent = item.description;
    const price = document.createElement('span'); price.className = 'iv-tag-price'; price.textContent = item.price ? formatMoney(priceInCents(item.price)) : '';
    const count = document.createElement('span'); count.className = 'iv-tag-count'; count.hidden = true;
    button.append(label, price, count); button.addEventListener('click', () => addSavedItem(index)); $('saved-item-tags').append(button);
  });
  $('quick-items').hidden = !items.length;
  $('saved-items-settings').hidden = !workbook;
  const tab = workbook?.tabs[SAVED_ITEMS_TAB];
  $('setup-saved-items').hidden = Number.isInteger(tab);
  $('edit-saved-items').hidden = !Number.isInteger(tab);
  $('edit-saved-items').removeAttribute('href');
  if (Number.isInteger(tab)) $('edit-saved-items').href = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(workbook.id)}/edit#gid=${tab}`;
  $('saved-items-status').textContent = workbook ? `${items.length} saved item${items.length === 1 ? '' : 's'} available.` : '';
  $('saved-items-warning').textContent = workbook?.savedItemsWarning || '';
  $('saved-items-warning').hidden = !workbook?.savedItemsWarning;
  if (workbook?.savedItemsWarning) $('saved-items-settings').open = true;
  updateSavedItemControl();
}
function renderDesign() {
  $('design-settings').hidden = !workbook;
  const tab = workbook?.tabs[DESIGN_TAB];
  $('setup-design').hidden = Number.isInteger(tab);
  $('edit-design').hidden = !Number.isInteger(tab);
  $('edit-design').removeAttribute('href');
  if (Number.isInteger(tab)) $('edit-design').href = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(workbook.id)}/edit#gid=${tab}`;
  $('design-warning').textContent = workbook?.designWarning || '';
  $('design-warning').hidden = !workbook?.designWarning;
  if (workbook?.designWarning) $('design-settings').open = true;
  $('design-status').textContent = '';
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
function addSavedItem(selected) {
  if ((googleBusy && sheets) || generating) return;
  const item = savedItems()[selected];
  if (!item) return;
  readForm();
  let index = invoice.items.findIndex(line => sameItem(line, item));
  if (index >= 0) {
    const quantity = Number(invoice.items[index].quantity) + Number(item.quantity);
    if (quantity > 999) return;
    invoice.items[index].quantity = String(quantity);
  } else {
    index = invoice.items.findIndex(isBlankItem);
    if (index < 0) { if (invoice.items.length >= MAX_ITEMS) return; index = invoice.items.length; }
    invoice.items[index] = { ...item };
  }
  renderItems(); changed();
  $('quick-add-status').textContent = `${item.description} added. Quantity ${invoice.items[index].quantity}. Total ${formatMoney(invoiceTotal(invoice))}.`;
}
async function completeInvoice({ exportFile = true } = {}) {
  if (generating || (googleBusy && sheets)) return;
  $('google-error').hidden = true;
  if (!exportFile && !workbook) return;
  readForm(); errors();
  if (!invoice.seller.name.trim()) {
    showView('settings'); $('business-defaults').open = true;
    $('business-save-status').textContent = 'Enter your business name for this invoice.';
    $('seller-name').focus(); return;
  }
  const validation = validateInvoice(invoice);
  if (validation.length) { errors(validation); return; }
  generating = true;
  updateCloudControls();
  const format = exportFormat, formatLabel = format.toUpperCase();
  const button = $("generate-pdf"); button.disabled = true; button.querySelector("span").textContent = exportFile ? `Creating ${formatLabel}…` : "Saving…";
  const version = revision, snapshot = structuredClone(invoice), saveRecord = { id: recordId, revision: recordRevision, baseRevision, customerId, invoice: snapshot };
  const activeSheets = sheets, activeWorkbook = workbook, epoch = connectionEpoch;
  discardExport();
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
    if (!exportFile) {
      $('invoice-save-status').hidden = false;
      if (version !== revision) { $('invoice-save-status').textContent = 'Earlier details saved. Your latest changes still need saving.'; return; }
      $('invoice-save-status').textContent = `Saved to Sheet · ${snapshot.status === 'paid' ? 'Paid' : 'Unpaid'}`;
      persist(); return;
    }
    button.querySelector('span').textContent = `Creating ${formatLabel}…`;
    const { generateInvoicePdf, generateInvoiceJpg } = await import("./invoice-export.mjs");
    const blobs = format === 'jpg' ? await generateInvoiceJpg(snapshot) : [new Blob([await generateInvoicePdf(snapshot)], { type: 'application/pdf' })];
    if (epoch !== connectionEpoch) return;
    if (version !== revision) { errors([savedToSheet ? `Earlier details saved. Choose Save & ${formatLabel} again for your latest edits.` : `The details changed. Generate the ${formatLabel} again.`]); return; }
    const files = blobs.map((blob, index) => new File([blob], invoiceFilename(snapshot, format, blobs.length > 1 ? index + 1 : null), { type: blob.type }));
    generated = { files, format, invoice: snapshot };
    objectUrls = files.map(file => URL.createObjectURL(file));
    showExportPage();
    $("whatsapp-summary").value = invoiceSummary(snapshot);
    $("open-whatsapp").href = whatsappUrl(snapshot);
    $("result-description").textContent = `${snapshot.customer.name.trim()} · ${formatMoney(invoiceTotal(snapshot))} · ${(files.reduce((size, file) => size + file.size, 0) / 1024).toFixed(0)} KB · ${files.length > 1 ? `${files.length} JPG pages` : formatLabel}`;
    $('result-payment-status').textContent = snapshot.status === 'paid' ? 'Paid' : 'Unpaid';
    $('result-payment-status').className = `iv-small-badge iv-badge-${snapshot.status}`;
    $('sheet-save-status').textContent = savedToSheet ? 'Saved to your Google Sheet.' : `${formatLabel} only. This invoice has not been saved to Google Sheets.`;
    const canShare = supportsFileShare(files);
    $("share-pdf").querySelector("span").textContent = canShare ? `Share ${formatLabel}${files.length > 1 ? ' pages' : ''}` : `Download ${formatLabel} to share`;
    $("share-help").textContent = canShare
      ? 'Choose WhatsApp from the share menu.'
      : files.length > 1 ? 'Download each JPG page, then attach the images in WhatsApp.' : `Download the ${formatLabel}, then attach it in WhatsApp.`;
    showView('pdf');
    persist();
  } catch (error) {
    if (epoch !== connectionEpoch) return;
    if (error.name === 'SheetsError') cloudError(error);
    else errors([`The ${formatLabel} could not be created. Your draft is still here. If the Sheet save completed, it remains in invoice history. Please try again.`]);
  } finally {
    generating = false; button.disabled = false; button.querySelector("span").textContent = exportLabel(); updateCloudControls(); persist();
  }
}
form.addEventListener('submit', event => {
  event.preventDefault();
  return completeInvoice({ exportFile: event.submitter?.value !== 'save-only' });
});
$('export-format').addEventListener('change', () => {
  exportFormat = $('export-format').value === 'jpg' ? 'jpg' : 'pdf';
  discardExport(); updateCloudControls(); persist();
});
for (const [id, direction] of [['image-previous', -1], ['image-next', 1]]) $(id).addEventListener('click', () => showExportPage(exportPage + direction));
$('edit-invoice').addEventListener('click', () => showView('invoice'));
for (const name of ['invoice', 'history']) $(`${name}-tab`).addEventListener('click', () => showView(name));
document.querySelectorAll('[role=tab]').forEach((tab, index, tabs) => tab.addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + 1) % tabs.length;
  tabs[next].click(); tabs[next].focus();
}));
$('settings-button').addEventListener('click', () => showView(activeView === 'settings' ? previousView : 'settings'));
$('settings-done').addEventListener('click', () => showView(previousView));
document.addEventListener('invalid', event => {
  let details = event.target.closest('details');
  while (details) { details.open = true; details = details.parentElement.closest('details'); }
}, true);
$('new-customer').addEventListener('click', () => {
  if (customerMode === 'saved') {
    customerMode = 'new'; customerId = null; $('saved-customer').value = '';
    $('customer-name').value = ''; $('customer-phone').value = ''; changed();
  } else customerMode = 'saved';
  updateCustomerControls(); $('saved-customer-field').hidden ? $('customer-name').focus() : $('saved-customer').focus();
});

function supportsFileShare(files) {
  try { return !!(window.isSecureContext && navigator.share && navigator.canShare?.({ files })); } catch { return false; }
}
$("share-pdf").addEventListener("click", async () => {
  if (!generated || sharing) return;
  const { files, format } = generated, formatLabel = format.toUpperCase();
  if (!supportsFileShare(files)) {
    $("download-pdf").click();
    $("share-status").textContent = files.length > 1 ? 'Download each page, then attach all the JPG images in WhatsApp.' : `Save the ${formatLabel}, then tap Open WhatsApp and attach it to the message.`;
    return;
  }
  sharing = true; $("share-pdf").disabled = true;
  try {
    // File is prepared before this click, preserving the required user gesture.
    await navigator.share({ files, title: `Invoice ${generated.invoice.number}`, text: invoiceSummary(generated.invoice) });
    $("share-status").textContent = "Share menu closed. Check WhatsApp to confirm the invoice was sent.";
  } catch (error) {
    $("share-status").textContent = error.name === "AbortError"
      ? `Sharing cancelled. Your ${formatLabel} is still ready.`
      : `File sharing wasn’t available. Download the ${formatLabel}${files.length > 1 ? ' pages' : ''} and attach ${files.length > 1 ? 'them' : 'it'} in WhatsApp instead.`;
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
  let number;
  try { number = suggestedNumber(); } catch (error) { errors([error.message]); return; }
  if ((dirty || generated) && !window.confirm('Replace this invoice with a new one? Save it to Sheets first if you need to keep it.')) return;
  readForm(); const seller = { ...business };
  revision++; recordId = crypto.randomUUID(); baseRevision = null; recordRevision = crypto.randomUUID(); customerId = null; dirty = false; $('saved-customer').value = ''; discardExport(); errors(); invoice = newInvoice(seller, undefined, sheetDesign());
  if (number) invoice.number = number;
  automaticNumber = invoice.number; fillForm(); persist(); updateCloudControls();
  if (selectedCustomer) {
    const customer = workbook?.customers.find(customer => customer.id === selectedCustomer);
    if (customer) { customerId = customer.id; invoice.customer = { name: customer.name, phone: customer.phone, address: customer.address }; fillForm(); renderCloudRecords(); persist(); }
  }
  showView('invoice'); $('saved-customer-field').hidden ? $('customer-name').focus() : $('saved-customer').focus();
}
$('new-invoice').addEventListener('click', () => startInvoice());
$('history-new-invoice').addEventListener('click', () => startInvoice($('history-customer').value));
$("clear-device").addEventListener("click", () => {
  if (!window.confirm('Clear remembered invoices and defaults on this device and disconnect Google? Saved Google Sheets records will stay.')) return;
  disconnectAndClear(); showView('invoice');
});
window.addEventListener("pagehide", () => { readForm(); persist(); clearExportUrls(); });
window.addEventListener("pageshow", (event) => { if (event.persisted && generated) {
  objectUrls = generated.files.map(file => URL.createObjectURL(file)); showExportPage(exportPage);
} });
window.addEventListener('storage', event => {
  if (event.key === FORGET_KEY || event.key === null) { forgetMarker = stored(FORGET_KEY); disconnectAndClear(false); }
});
window.addEventListener('pageshow', () => {
  if (stored(FORGET_KEY) !== forgetMarker) disconnectAndClear(false);
});
fillBusinessForm(); fillForm(); renderSavedItems(); $("invoice-app").hidden = false; persist();

function resetWorkingData() {
  exportFormat = 'pdf'; $('export-format').value = exportFormat;
  cachedItems = []; cachedDesign = normalizeDesign(); cacheAccountId = null; recordWorkbookId = null;
  resetBusinessProfile(); invoice = newInvoice(); dirty = false; customerId = null;
  automaticNumber = invoice.number;
  recordId = crypto.randomUUID(); baseRevision = null; recordRevision = crypto.randomUUID(); revision++; discardExport(); fillForm();
}
function disconnectAndClear(broadcast = true) {
  connectionEpoch++; clearTimeout(expiryTimer); sheets?.disconnect(); sheets = null; workbook = null; googleUser = null; requiresSheetSave = false; googleBusy = false; restoringSession = false;
  const cleared = forgetDevice(undefined, broadcast); forgetMarker = stored(FORGET_KEY); resetWorkingData();
  $('sheet-setup').hidden = true; $('sheet-connected').hidden = true; $('existing-sheet').replaceChildren(new Option('Choose a workbook', ''));
  $('open-sheet').removeAttribute('href'); $('connected-sheet-name').textContent = ''; $('business-save-status').textContent = '';
  $('google-error').hidden = true; $('google-status').textContent = 'Disconnected. Remembered data has been cleared from this device. Your Sheet is unchanged.';
  $('google-session-status').hidden = true;
  renderCloudRecords(); persist();
  if (!cleared) $('device-storage-status').textContent = 'This browser could not clear remembered data. Clear this site’s storage in your browser settings.';
}

function updateCloudControls() {
  const canRestore = !!loadGoogleSession(googleConfig.clientId, forgetMarker);
  $('connect-google').disabled = (!tokenClient && !googleLoadFailed && !canRestore) || googleBusy || generating;
  $('connect-google').hidden = !!sheets;
  $('disconnect-google').hidden = !sheets && !googleUser;
  $('connection-options').hidden = !sheets && !googleUser;
  $('change-sheet').hidden = !workbook;
  const connectLabel = restoringSession ? 'Restoring Sheet…' : googleBusy ? 'Connecting…' : requiresSheetSave ? 'Reconnect' : 'Connect Google Sheet';
  $('connect-google').textContent = connectLabel;
  for (const button of document.querySelectorAll('[data-connect-sheet]')) {
    button.disabled = $('connect-google').disabled;
    button.textContent = connectLabel;
  }
  for (const id of ['create-sheet', 'refresh-sheet', 'change-sheet', 'save-business-defaults', 'setup-saved-items', 'setup-design', 'apply-design', 'disconnect-google']) $(id).disabled = googleBusy || generating;
  $('save-business-defaults').textContent = workbook?.seller.name.trim() ? 'Save business details' : 'Save & start invoicing';
  $('apply-design').hidden = !workbook || JSON.stringify(normalizeDesign(invoice.design)) === JSON.stringify(workbook.design);
  updateSavedItemControl();
  $('choose-sheet').disabled = !pickerReady || !sheets || googleBusy || generating;
  $('use-existing-sheet').disabled = !sheets || !$('existing-sheet').value || googleBusy || generating;
  $('generate-pdf').disabled = generating || (googleBusy && !!sheets);
  $('export-format').disabled = generating || sharing;
  if (!generating) $('generate-pdf').querySelector('span').textContent = exportLabel();
  $('save-invoice').disabled = generating || googleBusy || !workbook || !sheets;
  $('history-customer').disabled = !workbook || googleBusy || generating;
  document.querySelectorAll('[data-status]').forEach(button => button.disabled = !workbook || googleBusy || generating);
  for (const button of $('history-list').querySelectorAll('button')) button.disabled = googleBusy || generating;
  $('history-previous').disabled = googleBusy || generating || historyPage === 0;
  $('history-next').disabled = googleBusy || generating || historyPage >= Math.ceil(filteredHistory().length / 10) - 1;
  for (const id of ['new-invoice', 'history-new-invoice', 'new-customer', 'clear-device', 'saved-customer']) $(id).disabled = (googleBusy && !!sheets) || generating;
  $('connection-label').textContent = workbook ? 'Sheet connected' : restoringSession ? 'Restoring Sheet…' : googleBusy ? 'Connecting…' : sheets ? 'Choose a Sheet' : requiresSheetSave ? 'Reconnect Sheet' : 'Not connected';
  $('connection-status').dataset.connected = String(!!workbook);
  $('connect-hint').hidden = !!workbook;
  $('history-connect').hidden = !!workbook;
  $('connect-hint-text').textContent = requiresSheetSave ? 'Reconnect to the same Sheet. Your draft stays here.' : 'Keep your invoices in your own Sheet.';
  $('history-connect-text').textContent = requiresSheetSave ? 'Reconnect to load transactions from the same Sheet.' : 'Connect your Sheet to view transactions.';
}
function cloudError(error, { quiet = false, focus = true } = {}) {
  $('google-error').textContent = error.message || 'Google could not finish this action. Your draft is still here.';
  $('google-error').hidden = quiet;
  if (['expired', 'permission', 'privacy'].includes(error.code) && sheets) {
    clearGoogleSession(); $('google-session-status').hidden = true;
    const expired = error.code === 'expired';
    sheets.disconnect(); sheets = null; workbook = null; connectionEpoch++; clearTimeout(expiryTimer);
    googleBusy = false; restoringSession = false;
    if (!expired) { forgetDevice(); forgetMarker = stored(FORGET_KEY); googleUser = null; requiresSheetSave = false; resetWorkingData(); }
    renderCloudRecords(); $('sheet-setup').hidden = true; $('sheet-connected').hidden = true;
    $('open-sheet').removeAttribute('href'); $('connected-sheet-name').textContent = ''; $('business-save-status').textContent = '';
    $('google-status').textContent = expired ? 'Tap Reconnect to reopen the same Sheet. Your draft is remembered on this device.' : 'Sheet access is unavailable. Remembered data has been cleared. Connect again after checking sharing settings.';
  }
  updateCloudControls(); persist();
  if (!quiet && focus) { $('google-error').focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'instant' }); }
}
async function cloudAction(action) {
  if (googleBusy || generating) return;
  googleBusy = true; $('google-error').hidden = true; updateCloudControls();
  try { await action(); } catch (error) { cloudError(error); }
  finally { googleBusy = false; updateCloudControls(); persist(); }
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
  updateCustomerControls(); renderHistory(); renderSavedItems(); renderDesign();
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
  invoice = structuredClone(record.invoice); automaticNumber = null; invoice.status ||= 'unpaid'; recordId = record.id; recordRevision = record.revision; baseRevision = record.revision; customerId = record.customerId; dirty = false; revision++; discardExport(); errors(); fillForm(); renderCloudRecords(); persist(); showView('invoice');
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
      recordRevision = dirty ? crypto.randomUUID() : nextRevision; revision++; discardExport(); updateTotals(); persist();
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
  if (!workbook || workbook.id !== next.id) { revision++; discardExport(); }
  const changedWorkbook = recordWorkbookId !== next.id;
  recordWorkbookId = next.id;
  workbook = next; cachedItems = next.savedItems; cachedDesign = normalizeDesign(next.design); requiresSheetSave = true;
  if (!profileDirty || changedWorkbook) { business = normalizeSeller(next.seller); numberStart = next.numberStart; profileDirty = false; fillBusinessForm(); }
  if (next.numberingWarning) {
    updateNumberingWarning(next.numberingWarning); $('business-defaults').open = true; $('invoice-number-start').closest('details').open = true;
  }
  if (!business.name.trim()) $('business-defaults').open = true;
  if ((!dirty && !baseRevision) || changedWorkbook) { invoice.seller = { ...business }; fillForm(); }
  if ((!baseRevision || changedWorkbook) && JSON.stringify(invoice.design) !== JSON.stringify(next.design)) {
    invoice.design = normalizeDesign(next.design); revision++; recordRevision = crypto.randomUUID(); discardExport();
  }
  applyNumbering(next);
  $('sheet-setup').hidden = true; $('sheet-connected').hidden = false;
  $('connected-sheet-name').textContent = next.name;
  $('open-sheet').href = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(next.id)}/edit`;
  $('google-status').textContent = googleUser.email;
  try { localStorage.setItem(`sheetinvoice-sheet-${googleUser.id}`, next.id); } catch { /* Remembering a Sheet ID is optional. */ }
  renderCloudRecords(); $('generate-pdf').querySelector('span').textContent = exportLabel(); persist();
}
function finishSheetConnection(next) {
  useWorkbook(next);
  if (business.name.trim()) showView(previousView === 'history' ? 'history' : 'invoice');
  else { showView('settings'); $('business-defaults').open = true; $('seller-name').focus(); }
}
async function showSheetSetup() {
  const active = sheets, epoch = connectionEpoch;
  const files = await active.list();
  if (epoch !== connectionEpoch) return;
  $('existing-sheet').replaceChildren(new Option('Choose a workbook', ''));
  for (const file of files) $('existing-sheet').add(new Option(file.name, file.id));
  $('existing-sheet-options').open = files.length > 0;
  $('sheet-setup').hidden = false;
  $('google-status').textContent = `${googleUser.email} · Choose or create your invoice Sheet.`;
}
async function connected(token, restoring = false, interactive = false) {
  if (loginEpoch !== connectionEpoch) return;
  loginEpoch = null;
  if (!restoring) clearGoogleSession();
  const active = new InvoiceSheets(token), epoch = ++connectionEpoch;
  sheets?.disconnect(); sheets = active;
  googleBusy = true; $('google-error').hidden = true; updateCloudControls();
  try {
    const nextUser = await active.user();
    if (epoch !== connectionEpoch) return;
    const reconnecting = !!recordWorkbookId && nextUser.id === cacheAccountId;
    if (restoring && (nextUser.id !== token.accountId || (cacheAccountId && cacheAccountId !== nextUser.id))) {
      clearGoogleSession(); active.disconnect(); sheets = null; workbook = null; googleUser = null; renderCloudRecords();
      $('google-status').textContent = 'Connect your Google Sheet again to confirm the account. Your draft is still here.'; return;
    }
    if (cacheAccountId && cacheAccountId !== nextUser.id) {
      $('sheet-connected').hidden = true; $('sheet-setup').hidden = true;
      $('open-sheet').removeAttribute('href'); $('connected-sheet-name').textContent = '';
      if ((dirty || profileDirty) && !window.confirm('This is a different Google account. Clear the remembered draft and defaults, then switch accounts?')) {
        active.disconnect(); sheets = null; workbook = null; clearGoogleSession(); renderCloudRecords();
        $('google-status').textContent = 'Account switch cancelled. Your remembered draft is still on this device.'; return;
      }
      workbook = null; saveDevice(null); resetWorkingData(); renderCloudRecords();
    }
    googleUser = nextUser; cacheAccountId = nextUser.id;
    $('google-session-status').hidden = saveGoogleSession({ ...token, accountId: nextUser.id }, googleConfig.clientId, forgetMarker);
    clearTimeout(expiryTimer);
    expiryTimer = setTimeout(() => cloudError(Object.assign(new Error('Your Google connection expired. Reconnect to continue. Your draft is still here.'), { code: 'expired' }), { quiet: true }), Math.max(0, token.expiresAt - Date.now()));
    const previous = recordWorkbookId || stored(`sheetinvoice-sheet-${googleUser.id}`);
    if (previous) {
      const next = await active.load(previous);
      if (epoch === connectionEpoch) { if (reconnecting || (restoring && !interactive)) useWorkbook(next); else finishSheetConnection(next); }
    } else { showView('settings', !restoring); await showSheetSetup(); }
  } catch (error) {
    if (epoch === connectionEpoch) {
      if (!['expired', 'permission', 'privacy'].includes(error.code)) {
        active.disconnect(); sheets = null; workbook = null; googleUser = null; clearTimeout(expiryTimer); renderCloudRecords();
      }
      cloudError(error, { quiet: restoring && error.code === 'expired', focus: !restoring });
    }
  } finally {
    if (epoch === connectionEpoch) { googleBusy = false; restoringSession = false; updateCloudControls(); persist(); }
  }
}
function restoreGoogleConnection(interactive = false) {
  const session = loadGoogleSession(googleConfig.clientId, forgetMarker);
  if (!session) return false;
  if (cacheAccountId && session.accountId !== cacheAccountId) { clearGoogleSession(); return false; }
  restoringSession = true; loginEpoch = connectionEpoch;
  void connected(session, true, interactive);
  return true;
}
function connectSheet() {
  if (sheets) { showView('settings', false); $('sheet-setup').scrollIntoView({ block: 'nearest' }); return; }
  if (googleBusy) return;
  if (!recordWorkbookId) showView('settings', false);
  if (restoreGoogleConnection(true)) return;
  if (!tokenClient) { if (googleLoadFailed) initializeGoogle(); return; }
  googleBusy = true; $('google-error').hidden = true; updateCloudControls();
  loginEpoch = connectionEpoch;
  const accountId = googleUser?.id || cacheAccountId;
  try {
    tokenClient.requestAccessToken(accountId ? { prompt: '', login_hint: accountId } : { prompt: 'select_account' });
  } catch (error) { googleBusy = false; loginEpoch = null; cloudError(error); }
}
$('connect-google').addEventListener('click', connectSheet);
document.querySelectorAll('[data-connect-sheet]').forEach(button => button.addEventListener('click', connectSheet));
$('disconnect-google').addEventListener('click', () => {
  if ((dirty || profileDirty) && !window.confirm('Disconnect and clear remembered data on this device? Save your draft to Sheets first if you need to keep it.')) return;
  disconnectAndClear();
});
$('create-sheet-form').addEventListener('submit', event => { event.preventDefault(); cloudAction(async () => {
  readForm(); readBusinessForm(); const active = sheets, epoch = connectionEpoch;
  $('google-status').textContent = 'Creating your private invoice Sheet…';
  const next = await active.create($('sheet-name').value, business, numberStart);
  if (epoch === connectionEpoch) { finishSheetConnection(next); $('business-save-status').textContent = business.name.trim() ? '' : 'Add your business name, then start invoicing.'; }
}); });
$('existing-sheet').addEventListener('change', updateCloudControls);
$('use-existing-sheet').addEventListener('click', () => cloudAction(async () => { const epoch = connectionEpoch, next = await sheets.load($('existing-sheet').value); if (epoch === connectionEpoch) finishSheetConnection(next); }));
$('choose-sheet').addEventListener('click', () => cloudAction(async () => { const epoch = connectionEpoch, id = await chooseSheet(googleConfig, sheets.token); if (!id || epoch !== connectionEpoch) return; const next = await sheets.load(id); if (epoch === connectionEpoch) finishSheetConnection(next); }));
$('refresh-sheet').addEventListener('click', () => cloudAction(async () => { const epoch = connectionEpoch, next = await sheets.load(workbook.id); if (epoch === connectionEpoch) useWorkbook(next); }));
$('setup-saved-items').addEventListener('click', () => cloudAction(async () => {
  if (!workbook) return;
  const epoch = connectionEpoch, next = await sheets.setupSavedItems(workbook.id);
  if (epoch === connectionEpoch) useWorkbook(next);
}));
$('setup-design').addEventListener('click', () => cloudAction(async () => {
  if (!workbook) return;
  const epoch = connectionEpoch, next = await sheets.setupDesign(workbook.id);
  if (epoch === connectionEpoch) useWorkbook(next);
}));
$('apply-design').addEventListener('click', () => {
  if (!workbook || googleBusy || generating) return;
  readForm(); invoice.design = normalizeDesign(workbook.design);
  revision++; recordRevision = crypto.randomUUID(); dirty = true; discardExport(); persist(); updateCloudControls();
  $('design-status').textContent = 'Design applied to this invoice. Save it to keep the change.';
});
$('change-sheet').addEventListener('click', () => cloudAction(async () => {
  if ((dirty || profileDirty) && !window.confirm('Change Sheet and discard this unsaved draft?')) return;
  workbook = null; saveDevice(null); resetWorkingData(); requiresSheetSave = false; renderCloudRecords(); persist(); $('sheet-connected').hidden = true;
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
  if (!workbook || !sheets) { persist(); $('business-save-status').textContent = 'Remembered on this device. Connect a Sheet to sync your defaults.'; return; }
  const firstDetails = !workbook.seller.name.trim();
  const epoch = connectionEpoch, next = await sheets.saveSeller(workbook.id, business, numberStart);
  if (epoch === connectionEpoch) { workbook = next; profileDirty = false; applyNumbering(next); persist(); $('business-save-status').textContent = 'Business details saved to this Google Sheet.'; if (firstDetails) showView('invoice'); }
}); });
window.addEventListener('beforeunload', event => { if ((dirty || profileDirty) && !deviceSaved) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('focus', () => {
  if (!sheets || !workbook || checkingAccess || googleBusy || generating) return;
  const active = sheets, id = workbook.id, epoch = connectionEpoch;
  checkingAccess = true;
  // Access is also checked by every read/save. A background focus check must not swallow the next click.
  active.privateFile(id).catch(error => { if (epoch === connectionEpoch && sheets === active && workbook?.id === id) cloudError(error); }).finally(() => { checkingAccess = false; });
});
async function initializeGoogle() {
  googleLoadFailed = false; updateCloudControls();
  try {
    tokenClient = await prepareGoogle(googleConfig, connected, error => { googleBusy = false; cloudError(error); });
  } catch (error) {
    googleLoadFailed = error.code !== 'configuration';
    if (!googleUser) $('google-status').textContent = error.message;
  } finally { updateCloudControls(); }
}
initializeGoogle();
restoreGoogleConnection();
if (googleConfig.apiKey && googleConfig.appId) preparePicker(googleConfig).then(() => { pickerReady = true; updateCloudControls(); }).catch(cloudError);
