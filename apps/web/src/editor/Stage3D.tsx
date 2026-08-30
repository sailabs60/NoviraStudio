import { useMemo } from 'react';
import {
  DECK_SIZE_MM,
  RAIL_TYPE_THRESHOLD_MM,
  baysOnSide,
  mmToWorld,
  stairForHeight,
  type StageSceneObject,
  type StageSide,
} from '@novira/shared';

/**
 * Stage geometry.
 *
 * Built from the same numbers the parts list is derived from, so what is drawn
 * and what gets loaded on the truck cannot drift apart: decks on a grid, legs
 * at the shared intersections, skirt panels per exposed bay with a gap where a
 * stair lands, and rail whose form follows the deck height.
 *
 * Three details separate a drawn stage from a grey box:
 *
 *  - The deck frame is geometry, not a wireframe. A Steeldeck or StageDex
 *    module is a plywood top in an aluminium perimeter extrusion, and that
 *    bright edge against the dark top is how the modularity reads at any
 *    distance. Drawn as a line overlay it looked like a selection highlight.
 *  - Tall legs are braced. Above about 600 mm a modular stage is not stood on
 *    bare legs; it gets diagonal bracing in the leg bays, and a designer
 *    looking at a 1.2 m stage without any will not believe the drawing.
 *  - Every mesh names its part, so a finish can be dropped on the deck top
 *    without touching the legs, the skirt or the rail.
 */

interface Props {
  stage: StageSceneObject;
  selected: boolean;
}

/** Outward normal and centre offset for one side of the deck grid. */
function sideGeometry(stage: StageSceneObject, side: StageSide) {
  const halfW = (stage.deckColumns * DECK_SIZE_MM) / 2;
  const halfD = (stage.deckRows * DECK_SIZE_MM) / 2;
  switch (side) {
    case 'north':
      return { axis: 'x' as const, z: -halfD, rotationY: 0, span: stage.deckColumns, halfSpan: halfW };
    case 'south':
      return { axis: 'x' as const, z: halfD, rotationY: Math.PI, span: stage.deckColumns, halfSpan: halfW };
    case 'west':
      return { axis: 'z' as const, z: -halfW, rotationY: Math.PI / 2, span: stage.deckRows, halfSpan: halfD };
    case 'east':
    default:
      return { axis: 'z' as const, z: halfW, rotationY: -Math.PI / 2, span: stage.deckRows, halfSpan: halfD };
  }
}

/** World position of the centre of bay `index` on a side. */
function bayCentre(stage: StageSceneObject, side: StageSide, index: number) {
  const geo = sideGeometry(stage, side);
  const offset = -geo.halfSpan + (index + 0.5) * DECK_SIZE_MM;
  if (side === 'north') return { x: offset, z: geo.z };
  if (side === 'south') return { x: offset, z: geo.z };
  if (side === 'west') return { x: geo.z, z: offset };
  return { x: geo.z, z: offset };
}

export function Stage3D({ stage, selected }: Props) {
  const height = mmToWorld(stage.deckHeightMm);
  const deck = mmToWorld(DECK_SIZE_MM);
  const deckThickness = mmToWorld(38);
  const halfW = (stage.deckColumns * deck) / 2;
  const halfD = (stage.deckRows * deck) / 2;

  const stair = useMemo(() => stairForHeight(stage.deckHeightMm), [stage.deckHeightMm]);
  const verticalRail = stage.deckHeightMm > RAIL_TYPE_THRESHOLD_MM;

  /*
   * A real deck is a dark non-slip top in an aluminium frame. The previous
   * defaults were near-black on near-black, so the deck seams, the legs and
   * the skirt all merged into one silhouette and the stage read as a solid
   * block rather than a platform you could stand on.
   */
  const deckColor = selected ? '#7c7fe8' : (stage.deckColor ?? '#41454d');
  const skirtColor = stage.skirtColor ?? '#23262b';
  const frameColor = '#9aa0a8';

  return (
    <group>
      {/* Deck surface — one slab per module so the grid reads. */}
      {Array.from({ length: stage.deckRows }).flatMap((_, row) =>
        Array.from({ length: stage.deckColumns }).map((__, col) => (
          <mesh
            key={`deck-${row}-${col}`}
            position={[
              -halfW + (col + 0.5) * deck,
              height - deckThickness / 2,
              -halfD + (row + 0.5) * deck,
            ]}
            castShadow
            receiveShadow
            userData={{ part: 'deck' }}
          >
            <boxGeometry args={[deck * 0.995, deckThickness, deck * 0.995]} />
            <meshStandardMaterial color={deckColor} roughness={0.85} />
          </mesh>
        ))
      )}

      {/*
        The aluminium edge frame around every deck. This is what makes the
        modularity visible — without it a 4 × 6 grid and one big slab look the
        same, and the parts list beside it stops making sense.
      */}
      {Array.from({ length: stage.deckRows }).flatMap((_, row) =>
        Array.from({ length: stage.deckColumns }).map((__, col) => {
          const cx = -halfW + (col + 0.5) * deck;
          const cz = -halfD + (row + 0.5) * deck;
          const rail = mmToWorld(45);
          const y = height - deckThickness / 2;
          return (
            <group key={`edge-${row}-${col}`}>
              {([-1, 1] as const).map((s) => (
                <mesh
                  key={`x${s}`}
                  position={[cx, y, cz + (s * deck) / 2]}
                  castShadow
                  userData={{ part: 'deck-frame' }}
                >
                  <boxGeometry args={[deck, deckThickness * 1.05, rail]} />
                  <meshStandardMaterial color={frameColor} metalness={0.72} roughness={0.34} />
                </mesh>
              ))}
              {([-1, 1] as const).map((s) => (
                <mesh
                  key={`z${s}`}
                  position={[cx + (s * deck) / 2, y, cz]}
                  castShadow
                  userData={{ part: 'deck-frame' }}
                >
                  <boxGeometry args={[rail, deckThickness * 1.05, deck]} />
                  <meshStandardMaterial color={frameColor} metalness={0.72} roughness={0.34} />
                </mesh>
              ))}
            </group>
          );
        })
      )}

      {/* Legs at the shared grid intersections. */}
      {stage.deckHeightMm > 60
        ? Array.from({ length: stage.deckRows + 1 }).flatMap((_, row) =>
            Array.from({ length: stage.deckColumns + 1 }).map((__, col) => (
              <mesh
                key={`leg-${row}-${col}`}
                position={[-halfW + col * deck, (height - deckThickness) / 2, -halfD + row * deck]}
                castShadow
                userData={{ part: 'legs' }}
              >
                <boxGeometry args={[mmToWorld(50), height - deckThickness, mmToWorld(50)]} />
                <meshStandardMaterial color="#7d838c" metalness={0.7} roughness={0.35} />
              </mesh>
            ))
          )
        : null}

      {/*
        Diagonal bracing under a tall stage.

        A modular deck over about 600 mm is braced in its leg bays; above a
        metre it stops being a preference. Drawn on the perimeter bays, which is
        both what is usually specified and the only part anyone can see.
      */}
      {stage.deckHeightMm > 600
        ? ([
            ['north', -1],
            ['south', 1],
          ] as const)
            // Only where the skirt is not. A brace drawn over a skirt panel is
            // in front of the thing that exists to hide it.
            .filter(([side]) => !stage.skirtSides.includes(side))
            .flatMap(([side, s]) =>
              Array.from({ length: stage.deckColumns }).map((_, col) => {
                const x0 = -halfW + col * deck;
                const top = height - deckThickness;
                const length = Math.hypot(deck, top);
                return (
                  <mesh
                    key={`brace-${side}-${col}`}
                    position={[x0 + deck / 2, top / 2, s * halfD]}
                    rotation={[0, 0, Math.atan2(top, deck) * (col % 2 === 0 ? 1 : -1)]}
                    castShadow
                    userData={{ part: 'bracing' }}
                  >
                    <boxGeometry args={[length, mmToWorld(30), mmToWorld(30)]} />
                    <meshStandardMaterial color="#6e747c" metalness={0.7} roughness={0.4} />
                  </mesh>
                );
              })
            )
        : null}

      {/* Skirting, with a gap wherever a stair lands. */}
      {stage.deckHeightMm > 100
        ? stage.skirtSides.flatMap((side) => {
            const bays = baysOnSide(stage, side);
            const stairBay = stage.stairSides.includes(side) ? (stage.stairBays[side] ?? 1) - 1 : -1;
            return Array.from({ length: bays }).map((_, i) => {
              if (i === stairBay) return null;
              const centre = bayCentre(stage, side, i);
              const horizontal = side === 'north' || side === 'south';
              return (
                <mesh
                  key={`skirt-${side}-${i}`}
                  position={[mmToWorld(centre.x), (height - deckThickness) / 2, mmToWorld(centre.z)]}
                  castShadow
                  userData={{ part: 'skirt' }}
                >
                  <boxGeometry
                    args={
                      horizontal
                        ? [deck * 0.99, height - deckThickness, mmToWorld(20)]
                        : [mmToWorld(20), height - deckThickness, deck * 0.99]
                    }
                  />
                  <meshStandardMaterial color={skirtColor} roughness={0.95} />
                </mesh>
              );
            });
          })
        : null}

      {/* Guardrail: solid panel low, posts and rails high. */}
      {stage.guardrailSides.flatMap((side) => {
        const bays = baysOnSide(stage, side);
        return Array.from({ length: bays }).map((_, i) => {
          const centre = bayCentre(stage, side, i);
          const horizontal = side === 'north' || side === 'south';
          const railHeight = mmToWorld(1067); // 42"
          const x = mmToWorld(centre.x);
          const z = mmToWorld(centre.z);

          if (!verticalRail) {
            return (
              <mesh
                key={`rail-${side}-${i}`}
                position={[x, height + railHeight / 2, z]}
                castShadow
                userData={{ part: 'guardrail' }}
              >
                <boxGeometry
                  args={
                    horizontal
                      ? [deck * 0.99, railHeight, mmToWorld(30)]
                      : [mmToWorld(30), railHeight, deck * 0.99]
                  }
                />
                <meshStandardMaterial color="#3a3d42" metalness={0.4} roughness={0.6} />
              </mesh>
            );
          }

          // Vertical rail: two posts and two horizontal runs.
          const postOffset = deck / 2 - mmToWorld(40);
          return (
            <group key={`rail-${side}-${i}`}>
              {[-1, 1].map((s) => (
                <mesh
                  key={s}
                  position={[
                    x + (horizontal ? s * postOffset : 0),
                    height + railHeight / 2,
                    z + (horizontal ? 0 : s * postOffset),
                  ]}
                  castShadow
                  userData={{ part: 'guardrail' }}
                >
                  <boxGeometry args={[mmToWorld(40), railHeight, mmToWorld(40)]} />
                  <meshStandardMaterial color="#8e9299" metalness={0.8} roughness={0.3} />
                </mesh>
              ))}
              {[0.55, 1].map((t) => (
                <mesh
                  key={t}
                  position={[x, height + railHeight * t - mmToWorld(20), z]}
                  castShadow
                  userData={{ part: 'guardrail' }}
                >
                  <boxGeometry
                    args={
                      horizontal
                        ? [deck * 0.99, mmToWorld(40), mmToWorld(40)]
                        : [mmToWorld(40), mmToWorld(40), deck * 0.99]
                    }
                  />
                  <meshStandardMaterial color="#8e9299" metalness={0.8} roughness={0.3} />
                </mesh>
              ))}
            </group>
          );
        });
      })}

      {/* Stairs, stepping down from the chosen bay. */}
      {stair
        ? stage.stairSides.map((side) => {
            const bayIndex = (stage.stairBays[side] ?? 1) - 1;
            const centre = bayCentre(stage, side, bayIndex);
            const geo = sideGeometry(stage, side);
            const rise = height / stair.steps;
            const going = mmToWorld(280);
            const outward = side === 'north' ? -1 : side === 'south' ? 1 : 0;
            const outwardZ = side === 'west' ? -1 : side === 'east' ? 1 : 0;

            return (
              <group key={`stair-${side}`} rotation={[0, geo.rotationY, 0]}>
                {Array.from({ length: stair.steps }).map((_, i) => {
                  const stepY = rise * (i + 0.5);
                  const stepOut = going * (i + 0.5);
                  return (
                    <mesh
                      key={i}
                      position={[
                        mmToWorld(centre.x) * (outward === 0 ? 0 : 1) +
                          (outward !== 0 ? 0 : mmToWorld(centre.x)),
                        stepY - rise / 2,
                        (outward !== 0 ? mmToWorld(centre.z) + outward * stepOut : mmToWorld(centre.z) + outwardZ * stepOut),
                      ]}
                      castShadow
                      userData={{ part: 'stairs' }}
                    >
                      <boxGeometry args={[deck * 0.8, rise, going]} />
                      <meshStandardMaterial color="#4a4d52" roughness={0.85} />
                    </mesh>
                  );
                })}
              </group>
            );
          })
        : null}

      {selected ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, 0]} userData={{ helper: true }}>
          <ringGeometry args={[Math.max(halfW, halfD) + 0.1, Math.max(halfW, halfD) + 0.16, 4]} />
          <meshBasicMaterial color="#0072FD" />
        </mesh>
      ) : null}
    </group>
  );
}
