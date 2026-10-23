export const DESIGN_SETTINGS = {
  accentColor: { label: 'Accent colour', value: '#243869', options: 'Dark hex colour, e.g. #285D60. Used for headings and table lines.' },
  textColor: { label: 'Text colour', value: '#1A1F29', options: 'Dark hex colour, e.g. #233B37. Used for invoice text.' },
  businessAlign: { label: 'Business alignment', value: 'left', options: 'left, center or right. Business name and contact details.' },
  itemAlign: { label: 'Item text alignment', value: 'left', options: 'left, center or right. Descriptions, service address, payment and notes.' },
  footerAlign: { label: 'Footer alignment', value: 'left', options: 'left, center or right. Invoice footer text.' },
};
export const defaultDesign = Object.fromEntries(Object.entries(DESIGN_SETTINGS).map(([key, setting]) => [key, setting.value]));

function readableColor(value) {
  if (!/^#[0-9a-f]{6}$/i.test(value)) return false;
  const channels = value.slice(1).match(/../g).map(hex => {
    const channel = parseInt(hex, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return 1.05 / (luminance + 0.05) >= 4.5;
}
function validValue(key, value) {
  return key.endsWith('Color') ? readableColor(value) : ['left', 'center', 'right'].includes(value);
}
export function normalizeDesign(source) {
  return Object.fromEntries(Object.entries(defaultDesign).map(([key, fallback]) => {
    const value = typeof source?.[key] === 'string' ? source[key].trim().toLowerCase() : '';
    return [key, validValue(key, value) ? (key.endsWith('Color') ? value.toUpperCase() : value) : fallback];
  }));
}
export function validateDesign(source) {
  return Object.entries(DESIGN_SETTINGS).flatMap(([key, setting]) => {
    const value = source?.[key];
    if (value === undefined || value === '') return [];
    if (typeof value === 'string' && validValue(key, value.trim().toLowerCase())) return [];
    return [`${setting.label}: ${key.endsWith('Color') ? 'use a dark #RRGGBB colour that is readable on white' : 'use left, center or right'}.`];
  });
}
