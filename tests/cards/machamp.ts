import { suite, test, assertEqual, assertTrue } from "../harness";
import { configuredGame, attack } from "../helpers";

suite("Machamp", () => {
  test("Seismic Throw does 80 and 20 to itself", () => {
    const game = configuredGame({
      attackerId: "machamp",
      defenderId: "feraligatr",
      attackerEnergy: ["fighting-energy", "fighting-energy", "grass-energy"],
    });
    attack(game, "Seismic Throw");
    assertEqual(game.players[1].active?.damage, 80);
    assertEqual(game.players[0].active?.damage, 20, "recoil");
  });

  test("Final Stance survives a Knock Out by discarding 2 Energy", () => {
    const game = configuredGame({
      attackerId: "munchlax",
      defenderId: "machamp",
      attackerEnergy: ["grass-energy", "grass-energy"],
      defenderEnergy: ["metal-energy", "metal-energy"],
      defenderDamage: 100,
    });
    attack(game, "Munch");
    assertTrue(game.players[1].active !== null, "Machamp survived");
    assertEqual(game.players[1].active?.damage, 100, "remaining HP is 10");
    assertEqual(game.players[1].active?.energy.length, 0, "2 Energy discarded");
  });

  test("Final Stance cannot save Machamp without 2 Energy", () => {
    const game = configuredGame({
      attackerId: "munchlax",
      defenderId: "machamp",
      attackerEnergy: ["grass-energy", "grass-energy"],
      defenderEnergy: ["metal-energy"],
      defenderDamage: 100,
    });
    attack(game, "Munch");
    assertEqual(game.players[1].active, null, "Machamp was Knocked Out");
  });
});
