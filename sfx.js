/* SFX.play('wound'); SFX.play('victory',{volume:.6}); const h=SFX.play('thunder5'); h.stop();
   SFX.setMasterVolume(.5); SFX.preload('common'); SFX.listSounds(); SFX.unlock(); SFX.stopAll(); */
import { SFX_DATA } from './sfx-data.js';

export async function fetchWithProgress(url, cb = () => {}) {
  cb('wait');
  const r = await fetch(url);
  if (!r.ok) throw new Error(fetch failed (${r.status}) ${url});
  const total = +r.headers.get('content-length') || 0;
  if (!r.body || !r.body.getReader) return r.arrayBuffer();
  const rd = r.body.getReader(), parts = [];
  let n = 0;
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    parts.push(value); n += value.length; cb('get', n, total);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out.buffer;
}

export const SFX = (() => {
  let ctx = null, master = null, vol = 1;
  const cache = {}, active = new Set();

  function ensure() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = vol;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function pick(sprite) {
    const p = document.createElement('audio');
    if (p.canPlayType) for (const s of sprite.sources) {
      const r = p.canPlayType(s.type);
      if (r === 'probably' || r === 'maybe') return s;
    }
    return sprite.sources[0];
  }

  function load(name, cb) {
    const e = cache[name] || (cache[name] = {});
    if (e.p) return e.p;
    const sprite = SFX_DATA[name];
    if (!sprite) return Promise.reject(new Error(SFX: no sprite "${name}"));
    const c = ensure();
    e.p = fetchWithProgress(pick(sprite).url, cb)
      .then(b => { if (cb) cb('dec'); return c.decodeAudioData(b); })
      .catch(err => { e.p = null; throw err; });
    return e.p;
  }

  function find(name, sp) {
    const names = sp ? [sp] : Object.keys(SFX_DATA).filter(s => SFX_DATA[s].sounds[name]);
    if (names.length > 1) throw new Error(SFX: "${name}" is in several sprites (${names.join(', ')}), pass { sprite });
    const def = names.length && SFX_DATA[names[0]] && SFX_DATA[names[0]].sounds[name];
    if (!def) throw new Error(SFX: no sound "${name}");
    return { sp: names[0], def };
  }

  function play(name, opts = {}) {
    let stopped = false, live = null;
    const handle = { stop() { stopped = true; if (live) try { live.stop(); } catch (_) {} } };
    let f;
    try { f = find(name, opts.sprite); } catch (e) { console.warn(e.message); return handle; }
    load(f.sp).then(buf => {
      if (stopped) return;
      const c = ensure(), s = c.createBufferSource(), g = c.createGain();
      s.buffer = buf;
      if (opts.playbackRate) s.playbackRate.value = opts.playbackRate;
      g.gain.value = opts.volume ?? 1;
      s.connect(g).connect(master);
      live = s; active.add(s);
      s.onended = () => active.delete(s);
      s.start(0, f.def.start, f.def.end - f.def.start);
    }).catch(e => console.warn(e.message));
    return handle;
  }

  return {
    play,
    preload: (name, cb) => load(name, cb),
    unlock: ensure,
    setMasterVolume(v) { vol = Math.max(0, Math.min(1, v)); if (master) master.gain.value = vol; },
    stopAll() { active.forEach(s => { try { s.stop(); } catch (_) {} }); active.clear(); },
    listSounds() {
      return Object.keys(SFX_DATA).flatMap(sp => Object.entries(SFX_DATA[sp].sounds)
        .map(([name, d]) => ({ name, sprite: sp, duration: +(d.end - d.start).toFixed(3) })));
    }
  };
})()
