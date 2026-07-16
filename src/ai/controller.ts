import type { Decision, Game } from "../engine/game";
import { chooseSetupAwareAction, isPlannedDecisionReusable } from "./simpleAI";
import type { SearchRequest, WorkerResponse } from "./workerProtocol";
import {
  matchPlannedDecision,
  parsePrincipalVariation,
  type PlannedDecision,
} from "./principalVariation";

export interface ChooseConfig {
  seed: number;
  timeBudgetMs?: number;
  signal?: AbortSignal;
}

export interface ChosenDecision {
  decision: Decision;
  revision: number;
  iterations: number;
  elapsedMs: number;
}

export class AIController {
  private worker: Worker | null = null;
  private requestId = 0;
  private plannedDecisions: PlannedDecision[] = [];
  private plannedActor: number | null = null;
  private budgetTurn = -1;
  private remainingTurnBudgetMs = 0;
  private searchesThisTurn = 0;

  private createWorker(): Worker {
    this.terminateWorker();
    this.worker = new Worker(new URL("./ai.worker.ts", import.meta.url), { type: "module" });
    return this.worker;
  }

  private terminateWorker(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  cancel(): void {
    this.terminateWorker();
    this.plannedDecisions = [];
    this.plannedActor = null;
    this.budgetTurn = -1;
    this.remainingTurnBudgetMs = 0;
    this.searchesThisTurn = 0;
  }

  async chooseDecision(
    game: Game,
    config: ChooseConfig
  ): Promise<ChosenDecision> {
    const revision = game.revision;
    const point = game.getDecisionPoint();
    if (!point || point.options.length === 0) throw new Error("AI has no legal decision");
    const configuredBudget = config.timeBudgetMs ?? 5000;
    if (this.budgetTurn !== game.turnNumber) {
      this.budgetTurn = game.turnNumber;
      this.remainingTurnBudgetMs = configuredBudget;
      this.searchesThisTurn = 0;
      this.plannedDecisions = [];
      this.plannedActor = null;
    }

    const planned = this.plannedActor === point.actor
      ? matchPlannedDecision(point, this.plannedDecisions[0])
      : null;
    if (planned && isPlannedDecisionReusable(game, planned)) {
      this.plannedDecisions.shift();
      return { decision: planned, revision, iterations: 0, elapsedMs: 0 };
    }
    this.plannedDecisions = [];
    this.plannedActor = null;
    if (point.options.length === 1)
      return { decision: point.options[0].decision, revision, iterations: 0, elapsedMs: 0 };

    let fallback: Decision;
    if (game.pending) {
      let bestIndex = 0;
      for (let i = 1; i < game.pending.options.length; i++)
        if (game.pending.options[i].aiScore > game.pending.options[bestIndex].aiScore) bestIndex = i;
      fallback = point.options[bestIndex].decision;
    } else {
      fallback = { kind: "action", action: chooseSetupAwareAction(game) };
    }

    if (this.remainingTurnBudgetMs <= 100)
      return { decision: fallback, revision, iterations: 0, elapsedMs: 0 };

    const worker = this.createWorker();
    const requestId = ++this.requestId;
    const sliceLimit = this.searchesThisTurn === 0 ? 3500 : game.pending ? 650 : 900;
    const hardBudget = Math.min(this.remainingTurnBudgetMs, sliceLimit);
    const searchBudget = Math.max(1, hardBudget - 100);
    this.searchesThisTurn++;
    const request: SearchRequest = {
      type: "search",
      requestId,
      information: game.getInformationState(point.actor),
      seed: config.seed,
      deadlineMs: searchBudget,
    };

    return new Promise<ChosenDecision>((resolve, reject) => {
      let settled = false;
      const finish = (result: ChosenDecision) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      };
      const abort = () => {
        if (settled) return;
        settled = true;
        this.cancel();
        cleanup();
        reject(new DOMException("AI search cancelled", "AbortError"));
      };
      const cleanup = () => {
        window.clearTimeout(timer);
        config.signal?.removeEventListener("abort", abort);
        worker.onmessage = null;
        worker.onerror = null;
      };
      const timer = window.setTimeout(() => {
        this.terminateWorker();
        this.plannedDecisions = [];
        this.plannedActor = null;
        this.remainingTurnBudgetMs = 0;
        finish({
          decision: fallback,
          revision,
          iterations: 0,
          elapsedMs: hardBudget,
        });
      }, hardBudget);
      config.signal?.addEventListener("abort", abort, { once: true });
      worker.onerror = () => {
        this.terminateWorker();
        this.plannedDecisions = [];
        this.plannedActor = null;
        this.remainingTurnBudgetMs = 0;
        finish({ decision: fallback, revision, iterations: 0, elapsedMs: 0 });
      };
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const response = event.data;
        if (response.requestId !== requestId) return;
        if (response.type === "error") {
          this.terminateWorker();
          this.plannedDecisions = [];
          this.plannedActor = null;
          this.remainingTurnBudgetMs = 0;
          finish({ decision: fallback, revision, iterations: 0, elapsedMs: 0 });
          return;
        }
        this.remainingTurnBudgetMs = Math.max(0, this.remainingTurnBudgetMs - response.elapsedMs);
        this.plannedDecisions = parsePrincipalVariation(response.principalVariation.slice(1));
        this.plannedActor = point.actor;
        finish({
          decision: response.decision,
          revision,
          iterations: response.iterations,
          elapsedMs: response.elapsedMs,
        });
      };
      worker.postMessage(request);
    });
  }
}
