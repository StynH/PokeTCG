import type { Decision, Game } from "../engine/game";
import { heuristicActionScore } from "./simpleAI";
import type { AIProfile } from "./profiles";
import type { SearchRequest, WorkerResponse } from "./workerProtocol";

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

  private createWorker(): Worker {
    this.worker?.terminate();
    this.worker = new Worker(new URL("./ai.worker.ts", import.meta.url), { type: "module" });
    return this.worker;
  }

  cancel(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  async chooseDecision(
    game: Game,
    profile: AIProfile,
    config: ChooseConfig
  ): Promise<ChosenDecision> {
    const revision = game.revision;
    if (game.pending) {
      let bestIndex = 0;
      for (let i = 1; i < game.pending.options.length; i++)
        if (game.pending.options[i].aiScore > game.pending.options[bestIndex].aiScore) bestIndex = i;
      const choiceId = game.pending.id!;
      return {
        decision: {
          kind: "choice",
          choiceId,
          optionId: game.pending.options[bestIndex].id!,
        },
        revision,
        iterations: 0,
        elapsedMs: 0,
      };
    }

    const actions = game.getLegalActions();
    if (actions.length === 0) throw new Error("AI has no legal action");
    const fallback = actions.reduce((best, action) =>
      heuristicActionScore(game, action, profile.weights) > heuristicActionScore(game, best, profile.weights)
        ? action
        : best
    );
    if (actions.length === 1)
      return { decision: { kind: "action", action: actions[0] }, revision, iterations: 0, elapsedMs: 0 };

    const worker = this.createWorker();
    const requestId = ++this.requestId;
    const hardBudget = config.timeBudgetMs ?? 5000;
    const searchBudget = Math.max(1, hardBudget - 100);
    const request: SearchRequest = {
      type: "search",
      requestId,
      information: game.getInformationState(game.current),
      profile,
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
        this.cancel();
        finish({
          decision: { kind: "action", action: fallback },
          revision,
          iterations: 0,
          elapsedMs: hardBudget,
        });
      }, hardBudget);
      config.signal?.addEventListener("abort", abort, { once: true });
      worker.onerror = () => {
        this.cancel();
        finish({ decision: { kind: "action", action: fallback }, revision, iterations: 0, elapsedMs: 0 });
      };
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const response = event.data;
        if (response.requestId !== requestId) return;
        if (response.type === "error") {
          this.cancel();
          finish({ decision: { kind: "action", action: fallback }, revision, iterations: 0, elapsedMs: 0 });
          return;
        }
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

