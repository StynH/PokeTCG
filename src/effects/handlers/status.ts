import type { Condition } from "../../model/effects";
import { defineEffect } from "../registry";

defineEffect<{ op: "applyCondition"; condition: Condition; target: "defending" }>({
  op: "applyCondition",
  run: (e, ctx) => {
    const target = ctx.players[ctx.opponent].active;
    if (!target) return;
    if (ctx.conditionsPrevented({ p: ctx.opponent, slot: "active" })) {
      ctx.log(`${target.def.name} is protected from Special Conditions`);
      return;
    }
    target.condition = e.condition;
    ctx.log(
      `${target.def.name} is now ${e.condition[0].toUpperCase()}${e.condition.slice(1)}`,
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
