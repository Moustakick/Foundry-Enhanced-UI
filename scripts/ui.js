const MODULE_ID = "better-suite";

let revealAllControls = false;

/* -------------------------------------------- */
/*  Formulaire de configuration des groupes d'outils (menu natif) */
/* -------------------------------------------- */

class ControlGroupsConfig extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "bui-control-groups-config",
      title: game.i18n.localize("BUI.Settings.ControlGroupsMenu.Name"),
      template: `modules/${MODULE_ID}/templates/control-groups.hbs`,
      width: 320,
      height: "auto",
      closeOnSubmit: true
    });
  }

  getData() {
    const groups = window.__buiAllControlGroups ?? [];
    const hidden = new Set(game.settings.get(MODULE_ID, "ui_hiddenControlGroups") ?? []);
    return {
      groups: groups.map(g => ({
        name: g.name,
        title: game.i18n.localize(g.title) || g.name,
        checked: !hidden.has(g.name)
      }))
    };
  }

  async _updateObject(event, formData) {
    const groups = window.__buiAllControlGroups ?? [];
    const hidden = groups.filter(g => !formData[g.name]).map(g => g.name);
    await game.settings.set(MODULE_ID, "ui_hiddenControlGroups", hidden);
    refreshControls();
  }
}

/* -------------------------------------------- */
/*  Réglages                                     */
/* -------------------------------------------- */

Hooks.once("init", () => {
  if (!game.settings.get(MODULE_ID, "enableUi")) return;

  game.settings.register(MODULE_ID, "ui_hideLogo", {
    name: "BUI.Settings.HideLogo.Name",
    hint: "BUI.Settings.HideLogo.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: value => document.body.classList.toggle("bui-hide-logo", value)
  });

  // Masquage de la navigation de scènes : totalement indépendant de l'affichage
  // des outils de scène (#controls) — ce sont deux éléments distincts (#navigation
  // vs #controls), gérés par des classes CSS et une logique séparées. Uniquement
  // masqué pour les joueurs par défaut ; le MJ la voit toujours.
  game.settings.register(MODULE_ID, "ui_hideNavForPlayers", {
    name: "BUI.Settings.HideNavForPlayers.Name",
    hint: "BUI.Settings.HideNavForPlayers.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: value => applyNavVisibility(value)
  });

  game.settings.register(MODULE_ID, "ui_hideHotbar", {
    name: "BUI.Settings.HideHotbar.Name",
    hint: "BUI.Settings.HideHotbar.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: value => {
      document.body.classList.toggle("bui-hide-hotbar", value);
      updateHotbarButtonState();
    }
  });

  game.settings.register(MODULE_ID, "ui_compactControls", {
    name: "BUI.Settings.CompactControls.Name",
    hint: "BUI.Settings.CompactControls.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: value => document.body.classList.toggle("bui-compact-controls", value)
  });

  // Réglage désormais à l'échelle du monde, configuré par le MJ pour tous (au lieu
  // d'une préférence individuelle par client) : modifié uniquement via le menu de
  // configuration ci-dessous, jamais affiché brut.
  game.settings.register(MODULE_ID, "ui_hiddenControlGroups", {
    scope: "world",
    config: false,
    type: Array,
    default: []
  });

  // Menu natif (dans Configure Settings), réservé au MJ, pour choisir les outils
  // affichés par défaut pour tout le monde.
  game.settings.registerMenu(MODULE_ID, "ui_controlGroupsMenu", {
    name: "BUI.Settings.ControlGroupsMenu.Name",
    label: "BUI.Settings.ControlGroupsMenu.Label",
    hint: "BUI.Settings.ControlGroupsMenu.Hint",
    icon: "fas fa-sliders",
    type: ControlGroupsConfig,
    restricted: true
  });
});

/* -------------------------------------------- */
/*  Navigation de scènes (joueurs uniquement)    */
/* -------------------------------------------- */

function applyNavVisibility(hideForPlayers) {
  const shouldHide = hideForPlayers && !game.user.isGM;
  document.body.classList.toggle("bui-hide-nav", shouldHide);
}

/* -------------------------------------------- */
/*  Filtrage des groupes d'outils de scène       */
/* -------------------------------------------- */

/**
 * Intercepte la construction de la barre d'outils de scène pour :
 * 1) mémoriser la liste complète des groupes disponibles (utile pour le menu
 *    de configuration, qui doit fonctionner quel que soit le système de jeu),
 * 2) retirer les groupes que le joueur a choisi de masquer par défaut, sauf si
 *    le mode "révéler tout temporairement" est actif.
 * Gère à la fois le format tableau et objet, ces deux formats ayant existé selon
 * les versions de Foundry.
 */
Hooks.on("getSceneControlButtons", controls => {
  if (!game.settings.get(MODULE_ID, "enableUi")) return;

  const entries = Array.isArray(controls) ? controls : Object.values(controls ?? {});
  window.__buiAllControlGroups = entries.map(c => ({ name: c.name, title: c.title || c.name }));

  if (revealAllControls) return;

  const hidden = new Set(game.settings.get(MODULE_ID, "ui_hiddenControlGroups") ?? []);
  if (!hidden.size) return;

  if (Array.isArray(controls)) {
    for (let i = controls.length - 1; i >= 0; i--) {
      if (hidden.has(controls[i].name)) controls.splice(i, 1);
    }
  } else if (controls && typeof controls === "object") {
    for (const key of Object.keys(controls)) {
      if (hidden.has(key)) delete controls[key];
    }
  }
});

/** Force Foundry à reconstruire puis re-rendre la barre d'outils de scène */
function refreshControls() {
  try {
    if (typeof ui.controls?.initialize === "function") ui.controls.initialize();
    ui.controls?.render(true);
  } catch (err) {
    console.error("Better UI | Impossible de rafraîchir la barre d'outils de scène", err);
  }
}

/* -------------------------------------------- */
/*  Boutons flottants — tous regroupés en bas à gauche */
/*  (à côté du bouton de réouverture de Better Party List) */
/* -------------------------------------------- */

function createToggleButton(id, iconClass, titleKey, onClick, options = {}) {
  if (document.getElementById(id)) return document.getElementById(id);
  const btn = document.createElement("button");
  btn.id = id;
  btn.type = "button";
  btn.title = game.i18n.localize(titleKey);
  btn.innerHTML = `<i class="fas ${iconClass}"></i>`;
  btn.addEventListener("click", onClick);
  if (window.BetterSuite?.registerButton) window.BetterSuite.registerButton(btn, options);
  else document.body.appendChild(btn); // repli si le cœur du suite n'a pas chargé
  return btn;
}

function updateHotbarButtonState() {
  const btn = document.getElementById("bui-hotbar-toggle");
  if (!btn) return;
  const hidden = document.body.classList.contains("bui-hide-hotbar");
  btn.classList.toggle("active", !hidden);
}

function createHotbarToggle() {
  const btn = createToggleButton("bui-hotbar-toggle", "fa-scroll", "BUI.HotbarToggle", () => {
    // Bascule l'état visuel à la volée, sans changer la préférence par défaut
    // (celle-ci reste pilotée par le réglage "Masquer la barre de macros").
    const currentlyHidden = document.body.classList.contains("bui-hide-hotbar");
    document.body.classList.toggle("bui-hide-hotbar", !currentlyHidden);
    updateHotbarButtonState();
  });
  updateHotbarButtonState();
  return btn;
}

function createControlsToggle() {
  return createToggleButton("bui-controls-toggle", "fa-toolbox", "BUI.ControlsToggle", () => {
    document.body.classList.toggle("bui-hide-controls");
    document.getElementById("bui-controls-toggle")?.classList.toggle(
      "active",
      !document.body.classList.contains("bui-hide-controls")
    );
  });
}

function createControlsReveal() {
  return createToggleButton("bui-controls-reveal", "fa-eye", "BUI.ControlsReveal", () => {
    revealAllControls = !revealAllControls;
    document.getElementById("bui-controls-reveal")?.classList.toggle("active", revealAllControls);
    refreshControls();
  });
}

/* -------------------------------------------- */
/*  Cycle de vie                                 */
/* -------------------------------------------- */

Hooks.once("ready", () => {
  if (!game.settings.get(MODULE_ID, "enableUi")) return;

  document.body.classList.toggle("bui-hide-logo", game.settings.get(MODULE_ID, "ui_hideLogo"));
  document.body.classList.toggle("bui-hide-hotbar", game.settings.get(MODULE_ID, "ui_hideHotbar"));
  document.body.classList.toggle("bui-compact-controls", game.settings.get(MODULE_ID, "ui_compactControls"));
  applyNavVisibility(game.settings.get(MODULE_ID, "ui_hideNavForPlayers"));

  createControlsToggle();
  createControlsReveal();
  createHotbarToggle();
});
