# SheetInvoice

Free, open-source invoicing on phone and desktop, backed by your own private Google Sheet. Create PDF or JPG invoices, track payments and customise your business details. No website account or backend.

[Open SheetInvoice](https://rebgoh123.github.io/sheetinvoice/)

## Get started

1. **Connect Google Sheet**, then select an existing SheetInvoice workbook or create a private one. Other spreadsheet layouts are not supported.
2. Add your **Business details** and choose **Save & start invoicing**.
3. Enter a customer and items, then **Save** or **Save & PDF/JPG**. New invoices are unpaid. Use **Past transactions** to preview, edit, mark paid or delete them.

The preview groups the filename, payment status, PDF/JPG selector and Share/Save icons. Sharing uses your device's available share options; downloading works without file sharing support. Longer invoices produce one PDF or separate JPG pages.

Your draft is remembered on this device. When Google access expires, **Reconnect** reloads the same Sheet without repeating setup. Refresh restores a valid connection; browser-only access lasts up to one hour, and Google may require sign-in again.

**Reset** starts a fresh draft with Undo. **Close** cancels unsaved transaction edits. **Change Sheet**, **Disconnect** and **Clear this device’s data** are at the bottom of Settings.

## Customise

Each workbook has its own settings. Keep tab names, column headings, setting keys and the `schema` row intact. After editing saved items or design directly in Sheets, choose **Refresh records**.

| What | Where |
| --- | --- |
| Business name, contact/registration labels, payment details and review link | **Settings → Business details**, or the Sheet's **Settings** tab |
| Starting invoice number, e.g. `INV-0001` | **Business details → More business details → Start invoice numbers at**. Keep Sheet values as plain text for leading zeros. |
| Reusable item tags | **Saved items** tab: Description, Quantity, Unit price (SGD). Blank quantity means 1; prices can be left blank. |
| Colours and alignment | **Invoice design** tab: dark `#RRGGBB` colours and `left`, `center` or `right` alignment |
| Signature | **More business details**: initials/name or upload a PNG, JPG or WebP. Images are resized locally and stored in your Sheet; pasted Sheet-cell pictures are not imported. |

Previews automatically use the latest business details, labels and signature from the Sheet. Unsaved Business details edits take precedence. Saved invoices retain their design; **Apply design to current invoice**, then save, to restyle one. Older workbooks can add Saved items and Invoice design tabs through Settings.

Write a complete **WhatsApp message template** in Business details, using the field buttons or placeholders:

```text
Hi {customer_name},
Your invoice {invoice_number} for {total} is ready.
Thank you, {business_name}.
```

Other fields: `{invoice_date}`, `{payment_status}`, `{service_address}`, `{items}`, `{payment_instructions}`, `{review_link}`, `{invoice_summary}`. Leave the template blank for the standard message. Custom messages include payment/review details only where you insert them. Templates are plain text, up to 3,000 characters, and do not appear on the invoice.

## Run locally

Requires Node.js 24+.

```sh
npm ci
cp .env.example .env
npm run dev
```

Add the public Google configuration below to `.env` for Sheet access. PDF/JPG generation also works without Google. Use `npm run build` to create `dist/`, and `npm run preview` to preview it.

## Google setup for your own copy

A fork needs credentials authorised for its website. In one Google Cloud project:

1. Enable **Google Sheets API**, **Google Drive API** and **Google Picker API**.
2. Create a **Web application** OAuth client. Add your **Authorized JavaScript origin**, e.g. `https://YOUR_USERNAME.github.io` (no repository path). This browser flow needs no client secret or redirect endpoint.
3. Configure consent for `openid`, `email` and `https://www.googleapis.com/auth/drive.file`. In Testing, add your test users; review Google's production requirements before opening sign-in to everyone.
4. Create a browser API key restricted to **Google Picker API** and **Google Drive API**. Allow website referrers `https://YOUR_USERNAME.github.io/*` and `https://docs.google.com/*` for Picker. Add `http://localhost:4321` as an OAuth origin and `http://localhost:4321/*` as a key referrer only for development.
5. Set these locally in `.env`, or as GitHub repository **Variables**:

| Variable | Value |
| --- | --- |
| `PUBLIC_GOOGLE_CLIENT_ID` | Web OAuth client ID |
| `PUBLIC_GOOGLE_API_KEY` | Restricted browser API key |
| `PUBLIC_GOOGLE_APP_ID` | Numeric Google Cloud project number |

These are public build configuration. Never commit client secrets, service-account credentials, access/refresh tokens or real records. The API key alone cannot access records; Google grants each user access to files they choose or create through the app.

References: [Google browser authentication](https://developers.google.com/identity/oauth2/web/guides/use-token-model), [per-file permissions](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [Picker setup](https://developers.google.com/workspace/drive/picker/guides/web-picker-sample).

## Hosting

Serve `dist/` on an HTTPS static host. For the included GitHub Pages workflow:

1. Set **Settings → Pages → Source** to **GitHub Actions**.
2. Add the Google Variables above and set `PAGES_ENABLED` to `true`.
3. Run **Build and deploy** from Actions. Later pushes to `main` deploy automatically.

The default address is `https://OWNER.github.io/REPOSITORY/`. Override `PUBLIC_SITE_URL` and `PUBLIC_BASE_PATH` for other hosting; use `/` as the base for a root/custom domain.

## Privacy and limits

**The app reads and saves your chosen Sheet directly from your browser. No application backend receives or stores records or generated files.** Keep the Sheet Restricted, shared only with individual Editors; public, published, domain and group sharing are refused.

- Device storage remembers the current draft, business defaults, design, saved items and account/Sheet identifiers. Anyone using the same browser profile can see this data. A short-lived access token uses tab session storage, readable by scripts on the same website origin. Full history and generated files remain in memory.
- **Disconnect** or **Clear this device’s data** removes remembered data without deleting saved Sheet records. Device storage is not a backup. Deleting a transaction adds a deletion revision; earlier Sheet rows remain for recovery and numbering.
- No analytics, ads or paid tier. Google receives API traffic; the static host may log ordinary page requests. See the [full privacy notice](https://rebgoh123.github.io/sheetinvoice/privacy/); forks should update it for their deployment.
- SGD and Singapore date/phone defaults; up to 40 invoice items and 100 saved items. No tax, deposits or discounts. Archive to a new workbook before 10,000 rows per tab.
- Invoice numbering is not reserved across devices. Conflict checks protect saved revisions, but avoid editing the same invoice simultaneously; customer updates are last-write-wins.

## Source guide

`src/components/` holds the views; `invoice-client.mjs` coordinates them. `invoice.mjs` handles validation, totals and messages; `invoice-sheets.mjs` handles Google/workbooks; `invoice-storage.mjs` handles browser storage. `invoice-export.mjs` shares PDF/JPG rendering, with app styles in `src/styles/invoice.css`.

[MIT license](LICENSE). Dependencies retain their own licenses.
