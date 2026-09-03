# Better Suite

A module for Foundry VTT (v11/v12, dnd5e system) that bundles several UI improvements: a dockable party list, a dice tray, a reworked chat, a decluttered interface, and a combat action bar. Each feature can be enabled or disabled independently.

![presentation image](https://www.maximeocafrain.com/assets/images/projects/vtt.png)

## Features

### Party List

Floating or dockable panel listing connected players with their character, health bar, and connection status. Also includes:

* A featured NPC section, customizable by the GM.
* A personal Notes tab, with a list of accessible journals.
* An Actions tab listing the assigned character's quick actions.
* An image sharing tab for the GM.
* A built in combat tracker (initiative order, current turn, NPC disposition), which automatically replaces the party list during combat.

### Dice Tray

A small floating, collapsible tray for quickly rolling dice without opening a character sheet.

### Reworked Chat

Semi transparent chat background, improved contrast, roll mode selection (public/GM/self/whisper) via icons instead of a dropdown, compact message input.

### Decluttered UI

Hides unnecessary elements of the native interface (logo, scene navigation, macro hotbar) and shrinks the scene control toolbar. The GM can choose which tools stay visible by default.

### Combat Action Bar

A Solasta inspired action bar: attack, spells, powers, items, and generic actions (dodge, hide, disengage, etc.), organized by action type (action, bonus, reaction). Opens automatically at the start of combat.

## Installation

1. Copy the `better-suite` folder into `Data/modules/` of your Foundry installation.
2. Enable the module in **Game Settings > Manage Modules**.

## Settings

A shared accent color and background are configurable for the whole module. Each feature can be toggled independently (requires a page reload), and has its own detailed settings in Foundry's configuration menu.
