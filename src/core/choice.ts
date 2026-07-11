import type { QueuedOperation } from "./operations";

export interface ChoiceOption {
  id?: string;
  informationKey?: string;
  label: string;
  aiScore: number;
  operation: QueuedOperation;
}

export interface PendingChoice {
  id?: string;
  player: number;
  prompt: string;
  options: ChoiceOption[];
}
