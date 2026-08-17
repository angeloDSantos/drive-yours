/* The teardown engine. One number (scroll progress through the track),
   lerped every frame, drives every transform. No libraries. */

(() => {
  'use strict';

  const track = document.querySelector('.hero-track');
  const stage = document.querySelector('.hero-stage');
  const pane = document.querySelector('.pane');
  const layers = [...document.querySelectorAll('.layer')];
  const railRows = [...document.querySelectorAll('.rail-list li')];
  const rail = document.querySelector('.rail');
  const copyOpen = document.querySelector('.copy-open');
  const copyClose = document.querySelector('.copy-close');
  const spec = document.querySelector('.spec');
  const hint = document.querySelector('.scroll-hint');
  const glow = document.querySelector('.stage-glow');
  const bgImg = document.querySelector('.stage-bg img');
  const bgBox = document.querySelector('.stage-bg');
  const veil = document.querySelector('.stage-veil');
  const aperGlow = document.querySelector('.aperture-glow');
  const etch = document.querySelector('.etch');
  const bokeh = document.querySelector('.bokeh-live');
  const windowHold = document.querySelector('.window-hold');
  const sheen = document.querySelector('.sheen');
  const sheenGrad = document.getElementById('g-sheen');
  const flare = document.querySelector('.release-flare');

  /* The coach-door aperture inside the cabin plate, in the photo's own
     pixels. The pane is seated exactly here at the top of the page. */
  const IMG = { w: 1672, h: 941 };
  /* traced from the plate's own pixels (flood-fill of the lit window, then
     the beltline found by luminance gradient because the flood leaks onto
     the door trim): B-pillar x311, roofline y168, rear corner x1474,
     beltline y575 at the rear falling to y591 at the pillar */
  const APERTURE = { x: 311, y: 168, w: 1163, h: 423 };

  /* The plate is never shown at 1:1 — it sits at a slight zoom that grows
     as the world fades. Everything that has to land on the photographed
     window (the pane's seat, the held window, the light behind it, the
     bokeh canvas) goes through this one mapping, at the same zoom, so they
     cannot drift apart. */
  const bgZoom = (fadeWorld) => 1.03 + 0.05 * fadeWorld;

  /* Must mirror object-position on .stage-bg img. On a phone the crop is
     centred on the WINDOW (its centre is at 53.4% of the plate, not 50%)
     rather than on the photograph, so the glass can run edge to edge. */
  const objX = () => (phone.matches ? 0.7 : 0.5);
  const objY = () => (phone.matches ? 0.44 : 0.42);

  /* Phone only. The plate is a band at the top so the whole window reads at
     rest, but once the world starts going black there is nothing up there
     to anchor it and the glass is stranded above a dead screen. So the band
     travels to the middle and grows as the world dies. It is applied inside
     apertureRect and mirrored on the plate's own transform, which means the
     pane, the held window, the flare and the canvas all travel together. */
  function bandDrift(fadeWorld) {
    if (!phone.matches || fadeWorld <= 0) return { dy: 0, k: 1 };
    const centre = bgBox.offsetTop + bgBox.clientHeight / 2;
    return { dy: (stage.clientHeight * 0.44 - centre) * fadeWorld, k: 1 + 0.04 * fadeWorld };
  }

  function apertureRect(zoom, drift) {
    /* Read the plate's own box, not the stage's. On a phone the plate is a
       band across the top rather than a full-bleed crop — a cover crop of a
       2.75:1 window on a 1:2 screen shows barely a third of the glass — and
       because every overlay derives its geometry from here, the two layouts
       need no separate arithmetic. */
    const W = bgBox.clientWidth;
    const H = bgBox.clientHeight;
    const bx = bgBox.offsetLeft;
    const by = bgBox.offsetTop;
    const s = Math.max(W / IMG.w, H / IMG.h);
    /* mirrors object-fit: cover at the plate's object-position */
    const ox = bx + (W - IMG.w * s) * objX();
    const oy = by + (H - IMG.h * s) * objY();
    /* then the plate's own scale, about transform-origin 50% 40% */
    const cx0 = bx + W * 0.5;
    const cy0 = by + H * 0.4;
    const ax = ox + (APERTURE.x + APERTURE.w / 2) * s;
    const ay = oy + (APERTURE.y + APERTURE.h / 2) * s;
    let cx = cx0 + (ax - cx0) * zoom;
    let cy = cy0 + (ay - cy0) * zoom;
    let scale = s * zoom;
    /* the same translate-then-scale about the band's centre that the plate
       itself is given, so the two can never come apart */
    const k = drift ? drift.k : 1;
    if (k !== 1 || (drift && drift.dy)) {
      const bcx = bx + W / 2;
      const bcy = by + H / 2;
      cx = bcx + (cx - bcx) * k;
      cy = bcy + (cy - bcy) * k + drift.dy;
      scale *= k;
    }
    return {
      cx,
      cy,
      w: APERTURE.w * scale,
      h: APERTURE.h * scale,
      /* the plate's rendered scale, for anything drawing the photo itself */
      s: scale,
    };
  }

  /* The live city: the brightest points inside the photo's window, found
     once from the actual pixels, then redrawn as soft breathing glows on a
     canvas over the same spots. No second asset, nothing to misalign. */
  let sprites = [];
  function seedBokeh() {
    let d;
    /* Sampling can fail for reasons that must not take the page with them:
       a broken plate, no 2d context, or a tainted canvas on file://. The
       teardown and the rest of the site carry on without it. */
    try {
      const c = document.createElement('canvas');
      c.width = IMG.w;
      c.height = IMG.h;
      const g = c.getContext('2d', { willReadFrequently: true });
      if (!g) return;
      /* sample through the same filter the plate is displayed with, so the
         glows match the pixels they sit on */
      g.filter = 'saturate(0.82) contrast(1.04) brightness(1.24)';
      g.drawImage(bgImg, 0, 0, IMG.w, IMG.h);
      d = g.getImageData(APERTURE.x, APERTURE.y, APERTURE.w, APERTURE.h).data;
    } catch { return; }
    const pts = [];
    const step = 6;
    for (let y = step; y < APERTURE.h - step; y += step) {
      for (let x = step; x < APERTURE.w - step; x += step) {
        const i = (y * APERTURE.w + x) * 4;
        const l = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
        if (l > 105) pts.push({ x, y, l, r: d[i], g: d[i + 1], b: d[i + 2] });
      }
    }
    pts.sort((a, b) => b.l - a.l);
    for (const p of pts) {
      if (sprites.length >= 26) break;
      if (sprites.every((s) => (s.x - p.x) ** 2 + (s.y - p.y) ** 2 > 52 * 52)) {
        sprites.push({
          ...p,
          phase: Math.random() * Math.PI * 2,
          speed: 0.5 + Math.random() * 0.9,
          size: 12 + Math.random() * 22,
        });
      }
    }
  }
  if (bgImg.complete) seedBokeh();
  else bgImg.addEventListener('load', seedBokeh, { once: true });
  /* Cached per-sprite gradients: their geometry only changes when the
     canvas is resized, so they are built there, not every frame. */
  let spriteGrads = [];
  let bctx = null;


  /* Street side -> cabin side. Spread is each layer's share of the fan
     depth, taken from the physical stack (films sit tighter than glass). */
  const SPREAD = [1.86, 1.58, 1.33, 1.05, 0.71, 0.34, 0];

  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const ramp = (p, a, b) => clamp01((p - a) / (b - a));
  const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const easeOut = (x) => 1 - Math.pow(1 - x, 3);

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const phone = window.matchMedia('(max-width: 820px)');

  let target = 0;
  let current = -1; // force first paint
  let raf = 0;

  function measure() {
    const r = track.getBoundingClientRect();
    const total = r.height - window.innerHeight;
    target = total > 0 ? clamp01(-r.top / total) : 1;
  }

  function apply(p, now = 0) {
    const onPhone = phone.matches;
    /* A landscape phone is 844x390: wider than the phone breakpoint but
       with no vertical room, and the desktop fan runs off its screen. The
       compact motion numbers key off the stage's real height as well. */
    const compact = onPhone || stage.clientHeight < 520;
    const fanDepth = compact ? 100 : 300;

    /* Phases. The order is the story: first the whole site dies to black
       around the window (which stays put), then the window comes forward
       to the study angle, then it fans apart. */
    const fadeWorld = easeInOut(ramp(p, 0.05, 0.26)); /* cabin -> black, window holds */
    const study = easeInOut(ramp(p, 0.24, 0.46));     /* window detaches, turns 3/4 */
    const release = easeInOut(ramp(p, 0.26, 0.36));   /* the held window lets go */
    const fan = ramp(p, 0.42, 0.8);
    const openFade = 1 - ramp(p, 0.05, 0.15);
    const railIn = ramp(p, 0.48, 0.58);
    const closeIn = ramp(p, 0.85, 0.94);

    /* The pane is seated in the photographed window and tracks it exactly,
       zoom and all, so while the world fades the glass simply stays where
       the car's window is. Then it detaches, turns to a three-quarter view
       and fans. The fan spreads towards the viewer's left, so the group
       follows it right and down. */
    const zoom = bgZoom(fadeWorld);
    const drift = bandDrift(fadeWorld);
    const a = apertureRect(zoom, drift);
    const seatScale = pane.offsetWidth ? a.w / pane.offsetWidth : 1;
    const seatX = a.cx - stage.clientWidth / 2;
    const seatY = a.cy - stage.clientHeight / 2;

    const fanEase = easeInOut(fan);

    /* The pop: the pane peels out of the frame top-first and swells
       towards the viewer before settling into the study angle. */
    const peel = Math.sin(Math.PI * Math.min(1, study * 1.3)) * (1 - study);
    const pop = 1 + (compact ? 0.045 : 0.09) * Math.sin(Math.PI * Math.min(1, study * 1.15)) * (1 - fanEase);

    const ry = (compact ? -50 : -60) * study;
    const rx = (5 + 6 * study) * study - 9 * peel;
    const scale = (seatScale + (1 - 0.12 * study - seatScale) * study) * pop;
    /* The fan spreads towards the viewer's left, so the group follows it
       right. The phone numbers are smaller because the phone pane is: with
       the desktop offsets the finished stack sat a third off the screen. */
    const shiftX = seatX * (1 - study) + ((compact ? 26 : 70) + fanEase * (compact ? 40 : 150)) * study;
    const shiftY = seatY * (1 - study) + fanEase * (compact ? 36 : 22) * study;
    pane.style.transform =
      `translateX(${shiftX.toFixed(2)}px) translateY(${shiftY.toFixed(2)}px) ` +
      `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) scale(${scale.toFixed(4)})`;

    bgImg.style.transform = `scale(${zoom.toFixed(4)})`;
    bgBox.style.transform = drift.k === 1 && !drift.dy
      ? ''
      : `translateY(${drift.dy.toFixed(1)}px) scale(${drift.k.toFixed(4)})`;
    veil.style.opacity = fadeWorld.toFixed(3);

    /* The rest of the car goes; the glass stays. The hold is the window's
       own pixels mapped at the plate's resting scale, riding above the
       veil until the pane has clearly popped out. */
    const left = a.cx - a.w / 2;
    const top = a.cy - a.h / 2;
    if (windowHold) {
      const s = a.s;
      windowHold.style.left = `${left.toFixed(1)}px`;
      windowHold.style.top = `${top.toFixed(1)}px`;
      windowHold.style.width = `${a.w.toFixed(1)}px`;
      windowHold.style.height = `${a.h.toFixed(1)}px`;
      windowHold.style.backgroundSize = `${(IMG.w * s).toFixed(1)}px ${(IMG.h * s).toFixed(1)}px`;
      windowHold.style.backgroundPosition = `${(-APERTURE.x * s).toFixed(1)}px ${(-APERTURE.y * s).toFixed(1)}px`;
      windowHold.style.opacity = (fadeWorld * (1 - release)).toFixed(3);
    }
    if (etch) etch.style.opacity = study.toFixed(3);

    /* The sweep: one hard specular travels the length of the glass as it
       peels out of the frame, which is what sells it as a solid object
       rather than a shape that faded in. */
    if (sheen && sheenGrad) {
      const sweep = ramp(p, 0.22, 0.46);
      sheen.style.opacity = (Math.sin(Math.PI * sweep) * 0.95).toFixed(3);
      sheenGrad.setAttribute('gradientTransform', `translate(${(-0.85 + 1.8 * sweep).toFixed(3)} 0)`);
    }

    /* The bloom behind it as the frame empties. Sized off the aperture so
       it blooms from exactly where the glass was. */
    if (flare) {
      const burst = Math.sin(Math.PI * release);
      flare.style.opacity = (burst * 0.9).toFixed(3);
      if (burst > 0.002) {
        const grow = 1 + 0.5 * release;
        const fw = a.w * 1.5 * grow;
        const fh = a.h * 2.4 * grow;
        flare.style.left = `${(a.cx - fw / 2).toFixed(1)}px`;
        flare.style.top = `${(a.cy - fh / 2).toFixed(1)}px`;
        flare.style.width = `${fw.toFixed(1)}px`;
        flare.style.height = `${fh.toFixed(1)}px`;
      }
    }
    if (aperGlow) {
      /* While the world fades, a soft light behind the seated window makes
         it the last lit thing on the page. It dies as the pane detaches. */
      aperGlow.style.left = `${left.toFixed(1)}px`;
      aperGlow.style.top = `${top.toFixed(1)}px`;
      aperGlow.style.width = `${a.w.toFixed(1)}px`;
      aperGlow.style.height = `${a.h.toFixed(1)}px`;
      aperGlow.style.opacity = (fadeWorld * (1 - study)).toFixed(3);
    }

    if (bokeh) {
      const gw = Math.round(a.w);
      const gh = Math.round(a.h);
      if (bokeh.width !== gw || bokeh.height !== gh) {
        bokeh.width = gw;
        bokeh.height = gh;
        spriteGrads = [];
      }
      bokeh.style.left = `${left.toFixed(1)}px`;
      bokeh.style.top = `${top.toFixed(1)}px`;
      bokeh.style.opacity = (1 - release).toFixed(3);
      if (!bctx) bctx = bokeh.getContext('2d');
      if (bctx) {
      const k = gw / APERTURE.w;
      if (spriteGrads.length !== sprites.length) {
        spriteGrads = sprites.map((sp) => {
          const r = Math.max(2, sp.size * k);
          const cx = sp.x * k;
          const cy = sp.y * k;
          const grd = bctx.createRadialGradient(cx, cy, 0, cx, cy, r);
          grd.addColorStop(0, `rgb(${sp.r},${sp.g},${sp.b})`);
          grd.addColorStop(1, 'rgba(0,0,0,0)');
          return { grd, r, cx, cy };
        });
      }
      bctx.clearRect(0, 0, gw, gh);
      bctx.globalCompositeOperation = 'lighter';
      const t = now / 1000;
      for (let i = 0; i < sprites.length; i++) {
        const sp = sprites[i];
        const g = spriteGrads[i];
        const alpha = 0.3 * (0.5 + 0.5 * Math.sin(t * sp.speed + sp.phase));
        if (alpha < 0.005 || !g) continue;
        bctx.globalAlpha = alpha;
        bctx.fillStyle = g.grd;
        bctx.fillRect(g.cx - g.r, g.cy - g.r, g.r * 2, g.r * 2);
      }
      bctx.globalAlpha = 1;
      }
    }

    /* Each layer leaves in street-to-cabin order. Seated, the stack must
       read as one near-black pane of privacy glass, so every film except
       the ceramic only fades in as the pane lifts. The close-card dim is
       also set per layer: opacity on the preserve-3d parent would flatten
       the scene and collapse the fan. */
    const dim = 1 - closeIn * 0.3;
    /* At rest there is no overlay at all: the top of the page is the
       photograph, untouched — no outline, no haze, nothing to misregister.
       The glass materialises only once the scroll starts, which is also
       when there is black behind it for the sheets to read against. */
    const materialise = 0.5 * fadeWorld + 0.5 * study;
    for (let i = 0; i < layers.length; i++) {
      const lp = easeOut(ramp(fan, i * 0.055, i * 0.055 + 0.6));
      layers[i].style.transform = `translateZ(${(lp * SPREAD[i] * fanDepth).toFixed(2)}px)`;
      /* The ceramic leads — it is the tint, so it arrives first and the
         clear plies build up behind it. */
      const material = i === 4 ? Math.min(1, materialise * 1.7) : materialise;
      layers[i].style.opacity = (material * dim).toFixed(3);
      const on = lp > 0.5;
      if (railRows[i]) railRows[i].classList.toggle('is-on', on);
    }

    copyOpen.style.opacity = openFade.toFixed(3);
    copyOpen.style.visibility = openFade > 0.001 ? 'visible' : 'hidden';
    hint.style.opacity = (1 - ramp(p, 0.02, 0.08)).toFixed(3);
    rail.style.opacity = (railIn * (1 - closeIn * 0.4)).toFixed(3);
    /* The room comes up as the glass turns and stays up through the fan —
       without it the separated sheets read as grey cut-outs. */
    glow.style.opacity = Math.max(study * 0.62, 0.4 + 0.6 * fan).toFixed(3);

    const specIn = ramp(p, 0.66, 0.78);
    spec.style.opacity = specIn.toFixed(3);
    spec.style.transform = `translateX(-50%) translateY(${(14 * (1 - easeOut(specIn))).toFixed(2)}px)`;

    copyClose.style.opacity = closeIn.toFixed(3);
    const closeLive = closeIn > 0.5;
    copyClose.classList.toggle('is-live', closeLive);
    copyClose.setAttribute('aria-hidden', closeLive ? 'false' : 'true');
    copyClose.inert = !closeLive;
  }

  /* The hero only animates while it is actually on screen: below it the
     page is a normal document and the canvas has nothing to say. */
  let heroVisible = true;
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(
      ([e]) => { heroVisible = e.isIntersecting; },
      { threshold: 0 }
    ).observe(track);
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(64, now - last);
    last = now;
    if (heroVisible && !document.hidden) {
      measure();
      /* Time-normalised lerp: same feel at any refresh rate. */
      current += (target - current) * (1 - Math.pow(0.0004, dt / 1000));
      if (Math.abs(target - current) < 0.0004) current = target;
      try {
        apply(current, now);
      } catch (err) {
        /* one bad frame must not freeze the teardown for the whole visit */
        console.error(err);
      }
    }
    raf = requestAnimationFrame(frame);
  }

  function still() {
    /* Reduced motion: the finished teardown, no scrubbing. Only the
       opening copy is shown — apply(1) would otherwise print the close
       card on top of it. */
    apply(1);
    copyOpen.style.opacity = '1';
    copyOpen.style.visibility = 'visible';
    copyClose.style.opacity = '0';
    copyClose.classList.remove('is-live');
    copyClose.setAttribute('aria-hidden', 'true');
    copyClose.inert = true;
  }

  if (reduced.matches) {
    still();
  } else {
    /* Paint the correct frame before the browser paints at all. Deferring
       the first apply() to a rAF costs one frame of wrong geometry, and
       snapping current to target means a reload part-way down the track
       does not scrub the whole teardown to catch up. */
    measure();
    current = target;
    apply(current, performance.now());
    raf = requestAnimationFrame(frame);
  }
  reduced.addEventListener('change', () => {
    cancelAnimationFrame(raf);
    if (reduced.matches) still();
    else { current = -1; raf = requestAnimationFrame(frame); }
  });

  /* Below the fold: reveals, counters and the shade picker. ---------------- */

  const revealEls = [...document.querySelectorAll('.reveal')];
  const stats = [...document.querySelectorAll('.stat b[data-count]')];

  function countUp(el) {
    const target = Number(el.dataset.count);
    const t0 = performance.now();
    const dur = 1300;
    (function tick(now) {
      const k = Math.min(1, (now - t0) / dur);
      el.textContent = Math.round(target * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(tick);
    })(t0);
  }

  if ('IntersectionObserver' in window && !reduced.matches) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('in');
        e.target.querySelectorAll('.stat b[data-count]').forEach(countUp);
        io.unobserve(e.target);
      }
    }, { threshold: 0.16 });
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add('in'));
    stats.forEach((el) => { el.textContent = el.dataset.count; });
  }

  /* Tap a depth, the window answers. */
  const shadeVeil = document.querySelector('.shade-veil');
  const extTop = document.querySelector('.ext-top');
  const shadeNote = document.querySelector('.shade-note');
  const shadeLabel = document.querySelector('.shade-label');
  const marks = [...document.querySelectorAll('.glass-mark')];

  /* Inside: how much of the city the tint gives up. Outside: which of the
     five photographs of this car is showing. */
  const SHADE_DIM = { 70: 0.16, 35: 0.4, 20: 0.58, 5: 0.78 };
  const SHADE_SRC = {
    70: 'assets/ext-70.webp',
    35: 'assets/ext-35.webp',
    20: 'assets/ext-20.webp',
    5: 'assets/ext-5.webp',
  };

  const specLine = document.querySelector('.spec-line');
  const saveBtn = document.querySelector('.shade-save');
  const sendLink = document.querySelector('.shade-send');

  /* The five photographs are the whole configurator, so they are warmed as
     soon as the picker is anywhere near the viewport. Without this the
     first tap on a depth waits on a download and reads as a dead button. */
  if ('IntersectionObserver' in window) {
    const shadesSection = document.getElementById('shades');
    if (shadesSection) {
      const warm = new IntersectionObserver(([e], obs) => {
        if (!e.isIntersecting) return;
        obs.disconnect();
        for (const src of [...Object.values(SHADE_SRC), 'assets/ext-split.webp']) {
          new Image().src = src;
        }
      }, { rootMargin: '600px' });
      warm.observe(shadesSection);
    }
  }

  const shadeState = { vlt: '5', style: 'full', mark: false };
  const shadeNotes = { vlt: 'The executive depth. From outside the cabin simply is not there.', style: '', mark: '' };

  const STYLE_NAME = { full: 'Full', fade: 'Fade', visor: 'Visor', split: 'Split' };

  function specText() {
    return `VLT ${shadeState.vlt} · ${STYLE_NAME[shadeState.style]}${shadeState.mark ? ' · DY etch' : ''}`;
  }

  /* Swapping src directly shows whatever the browser has mid-decode, which
     is what made Split flash. Decode the next photograph off-screen first
     and only then put it on the page; the sequence number means a fast
     second click cannot be overtaken by the first one finishing late. */
  let extSeq = 0;
  function setExt(src) {
    if (extTop.getAttribute('src') === src) return;
    const seq = ++extSeq;
    const pre = new Image();
    const swap = () => { if (seq === extSeq) extTop.setAttribute('src', src); };
    pre.src = src;
    if (pre.decode) pre.decode().then(swap, swap);
    else if (pre.complete) swap();
    else { pre.onload = swap; pre.onerror = swap; }
  }

  function renderShade() {
    const flat = shadeState.style === 'split' ? 'full' : shadeState.style;
    shadeVeil.dataset.style = flat;
    shadeVeil.style.opacity = SHADE_DIM[shadeState.vlt];
    if (extTop) {
      /* Split is its own photograph: front door light, rear door black. */
      setExt(shadeState.style === 'split' ? 'assets/ext-split.webp' : SHADE_SRC[shadeState.vlt]);
      extTop.dataset.style = shadeState.style === 'split' ? 'full' : shadeState.style;
      extTop.style.opacity = shadeState.vlt === '70' && shadeState.style !== 'split' ? 0 : 1;
    }
    marks.forEach((m) => m.classList.toggle('is-on', shadeState.mark));
    const styleTag = shadeState.style === 'full' ? '' : ` · ${shadeState.style.toUpperCase()}`;
    shadeLabel.textContent = `VLT ${shadeState.vlt}${styleTag}`;
    shadeNote.textContent = [shadeNotes.vlt, shadeNotes.style, shadeNotes.mark].filter(Boolean).join(' ');
    if (specLine) specLine.textContent = specText();
    if (sendLink) {
      const body = `Hello,%0A%0AMy spec: ${encodeURIComponent(specText())}%0AVehicle:%0APostcode:%0A%0AThanks`;
      sendLink.href = `mailto:studio@driveyours.example?subject=${encodeURIComponent('My Drive Yours spec')}&body=${body}`;
    }
  }

  function setActive(row, attr, value) {
    [...row.querySelectorAll('.shade-btn')].forEach((b) => {
      const hit = b.dataset[attr] === value;
      b.classList.toggle('is-active', hit);
      b.setAttribute('aria-pressed', hit ? 'true' : 'false');
      if (hit && b.dataset.note !== undefined) shadeNotes[attr === 'mark' ? 'mark' : attr] = b.dataset.note;
    });
  }

  document.querySelectorAll('.shade-row').forEach((row) => {
    const btns = [...row.querySelectorAll('.shade-btn')];
    btns.forEach((btn) => {
      btn.addEventListener('click', () => {
        btns.forEach((b) => {
          b.classList.toggle('is-active', b === btn);
          b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
        });
        if (btn.dataset.vlt) { shadeState.vlt = btn.dataset.vlt; shadeNotes.vlt = btn.dataset.note; }
        if (btn.dataset.style) { shadeState.style = btn.dataset.style; shadeNotes.style = btn.dataset.note; }
        if (btn.dataset.mark) { shadeState.mark = btn.dataset.mark === 'on'; shadeNotes.mark = btn.dataset.note; }
        renderShade();
      });
    });
  });

  /* The spec survives the visit: saved on demand, restored on return. */
  try {
    const saved = JSON.parse(localStorage.getItem('dy-spec') || 'null');
    const vlt = saved && String(saved.vlt);
    const style = saved && String(saved.style);
    /* own properties only: "constructor" and friends are inherited and
       would otherwise pass this test and poison the spec */
    if (saved && Object.hasOwn(SHADE_DIM, vlt) && Object.hasOwn(STYLE_NAME, style)) {
      Object.assign(shadeState, { vlt, style, mark: !!saved.mark });
      document.querySelectorAll('.shade-row').forEach((row) => {
        if (row.querySelector('[data-vlt]')) setActive(row, 'vlt', shadeState.vlt);
        else if (row.querySelector('[data-style]')) setActive(row, 'style', shadeState.style);
        else setActive(row, 'mark', shadeState.mark ? 'on' : 'off');
      });
    }
  } catch { /* private mode: the default spec stands */ }
  renderShade();

  if (saveBtn) {
    let saveTimer = 0;
    saveBtn.addEventListener('click', () => {
      try {
        localStorage.setItem('dy-spec', JSON.stringify(shadeState));
        saveBtn.textContent = 'Saved to this browser';
      } catch {
        saveBtn.textContent = 'Could not save here';
      }
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => { saveBtn.textContent = 'Save spec'; }, 1800);
    });
  }
})();
