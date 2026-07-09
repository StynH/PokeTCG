import { isEnergy, isPokemon } from "../model/cards";
import type { CardInstance } from "../model/cards";
import type { EnergyType } from "../model/energy";
import { ALL_TYPES } from "../model/energy";
import type { PlayerState, PokemonInPlay } from "../core/state";

export function energyUnits(
  card: CardInstance,
  holder: PokemonInPlay,
  players: [PlayerState, PlayerState],
  ownerIndex: number
): { provides: EnergyType[]; count: number } {
  const def = card.def;
  if (isPokemon(def) && def.playableAsEnergy) {
    return { provides: [...ALL_TYPES], count: 1 };
  }
  if (!isEnergy(def)) return { provides: [], count: 0 };
  if (def.deltaOnly && !holder.def.isDelta) return { provides: [], count: 0 };
  if (def.scramble) {
    const behind = players[ownerIndex].prizes.length > players[1 - ownerIndex].prizes.length;
    if (!behind) return { provides: ["Colorless"], count: 1 };
  }
  return { provides: def.provides, count: def.provideCount ?? 1 };
}

export function canPayCost(
  cost: EnergyType[],
  holder: PokemonInPlay,
  players: [PlayerState, PlayerState],
  ownerIndex: number
): boolean {
  const pool = holder.energy.map((card) => energyUnits(card, holder, players, ownerIndex));
  const remaining = pool.map((unit) => unit.count);
  const typed = cost.filter((c) => c !== "Colorless");
  for (const type of typed) {
    let index = pool.findIndex(
      (unit, i) => remaining[i] > 0 && unit.provides.length === 1 && unit.provides[0] === type
    );
    if (index === -1)
      index = pool.findIndex((unit, i) => remaining[i] > 0 && unit.provides.includes(type));
    if (index === -1) return false;
    remaining[index]--;
  }
  const leftover = remaining.reduce((sum, count) => sum + count, 0);
  return leftover >= cost.length - typed.length;
}

export function totalEnergyUnits(
  pokemon: PokemonInPlay,
  players: [PlayerState, PlayerState],
  ownerIndex: number
): number {
  return pokemon.energy.reduce(
    (sum, card) => sum + energyUnits(card, pokemon, players, ownerIndex).count,
    0
  );
}
