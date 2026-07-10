export interface StrategyWeights {
  aggression: number;
  setup: number;
  defense: number;
  disruption: number;
  risk: number;
}

export interface AIProfile {
  name: string;
  weights: StrategyWeights;
  custom?: boolean;
}

export const WEIGHT_KEYS: Array<keyof StrategyWeights> = [
  "aggression",
  "setup",
  "defense",
  "disruption",
  "risk",
];

export const WEIGHT_LABELS: Record<keyof StrategyWeights, string> = {
  aggression: "Aggression",
  setup: "Setup",
  defense: "Defense",
  disruption: "Disruption",
  risk: "Risk",
};

export const PRESETS: AIProfile[] = [
  { name: "Balanced", weights: { aggression: 1, setup: 1, defense: 1, disruption: 1, risk: 1 } },
  { name: "Aggro", weights: { aggression: 1.8, setup: 0.7, defense: 0.4, disruption: 0.6, risk: 1.4 } },
  { name: "Defensive", weights: { aggression: 0.6, setup: 1.1, defense: 1.9, disruption: 0.8, risk: 0.5 } },
  { name: "Setup", weights: { aggression: 0.7, setup: 1.9, defense: 1.0, disruption: 0.6, risk: 0.7 } },
  { name: "Disruptor", weights: { aggression: 0.8, setup: 0.8, defense: 0.8, disruption: 2.0, risk: 1.1 } },
  { name: "Reckless", weights: { aggression: 1.6, setup: 0.6, defense: 0.2, disruption: 0.5, risk: 2.0 } },
];

export const BALANCED = PRESETS[0];

export function mixWeights(a: StrategyWeights, b: StrategyWeights, ratioB: number): StrategyWeights {
  const t = Math.min(1, Math.max(0, ratioB));
  const out = {} as StrategyWeights;
  for (const key of WEIGHT_KEYS) out[key] = a[key] * (1 - t) + b[key] * t;
  return out;
}

const STORAGE_KEY = "poketcg-ai-profiles";

export function loadCustomProfiles(): AIProfile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AIProfile[];
    return parsed
      .filter((p) => p && typeof p.name === "string" && p.weights)
      .map((p) => ({
        name: p.name,
        custom: true,
        weights: Object.fromEntries(
          WEIGHT_KEYS.map((key) => [key, typeof p.weights[key] === "number" ? p.weights[key] : 1])
        ) as unknown as StrategyWeights,
      }));
  } catch {
    return [];
  }
}

export function saveCustomProfile(profile: AIProfile): void {
  const customs = loadCustomProfiles().filter((p) => p.name !== profile.name);
  customs.push({ ...profile, custom: true });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(customs));
}

export function deleteCustomProfile(name: string): void {
  const customs = loadCustomProfiles().filter((p) => p.name !== name);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(customs));
}

export function allProfiles(): AIProfile[] {
  return [...PRESETS, ...loadCustomProfiles()];
}

export function findProfile(name: string): AIProfile {
  return allProfiles().find((p) => p.name === name) ?? BALANCED;
}
