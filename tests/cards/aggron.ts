import { suite, test, assertEqual } from "../harness";
import { configuredGame, attack } from "../helpers";

suite("Aggron", () => {
  test("Iron Rampage does 60 base with no Benched Metal Pokémon", () => {
    const game = configuredGame({
      attackerId: "aggron",
      defenderId: "feraligatr",
      attackerEnergy: ["metal-energy", "metal-energy", "grass-energy", "grass-energy"],
    });
    attack(game, "Iron Rampage");
    assertEqual(game.players[1].active?.damage, 60);
  });

  test("Iron Rampage adds 10 per Benched Metal Pokémon", () => {
    const game = configuredGame({
      attackerId: "aggron",
      defenderId: "feraligatr",
      attackerEnergy: ["metal-energy", "metal-energy", "grass-energy", "grass-energy"],
      attackerBench: [{ id: "magnezone" }, { id: "munchlax" }],
    });
    attack(game, "Iron Rampage");
    assertEqual(game.players[1].active?.damage, 70, "60 + 10 for one Metal");
  });

  test("Fortified Armor reduces damage from an Evolved attacker by 20", () => {
    const game = configuredGame({
      attackerId: "sealeo",
      defenderId: "aggron",
      attackerEnergy: ["water-energy", "water-energy", "water-energy"],
    });
    attack(game, "Aurora Beam");
    assertEqual(game.players[1].active?.damage, 20, "40 - 20");
  });

  test("Fortified Armor does not reduce damage from a Basic attacker", () => {
    const game = configuredGame({
      attackerId: "munchlax",
      defenderId: "aggron",
      attackerEnergy: ["fighting-energy", "fighting-energy"],
    });
    attack(game, "Munch");
    assertEqual(game.players[1].active?.damage, 20);
  });
});
