import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { formatMoney, invoiceTotal, lineTotal, priceInCents, validateInvoice, displayDate } from "./invoice.mjs";
import { normalizeDesign } from './invoice-design.mjs';

const W = 595.28, H = 841.89, M = 32, ROW = 22;
const COL = [M, 58, 352, 412, 472, W - M];
const red = rgb(0.71, 0.19, 0.19);
const colorChannels = hex => hex.slice(1).match(/../g).map(channel => parseInt(channel, 16) / 255);
const canvasFonts = 'Arial, "PingFang SC", "Heiti SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';

export async function generateInvoicePdf(invoice) {
  const errors = validateInvoice(invoice);
  if (errors.length) throw new Error(errors[0]);
  const design = normalizeDesign(invoice.design);
  const accent = rgb(...colorChannels(design.accentColor)), ink = rgb(...colorChannels(design.textColor));
  const grid = rgb(...colorChannels(design.accentColor).map(channel => channel * 0.65 + 0.35));
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const serif = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  pdf.setTitle(`Invoice ${invoice.number}`);
  pdf.setAuthor(invoice.seller.name);
  pdf.setSubject(`Invoice for ${invoice.customer.name}`);
  pdf.setCreator("SheetInvoice");
  let page, y, bodyTop, bodyBottom;
  const pages = [];
  const encodable = (text, font) => { try { font.encodeText(text); return true; } catch { return false; } };

  function canvasText(text, size, font) {
    if (typeof document === "undefined") throw new Error("Unicode customer text needs a browser to generate this invoice.");
    const canvas = document.createElement("canvas"), context = canvas.getContext("2d");
    if (!context) throw new Error("Your browser could not render the invoice text.");
    context.font = `${font === bold || font === serif ? "700" : "400"} ${size}px ${canvasFonts}`;
    return { canvas, context, width: context.measureText(text).width };
  }
  const width = (text, size, font = regular) => encodable(text, font)
    ? font.widthOfTextAtSize(text, size) : canvasText(text, size, font).width;
  const fit = (text, maxWidth, size, font = regular, minimum = 7) => Math.max(minimum, Math.min(size, size * maxWidth / Math.max(1, width(text, size, font))));

  async function draw(text, x, top, size = 10, font = regular, color = ink, align = "left") {
    if (!text) return;
    const measured = width(text, size, font);
    if (align === "right") x -= measured;
    if (align === "center") x -= measured / 2;
    if (encodable(text, font)) page.drawText(text, { x, y: H - top - size, size, font, color });
    else {
      const { canvas, context } = canvasText(text, size, font);
      const scale = 3, height = size * 1.65;
      canvas.width = Math.ceil((measured + 3) * scale); canvas.height = Math.ceil(height * scale);
      context.scale(scale, scale);
      context.font = `${font === bold || font === serif ? "700" : "400"} ${size}px ${canvasFonts}`;
      context.fillStyle = `rgb(${color.red * 255}, ${color.green * 255}, ${color.blue * 255})`;
      context.textBaseline = "top"; context.fillText(text, 0, 0);
      const image = await pdf.embedPng(canvas.toDataURL("image/png"));
      page.drawImage(image, { x, y: H - top - height, width: canvas.width / scale, height });
    }
  }
  async function aligned(text, left, right, top, size, font, color, align) {
    const x = align === 'right' ? right : align === 'center' ? (left + right) / 2 : left;
    await draw(text, x, top, size, font, color, align);
  }
  function wrap(text, maxWidth, size = 10, font = regular) {
    const result = [];
    for (const paragraph of String(text).replace(/\r/g, "").split("\n")) {
      let current = "";
      for (const word of paragraph.split(/(\s+)/)) {
        if (width(current + word, size, font) <= maxWidth) { current += word; continue; }
        if (current.trim()) { result.push(current.trimEnd()); current = ""; }
        for (const character of word.trimStart()) {
          if (current && width(current + character, size, font) > maxWidth) { result.push(current); current = ""; }
          current += character;
        }
      }
      result.push(current.trimEnd());
    }
    return result;
  }
  function rule(x1, top1, x2, top2, thickness = 0.55) {
    page.drawLine({ start: { x: x1, y: H - top1 }, end: { x: x2, y: H - top2 }, thickness, color: grid });
  }
  // Fixed letterhead/footer fields are paragraphs; blank lines must not consume the page.
  const paragraph = text => text.replace(/\s+/g, ' ').trim();
  const terms = invoice.seller.terms.trim() ? wrap(paragraph(invoice.seller.terms), W - 2 * M, 8, italic) : [];
  const bodyLimit = Math.min(H - 143, H - 124 - terms.length * 11);

  async function letterhead() {
    const headingWidth = W - 2 * M;
    let top = 30;
    const titleSize = fit(invoice.seller.name.trim(), headingWidth, 25, serif, 13);
    for (const text of wrap(invoice.seller.name.trim(), headingWidth, titleSize, serif)) {
      await aligned(text, M, W - M, top, titleSize, serif, accent, design.businessAlign); top += titleSize + 5;
    }
    top += 5;
    const details = [invoice.seller.address, [invoice.seller.contact, invoice.seller.phone].filter(Boolean).join(' | '), invoice.seller.email, invoice.seller.registration.trim() ? `Registration: ${invoice.seller.registration.trim()}` : ''];
    for (const detail of details) if (detail.trim()) {
      for (const text of wrap(paragraph(detail), headingWidth, 10)) {
        await aligned(text, M, W - M, top, 10, regular, accent, design.businessAlign); top += 15;
      }
    }
    return Math.max(82, top);
  }
  async function firstPage() {
    page = pdf.addPage([W, H]);
    const top = (await letterhead()) + 16;
    await draw(invoice.status === 'paid' ? 'PAID' : 'UNPAID', 413, top + 2, 10, bold, invoice.status === 'paid' ? rgb(0.12, 0.40, 0.28) : red);
    await draw("INVOICE", COL[5], top, 13, bold, accent, "right");
    const names = wrap(invoice.customer.name.trim(), 305, 11);
    if (invoice.customer.phone.trim()) names.push(invoice.customer.phone.trim());
    const messrsTop = top + 15;
    await draw("Bill to:", M, messrsTop, 11, regular, accent);
    for (let index = 0; index < Math.max(3, names.length); index++) {
      await draw(names[index] || "", M + 53, messrsTop + index * 23, 11);
      rule(M + 51, messrsTop + index * 23 + 18, 392, messrsTop + index * 23 + 18);
    }
    const numberTop = top + 27;
    await draw("No.:", 413, numberTop + 3, 10.5, bold, accent);
    const numberSize = fit(invoice.number, 117, 18, regular, 10);
    const numberLines = wrap(invoice.number, 121, numberSize);
    for (const [index, text] of numberLines.entries()) await draw(text, 442, numberTop + index * (numberSize + 4), numberSize, regular, accent);
    const dateTop = Math.max(top + 61, numberTop + numberLines.length * (numberSize + 4) + 9);
    await draw("Date:", 413, dateTop, 10.5, bold, accent);
    await draw(displayDate(invoice.date), 448, dateTop, 11);
    rule(446, dateTop + 18, COL[5], dateTop + 18);
    await table(Math.max(dateTop + 31, messrsTop + Math.max(3, names.length) * 23 + 15));
  }
  async function continuedPage() {
    page = pdf.addPage([W, H]);
    const titleSize = fit(invoice.seller.name.trim(), 360, 16, serif, 10);
    const titleLines = wrap(invoice.seller.name.trim(), 360, titleSize, serif);
    for (const [index, text] of titleLines.entries()) await aligned(text, M, W - M, 29 + index * (titleSize + 4), titleSize, serif, accent, design.businessAlign);
    const metaTop = Math.max(59, 33 + titleLines.length * (titleSize + 4));
    await draw("INVOICE - CONTINUED", W - M, metaTop, 9, bold, accent, "right");
    const numberLines = wrap(invoice.number, 400, 10);
    for (const [index, text] of numberLines.entries()) await draw(text, M, metaTop + 15 + index * 14, 10, regular, accent);
    await table(metaTop + 42 + Math.max(0, numberLines.length - 1) * 14);
  }
  async function table(top) {
    bodyTop = top + 26;
    bodyBottom = bodyTop + Math.floor((bodyLimit - bodyTop) / ROW) * ROW;
    for (const x of COL) rule(x, top, x, bodyBottom);
    rule(M, top, W - M, top);
    for (let row = bodyTop; row <= bodyBottom + 0.1; row += ROW) rule(M, row, W - M, row);
    for (const [index, label] of [[1, "Description"], [2, "Quantity"], [3, "U. Price"], [4, "Amount"]]) {
      await draw(label, (COL[index] + COL[index + 1]) / 2, top + 8, index === 2 ? 9 : 10, regular, accent, "center");
    }
    pages.push({ page, bodyBottom }); y = bodyTop;
  }
  async function ensureRows(count) { if (y + count * ROW > bodyBottom + 0.1) await continuedPage(); }
  function gap() { if (y > bodyTop && y + ROW <= bodyBottom) y += ROW; }
  async function section(label, content) {
    if (!content.trim()) return;
    gap(); await ensureRows(2);
    await aligned(label, COL[1] + 7, COL[2] - 7, y + 6, 9, bold, accent, design.itemAlign); y += ROW;
    for (const text of wrap(content.trim(), COL[2] - COL[1] - 14, 10)) {
      await ensureRows(1); await aligned(text, COL[1] + 7, COL[2] - 7, y + 5, 10, regular, ink, design.itemAlign); y += ROW;
    }
  }
  await firstPage();
  for (const [index, item] of invoice.items.entries()) {
    const lines = wrap(item.description.trim(), COL[2] - COL[1] - 14, 10.5);
    await ensureRows(lines.length);
    await draw(String(index + 1), (COL[0] + COL[1]) / 2, y + 6, 9, regular, accent, "center");
    await draw(String(Number(item.quantity)), (COL[2] + COL[3]) / 2, y + 6, 10, regular, ink, "center");
    for (const [value, right, maxWidth] of [[formatMoney(priceInCents(item.price)), COL[4] - 6, COL[4] - COL[3] - 12], [formatMoney(lineTotal(item)), COL[5] - 6, COL[5] - COL[4] - 12]]) {
      await draw(value, right, y + 6, fit(value, maxWidth, 10, regular), regular, ink, "right");
    }
    for (const text of lines) { await aligned(text, COL[1] + 7, COL[2] - 7, y + 5, 10.5, regular, ink, design.itemAlign); y += ROW; }
  }
  await section("Service address", invoice.customer.address);
  if (invoice.status !== 'paid') await section("Payment", invoice.seller.payment);
  await section("Notes", invoice.notes);

  for (const [index, record] of pages.entries()) {
    page = record.page;
    const bottom = record.bodyBottom;
    if (index === pages.length - 1) {
      rule(COL[4], bottom, COL[4], bottom + 27);
      rule(COL[5], bottom, COL[5], bottom + 27);
      rule(COL[4], bottom + 27, COL[5], bottom + 27);
      await draw("Total Amount", COL[4] - 9, bottom + 8, 11, bold, accent, "right");
      const amount = formatMoney(invoiceTotal(invoice));
      await draw(amount, COL[5] - 7, bottom + 7, fit(amount, COL[5] - COL[4] - 14, 13, regular), regular, ink, "right");
      for (const [lineIndex, text] of terms.entries()) await aligned(text, M, W - M, bottom + 38 + lineIndex * 11, 8, italic, accent, design.footerAlign);
      const signatureTop = H - 68;
      rule(M, signatureTop, M + 220, signatureTop);
      rule(W - M - 220, signatureTop, W - M, signatureTop);
      await draw("RECEIVED BY", M + 110, signatureTop + 7, 8.8, regular, accent, "center");
      await draw("AUTHORISED SIGNATURE", W - M - 110, signatureTop + 7, 9, regular, accent, "center");
    } else await draw("Continued on next page", W - M, bottom + 10, 9, regular, accent, "right");
    await draw("All amounts in SGD.", M, H - 24, 7, regular, accent);
    await draw(`${index + 1} / ${pages.length}`, W - M, H - 24, 7, regular, accent, "right");
  }
  return pdf.save();
}
