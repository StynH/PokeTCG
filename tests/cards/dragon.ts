import { suite, test, assertEqual, assertTrue } from "../harness";
import { configuredGame, attack, forceCoins, instance, resolveChoice } from "../helpers";

suite("Dratini", () => {
  test("Call for Friends puts up to 2 Basic Pokémon onto the Bench", () => {
    const game = configuredGame({
      attackerId: "dratini",
      defenderId: "feraligatr",
      attackerEnergy: ["water-energy"],
    });
    attack(game, "Call for Friends");
    resolveChoice(game, "Munchlax");
    resolveChoice(game, "Munchlax");
    assertEqual(game.players[0].bench.length, 2, "two Basics benched");
  });

  test("Tail Slap does 20", () => {
    const game = configuredGame({
      attackerId: "dratini",
      defenderId: "feraligatr",
      attackerEnergy: ["water-energy", "water-energy"],
    });
    attack(game, "Tail Slap");
    assertEqual(game.players[1].active?.damage, 20);
  });
});

suite("Dragonair", () => {
  test("Energy Loop retrieves a basic Energy and returns 1 attached Energy", () => {
    const game = configuredGame({
      attackerId: "dragonair",
      defenderId: "feraligatr",
      attackerEnergy: ["fire-energy", "fire-energy"],
    });
    game.players[0].discard.push(instance("water-energy"));
    attack(game, "Energy Loop");
    resolveChoice(game, "Fire Energy");
    assertEqual(game.players[0].active?.energy.length, 1, "one Energy returned");
    assertEqual(game.players[1].active?.damage, 30, "30 damage");
    assertTrue(
      game.players[0].hand.some((c) => c.def.id === "water-energy"),
      "retrieved Water Energy in hand"
    );
  });

  test("Dragon Twister with 2 heads does 40 and discards 2 Energy", () => {
    const game = configuredGame({
      attackerId: "dragonair",
      defenderId: "feraligatr",
      attackerEnergy: ["fire-energy", "lightning-energy", "fire-energy"],
      defenderEnergy: ["water-energy", "water-energy"],
    });
    forceCoins(game, true);
    attack(game, "Dragon Twister");
    resolveChoice(game, "Water Energy");
    resolveChoice(game, "Water Energy");
    assertEqual(game.players[1].active?.damage, 40, "40 damage");
    assertEqual(game.players[1].active?.energy.length, 0, "both Energy discarded");
  });

  test("Dragon Twister with all tails does nothing", () => {
    const game = configuredGame({
      attackerId: "dragonair",
      defenderId: "feraligatr",
      attackerEnergy: ["fire-energy", "lightning-energy", "fire-energy"],
      defenderEnergy: ["water-energy"],
    });
    forceCoins(game, false);
    attack(game, "Dragon Twister");
    assertEqual(game.players[1].active?.damage, 0);
    assertEqual(game.players[1].active?.energy.length, 1);
  });
});

suite("Dragonite ex", () => {
  test("Dragon Navigation recycles an attached basic Energy through the deck", () => {
    const game = configuredGame({
      attackerId: "dragonite-ex",
      defenderId: "feraligatr",
      attackerEnergy: ["fire-energy"],
    });
    game.players[0].discard.push(instance("water-energy"));
    game.perform({ type: "usePower", target: { p: 0, slot: "active" } });
    assertEqual(game.players[0].deck[0]?.def.id, "fire-energy", "attached Energy back on deck");
    assertEqual(game.players[0].active?.energy[0]?.def.id, "water-energy", "discard Energy attached");
  });

  test("Sky Judgment does 30 per basic Energy in the top 3", () => {
    const game = configuredGame({
      attackerId: "dragonite-ex",
      defenderId: "feraligatr",
      attackerEnergy: ["fire-energy", "lightning-energy", "water-energy"],
    });
    game.players[0].deck.unshift(instance("fire-energy"), instance("lightning-energy"));
    attack(game, "Sky Judgment");
    assertEqual(game.players[1].active?.damage, 60, "2 basic Energy -> 60");
  });
});
