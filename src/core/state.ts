import type { CardInstance, PokemonCardDef } from "../model/cards";
import type { Condition } from "../model/effects";

export interface PokemonInPlay {
  card: CardInstance;
  def: PokemonCardDef;
  energy: CardInstance[];
  tool: CardInstance | null;
  underneath: CardInstance[];
  damage: number;
  condition: Condition | null;
  poisonCounters: number;
  burned: boolean;
  enteredTurn: number;
  evolvedTurn: number | null;
  powerUsedTurn: number | null;
  guard: { mode: "preventAll" | "reduce"; amount: number; untilTurn: number } | null;
  locks: { attack?: number; retreat?: number };
  attackBonus: number;
}

export interface PlayerState {
  name: string;
  deck: CardInstance[];
  hand: CardInstance[];
  discard: CardInstance[];
  prizes: CardInstance[];
  active: PokemonInPlay | null;
  bench: PokemonInPlay[];
  attachedEnergyTurn: number | null;
  supporterTurn: number | null;
  retreatedTurn: number | null;
  turnsTaken: number;
}

export interface StadiumState {
  card: CardInstance;
  owner: number;
}

export interface SlotRef {
  p: number;
  slot: "active" | number;
}

export type GamePhase = "playing" | "finished";

export function makePokemonInPlay(card: CardInstance, turn: number): PokemonInPlay {
  return {
    card,
    def: card.def as PokemonCardDef,
    energy: [],
    tool: null,
    underneath: [],
    damage: 0,
    condition: null,
    poisonCounters: 0,
    burned: false,
    enteredTurn: turn,
    evolvedTurn: null,
    powerUsedTurn: null,
    guard: null,
    locks: {},
    attackBonus: 0,
  };
}

export function clonePokemon(p: PokemonInPlay): PokemonInPlay {
  return {
    ...p,
    energy: [...p.energy],
    underneath: [...p.underneath],
    guard: p.guard ? { ...p.guard } : null,
    locks: { ...p.locks },
  };
}

export function clonePlayer(player: PlayerState): PlayerState {
  return {
    ...player,
    deck: [...player.deck],
    hand: [...player.hand],
    discard: [...player.discard],
    prizes: [...player.prizes],
    active: player.active ? clonePokemon(player.active) : null,
    bench: player.bench.map(clonePokemon),
  };
}
