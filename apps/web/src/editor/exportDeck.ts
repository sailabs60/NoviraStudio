import { jsPDF } from 'jspdf';
import { DECK_FORMATS, type DeckSlide, type PresentationDeck } from '@novira/shared';

/**
 * Deck export.
 *
 * The deck is data — an ordered list of typed slides — and this turns it into
 * the PDF that goes to a client. Built here rather than on the server for the
 * same reason the plan PDF is: the images are already in this tab, and round
 * -tripping a dozen megabytes of render through the API to get the same file
 * back would be slower and no better.
 *
 * Layout is decided per slide kind rather than by one generic template, because
 * a cover, a full-bleed render and a table of quantities want genuinely
 * different pages, and a template that suits all three suits none of them.
 */

const MARGIN = 14;

export async function exportDeckPdf(deck: PresentationDeck, filename: string): Promise<void> {
  const format = DECK_FORMATS[deck.format];
  const orientation = format.widthMm >= format.heightMm ? 'landscape' : 'portrait';
  const doc = new jsPDF({
    orientation,
    unit: 'mm',
    format: [Math.max(format.widthMm, format.heightMm), Math.min(format.widthMm, format.heightMm)],
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const slides = deck.slides.filter((slide) => !slide.hidden);

  /*
   * Images are fetched and measured up front. jsPDF needs the pixel dimensions
   * to preserve an aspect ratio, and doing it slide by slide inside the render
   * loop would mean a page is laid out before its image has loaded.
   */
  const images = await loadImages(slides);

  for (const [index, slide] of slides.entries()) {
    if (index > 0) doc.addPage();
    paintSlide(doc, deck, slide, images, pageWidth, pageHeight, index, slides.length);
  }

  doc.save(filename);
}

interface LoadedImage {
  dataUrl: string;
  width: number;
  height: number;
}

async function loadImages(slides: DeckSlide[]): Promise<Map<string, LoadedImage>> {
  const urls = [...new Set(slides.flatMap((slide) => slide.images))];
  const entries = await Promise.all(
    urls.map(async (url) => {
      try {
        const image = await loadImage(url);
        return [url, image] as const;
      } catch {
        // A missing image is a slide laid out as text, not a failed export.
        return null;
      }
    })
  );
  return new Map(entries.filter(Boolean) as Array<readonly [string, LoadedImage]>);
}

function loadImage(url: string): Promise<LoadedImage> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    // Same-origin assets do not need this, but a render mirrored to another
    // host would taint the canvas without it.
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      if (url.startsWith('data:')) {
        resolve({ dataUrl: url, width: image.naturalWidth, height: image.naturalHeight });
        return;
      }
      try {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no context');
        ctx.drawImage(image, 0, 0);
        resolve({ dataUrl: canvas.toDataURL('image/jpeg', 0.88), width: canvas.width, height: canvas.height });
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = reject;
    image.src = url;
  });
}

function hexToRgb(hex: string): [number, number, number] {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!match) return [17, 24, 39];
  return [parseInt(match[1]!, 16), parseInt(match[2]!, 16), parseInt(match[3]!, 16)];
}

function paintSlide(
  doc: jsPDF,
  deck: PresentationDeck,
  slide: DeckSlide,
  images: Map<string, LoadedImage>,
  pageWidth: number,
  pageHeight: number,
  index: number,
  total: number
) {
  const primary = hexToRgb(deck.theme.primaryColor);
  const text = hexToRgb(deck.theme.textColor);
  const background = hexToRgb(deck.theme.backgroundColor);

  doc.setFillColor(background[0], background[1], background[2]);
  doc.rect(0, 0, pageWidth, pageHeight, 'F');

  /* ── Cover ───────────────────────────────────────────────────────────── */

  if (slide.kind === 'cover') {
    const hero = slide.images[0] ? images.get(slide.images[0]) : undefined;
    if (hero) {
      // Full bleed, cropped to fill rather than letterboxed — a cover with grey
      // bars down the sides is the first thing a client sees.
      const ratio = hero.width / hero.height;
      const pageRatio = pageWidth / pageHeight;
      let drawWidth = pageWidth;
      let drawHeight = pageWidth / ratio;
      if (ratio < pageRatio) {
        drawHeight = pageHeight;
        drawWidth = pageHeight * ratio;
      }
      doc.addImage(hero.dataUrl, 'JPEG', (pageWidth - drawWidth) / 2, (pageHeight - drawHeight) / 2, drawWidth, drawHeight);
      // A scrim, so white type over a bright render stays readable.
      doc.setFillColor(0, 0, 0);
      doc.setGState(new (doc as unknown as { GState: new (o: object) => unknown }).GState({ opacity: 0.45 }));
      doc.rect(0, 0, pageWidth, pageHeight, 'F');
      doc.setGState(new (doc as unknown as { GState: new (o: object) => unknown }).GState({ opacity: 1 }));
    } else {
      doc.setFillColor(primary[0], primary[1], primary[2]);
      doc.rect(0, 0, pageWidth, 6, 'F');
    }

    const onImage = Boolean(hero);
    doc.setTextColor(onImage ? 255 : text[0], onImage ? 255 : text[1], onImage ? 255 : text[2]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(30);
    doc.text(wrap(doc, slide.title, pageWidth - MARGIN * 2), MARGIN, pageHeight * 0.52);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(12);
    if (slide.body) doc.text(slide.body, MARGIN, pageHeight * 0.52 + 12);

    doc.setFontSize(9);
    for (const [i, bullet] of slide.bullets.entries()) {
      doc.text(bullet, MARGIN, pageHeight * 0.52 + 20 + i * 5);
    }

    if (deck.theme.brandName) {
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text(deck.theme.brandName, pageWidth - MARGIN, pageHeight - MARGIN, { align: 'right' });
    }
    return;
  }

  /* ── Full-bleed render ───────────────────────────────────────────────── */

  if (slide.kind === 'hero-render' && slide.images[0] && images.has(slide.images[0])) {
    const hero = images.get(slide.images[0])!;
    const ratio = hero.width / hero.height;
    let drawWidth = pageWidth;
    let drawHeight = pageWidth / ratio;
    if (drawHeight < pageHeight) {
      drawHeight = pageHeight;
      drawWidth = pageHeight * ratio;
    }
    doc.addImage(hero.dataUrl, 'JPEG', (pageWidth - drawWidth) / 2, (pageHeight - drawHeight) / 2, drawWidth, drawHeight);

    doc.setFillColor(0, 0, 0);
    doc.setGState(new (doc as unknown as { GState: new (o: object) => unknown }).GState({ opacity: 0.55 }));
    doc.rect(0, pageHeight - 24, pageWidth, 24, 'F');
    doc.setGState(new (doc as unknown as { GState: new (o: object) => unknown }).GState({ opacity: 1 }));

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(slide.title, MARGIN, pageHeight - 13);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(wrap(doc, slide.body, pageWidth - MARGIN * 2), MARGIN, pageHeight - 7);
    footer(doc, deck, pageWidth, pageHeight, index, total, true);
    return;
  }

  /* ── Standard page ───────────────────────────────────────────────────── */

  doc.setFillColor(primary[0], primary[1], primary[2]);
  doc.rect(0, 0, pageWidth, 4, 'F');

  doc.setTextColor(text[0], text[1], text[2]);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(19);
  doc.text(slide.title, MARGIN, MARGIN + 8);

  let cursor = MARGIN + 16;

  if (slide.body) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(70, 80, 96);
    const lines = wrap(doc, slide.body, pageWidth - MARGIN * 2);
    doc.text(lines, MARGIN, cursor);
    cursor += lines.length * 5 + 4;
  }

  if (slide.bullets.length) {
    doc.setFontSize(10);
    doc.setTextColor(text[0], text[1], text[2]);
    for (const bullet of slide.bullets) {
      const lines = wrap(doc, `•  ${bullet}`, pageWidth - MARGIN * 2 - 4);
      doc.text(lines, MARGIN + 2, cursor);
      cursor += lines.length * 5 + 1.5;
    }
    cursor += 3;
  }

  /* Images, laid out in a row that fits the remaining height. */
  const available = pageHeight - cursor - 16;
  const usable = slide.images.map((url) => images.get(url)).filter(Boolean) as LoadedImage[];

  if (usable.length && available > 30) {
    const gap = 3;
    const columns = Math.min(usable.length, usable.length === 1 ? 1 : usable.length <= 4 ? 2 : 3);
    const rows = Math.ceil(usable.length / columns);
    const cellWidth = (pageWidth - MARGIN * 2 - gap * (columns - 1)) / columns;
    const cellHeight = Math.min((available - gap * (rows - 1)) / rows, cellWidth * 0.62);

    for (const [i, image] of usable.entries()) {
      const column = i % columns;
      const row = Math.floor(i / columns);
      const ratio = image.width / image.height;
      let drawWidth = cellWidth;
      let drawHeight = cellWidth / ratio;
      if (drawHeight > cellHeight) {
        drawHeight = cellHeight;
        drawWidth = cellHeight * ratio;
      }
      doc.addImage(
        image.dataUrl,
        'JPEG',
        MARGIN + column * (cellWidth + gap) + (cellWidth - drawWidth) / 2,
        cursor + row * (cellHeight + gap),
        drawWidth,
        drawHeight
      );
    }
    cursor += rows * (cellHeight + gap);
  }

  /* Tables, which is how quantities and commercials are carried. */
  if (slide.table && cursor < pageHeight - 24) {
    const columns = slide.table.columns.length;
    const widths = columnWidths(slide.kind, columns, pageWidth - MARGIN * 2);
    let y = cursor + 2;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    let x = MARGIN;
    for (const [i, column] of slide.table.columns.entries()) {
      doc.text(column, x, y);
      x += widths[i]!;
    }
    y += 2;
    doc.setDrawColor(200, 206, 214);
    doc.line(MARGIN, y, pageWidth - MARGIN, y);
    y += 4;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(text[0], text[1], text[2]);

    for (const row of slide.table.rows) {
      // Continue onto a new page rather than running off the bottom, which is
      // what a bill of quantities with sixty lines will otherwise do.
      if (y > pageHeight - 14) {
        doc.addPage();
        doc.setFillColor(background[0], background[1], background[2]);
        doc.rect(0, 0, pageWidth, pageHeight, 'F');
        doc.setFillColor(primary[0], primary[1], primary[2]);
        doc.rect(0, 0, pageWidth, 4, 'F');
        doc.setTextColor(text[0], text[1], text[2]);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.text(`${slide.title} (continued)`, MARGIN, MARGIN + 6);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        y = MARGIN + 14;
      }

      x = MARGIN;
      for (const [i, cell] of row.entries()) {
        const truncated = truncate(doc, String(cell ?? ''), widths[i]! - 2);
        doc.text(truncated, x, y);
        x += widths[i]!;
      }
      y += 4.4;
    }
  }

  footer(doc, deck, pageWidth, pageHeight, index, total, false);
}

/**
 * Column widths.
 *
 * A bill of quantities is mostly description and needs the room; a two-column
 * commercial summary wants the number hard right. Giving every table equal
 * columns produces a description truncated at four words next to an empty
 * "unit" column.
 */
function columnWidths(kind: DeckSlide['kind'], columns: number, total: number): number[] {
  if (kind === 'quantities' && columns === 5) {
    return [0.12, 0.3, 0.1, 0.08, 0.4].map((share) => share * total);
  }
  if (kind === 'commercials' && columns === 2) return [0.7 * total, 0.3 * total];
  if (kind === 'specification' && columns === 3) return [0.22 * total, 0.26 * total, 0.52 * total];
  return Array.from({ length: columns }, () => total / columns);
}

function footer(
  doc: jsPDF,
  deck: PresentationDeck,
  pageWidth: number,
  pageHeight: number,
  index: number,
  total: number,
  light: boolean
) {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(light ? 220 : 140, light ? 220 : 150, light ? 220 : 165);

  const left = [deck.theme.brandName, deck.theme.footerText].filter(Boolean).join(' · ');
  if (left) doc.text(left, MARGIN, pageHeight - 5);

  doc.text(`${index + 1} / ${total}`, pageWidth - MARGIN, pageHeight - 5, { align: 'right' });

  if (deck.theme.showPlatformCredit) {
    doc.text('Made with Novira', pageWidth / 2, pageHeight - 5, { align: 'center' });
  }
}

function wrap(doc: jsPDF, text: string, width: number): string[] {
  return doc.splitTextToSize(text || '', width) as string[];
}

function truncate(doc: jsPDF, text: string, width: number): string {
  if (doc.getTextWidth(text) <= width) return text;
  let cut = text;
  while (cut.length > 1 && doc.getTextWidth(`${cut}…`) > width) cut = cut.slice(0, -1);
  return `${cut}…`;
}
