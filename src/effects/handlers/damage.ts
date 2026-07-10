import { isEnergy, resistancesOf } from "../../model/cards";
import type { CardInstance } from "../../model/cards";
import type { EffectTarget, ScalePer, Condition } from "../../model/effects";
import type { EnergyType } from "../../model/energy";
import type { SlotRef } from "../../core/state";
import type { ChoiceOption } from "../../core/choice";
import type { EffectContext } from "../context";
import { defineEffect } from "../registry";

defineEffect<{
  op: "damage";
  amount: number;
  target: EffectTarget;
  applyWR?: boolean;
  ignoreResistance?: boolean;
  ignoreDefenderEffects?: boolean;
}>({
  op: "damage",
  run: (e, ctx) => {
    ctx.forEachTarget(e.target, `Deal ${e.amount} damage to`, (ref) => {
      if (
        e.applyWR !== false &&
        ref.p === ctx.opponent &&
        ref.slot === "active" &&
        ctx.addAttackDamage(e.amount, e.ignoreResistance)
      ) return;
      ctx.dealDamage(ref, e.amount, e.applyWR, e.ignoreResistance, e.ignoreDefenderEffects);
    });
  },
  aiValue: (e) => e.amount * 0.8,
});

defineEffect<{ op: "damageCounters"; count: number; target: EffectTarget }>({
  op: "damageCounters",
  run: (e, ctx) => {
    ctx.forEachTarget(e.target, `Put ${e.count} damage counter(s) on`, (ref) => {
      const target = ctx.getPokemon(ref);
      if (target) {
        target.damage += e.count * 10;
        ctx.log(`${target.def.name} gets ${e.count} damage counter(s)`, "damage", {
          uid: target.card.uid,
          amount: e.count * 10,
        });
      }
    });
  },
  aiValue: (e) => e.count * 10 * 0.8,
});

defineEffect<{ op: "damageScaled"; base: number; amount: number; per: ScalePer; energyType?: EnergyType }>({
  op: "damageScaled",
  run: (e, ctx) => {
    const me = ctx.players[ctx.controller];
    const defendingRef: SlotRef = { p: ctx.opponent, slot: "active" };
    const defender = ctx.getPokemon(defendingRef);
    const countEnergy = (energy: CardInstance[] | undefined): number =>
      !energy
        ? 0
        : e.energyType
          ? energy.filter((c) => isEnergy(c.def) && c.def.provides.includes(e.energyType!)).length
          : energy.length;
    let count = 0;
    switch (e.per) {
      case "attackerEnergy":         count = countEnergy(me.active?.energy); break;
      case "defenderEnergy":         count = countEnergy(defender?.energy); break;
      case "defenderDamageCounters": count = (defender?.damage ?? 0) / 10; break;
      case "selfDamageCounters":     count = (me.active?.damage ?? 0) / 10; break;
      case "yourBench":              count = me.bench.length; break;
      case "oppBench":               count = ctx.players[ctx.opponent].bench.length; break;
    }
    const total = e.base + e.amount * count;
    if (total > 0 && !ctx.addAttackDamage(total)) ctx.dealDamage(defendingRef, total);
  },
  aiValue: (e) => e.base + e.amount * 2,
});

defineEffect<{ op: "recoil"; amount: number }>({
  op: "recoil",
  run: (e, ctx) => {
    const attacker = ctx.players[ctx.controller].active;
    if (attacker) {
      attacker.damage += e.amount;
      ctx.log(`${attacker.def.name} takes ${e.amount} recoil damage`, "damage", {
        uid: attacker.card.uid,
        amount: e.amount,
      });
    }
  },
  aiValue: (e) => -e.amount * 0.5,
});

defineEffect<{ op: "damagePerHeads"; flips: number; amount: number; target: EffectTarget; recoilIfNoHeads?: number }>({
  op: "damagePerHeads",
  run: (e, ctx) => {
    let heads = 0;
    for (let i = 0; i < e.flips; i++) if (ctx.flip("Coin flip")) heads++;
    const total = heads * e.amount;
    if (total > 0) {
      ctx.forEachTarget(e.target, `Deal ${total} damage to`, (ref) => {
        if (ref.p === ctx.opponent && ref.slot === "active" && ctx.addAttackDamage(total)) return;
        ctx.dealDamage(ref, total);
      });
    } else if (e.recoilIfNoHeads) {
      const attacker = ctx.players[ctx.controller].active;
      if (attacker) {
        attacker.damage += e.recoilIfNoHeads;
        ctx.log(`All tails — ${attacker.def.name} does ${e.recoilIfNoHeads} damage to itself`, "damage", {
          uid: attacker.card.uid,
          amount: e.recoilIfNoHeads,
        });
      }
    } else {
      ctx.log("No heads — the attack does nothing");
    }
  },
  aiValue: (e) => (e.flips * e.amount) / 2,
});

defineEffect<{ op: "damagePerFlipsPerEnergy"; base: number; amount: number; energyType?: EnergyType }>({
  op: "damagePerFlipsPerEnergy",
  run: (e, ctx) => {
    const attacker = ctx.players[ctx.controller].active;
    if (!attacker) return;
    const energyCount = e.energyType
      ? attacker.energy.filter(
          (c) => isEnergy(c.def) && c.def.provides.includes(e.energyType!)
        ).length
      : attacker.energy.length;
    let heads = 0;
    for (let i = 0; i < energyCount; i++) if (ctx.flip("Coin flip")) heads++;
    const total = e.base + e.amount * heads;
    if (total > 0 && !ctx.addAttackDamage(total))
      ctx.dealDamage({ p: ctx.opponent, slot: "active" }, total);
  },
  aiValue: (e) => e.base + e.amount * 1.5,
});

defineEffect<{ op: "nextAttackBonus"; amount: number; attackName?: string }>({
  op: "nextAttackBonus",
  run: (e, ctx) => {
    const attacker = ctx.sourceRef ? ctx.getPokemon(ctx.sourceRef) : ctx.players[ctx.controller].active;
    if (attacker) {
      attacker.attackBoost = {
        amount: e.amount,
        attackName: e.attackName,
        usableTurn: ctx.turnNumber + 2,
      };
      const attack = e.attackName ? ` ${e.attackName}` : "";
      ctx.log(`${attacker.def.name}'s next${attack} attack does ${e.amount} more damage`);
    }
  },
  aiValue: (e) => e.amount * 0.6,
});

defineEffect<{ op: "damageIfStatus"; bonus: number; status: "burned" | "poisoned" | Condition }>({
  op: "damageIfStatus",
  run: (e, ctx) => {
    const defender = ctx.players[ctx.opponent].active;
    if (!defender) return;
    const hasStatus =
      e.status === "burned"
        ? defender.burned
        : e.status === "poisoned"
          ? defender.poisonCounters > 0
          : defender.condition === e.status;
    if (hasStatus) {
      if (!ctx.addAttackDamage(e.bonus)) defender.damage += e.bonus;
      ctx.log(`+${e.bonus} bonus damage (${e.status})`);
    }
  },
  aiValue: (e) => e.bonus * 0.4,
});

defineEffect<{ op: "damageIfDefenderNoEnergy"; bonus: number }>({
  op: "damageIfDefenderNoEnergy",
  run: (e, ctx) => {
    const defender = ctx.players[ctx.opponent].active;
    if (defender && defender.energy.length === 0) {
      if (!ctx.addAttackDamage(e.bonus)) defender.damage += e.bonus;
      ctx.log(`+${e.bonus} bonus damage (no energy on defender)`);
    }
  },
  aiValue: (e) => e.bonus * 0.3,
});

defineEffect<{ op: "damageIfDefenderSpecialEnergy"; bonus: number }>({
  op: "damageIfDefenderSpecialEnergy",
  run: (e, ctx) => {
    const defender = ctx.players[ctx.opponent].active;
    if (!defender) return;
    const hasSpecial = defender.energy.some((c) => isEnergy(c.def) && !c.def.isBasic);
    if (hasSpecial) {
      if (!ctx.addAttackDamage(e.bonus)) defender.damage += e.bonus;
      ctx.log(`+${e.bonus} bonus damage (Special Energy on defender)`);
    }
  },
  aiValue: (e) => e.bonus * 0.3,
});

defineEffect<{ op: "damageIfDefenderResistance"; resistanceType: EnergyType; bonus: number }>({
  op: "damageIfDefenderResistance",
  run: (e, ctx) => {
    const defender = ctx.players[ctx.opponent].active;
    if (!defender) return;
    if (resistancesOf(defender.def).includes(e.resistanceType)) {
      if (!ctx.addAttackDamage(e.bonus)) defender.damage += e.bonus;
      ctx.log(`+${e.bonus} bonus damage (defender has ${e.resistanceType} Resistance)`);
    }
  },
  aiValue: (e) => e.bonus * 0.3,
});

function discardEnergyLoop(
  ctx: EffectContext,
  energyType: EnergyType | undefined,
  damagePerEnergy: number,
  discarded: number
): void {
  const p = ctx.controller;
  const active = ctx.players[p].active;
  const finish = () => {
    if (discarded > 0)
      ctx.queueThunk(() => {
        const amount = discarded * damagePerEnergy;
        if (!ctx.addAttackDamage(amount))
          ctx.dealDamage({ p: ctx.opponent, slot: "active" }, amount);
      });
  };
  if (!active) { finish(); return; }
  const matches = (c: CardInstance) =>
    isEnergy(c.def) && (!energyType || c.def.provides.includes(energyType));
  const available = active.energy.filter(matches);
  if (available.length === 0) { finish(); return; }
  const options: ChoiceOption[] = [
    ...available.map((card) => ({
      label: `Discard ${card.def.name} (+${damagePerEnergy} damage)`,
      aiScore: damagePerEnergy - 5,
      apply: () => {
        const idx = active.energy.findIndex((c) => c.uid === card.uid);
        if (idx !== -1) {
          ctx.players[p].discard.push(active.energy.splice(idx, 1)[0]);
          ctx.log(`${active.def.name} discards ${card.def.name} for extra damage`);
        }
        ctx.queueThunk(() => discardEnergyLoop(ctx, energyType, damagePerEnergy, discarded + 1));
      },
    })),
    {
      label: discarded > 0 ? "Stop discarding" : "Don't discard",
      aiScore: -1,
      apply: () => {
        if (discarded > 0)
          ctx.queueThunk(() =>
            ctx.dealDamage({ p: ctx.opponent, slot: "active" }, discarded * damagePerEnergy)
          );
      },
    },
  ];
  ctx.requestChoice(p, `Discard energy for +${damagePerEnergy} damage each?`, options);
}

defineEffect<{ op: "discardEnergyForDamage"; damagePerEnergy: number; energyType?: EnergyType }>({
  op: "discardEnergyForDamage",
  run: (e, ctx) => discardEnergyLoop(ctx, e.energyType, e.damagePerEnergy, 0),
  aiValue: (e) => e.damagePerEnergy * 1.5,
});
