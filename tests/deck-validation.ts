import cardsJson from "../src/data/cards.json";
import { buildLibrary, validateDeck } from "../src/model/loader";
import type { CardDef } from "../src/model/types";
import { assertFalse, assertTrue, suite, test } from "./harness";

const library = buildLibrary(cardsJson as CardDef[]);
const fightingEnergy = library["fighting-energy"];
const hitmonleeStar = library["styns-hitmonlee-star"];
const giratinaStar = library["giratina-star"];

suite("Deck validation", () => {
  test("allows one Gold Star Pokémon", () => {
    const result = validateDeck([...Array(59).fill(fightingEnergy), hitmonleeStar]);

    assertTrue(result.valid, result.problems.join(", "));
  });

  test("rejects two different Gold Star Pokémon", () => {
    const result = validateDeck([
      ...Array(58).fill(fightingEnergy),
      hitmonleeStar,
      giratinaStar,
    ]);

    assertFalse(result.valid);
    assertTrue(result.problems.includes("Deck has 2 Gold Star Pokémon, maximum is 1"));
  });

  test("rejects two copies of the same Gold Star Pokémon", () => {
    const result = validateDeck([
      ...Array(58).fill(fightingEnergy),
      hitmonleeStar,
      hitmonleeStar,
    ]);

    assertFalse(result.valid);
    assertTrue(result.problems.includes("Deck has 2 Gold Star Pokémon, maximum is 1"));
  });
});
