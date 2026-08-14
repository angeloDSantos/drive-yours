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
  const sheen = document.querySelector('.sheen');
  const aperGlow = document.querySelector('.aperture-glow');
  const etch = document.querySelector('.etch');

  /* The coach-door aperture inside the cabin plate, in the photo's own
     pixels. The pane is seated exactly here at the top of the page. */
  const IMG = { w: 1672, h: 941 };
  const APERTURE = { x: 339, y: 157, w: 1093, h: 420 };

  function apertureRect() {
    const W = stage.clientWidth;
    const H = stage.clientHeight;
    const s = Math.max(W / IMG.w, H / IMG.h);
    /* mirrors object-fit: cover at object-position 50% 42% */
    const ox = (W - IMG.w * s) * 0.5;
    const oy = (H - IMG.h * s) * 0.42;
    return {
      cx: ox + (APERTURE.x + APERTURE.w / 2) * s,
      cy: oy + (APERTURE.y + APERTURE.h / 2) * s,
      w: APERTURE.w * s,
    };
  }

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

  function apply(p) {
    const onPhone = phone.matches;
    const fanDepth = onPhone ? 165 : 300;

    /* Phases */
    const lift = easeInOut(ramp(p, 0.08, 0.3));   /* out of the aperture */
    const tilt = easeInOut(ramp(p, 0.14, 0.34));
    const fan = ramp(p, 0.28, 0.78);
    const openFade = 1 - ramp(p, 0.14, 0.26);
    const railIn = ramp(p, 0.34, 0.44);
    const closeIn = ramp(p, 0.84, 0.94);

    /* The pane starts seated in the photo's window, then comes off it,
       turns to a three-quarter view and fans. The fan spreads towards the
       viewer's left, so the group follows it right and down. */
    const a = apertureRect();
    const seatScale = a.w / pane.offsetWidth;
    const seatX = a.cx - stage.clientWidth / 2;
    const seatY = a.cy - stage.clientHeight / 2;

    const fanEase = easeInOut(fan);

    /* The pop: the pane peels out of the frame top-first and swells
       towards the viewer before settling into the study angle. */
    const peel = Math.sin(Math.PI * Math.min(1, lift * 1.3)) * (1 - lift);
    const pop = 1 + 0.09 * Math.sin(Math.PI * Math.min(1, lift * 1.15)) * (1 - fanEase);

    const ry = (onPhone ? -14 - 36 * tilt : -16 - 44 * tilt) * lift;
    const rx = (5 + 6 * tilt) * lift - 9 * peel;
    const scale = (seatScale + (1 - 0.12 * tilt - seatScale) * lift) * pop;
    const shiftX = seatX * (1 - lift) + ((onPhone ? 0 : 70) + fanEase * (onPhone ? 112 : 150)) * lift;
    const shiftY = seatY * (1 - lift) + fanEase * (onPhone ? 36 : 22) * lift;
    pane.style.transform =
      `translateX(${shiftX.toFixed(2)}px) translateY(${shiftY.toFixed(2)}px) ` +
      `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) scale(${scale.toFixed(4)})`;

    /* Once the pane is away, the whole world goes to black so the
       teardown reads against a clean ground. */
    const toBlack = easeInOut(ramp(p, 0.12, 0.4));
    bgImg.style.transform = `scale(${(1.03 + 0.07 * lift).toFixed(4)})`;
    veil.style.opacity = toBlack.toFixed(3);
    if (sheen) {
      sheen.style.backgroundPosition = `${(100 - p * 100).toFixed(2)}% 0`;
      sheen.style.opacity = (0.35 + 0.65 * lift).toFixed(3);
    }
    if (etch) etch.style.opacity = lift.toFixed(3);
    if (aperGlow) {
      const g = apertureRect();
      const gw = g.w;
      const gh = g.w * (APERTURE.h / APERTURE.w);
      aperGlow.style.left = `${(g.cx - gw / 2).toFixed(1)}px`;
      aperGlow.style.top = `${(g.cy - gh / 2).toFixed(1)}px`;
      aperGlow.style.width = `${gw.toFixed(1)}px`;
      aperGlow.style.height = `${gh.toFixed(1)}px`;
      aperGlow.style.opacity = (lift * (1 - toBlack)).toFixed(3);
    }

    /* Each layer leaves in street-to-cabin order. Seated, the stack must
       read as one near-black pane of privacy glass, so every film except
       the ceramic only fades in as the pane lifts. The close-card dim is
       also set per layer: opacity on the preserve-3d parent would flatten
       the scene and collapse the fan. */
    const dim = 1 - closeIn * 0.3;
    for (let i = 0; i < layers.length; i++) {
      const lp = easeOut(ramp(fan, i * 0.055, i * 0.055 + 0.6));
      layers[i].style.transform = `translateZ(${(lp * SPREAD[i] * fanDepth).toFixed(2)}px)`;
      /* Seated, the pane is not a drawn thing at all: the ceramic tint
         alone darkens the photo's window, and the glass only materialises
         as it comes away. */
      const material = i === 4 ? 0.6 + 0.4 * lift : 0.12 + 0.88 * lift;
      layers[i].style.opacity = (material * dim).toFixed(3);
      const on = lp > 0.5;
      if (railRows[i]) railRows[i].classList.toggle('is-on', on);
    }

    copyOpen.style.opacity = openFade.toFixed(3);
    copyOpen.style.visibility = openFade > 0.001 ? 'visible' : 'hidden';
    hint.style.opacity = (1 - ramp(p, 0.02, 0.08)).toFixed(3);
    rail.style.opacity = (railIn * (1 - closeIn * 0.4)).toFixed(3);
    glow.style.opacity = (fan * 0.9).toFixed(3);

    const specIn = ramp(p, 0.62, 0.74);
    spec.style.opacity = specIn.toFixed(3);
    spec.style.transform = `translateX(-50%) translateY(${(14 * (1 - easeOut(specIn))).toFixed(2)}px)`;

    copyClose.style.opacity = closeIn.toFixed(3);
    copyClose.classList.toggle('is-live', closeIn > 0.5);
    copyClose.setAttribute('aria-hidden', closeIn > 0.5 ? 'false' : 'true');
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(64, now - last);
    last = now;
    measure();
    /* Time-normalised lerp: same feel at any refresh rate. */
    current += (target - current) * (1 - Math.pow(0.0004, dt / 1000));
    if (Math.abs(target - current) < 0.0004) current = target;
    apply(current);
    raf = requestAnimationFrame(frame);
  }

  function still() {
    /* Reduced motion: the finished teardown, no scrubbing. */
    apply(1);
    copyOpen.style.opacity = '1';
    copyOpen.style.visibility = 'visible';
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
})();
