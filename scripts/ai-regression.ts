import cardsJson from "../src/data/cards.json";
import decksJson from "../src/data/decks.json";
import { determinize } from "../src/ai/determinize";
import { searchDecision } from "../src/ai/ismcts";
import { BALANCED, PRESETS } from "../src/ai/profiles";
import { makePokemonInPlay } from "../src/core/state";
import { Game } from "../src/engine/game";
import type { CardDef, CardInstance } from "../src/model/cards";
import { buildDeck, buildLibrary } from "../src/model/loader";

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
    thunks: Array<() => void>;
    turnEnding: boolean;
    turnStarting: boolean;
  };
  internals.thunks = [];
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
