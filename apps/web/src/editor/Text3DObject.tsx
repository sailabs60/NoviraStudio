import { Suspense, useCallback, useMemo } from 'react';
import { Text3D, useFont } from '@react-three/drei';
import * as THREE from 'three';
import { fontUrl, type Text3DSceneObject } from '@novira/shared';
import { useBrandMaterial } from './BrandMaterial';

/**
 * Dimensional lettering.
 *
 * Extrude and intrude are one signed depth rather than two modes. Positive
 * depth stands the letters proud of their backing; negative cuts them into it.
 * The renderer handles the sign by moving the letters behind the panel face and
 * darkening them, which reads as engraving without the cost and fragility of a
 * boolean subtraction on every keystroke.
 *
 * That trade is deliberate and worth being explicit about: a true CSG cut would
 * give a correct silhouette from a grazing angle, but it has to re-run whenever
 * the text, font, size or depth changes — which is continuously, while someone
 * is typing. An inset is exact from the front and from any normal viewing
 * angle, and it stays interactive.
 */

/** Millimetres to metres. */
const M = 0.001;

const LINE_BREAK = String.fromCharCode(10);

function TextMesh({ object, selected }: { object: Text3DSceneObject; selected: boolean }) {
  const engraved = object.depthMm < 0;
  const depth = Math.abs(object.depthMm);

  // Engraving cannot exceed the panel it is cut into, or the letters punch
  // straight through the back.
  const backingThickness = object.backing.thicknessMm;
  const cutDepth = engraved ? Math.min(depth, Math.max(1, backingThickness - 2)) : depth;

  const material = useBrandMaterial(
    engraved
      ? {
          ...object.material,
          // A cut face sits in shadow and catches less light than the panel
          // around it; without this the engraving reads as a sticker.
          roughness: Math.min(1, object.material.roughness + 0.2),
          emissiveIntensity: object.material.emissiveIntensity * 0.4,
        }
      : object.material,
    { side: THREE.DoubleSide }
  );

  const selectionMaterial = useMemo(() => {
    const m = material.clone();
    m.emissive = new THREE.Color('#0059C4');
    m.emissiveIntensity = Math.max(0.25, object.material.emissiveIntensity);
    return m;
  }, [material, object.material.emissiveIntensity]);

  const active = selected ? selectionMaterial : material;

  /*
   * Zero depth is a flat cut-out. TextGeometry with height 0 produces
   * degenerate side faces, so a hairline is used instead — it looks flat and
   * stays valid geometry.
   */
  const height = Math.max(cutDepth, 0.4) * M;

  // Sit the lettering on the front face of the panel, then push it back by its
  // own depth when engraved.
  const z = engraved ? backingThickness * M - cutDepth * M : backingThickness * M;

  /**
   * Align the lettering.
   *
   * TextGeometry lays glyphs out rightwards from the origin, so every string
   * hangs off to one side and a centred headline is not centred on anything.
   * The geometry has to exist before it can be measured, so this runs on the
   * mesh once it is built and shifts it by its own bounds — which also makes
   * rotation pivot around the middle of the words rather than their first
   * letter.
   */
  const alignGeometry = useCallback(
    (mesh: THREE.Mesh | null) => {
      if (!mesh?.geometry) return;
      mesh.geometry.computeBoundingBox();
      const box = mesh.geometry.boundingBox;
      if (!box) return;
      const width = box.max.x - box.min.x;
      const offset =
        object.alignment === 'center'
          ? -box.min.x - width / 2
          : object.alignment === 'right'
            ? -box.max.x
            : -box.min.x;
      mesh.geometry.translate(offset, 0, 0);
    },
    [object.alignment, object.content, object.font, object.sizeMm, object.letterSpacingMm]
  );

  return (
    <Text3D
      ref={alignGeometry}
      font={fontUrl(object.font)}
      size={object.sizeMm * M}
      height={height}
      curveSegments={object.curveSegments}
      bevelEnabled={object.bevelEnabled && !engraved}
      bevelSize={object.bevelSizeMm * M}
      bevelThickness={object.bevelThicknessMm * M}
      bevelSegments={object.bevelSegments}
      letterSpacing={object.letterSpacingMm * M}
      lineHeight={object.lineHeight}
      material={active}
      position={[0, 0, z]}
      castShadow
      receiveShadow
    >
      {object.content}
    </Text3D>
  );
}

/**
 * The panel behind the lettering.
 *
 * Forced on when the text is engraved — there is nothing to cut into
 * otherwise — and otherwise optional, which is the difference between
 * free-standing letters and a plaque.
 */
function Backing({ object }: { object: Text3DSceneObject }) {
  const material = useBrandMaterial(object.backing.material, { side: THREE.DoubleSide });

  // Approximate the text extents so the panel wraps the lettering. Measuring
  // the real geometry would need the font resolved first, and the difference is
  // not worth a second render pass while someone is typing.
  const lines = object.content.split('\n');
  const longest = Math.max(1, ...lines.map((l) => l.length));
  const width =
    longest * object.sizeMm * 0.62 +
    (longest - 1) * object.letterSpacingMm +
    object.backing.paddingMm * 2;
  const height =
    lines.length * object.sizeMm * object.lineHeight + object.backing.paddingMm * 2;

  const geometry = useMemo(() => {
    const radius = Math.min(
      object.backing.cornerRadiusMm,
      Math.min(width, height) / 2 - 1
    );
    if (radius <= 0) {
      return new THREE.BoxGeometry(width * M, height * M, object.backing.thicknessMm * M);
    }
    // Rounded corners via an extruded shape.
    const shape = new THREE.Shape();
    const w = width * M;
    const h = height * M;
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
    return new THREE.ExtrudeGeometry(shape, {
      depth: object.backing.thicknessMm * M,
      bevelEnabled: false,
      curveSegments: 6,
    });
  }, [width, height, object.backing.cornerRadiusMm, object.backing.thicknessMm]);

  /*
   * Sit the panel around the lettering.
   *
   * The text is aligned about the origin horizontally, so the panel follows
   * the same rule. Vertically the glyphs run from the baseline at y = 0 up to
   * roughly the cap height, with extra lines stacking downwards, so the panel
   * centres on the midpoint of that block rather than on the baseline.
   */
  const centreX =
    object.alignment === 'center'
      ? 0
      : object.alignment === 'right'
        ? -width * M * 0.5 + object.backing.paddingMm * M
        : width * M * 0.5 - object.backing.paddingMm * M;

  const topMm = object.sizeMm;
  const bottomMm = -(lines.length - 1) * object.sizeMm * object.lineHeight;
  const centreY = ((topMm + bottomMm) / 2) * M;

  return (
    <mesh
      geometry={geometry}
      material={material}
      position={[centreX, centreY, 0]}
      castShadow
      receiveShadow
    />
  );
}

export function Text3DObject({
  object,
  selected,
}: {
  object: Text3DSceneObject;
  selected: boolean;
}) {
  // Engraving needs something to engrave.
  const needsBacking = object.backing.enabled || object.depthMm < 0;

  /*
   * An invisible block covering where the lettering sits.
   *
   * Glyphs are thin, and the gaps between and inside letters are most of the
   * area they occupy — clicking an "H" between its uprights, or anywhere in an
   * "O", hit nothing at all and the object could not be selected. Since the
   * only way to edit lettering is to select it first, that made text in a
   * scene effectively uneditable.
   *
   * The extents are approximated from the font metrics rather than measured,
   * because measuring needs the geometry, and the geometry is what this exists
   * to stand in for while it loads.
   */
  const lines = object.content.split(LINE_BREAK);
  const longest = Math.max(1, ...lines.map((l) => l.length));
  const pickWidth =
    (longest * object.sizeMm * 0.62 + (longest - 1) * object.letterSpacingMm) * M;
  const pickHeight = lines.length * object.sizeMm * object.lineHeight * M;
  const pickDepth = Math.max(Math.abs(object.depthMm), 40) * M;

  const offsetX =
    object.alignment === 'center'
      ? 0
      : object.alignment === 'right'
        ? -pickWidth / 2
        : pickWidth / 2;
  const topMm = object.sizeMm;
  const bottomMm = -(lines.length - 1) * object.sizeMm * object.lineHeight;
  const offsetY = ((topMm + bottomMm) / 2) * M;

  return (
    <group>
      {needsBacking ? <Backing object={object} /> : null}

      <mesh position={[offsetX, offsetY, (object.backing.thicknessMm * M) / 2]}>
        <boxGeometry args={[pickWidth, pickHeight, pickDepth]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      <Suspense fallback={null}>
        <TextMesh object={object} selected={selected} />
      </Suspense>
    </group>
  );
}

/** Warm the font cache so the first placement does not pop in. */
export function preloadBrandFont(font: Parameters<typeof fontUrl>[0]) {
  useFont.preload(fontUrl(font));
}
