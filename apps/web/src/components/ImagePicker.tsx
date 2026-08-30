import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Link2, Loader2, Search, Sparkles, Upload, X } from 'lucide-react';
import { Modal } from './Modal';
import { LazyImage } from './LazyImage';
import { assets, proxied, type ProviderAsset } from '../lib/assetsApi';
import { useAssetFeed } from '../editor/useAssetFeed';
import { toast } from './ui';

/**
 * Choosing a picture, from anywhere.
 *
 * Every place in Novira that needs an image had grown its own answer: upload a
 * file here, paste a URL there, nothing at all somewhere else. Meanwhile the
 * platform already searches seventeen image libraries — Pinterest, Unsplash,
 * Pexels, Pixabay, Openverse and the rest — and none of that reached the
 * moments where a designer is actually looking for a reference.
 *
 * So this is one dialog, used everywhere: mood boards, style references for a
 * generation, printed graphics, deck covers, brand walls. Three ways in, in the
 * order people use them:
 *
 *  · **Search** the libraries. Pinterest first, because for *creative* work —
 *    "what should this look like" rather than "I need a photo of a chair" — a
 *    board of pins is what a designer would open anyway.
 *  · **Upload** a file they already have.
 *  · **Paste a link** to something on the web.
 *
 * A Pinterest pin is a reference, never a re-hosted asset. It carries its link
 * back to the pin, which is the attribution Pinterest asks for, and the row
 * says so.
 */

export interface PickedImage {
  /** A URL usable directly in an `<img>`; a data URL for an upload. */
  url: string;
  /** Routed through our proxy where the source refuses CORS. */
  safeUrl: string;
  name: string;
  width?: number | null;
  height?: number | null;
  sourceLabel?: string | null;
  sourceUrl?: string | null;
  license?: string | null;
  attribution?: string | null;
}

/**
 * The shelves this picker opens on.
 *
 * Creative work starts from a mood, not from a noun, so the defaults are moods:
 * a look, a material palette, a lighting idea. The search box handles the rest.
 *
 * Two or three words each, deliberately. The upstream libraries index by
 * subject and AND their terms together, so a well-written sentence returns
 * nothing at all — "event design mood board interior styling palette" finds
 * zero images where "mood board" finds two hundred. That is also why the empty
 * state tells people to use fewer words rather than different ones.
 */
const SHELVES = [
  { key: 'mood', label: 'Mood & style', query: 'mood board' },
  { key: 'stands', label: 'Stand design', query: 'exhibition stand' },
  { key: 'stage', label: 'Stage & set', query: 'stage design' },
  { key: 'lighting', label: 'Lighting', query: 'event lighting' },
  { key: 'styling', label: 'Styling & florals', query: 'event styling' },
  { key: 'interiors', label: 'Interiors', query: 'interior styling' },
  { key: 'branding', label: 'Branding', query: 'event branding' },
  { key: 'materials', label: 'Materials', query: 'material texture' },
] as const;

export function ImagePicker({
  open,
  onClose,
  onPick,
  title = 'Choose an image',
  description,
  /** Start on this search rather than the first shelf. */
  initialQuery,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (image: PickedImage) => void;
  title?: string;
  description?: string;
  initialQuery?: string;
}) {
  const [tab, setTab] = useState<'search' | 'upload' | 'link'>('search');
  const [shelf, setShelf] = useState<string>(SHELVES[0]!.key);
  const [rawSearch, setRawSearch] = useState(initialQuery ?? '');
  const search = useDebounced(rawSearch, 320);
  const [linkUrl, setLinkUrl] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const query = search.trim() || SHELVES.find((s) => s.key === shelf)?.query || '';

  const feed = useAssetFeed({ category: 'images', query, enabled: open && tab === 'search' && Boolean(query) });

  const { data: providers } = useQuery({
    queryKey: ['asset-providers'],
    queryFn: () => assets.providers(),
    staleTime: 60 * 60_000,
    enabled: open,
  });

  const imageProviders = useMemo(
    () => (providers?.items ?? []).filter((p) => p.supplies.includes('images') && p.configured),
    [providers]
  );

  const choose = (asset: ProviderAsset) => {
    const url = asset.imageUrl ?? asset.thumbnailUrl;
    if (!url) {
      toast('error', 'That image has no usable file.');
      return;
    }
    onPick({
      url,
      safeUrl: proxied(url) ?? url,
      name: asset.name,
      width: asset.imageWidth,
      height: asset.imageHeight,
      sourceLabel: asset.sourceLabel,
      sourceUrl: asset.viewerUrl,
      license: asset.license,
      attribution: asset.attribution,
    });
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      width="max-w-4xl"
      footer={
        <>
          {tab === 'search' && imageProviders.length ? (
            <p className="mr-auto hidden text-[11px] text-ink-subtle sm:block">
              Searching {imageProviders.map((p) => p.label).join(', ')}.
            </p>
          ) : null}
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <div className="ed-segment mb-3 w-full">
        <button
          type="button"
          onClick={() => setTab('search')}
          className={`ed-segment-btn flex flex-1 items-center justify-center gap-1.5 ${tab === 'search' ? 'ed-segment-btn-active' : ''}`}
        >
          <Search className="h-3 w-3" /> Search the libraries
        </button>
        <button
          type="button"
          onClick={() => setTab('upload')}
          className={`ed-segment-btn flex flex-1 items-center justify-center gap-1.5 ${tab === 'upload' ? 'ed-segment-btn-active' : ''}`}
        >
          <Upload className="h-3 w-3" /> Upload
        </button>
        <button
          type="button"
          onClick={() => setTab('link')}
          className={`ed-segment-btn flex flex-1 items-center justify-center gap-1.5 ${tab === 'link' ? 'ed-segment-btn-active' : ''}`}
        >
          <Link2 className="h-3 w-3" /> Paste a link
        </button>
      </div>

      {tab === 'search' ? (
        <>
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
            <input
              className="input pl-9 pr-9"
              placeholder="Search Pinterest, Unsplash, Pexels and more…"
              value={rawSearch}
              onChange={(event) => setRawSearch(event.target.value)}
              aria-label="Search for an image"
            />
            {rawSearch ? (
              <button
                type="button"
                onClick={() => setRawSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-subtle hover:text-ink"
                aria-label="Clear the search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>

          {/*
            Always on screen, not only when the box is empty. The shelves are
            the whole discovery story — someone who does not yet know what to
            type is exactly the person this dialog is for — and hiding them the
            moment anything is in the box (including the subject the caller
            opened on) left the picker looking like a plain search field.
          */}
          <div className="nv-no-scrollbar mb-3 flex gap-1.5 overflow-x-auto pb-0.5">
            {SHELVES.map((entry) => (
              <button
                key={entry.key}
                type="button"
                onClick={() => {
                  setShelf(entry.key);
                  setRawSearch(entry.query);
                }}
                className={`chip shrink-0 whitespace-nowrap ${
                  rawSearch.trim().toLowerCase() === entry.query ? 'chip-active' : ''
                }`}
              >
                {entry.label}
              </button>
            ))}
          </div>

          <div className="max-h-[52vh] overflow-y-auto">
            {feed.isLoading ? (
              <div className="columns-2 gap-2 sm:columns-3" aria-hidden>
                {Array.from({ length: 9 }).map((_, index) => (
                  <div
                    key={index}
                    className="nv-shimmer mb-2 w-full rounded-lg bg-surface-muted"
                    style={{ height: `${120 + (index % 3) * 60}px` }}
                  />
                ))}
              </div>
            ) : !feed.items.length ? (
              <p className="py-12 text-center text-sm text-ink-subtle">
                {search.trim()
                  ? `Nothing matched “${search.trim()}”. Try fewer words — the libraries index by subject, not by sentence.`
                  : 'No images came back just now.'}
              </p>
            ) : (
              <>
                {/*
                  A masonry column layout rather than a grid. Reference images
                  arrive at every aspect ratio, and cropping them all to a square
                  is exactly what you must not do when the whole point is
                  judging a composition.
                */}
                <div className="columns-2 gap-2 sm:columns-3">
                  {feed.items.map((asset, index) => (
                    <ImageResult
                      key={`${asset.source}:${asset.sourceAssetId}:${index}`}
                      asset={asset}
                      eager={index < 6}
                      onPick={() => choose(asset)}
                    />
                  ))}
                </div>
                <div ref={feed.sentinelRef} className="h-4" aria-hidden />
                {feed.isFetchingNextPage ? (
                  <p className="flex items-center justify-center gap-1.5 py-3 text-[11px] text-ink-subtle">
                    <Loader2 className="h-3 w-3 animate-spin" /> Loading more…
                  </p>
                ) : null}
              </>
            )}
          </div>
        </>
      ) : tab === 'upload' ? (
        <div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onloadend = () => {
                const url = String(reader.result);
                onPick({ url, safeUrl: url, name: file.name, sourceLabel: 'Uploaded' });
                onClose();
              };
              reader.readAsDataURL(file);
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-line-strong bg-surface-muted px-4 py-14 text-center transition hover:border-primary/50 hover:bg-primary-soft"
          >
            <Upload className="h-6 w-6 text-ink-subtle" />
            <span className="text-sm font-semibold text-ink">Choose an image from this computer</span>
            <span className="max-w-sm text-[11px] leading-relaxed text-ink-subtle">
              PNG, JPEG or WebP. It stays on your account — nothing you upload is added to the public libraries.
            </span>
          </button>
        </div>
      ) : (
        <div>
          <label className="label" htmlFor="picker-link">
            Image address
          </label>
          <input
            id="picker-link"
            className="input"
            placeholder="https://…"
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
          />
          <p className="field-hint">
            A direct link to the image file, not to the page it sits on. Right-click an image and copy its address.
          </p>
          <button
            type="button"
            className="btn-primary mt-3"
            disabled={!/^https?:\/\//i.test(linkUrl.trim())}
            onClick={() => {
              const url = linkUrl.trim();
              onPick({ url, safeUrl: proxied(url) ?? url, name: 'Linked image', sourceLabel: 'From a link' });
              onClose();
            }}
          >
            Use this image
          </button>
        </div>
      )}
    </Modal>
  );
}

/* ── One result ────────────────────────────────────────────────────────── */

function ImageResult({
  asset,
  eager,
  onPick,
}: {
  asset: ProviderAsset;
  eager: boolean;
  onPick: () => void;
}) {
  const ratio =
    asset.imageWidth && asset.imageHeight ? `${asset.imageWidth} / ${asset.imageHeight}` : '3 / 4';

  return (
    <figure className="group relative mb-2 break-inside-avoid overflow-hidden rounded-lg border border-line bg-surface">
      <button type="button" onClick={onPick} className="block w-full text-left" title={`Use ${asset.name}`}>
        <LazyImage
          src={asset.thumbnailUrl ?? asset.imageUrl}
          alt={asset.name}
          eager={eager}
          ratio={ratio}
          wrapperClassName="w-full"
          rounded=""
        />
      </button>

      <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/85 to-transparent px-2 pb-1.5 pt-6 opacity-0 transition group-hover:opacity-100">
        <span className="block truncate text-[10px] font-semibold text-white">{asset.name}</span>
        <span className="block truncate text-[9px] text-white/70">
          {asset.sourceLabel}
          {asset.license ? ` · ${asset.license}` : ''}
        </span>
      </span>

      {asset.viewerUrl ? (
        <a
          href={asset.viewerUrl}
          target="_blank"
          rel="noreferrer noopener"
          onClick={(event) => event.stopPropagation()}
          className="absolute right-1.5 top-1.5 rounded-md bg-surface/90 p-1 text-ink-subtle opacity-0 shadow-btn transition hover:text-ink group-hover:opacity-100"
          title="Open the original"
          aria-label={`Open ${asset.name} on ${asset.sourceLabel}`}
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      ) : null}
    </figure>
  );
}

/* ── A button that opens the picker ────────────────────────────────────── */

/**
 * The standard way to offer an image choice.
 *
 * Wraps the dialog so a caller needs one component and one callback rather than
 * its own open-state, which is how the platform ended up with five different
 * image-choosing experiences in the first place.
 */
export function ImagePickerButton({
  onPick,
  label = 'Choose an image',
  title,
  description,
  initialQuery,
  className,
  disabled,
}: {
  onPick: (image: PickedImage) => void;
  label?: string;
  title?: string;
  description?: string;
  initialQuery?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={className ?? 'ed-action w-full justify-center border border-line'}
        onClick={() => setOpen(true)}
        disabled={disabled}
      >
        <Sparkles className="h-3.5 w-3.5" /> {label}
      </button>
      <ImagePicker
        open={open}
        onClose={() => setOpen(false)}
        onPick={onPick}
        title={title}
        description={description}
        initialQuery={initialQuery}
      />
    </>
  );
}

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
