import type { Action, Game, PendingChoice, PokemonInPlay } from "../engine/game";
import { PRIZE_COUNT } from "../engine/game";
import { isTrainer } from "../model/types";
import type { AttackDef, CardInstance, EnergyType } from "../model/types";

const SAMPLES = 3;
const ROLLOUT_LIMIT = 40;
const WIN_SCORE = 1e9;

let simSeed = 12345;

function nextSeed(): number {
  simSeed = (simSeed * 1103515245 + 12345) % 2147483647;
  return simSeed;
}

function expectedDamage(attack: AttackDef): number {
  let damage = attack.damage ?? 0;
  for (const effect of attack.effects ?? []) {
    if (effect.op === "damagePerHeads") damage += (effect.flips * effect.amount) / 2;
    if (effect.op === "damage") damage += effect.amount * 0.8;
    if (effect.op === "damageCounters") damage += effect.count * 10 * 0.8;
    if (effect.op === "flip") {
      for (const sub of effect.heads) {
        if (sub.op === "damage") damage += sub.amount / 2;
        if (sub.op === "applyCondition" || sub.op === "applyPoison" || sub.op === "applyBurn") damage += 12;
      }
    }
    if (effect.op === "applyCondition" || effect.op === "applyPoison" || effect.op === "applyBurn") damage += 20;
  }
  return damage;
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

function attachEnergyScore(game: Game, card: CardInstance, target: PokemonInPlay, owner: number, active: boolean): number {
  if (game.energyUnits(card, target, owner).count === 0) return 3;
  const withCard: PokemonInPlay = { ...target, energy: [...target.energy, card] };
  let enables = false;
  let progresses = false;
  let needsAny = false;
  for (const attack of target.def.attacks) {
    const before = unmetSymbols(game, attack.cost, target, owner);
    if (before === 0) continue;
    needsAny = true;
    const after = unmetSymbols(game, attack.cost, withCard, owner);
    if (after === 0) enables = true;
    if (after < before) progresses = true;
  }
  const bonus = active ? 4 : 0;
  if (enables) return 92 + bonus;
  if (progresses) return 74 + bonus;
  if (!needsAny) return 30;
  return 32;
}

function bestAffordableDamage(game: Game, attacker: PokemonInPlay, owner: number, defender: PokemonInPlay | null): number {
  let best = 0;
  const types = attacker.def.types;
  for (const attack of attacker.def.attacks) {
    if (!game.canPayCost(attack.cost, attacker, owner)) continue;
    let damage = expectedDamage(attack);
    if (defender && damage > 0) {
      if (defender.def.weakness && types.includes(defender.def.weakness)) damage *= 2;
      if (defender.def.resistance && types.includes(defender.def.resistance)) damage = Math.max(0, damage - 30);
    }
    best = Math.max(best, damage);
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
    const hpLeft = Math.max(0, pokemon.def.hp - pokemon.damage);
    score += 40 + hpLeft;
    const maxCost = Math.max(0, ...pokemon.def.attacks.map((attack) => attack.cost.length));
    score += Math.min(game.totalEnergyUnits(pokemon, p), maxCost) * 25;
    const damage = bestAffordableDamage(game, pokemon, p, ref.slot === "active" ? oppActive : null);
    score += damage * (ref.slot === "active" ? 1.6 : 0.5);
    if (pokemon.def.isEx) score -= (pokemon.damage / pokemon.def.hp) * 120;
  }
  score += Math.min(player.hand.length, 9) * 8;
  if (player.deck.length < 3) score -= (3 - player.deck.length) * 150;
  if (player.bench.length === 0) score -= 120;
  return score;
}

function evaluate(game: Game, p: number): number {
  if (game.phase === "finished") return game.winner === p ? WIN_SCORE : -WIN_SCORE;
  const me = game.players[p];
  const opp = game.players[1 - p];
  let score = ((PRIZE_COUNT - me.prizes.length) - (PRIZE_COUNT - opp.prizes.length)) * 1200;
  score += sideScore(game, p) - sideScore(game, 1 - p);
  if (opp.active) score += conditionScore(opp.active);
  if (me.active) score -= conditionScore(me.active);
  if (me.active && opp.active) {
    const threat = bestAffordableDamage(game, opp.active, 1 - p, me.active);
    const hpLeft = me.active.def.hp - me.active.damage;
    if (threat >= hpLeft) score -= me.active.def.isEx ? 700 : 400;
  }
  return score;
}

function rolloutScore(game: Game, action: Action): number {
  const me = game.players[game.current];
  switch (action.type) {
    case "usePower":
      return 88;
    case "playBasic":
      return me.bench.length < 4 ? 86 : 55;
    case "evolve":
      return 84;
    case "attachEnergy": {
      const target = game.getPokemon(action.target);
      const card = me.hand.find((c) => c.uid === action.handUid);
      if (!target || !card) return 0;
      return attachEnergyScore(game, card, target, game.current, action.target.slot === "active");
    }
    case "playTrainer": {
      const card = me.hand.find((c) => c.uid === action.handUid);
      if (!card || !isTrainer(card.def)) return 0;
      const first = card.def.effects[0];
      if (!first) return 0;
      return game.getEffectAiValue(first, game.current);
    }
    case "playStadium":
      return 30;
    case "playTool":
      return 34;
    case "attack": {
      const attack = me.active?.def.attacks[action.index];
      const dmg = attack ? expectedDamage(attack) : 0;
      const oppActive = game.players[1 - game.current].active;
      const hpLeft = oppActive ? Math.max(0, oppActive.def.hp - oppActive.damage) : 999;
      const koBonus = dmg >= hpLeft ? 120 : 0;
      return 82 + dmg * 0.35 + koBonus;
    }
    case "retreat":
      return 2;
    case "pass":
      return 1;
  }
}

function rolloutPolicy(game: Game): Action {
  const actions = game.getLegalActions();
  let best = actions[actions.length - 1];
  let bestScore = -Infinity;
  for (const action of actions) {
    const score = rolloutScore(game, action) + Math.random() * 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = action;
    }
  }
  return best;
}

function resolveAllPending(game: Game): void {
  let guard = 0;
  while (game.pending && guard++ < 300) {
    game.resolvePending(chooseOption(game.pending));
  }
}

function playOutTurn(game: Game, p: number): void {
  let guard = 0;
  while (game.phase === "playing" && game.current === p && guard++ < ROLLOUT_LIMIT) {
    resolveAllPending(game);
    if (game.phase !== "playing" || game.current !== p) break;
    game.perform(rolloutPolicy(game));
  }
  resolveAllPending(game);
}

function simulateAction(game: Game, action: Action, p: number): number {
  const sim = game.cloneForSimulation(nextSeed());
  sim.perform(action);
  resolveAllPending(sim);
  playOutTurn(sim, p);
  return evaluate(sim, p);
}

export function chooseAction(game: Game): Action {
  const actions = game.getLegalActions();
  if (actions.length === 1) return actions[0];
  const p = game.current;
  let best = actions[actions.length - 1];
  let bestValue = -Infinity;
  for (const action of actions) {
    let total = 0;
    for (let sample = 0; sample < SAMPLES; sample++) {
      total += simulateAction(game, action, p);
    }
    const value = total / SAMPLES + Math.random() * 2;
    if (value > bestValue) {
      bestValue = value;
      best = action;
    }
  }
  return best;
}

export function chooseOption(pending: PendingChoice): number {
  let best = 0;
  let bestScore = -Infinity;
  pending.options.forEach((option, i) => {
    const score = option.aiScore + Math.random() * 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}
