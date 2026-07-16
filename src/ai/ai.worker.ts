/// <reference lib="webworker" />

import cardsJson from "../data/cards.json";
import { buildLibrary } from "../model/loader";
import type { CardDef } from "../model/cards";
import { searchDecision } from "./ismcts";
import type { SearchRequest, WorkerResponse } from "./workerProtocol";

const library = buildLibrary(cardsJson as CardDef[]);

self.onmessage = (event: MessageEvent<SearchRequest>) => {
  const request = event.data;
  if (request.type !== "search") return;
  try {
    const result = searchDecision(request.information, library, {
      seed: request.seed,
      deadlineMs: request.deadlineMs,
    });
    const response: WorkerResponse = { type: "result", requestId: request.requestId, ...result };
    self.postMessage(response);
  } catch (error) {
    const response: WorkerResponse = {
      type: "error",
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};
