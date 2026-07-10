import cardsJson from "../src/data/cards.json";
import { Game } from "../src/engine/game";
import { makePokemonInPlay } from "../src/core/state";
import { buildLibrary } from "../src/model/loader";
import type { CardDef, CardInstance } from "../src/model/cards";
import type { SlotRef } from "../src/core/state";

export const library = buildLibrary(cardsJson as CardDef[]);
let uid = 200_000;

export function instance(id: string): CardInstance {
  const def = library[id];
  if (!def) throw new Error(`Missing card: "${id}"`);
  return { uid: uid++, def };
}

export interface BenchEntry {
  id: string;
  damage?: number;
  energy?: string[];
}

export interface GameSetup {
  attackerId: string;
  defenderId: string;
  attackerEnergy?: string[];
  defenderEnergy?: string[];
  attackerDamage?: number;
  defenderDamage?: number;
  attackerBench?: BenchEntry[];
  defenderBench?: BenchEntry[];
}

function benched(entry: BenchEntry) {
  const mon = makePokemonInPlay(instance(entry.id), 1);
  mon.damage = entry.damage ?? 0;
  for (const id of entry.energy ?? []) mon.energy.push(instance(id));
  return mon;
}

export function configuredGame(opts: GameSetup): Game {
  const filler = library["munchlax"];
  const deck = Array.from({ length: 60 }, () => filler);
  const game = new Game(library, deck, deck, ["Attacker", "Defender"], 42);

  const attacker = makePokemonInPlay(instance(opts.attackerId), 1);
  for (const id of opts.attackerEnergy ?? []) attacker.energy.push(instance(id));
  if (opts.attackerDamage) attacker.damage = opts.attackerDamage;

  const defender = makePokemonInPlay(instance(opts.defenderId), 1);
  for (const id of opts.defenderEnergy ?? []) defender.energy.push(instance(id));
  if (opts.defenderDamage) defender.damage = opts.defenderDamage;

  game.pending = null;
  game.current = 0;
  game.turnNumber = 3;
  game.players[0].active = attacker;
  game.players[0].bench = (opts.attackerBench ?? []).map(benched);
  game.players[0].hand = [];
  game.players[0].turnsTaken = 2;
  game.players[1].active = defender;
  game.players[1].bench = (opts.defenderBench ?? []).map(benched);
  game.players[1].hand = [];
  game.players[1].turnsTaken = 2;

  const internals = game as unknown as { thunks: Array<() => void>; turnEnding: boolean; turnStarting: boolean };
  internals.thunks = [];
  internals.turnEnding = false;
  internals.turnStarting = false;
  game.log.length = 0;
  return game;
}

export function attack(game: Game, name: string): void {
  const index = game.players[0].active?.def.attacks.findIndex((a) => a.name === name) ?? -1;
  if (index < 0) throw new Error(`Attack not found: "${name}"`);
  game.perform({ type: "attack", index });
}

export function attachEnergy(game: Game, energyId: string, target: SlotRef): void {
  const card = instance(energyId);
  game.players[target.p].hand.push(card);
  game.perform({ type: "attachEnergy", handUid: card.uid, target });
}
