import { isEnergy } from "../../model/cards";
import type { CardInstance } from "../../model/cards";
import type { EnergyType } from "../../model/energy";
import type { SlotRef } from "../../core/state";
import type { ChoiceOption } from "../../core/choice";
import type { EffectContext } from "../context";
import { defineEffect } from "../registry";

function moveEnergyLoop(
  ctx: EffectContext,
  energyType: EnergyType | undefined,
  count: number
): void {
  if (count <= 0) return;
  const p = ctx.controller;
  const matches = (card: CardInstance) =>
    isEnergy(card.def) && (!energyType || card.def.provides.includes(energyType));
  const sources = ctx.allInPlay(p).filter(({ pokemon }) => pokemon.energy.some(matches));
  if (sources.length === 0) return;
  ctx.requestChoice(
    p,
    "Move Energy from which Pokemon?",
    sources.map(({ ref, pokemon }) => ({
      label: ctx.describeSlot(ref),
      aiScore: pokemon.def.stage === "Basic" ? 5 : 0,
      apply: () => {
        ctx.queueThunk(() => {
          const targets = ctx.allInPlay(p).filter((entry) => entry.pokemon !== pokemon);
          if (targets.length === 0) return;
          ctx.requestChoice(
            p,
            "Move Energy to which Pokemon?",
            targets.map((entry) => ({
              label: ctx.describeSlot(entry.ref),
              aiScore: entry.pokemon.def.hp - entry.pokemon.damage,
              apply: () => {
                const index = pokemon.energy.findIndex(matches);
                if (index === -1) return;
                const card = pokemon.energy.splice(index, 1)[0];
                entry.pokemon.energy.push(card);
                ctx.log(`${card.def.name} moves from ${pokemon.def.name} to ${entry.pokemon.def.name}`);
                ctx.queueThunk(() => moveEnergyLoop(ctx, energyType, count - 1));
              },
            }))
          );
        });
      },
    }))
  );
}

defineEffect<{ op: "moveEnergy"; count: number; energyType?: EnergyType }>({
  op: "moveEnergy",
  run: (e, ctx) => moveEnergyLoop(ctx, e.energyType, e.count),
  canApply: (_e, ctx) => ctx.allInPlay(ctx.controller).some(({ pokemon }) => pokemon.energy.length > 0),
  aiValue: () => 20,
});

defineEffect<{ op: "discardSelfEnergy"; count: number; energyType?: EnergyType }>({
  op: "discardSelfEnergy",
  run: (e, ctx) => {
    const active = ctx.players[ctx.controller].active;
    if (!active) return;
    for (let i = 0; i < e.count; i++) {
      const index = e.energyType
        ? active.energy.findIndex(
            (en) => isEnergy(en.def) && en.def.provides.includes(e.energyType!)
          )
        : active.energy.length - 1;
      if (index === -1 || active.energy.length === 0) break;
      const removed = active.energy.splice(index, 1)[0];
      ctx.players[ctx.controller].discard.push(removed);
      ctx.log(`${active.def.name} discards ${removed.def.name}`);
    }
  },
  aiValue: (e) => -e.count * 8,
});

function discardOppEnergyLoop(ctx: EffectContext, count: number): void {
  if (count <= 0) return;
  const defender = ctx.players[ctx.opponent].active;
  if (!defender || defender.energy.length === 0) return;
  ctx.requestChoice(
    ctx.controller,
    "Discard which Energy from the Defending Pokemon?",
    defender.energy.map((card) => ({
      label: card.def.name,
      aiScore: ctx.energyUnits(card, defender, ctx.opponent).count * 10,
      apply: () => {
        const index = defender.energy.findIndex((c) => c.uid === card.uid);
        if (index !== -1) ctx.players[ctx.opponent].discard.push(defender.energy.splice(index, 1)[0]);
        ctx.log(`${defender.def.name} loses ${card.def.name}`);
        ctx.queueThunk(() => discardOppEnergyLoop(ctx, count - 1));
      },
    }))
  );
}

defineEffect<{ op: "discardOpponentEnergy"; count: number }>({
  op: "discardOpponentEnergy",
  run: (e, ctx) => discardOppEnergyLoop(ctx, e.count),
  canApply: (_e, ctx) => {
    const defender = ctx.players[ctx.opponent].active;
    return !!defender && defender.energy.length > 0;
  },
  aiValue: (e) => e.count * 25,
});

defineEffect<{
  op: "attachEnergyFromDiscard";
  energyType: EnergyType;
  target: "selfBenchChoice" | "anySelfChoice";
}>({
  op: "attachEnergyFromDiscard",
  run: (e, ctx) => {
    const me = ctx.players[ctx.controller];
    const energyIndex = me.discard.findIndex(
      (c) => isEnergy(c.def) && c.def.provides.includes(e.energyType)
    );
    if (energyIndex === -1) return;
    const candidates: { ref: SlotRef; pokemon: import("../../core/state").PokemonInPlay }[] =
      e.target === "selfBenchChoice"
        ? me.bench.map((pokemon, i) => ({ ref: { p: ctx.controller, slot: i } as SlotRef, pokemon }))
        : ctx.allInPlay(ctx.controller);
    if (candidates.length === 0) return;
    const options: ChoiceOption[] = candidates.map(({ ref, pokemon }) => ({
      label: ctx.describeSlot(ref),
      aiScore: (pokemon.def.stage === "Basic" ? 0 : 10) + pokemon.def.attacks.length,
      apply: () => {
        const card = me.discard.splice(
          me.discard.findIndex((c) => isEnergy(c.def) && c.def.provides.includes(e.energyType)),
          1
        )[0];
        pokemon.energy.push(card);
        ctx.log(`${card.def.name} attached to ${pokemon.def.name} from the discard pile`);
      },
    }));
    if (options.length === 1) { options[0].apply(); return; }
    ctx.requestChoice(ctx.controller, `Attach ${e.energyType} Energy to which Pokemon?`, options);
  },
  canApply: (e, ctx) => {
    const me = ctx.players[ctx.controller];
    const hasEnergy = me.discard.some((c) => isEnergy(c.def) && c.def.provides.includes(e.energyType));
    const hasTarget = e.target === "selfBenchChoice" ? me.bench.length > 0 : true;
    return hasEnergy && hasTarget;
  },
  aiValue: () => 30,
});

defineEffect<{ op: "attachEnergyFromHand"; energyType: EnergyType; target: "anySelfChoice" }>({
  op: "attachEnergyFromHand",
  run: (e, ctx) => {
    const me = ctx.players[ctx.controller];
    const energyIndex = me.hand.findIndex(
      (c) => isEnergy(c.def) && c.def.provides.includes(e.energyType)
    );
    if (energyIndex === -1) return;
    const candidates = ctx.allInPlay(ctx.controller);
    const options: ChoiceOption[] = candidates.map(({ ref, pokemon }) => ({
      label: ctx.describeSlot(ref),
      aiScore: (pokemon.def.stage === "Basic" ? 0 : 10) + pokemon.def.attacks.length,
      apply: () => {
        const card = me.hand.splice(
          me.hand.findIndex((c) => isEnergy(c.def) && c.def.provides.includes(e.energyType)),
          1
        )[0];
        pokemon.energy.push(card);
        ctx.log(`${card.def.name} attached to ${pokemon.def.name} from hand`);
      },
    }));
    if (options.length === 1) { options[0].apply(); return; }
    ctx.requestChoice(ctx.controller, `Attach ${e.energyType} Energy to which Pokemon?`, options);
  },
  canApply: (e, ctx) =>
    ctx.players[ctx.controller].hand.some(
      (c) => isEnergy(c.def) && c.def.provides.includes(e.energyType)
    ),
  aiValue: () => 30,
});
