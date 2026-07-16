import { isEnergy, isTrainer } from "../model/cards";
import type { EnergyType } from "../model/energy";
import type { Modifier } from "../model/effects";
import type { PlayerState, PokemonInPlay, SlotRef, StadiumState } from "../core/state";
import { allInPlay, getPokemon } from "./board";

function collect(
  result: Modifier[],
  mods: Modifier[] | undefined,
  sourceOwner: number,
  isSelf: boolean,
  targetOwner: number
): void {
  for (const mod of mods ?? []) {
    if (mod.scope === "self" && !isSelf) continue;
    if (mod.scope === "yourPokemon" && sourceOwner !== targetOwner) continue;
    if (mod.scope === "opponentPokemon" && sourceOwner === targetOwner) continue;
    result.push(mod);
  }
}

function holderHasEnergy(holder: PokemonInPlay, type: EnergyType): boolean {
  return holder.energy.some((e) => isEnergy(e.def) && e.def.provides.includes(type));
}

function bodyModifierActive(
  players: [PlayerState, PlayerState],
  mod: Modifier,
  sourceRef: SlotRef,
  targetRef: SlotRef,
  holder: PokemonInPlay,
  target: PokemonInPlay | null,
  stadium: StadiumState | null
): boolean {
  if ("sourceRequiresActive" in mod && mod.sourceRequiresActive && sourceRef.slot !== "active")
    return false;
  if ("requiresEnergyType" in mod && mod.requiresEnergyType && !holderHasEnergy(holder, mod.requiresEnergyType))
    return false;
  if ("targetBenchedOnly" in mod && mod.targetBenchedOnly && targetRef.slot === "active")
    return false;
  if ("targetRequiresType" in mod && mod.targetRequiresType && !target?.def.types?.includes(mod.targetRequiresType))
    return false;
  if ("requiresStadium" in mod && mod.requiresStadium && !stadium) return false;
  if ("requiresHolderAsleep" in mod && mod.requiresHolderAsleep && holder.condition !== "asleep")
    return false;
  if ("targetNameOneOf" in mod && mod.targetNameOneOf &&
    !mod.targetNameOneOf.some((n) => target?.def.name.includes(n)))
    return false;
  if ("requiresNamedInPlay" in mod && mod.requiresNamedInPlay) {
    const names = allInPlay(players, sourceRef.p).map(({ pokemon }) => pokemon.def.name);
    if (!mod.requiresNamedInPlay.every((needle) => names.some((n) => n.includes(needle))))
      return false;
  }
  return true;
}

export function bodiesDisabledFor(
  pokemon: PokemonInPlay,
  stadium: StadiumState | null
): boolean {
  if (!stadium || !isTrainer(stadium.card.def)) return false;
  const mod = stadium.card.def.modifiers?.find((m) => m.kind === "disableBodies");
  if (!mod || mod.kind !== "disableBodies") return false;
  if (mod.basicOnly && pokemon.def.stage !== "Basic") return false;
  if (mod.excludeEx && pokemon.def.isEx) return false;
  if (mod.excludeOwnerName && pokemon.def.name.includes("'s")) return false;
  return true;
}

export function powersDisabled(
  players: [PlayerState, PlayerState],
  ref: SlotRef,
  stadium: StadiumState | null,
  pokemon: PokemonInPlay
): boolean {
  return modifiersAffecting(players, ref, stadium).some(
    (m) => m.kind === "disablePowersBelowHp" && pokemon.def.hp < m.hp
  );
}

export function modifiersAffecting(
  players: [PlayerState, PlayerState],
  ref: SlotRef,
  stadium: StadiumState | null
): Modifier[] {
  const result: Modifier[] = [];
  const target = getPokemon(players, ref);
  for (let p = 0; p < 2; p++) {
    for (const { ref: sourceRef, pokemon } of allInPlay(players, p)) {
      const isSelf = sourceRef.p === ref.p && sourceRef.slot === ref.slot;
      if (pokemon.def.power?.kind === "Poke-Body" && !bodiesDisabledFor(pokemon, stadium)) {
        const bodyModifiers = pokemon.def.power.modifiers?.filter((modifier) =>
          bodyModifierActive(players, modifier, sourceRef, ref, pokemon, target, stadium)
        );
        collect(result, bodyModifiers, p, isSelf, ref.p);
      }
      if (pokemon.tool && isTrainer(pokemon.tool.def))
        collect(result, pokemon.tool.def.modifiers, p, isSelf, ref.p);
      for (const energy of pokemon.energy) {
        if (!isEnergy(energy.def) || !energy.def.modifiers) continue;
        const filtered = energy.def.modifiers.filter(
          (m) => !("requiresHolderType" in m) || !m.requiresHolderType || pokemon.def.types?.includes(m.requiresHolderType)
        );
        collect(result, filtered, p, isSelf, ref.p);
      }
    }
  }
  if (stadium && isTrainer(stadium.card.def))
    collect(result, stadium.card.def.modifiers, stadium.owner, false, ref.p);
  return result;
}

export function modifierSum(
  players: [PlayerState, PlayerState],
  ref: SlotRef,
  stadium: StadiumState | null,
  kind: "damagePlus" | "damageMinus" | "retreatDelta" | "hpPlus"
): number {
  let total = 0;
  for (const mod of modifiersAffecting(players, ref, stadium)) {
    if (mod.kind === kind) total += mod.amount;
  }
  return total;
}

export interface AttackerInfo {
  isBasic: boolean;
  isEx: boolean;
  isEvolved: boolean;
  hasSpecialEnergy: boolean;
}

export function damageMinusSum(
  players: [PlayerState, PlayerState],
  ref: SlotRef,
  stadium: StadiumState | null,
  attacker: AttackerInfo
): number {
  let total = 0;
  for (const mod of modifiersAffecting(players, ref, stadium)) {
    if (mod.kind !== "damageMinus") continue;
    if (mod.attackerBasicOnly && !attacker.isBasic) continue;
    if (mod.requiresAttackerEx && !attacker.isEx) continue;
    if (mod.requiresAttackerEvolved && !attacker.isEvolved) continue;
    if (mod.requiresAttackerSpecialEnergy && !attacker.hasSpecialEnergy) continue;
    total += mod.amount;
  }
  return total;
}

export function modifierMax(
  players: [PlayerState, PlayerState],
  ref: SlotRef,
  stadium: StadiumState | null,
  kind: "burnDamage" | "sleepCheckCoins"
): number {
  let highest = 0;
  for (const modifier of modifiersAffecting(players, ref, stadium)) {
    if (modifier.kind === kind) highest = Math.max(highest, modifier.amount);
  }
  return highest;
}

export function weaknessNullified(
  players: [PlayerState, PlayerState],
  ref: SlotRef,
  stadium: StadiumState | null
): boolean {
  return modifiersAffecting(players, ref, stadium).some((m) => m.kind === "noWeakness");
}

export function conditionsPrevented(
  players: [PlayerState, PlayerState],
  ref: SlotRef,
  stadium: StadiumState | null
): boolean {
  return modifiersAffecting(players, ref, stadium).some(
    (mod) => mod.kind === "preventConditions"
  );
}

export function attackEffectsPrevented(
  players: [PlayerState, PlayerState],
  ref: SlotRef,
  stadium: StadiumState | null
): boolean {
  return modifiersAffecting(players, ref, stadium).some(
    (mod) => mod.kind === "preventAttackEffects" && (!mod.requiresNoStadium || !stadium)
  );
}

function stadiumsInDiscard(player: PlayerState): number {
  return player.discard.filter((c) => isTrainer(c.def) && c.def.kind === "Stadium").length;
}

export function effectiveHp(
  players: [PlayerState, PlayerState],
  ref: SlotRef,
  stadium: StadiumState | null,
  pokemon: PokemonInPlay
): number {
  return pokemon.def.hp + modifierSum(players, ref, stadium, "hpPlus");
}

export function effectiveRetreatCost(
  players: [PlayerState, PlayerState],
  ref: SlotRef,
  stadium: StadiumState | null,
  pokemon: PokemonInPlay
): number {
  let extra = 0;
  if (ref.slot === "active") {
    const perStadium = modifiersAffecting(players, ref, stadium).some(
      (mod) => mod.kind === "retreatPerStadiumInDiscard"
    );
    if (perStadium) extra += stadiumsInDiscard(players[ref.p]);
  }
  return Math.max(0, pokemon.def.retreatCost + modifierSum(players, ref, stadium, "retreatDelta") + extra);
}
