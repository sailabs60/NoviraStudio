import { useMemo } from 'react';
import * as THREE from 'three';
import type { BrandMaterial as BrandMaterialData } from '@novira/shared';

/**
 * One material for every branded surface.
 *
 * `MeshPhysicalMaterial` is the only three material that covers the whole range
 * a fabricator would quote — painted board, brushed brass, cast acrylic, glass,
 * and anything lit from within — so all the finishes resolve to one shader
 * rather than switching material classes and losing state between them.
 *
 * Two details matter and are easy to get wrong:
 *
 * - **Transmission needs `transparent`.** A physical material with transmission
 *   above zero still renders opaque unless it is in the transparent pass, so a
 *   "glass" finish silently looks like plastic.
 * - **Emission is not brightness.** `emissiveIntensity` above 1 only reads as a
 *   glow when the renderer has tone mapping and, ideally, a bloom pass. Below
 *   that it just washes the colour out, which is why the presets keep neon at
 *   about 3 rather than 10.
 */
export function useBrandMaterial(
  data: BrandMaterialData,
  options: { map?: THREE.Texture | null; emissiveMap?: THREE.Texture | null; side?: THREE.Side } = {}
) {
  const { map = null, emissiveMap = null, side = THREE.FrontSide } = options;

  return useMemo(() => {
    const transmissive = data.transmission > 0.001;
    const material = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(data.color),
      metalness: data.metalness,
      roughness: data.roughness,
      emissive: new THREE.Color(data.emissiveColor),
      emissiveIntensity: data.emissiveIntensity,
      transmission: data.transmission,
      // three works in metres; thickness is how far light travels in the body.
      thickness: data.thicknessMm / 1000,
      ior: data.ior,
      clearcoat: data.clearcoat,
      clearcoatRoughness: Math.min(1, data.roughness * 0.6),
      opacity: data.opacity,
      transparent: transmissive || data.opacity < 1,
      side,
    });

    if (map) {
      map.colorSpace = THREE.SRGBColorSpace;
      material.map = map;
    }
    if (emissiveMap) {
      emissiveMap.colorSpace = THREE.SRGBColorSpace;
      material.emissiveMap = emissiveMap;
      // An emissive map is modulated by the emissive colour, so a black
      // emissive would cancel the whole thing out.
      material.emissive = new THREE.Color('#ffffff');
    }

    return material;
  }, [
    data.color,
    data.metalness,
    data.roughness,
    data.emissiveColor,
    data.emissiveIntensity,
    data.transmission,
    data.thicknessMm,
    data.ior,
    data.clearcoat,
    data.opacity,
    map,
    emissiveMap,
    side,
  ]);
}
