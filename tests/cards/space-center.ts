import { suite, test, assertEqual } from "../harness";
import { configuredGame, attack, instance } from "../helpers";

function setStadium(game: ReturnType<typeof configuredGame>, id: string): void {
  game.stadium = { card: instance(id), owner: 0 };
}

suite("Space Center", () => {
  test("ignores a Basic Pokémon's Poké-Body", () => {
    const game = configuredGame({
      attackerId: "munchlax",
      defenderId: "cacnea",
      attackerEnergy: ["fighting-energy", "fighting-energy"],
    });
    setStadium(game, "space-center");
    attack(game, "Munch");
    assertEqual(game.players[1].active?.damage, 20, "Cacnea took the hit");
    assertEqual(game.players[0].active?.poisonCounters, 0, "Poison Spikes ignored");
  });

  test("does not ignore an Evolved Pokémon's Poké-Body", () => {
    const game = configuredGame({
      attackerId: "sealeo",
      defenderId: "snorlax",
      attackerEnergy: ["water-energy", "water-energy", "grass-energy"],
    });
    game.players[1].active!.condition = "asleep";
    setStadium(game, "space-center");
    attack(game, "Aurora Beam");
    assertEqual(game.players[1].active?.damage, 10, "Deep Sleep still reduces (Snorlax is Stage 1)");
  });
});
