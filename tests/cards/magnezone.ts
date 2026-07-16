import { suite, test, assertEqual, assertTrue } from "../harness";
import { configuredGame, attack, resolveChoice } from "../helpers";

suite("Magnezone", () => {
  test("Polarity Field makes Lightning Energy also provide Metal", () => {
    const game = configuredGame({
      attackerId: "magnezone",
      defenderId: "feraligatr",
      attackerEnergy: ["lightning-energy"],
    });
    const mon = game.players[0].active!;
    const units = game.energyUnits(mon.energy[0], mon, 0);
    assertTrue(units.provides.includes("Lightning"), "still Lightning");
    assertTrue(units.provides.includes("Metal"), "also Metal");
    assertEqual(units.count, 1, "still 1 Energy at a time");
  });

  test("Magnetic Pulse does 50 and moves a basic Energy to the Bench", () => {
    const game = configuredGame({
      attackerId: "magnezone",
      defenderId: "munchlax",
      attackerEnergy: ["lightning-energy", "metal-energy", "grass-energy"],
      attackerBench: [{ id: "munchlax" }],
    });
    attack(game, "Magnetic Pulse");
    resolveChoice(game, "Munchlax");
    assertEqual(game.players[1].active?.damage, 50);
    assertEqual(game.players[0].bench[0]?.energy.length, 1, "Energy moved to Bench");
  });

  test("Magnetic Pulse can decline moving Energy", () => {
    const game = configuredGame({
      attackerId: "magnezone",
      defenderId: "munchlax",
      attackerEnergy: ["lightning-energy", "metal-energy", "grass-energy"],
      attackerBench: [{ id: "munchlax" }],
    });
    attack(game, "Magnetic Pulse");
    resolveChoice(game, "Don't move Energy");
    assertEqual(game.players[0].bench[0]?.energy.length, 0, "no Energy moved");
  });
});
