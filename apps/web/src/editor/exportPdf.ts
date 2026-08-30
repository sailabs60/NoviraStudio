import { jsPDF } from 'jspdf';
import {
  deriveStage,
  formatArea,
  formatLength,
  polygonArea,
  segmentLength,
  type SceneDocument,
  type StageSceneObject,
  type UnitSystem,
} from '@novira/shared';
import { captureViewport } from './capture';

/**
 * PDF export.
 *
 * Not a screenshot in a wrapper. A plan that goes to a client or a crew needs
 * the numbers alongside the picture, so the document carries a schedule of what
 * is in the plan, the room dimensions, and — where a stage is present — its
 * derived parts list, which is the page the load-in crew actually wants.
 *
 * Generated client-side because the rendered view already lives here; sending a
 * multi-megabyte canvas to the server to have it sent back would be slower and
 * no better.
 */

export interface PdfOptions {
  title: string;
  units: UnitSystem;
  scene: SceneDocument;
  /** Resolved catalogue names, so the schedule reads properly. */
  itemNames: Record<number, string>;
  companyName?: string | null;
  orientation?: 'landscape' | 'portrait';
}

const MARGIN = 14;

export function exportPlanPdf(options: PdfOptions): boolean {
  const image = captureViewport();
  if (!image) return false;

  const orientation = options.orientation ?? 'landscape';
  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  drawHeader(doc, options, pageWidth);

  /* ── The view ──────────────────────────────────────────────────────── */
  const imageTop = MARGIN + 16;
  const available = { width: pageWidth - MARGIN * 2, height: pageHeight - imageTop - 22 };

  // Preserve the canvas aspect ratio rather than stretching the plan.
  const canvas = document.querySelector('canvas');
  const ratio = canvas ? canvas.width / canvas.height : 16 / 9;
  let drawWidth = available.width;
  let drawHeight = drawWidth / ratio;
  if (drawHeight > available.height) {
    drawHeight = available.height;
    drawWidth = drawHeight * ratio;
  }
  const x = (pageWidth - drawWidth) / 2;

  doc.addImage(image, 'PNG', x, imageTop, drawWidth, drawHeight, undefined, 'FAST');
  doc.setDrawColor(200);
  doc.rect(x, imageTop, drawWidth, drawHeight);

  drawFooter(doc, pageWidth, pageHeight, 1);

  /* ── Schedule ──────────────────────────────────────────────────────── */
  doc.addPage(undefined, 'portrait');
  const p2Width = doc.internal.pageSize.getWidth();
  const p2Height = doc.internal.pageSize.getHeight();
  drawHeader(doc, { ...options, title: `${options.title} — schedule` }, p2Width);

  let y = MARGIN + 20;

  y = section(doc, 'Contents', y, p2Width);
  const counts = new Map<string, number>();
  for (const object of options.scene.objects) {
    const name =
      object.type === 'catalog' || object.type === 'opening'
        ? (options.itemNames[(object as { catalogItemId: number }).catalogItemId] ?? object.name ?? 'Item')
        : object.name ?? object.type;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  if (!counts.size) {
    y = line(doc, 'Nothing placed yet.', '', y, p2Width);
  } else {
    for (const [name, quantity] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
      y = line(doc, name, String(quantity), y, p2Width);
      if (y > p2Height - 30) {
        drawFooter(doc, p2Width, p2Height, 2);
        doc.addPage(undefined, 'portrait');
        y = MARGIN + 10;
      }
    }
  }

  /* ── Structure ─────────────────────────────────────────────────────── */
  const walls = options.scene.walls;
  if (walls.segments.length) {
    y += 4;
    y = section(doc, 'Structure', y, p2Width);
    const totalRun = walls.segments.reduce((sum, s) => sum + segmentLength(s.start, s.end), 0);
    y = line(doc, 'Wall segments', String(walls.segments.length), y, p2Width);
    y = line(doc, 'Total wall run', formatLength(Math.round(totalRun), options.units), y, p2Width);
    for (const floor of walls.floors) {
      y = line(doc, 'Floor area', formatArea(polygonArea(floor.points), options.units), y, p2Width);
    }
  }

  /* ── Stage parts list ──────────────────────────────────────────────── */
  const stages = options.scene.objects.filter((o): o is StageSceneObject => o.type === 'stage');
  for (const [index, stage] of stages.entries()) {
    const derived = deriveStage(stage);
    y += 4;
    if (y > p2Height - 60) {
      drawFooter(doc, p2Width, p2Height, 2);
      doc.addPage(undefined, 'portrait');
      y = MARGIN + 10;
    }
    y = section(doc, stages.length > 1 ? `Stage ${index + 1} — parts list` : 'Stage — parts list', y, p2Width);
    y = line(
      doc,
      'Footprint',
      `${formatLength(derived.footprintMm.width, options.units)} × ${formatLength(derived.footprintMm.depth, options.units)}`,
      y,
      p2Width
    );
    y = line(doc, 'Deck height', formatLength(stage.deckHeightMm, options.units), y, p2Width);
    for (const part of derived.bom) {
      y = line(doc, part.part, String(part.quantity), y, p2Width);
      if (y > p2Height - 30) {
        drawFooter(doc, p2Width, p2Height, 2);
        doc.addPage(undefined, 'portrait');
        y = MARGIN + 10;
      }
    }
    if (derived.warnings.length) {
      y += 2;
      doc.setFontSize(8);
      doc.setTextColor(180, 60, 40);
      for (const warning of derived.warnings) {
        const wrapped = doc.splitTextToSize(`• ${warning.message}`, p2Width - MARGIN * 2);
        doc.text(wrapped, MARGIN, y);
        y += wrapped.length * 4;
      }
      doc.setTextColor(60);
    }
    doc.setFontSize(7);
    doc.setTextColor(130);
    const disclaimer = doc.splitTextToSize(
      'Parts list is a design aid, not an engineering certification. Verify against the manufacturer’s load tables before install.',
      p2Width - MARGIN * 2
    );
    doc.text(disclaimer, MARGIN, y + 2);
    y += disclaimer.length * 3.5 + 4;
    doc.setTextColor(60);
  }

  drawFooter(doc, p2Width, p2Height, 2);

  const filename = `${options.title.replace(/[^\w -]+/g, '').trim() || 'plan'}.pdf`;
  doc.save(filename);
  return true;
}

function drawHeader(doc: jsPDF, options: { title: string; companyName?: string | null }, pageWidth: number) {
  doc.setFontSize(15);
  doc.setTextColor(20);
  doc.text(options.title, MARGIN, MARGIN + 4);

  doc.setFontSize(8);
  doc.setTextColor(130);
  const right = options.companyName ?? 'Novira';
  doc.text(right, pageWidth - MARGIN, MARGIN + 4, { align: 'right' });

  doc.setDrawColor(210);
  doc.line(MARGIN, MARGIN + 8, pageWidth - MARGIN, MARGIN + 8);
  doc.setTextColor(60);
}

function drawFooter(doc: jsPDF, pageWidth: number, pageHeight: number, page: number) {
  doc.setFontSize(7);
  doc.setTextColor(150);
  doc.text(
    `Generated ${new Date().toLocaleDateString()} · dimensions are for planning and should be checked on site`,
    MARGIN,
    pageHeight - 8
  );
  doc.text(String(page), pageWidth - MARGIN, pageHeight - 8, { align: 'right' });
  doc.setTextColor(60);
}

function section(doc: jsPDF, title: string, y: number, pageWidth: number): number {
  doc.setFontSize(10);
  doc.setTextColor(20);
  doc.text(title, MARGIN, y);
  doc.setDrawColor(220);
  doc.line(MARGIN, y + 1.5, pageWidth - MARGIN, y + 1.5);
  doc.setTextColor(60);
  return y + 7;
}

function line(doc: jsPDF, label: string, value: string, y: number, pageWidth: number): number {
  doc.setFontSize(9);
  const clipped = label.length > 64 ? `${label.slice(0, 61)}…` : label;
  doc.text(clipped, MARGIN, y);
  if (value) doc.text(value, pageWidth - MARGIN, y, { align: 'right' });
  return y + 5.5;
}
