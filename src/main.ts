import "./styles.css";
import cardsJson from "./data/cards.json";
import decksJson from "./data/decks.json";
import type { CardDef } from "./model/types";
import { buildDeck, buildLibrary, validateDeck } from "./model/loader";
import { Game } from "./engine/game";
import { chooseAction, chooseOption } from "./ai/simpleAI";
import {
  type AIProfile,
  BALANCED,
  PRESETS,
  WEIGHT_KEYS,
  WEIGHT_LABELS,
  allProfiles,
  deleteCustomProfile,
  findProfile,
  loadCustomProfiles,
  mixWeights,
  saveCustomProfile,
} from "./ai/profiles";
import { render, resetEventFeed, setRerender, setStepHandler, uiState } from "./ui/render";
import { loadCustomDecks, openDeckEditor } from "./ui/deckEditor";

const HUMAN = 0;
const AI = 1;

type GameMode = "pvai" | "aivai";

const library = buildLibrary(cardsJson as CardDef[]);
const builtinDecks = decksJson as Record<string, Record<string, number>>;
const allDeckLists = () => ({ ...builtinDecks, ...loadCustomDecks() });
const root = document.getElementById("app")!;

let game: Game | null = null;
let aiPlayers = new Set<number>([AI]);
let aiProfiles: [AIProfile, AIProfile] = [BALANCED, BALANCED];
let aiTimer: number | null = null;
let lastTurnSeen = 0;
let lastConfig: { deckOne: string; deckTwo: string; mode: GameMode; profiles: [AIProfile, AIProfile] } | null = null;
let suddenDeathScheduled = false;

function startGame(deckOne: string, deckTwo: string, mode: GameMode, profiles: [AIProfile, AIProfile], prizeCount = 6): void {
  const lists = allDeckLists();
  const decks = [buildDeck(lists[deckOne], library), buildDeck(lists[deckTwo], library)];
  for (const [name, deck] of [[deckOne, decks[0]], [deckTwo, decks[1]]] as const) {
    const validation = validateDeck(deck);
    if (!validation.valid) console.warn(`Deck "${name}":`, validation.problems);
  }
  aiPlayers = mode === "aivai" ? new Set([0, 1]) : new Set([AI]);
  aiProfiles = profiles;
  const names: [string, string] =
    mode === "aivai"
      ? [`${profiles[0].name} (AI)`, `${profiles[1].name} (AI)`]
      : ["You", `${profiles[1].name} (AI)`];
  lastTurnSeen = 0;
  suddenDeathScheduled = false;
  uiState.paused = false;
  resetEventFeed();
  lastConfig = { deckOne, deckTwo, mode, profiles };
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
    window.setTimeout(() => startGame(config.deckOne, config.deckTwo, config.mode, config.profiles, 1), 3000);
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
    game.resolvePending(chooseOption(game.pending, aiProfiles[game.pending.player]));
  } else {
    game.perform(chooseAction(game, aiProfiles[game.current]));
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

function profileEntries(withNone: string | null): Array<{ value: string; label: string }> {
  const entries = allProfiles().map((p) => ({ value: p.name, label: p.name }));
  return withNone === null ? entries : [{ value: "", label: withNone }, ...entries];
}

function openProfileEditor(onProfilesChanged: () => void): void {
  const overlay = el("div", "overlay", document.body);
  const modal = el("div", "modal glass profile-modal", overlay);
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };

  const titleRow = el("div", "editor-title-row", modal);
  const title = el("div", "modal-title", titleRow);
  title.textContent = "AI Profiles";
  const closeX = el("button", "editor-close", titleRow);
  closeX.textContent = "✕";
  closeX.onclick = () => overlay.remove();

  const topGrid = el("div", "editor-grid", modal);
  const editSelect = el("select");
  labeledField("Edit profile", editSelect, topGrid);
  const nameInput = el("input");
  nameInput.type = "text";
  nameInput.placeholder = "AI name, e.g. Bill";
  labeledField("Name", nameInput, topGrid);

  const mixGrid = el("div", "editor-grid", modal);
  const baseSelect = el("select");
  labeledField("Base strategy", baseSelect, mixGrid);
  const mixSelect = el("select");
  labeledField("Mix with", mixSelect, mixGrid);

  const sliderRow = (labelText: string, max: number, parent: HTMLElement) => {
    const wrap = el("div", "slider-row", parent);
    const label = el("label", "", wrap);
    label.textContent = labelText;
    const slider = el("input", "", wrap);
    slider.type = "range";
    slider.min = "0";
    slider.max = String(max);
    const value = el("span", "slider-value", wrap);
    const showValue = () => (value.textContent = `${slider.value}%`);
    slider.addEventListener("input", showValue);
    return { wrap, slider, showValue };
  };

  const ratio = sliderRow("Mix ratio", 100, modal);
  ratio.slider.value = "50";
  ratio.showValue();
  ratio.wrap.style.display = "none";

  el("div", "editor-divider", modal);

  const weightSliders = {} as Record<(typeof WEIGHT_KEYS)[number], ReturnType<typeof sliderRow>>;
  for (const key of WEIGHT_KEYS) {
    weightSliders[key] = sliderRow(WEIGHT_LABELS[key], 200, modal);
  }

  const setWeights = (weights: AIProfile["weights"]) => {
    for (const key of WEIGHT_KEYS) {
      weightSliders[key].slider.value = String(Math.round(weights[key] * 100));
      weightSliders[key].showValue();
    }
  };
  setWeights(BALANCED.weights);

  const applyMix = () => {
    const base = findProfile(baseSelect.value);
    setWeights(
      mixSelect.value
        ? mixWeights(base.weights, findProfile(mixSelect.value).weights, Number(ratio.slider.value) / 100)
        : base.weights
    );
  };
  baseSelect.onchange = applyMix;
  mixSelect.onchange = () => {
    ratio.wrap.style.display = mixSelect.value ? "" : "none";
    applyMix();
  };
  ratio.slider.addEventListener("input", applyMix);
  editSelect.onchange = () => {
    if (!editSelect.value) {
      nameInput.value = "";
      setWeights(BALANCED.weights);
      return;
    }
    const profile = findProfile(editSelect.value);
    nameInput.value = profile.name;
    setWeights(profile.weights);
  };

  const actions = el("div", "editor-actions", modal);
  const saveButton = el("button", "action-btn", actions);
  saveButton.textContent = "Save";
  const deleteButton = el("button", "action-btn", actions);
  deleteButton.textContent = "Delete";
  const status = el("span", "editor-status", actions);

  const refreshEditorSelects = () => {
    fillSelect(editSelect, [
      { value: "", label: "— new profile —" },
      ...loadCustomProfiles().map((p) => ({ value: p.name, label: p.name })),
    ]);
    fillSelect(baseSelect, profileEntries(null));
    fillSelect(mixSelect, profileEntries("— none —"));
  };
  refreshEditorSelects();

  saveButton.onclick = () => {
    const name = nameInput.value.trim();
    if (!name) {
      status.textContent = "Enter an AI name";
      return;
    }
    if (PRESETS.some((p) => p.name === name)) {
      status.textContent = `"${name}" is a preset name`;
      return;
    }
    saveCustomProfile({
      name,
      custom: true,
      weights: Object.fromEntries(
        WEIGHT_KEYS.map((key) => [key, Number(weightSliders[key].slider.value) / 100])
      ) as unknown as AIProfile["weights"],
    });
    status.textContent = `Saved "${name}"`;
    refreshEditorSelects();
    editSelect.value = name;
    onProfilesChanged();
  };
  deleteButton.onclick = () => {
    const name = nameInput.value.trim();
    if (!allProfiles().some((p) => p.custom && p.name === name)) {
      status.textContent = "No custom profile with that name";
      return;
    }
    deleteCustomProfile(name);
    status.textContent = `Deleted "${name}"`;
    refreshEditorSelects();
    editSelect.value = "";
    nameInput.value = "";
    onProfilesChanged();
  };
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
  const profileOneSelect = makePicker("AI Red", [], 0, grid);
  const profileTwoSelect = makePicker("Rival AI", [], 0, grid);
  const profileOneWrap = profileOneSelect.parentElement as HTMLElement;
  const profileTwoWrap = profileTwoSelect.parentElement as HTMLElement;

  const refreshProfileSelects = () => {
    fillSelect(profileOneSelect, profileEntries(null));
    fillSelect(profileTwoSelect, profileEntries(null));
  };
  refreshProfileSelects();

  const applyMode = () => {
    const spectate = modeSelect.selectedIndex === 1;
    deckOneSelect.previousElementSibling!.textContent = spectate ? "AI Red's deck" : "Your deck";
    deckTwoSelect.previousElementSibling!.textContent = spectate ? "AI Blue's deck" : "Rival's deck";
    profileTwoSelect.previousElementSibling!.textContent = spectate ? "AI Blue" : "Rival AI";
    profileOneWrap.style.display = spectate ? "" : "none";
    profileTwoWrap.style.gridColumn = spectate ? "" : "1 / -1";
  };
  modeSelect.onchange = applyMode;
  applyMode();

  const manageRow = el("div", "start-manage-row", panel);
  const editorButton = el("button", "manage-profiles-btn", manageRow);
  editorButton.textContent = "🛠 Deck Editor";
  editorButton.onclick = () => openDeckEditor(root, library, builtinDecks, showStartScreen);
  const manageButton = el("button", "manage-profiles-btn", manageRow);
  manageButton.textContent = "⚙ Manage AI profiles";
  manageButton.onclick = () => openProfileEditor(refreshProfileSelects);

  const startButton = el("button", "action-btn start-btn", panel);
  startButton.textContent = "Start Battle";
  startButton.onclick = () =>
    startGame(deckOneSelect.value, deckTwoSelect.value, modeSelect.selectedIndex === 1 ? "aivai" : "pvai", [
      findProfile(profileOneSelect.value),
      findProfile(profileTwoSelect.value),
    ]);
}

setRerender(update);
setStepHandler(stepAI);
showStartScreen();
