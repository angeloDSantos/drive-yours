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
  const veil = document.querySelector('.stage-veil');
  const aperGlow = document.querySelector('.aperture-glow');
  const etch = document.querySelector('.etch');
  const bokeh = document.querySelector('.bokeh-live');
  const windowHold = document.querySelector('.window-hold');

  /* The coach-door aperture inside the cabin plate, in the photo's own
     pixels. The pane is seated exactly here at the top of the page. */
  const IMG = { w: 1672, h: 941 };
  /* traced from the plate: B-pillar at x306, roofline at y154, rear sweep
     out to x1502, beltline at y592 */
  const APERTURE = { x: 306, y: 154, w: 1196, h: 438 };

  /* The plate is never shown at 1:1 — it sits at a slight zoom that grows
     as the world fades. Everything that has to land on the photographed
     window (the pane's seat, the held window, the light behind it, the
     bokeh canvas) goes through this one mapping, at the same zoom, so they
     cannot drift apart. */
  const bgZoom = (fadeWorld) => 1.03 + 0.05 * fadeWorld;

  function apertureRect(zoom) {
    const W = stage.clientWidth;
    const H = stage.clientHeight;
    const s = Math.max(W / IMG.w, H / IMG.h);
    /* mirrors object-fit: cover at object-position 50% 42% */
    const ox = (W - IMG.w * s) * 0.5;
    const oy = (H - IMG.h * s) * 0.42;
    /* then the plate's own scale, about transform-origin 50% 40% */
    const cx0 = W * 0.5;
    const cy0 = H * 0.4;
    const ax = ox + (APERTURE.x + APERTURE.w / 2) * s;
    const ay = oy + (APERTURE.y + APERTURE.h / 2) * s;
    return {
      cx: cx0 + (ax - cx0) * zoom,
      cy: cy0 + (ay - cy0) * zoom,
      w: APERTURE.w * s * zoom,
      h: APERTURE.h * s * zoom,
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
       teardown, the rain and the rest of the site carry on without it. */
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

  /* Rain on the glass: thin streaks sliding down inside the aperture,
     drawn on the same canvas so they can never drift off the window. */
  const drops = [];
  for (let i = 0; i < 42; i++) {
    drops.push({
      x: Math.random(),
      y: Math.random(),
      v: 0.16 + Math.random() * 0.22,
      len: 0.03 + Math.random() * 0.05,
      a: 0.05 + Math.random() * 0.12,
      w: 0.8 + Math.random() * 0.8,
    });
  }
  let rainClock = 0;

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
    const fanDepth = onPhone ? 165 : 300;

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
    const a = apertureRect(zoom);
    const seatScale = pane.offsetWidth ? a.w / pane.offsetWidth : 1;
    const seatX = a.cx - stage.clientWidth / 2;
    const seatY = a.cy - stage.clientHeight / 2;

    const fanEase = easeInOut(fan);

    /* The pop: the pane peels out of the frame top-first and swells
       towards the viewer before settling into the study angle. */
    const peel = Math.sin(Math.PI * Math.min(1, study * 1.3)) * (1 - study);
    const pop = 1 + 0.09 * Math.sin(Math.PI * Math.min(1, study * 1.15)) * (1 - fanEase);

    const ry = (onPhone ? -50 : -60) * study;
    const rx = (5 + 6 * study) * study - 9 * peel;
    const scale = (seatScale + (1 - 0.12 * study - seatScale) * study) * pop;
    const shiftX = seatX * (1 - study) + ((onPhone ? 54 : 70) + fanEase * (onPhone ? 150 : 150)) * study;
    const shiftY = seatY * (1 - study) + fanEase * (onPhone ? 36 : 22) * study;
    pane.style.transform =
      `translateX(${shiftX.toFixed(2)}px) translateY(${shiftY.toFixed(2)}px) ` +
      `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) scale(${scale.toFixed(4)})`;

    bgImg.style.transform = `scale(${zoom.toFixed(4)})`;
    veil.style.opacity = fadeWorld.toFixed(3);

    /* The rest of the car goes; the glass stays. The hold is the window's
       own pixels mapped at the plate's resting scale, riding above the
       veil until the pane has clearly popped out. */
    const left = a.cx - a.w / 2;
    const top = a.cy - a.h / 2;
    if (windowHold) {
      const s = Math.max(stage.clientWidth / IMG.w, stage.clientHeight / IMG.h) * zoom;
      windowHold.style.left = `${left.toFixed(1)}px`;
      windowHold.style.top = `${top.toFixed(1)}px`;
      windowHold.style.width = `${a.w.toFixed(1)}px`;
      windowHold.style.height = `${a.h.toFixed(1)}px`;
      windowHold.style.backgroundSize = `${(IMG.w * s).toFixed(1)}px ${(IMG.h * s).toFixed(1)}px`;
      windowHold.style.backgroundPosition = `${(-APERTURE.x * s).toFixed(1)}px ${(-APERTURE.y * s).toFixed(1)}px`;
      windowHold.style.opacity = (fadeWorld * (1 - release)).toFixed(3);
    }
    if (etch) etch.style.opacity = study.toFixed(3);
    if (aperGlow) {
      /* While the world fades, a soft light behind the seated window makes
         it the last lit thing on the page. It dies as the pane detaches. */
      aperGlow.style.left = `${left.toFixed(1)}px`;
      aperGlow.style.top = `${top.toFixed(1)}px`;
      aperGlow.style.width = `${a.w.toFixed(1)}px`;
      aperGlow.style.height = `${a.h.toFixed(1)}px`;
      aperGlow.style.opacity = (fadeWorld * (1 - study)).toFixed(3);
    }

    /* The rain needs no sampled pixels, so it draws whether or not the
       bokeh seeding succeeded. */
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

      /* clamped both ways: a still() frame passes now = 0, which would
         otherwise drive every drop far off the top of the glass */
      const rainDt = rainClock ? Math.max(0, Math.min(0.05, (now - rainClock) / 1000)) : 0;
      rainClock = now;
      for (const d of drops) {
        d.y += d.v * rainDt;
        if (d.y > 1.05) { d.y = -0.05; d.x = Math.random(); }
        const dx = gw * (d.x + d.y * 0.015);
        bctx.strokeStyle = `rgba(196, 216, 232, ${d.a.toFixed(3)})`;
        bctx.lineWidth = d.w;
        bctx.beginPath();
        bctx.moveTo(dx, gh * d.y);
        bctx.lineTo(dx - gw * 0.004, gh * (d.y - d.len));
        bctx.stroke();
      }
      }
    }

    /* Each layer leaves in street-to-cabin order. Seated, the stack must
       read as one near-black pane of privacy glass, so every film except
       the ceramic only fades in as the pane lifts. The close-card dim is
       also set per layer: opacity on the preserve-3d parent would flatten
       the scene and collapse the fan. */
    const dim = 1 - closeIn * 0.3;
    /* Seated, the pane is not a drawn thing at all: the ceramic tint alone
       darkens the photo's window. The glass half-materialises as the world
       fades (so it reads against black) and completes as it detaches. */
    const materialise = 0.5 * fadeWorld + 0.5 * study;
    for (let i = 0; i < layers.length; i++) {
      const lp = easeOut(ramp(fan, i * 0.055, i * 0.055 + 0.6));
      layers[i].style.transform = `translateZ(${(lp * SPREAD[i] * fanDepth).toFixed(2)}px)`;
      /* Seated haze kept low so the living city stays readable through
         the tint. */
      const material = i === 4 ? 0.6 + 0.4 * materialise : 0.07 + 0.93 * materialise;
      layers[i].style.opacity = (material * dim).toFixed(3);
      const on = lp > 0.5;
      if (railRows[i]) railRows[i].classList.toggle('is-on', on);
    }

    copyOpen.style.opacity = openFade.toFixed(3);
    copyOpen.style.visibility = openFade > 0.001 ? 'visible' : 'hidden';
    hint.style.opacity = (1 - ramp(p, 0.02, 0.08)).toFixed(3);
    rail.style.opacity = (railIn * (1 - closeIn * 0.4)).toFixed(3);
    glow.style.opacity = (fan * 0.9).toFixed(3);

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
    } else {
      rainClock = now;
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

  const shadeState = { vlt: '5', style: 'full', mark: false };
  const shadeNotes = { vlt: 'The executive depth. From outside the cabin simply is not there.', style: '', mark: '' };

  const STYLE_NAME = { full: 'Full', fade: 'Fade', visor: 'Visor', split: 'Split' };

  function specText() {
    return `VLT ${shadeState.vlt} · ${STYLE_NAME[shadeState.style]}${shadeState.mark ? ' · DY etch' : ''}`;
  }

  function renderShade() {
    const flat = shadeState.style === 'split' ? 'full' : shadeState.style;
    shadeVeil.dataset.style = flat;
    shadeVeil.style.opacity = SHADE_DIM[shadeState.vlt];
    if (extTop) {
      /* Split is its own photograph: front door light, rear door black. */
      const src = shadeState.style === 'split' ? 'assets/ext-split.webp' : SHADE_SRC[shadeState.vlt];
      if (!extTop.src.endsWith(src)) extTop.src = src;
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
