import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  LIGHT_FIXTURE_SPECS,
  mmToWorld,
  type LightFixtureSceneObject,
} from '@novira/shared';
import { CASE_COLOR, CASE_COLOR_MUTED, FixtureBody } from './fixtureBodies';

/**
 * Lighting fixtures.
 *
 * Two things are drawn, and both matter for different reasons.
 *
 * **The light itself** is a real three.js spot light, aimed at the fixture's
 * target. That is what makes the render look lit rather than coloured in, and
 * it is why the beam angle control is worth having at all.
 *
 * **The body** is a small physical object at the fixture's position, because a
 * lighting plot has to show a rigger where to hang forty units — and a plan
 * that shows only the pools of light on the floor is not a plot.
 *
 * The visible beam cone is optional and off for fixtures that would not show
 * one. Drawing a visible shaft from a wash light is the tell of a render made
 * by someone who has not been in a room with haze in it.
 */

interface Props {
  light: LightFixtureSceneObject;
  selected: boolean;
  /** Global shadow switch from the scene lighting settings. */
  shadowsEnabled: boolean;
}

/** Gobo patterns, drawn once into a canvas texture and cached by pattern. */
const goboCache = new Map<string, THREE.Texture>();

function goboTexture(pattern: string): THREE.Texture | null {
  if (pattern === 'none') return null;
  const cached = goboCache.get(pattern);
  if (cached) return cached;

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#ffffff';

  switch (pattern) {
    case 'breakup': {
      // Irregular blobs. Deterministic, so the same gobo looks the same on
      // every reload rather than shimmering between sessions.
      let seed = 7;
      const random = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      };
      for (let i = 0; i < 90; i += 1) {
        ctx.beginPath();
        ctx.ellipse(random() * size, random() * size, 6 + random() * 26, 6 + random() * 22, random() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'leaves': {
      let seed = 19;
      const random = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      };
      for (let i = 0; i < 140; i += 1) {
        const x = random() * size;
        const y = random() * size;
        const r = 4 + random() * 12;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + r, y - r, x + r * 2, y);
        ctx.quadraticCurveTo(x + r, y + r, x, y);
        ctx.fill();
      }
      break;
    }
    case 'stars': {
      let seed = 31;
      const random = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      };
      for (let i = 0; i < 160; i += 1) {
        ctx.beginPath();
        ctx.arc(random() * size, random() * size, 1 + random() * 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'window': {
      const bar = size / 12;
      for (let x = 0; x < 3; x += 1) {
        for (let y = 0; y < 3; y += 1) {
          ctx.fillRect(bar + x * (size / 3), bar + y * (size / 3), size / 3 - bar * 2, size / 3 - bar * 2);
        }
      }
      break;
    }
    case 'lines': {
      for (let i = 0; i < 14; i += 1) {
        ctx.fillRect(i * (size / 14), 0, size / 28, size);
      }
      break;
    }
    case 'dots': {
      for (let x = 0; x < 10; x += 1) {
        for (let y = 0; y < 10; y += 1) {
          ctx.beginPath();
          ctx.arc((x + 0.5) * (size / 10), (y + 0.5) * (size / 10), size / 40, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case 'logo':
    default: {
      // A stand-in ring, so "logo" is visibly a projected shape rather than an
      // open beam. A real client gobo is uploaded as artwork.
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size * 0.34, 0, Math.PI * 2);
      ctx.lineWidth = size * 0.09;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      break;
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  goboCache.set(pattern, texture);
  return texture;
}

export function LightFixture3D({ light, selected, shadowsEnabled }: Props) {
  const spec = LIGHT_FIXTURE_SPECS[light.fixture];
  const targetRef = useRef<THREE.Object3D>(null);
  const spotRef = useRef<THREE.SpotLight>(null);

  /*
   * The target is a scene object the spot light points at, and three.js needs
   * it to be in the scene graph. It is placed relative to this group, so the
   * aim point is converted from plan space into the group's local space here —
   * the fixture's own position is already applied by the parent transform.
   */
  const localTarget = useMemo(
    () =>
      new THREE.Vector3(
        mmToWorld(light.targetMm.x - light.positionMm.x),
        mmToWorld(light.targetMm.y - light.positionMm.y),
        mmToWorld(light.targetMm.z - light.positionMm.z)
      ),
    [light.targetMm, light.positionMm]
  );

  useFrame(() => {
    if (spotRef.current && targetRef.current) spotRef.current.target = targetRef.current;
  });

  const gobo = useMemo(() => goboTexture(light.gobo), [light.gobo]);
  const intensity = light.muted ? 0 : Math.max(0, light.intensity) * spec.intensity;
  const angle = ((light.beamAngleDeg || spec.beamAngleDeg) * Math.PI) / 360;
  const distance = mmToWorld(spec.throwMm) * 2.2;

  // Aim direction, for orienting the fixture body so it points at its target.
  const bodyQuaternion = useMemo(() => {
    const direction = localTarget.clone().normalize();
    if (direction.lengthSq() < 0.0001) direction.set(0, -1, 0);
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), direction);
  }, [localTarget]);

  const beamLength = Math.min(localTarget.length() || 4, distance);
  const beamRadius = Math.tan(angle) * beamLength;

  /*
   * Where the beam leaves the fixture.
   *
   * The bodies are authored aiming down -Y with the lens at the far end, so
   * the cone has to start at the fixture's own depth rather than at a fixed
   * offset: a followspot barrel is 965 mm long and a pinspot 150 mm, and a
   * single hard-coded figure either buries the beam inside the barrel or
   * floats it in front of the lens. A moving head is the exception — its
   * lens sits partway down the head, not at the end of the body.
   */
  const noseMm = spec.body === 'moving' ? spec.heightMm * 0.72 : spec.depthMm;
  const beamStart = mmToWorld(noseMm);

  return (
    <group>
      {/* The aim point, as a scene object the light can target. */}
      <object3D ref={targetRef} position={localTarget} />

      <spotLight
        ref={spotRef}
        intensity={intensity * 6}
        angle={angle}
        penumbra={Math.max(0.02, Math.min(1, light.softness))}
        distance={distance}
        decay={2}
        color={light.color}
        castShadow={shadowsEnabled && light.castShadow}
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0008}
        map={gobo ?? undefined}
      />

      {/*
        The fixture body, oriented along the aim.

        The geometry is the real thing at its published size — a Source Four
        silhouette for a profile, a base-yoke-head for a moving light, a grid
        of open cells for a blinder — because a plot is read by silhouette and
        fourteen identical cylinders is a scatter of markers, not a plot. See
        `fixtureBodies.tsx`.
      */}
      <group quaternion={bodyQuaternion} userData={{ part: 'fixture' }}>
        <FixtureBody
          spec={spec}
          caseColor={selected ? '#0072FD' : light.muted ? CASE_COLOR_MUTED : CASE_COLOR}
          lampColor={light.color}
          lampIntensity={light.muted ? 0 : 1.6}
        />

        {/*
          The visible beam, in haze. A cone with an additive, depth-write-off
          material — without `depthWrite={false}` two overlapping beams punch
          holes in each other, which is the classic wrong-looking beam.
        */}
        {light.volumetric && !light.muted && intensity > 0.05 ? (
          <mesh position={[0, -beamLength / 2 - beamStart, 0]}>
            <coneGeometry args={[Math.max(0.05, beamRadius), beamLength, 20, 1, true]} />
            <meshBasicMaterial
              color={light.color}
              transparent
              opacity={Math.min(0.24, 0.06 + intensity * 0.06)}
              side={THREE.DoubleSide}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              toneMapped={false}
            />
          </mesh>
        ) : null}
      </group>

      {/* Where it lands, drawn only on the selection so a plot stays readable. */}
      {selected ? (
        <mesh position={localTarget} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[Math.max(0.1, beamRadius * 0.92), Math.max(0.14, beamRadius), 32]} />
          <meshBasicMaterial color={light.color} transparent opacity={0.7} side={THREE.DoubleSide} />
        </mesh>
      ) : null}
    </group>
  );
}
