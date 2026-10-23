# SheetInvoice

A free, open-source invoice tool backed by your own Google Sheet. Connect Google, choose or create a private workbook, enter your business details, then save invoices and share PDFs or JPG images. Works on phone and desktop.

There is no separate website account or password. The app is public; Google authorizes access to each user's chosen files. Business profiles, customers and invoice history belong to the connected workbook. New installations contain no business or customer details.

## Use it

1. Tap **Connect Google Sheet** on the invoice page and sign in to Google.
2. **Select your Sheet** from the list or **Choose from Google Drive**. If you are starting fresh, expand **Create a new Sheet** instead. Only SheetInvoice workbooks are supported; arbitrary spreadsheet layouts are not imported or overwritten.
3. A new Sheet opens **Business details**. Enter your business name, add any other details you need, then **Save & start invoicing**. Optional fields are under **More business details**. An existing Sheet with business details returns straight to the invoice.
4. Choose **Saved customer** or **New customer** when your Sheet has saved customers, then enter the items. Choose **Save** or **Save & PDF** / **Save & JPG**. Invoice number and date are filled automatically; expand **Invoice details** to edit them. New invoices are unpaid; tick **Mark as paid** when paid.
5. Use **Past transactions** to filter by customer and payment status. Tap anywhere on a transaction row to preview its invoice. The pencil (**Edit**), **Mark paid** and trash (**Delete**) buttons are separate quick actions; they do not open the preview. Deleting asks for confirmation and offers **Undo deletion** for the last deletion during this connection. Customer details stay saved.

When editing a saved invoice, **Close** cancels unsaved edits and returns to its preview or the transaction list, depending on where editing began. The **Invoice** tab then opens a fresh New invoice form. Use **Save** before closing to keep changes in the Sheet. Switching to a different invoice asks before replacing an unsaved working draft.

**Reset** starts a new invoice immediately, without a confirmation popup. **Undo reset** restores the previous working invoice until you begin editing the new one or refresh the page. Reset does not change saved transactions.

**Change Sheet**, **Disconnect** and **Clear this device’s data** are always visible at the bottom of Settings. Change Sheet and Disconnect are disabled when no connection is available.

To choose your invoice number series, open **Settings → Business details → More business details → Start invoice numbers at** and save. For example, `40108` continues as `40109`, while `INV-0001` continues as `INV-0002`. The value is saved as **Invoice number start** in the Sheet's **Settings** tab; you can edit that row directly, then **Refresh records**. Keep the value as plain text to preserve leading zeros. Leave it blank to use the original date-based numbers.

New invoices use the starting value or the next number after the highest number already saved in the same series, whichever is higher. Numbers from earlier saved revisions also count, so editing an invoice's number does not free its previous number. An unsaved draft does not advance the series. Saved invoices and manually entered draft numbers keep their numbers. Reconnect your Sheet to continue its series when creating a new invoice; offline invoices use date-based numbers until reconnected, unless you enter a number yourself.

To reuse items, open **Settings → Saved items → Edit in Google Sheet**. In the Sheet's **Saved items** tab, enter `Description`, `Quantity` and `Unit price (SGD)` under the existing column headings. Quantity defaults to 1 when blank; leave the price blank if it varies per invoice. Return to the app and choose **Refresh records**. Tap the saved-item tags below the customer details to add them; tapping the same description and price again increases its quantity. Tags show the quantity already added and keep focus for repeated taps. You can edit the line for that job. Up to 100 saved items are loaded per Sheet. Older workbooks get the tab through **Add saved items tab**.

Business defaults are editable in **Settings → Business details** or the Sheet's **Settings** tab. Keep the Key cells and `schema` row intact. Saving Business details writes readable key/value rows; older JSON profiles remain readable until you save. Customer details have their own **Customers** tab.

Phone and registration labels are separate from their values. Set **Phone label** to `Contact`, `Tel` or `WhatsApp`, and **Registration label** to `UEN / Registration No`, `UEN` or another label, either in Business details or their Sheet Settings rows. **Business phone** and **UEN / registration** hold the values. Blank labels show only the value; blank values hide that line. Labels support up to 40 characters, and a trailing colon is handled automatically. Older Sheets without these rows use `Contact` and `UEN / Registration No`. PDF and JPG share the same settings.

Business details, saved items and design are collapsed until needed. Any section containing an invalid form field opens automatically when you try to save.

To customise the PDF, open **Settings → Invoice design**. Older workbooks first need **Add invoice design tab**. Use **Edit in Google Sheet** and change the **Value** column in the **Invoice design** tab:

| Setting | Example / options |
| --- | --- |
| Accent colour | `#285D60` for headings and table lines |
| Text colour | `#233B37` for invoice text |
| Business alignment | `left`, `center` or `right` |
| Item text alignment | `left`, `center` or `right` for descriptions, address, payment and notes |
| Footer alignment | `left`, `center` or `right` |

Keep the Setting/Value/Options headings and setting labels intact. Blank values use the defaults. Colours use six-digit hex codes and must be readable on white (at least 4.5:1 contrast); invalid or too-light colours fall back to the default with a warning in Settings. Return to **Refresh records** to load edits. New invoices and unsaved new drafts use the Sheet's design. Saved invoices store their own design snapshot; reopening or marking them paid preserves it. Use **Apply design to current invoice** to restyle an existing invoice, then save. The PDF keeps its A4 layout and numeric columns.

Each Sheet has its own business profile. Opening, generating or switching an invoice's format reads the latest profile from the Sheet automatically, including labels, payment details and the signature. Returning from editing the Sheet also refreshes a visible preview. Local unsaved Business details take precedence until you save or discard them. No separate update button or invoice save is needed to render the latest profile. Customer details, items, totals, payment status and saved design remain specific to that transaction. Opening/exporting never writes a transaction revision. If Google cannot be reached while connected, the app reports the error instead of silently exporting stale details.

Deleting adds a deletion revision to the Sheet and removes the transaction from app history and unpaid totals. Earlier Sheet rows remain for recovery and numbering; this is not permanent data erasure. Undo restores the invoice without changing its customer's current contact details. A stale edit or payment update cannot restore a deleted invoice. If it was the working invoice, its details stay as a new unsaved draft with a new invoice number.

Choose **PDF** or **JPG** beside the Save button before generating. The choice is remembered on this device. Both formats show an inline invoice preview, including page controls for longer invoices. PDF/JPG selection and Share/Save actions share one toolbar, which wraps on small phones. Switch formats on the export screen without saving another Sheet revision. JPG produces a high-resolution image with a white background; longer invoices produce one numbered image per page, with page-by-page downloads. PDF downloads contain the entire invoice.

Use **Settings → Business details → More business details** to set a signature. Enter initials/a name in **Authorised signature**, or choose **Upload signature image**, then **Save business details**. PNG, JPG and WebP uploads up to 8 MB are resized locally into a small PNG. The image takes precedence over initials; **Remove image** restores the initials if provided. Leave both blank for signing by hand. This is a printed signature, not a cryptographic digital signature.

Signature text is editable in the **Authorised signature** row of the Sheet's **Settings** tab. Uploaded images are encoded in the **Signature image** row and each saved invoice snapshot, so they need no public URL, external image host or extra Google permissions. Manage the image through the app; pasting a picture into a Sheet cell does not import it. The current business profile supplies the signature for both new and saved invoices.

Set **WhatsApp message template (optional)** in **Settings → Business details**, then **Save business details**. Write the entire message, inserting dynamic fields with the buttons below it or typing their placeholders. For example:

```text
Hi {customer_name},
Your invoice {invoice_number} for {total} is ready.
Thank you, {business_name}.
```

The template replaces the whole message in **Copy message**, **Open WhatsApp** and file sharing. It uses each invoice's customer, number and total, including past transactions, and the latest business profile. Line breaks are preserved. No greeting, payment instructions or review request are added outside your template. Leave it blank for the standard message.

| Field | Replaced with |
| --- | --- |
| `{customer_name}` | Customer name |
| `{invoice_number}` | Invoice number |
| `{total}` | Total with currency, e.g. `S$80.00` |
| `{invoice_date}` | Formatted invoice date |
| `{payment_status}` | `Paid` or `Unpaid` |
| `{business_name}` | Current business name |
| `{service_address}` | Address for that invoice's job |
| `{items}` | Item descriptions, quantities and prices, one per line |
| `{payment_instructions}` | Current payment instructions when unpaid; blank when paid |
| `{review_link}` | Current review link, or blank when unset |
| `{invoice_summary}` | The complete standard message, including conditional payment instructions and review request |

Fields are replaced as plain text, once; unknown placeholders stay literal. Use double braces to show literal braces, e.g. `{{total}}` prints `{total}`. Templates support up to 3,000 characters and are saved as **WhatsApp message template** in the Sheet's **Settings** tab and with business details on this device. They do not appear on the PDF or JPG. Existing prefixes are upgraded to `your prefix` followed by `{invoice_summary}`, preserving their previous message. Saving Business details replaces the old **WhatsApp message prefix** row with the template row; no manual Sheet migration is needed.

Files are created in the browser. **Share PDF** or **Share JPG** opens the device share menu; select WhatsApp and confirm the recipient yourself. Some receiving apps omit text when sharing a file; **Copy message** and **Open WhatsApp** provide the same invoice message. The standard message's review request appears only when your business profile has a review URL; custom templates include it only through the fields you choose. Desktop browsers can download the PDF or JPG images for manual attachment.

Your working invoice, business defaults, design and saved-item tags are automatically remembered in local storage. Refreshing or reopening the app restores them, including the invoice's record/revision IDs for safe reconnection. Only one current invoice is kept per browser profile; the last tab that saves locally wins. Use **Clear this device’s data** at the bottom of Settings or **Disconnect** to forget it. Clearing device data does not delete saved Google Sheets records.

The Google connection is remembered in this tab's **session storage** until the original token expires (capped at one hour). Refreshing restores the account and selected Sheet automatically after checking Google identity and file permissions again; it does not open another sign-in popup or extend the token's lifetime. Disconnect, clearing device data, expiry and detected permission failures remove that temporary credential. After an upgrade from a version without session restoration, connect once to start remembering the connection. If tab storage is blocked, the app reports that refresh may require reconnecting.

Without Google configuration or a connection, you can enter business details, use remembered tags and generate a PDF or JPG. Saving to Google Sheets and loading customers/history require valid Google access. When it expires, tap **Reconnect** on the invoice or transactions page. The app hints the remembered Google account without forcing account selection, reloads the same Sheet directly and keeps your current page and draft; Sheet selection and business setup are not repeated. Google may still request sign-in or consent when necessary. The app does not silently open a Google popup. Disconnect or clearing device data forgets the Sheet; changing accounts or losing Sheet access may require choosing a Sheet again. Generated files remain in memory; offline generation clearly reports that it has not saved the invoice to Sheets.

## Run locally

Requires Node.js 24 or newer.

```sh
npm ci
cp .env.example .env
npm run dev
```

Fill in the public Google values below to enable connecting a Sheet. The default Astro development origin is `http://localhost:4321`. For a production build, run `npm run build`; preview it with `npm run preview`.

## Google configuration for a hosted copy

One Google Cloud project can serve this app. A self-hosted fork needs credentials configured for its own website; copying a repository does not automatically authorize its hostname.

1. Enable **Google Sheets API**, **Google Drive API** and **Google Picker API**.
2. Create an OAuth client of type **Web application**. Add the website origin to **Authorized JavaScript origins**, for example `https://YOUR_USERNAME.github.io`. Origins contain no repository path. Add localhost only for development. This browser flow has no client secret or redirect endpoint.
3. Configure consent for `openid`, `email` and `https://www.googleapis.com/auth/drive.file`. In Testing, only listed test users can connect. Review Google's production and branding requirements before making sign-in available to everyone.
4. Create a browser API key restricted to **Google Picker API** and **Google Drive API**. Restrict website referrers to your deployed app, for example `https://YOUR_USERNAME.github.io/*`, and `https://docs.google.com/*` for Picker. Cross-origin browser requests may send only the origin, so allow your own Pages origin rather than a repository path. Only add local referrers when developing.
5. Set these environment values locally, or GitHub Actions repository **Variables** for deployment:

| Variable | Value |
| --- | --- |
| `PUBLIC_GOOGLE_CLIENT_ID` | Web OAuth client ID |
| `PUBLIC_GOOGLE_API_KEY` | Restricted browser Picker API key |
| `PUBLIC_GOOGLE_APP_ID` | Numeric Google Cloud project number |

These identifiers are public browser configuration and are embedded in the build. Never commit an OAuth client secret, service-account credential, access token, refresh token or real records. Google sign-in consent grants per-user access to app-created or explicitly chosen files; the browser key alone grants no record access.

References: [Google browser token flow](https://developers.google.com/identity/oauth2/web/guides/use-token-model), [per-file permissions](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [Picker setup](https://developers.google.com/workspace/drive/picker/guides/web-picker-sample).

## Hosting

The `dist/` folder can be served by an HTTPS static host. There is no server, database or password service to deploy.

The included workflow always builds on pushes and pull requests. GitHub Pages deployment is opt-in:

1. In repository **Settings → Pages**, choose **GitHub Actions** as the source.
2. Set the three public Google Variables and the matching Google origins/referrers.
3. Set repository Variable `PAGES_ENABLED` to `true`, then run **Build and deploy** from Actions.

By default this uses `https://OWNER.github.io/REPOSITORY/`. Custom hosting can override `PUBLIC_SITE_URL` and `PUBLIC_BASE_PATH`. Set the base path to `/` for a custom domain or root deployment. Review [GitHub Pages' usage limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits) for your deployment's intended use.

## Privacy and data

**SheetInvoice reads and saves records in the Google Sheet you connect. It does not receive or store copies of those records or generated PDF/JPG files on an application server.** Processing runs in your browser, with direct requests to Google's APIs. This is different from saying the app never reads or saves anything.

The app includes a [Privacy & data page](https://rebgoh123.github.io/sheetinvoice/privacy/), linked beside Connect Google and from the footer. Self-hosted forks should review and update that notice to match their deployment.

- Keep the workbook's General access **Restricted**. Share only with individual people who should use it, as Editors. The app checks edit permission and refuses public, published, domain or group sharing before loading or saving.
- Records travel directly between the browser and Google's APIs. The static host does not receive invoice cells, access tokens or generated files from the app. Like any website, its host may log ordinary page requests/IP addresses; Google receives the API requests.
- Your Google account ID and verified email identify the connection. The app also reads available workbook names, file metadata/permissions and the connected Sheet's business settings, customers, invoices and items. These are used to render the app, save your changes and generate PDFs or JPG images.
- Local storage holds the current invoice (including customer details), business defaults, design, saved-item tags and account/Sheet/record IDs. It is readable by anyone using the same browser profile, even without Google sign-in. A temporary access token, expiry, account ID and app identifier use tab session storage for refresh restoration, never local storage or an app backend. Expiry is preserved and capped at one hour; session data is validated and the Google account and Sheet permissions are rechecked before loading records. Scripts on the same website origin can read tab storage. Browser session restoration may preserve it, but expired tokens are discarded. Verified email, full customer lists, transaction history and generated files remain in memory.
- Disconnect and Clear this device’s data remove remembered data and Sheet IDs, clear open SheetInvoice tabs (suspended tabs clear on resume) and leave saved Sheets records intact. They do not sign out of Google globally. Token expiry retains the working draft/defaults for reconnection. Detected permission/privacy failures clear remembered data. Account changes clear the previous account's working data. Previously downloaded or shared files cannot be recalled.
- No advertising, tracking scripts, analytics or paid tier are included. Google Identity and Picker load from Google's services.
- Device storage is one working copy, not a history backup. Private browsing, cleared browser storage or device loss can remove it; save important invoices to your Sheet. If storage is unavailable, the app reports it in Settings and keeps edits in the current tab only.

## Workbook and current limits

The app creates **Customers**, **Invoices**, **Invoice items**, **Settings**, **Saved items** and **Invoice design** tabs. Business details use readable key/value rows in Settings; older `seller` JSON profiles remain readable until saved in the new format. Invoice snapshots preserve the profile, items and design at the time of saving; older invoices without a design use the original defaults. Saved items and Invoice design are optional for existing workbooks. Invalid preset rows are skipped with a warning in Settings. Do not reorder/rename app columns. Existing invoice workbooks with the legacy `nls-invoice-v1` schema can also be chosen; their data is read only after Google authorization. Arbitrary spreadsheet layouts are not imported or overwritten.

This first version uses SGD, Singapore date/phone defaults, integer-cent totals and up to 40 items. It does not calculate tax, deposits or discounts. Invoice numbers are editable, with an optional series based on saved records. Number suggestions use the last loaded Sheet; simultaneous creation on separate devices does not have an atomic number reservation. Refresh before creating another invoice if someone else is using the same series. Save retries use stable revision IDs. Concurrent editing has conflict detection but no transactional lock: avoid editing the same invoice on multiple devices at once. Customer updates are last-write-wins. Archive into a new workbook before reaching 10,000 rows per tab.

## License

MIT. Dependencies retain their respective licenses.
