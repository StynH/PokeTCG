export interface ChoiceOption {
  label: string;
  aiScore: number;
  apply: () => void;
}

export interface PendingChoice {
  player: number;
  prompt: string;
  options: ChoiceOption[];
}
