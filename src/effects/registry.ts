import type { Effect } from "../model/effects";
import type { EffectContext } from "./context";

export interface EffectHandler<E extends Effect = Effect> {
  op: E["op"];
  run(effect: E, ctx: EffectContext): void;
  canApply?(effect: E, ctx: EffectContext): boolean;
  aiValue?(effect: E, ctx: EffectContext): number;
}

const registry = new Map<string, EffectHandler>();
const commandRegistry = new Map<string, (payload: unknown, ctx: EffectContext) => void>();

export function defineEffect<E extends Effect>(handler: EffectHandler<E>): void {
  registry.set(handler.op, handler as EffectHandler);
}

export function defineEffectCommand<P>(
  command: string,
  run: (payload: P, ctx: EffectContext) => void
): void {
  if (commandRegistry.has(command)) throw new Error(`Duplicate effect command: "${command}"`);
  commandRegistry.set(command, run as (payload: unknown, ctx: EffectContext) => void);
}

export function runEffectCommand(command: string, payload: unknown, ctx: EffectContext): void {
  const run = commandRegistry.get(command);
  if (!run) throw new Error(`No effect command registered for: "${command}"`);
  run(payload, ctx);
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

export function effectsAiValue(effects: Effect[], ctx: EffectContext): number {
  return effects.reduce((total, effect) => total + effectAiValue(effect, ctx), 0);
}

export function effectRegistryCoverage(): Array<{ op: string; hasAiValue: boolean }> {
  return [...registry.values()].map((handler) => ({
    op: handler.op,
    hasAiValue: !!handler.aiValue,
  }));
}
