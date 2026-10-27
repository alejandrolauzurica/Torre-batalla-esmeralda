// Pantalla "Ronda": eliges tu trío, indicas el rival y la web calcula qué sets pueden ser y qué pasa contra cada uno.
import { makeCtx, possibleTrainers, slotCandidates, buildMine, analyze, classGroup, poolRange } from "./analisis.js";

// Nombres de clase en español (solo los que ya has confirmado tú; el resto aparece en inglés hasta que me los digas).
const CLASES_ES = { SAILOR: "Marinero", SCHOOL_KID: "Escolar", LADY: "Damisela", PARASOL_LADY: "Dama Parasol", POKEFAN: "PokéFan" };
const pct = (x) => Math.round(x * 100) + "%";
const emptySlot = () => ({ species: "", moves: ["", "", "", ""], item: "" });

export async function initRonda(env) {
  const { DATA, byName, esc, norm, getTeam, getStats, state, save, root } = env;
  const [sets, trainers, game, typechart, items] = await Promise.all(
    ["sets.json", "trainers.json", "game.json", "typechart.json", "items.json"].map((f) => fetch(f).then((r) => r.json())));
  const ctx = makeCtx({ sets, trainers, game, typechart, items });
  const classes = [...new Set(trainers.trainers.map((t) => classGroup(t.class)))].sort();
  const className = (g) => CLASES_ES[g] || g.replace(/_/g, " ").toLowerCase() + " (en inglés)";

  const rd = (state.rd ||= { round: 1, battle: 1, cls: "", picks: [], lead: 0, rival: [emptySlot(), emptySlot(), emptySlot()], active: 0 });
  const team = () => getTeam();
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
      ${rd.rival.map(slot).join("")}`;
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
      const r = analyze(ctx, mine, cands);
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
    html += `</div><p class="note">★ = ataque con más probabilidad de OHKO. «Daño» es el rango entre sets posibles. Aún no se tienen en cuenta etapas, estados, clima ni pantallas, ni que el rival repita especie/objeto en su equipo (se añadirá).</p>`;
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
    if (el.dataset.rs !== undefined) {
      const s = rd.rival[+el.dataset.rs], f = el.dataset.f;
      if (f === "species") {
        const key = el.value.trim() ? byName.species[norm(el.value)] : "";
        if (el.value.trim() && !key) { el.classList.add("invalid"); return; }
        el.classList.remove("invalid"); s.species = key || "";
        if (!key) { s.moves = ["", "", "", ""]; s.item = ""; }
      } else if (f === "move") {
        const key = el.value.trim() ? byName.moves[norm(el.value)] : "";
        if (el.value.trim() && !key) { el.classList.add("invalid"); return; }
        el.classList.remove("invalid"); s.moves[+el.dataset.j] = key || "";
      } else s.item = el.value;
      save(); renderRes();
    }
  }
  form.addEventListener("change", onChange);
  res.addEventListener("click", (e) => { const b = e.target.closest("[data-active]"); if (b) { rd.active = +b.dataset.active; save(); renderRes(); } });

  return { render() { if (rd.picks.some((i) => i >= 0 && !team().mons[i]?.species)) rd.picks = [...filled(), -1, -1, -1].slice(0, 3); renderForm(); renderRes(); } };
}
