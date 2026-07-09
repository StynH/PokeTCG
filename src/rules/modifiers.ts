import { isEnergy, isTrainer } from "../model/cards";
import type { Modifier } from "../model/effects";
import type { PlayerState, PokemonInPlay, SlotRef, StadiumState } from "../core/state";
import { allInPlay } from "./board";

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
    result.push(mod);
  }
}

export function modifiersAffecting(
  players: [PlayerState, PlayerState],
  ref: SlotRef,
  stadium: StadiumState | null
): Modifier[] {
  const result: Modifier[] = [];
  for (let p = 0; p < 2; p++) {
    for (const { ref: sourceRef, pokemon } of allInPlay(players, p)) {
      const isSelf = sourceRef.p === ref.p && sourceRef.slot === ref.slot;
      if (pokemon.def.power?.kind === "Poke-Body")
        collect(result, pokemon.def.power.modifiers, p, isSelf, ref.p);
      if (pokemon.tool && isTrainer(pokemon.tool.def))
        collect(result, pokemon.tool.def.modifiers, p, isSelf, ref.p);
      for (const energy of pokemon.energy) {
        if (isEnergy(energy.def) && energy.def.modifiers)
          collect(result, energy.def.modifiers, p, isSelf, ref.p);
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

export function conditionsPrevented(
  players: [PlayerState, PlayerState],
  ref: SlotRef,
  stadium: StadiumState | null
): boolean {
  return modifiersAffecting(players, ref, stadium).some(
    (mod) => mod.kind === "preventConditions"
  );
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
  return Math.max(0, pokemon.def.retreatCost + modifierSum(players, ref, stadium, "retreatDelta"));
}
