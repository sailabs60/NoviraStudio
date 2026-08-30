# Novira — image generation prompts

Everything the interface needs a picture for, with the prompt to generate it and
the exact filename to save it as. Drop each file into the path given and it
appears immediately — until then the layout renders a labelled placeholder at
the correct aspect ratio, so nothing breaks and nothing shifts when the artwork
lands.

---

## Where the files go, and what is still missing

**Save the generated files into `artwork/` at the repository root**, named after
the slot (`step-find.png`, `who-agency.png`, `logo-mark.png` …). The extension
does not matter — PNG, JPEG or WebP all work.

Then run:

```
node scripts/artwork.mjs          # build the web copies
node scripts/artwork.mjs --check  # list what is still missing
```

That resizes each one to where it is actually used, writes JPEG for the
photographs and PNG for the logo, and rebuilds the favicons and the app icon
from the mark. The originals stay in `artwork/`, which is not served — the
current set is 47.5 MB of PNG and becomes 2.7 MB on the page.

**Delivered:** the logo in all three colourways, the six *How it works* steps,
`library-grid`, `library-hdri`, `materials-drop`, `deliverables-spread`, the
three *Who it is for* cards, and every in-app image.

**Still open:**

| File | Where it would go |
| --- | --- |
| `library-materials` | Optional. The Libraries section is now composed as two images — the model grid with the environment sphere overlapping its corner — and reads well without a third. |
| `logo-lockup` | Optional. The wordmark is set in the interface font, so nothing needs a lockup image. |

Everything below is the original brief, kept for regenerating any single image.

---

## Before you start: the house style

Paste this paragraph at the **start of every prompt** below. It is what stops
fourteen individually good images from looking like fourteen different websites.

> **House style:** clean, bright, contemporary architectural photography.
> Cool-neutral palette — white, warm grey, pale oak, black — with exactly one
> accent colour, a vivid azure blue (#0072FD), appearing on a single element per
> image and nowhere else. Soft, even, high-key daylight; no coloured gels except
> the azure; no orange or teal grading. Shot on a full-frame camera with a
> 35 mm lens at f/4, everything in focus, no vignette, no lens flare, no bokeh
> balls. Straight verticals, architectural perspective, horizon level. Calm and
> uncluttered — negative space is wanted. Photorealistic, editorial, the look of
> a design studio's own case-study photography. No text, no logos, no watermarks,
> no signage lettering, no readable brand names anywhere in the frame.

Two more rules that matter as much as the style:

- **No text in any image.** Generators produce garbled lettering, and every
  image here sits next to real typography that will do the job properly.
- **No recognisable faces.** Where people appear, they should be at a distance,
  from behind, or cropped at the shoulder. It keeps the images usable
  commercially and stops the page from dating.

**Export settings for every image:** JPEG, quality 85–90, sRGB, longest edge
2400 px (3200 px for the two wide banners, noted below). Save with the exact
filename given — lower case, hyphens, `.jpg`.

---

## 1. The logo

The one asset that is not photography. Generate it on a transparent background.

**File:** `apps/web/public/logo-mark.png` (and `logo-mark.svg` if your tool
exports vector)

> A minimalist geometric logo mark on a **fully transparent background** — no
> canvas, no backdrop, no drop shadow, no container shape, alpha channel only.
> The mark is the letter **N** constructed from architectural drawing elements:
> two vertical strokes joined by a single diagonal, drawn as if it were a plan
> view of a truss — clean straight lines of even weight, precise right angles,
> the diagonal reading as a bracing member. Solid vivid azure blue **#0072FD**,
> one flat colour, no gradient, no bevel, no glow, no outline. Geometric,
> confident, and legible at 24 pixels. Vector-style, perfectly crisp edges,
> generous internal spacing, mathematically balanced. Centred with even padding
> on all four sides. Nothing else in the frame. Square canvas, 1024 × 1024,
> transparent PNG.

**Variants worth generating in the same run** (same prompt, one change each):

| Change to the prompt | Save as |
| --- | --- |
| "…solid **pure white** #FFFFFF, one flat colour…" | `logo-mark-white.png` |
| "…solid **near-black** #0B1220, one flat colour…" | `logo-mark-black.png` |
| Add: "…beside the mark, the wordmark **Novira** in a geometric sans-serif, medium weight, tight letter-spacing, same azure, baseline aligned with the mark, mark and word separated by a gap equal to half the mark's width. Wide canvas 2048 × 512, transparent." | `logo-lockup.png` |

A favicon already exists at `apps/web/public/favicon.svg`; replace it with your
own mark if you generate one you prefer.

---

## 2. The landing page

**All files go in `apps/web/public/landing/`.**

### 2.1 How it works — six cards

Aspect ratio **16 : 10** (2400 × 1500). These sit at the top of six cards, so
they should read at about 380 px wide: one clear subject, no fine detail.

---

**`step-find.jpg`** — *Find it*

> [House style paragraph]
>
> An overhead three-quarter view of a designer's desk in a bright studio: a
> large monitor showing an abstract dense grid of small product thumbnails, a
> hand resting on a mouse mid-drag, a paper floor plan and a scale rule beside
> the keyboard. The monitor's interface is deliberately soft and out of legible
> resolution — shapes and colour blocks only, no readable text. One azure blue
> highlight on a single thumbnail in the grid. Pale oak desk, white walls,
> daylight from the left.

---

**`step-build.jpg`** — *Build it*

> [House style paragraph]
>
> A partially built event stage in a clean white studio space: an aluminium box
> truss goalpost standing over a low black stage deck, an LED video wall behind
> it showing a flat field of vivid azure blue and nothing else. The build is
> unfinished — one truss section still on the floor, a crew ladder to one side.
> Empty polished concrete floor in the foreground. No people. Wide, symmetrical,
> straight-on with a slight three-quarter turn.

---

**`step-finish.jpg`** — *Finish it*

> [House style paragraph]
>
> A tight close-up of material samples laid in an overlapping fan on a white
> surface: birch plywood, brushed stainless steel, grey wool felt, pale oak
> veneer, dark event carpet, frosted acrylic. One sample — a small azure blue
> laminate chip — sits on top, slightly separated, catching the light. Shallow
> raking daylight, crisp shadows, top-down at a slight angle. Tactile, precise,
> no hands.

---

**`step-cost.jpg`** — *Cost it*

> [House style paragraph]
>
> A calm overhead flat-lay on a pale oak table: a folded technical drawing
> showing an abstract floor plan in fine grey lines, a scale rule, a mechanical
> pencil, and a tablet displaying a simple abstract bar chart in greys with one
> azure blue bar. No readable numbers or text anywhere. Generous white space
> around the objects, soft even daylight, gentle shadows.

---

**`step-check.jpg`** — *Check it*

> [House style paragraph]
>
> A wide empty exhibition hall interior, brightly lit, with a marked-out floor:
> crisp white and azure blue tape lines on polished concrete describing stand
> plots and a wide central aisle. A single illuminated green emergency exit sign
> is visible far down the hall, small in frame. High vantage point looking down
> the aisle, strong one-point perspective, completely empty of people.

---

**`step-send.jpg`** — *Send it*

> [House style paragraph]
>
> A clean presentation spread on a white studio table, photographed from above:
> a large-format printed architectural plan in fine grey line-work, a stapled
> booklet open to a page of abstract grey layout blocks, and a laptop showing a
> soft-focus 3D visualisation of a stage. One azure blue detail on the booklet
> cover. No readable text. Even overhead daylight, subtle paper texture.

---

### 2.2 The library section

---

**`library-grid.jpg`** — 4 : 3 (2400 × 1800)

> [House style paragraph]
>
> A large studio monitor on a pale oak desk, photographed straight on, filling
> most of the frame. The screen shows a dense grid of small square product
> thumbnails — furniture, lighting, structures — rendered as soft shapes without
> readable text, in muted greys and warm neutrals. One thumbnail is outlined in
> azure blue. The room around the monitor is bright and minimal: white wall,
> a corner of a chair, daylight from the left. Screen crisp, room slightly
> softer.

---

**`library-materials.jpg`** — 1 : 1 (2000 × 2000)

> [House style paragraph]
>
> A perfect grid of forty-nine square material swatches laid flat and
> photographed straight down, filling the frame edge to edge with hairline white
> gaps between them: timbers, brushed and polished metals, concrete, marble,
> felt, velvet, leather, carpet, frosted acrylic. Predominantly neutral, warm and
> cool greys, with exactly two azure blue swatches placed asymmetrically. Even
> diffuse overhead light, every texture legible, no shadows cast across the grid.

---

**`library-hdri.jpg`** — 1 : 1 (2000 × 2000)

> [House style paragraph]
>
> A two-by-two grid of four small square photographs, hairline white gaps
> between them, filling the frame: (1) a white photographic studio corner with
> softboxes, (2) an empty industrial warehouse interior with high windows,
> (3) an open sky at golden hour over a flat horizon, (4) a modern glass atrium
> from below. All four bright, clean and architectural, sharing the same
> cool-neutral grade. No people, no text.

---

### 2.3 Materials section

**`materials-drop.jpg`** — 4 : 3 (2400 × 1800)

> [House style paragraph]
>
> A single contemporary upholstered dining chair on a white seamless background,
> lit evenly, photographed at a three-quarter angle. Its frame is pale oak, its
> legs are brushed steel, and its seat cushion is a deep azure blue textile —
> the three materials clearly distinct from one another. A small stack of fabric
> swatches rests on the floor beside the chair. Product photography, crisp
> shadow beneath the chair, nothing else in the frame.

---

### 2.4 Deliverables banner

**`deliverables-spread.jpg`** — 21 : 9 (3200 × 1370)

> [House style paragraph]
>
> A wide overhead flat-lay across a white studio table: from left to right, a
> large-format architectural floor plan in fine grey line-work, a technical
> elevation drawing, a stapled presentation booklet open flat showing abstract
> grey layout blocks, and a tablet displaying a soft 3D render of an event
> space. A scale rule and a pencil lie across two of the sheets. One azure blue
> element on the booklet. No readable text or numbers. Even overhead daylight,
> generous white margins, very shallow shadows.

---

### 2.5 Who it is for — three cards

Aspect ratio **4 : 3** (2000 × 1500).

---

**`who-agency.jpg`**

> [House style paragraph]
>
> Three colleagues standing in a bright modern studio, seen from behind at a
> distance, looking at a large wall-mounted screen showing a soft-focus 3D
> visualisation of an event space. No faces visible. White walls, pale oak
> floor, one azure blue chair in the foreground. Natural daylight from tall
> windows on the right.

---

**`who-exhibition.jpg`**

> [House style paragraph]
>
> An exhibition stand under construction on a trade show floor: a clean modular
> stand with white panel walls, an aluminium frame, a raised platform floor and
> a partially installed backwall in azure blue. Flight cases and a step ladder
> beside it. Two crew members at a distance, seen from behind, in plain work
> clothes. Bright hall lighting, polished concrete floor, other stands soft in
> the background.

---

**`who-venue.jpg`**

> [House style paragraph]
>
> A large empty hotel ballroom photographed from a high corner: parquet floor,
> pale walls, a coffered ceiling with visible rigging points and house lighting
> bars. Completely empty of furniture and people. Daylight through tall windows
> along one wall, house lights on low. One azure blue accent in a floor-level
> uplighter. Wide angle, straight verticals, calm and spacious.

---

## 3. In-app imagery

**All files go in `apps/web/public/app/`.** These are optional — every screen
works without them — but they turn empty states from blank pages into something
that reads as designed.

---

**`app/empty-projects.jpg`** — 16 : 9 (1920 × 1080)
*Shown on the dashboard when someone has no projects yet.*

> [House style paragraph]
>
> An empty white studio table photographed from directly above, with a single
> sheet of blank drawing paper, a scale rule and a mechanical pencil placed
> neatly to one side. Enormous negative space. One small azure blue paperclip.
> Soft, even, shadowless daylight. Minimal, quiet, inviting.

---

**`app/empty-plans.jpg`** — 16 : 9 (1920 × 1080)
*Shown inside a project that has no plans yet.*

> [House style paragraph]
>
> A completely empty exhibition hall interior, wide angle, from floor level:
> polished concrete, white walls, a high ceiling with an exposed lighting grid.
> Nothing in the space at all. Bright, even, cool daylight from clerestory
> windows. A single azure blue floor marking near the centre. Vast, clean, full
> of possibility.

---

**`app/auth-panel.jpg`** — 3 : 4 (1500 × 2000)
*A tall panel beside the sign-in form on wide screens.*

> [House style paragraph]
>
> A tall vertical composition: a modern event space seen through a doorway — an
> azure-lit stage at the far end, rows of empty seating, a truss structure
> overhead. Framed by the dark edge of the doorway on both sides so the eye is
> drawn down the length of the room. Deep one-point perspective, no people, calm
> and architectural.

---

**`app/marketplace-hero.jpg`** — 21 : 9 (3200 × 1370)
*Banner at the top of the marketplace.*

> [House style paragraph]
>
> A wide overhead flat-lay of a designer's shelf: neatly arranged scale models
> of exhibition stands and stage sets in white card and pale timber, arranged in
> a grid on a white surface with even gaps. Different sizes and configurations,
> all crisp and clean. One model has an azure blue panel. Even overhead
> daylight, precise shadows, generous margins.

---

**`app/specialists-hero.jpg`** — 21 : 9 (3200 × 1370)
*Banner at the top of the specialists directory.*

> [House style paragraph]
>
> A bright open-plan design studio photographed wide: several workstations with
> large monitors, drawing boards, material sample shelves, and models on a
> central table. Two or three people at a distance, seen from behind or in
> profile at the edge of frame, working. White walls, pale oak, one azure blue
> chair. Natural light from a full wall of windows.

---

**`app/ai-studio-hero.jpg`** — 21 : 9 (3200 × 1370)
*Banner at the top of the AI studio.*

> [House style paragraph]
>
> A wide overhead flat-lay on a white studio table: a row of small white
> 3D-printed prototypes of chairs and counters progressing left to right from a
> rough block to a finished piece, with a pencil sketch of the same object at
> the far left and a printed photograph of it at the far right. One prototype is
> azure blue. Even overhead daylight, precise shadows, generous margins.
> Nothing else in frame.

---

**`app/help-hero.jpg`** — 21 : 9 (3200 × 1370)
*Banner at the top of the help centre.*

> [House style paragraph]
>
> A clean overhead flat-lay: an open notebook with blank pages, a set of
> architectural drawing templates and stencils, a scale rule and two pencils,
> arranged with generous spacing on a white surface. One azure blue sticky note,
> blank. No writing anywhere. Soft even light, quiet and orderly.

---

**`app/venues-hero.jpg`** — 21 : 9 (3200 × 1370)
*Banner at the top of the venue library.*

> [House style paragraph]
>
> A wide exterior of a modern convention centre in flat daylight: glass and pale
> stone, a broad approach plaza, clean horizontal lines, no people, no signage
> lettering. Straight-on, symmetrical, straight verticals. One azure blue detail
> in the facade glazing. Pale overcast sky.

---

**`app/share-cover.jpg`** — 16 : 9 (2400 × 1350)
*Fallback cover on a share link that has no render yet.*

> [House style paragraph]
>
> A finished event space photographed just before doors: a wide banquet room
> with round tables laid and dressed, a low stage at the far end with an azure
> blue lit backdrop, warm pools of light on each table. Completely empty of
> people. Shot from a high rear corner, wide angle, straight verticals, calm
> and expectant.

---

## 4. Optional: social and email

Not used by the app yet, but generated in the same run they stay consistent.

**`app/og-card.jpg`** — 1.91 : 1 (2400 × 1256) — link preview card

> [House style paragraph]
>
> A three-quarter view of a modern event stage in a bright white space: a black
> stage deck, an aluminium truss goalpost, and an LED wall showing a flat field
> of vivid azure blue. Empty seating in soft focus in the foreground. Generous
> empty space in the upper-left third of the frame where a title will be laid
> over it. No text in the image itself.

---

## 5. After generating

1. Save each file with the **exact** name above, into the path above.
2. `apps/web/public/landing/` and `apps/web/public/app/` — create them if they
   do not exist.
3. Reload the page. Anything present replaces its placeholder; anything missing
   keeps its placeholder, so a partial set is fine.
4. If an image looks too busy behind text, regenerate it with
   *"…more negative space, simpler composition, fewer objects"* appended — that
   single addition fixes most of them.
