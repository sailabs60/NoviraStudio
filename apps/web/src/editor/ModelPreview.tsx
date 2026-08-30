import { Suspense, useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { ContactShadows, Environment, OrbitControls, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import {
  AlertCircle,
  Box,
  Download,
  ExternalLink,
  Loader2,
  Maximize2,
  MousePointer2,
  Plus,
} from 'lucide-react';
import { Modal } from '../components/Modal';
import { ModelBoundary } from './ModelBoundary';
import { isSoftwareRenderer } from './rendererProfile';
import { proxied } from '../lib/assetsApi';

/**
 * Looking at a model before you commit to it.
 *
 * A thumbnail tells you what something looks like from one angle a stranger
 * chose. For a 3D asset that is not enough to decide with: you cannot see
 * whether the back is modelled, whether the proportions are right, whether it
 * is one chair or a chair and a floor plane welded together. A designer finds
 * all of that out after placing it, moving the camera, and undoing.
 *
 * So the preview is a real viewer — the actual file, orbitable, on a studio
 * backdrop, with its measurements next to it and the actions that matter under
 * that. Three details make it usable rather than merely present:
 *
 *  · **The model is normalised.** Centred on its own footprint, sat on the
 *    ground, and scaled so its longest edge is one unit. Files arrive at wildly
 *    different scales and origins; without this half of them appear as a speck
 *    or as a wall of texture.
 *  · **Materials are copied, not shared.** The preview must not mutate a model
 *    that is also in the plan.
 *  · **A software renderer gets the thumbnail instead.** Spinning up a second
 *    WebGL context on a machine that is already struggling with the first one
 *    is how you lose both.
 */

export interface PreviewSubject {
  /** The glTF/GLB to show. Null falls back to the image. */
  modelUrl?: string | null;
  /** Shown for a 2D result, and as the fallback for a model. */
  imageUrl?: string | null;
  name: string;
  description?: string | null;
  sourceLabel?: string | null;
  license?: string | null;
  attribution?: string | null;
  /** Where the asset lives, if it is not ours. */
  externalUrl?: string | null;
  /** Real dimensions, where they are known. */
  dimensionsMm?: { width?: number | null; depth?: number | null; height?: number | null } | null;
  meta?: Array<{ label: string; value: string }>;
}

export function ModelPreview({
  open,
  subject,
  onClose,
  onAdd,
  addLabel = 'Add to the plan',
  busy,
}: {
  open: boolean;
  subject: PreviewSubject | null;
  onClose: () => void;
  onAdd?: () => void;
  addLabel?: string;
  busy?: boolean;
}) {
  if (!subject) return null;

  const isImage = !subject.modelUrl && Boolean(subject.imageUrl);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={subject.name}
      description={subject.description ?? undefined}
      width="max-w-4xl"
      footer={
        <>
          {subject.externalUrl ? (
            <a
              href={subject.externalUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="btn-ghost mr-auto"
            >
              <ExternalLink className="h-4 w-4" /> Open on the source site
            </a>
          ) : null}
          {subject.modelUrl || subject.imageUrl ? (
            <a
              href={subject.modelUrl ?? subject.imageUrl ?? '#'}
              download
              className="btn-secondary"
            >
              <Download className="h-4 w-4" /> Download
            </a>
          ) : null}
          {onAdd ? (
            <button type="button" className="btn-primary" onClick={onAdd} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {busy ? 'Working…' : addLabel}
            </button>
          ) : null}
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
        {/* ── The viewer ─────────────────────────────────────────────── */}
        <div className="relative overflow-hidden rounded-xl border border-line bg-gradient-to-b from-surface-muted to-bg-soft">
          {isImage ? (
            <div className="flex aspect-[4/3] items-center justify-center p-4">
              <img
                src={subject.imageUrl ?? ''}
                alt={subject.name}
                className="max-h-full max-w-full rounded-lg object-contain shadow-card"
              />
            </div>
          ) : (
            <PreviewCanvas url={subject.modelUrl!} poster={subject.imageUrl ?? null} />
          )}
        </div>

        {/* ── What it is ─────────────────────────────────────────────── */}
        <div className="space-y-4 text-[13px]">
          {subject.dimensionsMm &&
          (subject.dimensionsMm.width || subject.dimensionsMm.height || subject.dimensionsMm.depth) ? (
            <section>
              <h3 className="ed-section-title">Real size</h3>
              <dl className="space-y-1">
                {(
                  [
                    ['Width', subject.dimensionsMm.width],
                    ['Depth', subject.dimensionsMm.depth],
                    ['Height', subject.dimensionsMm.height],
                  ] as const
                )
                  .filter(([, value]) => typeof value === 'number' && value > 0)
                  .map(([label, value]) => (
                    <div key={label} className="flex justify-between">
                      <dt className="text-ink-subtle">{label}</dt>
                      <dd className="font-semibold tabular-nums text-ink">{(value! / 1000).toFixed(2)} m</dd>
                    </div>
                  ))}
              </dl>
            </section>
          ) : null}

          {subject.meta?.length ? (
            <section>
              <h3 className="ed-section-title">Details</h3>
              <dl className="space-y-1">
                {subject.meta.map((row) => (
                  <div key={row.label} className="flex justify-between gap-3">
                    <dt className="shrink-0 text-ink-subtle">{row.label}</dt>
                    <dd className="min-w-0 truncate text-right font-semibold text-ink">{row.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}

          {subject.sourceLabel || subject.license || subject.attribution ? (
            <section>
              <h3 className="ed-section-title">Provenance</h3>
              <p className="text-[12px] leading-relaxed text-ink-muted">
                {subject.sourceLabel ? <span className="font-semibold text-ink">{subject.sourceLabel}</span> : null}
                {subject.license ? <> · {subject.license}</> : null}
              </p>
              {subject.attribution ? (
                <p className="mt-1 text-[11px] leading-relaxed text-ink-subtle">{subject.attribution}</p>
              ) : null}
              <p className="mt-2 text-[11px] leading-relaxed text-ink-subtle">
                Licence terms travel with the asset and appear on every export that uses it.
              </p>
            </section>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

/* ── The viewer itself ─────────────────────────────────────────────────── */

function PreviewCanvas({ url, poster }: { url: string; poster: string | null }) {
  const software = isSoftwareRenderer();
  const [failed, setFailed] = useState(false);

  /*
   * A machine with no GPU gets the still. It is already struggling with the
   * editor's own context, and opening a second one to spin a chair is how you
   * lose both — three.js drops the oldest context when the browser's budget
   * runs out.
   */
  if (software || failed) {
    return (
      <div className="flex aspect-[4/3] flex-col items-center justify-center gap-3 p-6 text-center">
        {poster ? (
          <img src={poster} alt="" className="max-h-full max-w-full rounded-lg object-contain shadow-card" />
        ) : (
          <>
            <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface text-ink-subtle">
              {failed ? <AlertCircle className="h-5 w-5" /> : <Box className="h-5 w-5" />}
            </span>
            <p className="text-xs font-semibold text-ink">
              {failed ? 'This model could not be opened' : 'Preview needs hardware graphics'}
            </p>
          </>
        )}
        <p className="max-w-[280px] text-[11px] leading-relaxed text-ink-subtle">
          {failed
            ? 'The file may have moved or be in a format the browser cannot read. It can still be downloaded.'
            : 'This machine is running WebGL on the processor, so a second 3D view is skipped to keep the editor responsive.'}
        </p>
      </div>
    );
  }

  return (
    <div className="relative aspect-[4/3]">
      <Canvas
        dpr={[1, 1.6]}
        shadows={false}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        camera={{ position: [2.6, 1.9, 2.6], fov: 38 }}
      >
        <ambientLight intensity={0.45} />
        <directionalLight position={[4, 6, 3]} intensity={1.1} />
        <ModelBoundary fallback={null} label={url} onError={() => setFailed(true)}>
          <Suspense fallback={null}>
            <NormalisedModel url={url} />
            <Environment preset="studio" environmentIntensity={0.9} />
            <ContactShadows position={[0, 0, 0]} opacity={0.35} scale={6} blur={2.2} far={4} color="#16202e" />
          </Suspense>
        </ModelBoundary>
        <OrbitControls
          makeDefault
          enablePan={false}
          autoRotate
          autoRotateSpeed={0.9}
          minDistance={1.4}
          maxDistance={7}
          minPolarAngle={0.15}
          maxPolarAngle={Math.PI / 2.05}
          target={[0, 0.45, 0]}
        />
      </Canvas>

      <span className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
        <span className="flex items-center gap-1.5 rounded-full bg-surface/85 px-2.5 py-1 text-[10px] font-semibold text-ink-subtle backdrop-blur">
          <MousePointer2 className="h-3 w-3" /> Drag to orbit · scroll to zoom
        </span>
      </span>
    </div>
  );
}

/**
 * The model, sat on the origin at a known size.
 *
 * Files arrive centred on anything and scaled to anything: metres, centimetres,
 * inches, or whatever the exporter's default happened to be. Normalising is
 * what makes one camera position work for every asset in the library instead of
 * showing half of them as a speck and the other half as a wall.
 */
function NormalisedModel({ url }: { url: string }) {
  const source = useMemo(() => proxied(url) ?? url, [url]);
  const { scene } = useGLTF(source, '/draco/');

  const instance = useMemo(() => {
    const clone = scene.clone(true);

    // Copy every material: the same glTF may be in the plan behind this dialog.
    clone.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.castShadow = true;
        node.receiveShadow = true;
        node.material = Array.isArray(node.material)
          ? node.material.map((m) => m.clone())
          : (node.material as THREE.Material).clone();
      }
    });

    const box = new THREE.Box3().setFromObject(clone);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());

    // Centre on X/Z, sit on Y, then scale the longest edge to one unit.
    clone.position.x -= centre.x;
    clone.position.z -= centre.z;
    clone.position.y -= box.min.y;

    const longest = Math.max(size.x, size.y, size.z);
    if (longest > 0 && Number.isFinite(longest)) {
      const scale = 1 / longest;
      clone.scale.setScalar(scale);
      clone.position.multiplyScalar(scale);
    }

    return clone;
  }, [scene]);

  useEffect(
    () => () => {
      instance.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          const material = node.material as THREE.Material | THREE.Material[];
          if (Array.isArray(material)) material.forEach((m) => m.dispose());
          else material.dispose();
        }
      });
    },
    [instance]
  );

  return <primitive object={instance} />;
}

/* ── Hover preview, for a grid of cards ────────────────────────────────── */

/**
 * A card that turns into a live 3D preview when the cursor rests on it.
 *
 * Deliberately not on hover-enter: a cursor crossing a grid of forty cards
 * would open forty WebGL contexts on the way past. A short dwell means it only
 * happens where someone actually stopped to look.
 *
 * Off entirely on a software renderer, for the same reason as the dialog.
 */
export function HoverModel({
  url,
  poster,
  alt,
  className,
  dwellMs = 420,
}: {
  url: string | null | undefined;
  poster: string | null | undefined;
  alt: string;
  className?: string;
  dwellMs?: number;
}) {
  const [live, setLive] = useState(false);
  const software = isSoftwareRenderer();
  const canPreview = Boolean(url) && !software;

  useEffect(() => {
    if (!live) return;
    // Stop the moment the card unmounts — a recycled grid row must not leave a
    // canvas behind it.
    return () => setLive(false);
  }, [live]);

  let timer: number | undefined;

  return (
    <div
      className={`relative overflow-hidden bg-surface-muted ${className ?? ''}`}
      onPointerEnter={() => {
        if (!canPreview) return;
        timer = window.setTimeout(() => setLive(true), dwellMs);
      }}
      onPointerLeave={() => {
        window.clearTimeout(timer);
        setLive(false);
      }}
    >
      {poster ? (
        <img
          src={poster}
          alt={alt}
          loading="lazy"
          decoding="async"
          className={`h-full w-full object-cover transition-opacity duration-200 ${live ? 'opacity-0' : 'opacity-100'}`}
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center">
          <Box className="h-5 w-5 text-ink-subtle/60" />
        </span>
      )}

      {live && url ? (
        <span className="absolute inset-0">
          <Canvas
            dpr={[1, 1.4]}
            gl={{ antialias: true, alpha: true }}
            camera={{ position: [2.2, 1.7, 2.2], fov: 38 }}
          >
            <ambientLight intensity={0.6} />
            <directionalLight position={[3, 5, 2]} intensity={1} />
            <ModelBoundary fallback={null} label={url}>
              <Suspense fallback={null}>
                <NormalisedModel url={url} />
                <Environment preset="studio" environmentIntensity={0.85} />
              </Suspense>
            </ModelBoundary>
            <OrbitControls
              makeDefault
              enablePan={false}
              enableZoom={false}
              autoRotate
              autoRotateSpeed={3.2}
              target={[0, 0.45, 0]}
            />
          </Canvas>
        </span>
      ) : null}

      {canPreview ? (
        <span className="pointer-events-none absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-md bg-surface/85 text-ink-subtle opacity-0 backdrop-blur transition group-hover:opacity-100">
          <Maximize2 className="h-3 w-3" />
        </span>
      ) : null}
    </div>
  );
}
