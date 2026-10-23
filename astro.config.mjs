import { defineConfig } from 'astro/config';

const base = process.env.PUBLIC_BASE_PATH || '/';
if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base)) throw new Error('PUBLIC_BASE_PATH must be a slash-delimited path, such as /sheetinvoice/.');

export default defineConfig({
  site: process.env.PUBLIC_SITE_URL || undefined,
  base,
  output: 'static',
  trailingSlash: 'always',
});
