# Drive Yours — Direction

Status: draft for sign-off. Written 7 September 2026. This is the phase 0 gate from the studio rebuild plan. Nothing is rendered at final quality until every section here is agreed.

## The one-line brief

Bespoke privacy glass for executive cars, London. The site has to make a visitor *feel* the glass: its weight, its depth, the way it turns the city into black lacquer from the pavement and leaves the skyline clean from the seat.

## Why the current hero fails

The teardown idea is right. The material is wrong. The pane is seven flat SVG shapes with gradient fills, pushed apart in CSS. Nothing is lit, nothing reflects, nothing has an edge. The pane also changes from photograph pixels to vector at the moment it lifts, which is the moment the eye stops believing it. The fix is to render in Blender and scrub the frames in the browser.

## Architecture (decided)

- **Hero and story bands:** pre-rendered Cycles image sequences, scroll-scrubbed on a canvas.
- **Configurator:** a matrix of camera-matched stills from the same scene, plus shot 3 rendered at each depth.
- **Live WebGL:** post-launch only.
- **AI video:** pre-vis only, never shipped. (Tried and dropped in commit dcff897.)

## The vehicle

An **unbadged executive saloon**, long wheelbase, black. Purchased high-poly model with separate door glass, opening rear door, door channel geometry and a proper interior. Candidate sources: Hum3D, CGTrader, Sketchfab (check licence allows commercial rendering; avoid manufacturer marks entirely).

Decision needed: **generic saloon** (safe, recommended) vs a **specific licensed model** (a real client car, but a legal exposure on a commercial site).

## Shot list

All shots 24 fps, rendered 2560 × 1440 landscape plus a 1080 × 1920 portrait camera for phones.

| # | Name | Camera | Duration | Purpose | Scroll range |
|---|------|--------|----------|---------|--------------|
| 1 | Arrive | Exterior, 85 mm, f/2.8, low three-quarter rear, wet kerb, night | 6 s / 144 fr | Establishes the car and the glass as black lacquer. Plays once on load as video. | Above the fold, autoplay |
| 2 | Taken apart | Interior, 50 mm, f/2.8, rear seat looking at the rear door window | 10 s / 240 fr | The hero. Push toward the door, rack focus leather → glass, the pane detaches along its normal, turns to three-quarter, seven plies fan out with real thickness, rim light sweeps. Holds on the exploded stack for the labels. | 5 % → 85 % of the hero track |
| 3 | The window | Exterior, 85 mm, close on the rear door, slight high angle | 8 s / 192 fr, × 4 depths | The door glass rises out of the door on its real curved track, motor easing at the top. Rendered at VLT 70, 35, 20, 5. | Configurator, tap or drag |
| 4 | Street loop | Exterior, 85 mm, locked on the tinted pane from the pavement | 6 s / 144 fr, seamless | Ambient. City reflection sliding across the tint, rain running. | Privacy band background |

Configurator stills: final frame of shot 3 and the shot 2 resting frame, for 4 depths × 4 stylings (full, fade, visor, split) × etch on/off × 2 views = 64 stills.

## Material and lighting truths

These are the things that make it read as glass. They are not negotiable in look development.

- **Every ply keeps the window's silhouette for the entire teardown.** The B-pillar edge, the roofline arch, the C-pillar sweep and the beltline are visible on every sheet at every frame. Nothing ever reads as a rectangle. In Blender the seven plies are cut from the door glass mesh itself, so this cannot drift.
- Laminated door glass is **2.1 mm outer ply + 0.76 mm acoustic PVB + 1.6 mm inner ply**. Modelled as three solids, not one.
- Film stack inward of the inner ply: **10 µm mounting adhesive, 36 µm PET nano-ceramic, 23 µm second PET ply, 4 µm hardcoat.** Real thicknesses, with a single "teardown scale" property that exaggerates them for the camera. The labels on the site quote the real numbers.
- **Tint is absorption, not colour.** Volume absorption in the ceramic layer, density driven by a `vlt` property. Calibrated against a white card so a VLT 5 render transmits 5 % ± 1 %.
- Glass: IOR 1.52, roughness ≈ 0.02, small dispersion so exposed edges break into spectrum in the fan. 0.2 mm bevel on every ply edge.
- Night city HDRI for reflections (Poly Haven, CC0), low strength. One large area key from the street-lamp side. Cool fill from the city. **A rim light on a path** stands in for a passing headlight and produces the sweep across the glass. No fake sheen gradients.
- Interior: amber ambient strip along the door card, chrome handle, quilted leather, the window the brightest thing in frame.
- Post in the compositor: glare on city lights, film grain, light vignette, grade LUT that pulls blacks to `#070808` so renders and CSS agree.

## Motion language

One number drives the hero: scroll progress, lerped with the existing time-normalised filter in `hero.js` (keep it).

| Use | Curve | Duration |
|-----|-------|----------|
| Scroll-driven motion | Frame index is linear in progress; all easing lives in the Blender animation curves. | — |
| Reveals below the fold | `cubic-bezier(0.22, 1, 0.36, 1)` (ease-out-quint) | 700 ms |
| Configurator crossfade | `cubic-bezier(0.65, 0, 0.35, 1)` (ease-in-out-cubic) | 550 ms |
| Hover and state | `cubic-bezier(0.22, 1, 0.36, 1)` | 180 ms |
| Window motion on tap | Plays shot 3 frames at 24 fps from the current frame, no CSS easing. | as rendered |

Motion blur is on in every render. Nothing on the page moves by more than one easing at a time. Reduced motion: posters plus copy, no scrub.

## Legal stance on the picker

UK law: front side windows must let ≥ 70 % of light through, the windscreen ≥ 75 %. Rear side and rear windows are unrestricted.

Decision: **the picker enforces it.** Any depth below 70 automatically shows the split (fronts at 70, rears at the chosen depth) and says so in one line. This is presented as expertise, not as a limitation.

## Acceptance criteria

Each of these is measured before launch and recorded in the pull request.

1. A single still frame of shot 2, with no motion, reads as glass to someone who has not seen the site.
2. The window in shot 3 moves on a track that follows the door's geometry, with a visible rotation as it rises.
3. A VLT 5 render measures 5 % ± 1 % transmission against the calibration card; likewise 20, 35 and 70.
4. Hero sequence transfer ≤ 8 MB on desktop, ≤ 3 MB on phone, after the poster.
5. LCP ≤ 2.5 s on a throttled 4G Lighthouse run.
6. Shot 2 scrubs at 60 fps on an iPhone 13 and a Pixel 6a.
7. Labels track the plies within 8 px at every viewport width.
8. Every combination in the configurator changes without a flash.
9. Keyboard-only operation of the rail, spec strip and configurator with visible focus.

## Reference reel (to assemble)

Ten clips, each with a one-line note on what specifically sells the material.

- Apple AirPods Pro scroll sequence (frame scrubbing, focus pulls)
- Apple MacBook Pro hinge sequence (edge highlights on thin metal)
- Rolls-Royce configurator (paint and glass under one lighting rig)
- Bentley Bentayga configurator (interior practicals)
- Porsche Taycan glass roof film (transmission changing in one shot)
- Lusion agency reel (WebGL glass)
- Active Theory reel (scroll-driven sequences)
- Mercedes S-Class rear-seat film (the amber strip, the leather)
- A Cycles glass-and-dispersion study (edge behaviour)
- Any professional window-tint installer film that shows the glass dropping into the door

## Open decisions

- [ ] Generic saloon vs licensed model
- [ ] Display typeface: licensed (Söhne, Neue Haas Grotesk, ABC Diatype) vs Google Fonts (Archivo, Familjen Grotesk)
- [ ] Domain name and host (Cloudflare Pages recommended)
- [ ] Real contact email to replace `studio@driveyours.example`
