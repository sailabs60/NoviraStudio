import { useEffect, useMemo, useRef, useState } from 'react';
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

  const bodiesRef = useRef<THREE.InstancedMesh>(null);
  const facesRef = useRef<THREE.InstancedMesh>(null);
  // Allocated up front: an instanced mesh cannot grow, so changing the wall's
  // size remounts it via the key rather than resizing the buffer in place.
  const cabinetCount = Math.max(1, screen.columns * screen.rows);
  const totalW = cabinetW * screen.columns;
  const totalH = cabinetH * screen.rows;

  /*
   * Faceting — how a curved LED wall is actually built.
   *
   * The cabinets are rigid. A curve is made by hanging them at a fixed
   * cabinet-to-cabinet angle so the wall approximates an arc, which is why the
   * geometry has to be laid out *along the arc* rather than across a chord.
   * The whole wall subtends `curveDeg`, so each of the N cabinets turns by
   * `curveDeg / N` from its neighbour and the arc length equals the wall's
   * real width — a 5 m wall is 5 m of cabinets whether it is curved or not.
   *
   * The previous version derived the radius from the chord and then placed
   * cabinets at `sin(angle) * radius`, which is the chord position. That made
   * the cabinets cover only ~81% of the wall's width at 60°, so they bunched up
   * and overlapped, and the ends never reached where the wall was meant to end.
   *
   * Sign convention: a positive angle curves the wall *towards* the viewer at
   * the ends (concave, wrapping the audience), which is the common event case.
   * `panelAngle` is exported to the content mesh so the image bends on exactly
   * the same arc rather than floating in front of the panels.
   */
  const curve = Math.max(-180, Math.min(180, screen.curveDeg || 0));
  const curved = Math.abs(curve) >= 0.5;

  const arc = useMemo(() => {
    const total = (curve * Math.PI) / 180;
    // Arc length is the wall width, so radius follows from r = s / theta.
    const radius = curved ? totalW / Math.abs(total) : 0;
    const perPanel = total / screen.columns;
    return { total, radius, perPanel };
  }, [curve, curved, totalW, screen.columns]);

  const columns = useMemo(() => {
    const list: Array<{ x: number; z: number; rotY: number }> = [];
    if (!curved) {
      for (let c = 0; c < screen.columns; c += 1) {
        list.push({ x: -totalW / 2 + cabinetW * (c + 0.5), z: 0, rotY: 0 });
      }
      return list;
    }

    const { radius, perPanel } = arc;
    const sign = Math.sign(curve) || 1;
    for (let c = 0; c < screen.columns; c += 1) {
      // Angle of this cabinet's centre, measured from the wall's centre.
      const angle = perPanel * (c + 0.5 - screen.columns / 2);
      list.push({
        // Position on the arc itself. `radius * sin` is the along-wall
        // distance and `radius * (1 - cos)` the depth, so the centre cabinet
        // stays on the origin and the ends sweep back symmetrically.
        x: radius * Math.sin(angle),
        z: sign * radius * (1 - Math.cos(angle)),
        // Each cabinet faces along the arc normal at its own position.
        rotY: -angle,
      });
    }
    return list;
  }, [curved, arc, curve, screen.columns, totalW, cabinetW]);

  const emissiveColor = selected ? '#7c83f5' : screen.contentColor || '#0b1220';
  const glow = Math.max(0, Math.min(3, screen.glowIntensity ?? 0.6)) * (screen.brightness ?? 0.8);

  /*
   * Place every cabinet.
   *
   * Instanced meshes carry their transforms in a matrix buffer rather than in
   * the React tree, so the positions that used to be props on 360 groups are
   * written here instead — once, whenever the wall's shape changes.
   */
  useEffect(() => {
    const bodies = bodiesRef.current;
    const faces = facesRef.current;
    if (!bodies || !faces) return;

    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const scale = new THREE.Vector3(1, 1, 1);
    const position = new THREE.Vector3();

    let i = 0;
    for (const column of columns) {
      for (let r = 0; r < screen.rows; r += 1) {
        euler.set(0, column.rotY, 0);
        quaternion.setFromEuler(euler);

        // The body sits half its depth behind the panel plane; the face a hair
        // in front of it. Both offsets are along the cabinet's own normal, so
        // they have to be rotated with it or a curved wall comes apart.
        const y = cabinetH * (r + 0.5);

        position.set(0, 0, -depth / 2).applyQuaternion(quaternion);
        matrix.compose(
          position.set(column.x + position.x, y, column.z + position.z),
          quaternion,
          scale
        );
        bodies.setMatrixAt(i, matrix);

        position.set(0, 0, 0.002).applyQuaternion(quaternion);
        matrix.compose(
          position.set(column.x + position.x, y, column.z + position.z),
          quaternion,
          scale
        );
        faces.setMatrixAt(i, matrix);

        i += 1;
      }
    }

    bodies.count = i;
    faces.count = i;
    bodies.instanceMatrix.needsUpdate = true;
    faces.instanceMatrix.needsUpdate = true;
    bodies.computeBoundingSphere();
    faces.computeBoundingSphere();
    invalidate();
  }, [columns, screen.rows, cabinetH, depth]);

  return (
    <group position={[0, bottom, 0]}>
      {/*
        Cabinets, drawn as two instanced meshes rather than two per panel.

        A 9 m wall is about 180 cabinets, and a mesh pair each made 364 meshes
        with 364 materials for a single scene object — enough on its own to
        drop a generated event to single-figure frame rates. Instancing draws
        every cabinet body in one call and every emitting face in another, with
        one material each, and the grid still reads correctly because each
        instance keeps its own transform.
      */}
      <instancedMesh
        key={`bodies-${cabinetCount}`}
        ref={bodiesRef}
        args={[undefined, undefined, cabinetCount]}
        castShadow
        receiveShadow
        userData={{ part: 'cabinets' }}
      >
        <boxGeometry args={[cabinetW * 0.995, cabinetH * 0.995, depth]} />
        <meshStandardMaterial color="#15181d" roughness={0.85} metalness={0.2} />
      </instancedMesh>

      <instancedMesh
        key={`faces-${cabinetCount}`}
        ref={facesRef}
        args={[undefined, undefined, cabinetCount]}
        userData={{ part: 'screen-face' }}
      >
        <planeGeometry args={[cabinetW * 0.985, cabinetH * 0.985]} />
        <meshStandardMaterial
          color={emissiveColor}
          emissive={emissiveColor}
          emissiveIntensity={glow}
          toneMapped={false}
          roughness={0.4}
        />
      </instancedMesh>

      {/* Content, drawn across the whole wall rather than per cabinet. */}
      {screen.contentUrl ? (
        <ScreenContent
          url={screen.contentUrl}
          widthM={totalW}
          heightM={totalH}
          glow={glow}
          curved={curved}
          radius={arc.radius}
          arcRad={arc.total}
          fit={screen.contentFit ?? 'cover'}
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
  radius,
  arcRad,
  fit,
}: {
  url: string;
  widthM: number;
  heightM: number;
  glow: number;
  curved: boolean;
  /** Radius of the wall's arc, in world units. Zero when flat. */
  radius: number;
  /** Total angle the wall subtends, in radians. Signed. */
  arcRad: number;
  /** How the image is mapped onto a wall of a different aspect ratio. */
  fit: 'cover' | 'contain' | 'stretch';
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

  /*
   * The image surface.
   *
   * A flat, subdivided plane was the bug: subdividing a plane adds vertices
   * but does not move them, so on a curved wall the image stayed dead flat
   * while the cabinets swept away behind it — the picture appeared to hang in
   * front of the screen and slide sideways as the curve increased.
   *
   * This builds the surface on the wall's own arc, so every vertex sits on the
   * cabinets. It is a cylinder wall rather than a plane, opened to exactly the
   * wall's angle, with UVs laid straight across it so the picture reads left to
   * right along the curve as it does on a real wall.
   */
  const geometry = useMemo(() => {
    const w = widthM * 0.985;
    const h = heightM * 0.985;
    if (!curved || radius <= 0 || Math.abs(arcRad) < 1e-4) {
      return new THREE.PlaneGeometry(w, h, 1, 1);
    }

    const segments = Math.max(8, Math.min(96, Math.ceil(Math.abs(arcRad) / 0.05)));
    const sign = Math.sign(arcRad) || 1;
    const geo = new THREE.PlaneGeometry(w, h, segments, 1);
    const pos = geo.attributes.position as THREE.BufferAttribute;

    for (let i = 0; i < pos.count; i += 1) {
      // Where this vertex sits across the wall, -0.5 .. 0.5.
      const t = pos.getX(i) / w;
      const angle = arcRad * t;
      pos.setX(i, radius * Math.sin(angle));
      // Matches the cabinet placement exactly, so the image lies on the panels
      // rather than in front of or behind them.
      pos.setZ(i, sign * radius * (1 - Math.cos(angle)));
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
  }, [curved, radius, arcRad, widthM, heightM]);

  // Geometry is built here, so it is this component's job to release it.
  useEffect(() => () => geometry.dispose(), [geometry]);

  /*
   * Aspect handling. A 16:9 image on a 3:1 wall has to do something, and the
   * three options are the ones any video system offers: fill and crop, letter-
   * box, or distort. `repeat`/`offset` crop in texture space, which costs
   * nothing and leaves the geometry alone.
   */
  useEffect(() => {
    if (!texture) return;
    const image = texture.image as { width?: number; height?: number } | undefined;
    const iw = image?.width ?? 1;
    const ih = image?.height ?? 1;
    if (!iw || !ih || fit === 'stretch') {
      texture.repeat.set(1, 1);
      texture.offset.set(0, 0);
    } else {
      const wallAspect = widthM / Math.max(0.0001, heightM);
      const imageAspect = iw / ih;
      const wider = imageAspect > wallAspect;
      const crop = fit === 'cover' ? wider : !wider;
      if (crop) {
        const r = wallAspect / imageAspect;
        texture.repeat.set(r, 1);
        texture.offset.set((1 - r) / 2, 0);
      } else {
        const r = imageAspect / wallAspect;
        texture.repeat.set(1, r);
        texture.offset.set(0, (1 - r) / 2);
      }
    }
    // 'contain' letterboxes, so the areas outside the image must not smear the
    // edge pixels across the rest of the wall.
    texture.wrapS = fit === 'contain' ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    texture.wrapT = texture.wrapS;
    texture.needsUpdate = true;
    invalidate();
  }, [texture, fit, widthM, heightM]);

  if (!texture) return null;

  return (
    <mesh
      position={[0, heightM / 2, 0.006]}
      geometry={geometry}
      userData={{ part: 'screen-content' }}
    >
      <meshStandardMaterial
        map={texture}
        emissiveMap={texture}
        emissive="#ffffff"
        emissiveIntensity={Math.max(0.35, glow)}
        toneMapped={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
