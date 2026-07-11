import { isEnergy, resistancesOf } from "../../model/cards";
import type { CardInstance } from "../../model/cards";
import type { EffectTarget, ScalePer, Condition } from "../../model/effects";
import type { EnergyType } from "../../model/energy";
import type { SlotRef } from "../../core/state";
import type { ChoiceOption } from "../../core/choice";
import type { EffectContext } from "../context";
import { defineEffect, defineEffectCommand } from "../registry";

function applyTargetedEffect(
  effect: Extract<import("../../model/effects").Effect, { op: "damage" | "damageCounters" }>,
  ctx: EffectContext
): void {
  const refs = ctx.targetRefs(effect.target);
  const apply = (ref: SlotRef) => {
    const pokemon = ctx.getPokemon(ref);
    if (!pokemon) return;
    if (effect.op === "damage") {
      if (
        effect.applyWR !== false && ref.p === ctx.opponent && ref.slot === "active" &&
        ctx.addAttackDamage(effect.amount, effect.ignoreResistance)
      ) return;
      ctx.dealDamage(ref, effect.amount, effect.applyWR, effect.ignoreResistance, effect.ignoreDefenderEffects);
      return;
    }
    pokemon.damage += effect.count * 10;
    ctx.log(`${pokemon.def.name} gets ${effect.count} damage counter(s)`, "damage", {
      uid: pokemon.card.uid,
      amount: effect.count * 10,
    });
  };
  const isChoice = effect.target.endsWith("Choice");
  if (!isChoice || refs.length <= 1) {
    refs.forEach(apply);
    return;
  }
  ctx.requestChoice(
    ctx.controller,
    effect.op === "damage" ? `Deal ${effect.amount} damage to:` : `Put ${effect.count} damage counter(s) on:`,
    refs.flatMap((ref) => {
      const pokemon = ctx.getPokemon(ref);
      return pokemon ? [{
        label: ctx.describeSlot(ref),
        informationKey: `target:${pokemon.card.uid}`,
        aiScore: ref.p === ctx.opponent ? pokemon.damage + 10 : -pokemon.damage,
        operation: {
          kind: "system" as const,
          operation: { op: "targetEffect" as const, effect, targetUid: pokemon.card.uid, frame: ctx.frame },
        },
      }] : [];
    })
  );
}

defineEffect<{
  op: "damage";
  amount: number;
  target: EffectTarget;
  applyWR?: boolean;
  ignoreResistance?: boolean;
  ignoreDefenderEffects?: boolean;
}>({
  op: "damage",
  run: applyTargetedEffect,
  aiValue: (e) => e.amount * 0.8,
});

defineEffect<{ op: "damageCounters"; count: number; target: EffectTarget }>({
  op: "damageCounters",
  run: applyTargetedEffect,
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
      applyTargetedEffect({ op: "damage", amount: total, target: e.target }, ctx);
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
      ctx.queueOperation(ctx.command("damage.finishEnergyDiscard", { discarded, damagePerEnergy }));
  };
  if (!active) { finish(); return; }
  const matches = (c: CardInstance) =>
    isEnergy(c.def) && (!energyType || c.def.provides.includes(energyType));
  const available = active.energy.filter(matches);
  if (available.length === 0) { finish(); return; }
  const options: ChoiceOption[] = [
    ...available.map((card) => ({
      label: `Discard ${card.def.name} (+${damagePerEnergy} damage)`,
      informationKey: `discard-energy:${card.def.id}`,
      aiScore: ctx.currentAttackDamage() + discarded * damagePerEnergy >=
        (ctx.players[ctx.opponent].active?.def.hp ?? Infinity) -
        (ctx.players[ctx.opponent].active?.damage ?? 0) ? -20 : damagePerEnergy - 5,
      operation: ctx.command("damage.discardEnergy", {
        cardUid: card.uid, energyType, damagePerEnergy, discarded,
      }),
    })),
    {
      label: discarded > 0 ? "Stop discarding" : "Don't discard",
      informationKey: "stop-discarding",
      aiScore: -1,
      operation: ctx.command("damage.finishEnergyDiscard", { discarded, damagePerEnergy }),
    },
  ];
  ctx.requestChoice(p, `Discard energy for +${damagePerEnergy} damage each?`, options);
}

defineEffect<{ op: "discardEnergyForDamage"; damagePerEnergy: number; energyType?: EnergyType }>({
  op: "discardEnergyForDamage",
  run: (e, ctx) => discardEnergyLoop(ctx, e.energyType, e.damagePerEnergy, 0),
  aiValue: (e) => e.damagePerEnergy * 1.5,
});

defineEffectCommand<{
  cardUid: number;
  energyType?: EnergyType;
  damagePerEnergy: number;
  discarded: number;
}>("damage.discardEnergy", (payload, ctx) => {
  const active = ctx.players[ctx.controller].active;
  if (!active) return;
  const index = active.energy.findIndex((card) => card.uid === payload.cardUid);
  if (index === -1) return;
  const card = active.energy.splice(index, 1)[0];
  ctx.players[ctx.controller].discard.push(card);
  ctx.log(`${active.def.name} discards ${card.def.name} for extra damage`);
  discardEnergyLoop(
    ctx, payload.energyType, payload.damagePerEnergy, payload.discarded + 1
  );
});

defineEffectCommand<{ discarded: number; damagePerEnergy: number }>(
  "damage.finishEnergyDiscard",
  (payload, ctx) => {
    const amount = payload.discarded * payload.damagePerEnergy;
    if (amount > 0 && !ctx.addAttackDamage(amount))
      ctx.dealDamage({ p: ctx.opponent, slot: "active" }, amount);
  }
);

defineEffect<{ op: "discardDefenderSpecialEnergyBonus"; bonus: number }>({
  op: "discardDefenderSpecialEnergyBonus",
  run: (e, ctx) => {
    const defender = ctx.players[ctx.opponent].active;
    if (!defender) return;
    const idx = defender.energy.findIndex((c) => isEnergy(c.def) && !c.def.isBasic);
    if (idx === -1) return;
    const discarded = defender.energy.splice(idx, 1)[0];
    ctx.players[ctx.opponent].discard.push(discarded);
    ctx.log(`${discarded.def.name} was discarded from ${defender.def.name}`);
    if (!ctx.addAttackDamage(e.bonus))
      ctx.dealDamage({ p: ctx.opponent, slot: "active" }, e.bonus);
    ctx.log(`+${e.bonus} bonus damage (Special Energy discarded)`);
  },
  aiValue: (e, ctx) => {
    const defender = ctx.players[ctx.opponent].active;
    if (!defender) return 0;
    return defender.energy.some((c) => isEnergy(c.def) && !c.def.isBasic) ? e.bonus * 0.8 + 10 : 0;
  },
});
