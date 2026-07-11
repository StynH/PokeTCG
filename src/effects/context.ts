import type { CardDef, CardInstance, PokemonCardDef } from "../model/cards";
import type { Effect, CardFilter, EffectTarget } from "../model/effects";
import type { EnergyType } from "../model/energy";
import type { PlayerState, PokemonInPlay, SlotRef } from "../core/state";
import type { ChoiceOption } from "../core/choice";
import type { EffectFrame, QueuedOperation } from "../core/operations";
import type { EventCat } from "../core/events";

export type { ChoiceOption };

export interface EffectContext {
  controller: number;
  opponent: number;
  attackerTypes?: EnergyType[];
  fromAttack?: boolean;
  sourceRef?: SlotRef;
  frame: EffectFrame;

  players: [PlayerState, PlayerState];
  turnNumber: number;

  getPokemon(ref: SlotRef): PokemonInPlay | null;
  allInPlay(p: number): Array<{ ref: SlotRef; pokemon: PokemonInPlay }>;
  describeSlot(ref: SlotRef): string;
  targetRefs(target: EffectTarget): SlotRef[];

  energyUnits(
    card: CardInstance,
    holder: PokemonInPlay,
    ownerIndex: number
  ): { provides: EnergyType[]; count: number };
  effectiveHp(ref: SlotRef, pokemon: PokemonInPlay): number;
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
  revealInHand(owner: number, card: CardInstance): void;
  forgetHand(owner: number): void;
  forgetKnownCard(uid: number): void;
  shuffleDeck(p: number): void;
  swapActive(p: number, benchIndex: number): void;
  evolvePokemon(pokemon: PokemonInPlay, card: CardInstance): void;
  takeFromHand(player: PlayerState, uid: number): CardInstance | null;

  dealDamage(
    ref: SlotRef,
    amount: number,
    applyWROverride?: boolean,
    ignoreResistance?: boolean,
    ignoreDefenderEffects?: boolean
  ): void;
  addAttackDamage(amount: number, ignoreResistance?: boolean): boolean;
  currentAttackDamage(): number;

  log(
    msg: string,
    cat?: EventCat,
    extra?: { player?: number; uid?: number; amount?: number }
  ): void;
  flip(label: string): boolean;

  requestChoice(player: number, prompt: string, options: ChoiceOption[]): void;
  queueSwitchChoice(p: number): void;

  queueEffects(effects: Effect[]): void;
  queueOperation(operation: QueuedOperation): void;
  command(name: string, payload: unknown): QueuedOperation;
}
