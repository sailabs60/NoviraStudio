import { useMemo } from 'react';
import { Text } from '@react-three/drei';
import * as THREE from 'three';
import {
  BOOTH_WALL_FINISH_INFO,
  BOOTH_FLOOR_FINISH_INFO,
  deriveBooth,
  mmToWorld,
  type BoothSceneObject,
  type BoothSide,
} from '@novira/shared';

/**
 * Exhibition stand geometry.
 *
 * A stand is read from the aisle, so the two things that have to be
 * unambiguous are which sides are open and how tall the build is. Walls are
 * drawn at their real thickness with a visible finish colour, the fascia sits
 * proud of the wall line the way a real one does, and the open sides are simply
 * absent — not drawn faintly, because "is that wall there or not?" is exactly
 * the question a hall plan exists to answer.
 *
 * The stand number is drawn on the floor rather than floating, because that is
 * where an organiser prints it and where it stays legible from directly above,
 * which is how a hall plan is read.
 */

interface Props {
  booth: BoothSceneObject;
  selected: boolean;
}

const WALL_THICKNESS_MM = 80;

function sideTransform(side: BoothSide, widthMm: number, depthMm: number) {
  const halfW = mmToWorld(widthMm) / 2;
  const halfD = mmToWorld(depthMm) / 2;
  const t = mmToWorld(WALL_THICKNESS_MM);
  switch (side) {
    case 'front':
      return { position: [0, 0, halfD - t / 2] as const, size: [mmToWorld(widthMm), t] as const, rotY: 0 };
    case 'back':
      return { position: [0, 0, -halfD + t / 2] as const, size: [mmToWorld(widthMm), t] as const, rotY: 0 };
    case 'left':
      return { position: [-halfW + t / 2, 0, 0] as const, size: [t, mmToWorld(depthMm)] as const, rotY: 0 };
    case 'right':
    default:
      return { position: [halfW - t / 2, 0, 0] as const, size: [t, mmToWorld(depthMm)] as const, rotY: 0 };
  }
}

export function Booth3D({ booth, selected }: Props) {
  const derived = useMemo(() => deriveBooth(booth), [booth]);
  const finish = BOOTH_WALL_FINISH_INFO[booth.wallFinish];
  const floorFinish = BOOTH_FLOOR_FINISH_INFO[booth.floorFinish];

  const widthM = mmToWorld(booth.widthMm);
  const depthM = mmToWorld(booth.depthMm);
  const heightM = mmToWorld(booth.heightMm);
  const platformM = mmToWorld(booth.platformHeightMm);
  const fasciaM = mmToWorld(booth.fasciaHeightMm);

  const wallColor = selected ? '#8b8ff0' : booth.wallColor || finish.color;
  const hasError = derived.warnings.some((w) => w.severity === 'error');

  return (
    <group>
      {/* Floor. Raised where there is a platform, flush where there is not. */}
      {booth.floorFinish !== 'none' ? (
        <mesh
          position={[0, platformM > 0 ? platformM / 2 : mmToWorld(4), 0]}
          receiveShadow
          userData={{ part: 'floor' }}
        >
          <boxGeometry
            args={[widthM, platformM > 0 ? platformM : mmToWorld(Math.max(4, floorFinish.thicknessMm)), depthM]}
          />
          <meshStandardMaterial color={booth.floorColor || '#4b5563'} roughness={0.92} />
        </mesh>
      ) : null}

      {/*
        The access ramp, drawn whenever there is a platform. It takes real floor
        outside the stand at 1:12, and seeing that is the point — a ramp that
        only exists in a warning is a ramp that gets forgotten on site.
      */}
      {booth.platformHeightMm > 20 ? (
        <mesh
          position={[0, platformM / 2, depthM / 2 + (platformM * 12) / 2]}
          rotation={[Math.atan2(platformM, platformM * 12), 0, 0]}
          receiveShadow
          userData={{ part: 'ramp' }}
        >
          <boxGeometry args={[Math.min(widthM, 1.2), mmToWorld(20), Math.hypot(platformM, platformM * 12)]} />
          <meshStandardMaterial color="#6b7280" roughness={0.9} />
        </mesh>
      ) : null}

      {/*
        Walls.

        Read defensively. A plan written by an older build, a half-applied
        template or a hand-edited document can arrive without this array, and
        `undefined.map` inside a react-three-fiber subtree does not fail
        quietly — it unmounts the Canvas and loses the WebGL context, taking
        every other object in the plan with it. A stand drawn with no walls is
        visible and fixable; a white screen is neither.
      */}
      {(Array.isArray(booth.walls) ? booth.walls : []).map((side) => {
        const transform = sideTransform(side, booth.widthMm, booth.depthMm);
        return (
          <mesh
            key={side}
            position={[transform.position[0], platformM + heightM / 2, transform.position[2]]}
            castShadow
            receiveShadow
            userData={{ part: 'walls' }}
          >
            <boxGeometry args={[transform.size[0], heightM, transform.size[1]]} />
            <meshStandardMaterial
              color={wallColor}
              roughness={booth.wallFinish === 'fabric' ? 0.95 : booth.wallFinish === 'laminate' ? 0.4 : 0.75}
              metalness={booth.wallFinish === 'modular-system' ? 0.35 : 0.02}
            />
          </mesh>
        );
      })}

      {/*
        The system frame.

        A shell scheme *is* its extrusion: octanorm posts at roughly a metre
        with infill panels between them and a rail across the top. Without it
        the stand is three blank rectangles, which is a partition wall rather
        than a stand — and the panel module is what an exhibitor's graphics are
        designed to.
      */}
      {booth.wallFinish === 'modular-system'
        ? (Array.isArray(booth.walls) ? booth.walls : []).flatMap((side) => {
            const transform = sideTransform(side, booth.widthMm, booth.depthMm);
            const runMm = side === 'front' || side === 'back' ? booth.widthMm : booth.depthMm;
            const bays = Math.max(1, Math.round(runMm / 1000));
            const along = side === 'front' || side === 'back' ? 'x' : 'z';
            const post = mmToWorld(46);

            return Array.from({ length: bays + 1 }).map((_, i) => {
              const offset = mmToWorld(-runMm / 2 + (i * runMm) / bays);
              return (
                <mesh
                  key={`post-${side}-${i}`}
                  position={[
                    along === 'x' ? offset : transform.position[0],
                    platformM + heightM / 2,
                    along === 'x' ? transform.position[2] : offset,
                  ]}
                  castShadow
                  userData={{ part: 'system-frame' }}
                >
                  <boxGeometry args={[post, heightM, post]} />
                  <meshStandardMaterial color="#c3c8cf" metalness={0.7} roughness={0.32} />
                </mesh>
              );
            });
          })
        : null}

      {/* Fascia across the front, standing proud of the wall line. */}
      {booth.fascia ? (
        <group position={[0, platformM + heightM + fasciaM / 2, depthM / 2]}>
          <mesh castShadow userData={{ part: 'fascia' }}>
            <boxGeometry args={[widthM, fasciaM, mmToWorld(120)]} />
            <meshStandardMaterial color={booth.fasciaColor || '#1f2937'} roughness={0.6} />
          </mesh>
          {booth.fasciaText ? (
            <Text
              position={[0, 0, mmToWorld(70)]}
              fontSize={Math.min(fasciaM * 0.55, widthM / Math.max(6, booth.fasciaText.length * 0.6))}
              color="#ffffff"
              anchorX="center"
              anchorY="middle"
              maxWidth={widthM * 0.92}
            >
              {booth.fasciaText}
            </Text>
          ) : null}
        </group>
      ) : null}

      {/* Counter, near the open aisle where it actually stands. */}
      {booth.counter ? (
        <mesh
          position={[widthM * 0.28, platformM + mmToWorld(550), depthM * 0.3]}
          castShadow
          receiveShadow
          userData={{ part: 'counter' }}
        >
          <boxGeometry args={[mmToWorld(1200), mmToWorld(1100), mmToWorld(600)]} />
          <meshStandardMaterial color={booth.fasciaColor || '#374151'} roughness={0.55} />
        </mesh>
      ) : null}

      {/* Store room, in the corner furthest from the aisle. */}
      {booth.storeRoom ? (
        <mesh
          position={[-widthM / 2 + mmToWorld(500), platformM + heightM / 2, -depthM / 2 + mmToWorld(500)]}
          castShadow
          userData={{ part: 'store-room' }}
        >
          <boxGeometry args={[mmToWorld(1000), heightM, mmToWorld(1000)]} />
          <meshStandardMaterial color={wallColor} roughness={0.8} />
        </mesh>
      ) : null}

      {/* Stand number, flat on the floor and readable from directly above. */}
      {booth.standNumber ? (
        <Text
          position={[0, platformM + mmToWorld(12), depthM * 0.34]}
          rotation={[-Math.PI / 2, 0, 0]}
          fontSize={Math.min(widthM * 0.16, 0.45)}
          color="#111827"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.004}
          outlineColor="#ffffff"
        >
          {booth.standNumber}
        </Text>
      ) : null}

      {/* Footprint outline, so a stand reads even with no walls at all. */}
      <lineSegments position={[0, platformM + 0.004, 0]}>
        <edgesGeometry args={[new THREE.PlaneGeometry(widthM, depthM).rotateX(-Math.PI / 2)]} />
        <lineBasicMaterial color={hasError ? '#ef4444' : selected ? '#0072FD' : '#94a3b8'} />
      </lineSegments>
    </group>
  );
}
