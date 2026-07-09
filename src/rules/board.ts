import type { PlayerState, PokemonInPlay, SlotRef } from "../core/state";

export function getPokemon(
  players: [PlayerState, PlayerState],
  ref: SlotRef
): PokemonInPlay | null {
  const player = players[ref.p];
  return ref.slot === "active" ? player.active : (player.bench[ref.slot as number] ?? null);
}

export function allInPlay(
  players: [PlayerState, PlayerState],
  p: number
): Array<{ ref: SlotRef; pokemon: PokemonInPlay }> {
  const player = players[p];
  const result: Array<{ ref: SlotRef; pokemon: PokemonInPlay }> = [];
  if (player.active) result.push({ ref: { p, slot: "active" }, pokemon: player.active });
  player.bench.forEach((pokemon, i) => result.push({ ref: { p, slot: i }, pokemon }));
  return result;
}

export function describeSlot(
  players: [PlayerState, PlayerState],
  ref: SlotRef
): string {
  const pokemon = getPokemon(players, ref);
  const where = ref.slot === "active" ? "Active" : `Bench ${(ref.slot as number) + 1}`;
  return pokemon ? `${pokemon.def.name} (${where})` : where;
}
