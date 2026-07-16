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
  if (card.provideOverride) return { provides: [...card.provideOverride.types], count: def.provideCount ?? 1 };
  if (def.deltaOnly && !holder.def.isDelta) return { provides: [], count: 0 };
  if (def.scramble) {
    const behind = players[ownerIndex].prizes.length > players[1 - ownerIndex].prizes.length;
    if (!behind) return { provides: ["Colorless"], count: 1 };
  }
  const provides = [...def.provides];
  const sources: PokemonInPlay[] = [holder];
  const owner = players[ownerIndex];
  if (owner) for (const p of [owner.active, ...owner.bench]) if (p && p !== holder) sources.push(p);
  for (const carrier of sources) {
    if (carrier.def.power?.kind !== "Poke-Body") continue;
    const own = carrier === holder;
    for (const mod of carrier.def.power.modifiers ?? []) {
      if (mod.kind !== "energyProvidesExtra") continue;
      if (!own && mod.scope !== "yourPokemon" && mod.scope !== "allPokemon") continue;
      if (mod.requiresHolderType && !holder.def.types.includes(mod.requiresHolderType)) continue;
      if (
        (!mod.basicOnly || def.isBasic) &&
        def.provides.includes(mod.fromType) &&
        !provides.includes(mod.addType)
      )
        provides.push(mod.addType);
    }
  }
  return { provides, count: def.provideCount ?? 1 };
}

function discardCostBonus(
  holder: PokemonInPlay,
  players: [PlayerState, PlayerState],
  ownerIndex: number
): { type: EnergyType; count: number } | null {
  if (holder.def.power?.kind !== "Poke-Body") return null;
  const mod = holder.def.power.modifiers?.find((m) => m.kind === "discardProvidesCost");
  if (!mod || mod.kind !== "discardProvidesCost") return null;
  const available = players[ownerIndex].discard.filter(
    (c) => isEnergy(c.def) && c.def.provides.includes(mod.energyType)
  ).length;
  return { type: mod.energyType, count: Math.min(mod.max, available) };
}

export function canPayCost(
  cost: EnergyType[],
  holder: PokemonInPlay,
  players: [PlayerState, PlayerState],
  ownerIndex: number
): boolean {
  const pool = holder.energy.map((card) => energyUnits(card, holder, players, ownerIndex));
  const bonus = discardCostBonus(holder, players, ownerIndex);
  if (bonus)
    for (let i = 0; i < bonus.count; i++) pool.push({ provides: [bonus.type], count: 1 });
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
