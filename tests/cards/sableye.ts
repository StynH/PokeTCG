import { suite, test, assertEqual, assertTrue, assertFalse } from "../harness";
import { configuredGame, attack, resolveChoice, instance } from "../helpers";

suite("Sableye", () => {
  test("Dark Bargain discards a Darkness Energy to fetch a Trainer from the discard", () => {
    const game = configuredGame({ attackerId: "sableye", defenderId: "feraligatr" });
    game.players[0].hand.push(instance("darkness-energy"));
    game.players[0].discard.push(instance("energy-search"));
    game.perform({ type: "usePower", target: { p: 0, slot: "active" } });
    resolveChoice(game, "Darkness Energy");
    assertTrue(game.players[0].hand.some((c) => c.def.id === "energy-search"), "Trainer retrieved");
    assertTrue(game.players[0].discard.some((c) => c.def.id === "darkness-energy"), "Energy discarded");
  });

  test("Dark Bargain is unavailable without a Darkness Energy in hand", () => {
    const game = configuredGame({ attackerId: "sableye", defenderId: "feraligatr" });
    game.players[0].discard.push(instance("energy-search"));
    assertFalse(game.getLegalActions().some((a) => a.type === "usePower"), "power not offered");
  });

  test("Dark Bargain is unavailable without a Trainer in the discard", () => {
    const game = configuredGame({ attackerId: "sableye", defenderId: "feraligatr" });
    game.players[0].hand.push(instance("darkness-energy"));
    assertFalse(game.getLegalActions().some((a) => a.type === "usePower"), "power not offered");
  });

  test("Shadow Sneak does 30", () => {
    const game = configuredGame({
      attackerId: "sableye",
      defenderId: "feraligatr",
      attackerEnergy: ["fire-energy", "grass-energy"],
    });
    attack(game, "Shadow Sneak");
    assertEqual(game.players[1].active?.damage, 30);
  });
});
