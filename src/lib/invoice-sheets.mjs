import { normalizeSeller, restoreDraft, validateInvoice, validateSeller, invoiceTotal, lineTotal, whatsappNumber } from './invoice.mjs';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const WORKBOOK_VERSION = 'sheetinvoice-v1';
const supportedVersions = new Set([WORKBOOK_VERSION, 'nls-invoice-v1']);
export const TABLES = {
  Customers: ['Customer ID', 'Name', 'WhatsApp', 'Address', 'Updated at'],
  Invoices: ['Invoice ID', 'Revision ID', 'Saved at', 'Invoice number', 'Date', 'Customer ID', 'Customer name', 'Total cents (SGD)', 'Summary', 'Invoice JSON'],
  'Invoice items': ['Invoice ID', 'Revision ID', 'Item', 'Description', 'Quantity', 'Unit price cents', 'Amount cents'],
  Settings: ['Key', 'Value'],
};
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const idPattern = /^[a-zA-Z0-9_-]{10,200}$/;
const uuidPattern = /^[a-f0-9-]{36}$/i;
const cell = value => ({ userEnteredValue: typeof value === 'number' ? { numberValue: value } : { stringValue: String(value ?? '') } });
const row = values => ({ values: values.map(cell) });
const writeRow = (sheetId, values, index = null) => index === null
  ? { appendCells: { sheetId, rows: [row(values)], fields: 'userEnteredValue' } }
  : { updateCells: { start: { sheetId, rowIndex: index, columnIndex: 0 }, rows: [row(values)], fields: 'userEnteredValue' } };

export class SheetsError extends Error {
  constructor(message, code = 'google') { super(message); this.name = 'SheetsError'; this.code = code; }
}

export function requirePrivateFile(file, permissions) {
  if (file.mimeType !== 'application/vnd.google-apps.spreadsheet' || file.trashed) throw new SheetsError('Choose a Google Sheet.', 'file');
  if (!file.capabilities?.canEdit) throw new SheetsError('This Google account needs Editor access to the Sheet.', 'permission');
  if (!Array.isArray(permissions) || !permissions.length) throw new SheetsError('Google could not verify the Sheet’s sharing settings. Ask its owner to check sharing.', 'privacy');
  if (permissions.some(permission => permission.view === 'published' || permission.role === 'publishedReader')) {
    throw new SheetsError('This Sheet is published to the web. Stop publishing it in Google Sheets before using it for customer records.', 'privacy');
  }
  if (permissions.some(permission => permission.type !== 'user')) {
    throw new SheetsError('Keep this Sheet restricted to individual people. Remove public links, domain or group access in Google Sheets, then try again.', 'privacy');
  }
  return file;
}

export function parseWorkbook(metadata, ranges) {
  const tabs = Object.fromEntries((metadata.sheets || []).map(sheet => [sheet.properties.title, sheet.properties.sheetId]));
  const tables = {};
  for (const [index, [title, header]] of Object.entries(TABLES).entries()) {
    const values = ranges[index]?.values || [];
    if (!Number.isInteger(tabs[title]) || JSON.stringify(values[0]) !== JSON.stringify(header)) {
      throw new SheetsError('This is not an invoice workbook, or its columns were changed. Choose an invoice Sheet created by this tool.', 'schema');
    }
    if (values.length > 10000) throw new SheetsError('This workbook is too large for this simple tool. Start a new invoice workbook.', 'limit');
    tables[title] = values.slice(1);
  }
  const settings = Object.fromEntries(tables.Settings);
  if (!supportedVersions.has(settings.schema)) throw new SheetsError('This workbook uses an unsupported invoice format.', 'schema');
  let seller;
  try { seller = normalizeSeller(JSON.parse(settings.seller)); } catch { seller = normalizeSeller(); }
  // Rows are revisions. Append order is authoritative, including saves from another phone.
  const latest = new Map();
  for (const values of tables.Invoices) {
    if (!uuidPattern.test(values[0] || '') || !uuidPattern.test(values[1] || '')) continue;
    const invoice = restoreDraft(JSON.stringify({ version: 1, invoice: safeJson(values[9]) }));
    if (invoice && !validateInvoice(invoice).length) latest.set(values[0], { id: values[0], revision: values[1], customerId: values[5], savedAt: values[2], invoice });
  }
  const customers = new Map();
  for (const values of tables.Customers) {
    if (!uuidPattern.test(values[0] || '') || typeof values[1] !== 'string' || !values[1].trim()) continue;
    customers.set(values[0], { id: values[0], name: values[1].slice(0, 120), phone: String(values[2] || '').slice(0, 40), address: String(values[3] || '').slice(0, 400) });
  }
  return { id: metadata.spreadsheetId, name: metadata.properties.title, tabs, tables, seller,
    customers: [...customers.values()].sort((a, b) => a.name.localeCompare(b.name)),
    invoices: [...latest.values()].reverse() };
}
function safeJson(value) { try { return JSON.parse(value); } catch { return null; } }

export function planSave(workbook, { id, revision, baseRevision, customerId, invoice }, now = new Date()) {
  if (!uuidPattern.test(id || '') || !uuidPattern.test(revision || '')) throw new SheetsError('Invalid invoice record.', 'validation');
  const errors = validateInvoice(invoice);
  if (errors.length) throw new SheetsError(errors.join(' '), 'validation');
  const existing = workbook.invoices.find(record => record.id === id);
  const conflict = () => new SheetsError('This invoice changed on another device. Your edits are still here. Refresh records and reopen the latest invoice before saving.', 'conflict');
  const savedRevision = workbook.tables.Invoices.find(values => values[0] === id && values[1] === revision);
  if (savedRevision) {
    if (baseRevision !== undefined && existing?.revision !== revision) throw conflict();
    return { requests: [], customerId: savedRevision[5] };
  }
  if (baseRevision !== undefined && (existing?.revision || null) !== baseRevision) throw conflict();
  if (workbook.invoices.some(record => record.id !== id && record.invoice.number.trim().toUpperCase() === invoice.number.trim().toUpperCase())) throw new SheetsError('That invoice number is already in use. Change the invoice number before saving.', 'validation');
  const phone = whatsappNumber(invoice.customer.phone);
  const match = workbook.customers.find(customer => customer.id === customerId) || workbook.customers.find(customer =>
    phone ? whatsappNumber(customer.phone) === phone : customer.name.toLowerCase() === invoice.customer.name.trim().toLowerCase() && customer.address.trim() === invoice.customer.address.trim());
  const nextCustomerId = match?.id || globalThis.crypto.randomUUID();
  const index = workbook.tables.Customers.findIndex(values => values[0] === nextCustomerId);
  const savedAt = now.toISOString();
  const snapshot = structuredClone(invoice);
  snapshot.status ||= 'unpaid';
  const requests = [writeRow(workbook.tabs.Customers, [nextCustomerId, snapshot.customer.name.trim(), snapshot.customer.phone.trim(), snapshot.customer.address.trim(), savedAt], index < 0 ? null : index + 1),
    writeRow(workbook.tabs.Invoices, [id, revision, savedAt, snapshot.number, snapshot.date, nextCustomerId, snapshot.customer.name.trim(), invoiceTotal(snapshot), `[${snapshot.status.toUpperCase()}] ${snapshot.items.map(item => item.description).join('; ')}`, JSON.stringify(snapshot)])];
  requests.push({ appendCells: { sheetId: workbook.tabs['Invoice items'], fields: 'userEnteredValue', rows: snapshot.items.map((item, index) => row([id, revision, index + 1, item.description, Number(item.quantity), lineTotal({ ...item, quantity: '1' }), lineTotal(item)])) } });
  return { requests, customerId: nextCustomerId };
}

export class InvoiceSheets {
  constructor({ token, expiresAt, fetcher = globalThis.fetch }) { this.token = token; this.expiresAt = expiresAt; this.fetcher = fetcher.bind(globalThis); this.controller = new AbortController(); }
  disconnect() { this.token = null; this.controller.abort(); }
  async request(url, options = {}) {
    if (!this.token || Date.now() >= this.expiresAt) throw new SheetsError('Your Google connection expired. Connect Google again; your draft is still in this tab.', 'expired');
    const target = new URL(url);
    if (!['https://sheets.googleapis.com', 'https://www.googleapis.com', 'https://openidconnect.googleapis.com'].includes(target.origin)) throw new SheetsError('Invalid Google API address.', 'validation');
    let response;
    try {
      response = await this.fetcher(target.href, { ...options, signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(25000)]), cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers, Authorization: `Bearer ${this.token}` } });
    } catch (error) {
      if (this.controller.signal.aborted) throw new SheetsError('Google disconnected.', 'disconnected');
      throw new SheetsError('Google could not be reached. Your draft is still here. Check your connection and try again.', 'network');
    }
    if (!response.ok) {
      if (response.status === 401) { this.token = null; throw new SheetsError('Your Google connection expired. Connect Google again.', 'expired'); }
      if ([403, 404].includes(response.status)) throw new SheetsError('This account cannot access that Sheet. Check its sharing permissions and choose it through Google again.', 'permission');
      if (response.status === 429) throw new SheetsError('Google is busy. Wait a moment, then try saving again.', 'busy');
      throw new SheetsError('Google could not finish this action. Your draft is still here. Please try again.', 'google');
    }
    return response.status === 204 ? {} : response.json();
  }
  async user() {
    const user = await this.request('https://openidconnect.googleapis.com/v1/userinfo');
    if (!user.sub || user.email_verified !== true) throw new SheetsError('Google could not verify this account.', 'permission');
    return { id: user.sub, email: user.email };
  }
  async privateFile(id) {
    if (!idPattern.test(id)) throw new SheetsError('Invalid Sheet ID.', 'validation');
    const file = await this.request(`${DRIVE}/${id}?fields=id,name,mimeType,trashed,capabilities(canEdit)`);
    const permissions = [];
    let pageToken;
    do {
      const query = new URLSearchParams({ fields: 'permissions(type,role,view),nextPageToken', includePermissionsForView: 'published', pageSize: '100', ...(pageToken ? { pageToken } : {}) });
      const page = await this.request(`${DRIVE}/${id}/permissions?${query}`);
      permissions.push(...(page.permissions || [])); pageToken = page.nextPageToken;
    } while (pageToken);
    return requirePrivateFile(file, permissions);
  }
  async list() {
    const query = new URLSearchParams({ q: `trashed = false and mimeType = 'application/vnd.google-apps.spreadsheet' and (appProperties has { key='sheetInvoice' and value='${WORKBOOK_VERSION}' } or appProperties has { key='nlsInvoice' and value='nls-invoice-v1' })`, fields: 'files(id,name),nextPageToken', pageSize: '100' });
    const result = await this.request(`${DRIVE}?${query}`);
    return result.files || [];
  }
  async load(id) {
    await this.privateFile(id);
    const metadata = await this.request(`${SHEETS}/${id}?fields=spreadsheetId,properties(title),sheets(properties(sheetId,title,gridProperties(rowCount)))`);
    const query = new URLSearchParams();
    for (const title of Object.keys(TABLES)) {
      const rows = metadata.sheets.find(sheet => sheet.properties.title === title)?.properties.gridProperties?.rowCount || 1000;
      query.append('ranges', `'${title}'!A1:K${Math.min(rows, 10001)}`);
    }
    const values = await this.request(`${SHEETS}/${id}/values:batchGet?${query}`);
    return parseWorkbook(metadata, values.valueRanges || []);
  }
  async create(name, seller) {
    if (typeof name !== 'string' || !name.trim() || name.length > 100) throw new SheetsError('Enter a Sheet name (up to 100 characters).', 'validation');
    // Drive creates the file in My Drive, outside any shared folder. No sharing permission is added.
    const file = await this.request(DRIVE + '?fields=id', { method: 'POST', body: JSON.stringify({ name: name.trim(), mimeType: 'application/vnd.google-apps.spreadsheet' }) });
    await this.privateFile(file.id);
    const metadata = await this.request(`${SHEETS}/${file.id}?fields=sheets(properties(sheetId,title))`);
    const titles = Object.keys(TABLES);
    const requests = [];
    const first = metadata.sheets?.[0]?.properties;
    const ids = {};
    for (const [index, title] of titles.entries()) {
      const sheetId = index === 0 && first ? first.sheetId : 100 + index;
      ids[title] = sheetId;
      if (index === 0 && first) requests.push({ updateSheetProperties: { properties: { sheetId, title, gridProperties: { frozenRowCount: 1 } }, fields: 'title,gridProperties.frozenRowCount' } });
      else requests.push({ addSheet: { properties: { sheetId, title, gridProperties: { rowCount: 1000, columnCount: 12, frozenRowCount: 1 } } } });
      requests.push(writeRow(sheetId, TABLES[title], 0));
      requests.push({ repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.88, green: 0.94, blue: 0.91 } } }, fields: 'userEnteredFormat' } });
    }
    requests.push(writeRow(ids.Settings, ['schema', WORKBOOK_VERSION], 1), writeRow(ids.Settings, ['seller', JSON.stringify(normalizeSeller(seller))], 2));
    // Hide the machine-readable invoice snapshot from the normal Sheet view.
    requests.push({ updateDimensionProperties: { range: { sheetId: ids.Invoices, dimension: 'COLUMNS', startIndex: 9, endIndex: 10 }, properties: { hiddenByUser: true }, fields: 'hiddenByUser' } });
    await this.request(`${SHEETS}/${file.id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests }) });
    // Only completed workbooks appear in the returning-user list.
    await this.request(`${DRIVE}/${file.id}?fields=id`, { method: 'PATCH', body: JSON.stringify({ appProperties: { sheetInvoice: WORKBOOK_VERSION } }) });
    return this.load(file.id);
  }
  async save(id, record, { updateCustomer = true } = {}) {
    // Re-read immediately before writing, preserving changes from the other account.
    const current = await this.load(id);
    const plan = planSave(current, record);
    if (!updateCustomer) {
      if (plan.customerId !== record.customerId) throw new SheetsError('Customer details changed. Refresh records before marking this invoice paid.', 'conflict');
      // A payment update must preserve the customer's current contact and address.
      plan.requests = plan.requests.filter(request => (request.updateCells?.start.sheetId ?? request.appendCells?.sheetId) !== current.tabs.Customers);
    }
    if (plan.requests.length) await this.request(`${SHEETS}/${id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: plan.requests }) });
    return { customerId: plan.customerId, workbook: await this.load(id) };
  }
  async saveSeller(id, seller) {
    const errors = validateSeller(seller);
    if (errors.length) throw new SheetsError(errors.join(' '), 'validation');
    const current = await this.load(id);
    const index = current.tables.Settings.findIndex(values => values[0] === 'seller');
    const request = writeRow(current.tabs.Settings, ['seller', JSON.stringify(normalizeSeller(seller))], index < 0 ? null : index + 1);
    await this.request(`${SHEETS}/${id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [request] }) });
    return this.load(id);
  }
}
