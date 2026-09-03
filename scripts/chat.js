const MODULE_ID = "better-suite";

/* -------------------------------------------- */
/*  Réglages                                     */
/* -------------------------------------------- */

Hooks.once("init", () => {
  if (!game.settings.get(MODULE_ID, "enableChat")) return;

  game.settings.register(MODULE_ID, "chat_backgroundOpacity", {
    name: "BC.Settings.BackgroundOpacity.Name",
    hint: "BC.Settings.BackgroundOpacity.Hint",
    scope: "client",
    config: true,
    type: Number,
    range: { min: 0, max: 100, step: 5 },
    default: 0,
    onChange: value => applyBackgroundOpacity(value)
  });

  game.settings.register(MODULE_ID, "chat_compactInput", {
    name: "BC.Settings.CompactInput.Name",
    hint: "BC.Settings.CompactInput.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: value => document.body.classList.toggle("bc-compact-input", value)
  });

  game.settings.register(MODULE_ID, "chat_iconRollMode", {
    name: "BC.Settings.IconRollMode.Name",
    hint: "BC.Settings.IconRollMode.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: value => {
      document.body.classList.toggle("bc-icon-rollmode", value);
      if (value) injectRollModeIcons();
    }
  });
});

function applyBackgroundOpacity(value) {
  const alpha = Math.max(0, Math.min(1, value / 100));
  document.documentElement.style.setProperty("--bc-bg-alpha", alpha.toFixed(2));
}

/* -------------------------------------------- */
/*  Icônes de mode de jet (remplace le <select>) */
/* -------------------------------------------- */

const ROLL_MODE_ICONS = {
  [CONST.DICE_ROLL_MODES.PUBLIC]: "fa-eye",
  [CONST.DICE_ROLL_MODES.PRIVATE]: "fa-user-secret",
  [CONST.DICE_ROLL_MODES.BLIND]: "fa-eye-slash",
  [CONST.DICE_ROLL_MODES.SELF]: "fa-user"
};

/**
 * Masque tout <select name="rollMode"> natif trouvé dans le DOM et le remplace par
 * une rangée d'icônes juste à côté. Le select reste en place (juste caché en CSS) :
 * on continue de piloter sa valeur par programmation pour rester compatible avec
 * tout code (cœur ou système de jeu) qui le lirait directement.
 * Recherche dans tout le document (pas seulement #chat-form) et peut être appelée
 * plusieurs fois sans risque (idempotent via data-bc-handled).
 */
function injectRollModeIcons() {
  if (!game.settings.get(MODULE_ID, "chat_iconRollMode")) return;

  const selects = document.querySelectorAll('select[name="rollMode"]');
  if (!selects.length) return;

  selects.forEach(select => {
    if (select.dataset.bcHandled) return;
    select.dataset.bcHandled = "true";

    const row = document.createElement("div");
    row.className = "bc-rollmode-row";

    const updateActive = () => {
      row.querySelectorAll("button").forEach(b => {
        b.classList.toggle("active", b.dataset.mode === select.value);
      });
    };

    Object.entries(ROLL_MODE_ICONS).forEach(([mode, icon]) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "bc-rollmode-btn";
      btn.dataset.mode = mode;
      btn.innerHTML = `<i class="fas ${icon}"></i>`;

      const labelKey = CONFIG.Dice.rollModes?.[mode];
      btn.title = labelKey ? game.i18n.localize(labelKey) : mode;

      btn.addEventListener("click", () => {
        select.value = mode;
        // On déclenche plusieurs types d'événements, au cas où le mécanisme interne
        // de Foundry écouterait "input" plutôt que (ou en plus de) "change".
        select.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
        select.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
        // Filet de sécurité direct : la préférence de mode de jet est de toute façon
        // stockée ici, quel que soit le mécanisme que Foundry utilise pour la lire.
        game.settings.set("core", "rollMode", mode);
        updateActive();
      });

      row.appendChild(btn);
    });

    select.insertAdjacentElement("afterend", row);
    updateActive();
  });
}

/* -------------------------------------------- */
/*  Masquage d'icônes de contrôle non désirées   */
/* -------------------------------------------- */

/**
 * Masque le bouton "d20" natif situé à côté du sélecteur de mode de jet
 * (<label class="chat-control-icon"><i class="fas fa-dice-d20"></i></label>).
 * Fait en JS plutôt qu'en CSS :has() pour rester compatible avec tous les
 * navigateurs.
 */
function hideExtraControlIcons() {
  document.querySelectorAll("label.chat-control-icon").forEach(label => {
    if (label.dataset.bcChecked) return;
    label.dataset.bcChecked = "true";
    if (label.querySelector("i.fa-dice-d20")) {
      label.style.display = "none";
    }
  });
}

/** Ajoute un texte indicatif dans le champ de saisie, qui disparaît dès qu'on tape */
function setChatPlaceholder() {
  const textarea = document.getElementById("chat-message");
  if (textarea && !textarea.placeholder) {
    textarea.placeholder = game.i18n.localize("BC.MessagePlaceholder");
  }
}

/* -------------------------------------------- */
/*  Diagnostic (console)                         */
/* -------------------------------------------- */

function logDiagnostics() {
  console.log("Better Chat | Diagnostic —", {
    "#sidebar présent": !!document.getElementById("sidebar"),
    "#chat présent": !!document.getElementById("chat"),
    "#chat-log présent": !!document.getElementById("chat-log"),
    "#chat-form présent": !!document.getElementById("chat-form"),
    "#chat-message présent": !!document.getElementById("chat-message"),
    "nb select[name=rollMode] trouvés": document.querySelectorAll('select[name="rollMode"]').length,
    "nb <li> dans #chat-log": document.querySelectorAll("#chat-log > li").length,
    "ui.sidebar.activeTab": ui.sidebar?.activeTab,
    "ui.sidebar.tabGroups?.primary": ui.sidebar?.tabGroups?.primary,
    "bc-chat-active posée sur body": document.body.classList.contains("bc-chat-active")
  });
}

/* -------------------------------------------- */
/*  Détection de l'onglet chat actif             */
/* -------------------------------------------- */

/**
 * Pose une classe sur <body> uniquement quand l'onglet chat de la sidebar est
 * actuellement affiché, pour que la transparence de #sidebar (voir chat.css)
 * ne s'applique jamais aux autres onglets (Acteurs, Combat, Journal...).
 * Plusieurs méthodes de détection combinées pour la robustesse.
 */
function updateSidebarChatState() {
  const active =
    ui.sidebar?.activeTab === "chat" ||
    ui.sidebar?.tabGroups?.primary === "chat" ||
    !!document.querySelector('#sidebar-tabs [data-tab="chat"].active');

  document.body.classList.toggle("bc-chat-active", !!active);
}

/* -------------------------------------------- */
/*  Cycle de vie                                 */
/* -------------------------------------------- */

Hooks.once("ready", () => {
  if (!game.settings.get(MODULE_ID, "enableChat")) return;

  applyBackgroundOpacity(game.settings.get(MODULE_ID, "chat_backgroundOpacity"));
  document.body.classList.toggle("bc-compact-input", game.settings.get(MODULE_ID, "chat_compactInput"));
  document.body.classList.toggle("bc-icon-rollmode", game.settings.get(MODULE_ID, "chat_iconRollMode"));

  injectRollModeIcons();
  hideExtraControlIcons();
  setChatPlaceholder();
  updateSidebarChatState();
  logDiagnostics();

  // Filet de sécurité : si le formulaire de chat (et son <select>) apparaît plus tard
  // dans le DOM que prévu, ou si le hook renderChatLog ne suffit pas dans certaines
  // configurations, on réessaie automatiquement à chaque changement du DOM.
  const observer = new MutationObserver(() => {
    injectRollModeIcons();
    hideExtraControlIcons();
  });
  observer.observe(document.body, { childList: true, subtree: true });
});

Hooks.on("renderChatLog", () => {
  if (!game.settings.get(MODULE_ID, "enableChat")) return;
  injectRollModeIcons();
  hideExtraControlIcons();
  setChatPlaceholder();
});

// Se déclenche à chaque changement d'onglet dans la sidebar (Chat, Acteurs, Combat...)
Hooks.on("changeSidebarTab", () => {
  if (!game.settings.get(MODULE_ID, "enableChat")) return;
  updateSidebarChatState();
});

/*
 * Applique explicitement le mode de jet choisi (icônes MJ/Moi/Moi+MJ/Tout le monde)
 * au moment de l'envoi d'un message, via le hook officiel prévu pour ça — plutôt que
 * de compter sur le fait que le cœur de Foundry relise correctement la valeur du
 * <select> natif qu'on masque et pilote par programmation. C'est un filet de
 * sécurité qui garantit le bon comportement quel que soit le mécanisme interne
 * exact utilisé par le cœur pour déterminer la visibilité du message.
 */
Hooks.on("chatMessage", (chatLog, message, chatData) => {
  if (!game.settings.get(MODULE_ID, "enableChat")) return;
  if (!game.settings.get(MODULE_ID, "chat_iconRollMode")) return;

  const mode = game.settings.get("core", "rollMode");
  ChatMessage.applyRollMode(chatData, mode);
});

/*
 * La bulle de dialogue flottante au-dessus du jeton (fonctionnalité "Chat Bubbles"
 * du cœur de Foundry) est un système séparé du journal de chat : filtrer le journal
 * (ci-dessus) ne l'empêche pas d'afficher le texte à tout le monde. Problème
 * technique : le hook "chatBubble" ne reçoit que le TEXTE du message (pas le
 * document ChatMessage), donc impossible d'y lire directement whisper/blind. On
 * utilise donc le hook "createChatMessage" (qui reçoit le document complet, avec
 * son getter isContentVisible tenant compte du destinataire actuel) pour préparer
 * un drapeau, consommé juste après par "chatBubble" pour annuler l'affichage si besoin.
 */
let _suppressNextBubble = false;

Hooks.on("createChatMessage", chatMessage => {
  if (!game.settings.get(MODULE_ID, "enableChat")) return;
  if (!game.settings.get(MODULE_ID, "chat_iconRollMode")) return;

  const isRestricted = (chatMessage.whisper?.length ?? 0) > 0 || chatMessage.blind === true;
  _suppressNextBubble = isRestricted && !chatMessage.isContentVisible;
});

Hooks.on("chatBubble", () => {
  if (!game.settings.get(MODULE_ID, "enableChat")) return;
  if (!game.settings.get(MODULE_ID, "chat_iconRollMode")) return;

  if (_suppressNextBubble) {
    _suppressNextBubble = false;
    return false;
  }
});
