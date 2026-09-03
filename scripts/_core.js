const MODULE_ID = "better-suite";

/* -------------------------------------------- */
/*  Réglages de thème (couleurs partagées)       */
/* -------------------------------------------- */

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "themeAccent", {
    name: "BS.Settings.ThemeAccent.Name",
    hint: "BS.Settings.ThemeAccent.Hint",
    scope: "client",
    config: true,
    type: String,
    default: "#f0d9a3",
    onChange: applyTheme
  });

  game.settings.register(MODULE_ID, "themeAccentDim", {
    name: "BS.Settings.ThemeAccentDim.Name",
    scope: "client",
    config: true,
    type: String,
    default: "#c6a86a",
    onChange: applyTheme
  });

  game.settings.register(MODULE_ID, "themeBgTop", {
    name: "BS.Settings.ThemeBgTop.Name",
    scope: "client",
    config: true,
    type: String,
    default: "#182620",
    onChange: applyTheme
  });

  game.settings.register(MODULE_ID, "themeBgBottom", {
    name: "BS.Settings.ThemeBgBottom.Name",
    scope: "client",
    config: true,
    type: String,
    default: "#0f1411",
    onChange: applyTheme
  });

  /* -------------------------------------------- */
  /*  Activer/désactiver chaque fonctionnalité     */
  /*  (nécessite un rechargement de la page)       */
  /* -------------------------------------------- */

  const FEATURES = [
    ["enablePartyList", "BS.Settings.EnablePartyList"],
    ["enableDiceTray", "BS.Settings.EnableDiceTray"],
    ["enableChat", "BS.Settings.EnableChat"],
    ["enableUi", "BS.Settings.EnableUi"],
    ["enableCombatUi", "BS.Settings.EnableCombatUi"]
  ];

  for (const [key, labelKey] of FEATURES) {
    game.settings.register(MODULE_ID, key, {
      name: `${labelKey}.Name`,
      hint: `${labelKey}.Hint`,
      scope: "client",
      config: true,
      type: Boolean,
      default: true,
      requiresReload: true
    });
  }
});

function applyTheme() {
  const root = document.documentElement.style;
  root.setProperty("--better-accent", game.settings.get(MODULE_ID, "themeAccent"));
  root.setProperty("--better-accent-dim", game.settings.get(MODULE_ID, "themeAccentDim"));
  root.setProperty("--better-bg-top", game.settings.get(MODULE_ID, "themeBgTop"));
  root.setProperty("--better-bg-bottom", game.settings.get(MODULE_ID, "themeBgBottom"));
}

Hooks.once("ready", () => applyTheme());

/* -------------------------------------------- */
/*  Registre partagé des boutons flottants       */
/*  (élimine le "left: XXXpx" deviné à la main   */
/*  dans chaque module pour éviter les collisions) */
/* -------------------------------------------- */

window.BetterSuite = window.BetterSuite || {};
window.BetterSuite._buttons = [];

/**
 * Enregistre un bouton flottant dans la rangée commune en bas à gauche, avec
 * positionnement automatique à la suite des boutons déjà enregistrés.
 * Passer { centered: true } pour un bouton positionné indépendamment au centre bas
 * (ex. bascule de la barre de macros), en dehors de la rangée.
 */
window.BetterSuite.registerButton = function (el, options = {}) {
  el.classList.add("bs-toggle-btn");

  if (options.centered) {
    el.classList.add("bs-toggle-btn-centered");
    document.body.appendChild(el);
    return;
  }

  window.BetterSuite._buttons.push(el);
  document.body.appendChild(el);
  window.BetterSuite._layoutButtons();
};

window.BetterSuite._layoutButtons = function () {
  let offset = 8;
  for (const el of window.BetterSuite._buttons) {
    el.style.left = `${offset}px`;
    offset += 48;
  }
};

/* -------------------------------------------- */
/*  Petit bus d'événements entre modules         */
/*  (ex. la tablette à dés doit savoir si la      */
/*  barre d'actions de combat est ouverte, pour   */
/*  s'écarter le temps qu'elle est affichée)       */
/* -------------------------------------------- */

window.BetterSuite._combatBarOpen = false;
window.BetterSuite._combatBarListeners = [];

/** Appelé par Better Combat UI à chaque ouverture/fermeture de sa barre */
window.BetterSuite.notifyCombatBarState = function (open) {
  window.BetterSuite._combatBarOpen = open;
  window.BetterSuite._combatBarListeners.forEach(cb => cb(open));
};

/** Appelé par d'autres modules pour réagir à l'ouverture/fermeture de cette barre */
window.BetterSuite.onCombatBarChange = function (cb) {
  window.BetterSuite._combatBarListeners.push(cb);
  cb(window.BetterSuite._combatBarOpen); // état actuel immédiatement
};
