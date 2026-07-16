import { suite, test, assertEqual, assertTrue } from "../harness";
import { configuredGame, attack, resolveChoice, instance } from "../helpers";

suite("Linoone", () => {
  test("Quick Search fetches a Trainer (Item) from the deck", () => {
    const game = configuredGame({
      attackerId: "linoone",
      defenderId: "feraligatr",
      attackerEnergy: ["grass-energy"],
    });
    game.players[0].deck.push(instance("energy-search"));
    attack(game, "Quick Search");
    resolveChoice(game, "Energy Search");
    assertTrue(game.players[0].hand.some((c) => c.def.id === "energy-search"), "Item in hand");
  });

  test("Dash Attack does 30 and can switch Linoone out", () => {
    const game = configuredGame({
      attackerId: "linoone",
      defenderId: "feraligatr",
      attackerEnergy: ["grass-energy", "grass-energy"],
      attackerBench: [{ id: "munchlax" }],
    });
    attack(game, "Dash Attack");
    resolveChoice(game, "Munchlax");
    assertEqual(game.players[1].active?.damage, 30);
    assertEqual(game.players[0].active?.def.id, "munchlax", "Linoone switched out");
  });

  test("Dash Attack can decline the switch", () => {
    const game = configuredGame({
      attackerId: "linoone",
      defenderId: "feraligatr",
      attackerEnergy: ["grass-energy", "grass-energy"],
      attackerBench: [{ id: "munchlax" }],
    });
    attack(game, "Dash Attack");
    resolveChoice(game, "Don't switch");
    assertEqual(game.players[0].active?.def.id, "linoone", "stayed Active");
  });
});
