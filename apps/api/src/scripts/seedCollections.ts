/**
 * Prebuilt collections.
 *
 * A collection is a group of catalogue items with their relative placement
 * kept — the same idea as saving your own from a plan, but curated by Novira
 * and visible to every account (`scope: 'global'`), the way a global venue or
 * global template already works. This is the "prebuilt" starter set the
 * left-hand library should never be empty of, covering a spread of common
 * event moments rather than every possible one.
 *
 * Looks items up by name rather than id, so it runs the same way against a
 * freshly-seeded database in any environment — the catalogue must already
 * carry the procedural items (`npm run assets:procedural`) and a small online
 * sync for chairs, lounge, centerpieces, tableware and plants
 * (`npm run assets:sync -- --category <slug> --limit <n>`) before this runs,
 * or the collections that need them are skipped rather than built empty.
 *
 * Run with: npm run seed:collections --workspace=apps/api
 */
import 'dotenv/config';
import { seatPositions, type CatalogSceneObject } from '@novira/shared';
import { prisma } from '../lib/prisma.js';

interface Item {
  id: number;
  name: string;
  widthMm: number | null;
  depthMm: number | null;
  heightMm: number | null;
  seatsDefault: number | null;
  tableShape: string | null;
  modelUrl: string;
}

function place(
  item: Item,
  role: CatalogSceneObject['generatedRole'] | undefined,
  x: number,
  z: number,
  rotationDeg = 0,
  y = 0
): CatalogSceneObject {
  return {
    id: `${item.id}-${x}-${z}-${Math.random().toString(36).slice(2, 7)}`,
    type: 'catalog',
    name: item.name,
    catalogItemId: item.id,
    modelUrl: item.modelUrl,
    dimensionsMm: {
      width: item.widthMm ?? 600,
      depth: item.depthMm ?? 600,
      height: item.heightMm ?? 600,
    },
    seatsDefault: item.seatsDefault,
    tableShape: (item.tableShape as CatalogSceneObject['tableShape']) ?? null,
    positionMm: { x, y, z },
    rotationDeg: { x: 0, y: rotationDeg, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    ...(role ? { generatedRole: role } : {}),
  };
}

interface CollectionSeed {
  name: string;
  summary: string;
  build: (byName: Map<string, Item>) => CatalogSceneObject[] | null;
}

const COLLECTIONS: CollectionSeed[] = [
  {
    name: 'Round Gala Table for 8',
    summary: 'A full formal cover — table, floor-length linen, chairs and a centrepiece — ready to repeat.',
    build: (byName) => {
      const table = byName.get('Round Table 60"');
      if (!table) return null;
      const objects: CatalogSceneObject[] = [place(table, 'table', 0, 0)];

      // A 132" round cloth is the standard floor-length pairing for a 60"
      // round table — the real ratio caterers use, not a guess.
      const linen = byName.get('Round Tablecloth 132"');
      if (linen) objects.push(place(linen, 'linen', 0, 0));

      const centerpiece = byName.get('Ceramic Vase 01');
      if (centerpiece) objects.push(place(centerpiece, 'centerpiece', 0, 0, 0, table.heightMm ?? 762));

      const chair = byName.get('Dining Chair 02');
      if (chair) {
        const seats = seatPositions(table.seatsDefault ?? 8, {
          shape: 'round',
          widthMm: table.widthMm ?? 1524,
          depthMm: table.depthMm ?? 1524,
        });
        for (const seat of seats) {
          objects.push(place(chair, 'chair', seat.positionMm.x, seat.positionMm.z, seat.rotationDeg));
        }
      }
      return objects;
    },
  },
  {
    name: 'Lounge Vignette',
    summary: 'A soft-seating break-out corner — sofa, armchairs and a low table, greenery either side.',
    build: (byName) => {
      const sofa = byName.get('Sofa 01');
      if (!sofa) return null;
      const objects: CatalogSceneObject[] = [place(sofa, undefined, 0, -900, 0)];

      const armchair = byName.get('Arm Chair 01');
      if (armchair) {
        objects.push(place(armchair, undefined, -1100, -100, -90));
        objects.push(place(armchair, undefined, 1100, -100, 90));
      }
      const table = byName.get('Chinese Tea Table');
      if (table) objects.push(place(table, undefined, 0, -300));

      const plant = byName.get('Potted Plant 01');
      if (plant) objects.push(place(plant, undefined, -1500, -1000));
      const planter = byName.get('Planter Box 01');
      if (planter) objects.push(place(planter, undefined, 1500, -1000, 90));

      return objects;
    },
  },
  {
    name: 'Cocktail Reception Corner',
    summary: 'A serving point with standing tables and a welcome sign — drop it near the entrance.',
    build: (byName) => {
      const bar = byName.get('Portable Bar 6ft');
      if (!bar) return null;
      const objects: CatalogSceneObject[] = [place(bar, undefined, 0, -600, 0)];

      const cocktailTable = byName.get('Cocktail Table 30"');
      if (cocktailTable) {
        objects.push(place(cocktailTable, undefined, -900, 600));
        objects.push(place(cocktailTable, undefined, 900, 600));
      }
      const plant = byName.get('Potted Plant 02');
      if (plant) objects.push(place(plant, undefined, -1600, -600));
      const planter = byName.get('Planter Box 03');
      if (planter) objects.push(place(planter, undefined, 1600, -600, 90));

      const sign = byName.get('A-Frame Sign A1');
      if (sign) objects.push(place(sign, undefined, 0, 1100, 180));

      return objects;
    },
  },
  {
    name: 'Registration & Welcome Desk',
    summary: 'A staffed check-in point with directional signage on either side.',
    build: (byName) => {
      const desk = byName.get('Banquet Table 6ft × 30"');
      if (!desk) return null;
      const objects: CatalogSceneObject[] = [place(desk, 'table', 0, 0)];

      const cloth = byName.get('Banquet Cloth 6ft');
      if (cloth) objects.push(place(cloth, 'linen', 0, 0));

      const chair = byName.get('Dining Chair 02');
      if (chair) objects.push(place(chair, 'chair', 0, -600, 0));

      const sign = byName.get('A-Frame Sign A1');
      if (sign) objects.push(place(sign, undefined, 1300, 300, 90));
      const easel = byName.get('Display Easel');
      if (easel) objects.push(place(easel, undefined, -1300, 300, -90));

      return objects;
    },
  },
];

async function main() {
  const rows = await prisma.catalogItem.findMany({
    where: { scope: 'global', reviewStatus: 'approved', isActive: true },
    select: { id: true, name: true, widthMm: true, depthMm: true, heightMm: true, seatsDefault: true, tableShape: true, modelUrl: true },
  });
  const byName = new Map<string, Item>(rows.map((r) => [r.name, { ...r, id: Number(r.id) }]));
  console.log(`[collections] ${rows.length} approved catalogue items available to build from.`);

  for (const seed of COLLECTIONS) {
    const objects = seed.build(byName);
    if (!objects || !objects.length) {
      console.warn(`[collections] skipped "${seed.name}" — its anchor item is not in the catalogue yet.`);
      continue;
    }

    const data = {
      ownerId: null,
      scope: 'global',
      name: seed.name,
      objects: objects as unknown as object,
      objectCount: objects.length,
      summary: seed.summary,
    };

    const existing = await prisma.collection.findFirst({ where: { scope: 'global', name: seed.name } });
    if (existing) {
      await prisma.collection.update({ where: { id: existing.id }, data });
      console.log(`[collections] updated "${seed.name}" (${objects.length} objects)`);
    } else {
      await prisma.collection.create({ data });
      console.log(`[collections] created "${seed.name}" (${objects.length} objects)`);
    }
  }

  console.log('[collections] done.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
