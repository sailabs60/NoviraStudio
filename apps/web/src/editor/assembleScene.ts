/**
 * Turning a plan into a scene.
 *
 * The concept engine produces a plan: 48 tables at these coordinates, 12
 * chandeliers at that trim, banners on these walls. This module turns that
 * plan into scene objects — and the *shape* of what it produces is the whole
 * point of it.
 *
 * ## Every object stands on its own
 *
 * A generated event is not one mesh. It is a table, and ten chairs around that
 * table, and another table, each with its own id, its own transform, its own
 * dimensions and its own place in the scene graph. Deleting chair 17 deletes
 * chair 17. Replacing the stage screen leaves the other 400 objects alone.
 * That is what makes the result something you can work on rather than
 * something you can only look at, and it is why this module never merges,
 * flattens or bakes anything.
 *
 * ## Grouping without nesting
 *
 * The scene is a flat list, and the hierarchy is carried in fields on each
 * object: `groupId` ties a table to its own chairs, and `assemblyRole` says
 * what part an object plays in the event — `stage`, `seating`, `lighting`,
 * `branding`, `decor`. A flat list with grouping keys is what the editor,
 * the undo stack, the selection model and the persistence layer already
 * understand, and re-parenting the scene into a tree to express the same
 * information would mean rewriting all four for no gain the user can see.
 *
 * ## Real models, real sizes
 *
 * Furniture comes from the catalogue, where a round table is 1829 mm because
 * somebody measured one. Where the catalogue has nothing suitable the object
 * is still placed — as a procedural fixture or a correctly-sized shape — so a
 * plan never silently loses a piece of the event it promised.
 */
import type {
  CatalogItemDto,
  CatalogSceneObject,
  ConceptElement,
  ConceptResult,
  SceneObject,
} from '@novira/shared';
import { createBooth, createLedScreen, createLight, createTruss, newId } from './factories';

/* ── What an assembled object is for ───────────────────────────────────── */

/**
 * The part an object plays in the event.
 *
 * Kept on the object so a later instruction — "make the lighting warmer",
 * "replace all the branding" — can find everything it applies to without
 * guessing from names, and so the scene tree can group what it shows.
 */
export type AssemblyRole =
  | 'venue'
  | 'stage'
  | 'seating'
  | 'exhibition'
  | 'lighting'
  | 'branding'
  | 'decor'
  | 'circulation';

/** Extra fields assembly writes onto every object it makes. */
export interface AssemblyMeta {
  assemblyRole?: AssemblyRole;
  /** The plan element this came from, so a regenerate can replace just it. */
  assemblyElement?: string;
}

/* ── Choosing catalogue items ──────────────────────────────────────────── */

export interface Catalogue {
  /** Every item the account can place, already loaded. */
  items: CatalogItemDto[];
}

const slugOf = (item: CatalogItemDto): string =>
  (item as unknown as { categorySlug?: string; category?: { slug?: string } }).categorySlug ??
  (item as unknown as { category?: { slug?: string } }).category?.slug ??
  '';

/**
 * Pick the catalogue item that best fits what the plan asked for.
 *
 * Scored rather than filtered, because the catalogue on any given account is
 * whatever that account happens to own: asking for a round table that seats
 * ten and finding none should give the nearest round table, not nothing. The
 * score is dominated by the category, then by how close the size is, then by
 * words in the name — the same ordering a person uses when picking off a
 * shelf.
 */
export function pickItem(
  catalogue: Catalogue,
  want: {
    category: string;
    /** Words that should appear in the name, in order of importance. */
    keywords?: string[];
    widthMm?: number;
    heightMm?: number;
    seats?: number;
    shape?: 'round' | 'rectangular';
  }
): CatalogItemDto | null {
  let best: CatalogItemDto | null = null;
  let bestScore = -1;

  for (const item of catalogue.items) {
    let score = 0;
    if (slugOf(item) === want.category) score += 50;
    else continue; // Wrong category is not a near miss; it is a different thing.

    const name = item.name.toLowerCase();
    let keywordHit = false;
    for (const [index, word] of (want.keywords ?? []).entries()) {
      if (name.includes(word.toLowerCase())) {
        score += Math.max(4, 20 - index * 4);
        keywordHit = true;
      }
    }

    /*
     * A category match on its own is not a match.
     *
     * Categories are broad — "decor" holds chandeliers, plinths and potted
     * palms — so scoring on size alone inside a category picks whatever
     * happens to be nearest the requested dimensions. Asking for a 1.2 m
     * chandelier returned a 0.84 m potted palm, which is the kind of result
     * that makes a generated room look like nobody read the brief. When
     * keywords are given, at least one has to land.
     */
    if ((want.keywords?.length ?? 0) > 0 && !keywordHit) continue;

    if (want.shape) {
      const shape = (item as unknown as { tableShape?: string }).tableShape;
      if (shape === want.shape) score += 25;
      else if (shape) score -= 15;
    }

    if (want.seats) {
      const seats = (item as unknown as { seatsDefault?: number | null }).seatsDefault;
      if (seats === want.seats) score += 20;
      else if (seats) score -= Math.min(15, Math.abs(seats - want.seats) * 3);
    }

    // Size closeness on the ratio, so a 10 % error costs the same on a chair
    // and on a stage.
    if (want.widthMm && item.widthMm) {
      const ratio = item.widthMm / want.widthMm;
      const closeness = ratio > 1 ? 1 / ratio : ratio;
      score += Math.round(closeness * 20);
      /*
       * Being the wrong size is a fault, not merely an absence of merit. A
       * 0.6 m A-frame sign offered for a 2.4 m banner is worse than nothing,
       * because the fallback draws the right size and this does not.
       */
      if (closeness < 0.4) score -= 30;
    }
    if (want.heightMm && item.heightMm) {
      const ratio = item.heightMm / want.heightMm;
      const closeness = ratio > 1 ? 1 / ratio : ratio;
      score += Math.round(closeness * 10);
    }

    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }

  /*
   * Below this the best candidate is a coincidence rather than a choice, and
   * the caller's fallback — which draws the requested size — is the better
   * answer. Refusing here is what keeps a potted palm out of the ceiling.
   */
  return bestScore >= 60 ? best : null;
}

/* ── Building objects ──────────────────────────────────────────────────── */

function catalogObject(
  item: CatalogItemDto,
  opts: {
    xMm: number;
    zMm: number;
    yMm?: number;
    rotationDeg?: number;
    role: AssemblyRole;
    element: string;
    groupId?: string;
    name?: string;
    generatedRole?: CatalogSceneObject['generatedRole'];
  }
): CatalogSceneObject {
  return {
    id: newId(),
    type: 'catalog',
    name: opts.name ?? item.name,
    catalogItemId: item.id,
    modelUrl: item.modelUrl ?? undefined,
    dimensionsMm: {
      width: item.widthMm ?? 600,
      depth: item.depthMm ?? 600,
      height: item.heightMm ?? 600,
    },
    seatsDefault: (item as unknown as { seatsDefault?: number | null }).seatsDefault ?? null,
    tableShape: (item as unknown as { tableShape?: 'round' | 'rectangular' | 'other' | null }).tableShape ?? null,
    positionMm: { x: Math.round(opts.xMm), y: Math.round(opts.yMm ?? 0), z: Math.round(opts.zMm) },
    rotationDeg: { x: 0, y: opts.rotationDeg ?? 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    ...(opts.groupId ? { groupId: opts.groupId } : {}),
    ...(opts.generatedRole ? { generatedRole: opts.generatedRole } : {}),
    assemblyRole: opts.role,
    assemblyElement: opts.element,
  } as CatalogSceneObject & AssemblyMeta;
}

/**
 * A correctly-sized stand-in, when the catalogue has nothing to offer.
 *
 * Deliberately a real object with real dimensions rather than a skipped
 * placement: the plan said something stands here and how big it is, and
 * showing that is more useful — and more honest — than a gap the user has to
 * notice for themselves.
 */
function shapeObject(
  element: ConceptElement,
  role: AssemblyRole,
  opts: { fillColor: string; extrudeMm?: number; opacity?: number; yMm?: number }
): SceneObject {
  return {
    id: newId(),
    type: 'shape',
    name: element.label,
    positionMm: { x: element.xMm, y: Math.round(opts.yMm ?? 0), z: element.zMm },
    rotationDeg: { x: 0, y: element.rotationDeg, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    kind: 'rectangle',
    widthMm: element.widthMm,
    depthMm: element.depthMm,
    extrudeMm: opts.extrudeMm ?? 0,
    fillColor: opts.fillColor,
    fillOpacity: opts.opacity ?? 0.9,
    borderColor: '#94a3b8',
    borderOpacity: 1,
    assemblyRole: role,
    assemblyElement: element.kind,
  } as unknown as SceneObject;
}

/* ── The assembly itself ───────────────────────────────────────────────── */

export interface AssemblyReport {
  objects: SceneObject[];
  /** Counts by role, for the review step. */
  byRole: Record<string, number>;
  /** Element kinds that had to fall back to a stand-in, and why. */
  substitutions: string[];
}

/**
 * Assemble a concept into scene objects.
 *
 * The order objects are created in is the order they appear in the scene tree,
 * so the event reads top to bottom the way a production schedule does: the
 * room, then the stage, then the seating, then the rest.
 */
export function assembleScene(concept: ConceptResult, catalogue: Catalogue): AssemblyReport {
  const objects: SceneObject[] = [];
  const substitutions: string[] = [];

  const note = (message: string) => {
    if (!substitutions.includes(message)) substitutions.push(message);
  };

  for (const element of concept.elements) {
    const position = { x: element.xMm, y: 0, z: element.zMm };

    switch (element.kind) {
      /* ── Structure ─────────────────────────────────────────────────── */

      case 'stage': {
        const params = element.params as { deckColumns: number; deckRows: number; deckHeightMm: number };
        objects.push({
          id: newId(),
          type: 'stage',
          name: element.label,
          positionMm: position,
          rotationDeg: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          deckRows: params.deckRows,
          deckColumns: params.deckColumns,
          deckHeightMm: params.deckHeightMm,
          stairSides: ['south'],
          stairBays: { south: 1 },
          skirtSides: ['north', 'east', 'south', 'west'],
          guardrailSides: params.deckHeightMm > 762 ? ['north', 'east', 'west'] : [],
          assemblyRole: 'stage',
          assemblyElement: 'stage',
        } as unknown as SceneObject);
        break;
      }

      case 'screen': {
        const params = element.params as {
          panelKey: string;
          columns: number;
          rows: number;
          bottomMm: number;
          frame: string;
          curveDeg: number;
        };
        objects.push({
          ...createLedScreen({
            panelKey: params.panelKey,
            columns: params.columns,
            rows: params.rows,
            bottomMm: params.bottomMm,
            frame: params.frame as never,
            curveDeg: params.curveDeg,
            position,
            name: element.label,
          }),
          assemblyRole: 'stage',
          assemblyElement: 'screen',
        } as unknown as SceneObject);
        break;
      }

      case 'truss': {
        const params = element.params as {
          shape: string;
          systemKey: string;
          trimHeightMm: number;
          legType: string;
        };
        objects.push({
          ...createTruss({
            shape: params.shape as never,
            systemKey: params.systemKey,
            widthMm: element.widthMm,
            depthMm: element.depthMm,
            trimHeightMm: params.trimHeightMm,
            legType: params.legType as never,
            position,
            name: element.label,
          }),
          assemblyRole: 'stage',
          assemblyElement: 'truss',
        } as unknown as SceneObject);
        break;
      }

      case 'booth-grid': {
        const params = element.params as {
          placements: Array<{ centre: { xMm: number; zMm: number }; rotationDeg: number; standNumber: string }>;
          boothType: string;
          widthMm: number;
          depthMm: number;
        };
        for (const placement of params.placements) {
          objects.push({
            ...createBooth({
              boothType: params.boothType as never,
              widthMm: params.widthMm,
              depthMm: params.depthMm,
              standNumber: placement.standNumber,
              position: { x: placement.centre.xMm, y: 0, z: placement.centre.zMm },
              rotationDeg: placement.rotationDeg,
            }),
            assemblyRole: 'exhibition',
            assemblyElement: 'booth',
          } as unknown as SceneObject);
        }
        break;
      }

      /* ── Furniture: real tables, real chairs ───────────────────────── */

      case 'dining': {
        const params = element.params as {
          seats: number;
          tableDiameterMm: number;
          tableIndex: number;
          chairs: Array<{ xMm: number; zMm: number; rotationDeg: number }>;
        };

        // One group per table, so the table and its own chairs move together
        // when that is wanted and separately when it is not.
        const groupId = newId();

        const table = pickItem(catalogue, {
          category: 'tables',
          keywords: ['round'],
          shape: 'round',
          seats: params.seats,
          widthMm: params.tableDiameterMm,
        });

        if (table) {
          objects.push(
            catalogObject(table, {
              xMm: element.xMm,
              zMm: element.zMm,
              role: 'seating',
              element: 'dining-table',
              groupId,
              generatedRole: 'table',
              name: `${element.label} — ${table.name}`,
            })
          );
        } else {
          note('No round table in the catalogue; tables placed as sized markers.');
          objects.push(shapeObject(element, 'seating', { fillColor: '#94a3b8', extrudeMm: 750 }));
        }

        const chair = pickItem(catalogue, {
          category: 'chairs',
          keywords: ['dining', 'banquet', 'chair'],
          heightMm: 950,
        });

        if (chair) {
          for (const [index, seat] of params.chairs.entries()) {
            objects.push(
              catalogObject(chair, {
                xMm: seat.xMm,
                zMm: seat.zMm,
                rotationDeg: seat.rotationDeg,
                role: 'seating',
                element: 'dining-chair',
                groupId,
                generatedRole: 'chair',
                name: `${element.label} chair ${index + 1}`,
              })
            );
          }
        } else {
          note('No chair in the catalogue; tables placed without chairs.');
        }
        break;
      }

      /* ── Lighting ──────────────────────────────────────────────────── */

      case 'chandelier': {
        const params = element.params as { trimMm: number };
        const item = pickItem(catalogue, {
          category: 'decor',
          keywords: ['chandelier', 'pendant', 'hanging'],
          widthMm: element.widthMm,
        });
        if (item) {
          objects.push(
            catalogObject(item, {
              xMm: element.xMm,
              zMm: element.zMm,
              yMm: params.trimMm,
              role: 'lighting',
              element: 'chandelier',
              name: element.label,
            })
          );
        } else {
          /*
           * No chandelier model, so hang a real light instead of nothing. It
           * lights the room correctly even though it does not look like a
           * chandelier, which is the more useful half of what was asked for.
           */
          note('No chandelier model in the catalogue; hung pendant fixtures that light the room correctly.');
          objects.push({
            ...createLight({
              position: { x: element.xMm, y: params.trimMm, z: element.zMm },
              name: element.label,
            }),
            assemblyRole: 'lighting',
            assemblyElement: 'chandelier',
          } as unknown as SceneObject);
        }
        break;
      }

      case 'spotlight': {
        const params = element.params as { trimMm: number; colorHex?: string };
        objects.push({
          ...createLight({
            position: { x: element.xMm, y: params.trimMm, z: element.zMm },
            name: element.label,
          }),
          assemblyRole: 'lighting',
          assemblyElement: 'spotlight',
        } as unknown as SceneObject);
        break;
      }

      /* ── Branding ──────────────────────────────────────────────────── */

      case 'banner': {
        const params = element.params as { colorHex?: string; accentHex?: string };
        const item = pickItem(catalogue, {
          category: 'signage',
          keywords: ['banner', 'sign', 'panel'],
          widthMm: element.widthMm,
          heightMm: element.heightMm,
        });
        if (item) {
          objects.push(
            catalogObject(item, {
              xMm: element.xMm,
              zMm: element.zMm,
              rotationDeg: element.rotationDeg,
              role: 'branding',
              element: 'banner',
              name: element.label,
            })
          );
        } else {
          note('No banner model in the catalogue; branding placed as coloured panels.');
          objects.push(
            shapeObject(element, 'branding', {
              fillColor: params.colorHex ?? '#0B5FFF',
              extrudeMm: element.heightMm,
              opacity: 1,
            })
          );
        }
        break;
      }

      /* ── Decor ─────────────────────────────────────────────────────── */

      case 'plant': {
        const item = pickItem(catalogue, {
          category: 'plants',
          keywords: ['planter', 'plant', 'tree', 'palm'],
          heightMm: element.heightMm,
        });
        if (item) {
          objects.push(
            catalogObject(item, {
              xMm: element.xMm,
              zMm: element.zMm,
              role: 'decor',
              element: 'plant',
              name: element.label,
            })
          );
        } else {
          note('No planting in the catalogue.');
        }
        break;
      }

      case 'lounge': {
        const item = pickItem(catalogue, {
          category: 'lounge',
          keywords: ['sofa', 'settee', 'armchair'],
          widthMm: element.widthMm,
        });
        if (item) {
          objects.push(
            catalogObject(item, {
              xMm: element.xMm,
              zMm: element.zMm,
              rotationDeg: element.rotationDeg,
              role: 'decor',
              element: 'lounge',
              name: element.label,
            })
          );
        } else {
          note('No lounge seating in the catalogue.');
        }
        break;
      }

      /* ── Floor ─────────────────────────────────────────────────────── */

      case 'carpet': {
        const params = element.params as { colorHex?: string };
        objects.push(
          shapeObject(element, 'circulation', {
            fillColor: params.colorHex ?? '#1f2937',
            extrudeMm: 0,
            opacity: 1,
          })
        );
        break;
      }

      case 'walkway': {
        const params = element.params as { colorHex?: string };
        objects.push(
          shapeObject(element, 'circulation', {
            fillColor: params.colorHex ?? '#0B5FFF',
            extrudeMm: 0,
            opacity: 0.55,
          })
        );
        break;
      }

      case 'dance-floor': {
        objects.push(shapeObject(element, 'circulation', { fillColor: '#c084fc', extrudeMm: 25 }));
        break;
      }

      /* ── Service ───────────────────────────────────────────────────── */

      case 'bar':
      case 'registration':
      case 'catering': {
        const item = pickItem(catalogue, {
          category: 'bars-catering',
          keywords: element.kind === 'bar' ? ['bar'] : element.kind === 'catering' ? ['buffet', 'station'] : ['desk', 'counter'],
          widthMm: element.widthMm,
          heightMm: element.heightMm,
        });
        if (item) {
          objects.push(
            catalogObject(item, {
              xMm: element.xMm,
              zMm: element.zMm,
              rotationDeg: element.rotationDeg,
              role: 'circulation',
              element: element.kind,
              name: element.label,
            })
          );
        } else {
          objects.push(
            shapeObject(element, 'circulation', { fillColor: '#0f766e', extrudeMm: element.heightMm })
          );
        }
        break;
      }

      /*
       * The seating region.
       *
       * When the plan filled it with real rounds, the region is a planning
       * artefact and drawing it would put a grey rectangle under the
       * furniture — so it is dropped. For rows and standing, nothing was laid
       * inside it, and dropping it would silently lose the largest part of the
       * event; there it is kept as a marked zone until chairs are chosen.
       */
      case 'seating': {
        const filled = concept.elements.some((other) => other.kind === 'dining');
        if (!filled) {
          objects.push(shapeObject(element, 'seating', { fillColor: '#334155', opacity: 0.35 }));
        }
        break;
      }

      default:
        break;
    }
  }

  const byRole: Record<string, number> = {};
  for (const object of objects) {
    const role = (object as SceneObject & AssemblyMeta).assemblyRole ?? 'other';
    byRole[role] = (byRole[role] ?? 0) + 1;
  }

  return { objects, byRole, substitutions };
}
