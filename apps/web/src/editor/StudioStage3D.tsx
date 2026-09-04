import { useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { ContactShadows } from '@react-three/drei';
import * as THREE from 'three';
import { useEditor } from './editorStore';
import { useRendererProfile } from './rendererProfile';

/**
 * The room the plan sits in.
 *
 * A design tool's viewport is not a debug view. A flat fill with a grid ruled
 * across it reads as a wireframe editor from 1998, and — worse for the job —
 * gives a designer no sense of where anything actually is: a chair floating on
 * an infinite plane with a hard horizon could be any size, in any space.
 *
 * So the viewport is built as an **infinite-cyclorama photography studio**, the
 * same thing a product photographer builds out of a curved sweep of paper:
 *
 *  · a soft vertical gradient behind everything, brightest at the horizon,
 *  · a ground plane that catches shadows,
 *  · and a wide dissolve where the two meet, so there is no seam and no line to
 *    read as the edge of the world.
 *
 * Objects then sit *in* something. Their contact shadows tell you they are on
 * the floor rather than hovering, and the falloff toward the horizon gives the
 * eye the depth cue a flat fill cannot.
 *
 * All of it is procedural — one sphere, two planes and a generated 256 px
 * gradient — so it costs nothing to download and almost nothing to draw.
 */

/* ── The backdrop ──────────────────────────────────────────────────────── */

/**
 * A vertical gradient sphere around the whole scene.
 *
 * Rendered on the inside faces with depth writing off and a huge negative
 * render order, so it is painted first and never occludes anything. Three
 * stops rather than two: a cool zenith, a bright horizon band, and a slightly
 * deeper floor haze. The bright band at eye level is what makes it read as a
 * lit studio rather than a coloured void.
 */
function Backdrop({ zenith, horizon, ground }: { zenith: string; horizon: string; ground: string }) {
  const material = useMemo(() => {
    const uniforms = {
      uZenith: { value: new THREE.Color(zenith) },
      uHorizon: { value: new THREE.Color(horizon) },
      uGround: { value: new THREE.Color(ground) },
    };
    return new THREE.ShaderMaterial({
      uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uZenith;
        uniform vec3 uHorizon;
        uniform vec3 uGround;
        varying vec3 vWorld;

        void main() {
          // Height as a signed ratio of the sphere radius: -1 underfoot,
          // 0 at the horizon, +1 straight up.
          float h = clamp(normalize(vWorld).y, -1.0, 1.0);

          // Above the horizon: horizon → zenith, eased so the bright band is
          // tight to eye level rather than washing the whole sky out.
          vec3 sky = mix(uHorizon, uZenith, pow(max(h, 0.0), 0.55));
          // Below: horizon → floor haze, over a shorter distance.
          vec3 below = mix(uHorizon, uGround, pow(max(-h, 0.0), 0.8));

          gl_FragColor = vec4(h > 0.0 ? sky : below, 1.0);
          #include <colorspace_fragment>
        }
      `,
    });
  }, [zenith, horizon, ground]);

  useEffect(() => () => material.dispose(), [material]);

  return (
    <mesh material={material} renderOrder={-1000} raycast={() => null} frustumCulled={false}>
      <sphereGeometry args={[400, 32, 16]} />
    </mesh>
  );
}

/* ── The sweep ─────────────────────────────────────────────────────────── */

/**
 * A radial alpha ramp, generated once.
 *
 * Used to dissolve the ground into the backdrop. Drawn to a small canvas
 * because a 256 px gradient is exact, weighs nothing, and needs no asset —
 * and because doing it in a shader would mean a second material to keep in
 * step with the ground's own lighting.
 */
function useHorizonFade(color: string): THREE.Texture {
  return useMemo(() => {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      // Fully clear across the working area, then ramping to solid at the rim.
      gradient.addColorStop(0, 'rgba(0,0,0,0)');
      gradient.addColorStop(0.55, 'rgba(0,0,0,0)');
      gradient.addColorStop(0.82, 'rgba(0,0,0,0.75)');
      gradient.addColorStop(1, 'rgba(0,0,0,1)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);

      // Tint it with the backdrop colour so the dissolve lands on the same hue.
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, size, size);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, [color]);
}

/**
 * The floor, and the haze that hides where it ends.
 *
 * The ground is an ordinary lit plane so it receives shadows properly. The
 * dissolve is a second, unlit plane just above it carrying the radial ramp —
 * transparent in the middle where the work happens, solid at the rim where the
 * floor would otherwise meet the sky in a hard line.
 */
function StudioGround({
  color,
  roughness,
  fadeColor,
}: {
  color: string;
  roughness: number;
  fadeColor: string;
}) {
  const fade = useHorizonFade(fadeColor);
  useEffect(() => () => fade.dispose(), [fade]);

  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]} receiveShadow raycast={() => null}>
        <planeGeometry args={[600, 600]} />
        <meshStandardMaterial color={color} roughness={roughness} metalness={0} />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} renderOrder={-900} raycast={() => null}>
        <planeGeometry args={[600, 600]} />
        <meshBasicMaterial map={fade} transparent depthWrite={false} toneMapped={false} />
      </mesh>
    </>
  );
}

/* ── The stage ─────────────────────────────────────────────────────────── */

/**
 * Everything that makes the viewport a place rather than a background.
 *
 * Skipped entirely when the environment map is being shown as the background:
 * a real sky behind the room is the more convincing answer, and painting a
 * gradient over it would be both wrong and wasteful.
 */
export function StudioStage3D() {
  const lighting = useEditor((s) => s.scene.lighting);
  const render = useEditor((s) => s.scene.render);
  const objectCount = useEditor((s) => s.scene.objects.length);
  const profile = useRendererProfile();

  const showBackdrop = !lighting.showEnvironmentBackground;

  /*
   * The studio floor takes the plan's own floor finish.
   *
   * The finished floor is only ever as big as the plan — ten metres for a
   * single table — so surfacing the room in carpet used to leave a small
   * island of it sitting on a pale studio ground that stretched to the
   * horizon, and the room read as a diagram on a light box rather than a
   * floor. Taking the colour out to the horizon is what makes it a hall.
   */
  const floorFinish = useEditor((s) => s.scene.floorFinish);
  const ground = floorFinish?.colorHex ?? lighting.groundColor ?? '#c9ccd1';
  const groundRoughness = floorFinish?.roughness ?? 0.96;

  /*
   * The backdrop palette is derived from the ground colour rather than fixed,
   * so surfacing the room in dark carpet darkens the studio around it instead
   * of leaving a pale sky floating over a black floor.
   */
  const palette = useMemo(() => {
    const base = new THREE.Color(ground);
    const hsl = { h: 0, s: 0, l: 0 };
    base.getHSL(hsl);

    const shade = (lightness: number, saturation = hsl.s) =>
      `#${new THREE.Color().setHSL(hsl.h, saturation, THREE.MathUtils.clamp(lightness, 0, 1)).getHexString()}`;

    return {
      // Slightly deeper and cooler overhead, brightest at eye level, and a
      // touch under the horizon so the floor has somewhere to go.
      /*
       * A real gradient, not a hint of one. Overhead is meaningfully deeper and
       * cooler than the horizon band — that difference is the only depth cue a
       * backdrop has, and playing it too safe produces the flat white void the
       * cyclorama exists to avoid.
       */
      zenith: shade(hsl.l * 0.74, Math.min(1, hsl.s + 0.1)),
      horizon: shade(Math.min(1, hsl.l * 1.05 + 0.05), hsl.s * 0.45),
      below: shade(hsl.l * 0.82),
    };
  }, [ground]);

  /*
   * Contact shadows are the single most effective realism cue available and
   * one of the cheapest — but they are a render-to-texture pass, so they are
   * skipped on a software rasteriser and on an empty plan where they would
   * darken nothing.
   */
  const wantsContact = render.contactShadows && !profile.software && objectCount > 0;

  // Sized to the plan, for the same resolution reason as the shadow camera.
  const objects = useEditor((s) => s.scene.objects);
  const contactScale = useMemo(() => {
    let maxMm = 0;
    for (const object of objects) {
      const at = object.positionMm;
      maxMm = Math.max(maxMm, Math.abs(at?.x ?? 0), Math.abs(at?.z ?? 0));
    }
    return THREE.MathUtils.clamp((maxMm / 1000) * 2.8 + 8, 10, 90);
  }, [objects]);

  return (
    <>
      {showBackdrop ? (
        <>
          <Backdrop zenith={palette.zenith} horizon={palette.horizon} ground={palette.below} />
          <StudioGround color={ground} roughness={groundRoughness} fadeColor={palette.horizon} />
        </>
      ) : (
        // With a real sky behind the room the ground still has to exist, but it
        // gets the sky's own haze as its dissolve.
        <StudioGround color={ground} roughness={groundRoughness} fadeColor={palette.horizon} />
      )}

      {wantsContact ? (
        /*
         * Re-baked whenever the plan changes, and scaled to it.
         *
         * `frames={1}` renders the shadow pass exactly once — and models
         * stream in from the network well after that, so the one frame it
         * captured was of an empty floor and every object sat on nothing.
         * Keying on the object count remounts it, which is what makes the
         * shadows appear under things that arrived late.
         *
         * The scale used to be a fixed 90 m for the same reason the shadow
         * camera was: it is cheap to write and it throws away almost all of
         * the resolution. A single table now gets a shadow with an edge
         * rather than a grey haze.
         */
        <ContactShadows
          key={`${objectCount}`}
          position={[0, 0.006, 0]}
          scale={contactScale}
          resolution={1024}
          far={9}
          blur={2.2}
          opacity={0.55}
          color="#131c2b"
          frames={1}
        />
      ) : null}
    </>
  );
}

/**
 * Tone mapping, bound to the plan's exposure.
 *
 * Khronos PBR Neutral rather than ACES. ACES is a film look — it crushes
 * highlights and shifts hue, which is lovely for a hero render and wrong for a
 * tool where a client asks whether that is the exact fabric colour. Neutral was
 * designed for product viewers: it holds white points and hue, and only
 * compresses once a highlight would clip.
 */
export function ToneMapping() {
  const gl = useThree((s) => s.gl);
  const exposure = useEditor((s) => s.scene.render.exposure);
  const applied = useRef<number | null>(null);

  useEffect(() => {
    gl.toneMapping = THREE.NeutralToneMapping;
    gl.toneMappingExposure = exposure;
    if (applied.current !== exposure) {
      applied.current = exposure;
      // Materials compiled under the previous tone curve need recompiling.
      gl.shadowMap.needsUpdate = true;
    }
  }, [gl, exposure]);

  return null;
}
