import cardsJson from "../src/data/cards.json";
import decksJson from "../src/data/decks.json";
import { determinize } from "../src/ai/determinize";
import { searchDecision } from "../src/ai/ismcts";
import {
  chooseOptionSeeded,
  chooseSetupAwareAction,
  isPlannedDecisionReusable,
  USEFUL_SETUP_SCORE,
} from "../src/ai/simpleAI";
import { searchCardChoiceScore } from "../src/ai/choiceScoring";
import { SeededRng } from "../src/core/rng";
import { makePokemonInPlay } from "../src/core/state";
import { Game } from "../src/engine/game";
import type { CardDef, CardInstance, TrainerCardDef } from "../src/model/cards";
import type { Effect } from "../src/model/effects";
import { buildDeck, buildLibrary } from "../src/model/loader";
import { effectRegistryCoverage } from "../src/effects/registry";
import { matchPlannedDecision, parsePrincipalVariation } from "../src/ai/principalVariation";

const library = buildLibrary(cardsJson as CardDef[]);
const decks = decksJson as Record<string, Record<string, number>>;
const deckNames = Object.keys(decks);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function readyGame(seed = 9001): Game {
  const game = new Game(
    library,
    buildDeck(decks[deckNames[0]], library),
    buildDeck(decks[deckNames[1]], library),
    ["Observer", "Opponent"],
    seed
  );
  let guard = 0;
  while (game.pending && guard++ < 20) game.applyDecision(game.getDecisionPoint()!.options[0].decision);
  assert(!game.pending, "setup reaches a stable action decision");
  return game;
}

function cardIds(cards: CardInstance[]): string[] {
  return cards.map((card) => card.def.id).sort();
}

function combatFixture(): Game {
  const fighterDeck = [
    library["lucario-ex"],
    library["fighting-energy"],
    library["fighting-energy"],
    library["fighting-energy"],
    ...Array.from({ length: 56 }, () => library.munchlax),
  ];
  const defenderDeck = Array.from({ length: 60 }, () => library.munchlax);
  const game = new Game(library, fighterDeck, defenderDeck, ["Expert", "Target"], 12);

  const reset = (p: number) => {
    const player = game.players[p];
    if (player.active) player.deck.push(player.active.card);
    for (const pokemon of player.bench) player.deck.push(pokemon.card);
    player.deck.push(...player.hand, ...player.prizes);
    player.hand = [];
    player.prizes = [];
    player.active = null;
    player.bench = [];
  };
  const take = (p: number, id: string) => {
    const deck = game.players[p].deck;
    const index = deck.findIndex((card) => card.def.id === id);
    assert(index >= 0, `fixture contains ${id}`);
    return deck.splice(index, 1)[0];
  };
  reset(0);
  reset(1);
  const attacker = makePokemonInPlay(take(0, "lucario-ex"), 1);
  attacker.energy.push(
    take(0, "fighting-energy"),
    take(0, "fighting-energy"),
    take(0, "fighting-energy")
  );
  game.players[0].active = attacker;
  game.players[1].active = makePokemonInPlay(take(1, "munchlax"), 1);
  game.players[0].prizes = game.players[0].deck.splice(0, 6);
  game.players[1].prizes = game.players[1].deck.splice(0, 6);
  game.pending = null;
  game.current = 0;
  game.turnNumber = 3;
  game.players[0].turnsTaken = 2;
  game.players[1].turnsTaken = 2;
  const internals = game as unknown as {
    operations: unknown[];
    turnEnding: boolean;
    turnStarting: boolean;
  };
  internals.operations = [];
  internals.turnEnding = false;
  internals.turnStarting = false;
  return game;
}

function evolutionSearchFixture(
  handIds: string[] = ["poke-ball"],
  attachedEnergy = 1
): Game {
  const evolutionDeck = Object.values(decks).find((deck) => deck["nidoran-m"] && deck.nidorino);
  assert(!!evolutionDeck, "fixture deck contains the Nidoran evolution line");
  const game = new Game(
    library,
    buildDeck(evolutionDeck!, library),
    Array.from({ length: 60 }, () => library.munchlax),
    ["Searcher", "Target"],
    707
  );
  const reset = (p: number) => {
    const player = game.players[p];
    if (player.active) player.deck.push(player.active.card);
    for (const pokemon of player.bench) player.deck.push(pokemon.card);
    player.deck.push(...player.hand, ...player.prizes);
    player.hand = [];
    player.prizes = [];
    player.active = null;
    player.bench = [];
  };
  const take = (p: number, id: string) => {
    const index = game.players[p].deck.findIndex((card) => card.def.id === id);
    assert(index >= 0, `evolution fixture contains ${id}`);
    return game.players[p].deck.splice(index, 1)[0];
  };
  reset(0);
  reset(1);
  const attacker = makePokemonInPlay(take(0, "nidoran-m"), 1);
  for (let i = 0; i < attachedEnergy; i++) attacker.energy.push(take(0, "grass-energy"));
  game.players[0].active = attacker;
  game.players[0].hand.push(...handIds.map((id) => take(0, id)));
  game.players[1].active = makePokemonInPlay(take(1, "munchlax"), 1);
  game.players[0].prizes = game.players[0].deck.splice(-6);
  game.players[1].prizes = game.players[1].deck.splice(-6);
  game.pending = null;
  game.current = 0;
  game.turnNumber = 3;
  game.players[0].turnsTaken = 2;
  game.players[1].turnsTaken = 2;
  const internals = game as unknown as {
    operations: unknown[];
    turnEnding: boolean;
    turnStarting: boolean;
  };
  internals.operations = [];
  internals.turnEnding = false;
  internals.turnStarting = false;
  return game;
}

function stalledPorygonFixture(withDiscardChoices = false): Game {
  const attackerDeck = [
    library.porygon,
    library.munchlax,
    library["water-energy"],
    library["fighting-energy"],
    library["fighting-energy"],
    library["energy-switch"],
    ...Array.from({ length: 54 }, () => library.munchlax),
  ];
  const defenderDeck = [
    library.magcargo,
    library["fire-energy"],
    ...Array.from({ length: 58 }, () => library.munchlax),
  ];
  const game = new Game(library, attackerDeck, defenderDeck, ["Porygon AI", "Magcargo AI"], 808);
  const reset = (p: number) => {
    const player = game.players[p];
    if (player.active) player.deck.push(player.active.card, ...player.active.energy);
    for (const pokemon of player.bench)
      player.deck.push(pokemon.card, ...pokemon.energy);
    player.deck.push(...player.hand, ...player.prizes);
    player.hand = [];
    player.prizes = [];
    player.active = null;
    player.bench = [];
  };
  const take = (p: number, id: string) => {
    const index = game.players[p].deck.findIndex((card) => card.def.id === id);
    assert(index >= 0, `stalled Porygon fixture contains ${id}`);
    return game.players[p].deck.splice(index, 1)[0];
  };
  reset(0);
  reset(1);
  const porygon = makePokemonInPlay(take(0, "porygon"), 1);
  porygon.energy.push(take(0, "water-energy"));
  const munchlax = makePokemonInPlay(take(0, "munchlax"), 1);
  munchlax.energy.push(take(0, "fighting-energy"));
  game.players[0].active = porygon;
  game.players[0].bench = [munchlax];
  const magcargo = makePokemonInPlay(take(1, "magcargo"), 1);
  magcargo.energy.push(take(1, "fire-energy"));
  game.players[1].active = magcargo;
  if (withDiscardChoices) {
    game.players[0].hand.push(take(0, "energy-switch"), take(0, "fighting-energy"));
  }
  game.players[0].prizes = game.players[0].deck.splice(-6);
  game.players[1].prizes = game.players[1].deck.splice(-6);
  game.pending = null;
  game.current = 0;
  game.turnNumber = 17;
  game.players[0].turnsTaken = 8;
  game.players[1].turnsTaken = 8;
  const internals = game as unknown as {
    operations: unknown[];
    turnEnding: boolean;
    turnStarting: boolean;
  };
  internals.operations = [];
  internals.turnEnding = false;
  internals.turnStarting = false;
  return game;
}

function readyMagcargoFixture(): Game {
  const attackerDeck = [
    library.magcargo,
    library["fire-energy"],
    library["fire-energy"],
    library["fire-energy"],
    ...Array.from({ length: 56 }, () => library.munchlax),
  ];
  const defenderDeck = [
    library["palkia-ex"],
    ...Array.from({ length: 59 }, () => library.munchlax),
  ];
  const game = new Game(library, attackerDeck, defenderDeck, ["Magcargo AI", "Palkia AI"], 811);
  const reset = (p: number) => {
    const player = game.players[p];
    if (player.active) player.deck.push(player.active.card, ...player.active.energy);
    for (const pokemon of player.bench)
      player.deck.push(pokemon.card, ...pokemon.energy);
    player.deck.push(...player.hand, ...player.prizes);
    player.hand = [];
    player.prizes = [];
    player.active = null;
    player.bench = [];
  };
  const take = (p: number, id: string) => {
    const index = game.players[p].deck.findIndex((card) => card.def.id === id);
    assert(index >= 0, `ready Magcargo fixture contains ${id}`);
    return game.players[p].deck.splice(index, 1)[0];
  };
  reset(0);
  reset(1);
  const magcargo = makePokemonInPlay(take(0, "magcargo"), 1);
  magcargo.energy.push(take(0, "fire-energy"), take(0, "fire-energy"));
  game.players[0].active = magcargo;
  game.players[0].hand.push(take(0, "fire-energy"));
  const palkia = makePokemonInPlay(take(1, "palkia-ex"), 1);
  palkia.damage = 70;
  game.players[1].active = palkia;
  game.players[0].prizes = game.players[0].deck.splice(-6);
  game.players[1].prizes = game.players[1].deck.splice(-6);
  game.players[0].attachedEnergyTurn = null;
  game.pending = null;
  game.current = 0;
  game.turnNumber = 17;
  game.players[0].turnsTaken = 8;
  game.players[1].turnsTaken = 8;
  const internals = game as unknown as {
    operations: unknown[];
    turnEnding: boolean;
    turnStarting: boolean;
  };
  internals.operations = [];
  internals.turnEnding = false;
  internals.turnStarting = false;
  return game;
}

{
  const game = readyGame();
  const snapshot = game.toSnapshot();
  const restored = Game.fromSnapshot(snapshot, library);
  assert(
    JSON.stringify(restored.getLegalActions()) === JSON.stringify(game.getLegalActions()),
    "snapshot restore preserves legal actions"
  );
  assert(restored.revision === game.revision, "snapshot restore preserves revision");
}

{
  const game = readyGame();
  const point = game.getDecisionPoint()!;
  const option = point.options[0];
  const planned = parsePrincipalVariation([JSON.stringify({
    kind: option.decision.kind,
    point: point.id,
    informationKey: option.informationKey,
  })]);
  assert(planned.length === 1, "principal variation retains action decisions");
  assert(
    JSON.stringify(matchPlannedDecision(point, planned[0])) === JSON.stringify(option.decision),
    "planned action matches the next semantic decision point"
  );
}

{
  const admin: TrainerCardDef = {
    id: "test-admin",
    name: "Test Admin",
    supertype: "Trainer",
    kind: "Item",
    effects: [{ op: "shuffleHandDraw", who: "self", count: 5 }],
  };
  const knowledgeLibrary = { ...library, [admin.id]: admin };
  const deck = [
    admin,
    library["energy-search"],
    ...Array.from({ length: 10 }, () => library["fighting-energy"]),
    ...Array.from({ length: 48 }, () => library.munchlax),
  ];
  const game = new Game(knowledgeLibrary, deck, deck, ["Knower", "Observer"], 303);
  while (game.pending) game.applyDecision(game.getDecisionPoint()!.options[0].decision);
  game.current = 0;
  const moveToHand = (id: string) => {
    const player = game.players[0];
    const held = player.hand.find((card) => card.def.id === id);
    if (held) return held;
    const zone = [player.deck, player.prizes].find((cards) => cards.some((card) => card.def.id === id));
    assert(!!zone, `knowledge fixture contains ${id}`);
    const index = zone!.findIndex((card) => card.def.id === id);
    const card = zone!.splice(index, 1)[0];
    game.players[0].hand.push(card);
    return card;
  };
  const search = moveToHand("energy-search");
  game.perform({ type: "playTrainer", handUid: search.uid });
  const energy = game.pending!.options.find((option) => option.informationKey === "search:fighting-energy");
  assert(!!energy, "Energy Search offers Fighting Energy");
  game.applyDecision({ kind: "choice", choiceId: game.pending!.id!, optionId: energy!.id! });
  assert(Object.keys(game.toSnapshot().knownOpponentHands[1]).length === 1, "revealed search card is remembered");
  const adminCard = moveToHand("test-admin");
  game.perform({ type: "playTrainer", handUid: adminCard.uid });
  assert(Object.keys(game.toSnapshot().knownOpponentHands[1]).length === 0, "shuffling the hand clears revealed-card knowledge");
}

{
  const allBasics = Array.from({ length: 60 }, () => library.munchlax);
  const game = new Game(library, allBasics, allBasics, ["Setup A", "Setup B"], 91);
  assert(!!game.pending, "all-Basic setup creates a pending starting choice");
  const snapshot = JSON.parse(JSON.stringify(game.toSnapshot()));
  const restored = Game.fromSnapshot(snapshot, library);
  assert(
    JSON.stringify(restored.getDecisionPoint()) === JSON.stringify(game.getDecisionPoint()),
    "pending decision survives JSON snapshot roundtrip"
  );
  const searched = searchDecision(
    game.getInformationState(game.pending!.player), library,
    { seed: 92, maxIterations: 16 }
  );
  assert(searched.decision.kind === "choice", "expert search accepts a pending choice at the root");
  const decision = game.getDecisionPoint()!.options[0].decision;
  game.applyDecision(decision);
  restored.applyDecision(decision);
  assert(
    JSON.stringify(restored.toSnapshot()) === JSON.stringify(game.toSnapshot()),
    "restored pending operation resolves identically"
  );
}

{
  const game = combatFixture();
  const result = searchDecision(game.getInformationState(0), library, {
    seed: 19,
    maxIterations: 96,
  });
  assert(
    result.decision.kind === "action" &&
      result.decision.action.type === "attack" &&
      result.decision.action.index === 1,
    "general AI search takes a forced winning KO"
  );
  const timed = searchDecision(game.getInformationState(0), library, {
    seed: 20,
    deadlineMs: 2,
  });
  assert(timed.elapsedMs < 100, "deadline search returns promptly with a legal decision");
}

{
  const game = stalledPorygonFixture();
  const fallback = chooseSetupAwareAction(game);
  assert(
    fallback.type === "retreat" && fallback.benchIndex === 0,
    "general AI retreats from a fully blocked attack into a useful status attacker"
  );
  const searched = searchDecision(game.getInformationState(0), library, {
    seed: 809,
    maxIterations: 128,
  });
  assert(
    searched.decision.kind === "action" && searched.decision.action.type === "retreat",
    "expert search escapes the Porygon-versus-Magcargo deadlock"
  );
}

{
  const game = stalledPorygonFixture(true);
  game.perform({ type: "usePower", target: { p: 0, slot: "active" } });
  assert(!!game.pending, "Data Transfer requests a discard choice");
  const selected = chooseOptionSeeded(game.pending!, new SeededRng(810));
  assert(
    game.pending!.options[selected].informationKey === "discard-hand:energy-switch",
    "Data Transfer preserves useful Energy when a less valuable discard is available"
  );
}

{
  const game = readyMagcargoFixture();
  const attachment = game.getLegalActions().find((action) => action.type === "attachEnergy");
  assert(!!attachment, "Magcargo can receive its third Energy");
  game.perform(attachment!);
  assert(
    game.getLegalActions().some((action) => action.type === "attack" && action.index === 0),
    "Molten Blast is legal after the third Energy is attached"
  );
  assert(
    !isPlannedDecisionReusable(game, { kind: "action", action: { type: "pass" } }),
    "a cached end-turn plan is rejected when Molten Blast can attack"
  );
  const searched = searchDecision(game.getInformationState(0), library, {
    seed: 812,
    maxIterations: 128,
  });
  assert(
    searched.decision.kind === "action" && searched.decision.action.type === "attack",
    "general AI takes Magcargo's available knockout"
  );
}

{
  const game = evolutionSearchFixture(["grass-energy"]);
  const setup = chooseSetupAwareAction(game);
  assert(setup.type === "attachEnergy", "useful Energy is attached before an available attack");
  const turn = game.turnNumber;
  game.perform(setup);
  assert(game.turnNumber === turn, "Energy setup keeps the current turn open");
  const finisher = chooseSetupAwareAction(game);
  assert(finisher.type === "attack", "AI attacks after useful Energy setup is complete");
}

{
  const game = evolutionSearchFixture(["poke-ball"], 2);
  const pokeBall = game.players[0].hand[0];
  const pokeBallDef = pokeBall.def as TrainerCardDef;
  assert(
    game.getEffectsAiValue(pokeBallDef.effects, 0) > USEFUL_SETUP_SCORE,
    "Poke Ball has useful expected value when an Evolution target is in the deck"
  );

  const nidorino = game.players[0].deck.find((card) => card.def.id === "nidorino")!;
  const nidoking = game.players[0].deck.find((card) => card.def.id === "nidoking-ex")!;
  const neededScore = searchCardChoiceScore(game, nidorino, 0);
  const futureScore = searchCardChoiceScore(game, nidoking, 0);
  assert(neededScore > futureScore, "search prefers the directly usable Stage 1 over a future Stage 2");
  const duplicateIndex = game.players[0].deck.findIndex(
    (card) => card.def.id === "nidorino" && card.uid !== nidorino.uid
  );
  assert(duplicateIndex >= 0, "fixture contains a duplicate Nidorino");
  const duplicate = game.players[0].deck.splice(duplicateIndex, 1)[0];
  game.players[0].hand.push(duplicate);
  const duplicateScore = searchCardChoiceScore(game, nidorino, 0);
  assert(duplicateScore < neededScore, "search discounts an Evolution already held in hand");
  game.players[0].hand.pop();
  game.players[0].deck.push(duplicate);

  const setup = chooseSetupAwareAction(game);
  assert(setup.type === "playTrainer", "Poke Ball is played before an available attack");
  (game as unknown as { rng: { next: () => number } }).rng = { next: () => 0.1 };
  game.perform(setup);
  assert(!!game.pending, "Poke Ball heads opens a Pokemon search choice");
  const selected = chooseOptionSeeded(game.pending!, new SeededRng(4));
  assert(
    game.pending!.options[selected].informationKey === "search:nidorino",
    "Poke Ball selects the Evolution matching the Pokemon in play"
  );
  game.resolvePending(selected);
  const evolution = chooseSetupAwareAction(game);
  assert(evolution.type === "evolve", "searched Evolution is played before attacking");
  game.perform(evolution);
  assert(
    chooseSetupAwareAction(game).type === "attack",
    "AI attacks after completing its search and evolution setup"
  );
}

{
  const game = evolutionSearchFixture(["poke-ball"]);
  const pokemon = game.players[0].deck.filter((card) => card.def.supertype === "Pokemon");
  game.players[0].deck = game.players[0].deck.filter((card) => card.def.supertype !== "Pokemon");
  game.players[0].discard.push(...pokemon);
  const pokeBall = game.players[0].hand[0].def as TrainerCardDef;
  assert(game.getEffectsAiValue(pokeBall.effects, 0) === 0, "empty Pokemon search has no setup value");
  assert(
    chooseSetupAwareAction(game).type === "attack",
    "useless Poke Ball does not delay an available attack"
  );
}

{
  const game = evolutionSearchFixture([]);
  const heads: Effect = { op: "damage", amount: 20, target: "defending" };
  const tails: Effect = { op: "recoil", amount: 20 };
  const flip: Effect = { op: "flip", heads: [heads], tails: [tails] };
  const expected = (game.getEffectAiValue(heads, 0) + game.getEffectAiValue(tails, 0)) / 2;
  assert(game.getEffectAiValue(flip, 0) === expected, "coin-flip value averages recursive heads and tails effects");
}

{
  const game = combatFixture();
  game.players[0].active!.def = library.crawdaunt as import("../src/model/cards").PokemonCardDef;
  game.players[0].active!.card.def = library.crawdaunt;
  game.players[1].hand.push(game.players[1].deck.pop()!);
  game.perform({ type: "attack", index: 1 });
  assert(game.pending?.player === 1, "opponent chooses their own Scavenger's Snatch discard");
  let blocked = false;
  try {
    game.getInformationState(0);
  } catch {
    blocked = true;
  }
  assert(blocked, "non-actor cannot serialize another player's private pending choice");
  const defenderInformation = game.getInformationState(1);
  assert(
    defenderInformation.snapshot.players[1].hand[0].def.id === game.players[1].hand[0].def.id,
    "decision actor retains access to their own hand"
  );
}

{
  const game = combatFixture();
  game.players[0].active!.def = library.machoke as import("../src/model/cards").PokemonCardDef;
  game.players[0].active!.card.def = library.machoke;
  game.players[1].active!.damage = 20;
  game.perform({ type: "attack", index: 1 });
  assert(!!game.pending, "Body Blow asks how much Energy to discard");
  const discardIndex = game.pending!.options.findIndex((option) => option.label.startsWith("Discard"));
  game.resolvePending(discardIndex);
  assert(!!game.pending, "Body Blow offers another discard after the first");
  const stopIndex = chooseOptionSeeded(game.pending!, new SeededRng(1));
  assert(game.pending!.options[stopIndex].informationKey === "stop-discarding", "optional discard stops at exact lethal");
  game.resolvePending(stopIndex);
  assert(game.players[0].active!.energy.length === 2, "surplus Energy is preserved after lethal damage");
}

{
  const game = combatFixture();
  game.players[0].active!.condition = "confused";
  const snapshot = game.toSnapshot();
  const outcomes = new Set<string>();
  for (let chanceSeed = 1; chanceSeed <= 32; chanceSeed++) {
    const sampled = Game.fromSnapshot(snapshot, library, chanceSeed);
    sampled.applyDecision({ kind: "action", action: { type: "attack", index: 1 } });
    outcomes.add(sampled.players[0].active?.damage === 30 ? "tails" : "heads");
  }
  assert(outcomes.has("heads") && outcomes.has("tails"), "independent chance seeds sample both coin outcomes");
  const first = Game.fromSnapshot(snapshot, library, 123);
  const second = Game.fromSnapshot(snapshot, library, 123);
  first.applyDecision({ kind: "action", action: { type: "attack", index: 1 } });
  second.applyDecision({ kind: "action", action: { type: "attack", index: 1 } });
  assert(JSON.stringify(first.toSnapshot()) === JSON.stringify(second.toSnapshot()), "chance seed is reproducible");
}

{
  const game = readyGame();
  const information = game.getInformationState(0);
  const sampled = determinize(information, library, 42);
  assert(
    JSON.stringify(cardIds(sampled.players[0].hand)) ===
      JSON.stringify(cardIds(information.snapshot.players[0].hand)),
    "determinization preserves the observer hand"
  );
  for (let p = 0; p < 2; p++) {
    const player = sampled.players[p];
    const total =
      player.hand.length + player.deck.length + player.prizes.length + player.discard.length +
      (player.active ? 1 + player.active.underneath.length + player.active.energy.length + (player.active.tool ? 1 : 0) : 0) +
      player.bench.reduce(
        (sum, pokemon) => sum + 1 + pokemon.underneath.length + pokemon.energy.length + (pokemon.tool ? 1 : 0),
        0
      ) +
      (sampled.stadium?.owner === p ? 1 : 0);
    assert(total === sampled.initialDeckIds[p].length, `determinization preserves player ${p} card count`);
  }
}

{
  const game = readyGame();
  const knownCard = game.players[1].hand[0];
  const information = game.getInformationState(0);
  const redactedHandIds = new Set(
    information.snapshot.players[1].hand.map((card) => card.def.id)
  );
  assert(redactedHandIds.size === 1, "opponent hand identities are redacted before search");
  information.snapshot.knownOpponentHands[0][knownCard.uid] = knownCard.def.id;
  const sampled = determinize(information, library, 4242);
  assert(
    sampled.players[1].hand.find((card) => card.uid === knownCard.uid)?.def.id === knownCard.def.id,
    "determinization pins publicly known opponent-hand cards"
  );
}

{
  const missing = effectRegistryCoverage().filter((entry) => !entry.hasAiValue);
  assert(missing.length === 0, `every registered effect declares tactical value: ${missing.map((e) => e.op).join(", ")}`);
}

{
  const game = readyGame();
  game.players[0].deck = game.players[0].deck.slice(0, 1);
  assert(
    game.getEffectAiValue({ op: "draw", count: 2 }, 0) < 0,
    "draw valuation avoids self-inflicted deck-out"
  );
}

{
  const information = readyGame().getInformationState(0);
  const first = searchDecision(information, library, { seed: 77, maxIterations: 32 });
  const second = searchDecision(information, library, { seed: 77, maxIterations: 32 });
  assert(JSON.stringify(first.decision) === JSON.stringify(second.decision), "seeded search is reproducible");

  const hidden = information.snapshot.players[1];
  const cards = [...hidden.hand, ...hidden.deck, ...hidden.prizes];
  const defs = cards.map((card) => card.def).reverse();
  cards.forEach((card, index) => { card.def = defs[index]; });
  const permuted = searchDecision(information, library, { seed: 77, maxIterations: 32 });
  assert(
    JSON.stringify(first.decision) === JSON.stringify(permuted.decision),
    "search does not depend on actual opponent hidden identities"
  );
}

for (const [deckIndex, deckName] of deckNames.entries()) {
  const game = new Game(
    library,
    buildDeck(decks[deckName], library),
    buildDeck(decks[deckName], library),
    ["General AI", "Opponent"],
    10_000 + deckIndex
  );
  const setupRng = new SeededRng(20_000 + deckIndex);
  let setupChoices = 0;
  while (game.pending && setupChoices++ < 20) {
    game.resolvePending(chooseOptionSeeded(game.pending, setupRng));
  }
  assert(!game.pending, `${deckName}: setup reaches a general AI action decision`);
  const revision = game.revision;
  const result = searchDecision(game.getInformationState(game.current), library, {
    seed: 30_000 + deckIndex,
    maxIterations: 8,
    maxDecisions: 30,
    turnHorizon: 1,
  });
  game.applyDecision(result.decision);
  assert(game.revision > revision, `${deckName}: general AI applies a legal decision`);
}

console.log("AI snapshot, determinization, fairness, and reproducibility regressions passed");
