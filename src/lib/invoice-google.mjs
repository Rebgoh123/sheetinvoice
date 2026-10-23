import { DRIVE_SCOPE, SheetsError } from './invoice-sheets.mjs';

const scripts = new Map();
function script(url) {
  if (scripts.has(url)) return scripts.get(url);
  const promise = new Promise((resolve, reject) => {
    const element = document.createElement('script');
    const timeout = setTimeout(() => { element.remove(); scripts.delete(url); reject(new SheetsError('Google took too long to load. Check your connection and try again.', 'network')); }, 20000);
    element.src = url; element.async = true;
    element.onload = () => { clearTimeout(timeout); resolve(); };
    element.onerror = () => { clearTimeout(timeout); element.remove(); scripts.delete(url); reject(new SheetsError('Google could not load. Check your connection and try again.', 'network')); };
    document.head.append(element);
  });
  scripts.set(url, promise);
  return promise;
}

export async function prepareGoogle(config, onToken, onError) {
  if (!/^\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(config.clientId || '')) {
    throw new SheetsError('Google connection needs its one-time website setup. You can still make a PDF below.', 'configuration');
  }
  await script('https://accounts.google.com/gsi/client');
  return window.google.accounts.oauth2.initTokenClient({
    client_id: config.clientId,
    scope: `openid email ${DRIVE_SCOPE}`,
    include_granted_scopes: false,
    callback: response => {
      if (response.error || !response.access_token) { onError(new SheetsError('Google connection was cancelled or permission was not granted.', 'permission')); return; }
      if (!window.google.accounts.oauth2.hasGrantedAllScopes(response, DRIVE_SCOPE)) {
        onError(new SheetsError('Allow access to the selected Sheet and your Google account email, then try connecting again.', 'permission')); return;
      }
      const duration = Number(response.expires_in);
      onToken({ token: response.access_token, expiresAt: Date.now() + (Number.isFinite(duration) ? Math.max(0, duration - 30) : 0) * 1000 });
    },
    error_callback: () => onError(new SheetsError('Google sign-in was closed or blocked. Try the connection button again and allow the sign-in popup. Your draft is still here.', 'popup')),
  });
}

export async function preparePicker(config) {
  if (!config.apiKey || !/^\d+$/.test(config.appId || '')) throw new SheetsError('Choosing an existing Sheet needs the Google Picker configuration.', 'configuration');
  await script('https://apis.google.com/js/api.js');
  await new Promise((resolve, reject) => window.gapi.load('picker', { callback: resolve, onerror: () => reject(new SheetsError('Google’s Sheet picker could not load.', 'network')), timeout: 15000, ontimeout: () => reject(new SheetsError('Google’s Sheet picker took too long to load.', 'network')) }));
}

export function chooseSheet(config, token) {
  return new Promise((resolve, reject) => {
    const picker = window.google.picker;
    if (!picker || !token) { reject(new SheetsError('Connect Google before choosing a Sheet.', 'expired')); return; }
    const view = new picker.DocsView(picker.ViewId.SPREADSHEETS).setIncludeFolders(false);
    const dialog = new picker.PickerBuilder().setDeveloperKey(config.apiKey).setAppId(config.appId)
      .setOAuthToken(token).setOrigin(window.location.origin).setTitle('Choose your private invoice Sheet')
      .addView(view).setCallback(data => {
        if (data.action === picker.Action.PICKED) { const id = data.docs?.[0]?.id; if (id) resolve(id); else reject(new SheetsError('Google did not return a Sheet.', 'file')); }
        if (data.action === picker.Action.CANCEL) resolve(null);
      }).build();
    dialog.setVisible(true);
  });
}
