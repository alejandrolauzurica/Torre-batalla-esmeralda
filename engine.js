// Motor de cálculo de 3ª generación (Pokémon Esmeralda).
// Las fórmulas están copiadas de la descompilación pret/pokeemerald:
//   stats: src/pokemon.c (CalculateMonStats / CALC_STAT)
//   daño:  src/pokemon.c (CalculateBaseDamage) y src/battle_script_commands.c
//          (Cmd_damagecalc, Cmd_typecalc, ApplyRandomDmgMultiplier)
// Todas las divisiones son enteras (se redondea hacia abajo), igual que en el juego.

export const STAT_KEYS = ["hp", "atk", "def", "spa", "spd", "spe"];

// Naturalezas: [sube, baja] (null si es neutra). Fuente: gNatureStatTable.
export const NATURES = {
  HARDY: null, DOCILE: null, SERIOUS: null, BASHFUL: null, QUIRKY: null,
  LONELY: ["atk", "def"], BRAVE: ["atk", "spe"], ADAMANT: ["atk", "spa"], NAUGHTY: ["atk", "spd"],
  BOLD: ["def", "atk"], RELAXED: ["def", "spe"], IMPISH: ["def", "spa"], LAX: ["def", "spd"],
  TIMID: ["spe", "atk"], HASTY: ["spe", "def"], JOLLY: ["spe", "spa"], NAIVE: ["spe", "spd"],
  MODEST: ["spa", "atk"], MILD: ["spa", "def"], QUIET: ["spa", "spe"], RASH: ["spa", "spd"],
  CALM: ["spd", "atk"], GENTLE: ["spd", "def"], SASSY: ["spd", "spe"], CAREFUL: ["spd", "spa"],
};

// Etapas de estadísticas (-6..+6): [numerador, denominador]. Fuente: gStatStageRatios.
const STAGE_RATIOS = [[10, 40], [10, 35], [10, 30], [10, 25], [10, 20], [10, 15], [10, 10],
  [15, 10], [20, 10], [25, 10], [30, 10], [35, 10], [40, 10]];
const applyStage = (stat, stage) => Math.floor((stat * STAGE_RATIOS[stage + 6][0]) / STAGE_RATIOS[stage + 6][1]);

// Tipos "especiales" en 3ª gen: la categoría depende del TIPO del movimiento, no del movimiento.
const SPECIAL_TYPES = new Set(["FIRE", "WATER", "GRASS", "ELECTRIC", "PSYCHIC", "ICE", "DRAGON", "DARK"]);
export const isSpecialType = (t) => SPECIAL_TYPES.has(t);

/**
 * Calcula los 6 stats.
 * base: {hp,atk,def,spa,spd,spe}; iv y ev: lo mismo (ev es el valor total, 0-252); nature: "BRAVE", etc.
 */
export function calcStats(base, { level = 100, iv, ev, nature, species }) {
  const out = {};
  out.hp = species === "SHEDINJA" ? 1
    : Math.floor(((2 * base.hp + iv.hp + Math.floor(ev.hp / 4)) * level) / 100) + level + 10;
  const mod = NATURES[nature];
  for (const k of ["atk", "def", "spe", "spa", "spd"]) {
    let n = Math.floor(((2 * base[k] + iv[k] + Math.floor(ev[k] / 4)) * level) / 100) + 5;
    if (mod && mod[0] === k) n = Math.floor((n * 110) / 100);
    else if (mod && mod[1] === k) n = Math.floor((n * 90) / 100);
    out[k] = n;
  }
  return out;
}

/**
 * Tira de daño. Devuelve las 16 tiradas posibles (85%..100%) en orden creciente.
 * attacker/defender: { level, types:[t1,t2], stats, ability, item, status, hp, maxHp, friendship, species }
 * move: { name, type, power, effect }
 * opts: { crit, atkStage, defStage, reflect, lightScreen, weather: "RAIN"|"SUN"|"SAND"|"HAIL"|null,
 *         foresight, flashFire, mudSport, waterSport, charged, helpingHand }
 * data: { typechart: {main, foresight}, items: {typeBoost, holdEffects} }
 */
export function calcDamage(attacker, defender, move, opts = {}, data) {
  const level = attacker.level;
  const result = (rolls, extra = {}) => ({ rolls, min: rolls[0], max: rolls[rolls.length - 1], supported: true, ...extra });
  const none = (extra = {}) => result(new Array(16).fill(0), { noEffect: true, ...extra });

  // --- Movimientos sin daño directo o con fórmula propia ---
  if (!move.power && move.effect !== "LEVEL_DAMAGE" && move.effect !== "DRAGON_RAGE" && move.effect !== "SONICBOOM") {
    return { rolls: [], min: 0, max: 0, supported: true, status: true };
  }
  const fixed = (n) => {
    // Tipo: se aplica la inmunidad de tipo (p. ej. Seismic Toss no afecta a Ghost), no STAB ni resistencias.
    const t = typeMultiplier(move.type, defender, opts, data, attacker);
    if (t.immune) return none({ effectiveness: 0 });
    return result(new Array(16).fill(n), { fixed: true, effectiveness: 1 });
  };
  if (move.effect === "LEVEL_DAMAGE") return fixed(level);
  if (move.effect === "DRAGON_RAGE") return fixed(40);
  if (move.effect === "SONICBOOM") return fixed(20);

  // Movimientos con fórmula propia que todavía no están implementados (se añadirán con sus reglas exactas).
  const unsupportedEffects = new Set(["FLAIL", "MIRROR_COAT", "COUNTER", "BIDE", "MAGNITUDE", "ENDEAVOR", "SUPER_FANG",
    "PRESENT", "PSYWAVE", "LOW_KICK", "HIDDEN_POWER", "OHKO", "SPIT_UP", "FUTURE_SIGHT", "TRIPLE_KICK", "ROLLOUT",
    "FURY_CUTTER", "ERUPTION", "BEAT_UP"]);
  if (unsupportedEffects.has(move.effect)) return { rolls: [], min: 0, max: 0, supported: false, reason: move.effect };

  let power = move.power;
  if (move.effect === "RETURN") power = Math.floor(((attacker.friendship ?? 255) * 10) / 25);
  if (move.effect === "FRUSTRATION") power = Math.floor(((255 - (attacker.friendship ?? 255)) * 10) / 25);
  if (power === 0) power = 1;
  const statused = ["BURN", "POISON", "TOXIC", "PARALYSIS"].includes(attacker.status);
  if ((move.effect === "FACADE" && statused)
    || (move.effect === "SMELLINGSALT" && defender.status === "PARALYSIS")
    || opts.doublePower) power *= 2; // Facade / Smelling Salt / Revenge / Pursuit (si se indica en opts)

  const type = move.type;
  const special = isSpecialType(type);
  const hold = (m) => (m.item ? data.items.holdEffects[m.item] : null);
  const aHold = hold(attacker), dHold = hold(defender);

  let atk = special ? attacker.stats.spa : attacker.stats.atk;
  let def = special ? defender.stats.spd : defender.stats.def;

  if (!special && (attacker.ability === "HUGE_POWER" || attacker.ability === "PURE_POWER")) atk *= 2;

  // Objetos que suben el tipo (Mystic Water, etc.): +10 % al stat de ataque
  const boost = attacker.item && data.items.typeBoost[attacker.item];
  if (boost && boost[0] === type) atk = Math.floor((atk * (boost[1] + 100)) / 100);

  if (aHold && aHold[0] === "CHOICE_BAND" && !special) atk = Math.floor((150 * atk) / 100);
  if (aHold && aHold[0] === "DEEP_SEA_TOOTH" && attacker.species === "CLAMPERL" && special) atk *= 2;
  if (dHold && dHold[0] === "DEEP_SEA_SCALE" && defender.species === "CLAMPERL" && special) def *= 2;
  if (aHold && aHold[0] === "LIGHT_BALL" && attacker.species === "PIKACHU" && special) atk *= 2;
  if (dHold && dHold[0] === "METAL_POWDER" && defender.species === "DITTO" && !special) def *= 2;
  if (aHold && aHold[0] === "THICK_CLUB" && (attacker.species === "CUBONE" || attacker.species === "MAROWAK") && !special) atk *= 2;

  // Habilidades
  if (defender.ability === "THICK_FAT" && (type === "FIRE" || type === "ICE") && special) atk = Math.floor(atk / 2);
  if (attacker.ability === "HUSTLE" && !special) atk = Math.floor((150 * atk) / 100);
  if (attacker.ability === "GUTS" && attacker.status && !special) atk = Math.floor((150 * atk) / 100);
  if (defender.ability === "MARVEL_SCALE" && defender.status && !special) def = Math.floor((150 * def) / 100);
  if (type === "ELECTRIC" && opts.mudSport) power = Math.floor(power / 2);
  if (type === "FIRE" && opts.waterSport) power = Math.floor(power / 2);
  const lowHp = attacker.hp <= Math.floor(attacker.maxHp / 3);
  if (lowHp && ((type === "GRASS" && attacker.ability === "OVERGROW") || (type === "FIRE" && attacker.ability === "BLAZE")
    || (type === "WATER" && attacker.ability === "TORRENT") || (type === "BUG" && attacker.ability === "SWARM"))) {
    power = Math.floor((150 * power) / 100);
  }
  if (move.effect === "EXPLOSION") def = Math.floor(def / 2);

  // Etapas (en crítico se ignoran las bajadas del atacante y las subidas del defensor)
  // Cada Pokémon puede traer sus propias etapas: mon.stages = {atk, def, spa, spd, spe} (-6..+6).
  const aSt = attacker.stages?.[special ? "spa" : "atk"] ?? opts.atkStage ?? 0;
  const dSt = defender.stages?.[special ? "spd" : "def"] ?? opts.defStage ?? 0;
  let a, d;
  if (opts.crit) {
    a = aSt > 0 ? applyStage(atk, aSt) : atk;
    d = dSt < 0 ? applyStage(def, dSt) : def;
  } else { a = applyStage(atk, aSt); d = applyStage(def, dSt); }

  let dmg = a * power;
  dmg *= Math.floor((2 * level) / 5) + 2;
  dmg = Math.floor(dmg / d);
  dmg = Math.floor(dmg / 50);

  if (!special) {
    if (attacker.status === "BURN" && attacker.ability !== "GUTS") dmg = Math.floor(dmg / 2);
    if (opts.reflect && !opts.crit) dmg = Math.floor(dmg / 2);
    if (dmg === 0) dmg = 1;
  } else {
    if (opts.lightScreen && !opts.crit) dmg = Math.floor(dmg / 2);
    const w = opts.weather;
    if (w === "RAIN") { if (type === "FIRE") dmg = Math.floor(dmg / 2); if (type === "WATER") dmg = Math.floor((15 * dmg) / 10); }
    if ((w === "RAIN" || w === "SAND" || w === "HAIL") && move.name === "SOLAR_BEAM") dmg = Math.floor(dmg / 2);
    if (w === "SUN") { if (type === "FIRE") dmg = Math.floor((15 * dmg) / 10); if (type === "WATER") dmg = Math.floor(dmg / 2); }
    if (opts.flashFire && type === "FIRE") dmg = Math.floor((15 * dmg) / 10);
  }
  dmg += 2;

  // Cmd_damagecalc
  dmg *= opts.crit ? 2 : 1;
  if (opts.charged && type === "ELECTRIC") dmg *= 2;
  if (opts.helpingHand) dmg = Math.floor((dmg * 15) / 10);

  // Cmd_typecalc: STAB, inmunidades y tabla de tipos
  if (attacker.types.includes(type)) dmg = Math.floor((dmg * 15) / 10);
  const tm = typeMultiplier(type, defender, opts, data, attacker);
  if (tm.immune) return none({ effectiveness: 0 });
  for (const mult of tm.steps) {
    dmg = Math.floor((dmg * mult) / 10);
    if (dmg === 0 && mult !== 0) dmg = 1;
  }

  // ApplyRandomDmgMultiplier: 100 - (0..15) por ciento
  const rolls = [];
  for (let r = 85; r <= 100; r++) {
    let x = dmg;
    if (x !== 0) { x = Math.floor((x * r) / 100); if (x === 0) x = 1; }
    rolls.push(x);
  }
  return result(rolls, { effectiveness: tm.total / 10, type, special });
}

// Aplica la tabla de tipos en el mismo orden que el juego (regla a regla, con redondeo en cada paso).
function typeMultiplier(moveType, defender, opts, data, attacker) {
  if (defender.ability === "LEVITATE" && moveType === "GROUND") return { immune: true, steps: [], total: 0 };
  const [t1, t2] = defender.types;
  // typechart.foresight = reglas situadas DESPUÉS del marcador FORESIGHT (Normal/Fighting -> Ghost = 0).
  // El juego deja de leer la tabla al llegar al marcador si el objetivo tiene Foresight/Odor Sleuth.
  let rules = data.typechart.main;
  if (!opts.foresight) rules = rules.concat(data.typechart.foresight);
  const steps = [];
  let total = 10;
  for (const [atkT, defT, mult] of rules) {
    if (atkT !== moveType) continue;
    if (defT === t1) { steps.push(mult); total = (total * mult) / 10; }
    if (defT === t2 && t1 !== t2) { steps.push(mult); total = (total * mult) / 10; }
  }
  return { immune: steps.includes(0), steps, total };
}

export const koChance = (rolls, hp) => rolls.filter((x) => x >= hp).length / rolls.length;
