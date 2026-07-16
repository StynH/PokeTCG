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

Deck rules enforced at load: exactly 60 cards, max 4 copies per name (basic Energy exempt), and max 1 Gold Star Pokémon total.

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
- `isGoldStar: true` marks the card as a Pokémon ★ (Gold Star) and gives it the shiny star badge.
- `isCrystal: true` marks the card as a Crystal Pokémon (crystal badge/glow). Purely cosmetic — no special ruling.
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
| `lockAttack` | `target`, `attackName?`, `chooseDefendingAttack?` | Prevent only a named attack from being used on that PokÃ©mon's next turn; optionally prompt for a Defending PokÃ©mon attack |
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
| `discardSelfEnergy` | `count`, `energyType?`, `thenIfDone?` | Discard energy from the Pokemon that owns the effect (`count: "all"` discards every attached energy); run `thenIfDone` only when at least one card was discarded |
| `applyCondition` | `condition`, `target: "defending"` | `asleep`, `confused`, or `paralyzed` (they replace each other) |
| `applyPoison` | `target: "defending"` | Poison (stacks with the above) |
| `applyBurn` | `target: "defending"` | Burn (stacks) |
| `flip` | `heads: Effect[]`, `tails: Effect[]` | Coin flip branch; nest freely |
| `damagePerHeads` | `flips`, `amount`, `target`, `recoilIfNoHeads?` | Flip N coins, `amount` damage per heads; with `recoilIfNoHeads`, zero heads deals that much damage to the attacker instead |
| `searchDeck` | `filter`, `count` | Pick matching cards from deck into hand, then shuffle |
| `switchSelf` | `optional?` | Switch your Active with a chosen Benched Pokemon (`optional: true` adds a "Don't switch" choice) |
| `promoteSelfToActive` | `moveDamageCounters?` | Swap the source Pokémon (usually a Benched Power holder) into the Active spot; if `moveDamageCounters` is set, move that many counters from the displaced Active onto the source. Gate it with a `conditional` when the power needs a precondition (Styn's Hitmonlee ★ "Step Into the Ring") |
| `gustOpponent` | — | Controller drags a chosen opposing Benched Pokemon to Active |
| `attachEnergyFromDiscard` | `energyType`, `target`, `thenIfDone?` | Energy acceleration from discard; run `thenIfDone` only after an Energy was attached |
| `attachEnergyFromHand` | `energyType?`, `target` | Extra attachment from hand (Water Call); omit `energyType` to attach any basic Energy. `target` is `anySelfChoice` or `self` |
| `attachEnergyFromDeck` | `energyType`, `basicOnly?`, `targetType?` | Search your deck for an Energy card providing `energyType` and attach it to one of your Pokemon (`targetType` limits targets to Pokemon of that type), then shuffle |
| `rareCandy` | — | Evolve a Basic into a matching Stage 2 from hand, skipping Stage 1 |

`nextAttackBonus` accepts `amount` and an optional `attackName`. The bonus is available only during the controller's next turn and, when named, only for that attack.

### More generic ops

| op | fields | meaning |
|----|--------|---------|
| `conditional` | `cond`, `then`, `else?` | Run `then` (or `else`) depending on a `Predicate` (see below). The mainstay for "if X, do more damage / apply a condition" attacks — put the `+N` as `{ op: "damage", amount: N, target: "defending" }` inside `then` and it merges into the attack's total |
| `searchToBench` | `count`, `filter?` | Search your deck for up to `count` cards (default Basic Pokémon) and put them onto your Bench, then shuffle |
| `retrieveEnergyToHand` | `energyType?`, `basicOnly?`, `thenIfDone?` | Move a matching Energy from your discard to your hand; if one was moved, run `thenIfDone` |
| `returnSelfEnergyToHand` | `count` | Return `count` Energy attached to the source Pokémon to your hand |
| `moveSelfEnergyToDeckTop` | `basicOnly?`, `energyType?`, `thenIfDone?` | Put a matching attached Energy on top of your deck; if one was moved, run `thenIfDone` |
| `revealTopDamagePerEnergy` | `count`, `damagePer` | Reveal the top `count` cards; `damagePer` × basic Energy found; those Energy to hand, the rest discarded |
| `discardTopForDamage` | `count`, `base`, `damagePer`, `energyType?` | Discard the top `count` cards; deal `base` + `damagePer` × matching Energy discarded |
| `discardDefenderEnergyPerHeads` | `flips`, `damageIfAnyHeads?` | Flip `flips` coins; on ≥1 heads deal `damageIfAnyHeads` and discard 1 Defender Energy per heads |
| `dischargeForDamage` | `base`, `damagePer`, `mode` | Remove charge counters (`mode: "all"` or `"choose"`); deal `base` + `damagePer` × removed |
| `addCharge` | `count` | Put `count` charge counters on the source Pokémon |
| `damageDamagedOpponent` | `amount` | Deal `amount` (no Weakness/Resistance) to a chosen opposing Pokémon that already has damage counters |
| `discardStadiumInPlay` | `optional?`, `thenIfDone?` | Optionally or mandatorily discard the Stadium in play; if one was discarded, run `thenIfDone` |
| `discardOpponentHandChosen` | `count` | Opponent reveals their hand; you choose `count` cards to discard |
| `opponentDrawCard` | — | Your opponent draws a card |
| `millOpponent` | `count` | Discard the top `count` cards of your opponent's deck |
| `blockOpponentStadiumNextTurn` | — | Your opponent can't play Stadiums during their next turn |
| `endTurn` | — | End your turn immediately |
| `copyDefenderAbility` | — | Copy the Defending Pokémon's Poké-Power/Body onto the source until the end of your next turn |
| `damagePerCardInDiscards` | `base`, `damagePer`, `filter`, `both?` | Deal `base` + `damagePer` × cards matching `filter` in the discard pile(s) (`both` counts both players) |
| `lostZoneCostEnergy` | `energyType`, `costCount`, `max` | Move to the Lost Zone the discard Energy a `discardProvidesCost` body lent to pay this attack |
| `becomeEnergyType` | `untilEndOfTurn?` | The source Pokémon's type becomes the type(s) of the Energy most recently attached to it (default until end of turn; `untilEndOfTurn: false` makes it permanent). Pair with an `onAttachBasicEnergy` trigger — a Crystal-type Body |

`discardSelfEnergy` also accepts `optional: true`, which prompts a Yes/No before discarding ("You may discard…") and only runs `thenIfDone` if you choose to.

`damage` also accepts `immediate: true` to apply active-spot damage right away (with Weakness/Resistance) instead of merging into the attack's end-of-effects total — needed when a later effect switches the Defending Pokémon or checks whether it was Knocked Out.

`damageScaled`'s `per` also supports `selfDistinctBasicEnergyTypes` (number of different basic Energy types on the source).

### Predicates (for `conditional.cond`)

`defenderStatus` (`status`: `asleep`/`confused`/`paralyzed`/`poisoned`/`burned`), `selfHasEnergyTypes` (`types`), `namedPokemonInPlay` (`names` — true when, for every listed name, you have a Pokémon in play whose name *contains* it, e.g. `"Regice"` matches "Light Regice"), `selfDistinctBasicEnergyAtLeast` (`n`), `selfDamageCountersExactly` (`n`), `activeDamageCountersAtLeast` (`n`, your own Active), `defenderRetreatCostAtLeast` (`n`), `stadiumInPlay`, `opponentFewerPrizes`, `defenderWasBenchedStartOfTurn`, `selfInPlayTurns` (`turns`), `defenderKnockedOut`, and `not` (`of`).

### More modifiers

| kind | meaning |
|------|---------|
| `preventAttackEffects` | Prevent all effects of attacks (excluding damage) done to the holder (optional `requiresNoStadium`) |
| `retreatDelta` | Adjust Retreat Cost by `amount`; may require the source to be Active (`sourceRequiresActive`) or a Stadium in play (`requiresStadium`) |
| `retreatPerStadiumInDiscard` | While the holder is Active, each player's Active Retreat Cost is +1 per Stadium in that player's discard (`sourceRequiresActive`) |
| `extraPrizeOnPoisonKO` | Take 1 more Prize when an opposing Pokémon is Knocked Out by Poison |
| `energyProvidesExtra` | Basic Energy of `fromType` attached to the holder also provides `addType` (still 1 unit) |
| `discardProvidesCost` | Up to `max` Energy of `energyType` in your discard pay the holder's attack costs (pair with `lostZoneCostEnergy`) |
| `borrowAttacks` | The holder may use the attacks of Pokémon whose name contains `nameContains` in either discard pile |

New search-filter fields: `providesType`, `providesAnyType`, `trainerKind`, `evolution` (Pokémon that isn't Basic). New power `trigger`: `onOpponentActiveEnergyAttach`.

`onAttachBasicEnergy` triggers accept either `triggerBasicEnergyType` (single type, basic Energy only) or `triggerBasicEnergyTypes` (a list; matches any Energy card providing one of the types, including special Energy like Metal/Darkness).

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

## More generic building blocks

Additional ops:

| op | fields | meaning |
|----|--------|---------|
| `retrieveFromDiscard` | `filter`, `count?`, `thenIfDone?` | Put matching cards from your discard pile into your hand (Sableye's Dark Bargain fetches a Trainer) |
| `lookTopChooseToHand` | `count` | Look at the top `count` cards, put 1 into your hand, the rest on the bottom of your deck (Noctowl's Night Watch) |
| `reorderTopDeck` | `count` | Look at the top `count` cards and put them back on top in any order (Porygon2's Data Reorder) |
| `shiftEnergyToSelf` | `fromNames`, `becomeType?` | Move an Energy from one of your Pokémon whose name contains a `fromNames` entry onto the source Pokémon; `becomeType` makes the source's type match that Energy until end of turn (Mew's Shifting Melody) |
| `rewriteEnergyType` | — | Choose a Special Energy on the source and a type; that Energy provides 1 of that type until end of turn (Porygon-Z's Energy Rewrite) |

Extended fields: `moveDamageCounters.ownOnly` (only your Pokémon), `moveEnergy.fromSelf`/`optional` (move from the source Pokémon, may decline — Magnetic Pulse), `heal.restrictNames` (only heal Pokémon whose name contains a listed string — Family Care), `retrieveEnergyToHand.count`, `damageScaled.specialOnly` (count only Special Energy) and `damageScaled.perType` (for `yourBench`/`oppBench`, count only Pokémon of that type — Iron Rampage), `applyCondition.target: "self"` (Resting Press), and `CardFilter.trainerKindExclude` (e.g. exclude Supporter/Stadium).

New predicates: `defenderAnyStatus` (any Special Condition), `defenderEnergyAtLeast` (`n`).

New modifiers and fields:

| kind / field | meaning |
|------|---------|
| `surviveKO` (`energyCost`, `remainingHp`) | If the holder would be Knocked Out by an opponent's attack, discard `energyCost` Energy and survive with `remainingHp` HP (Machamp's Final Stance) |
| `damageMinus.requiresAttackerEvolved` | Only reduces damage from Evolved attackers (Fortified Armor) |
| `damageMinus.requiresAttackerSpecialEnergy` | Only reduces damage from attackers with Special Energy (Frozen Hide) |
| `damageMinus.requiresHolderAsleep` | Only reduces damage while the holder is Asleep (Deep Sleep) |
| `damagePlus.requiresNamedInPlay` | Bonus applies only while you have the named Pokémon in play (Voltage Link) |
| `retreatDelta.targetNameOneOf` | Retreat change applies only to Pokémon whose name contains a listed string (Royal Escort) |
| `energyProvidesExtra.requiresHolderType` | The extra Energy type only applies while attached to a Pokémon of that type (Polarity Field) |

## Trainer/Energy support cards

More ops:

| op | fields | meaning |
|----|--------|---------|
| `recycleBasicEnergy` | — | Search your discard for basic Energy; put 1 into your hand, or (if 3+ available) shuffle 3 back into your deck (Energy Recycle System) |

Extended `heal` fields: `excludeEx` (can't target Pokémon-ex) and `clearConditions` (also remove all Special Conditions; the target may be chosen even with 0 damage if it has a condition). Used by Life Herb (`heal` 60, `excludeEx`, `clearConditions`).

Energy cards accept `onAttachEffects` (Effect[]) with optional `onAttachExcludesEx`: the effects run, with the receiving Pokémon as the source, when the Energy is attached from hand (skipped if the target is a Pokémon-ex). Heal Energy uses `[{ "op": "heal", "amount": 10, "target": "self", "clearConditions": true }]`.

New Stadium/Body-and-Power modifiers:

| kind | meaning |
|------|---------|
| `disablePowersBelowHp` (`hp`) | Pokémon with maximum HP below `hp` can't use Poké-Powers (Mt. Moon, `scope: "allPokemon"`) |
| `disableBodies` (`basicOnly?`, `excludeEx?`, `excludeOwnerName?`) | Ignore Poké-Bodies on matching Pokémon; `excludeOwnerName` skips Pokémon whose name contains `'s` (an owner) (Space Center) |
| `borrowUnderneathAttacks` (`excludeEx?`) | Each Active Evolved Pokémon may also use the attacks printed on the cards underneath it (its pre-evolutions) — you still pay the cost (Meteor Falls) |
