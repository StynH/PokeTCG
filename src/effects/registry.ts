import type { Effect } from "../model/effects";
import type { EffectContext } from "./context";

export interface EffectHandler<E extends Effect = Effect> {
  op: E["op"];
  run(effect: E, ctx: EffectContext): void;
  canApply?(effect: E, ctx: EffectContext): boolean;
  aiValue?(effect: E, ctx: EffectContext): number;
}

const registry = new Map<string, EffectHandler>();

export function defineEffect<E extends Effect>(handler: EffectHandler<E>): void {
  registry.set(handler.op, handler as EffectHandler);
}

export function runEffect(effect: Effect, ctx: EffectContext): void {
  const handler = registry.get(effect.op);
  if (!handler) throw new Error(`No handler registered for effect op: "${effect.op}"`);
  handler.run(effect, ctx);
}

export function effectCanApply(effect: Effect, ctx: EffectContext): boolean {
  const handler = registry.get(effect.op);
  if (!handler) return false;
  return handler.canApply ? handler.canApply(effect, ctx) : true;
}

export function effectAiValue(effect: Effect, ctx: EffectContext): number {
  const handler = registry.get(effect.op);
  if (!handler?.aiValue) return 0;
  return handler.aiValue(effect, ctx);
}
