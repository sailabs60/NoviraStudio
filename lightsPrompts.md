# Lighting look cards — image prompts

Six images, one per card in **Light → The look**
(`packages/shared/src/lighting.ts`, `LIGHTING_LOOKS`). Each card currently
shows four flat colour bars; these prompts produce a photograph that does the
same job properly — the palette shown as *light falling in a real room*
instead of as swatches, so the card tells you what the look does before you
click it.

## How to generate them

**Resolution.** 2048 × 1536 (4:3), which matches the card's proportions and
leaves room to crop. Downscale to 1024 × 768 for the app and export JPEG at
quality 82 — keep each file under about 250 KB, since all six load together.

**Held constant across all six**, so the set reads as one library rather than
six unrelated stock photos:

- Real photography. Not a 3D render, not an illustration, not a game screenshot.
- Full-frame camera, 24 mm lens, shot from standing eye height, camera level
  (no dutch tilt, no worm's-eye drama) — the view a designer walking the room
  would have.
- The room is **empty of people**. A blurred silhouette far in the background
  is acceptable; no faces in focus, ever.
- No text, no logos, no signage, no watermarks anywhere in frame.
- Natural sensor grain, no HDR halos, no heavy vignette, no lens flare unless
  the prompt asks for beams.
- The same room type each time — a mid-size function room, roughly 25 × 15 m
  with a 6 m ceiling — so the six read as one venue lit six ways. That is what
  makes them comparable, which is the entire point of the card.

**Palette.** Each prompt names its card's four colours in plain visual
language. The hex values are listed underneath so you can check the result
against the card rather than judging by eye — they are the card's own
`keyColor`, `washColors[0]`, `washColors[1]` and `rimColor`, in the order the
swatches appear.

**If a generation misses**, it is almost always the palette going generic.
Regenerate with the colour clause moved to the front of the prompt rather than
adding more adjectives to the end.

---

## 1. Corporate summit

> *Even, neutral, camera-safe. Faces read correctly and the brand colour lives on the walls.*

**Prompt**

> Photograph of an empty corporate conference room set for a summit, wide
> view from the back of the room at standing height. Warm ivory-white key
> light falls evenly from ceiling fixtures across rows of grey upholstered
> chairs and a low stage with a plain unbranded screen. The side walls carry a
> deliberate wash of strong royal blue on the left and bright cyan-blue on the
> right, and a faint pale-blue rim light traces the top edge of the back wall.
> The lighting is flat and shadowless across the seating — no pools, no
> contrast falloff, nothing that would put half a face in shadow — while the
> colour stays entirely on the walls and never touches the chairs or the
> floor. Polished light grey floor, clean architectural lines, diffuse daylight
> from high side windows. Shot on a full-frame camera with a 24 mm lens,
> photographic, calm and professional, no people, no text or logos.

**Check against:** ivory `#fff6e8` · royal blue `#1d4ed8` · cyan `#0ea5e9` · pale blue `#dbeafe`
**Watch for:** contrast creeping in. This one should look almost boring in the seating area — that is what "camera-safe" means.

---

## 2. Gala dinner

> *Warm and low. Tables lit enough to eat by, walls in colour, everything else soft.*

**Prompt**

> Photograph of an empty gala dinner room at night, wide view across round
> banquet tables dressed in white linen. Each table sits in its own pool of
> warm amber-gold light from a pendant above it — bright enough to read a menu
> by, and falling off sharply so the aisles between tables go dark. The far
> walls are washed in deep violet-purple on one side and hot magenta on the
> other, meeting in the corner. A soft warm-peach rim light catches the top of
> the drapery behind the tables. Light haze in the air makes the wall colour
> bloom gently. Everything that is not a table or a wall — chairs, floor,
> ceiling — falls into soft shadow. Low overall exposure, rich and warm, no
> flat fill light anywhere. Shot on a full-frame camera with a 24 mm lens at
> table height, photographic, no people, no text or logos.

**Check against:** amber `#ffd9a8` · violet `#7c3aed` · magenta `#c026d3` · peach `#ffe6c2`
**Watch for:** the tables going as dark as the room. The whole point is that the tables are usable and everything else is not.

---

## 3. Tech launch

> *Cool, hard and graphic. Deep shadow, sharp beams, one accent colour.*

**Prompt**

> Photograph of an empty product-launch stage, wide straight-on view. Matte
> black stage decking and a plain dark backdrop. A single hard cool-white key
> light cuts down from directly above in a sharp-edged beam, visible in light
> haze, leaving a bright rectangle on the deck and near-black everywhere
> outside it. The backdrop carries one saturated accent: a deep navy-black
> gradient washed with a strong cobalt blue, and a thin electric sky-blue rim
> light runs along the front edge of the stage, separating it from the floor.
> No secondary fill — the shadows are genuinely black, not dark grey. Beams
> form clean geometric shapes in the haze. High contrast, hard edges, minimal
> and graphic. Shot on a full-frame camera with a 24 mm lens, photographic,
> cinematic, no people, no text or logos on the backdrop.

**Check against:** cool white `#eaf2ff` · near-black navy `#0f172a` · cobalt `#2563eb` · sky blue `#38bdf8`
**Watch for:** too many beams. One key, one accent — a forest of moving heads is the Concert card, not this one.

---

## 4. Concert

> *Saturated, high contrast, beams doing the work. The room disappears.*

**Prompt**

> Photograph of an empty concert stage during a lighting rehearsal, wide view
> from where the crowd would stand. Dense haze fills the room so the walls,
> ceiling and floor are completely invisible — there is no readable room, only
> light in air. A rig of moving-head fixtures fires hard saturated beams
> crossing through the haze: hot magenta-pink from one side, electric cyan
> from the other, a stark pure-white beam cutting straight down the centre,
> and a streak of hot coral-red raking across the back. The beams are the
> subject — sharp-edged cones with visible volume, crossing at the centre of
> frame. Everything outside a beam is pure black. Extreme contrast, fully
> saturated colour, no fill light of any kind. Shot on a full-frame camera
> with a 35 mm lens, photographic, energetic, no people, no stage branding.

**Check against:** white `#ffffff` · magenta-pink `#db2777` · cyan `#22d3ee` · coral red `#f43f5e`
**Watch for:** a visible room. If you can tell how big the space is, there is not enough haze.

---

## 5. Wedding

> *Candle-warm, gentle contrast, foliage texture on the walls.*

**Prompt**

> Photograph of an empty wedding reception room at dusk, wide view along a
> long banquet table dressed in white with trailing greenery down its centre.
> Warm candlelight-coloured light comes from low sources — candles on the
> table, string lights overhead — giving a soft golden key with no hard edges
> anywhere. The walls are washed in warm amber-orange, with a blush-pink
> secondary glow in the far corner. A pale warm-cream rim light picks out the
> edges of hanging foliage and the folds of the drapery. Leaf-shaped shadows
> from the greenery fall gently across the walls, breaking up the colour. Low
> contrast throughout — the shadows are warm and open, never black. Soft focus
> in the background, gentle bloom on the candle flames. Shot on a full-frame
> camera with a 35 mm lens at table height, photographic, romantic and
> natural, no people, no text or logos.

**Check against:** candle cream `#ffe3bd` · amber `#f59e0b` · blush pink `#f472b6` · warm cream `#fff0d6`
**Watch for:** the leaf shadows being missed. The foliage texture on the walls is what separates this card from Gala dinner.

---

## 6. Exhibition daylight

> *Flat, bright and neutral, matching a hall lit from the roof. Stands read as built.*

**Prompt**

> Photograph of an empty exhibition hall with a high industrial roof, wide
> view down an aisle. Bright, even, neutral white daylight floods down from
> rooflights and diffused overhead fixtures — the light is completely flat,
> with almost no shadow beneath anything and no directional falloff across the
> floor. Walls and floor are neutral white and pale grey, with only a faint
> cool grey-blue tint in the far distance where the hall recedes. Exposed
> steel roof trusses overhead, polished pale grey concrete floor. A few plain
> modular exhibition stand frames stand in the middle distance, unclad and
> completely without graphics, reading purely as structure. Slightly
> overexposed relative to normal, colour-neutral, no warmth and no colour cast
> anywhere. Shot on a full-frame camera with a 24 mm lens, photographic, crisp
> and clean, no people, no signage or logos.

**Check against:** white `#ffffff` · off-white `#f8fafc` · pale grey `#e2e8f0` · grey `#cbd5e1`
**Watch for:** any colour cast. This is the reference card — if it picks up a tint, every other card loses its meaning by comparison.
