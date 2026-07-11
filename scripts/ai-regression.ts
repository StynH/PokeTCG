import cardsJson from "../src/data/cards.json";
import decksJson from "../src/data/decks.json";
import { determinize } from "../src/ai/determinize";
import { searchDecision } from "../src/ai/ismcts";
import { BALANCED, PRESETS } from "../src/ai/profiles";
import { chooseOptionSeeded } from "../src/ai/simpleAI";
import { SeededRng } from "../src/core/rng";
import { makePokemonInPlay } from "../src/core/state";
import { Game } from "../src/engine/game";
import type { CardDef, CardInstance, TrainerCardDef } from "../src/model/cards";
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
    game.getInformationState(game.pending!.player), library, BALANCED,
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
  for (const profile of PRESETS) {
    const result = searchDecision(game.getInformationState(0), library, profile, {
      seed: 19,
      maxIterations: 96,
    });
    assert(
      result.decision.kind === "action" &&
        result.decision.action.type === "attack" &&
        result.decision.action.index === 1,
      `${profile.name} search takes a forced winning KO`
    );
  }
  const timed = searchDecision(game.getInformationState(0), library, BALANCED, {
    seed: 20,
    deadlineMs: 2,
  });
  assert(timed.elapsedMs < 100, "deadline search returns promptly with a legal decision");
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
  const stopIndex = chooseOptionSeeded(game.pending!, BALANCED, new SeededRng(1));
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
  const first = searchDecision(information, library, BALANCED, { seed: 77, maxIterations: 32 });
  const second = searchDecision(information, library, BALANCED, { seed: 77, maxIterations: 32 });
  assert(JSON.stringify(first.decision) === JSON.stringify(second.decision), "seeded search is reproducible");

  const hidden = information.snapshot.players[1];
  const cards = [...hidden.hand, ...hidden.deck, ...hidden.prizes];
  const defs = cards.map((card) => card.def).reverse();
  cards.forEach((card, index) => { card.def = defs[index]; });
  const permuted = searchDecision(information, library, BALANCED, { seed: 77, maxIterations: 32 });
  assert(
    JSON.stringify(first.decision) === JSON.stringify(permuted.decision),
    "search does not depend on actual opponent hidden identities"
  );
}

console.log("AI snapshot, determinization, fairness, and reproducibility regressions passed");
