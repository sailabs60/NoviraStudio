import { Suspense, useMemo } from 'react';
import { useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import type { ArtworkSceneObject } from '@novira/shared';
import { useBrandMaterial } from './BrandMaterial';
import { ModelBoundary, useModelReachable } from './ModelBoundary';

/**
 * Artwork placed in the room.
 *
 * A printed graphic is a physical object at an event — it has a substrate with
 * a thickness, it catches light, and if it is a lightbox it emits some. So this
 * is a solid panel carrying the image rather than a floating quad, which is
 * what makes it read correctly next to furniture and cast a sensible shadow.
 *
 * `emitFromImage` is the feature worth calling out: it feeds the same texture
 * into the emissive channel, so a backlit print glows in its own colours
 * instead of being washed with one flat tint. That is the actual difference
 * between a lightbox and a panel with a lamp pointed at it.
 */

const M = 0.001;

function ArtworkPanel({
  object,
  selected,
}: {
  object: ArtworkSceneObject;
  selected: boolean;
}) {
  const texture = useLoader(THREE.TextureLoader, object.imageUrl);

  const faceMaterial = useBrandMaterial(object.material, {
    map: texture,
    emissiveMap: object.emitFromImage ? texture : null,
    side: object.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
  });

  // The substrate around the image: edges and back of the board.
  const bodyMaterial = useBrandMaterial(
    {
      ...object.material,
      // The reverse of a print is the substrate, not the artwork.
      color: object.doubleSided ? object.material.color : '#d9d5cd',
      emissiveIntensity: object.emitFromImage ? object.material.emissiveIntensity * 0.35 : 0,
    },
    { side: THREE.DoubleSide }
  );

  const geometry = useMemo(() => {
    const w = object.widthMm * M;
    const h = object.heightMm * M;
    const d = Math.max(object.thicknessMm, 0.5) * M;
    const radius = Math.min(object.cornerRadiusMm, Math.min(object.widthMm, object.heightMm) / 2 - 1);

    if (radius <= 0) return new THREE.BoxGeometry(w, h, d);

    const shape = new THREE.Shape();
    const r = radius * M;
    shape.moveTo(-w / 2 + r, -h / 2);
    shape.lineTo(w / 2 - r, -h / 2);
    shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
    shape.lineTo(w / 2, h / 2 - r);
    shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
    shape.lineTo(-w / 2 + r, h / 2);
    shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
    shape.lineTo(-w / 2, -h / 2 + r);
    shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
    return new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false, curveSegments: 8 });
  }, [object.widthMm, object.heightMm, object.thicknessMm, object.cornerRadiusMm]);

  const face = useMemo(() => {
    const m = faceMaterial.clone();
    m.transparent = m.transparent || object.useAlpha;
    m.alphaTest = object.useAlpha ? 0.02 : 0;
    if (selected) {
      m.emissive = new THREE.Color('#0059C4');
      m.emissiveIntensity = Math.max(0.22, object.material.emissiveIntensity);
    }
    return m;
  }, [faceMaterial, object.useAlpha, object.material.emissiveIntensity, selected]);

  const w = object.widthMm * M;
  const h = object.heightMm * M;
  const d = Math.max(object.thicknessMm, 0.5) * M;

  return (
    <group>
      {/* Substrate. */}
      <mesh geometry={geometry} material={bodyMaterial} castShadow receiveShadow />
      {/* The printed face, a hair proud of the board so it never z-fights. */}
      <mesh position={[0, 0, d + 0.0002]} receiveShadow>
        <planeGeometry args={[w, h]} />
        <primitive object={face} attach="material" />
      </mesh>
      {object.doubleSided ? (
        <mesh position={[0, 0, -0.0002]} rotation={[0, Math.PI, 0]} receiveShadow>
          <planeGeometry args={[w, h]} />
          <primitive object={face} attach="material" />
        </mesh>
      ) : null}
    </group>
  );
}

/** Shown before the image resolves, or when it cannot be fetched. */
function ArtworkPlaceholder({ object }: { object: ArtworkSceneObject }) {
  return (
    <mesh castShadow receiveShadow>
      <boxGeometry
        args={[
          object.widthMm * M,
          object.heightMm * M,
          Math.max(object.thicknessMm, 0.5) * M,
        ]}
      />
      <meshStandardMaterial color="#4a4a4a" roughness={0.9} />
    </mesh>
  );
}

export function ArtworkObject({
  object,
  selected,
}: {
  object: ArtworkSceneObject;
  selected: boolean;
}) {
  const reachable = useModelReachable(object.imageUrl || undefined);
  const placeholder = <ArtworkPlaceholder object={object} />;

  if (!object.imageUrl || reachable !== 'ok') return placeholder;

  return (
    <ModelBoundary fallback={placeholder} label={object.imageUrl}>
      <Suspense fallback={placeholder}>
        <ArtworkPanel object={object} selected={selected} />
      </Suspense>
    </ModelBoundary>
  );
}
