import type { EnergyType } from "../model/energy";
import type { Effect } from "../model/effects";

export interface EffectFrame {
  controller: number;
  attackerTypes?: EnergyType[];
  fromAttack?: boolean;
  sourceUid?: number;
  attackId?: number;
}

export type SystemOperation =
  | { op: "chooseStartingActive"; player: number }
  | { op: "placeStartingActive"; player: number; cardUid: number }
  | { op: "finishAttackDamage"; attackId: number }
  | { op: "queueSwitchChoice"; player: number }
  | { op: "switchPokemon"; player: number; pokemonUid: number }
  | { op: "retreatDiscard"; player: number; activeUid: number; targetUid: number; cardUid: number; remaining: number }
  | { op: "finishRetreat"; player: number; activeUid: number; targetUid: number }
  | { op: "promotePokemon"; player: number; pokemonUid: number }
  | { op: "targetEffect"; effect: Effect; targetUid: number; frame: EffectFrame };

export type QueuedOperation =
  | { kind: "effect"; effect: Effect; frame: EffectFrame }
  | { kind: "effectCommand"; command: string; payload: unknown; frame: EffectFrame }
  | { kind: "system"; operation: SystemOperation };

export function effectOperation(effect: Effect, frame: EffectFrame): QueuedOperation {
  return { kind: "effect", effect, frame };
}

export function effectCommand(
  command: string,
  payload: unknown,
  frame: EffectFrame
): QueuedOperation {
  return { kind: "effectCommand", command, payload, frame };
}
