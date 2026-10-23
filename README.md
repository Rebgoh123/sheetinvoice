# SheetInvoice

A free, open-source invoice tool backed by your own Google Sheet. Connect Google, create a private workbook, enter your business details, then save invoices and share PDFs. Works on phone and desktop.

There is no separate website account or password. The app is public; Google authorizes access to each user's chosen files. Business profiles, customers and invoice history belong to the connected workbook. New installations contain no business or customer details.

## Use it

1. Open **Settings → Connect Google**.
2. **Create private Sheet**, or choose an invoice workbook created by this tool through Google Drive.
3. Fill in **Business details** and save them to the Sheet: business name, address, contact, phone, email, registration, payment instructions, invoice footer and optional review URL. Keep any unused fields blank.
4. Return to **Invoice**, enter a customer and items, then **Save** or **Save & PDF**. New invoices are unpaid; tick **Mark as paid** when paid.
5. Use **Past transactions** to filter by customer and payment status, open an invoice or mark it paid.

Each Sheet has its own business profile. New invoices use that profile. Saved invoices retain their original seller/customer snapshot; opening an old invoice does not replace the Sheet's business settings. Editing Business details also applies them to the current invoice; save the profile and invoice separately when appropriate.

PDFs are created in the browser. **Share PDF** opens the device share menu; select WhatsApp and confirm the recipient yourself. Some receiving apps omit text when sharing a file; **Copy message** and **Open WhatsApp** provide the same invoice message. The review request appears only when your business profile has a review URL. Desktop browsers can download the PDF for manual attachment.

Without Google configuration or a connection, you can enter business details in Settings and generate a PDF in the current tab. Saving and history require a connected Sheet. Reconnect when Google's short-lived authorization expires.

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
4. Create a browser API key restricted to **Google Picker API** and **Google Drive API**. Restrict website referrers to your deployed app, for example `https://YOUR_USERNAME.github.io/sheetinvoice/*`, and `https://docs.google.com/*` for Picker. Only add local referrers when developing.
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

- Keep the workbook's General access **Restricted**. Share only with individual people who should use it, as Editors. The app checks edit permission and refuses public, published, domain or group sharing before loading or saving.
- Records travel directly between the browser and Google's APIs. The static host does not receive invoice cells, access tokens or PDFs from the app. Like any website, its host may log ordinary page requests/IP addresses; Google receives the API requests.
- Tokens, loaded records and drafts remain in memory. Only the selected Sheet ID per Google user is remembered in browser local storage; an ID grants no access. Shared-device users should Disconnect when finished.
- Disconnect clears the tab's loaded records, profile, draft and generated PDF. It leaves saved Sheets data intact and does not sign out of Google globally. Token expiry clears loaded lists and retains a dirty draft for reconnecting. Revoked access clears the tab's data. Previously downloaded or shared files cannot be recalled.
- No advertising, tracking scripts, analytics or paid tier are included. Google Identity and Picker load from Google's services.
- Unsaved edits disappear on reload/tab closure. Save to Sheets before leaving; mobile browsers may not display the leave-page warning.

## Workbook and current limits

The app creates **Customers**, **Invoices**, **Invoice items** and **Settings** tabs. Business details are stored as the `seller` JSON value in Settings; invoice snapshots preserve the profile at the time of saving. Do not reorder/rename app columns. Existing invoice workbooks with the legacy `nls-invoice-v1` schema can also be chosen; their data is read only after Google authorization. Arbitrary spreadsheet layouts are not imported or overwritten.

This first version uses SGD, Singapore date/phone defaults, integer-cent totals and up to 40 items. It does not calculate tax, deposits or discounts. Invoice numbers are editable and unique within the selected workbook, not centrally sequential. Save retries use stable revision IDs. Concurrent editing has conflict detection but no transactional lock: avoid editing the same invoice on multiple devices at once. Customer updates are last-write-wins. Archive into a new workbook before reaching 10,000 rows per tab.

## License

MIT. Dependencies retain their respective licenses.
