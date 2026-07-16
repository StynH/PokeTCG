import type { PlayerState, PokemonInPlay, SlotRef, StadiumState } from "../core/state";
import type { AttackDef, CardInstance } from "../model/cards";
import { isEnergy, resistancesOf } from "../model/cards";
import { damageMinusSum, modifierSum, weaknessNullified } from "./modifiers";

export interface CombatProjectionContext {
  players: [PlayerState, PlayerState];
  stadium: StadiumState | null;
  turnNumber?: number;
  energyUnits(card: CardInstance, holder: PokemonInPlay, owner: number): {
    provides: string[];
    count: number;
  };
  totalEnergyUnits(pokemon: PokemonInPlay, owner: number): number;
}

export function intrinsicAttackDamage(attack: AttackDef, attacker?: PokemonInPlay): number {
  const boost = attacker?.attackBoost;
  let damage = (attack.damage ?? 0) +
    (boost && (!boost.attackName || boost.attackName === attack.name) ? boost.amount : 0);
  for (const effect of attack.effects ?? []) {
    switch (effect.op) {
      case "damage": damage += effect.amount; break;
      case "damageCounters": damage += effect.count * 10; break;
      case "damagePerHeads": damage += effect.flips * effect.amount * 0.5; break;
      case "damagePerFlipsPerEnergy": damage = Math.max(damage, effect.base + effect.amount * 1.5); break;
      case "flip":
        damage += effect.heads.reduce((total, nested) => {
          if (nested.op === "damage") return total + nested.amount * 0.5;
          if (nested.op === "damageCounters") return total + nested.count * 5;
          return total;
        }, 0);
        break;
    }
  }
  return Math.max(0, damage);
}

export function intrinsicAttackValue(attack: AttackDef, attacker?: PokemonInPlay): number {
  let value = intrinsicAttackDamage(attack, attacker);
  for (const effect of attack.effects ?? []) {
    switch (effect.op) {
      case "recoil": value -= effect.amount * 0.35; break;
      case "applyCondition":
      case "applyPoison":
      case "applyBurn": value += 20; break;
      case "nextAttackBonus": value += effect.amount * 0.6; break;
      case "flip":
        value += effect.heads.reduce((total, nested) =>
          nested.op === "applyCondition" || nested.op === "applyPoison" || nested.op === "applyBurn"
            ? total + 10
            : total, 0);
        break;
    }
  }
  return Math.max(0, value);
}

export function projectAttackDamage(
  ctx: CombatProjectionContext,
  attack: AttackDef,
  attacker: PokemonInPlay,
  owner: number,
  defender: PokemonInPlay | null
): number {
  let damage = intrinsicAttackDamage(attack, attacker);
  for (const effect of attack.effects ?? []) {
    if (effect.op === "damageScaled") {
      const specialCount = (pokemon: PokemonInPlay | null): number =>
        pokemon ? pokemon.energy.filter((c) => isEnergy(c.def) && !c.def.isBasic).length : 0;
      const benchCount = (o: number): number =>
        effect.perType
          ? ctx.players[o].bench.filter((b) => b.def.types.includes(effect.perType!)).length
          : ctx.players[o].bench.length;
      const scale = (() => {
        switch (effect.per) {
          case "attackerEnergy": return effect.specialOnly ? specialCount(attacker) : ctx.totalEnergyUnits(attacker, owner);
          case "defenderEnergy": return effect.specialOnly ? specialCount(defender) : (defender ? ctx.totalEnergyUnits(defender, 1 - owner) : 0);
          case "defenderDamageCounters": return defender ? Math.floor(defender.damage / 10) : 0;
          case "selfDamageCounters": return Math.floor(attacker.damage / 10);
          case "yourBench": return benchCount(owner);
          case "oppBench": return benchCount(1 - owner);
          case "selfDistinctBasicEnergyTypes": {
            const types = new Set<string>();
            for (const c of attacker.energy)
              if (isEnergy(c.def) && c.def.isBasic) for (const t of c.def.provides) types.add(t);
            return types.size;
          }
        }
      })();
      let bonus = (scale ?? 0) * effect.amount;
      if (effect.maxBonus !== undefined) bonus = Math.min(bonus, effect.maxBonus);
      damage = Math.max(damage, effect.base + bonus);
    }
    if (effect.op === "damageIfDefenderNoEnergy" && defender?.energy.length === 0)
      damage += effect.bonus;
    if (effect.op === "damageIfDefenderSpecialEnergy" &&
      defender?.energy.some((card) => isEnergy(card.def) && !card.def.isBasic))
      damage += effect.bonus;
    if (effect.op === "damageIfDefenderResistance" && defender &&
      resistancesOf(defender.def).includes(effect.resistanceType))
      damage += effect.bonus;
    if (effect.op === "damageIfStatus" && defender) {
      const affected = effect.status === "burned" ? defender.burned
        : effect.status === "poisoned" ? defender.poisonCounters > 0
          : defender.condition === effect.status;
      if (affected) damage += effect.bonus;
    }
    if (effect.op === "damagePerFlipsPerEnergy") {
      const matching = attacker.energy.filter((card) =>
        !effect.energyType || ctx.energyUnits(card, attacker, owner).provides.includes(effect.energyType)
      ).length;
      damage = Math.max(damage, effect.base + matching * effect.amount * 0.5);
    }
    if (effect.op === "discardDefenderSpecialEnergyBonus" &&
      defender?.energy.some((card) => isEnergy(card.def) && !card.def.isBasic))
      damage += effect.bonus;
  }

  const attackerRef = findRef(ctx.players, attacker, owner);
  if (attackerRef) {
    damage += modifierSum(ctx.players, attackerRef, ctx.stadium, "damagePlus");
    for (const card of attacker.energy) {
      if (!isEnergy(card.def) || !card.def.damageRider) continue;
      if (card.def.damageRiderType && !attacker.def.types.includes(card.def.damageRiderType)) continue;
      if (card.def.damageRiderTarget === "active" && !attackCanDamageActive(attack)) continue;
      damage += card.def.damageRider;
    }
  }
  damage = Math.max(0, damage);
  if (!defender || damage <= 0) return damage;

  const defenderRef = findRef(ctx.players, defender, 1 - owner);
  const ignoresBoth = attack.effects?.some(
    (effect) => effect.op === "damage" && effect.applyWR === false &&
      (effect.target === "defending" || effect.target === "anyOpponentChoice")
  ) ?? false;
  if (!ignoresBoth && defenderRef && defender.def.weakness &&
    attacker.def.types.includes(defender.def.weakness) &&
    !weaknessNullified(ctx.players, defenderRef, ctx.stadium))
    damage *= 2;
  if (!ignoresBoth && !attack.ignoreResistance &&
    resistancesOf(defender.def).some((resistance) => attacker.def.types.includes(resistance)))
    damage = Math.max(0, damage - 30);
  if (defender.guard && (ctx.turnNumber === undefined || ctx.turnNumber <= defender.guard.untilTurn)) {
    if (defender.guard.mode === "preventAll") damage = 0;
    else damage = Math.max(0, damage - defender.guard.amount);
  }
  if (defenderRef)
    damage = Math.max(0, damage - damageMinusSum(
      ctx.players,
      defenderRef,
      ctx.stadium,
      {
        isBasic: attacker.def.stage === "Basic",
        isEx: attacker.def.isEx ?? false,
        isEvolved: attacker.def.stage !== "Basic",
        hasSpecialEnergy: attacker.energy.some((c) => isEnergy(c.def) && !c.def.isBasic),
      }
    ));
  return damage;
}

export function projectAttackValue(
  ctx: CombatProjectionContext,
  attack: AttackDef,
  attacker: PokemonInPlay,
  owner: number,
  defender: PokemonInPlay | null
): number {
  const nonDamageValue = intrinsicAttackValue(attack, attacker) - intrinsicAttackDamage(attack, attacker);
  return Math.max(0, projectAttackDamage(ctx, attack, attacker, owner, defender) + nonDamageValue);
}

function attackCanDamageActive(attack: AttackDef): boolean {
  if ((attack.damage ?? 0) > 0) return true;
  return attack.effects?.some((effect) => {
    if (effect.op === "damage")
      return effect.amount > 0 && (effect.target === "defending" || effect.target === "anyOpponentChoice");
    if (effect.op === "damageScaled" || effect.op === "damagePerHeads" || effect.op === "damagePerFlipsPerEnergy")
      return true;
    if (effect.op === "flip")
      return effect.heads.some((nested) =>
        nested.op === "damage" && nested.amount > 0 &&
        (nested.target === "defending" || nested.target === "anyOpponentChoice")
      );
    return false;
  }) ?? false;
}

function findRef(
  players: [PlayerState, PlayerState],
  pokemon: PokemonInPlay,
  owner: number
): SlotRef | null {
  if (players[owner].active === pokemon) return { p: owner, slot: "active" };
  const index = players[owner].bench.indexOf(pokemon);
  return index >= 0 ? { p: owner, slot: index } : null;
}
