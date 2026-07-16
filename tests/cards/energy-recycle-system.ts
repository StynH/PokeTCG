import { suite, test, assertEqual, assertTrue, assertFalse } from "../harness";
import { configuredGame, resolveChoice, instance } from "../helpers";

function play(game: ReturnType<typeof configuredGame>, id: string): void {
  const card = instance(id);
  game.players[0].hand.push(card);
  game.perform({ type: "playTrainer", handUid: card.uid });
}

suite("Energy Recycle System", () => {
  test("is unplayable with no basic Energy in the discard", () => {
    const game = configuredGame({ attackerId: "feraligatr", defenderId: "feraligatr" });
    const card = instance("energy-recycle-system");
    game.players[0].hand.push(card);
    assertFalse(
      game.getLegalActions().some((a) => a.type === "playTrainer"),
      "not playable"
    );
  });

  test("puts 1 basic Energy into hand when fewer than 3 are in the discard", () => {
    const game = configuredGame({ attackerId: "feraligatr", defenderId: "feraligatr" });
    game.players[0].discard.push(instance("water-energy"));
    play(game, "energy-recycle-system");
    assertTrue(game.players[0].hand.some((c) => c.def.id === "water-energy"), "Energy in hand");
  });

  test("offers a choice with 3+ and can shuffle 3 into the deck", () => {
    const game = configuredGame({ attackerId: "feraligatr", defenderId: "feraligatr" });
    game.players[0].discard.push(instance("water-energy"), instance("water-energy"), instance("water-energy"));
    play(game, "energy-recycle-system");
    resolveChoice(game, "Shuffle 3");
    assertEqual(game.players[0].discard.filter((c) => c.def.id === "water-energy").length, 0, "none left in discard");
    assertEqual(game.players[0].deck.filter((c) => c.def.id === "water-energy").length, 3, "3 back in deck");
  });

  test("choice can instead put 1 into hand", () => {
    const game = configuredGame({ attackerId: "feraligatr", defenderId: "feraligatr" });
    game.players[0].discard.push(instance("water-energy"), instance("water-energy"), instance("water-energy"));
    play(game, "energy-recycle-system");
    resolveChoice(game, "Put 1");
    assertEqual(game.players[0].hand.filter((c) => c.def.id === "water-energy").length, 1, "1 in hand");
    assertEqual(game.players[0].discard.filter((c) => c.def.id === "water-energy").length, 2, "2 left in discard");
  });
});
