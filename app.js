// Pantalla "Mis equipos". Todo se ejecuta en el navegador; los equipos se guardan en localStorage.
import { calcStats, NATURES, STAT_KEYS } from "./engine.js";

const LABEL = { hp: "PS", atk: "Ataque", def: "Defensa", spa: "At. Esp.", spd: "Def. Esp.", spe: "Velocidad" };
const STORE = "torre-batalla:v1";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const zero = () => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 });
const all = (n) => ({ hp: n, atk: n, def: n, spa: n, spd: n, spe: n });

let DATA, state, saveOk = true;
const byName = { species: {}, moves: {} };

function load() { try { const s = localStorage.getItem(STORE); if (s) return JSON.parse(s); } catch { saveOk = false; } return null; }
function save() { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { saveOk = false; } }
const newMon = () => ({ species: "", nature: "HARDY", ability: "", item: "", moves: ["", "", "", ""], mode: "stats", iv: all(31), ev: zero(), stats: zero() });
const newTeam = (name) => ({ id: "t" + Date.now() + Math.floor(Math.random() * 1000), name, mons: Array.from({ length: 6 }, newMon) });
const team = () => state.teams.find((t) => t.id === state.selected) || state.teams[0];

function baseOf(mon) { const s = DATA.species[mon.species]; return s && { hp: s.b[0], atk: s.b[1], def: s.b[2], spa: s.b[3], spd: s.b[4], spe: s.b[5] }; }

// Stats finales del Pokémon (nivel 100). En modo "stats" se usan tal cual; en modo "iv" se calculan.
function getStats(mon) {
  const base = baseOf(mon);
  if (!base) return null;
  if (mon.mode === "stats") return mon.stats;
  return calcStats(base, { level: 100, iv: mon.iv, ev: mon.ev, nature: mon.nature, species: mon.species });
}
// Rango posible de cada stat (IV 0 / EV 0 hasta IV 31 / EV 252) con su naturaleza, para detectar erratas.
function statRange(mon) {
  const base = baseOf(mon);
  const lo = calcStats(base, { level: 100, iv: zero(), ev: zero(), nature: mon.nature, species: mon.species });
  const hi = calcStats(base, { level: 100, iv: all(31), ev: all(252), nature: mon.nature, species: mon.species });
  return { lo, hi };
}
function warnings(mon, idx) {
  const w = [];
  if (!mon.species) return w;
  const sp = DATA.species[mon.species];
  if (mon.ability && !sp.a.includes(mon.ability)) w.push("La habilidad no corresponde a esta especie.");
  if (mon.mode === "stats") {
    const { lo, hi } = statRange(mon);
    for (const k of STAT_KEYS) {
      const v = mon.stats[k];
      if (v && (v < lo[k] || v > hi[k])) w.push(`${LABEL[k]}: ${v} no es posible (rango ${lo[k]}–${hi[k]}). ¿Errata?`);
    }
    if (mon.moves.includes("HIDDEN_POWER")) w.push("Poder Oculto depende de los IVs: usa el modo «IVs y EVs».");
  } else {
    const tot = STAT_KEYS.reduce((a, k) => a + (mon.ev[k] || 0), 0);
    if (tot > 510) w.push(`EVs totales: ${tot}. El máximo es 510.`);
    for (const k of STAT_KEYS) {
      if (mon.iv[k] < 0 || mon.iv[k] > 31) w.push(`${LABEL[k]}: los IVs van de 0 a 31.`);
      if (mon.ev[k] < 0 || mon.ev[k] > 252) w.push(`${LABEL[k]}: los EVs van de 0 a 252.`);
    }
  }
  return w;
}
function teamWarning(t) {
  const out = [], seenS = {}, seenI = {};
  t.mons.forEach((m) => {
    if (m.species) (seenS[m.species] ||= []).push(DATA.species[m.species].n);
    if (m.item) (seenI[m.item] ||= []).push(DATA.items[m.item]);
  });
  for (const v of Object.values(seenS)) if (v.length > 1) out.push(`${v[0]} está repetido: no podrás llevar dos iguales en el mismo trío.`);
  for (const [k, v] of Object.entries(seenI)) if (v.length > 1) out.push(`${DATA.items[k]} está repetido: tampoco puedes llevar dos objetos iguales en el mismo trío.`);
  return out;
}

// ---------- Dibujo ----------
function natureHint(nat) {
  const n = NATURES[nat];
  return n ? `<span class="nat-up">+${LABEL[n[0]]}</span> <span class="nat-down">−${LABEL[n[1]]}</span>` : "neutra";
}
function typeBadges(mon) {
  const s = DATA.species[mon.species];
  if (!s) return "";
  return [...new Set(s.t)].map((t) => `<span class="badge">${esc(DATA.types[t] || t)}</span>`).join("");
}
function statsTable(mon, i) {
  const stats = getStats(mon);
  const nat = NATURES[mon.nature];
  const head = mon.mode === "stats" ? "<tr><th></th><th>Stat</th></tr>" : "<tr><th></th><th>IV</th><th>EV</th><th>Stat</th></tr>";
  const rows = STAT_KEYS.map((k) => {
    const mark = nat && nat[0] === k ? ' <span class="nat-up">▲</span>' : nat && nat[1] === k ? ' <span class="nat-down">▼</span>' : "";
    const inp = (g) => `<td><input type="number" inputmode="numeric" min="0" max="${g === "ev" ? 252 : 31}" data-i="${i}" data-g="${g}" data-k="${k}" value="${mon[g][k]}" aria-label="${LABEL[k]} ${g.toUpperCase()}"></td>`;
    if (mon.mode === "stats") {
      return `<tr><td>${LABEL[k]}${mark}</td><td><input type="number" inputmode="numeric" min="1" max="999" data-i="${i}" data-g="stats" data-k="${k}" value="${mon.stats[k] || ""}" aria-label="${LABEL[k]}"></td></tr>`;
    }
    return `<tr><td>${LABEL[k]}${mark}</td>${inp("iv")}${inp("ev")}<td class="stat" data-out="${k}">${stats[k]}</td></tr>`;
  }).join("");
  return `<table><thead>${head}</thead><tbody>${rows}</tbody></table>`;
}
function cardHtml(mon, i) {
  const sp = DATA.species[mon.species];
  const abil = sp ? sp.a.map((a) => `<option value="${a}"${a === mon.ability ? " selected" : ""}>${esc(DATA.abilities[a] || a)}</option>`).join("") : "";
  const items = `<option value="">Sin objeto</option>` + Object.entries(DATA.items).sort((a, b) => a[1].localeCompare(b[1], "es"))
    .map(([k, n]) => `<option value="${k}"${k === mon.item ? " selected" : ""}>${esc(n)}</option>`).join("");
  const nats = Object.entries(DATA.natures).sort((a, b) => a[1].localeCompare(b[1], "es"))
    .map(([k, n]) => `<option value="${k}"${k === mon.nature ? " selected" : ""}>${esc(n)}</option>`).join("");
  const moves = mon.moves.map((m, j) => `<input list="dl-movimientos" data-i="${i}" data-f="move" data-j="${j}" value="${esc(m ? DATA.moves[m].n : "")}" placeholder="Movimiento ${j + 1}" aria-label="Movimiento ${j + 1}">`).join("");
  return `<section class="mon" data-card="${i}">
    <h2>Pokémon ${i + 1}</h2>
    <div class="row"><label>Especie</label><input list="dl-especies" data-i="${i}" data-f="species" value="${esc(sp ? sp.n : "")}" placeholder="Escribe para buscar…" aria-label="Especie"></div>
    <div class="badges">${typeBadges(mon)}</div>
    ${mon.species ? `
    <div class="row"><label>Naturaleza</label><select data-i="${i}" data-f="nature">${nats}</select></div>
    <div class="row"><label></label><span class="note" style="margin:0">${natureHint(mon.nature)}</span></div>
    <div class="row"><label>Habilidad</label><select data-i="${i}" data-f="ability">${abil}</select></div>
    <div class="row"><label>Objeto</label><select data-i="${i}" data-f="item">${items}</select></div>
    <div class="row" style="align-items:start"><label>Movimientos</label><div style="display:grid;gap:6px">${moves}</div></div>
    <div class="modes" role="radiogroup" aria-label="Cómo introducir los stats">
      <label><input type="radio" name="mode${i}" data-i="${i}" data-f="mode" value="stats"${mon.mode === "stats" ? " checked" : ""}> Stats (nivel 100)</label>
      <label><input type="radio" name="mode${i}" data-i="${i}" data-f="mode" value="iv"${mon.mode === "iv" ? " checked" : ""}> IVs y EVs</label>
    </div>
    ${statsTable(mon, i)}
    <div data-warn="${i}">${warnHtml(mon, i)}</div>` : `<p class="note">Elige una especie para completar el resto.</p>`}
  </section>`;
}
const warnHtml = (mon, i) => warnings(mon, i).map((w) => `<div class="warn">${esc(w)}</div>`).join("");

function renderBar() {
  const t = team();
  $("bar").innerHTML = `
    <select id="sel" aria-label="Equipo">${state.teams.map((x) => `<option value="${x.id}"${x.id === t.id ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select>
    <input id="nombre" value="${esc(t.name)}" aria-label="Nombre del equipo" size="26">
    <button id="nuevo" class="primary">Nuevo equipo</button>
    <button id="dup">Duplicar</button>
    <button id="borrar">Borrar</button>`;
  $("sel").onchange = (e) => { state.selected = e.target.value; save(); render(); };
  $("nombre").oninput = (e) => { t.name = e.target.value || "Sin nombre"; save(); $("sel").selectedOptions[0].textContent = t.name; };
  $("nuevo").onclick = () => { const n = newTeam("Equipo nuevo"); state.teams.push(n); state.selected = n.id; save(); render(); };
  $("dup").onclick = () => { const n = JSON.parse(JSON.stringify(t)); n.id = newTeam("").id; n.name = t.name + " (copia)"; state.teams.push(n); state.selected = n.id; save(); render(); };
  $("borrar").onclick = () => {
    if (!confirm(`¿Borrar el equipo «${t.name}»? No se puede deshacer.`)) return;
    state.teams = state.teams.filter((x) => x.id !== t.id);
    if (!state.teams.length) state.teams.push(newTeam("Mi equipo"));
    state.selected = state.teams[0].id; save(); render();
  };
}
function renderTeam() {
  const t = team();
  $("equipo").innerHTML = t.mons.map(cardHtml).join("");
  const tw = teamWarning(t);
  $("aviso").innerHTML = (saveOk ? "" : "⚠ Tu navegador no deja guardar datos: los equipos se perderán al cerrar la página. ") + tw.map(esc).join(" ");
}
function render() { renderBar(); renderTeam(); }

// ---------- Eventos ----------
function onChange(e) {
  const el = e.target, t = team();
  if (el.dataset.g) return; // los números se gestionan en onInput (no se redibuja para no perder el cursor)
  const i = +el.dataset.i, f = el.dataset.f, mon = t.mons[i];
  if (!mon) return;
  if (f === "species") {
    const key = byName.species[norm(el.value)];
    if (!key) { el.classList.add("invalid"); return; }
    mon.species = key; mon.ability = DATA.species[key].a[0];
  } else if (f === "move") {
    const j = +el.dataset.j, key = byName.moves[norm(el.value)];
    if (el.value.trim() && !key) { el.classList.add("invalid"); return; }
    mon.moves[j] = key || "";
  } else if (f === "mode") {
    // Al pasar a «Stats», si estaban vacíos se rellenan con los que salen de los IVs y EVs actuales.
    if (el.value === "stats" && STAT_KEYS.every((k) => !mon.stats[k])) mon.stats = { ...getStats(mon) };
    mon.mode = el.value;
  }
  else if (f) mon[f] = el.value;
  save(); renderTeam();
}
function onInput(e) {
  const el = e.target;
  if (!el.dataset.g) return;
  const i = +el.dataset.i, mon = team().mons[i];
  mon[el.dataset.g][el.dataset.k] = el.value === "" ? 0 : Number(el.value);
  save();
  const card = el.closest("[data-card]");
  if (mon.mode === "iv") { const s = getStats(mon); card.querySelectorAll("[data-out]").forEach((c) => (c.textContent = s[c.dataset.out])); }
  card.querySelector("[data-warn]").innerHTML = warnHtml(mon, i);
}

async function main() {
  const [ui, def] = await Promise.all([fetch("ui_data.json").then((r) => r.json()), fetch("team_default.json").then((r) => r.json())]);
  DATA = ui;
  for (const [k, s] of Object.entries(DATA.species)) byName.species[norm(s.n)] = k;
  for (const [k, m] of Object.entries(DATA.moves)) byName.moves[norm(m.n)] = k;
  $("dl-especies").innerHTML = Object.values(DATA.species).map((s) => s.n).sort((a, b) => a.localeCompare(b, "es")).map((n) => `<option value="${esc(n)}">`).join("");
  $("dl-movimientos").innerHTML = Object.values(DATA.moves).map((m) => m.n).sort((a, b) => a.localeCompare(b, "es")).map((n) => `<option value="${esc(n)}">`).join("");
  state = load();
  if (!state || !state.teams?.length) {
    const ejemplo = { id: "ejemplo", name: def.name, mons: def.mons };
    state = { teams: [ejemplo], selected: "ejemplo" };
    save();
  }
  render();
  $("equipo").addEventListener("change", onChange);
  $("equipo").addEventListener("input", onInput);
}
main().catch((err) => { document.querySelector("main").innerHTML = `<p class="warn">No se han podido cargar los datos: ${esc(err.message)}</p>`; });
