import cardsJson from "../src/data/cards.json";
import decksJson from "../src/data/decks.json";
import type { CardDef } from "../src/model/types";
import { buildDeck, buildLibrary } from "../src/model/loader";
import { Game } from "../src/engine/game";
import { chooseAction, chooseOption } from "../src/ai/simpleAI";
import { findProfile } from "../src/ai/profiles";

const library = buildLibrary(cardsJson as CardDef[]);
const decks = decksJson as Record<string, Record<string, number>>;
const deckNames = Object.keys(decks);
const gameCount = Number(process.argv[2] ?? 8);
const profiles = [findProfile(process.argv[3] ?? "Balanced"), findProfile(process.argv[4] ?? "Balanced")] as const;

const mechanics = new Map<string, number>();
const trackMechanic = (log: string[], needle: string, key: string) => {
  if (log.some((line) => line.includes(needle))) mechanics.set(key, (mechanics.get(key) ?? 0) + 1);
};

let failures = 0;
const wins = new Map<string, number>();

for (let g = 0; g < gameCount; g++) {
  const game = new Game(
    library,
    buildDeck(decks[deckNames[0]], library),
    buildDeck(decks[deckNames[1]], library),
    ["Fire", "Water"],
    4242 + g * 17
  );
  let steps = 0;
  while (game.phase === "playing" && steps++ < 4000) {
    if (game.pending) game.resolvePending(chooseOption(game.pending, profiles[game.pending.player]));
    else game.perform(chooseAction(game, profiles[game.current]));
  }
  if (game.phase !== "finished" || game.winner === null) {
    failures++;
    console.log(`game ${g}: STUCK after ${steps} steps`);
    continue;
  }
  const winner = game.players[game.winner].name;
  wins.set(winner, (wins.get(winner) ?? 0) + 1);
  console.log(`game ${g}: ${winner} wins in ${game.turnNumber} turns — ${game.winReason}`);
  trackMechanic(game.log, "plays Stadium", "stadiumPlayed");
  trackMechanic(game.log, "Strength Charm to", "toolAttached");
  trackMechanic(game.log, "Double Rainbow", "dreUsed");
  trackMechanic(game.log, "starts with", "setupChoice");
  trackMechanic(game.log, "weak! Damage doubled", "weakness");
  trackMechanic(game.log, "(Pokemon-ex!)", "exDoublePrize");
  trackMechanic(game.log, "promotes", "promotion");
  trackMechanic(game.log, "uses Firestarter", "pokePower");
  trackMechanic(game.log, "Rare Candy:", "rareCandy");
}

console.log("wins:", Object.fromEntries(wins));
console.log("mechanics seen (games):", Object.fromEntries(mechanics));
console.log(failures === 0 ? "ALL GAMES TERMINATED CLEANLY" : `${failures} STUCK GAMES`);
process.exit(failures === 0 ? 0 : 1);
