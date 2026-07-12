import type { Decision, DecisionPoint } from "../engine/game";

export interface PlannedDecision {
  point: string;
  informationKey: string;
}

export function parsePrincipalVariation(keys: string[]): PlannedDecision[] {
  return keys.flatMap((key) => {
    try {
      const parsed = JSON.parse(key) as Partial<PlannedDecision> & { kind?: string };
      return (parsed.kind === "action" || parsed.kind === "choice") &&
        parsed.point && parsed.informationKey
        ? [{ point: parsed.point, informationKey: parsed.informationKey }]
        : [];
    } catch {
      return [];
    }
  });
}

export function matchPlannedDecision(
  point: DecisionPoint,
  planned: PlannedDecision | undefined
): Decision | null {
  if (!planned || planned.point !== point.id) return null;
  return point.options.find(
    (option) => option.informationKey === planned.informationKey
  )?.decision ?? null;
}
