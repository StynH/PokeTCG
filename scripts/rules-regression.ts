import cardsJson from "../src/data/cards.json";
import { Game } from "../src/engine/game";
import { makePokemonInPlay } from "../src/core/state";
import { buildLibrary } from "../src/model/loader";
import type { CardDef, CardInstance } from "../src/model/cards";

const library = buildLibrary(cardsJson as CardDef[]);
let uid = 100_000;

function instance(id: string): CardInstance {
  const def = library[id];
  if (!def) throw new Error(`Missing test card: ${id}`);
  return { uid: uid++, def };
}

function configuredGame(
  attackerId: string,
  defenderId: string,
  energyIds: string[]
): Game {
  const filler = library.munchlax;
  const deck = Array.from({ length: 60 }, () => filler);
  const game = new Game(library, deck, deck, ["Attacker", "Defender"], 7);
  const attacker = makePokemonInPlay(instance(attackerId), 1);
  attacker.energy.push(...energyIds.map(instance));
  const defender = makePokemonInPlay(instance(defenderId), 1);

  game.pending = null;
  game.current = 0;
  game.turnNumber = 3;
  game.players[0].active = attacker;
  game.players[0].bench = [];
  game.players[0].hand = [];
  game.players[0].turnsTaken = 2;
  game.players[1].active = defender;
  game.players[1].bench = [];
  game.players[1].hand = [];
  game.players[1].turnsTaken = 2;
  const internals = game as unknown as {
    thunks: Array<() => void>;
    turnEnding: boolean;
    turnStarting: boolean;
  };
  internals.thunks = [];
  internals.turnEnding = false;
  internals.turnStarting = false;
  game.log.length = 0;
  return game;
}

function attack(game: Game, name: string): void {
  const index = game.players[0].active?.def.attacks.findIndex((candidate) => candidate.name === name) ?? -1;
  if (index < 0) throw new Error(`Missing test attack: ${name}`);
  game.perform({ type: "attack", index });
}

function assertEqual(actual: unknown, expected: unknown, scenario: string): void {
  if (actual !== expected)
    throw new Error(`${scenario}: expected ${String(expected)}, received ${String(actual)}`);
}

{
  const game = configuredGame(
    "feraligatr",
    "blaziken",
    ["water-energy", "water-energy", "water-energy"]
  );
  attack(game, "Overpowering Fang");
  assertEqual(
    game.log.some((line) => line.includes("Blaziken takes 140 damage")),
    true,
    "Weakness applies after conditional bonus damage"
  );
}

{
  const game = configuredGame(
    "feraligatr",
    "rayquaza-ex",
    ["water-energy", "water-energy", "water-energy"]
  );
  attack(game, "Overpowering Fang");
  assertEqual(
    game.players[1].active?.damage,
    40,
    "Resistance is subtracted once from total attack damage"
  );
}

{
  const game = configuredGame(
    "light-hitmonlee",
    "skarmory",
    ["fighting-energy", "fighting-energy", "fighting-energy"]
  );
  attack(game, "Precise Kick");
  assertEqual(game.players[1].active?.damage, 30, "Precise Kick ignores Resistance");
}

{
  const game = configuredGame(
    "lucario-ex",
    "munchlax",
    ["fighting-energy", "fighting-energy"]
  );
  attack(game, "Precise Strike");
  assertEqual(game.players[1].active?.damage, 30, "Precise Strike ignores Weakness and Resistance");
}

{
  const game = configuredGame(
    "absol",
    "lairon",
    ["darkness-energy", "fighting-energy"]
  );
  attack(game, "Faint Attack");
  assertEqual(game.players[1].active?.damage, 40, "Faint Attack ignores effects on the defender");
}

console.log("Weakness and Resistance regressions passed");
