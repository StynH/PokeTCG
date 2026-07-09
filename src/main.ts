import "./styles.css";
import cardsJson from "./data/cards.json";
import decksJson from "./data/decks.json";
import type { CardDef } from "./model/types";
import { buildDeck, buildLibrary, validateDeck } from "./model/loader";
import { Game } from "./engine/game";
import { chooseAction, chooseOption } from "./ai/simpleAI";
import { render, resetEventFeed, setRerender, setStepHandler, uiState } from "./ui/render";

const HUMAN = 0;
const AI = 1;

type GameMode = "pvai" | "aivai";

const library = buildLibrary(cardsJson as CardDef[]);
const deckLists = decksJson as Record<string, Record<string, number>>;
const root = document.getElementById("app")!;

let game: Game | null = null;
let aiPlayers = new Set<number>([AI]);
let aiTimer: number | null = null;
let lastTurnSeen = 0;
let lastConfig: { deckOne: string; deckTwo: string; mode: GameMode } | null = null;
let suddenDeathScheduled = false;

function startGame(deckOne: string, deckTwo: string, mode: GameMode, prizeCount = 6): void {
  const decks = [buildDeck(deckLists[deckOne], library), buildDeck(deckLists[deckTwo], library)];
  for (const [name, deck] of [[deckOne, decks[0]], [deckTwo, decks[1]]] as const) {
    const validation = validateDeck(deck);
    if (!validation.valid) console.warn(`Deck "${name}":`, validation.problems);
  }
  aiPlayers = mode === "aivai" ? new Set([0, 1]) : new Set([AI]);
  const names: [string, string] = mode === "aivai" ? ["AI Red", "AI Blue"] : ["You", "Rival"];
  lastTurnSeen = 0;
  suddenDeathScheduled = false;
  uiState.paused = false;
  resetEventFeed();
  lastConfig = { deckOne, deckTwo, mode };
  game = new Game(library, decks[0], decks[1], names, Date.now(), prizeCount);
  game.onChange = update;
  update();
}

function update(): void {
  if (!game) return;
  render(
    root,
    game,
    (action) => game!.perform(action),
    (index) => game!.resolvePending(index),
    !aiPlayers.has(HUMAN)
  );
  if (game.phase === "finished" && game.suddenDeath && lastConfig && !suddenDeathScheduled) {
    suddenDeathScheduled = true;
    const config = lastConfig;
    window.setTimeout(() => startGame(config.deckOne, config.deckTwo, config.mode, 1), 3000);
    return;
  }
  scheduleAI();
}

function aiDelay(current: Game): number {
  const pace = uiState.speedFast ? 0.25 : 1;
  if (current.pending) return (500 + Math.random() * 700) * pace;
  let delay = 900 + Math.random() * 1100;
  if (current.turnNumber !== lastTurnSeen) delay += 1200;
  return delay * pace;
}

function scheduleAI(): void {
  if (!game || game.phase !== "playing") return;
  if (uiState.paused) {
    if (aiTimer !== null) {
      window.clearTimeout(aiTimer);
      aiTimer = null;
    }
    return;
  }
  const actor = game.pending ? game.pending.player : game.current;
  if (!aiPlayers.has(actor)) return;
  if (aiTimer !== null) return;
  aiTimer = window.setTimeout(() => {
    aiTimer = null;
    if (!game || game.phase !== "playing" || uiState.paused) return;
    stepAI();
  }, aiDelay(game));
}

function stepAI(): void {
  if (!game || game.phase !== "playing") return;
  const actor = game.pending ? game.pending.player : game.current;
  if (!aiPlayers.has(actor)) return;
  lastTurnSeen = game.turnNumber;
  if (game.pending) {
    game.resolvePending(chooseOption(game.pending));
  } else {
    game.perform(chooseAction(game));
  }
}

function showStartScreen(): void {
  root.innerHTML = "";
  const screen = document.createElement("div");
  screen.className = "start-screen";
  const panel = document.createElement("div");
  panel.className = "start-panel glass";

  const title = document.createElement("div");
  title.className = "start-title";
  title.textContent = "PokeTCG EX Simulator";
  const subtitle = document.createElement("div");
  subtitle.className = "start-subtitle";
  subtitle.textContent = "2006 EX-era rules · Pokemon-ex · Poke-Powers · JSON custom cards";
  panel.appendChild(title);
  panel.appendChild(subtitle);

  const makePicker = (labelText: string, options: string[], defaultIndex: number) => {
    const wrap = document.createElement("div");
    wrap.className = "deck-pick";
    const label = document.createElement("label");
    label.textContent = labelText;
    const select = document.createElement("select");
    for (const name of options) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    }
    select.selectedIndex = defaultIndex % options.length;
    wrap.appendChild(label);
    wrap.appendChild(select);
    panel.appendChild(wrap);
    return select;
  };

  const deckNames = Object.keys(deckLists);
  const modeSelect = makePicker("Mode", ["You vs AI", "AI vs AI"], 0);
  const deckOneSelect = makePicker("Your deck", deckNames, 0);
  const deckTwoSelect = makePicker("Rival's deck", deckNames, 1);

  modeSelect.onchange = () => {
    const spectate = modeSelect.selectedIndex === 1;
    deckOneSelect.previousElementSibling!.textContent = spectate ? "AI Red's deck" : "Your deck";
    deckTwoSelect.previousElementSibling!.textContent = spectate ? "AI Blue's deck" : "Rival's deck";
  };

  const startButton = document.createElement("button");
  startButton.className = "action-btn start-btn";
  startButton.textContent = "Start Battle";
  startButton.onclick = () =>
    startGame(deckOneSelect.value, deckTwoSelect.value, modeSelect.selectedIndex === 1 ? "aivai" : "pvai");
  panel.appendChild(startButton);

  screen.appendChild(panel);
  root.appendChild(screen);
}

setRerender(update);
setStepHandler(stepAI);
showStartScreen();
