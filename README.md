# SheetInvoice

A free, open-source invoice tool backed by your own Google Sheet. Connect Google, create a private workbook, enter your business details, then save invoices and share PDFs. Works on phone and desktop.

There is no separate website account or password. The app is public; Google authorizes access to each user's chosen files. Business profiles, customers and invoice history belong to the connected workbook. New installations contain no business or customer details.

## Use it

1. Tap **Connect Google Sheet** on the invoice page and sign in to Google.
2. **Create private Sheet**, or choose an invoice workbook created by this tool through Google Drive.
3. A new Sheet opens **Business details**. Enter your business name, add any other details you need, then **Save & start invoicing**. Optional fields are under **More business details**. An existing Sheet with business details returns straight to the invoice.
4. Enter a customer and items, then **Save** or **Save & PDF**. Invoice number and date are filled automatically; expand **Invoice details** to edit them. New invoices are unpaid; tick **Mark as paid** when paid.
5. Use **Past transactions** to filter by customer and payment status, open an invoice or mark it paid.

To reuse items, open **Settings → Saved items → Edit in Google Sheet**. In the Sheet's **Saved items** tab, enter `Description`, `Quantity` and `Unit price (SGD)` under the existing column headings. Quantity defaults to 1 when blank; leave the price blank if it varies per invoice. Return to the app and choose **Refresh records**. Tap the saved-item tags below the customer details to add them; tapping the same description and price again increases its quantity. Tags show the quantity already added and keep focus for repeated taps. You can edit the line for that job. Up to 100 saved items are loaded per Sheet. Older workbooks get the tab through **Add saved items tab**.

Business defaults can also be edited directly in the Sheet's **Settings** tab: change the value beside Business name, Business address, Contact name, Business phone, Business email, UEN / registration, Payment instructions, Invoice footer or Review link. Keep the labels and `schema` row intact, then **Refresh records** in the app. For older workbooks, save Business details once in the app to replace the old JSON profile with these readable rows. Customers already have their own editable **Customers** tab. Refresh loads Sheet changes; existing invoice snapshots are preserved.

Business details, saved items, design and connection options are collapsed until needed. Any section containing an invalid form field opens automatically when you try to save.

To customise the PDF, open **Settings → Invoice design**. Older workbooks first need **Add invoice design tab**. Use **Edit in Google Sheet** and change the **Value** column in the **Invoice design** tab:

| Setting | Example / options |
| --- | --- |
| Accent colour | `#285D60` for headings and table lines |
| Text colour | `#233B37` for invoice text |
| Business alignment | `left`, `center` or `right` |
| Item text alignment | `left`, `center` or `right` for descriptions, address, payment and notes |
| Footer alignment | `left`, `center` or `right` |

Keep the Setting/Value/Options headings and setting labels intact. Blank values use the defaults. Colours use six-digit hex codes and must be readable on white (at least 4.5:1 contrast); invalid or too-light colours fall back to the default with a warning in Settings. Return to **Refresh records** to load edits. New invoices and unsaved new drafts use the Sheet's design. Saved invoices store their own design snapshot; reopening or marking them paid preserves it. Use **Apply design to current invoice** to restyle an existing invoice, then save. The PDF keeps its A4 layout and numeric columns.

Each Sheet has its own business profile. New invoices use that profile. Saved invoices retain their original seller/customer snapshot; opening an old invoice does not replace the Sheet's business settings. Editing Business details also applies them to the current invoice; save the profile and invoice separately when appropriate.

PDFs are created in the browser. **Share PDF** opens the device share menu; select WhatsApp and confirm the recipient yourself. Some receiving apps omit text when sharing a file; **Copy message** and **Open WhatsApp** provide the same invoice message. The review request appears only when your business profile has a review URL. Desktop browsers can download the PDF for manual attachment.

Your working invoice, business defaults, design and saved-item tags are automatically remembered in local storage. Refreshing or reopening the app restores them, including the invoice's record/revision IDs for safe reconnection. Only one current invoice is kept per browser profile; the last tab that saves locally wins. Use **Settings → This device → Clear this device’s data** or **Disconnect** to forget it. Clearing device data does not delete saved Google Sheets records.

Without Google configuration or a connection, you can enter business details, use remembered tags and generate a PDF. Saving to Google Sheets, loading customers and history require reconnecting Google. Access tokens and generated PDFs are never persisted; PDF-only generation clearly reports that it has not saved the invoice to Sheets.

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

**SheetInvoice reads and saves records in the Google Sheet you connect. It does not receive or store copies of those records or generated PDFs on an application server.** Processing runs in your browser, with direct requests to Google's APIs. This is different from saying the app never reads or saves anything.

The app includes a [Privacy & data page](https://rebgoh123.github.io/sheetinvoice/privacy/), linked beside Connect Google and from the footer. Self-hosted forks should review and update that notice to match their deployment.

- Keep the workbook's General access **Restricted**. Share only with individual people who should use it, as Editors. The app checks edit permission and refuses public, published, domain or group sharing before loading or saving.
- Records travel directly between the browser and Google's APIs. The static host does not receive invoice cells, access tokens or PDFs from the app. Like any website, its host may log ordinary page requests/IP addresses; Google receives the API requests.
- Your Google account ID and verified email identify the connection. The app also reads available workbook names, file metadata/permissions and the connected Sheet's business settings, customers, invoices and items. These are used to render the app, save your changes and generate PDFs.
- Local storage holds the current invoice (including customer details), business defaults, design, saved-item tags and account/Sheet/record IDs. It is readable by anyone using the same browser profile, even without Google sign-in. Tokens, verified email, the full customer list, transaction history and generated PDFs remain in memory. The app never stores tokens locally.
- Disconnect and Clear this device’s data remove remembered data and Sheet IDs, clear open SheetInvoice tabs (suspended tabs clear on resume) and leave saved Sheets records intact. They do not sign out of Google globally. Token expiry retains the working draft/defaults for reconnection. Detected permission/privacy failures clear remembered data. Account changes clear the previous account's working data. Previously downloaded or shared files cannot be recalled.
- No advertising, tracking scripts, analytics or paid tier are included. Google Identity and Picker load from Google's services.
- Device storage is one working copy, not a history backup. Private browsing, cleared browser storage or device loss can remove it; save important invoices to your Sheet. If storage is unavailable, the app reports it in Settings and keeps edits in the current tab only.

## Workbook and current limits

The app creates **Customers**, **Invoices**, **Invoice items**, **Settings**, **Saved items** and **Invoice design** tabs. Business details use readable key/value rows in Settings; older `seller` JSON profiles remain readable until saved in the new format. Invoice snapshots preserve the profile, items and design at the time of saving; older invoices without a design use the original defaults. Saved items and Invoice design are optional for existing workbooks. Invalid preset rows are skipped with a warning in Settings. Do not reorder/rename app columns. Existing invoice workbooks with the legacy `nls-invoice-v1` schema can also be chosen; their data is read only after Google authorization. Arbitrary spreadsheet layouts are not imported or overwritten.

This first version uses SGD, Singapore date/phone defaults, integer-cent totals and up to 40 items. It does not calculate tax, deposits or discounts. Invoice numbers are editable and unique within the selected workbook, not centrally sequential. Save retries use stable revision IDs. Concurrent editing has conflict detection but no transactional lock: avoid editing the same invoice on multiple devices at once. Customer updates are last-write-wins. Archive into a new workbook before reaching 10,000 rows per tab.

## License

MIT. Dependencies retain their respective licenses.
