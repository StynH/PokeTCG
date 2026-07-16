import "./styles.css";
import cardsJson from "./data/cards.json";
import decksJson from "./data/decks.json";
import type { CardDef } from "./model/types";
import { buildDeck, buildLibrary, validateDeck } from "./model/loader";
import { Game } from "./engine/game";
import { AIController } from "./ai/controller";
import { render, resetEventFeed, setRerender, setStepHandler, uiState } from "./ui/render";
import { loadCustomDecks, openDeckEditor } from "./ui/deckEditor";
import {
  type GameStats,
  type MatchOutcome,
  type TournamentCtx,
  collectGameStats,
  openTournamentSetup,
} from "./ui/tournament";

const HUMAN = 0;
const AI = 1;

type GameMode = "pvai" | "aivai";

const library = buildLibrary(cardsJson as CardDef[]);
const builtinDecks = decksJson as Record<string, Record<string, number>>;
const allDeckLists = () => ({ ...builtinDecks, ...loadCustomDecks() });
const root = document.getElementById("app")!;

let game: Game | null = null;
let aiPlayers = new Set<number>([AI]);
let aiTimer: number | null = null;
let aiAbort: AbortController | null = null;
let aiInFlight = false;
const aiController = new AIController();
let lastTurnSeen = 0;
let lastConfig: {
  deckOne: string;
  deckTwo: string;
  mode: GameMode;
  names?: [string, string];
} | null = null;
let suddenDeathScheduled = false;
let matchDone: ((outcome: MatchOutcome) => void) | null = null;
let tournamentLabel: string | null = null;
let currentPrizeCount = 6;
let pendingGameStats: GameStats[] = [];
let statsHarvested = false;

function startGame(
  deckOne: string,
  deckTwo: string,
  mode: GameMode,
  prizeCount = 6,
  namesOverride?: [string, string]
): void {
  aiAbort?.abort();
  aiController.cancel();
  aiInFlight = false;
  uiState.thinking = false;
  const lists = allDeckLists();
  const decks = [buildDeck(lists[deckOne], library), buildDeck(lists[deckTwo], library)];
  for (const [name, deck] of [[deckOne, decks[0]], [deckTwo, decks[1]]] as const) {
    const validation = validateDeck(deck);
    if (!validation.valid) console.warn(`Deck "${name}":`, validation.problems);
  }
  aiPlayers = mode === "aivai" ? new Set([0, 1]) : new Set([AI]);
  const names: [string, string] =
    namesOverride ??
    (mode === "aivai"
      ? ["AI Red", "AI Blue"]
      : ["You", "AI"]);
  lastTurnSeen = 0;
  suddenDeathScheduled = false;
  uiState.paused = false;
  resetEventFeed();
  lastConfig = { deckOne, deckTwo, mode, names: namesOverride };
  currentPrizeCount = prizeCount;
  statsHarvested = false;
  game = new Game(library, decks[0], decks[1], names, Date.now(), prizeCount);
  game.onChange = update;
  update();
}

function update(): void {
  if (!game) return;
  if (matchDone && game.phase === "finished" && !statsHarvested) {
    statsHarvested = true;
    pendingGameStats.push(collectGameStats(game));
  }
  const gameOverAction = matchDone
    ? {
        label: "Continue Tournament ➜",
        onClick: () => {
          const finished = game!;
          const done = matchDone!;
          matchDone = null;
          tournamentLabel = null;
          const games = pendingGameStats;
          pendingGameStats = [];
          done({
            winnerSide: (finished.winner ?? 0) as 0 | 1,
            score: [
              currentPrizeCount - finished.players[0].prizes.length,
              currentPrizeCount - finished.players[1].prizes.length,
            ],
            games,
          });
        },
      }
    : null;
  render(
    root,
    game,
    (action) => game!.perform(action),
    (index) => game!.resolvePending(index),
    !aiPlayers.has(HUMAN),
    gameOverAction
  );
  if (tournamentLabel && game.phase === "playing") {
    const chip = document.createElement("div");
    chip.className = "tourney-chip glass";
    chip.textContent = `🏆 ${tournamentLabel}`;
    root.appendChild(chip);
  }
  if (game.phase === "finished" && game.suddenDeath && lastConfig && !suddenDeathScheduled) {
    suddenDeathScheduled = true;
    const config = lastConfig;
    window.setTimeout(
      () => startGame(config.deckOne, config.deckTwo, config.mode, 1, config.names),
      3000
    );
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
    aiAbort?.abort();
    aiController.cancel();
    aiInFlight = false;
    uiState.thinking = false;
    if (aiTimer !== null) {
      window.clearTimeout(aiTimer);
      aiTimer = null;
    }
    return;
  }
  const actor = game.pending ? game.pending.player : game.current;
  if (!aiPlayers.has(actor)) return;
  if (aiTimer !== null || aiInFlight) return;
  aiTimer = window.setTimeout(() => {
    aiTimer = null;
    if (!game || game.phase !== "playing" || uiState.paused) return;
    void stepAI();
  }, aiDelay(game));
}

async function stepAI(): Promise<void> {
  if (!game || game.phase !== "playing") return;
  const actor = game.pending ? game.pending.player : game.current;
  if (!aiPlayers.has(actor)) return;
  lastTurnSeen = game.turnNumber;
  const searchedGame = game;
  aiAbort?.abort();
  aiAbort = new AbortController();
  aiInFlight = true;
  uiState.thinking = !game.pending;
  update();
  try {
    const chosen = await aiController.chooseDecision(searchedGame, {
      seed: (searchedGame.turnNumber * 65537 + searchedGame.revision * 257 + actor * 17) >>> 0,
      timeBudgetMs: 5000,
      signal: aiAbort.signal,
    });
    if (
      game !== searchedGame ||
      game.revision !== chosen.revision ||
      game.phase !== "playing" ||
      uiState.paused
    ) return;
    game.applyDecision(chosen.decision);
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError")) console.error(error);
  } finally {
    if (game === searchedGame) {
      aiInFlight = false;
      uiState.thinking = false;
      aiAbort = null;
      update();
    }
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  parent?: HTMLElement
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  parent?.appendChild(node);
  return node;
}

function labeledField(labelText: string, control: HTMLElement, parent: HTMLElement): HTMLElement {
  const wrap = el("div", "deck-pick", parent);
  const label = el("label", "", wrap);
  label.textContent = labelText;
  wrap.appendChild(control);
  return wrap;
}

function fillSelect(select: HTMLSelectElement, entries: Array<{ value: string; label: string }>): void {
  const previous = select.value;
  select.innerHTML = "";
  for (const entry of entries) {
    const option = el("option", "", select);
    option.value = entry.value;
    option.textContent = entry.label;
  }
  if (entries.some((e) => e.value === previous)) select.value = previous;
}

function showStartScreen(): void {
  root.innerHTML = "";
  const screen = el("div", "start-screen", root);
  const panel = el("div", "start-panel glass", screen);

  const title = el("div", "start-title", panel);
  title.textContent = "PokeTCG EX Simulator";
  const subtitle = el("div", "start-subtitle", panel);
  subtitle.textContent = "2006 EX-era rules · Pokemon-ex · Poke-Powers · JSON custom cards";

  const makePicker = (labelText: string, options: string[], defaultIndex: number, parent: HTMLElement) => {
    const select = el("select");
    fillSelect(select, options.map((name) => ({ value: name, label: name })));
    select.selectedIndex = options.length ? defaultIndex % options.length : -1;
    labeledField(labelText, select, parent);
    return select;
  };

  const deckNames = Object.keys(allDeckLists());
  const modeSelect = makePicker("Mode", ["You vs AI", "AI vs AI"], 0, panel);
  const grid = el("div", "start-grid", panel);
  const deckOneSelect = makePicker("Your deck", deckNames, 0, grid);
  const deckTwoSelect = makePicker("Rival's deck", deckNames, 1, grid);

  const applyMode = () => {
    const spectate = modeSelect.selectedIndex === 1;
    deckOneSelect.previousElementSibling!.textContent = spectate ? "AI Red's deck" : "Your deck";
    deckTwoSelect.previousElementSibling!.textContent = spectate ? "AI Blue's deck" : "Rival's deck";
  };
  modeSelect.onchange = applyMode;
  applyMode();

  const manageRow = el("div", "start-manage-row", panel);
  const editorButton = el("button", "menu-link-btn", manageRow);
  editorButton.textContent = "🛠 Deck Editor";
  editorButton.onclick = () => openDeckEditor(root, library, builtinDecks, showStartScreen);
  const startButton = el("button", "action-btn start-btn", panel);
  startButton.textContent = "Start Battle";
  startButton.onclick = () =>
    startGame(deckOneSelect.value, deckTwoSelect.value, modeSelect.selectedIndex === 1 ? "aivai" : "pvai");

  const tourneyButton = el("button", "action-btn tourney-btn", panel);
  tourneyButton.textContent = "🏆 AI Tournament";
  tourneyButton.onclick = () => openTournamentSetup(root, tournamentCtx);
}

const tournamentCtx: TournamentCtx = {
  deckNames: () => Object.keys(allDeckLists()),
  showStartScreen,
  playMatch: (a, b, label, onDone) => {
    matchDone = onDone;
    tournamentLabel = label;
    pendingGameStats = [];
    startGame(a.deck, b.deck, "aivai", 6, [a.name, b.name]);
  },
};

setRerender(update);
setStepHandler(stepAI);
showStartScreen();
