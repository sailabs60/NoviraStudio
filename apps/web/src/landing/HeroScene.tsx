import { Suspense, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { ContactShadows, Environment, Float, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { isSoftwareRenderer } from '../editor/rendererProfile';

/**
 * The hero: an event space building itself.
 *
 * This is not a video and not a decorative particle field — it is the product's
 * own renderer, drawing the kind of thing the product makes, on a loop. That
 * choice is the whole argument of the page: a tool that claims to design event
 * spaces in 3D should be able to show you one in the first two seconds without
 * asking you to sign up.
 *
 * The animation is a **build sequence**, timed the way a real load-in happens:
 * the floor is marked out, the deck goes down, the truss goes up, the screen is
 * tiled in, the room is dressed, and finally the lights come on. Sixteen
 * seconds, then it clears and starts again. Every element is procedural, so the
 * whole thing is a few kilobytes of arithmetic rather than a model download.
 *
 * Two things keep it honest on a weak machine:
 *
 *  · A software rasteriser gets a static composition instead — the caller
 *    checks and renders the fallback, because a marketing page that pins a CPU
 *    at 100 % is a worse first impression than a still image.
 *  · The pixel ratio is capped at 1.5 and shadows are a single contact pass
 *    rather than a shadow map, which is most of the visual payoff for a
 *    fraction of the cost.
 */

const CYCLE = 16;

/** Where each stage of the build starts and how long it takes, in seconds. */
const BEATS = {
  floor: [0.2, 1.6],
  deck: [1.4, 2.4],
  truss: [3.2, 2.6],
  screen: [5.2, 2.4],
  tables: [7.0, 3.0],
  lights: [9.6, 2.0],
  hold: [12.0, 2.6],
} as const;

/** 0 → 1 across a beat, eased, and clamped outside it. */
function beat(t: number, [start, length]: readonly [number, number]): number {
  const raw = (t - start) / length;
  if (raw <= 0) return 0;
  if (raw >= 1) return 1;
  // Ease-out cubic: things arrive quickly and settle, the way a crane lands.
  return 1 - Math.pow(1 - raw, 3);
}

/** The fade at the end of the loop, so the reset is a dissolve not a cut. */
function loopFade(t: number): number {
  const out = BEATS.hold[0] + BEATS.hold[1];
  if (t < out) return 1;
  return Math.max(0, 1 - (t - out) / (CYCLE - out));
}

export function HeroScene({ className }: { className?: string }) {
  const software = isSoftwareRenderer();

  if (software) return <HeroFallback className={className} />;

  return (
    <div className={className}>
      <Canvas
        dpr={[1, 1.5]}
        shadows={false}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        camera={{ fov: 34, near: 0.1, far: 200, position: [13, 7.5, 15] }}
      >
        <Suspense fallback={null}>
          <BuildSequence />
          <Environment preset="city" environmentIntensity={0.55} />
          <ambientLight intensity={0.5} />
          <directionalLight position={[9, 12, 6]} intensity={1.5} />
          <directionalLight position={[-8, 5, -7]} intensity={0.4} color="#0072FD" />
          <ContactShadows position={[0, 0, 0]} opacity={0.32} scale={40} blur={2.4} far={12} resolution={512} />
          {/*
            Slow, and constrained. The camera drifts enough to read as three
            dimensional and never enough to make anyone reach for a mouse.
          */}
          <OrbitControls
            makeDefault
            enablePan={false}
            enableZoom={false}
            autoRotate
            autoRotateSpeed={0.42}
            minPolarAngle={Math.PI / 3.4}
            maxPolarAngle={Math.PI / 2.35}
            target={[0, 1.6, 0]}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}

/* ── The sequence ──────────────────────────────────────────────────────── */

function BuildSequence() {
  const group = useRef<THREE.Group>(null);
  const clock = useRef(0);

  const floorRef = useRef<THREE.Mesh>(null);
  const deckRefs = useRef<THREE.Mesh[]>([]);
  const trussRef = useRef<THREE.Group>(null);
  const screenRefs = useRef<THREE.Mesh[]>([]);
  const tableRefs = useRef<THREE.Group[]>([]);
  const beamRefs = useRef<THREE.Mesh[]>([]);

  const deck = useMemo(() => gridPositions(4, 2, 2.0, 1.2), []);
  const panels = useMemo(() => gridPositions(8, 4, 0.62, 0.62), []);
  const tables = useMemo(() => ringPositions(9, 5.4, 7.4), []);

  useFrame((_, delta) => {
    clock.current = (clock.current + delta) % CYCLE;
    const t = clock.current;
    const fade = loopFade(t);

    // Floor: scales out from the centre like a chalk line being snapped.
    const f = beat(t, BEATS.floor) * fade;
    if (floorRef.current) {
      floorRef.current.scale.setScalar(Math.max(0.001, f));
      (floorRef.current.material as THREE.MeshBasicMaterial).opacity = 0.14 * f;
    }

    // Deck: each block drops in, staggered along the row.
    const d = beat(t, BEATS.deck);
    deckRefs.current.forEach((mesh, index) => {
      if (!mesh) return;
      const local = Math.min(1, Math.max(0, d * deck.length - index));
      const eased = 1 - Math.pow(1 - local, 3);
      mesh.position.y = 0.2 + (1 - eased) * 5;
      mesh.scale.setScalar(Math.max(0.001, eased * fade));
    });

    // Truss: rises to trim height and settles.
    const tr = beat(t, BEATS.truss);
    if (trussRef.current) {
      trussRef.current.position.y = -6 + tr * 6;
      trussRef.current.scale.setScalar(Math.max(0.001, fade));
      trussRef.current.visible = tr > 0.001;
    }

    // Screen: panels tile in column by column, as a wall is actually built.
    const sc = beat(t, BEATS.screen);
    screenRefs.current.forEach((mesh, index) => {
      if (!mesh) return;
      const local = Math.min(1, Math.max(0, sc * panels.length * 1.15 - index));
      mesh.scale.setScalar(Math.max(0.001, local * fade));
      const material = mesh.material as THREE.MeshStandardMaterial;
      // The wall lights up once it is complete, not panel by panel.
      material.emissiveIntensity = sc > 0.98 ? 0.9 + Math.sin(t * 2.2 + index * 0.3) * 0.12 : 0.04;
    });

    // Tables: arrive on the ring, each with a small settle.
    const tb = beat(t, BEATS.tables);
    tableRefs.current.forEach((node, index) => {
      if (!node) return;
      const local = Math.min(1, Math.max(0, tb * tables.length * 1.1 - index));
      const eased = 1 - Math.pow(1 - local, 3);
      node.scale.setScalar(Math.max(0.001, eased * fade));
      node.position.y = (1 - eased) * 2.5;
    });

    // Lights: beams open, then breathe.
    const li = beat(t, BEATS.lights);
    beamRefs.current.forEach((mesh, index) => {
      if (!mesh) return;
      const material = mesh.material as THREE.MeshBasicMaterial;
      const breathe = 0.55 + Math.sin(t * 1.4 + index) * 0.18;
      material.opacity = li * breathe * 0.2 * fade;
      mesh.scale.set(1, 1, Math.max(0.001, li));
    });

    // The whole build eases in from slightly below, which reads as "assembled"
    // rather than "appeared".
    if (group.current) group.current.position.y = (1 - Math.min(1, t / 1.2)) * -0.4;
  });

  return (
    <group ref={group}>
      {/* The marked-out floor. */}
      <mesh ref={floorRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
        <circleGeometry args={[11, 64]} />
        <meshBasicMaterial color="#0072FD" transparent opacity={0.14} side={THREE.DoubleSide} />
      </mesh>
      <gridHelper args={[26, 26, '#cfd8e6', '#e6ebf3']} position={[0, 0.004, 0]} />

      {/* Stage deck. */}
      {deck.map((position, index) => (
        <mesh
          key={`deck-${index}`}
          ref={(node) => {
            if (node) deckRefs.current[index] = node;
          }}
          position={[position[0], 0.2, position[1] - 4.2]}
        >
          <boxGeometry args={[1.94, 0.4, 1.14]} />
          <meshStandardMaterial color="#20262e" roughness={0.85} metalness={0.05} />
        </mesh>
      ))}

      {/* Truss goalpost over the stage. */}
      <group ref={trussRef} position={[0, 0, -4.2]}>
        <TrussLeg x={-4.3} />
        <TrussLeg x={4.3} />
        <TrussSpan />
      </group>

      {/* LED wall. */}
      <group position={[0, 1.55, -5.6]}>
        {panels.map((position, index) => (
          <mesh
            key={`panel-${index}`}
            ref={(node) => {
              if (node) screenRefs.current[index] = node;
            }}
            position={[position[0], position[1] + 1.35, 0]}
          >
            <boxGeometry args={[0.6, 0.6, 0.07]} />
            <meshStandardMaterial
              color="#0a1220"
              emissive="#0072FD"
              emissiveIntensity={0.04}
              roughness={0.35}
              metalness={0.2}
            />
          </mesh>
        ))}
      </group>

      {/* Round tables with chairs. */}
      {tables.map((position, index) => (
        <group
          key={`table-${index}`}
          ref={(node) => {
            if (node) tableRefs.current[index] = node;
          }}
          position={[position[0], 0, position[1]]}
        >
          <TableWithChairs />
        </group>
      ))}

      {/* Beams from the truss. */}
      {[-3.1, -1.05, 1.05, 3.1].map((x, index) => (
        <mesh
          key={`beam-${index}`}
          ref={(node) => {
            if (node) beamRefs.current[index] = node;
          }}
          position={[x, 3.05, -4.2]}
          rotation={[Math.PI / 2.35, 0, 0]}
        >
          <coneGeometry args={[1.5, 6.6, 28, 1, true]} />
          <meshBasicMaterial
            color="#7ab6ff"
            transparent
            opacity={0}
            side={THREE.DoubleSide}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}

      {/* A slow float on the whole rig, so it never looks frozen mid-hold. */}
      <Float speed={1.1} rotationIntensity={0.04} floatIntensity={0.16}>
        <group />
      </Float>
    </group>
  );
}

/* ── Pieces ────────────────────────────────────────────────────────────── */

function TrussLeg({ x }: { x: number }) {
  return (
    <group position={[x, 0, 0]}>
      <mesh position={[0, 2.35, 0]}>
        <boxGeometry args={[0.3, 4.7, 0.3]} />
        <meshStandardMaterial color="#b6bcc4" metalness={0.85} roughness={0.32} />
      </mesh>
      <mesh position={[0, 0.05, 0]}>
        <boxGeometry args={[0.8, 0.1, 0.8]} />
        <meshStandardMaterial color="#8d949d" metalness={0.7} roughness={0.45} />
      </mesh>
    </group>
  );
}

function TrussSpan() {
  const rungs = useMemo(() => Array.from({ length: 13 }, (_, i) => -4.2 + i * 0.7), []);
  return (
    <group position={[0, 4.7, 0]}>
      <mesh>
        <boxGeometry args={[8.9, 0.12, 0.12]} />
        <meshStandardMaterial color="#b6bcc4" metalness={0.85} roughness={0.32} />
      </mesh>
      <mesh position={[0, 0.42, 0]}>
        <boxGeometry args={[8.9, 0.12, 0.12]} />
        <meshStandardMaterial color="#b6bcc4" metalness={0.85} roughness={0.32} />
      </mesh>
      {rungs.map((x, index) => (
        <mesh key={index} position={[x, 0.21, 0]} rotation={[0, 0, index % 2 ? 0.7 : -0.7]}>
          <boxGeometry args={[0.6, 0.07, 0.07]} />
          <meshStandardMaterial color="#9ca3ab" metalness={0.8} roughness={0.38} />
        </mesh>
      ))}
    </group>
  );
}

function TableWithChairs() {
  const chairs = useMemo(() => Array.from({ length: 8 }, (_, i) => (i / 8) * Math.PI * 2), []);
  return (
    <group>
      <mesh position={[0, 0.74, 0]} castShadow>
        <cylinderGeometry args={[0.83, 0.83, 0.05, 32]} />
        <meshStandardMaterial color="#f4f2ee" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.37, 0]}>
        <cylinderGeometry args={[0.09, 0.09, 0.72, 12]} />
        <meshStandardMaterial color="#c9ccd1" metalness={0.6} roughness={0.4} />
      </mesh>
      {chairs.map((angle, index) => (
        <group key={index} position={[Math.cos(angle) * 1.24, 0, Math.sin(angle) * 1.24]} rotation={[0, -angle, 0]}>
          <mesh position={[0, 0.45, 0]}>
            <boxGeometry args={[0.44, 0.05, 0.44]} />
            <meshStandardMaterial color="#2c3440" roughness={0.75} />
          </mesh>
          <mesh position={[0.2, 0.72, 0]}>
            <boxGeometry args={[0.05, 0.52, 0.44]} />
            <meshStandardMaterial color="#2c3440" roughness={0.75} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ── Layout helpers ────────────────────────────────────────────────────── */

function gridPositions(columns: number, rows: number, gapX: number, gapY: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const offsetX = ((columns - 1) * gapX) / 2;
  const offsetY = ((rows - 1) * gapY) / 2;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      out.push([column * gapX - offsetX, row * gapY - offsetY]);
    }
  }
  return out;
}

/** Two arcs of tables, the way a room actually gets laid out around a stage. */
function ringPositions(count: number, inner: number, outer: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < count; i += 1) {
    const ring = i % 2 === 0 ? inner : outer;
    const spread = Math.PI * 0.92;
    const angle = -spread / 2 + (i / Math.max(1, count - 1)) * spread + Math.PI / 2;
    out.push([Math.cos(angle) * ring, Math.sin(angle) * ring * 0.62 + 1.4]);
  }
  return out;
}

/* ── The fallback ──────────────────────────────────────────────────────── */

/**
 * What a machine with no GPU gets.
 *
 * Drawn in SVG rather than replaced with a photograph, so it still shows the
 * product's own geometry — the same stage, truss and screen, at rest. It
 * animates with CSS, which a software rasteriser handles without breaking a
 * sweat.
 */
function HeroFallback({ className }: { className?: string }) {
  return (
    <div className={`${className ?? ''} flex items-center justify-center`}>
      <svg viewBox="0 0 640 420" className="h-full w-full" role="img" aria-label="An event space laid out in 3D">
        <defs>
          <linearGradient id="nv-screen" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0072FD" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#0072FD" stopOpacity="0.45" />
          </linearGradient>
          <linearGradient id="nv-floor" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0072FD" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#0072FD" stopOpacity="0" />
          </linearGradient>
        </defs>

        <ellipse cx="320" cy="300" rx="270" ry="96" fill="url(#nv-floor)" />

        {/* Screen */}
        <rect x="196" y="96" width="248" height="118" rx="4" fill="url(#nv-screen)" />
        {Array.from({ length: 8 }).map((_, i) => (
          <line key={`v${i}`} x1={196 + (i + 1) * 27.5} y1="96" x2={196 + (i + 1) * 27.5} y2="214" stroke="#fff" strokeOpacity="0.25" />
        ))}
        {Array.from({ length: 3 }).map((_, i) => (
          <line key={`h${i}`} x1="196" y1={96 + (i + 1) * 29.5} x2="444" y2={96 + (i + 1) * 29.5} stroke="#fff" strokeOpacity="0.25" />
        ))}

        {/* Truss */}
        <rect x="160" y="72" width="320" height="10" rx="3" fill="#b6bcc4" />
        <rect x="160" y="82" width="10" height="150" fill="#b6bcc4" />
        <rect x="470" y="82" width="10" height="150" fill="#b6bcc4" />

        {/* Stage deck */}
        <path d="M180 232 L460 232 L500 262 L140 262 Z" fill="#252c36" />

        {/* Tables */}
        {[[210, 300], [320, 316], [430, 300], [265, 348], [375, 348]].map(([cx, cy], i) => (
          <g key={i}>
            <ellipse cx={cx} cy={cy} rx="34" ry="13" fill="#f4f2ee" stroke="#d7dbe2" />
            {Array.from({ length: 6 }).map((_, c) => {
              const a = (c / 6) * Math.PI * 2;
              return (
                <rect
                  key={c}
                  x={cx + Math.cos(a) * 44 - 6}
                  y={cy + Math.sin(a) * 19 - 5}
                  width="12"
                  height="10"
                  rx="2"
                  fill="#2c3440"
                />
              );
            })}
          </g>
        ))}
      </svg>
    </div>
  );
}
