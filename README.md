# Flanking Bonus

Homebrew flanking for Foundry VTT v13 and dnd5e 5.x: a melee weapon attack gets **+2 to hit** when the attacker and an ally stand on opposite sides of the target. The module reads token positions at the moment of the attack; nothing needs to be marked by hand.

## The rule

A target is flanked when:

- a **combat has started** on its scene (round 1 or later; an encounter not linked to a scene counts for the active scene). Outside combat there is no bonus and no icon;
- the attacker and at least one ally are both **adjacent** to it (within 5 ft, including diagonals and within 5 ft of elevation);
- a line between the centers of their spaces passes through **opposite sides or opposite corners** of the target's space (the DMG optional rule). Large and larger creatures flank if any square of their space qualifies;
- one side is **Friendly** and the other **Hostile** (token disposition). The ally has the same disposition as the attacker. Neutral and Secret tokens never flank and are never flanked;
- neither of them is incapacitated, paralyzed, petrified, stunned, unconscious, dead or at 0 HP, and the ally is not hidden by the GM;
- neither of them is a **familiar**. Companions and other summons flank normally.

A token counts as a familiar when:

- it was summoned with Chris's Premades **Find Familiar** (recognized automatically);
- its name contains a word from the **Familiar names** setting (default `Familiar`, which matches Chris's Premades' default names such as "Familiar Coruja");
- or its actor has the flag `flags.flanking-bonus.familiar` set to true.

Only **melee weapon attacks** get the bonus. Unarmed strikes and natural weapons count. Thrown weapons and spell attacks don't. The attack must have exactly one target.

On hex and gridless scenes, "opposite" means the two creatures are at least 150° apart around the target.

## In play

The bonus is added to the attack formula as `+ 2[Flanking]`, so it shows in the roll tooltip. It works with dnd5e's own rolls and with Midi-QOL (fast-forwarded or with the roll dialog).

### Flanked icon

Creatures that are flanked right now get the **Flanked** status icon, and it goes away when the position changes or the combat ends. The icon follows token moves, conditions and hit points on the scene the players are on and the scene the GM is viewing. Only the active GM's client writes it.

The icon is the same "flanked" status Midi-QOL registers, so it shows as active in the Token HUD. The effect has no changes: Midi's version grants advantage, this one doesn't. The +2 always comes from token positions at the moment of the attack, never from the icon. Without Midi-QOL, the module registers its own Flanked status.

If you use Midi-QOL, leave its own **Optional Rules → Check Flanking** set to *Off*, or the target also gets Midi's advantage.

## Settings

- **Flanking bonus:** the value added to the attack (default 2). 0 turns flanking off.
- **Flanked icon on the target:** show or hide the status icon (on by default).
- **Familiar names:** comma-separated words; tokens whose name contains one of them never flank.

## API

```js
const { isFlanking, flankingAlly, isFlanked, isFamiliar, refreshIcons } = game.modules.get("flanking-bonus").api;
isFlanking(attackerToken, targetToken);   // true / false
flankingAlly(attackerToken, targetToken); // the TokenDocument that completes the flank, or null
isFlanked(targetToken);                   // true if any visible creature flanks it
isFamiliar(token);                        // true if the token never flanks
refreshIcons();                           // recompute the Flanked icons now (GM only)
```

## Install

Manifest: `https://github.com/Yagoks/flanking-bonus/releases/latest/download/module.json`
