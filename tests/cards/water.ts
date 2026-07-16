import { suite, test, assertEqual, assertTrue } from "../harness";
import { configuredGame, attack, instance, resolveChoice } from "../helpers";

suite("Chinchou", () => {
  test("Signal Search takes a Lightning Energy from the top of the deck", () => {
    const game = configuredGame({
      attackerId: "chinchou",
      defenderId: "feraligatr",
      attackerEnergy: ["water-energy"],
    });
    game.players[0].deck.unshift(instance("lightning-energy"));
    attack(game, "Signal Search");
    resolveChoice(game, "Lightning Energy");
    assertTrue(game.players[0].hand.some((c) => c.def.id === "lightning-energy"), "Energy in hand");
  });

  test("Spark does 10 to a Benched Pokémon", () => {
    const game = configuredGame({
      attackerId: "chinchou",
      defenderId: "feraligatr",
      attackerEnergy: ["lightning-energy"],
      defenderBench: [{ id: "wooper" }],
    });
    attack(game, "Spark");
    assertEqual(game.players[1].bench[0]?.damage, 10);
    assertEqual(game.players[1].active?.damage, 0);
  });
});

suite("Lanturn", () => {
  test("Deep Current lets a basic Water Energy pay for Lightning", () => {
    const game = configuredGame({
      attackerId: "lanturn",
      defenderId: "munchlax",
      attackerEnergy: ["water-energy"],
    });
    assertTrue(game.canPayCost(["Lightning"], game.players[0].active!, 0), "Water pays Lightning");
  });

  test("Deep Current still provides only one Energy at a time", () => {
    const game = configuredGame({ attackerId: "lanturn", defenderId: "munchlax", attackerEnergy: ["water-energy"] });
    assertEqual(game.canPayCost(["Water", "Lightning"], game.players[0].active!, 0), false);
  });

  test("Blackwater Pulse confuses when both Water and Lightning Energy are attached", () => {
    const game = configuredGame({
      attackerId: "lanturn",
      defenderId: "munchlax",
      attackerEnergy: ["water-energy", "lightning-energy"],
    });
    attack(game, "Blackwater Pulse");
    assertEqual(game.players[1].active?.damage, 40);
    assertEqual(game.players[1].active?.condition, "confused");
  });

  test("Abyssal Light does 50 to a damaged opponent ignoring Weakness", () => {
    const game = configuredGame({
      attackerId: "lanturn",
      defenderId: "feraligatr",
      attackerEnergy: ["water-energy", "lightning-energy", "lightning-energy"],
      defenderDamage: 20,
    });
    attack(game, "Abyssal Light");
    assertEqual(game.players[1].active?.damage, 70, "20 + 50, no Weakness doubling");
  });
});
