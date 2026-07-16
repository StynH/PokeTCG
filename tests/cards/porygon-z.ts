import { suite, test, assertEqual, assertTrue, assertFalse } from "../harness";
import { configuredGame, attack, resolveChoice } from "../helpers";

suite("Porygon-Z", () => {
  test("Energy Rewrite changes a Special Energy's provided type", () => {
    const game = configuredGame({
      attackerId: "porygon-z",
      defenderId: "feraligatr",
      attackerEnergy: ["metal-energy"],
    });
    game.perform({ type: "usePower", target: { p: 0, slot: "active" } });
    resolveChoice(game, "Psychic");
    const mon = game.players[0].active!;
    const units = game.energyUnits(mon.energy[0], mon, 0);
    assertTrue(units.provides.includes("Psychic"), "now provides Psychic");
    assertFalse(units.provides.includes("Metal"), "no longer provides Metal");
  });

  test("Energy Rewrite needs a Special Energy attached", () => {
    const game = configuredGame({
      attackerId: "porygon-z",
      defenderId: "feraligatr",
      attackerEnergy: ["grass-energy"],
    });
    assertFalse(game.getLegalActions().some((a) => a.type === "usePower"), "power not offered");
  });

  test("Data Crash adds 20 per Special Energy", () => {
    const game = configuredGame({
      attackerId: "porygon-z",
      defenderId: "feraligatr",
      attackerEnergy: ["metal-energy", "metal-energy"],
    });
    attack(game, "Data Crash");
    assertEqual(game.players[1].active?.damage, 60, "20 + 40");
  });

  test("Data Crash caps the bonus at 60", () => {
    const game = configuredGame({
      attackerId: "porygon-z",
      defenderId: "feraligatr",
      attackerEnergy: ["metal-energy", "metal-energy", "metal-energy", "metal-energy"],
    });
    attack(game, "Data Crash");
    assertEqual(game.players[1].active?.damage, 80, "20 + capped 60");
  });
});
