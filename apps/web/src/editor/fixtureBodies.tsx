import { useMemo } from 'react';
import * as THREE from 'three';
import { mmToWorld, type LightFixtureSpec } from '@novira/shared';

/**
 * The fixture bodies.
 *
 * A lighting plot is read by silhouette. A rigger looking at a bar counts
 * profiles, moving heads and blinders from across the room without reading a
 * single label, because those three things do not look remotely alike — and
 * for the same reason, a plot that draws all fourteen fixture types as the
 * same grey cylinder is not a plot, it is a scatter of markers.
 *
 * So each family is modelled as the thing it actually is, at the size the
 * manufacturer publishes:
 *
 *  - A **profile** is a long ellipsoidal barrel: lens tube at the front, the
 *    shutter barrel with its four blade handles in the middle, a lamp housing
 *    that flares out at the back, and the gobo slot on top. The Source Four
 *    silhouette is the most recognisable object in the industry.
 *  - A **fresnel** is short and boxy with four barn door leaves splayed off
 *    the front. The barn doors are the whole tell.
 *  - A **PAR** is a plain parallel can, wider than it is deep, on a stirrup.
 *  - A **moving head** is three parts that must read separately: a base that
 *    holds the electronics, a U-shaped yoke straddling it, and a head slung
 *    between the yoke arms that tilts. Drawing it as one lump loses the thing
 *    that makes it a moving light.
 *  - A **blinder** is a grid of open lamp cells — four or eight parabolic
 *    reflectors staring out of a frame.
 *  - A **batten** is a long bar of small cells.
 *  - An **uplighter** is a squat floor puck with no yoke, because it stands on
 *    the ground and points up.
 *  - A **followspot** is a long barrel on a tripod, with the operator handles
 *    that are the reason it is shaped that way.
 *
 * Everything is built from the real millimetre dimensions in the fixture
 * spec, so a unit that is 431 mm across the yoke is 431 mm across the yoke in
 * the model. That matters beyond looks: it answers whether a fixture clears
 * the truss chord, and whether forty of them fit on the bar.
 *
 * All geometry is authored pointing **down the -Y axis**, because that is how
 * a rigged fixture hangs and it lets the caller aim the whole body with one
 * quaternion. Floor fixtures are flipped by the same mechanism.
 */

/* ── Shared materials ──────────────────────────────────────────────────── */

/**
 * Fixture bodies are almost universally black, semi-matte powder-coated
 * aluminium. The exceptions are the raw aluminium of a blinder frame and the
 * chrome of a yoke bolt, which are called out where they occur.
 */
export const CASE_COLOR = '#1b1d21';
export const CASE_COLOR_MUTED = '#4b5563';
const YOKE_COLOR = '#26292e';
const METAL_COLOR = '#8d939b';

export interface BodyProps {
  spec: LightFixtureSpec;
  /** Case colour, already resolved for selection and mute state. */
  caseColor: string;
  /** The colour the lamp is currently outputting. */
  lampColor: string;
  /** 0 when muted or dark, up to ~2 at full. Drives the lens glow. */
  lampIntensity: number;
}

function CaseMaterial({ color }: { color: string }) {
  // Powder coat: dark, slightly rough, barely metallic. A shiny black body
  // reads as plastic and is the quickest way to make a rig look like a toy.
  return <meshStandardMaterial color={color} roughness={0.62} metalness={0.35} />;
}

function MetalMaterial({ color = METAL_COLOR }: { color?: string }) {
  return <meshStandardMaterial color={color} roughness={0.38} metalness={0.85} />;
}

/**
 * The lit lens.
 *
 * `toneMapped={false}` keeps it at full value through the tone mapper, which
 * is what makes a live fixture read as *on* rather than as a pale disc, and
 * matters most in the dark looks where the rest of the frame is crushed.
 */
function Lens({
  radius,
  color,
  intensity,
  y,
}: {
  radius: number;
  color: string;
  intensity: number;
  y: number;
}) {
  return (
    <mesh position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
      <circleGeometry args={[radius, 24]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={intensity}
        toneMapped={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/**
 * The yoke: the U-shaped bracket a hung fixture pivots in.
 *
 * A real yoke straddles the fixture. The two arms run *up* each side from the
 * tilt bolts — which sit at the fixture's balance point, roughly a third of
 * the way back from the lens — to a cross piece above it that carries the
 * hanging clamp. Getting this the wrong way round leaves the arms dangling
 * below the body like legs, which is the giveaway of a fixture modelled from
 * memory rather than from the object.
 *
 * So it is described by where it pivots, not by an arm length: `pivotY` is
 * the tilt-bolt height and `topY` the cross piece, and the arms are simply
 * drawn between them.
 *
 * Remember the convention: bodies are authored aiming down -Y with the lens
 * at `-depth` and the *back* of the fixture at 0. So `topY` has to be a small
 * positive number to clear the body — a `topY` derived from a fraction of the
 * body length lands inside the housing and hides the cross piece, leaving the
 * arms looking like they hang below.
 */
function Yoke({
  halfWidth,
  pivotY,
  topY,
  color,
}: {
  halfWidth: number;
  /** Height of the tilt bolts — the fixture's balance point. */
  pivotY: number;
  /** Height of the cross piece over the top. */
  topY: number;
  color: string;
}) {
  const bar = mmToWorld(14);
  const span = Math.max(mmToWorld(20), topY - pivotY);
  return (
    <group>
      {[-halfWidth, halfWidth].map((x) => (
        <mesh key={x} position={[x, pivotY + span / 2, 0]} castShadow>
          <boxGeometry args={[bar, span, bar * 1.6]} />
          <CaseMaterial color={color} />
        </mesh>
      ))}
      {/* The cross piece over the top, carrying the hanging clamp. */}
      <mesh position={[0, topY, 0]} castShadow>
        <boxGeometry args={[halfWidth * 2 + bar, bar, bar * 1.6]} />
        <CaseMaterial color={color} />
      </mesh>
      {/* Tilt bolts, one each side, at the balance point. */}
      {[-halfWidth, halfWidth].map((x) => (
        <mesh key={`bolt-${x}`} position={[x, pivotY, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[mmToWorld(11), mmToWorld(11), mmToWorld(20), 10]} />
          <MetalMaterial />
        </mesh>
      ))}
    </group>
  );
}

/** The hook clamp that grips the truss chord. Every rigged fixture has one. */
function HookClamp({ y }: { y: number }) {
  return (
    <group position={[0, y, 0]}>
      {/* The C of the clamp, opening upward around a 50 mm chord. */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[mmToWorld(30), mmToWorld(6), 8, 16, Math.PI * 1.35]} />
        <MetalMaterial color="#3a3e44" />
      </mesh>
      {/* The bolt that closes it. */}
      <mesh position={[mmToWorld(28), mmToWorld(-6), 0]}>
        <cylinderGeometry args={[mmToWorld(4), mmToWorld(4), mmToWorld(34), 6]} />
        <MetalMaterial />
      </mesh>
    </group>
  );
}

/* ── Profile / ellipsoidal ─────────────────────────────────────────────── */

/**
 * The ETC Source Four silhouette: a long barrel that steps down from a wide
 * lamp housing at the back, through the shutter barrel, to the lens tube.
 * The four shutter handles poking out at 45° are what makes it instantly a
 * profile rather than any other long tube.
 */
function ProfileBody({ spec, caseColor, lampColor, lampIntensity }: BodyProps) {
  const length = mmToWorld(spec.depthMm);
  const lensR = mmToWorld(spec.lensMm) / 2;
  const barrelR = lensR * 0.82;
  const lampR = mmToWorld(spec.widthMm) * 0.42;

  // Laid out from the lens (front, most negative Y) back to the lamp cap.
  const lensTube = length * 0.34;
  const shutter = length * 0.24;
  const lampHouse = length * 0.42;
  const frontY = -length;

  return (
    <group>
      {/* Lens tube. */}
      <mesh position={[0, frontY + lensTube / 2, 0]} castShadow>
        <cylinderGeometry args={[lensR, lensR, lensTube, 20]} />
        <CaseMaterial color={caseColor} />
      </mesh>
      {/* The colour frame holder clipped on the very front. */}
      <mesh position={[0, frontY - mmToWorld(6), 0]} castShadow>
        <boxGeometry args={[lensR * 2.3, mmToWorld(12), lensR * 2.3]} />
        <CaseMaterial color={caseColor} />
      </mesh>
      <Lens radius={lensR * 0.92} color={lampColor} intensity={lampIntensity} y={frontY + mmToWorld(4)} />

      {/* Shutter barrel, slightly fatter than the lens tube. */}
      <mesh position={[0, frontY + lensTube + shutter / 2, 0]} castShadow>
        <cylinderGeometry args={[barrelR * 1.12, barrelR * 1.12, shutter, 16]} />
        <CaseMaterial color={caseColor} />
      </mesh>
      {/* Four shutter blade handles, the giveaway detail. */}
      {[0, 1, 2, 3].map((i) => {
        const a = (Math.PI / 2) * i + Math.PI / 4;
        const r = barrelR * 1.25;
        return (
          <mesh
            key={i}
            position={[Math.cos(a) * r, frontY + lensTube + shutter / 2, Math.sin(a) * r]}
            rotation={[Math.PI / 2, 0, -a]}
          >
            <cylinderGeometry args={[mmToWorld(5), mmToWorld(5), mmToWorld(52), 6]} />
            <MetalMaterial />
          </mesh>
        );
      })}
      {/* The gobo slot on top of the barrel. */}
      <mesh position={[0, frontY + lensTube + shutter * 0.15, 0]} castShadow>
        <boxGeometry args={[barrelR * 0.5, mmToWorld(10), barrelR * 2.5]} />
        <CaseMaterial color={caseColor} />
      </mesh>

      {/*
        Lamp housing: a squared-off box at the back, not a taper.

        A Source Four's lamp house is a flat-sided casting with a rectangular
        section — drawing it as a cone that widens toward the cap turns the
        cooling fins into a stack of funnels, which is nothing like the real
        object.
      */}
      <mesh position={[0, frontY + lensTube + shutter + lampHouse * 0.44, 0]} castShadow>
        <boxGeometry args={[lampR * 1.7, lampHouse * 0.88, lampR * 1.55]} />
        <CaseMaterial color={caseColor} />
      </mesh>
      {/* The lamp cap on the very back, where the plug goes in. */}
      <mesh position={[0, frontY + lensTube + shutter + lampHouse * 0.94, 0]} castShadow>
        <boxGeometry args={[lampR * 1.2, lampHouse * 0.22, lampR * 1.1]} />
        <CaseMaterial color="#111316" />
      </mesh>
      {/* Cooling fins: flat plates across the housing, standing slightly proud. */}
      {[0.24, 0.42, 0.6].map((t) => (
        <mesh
          key={t}
          position={[0, frontY + lensTube + shutter + lampHouse * t, 0]}
          castShadow
        >
          <boxGeometry args={[lampR * 1.82, mmToWorld(8), lampR * 1.66]} />
          <CaseMaterial color={caseColor} />
        </mesh>
      ))}

      {/*
        The yoke pivots near the balance point, which on a profile is just
        behind the shutter barrel — the heavy end is the lamp house.
      */}
      <Yoke
        halfWidth={mmToWorld(spec.widthMm) / 2}
        pivotY={frontY + lensTube + shutter * 0.5}
        topY={mmToWorld(70)}
        color={YOKE_COLOR}
      />
      <HookClamp y={mmToWorld(98)} />
    </group>
  );
}

/* ── Fresnel ───────────────────────────────────────────────────────────── */

/**
 * Short, boxy housing with the stepped fresnel lens at the front and four
 * barn door leaves splayed off it. The barn doors are the identifying
 * feature and are always drawn open, because that is how a rigged fresnel
 * sits once it has been focused.
 */
function FresnelBody({ spec, caseColor, lampColor, lampIntensity }: BodyProps) {
  const w = mmToWorld(spec.widthMm) * 0.62;
  const depth = mmToWorld(spec.depthMm);
  const lensR = mmToWorld(spec.lensMm) / 2;
  const frontY = -depth;

  return (
    <group>
      {/* The housing: a rounded box, taller than it is deep. */}
      <mesh position={[0, frontY + depth * 0.55, 0]} castShadow>
        <boxGeometry args={[w, depth * 0.9, w * 0.92]} />
        <CaseMaterial color={caseColor} />
      </mesh>
      {/* The lens ring at the front. */}
      <mesh position={[0, frontY + mmToWorld(18), 0]} castShadow>
        <cylinderGeometry args={[lensR, lensR, mmToWorld(36), 20]} />
        <CaseMaterial color={caseColor} />
      </mesh>
      <Lens radius={lensR * 0.9} color={lampColor} intensity={lampIntensity} y={frontY + mmToWorld(2)} />

      {/*
        Barn doors: a square rotator ring on the front with four flat leaves
        hinged off its edges, opened about 25°.

        Each leaf hinges on the edge it sits on and swings outward about that
        edge — so the two side leaves rotate about Z and the top and bottom
        pair about X. Rotating all four the same way is what turns a barn door
        set into a splayed flower, which is not a shape any fixture has.
      */}
      <mesh position={[0, frontY - mmToWorld(14), 0]} castShadow>
        <boxGeometry args={[lensR * 2.16, mmToWorld(22), lensR * 2.16]} />
        <CaseMaterial color="#141619" />
      </mesh>
      {[
        { axis: 'z' as const, sign: 1 },
        { axis: 'z' as const, sign: -1 },
        { axis: 'x' as const, sign: 1 },
        { axis: 'x' as const, sign: -1 },
      ].map((leaf, i) => {
        const open = 0.44;
        const hinge = lensR * 1.05;
        // The hinge line sits on one edge of the ring; the leaf extends from
        // it, so it is offset by half its own length along the swing.
        const leafLen = lensR * 1.5;
        const group =
          leaf.axis === 'z'
            ? { position: [leaf.sign * hinge, frontY - mmToWorld(24), 0], rotation: [0, 0, -leaf.sign * open] }
            : { position: [0, frontY - mmToWorld(24), leaf.sign * hinge], rotation: [leaf.sign * open, 0, 0] };
        return (
          <group
            key={i}
            position={group.position as [number, number, number]}
            rotation={group.rotation as [number, number, number]}
          >
            <mesh position={[0, -leafLen / 2, 0]} castShadow>
              <boxGeometry
                args={
                  leaf.axis === 'z'
                    ? [mmToWorld(3), leafLen, lensR * 2.1]
                    : [lensR * 2.1, leafLen, mmToWorld(3)]
                }
              />
              <CaseMaterial color={caseColor} />
            </mesh>
          </group>
        );
      })}

      {/* A fresnel balances near the middle of its housing. */}
      <Yoke
        halfWidth={mmToWorld(spec.widthMm) / 2}
        pivotY={frontY + depth * 0.5}
        topY={mmToWorld(60)}
        color={YOKE_COLOR}
      />
      <HookClamp y={mmToWorld(88)} />
    </group>
  );
}

/* ── PAR can ───────────────────────────────────────────────────────────── */

/** A parallel can: a plain cylinder on a stirrup, with the lamp visible. */
function ParBody({ spec, caseColor, lampColor, lampIntensity }: BodyProps) {
  const r = mmToWorld(spec.lensMm) / 2;
  const depth = mmToWorld(spec.depthMm);
  const frontY = -depth;

  return (
    <group>
      <mesh position={[0, frontY + depth / 2, 0]} castShadow>
        <cylinderGeometry args={[r, r * 0.94, depth, 22]} />
        <CaseMaterial color={caseColor} />
      </mesh>
      {/* The rolled rim at the mouth of the can. */}
      <mesh position={[0, frontY + mmToWorld(10), 0]} castShadow>
        <torusGeometry args={[r, mmToWorld(8), 8, 24]} />
        <CaseMaterial color={caseColor} />
      </mesh>
      <Lens radius={r * 0.88} color={lampColor} intensity={lampIntensity} y={frontY + mmToWorld(14)} />
      {/* Cable gland out the back, so the can is not a sealed tube. */}
      <mesh position={[0, frontY + depth + mmToWorld(14), 0]}>
        <cylinderGeometry args={[mmToWorld(16), mmToWorld(16), mmToWorld(28), 8]} />
        <CaseMaterial color={caseColor} />
      </mesh>

      <Yoke
        halfWidth={mmToWorld(spec.widthMm) / 2}
        pivotY={frontY + depth * 0.5}
        topY={mmToWorld(60)}
        color={YOKE_COLOR}
      />
      <HookClamp y={mmToWorld(88)} />
    </group>
  );
}

/* ── Flat LED panel ────────────────────────────────────────────────────── */

/**
 * A rectangular LED array on a yoke — the modern wash and cyc flood. The
 * individual emitters are drawn as a grid, because an LED wash reads as a
 * field of dots rather than a single lens the moment it is anywhere near.
 */
function PanelBody({ spec, caseColor, lampColor, lampIntensity }: BodyProps) {
  const w = mmToWorld(spec.widthMm) * 0.78;
  const h = mmToWorld(spec.heightMm) * 0.72;
  const depth = mmToWorld(spec.depthMm);
  const frontY = -depth;

  // A 4x4 emitter grid: dense enough to read as an array, cheap to draw.
  const cells = useMemo(() => {
    const out: Array<[number, number]> = [];
    const n = 4;
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        out.push([((i + 0.5) / n - 0.5) * w * 0.82, ((j + 0.5) / n - 0.5) * h * 0.82]);
      }
    }
    return out;
  }, [w, h]);

  const cellR = Math.min(w, h) * 0.085;

  return (
    <group>
      <mesh position={[0, frontY + depth / 2, 0]} castShadow>
        <boxGeometry args={[w, depth, h]} />
        <CaseMaterial color={caseColor} />
      </mesh>
      {/* Emitters, slightly proud of the face. */}
      {cells.map(([x, z], i) => (
        <mesh key={i} position={[x, frontY + mmToWorld(2), z]} rotation={[Math.PI / 2, 0, 0]}>
          <circleGeometry args={[cellR, 10]} />
          <meshStandardMaterial
            color={lampColor}
            emissive={lampColor}
            emissiveIntensity={lampIntensity}
            toneMapped={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}

      <Yoke
        halfWidth={mmToWorld(spec.widthMm) / 2}
        pivotY={frontY + depth * 0.5}
        topY={mmToWorld(60)}
        color={YOKE_COLOR}
      />
      <HookClamp y={mmToWorld(88)} />
    </group>
  );
}

/* ── Moving head ───────────────────────────────────────────────────────── */

/**
 * Base, yoke, head — the three parts that make a moving light legible.
 *
 * The head is slung *between* the yoke arms and tilts about them, and the
 * yoke pans about the base. Modelling the gap between the arms and the head
 * is what stops it reading as a lump: from any angle you can see through it,
 * which is exactly how a real moving head looks on a bar.
 *
 * The body is authored hanging base-up, since that is how they are rigged.
 */
function MovingBody({ spec, caseColor, lampColor, lampIntensity }: BodyProps) {
  const yokeW = mmToWorld(spec.widthMm);
  const total = mmToWorld(spec.heightMm);
  const lensR = mmToWorld(spec.lensMm) / 2;
  /*
   * The head has to fit *between* the yoke arms with room to swing, so its
   * radius is bounded by the yoke as well as by the published head depth.
   * Sizing it from the depth alone makes the head as wide as the yoke, and
   * the arms then appear to pass through it.
   */
  const headR = Math.min(mmToWorld(spec.depthMm) * 0.46, yokeW * 0.36);

  /*
   * Proportions from the published figures — a MAC Quantum Profile is 431 mm
   * across the yoke and 642 mm tall with the head straight up, so the head is
   * a little over half the height and the base takes most of the rest.
   *
   * The three parts have to *connect*. The arms run from the underside of the
   * base down to the tilt bearings, and the head sits between those bearings
   * with clearance to swing. Arms drawn from the origin downward, or set at
   * half the yoke width while the base is narrower, leave the yoke floating
   * beside the fixture instead of holding it.
   */
  const baseH = total * 0.34;
  const headLen = total * 0.46;
  const armX = yokeW / 2 - mmToWorld(18);
  // Head hangs below the base with a gap, and pivots on its own centre.
  const headCentreY = -baseH - mmToWorld(24) - headLen * 0.5;
  const armTop = -baseH * 0.72;
  /*
   * The arms reach past the pivot to the far side of the head.
   *
   * Manufacturers publish both "height, head straight up" and "height,
   * maximum" — 360 mm and 390 mm for a MAC Aura XB — and the 30 mm between
   * them is all the head ever protrudes beyond the yoke as it tilts. Arms
   * that stop at the bearing leave the head hanging out of the bottom of the
   * fixture by half its own length, which is the wrong silhouette entirely.
   */
  const armBottom = headCentreY - headLen * 0.5 - mmToWorld(16);

  return (
    <group>
      {/* Base: the electronics box the yoke pans on, as wide as the yoke. */}
      <mesh position={[0, -baseH / 2, 0]} castShadow>
        <boxGeometry args={[yokeW * 0.92, baseH, mmToWorld(spec.depthMm) * 0.92]} />
        <CaseMaterial color={caseColor} />
      </mesh>
      {/* Cooling vents on the face of the base, as a shallow inset. */}
      <mesh position={[0, -baseH * 0.55, mmToWorld(spec.depthMm) * 0.47]} castShadow>
        <boxGeometry args={[yokeW * 0.66, baseH * 0.44, mmToWorld(6)]} />
        <CaseMaterial color="#111316" />
      </mesh>
      {/* The pan bearing, a collar between base and yoke. */}
      <mesh position={[0, -baseH * 0.99, 0]}>
        <cylinderGeometry args={[yokeW * 0.19, yokeW * 0.22, mmToWorld(34), 18]} />
        <MetalMaterial color="#3a3e44" />
      </mesh>

      {/*
        Yoke arms: from under the base down to the tilt bearings. Slightly
        tapered, which is what every moving-head yoke actually is.
      */}
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          position={[side * armX, (armTop + armBottom) / 2, 0]}
          castShadow
        >
          <boxGeometry args={[mmToWorld(34), Math.abs(armTop - armBottom), mmToWorld(76)]} />
          <CaseMaterial color={caseColor} />
        </mesh>
      ))}
      {/* The shoulder joining both arms across the underside of the base. */}
      <mesh position={[0, armTop, 0]} castShadow>
        <boxGeometry args={[armX * 2 + mmToWorld(34), mmToWorld(40), mmToWorld(76)]} />
        <CaseMaterial color={caseColor} />
      </mesh>
      {/* Tilt bearings where the arms grip the head. */}
      {[-1, 1].map((side) => (
        <mesh
          key={`tilt-${side}`}
          position={[side * armX, headCentreY, 0]}
          rotation={[0, 0, Math.PI / 2]}
        >
          <cylinderGeometry args={[mmToWorld(30), mmToWorld(30), mmToWorld(30), 14]} />
          <MetalMaterial />
        </mesh>
      ))}

      {/* The head itself: a barrel slung between the arms. */}
      <group position={[0, headCentreY, 0]}>
        <mesh castShadow>
          <cylinderGeometry args={[headR, headR * 0.95, headLen, 22]} />
          <CaseMaterial color={caseColor} />
        </mesh>
        {/* The front bezel around the objective lens. */}
        <mesh position={[0, -headLen / 2 + mmToWorld(12), 0]} castShadow>
          <cylinderGeometry args={[lensR * 1.16, lensR * 1.16, mmToWorld(30), 22]} />
          <CaseMaterial color="#111316" />
        </mesh>
        <Lens
          radius={lensR}
          color={lampColor}
          intensity={lampIntensity}
          y={-headLen / 2 + mmToWorld(28)}
        />
        {/* The vented cap on the back of the head. */}
        <mesh position={[0, headLen / 2 - mmToWorld(8), 0]} castShadow>
          <cylinderGeometry args={[headR * 0.86, headR * 0.86, mmToWorld(18), 22]} />
          <CaseMaterial color="#111316" />
        </mesh>
      </group>

      {/* Omega brackets on top: how a moving head clamps to truss. */}
      {[-1, 1].map((side) => (
        <mesh key={`om-${side}`} position={[side * yokeW * 0.2, mmToWorld(14), 0]} castShadow>
          <boxGeometry args={[mmToWorld(80), mmToWorld(22), mmToWorld(52)]} />
          <MetalMaterial color="#3a3e44" />
        </mesh>
      ))}
    </group>
  );
}

/* ── Blinder ───────────────────────────────────────────────────────────── */

/**
 * A molefay: a frame of open parabolic cells staring out at the audience.
 * Four cells in a 2x2 for the common unit; the cells are drawn as dishes so
 * the fixture reads as a grid of lamps rather than a black plate.
 */
function BlinderBody({ spec, caseColor, lampColor, lampIntensity }: BodyProps) {
  const w = mmToWorld(spec.widthMm);
  const h = mmToWorld(spec.heightMm);
  const depth = mmToWorld(spec.depthMm);
  const frontY = -depth;
  const cellR = Math.min(w, h) * 0.22;

  const cells: Array<[number, number]> = [
    [-w * 0.24, -h * 0.24],
    [w * 0.24, -h * 0.24],
    [-w * 0.24, h * 0.24],
    [w * 0.24, h * 0.24],
  ];

  return (
    <group>
      {/*
        The frame: a shallow open box, its face across XZ. It sits *behind*
        the lamp faces so the cells look recessed into it, which is what a
        molefay is — lamps sunk in a box, not dishes hung off the front.
      */}
      <mesh position={[0, frontY + depth * 0.62, 0]} castShadow>
        <boxGeometry args={[w, depth * 0.76, h]} />
        <CaseMaterial color={caseColor} />
      </mesh>
      {/* The frame rim, standing proud around the open face. */}
      {[
        [0, (h / 2) * 0.94],
        [0, -(h / 2) * 0.94],
      ].map(([x, z], i) => (
        <mesh key={`rim-${i}`} position={[x!, frontY + mmToWorld(18), z!]} castShadow>
          <boxGeometry args={[w, mmToWorld(36), h * 0.12]} />
          <CaseMaterial color={caseColor} />
        </mesh>
      ))}
      {cells.map(([x, z], i) => (
        <group key={i} position={[x, frontY, z]}>
          {/*
            The parabolic reflector, opening toward the beam. The cone is
            widest at the mouth and narrows into the housing, so it is scaled
            negatively rather than flipped end for end — flipping puts the
            wide end behind the frame and leaves a spike poking out the front.
          */}
          <mesh position={[0, depth * 0.3, 0]} castShadow>
            <coneGeometry args={[cellR, depth * 0.6, 18, 1, true]} />
            <meshStandardMaterial
              color="#ccd2da"
              roughness={0.2}
              metalness={0.92}
              side={THREE.DoubleSide}
            />
          </mesh>
          {/* The lamp face, sitting at the mouth of the reflector. */}
          <mesh position={[0, mmToWorld(6), 0]} rotation={[Math.PI / 2, 0, 0]}>
            <circleGeometry args={[cellR * 0.84, 18]} />
            <meshStandardMaterial
              color={lampColor}
              emissive={lampColor}
              emissiveIntensity={lampIntensity}
              toneMapped={false}
              side={THREE.DoubleSide}
            />
          </mesh>
        </group>
      ))}

      {/*
        The yoke clears the *depth* of the frame, not its face height.

        `heightMm` on a blinder is the height of the lamp face — 410 mm on a
        four-cell molefay — and that face lies in the XZ plane here, across
        the beam. Sizing the yoke from it puts the cross piece most of a metre
        above a fixture only 180 mm deep.
      */}
      <Yoke
        halfWidth={w / 2 + mmToWorld(20)}
        pivotY={frontY + depth * 0.5}
        topY={mmToWorld(70)}
        color={YOKE_COLOR}
      />
      <HookClamp y={mmToWorld(98)} />
    </group>
  );
}

/* ── Batten ────────────────────────────────────────────────────────────── */

/** A linear bar of cells for cyc and set washes. */
function BattenBody({ spec, caseColor, lampColor, lampIntensity }: BodyProps) {
  const w = mmToWorld(spec.widthMm);
  const h = mmToWorld(spec.heightMm);
  const depth = mmToWorld(spec.depthMm);
  const frontY = -depth;
  const count = 8;

  return (
    <group>
      <mesh position={[0, frontY + depth / 2, 0]} castShadow>
        <boxGeometry args={[w, depth * 0.85, h]} />
        <CaseMaterial color={caseColor} />
      </mesh>
      {Array.from({ length: count }, (_, i) => {
        const x = ((i + 0.5) / count - 0.5) * w * 0.94;
        return (
          <mesh key={i} position={[x, frontY + mmToWorld(2), 0]} rotation={[Math.PI / 2, 0, 0]}>
            <circleGeometry args={[(w / count) * 0.34, 12]} />
            <meshStandardMaterial
              color={lampColor}
              emissive={lampColor}
              emissiveIntensity={lampIntensity}
              toneMapped={false}
              side={THREE.DoubleSide}
            />
          </mesh>
        );
      })}
      {/* End plates with the yoke bolts, one at each end of the bar. */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[(side * w) / 2, frontY + depth / 2, 0]} castShadow>
          <boxGeometry args={[mmToWorld(12), depth, h * 1.1]} />
          <CaseMaterial color={caseColor} />
        </mesh>
      ))}
      <HookClamp y={mmToWorld(30)} />
    </group>
  );
}

/* ── Uplighter ─────────────────────────────────────────────────────────── */

/**
 * A battery uplighter puck. No yoke and no clamp — it stands on the floor and
 * points up, which is the whole reason it is shaped like this. The body is
 * authored pointing down like everything else and flipped by the caller.
 */
function UplighterBody({ spec, caseColor, lampColor, lampIntensity }: BodyProps) {
  const r = mmToWorld(spec.widthMm) / 2;
  const height = mmToWorld(spec.heightMm);
  const lensR = mmToWorld(spec.lensMm) / 2;
  const frontY = -height;

  return (
    <group>
      {/* Tapered body: wider at the base it stands on. */}
      <mesh position={[0, frontY + height / 2, 0]} castShadow>
        <cylinderGeometry args={[r * 0.86, r, height * 0.86, 20]} />
        <CaseMaterial color={caseColor} />
      </mesh>
      {/* The base plate it actually rests on. */}
      <mesh position={[0, frontY + height - mmToWorld(8), 0]} castShadow receiveShadow>
        <cylinderGeometry args={[r * 1.04, r * 1.04, mmToWorld(16), 20]} />
        <CaseMaterial color={caseColor} />
      </mesh>
      <Lens radius={lensR} color={lampColor} intensity={lampIntensity} y={frontY + mmToWorld(6)} />
      {/* A shallow lip around the lens, as most uplighter pucks have. */}
      <mesh position={[0, frontY + mmToWorld(10), 0]} castShadow>
        <torusGeometry args={[lensR * 1.06, mmToWorld(7), 8, 22]} />
        <CaseMaterial color={caseColor} />
      </mesh>
    </group>
  );
}

/* ── Follow spot ───────────────────────────────────────────────────────── */

/**
 * A long barrel on a tripod, with the two operator handles that give it its
 * shape. Drawn with its stand because a followspot is never rigged — it is
 * the one fixture in the plot that has a person standing behind it, and the
 * stand is what reserves that floor space.
 */
function FollowspotBody({ spec, caseColor, lampColor, lampIntensity }: BodyProps) {
  const length = mmToWorld(spec.depthMm);
  const r = mmToWorld(spec.lensMm) / 2;
  const frontY = -length;

  return (
    <group>
      {/* The barrel, stepping wider toward the lamp house at the back. */}
      <mesh position={[0, frontY + length * 0.3, 0]} castShadow>
        <cylinderGeometry args={[r, r * 0.95, length * 0.6, 20]} />
        <CaseMaterial color={caseColor} />
      </mesh>
      <mesh position={[0, frontY + length * 0.78, 0]} castShadow>
        <boxGeometry args={[r * 2.1, length * 0.38, r * 2.2]} />
        <CaseMaterial color={caseColor} />
      </mesh>
      <Lens radius={r * 0.9} color={lampColor} intensity={lampIntensity} y={frontY + mmToWorld(4)} />

      {/* Operator handles, angled back on both sides. */}
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          position={[side * r * 1.5, frontY + length * 0.82, 0]}
          rotation={[0, 0, side * 0.5]}
          castShadow
        >
          <cylinderGeometry args={[mmToWorld(14), mmToWorld(14), mmToWorld(240), 8]} />
          <CaseMaterial color="#101215" />
        </mesh>
      ))}

      {/*
        The stand.

        A followspot pivots on a short post at its balance point, and the post
        sits on a tripod on the floor. The tripod is drawn in the group's own
        frame rather than along the beam: the body is authored aiming down -Y
        like everything else, but a followspot is aimed nearly horizontally in
        use, so a stand extruded along the aim would lie on its side. Keeping
        it short and centred on the pivot means it reads correctly at the
        shallow angles these are actually set to.
      */}
      <mesh position={[0, frontY + length * 0.55, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[mmToWorld(26), mmToWorld(26), r * 2.6, 12]} />
        <MetalMaterial color="#3a3e44" />
      </mesh>
      <mesh position={[0, frontY + length * 0.55 + mmToWorld(150), 0]} castShadow>
        <cylinderGeometry args={[mmToWorld(24), mmToWorld(30), mmToWorld(300), 12]} />
        <MetalMaterial color="#33373d" />
      </mesh>
      {/* Three legs splaying off the foot of the post. */}
      {[0, 1, 2].map((i) => {
        const a = (Math.PI * 2 * i) / 3;
        const reach = mmToWorld(300);
        const drop = frontY + length * 0.55 + mmToWorld(430);
        return (
          <mesh
            key={i}
            position={[Math.cos(a) * reach * 0.5, drop, Math.sin(a) * reach * 0.5]}
            rotation={[Math.sin(a) * 0.75, 0, -Math.cos(a) * 0.75]}
            castShadow
          >
            <cylinderGeometry args={[mmToWorld(13), mmToWorld(13), mmToWorld(560), 8]} />
            <MetalMaterial color="#33373d" />
          </mesh>
        );
      })}
    </group>
  );
}

/* ── Pinspot ───────────────────────────────────────────────────────────── */

/** A tiny can on a stirrup. Small and specific, and drawn that way. */
function PinspotBody({ spec, caseColor, lampColor, lampIntensity }: BodyProps) {
  const r = mmToWorld(spec.lensMm) / 2;
  const depth = mmToWorld(spec.depthMm);
  const frontY = -depth;

  return (
    <group>
      <mesh position={[0, frontY + depth / 2, 0]} castShadow>
        <cylinderGeometry args={[r, r * 0.9, depth, 14]} />
        <CaseMaterial color={caseColor} />
      </mesh>
      <Lens radius={r * 0.85} color={lampColor} intensity={lampIntensity} y={frontY + mmToWorld(3)} />
      <Yoke
        halfWidth={mmToWorld(spec.widthMm) / 2}
        pivotY={frontY + depth * 0.5}
        topY={mmToWorld(45)}
        color={YOKE_COLOR}
      />
      <HookClamp y={mmToWorld(70)} />
    </group>
  );
}

/* ── Dispatch ──────────────────────────────────────────────────────────── */

/**
 * Draw the body for a fixture.
 *
 * Everything is authored aiming down -Y; the caller rotates the whole group
 * onto the aim vector, which is why a floor uplighter and a rigged profile
 * can share one mechanism.
 */
export function FixtureBody(props: BodyProps) {
  switch (props.spec.body) {
    case 'profile':
      return <ProfileBody {...props} />;
    case 'fresnel':
      return <FresnelBody {...props} />;
    case 'par':
      return <ParBody {...props} />;
    case 'panel':
      return <PanelBody {...props} />;
    case 'moving':
      return <MovingBody {...props} />;
    case 'blinder':
      return <BlinderBody {...props} />;
    case 'batten':
      return <BattenBody {...props} />;
    case 'uplighter':
      return <UplighterBody {...props} />;
    case 'followspot':
      return <FollowspotBody {...props} />;
    case 'pinspot':
      return <PinspotBody {...props} />;
    default:
      return <ParBody {...props} />;
  }
}
