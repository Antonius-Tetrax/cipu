"use strict";
const V = "20260619h";                // bump on each publish to bust browser cache (app + data)
const TONES = ["平", "上", "去", "入"];
const COLOR = { "平": "var(--ping)", "上": "var(--shang)", "去": "var(--qu)", "入": "var(--ru)" };
const FLAGMAP = { d: "duoyin", m: "merge", s: "supplement", n: "not_found" };
const REGION_ORDER = ["中原", "北方", "江浙", "江淮", "宣徽", "两湖",
  "江西", "福建", "巴蜀", "岭南", "不详"];
const CAP = 10;
const $ = (s, r = document) => r.querySelector(s);
const CN_DIGIT = "〇一二三四五六七八九";
function cn(n) {                                  // 1..39 -> ≤2-char 中文数字 (廿/卅 keep 句label ≤3)
  if (n < 10) return CN_DIGIT[n];
  if (n === 20) return "二十";
  if (n < 20) return "十" + (n % 10 ? CN_DIGIT[n % 10] : "");
  if (n < 30) return "廿" + (n % 10 ? CN_DIGIT[n % 10] : "");
  if (n < 40) return "卅" + (n % 10 ? CN_DIGIT[n % 10] : "");
  const t = Math.floor(n / 10), o = n % 10;      // 40+ (not expected; max tune = 28 句)
  return CN_DIGIT[t] + "十" + (o ? CN_DIGIT[o] : "");
}

let INDEX = null, CUR = null, CUR_TI = 0, SEL_POS = null, SEL_TONE = null;
let AUTHORS = [], A_BY_NAME = {}, SELECTED = new Set(), VIEW = "pai", AUTHOR_SORT = "count";
let TONE_MODE = "smart", PRIMARY = {};        // smart=智能判定 (default) | pure=仅单音字
let SEL_PRESET = null;                          // active 作者 quick-select: all|none|key|genre|null
const MODE_NAME = { smart: "智能判定", pure: "仅单音字" };
const MODE_HINT = {
  smart: "resolve toward the position's empirical dominant tone",
  pure: "count single-reading characters only",
};
// curated author pools for the 作者-view quick-select buttons (corpus spellings)
const KEY_POETS = ["辛弃疾", "苏轼", "刘辰翁", "吴文英", "张炎", "贺铸", "刘克庄", "晏几道", "朱敦儒",
  "欧阳修", "张孝祥", "柳永", "黄庭坚", "周邦彦", "张元干", "晁补之", "张先", "周密", "陆游", "晏殊",
  "史达祖", "叶梦得", "蒋捷", "秦观", "姜夔", "刘过", "陈亮", "王沂孙", "温庭筠", "李清照", "韦庄",
  "李煜", "牛峤", "范仲淹", "李璟"];
const GENRE_POETS = ["吴文英", "张炎", "陈允平", "周邦彦", "周密", "仇远", "史达祖", "高观国", "卢祖皋",
  "方千里", "杨泽民", "姜夔", "王沂孙", "张鎡", "张辑", "李彭老", "李莱老", "张枢", "张矩", "施岳",
  "吕同老", "唐珏", "陈恕可", "杨缵"];
const COUNT_BANDS = [[500, Infinity, "500 首以上"], [200, 499, "200–499 首"],
  [100, 199, "100–199 首"], [50, 99, "50–99 首"], [20, 49, "20–49 首"],
  [10, 19, "10–19 首"], [5, 9, "5–9 首"], [1, 4, "1–4 首"]];
const bandOf = n => (COUNT_BANDS.find(([lo, hi]) => n >= lo && n <= hi) || COUNT_BANDS.at(-1))[2];

async function boot() {
  [INDEX, AUTHORS, PRIMARY] = await Promise.all([
    fetch("data/index.json?v=" + V).then(r => r.json()),
    fetch("data/authors.json?v=" + V).then(r => r.json()),
    fetch("data/primary.json?v=" + V).then(r => r.json()).catch(() => ({})),
  ]);
  AUTHORS.forEach(a => { A_BY_NAME[a.name] = a; });
  SELECTED = new Set(AUTHORS.map(a => a.name));
  loadSelection();
  SEL_PRESET = detectPreset(); updatePresetButtons();
  renderList("");
  $("#search").addEventListener("input", e => renderList(e.target.value.trim()));
  document.querySelectorAll(".navbtn").forEach(b => b.onclick = () => setView(b.dataset.v));
  document.querySelectorAll(".sortbtn").forEach(b => b.onclick = () => {
    AUTHOR_SORT = b.dataset.s;
    document.querySelectorAll(".sortbtn").forEach(x => x.classList.toggle("active", x === b));
    renderAuthors();
  });
  $("#selall").onclick = () => { AUTHORS.forEach(a => SELECTED.add(a.name)); setPreset("all"); afterSelChange(); };
  $("#selnone").onclick = () => { SELECTED.clear(); setPreset("none"); afterSelChange(); };
  $("#selkey").onclick = () => { SELECTED = new Set(KEY_POETS.filter(n => A_BY_NAME[n])); setPreset("key"); afterSelChange(); };
  $("#selgenre").onclick = () => { SELECTED = new Set(GENRE_POETS.filter(n => A_BY_NAME[n])); setPreset("genre"); afterSelChange(); };
  // mobile 词牌-list drawer
  document.body.classList.add("view-pai");
  $("#menuBtn").onclick = () => document.body.classList.toggle("drawer-open");
  $("#menuBackdrop").onclick = () => document.body.classList.remove("drawer-open");
}

function setView(v) {
  VIEW = v;
  document.body.classList.toggle("view-pai", v === "pai");
  document.body.classList.remove("drawer-open");
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
      const target = p.alias_of || p.pai;
      const d = document.createElement("div");
      d.className = "pai-item" + (CUR && CUR.pai === target ? " active" : "");
      d.innerHTML = `<span>${p.pai}</span><span class="meta">${paiCount(p)}
        ${p.has_qinpu ? '<span class="qp-badge">谱</span>' : ""}</span>`;
      d.onclick = () => loadPai(target);
      list.appendChild(d);
    });
}

async function loadPai(pai) {
  CUR = await (await fetch("data/" + encodeURIComponent(pai) + ".json?v=" + V)).json();
  CUR_TI = 0; SEL_POS = null; SEL_TONE = null;
  document.body.classList.remove("drawer-open");   // close the mobile drawer after picking
  renderList($("#search").value.trim());
  render();
}

/* ---------------- client-side aggregation over selected authors ---------------- */
// empirical prevailing coding of a position from its 仅单音字 distribution (same ≥75% rule)
function prevailingOf(u) {
  const n = TONES.reduce((s, t) => s + u[t], 0);
  if (!n) return null;
  if (100 * u["平"] / n >= 75) return "平";
  if (100 * (u["上"] + u["去"] + u["入"]) / n >= 75) return "仄";
  return "中";
}
// 智能判定: resolve a multi-reading char to ONE tone. `tones` = its 平水韵-sanctioned readings;
// `order` = its most-common→least ranking. Resolve toward the position's empirical prevailing
// coding when a sanctioned reading allows it; else keep the char's most-common reading (anomaly).
function resolveSmart(tones, prevailing, order) {
  const rank = (order && order.length ? order.filter(t => tones.includes(t)) : []);
  const ord = rank.length ? rank.concat(tones.filter(t => !rank.includes(t))) : tones;
  let permitted;
  if (prevailing === "平") permitted = tones.filter(t => t === "平");
  else if (prevailing === "仄") permitted = tones.filter(t => t !== "平");
  else permitted = tones;                              // 中 / no 仅单音字 basis → unconstrained
  if (permitted.length) return ord.find(t => permitted.includes(t)) || permitted[0];
  return ord[0];                                       // anomaly: char can't be prevailing tone
}

function aggregate(ti) {
  const np = ti.zishu, q = ti.qinpu, smart = TONE_MODE === "smart";
  const mk = () => ({ "平": 0, "上": 0, "去": 0, "入": 0 });
  const mkex = () => ({ "平": [], "上": [], "去": [], "入": [] });
  const unamb = [], flags = [], exUn = [];
  for (let i = 0; i < np; i++) { unamb.push(mk()); flags.push({}); exUn.push(mkex()); }
  const sel = [];
  // pass 1 — 仅单音字 counts + flags + unambiguous examples (also the prevailing-coding basis)
  for (const ins of ti.instances) {
    if (!SELECTED.has(ins.a)) continue;
    sel.push(ins);
    const chars = [...ins.L], fsp = ins.f || {};
    for (let pos = 0; pos < np; pos++) {
      const code = fsp[pos];
      if (code) for (const c of code) { const k = FLAGMAP[c]; if (k) flags[pos][k] = (flags[pos][k] || 0) + 1; }
      const ts = ins.t[pos];
      if (!ts) continue;
      const tones = [...ts];
      if (tones.length === 1) {
        unamb[pos][tones[0]]++;
        const bk = exUn[pos][tones[0]];
        if (bk.length < CAP) bk.push({ author: ins.a, char: chars[pos], line: ins.L, amb: false });
      }
    }
  }
  const prevailing = unamb.map(prevailingOf);
  // active-mode counts + examples
  const cnt = [], exMode = [], inferred = new Array(np).fill(0);
  for (let i = 0; i < np; i++) { cnt.push(Object.assign(mk(), unamb[i])); exMode.push(mkex()); }
  if (smart) {                                          // pass 2 — resolve multi-reading chars
    const exAm = []; for (let i = 0; i < np; i++) exAm.push(mkex());
    for (const ins of sel) {
      const chars = [...ins.L];
      for (let pos = 0; pos < np; pos++) {
        const ts = ins.t[pos];
        if (!ts) continue;
        const tones = [...ts];
        if (tones.length === 1) continue;
        const r = resolveSmart(tones, prevailing[pos], PRIMARY[chars[pos]]);
        cnt[pos][r]++; inferred[pos]++;
        const bk = exAm[pos][r];
        if (bk.length < CAP) bk.push({ author: ins.a, char: chars[pos], line: ins.L, amb: true, tones, resolved: r });
      }
    }
    for (let pos = 0; pos < np; pos++)
      for (const t of TONES) {        // reserve slots so resolved 多音字 examples stay visible
        const amb = exAm[pos][t], reserve = Math.min(amb.length, 4);
        exMode[pos][t] = exUn[pos][t].slice(0, CAP - reserve).concat(amb).slice(0, CAP);
      }
  } else {
    for (let pos = 0; pos < np; pos++) exMode[pos] = exUn[pos];
  }
  const pct = (o, n) => { const r = {}; for (const t of TONES) r[t] = n ? Math.round(1000 * o[t] / n) / 10 : 0; return r; };
  const positions = [], examples = [];
  for (let pos = 0; pos < np; pos++) {
    const n = TONES.reduce((s, t) => s + cnt[pos][t], 0);
    const un = TONES.reduce((s, t) => s + unamb[pos][t], 0);
    positions.push({
      pos, n, n_unamb: un, inferred: inferred[pos], low_n: n < 10,
      dist: pct(cnt[pos], n), prevailing: prevailing[pos], flags: flags[pos],
      qinpu: q ? q.codes[pos] : null, qinpu_rhyme: q ? q.rhyme[pos] : null, qinpu_base: q ? q.base[pos] : null,
    });
    const d = {};
    for (const t of TONES) if (cnt[pos][t]) d[t] = { n: cnt[pos][t], ex: exMode[pos][t] };
    examples.push(d);
  }
  return { positions, examples, nInst: sel.length };
}

/* ---------------- 词牌 detail view ---------------- */
function render() {
  const c = $("#content");
  const selN = SELECTED.size, allN = AUTHORS.length;
  const selTxt = selN === allN ? "全部作者" : `已选 ${selN}/${allN} 位作者`;
  // alias names shown in the left column that resolve to this 词牌 -> 又名 annotation
  const aka = INDEX.pai.filter(p => p.alias_of === CUR.pai).map(p => p.pai);
  const title = `${CUR.pai}${aka.length ? `<span class="aka">又名${aka.join("、")}</span>` : ""}`;
  // filtered instance count per 体
  const tiN = CUR.ti.map(t => { let n = 0; for (const ins of t.instances) if (SELECTED.has(ins.a)) n++; return n; });
  if (tiN.every(n => n === 0)) {
    c.innerHTML = `<div class="titlebar"><h2>${title}</h2>
      <span class="meta" style="color:var(--muted);font-family:system-ui">共 ${CUR.n_total} 首 · <b style="color:var(--ink)">${selTxt}</b></span></div>
      <div class="empty">当前作者筛选下，此词牌无作品</div>`;
    return;
  }
  if (tiN[CUR_TI] === 0) { CUR_TI = tiN.findIndex(n => n > 0); SEL_POS = null; SEL_TONE = null; }
  const ti = CUR.ti[CUR_TI];
  const AGG = aggregate(ti);
  CUR._agg = AGG;
  // poems (in selection) that fall in sub-threshold 零散变体 not shown in any 体
  const idx = INDEX.pai.find(p => !p.alias_of && p.pai === CUR.pai);
  const shownSum = tiN.reduce((a, b) => a + b, 0);
  const variants = Math.max(0, (idx ? paiCount(idx) : CUR.n_total) - shownSum);
  const variantNote = variants > 0 ? `（另 ${variants} 首零散变体略）` : "";
  const tabs = CUR.ti.map((t, i) => tiN[i] > 0
    ? `<div class="ti-tab ${i === CUR_TI ? "active" : ""}" data-i="${i}">体${i + 1} · ${t.zishu}字 · 显示 ${tiN[i]} 首${t.has_qinpu ? " · 谱" : ""}</div>` : "").join("");
  c.innerHTML = `
    <div class="titlebar"><h2>${title}</h2>
      <span class="meta" style="color:var(--muted);font-family:system-ui">共 ${CUR.n_total} 首 · ${CUR.ti.length} 体（n≥${INDEX.min_ti}） · <b style="color:var(--ink)">${selTxt}</b>：此体显示 ${AGG.nInst} 首${variantNote}</span></div>
    <div class="mode-toggle">声调统计：${["smart", "pure"].map(m =>
      `<button class="mode-btn ${TONE_MODE === m ? "active" : ""}" data-mode="${m}" title="${MODE_HINT[m]}">${MODE_NAME[m]}</button>`).join("")}</div>
    <div class="ti-tabs">${tabs}</div>
    <div class="legend">
      ${TONES.map(t => `<span><span class="sw" style="background:${COLOR[t]}"></span>${t}</span>`).join("")}
      <span>字＝语料判定: <span class="qp-tag qp-平">平</span>/<span class="qp-tag qp-仄">仄</span> (≥75% 主导) · <span class="qp-tag qp-中">中</span> (无主导)</span>
      <span>边框＝钦定词谱: <span class="ol ol-平">平</span><span class="ol ol-仄">仄</span><span class="ol ol-中">中</span></span>
      <span><span class="sw" style="background:repeating-linear-gradient(45deg,#ccc 0 3px,#eee 3px 6px)"></span>低样本 n&lt;10</span>
    </div>
    <div id="grid"></div>
    <div id="detail"></div>`;
  c.querySelectorAll(".mode-btn").forEach(el =>
    el.onclick = () => { if (TONE_MODE === el.dataset.mode) return; TONE_MODE = el.dataset.mode; render(); });
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
    row.innerHTML = `<div class="ju-label">句${cn(++ju)}<br>(${len})</div>`;
    for (let k = 0; k < len; k++) row.appendChild(cell(positions[pos++]));
    g.appendChild(row);
  }
}

function cell(p) {
  const el = document.createElement("div");
  el.className = "cell" + (p.low_n ? " lown" : "") + (SEL_POS === p.pos ? " sel" : "");
  el.dataset.pos = p.pos;
  const ze = p.dist["上"] + p.dist["去"] + p.dist["入"];
  const emp = p.dist["平"] >= 75 ? "平" : ze >= 75 ? "仄" : "中";    // empirical label (char)
  const qBorder = p.qinpu === "平" ? "var(--ping)"                   // outline = 钦定词谱 code
    : p.qinpu === "仄" ? "var(--qu)" : "var(--muted)";               // 中 / none -> grey
  const bars = TONES.map(t => p.dist[t] > 0 ? `<i style="width:${p.dist[t]}%;background:${COLOR[t]}"></i>` : "").join("");
  el.innerHTML =
    `<div class="qp qp-tag qp-${emp} ${p.qinpu_rhyme ? "rhyme" : ""}">${emp}</div>
     <div class="bar">${bars}</div>
     <div class="pos">${p.pos + 1}</div>`;
  el.style.borderColor = qBorder;
  el.onmouseenter = e => showTip(e, p);
  el.onmousemove = moveTip;
  el.onmouseleave = hideTip;
  el.onclick = () => { SEL_POS = p.pos; SEL_TONE = null; render(); };
  return el;
}

function showTip(e, p) {
  const t = $("#tip"), f = p.dist;
  const flags = Object.entries(p.flags || {}).map(([k, v]) => `${k}:${v}`).join(", ") || "—";
  const qbase = p.qinpu === "中" && p.qinpu_base ? `（本${p.qinpu_base}）` : "";
  const inferTxt = TONE_MODE === "smart"
    ? `<div style="color:#bbb">本位主导：${p.prevailing || "—"} · 推定多音字 ${p.inferred} 字（仅单音字 n=${p.n_unamb}）</div>`
    : `<div style="color:#bbb">多音字一律不计</div>`;
  t.innerHTML =
    `<div><b>位置 ${p.pos + 1}</b> · 钦定词谱：<b>${p.qinpu || "?"}</b>${qbase}${p.qinpu_rhyme ? " 韵" : ""}</div>
     <div style="margin:5px 0 2px">${MODE_NAME[TONE_MODE]} (n=${p.n}):</div>
     ${TONES.map(x => `<div class="trow"><span><span class="sw" style="background:${COLOR[x]}"></span>${x}</span><b>${f[x]}%</b></div>`).join("")}
     ${inferTxt}
     <div style="color:#bbb">多音字: ${flags}</div>`;
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
  const dom = TONES.reduce((a, t) => p.dist[t] > p.dist[a] ? t : a, "平");
  const qd = p.qinpu === "中" && p.qinpu_base ? `中·本${p.qinpu_base}` : (p.qinpu || "?");
  if (!present.length) { d.innerHTML = `<h3>位置 ${pos + 1} — 钦定词谱「${qd}」</h3><div class="empty">此模式下无实例</div>`; return; }
  if (!present.includes(SEL_TONE)) SEL_TONE = present.reduce((a, t) => p.dist[t] > p.dist[a] ? t : a, present[0]);
  const tabs = present.map(t =>
    `<div class="tone-tab ${t === SEL_TONE ? "active" : ""}" data-tone="${t}" style="--tc:${COLOR[t]}">${t} <span class="tn">n=${data[t].n}</span></div>`).join("");
  const ex = data[SEL_TONE].ex;
  const note = TONE_MODE === "smart"
    ? "高亮字＝该位置；多音字标 ※，列出平水韵候选与本位判定（→），排在无歧义例之后。语料未校勘，仅供参考、不作定本。"
    : "仅单音字模式：仅含单一读音的字（多音字不计）。高亮字＝该位置。语料未校勘，仅供参考、不作定本。";
  d.innerHTML =
    `<h3>位置 ${pos + 1} — 钦定词谱「${qd}」 · 语料 ${dom} ${p.dist[dom]}%（${MODE_NAME[TONE_MODE]} n=${p.n}）</h3>
     <div class="note">点击声调标签切换。${note}</div>
     <div class="tone-tabs">${tabs}</div>
     <div class="lines">${ex.map(e => lineHTML(e, pos)).join("")}</div>`;
  d.querySelectorAll(".tone-tab").forEach(el =>
    el.onclick = () => { SEL_TONE = el.dataset.tone; renderDetail(examples, positions, pos, false); });
  if (scroll) d.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function lineHTML(e, pos) {
  const chars = [...e.line];
  const body = chars.map((ch, i) => i === pos ? `<span class="hl">${ch}</span>` : ch).join("");
  const tag = e.amb ? `<span class="tn amb" title="多音字判定">※${(e.tones || []).join("/")}→${e.resolved}</span>` : "";
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
      clearPreset();                            // group toggle = manual change
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
    clearPreset();                              // individual toggle = manual change
    updateCount(); saveSelection();
  };
  return row;
}

const PRESET_BTN = { all: "#selall", none: "#selnone", key: "#selkey", genre: "#selgenre" };
function presetMatch(list) { const s = list.filter(n => A_BY_NAME[n]); return SELECTED.size === s.length && s.every(n => SELECTED.has(n)); }
function detectPreset() {
  if (SELECTED.size === AUTHORS.length) return "all";
  if (!SELECTED.size) return "none";
  if (presetMatch(KEY_POETS)) return "key";
  if (presetMatch(GENRE_POETS)) return "genre";
  return null;                                  // any other (e.g. manually edited) selection
}
function updatePresetButtons() { for (const k in PRESET_BTN) { const el = $(PRESET_BTN[k]); if (el) el.classList.toggle("active", SEL_PRESET === k); } }
function setPreset(p) { SEL_PRESET = p; updatePresetButtons(); }
function clearPreset() { SEL_PRESET = null; updatePresetButtons(); }

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
