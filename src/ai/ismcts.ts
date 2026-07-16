import { SeededRng } from "../core/rng";
import type { Decision, Game, InformationState } from "../engine/game";
import { Game as GameEngine } from "../engine/game";
import type { CardLibrary } from "../model/cards";
import { determinize } from "./determinize";
import { chooseSetupAwareAction, evaluatePosition, heuristicActionScore } from "./simpleAI";

export interface SearchConfig {
  seed: number;
  deadlineMs?: number;
  maxIterations?: number;
  maxDecisions?: number;
  turnHorizon?: number;
}

export interface SearchResult {
  decision: Decision;
  iterations: number;
  elapsedMs: number;
  principalVariation: string[];
}

interface Edge {
  key: string;
  decision: Decision;
  prior: number;
  visits: number;
  value: number;
  availability: number;
  child: Node;
}

interface Node {
  visits: number;
  edges: Map<string, Edge>;
}

function decisionKey(game: Game, decision: Decision): string {
  const point = game.getDecisionPoint();
  const optionId = decision.kind === "choice"
    ? decision.optionId
    : JSON.stringify(decision.action);
  const option = point?.options.find((candidate) => candidate.id === optionId);
  return JSON.stringify({
    kind: decision.kind,
    point: point?.id ?? (decision.kind === "choice" ? decision.choiceId : optionId),
    informationKey: option?.informationKey ?? optionId,
  });
}

function decisionCategory(decision: Decision): string {
  return decision.kind === "choice" ? "choice" : decision.action.type;
}

function decisionPrior(game: Game, decision: Decision): number {
  if (decision.kind === "choice") {
    const option = game.pending?.options.find((candidate, index) =>
      (candidate.id ?? `option:${index}`) === decision.optionId
    );
    return Math.tanh((option?.aiScore ?? 0) / 100);
  }
  return Math.tanh(heuristicActionScore(game, decision.action) / 100);
}

function leafValue(game: Game, observer: number): number {
  if (game.phase === "finished") return game.winner === observer ? 1 : -1;
  return Math.tanh(evaluatePosition(game, observer) / 1800);
}

function chooseRolloutDecision(
  game: Game,
  rng: SeededRng
): Decision | null {
  const point = game.getDecisionPoint();
  if (!point || point.options.length === 0) return null;
  if (point.options[0].decision.kind === "choice") {
    const scored = point.options.map((option) => ({
      decision: option.decision,
      score: decisionPrior(game, option.decision) + rng.next() * 0.025,
    }));
    return scored.sort((a, b) => b.score - a.score)[0].decision;
  }
  return {
    kind: "action",
    action: chooseSetupAwareAction(game, rng),
  };
}

function rollout(
  game: Game,
  observer: number,
  rng: SeededRng,
  rootTurn: number,
  config: Required<Pick<SearchConfig, "maxDecisions" | "turnHorizon">>,
  decisions: number
): number {
  while (
    game.phase === "playing" &&
    decisions++ < config.maxDecisions &&
    game.turnNumber - rootTurn < config.turnHorizon
  ) {
    const decision = chooseRolloutDecision(game, rng);
    if (!decision) break;
    game.applyDecision(decision);
  }
  return leafValue(game, observer);
}

function principalVariation(root: Node): string[] {
  const result: string[] = [];
  let node = root;
  for (let depth = 0; depth < 32; depth++) {
    const edge = [...node.edges.values()].sort((a, b) => b.visits - a.visits)[0];
    if (!edge || edge.visits === 0) break;
    result.push(edge.key);
    node = edge.child;
  }
  return result;
}

export function searchDecision(
  information: InformationState,
  library: CardLibrary,
  config: SearchConfig
): SearchResult {
  const started = performance.now();
  const deadline = started + (config.deadlineMs ?? Infinity);
  const maxIterations = config.maxIterations ?? Infinity;
  const remainingPrizes = information.snapshot.players
    .reduce((total, player) => total + player.prizes.length, 0);
  const limits = {
    maxDecisions: config.maxDecisions ?? 200,
    turnHorizon: config.turnHorizon ?? (remainingPrizes <= 4 ? 7 : 5),
  };
  const root = { visits: 0, edges: new Map<string, Edge>() };
  const seedRng = new SeededRng(config.seed);
  const guidanceVotes = new Map<string, number>();
  const guidanceWorlds = Number.isFinite(maxIterations)
    ? Math.min(6, Math.max(2, Math.floor(maxIterations / 32)))
    : 6;
  let guidanceTotal = 0;

  for (let world = 0; world < guidanceWorlds && performance.now() < deadline; world++) {
    const hiddenSeed = Math.floor(seedRng.next() * 0xffffffff);
    const chanceSeed = Math.floor(seedRng.next() * 0xffffffff);
    const game = GameEngine.fromSnapshot(
      determinize(information, library, hiddenSeed), library, chanceSeed
    );
    const guided = chooseRolloutDecision(game, new SeededRng(chanceSeed ^ 0x85ebca6b));
    if (guided) {
      const key = decisionKey(game, guided);
      guidanceVotes.set(key, (guidanceVotes.get(key) ?? 0) + 1);
      guidanceTotal++;
    }
  }
  let iterations = 0;

  while (iterations < maxIterations && performance.now() < deadline) {
    const hiddenSeed = Math.floor(seedRng.next() * 0xffffffff);
    const chanceSeed = Math.floor(seedRng.next() * 0xffffffff);
    const game = GameEngine.fromSnapshot(
      determinize(information, library, hiddenSeed), library, chanceSeed
    );
    const simulationRng = new SeededRng(chanceSeed ^ 0x9e3779b9);
    const path: Edge[] = [];
    let node = root;
    let decisions = 0;
    const rootTurn = game.turnNumber;
    let expanded = false;

    while (
      game.phase === "playing" &&
      decisions++ < limits.maxDecisions &&
      game.turnNumber - rootTurn < limits.turnHorizon
    ) {
      const point = game.getDecisionPoint();
      if (!point || point.options.length === 0) break;
      const legal = new Map<string, { decision: Decision; prior: number }>();
      for (const option of point.options) {
        const key = decisionKey(game, option.decision);
        if (!legal.has(key))
          legal.set(key, {
            decision: option.decision,
            prior: decisionPrior(game, option.decision),
          });
      }
      for (const [key] of legal) {
        const edge = node.edges.get(key);
        if (edge) edge.availability++;
      }

      const width = Math.max(1, Math.ceil(2 * Math.sqrt(node.visits + 1)));
      const expandedCategories = new Set(
        [...node.edges.values()].map((candidate) => decisionCategory(candidate.decision))
      );
      const unexpanded = [...legal.entries()]
        .filter(([key]) => !node.edges.has(key))
        .sort((a, b) => {
          const aNovel = expandedCategories.has(decisionCategory(a[1].decision)) ? 0 : 1;
          const bNovel = expandedCategories.has(decisionCategory(b[1].decision)) ? 0 : 1;
          return bNovel - aNovel || b[1].prior - a[1].prior;
        });
      let edge: Edge | undefined;
      if (unexpanded.length > 0 && node.edges.size < width) {
        const [key, candidate] = unexpanded[0];
        edge = {
          key,
          decision: candidate.decision,
          prior: candidate.prior,
          visits: 0,
          value: 0,
          availability: 1,
          child: { visits: 0, edges: new Map() },
        };
        node.edges.set(key, edge);
        expanded = true;
      } else {
        const actorSign = point.actor === information.observer ? 1 : -1;
        let bestScore = -Infinity;
        for (const [key, candidate] of legal) {
          const current = node.edges.get(key);
          if (!current) continue;
          const mean = current.visits > 0 ? current.value / current.visits : 0;
          const exploration = Math.sqrt(
            1.4 * Math.log(current.availability + 1) / (current.visits + 1)
          );
          const score = actorSign * mean + exploration + candidate.prior * 0.15 / (current.visits + 1);
          if (score > bestScore) {
            bestScore = score;
            edge = current;
          }
        }
      }
      if (!edge) break;
      game.applyDecision(legal.get(edge.key)?.decision ?? edge.decision);
      path.push(edge);
      node = edge.child;
      if (expanded) break;
    }

    const value = rollout(
      game,
      information.observer,
      simulationRng,
      rootTurn,
      limits,
      decisions
    );
    root.visits++;
    for (const edge of path) {
      edge.visits++;
      edge.value += value;
      edge.child.visits++;
    }
    iterations++;
  }

  const rootCandidates = [...root.edges.values()];
  const minimumEvidence = Math.max(1, Math.floor(root.visits / Math.max(1, rootCandidates.length) / 3));
  const best = rootCandidates
    .filter((edge) => edge.visits >= minimumEvidence)
    .sort((a, b) => {
      const score = (edge: Edge) =>
        edge.value / edge.visits +
        edge.prior * 0.04 +
        (guidanceVotes.get(edge.key) ?? 0) / Math.max(1, guidanceTotal) * 0.24;
      return score(b) - score(a);
    })[0] ?? rootCandidates.sort((a, b) => b.visits - a.visits)[0];
  if (!best) {
    const game = GameEngine.fromSnapshot(
      determinize(information, library, config.seed), library, config.seed ^ 0x9e3779b9
    );
    const fallback = game.getDecisionPoint()?.options[0]?.decision;
    if (!fallback) throw new Error("AI has no legal decision");
    return { decision: fallback, iterations, elapsedMs: performance.now() - started, principalVariation: [] };
  }
  return {
    decision: best.decision,
    iterations,
    elapsedMs: performance.now() - started,
    principalVariation: principalVariation(root),
  };
}
