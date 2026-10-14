const MODULE_ID = "flanking-bonus";
const STATUS_ID = "flanked";
const STATUS_IMG = "modules/flanking-bonus/icons/flanked.svg";

// Conditions that keep a creature from flanking.
const INCAPACITATED = ["incapacitated", "paralyzed", "petrified", "stunned", "unconscious", "dead"];
const EPSILON = 1e-6;
const { FRIENDLY, HOSTILE } = CONST.TOKEN_DISPOSITIONS;

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "bonus", {
    name: "FLANKING.SettingBonus",
    hint: "FLANKING.SettingBonusHint",
    scope: "world", config: true, type: Number, default: 2
  });
  game.settings.register(MODULE_ID, "showIcon", {
    name: "FLANKING.SettingIcon",
    hint: "FLANKING.SettingIconHint",
    scope: "world", config: true, type: Boolean, default: true,
    onChange: () => queueRefresh()
  });
  game.settings.register(MODULE_ID, "familiarNames", {
    name: "FLANKING.SettingFamiliarNames",
    hint: "FLANKING.SettingFamiliarNamesHint",
    scope: "world", config: true, type: String, default: "Familiar",
    onChange: () => queueRefresh()
  });

  // Runs after the attack parts are built, both for fast-forwarded rolls and on every rebuild of the roll dialog.
  Hooks.on("dnd5e.postBuildAttackRollConfig", addFlankingBonus);

  game.modules.get(MODULE_ID).api = { isFlanking, flankingAlly, isFlanked, isFamiliar, refreshIcons };
});

Hooks.once("ready", () => {
  // Midi-QOL registers a "flanked" status; reuse its icon so the Token HUD shows it as active.
  if (!CONFIG.statusEffects.some(s => s.id === STATUS_ID)) {
    CONFIG.statusEffects.push({ id: STATUS_ID, name: "FLANKING.Flanked", img: STATUS_IMG });
  }
  registerIconHooks();
  queueRefresh();
});

/* -------------------------------------------- */
/*  Attack bonus                                */
/* -------------------------------------------- */

function addFlankingBonus(process, config) {
  const activity = process.subject;
  if (!activity) return;
  if (activity.getActionType?.(config.options?.attackMode) !== "mwak") return;

  const bonus = Number(game.settings.get(MODULE_ID, "bonus")) || 0;
  if (!bonus) return;

  const targets = [...(process.workflow?.targets ?? game.user.targets)];
  if (targets.length !== 1) return;
  const attacker = attackerToken(activity, process.workflow);
  if (!attacker || !isFlanking(attacker, targets[0])) return;

  const label = game.i18n.localize("FLANKING.Label");
  const part = `${bonus}[${label}]`;
  config.parts ??= [];
  if (!config.parts.includes(part)) config.parts.push(part);
}

function attackerToken(activity, workflow) {
  if (workflow?.token) return workflow.token;
  const actor = activity.actor;
  if (!actor) return null;
  if (actor.token) return actor.token;
  const tokens = actor.getActiveTokens(true);
  return tokens.find(t => t.controlled) ?? tokens[0] ?? null;
}

/* -------------------------------------------- */
/*  Rules                                       */
/* -------------------------------------------- */

const docOf = token => token?.document ?? token;

/**
 * Is `attacker` flanking `target`? Both must be adjacent to the target, on opposite sides,
 * with an ally of the attacker (same disposition) that can flank.
 * @param {Token|TokenDocument} attacker
 * @param {Token|TokenDocument} target
 * @returns {boolean}
 */
export function isFlanking(attacker, target) {
  return !!flankingAlly(attacker, target);
}

/** The ally (TokenDocument) that completes the flank, or null. */
export function flankingAlly(attacker, target, familiars = familiarTokenIds()) {
  attacker = docOf(attacker);
  target = docOf(target);
  const scene = target?.parent;
  if (!attacker || !scene || (attacker.parent !== scene) || (attacker === target)) return null;
  if (!inCombat(scene)) return null;
  if (!opposed(attacker, target) || !canFlank(attacker, familiars)) return null;
  if (!isAdjacent(attacker, target)) return null;

  for (const ally of scene.tokens) {
    if ((ally === attacker) || (ally === target)) continue;
    if (ally.disposition !== attacker.disposition) continue;
    if (ally.hidden || !canFlank(ally, familiars)) continue;
    if (!isAdjacent(ally, target)) continue;
    if (onOppositeSides(attacker, ally, target)) return ally;
  }
  return null;
}

/** Is any visible creature flanking `target`? Used for the status icon. */
export function isFlanked(target, familiars = familiarTokenIds()) {
  target = docOf(target);
  if (!inCombat(target.parent)) return false;
  return target.parent.tokens.some(t => !t.hidden && (t !== target) && flankingAlly(t, target, familiars));
}

/** Flanking only counts while a combat has started on the scene (an unlinked combat counts for the active scene). */
function inCombat(scene) {
  return game.combats.some(c => c.started && (c.scene ? (c.scene === scene) : scene.active));
}

/** Flanking only happens between Friendly and Hostile tokens. */
function opposed(a, b) {
  const sides = [FRIENDLY, HOSTILE];
  return sides.includes(a.disposition) && sides.includes(b.disposition) && (a.disposition !== b.disposition);
}

function canFlank(doc, familiars) {
  const actor = doc.actor;
  if (!actor) return false;
  if (INCAPACITATED.some(s => actor.statuses?.has(s))) return false;
  const hp = actor.system.attributes?.hp;
  if (hp?.max && (hp.value <= 0)) return false;
  return !isFamiliar(doc, familiars);
}

/**
 * Familiars never flank (companions and other summons do). A token is a familiar when:
 * - Chris's Premades summoned it with Find Familiar (listed in the caster's "findFamiliar" effect);
 * - its name contains one of the words in the "Familiar names" setting;
 * - its actor has the flag `flags.flanking-bonus.familiar`.
 * @param {Token|TokenDocument} token
 * @param {Set<string>} [familiars]  Token ids summoned as familiars, if already collected.
 */
export function isFamiliar(token, familiars = familiarTokenIds()) {
  const doc = docOf(token);
  if (familiars.has(doc.id)) return true;
  if (doc.actor?.getFlag(MODULE_ID, "familiar")) return true;
  const words = game.settings.get(MODULE_ID, "familiarNames").split(",").map(w => w.trim().toLowerCase()).filter(Boolean);
  const names = [doc.name, doc.actor?.name].filter(Boolean).map(n => n.toLowerCase());
  return words.some(w => names.some(n => n.includes(w)));
}

function familiarTokenIds() {
  const ids = new Set();
  const actors = new Set([...game.actors, ...game.scenes.contents.flatMap(s => s.tokens.map(t => t.actor))].filter(Boolean));
  for (const actor of actors) {
    for (const effect of actor.effects) {
      const cpr = effect.flags?.["chris-premades"];
      if (cpr?.info?.identifier !== "findFamiliar") continue;
      for (const list of Object.values(cpr.summons?.ids ?? {})) list?.forEach(id => ids.add(id));
    }
  }
  return ids;
}

/* -------------------------------------------- */
/*  Flanked icon                                */
/* -------------------------------------------- */

const isOurs = effect => !!effect.getFlag?.(MODULE_ID, "auto");
let timer = null;
let running = null;
let dirty = false;

/** Recompute the icons a moment after the last change. Only the active GM writes them. */
function queueRefresh() {
  if (!game.users.activeGM?.isSelf) return;
  clearTimeout(timer);
  timer = setTimeout(refreshIcons, 300);
}

/**
 * Scenes in play: the one the players are on and the one the GM is viewing. A linked actor
 * (one actor for every scene) keeps the icon if any of its tokens there is flanked.
 */
export async function refreshIcons() {
  if (!game.users.activeGM?.isSelf) return;
  if (running) { dirty = true; return running; }
  running = (async () => {
    do {
      dirty = false;
      const show = game.settings.get(MODULE_ID, "showIcon");
      const familiars = familiarTokenIds();
      const actors = new Map();
      for (const scene of new Set([game.scenes.active, canvas?.scene].filter(Boolean))) {
        for (const doc of scene.tokens) {
          const actor = doc.actor;
          if (!actor) continue;
          const flanked = show && [FRIENDLY, HOSTILE].includes(doc.disposition) && isFlanked(doc, familiars);
          actors.set(actor, (actors.get(actor) ?? false) || flanked);
        }
      }
      for (const [actor, flanked] of actors) {
        const ours = actor.effects.filter(isOurs);
        if (flanked && !ours.length) await actor.createEmbeddedDocuments("ActiveEffect", [flankedEffectData()]);
        else if (!flanked && ours.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ours.map(e => e.id));
      }
    } while (dirty);
  })();
  try { await running; } finally { running = null; }
}

/** Same status as Midi's "flanked", but with no changes: the bonus comes from positions, not from the effect. */
function flankedEffectData() {
  const status = CONFIG.statusEffects.find(s => s.id === STATUS_ID);
  return {
    name: game.i18n.localize(status?.name ?? "FLANKING.Flanked"),
    img: status?.img ?? STATUS_IMG,
    statuses: [STATUS_ID],
    changes: [],
    flags: { [MODULE_ID]: { auto: true } }
  };
}

function registerIconHooks() {
  const geometryKeys = ["x", "y", "elevation", "width", "height", "disposition", "hidden", "name", "actorId", "delta"];

  Hooks.on("createToken", queueRefresh);
  Hooks.on("deleteToken", queueRefresh);
  Hooks.on("updateToken", (doc, changes) => {
    if (geometryKeys.some(k => k in changes)) queueRefresh();
  });
  Hooks.on("canvasReady", queueRefresh);
  Hooks.on("createCombat", queueRefresh);
  Hooks.on("deleteCombat", queueRefresh);
  Hooks.on("updateCombat", (combat, changes) => {
    if (("round" in changes) || ("scene" in changes)) queueRefresh();
  });
  Hooks.on("updateScene", (scene, changes) => {
    if ("active" in changes) queueRefresh();
  });

  // Conditions and hit points decide who can flank.
  const onEffect = effect => {
    if (!isOurs(effect) && (effect.parent instanceof Actor)) queueRefresh();
  };
  Hooks.on("createActiveEffect", onEffect);
  Hooks.on("deleteActiveEffect", onEffect);
  Hooks.on("updateActiveEffect", onEffect);
  Hooks.on("updateActor", (actor, changes) => {
    if (foundry.utils.hasProperty(changes, "system.attributes.hp")) queueRefresh();
  });
}

/* -------------------------------------------- */
/*  Geometry                                    */
/* -------------------------------------------- */

const gridOf = doc => doc.parent.grid;
const isSquareGrid = doc => gridOf(doc).type === CONST.GRID_TYPES.SQUARE;

function verticallyClose(a, b) {
  return Math.abs((a.elevation ?? 0) - (b.elevation ?? 0)) <= gridOf(a).distance + EPSILON;
}

/** Cells as {x: column, y: row}. */
function cellsOf(doc) {
  return doc.getOccupiedGridSpaceOffsets().map(({ i, j }) => ({ x: j, y: i }));
}

function boundsOf(cells) {
  const xs = cells.map(c => c.x), ys = cells.map(c => c.y);
  return { left: Math.min(...xs), right: Math.max(...xs) + 1, top: Math.min(...ys), bottom: Math.max(...ys) + 1 };
}

/** Cells of `doc` that touch the target space (sides or corners) without being inside it. */
function adjacentCells(doc, box) {
  return cellsOf(doc).filter(c => {
    const inside = (c.x >= box.left) && (c.x < box.right) && (c.y >= box.top) && (c.y < box.bottom);
    const near = (c.x >= box.left - 1) && (c.x <= box.right) && (c.y >= box.top - 1) && (c.y <= box.bottom);
    return near && !inside;
  });
}

function centerOf(doc) {
  const size = gridOf(doc).size;
  return { x: doc.x + (doc.width * size / 2), y: doc.y + (doc.height * size / 2) };
}

function isAdjacent(doc, target) {
  if (!verticallyClose(doc, target)) return false;
  if (isSquareGrid(target)) return adjacentCells(doc, boundsOf(cellsOf(target))).length > 0;

  // Hex and gridless: the gap between the two tokens is under half a grid space.
  const size = gridOf(target).size;
  const radius = d => Math.min(d.width, d.height) * size / 2;
  const a = centerOf(doc), b = centerOf(target);
  return (Math.hypot(a.x - b.x, a.y - b.y) - radius(doc) - radius(target)) < (size / 2);
}

/**
 * DMG flanking: a line between the centers of the two creatures' spaces passes through
 * opposite sides or opposite corners of the target's space. Any qualifying square of a
 * Large or larger creature counts.
 */
function onOppositeSides(a, b, target) {
  if (!isSquareGrid(target)) {
    // Hex and gridless: the two allies stand roughly opposite each other around the target.
    const t = centerOf(target);
    const angle = d => { const c = centerOf(d); return Math.atan2(c.y - t.y, c.x - t.x); };
    let diff = Math.abs(angle(a) - angle(b));
    if (diff > Math.PI) diff = (2 * Math.PI) - diff;
    return diff >= (Math.PI * 5 / 6);
  }

  const box = boundsOf(cellsOf(target));
  const center = c => ({ x: c.x + 0.5, y: c.y + 0.5 });
  for (const ca of adjacentCells(a, box)) {
    for (const cb of adjacentCells(b, box)) {
      const p = center(ca), q = center(cb);
      const leftRight = crossesVertical(p, q, box.left, box) && crossesVertical(p, q, box.right, box);
      const topBottom = crossesHorizontal(p, q, box.top, box) && crossesHorizontal(p, q, box.bottom, box);
      if (leftRight || topBottom) return true;
    }
  }
  return false;
}

function crossesVertical(p, q, x, box) {
  if (Math.abs(q.x - p.x) < EPSILON) return false;
  const t = (x - p.x) / (q.x - p.x);
  if ((t < -EPSILON) || (t > 1 + EPSILON)) return false;
  const y = p.y + (t * (q.y - p.y));
  return (y >= box.top - EPSILON) && (y <= box.bottom + EPSILON);
}

function crossesHorizontal(p, q, y, box) {
  if (Math.abs(q.y - p.y) < EPSILON) return false;
  const t = (y - p.y) / (q.y - p.y);
  if ((t < -EPSILON) || (t > 1 + EPSILON)) return false;
  const x = p.x + (t * (q.x - p.x));
  return (x >= box.left - EPSILON) && (x <= box.right + EPSILON);
}
