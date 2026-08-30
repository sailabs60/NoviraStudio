# Image prompts

Prompts for an AI image generator (Nanobanana / Gemini, DALL·E, Midjourney or
Stable Diffusion all work — these are plain descriptive prompts, no
tool-specific flags). Two sections, matching the two screenshots:

- **The look** — the six lighting-mood cards in the Light panel (`packages/shared/src/lighting.ts`, `LIGHTING_LOOKS`).
- **What are you building?** — the six build-tool cards in the Build panel (`apps/web/src/editor/panels/BuildPanel.tsx`, `TOOLS`).

**Format**: generate each at a 4:3 ratio (roughly 800×600 or 1200×900) — that
matches the card's own proportions, so nothing gets cropped awkwardly when
it's dropped in as a card background or thumbnail. Export as JPEG, quality
80–85%, and keep each file under about 200 KB so six of them loading at once
on the panel doesn't stall it.

**Style, held constant across all twelve** so the set reads as one photo
library rather than twelve unrelated stock images: real photography (not a 3D
render, not an illustration), shot on a full-frame camera with a 24–35 mm
lens, shallow-medium depth of field, natural film grain, no visible people's
faces in sharp focus (a blurred figure or silhouette in the background is
fine — these are card thumbnails, not portraits), no text or logos anywhere
in frame, no watermarks.

---

## The look — six lighting moods

Each prompt is built to reproduce the card's own colour palette (its key
light, its two wash/accent colours, and its rim light) as *light in the
photograph* — walls, haze and highlights picked out in those tones — rather
than as flat colour bars. That's the thing a real photo can do that the
current four-swatch strip can't: show the palette actually lighting a room.

### 1. Corporate summit
*Even, neutral, camera-safe. Faces read correctly and the brand colour lives on the walls.*

> Wide interior shot of an empty modern conference hall set for a corporate
> summit, rows of grey upholstered chairs facing a low stage with a plain
> projection screen, walls washed in soft cream and pale blue light (warm
> ivory key light from above, cool powder-blue and sky-blue wash on the side
> walls, a faint blue rim glow along the back wall), even and shadowless
> lighting throughout, no harsh contrast, clean architectural lines, large
> factory-style windows letting in diffuse daylight, polished concrete floor
> reflecting the ceiling lights faintly, shot on a 24mm lens from the back of
> the room, photographic, realistic, calm and professional atmosphere.

### 2. Gala dinner
*Warm and low. Tables lit enough to eat by, walls in colour, everything else soft.*

> Wide interior shot of an elegant empty gala dinner hall at night, round
> tables set with white linen and low centrepieces glowing warmly under
> pendant light (soft amber-gold key light on the tables), the surrounding
> walls bathed in a deep violet-to-magenta wash, a warm peach rim light
> tracing the far wall, everything beyond the tables falling into soft
> shadow, a light haze in the air catching the coloured light, chairs
> upholstered in dark fabric barely visible in the gloom, shot on a 35mm
> lens at a low angle across the tables, shallow depth of field, moody,
> romantic, realistic event photography, no people.

### 3. Tech launch
*Cool, hard and graphic. Deep shadow, sharp beams, one accent colour.*

> Wide interior shot of an empty product-launch stage set, black stage decking
> and dark backdrop, a single sharp cool-white key light cutting hard-edged
> beams through light haze from directly above, walls and floor mostly in
> deep near-black shadow, one strong cobalt-blue accent wash lighting the
> backdrop and a thin electric-blue rim light along the stage edge, visible
> beams of light in the haze forming graphic diagonal shapes, high contrast,
> minimal reflective surfaces, shot on a 24mm lens straight on to the stage,
> dramatic, cinematic, realistic product-launch event photography, no people,
> no logos on the backdrop.

### 4. Concert
*Saturated, high contrast, beams doing the work. The room disappears.*

> Wide shot of an empty concert stage mid rehearsal, dense haze filling the
> room so the walls and ceiling are barely visible, a wall of moving-head
> fixtures firing saturated beams — hot magenta-pink and electric cyan
> crossing beams, a stark white key light cutting through the centre, a
> streak of red rim light along one edge — beams visibly cutting through the
> haze in sharp cones, stage floor barely lit, everything outside the beams
> falling to black, extremely high contrast, shot on a 35mm lens from the
> crowd's point of view, energetic, realistic concert lighting photography,
> no people, no stage text or branding.

### 5. Wedding
*Candle-warm, gentle contrast, foliage texture on the walls.*

> Wide interior shot of an empty wedding reception space at golden hour,
> warm candlelight-coloured key light over a long banquet table dressed with
> greenery and trailing foliage, walls softly washed in warm amber-orange
> light with a blush-pink secondary glow, a pale warm-cream rim light
> catching the edges of hanging foliage and drapery, dappled leaf-shaped
> shadows cast across the walls from the greenery, gentle low contrast,
> soft focus background, string lights faintly glowing overhead, shot on a
> 35mm lens at table height, romantic, natural, realistic wedding
> photography, no people.

### 6. Exhibition daylight
*Flat, bright and neutral, matching a hall lit from the roof. Stands read as built.*

> Wide interior shot of an empty exhibition hall with a high industrial roof,
> bright even white daylight flooding down from skylights and roof-mounted
> diffused fixtures, walls and floor in flat neutral white and pale grey with
> almost no shadow or contrast, a faint cool grey-blue tint in the far
> background, exposed steel roof trusses visible above, polished pale grey
> concrete floor, a few generic modular exhibition stand frames visible in
> the middle distance without any graphics or branding on them, shot on a
> 24mm lens, crisp, clean, evenly lit, realistic trade-show hall photography,
> no people, no signage.

---

## What are you building? — six build tools

These don't carry an assigned colour palette in the code, so the brief here
is simpler: real, well-lit photographs of the actual equipment each tool
represents, mid-build or freshly built, shot the way an event production
company would photograph its own kit for a catalogue.

### 1. Stage
*Modular decks, stairs, skirting and guardrail, with the parts list derived as you build.*

> Photograph of a modular black stage deck system partway through assembly in
> an empty event hall, aluminium-framed deck platforms at two different
> heights connected by a short flight of stairs with a chrome guardrail along
> the raised edge, black skirting fabric velcroed along the stage face
> covering the leg frames beneath, a few deck legs and connector pins visible
> where a section is still being fitted, work lights giving even neutral
> light, polished concrete floor, shot on a 35mm lens at a low three-quarter
> angle so the deck height and the stair structure both read clearly,
> realistic production-photography style, no people, no branding.

### 2. Truss
*Goalposts, grids and arches. The span warning tells you if the section will not take it.*

> Photograph of aluminium box-truss segments assembled into a goalpost shape
> with a matching grid section beside it, standing in an empty warehouse-like
> venue space, visible triangulated truss construction with silver bolted
> corner blocks, a chain hoist and sling hanging from one upright ready to
> raise it, a small moving-head light fixture clamped to the horizontal
> span, neutral even lighting from skylights, polished floor reflecting the
> truss faintly, shot on a 24mm lens from below and to one side to show the
> full height and span, realistic rigging-photography style, no people, no
> branding.

### 3. LED
*Screens built from real cabinets, with resolution, weight and power derived.*

> Photograph of a large modular LED video wall built from individual square
> cabinets stacked in a grid, a ground-support frame visible at the sides and
> rear with cable looms and a small stack of processing equipment nearby, the
> screen powered on and showing a simple abstract test pattern of soft
> colour gradients (no logos or text), a technician's ladder leaning against
> one side, even venue lighting, shot straight-on and slightly low so the
> seams between cabinets and the support frame are both visible, realistic
> AV-production photography, no people.

### 4. Stands
*One exhibition stand in detail, or a whole hall floor laid out on the grid.*

> Photograph of a modular exhibition stand under construction on a hall
> floor marked out with grid tape, an aluminium extrusion frame partly
> clad in white laminate panels, a fabric-graphic backwall frame standing
> ready but still blank, a small reception counter and two stools placed in
> front, exposed frame corners visible where cladding isn't finished yet,
> bright even hall lighting from above, other stand frames visible
> out-of-focus in the background down the aisle, shot on a 35mm lens at a
> three-quarter angle, realistic trade-show-build photography, no people,
> no graphics or logos on any panel.

### 5. Tents & drapes
*Framed structures with sidewalls, and pleated drape from a nine-point control grid.*

> Photograph of a white-framed marquee structure erected outdoors on grass at
> dusk, PVC sidewalls fitted along one side and rolled up on the other to
> show the aluminium frame, soft pleated ivory drape hanging in swags from
> the internal roof structure, warm string lighting woven along the ridge
> beam, a clear evening sky with the last blue light behind the tent, shot on
> a 24mm lens from just outside one open corner so the frame, the sidewall
> and the draped interior are all visible at once, realistic
> event-production photography, no people.

### 6. Branding
*Dimensional lettering and artwork — the part where a client identity goes into the room.*

> Photograph of large dimensional foam-and-vinyl letters (generic abstract
> shapes standing in for lettering — no real words or logos) mounted on a
> freestanding backdrop wall, painted in a brushed-metal gold finish with a
> soft edge-lit glow, a printed fabric graphic panel beside it showing an
> abstract geometric pattern rather than any real brand mark, warm gallery
> track lighting picking out the depth and shadow of the raised letters,
> polished dark floor reflecting the lit edges softly, shot on a 35mm lens
> straight on, realistic signage-fabrication photography, no people, no real
> words, logos or brand names anywhere in frame.
