import type { Condition } from "../../model/effects";
import type { EffectContext } from "../context";
import { defineEffect, defineEffectCommand } from "../registry";

defineEffect<{ op: "applyCondition"; condition: Condition; target: "defending" | "self" }>({
  op: "applyCondition",
  run: (e, ctx) => {
    const targetRef = e.target === "self"
      ? ctx.sourceRef ?? { p: ctx.controller, slot: "active" as const }
      : { p: ctx.opponent, slot: "active" as const };
    const target = ctx.getPokemon(targetRef);
    if (!target) return;
    if (ctx.conditionsPrevented(targetRef)) {
      ctx.log(`${target.def.name} is protected from Special Conditions`);
      return;
    }
    target.condition = e.condition;
    target.conditionTurn = ctx.turnNumber;
    ctx.log(
      `${target.def.name} is now ${e.condition[0].toUpperCase()}${e.condition.slice(1)}`,
      "status",
      { uid: target.card.uid }
    );
  },
  aiValue: (e, ctx) => {
    if (e.target === "self") return e.condition === "asleep" ? -4 : -15;
    const target = ctx.players[ctx.opponent].active;
    if (!target) return 0;
    return ctx.conditionsPrevented({ p: ctx.opponent, slot: "active" }) ? 0 : 20;
  },
});

defineEffect<{ op: "removeCondition"; condition: Condition; target: "defending" }>({
  op: "removeCondition",
  run: (e, ctx) => {
    const target = ctx.players[ctx.opponent].active;
    if (!target || target.condition !== e.condition) return;
    target.condition = null;
    ctx.log(`${target.def.name} is no longer ${e.condition[0].toUpperCase()}${e.condition.slice(1)}`, "status", {
      uid: target.card.uid,
    });
  },
  canApply: (e, ctx) => ctx.players[ctx.opponent].active?.condition === e.condition,
  aiValue: () => -10,
});

defineEffect<{ op: "applyPoison"; target: "defending"; counters?: number }>({
  op: "applyPoison",
  run: (e, ctx) => {
    const target = ctx.players[ctx.opponent].active;
    if (!target) return;
    if (ctx.conditionsPrevented({ p: ctx.opponent, slot: "active" })) {
      ctx.log(`${target.def.name} is protected from Special Conditions`);
      return;
    }
    const counters = e.counters ?? 1;
    target.poisonCounters = Math.max(target.poisonCounters, counters);
    ctx.log(
      `${target.def.name} is now ${counters >= 2 ? "Badly Poisoned" : "Poisoned"}`,
      "status",
      { uid: target.card.uid }
    );
  },
  aiValue: (_e, ctx) => {
    const target = ctx.players[ctx.opponent].active;
    if (!target) return 0;
    return ctx.conditionsPrevented({ p: ctx.opponent, slot: "active" }) ? 0 : 20;
  },
});

defineEffect<{ op: "applyBurn"; target: "defending" }>({
  op: "applyBurn",
  run: (_e, ctx) => {
    const target = ctx.players[ctx.opponent].active;
    if (!target) return;
    if (ctx.conditionsPrevented({ p: ctx.opponent, slot: "active" })) {
      ctx.log(`${target.def.name} is protected from Special Conditions`);
      return;
    }
    target.burned = true;
    ctx.log(`${target.def.name} is now Burned`, "status", { uid: target.card.uid });
  },
  aiValue: (_e, ctx) => {
    const target = ctx.players[ctx.opponent].active;
    if (!target) return 0;
    return ctx.conditionsPrevented({ p: ctx.opponent, slot: "active" }) ? 0 : 20;
  },
});

defineEffect<{ op: "protectNextTurn"; mode: "preventAll" | "reduce"; amount?: number }>({
  op: "protectNextTurn",
  run: (e, ctx) => {
    const source = ctx.sourceRef ? ctx.getPokemon(ctx.sourceRef) : ctx.players[ctx.controller].active;
    if (source) {
      source.guard = {
        mode: e.mode,
        amount: e.amount ?? 0,
        untilTurn: ctx.turnNumber + 1,
      };
      ctx.log(
        e.mode === "preventAll"
          ? `${source.def.name} prevents all effects of attacks next turn`
          : `${source.def.name} reduces damage by ${e.amount ?? 0} next turn`
      );
    }
  },
  aiValue: (e, ctx) => {
    const isActiveSource = ctx.sourceRef?.slot === "active";
    if (e.mode === "preventAll") return isActiveSource ? 46 : 4;
    return (e.amount ?? 0) * (isActiveSource ? 0.5 : 0.1);
  },
});

defineEffect<{ op: "lockDefending"; what: "attack" | "retreat" }>({
  op: "lockDefending",
  run: (e, ctx) => {
    const defender = ctx.players[ctx.opponent].active;
    if (defender) {
      defender.locks[e.what] = ctx.turnNumber + 1;
      ctx.log(`${defender.def.name} can't ${e.what} during its next turn`);
    }
  },
  aiValue: (e) => (e.what === "attack" ? 40 : 15),
});

function lockNamedAttack(ctx: EffectContext, targetUid: number, attackName: string): void {
  const entry = [ctx.controller, ctx.opponent]
    .flatMap((p) => ctx.allInPlay(p))
    .find(({ pokemon }) => pokemon.card.uid === targetUid);
  if (!entry || !entry.pokemon.def.attacks.some((attack) => attack.name === attackName)) return;
  const isSelf = entry.ref.p === ctx.controller;
  entry.pokemon.attackLocks ??= {};
  entry.pokemon.attackLocks[attackName] = ctx.turnNumber + (isSelf ? 2 : 1);
  ctx.log(`${entry.pokemon.def.name} can't use ${attackName} during its next turn`);
}

defineEffect<{
  op: "lockAttack";
  target: "self" | "defending";
  attackName?: string;
  chooseDefendingAttack?: boolean;
}>({
  op: "lockAttack",
  run: (e, ctx) => {
    const target = e.target === "self"
      ? (ctx.sourceRef ? ctx.getPokemon(ctx.sourceRef) : ctx.players[ctx.controller].active)
      : ctx.players[ctx.opponent].active;
    if (!target) return;
    if (e.chooseDefendingAttack) {
      const options = target.def.attacks.map((attack) => ({
        label: attack.name,
        informationKey: `attack-lock:${attack.name}`,
        aiScore: 20,
        operation: ctx.command("status.lockAttack", { targetUid: target.card.uid, attackName: attack.name }),
      }));
      ctx.requestChoice(ctx.controller, "Choose an attack that can't be used next turn:", options);
      return;
    }
    if (e.attackName) lockNamedAttack(ctx, target.card.uid, e.attackName);
  },
  canApply: (e, ctx) => {
    const target = e.target === "self"
      ? (ctx.sourceRef ? ctx.getPokemon(ctx.sourceRef) : ctx.players[ctx.controller].active)
      : ctx.players[ctx.opponent].active;
    return !!target && (e.chooseDefendingAttack ? target.def.attacks.length > 0 : !!e.attackName);
  },
  aiValue: (e) => e.target === "self" ? -30 : 35,
});

defineEffectCommand<{ targetUid: number; attackName: string }>("status.lockAttack", (payload, ctx) => {
  lockNamedAttack(ctx, payload.targetUid, payload.attackName);
});
