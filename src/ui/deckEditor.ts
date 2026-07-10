import type { CardDef, CardLibrary, EnergyType, Stage, Supertype } from "../model/types";
import { ALL_TYPES, isEnergy, isPokemon, isTrainer } from "../model/types";
import { buildDeck, validateDeck } from "../model/loader";
import { buildCardDetail, cardFace, energyIcon } from "./render";

export type DeckList = Record<string, number>;

const STORAGE_KEY = "poketcg-custom-decks";
const DECK_SIZE = 60;
const MAX_COPIES = 4;

const STAGE_ORDER: Record<Stage, number> = { Basic: 0, Stage1: 1, Stage2: 2 };
const SECTION_LABELS: Record<Supertype, string> = { Pokemon: "Pokémon", Trainer: "Trainers", Energy: "Energy" };
const SECTIONS: Supertype[] = ["Pokemon", "Trainer", "Energy"];
const FILTER_TYPES: EnergyType[] = [...ALL_TYPES, "Colorless"];

export function loadCustomDecks(): Record<string, DeckList> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, DeckList>) : {};
  } catch {
    return {};
  }
}

function persistCustomDecks(decks: Record<string, DeckList>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(decks));
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function lineRoot(def: CardDef, byName: Map<string, CardDef>): string {
  let current = def;
  while (isPokemon(current) && current.evolvesFrom) {
    const prev = byName.get(current.evolvesFrom);
    if (!prev) break;
    current = prev;
  }
  return current.name;
}

function sortKey(def: CardDef, byName: Map<string, CardDef>): string {
  if (isPokemon(def)) {
    return `0|${def.types[0] ?? "zz"}|${lineRoot(def, byName)}|${STAGE_ORDER[def.stage]}|${def.name}`;
  }
  if (isTrainer(def)) return `1|${def.kind}|${def.name}`;
  return `2|${isEnergy(def) && def.isBasic ? 0 : 1}|${def.name}`;
}

function matchesType(def: CardDef, type: EnergyType): boolean {
  if (isPokemon(def)) return def.types.includes(type);
  if (isEnergy(def)) return def.provides.includes(type);
  return false;
}

export function openDeckEditor(
  root: HTMLElement,
  library: CardLibrary,
  builtinDecks: Record<string, DeckList>,
  onExit: () => void
): void {
  const byName = new Map(Object.values(library).map((def) => [def.name, def]));
  const catalog = Object.values(library).sort((a, b) =>
    sortKey(a, byName).localeCompare(sortKey(b, byName))
  );

  let working: DeckList = {};
  let savedJson = JSON.stringify(working);
  let currentSelection = "";
  let filterSupertype: Supertype | null = null;
  let filterType: EnergyType | null = null;
  let flashTimer: number | null = null;

  const dirty = () => JSON.stringify(working) !== savedJson;
  const totalCount = () => Object.values(working).reduce((sum, n) => sum + n, 0);

  function nameCount(name: string): number {
    let count = 0;
    for (const [id, n] of Object.entries(working)) {
      const def = library[id];
      if (def && def.name === name && !(isEnergy(def) && def.isBasic)) count += n;
    }
    return count;
  }

  function goldStarCount(): number {
    let count = 0;
    for (const [id, n] of Object.entries(working)) {
      const def = library[id];
      if (def && isPokemon(def) && def.isGoldStar) count += n;
    }
    return count;
  }

  function canAdd(def: CardDef): boolean {
    if (totalCount() >= DECK_SIZE) return false;
    if (isEnergy(def) && def.isBasic) return true;
    if (isPokemon(def) && def.isGoldStar && goldStarCount() >= 1) return false;
    return nameCount(def.name) < MAX_COPIES;
  }

  root.innerHTML = "";
  const layout = el("div", "editor-layout");
  root.appendChild(layout);

  const detailPanel = el("div", "detail-panel");
  detailPanel.appendChild(el("div", "panel-title", "Card Detail"));
  const detailBody = el("div", "detail-body");
  detailBody.appendChild(el("div", "detail-hint", "Hover a card to inspect it."));
  detailPanel.appendChild(detailBody);
  layout.appendChild(detailPanel);

  function showDetail(def: CardDef): void {
    detailBody.replaceChildren(buildCardDetail(def));
  }

  const main = el("div", "editor-main");
  layout.appendChild(main);

  const topbar = el("div", "editor-topbar glass");
  main.appendChild(topbar);

  const backButton = el("button", "action-btn btn-muted", "← Menu");
  topbar.appendChild(backButton);

  const nameInput = el("input", "deck-name-input");
  nameInput.type = "text";
  nameInput.placeholder = "Deck name...";
  topbar.appendChild(nameInput);

  const loadSelect = el("select", "deck-load-select");
  topbar.appendChild(loadSelect);

  const saveButton = el("button", "action-btn btn-attack", "💾 Save");
  topbar.appendChild(saveButton);

  const deleteButton = el("button", "action-btn btn-muted", "🗑 Delete");
  topbar.appendChild(deleteButton);

  const statusEl = el("span", "editor-flash");
  topbar.appendChild(statusEl);

  const totalChip = el("span", "count-chip chip-total");
  topbar.appendChild(totalChip);

  const validationEl = el("div", "editor-validation");
  main.appendChild(validationEl);

  const deckColumn = el("div", "deck-column glass");
  main.appendChild(deckColumn);

  const libraryPanel = el("div", "library-panel glass");
  layout.appendChild(libraryPanel);

  libraryPanel.appendChild(el("div", "panel-title", "Card Library"));

  const searchInput = el("input", "library-search");
  searchInput.type = "text";
  searchInput.placeholder = "🔍 Search cards...";
  libraryPanel.appendChild(searchInput);

  const supertypeRow = el("div", "filter-row");
  libraryPanel.appendChild(supertypeRow);
  const supertypeButtons = new Map<Supertype | null, HTMLButtonElement>();
  const supertypeChoices: Array<[Supertype | null, string]> = [
    [null, "All"],
    ["Pokemon", "Pokémon"],
    ["Trainer", "Trainers"],
    ["Energy", "Energy"],
  ];
  for (const [value, label] of supertypeChoices) {
    const button = el("button", "filter-btn", label);
    button.onclick = () => {
      filterSupertype = value;
      updateFilters();
      updateLibrary();
    };
    supertypeButtons.set(value, button);
    supertypeRow.appendChild(button);
  }

  const typeRow = el("div", "filter-row type-row");
  libraryPanel.appendChild(typeRow);
  const typeButtons = new Map<EnergyType, HTMLButtonElement>();
  for (const type of FILTER_TYPES) {
    const button = el("button", "type-chip");
    button.appendChild(energyIcon(type, "icon-cost"));
    button.title = type;
    button.onclick = () => {
      filterType = filterType === type ? null : type;
      updateFilters();
      updateLibrary();
    };
    typeButtons.set(type, button);
    typeRow.appendChild(button);
  }

  const libraryGrid = el("div", "library-grid");
  libraryPanel.appendChild(libraryGrid);
  libraryPanel.appendChild(el("div", "library-hint", "Click to add · Right-click to remove"));

  function flash(message: string): void {
    statusEl.textContent = message;
    statusEl.classList.add("flash-on");
    if (flashTimer !== null) window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => statusEl.classList.remove("flash-on"), 1800);
  }

  function addCard(def: CardDef): void {
    if (!canAdd(def)) {
      flash(
        totalCount() >= DECK_SIZE
          ? "Deck is full (60 cards)"
          : isPokemon(def) && def.isGoldStar && goldStarCount() >= 1
            ? "Only 1 Pokémon ★ per deck"
            : `Max ${MAX_COPIES} copies of ${def.name}`
      );
      return;
    }
    working[def.id] = (working[def.id] ?? 0) + 1;
    updateAll();
  }

  function removeCard(def: CardDef): void {
    if (!working[def.id]) return;
    working[def.id]--;
    if (!working[def.id]) delete working[def.id];
    updateAll();
  }

  function bindCard(face: HTMLElement, def: CardDef): void {
    face.classList.add("editor-card");
    face.onclick = () => addCard(def);
    face.oncontextmenu = (e) => {
      e.preventDefault();
      removeCard(def);
    };
    face.addEventListener("mouseenter", () => showDetail(def));
  }

  function updateFilters(): void {
    for (const [value, button] of supertypeButtons) {
      button.classList.toggle("active", filterSupertype === value);
    }
    for (const [type, button] of typeButtons) {
      button.classList.toggle("active", filterType === type);
    }
  }

  function updateHeader(): void {
    const total = totalCount();
    const validation = validateDeck(buildDeck(working, library));
    totalChip.textContent = `${total} / ${DECK_SIZE}`;
    totalChip.classList.toggle("chip-ok", validation.valid);
    totalChip.classList.toggle("chip-bad", !validation.valid && total > 0);
    if (total === 0) {
      validationEl.textContent = "";
    } else if (validation.valid) {
      validationEl.textContent = "✓ Deck is battle-ready";
      validationEl.className = "editor-validation validation-ok";
    } else {
      validationEl.textContent = validation.problems.join(" · ");
      validationEl.className = "editor-validation validation-bad";
    }
    deleteButton.style.display = nameInput.value.trim() in loadCustomDecks() ? "" : "none";
  }

  function deckEntry(def: CardDef, count: number): HTMLElement {
    const entry = el("div", "deck-entry");
    const face = cardFace(def, "md");
    bindCard(face, def);
    entry.appendChild(face);
    entry.appendChild(el("span", "count-badge", `×${count}`));
    const controls = el("div", "entry-controls");
    const minus = el("button", "entry-btn", "−");
    minus.onclick = () => removeCard(def);
    controls.appendChild(minus);
    const plus = el("button", "entry-btn", "+");
    plus.disabled = !canAdd(def);
    plus.onclick = () => addCard(def);
    controls.appendChild(plus);
    entry.appendChild(controls);
    return entry;
  }

  function updateDeck(): void {
    deckColumn.replaceChildren();
    const groups: Record<Supertype, Array<{ def: CardDef; count: number }>> = {
      Pokemon: [],
      Trainer: [],
      Energy: [],
    };
    for (const [id, count] of Object.entries(working)) {
      const def = library[id];
      if (def && count > 0) groups[def.supertype].push({ def, count });
    }
    if (totalCount() === 0) {
      const empty = el("div", "deck-empty");
      empty.appendChild(el("div", "deck-empty-title", "Empty deck"));
      empty.appendChild(el("div", "deck-empty-hint", "Click cards in the library on the right to add them. A deck needs exactly 60 cards, max 4 copies per card (basic Energy unlimited), max 1 Pokémon ★."));
      deckColumn.appendChild(empty);
      return;
    }
    for (const supertype of SECTIONS) {
      const entries = groups[supertype];
      if (entries.length === 0) continue;
      entries.sort((a, b) => sortKey(a.def, byName).localeCompare(sortKey(b.def, byName)));
      const sum = entries.reduce((acc, e) => acc + e.count, 0);
      deckColumn.appendChild(el("div", "deck-section-title", `${SECTION_LABELS[supertype]} · ${sum}`));
      const grid = el("div", "card-grid");
      for (const { def, count } of entries) grid.appendChild(deckEntry(def, count));
      deckColumn.appendChild(grid);
    }
  }

  function updateLibrary(): void {
    const query = searchInput.value.trim().toLowerCase();
    libraryGrid.replaceChildren();
    let shown = 0;
    for (const def of catalog) {
      if (filterSupertype && def.supertype !== filterSupertype) continue;
      if (filterType && !matchesType(def, filterType)) continue;
      if (query && !def.name.toLowerCase().includes(query)) continue;
      const entry = el("div", "lib-entry");
      const face = cardFace(def, "md");
      bindCard(face, def);
      entry.appendChild(face);
      const count = working[def.id] ?? 0;
      if (count > 0) entry.appendChild(el("span", "count-badge badge-indeck", `×${count}`));
      if (!canAdd(def)) entry.classList.add("at-limit");
      libraryGrid.appendChild(entry);
      shown++;
    }
    if (shown === 0) libraryGrid.appendChild(el("div", "detail-hint", "No cards match."));
  }

  function updateAll(): void {
    updateHeader();
    updateDeck();
    updateLibrary();
  }

  function refreshLoadSelect(selected: string): void {
    loadSelect.innerHTML = "";
    const fresh = el("option", "", "✚ New deck");
    fresh.value = "";
    loadSelect.appendChild(fresh);
    const customs = loadCustomDecks();
    const customNames = Object.keys(customs).sort();
    if (customNames.length > 0) {
      const group = document.createElement("optgroup");
      group.label = "My decks";
      for (const name of customNames) {
        const option = el("option", "", name);
        option.value = name;
        group.appendChild(option);
      }
      loadSelect.appendChild(group);
    }
    const builtinGroup = document.createElement("optgroup");
    builtinGroup.label = "Starter decks";
    for (const name of Object.keys(builtinDecks)) {
      if (name in customs) continue;
      const option = el("option", "", name);
      option.value = name;
      builtinGroup.appendChild(option);
    }
    loadSelect.appendChild(builtinGroup);
    loadSelect.value = selected;
    currentSelection = selected;
  }

  loadSelect.onchange = () => {
    const name = loadSelect.value;
    if (dirty() && !confirm("Discard unsaved changes?")) {
      loadSelect.value = currentSelection;
      return;
    }
    currentSelection = name;
    const customs = loadCustomDecks();
    working = { ...(customs[name] ?? builtinDecks[name] ?? {}) };
    nameInput.value = name;
    savedJson = JSON.stringify(working);
    updateAll();
  };

  nameInput.oninput = updateHeader;

  searchInput.oninput = updateLibrary;
  searchInput.onkeydown = (e) => {
    if (e.key === "Escape") {
      searchInput.value = "";
      updateLibrary();
    }
  };

  saveButton.onclick = () => {
    const name = nameInput.value.trim();
    if (!name) {
      flash("Name your deck first");
      nameInput.focus();
      return;
    }
    const customs = loadCustomDecks();
    customs[name] = { ...working };
    persistCustomDecks(customs);
    savedJson = JSON.stringify(working);
    refreshLoadSelect(name);
    updateHeader();
    flash(`Saved "${name}" ✓`);
  };

  deleteButton.onclick = () => {
    const name = nameInput.value.trim();
    const customs = loadCustomDecks();
    if (!(name in customs)) return;
    if (!confirm(`Delete deck "${name}"?`)) return;
    delete customs[name];
    persistCustomDecks(customs);
    refreshLoadSelect("");
    working = {};
    savedJson = JSON.stringify(working);
    nameInput.value = "";
    updateAll();
    flash(`Deleted "${name}"`);
  };

  backButton.onclick = () => {
    if (dirty() && !confirm("Discard unsaved changes?")) return;
    onExit();
  };

  refreshLoadSelect("");
  updateFilters();
  updateAll();
}
