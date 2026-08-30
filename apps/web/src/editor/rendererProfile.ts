import { useEffect, useState } from 'react';
import { useThree } from '@react-three/fiber';

/**
 * What this machine's renderer can actually do.
 *
 * The product already asks this question before loading image-based lighting,
 * for a good reason: on a software rasteriser, building a PMREM cubemap takes
 * the tab down. The same reasoning applies to the other expensive thing in the
 * frame — **shadow maps** — and the consequence of ignoring it is subtler and
 * therefore worse.
 *
 * Measured on a headless Chromium falling back to SwiftShader, a 26-object plan
 * with a 1024² shadow map rendered at 2 frames per second, with individual
 * frames taking over three seconds. The editor was not broken in any way a log
 * would show; it was simply unusable, and every click appeared to do nothing.
 *
 * A machine without a working GPU is exactly the machine the brief's "usable by
 * all kinds of users" is about — a laptop in a venue, a locked-down office
 * build, a remote desktop. So the renderer is asked what it is, and the frame
 * is made cheap enough to stay interactive when the answer is "software".
 * Losing a shadow is acceptable; losing the session is not.
 */
export interface RendererProfile {
  checked: boolean;
  /** True when WebGL is running on the CPU rather than a GPU. */
  software: boolean;
  /** The renderer string, where the driver reports one. */
  renderer: string;
  /** Shadow map resolution this machine should use, or 0 for no shadows. */
  shadowMapSize: number;
}

const UNKNOWN: RendererProfile = { checked: false, software: false, renderer: '', shadowMapSize: 1024 };

export function useRendererProfile(): RendererProfile {
  const gl = useThree((s) => s.gl);
  const [profile, setProfile] = useState<RendererProfile>(UNKNOWN);

  useEffect(() => {
    try {
      const context = gl.getContext();
      const debugInfo = context.getExtension('WEBGL_debug_renderer_info');
      const renderer = debugInfo
        ? String(context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) ?? '')
        : '';

      /*
       * The same detection the environment loader uses. SwiftShader, llvmpipe,
       * Mesa softpipe and ANGLE's software path all name themselves here.
       */
      const software = /swiftshader|llvmpipe|softpipe|software|microsoft basic/i.test(renderer);

      setProfile({
        checked: true,
        software,
        renderer,
        // Zero means "do not render shadows at all". A smaller map would still
        // cost a full extra scene pass, which is the expensive part.
        shadowMapSize: software ? 0 : 1024,
      });
    } catch {
      // A driver that will not answer is treated as capable: the previous
      // behaviour, and the common case is simply a browser withholding the
      // debug extension for fingerprinting reasons.
      setProfile({ checked: true, software: false, renderer: '', shadowMapSize: 1024 });
    }
  }, [gl]);

  return profile;
}

/**
 * The same question, outside the render loop.
 *
 * `<Canvas>` needs its pixel ratio before react-three-fiber exists, so this
 * probes a throwaway context. It is called once at module scope by the
 * viewport and the result cached — creating WebGL contexts is not free, and a
 * browser will start dropping the oldest one if you make many.
 */
let cached: boolean | null = null;

export function isSoftwareRenderer(): boolean {
  if (cached !== null) return cached;
  try {
    const canvas = document.createElement('canvas');
    const context = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (!context) {
      cached = true;
      return cached;
    }
    const debugInfo = context.getExtension('WEBGL_debug_renderer_info');
    const renderer = debugInfo ? String(context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) ?? '') : '';
    cached = /swiftshader|llvmpipe|softpipe|software|microsoft basic/i.test(renderer);
    // Release it immediately rather than waiting for garbage collection.
    context.getExtension('WEBGL_lose_context')?.loseContext();
    return cached;
  } catch {
    cached = false;
    return cached;
  }
}
