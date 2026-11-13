// Motion-graphics timeline. setTimeline(spec) builds the elements, renderAt(t) poses them for time t and returns a
// short state string (two frames with the same string are identical, so the renderer can reuse the image).
"use strict";
let S = null, items = [];
const $ = (h) => { const d = document.createElement("div"); d.innerHTML = h.trim(); return d.firstChild; };
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const outExpo = (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
const outCubic = (x) => 1 - Math.pow(1 - x, 3);
const inOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const inOut = (x) => (x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const r2 = (x) => Math.round(x * 100) / 100;

function place(el, x, y, anchor) {   // anchor: "c" centre, "tl" top-left, "bl" bottom-left, "tc" top-centre
  el.style.left = x + "px"; el.style.top = y + "px";
  el.dataset.anchor = anchor;
}
function pose(el, { o = 1, tx = 0, ty = 0, s = 1, blur = 0 }) {
  const a = el.dataset.anchor;
  const base = a === "c" ? "translate(-50%,-50%)" : a === "tc" ? "translate(-50%,0)" : a === "bl" ? "translate(0,-100%)" : a === "cl" ? "translate(0,-50%)" : "";
  el.style.opacity = r2(o); el.style.transform = `${base} translate(${r2(tx)}px,${r2(ty)}px) scale(${r2(s)})`;
  el.style.filter = blur > 0.05 ? `blur(${r2(blur)}px)` : "none";
  el.style.visibility = o <= 0.001 ? "hidden" : "visible";
  return `${r2(o)}|${r2(tx)}|${r2(ty)}|${r2(s)}|${r2(blur)}`;
}
/** 0..1 in, 1 hold, 1..0 out */
function life(t, at, until, inDur, outDur) {
  if (t < at || t > until) return { vis: false, i: 0, o: 0, lt: t - at };
  return { vis: true, i: clamp((t - at) / inDur), o: clamp((until - t) / outDur), lt: t - at };
}

window.setTimeline = function (spec) {
  S = spec; items = [];
  const P = spec.format === "short", W = spec.W, H = spec.H, u = Math.min(W, H) / 100;
  document.documentElement.style.setProperty("--u", u + "px");
  document.body.style.setProperty("--W", W + "px"); document.body.style.setProperty("--H", H + "px");
  document.body.className = spec.script;
  const L = document.getElementById("layers"); L.innerHTML = "";
  document.getElementById("scrimTop").style.height = (P ? 20 : 24) + "%";
  document.getElementById("scrimBot").style.height = (P ? 44 : 30) + "%";

  // brand tag + credit
  const tag = $(`<div id="tag" class="abs"><i></i><span>${esc(spec.tag)}</span></div>`); L.appendChild(tag);
  place(tag, (P ? 5 : 3.6) * u, P ? H * 0.055 : 3.8 * u, "tl"); items.push({ kind: "tag", el: tag });
  for (const c of spec.credits || []) {
    const el = $(`<div class="abs" id="credit">${esc(c.text)}</div>`); L.appendChild(el);
    if (P) place(el, 5 * u, H * 0.055 + 6.4 * u, "tl"); else place(el, 3.6 * u, H - 3.2 * u, "bl");
    items.push({ kind: "credit", el, ...c });
  }
  // hook
  if (spec.hook) {
    const lines = splitLines(spec.hook.text, P ? 2 : 1);
    const html = lines.map((ln) => `<span class="line">${ln.map((w) => `<span class="w${w.hi ? " hi" : ""}">${esc(w.t)}</span>`).join(" ")}</span>`).join("");
    const el = $(`<div id="hook" class="abs">${html}</div>`); L.appendChild(el);
    place(el, W / 2, P ? H * 0.4 : H * 0.45, "c"); items.push({ kind: "hook", el, ...spec.hook, words: [...el.querySelectorAll(".w")] });
  }
  // kickers
  for (const k of spec.kickers || []) {
    const lines = splitLines(k.title, P ? 2 : 1).map((ln) => ln.map((w) => w.t).join(" "));
    const el = $(`<div class="abs kick ${P ? "center" : ""}"><div class="label"><b></b><span></span></div><div class="title">${lines.map((l) => `<span class="line"><span class="in">${esc(l)}</span></span>`).join("")}</div><div class="rule"></div></div>`);
    L.appendChild(el);
    if (P) { el.style.width = W * 0.9 + "px"; place(el, W / 2, H * 0.13, "tc"); } else { el.style.width = W * 0.7 + "px"; place(el, 7 * u, H * 0.84, "bl"); }
    items.push({ kind: "kicker", el, ...k, ins: [...el.querySelectorAll(".in")], labelEl: el.querySelector(".label span"), rule: el.querySelector(".rule") });
  }
  // stats
  for (const s of spec.stats || []) {
    const el = $(`<div class="abs stat"><div class="glow"></div><div class="num"></div><div class="unit">${esc(s.unit || "")}</div><div class="bar"></div></div>`);
    L.appendChild(el); place(el, W / 2, P ? H * 0.42 : H * 0.46, "c");
    items.push({ kind: "stat", el, ...s, num: el.querySelector(".num"), bar: el.querySelector(".bar"), target: parseNum(s.value) });
  }
  // orbit diagrams
  for (const o of spec.orbits || []) {
    const R = (P ? 17 : 14) * u, E = R * 0.56, n = o.count;
    const ticks = Array.from({ length: n }, (_, i) => { const a = -Math.PI / 2 + (i / n) * Math.PI * 2; return `<circle class="tk" cx="${r2(Math.cos(a) * (R + 2.2 * u))}" cy="${r2(Math.sin(a) * (R + 2.2 * u))}" r="${r2(0.75 * u)}"/>`; }).join("");
    const el = $(`<div class="abs orbit"><div class="glow"></div><svg width="${R * 2 + 8 * u}" height="${R * 2 + 8 * u}" viewBox="${-R - 4 * u} ${-R - 4 * u} ${R * 2 + 8 * u} ${R * 2 + 8 * u}">
      <defs><radialGradient id="eg" cx="35%" cy="35%" r="75%"><stop offset="0" stop-color="#4F8CC9"/><stop offset=".55" stop-color="#1D4E7E"/><stop offset="1" stop-color="#071A2E"/></radialGradient>
      <linearGradient id="term" x1="0" x2="1"><stop offset=".48" stop-color="rgba(0,0,0,0)"/><stop offset=".62" stop-color="rgba(0,0,0,.62)"/></linearGradient></defs>
      <circle r="${R}" fill="none" stroke="rgba(255,255,255,.28)" stroke-width="${r2(0.18 * u)}" stroke-dasharray="${r2(0.6 * u)} ${r2(0.9 * u)}"/>
      <circle r="${E}" fill="url(#eg)"/><circle r="${E}" fill="url(#term)" class="termc"/>
      <circle r="${E}" fill="none" stroke="rgba(150,200,255,.55)" stroke-width="${r2(0.35 * u)}"/>
      <g class="tks" fill="#FFC94A">${ticks}</g>
      <g class="iss"><circle r="${r2(1.0 * u)}" fill="#fff"/><circle r="${r2(2.4 * u)}" fill="rgba(255,255,255,.18)"/></g>
      <path class="trail" fill="none" stroke="rgba(255,201,74,.9)" stroke-width="${r2(0.35 * u)}" stroke-linecap="round"/>
    </svg><div class="count"></div><div class="cap">${esc(o.caption || "")}</div></div>`);
    L.appendChild(el); place(el, W / 2, P ? H * 0.43 : H * 0.47, "c");
    items.push({ kind: "orbit", el, ...o, R, iss: el.querySelector(".iss"), trail: el.querySelector(".trail"), tks: [...el.querySelectorAll(".tk")], cnt: el.querySelector(".count") });
  }
  // lower thirds
  for (const lo of spec.lowers || []) {
    const el = $(`<div class="abs lower">${esc(lo.text)}</div>`); L.appendChild(el);
    if (P) place(el, 5 * u, H * 0.6, "tl"); else place(el, 6 * u, H * 0.8, "bl");
    items.push({ kind: "lower", el, ...lo });
  }
  // captions
  if (spec.captions?.length) {
    const el = $(`<div id="cap" class="abs"></div>`); L.appendChild(el); el.style.width = W * 0.86 + "px";
    place(el, W / 2, H * 0.665, "c"); items.push({ kind: "cap", el, groups: spec.captions, cur: -1 });
  }
  // globe locators
  for (const m of spec.maps || []) {
    const R = (P ? 25 : 19) * u, pad = 6 * u;
    const el = $(`<div class="abs map"><div class="glow"></div><svg width="${R * 2 + pad * 2}" height="${R * 2 + pad * 2}" viewBox="${-R - pad} ${-R - pad} ${R * 2 + pad * 2} ${R * 2 + pad * 2}">
      <defs><radialGradient id="oc${items.length}" cx="38%" cy="32%" r="80%"><stop offset="0" stop-color="#16395C"/><stop offset=".7" stop-color="#0A1D31"/><stop offset="1" stop-color="#040C16"/></radialGradient>
      <radialGradient id="sh${items.length}" cx="35%" cy="30%" r="75%"><stop offset=".55" stop-color="rgba(0,0,0,0)"/><stop offset="1" stop-color="rgba(0,0,0,.55)"/></radialGradient></defs>
      <circle r="${R + 0.9 * u}" fill="none" stroke="rgba(130,190,255,.22)" stroke-width="${r2(1.6 * u)}" style="filter: blur(${r2(0.9 * u)}px)"/>
      <circle r="${R}" fill="url(#oc${items.length})"/>
      <path class="grat" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="${r2(0.12 * u)}"/>
      <path class="land" fill="#E6ECF1" fill-opacity=".93"/>
      <path class="bord" fill="none" stroke="rgba(20,40,60,.45)" stroke-width="${r2(0.1 * u)}"/>
      <circle r="${R}" fill="url(#sh${items.length})"/>
      <circle r="${R}" fill="none" stroke="rgba(160,210,255,.6)" stroke-width="${r2(0.22 * u)}"/>
      <g class="pin"><circle class="ring" r="${r2(1.2 * u)}" fill="none" stroke="#FFC94A" stroke-width="${r2(0.3 * u)}"/><circle r="${r2(0.75 * u)}" fill="#FFC94A"/><line class="lead" x1="0" y1="0" stroke="rgba(255,255,255,.75)" stroke-width="${r2(0.16 * u)}"/></g>
    </svg><div class="card"><div class="nm">${esc(m.label)}</div><div class="co">${esc(m.coords)}</div></div></div>`);
    L.appendChild(el); place(el, P ? W / 2 : W * 0.7, P ? H * 0.44 : H * 0.5, "c");
    items.push({ kind: "map", el, ...m, R, pad, svg: el.querySelector("svg"), land: el.querySelector(".land"), bord: el.querySelector(".bord"), grat: el.querySelector(".grat"),
      pin: el.querySelector(".pin"), ring: el.querySelector(".ring"), lead: el.querySelector(".lead"), card: el.querySelector(".card") });
  }
  // chapter cards
  for (const c of spec.chapters || []) {
    const el = $(`<div class="abs chapter"><div class="no">${esc(c.no)}</div><div class="ti">${esc(c.title)}</div><div class="ln"></div></div>`);
    L.appendChild(el); el.style.width = W + "px"; el.style.height = H + "px"; place(el, 0, 0, "tl");
    items.push({ kind: "chapter", el, ...c, ti: el.querySelector(".ti"), ln: el.querySelector(".ln"), no: el.querySelector(".no") });
  }
  // comparison bars
  for (const c of spec.compares || []) {
    const max = Math.max(...c.bars.map((b) => b.value));
    const el = $(`<div class="abs compare">${c.bars.map((b) => `<div class="row"><div class="lab"><span>${esc(b.label)}</span><b>${esc(b.display)}</b></div><div class="track"><div class="fill"></div></div></div>`).join("")}</div>`);
    L.appendChild(el); el.style.width = (P ? W : W * 0.62) + "px"; place(el, P ? W / 2 : W * 0.5, P ? H * 0.44 : H * 0.55, "c");
    items.push({ kind: "compare", el, ...c, fills: [...el.querySelectorAll(".fill")].map((f, i) => ({ f, k: c.bars[i].value / max })) });
  }
  // the question card
  if (spec.ask) {
    const el = $(`<div id="ask" class="abs"><svg class="bubble" viewBox="0 0 24 24"><path fill="#FFC94A" d="M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-7l-5 4v-4H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/></svg><div class="label">${esc(spec.ask.label)}</div><div class="q">${esc(spec.ask.text)}</div></div>`);
    L.appendChild(el); if (!P) el.style.width = W * 0.56 + "px";
    place(el, W / 2, H * (P ? 0.47 : 0.5), "c"); items.push({ kind: "ask", el, ...spec.ask });
  }
  if ((spec.maps || []).length && window.WORLD) {
    const w = window.WORLD; window.LAND = topojson.feature(w, w.objects.land); window.BORD = topojson.mesh(w, w.objects.countries, (a, b) => a !== b);
    window.GRAT = d3.geoGraticule10();
  }
  return document.fonts.ready.then(() => true);
};

/** "16 sunrises before *your* day ends" -> lines of words; *word* = highlighted */
function splitLines(text, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean).map((w) => ({ t: w.replace(/^\*|\*$/g, ""), hi: /^\*.*\*$/.test(w) }));
  if (maxLines <= 1 || words.length < 3) return [words];
  // break where it reads best: after a full stop or comma near the middle, otherwise at the middle
  const total = words.reduce((a, w) => a + w.t.length + 1, 0); let acc = 0, cut = 1, best = Infinity;
  for (let i = 0; i < words.length - 1; i++) {
    acc += words[i].t.length + 1;
    const cost = Math.abs(acc / total - 0.5) - (/[.,;:!?।]$/.test(words[i].t) ? 0.22 : 0);
    if (cost < best) { best = cost; cut = i + 1; }
  }
  return [words.slice(0, cut), words.slice(cut)].filter((l) => l.length);
}
function parseNum(v) { const s = String(v), digits = s.replace(/[^0-9.]/g, ""); return { n: parseFloat(digits) || 0, comma: s.includes(","), dec: (digits.split(".")[1] || "").length, prefix: s.match(/^[^0-9]*/)[0], suffix: s.match(/[^0-9.,]*$/)[0] }; }
function fmtNum(T, x) { let s = x.toFixed(T.dec); if (T.comma) s = Number(s).toLocaleString("en-US", { minimumFractionDigits: T.dec, maximumFractionDigits: T.dec }); return T.prefix + s + T.suffix; }

window.renderAt = function (t) {
  if (!S) return "";
  const P = S.format === "short", u = Math.min(S.W, S.H) / 100; let st = "";
  for (const it of items) {
    switch (it.kind) {
      case "tag": { const lf = life(t, 0.25, S.duration - 0.15, 0.5, 0.3); st += pose(it.el, { o: lf.vis ? Math.min(lf.i, lf.o) : 0, tx: (1 - outCubic(lf.i)) * -2 * u }); break; }
      case "credit": { const lf = life(t, it.at, it.until, 0.35, 0.25); st += pose(it.el, { o: lf.vis ? Math.min(lf.i, lf.o) * 0.95 : 0 }); break; }
      case "hook": {
        const lf = life(t, it.at, it.until, 0.5, 0.22);
        st += pose(it.el, { o: lf.vis ? lf.o : 0, s: 1 + (1 - lf.o) * 0.06, blur: (1 - lf.o) * 10 });
        it.words.forEach((w, i) => { const p = outExpo(clamp((lf.lt - i * 0.055) / 0.42)); w.style.transform = `translateY(${r2((1 - p) * 105)}%)`; st += r2(p); });
        break;
      }
      case "kicker": {
        const lf = life(t, it.at, it.until, 1.2, 0.35);
        st += pose(it.el, { o: lf.vis ? lf.o : 0, ty: (1 - lf.o) * -1.5 * u });
        if (lf.vis) {
          const n = Math.round(clamp(lf.lt / 0.45) * it.label.length); it.labelEl.textContent = it.label.slice(0, n); st += n;
          it.ins.forEach((el, i) => { const p = outExpo(clamp((lf.lt - 0.12 - i * 0.1) / 0.7)); el.style.transform = `translateY(${r2((1 - p) * 110)}%)`; st += r2(p); });
          const pr = outExpo(clamp((lf.lt - 0.35) / 0.6)); it.rule.style.transform = `scaleX(${r2(pr)})`; st += r2(pr);
        }
        break;
      }
      case "stat": {
        const lf = life(t, it.at, it.until, 0.5, 0.3);
        st += pose(it.el, { o: lf.vis ? Math.min(clamp(lf.lt / 0.18), lf.o) : 0, s: 0.9 + 0.1 * outExpo(lf.i), blur: (1 - outCubic(lf.i)) * 12 });
        if (lf.vis) {
          const p = outExpo(clamp(lf.lt / 1.15)); it.num.textContent = fmtNum(it.target, it.target.n * p); st += it.num.textContent;
          const pb = outExpo(clamp((lf.lt - 0.5) / 0.6)); it.bar.style.transform = `scaleX(${r2(pb)})`; st += r2(pb);
        }
        break;
      }
      case "orbit": {
        const lf = life(t, it.at, it.until, 0.45, 0.3);
        st += pose(it.el, { o: lf.vis ? Math.min(lf.i, lf.o) : 0, s: 0.92 + 0.08 * outExpo(lf.i) });
        if (lf.vis) {
          const spin = it.spin || 3.2, laps = it.count * inOut(clamp((lf.lt - 0.25) / spin));
          const a = -Math.PI / 2 + laps * Math.PI * 2, R = it.R;
          it.iss.setAttribute("transform", `translate(${r2(Math.cos(a) * R)},${r2(Math.sin(a) * R)})`);
          const ta = Math.max(-Math.PI / 2, a - 1.1), pts = []; for (let k = 0; k <= 12; k++) { const b = ta + ((a - ta) * k) / 12; pts.push(`${r2(Math.cos(b) * R)},${r2(Math.sin(b) * R)}`); }
          it.trail.setAttribute("d", "M" + pts.join(" L")); it.trail.style.opacity = laps > 0.02 ? 1 : 0;
          const lit = Math.min(it.count, Math.floor(laps + 0.0001) + (laps > 0.02 ? 1 : 0));
          it.tks.forEach((c, i) => { c.style.opacity = i < lit ? 1 : 0.18; });
          it.cnt.textContent = String(Math.max(lit, 0)); st += `${r2(laps)}|${lit}`;
        }
        break;
      }
      case "lower": { const lf = life(t, it.at, it.until, 0.45, 0.3); st += pose(it.el, { o: lf.vis ? Math.min(lf.i, lf.o) : 0, tx: (1 - outExpo(lf.i)) * -4 * u }); break; }
      case "cap": {
        const gi = it.groups.findIndex((g) => t >= g.at && t < g.until);
        if (gi !== it.cur) { it.cur = gi; it.el.innerHTML = gi < 0 ? "" : it.groups[gi].words.map((w) => `<span class="w">${esc(w.w)}</span>`).join(" "); }
        if (gi < 0) { st += pose(it.el, { o: 0 }); break; }
        const g = it.groups[gi], p = outExpo(clamp((t - g.at) / 0.16));
        st += `g${gi}` + pose(it.el, { o: clamp((t - g.at) / 0.06), s: 0.86 + 0.14 * p });
        [...it.el.children].forEach((el, i) => { const on = t >= g.words[i].at; el.classList.toggle("on", on && t < g.words[i].until + 0.25); st += on ? 1 : 0; });
        break;
      }
      case "ask": { const lf = life(t, it.at, it.until, 0.55, 0.3); st += pose(it.el, { o: lf.vis ? Math.min(clamp(lf.lt / 0.3), lf.o) : 0, ty: (1 - outExpo(lf.i)) * 6 * u, blur: (1 - outCubic(lf.i)) * 8 }); break; }
      case "map": {
        const lf = life(t, it.at, it.until, 0.5, 0.35);
        st += pose(it.el, { o: lf.vis ? Math.min(lf.i, lf.o) : 0, s: 0.9 + 0.1 * outExpo(lf.i) });
        if (lf.vis && window.LAND) {
          const p = inOut(clamp((lf.lt - 0.1) / 1.7)), lon0 = it.lon + 85, lat0 = it.lat * 0.2 + 10;
          const rot = [-(lon0 + (it.lon - lon0) * p), -(lat0 + (it.lat - lat0) * p)];
          const proj = d3.geoOrthographic().scale(it.R).translate([0, 0]).rotate(rot).clipAngle(90), path = d3.geoPath(proj);
          it.land.setAttribute("d", path(window.LAND) || ""); it.bord.setAttribute("d", path(window.BORD) || ""); it.grat.setAttribute("d", path(window.GRAT) || "");
          const xy = proj([it.lon, it.lat]) || [0, 0], pin = clamp((lf.lt - 1.6) / 0.3);
          it.pin.setAttribute("transform", `translate(${r2(xy[0])},${r2(xy[1])})`); it.pin.style.opacity = r2(pin);
          const pulse = ((lf.lt - 1.6) % 1.2) / 1.2; it.ring.setAttribute("r", r2((1.2 + 3.2 * Math.max(0, pulse)) * u)); it.ring.style.opacity = r2(pin * (1 - Math.max(0, pulse)));
          const dx = (xy[0] > 0 ? 1 : -1) * 7 * u, dy = -6 * u; it.lead.setAttribute("x2", r2(dx * outExpo(clamp((lf.lt - 1.75) / 0.4)))); it.lead.setAttribute("y2", r2(dy * outExpo(clamp((lf.lt - 1.75) / 0.4))));
          const cardIn = outExpo(clamp((lf.lt - 1.95) / 0.5)), box = it.svg.getBoundingClientRect(), host = it.el.getBoundingClientRect();
          const cx = box.left - host.left + (xy[0] + it.R + it.pad) * (box.width / (it.R * 2 + it.pad * 2)) + dx, cy = box.top - host.top + (xy[1] + it.R + it.pad) * (box.height / (it.R * 2 + it.pad * 2)) + dy;
          it.card.style.left = r2(xy[0] > 0 ? cx : cx - it.card.offsetWidth) + "px"; it.card.style.top = r2(cy - it.card.offsetHeight) + "px";
          it.card.style.opacity = r2(cardIn); it.card.style.transform = `translateY(${r2((1 - cardIn) * 1.5 * u)}px)`;
          st += `${r2(p)}|${r2(pin)}|${r2(pulse)}|${r2(cardIn)}`;
        }
        break;
      }
      case "chapter": {
        const lf = life(t, it.at, it.until, 0.8, 0.4);
        st += pose(it.el, { o: lf.vis ? Math.min(clamp(lf.lt / 0.25), lf.o) : 0 });
        if (lf.vis) { const a = outExpo(clamp((lf.lt - 0.1) / 0.7)); it.ti.style.transform = `translateX(${r2((1 - a) * -4 * u)}px)`; it.ti.style.opacity = r2(a); it.ln.style.transform = `scaleX(${r2(outExpo(clamp((lf.lt - 0.3) / 0.8)))})`; st += r2(a) + "|" + r2(lf.lt > 1.1 ? 1 : lf.lt); }
        break;
      }
      case "compare": {
        const lf = life(t, it.at, it.until, 0.4, 0.3);
        st += pose(it.el, { o: lf.vis ? Math.min(lf.i, lf.o) : 0, ty: (1 - outExpo(lf.i)) * 2 * u });
        if (lf.vis) it.fills.forEach((x, i) => { const g = outExpo(clamp((lf.lt - 0.3 - i * 0.25) / 1.1)) * x.k; x.f.style.transform = `scaleX(${r2(Math.max(0.004, g))})`; st += r2(g); });
        break;
      }
    }
  }
  // transitions: flashes and warm light leaks where the edit plan puts them (older specs: alternate at scene changes)
  let f = 0, lk = 0, lx = 0;
  const leak = (x) => { const d = t - x; if (d > -0.3 && d < 0.6) { const q = (d + 0.3) / 0.9; lk = Math.max(lk, Math.sin(Math.PI * q) * 0.8); lx = -25 + 150 * q; } };
  const flash = (x) => { const d = t - x; if (d > -0.05 && d < 0.22) f = Math.max(f, d < 0 ? (d + 0.05) / 0.05 * 0.55 : 0.55 * (1 - d / 0.22)); };
  if (S.leaks) { (S.flashes || []).forEach(flash); S.leaks.forEach(leak); }
  else (S.flashes || []).forEach((x, i) => (i % 2 === 0 ? flash : leak)(x));
  // cinematic bars: 2.39:1 for the cold open, eased in over 0.8 s, opened over 0.9 s as the story starts
  if (S.bars) {
    const full = Math.max(0, (S.H - S.W / 2.39) / 2), b = S.bars;
    const k = t < b.at ? 0 : t < b.at + 0.8 ? outCubic((t - b.at) / 0.8) : t < b.until - 0.9 ? 1 : t < b.until ? 1 - inOutCubic((t - (b.until - 0.9)) / 0.9) : 0;
    const h = Math.round(full * k); document.getElementById("barTop").style.height = h + "px"; document.getElementById("barBot").style.height = h + "px"; st += `b${h}`;
  }
  const fl = document.getElementById("flash"); fl.style.opacity = r2(f); st += `f${r2(f)}`;
  const le = document.getElementById("leak"); le.style.opacity = r2(lk); le.style.setProperty("--lx", r2(lx) + "%"); st += `l${r2(lk)}|${r2(lx)}`;
  return st;
};
window.ready = true;
