import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import {
  deriveTruss,
  mmToWorld,
  trussSystem,
  type TrussSceneObject,
  type TrussSystemSpec,
  type WallPoint,
} from '@novira/shared';

/**
 * Truss geometry.
 *
 * The thing that makes drawn truss look wrong is almost never the chords. It is
 * everything at the ends and the joints — which is where a rigger's eye goes
 * first, because that is where the money and the risk are. A run whose chords
 * simply stop in mid-air, with the last diagonal trailing off, reads as a
 * sketch of truss rather than as truss.
 *
 * So this builds what is actually bolted together:
 *
 *  · **Chords** at the real section, in the real tube diameter, four (or three,
 *    or two) of them at the corners of the published cross-section.
 *
 *  · **A continuous Warren web.** The diagonals zig-zag between two chords and
 *    *meet* at the panel points rather than each panel carrying its own
 *    disconnected stroke. Systems whose data sheet says so — the V in Prolyte's
 *    H30V and H40V is literally this — also get an upright at every panel point.
 *    Panel pitch is per-system, and it is the single most recognisable thing
 *    about a length of truss at a glance.
 *
 *  · **Ends that are closed.** Every open end gets its end frame: uprights
 *    across each face, and the flange plate welded on each chord that a
 *    conical coupler bolts into. This is the fix for "the edges look stupid".
 *
 *  · **Visible section joints.** Truss arrives in stock lengths and is coupled
 *    together, so a real 12 m run has a band of flanges every 3 m. Drawing one
 *    unbroken extrusion is the other half of why it looked unreal.
 *
 *  · **Corner blocks.** A 90° corner is not two runs mitred into each other; it
 *    is a separate welded cube of truss that both runs bolt into. The chords
 *    are trimmed back to make room for it, and the block is drawn.
 *
 * Everything is instanced — five draw calls for the whole run regardless of its
 * length, where the previous version issued one per tube and could reach 1,300
 * meshes on a 40 m grid. Instancing also gives the material system exactly the
 * granularity it wants: each instanced mesh is one named part, so a finish can
 * land on the chords without touching the bracing.
 */

interface Props {
  truss: TrussSceneObject;
  selected: boolean;
}

/* ── Cross-section ─────────────────────────────────────────────────────── */

interface ChordOffset {
  u: number;
  v: number;
}

/**
 * Where the chords sit in the run's cross-section, centre to centre.
 *
 * `u` runs horizontally across the run and `v` is up, both in millimetres from
 * the section's centre.
 */
function chordOffsets(system: TrussSystemSpec): ChordOffset[] {
  const halfW = system.widthMm / 2;
  const halfH = system.heightMm / 2;

  if (system.chords === 2) {
    return [
      { u: -halfW, v: 0 },
      { u: halfW, v: 0 },
    ];
  }
  if (system.chords === 3) {
    // Apex up. Almost every triangular truss is rigged this way, and the ones
    // that are not are hung upside down deliberately.
    return [
      { u: -halfW, v: -halfH },
      { u: halfW, v: -halfH },
      { u: 0, v: halfH },
    ];
  }
  return [
    { u: -halfW, v: -halfH },
    { u: halfW, v: -halfH },
    { u: halfW, v: halfH },
    { u: -halfW, v: halfH },
  ];
}

/**
 * Which pairs of chords have a braced face between them.
 *
 * A box truss is braced on all four faces, a triangle on all three, and a
 * ladder has rungs between its single pair. Returning the pairs rather than
 * assuming "consecutive, wrapping" keeps the ladder case honest: it has one
 * face, not two coincident ones.
 */
function facePairs(count: number): Array<[number, number]> {
  if (count <= 2) return [[0, 1]];
  return Array.from({ length: count }, (_, i) => [i, (i + 1) % count] as [number, number]);
}

/* ── The run, walked ───────────────────────────────────────────────────── */

interface Placed {
  /** Midpoint of the tube, in world units. */
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  length: number;
}

interface Flange {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

const UP = new THREE.Vector3(0, 1, 0);

function place(from: THREE.Vector3, to: THREE.Vector3): Placed | null {
  const direction = new THREE.Vector3().subVectors(to, from);
  const length = direction.length();
  if (length < 1e-4) return null;
  return {
    position: new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5),
    quaternion: new THREE.Quaternion().setFromUnitVectors(UP, direction.normalize()),
    length,
  };
}

interface Built {
  chords: Placed[];
  diagonals: Placed[];
  uprights: Placed[];
  flanges: Flange[];
  cornerEdges: Placed[];
}

/**
 * One straight leg of the run, from `a` to `b`, already trimmed for corners.
 *
 * The panel count is rounded to whole panels and the pitch stretched to fit,
 * because a run never ends on a half panel — the fabricator cuts a shorter
 * section instead, and the bracing is redistributed across it.
 */
function buildLeg(
  a: THREE.Vector3,
  b: THREE.Vector3,
  system: TrussSystemSpec,
  offsets: ChordOffset[],
  out: Built,
  options: { startOpen: boolean; endOpen: boolean }
) {
  const axis = new THREE.Vector3().subVectors(b, a);
  const length = axis.length();
  if (length < 1e-3) return;
  axis.normalize();

  // The cross-section basis. `across` is horizontal and perpendicular to the
  // run; `up` is world up, which is right for every truss that is not rolled.
  const across = new THREE.Vector3(-axis.z, 0, axis.x);
  if (across.lengthSq() < 1e-6) across.set(1, 0, 0);
  across.normalize();

  const node = (t: number, offset: ChordOffset) =>
    new THREE.Vector3()
      .copy(a)
      .addScaledVector(axis, t * length)
      .addScaledVector(across, mmToWorld(offset.u))
      .addScaledVector(UP, mmToWorld(offset.v));

  /* ── Chords, in stock lengths ─────────────────────────────────────── */

  /*
   * Truss is coupled together from stock sections, so a 12 m run is four 3 m
   * lengths with a visible flange band at each joint. Splitting the chord at
   * those joints is what puts the bands there; drawing one unbroken tube is
   * the thing that made a long run read as an extrusion.
   */
  const stock = mmToWorld(system.stockLengthsMm[0] ?? 3000);
  const joints = Math.max(1, Math.round(length / stock));
  for (const offset of offsets) {
    for (let j = 0; j < joints; j += 1) {
      const from = node(j / joints, offset);
      const to = node((j + 1) / joints, offset);
      // A hair short, so the flange plate at the joint is not buried in tube.
      const shrink = mmToWorld(6);
      const dir = new THREE.Vector3().subVectors(to, from).normalize();
      const placed = place(
        from.clone().addScaledVector(dir, shrink),
        to.clone().addScaledVector(dir, -shrink)
      );
      if (placed) out.chords.push(placed);
    }
  }

  // Flange plates: at every internal joint, and at whichever ends are open.
  for (let j = 0; j <= joints; j += 1) {
    const internal = j > 0 && j < joints;
    if (!internal && ((j === 0 && !options.startOpen) || (j === joints && !options.endOpen))) continue;
    for (const offset of offsets) {
      out.flanges.push({
        position: node(j / joints, offset),
        quaternion: new THREE.Quaternion().setFromUnitVectors(UP, axis),
      });
    }
  }

  /* ── The web ──────────────────────────────────────────────────────── */

  const panels = Math.max(1, Math.round(length / mmToWorld(system.panelLengthMm)));
  const pairs = facePairs(offsets.length);

  for (const [i, k] of pairs) {
    const first = offsets[i]!;
    const second = offsets[k]!;

    if (system.bracePattern !== 'ladder') {
      /*
       * A continuous zig-zag. Panel p runs from one chord to the other, and
       * panel p+1 comes back — so consecutive diagonals share a node on the
       * chord instead of each panel carrying its own disconnected stroke.
       */
      for (let p = 0; p < panels; p += 1) {
        const forward = p % 2 === 0;
        const placed = place(
          node(p / panels, forward ? first : second),
          node((p + 1) / panels, forward ? second : first)
        );
        if (placed) out.diagonals.push(placed);
      }
    }

    /*
     * Uprights. Every panel point on a `warren-vertical` section and on a
     * ladder; on a plain Warren only at the two ends, where the section has to
     * be closed off whether or not the web calls for it.
     */
    const everyPanel = system.bracePattern !== 'warren';
    for (let p = 0; p <= panels; p += 1) {
      const atEnd = p === 0 || p === panels;
      if (!everyPanel && !atEnd) continue;
      if (atEnd && ((p === 0 && !options.startOpen) || (p === panels && !options.endOpen)) && !everyPanel) {
        continue;
      }
      const placed = place(node(p / panels, first), node(p / panels, second));
      if (placed) out.uprights.push(placed);
    }
  }
}

/**
 * The welded cube where two runs meet.
 *
 * A real corner is a catalogue part — a Prolyte H30V-C003 or a Global Truss
 * junction block — not two lengths mitred into one another. It is a short cube
 * of truss with chord stubs on the faces the runs bolt to, so drawing its
 * twelve edges in chord tube is both honest and instantly recognisable.
 */
function buildCorner(at: THREE.Vector3, system: TrussSystemSpec, out: Built) {
  const half = mmToWorld(Math.max(system.widthMm, system.heightMm)) / 2;
  const corners: THREE.Vector3[] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        corners.push(new THREE.Vector3(at.x + sx * half, at.y + sy * half, at.z + sz * half));
      }
    }
  }

  // The twelve edges of the cube: every pair of corners differing on one axis.
  for (let i = 0; i < corners.length; i += 1) {
    for (let j = i + 1; j < corners.length; j += 1) {
      const a = corners[i]!;
      const b = corners[j]!;
      const differing =
        Number(Math.abs(a.x - b.x) > 1e-6) + Number(Math.abs(a.y - b.y) > 1e-6) + Number(Math.abs(a.z - b.z) > 1e-6);
      if (differing !== 1) continue;
      const placed = place(a, b);
      if (placed) out.cornerEdges.push(placed);
    }
  }
}

function buildRun(
  points: WallPoint[],
  closed: boolean,
  trimM: number,
  system: TrussSystemSpec,
  offsets: ChordOffset[]
): Built {
  const out: Built = { chords: [], diagonals: [], uprights: [], flanges: [], cornerEdges: [] };
  if (points.length < 2) return out;

  const path = points.map((p) => new THREE.Vector3(mmToWorld(p.xMm), trimM, mmToWorld(p.zMm)));
  const legs: Array<[number, number]> = [];
  for (let i = 0; i < path.length - 1; i += 1) legs.push([i, i + 1]);
  if (closed && path.length > 2) legs.push([path.length - 1, 0]);

  // Vertices where the run changes direction and a corner block is needed.
  const isCorner = path.map((_, i) => (closed ? true : i > 0 && i < path.length - 1));
  const trim = mmToWorld(Math.max(system.widthMm, system.heightMm)) / 2;

  for (const [ai, bi] of legs) {
    const a = path[ai]!;
    const b = path[bi]!;
    const direction = new THREE.Vector3().subVectors(b, a);
    const span = direction.length();
    if (span < 1e-3) continue;
    direction.normalize();

    // Trimmed back at whichever end lands in a corner block.
    const startTrim = isCorner[ai] ? Math.min(trim, span * 0.45) : 0;
    const endTrim = isCorner[bi] ? Math.min(trim, span * 0.45) : 0;

    buildLeg(
      a.clone().addScaledVector(direction, startTrim),
      b.clone().addScaledVector(direction, -endTrim),
      system,
      offsets,
      out,
      { startOpen: !isCorner[ai], endOpen: !isCorner[bi] }
    );
  }

  path.forEach((point, i) => {
    if (isCorner[i]) buildCorner(point, system, out);
  });

  return out;
}

/* ── Instanced drawing ─────────────────────────────────────────────────── */

/**
 * A named part of the truss, drawn as one instanced mesh.
 *
 * The `part` in `userData` is what the material system keys on, so dropping a
 * black finish on a chord blacks out the chords and leaves the bracing alone —
 * which is exactly how a truss is finished in reality, and impossible when the
 * whole run is one mesh.
 */
function Tubes({
  items,
  radius,
  part,
  color,
  metalness = 0.82,
  roughness = 0.34,
  selected,
}: {
  items: Placed[];
  radius: number;
  part: string;
  color: string;
  metalness?: number;
  roughness?: number;
  selected: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    const scale = new THREE.Vector3();
    items.forEach((item, i) => {
      // The base cylinder is one unit tall, so the Y scale is the length.
      scale.set(1, item.length, 1);
      matrix.compose(item.position, item.quaternion, scale);
      mesh.setMatrixAt(i, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items]);

  if (!items.length) return null;

  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, items.length]}
      castShadow
      receiveShadow
      userData={{ part }}
    >
      <cylinderGeometry args={[radius, radius, 1, 10]} />
      <meshStandardMaterial
        color={color}
        metalness={metalness}
        roughness={roughness}
        emissive={selected ? '#0059C4' : '#000000'}
        emissiveIntensity={selected ? 0.2 : 0}
      />
    </instancedMesh>
  );
}

/** The flange plates that a conical coupler bolts through. */
function Flanges({
  items,
  radius,
  color,
  selected,
}: {
  items: Flange[];
  radius: number;
  color: string;
  selected: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    const one = new THREE.Vector3(1, 1, 1);
    items.forEach((item, i) => {
      matrix.compose(item.position, item.quaternion, one);
      mesh.setMatrixAt(i, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items]);

  if (!items.length) return null;

  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, items.length]}
      castShadow
      userData={{ part: 'connectors' }}
    >
      {/* A short, slightly proud collar: what a coupled joint reads as. */}
      <cylinderGeometry args={[radius, radius, mmToWorld(14), 12]} />
      <meshStandardMaterial
        color={color}
        metalness={0.7}
        roughness={0.5}
        emissive={selected ? '#0059C4' : '#000000'}
        emissiveIntensity={selected ? 0.2 : 0}
      />
    </instancedMesh>
  );
}

/* ── The object ────────────────────────────────────────────────────────── */

export function Truss3D({ truss, selected }: Props) {
  const system = trussSystem(truss.systemKey);
  const derived = useMemo(
    () =>
      deriveTruss({
        systemKey: truss.systemKey,
        points: truss.points ?? [],
        closed: truss.closed,
        trimHeightMm: truss.trimHeightMm,
        legType: truss.legType,
        hangingLoadKg: truss.hangingLoadKg,
      }),
    [truss.systemKey, truss.points, truss.closed, truss.trimHeightMm, truss.legType, truss.hangingLoadKg]
  );

  const color = selected ? '#9aa0e8' : truss.color || system.color;
  const chordRadius = mmToWorld(system.chordDiameterMm) / 2;
  const braceRadius = mmToWorld(system.braceDiameterMm) / 2;
  const trimM = mmToWorld(truss.trimHeightMm);

  const offsets = useMemo(() => chordOffsets(system), [system]);

  const built = useMemo(
    () => buildRun(truss.points ?? [], truss.closed, trimM, system, offsets),
    [truss.points, truss.closed, trimM, system, offsets]
  );

  /*
   * Hiding the bracing is a drawing preference, not a fiction: a plan printed
   * at 1:100 is more readable without it, and it is the control people reach
   * for on a mother grid. The chords and the ends stay either way, because a
   * truss with no ends is what this rewrite exists to stop.
   */
  const showWeb = truss.showBracing !== false;

  const legPoints = useMemo(() => {
    const points = truss.points ?? [];
    if (truss.legType === 'none' || truss.legType === 'flown' || points.length < 2) return [];
    return truss.closed ? points : [points[0]!, points[points.length - 1]!];
  }, [truss.points, truss.closed, truss.legType]);

  /** Uprights under the run, built from the same section turned vertical. */
  const legTubes = useMemo(() => {
    const out: Placed[] = [];
    const legTop = trimM - mmToWorld(system.heightMm) / 2;
    for (const point of legPoints) {
      const x = mmToWorld(point.xMm);
      const z = mmToWorld(point.zMm);
      for (const offset of offsets) {
        const placed = place(
          new THREE.Vector3(x + mmToWorld(offset.u), 0, z + mmToWorld(offset.v)),
          new THREE.Vector3(x + mmToWorld(offset.u), legTop, z + mmToWorld(offset.v))
        );
        if (placed) out.push(placed);
      }
      /*
       * Bracing on the tower, at the same panel pitch as the run. A bare set of
       * parallel tubes under a braced horizontal is the other place truss stops
       * looking like truss.
       */
      const panels = Math.max(1, Math.round(legTop / mmToWorld(system.panelLengthMm)));
      for (const [i, k] of facePairs(offsets.length)) {
        const first = offsets[i]!;
        const second = offsets[k]!;
        for (let p = 0; p < panels; p += 1) {
          const forward = p % 2 === 0;
          const lo = (p / panels) * legTop;
          const hi = ((p + 1) / panels) * legTop;
          const from = forward ? first : second;
          const to = forward ? second : first;
          const placed = place(
            new THREE.Vector3(x + mmToWorld(from.u), lo, z + mmToWorld(from.v)),
            new THREE.Vector3(x + mmToWorld(to.u), hi, z + mmToWorld(to.v))
          );
          if (placed) out.push(placed);
        }
      }
    }
    return out;
  }, [legPoints, offsets, system, trimM]);

  return (
    <group>
      <Tubes items={built.chords} radius={chordRadius} part="chords" color={color} selected={selected} />
      <Tubes
        items={built.cornerEdges}
        radius={chordRadius}
        part="corner-blocks"
        color={color}
        selected={selected}
      />
      {showWeb ? (
        <>
          <Tubes items={built.diagonals} radius={braceRadius} part="bracing" color={color} selected={selected} />
          <Tubes items={built.uprights} radius={braceRadius} part="bracing" color={color} selected={selected} />
        </>
      ) : null}
      <Flanges items={built.flanges} radius={chordRadius * 1.45} color={color} selected={selected} />

      {legTubes.length ? (
        <Tubes items={legTubes} radius={chordRadius} part="legs" color={color} selected={selected} />
      ) : null}

      {/* Base plates, so a tower does not float. */}
      {legPoints.map((point, i) => (
        <mesh
          key={`base-${i}`}
          position={[mmToWorld(point.xMm), mmToWorld(15), mmToWorld(point.zMm)]}
          receiveShadow
          castShadow
          userData={{ part: 'base-plates' }}
        >
          <boxGeometry
            args={[
              mmToWorld(truss.legType === 'tower' ? 1200 : 700),
              mmToWorld(30),
              mmToWorld(truss.legType === 'tower' ? 1200 : 700),
            ]}
          />
          <meshStandardMaterial color="#3f434a" metalness={0.6} roughness={0.55} />
        </mesh>
      ))}

      {/*
        A flown run gets its steels drawn upward. Without them a truss at 7 m
        looks as though it is hovering, and "how is that held up?" is the first
        question anyone technical asks of a drawing.
      */}
      {truss.legType === 'flown'
        ? (truss.points ?? []).slice(0, 8).map((point, i) => (
            <mesh
              key={`steel-${i}`}
              position={[mmToWorld(point.xMm), trimM + 1.2, mmToWorld(point.zMm)]}
              userData={{ part: 'rigging' }}
            >
              <cylinderGeometry args={[0.012, 0.012, 2.4, 6]} />
              <meshStandardMaterial color="#6b7280" metalness={0.9} roughness={0.4} />
            </mesh>
          ))
        : null}

      {/* An over-span run is drawn in warning colour: the plan tells you before the panel does. */}
      {derived.warnings.some((w) => w.severity === 'error') ? (
        <mesh position={[0, trimM + 0.6, 0]} userData={{ helper: true }}>
          <sphereGeometry args={[0.12, 12, 12]} />
          <meshBasicMaterial color="#ef4444" />
        </mesh>
      ) : null}
    </group>
  );
}
