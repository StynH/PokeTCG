# Plan: EX-era feature completion

## Goal

Close the biggest gaps between the engine and real EX-era (2003–2007) play: continuous modifiers, missing attack/trainer ops, special energy mechanics, and setup polish. Verify the simulation AI handles all of it unchanged (it plays through engine semantics, so new mechanics should transfer).

## Phase 1 — Modifier hook system

New `Modifier` type evaluated at fixed engine hook points instead of hardcoded rules.

- Sources: Poke-Bodies (`power.kind: "Poke-Body"` + `modifiers`), Tools (`modifiers` on Trainer), Stadiums (`modifiers`, applies to both players), attached special energy riders.
- Kinds: `damagePlus`, `damageMinus`, `preventConditions`, `retreatDelta`, `hpPlus`.
- Scopes: `self`, `yourPokemon`, `allPokemon`.
- Hook points: damage calculation (attacker plus → energy riders → weakness ×2 → resistance −30 → defender minus), condition application, retreat cost, KO/HP checks.
- Stadium state on `Game` (`stadium: {card, owner} | null`), play action replaces + discards old, one copy of same name blocked.
- Tool attach action, one per Pokemon, discards with the Pokemon.

## Phase 2 — Special energy mechanics

- `provideCount` (Double Rainbow counts as 2, Boost as 3) — unit-based cost matching in `canPayCost`.
- `damageRider` (DRE −10 to damage dealt by the holder).
- `scramble: true` (full provides only when behind on prizes, else 1 Colorless) — cost check becomes state-aware.
- Retreat pays by units.

## Phase 3 — New effect ops

- `damageScaled` — base + amount per `attackerEnergy` / `defenderEnergy` / `defenderDamageCounters` / `yourBench` / `oppBench`.
- `recoil` — self-damage, no weakness/resistance.
- `protectNextTurn` — prevent all or reduce damage during opponent's next turn (Agility/Harden).
- `lockDefending` — Defending Pokemon can't `attack` or `retreat` during its owner's next turn; cleared by benching/evolving.
- `discardOpponentEnergy` — attacker picks energy off the Defending Pokemon.
- `shuffleHandDraw` — Copycat/Rocket's Admin family (`who: self|opponent|both`, count fixed / per opponent hand / per own prizes).
- `scoopUp` — return a Pokemon and everything attached to hand.
- `warpPoint` — both players switch actives.
- `applyWR` flag on bench `damage` ops (era default: off for bench).
- Trainer `restriction` field: `maxHandSize`, `behindOnPrizes`.

Deferred (documented, not built): move energy between Pokemon, move damage counters, devolution, attack copying, triggered powers, Sudden Death.

## Phase 4 — Setup polish

- Choose starting Active from opening basics (choice prompt; AI scores by HP/attack potential). Remaining basics still auto-benched.

## Phase 5 — Cards, UI, docs, verification

- Demo cards: Double Rainbow Energy, Strength Charm (Tool), a retreat-reducing Stadium, Poke-Bodies on both ex cards; swap a few deck slots so every new mechanic appears in the default decks.
- UI: stadium shown in center strip, tool tag on Pokemon tiles, choice modal already covers setup/warp prompts.
- Update CARD_SCRIPTING.md with modifiers, energy fields, new ops, restrictions.
- Verify: `tsc` + build clean, headless AI-vs-AI batch (all games terminate, both win conditions seen), browser smoke test of stadium/tool/setup-choice, AI stress test from the previous change (still pending).
