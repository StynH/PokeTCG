import { SeededRng } from "../core/rng";
import type { Decision, Game, InformationState } from "../engine/game";
import { Game as GameEngine } from "../engine/game";
import type { CardLibrary } from "../model/cards";
import type { AIProfile } from "./profiles";
import { BALANCED } from "./profiles";
import { determinize } from "./determinize";
import { evaluatePosition, heuristicActionScore } from "./simpleAI";

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
  if (decision.kind === "choice") return `${decision.choiceId}:${decision.optionId}`;
  const action = decision.action;
  if (!("handUid" in action)) return JSON.stringify(action);
  const cardId = game.players[game.current].hand.find((card) => card.uid === action.handUid)?.def.id;
  return JSON.stringify({ ...action, handUid: cardId ?? action.handUid });
}

function decisionPrior(game: Game, decision: Decision, profile: AIProfile): number {
  if (decision.kind === "choice") {
    const option = game.pending?.options.find((candidate, index) =>
      (candidate.id ?? `option:${index}`) === decision.optionId
    );
    return Math.tanh((option?.aiScore ?? 0) / 100);
  }
  return Math.tanh(heuristicActionScore(game, decision.action, profile.weights) / 100);
}

function leafValue(game: Game, observer: number, profile: AIProfile): number {
  if (game.phase === "finished") return game.winner === observer ? 1 : -1;
  const base = Math.tanh(evaluatePosition(game, observer, BALANCED.weights) / 1800);
  const styled = Math.tanh(evaluatePosition(game, observer, profile.weights) / 1800);
  const preference = Math.max(-0.03, Math.min(0.03, styled - base));
  return Math.max(-1, Math.min(1, base + preference));
}

function chooseRolloutDecision(game: Game, profile: AIProfile, rng: SeededRng): Decision | null {
  const point = game.getDecisionPoint();
  if (!point || point.options.length === 0) return null;
  let best = point.options[0].decision;
  let bestScore = -Infinity;
  for (const option of point.options) {
    const score = decisionPrior(game, option.decision, profile) + rng.next() * 0.025;
    if (score > bestScore) {
      bestScore = score;
      best = option.decision;
    }
  }
  return best;
}

function rollout(
  game: Game,
  observer: number,
  profile: AIProfile,
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
    const decision = chooseRolloutDecision(game, profile, rng);
    if (!decision) break;
    game.applyDecision(decision);
  }
  return leafValue(game, observer, profile);
}

function principalVariation(root: Node): string[] {
  const result: string[] = [];
  let node = root;
  for (let depth = 0; depth < 12; depth++) {
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
  profile: AIProfile,
  config: SearchConfig
): SearchResult {
  const started = performance.now();
  const deadline = started + (config.deadlineMs ?? Infinity);
  const maxIterations = config.maxIterations ?? Infinity;
  const limits = {
    maxDecisions: config.maxDecisions ?? 120,
    turnHorizon: config.turnHorizon ?? 3,
  };
  const root = { visits: 0, edges: new Map<string, Edge>() };
  const seedRng = new SeededRng(config.seed);
  let iterations = 0;

  while (iterations < maxIterations && performance.now() < deadline) {
    const iterationSeed = Math.floor(seedRng.next() * 0xffffffff);
    const game = GameEngine.fromSnapshot(determinize(information, library, iterationSeed), library);
    const simulationRng = new SeededRng(iterationSeed ^ 0x9e3779b9);
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
          legal.set(key, { decision: option.decision, prior: decisionPrior(game, option.decision, profile) });
      }
      for (const [key] of legal) {
        const edge = node.edges.get(key);
        if (edge) edge.availability++;
      }

      const width = Math.max(1, Math.ceil(2 * Math.sqrt(node.visits + 1)));
      const unexpanded = [...legal.entries()]
        .filter(([key]) => !node.edges.has(key))
        .sort((a, b) => b[1].prior - a[1].prior);
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
      profile,
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

  const best = [...root.edges.values()].sort((a, b) =>
    b.visits - a.visits || b.value / Math.max(1, b.visits) - a.value / Math.max(1, a.visits)
  )[0];
  if (!best) {
    const game = GameEngine.fromSnapshot(determinize(information, library, config.seed), library);
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
