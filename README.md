# PokeTCG EX Simulator

A Pokemon TCG simulator for the 2006 EX era, built with Vite + TypeScript and a glassmorphism UI. Play against a built-in AI with fully JSON-defined custom cards.

## Run

```sh
npm install
npm run dev
```

## Rules implemented (EX era, 2006)

- 60-card decks, max 4 copies per name (basic Energy exempt), 6 prize cards
- Opening coin flip, mulligans (opponent draws 1 extra per mulligan), first player draws and may attack on turn 1
- No evolution on either player's first turn; a Pokemon cannot evolve the turn it entered play or twice in one turn (Rare Candy bypasses, per pre-errata era ruling)
- Pokemon-ex give up 2 prizes when Knocked Out
- Poke-Powers (blocked while affected by a Special Condition), once-per-turn tracking
- Weakness x2 and Resistance -30 applied to the Defending Pokemon (multi-type attackers trigger on any of their types)
- Special Conditions with era-correct behavior:
  - Asleep: flip at each checkup, heads wakes; cannot attack or retreat
  - Paralyzed: cannot attack or retreat, cured at checkup after owner's turn
  - Confused: flip to attack, tails puts 3 damage counters on itself; retreating needs no flip (post-2003 rule)
  - Poisoned: 10 damage each checkup
  - Burned: flip each checkup, tails takes 20
  - Conditions cured by evolving or moving to the Bench
- One energy attachment, one Supporter, and one retreat per turn; retreat discards energy equal to the retreat cost
- Bench limit of 5, promotion choice after a Knock Out
- Win by taking all prizes, opponent running out of Pokemon, or opponent deck-out at draw
- Choice of starting Active Pokemon from your opening basics
- Continuous modifiers: Poke-Bodies, Pokemon Tools (Strength Charm), Stadiums (replace rule, retreat/damage/HP/condition hooks)
- Special energy mechanics: multi-unit cards (Double Rainbow counts as 2), damage riders (DRE −10), Scramble-style prize conditions
- Attack effects: scaling damage, recoil, protection (Agility/Harden), attack/retreat locks, opponent energy discard, Copycat/Rocket's Admin. shuffle-draws, Scoop Up, Warp Point, moving energy and damage counters, devolution
- Triggered Poke-Powers (`onPlayFromHand`)
- Choosing which energy cards to discard when retreating
- Sudden Death: simultaneous win conditions trigger an automatic one-prize rematch
- Delta Species (δ): multi-type Pokemon, δ marker with δ-only conditionals, δ Rainbow Energy, Holon Energy (energy-borne modifiers), and Pokemon playable as Energy (Holon's Voltorb). Includes a "Delta Storm" demo deck.

Not yet implemented: attack copying (Metronome-likes) and "when Knocked Out" triggers.

## Custom cards via JSON

All cards live in [src/data/cards.json](src/data/cards.json), decks in [src/data/decks.json](src/data/decks.json). Cards support full scan images (`"image": "/cards/your-scan.png"`, files in `public/cards/`) with in-game state rendered as an overlay, or fall back to generated glass tiles.

See [CARD_SCRIPTING.md](CARD_SCRIPTING.md) for the complete schema, effect op reference, and worked examples.

## Architecture

- [src/model/types.ts](src/model/types.ts) — card schema and effect DSL
- [src/model/loader.ts](src/model/loader.ts) — library building and deck validation
- [src/engine/game.ts](src/engine/game.ts) — rules engine: turn flow, checkup, effect interpreter, pending-choice system
- [src/ai/simpleAI.ts](src/ai/simpleAI.ts) — heuristic action scoring over the same legal-action list the UI uses
- [src/ui/render.ts](src/ui/render.ts) — DOM renderer, re-rendered from state on every change
