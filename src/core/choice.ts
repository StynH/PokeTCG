export interface ChoiceOption {
  id?: string;
  label: string;
  aiScore: number;
  apply: () => void;
}

export interface PendingChoice {
  id?: string;
  player: number;
  prompt: string;
  options: ChoiceOption[];
}
