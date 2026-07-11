import type { Action, Game, PendingChoice, PokemonInPlay } from "../engine/game";
import { PRIZE_COUNT } from "../engine/game";
import { isPokemon, isTrainer } from "../model/types";
import type { AttackDef, CardInstance, EnergyType } from "../model/types";
import type { AIProfile, StrategyWeights } from "./profiles";
import { BALANCED } from "./profiles";
import { attachedCardTacticalValue, pokemonBattleScore } from "./choiceScoring";
import { SeededRng } from "../core/rng";
import { intrinsicAttackValue, projectAttackDamage } from "../rules/combatProjection";

const SAMPLES = 4;
const ROLLOUT_LIMIT = 40;
const MAX_CANDIDATES = 14;
const WIN_SCORE = 1e9;

const legacyRandom = new SeededRng(12345);

function nextSeed(rng: SeededRng): number {
  return Math.floor(rng.next() * 2147483647);
}

function expectedDamage(attack: AttackDef, pokemon: PokemonInPlay | undefined, w: StrategyWeights): number {
  const base = intrinsicAttackValue(attack, pokemon);
  return base * (0.85 + 0.15 * w.disruption);
}

function typedUnmetSymbols(game: Game, cost: EnergyType[], holder: PokemonInPlay, owner: number): number {
  const pool = holder.energy.map((card) => game.energyUnits(card, holder, owner));
  const remaining = pool.map((unit) => unit.count);
  const typed = cost.filter((c) => c !== "Colorless");
  let unmet = 0;
  for (const type of typed) {
    let index = pool.findIndex((unit, i) => remaining[i] > 0 && unit.provides.length === 1 && unit.provides[0] === type);
    if (index === -1) index = pool.findIndex((unit, i) => remaining[i] > 0 && unit.provides.includes(type));
    if (index === -1) { unmet++; continue; }
    remaining[index]--;
  }
  return unmet;
}

function unmetSymbols(game: Game, cost: EnergyType[], holder: PokemonInPlay, owner: number): number {
  const pool = holder.energy.map((card) => game.energyUnits(card, holder, owner));
  const remaining = pool.map((unit) => unit.count);
  const typed = cost.filter((c) => c !== "Colorless");
  let unmet = 0;
  for (const type of typed) {
    let index = pool.findIndex((unit, i) => remaining[i] > 0 && unit.provides.length === 1 && unit.provides[0] === type);
    if (index === -1) index = pool.findIndex((unit, i) => remaining[i] > 0 && unit.provides.includes(type));
    if (index === -1) {
      unmet++;
      continue;
    }
    remaining[index]--;
  }
  const leftover = remaining.reduce((sum, count) => sum + count, 0);
  const colorless = cost.length - typed.length;
  if (leftover < colorless) unmet += colorless - leftover;
  return unmet;
}

function attachEnergyScore(game: Game, card: CardInstance, target: PokemonInPlay, owner: number, active: boolean, w: StrategyWeights): number {
  if (game.energyUnits(card, target, owner).count === 0) return 3;
  const withCard: PokemonInPlay = { ...target, energy: [...target.energy, card] };
  let enabledDamage = 0;
  let progressedDamage = 0;
  let needsAny = false;
  for (const attack of target.def.attacks) {
    const before = unmetSymbols(game, attack.cost, target, owner);
    if (before === 0) continue;
    needsAny = true;
    const after = unmetSymbols(game, attack.cost, withCard, owner);
    if (after >= before) continue;
    const typedBefore = typedUnmetSymbols(game, attack.cost, target, owner);
    const typedAfter = typedUnmetSymbols(game, attack.cost, withCard, owner);
    if (typedAfter >= typedBefore && typedBefore > 0) continue;
    const damage = expectedDamage(attack, target, w);
    if (after === 0) enabledDamage = Math.max(enabledDamage, damage);
    else progressedDamage = Math.max(progressedDamage, damage);
  }
  const board = game.allInPlay(owner);
  const targetBattleValue = pokemonBattleScore(game, target, owner, active);
  const bestBattleValue = Math.max(
    targetBattleValue,
    ...board.map(({ ref, pokemon }) =>
      pokemonBattleScore(game, pokemon, owner, ref.slot === "active")
    )
  );
  const primaryBonus = targetBattleValue >= bestBattleValue - 1 ? 24 : 0;
  const focusBonus = Math.min(21, target.energy.length * 7);
  const bonus = (active ? 28 : 0) + primaryBonus + focusBonus;
  const modifierValue = attachedCardTacticalValue(card, target);
  if (enabledDamage > 0) return 80 + Math.min(45, enabledDamage * 0.55) + bonus + modifierValue;
  if (progressedDamage > 0) return 52 + Math.min(34, progressedDamage * 0.4) + bonus + modifierValue;
  if (!needsAny) return 18;
  return 14 + modifierValue;
}

function energyProgressScore(game: Game, pokemon: PokemonInPlay, p: number, w: StrategyWeights): number {
  let best = 0;
  for (const attack of pokemon.def.attacks) {
    if (attack.cost.length === 0) continue;
    const unmet = unmetSymbols(game, attack.cost, pokemon, p);
    if (unmet === 0) continue;
    const paid = attack.cost.length - unmet;
    if (paid <= 0) continue;
    const damage = expectedDamage(attack, pokemon, w);
    best = Math.max(best, damage * (paid / attack.cost.length) * 0.8);
  }
  return best;
}

function bestAffordableDamage(game: Game, attacker: PokemonInPlay, owner: number, defender: PokemonInPlay | null, w: StrategyWeights): number {
  void w;
  let best = 0;
  for (const attack of attacker.def.attacks) {
    if (!game.canPayCost(attack.cost, attacker, owner)) continue;
    best = Math.max(best, projectAttackDamage(game, attack, attacker, owner, defender));
  }
  return best;
}

function conditionScore(pokemon: PokemonInPlay): number {
  let score = 0;
  if (pokemon.condition === "paralyzed") score += 70;
  if (pokemon.condition === "asleep") score += 60;
  if (pokemon.condition === "confused") score += 45;
  if (pokemon.poisonCounters > 0) score += 30 + pokemon.poisonCounters * 20;
  if (pokemon.burned) score += 40;
  return score;
}

function sideScore(game: Game, p: number, w: StrategyWeights): number {
  const player = game.players[p];
  const oppActive = game.players[1 - p].active;
  let score = 0;
  for (const { ref, pokemon } of game.allInPlay(p)) {
    const hpLeft = Math.max(0, game.effectiveHp(ref, pokemon) - pokemon.damage);
    score += 40 + hpLeft * (0.5 + 0.5 * w.defense);
    score += energyProgressScore(game, pokemon, p, w) * (ref.slot === "active" ? 1 : 0.7) * (0.5 + 0.5 * w.setup);
    if (pokemon.underneath.length > 0) score += 18 * w.setup;
    const damage = bestAffordableDamage(game, pokemon, p, ref.slot === "active" ? oppActive : null, w);
    score += damage * (ref.slot === "active" ? 1.6 : 0.5) * (0.5 + 0.5 * w.aggression);
    score += game.totalEnergyUnits(pokemon, p) * (5 + 5 * w.defense);
    if (pokemon.def.isEx) score -= (pokemon.damage / game.effectiveHp(ref, pokemon)) * 120 * w.defense;
  }
  if (player.active && oppActive) {
    const activeDamage = bestAffordableDamage(game, player.active, p, oppActive, w);
    const readyBenchDamage = Math.max(
      0,
      ...player.bench.map((pokemon) => bestAffordableDamage(game, pokemon, p, oppActive, w))
    );
    if (activeDamage === 0 && readyBenchDamage > 0)
      score -= (90 + readyBenchDamage * 0.8) * (0.7 + 0.3 * w.defense);
    if (activeDamage > 0) score += 35 * w.defense;
  }
  score += Math.min(player.hand.length, 9) * 8 * (0.5 + 0.5 * w.setup);
  for (const card of player.hand) {
    if (isPokemon(card.def)) {
      const pokemonDef = card.def;
      const evolvesNow = game.allInPlay(p).some(({ pokemon }) => pokemonDef.evolvesFrom === pokemon.def.name);
      if (evolvesNow) score += 18 * w.setup;
      else if (pokemonDef.stage === "Basic" && player.bench.length < 5) score += 7 * w.setup;
    } else if (isTrainer(card.def)) {
      score += Math.min(12, game.getEffectsAiValue(card.def.effects, p) * 0.12) * w.setup;
    }
  }
  if (player.deck.length < 3) score -= (3 - player.deck.length) * 150;
  if (player.bench.length === 0) score -= 120;
  return score;
}

export function evaluatePosition(game: Game, p: number, w: StrategyWeights): number {
  if (game.phase === "finished") return game.winner === p ? WIN_SCORE : -WIN_SCORE;
  const me = game.players[p];
  const opp = game.players[1 - p];
  let score = ((PRIZE_COUNT - me.prizes.length) - (PRIZE_COUNT - opp.prizes.length)) * 1200;
  score += sideScore(game, p, w) - sideScore(game, 1 - p, w) * (0.7 + 0.3 * w.disruption);
  if (opp.active) {
    score += conditionScore(opp.active) * w.disruption;
    const oppHp = game.effectiveHp({ p: 1 - p, slot: "active" }, opp.active);
    score += (opp.active.damage / oppHp) * 220 * w.aggression;
    if (me.active) {
      const punch = bestAffordableDamage(game, me.active, p, opp.active, w);
      const oppHpLeft = Math.max(1, oppHp - opp.active.damage);
      if (punch >= oppHpLeft) score += (opp.active.def.isEx ? 420 : 280) * w.aggression;
    }
  }
  if (me.active) {
    score -= conditionScore(me.active) * w.defense;
    if (opp.active) {
      const threat = bestAffordableDamage(game, opp.active, 1 - p, me.active, w);
      const hpLeft = game.effectiveHp({ p, slot: "active" }, me.active) - me.active.damage;
      if (threat >= hpLeft) score -= (me.active.def.isEx ? 700 : 400) * w.defense;
    }
  }
  return score;
}

function retreatRolloutScore(game: Game, benchIndex: number, w: StrategyWeights): number {
  const me = game.players[game.current];
  const active = me.active;
  const target = me.bench[benchIndex];
  const opp = game.players[1 - game.current].active;
  if (!active || !target || !opp) return -100;
  const hpLeft = game.effectiveHp({ p: game.current, slot: "active" }, active) - active.damage;
  const threat = bestAffordableDamage(game, opp, 1 - game.current, active, w);
  const doomed = threat >= hpLeft;
  const activeDamage = bestAffordableDamage(game, active, game.current, opp, w);
  const targetDamage = bestAffordableDamage(game, target, game.current, opp, w);
  const stuck = activeDamage === 0 || active.condition === "asleep" || active.condition === "paralyzed";
  const cost = game.effectiveRetreatCost({ p: game.current, slot: "active" }, active);
  const discardPenalty = cost * (34 + 12 * w.defense);
  const positionGain =
    pokemonBattleScore(game, target, game.current, true) -
    pokemonBattleScore(game, active, game.current, true);
  let score = positionGain + (targetDamage - activeDamage) * 0.9 - discardPenalty;
  if (stuck && targetDamage > 0) score += 115;
  if (doomed) score += (active.def.isEx ? 105 : 65) * w.defense;
  if (!doomed && !stuck && activeDamage > 0) score -= 90;
  if (targetDamage === 0) score -= 75;
  return score;
}

export function heuristicActionScore(game: Game, action: Action, w: StrategyWeights): number {
  const me = game.players[game.current];
  switch (action.type) {
    case "usePower":
      {
        const pokemon = game.getPokemon(action.target);
        return pokemon?.def.power
          ? game.getEffectsAiValue(pokemon.def.power.effects ?? [], game.current, action.target)
          : -100;
      }
    case "playBasic":
      {
        const card = me.hand.find((candidate) => candidate.uid === action.handUid);
        const duplicate = card && me.bench.some((pokemon) => pokemon.def.name === card.def.name);
        if (me.bench.length === 0) return 96 + 8 * w.setup;
        if (me.bench.length >= 4) return duplicate ? 5 : 24;
        if (me.bench.length >= 3) return duplicate ? 18 : 46;
        return (duplicate ? 48 : 72) + 8 * w.setup;
      }
    case "evolve":
      return 76 + 8 * w.setup;
    case "attachEnergy": {
      const target = game.getPokemon(action.target);
      const card = me.hand.find((c) => c.uid === action.handUid);
      if (!target || !card) return 0;
      return attachEnergyScore(game, card, target, game.current, action.target.slot === "active", w);
    }
    case "playTrainer": {
      const card = me.hand.find((c) => c.uid === action.handUid);
      if (!card || !isTrainer(card.def)) return 0;
      return game.getEffectsAiValue(card.def.effects, game.current);
    }
    case "playStadium":
      return 30;
    case "playTool":
      return 34;
    case "attack": {
      const attack = me.active?.def.attacks[action.index];
      const oppActive = game.players[1 - game.current].active;
      const dmg = attack && me.active
        ? projectAttackDamage(game, attack, me.active, game.current, oppActive)
        : 0;
      const hpLeft = oppActive
        ? Math.max(0, game.effectiveHp({ p: 1 - game.current, slot: "active" }, oppActive) - oppActive.damage)
        : 999;
      const koBonus = dmg >= hpLeft ? 120 : 0;
      return 82 + dmg * 0.35 * (0.7 + 0.3 * w.aggression) + koBonus;
    }
    case "retreat":
      return retreatRolloutScore(game, action.benchIndex, w);
    case "pass":
      return 1;
  }
}

function rolloutPolicy(game: Game, w: StrategyWeights, rng: SeededRng): Action {
  const actions = game.getLegalActions();
  const noise = 0.25 + 0.5 * w.risk;
  let best = actions[actions.length - 1];
  let bestScore = -Infinity;
  for (const action of actions) {
    const score = heuristicActionScore(game, action, w) + rng.next() * noise;
    if (score > bestScore) {
      bestScore = score;
      best = action;
    }
  }
  return best;
}

function resolveAllPending(game: Game, profile: AIProfile, rng: SeededRng): void {
  let guard = 0;
  while (game.pending && guard++ < 300) {
    game.resolvePending(chooseOptionSeeded(game.pending, profile, rng));
  }
}

function playOutTurn(game: Game, p: number, w: StrategyWeights, profile: AIProfile, rng: SeededRng): void {
  let guard = 0;
  while (game.phase === "playing" && game.current === p && guard++ < ROLLOUT_LIMIT) {
    resolveAllPending(game, profile, rng);
    if (game.phase !== "playing" || game.current !== p) break;
    game.perform(rolloutPolicy(game, w, rng));
  }
  resolveAllPending(game, profile, rng);
}

function simulateAction(game: Game, action: Action, p: number, profile: AIProfile, rng: SeededRng): number {
  const w = profile.weights;
  const sim = game.cloneForSimulation(nextSeed(rng));
  sim.perform(action);
  resolveAllPending(sim, profile, rng);
  playOutTurn(sim, p, w, profile, rng);
  if (sim.phase === "playing" && sim.current !== p)
    playOutTurn(sim, sim.current, BALANCED.weights, BALANCED, rng);
  return evaluatePosition(sim, p, w);
}

function actionKey(game: Game, action: Action): string {
  const me = game.players[game.current];
  const handName = (uid: number) => me.hand.find((c) => c.uid === uid)?.def.name ?? String(uid);
  switch (action.type) {
    case "playBasic":
      return `basic:${handName(action.handUid)}`;
    case "attachEnergy":
      return `energy:${handName(action.handUid)}:${action.target.p}:${action.target.slot}`;
    case "evolve":
      return `evolve:${handName(action.handUid)}:${action.target.p}:${action.target.slot}`;
    case "playTrainer":
      return `trainer:${handName(action.handUid)}`;
    case "playStadium":
      return `stadium:${handName(action.handUid)}`;
    case "playTool":
      return `tool:${handName(action.handUid)}:${action.target.p}:${action.target.slot}`;
    default:
      return JSON.stringify(action);
  }
}

function candidateActions(game: Game, w: StrategyWeights): Action[] {
  const seen = new Set<string>();
  const deduped: Action[] = [];
  for (const action of game.getLegalActions()) {
    const key = actionKey(game, action);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(action);
  }
  if (deduped.length <= MAX_CANDIDATES) return deduped;
  const scored = deduped.map((action) => ({ action, score: heuristicActionScore(game, action, w) }));
  scored.sort((a, b) => b.score - a.score);
  const kept = scored.slice(0, MAX_CANDIDATES).map((s) => s.action);
  if (!kept.some((a) => a.type === "pass")) kept.push({ type: "pass" });
  return kept;
}

export function chooseActionSeeded(
  game: Game,
  profile: AIProfile,
  rng: SeededRng,
  samples = SAMPLES
): Action {
  const actions = candidateActions(game, profile.weights);
  if (actions.length === 1) return actions[0];
  const p = game.current;
  let best = actions[actions.length - 1];
  let bestValue = -Infinity;
  for (const action of actions) {
    let total = 0;
    for (let sample = 0; sample < samples; sample++) {
      total += simulateAction(game, action, p, profile, rng);
    }
    const value = total / samples + heuristicActionScore(game, action, profile.weights) * 1.5 + rng.next() * 2 * profile.weights.risk;
    if (value > bestValue) {
      bestValue = value;
      best = action;
    }
  }
  return best;
}

export function chooseAction(game: Game, profile: AIProfile = BALANCED): Action {
  return chooseActionSeeded(game, profile, legacyRandom);
}

export function chooseOptionSeeded(
  pending: PendingChoice,
  profile: AIProfile,
  rng: SeededRng
): number {
  const noise = 0.3 + 0.4 * profile.weights.risk;
  let best = 0;
  let bestScore = -Infinity;
  pending.options.forEach((option, i) => {
    const score = option.aiScore + rng.next() * noise;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}


export function chooseOption(pending: PendingChoice, profile: AIProfile = BALANCED): number {
  return chooseOptionSeeded(pending, profile, legacyRandom);
}
