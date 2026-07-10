import { isEnergy } from "../../model/cards";
import type { CardInstance } from "../../model/cards";
import type { EnergyType } from "../../model/energy";
import type { SlotRef } from "../../core/state";
import type { ChoiceOption } from "../../core/choice";
import type { EffectContext } from "../context";
import { defineEffect } from "../registry";
import {
  energyAttachmentChoiceScore,
  energyMoveValue,
  energyRemovalChoiceScore,
} from "../../ai/choiceScoring";

function moveEnergyLoop(
  ctx: EffectContext,
  energyType: EnergyType | undefined,
  count: number,
  basicOnly?: boolean
): void {
  if (count <= 0) return;
  const p = ctx.controller;
  const matches = (card: CardInstance) =>
    isEnergy(card.def) &&
    (!energyType || card.def.provides.includes(energyType)) &&
    (!basicOnly || card.def.isBasic);
  const sources = ctx.allInPlay(p).filter(({ pokemon }) => pokemon.energy.some(matches));
  if (sources.length === 0) return;
  ctx.requestChoice(
    p,
    "Move Energy from which Pokemon?",
    sources.map(({ ref, pokemon }) => {
      const card = pokemon.energy.find(matches)!;
      return {
        label: ctx.describeSlot(ref),
        aiScore: energyRemovalChoiceScore(ctx, pokemon, p, card, ref.slot === "active"),
        apply: () => {
          ctx.queueThunk(() => {
            const targets = ctx.allInPlay(p).filter((entry) => entry.pokemon !== pokemon);
            if (targets.length === 0) return;
            ctx.requestChoice(
              p,
              "Move Energy to which Pokemon?",
              targets.map((entry) => ({
                label: ctx.describeSlot(entry.ref),
                aiScore: energyAttachmentChoiceScore(
                  ctx,
                  card,
                  entry.pokemon,
                  p,
                  entry.ref.slot === "active"
                ),
                apply: () => {
                  const index = pokemon.energy.findIndex(matches);
                  if (index === -1) return;
                  const moved = pokemon.energy.splice(index, 1)[0];
                  entry.pokemon.energy.push(moved);
                  ctx.log(`${moved.def.name} moves from ${pokemon.def.name} to ${entry.pokemon.def.name}`);
                  ctx.queueThunk(() => moveEnergyLoop(ctx, energyType, count - 1, basicOnly));
                },
              }))
            );
          });
        },
      };
    })
  );
}

defineEffect<{ op: "moveEnergy"; count: number; energyType?: EnergyType; basicOnly?: boolean }>({
  op: "moveEnergy",
  run: (e, ctx) => moveEnergyLoop(ctx, e.energyType, e.count, e.basicOnly),
  canApply: (e, ctx) =>
    ctx.allInPlay(ctx.controller).some(({ pokemon }) =>
      pokemon.energy.some(
        (c) => isEnergy(c.def) && (!e.energyType || c.def.provides.includes(e.energyType)) && (!e.basicOnly || c.def.isBasic)
      )
    ),
  aiValue: (e, ctx) => energyMoveValue(
    ctx,
    ctx.controller,
    (card) => isEnergy(card.def) &&
      (!e.energyType || card.def.provides.includes(e.energyType)) &&
      (!e.basicOnly || card.def.isBasic)
  ),
});

defineEffect<{ op: "discardSelfEnergy"; count: number | "all"; energyType?: EnergyType }>({
  op: "discardSelfEnergy",
  run: (e, ctx) => {
    const source = ctx.sourceRef ? ctx.getPokemon(ctx.sourceRef) : ctx.players[ctx.controller].active;
    if (!source) return;
    const limit = e.count === "all" ? source.energy.length : e.count;
    for (let i = 0; i < limit; i++) {
      const index = e.energyType
        ? source.energy.findIndex(
            (en) => isEnergy(en.def) && en.def.provides.includes(e.energyType!)
          )
        : source.energy.length - 1;
      if (index === -1 || source.energy.length === 0) break;
      const removed = source.energy.splice(index, 1)[0];
      ctx.players[ctx.controller].discard.push(removed);
      ctx.log(`${source.def.name} discards ${removed.def.name}`);
    }
  },
  canApply: (e, ctx) => {
    const source = ctx.sourceRef ? ctx.getPokemon(ctx.sourceRef) : ctx.players[ctx.controller].active;
    if (!source) return false;
    const payable = source.energy.filter(
      (card) => isEnergy(card.def) && (!e.energyType || card.def.provides.includes(e.energyType))
    ).length;
    return e.count === "all" ? payable > 0 : payable >= e.count;
  },
  aiValue: (e) => (e.count === "all" ? -24 : -e.count * 8),
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

function discardOppEnergyAnyLoop(ctx: EffectContext, count: number): void {
  if (count <= 0) return;
  const targets = ctx.allInPlay(ctx.opponent).filter(({ pokemon }) => pokemon.energy.length > 0);
  if (targets.length === 0) return;
  ctx.requestChoice(
    ctx.controller,
    "Choose opponent's Pokémon to discard Energy from:",
    targets.map(({ ref, pokemon }) => ({
      label: ctx.describeSlot(ref),
      aiScore: pokemon.energy.reduce((s, c) => s + ctx.energyUnits(c, pokemon, ctx.opponent).count * 10, 0),
      apply: () => {
        ctx.queueThunk(() => {
          ctx.requestChoice(
            ctx.controller,
            "Discard which Energy?",
            pokemon.energy.map((card) => ({
              label: card.def.name,
              aiScore: ctx.energyUnits(card, pokemon, ctx.opponent).count * 10,
              apply: () => {
                const idx = pokemon.energy.findIndex((c) => c.uid === card.uid);
                if (idx !== -1) ctx.players[ctx.opponent].discard.push(pokemon.energy.splice(idx, 1)[0]);
                ctx.log(`${pokemon.def.name} loses ${card.def.name}`);
                ctx.queueThunk(() => discardOppEnergyAnyLoop(ctx, count - 1));
              },
            }))
          );
        });
      },
    }))
  );
}

defineEffect<{ op: "discardOpponentEnergy"; count: number; target?: "active" | "any" }>({
  op: "discardOpponentEnergy",
  run: (e, ctx) => e.target === "any" ? discardOppEnergyAnyLoop(ctx, e.count) : discardOppEnergyLoop(ctx, e.count),
  canApply: (e, ctx) => {
    if (e.target === "any") return ctx.allInPlay(ctx.opponent).some(({ pokemon }) => pokemon.energy.length > 0);
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
    const energy = me.discard[energyIndex];
    const options: ChoiceOption[] = candidates.map(({ ref, pokemon }) => ({
      label: ctx.describeSlot(ref),
      aiScore: energyAttachmentChoiceScore(ctx, energy, pokemon, ctx.controller, ref.slot === "active"),
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

defineEffect<{ op: "attachEnergyFromDeck"; energyType: EnergyType; basicOnly?: boolean; targetType?: EnergyType }>({
  op: "attachEnergyFromDeck",
  run: (e, ctx) => {
    const me = ctx.players[ctx.controller];
    const matches = (c: CardInstance) =>
      isEnergy(c.def) && c.def.provides.includes(e.energyType) && (!e.basicOnly || c.def.isBasic);
    if (!me.deck.some(matches)) return;
    const candidates = ctx.allInPlay(ctx.controller).filter(
      ({ pokemon }) => !e.targetType || pokemon.def.types.includes(e.targetType)
    );
    if (candidates.length === 0) return;
    const attach = (pokemon: import("../../core/state").PokemonInPlay) => {
      const card = me.deck.splice(me.deck.findIndex(matches), 1)[0];
      pokemon.energy.push(card);
      ctx.log(`${card.def.name} attached to ${pokemon.def.name} from the deck`);
      ctx.shuffleDeck(ctx.controller);
    };
    if (candidates.length === 1) { attach(candidates[0].pokemon); return; }
    ctx.requestChoice(
      ctx.controller,
      `Attach ${e.energyType} Energy to which Pokemon?`,
      candidates.map(({ ref, pokemon }) => {
        const energy = me.deck.find(matches)!;
        return {
          label: ctx.describeSlot(ref),
          aiScore: energyAttachmentChoiceScore(ctx, energy, pokemon, ctx.controller, ref.slot === "active"),
          apply: () => attach(pokemon),
        };
      })
    );
  },
  canApply: (e, ctx) =>
    ctx.players[ctx.controller].deck.some(
      (c) => isEnergy(c.def) && c.def.provides.includes(e.energyType) && (!e.basicOnly || c.def.isBasic)
    ) &&
    ctx.allInPlay(ctx.controller).some(
      ({ pokemon }) => !e.targetType || pokemon.def.types.includes(e.targetType)
    ),
  aiValue: () => 32,
});

defineEffect<{ op: "attachEnergyFromHand"; energyType?: EnergyType; target: "anySelfChoice" | "self" }>({
  op: "attachEnergyFromHand",
  run: (e, ctx) => {
    const me = ctx.players[ctx.controller];
    const matches = (c: CardInstance) =>
      isEnergy(c.def) && (e.energyType ? c.def.provides.includes(e.energyType) : c.def.isBasic);
    if (!me.hand.some(matches)) return;
    const source = ctx.sourceRef ? ctx.getPokemon(ctx.sourceRef) : me.active;
    const candidates =
      e.target === "self"
        ? source
          ? [{ ref: ctx.sourceRef ?? { p: ctx.controller, slot: "active" as const }, pokemon: source }]
          : []
        : ctx.allInPlay(ctx.controller);
    if (candidates.length === 0) return;
    const label = e.energyType ? `${e.energyType} Energy` : "a basic Energy";
    const attach = (pokemon: import("../../core/state").PokemonInPlay) => {
      const card = me.hand.splice(me.hand.findIndex(matches), 1)[0];
      pokemon.energy.push(card);
      ctx.log(`${card.def.name} attached to ${pokemon.def.name} from hand`);
    };
    if (candidates.length === 1) { attach(candidates[0].pokemon); return; }
    const energy = me.hand.find(matches)!;
    const options: ChoiceOption[] = candidates.map(({ ref, pokemon }) => ({
      label: ctx.describeSlot(ref),
      aiScore: energyAttachmentChoiceScore(ctx, energy, pokemon, ctx.controller, ref.slot === "active"),
      apply: () => attach(pokemon),
    }));
    ctx.requestChoice(ctx.controller, `Attach ${label} to which Pokemon?`, options);
  },
  canApply: (e, ctx) =>
    ctx.players[ctx.controller].hand.some(
      (c) => isEnergy(c.def) && (e.energyType ? c.def.provides.includes(e.energyType) : c.def.isBasic)
    ),
  aiValue: () => 30,
});
