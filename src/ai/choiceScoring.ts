import type { PlayerState, PokemonInPlay, SlotRef } from "../core/state";
import type { AttackDef, CardDef, CardInstance } from "../model/cards";
import { isEnergy, isPokemon, isTrainer } from "../model/cards";
import type { EnergyType } from "../model/energy";
import { intrinsicAttackValue } from "../rules/combatProjection";

interface BattleScoringContext {
  players: [PlayerState, PlayerState];
  allInPlay(p: number): Array<{ ref: SlotRef; pokemon: PokemonInPlay }>;
  energyUnits(
    card: CardInstance,
    holder: PokemonInPlay,
    ownerIndex: number
  ): { provides: EnergyType[]; count: number };
  effectiveHp?(ref: SlotRef, pokemon: PokemonInPlay): number;
}

function expectedAttackValue(attack: AttackDef): number {
  return intrinsicAttackValue(attack);
}

export function unmetEnergy(
  ctx: BattleScoringContext,
  pokemon: PokemonInPlay,
  owner: number,
  cost: EnergyType[],
  addedCard?: CardInstance
): number {
  const cards = addedCard ? [...pokemon.energy, addedCard] : pokemon.energy;
  const units = cards.map((card) => ctx.energyUnits(card, pokemon, owner));
  const remaining = units.map((unit) => unit.count);
  const typed = cost.filter((symbol) => symbol !== "Colorless");
  let unmet = 0;
  for (const symbol of typed) {
    let index = units.findIndex(
      (unit, i) => remaining[i] > 0 && unit.provides.length === 1 && unit.provides[0] === symbol
    );
    if (index === -1)
      index = units.findIndex((unit, i) => remaining[i] > 0 && unit.provides.includes(symbol));
    if (index === -1) unmet++;
    else remaining[index]--;
  }
  const colorless = cost.length - typed.length;
  const leftover = remaining.reduce((sum, count) => sum + count, 0);
  return unmet + Math.max(0, colorless - leftover);
}

export function pokemonBattleScore(
  ctx: BattleScoringContext,
  pokemon: PokemonInPlay,
  owner: number,
  isActive: boolean
): number {
  let bestReady = 0;
  let bestProgress = 0;
  for (const attack of pokemon.def.attacks) {
    const unmet = unmetEnergy(ctx, pokemon, owner, attack.cost);
    const value = expectedAttackValue(attack);
    if (unmet === 0) bestReady = Math.max(bestReady, value);
    else if (attack.cost.length > unmet)
      bestProgress = Math.max(bestProgress, value * (attack.cost.length - unmet) / attack.cost.length);
  }
  const ref = ctx.allInPlay(owner).find((entry) => entry.pokemon === pokemon)?.ref;
  const hp = ref && ctx.effectiveHp ? ctx.effectiveHp(ref, pokemon) : pokemon.def.hp;
  const hpLeft = hp - pokemon.damage;
  const conditionPenalty = pokemon.condition ? 45 : 0;
  const lingeringPenalty = pokemon.poisonCounters * 14 + (pokemon.burned ? 18 : 0);
  return (
    bestReady * (isActive ? 2.1 : 1.25) +
    bestProgress * 0.8 +
    hpLeft * 0.25 +
    pokemon.energy.length * 7 -
    conditionPenalty -
    lingeringPenalty
  );
}

export function healingChoiceScore(
  ctx: BattleScoringContext,
  pokemon: PokemonInPlay,
  owner: number,
  amount: number,
  isActive: boolean
): number {
  const healed = Math.min(pokemon.damage, amount);
  const before = pokemonBattleScore(ctx, pokemon, owner, isActive);
  const after = pokemonBattleScore(ctx, { ...pokemon, damage: pokemon.damage - healed }, owner, isActive);
  return healed + (after - before) + (pokemon.def.isEx ? 18 : 0) + (isActive ? 10 : 0);
}

export function scoopUpChoiceScore(
  ctx: BattleScoringContext,
  pokemon: PokemonInPlay,
  owner: number,
  isActive: boolean
): number {
  const savedDamage = pokemon.damage * (pokemon.def.isEx ? 1.6 : 1);
  const investment = pokemonBattleScore(ctx, pokemon, owner, isActive) + pokemon.energy.length * 10;
  return savedDamage - investment * 0.35 - (isActive ? 25 : 0);
}

export function gustChoiceScore(
  ctx: BattleScoringContext,
  pokemon: PokemonInPlay,
  owner: number
): number {
  const prizePressure = pokemon.def.isEx ? 45 : 0;
  const trapped = pokemon.def.retreatCost * 8 - pokemon.energy.length * 3;
  const setupDenial = pokemonBattleScore(ctx, pokemon, owner, false) * 0.2;
  return pokemon.damage + prizePressure + trapped + setupDenial;
}

export function energyAttachmentChoiceScore(
  ctx: BattleScoringContext,
  card: CardInstance,
  pokemon: PokemonInPlay,
  owner: number,
  isActive: boolean
): number {
  let best = -20;
  for (const attack of pokemon.def.attacks) {
    const before = unmetEnergy(ctx, pokemon, owner, attack.cost);
    const after = unmetEnergy(ctx, pokemon, owner, attack.cost, card);
    if (after >= before) continue;
    const value = expectedAttackValue(attack);
    const completion = after === 0 ? 95 + value : 50 + value * 0.45;
    best = Math.max(best, completion);
  }
  const existingInvestment = Math.min(24, pokemon.energy.length * 8);
  return best + existingInvestment + (isActive ? 35 : 0) + attachedCardTacticalValue(card, pokemon);
}

export function energyRemovalChoiceScore(
  ctx: BattleScoringContext,
  pokemon: PokemonInPlay,
  owner: number,
  card: CardInstance,
  isActive: boolean
): number {
  const before = pokemonBattleScore(ctx, pokemon, owner, isActive);
  const withoutCard = { ...pokemon, energy: pokemon.energy.filter((energy) => energy.uid !== card.uid) };
  const after = pokemonBattleScore(ctx, withoutCard, owner, isActive);
  return -(before - after) - attachedCardTacticalValue(card, pokemon) - (isActive ? 20 : 0);
}

export function attachedCardTacticalValue(card: CardInstance, holder: PokemonInPlay): number {
  const def = card.def;
  let value = isEnergy(def) ? (def.damageRider ?? 0) * 0.8 : 0;
  const modifiers = isEnergy(def) || isTrainer(def) ? (def.modifiers ?? []) : [];
  for (const modifier of modifiers) {
    if ("requiresHolderType" in modifier && modifier.requiresHolderType &&
      !holder.def.types.includes(modifier.requiresHolderType)) continue;
    if (modifier.kind === "damagePlus") value += modifier.amount * 0.7;
    if (modifier.kind === "damageMinus") value += modifier.amount * 0.8;
    if (modifier.kind === "hpPlus") value += modifier.amount * 0.55;
    if (modifier.kind === "retreatDelta") value -= modifier.amount * 8;
    if (modifier.kind === "noWeakness") value += holder.def.weakness ? 24 : 0;
    if (modifier.kind === "preventConditions") value += 18;
  }
  return value;
}

export function energyMoveValue(
  ctx: BattleScoringContext,
  owner: number,
  matches: (card: CardInstance) => boolean
): number {
  let bestGain = -Infinity;
  const entries = ctx.allInPlay(owner);
  for (const source of entries) {
    const card = source.pokemon.energy.find(matches);
    if (!card) continue;
    for (const target of entries) {
      if (target.pokemon === source.pokemon) continue;
      const before =
        pokemonBattleScore(ctx, source.pokemon, owner, source.ref.slot === "active") +
        pokemonBattleScore(ctx, target.pokemon, owner, target.ref.slot === "active");
      const sourceAfter = {
        ...source.pokemon,
        energy: source.pokemon.energy.filter((energy) => energy.uid !== card.uid),
      };
      const targetAfter = { ...target.pokemon, energy: [...target.pokemon.energy, card] };
      const after =
        pokemonBattleScore(ctx, sourceAfter, owner, source.ref.slot === "active") +
        pokemonBattleScore(ctx, targetAfter, owner, target.ref.slot === "active");
      bestGain = Math.max(bestGain, after - before);
    }
  }
  if (!Number.isFinite(bestGain)) return -40;
  return bestGain > 8 ? 20 + bestGain * 0.4 : -25;
}

export function searchCardChoiceScore(
  ctx: BattleScoringContext,
  card: CardInstance,
  owner: number
): number {
  const player = ctx.players[owner];
  const def: CardDef = card.def;
  if (isEnergy(def)) {
    return Math.max(
      4,
      ...ctx.allInPlay(owner).map(({ ref, pokemon }) =>
        energyAttachmentChoiceScore(ctx, card, pokemon, owner, ref.slot === "active")
      )
    );
  }
  if (isPokemon(def)) {
    const evolvesNow = ctx.allInPlay(owner).some(({ pokemon }) => def.evolvesFrom === pokemon.def.name);
    if (evolvesNow) return 105 + def.hp * 0.1;
    if (def.stage === "Basic") {
      const alreadyInPlay = ctx.allInPlay(owner).some(({ pokemon }) => pokemon.def.name === def.name);
      return player.bench.length < 5 ? (alreadyInPlay ? 42 : 68) + def.hp * 0.08 : 8;
    }
    const hasPreviousStage = player.hand.some(
      (held) => isPokemon(held.def) && def.evolvesFrom === held.def.name
    );
    return hasPreviousStage ? 55 : 12;
  }
  if (isTrainer(def)) return def.kind === "Supporter" ? 52 : 34;
  return 0;
}
