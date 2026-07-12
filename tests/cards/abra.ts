import { suite, test, assertEqual } from "../harness";
import { configuredGame } from "../helpers";

suite("Abra", () => {
  test("Teleportation makes Retreat Cost 0 while Psychic Energy attached", () => {
    const game = configuredGame({
      attackerId: "abra",
      defenderId: "feraligatr",
      attackerEnergy: ["psychic-energy"],
    });
    const active = game.players[0].active!;
    assertEqual(game.effectiveRetreatCost({ p: 0, slot: "active" }, active), 0);
  });

  test("Teleportation does nothing without Psychic Energy (Retreat Cost stays 1)", () => {
    const game = configuredGame({
      attackerId: "abra",
      defenderId: "feraligatr",
      attackerEnergy: ["water-energy"],
    });
    const active = game.players[0].active!;
    assertEqual(game.effectiveRetreatCost({ p: 0, slot: "active" }, active), 1);
  });
});
