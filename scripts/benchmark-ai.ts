import cardsJson from "../src/data/cards.json";
import decksJson from "../src/data/decks.json";
import { searchDecision } from "../src/ai/ismcts";
import { BALANCED } from "../src/ai/profiles";
import { chooseActionSeeded, chooseOptionSeeded } from "../src/ai/simpleAI";
import { SeededRng } from "../src/core/rng";
import { Game } from "../src/engine/game";
import type { CardDef } from "../src/model/cards";
import { buildDeck, buildLibrary } from "../src/model/loader";

const library = buildLibrary(cardsJson as CardDef[]);
const decks = decksJson as Record<string, Record<string, number>>;
const seedPairs = Number(process.argv[2] ?? 5);
const iterations = Number(process.argv[3] ?? 128);
const deckLimit = Number(process.argv[4] ?? Object.keys(decks).length);
const names = Object.keys(decks).slice(0, deckLimit);
const mirrorOnly = process.argv[5] === "mirror";

let wins = 0;
let losses = 0;
let failures = 0;
let decisions = 0;
let totalIterations = 0;
const perDeck = new Map<string, { wins: number; games: number }>();
const expertActions = new Map<string, number>();
const legacyActions = new Map<string, number>();
const countAction = (counts: Map<string, number>, type: string) =>
  counts.set(type, (counts.get(type) ?? 0) + 1);

function wilsonLower(successes: number, total: number): number {
  if (total === 0) return 0;
  const z = 1.959963984540054;
  const p = successes / total;
  const denominator = 1 + z * z / total;
  const center = p + z * z / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * total)) / total);
  return (center - margin) / denominator;
}

for (let expertDeck = 0; expertDeck < names.length; expertDeck++) {
  const opponentDecks = mirrorOnly ? [expertDeck] : names.map((_, index) => index);
  for (const legacyDeck of opponentDecks) {
    for (let pair = 0; pair < seedPairs; pair++) {
      for (let expertSeat = 0; expertSeat < 2; expertSeat++) {
        const seatDecks = expertSeat === 0
          ? [names[expertDeck], names[legacyDeck]]
          : [names[legacyDeck], names[expertDeck]];
        const game = new Game(
          library,
          buildDeck(decks[seatDecks[0]], library),
          buildDeck(decks[seatDecks[1]], library),
          ["Seat 0", "Seat 1"],
          10_000 + expertDeck * 1000 + legacyDeck * 100 + pair * 2
        );
        const legacyRng = new SeededRng(
          0x51a7 + expertDeck * 1000 + legacyDeck * 100 + pair * 2 + expertSeat
        );
        let steps = 0;
        while (game.phase === "playing" && steps++ < 4000) {
          const actor = game.pending?.player ?? game.current;
          if (game.pending) {
            game.resolvePending(chooseOptionSeeded(game.pending, BALANCED, legacyRng));
          } else if (actor === expertSeat) {
            const result = searchDecision(game.getInformationState(actor), library, BALANCED, {
              seed: 0xabc000 + steps * 31 + pair,
              maxIterations: iterations,
            });
            if (result.decision.kind === "action") countAction(expertActions, result.decision.action.type);
            game.applyDecision(result.decision);
            decisions++;
            totalIterations += result.iterations;
          } else {
            const action = chooseActionSeeded(game, BALANCED, legacyRng);
            countAction(legacyActions, action.type);
            game.perform(action);
          }
        }
        const record = perDeck.get(names[expertDeck]) ?? { wins: 0, games: 0 };
        record.games++;
        if (game.phase !== "finished" || game.winner === null) failures++;
        else if (game.winner === expertSeat) { wins++; record.wins++; }
        else losses++;
        perDeck.set(names[expertDeck], record);
      }
    }
  }
}

const games = wins + losses;
console.log(JSON.stringify({
  games,
  wins,
  losses,
  failures,
  pointWinRate: games ? wins / games : 0,
  wilson95Lower: wilsonLower(wins, games),
  expertDecisions: decisions,
  meanIterations: decisions ? totalIterations / decisions : 0,
  expertActions: Object.fromEntries(expertActions),
  legacyActions: Object.fromEntries(legacyActions),
  perDeck: Object.fromEntries(
    [...perDeck].map(([name, result]) => [name, { ...result, winRate: result.wins / result.games }])
  ),
}, null, 2));

process.exit(failures === 0 ? 0 : 1);
