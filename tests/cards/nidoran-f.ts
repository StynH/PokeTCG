import { suite, test, assertEqual } from "../harness";
import { configuredGame, attack, forceCoins, resolveChoice, instance } from "../helpers";

suite("Nidoran ♀", () => {
  test("Call for Family benches a Nidoran from the deck", () => {
    const game = configuredGame({
      attackerId: "nidoran-f",
      defenderId: "feraligatr",
      attackerEnergy: ["grass-energy"],
    });
    game.players[0].deck.push(instance("nidoran-m"));
    attack(game, "Call for Family");
    resolveChoice(game, "Nidoran");
    assertEqual(game.players[0].bench.length, 1, "one Nidoran benched");
    assertEqual(game.players[0].bench[0]?.def.id, "nidoran-m");
  });

  test("Poison Sting heads does 10 and Poisons", () => {
    const game = configuredGame({
      attackerId: "nidoran-f",
      defenderId: "feraligatr",
      attackerEnergy: ["grass-energy"],
    });
    forceCoins(game, true);
    attack(game, "Poison Sting");
    assertEqual(game.players[1].active?.poisonCounters, 1);
    assertEqual(game.players[1].active?.damage, 20, "10 attack + 10 poison tick");
  });

  test("Poison Sting tails does 10 and no Poison", () => {
    const game = configuredGame({
      attackerId: "nidoran-f",
      defenderId: "feraligatr",
      attackerEnergy: ["grass-energy"],
    });
    forceCoins(game, false);
    attack(game, "Poison Sting");
    assertEqual(game.players[1].active?.poisonCounters, 0);
    assertEqual(game.players[1].active?.damage, 10);
  });
});
