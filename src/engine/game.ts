import type { CardDef, CardInstance, EnergyCardDef, PokemonCardDef, TrainerCardDef } from "../model/cards";
import { isEnergy, isPokemon, isTrainer, resistancesOf } from "../model/cards";
import type { CardLibrary } from "../model/cards";
import type { Effect } from "../model/effects";
import type { EnergyType } from "../model/energy";
import { SeededRng, shuffle } from "../core/rng";
import type { EventCat, GameEvent } from "../core/events";
import type { ChoiceOption, PendingChoice } from "../core/choice";
import type { EffectFrame, QueuedOperation, SystemOperation } from "../core/operations";
import { effectCommand, effectOperation } from "../core/operations";
import type { GamePhase, SlotRef, StadiumState } from "../core/state";
import {
  type PlayerState,
  type PokemonInPlay,
  makePokemonInPlay,
  clonePlayer,
} from "../core/state";
import { getPokemon, allInPlay, describeSlot } from "../rules/board";
import { energyUnits, canPayCost, totalEnergyUnits } from "../rules/energy";
import { modifierMax, modifierSum, damageMinusSum, conditionsPrevented, effectiveHp, effectiveRetreatCost, weaknessNullified } from "../rules/modifiers";
import { matchesFilter } from "../rules/filters";
import type { EffectContext } from "../effects/context";
import { runEffect, runEffectCommand, effectCanApply, effectAiValue } from "../effects/registry";
import { pokemonBattleScore } from "../ai/choiceScoring";
import "../effects/handlers/index";

// Re-export types that outer consumers (render.ts, simpleAI.ts, simulate.ts) import from here
export type { EventCat, GameEvent } from "../core/events";
export type { PendingChoice, ChoiceOption } from "../core/choice";
export type { PokemonInPlay, PlayerState, SlotRef, GamePhase, StadiumState } from "../core/state";

export const PRIZE_COUNT = 6;
const BENCH_LIMIT = 5;
const STARTING_HAND = 7;

interface AttackDamageTotal {
  amount: number;
  ignoreResistance: boolean;
}

function isEffectDoneToDefendingPokemon(effect: Effect): boolean {
  switch (effect.op) {
    case "applyCondition":
    case "applyPoison":
    case "applyBurn":
    case "lockDefending":
    case "damageIfStatus":
    case "damageIfDefenderNoEnergy":
    case "damageIfDefenderSpecialEnergy":
    case "damageIfDefenderResistance":
    case "discardOpponentEnergy":
    case "discardDefenderSpecialEnergyBonus":
    case "gustOpponent":
      return true;
    case "damageCounters":
      return effect.target === "defending";
    default:
      return false;
  }
}

export type Action =
  | { type: "playBasic"; handUid: number }
  | { type: "evolve"; handUid: number; target: SlotRef }
  | { type: "attachEnergy"; handUid: number; target: SlotRef }
  | { type: "playTrainer"; handUid: number }
  | { type: "playStadium"; handUid: number }
  | { type: "playTool"; handUid: number; target: SlotRef }
  | { type: "usePower"; target: SlotRef }
  | { type: "retreat"; benchIndex: number }
  | { type: "attack"; index: number }
  | { type: "pass" };

export type Decision =
  | { kind: "action"; action: Action }
  | { kind: "choice"; choiceId: string; optionId: string };

export interface DecisionOption {
  id: string;
  informationKey: string;
  label: string;
  decision: Decision;
}

export interface DecisionPoint {
  actor: number;
  id: string;
  options: DecisionOption[];
}

export interface GameSnapshot {
  players: [PlayerState, PlayerState];
  initialDeckIds: [string[], string[]];
  stadium: StadiumState | null;
  current: number;
  turnNumber: number;
  phase: GamePhase;
  winner: number | null;
  suddenDeath: boolean;
  winReason: string;
  prizeCount: number;
  uidCounter: number;
  eventSeq: number;
  rngState: number;
  revision: number;
  pending: PendingChoice | null;
  operations: QueuedOperation[];
  attackTotals: Array<[number, AttackDamageTotal]>;
  attackSeq: number;
  choiceSeq: number;
  turnEnding: boolean;
  turnStarting: boolean;
  knownOpponentHands: [Record<number, string>, Record<number, string>];
}

export interface InformationState {
  observer: number;
  snapshot: GameSnapshot;
  key: string;
}

export class Game {
  players: [PlayerState, PlayerState];
  stadium: StadiumState | null = null;
  current = 0;
  turnNumber = 0;
  phase: GamePhase = "playing";
  winner: number | null = null;
  suddenDeath = false;
  winReason = "";
  log: string[] = [];
  events: GameEvent[] = [];
  pending: PendingChoice | null = null;
  onChange: () => void = () => {};
  revision = 0;

  private library: CardLibrary;
  private rng: SeededRng;
  private initialDeckIds: [string[], string[]];
  private eventSeq = 0;
  private choiceSeq = 0;
  private uidCounter = 1;
  private operations: QueuedOperation[] = [];
  private attackTotals = new Map<number, AttackDamageTotal>();
  private attackSeq = 0;
  private knownOpponentHands: [Record<number, string>, Record<number, string>] = [{}, {}];
  private turnEnding = false;
  private turnStarting = false;
  private prizeCount = PRIZE_COUNT;

  constructor(
    library: CardLibrary,
    deckA: CardDef[],
    deckB: CardDef[],
    names: [string, string],
    seed = Date.now(),
    prizeCount = PRIZE_COUNT
  ) {
    this.library = library;
    this.rng = new SeededRng(seed);
    this.initialDeckIds = [deckA.map((card) => card.id), deckB.map((card) => card.id)];
    this.prizeCount = prizeCount;
    this.players = [this.makePlayer(names[0], deckA), this.makePlayer(names[1], deckB)];
    if (prizeCount < PRIZE_COUNT)
      this.addLog(`Sudden Death! First prize wins (${prizeCount} prize each)`);
    this.setup();
  }

  cloneForSimulation(seed: number): Game {
    const clone: Game = Object.create(Game.prototype);
    clone.players = [clonePlayer(this.players[0]), clonePlayer(this.players[1])];
    clone.stadium = this.stadium ? { ...this.stadium } : null;
    clone.current = this.current;
    clone.turnNumber = this.turnNumber;
    clone.phase = this.phase;
    clone.winner = this.winner;
    clone.winReason = this.winReason;
    clone.log = [];
    clone.events = [];
    clone.pending = this.pending ? this.clonePending(this.pending) : null;
    clone.onChange = () => {};
    clone.library = this.library;
    clone.rng = new SeededRng(seed);
    clone.initialDeckIds = [
      [...this.initialDeckIds[0]],
      [...this.initialDeckIds[1]],
    ];
    clone.eventSeq = 0;
    clone.choiceSeq = this.choiceSeq;
    clone.uidCounter = this.uidCounter;
    clone.operations = this.operations.map((operation) => structuredClone(operation));
    clone.attackTotals = new Map(
      [...this.attackTotals].map(([id, total]) => [id, { ...total }])
    );
    clone.attackSeq = this.attackSeq;
    clone.knownOpponentHands = [
      { ...this.knownOpponentHands[0] },
      { ...this.knownOpponentHands[1] },
    ];
    clone.turnEnding = false;
    clone.turnStarting = false;
    clone.prizeCount = this.prizeCount;
    clone.suddenDeath = this.suddenDeath;
    clone.revision = this.revision;
    shuffle(() => clone.rng.next(), clone.players[0].deck);
    shuffle(() => clone.rng.next(), clone.players[1].deck);
    return clone;
  }

  toSnapshot(): GameSnapshot {
    return {
      players: [clonePlayer(this.players[0]), clonePlayer(this.players[1])],
      initialDeckIds: [[...this.initialDeckIds[0]], [...this.initialDeckIds[1]]],
      stadium: this.stadium ? { ...this.stadium } : null,
      current: this.current,
      turnNumber: this.turnNumber,
      phase: this.phase,
      winner: this.winner,
      suddenDeath: this.suddenDeath,
      winReason: this.winReason,
      prizeCount: this.prizeCount,
      uidCounter: this.uidCounter,
      eventSeq: this.eventSeq,
      rngState: this.rng.snapshot(),
      revision: this.revision,
      pending: this.pending ? this.clonePending(this.pending) : null,
      operations: this.operations.map((operation) => structuredClone(operation)),
      attackTotals: [...this.attackTotals].map(([id, total]) => [id, { ...total }]),
      attackSeq: this.attackSeq,
      choiceSeq: this.choiceSeq,
      turnEnding: this.turnEnding,
      turnStarting: this.turnStarting,
      knownOpponentHands: [
        { ...this.knownOpponentHands[0] },
        { ...this.knownOpponentHands[1] },
      ],
    };
  }

  static fromSnapshot(snapshot: GameSnapshot, library: CardLibrary, chanceSeed?: number): Game {
    const game: Game = Object.create(Game.prototype);
    game.players = [clonePlayer(snapshot.players[0]), clonePlayer(snapshot.players[1])];
    game.initialDeckIds = [
      [...snapshot.initialDeckIds[0]],
      [...snapshot.initialDeckIds[1]],
    ];
    game.stadium = snapshot.stadium ? { ...snapshot.stadium } : null;
    game.current = snapshot.current;
    game.turnNumber = snapshot.turnNumber;
    game.phase = snapshot.phase;
    game.winner = snapshot.winner;
    game.suddenDeath = snapshot.suddenDeath;
    game.winReason = snapshot.winReason;
    game.log = [];
    game.events = [];
    game.pending = snapshot.pending ? game.clonePending(snapshot.pending) : null;
    game.onChange = () => {};
    game.revision = snapshot.revision;
    game.library = library;
    game.rng = new SeededRng(chanceSeed ?? snapshot.rngState);
    game.eventSeq = snapshot.eventSeq;
    game.choiceSeq = snapshot.choiceSeq;
    game.uidCounter = snapshot.uidCounter;
    game.operations = snapshot.operations.map((operation) => structuredClone(operation));
    game.attackTotals = new Map(snapshot.attackTotals.map(([id, total]) => [id, { ...total }]));
    game.attackSeq = snapshot.attackSeq;
    game.turnEnding = snapshot.turnEnding;
    game.turnStarting = snapshot.turnStarting;
    game.knownOpponentHands = [
      { ...snapshot.knownOpponentHands[0] },
      { ...snapshot.knownOpponentHands[1] },
    ];
    game.prizeCount = snapshot.prizeCount;
    return game;
  }

  getInformationState(observer: number): InformationState {
    if (this.pending && this.pending.player !== observer)
      throw new Error("Information state can only be requested for the current decision actor");
    const snapshot = this.toSnapshot();
    snapshot.knownOpponentHands = observer === 0
      ? [{ ...snapshot.knownOpponentHands[0] }, {}]
      : [{}, { ...snapshot.knownOpponentHands[1] }];
    for (let p = 0; p < 2; p++) {
      const placeholder = this.library[snapshot.initialDeckIds[p][0]];
      if (!placeholder) throw new Error(`Cannot redact unknown deck for player ${p}`);
      const player = snapshot.players[p];
      const redact = (zone: CardInstance[]) => zone.map((card) => ({ uid: card.uid, def: placeholder }));
      player.deck = redact(player.deck);
      player.prizes = redact(player.prizes);
      if (p !== observer) player.hand = redact(player.hand);
    }
    const visible = (p: number) => ({
      active: snapshot.players[p].active?.card.def.id ?? null,
      bench: snapshot.players[p].bench.map((pokemon) => pokemon.card.def.id),
      discard: snapshot.players[p].discard.map((card) => card.def.id).sort(),
      hand: p === observer ? snapshot.players[p].hand.map((card) => card.def.id).sort() : snapshot.players[p].hand.length,
      deck: snapshot.players[p].deck.length,
      prizes: snapshot.players[p].prizes.length,
    });
    return {
      observer,
      snapshot,
      key: JSON.stringify({
        revision: snapshot.revision,
        current: snapshot.current,
        turn: snapshot.turnNumber,
        stadium: snapshot.stadium?.card.def.id ?? null,
        players: [visible(0), visible(1)],
        knownOpponentHand: snapshot.knownOpponentHands[observer],
      }),
    };
  }

  getDecisionPoint(): DecisionPoint | null {
    if (this.phase !== "playing") return null;
    if (this.pending) {
      const choiceId = this.pending.id ?? `choice:${this.turnNumber}:${this.current}`;
      return {
        actor: this.pending.player,
        id: choiceId,
      options: this.pending.options.map((option, index) => {
          const optionId = option.id ?? `option:${index}`;
          return {
            id: optionId,
            informationKey: option.informationKey ?? optionId,
            label: option.label,
            decision: { kind: "choice", choiceId, optionId },
          };
        }),
      };
    }
    return {
      actor: this.current,
      id: `action:${this.revision}`,
      options: this.getLegalActions().map((action) => ({
        id: JSON.stringify(action),
        informationKey: this.actionInformationKey(action),
        label: this.describeAction(action),
        decision: { kind: "action", action },
      })),
    };
  }

  applyDecision(decision: Decision): void {
    if (decision.kind === "action") {
      this.perform(decision.action);
      return;
    }
    if (!this.pending || this.pending.id !== decision.choiceId) return;
    const index = this.pending.options.findIndex((option, i) =>
      (option.id ?? `option:${i}`) === decision.optionId
    );
    if (index >= 0) this.resolvePending(index);
  }

  // ── Public query helpers (render.ts / simpleAI.ts) ──────────────────────

  getPokemon(ref: SlotRef): PokemonInPlay | null {
    return getPokemon(this.players, ref);
  }

  allInPlay(p: number): Array<{ ref: SlotRef; pokemon: PokemonInPlay }> {
    return allInPlay(this.players, p);
  }

  describeSlot(ref: SlotRef): string {
    return describeSlot(this.players, ref);
  }

  energyUnits(
    card: CardInstance,
    holder: PokemonInPlay,
    ownerIndex: number
  ): { provides: EnergyType[]; count: number } {
    return energyUnits(card, holder, this.players, ownerIndex);
  }

  canPayCost(cost: EnergyType[], holder: PokemonInPlay, ownerIndex: number): boolean {
    return canPayCost(cost, holder, this.players, ownerIndex);
  }

  totalEnergyUnits(pokemon: PokemonInPlay, ownerIndex: number): number {
    return totalEnergyUnits(pokemon, this.players, ownerIndex);
  }

  effectiveHp(ref: SlotRef, pokemon: PokemonInPlay): number {
    return effectiveHp(this.players, ref, this.stadium, pokemon);
  }

  effectiveRetreatCost(ref: SlotRef, pokemon: PokemonInPlay): number {
    return effectiveRetreatCost(this.players, ref, this.stadium, pokemon);
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  getLegalActions(): Action[] {
    if (this.phase !== "playing" || this.pending) return [];
    const actions: Action[] = [];
    const me = this.players[this.current];
    const isFirstOwnTurn = me.turnsTaken <= 1;

    for (const card of me.hand) {
      const def = card.def;
      if (isPokemon(def)) {
        if (def.stage === "Basic") {
          if (me.bench.length < BENCH_LIMIT)
            actions.push({ type: "playBasic", handUid: card.uid });
        } else if (!isFirstOwnTurn) {
          for (const { ref, pokemon } of this.allInPlay(this.current)) {
            const evolvable =
              pokemon.def.name === def.evolvesFrom &&
              pokemon.enteredTurn !== this.turnNumber &&
              pokemon.evolvedTurn !== this.turnNumber;
            if (evolvable) actions.push({ type: "evolve", handUid: card.uid, target: ref });
          }
        }
        if (def.playableAsEnergy && me.attachedEnergyTurn !== this.turnNumber) {
          for (const { ref } of this.allInPlay(this.current))
            actions.push({ type: "attachEnergy", handUid: card.uid, target: ref });
        }
      } else if (isEnergy(def)) {
        if (me.attachedEnergyTurn !== this.turnNumber) {
          for (const { ref, pokemon } of this.allInPlay(this.current)) {
            if (def.attachRequiresEvolved && pokemon.def.stage === "Basic") continue;
            if (def.attachExcludesEx && pokemon.def.isEx) continue;
            actions.push({ type: "attachEnergy", handUid: card.uid, target: ref });
          }
        }
      } else if (isTrainer(def)) {
        if (def.kind === "Supporter" && (me.supporterTurn === this.turnNumber || this.supportersBlockedByOpponent())) continue;
        if (!this.trainerRestrictionOk(def)) continue;
        if (def.kind === "Stadium") {
          if (this.stadium?.card.def.name !== def.name && !this.stadiumsBlockedByOpponent())
            actions.push({ type: "playStadium", handUid: card.uid });
        } else if (def.kind === "Tool") {
          for (const { ref, pokemon } of this.allInPlay(this.current))
            if (!pokemon.tool) actions.push({ type: "playTool", handUid: card.uid, target: ref });
        } else if (this.trainerCanPlay(def)) {
          actions.push({ type: "playTrainer", handUid: card.uid });
        }
      }
    }

    for (const { ref, pokemon } of this.allInPlay(this.current)) {
      const power = pokemon.def.power;
      if (!power?.usable) continue;
      if (power.oncePerTurn && pokemon.powerUsedTurn === this.turnNumber) continue;
      if (power.requiresActive && ref.slot !== "active") continue;
      if (pokemon.condition || pokemon.poisonCounters > 0 || pokemon.burned) continue;
      if (this.powerHasValidUse(power.effects ?? [], ref))
        actions.push({ type: "usePower", target: ref });
    }

    const active = me.active;
    if (active) {
      const activeRef: SlotRef = { p: this.current, slot: "active" };
      const canRetreat =
        me.retreatedTurn !== this.turnNumber &&
        me.bench.length > 0 &&
        active.condition !== "asleep" &&
        active.condition !== "paralyzed" &&
        !this.locked(active, "retreat") &&
        this.totalEnergyUnits(active, this.current) >=
          this.effectiveRetreatCost(activeRef, active);
      if (canRetreat)
        me.bench.forEach((_, i) => actions.push({ type: "retreat", benchIndex: i }));

      if (
        active.condition !== "asleep" &&
        active.condition !== "paralyzed" &&
        !this.locked(active, "attack")
      ) {
        active.def.attacks.forEach((attack, i) => {
          if (this.canPayCost(attack.cost, active, this.current))
            actions.push({ type: "attack", index: i });
        });
      }
    }

    actions.push({ type: "pass" });
    return actions;
  }

  describeAction(action: Action): string {
    const me = this.players[this.current];
    const handCard = (uid: number) => me.hand.find((c) => c.uid === uid)?.def.name ?? "?";
    switch (action.type) {
      case "playBasic":    return `Play ${handCard(action.handUid)} to Bench`;
      case "evolve":       return `Evolve ${this.describeSlot(action.target)} into ${handCard(action.handUid)}`;
      case "attachEnergy": return `Attach ${handCard(action.handUid)} to ${this.describeSlot(action.target)}`;
      case "playTrainer":  return `Play ${handCard(action.handUid)}`;
      case "playStadium":  return `Play Stadium ${handCard(action.handUid)}`;
      case "playTool":     return `Attach ${handCard(action.handUid)} to ${this.describeSlot(action.target)}`;
      case "usePower": {
        const pokemon = this.getPokemon(action.target);
        return `Use ${pokemon?.def.power?.name} (${pokemon?.def.name})`;
      }
      case "retreat":      return `Retreat into ${me.bench[action.benchIndex]?.def.name}`;
      case "attack":       return `Attack: ${me.active?.def.attacks[action.index]?.name}`;
      case "pass":         return "End Turn";
    }
  }

  perform(action: Action): void {
    if (this.phase !== "playing" || this.pending) return;
    const me = this.players[this.current];
    switch (action.type) {
      case "playBasic": {
        const card = this.takeFromHand(me, action.handUid);
        if (!card) return;
        me.bench.push(makePokemonInPlay(card, this.turnNumber));
        this.addLog(`${me.name} benches ${card.def.name}`, "bench", {
          player: this.current,
          uid: card.uid,
        });
        const power = (card.def as PokemonCardDef).power;
        if (power?.trigger === "onPlayFromHand" && power.effects) {
          this.addLog(`${power.name} triggers!`, "power", { player: this.current, uid: card.uid });
          this.queueEffectsFor(power.effects, this.current, undefined, false, {
            p: this.current,
            slot: me.bench.length - 1,
          });
        }
        break;
      }
      case "evolve": {
        const card = this.takeFromHand(me, action.handUid);
        const pokemon = this.getPokemon(action.target);
        if (!card || !pokemon) return;
        this.evolvePokemon(pokemon, card);
        this.addLog(`${me.name} evolves into ${card.def.name}`, "evolve", {
          player: this.current,
          uid: card.uid,
        });
        break;
      }
      case "attachEnergy": {
        const card = this.takeFromHand(me, action.handUid);
        const pokemon = this.getPokemon(action.target);
        if (!card || !pokemon) return;
        pokemon.energy.push(card);
        me.attachedEnergyTurn = this.turnNumber;
        this.addLog(`${me.name} attaches ${card.def.name} to ${pokemon.def.name}`, "energy", {
          player: this.current,
          uid: pokemon.card.uid,
        });
        const power = pokemon.def.power;
        if (power?.trigger === "onAttachBasicEnergy" && power.effects && isEnergy(card.def) && card.def.isBasic) {
          const typeMatch = !power.triggerBasicEnergyType || card.def.provides.includes(power.triggerBasicEnergyType);
          if (typeMatch) {
            this.addLog(`${power.name} triggers!`, "power", { player: this.current, uid: pokemon.card.uid });
            this.queueEffectsFor(power.effects, this.current, undefined, false, action.target);
          }
        }
        break;
      }
      case "playTrainer": {
        const card = this.takeFromHand(me, action.handUid);
        if (!card || !isTrainer(card.def)) return;
        me.discard.push(card);
        if (card.def.kind === "Supporter") me.supporterTurn = this.turnNumber;
        this.addLog(`${me.name} plays ${card.def.name}`, "trainer", { player: this.current });
        this.queueEffectsFor(card.def.effects, this.current);
        break;
      }
      case "usePower": {
        const pokemon = this.getPokemon(action.target);
        if (!pokemon?.def.power) return;
        pokemon.powerUsedTurn = this.turnNumber;
        this.addLog(`${me.name} uses ${pokemon.def.power.name}`, "power", {
          player: this.current,
          uid: pokemon.card.uid,
        });
        this.queueEffectsFor(
          pokemon.def.power.effects ?? [],
          this.current,
          undefined,
          false,
          action.target
        );
        break;
      }
      case "playStadium": {
        const card = this.takeFromHand(me, action.handUid);
        if (!card || !isTrainer(card.def)) return;
        if (this.stadium) {
          this.players[this.stadium.owner].discard.push(this.stadium.card);
          this.addLog(`${this.stadium.card.def.name} is discarded`, "trainer");
        }
        this.stadium = { card, owner: this.current };
        this.addLog(`${me.name} plays Stadium ${card.def.name}`, "trainer", {
          player: this.current,
        });
        break;
      }
      case "playTool": {
        const card = this.takeFromHand(me, action.handUid);
        const pokemon = this.getPokemon(action.target);
        if (!card || !pokemon || pokemon.tool) return;
        pokemon.tool = card;
        this.addLog(`${me.name} attaches ${card.def.name} to ${pokemon.def.name}`, "trainer", {
          player: this.current,
          uid: pokemon.card.uid,
        });
        break;
      }
      case "retreat": {
        const active = me.active;
        const target = me.bench[action.benchIndex];
        if (!active || !target) return;
        const cost = this.effectiveRetreatCost({ p: this.current, slot: "active" }, active);
        me.retreatedTurn = this.turnNumber;
        const distinctEnergy = new Set(active.energy.map((c) => c.def.id)).size;
        if (cost === 0 || distinctEnergy <= 1) {
          let paid = 0;
          while (paid < cost && active.energy.length > 0) {
            const discarded = active.energy.pop()!;
            paid += this.energyUnits(discarded, active, this.current).count;
            me.discard.push(discarded);
          }
          this.finishRetreat(this.current, active.card.uid, target.card.uid);
        } else {
          this.retreatDiscardChoice(this.current, active, cost, target.card.uid);
        }
        break;
      }
      case "attack":
        this.executeAttack(action.index);
        break;
      case "pass":
        this.addLog(`${me.name} ends their turn`, "turn", { player: this.current });
        this.turnEnding = true;
        break;
    }
    this.revision++;
    this.drain();
  }

  resolvePending(optionIndex: number): void {
    const pending = this.pending;
    if (!pending) return;
    const option = pending.options[optionIndex];
    if (!option) return;
    this.pending = null;
    this.operations.unshift(structuredClone(option.operation));
    this.revision++;
    this.drain();
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private makePlayer(name: string, deck: CardDef[]): PlayerState {
    return {
      name,
      deck: deck.map((def) => ({ uid: this.uidCounter++, def })),
      hand: [],
      discard: [],
      prizes: [],
      active: null,
      bench: [],
      attachedEnergyTurn: null,
      supporterTurn: null,
      retreatedTurn: null,
      turnsTaken: 0,
    };
  }

  private setup(): void {
    const mulligans = [0, 0];
    for (let p = 0; p < 2; p++) {
      const player = this.players[p];
      shuffle(() => this.rng.next(), player.deck);
      player.hand = player.deck.splice(0, STARTING_HAND);
      while (!player.hand.some((c) => isPokemon(c.def) && c.def.stage === "Basic")) {
        mulligans[p]++;
        player.deck.push(...player.hand.splice(0));
        shuffle(() => this.rng.next(), player.deck);
        player.hand = player.deck.splice(0, STARTING_HAND);
      }
      if (mulligans[p] > 0) this.addLog(`${player.name} mulliganed ${mulligans[p]} time(s)`);
    }
    for (let p = 0; p < 2; p++) {
      const extra = Math.max(0, mulligans[1 - p]);
      if (extra > 0) {
        this.players[p].hand.push(...this.players[p].deck.splice(0, extra));
        this.addLog(`${this.players[p].name} draws ${extra} extra card(s) for mulligans`);
      }
    }
    for (let p = 0; p < 2; p++)
      this.players[p].prizes = this.players[p].deck.splice(0, this.prizeCount);

    const first = this.flipCoin("Opening coin flip") ? 0 : 1;
    this.addLog(`${this.players[first].name} goes first`);
    this.current = 1 - first;
    this.operations.push({ kind: "system", operation: { op: "chooseStartingActive", player: first } });
    this.operations.push({ kind: "system", operation: { op: "chooseStartingActive", player: 1 - first } });
    this.turnStarting = true;
    this.drain();
  }

  private chooseStartingActive(p: number): void {
    const player = this.players[p];
    const basics = player.hand.filter((c) => isPokemon(c.def) && c.def.stage === "Basic");
    if (basics.length === 1) { this.placeStartingActive(p, basics[0].uid); return; }
    this.requestChoice(
      p,
      "Choose your starting Active Pokemon",
      basics.map((card) => {
        const def = card.def as PokemonCardDef;
        return {
          label: `${def.name} (${def.hp} HP)`,
          informationKey: `starting:${card.def.id}`,
          aiScore: pokemonBattleScore(this, makePokemonInPlay(card, 0), p, true),
          operation: { kind: "system", operation: { op: "placeStartingActive", player: p, cardUid: card.uid } },
        };
      })
    );
  }

  private placeStartingActive(p: number, cardUid: number): void {
    const player = this.players[p];
    const card = player.hand.find((candidate) => candidate.uid === cardUid);
    if (!card || !isPokemon(card.def) || card.def.stage !== "Basic") return;
    player.hand = player.hand.filter((candidate) => candidate.uid !== cardUid);
    player.active = makePokemonInPlay(card, 0);
    const rest = player.hand
      .filter((candidate) => isPokemon(candidate.def) && candidate.def.stage === "Basic")
      .slice(0, BENCH_LIMIT);
    for (const benchCard of rest) {
      player.hand = player.hand.filter((candidate) => candidate.uid !== benchCard.uid);
      player.bench.push(makePokemonInPlay(benchCard, 0));
    }
    this.addLog(`${player.name} starts with ${card.def.name}`);
  }

  private addLog(
    message: string,
    cat: EventCat = "info",
    extra: { player?: number; uid?: number; amount?: number } = {}
  ): void {
    this.log.push(message);
    this.events.push({ seq: ++this.eventSeq, cat, text: message, turn: this.turnNumber, ...extra });
  }

  private flipCoin(context: string): boolean {
    const heads = this.rng.next() < 0.5;
    this.addLog(`${context}: ${heads ? "Heads" : "Tails"}`, "coin");
    return heads;
  }

  private drawCards(p: number, count: number): void {
    const player = this.players[p];
    const drawn = Math.min(count, player.deck.length);
    player.hand.push(...player.deck.splice(0, drawn));
    if (drawn > 0) this.addLog(`${player.name} draws ${drawn} card(s)`, "draw", { player: p });
  }

  private takeFromHand(player: PlayerState, uid: number): CardInstance | null {
    const index = player.hand.findIndex((c) => c.uid === uid);
    if (index === -1) return null;
    delete this.knownOpponentHands[0][uid];
    delete this.knownOpponentHands[1][uid];
    return player.hand.splice(index, 1)[0];
  }

  private evolvePokemon(pokemon: PokemonInPlay, card: CardInstance): void {
    pokemon.underneath.push(pokemon.card);
    pokemon.card = card;
    pokemon.def = card.def as PokemonCardDef;
    pokemon.evolvedTurn = this.turnNumber;
    pokemon.condition = null;
    pokemon.poisonCounters = 0;
    pokemon.burned = false;
    pokemon.guard = null;
    pokemon.locks = {};
  }

  private swapActive(p: number, benchIndex: number): void {
    const player = this.players[p];
    const oldActive = player.active;
    const newActive = player.bench[benchIndex];
    if (!oldActive || !newActive) return;
    oldActive.condition = null;
    oldActive.poisonCounters = 0;
    oldActive.burned = false;
    oldActive.guard = null;
    oldActive.locks = {};
    oldActive.attackBoost = null;
    player.bench[benchIndex] = oldActive;
    player.active = newActive;
  }

  private requestChoice(player: number, prompt: string, options: ChoiceOption[]): void {
    if (options.length === 0) return;
    const id = `choice:${this.turnNumber}:${++this.choiceSeq}`;
    this.pending = {
      id,
      player,
      prompt,
      options: options.map((option, index) => ({ ...option, id: option.id ?? `option:${index}` })),
    };
  }

  private clonePending(pending: PendingChoice): PendingChoice {
    return {
      id: pending.id,
      player: pending.player,
      prompt: pending.prompt,
      options: pending.options.map((option) => ({
        ...option,
        operation: structuredClone(option.operation),
      })),
    };
  }

  private actionInformationKey(action: Action): string {
    const semantic: Record<string, unknown> = { ...action };
    if ("handUid" in action) {
      semantic.cardId = this.players[this.current].hand
        .find((card) => card.uid === action.handUid)?.def.id ?? action.handUid;
      delete semantic.handUid;
    }
    if ("target" in action) {
      semantic.targetUid = this.getPokemon(action.target)?.card.uid ?? action.target;
      delete semantic.target;
    }
    if (action.type === "retreat") {
      semantic.targetUid = this.players[this.current].bench[action.benchIndex]?.card.uid ?? action.benchIndex;
      delete semantic.benchIndex;
    }
    return JSON.stringify(semantic);
  }

  private rareCandyPairs(
    p: number
  ): Array<{ ref: SlotRef; pokemon: PokemonInPlay; stage2: CardInstance }> {
    const player = this.players[p];
    const pairs: Array<{ ref: SlotRef; pokemon: PokemonInPlay; stage2: CardInstance }> = [];
    for (const { ref, pokemon } of this.allInPlay(p)) {
      if (pokemon.def.stage !== "Basic") continue;
      for (const card of player.hand) {
        const stage2Def = card.def;
        if (!isPokemon(stage2Def) || stage2Def.stage !== "Stage2" || !stage2Def.evolvesFrom)
          continue;
        const middle = Object.values(this.library).find(
          (def) =>
            isPokemon(def) &&
            def.name === stage2Def.evolvesFrom &&
            def.evolvesFrom === pokemon.def.name
        );
        if (middle) pairs.push({ ref, pokemon, stage2: card });
      }
    }
    return pairs;
  }

  private stadiumsBlockedByOpponent(): boolean {
    const oppActive = this.players[1 - this.current].active;
    return (
      oppActive?.def.power?.kind === "Poke-Body" &&
      !!oppActive.def.power.modifiers?.some((m) => m.kind === "blockOpponentStadium")
    );
  }

  private supportersBlockedByOpponent(): boolean {
    const oppActive = this.players[1 - this.current].active;
    return (
      oppActive?.def.power?.kind === "Poke-Body" &&
      !!oppActive.def.power.modifiers?.some((m) => m.kind === "blockOpponentSupporter")
    );
  }

  private trainerRestrictionOk(def: TrainerCardDef): boolean {
    const restriction = def.restriction;
    if (!restriction) return true;
    const me = this.players[this.current];
    if (restriction.maxHandSize !== undefined && me.hand.length > restriction.maxHandSize) return false;
    if (restriction.behindOnPrizes && me.prizes.length <= this.players[1 - this.current].prizes.length) return false;
    return true;
  }

  private trainerCanPlay(def: TrainerCardDef): boolean {
    if (def.effects.length === 0) return false;
    const context = this.makeContext(this.current);
    return def.effects.every((effect) => effectCanApply(effect, context));
  }

  private powerHasValidUse(effects: Effect[], sourceRef: SlotRef): boolean {
    if (effects.length === 0) return false;
    const context = this.makeContext(this.current, undefined, false, sourceRef);
    return effects.every((effect) => effectCanApply(effect, context));
  }

  getEffectAiValue(effect: Effect, controller: number): number {
    return effectAiValue(effect, this.makeContext(controller));
  }

  getEffectsAiValue(effects: Effect[], controller: number, sourceRef?: SlotRef): number {
    const context = this.makeContext(controller, undefined, false, sourceRef);
    return effects.reduce((total, effect) => total + effectAiValue(effect, context), 0);
  }

  private locked(pokemon: PokemonInPlay, what: "attack" | "retreat"): boolean {
    const until = pokemon.locks[what];
    return until !== undefined && this.turnNumber <= until;
  }

  // ── Effect context factory ───────────────────────────────────────────────

  private makeContext(
    controller: number,
    attackerTypes?: EnergyType[],
    fromAttack?: boolean,
    sourceRef?: SlotRef,
    attackId?: number
  ): EffectContext {
    const game = this;
    const sourceUid = sourceRef ? this.getPokemon(sourceRef)?.card.uid : undefined;
    const frame: EffectFrame = { controller, attackerTypes, fromAttack, sourceUid, attackId };
    return {
      controller,
      opponent: 1 - controller,
      attackerTypes,
      fromAttack,
      sourceRef,
      frame,
      get players(): [PlayerState, PlayerState] { return game.players; },
      get turnNumber(): number { return game.turnNumber; },
      getPokemon: (ref) => game.getPokemon(ref),
      allInPlay: (p) => game.allInPlay(p),
      describeSlot: (ref) => game.describeSlot(ref),
      targetRefs: (target) => game.targetRefs(target, frame),
      energyUnits: (card, holder, ownerIndex) =>
        game.energyUnits(card, holder, ownerIndex),
      effectiveHp: (ref, pokemon) => game.effectiveHp(ref, pokemon),
      conditionsPrevented: (ref) =>
        conditionsPrevented(game.players, ref, game.stadium),
      matchesFilter: (def, filter) => matchesFilter(def, filter),
      rareCandyPairs: (p) => game.rareCandyPairs(p),
      findStage2Middle: (stage2Def, basicName) =>
        !!Object.values(game.library).find(
          (def) =>
            isPokemon(def) &&
            def.name === stage2Def.evolvesFrom &&
            def.evolvesFrom === basicName
        ),
      drawCards: (p, count) => game.drawCards(p, count),
      revealInHand: (owner, card) => {
        game.knownOpponentHands[1 - owner][card.uid] = card.def.id;
      },
      forgetHand: (owner) => {
        game.knownOpponentHands[1 - owner] = {};
      },
      forgetKnownCard: (uid) => {
        delete game.knownOpponentHands[0][uid];
        delete game.knownOpponentHands[1][uid];
      },
      shuffleDeck: (p) => shuffle(() => game.rng.next(), game.players[p].deck),
      swapActive: (p, i) => game.swapActive(p, i),
      evolvePokemon: (pokemon, card) => game.evolvePokemon(pokemon, card),
      takeFromHand: (player, uid) => game.takeFromHand(player, uid),
      dealDamage: (ref, amount, applyWROverride, ignoreResistance, ignoreDefenderEffects) =>
        game.dealAttackDamage(
          ref,
          amount,
          { controller, attackerTypes, fromAttack },
          applyWROverride,
          ignoreResistance,
          ignoreDefenderEffects
        ),
      addAttackDamage: (amount, ignoreResistance) => {
        const attackDamage = attackId === undefined ? undefined : game.attackTotals.get(attackId);
        if (!attackDamage) return false;
        attackDamage.amount += amount;
        if (ignoreResistance) attackDamage.ignoreResistance = true;
        return true;
      },
      currentAttackDamage: () =>
        attackId === undefined ? 0 : (game.attackTotals.get(attackId)?.amount ?? 0),
      log: (msg, cat, extra) => game.addLog(msg, cat, extra),
      flip: (label) => game.flipCoin(label),
      requestChoice: (player, prompt, options) => game.requestChoice(player, prompt, options),
      queueSwitchChoice: (p) => game.queueSwitchChoice(p),
      queueEffects: (effects) =>
        game.queueEffectsFor(effects, frame),
      queueOperation: (operation) => game.operations.unshift(structuredClone(operation)),
      command: (name, payload) => effectCommand(name, payload, frame),
    };
  }

  private queueEffectsFor(
    effects: Effect[],
    controllerOrFrame: number | EffectFrame,
    attackerTypes?: EnergyType[],
    fromAttack?: boolean,
    sourceRef?: SlotRef,
    attackId?: number
  ): void {
    const frame = typeof controllerOrFrame === "number"
      ? {
          controller: controllerOrFrame,
          attackerTypes,
          fromAttack,
          sourceUid: sourceRef ? this.getPokemon(sourceRef)?.card.uid : undefined,
          attackId,
        }
      : controllerOrFrame;
    this.operations.unshift(...effects.map((effect) => effectOperation(effect, frame)));
  }

  private targetRefs(target: import("../model/effects").EffectTarget, frame: EffectFrame): SlotRef[] {
    const controller = frame.controller;
    switch (target) {
      case "defending":
        return [{ p: 1 - controller, slot: "active" }];
      case "self":
        return [this.findPokemonRef(frame.sourceUid) ?? { p: controller, slot: "active" }];
      case "eachOpponentBench":
        return this.players[1 - controller].bench.map((_, i) => ({ p: 1 - controller, slot: i }));
      case "opponentBenchChoice":
      case "anyOpponentChoice":
      case "selfBenchChoice":
      case "anySelfChoice":
      case "anySelfChoiceExceptSelf": {
        const p =
          target === "opponentBenchChoice" || target === "anyOpponentChoice"
            ? 1 - controller
            : controller;
        const refs =
          target === "anySelfChoice" ||
          target === "anySelfChoiceExceptSelf" ||
          target === "anyOpponentChoice"
            ? this.allInPlay(p).map(({ ref }) => ref)
            : this.players[p].bench.map((_, i) => ({
                p,
                slot: i,
              } as SlotRef));
        return target === "anySelfChoiceExceptSelf"
          ? refs.filter((ref) => this.getPokemon(ref)?.card.uid !== frame.sourceUid)
          : refs;
      }
    }
  }

  private findPokemonRef(uid: number | undefined): SlotRef | null {
    if (uid === undefined) return null;
    for (let p = 0; p < 2; p++) {
      for (const { ref, pokemon } of this.allInPlay(p))
        if (pokemon.card.uid === uid) return ref;
    }
    return null;
  }

  // ── Damage pipeline ──────────────────────────────────────────────────────

  private dealAttackDamage(
    ref: SlotRef,
    base: number,
    context: { controller: number; attackerTypes?: EnergyType[]; fromAttack?: boolean },
    applyWROverride?: boolean,
    ignoreResistance?: boolean,
    ignoreDefenderEffects?: boolean
  ): void {
    const target = this.getPokemon(ref);
    if (!target) return;
    let amount = base;
    if (context.fromAttack && amount > 0) {
      const attackerRef: SlotRef = { p: context.controller, slot: "active" };
      const attacker = this.getPokemon(attackerRef);
      if (attacker) {
        amount += modifierSum(this.players, attackerRef, this.stadium, "damagePlus");
        for (const energy of attacker.energy) {
          const eDef = energy.def as EnergyCardDef;
          if (!eDef.damageRider) continue;
          if (eDef.damageRiderType && !attacker.def.types?.includes(eDef.damageRiderType)) continue;
          amount += eDef.damageRider;
        }
        amount = Math.max(0, amount);
      }
    }
    const applyWR = applyWROverride ?? (ref.slot === "active" && ref.p !== context.controller);
    const attackerTypes = context.attackerTypes ?? [];
    if (applyWR && attackerTypes.length > 0 && amount > 0) {
      if (target.def.weakness && attackerTypes.includes(target.def.weakness) && !weaknessNullified(this.players, ref, this.stadium)) {
        amount *= 2;
        this.addLog("It's weak! Damage doubled");
      }
      if (!ignoreResistance && resistancesOf(target.def).some((r) => attackerTypes.includes(r))) {
        amount = Math.max(0, amount - 30);
        this.addLog("Resistance: -30 damage");
      }
    }
    if (context.fromAttack && amount > 0 && !ignoreDefenderEffects) {
      if (target.guard && this.turnNumber <= target.guard.untilTurn) {
        if (target.guard.mode === "preventAll") {
          amount = 0;
          this.addLog(`${target.def.name} prevented all damage`);
        } else {
          amount = Math.max(0, amount - target.guard.amount);
        }
      }
      const attacker = context.fromAttack
        ? this.getPokemon({ p: context.controller, slot: "active" })
        : null;
      const attackerIsBasic = attacker?.def.stage === "Basic";
      const attackerIsEx = attacker?.def.isEx ?? false;
      const reduction = damageMinusSum(this.players, ref, this.stadium, attackerIsBasic, attackerIsEx);
      if (reduction > 0 && amount > 0) amount = Math.max(0, amount - reduction);
    }
    if (amount > 0) {
      target.damage += amount;
      this.addLog(`${target.def.name} takes ${amount} damage`, "damage", {
        uid: target.card.uid,
        amount,
      });
      if (context.fromAttack && ref.slot === "active" && ref.p !== context.controller) {
        const power = target.def.power;
        if (power?.kind === "Poke-Body" && power.trigger === "onDamagedByAttack" && power.effects?.length) {
          this.addLog(`${power.name} triggers!`, "power", { player: ref.p, uid: target.card.uid });
          this.queueEffectsFor(power.effects, ref.p, undefined, false, { p: ref.p, slot: "active" });
        }
      }
    } else if (base > 0) {
      this.addLog(`${target.def.name} takes no damage`, "damage", {
        uid: target.card.uid,
        amount: 0,
      });
    }
  }

  // ── Attack ───────────────────────────────────────────────────────────────

  private executeAttack(index: number): void {
    const me = this.players[this.current];
    const active = me.active;
    if (!active) return;
    const attack = active.def.attacks[index];
    if (!attack) return;
    this.turnEnding = true;
    if (active.condition === "confused") {
      this.addLog(`${active.def.name} is Confused...`, "status", { uid: active.card.uid });
      if (!this.flipCoin("Confusion check")) {
        this.addLog(`${active.def.name} hurt itself in confusion!`, "damage", {
          uid: active.card.uid,
          amount: 30,
        });
        active.damage += 30;
        return;
      }
    }
    this.addLog(`${active.def.name} uses ${attack.name}`, "attack", {
      player: this.current,
      uid: active.card.uid,
    });
    const boost = active.attackBoost;
    const bonus =
      boost &&
      boost.usableTurn === this.turnNumber &&
      (!boost.attackName || boost.attackName === attack.name)
        ? boost.amount
        : 0;
    const attackId = ++this.attackSeq;
    this.attackTotals.set(attackId, {
      amount: (attack.damage ?? 0) + bonus,
      ignoreResistance: attack.ignoreResistance ?? false,
    });
    active.attackBoost = null;
    this.operations.push({ kind: "system", operation: { op: "finishAttackDamage", attackId } });
    this.queueEffectsFor(attack.effects ?? [], this.current, active.def.types, true, {
      p: this.current,
      slot: "active",
    }, attackId);
  }

  // ── Switch choice helper ─────────────────────────────────────────────────

  private queueSwitchChoice(p: number): void {
    this.operations.unshift({ kind: "system", operation: { op: "queueSwitchChoice", player: p } });
  }

  private retreatDiscardChoice(
    p: number,
    active: PokemonInPlay,
    remaining: number,
    targetUid: number
  ): void {
    if (remaining <= 0 || active.energy.length === 0) {
      this.operations.unshift({
        kind: "system",
        operation: { op: "finishRetreat", player: p, activeUid: active.card.uid, targetUid },
      });
      return;
    }
    this.requestChoice(
      p,
      `Discard Energy to retreat (${remaining} more needed)`,
      active.energy.map((card) => ({
        label: card.def.name,
        informationKey: `retreat-energy:${card.def.id}`,
        aiScore: -this.energyUnits(card, active, p).count,
        operation: {
          kind: "system",
          operation: {
            op: "retreatDiscard",
            player: p,
            activeUid: active.card.uid,
            targetUid,
            cardUid: card.uid,
            remaining,
          },
        },
      }))
    );
  }

  // ── Main loop ────────────────────────────────────────────────────────────

  private executeOperation(queued: QueuedOperation): void {
    if (queued.kind === "system") {
      this.executeSystemOperation(queued.operation);
      return;
    }
    const sourceRef = this.findPokemonRef(queued.frame.sourceUid) ?? undefined;
    const context = this.makeContext(
      queued.frame.controller,
      queued.frame.attackerTypes,
      queued.frame.fromAttack,
      sourceRef,
      queued.frame.attackId
    );
    if (queued.kind === "effectCommand") {
      runEffectCommand(queued.command, queued.payload, context);
      return;
    }
    const defender = this.players[1 - queued.frame.controller].active;
    if (
      queued.frame.fromAttack &&
      defender?.guard?.mode === "preventAll" &&
      this.turnNumber <= defender.guard.untilTurn &&
      isEffectDoneToDefendingPokemon(queued.effect)
    ) {
      this.addLog(`${defender.def.name} prevented an effect of the attack`);
      return;
    }
    runEffect(queued.effect, context);
  }

  private executeSystemOperation(operation: SystemOperation): void {
    switch (operation.op) {
      case "chooseStartingActive":
        this.chooseStartingActive(operation.player);
        return;
      case "placeStartingActive":
        this.placeStartingActive(operation.player, operation.cardUid);
        return;
      case "finishAttackDamage": {
        const total = this.attackTotals.get(operation.attackId);
        if (!total) return;
        this.attackTotals.delete(operation.attackId);
        const controller = this.current;
        const attacker = this.players[controller].active;
        if (total.amount > 0 && attacker)
          this.dealAttackDamage(
            { p: 1 - controller, slot: "active" }, total.amount,
            { controller, attackerTypes: attacker.def.types, fromAttack: true },
            undefined, total.ignoreResistance
          );
        return;
      }
      case "queueSwitchChoice": {
        const player = this.players[operation.player];
        if (!player.active || player.bench.length === 0) return;
        if (player.bench.length === 1) {
          this.switchPokemon(operation.player, player.bench[0].card.uid);
          return;
        }
        this.requestChoice(
          operation.player,
          "Switch to which Pokemon?",
          player.bench.map((pokemon) => ({
            label: this.describeSlot(this.findPokemonRef(pokemon.card.uid)!),
            informationKey: `switch:${pokemon.card.uid}`,
            aiScore: pokemonBattleScore(this, pokemon, operation.player, true),
            operation: {
              kind: "system",
              operation: { op: "switchPokemon", player: operation.player, pokemonUid: pokemon.card.uid },
            },
          }))
        );
        return;
      }
      case "switchPokemon":
        this.switchPokemon(operation.player, operation.pokemonUid);
        return;
      case "retreatDiscard": {
        const ref = this.findPokemonRef(operation.activeUid);
        const active = ref ? this.getPokemon(ref) : null;
        if (!active) return;
        const index = active.energy.findIndex((card) => card.uid === operation.cardUid);
        if (index === -1) return;
        const discarded = active.energy.splice(index, 1)[0];
        this.players[operation.player].discard.push(discarded);
        const units = this.energyUnits(discarded, active, operation.player).count;
        this.retreatDiscardChoice(
          operation.player, active, operation.remaining - units, operation.targetUid
        );
        return;
      }
      case "finishRetreat":
        this.finishRetreat(operation.player, operation.activeUid, operation.targetUid);
        return;
      case "promotePokemon": {
        const player = this.players[operation.player];
        const index = player.bench.findIndex((pokemon) => pokemon.card.uid === operation.pokemonUid);
        if (index < 0 || player.active) return;
        const promoted = player.bench.splice(index, 1)[0];
        player.active = promoted;
        this.addLog(`${player.name} promotes ${promoted.def.name}`, "switch", {
          player: operation.player,
          uid: promoted.card.uid,
        });
        return;
      }
      case "targetEffect":
        this.applyTargetEffect(operation.effect, operation.targetUid, operation.frame);
        return;
    }
  }

  private switchPokemon(p: number, pokemonUid: number): void {
    const player = this.players[p];
    const index = player.bench.findIndex((pokemon) => pokemon.card.uid === pokemonUid);
    if (index < 0) return;
    const target = player.bench[index];
    this.swapActive(p, index);
    this.addLog(`${player.name} switches to ${target.def.name}`, "switch", {
      player: p,
      uid: target.card.uid,
    });
  }

  private finishRetreat(p: number, activeUid: number, targetUid: number): void {
    const player = this.players[p];
    if (player.active?.card.uid !== activeUid) return;
    const index = player.bench.findIndex((pokemon) => pokemon.card.uid === targetUid);
    if (index < 0) return;
    const activeName = player.active.def.name;
    const targetName = player.bench[index].def.name;
    this.swapActive(p, index);
    this.addLog(`${player.name} retreats ${activeName} for ${targetName}`, "switch", {
      player: p,
      uid: targetUid,
    });
  }

  private applyTargetEffect(effect: Effect, targetUid: number, frame: EffectFrame): void {
    const ref = this.findPokemonRef(targetUid);
    const target = ref ? this.getPokemon(ref) : null;
    if (!ref || !target) return;
    const context = this.makeContext(
      frame.controller, frame.attackerTypes, frame.fromAttack,
      this.findPokemonRef(frame.sourceUid) ?? undefined, frame.attackId
    );
    if (effect.op === "damage") {
      if (
        effect.applyWR !== false && ref.p === context.opponent && ref.slot === "active" &&
        context.addAttackDamage(effect.amount, effect.ignoreResistance)
      ) return;
      context.dealDamage(ref, effect.amount, effect.applyWR, effect.ignoreResistance, effect.ignoreDefenderEffects);
    } else if (effect.op === "damageCounters") {
      target.damage += effect.count * 10;
      this.addLog(`${target.def.name} gets ${effect.count} damage counter(s)`, "damage", {
        uid: target.card.uid,
        amount: effect.count * 10,
      });
    }
  }

  private drain(): void {
    let guard = 0;
    while (guard++ < 10000) {
      if (this.phase !== "playing") break;
      if (this.pending) break;
      if (this.operations.length > 0) {
        const operation = this.operations.shift()!;
        this.executeOperation(operation);
        continue;
      }
      if (this.processKnockouts()) continue;
      if (this.ensureActives()) continue;
      if (this.checkWinner()) break;
      if (this.turnEnding) {
        this.turnEnding = false;
        this.turnStarting = true;
        this.betweenTurns();
        continue;
      }
      if (this.turnStarting) {
        this.turnStarting = false;
        this.startTurn();
        continue;
      }
      break;
    }
    this.onChange();
  }

  private processKnockouts(): boolean {
    let any = false;
    for (let p = 0; p < 2; p++) {
      const player = this.players[p];
      const knocked = this.allInPlay(p).filter(
        ({ ref, pokemon }) => pokemon.damage >= this.effectiveHp(ref, pokemon)
      );
      for (const { pokemon } of knocked) {
        any = true;
        this.addLog(`${pokemon.def.name} is Knocked Out!`, "ko", {
          player: p,
          uid: pokemon.card.uid,
        });
        player.discard.push(pokemon.card, ...pokemon.underneath, ...pokemon.energy);
        if (pokemon.tool) player.discard.push(pokemon.tool);
        if (player.active === pokemon) player.active = null;
        player.bench = player.bench.filter((b) => b !== pokemon);
        const prizeTaker = this.players[1 - p];
        const prizeCount = pokemon.def.isEx ? 2 : 1;
        for (let i = 0; i < prizeCount && prizeTaker.prizes.length > 0; i++)
          prizeTaker.hand.push(prizeTaker.prizes.pop()!);
        this.addLog(
          `${prizeTaker.name} takes ${prizeCount} prize card(s)${pokemon.def.isEx ? " (Pokemon-ex!)" : ""}`,
          "prize",
          { player: 1 - p, amount: prizeCount }
        );
      }
    }
    return any;
  }

  private ensureActives(): boolean {
    for (let p = 0; p < 2; p++) {
      const player = this.players[p];
      if (player.active || player.bench.length === 0) continue;
      if (player.bench.length === 1) {
        player.active = player.bench.pop()!;
        this.addLog(`${player.name} promotes ${player.active.def.name}`, "switch", {
          player: p,
          uid: player.active.card.uid,
        });
        return true;
      }
      this.requestChoice(
        p,
        "Promote which Pokemon to Active?",
        player.bench.map((pokemon) => ({
          label: `${pokemon.def.name} (${pokemon.def.hp - pokemon.damage} HP left)`,
          informationKey: `promote:${pokemon.card.uid}`,
          aiScore: pokemonBattleScore(this, pokemon, p, true),
          operation: { kind: "system", operation: { op: "promotePokemon", player: p, pokemonUid: pokemon.card.uid } },
        }))
      );
      return true;
    }
    return false;
  }

  private checkWinner(): boolean {
    if (this.phase !== "playing") return true;
    const reasons: (string | null)[] = [null, null];
    for (let p = 0; p < 2; p++) {
      const player = this.players[p];
      const opp = this.players[1 - p];
      if (player.prizes.length === 0)
        reasons[p] = `${player.name} took all their prize cards`;
      else if (!opp.active && opp.bench.length === 0)
        reasons[p] = `${opp.name} has no Pokemon left in play`;
    }
    if (reasons[0] && reasons[1]) {
      this.phase = "finished";
      this.suddenDeath = true;
      this.winReason = "Both players met a win condition at the same time — Sudden Death!";
      this.addLog(this.winReason, "win");
      return true;
    }
    for (let p = 0; p < 2; p++)
      if (reasons[p]) return this.declareWinner(p, reasons[p]!);
    return false;
  }

  private declareWinner(p: number, reason: string): boolean {
    this.phase = "finished";
    this.winner = p;
    this.winReason = reason;
    this.addLog(`${this.players[p].name} wins! ${reason}`, "win", { player: p });
    return true;
  }

  private betweenTurns(): void {
    const order = [this.current, 1 - this.current];
    for (const p of order) {
      const active = this.players[p].active;
      if (!active) continue;
      if (active.poisonCounters > 0) {
        const poisonDmg = active.poisonCounters * 10;
        active.damage += poisonDmg;
        this.addLog(`${active.def.name} takes ${poisonDmg} poison damage`, "damage", {
          uid: active.card.uid,
          amount: poisonDmg,
        });
      }
      if (active.burned) {
        if (!this.flipCoin(`Burn check for ${active.def.name}`)) {
          const burnDamage = Math.max(
            20,
            modifierMax(this.players, { p, slot: "active" }, this.stadium, "burnDamage")
          );
          active.damage += burnDamage;
          this.addLog(`${active.def.name} takes ${burnDamage} burn damage`, "damage", {
            uid: active.card.uid,
            amount: burnDamage,
          });
        }
      }
      if (active.condition === "asleep") {
        if (this.flipCoin(`Sleep check for ${active.def.name}`)) {
          active.condition = null;
          this.addLog(`${active.def.name} wakes up`, "status", { uid: active.card.uid });
        }
      }
      if (active.condition === "paralyzed" && p === this.current) {
        active.condition = null;
        this.addLog(`${active.def.name} is no longer Paralyzed`, "status", {
          uid: active.card.uid,
        });
      }
    }
  }

  private startTurn(): void {
    this.current = 1 - this.current;
    this.turnNumber++;
    const me = this.players[this.current];
    me.turnsTaken++;
    this.addLog(`— Turn ${this.turnNumber}: ${me.name} —`, "turn", { player: this.current });
    if (me.deck.length === 0) {
      this.declareWinner(1 - this.current, `${me.name} cannot draw a card`);
      return;
    }
    this.drawCards(this.current, 1);
  }
}
