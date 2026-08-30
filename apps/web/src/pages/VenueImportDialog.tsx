import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, CheckCircle2, Layers, Upload } from 'lucide-react';
import type { VenueSpec } from '@novira/shared';
import { Modal } from '../components/Modal';
import { Field, ProgressBar, TextInput, toast } from '../components/ui';
import { spatial, type VenueImportReport } from '../lib/spatialApi';
import { ApiClientError } from '../lib/api';

/**
 * Bringing a building in.
 *
 * The venue form asks forty questions, and it should — clear height under the
 * beam, pillar positions, what the floor takes. But nobody fills in forty
 * fields to try something, so a designer with a model of the building gets a
 * shorter road: drop the file in, name it, done. Everything the geometry can
 * answer is measured rather than asked.
 *
 * Three things happen server-side that are worth knowing about, because they
 * are why this takes a minute rather than a moment:
 *
 *  · **The model is optimised.** Architectural exports are enormous — the
 *    Rotana arrived at 112 MB and left at 2.5 MB — and an unoptimised building
 *    will not load in a browser at all, let alone alongside a plan.
 *  · **The units are worked out.** Half of the glTF exports in the wild are in
 *    centimetres or inches while claiming metres. The size is checked against
 *    what a building plausibly is, and scaled if it is not.
 *  · **The floors are found.** Horizontal surfaces are clustered by height, so
 *    dropping a chair onto the mezzanine puts it *on* the mezzanine — which is
 *    the whole reason a building model is worth having in the editor.
 *
 * Nothing here is final: the venue it creates opens in the full editor
 * afterwards, and every measured figure is editable.
 */
export function VenueImportDialog({ onClose, onDone }: { onClose: () => void; onDone: (venue: VenueSpec) => void }) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('');
  const [uploaded, setUploaded] = useState(0);
  const [report, setReport] = useState<VenueImportReport | null>(null);

  const run = useMutation({
    mutationFn: () =>
      spatial.venues.importModel(
        file!,
        { name: name.trim() || undefined, city: city.trim() || undefined, country: country.trim() || undefined },
        setUploaded
      ),
    onSuccess: (result) => {
      setReport(result.report);
      void queryClient.invalidateQueries({ queryKey: ['venue-specs'] });
      toast('success', `${result.venue.name} is in your library.`);
      onDone(result.venue);
    },
    onError: (error) =>
      toast('error', error instanceof ApiClientError ? error.message : 'That building could not be read.'),
  });

  const choose = (chosen: File | undefined) => {
    if (!chosen) return;
    if (!/\.(glb|gltf)$/i.test(chosen.name)) {
      toast('error', 'Novira reads glTF buildings — a .glb or .gltf file.');
      return;
    }
    setFile(chosen);
    if (!name.trim()) setName(chosen.name.replace(/\.(glb|gltf)$/i, '').replace(/[-_]+/g, ' '));
  };

  /* ── Finished ─────────────────────────────────────────────────────── */
  if (report) {
    return (
      <Modal
        open
        onClose={onClose}
        title="The building is in"
        width="max-w-lg"
        footer={
          <button type="button" className="btn-primary" onClick={onClose}>
            Done
          </button>
        }
      >
        <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success/5 p-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
          <div className="text-sm text-ink">
            <p className="font-semibold">{name || 'The venue'} is ready to design in.</p>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
              Open it from the library to fill in the things geometry cannot know — rigging capacity, power, the
              loading door — or apply it to a plan straight away.
            </p>
          </div>
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <Fact
            label="Size on disk"
            value={`${mb(report.bytesBefore)} → ${mb(report.bytesAfter)}`}
            note={
              report.bytesBefore > report.bytesAfter * 1.3
                ? `${(report.bytesBefore / Math.max(1, report.bytesAfter)).toFixed(0)}× smaller — it will open in a browser`
                : 'Already lean'
            }
          />
          <Fact label="Triangles" value={report.triangleCount.toLocaleString()} note={`${report.textureCount} textures`} />
          <Fact
            label="Floors found"
            value={String(report.floors)}
            note={report.floors ? 'Objects will land on them' : 'None detected — objects sit on the ground'}
          />
          <Fact
            label="Units"
            value={report.unitScale === 1 ? 'Metres' : `Scaled ×${report.unitScale}`}
            note={report.convertedFrom ? `Converted from ${report.convertedFrom}` : 'As exported'}
          />
        </dl>
      </Modal>
    );
  }

  /* ── Working ──────────────────────────────────────────────────────── */
  if (run.isPending) {
    return (
      <Modal open onClose={() => undefined} title="Reading the building" width="max-w-lg">
        <ProgressBar value={uploaded < 100 ? uploaded : 100} label={uploaded < 100 ? 'Uploading' : 'Optimising'} />
        <p className="mt-3 text-xs leading-relaxed text-ink-muted">
          {uploaded < 100
            ? 'Sending the file.'
            : 'Compressing the geometry and textures, working out the units, and finding the floors. A large building takes a minute — leave this open.'}
        </p>
      </Modal>
    );
  }

  /* ── The form ─────────────────────────────────────────────────────── */
  return (
    <Modal
      open
      onClose={onClose}
      title="Upload a building"
      description="A glTF model of the space. Everything measurable is read off it, so there are three questions rather than forty."
      width="max-w-lg"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" disabled={!file} onClick={() => run.mutate()}>
            <Upload className="h-4 w-4" /> Import it
          </button>
        </>
      }
    >
      <input
        ref={fileRef}
        type="file"
        accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
        className="hidden"
        onChange={(event) => choose(event.target.files?.[0])}
      />

      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          choose(event.dataTransfer.files?.[0]);
        }}
        className={`flex w-full flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-10 text-center transition ${
          file
            ? 'border-primary/60 bg-primary-soft'
            : 'border-line-strong bg-surface-muted hover:border-primary/50 hover:bg-primary-soft'
        }`}
      >
        {file ? <Layers className="h-6 w-6 text-primary" /> : <Building2 className="h-6 w-6 text-ink-subtle" />}
        <span className="text-sm font-semibold text-ink">{file ? file.name : 'Choose or drop a .glb file'}</span>
        <span className="max-w-sm text-[11px] leading-relaxed text-ink-subtle">
          {file
            ? `${mb(file.size)} — it will be compressed on the way in.`
            : 'Export the building from SketchUp, Revit, Blender or Rhino as glTF. Up to 400 MB; architectural exports are usually far larger than they need to be and are optimised here.'}
        </span>
      </button>

      <div className="mt-4 grid gap-x-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="What is it called?" htmlFor="venue-import-name">
            <TextInput
              id="venue-import-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Johari Rotana — Almasi Ballroom"
            />
          </Field>
        </div>
        <Field label="City" htmlFor="venue-import-city">
          <TextInput
            id="venue-import-city"
            value={city}
            onChange={(event) => setCity(event.target.value)}
            placeholder="Dar es Salaam"
          />
        </Field>
        <Field
          label="Country"
          htmlFor="venue-import-country"
          hint="Two-letter code. It sets which regulations the plan is checked against."
        >
          <TextInput
            id="venue-import-country"
            value={country}
            onChange={(event) => setCountry(event.target.value.toUpperCase().slice(0, 2))}
            placeholder="TZ"
          />
        </Field>
      </div>
    </Modal>
  );
}

function Fact({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface-muted p-2.5">
      <dt className="text-[10px] font-bold uppercase tracking-wide text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold tabular-nums text-ink">{value}</dd>
      <dd className="text-[10px] leading-snug text-ink-subtle">{note}</dd>
    </div>
  );
}

function mb(bytes: number): string {
  return bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}
