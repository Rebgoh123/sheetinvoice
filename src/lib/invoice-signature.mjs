// Small, self-contained PNGs fit in Sheet settings and historical invoice snapshots.
export const MAX_SIGNATURE_LENGTH = 24000;
export function normalizeSignatureImage(value) {
  if (typeof value !== 'string' || value.length > MAX_SIGNATURE_LENGTH || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return '';
  try {
    const bytes = atob(value.slice(22));
    if (bytes.length < 33 || bytes.slice(0, 8) !== '\x89PNG\r\n\x1a\n' || bytes.slice(12, 16) !== 'IHDR') return '';
    const number = start => [...bytes.slice(start, start + 4)].reduce((n, ch) => n * 256 + ch.charCodeAt(0), 0);
    return number(8) === 13 && number(16) > 0 && number(16) <= 600 && number(20) > 0 && number(20) <= 180 ? value : '';
  } catch { return ''; }
}

export async function loadSignatureImage(source) {
  const image = new Image();
  image.src = source;
  await image.decode();
  return image;
}

export async function prepareSignatureImage(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file?.type)) throw new Error('Choose a PNG, JPG or WebP signature image.');
  if (!file.size || file.size > 8 * 1024 * 1024) throw new Error('Choose a signature image smaller than 8 MB.');
  const url = URL.createObjectURL(file), canvas = document.createElement('canvas');
  try {
    const image = await loadSignatureImage(url);
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 24000000) throw new Error('Crop the image to your signature and try again.');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser could not prepare the signature image.');
    for (const maxWidth of [600, 480, 360, 240, 160]) {
      const scale = Math.min(1, maxWidth / image.naturalWidth, (maxWidth * 0.3) / image.naturalHeight);
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/png');
      if (normalizeSignatureImage(data)) return data;
    }
    throw new Error('Crop the image to your signature and try again.');
  } catch (error) {
    if (error.name === 'EncodingError') throw new Error('This image could not be opened. Try a PNG or JPG.');
    throw error;
  } finally { URL.revokeObjectURL(url); canvas.width = canvas.height = 1; }
}
