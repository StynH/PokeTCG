import { suite, test, assertEqual, assertFalse } from "../harness";
import { configuredGame, attack, forceCoins, resolveChoice, instance } from "../helpers";

suite("Porygon2", () => {
  test("Data Reorder rearranges the top of the deck", () => {
    const game = configuredGame({ attackerId: "porygon2", defenderId: "feraligatr" });
    game.players[0].deck.unshift(instance("fire-energy"));
    game.players[0].deck.unshift(instance("energy-search"));
    game.players[0].deck.unshift(instance("lightning-energy"));
    const deckSize = game.players[0].deck.length;
    game.perform({ type: "usePower", target: { p: 0, slot: "active" } });
    resolveChoice(game, "Fire Energy");
    resolveChoice(game, "Lightning Energy");
    assertEqual(game.players[0].deck[0]?.def.id, "fire-energy", "chosen top card");
    assertEqual(game.players[0].deck.length, deckSize, "no cards gained or lost");
  });

  test("Data Reorder is blocked by a Special Condition", () => {
    const game = configuredGame({ attackerId: "porygon2", defenderId: "feraligatr" });
    game.players[0].active!.condition = "asleep";
    assertFalse(game.getLegalActions().some((a) => a.type === "usePower"), "power not offered");
  });

  test("Signal Beam heads does 20 and Confuses", () => {
    const game = configuredGame({
      attackerId: "porygon2",
      defenderId: "feraligatr",
      attackerEnergy: ["grass-energy", "grass-energy"],
    });
    forceCoins(game, true);
    attack(game, "Signal Beam");
    assertEqual(game.players[1].active?.damage, 20);
    assertEqual(game.players[1].active?.condition, "confused");
  });
});
