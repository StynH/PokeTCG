import type { Decision, InformationState } from "../engine/game";
import type { AIProfile } from "./profiles";

export interface SearchRequest {
  type: "search";
  requestId: number;
  information: InformationState;
  profile: AIProfile;
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

