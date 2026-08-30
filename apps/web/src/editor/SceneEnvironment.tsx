import { Component, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Environment } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { LIGHTING_PRESETS, type LightingPresetKey } from '@novira/shared';

/**
 * Image-based lighting.
 *
 * ── The bug this exists to fix ──────────────────────────────────────────────
 *
 * `<Environment preset="sunset" />` fetches a multi-megabyte HDR from a CDN and
 * builds a PMREM cubemap from it. On a software WebGL backend that allocation
 * killed the renderer outright — the tab died with no recoverable error, so the
 * whole editor was unreachable.
 *
 * The first response was to delete IBL entirely and light the scene with three
 * analytic lights. That stopped the crash but threw away the realism that makes
 * a render worth showing a client.
 *
 * ── The actual fix ──────────────────────────────────────────────────────────
 *
 * Three things together:
 *
 *   1. **Serve the HDRs ourselves**, at 1k, from local storage — about 1.5 MB
 *      each rather than whatever a preset helper decides to pull, and no
 *      third-party CDN in the render path.
 *   2. **Ask the renderer what it can do** before loading one. A software
 *      rasteriser, a missing float-texture extension, or a small texture limit
 *      all mean IBL is a bad idea here, so we skip it deliberately instead of
 *      finding out by crashing.
 *   3. **Contain the failure.** An error boundary around the environment means
 *      that if it fails anyway, the scene keeps its analytic lighting and the
 *      user keeps working. Losing a reflection is acceptable; losing the tab is
 *      not.
 */

interface Capability {
  checked: boolean;
  ibl: boolean;
  reason: string;
}

/**
 * Decide whether this renderer should attempt image-based lighting.
 *
 * The check is conservative on purpose: false negatives cost a little realism,
 * false positives cost the session.
 */
function useIblCapability(): Capability {
  const gl = useThree((s) => s.gl);
  const [capability, setCapability] = useState<Capability>({
    checked: false,
    ibl: false,
    reason: 'not yet checked',
  });

  useEffect(() => {
    try {
      const context = gl.getContext();
      const debugInfo = context.getExtension('WEBGL_debug_renderer_info');
      const renderer = debugInfo
        ? String(context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) ?? '')
        : '';

      // SwiftShader, llvmpipe, Mesa softpipe and ANGLE's software path all
      // report themselves here. They can run WebGL, but PMREM generation on a
      // 1k HDR is exactly the workload that takes them down.
      const software = /swiftshader|llvmpipe|softpipe|software|microsoft basic/i.test(renderer);
      if (software) {
        setCapability({ checked: true, ibl: false, reason: `software renderer (${renderer})` });
        return;
      }

      // PMREM needs to render into a half-float target.
      const isWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && context instanceof WebGL2RenderingContext;
      const hasFloatTargets = isWebGL2
        ? Boolean(context.getExtension('EXT_color_buffer_half_float') || context.getExtension('EXT_color_buffer_float'))
        : Boolean(context.getExtension('OES_texture_half_float'));
      if (!hasFloatTargets) {
        setCapability({ checked: true, ibl: false, reason: 'no half-float render target support' });
        return;
      }

      const maxTexture = context.getParameter(context.MAX_TEXTURE_SIZE) as number;
      if (!maxTexture || maxTexture < 2048) {
        setCapability({ checked: true, ibl: false, reason: `texture limit too low (${maxTexture})` });
        return;
      }

      setCapability({ checked: true, ibl: true, reason: renderer || 'hardware renderer' });
    } catch (err) {
      setCapability({
        checked: true,
        ibl: false,
        reason: err instanceof Error ? err.message : 'capability check failed',
      });
    }
  }, [gl]);

  return capability;
}

/** Contains any failure inside the environment subtree. */
class EnvironmentBoundary extends Component<
  { children: ReactNode; onError: (message: string) => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    this.props.onError(error.message);
  }

  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

export interface EnvironmentStatus {
  active: boolean;
  reason: string;
}

/**
 * A generated environment for when IBL is unavailable.
 *
 * Without any environment, `scene.environment` is null and every metallic
 * material renders black — a polished brass monogram becomes a silhouette,
 * which is worse than wrong, it looks broken. `RoomEnvironment` is built in
 * memory from a handful of emissive boxes, so it costs no download and gives
 * metals and glass something to reflect on any renderer.
 *
 * It is deliberately not a substitute for a real HDRI — it is neutral studio
 * light, which is exactly what you want as a floor rather than a look.
 */
function GeneratedEnvironment({ intensity }: { intensity: number }) {
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    let texture: THREE.Texture | null = null;
    try {
      texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environment = texture;
      scene.environmentIntensity = intensity;
    } catch {
      // A renderer too limited even for this keeps analytic lighting only.
    }
    return () => {
      if (scene.environment === texture) scene.environment = null;
      texture?.dispose();
      pmrem.dispose();
    };
  }, [gl, scene, intensity]);

  return null;
}

export function SceneEnvironment({
  preset,
  customUrl = null,
  intensity = 0.7,
  background = false,
  rotationDeg = 0,
  onStatus,
}: {
  preset: LightingPresetKey;
  /**
   * An environment dragged in from an online library, already routed through
   * our proxy. It wins over the preset: a designer who has just dropped a
   * specific sky on the scene has said something more specific than the
   * dropdown can.
   */
  customUrl?: string | null;
  intensity?: number;
  /**
   * Show the map itself behind the room.
   *
   * A separate decision from using it as a light. It is the right answer for a
   * hero render and a distraction while laying out a floor, which is why the
   * studio backdrop takes over whenever this is off.
   */
  background?: boolean;
  /**
   * Rotation of the map around the vertical axis, in degrees — which is to say,
   * where the sun is. Without it you are stuck with wherever the photographer
   * happened to be standing.
   */
  rotationDeg?: number;
  onStatus?: (status: EnvironmentStatus) => void;
}) {
  const capability = useIblCapability();
  const [failure, setFailure] = useState<string | null>(null);

  const file = useMemo(
    () => LIGHTING_PRESETS.find((p) => p.key === preset)?.file ?? LIGHTING_PRESETS[0].file,
    [preset]
  );

  const source = customUrl || `/static/assets/hdri/${file}`;

  // Degrees in the document, radians in the scene. Y only: tilting an
  // environment map puts the horizon on a slant, which never looks like
  // anything but a mistake.
  const rotation = useMemo<[number, number, number]>(
    () => [0, (rotationDeg * Math.PI) / 180, 0],
    [rotationDeg]
  );

  // A custom map that fails must fall back to the shipped preset rather than
  // to no environment at all, so the failure is cleared when the source
  // changes and the boundary gets a fresh attempt.
  useEffect(() => {
    setFailure(null);
  }, [source]);

  const active = capability.checked && capability.ibl && !failure;

  useEffect(() => {
    if (!capability.checked) return;
    onStatus?.({
      active,
      reason: failure ? `environment failed to load: ${failure}` : capability.reason,
    });
  }, [active, capability, failure, onStatus]);

  // Never leave the scene with no environment at all: metals and glass need
  // something to reflect, even where a real HDRI cannot be used.
  if (!active) return <GeneratedEnvironment intensity={intensity} />;

  return (
    <EnvironmentBoundary onError={setFailure}>
      <Suspense fallback={null}>
        <Environment
          key={source}
          files={source}
          background={background}
          backgroundBlurriness={background ? 0.04 : 0}
          backgroundIntensity={intensity}
          environmentIntensity={intensity}
          environmentRotation={rotation}
          backgroundRotation={rotation}
        />
      </Suspense>
    </EnvironmentBoundary>
  );
}
