/* Storefront film website — page behaviour
   1. Intro: three small icons, the name, then the screen lifts (~2 s)
   2. The opening film: one continuous video, autoplay and muted; the logo lands as the camera settles. Autoplay
      refused (iPhone Low Power Mode): first frame + play button. Film failed or stalled: last frame + logo.
   3. Nav state + mobile menu sheet
   4. Reveals, the dish rail (pinned and scroll-driven on wide screens), the phone action bar
   5. Open-now chip in the business's time zone
   6. Coming back (skip the loading screen only on a real return) and ?debug=1
   Edit only the SITE block for a new business. */
(function () {
  'use strict';

  /* ---------- per-business settings ---------- */
  const SITE = {
    timeZone: 'America/Toronto',
    // Hours per weekday, 0 = Sunday. [open, close] in hours (11.5 = 11:30 am). A close past midnight is > 24
    // (25.5 = 1:30 am). null = closed that day. Keep this identical to the hours table, footer and JSON-LD.
    hours: { 0: [9, 21], 1: [9, 21], 2: [9, 21], 3: [9, 21], 4: [9, 21], 5: [9, 21], 6: [9, 21] },
    film: {
      settle: null,   // seconds; null = use #hero data-settle, or media/film/film.json when that is empty
      l: { hi: 'media/film/film-l-hi.mp4', lo: 'media/film/film-l-lo.mp4', last: 'media/film/last-l.jpg', poster: 'media/film/poster-l.jpg' },
      p: { hi: 'media/film/film-p-hi.mp4', lo: 'media/film/film-p-lo.mp4', last: 'media/film/last-p.jpg', poster: 'media/film/poster-p.jpg' }
    }
  };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  // MediaQueryList.addEventListener is missing before iOS 14 / Safari 14: fall back to addListener, never throw
  const onMq = (mq, fn) => { try { mq.addEventListener('change', fn); } catch (e) { if (mq.addListener) mq.addListener(fn); } };
  const params = new URLSearchParams(location.search);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches || params.get('motion') === 'reduce';
  const root = document.documentElement;
  root.classList.add('js');
  root.classList.toggle('reduce-motion', reduceMotion);
  // set by the inline script in index.html: a real return (back from the menu page, a section link), see its comment
  const skipIntro = root.classList.contains('skip-intro');
  const navEntry = (performance.getEntriesByType && performance.getEntriesByType('navigation')[0]) || {};
  const store = {   // sessionStorage can throw (private modes, blocked cookies): every use goes through here
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }
  };

  /* ---------- 1. intro ---------- */
  const intro = $('#intro');
  let introDone = false;
  const onIntroDone = [];
  const behindIntro = () => [$('#nav'), $('main'), $('.footer'), $('#actionBar')].filter(Boolean);
  function finishIntro() {
    if (introDone) return;
    introDone = true;
    if (intro) intro.classList.add('is-done');
    document.body.style.overflow = '';
    behindIntro().forEach(el => el.removeAttribute('inert'));
    onIntroDone.forEach(fn => fn());
    if (intro) setTimeout(() => intro.remove(), 1000);
  }
  function runIntro() {
    if (!intro || skipIntro) { if (intro) intro.remove(); finishIntro(); return; }
    document.body.style.overflow = 'hidden';
    window.scrollTo(0, 0);
    behindIntro().forEach(el => el.setAttribute('inert', ''));
    const treats = $$('#introStage svg');
    const word = $('#introWord'), rule = $('#introRule'), sub = $('#introSub');
    if (reduceMotion) {
      treats[0].classList.add('is-in'); word.classList.add('is-in'); rule.classList.add('is-in'); sub.classList.add('is-in');
      setTimeout(finishIntro, 700);
      return;
    }
    const STEP = 520, HOLD = 240;
    treats.forEach((t, i) => {
      setTimeout(() => t.classList.add('is-in'), i * STEP);
      if (i < treats.length - 1) setTimeout(() => { t.classList.remove('is-in'); t.classList.add('is-out'); }, i * STEP + STEP - HOLD + 120);
    });
    setTimeout(() => { word.classList.add('is-in'); rule.classList.add('is-in'); }, 260);
    setTimeout(() => sub.classList.add('is-in'), 700);
    setTimeout(finishIntro, treats.length * STEP + 520);
  }

  /* ---------- 2. the opening film ----------
     One continuous video. It starts as the loading screen lifts, muted; the logo lands at `settle`
     (media/film/film.json), and the last frame stays on screen as a still once the film has ended.
     Coming back to the page, the film waits at its last frame with "Replay film". */
  const hero = $('#hero');
  function initFilm() {
    if (!hero) return;
    const video = $('#film'), still = $('#heroStill'), playBtn = $('#heroPlay'), skipBtn = $('#skipFilm'), bar = $('#heroProgress');
    const FILM = SITE.film;                                   // paths and settle come from the SITE block
    const settleGiven = FILM.settle || parseFloat(hero.dataset.settle);
    FILM.settle = settleGiven || 6;
    let orient = null, hasPlayed = false, ended = false, wantPlay = false, blocked = false, failed = false, watchdog = 0, raf = 0;
    const portrait = () => window.matchMedia('(orientation: portrait)').matches;
    function reveal() { hero.classList.remove('is-rewinding'); hero.classList.add('is-revealed'); }
    // Desktop windows are usually wider than the 16:9 film, and filling them (object-fit: cover) trimmed its top and bottom,
    // which cut the doorway as the camera went through it. On any window wider than 16:9 the film is shown whole, centred,
    // and the space at its sides is a soft, blurred copy of the picture, drawn into a tiny canvas. Phones: unchanged.
    const fill = $('#heroFill'), fctx = fill ? fill.getContext('2d', { alpha: false }) : null, poster = $('#heroPoster');
    let wide = false, painted = -1;
    function layoutFilm() {
      wide = !!fctx && orient === 'l' && window.innerWidth / window.innerHeight > 16 / 9 + 0.01;
      hero.classList.toggle('is-wide', wide);
      if (wide) hero.style.setProperty('--film-w', Math.round(hero.clientHeight * 16 / 9) + 'px');
      painted = -1;
      paintFill();
    }
    function paintFill() {
      if (!wide) return;
      const showing = still.classList.contains('is-on') ? still : hero.classList.contains('is-playing') ? video : poster;
      if (showing === video) {
        if (video.readyState < 2 || video.currentTime === painted) return;
        painted = video.currentTime;
      } else if (!(showing.complete && showing.naturalWidth)) return;
      try { fctx.drawImage(showing, 0, 0, fill.width, fill.height); } catch (e) {}
    }
    function pickSource() {
      const o = portrait() ? 'p' : 'l';
      if (o === orient) return false;
      orient = o;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const long = Math.max(window.innerWidth, window.innerHeight) * dpr;
      const c = navigator.connection || {};
      const slow = c.saveData || /(^|-)2g|3g/.test(c.effectiveType || '');
      const tier = (long >= 1300 && !slow) ? 'hi' : 'lo';
      video.poster = FILM[o].poster;
      video.src = FILM[o][tier];
      video.dataset.tier = o + '-' + tier;
      still.src = FILM[o].last;
      return true;
    }
    function setBlocked(on) { blocked = on; hero.classList.toggle('is-blocked', on); }
    function tryPlay(retry) {
      wantPlay = true;
      let pr;
      try { pr = video.play(); } catch (e) { pr = Promise.reject(e); }
      if (!pr || !pr.then) return;
      pr.then(() => { hasPlayed = true; setBlocked(false); playBtn.hidden = true; }).catch(err => {
        if (err && err.name === 'AbortError' && !retry) { setTimeout(() => tryPlay(true), 1500); return; }
        if (err && err.name !== 'NotAllowedError' && err.name !== 'AbortError') { filmFailed(false); return; }   // cannot be played at all (unsupported, file failed)
        // autoplay refused (an iPhone in Low Power Mode, data saver, a browser setting): the opening frame stays with a
        // play button, and the logo waits for the film as it does when the film plays; a tap on the picture plays it
        wantPlay = false;
        setBlocked(true);
        playBtn.hidden = false;
      });
    }
    // The film cannot be shown (the file failed to load, the browser cannot play it, or it has not started after 12 s):
    // never leave the opening frame waiting for it. The last frame, the logo and the buttons appear at once; a stalled
    // film (canRetry) keeps a play button, a broken one does not.
    function filmFailed(canRetry) {
      if (failed || hasPlayed || ended) return;
      failed = true; wantPlay = false; clearTimeout(watchdog);
      try { video.pause(); } catch (e) {}
      setBlocked(false);
      still.classList.add('is-on'); reveal(); paintFill();
      playBtn.hidden = !canRetry;
      bar.style.transform = 'scaleX(1)';
    }
    // must run inside the tap itself: a browser that refused autoplay only allows play() during a user gesture, so
    // never wait for metadata first (in Low Power Mode an iPhone loads nothing until play() is called)
    function playFromTap() {
      playBtn.hidden = true; failed = false;
      if (ended || reduceMotion || still.classList.contains('is-on')) {
        still.classList.remove('is-on'); hero.classList.add('is-rewinding'); hero.classList.remove('is-revealed');
        ended = false; skipBtn.textContent = 'Skip film';
      }
      if (reduceMotion) video.preload = 'auto';
      if (video.readyState >= 1) { try { video.currentTime = 0; } catch (e) {} }
      tryPlay(false);
      clearTimeout(watchdog);   // a retry on a bad connection can stall again: never leave the hero without its logo
      watchdog = setTimeout(() => { if (!hasPlayed && !blocked && !ended) filmFailed(true); }, 12000);
    }
    function showLastFrame() {
      ended = true; still.classList.add('is-on'); reveal(); paintFill();
      bar.style.transform = 'scaleX(1)'; skipBtn.textContent = 'Replay film';
    }
    function startFilm() {
      if (reduceMotion) { still.classList.add('is-on'); reveal(); playBtn.hidden = false; skipBtn.textContent = 'Explore the site'; return; }
      if (skipIntro) { showLastFrame(); return; }
      tryPlay(false);   // play() loads the video itself; waiting for metadata first stalls where nothing preloads
      watchdog = setTimeout(() => { if (!hasPlayed && !blocked && !ended) filmFailed(true); }, 12000);
    }
    function frame() {
      paintFill();
      const d = video.duration || 0;
      if (d) bar.style.transform = 'scaleX(' + Math.min(1, video.currentTime / d).toFixed(4) + ')';
      if (!ended && video.currentTime >= FILM.settle) reveal();
      raf = (!video.paused && !ended) ? requestAnimationFrame(frame) : 0;
    }
    function replay() {
      ended = false;
      hero.classList.add('is-rewinding');
      hero.classList.remove('is-revealed');
      still.classList.remove('is-on');
      skipBtn.textContent = 'Skip film';
      try { video.currentTime = 0; } catch (e) {}
      tryPlay(false);
    }
    if (!settleGiven) fetch('media/film/film.json').then(r => r.ok ? r.json() : null).then(j => { if (j && j.settle) FILM.settle = j.settle; }).catch(() => {});
    pickSource();
    layoutFilm();
    if (!reduceMotion && !skipIntro) {
      // start the download once the intro has painted, so the poster and the fonts go first
      const kick = () => { video.preload = 'auto'; video.load(); };
      if ('requestIdleCallback' in window) requestIdleCallback(kick, { timeout: 600 }); else setTimeout(kick, 250);
    }
    video.addEventListener('playing', () => { clearTimeout(watchdog); hero.classList.add('is-playing'); if (!raf) raf = requestAnimationFrame(frame); });
    video.addEventListener('error', () => filmFailed(false));
    video.addEventListener('timeupdate', () => { paintFill(); if (!ended && video.currentTime >= FILM.settle) reveal(); });   // backup when frame callbacks are throttled
    video.addEventListener('seeked', paintFill);
    video.addEventListener('loadeddata', paintFill);
    still.addEventListener('load', paintFill);
    if (poster) poster.addEventListener('load', paintFill);
    video.addEventListener('ended', showLastFrame);
    playBtn.addEventListener('click', playFromTap);
    const scrollCue = $('#heroScroll');
    if (scrollCue) scrollCue.addEventListener('click', () => $('#story').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' }));
    // autoplay refused: a tap anywhere on the picture (not on its links or buttons) plays the film
    hero.addEventListener('click', e => { if (blocked && !e.target.closest('a, button')) playFromTap(); });
    skipBtn.addEventListener('click', () => {
      if (ended) { replay(); return; }
      if (!video.paused) video.pause();
      wantPlay = false;
      setBlocked(false);
      still.classList.add('is-on');
      reveal(); paintFill();
      const s = $('#story');
      s.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
      s.setAttribute('tabindex', '-1'); s.focus({ preventScroll: true });
    });
    // pause while the hero is off screen, resume when it returns; only once the film has really played
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (!hasPlayed || ended || !wantPlay) return;
        if (e.intersectionRatio < 0.1 && !video.paused) video.pause();
        else if (e.intersectionRatio >= 0.1 && video.paused) video.play().catch(() => {});
      });
    }, { threshold: [0, 0.1, 0.5] });
    io.observe(hero);
    // phone rotated: load the film cut for the new orientation and carry on from the same moment
    window.addEventListener('resize', () => {
      const t = video.currentTime, was = !video.paused;
      const changed = pickSource();
      layoutFilm();
      if (changed && !reduceMotion && (!skipIntro || wantPlay)) {
        video.load();
        video.addEventListener('loadedmetadata', () => { try { video.currentTime = Math.min(t, (video.duration || t)); } catch (e) {} if (was) tryPlay(false); }, { once: true });
      }
    }, { passive: true });
    if (introDone) startFilm(); else onIntroDone.push(startFilm);
  }

  /* ---------- 3. nav ---------- */
  const nav = $('#nav'), toggle = $('#navToggle'), sheet = $('#menuSheet'), actionBar = $('#actionBar');
  let heroH = 0, solid = null;
  function onScroll() {
    const past = window.scrollY > heroH - 90;
    if (past === solid) return;
    solid = past;
    nav.classList.toggle('is-solid', past);
    if (actionBar) actionBar.classList.toggle('is-on', past);
  }
  function initNav() {
    heroH = hero ? hero.offsetHeight : 0;
    window.addEventListener('resize', () => { heroH = hero ? hero.offsetHeight : 0; solid = null; onScroll(); }, { passive: true });
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    if (!toggle || !sheet) return;
    const open = (state) => {
      sheet.classList.toggle('is-open', state);
      toggle.setAttribute('aria-expanded', String(state));
      toggle.setAttribute('aria-label', state ? 'Close menu' : 'Open menu');
      nav.classList.toggle('is-solid', state || window.scrollY > heroH - 90);
      document.body.style.overflow = state ? 'hidden' : '';
      sheet.toggleAttribute('inert', !state);
      [$('main'), $('.footer'), actionBar].filter(Boolean).forEach(el => el.toggleAttribute('inert', state));
    };
    onMq(window.matchMedia('(min-width: 900px)'), e => { if (e.matches && sheet.classList.contains('is-open')) open(false); });
    sheet.setAttribute('inert', '');
    toggle.addEventListener('click', () => open(!sheet.classList.contains('is-open')));
    $$('a', sheet).forEach(a => a.addEventListener('click', () => open(false)));
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && sheet.classList.contains('is-open')) { open(false); toggle.focus(); } });
  }

  /* ---------- 4. reveals and the rail ---------- */
  function initReveals() {
    const items = $$('.reveal, .reveal-photo');
    if (reduceMotion || !('IntersectionObserver' in window)) { items.forEach(el => el.classList.add('is-in')); return; }
    const groups = new Map();
    items.forEach(el => { const par = el.parentElement; if (!groups.has(par)) groups.set(par, []); groups.get(par).push(el); });
    groups.forEach(list => list.forEach((el, i) => { el.style.transitionDelay = (Math.min(i, 6) * 140) + 'ms'; }));
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } });
    }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });
    items.forEach(el => io.observe(el));
  }

  function initRail() {
    const section = $('#dishes'), track = $('#railTrack');
    if (!section || !track) return;
    const wide = window.matchMedia('(min-width: 1000px) and (min-height: 620px)');   // same condition as the CSS
    let tgt = 0, cur = 0, r = null, max = 0, secTop = 0, total = 1;
    function layout() {
      if (!wide.matches || reduceMotion) { section.style.height = ''; track.style.transform = ''; return; }
      // measure first, then write, so the browser lays out once
      const trackW = track.scrollWidth, vw = window.innerWidth, vh = window.innerHeight;
      max = Math.max(0, trackW - vw + 40);
      requestAnimationFrame(() => {
        section.style.height = (vh + max * 0.85) + 'px';
        requestAnimationFrame(() => {
          // absolute position: offsetTop would be relative to .page, which is a positioned ancestor
          secTop = section.getBoundingClientRect().top + window.scrollY;
          total = Math.max(1, section.offsetHeight - window.innerHeight);
          update();
        });
      });
    }
    function update() {
      if (!wide.matches || reduceMotion) return;
      tgt = -clamp((window.scrollY - secTop) / total) * max;
      if (!r) r = requestAnimationFrame(tick);
    }
    function tick() {
      if (!wide.matches || reduceMotion) { r = null; cur = tgt = 0; track.style.transform = ''; return; }
      cur += (tgt - cur) * 0.16;
      if (Math.abs(tgt - cur) < 0.3) cur = tgt;
      track.style.transform = 'translate3d(' + cur.toFixed(1) + 'px,0,0)';
      r = (cur !== tgt) ? requestAnimationFrame(tick) : null;
    }
    track.addEventListener('focusin', e => {   // keyboard focus inside the rail brings the card into view
      if (!wide.matches || reduceMotion) return;
      const card = e.target.closest('.card'); if (!card) return;
      const cards = $$('.card', track), idx = cards.indexOf(card);
      window.scrollTo({ top: secTop + (idx / Math.max(1, cards.length - 1)) * total, behavior: 'instant' });
    });
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', layout, { passive: true });
    onMq(wide, layout);
    layout();
    window.addEventListener('load', layout);
  }

  /* ---------- 5. open-now chip and today's row ---------- */
  function localNow() {
    try {
      const f = new Intl.DateTimeFormat('en-CA', { timeZone: SITE.timeZone, weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false });
      const parts = Object.fromEntries(f.formatToParts(new Date()).map(x => [x.type, x.value]));
      const days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      return { day: days[parts.weekday], t: (parseInt(parts.hour, 10) % 24) + parseInt(parts.minute, 10) / 60 };
    } catch (e) { return null; }
  }
  function fmt(h) {
    h = h % 24;
    if (h === 0) return 'midnight';
    const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
    const ap = hh >= 12 ? 'pm' : 'am';
    const h12 = ((hh + 11) % 12) + 1;
    return h12 + (mm ? ':' + String(mm).padStart(2, '0') : '') + ' ' + ap;
  }
  const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  function initHours() {
    const chip = $('#openChip'), now = localNow();
    if (!chip || !now) return;
    const H = SITE.hours;
    $$('#hours tr').forEach(tr => tr.classList.toggle('is-today', parseInt(tr.dataset.day, 10) === now.day));
    const yesterday = H[(now.day + 6) % 7];
    const today = H[now.day];
    // still open from yesterday's late shift (close past midnight)
    if (yesterday && yesterday[1] > 24 && now.t < yesterday[1] - 24) {
      chip.textContent = 'Open now · closes ' + fmt(yesterday[1]); chip.classList.remove('is-closed'); return;
    }
    if (today && now.t >= today[0] && now.t < today[1]) {
      chip.textContent = 'Open now · closes ' + fmt(today[1]); chip.classList.remove('is-closed'); return;
    }
    if (today && now.t < today[0]) {
      chip.textContent = 'Closed · opens ' + fmt(today[0]) + ' today'; chip.classList.add('is-closed'); return;
    }
    for (let k = 1; k <= 7; k++) {
      const d = (now.day + k) % 7;
      if (H[d]) {
        chip.textContent = 'Closed · opens ' + fmt(H[d][0]) + (k === 1 ? ' tomorrow' : ' ' + DAY[d]);
        chip.classList.add('is-closed'); return;
      }
    }
  }

  /* ---------- coming back ----------
     The home page keeps its own scroll position for the back button (the intro sets manual restoration). */
  function initReturn() {
    if (!hero) return;
    window.addEventListener('pagehide', () => store.set('nc-y' + location.pathname, String(Math.round(window.scrollY))));
    if (!skipIntro) store.set('nc-seen', '1');   // from now on, coming back from the menu may skip the loading screen
    // a tap on a link to the menu page leaves a note, so that Back from the menu (and only that) skips the loading screen
    document.addEventListener('click', e => {
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      try { const u = new URL(a.href, location.href); if (u.origin === location.origin && /\/menu(\.html)?$/.test(u.pathname)) store.set('nc-menu-trip', String(Date.now())); } catch (err) {}
    });
    if (!skipIntro) { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; return; }
    let target = null;
    try { target = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1))); } catch (e) {}   // a malformed %-escape in the hash
    const y = navEntry.type === 'back_forward' ? parseInt(store.get('nc-y' + location.pathname) || '0', 10) : 0;
    if (!target && !y) return;
    const go = () => {
      if (target) target.scrollIntoView({ behavior: 'instant' });
      else window.scrollTo({ top: y, behavior: 'instant' });
    };
    go();
    // the dish rail sets its height after layout, which moves everything below it: land again once it has
    window.addEventListener('load', () => requestAnimationFrame(() => requestAnimationFrame(go)), { once: true });
  }

  /* ---------- ?debug=1: a small panel that says why the film did or did not play (for checking a phone) ---------- */
  function initDebug() {
    if (!params.get('debug')) return;
    const box = document.createElement('pre');
    box.style.cssText = 'position:fixed;left:6px;right:6px;bottom:6px;z-index:99999;margin:0;padding:8px 10px;max-height:46vh;overflow:auto;background:rgba(0,0,0,.86);color:#9fffa8;font:11px/1.35 ui-monospace,Menlo,monospace;white-space:pre-wrap;border-radius:8px;pointer-events:none';
    document.body.appendChild(box);
    const v = $('#film'), h = hero;
    let playErr = '';
    if (v) { const p = v.play; v.play = function () { const r = p.apply(this, arguments); if (r && r.catch) r.catch(e => { playErr = e && e.name + ': ' + (e.message || ''); }); return r; }; }
    const paint = () => {
      const n = performance.getEntriesByType('navigation')[0] || {};
      let seen = '?', trip = '?'; try { seen = sessionStorage.getItem('nc-seen'); trip = sessionStorage.getItem('nc-menu-trip'); } catch (e) { seen = 'storage blocked'; }
      box.textContent = [
        'nav type: ' + n.type, 'hash: ' + (location.hash || '(none)'), 'referrer: ' + (document.referrer || '(none)'),
        'skip-intro: ' + root.classList.contains('skip-intro') + '   reduce-motion: ' + reduceMotion + '   (os says: ' + window.matchMedia('(prefers-reduced-motion: reduce)').matches + ')',
        'seen: ' + seen + '   menu-trip: ' + trip, 'intro done: ' + introDone,
        h ? 'hero: ' + [...h.classList].join(' ') : 'no hero (menu page)',
        v ? 'video: ' + (v.currentSrc || '').split('/').pop() + ' ready=' + v.readyState + ' paused=' + v.paused + ' t=' + v.currentTime.toFixed(2) + ' err=' + (v.error ? v.error.code + ' ' + (v.error.message || '') : 'none') : '',
        'play() refused: ' + (playErr || 'no'), 'viewport: ' + innerWidth + 'x' + innerHeight + ' dpr ' + devicePixelRatio,
        'ua: ' + navigator.userAgent.replace(/Mozilla\/5.0 /, '').slice(0, 110)
      ].join('\n');
    };
    paint(); setInterval(paint, 400);
  }

  /* ---------- boot ---------- */
  function boot() {
    // one failing part must never blank the page
    [initNav, initFilm, initReveals, initRail, initHours, initReturn, initDebug].forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
    setInterval(() => { try { initHours(); } catch (e) {} }, 60000);
    runIntro();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
