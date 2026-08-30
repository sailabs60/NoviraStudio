import { useMemo } from 'react';
import * as THREE from 'three';
import { mmToWorld, type TentSceneObject, type TentSidewallSlot } from '@novira/shared';

/**
 * Tent geometry.
 *
 * The whole point of a frame tent — the reason it costs what it costs and the
 * reason anyone hires one instead of a pole tent — is that **nothing comes to
 * the ground inside it**. Aztec's own copy for the Jumbotrac puts it in six
 * words: "no poles that come to the ground in the interior space." The legs
 * stand around the perimeter, at each bay line down the two long sides, and
 * that is all of them.
 *
 * This used to draw a leg at every bay division across the gable ends as well,
 * which put three uprights through the middle of each end wall of a 12 m tent.
 * Nobody rigs a tent that way. That is the fault this rewrite exists for, and
 * it is why a quick layout came out looking like scaffolding.
 *
 * What is actually built, per bay line, is a **bent**: two legs, two rafters
 * meeting at a crown fitting, and the eave fittings that tie them together.
 * Bents are then joined along the length by an eave beam on each side, a ridge
 * purlin at the top, and intermediate purlins up each slope. The end bays are
 * cross-braced, because a rectangle of pin-jointed members is a mechanism until
 * something triangulates it.
 *
 * Members are box section rather than round pipe on anything wide enough to
 * need it — extruded 6082-T6 profile is what a clearspan structure is made of,
 * and it is instantly distinguishable from the 48 mm pipe of a small frame
 * tent. The profile scales with span, from 100 × 48 on a 6 m tent to 220 × 110
 * on a 25 m one, which are the sizes the manufacturers publish.
 *
 * Every part is named in `userData.part`, so a finish can be dropped on the
 * canopy without touching the frame, or on the frame without touching the
 * canopy.
 */

interface Props {
  tent: TentSceneObject;
  selected: boolean;
  /** Highlight empty slots so they can be clicked to add a wall. */
  showSlots?: boolean;
  onSlotClick?: (slot: TentSidewallSlot) => void;
}

const SIDEWALL_COLORS: Record<string, string> = {
  solid: '#f4f2ee',
  cathedral: '#dce6ee',
  panoramic: '#cfe0ec',
  'arch-window': '#dce6ee',
  'tinted-window': '#b9c6d1',
  structured: '#eae7e1',
  curtain: '#efe9e0',
};

const FRAME_COLOR = '#b9bfc7';

/**
 * The structural profile, from the span.
 *
 * Manufacturers publish these as the section they extrude for each width band
 * — 170 × 80 mm is the standard profile on a 12–15 m clearspan — and the jump
 * in section between a 6 m tent and a 25 m one is one of the things that makes
 * the two read as different objects rather than as the same drawing scaled up.
 */
function profileFor(widthMm: number): { depthMm: number; widthMm: number; round: boolean } {
  if (widthMm <= 6500) return { depthMm: 100, widthMm: 48, round: true };
  if (widthMm <= 10000) return { depthMm: 130, widthMm: 64, round: false };
  if (widthMm <= 16000) return { depthMm: 170, widthMm: 80, round: false };
  return { depthMm: 220, widthMm: 110, round: false };
}

/**
 * The gabled canopy.
 *
 * Built as non-indexed triangles so every face gets its own normal. Sharing
 * the ridge vertices between the two slopes and calling
 * `computeVertexNormals()` averages the normals along the ridge, which shades
 * the roof as one smooth surface — a 24° gable then reads as a flat sheet,
 * which is exactly what it looked like.
 */
function buildCanopy(tent: TentSceneObject, liftM: number): THREE.BufferGeometry {
  const halfW = mmToWorld(tent.widthMm) / 2;
  const halfL = mmToWorld(tent.lengthMm) / 2;
  /*
   * The fabric lies *on* the purlins, not in the same plane as them.
   *
   * Without the lift the roof surface passes exactly through the rafters, and
   * the frame renders through the canopy — a tent with its steelwork visible
   * on the outside of the roof, which is the one thing a marquee never is. The
   * lift is the depth of the section plus a little, so even the deepest point
   * of the sag between bents stays clear of it.
   */
  const eave = mmToWorld(tent.eaveHeightMm) + liftM;
  const peak = mmToWorld(tent.peakHeightMm) + liftM;
  // Real marquee canopies overhang the frame a little and finish in a valance.
  const overhang = mmToWorld(150);

  const positions: number[] = [];
  const tri = (
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number]
  ) => positions.push(...a, ...b, ...c);
  const quad = (
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    d: [number, number, number]
  ) => {
    tri(a, b, c);
    tri(a, c, d);
  };

  const w = halfW + overhang;
  const l = halfL + overhang;

  /*
   * The slopes are sagged slightly between bents.
   *
   * Fabric tensioned over purlins is never a perfect plane; it dishes a few
   * centimetres in each bay, and that shallow scallop along the eave is the
   * single most recognisable thing about a real marquee in a photograph. Two
   * flat triangles read as folded card.
   */
  const bays = Math.max(1, Math.round(tent.lengthMm / tent.bayLengthMm));
  const sagM = mmToWorld(Math.min(90, tent.bayLengthMm * 0.02));
  const slopeSteps = 6;

  for (let b = 0; b < bays; b += 1) {
    for (let s = 0; s < slopeSteps; s += 1) {
      for (const side of [-1, 1] as const) {
        const z0 = -l + ((b + 0) / bays) * 2 * l;
        const z1 = -l + ((b + 1) / bays) * 2 * l;
        const t0 = s / slopeSteps;
        const t1 = (s + 1) / slopeSteps;

        // Along the bay, sag peaks at the middle and is zero at each bent.
        const dip = (z: number) => {
          const local = ((z - z0) / (z1 - z0)) * Math.PI;
          return Math.sin(local) * sagM;
        };
        const at = (t: number, z: number): [number, number, number] => [
          side * w * (1 - t),
          eave + (peak - eave) * t - dip(z) * (1 - Math.abs(t - 0.5) * 0.6),
          z,
        ];

        quad(at(t0, z0), at(t0, z1), at(t1, z1), at(t1, z0));
      }
    }
  }

  // The gable ends.
  tri([0, peak, -l], [w, eave, -l], [-w, eave, -l]);
  tri([0, peak, l], [-w, eave, l], [w, eave, l]);

  // Valance: the short skirt that hangs from the eave on every side. It is
  // what stops the canopy reading as a bare plane floating on poles.
  const valance = mmToWorld(300);
  const drop = eave - valance;
  quad([-w, eave, -l], [w, eave, -l], [w, drop, -l], [-w, drop, -l]);
  quad([w, eave, l], [-w, eave, l], [-w, drop, l], [w, drop, l]);
  quad([-w, eave, l], [-w, eave, -l], [-w, drop, -l], [-w, drop, l]);
  quad([w, eave, -l], [w, eave, l], [w, drop, l], [w, drop, -l]);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** Where a slot's wall panel sits, and how it is oriented. */
function slotTransform(tent: TentSceneObject, slot: TentSidewallSlot) {
  const halfW = mmToWorld(tent.widthMm) / 2;
  const halfL = mmToWorld(tent.lengthMm) / 2;
  const eave = mmToWorld(tent.eaveHeightMm);

  const baysLong = Math.max(1, Math.round(tent.lengthMm / tent.bayLengthMm));
  const baysShort = Math.max(1, Math.round(tent.widthMm / tent.bayLengthMm));

  if (slot.side === 'west' || slot.side === 'east') {
    const offset = -halfL + (slot.bay + 0.5) * (halfL * 2) / baysLong;
    return {
      position: [slot.side === 'west' ? -halfW : halfW, eave / 2, offset] as [number, number, number],
      rotationY: Math.PI / 2,
      width: (halfL * 2) / baysLong,
      height: eave,
    };
  }

  const offset = -halfW + (slot.bay + 0.5) * (halfW * 2) / baysShort;
  return {
    position: [offset, eave / 2, slot.side === 'north' ? -halfL : halfL] as [number, number, number],
    rotationY: 0,
    width: (halfW * 2) / baysShort,
    height: eave,
  };
}

/* ── Frame members ─────────────────────────────────────────────────────── */

/**
 * One structural member, placed between two points.
 *
 * Box section is drawn with its depth in the plane of the frame — a rafter is
 * deep vertically and narrow across, which is both how it is extruded and how
 * it reads from underneath.
 */
function Member({
  from,
  to,
  profile,
  part,
  color = FRAME_COLOR,
}: {
  from: [number, number, number];
  to: [number, number, number];
  profile: { depthMm: number; widthMm: number; round: boolean };
  part: string;
  color?: string;
}) {
  const { position, quaternion, length } = useMemo(() => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const direction = new THREE.Vector3().subVectors(b, a);
    const len = direction.length();
    return {
      position: new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5),
      quaternion: new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        direction.clone().normalize()
      ),
      length: len,
    };
  }, [from, to]);

  if (length < 0.005) return null;

  const d = mmToWorld(profile.depthMm);
  const w = mmToWorld(profile.widthMm);

  return (
    <mesh position={position} quaternion={quaternion} castShadow receiveShadow userData={{ part }}>
      {profile.round ? (
        <cylinderGeometry args={[w / 2, w / 2, length, 10]} />
      ) : (
        <boxGeometry args={[w, length, d]} />
      )}
      <meshStandardMaterial color={color} metalness={0.62} roughness={0.42} />
    </mesh>
  );
}

/* ── The object ────────────────────────────────────────────────────────── */

export function Tent3D({ tent, selected, showSlots, onSlotClick }: Props) {
  const halfW = mmToWorld(tent.widthMm) / 2;
  const halfL = mmToWorld(tent.lengthMm) / 2;
  const eave = mmToWorld(tent.eaveHeightMm);
  const peak = mmToWorld(tent.peakHeightMm);

  const profile = useMemo(() => profileFor(tent.widthMm), [tent.widthMm]);
  const canopy = useMemo(
    () => buildCanopy(tent, mmToWorld(profile.depthMm * 0.6 + 40)),
    [tent, profile.depthMm]
  );
  // Purlins and legs are lighter than the rafters that carry the roof.
  const purlin = useMemo(
    () => ({ depthMm: Math.round(profile.depthMm * 0.6), widthMm: Math.round(profile.widthMm * 0.7), round: profile.round }),
    [profile]
  );

  /**
   * Where the bents stand.
   *
   * One at each end and one at every bay line between: this is the whole
   * structure. A 12 × 18 m tent is seven bents, fourteen legs, and nothing at
   * all inside — which is the point of a frame tent.
   */
  const bentZ = useMemo(() => {
    const bays = Math.max(1, Math.round(tent.lengthMm / tent.bayLengthMm));
    return Array.from({ length: bays + 1 }, (_, i) => -halfL + (i * halfL * 2) / bays);
  }, [tent.lengthMm, tent.bayLengthMm, halfL]);

  /** Purlin heights up the slope, as a fraction of the rise. */
  const purlinStops = useMemo(() => {
    // A short span needs one purlin per slope; a wide one needs two or three.
    const count = tent.widthMm <= 8000 ? 1 : tent.widthMm <= 16000 ? 2 : 3;
    return Array.from({ length: count }, (_, i) => (i + 1) / (count + 1));
  }, [tent.widthMm]);

  const slopePoint = (side: -1 | 1, t: number, z: number): [number, number, number] => [
    side * halfW * (1 - t),
    eave + (peak - eave) * t,
    z,
  ];

  return (
    <group>
      {/* Canopy — hideable so the interior can be worked on. */}
      {!tent.canopyHidden ? (
        <mesh geometry={canopy} castShadow receiveShadow userData={{ part: 'canopy' }}>
          <meshStandardMaterial
            color={selected ? '#c8caf5' : (tent.canopyColor ?? '#f7f6f3')}
            side={THREE.DoubleSide}
            roughness={0.88}
            metalness={0}
            emissive={selected ? '#0059C4' : '#000000'}
            emissiveIntensity={selected ? 0.12 : 0}
          />
        </mesh>
      ) : null}

      {/*
        The bents. Two legs and two rafters each, and nothing between them —
        see the note at the top about why there is nothing in the middle.
      */}
      {bentZ.map((z, i) => (
        <group key={`bent-${i}`}>
          {([-1, 1] as const).map((side) => (
            <group key={side}>
              <Member
                from={[side * halfW, 0, z]}
                to={[side * halfW, eave, z]}
                profile={profile}
                part="legs"
              />
              <Member
                from={slopePoint(side, 0, z)}
                to={slopePoint(side, 1, z)}
                profile={profile}
                part="rafters"
              />
              {/* Base plate, so the leg lands on something. */}
              <mesh position={[side * halfW, mmToWorld(8), z]} receiveShadow userData={{ part: 'base-plates' }}>
                <boxGeometry args={[mmToWorld(260), mmToWorld(16), mmToWorld(260)]} />
                <meshStandardMaterial color="#4a4f56" metalness={0.5} roughness={0.6} />
              </mesh>
            </group>
          ))}

          {/*
            The knee brace at each eave.

            A leg and a rafter pinned together is a hinge; the short diagonal
            across that corner is what stops the whole frame folding sideways,
            and it is on every frame tent ever put up.
          */}
          {([-1, 1] as const).map((side) => {
            const along = Math.min(halfW * 0.34, mmToWorld(1200));
            const down = Math.min(eave * 0.42, mmToWorld(900));
            const t = along / halfW;
            return (
              <Member
                key={`knee-${side}`}
                from={[side * halfW, eave - down, z]}
                to={slopePoint(side, t, z)}
                profile={purlin}
                part="knee-braces"
              />
            );
          })}
        </group>
      ))}

      {/* Eave beams and the ridge, tying the bents together down the length. */}
      {([-1, 1] as const).map((side) => (
        <Member
          key={`eave-${side}`}
          from={[side * halfW, eave, -halfL]}
          to={[side * halfW, eave, halfL]}
          profile={profile}
          part="eave-beams"
        />
      ))}
      <Member from={[0, peak, -halfL]} to={[0, peak, halfL]} profile={profile} part="ridge" />

      {/* Purlins up each slope, which is what the fabric actually lies on. */}
      {purlinStops.map((t) =>
        ([-1, 1] as const).map((side) => (
          <Member
            key={`purlin-${side}-${t}`}
            from={slopePoint(side, t, -halfL)}
            to={slopePoint(side, t, halfL)}
            profile={purlin}
            part="purlins"
          />
        ))
      )}

      {/*
        Cross-bracing in the end bays.

        Drawn as thin tension members rather than section, because that is what
        they are: a rectangle of pin-jointed beams is a mechanism until a
        diagonal triangulates it, and on a real structure that diagonal is a
        cable or a light strut in the first and last bay only.
      */}
      {bentZ.length > 1
        ? [
            [bentZ[0]!, bentZ[1]!],
            [bentZ[bentZ.length - 2]!, bentZ[bentZ.length - 1]!],
          ].map(([z0, z1], i) =>
            ([-1, 1] as const).map((side) => (
              <group key={`brace-${i}-${side}`}>
                <Member
                  from={[side * halfW, 0, z0]}
                  to={[side * halfW, eave, z1]}
                  profile={{ depthMm: 16, widthMm: 16, round: true }}
                  part="bracing"
                  color="#8b929c"
                />
                <Member
                  from={[side * halfW, eave, z0]}
                  to={[side * halfW, 0, z1]}
                  profile={{ depthMm: 16, widthMm: 16, round: true }}
                  part="bracing"
                  color="#8b929c"
                />
              </group>
            ))
          )
        : null}

      {/* Sidewalls, one per filled slot. */}
      {tent.slots.map((slot) => {
        const t = slotTransform(tent, slot);
        const filled = slot.catalogItemId !== null;
        if (!filled && !showSlots) return null;

        return (
          <mesh
            key={`${slot.side}-${slot.bay}`}
            position={t.position}
            rotation={[0, t.rotationY, 0]}
            castShadow
            userData={{ part: filled ? 'sidewalls' : undefined, helper: !filled }}
            onClick={
              onSlotClick
                ? (event) => {
                    event.stopPropagation();
                    onSlotClick(slot);
                  }
                : undefined
            }
          >
            <boxGeometry args={[t.width * 0.98, t.height, mmToWorld(30)]} />
            {filled ? (
              <meshStandardMaterial
                color={SIDEWALL_COLORS[slot.sidewallType ?? 'solid'] ?? '#f4f2ee'}
                roughness={0.9}
                transparent={/window|panoramic|cathedral/.test(slot.sidewallType ?? '')}
                opacity={/panoramic/.test(slot.sidewallType ?? '') ? 0.45 : /window|cathedral/.test(slot.sidewallType ?? '') ? 0.7 : 1}
                side={THREE.DoubleSide}
              />
            ) : (
              // Empty slot: a faint highlight the user can click.
              <meshBasicMaterial color="#0072FD" transparent opacity={0.18} side={THREE.DoubleSide} />
            )}
          </mesh>
        );
      })}
    </group>
  );
}

/** Build the slot list for a tent of a given size. */
export function buildSlots(widthMm: number, lengthMm: number, bayLengthMm: number): TentSidewallSlot[] {
  const baysLong = Math.max(1, Math.round(lengthMm / bayLengthMm));
  const baysShort = Math.max(1, Math.round(widthMm / bayLengthMm));
  const slots: TentSidewallSlot[] = [];
  let index = 0;

  for (const side of ['west', 'east'] as const) {
    for (let bay = 0; bay < baysLong; bay += 1) {
      slots.push({ index: index++, side, bay, catalogItemId: null });
    }
  }
  for (const side of ['north', 'south'] as const) {
    for (let bay = 0; bay < baysShort; bay += 1) {
      slots.push({ index: index++, side, bay, catalogItemId: null });
    }
  }
  return slots;
}

/**
 * The sizes the trade actually stocks.
 *
 * Two families, because they are genuinely different structures and a planner
 * chooses between them on span. **Frame tents** are the imperial-sized pipe
 * frames hired by the thousand in North America; they top out around 12 m wide.
 * **Clearspan structures** are the metric extruded-aluminium bays used
 * everywhere else, and they are what a 20 m span has to be.
 */
export const TENT_PRESETS = [
  { key: 'frame-20x20', label: 'Frame Tent 20 × 20', family: 'frame', widthMm: 6096, lengthMm: 6096, bayLengthMm: 3048 },
  { key: 'frame-20x30', label: 'Frame Tent 20 × 30', family: 'frame', widthMm: 6096, lengthMm: 9144, bayLengthMm: 3048 },
  { key: 'frame-20x40', label: 'Frame Tent 20 × 40', family: 'frame', widthMm: 6096, lengthMm: 12192, bayLengthMm: 3048 },
  { key: 'frame-30x30', label: 'Frame Tent 30 × 30', family: 'frame', widthMm: 9144, lengthMm: 9144, bayLengthMm: 3048 },
  { key: 'frame-30x40', label: 'Frame Tent 30 × 40', family: 'frame', widthMm: 9144, lengthMm: 12192, bayLengthMm: 3048 },
  { key: 'frame-40x40', label: 'Frame Tent 40 × 40', family: 'frame', widthMm: 12192, lengthMm: 12192, bayLengthMm: 3048 },
  { key: 'frame-40x60', label: 'Frame Tent 40 × 60', family: 'frame', widthMm: 12192, lengthMm: 18288, bayLengthMm: 3048 },
  { key: 'clearspan-10x20', label: 'Clearspan 10 × 20 m', family: 'clearspan', widthMm: 10000, lengthMm: 20000, bayLengthMm: 5000 },
  { key: 'clearspan-15x30', label: 'Clearspan 15 × 30 m', family: 'clearspan', widthMm: 15000, lengthMm: 30000, bayLengthMm: 5000 },
  { key: 'clearspan-20x40', label: 'Clearspan 20 × 40 m', family: 'clearspan', widthMm: 20000, lengthMm: 40000, bayLengthMm: 5000 },
  { key: 'clearspan-25x50', label: 'Clearspan 25 × 50 m', family: 'clearspan', widthMm: 25000, lengthMm: 50000, bayLengthMm: 5000 },
] as const;

export const SIDEWALL_TYPES = [
  { key: 'solid', label: 'Solid' },
  { key: 'cathedral', label: 'Cathedral window' },
  { key: 'panoramic', label: 'Panoramic' },
  { key: 'arch-window', label: 'Arch window' },
  { key: 'tinted-window', label: 'Tinted window' },
  { key: 'structured', label: 'Structured' },
  { key: 'curtain', label: 'Curtain' },
] as const;

export function createTent(
  preset: (typeof TENT_PRESETS)[number],
  originMm = { x: 0, y: 0, z: 0 }
): TentSceneObject {
  const bayLengthMm = preset.bayLengthMm;
  /*
   * Eave height follows the family. A hire frame tent stands at 8 ft to the
   * eave; a clearspan is specified at 3 m or 4 m and the taller one is what
   * anyone rigging lighting inside asks for.
   */
  const eaveHeightMm = preset.family === 'clearspan' ? (preset.widthMm >= 20000 ? 4000 : 3000) : 2440;
  return {
    id: crypto.randomUUID(),
    type: 'tent',
    name: preset.label,
    catalogItemId: 0,
    family: preset.family,
    positionMm: originMm,
    rotationDeg: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    widthMm: preset.widthMm,
    lengthMm: preset.lengthMm,
    eaveHeightMm,
    // Roof pitch scales with span so a wide tent does not read as flat.
    peakHeightMm: eaveHeightMm + Math.round(preset.widthMm * 0.22),
    bayLengthMm,
    slots: buildSlots(preset.widthMm, preset.lengthMm, bayLengthMm),
    canopyHidden: false,
    canopyColor: '#f7f6f3',
  };
}
