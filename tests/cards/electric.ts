import { suite, test, assertEqual, assertTrue } from "../harness";
import { configuredGame, attack, forceCoins, instance, resolveChoice, attachEnergy } from "../helpers";

suite("Mareep", () => {
  test("Static Fleece heads paralyzes the Attacking Pokémon", () => {
    const game = configuredGame({
      attackerId: "munchlax",
      defenderId: "mareep",
      attackerEnergy: ["fighting-energy", "fighting-energy"],
    });
    forceCoins(game, true);
    attack(game, "Munch");
    assertEqual(game.players[0].active?.condition, "paralyzed");
  });

  test("Static Fleece tails does not paralyze", () => {
    const game = configuredGame({
      attackerId: "munchlax",
      defenderId: "mareep",
      attackerEnergy: ["fighting-energy", "fighting-energy"],
    });
    forceCoins(game, false);
    attack(game, "Munch");
    assertEqual(game.players[0].active?.condition, null);
  });

  test("Gather Light fetches a Lightning Energy from the deck", () => {
    const game = configuredGame({
      attackerId: "mareep",
      defenderId: "feraligatr",
      attackerEnergy: ["water-energy"],
    });
    game.players[0].deck.unshift(instance("lightning-energy"));
    attack(game, "Gather Light");
    resolveChoice(game, "Lightning Energy");
    assertTrue(game.players[0].hand.some((c) => c.def.id === "lightning-energy"));
  });
});

suite("Flaaffy", () => {
  test("Charge Counter adds a charge counter", () => {
    const game = configuredGame({
      attackerId: "flaaffy",
      defenderId: "munchlax",
      attackerEnergy: ["lightning-energy"],
    });
    attack(game, "Charge Counter");
    assertEqual(game.players[0].active?.chargeCounters, 1);
  });

  test("Static Release removes all charge counters for 20 + 30 each", () => {
    const game = configuredGame({
      attackerId: "flaaffy",
      defenderId: "munchlax",
      attackerEnergy: ["water-energy"],
    });
    game.players[0].active!.chargeCounters = 1;
    attack(game, "Static Release");
    assertEqual(game.players[1].active?.damage, 50, "20 + 30");
    assertEqual(game.players[0].active?.chargeCounters, 0);
  });
});

suite("Ampharos ex", () => {
  test("Charge Beacon charges when a Lightning Energy is attached from hand", () => {
    const game = configuredGame({ attackerId: "ampharos-ex", defenderId: "munchlax" });
    attachEnergy(game, "lightning-energy", { p: 0, slot: "active" });
    assertEqual(game.players[0].active?.chargeCounters, 1);
  });

  test("Charge Beacon ignores non-Lightning Energy", () => {
    const game = configuredGame({ attackerId: "ampharos-ex", defenderId: "munchlax" });
    attachEnergy(game, "water-energy", { p: 0, slot: "active" });
    assertEqual(game.players[0].active?.chargeCounters, 0);
  });

  test("Signal Burst does 20 per charge counter removed", () => {
    const game = configuredGame({
      attackerId: "ampharos-ex",
      defenderId: "munchlax",
      attackerEnergy: ["water-energy"],
    });
    game.players[0].active!.chargeCounters = 2;
    attack(game, "Signal Burst");
    resolveChoice(game, "Remove 2");
    assertEqual(game.players[1].active?.damage, 40);
    assertEqual(game.players[0].active?.chargeCounters, 0);
  });

  test("Blackout does 70 and blocks opponent Stadiums next turn", () => {
    const game = configuredGame({
      attackerId: "ampharos-ex",
      defenderId: "onix",
      attackerEnergy: ["lightning-energy", "lightning-energy", "lightning-energy"],
    });
    const blockTurn = game.turnNumber + 1;
    attack(game, "Blackout");
    assertEqual(game.players[1].active?.damage, 70);
    assertEqual(game.players[1].noStadiumTurn, blockTurn);
  });
});
