import { useEffect, useRef } from 'react';
import { DRAWING_LAYER_INFO, type DrawingLayer, type DrawingShape, type PlanDrawing } from '@novira/shared';

/**
 * The plan drawing, on a 2D canvas.
 *
 * The same model that produces the DXF, drawn here so it can be checked before
 * it is exported. Canvas rather than SVG for one reason: a hall plan with 200
 * stands, their outlines, labels and dimensions is a few thousand nodes, and an
 * SVG of that size makes React's reconciliation the bottleneck on every layer
 * toggle. A canvas redraw is one pass and does not care how many shapes there
 * are.
 *
 * The transform is worked out once from the drawing's extents so the plan
 * always fills the frame, whatever size the room is — a plan view that requires
 * scrolling to find the content is a plan view nobody uses.
 */

interface Props {
  drawing: PlanDrawing;
  layers: Set<DrawingLayer>;
  height?: number;
  /** Draw on white, as a printed drawing is. */
  paper?: boolean;
}

interface Transform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

function computeTransform(drawing: PlanDrawing, width: number, height: number, margin: number): Transform {
  const spanX = Math.max(1, drawing.extents.maxX - drawing.extents.minX);
  const spanZ = Math.max(1, drawing.extents.maxZ - drawing.extents.minZ);
  const scale = Math.min((width - margin * 2) / spanX, (height - margin * 2) / spanZ);
  return {
    scale,
    offsetX: margin + (width - margin * 2 - spanX * scale) / 2 - drawing.extents.minX * scale,
    offsetY: margin + (height - margin * 2 - spanZ * scale) / 2 - drawing.extents.minZ * scale,
  };
}

/**
 * Draw the shapes.
 *
 * Text is scaled by the same transform as the geometry, then floored at a
 * readable size — a label at true scale on a 60 m hall would be sub-pixel, and
 * one on a 3 m stand would fill the frame.
 */
function paint(
  ctx: CanvasRenderingContext2D,
  drawing: PlanDrawing,
  layers: Set<DrawingLayer>,
  transform: Transform,
  pixelRatio: number,
  paper: boolean
) {
  const { scale, offsetX, offsetY } = transform;
  const x = (mm: number) => mm * scale + offsetX;
  const y = (mm: number) => mm * scale + offsetY;

  ctx.save();
  ctx.scale(pixelRatio, pixelRatio);
  ctx.fillStyle = paper ? '#ffffff' : '#ffffff';
  ctx.fillRect(0, 0, ctx.canvas.width / pixelRatio, ctx.canvas.height / pixelRatio);

  const ordered: DrawingShape[] = [
    // Fills first, then lines, then text — so a label is never covered by the
    // polygon drawn after it.
    ...drawing.shapes.filter((s) => s.kind === 'polygon' || s.kind === 'circle'),
    ...drawing.shapes.filter((s) => s.kind === 'line' || s.kind === 'dimension'),
    ...drawing.shapes.filter((s) => s.kind === 'text'),
  ];

  for (const shape of ordered) {
    if (!layers.has(shape.layer)) continue;
    const info = DRAWING_LAYER_INFO[shape.layer];
    ctx.strokeStyle = info.color;
    ctx.fillStyle = info.color;
    ctx.lineWidth = Math.max(0.6, shape.layer === 'walls' ? 1.6 : 1);
    ctx.setLineDash(info.dashed ? [6, 4] : []);

    switch (shape.kind) {
      case 'polygon': {
        if (shape.points.length < 2) break;
        ctx.beginPath();
        ctx.moveTo(x(shape.points[0]!.xMm), y(shape.points[0]!.zMm));
        for (const point of shape.points.slice(1)) ctx.lineTo(x(point.xMm), y(point.zMm));
        if (shape.closed) ctx.closePath();
        if (shape.fill) {
          ctx.fillStyle = shape.fill;
          ctx.fill();
          ctx.fillStyle = info.color;
        }
        ctx.stroke();
        break;
      }
      case 'line': {
        ctx.beginPath();
        ctx.moveTo(x(shape.a.xMm), y(shape.a.zMm));
        ctx.lineTo(x(shape.b.xMm), y(shape.b.zMm));
        ctx.stroke();
        break;
      }
      case 'circle': {
        ctx.beginPath();
        ctx.arc(x(shape.centre.xMm), y(shape.centre.zMm), Math.max(1, shape.radiusMm * scale), 0, Math.PI * 2);
        if (shape.fill) {
          ctx.fillStyle = shape.fill;
          ctx.fill();
          ctx.fillStyle = info.color;
        }
        ctx.stroke();
        break;
      }
      case 'dimension': {
        const dx = shape.b.xMm - shape.a.xMm;
        const dz = shape.b.zMm - shape.a.zMm;
        const length = Math.hypot(dx, dz) || 1;
        const nx = (-dz / length) * shape.offsetMm;
        const nz = (dx / length) * shape.offsetMm;

        const a2 = { xMm: shape.a.xMm + nx, zMm: shape.a.zMm + nz };
        const b2 = { xMm: shape.b.xMm + nx, zMm: shape.b.zMm + nz };

        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(x(shape.a.xMm), y(shape.a.zMm));
        ctx.lineTo(x(a2.xMm), y(a2.zMm));
        ctx.moveTo(x(shape.b.xMm), y(shape.b.zMm));
        ctx.lineTo(x(b2.xMm), y(b2.zMm));
        ctx.moveTo(x(a2.xMm), y(a2.zMm));
        ctx.lineTo(x(b2.xMm), y(b2.zMm));
        ctx.stroke();

        const midX = x((a2.xMm + b2.xMm) / 2);
        const midY = y((a2.zMm + b2.zMm) / 2);
        const angle = Math.atan2(y(b2.zMm) - y(a2.zMm), x(b2.xMm) - x(a2.xMm));

        ctx.save();
        ctx.translate(midX, midY);
        // Keep the text upright: a dimension read upside down is a dimension
        // read wrong.
        ctx.rotate(Math.abs(angle) > Math.PI / 2 ? angle + Math.PI : angle);
        ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        // A halo, so a dimension over a filled polygon is still readable.
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.strokeText(shape.label, 0, -2);
        ctx.fillStyle = info.color;
        ctx.fillText(shape.label, 0, -2);
        ctx.restore();
        break;
      }
      case 'text': {
        const size = Math.max(8, Math.min(20, shape.heightMm * scale));
        ctx.font = `500 ${size}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.save();
        ctx.translate(x(shape.at.xMm), y(shape.at.zMm));
        if (shape.rotationDeg) ctx.rotate((-shape.rotationDeg * Math.PI) / 180);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.strokeText(shape.text, 0, 0);
        ctx.fillStyle = info.color;
        ctx.fillText(shape.text, 0, 0);
        ctx.restore();
        break;
      }
      default:
        break;
    }
  }

  ctx.restore();
}

export function PlanDrawingCanvas({ drawing, layers, height = 280, paper = true }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const draw = () => {
      const width = container.clientWidth;
      if (!width) return;
      const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = width * pixelRatio;
      canvas.height = height * pixelRatio;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      paint(ctx, drawing, layers, computeTransform(drawing, width, height, 24), pixelRatio, paper);
    };

    draw();
    // Redraw on resize: the panel is resizable and a stale canvas at the old
    // width is the most obvious kind of broken.
    const observer = new ResizeObserver(draw);
    observer.observe(container);
    return () => observer.disconnect();
  }, [drawing, layers, height, paper]);

  return (
    <div ref={containerRef} className="w-full">
      <canvas ref={canvasRef} role="img" aria-label="Plan drawing" />
    </div>
  );
}

/**
 * Render the drawing to a PNG at a chosen width.
 *
 * Used for the technical-drawing export and for the plan page in a deck.
 * Off-screen, so it does not disturb the on-screen preview.
 */
export function drawingToPngDataUrl(drawing: PlanDrawing, layers: Set<DrawingLayer>, width = 3000): string | null {
  try {
    const spanX = Math.max(1, drawing.extents.maxX - drawing.extents.minX);
    const spanZ = Math.max(1, drawing.extents.maxZ - drawing.extents.minZ);
    // Keep the paper proportional to the plan, within sane bounds — a 60 × 4 m
    // gantry plan should not produce a 3000 × 200 px sliver.
    const height = Math.round(Math.max(width * 0.35, Math.min(width * 1.4, (width * spanZ) / spanX)));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    paint(ctx, drawing, layers, computeTransform(drawing, width, height, width * 0.05), 1, true);

    /* A title block along the bottom, so an exported drawing is self-describing. */
    const blockHeight = Math.round(height * 0.08);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, height - blockHeight, width, blockHeight);
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.strokeRect(1, height - blockHeight, width - 2, blockHeight - 1);

    ctx.fillStyle = '#111827';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.round(blockHeight * 0.34)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillText(drawing.facts[0]?.value ?? '', width * 0.02, height - blockHeight * 0.62);

    ctx.font = `400 ${Math.round(blockHeight * 0.24)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = '#4b5563';
    const line = drawing.facts
      .slice(1)
      .map((fact) => `${fact.label}: ${fact.value}`)
      .join('   ·   ');
    ctx.fillText(line, width * 0.02, height - blockHeight * 0.28);

    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}
