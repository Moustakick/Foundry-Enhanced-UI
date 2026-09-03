const MODULE_ID = "better-suite";
const DIE_TYPES = [4, 6, 8, 10, 12, 20];

let trayEl = null;
let rowEl = null;
let bubbleEl = null;
let hintEl = null;
let pool = {};

/* -------------------------------------------- */
/*  État                                         */
/* -------------------------------------------- */

function resetPool() {
  pool = {};
  DIE_TYPES.forEach(d => (pool[d] = 0));
}

function totalDiceCount() {
  return Object.values(pool).reduce((sum, n) => sum + n, 0);
}

function isOpen() {
  return trayEl.classList.contains("bdt-open");
}

/* -------------------------------------------- */
/*  Rendu                                        */
/* -------------------------------------------- */

/** Met à jour l'icône/l'état du bouton central, le texte d'indice et les badges des dés */
function render() {
  const icon = bubbleEl.querySelector("i");
  const open = isOpen();

  bubbleEl.classList.remove("bdt-cancel", "bdt-send");

  if (!open) {
    icon.className = "fas fa-dice";
    bubbleEl.title = game.i18n.localize("BDT.OpenTray");
  } else {
    const count = totalDiceCount();
    if (count > 0) {
      icon.className = "fas fa-arrow-up";
      bubbleEl.classList.add("bdt-send");
      bubbleEl.title = game.i18n.localize("BDT.RollTitle");
      hintEl.textContent = game.i18n.localize("BDT.CancelHint");
      hintEl.classList.add("bdt-hint-cancel");
    } else {
      icon.className = "fas fa-times";
      bubbleEl.classList.add("bdt-cancel");
      bubbleEl.title = game.i18n.localize("BDT.CloseTray");
      hintEl.textContent = game.i18n.localize("BDT.RollHint");
      hintEl.classList.remove("bdt-hint-cancel");
    }
  }

  DIE_TYPES.forEach(d => {
    const btn = rowEl.querySelector(`[data-die="${d}"]`);
    const badge = btn.querySelector(".bdt-badge");
    const n = pool[d] ?? 0;
    badge.textContent = n;
    badge.hidden = n === 0;
    btn.classList.toggle("bdt-active", n > 0);
  });
}

/* -------------------------------------------- */
/*  Actions                                      */
/* -------------------------------------------- */

function openTray() {
  trayEl.classList.add("bdt-open");
  render();
}

function closeTray() {
  trayEl.classList.remove("bdt-open");
  resetPool();
  render();
}

function onBubbleClick() {
  if (!isOpen()) {
    openTray();
    return;
  }
  if (totalDiceCount() > 0) {
    rollPool();
  } else {
    closeTray();
  }
}

function onDieClick(ev) {
  const die = ev.currentTarget.dataset.die;
  pool[die] = (pool[die] ?? 0) + 1;
  render();
}

function onDieRightClick(ev) {
  ev.preventDefault();
  const die = ev.currentTarget.dataset.die;
  pool[die] = Math.max(0, (pool[die] ?? 0) - 1);
  render();
}

/** Construit la formule à partir du pool courant et l'envoie au chat */
async function rollPool() {
  const parts = DIE_TYPES.filter(d => pool[d] > 0).map(d => `${pool[d]}d${d}`);
  if (!parts.length) return;
  const formula = parts.join(" + ");

  // On réinitialise visuellement tout de suite : le lancer se termine en tâche de fond.
  closeTray();

  try {
    const roll = new Roll(formula);
    await roll.toMessage({ speaker: ChatMessage.getSpeaker() });
  } catch (err) {
    console.error("Better Dice Tray | Échec du lancer", err);
    ui.notifications.error(game.i18n.localize("BDT.RollError"));
  }
}

/* -------------------------------------------- */
/*  Construction du DOM                          */
/* -------------------------------------------- */

/** Bouton dans la rangée commune : affiche/masque toute la tablette (bulle + rangée
    de dés), ouverte par défaut à chaque session — état non persisté, comme les
    boutons équivalents des autres modules de la suite. */
function createTrayVisibilityToggle() {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "bdt-visibility-toggle";
  btn.title = game.i18n.localize("BDT.ToggleTray");
  btn.innerHTML = '<i class="fas fa-dice"></i>';
  btn.classList.add("active"); // ouverte par défaut

  btn.addEventListener("click", () => {
    if (!trayEl) return;
    const hidden = trayEl.classList.toggle("bdt-tray-hidden");
    btn.classList.toggle("active", !hidden);
  });

  if (window.BetterSuite?.registerButton) window.BetterSuite.registerButton(btn);
  else document.body.appendChild(btn); // repli si le cœur du suite n'a pas chargé
}

function buildTray() {
  if (document.getElementById("bdt-tray")) return;

  resetPool();

  trayEl = document.createElement("div");
  trayEl.id = "bdt-tray";
  trayEl.className = "bdt-tray";

  rowEl = document.createElement("div");
  rowEl.className = "bdt-row";

  DIE_TYPES.forEach(d => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bdt-die";
    btn.dataset.die = d;
    btn.title = `d${d}`;
    btn.innerHTML = `<i class="fas fa-dice-d${d}"></i><span class="bdt-badge" hidden>0</span>`;
    btn.addEventListener("click", onDieClick);
    btn.addEventListener("contextmenu", onDieRightClick);
    rowEl.appendChild(btn);
  });

  bubbleEl = document.createElement("button");
  bubbleEl.type = "button";
  bubbleEl.id = "bdt-bubble";
  bubbleEl.className = "bdt-bubble";
  bubbleEl.innerHTML = '<i class="fas fa-dice"></i>';
  bubbleEl.addEventListener("click", onBubbleClick);

  hintEl = document.createElement("div");
  hintEl.className = "bdt-hint";
  // Pré-rempli dès la construction (reste invisible via opacity:0 tant que c'est fermé) :
  // évite que la hauteur de cet élément passe de 0 à sa valeur réelle au tout premier
  // clic d'ouverture, ce qui décalait visuellement toute la tablette vers le haut
  // (celle-ci est ancrée par le bas).
  hintEl.textContent = game.i18n.localize("BDT.RollHint");

  trayEl.appendChild(rowEl);
  trayEl.appendChild(bubbleEl);
  trayEl.appendChild(hintEl);
  document.body.appendChild(trayEl);

  render();
}

/* -------------------------------------------- */
/*  Réglages                                     */
/* -------------------------------------------- */

Hooks.once("init", () => {
  if (!game.settings.get(MODULE_ID, "enableDiceTray")) return;

  game.settings.register(MODULE_ID, "dice_verticalOffset", {
    name: "BDT.Settings.VerticalOffset.Name",
    hint: "BDT.Settings.VerticalOffset.Hint",
    scope: "client",
    config: true,
    type: Number,
    range: { min: 20, max: 200, step: 5 },
    default: 46,
    onChange: value => applyVerticalOffset(value)
  });
});

function applyVerticalOffset(value) {
  document.documentElement.style.setProperty("--bdt-bottom-offset", `${value}px`);
}

/* -------------------------------------------- */
/*  Cycle de vie                                 */
/* -------------------------------------------- */

Hooks.once("ready", () => {
  if (!game.settings.get(MODULE_ID, "enableDiceTray")) return;

  applyVerticalOffset(game.settings.get(MODULE_ID, "dice_verticalOffset"));
  buildTray();
  createTrayVisibilityToggle();

  // Se positionne juste à droite de la barre d'actions de combat pendant qu'elle est
  // ouverte (plutôt qu'un décalage fixe vers le bord de l'écran, qui atterrissait sur
  // la sidebar) : on mesure la position réelle du panneau de Better Combat UI, qui
  // varie selon son contenu et son échelle. Reprend sa place centrée par défaut dès
  // que la barre se referme. Repli silencieux si Better Combat UI est désactivé ou
  // n'a pas chargé (onCombatBarChange n'existe alors simplement pas).
  const repositionNextToCombatBar = () => {
    const panel = document.getElementById("bcu-panel");
    if (!trayEl || !panel) return;
    const rect = panel.getBoundingClientRect();
    trayEl.style.left = `${rect.right + 12}px`;
    trayEl.style.transform = "none";
  };

  const resetToCenter = () => {
    if (!trayEl) return;
    trayEl.style.left = "";
    trayEl.style.transform = "";
  };

  window.BetterSuite?.onCombatBarChange?.(open => {
    if (open) {
      repositionNextToCombatBar();
      window.addEventListener("resize", repositionNextToCombatBar);
    } else {
      window.removeEventListener("resize", repositionNextToCombatBar);
      resetToCenter();
    }
  });
});

// Ferme la tablette (et vide la sélection en cours) avec Échap
document.addEventListener("keydown", ev => {
  if (ev.key !== "Escape") return;
  if (!trayEl || !isOpen()) return;
  closeTray();
});
