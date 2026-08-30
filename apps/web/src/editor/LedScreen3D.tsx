import { useEffect, useMemo, useState } from 'react';
import { invalidate } from '@react-three/fiber';
import * as THREE from 'three';
import { deriveLedScreen, mmToWorld, type LedScreenSceneObject } from '@novira/shared';

/**
 * LED screen geometry.
 *
 * Three things have to be true for a screen to read correctly in a plan:
 *
 * 1. **It is built from cabinets.** The panel grid is drawn, because that is
 *    what makes a 20 × 11 wall obviously different from a 20 × 12 one — and
 *    the cabinet count is what the hire invoice is based on.
 * 2. **It emits light.** A screen that is merely a bright rectangle sits in the
 *    scene like a poster. The emissive material plus a light in front of it is
 *    what makes the room look lit *by* the screen, which is most of why a
 *    render of an event with LED looks like the event.
 * 3. **A curve is a curve, not a bend.** Cabinets are flat, so a curved wall is
 *    faceted — one flat panel per column, rotated. Drawing it as a smooth arc
 *    would promise a shape the hardware cannot make.
 */

interface Props {
  screen: LedScreenSceneObject;
  selected: boolean;
}

export function LedScreen3D({ screen, selected }: Props) {
  const derived = useMemo(() => deriveLedScreen(screen), [screen]);
  const panel = derived.panel;

  const cabinetW = mmToWorld(panel.widthMm);
  const cabinetH = mmToWorld(panel.heightMm);
  const depth = mmToWorld(panel.depthMm);
  const bottom = mmToWorld(screen.bottomMm);
  const totalW = cabinetW * screen.columns;
  const totalH = cabinetH * screen.rows;

  /*
   * Faceting. The whole wall subtends `curveDeg`, so each column is rotated by
   * a share of it and pushed out along the resulting radius. Radius is derived
   * from the chord rather than picked, so the ends of a curved wall land where
   * they would if it were actually built.
   */
  const curve = Math.max(-90, Math.min(90, screen.curveDeg || 0));
  const columns = useMemo(() => {
    const list: Array<{ x: number; z: number; rotY: number }> = [];
    if (Math.abs(curve) < 0.5) {
      for (let c = 0; c < screen.columns; c += 1) {
        list.push({ x: -totalW / 2 + cabinetW * (c + 0.5), z: 0, rotY: 0 });
      }
      return list;
    }

    const radians = (curve * Math.PI) / 180;
    const radius = totalW / (2 * Math.sin(radians / 2));
    for (let c = 0; c < screen.columns; c += 1) {
      const t = (c + 0.5) / screen.columns - 0.5;
      const angle = radians * t;
      list.push({
        x: Math.sin(angle) * radius,
        // Pull the arc back so the wall's centre stays on the object origin.
        z: radius * (1 - Math.cos(angle)) * Math.sign(radius),
        rotY: -angle,
      });
    }
    return list;
  }, [curve, screen.columns, totalW, cabinetW]);

  const emissiveColor = selected ? '#7c83f5' : screen.contentColor || '#0b1220';
  const glow = Math.max(0, Math.min(3, screen.glowIntensity ?? 0.6)) * (screen.brightness ?? 0.8);

  return (
    <group position={[0, bottom, 0]}>
      {/* Cabinets. One mesh per column, subdivided by rows for the grid seam. */}
      {columns.map((column, c) =>
        Array.from({ length: screen.rows }).map((_, r) => (
          <group
            key={`cab-${c}-${r}`}
            position={[column.x, cabinetH * (r + 0.5), column.z]}
            rotation={[0, column.rotY, 0]}
          >
            {/* The cabinet body: dark, matte, and slightly larger than the face
                so the seams between cabinets read as physical gaps. */}
            <mesh castShadow receiveShadow position={[0, 0, -depth / 2]} userData={{ part: 'cabinets' }}>
              <boxGeometry args={[cabinetW * 0.995, cabinetH * 0.995, depth]} />
              <meshStandardMaterial color="#15181d" roughness={0.85} metalness={0.2} />
            </mesh>
            {/* The emitting face. */}
            <mesh position={[0, 0, 0.002]} userData={{ part: 'screen-face' }}>
              <planeGeometry args={[cabinetW * 0.985, cabinetH * 0.985]} />
              <meshStandardMaterial
                color={emissiveColor}
                emissive={emissiveColor}
                emissiveIntensity={glow}
                toneMapped={false}
                roughness={0.4}
              />
            </mesh>
          </group>
        ))
      )}

      {/* Content, drawn across the whole wall rather than per cabinet. */}
      {screen.contentUrl ? (
        <ScreenContent
          url={screen.contentUrl}
          widthM={totalW}
          heightM={totalH}
          glow={glow}
          curved={Math.abs(curve) >= 0.5}
        />
      ) : null}

      {/*
        The light the screen casts. A rectangle area light would be correct and
        is not supported by the standard renderer, so this is a wide, soft point
        light at the screen's centre, pushed forward so it lights the room and
        not the wall behind it.
      */}
      {glow > 0.05 ? (
        <pointLight
          position={[0, totalH / 2, mmToWorld(600)]}
          intensity={glow * Math.min(6, derived.areaSqM * 0.12)}
          distance={Math.max(8, derived.areaSqM * 0.6)}
          decay={2}
          color={emissiveColor}
        />
      ) : null}

      {/* Ground support frame, drawn only when there is one. */}
      {screen.frame === 'ground-support' ? (
        <group>
          {[-1, 1].map((side) => (
            <mesh
              key={`leg-${side}`}
              position={[(side * totalW) / 2 - side * cabinetW * 0.15, -bottom / 2, -depth - 0.12]}
              castShadow
              userData={{ part: 'support-frame' }}
            >
              <boxGeometry args={[0.1, Math.max(0.1, bottom + totalH), 0.1]} />
              <meshStandardMaterial color="#4b5058" metalness={0.7} roughness={0.4} />
            </mesh>
          ))}
          {/* The ballast feet, which is what actually keeps it upright. */}
          {[-1, 1].map((side) => (
            <mesh
              key={`foot-${side}`}
              position={[(side * totalW) / 2, -bottom + 0.04, -depth - 0.5]}
              castShadow
              userData={{ part: 'ballast' }}
            >
              <boxGeometry args={[0.6, 0.08, 1.4]} />
              <meshStandardMaterial color="#33373d" roughness={0.7} />
            </mesh>
          ))}
        </group>
      ) : null}

      {/* Flying bar. */}
      {screen.frame === 'flown' ? (
        <mesh position={[0, totalH + 0.15, -depth / 2]} castShadow userData={{ part: 'flying-bar' }}>
          <boxGeometry args={[totalW + 0.4, 0.18, 0.18]} />
          <meshStandardMaterial color="#5b6270" metalness={0.8} roughness={0.35} />
        </mesh>
      ) : null}

      {selected ? (
        <mesh position={[0, totalH / 2, depth * 0.6]} userData={{ helper: true }}>
          <planeGeometry args={[totalW + 0.1, totalH + 0.1]} />
          <meshBasicMaterial color="#0072FD" transparent opacity={0.12} side={THREE.DoubleSide} />
        </mesh>
      ) : null}
    </group>
  );
}

/**
 * The image on the screen.
 *
 * Drawn as one plane across the whole wall rather than tiled per cabinet,
 * because content on a real wall spans the cabinets — tiling it would put a
 * copy of the logo in every panel, which is the thing that never happens.
 *
 * On a curved wall the plane is subdivided so it follows the facets
 * approximately; a flat plane across a 24° curve would visibly float away from
 * the cabinets at the ends.
 *
 * **Loaded by hand, never through `useLoader`.** That hook works by throwing a
 * promise for Suspense to catch, and when the promise *rejects* — a typo in a
 * pasted URL, a link that turns out to be an HTML page, a host that refuses
 * hotlinking — the rejection escapes the Suspense boundary as an uncaught
 * error, unmounts the Canvas and takes the WebGL context with it. Pasting a bad
 * link should leave a blank screen and nothing else; instead it destroyed the
 * scene. It also caches the failure globally, so the same URL could never be
 * retried without a reload.
 *
 * The texture is also released on unmount. A designer trying four images in a
 * row would otherwise leak four full-size textures onto the GPU.
 */
function ScreenContent({
  url,
  widthM,
  heightM,
  glow,
  curved,
}: {
  url: string;
  widthM: number;
  heightM: number;
  glow: number;
  curved: boolean;
}) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    let cancelled = false;
    let loaded: THREE.Texture | null = null;

    const loader = new THREE.TextureLoader();
    /*
     * Anonymous CORS so the canvas is not tainted. A tainted canvas silently
     * breaks PDF export, the plan thumbnail and AI Enhance — all of which read
     * pixels back — so an image that cannot be fetched this way is better not
     * shown at all. The builder imports content onto our own host precisely so
     * this always succeeds.
     */
    loader.setCrossOrigin('anonymous');

    loader.load(
      url,
      (result) => {
        if (cancelled) {
          result.dispose();
          return;
        }
        result.colorSpace = THREE.SRGBColorSpace;
        result.anisotropy = 4;
        loaded = result;
        setTexture(result);
        // The viewport draws on demand; an image arriving is a change React
        // never sees.
        invalidate();
      },
      undefined,
      () => {
        if (!cancelled) setTexture(null);
      }
    );

    return () => {
      cancelled = true;
      loaded?.dispose();
    };
  }, [url]);

  if (!texture) return null;

  return (
    <mesh position={[0, heightM / 2, 0.006]} userData={{ part: 'screen-content' }}>
      <planeGeometry args={[widthM * 0.985, heightM * 0.985, curved ? 24 : 1, 1]} />
      <meshStandardMaterial
        map={texture}
        emissiveMap={texture}
        emissive="#ffffff"
        emissiveIntensity={Math.max(0.35, glow)}
        toneMapped={false}
      />
    </mesh>
  );
}
