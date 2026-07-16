import { suite, test, assertEqual, assertTrue, assertFalse } from "../harness";
import { configuredGame, attack, resolveChoice, instance } from "../helpers";

suite("Noctowl", () => {
  test("Night Watch draws a chosen card and buries the other", () => {
    const game = configuredGame({ attackerId: "noctowl", defenderId: "feraligatr" });
    game.players[0].deck.unshift(instance("energy-search"));
    game.players[0].deck.unshift(instance("lightning-energy"));
    const deckSize = game.players[0].deck.length;
    game.perform({ type: "usePower", target: { p: 0, slot: "active" } });
    resolveChoice(game, "Energy Search");
    assertTrue(game.players[0].hand.some((c) => c.def.id === "energy-search"), "chosen card in hand");
    assertEqual(game.players[0].deck.length, deckSize - 1, "one card left the deck");
    assertEqual(
      game.players[0].deck[game.players[0].deck.length - 1]?.def.id,
      "lightning-energy",
      "other card on the bottom"
    );
  });

  test("Night Watch is blocked by a Special Condition", () => {
    const game = configuredGame({ attackerId: "noctowl", defenderId: "feraligatr" });
    game.players[0].active!.condition = "confused";
    assertFalse(game.getLegalActions().some((a) => a.type === "usePower"), "power not offered");
  });

  test("Silent Wing does 30", () => {
    const game = configuredGame({
      attackerId: "noctowl",
      defenderId: "feraligatr",
      attackerEnergy: ["grass-energy", "grass-energy"],
    });
    attack(game, "Silent Wing");
    assertEqual(game.players[1].active?.damage, 30);
  });
});
