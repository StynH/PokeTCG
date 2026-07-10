# Card Scripting Guide

Every card is a JSON object in [src/data/cards.json](src/data/cards.json). Decks are name→count maps in [src/data/decks.json](src/data/decks.json). No code changes are needed to add cards — the engine interprets the effect DSL described below.

```json
{
  "My Custom Deck": {
    "my-pokemon": 4,
    "my-trainer": 4,
    "water-energy": 20
  }
}
```

Deck rules enforced at load: exactly 60 cards, max 4 copies per name (basic Energy exempt), max 1 Pokémon ★ (`isGoldStar`) total.

## Card images

Every card type accepts an optional `image` field. Put full card scans in `public/cards/` and reference them with an absolute path:

```json
{ "id": "blaziken-ex", "image": "/cards/blaziken-ex.png", ... }
```

- With `image`: the card renders as the full scan (63:88 card aspect ratio). In-play variable state — remaining HP bar, damage badge, attached energy pips, and Special Condition badges — is drawn as an overlay on top of the image. Hand cards show the scan as-is.
- Without `image`: the card falls back to a generated glass tile using `name`, `hp`, `text`, and type colors.

Any browser-supported format works (`png`, `jpg`, `webp`, `svg`). See `public/cards/example.svg` for a working reference.

## Pokemon

```json
{
  "id": "my-pokemon",
  "name": "My Pokemon",
  "image": "/cards/my-pokemon.png",
  "supertype": "Pokemon",
  "stage": "Stage1",
  "evolvesFrom": "My Basic",
  "hp": 90,
  "types": ["Psychic"],
  "isEx": false,
  "weakness": "Darkness",
  "resistance": "Fighting",
  "retreatCost": 2,
  "power": {
    "kind": "Poke-Power",
    "name": "Energy Lift",
    "text": "Once during your turn (before your attack), you may...",
    "usable": true,
    "oncePerTurn": true,
    "effects": [{ "op": "attachEnergyFromDiscard", "energyType": "Psychic", "target": "selfBenchChoice" }]
  },
  "attacks": [
    {
      "name": "Mind Shock",
      "cost": ["Psychic", "Psychic", "Colorless"],
      "damage": 50,
      "text": "Flip a coin. If heads, the Defending Pokemon is now Confused.",
      "effects": [
        { "op": "flip", "heads": [{ "op": "applyCondition", "condition": "confused", "target": "defending" }], "tails": [] }
      ]
    }
  ]
}
```

Field notes:

- `stage`: `Basic`, `Stage1`, or `Stage2`. Evolutions need `evolvesFrom` set to the exact `name` of the previous stage.
- `types`: list one or more types. Weakness/Resistance apply when **any** of the attacker's types matches the Defending Pokemon's `weakness`/`resistance` — so a two-type δ Pokemon (e.g. `["Lightning", "Metal"]`) triggers Weakness on both Lightning-weak and Metal-weak targets. The first type also drives the fallback tile color.
- `isEx: true` makes the opponent take 2 prizes on Knock Out and marks the card with a gold border.
- `isGoldStar: true` marks the card as a Pokémon ★ (Gold Star): it gets the shiny star badge and a deck may contain at most 1 Pokémon ★ in total.
- `weakness` doubles incoming attack damage; `resistance` subtracts 30. Both optional. `resistance` may also be a list (e.g. `["Water", "Fighting"]`) for a Pokemon that resists more than one type.
- `power.usable: true` creates a clickable action; `oncePerTurn` gates it per Pokemon per turn. Powers are blocked while the Pokemon has a Special Condition. Poke-Bodies carry `modifiers` (see below).
- `power.requiresActive: true` makes the power usable only while the Pokemon is your Active Pokemon.
- `power.trigger: "onPlayFromHand"` runs the power's `effects` automatically when the Basic is played from hand to the Bench.
- Inside an attack's or power's `effects`, `target: "self"` resolves to the Pokemon that owns the effect — the attacker for attacks, or the exact Pokemon using the Power (even from the Bench).
- `attacks[].damage` is the base damage applied to the Defending Pokemon with weakness/resistance. Omit it for pure-effect attacks.
- `attacks[].ignoreResistance: true` applies the attack's base `damage` without subtracting Resistance (Weakness still applies).

### Delta Species (δ)

- `isDelta: true` marks the card as a Delta Species Pokemon. It shows the δ badge and satisfies `deltaOnly` energy and the `deltaOnly` search filter. Combine with a two-entry `types` array for the classic δ off-type/dual-type Pokemon.
- `playableAsEnergy: true` lets a Basic Pokemon (e.g. Holon's Voltorb) be attached as a Special Energy that provides 1 unit of **any** type. It still counts as your Energy attachment for the turn, can also be played to the Bench as a normal Basic, and is discarded like any attached card when the Pokemon it powers is Knocked Out.

## Trainer

```json
{
  "id": "my-supporter",
  "name": "My Supporter",
  "supertype": "Trainer",
  "kind": "Supporter",
  "text": "Draw 3 cards. Then discard a card from your hand.",
  "effects": [{ "op": "draw", "count": 3 }, { "op": "discardFromHand", "count": 1 }],
  "restriction": { "maxHandSize": 7 }
}
```

`kind` options: `Item` (unlimited per turn), `Supporter` (one per turn), `Stadium` (stays in play, replaces the previous Stadium, can't play one with the same name as the current), `Tool` (attaches to a Pokemon, one per Pokemon, discarded with it). A trainer is only playable when all of its effects can be resolved (e.g. Potion needs a damaged Pokemon).

Optional `restriction`: `maxHandSize` (unplayable while your hand is larger, counting the card itself) and `behindOnPrizes: true` (only while you have more prizes left than the opponent).

## Modifiers (Poke-Bodies, Tools, Stadiums)

Continuous effects use `modifiers`, evaluated live at the engine's hook points — no scripting needed:

```json
"power": {
  "kind": "Poke-Body",
  "name": "Torrent Armor",
  "text": "Any damage done to this Pokemon by attacks is reduced by 10.",
  "modifiers": [{ "kind": "damageMinus", "amount": 10, "scope": "self" }]
}
```

| kind | fields | hook |
|------|--------|------|
| `damagePlus` | `amount` | Added to attack damage dealt by affected Pokemon (before weakness) |
| `damageMinus` | `amount` | Subtracted from attack damage taken (after weakness/resistance) |
| `preventConditions` | — | Special Conditions can't be applied to affected Pokemon |
| `retreatDelta` | `amount` | Retreat cost change (can be negative, floors at 0) |
| `hpPlus` | `amount` | Extra HP for Knock Out checks |
| `blockOpponentStadium` | — | While the holder is your Active Pokemon, your opponent can't play Stadium cards (use `scope: "self"`) |

Scopes: `self` (the Pokemon carrying the Body/Tool), `yourPokemon` (all of the source owner's Pokemon), `allPokemon` (both sides — typical for Stadiums). Modifier carriers: `power.modifiers` with `kind: "Poke-Body"`, `modifiers` on Tool and Stadium trainers.

Example Tool and Stadium (both in the default decks):

```json
{ "id": "strength-charm", "supertype": "Trainer", "kind": "Tool",
  "modifiers": [{ "kind": "damagePlus", "amount": 10, "scope": "self" }] }

{ "id": "sky-terrace", "supertype": "Trainer", "kind": "Stadium",
  "modifiers": [{ "kind": "retreatDelta", "amount": -1, "scope": "allPokemon" }] }
```

`burnDamage` modifiers override Burn damage with the highest applicable `amount`. Set `sourceRequiresActive: true` when the Body only works from the Active Spot, and use `scope: "allPokemon"` for effects such as Hot Soul.

## Energy

```json
{
  "id": "rainbow-energy",
  "name": "Rainbow Energy",
  "supertype": "Energy",
  "provides": ["Grass", "Fire", "Water", "Lightning", "Psychic", "Fighting", "Darkness", "Metal"],
  "isBasic": false
}
```

`provides` lists every type this card can pay for. `isBasic: true` exempts the card from the 4-copy rule and lets `basicEnergy` search filters find it.

Special energy fields:

- `provideCount` — how many energy units the card counts as (Double Rainbow 2, Boost 3; default 1).
- `damageRider` — flat change to damage dealt by the Pokemon it's attached to (Double Rainbow: `-10`).
- `scramble: true` — full `provides`/`provideCount` only while you have more prizes left than your opponent; otherwise the card counts as 1 Colorless.
- `deltaOnly: true` — provides Energy only while attached to a Delta Species (`isDelta`) Pokemon; otherwise provides nothing (δ Rainbow Energy).
- `modifiers` — the same continuous modifiers Poke-Bodies use (see below), applied to the Pokemon this Energy is attached to. Use `scope: "self"`. Example: a Holon Energy that prevents Special Conditions.

```json
{ "id": "double-rainbow-energy", "supertype": "Energy", "isBasic": false,
  "provides": ["Grass", "Fire", "Water", "Lightning", "Psychic", "Fighting", "Darkness", "Metal"],
  "provideCount": 2, "damageRider": -10 }

{ "id": "delta-rainbow-energy", "supertype": "Energy", "isBasic": false, "deltaOnly": true,
  "provides": ["Grass", "Fire", "Water", "Lightning", "Psychic", "Fighting", "Darkness", "Metal"] }

{ "id": "holon-energy-wp", "supertype": "Energy", "isBasic": false, "provides": ["Colorless"],
  "modifiers": [{ "kind": "preventConditions", "scope": "self" }] }
```

## Effect ops

Effects run in order. Ops that need a decision (targets, searches, discards) pause the game and prompt the acting player; the AI resolves the same prompts automatically.

| op | fields | meaning |
|----|--------|---------|
| `damage` | `amount`, `target`, `applyWR?`, `ignoreResistance?`, `ignoreDefenderEffects?` | Attack damage; weakness/resistance applied when hitting the Defending Pokemon (set `applyWR` to force it on/off; `ignoreResistance` keeps Weakness but skips Resistance; `ignoreDefenderEffects` bypasses effects on the target) |
| `damageScaled` | `base`, `amount`, `per`, `energyType?` | Damage to the Defending Pokemon: `base` + `amount` × count of `attackerEnergy` / `defenderEnergy` / `defenderDamageCounters` / `yourBench` / `oppBench` (with `energyType`, the energy counts only cards providing that type) |
| `recoil` | `amount` | Damage to the attacker itself, no weakness/resistance |
| `protectNextTurn` | `mode`, `amount?` | `preventAll` prevents effects and damage done to the source Pokemon; `reduce` reduces damage during the opponent's next turn |
| `lockDefending` | `what` | Defending Pokemon can't `attack` or `retreat` during its owner's next turn; benching or evolving clears it |
| `discardOpponentEnergy` | `count` | Controller picks energy cards to discard from the Defending Pokemon |
| `shuffleHandDraw` | `who`, `count` | `who`: `self`/`opponent`/`both` shuffle hand into deck and draw; `count`: number, `"opponentHand"` (Copycat) or `"ownPrizes"` (Rocket's Admin.) |
| `scoopUp` | — | Return one of your Pokemon and all attached cards to your hand |
| `warpPoint` | — | Both players switch their Active Pokemon |
| `moveEnergy` | `count`, `energyType?` | Move energy cards between your Pokemon (source and destination chosen per card) |
| `moveDamageCounters` | `count` | Move damage counters between any Pokemon in play, one at a time |
| `devolveDefending` | — | Remove the Defending Pokemon's highest evolution card to its owner's hand; damage stays, conditions clear, KO check applies |
| `damageCounters` | `count`, `target` | Place damage counters (10 each), ignores weakness/resistance |
| `heal` | `amount`, `target` | Remove damage |
| `draw` | `count` | Controller draws |
| `drawPerOpponentPokemon` | — | Draw one per opposing Pokemon in play (Steven's Advice) |
| `discardFromHand` | `count`, `energyType?` | Controller chooses cards from hand to discard; `energyType` restricts the payable cost |
| `discardSelfEnergy` | `count`, `energyType?` | Discard energy from the Pokemon that owns the effect (`count: "all"` discards every attached energy) |
| `applyCondition` | `condition`, `target: "defending"` | `asleep`, `confused`, or `paralyzed` (they replace each other) |
| `applyPoison` | `target: "defending"` | Poison (stacks with the above) |
| `applyBurn` | `target: "defending"` | Burn (stacks) |
| `flip` | `heads: Effect[]`, `tails: Effect[]` | Coin flip branch; nest freely |
| `damagePerHeads` | `flips`, `amount`, `target`, `recoilIfNoHeads?` | Flip N coins, `amount` damage per heads; with `recoilIfNoHeads`, zero heads deals that much damage to the attacker instead |
| `searchDeck` | `filter`, `count` | Pick matching cards from deck into hand, then shuffle |
| `switchSelf` | `optional?` | Switch your Active with a chosen Benched Pokemon (`optional: true` adds a "Don't switch" choice) |
| `gustOpponent` | — | Controller drags a chosen opposing Benched Pokemon to Active |
| `attachEnergyFromDiscard` | `energyType`, `target` | Energy acceleration from discard (Firestarter) |
| `attachEnergyFromHand` | `energyType?`, `target` | Extra attachment from hand (Water Call); omit `energyType` to attach any basic Energy. `target` is `anySelfChoice` or `self` |
| `attachEnergyFromDeck` | `energyType`, `basicOnly?`, `targetType?` | Search your deck for an Energy card providing `energyType` and attach it to one of your Pokemon (`targetType` limits targets to Pokemon of that type), then shuffle |
| `rareCandy` | — | Evolve a Basic into a matching Stage 2 from hand, skipping Stage 1 |

`nextAttackBonus` accepts `amount` and an optional `attackName`. The bonus is available only during the controller's next turn and, when named, only for that attack.

### Targets

| target | resolves to |
|--------|-------------|
| `defending` | Opponent's Active Pokemon |
| `self` | The Pokemon that owns the effect (attacker, or the Power's Pokemon) |
| `selfBenchChoice` | Controller picks one of their Benched Pokemon |
| `anySelfChoice` | Controller picks any of their Pokemon in play |
| `opponentBenchChoice` | Controller picks an opposing Benched Pokemon |
| `anyOpponentChoice` | Controller picks any of the opponent's Pokemon in play |
| `eachOpponentBench` | Every opposing Benched Pokemon |

### Search filters

All fields optional and combined with AND: `supertype` (`Pokemon`/`Trainer`/`Energy`), `stage`, `excludeEx: true`, `basicEnergy: true`, `nameContains`, `maxHp` (Pokemon at or below this HP — Holon Mentor), `deltaOnly: true` (Delta Species Pokemon only).

## Worked example: a sniping attacker

```json
{
  "id": "custom-zapdos",
  "name": "Custom Zapdos",
  "image": "/cards/custom-zapdos.png",
  "supertype": "Pokemon",
  "stage": "Basic",
  "hp": 80,
  "types": ["Lightning"],
  "weakness": "Fighting",
  "retreatCost": 2,
  "attacks": [
    {
      "name": "Thunder Snipe",
      "cost": ["Lightning", "Lightning"],
      "text": "Choose 1 of your opponent's Benched Pokemon. Flip a coin. If heads, this attack does 30 damage to it and Paralyzes the Defending Pokemon.",
      "effects": [
        {
          "op": "flip",
          "heads": [
            { "op": "damage", "amount": 30, "target": "opponentBenchChoice" },
            { "op": "applyCondition", "condition": "paralyzed", "target": "defending" }
          ],
          "tails": []
        }
      ]
    }
  ]
}
```
