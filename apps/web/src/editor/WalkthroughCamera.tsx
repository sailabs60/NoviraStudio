import { useCallback, useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { mmToWorld, sampleWalkthrough, walkthroughDuration } from '@novira/shared';
import { useEditor } from './editorStore';

/**
 * Walkthrough playback.
 *
 * Drives the camera from the shot list while the walkthrough is playing, and
 * gets entirely out of the way when it is not.
 *
 * Two details make this work rather than fight the viewport:
 *
 * **OrbitControls is disabled during playback and restored afterwards.** The
 * controls write their own spherical position back to the camera every frame,
 * so a camera moved behind their back snaps straight back — the same trap the
 * Fit control fell into. Disabling them hands the camera over cleanly.
 *
 * **The controls' target is set on stop, not the camera position.** Handing
 * back a camera the controls did not place would make the first orbit drag
 * jump. Setting the target to wherever the last frame was looking makes the
 * handover invisible.
 */
export function WalkthroughCamera({ orbitRef }: { orbitRef: React.MutableRefObject<any> }) {
  const playing = useEditor((s) => s.playing);
  const playhead = useEditor((s) => s.playhead);
  const shots = useEditor((s) => s.scene.walkthrough.shots);
  const loop = useEditor((s) => s.scene.walkthrough.loop);
  const setPlayhead = useEditor((s) => s.setPlayhead);
  const setPlaying = useEditor((s) => s.setPlaying);

  const { camera, invalidate } = useThree();
  const last = useRef<number>(0);
  const wasPlaying = useRef(false);

  /**
   * Give the camera back.
   *
   * Re-aims the orbit target at whatever the camera is actually looking at, so
   * the next drag continues from the shot instead of swinging back to wherever
   * the target was before playback started.
   */
  const release = useCallback(() => {
    const controls = orbitRef.current;
    if (!controls) return;
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    controls.target.copy(camera.position.clone().add(direction.multiplyScalar(8)));
    controls.enabled = true;
    controls.update();
    invalidate();
  }, [orbitRef, camera]);

  useEffect(() => {
    const controls = orbitRef.current;
    if (!controls) return;

    if (playing) {
      controls.enabled = false;
      wasPlaying.current = true;
      last.current = performance.now();
      return;
    }

    /*
     * Release unconditionally when not playing.
     *
     * This used to be guarded by `wasPlaying`, on the reasoning that there is
     * nothing to hand back if playback never started. That was wrong, and it
     * is how the viewport froze: *scrubbing* the timeline, or clicking a shot,
     * disables the controls to place the camera without ever setting `playing`
     * to true — so the guard was false, the controls were never re-enabled,
     * and orbit, pan and zoom were dead until the page was reloaded.
     *
     * Re-enabling controls that are already enabled costs nothing, so the safe
     * version is simply to do it whenever playback is not running.
     */
    wasPlaying.current = false;
    if (!controls.enabled) release();
  }, [playing, orbitRef, release]);

  /*
   * And on the way out.
   *
   * Leaving the Video tab unmounts this component, and if it unmounts while
   * the camera is held — mid-playback, or straight after a scrub — nothing
   * else would ever hand it back. The controls belong to the viewport, not to
   * this panel, so whatever state they were left in has to be undone here.
   */
  useEffect(() => () => {
    const controls = orbitRef.current;
    if (controls && !controls.enabled) {
      controls.enabled = true;
      controls.update?.();
    }
  }, [orbitRef]);

  useFrame(() => {
    if (!playing || !shots.length) return;

    const now = performance.now();
    const delta = Math.min(120, now - last.current);
    last.current = now;

    const total = walkthroughDuration(shots);
    let next = playhead + delta;
    if (next >= total) {
      if (loop) {
        next = 0;
      } else {
        next = total;
        setPlaying(false);
      }
    }
    setPlayhead(next);

    const sample = sampleWalkthrough(shots, next);
    if (!sample) return;

    camera.position.set(
      mmToWorld(sample.positionMm.x),
      mmToWorld(sample.positionMm.y),
      mmToWorld(sample.positionMm.z)
    );
    camera.lookAt(
      mmToWorld(sample.targetMm.x),
      mmToWorld(sample.targetMm.y),
      mmToWorld(sample.targetMm.z)
    );
    const perspective = camera as THREE.PerspectiveCamera;
    if (perspective.isPerspectiveCamera && Math.abs(perspective.fov - sample.fov) > 0.01) {
      perspective.fov = sample.fov;
      perspective.updateProjectionMatrix();
    }
  });

  return null;
}

/**
 * Move the camera to one frame of the walkthrough, without playing it.
 *
 * Used by the shot list — clicking a shot should show it — and by the offline
 * frame renderer, which steps the camera and captures one frame at a time.
 */
export function useWalkthroughScrub() {
  const setPlayhead = useEditor((s) => s.setPlayhead);
  const setPlaying = useEditor((s) => s.setPlaying);
  return (timeMs: number) => {
    setPlaying(false);
    setPlayhead(timeMs);
  };
}

/**
 * Apply one walkthrough frame to the camera immediately.
 *
 * Separate from playback because the video renderer needs to place the camera,
 * wait for the frame to be drawn, and read the canvas — a loop that cannot run
 * inside `useFrame` and must not be at the mercy of wall-clock timing.
 */
export function ScrubDriver({ orbitRef }: { orbitRef: React.MutableRefObject<any> }) {
  const playing = useEditor((s) => s.playing);
  const playhead = useEditor((s) => s.playhead);
  const shots = useEditor((s) => s.scene.walkthrough.shots);
  const { camera, invalidate } = useThree();

  useEffect(() => {
    if (playing || !shots.length) return;
    const sample = sampleWalkthrough(shots, playhead);
    if (!sample) return;

    /*
     * The controls are switched off only while the camera is being placed.
     *
     * OrbitControls would otherwise fight the assignment and snap the camera
     * back on its next update. Leaving them off afterwards is what froze the
     * viewport, so this is a momentary hold that the cleanup below always
     * undoes — including when the component unmounts mid-scrub.
     */
    const controls = orbitRef.current;
    const wasEnabled = controls ? controls.enabled : false;
    if (controls) controls.enabled = false;

    camera.position.set(
      mmToWorld(sample.positionMm.x),
      mmToWorld(sample.positionMm.y),
      mmToWorld(sample.positionMm.z)
    );
    camera.lookAt(
      mmToWorld(sample.targetMm.x),
      mmToWorld(sample.targetMm.y),
      mmToWorld(sample.targetMm.z)
    );
    const perspective = camera as THREE.PerspectiveCamera;
    if (perspective.isPerspectiveCamera) {
      perspective.fov = sample.fov;
      perspective.updateProjectionMatrix();
    }
    invalidate();

    return () => {
      if (controls && wasEnabled) {
        controls.enabled = true;
        controls.update?.();
      }
    };
  }, [playing, playhead, shots, camera, invalidate, orbitRef]);

  return null;
}
