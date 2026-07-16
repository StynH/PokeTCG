import { suite, test, assertEqual, assertTrue } from "../harness";
import { configuredGame, attack } from "../helpers";

suite("Buried Relic's Mew", () => {
  test("Shifting Melody moves Energy from a Regi Pokémon and changes Mew's type", () => {
    const game = configuredGame({
      attackerId: "buried-relic-mew",
      defenderId: "feraligatr",
      attackerBench: [{ id: "regirock-ex", energy: ["fighting-energy"] }],
    });
    game.perform({ type: "usePower", target: { p: 0, slot: "active" } });
    assertEqual(game.players[0].active?.energy.length, 1, "Energy moved to Mew");
    assertEqual(game.players[0].bench[0]?.energy.length, 0, "Regirock lost its Energy");
    assertTrue(game.effectiveTypes(game.players[0].active!).includes("Fighting"), "Mew became Fighting");
  });

  test("Relic Pulse does 40 without the full rainbow", () => {
    const game = configuredGame({
      attackerId: "buried-relic-mew",
      defenderId: "feraligatr",
      attackerEnergy: ["grass-energy", "grass-energy", "grass-energy"],
    });
    attack(game, "Relic Pulse");
    assertEqual(game.players[1].active?.damage, 40);
    assertEqual(game.players[1].active?.condition, null);
  });

  test("Relic Pulse does 80 and Confuses with Fighting, Water, and Metal Energy", () => {
    const game = configuredGame({
      attackerId: "buried-relic-mew",
      defenderId: "feraligatr",
      attackerEnergy: ["fighting-energy", "water-energy", "metal-energy"],
    });
    attack(game, "Relic Pulse");
    assertEqual(game.players[1].active?.damage, 80, "40 + 40");
    assertEqual(game.players[1].active?.condition, "confused");
  });
});
