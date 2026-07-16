import type { CardInstance, PokemonCardDef, PowerDef } from "../model/cards";
import type { Condition } from "../model/effects";
import type { EnergyType } from "../model/energy";

export interface PokemonInPlay {
  card: CardInstance;
  def: PokemonCardDef;
  energy: CardInstance[];
  tool: CardInstance | null;
  underneath: CardInstance[];
  damage: number;
  condition: Condition | null;
  conditionTurn: number;
  poisonCounters: number;
  burned: boolean;
  enteredTurn: number;
  evolvedTurn: number | null;
  powerUsedTurn: number | null;
  guard: { mode: "preventAll" | "reduce"; amount: number; untilTurn: number } | null;
  locks: { attack?: number; retreat?: number };
  attackLocks: Record<string, number>;
  attackBoost: { amount: number; attackName?: string; usableTurn: number } | null;
  chargeCounters: number;
  activeSince: number | null;
  grantedPower: { power: PowerDef; untilTurn: number } | null;
  typeOverride: { types: EnergyType[]; untilTurn: number } | null;
  koByPoison?: boolean;
}

export interface PlayerState {
  name: string;
  deck: CardInstance[];
  hand: CardInstance[];
  discard: CardInstance[];
  prizes: CardInstance[];
  active: PokemonInPlay | null;
  bench: PokemonInPlay[];
  lostZone: CardInstance[];
  attachedEnergyTurn: number | null;
  supporterTurn: number | null;
  retreatedTurn: number | null;
  noStadiumTurn: number | null;
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
    conditionTurn: 0,
    poisonCounters: 0,
    burned: false,
    enteredTurn: turn,
    evolvedTurn: null,
    powerUsedTurn: null,
    guard: null,
    locks: {},
    attackLocks: {},
    attackBoost: null,
    chargeCounters: 0,
    activeSince: null,
    grantedPower: null,
    typeOverride: null,
  };
}

export function clonePokemon(p: PokemonInPlay): PokemonInPlay {
  return {
    ...p,
    energy: [...p.energy],
    underneath: [...p.underneath],
    guard: p.guard ? { ...p.guard } : null,
    locks: { ...p.locks },
    attackLocks: { ...p.attackLocks },
    grantedPower: p.grantedPower ? { ...p.grantedPower } : null,
    typeOverride: p.typeOverride ? { ...p.typeOverride, types: [...p.typeOverride.types] } : null,
  };
}

export function clonePlayer(player: PlayerState): PlayerState {
  return {
    ...player,
    deck: [...player.deck],
    hand: [...player.hand],
    discard: [...player.discard],
    prizes: [...player.prizes],
    lostZone: [...player.lostZone],
    active: player.active ? clonePokemon(player.active) : null,
    bench: player.bench.map(clonePokemon),
  };
}
