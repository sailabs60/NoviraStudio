/**
 * Procedural catalogue items.
 *
 * Scraped libraries are good at decorative props and bad at rental staples.
 * There is no CC0 "60-inch round banquet table" anywhere, and the ones that do
 * exist measure whatever the artist felt like — which is exactly the failure
 * mode the verification stage exists to catch.
 *
 * For the structural items the trade sizes precisely — banquet tables, cocktail
 * tables, dance-floor panels, stage decks, risers — we build the geometry
 * ourselves from the real dimensions. The shapes are simple enough that a
 * generated mesh looks right, and being generated means the size is exact by
 * construction rather than verified after the fact.
 */
import { Document, NodeIO, type Material } from '@gltf-transform/core';
import { saveAssetBuffer } from './storage.js';

const io = new NodeIO();

/** Millimetres → metres, glTF's unit. */
const m = (mm: number) => mm / 1000;

export interface MeshSpec {
  positions: number[];
  indices: number[];
  normals: number[];
}

/** Axis-aligned box centred on x/z, sitting on y = base. */
export function box(cx: number, cz: number, w: number, d: number, h: number, base: number): MeshSpec {
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const z0 = cz - d / 2;
  const z1 = cz + d / 2;
  const y0 = base;
  const y1 = base + h;

  const faces: Array<{ v: number[][]; n: number[] }> = [
    { v: [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], n: [0, 1, 0] },
    { v: [[x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0]], n: [0, -1, 0] },
    { v: [[x0, y0, z1], [x0, y1, z1], [x1, y1, z1], [x1, y0, z1]], n: [0, 0, 1] },
    { v: [[x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z0]], n: [0, 0, -1] },
    { v: [[x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [x1, y0, z0]], n: [1, 0, 0] },
    { v: [[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], n: [-1, 0, 0] },
  ];

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (const face of faces) {
    const start = positions.length / 3;
    for (const vertex of face.v) {
      positions.push(vertex[0]!, vertex[1]!, vertex[2]!);
      normals.push(face.n[0]!, face.n[1]!, face.n[2]!);
    }
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
  return { positions, indices, normals };
}

/** Vertical cylinder, flat-shaded sides plus a top and bottom cap. */
export function cylinder(cx: number, cz: number, radius: number, height: number, base: number, segments = 32): MeshSpec {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const y0 = base;
  const y1 = base + height;

  for (let i = 0; i < segments; i += 1) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const x0 = cx + Math.cos(a0) * radius;
    const z0 = cz + Math.sin(a0) * radius;
    const x1 = cx + Math.cos(a1) * radius;
    const z1 = cz + Math.sin(a1) * radius;
    const nx = Math.cos((a0 + a1) / 2);
    const nz = Math.sin((a0 + a1) / 2);

    const s = positions.length / 3;
    positions.push(x0, y0, z0, x0, y1, z0, x1, y1, z1, x1, y0, z1);
    for (let k = 0; k < 4; k += 1) normals.push(nx, 0, nz);
    indices.push(s, s + 1, s + 2, s, s + 2, s + 3);
  }

  for (const [y, ny] of [
    [y1, 1],
    [y0, -1],
  ] as const) {
    const centre = positions.length / 3;
    positions.push(cx, y, cz);
    normals.push(0, ny, 0);
    for (let i = 0; i <= segments; i += 1) {
      const a = (i / segments) * Math.PI * 2;
      positions.push(cx + Math.cos(a) * radius, y, cz + Math.sin(a) * radius);
      normals.push(0, ny, 0);
    }
    for (let i = 0; i < segments; i += 1) {
      const a = centre + 1 + i;
      const b = centre + 1 + i + 1;
      if (ny > 0) indices.push(centre, b, a);
      else indices.push(centre, a, b);
    }
  }

  return { positions, indices, normals };
}

export function merge(parts: MeshSpec[]): MeshSpec {
  const out: MeshSpec = { positions: [], indices: [], normals: [] };
  for (const part of parts) {
    const offset = out.positions.length / 3;
    out.positions.push(...part.positions);
    out.normals.push(...part.normals);
    out.indices.push(...part.indices.map((i) => i + offset));
  }
  return out;
}

function hexToRgb(hex: string): [number, number, number, number] {
  const v = hex.replace('#', '');
  const to = (i: number) => parseInt(v.slice(i, i + 2), 16) / 255;
  // Approximate sRGB → linear so the colour reads correctly under PBR.
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return [lin(to(0)), lin(to(2)), lin(to(4)), 1];
}

export interface Part {
  mesh: MeshSpec;
  color: string;
  materialName: string;
  roughness?: number;
  metallic?: number;
}

/** Assemble parts into a GLB, one material per part so colours stay editable. */
export async function buildGlb(parts: Part[], relativePath: string): Promise<{ url: string; triangles: number }> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('Scene');
  let triangles = 0;

  const materials = new Map<string, Material>();
  for (const part of parts) {
    if (!materials.has(part.materialName)) {
      const mat = doc
        .createMaterial(part.materialName)
        .setBaseColorFactor(hexToRgb(part.color))
        .setRoughnessFactor(part.roughness ?? 0.7)
        .setMetallicFactor(part.metallic ?? 0);
      materials.set(part.materialName, mat);
    }
  }

  for (const [index, part] of parts.entries()) {
    const position = doc
      .createAccessor()
      .setType('VEC3')
      .setArray(new Float32Array(part.mesh.positions))
      .setBuffer(buffer);
    const normal = doc
      .createAccessor()
      .setType('VEC3')
      .setArray(new Float32Array(part.mesh.normals))
      .setBuffer(buffer);
    const indices = doc
      .createAccessor()
      .setType('SCALAR')
      .setArray(new Uint32Array(part.mesh.indices))
      .setBuffer(buffer);

    const prim = doc
      .createPrimitive()
      .setAttribute('POSITION', position)
      .setAttribute('NORMAL', normal)
      .setIndices(indices)
      .setMaterial(materials.get(part.materialName)!);

    triangles += part.mesh.indices.length / 3;
    const mesh = doc.createMesh(`part_${index}`).addPrimitive(prim);
    scene.addChild(doc.createNode(`node_${index}`).setMesh(mesh));
  }

  doc.getRoot().setDefaultScene(scene);
  const bytes = await io.writeBinary(doc);
  const saved = await saveAssetBuffer(Buffer.from(bytes), relativePath);
  return { url: saved.url, triangles };
}

/* ── Item builders ─────────────────────────────────────────────────────── */

const TOP = '#d8d3c8';
const LEG = '#8a8578';

export interface ProceduralSpec {
  key: string;
  name: string;
  description: string;
  categorySlug: string;
  widthMm: number;
  depthMm: number;
  heightMm: number;
  diameterMm?: number;
  tableShape?: 'round' | 'rectangular' | 'other';
  seats?: number;
  freePlan?: boolean;
  build: () => Promise<{ url: string; triangles: number }>;
}

/** Round banquet table: a disc top on a central column and a base plate. */
function roundTable(diameterMm: number, heightMm: number, seats: number): ProceduralSpec {
  const key = `round-table-${Math.round(diameterMm / 25.4)}`;
  const inches = Math.round(diameterMm / 25.4);
  return {
    key,
    name: `Round Table ${inches}"`,
    description: `${inches}" round banquet table, seats ${seats}. Generated to exact rental dimensions.`,
    categorySlug: 'tables',
    widthMm: diameterMm,
    depthMm: diameterMm,
    heightMm,
    diameterMm,
    tableShape: 'round',
    seats,
    freePlan: true,
    build: () => {
      const topThick = m(25);
      const r = m(diameterMm) / 2;
      const h = m(heightMm);
      return buildGlb(
        [
          { mesh: cylinder(0, 0, r, topThick, h - topThick, 48), color: TOP, materialName: 'Top' },
          { mesh: cylinder(0, 0, m(50), h - topThick, 0, 16), color: LEG, materialName: 'Base' },
          { mesh: cylinder(0, 0, m(230), m(18), 0, 24), color: LEG, materialName: 'Base' },
        ],
        `procedural/${key}.glb`
      );
    },
  };
}

/** Rectangular trestle table: slab top on four corner legs. */
function rectTable(widthMm: number, depthMm: number, heightMm: number, seats: number): ProceduralSpec {
  const ftLabel = `${Math.round(widthMm / 304.8)}ft`;
  const key = `rect-table-${Math.round(widthMm / 25.4)}x${Math.round(depthMm / 25.4)}`;
  return {
    key,
    name: `Banquet Table ${ftLabel} × ${Math.round(depthMm / 25.4)}"`,
    description: `${ftLabel} rectangular banquet table, seats ${seats}. Generated to exact rental dimensions.`,
    categorySlug: 'tables',
    widthMm,
    depthMm,
    heightMm,
    tableShape: 'rectangular',
    seats,
    freePlan: true,
    build: () => {
      const w = m(widthMm);
      const d = m(depthMm);
      const h = m(heightMm);
      const topThick = m(25);
      const leg = m(45);
      const inset = m(70);
      const legH = h - topThick;
      const parts: Part[] = [{ mesh: box(0, 0, w, d, topThick, legH), color: TOP, materialName: 'Top' }];
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          parts.push({
            mesh: box(sx * (w / 2 - inset), sz * (d / 2 - inset), leg, leg, legH, 0),
            color: LEG,
            materialName: 'Legs',
          });
        }
      }
      return buildGlb(parts, `procedural/${key}.glb`);
    },
  };
}

/** Cocktail / poseur table: small disc at standing height. */
function cocktailTable(diameterMm: number, heightMm: number): ProceduralSpec {
  const key = `cocktail-table-${Math.round(diameterMm / 25.4)}`;
  return {
    key,
    name: `Cocktail Table ${Math.round(diameterMm / 25.4)}"`,
    description: 'Standing-height poseur table. Generated to exact rental dimensions.',
    categorySlug: 'tables',
    widthMm: diameterMm,
    depthMm: diameterMm,
    heightMm,
    diameterMm,
    tableShape: 'round',
    seats: 4,
    build: () => {
      const r = m(diameterMm) / 2;
      const h = m(heightMm);
      const topThick = m(22);
      return buildGlb(
        [
          { mesh: cylinder(0, 0, r, topThick, h - topThick, 40), color: TOP, materialName: 'Top' },
          { mesh: cylinder(0, 0, m(38), h - topThick, 0, 16), color: '#4a4a4e', materialName: 'Column', metallic: 0.7, roughness: 0.35 },
          { mesh: cylinder(0, 0, m(200), m(16), 0, 24), color: '#4a4a4e', materialName: 'Column', metallic: 0.7, roughness: 0.35 },
        ],
        `procedural/${key}.glb`
      );
    },
  };
}

/** A single dance-floor panel. */
function danceFloorPanel(): ProceduralSpec {
  return {
    key: 'dance-floor-panel',
    name: 'Dance Floor Panel 4\' × 4\'',
    description: 'Modular 4-foot dance floor panel. Generated to exact rental dimensions.',
    categorySlug: 'dance-floors',
    widthMm: 1219,
    depthMm: 1219,
    heightMm: 38,
    freePlan: true,
    build: () =>
      buildGlb(
        [{ mesh: box(0, 0, m(1219), m(1219), m(38), 0), color: '#c9b48a', materialName: 'Panel', roughness: 0.35 }],
        'procedural/dance-floor-panel.glb'
      ),
  };
}

/** A single 4' × 4' stage deck, used as a preview of the stage builder output. */
function stageDeck(): ProceduralSpec {
  return {
    key: 'stage-deck-4x4',
    name: 'Stage Deck 4\' × 4\'',
    description: 'Modular 4-foot staging deck. Generated to exact rental dimensions.',
    categorySlug: 'staging',
    widthMm: 1219,
    depthMm: 1219,
    heightMm: 152,
    build: () =>
      buildGlb(
        [
          { mesh: box(0, 0, m(1219), m(1219), m(38), m(114)), color: '#2f3136', materialName: 'Deck', roughness: 0.8 },
          ...[-1, 1].flatMap((sx) =>
            [-1, 1].map((sz) => ({
              mesh: box(sx * m(520), sz * m(520), m(50), m(50), m(114), 0),
              color: '#5b5f66',
              materialName: 'Legs',
              metallic: 0.6,
              roughness: 0.4,
            }))
          ),
        ],
        'procedural/stage-deck-4x4.glb'
      ),
  };
}

/** Pipe-and-drape upright with base — the physical hardware, not the fabric. */
function drapeUpright(): ProceduralSpec {
  return {
    key: 'drape-upright',
    name: 'Pipe & Drape Upright',
    description: 'Telescopic drape upright with base plate. Generated to exact rental dimensions.',
    categorySlug: 'draping',
    widthMm: 460,
    depthMm: 460,
    heightMm: 2440,
    build: () =>
      buildGlb(
        [
          { mesh: cylinder(0, 0, m(230), m(12), 0, 20), color: '#3a3d42', materialName: 'Base', metallic: 0.7, roughness: 0.4 },
          { mesh: cylinder(0, 0, m(19), m(2428), m(12), 12), color: '#8e9299', materialName: 'Pipe', metallic: 0.85, roughness: 0.3 },
        ],
        'procedural/drape-upright.glb'
      ),
  };
}

/** Riser box for cake tables, gift tables and display. */
function riserBox(): ProceduralSpec {
  return {
    key: 'riser-box',
    name: 'Display Riser 24"',
    description: 'Display riser plinth. Generated to exact rental dimensions.',
    categorySlug: 'decor',
    widthMm: 610,
    depthMm: 610,
    heightMm: 610,
    build: () =>
      buildGlb(
        [{ mesh: box(0, 0, m(610), m(610), m(610), 0), color: '#e8e4dc', materialName: 'Riser', roughness: 0.6 }],
        'procedural/riser-box.glb'
      ),
  };
}


/**
 * Door leaf and frame.
 *
 * The wall is cut around the opening by `splitWallAroundOpenings`; this is the
 * joinery that fills it. Standard rental/venue sizes rather than domestic ones.
 */
function door(widthMm: number, heightMm: number, label: string): ProceduralSpec {
  const key = `door-${Math.round(widthMm / 25.4)}x${Math.round(heightMm / 25.4)}`;
  return {
    key,
    name: label,
    description: 'Door leaf and frame. Snaps into a wall as an opening.',
    categorySlug: 'doors-windows',
    widthMm,
    depthMm: 120,
    heightMm,
    freePlan: true,
    build: () => {
      const w = m(widthMm);
      const h = m(heightMm);
      const jamb = m(60);
      const depth = m(120);
      return buildGlb(
        [
          // Frame: two jambs and a head.
          { mesh: box(-(w / 2 - jamb / 2), 0, jamb, depth, h, 0), color: '#f2efe9', materialName: 'Frame' },
          { mesh: box(w / 2 - jamb / 2, 0, jamb, depth, h, 0), color: '#f2efe9', materialName: 'Frame' },
          { mesh: box(0, 0, w, depth, jamb, h - jamb), color: '#f2efe9', materialName: 'Frame' },
          // Leaf, inset slightly so the frame reads.
          { mesh: box(0, 0, w - jamb * 2, m(45), h - jamb, 0), color: '#c9b79c', materialName: 'Leaf', roughness: 0.75 },
          // Handle.
          { mesh: cylinder(w / 2 - m(180), m(40), m(18), m(120), m(1020), 12), color: '#8d9299', materialName: 'Handle', metallic: 0.85, roughness: 0.3 },
        ],
        `procedural/${key}.glb`
      );
    },
  };
}

/** Window frame with a glazed pane. */
function windowUnit(widthMm: number, heightMm: number, label: string): ProceduralSpec {
  const key = `window-${Math.round(widthMm / 25.4)}x${Math.round(heightMm / 25.4)}`;
  return {
    key,
    name: label,
    description: 'Glazed window unit. Snaps into a wall as an opening.',
    categorySlug: 'doors-windows',
    widthMm,
    depthMm: 120,
    heightMm,
    freePlan: true,
    build: () => {
      const w = m(widthMm);
      const h = m(heightMm);
      const frame = m(55);
      const depth = m(120);
      return buildGlb(
        [
          { mesh: box(-(w / 2 - frame / 2), 0, frame, depth, h, 0), color: '#f2efe9', materialName: 'Frame' },
          { mesh: box(w / 2 - frame / 2, 0, frame, depth, h, 0), color: '#f2efe9', materialName: 'Frame' },
          { mesh: box(0, 0, w, depth, frame, h - frame), color: '#f2efe9', materialName: 'Frame' },
          { mesh: box(0, 0, w, depth, frame, 0), color: '#f2efe9', materialName: 'Frame' },
          // Central mullion.
          { mesh: box(0, 0, m(40), depth, h - frame * 2, frame), color: '#f2efe9', materialName: 'Frame' },
          // Glazing — thin, and left to read as glass via its colour.
          { mesh: box(0, 0, w - frame * 2, m(8), h - frame * 2, frame), color: '#b8d4e3', materialName: 'Glass', roughness: 0.08, metallic: 0.1 },
        ],
        `procedural/${key}.glb`
      );
    },
  };
}


/* ── Linens ──────────────────────────────────────────────────────────── */

/**
 * A draped tablecloth.
 *
 * Linen is sold by the size of the table it dresses, not by its own
 * dimensions, so each cloth is built to a real table and hangs to the
 * documented drop. A 90" round cloth on a 60" table gives a 15" drop; a
 * 132" on the same table reaches the floor. Getting this wrong is visible
 * immediately in a render, which is why these are generated rather than
 * sourced.
 */
function roundTablecloth(clothDiameterMm: number, tableDiameterMm: number, tableHeightMm: number): ProceduralSpec {
  const clothIn = Math.round(clothDiameterMm / 25.4);
  const tableIn = Math.round(tableDiameterMm / 25.4);
  // Half the excess hangs down; a cloth cannot drape below the floor.
  const drop = Math.min((clothDiameterMm - tableDiameterMm) / 2, tableHeightMm);
  return {
    key: `round-tablecloth-${clothIn}`,
    name: `Round Tablecloth ${clothIn}"`,
    description: `Fits a ${tableIn}" round table with a ${Math.round(drop / 25.4)}" drop.`,
    categorySlug: 'linens',
    widthMm: tableDiameterMm,
    depthMm: tableDiameterMm,
    // The cloth occupies the drop plus the 4 mm lying over the table top;
    // that span is what a bounding box measures.
    heightMm: Math.round(drop) + 4,
    diameterMm: tableDiameterMm,
    tableShape: 'round',
    build: async () => {
      const top = cylinder(0, 0, tableDiameterMm / 2000, 0.004, tableHeightMm / 1000, 48);
      // The skirt is a thin cylinder wall standing in for the fall of cloth.
      const skirt = cylinder(0, 0, tableDiameterMm / 2000, drop / 1000, (tableHeightMm - drop) / 1000, 48);
      return buildGlb(
        [{ mesh: merge([top, skirt]), color: '#f4f1ea', materialName: 'linen', roughness: 0.92 }],
        `procedural/round-tablecloth-${clothIn}.glb`,
      );
    },
  };
}

/** A banquet cloth over a trestle table, hanging to the documented drop. */
function rectTablecloth(tableWidthMm: number, tableDepthMm: number, tableHeightMm: number, dropMm: number, label: string): ProceduralSpec {
  return {
    key: `rect-tablecloth-${Math.round(tableWidthMm / 25.4)}x${Math.round(tableDepthMm / 25.4)}`,
    name: label,
    description: `Banquet cloth for a ${Math.round(tableWidthMm / 305)}ft trestle, ${Math.round(dropMm / 25.4)}" drop.`,
    categorySlug: 'linens',
    // The falls hang on the edge, so the cloth reads 4 mm past the table
    // on each axis, and 4 mm over its top.
    widthMm: tableWidthMm + 4,
    depthMm: tableDepthMm + 4,
    heightMm: dropMm + 4,
    tableShape: 'rectangular',
    build: async () => {
      const drop = Math.min(dropMm, tableHeightMm);
      const top = box(0, 0, tableWidthMm / 1000, tableDepthMm / 1000, 0.004, tableHeightMm / 1000);
      const parts = [top];
      // Four falls of cloth, one per edge.
      const base = (tableHeightMm - drop) / 1000;
      parts.push(box(0, tableDepthMm / 2000, tableWidthMm / 1000, 0.004, drop / 1000, base));
      parts.push(box(0, -tableDepthMm / 2000, tableWidthMm / 1000, 0.004, drop / 1000, base));
      parts.push(box(tableWidthMm / 2000, 0, 0.004, tableDepthMm / 1000, drop / 1000, base));
      parts.push(box(-tableWidthMm / 2000, 0, 0.004, tableDepthMm / 1000, drop / 1000, base));
      return buildGlb(
        [{ mesh: merge(parts), color: '#f4f1ea', materialName: 'linen', roughness: 0.92 }],
        `procedural/${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.glb`,
      );
    },
  };
}

/* ── Bars and catering ───────────────────────────────────────────────── */

/** Portable bar counter, in the modular sections these are actually hired in. */
function barCounter(widthMm: number, label: string): ProceduralSpec {
  const depth = 610;
  // Standard bar height. Anything materially different reads as a serving
  // table rather than a bar.
  const height = 1067;
  return {
    key: `bar-counter-${Math.round(widthMm / 305)}ft`,
    name: label,
    description: 'Modular portable bar section with a serving top and front panel.',
    categorySlug: 'bars-catering',
    widthMm,
    // Top overhang plus the foot rail, both on the service side.
    depthMm: depth + 120,
    heightMm: height,
    build: async () => {
      const w = widthMm / 1000;
      const d = depth / 1000;
      const h = height / 1000;
      const body = box(0, 0, w, d, h - 0.04, 0);
      // The top overhangs the body on the service side.
      // Overhang on the service side only; a portable bar is specified by
      // its body width, so widening it would misreport the hire size.
      const top = box(0, 0.06, w, d + 0.12, 0.04, h - 0.04);
      const footRail = box(0, -d / 2 - 0.06, w * 0.92, 0.04, 0.04, 0.18);
      return buildGlb(
        [
          { mesh: body, color: '#3f3a34', materialName: 'bar-body', roughness: 0.6 },
          { mesh: top, color: '#6b5d4c', materialName: 'bar-top', roughness: 0.35 },
          { mesh: footRail, color: '#9aa0a6', materialName: 'bar-rail', roughness: 0.3, metallic: 0.8 },
        ],
        `procedural/${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.glb`,
      );
    },
  };
}

/** Chafing dish — the full-size steam-table pan every buffet runs on. */
function chafingDish(): ProceduralSpec {
  // A full-size gastronorm pan in its frame: 1/1 GN is 530 × 325 mm.
  const width = 610;
  const depth = 360;
  const height = 330;
  return {
    key: 'chafing-dish',
    name: `Chafing Dish 8qt`,
    description: 'Full-size chafer with lid, water pan and folding frame.',
    categorySlug: 'bars-catering',
    widthMm: width,
    depthMm: depth,
    heightMm: height,
    build: async () => {
      const w = width / 1000;
      const d = depth / 1000;
      const legs = [];
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          legs.push(box((sx * (w / 2 - 0.03)), (sz * (d / 2 - 0.03)), 0.02, 0.02, 0.16, 0));
        }
      }
      const pan = box(0, 0, w, d, 0.09, 0.16);
      const lid = box(0, 0, w * 0.98, d * 0.98, 0.08, 0.25);
      return buildGlb(
        [
          { mesh: merge(legs), color: '#8d8d8d', materialName: 'chafer-frame', roughness: 0.35, metallic: 0.8 },
          { mesh: pan, color: '#c9ccd0', materialName: 'chafer-pan', roughness: 0.25, metallic: 0.9 },
          { mesh: lid, color: '#d5d8dc', materialName: 'chafer-lid', roughness: 0.2, metallic: 0.9 },
        ],
        'procedural/chafing-dish.glb',
      );
    },
  };
}

/* ── Signage ─────────────────────────────────────────────────────────── */

/** A-frame pavement sign, at the standard poster size it carries. */
function aFrameSign(): ProceduralSpec {
  // Carries an A1 poster (594 × 841 mm), which is the common event size.
  const width = 640;
  const depth = 560;
  const height = 1000;
  return {
    key: 'a-frame-sign',
    name: 'A-Frame Sign A1',
    description: 'Double-sided pavement sign carrying an A1 poster.',
    categorySlug: 'signage',
    widthMm: width,
    depthMm: depth,
    heightMm: height,
    build: async () => {
      const w = width / 1000;
      const h = height / 1000;
      // Two leaning panels meeting at the top.
      const panels = [];
      for (const sz of [-1, 1]) {
        panels.push(box(0, sz * 0.13, w, 0.03, h - 0.06, 0.06));
      }
      const feet = [];
      for (const sz of [-1, 1]) {
        feet.push(box(0, sz * 0.26, w, 0.05, 0.06, 0));
      }
      return buildGlb(
        [
          { mesh: merge(panels), color: '#e9e6df', materialName: 'sign-face', roughness: 0.6 },
          { mesh: merge(feet), color: '#3a3a3a', materialName: 'sign-frame', roughness: 0.5 },
        ],
        'procedural/a-frame-sign.glb',
      );
    },
  };
}

/** Display easel for a seating chart or welcome board. */
function displayEasel(): ProceduralSpec {
  const width = 660;
  const depth = 560;
  const height = 1680;
  return {
    key: 'display-easel',
    name: 'Display Easel',
    description: 'Tripod easel for a seating chart or welcome board.',
    categorySlug: 'signage',
    // The board ledge is the widest part, not the leg spread.
    widthMm: 560,
    depthMm: depth,
    heightMm: height,
    build: async () => {
      const h = height / 1000;
      const parts = [];
      // Two front legs and one rear leg, meeting near the top.
      for (const sx of [-1, 1]) {
        parts.push(box(sx * 0.24, -0.1, 0.035, 0.035, h, 0));
      }
      parts.push(box(0, 0.22, 0.035, 0.035, h * 0.95, 0));
      // Ledge the board rests on.
      parts.push(box(0, -0.1, 0.56, 0.07, 0.03, h * 0.42));
      return buildGlb(
        [{ mesh: merge(parts), color: '#6b5741', materialName: 'easel', roughness: 0.7 }],
        'procedural/display-easel.glb',
      );
    },
  };
}

/* ── Outdoor ─────────────────────────────────────────────────────────── */

/** Market umbrella, at the canopy spans actually hired. */
function marketUmbrella(canopyMm: number): ProceduralSpec {
  const height = 2600;
  const ft = Math.round(canopyMm / 305);
  return {
    key: `market-umbrella-${ft}ft`,
    name: `Market Umbrella ${ft}ft`,
    description: 'Centre-pole umbrella for outdoor dining and bar areas.',
    categorySlug: 'outdoor',
    widthMm: canopyMm,
    depthMm: canopyMm,
    heightMm: height,
    diameterMm: canopyMm,
    build: async () => {
      const r = canopyMm / 2000;
      const pole = cylinder(0, 0, 0.024, height / 1000, 0, 16);
      // The canopy is an octagonal cone, approximated by a shallow disc.
      const canopy = cylinder(0, 0, r, 0.06, (height - 500) / 1000, 8);
      const base = cylinder(0, 0, 0.24, 0.06, 0, 24);
      return buildGlb(
        [
          { mesh: pole, color: '#8a8578', materialName: 'umbrella-pole', roughness: 0.5 },
          { mesh: canopy, color: '#d8cfbc', materialName: 'umbrella-canopy', roughness: 0.85 },
          { mesh: base, color: '#4a4a4a', materialName: 'umbrella-base', roughness: 0.7 },
        ],
        `procedural/market-umbrella-${ft}ft.glb`,
      );
    },
  };
}

/** Patio heater — the mushroom-top gas heater used at every outdoor event. */
function patioHeater(): ProceduralSpec {
  const width = 810;
  const height = 2210;
  return {
    key: 'patio-heater',
    name: 'Patio Heater',
    description: 'Free-standing propane heater with a reflector top.',
    categorySlug: 'outdoor',
    widthMm: width,
    depthMm: width,
    heightMm: height,
    diameterMm: width,
    build: async () => {
      const h = height / 1000;
      const base = cylinder(0, 0, 0.23, 0.12, 0, 24);
      const tank = cylinder(0, 0, 0.19, 0.6, 0.12, 20);
      const post = cylinder(0, 0, 0.05, h - 1.05, 0.72, 16);
      const burner = cylinder(0, 0, 0.16, 0.22, h - 0.33, 20);
      const reflector = cylinder(0, 0, width / 2000, 0.05, h - 0.05, 24);
      return buildGlb(
        [
          { mesh: merge([base, tank, post]), color: '#5a5f63', materialName: 'heater-body', roughness: 0.4, metallic: 0.6 },
          { mesh: burner, color: '#2f3336', materialName: 'heater-burner', roughness: 0.5 },
          { mesh: reflector, color: '#b9bec2', materialName: 'heater-reflector', roughness: 0.25, metallic: 0.85 },
        ],
        'procedural/patio-heater.glb',
      );
    },
  };
}

export const PROCEDURAL_ITEMS: ProceduralSpec[] = [
  // The four round sizes that make up almost every seated banquet.
  roundTable(1219, 762, 8), // 48"
  roundTable(1524, 762, 8), // 60"
  roundTable(1676, 762, 10), // 66"
  roundTable(1829, 762, 10), // 72"
  // Trestle tables.
  rectTable(1829, 762, 762, 6), // 6ft × 30"
  rectTable(2438, 762, 762, 8), // 8ft × 30"
  rectTable(1829, 457, 762, 4), // 6ft × 18" classroom
  cocktailTable(762, 1067), // 30" × 42"
  danceFloorPanel(),
  stageDeck(),
  drapeUpright(),
  riserBox(),
  // Openings. Widths follow venue/rental practice, not domestic sizes.
  door(915, 2032, 'Single Door 36"'),
  door(1830, 2032, 'Double Door 72"'),
  windowUnit(1220, 1220, 'Window 48" × 48"'),
  windowUnit(1830, 1500, 'Picture Window 72" × 59"'),

  /*
   * Categories no usable source could fill.
   *
   * BlenderKit's free glTF subset has no event linen, signage, bar equipment
   * or outdoor furniture — a search for "welcome sign" returns a decorative
   * bear and a medieval inn. These items are also the most dimensionally
   * standardised things at an event, which is exactly the case where
   * generating beats sourcing: a 120" round cloth has one correct size.
   */
  roundTablecloth(2286, 1524, 762), // 90" cloth on a 60" round
  roundTablecloth(3353, 1524, 762), // 132" floor-length on a 60" round
  roundTablecloth(3048, 1829, 762), // 120" on a 72" round
  rectTablecloth(1829, 762, 762, 380, 'Banquet Cloth 6ft'),
  rectTablecloth(2438, 762, 762, 380, 'Banquet Cloth 8ft'),

  barCounter(1220, 'Portable Bar 4ft'),
  barCounter(1830, 'Portable Bar 6ft'),
  chafingDish(),

  aFrameSign(),
  displayEasel(),

  marketUmbrella(2740), // 9ft
  marketUmbrella(3350), // 11ft
  patioHeater(),
];
