import { suite, test, assertEqual } from "../harness";
import { configuredGame, forceCoins, instance } from "../helpers";

function play(game: ReturnType<typeof configuredGame>, id: string): void {
  const card = instance(id);
  game.players[0].hand.push(card);
  game.perform({ type: "playTrainer", handUid: card.uid });
}

suite("Life Herb", () => {
  test("heads removes 6 damage counters and all Special Conditions", () => {
    const game = configuredGame({
      attackerId: "feraligatr",
      defenderId: "feraligatr",
      attackerDamage: 60,
    });
    game.players[0].active!.condition = "asleep";
    forceCoins(game, true);
    play(game, "life-herb");
    assertEqual(game.players[0].active?.damage, 0, "60 damage healed");
    assertEqual(game.players[0].active?.condition, null, "conditions cleared");
  });

  test("tails does nothing", () => {
    const game = configuredGame({
      attackerId: "feraligatr",
      defenderId: "feraligatr",
      attackerDamage: 60,
    });
    forceCoins(game, false);
    play(game, "life-herb");
    assertEqual(game.players[0].active?.damage, 60, "not healed");
  });

  test("cannot target a Pokémon-ex", () => {
    const game = configuredGame({
      attackerId: "nidoking-ex",
      defenderId: "feraligatr",
      attackerDamage: 60,
    });
    forceCoins(game, true);
    play(game, "life-herb");
    assertEqual(game.players[0].active?.damage, 60, "ex left untouched");
  });
});
