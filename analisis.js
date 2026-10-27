// Análisis de un combate: qué rivales pueden salir y qué pasa entre tu Pokémon y cada set posible.
// Funciones puras (sin pantalla) para poder probarlas con node.
import { calcStats, calcDamage, koChance } from "./engine.js";

const EVK = { HP: "hp", ATTACK: "atk", DEFENSE: "def", SP_ATTACK: "spa", SP_DEFENSE: "spd", SPEED: "spe" };

// Rangos de ids de entrenador por ronda (src/battle_tower.c: sFrontierTrainerIdRanges y ...Hard).
const NORMAL = [[0, 99], [80, 119], [100, 139], [120, 159], [140, 179], [160, 199], [180, 219], [200, 299]];
const HARD = [[100, 119], [120, 139], [140, 159], [160, 179], [180, 199], [200, 219], [220, 239], [200, 299]];
export function poolRange(round, battle) {
  const c = Math.max(0, round - 1);
  if (c > 7) return NORMAL[7];
  return battle === 7 ? HARD[c] : NORMAL[c];
}

export const classGroup = (c) => c.replace(/_(M|F)$/, "");

// ctx = { sets (array por índice), trainers: {trainers, lists}, game, data: {typechart, items} }
export function makeCtx({ sets, trainers, game, typechart, items }) {
  const byIndex = {};
  for (const s of sets) byIndex[s.index] = s;
  return { sets, byIndex, trainers, game, data: { typechart, items } };
}

const itemOf = (ctx, set) => { const v = ctx.game.frontierItems[set.item]; return !v || v === "NONE" ? null : v; };

// ¿Encaja el set con lo que has visto? (todos los movimientos vistos y, si lo hay, el objeto)
export function setMatches(ctx, set, slot) {
  const moves = (slot.moves || []).filter(Boolean);
  if (!moves.every((m) => set.moves.includes(m))) return false;
  if (slot.item && itemOf(ctx, set) !== slot.item) return false;
  return true;
}

// Entrenadores posibles según ronda, combate, clase y lo observado en los Pokémon rivales.
export function possibleTrainers(ctx, { round, battle, cls, rival }) {
  const [a, b] = poolRange(round, battle);
  const seen = rival.filter((s) => s.species);
  return ctx.trainers.trainers.filter((t) => {
    if (t.id < a || t.id > b) return false;
    if (cls && classGroup(t.class) !== cls) return false;
    const list = ctx.trainers.lists[t.list];
    return seen.every((slot) => list.some((i) => ctx.byIndex[i].species === slot.species && setMatches(ctx, ctx.byIndex[i], slot)));
  });
}

// Sets posibles de un Pokémon rival con su probabilidad (cada entrenador posible pesa igual y elige al azar de su lista).
// Aproximación: no descuenta el rechazo de especies/objetos repetidos dentro del equipo rival.
export function slotCandidates(ctx, trainers, slot) {
  const w = new Map();
  for (const t of trainers) {
    const list = ctx.trainers.lists[t.list];
    const ok = list.filter((i) => ctx.byIndex[i].species === slot.species && setMatches(ctx, ctx.byIndex[i], slot));
    // Si el entrenador tiene la especie, la probabilidad de cada set es 1/|lista|. Se normaliza después.
    for (const i of ok) w.set(i, (w.get(i) || 0) + 1 / list.length);
  }
  const total = [...w.values()].reduce((x, y) => x + y, 0);
  return [...w.entries()].map(([i, v]) => ({ set: ctx.byIndex[i], p: total ? v / total : 0 })).sort((x, y) => y.p - x.p);
}

const baseOf = (sp) => ({ hp: sp.hp, atk: sp.atk, def: sp.def, spa: sp.spa, spd: sp.spd, spe: sp.spe });
export const abilitiesOf = (ctx, species) => [...new Set(ctx.game.species[species].abilities.filter((a) => a && a !== "NONE"))];

// Pokémon rival: nivel 100, IVs 31, EVs = 510 / nº de stats marcados (máx. 255), naturaleza y objeto del set.
export function buildRival(ctx, set, ability) {
  const sp = ctx.game.species[set.species];
  const ev = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, iv = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
  const each = Math.min(Math.floor(510 / set.evs.length), 255);
  set.evs.forEach((f) => (ev[EVK[f]] = each));
  const stats = calcStats(baseOf(sp), { level: 100, iv, ev, nature: set.nature, species: set.species });
  return { species: set.species, level: 100, types: sp.types, stats, ability, item: itemOf(ctx, set), hp: stats.hp, maxHp: stats.hp, friendship: 255, status: null };
}

// Pokémon tuyo a partir de la ficha del equipo (getStats = stats finales ya calculados).
export function buildMine(ctx, m, stats) {
  const sp = ctx.game.species[m.species];
  return { species: m.species, level: 100, types: sp.types, stats, ability: m.ability, item: m.item || null, hp: stats.hp, maxHp: stats.hp, friendship: 255, status: null };
}

const mv = (ctx, name) => ({ name, ...ctx.game.moves[name] });

// Probabilidad de que la suma de dos golpes (tiradas independientes) alcance los PS.
function twoHit(rolls, hp) {
  let n = 0;
  for (const a of rolls) for (const b of rolls) if (a + b >= hp) n++;
  return n / (rolls.length * rolls.length);
}

export function analyze(ctx, mine, cands, opts = {}) {
  // Combinaciones set x habilidad (cada habilidad de la especie pesa por igual: el juego no la liga al set).
  const combos = [];
  for (const c of cands) {
    const abs = abilitiesOf(ctx, c.set.species);
    for (const a of abs) combos.push({ set: c.set, w: c.p / abs.length, rival: buildRival(ctx, c.set, a) });
  }
  const pctOf = (v, hp) => Math.round((v / hp) * 100);

  // --- Tus ataques ---
  const attacks = mine.moveKeys.map((name) => {
    const m = mv(ctx, name);
    const out = { name, status: false, unsupported: null, ko: 0, ko2: 0, minPct: Infinity, maxPct: 0, noEffect: true };
    for (const k of combos) {
      const r = calcDamage(mine.mon, k.rival, m, opts.mine || {}, ctx.data);
      if (r.status) { out.status = true; break; }
      if (!r.supported) { out.unsupported = r.reason; break; }
      out.ko += k.w * koChance(r.rolls, k.rival.maxHp);
      out.ko2 += k.w * twoHit(r.rolls, k.rival.maxHp);
      out.minPct = Math.min(out.minPct, pctOf(r.min, k.rival.maxHp));
      out.maxPct = Math.max(out.maxPct, pctOf(r.max, k.rival.maxHp));
      if (r.max > 0) out.noEffect = false;
    }
    return out;
  });

  // --- Lo que te pueden hacer ---
  const moveStats = new Map(); // movimiento -> {has: prob de tenerlo, ko: prob OHKO ponderada si lo tiene, max%}
  let faster = 0, tie = 0, ohkoAny = 0;
  for (const k of combos) {
    if (mine.mon.stats.spe > k.rival.stats.spe) faster += k.w;
    else if (mine.mon.stats.spe === k.rival.stats.spe) tie += k.w;
    let best = 0;
    for (const name of k.set.moves) {
      const m = mv(ctx, name);
      const r = calcDamage(k.rival, mine.mon, m, opts.rival || {}, ctx.data);
      let e = moveStats.get(name);
      if (!e) moveStats.set(name, (e = { name, has: 0, ko: 0, maxPct: 0, minPct: Infinity, status: false, unsupported: null }));
      e.has += k.w;
      if (r.status) { e.status = true; continue; }
      if (!r.supported) { e.unsupported = r.reason; continue; }
      const ko = koChance(r.rolls, mine.mon.maxHp);
      e.ko += k.w * ko;
      e.maxPct = Math.max(e.maxPct, pctOf(r.max, mine.mon.maxHp));
      e.minPct = Math.min(e.minPct, pctOf(r.min, mine.mon.maxHp));
      best = Math.max(best, ko);
    }
    ohkoAny += k.w * best;
  }
  const threats = [...moveStats.values()].sort((a, b) => b.maxPct - a.maxPct);
  return { attacks, threats, faster, tie, ohkoAny, combos: combos.length };
}
