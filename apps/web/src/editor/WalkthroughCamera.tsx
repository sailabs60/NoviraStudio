import { useEffect, useRef } from 'react';
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

  const { camera } = useThree();
  const last = useRef<number>(0);
  const wasPlaying = useRef(false);

  useEffect(() => {
    const controls = orbitRef.current;
    if (!controls) return;

    if (playing) {
      controls.enabled = false;
      wasPlaying.current = true;
      last.current = performance.now();
    } else if (wasPlaying.current) {
      wasPlaying.current = false;
      // Hand the camera back where it is actually looking, so the next drag
      // continues from the shot rather than snapping to the old target.
      const direction = new THREE.Vector3();
      camera.getWorldDirection(direction);
      controls.target.copy(camera.position.clone().add(direction.multiplyScalar(8)));
      controls.enabled = true;
      controls.update();
    }
  }, [playing, orbitRef, camera]);

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

    const controls = orbitRef.current;
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
  }, [playing, playhead, shots, camera, invalidate, orbitRef]);

  return null;
}
