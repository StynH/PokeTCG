import { suite, test, assertTrue, assertFalse } from "../harness";
import { configuredGame, instance } from "../helpers";

function setStadium(game: ReturnType<typeof configuredGame>, id: string): void {
  game.stadium = { card: instance(id), owner: 0 };
}

suite("Mt. Moon", () => {
  test("blocks Poké-Powers on Pokémon with max HP below 70", () => {
    const game = configuredGame({ attackerId: "pikachu", defenderId: "feraligatr" });
    setStadium(game, "mt-moon");
    assertFalse(game.getLegalActions().some((a) => a.type === "usePower"), "power blocked");
  });

  test("does not block a Pokémon with 70 or more HP", () => {
    const game = configuredGame({ attackerId: "porygon2", defenderId: "feraligatr" });
    setStadium(game, "mt-moon");
    assertTrue(game.getLegalActions().some((a) => a.type === "usePower"), "power allowed");
  });

  test("without Mt. Moon a low-HP Poké-Power is usable", () => {
    const game = configuredGame({ attackerId: "pikachu", defenderId: "feraligatr" });
    assertTrue(game.getLegalActions().some((a) => a.type === "usePower"), "power usable");
  });
});
