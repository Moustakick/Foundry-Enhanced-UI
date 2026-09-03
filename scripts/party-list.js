const MODULE_ID = "better-suite";

/**
 * Application flottante affichant les membres du groupe (avatar + nom)
 * ainsi qu'un onglet de prise de notes personnelles.
 */
class PartyListApp extends Application {
  constructor(options = {}) {
    super(options);
    this._posSaveTimeout = null;
    this._notesSaveTimeout = null;
    this._expanded = game.settings.get(MODULE_ID, "pl_expanded");
    this._dockResizeHandler = null;
    this.options.resizable = game.settings.get(MODULE_ID, "pl_allowResize");
  }

  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "better-party-list-app",
      classes: ["bpl-app"],
      template: `modules/${MODULE_ID}/templates/party-list.hbs`,
      popOut: true,
      minimizable: true,
      resizable: true,
      width: 260,
      height: "auto",
      top: 100,
      left: 20,
      tabs: [{ navSelector: ".bpl-tabs", contentSelector: ".bpl-panels", initial: "party" }]
    });
  }

  /** Titre dynamique : "GROUPE (n)" normalement, infos de round pendant un combat */
  get title() {
    const combat = game.combats?.active;
    if (combat && combat.combatants?.size) {
      return `${game.i18n.localize("BPL.Combat.Title").toUpperCase()} — ${game.i18n.localize("BPL.Combat.Round")} ${combat.round}`;
    }
    return `${game.i18n.localize("BPL.Title").toUpperCase()} (${this._memberCount ?? 0})`;
  }

  /** @override - Ajoute le bouton d'agrandissement dans l'en-tête */
  _getHeaderButtons() {
    const buttons = super._getHeaderButtons();
    buttons.unshift({
      label: "",
      class: "bpl-toggle-expand",
      icon: this._expanded ? "fas fa-compress" : "fas fa-expand",
      onclick: () => this._toggleExpand()
    });
    return buttons;
  }

  /** @override */
  getData(options = {}) {
    const showOffline = game.settings.get(MODULE_ID, "pl_showOffline");
    const showGM = game.settings.get(MODULE_ID, "pl_showGM");
    const isGM = game.user.isGM;

    const users = game.users.contents.filter(u => {
      // Un joueur sans personnage assigné n'est affiché qu'au MJ, pour qu'il
      // puisse justement lui en assigner un (impossible autrement, la player list
      // native étant masquée). Un joueur n'a pas besoin de voir les autres joueurs
      // sans personnage dans sa propre liste.
      if (!u.character && !isGM) return false;
      if (!showGM && u.isGM) return false;
      if (!showOffline && !u.active) return false;
      return true;
    });

    const members = users
      .map(u => {
        const actor = u.character;
        let color = u.color;
        if (color && typeof color === "object" && "css" in color) color = color.css;
        return {
          userId: u.id,
          actorId: actor?.id ?? "",
          name: actor?.name ?? u.name,
          playerName: u.name,
          img: actor?.img || "icons/svg/mystery-man.svg",
          color: color ?? null,
          active: u.active,
          isOwn: u.id === game.user.id,
          hasCharacter: !!actor,
          health: this._getHealthBarData(actor)
        };
      })
      .sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    this._memberCount = members.length;

    const rawGallery = isGM ? (game.settings.get(MODULE_ID, "pl_shareGallery") ?? []) : [];
    const gallery = [...rawGallery].reverse(); // le plus récent en premier

    const rawNpcs = game.settings.get(MODULE_ID, "pl_featuredNpcs") ?? [];
    const npcs = rawNpcs.map(n => {
      if (n.type === "actor") {
        const actor = game.actors.get(n.actorId);
        return {
          id: n.id,
          actorId: n.actorId,
          name: actor?.name ?? game.i18n.localize("BPL.Npc.MissingActor"),
          img: actor?.img || "icons/svg/mystery-man.svg",
          missing: !actor
        };
      }
      return { id: n.id, actorId: null, name: n.name, img: n.img || "icons/svg/mystery-man.svg", missing: false };
    });

    const addedActorIds = new Set(npcs.filter(n => n.actorId).map(n => n.actorId));
    const actorOptions = isGM
      ? game.actors.contents
          .filter(a => !addedActorIds.has(a.id))
          .map(a => ({ id: a.id, name: a.name }))
          .sort((a, b) => a.name.localeCompare(b.name))
      : [];

    const combat = this._getCombatData(isGM);
    const actionBar = this._getActionBarData();
    const journals = this._getVisibleJournals();

    return {
      members,
      notes: game.settings.get(MODULE_ID, "pl_notes"),
      isGM,
      gallery,
      npcs,
      actorOptions,
      showNpcSection: npcs.length > 0 || isGM,
      combat,
      actionBar,
      journals
    };
  }

  /**
   * Construit les données du carrousel d'initiative pour le combat actif, le cas
   * échéant. Retourne null hors combat, ce qui fait automatiquement basculer le
   * template vers l'affichage normal de la liste des joueurs.
   */
  _getCombatData(isGM) {
    const combat = game.combats?.active;
    if (!combat || !combat.combatants?.size) return null;

    const currentCombatantId = combat.combatant?.id ?? null;
    const dispositionLabels = {
      [CONST.TOKEN_DISPOSITIONS.HOSTILE]: "hostile",
      [CONST.TOKEN_DISPOSITIONS.NEUTRAL]: "neutral",
      [CONST.TOKEN_DISPOSITIONS.FRIENDLY]: "friendly",
      [CONST.TOKEN_DISPOSITIONS.SECRET]: "secret"
    };

    const turns = combat.turns
      .filter(c => isGM || !c.hidden)
      .map(c => {
        const ownerUser = game.users.find(u => u.character?.id === c.actor?.id);
        const isPlayerControlled = !!ownerUser || !!c.actor?.hasPlayerOwner;

        // Indicateur de disposition (neutre/amical/secret/hostile), uniquement
        // pertinent pour les PNJ (pas pour les personnages des joueurs). Un
        // adversaire en disposition "secrète" est affiché comme hostile aux
        // joueurs (pour ne pas révéler l'info), mais avec sa vraie icône pour le MJ.
        let disposition = null;
        if (!isPlayerControlled) {
          const raw = c.token?.disposition ?? c.actor?.prototypeToken?.disposition ?? null;
          if (raw !== null) {
            disposition = raw === CONST.TOKEN_DISPOSITIONS.SECRET && !isGM
              ? "hostile"
              : (dispositionLabels[raw] ?? null);
          }
        }

        return {
          id: c.id,
          actorId: c.actor?.id ?? "",
          userId: ownerUser?.id ?? "",
          name: c.name || game.i18n.localize("BPL.Combat.Unknown"),
          img: c.img || "icons/svg/mystery-man.svg",
          initiative: c.initiative === null || c.initiative === undefined ? "—" : c.initiative,
          defeated: !!c.isDefeated,
          isCurrentTurn: c.id === currentCombatantId,
          isOwn: !!c.actor?.id && c.actor.id === game.user.character?.id,
          disposition,
          health: this._getHealthBarData(c.actor, c.token)
        };
      });

    return {
      round: combat.round,
      turns,
      hasMissingInitiative: combat.combatants.some(c => c.initiative === null || c.initiative === undefined),
      isMyTurn: turns.some(t => t.isCurrentTurn && t.isOwn)
    };
  }

  /**
   * Calcule les données de la barre de vie (valeur/max/pourcentage) pour un acteur,
   * en respectant les règles de visibilité natives de Foundry : le mode d'affichage
   * des barres du jeton (displayBars) combiné aux permissions du joueur actuel sur
   * l'acteur. Retourne null si aucune barre n'est configurée ou si le joueur actuel
   * n'est pas autorisé à la voir — le template masque alors simplement la barre.
   * Priorise un jeton placé sur la scène courante (config spécifique à ce jeton),
   * et retombe sur le jeton prototype de l'acteur si aucun n'est placé.
   */
  _getHealthBarData(actor, tokenDoc = null) {
    if (!actor) return null;

    const doc = tokenDoc ?? canvas.tokens?.placeables.find(t => t.actor?.id === actor.id)?.document ?? actor.prototypeToken;
    if (!doc?.getBarAttribute) return null;

    if (!this._canSeeHealthBar(doc, actor)) return null;

    const bar = doc.getBarAttribute("bar1");
    if (!bar || typeof bar.value !== "number" || !bar.max) return null;

    const percent = Math.max(0, Math.min(100, Math.round((bar.value / bar.max) * 100)));
    const color = percent > 50 ? "#59c97a" : percent > 25 ? "#d9c26a" : "#e8615c";
    return { value: bar.value, max: bar.max, percent, color };
  }

  /** Reproduit la logique native de Foundry pour décider qui peut voir la barre d'un jeton */
  _canSeeHealthBar(tokenDoc, actor) {
    const DM = CONST.TOKEN_DISPLAY_MODES;
    const mode = tokenDoc.displayBars ?? DM.NONE;
    if (mode === DM.NONE) return false;
    if (game.user.isGM) return true;
    if (mode === DM.ALWAYS) return true;
    const isOwner = actor?.testUserPermission?.(game.user, "OWNER") ?? false;
    if (mode === DM.OWNER || mode === DM.OWNER_HOVER || mode === DM.CONTROL) return isOwner;
    if (mode === DM.HOVER) return true; // dans une liste statique, assimilé à "visible"
    return false;
  }

  /* -------------------------------------------- */
  /*  Onglet Actions (spécifique au système dnd5e) */
  /* -------------------------------------------- */

  /**
   * Détermine si un objet de la fiche fait partie du jeu d'actions "par défaut" :
   * - armes/équipement : doit être équipé
   * - consommables (potions, parchemins...) : toujours utilisables
   * - aptitudes (feat) : seulement celles avec une économie d'action définie
   *   (Action/Bonus/Réaction/Autre), pour ne pas polluer avec les traits passifs
   * - sorts : seulement les préparés, ou toujours utilisables (cantrips, "at will",
   *   innés, pacte...)
   * Heuristique pensée pour dnd5e — peut nécessiter un ajustement mineur selon la
   * version exacte du système ou pour d'autres systèmes de jeu.
   */
  _isDefaultActionItem(item) {
    const type = item.type;

    if (type === "spell") {
      const prep = item.system?.preparation;
      if (!prep) return false;
      const alwaysUsable = ["always", "atwill", "innate", "pact"].includes(prep.mode);
      return alwaysUsable || !!prep.prepared;
    }

    if (type === "feat") {
      const activationType = item.system?.activation?.type;
      return !!activationType && activationType !== "none";
    }

    if (type === "weapon" || type === "equipment") {
      return item.system?.equipped === true;
    }

    if (type === "consumable") {
      return true;
    }

    return false;
  }

  /** Calcule la liste par défaut (ids d'objets) pour l'acteur donné */
  _getDefaultActionItemIds(actor) {
    if (!actor) return [];
    return actor.items.filter(item => this._isDefaultActionItem(item)).map(i => i.id);
  }

  /**
   * Construit les données de l'onglet Actions (et de la version compacte affichée
   * pendant le combat) pour le personnage assigné à l'utilisateur actuel. Chaque
   * joueur ne voit que SES PROPRES actions ; retourne null si aucun personnage
   * n'est assigné (typiquement le cas du MJ).
   */
  _getActionBarData() {
    const actor = game.user.character;
    if (!actor) return null;

    const stored = game.settings.get(MODULE_ID, "pl_actionBars") ?? {};
    const itemIds = stored[actor.id] ?? this._getDefaultActionItemIds(actor);

    const collapsed = new Set(game.settings.get(MODULE_ID, "pl_collapsedActionCategories") ?? []);

    const CATEGORY_DEFS = {
      weapon: "BPL.Actions.Category.Weapon",
      equipment: "BPL.Actions.Category.Equipment",
      consumable: "BPL.Actions.Category.Consumable",
      feat: "BPL.Actions.Category.Feat",
      spell: "BPL.Actions.Category.Spell",
      other: "BPL.Actions.Category.Other"
    };
    const categories = {};
    for (const [key, labelKey] of Object.entries(CATEGORY_DEFS)) {
      categories[key] = { key, label: game.i18n.localize(labelKey), items: [] };
    }

    // Regroupement secondaire par économie d'action (Action/Bonus/Réaction/Autre),
    // utilisé spécifiquement par la vue compacte affichée pendant le combat — c'est
    // ce classement-là qui compte au moment de jouer son tour, plutôt que le type
    // d'objet utilisé par l'onglet Actions complet.
    const ACTION_TYPE_ORDER = ["action", "bonus", "reaction", "other"];
    const byType = {};
    for (const key of ACTION_TYPE_ORDER) {
      byType[key] = { key, label: game.i18n.localize(`BPL.Actions.Type.${key}`), items: [] };
    }

    for (const id of itemIds) {
      const item = actor.items.get(id);
      if (!item) continue; // objet retiré de la fiche depuis

      const activationType = item.system?.activation?.type;
      const actionType = ["action", "bonus", "reaction"].includes(activationType) ? activationType : "other";

      let uses = null;
      if (item.type === "spell") {
        const level = item.system?.level ?? 0;
        if (level > 0) {
          const slot = actor.system?.spells?.[`spell${level}`];
          if (slot && typeof slot.max === "number" && slot.max > 0) {
            uses = `${slot.value ?? 0}/${slot.max}`;
          }
        }
      } else {
        const u = item.system?.uses;
        if (u && typeof u.max === "number" && u.max > 0) {
          uses = `${u.value ?? 0}/${u.max}`;
        }
      }

      const tooltip = this._stripHtmlSummary(item.system?.description?.value) || item.name;

      const entry = { id: item.id, name: item.name, img: item.img, actionType, uses, tooltip };
      (categories[item.type] ?? categories.other).items.push(entry);
      byType[actionType].items.push(entry);
    }

    const categoryList = Object.values(categories)
      .filter(c => c.items.length)
      .map(c => ({ ...c, collapsed: collapsed.has(c.key) }));

    const byActionType = ACTION_TYPE_ORDER.map(k => byType[k]).filter(g => g.items.length);

    return {
      actorId: actor.id,
      categories: categoryList,
      byActionType,
      isEmpty: categoryList.length === 0
    };
  }

  /** Convertit une description HTML en résumé texte court, pour la bulle au survol */
  _stripHtmlSummary(html, maxLen = 160) {
    if (!html) return "";
    const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    return text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;
  }

  /** Utilise (active) un objet de la liste d'actions rapides */
  _useActionItem(itemId) {
    const actor = game.user.character;
    const item = actor?.items.get(itemId);
    if (!item) return;
    try {
      if (typeof item.use === "function") item.use({}, {});
      else if (typeof item.roll === "function") item.roll();
      else ui.notifications.warn(game.i18n.localize("BPL.Actions.UseError"));
    } catch (err) {
      console.error("Better Party List | Échec de l'utilisation de l'objet", err);
      ui.notifications.warn(game.i18n.localize("BPL.Actions.UseError"));
    }
  }

  /** Applique une fonction de transformation à la liste d'actions du personnage actuel et sauvegarde */
  async _updateActionBar(mutator) {
    const actor = game.user.character;
    if (!actor) return;
    const stored = foundry.utils.deepClone(game.settings.get(MODULE_ID, "pl_actionBars") ?? {});
    const current = stored[actor.id] ?? this._getDefaultActionItemIds(actor);
    stored[actor.id] = mutator(current);
    await game.settings.set(MODULE_ID, "pl_actionBars", stored);
    this.render(false);
  }

  /** Retire un objet de la liste d'actions rapides */
  _removeActionItem(itemId) {
    this._updateActionBar(list => list.filter(id => id !== itemId));
  }

  /** Réinitialise la liste d'actions rapides à son calcul par défaut */
  _resetActionBar() {
    const actor = game.user.character;
    if (!actor) return;
    const stored = foundry.utils.deepClone(game.settings.get(MODULE_ID, "pl_actionBars") ?? {});
    delete stored[actor.id];
    game.settings.set(MODULE_ID, "pl_actionBars", stored).then(() => this.render(false));
  }

  /** Bascule le repli/dépli d'une catégorie de l'onglet Actions */
  async _toggleActionCategory(key) {
    const collapsed = new Set(game.settings.get(MODULE_ID, "pl_collapsedActionCategories") ?? []);
    if (collapsed.has(key)) collapsed.delete(key);
    else collapsed.add(key);
    await game.settings.set(MODULE_ID, "pl_collapsedActionCategories", Array.from(collapsed));
    this.render(false);
  }

  /**
   * Gère le dépôt d'un objet glissé depuis la fiche du personnage actuel (pas
   * l'onglet Acteurs) sur l'onglet Actions, pour l'ajouter à la liste rapide.
   */
  async _onDropActionItem(ev, dropTarget) {
    ev.preventDefault();
    dropTarget.removeClass("bpl-drag-over");

    let data;
    try {
      data = JSON.parse(ev.originalEvent.dataTransfer.getData("text/plain"));
    } catch (err) {
      return;
    }
    if (data?.type !== "Item") return;

    const item = data.uuid ? await fromUuid(data.uuid) : null;
    const actor = game.user.character;
    if (!item || !actor || item.parent?.id !== actor.id) {
      ui.notifications.warn(game.i18n.localize("BPL.Actions.DropWrongActor"));
      return;
    }

    await this._updateActionBar(list => (list.includes(item.id) ? list : [...list, item.id]));
  }

  /** Liste des journaux que l'utilisateur actuel peut voir/ouvrir (comme dans l'onglet Journal natif) */
  _getVisibleJournals() {
    return game.journal.contents
      .filter(j => j.visible)
      .map(j => ({ id: j.id, name: j.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** @override */
  async _render(force = false, options = {}) {
    await super._render(force, options);
    this.element.find(".window-title").text(this.title);
    this._updateExpandButton();
    this._applyDockState();

    // Garde le combattant du tour en cours visible sans avoir à scroller manuellement
    const currentTurnEl = this.element[0]?.querySelector(".bpl-current-turn");
    if (currentTurnEl) currentTurnEl.scrollIntoView({ block: "nearest" });
  }

  /**
   * @override
   * Le changement d'onglet via les contrôleurs Tabs de Foundry est une opération
   * purement cliente (aucun appel à render()/setPosition()) : si la hauteur de la
   * fenêtre avait été "figée" par le contenu de l'onglet précédemment actif (mode
   * flottant, hauteur "auto"), un onglet différent (ex. Notes, avec sa répartition
   * flex Notes/Journaux) peut se retrouver compressé dans cet espace insuffisant
   * tant qu'aucun nouveau calcul de position n'est déclenché. On force donc un
   * recalcul de la hauteur à chaque changement d'onglet.
   */
  _onChangeTab(event, tabs, active) {
    super._onChangeTab(event, tabs, active);
    if (this._expanded) {
      this.setPosition({ height: window.innerHeight });
    } else {
      this.setPosition({ height: "auto" });
    }
  }

  /** Centre la caméra sur le jeton associé à un utilisateur donné (avec un ping) */
  _panToUserToken(userId, fallbackActorId) {
    const user = game.users.get(userId);
    const targetActorId = user?.character?.id ?? fallbackActorId;
    const token = canvas.tokens?.placeables.find(t => t.actor?.id === targetActorId);
    if (token) {
      canvas.animatePan({ x: token.center.x, y: token.center.y });
      canvas.ping?.(token.center);
    }
  }

  /**
   * MJ uniquement : ouvre une boîte de dialogue pour assigner (ou changer) le
   * personnage lié à un joueur — équivalent de ce que proposait la player list
   * native de Foundry (masquée par ce module), donc indispensable pour ne pas
   * perdre cette fonctionnalité.
   */
  _changeUserCharacter(userId) {
    const user = game.users.get(userId);
    if (!user) return;

    const currentId = user.character?.id ?? "";
    const options = game.actors.contents
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(a => `<option value="${a.id}" ${a.id === currentId ? "selected" : ""}>${a.name}</option>`)
      .join("");

    const content = `
      <div class="form-group">
        <label>${game.i18n.localize("BPL.Member.ChangeCharacterLabel")}</label>
        <select name="bpl-actor-select" style="width:100%;">
          <option value="">${game.i18n.localize("BPL.Member.NoCharacter")}</option>
          ${options}
        </select>
      </div>
    `;

    new Dialog({
      title: game.i18n.format("BPL.Member.ChangeCharacterTitle", { name: user.name }),
      content,
      buttons: {
        save: {
          icon: '<i class="fas fa-check"></i>',
          label: game.i18n.localize("BPL.Member.Save"),
          callback: html => {
            const actorId = html.find('select[name="bpl-actor-select"]').val();
            user.update({ character: actorId || null });
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: game.i18n.localize("BPL.Member.Cancel")
        }
      },
      default: "save"
    }).render(true);
  }

  /**
   * Fait avancer le combat au tour suivant (MJ : bouton "tour suivant" ; joueur :
   * bouton "terminer mon tour", actif uniquement si c'est son tour). La permission
   * réelle est vérifiée par Foundry lui-même : si le MJ n'a pas explicitement
   * autorisé les joueurs à modifier le combat, l'appel échoue proprement et on
   * affiche un message clair plutôt que l'erreur brute de Foundry.
   */
  async _advanceCombat() {
    try {
      await game.combats?.active?.nextTurn();
    } catch (err) {
      console.warn("Better Party List | Impossible de faire avancer le combat", err);
      ui.notifications.warn(game.i18n.localize("BPL.Combat.NoPermission"));
    }
  }

  /** MJ uniquement (bouton visible seulement pour lui) : revient au tour précédent */
  async _rewindCombat() {
    try {
      await game.combats?.active?.previousTurn();
    } catch (err) {
      console.warn("Better Party List | Impossible de reculer le combat", err);
    }
  }

  /** MJ uniquement : lance l'initiative pour tous les combattants qui n'en ont pas encore */
  async _rollMissingInitiative() {
    try {
      await game.combats?.active?.rollAll();
    } catch (err) {
      console.warn("Better Party List | Échec du lancer d'initiative groupé", err);
    }
  }

  /** MJ uniquement : termine le combat actif, après confirmation */
  async _endCombat() {
    const combat = game.combats?.active;
    if (!combat) return;

    const confirmed = await Dialog.confirm({
      title: game.i18n.localize("BPL.Combat.EndCombatConfirmTitle"),
      content: `<p>${game.i18n.localize("BPL.Combat.EndCombatConfirmContent")}</p>`
    });
    if (!confirmed) return;

    try {
      await combat.delete();
    } catch (err) {
      console.warn("Better Party List | Impossible de terminer le combat", err);
      ui.notifications.warn(game.i18n.localize("BPL.Combat.NoPermission"));
    }
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);

    // Clic sur un membre : sa propre fiche s'ouvre normalement, tout comme celle
    // de n'importe quel personnage pour le MJ. Pour un joueur cliquant sur le
    // personnage d'un autre, on se contente de centrer la caméra sur son jeton.
    html.find(".bpl-member").on("click", ev => {
      const { actorId, userId } = ev.currentTarget.dataset;
      if (userId === game.user.id || game.user.isGM) {
        const actor = game.actors.get(actorId);
        actor?.sheet?.render(true);
      } else {
        this._panToUserToken(userId, actorId);
      }
    });

    html.find(".bpl-member").on("contextmenu", ev => {
      ev.preventDefault();
      const { actorId, userId } = ev.currentTarget.dataset;
      this._panToUserToken(userId, actorId);
    });

    // MJ uniquement : bouton (apparaît au survol) pour assigner/changer le
    // personnage lié à un joueur.
    html.find(".bpl-member-assign").on("click", ev => {
      ev.stopPropagation();
      this._changeUserCharacter(ev.currentTarget.dataset.userId);
    });

    // Carrousel de combat : clic sur un combattant = centrer la caméra (même logique
    // que pour les membres du groupe, la fiche ne s'ouvre pas pour ne pas gêner le
    // rythme du combat).
    html.find(".bpl-combatant").on("click", ev => {
      const { actorId, userId } = ev.currentTarget.dataset;
      this._panToUserToken(userId, actorId);
    });

    html.find(".bpl-combat-next").on("click", () => this._advanceCombat());
    html.find(".bpl-combat-prev").on("click", () => this._rewindCombat());
    html.find(".bpl-combat-roll-missing").on("click", () => this._rollMissingInitiative());
    html.find(".bpl-combat-end").on("click", () => this._endCombat());

    // Onglet Actions : clic = utiliser, clic sur "x" = retirer, clic sur l'en-tête
    // d'une catégorie = replier/déplier. Ces mêmes classes sont réutilisées dans la
    // vue compacte affichée pendant le combat, donc ces écouteurs couvrent les deux.
    html.find(".bpl-action-item").on("click", ev => {
      if (ev.target.closest(".bpl-action-remove")) return;
      this._useActionItem(ev.currentTarget.dataset.itemId);
    });

    html.find(".bpl-action-remove").on("click", ev => {
      ev.stopPropagation();
      this._removeActionItem(ev.currentTarget.dataset.itemId);
    });

    html.find(".bpl-action-category-header").on("click", ev => {
      this._toggleActionCategory(ev.currentTarget.dataset.category);
    });

    html.find(".bpl-actions-reset").on("click", () => this._resetActionBar());

    // Glisser-déposer un objet depuis SA PROPRE fiche de personnage vers l'onglet
    // Actions, pour l'ajouter à la liste rapide.
    const actionsTab = html.find(".bpl-tab-actions");
    actionsTab.on("dragover", ev => {
      ev.preventDefault();
      actionsTab.addClass("bpl-drag-over");
    });
    actionsTab.on("dragleave", () => actionsTab.removeClass("bpl-drag-over"));
    actionsTab.on("drop", ev => this._onDropActionItem(ev, actionsTab));

    // Clic sur un journal : ouvre sa fiche
    html.find(".bpl-journal-item").on("click", ev => {
      const id = ev.currentTarget.dataset.journalId;
      game.journal.get(id)?.sheet?.render(true);
    });

    // Créer un nouveau journal (MJ) et ouvrir directement sa fiche pour édition
    html.find(".bpl-journal-add").on("click", async () => {
      const entry = await JournalEntry.create({ name: game.i18n.localize("BPL.Notes.NewJournalName") });
      entry?.sheet?.render(true);
    });

    // Prise de notes personnelles : sauvegarde différée (debounce)
    const notesInput = html.find(".bpl-notes-input");
    notesInput.on("input", ev => {
      const value = ev.currentTarget.value;
      clearTimeout(this._notesSaveTimeout);
      this._notesSaveTimeout = setTimeout(() => {
        game.settings.set(MODULE_ID, "pl_notes", value);
      }, 500);
    });

    // Ouvrir une image de la galerie (tout le monde peut la revoir en grand)
    html.find(".bpl-share-thumb").on("click", ev => {
      const { img, title } = ev.currentTarget.dataset;
      new ImagePopout(img, { title, shareable: game.user.isGM }).render(true);
    });

    // Clic sur un PNJ en vedette : ouvre la fiche (acteur lié) ou l'image en grand (PNJ rapide)
    html.find(".bpl-npc").on("click", ev => {
      if (ev.target.closest(".bpl-npc-remove")) return;
      const { actorId, img, name } = ev.currentTarget.dataset;
      if (actorId) {
        game.actors.get(actorId)?.sheet?.render(true);
      } else {
        new ImagePopout(img, { title: name, shareable: game.user.isGM }).render(true);
      }
    });

    if (game.user.isGM) {
      html.find(".bpl-npc-remove").on("click", ev => {
        ev.stopPropagation();
        this._removeNpc(ev.currentTarget.dataset.npcId);
      });

      html.find(".bpl-npc-add-toggle").on("click", () => {
        html.find(".bpl-npc-add-panel").toggleClass("bpl-open");
      });

      html.find(".bpl-npc-quick-img").on("click", ev => {
        const target = ev.currentTarget;
        new FilePicker({
          type: "image",
          current: target.dataset.img,
          callback: path => {
            target.dataset.img = path;
            target.style.backgroundImage = `url('${path}')`;
          }
        }).render(true);
      });

      html.find(".bpl-npc-add-actor").on("click", async () => {
        const select = html.find(".bpl-npc-actor-select")[0];
        const actorId = select?.value;
        if (!actorId) return;
        await this._addNpc({ id: foundry.utils.randomID(), type: "actor", actorId });
      });

      html.find(".bpl-npc-add-quick").on("click", async ev => {
        const panel = html.find(".bpl-npc-add-panel");
        const nameInput = panel.find(".bpl-npc-quick-name")[0];
        const imgDiv = panel.find(".bpl-npc-quick-img")[0];
        const name = nameInput.value.trim();
        if (!name) {
          ui.notifications.warn(game.i18n.localize("BPL.Npc.NameRequired"));
          return;
        }
        const img = imgDiv.dataset.img || "icons/svg/mystery-man.svg";
        await this._addNpc({ id: foundry.utils.randomID(), type: "custom", name, img });
      });

      // Glisser-déposer un acteur depuis l'onglet "Acteurs" de Foundry : l'ajoute
      // directement à la section PNJ en vedette.
      const partyTab = html.find(".bpl-tab-party");
      partyTab.on("dragover", ev => {
        ev.preventDefault();
        partyTab.addClass("bpl-drag-over");
      });
      partyTab.on("dragleave", () => partyTab.removeClass("bpl-drag-over"));
      partyTab.on("drop", ev => this._onDropActor(ev, partyTab));

      const dropzone = html.find(".bpl-share-dropzone");

      dropzone.on("dragover", ev => {
        ev.preventDefault();
        dropzone.addClass("bpl-drag-hover");
      });
      dropzone.on("dragleave", () => dropzone.removeClass("bpl-drag-hover"));
      dropzone.on("drop", ev => this._onDropShareItem(ev));

      html.find(".bpl-share-file-input").on("change", ev => {
        this._handleShareFiles(ev.currentTarget.files);
        ev.currentTarget.value = "";
      });

      html.find(".bpl-share-resend").on("click", ev => {
        ev.stopPropagation();
        const { img, title } = ev.currentTarget.dataset;
        this._shareToPlayers(img, title);
      });

      html.find(".bpl-share-thumb").on("contextmenu", ev => {
        ev.preventDefault();
        this._removeFromGallery(ev.currentTarget.dataset.img);
      });
    }
  }

  /** Gère un dépôt (drag & drop) dans la zone de partage : fichier local ou image glissée depuis une autre appli/onglet */
  _onDropShareItem(ev) {
    ev.preventDefault();
    ev.currentTarget.classList.remove("bpl-drag-hover");
    const dt = ev.originalEvent?.dataTransfer;
    if (!dt) return;

    if (dt.files?.length) {
      this._handleShareFiles(dt.files);
      return;
    }

    const url = (dt.getData("text/uri-list") || dt.getData("text/plain") || "").trim();
    if (/^https?:\/\//i.test(url)) {
      this._shareImageUrl(url);
    } else {
      ui.notifications.warn(game.i18n.localize("BPL.Share.NoValidImage"));
    }
  }

  /** Traite une liste de fichiers déposés/sélectionnés en ne gardant que les images */
  async _handleShareFiles(fileList) {
    const files = Array.from(fileList ?? []).filter(f => f.type.startsWith("image/"));
    if (!files.length) {
      ui.notifications.warn(game.i18n.localize("BPL.Share.NoValidImage"));
      return;
    }
    for (const file of files) {
      await this._shareImageFile(file);
    }
  }

  /** Envoie un fichier image local sur le serveur puis le partage aux joueurs */
  async _shareImageFile(file) {
    const folder = `worlds/${game.world.id}/better-party-list`;
    try {
      await FilePicker.createDirectory("data", folder);
    } catch (err) {
      // Le dossier existe déjà : on ignore silencieusement l'erreur.
    }

    let response;
    try {
      response = await FilePicker.upload("data", folder, file, {}, { notify: false });
    } catch (err) {
      console.error("Better Party List | Échec de l'envoi de l'image", err);
    }

    if (!response?.path) {
      ui.notifications.error(game.i18n.localize("BPL.Share.UploadError"));
      return;
    }

    const title = file.name.replace(/\.[^/.]+$/, "");
    await this._addToGallery(response.path, title);
    this._shareToPlayers(response.path, title);
  }

  /** Partage directement une image distante (glissée depuis un navigateur/une autre appli) sans upload */
  async _shareImageUrl(url) {
    let title = "Image";
    try {
      const last = decodeURIComponent(url.split("/").pop().split("?")[0]);
      if (last) title = last.replace(/\.[^/.]+$/, "");
    } catch (err) {
      // on garde le titre par défaut
    }
    await this._addToGallery(url, title);
    this._shareToPlayers(url, title);
  }

  /** Diffuse immédiatement une image à tous les joueurs connectés via l'API native de Foundry */
  _shareToPlayers(img, title) {
    const popout = new ImagePopout(img, { title, shareable: true });
    popout.render(true);
    popout.share();
    ui.notifications.info(game.i18n.format("BPL.Share.Shared", { title }));
  }

  /** Ajoute une entrée à l'historique partagé (réglage "world", visible par tous) */
  async _addToGallery(img, title) {
    const gallery = foundry.utils.deepClone(game.settings.get(MODULE_ID, "pl_shareGallery") ?? []);
    gallery.push({ img, title, timestamp: Date.now() });
    while (gallery.length > 30) gallery.shift();
    await game.settings.set(MODULE_ID, "pl_shareGallery", gallery);
  }

  /** Retire une image de l'historique partagé (clic droit, MJ uniquement) */
  async _removeFromGallery(img) {
    const gallery = foundry.utils.deepClone(game.settings.get(MODULE_ID, "pl_shareGallery") ?? [])
      .filter(g => g.img !== img);
    await game.settings.set(MODULE_ID, "pl_shareGallery", gallery);
  }

  /**
   * Gère le dépôt (drag & drop) d'un acteur glissé depuis l'onglet "Acteurs" natif
   * de Foundry : l'ajoute à la section PNJ en vedette. Foundry attache les données
   * de glisser-déposer d'un document au format JSON standard {type, uuid} sur
   * l'événement dragstart natif.
   */
  async _onDropActor(ev, partyTab) {
    ev.preventDefault();
    partyTab.removeClass("bpl-drag-over");

    let data;
    try {
      data = JSON.parse(ev.originalEvent.dataTransfer.getData("text/plain"));
    } catch (err) {
      return;
    }
    if (data?.type !== "Actor") return;

    const actor = data.uuid ? await fromUuid(data.uuid) : game.actors.get(data.id);
    if (!actor) return;

    const existing = game.settings.get(MODULE_ID, "pl_featuredNpcs") ?? [];
    if (existing.some(n => n.actorId === actor.id)) {
      ui.notifications.info(game.i18n.format("BPL.Npc.AlreadyAdded", { name: actor.name }));
      return;
    }

    await this._addNpc({ id: foundry.utils.randomID(), type: "actor", actorId: actor.id });
  }

  /** Ajoute un PNJ (lié à un acteur, ou "rapide" avec nom + image) à la section sous les joueurs */
  async _addNpc(entry) {
    const list = foundry.utils.deepClone(game.settings.get(MODULE_ID, "pl_featuredNpcs") ?? []);
    list.push(entry);
    await game.settings.set(MODULE_ID, "pl_featuredNpcs", list);
  }

  /** Retire un PNJ de la section (MJ uniquement) */
  async _removeNpc(id) {
    const list = foundry.utils.deepClone(game.settings.get(MODULE_ID, "pl_featuredNpcs") ?? [])
      .filter(n => n.id !== id);
    await game.settings.set(MODULE_ID, "pl_featuredNpcs", list);
  }

  /** @override - Sauvegarde position/taille du panneau côté client (uniquement en mode flottant) */
  setPosition(pos = {}) {
    const newPos = super.setPosition(pos);
    if (newPos && !this._expanded) {
      clearTimeout(this._posSaveTimeout);
      this._posSaveTimeout = setTimeout(() => {
        game.settings.set(MODULE_ID, "pl_position", {
          top: newPos.top,
          left: newPos.left,
          width: newPos.width,
          height: newPos.height
        });
      }, 400);
    }
    return newPos;
  }

  /** @override - Mémorise l'état réduit/déplié (quel que soit le déclencheur) */
  async minimize() {
    await super.minimize();
    game.settings.set(MODULE_ID, "pl_minimized", true);
  }

  /** @override */
  async maximize() {
    await super.maximize();
    game.settings.set(MODULE_ID, "pl_minimized", false);
  }

  /** Bascule entre mode flottant (déplaçable) et mode "ancré" plein écran à gauche */
  async _toggleExpand() {
    this._expanded = !this._expanded;
    await game.settings.set(MODULE_ID, "pl_expanded", this._expanded);

    if (!this._expanded) {
      const saved = game.settings.get(MODULE_ID, "pl_position") ?? {};
      await this.setPosition({
        top: saved.top ?? 100,
        left: saved.left ?? 20,
        width: saved.width ?? 260,
        height: saved.height ?? "auto"
      });
    }

    this._applyDockState();
    this._updateExpandButton();
  }

  /**
   * Applique (ou retire) l'état d'ancrage plein écran en fonction de this._expanded.
   * Appelé à chaque rendu (y compris après une réouverture) pour rester cohérent
   * même si Foundry reconstruit entièrement la fenêtre.
   */
  _applyDockState() {
    if (this._expanded) {
      this.element.addClass("bpl-docked");
      const width = game.settings.get(MODULE_ID, "pl_dockedWidth") ?? 280;

      // Deux appels séparés à setPosition : certaines versions de Foundry calculent la
      // hauteur maximale autorisée à partir de l'ancien "top" avant sa mise à jour, ce
      // qui pouvait bloquer la fenêtre à l'ancienne hauteur flottante lors d'un tout
      // premier ancrage (bug corrigé ici). On force ensuite la valeur directement en
      // CSS par sécurité, indépendamment de ce que Foundry a calculé en interne.
      this.setPosition({ top: 0, left: 0, width });
      this.setPosition({ height: window.innerHeight });
      this.element[0].style.top = "0px";
      this.element[0].style.height = `${window.innerHeight}px`;

      this._attachDockResizeListener();
      this._ensureDockResizeHandle();
      this._shiftControls(width);
    } else {
      this.element.removeClass("bpl-docked");
      this._detachDockResizeListener();
      this._unshiftControls();
    }
  }

  /**
   * Repousse la barre d'outils de scène (#ui-left) ET le navigateur de scènes
   * (#navigation) à droite du panneau ancré. On passe par une classe sur <body> +
   * une variable CSS plutôt que par un style inline direct, car ces éléments ne
   * sont pas forcément positionnés individuellement et une règle du cœur de
   * Foundry peut avoir priorité sur un simple style inline.
   */
  _shiftControls(width) {
    document.documentElement.style.setProperty("--bpl-dock-offset", `${width + 10}px`);
    document.body.classList.add("bpl-controls-shifted");
  }

  _unshiftControls() {
    document.body.classList.remove("bpl-controls-shifted");
  }

  _attachDockResizeListener() {
    if (this._dockResizeHandler) return;
    this._dockResizeHandler = () => {
      if (this._expanded && this.rendered) this.setPosition({ height: window.innerHeight });
    };
    window.addEventListener("resize", this._dockResizeHandler);
  }

  _detachDockResizeListener() {
    if (!this._dockResizeHandler) return;
    window.removeEventListener("resize", this._dockResizeHandler);
    this._dockResizeHandler = null;
  }

  /** Crée (une seule fois) la poignée de redimensionnement en largeur du mode ancré */
  _ensureDockResizeHandle() {
    let handle = this.element.find(".bpl-dock-resize-handle");
    if (handle.length) return;
    handle = $('<div class="bpl-dock-resize-handle"></div>');
    handle.on("mousedown", ev => this._startDockResize(ev));
    this.element.append(handle);
  }

  /** Redimensionne la largeur du panneau ancré au glisser-déposer (hauteur/position inchangées) */
  _startDockResize(ev) {
    ev.preventDefault();
    const startX = ev.clientX;
    const startWidth = this.position.width;
    const minWidth = 200;
    const maxWidth = Math.round(window.innerWidth * 0.6);

    const onMove = mv => {
      const newWidth = Math.max(minWidth, Math.min(maxWidth, startWidth + (mv.clientX - startX)));
      this.setPosition({ width: newWidth });
      this._shiftControls(newWidth);
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      game.settings.set(MODULE_ID, "pl_dockedWidth", Math.round(this.position.width));
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  /** Met à jour l'icône et l'infobulle du bouton d'ancrage */
  _updateExpandButton() {
    const btn = this.element.find(".bpl-toggle-expand");
    btn.find("i").attr("class", this._expanded ? "fas fa-compress" : "fas fa-expand");
    btn.attr("title", game.i18n.localize(this._expanded ? "BPL.DockOff" : "BPL.DockOn"));
  }

  /** @override - Empêche tout déplacement à la souris tant que le panneau est ancré */
  _onDragMouseDown(event) {
    if (this._expanded) return;
    return super._onDragMouseDown(event);
  }

  /** @override - Sauvegarde la note en attente avant fermeture et nettoie les écouteurs */
  async close(options) {
    clearTimeout(this._notesSaveTimeout);
    this._detachDockResizeListener();
    this._unshiftControls();

    const notesInput = this.element?.find(".bpl-notes-input");
    if (notesInput?.length) {
      game.settings.set(MODULE_ID, "pl_notes", notesInput.val());
    }
    return super.close(options);
  }
}

/* -------------------------------------------- */
/*  Réglages                                     */
/* -------------------------------------------- */

Hooks.once("init", () => {
  if (!game.settings.get(MODULE_ID, "enablePartyList")) return;

  game.settings.register(MODULE_ID, "pl_showOffline", {
    name: "BPL.Settings.ShowOffline.Name",
    hint: "BPL.Settings.ShowOffline.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => safeRefresh()
  });

  game.settings.register(MODULE_ID, "pl_showGM", {
    name: "BPL.Settings.ShowGM.Name",
    hint: "BPL.Settings.ShowGM.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => safeRefresh()
  });

  game.settings.register(MODULE_ID, "pl_hideDefault", {
    name: "BPL.Settings.HideDefault.Name",
    hint: "BPL.Settings.HideDefault.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: value => document.body.classList.toggle("bpl-hide-default", value)
  });

  game.settings.register(MODULE_ID, "pl_allowResize", {
    name: "BPL.Settings.AllowResize.Name",
    hint: "BPL.Settings.AllowResize.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: value => {
      if (!game.bpl) return;
      game.bpl.options.resizable = value;
      if (game.bpl.rendered) game.bpl.render(true);
    }
  });

  game.settings.register(MODULE_ID, "pl_backgroundOpacity", {
    name: "BPL.Settings.BackgroundOpacity.Name",
    hint: "BPL.Settings.BackgroundOpacity.Hint",
    scope: "client",
    config: true,
    type: Number,
    range: { min: 0, max: 100, step: 5 },
    default: 0,
    onChange: value => applyBackgroundOpacity(value)
  });

  // Réglages internes (non exposés dans le menu de configuration)
  game.settings.register(MODULE_ID, "pl_position", {
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.register(MODULE_ID, "pl_minimized", {
    scope: "client",
    config: false,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, "pl_expanded", {
    scope: "client",
    config: false,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "pl_dockedWidth", {
    scope: "client",
    config: false,
    type: Number,
    default: 280
  });

  // Réglages internes de l'onglet Actions : la liste d'actions rapides par
  // personnage ({ [actorId]: [itemId, ...] }, absence = calcul par défaut), et les
  // catégories actuellement repliées.
  game.settings.register(MODULE_ID, "pl_actionBars", {
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.register(MODULE_ID, "pl_collapsedActionCategories", {
    scope: "client",
    config: false,
    type: Array,
    default: []
  });

  game.settings.register(MODULE_ID, "pl_notes", {
    scope: "client",
    config: false,
    type: String,
    default: ""
  });

  game.settings.register(MODULE_ID, "pl_shareGallery", {
    scope: "world",
    config: false,
    type: Array,
    default: []
  });

  game.settings.register(MODULE_ID, "pl_featuredNpcs", {
    scope: "world",
    config: false,
    type: Array,
    default: []
  });
});

/* -------------------------------------------- */
/*  Rafraîchissement "sûr"                       */
/* -------------------------------------------- */

/**
 * Rafraîchit le panneau sans perturber une saisie de note en cours
 * (évite d'écraser le texte si un joueur est en train d'écrire au moment
 * où un autre joueur se connecte/déconnecte par exemple).
 */
function safeRefresh() {
  const app = game.bpl;
  if (!app?.rendered) return;
  const active = document.activeElement;
  if (active?.classList?.contains("bpl-notes-input")) return;
  app.render(false);
}

/* -------------------------------------------- */
/*  Bouton flottant de réouverture                */
/* -------------------------------------------- */

/**
 * Applique le niveau de transparence choisi par le joueur au fond du panneau
 * (variable CSS partagée par l'en-tête et le contenu de la fenêtre).
 * 0 = totalement transparent (comportement par défaut), 100 = opaque.
 */
function applyBackgroundOpacity(value) {
  const alpha = Math.max(0, Math.min(1, value / 100));
  document.documentElement.style.setProperty("--bpl-bg-alpha", alpha.toFixed(2));
}

function createReopenButton() {
  if (document.getElementById("bpl-reopen-btn")) return;

  const btn = document.createElement("button");
  btn.id = "bpl-reopen-btn";
  btn.type = "button";
  btn.title = game.i18n.localize("BPL.ReopenButton");
  btn.innerHTML = '<i class="fas fa-users"></i>';

  btn.addEventListener("click", () => {
    const app = game.bpl;
    if (!app) return;
    if (app.rendered && !app._minimized) {
      app.close();
    } else if (app.rendered && app._minimized) {
      app.maximize();
    } else {
      app.render(true);
    }
  });

  if (window.BetterSuite?.registerButton) window.BetterSuite.registerButton(btn);
  else document.body.appendChild(btn); // repli si le cœur du suite n'a pas chargé
}

/* -------------------------------------------- */
/*  Cycle de vie                                 */
/* -------------------------------------------- */

Hooks.once("ready", () => {
  if (!game.settings.get(MODULE_ID, "enablePartyList")) return;

  if (game.settings.get(MODULE_ID, "pl_hideDefault")) {
    document.body.classList.add("bpl-hide-default");
  }

  applyBackgroundOpacity(game.settings.get(MODULE_ID, "pl_backgroundOpacity"));

  const savedPos = game.settings.get(MODULE_ID, "pl_position") ?? {};
  const app = new PartyListApp({
    top: savedPos.top ?? 100,
    left: savedPos.left ?? 20,
    width: savedPos.width ?? 260,
    height: savedPos.height ?? "auto"
  });

  game.bpl = app;
  createReopenButton();
  app.render(true);

  Hooks.once("renderPartyListApp", () => {
    if (game.settings.get(MODULE_ID, "pl_minimized")) app.minimize();
  });
});

// Rafraîchit le panneau quand la liste native de Foundry se met à jour
// (connexion/déconnexion, changement de personnage assigné, etc.)
Hooks.on("renderPlayerList", () => safeRefresh());

// Rafraîchit si le personnage d'un membre du groupe (ou un PNJ en vedette lié) est
// modifié — nom/image, mais aussi n'importe quelle donnée système (ex. les PV, pour
// que la barre de vie reste à jour), le chemin exact variant selon le système de jeu.
Hooks.on("updateActor", actor => {
  const isPartyMember = game.users.some(u => u.character?.id === actor.id);
  const npcs = game.settings.get(MODULE_ID, "pl_featuredNpcs") ?? [];
  const isFeaturedNpc = npcs.some(n => n.actorId === actor.id);
  if (isPartyMember || isFeaturedNpc) safeRefresh();
});

// Idem pour les jetons non liés (unlinked) dont les PV sont propres au jeton et non
// à l'acteur — pertinent surtout pour les PNJ en combat.
Hooks.on("updateToken", () => {
  if (game.combats?.active) safeRefresh();
});

Hooks.on("updateUser", () => safeRefresh());

// Rafraîchit l'onglet Actions quand un objet est ajouté/modifié/retiré sur SON PROPRE
// personnage (uses, préparation d'un sort, équipement, ajout d'un nouvel objet...).
function onOwnCharacterItemChange(item) {
  if (item.parent?.id === game.user.character?.id) safeRefresh();
}
Hooks.on("createItem", onOwnCharacterItemChange);
Hooks.on("updateItem", onOwnCharacterItemChange);
Hooks.on("deleteItem", onOwnCharacterItemChange);

// Rafraîchit la liste des journaux visibles (création, suppression, changement de
// permission ou de nom d'un journal).
Hooks.on("createJournalEntry", () => safeRefresh());
Hooks.on("deleteJournalEntry", () => safeRefresh());
Hooks.on("updateJournalEntry", () => safeRefresh());

// Rafraîchit si un acteur lié à un PNJ en vedette est supprimé (affiche alors "Acteur introuvable")
Hooks.on("deleteActor", actor => {
  const npcs = game.settings.get(MODULE_ID, "pl_featuredNpcs") ?? [];
  if (npcs.some(n => n.actorId === actor.id)) safeRefresh();
});

// Rafraîchit tous les clients quand le MJ modifie l'historique d'images ou les PNJ en vedette
Hooks.on("updateSetting", setting => {
  if (setting.key === `${MODULE_ID}.pl_shareGallery` || setting.key === `${MODULE_ID}.pl_featuredNpcs`) {
    safeRefresh();
  }
});

/* -------------------------------------------- */
/*  Rafraîchissement lié au combat               */
/* -------------------------------------------- */

// Démarrage/fin de combat, changement de round ou de tour : le panneau bascule
// automatiquement entre la liste des joueurs et le carrousel d'initiative.
Hooks.on("createCombat", () => safeRefresh());
Hooks.on("deleteCombat", () => safeRefresh());
Hooks.on("updateCombat", () => safeRefresh());

// Hooks dédiés du cycle de vie du combat (en renfort des hooks génériques
// ci-dessus, plus fiables pour capter tous les cas de transition d'état)
Hooks.on("combatStart", () => safeRefresh());
Hooks.on("combatTurn", () => safeRefresh());
Hooks.on("combatRound", () => safeRefresh());

// Ajout/suppression/modification d'un combattant (initiative lancée, etc.)
Hooks.on("createCombatant", () => safeRefresh());
Hooks.on("deleteCombatant", () => safeRefresh());
Hooks.on("updateCombatant", () => safeRefresh());
