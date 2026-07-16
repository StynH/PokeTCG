import type { Action, Decision, Game, PendingChoice, PokemonInPlay } from "../engine/game";
import { PRIZE_COUNT } from "../engine/game";
import { isPokemon, isTrainer } from "../model/types";
import type { AttackDef, EnergyType } from "../model/types";
import { energyAttachmentChoiceScore, pokemonBattleScore } from "./choiceScoring";
import { SeededRng } from "../core/rng";
import { intrinsicAttackValue, projectAttackDamage, projectAttackValue } from "../rules/combatProjection";

const SAMPLES = 4;
const ROLLOUT_LIMIT = 40;
const MAX_CANDIDATES = 14;
const WIN_SCORE = 1e9;
export const USEFUL_SETUP_SCORE = 18;

const legacyRandom = new SeededRng(12345);

function nextSeed(rng: SeededRng): number {
  return Math.floor(rng.next() * 2147483647);
}

function expectedDamage(attack: AttackDef, pokemon: PokemonInPlay | undefined): number {
  return intrinsicAttackValue(attack, pokemon);
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

function energyProgressScore(game: Game, pokemon: PokemonInPlay, p: number): number {
  let best = 0;
  for (const attack of pokemon.def.attacks) {
    if (attack.cost.length === 0) continue;
    const unmet = unmetSymbols(game, attack.cost, pokemon, p);
    if (unmet === 0) continue;
    const paid = attack.cost.length - unmet;
    if (paid <= 0) continue;
    const damage = expectedDamage(attack, pokemon);
    best = Math.max(best, damage * (paid / attack.cost.length) * 0.8);
  }
  return best;
}

function bestAffordableDamage(game: Game, attacker: PokemonInPlay, owner: number, defender: PokemonInPlay | null): number {
  let best = 0;
  for (const attack of attacker.def.attacks) {
    if (!game.canPayCost(attack.cost, attacker, owner)) continue;
    best = Math.max(best, projectAttackDamage(game, attack, attacker, owner, defender));
  }
  return best;
}

function bestAffordableAttackValue(
  game: Game,
  attacker: PokemonInPlay,
  owner: number,
  defender: PokemonInPlay | null
): number {
  let best = 0;
  for (const attack of attacker.def.attacks) {
    if (!game.canPayCost(attack.cost, attacker, owner)) continue;
    best = Math.max(best, projectAttackValue(game, attack, attacker, owner, defender));
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

function sideScore(game: Game, p: number): number {
  const player = game.players[p];
  const oppActive = game.players[1 - p].active;
  let score = 0;
  for (const { ref, pokemon } of game.allInPlay(p)) {
    const hpLeft = Math.max(0, game.effectiveHp(ref, pokemon) - pokemon.damage);
    score += 40 + hpLeft;
    score += energyProgressScore(game, pokemon, p) * (ref.slot === "active" ? 1 : 0.7);
    if (pokemon.underneath.length > 0) score += 18;
    const attackValue = bestAffordableAttackValue(
      game, pokemon, p, ref.slot === "active" ? oppActive : null
    );
    score += attackValue * (ref.slot === "active" ? 1.6 : 0.5);
    score += game.totalEnergyUnits(pokemon, p) * 10;
    if (pokemon.def.isEx) score -= (pokemon.damage / game.effectiveHp(ref, pokemon)) * 120;
  }
  if (player.active && oppActive) {
    const activeValue = bestAffordableAttackValue(game, player.active, p, oppActive);
    const readyBenchValue = Math.max(
      0,
      ...player.bench.map((pokemon) => bestAffordableAttackValue(game, pokemon, p, oppActive))
    );
    if (activeValue === 0 && readyBenchValue > 0)
      score -= 90 + readyBenchValue * 0.8;
    if (activeValue > 0) score += 35;
  }
  score += Math.min(player.hand.length, 9) * 8;
  for (const card of player.hand) {
    if (isPokemon(card.def)) {
      const pokemonDef = card.def;
      const evolvesNow = game.allInPlay(p).some(({ pokemon }) => pokemonDef.evolvesFrom === pokemon.def.name);
      if (evolvesNow) score += 18;
      else if (pokemonDef.stage === "Basic" && player.bench.length < 5) score += 7;
    } else if (isTrainer(card.def)) {
      score += Math.min(12, game.getEffectsAiValue(card.def.effects, p) * 0.12);
    }
  }
  if (player.deck.length < 3) score -= (3 - player.deck.length) * 150;
  if (player.bench.length === 0) score -= 120;
  return score;
}

export function evaluatePosition(game: Game, p: number): number {
  if (game.phase === "finished") return game.winner === p ? WIN_SCORE : -WIN_SCORE;
  const me = game.players[p];
  const opp = game.players[1 - p];
  let score = ((PRIZE_COUNT - me.prizes.length) - (PRIZE_COUNT - opp.prizes.length)) * 1200;
  score += sideScore(game, p) - sideScore(game, 1 - p);
  if (opp.active) {
    score += conditionScore(opp.active);
    const oppHp = game.effectiveHp({ p: 1 - p, slot: "active" }, opp.active);
    score += (opp.active.damage / oppHp) * 220;
    if (me.active) {
      const punch = bestAffordableDamage(game, me.active, p, opp.active);
      const oppHpLeft = Math.max(1, oppHp - opp.active.damage);
      if (punch >= oppHpLeft) score += opp.active.def.isEx ? 420 : 280;
    }
  }
  if (me.active) {
    score -= conditionScore(me.active);
    if (opp.active) {
      const threat = bestAffordableDamage(game, opp.active, 1 - p, me.active);
      const hpLeft = game.effectiveHp({ p, slot: "active" }, me.active) - me.active.damage;
      if (threat >= hpLeft) score -= me.active.def.isEx ? 700 : 400;
    }
  }
  return score;
}

function retreatRolloutScore(game: Game, benchIndex: number): number {
  const me = game.players[game.current];
  const active = me.active;
  const target = me.bench[benchIndex];
  const opp = game.players[1 - game.current].active;
  if (!active || !target || !opp) return -100;
  const hpLeft = game.effectiveHp({ p: game.current, slot: "active" }, active) - active.damage;
  const threat = bestAffordableDamage(game, opp, 1 - game.current, active);
  const doomed = threat >= hpLeft;
  const activeValue = bestAffordableAttackValue(game, active, game.current, opp);
  const targetValue = bestAffordableAttackValue(game, target, game.current, opp);
  const stuck = activeValue === 0 || active.condition === "asleep" || active.condition === "paralyzed";
  const cost = game.effectiveRetreatCost({ p: game.current, slot: "active" }, active);
  const discardPenalty = cost * 46;
  const positionGain =
    pokemonBattleScore(game, target, game.current, true) -
    pokemonBattleScore(game, active, game.current, true);
  let score = positionGain + (targetValue - activeValue) * 0.9 - discardPenalty;
  if (stuck && targetValue > 0) score += 115;
  if (doomed) score += active.def.isEx ? 105 : 65;
  if (!doomed && !stuck && activeValue > 0) score -= 90;
  if (targetValue === 0) score -= 75;
  return score;
}

export function heuristicActionScore(game: Game, action: Action): number {
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
        if (me.bench.length === 0) return 104;
        if (me.bench.length >= 4) return duplicate ? 5 : 24;
        if (me.bench.length >= 3) return duplicate ? 18 : 46;
        return duplicate ? 56 : 80;
      }
    case "evolve":
      return 84;
    case "attachEnergy": {
      const target = game.getPokemon(action.target);
      const card = me.hand.find((c) => c.uid === action.handUid);
      if (!target || !card) return 0;
      return energyAttachmentChoiceScore(
        game, card, target, game.current, action.target.slot === "active"
      );
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
      const damage = attack && me.active
        ? projectAttackDamage(game, attack, me.active, game.current, oppActive)
        : 0;
      const value = attack && me.active
        ? projectAttackValue(game, attack, me.active, game.current, oppActive)
        : 0;
      const hpLeft = oppActive
        ? Math.max(0, game.effectiveHp({ p: 1 - game.current, slot: "active" }, oppActive) - oppActive.damage)
        : 999;
      if (value <= 0) return -20;
      const koBonus = damage > 0 && damage >= hpLeft ? 120 : 0;
      return 82 + value * 0.35 + koBonus;
    }
    case "retreat":
      return retreatRolloutScore(game, action.benchIndex);
    case "pass":
      return 1;
  }
}

export function isPlannedDecisionReusable(game: Game, decision: Decision): boolean {
  if (decision.kind !== "action" || decision.action.type !== "pass") return true;
  const passScore = heuristicActionScore(game, decision.action);
  return !game.getLegalActions().some(
    (action) => action.type === "attack" && heuristicActionScore(game, action) > passScore
  );
}

export function chooseSetupAwareAction(
  game: Game,
  rng?: SeededRng
): Action {
  const actions = game.getLegalActions();
  const noise = 0.75;
  const scored = actions.map((action) => ({
    action,
    score: heuristicActionScore(game, action) + (rng?.next() ?? 0) * noise,
  }));
  const usefulSetup = scored
    .filter(({ action, score }) =>
      action.type !== "attack" && action.type !== "pass" && score > USEFUL_SETUP_SCORE
    )
    .sort((a, b) => b.score - a.score)[0];
  if (usefulSetup) return usefulSetup.action;

  return scored
    .filter(({ action }) => action.type === "attack")
    .sort((a, b) => b.score - a.score)[0]?.action ??
    scored.find(({ action }) => action.type === "pass")?.action ??
    scored.sort((a, b) => b.score - a.score)[0].action;
}

function resolveAllPending(game: Game, rng: SeededRng): void {
  let guard = 0;
  while (game.pending && guard++ < 300) {
    game.resolvePending(chooseOptionSeeded(game.pending, rng));
  }
}

function playOutTurn(game: Game, p: number, rng: SeededRng): void {
  let guard = 0;
  while (game.phase === "playing" && game.current === p && guard++ < ROLLOUT_LIMIT) {
    resolveAllPending(game, rng);
    if (game.phase !== "playing" || game.current !== p) break;
    game.perform(chooseSetupAwareAction(game, rng));
  }
  resolveAllPending(game, rng);
}

function simulateAction(game: Game, action: Action, p: number, rng: SeededRng): number {
  const sim = game.cloneForSimulation(nextSeed(rng));
  sim.perform(action);
  resolveAllPending(sim, rng);
  playOutTurn(sim, p, rng);
  if (sim.phase === "playing" && sim.current !== p)
    playOutTurn(sim, sim.current, rng);
  return evaluatePosition(sim, p);
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

function candidateActions(game: Game): Action[] {
  const seen = new Set<string>();
  const deduped: Action[] = [];
  for (const action of game.getLegalActions()) {
    const key = actionKey(game, action);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(action);
  }
  if (deduped.length <= MAX_CANDIDATES) return deduped;
  const scored = deduped.map((action) => ({ action, score: heuristicActionScore(game, action) }));
  scored.sort((a, b) => b.score - a.score);
  const kept = scored.slice(0, MAX_CANDIDATES).map((s) => s.action);
  if (!kept.some((a) => a.type === "pass")) kept.push({ type: "pass" });
  return kept;
}

export function chooseActionSeeded(
  game: Game,
  rng: SeededRng,
  samples = SAMPLES
): Action {
  const actions = candidateActions(game);
  if (actions.length === 1) return actions[0];
  const p = game.current;
  let best = actions[actions.length - 1];
  let bestValue = -Infinity;
  for (const action of actions) {
    let total = 0;
    for (let sample = 0; sample < samples; sample++) {
      total += simulateAction(game, action, p, rng);
    }
    const value = total / samples + heuristicActionScore(game, action) * 1.5 + rng.next() * 2;
    if (value > bestValue) {
      bestValue = value;
      best = action;
    }
  }
  return best;
}

export function chooseAction(game: Game): Action {
  return chooseActionSeeded(game, legacyRandom);
}

export function chooseOptionSeeded(
  pending: PendingChoice,
  rng: SeededRng
): number {
  const noise = 0.7;
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


export function chooseOption(pending: PendingChoice): number {
  return chooseOptionSeeded(pending, legacyRandom);
}
