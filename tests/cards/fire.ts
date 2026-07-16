import { suite, test, assertEqual, assertTrue, assertFalse } from "../harness";
import { configuredGame, attack, forceCoins, instance, resolveChoice } from "../helpers";

suite("Numel", () => {
  test("Kindle discards a card then retrieves a Fire Energy from the discard", () => {
    const game = configuredGame({
      attackerId: "numel",
      defenderId: "feraligatr",
      attackerEnergy: ["water-energy"],
    });
    game.players[0].hand.push(instance("water-energy"));
    game.players[0].discard.push(instance("fire-energy"));
    attack(game, "Kindle");
    resolveChoice(game, "Water Energy");
    assertTrue(game.players[0].hand.some((c) => c.def.id === "fire-energy"), "Fire Energy retrieved");
  });

  test("Stomp heads does 30", () => {
    const game = configuredGame({
      attackerId: "numel",
      defenderId: "feraligatr",
      attackerEnergy: ["fire-energy", "water-energy"],
    });
    forceCoins(game, true);
    attack(game, "Stomp");
    assertEqual(game.players[1].active?.damage, 30);
  });

  test("Stomp tails does 20", () => {
    const game = configuredGame({
      attackerId: "numel",
      defenderId: "feraligatr",
      attackerEnergy: ["fire-energy", "water-energy"],
    });
    forceCoins(game, false);
    attack(game, "Stomp");
    assertEqual(game.players[1].active?.damage, 20);
  });
});

suite("Camerupt", () => {
  test("Magma Chamber attaches Fire Energy from the discard and puts 2 damage counters on Camerupt", () => {
    const game = configuredGame({ attackerId: "camerupt", defenderId: "feraligatr" });
    game.players[0].discard.push(instance("fire-energy"));
    game.perform({ type: "usePower", target: { p: 0, slot: "active" } });
    assertEqual(game.players[0].active?.energy[0]?.def.id, "fire-energy");
    assertEqual(game.players[0].active?.damage, 20);
    assertEqual(game.players[0].discard.length, 0);
  });

  test("Magma Chamber is unavailable without discard Fire Energy", () => {
    const game = configuredGame({ attackerId: "camerupt", defenderId: "feraligatr" });
    assertFalse(game.getLegalActions().some((a) => a.type === "usePower"), "power not offered");
  });

  test("Magma Chamber is blocked by a Special Condition", () => {
    const game = configuredGame({ attackerId: "camerupt", defenderId: "feraligatr" });
    game.players[0].discard.push(instance("fire-energy"));
    game.players[0].active!.poisonCounters = 1;
    assertFalse(game.getLegalActions().some((a) => a.type === "usePower"), "power not offered");
  });

  test("Caldera does 80 and 30 to itself", () => {
    const game = configuredGame({
      attackerId: "camerupt",
      defenderId: "feraligatr",
      attackerEnergy: ["fire-energy", "fire-energy", "fire-energy"],
    });
    attack(game, "Caldera");
    assertEqual(game.players[1].active?.damage, 80);
    assertEqual(game.players[0].active?.damage, 30);
  });
});
