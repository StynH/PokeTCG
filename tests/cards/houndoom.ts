import { suite, test, assertEqual, assertTrue } from "../harness";
import { configuredGame, attack, forceCoins, resolveChoice, instance } from "../helpers";

suite("Houndoom", () => {
  test("Black Flame does 30 and Burns", () => {
    const game = configuredGame({
      attackerId: "houndoom",
      defenderId: "feraligatr",
      attackerEnergy: ["fire-energy", "fire-energy"],
    });
    forceCoins(game, true);
    attack(game, "Black Flame");
    assertEqual(game.players[1].active?.damage, 30);
    assertTrue(game.players[1].active?.burned ?? false, "defender Burned");
  });

  test("Dark Fang makes the opponent discard when the Defender has a Special Condition", () => {
    const game = configuredGame({
      attackerId: "houndoom",
      defenderId: "feraligatr",
      attackerEnergy: ["fire-energy", "fire-energy", "grass-energy"],
    });
    game.players[1].active!.condition = "confused";
    game.players[1].hand.push(instance("energy-search"));
    attack(game, "Dark Fang");
    resolveChoice(game, "Energy Search");
    assertEqual(game.players[1].active?.damage, 40);
    assertTrue(game.players[1].discard.some((c) => c.def.id === "energy-search"), "opponent discarded the card");
  });

  test("Dark Fang does not force a discard without a Special Condition", () => {
    const game = configuredGame({
      attackerId: "houndoom",
      defenderId: "feraligatr",
      attackerEnergy: ["fire-energy", "fire-energy", "grass-energy"],
    });
    game.players[1].hand.push(instance("energy-search"));
    attack(game, "Dark Fang");
    assertEqual(game.players[1].active?.damage, 40);
    assertTrue(game.players[1].hand.some((c) => c.def.id === "energy-search"), "card kept, no discard");
  });
});
