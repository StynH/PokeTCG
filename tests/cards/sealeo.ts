import { suite, test, assertEqual } from "../harness";
import { configuredGame, attack, resolveChoice, instance } from "../helpers";

suite("Sealeo", () => {
  test("Gather Ice returns up to 2 Water Energy from the discard", () => {
    const game = configuredGame({ attackerId: "sealeo", defenderId: "feraligatr" });
    game.players[0].discard.push(instance("water-energy"), instance("water-energy"), instance("fire-energy"));
    attack(game, "Gather Ice");
    resolveChoice(game, "Water Energy");
    assertEqual(game.players[0].hand.filter((c) => c.def.id === "water-energy").length, 2, "2 Water in hand");
    assertEqual(game.players[0].discard.filter((c) => c.def.id === "water-energy").length, 0, "none left in discard");
  });

  test("Aurora Beam does 40", () => {
    const game = configuredGame({
      attackerId: "sealeo",
      defenderId: "feraligatr",
      attackerEnergy: ["water-energy", "water-energy", "grass-energy"],
    });
    attack(game, "Aurora Beam");
    assertEqual(game.players[1].active?.damage, 40);
  });
});
