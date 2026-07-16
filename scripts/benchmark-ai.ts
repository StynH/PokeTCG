import cardsJson from "../src/data/cards.json";
import decksJson from "../src/data/decks.json";
import { chooseActionSeeded, chooseOptionSeeded } from "../src/ai/simpleAI";
import { SeededRng } from "../src/core/rng";
import { HeadlessSearchAgent } from "../src/ai/headlessAgent";
import { Game } from "../src/engine/game";
import type { CardDef } from "../src/model/cards";
import { buildDeck, buildLibrary } from "../src/model/loader";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const library = buildLibrary(cardsJson as CardDef[]);
const decks = decksJson as Record<string, Record<string, number>>;
const seedPairs = Number(process.argv[2] ?? 5);
const iterations = Number(process.argv[3] ?? 128);
const deckSelection = process.argv[4] ?? "all";
const names = deckSelection === "all"
  ? Object.keys(decks)
  : Object.keys(decks).slice(0, Number(deckSelection));
const mirrorOnly = process.argv[5] === "mirror";
const outputArg = process.argv.find((argument) => argument.startsWith("--output="));

let wins = 0;
let losses = 0;
let failures = 0;
let decisions = 0;
let totalIterations = 0;
const perDeck = new Map<string, { wins: number; games: number }>();
const expertActions = new Map<string, number>();
const legacyActions = new Map<string, number>();
const expertChoices = new Map<string, number>();
let totalElapsedMs = 0;
let maxElapsedMs = 0;
let reusedPlans = 0;
let forcedDecisions = 0;
const matchups: Array<{ expertDeck: string; opponentDeck: string; seat: number; seed: number; winner: number | null }> = [];
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
        const expert = new HeadlessSearchAgent(library, iterations);
        let steps = 0;
        while (game.phase === "playing" && steps++ < 4000) {
          const actor = game.pending?.player ?? game.current;
          if (actor === expertSeat) {
            const result = expert.choose(game, 0xabc000 + steps * 31 + pair);
            if (result.decision.kind === "action") countAction(expertActions, result.decision.action.type);
            else countAction(expertChoices, game.pending?.prompt ?? "unknown");
            game.applyDecision(result.decision);
            decisions++;
            totalIterations += result.iterations;
            totalElapsedMs += result.elapsedMs;
            maxElapsedMs = Math.max(maxElapsedMs, result.elapsedMs);
            if (result.reusedPlan) reusedPlans++;
            if (result.forced) forcedDecisions++;
          } else if (game.pending) {
            game.resolvePending(chooseOptionSeeded(game.pending, legacyRng));
          } else {
            const action = chooseActionSeeded(game, legacyRng);
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
        matchups.push({
          expertDeck: names[expertDeck],
          opponentDeck: names[legacyDeck],
          seat: expertSeat,
          seed: 10_000 + expertDeck * 1000 + legacyDeck * 100 + pair * 2,
          winner: game.winner,
        });
      }
    }
  }
}

const games = wins + losses;
const pointWinRate = games ? wins / games : 0;
const releaseMode =
  seedPairs >= 20 && iterations >= 512 && names.length === Object.keys(decks).length && mirrorOnly;
const weakDecks = [...perDeck]
  .filter(([, result]) => result.games > 0 && result.wins / result.games < 0.4)
  .map(([name]) => name);
const releaseGate = {
  enabled: releaseMode,
  zeroFailures: failures === 0,
  withinFiveSeconds: maxElapsedMs <= 5000,
  aboveLegacy: pointWinRate > 0.5,
  weakDecks,
};
const searchedDecisions = decisions - reusedPlans - forcedDecisions;
const report = {
  games,
  wins,
  losses,
  failures,
  pointWinRate,
  wilson95Lower: wilsonLower(wins, games),
  expertDecisions: decisions,
  meanIterations: decisions ? totalIterations / decisions : 0,
  meanElapsedMs: decisions ? totalElapsedMs / decisions : 0,
  maxElapsedMs,
  reusedPlans,
  forcedDecisions,
  searchedDecisions,
  planReuseRate: decisions ? reusedPlans / decisions : 0,
  expertActions: Object.fromEntries(expertActions),
  expertChoices: Object.fromEntries(expertChoices),
  legacyActions: Object.fromEntries(legacyActions),
  perDeck: Object.fromEntries(
    [...perDeck].map(([name, result]) => [name, { ...result, winRate: result.wins / result.games }])
  ),
  matchups,
  releaseGate,
};
const json = JSON.stringify(report, null, 2);
console.log(json);
if (outputArg) {
  const outputPath = resolve(outputArg.slice("--output=".length));
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${json}\n`, "utf8");
}

const releasePassed = !releaseMode || (
  releaseGate.zeroFailures && releaseGate.withinFiveSeconds &&
  releaseGate.aboveLegacy && releaseGate.weakDecks.length === 0
);
process.exit(failures === 0 && releasePassed ? 0 : 1);
