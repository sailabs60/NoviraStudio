# Novira

**The operating system for spatial projects** — React + MySQL, built as a
monorepo.

Not 3D mockup software. An agency designs an event in it, and the same document
answers what it costs, whether it is safe, whether the venue will take it, what
the workshop needs to build it, and what goes to the client — because all of
those are derived from the drawing rather than typed in beside it.

This repository contains both the research that specified the product and the
implementation of it.

---

## Running it

```bash
npm install
npm run db:start                                  # portable MariaDB on :3307
npm run prisma:push                               # apply the schema
npm run seed --workspace=apps/api                 # pricing, credit ratios, config
npm run assets:procedural --workspace=apps/api    # exact-size rental items
npm run assets:hdri --workspace=apps/api          # the 12 lighting environments
npm run assets:sync --workspace=apps/api          # ingest + verify online assets
npm run dev                                       # api :4100, web :5174
```

| Command | What it does |
| --- | --- |
| `npm run db:start` / `db:stop` / `db:status` | Control the local MySQL server |
| `npm run db:sql -- "SELECT …"` | Query the database directly |
| `npm run typecheck` | Typecheck all three packages |
| `npm run assets:sync -- --dry-run --report` | Classify candidates without downloading |
| `npm run seed` / `seed:demo` | Seed configuration / the local demo accounts |
| `npm run thumbnails` | Render previews for catalogue items missing one |
| `npm run assets:sync -- --source blenderkit --tier 1` | Pull the universal event items |
| `node scripts/test-api.mjs` | Sweep every API route group headlessly (30 checks, ~5s) |
| `node scripts/test-crash.mjs` | Prove a broken asset cannot kill the scene (5 checks) |
| `node scripts/test-builders-visual.mjs` | Tent, stage, drape and venue against their reported faults (20 checks) |
| `node scripts/research-frames.mjs` | Frames from the mp4 walkthrough |
| `node scripts/research-hls.mjs` | Frames from the five HLS videos |
| `node scripts/test-floorplan-trace.mjs` | Import, calibrate and trace a plan (10 checks) |
| `node scripts/test-viewport-editing.mjs` | Drafting and lettering in the default view (11 checks) |
| `node scripts/test-branding.mjs` | Lettering, artwork and licence filtering (14 checks) |
| `node scripts/test-operations.mjs` | Guests, seating, stock and quoting end to end (38 checks) |
| `node scripts/test-drafting.mjs` | Drafting geometry and snapping (24 checks) |
| `node scripts/test-collab.mjs` | The collaboration protocol, with two clients (16 checks) |
| `node scripts/test-ui-suite.mjs` | The new pages in a browser (22 checks) |
| `node scripts/test-stripe.mjs` | Boot a Stripe-configured API and drive the webhook (11 checks) |
| `node scripts/test-venue.mjs` | Venue derivation: capacity, openings, warnings (20 checks) |
| `npx tsx src/scripts/testVenueMesh.ts` | Measure the built venue geometry (12 checks, from `apps/api`) |
| `node scripts/test-venue-ui.mjs` | Venue panel and billing surface in a browser (15 checks) |
| `node scripts/test-full.mjs` | Drive the whole product in a browser (15 checks, ~4 min) |
| `node scripts/test-spatial.mjs` | The platform layer end to end: take-off, pricing, checks, CAD, versions, comments, venues, AI, marketplace (116 checks, ~40s) |
| `node scripts/test-spatial-ui.mjs` | The rebuilt interface in a browser: rail, builders, present, cost, check, AI, review (92 checks, ~3 min) |
| `node scripts/test-led-content.mjs` | Prove a bad screen link cannot kill the scene (15 checks) |
| `node scripts/shoot-builders.mjs [subject…]` | Close-up renders of every procedural builder, for looking at |
| `node scripts/artwork.mjs` | Resize `artwork/` into the web copies under `public/` (`--check` lists what is missing) |
| `node scripts/shoot-artwork.mjs` | Screenshot every surface that carries photography |
| `node scripts/test-venue-model.mjs` | Building import, floor detection, apply-to-plan, image libraries (23 checks) |
| `node scripts/test-studio-additions.mjs` | Views, right-drag, the image picker and venue upload in a browser (25 checks, ~5 min) |
| `node scripts/shoot-additions.mjs` | Screenshots of the above, for looking at |
| `npm run seed:rotana --workspace=apps/api` | Seed the Johari Rotana from `rotana for apoli.glb` |
| `node scripts/test-designer.mjs` | Table Designer, end to end |
| `node scripts/test-walls.mjs` etc. | Feature-specific end-to-end checks |

Prerequisite: a portable MariaDB at `../.tools/mariadb-11.4.5-winx64`
(MySQL wire-compatible; `scripts/db.mjs` explains how to get it).

---

## Layout

```
apps/api        Express + Prisma + MySQL
apps/web        React + Vite + react-three-fiber
packages/shared Units, enums, scene document, layout, walls, stage, wire types
scripts/        DB control and end-to-end test drivers
docs/           The rebuild specification (71pp PDF) and its HTML source
research/       Everything the specification was derived from
```

---

## What is built

Every item was verified against the running system — real HTTP calls against
real MySQL, and real screenshots of the real UI.

### Foundations
- **MySQL schema** — 40 tables, integer-millimetre geometry, JSON scene documents
- **Auth** — register (individual/company), login, sessions, password rules, verification and reset tokens
- **Projects and plans** — CRUD, scene persistence, delete guards
- **Access control** — four independent gates: tier, role, company flags, credits

### The editor
- 3D viewport with image-based lighting, shadows, grid, gizmos
- Placement, selection, transforms, undo/redo, autosave, keyboard map
- **Walls and rooms** — click-to-draw with ortho snapping, Quick Room, per-segment
  thickness/height/colour, automatic floor derivation from closed loops
- **Doors and windows** — snap onto the nearest wall segment; the wall is split
  around the opening (lintel and sill preserved) rather than CSG-cut
- **Table Designer** — generates a complete banquet set and keeps every chair and
  cover in step when the table, seat count or layout changes
- **Quick Layout** — 10 presets (grid, angled, rows, pyramid, diagonal, curved,
  arc, circle, U-shape, aisle)
- **Tent builder** — 7 frame sizes, per-bay sidewall slots, 7 wall types, hideable canopy
- **Stage builder** — modular decks, height-driven guardrail selection, bay-aligned
  stairs, skirting with automatic stair gaps, and a **derived parts list**
- **Drape builder** — procedural pleated fabric from a 9-anchor control grid

### Site context
- **Floor-plan import** with two-point calibration
- **Map import** at true scale (server-side capture, scale from the projection)
- **Background images**
- **Real buildings**, uploaded as glTF and laid out inside — see *Venues you can
  stand in*

### AI
- One job subsystem for every AI feature: preflight → idempotency → enqueue →
  poll → deliver → refund on failure or cancellation
- **Concept generator** — a written brief becomes a laid-out room; the model reads,
  the engine builds, and a free parser covers accounts with no AI budget
- **Photo to layout** — a photograph becomes objects matched against your own
  measured catalogue
- **Pro Render** — a high-resolution frame improved by an image model, with the
  geometry preserved and the distinction stated
- **AI Enhance** — photoreal render of the current view (NanoBanana / OpenAI)
- **Image to 3D** — photo becomes a mesh, measured and scaled before it can be
  saved to the catalogue (Tripo3D)
- **Floor-plan wall tracing** — local computer vision, no provider, no per-run cost

### The production layer
- **Truss** — ten systems by market, path-based runs, section packing from real
  stock lengths, weight, load per support and a live span check
- **LED** — eight cabinet types, target sizes fitted to whole cabinets, derived
  resolution, weight, power, processing and viewing distances
- **Exhibition stands** — six stand types, standard module sizes for both metric
  and imperial floors, organiser rule checking, and whole-hall grid layout
- **Lighting** — fourteen named fixtures, beam and gobo control, six complete
  looks, Auto Light Scene, and a derived power and DMX budget
- **Site constraints** — height limits, rigging points, supplies, exits, keep-clear
  zones, truck routes and floor loading, as checkable geometry in the scene

### Cost and compliance
- **Quantity take-off** — LED area, truss length, carpet, print, structure volume
  and labour hours, each measured from the geometry and each stating its basis
- **Rate cards** — per-agency cost databases with wildcards, wastage, minimum
  charges, margin reporting and regional defaults
- **The design check** — fire egress, sightlines, screen placement, spacing, crowd
  flow and accessibility, against the rules for the plan's market
- **Regional packs** — six markets with their own units, voltage, stock, materials
  and regulatory figures

### Output
- **PDF export** — the view plus a schedule of contents, wall run, floor areas and
  the stage parts list
- **CAD export (DXF R12)** — real geometry on named layers, in millimetres
- **Bill of quantities** — with or without prices, every line carrying its basis
- **Material breakdown** — grouped by material, with truck loads derived
- **Client deck** — eleven slide types generated from the plan and editable before
  it goes out
- **4K stills and walkthrough video** — shot lists with easing, rendered in the
  browser and encoded server-side
- **PNG export**, **share links** (opaque tokens), **iframe embeds**
- **Templates** (whole plans) and **collections** (object groups with placement kept)

### Design and drafting
- **Branding engine** — extruded and engraved lettering with twelve named
  finishes, emission and transmission, plus artwork with licence-checked
  online search and backlit panels
- **2D drafting** — eight tools, purpose-named presets, and snapping that
  prefers wall endpoints over the grid
- **Quick toolbar** — rotate, raise, duplicate, lock, hide and delete, floating
  over the selection

### Running the event
- **Guest list** — one per event, spreadsheet paste import, RSVP, meals,
  dietary and access requirements
- **Seating** — derived from the layout, drag-to-seat, household-aware
  auto-seating, and a catering sheet with per-table meal counts
- **Suppliers and stock** — vendors, inventory linked to catalogue models,
  commitment tracking across events, and layout requirements with shortfalls
- **Proposals** — built from the layout, integer money arithmetic, client link
  with accept/decline and no internal costing
- **Collaboration** — presence, in-scene cursors, selection rings and live
  scene updates

### The platform
- **Venue intelligence** — buildings recorded once: clear height, pillars, loading,
  rigging capacity, access, services and rules, applied to a plan in one click
- **Versions, comments and comparison** — client comments pinned in the 3D scene,
  named versions, and a change list between any two of them
- **Marketplace** — templates, stand designs, venue packs and rate cards, with a
  published commission and a review queue
- **Specialists** — a directory where a brief carries a view-only plan link with it
- **White label** — an agency's brand across the app, share links and exports

### Commerce and administration
- **Plans and credits** — three tiers, append-only credit ledger, packs, CSV export
- **Cancellation** with a structured reason taxonomy and a resume path
- **Company workspaces** — seats with their own tier, roles, visibility,
  invitations, per-member or shared-pool credits, usage reporting
- **Admin console** — overview, users, catalogue review queue, live pricing and
  credit-cost editing, AI job reporting, company feature flags

---

## The asset pipeline

A mislabelled model is worse than a missing one: in a to-scale plan it silently
produces a wrong layout. **Nothing enters the catalogue on the strength of its
name.** Every candidate is downloaded, parsed, measured, and scored.

### Five checks

1. **Loadable** — the glTF parses and contains real geometry.
2. **Identity** — head-noun analysis decides what the thing actually is.
3. **Dimensions** — measured extents must fall inside the plausible real-world
   range for that item type. This one is a **gate**, not a score.
4. **Proportion** — width-to-height must be sane for the type.
5. **Usability** — triangle budget, origin placement, file size.

### Why head-noun analysis

A first attempt matched taxonomy terms anywhere in the name, description or
tags. It filed **"Bench Vice" as a bench**, **"Wicker Basket" as a table**,
**"Carrot Cake" as a plate** and **"Gate Latch" as a door**.

In an English compound noun the *last* noun is the head — the thing the phrase
denotes. "Bench vice" is a vice; "dining table" is a table; "table lamp" is a
lamp. So the classifier reads the name from the right and takes the longest
phrase at the tail it recognises, against a **whitelist**: an unknown head noun
is rejected rather than guessed at. Modifiers then refine within the family —
"Round Wooden Table" becomes a round table, "Ceiling Lamp" a pendant, and
"Barber Shop Chair" is rejected outright.

### Unit inference

Exporters disagree about units; the same chair may be authored 0.9 (metres),
90 (centimetres) or 35 (inches) tall. The inspector tries each interpretation
and keeps the one that lands the model inside its expected range.

### Result

| Stage | Count |
| --- | --- |
| Poly Haven library | 521 models |
| Survived head-noun classification | 80 |
| Published after measurement | 54 |
| Held for review (size outside band) | 24 |
| Rejected | 2 |
| Procedural items at exact rental sizes | 16 |
| **Catalogue total (approved)** | **70** |

Searching `sofa` returns three actual sofas, at 1571, 1807 and 2285 mm wide.
The 24 held items appear in the admin review queue with the measurement that
held them back, so a human decides rather than the pipeline guessing.

### Procedural items

There is no CC0 "60-inch round banquet table" anywhere, and scraped ones measure
whatever the artist felt like. Banquet tables, cocktail tables, dance-floor
panels, stage decks, drape uprights, doors and windows are generated from real
dimensions, then re-measured to confirm the generator produced what it declared.
All 16 matched exactly.

---

### Sources

Two are wired in, and the difference between them shapes the pipeline.

**Poly Haven** is small enough to enumerate — the whole 521-model library is
classified in one pass. Everything is CC0, and the quality is uniformly high.
It is also, for our purposes, mostly *not* event furniture, so it fills some
categories well and leaves others empty.

**BlenderKit** is search-based, so it cannot be enumerated: it has to be asked
for something specific, and the catalogue is only as good as the questions.
Those questions live in `assetSources/eventSearchPlan.ts` as an explicit,
ordered plan running from the items every event needs anywhere in the world
— seating, tables, staging, bars, linen, lighting — outwards to the
specialised and decorative. A planner in any market can lay out a room from
the first two tiers alone. `--tier 1` runs only the universal set.

Both work without an API key. BlenderKit needs one non-obvious trick: its
download endpoint answers 403 unless given a `scene_uuid` query parameter,
and with any UUID it returns a short-lived signed URL to a real GLB. Only
assets the API marks free are considered, and the licence and author are
recorded on every row so attribution survives into the catalogue.

Sources that were **not** wired in, and why: Sketchfab and Poly Pizza need
credentials for downloads; Thingiverse and MyMiniFactory are 3D-print models
(STL, no materials, wrong domain); Smithsonian, Europeana and NASA are museum
and mission artefacts rather than event furniture. Modules for these were
carried over from the earlier project and are unused — `assetSources/*.js`
is that legacy, and `index.js` there does not even load, as it requires a
module that was never written.

### Reading real files

The first BlenderKit run rejected all 56 candidates, none of them for what
they depicted. The reader was built with the Khronos extension set only,
while community exports lean on vendor extensions — BlenderKit assets are
almost universally Draco-compressed with WebP textures, both declared
*required*, so the reader refused the whole file. Registering `ALL_EXTENSIONS`
plus the Draco and meshopt decoders turned the same 56 candidates into 36
published and 18 held for review.

The same compression matters on the client: the browser needs a Draco decoder
to render these at all. drei defaults to a Google CDN for it, which would make
the bulk of the catalogue silently fail to render whenever that host is
unreachable, so the decoder is served from `apps/web/public/draco/` instead.

### What the gate actually catches

From the first BlenderKit run, all correctly held back for review rather than
published:

| Asset | Measured | Why it was held |
| --- | --- | --- |
| Round Cocktail Table | 889 × 224 mm | 224 mm tall is not a cocktail table |
| Satin Curtain | 3549 × 253 mm | a 253 mm drape is not a drape |
| Dining Table & Chair | 3048 mm, filed as a chair | it is a set, not a chair |
| Folding Ladder Chair | 1232 × 953 mm | it is a ladder |

These are exactly the "named one thing, is another" cases the catalogue exists
to keep out. They are quarantined in the admin review queue, not discarded —
a human decides.

### Where sourcing stops and generating starts

After the full search plan ran, four categories were still empty: linens,
signage, bar and catering equipment, and outdoor furniture. That was not a
tuning problem. A BlenderKit search for "welcome sign" returns a decorative
bear, an LED fixture and a medieval inn; its free glTF subset simply does not
contain these things.

They are also the most dimensionally standardised items at an event, which is
exactly where generating beats sourcing — a 120" round cloth has one correct
size, and a chafing dish is a full-size gastronorm pan whatever the brand. So
they are built, the same way the banquet tables already were:

- **Linens** — round cloths sized to the table they dress (a 90" cloth on a
  60" round gives a 15" drop; a 132" reaches the floor), plus 6 ft and 8 ft
  banquet cloths.
- **Bars and catering** — 4 ft and 6 ft portable bar sections at 1067 mm bar
  height, and a full-size chafer.
- **Signage** — an A1 A-frame and a display easel.
- **Outdoor** — 9 ft and 11 ft market umbrellas, and a patio heater.

The generator re-measures every model it builds and compares that against the
dimensions the item declares. The first run reported 8 mismatches, all of them
wrong declarations rather than wrong geometry — a cloth whose bounding box is
its drop, not the table height; a bar whose top overhung on both axes and so
read 60 mm wider than the size it is hired at. The build is only accepted at
**0 mismatches**, so a catalogue dimension is never a claim about the mesh
that the mesh does not support.

### Coverage

From 70 approved items across 13 categories, with 5 empty, to **220 approved
across all 18**, every one carrying a thumbnail.

### Thumbnails

Every item needs a preview; a catalogue of grey placeholders is unusable
because you cannot pick a chair you cannot see. Downloaded assets usually
arrive with a publisher render, but procedurally generated ones have no image
at all.

Rather than special-casing those, `npm run thumbnails` renders the actual GLB
in a headless browser, framing each model from its own bounding box so a 3 m
banquet table and a 40 cm plate both fill the frame. A thumbnail therefore
always depicts the geometry that will land in the plan — which matters for a
catalogue assembled from external sources, where a publisher render can
flatter or plainly misrepresent the mesh.

## The studio

Five regions, each answering one question, and the arrangement is the reason
the tool stops feeling like a wall of options:

| Region | The question it answers |
| --- | --- |
| Top bar | Where am I, and is my work safe? |
| Icon rail | What phase of the work am I in? |
| Left panel | What am I putting into the room? |
| Right dock | What does the thing I selected do, and what is the room doing? |
| Bottom strip | What could I start from instead of a blank floor? |

The rail is grouped into three phases — Create, Refine, Deliver — rather than
listing nine flat icons, and the left panel mounts exactly one group at a time
(`3D Models`, `2D Art & Logos` or `Layout Tools`). Properties are permanently
on the right, beside the object being edited, and follow the selection.

Both side panels collapse (`Ctrl+\` and `Ctrl+.`), which is how you get to a
clean frame to show a client without leaving the editor.

**One home per control.** The Build panel *adds* structures and specifies them;
the right dock *edits* whatever is selected — transform, real dimensions,
finishes — and offers a labelled hand-off to the builder rather than a second
copy of it. When both surfaces rendered the same tent select, a plan had two
live copies of every field on screen and neither was obviously the real one.

### Rendering on demand

The viewport runs with `frameloop="demand"`. A plan is static almost all of the
time — someone is reading it, typing in a panel, or thinking — and redrawing an
unchanged scene sixty times a second costs everything on a machine without a
real GPU. Measured on a software rasteriser with a fifty-object plan, this is
the difference between **0.4 frames per second with a 2.8-second task on every
frame**, where clicking a rail button took twenty-four seconds to register, and
an editor that sits idle at zero cost and answers a click in 200 ms.

React state changes request a frame on their own. `<FrameKeepAlive>` covers the
three cases they do not — orbit damping, pointer hover and cursor sharing, and
gizmo drags — by keeping the loop alive for a second after any pointer
activity. A walkthrough is real animation, so it switches back to a continuous
loop while it plays.

## The online libraries

The measured catalogue is the floor, not the ceiling. Eighteen public
libraries — Sketchfab, BlenderKit, Poly Haven, ambientCG, Poly Pizza,
Smithsonian, Khronos, Europeana, NASA 3D, Thingiverse, MyMiniFactory, Free3D,
Open Source 3D, Openverse, Unsplash, Pexels, Pixabay and Pinterest — are
searched live and merged into one ranked list.

Four things make that usable rather than merely large:

- **One fan-out, many pages.** The first request for a query pays for the whole
  search and caches the ranked list; every later page is a slice of that array.
  Without it, "page 2" from eighteen independently paginated APIs is not the
  continuation of page 1, and infinite scroll shows duplicates and gaps.
- **The next page loads before you need it.** The sentinel fires 800 px early,
  and thumbnails are requested 400 px before they are on screen.
- **Warm before asked.** The server searches the opening shelves on boot and
  keeps them warm; the browser quietly fetches the shelves either side of the
  one you are reading.
- **Honest about access.** Every row says whether it can be used, bought or only
  looked at. A model that needs an account on the source site says so on the
  card, before the drag, not after it fails.

Dragging an online model into the plan **imports** it: the file is copied onto
our own storage, opened and measured, and written as a catalogue row owned by
the user. That is what makes a saved plan still open in a year when the
provider has reorganised its CDN — and what gives the object real dimensions so
it can be costed and checked.

Providers that need a key report themselves unavailable rather than failing at
call time, and the panel footer names which are live. See `apps/api/.env`.

## Materials, and the part they land on

A finish is a real material on a real surface: 18 mm birch ply on a stand's
fascia, grey loop pile on a hall floor, brushed stainless on a counter edge.
Two consequences follow, and both matter more than they look.

**A finish belongs to a part, not to an object.** A reception counter has a
laminate top, a painted body and a metal kick; painting the whole thing one
colour is what a toy does. Finishes are stored on `BaseSceneObject` keyed by the
part they were dropped on, with `'*'` for the whole object — so they work on
catalogue models, procedural staging, truss, stands, drape, walls and the floor
of the room, without the feature being written five times.

**Tiling is in millimetres, not in repeats.** A "2× repeat" means nothing on a
surface whose size you have not been told. Each finish carries a real-world tile
size and the renderer derives the repeat from the mesh it lands on, which is why
a 300 mm tile is 300 mm on a side table and on a 40 m backwall, and why resizing
an object does not stretch its material.

Seventy finishes ship built in — every one a plain tinted PBR surface, so they
load instantly and render identically on a laptop with no GPU. Photographic
detail is what ambientCG, Poly Haven and BlenderKit are for, and swapping one in
changes only the `maps` field.

## Drag and drop

The rule is that **you know what will happen before you let go.** Every pointer
move recomputes the intent, and the intent drives three things at once: a chip
that follows the cursor saying what is held, a full-size translucent ghost of
the actual model standing on the floor where it would land, and — for a
material — an additive highlight on the exact surface it would paint. Dropping
is then just "do the thing you were already showing".

Native drag events never reach react-three-fiber's pointer system, so the drop
layer raycasts against the live scene itself (`picking.ts`) and the browser's
own drag image is suppressed in favour of the chip, which can say things a
frozen bitmap cannot.

## The viewport

Not a debug view. A flat fill with a grid ruled across it reads as a wireframe
editor from 1998, and — worse for the job — tells a designer nothing about
where anything is: a chair floating on an infinite plane with a hard horizon
could be any size, in any space.

So the viewport is built as an **infinite-cyclorama photography studio**, the
same thing a product photographer builds out of a curved sweep of paper: a soft
vertical gradient behind everything, a ground plane that catches shadows, and a
wide dissolve where the two meet so there is no seam and no line to read as the
edge of the world. Objects then sit *in* something, and their contact shadows
say they are on the floor rather than hovering over it.

Four decisions carry the realism:

- **Khronos PBR Neutral tone mapping**, not ACES. ACES is a film look — it
  crushes highlights and shifts hue, which is lovely for a hero render and
  wrong for a tool where a client asks whether that is the exact fabric colour.
  Neutral holds white points and hue and only compresses what would clip.
- **The environment does the lighting.** An HDRI decides the colour of every
  reflection and the direction of every shadow. The analytic rig underneath is
  deliberately restrained — one key, a soft sky/ground hemisphere, and a cool
  rim from behind — because piling on ambient is what makes 3D look plastic.
- **The backdrop derives from the floor.** Surfacing the room in dark carpet
  darkens the studio around it, rather than leaving a pale sky over a black
  floor.
- **The grid is drafting, not wireframe.** One-metre cells with a five-metre
  section line, both barely there, fading well before the horizon.

Everything is procedural — one sphere, two planes and a generated 256 px
gradient — so it costs nothing to download and almost nothing to draw. The
**Environment** window on the bottom toolbar chooses the sky: nine curated
Poly Haven maps for the situations event work is presented in, thousands more
online, plus rotation (which aims the sun), exposure, strength and whether the
map itself shows behind the room.

## Venues you can stand in

A venue record used to be figures: clear height, pillar positions, rigging
capacity, how big a truck reaches the door. All of it useful, none of it a
room. A record can now carry the building itself, and applying it puts the
designer *inside the space* rather than inside a rectangle.

**Uploading one takes three questions.** Name, city, country — everything else
is measured off the geometry, because a form with forty fields is where a venue
library goes to die. What happens on the way in is the reason it is worth doing
server-side:

- **The model is made loadable.** Architectural exports are enormous: the Johari
  Rotana arrived at 112.6 MB and left at 2.4 MB. Draco geometry, resized
  textures, deduplicated materials.
- **Specular-glossiness is converted.** three.js dropped the extension, so half
  of the glTF files in the wild render as untextured grey — which every user
  reads as a broken import rather than an unsupported extension.
- **The triangles are cut to a budget.** File size was never the thing that
  hurt: the Rotana's 1.48 million triangles pack into a perfectly reasonable
  2.4 MB and then take *seconds per frame* to draw. Simplification brings it to
  521k under a 1% error bound — meshoptimizer stops collapsing rather than
  distorting, so a model that really is all detail comes back barely changed
  instead of melted.
- **The units are worked out.** A great many exports are in centimetres or
  inches while claiming metres; the size is checked against what a building
  plausibly is and scaled if it is not.
- **The floors are found.** Horizontal, upward-facing surfaces are clustered by
  height, filtered by area and flatness, and — critically — anything within
  2.1 m of the model's top is rejected, or a roof slab would be reported as the
  building's best floor and every dropped chair would land on it.
- **The building is moved to where the plan thinks it is.** Centred on X and Z,
  and lowered so the lowest real floor sits at zero. Without this the venue's
  floor polygon and its keep-clear zones — all generated around the origin —
  end up in an empty field beside the building, and everything dropped on the
  "ground" lands 200 mm under the ballroom floor.

The library ships with the **Johari Rotana, Dar es Salaam**: the Almasi Ballroom
(51.0 × 16.0 m, 816 m², 6.0 m clear, 960 theatre / 630 classroom / 550 banquet /
900 cocktail — Tanzania's largest hotel ballroom) and its two divisible meeting
suites. The figures are the hotel's published ones and the source is recorded on
the record, so anyone can check them.

### Pushing things around the floor

The gizmo is precise and slow — the right tool for nudging a screen 40 mm left,
the wrong one for the thing people do most, which is shoving furniture around a
room to see how it feels. **Right-press an object and push it.**

- **Along the floor only.** The height is never taken from the pointer; it is
  read from whatever surface is under the object's new footprint, so a chair
  pushed onto a stage climbs onto it and one pushed off comes back down.
- **The search is bounded to the storey.** A ray dropped from the top of the
  world hits the *roof* of a building first, so a chair slid across the Almasi
  would have ended up on top of the hotel. It starts 2.5 m above the object
  instead: still able to step onto a riser, unable to change floor.
- **The object is excluded from its own pick.** It follows the pointer, so it is
  permanently under it, and reading the cursor's ground position off its own top
  face introduces a parallax error the height of the object — applied every
  frame, so it accelerates away and finishes metres from where it was let go.
  The move gizmo had to be excluded for the same reason.
- **One undo entry.** Live updates are quiet; the original position is restored
  and re-applied once on release, so a single Ctrl+Z puts it back where it
  started rather than replaying two hundred mouse positions.

### Views a client can navigate with

Someone opening a share link has never used a 3D tool. Asked to orbit, they drag
once, end up under the floor looking at the underside of a stage, and close the
tab — and two days of design are judged on that.

So the designer stands where the plan reads best and presses **Save view** on
the bottom toolbar. Views are named, reorderable, and each keeps a thumbnail
captured from the live frame, so the strip is made of the actual views rather
than a list of names to imagine. On a share link they appear as a **closable
strip along the bottom**, re-openable from a tab that stays put.

A view is a vantage point, not a walkthrough shot: no duration, no easing, no
path. That is why it is a separate idea from the video shots in Present, which
are a *move* made to be rendered.

## Browsing for pictures, from anywhere

Every place that needed an image had grown its own answer — upload a file here,
paste a URL there, nothing at all somewhere else — while the platform was
already searching seventeen image libraries that none of those moments could
reach.

There is now one dialog, used by the AI studio's model source and style
reference, the editor's photo-to-mesh, and the branding panel's artwork. Three
ways in, in the order people use them: **search the libraries**, **upload**, and
**paste a link**.

- **Pinterest leads each round.** For creative work — "what should this look
  like" rather than "I need a photo of a chair" — a wall of pins is what a
  designer would open anyway. The merge deals results out by source, strong
  matches included, so a first screen from a single provider cannot happen.
- **The shelves are two or three words.** The upstream libraries index by
  subject and AND their terms together, so a well-written sentence returns
  nothing: "event design mood board interior styling palette" finds zero images
  where "mood board" finds two hundred.
- **A masonry wall, not a grid.** References arrive at every aspect ratio and
  cropping them all square defeats the point of judging a composition.
- **Licence travels with the picture.** Unknown stays unknown rather than
  becoming a claim nobody can support, and a pin keeps its link back to the pin.
- **Remote references are mirrored before use.** Pinterest and the other CDNs
  refuse requests without a browser's referer, which would fail *inside* the
  generation provider as an unhelpful "could not read the image".

## The AI studio

Three generators and one library, integrated into the existing job subsystem
rather than bolted alongside it — so credits are checked and charged before a
provider is called, a double-submitted request returns the original job instead
of charging twice, a failure or cancellation refunds automatically, and progress
is polled from one endpoint whichever provider is doing the work.

| What | Provider | How it is used |
| --- | --- | --- |
| Prompt refinement | OpenAI GPT-4o | A short idea becomes a full generation prompt, with the session's history so "now in walnut" still means the same chair. |
| Text → 3D | Tripo3D | A written description becomes a mesh, refined first unless you turn that off. |
| Image → 3D | Tripo3D | A photograph, or a mockup you just generated, becomes a mesh. |
| 2D mockup | Nano Banana | Text to image, and native image-to-image editing so a follow-up edits the picture rather than starting a new one. |
| Style transfer | OpenAI vision | A reference image is read for palette, lighting and materials, and that description is written into the prompt. |
| The assistant | OpenAI GPT-4o | Sees the plan and can act on it. |

**Everything generated is mirrored onto Novira's own storage** before it is
recorded. Provider URLs are signed and expire; a saved plan referencing one
would break within the week.

**The refined prompt is shown, not hidden.** A designer who cannot see what was
actually sent cannot learn to ask better, and a tool that quietly rewrites your
words is one you stop trusting.

### The assistant

Three tabs, and the difference between them is stated rather than hidden,
because a designer needs to know which answers are computed and which are
generated:

- **Ask** — a language model that can see the plan: every object, its type and
  its position in millimetres. It answers questions and can select, move,
  rotate, duplicate, finish, focus and generate. Every operation it performs is
  in one closed list, goes through the editor's own store, and therefore through
  undo — so the worst an unexpected suggestion can do is one Ctrl+Z. Each action
  is reported back in plain English as it happens.
- **Layout** — the built-in concept engine. Instant, free, deterministic, and
  the only one of the three that produces real dimensions.
- **Brief** — the full concept generator, with photo analysis.

**Smart suggestions** are offered on request rather than on a timer. Advice that
interrupts every two minutes is advice people learn to dismiss without reading;
a suggestion is worth something only when someone has paused, which is exactly
when they open the assistant. The model is given the plan and told to name a
real object, a real gap, a real count — "consider the lighting" is worse than
silence.

**The rule underneath all of it: the model reads, the engine builds.** A
language model asked for "a stage 9.7 m wide" will confidently give you 9.4,
and in a tool that prices what it draws that is not a rounding error, it is a
wrong invoice. Every dimension comes from arithmetic.

### Inspecting before committing

A thumbnail is one angle a stranger chose. For a 3D asset that is not enough to
decide with — you cannot see whether the back is modelled, whether the
proportions are right, or whether it is one chair or a chair welded to a floor
plane. So every card in the measured catalogue, the online libraries and the AI
library opens a **real viewer**: the actual file, orbitable, on a studio
backdrop, with its measurements and licence beside it.

Models are normalised on the way in — centred on their footprint, sat on the
ground, longest edge scaled to one unit — because files arrive at wildly
different scales and origins, and without it half of them appear as a speck and
the other half as a wall of texture. Materials are copied rather than shared, so
the preview cannot mutate a model that is also in the plan behind it. Cards also
turn into a live spinning preview when the cursor rests on one for a moment —
on a dwell rather than on hover-enter, because a cursor crossing forty cards
would otherwise open forty WebGL contexts on the way past.

Both are skipped entirely on a machine running WebGL on the processor, which is
already struggling with the editor's own context; opening a second one there is
how you lose both.

## Design decisions worth knowing

**Integer millimetres everywhere.** Floats drift under repeated snapping;
integers do not. Imperial is a display concern and rounds to the nearest quarter
inch, the increment the trade uses — without that, a table built at exactly six
feet displays as `6' 0.01"`.

**One JSON scene document per plan.** The editor loads and saves a scene whole.
The document carries a `schemaVersion` and is migrated on read.

**Credits are an append-only ledger.** Cycle grants, purchases with expiry, pool
transfers, debits and refunds must all be reconstructible.
`credits_remaining` is a cache; `recompute()` rebuilds it from the ledger, and
the admin console can run that across every account.

**Generated objects are derived, not edited.** A Table Designer group stores its
parameters and owns its output, which is what keeps chairs and covers in step.

**One job subsystem for all AI.** Credits are charged at enqueue and refunded
automatically on failure or cancellation, so a provider outage cannot cost a
user anything.

**Every AI feature has a free manual path.** Wall tracing falls back to drawing;
a render falls back to the viewport. An outage degrades the product rather than
breaking it.

---

## Bugs that were fixed properly

Each was traced to a single cause and fixed there rather than papered over. The
first two were found while building the original editor; the rest were found by
driving it in a browser, and every one of them was a real defect rather than a
test that needed adjusting.

**A pasted link on an LED wall destroyed the scene.** Content was loaded through
react-three-fiber's `useLoader`, which works by throwing a promise for Suspense
to catch. When that promise *rejects* — a typo, a link to an HTML page, a host
that refuses hotlinking — the rejection escapes the Suspense boundary as an
uncaught error, unmounts the Canvas and takes the WebGL context with it. The
whole plan went white. It also cached the failure globally, so the same URL
could never be retried without a reload. The texture is now loaded by hand, a
failure leaves a blank screen and nothing else, and content is fetched
server-side and re-encoded onto our own host — which fixes hotlink refusals and
keeps the canvas untainted, so PDF export, the plan thumbnail and AI Enhance
keep working. Images can be searched, uploaded or linked.

**A malformed stand took the whole viewport with it.** `booth.walls.map` on a
document written by an older build threw inside a react-three-fiber subtree,
which does not fail quietly. A stand drawn with no walls is visible and fixable;
a white screen is neither.

**Save view locked the tab for twelve seconds.** Capture forced a fresh
`gl.render()` immediately before reading the canvas back, which is a reasonable
thing to do when the drawing buffer is not preserved — except that it is, and
has been since the Canvas was written. A synchronous render from inside a click
handler followed by a read of the same canvas makes the browser flush the whole
pipeline and wait: **6.2 seconds** on a plan containing the Almasi Ballroom,
against **4 ms** for the same read without it, and the autosave preview paid the
cost a second time. The forced render now happens only when the buffer genuinely
would be blank. The click handler went from 12.9 s to 12 ms — and what gets
captured is exactly the frame the designer was looking at, which is also the
more correct answer. The thumbnail path was rebuilt while it was open: it used
to encode a full-size PNG and throw it away to produce a 320 px JPEG.

**A dragged object accelerated away from the pointer.** Right-dragging read the
cursor's ground position by raycasting the scene — and hit the *move gizmo*,
which three's `TransformControls` builds as an unmarked subtree parked on top of
whatever is selected. So the ground position came back roughly the height of the
gizmo out, every frame, and the error compounded: a chair pushed 140 px finished
3.4 m away and 217 mm off the floor. Picking now walks the whole ancestor chain
and skips anything that is interface rather than design — the gizmo, helpers,
and the object being dragged, which is permanently under the cursor for the same
reason.

**A toast sat on the bottom toolbar.** `bottom-4` put it squarely over Save
view, Start from and the read-out, with `pointer-events-auto` on each toast, so
it took the clicks too. Toasts now clear the 44 px bar.

**A toolbar that measured the wrong thing.** Tailwind's `md:` and friends ask
how wide the *window* is, and the bottom bar does not span the window — the left
rail, an open panel and the properties sidebar all take from it. On a 1600 px
screen with both sidebars out the bar is 886 px, so window-based classes kept
full labels for a row that had already pushed Save view and Start from off the
end. It now measures itself and drops text on a ladder: the help link first, then
the button labels, then the read-out.

**Opening a plan set in a real building faced a blank white wall.** The stored
camera sits nine metres from the origin, which is *inside* a room fifty-one
metres across. Framing has to wait for the glTF to arrive — before that the
bounds are four constraint markers and nothing else — so it now happens when the
venue's geometry mounts, and only when the designer has not already moved the
camera themselves.

**A first-run tour that ate clicks in the middle of the plan.** The tour is a
dialog — an opaque, click-absorbing rectangle — so wherever it sat was a part of
the plan nobody could draw on while it was open. Three positions were wrong for
the same reason: mid-screen it covered the thing each step described,
bottom-left it swallowed the view controls, and floating above the templates
strip it sat squarely on the floor, where two clicks meant for the ground landed
on it instead. It is now pinned to the bottom edge, taking only the strip of
plan nearest the camera, and it stands aside entirely while a real modal is
open.

**A read-out nothing could read.** The object counter was assembled from four
interpolated fragments — `8`, ` objects`, ` · `, `metric` — which render as
sibling text nodes. A screen reader announces them separately, and no phrase
match can find it. Rebuilding it as one string fixed both; a later
`capitalize` class then re-broke it by rendering "5 Objects · Imperial", which
is a heading, not a read-out. The unit is now capitalised in the string.

**A test suite that broke a different suite.** The Stripe checks verify that a
cancelled subscription drops an account to the free tier — correct behaviour,
on an account every other suite shares. Several runs later a venue-generation
test failed with a plan-upgrade notice that had nothing to do with venues. A
suite that mutates a shared fixture has to put it back, and that one now does.

**A malformed object took the whole canvas down.** A component measuring the
plan's extent read `object.positionMm.x` off every object without checking. One
row missing a transform — from an import, a collaborator, an older schema —
threw, and because that component sat *outside* the per-object error boundary
the throw unmounted the Canvas and lost the WebGL context: one bad row and the
entire editor went blank. Another boundary was not the fix. The fix was to stop
reading unvalidated document values as though they were validated: `vec3()`
returns zeros for anything missing, the object appears at the origin where it
can be seen and corrected, and the plan keeps rendering.

**A drawing tool was a trap.** Activating the wall or drafting tool gives it the
whole work column — including the control that turned it on. The only way back
was a keyboard shortcut nobody had been told about. Both panels now carry an
explicit **Done**.

**A first-run tour that fought with real dialogs.** The tour is a dialog, and it
sat over the viewport's own view controls — swallowing clicks for the very
buttons step one describes — and stayed on screen when a modal opened, leaving
two dialogs up at once. It now sits in the one region with nothing in it, and
stands aside entirely while a modal is open.

**The viewport ran at 0.4 frames per second on a machine without a GPU.** Not a
leak and not a render loop in React — a CPU rasteriser genuinely takes most of a
second to draw a fifty-object plan, and the editor was asking it to do that
sixty times a second on a scene that had not changed. Every frame was a 2.8
second long task, so the main thread was never free: a click on a rail button
took **twenty-four seconds** to register, which looks exactly like a broken
button. Turning shadows and the shaded grid off had already been done and was
not enough. The fix was to stop drawing at all when nothing has changed —
`frameloop="demand"` — which takes an idle editor to zero cost and the same
click to 200 ms. See *Rendering on demand* above for what still has to ask for
frames explicitly.

**Derived zustand selectors re-rendered forever.** `objects.filter(...)` in a
selector returns a fresh array on every store read, so `Object.is` always says
"changed" and the component re-renders without end. It hung the tab hard enough
that Playwright reported `Target crashed`, with nothing in the console.

*Workaround:* subscribe to primitives, derive in `useMemo`.
*Fix:* every derived selector now goes through `editor/selectors.ts`, which wraps
`useShallow`. You cannot use one of those hooks and reintroduce the loop.

A related flaw surfaced while testing it: camera and grid toggles were routed
through `commit`, deep-cloning a 55-object scene and pushing an undo entry on
every keypress. View preferences now use `commitQuiet` — stored, but not an edit.

**drei's `<Environment>` killed the renderer on software WebGL.** Fetching a
multi-megabyte HDR and building a PMREM cubemap from it took the tab down.

*Workaround:* delete image-based lighting entirely, use three analytic lights.
*Fix:* the HDRs are mirrored locally at 1k (`npm run assets:hdri`), the renderer
is asked what it can do before one is loaded — software rasteriser, missing
half-float support, or a small texture limit all skip IBL deliberately — and an
error boundary contains any failure so the scene keeps its analytic lighting.
Verified by cycling all 12 presets on a SwiftShader backend without a crash.

---

### The Add panel froze the whole editor

The worst of the five, because it did not look like a bug in the thing that was
broken. Clicks anywhere in the editor simply stopped landing — no error, no
warning, nothing in the console.

The catalogue was `flex-1` with an `h-full` child, inside the work panel's
`overflow-y-auto` column. A percentage height inside an auto-height scroller has
no stable answer: the content sized the container and the container sized the
content, and the layout re-solved every frame. Measured at **2 frames per second
with 3-second long tasks**; with the canvas hidden the same page ran at 57.

*Fix:* the catalogue is given a definite height. A percentage height needs a
definite parent, and "it renders correctly" is not evidence that it does.

### Every new truss started in an error state

The truss catalogue is ordered lightest to heaviest, which is the right order to
*read* it in — you pick the smallest section that carries the load. The builder
then defaulted to the first entry, which is a two-chord decorative ladder rated
to 4 m. An 8 m goalpost, the most common thing anyone would add, was over span
before they had touched a control.

*Fix:* `defaultTrussSystemForRegion` picks the market's general-purpose box
truss. The data stays ordered by duty; the product picks a sane starting point.
Two different questions, two different answers.

### The build tabs did nothing while anything was selected

"The tool follows the selection" is the right behaviour for *opening* the truss
builder when you click a truss. Implemented as a derived value it also meant the
tabs were inert: pressing LED with a truss selected recomputed straight back to
truss on the next render.

*Fix:* the tool follows a *change* of selection rather than the selection
itself, and choosing a tab by hand clears the selection — because switching tool
means starting something new.

### A tall dialog was clipped with no way to scroll

`Modal` was a box that grew with its content and was then cut off by
`overflow-hidden`. Short forms were fine. Once the catalogue passed a couple of
hundred items the picker grew past the viewport and everything below the fold
became unreachable — not merely awkward, *clipped*, so a click aimed at it
landed on the backdrop instead.

*Fix:* the header and footer are pinned, the middle scrolls, and the frame never
exceeds the viewport. Focus is now trapped inside the dialog and returned to
where it came from, which was missing for the same reason: nobody had tried to
use one with a keyboard.

### The editor was unusable without a GPU

Already known for image-based lighting, which is guarded. Shadows were not.
On a software rasteriser a shadow map is a second full scene pass every frame,
and the machine most likely to be running one is exactly the machine the brief's
"usable by all kinds of users" is about — a laptop in a venue, a locked-down
office build, a remote desktop.

*Fix:* the renderer is asked what it is, the same way the environment loader
already asks. On a software backend shadows are off, the device pixel ratio is 1,
and the infinite grid becomes plain line segments. Losing a shadow is
acceptable; losing the session is not.

---

## Scene resilience

One bad asset used to destroy the whole editor. A catalogue model that could
not be fetched threw during render; `Suspense` handles the *pending* state of
`useGLTF` but not a rejection, so the error propagated to the `<Canvas>`,
React unmounted the tree, the WebGL context was lost, and the entire plan
vanished. With hundreds of models arriving from external sources, some will
always fail — that had to become survivable rather than fatal.

Three layers now, all verified by `scripts/test-crash.mjs`:

1. **Reachability gate.** drei reports a load failure from an async callback,
   outside React’s render phase, where no error boundary can intercept it.
   So the loader is never handed a URL that will fail: one cached HEAD request
   per distinct URL, shared by every placement of that model.
2. **Per-model boundary.** Guards a file that is reachable but malformed; it
   degrades to a placeholder box.
3. **Per-object boundary.** A structurally broken scene object — one missing
   its `positionMm`, say — used to throw on every frame and take the Canvas
   down exactly like a bad URL. It now simply disappears and the rest of the
   scene renders.

A related fault sat underneath: static assets were served under the API’s own
credentialed CORS policy, which lists one exact origin. When Vite fell back
from port 5174 to 5175 because 5174 was taken, every model fetch failed as an
opaque CORS error. Catalogue assets are public files fetched by WebGL, and a
glTF plus its `.bin` and textures are separate requests where one blocked
texture taints the whole model — so they are now served with a permissive
cross-origin header, which is correct for credential-free public files rather
than a loosening of the API’s own rules.

## The branding engine

Dimensional lettering and artwork — the part of the platform where a client’s
identity goes into the room. For a lot of events this *is* the brief, not
decoration bolted on afterwards.

**Extrude and intrude are one signed depth, not two modes.** Positive depth
stands letters proud of their backing; negative cuts them into it. The control
is a single slider that crosses zero, which is push/pull — the interaction
people already know from SketchUp. Engraving forces a backing panel on, because
you cannot cut into nothing.

The engraving is an inset rather than a boolean subtraction, and that is worth
being explicit about: a true CSG cut gives a better silhouette at a grazing
angle, but it has to re-run on every keystroke while someone types. An inset is
exact from the front and any normal viewing angle, and it stays interactive.

**Finishes come before sliders.** "Brushed metal" is something a fabricator
quotes; `metalness 1, roughness 0.38` is not. Twelve named finishes cover what
gets made — matte through to neon, backlit, frosted acrylic and mirror — with
the raw `MeshPhysicalMaterial` values underneath for anyone who wants them.

Two of those are the features most often asked for by name:

- **Emission** — "make it glow". A colour and a brightness, with the note that
  above 1 it blooms and that it lights itself rather than the room.
- **Transmission** — glass and acrylic, with thickness and refractive index
  (1.49 acrylic, 1.52 glass). Frosted is transmission with high roughness.

Artwork is a solid panel carrying the image, not a floating quad, so it reads
correctly beside furniture and casts a sensible shadow. `emitFromImage` feeds
the same texture into the emissive channel, which is the actual difference
between a lightbox and a panel with a lamp pointed at it.

Images come from **Openverse**, which needs no key and — the reason it was
chosen over a stock site — reports the licence per result. Results are filtered
to licences permitting commercial use, and the credit line travels with the
image into the scene and out into the proposal. Imported images are copied onto
our own host first: a remote texture taints the WebGL canvas, which silently
breaks both PDF export and AI Enhance.

Two things caught in testing and fixed:

- Openverse caps `page_size` at **20** for anonymous requests and answers 401
  above it. A blanket `catch` was swallowing that, so a plain configuration
  error looked like "no artwork matched". Failures are logged now.
- Metals rendered **black** wherever IBL was unavailable, because
  `scene.environment` was null and a polished brass monogram had nothing to
  reflect. A generated `RoomEnvironment` is now installed as a floor, costing no
  download.

## Guest list and seating

The guest list belongs to the **project**; seating belongs to a **plan**. That
split is the design: an event has one list of people, but a planner will try
several layouts for them, and duplicating the list per layout is how names get
lost.

The chart is the layout read back rather than a second drawing. Tables come from
the scene document and seat positions from the same `layout.ts` the Table
Designer uses to place chairs — so moving a table in the editor moves it on the
chart, and a seat on the chart is the chair a guest will sit in.

Auto-seating places **whole households first, largest first**, the way you pack
big boxes before small ones. It is deterministic, so re-running it does not
reshuffle a chart someone has already reviewed, and it respects seats set by
hand. Dropping a guest onto an occupied chair displaces the occupant to
"anywhere at this table" rather than refusing — dragging onto a taken seat is a
normal thing to do.

The checks it runs are the mistakes that actually happen: more guests than
chairs, a household split across tables, someone seated at a table since
deleted, guests who declined still holding a seat, and access requirements not
yet placed.

Guest lists arrive as spreadsheets, so the importer maps columns by heading in
any order and reports rows it could not read rather than dropping them — a
guest quietly missing is exactly the failure the feature exists to prevent.

## Suppliers, stock and quoting

These three are one chain, and the link that makes it work is `catalogItemId` on
an inventory row, tying stock to the 3D model that represents it. Once that
exists, a layout can be costed: place forty Chiavari chairs, and the system
knows you own twenty-four, must hire sixteen, and what that costs.

"Committed" sits beside "owned" because owning twenty chairs means nothing if
eighteen are already promised to another event that weekend.

**Build from layout** generates the quote from what is in the plan. Regenerating
replaces only the lines that came from the layout — labour, fees and
hand-written items survive, because those are the parts a planner has thought
about and would be furious to lose.

Money arithmetic lives in `shared/quoting.ts` under three rules:

1. **Everything is an integer** — amounts in minor units, rates in basis points,
   quantities in thousandths. No float touches a money value, because
   `0.1 + 0.2` is not `0.3` and a proposal is exactly where that shows.
2. **Round once, at the line.** The subtotal is the sum of already-rounded
   lines; rounding at the end produces totals that disagree with the visible
   line amounts.
3. **Discount before tax**, so tax is charged on what is actually paid.

A proposal-wide discount also reduces the taxable base proportionally —
discounting the total while taxing the full subtotal would charge tax on money
the client never pays.

The client link carries no internal costing: stock levels, unit cost and
inventory ids are absent from the response rather than hidden in the UI, which
is the only version of that guarantee worth having.

## 2D drafting

A layout is a working document. Someone on site has to read where the cable run
goes, how far the bar is from the wall, which route must stay clear. None of
that is furniture.

Eight tools — line, polyline, rectangle, circle, arc, dimension, zone and label —
drawn as flat geometry at a chosen elevation rather than as a screen overlay, so
they stay registered with the room when the camera moves. A dimension is most
useful looking straight down but has to still be right when the model is spun
for a client. Elevation means a ceiling rig plan is drawn where the rig is.

Presets are named for the job — fire egress, cable and services, zone, keep
clear — because "fire egress" is a decision and "red dashed line" is only how it
looks.

**Snapping is ordered by what a draughtsman expects:** wall endpoints beat
midpoints, both beat the grid, and an orthogonal constraint catches a
nearly-straight run before the grid does. Clicking near the end of a wall almost
always means exactly there — which is the difference between a dimension reading
5.00 m and one reading 4.97 m for no visible reason. A genuine diagonal is left
alone.

## Collaboration

Presence and live scene updates over one WebSocket per plan, sharing the HTTP
server so a single origin covers both.

**Being straight about the sync model:** this is last-writer-wins over the whole
scene, not operational transform and not a CRDT. Every update carries a version;
a client whose edit was built on a stale version is told to re-sync rather than
having its work overwrite newer edits. Concurrent edits to *different* objects
merge cleanly; concurrent edits to *the same* object resolve to whoever saved
last. A CRDT is the correct answer for simultaneous editing of one object and is
a significant piece of work in its own right.

That limitation is why presence carries the weight here. Cursors are drawn **in
the scene**, not on the screen, so two planners looking from opposite sides see
each other pointing at the same chair, and a ring marks whatever a colleague has
selected. Seeing that someone is holding a table is what prevents the collision,
rather than resolving it afterwards.

One connection is shared per plan by reference counting. The header and the
viewport both want presence; if each opened its own socket the server would see
two participants for one person, and a planner working alone would watch their
own ghost move around the room.

## Making the builders look like the thing

Procedural geometry is easy to get *dimensionally* right and still have it read
as a toy. What gives it away is never the overall size — it is the ends, the
joints, and how many members there are.

### Truss

The chords were fine. Everything a rigger's eye goes to first was not.

- **A continuous Warren web.** The diagonals zig-zag between two chords and
  *meet* at the panel points, rather than each panel carrying its own
  disconnected stroke. Panel pitch is per-system and it is the single most
  recognisable thing about a length of truss at a glance.
- **Uprights where the data sheet has them.** The V in Prolyte's H30V and H40V
  is literally a vertical at every panel point; the F-series is pure Warren and
  has none. `bracePattern` on each system says which.
- **Real brace diameters.** F34 runs a 50 mm chord against a 20 mm brace, H30V
  a 48 against a 16. Drawing the brace as "some fraction of the chord" is how
  truss ends up looking like a toy.
- **Ends that are closed.** Every open end gets uprights across each face and
  the flange plate a conical coupler bolts into. This is the fix for the ends
  looking wrong.
- **Visible section joints.** Truss arrives in stock lengths and is coupled
  together, so a real 12 m run has a band of flanges every 3 m. One unbroken
  extrusion was the other half of why it looked unreal.
- **Corner blocks.** A 90° corner is not two runs mitred into each other; it is
  a separate welded cube that both runs bolt into. The chords are trimmed back
  to make room and the block is drawn.
- **Five draw calls, not thirteen hundred.** Everything is instanced, one mesh
  per named part, regardless of the run's length.

### Tents

The whole point of a frame tent — the reason it costs what it costs — is that
**nothing comes to the ground inside it**. Aztec's copy for the Jumbotrac puts
it in six words: *"no poles that come to the ground in the interior space."*

The old builder put a leg at every bay division across the gable ends as well,
which drove three uprights through the middle of each end wall of a 12 m tent.
Nobody rigs a tent that way, and it is why a quick layout came out looking like
scaffolding.

What is built now, per bay line, is a **bent**: two legs, two rafters to a crown
fitting, and a knee brace at each eave. Bents are tied along the length by an
eave beam each side, a ridge, and purlins up each slope — one on a 6 m span,
three on a 25 m one. The end bays are cross-braced, because a rectangle of
pin-jointed members is a mechanism until a diagonal triangulates it. Section
scales with span, from 100 × 48 mm pipe on a small frame tent to 220 × 110 mm
extrusion on a 25 m clearspan, which are the profiles the manufacturers publish.
The fabric sags a few centimetres between bents and lies *on* the purlins rather
than through them.

Two families are offered, because they are genuinely different structures:
imperial-sized **frame tents** up to 12 m, and metric **clearspan** bays from
10 m to 25 m.

### Stage, stand and screen

- The **deck frame** is geometry rather than a wireframe overlay: a bright
  aluminium perimeter extrusion against the dark top, which is how the
  modularity reads at any distance.
- A stage over 600 mm gets **diagonal bracing** in its leg bays — on the sides
  that are not skirted, since a brace in front of a skirt panel is in front of
  the thing that exists to hide it.
- A shell scheme gets its **system frame**: octanorm posts at roughly a metre
  with infill between them. Without it a stand is three blank rectangles, which
  is a partition wall.

### Materials, part by part

Every builder now names its parts in `userData.part` — `chords`, `bracing`,
`corner-blocks`, `rafters`, `purlins`, `canopy`, `deck`, `deck-frame`, `skirt`,
`guardrail`, `fascia`, `cabinets` and the rest. Two things follow: dragging a
finish onto a surface lands on that member alone, and the Finishes list in the
properties panel finally has something to list for procedural objects.

Clicking a row in that list **aims** the material library at that part, which is
the half dragging cannot do — a truss chord seen edge-on, the underside of a
deck, and a booth's kick plate are all but impossible to hit with a cursor.

### Drawings in the pickers

A dropdown reading "F31 triangle / F34 square / H30V" asks the reader to already
know the difference. Each choice now carries a small drawing generated from the
same specification the geometry is built from — the truss cross-section beside a
length of elevation at its real panel pitch, a tent's end elevation with its two
legs and nothing between them, an LED wall's actual cabinet grid. Being drawn
rather than photographed means it is the *exact* section rather than a stock
photograph of some truss, it cannot drift out of date with the catalogue, and it
costs nothing to download.

## The procedural builders, and what was wrong with them

All four shipped in a state where the parameters were right and the output was
not. They are worth writing down because each failure had a single specific
cause, and none of them would have been caught by testing the numbers.

### The venue threw its own model away

Generating a venue built a complete GLB — walls with door and window openings
cut through them, roof, columns, glazing — and then `applyToPlan` used only the
wall blueprint and dropped the mesh. A generated ballroom arrived as four bare
white slabs, which is why it looked as though the feature did nothing at all.

The mesh is now placed, and the wall segments are deliberately **not**: the
walls are already in the model, and adding segments in the same millimetres
would z-fight and, worse, brick up the doorways, since editor wall segments
carry no openings. The floor polygon is kept, because area and seating capacity
are measured from it.

A second fault surfaced while fixing that one: `rebuildBlueprint` *derives*
floors from wall segments, so handing it floors with no segments returned
nothing and the floor was silently lost.

The venue also arrives **locked**. It is the room; nudging it while placing
furniture inside it is never what anyone meant to do.

### The tent roof was a gable that shaded like a sheet

The geometry was correct — ridge at the peak height, eaves at the eave height —
but the two roof slopes *shared* their ridge vertices, so `computeVertexNormals()`
averaged the normals along the ridge and shaded the roof as one smooth surface.
A 24° gable rendered as a flat plane. It is built from non-indexed triangles
now, so every face gets its own normal and the ridge is a crisp line.

A tent is also a frame with a cover over it, so there is now a ridge beam and a
rafter at every bay, plus the valance that hangs from the eaves. That matters
most with the canopy hidden — the most-used control on the object — where an
empty rectangle of poles told a planner nothing about where the structure lands.

### The stage was black on black

The deck defaulted to `#2f3136` and the skirt to `#1a1a1d`. Every edge, leg,
seam and skirt panel merged into one silhouette, so a 4 × 6 modular deck and a
single black block looked identical — and the parts list beside it stopped
making any sense.

The deck is a mid-grey non-slip tone now, the skirt clearly darker, and every
deck carries an aluminium edge frame so the modular grid reads at any zoom.

### The drape handles did nothing

The nine control points were drawn as plain spheres with no interaction
attached at all. They looked exactly like an affordance and were purely
decorative, which is worse than not drawing them.

Each one now edits the property it sits on — the side handles set how far that
row reaches out, the centre handles how far it bows forward — dragging against
a plane facing the camera so the handle tracks the pointer whatever the view.
Each also carries an invisible hit sphere several times its visible size: a
55 mm dot is the right size to look at and the wrong size to grab.

### Interface

The transform toolbar was a bar floating over the selection. It moved every
time the object moved, so the button you wanted was never twice in the same
place, and it covered whatever sat behind the selection — which in a room full
of tables is always something you need to see. It is now a fixed rounded pill
at the top of the viewport.

The rotate gizmo showed all three rings, which let someone tip a banquet table
onto its side by grabbing the wrong one. Furniture in a room turns about the
vertical axis and nothing else, so rotation is yaw only, with a live angle
readout and the snap increment shown beside it. Objects that genuinely tilt are
still edited numerically in the properties panel.

Arrangement presets were text-only buttons — "Rows" and "Grid" are different
things, and from the words alone nobody can tell which is which. Each one now
carries a diagram **generated by running the real layout function**, so the
picture cannot promise something the result does not deliver.

And a **Fit** control, because a generated venue is twenty-odd metres across and
arrives centred on the origin. Framing has to be driven through OrbitControls
rather than by moving the camera: the controls keep their own spherical position
and write it back every frame, so a camera moved behind their back snaps
straight back — which is exactly why the first attempt appeared to do nothing.

### Reference material

The reference product publishes six demo videos. All six are now decoded to
frames in `storage/research/frames` — 193 from the ten-minute walkthrough and
302 from the other five, 495 in total.

Getting at the five took three separate obstacles:

1. **They are HLS, not mp4.** `ffmpeg-static` supplies a prebuilt binary, so no
   system install is needed.
2. **The playlist URL is signed and short-lived.** Playwright loads the embed
   and intercepts the signed `.m3u8` request as the player mints it.
3. **The playlist names its segments by bare filename.** Any player resolving
   those against the playlist URL drops the query string, so every segment
   arrives unsigned and 403s. The playlist is fetched, each segment rewritten
   to an absolute URL carrying the same signature, and the rewritten copy given
   to ffmpeg — which additionally needs `-protocol_whitelist` to follow https
   from a local file, or it reports "Invalid data found" and looks like a
   corrupt stream rather than a refusal.

One detail worth recording: computing the base URL with `lastIndexOf("/")`
before stripping the query silently produces nonsense, because a CloudFront
signature is base64 and routinely contains a slash.

An earlier attempt read frames out of the rendered player instead. It reported
every one of those videos as five seconds long — the player only knows about
the range it has buffered. The real durations are 33 s, 33 s, 26 s, 47 s and
160 s.

### What the videos covered, and what they changed

The five previously-unread videos are: image-to-3D, the tent interior,
floor-plan calibration, the stage builder, and the procedural curtain. The last
two confirmed the rebuilds described above were right in shape — same footprint
rows and columns, same per-side stair bays, same nine curtain control points
driving the same widths, curve depth and bend.

Two of them exposed features that existed but could not be reached:

- **The floor-plan tracer had no button.** `services/floorPlanTrace.ts` and
  `POST /ai/trace-walls` both worked; nothing in the interface called them.
  Calibration now ends the way the reference does, with two routes out — trace
  it by hand, or have it traced for you.
- **A generated model could not be saved.** The panel told people to set a real
  height "before saving it to the catalogue", offered no way to save, and
  `POST /ai/save-to-catalog` sat there unused. It now has the form the copy
  already promised.

Both were the same class of fault as the drafting and lettering bugs: working
code with no way in. None of them throws, so none would ever appear in a log.
---

## The spatial operating system

The product started as a 3D event planner. It is now the thing the brief asked
for: **the operating system for spatial projects** — creative, operational and
commercial in one place, so that an agency that does not use it is at a
disadvantage rather than merely using something different.

The layer that makes that true is not the 3D. It is that **every number a job
depends on is derived from the drawing**:

| You draw | It already knows |
| --- | --- |
| A truss run | Its length, section list, weight, load per support, and whether the span is legal |
| An LED wall | Cabinet count, square metres, resolution, weight, power draw, viewing distances |
| An exhibition stand | Wall area, print area, floor, volume, capacity, and whether the organiser will approve it |
| A lighting rig | Fixture list, wattage, current, circuits, DMX universes, weight |
| A room | Escape widths, travel distances, sightlines, aisle widths, crowd density |
| Any of it | What it costs, against your own rates |

Nothing on that right-hand column is entered by a human. Change the drawing and
every one of them changes with it, which is the difference between a model of an
event and a plan for one.

---

## Truss, LED and stands

Three object types that are **specified rather than picked**, and the reason the
product can produce an equipment list at all.

### Truss is a path, not a box

A goalpost, a mother grid and an entrance arch differ only in their points, so a
truss run is a polyline with a trim height — the same shape a wall is. From that
alone the parts come out: sections packed from real stock lengths longest-first
(the way a warehouse loads a truck), corner blocks, uprights, base plates or
towers, and the total mass.

Ten sections are catalogued, from a two-chord decorative ladder to a 520 mm
arena box, each with the numbers a rigger checks — chord count, section size,
weight per metre, safe span, and **which markets stock it**, because a section
nobody local holds is a section on a boat.

The span check is the point. An 18 m run on F34 is not a design decision, it is
a mistake, and the panel says so while the slider is still moving rather than
after a rigger reads the drawing.

### LED is a count of cabinets

A screen is a panel type and a number of columns and rows. Width, height,
resolution, weight, power and viewing distance are all derived, so they cannot
disagree with each other.

The control that matters is the one that is *not* a slider: **a target size is
fitted to whole cabinets, and the panel reports what was actually built.**
Asking for 10 m of P3.9 gets 20 columns — exactly 10 m — but asking for 10.2 m
gets 10 m too, and being told that is the difference between a plan and a
promise the hardware cannot keep.

Curves are faceted, not smooth, because cabinets are flat. Drawing a smooth arc
would depict a wall that cannot be built.

### A stand knows the show's rules

Exhibition floors are sold on a grid and every organiser publishes rules for it:
how tall you may build, how long an unbroken wall may run, whether the back of a
wall facing a neighbour must be finished, whether a raised floor needs a ramp.
Those rules are the difference between a design that is approved and one rebuilt
on site at the contractor's cost, so they are checked live rather than left in
an email.

The floor layout tool is the other half: back-to-back rows so one aisle serves
two, stand numbering in the A1/A2 convention organisers use, and the whole hall
laid out in one press.

A 10 ft booth is 3048 mm and a 3 m booth is 3000 mm. They are offered as
separate sizes and the region pack decides which is the default, because mixing
them on one floor is a mistake that is only discovered on site.

---

## Site constraints, and the venue library

A design that ignores the building is a picture, not a plan. The things that
actually stop a build are always the same handful — you cannot go higher than
the roof allows, hang from a point that is not there, find power on the far side
of the hall, or block a fire exit — and all of them are spatial.

So they live **in the scene**, as real geometry: height limits as volumes,
rigging points at their real height with their safe working load, supplies with
their current and phase, exits with their clear width, truck routes sized for
the vehicle that has to use them. Being in the scene is what lets the plan check
itself.

### The venue library is a specification, not a photograph

The brief's claim is that an agency does not need a site visit to pitch. That
only holds if the record carries what a site visit is *for*, so a venue here
records:

- **clear height under the lowest obstruction**, not at the ridge — the figure
  venues quote least accurately and the one everything depends on;
- pillar positions, floor loading, point load, whether the floor is level, and
  whether fixings are permitted at all;
- the largest vehicle that reaches the door, the door's clear size, whether
  there is a dock, how far the push is, and the lift if there is one;
- power available and where it lands, generator access, whether haze is
  permitted, whether house lights dim, any sound limit;
- build curfew, exclusive suppliers, flame and confetti policy.

**Capacity is derived, not entered.** Venues publish figures computed on an empty
rectangle with no columns and no stage; deriving it from the geometry, less
circulation and less the floor each column sterilises, gives the number the room
will actually take.

One click applies a venue to a plan, and every one of those figures becomes
checkable geometry. Constraints that came from a venue are **locked** — they
describe the building, not the design, and someone dragging a fire exit to make
room for a bar is not a workflow worth supporting. Hand-drawn constraints are
kept when a second venue is applied, because silently deleting a planner's own
keep-clear zones is exactly the kind of quiet data loss that makes people stop
trusting a feature.

---

## The lighting engine

Lighting is what separates a render that looks like a plan from one that looks
like the event, so the controls are the ones a lighting designer reaches for —
fixture type, beam angle, intensity, colour, gobo — not the renderer parameters
underneath them.

**Fixtures are named, not numeric.** "Source Four 26°" is something you hire;
`spotLight, angle 0.227` is not. Fourteen fixture types carry their real beam
angle, output, wattage and weight, so the same object that lights the render
also feeds the power budget and the equipment list.

**Auto Light Scene is a rig, not a filter.** It finds the stage, the screens and
the tables, and hangs a key at 45°, a fill opposite and lower, a back rim behind,
a wash across any backdrop, uplighters around the perimeter derived from its
length, and accents on anything worth picking out. Fixtures placed by hand are
kept; only the previously generated ones are replaced.

The six looks — corporate summit, gala dinner, tech launch, concert, wedding,
exhibition daylight — each define a complete relationship between key, fill,
rim, room wash, contrast, haze and ambient level. Changing one colour without
the others is precisely what makes amateur lighting look amateur, so a look
changes all of them together.

The rig reports what it needs: total wattage, current at the local voltage,
**16 A circuits at 80 % loading** (the figure an electrician designs to rather
than the theoretical one), DMX universes and total weight — which then counts
toward the flown load the venue has to carry.

---

## Quantity take-off, and what it costs

The brief calls this the one feature that makes the product unavoidable, and it
is right for a specific reason: agencies measure their own drawings by hand,
every time, under deadline, and they get it wrong.

Two rules make the output trustworthy.

**Every quantity is measured from the geometry**, never from a label. LED area
is cabinets × cabinet size. Truss length follows the path. Carpet is the floor
polygon *less what stands on it* — which matters, because on an exhibition floor
the stands are most of the area and carpeting under a solid stand is money spent
on something nobody will ever see.

**Every quantity says where it came from.** Each line carries a one-sentence
basis and the objects it was measured from, so "46 m of truss" can be clicked
and seen. A number nobody can trace is a number nobody will stake a tender on —
they will re-measure it by hand, at which point the feature has saved nothing.

### Measurement and pricing are separate on purpose

The take-off says what is in the design. A **rate card** says what it is worth.
Keeping them apart is what lets the same drawing, priced in Nairobi and in
Dubai, produce two different quotes without either touching the geometry.

A card is rates keyed by take-off code, with `PREFIX-*` wildcards resolved
longest-match-first — so a card can start at `LIGHT-*` and grow a specific
`LIGHT-beam` later without the general rate suddenly taking precedence.

Wastage is applied to the **quantity**, not the price, because that is what it
physically is: you buy 10 % more vinyl than you lay. Applying it as a price
uplift would produce a quote whose quantity disagrees with the drawing, which is
exactly what a client's procurement team looks for.

Resolution runs most-specific-first: the card the plan names, the company
default, the user default, then the built-in rates adjusted by a regional cost
index and **labelled as indicative on every line**. A plan always prices, even
on an account that has never opened the rate editor, because an estimate that
refuses to appear until something is configured is an estimate nobody ever sees.

---

## The design check

Six checks the brief names, applied to the layout as drawn: booth spacing,
screen placement, sightlines, crowd flow, fire safety, and accessibility.

Two things this deliberately does not do.

**It does not guess at rules.** Every threshold is a published planning figure
or a widely used trade rule, and each finding names the one it applied — 500 mm
of escape width per 100 occupants, 1370 mm banquet gangway, eight screen heights
to the back row, 30° maximum upward viewing angle. A warning a planner cannot
check is a warning they will learn to ignore.

**It does not silently fix anything.** Every finding carries what is wrong, what
to do about it, and a control to show it in the plan. Applying the fix is always
the planner's click; the plan belongs to them.

The score is deliberately blunt — errors cost twelve points, warnings five,
suggestions one — because it exists to be watched moving while someone fixes
things, not to be a precise measure of anything. It says so on the panel.

The rules come from the plan's **region**, and the panel names the authority:
Approved Document B and EN 13782 in the UK and Europe, NFPA 101 and IAEE display
rules in North America, the UAE Fire and Life Safety Code in the Gulf, the
National Building Code Part 4 in India, county fire authority practice in Kenya.
An automated check does not replace sign-off by the venue or the local
authority, and the panel says that too.

---

## The AI layer

One principle runs through all of it:

> **The model reads. The engine builds.**

A language model is excellent at turning "modern banking summit stage with a
curved LED wall for 400 delegates" into structured intent, and terrible at
producing a stage that is actually 9.75 m wide. So the model's only job is to
turn prose into a `ConceptBrief`. Everything after that is arithmetic — which is
why the stage is exactly the size the panel says, why the same brief always
produces the same room, and why the dimensions can be trusted downstream by the
estimator and the safety check.

Three consequences worth stating:

**It works with no model configured at all.** A built-in parser reads event
type, attendance, seating style, screens, truss, room size and extras directly
from the sentence. It is a keyword parser and the panel says so, showing exactly
which words it recognised and which it could not place.

**The preview is free and instant.** A layout appears as you type, before any
credit is spent. Running it through the language model only helps with looser
wording. Nobody has to pay to find out whether the feature is useful.

**Every placed element explains itself.** "Trimmed at 5.6 m — clear of the 7 m
ceiling and high enough for the beam angles to cover the stage" is a sentence a
planner can argue with. A stage that simply appears is not.

### Photo to layout

A photograph is analysed into objects, an estimated room size and a lighting
mood, and each object is matched against **your catalogue** — so what gets
placed is a measured model rather than a reconstruction of unknown scale. Match
scores are shown with the reason for them, and anything below a real match
threshold offers nothing rather than a plausible-looking wrong answer.

Estimated dimensions are labelled as estimates every time they appear, because a
room measured from apparent scale in a photograph is not a room that has been
measured.

### Pro Render says what it is

Fast render is the viewport at any resolution up to what the hardware can
allocate. It is free, instant, and exactly what is on screen.

Pro Render hands that frame to an image model instructed to preserve the
geometry and improve only materials, light and realism. **The layout is exact
because it comes from the plan; the realism is generated.** That distinction is
printed on the panel rather than left for someone to discover when a client asks
whether the lighting simulation is accurate.

---

## Walkthrough and video

A walkthrough is a list of **shots**, not a spline, because that is how anyone
describes one: start wide at the entrance, push in on the stage, orbit the
centrepiece, hold. Each shot owns its duration and easing, so retiming one does
not retime the rest.

Four generators — cinematic, walk through, orbit and vertical reel — derive
their camera geometry from the plan's actual extents, so the same generator
frames a 6 m stand and a 60 m hall correctly.

Easing is not decoration. A camera that starts and stops abruptly reads as a
computer moving; one that eases reads as an operator. `ease-in-out` is the
default and linear is kept only for orbit loops, where an ease produces a
visible stutter every time the loop repeats.

**Frames are rendered in the browser and encoded on the server.** That split is
deliberate: the frames come from the same renderer that draws the preview, so
the video matches what was approved on screen — a server-rendered video that
looks subtly different from the preview is a support ticket every time. The
server contributes the part a browser does badly: encoding a long sequence of
stills into an MP4 that plays everywhere, with `yuv420p` and `+faststart`,
without which the file will not play on most phones and will not start until it
has fully downloaded.

No music is bundled. Licensing a library is not something this product can do on
an agency's behalf, and the panel says so rather than shipping tracks whose
provenance nobody can defend.

---

## Execution-ready output

Five documents, all generated from the same drawing and the same measurement,
which is the only way they can be guaranteed to agree with each other.

**CAD (DXF).** Real geometry on named layers, in millimetres. Written as DXF R12
deliberately: it is ASCII, has no object handles or class table to keep
consistent, and is read by everything from AutoCAD to a laser cutter's driver —
which matters far more here than anything later revisions add. `$INSUNITS` is
declared, because a receiving system that assumes inches will scale the whole
drawing by 25.4 without saying anything. Dimensions are written as annotated
lines rather than `DIMENSION` entities, because a dimension style that does not
resolve in the receiving system renders as nothing at all.

**Technical drawing.** The same model rasterised with a title block, for a
tender pack where nobody has CAD.

**Bill of quantities.** Every measured line with its basis, exportable with or
without prices — a production team should be able to have the quantities without
the commercials.

**Material breakdown.** The same measurement seen from the workshop's side,
grouped by material rather than by trade, with truck loads derived from volume
and weight.

**Client deck.** Cover, concept, hero render, render grid, layout plan,
specification, bill of quantities, commercials, schedule, compliance and
closing. Slides with nothing to say are omitted rather than left blank. Generated
slides are regenerated from the plan on every rebuild, so they cannot drift out
of step with the drawing; the narrative is the one part a model may write, and it
is told explicitly not to state a single figure of its own.

---

## Marketplace, specialists and white label

Three platform features that share one shape — someone other than the platform
offers something — and therefore one module.

The commercial rule is stated everywhere it applies rather than buried in terms:
**the seller sets the price, the platform takes a published 20 %, and the seller
sees the net before they publish.** A marketplace where the cut is a surprise at
payout does not get a second listing. A listing sells a *copy*, snapshotted at
publish time, so editing the source plan afterwards cannot change what past
buyers own. Everything goes through review, because a marketplace where anything
can appear instantly is one nobody trusts twice.

A specialist request **carries the plan with it**: a view-only share link is
minted alongside the brief, so nobody starts by asking what the room looks like.
The link is revoked automatically when the request is declined or withdrawn —
the part a directory bolted onto a chat would never do.

White label changes three surfaces together — the app chrome, the share link a
client opens, and the exported PDF — because branding one and not the others
reads worse than branding none. The switch is gated on the pieces a client
actually sees, and the page names which are missing rather than refusing
silently.

---

## Regions

The same design is not buildable everywhere. Truss stock differs by market, so
does mains voltage, so does the module a floor is sold on, and so — critically —
do the rules an inspector applies. A plan that says "compliant" without saying
compliant *where* is worthless.

Six packs — global, Kenya and East Africa, the UAE and the Gulf, India and South
Asia, the UK and Europe, North America — each carrying units, currency, voltage
and phase, the truss families actually stocked, the booth and stage modules, the
materials a contractor can genuinely get locally, a rough cost index, and the
regulatory figures the check applies.

The notes are the useful part. Kenya: fire authority sign-off is per event, and
imported SEG fabric carries duty and a multi-week lead time, so timber and vinyl
are the local default. India: sheet stock is 8 × 4 ft, so panel layouts landing
on 1220 mm waste far less. The Gulf: double-deck and heavy rigging need stamped
structural drawings from a licensed engineer, and venue approval is a separate
process from civil defence approval. North America: booths are sold in 10 ft
modules, which is not 3 m, and 230 V fixtures will not run on 120 V.

---

## The interface

The brief asks for something usable "with no need of past experience". That is
not a visual problem, it is an information problem: people fail at software when
a control does not say what it does, what will happen, or what a sensible value
would be.

**The left rail is the map.** Nine sections, each named for what a planner is
*doing* rather than for the feature that implements it, none of them hidden
behind a menu. Names were chosen against one test — would someone who has never
used a 3D tool guess right? "Site" and "Cost" pass; "Constraints" and "Take-off"
do not, so they are not used on the rail even though they are the correct trade
terms inside each panel. Number keys 1–0 move between them.

**Explanation is structural, not optional.** The interface primitives make it
impossible to add a control without being asked what it is for: a field takes a
hint, a number field takes a range and displays it, a section takes a
description, a finding takes the rule it applied. Every question mark opens on
focus as well as hover, because a tooltip that only appears on hover is
invisible to the people most likely to need it.

**Ctrl+K searches everything by name**, matching on descriptions as well as
titles — "how much does this cost" finds the estimator — and commands that need
an open plan are correctly absent when there is not one.

**The tour walks you through the product rather than describing it.** Eight
steps, each opening the place it is talking about, dismissible at any point and
never returning unless asked for. It sits at the bottom of the screen, because a
tour that covers the model is talking about something you cannot see.

**Accessibility is a set of real controls, not a claim.** Text size at three
scales applied as a root font scale so every measurement follows it; a genuine
high-contrast palette that strengthens the two things that fail first for
low-vision users — borders that dissolve and muted text carrying information
that is not actually secondary; comfortable density with larger targets;
`prefers-reduced-motion` honoured throughout, which is safe here because every
animation in the product is decorative; a skip link; focus trapped and returned
in dialogs; and arrow-key navigation on tabs. All four device preferences are
stored per device, so a laptop in a dim venue can be set differently from a
studio monitor.

---

## Known limits

- **No mail transport.** Verification, reset and invitation tokens are returned
  in the API response in development so the flows are testable end to end.
- **The job worker runs in-process.** Correct for a single node; `enqueue` in
  `services/jobs.ts` is the seam for a real queue.
- **Stripe runs against test keys only here.** The integration is complete —
  checkout, the billing portal, and a signature-verified webhook — but no live
  key has been used. `scripts/test-stripe.mjs` boots a second API with Stripe
  configured and drives the webhook with locally signed payloads, which covers
  the handler but not Stripe's own hosted pages.
- **Collaboration is last-writer-wins.** Concurrent edits to different objects
  merge; concurrent edits to the same object resolve to whoever saved last.
  Presence is what prevents the collision. See below.
- **Engraved lettering is an inset, not a boolean cut.** Exact from the front
  and any normal angle; a grazing view would show the difference.
- **Openverse is the only image source.** It was chosen because it reports the
  licence per result, which a stock site does not, but its catalogue is
  narrower than a paid library.
- **Venue generation is procedural, not generative.** See below; this is a
  design decision rather than a shortfall, but it means it produces accurate
  building shells rather than photoreal or architecturally ornate ones.
- **Pro Render is a diffusion pass over a real render, not a path tracer.** The
  layout is exact because the frame comes from the plan; the realism is
  model-generated. The panel says so, and so should anyone presenting it.
- **The design check is not a legal sign-off.** It applies published rules of
  thumb and the figures you recorded for the venue, and names the rule behind
  every finding. The venue and the local authority still sign off.
- **Regulatory figures are compiled, not certified.** The six regional packs
  carry the rules an inspector commonly applies, with the authority named. They
  are a starting point for a conversation with that authority, not a substitute
  for one.
- **No music library ships with video export.** Licensing one is not something
  this product can do on an agency's behalf. The mood is recorded on the export
  and the track is added in an editor.
- **Marketplace payments record rather than settle without Stripe.** With a key
  the purchase runs through Checkout; without one the transaction is recorded so
  the install path works end to end, but no money moves and no payout is made.
- **The concept generator's built-in parser is a keyword parser.** It handles the
  sentences people actually type and shows exactly which words it recognised, but
  it is not language understanding. A configured language model widens what can
  be phrased; it never changes how the geometry is derived.
- **Photo analysis estimates dimensions from apparent scale.** Every figure it
  produces is labelled as an estimate. Measure the room before building a layout
  on them.
- **Shadows and the infinite grid are switched off on a software renderer.** A
  deliberate degradation so the editor stays interactive on a machine with no
  GPU. Renders and exports are unaffected on hardware that can do the work.

## Billing

Two modes, chosen by whether `STRIPE_SECRET_KEY` is set.

Without a key the surface runs through an **approval queue**: upgrades and
credit-pack purchases create a request an administrator approves. That is a real
mode rather than a stub — an invoiced enterprise deal follows exactly the same
path — and it is what the seeded local environment uses.

With a key, `/billing/subscription/change` and `/billing/credits/purchase`
return a Stripe **Checkout** URL, and `/billing/portal` opens the hosted portal
for cards, invoices and self-service cancellation. Prices are created in Stripe
on first use from our own `plan_price` / `credit_pack` rows, so nobody has to
hand-build products in the dashboard first; if an admin edits an amount, a new
Stripe price is created, because Stripe prices are immutable.

Nothing is applied on the redirect back from Checkout — returning from a payment
page is not proof that it succeeded. Tiers and credits are granted only by the
webhook, which:

- verifies the signature over the **raw** body (hence the router mounted before
  `express.json()` in `index.ts`);
- claims the event id in `stripe_event` before doing any work, so Stripe's
  retries cannot grant the same credits twice, and releases the claim if the
  handler throws so a retry gets a real second attempt;
- ignores sessions whose `payment_status` is still `unpaid`;
- drops an account to Free when its subscription lapses, while leaving credits
  already paid for alone.

## Venue generation

Generates the building itself — walls, door and window openings, roof, columns
or posts — as a GLB, plus the wall blueprint that drops into a plan.

It is **local and deterministic rather than a call to a generative model**, for
the same reason the procedural catalogue items are: a planner needs a venue whose
dimensions are exactly what they asked for, because every table, aisle and
sightline downstream is derived from them. A 24 m × 16 m ballroom has to measure
24 m × 16 m. A generative model returns a plausible-looking room of unreliable
size, which is worse than useless here.

Alongside the mesh it derives the figures a planner actually needs before
committing: floor area measured inside the walls, capacity for banquet, theatre,
cocktail and classroom layouts (using standard per-person area allowances net of
circulation), and warnings — interior columns breaking sightlines, exit width
below the rule-of-thumb allowance for the occupancy, ceilings under 2.4 m.

Preview is free and instant because it is pure arithmetic, so the sliders update
live; only building the mesh costs a credit.

Two test suites cover it, and the split earned its keep: `scripts/test-venue.mjs`
checks the derivation, and `apps/api/src/scripts/testVenueMesh.ts` measures the
built vertices. An inverted gable roof — highest at the eaves, lowest at the
ridge — passed every arithmetic check while the mesh was upside down, and only
measuring the geometry caught it.
