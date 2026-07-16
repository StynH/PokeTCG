import { suite, test, assertEqual } from "../harness";
import { configuredGame, attack } from "../helpers";

suite("Raichu", () => {
  test("Chain Lightning does 30 to the Defender", () => {
    const game = configuredGame({
      attackerId: "raichu",
      defenderId: "snorlax",
      attackerEnergy: ["lightning-energy", "grass-energy"],
    });
    attack(game, "Chain Lightning");
    assertEqual(game.players[1].active?.damage, 30);
  });

  test("Chain Lightning snipes 10 to a Benched Pokémon", () => {
    const game = configuredGame({
      attackerId: "raichu",
      defenderId: "snorlax",
      attackerEnergy: ["lightning-energy", "grass-energy"],
      defenderBench: [{ id: "munchlax" }],
    });
    attack(game, "Chain Lightning");
    assertEqual(game.players[1].active?.damage, 30, "Defender");
    assertEqual(game.players[1].bench[0]?.damage, 10, "Benched snipe");
  });

  test("Voltage Link adds 10 while Pichu is Benched", () => {
    const game = configuredGame({
      attackerId: "raichu",
      defenderId: "snorlax",
      attackerEnergy: ["lightning-energy", "grass-energy"],
      attackerBench: [{ id: "pichu" }],
    });
    attack(game, "Chain Lightning");
    assertEqual(game.players[1].active?.damage, 40, "30 + 10");
  });

  test("Thunder Burst does 60 and discards a Lightning Energy", () => {
    const game = configuredGame({
      attackerId: "raichu",
      defenderId: "snorlax",
      attackerEnergy: ["lightning-energy", "lightning-energy", "grass-energy"],
    });
    attack(game, "Thunder Burst");
    assertEqual(game.players[1].active?.damage, 60);
    assertEqual(game.players[0].active?.energy.length, 2, "one Lightning discarded");
  });
});
