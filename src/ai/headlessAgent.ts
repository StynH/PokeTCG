import type { Decision, Game } from "../engine/game";
import type { CardLibrary } from "../model/cards";
import { searchDecision } from "./ismcts";
import { isPlannedDecisionReusable } from "./simpleAI";
import {
  matchPlannedDecision,
  parsePrincipalVariation,
  type PlannedDecision,
} from "./principalVariation";

export interface HeadlessSearchResult {
  decision: Decision;
  iterations: number;
  elapsedMs: number;
  reusedPlan: boolean;
  forced: boolean;
}

export class HeadlessSearchAgent {
  private plannedDecisions: PlannedDecision[] = [];

  constructor(
    private readonly library: CardLibrary,
    private readonly maxIterations: number
  ) {}

  choose(game: Game, seed: number): HeadlessSearchResult {
    const point = game.getDecisionPoint();
    if (!point || point.options.length === 0) throw new Error("AI has no legal decision");
    const planned = matchPlannedDecision(point, this.plannedDecisions[0]);
    if (planned && isPlannedDecisionReusable(game, planned)) {
      this.plannedDecisions.shift();
      return { decision: planned, iterations: 0, elapsedMs: 0, reusedPlan: true, forced: false };
    }
    this.plannedDecisions = [];
    if (point.options.length === 1)
      return {
        decision: point.options[0].decision,
        iterations: 0,
        elapsedMs: 0,
        reusedPlan: false,
        forced: true,
      };
    const result = searchDecision(
      game.getInformationState(point.actor),
      this.library,
      { seed, maxIterations: this.maxIterations }
    );
    this.plannedDecisions = parsePrincipalVariation(result.principalVariation.slice(1));
    return { ...result, reusedPlan: false, forced: false };
  }
}
