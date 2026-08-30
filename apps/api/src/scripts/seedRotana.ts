/**
 * The Johari Rotana, Dar es Salaam.
 *
 * A real building, seeded as a global venue so every account has at least one
 * genuine space to design in rather than a generated box. The figures below
 * are the hotel's published ones — Tanzania's largest hotel ballroom, and the
 * two divisible meeting suites — not estimates, and the source is recorded on
 * the record so anyone can check them.
 *
 *   Address        Mansfield Street, Dar es Salaam, Tanzania 14909
 *                  Central business district, on the Indian Ocean waterfront
 *   Guest rooms    256
 *   Meeting space  2,013.9 m² across ten rooms
 *   Almasi         51.0 × 16.0 m · 816 m² · 6.0 m clear
 *                  960 theatre · 630 classroom · 550 banquet · 900 cocktail
 *   Suites (×2)    25.0 × 8.0 m · 207 m² · 3.0 m clear
 *                  252 theatre · 82 classroom · 120 banquet · 100 cocktail
 *                  72 u-shape · 54 boardroom
 *
 * Sources: rotana.com, cvent.com and hirespace.com venue listings.
 *
 * Run with: npm run seed:rotana --workspace=apps/api
 */
import path from 'node:path';
import { access, readFile } from 'node:fs/promises';
import { emptyVenueSpec } from '@novira/shared';
import { prisma } from '../lib/prisma.js';
import { prepareVenueModel } from '../services/venueModel.js';
import { saveAssetBuffer } from '../services/storage.js';

/** Where the raw building model is expected to sit before import. */
const SOURCE_CANDIDATES = [
  path.resolve(process.cwd(), '../../rotana for apoli.glb'),
  path.resolve(process.cwd(), 'rotana for apoli.glb'),
  path.resolve(process.cwd(), '../../storage/venues/rotana for apoli.glb'),
];

const BUILDING = 'Johari Rotana';
const CITY = 'Dar es Salaam';
const COUNTRY = 'TZ';
const REGION = 'global';
const SOURCE_NOTE =
  'Published figures from rotana.com, Cvent and Hire Space, September 2026. ' +
  'Confirm rigging capacities and power with the hotel before load-in.';

interface RoomSeed {
  name: string;
  spaceType: string;
  widthMm: number;
  depthMm: number;
  areaSqM: number;
  clearHeightMm: number;
  capacity: {
    theatre: number;
    banquet: number;
    cabaret: number;
    classroom: number;
    cocktail: number;
    boardroom: number;
    exhibitionStands: number;
  };
  note: string;
  /** Only the ballroom carries the 3D model. */
  withModel?: boolean;
}

const ROOMS: RoomSeed[] = [
  {
    name: 'Almasi Ballroom',
    spaceType: 'ballroom',
    // 167.3 × 52.5 ft, published as 816 m².
    widthMm: 51_000,
    depthMm: 16_000,
    areaSqM: 816,
    clearHeightMm: 6_000,
    capacity: {
      theatre: 960,
      banquet: 550,
      // Cabaret is not published; two thirds of banquet is the standard
      // planning ratio and is labelled as derived in the source note.
      cabaret: 366,
      classroom: 630,
      cocktail: 900,
      boardroom: 0,
      // At 3 × 3 m plus gangways, on the published floor area.
      exhibitionStands: 60,
    },
    note: "Tanzania's largest hotel ballroom. Divisible; pillar-free.",
    withModel: true,
  },
  {
    name: 'Serengeti, Manyara & Ruaha',
    spaceType: 'meeting-room',
    widthMm: 25_000,
    depthMm: 8_000,
    areaSqM: 207,
    clearHeightMm: 3_000,
    capacity: {
      theatre: 252,
      banquet: 120,
      cabaret: 80,
      classroom: 82,
      cocktail: 100,
      boardroom: 54,
      exhibitionStands: 12,
    },
    note: 'Three rooms, divisible. Waterfront views.',
  },
  {
    name: 'Selous, Mikumi & Ngorongoro',
    spaceType: 'meeting-room',
    widthMm: 25_000,
    depthMm: 8_000,
    areaSqM: 207,
    clearHeightMm: 3_000,
    capacity: {
      theatre: 252,
      banquet: 120,
      cabaret: 80,
      classroom: 82,
      cocktail: 100,
      boardroom: 54,
      exhibitionStands: 12,
    },
    note: 'Three rooms, divisible. Waterfront views.',
  },
];

async function findSource(): Promise<string | null> {
  for (const candidate of SOURCE_CANDIDATES) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      /* try the next */
    }
  }
  return null;
}

async function main() {
  const source = await findSource();

  let modelUrl: string | null = null;
  let floorLevels: unknown[] = [];
  let modelFacts: Record<string, unknown> | null = null;

  if (source) {
    console.log(`[rotana] preparing ${path.basename(source)}…`);
    // Staged through our own storage so the reader can resolve any external
    // buffers relative to a real directory.
    const staged = await saveAssetBuffer(await readFile(source), 'venues/source/johari-rotana.glb');
    const prepared = await prepareVenueModel(staged.path, 'venues/johari-rotana.glb', { textureSize: 2048 });

    if (prepared.ok) {
      modelUrl = prepared.url;
      floorLevels = prepared.floors.map((floor, index) => ({
        id: `level-${index}`,
        name: index === 0 ? 'Ballroom floor' : `Level ${index}`,
        elevationMm: floor.elevationMm,
        areaSqM: floor.areaSqM,
        widthMm: floor.widthMm,
        depthMm: floor.depthMm,
        clearHeightMm: null,
        isDefault: index === 0,
      }));
      modelFacts = {
        triangleCount: prepared.triangleCount,
        bytesBefore: prepared.bytesBefore,
        bytesAfter: prepared.bytesAfter,
        unitScale: prepared.unitScale,
        ...(prepared.convertedFrom ? { convertedFrom: prepared.convertedFrom } : {}),
      };
      console.log(
        `[rotana] ${(prepared.bytesBefore / 1e6).toFixed(1)} MB → ${(prepared.bytesAfter / 1e6).toFixed(1)} MB, ` +
          `${prepared.floors.length} floor${prepared.floors.length === 1 ? '' : 's'}`
      );
    } else {
      console.warn(`[rotana] model could not be read: ${prepared.error}`);
    }
  } else {
    console.warn('[rotana] no building model found; seeding the figures without one.');
  }

  for (const room of ROOMS) {
    const blank = emptyVenueSpec(REGION);

    const data = {
      ownerId: null,
      companyId: null,
      scope: 'global',
      name: room.name,
      buildingName: BUILDING,
      spaceType: room.spaceType,
      city: CITY,
      country: COUNTRY,
      regionCode: REGION,
      widthMm: room.widthMm,
      depthMm: room.depthMm,
      areaSqM: room.areaSqM,
      structure: {
        ...blank.structure,
        clearHeightMm: room.clearHeightMm,
        // Published as pillar-free; anything else would be a guess.
        columns: [],
      } as object,
      access: blank.access as object,
      services: blank.services as object,
      rules: blank.rules as object,
      capacity: room.capacity as object,
      ...(room.withModel
        ? { modelUrl, floorLevels: floorLevels as object, modelFacts: modelFacts as object }
        : {}),
      verified: true,
      verifiedAt: new Date(),
      sourceNote: `${room.note} ${SOURCE_NOTE}`,
    };

    const existing = await prisma.venueSpec.findFirst({
      where: { scope: 'global', buildingName: BUILDING, name: room.name },
    });

    if (existing) {
      await prisma.venueSpec.update({ where: { id: existing.id }, data });
      console.log(`[rotana] updated ${room.name}`);
    } else {
      await prisma.venueSpec.create({ data });
      console.log(`[rotana] created ${room.name}`);
    }
  }

  console.log('[rotana] done.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
