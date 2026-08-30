/**
 * glTF/GLB inspection.
 *
 * Provider metadata says what an asset is *called*; the geometry says what it
 * actually is. This module opens the model, measures it, and reports facts the
 * verification stage can reason about: real extents, triangle count, whether
 * it has textures, and whether the file is even loadable.
 *
 * Scale is the subtle part. Exporters disagree about units — a chair may come
 * out 0.9 (metres), 90 (centimetres) or 35 (inches) tall. `inferScale` picks
 * the interpretation that lands the model inside its expected real-world range,
 * so the catalogue stores a correctly sized item rather than a plausible-looking
 * one that is ten times too big.
 */
import { NodeIO, getBounds, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import draco3d from 'draco3d';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface GltfFacts {
  ok: boolean;
  error?: string;
  /** Extents in the file's own units, largest-first ordering preserved as x/y/z. */
  sizeRaw: { x: number; y: number; z: number };
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
  triangleCount: number;
  meshCount: number;
  materialCount: number;
  textureCount: number;
  materialNames: string[];
  hasAnimation: boolean;
  /** True when the model sits far from the origin — usually a scene export, not a prop. */
  offCentre: boolean;
  fileSize: number;
}

/**
 * Reader for real-world assets.
 *
 * Community libraries lean on vendor and compression extensions that the
 * Khronos set alone does not cover. BlenderKit exports, for instance, are
 * almost universally Draco-compressed with WebP textures. All three are
 * declared *required*, so a reader without them refuses the entire file — and
 * the asset gets thrown out for a reason that has nothing to do with what it
 * actually depicts.
 *
 * Both decoders are WebAssembly and initialise asynchronously, so the reader
 * is built once, lazily, and awaited.
 */
let ioPromise: Promise<NodeIO> | null = null;

function getIo(): Promise<NodeIO> {
  if (!ioPromise) {
    ioPromise = (async () => {
      const [decoder] = await Promise.all([
        draco3d.createDecoderModule(),
        MeshoptDecoder.ready,
      ]);
      return new NodeIO()
        .registerExtensions(ALL_EXTENSIONS)
        .registerDependencies({
          'draco3d.decoder': decoder,
          'meshopt.decoder': MeshoptDecoder,
        });
    })();
  }
  return ioPromise;
}

function safeNumber(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

export async function inspectGltfFile(filePath: string): Promise<GltfFacts> {
  const empty: GltfFacts = {
    ok: false,
    sizeRaw: { x: 0, y: 0, z: 0 },
    min: { x: 0, y: 0, z: 0 },
    max: { x: 0, y: 0, z: 0 },
    triangleCount: 0,
    meshCount: 0,
    materialCount: 0,
    textureCount: 0,
    materialNames: [],
    hasAnimation: false,
    offCentre: false,
    fileSize: 0,
  };

  let doc: Document;
  try {
    const bytes = await readFile(filePath);
    empty.fileSize = bytes.byteLength;
    doc =
      path.extname(filePath).toLowerCase() === '.glb'
        ? await (await getIo()).readBinary(new Uint8Array(bytes))
        : await (await getIo()).read(filePath);
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : 'Could not read model.' };
  }

  try {
    const root = doc.getRoot();
    const scene = root.getDefaultScene() ?? root.listScenes()[0];
    if (!scene) return { ...empty, error: 'Model contains no scene.' };

    const box = getBounds(scene);
    const min = { x: safeNumber(box.min[0]), y: safeNumber(box.min[1]), z: safeNumber(box.min[2]) };
    const max = { x: safeNumber(box.max[0]), y: safeNumber(box.max[1]), z: safeNumber(box.max[2]) };
    const sizeRaw = { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z };

    let triangleCount = 0;
    for (const mesh of root.listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const indices = prim.getIndices();
        const position = prim.getAttribute('POSITION');
        const count = indices ? indices.getCount() : (position?.getCount() ?? 0);
        const mode = prim.getMode();
        // 4 = TRIANGLES, 5 = TRIANGLE_STRIP, 6 = TRIANGLE_FAN
        if (mode === 4) triangleCount += Math.floor(count / 3);
        else if (mode === 5 || mode === 6) triangleCount += Math.max(0, count - 2);
      }
    }

    const materials = root.listMaterials();
    const largest = Math.max(sizeRaw.x, sizeRaw.y, sizeRaw.z) || 1;
    const centre = {
      x: (min.x + max.x) / 2,
      y: (min.y + max.y) / 2,
      z: (min.z + max.z) / 2,
    };
    // A prop centred more than five of its own widths from the origin is
    // almost always a fragment of a larger scene export.
    const offCentre = Math.hypot(centre.x, centre.z) > largest * 5;

    return {
      ok: triangleCount > 0 && largest > 0,
      sizeRaw,
      min,
      max,
      triangleCount,
      meshCount: root.listMeshes().length,
      materialCount: materials.length,
      textureCount: root.listTextures().length,
      materialNames: materials.map((m, i) => m.getName() || `material_${i}`),
      hasAnimation: root.listAnimations().length > 0,
      offCentre,
      fileSize: empty.fileSize,
      ...(triangleCount === 0 ? { error: 'Model contains no triangles.' } : {}),
    };
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : 'Could not parse model.' };
  }
}

/** Candidate unit interpretations, as a multiplier from file units to millimetres. */
const UNIT_CANDIDATES: Array<{ name: string; toMm: number }> = [
  { name: 'metres', toMm: 1000 },
  { name: 'centimetres', toMm: 10 },
  { name: 'millimetres', toMm: 1 },
  { name: 'inches', toMm: 25.4 },
  { name: 'feet', toMm: 304.8 },
  { name: 'decimetres', toMm: 100 },
];

export interface ScaleInference {
  /** Multiplier from file units to millimetres. */
  toMm: number;
  unitName: string;
  /** How well the resulting size sits inside the expected range: 0–100. */
  fit: number;
  sizeMm: { width: number; depth: number; height: number };
}

/**
 * Choose the unit interpretation that best fits an expected real-world size.
 *
 * `expected` is the taxonomy's plausible range for whatever the asset claims
 * to be. Without an expectation we assume glTF's own convention (metres),
 * which is what the specification mandates and most exporters honour.
 */
export function inferScale(
  facts: GltfFacts,
  expected?: { widthMm: [number, number]; heightMm: [number, number] }
): ScaleInference {
  // glTF's Y axis is up; the two horizontal extents are width and depth.
  const horizontal = [facts.sizeRaw.x, facts.sizeRaw.z].sort((a, b) => b - a);
  const rawWidth = horizontal[0] ?? 0;
  const rawDepth = horizontal[1] ?? 0;
  const rawHeight = facts.sizeRaw.y;

  const measure = (toMm: number) => ({
    width: Math.round(rawWidth * toMm),
    depth: Math.round(rawDepth * toMm),
    height: Math.round(rawHeight * toMm),
  });

  if (!expected) {
    return { toMm: 1000, unitName: 'metres', fit: 50, sizeMm: measure(1000) };
  }

  const [wLo, wHi] = expected.widthMm;
  const [hLo, hHi] = expected.heightMm;

  const scoreOf = (sz: { width: number; height: number }) => {
    const inBand = (v: number, lo: number, hi: number) => {
      if (v >= lo && v <= hi) return 1;
      const mid = (lo + hi) / 2;
      const halfSpan = Math.max(1, (hi - lo) / 2);
      // Falls off with distance outside the band, measured in band-widths.
      return Math.max(0, 1 - Math.abs(v - mid) / (halfSpan * 3));
    };
    return (inBand(sz.width, wLo, wHi) * 0.5 + inBand(sz.height, hLo, hHi) * 0.5) * 100;
  };

  let best: ScaleInference = { toMm: 1000, unitName: 'metres', fit: 0, sizeMm: measure(1000) };
  for (const candidate of UNIT_CANDIDATES) {
    const sizeMm = measure(candidate.toMm);
    const fit = scoreOf(sizeMm);
    if (fit > best.fit) best = { toMm: candidate.toMm, unitName: candidate.name, fit, sizeMm };
  }
  return best;
}
