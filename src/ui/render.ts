import type { Action, EventCat, Game, GameEvent, PokemonInPlay } from "../engine/game";
import { isEnergy, isPokemon, isTrainer } from "../model/types";
import type { AttackDef, CardDef, EnergyType, TrainerKind } from "../model/types";

const HUMAN = 0;
const AI = 1;

const CAT_ICON: Record<EventCat, string> = {
  turn: "🎬",
  attack: "⚔️",
  power: "🌀",
  damage: "💥",
  ko: "☠️",
  status: "☣️",
  heal: "✨",
  energy: "🔋",
  evolve: "⬆️",
  draw: "🃏",
  prize: "🏆",
  coin: "🪙",
  switch: "🔄",
  trainer: "🎴",
  bench: "🪑",
  win: "👑",
  info: "•",
};

const CAT_PRIORITY: Record<EventCat, number> = {
  win: 100,
  ko: 90,
  turn: 80,
  attack: 70,
  power: 64,
  status: 58,
  evolve: 52,
  prize: 50,
  trainer: 44,
  energy: 40,
  switch: 36,
  heal: 30,
  damage: 24,
  bench: 20,
  draw: 14,
  coin: 8,
  info: 4,
};

let lastEventSeq = 0;
let currentBeats: GameEvent[] = [];
let headline: GameEvent | null = null;
let justPlayed = false;
let stepHandler: () => void = () => {};

export function setStepHandler(fn: () => void): void {
  stepHandler = fn;
}

function headlineText(event: GameEvent): string {
  if (event.cat === "turn") {
    const match = event.text.match(/Turn (\d+): (.+?) —/);
    if (match) return `Turn ${match[1]} · ${match[2]}`;
  }
  return event.text;
}

function pickHeadline(beats: GameEvent[]): GameEvent | null {
  let best: GameEvent | null = null;
  let bestScore = -1;
  for (const beat of beats) {
    const score = CAT_PRIORITY[beat.cat];
    if (score >= bestScore) {
      bestScore = score;
      best = beat;
    }
  }
  return best;
}

function consumeEvents(game: Game): void {
  const fresh = game.events.filter((e) => e.seq > lastEventSeq);
  justPlayed = fresh.length > 0;
  if (fresh.length > 0) {
    lastEventSeq = game.events[game.events.length - 1].seq;
    currentBeats = fresh.slice(-8);
    headline = pickHeadline(fresh) ?? headline;
  }
}

export function resetEventFeed(): void {
  lastEventSeq = 0;
  currentBeats = [];
  headline = null;
  justPlayed = false;
}

const TYPE_COLORS: Record<EnergyType, string> = {
  Grass: "#3fa14f",
  Fire: "#e8552e",
  Water: "#2f8fd4",
  Lightning: "#e8b820",
  Psychic: "#9757b8",
  Fighting: "#b0603c",
  Darkness: "#3d4453",
  Metal: "#8d97a5",
  Colorless: "#c8c0b4",
};

const TYPE_EMBLEMS: Record<EnergyType, string> = {
  Grass: "🍃",
  Fire: "🔥",
  Water: "💧",
  Lightning: "⚡",
  Psychic: "👁️",
  Fighting: "👊",
  Darkness: "🌑",
  Metal: "⚙️",
  Colorless: "⭐",
};

const TRAINER_EMBLEMS: Record<TrainerKind, string> = {
  Item: "🎒",
  Supporter: "🧭",
  Stadium: "🏟️",
  Tool: "🔧",
};

const ENERGY_SPRITE_COLUMN: Record<EnergyType, number> = {
  Grass: 0,
  Fire: 1,
  Water: 2,
  Colorless: 3,
  Lightning: 4,
  Fighting: 5,
  Psychic: 6,
  Metal: 7,
  Darkness: 9,
};

function energyIcon(type: EnergyType, sizeClass: string): HTMLElement {
  const icon = el("span", `energy-icon ${sizeClass}`);
  icon.style.setProperty("--col", String(ENERGY_SPRITE_COLUMN[type]));
  icon.title = type;
  return icon;
}

export interface UIState {
  selectedHandUid: number | null;
  speedFast: boolean;
  paused: boolean;
}

export const uiState: UIState = { selectedHandUid: null, speedFast: false, paused: false };

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function costDots(cost: EnergyType[]): HTMLElement {
  const row = el("span", "cost-dots");
  for (const symbol of cost) {
    row.appendChild(energyIcon(symbol, "icon-cost"));
  }
  return row;
}

function attackRow(attack: AttackDef): HTMLElement {
  const row = el("div", "attack-row");
  row.appendChild(costDots(attack.cost));
  row.appendChild(el("span", "attack-name", attack.name));
  if (attack.damage) row.appendChild(el("span", "attack-dmg", String(attack.damage)));
  else if (attack.effects?.some((e) => e.op === "damagePerHeads" || e.op === "damageScaled")) {
    row.appendChild(el("span", "attack-dmg", "×"));
  }
  return row;
}

function cardFace(def: CardDef, size: "xl" | "lg" | "md" | "hand"): HTMLElement {
  const card = el("div", `tcg-card card-${size}`);
  if (def.image) {
    card.classList.add("card-img");
    card.style.backgroundImage = `url(${def.image})`;
    card.title = def.name;
    if (isPokemon(def) && def.isEx) card.classList.add("tile-ex");
    return card;
  }

  let color = TYPE_COLORS.Colorless;
  let emblem = "⭐";
  if (isPokemon(def)) {
    color = TYPE_COLORS[def.types[0] ?? "Colorless"];
    emblem = TYPE_EMBLEMS[def.types[0] ?? "Colorless"];
    if (def.isEx) card.classList.add("tile-ex");
  } else if (isEnergy(def)) {
    color = TYPE_COLORS[def.provides.length === 1 ? def.provides[0] : "Colorless"];
    emblem = def.provides.length === 1 ? TYPE_EMBLEMS[def.provides[0]] : "🌈";
  } else if (isTrainer(def)) {
    color = "#4a6d8c";
    emblem = TRAINER_EMBLEMS[def.kind];
  }
  card.style.setProperty("--type-color", color);

  const top = el("div", "tcg-top");
  top.appendChild(el("span", "tcg-name", def.name));
  if (isPokemon(def)) {
    const typeWrap = el("span", "type-icons");
    for (const type of def.types.length ? def.types : (["Colorless"] as EnergyType[])) {
      typeWrap.appendChild(energyIcon(type, "icon-type"));
    }
    top.appendChild(typeWrap);
    const pill = el("span", "hp-pill");
    pill.appendChild(el("span", "hp-label", "HP"));
    pill.appendChild(el("span", "hp-value", String(def.hp)));
    top.appendChild(pill);
  } else if (isTrainer(def)) {
    top.appendChild(el("span", "kind-chip", def.kind));
  }
  card.appendChild(top);

  const art = el("div", "tcg-art");
  if (isEnergy(def) && def.provides.length === 1) {
    art.appendChild(energyIcon(def.provides[0], "icon-art"));
  } else {
    art.appendChild(el("span", "art-emblem", emblem));
  }
  if (isPokemon(def)) {
    art.appendChild(el("span", "stage-chip", def.stage === "Basic" ? "BASIC" : def.stage.replace("Stage", "STAGE ")));
    if (def.isDelta) art.appendChild(el("span", "delta-chip", "δ"));
    if (def.isEx) art.appendChild(el("span", "ex-chip", "ex"));
  }
  card.appendChild(art);

  const body = el("div", "tcg-body");
  if (isPokemon(def)) {
    if (def.power) body.appendChild(el("div", "power-row", `${def.power.kind === "Poke-Power" ? "◆" : "●"} ${def.power.name}`));
    for (const attack of def.attacks.slice(0, def.power ? 1 : 2)) body.appendChild(attackRow(attack));
  } else if (isTrainer(def)) {
    body.appendChild(el("div", "tcg-text", def.text));
  } else if (isEnergy(def)) {
    body.appendChild(el("div", "tcg-text tcg-text-center", def.name));
  }
  card.appendChild(body);
  return card;
}

function pokemonTile(game: Game, ownerIndex: number, pokemon: PokemonInPlay, size: "lg" | "md"): HTMLElement {
  const tile = cardFace(pokemon.def, size);
  tile.classList.add("in-play");

  const hpLeft = Math.max(0, pokemon.def.hp - pokemon.damage);
  const pill = tile.querySelector(".hp-value");
  if (pill) {
    pill.textContent = String(hpLeft);
    const ratio = hpLeft / pokemon.def.hp;
    (pill as HTMLElement).style.color = ratio > 0.5 ? "#1d7a35" : ratio > 0.25 ? "#a87b00" : "#c02626";
  }
  if (pokemon.damage > 0) {
    const badge = el("div", "damage-badge", String(pokemon.damage));
    tile.appendChild(badge);
  }

  const footer = el("div", "tile-footer");
  const pips = el("div", "energy-row");
  for (const energy of pokemon.energy) {
    const def = energy.def;
    let pip: HTMLElement;
    if (isEnergy(def) && def.provides.length === 1) {
      pip = energyIcon(def.provides[0], "icon-pip");
    } else {
      pip = el("span", "energy-pip pip-rainbow");
    }
    pip.title = def.name;
    const count = isEnergy(def) ? def.provideCount ?? 1 : 1;
    if (count > 1) pip.appendChild(el("span", "pip-count", String(count)));
    if (isPokemon(def)) pip.appendChild(el("span", "pip-count pip-mon", "P"));
    pips.appendChild(pip);
  }
  footer.appendChild(pips);

  const badges = el("div", "status-row");
  const statuses: Array<[boolean, string, string]> = [
    [pokemon.condition === "asleep", "SLP", "badge-sleep"],
    [pokemon.condition === "confused", "CNF", "badge-confused"],
    [pokemon.condition === "paralyzed", "PAR", "badge-paralyzed"],
    [pokemon.poisonCounters > 0, pokemon.poisonCounters >= 2 ? "TPSN" : "PSN", "badge-poison"],
    [pokemon.burned, "BRN", "badge-burn"],
  ];
  for (const [on, label, cls] of statuses) {
    if (on) badges.appendChild(el("span", `status-badge ${cls}`, label));
  }
  if (pokemon.tool) badges.appendChild(el("span", "status-badge badge-tool", pokemon.tool.def.name.toUpperCase()));
  if (badges.childNodes.length > 0) footer.appendChild(badges);
  tile.appendChild(footer);

  tile.title = `${game.players[ownerIndex].name}'s ${pokemon.def.name}`;
  tile.dataset.uid = String(pokemon.card.uid);
  attachHover(tile, pokemon.def, pokemon.card.uid);
  return tile;
}

function cardBackEl(extraClass = ""): HTMLElement {
  return el("div", `card-back ${extraClass}`);
}

function pilePile(kind: string, count: number, label: string): HTMLElement {
  const pile = el("div", `pile pile-${kind}`);
  const stack = el("div", "pile-stack");
  if (count > 0) {
    const layers = Math.min(4, count);
    for (let i = 0; i < layers; i++) {
      const back = cardBackEl("pile-card");
      back.style.setProperty("--i", String(i));
      stack.appendChild(back);
    }
  } else {
    stack.appendChild(el("div", "pile-empty"));
  }
  stack.appendChild(el("span", "pile-num", String(count)));
  pile.appendChild(stack);
  pile.appendChild(el("span", "pile-tag", label));
  return pile;
}

function renderPrizeRail(game: Game, p: number): HTMLElement {
  const player = game.players[p];
  const count = player.prizes.length;
  const wrap = el("div", `prize-rail ${p === HUMAN ? "prize-me" : "prize-opp"}`);
  const grid = el("div", "prize-grid");
  const total = Math.max(6, count);
  for (let i = 0; i < total; i++) {
    const slot = el("div", "prize-slot");
    if (i < count) slot.appendChild(cardBackEl("prize-card"));
    grid.appendChild(slot);
  }
  wrap.appendChild(grid);
  wrap.appendChild(el("span", "pile-tag", `Prizes ${count}`));
  return wrap;
}

function renderDeckRail(game: Game, p: number): HTMLElement {
  const player = game.players[p];
  const wrap = el("div", `deck-rail ${p === HUMAN ? "deck-me" : "deck-opp"}`);
  wrap.appendChild(pilePile("deck", player.deck.length, "Deck"));
  wrap.appendChild(pilePile("discard", player.discard.length, "Discard"));
  return wrap;
}

let detailBodyEl: HTMLElement | null = null;
let hoverDef: CardDef | null = null;
let hoverUid: number | null = null;
let activeGame: Game | null = null;

function attachHover(node: HTMLElement, def: CardDef, uid: number | null): void {
  node.addEventListener("mouseenter", () => {
    hoverDef = def;
    hoverUid = uid;
    paintDetail();
  });
}

function findLive(uid: number | null): { owner: number; pokemon: PokemonInPlay } | null {
  if (uid === null || !activeGame) return null;
  for (let p = 0; p < 2; p++) {
    for (const { pokemon } of activeGame.allInPlay(p)) {
      if (pokemon.card.uid === uid) return { owner: p, pokemon };
    }
  }
  return null;
}

function statLine(label: string, value: string, icon?: HTMLElement): HTMLElement {
  const row = el("div", "detail-stat");
  row.appendChild(el("span", "detail-stat-label", label));
  const val = el("span", "detail-stat-value");
  if (icon) val.appendChild(icon);
  if (value) val.appendChild(document.createTextNode(value));
  row.appendChild(val);
  return row;
}

function detailAttack(attack: AttackDef): HTMLElement {
  const block = el("div", "detail-attack");
  const head = el("div", "detail-attack-head");
  head.appendChild(costDots(attack.cost.length ? attack.cost : ["Colorless"]));
  head.appendChild(el("span", "detail-attack-name", attack.name));
  if (attack.damage) head.appendChild(el("span", "detail-attack-dmg", String(attack.damage)));
  block.appendChild(head);
  if (attack.text) block.appendChild(el("div", "detail-attack-text", attack.text));
  return block;
}

function buildDetail(def: CardDef): HTMLElement {
  const wrap = el("div", "detail-content");
  const live = findLive(hoverUid);
  wrap.appendChild(cardFace(def, "xl"));

  const info = el("div", "detail-info");
  info.appendChild(el("div", "detail-name", def.name));

  if (isPokemon(def)) {
    const meta = el("div", "detail-meta");
    for (const type of def.types.length ? def.types : (["Colorless"] as EnergyType[])) {
      meta.appendChild(energyIcon(type, "icon-inline"));
    }
    meta.appendChild(el("span", "detail-tag", def.stage === "Basic" ? "Basic" : def.stage.replace("Stage", "Stage ")));
    if (def.isDelta) meta.appendChild(el("span", "detail-tag detail-tag-delta", "δ Delta Species"));
    if (def.evolvesFrom) meta.appendChild(el("span", "detail-tag", `from ${def.evolvesFrom}`));
    if (def.isEx) meta.appendChild(el("span", "detail-tag detail-tag-ex", "Pokémon-ex"));
    if (def.playableAsEnergy) meta.appendChild(el("span", "detail-tag detail-tag-delta", "Plays as Energy"));
    info.appendChild(meta);

    const hp = live ? `${Math.max(0, def.hp - live.pokemon.damage)} / ${def.hp}` : String(def.hp);
    info.appendChild(statLine("HP", hp));
    info.appendChild(statLine("Weakness", "", def.weakness ? energyIcon(def.weakness, "icon-inline") : undefined));
    if (!def.weakness) info.lastElementChild!.querySelector(".detail-stat-value")!.textContent = "—";
    info.appendChild(statLine("Resistance", "", def.resistance ? energyIcon(def.resistance, "icon-inline") : undefined));
    if (!def.resistance) info.lastElementChild!.querySelector(".detail-stat-value")!.textContent = "—";
    const retreat = el("span", "detail-stat-value");
    for (let i = 0; i < def.retreatCost; i++) retreat.appendChild(energyIcon("Colorless", "icon-inline"));
    if (def.retreatCost === 0) retreat.textContent = "Free";
    const retreatRow = el("div", "detail-stat");
    retreatRow.appendChild(el("span", "detail-stat-label", "Retreat"));
    retreatRow.appendChild(retreat);
    info.appendChild(retreatRow);

    if (def.power) {
      const power = el("div", "detail-power");
      power.appendChild(el("div", "detail-power-name", `${def.power.kind}: ${def.power.name}`));
      power.appendChild(el("div", "detail-attack-text", def.power.text));
      info.appendChild(power);
    }
    for (const attack of def.attacks) info.appendChild(detailAttack(attack));

    if (live) {
      const state = el("div", "detail-state");
      const energyNames = live.pokemon.energy.map((e) => e.def.name);
      state.appendChild(el("div", "detail-state-title", "In play"));
      state.appendChild(el("div", "detail-state-line", `Energy: ${energyNames.length ? energyNames.join(", ") : "none"}`));
      const conditions: string[] = [];
      if (live.pokemon.condition) conditions.push(live.pokemon.condition);
      if (live.pokemon.poisonCounters >= 2) conditions.push("badly poisoned");
      else if (live.pokemon.poisonCounters === 1) conditions.push("poisoned");
      if (live.pokemon.burned) conditions.push("burned");
      if (conditions.length) state.appendChild(el("div", "detail-state-line", `Status: ${conditions.join(", ")}`));
      if (live.pokemon.tool) state.appendChild(el("div", "detail-state-line", `Tool: ${live.pokemon.tool.def.name}`));
      info.appendChild(state);
    }
  } else if (isTrainer(def)) {
    const meta = el("div", "detail-meta");
    meta.appendChild(el("span", "detail-tag", def.kind));
    info.appendChild(meta);
    info.appendChild(el("div", "detail-attack-text", def.text));
    if (def.restriction?.maxHandSize !== undefined) {
      info.appendChild(el("div", "detail-restriction", `Unplayable if your hand has more than ${def.restriction.maxHandSize} cards.`));
    }
    if (def.restriction?.behindOnPrizes) {
      info.appendChild(el("div", "detail-restriction", "Playable only while you have more Prize cards left than your opponent."));
    }
  } else if (isEnergy(def)) {
    const meta = el("div", "detail-meta");
    meta.appendChild(el("span", "detail-tag", def.isBasic ? "Basic Energy" : "Special Energy"));
    info.appendChild(meta);
    const provides = el("span", "detail-stat-value");
    for (const type of def.provides) provides.appendChild(energyIcon(type, "icon-inline"));
    const provRow = el("div", "detail-stat");
    provRow.appendChild(el("span", "detail-stat-label", "Provides"));
    provRow.appendChild(provides);
    info.appendChild(provRow);
    if (def.provides.length > 1) info.lastElementChild!.querySelector(".detail-stat-label")!.textContent = "Provides (any one)";
    if ((def.provideCount ?? 1) > 1) info.appendChild(statLine("Counts as", `${def.provideCount} Energy`));
    if (def.damageRider) info.appendChild(statLine("Damage", `${def.damageRider > 0 ? "+" : ""}${def.damageRider} dealt`));
    if (def.deltaOnly) info.appendChild(el("div", "detail-restriction", "Provides Energy only while attached to a Delta Species (δ) Pokémon."));
    if (def.scramble) info.appendChild(el("div", "detail-restriction", "Full effect only while behind on Prizes; otherwise 1 Colorless."));
    for (const mod of def.modifiers ?? []) {
      if (mod.kind === "preventConditions") info.appendChild(el("div", "detail-restriction", "The Pokémon this is attached to can't be affected by Special Conditions."));
      if (mod.kind === "damageMinus") info.appendChild(el("div", "detail-restriction", `Reduces damage taken by ${mod.amount}.`));
      if (mod.kind === "damagePlus") info.appendChild(el("div", "detail-restriction", `Attacks do ${mod.amount} more damage.`));
    }
  }

  wrap.appendChild(info);
  return wrap;
}

function paintDetail(): void {
  if (!detailBodyEl) return;
  if (!hoverDef && activeGame) {
    const active = activeGame.players[HUMAN].active ?? activeGame.players[AI].active;
    if (active) {
      hoverDef = active.def;
      hoverUid = active.card.uid;
    }
  }
  if (hoverDef) detailBodyEl.replaceChildren(buildDetail(hoverDef));
  else detailBodyEl.replaceChildren(el("div", "detail-hint", "Hover a card to inspect it."));
}

function renderDetailPanel(): HTMLElement {
  const panel = el("div", "detail-panel");
  panel.appendChild(el("div", "panel-title", "Card Detail"));
  detailBodyEl = el("div", "detail-body");
  panel.appendChild(detailBodyEl);
  paintDetail();
  return panel;
}

export function render(
  root: HTMLElement,
  game: Game,
  onAction: (action: Action) => void,
  onChoice: (index: number) => void,
  humanControls: boolean
): void {
  root.innerHTML = "";
  activeGame = game;
  consumeEvents(game);
  const board = el("div", "board arena");
  if (!humanControls) board.classList.add("spectate");

  const legal = humanControls && game.current === HUMAN && !game.pending ? game.getLegalActions() : [];

  const field = el("div", "field");

  const railLeft = el("div", "rail rail-left");
  railLeft.appendChild(renderPrizeRail(game, AI));
  railLeft.appendChild(renderPrizeRail(game, HUMAN));

  const columnMain = el("div", "column-main");
  columnMain.appendChild(renderInfoBar(game, AI, false));
  columnMain.appendChild(renderBench(game, AI));
  columnMain.appendChild(renderMat(game));
  columnMain.appendChild(renderBench(game, HUMAN));
  columnMain.appendChild(renderInfoBar(game, HUMAN, true));

  const railRight = el("div", "rail rail-right");
  railRight.appendChild(renderDeckRail(game, AI));
  railRight.appendChild(renderDeckRail(game, HUMAN));

  field.appendChild(railLeft);
  field.appendChild(columnMain);
  field.appendChild(railRight);

  board.appendChild(field);
  board.appendChild(renderHand(game, legal, onAction));

  const layout = el("div", "layout");
  layout.appendChild(renderDetailPanel());
  layout.appendChild(board);
  layout.appendChild(renderSidebar(game, legal, onAction, humanControls));
  root.appendChild(layout);

  if (humanControls && game.pending && game.pending.player === HUMAN) {
    root.appendChild(renderChoiceModal(game, onChoice));
  }
  if (game.phase === "finished") {
    root.appendChild(renderGameOver(game));
  }

  if (justPlayed) playBoardFx(root);
}

function playBoardFx(root: HTMLElement): void {
  const findTile = (uid: number | undefined): HTMLElement | null =>
    uid === undefined ? null : root.querySelector(`.tcg-card[data-uid="${uid}"]`);
  let fxCount = 0;
  for (const beat of currentBeats) {
    const tile = findTile(beat.uid);
    if (!tile || fxCount > 6) continue;
    if (beat.cat === "damage" && (beat.amount ?? 0) > 0) {
      fxCount++;
      tile.classList.add("fx-hit");
      floatNumber(tile, `-${beat.amount}`, "float-dmg");
    } else if (beat.cat === "damage") {
      tile.classList.add("fx-block");
    } else if (beat.cat === "heal") {
      fxCount++;
      tile.classList.add("fx-heal");
      floatNumber(tile, `+${beat.amount}`, "float-heal");
    } else if (beat.cat === "attack" || beat.cat === "power") {
      tile.classList.add("fx-act");
    } else if (beat.cat === "energy" || beat.cat === "evolve") {
      tile.classList.add("fx-glow");
    } else if (beat.cat === "status") {
      tile.classList.add("fx-status");
    } else if (beat.cat === "switch") {
      tile.classList.add("fx-glow");
    }
  }
}

function floatNumber(tile: HTMLElement, text: string, cls: string): void {
  const rect = tile.getBoundingClientRect();
  const node = el("span", `float-num ${cls}`, text);
  node.style.left = `${rect.left + rect.width / 2}px`;
  node.style.top = `${rect.top + rect.height * 0.32}px`;
  document.body.appendChild(node);
  window.setTimeout(() => node.remove(), 1000);
}

function renderInfoBar(game: Game, p: number, isHuman: boolean): HTMLElement {
  const player = game.players[p];
  const bar = el("div", `info-bar ${isHuman ? "bar-blue" : "bar-red"}`);
  bar.appendChild(el("span", "player-name", player.name));
  const hand = el("div", "hand-chip");
  hand.appendChild(el("span", "hand-chip-count", String(player.hand.length)));
  hand.appendChild(el("span", "hand-chip-label", "Hand"));
  bar.appendChild(hand);
  return bar;
}

function renderBench(game: Game, p: number): HTMLElement {
  const row = el("div", "bench-row");
  for (const pokemon of game.players[p].bench) {
    row.appendChild(pokemonTile(game, p, pokemon, "md"));
  }
  return row;
}

function renderMat(game: Game): HTMLElement {
  const mat = el("div", "mat");

  const oppSlot = el("div", "mat-slot");
  if (game.players[AI].active) oppSlot.appendChild(pokemonTile(game, AI, game.players[AI].active!, "lg"));
  else oppSlot.appendChild(el("div", "empty-slot", "—"));

  const center = el("div", "mat-center");
  center.appendChild(el("div", "turn-banner", game.phase === "finished" ? "Game Over" : `Turn ${game.turnNumber}`));
  center.appendChild(el("div", "turn-owner", game.phase === "finished" ? "" : game.players[game.current].name));
  if (game.stadium) {
    const stadiumChip = el("div", "stadium-chip");
    stadiumChip.appendChild(el("span", "stadium-emblem", "🏟️"));
    stadiumChip.appendChild(el("span", "stadium-name", game.stadium.card.def.name));
    stadiumChip.title = isTrainer(game.stadium.card.def) ? game.stadium.card.def.text : "";
    center.appendChild(stadiumChip);
  }

  const mySlot = el("div", "mat-slot");
  if (game.players[HUMAN].active) mySlot.appendChild(pokemonTile(game, HUMAN, game.players[HUMAN].active!, "lg"));
  else mySlot.appendChild(el("div", "empty-slot", "—"));

  mat.appendChild(oppSlot);
  mat.appendChild(center);
  mat.appendChild(mySlot);
  if (headline && game.phase !== "finished") mat.appendChild(renderAnnouncer());
  return mat;
}

function renderAnnouncer(): HTMLElement {
  const chip = el("div", `announcer cat-${headline!.cat}`);
  if (justPlayed) chip.classList.add("announcer-pop");
  chip.appendChild(el("span", "announcer-icon", CAT_ICON[headline!.cat]));
  chip.appendChild(el("span", "announcer-text", headlineText(headline!)));
  return chip;
}

function renderHand(game: Game, legal: Action[], onAction: (action: Action) => void): HTMLElement {
  const wrap = el("div", "hand-wrap");
  const hand = el("div", "hand-fan");
  const player = game.players[HUMAN];
  const cards: HTMLElement[] = [];

  for (const card of player.hand) {
    const cardActions = legal.filter((a) => "handUid" in a && a.handUid === card.uid);
    const tile = cardFace(card.def, "hand");
    if (cardActions.length > 0) {
      tile.classList.add("clickable");
      tile.onclick = () => {
        uiState.selectedHandUid = uiState.selectedHandUid === card.uid ? null : card.uid;
        rerender();
      };
    }
    if (uiState.selectedHandUid === card.uid) tile.classList.add("selected");
    attachHover(tile, card.def, card.uid);
    cards.push(tile);
    hand.appendChild(tile);
  }

  const count = cards.length;
  cards.forEach((tile, i) => {
    const offset = i - (count - 1) / 2;
    tile.style.setProperty("--rot", `${offset * 3}deg`);
    tile.style.setProperty("--lift", `${Math.abs(offset) * 7}px`);
  });
  wrap.appendChild(hand);

  if (uiState.selectedHandUid !== null) {
    const cardActions = legal.filter((a) => "handUid" in a && a.handUid === uiState.selectedHandUid);
    if (cardActions.length > 0) {
      const menu = el("div", "hand-menu glass");
      for (const action of cardActions) {
        const button = el("button", "action-btn", game.describeAction(action));
        button.onclick = () => {
          uiState.selectedHandUid = null;
          onAction(action);
        };
        menu.appendChild(button);
      }
      const cancel = el("button", "action-btn btn-muted", "Cancel");
      cancel.onclick = () => {
        uiState.selectedHandUid = null;
        rerender();
      };
      menu.appendChild(cancel);
      wrap.appendChild(menu);
    }
  }
  return wrap;
}

function renderSidebar(game: Game, legal: Action[], onAction: (action: Action) => void, humanControls: boolean): HTMLElement {
  const sidebar = el("div", "sidebar");

  if (humanControls && game.current === HUMAN && game.phase === "playing" && !game.pending) {
    const actions = el("div", "actions-panel glass");
    actions.appendChild(el("div", "panel-title", "Actions"));
    const boardActions = legal.filter((a) => !("handUid" in a));
    for (const action of boardActions) {
      const button = el(
        "button",
        `action-btn ${action.type === "attack" ? "btn-attack" : ""} ${action.type === "pass" ? "btn-muted" : ""}`,
        game.describeAction(action)
      );
      button.onclick = () => onAction(action);
      actions.appendChild(button);
    }
    sidebar.appendChild(actions);
  } else if (game.phase === "playing") {
    sidebar.appendChild(renderNowPlaying(game, humanControls));
  }

  sidebar.appendChild(renderLog(game));
  return sidebar;
}

function renderNowPlaying(game: Game, humanControls: boolean): HTMLElement {
  const panel = el("div", "now-panel glass");
  const head = el("div", "now-head");
  const dot = el("span", `now-dot ${game.current === AI ? "dot-red" : "dot-blue"}`);
  if (!uiState.paused) dot.classList.add("dot-live");
  head.appendChild(dot);
  head.appendChild(el("span", "now-turn", `Turn ${game.turnNumber}`));
  head.appendChild(el("span", "now-actor", game.players[game.current].name));
  panel.appendChild(head);

  const feed = el("div", "beat-feed");
  const beats = currentBeats.filter((b) => b.cat !== "info" || currentBeats.length <= 3);
  const shown = (beats.length ? beats : currentBeats).slice(-6);
  if (shown.length === 0) {
    feed.appendChild(el("div", "beat-empty", uiState.paused ? "Paused" : "Waiting for the next move..."));
  }
  shown.forEach((beat, i) => {
    const row = el("div", `beat-row cat-${beat.cat}`);
    if (justPlayed && i === shown.length - 1) row.classList.add("beat-new");
    row.appendChild(el("span", "beat-icon", CAT_ICON[beat.cat]));
    row.appendChild(el("span", "beat-text", beat.text.replace(/^— |— $/g, "")));
    feed.appendChild(row);
  });
  panel.appendChild(feed);

  if (!humanControls) {
    const controls = el("div", "spectate-controls");
    const pauseBtn = el("button", "ctrl-btn", uiState.paused ? "▶ Play" : "⏸ Pause");
    pauseBtn.onclick = () => {
      uiState.paused = !uiState.paused;
      rerender();
    };
    controls.appendChild(pauseBtn);
    const stepBtn = el("button", `ctrl-btn ${uiState.paused ? "" : "ctrl-off"}`, "⏭ Step");
    stepBtn.onclick = () => {
      if (uiState.paused) stepHandler();
    };
    controls.appendChild(stepBtn);
    const speedBtn = el("button", "ctrl-btn", uiState.speedFast ? "⏩ Quick" : "🐢 Relaxed");
    speedBtn.onclick = () => {
      uiState.speedFast = !uiState.speedFast;
      rerender();
    };
    controls.appendChild(speedBtn);
    panel.appendChild(controls);
  } else if (game.pending) {
    panel.appendChild(el("div", "waiting", "Resolving..."));
  }
  return panel;
}

function renderLog(game: Game): HTMLElement {
  const logPanel = el("div", "log-panel glass");
  logPanel.appendChild(el("div", "panel-title", "Battle Log"));
  const logBox = el("div", "log-box");

  const recent = game.events.slice(-80);
  let group: HTMLElement | null = null;
  for (const event of recent) {
    if (event.cat === "turn" && event.text.startsWith("—")) {
      group = el("div", "log-group");
      group.appendChild(el("div", "log-turn", headlineText(event)));
      logBox.appendChild(group);
      continue;
    }
    if (!group) {
      group = el("div", "log-group");
      logBox.appendChild(group);
    }
    const entry = el("div", `log-line cat-${event.cat}`);
    entry.appendChild(el("span", "log-icon", CAT_ICON[event.cat]));
    entry.appendChild(el("span", "log-msg", event.text));
    group.appendChild(entry);
  }
  logPanel.appendChild(logBox);

  requestAnimationFrame(() => {
    logBox.scrollTop = logBox.scrollHeight;
  });
  return logPanel;
}

function renderChoiceModal(game: Game, onChoice: (index: number) => void): HTMLElement {
  const overlay = el("div", "overlay");
  const modal = el("div", "modal glass");
  modal.appendChild(el("div", "modal-title", game.pending!.prompt));
  const list = el("div", "modal-options");
  game.pending!.options.forEach((option, i) => {
    const button = el("button", "action-btn", option.label);
    button.onclick = () => onChoice(i);
    list.appendChild(button);
  });
  modal.appendChild(list);
  overlay.appendChild(modal);
  return overlay;
}

function renderGameOver(game: Game): HTMLElement {
  const overlay = el("div", "overlay");
  const modal = el("div", "modal glass modal-gameover");
  if (game.suddenDeath) {
    modal.appendChild(el("div", "gameover-title", "Sudden Death!"));
    modal.appendChild(el("div", "gameover-reason", `${game.winReason} A one-prize rematch starts in a moment...`));
  } else {
    const winnerName = game.winner !== null ? game.players[game.winner].name : "Nobody";
    modal.appendChild(el("div", "gameover-title", `${winnerName} wins!`));
    modal.appendChild(el("div", "gameover-reason", game.winReason));
    const button = el("button", "action-btn btn-attack", "Play Again");
    button.onclick = () => location.reload();
    modal.appendChild(button);
  }
  overlay.appendChild(modal);
  return overlay;
}

let rerender: () => void = () => {};

export function setRerender(fn: () => void): void {
  rerender = fn;
}
