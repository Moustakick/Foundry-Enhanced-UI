const MODULE_ID = "better-suite";

let barOpen = false;

/* -------------------------------------------- */
/*  Réglages                                     */
/* -------------------------------------------- */

Hooks.once("init", () => {
  if (!game.settings.get(MODULE_ID, "enableCombatUi")) return;

  game.settings.register(MODULE_ID, "combat_autoOpenOnCombat", {
    name: "BCU.Settings.AutoOpen.Name",
    hint: "BCU.Settings.AutoOpen.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "combat_barScale", {
    name: "BCU.Settings.BarScale.Name",
    hint: "BCU.Settings.BarScale.Hint",
    scope: "client",
    config: true,
    type: Number,
    range: { min: 80, max: 160, step: 10 },
    default: 100,
    onChange: applyBarScale
  });
});

function applyBarScale(value) {
  document.documentElement.style.setProperty("--bcu-scale", (value / 100).toFixed(2));
}

/* -------------------------------------------- */
/*  Modèle de données (spécifique au système dnd5e) */
/* -------------------------------------------- */

/** Un sort est utilisable s'il est préparé, ou toujours disponible (cantrip, à volonté, inné, pacte) */
function isUsableSpell(item) {
  const prep = item.system?.preparation;
  if (!prep) return false;
  const always = ["always", "atwill", "innate", "pact"].includes(prep.mode);
  return always || !!prep.prepared;
}

/** Nombre d'utilisations restantes à afficher : emplacements de sort pour les sorts, "uses" sinon */
function computeUses(actor, item) {
  if (item.type === "spell") {
    const level = item.system?.level ?? 0;
    if (level > 0) {
      const slot = actor.system?.spells?.[`spell${level}`];
      if (slot && typeof slot.max === "number" && slot.max > 0) return `${slot.value ?? 0}/${slot.max}`;
    }
    return null;
  }
  const u = item.system?.uses;
  if (u && typeof u.max === "number" && u.max > 0) return `${u.value ?? 0}/${u.max}`;
  return null;
}

/** Résumé texte court (sans HTML) de la description d'un objet, pour la bulle au survol */
function stripHtmlSummary(html, maxLen = 160) {
  if (!html) return "";
  const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;
}

/** "Niv. 3" / "Mineur" pour un niveau de sort donné (null si non applicable) */
function formatSpellLevel(level) {
  if (level === null || level === undefined) return null;
  return level === 0 ? game.i18n.localize("BCU.CantripAbbr") : game.i18n.format("BCU.SpellLevelAbbr", { level });
}

function isOtherActivation(type) {
  return !!type && !["action", "bonus", "reaction", "none"].includes(type);
}

/** Construit l'entrée standardisée d'un objet utilisable (popover, bouton unique...) */
function buildEntry(actor, item) {
  const level = item.type === "spell" ? (item.system?.level ?? 0) : null;
  return {
    id: item.id,
    name: item.name,
    img: item.img,
    uses: computeUses(actor, item),
    level,
    levelLabel: formatSpellLevel(level),
    tooltip: stripHtmlSummary(item.system?.description?.value) || item.name
  };
}

// Catégories "Actions" / "Actions Bonus" adossées à de vrais objets de la fiche
const ITEM_CATEGORY_DEFS = [
  {
    key: "attack",
    icon: "fa-hand-fist",
    labelKey: "BCU.Category.Attack",
    filter: item => item.type === "weapon" && item.system?.equipped === true
  },
  {
    key: "spell",
    icon: "fa-wand-magic-sparkles",
    labelKey: "BCU.Category.Spell",
    filter: item => item.type === "spell" && isUsableSpell(item)
  },
  {
    key: "power",
    icon: "fa-bolt",
    labelKey: "BCU.Category.Power",
    filter: item => item.type === "feat" && !!item.system?.activation?.type && item.system.activation.type !== "none"
  }
];

// Actions génériques (règles, pas des objets par défaut dans dnd5e). On cherche d'abord
// un objet du même nom sur la fiche (certaines tables en ajoutent via un compendium
// "Actions génériques" du SRD) ; à défaut, clic = déclaration dans le chat, avec le texte
// de la fiche de règles dnd5e si on la trouve (journal du monde ou compendium
// "dnd5e.rules"), sinon un simple message de déclaration.
const GENERIC_ACTION_DEFS = {
  dodge: { icon: "fa-shield-halved", labelKey: "BCU.Generic.Dodge", names: ["dodge", "esquiver", "esquive"] },
  disengage: { icon: "fa-person-running", labelKey: "BCU.Generic.Disengage", names: ["disengage", "se désengager", "désengagement"] },
  dash: { icon: "fa-forward", labelKey: "BCU.Generic.Dash", names: ["dash", "foncer"] },
  help: { icon: "fa-hands-helping", labelKey: "BCU.Generic.Help", names: ["help", "aider", "aide"] },
  shove: { icon: "fa-hand", labelKey: "BCU.Generic.Shove", names: ["shove", "bousculer", "bousculer une créature", "bousculade"] },
  hide: { icon: "fa-eye-slash", labelKey: "BCU.Generic.Hide", names: ["hide", "se cacher"] },
  ready: { icon: "fa-stopwatch", labelKey: "BCU.Generic.Ready", names: ["ready", "se tenir prêt", "prêt"] }
};

// Regroupements demandés : [Esquiver, Se désengager, Foncer] et [Aider, Bousculer, Se cacher].
// "Se tenir prêt" reste un bouton autonome.
const GROUP_DODGE_DISENGAGE_DASH = ["dodge", "disengage", "dash"];
const GROUP_HELP_SHOVE_HIDE = ["help", "shove", "hide"];

function buildCategory(actor, def, activationType) {
  const items = actor.items.filter(i => def.filter(i) && i.system?.activation?.type === activationType);
  const entries = items.map(i => buildEntry(actor, i));

  // Les sorts sont triés par niveau croissant (puis par nom), pour un menu lisible
  // plutôt que dans l'ordre arbitraire de la fiche.
  if (def.key === "spell") {
    entries.sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || a.name.localeCompare(b.name));
  }

  return {
    key: def.key,
    icon: def.icon,
    label: game.i18n.localize(def.labelKey),
    items: entries
  };
}

/** Catégorie combinée (utilisée pour "Réactions" et "Autre") : tous types d'objets confondus */
function buildCombinedCategory(actor, keyLabel, icon, matchType) {
  const items = actor.items.filter(i => matchType(i.system?.activation?.type));
  return {
    key: keyLabel,
    icon,
    label: game.i18n.localize(keyLabel === "reaction" ? "BCU.Section.Reaction" : "BCU.Section.Other"),
    items: items.map(i => buildEntry(actor, i))
  };
}

function findGenericItem(actor, names) {
  return actor.items.find(i => i.type === "feat" && names.includes(i.name.trim().toLowerCase()));
}

/** Catégorie "Objet" — totalement à part de toute rangée d'actions (pas filtrée par
    économie d'action, puisqu'elle vit en dehors de la logique Action/Bonus/Réaction). */
function buildItemCategory(actor) {
  const items = actor.items.filter(i => i.type === "consumable");
  return {
    key: "item",
    icon: "fa-flask",
    label: game.i18n.localize("BCU.Category.Item"),
    items: items.map(i => buildEntry(actor, i))
  };
}

/** Résumé des emplacements de sort restants par niveau, affiché en tête du menu Sorts */
function buildSpellSlotsSummary(actor) {
  const spells = actor.system?.spells;
  if (!spells) return null;

  const parts = [];
  for (let lvl = 1; lvl <= 9; lvl++) {
    const slot = spells[`spell${lvl}`];
    if (slot && typeof slot.max === "number" && slot.max > 0) {
      parts.push(`${game.i18n.format("BCU.SpellLevelAbbr", { level: lvl })} ${slot.value ?? 0}/${slot.max}`);
    }
  }
  if (spells.pact && typeof spells.pact.max === "number" && spells.pact.max > 0) {
    parts.push(`${game.i18n.localize("BCU.PactSlots")} ${spells.pact.value ?? 0}/${spells.pact.max}`);
  }
  return parts.length ? parts.join(" · ") : null;
}

function getActionsData() {
  const actor = game.user.character;
  if (!actor) return null;

  const main = ITEM_CATEGORY_DEFS.map(def => buildCategory(actor, def, "action"));
  const bonus = ITEM_CATEGORY_DEFS.filter(d => d.key !== "attack").map(def => buildCategory(actor, def, "bonus")).filter(c => c.items.length);
  const item = buildItemCategory(actor);
  const reactions = buildCombinedCategory(actor, "reaction", "fa-reply", t => t === "reaction");
  const other = buildCombinedCategory(actor, "other", "fa-ellipsis", t => isOtherActivation(t));

  const generic = {};
  for (const [key, def] of Object.entries(GENERIC_ACTION_DEFS)) {
    generic[key] = {
      key,
      icon: def.icon,
      label: game.i18n.localize(def.labelKey),
      hasItem: !!findGenericItem(actor, def.names)
    };
  }

  return { actorId: actor.id, main, bonus, item, reactions, other, generic };
}

/* -------------------------------------------- */
/*  Recherche du texte de règle correspondant (journal du monde, puis compendium dnd5e.rules) */
/* -------------------------------------------- */

let _cachedRulesPages = null;

async function loadRulesPages() {
  if (_cachedRulesPages !== null) return _cachedRulesPages;

  const map = new Map();
  const register = doc => {
    if (!doc?.pages) return;
    for (const page of doc.pages) {
      map.set(page.name.trim().toLowerCase(), { title: page.name, content: page.text?.content ?? "" });
    }
  };

  for (const entry of game.journal.contents) register(entry);

  const pack = game.packs.get("dnd5e.rules");
  if (pack) {
    try {
      const index = await pack.getIndex();
      for (const idxEntry of index) {
        const doc = await pack.getDocument(idxEntry._id);
        register(doc);
      }
    } catch (err) {
      console.warn("Better Combat UI | Impossible de consulter le compendium des règles dnd5e", err);
    }
  }

  _cachedRulesPages = map;
  return map;
}

async function findActionRulesText(names) {
  const map = await loadRulesPages();
  for (const n of names) {
    if (map.has(n)) return map.get(n);
  }
  return null;
}

/* -------------------------------------------- */
/*  Actions                                      */
/* -------------------------------------------- */

function useItem(itemId) {
  const actor = game.user.character;
  const item = actor?.items.get(itemId);
  if (!item) return;
  try {
    if (typeof item.use === "function") item.use({}, {});
    else if (typeof item.roll === "function") item.roll();
    else ui.notifications.warn(game.i18n.localize("BCU.UseError"));
  } catch (err) {
    console.error("Better Combat UI | Échec de l'utilisation de l'objet", err);
    ui.notifications.warn(game.i18n.localize("BCU.UseError"));
  }
}

function openItemSheet(itemId) {
  const actor = game.user.character;
  actor?.items.get(itemId)?.sheet?.render(true);
}

/** Bousculer : lance automatiquement un jet de Force (Athlétisme) via l'API du système */
function rollShove(actor) {
  if (typeof actor.rollSkill === "function") {
    actor.rollSkill("ath", {});
  } else if (typeof actor.rollAbilityTest === "function") {
    actor.rollAbilityTest("str", {});
  } else {
    ui.notifications.warn(game.i18n.localize("BCU.UseError"));
  }
}

async function useGenericAction(key) {
  const def = GENERIC_ACTION_DEFS[key];
  const actor = game.user.character;
  if (!actor || !def) return;

  const item = findGenericItem(actor, def.names);
  if (item) {
    useItem(item.id);
    return;
  }

  if (key === "shove") {
    rollShove(actor);
    return;
  }

  const label = game.i18n.localize(def.labelKey);
  const rule = await findActionRulesText(def.names);

  if (rule) {
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<h3>${rule.title}</h3>${rule.content}`
    });
  } else {
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: game.i18n.format("BCU.Generic.ChatFlavor", { name: actor.name, action: label })
    });
  }
}

/** Le bouton "Terminer le tour" ne doit rien faire s'il est censé être désactivé
    (filet de sécurité en plus de l'attribut disabled du bouton) */
function isMyTurn() {
  const combat = game.combats?.active;
  if (!combat) return false;
  const current = combat.combatant;
  return !!current?.actor?.id && current.actor.id === game.user.character?.id;
}

function canEndTurn() {
  return game.user.isGM || isMyTurn();
}

async function endTurn() {
  if (!canEndTurn()) return;
  try {
    await game.combats?.active?.nextTurn();
  } catch (err) {
    console.warn("Better Combat UI | Impossible de terminer le tour", err);
    ui.notifications.warn(game.i18n.localize("BCU.NoPermission"));
  }
}

/* -------------------------------------------- */
/*  Popovers de sélection                        */
/* -------------------------------------------- */

// Référence de l'écouteur de clic extérieur actuellement actif, pour pouvoir le
// retirer explicitement (voir closeAllPopovers) plutôt que de compter uniquement
// sur {once:true} : sans ce nettoyage, un popover fermé PROGRAMMATIQUEMENT (plutôt
// que par un vrai clic extérieur) laissait un écouteur périmé sur le document, qui
// se déclenchait au clic suivant — y compris le clic destiné à ouvrir un NOUVEAU
// popover — et supprimait ce dernier aussitôt créé, rendant impossible l'ouverture
// d'un second menu tant qu'aucun clic extérieur n'avait eu lieu entre-temps.
let _outsideClickHandler = null;

function closeAllPopovers() {
  document.querySelectorAll(".bcu-popover").forEach(p => p.remove());
  if (_outsideClickHandler) {
    document.removeEventListener("click", _outsideClickHandler);
    _outsideClickHandler = null;
  }
}

function attachOutsideClose(pop) {
  setTimeout(() => {
    _outsideClickHandler = ev => {
      if (!pop.contains(ev.target)) closeAllPopovers();
    };
    document.addEventListener("click", _outsideClickHandler);
  }, 0);
}

/** Ligne d'un popover pour un objet (attaque/sort/aptitude/objet/réaction/autre) */
function buildPopoverItemRow(it) {
  const row = document.createElement("div");
  row.className = "bcu-popover-item";
  row.dataset.tooltip = it.tooltip;
  row.innerHTML = `
    <div class="bcu-popover-icon" style="background-image:url('${it.img}');"></div>
    <span class="bcu-popover-name">${it.name}</span>
    ${it.levelLabel ? `<span class="bcu-popover-level">${it.levelLabel}</span>` : ""}
    ${it.uses ? `<span class="bcu-popover-uses">${it.uses}</span>` : ""}
    <button type="button" class="bcu-popover-sheet" title="${game.i18n.localize("BCU.OpenSheet")}">
      <i class="fas fa-book-open"></i>
    </button>
  `;
  row.querySelector(".bcu-popover-sheet").addEventListener("click", ev => {
    ev.stopPropagation();
    openItemSheet(it.id);
  });
  row.addEventListener("click", () => {
    useItem(it.id);
    closeAllPopovers();
  });
  return row;
}

/** Popover listant des objets (catégories adossées à des objets de la fiche) */
function openItemPopover(anchorEl, category) {
  closeAllPopovers();
  const pop = document.createElement("div");
  pop.className = "bcu-popover";

  // Résumé des emplacements de sort restants, uniquement en tête du menu Sorts
  if (category.key === "spell") {
    const actor = game.user.character;
    const summary = actor ? buildSpellSlotsSummary(actor) : null;
    if (summary) {
      const summaryEl = document.createElement("div");
      summaryEl.className = "bcu-popover-summary";
      summaryEl.textContent = summary;
      pop.appendChild(summaryEl);
    }
  }

  category.items.forEach(it => pop.appendChild(buildPopoverItemRow(it)));

  anchorEl.appendChild(pop);
  attachOutsideClose(pop);
}

function onCategoryClick(ev, category) {
  if (!category.items.length) return;
  if (category.items.length === 1) {
    useItem(category.items[0].id);
    return;
  }
  openItemPopover(ev.currentTarget, category);
}

/* -------------------------------------------- */
/*  Construction du DOM                          */
/* -------------------------------------------- */

function makeCategoryButton(cat) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "bcu-cat-btn";

  if (!cat.items.length) {
    btn.classList.add("bcu-disabled");
    btn.title = game.i18n.localize("BCU.EmptyCategoryTooltip");
    btn.innerHTML = `<i class="fas ${cat.icon}"></i><span>${cat.label}</span>`;
  } else if (cat.items.length === 1) {
    // Un seul objet dans la catégorie : on affiche directement son icône plutôt
    // que l'icône générique de la catégorie, avec un bouton pour ouvrir sa fiche.
    const it = cat.items[0];
    btn.dataset.tooltip = it.tooltip;
    btn.innerHTML = `
      <div class="bcu-cat-icon-img" style="background-image:url('${it.img}');"></div>
      <span>${it.name}</span>
      <button type="button" class="bcu-cat-sheet-btn" title="${game.i18n.localize("BCU.OpenSheet")}">
        <i class="fas fa-book-open"></i>
      </button>
    `;
    btn.querySelector(".bcu-cat-sheet-btn").addEventListener("click", ev => {
      ev.stopPropagation();
      openItemSheet(it.id);
    });
  } else {
    btn.title = cat.label;
    btn.innerHTML = `<i class="fas ${cat.icon}"></i><span>${cat.label}</span>`;
  }

  btn.addEventListener("click", ev => onCategoryClick(ev, cat));
  return btn;
}

function makeGenericButton(entry) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "bcu-cat-btn";
  if (entry.hasItem) btn.classList.add("bcu-has-item");
  btn.title = entry.hasItem ? entry.label : `${entry.label} — ${game.i18n.localize("BCU.Generic.NoItemTooltip")}`;
  btn.innerHTML = `<i class="fas ${entry.icon}"></i><span>${entry.label}</span>`;
  btn.addEventListener("click", () => useGenericAction(entry.key));
  return btn;
}

/**
 * Bloc d'actions génériques groupées : plutôt qu'un seul bouton ouvrant un menu
 * déroulant, on affiche N mini-icônes empilées verticalement, occupant ensemble la
 * même largeur et la même hauteur qu'un bouton normal — chacune cliquable
 * directement, sans étape intermédiaire.
 */
function makeGenericGroupBlock(genericMap, keys) {
  const container = document.createElement("div");
  container.className = "bcu-group-block";

  keys.forEach(key => {
    const def = genericMap[key];
    const mini = document.createElement("button");
    mini.type = "button";
    mini.className = "bcu-group-mini";
    if (def.hasItem) mini.classList.add("bcu-has-item");
    mini.title = def.hasItem ? def.label : `${def.label} — ${game.i18n.localize("BCU.Generic.NoItemTooltip")}`;
    mini.innerHTML = `<i class="fas ${def.icon}"></i>`;
    mini.addEventListener("click", () => useGenericAction(key));
    container.appendChild(mini);
  });

  return container;
}

function applyOpenState() {
  document.getElementById("bcu-panel")?.classList.toggle("bcu-open", barOpen);
  document.getElementById("bcu-toggle")?.classList.toggle("active", barOpen);
  if (!barOpen) closeAllPopovers();
  window.BetterSuite?.notifyCombatBarState?.(barOpen);
}

function toggleBar() {
  barOpen = !barOpen;
  applyOpenState();
}

function openBar() {
  barOpen = true;
  applyOpenState();
}

function makeSection(labelKey, rowBuilder) {
  const section = document.createElement("div");
  section.className = "bcu-section";
  const label = document.createElement("div");
  label.className = "bcu-section-label";
  label.textContent = game.i18n.localize(labelKey);
  section.appendChild(label);

  const row = document.createElement("div");
  row.className = "bcu-row";
  rowBuilder(row);
  section.appendChild(row);
  return section;
}

function render() {
  const panel = document.getElementById("bcu-panel");
  if (!panel) return;
  panel.innerHTML = "";
  closeAllPopovers();

  const data = getActionsData();

  if (!data) {
    const empty = document.createElement("p");
    empty.className = "bcu-empty";
    empty.textContent = game.i18n.localize("BCU.NoCharacter");
    panel.appendChild(empty);
    applyOpenState();
    return;
  }

  const byKey = key => data.main.find(c => c.key === key);

  // Actions : Attaquer, [Esquiver, Se désengager, Foncer], Sorts, Aptitude,
  // Se tenir prêt, [Aider, Bousculer, Se cacher]
  panel.appendChild(makeSection("BCU.Section.Main", row => {
    row.appendChild(makeCategoryButton(byKey("attack")));
    row.appendChild(makeGenericGroupBlock(data.generic, GROUP_DODGE_DISENGAGE_DASH));
    row.appendChild(makeCategoryButton(byKey("spell")));
    row.appendChild(makeCategoryButton(byKey("power")));
    row.appendChild(makeGenericButton(data.generic.ready));
    row.appendChild(makeGenericGroupBlock(data.generic, GROUP_HELP_SHOVE_HIDE));
  }));

  // Actions Bonus : Sorts, Aptitudes (uniquement si au moins une option existe)
  if (data.bonus.length) {
    panel.appendChild(makeSection("BCU.Section.Bonus", row => {
      data.bonus.forEach(cat => row.appendChild(makeCategoryButton(cat)));
    }));
  }

  // Objet : totalement à part de toute rangée d'actions
  panel.appendChild(makeSection("BCU.Section.Item", row => {
    row.appendChild(makeCategoryButton(data.item));
  }));

  // Réactions : liste combinée de tous les objets à coût de réaction
  panel.appendChild(makeSection("BCU.Section.Reaction", row => {
    row.appendChild(makeCategoryButton(data.reactions));
  }));

  // Autre : liste combinée de toutes les actions libres/spéciales
  panel.appendChild(makeSection("BCU.Section.Other", row => {
    row.appendChild(makeCategoryButton(data.other));
  }));

  const endTurnBtn = document.createElement("button");
  endTurnBtn.type = "button";
  // Même gabarit que les autres boutons (.bcu-cat-btn), simplement une couleur
  // distincte (.bcu-end-turn en complément) plutôt qu'un bouton à part, plus large.
  endTurnBtn.className = "bcu-cat-btn bcu-end-turn";
  const canEnd = canEndTurn();
  if (!canEnd) {
    endTurnBtn.disabled = true;
    endTurnBtn.title = game.i18n.localize("BCU.NotYourTurn");
  }
  endTurnBtn.innerHTML = `<i class="fas fa-flag-checkered"></i><span>${game.i18n.localize("BCU.EndTurn")}</span>`;
  endTurnBtn.addEventListener("click", endTurn);
  panel.appendChild(endTurnBtn);

  applyOpenState();
}

function buildBar() {
  if (document.getElementById("bcu-toggle")) return;

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.id = "bcu-toggle";
  toggle.title = game.i18n.localize("BCU.ToggleTitle");
  toggle.innerHTML = '<i class="fas fa-hand-fist"></i>';
  toggle.addEventListener("click", toggleBar);
  if (window.BetterSuite?.registerButton) window.BetterSuite.registerButton(toggle);
  else document.body.appendChild(toggle); // repli si le cœur du suite n'a pas chargé

  const panel = document.createElement("div");
  panel.id = "bcu-panel";
  panel.className = "bcu-panel";
  document.body.appendChild(panel);

  render();
}

/* -------------------------------------------- */
/*  Cycle de vie                                 */
/* -------------------------------------------- */

Hooks.once("ready", () => {
  if (!game.settings.get(MODULE_ID, "enableCombatUi")) return;
  applyBarScale(game.settings.get(MODULE_ID, "combat_barScale"));
  buildBar();
});

// Ouverture automatique au tout début d'un combat (une seule fois, pas à chaque tour)
Hooks.on("combatStart", () => {
  if (!game.settings.get(MODULE_ID, "enableCombatUi")) return;
  if (game.settings.get(MODULE_ID, "combat_autoOpenOnCombat")) openBar();
});

// Rafraîchit l'état (actif/inactif) du bouton "Terminer le tour" à chaque
// changement de tour/round.
Hooks.on("updateCombat", () => render());

Hooks.on("updateUser", user => {
  if (user.id === game.user.id) render();
});

Hooks.on("updateActor", actor => {
  if (actor.id === game.user.character?.id) render();
});

function onOwnCharacterItemChange(item) {
  if (item.parent?.id === game.user.character?.id) render();
}
Hooks.on("createItem", onOwnCharacterItemChange);
Hooks.on("updateItem", onOwnCharacterItemChange);
Hooks.on("deleteItem", onOwnCharacterItemChange);
