import type {
  CardDef,
  CardFilter,
  CardInstance,
  CardLibrary,
  Condition,
  Effect,
  EffectTarget,
  EnergyCardDef,
  EnergyType,
  Modifier,
  PokemonCardDef,
  TrainerCardDef,
} from "../model/types";
import { isEnergy, isPokemon, isTrainer } from "../model/types";

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

export interface SlotRef {
  p: number;
  slot: "active" | number;
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

export interface ChoiceOption {
  label: string;
  aiScore: number;
  apply: () => void;
}

export interface PendingChoice {
  player: number;
  prompt: string;
  options: ChoiceOption[];
}

export type EventCat =
  | "turn"
  | "attack"
  | "power"
  | "damage"
  | "ko"
  | "status"
  | "heal"
  | "energy"
  | "evolve"
  | "draw"
  | "prize"
  | "coin"
  | "switch"
  | "trainer"
  | "bench"
  | "win"
  | "info";

export interface GameEvent {
  seq: number;
  cat: EventCat;
  text: string;
  turn: number;
  player?: number;
  uid?: number;
  amount?: number;
}

interface EffectContext {
  controller: number;
  attackerTypes?: EnergyType[];
  fromAttack?: boolean;
}

export type GamePhase = "playing" | "finished";

const BENCH_LIMIT = 5;
export const PRIZE_COUNT = 6;
const STARTING_HAND = 7;
const ALL_TYPES: EnergyType[] = [
  "Grass",
  "Fire",
  "Water",
  "Lightning",
  "Psychic",
  "Fighting",
  "Darkness",
  "Metal",
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Game {
  players: [PlayerState, PlayerState];
  stadium: { card: CardInstance; owner: number } | null = null;
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

  private library: CardLibrary;
  private rng: () => number;
  private eventSeq = 0;
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
    this.rng = mulberry32(seed);
    this.prizeCount = prizeCount;
    this.players = [this.makePlayer(names[0], deckA), this.makePlayer(names[1], deckB)];
    if (prizeCount < PRIZE_COUNT) this.addLog(`Sudden Death! First prize wins (${prizeCount} prize each)`);
    this.setup();
  }

  cloneForSimulation(seed: number): Game {
    const clone: Game = Object.create(Game.prototype);
    clone.players = [this.clonePlayer(this.players[0]), this.clonePlayer(this.players[1])];
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
    clone.rng = mulberry32(seed);
    clone.eventSeq = 0;
    clone.uidCounter = this.uidCounter;
    clone.thunks = [];
    clone.turnEnding = false;
    clone.turnStarting = false;
    clone.prizeCount = this.prizeCount;
    clone.suddenDeath = this.suddenDeath;
    clone.shuffle(clone.players[0].deck);
    clone.shuffle(clone.players[1].deck);
    return clone;
  }

  private clonePokemon(pokemon: PokemonInPlay): PokemonInPlay {
    return {
      ...pokemon,
      energy: [...pokemon.energy],
      underneath: [...pokemon.underneath],
      guard: pokemon.guard ? { ...pokemon.guard } : null,
      locks: { ...pokemon.locks },
    };
  }

  private clonePlayer(player: PlayerState): PlayerState {
    return {
      ...player,
      deck: [...player.deck],
      hand: [...player.hand],
      discard: [...player.discard],
      prizes: [...player.prizes],
      active: player.active ? this.clonePokemon(player.active) : null,
      bench: player.bench.map((pokemon) => this.clonePokemon(pokemon)),
    };
  }

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

  private shuffle(cards: CardInstance[]): void {
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
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
    const heads = this.rng() < 0.5;
    this.addLog(`${context}: ${heads ? "Heads" : "Tails"}`, "coin");
    return heads;
  }

  private setup(): void {
    const mulligans = [0, 0];
    for (let p = 0; p < 2; p++) {
      const player = this.players[p];
      this.shuffle(player.deck);
      player.hand = player.deck.splice(0, STARTING_HAND);
      while (!player.hand.some((c) => isPokemon(c.def) && c.def.stage === "Basic")) {
        mulligans[p]++;
        player.deck.push(...player.hand.splice(0));
        this.shuffle(player.deck);
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
    for (let p = 0; p < 2; p++) {
      this.players[p].prizes = this.players[p].deck.splice(0, this.prizeCount);
    }
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
      player.active = this.intoPlay(card, 0);
      const rest = player.hand.filter((c) => isPokemon(c.def) && c.def.stage === "Basic").slice(0, BENCH_LIMIT);
      for (const benchCard of rest) {
        player.hand = player.hand.filter((c) => c.uid !== benchCard.uid);
        player.bench.push(this.intoPlay(benchCard, 0));
      }
      this.addLog(`${player.name} starts with ${card.def.name}`);
    };
    if (basics.length === 1) {
      place(basics[0]);
      return;
    }
    this.requestChoice(p, "Choose your starting Active Pokemon", basics.map((card) => {
      const def = card.def as PokemonCardDef;
      return {
        label: `${def.name} (${def.hp} HP)`,
        aiScore: def.hp + def.attacks.length * 5,
        apply: () => place(card),
      };
    }));
  }

  private intoPlay(card: CardInstance, turn: number): PokemonInPlay {
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

  getPokemon(ref: SlotRef): PokemonInPlay | null {
    const player = this.players[ref.p];
    return ref.slot === "active" ? player.active : player.bench[ref.slot] ?? null;
  }

  allInPlay(p: number): Array<{ ref: SlotRef; pokemon: PokemonInPlay }> {
    const player = this.players[p];
    const result: Array<{ ref: SlotRef; pokemon: PokemonInPlay }> = [];
    if (player.active) result.push({ ref: { p, slot: "active" }, pokemon: player.active });
    player.bench.forEach((pokemon, i) => result.push({ ref: { p, slot: i }, pokemon }));
    return result;
  }

  describeSlot(ref: SlotRef): string {
    const pokemon = this.getPokemon(ref);
    const where = ref.slot === "active" ? "Active" : `Bench ${(ref.slot as number) + 1}`;
    return pokemon ? `${pokemon.def.name} (${where})` : where;
  }

  energyUnits(card: CardInstance, holder: PokemonInPlay, ownerIndex: number): { provides: EnergyType[]; count: number } {
    const def = card.def;
    if (isPokemon(def) && def.playableAsEnergy) {
      return { provides: [...ALL_TYPES], count: 1 };
    }
    if (!isEnergy(def)) return { provides: [], count: 0 };
    if (def.deltaOnly && !holder.def.isDelta) return { provides: [], count: 0 };
    if (def.scramble) {
      const behind = this.players[ownerIndex].prizes.length > this.players[1 - ownerIndex].prizes.length;
      if (!behind) return { provides: ["Colorless"], count: 1 };
    }
    return { provides: def.provides, count: def.provideCount ?? 1 };
  }

  canPayCost(cost: EnergyType[], holder: PokemonInPlay, ownerIndex: number): boolean {
    const pool = holder.energy.map((card) => this.energyUnits(card, holder, ownerIndex));
    const remaining = pool.map((unit) => unit.count);
    const typed = cost.filter((c) => c !== "Colorless");
    for (const type of typed) {
      let index = pool.findIndex((unit, i) => remaining[i] > 0 && unit.provides.length === 1 && unit.provides[0] === type);
      if (index === -1) index = pool.findIndex((unit, i) => remaining[i] > 0 && unit.provides.includes(type));
      if (index === -1) return false;
      remaining[index]--;
    }
    const leftover = remaining.reduce((sum, count) => sum + count, 0);
    return leftover >= cost.length - typed.length;
  }

  totalEnergyUnits(pokemon: PokemonInPlay, ownerIndex: number): number {
    return pokemon.energy.reduce((sum, card) => sum + this.energyUnits(card, pokemon, ownerIndex).count, 0);
  }

  private modifiersAffecting(ref: SlotRef): Modifier[] {
    const result: Modifier[] = [];
    const collect = (mods: Modifier[] | undefined, sourceOwner: number, isSelf: boolean) => {
      for (const mod of mods ?? []) {
        if (mod.scope === "self" && !isSelf) continue;
        if (mod.scope === "yourPokemon" && sourceOwner !== ref.p) continue;
        result.push(mod);
      }
    };
    for (let p = 0; p < 2; p++) {
      for (const { ref: sourceRef, pokemon } of this.allInPlay(p)) {
        const isSelf = sourceRef.p === ref.p && sourceRef.slot === ref.slot;
        if (pokemon.def.power?.kind === "Poke-Body") collect(pokemon.def.power.modifiers, p, isSelf);
        if (pokemon.tool && isTrainer(pokemon.tool.def)) collect(pokemon.tool.def.modifiers, p, isSelf);
        for (const energy of pokemon.energy) {
          if (isEnergy(energy.def) && energy.def.modifiers) collect(energy.def.modifiers, p, isSelf);
        }
      }
    }
    if (this.stadium && isTrainer(this.stadium.card.def)) {
      collect(this.stadium.card.def.modifiers, this.stadium.owner, false);
    }
    return result;
  }

  private modifierSum(ref: SlotRef, kind: "damagePlus" | "damageMinus" | "retreatDelta" | "hpPlus"): number {
    let total = 0;
    for (const mod of this.modifiersAffecting(ref)) {
      if (mod.kind === kind) total += mod.amount;
    }
    return total;
  }

  private conditionsPrevented(ref: SlotRef): boolean {
    return this.modifiersAffecting(ref).some((mod) => mod.kind === "preventConditions");
  }

  effectiveHp(ref: SlotRef, pokemon: PokemonInPlay): number {
    return pokemon.def.hp + this.modifierSum(ref, "hpPlus");
  }

  effectiveRetreatCost(ref: SlotRef, pokemon: PokemonInPlay): number {
    return Math.max(0, pokemon.def.retreatCost + this.modifierSum(ref, "retreatDelta"));
  }

  private locked(pokemon: PokemonInPlay, what: "attack" | "retreat"): boolean {
    const until = pokemon.locks[what];
    return until !== undefined && this.turnNumber <= until;
  }

  getLegalActions(): Action[] {
    if (this.phase !== "playing" || this.pending) return [];
    const actions: Action[] = [];
    const me = this.players[this.current];
    const isFirstOwnTurn = me.turnsTaken <= 1;

    for (const card of me.hand) {
      const def = card.def;
      if (isPokemon(def)) {
        if (def.stage === "Basic") {
          if (me.bench.length < BENCH_LIMIT) actions.push({ type: "playBasic", handUid: card.uid });
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
          for (const { ref } of this.allInPlay(this.current)) {
            actions.push({ type: "attachEnergy", handUid: card.uid, target: ref });
          }
        }
      } else if (isEnergy(def)) {
        if (me.attachedEnergyTurn !== this.turnNumber) {
          for (const { ref } of this.allInPlay(this.current)) {
            actions.push({ type: "attachEnergy", handUid: card.uid, target: ref });
          }
        }
      } else if (isTrainer(def)) {
        if (def.kind === "Supporter" && me.supporterTurn === this.turnNumber) continue;
        if (!this.trainerRestrictionOk(def)) continue;
        if (def.kind === "Stadium") {
          if (this.stadium?.card.def.name !== def.name) actions.push({ type: "playStadium", handUid: card.uid });
        } else if (def.kind === "Tool") {
          for (const { ref, pokemon } of this.allInPlay(this.current)) {
            if (!pokemon.tool) actions.push({ type: "playTool", handUid: card.uid, target: ref });
          }
        } else if (this.canPlayTrainer(def)) {
          actions.push({ type: "playTrainer", handUid: card.uid });
        }
      }
    }

    for (const { ref, pokemon } of this.allInPlay(this.current)) {
      const power = pokemon.def.power;
      if (!power?.usable) continue;
      if (power.oncePerTurn && pokemon.powerUsedTurn === this.turnNumber) continue;
      if (pokemon.condition) continue;
      if (this.powerHasValidUse(power.effects ?? [])) actions.push({ type: "usePower", target: ref });
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
        this.totalEnergyUnits(active, this.current) >= this.effectiveRetreatCost(activeRef, active);
      if (canRetreat) {
        me.bench.forEach((_, i) => actions.push({ type: "retreat", benchIndex: i }));
      }
      if (active.condition !== "asleep" && active.condition !== "paralyzed" && !this.locked(active, "attack")) {
        active.def.attacks.forEach((attack, i) => {
          if (this.canPayCost(attack.cost, active, this.current)) actions.push({ type: "attack", index: i });
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
      case "playBasic":
        return `Play ${handCard(action.handUid)} to Bench`;
      case "evolve":
        return `Evolve ${this.describeSlot(action.target)} into ${handCard(action.handUid)}`;
      case "attachEnergy":
        return `Attach ${handCard(action.handUid)} to ${this.describeSlot(action.target)}`;
      case "playTrainer":
        return `Play ${handCard(action.handUid)}`;
      case "playStadium":
        return `Play Stadium ${handCard(action.handUid)}`;
      case "playTool":
        return `Attach ${handCard(action.handUid)} to ${this.describeSlot(action.target)}`;
      case "usePower": {
        const pokemon = this.getPokemon(action.target);
        return `Use ${pokemon?.def.power?.name} (${pokemon?.def.name})`;
      }
      case "retreat":
        return `Retreat into ${me.bench[action.benchIndex]?.def.name}`;
      case "attack":
        return `Attack: ${me.active?.def.attacks[action.index]?.name}`;
      case "pass":
        return "End Turn";
    }
  }

  perform(action: Action): void {
    if (this.phase !== "playing" || this.pending) return;
    const me = this.players[this.current];
    switch (action.type) {
      case "playBasic": {
        const card = this.takeFromHand(me, action.handUid);
        if (!card) return;
        me.bench.push(this.intoPlay(card, this.turnNumber));
        this.addLog(`${me.name} benches ${card.def.name}`, "bench", { player: this.current, uid: card.uid });
        const power = (card.def as PokemonCardDef).power;
        if (power?.trigger === "onPlayFromHand" && power.effects) {
          this.addLog(`${power.name} triggers!`, "power", { player: this.current, uid: card.uid });
          this.queueEffects(power.effects, { controller: this.current });
        }
        break;
      }
      case "evolve": {
        const card = this.takeFromHand(me, action.handUid);
        const pokemon = this.getPokemon(action.target);
        if (!card || !pokemon) return;
        this.evolvePokemon(pokemon, card);
        this.addLog(`${me.name} evolves into ${card.def.name}`, "evolve", { player: this.current, uid: card.uid });
        break;
      }
      case "attachEnergy": {
        const card = this.takeFromHand(me, action.handUid);
        const pokemon = this.getPokemon(action.target);
        if (!card || !pokemon) return;
        pokemon.energy.push(card);
        me.attachedEnergyTurn = this.turnNumber;
        this.addLog(`${me.name} attaches ${card.def.name} to ${pokemon.def.name}`, "energy", { player: this.current, uid: pokemon.card.uid });
        break;
      }
      case "playTrainer": {
        const card = this.takeFromHand(me, action.handUid);
        if (!card || !isTrainer(card.def)) return;
        me.discard.push(card);
        if (card.def.kind === "Supporter") me.supporterTurn = this.turnNumber;
        this.addLog(`${me.name} plays ${card.def.name}`, "trainer", { player: this.current });
        this.queueEffects(card.def.effects, { controller: this.current });
        break;
      }
      case "usePower": {
        const pokemon = this.getPokemon(action.target);
        if (!pokemon?.def.power) return;
        pokemon.powerUsedTurn = this.turnNumber;
        this.addLog(`${me.name} uses ${pokemon.def.power.name}`, "power", { player: this.current, uid: pokemon.card.uid });
        this.queueEffects(pokemon.def.power.effects ?? [], { controller: this.current });
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
        this.addLog(`${me.name} plays Stadium ${card.def.name}`, "trainer", { player: this.current });
        break;
      }
      case "playTool": {
        const card = this.takeFromHand(me, action.handUid);
        const pokemon = this.getPokemon(action.target);
        if (!card || !pokemon || pokemon.tool) return;
        pokemon.tool = card;
        this.addLog(`${me.name} attaches ${card.def.name} to ${pokemon.def.name}`, "trainer", { player: this.current, uid: pokemon.card.uid });
        break;
      }
      case "retreat": {
        const active = me.active;
        const target = me.bench[action.benchIndex];
        if (!active || !target) return;
        const cost = this.effectiveRetreatCost({ p: this.current, slot: "active" }, active);
        me.retreatedTurn = this.turnNumber;
        const distinctEnergy = new Set(active.energy.map((card) => card.def.id)).size;
        const finish = () => {
          this.swapActive(this.current, action.benchIndex);
          this.addLog(`${me.name} retreats ${active.def.name} for ${target.def.name}`, "switch", { player: this.current, uid: target.card.uid });
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
      case "attack": {
        this.executeAttack(action.index);
        break;
      }
      case "pass": {
        this.addLog(`${me.name} ends their turn`, "turn", { player: this.current });
        this.turnEnding = true;
        break;
      }
    }
    this.drain();
  }

  resolvePending(optionIndex: number): void {
    const pending = this.pending;
    if (!pending) return;
    const option = pending.options[optionIndex];
    if (!option) return;
    this.pending = null;
    option.apply();
    this.drain();
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
    oldActive.attackBonus = 0;
    player.bench[benchIndex] = oldActive;
    player.active = newActive;
  }

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
        this.addLog(`${active.def.name} hurt itself in confusion!`, "damage", { uid: active.card.uid, amount: 30 });
        active.damage += 30;
        return;
      }
    }
    this.addLog(`${active.def.name} uses ${attack.name}`, "attack", { player: this.current, uid: active.card.uid });
    const context: EffectContext = { controller: this.current, attackerTypes: active.def.types, fromAttack: true };
    const baseDamage = (attack.damage ?? 0) + active.attackBonus;
    active.attackBonus = 0;
    if (baseDamage > 0) {
      const amount = baseDamage;
      this.thunks.push(() => this.dealAttackDamage({ p: 1 - context.controller, slot: "active" }, amount, context));
    }
    this.queueEffects(attack.effects ?? [], context);
  }

  private dealAttackDamage(ref: SlotRef, base: number, context: EffectContext, applyWROverride?: boolean): void {
    const target = this.getPokemon(ref);
    if (!target) return;
    let amount = base;
    if (context.fromAttack && amount > 0) {
      const attackerRef: SlotRef = { p: context.controller, slot: "active" };
      const attacker = this.getPokemon(attackerRef);
      if (attacker) {
        amount += this.modifierSum(attackerRef, "damagePlus");
        for (const energy of attacker.energy) {
          const rider = (energy.def as EnergyCardDef).damageRider;
          if (rider) amount += rider;
        }
        amount = Math.max(0, amount);
      }
    }
    const applyWR = applyWROverride ?? (ref.slot === "active" && ref.p !== context.controller);
    const attackerTypes = context.attackerTypes ?? [];
    if (applyWR && attackerTypes.length > 0 && amount > 0) {
      if (target.def.weakness && attackerTypes.includes(target.def.weakness)) {
        amount *= 2;
        this.addLog("It's weak! Damage doubled");
      }
      if (target.def.resistance && attackerTypes.includes(target.def.resistance)) {
        amount = Math.max(0, amount - 30);
        this.addLog("Resistance: -30 damage");
      }
    }
    if (context.fromAttack && amount > 0) {
      if (target.guard && this.turnNumber <= target.guard.untilTurn) {
        if (target.guard.mode === "preventAll") {
          amount = 0;
          this.addLog(`${target.def.name} prevented all damage`);
        } else {
          amount = Math.max(0, amount - target.guard.amount);
        }
      }
      const reduction = this.modifierSum(ref, "damageMinus");
      if (reduction > 0 && amount > 0) amount = Math.max(0, amount - reduction);
    }
    if (amount > 0) {
      target.damage += amount;
      this.addLog(`${target.def.name} takes ${amount} damage`, "damage", { uid: target.card.uid, amount });
    } else if (base > 0) {
      this.addLog(`${target.def.name} takes no damage`, "damage", { uid: target.card.uid, amount: 0 });
    }
  }

  private queueEffects(effects: Effect[], context: EffectContext): void {
    const thunks = effects.map((effect) => () => this.runEffect(effect, context));
    this.thunks.unshift(...thunks);
  }

  private runEffect(effect: Effect, context: EffectContext): void {
    const me = this.players[context.controller];
    const opp = this.players[1 - context.controller];
    switch (effect.op) {
      case "damage": {
        this.forEachTarget(effect.target, context, `Deal ${effect.amount} damage to`, (ref) => {
          this.dealAttackDamage(ref, effect.amount, context, effect.applyWR);
        });
        break;
      }
      case "damageCounters": {
        this.forEachTarget(effect.target, context, `Put ${effect.count} damage counters on`, (ref) => {
          const target = this.getPokemon(ref);
          if (target) {
            target.damage += effect.count * 10;
            this.addLog(`${target.def.name} gets ${effect.count} damage counter(s)`, "damage", { uid: target.card.uid, amount: effect.count * 10 });
          }
        });
        break;
      }
      case "heal": {
        const candidates = this.allInPlay(context.controller).filter(({ pokemon }) => pokemon.damage > 0);
        if (candidates.length === 0) break;
        this.requestChoice(context.controller, "Heal which Pokemon?", candidates.map(({ ref, pokemon }) => ({
          label: `${this.describeSlot(ref)} — ${pokemon.damage} damage`,
          aiScore: Math.min(pokemon.damage, effect.amount),
          apply: () => {
            pokemon.damage = Math.max(0, pokemon.damage - effect.amount);
            this.addLog(`${pokemon.def.name} healed ${effect.amount}`, "heal", { uid: pokemon.card.uid, amount: effect.amount });
          },
        })));
        break;
      }
      case "draw": {
        this.drawCards(context.controller, effect.count);
        break;
      }
      case "drawPerOpponentPokemon": {
        this.drawCards(context.controller, this.allInPlay(1 - context.controller).length);
        break;
      }
      case "discardFromHand": {
        this.discardFromHandChoice(context.controller, effect.count);
        break;
      }
      case "discardSelfEnergy": {
        const active = me.active;
        if (!active) break;
        for (let i = 0; i < effect.count; i++) {
          const index = effect.energyType
            ? active.energy.findIndex((e) => (e.def as EnergyCardDef).provides.includes(effect.energyType!))
            : active.energy.length - 1;
          if (index === -1 || active.energy.length === 0) break;
          const removed = active.energy.splice(index === -1 ? active.energy.length - 1 : index, 1)[0];
          me.discard.push(removed);
          this.addLog(`${active.def.name} discards ${removed.def.name}`);
        }
        break;
      }
      case "applyCondition": {
        const target = opp.active;
        if (!target) break;
        if (this.conditionsPrevented({ p: 1 - context.controller, slot: "active" })) {
          this.addLog(`${target.def.name} is protected from Special Conditions`);
          break;
        }
        target.condition = effect.condition;
        this.addLog(`${target.def.name} is now ${effect.condition[0].toUpperCase()}${effect.condition.slice(1)}`, "status", { uid: target.card.uid });
        break;
      }
      case "applyPoison": {
        const target = opp.active;
        if (!target) break;
        if (this.conditionsPrevented({ p: 1 - context.controller, slot: "active" })) {
          this.addLog(`${target.def.name} is protected from Special Conditions`);
          break;
        }
        const counters = effect.counters ?? 1;
        target.poisonCounters = Math.max(target.poisonCounters, counters);
        this.addLog(`${target.def.name} is now ${counters >= 2 ? "Badly Poisoned" : "Poisoned"}`, "status", { uid: target.card.uid });
        break;
      }
      case "applyBurn": {
        const target = opp.active;
        if (!target) break;
        if (this.conditionsPrevented({ p: 1 - context.controller, slot: "active" })) {
          this.addLog(`${target.def.name} is protected from Special Conditions`);
          break;
        }
        target.burned = true;
        this.addLog(`${target.def.name} is now Burned`, "status", { uid: target.card.uid });
        break;
      }
      case "damageScaled": {
        const defendingRef: SlotRef = { p: 1 - context.controller, slot: "active" };
        const defender = this.getPokemon(defendingRef);
        let count = 0;
        switch (effect.per) {
          case "attackerEnergy":
            count = me.active?.energy.length ?? 0;
            break;
          case "defenderEnergy":
            count = defender?.energy.length ?? 0;
            break;
          case "defenderDamageCounters":
            count = (defender?.damage ?? 0) / 10;
            break;
          case "selfDamageCounters":
            count = (me.active?.damage ?? 0) / 10;
            break;
          case "yourBench":
            count = me.bench.length;
            break;
          case "oppBench":
            count = opp.bench.length;
            break;
        }
        const total = effect.base + effect.amount * count;
        if (total > 0) this.dealAttackDamage(defendingRef, total, context);
        break;
      }
      case "recoil": {
        const attacker = me.active;
        if (attacker) {
          attacker.damage += effect.amount;
          this.addLog(`${attacker.def.name} takes ${effect.amount} recoil damage`, "damage", { uid: attacker.card.uid, amount: effect.amount });
        }
        break;
      }
      case "protectNextTurn": {
        const attacker = me.active;
        if (attacker) {
          attacker.guard = { mode: effect.mode, amount: effect.amount ?? 0, untilTurn: this.turnNumber + 1 };
          this.addLog(
            effect.mode === "preventAll"
              ? `${attacker.def.name} prevents all damage next turn`
              : `${attacker.def.name} reduces damage by ${effect.amount ?? 0} next turn`
          );
        }
        break;
      }
      case "lockDefending": {
        const defender = opp.active;
        if (defender) {
          defender.locks[effect.what] = this.turnNumber + 1;
          this.addLog(`${defender.def.name} can't ${effect.what} during its next turn`);
        }
        break;
      }
      case "discardOpponentEnergy": {
        this.discardOpponentEnergyChoice(context.controller, effect.count);
        break;
      }
      case "shuffleHandDraw": {
        const targets =
          effect.who === "both"
            ? [context.controller, 1 - context.controller]
            : effect.who === "self"
              ? [context.controller]
              : [1 - context.controller];
        const drawCounts = targets.map((p) => {
          if (effect.count === "opponentHand") return this.players[1 - p].hand.length;
          if (effect.count === "ownPrizes") return this.players[p].prizes.length;
          return effect.count;
        });
        targets.forEach((p, i) => {
          const player = this.players[p];
          if (player.hand.length > 0) {
            player.deck.push(...player.hand.splice(0));
            this.shuffle(player.deck);
            this.addLog(`${player.name} shuffles their hand into the deck`);
          }
          this.drawCards(p, drawCounts[i]);
        });
        break;
      }
      case "scoopUp": {
        const candidates = this.allInPlay(context.controller);
        if (candidates.length === 0) break;
        this.requestChoice(context.controller, "Return which Pokemon to your hand?", candidates.map(({ ref, pokemon }) => ({
          label: `${this.describeSlot(ref)} — ${pokemon.damage} damage`,
          aiScore: pokemon.damage - (ref.slot === "active" ? 20 : 0),
          apply: () => {
            const player = this.players[context.controller];
            player.hand.push(pokemon.card, ...pokemon.underneath, ...pokemon.energy);
            if (pokemon.tool) player.hand.push(pokemon.tool);
            if (player.active === pokemon) player.active = null;
            player.bench = player.bench.filter((b) => b !== pokemon);
            this.addLog(`${pokemon.def.name} returns to ${player.name}'s hand`);
          },
        })));
        break;
      }
      case "warpPoint": {
        this.queueSwitchChoice(context.controller);
        this.queueSwitchChoice(1 - context.controller);
        break;
      }
      case "moveEnergy": {
        this.moveEnergyChoice(context.controller, effect.energyType, effect.count);
        break;
      }
      case "moveDamageCounters": {
        this.moveDamageCountersChoice(context.controller, effect.count);
        break;
      }
      case "devolveDefending": {
        const target = opp.active;
        if (!target || target.underneath.length === 0) break;
        const removed = target.card;
        const previous = target.underneath.pop()!;
        target.card = previous;
        target.def = previous.def as PokemonCardDef;
        target.condition = null;
        target.poisonCounters = 0;
        target.burned = false;
        target.guard = null;
        target.locks = {};
        target.evolvedTurn = null;
        this.players[1 - context.controller].hand.push(removed);
        this.addLog(`${removed.def.name} devolves into ${target.def.name}`);
        break;
      }
      case "flip": {
        const heads = this.flipCoin("Coin flip");
        this.queueEffects(heads ? effect.heads : effect.tails, context);
        break;
      }
      case "damagePerHeads": {
        let heads = 0;
        for (let i = 0; i < effect.flips; i++) if (this.flipCoin("Coin flip")) heads++;
        const total = heads * effect.amount;
        if (total > 0) this.dealAttackDamage({ p: 1 - context.controller, slot: "active" }, total, context);
        else this.addLog("No heads — the attack does nothing");
        break;
      }
      case "searchDeck": {
        this.searchDeckChoice(context.controller, effect.filter, effect.count);
        break;
      }
      case "switchSelf": {
        if (me.bench.length === 0 || !me.active) break;
        this.requestChoice(context.controller, "Switch to which Pokemon?", me.bench.map((pokemon, i) => ({
          label: pokemon.def.name,
          aiScore: pokemon.def.hp - pokemon.damage,
          apply: () => {
            this.swapActive(context.controller, i);
            this.addLog(`${me.name} switches to ${pokemon.def.name}`, "switch", { player: context.controller, uid: pokemon.card.uid });
          },
        })));
        break;
      }
      case "gustOpponent": {
        if (opp.bench.length === 0 || !opp.active) break;
        this.requestChoice(context.controller, "Bring which Pokemon to the Active spot?", opp.bench.map((pokemon, i) => ({
          label: pokemon.def.name,
          aiScore: pokemon.damage,
          apply: () => {
            this.swapActive(1 - context.controller, i);
            this.addLog(`${pokemon.def.name} is dragged to the Active spot`, "switch", { player: 1 - context.controller, uid: pokemon.card.uid });
          },
        })));
        break;
      }
      case "attachEnergyFromDiscard": {
        const energyIndex = me.discard.findIndex(
          (c) => isEnergy(c.def) && c.def.provides.includes(effect.energyType)
        );
        if (energyIndex === -1) break;
        const targets =
          effect.target === "selfBenchChoice"
            ? me.bench.map((pokemon, i) => ({ ref: { p: context.controller, slot: i } as SlotRef, pokemon }))
            : this.allInPlay(context.controller);
        if (targets.length === 0) break;
        this.requestChoice(context.controller, `Attach ${effect.energyType} Energy to which Pokemon?`, targets.map(({ ref, pokemon }) => ({
          label: this.describeSlot(ref),
          aiScore: (pokemon.def.stage === "Basic" ? 0 : 10) + pokemon.def.attacks.length,
          apply: () => {
            const card = me.discard.splice(energyIndex, 1)[0];
            pokemon.energy.push(card);
            this.addLog(`${card.def.name} attached to ${pokemon.def.name} from the discard pile`);
          },
        })));
        break;
      }
      case "attachEnergyFromHand": {
        const energyIndex = me.hand.findIndex(
          (c) => isEnergy(c.def) && c.def.provides.includes(effect.energyType)
        );
        if (energyIndex === -1) break;
        const targets = this.allInPlay(context.controller);
        this.requestChoice(context.controller, `Attach ${effect.energyType} Energy to which Pokemon?`, targets.map(({ ref, pokemon }) => ({
          label: this.describeSlot(ref),
          aiScore: (pokemon.def.stage === "Basic" ? 0 : 10) + pokemon.def.attacks.length,
          apply: () => {
            const card = me.hand.splice(energyIndex, 1)[0];
            pokemon.energy.push(card);
            this.addLog(`${card.def.name} attached to ${pokemon.def.name} from hand`);
          },
        })));
        break;
      }
      case "rareCandy": {
        const pairs = this.rareCandyPairs(context.controller);
        if (pairs.length === 0) break;
        this.requestChoice(context.controller, "Evolve which Pokemon?", pairs.map(({ ref, pokemon, stage2 }) => ({
          label: `${this.describeSlot(ref)} → ${stage2.def.name}`,
          aiScore: (stage2.def as PokemonCardDef).hp,
          apply: () => {
            const player = this.players[context.controller];
            const index = player.hand.findIndex((c) => c.uid === stage2.uid);
            if (index === -1) return;
            const card = player.hand.splice(index, 1)[0];
            this.evolvePokemon(pokemon, card);
            this.addLog(`Rare Candy: ${pokemon.underneath[pokemon.underneath.length - 1].def.name} becomes ${card.def.name}`);
          },
        })));
        break;
      }
      case "nextAttackBonus": {
        const attacker = me.active;
        if (attacker) {
          attacker.attackBonus += effect.amount;
          this.addLog(`${attacker.def.name}'s next attack does ${effect.amount} more damage`);
        }
        break;
      }
      case "damageIfStatus": {
        const defender = opp.active;
        if (!defender) break;
        const hasStatus =
          effect.status === "burned" ? defender.burned :
          effect.status === "poisoned" ? defender.poisonCounters > 0 :
          defender.condition === effect.status;
        if (hasStatus) {
          defender.damage += effect.bonus;
          this.addLog(`+${effect.bonus} bonus damage (${effect.status})`);
        }
        break;
      }
      case "damageIfDefenderNoEnergy": {
        const defender = opp.active;
        if (defender && defender.energy.length === 0) {
          defender.damage += effect.bonus;
          this.addLog(`+${effect.bonus} bonus damage (no energy on defender)`);
        }
        break;
      }
      case "damageIfDefenderSpecialEnergy": {
        const defender = opp.active;
        if (!defender) break;
        const hasSpecial = defender.energy.some((c) => isEnergy(c.def) && !c.def.isBasic);
        if (hasSpecial) {
          defender.damage += effect.bonus;
          this.addLog(`+${effect.bonus} bonus damage (Special Energy on defender)`);
        }
        break;
      }
      case "damageIfDefenderResistance": {
        const defender = opp.active;
        if (!defender) break;
        if (defender.def.resistance === effect.resistanceType) {
          defender.damage += effect.bonus;
          this.addLog(`+${effect.bonus} bonus damage (defender has ${effect.resistanceType} Resistance)`);
        }
        break;
      }
      case "damagePerFlipsPerEnergy": {
        const attacker = me.active;
        if (!attacker) break;
        const energyCount = effect.energyType
          ? attacker.energy.filter((c) => isEnergy(c.def) && c.def.provides.includes(effect.energyType!)).length
          : attacker.energy.length;
        let heads = 0;
        for (let i = 0; i < energyCount; i++) if (this.flipCoin("Coin flip")) heads++;
        const total = effect.base + effect.amount * heads;
        if (total > 0) this.dealAttackDamage({ p: 1 - context.controller, slot: "active" }, total, context);
        break;
      }
      case "discardEnergyForDamage": {
        this.discardEnergyForDamageChoice(context.controller, effect.energyType, effect.damagePerEnergy, 0, context);
        break;
      }
      case "discardOpponentHand": {
        this.discardOpponentHandChoice(context.controller, effect.count);
        break;
      }
    }
  }

  private forEachTarget(
    target: EffectTarget,
    context: EffectContext,
    prompt: string,
    handler: (ref: SlotRef) => void
  ): void {
    switch (target) {
      case "defending":
        handler({ p: 1 - context.controller, slot: "active" });
        return;
      case "self":
        handler({ p: context.controller, slot: "active" });
        return;
      case "eachOpponentBench":
        this.players[1 - context.controller].bench.forEach((_, i) => handler({ p: 1 - context.controller, slot: i }));
        return;
      case "opponentBenchChoice":
      case "selfBenchChoice":
      case "anySelfChoice": {
        const p = target === "opponentBenchChoice" ? 1 - context.controller : context.controller;
        const candidates =
          target === "anySelfChoice"
            ? this.allInPlay(p)
            : this.players[p].bench.map((pokemon, i) => ({ ref: { p, slot: i } as SlotRef, pokemon }));
        if (candidates.length === 0) return;
        if (candidates.length === 1) {
          handler(candidates[0].ref);
          return;
        }
        this.requestChoice(context.controller, `${prompt}:`, candidates.map(({ ref, pokemon }) => ({
          label: this.describeSlot(ref),
          aiScore: target === "opponentBenchChoice" ? pokemon.damage + 10 : pokemon.damage,
          apply: () => handler(ref),
        })));
        return;
      }
    }
  }

  private retreatDiscardChoice(p: number, active: PokemonInPlay, remaining: number, finish: () => void): void {
    if (remaining <= 0 || active.energy.length === 0) {
      finish();
      return;
    }
    this.requestChoice(p, `Discard Energy to retreat (${remaining} more needed)`, active.energy.map((card) => ({
      label: card.def.name,
      aiScore: -this.energyUnits(card, active, p).count,
      apply: () => {
        const index = active.energy.findIndex((c) => c.uid === card.uid);
        if (index === -1) return;
        const discarded = active.energy.splice(index, 1)[0];
        this.players[p].discard.push(discarded);
        const units = this.energyUnits(discarded, active, p).count;
        this.thunks.unshift(() => this.retreatDiscardChoice(p, active, remaining - units, finish));
      },
    })));
  }

  private moveEnergyChoice(p: number, energyType: EnergyType | undefined, count: number): void {
    if (count <= 0) return;
    const matches = (card: CardInstance) =>
      isEnergy(card.def) && (!energyType || card.def.provides.includes(energyType));
    const sources = this.allInPlay(p).filter(({ pokemon }) => pokemon.energy.some(matches));
    if (sources.length === 0) return;
    this.requestChoice(p, "Move Energy from which Pokemon?", sources.map(({ ref, pokemon }) => ({
      label: this.describeSlot(ref),
      aiScore: pokemon.def.stage === "Basic" ? 5 : 0,
      apply: () => {
        this.thunks.unshift(() => {
          const targets = this.allInPlay(p).filter((entry) => entry.pokemon !== pokemon);
          if (targets.length === 0) return;
          this.requestChoice(p, "Move Energy to which Pokemon?", targets.map((entry) => ({
            label: this.describeSlot(entry.ref),
            aiScore: entry.pokemon.def.hp - entry.pokemon.damage,
            apply: () => {
              const index = pokemon.energy.findIndex(matches);
              if (index === -1) return;
              const card = pokemon.energy.splice(index, 1)[0];
              entry.pokemon.energy.push(card);
              this.addLog(`${card.def.name} moves from ${pokemon.def.name} to ${entry.pokemon.def.name}`);
              this.thunks.unshift(() => this.moveEnergyChoice(p, energyType, count - 1));
            },
          })));
        });
      },
    })));
  }

  private moveDamageCountersChoice(p: number, count: number): void {
    if (count <= 0) return;
    const sources = [...this.allInPlay(0), ...this.allInPlay(1)].filter(({ pokemon }) => pokemon.damage > 0);
    if (sources.length === 0) return;
    this.requestChoice(p, "Move a damage counter from which Pokemon?", sources.map(({ ref, pokemon }) => ({
      label: `${this.players[ref.p].name}'s ${this.describeSlot(ref)} — ${pokemon.damage} damage`,
      aiScore: ref.p === p ? pokemon.damage : 0,
      apply: () => {
        this.thunks.unshift(() => {
          const targets = [...this.allInPlay(0), ...this.allInPlay(1)].filter((entry) => entry.pokemon !== pokemon);
          if (targets.length === 0) return;
          this.requestChoice(p, "Move it to which Pokemon?", targets.map((entry) => ({
            label: `${this.players[entry.ref.p].name}'s ${this.describeSlot(entry.ref)}`,
            aiScore: entry.ref.p !== p ? entry.pokemon.damage + 10 : -entry.pokemon.damage,
            apply: () => {
              pokemon.damage -= 10;
              entry.pokemon.damage += 10;
              this.addLog(`A damage counter moves from ${pokemon.def.name} to ${entry.pokemon.def.name}`);
              this.thunks.unshift(() => this.moveDamageCountersChoice(p, count - 1));
            },
          })));
        });
      },
    })));
  }

  private discardOpponentEnergyChoice(p: number, count: number): void {
    if (count <= 0) return;
    const defender = this.players[1 - p].active;
    if (!defender || defender.energy.length === 0) return;
    this.requestChoice(p, "Discard which Energy from the Defending Pokemon?", defender.energy.map((card) => ({
      label: card.def.name,
      aiScore: this.energyUnits(card, defender, 1 - p).count * 10,
      apply: () => {
        const index = defender.energy.findIndex((c) => c.uid === card.uid);
        if (index !== -1) this.players[1 - p].discard.push(defender.energy.splice(index, 1)[0]);
        this.addLog(`${defender.def.name} loses ${card.def.name}`);
        this.thunks.unshift(() => this.discardOpponentEnergyChoice(p, count - 1));
      },
    })));
  }

  private queueSwitchChoice(p: number): void {
    this.thunks.unshift(() => {
      const player = this.players[p];
      if (!player.active || player.bench.length === 0) return;
      if (player.bench.length === 1) {
        const target = player.bench[0];
        this.swapActive(p, 0);
        this.addLog(`${player.name} switches to ${target.def.name}`, "switch", { player: p, uid: target.card.uid });
        return;
      }
      this.requestChoice(p, "Switch to which Pokemon?", player.bench.map((pokemon, i) => ({
        label: pokemon.def.name,
        aiScore: pokemon.def.hp - pokemon.damage,
        apply: () => {
          this.swapActive(p, i);
          this.addLog(`${player.name} switches to ${pokemon.def.name}`, "switch", { player: p, uid: pokemon.card.uid });
        },
      })));
    });
  }

  private drawCards(p: number, count: number): void {
    const player = this.players[p];
    const drawn = Math.min(count, player.deck.length);
    player.hand.push(...player.deck.splice(0, drawn));
    if (drawn > 0) this.addLog(`${player.name} draws ${drawn} card(s)`, "draw", { player: p });
  }

  private discardFromHandChoice(p: number, count: number): void {
    if (count <= 0) return;
    const player = this.players[p];
    if (player.hand.length === 0) return;
    this.requestChoice(p, "Discard which card?", player.hand.map((card) => ({
      label: card.def.name,
      aiScore: isEnergy(card.def) ? 5 : isTrainer(card.def) ? 2 : 0,
      apply: () => {
        const index = player.hand.findIndex((c) => c.uid === card.uid);
        if (index !== -1) player.discard.push(player.hand.splice(index, 1)[0]);
        this.addLog(`${player.name} discards ${card.def.name}`);
        this.thunks.unshift(() => this.discardFromHandChoice(p, count - 1));
      },
    })));
  }

  private matchesFilter(def: CardDef, filter: CardFilter): boolean {
    if (filter.supertype && def.supertype !== filter.supertype) return false;
    if (filter.stage && (!isPokemon(def) || def.stage !== filter.stage)) return false;
    if (filter.excludeEx && isPokemon(def) && def.isEx) return false;
    if (filter.basicEnergy && (!isEnergy(def) || !def.isBasic)) return false;
    if (filter.nameContains && !def.name.includes(filter.nameContains)) return false;
    if (filter.maxHp !== undefined && (!isPokemon(def) || def.hp > filter.maxHp)) return false;
    if (filter.deltaOnly && (!isPokemon(def) || !def.isDelta)) return false;
    return true;
  }

  private searchDeckChoice(p: number, filter: CardFilter, count: number): void {
    if (count <= 0) return;
    const player = this.players[p];
    const seen = new Set<string>();
    const options: ChoiceOption[] = [];
    for (const card of player.deck) {
      if (!this.matchesFilter(card.def, filter) || seen.has(card.def.id)) continue;
      seen.add(card.def.id);
      const def = card.def;
      options.push({
        label: def.name,
        aiScore: isPokemon(def) ? def.hp : 10,
        apply: () => {
          const index = player.deck.findIndex((c) => c.def.id === def.id);
          if (index !== -1) player.hand.push(player.deck.splice(index, 1)[0]);
          this.addLog(`${player.name} takes ${def.name} from the deck`);
          this.shuffle(player.deck);
          this.thunks.unshift(() => this.searchDeckChoice(p, filter, count - 1));
        },
      });
    }
    options.push({
      label: "Take nothing",
      aiScore: -100,
      apply: () => {
        this.shuffle(player.deck);
        this.addLog(`${player.name} shuffles their deck`);
      },
    });
    if (options.length === 1) {
      options[0].apply();
      return;
    }
    this.requestChoice(p, "Search your deck for:", options);
  }

  private rareCandyPairs(p: number): Array<{ ref: SlotRef; pokemon: PokemonInPlay; stage2: CardInstance }> {
    const player = this.players[p];
    const pairs: Array<{ ref: SlotRef; pokemon: PokemonInPlay; stage2: CardInstance }> = [];
    for (const { ref, pokemon } of this.allInPlay(p)) {
      if (pokemon.def.stage !== "Basic") continue;
      for (const card of player.hand) {
        const stage2Def = card.def;
        if (!isPokemon(stage2Def) || stage2Def.stage !== "Stage2" || !stage2Def.evolvesFrom) continue;
        const middle = Object.values(this.library).find(
          (def) => isPokemon(def) && def.name === stage2Def.evolvesFrom && def.evolvesFrom === pokemon.def.name
        );
        if (middle) pairs.push({ ref, pokemon, stage2: card });
      }
    }
    return pairs;
  }

  canPlayTrainer(def: TrainerCardDef): boolean {
    const me = this.players[this.current];
    const first = def.effects[0];
    if (!first) return false;
    switch (first.op) {
      case "heal":
        return this.allInPlay(this.current).some(({ pokemon }) => pokemon.damage > 0);
      case "switchSelf":
        return me.bench.length > 0 && me.active !== null;
      case "searchDeck":
      case "draw":
      case "drawPerOpponentPokemon":
        return me.deck.length > 0;
      case "rareCandy":
        return this.rareCandyPairs(this.current).length > 0;
      case "gustOpponent":
        return this.players[1 - this.current].bench.length > 0;
      case "warpPoint":
        return me.bench.length > 0 || this.players[1 - this.current].bench.length > 0;
      case "scoopUp":
        return this.allInPlay(this.current).length > 0;
      case "discardOpponentEnergy": {
        const defender = this.players[1 - this.current].active;
        return !!defender && defender.energy.length > 0;
      }
      case "shuffleHandDraw":
        return true;
      default:
        return true;
    }
  }

  private trainerRestrictionOk(def: TrainerCardDef): boolean {
    const restriction = def.restriction;
    if (!restriction) return true;
    const me = this.players[this.current];
    if (restriction.maxHandSize !== undefined && me.hand.length > restriction.maxHandSize) return false;
    if (restriction.behindOnPrizes && me.prizes.length <= this.players[1 - this.current].prizes.length) return false;
    return true;
  }

  private powerHasValidUse(effects: Effect[]): boolean {
    const me = this.players[this.current];
    const first = effects[0];
    if (!first) return false;
    switch (first.op) {
      case "attachEnergyFromDiscard": {
        const hasEnergy = me.discard.some((c) => isEnergy(c.def) && c.def.provides.includes(first.energyType));
        const hasTarget = first.target === "selfBenchChoice" ? me.bench.length > 0 : true;
        return hasEnergy && hasTarget;
      }
      case "attachEnergyFromHand":
        return me.hand.some((c) => isEnergy(c.def) && c.def.provides.includes(first.energyType));
      case "heal":
        return this.allInPlay(this.current).some(({ pokemon }) => pokemon.damage > 0);
      case "draw":
        return me.deck.length > 0;
      default:
        return true;
    }
  }

  private discardEnergyForDamageChoice(
    p: number,
    energyType: EnergyType | undefined,
    damagePerEnergy: number,
    discarded: number,
    context: EffectContext
  ): void {
    const active = this.players[p].active;
    if (!active) {
      if (discarded > 0) this.dealAttackDamage({ p: 1 - p, slot: "active" }, discarded * damagePerEnergy, context);
      return;
    }
    const matches = (c: CardInstance) => isEnergy(c.def) && (!energyType || c.def.provides.includes(energyType));
    const available = active.energy.filter(matches);
    if (available.length === 0) {
      if (discarded > 0) this.dealAttackDamage({ p: 1 - p, slot: "active" }, discarded * damagePerEnergy, context);
      return;
    }
    const options: ChoiceOption[] = [
      ...available.map((card) => ({
        label: `Discard ${card.def.name} (+${damagePerEnergy} damage)`,
        aiScore: damagePerEnergy - 5,
        apply: () => {
          const idx = active.energy.findIndex((c) => c.uid === card.uid);
          if (idx !== -1) {
            this.players[p].discard.push(active.energy.splice(idx, 1)[0]);
            this.addLog(`${active.def.name} discards ${card.def.name} for extra damage`);
          }
          this.thunks.unshift(() =>
            this.discardEnergyForDamageChoice(p, energyType, damagePerEnergy, discarded + 1, context)
          );
        },
      })),
      {
        label: discarded > 0 ? "Stop discarding" : "Don't discard",
        aiScore: -1,
        apply: () => {
          if (discarded > 0)
            this.thunks.unshift(() =>
              this.dealAttackDamage({ p: 1 - p, slot: "active" }, discarded * damagePerEnergy, context)
            );
        },
      },
    ];
    this.requestChoice(p, `Discard energy for +${damagePerEnergy} damage each?`, options);
  }

  private discardOpponentHandChoice(p: number, count: number): void {
    if (count <= 0) return;
    const opponent = this.players[1 - p];
    if (opponent.hand.length === 0) return;
    this.requestChoice(p, "Choose a card for your opponent to discard:", opponent.hand.map((card) => ({
      label: card.def.name,
      aiScore: isEnergy(card.def) ? 10 : isTrainer(card.def) ? 8 : 5,
      apply: () => {
        const index = opponent.hand.findIndex((c) => c.uid === card.uid);
        if (index !== -1) opponent.discard.push(opponent.hand.splice(index, 1)[0]);
        this.addLog(`${opponent.name} discards ${card.def.name}`);
        this.thunks.unshift(() => this.discardOpponentHandChoice(p, count - 1));
      },
    })));
  }

  private requestChoice(player: number, prompt: string, options: ChoiceOption[]): void {
    if (options.length === 0) return;
    this.pending = { player, prompt, options };
  }

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
      const knocked = this.allInPlay(p).filter(({ ref, pokemon }) => pokemon.damage >= this.effectiveHp(ref, pokemon));
      for (const { pokemon } of knocked) {
        any = true;
        this.addLog(`${pokemon.def.name} is Knocked Out!`, "ko", { player: p, uid: pokemon.card.uid });
        player.discard.push(pokemon.card, ...pokemon.underneath, ...pokemon.energy);
        if (pokemon.tool) player.discard.push(pokemon.tool);
        if (player.active === pokemon) player.active = null;
        player.bench = player.bench.filter((b) => b !== pokemon);
        const prizeTaker = this.players[1 - p];
        const prizeCount = pokemon.def.isEx ? 2 : 1;
        for (let i = 0; i < prizeCount && prizeTaker.prizes.length > 0; i++) {
          prizeTaker.hand.push(prizeTaker.prizes.pop()!);
        }
        this.addLog(`${prizeTaker.name} takes ${prizeCount} prize card(s)${pokemon.def.isEx ? " (Pokemon-ex!)" : ""}`, "prize", { player: 1 - p, amount: prizeCount });
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
        this.addLog(`${player.name} promotes ${player.active.def.name}`, "switch", { player: p, uid: player.active.card.uid });
        return true;
      }
      this.requestChoice(p, "Promote which Pokemon to Active?", player.bench.map((pokemon, i) => ({
        label: `${pokemon.def.name} (${pokemon.def.hp - pokemon.damage} HP left)`,
        aiScore: pokemon.def.hp - pokemon.damage + pokemon.energy.length * 15,
        apply: () => {
          const promoted = player.bench.splice(i, 1)[0];
          player.active = promoted;
          this.addLog(`${player.name} promotes ${promoted.def.name}`, "switch", { player: p, uid: promoted.card.uid });
        },
      })));
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
      if (player.prizes.length === 0) {
        reasons[p] = `${player.name} took all their prize cards`;
      } else if (!opp.active && opp.bench.length === 0) {
        reasons[p] = `${opp.name} has no Pokemon left in play`;
      }
    }
    if (reasons[0] && reasons[1]) {
      this.phase = "finished";
      this.suddenDeath = true;
      this.winReason = "Both players met a win condition at the same time — Sudden Death!";
      this.addLog(this.winReason, "win");
      return true;
    }
    for (let p = 0; p < 2; p++) {
      if (reasons[p]) return this.declareWinner(p, reasons[p]!);
    }
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
        this.addLog(`${active.def.name} takes ${poisonDmg} poison damage`, "damage", { uid: active.card.uid, amount: poisonDmg });
      }
      if (active.burned) {
        if (!this.flipCoin(`Burn check for ${active.def.name}`)) {
          active.damage += 20;
          this.addLog(`${active.def.name} takes 20 burn damage`, "damage", { uid: active.card.uid, amount: 20 });
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
        this.addLog(`${active.def.name} is no longer Paralyzed`, "status", { uid: active.card.uid });
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
