import type { Decision, InformationState } from "../engine/game";

export interface SearchRequest {
  type: "search";
  requestId: number;
  information: InformationState;
  seed: number;
  deadlineMs: number;
}

export interface SearchResponse {
  type: "result";
  requestId: number;
  decision: Decision;
  iterations: number;
  elapsedMs: number;
  principalVariation: string[];
}

export interface SearchFailure {
  type: "error";
  requestId: number;
  message: string;
}

export type WorkerResponse = SearchResponse | SearchFailure;
