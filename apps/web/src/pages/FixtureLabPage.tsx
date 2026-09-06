import { useEffect, useMemo, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OrbitControls, ContactShadows } from '@react-three/drei';
import {
  LIGHT_FIXTURES,
  LIGHT_FIXTURE_SPECS,
  TRUSS_SYSTEMS,
  type LightFixtureKey,
} from '@novira/shared';
import { FixtureBody, CASE_COLOR } from '../editor/fixtureBodies';
import { Truss3D } from '../editor/Truss3D';
import { createTruss } from '../editor/factories';

/**
 * The fixture and truss workbench.
 *
 * A development-only page that draws every light fixture and every truss
 * system on a neutral turntable, at a known scale, with a metre rule beside
 * them. It exists because the bodies cannot be judged inside a plan: in a
 * real scene they are 300 mm objects hanging six metres up, in the dark,
 * behind whatever else is in the room — which is exactly the condition under
 * which "it looks roughly like a light" passes review and a wrong silhouette
 * ships.
 *
 * Here each one is isolated, lit properly, and next to a rule, so the two
 * questions that matter can actually be answered: is this the shape of the
 * real fixture, and is it the size of the real fixture.
 *
 * Not routed in production; see `main.tsx`.
 */

/** A 1 m rule with 100 mm ticks, for judging size at a glance. */
function MetreRule({ x }: { x: number }) {
  const ticks = Array.from({ length: 11 }, (_, i) => i / 10);
  return (
    <group position={[x, 0, 0]}>
      <mesh position={[0, 0.5, 0]}>
        <boxGeometry args={[0.012, 1, 0.012]} />
        <meshStandardMaterial color="#e11d48" />
      </mesh>
      {ticks.map((t) => (
        <mesh key={t} position={[0, t, 0]}>
          <boxGeometry args={[t * 10 % 5 === 0 ? 0.07 : 0.04, 0.006, 0.012]} />
          <meshStandardMaterial color="#e11d48" />
        </mesh>
      ))}
    </group>
  );
}

function FixtureStand({ fixture, x }: { fixture: LightFixtureKey; x: number }) {
  const spec = LIGHT_FIXTURE_SPECS[fixture];
  // Hang each one so its lens is at a common height, which is how a bar of
  // mixed fixtures is actually focused.
  const hangY = 2.0;
  return (
    <group position={[x, hangY, 0]}>
      <FixtureBody spec={spec} caseColor={CASE_COLOR} lampColor="#ffe9c8" lampIntensity={1.4} />
    </group>
  );
}

/**
 * Frame the bench from the page rather than from the outside.
 *
 * OrbitControls owns the camera once it is mounted, so a screenshot script
 * that sets `camera.position` gets it overwritten on the next frame. Putting
 * the framing in the scene, keyed on a piece of page state, is what makes the
 * views reproducible — the same button gives the same shot every time.
 */
function LabCamera({
  view,
  count,
  spacing,
  mode,
}: {
  view: LabView;
  count: number;
  spacing: number;
  mode: 'fixtures' | 'truss';
}) {
  const { camera, controls } = useThree() as unknown as {
    camera: THREE.PerspectiveCamera;
    controls: { target: THREE.Vector3; update: () => void } | null;
  };

  useEffect(() => {
    const width = Math.max(1, count) * spacing;
    let pos: [number, number, number] = [0, 2.1, width * 0.9 + 2];
    let target: [number, number, number] = [0, 1.75, 0];

    if (mode === 'truss') {
      pos = view === 'close' ? [-1.4, 1.9, 2.6] : [0, 5.2, 9];
      target = view === 'close' ? [0.7, 1.5, -1.5] : [0, 1.4, -1.5];
    } else if (view === 'left') {
      pos = [-width * 0.3, 2.05, 3.1];
      target = [-width * 0.3, 1.8, 0];
    } else if (view === 'mid') {
      pos = [0, 2.05, 3.1];
      target = [0, 1.8, 0];
    } else if (view === 'right') {
      pos = [width * 0.3, 1.9, 3.1];
      target = [width * 0.3, 1.6, 0];
    } else if (view === 'close') {
      pos = [0, 2.0, 1.5];
      target = [0, 1.78, 0];
    } else if (view === 'top') {
      pos = [0, 5.5, 0.01];
      target = [0, 1.75, 0];
    } else if (view === 'under') {
      // Looking up into the lens, which is how a rigged fixture is seen from
      // the floor, and the only angle that shows a blinder's cells at all.
      pos = [0, 0.35, 1.05];
      target = [0, 1.85, 0];
    }

    camera.position.set(pos[0], pos[1], pos[2]);
    if (controls) {
      controls.target.set(target[0], target[1], target[2]);
      controls.update();
    } else {
      camera.lookAt(target[0], target[1], target[2]);
    }
    camera.updateProjectionMatrix();
  }, [view, count, spacing, mode, camera, controls]);

  return null;
}

type LabView = 'row' | 'left' | 'mid' | 'right' | 'close' | 'top' | 'under';

export function FixtureLabPage() {
  const [mode, setMode] = useState<'fixtures' | 'truss'>('fixtures');
  const [only, setOnly] = useState<LightFixtureKey | 'all'>('all');
  const [view, setView] = useState<LabView>('row');

  const shown = only === 'all' ? [...LIGHT_FIXTURES] : [only];
  const spacing = 1.1;

  const trussObjects = useMemo(
    () =>
      TRUSS_SYSTEMS.slice(0, 8).map((sys, i) => {
        const base = createTruss({ systemKey: sys.key, trimHeightMm: 1500, legType: 'none' });
        // A single straight 4 m run per system, stacked back in Z so the
        // sections can be compared side by side rather than as goalposts.
        return {
          ...base,
          shape: 'straight' as const,
          closed: false,
          points: [
            { xMm: -2000, zMm: i * 1400 - 4900 },
            { xMm: 2000, zMm: i * 1400 - 4900 },
          ],
        };
      }),
    []
  );

  return (
    <div className="flex h-screen w-screen flex-col bg-[#15171b]">
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-2 text-sm text-white">
        <strong className="font-semibold">Fixture &amp; truss lab</strong>
        <button
          type="button"
          onClick={() => setMode('fixtures')}
          className={`rounded px-2 py-1 ${mode === 'fixtures' ? 'bg-white/20' : 'bg-white/5'}`}
        >
          Fixtures
        </button>
        <button
          type="button"
          onClick={() => setMode('truss')}
          className={`rounded px-2 py-1 ${mode === 'truss' ? 'bg-white/20' : 'bg-white/5'}`}
        >
          Truss
        </button>
        {mode === 'fixtures' ? (
          <select
            value={only}
            onChange={(e) => setOnly(e.target.value as LightFixtureKey | 'all')}
            className="rounded bg-white/10 px-2 py-1"
          >
            <option value="all">All fixtures</option>
            {LIGHT_FIXTURES.map((k) => (
              <option key={k} value={k}>
                {LIGHT_FIXTURE_SPECS[k].label}
              </option>
            ))}
          </select>
        ) : null}
        {(['row', 'left', 'mid', 'right', 'close', 'top', 'under'] as LabView[]).map((v) => (
          <button
            key={v}
            type="button"
            data-view={v}
            onClick={() => setView(v)}
            className={`rounded px-2 py-1 capitalize ${view === v ? 'bg-white/20' : 'bg-white/5'}`}
          >
            {v}
          </button>
        ))}
        <span className="text-white/50">
          {mode === 'fixtures'
            ? 'Red rule is 1 m, ticks every 100 mm.'
            : 'Each run is 4 m long at 1.5 m trim.'}
        </span>
      </div>

      <div className="min-h-0 flex-1">
        <Canvas shadows camera={{ position: [0, 2.2, 6], fov: 42 }} gl={{ antialias: true }}>
          {/*
            A pale ground rather than the app's dark canvas. Fixture bodies
            are matte black, and a black object on a near-black background is
            a silhouette — which is the one thing this page exists to look
            past. Against light grey the shutter handles, barn doors and yoke
            all read.
          */}
          <color attach="background" args={['#b9bec6']} />
          {/*
            A three-point studio rig rather than an HDRI: the environment
            presets load from a CDN, and a workbench that goes black when the
            network is unavailable is a workbench that cannot be trusted.
            These are the classic key, fill and back, which is also what shows
            an edge on a matte black body.
          */}
          <ambientLight intensity={1.2} />
          <hemisphereLight args={['#ffffff', '#8b9099', 1.4]} />
          <directionalLight position={[5, 7, 6]} intensity={2.6} castShadow />
          <directionalLight position={[-6, 4, 3]} intensity={1.3} />
          <directionalLight position={[0, 3, -7]} intensity={1.8} />

          {mode === 'fixtures' ? (
            <>
              {shown.map((key, i) => (
                <FixtureStand
                  key={key}
                  fixture={key}
                  x={(i - (shown.length - 1) / 2) * spacing}
                />
              ))}
              <MetreRule x={(shown.length / 2 + 0.6) * spacing} />
            </>
          ) : (
            trussObjects.map((t) => <Truss3D key={t.id} truss={t} selected={false} />)
          )}

          <ContactShadows position={[0, 0, 0]} opacity={0.35} scale={30} blur={2} far={6} />
          <LabCamera view={view} count={shown.length} spacing={spacing} mode={mode} />
          <OrbitControls makeDefault target={[0, 1.6, 0]} />
        </Canvas>
      </div>
    </div>
  );
}
