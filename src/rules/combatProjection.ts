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

export function intrinsicAttackValue(attack: AttackDef, attacker?: PokemonInPlay): number {
  const boost = attacker?.attackBoost;
  let damage = (attack.damage ?? 0) +
    (boost && (!boost.attackName || boost.attackName === attack.name) ? boost.amount : 0);
  for (const effect of attack.effects ?? []) {
    switch (effect.op) {
      case "damage": damage += effect.amount; break;
      case "damageCounters": damage += effect.count * 10; break;
      case "damagePerHeads": damage += effect.flips * effect.amount * 0.5; break;
      case "damagePerFlipsPerEnergy": damage = Math.max(damage, effect.base + effect.amount * 1.5); break;
      case "recoil": damage -= effect.amount * 0.35; break;
      case "applyCondition":
      case "applyPoison":
      case "applyBurn": damage += 20; break;
      case "nextAttackBonus": damage += effect.amount * 0.6; break;
      case "flip":
        damage += effect.heads.reduce((total, nested) => {
          if (nested.op === "damage") return total + nested.amount * 0.5;
          if (nested.op === "damageCounters") return total + nested.count * 5;
          if (nested.op === "applyCondition" || nested.op === "applyPoison" || nested.op === "applyBurn")
            return total + 10;
          return total;
        }, 0);
        break;
    }
  }
  return Math.max(0, damage);
}

export function projectAttackDamage(
  ctx: CombatProjectionContext,
  attack: AttackDef,
  attacker: PokemonInPlay,
  owner: number,
  defender: PokemonInPlay | null
): number {
  let damage = intrinsicAttackValue(attack, attacker);
  for (const effect of attack.effects ?? []) {
    if (effect.op === "damageScaled") {
      const scale = (() => {
        switch (effect.per) {
          case "attackerEnergy": return ctx.totalEnergyUnits(attacker, owner);
          case "defenderEnergy": return defender ? ctx.totalEnergyUnits(defender, 1 - owner) : 0;
          case "defenderDamageCounters": return defender ? Math.floor(defender.damage / 10) : 0;
          case "selfDamageCounters": return Math.floor(attacker.damage / 10);
          case "yourBench": return ctx.players[owner].bench.length;
          case "oppBench": return ctx.players[1 - owner].bench.length;
        }
      })();
      damage = Math.max(damage, effect.base + scale * effect.amount);
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
      attacker.def.stage === "Basic",
      attacker.def.isEx ?? false
    ));
  return damage;
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
