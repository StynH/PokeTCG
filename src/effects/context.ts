import type { CardDef, CardInstance, PokemonCardDef } from "../model/cards";
import type { Effect, CardFilter, EffectTarget } from "../model/effects";
import type { EnergyType } from "../model/energy";
import type { PlayerState, PokemonInPlay, SlotRef } from "../core/state";
import type { ChoiceOption } from "../core/choice";
import type { EventCat } from "../core/events";

export type { ChoiceOption };

export interface EffectContext {
  controller: number;
  opponent: number;
  attackerTypes?: EnergyType[];
  fromAttack?: boolean;

  players: [PlayerState, PlayerState];
  turnNumber: number;

  getPokemon(ref: SlotRef): PokemonInPlay | null;
  allInPlay(p: number): Array<{ ref: SlotRef; pokemon: PokemonInPlay }>;
  describeSlot(ref: SlotRef): string;
  forEachTarget(target: EffectTarget, prompt: string, fn: (ref: SlotRef) => void): void;

  energyUnits(
    card: CardInstance,
    holder: PokemonInPlay,
    ownerIndex: number
  ): { provides: EnergyType[]; count: number };
  conditionsPrevented(ref: SlotRef): boolean;
  matchesFilter(def: CardDef, filter: CardFilter): boolean;
  rareCandyPairs(
    p: number
  ): Array<{ ref: SlotRef; pokemon: PokemonInPlay; stage2: CardInstance }>;
  findStage2Middle(
    stage2Def: PokemonCardDef,
    basicName: string
  ): boolean;

  drawCards(p: number, count: number): void;
  shuffleDeck(p: number): void;
  swapActive(p: number, benchIndex: number): void;
  evolvePokemon(pokemon: PokemonInPlay, card: CardInstance): void;
  takeFromHand(player: PlayerState, uid: number): CardInstance | null;

  dealDamage(ref: SlotRef, amount: number, applyWROverride?: boolean): void;

  log(
    msg: string,
    cat?: EventCat,
    extra?: { player?: number; uid?: number; amount?: number }
  ): void;
  flip(label: string): boolean;

  requestChoice(player: number, prompt: string, options: ChoiceOption[]): void;
  queueSwitchChoice(p: number): void;

  queueEffects(effects: Effect[]): void;
  queueThunk(fn: () => void): void;
}
