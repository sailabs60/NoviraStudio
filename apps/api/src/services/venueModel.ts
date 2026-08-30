/**
 * Turning a building model into a venue you can design in.
 *
 * A venue arrives as whatever the architect, the surveyor or the scanning
 * bureau exported — a hundred megabytes of triangles, textures at 4K, and
 * material extensions that were current when the file was made. Three things
 * have to happen before it is usable in a browser, and none of them is optional:
 *
 *  · **Convert the materials.** Specular-glossiness was deprecated and dropped
 *    from three.js. A file using it renders grey and untextured, which reads as
 *    a broken import rather than as an unsupported extension.
 *  · **Make it fit down a wire.** A designer opening a plan should not wait for
 *    a hundred megabytes. Draco on the geometry and WebP on the textures
 *    routinely take an architectural export to a tenth of its size with no
 *    visible difference at working distance.
 *  · **Find the floors.** This is the part that makes a venue a venue rather
 *    than scenery. Without knowing where the ground floor, the stage and the
 *    mezzanine actually are, every object dropped into the building lands at
 *    the origin — which is very often underneath it.
 *
 * The floor detection is deliberately simple and explainable: measure every
 * upward-facing triangle, total the area at each height, and keep the heights
 * that have enough floor to stand on. No heuristics about what a room is, no
 * guessing at names — just "there is 812 m² of horizontal surface at 0 mm and
 * 240 m² at 4,200 mm", which is exactly what a placement needs to know.
 */
import { NodeIO, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, draco, metalRough, prune, simplify, weld } from '@gltf-transform/functions';
import draco3d from 'draco3d';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../lib/env.js';
import { assetUrl } from './storage.js';

/* ── Reader ────────────────────────────────────────────────────────────── */

let ioPromise: Promise<NodeIO> | null = null;

function getIo(): Promise<NodeIO> {
  if (!ioPromise) {
    ioPromise = (async () => {
      const [decoder, encoder] = await Promise.all([
        draco3d.createDecoderModule(),
        draco3d.createEncoderModule(),
        MeshoptDecoder.ready,
        MeshoptEncoder.ready,
      ]);
      return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
        'draco3d.decoder': decoder,
        'draco3d.encoder': encoder,
        'meshopt.decoder': MeshoptDecoder,
        'meshopt.encoder': MeshoptEncoder,
      });
    })();
  }
  return ioPromise;
}

/* ── Floors ────────────────────────────────────────────────────────────── */

export interface FloorLevel {
  /** Height above the model's own origin, in millimetres. */
  elevationMm: number;
  /** Horizontal surface found at this height. */
  areaSqM: number;
  /** Extent of that surface, for a sanity check in the UI. */
  widthMm: number;
  depthMm: number;
}

export interface VenueModelFacts {
  ok: boolean;
  error?: string;
  /** Overall size in millimetres, after unit inference. */
  sizeMm: { width: number; height: number; depth: number };
  /** Where the model sits relative to its own origin. */
  minMm: { x: number; y: number; z: number };
  maxMm: { x: number; y: number; z: number };
  triangleCount: number;
  meshCount: number;
  materialCount: number;
  textureCount: number;
  /** Multiplier applied to get from file units to millimetres. */
  unitScale: number;
  floors: FloorLevel[];
  /** The extension the file used, when it needed converting. */
  convertedFrom?: string;
}

/**
 * Floors, from the geometry itself.
 *
 * Every triangle is transformed into world space, tested for being flat and
 * facing up, and its area added to a bucket keyed by height. Buckets are 100 mm
 * so a floor that is a few millimetres out of level still lands in one, then
 * adjacent buckets are merged and anything under a threshold is dropped —
 * a table top is a horizontal surface too, and it is not a floor.
 */
function detectFloors(document: Document, unitScale: number, topMm: number): FloorLevel[] {
  const BUCKET_MM = 100;
  const MIN_AREA_SQ_M = 12;
  /*
   * A floor needs somewhere to stand.
   *
   * A roof slab's top face is an upward-facing horizontal surface with a great
   * deal of area, and without this test it is reported as the building's best
   * floor — which would put every dropped chair on the roof. Anything without
   * head height above it is not a floor.
   */
  const MIN_HEADROOM_MM = 2100;

  interface Bucket {
    area: number;
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  }
  const buckets = new Map<number, Bucket>();

  const a = { x: 0, y: 0, z: 0 };
  const b = { x: 0, y: 0, z: 0 };
  const c = { x: 0, y: 0, z: 0 };

  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;

    // World matrix, so an instanced or nested model is measured where it sits.
    const matrix = node.getWorldMatrix();

    for (const prim of mesh.listPrimitives()) {
      const position = prim.getAttribute('POSITION');
      if (!position) continue;
      const indices = prim.getIndices();
      const count = indices ? indices.getCount() : position.getCount();

      const at = (i: number, out: { x: number; y: number; z: number }) => {
        const index = indices ? indices.getScalar(i) : i;
        const v = position.getElement(index, [0, 0, 0]);
        // Column-major 4×4, as glTF stores it.
        out.x = matrix[0]! * v[0]! + matrix[4]! * v[1]! + matrix[8]! * v[2]! + matrix[12]!;
        out.y = matrix[1]! * v[0]! + matrix[5]! * v[1]! + matrix[9]! * v[2]! + matrix[13]!;
        out.z = matrix[2]! * v[0]! + matrix[6]! * v[1]! + matrix[10]! * v[2]! + matrix[14]!;
      };

      for (let i = 0; i + 2 < count; i += 3) {
        at(i, a);
        at(i + 1, b);
        at(i + 2, c);

        // Flat enough to stand on? Compare the height spread to the footprint.
        const spread = Math.max(a.y, b.y, c.y) - Math.min(a.y, b.y, c.y);
        const reach = Math.max(
          Math.abs(a.x - b.x), Math.abs(b.x - c.x), Math.abs(c.x - a.x),
          Math.abs(a.z - b.z), Math.abs(b.z - c.z), Math.abs(c.z - a.z)
        );
        if (reach <= 0 || spread > reach * 0.08) continue;

        // Area of the triangle projected onto the plan.
        const area = Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) / 2;
        if (area <= 0) continue;

        const heightMm = ((a.y + b.y + c.y) / 3) * unitScale;
        const key = Math.round(heightMm / BUCKET_MM) * BUCKET_MM;

        const bucket = buckets.get(key) ?? {
          area: 0,
          minX: Infinity,
          maxX: -Infinity,
          minZ: Infinity,
          maxZ: -Infinity,
        };
        // Areas are in file units squared; convert once, at the end.
        bucket.area += area;
        bucket.minX = Math.min(bucket.minX, a.x, b.x, c.x);
        bucket.maxX = Math.max(bucket.maxX, a.x, b.x, c.x);
        bucket.minZ = Math.min(bucket.minZ, a.z, b.z, c.z);
        bucket.maxZ = Math.max(bucket.maxZ, a.z, b.z, c.z);
        buckets.set(key, bucket);
      }
    }
  }

  const metresPerUnit = unitScale / 1000;
  const levels: FloorLevel[] = [...buckets.entries()]
    .map(([elevationMm, bucket]) => ({
      elevationMm,
      areaSqM: bucket.area * metresPerUnit * metresPerUnit,
      widthMm: Math.round((bucket.maxX - bucket.minX) * unitScale),
      depthMm: Math.round((bucket.maxZ - bucket.minZ) * unitScale),
    }))
    .filter((level) => level.areaSqM >= MIN_AREA_SQ_M && topMm - level.elevationMm >= MIN_HEADROOM_MM)
    .sort((x, y) => x.elevationMm - y.elevationMm);

  /*
   * Merge levels within 400 mm of each other. A real floor is rarely one
   * perfectly flat plane — a threshold, a shallow ramp and a slab all land in
   * neighbouring buckets, and reporting them as three storeys would be worse
   * than useless.
   */
  const merged: FloorLevel[] = [];
  for (const level of levels) {
    const previous = merged[merged.length - 1];
    if (previous && level.elevationMm - previous.elevationMm <= 400) {
      // Keep the height with the most floor at it: that is the real one.
      if (level.areaSqM > previous.areaSqM) previous.elevationMm = level.elevationMm;
      previous.areaSqM += level.areaSqM;
      previous.widthMm = Math.max(previous.widthMm, level.widthMm);
      previous.depthMm = Math.max(previous.depthMm, level.depthMm);
    } else {
      merged.push({ ...level });
    }
  }

  return merged
    .map((level) => ({ ...level, areaSqM: Math.round(level.areaSqM * 10) / 10 }))
    .sort((x, y) => y.areaSqM - x.areaSqM)
    .slice(0, 12)
    .sort((x, y) => x.elevationMm - y.elevationMm);
}

/* ── Units ─────────────────────────────────────────────────────────────── */

/**
 * How many millimetres one file unit is.
 *
 * glTF mandates metres, and most exporters honour it — but architectural
 * pipelines routinely emit centimetres, millimetres or inches, and a venue
 * imported at the wrong scale is either a doll's house or a continent. The
 * building's overall size is the tell: a hotel is tens of metres across, not
 * tens of millimetres and not tens of kilometres.
 */
function inferUnitScale(sizeRaw: { x: number; y: number; z: number }): number {
  const longest = Math.max(sizeRaw.x, sizeRaw.y, sizeRaw.z);
  if (!Number.isFinite(longest) || longest <= 0) return 1000;

  const candidates: Array<{ scale: number; name: string }> = [
    { scale: 1000, name: 'metres' },
    { scale: 10, name: 'centimetres' },
    { scale: 1, name: 'millimetres' },
    { scale: 25.4, name: 'inches' },
    { scale: 304.8, name: 'feet' },
  ];

  // A building's longest dimension: 6 m (a small room) to 400 m (a convention
  // centre). Whichever interpretation lands inside that wins.
  let best = candidates[0]!;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const metres = (longest * candidate.scale) / 1000;
    const score = metres < 6 ? 6 - metres : metres > 400 ? metres - 400 : 0;
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best.scale;
}

/* ── The pipeline ──────────────────────────────────────────────────────── */

export interface OptimiseResult extends VenueModelFacts {
  /** Public URL of the optimised model. */
  url: string;
  bytesBefore: number;
  bytesAfter: number;
}

/**
 * Read a building model, fix it, shrink it and measure it.
 *
 * Every step is guarded on its own: a texture that will not re-encode, or a
 * primitive Draco refuses, must not lose the whole import. A venue that is
 * merely large is still a usable venue; one that failed to import is not.
 */
export async function prepareVenueModel(
  sourcePath: string,
  relativeOut: string,
  options: { compress?: boolean; textureSize?: number; triangleBudget?: number } = {}
): Promise<OptimiseResult> {
  const io = await getIo();
  const bytesBefore = (await stat(sourcePath)).size;

  const empty: VenueModelFacts = {
    ok: false,
    sizeMm: { width: 0, height: 0, depth: 0 },
    minMm: { x: 0, y: 0, z: 0 },
    maxMm: { x: 0, y: 0, z: 0 },
    triangleCount: 0,
    meshCount: 0,
    materialCount: 0,
    textureCount: 0,
    unitScale: 1000,
    floors: [],
  };

  let document: Document;
  try {
    document = await io.read(sourcePath);
  } catch (error) {
    return { ...empty, error: (error as Error).message, url: '', bytesBefore, bytesAfter: bytesBefore };
  }

  const root = document.getRoot();
  const usedExtensions = root.listExtensionsUsed().map((e) => e.extensionName);
  const hadSpecGloss = usedExtensions.includes('KHR_materials_pbrSpecularGlossiness');

  /*
   * Specular-glossiness first.
   *
   * three.js removed support for it, so a file using it renders as untextured
   * grey — which every user reads as "the import is broken" rather than as an
   * unsupported extension. Converting is the only way the model looks like the
   * building.
   */
  if (hadSpecGloss) {
    try {
      await document.transform(metalRough());
    } catch (error) {
      console.warn('[venueModel] specular-glossiness conversion failed:', (error as Error).message);
    }
  }

  // Bounds and counts, measured before compression changes the topology.
  const bounds = measure(document);
  const unitScale = inferUnitScale({
    x: bounds.max.x - bounds.min.x,
    y: bounds.max.y - bounds.min.y,
    z: bounds.max.z - bounds.min.z,
  });

  const floors = detectFloors(document, unitScale, bounds.max.y * unitScale);

  /*
   * Put the building where the plan thinks it is.
   *
   * A plan's coordinate system has the origin in the middle of the room and
   * the floor at zero. A building exported from an architectural tool has
   * neither: the Almasi Ballroom arrived centred forty metres off, with its
   * floor two hundred millimetres above the ground plane. Left alone, the
   * venue's floor polygon, its keep-clear zones and its rigging markers — all
   * of which are generated around the origin — end up in an empty field beside
   * the building, and everything dropped onto the "ground" lands 200 mm under
   * the ballroom floor. That second one is exactly the fault this import was
   * meant to remove.
   *
   * So the geometry is moved once, here, rather than every consumer being
   * taught to compensate: centred on X and Z, and lowered so the *lowest real
   * floor* — not the underside of the foundations — sits at zero.
   */
  const groundY = floors.length
    ? Math.min(...floors.map((floor) => floor.elevationMm)) / unitScale
    : bounds.min.y;
  const offset = {
    x: -(bounds.min.x + bounds.max.x) / 2,
    y: -groundY,
    z: -(bounds.min.z + bounds.max.z) / 2,
  };

  if (offset.x || offset.y || offset.z) {
    for (const scene of root.listScenes()) {
      for (const node of scene.listChildren()) {
        const [x, y, z] = node.getTranslation();
        node.setTranslation([x + offset.x, y + offset.y, z + offset.z]);
      }
    }
    for (const floor of floors) floor.elevationMm = Math.round(floor.elevationMm + offset.y * unitScale);
    bounds.min.x += offset.x;
    bounds.max.x += offset.x;
    bounds.min.y += offset.y;
    bounds.max.y += offset.y;
    bounds.min.z += offset.z;
    bounds.max.z += offset.z;
  }

  if (options.compress !== false) {
    try {
      await document.transform(dedup(), prune());
    } catch (error) {
      console.warn('[venueModel] cleanup failed:', (error as Error).message);
    }

    /*
     * Textures after the material conversion, so the maps it generates are
     * compressed too.
     *
     * This ordering only became possible once `sharp` was aligned with the
     * version `ndarray-pixels` wants. Before that there were two copies of
     * libvips in the process — ours and gltf-transform's — and whichever
     * initialised second failed, taking every resize with it and reporting
     * "colourspace: parameter space not set", which looks exactly like a
     * corrupt texture and is nothing of the kind.
     */
    await compressTextures(document, options.textureSize ?? 2048);

    try {
      // Welding first: Draco encodes indexed geometry, and an unindexed
      // primitive is silently skipped otherwise, and simplification needs the
      // shared vertices to collapse along.
      await document.transform(weld());
    } catch (error) {
      console.warn('[venueModel] weld failed:', (error as Error).message);
    }

    /*
     * Fewer triangles, if there are far too many.
     *
     * File size is not the thing that hurts here. The Almasi Ballroom came out
     * of its authoring tool at 1.48 million triangles — which Draco packs into
     * a perfectly reasonable 2.5 MB, and which then takes seconds to draw
     * every single frame. A building the designer has to wait for between
     * clicks is not usable however small the download was.
     *
     * Architectural geometry simplifies unusually well: it is mostly large
     * flat panels carrying far more triangles than their shape needs. The
     * error bound is what keeps this honest — meshoptimizer stops collapsing
     * rather than distorting the building to hit a ratio, so a model that is
     * genuinely all detail comes back barely changed instead of melted.
     */
    const budget = options.triangleBudget ?? 400_000;
    if (bounds.triangles > budget) {
      try {
        await MeshoptSimplifier.ready;
        await document.transform(
          simplify({
            simplifier: MeshoptSimplifier,
            ratio: Math.max(0.05, budget / bounds.triangles),
            // 1% of the model's size. Generous enough to remove the tessellation
            // nobody can see, tight enough to keep a door reading as a door.
            error: 0.01,
            lockBorder: true,
          })
        );
      } catch (error) {
        console.warn('[venueModel] simplification failed:', (error as Error).message);
      }
    }

    try {
      await document.transform(draco());
    } catch (error) {
      console.warn('[venueModel] draco compression failed:', (error as Error).message);
    }
  }

  const full = path.join(env.assetDir, relativeOut);
  await io.write(full, document);
  const bytesAfter = (await stat(full)).size;

  return {
    ok: true,
    url: assetUrl(relativeOut),
    bytesBefore,
    bytesAfter,
    sizeMm: {
      width: Math.round((bounds.max.x - bounds.min.x) * unitScale),
      height: Math.round((bounds.max.y - bounds.min.y) * unitScale),
      depth: Math.round((bounds.max.z - bounds.min.z) * unitScale),
    },
    minMm: {
      x: Math.round(bounds.min.x * unitScale),
      y: Math.round(bounds.min.y * unitScale),
      z: Math.round(bounds.min.z * unitScale),
    },
    maxMm: {
      x: Math.round(bounds.max.x * unitScale),
      y: Math.round(bounds.max.y * unitScale),
      z: Math.round(bounds.max.z * unitScale),
    },
    // Measured again after the transforms: reporting the incoming count would
    // tell a designer their 1.5-million-triangle building is still that, when
    // the whole point of the import was that it is not.
    triangleCount: measure(document).triangles,
    meshCount: root.listMeshes().length,
    materialCount: root.listMaterials().length,
    textureCount: root.listTextures().length,
    unitScale,
    floors,
    ...(hadSpecGloss ? { convertedFrom: 'KHR_materials_pbrSpecularGlossiness' } : {}),
  };
}

/**
 * Re-encode the textures, one at a time.
 *
 * `textureCompress` does the whole document in one transform, which means a
 * single image sharp cannot read — an unusual colour space, a malformed
 * embedded profile, a format libvips was not built with — abandons the entire
 * pass and leaves forty megabytes of PNG in a file meant for a browser.
 *
 * Architectural exports are exactly where those images turn up, so each texture
 * is converted on its own and a failure costs one image rather than all of
 * them. A texture that grows is discarded: some small images genuinely are
 * smaller as PNG.
 */
async function compressTextures(document: Document, maxSize: number): Promise<void> {
  for (const texture of document.getRoot().listTextures()) {
    const image = texture.getImage();
    if (!image) continue;

    try {
      const before = image.byteLength;
      const encoded = await sharp(Buffer.from(image))
        .resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82, effort: 4 })
        .toBuffer();

      if (encoded.byteLength < before) {
        texture.setImage(new Uint8Array(encoded));
        texture.setMimeType('image/webp');
      }
    } catch (error) {
      console.warn(
        `[venueModel] texture "${texture.getName() || 'unnamed'}" left as-is: ${(error as Error).message}`
      );
    }
  }
}

/** World-space bounds and triangle count, in the file's own units. */
function measure(document: Document) {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  let triangles = 0;

  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const matrix = node.getWorldMatrix();

    for (const prim of mesh.listPrimitives()) {
      const position = prim.getAttribute('POSITION');
      if (!position) continue;
      const indices = prim.getIndices();
      triangles += (indices ? indices.getCount() : position.getCount()) / 3;

      for (let i = 0; i < position.getCount(); i += 1) {
        const v = position.getElement(i, [0, 0, 0]);
        const x = matrix[0]! * v[0]! + matrix[4]! * v[1]! + matrix[8]! * v[2]! + matrix[12]!;
        const y = matrix[1]! * v[0]! + matrix[5]! * v[1]! + matrix[9]! * v[2]! + matrix[13]!;
        const z = matrix[2]! * v[0]! + matrix[6]! * v[1]! + matrix[10]! * v[2]! + matrix[14]!;
        if (x < min.x) min.x = x;
        if (y < min.y) min.y = y;
        if (z < min.z) min.z = z;
        if (x > max.x) max.x = x;
        if (y > max.y) max.y = y;
        if (z > max.z) max.z = z;
      }
    }
  }

  if (!Number.isFinite(min.x)) {
    return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 }, triangles: 0 };
  }
  return { min, max, triangles: Math.round(triangles) };
}
