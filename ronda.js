// Pantalla "Ronda": eliges tu trío, indicas el rival y la web calcula qué sets pueden ser y qué pasa contra cada uno.
import { makeCtx, possibleTrainers, slotCandidates, buildMine, analyze, classGroup, poolRange } from "./analisis.js";

// Nombres de clase en español (WikiDex, «Lista de clases de entrenadores»). Hombre y mujer van juntos en una sola entrada.
// Triatleta se reparte en tres clases del juego; el apellido entre paréntesis sale del nombre inglés de la clase.
const CLASES_ES = {
  AROMA_LADY: "Señorita aroma", BATTLE_GIRL: "Luchadora", BEAUTY: "Bella", BIRD_KEEPER: "Ornitólogo", BLACK_BELT: "Karateka",
  BUG_CATCHER: "Cazabichos", BUG_MANIAC: "Bichomaníaco", CAMPER: "Campista", COLLECTOR: "Pokécolector", COOLTRAINER: "Entrenador/a guay",
  CYCLING_TRIATHLETE: "Triatleta (ciclismo)", DRAGON_TAMER: "Domadragón", EXPERT: "Pokéabu", FISHERMAN: "Pescador", GENTLEMAN: "Caballero",
  GUITARIST: "Guitarrista", HEX_MANIAC: "Brujita", HIKER: "Montañero", KINDLER: "Fogonero", LADY: "Damisela", LASS: "Chica",
  NINJA_BOY: "Chico ninja", PARASOL_LADY: "Dama parasol", PICNICKER: "Dominguera", PKMN_BREEDER: "Criapokémon", PKMN_RANGER: "Pokéguarda",
  POKEFAN: "Pokéfan", POKEMANIAC: "Pokémaníaco", PSYCHIC: "Médium", RICH_BOY: "Niño bien", RUIN_MANIAC: "Ruinamaníaco",
  RUNNING_TRIATHLETE: "Triatleta (carrera)", SAILOR: "Marinero", SCHOOL_KID: "Escolar", SWIMMER: "Nadador/a",
  SWIMMING_TRIATHLETE: "Triatleta (natación)", TUBER: "Playero/a", YOUNGSTER: "Joven",
};
const STAT_NAMES = [["atk", "Atq"], ["def", "Def"], ["spa", "AtE"], ["spd", "DeE"], ["spe", "Vel"]];
const STATUS = [["", "Sin estado"], ["BURN", "Quemado"], ["PARALYSIS", "Paralizado"], ["POISON", "Envenenado"], ["TOXIC", "Gravemente envenenado"], ["SLEEP", "Dormido"], ["FREEZE", "Congelado"]];
const WEATHER = [["", "Sin clima"], ["RAIN", "Lluvia"], ["SUN", "Sol"], ["SAND", "Tormenta de arena"], ["HAIL", "Granizo"]];
const newState = () => ({ stages: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, status: "" });
const newCond = () => ({ weather: "", myReflect: false, myLS: false, rvReflect: false, rvLS: false, crit: false });
const pct = (x) => Math.round(x * 100) + "%";
const emptySlot = () => ({ species: "", moves: ["", "", "", ""], item: "" });

export async function initRonda(env) {
  const { DATA, byName, esc, norm, getTeam, getStats, state, save, root } = env;
  const [sets, trainers, game, typechart, items] = await Promise.all(
    ["sets.json", "trainers.json", "game.json", "typechart.json", "items.json"].map((f) => fetch(f).then((r) => r.json())));
  const ctx = makeCtx({ sets, trainers, game, typechart, items });
  const className = (g) => CLASES_ES[g] || g.replace(/_/g, " ").toLowerCase() + " (en inglés)";
  const classes = [...new Set(trainers.trainers.map((t) => classGroup(t.class)))].sort((a, b) => className(a).localeCompare(className(b), "es"));

  const rd = (state.rd ||= { round: 1, battle: 1, cls: "", picks: [], lead: 0, rival: [emptySlot(), emptySlot(), emptySlot()], active: 0 });
  rd.cond ||= newCond(); rd.my ||= {}; rd.rv ||= {};
  const team = () => getTeam();
  const mkey = (i) => team().id + ":" + i;                      // estado de tus Pokémon (por equipo y posición)
  const stOf = (grp, key) => (rd[grp][key] ||= newState());
  let condOpen = false;
  const filled = () => team().mons.map((m, i) => (m.species ? i : -1)).filter((i) => i >= 0);
  if (rd.picks.length !== 3 || rd.picks.some((i) => !team().mons[i]?.species)) rd.picks = [...filled(), -1, -1, -1].slice(0, 3);

  root.innerHTML = `<div class="bar" id="rd-form"></div><div id="rd-res"></div>`;
  const form = root.querySelector("#rd-form"), res = root.querySelector("#rd-res");

  const monName = (i) => (i >= 0 && team().mons[i]?.species ? DATA.species[team().mons[i].species].n : "—");
  const moveName = (k) => DATA.moves[k]?.n || k.replace(/_/g, " ").toLowerCase();

  function renderForm() {
    const opts = (sel) => [`<option value="-1">— elige —</option>`, ...filled().map((i) => `<option value="${i}"${i === sel ? " selected" : ""}>${esc(monName(i))}</option>`)].join("");
    const items = `<option value="">Objeto: ?</option>` + Object.entries(DATA.items).sort((a, b) => a[1].localeCompare(b[1], "es")).map(([k, n]) => `<option value="${k}">${esc(n)}</option>`).join("");
    const slot = (s, n) => `<fieldset class="slot"><legend>${n === 0 ? "Rival 1 (el que sale primero)" : "Rival " + (n + 1)}</legend>
      <input list="dl-especies" data-rs="${n}" data-f="species" value="${esc(s.species ? DATA.species[s.species].n : "")}" placeholder="Especie" aria-label="Especie rival ${n + 1}">
      <select data-rs="${n}" data-f="item" aria-label="Objeto visto">${items.replace(`value="${s.item}"`, `value="${s.item}" selected`)}</select>
      <div class="mv">${s.moves.map((m, j) => `<input list="dl-movimientos" data-rs="${n}" data-f="move" data-j="${j}" value="${esc(m ? moveName(m) : "")}" placeholder="Movimiento visto" aria-label="Movimiento visto ${j + 1}">`).join("")}</div>
    </fieldset>`;
    form.innerHTML = `
      <fieldset class="slot"><legend>Tu trío (equipo: ${esc(team().name)})</legend>
        ${[0, 1, 2].map((k) => `<label>${k + 1}: <select data-pick="${k}">${opts(rd.picks[k])}</select></label>`).join(" ")}
        <label>Sale primero: <select data-lead>${[0, 1, 2].map((k) => `<option value="${k}"${rd.lead === k ? " selected" : ""}>${esc(monName(rd.picks[k]))}</option>`).join("")}</select></label>
      </fieldset>
      <fieldset class="slot"><legend>Combate</legend>
        <label>Ronda <input type="number" min="1" max="99" data-rd="round" value="${rd.round}" style="width:4.5em"></label>
        <label>Combate <select data-rd="battle">${[1, 2, 3, 4, 5, 6, 7].map((n) => `<option${rd.battle === n ? " selected" : ""}>${n}</option>`).join("")}</select></label>
        <label>Clase <select data-rd="cls"><option value="">Cualquiera</option>${classes.map((g) => `<option value="${g}"${rd.cls === g ? " selected" : ""}>${esc(className(g))}</option>`).join("")}</select></label>
      </fieldset>
      ${rd.rival.map(slot).join("")}
      ${condHtml()}`;
  }

  const sel = (opts, cur, attrs) => `<select ${attrs}>${opts.map(([v, n]) => `<option value="${v}"${v === cur ? " selected" : ""}>${esc(n)}</option>`).join("")}</select>`;
  const stageSel = (cur, attrs) => `<select ${attrs}>${[...Array(13)].map((_, i) => { const v = i - 6; return `<option value="${v}"${v === cur ? " selected" : ""}>${v > 0 ? "+" + v : v}</option>`; }).join("")}</select>`;
  function stRow(grp, key, label) {
    const st = stOf(grp, key), at = (stat) => `data-st="${grp}" data-key="${key}" data-stat="${stat}"`;
    return `<div class="strow"><b>${esc(label)}</b>${STAT_NAMES.map(([k, n]) => `<label>${n} ${stageSel(st.stages[k], at(k) + ` aria-label="${esc(label)} ${n}"`)}</label>`).join("")}
      ${sel(STATUS, st.status, at("status") + ` aria-label="Estado de ${esc(label)}"`)}</div>`;
  }
  function condSummary() {
    const c = rd.cond;
    let n = (c.weather ? 1 : 0) + [c.myReflect, c.myLS, c.rvReflect, c.rvLS, c.crit].filter(Boolean).length;
    for (const g of ["my", "rv"]) for (const st of Object.values(rd[g])) n += st.status ? 1 : 0, n += Object.values(st.stages).filter((v) => v).length;
    return n ? `Condiciones del combate (${n} activa${n > 1 ? "s" : ""})` : "Condiciones del combate";
  }
  function condHtml() {
    const c = rd.cond, chk = (k, t) => `<label><input type="checkbox" data-cond="${k}"${c[k] ? " checked" : ""}> ${esc(t)}</label>`;
    const refl = moveName("REFLECT"), ls = moveName("LIGHT_SCREEN");
    const mine = rd.picks.filter((i) => i >= 0).map((i) => stRow("my", mkey(i), monName(i))).join("");
    const rivals = rd.rival.map((s, i) => (s.species ? stRow("rv", String(i), "Rival " + (i + 1) + ": " + DATA.species[s.species].n) : "")).join("");
    return `<details id="rd-cond" style="width:100%"${condOpen ? " open" : ""}><summary>${esc(condSummary())}</summary>
      <fieldset class="slot"><legend>Campo</legend>
        <label>Clima ${sel(WEATHER, c.weather, 'data-cond="weather"')}</label>
        ${chk("crit", "Calcular como golpe crítico")}
        ${chk("myReflect", `Tu lado: ${refl}`)} ${chk("myLS", `Tu lado: ${ls}`)}
        ${chk("rvReflect", `Lado rival: ${refl}`)} ${chk("rvLS", `Lado rival: ${ls}`)}
      </fieldset>
      <fieldset class="slot"><legend>Etapas (−6 a +6) y estado de tus Pokémon</legend>${mine || "—"}</fieldset>
      <fieldset class="slot"><legend>Etapas y estado de los rivales</legend>${rivals || "Escribe antes un rival."}</fieldset>
      <button data-reset>Reiniciar condiciones</button>
    </details>`;
  }

  function renderRes() {
    const seen = rd.rival.map((s, i) => [s, i]).filter(([s]) => s.species);
    const picks = rd.picks.filter((i) => i >= 0);
    if (!seen.length) { res.innerHTML = `<p class="note">Escribe la especie del primer Pokémon rival para empezar.</p>`; return; }
    const pool = possibleTrainers(ctx, { round: rd.round, battle: rd.battle, cls: rd.cls, rival: rd.rival });
    const [a, b] = poolRange(rd.round, rd.battle);
    if (!pool.length) {
      res.innerHTML = `<div class="warn">Ningún entrenador de la ronda ${rd.round}, combate ${rd.battle} (ids ${a}–${b}) tiene esa combinación. Revisa la ronda, la clase, la especie o los movimientos/objeto que has apuntado.</div>`;
      return;
    }
    if (rd.active >= seen.length) rd.active = 0;
    const [slot, idx] = seen[rd.active];
    const cands = slotCandidates(ctx, pool, slot);
    const tabs = seen.map(([s, i], k) => `<button data-active="${k}"${k === rd.active ? ' class="primary"' : ""}>Rival ${i + 1}: ${esc(DATA.species[s.species].n)}</button>`).join(" ");
    const candRows = cands.map((c) => {
      const it = ctx.game.frontierItems[c.set.item];
      return `<tr><td>${pct(c.p)}</td><td>${esc(c.set.moves.map(moveName).join(", "))}</td><td>${it && it !== "NONE" ? esc(DATA.items[it] || it) : "—"}</td><td>${esc(DATA.natures[c.set.nature] || c.set.nature)}</td></tr>`;
    }).join("");
    let html = `<p class="note">${pool.length} entrenador(es) posible(s) en la ronda ${rd.round}, combate ${rd.battle}. Se asumen IVs 31 en el rival y habilidad al azar entre las de su especie.</p>
      <div class="bar">${tabs}</div>
      <details ${cands.length > 6 ? "" : "open"}><summary>${cands.length} set(s) posible(s) para ${esc(DATA.species[slot.species].n)}</summary>
      <table class="cand"><thead><tr><th>Prob.</th><th>Movimientos</th><th>Objeto</th><th>Naturaleza</th></tr></thead><tbody>${candRows}</tbody></table></details>`;
    if (!cands.length) { res.innerHTML = html + `<div class="warn">Esa especie no encaja con lo que has indicado.</div>`; return; }

    html += `<div class="grid">`;
    for (const mi of picks) {
      const m = team().mons[mi];
      const stats = getStats(m);
      if (!stats || !STATS_OK(stats)) { html += `<section class="mon"><h2>${esc(monName(mi))}</h2><div class="warn">Faltan stats de este Pokémon (pestaña Mis equipos).</div></section>`; continue; }
      const mine = { mon: buildMine(ctx, m, stats), moveKeys: m.moves.filter(Boolean) };
      const my = stOf("my", mkey(mi)), rv = stOf("rv", String(idx)), c = rd.cond, weather = c.weather || null;
      mine.mon.status = my.status || null; mine.mon.stages = { ...my.stages };
      const r = analyze(ctx, mine, cands, {
        weather,
        mine: { weather, crit: c.crit, reflect: c.rvReflect, lightScreen: c.rvLS },   // tus ataques: pantallas del rival
        rival: { weather, crit: c.crit, reflect: c.myReflect, lightScreen: c.myLS },  // sus ataques: tus pantallas
        rivalState: { status: rv.status || null, stages: { ...rv.stages } },
      });
      const best = [...r.attacks].filter((x) => !x.status && !x.unsupported && !x.noEffect).sort((x, y) => y.ko - x.ko || y.ko2 - x.ko2 || y.maxPct - x.maxPct)[0];
      html += `<section class="mon"><h2>${esc(monName(mi))}${mi === rd.picks[rd.lead] ? " · sale primero" : ""}</h2>
        <table><thead><tr><th>Tu ataque</th><th>Daño</th><th>OHKO</th><th>2 golpes</th></tr></thead><tbody>
        ${r.attacks.map((x) => `<tr><td>${esc(moveName(x.name))}${best && best.name === x.name ? " ★" : ""}</td>${
          x.status ? `<td colspan="3">estado / sin daño</td>`
            : x.unsupported ? `<td colspan="3">no calculado (${esc(x.unsupported)})</td>`
              : x.noEffect ? `<td colspan="3">no afecta</td>`
                : `<td>${x.minPct}–${x.maxPct}%</td><td>${pct(x.ko)}</td><td>${pct(x.ko2)}</td>`}</tr>`).join("")}
        </tbody></table>
        <table><thead><tr><th>Su ataque</th><th>Lo tiene</th><th>Daño a ti</th><th>OHKO</th></tr></thead><tbody>
        ${r.threats.filter((t) => !t.status).map((t) => `<tr><td>${esc(moveName(t.name))}</td><td>${pct(t.has)}</td>${
          t.unsupported ? `<td colspan="2">no calculado (${esc(t.unsupported)})</td>`
            : t.maxPct === 0 ? `<td colspan="2">no te afecta</td>`
            : `<td>${t.minPct}–${t.maxPct}%</td><td>${pct(t.has ? t.ko / t.has : 0)}</td>`}</tr>`).join("")}
        </tbody></table>
        <div class="note" style="margin:0">Velocidad: sales antes ${pct(r.faster)}${r.tie ? ` · empate ${pct(r.tie)}` : ""}. Probabilidad de que tenga un ataque que te dé OHKO: ${pct(r.ohkoAny)}.</div>
      </section>`;
    }
    html += `</div><p class="note">★ = ataque con más probabilidad de OHKO. «Daño» es el rango entre sets posibles. Se tienen en cuenta las condiciones que marques arriba. Todavía no se descuenta que el rival repita especie/objeto en su equipo (se añadirá).</p>`;
    res.innerHTML = html;
  }
  const STATS_OK = (s) => ["hp", "atk", "def", "spa", "spd", "spe"].every((k) => s[k] > 0);

  function onChange(e) {
    const el = e.target;
    if (el.dataset.pick !== undefined) {
      rd.picks[+el.dataset.pick] = +el.value; rd.lead = Math.min(rd.lead, 2); save(); renderForm(); renderRes(); return;
    }
    if (el.dataset.lead !== undefined) { rd.lead = +el.value; save(); renderRes(); return; }
    if (el.dataset.rd) {
      rd[el.dataset.rd] = el.dataset.rd === "cls" ? el.value : Math.max(1, +el.value || 1);
      if (el.dataset.rd === "round") el.value = rd.round;
      save(); renderRes(); return;
    }
    if (el.dataset.cond) {
      rd.cond[el.dataset.cond] = el.type === "checkbox" ? el.checked : el.value;
      save(); updateSummary(); renderRes(); return;
    }
    if (el.dataset.st) {
      const st = stOf(el.dataset.st, el.dataset.key);
      if (el.dataset.stat === "status") st.status = el.value; else st.stages[el.dataset.stat] = +el.value;
      save(); updateSummary(); renderRes(); return;
    }
    if (el.dataset.rs !== undefined) {
      const s = rd.rival[+el.dataset.rs], f = el.dataset.f;
      if (f === "species") {
        const key = el.value.trim() ? byName.species[norm(el.value)] : "";
        if (el.value.trim() && !key) { el.classList.add("invalid"); return; }
        el.classList.remove("invalid"); s.species = key || "";
        if (!key) { s.moves = ["", "", "", ""]; s.item = ""; }
        save(); renderForm(); renderRes(); return;
      } else if (f === "move") {
        const key = el.value.trim() ? byName.moves[norm(el.value)] : "";
        if (el.value.trim() && !key) { el.classList.add("invalid"); return; }
        el.classList.remove("invalid"); s.moves[+el.dataset.j] = key || "";
      } else s.item = el.value;
      save(); renderRes();
    }
  }
  const updateSummary = () => { const d = form.querySelector("#rd-cond summary"); if (d) d.textContent = condSummary(); };
  form.addEventListener("change", onChange);
  form.addEventListener("toggle", (e) => { if (e.target.id === "rd-cond") condOpen = e.target.open; }, true);
  form.addEventListener("click", (e) => {
    if (!e.target.closest("[data-reset]")) return;
    rd.cond = newCond(); rd.my = {}; rd.rv = {}; save(); renderForm(); renderRes();
  });
  res.addEventListener("click", (e) => { const b = e.target.closest("[data-active]"); if (b) { rd.active = +b.dataset.active; save(); renderRes(); } });

  return { render() { if (rd.picks.some((i) => i >= 0 && !team().mons[i]?.species)) rd.picks = [...filled(), -1, -1, -1].slice(0, 3); renderForm(); renderRes(); } };
}
