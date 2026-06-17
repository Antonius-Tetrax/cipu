"use strict";
const TONES = ["平", "上", "去", "入"];
const COLOR = { "平": "var(--ping)", "上": "var(--shang)", "去": "var(--qu)", "入": "var(--ru)" };
const FLAGMAP = { d: "duoyin", m: "merge", s: "supplement", n: "not_found" };
const REGION_ORDER = ["中原", "北方", "江浙", "江淮", "宣徽", "两湖",
  "江西", "福建", "巴蜀", "岭南", "不详"];
const CAP = 10;
const $ = (s, r = document) => r.querySelector(s);

let INDEX = null, CUR = null, CUR_TI = 0, SEL_POS = null, SEL_TONE = null;
let AUTHORS = [], A_BY_NAME = {}, SELECTED = new Set(), VIEW = "pai", AUTHOR_SORT = "count";
const COUNT_BANDS = [[500, Infinity, "500 首以上"], [200, 499, "200–499 首"],
  [100, 199, "100–199 首"], [50, 99, "50–99 首"], [20, 49, "20–49 首"],
  [10, 19, "10–19 首"], [5, 9, "5–9 首"], [1, 4, "1–4 首"]];
const bandOf = n => (COUNT_BANDS.find(([lo, hi]) => n >= lo && n <= hi) || COUNT_BANDS.at(-1))[2];

async function boot() {
  [INDEX, AUTHORS] = await Promise.all([
    fetch("data/index.json").then(r => r.json()),
    fetch("data/authors.json").then(r => r.json()),
  ]);
  AUTHORS.forEach(a => { A_BY_NAME[a.name] = a; });
  SELECTED = new Set(AUTHORS.map(a => a.name));
  loadSelection();
  renderList("");
  $("#search").addEventListener("input", e => renderList(e.target.value.trim()));
  document.querySelectorAll(".navbtn").forEach(b => b.onclick = () => setView(b.dataset.v));
  document.querySelectorAll(".sortbtn").forEach(b => b.onclick = () => {
    AUTHOR_SORT = b.dataset.s;
    document.querySelectorAll(".sortbtn").forEach(x => x.classList.toggle("active", x === b));
    renderAuthors();
  });
  $("#selall").onclick = () => { AUTHORS.forEach(a => SELECTED.add(a.name)); afterSelChange(); };
  $("#selnone").onclick = () => { SELECTED.clear(); afterSelChange(); };
}

function setView(v) {
  VIEW = v;
  document.querySelectorAll(".navbtn").forEach(b => b.classList.toggle("active", b.dataset.v === v));
  $("#sidebar").style.display = v === "pai" ? "" : "none";
  $("#content").style.display = v === "pai" ? "" : "none";
  $("#authorview").style.display = v === "author" ? "flex" : "none";
  if (v === "author") renderAuthors();
  else { renderList($("#search").value.trim()); if (CUR) render(); }
}

/* ---------------- 词牌 list ---------------- */
function paiCount(p) {
  if (SELECTED.size === AUTHORS.length || !p.au) return p.n;
  let s = 0;
  for (const a in p.au) if (SELECTED.has(a)) s += p.au[a];
  return s;
}

function renderList(filter) {
  const list = $("#pailist");
  list.innerHTML = "";
  let lastInit = null;
  INDEX.pai.filter(p => !filter || p.pai.includes(filter))
    .sort((a, b) => (a.py || a.pai).localeCompare(b.py || b.pai))
    .forEach(p => {
      if (p.init !== lastInit) {
        lastInit = p.init;
        const h = document.createElement("div");
        h.className = "group-h"; h.textContent = p.init; list.appendChild(h);
      }
      const d = document.createElement("div");
      d.className = "pai-item" + (CUR && CUR.pai === p.pai ? " active" : "");
      d.innerHTML = `<span>${p.pai}</span><span class="meta">${paiCount(p)}
        ${p.has_qinpu ? '<span class="qp-badge">谱</span>' : ""}</span>`;
      d.onclick = () => loadPai(p.pai);
      list.appendChild(d);
    });
}

async function loadPai(pai) {
  CUR = await (await fetch("data/" + encodeURIComponent(pai) + ".json")).json();
  CUR_TI = 0; SEL_POS = null; SEL_TONE = null;
  renderList($("#search").value.trim());
  render();
}

/* ---------------- client-side aggregation over selected authors ---------------- */
function aggregate(ti) {
  const np = ti.zishu, q = ti.qinpu;
  const mk = () => ({ "平": 0, "上": 0, "去": 0, "入": 0 });
  const frac = [], fracN = new Array(np).fill(0), unamb = [], toneN = [],
    flags = [], conflict = new Array(np).fill(0), exUn = [], exAm = [];
  for (let i = 0; i < np; i++) {
    frac.push(mk()); unamb.push(mk()); toneN.push(mk()); flags.push({});
    exUn.push({ "平": [], "上": [], "去": [], "入": [] });
    exAm.push({ "平": [], "上": [], "去": [], "入": [] });
  }
  let nInst = 0, matched = 0;
  for (const ins of ti.instances) {
    if (!SELECTED.has(ins.a)) continue;
    nInst++;
    if (ins.M) matched++;
    if (ins.x) ins.x.forEach(p => conflict[p]++);
    const chars = [...ins.L], fsp = ins.f || {};
    for (let pos = 0; pos < np; pos++) {
      const code = fsp[pos];
      if (code) for (const c of code) { const k = FLAGMAP[c]; if (k) flags[pos][k] = (flags[pos][k] || 0) + 1; }
      const ts = ins.t[pos];
      if (!ts) continue;
      const tones = [...ts];
      fracN[pos]++;
      const w = 1 / tones.length, single = tones.length === 1;
      if (single) unamb[pos][tones[0]]++;
      for (const t of tones) {
        frac[pos][t] += w; toneN[pos][t]++;
        const bk = single ? exUn[pos][t] : exAm[pos][t];
        if (bk.length < CAP) bk.push({ author: ins.a, char: chars[pos], line: ins.L, amb: !single, tones });
      }
    }
  }
  const pct = (o, n) => { const r = {}; for (const t of TONES) r[t] = n ? Math.round(1000 * o[t] / n) / 10 : 0; return r; };
  const positions = [], examples = [];
  for (let pos = 0; pos < np; pos++) {
    const fn = fracN[pos], un = TONES.reduce((s, t) => s + unamb[pos][t], 0);
    positions.push({
      pos, n: fn, n_unamb: un, low_n: fn < 10, frac: pct(frac[pos], fn), unamb: pct(unamb[pos], un),
      flags: flags[pos], conflict: conflict[pos],
      qinpu: q ? q.codes[pos] : null, qinpu_rhyme: q ? q.rhyme[pos] : null, qinpu_base: q ? q.base[pos] : null,
    });
    const d = {};
    for (const t of TONES) if (toneN[pos][t]) d[t] = { n: toneN[pos][t], ex: exUn[pos][t].concat(exAm[pos][t]).slice(0, CAP) };
    examples.push(d);
  }
  return { positions, examples, nInst, matched };
}

/* ---------------- 词牌 detail view ---------------- */
function render() {
  const c = $("#content");
  const selN = SELECTED.size, allN = AUTHORS.length;
  const selTxt = selN === allN ? "全部作者" : `已选 ${selN}/${allN} 位作者`;
  // filtered instance count per 体
  const tiN = CUR.ti.map(t => { let n = 0; for (const ins of t.instances) if (SELECTED.has(ins.a)) n++; return n; });
  if (tiN.every(n => n === 0)) {
    c.innerHTML = `<div class="titlebar"><h2>${CUR.pai}</h2>
      <span class="meta" style="color:var(--muted);font-family:system-ui">共 ${CUR.n_total} 首 · <b style="color:var(--ink)">${selTxt}</b></span></div>
      <div class="empty">当前作者筛选下，此词牌无作品</div>`;
    return;
  }
  if (tiN[CUR_TI] === 0) { CUR_TI = tiN.findIndex(n => n > 0); SEL_POS = null; SEL_TONE = null; }
  const ti = CUR.ti[CUR_TI];
  const AGG = aggregate(ti);
  CUR._agg = AGG;
  const tabs = CUR.ti.map((t, i) => tiN[i] > 0
    ? `<div class="ti-tab ${i === CUR_TI ? "active" : ""}" data-i="${i}">体${i + 1} · ${t.zishu}字 · n=${tiN[i]}${t.has_qinpu ? " · 谱" : ""}</div>` : "").join("");
  c.innerHTML = `
    <div class="titlebar"><h2>${CUR.pai}</h2>
      <span class="meta" style="color:var(--muted);font-family:system-ui">共 ${CUR.n_total} 首 · ${CUR.ti.length} 体（n≥${INDEX.min_ti}） · <b style="color:var(--ink)">${selTxt}</b>：此体 n=${AGG.nInst}</span></div>
    <div class="ti-tabs">${tabs}</div>
    <div class="legend">
      ${TONES.map(t => `<span><span class="sw" style="background:${COLOR[t]}"></span>${t}</span>`).join("")}
      <span>钦定词谱: <span class="qp-tag qp-平">平</span> / <span class="qp-tag qp-仄">仄</span> / <span class="qp-tag qp-中">[平]</span><span class="qp-tag qp-中">[仄]</span>=中(本平/本仄)</span>
      <span><span class="sw" style="background:repeating-linear-gradient(45deg,#ccc 0 3px,#eee 3px 6px)"></span>低样本 n&lt;10</span>
    </div>
    <div id="grid"></div>
    <div id="detail"></div>`;
  c.querySelectorAll(".ti-tab").forEach(el =>
    el.onclick = () => { CUR_TI = +el.dataset.i; SEL_POS = null; SEL_TONE = null; render(); });
  renderGrid(ti.signature, AGG.positions);
  if (SEL_POS != null) renderDetail(AGG.examples, AGG.positions, SEL_POS, true);
}

function renderGrid(signature, positions) {
  const g = $("#grid");
  g.innerHTML = "";
  let pos = 0, ju = 0;
  for (const len of signature) {
    const row = document.createElement("div");
    row.className = "ju";
    row.innerHTML = `<div class="ju-label">句${++ju}<br>(${len})</div>`;
    for (let k = 0; k < len; k++) row.appendChild(cell(positions[pos++]));
    g.appendChild(row);
  }
}

function cell(p) {
  const el = document.createElement("div");
  el.className = "cell" + (p.low_n ? " lown" : "") + (SEL_POS === p.pos ? " sel" : "");
  el.dataset.pos = p.pos;
  const ze = p.frac["上"] + p.frac["去"] + p.frac["入"];
  const border = p.frac["平"] >= 75 ? "var(--ping)" : ze >= 75 ? "var(--qu)" : "var(--muted)";
  const bars = TONES.map(t => p.frac[t] > 0 ? `<i style="width:${p.frac[t]}%;background:${COLOR[t]}"></i>` : "").join("");
  const q = p.qinpu || "·";
  const qtext = q === "中" && p.qinpu_base ? `[${p.qinpu_base}]` : q;
  el.innerHTML =
    `<div class="qp qp-tag qp-${q} ${p.qinpu_rhyme ? "rhyme" : ""}">${qtext}</div>
     <div class="bar">${bars}</div>
     <div class="pos">${p.pos}</div>` +
    (p.n && p.conflict / p.n >= 0.03 ? `<div class="cf" title="ORCHESTRA 校异 ${p.conflict}/${p.n}">${p.conflict}</div>` : "");
  el.style.borderColor = border;
  el.onmouseenter = e => showTip(e, p);
  el.onmousemove = moveTip;
  el.onmouseleave = hideTip;
  el.onclick = () => { SEL_POS = p.pos; SEL_TONE = null; render(); };
  return el;
}

function showTip(e, p) {
  const t = $("#tip"), f = p.frac, u = p.unamb;
  const flags = Object.entries(p.flags || {}).map(([k, v]) => `${k}:${v}`).join(", ") || "—";
  const qbase = p.qinpu === "中" && p.qinpu_base ? `（本${p.qinpu_base}）` : "";
  t.innerHTML =
    `<div><b>位置 ${p.pos}</b> · 钦定词谱：<b>${p.qinpu || "?"}</b>${qbase}${p.qinpu_rhyme ? " 韵" : ""}</div>
     <div style="margin:5px 0 2px">分数法 (n=${p.n}):</div>
     ${TONES.map(x => `<div class="trow"><span><span class="sw" style="background:${COLOR[x]}"></span>${x}</span><b>${f[x]}%</b></div>`).join("")}
     <div style="margin:6px 0 2px;color:#bbb">无歧义法 (n=${p.n_unamb}): ${TONES.map(x => `${x}${u[x]}`).join(" ")}</div>
     <div style="color:#bbb">多音污染: ${flags}</div>
     <div style="color:#bbb">ORCHESTRA 校异: ${p.conflict}</div>`;
  t.style.display = "block"; moveTip(e);
}
function moveTip(e) {
  const t = $("#tip");
  let x = e.clientX + 14, y = e.clientY + 14;
  if (x + 290 > innerWidth) x = e.clientX - 290;
  if (y + t.offsetHeight > innerHeight) y = e.clientY - t.offsetHeight - 8;
  t.style.left = x + "px"; t.style.top = y + "px";
}
function hideTip() { $("#tip").style.display = "none"; }

function renderDetail(examples, positions, pos, scroll) {
  const p = positions[pos], data = examples[pos] || {}, d = $("#detail");
  const present = TONES.filter(t => data[t]);
  const dom = TONES.reduce((a, t) => p.frac[t] > p.frac[a] ? t : a, "平");
  const qd = p.qinpu === "中" && p.qinpu_base ? `中·本${p.qinpu_base}` : (p.qinpu || "?");
  if (!present.length) { d.innerHTML = `<h3>位置 ${pos} — 钦定词谱「${qd}」</h3><div class="empty">无实例</div>`; return; }
  if (!present.includes(SEL_TONE)) SEL_TONE = present.reduce((a, t) => p.frac[t] > p.frac[a] ? t : a, present[0]);
  const tabs = present.map(t =>
    `<div class="tone-tab ${t === SEL_TONE ? "active" : ""}" data-tone="${t}" style="--tc:${COLOR[t]}">${t} <span class="tn">n=${data[t].n}</span></div>`).join("");
  const ex = data[SEL_TONE].ex;
  d.innerHTML =
    `<h3>位置 ${pos} — 钦定词谱「${qd}」 · 语料 ${dom} ${p.frac[dom]}%（n=${p.n}）</h3>
     <div class="note">点击声调标签切换。高亮字＝该位置；多音字标 ※（可能出现在多个声调下，已排在该声调的无歧义例之后）。语料未校勘，仅供参考、不作定本。</div>
     <div class="tone-tabs">${tabs}</div>
     <div class="lines">${ex.map(e => lineHTML(e, pos)).join("")}</div>`;
  d.querySelectorAll(".tone-tab").forEach(el =>
    el.onclick = () => { SEL_TONE = el.dataset.tone; renderDetail(examples, positions, pos, false); });
  if (scroll) d.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function lineHTML(e, pos) {
  const chars = [...e.line];
  const body = chars.map((ch, i) => i === pos ? `<span class="hl">${ch}</span>` : ch).join("");
  const tag = e.amb ? `<span class="tn amb" title="多音字">※${(e.tones || []).join("/")}</span>` : "";
  return `<div class="lineitem"><span class="au">${e.author || "?"}</span>${body}${tag}</div>`;
}

/* ---------------- author view ---------------- */
function groupsFor(sort) {
  let list = AUTHORS.slice(), keyFn, order;
  if (sort === "count") {
    list.sort((a, b) => b.n_poems - a.n_poems || a.name.localeCompare(b.name));
    keyFn = a => bandOf(a.n_poems);
  } else if (sort === "py") {
    list.sort((a, b) => (a.surname_py || "").localeCompare(b.surname_py || "") || a.name.localeCompare(b.name));
    keyFn = a => a.surname_init || "#";
  } else if (sort === "year") {
    list.sort((a, b) => (a.birth_year == null) - (b.birth_year == null) ||
      (a.birth_year || 0) - (b.birth_year || 0) || a.name.localeCompare(b.name));
    keyFn = a => a.birth_year == null ? "不详" : (a.emperor || "不详");
  } else {
    const ri = r => { const i = REGION_ORDER.indexOf(r); return i < 0 ? 99 : i; };
    list.sort((a, b) => ri(a.region) - ri(b.region) ||
      (a.surname_py || "").localeCompare(b.surname_py || "") || a.name.localeCompare(b.name));
    keyFn = a => a.region || "不详";
  }
  const groups = [];
  let cur = null;
  for (const a of list) {
    const k = keyFn(a);
    if (!cur || cur.label !== k) { cur = { label: k, members: [] }; groups.push(cur); }
    cur.members.push(a);
  }
  return groups;
}

function renderAuthors() {
  const wrap = $("#authlist");
  wrap.innerHTML = "";
  for (const g of groupsFor(AUTHOR_SORT)) {
    const h = document.createElement("div");
    h.className = "auth-grp";
    h.innerHTML = `<span>${g.label}</span><span class="gn">${g.members.length} 人</span>
      <span class="gsel" data-grp="1">全选/全不选</span>`;
    h.querySelector(".gsel").onclick = () => {
      const names = g.members.map(a => a.name);
      const allOn = names.every(n => SELECTED.has(n));
      names.forEach(n => allOn ? SELECTED.delete(n) : SELECTED.add(n));
      afterSelChange();
    };
    wrap.appendChild(h);
    for (const a of g.members) wrap.appendChild(authorRow(a));
  }
  updateCount();
}

function authorRow(a) {
  const row = document.createElement("div");
  const on = SELECTED.has(a.name);
  row.className = "auth-row" + (on ? "" : " off");
  const by = a.birth_display, dy = a.death_display;
  const life = (by === "不详" && dy === "不详") ? "生卒不详" : `${by} – ${dy}`;
  const place = a.native_place ? (a.native_place.modern || a.native_place.song || "") : "";
  row.innerHTML =
    `<label><input type="checkbox" ${on ? "checked" : ""}>
       <span class="nm">${a.name}</span>
       <span class="wc">${a.n_poems} 首</span>
       <span class="bio">${life}${place ? " · " + place : ""}</span>
       <span class="rg">${a.region || ""}${a.region_uncertain ? "?" : ""}</span></label>`;
  row.querySelector("input").onchange = e => {
    e.target.checked ? SELECTED.add(a.name) : SELECTED.delete(a.name);
    row.classList.toggle("off", !e.target.checked);
    updateCount(); saveSelection();
  };
  return row;
}

function afterSelChange() { renderAuthors(); saveSelection(); }
function updateCount() {
  let poems = 0;
  SELECTED.forEach(n => { const a = A_BY_NAME[n]; if (a) poems += a.n_poems; });
  $("#selcount").textContent = `已选 ${SELECTED.size} 人 · ${poems} 首`;
}
function saveSelection() {
  try {
    const unsel = AUTHORS.filter(a => !SELECTED.has(a.name)).map(a => a.name);
    localStorage.setItem("cipu_unsel", JSON.stringify(unsel));
  } catch (e) { }
}
function loadSelection() {
  try {
    const u = JSON.parse(localStorage.getItem("cipu_unsel") || "[]");
    u.forEach(n => SELECTED.delete(n));
  } catch (e) { }
}

boot();
