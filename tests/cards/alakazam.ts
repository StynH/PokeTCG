import { suite, test, assertEqual, assertFalse } from "../harness";
import { configuredGame, attack, resolveChoice } from "../helpers";

suite("Alakazam", () => {
  test("Psychic Exchange moves a damage counter between your Pokémon", () => {
    const game = configuredGame({
      attackerId: "alakazam",
      defenderId: "feraligatr",
      attackerBench: [{ id: "munchlax", damage: 20 }],
    });
    game.perform({ type: "usePower", target: { p: 0, slot: "active" } });
    resolveChoice(game, "Munchlax");
    resolveChoice(game, "Alakazam");
    assertEqual(game.players[0].bench[0]?.damage, 10, "source lost a counter");
    assertEqual(game.players[0].active?.damage, 10, "destination gained a counter");
  });

  test("Psychic Exchange is blocked by a Special Condition", () => {
    const game = configuredGame({
      attackerId: "alakazam",
      defenderId: "feraligatr",
      attackerBench: [{ id: "munchlax", damage: 20 }],
    });
    game.players[0].active!.poisonCounters = 1;
    assertFalse(game.getLegalActions().some((a) => a.type === "usePower"), "power not offered");
  });

  test("Mind Shock does 30 ignoring Weakness", () => {
    const game = configuredGame({
      attackerId: "alakazam",
      defenderId: "machamp",
      attackerEnergy: ["psychic-energy", "psychic-energy"],
    });
    attack(game, "Mind Shock");
    assertEqual(game.players[1].active?.damage, 30, "Psychic Weakness ignored");
  });

  test("Psywave adds 10 per Energy on the Defender", () => {
    const game = configuredGame({
      attackerId: "alakazam",
      defenderId: "feraligatr",
      attackerEnergy: ["psychic-energy", "psychic-energy", "psychic-energy"],
      defenderEnergy: ["water-energy", "water-energy", "water-energy"],
    });
    attack(game, "Psywave");
    assertEqual(game.players[1].active?.damage, 50, "20 + 30");
  });

  test("Psywave bonus is capped at 60", () => {
    const game = configuredGame({
      attackerId: "alakazam",
      defenderId: "feraligatr",
      attackerEnergy: ["psychic-energy", "psychic-energy", "psychic-energy"],
      defenderEnergy: [
        "water-energy", "water-energy", "water-energy", "water-energy",
        "water-energy", "water-energy", "water-energy",
      ],
    });
    attack(game, "Psywave");
    assertEqual(game.players[1].active?.damage, 80, "20 + capped 60");
  });
});
