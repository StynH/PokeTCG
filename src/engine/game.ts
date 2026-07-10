import type { CardDef, CardInstance, EnergyCardDef, PokemonCardDef, TrainerCardDef } from "../model/cards";
import { isEnergy, isPokemon, isTrainer, resistancesOf } from "../model/cards";
import type { CardLibrary } from "../model/cards";
import type { Effect } from "../model/effects";
import type { EnergyType } from "../model/energy";
import { SeededRng, shuffle } from "../core/rng";
import type { EventCat, GameEvent } from "../core/events";
import type { ChoiceOption, PendingChoice } from "../core/choice";
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
import { runEffect, effectCanApply, effectAiValue } from "../effects/registry";
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
  private thunks: Array<() => void> = [];
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
    clone.pending = null;
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
    clone.thunks = [];
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
    if (this.pending || this.thunks.length > 0)
      throw new Error("Game snapshots require a stable decision point");
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
    };
  }

  static fromSnapshot(snapshot: GameSnapshot, library: CardLibrary): Game {
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
    game.pending = null;
    game.onChange = () => {};
    game.revision = snapshot.revision;
    game.library = library;
    game.rng = new SeededRng(snapshot.rngState);
    game.eventSeq = snapshot.eventSeq;
    game.choiceSeq = 0;
    game.uidCounter = snapshot.uidCounter;
    game.thunks = [];
    game.turnEnding = false;
    game.turnStarting = false;
    game.prizeCount = snapshot.prizeCount;
    return game;
  }

  getInformationState(observer: number): InformationState {
    const snapshot = this.toSnapshot();
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
        if (def.kind === "Supporter" && me.supporterTurn === this.turnNumber) continue;
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
        const finish = () => {
          this.swapActive(this.current, action.benchIndex);
          this.addLog(
            `${me.name} retreats ${active.def.name} for ${target.def.name}`,
            "switch",
            { player: this.current, uid: target.card.uid }
          );
        };
        if (cost === 0 || distinctEnergy <= 1) {
          let paid = 0;
          while (paid < cost && active.energy.length > 0) {
            const discarded = active.energy.pop()!;
            paid += this.energyUnits(discarded, active, this.current).count;
            me.discard.push(discarded);
          }
          finish();
        } else {
          this.retreatDiscardChoice(this.current, active, cost, finish);
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
    option.apply();
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
    this.thunks.push(() => this.chooseStartingActive(first));
    this.thunks.push(() => this.chooseStartingActive(1 - first));
    this.turnStarting = true;
    this.drain();
  }

  private chooseStartingActive(p: number): void {
    const player = this.players[p];
    const basics = player.hand.filter((c) => isPokemon(c.def) && c.def.stage === "Basic");
    const place = (card: CardInstance) => {
      player.hand = player.hand.filter((c) => c.uid !== card.uid);
      player.active = makePokemonInPlay(card, 0);
      const rest = player.hand
        .filter((c) => isPokemon(c.def) && c.def.stage === "Basic")
        .slice(0, BENCH_LIMIT);
      for (const benchCard of rest) {
        player.hand = player.hand.filter((c) => c.uid !== benchCard.uid);
        player.bench.push(makePokemonInPlay(benchCard, 0));
      }
      this.addLog(`${player.name} starts with ${card.def.name}`);
    };
    if (basics.length === 1) { place(basics[0]); return; }
    this.requestChoice(
      p,
      "Choose your starting Active Pokemon",
      basics.map((card) => {
        const def = card.def as PokemonCardDef;
        return {
          label: `${def.name} (${def.hp} HP)`,
          aiScore: pokemonBattleScore(this, makePokemonInPlay(card, 0), p, true),
          apply: () => place(card),
        };
      })
    );
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
    attackDamage?: AttackDamageTotal
  ): EffectContext {
    const game = this;
    return {
      controller,
      opponent: 1 - controller,
      attackerTypes,
      fromAttack,
      sourceRef,
      get players(): [PlayerState, PlayerState] { return game.players; },
      get turnNumber(): number { return game.turnNumber; },
      getPokemon: (ref) => game.getPokemon(ref),
      allInPlay: (p) => game.allInPlay(p),
      describeSlot: (ref) => game.describeSlot(ref),
      forEachTarget: (target, prompt, fn) =>
        game.forEachTarget(target, controller, prompt, fn, sourceRef),
      energyUnits: (card, holder, ownerIndex) =>
        game.energyUnits(card, holder, ownerIndex),
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
        if (!attackDamage) return false;
        attackDamage.amount += amount;
        if (ignoreResistance) attackDamage.ignoreResistance = true;
        return true;
      },
      log: (msg, cat, extra) => game.addLog(msg, cat, extra),
      flip: (label) => game.flipCoin(label),
      requestChoice: (player, prompt, options) => game.requestChoice(player, prompt, options),
      queueSwitchChoice: (p) => game.queueSwitchChoice(p),
      queueEffects: (effects) =>
        game.queueEffectsFor(effects, controller, attackerTypes, fromAttack, sourceRef, attackDamage),
      queueThunk: (fn) => game.thunks.unshift(fn),
    };
  }

  private queueEffectsFor(
    effects: Effect[],
    controller: number,
    attackerTypes?: EnergyType[],
    fromAttack?: boolean,
    sourceRef?: SlotRef,
    attackDamage?: AttackDamageTotal
  ): void {
    const ctx = this.makeContext(controller, attackerTypes, fromAttack, sourceRef, attackDamage);
    const thunks = effects.map((effect) => () => {
      const defender = this.players[1 - controller].active;
      if (
        fromAttack &&
        defender?.guard?.mode === "preventAll" &&
        this.turnNumber <= defender.guard.untilTurn &&
        isEffectDoneToDefendingPokemon(effect)
      ) {
        this.addLog(`${defender.def.name} prevented an effect of the attack`);
        return;
      }
      runEffect(effect, ctx);
    });
    this.thunks.unshift(...thunks);
  }

  private forEachTarget(
    target: import("../model/effects").EffectTarget,
    controller: number,
    prompt: string,
    handler: (ref: SlotRef) => void,
    sourceRef?: SlotRef
  ): void {
    switch (target) {
      case "defending":
        handler({ p: 1 - controller, slot: "active" });
        return;
      case "self":
        handler(sourceRef ?? { p: controller, slot: "active" });
        return;
      case "eachOpponentBench":
        this.players[1 - controller].bench.forEach((_, i) =>
          handler({ p: 1 - controller, slot: i })
        );
        return;
      case "opponentBenchChoice":
      case "anyOpponentChoice":
      case "selfBenchChoice":
      case "anySelfChoice": {
        const p =
          target === "opponentBenchChoice" || target === "anyOpponentChoice"
            ? 1 - controller
            : controller;
        const opposing = p !== controller;
        const candidates =
          target === "anySelfChoice" || target === "anyOpponentChoice"
            ? this.allInPlay(p)
            : this.players[p].bench.map((pokemon, i) => ({
                ref: { p, slot: i } as SlotRef,
                pokemon,
              }));
        if (candidates.length === 0) return;
        if (candidates.length === 1) { handler(candidates[0].ref); return; }
        this.requestChoice(
          controller,
          `${prompt}:`,
          candidates.map(({ ref, pokemon }) => ({
            label: this.describeSlot(ref),
            aiScore: opposing ? pokemon.damage + 10 : pokemon.damage,
            apply: () => handler(ref),
          }))
        );
        return;
      }
    }
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
      const reduction = damageMinusSum(this.players, ref, this.stadium, attackerIsBasic);
      if (reduction > 0 && amount > 0) amount = Math.max(0, amount - reduction);
    }
    if (amount > 0) {
      target.damage += amount;
      this.addLog(`${target.def.name} takes ${amount} damage`, "damage", {
        uid: target.card.uid,
        amount,
      });
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
    const attackDamage: AttackDamageTotal = {
      amount: (attack.damage ?? 0) + bonus,
      ignoreResistance: attack.ignoreResistance ?? false,
    };
    active.attackBoost = null;
    this.thunks.push(() => {
      if (attackDamage.amount > 0) {
        this.dealAttackDamage(
          { p: 1 - this.current, slot: "active" },
          attackDamage.amount,
          { controller: this.current, attackerTypes: active.def.types, fromAttack: true },
          undefined,
          attackDamage.ignoreResistance
        );
      }
    });
    this.queueEffectsFor(attack.effects ?? [], this.current, active.def.types, true, {
      p: this.current,
      slot: "active",
    }, attackDamage);
  }

  // ── Switch choice helper ─────────────────────────────────────────────────

  private queueSwitchChoice(p: number): void {
    this.thunks.unshift(() => {
      const player = this.players[p];
      if (!player.active || player.bench.length === 0) return;
      if (player.bench.length === 1) {
        const target = player.bench[0];
        this.swapActive(p, 0);
        this.addLog(`${player.name} switches to ${target.def.name}`, "switch", {
          player: p,
          uid: target.card.uid,
        });
        return;
      }
      this.requestChoice(
        p,
        "Switch to which Pokemon?",
        player.bench.map((pokemon, i) => ({
          label: pokemon.def.name,
          aiScore: pokemonBattleScore(this, pokemon, p, true),
          apply: () => {
            this.swapActive(p, i);
            this.addLog(`${player.name} switches to ${pokemon.def.name}`, "switch", {
              player: p,
              uid: pokemon.card.uid,
            });
          },
        }))
      );
    });
  }

  private retreatDiscardChoice(
    p: number,
    active: PokemonInPlay,
    remaining: number,
    finish: () => void
  ): void {
    if (remaining <= 0 || active.energy.length === 0) { finish(); return; }
    this.requestChoice(
      p,
      `Discard Energy to retreat (${remaining} more needed)`,
      active.energy.map((card) => ({
        label: card.def.name,
        aiScore: -this.energyUnits(card, active, p).count,
        apply: () => {
          const index = active.energy.findIndex((c) => c.uid === card.uid);
          if (index === -1) return;
          const discarded = active.energy.splice(index, 1)[0];
          this.players[p].discard.push(discarded);
          const units = this.energyUnits(discarded, active, p).count;
          this.thunks.unshift(() =>
            this.retreatDiscardChoice(p, active, remaining - units, finish)
          );
        },
      }))
    );
  }

  // ── Main loop ────────────────────────────────────────────────────────────

  private drain(): void {
    let guard = 0;
    while (guard++ < 10000) {
      if (this.phase !== "playing") break;
      if (this.pending) break;
      if (this.thunks.length > 0) {
        const thunk = this.thunks.shift()!;
        thunk();
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
        player.bench.map((pokemon, i) => ({
          label: `${pokemon.def.name} (${pokemon.def.hp - pokemon.damage} HP left)`,
          aiScore: pokemonBattleScore(this, pokemon, p, true),
          apply: () => {
            const promoted = player.bench.splice(i, 1)[0];
            player.active = promoted;
            this.addLog(`${player.name} promotes ${promoted.def.name}`, "switch", {
              player: p,
              uid: promoted.card.uid,
            });
          },
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
