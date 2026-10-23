import {
  MAX_ITEMS, SELLER_FIELDS, newInvoice, normalizeSeller, sameSeller, validateSeller, invoiceTotal, lineTotal,
  formatMoney, displayDate, validateInvoice, invoiceSummary, whatsappUrl, invoiceFilename, priceInCents,
  nextInvoiceNumber, invoiceNumberStartError,
} from "./invoice.mjs";
import { InvoiceSheets, SAVED_ITEMS_TAB, DESIGN_TAB } from './invoice-sheets.mjs';
import { normalizeDesign } from './invoice-design.mjs';
import { prepareSignatureImage } from './invoice-signature.mjs';
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
let signatureBusy = false, signatureUpload = 0;
let cachedItems = remembered?.savedItems || [], cachedDesign = remembered?.design || normalizeDesign(), cacheAccountId = remembered?.accountId || null, deviceSaved = false;
let generated = null, objectUrls = [], previewUrls = [], exportPage = 0, revision = 0, generating = false, sharing = false;
let exportFormat = remembered?.exportFormat || 'pdf';
$('export-format').value = exportFormat;
let sheets = null, workbook = null, googleUser = null, tokenClient = null, googleBusy = false, googleLoadFailed = false;
let restoringSession = false;
let connectionEpoch = 0, loginEpoch = null, expiryTimer = null, dirty = remembered?.dirty || false;
let checkingAccess = false;
let recordId = remembered?.recordId || crypto.randomUUID(), recordRevision = remembered?.recordRevision || crypto.randomUUID(), customerId = remembered?.customerId || null, recordWorkbookId = remembered?.workbookId || null;
let baseRevision = remembered?.baseRevision || null, historyPage = 0, historyCount = 0;
let activeView = 'invoice', previousView = 'invoice', customerMode = 'new', historyStatus = 'all';
const paymentRetries = new Map(), deletionRetries = new Map();
let pendingDeletion = null, lastDeleted = null;
let editReturnRecord = null, resetUndo = null, pendingEdit = null;
const googleConfig = JSON.parse($('invoice-google-config').textContent);
const exportLabel = () => `${workbook ? 'Save &' : 'Generate'} ${exportFormat.toUpperCase()}`;
const savedItems = () => workbook?.savedItems ?? cachedItems;

const customerFields = ['name', 'phone', 'address'];
function fillBusinessForm() {
  signatureUpload++; signatureBusy = false;
  $('message-field-status').textContent = '';
  for (const [key, field] of Object.entries(SELLER_FIELDS)) $(field.id).value = business[key];
  $('signature-upload').value = ''; $('signature-status').textContent = ''; $('signature-error').hidden = true;
  renderSignature();
  $('invoice-number-start').value = numberStart;
  updateNumberingWarning();
}
function renderSignature() {
  $('signature-preview').hidden = !business.signatureImage;
  $('remove-signature').hidden = !business.signatureImage;
  if (business.signatureImage) $('signature-preview').src = business.signatureImage;
  else $('signature-preview').removeAttribute('src');
}
function readBusinessForm() {
  business = normalizeSeller(Object.fromEntries(Object.entries(SELLER_FIELDS).map(([key, field]) => [key, $(field.id).value])));
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
function businessChanged(event) {
  if (event.target.id === 'signature-upload') return;
  $('message-field-status').textContent = '';
  readBusinessForm(); profileDirty = true;
  if (event.target.id !== 'invoice-number-start') {
    const viewingInvoice = activeView === 'settings' && previousView === 'pdf' && generated;
    // Settings opened from a past invoice apply to that preview, preserving an unrelated draft.
    if (!viewingInvoice?.record) { invoice.seller = { ...business }; revision++; recordRevision = crypto.randomUUID(); dirty = true; }
    if (!viewingInvoice) discardExport();
    errors();
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
    const exportTab = generated?.record ? 'history' : 'invoice';
    const selected = name === view || (name === exportTab && view === 'pdf');
    $(`${name}-tab`).setAttribute('aria-selected', String(selected));
    $(`${name}-tab`).setAttribute('aria-controls', selected && view === 'pdf' ? 'pdf-result' : `${name}-panel`);
    const settingsReturn = view === 'settings' && name === (previousView === 'history' || (previousView === 'pdf' && exportTab === 'history') ? 'history' : 'invoice');
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
  $('customer-label').textContent = saved ? 'Choose a customer' : 'Customer name';
  $('customer-mode').hidden = !hasCustomers;
  document.querySelectorAll('[data-customer-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.customerMode === customerMode)));
}
function fillForm() {
  for (const field of customerFields) $(`customer-${field}`).value = invoice.customer[field];
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
  for (const field of customerFields) invoice.customer[field] = $(`customer-${field}`).value;
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
  if (workbook) { cachedItems = workbook.savedItems; cachedDesign = workbook.design; }
  const hasData = exportFormat !== 'pdf' || dirty || profileDirty || recordWorkbookId || Object.entries(business).some(([key, value]) => !SELLER_FIELDS[key].isLabel && value.trim()) || cachedItems.length || Object.values(invoice.customer).some(value => value.trim()) || invoice.items.some(item => !isBlankItem(item)) || invoice.notes.trim();
  deviceSaved = saveDevice(hasData ? { invoice, business, exportFormat, numberStart, automaticNumber, design: cachedDesign, savedItems: cachedItems, accountId: cacheAccountId, workbookId: recordWorkbookId,
    recordId, recordRevision, baseRevision, customerId, dirty, profileDirty } : null);
  $('device-storage-status').textContent = deviceSaved ? '' : 'This browser could not save on this device. Keep the tab open or save to Google Sheets.';
  $('draft-status').textContent = dirty ? (deviceSaved ? 'Saved on device' : 'Unsaved changes') : '';
  $('draft-status').hidden = !dirty;
  $('invoice-heading').textContent = baseRevision ? 'Edit invoice' : 'New invoice';
  $('close-edit').hidden = !baseRevision; $('new-invoice').hidden = !!baseRevision;
  $('reset-feedback').hidden = !resetUndo;
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
  for (const url of new Set([...objectUrls, ...previewUrls])) URL.revokeObjectURL(url);
  objectUrls = []; previewUrls = []; $('invoice-image').removeAttribute('src');
}
function createExportUrls() {
  clearExportUrls();
  objectUrls = generated.files.map(file => URL.createObjectURL(file));
  previewUrls = generated.format === 'jpg' ? objectUrls : generated.previews.map(blob => URL.createObjectURL(blob));
}
function showExportPage(index = 0) {
  if (!generated) return;
  const pages = generated.previews.length, image = generated.format === 'jpg';
  exportPage = Math.max(0, Math.min(index, pages - 1));
  const file = generated.files[image ? exportPage : 0], url = objectUrls[image ? exportPage : 0];
  $('download-pdf').href = url; $('download-pdf').download = file.name;
  $('download-pdf').querySelector('span').textContent = generated.files.length > 1 ? `Save page ${exportPage + 1} as JPG` : `Save as ${generated.format.toUpperCase()}`;
  $('result-filename').textContent = file.name;
  $('invoice-image').hidden = !pages; $('preview-unavailable').hidden = !!pages;
  if (pages) { $('invoice-image').src = previewUrls[exportPage]; $('invoice-image').alt = `Invoice ${generated.invoice.number}, page ${exportPage + 1} of ${pages}`; }
  $('image-page-controls').hidden = pages < 2;
  $('image-page').textContent = `Page ${exportPage + 1} of ${pages}`;
  $('image-previous').disabled = exportPage === 0; $('image-next').disabled = exportPage >= pages - 1;
}
function discardExport() {
  const returnView = generated?.record ? 'history' : 'invoice';
  generated = null;
  clearExportUrls(); exportPage = 0;
  $('invoice-image').hidden = true; $('image-page-controls').hidden = true;
  $("pdf-result").hidden = true;
  $("share-status").textContent = "";
  for (const id of ["download-pdf", "open-whatsapp"]) $(id).removeAttribute("href");
  $("whatsapp-summary").value = "";
  $('sheet-save-status').textContent = '';
  $('invoice-save-status').textContent = '';
  $('invoice-save-status').hidden = true;
  $('result-error').hidden = true; $('result-format-status').textContent = '';
  if (activeView === 'pdf') showView(returnView, false);
  if (!generating) $("generate-pdf").querySelector("span").textContent = exportLabel();
}
async function invoiceFiles(snapshot, format, cachedPreviews) {
  const { generateInvoicePdf, generateInvoiceJpg } = await import('./invoice-export.mjs');
  let previews = cachedPreviews?.length ? cachedPreviews : null;
  if (!previews) {
    try { previews = await generateInvoiceJpg(snapshot); }
    catch (error) { if (format === 'jpg') throw error; previews = []; }
  }
  const blobs = format === 'jpg' ? previews : [new Blob([await generateInvoicePdf(snapshot)], { type: 'application/pdf' })];
  const files = blobs.map((blob, index) => new File([blob], invoiceFilename(snapshot, format, blobs.length > 1 ? index + 1 : null), { type: blob.type }));
  return { files, previews };
}
function displayExport(result) {
  const filesChanged = generated?.files !== result.files || generated?.previews !== result.previews;
  generated = result;
  const { files, previews, format, invoice: snapshot, record, savedToSheet } = result, formatLabel = format.toUpperCase();
  if (filesChanged || !objectUrls.length) createExportUrls();
  showExportPage();
  $('result-heading').textContent = record ? `Invoice ${snapshot.number}` : 'Invoice ready';
  $('result-back').textContent = record ? 'Back to transactions' : 'Back to invoice';
  $('edit-invoice').hidden = !record;
  $('result-error').hidden = true; $('result-format-status').textContent = ''; $('share-status').textContent = '';
  document.querySelectorAll('[data-export-format]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.exportFormat === format)));
  $('whatsapp-summary').value = invoiceSummary(snapshot);
  $('open-whatsapp').href = whatsappUrl(snapshot);
  $('result-description').textContent = `${snapshot.customer.name.trim()} · ${displayDate(snapshot.date)} · ${formatMoney(invoiceTotal(snapshot))} · ${(files.reduce((size, file) => size + file.size, 0) / 1024).toFixed(0)} KB · ${formatLabel}${previews.length > 1 ? ` · ${previews.length} pages` : ''}`;
  $('result-payment-status').textContent = snapshot.status === 'paid' ? 'Paid' : 'Unpaid';
  $('result-payment-status').className = `iv-small-badge iv-badge-${snapshot.status}`;
  $('sheet-save-status').textContent = record ? '' : savedToSheet ? 'Saved to your Google Sheet.' : `${formatLabel} only. This invoice has not been saved to Google Sheets.`;
  $('sheet-save-status').hidden = !!record;
  const canShare = supportsFileShare(files);
  $('share-pdf').querySelector('span').textContent = canShare ? `Share ${formatLabel}${files.length > 1 ? ' pages' : ''}` : `Download ${formatLabel} to share`;
  $('share-help').textContent = canShare ? 'Choose WhatsApp from the share menu.'
    : files.length > 1 ? 'Download each JPG page, then attach the images in WhatsApp.' : `Download the ${formatLabel}, then attach it in WhatsApp.`;
}
async function refreshBusiness() {
  if (!sheets || !workbook) return;
  const active = sheets, id = workbook.id, epoch = connectionEpoch;
  const next = await active.load(id);
  if (epoch !== connectionEpoch || sheets !== active) throw new Error('Google connection changed. Try again.');
  useWorkbook(next, { businessOnly: true });
}
const currentBusinessInvoice = snapshot => ({ ...structuredClone(snapshot), seller: { ...business } });
async function renderCurrentExport(source, epoch, format = source.format) {
  if (epoch !== connectionEpoch || generated !== source) return false;
  const snapshot = currentBusinessInvoice(source.invoice), profileChanged = !sameSeller(snapshot.seller, source.invoice.seller);
  if (profileChanged || format !== source.format) {
    const appearanceChanged = !sameSeller(snapshot.seller, source.invoice.seller, { printedOnly: true });
    const output = appearanceChanged || format !== source.format
      ? await invoiceFiles(snapshot, format, appearanceChanged ? null : source.previews) : {};
    if (epoch !== connectionEpoch || generated !== source) return false;
    displayExport({ ...source, ...output, format, invoice: snapshot });
  }
  return true;
}
async function finishSettings() {
  if (generating || signatureBusy || googleBusy) return;
  if (previousView !== 'pdf' || !generated) showView(previousView);
  else if (await refreshExport()) showView('pdf');
}
function changed(event) {
  if (['export-format', 'saved-customer'].includes(event?.target?.id)) return;
  resetUndo = null;
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
    for (const key of ['description', 'quantity', 'price']) {
      const input = row.querySelector(`.item-${key}`);
      input.id = `item-${key}-${index}`; input.name = `items[${index}][${key}]`; input.value = item[key];
      input.setAttribute('aria-label', `${key} for item ${index + 1}`);
      row.querySelector(`.${key}-label`).htmlFor = input.id;
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
function renderOptionalTab(title, prefix, sectionId, warning) {
  $(sectionId).hidden = !workbook;
  const tab = workbook?.tabs[title], exists = Number.isInteger(tab), link = $(`edit-${prefix}`);
  $(`setup-${prefix}`).hidden = exists; link.hidden = !exists; link.removeAttribute('href');
  if (exists) link.href = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(workbook.id)}/edit#gid=${tab}`;
  $(`${prefix}-warning`).textContent = warning || '';
  $(`${prefix}-warning`).hidden = !warning;
  if (warning) $(sectionId).open = true;
}
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
  renderOptionalTab(SAVED_ITEMS_TAB, 'saved-items', 'saved-items-settings', workbook?.savedItemsWarning);
  $('saved-items-status').textContent = workbook ? `${items.length} saved item${items.length === 1 ? '' : 's'} available.` : '';
  updateSavedItemControl();
}

form.addEventListener("input", changed);
$('business-form').addEventListener('input', businessChanged);
$('upload-signature').addEventListener('click', () => $('signature-upload').click());
$('signature-upload').addEventListener('change', async () => {
  const input = $('signature-upload'), file = input.files[0];
  if (!file || signatureBusy || generating || googleBusy) return;
  const request = ++signatureUpload, epoch = connectionEpoch;
  signatureBusy = true; updateCloudControls(); $('signature-error').hidden = true;
  $('signature-status').textContent = 'Preparing image…';
  try {
    const image = await prepareSignatureImage(file);
    if (request !== signatureUpload || epoch !== connectionEpoch) return;
    $('seller-signature-image').value = image;
    businessChanged({ target: $('seller-signature-image') }); renderSignature();
    $('signature-status').textContent = workbook ? 'Image ready. Save business details to keep it in your Sheet.' : 'Image remembered on this device. Connect a Sheet to save it there.';
  } catch (error) {
    if (request !== signatureUpload || epoch !== connectionEpoch) return;
    $('signature-status').textContent = ''; $('signature-error').textContent = error.message; $('signature-error').hidden = false;
  } finally {
    if (request === signatureUpload) { signatureBusy = false; input.value = ''; updateCloudControls(); }
  }
});
$('remove-signature').addEventListener('click', () => {
  if (signatureBusy || generating || googleBusy) return;
  $('seller-signature-image').value = '';
  businessChanged({ target: $('seller-signature-image') }); renderSignature();
  $('signature-error').hidden = true; $('signature-status').textContent = 'Image removed. Save business details to update your Sheet. Initials will be used if filled in.';
});
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
  if (generating || signatureBusy || (googleBusy && sheets)) return;
  $('google-error').hidden = true;
  if (!exportFile && !workbook) return;
  readForm(); errors();
  const epoch = connectionEpoch, format = exportFormat, formatLabel = format.toUpperCase(), button = $('generate-pdf');
  let snapshot;
  generating = true; updateCloudControls();
  try {
    await refreshBusiness();
    if (epoch !== connectionEpoch) return;
    if (!sameSeller(invoice.seller, business)) {
      invoice.seller = { ...business }; revision++; recordRevision = crypto.randomUUID(); dirty = true;
    }
    if (!invoice.seller.name.trim()) {
      showView('settings'); $('business-defaults').open = true;
      $('business-save-status').textContent = 'Enter your business name for this invoice.';
      $('seller-name').focus(); return;
    }
    const validation = validateInvoice(invoice);
    if (validation.length) { errors(validation); return; }
    const version = revision;
    snapshot = structuredClone(invoice);
    const saveRecord = { id: recordId, revision: recordRevision, baseRevision, customerId, invoice: snapshot };
    discardExport();
    let savedToSheet = false;
    if (sheets && workbook) {
      button.querySelector('span').textContent = 'Saving…';
      const saved = await sheets.save(workbook.id, saveRecord);
      if (epoch !== connectionEpoch) return;
      workbook = saved.workbook; savedToSheet = true;
      if (recordId === saveRecord.id) baseRevision = saveRecord.revision;
      if (version === revision) { customerId = saved.customerId; dirty = false; resetUndo = null; }
      renderCloudRecords();
    }
    if (!exportFile) {
      $('invoice-save-status').hidden = false;
      if (version !== revision) { $('invoice-save-status').textContent = 'Earlier details saved. Your latest changes still need saving.'; return; }
      $('invoice-save-status').textContent = `Saved to Sheet · ${snapshot.status === 'paid' ? 'Paid' : 'Unpaid'}`;
      return;
    }
    button.querySelector('span').textContent = `Creating ${formatLabel}…`;
    const output = await invoiceFiles(snapshot, format);
    if (epoch !== connectionEpoch) return;
    if (version !== revision) { errors([savedToSheet ? `Earlier details saved. Choose Save & ${formatLabel} again for your latest edits.` : `The details changed. Generate the ${formatLabel} again.`]); return; }
    displayExport({ ...output, format, invoice: snapshot, savedToSheet });
    showView('pdf');
  } catch (error) {
    if (epoch !== connectionEpoch) return;
    if (error.name === 'SheetsError' || !snapshot) cloudError(error);
    else errors([`The ${formatLabel} could not be created. Your draft is still here. If the Sheet save completed, it remains in invoice history. Please try again.`]);
  } finally {
    generating = false; updateCloudControls(); persist();
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
$('result-back').addEventListener('click', () => showView(generated?.record ? 'history' : 'invoice'));
$('edit-invoice').addEventListener('click', () => { if (generated?.record) editRecord(generated.record, { returnToPreview: true }); });
document.querySelectorAll('[data-export-format]').forEach(button => button.addEventListener('click', () => {
  if (generated?.format !== button.dataset.exportFormat) refreshExport(button.dataset.exportFormat);
}));
async function refreshExport(format = generated?.format) {
  if (!generated || generating || sharing || googleBusy || signatureBusy) return;
  const source = generated, epoch = connectionEpoch;
  generating = true; updateCloudControls(); $('result-error').hidden = true;
  $('result-format-status').textContent = `Creating ${format.toUpperCase()}…`;
  try {
    // Switching file format only renders the snapshot; it never saves or edits a Sheet record.
    await refreshBusiness();
    if (!await renderCurrentExport(source, epoch, format)) return;
    exportFormat = format; $('export-format').value = format;
    return true;
  } catch (error) {
    if (epoch !== connectionEpoch || generated !== source) return;
    if (error.name === 'SheetsError' || activeView === 'settings') { cloudError(error); return; }
    $('result-error').textContent = `The ${format.toUpperCase()} could not be created. Your ${source.format.toUpperCase()} is still available. Try again.`;
    $('result-error').hidden = false;
  } finally {
    generating = false; $('result-format-status').textContent = ''; updateCloudControls(); persist();
  }
}
for (const name of ['invoice', 'history']) $(`${name}-tab`).addEventListener('click', () => showView(name));
document.querySelectorAll('[role=tab]').forEach((tab, index, tabs) => tab.addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + 1) % tabs.length;
  tabs[next].click(); tabs[next].focus();
}));
$('settings-button').addEventListener('click', () => activeView === 'settings' ? finishSettings() : showView('settings'));
$('settings-done').addEventListener('click', finishSettings);
document.addEventListener('invalid', event => {
  let details = event.target.closest('details');
  while (details) { details.open = true; details = details.parentElement.closest('details'); }
}, true);
document.querySelectorAll('[data-customer-mode]').forEach(button => button.addEventListener('click', () => {
  if (customerMode === button.dataset.customerMode) return;
  customerMode = button.dataset.customerMode;
  if (customerMode === 'new' && customerId) {
    customerId = null; $('saved-customer').value = '';
    $('customer-name').value = ''; $('customer-phone').value = ''; changed();
  }
  updateCustomerControls();
}));

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
  sharing = true; updateCloudControls();
  try {
    // File is prepared before this click, preserving the required user gesture.
    await navigator.share({ files, title: `Invoice ${generated.invoice.number}`, text: invoiceSummary(generated.invoice) });
    $("share-status").textContent = "Share menu closed. Check WhatsApp to confirm the invoice was sent.";
  } catch (error) {
    $("share-status").textContent = error.name === "AbortError"
      ? `Sharing cancelled. Your ${formatLabel} is still ready.`
      : `File sharing wasn’t available. Download the ${formatLabel}${files.length > 1 ? ' pages' : ''} and attach ${files.length > 1 ? 'them' : 'it'} in WhatsApp instead.`;
  } finally { sharing = false; updateCloudControls(); }
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
function startInvoice(selectedCustomer, { offerUndo = true, navigate = true, focus = true } = {}) {
  let number;
  try { number = suggestedNumber(); } catch (error) { if (navigate) { errors([error.message]); return; } }
  readForm();
  resetUndo = offerUndo ? (dirty || baseRevision || (generated && !generated.record) ? structuredClone({ invoice, automaticNumber, recordId, recordRevision, baseRevision, customerId, dirty, recordWorkbookId, editReturnRecord }) : resetUndo) : null;
  editReturnRecord = null;
  $('history-feedback').textContent = ''; $('history-feedback').hidden = true;
  revision++; recordId = crypto.randomUUID(); baseRevision = null; recordRevision = crypto.randomUUID(); customerId = null; dirty = false; $('saved-customer').value = ''; discardExport(); errors(); invoice = newInvoice(business, undefined, workbook?.design ?? cachedDesign);
  if (number) invoice.number = number;
  automaticNumber = invoice.number; fillForm(); persist(); updateCloudControls();
  if (selectedCustomer) {
    const customer = workbook?.customers.find(customer => customer.id === selectedCustomer);
    if (customer) { customerId = customer.id; invoice.customer = { name: customer.name, phone: customer.phone, address: customer.address }; fillForm(); renderCloudRecords(); persist(); }
  }
  if (navigate) showView('invoice', focus);
}
$('new-invoice').addEventListener('click', () => startInvoice(undefined, { focus: false }));
$('undo-reset').addEventListener('click', () => {
  if (!resetUndo || googleBusy || generating) return;
  ({ invoice, automaticNumber, recordId, recordRevision, baseRevision, customerId, dirty, recordWorkbookId, editReturnRecord } = resetUndo);
  resetUndo = null; invoice.seller = { ...business }; revision++;
  discardExport(); errors(); fillForm(); renderCloudRecords(); persist(); showView('invoice');
});
$('close-edit').addEventListener('click', async () => {
  if (googleBusy || generating || sharing) return;
  const returnRecord = editReturnRecord;
  // Closing ends the edit. The Invoice tab must no longer contain that saved transaction.
  startInvoice(undefined, { offerUndo: false, navigate: false });
  showView('history');
  if (returnRecord && workbook?.invoices.some(record => record.id === returnRecord.id)) await openRecord(returnRecord);
});
$('history-new-invoice').addEventListener('click', () => startInvoice($('history-customer').value));
$("clear-device").addEventListener("click", () => {
  if (!window.confirm('Clear remembered invoices and defaults on this device and disconnect Google? Saved Google Sheets records will stay.')) return;
  disconnectAndClear(); showView('invoice');
});
window.addEventListener("pagehide", () => { readForm(); persist(); clearExportUrls(); });
window.addEventListener('storage', event => {
  if (event.key === FORGET_KEY || event.key === null) { forgetMarker = stored(FORGET_KEY); disconnectAndClear(false); }
});
window.addEventListener('pageshow', event => {
  if (stored(FORGET_KEY) !== forgetMarker) disconnectAndClear(false);
  if (event.persisted && generated) { createExportUrls(); showExportPage(exportPage); }
});
fillBusinessForm(); fillForm(); renderSavedItems(); $("invoice-app").hidden = false; persist();

function resetWorkingData() {
  editReturnRecord = null; resetUndo = null;
  exportFormat = 'pdf'; $('export-format').value = exportFormat;
  cachedItems = []; cachedDesign = normalizeDesign(); cacheAccountId = null; recordWorkbookId = null;
  business = normalizeSeller(); numberStart = ''; profileDirty = false; fillBusinessForm();
  invoice = newInvoice(); dirty = false; customerId = null;
  automaticNumber = invoice.number;
  recordId = crypto.randomUUID(); baseRevision = null; recordRevision = crypto.randomUUID(); revision++; discardExport(); fillForm();
}
function disconnectGoogle() {
  connectionEpoch++; clearTimeout(expiryTimer); sheets?.disconnect(); sheets = null; workbook = null; googleBusy = false; restoringSession = false;
  clearGoogleSession(); $('google-session-status').hidden = true;
  $('sheet-setup').hidden = true; $('sheet-connected').hidden = true;
  $('open-sheet').removeAttribute('href'); $('connected-sheet-name').textContent = ''; $('business-save-status').textContent = '';
}
function disconnectAndClear(broadcast = true) {
  disconnectGoogle(); googleUser = null;
  const cleared = forgetDevice(undefined, broadcast); forgetMarker = stored(FORGET_KEY); resetWorkingData();
  $('existing-sheet').replaceChildren(new Option('Choose a workbook', ''));
  $('google-error').hidden = true; $('google-status').textContent = 'Disconnected. Remembered data has been cleared from this device. Your Sheet is unchanged.';
  renderCloudRecords(); persist();
  if (!cleared) $('device-storage-status').textContent = 'This browser could not clear remembered data. Clear this site’s storage in your browser settings.';
}

function updateCloudControls() {
  const cloudBusy = googleBusy || generating, draftBusy = (googleBusy && !!sheets) || generating;
  const exportBusy = cloudBusy || sharing, imageBusy = cloudBusy || signatureBusy;
  const canRestore = !sheets && !!loadGoogleSession(googleConfig.clientId, forgetMarker);
  $('connect-google').disabled = (!tokenClient && !googleLoadFailed && !canRestore) || cloudBusy;
  $('connect-google').hidden = !!sheets;
  $('disconnect-google').disabled = (!sheets && !googleUser) || cloudBusy;
  $('change-sheet').disabled = !workbook || cloudBusy;
  const connectLabel = restoringSession ? 'Restoring Sheet…' : googleBusy ? 'Connecting…' : recordWorkbookId ? 'Reconnect' : 'Connect Google Sheet';
  $('connect-google').textContent = connectLabel;
  for (const button of document.querySelectorAll('[data-connect-sheet]')) {
    button.disabled = $('connect-google').disabled;
    button.textContent = connectLabel;
  }
  for (const id of ['create-sheet', 'refresh-sheet', 'save-business-defaults', 'setup-saved-items', 'setup-design', 'apply-design']) $(id).disabled = cloudBusy;
  $('save-business-defaults').disabled ||= signatureBusy;
  for (const id of ['upload-signature', 'remove-signature']) $(id).disabled = imageBusy;
  for (const button of document.querySelectorAll('[data-message-field]')) button.disabled = cloudBusy;
  $('settings-done').disabled = signatureBusy || generating;
  $('save-business-defaults').textContent = workbook?.seller.name.trim() ? 'Save business details' : 'Save & start invoicing';
  $('apply-design').hidden = !workbook || JSON.stringify(normalizeDesign(invoice.design)) === JSON.stringify(workbook.design);
  updateSavedItemControl();
  $('choose-sheet').disabled = !googleConfig.apiKey || !googleConfig.appId || !sheets || cloudBusy;
  $('use-existing-sheet').disabled = !sheets || !$('existing-sheet').value || cloudBusy;
  $('generate-pdf').disabled = draftBusy || signatureBusy;
  $('export-format').disabled = generating || sharing;
  for (const button of document.querySelectorAll('[data-export-format]')) button.disabled = exportBusy;
  $('edit-invoice').disabled = exportBusy;
  $('close-edit').disabled = exportBusy;
  $('undo-reset').disabled = cloudBusy;
  $('share-pdf').disabled = generating || sharing;
  if (!generating) $('generate-pdf').querySelector('span').textContent = exportLabel();
  $('save-invoice').disabled = imageBusy || !workbook || !sheets;
  $('undo-delete').disabled = cloudBusy;
  $('history-customer').disabled = !workbook || cloudBusy;
  document.querySelectorAll('[data-status]').forEach(button => button.disabled = !workbook || cloudBusy);
  for (const button of $('history-list').querySelectorAll('button')) button.disabled = cloudBusy;
  $('history-previous').disabled = cloudBusy || historyPage === 0;
  $('history-next').disabled = cloudBusy || historyPage >= Math.ceil(historyCount / 10) - 1;
  for (const control of [$('new-invoice'), $('history-new-invoice'), $('clear-device'), $('saved-customer'), ...document.querySelectorAll('[data-customer-mode]')]) control.disabled = draftBusy;
  $('connection-label').textContent = workbook ? 'Sheet connected' : restoringSession ? 'Restoring Sheet…' : googleBusy ? 'Connecting…' : sheets ? 'Choose a Sheet' : recordWorkbookId ? 'Reconnect Sheet' : 'Not connected';
  $('connection-status').dataset.connected = String(!!workbook);
  $('connect-hint').hidden = !!workbook;
  $('history-connect').hidden = !!workbook;
  $('connect-hint-text').textContent = recordWorkbookId ? 'Reconnect to the same Sheet. Your draft stays here.' : 'Keep your invoices in your own Sheet.';
  $('history-connect-text').textContent = recordWorkbookId ? 'Reconnect to load transactions from the same Sheet.' : 'Connect your Sheet to view transactions.';
}
function cloudError(error, { quiet = false, focus = true } = {}) {
  $('google-error').textContent = error.message || 'Google could not finish this action. Your draft is still here.';
  $('google-error').hidden = quiet;
  if (['expired', 'permission', 'privacy'].includes(error.code) && sheets) {
    const expired = error.code === 'expired';
    disconnectGoogle();
    if (generated?.record) discardExport();
    if (!expired) { forgetDevice(); forgetMarker = stored(FORGET_KEY); googleUser = null; resetWorkingData(); }
    renderCloudRecords();
    $('google-status').textContent = expired ? 'Tap Reconnect to reopen the same Sheet. Your draft is remembered on this device.' : 'Sheet access is unavailable. Remembered data has been cleared. Connect again after checking sharing settings.';
  }
  updateCloudControls(); persist();
  if (!quiet && focus) { $('google-error').focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'instant' }); }
}
async function cloudAction(action) {
  if (googleBusy || generating || signatureBusy) return;
  const epoch = connectionEpoch;
  googleBusy = true; $('google-error').hidden = true; updateCloudControls();
  try { await action(); } catch (error) { if (epoch === connectionEpoch) cloudError(error); }
  finally { if (epoch === connectionEpoch) { googleBusy = false; updateCloudControls(); persist(); } }
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
    historyStatus = 'all'; historyPage = 0; paymentRetries.clear(); deletionRetries.clear(); lastDeleted = null;
    pendingDeletion = null; $('delete-transaction').close();
    pendingEdit = null; $('replace-draft').close();
    $('history-feedback').textContent = ''; $('history-feedback').hidden = true;
  }
  $('undo-delete').hidden = !lastDeleted || lastDeleted.workbookId !== workbook?.id;
  updateCustomerControls(); renderHistory(); renderSavedItems();
  renderOptionalTab(DESIGN_TAB, 'design', 'design-settings', workbook?.designWarning);
  $('design-status').textContent = '';
  $('history-count').textContent = workbook ? String(workbook.invoices.length) : '';
  $('history-count').hidden = !workbook;
  $('save-business-defaults').hidden = !workbook;
  updateCloudControls();
}
function renderHistory() {
  const customer = $('history-customer').value, list = $('history-list');
  const records = (workbook?.invoices || []).filter(record => (!customer || record.customerId === customer)
    && (historyStatus === 'all' || record.invoice.status === historyStatus));
  list.replaceChildren(); historyCount = records.length;
  historyPage = Math.min(historyPage, Math.max(0, Math.ceil(records.length / 10) - 1));
  $('history-empty').hidden = !workbook || records.length > 0;
  $('history-empty').textContent = workbook?.invoices.length ? 'No transactions for this selection.' : 'No saved invoices yet.';
  $('history-head').hidden = !records.length;
  $('history-summary').hidden = !workbook;
  const unpaid = records.reduce((sum, record) => sum + (record.invoice.status === 'paid' ? 0 : invoiceTotal(record.invoice)), 0);
  $('history-summary').textContent = `${records.length} ${records.length === 1 ? 'invoice' : 'invoices'} · ${formatMoney(unpaid)} unpaid`;
  document.querySelectorAll('[data-status]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.status === historyStatus)));
  for (const record of records.slice(historyPage * 10, historyPage * 10 + 10)) {
    const saved = record.invoice, paid = saved.status === 'paid';
    const row = $('history-row-template').content.firstElementChild.cloneNode(true);
    row.dataset.recordId = record.id; row.dataset.revision = record.revision;
    for (const [field, value] of Object.entries({ number: saved.number, date: displayDate(saved.date), customer: saved.customer.name,
      service: saved.items.map(item => item.description).join(', '), amount: formatMoney(invoiceTotal(saved)) })) row.querySelector(`[data-field="${field}"]`).textContent = value;
    const badge = row.querySelector('[data-field="status"]');
    badge.className = `iv-small-badge iv-badge-${paid ? 'paid' : 'unpaid'}`; badge.textContent = paid ? 'Paid' : 'Unpaid';
    for (const [action, label] of [['open', 'Open'], ['edit', 'Edit'], ['pay', 'Mark paid:'], ['delete', 'Delete']]) {
      const button = row.querySelector(`[data-action="${action}"]`);
      button.title = `${label} invoice ${saved.number} for ${saved.customer.name}`; button.setAttribute('aria-label', button.title);
    }
    row.querySelector('[data-action="pay"]').hidden = paid;
    list.append(row);
  }
  $('history-pagination').hidden = records.length <= 10;
  $('history-page').textContent = records.length ? `${historyPage * 10 + 1}–${Math.min((historyPage + 1) * 10, records.length)} of ${records.length}` : '';
}
$('history-list').addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  if (!button || googleBusy || generating || sharing) return;
  const row = button.closest('[data-record-id]'), record = workbook?.invoices.find(record => record.id === row.dataset.recordId);
  if (!record || record.revision !== row.dataset.revision) {
    renderCloudRecords();
    cloudError(new Error('This transaction changed on another device. The list has been refreshed. Review it and try again.'));
    return;
  }
  if (button.dataset.action === 'open') return openRecord(record);
  if (button.dataset.action === 'edit') return openRecord(record, { edit: true });
  if (button.dataset.action === 'pay') return markRecordPaid(record);
  if (button.dataset.action !== 'delete') return;
  pendingDeletion = { record, workbookId: workbook.id };
  $('delete-transaction-description').textContent = `Delete invoice ${record.invoice.number} for ${record.invoice.customer.name} (${formatMoney(invoiceTotal(record.invoice))}) from your transactions? Customer details stay saved. You can undo this deletion here.`;
  $('delete-transaction').showModal();
});
async function openRecord(record, { edit = false } = {}) {
  if (googleBusy || generating || sharing) return;
  const epoch = connectionEpoch, format = exportFormat, returnView = activeView;
  generating = true; updateCloudControls();
  $('google-error').hidden = true;
  $('history-feedback').textContent = `Opening invoice ${record.invoice.number}…`; $('history-feedback').hidden = false;
  try {
    await refreshBusiness();
    if (epoch !== connectionEpoch || activeView !== returnView) return;
    record = workbook.invoices.find(current => current.id === record.id);
    if (!record) throw new Error('This transaction was deleted. Your records have been refreshed.');
    if (edit) { generating = false; editRecord(record); return; }
    const snapshot = currentBusinessInvoice(record.invoice);
    const output = await invoiceFiles(snapshot, format);
    if (epoch !== connectionEpoch || activeView !== returnView) return;
    displayExport({ ...output, format, invoice: snapshot, record, savedToSheet: true });
    showView('pdf');
  } catch (error) {
    if (epoch !== connectionEpoch) return;
    cloudError(error.name === 'SheetsError' || !record ? error : new Error('This invoice could not be opened. Your draft and saved records are unchanged. Try again.'));
  } finally {
    generating = false; $('history-feedback').hidden = true; updateCloudControls();
  }
}
function editRecord(record, { returnToPreview = false, replaceDraft = false } = {}) {
  if (googleBusy || generating || sharing) return false;
  // Reopening the same edit resumes its local draft instead of replacing it with the Sheet copy.
  if (recordId === record.id && baseRevision === record.revision) {
    editReturnRecord = returnToPreview ? record : null;
    showView('invoice'); return true;
  }
  if (dirty && !replaceDraft) {
    pendingEdit = { record, returnToPreview, workbookId: workbook?.id };
    $('replace-draft-description').textContent = `You have unsaved edits on this device. Editing invoice ${record.invoice.number} will replace them. Save your current invoice first if you want to keep it.`;
    $('replace-draft').showModal(); return false;
  }
  editReturnRecord = returnToPreview ? record : null; resetUndo = null;
  invoice = currentBusinessInvoice(record.invoice); automaticNumber = null; recordId = record.id; recordRevision = record.revision; baseRevision = record.revision; customerId = record.customerId; dirty = false; revision++; discardExport(); errors(); fillForm(); renderCloudRecords(); persist(); showView('invoice');
  return true;
}
$('cancel-edit').addEventListener('click', () => $('replace-draft').close());
$('replace-draft').addEventListener('close', () => { pendingEdit = null; });
$('confirm-edit').addEventListener('click', () => {
  const target = pendingEdit;
  $('replace-draft').close();
  if (target && workbook?.id === target.workbookId) editRecord(target.record, { returnToPreview: target.returnToPreview, replaceDraft: true });
});
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
    if (generated?.record?.id === record.id) discardExport();
    if (recordId === record.id) {
      invoice.status = 'paid'; $('payment-status').checked = true; baseRevision = nextRevision;
      recordRevision = dirty ? crypto.randomUUID() : nextRevision; revision++; discardExport(); updateTotals(); persist();
    }
    renderCloudRecords(); $('history-feedback').textContent = `${record.invoice.number} marked paid.`; $('history-feedback').hidden = false;
  });
}
$('cancel-delete').addEventListener('click', () => $('delete-transaction').close());
$('delete-transaction').addEventListener('close', () => { pendingDeletion = null; });
$('confirm-delete').addEventListener('click', () => {
  const target = pendingDeletion;
  $('delete-transaction').close();
  if (!target || target.workbookId !== workbook?.id) return;
  return cloudAction(async () => {
    const { record, workbookId } = target, epoch = connectionEpoch, key = `${workbookId}:${record.id}:${record.revision}`;
    if (!deletionRetries.has(key)) deletionRetries.set(key, crypto.randomUUID());
    const deletionRevision = deletionRetries.get(key);
    const next = await sheets.deleteInvoice(workbookId, { id: record.id, revision: deletionRevision, baseRevision: record.revision });
    if (epoch !== connectionEpoch) return;
    workbook = next; deletionRetries.delete(key);
    lastDeleted = { record, workbookId, deletionRevision, revision: crypto.randomUUID() };
    if (generated?.record?.id === record.id || recordId === record.id) discardExport();
    if (recordId === record.id) {
      // Keep any unsaved work as a new draft, without reviving the deleted transaction.
      recordId = crypto.randomUUID(); recordRevision = crypto.randomUUID(); baseRevision = null;
      invoice.number = newInvoice(business).number; automaticNumber = invoice.number; dirty = true; revision++;
      applyNumbering(next); fillForm();
    }
    renderCloudRecords(); $('history-feedback').textContent = `${record.invoice.number} deleted.`; $('history-feedback').hidden = false;
  });
});
$('undo-delete').addEventListener('click', () => cloudAction(async () => {
  const target = lastDeleted, epoch = connectionEpoch;
  if (!target || target.workbookId !== workbook?.id) return;
  const saved = await sheets.save(target.workbookId, { ...target.record, revision: target.revision, baseRevision: target.deletionRevision }, { updateCustomer: false });
  if (epoch !== connectionEpoch) return;
  workbook = saved.workbook; lastDeleted = null;
  renderCloudRecords(); $('history-feedback').textContent = `${target.record.invoice.number} restored.`; $('history-feedback').hidden = false;
}));
$('history-customer').addEventListener('change', () => { historyPage = 0; renderHistory(); updateCloudControls(); });
document.querySelectorAll('[data-status]').forEach(button => button.addEventListener('click', () => { historyStatus = button.dataset.status; historyPage = 0; renderHistory(); updateCloudControls(); }));
for (const [id, direction] of [['history-previous', -1], ['history-next', 1]]) $(id).addEventListener('click', () => { historyPage += direction; renderHistory(); updateCloudControls(); });
function useWorkbook(next, { businessOnly = false, render = true } = {}) {
  if (recordWorkbookId && recordWorkbookId !== next.id) {
    recordId = crypto.randomUUID(); baseRevision = null; recordRevision = crypto.randomUUID(); customerId = null;
  }
  if (!workbook || workbook.id !== next.id) { revision++; discardExport(); }
  const changedWorkbook = recordWorkbookId !== next.id;
  recordWorkbookId = next.id;
  workbook = next;
  if (!profileDirty || changedWorkbook) { business = normalizeSeller(next.seller); numberStart = next.numberStart; profileDirty = false; fillBusinessForm(); }
  if (next.numberingWarning) {
    updateNumberingWarning(next.numberingWarning); $('business-defaults').open = true; $('invoice-number-start').closest('details').open = true;
  }
  if (!business.name.trim()) $('business-defaults').open = true;
  // Business details are live defaults; transaction/customer fields remain their own snapshot.
  if (!sameSeller(invoice.seller, business)) { invoice.seller = { ...business }; revision++; recordRevision = crypto.randomUUID(); }
  if (changedWorkbook) fillForm();
  if (!businessOnly && (!baseRevision || changedWorkbook) && JSON.stringify(invoice.design) !== JSON.stringify(next.design)) {
    invoice.design = normalizeDesign(next.design); revision++; recordRevision = crypto.randomUUID(); discardExport();
  }
  applyNumbering(next);
  $('sheet-setup').hidden = true; $('sheet-connected').hidden = false;
  $('connected-sheet-name').textContent = next.name;
  $('open-sheet').href = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(next.id)}/edit`;
  $('google-status').textContent = googleUser.email;
  if (render) renderCloudRecords();
  else updateCloudControls();
  persist();
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
  $('known-sheet-options').hidden = !files.length;
  $('new-sheet-options').open = false;
  $('sheet-setup').hidden = false;
  $('google-status').textContent = `${googleUser.email} · Select your existing invoice Sheet, or create one if you’re starting fresh.`;
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
      disconnectGoogle(); googleUser = null; renderCloudRecords();
      $('google-status').textContent = 'Connect your Google Sheet again to confirm the account. Your draft is still here.'; return;
    }
    if (cacheAccountId && cacheAccountId !== nextUser.id) {
      $('sheet-connected').hidden = true; $('sheet-setup').hidden = true;
      $('open-sheet').removeAttribute('href'); $('connected-sheet-name').textContent = '';
      if ((dirty || profileDirty) && !window.confirm('This is a different Google account. Clear the remembered draft and defaults, then switch accounts?')) {
        disconnectGoogle(); googleUser = null; renderCloudRecords();
        $('google-status').textContent = 'Account switch cancelled. Your remembered draft is still on this device.'; return;
      }
      workbook = null; saveDevice(null); resetWorkingData(); renderCloudRecords();
    }
    googleUser = nextUser; cacheAccountId = nextUser.id;
    $('google-session-status').hidden = saveGoogleSession({ ...token, accountId: nextUser.id }, googleConfig.clientId, forgetMarker);
    clearTimeout(expiryTimer);
    expiryTimer = setTimeout(() => cloudError(Object.assign(new Error('Your Google connection expired. Reconnect to continue. Your draft is still here.'), { code: 'expired' }), { quiet: true }), Math.max(0, token.expiresAt - Date.now()));
    const previous = recordWorkbookId;
    if (previous) {
      const next = await active.load(previous);
      if (epoch === connectionEpoch) { if (reconnecting || (restoring && !interactive)) useWorkbook(next); else finishSheetConnection(next); }
    } else { showView('settings', !restoring); await showSheetSetup(); }
  } catch (error) {
    if (epoch === connectionEpoch) {
      if (!['expired', 'permission', 'privacy'].includes(error.code)) {
        disconnectGoogle(); googleUser = null; renderCloudRecords();
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
$('choose-sheet').addEventListener('click', () => cloudAction(async () => {
  const epoch = connectionEpoch;
  await preparePicker(googleConfig);
  if (epoch !== connectionEpoch) return;
  const id = await chooseSheet(googleConfig, sheets.token);
  if (!id || epoch !== connectionEpoch) return;
  const next = await sheets.load(id);
  if (epoch === connectionEpoch) finishSheetConnection(next);
}));
$('refresh-sheet').addEventListener('click', () => cloudAction(async () => { const epoch = connectionEpoch, next = await sheets.load(workbook.id); if (epoch === connectionEpoch) useWorkbook(next); }));
for (const [id, title] of [['setup-saved-items', SAVED_ITEMS_TAB], ['setup-design', DESIGN_TAB]]) $(id).addEventListener('click', () => cloudAction(async () => {
  if (!workbook) return;
  const epoch = connectionEpoch, next = await sheets.setupOptionalTab(workbook.id, title);
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
  workbook = null; saveDevice(null); resetWorkingData(); renderCloudRecords(); persist(); $('sheet-connected').hidden = true;
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
  for (const field of customerFields) $(`customer-${field}`).value = invoice.customer[field];
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
document.querySelectorAll('[data-message-field]').forEach(button => button.addEventListener('click', () => {
  const input = $('seller-message-template'), field = `{${button.dataset.messageField}}`;
  if (input.value.length - (input.selectionEnd - input.selectionStart) + field.length > input.maxLength) {
    $('message-field-status').textContent = `Keep the message template within ${input.maxLength} characters.`;
    return;
  }
  $('message-field-status').textContent = '';
  input.setRangeText(field, input.selectionStart, input.selectionEnd, 'end'); input.focus();
  input.dispatchEvent(new Event('input', { bubbles: true }));
}));
window.addEventListener('beforeunload', event => { if ((dirty || profileDirty) && !deviceSaved) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('focus', async () => {
  if (!sheets || !workbook || checkingAccess || googleBusy || generating || signatureBusy) return;
  const active = sheets, id = workbook.id, epoch = connectionEpoch, source = generated, version = revision;
  checkingAccess = true;
  try {
    const next = await active.load(id);
    // A background refresh must not overwrite a click or local edit made while it was loading.
    if (epoch !== connectionEpoch || googleBusy || generating || revision !== version || workbook?.id !== id) return;
    useWorkbook(next, { businessOnly: true, render: false });
    if (source && generated === source && activeView === 'pdf' && !sameSeller(source.invoice.seller, business)) {
      generating = true; updateCloudControls();
      try { await renderCurrentExport(source, epoch); }
      finally { generating = false; updateCloudControls(); }
    }
  } catch (error) { if (epoch === connectionEpoch) cloudError(error, { focus: false }); }
  finally { checkingAccess = false; }
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
