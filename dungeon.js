'use strict';

// ══════════════════════════════════════════════════════════
//  CONSTANTS
// ══════════════════════════════════════════════════════════
const TILE = 16;
const COLS = 30;
const ROWS = 20;
const TILE_FLOOR = 0, TILE_WALL = 1, TILE_STAIR = 2, TILE_CHEST = 3, TILE_SHOP = 4;

const mapCanvas = document.getElementById('map');
const ctx = mapCanvas.getContext('2d');
const popupCanvas = document.getElementById('popup-canvas');
const pctx = popupCanvas.getContext('2d');
mapCanvas.width = popupCanvas.width = COLS * TILE;
mapCanvas.height = popupCanvas.height = ROWS * TILE;

// 敵スプライト用canvas
const spriteCanvas = document.getElementById('enemy-sprite-canvas');
const sctx = spriteCanvas.getContext('2d');

// ══════════════════════════════════════════════════════════
//  CLASS DEFINITIONS
// ══════════════════════════════════════════════════════════
const CLASSES = {
  warrior: {
    name: '戦士', icon: '⚔', color: '#e84040',
    hp: 35, mp: 10, atk: 11, def: 8,
    perk: null,
    startItems: [{ name: '回復薬', type: 'heal', val: 15, qty: 1 }],
    startSkillCommands: [],
  },
  mage: {
    name: '魔法使い', icon: '✦', color: '#4488ff',
    hp: 15, mp: 20, atk: 4, def: 1,
    perk: null,
    startItems: [{ name: '魔法薬', type: 'mpheal', val: 8, qty: 2 }],
    startSkillCommands: ['magic_null'],
  },
  rogue: {
    name: '盗賊', icon: '🗡', color: '#3ee8cc',
    hp: 20, mp: 8, atk: 6, def: 2,
    perk: 'doubleAtk',
    startItems: [{ name: '煙玉', type: 'smoke', val: 0, qty: 2 }],
    startSkillCommands: [],
  },
  cleric: {
    name: '僧侶', icon: '✙', color: '#f5c842',
    hp: 24, mp: 16, atk: 4, def: 3,
    perk: 'regen',
    startItems: [{ name: '回復薬', type: 'heal', val: 15, qty: 2 }],
    startSkillCommands: [],
  },
};

// ══════════════════════════════════════════════════════════
//  SKILL COMMANDS (戦闘中に使う職業固有技)
// ══════════════════════════════════════════════════════════
const SKILL_COMMANDS = {
  // ─── 戦士 ───
  kyusho_tsuki: {
    id: 'kyusho_tsuki', name: '急所突き', icon: '🎯', mpCost: 5,
    availableFor: ['warrior'],
    desc: '会心率+50%でATK×0.7の攻撃',
    execute: (p, e) => {
      const critRate = (p.passives.critRate || 0) + 0.5;
      const base = Math.max(1, Math.floor(p.atk * 0.7 + Math.floor(Math.random() * 3) - e.def));
      const isCrit = Math.random() < critRate;
      const dmg = isCrit ? Math.floor(base * (p.passives.critMult || 2)) : base;
      e.hp -= dmg;
      spawnPopup(e.x, e.y, isCrit ? `🎯💥${dmg}` : `🎯${dmg}`, isCrit ? '#f5c842' : '#ff8c00');
      log(isCrit ? `急所突き・会心！ ${e.name}に${dmg}ダメージ！` : `急所突き！ ${e.name}に${dmg}ダメージ！`, 'combat');
      return dmg;
    }
  },

  iron_wall: {
    id: 'iron_wall', name: '鉄壁', icon: '🛡', mpCost: 3,
    availableFor: ['warrior'],
    desc: '3ターン間、被ダメ時にDEF×2/3の反撃ダメージ',
    execute: (p, e) => {
      const turns = 3 + (p.passives.ironWallBonus || 0);
      p.passives._ironWallTurns = turns;
      spawnPopup(G.px, G.py, '🛡鉄壁！', '#4488ff');
      log(`鉄壁！ ${turns}ターン間、被ダメ時に反撃する！`, 'good');
      return 0;
    }
  },

  shield_bash: {
    id: 'shield_bash', name: 'シールドバッシュ', icon: '🛡', mpCost: 0,
    availableFor: ['warrior'],
    desc: 'DEFをATKとして扱って攻撃',
    execute: (p, e) => {
      const boost = p.passives.defDmgBoost || 1;
      const dmg = Math.max(1, Math.floor((p.def + Math.floor(Math.random() * 3) - e.def) * boost));
      e.hp -= dmg;
      spawnPopup(e.x, e.y, `🛡${dmg}`, '#4488ff');
      log(`シールドバッシュ！ ${e.name}に${dmg}ダメージ！`, 'combat');
      return dmg;
    }
  },

  kiai_tame: {
    id: 'kiai_tame', name: '気合ため', icon: '🎯', mpCost: 0,
    availableFor: ['warrior'],
    desc: '次の攻撃の会心ダメージ×1.5倍バフ',
    execute: (p, e) => {
      p.passives._kiaiMult = (p.passives.critMult || 2) * 1.5;
      p.passives._kiaiReady = true;
      spawnPopup(G.px, G.py, '🎯気合ため！', '#f5c842');
      log('気合ため！ 次の攻撃の会心ダメージが1.5倍になる！', 'warn');
      return 0;
    }
  },

  multi_slash: {
    id: 'multi_slash', name: '乱れ切り', icon: '🌀', mpCost: 5,
    availableFor: ['warrior'],
    desc: 'ATK×0.75で1〜4回攻撃',
    execute: (p, e) => {
      const hits = 1 + Math.floor(Math.random() * 4);
      let total = 0;
      for (let i = 0; i < hits; i++) {
        const dmg = Math.max(1, Math.floor(p.atk * 0.75 + Math.floor(Math.random() * 3) - e.def));
        total += dmg;
        e.hp -= dmg;
        if (e.hp <= 0) break;
      }
      spawnPopup(e.x, e.y, `🌀${total}`, '#ff8c00');
      log(`乱れ切り${hits}連撃！ 合計${total}ダメージ！`, 'combat');
      return total;
    }
  },// ─── 戦士追加スキル ───
  blood_awakening: {
    id: 'blood_awakening', name: '血の覚醒', icon: '🔴', mpCost: 2,
    availableFor: ['warrior'],
    desc: 'HP50%以下でATK+40%、HP25%以下でさらに+40%（3ターン判定）',
    execute: (p, e) => {
      p.passives._bloodAwakeningTurns = 3;
      const ratio = p.hp / p.maxHp;
      let bonus = 0;
      if (ratio <= 0.25) bonus = 0.8;
      else if (ratio <= 0.5) bonus = 0.4;
      if (bonus > 0) {
        p.passives._bloodAwakeningBonus = bonus;
        p.atk = Math.floor(p.atk * (1 + bonus));
        spawnPopup(G.px, G.py, `🔴覚醒+${Math.floor(bonus * 100)}%`, '#e84040');
        log(`血の覚醒！ ATK+${Math.floor(bonus * 100)}%！（残り3ターン）`, 'warn');
      } else {
        log('血の覚醒…HPがまだ高い、効果が出ない！', 'warn');
      }
      return 0;
    }
  },
  armor_break: {
    id: 'armor_break', name: '鎧砕き', icon: '🔨', mpCost: 4,
    availableFor: ['warrior'],
    desc: '敵のDEFを3ターン間−4する',
    execute: (p, e) => {
      const reduce = Math.min(e.def, 4);
      e.def = Math.max(0, e.def - reduce);
      e._armorBreakTurns = 3;
      e._armorBreakReduce = reduce;
      spawnPopup(e.x, e.y, `🔨DEF-${reduce}`, '#ff8c00');
      log(`鎧砕き！ ${e.name}のDEFが${reduce}低下！3ターン継続！`, 'warn');
      return 0;
    }
  },
  vampiric_slash: {
    id: 'vampiric_slash', name: '吸血切り', icon: '🩸', mpCost: 3,
    availableFor: ['warrior'],
    desc: 'ATK×0.6のダメージ、全回復',
    execute: (p, e) => {
      const dmg = Math.max(1, Math.floor(p.atk * 0.6 + Math.floor(Math.random() * 3) - e.def));
      e.hp -= dmg;
      const heal = Math.min(dmg, p.maxHp - p.hp);
      p.hp += heal;
      spawnPopup(e.x, e.y, `🩸${dmg}`, '#cc0044');
      if (heal > 0) spawnPopup(G.px, G.py, `+${heal}HP`, '#3ecc6f');
      log(`吸血切り！ ${e.name}に${dmg}ダメージ、HP+${heal}回復！`, 'combat');
      return dmg;
    }
  },
  rage_burst: {
    id: 'rage_burst', name: '怒りの爆発', icon: '💢', mpCost: 4,
    availableFor: ['warrior'],
    desc: '怒りスタック（被ダメごと+1）×12のダメージ、スタック消費',
    execute: (p, e) => {
      const stacks = p.passives._rageStacks || 0;
      if (stacks === 0) {
        log('怒りスタックがない！ダメージを受けて溜めよう！', 'warn');
        return 0;
      }
      const dmg = stacks * 12;
      e.hp -= dmg;
      p.passives._rageStacks = 0;
      spawnPopup(e.x, e.y, `💢${dmg}`, '#e84040');
      log(`怒りの爆発！ スタック${stacks}×12=${dmg}の大ダメージ！`, 'warn');
      return dmg;
    }
  },
  ultimate_slash: {
    id: 'ultimate_slash', name: '究極切り', icon: '👑', mpCost: 9,
    availableFor: ['warrior'],
    desc: '会心率70%、発動後ATK×2が3ターン継続',
    execute: (p, e) => {
      const isCrit = Math.random() < 0.7;
      const base = Math.max(1, p.atk + Math.floor(Math.random() * 5) - e.def);
      const dmg = isCrit ? Math.floor(base * (p.passives.critMult || 2)) : base;
      e.hp -= dmg;
      p.passives._ultimateBuffTurns = 3;
      p.passives._ultimateOrigAtk = p.atk;
      p.atk = Math.floor(p.atk * 2);
      spawnPopup(e.x, e.y, isCrit ? `👑💥${dmg}` : `👑${dmg}`, '#f5c842');
      log(isCrit
        ? `究極切り・会心！ ${e.name}に${dmg}の大ダメージ！ATK2倍×3ターン！！`
        : `究極切り！ ${e.name}に${dmg}ダメージ！ATK2倍×3ターン！`, 'warn');
      return dmg;
    }
  },

  // ─── 魔法使い ───
  magic_null: {
    id: 'magic_null', name: '無属性魔法', icon: '✦', mpCost: 2,
    availableFor: ['mage'],
    desc: 'ATK×1.5の魔法ダメージ',
    execute: (p, e) => {
      const dmg = Math.max(2, Math.floor(p.atk * 1.5 + Math.floor(Math.random() * 4) - Math.floor(e.def / 2)));
      e.hp -= dmg;
      spawnPopup(e.x, e.y, `✦${dmg}`, '#aaaaff');
      log(`無属性魔法！ ${e.name}に${dmg}ダメージ！`, 'combat');
      return dmg;
    }
  },
  fire_small: {
    id: 'fire_small', name: '炎魔法・小', icon: '🔥', mpCost: 3,
    availableFor: ['mage'],
    desc: 'ATK×2の炎ダメージ',
    execute: (p, e) => {
      const dmg = Math.max(2, Math.floor(p.atk * 2 + Math.floor(Math.random() * 4) - Math.floor(e.def / 2)));
      e.hp -= dmg;
      spawnPopup(e.x, e.y, `🔥${dmg}`, '#ff4400');
      log(`炎魔法！ ${e.name}に${dmg}ダメージ！`, 'combat');
      return dmg;
    }
  },
  fire_mid: {
    id: 'fire_mid', name: '炎魔法・中', icon: '🔥', mpCost: 4,
    availableFor: ['mage'],
    desc: 'ATK×3の炎ダメージ',
    execute: (p, e) => {
      const dmg = Math.max(3, Math.floor(p.atk * 3 + Math.floor(Math.random() * 5) - Math.floor(e.def / 2)));
      e.hp -= dmg;
      spawnPopup(e.x, e.y, `🔥${dmg}`, '#ff6622');
      log(`炎魔法（中）！ ${e.name}に${dmg}ダメージ！`, 'combat');
      return dmg;
    }
  },
  fire_large: {
    id: 'fire_large', name: '炎魔法・大', icon: '🔥', mpCost: 6,
    availableFor: ['mage'],
    desc: 'ATK×4.5の炎ダメージ',
    execute: (p, e) => {
      const dmg = Math.max(5, Math.floor(p.atk * 4.5 + Math.floor(Math.random() * 6) - Math.floor(e.def / 2)));
      e.hp -= dmg;
      spawnPopup(e.x, e.y, `🔥${dmg}`, '#ff8800');
      log(`大炎魔法！ ${e.name}に${dmg}大ダメージ！！`, 'combat');
      return dmg;
    }
  },
  ice_small: {
    id: 'ice_small', name: '氷魔法・小', icon: '❄', mpCost: 3,
    availableFor: ['mage'],
    desc: 'ATK×2の氷ダメージ＋敵ATK-1',
    execute: (p, e) => {
      const dmg = Math.max(2, Math.floor(p.atk * 2 + Math.floor(Math.random() * 4) - Math.floor(e.def / 2)));
      e.hp -= dmg; e.atk = Math.max(1, e.atk - 1);
      spawnPopup(e.x, e.y, `❄${dmg}`, '#88ccff');
      log(`氷魔法！ ${e.name}に${dmg}ダメージ！ATK低下！`, 'combat');
      return dmg;
    }
  },
  ice_mid: {
    id: 'ice_mid', name: '氷魔法・中', icon: '❄', mpCost: 4,
    availableFor: ['mage'],
    desc: 'ATK×3の氷ダメージ＋敵ATK-2',
    execute: (p, e) => {
      const dmg = Math.max(3, Math.floor(p.atk * 3 + Math.floor(Math.random() * 5) - Math.floor(e.def / 2)));
      e.hp -= dmg; e.atk = Math.max(1, e.atk - 2);
      spawnPopup(e.x, e.y, `❄${dmg}`, '#aaddff');
      log(`氷魔法（中）！ ${e.name}に${dmg}ダメージ！ATK大低下！`, 'combat');
      return dmg;
    }
  },
  ice_large: {
    id: 'ice_large', name: '氷魔法・大', icon: '❄', mpCost: 6,
    availableFor: ['mage'],
    desc: 'ATK×4.5の氷ダメージ＋敵ATK-3',
    execute: (p, e) => {
      const dmg = Math.max(5, Math.floor(p.atk * 4.5 + Math.floor(Math.random() * 6) - Math.floor(e.def / 2)));
      e.hp -= dmg; e.atk = Math.max(1, e.atk - 3);
      spawnPopup(e.x, e.y, `❄${dmg}`, '#cceeff');
      log(`大氷魔法！ ${e.name}に${dmg}大ダメージ！完全凍結！`, 'combat');
      return dmg;
    }
  },
  wind_small: {
    id: 'wind_small', name: '風魔法・小', icon: '🌪', mpCost: 3,
    availableFor: ['mage'],
    desc: 'ATK×2の風ダメージ、DEF完全無視',
    execute: (p, e) => {
      const dmg = Math.max(2, Math.floor(p.atk * 2 + Math.floor(Math.random() * 4)));
      e.hp -= dmg;
      spawnPopup(e.x, e.y, `🌪${dmg}`, '#88ffcc');
      log(`風魔法！ ${e.name}に${dmg}ダメージ！（DEF無視）`, 'combat');
      return dmg;
    }
  },
  wind_mid: {
    id: 'wind_mid', name: '風魔法・中', icon: '🌪', mpCost: 4,
    availableFor: ['mage'],
    desc: 'ATK×3、DEF無視＋20%で2回発動',
    execute: (p, e) => {
      let dmg = Math.max(3, Math.floor(p.atk * 3 + Math.floor(Math.random() * 5)));
      e.hp -= dmg;
      let extra = '';
      if (Math.random() < 0.2) {
        const dmg2 = Math.max(2, Math.floor(p.atk * 3));
        e.hp -= dmg2; dmg += dmg2; extra = '×2連！';
      }
      spawnPopup(e.x, e.y, `🌪${dmg}`, '#aaffdd');
      log(`風魔法（中）！ ${e.name}に${dmg}ダメージ${extra}`, 'combat');
      return dmg;
    }
  },
  wind_large: {
    id: 'wind_large', name: '風魔法・大', icon: '🌪', mpCost: 6,
    availableFor: ['mage'],
    desc: 'ATK×4.5、DEF無視＋40%で2回発動',
    execute: (p, e) => {
      let dmg = Math.max(5, Math.floor(p.atk * 4.5 + Math.floor(Math.random() * 6)));
      e.hp -= dmg;
      let extra = '';
      if (Math.random() < 0.4) {
        const dmg2 = Math.max(3, Math.floor(p.atk * 4.5));
        e.hp -= dmg2; dmg += dmg2; extra = '×2連！';
      }
      spawnPopup(e.x, e.y, `🌪${dmg}`, '#ccffee');
      log(`大風魔法！ ${e.name}に${dmg}大ダメージ${extra}`, 'combat');
      return dmg;
    }
  },
  // ─── 盗賊スキル ───
  poison_needle: {
    id: 'poison_needle', name: '毒針', icon: '🐍', mpCost: 2,
    availableFor: ['rogue'],
    desc: '確定毒付与（毎ターン-4、最大3スタック）',
    execute: (p, e) => {
      const dmg = Math.max(1, Math.floor(p.atk * 0.2));
      e.hp -= dmg;
      e._poisonStacks = Math.min((e._poisonStacks || 0) + 1, 3);
      e._poisonPerTurn = e._poisonStacks * 4;
      e._poisonTurns = 999;
      spawnPopup(e.x, e.y, `🐍毒×${e._poisonStacks}`, '#3ecc6f');
      log(`毒針！ ${e.name}に毒スタック${e._poisonStacks}付与！（毎ターン-${e._poisonPerTurn}）`, 'combat');
      return dmg;
    }
  },
  smoke_screen: {
    id: 'smoke_screen', name: '煙幕', icon: '💨', mpCost: 2,
    availableFor: ['rogue'],
    desc: '2ターン間、敵攻撃命中率-60%',
    execute: (p, e) => {
      p.passives._smokeTurns = 2;
      spawnPopup(G.px, G.py, '💨煙幕！', '#aaaaaa');
      log('煙幕！ 2ターン間、敵の攻撃が外れやすくなった！', 'good');
      return 0;
    }
  },
  leg_sweep: {
    id: 'leg_sweep', name: '足払い', icon: '🦶', mpCost: 2,
    availableFor: ['rogue'],
    desc: '小ダメージ＋敵ATKを2ターン-3',
    execute: (p, e) => {
      const dmg = Math.max(1, Math.floor(p.atk * 0.3) - e.def);
      e.hp -= dmg;
      e._legSweepTurns = 2;
      e._legSweepReduce = Math.min(e.atk - 1, 3);
      e.atk = Math.max(1, e.atk - e._legSweepReduce);
      spawnPopup(e.x, e.y, `🦶ATK-${e._legSweepReduce}`, '#ff8c00');
      log(`足払い！ ${e.name}に${dmg}ダメージ＋ATK${e._legSweepReduce}低下！2ターン継続！`, 'combat');
      return dmg;
    }
  },
  double_strike: {
    id: 'double_strike', name: '二連撃', icon: '🗡', mpCost: 3,
    availableFor: ['rogue'],
    desc: 'ATK×0.5で2回攻撃',
    execute: (p, e) => {
      let total = 0;
      for (let i = 0; i < 2; i++) {
        const dmg = Math.max(1, Math.floor(p.atk * 0.5 + Math.floor(Math.random() * 2)) - e.def);
        e.hp -= dmg;
        total += dmg;
        if (e.hp <= 0) break;
      }
      spawnPopup(e.x, e.y, `🗡${total}`, '#3ee8cc');
      log(`二連撃！ ${e.name}に合計${total}ダメージ！`, 'combat');
      return total;
    }
  },
  poison_mist: {
    id: 'poison_mist', name: '毒霧', icon: '☠', mpCost: 3,
    availableFor: ['rogue'],
    desc: '強毒付与（毎ターン-8、2ターンのみ）',
    execute: (p, e) => {
      e._poisonStacks = Math.min((e._poisonStacks || 0) + 2, 3);
      e._poisonPerTurn = 8;
      e._poisonTurns = 2;
      spawnPopup(e.x, e.y, '☠強毒！', '#88ff44');
      log(`毒霧！ ${e.name}に強毒付与！2ターン毎ターン-8ダメージ！`, 'combat');
      return 0;
    }
  },
  shadow_bind: {
    id: 'shadow_bind', name: '影縫い', icon: '🌑', mpCost: 4,
    availableFor: ['rogue'],
    desc: '敵を2ターン完全スタン（攻撃不能）',
    execute: (p, e) => {
      e._stunTurns = 2;
      spawnPopup(e.x, e.y, '🌑スタン！', '#8844ff');
      log(`影縫い！ ${e.name}が2ターン動けなくなった！`, 'warn');
      return 0;
    }
  },
  rapid_poison: {
    id: 'rapid_poison', name: '連続毒針', icon: '💉', mpCost: 4,
    availableFor: ['rogue'],
    desc: '2〜3回毒針を連続で放つ',
    execute: (p, e) => {
      const hits = 2 + (Math.random() < 0.5 ? 1 : 0);
      let total = 0;
      for (let i = 0; i < hits; i++) {
        const dmg = Math.max(1, Math.floor(p.atk * 0.2));
        e.hp -= dmg;
        total += dmg;
        e._poisonStacks = Math.min((e._poisonStacks || 0) + 1, 3);
        if (e.hp <= 0) break;
      }
      e._poisonPerTurn = e._poisonStacks * 4;
      e._poisonTurns = 999;
      spawnPopup(e.x, e.y, `💉×${hits} 毒×${e._poisonStacks}`, '#3ecc6f');
      log(`連続毒針${hits}連！ 毒スタック${e._poisonStacks}！合計${total}ダメージ！`, 'combat');
      return total;
    }
  },
  poison_burst: {
    id: 'poison_burst', name: '毒爆発', icon: '💥', mpCost: 3,
    availableFor: ['rogue'],
    desc: '毒スタック数×15のダメージ（毒は消える）',
    execute: (p, e) => {
      const stacks = e._poisonStacks || 0;
      if (stacks === 0) {
        log('毒スタックがない！効果がない！', 'warn');
        return 0;
      }
      const dmg = stacks * 15;
      e.hp -= dmg;
      e._poisonStacks = 0;
      e._poisonPerTurn = 0;
      e._poisonTurns = 0;
      spawnPopup(e.x, e.y, `💥${dmg}`, '#ff4400');
      log(`毒爆発！ スタック${stacks}×15=${dmg}の大ダメージ！毒解除！`, 'warn');
      return dmg;
    }
  },
  death_dance: {
    id: 'death_dance', name: '死の舞踏', icon: '💀', mpCost: 6,
    availableFor: ['rogue'],
    desc: '3ターン間、敵攻撃80%回避＋毎ターン自動毒針',
    execute: (p, e) => {
      p.passives._deathDanceTurns = 3;
      spawnPopup(G.px, G.py, '💀死の舞踏！', '#cc44ff');
      log('死の舞踏！ 3ターン間、回避率+80%＋毎ターン自動毒針！', 'warn');
      return 0;
    }
  },
  // ─── 僧侶スキルコマンド ───
  holy_light: {
    id: 'holy_light', name: '聖光', icon: '☀', mpCost: 3,
    availableFor: ['cleric'],
    desc: 'ATK×1.8の聖属性ダメージ',
    execute: (p, e) => {
      const boost = p.passives.holyBoost || 0;
      const dmg = Math.max(2, Math.floor(p.atk * 1.8 * (1 + boost) + Math.floor(Math.random() * 4) - Math.floor(e.def / 2)));
      e.hp -= dmg;
      spawnPopup(e.x, e.y, `☀${dmg}`, '#f5c842');
      log(`聖光！ ${e.name}に${dmg}ダメージ！`, 'combat');
      return dmg;
    }
  },
  heal_self: {
    id: 'heal_self', name: '治癒', icon: '💚', mpCost: 3,
    availableFor: ['cleric'],
    desc: 'HP+20回復',
    execute: (p, e) => {
      const base = 20;
      const heal = Math.min(Math.floor(base * (p.passives.healBoost || 1)), p.maxHp - p.hp);
      p.hp += heal;
      spawnPopup(G.px, G.py, `+${heal}HP`, '#3ecc6f');
      log(`治癒！ HP+${heal}回復！`, 'good');
      return 0;
    }
  },
  smite_evil: {
    id: 'smite_evil', name: '神罰', icon: '⚡', mpCost: 4,
    availableFor: ['cleric'],
    desc: 'ATK×2.5の聖ダメージ＋敵ATK-2',
    execute: (p, e) => {
      const boost = p.passives.holyBoost || 0;
      const dmg = Math.max(3, Math.floor(p.atk * 2.5 * (1 + boost) + Math.floor(Math.random() * 5) - Math.floor(e.def / 2)));
      e.hp -= dmg;
      e.atk = Math.max(1, e.atk - 2);
      spawnPopup(e.x, e.y, `⚡${dmg}`, '#f5c842');
      log(`神罰！ ${e.name}に${dmg}ダメージ＋ATK-2！`, 'combat');
      return dmg;
    }
  },
  holy_flame: {
    id: 'holy_flame', name: '聖炎', icon: '🔥', mpCost: 3,
    availableFor: ['cleric'],
    desc: '敵に聖なる燃焼を付与（毎ターン-6、3ターン）',
    execute: (p, e) => {
      e._holyBurnTurns = 3;
      e._holyBurnDmg = 6;
      spawnPopup(e.x, e.y, '🔥聖炎！', '#f5c842');
      log(`聖炎！ ${e.name}に聖なる燃焼付与！3ターン毎ターン-6！`, 'combat');
      return 0;
    }
  },
  holy_shield: {
    id: 'holy_shield', name: '聖盾', icon: '🛡', mpCost: 3,
    availableFor: ['cleric'],
    desc: '3ターン間、受けるダメージを半減',
    execute: (p, e) => {
      p.passives._holyShieldTurns = 3;
      spawnPopup(G.px, G.py, '🛡聖盾！', '#4488ff');
      log('聖盾！ 3ターン間ダメージ半減！', 'good');
      return 0;
    }
  },
  prayer: {
    id: 'prayer', name: '祈り', icon: '🙏', mpCost: 2,
    availableFor: ['cleric'],
    desc: '3ターン間、毎ターンHP+8・MP+4自動回復',
    execute: (p, e) => {
      p.passives._prayerTurns = 3;
      spawnPopup(G.px, G.py, '🙏祈り！', '#f5c842');
      log('祈り！ 3ターン間毎ターンHP+8・MP+4回復！', 'good');
      return 0;
    }
  },
  miracle: {
    id: 'miracle', name: '奇跡', icon: '✝', mpCost: 4,
    availableFor: ['cleric'],
    desc: 'この戦闘1回限り、HP0になるとき自動発動してHP30%で踏みとどまる',
    execute: (p, e) => {
      if (p._miracleUsed) {
        log('奇跡はこの戦闘ではもう使えない！', 'warn');
        return 0;
      }
      p.passives._miracleReady = true;
      spawnPopup(G.px, G.py, '✝奇跡待機！', '#f5c842');
      log('奇跡！ HP0になったとき自動発動でHP30%で復活！', 'warn');
      return 0;
    }
  },
  sanctuary: {
    id: 'sanctuary', name: '聖域', icon: '👼', mpCost: 5,
    availableFor: ['cleric'],
    desc: '使用ターン含め2ターン完全無敵、終了時に敵へ反撃大ダメージ',
    execute: (p, e) => {
      p.passives._sanctuaryTurns = 2;
      p.passives._sanctuaryEnemy = e;
      spawnPopup(G.px, G.py, '👼聖域！', '#ffffff');
      log('聖域！ 2ターン完全無敵！終了時に反撃ダメージ！', 'warn');
      return 0;
    }
  },
  divine_judgment: {
    id: 'divine_judgment', name: '神の裁き', icon: '👑', mpCost: 8,
    availableFor: ['cleric'],
    desc: '【全スキル解放】超大聖ダメージ＋HP全回復＋この戦闘HP0時に一度だけHP50%で自動復活',
    execute: (p, e) => {
      const boost = p.passives.holyBoost || 0;
      const dmg = Math.max(10, Math.floor(p.atk * 5 * (1 + boost) + Math.floor(Math.random() * 10) - Math.floor(e.def / 2)));
      e.hp -= dmg;
      const heal = p.maxHp - p.hp;
      p.hp = p.maxHp;
      p.passives._divineRevive = true;
      spawnPopup(e.x, e.y, `👑${dmg}`, '#f5c842');
      spawnPopup(G.px, G.py, `+${heal}HP`, '#3ecc6f');
      log(`神の裁き！ ${e.name}に${dmg}の大ダメージ！HP全回復！死亡時自動復活待機！`, 'warn');
      return dmg;
    }
  },
  // ─── 魔剣士 ───
  dark_slash: {
    id: 'dark_slash', name: '闇斬り', icon: '🌑', mpCost: 0,
    availableFor: ['warrior'],
    desc: 'HP5消費、ATK×1.8の闇ダメージ',
    execute: (p, e) => {
      if (p.hp <= 5) { log('HPが足りない！', 'warn'); return 0; }
      p.hp -= 5;
      const dmg = Math.max(2, Math.floor(p.atk * 1.8 + Math.floor(Math.random() * 4) - Math.floor(e.def / 2)));
      e.hp -= dmg;
      spawnPopup(e.x, e.y, `🌑${dmg}`, '#8844ff');
      spawnPopup(G.px, G.py, `-5HP`, '#e84040');
      log(`闇斬り！ HP5消費、${e.name}に${dmg}ダメージ！`, 'combat');
      return dmg;
    }
  },
  soul_devour: {
    id: 'soul_devour', name: '魂喰い', icon: '💜', mpCost: 0,
    availableFor: ['warrior'],
    desc: 'HP8消費、ATK×2.5ダメージ、与ダメの50%HP回収',
    execute: (p, e) => {
      if (p.hp <= 8) { log('HPが足りない！', 'warn'); return 0; }
      p.hp -= 8;
      const dmg = Math.max(3, Math.floor(p.atk * 2.5 + Math.floor(Math.random() * 5) - Math.floor(e.def / 2)));
      e.hp -= dmg;
      const heal = Math.min(Math.floor(dmg * 0.5), p.maxHp - p.hp);
      p.hp += heal;
      spawnPopup(e.x, e.y, `💜${dmg}`, '#cc44ff');
      spawnPopup(G.px, G.py, `+${heal}HP`, '#3ecc6f');
      log(`魂喰い！ HP8消費、${e.name}に${dmg}ダメージ、HP+${heal}回収！`, 'combat');
      return dmg;
    }
  },
  dark_wave: {
    id: 'dark_wave', name: '暗黒波動', icon: '🌊', mpCost: 0,
    availableFor: ['warrior'],
    desc: 'HP10消費、ATK×3のDEF無視ダメージ',
    execute: (p, e) => {
      if (p.hp <= 10) { log('HPが足りない！', 'warn'); return 0; }
      p.hp -= 10;
      const dmg = Math.max(4, Math.floor(p.atk * 3 + Math.floor(Math.random() * 6)));
      e.hp -= dmg;
      spawnPopup(e.x, e.y, `🌊${dmg}`, '#4400cc');
      spawnPopup(G.px, G.py, `-10HP`, '#e84040');
      log(`暗黒波動！ HP10消費、${e.name}にDEF無視${dmg}の大ダメージ！`, 'combat');
      return dmg;
    }
  },
  curse_slash: {
    id: 'curse_slash', name: '呪縛斬り', icon: '⛓', mpCost: 0,
    availableFor: ['warrior'],
    desc: 'HP6消費、ATK×1.5＋敵を3ターン呪い（ATK-3、DEF-2）',
    execute: (p, e) => {
      if (p.hp <= 6) { log('HPが足りない！', 'warn'); return 0; }
      p.hp -= 6;
      const dmg = Math.max(2, Math.floor(p.atk * 1.5 + Math.floor(Math.random() * 4) - e.def));
      e.hp -= dmg;
      e.atk = Math.max(1, e.atk - 3);
      e.def = Math.max(0, e.def - 2);
      e._curseTurns = 3;
      e._curseAtkReduce = 3;
      e._curseDefReduce = 2;
      spawnPopup(e.x, e.y, `⛓${dmg}`, '#8844ff');
      spawnPopup(e.x, e.y - 1, `呪縛！`, '#cc44ff');
      log(`呪縛斬り！ HP6消費、${e.name}に${dmg}ダメージ＋3ターン呪い（ATK-3・DEF-2）！`, 'combat');
      return dmg;
    }
  },
  death_sentence: {
    id: 'death_sentence', name: '死の宣告', icon: '💀', mpCost: 4,
    availableFor: ['warrior'],
    desc: 'HP4+MP4消費、3ターン後に蓄積ダメージ×2を与える',
    execute: (p, e) => {
      if (p.hp <= 4) { log('HPが足りない！', 'warn'); return 0; }
      if (p.mp < 4) { log('MPが足りない！', 'warn'); return 0; }
      p.hp -= 4;
      p.mp -= 4;
      e._pendingTimeSlash = 3;
      e._timeSlashAtk = p.atk * 2;
      spawnPopup(e.x, e.y, `💀宣告！`, '#cc0044');
      spawnPopup(G.px, G.py, `-4HP-4MP`, '#e84040');
      log(`死の宣告！ HP4+MP4消費、3ターン後に${e.name}に大ダメージが炸裂する！`, 'warn');
      return 0;
    }
  },
  soul_release: {
    id: 'soul_release', name: '魂の解放', icon: '👁', mpCost: 0,
    availableFor: ['warrior'],
    desc: 'HP15消費（HP30%以下で使用可）、ATK×5の超大ダメージ',
    execute: (p, e) => {
      if (p.hp / p.maxHp > 0.3) { log('HPが30%以下のときのみ使用可能！', 'warn'); return 0; }
      if (p.hp <= 15) { log('HPが足りない！', 'warn'); return 0; }
      p.hp -= 15;
      const dmg = Math.max(10, Math.floor(p.atk * 5 + Math.floor(Math.random() * 10)));
      e.hp -= dmg;
      spawnPopup(e.x, e.y, `👁${dmg}`, '#ff00ff');
      spawnPopup(G.px, G.py, `-15HP`, '#e84040');
      log(`魂の解放！！ HP15消費、${e.name}に${dmg}の超大ダメージ！！`, 'warn');
      return dmg;
    }
  },
  dark_bind: {
    id: 'dark_bind', name: '闇縛り', icon: '🕸', mpCost: 0,
    availableFor: ['warrior'],
    desc: 'HP4消費、敵を3ターン行動不能',
    execute: (p, e) => {
      if (p.hp <= 4) { log('HPが足りない！', 'warn'); return 0; }
      p.hp -= 4;
      e._stunTurns = 3;
      spawnPopup(e.x, e.y, `🕸縛り！`, '#8844ff');
      spawnPopup(G.px, G.py, `-4HP`, '#e84040');
      log(`闇縛り！ HP4消費、${e.name}を3ターン行動不能に！`, 'warn');
      return 0;
    }
  },
  fear_mark: {
    id: 'fear_mark', name: '恐怖の刻印', icon: '😱', mpCost: 4,
    availableFor: ['warrior'],
    desc: 'HP4+MP4消費、敵のATKを3ターン間-50%',
    execute: (p, e) => {
      if (p.hp <= 4) { log('HPが足りない！', 'warn'); return 0; }
      if (p.mp < 4) { log('MPが足りない！', 'warn'); return 0; }
      p.hp -= 4;
      p.mp -= 4;
      e._fearTurns = 3;
      e._fearAtkOrig = e.atk;
      e.atk = Math.max(1, Math.floor(e.atk * 0.5));
      spawnPopup(e.x, e.y, `😱恐怖！`, '#8844ff');
      spawnPopup(G.px, G.py, `-4HP-4MP`, '#e84040');
      log(`恐怖の刻印！ HP4+MP4消費、${e.name}のATKを3ターン-50%！`, 'warn');
      return 0;
    }
  },
  dark_curse: {
    id: 'dark_curse', name: '暗黒呪縛', icon: '🌀', mpCost: 0,
    availableFor: ['warrior'],
    desc: 'HP6消費、毎ターン敵HP-8を3ターン継続',
    execute: (p, e) => {
      if (p.hp <= 6) { log('HPが足りない！', 'warn'); return 0; }
      p.hp -= 6;
      e._darkCurseTurns = 3;
      e._darkCurseDmg = 8;
      spawnPopup(e.x, e.y, `🌀暗黒呪縛！`, '#4400cc');
      spawnPopup(G.px, G.py, `-6HP`, '#e84040');
      log(`暗黒呪縛！ HP6消費、${e.name}に毎ターン-8を3ターン付与！`, 'warn');
      return 0;
    }
  },
  turbulence: {
    id: 'turbulence', name: '乱気流', icon: '🌪', mpCost: 0,
    availableFor: ['warrior'],
    desc: 'HP15消費、ATK×0.7で3〜6回攻撃',
    execute: (p, e) => {
      if (p.hp <= 15) { log('HPが足りない！', 'warn'); return 0; }
      p.hp -= 15;
      const hits = 3 + Math.floor(Math.random() * 4);
      let total = 0;
      for (let i = 0; i < hits; i++) {
        const dmg = Math.max(1, Math.floor(p.atk * 0.7 + Math.floor(Math.random() * 3) - e.def));
        total += dmg;
        e.hp -= dmg;
        if (e.hp <= 0) break;
      }
      spawnPopup(e.x, e.y, `🌪${total}`, '#8844ff');
      spawnPopup(G.px, G.py, `-15HP`, '#e84040');
      log(`乱気流${hits}連撃！ HP15消費、合計${total}ダメージ！`, 'combat');
      return total;
    }
  },
  kill_strike: {
    id: 'kill_strike', name: 'キル', icon: '💥', mpCost: 0,
    availableFor: ['warrior'],
    desc: 'HP10消費、通常50%/エリート25%で即死（ボス無効）、外れたら5〜20ダメージ',
    execute: (p, e) => {
      if (p.hp <= 10) { log('HPが足りない！', 'warn'); return 0; }
      p.hp -= 10;
      spawnPopup(G.px, G.py, `-10HP`, '#e84040');
      if (e.kind === 'boss') {
        const dmg = 5 + Math.floor(Math.random() * 16);
        e.hp -= dmg;
        spawnPopup(e.x, e.y, `💥${dmg}`, '#ff4444');
        log(`キル！ ボスには効かない…${dmg}ダメージ！`, 'warn');
        return dmg;
      }
      const rate = e.kind === 'elite' ? 0.25 : 0.5;
      if (Math.random() < rate) {
        const killDmg = e.hp;
        e.hp = 0;
        spawnPopup(e.x, e.y, `💥即死！`, '#ff00ff');
        log(`キル！！ ${e.name}を即死させた！！`, 'warn');
        return killDmg;
      } else {
        const dmg = 5 + Math.floor(Math.random() * 16);
        e.hp -= dmg;
        spawnPopup(e.x, e.y, `💥${dmg}`, '#ff4444');
        log(`キル…外れた！${dmg}ダメージ！`, 'warn');
        return dmg;
      }
    }
  },


};

// ══════════════════════════════════════════════════════════
//  SKILL POOL
// ══════════════════════════════════════════════════════════
const ALL_SKILLS = [
  {
    id: 'hp_up', name: '鉄の意志', icon: '❤️', type: 'boost', stackable: true, maxStack: 5,
    desc: '最大HPを+10、現在HPも+10',
    apply: p => { p.maxHp += 10; p.hp = Math.min(p.hp + 10, p.maxHp); }
  },
  {
    id: 'atk_up', name: '剛力', icon: '💪', type: 'boost', stackable: true, maxStack: 5,
    desc: 'ATKを+4',
    apply: p => { p.atk += 4; }
  },
  {
    id: 'def_up', name: '堅牢', icon: '🛡', type: 'boost', stackable: true, maxStack: 5,
    desc: 'DEFを+3',
    apply: p => { p.def += 3; }
  },
  {
    id: 'mp_up', name: '魔力の器', icon: '💧', type: 'boost', stackable: true, maxStack: 5,
    desc: '最大MPを+8、現在MPも+8',
    apply: p => { p.maxMp += 8; p.mp = Math.min(p.mp + 8, p.maxMp); }
  },
  {
    id: 'thorns', name: '返し刃', icon: '🌵', type: 'passive',
    desc: '受けたダメージの20%を敵に反射',
    apply: p => { p.passives.thorns = (p.passives.thorns || 0) + 0.2; }
  },
  {
    id: 'leech', name: '生命吸収', icon: '🩸', type: 'passive',
    desc: '通常攻撃ダメージの25%をHP回復',
    apply: p => { p.passives.leech = (p.passives.leech || 0) + 0.25; }
  },

  {
    id: 'regen', name: '自然回復', icon: '🌿', type: 'passive',
    desc: '移動ごとにHP+1（100歩まで）',
    apply: p => { p.passives.regen = (p.passives.regen || 0) + 1; }
  },
  {
    id: 'mp_regen', name: '魔力循環', icon: '🔵', type: 'passive',
    desc: '移動ごとにMP+1（最大まで）',
    apply: p => { p.passives.mpRegen = (p.passives.mpRegen || 0) + 1; }
  },

  {
    id: 'lucky', name: '強運', icon: '🍀', type: 'passive',
    desc: 'アイテムドロップ率+30%',
    apply: p => { p.passives.luck = (p.passives.luck || 0) + 0.3; }
  },
  {
    id: 'crit_up', name: '必殺剣', icon: '⚡', type: 'active',
    desc: '会心率+20%、会心ダメージ×2.5倍',
    apply: p => {
      p.passives.critRate = (p.passives.critRate || 0) + 0.2;
      p.passives.critMult = (p.passives.critMult || 2) + 0.5;
    }
  },
  {
    id: 'pierce', name: '貫通撃', icon: '🏹', type: 'active',
    desc: '通常攻撃が敵のDEFを無視する',
    apply: p => { p.passives.pierce = true; }
  },
  {
    id: 'aoe', name: '旋風斬', icon: '🌀', type: 'active',
    desc: '攻撃時に追加ダメージ(ATK×0.5)を確率50%で加算',
    apply: p => { p.passives.aoe = true; }
  },
  {
    id: 'cheap_mag', name: '魔力節約', icon: '🌟', type: 'active',
    desc: '魔法消費MP-1（最小1）',
    apply: p => { p.passives.magDiscount = (p.passives.magDiscount || 0) + 1; }
  },
  {
    id: 'barrier', name: '魔法障壁', icon: '🔮', type: 'passive',
    desc: '毎戦闘開始時にダメージ軽減シールド(5)を発動',
    apply: p => { p.passives.barrier = (p.passives.barrier || 0) + 5; }
  },
  {
    id: 'mage_overload', name: 'オーバーロード', icon: '💥', type: 'boost',
    onlyClass: 'mage',
    desc: '魔法ダメージ+50%。MP消費+1',
    apply: p => {
      p.passives.magBoost = (p.passives.magBoost || 1) * 1.5;
      p.passives.magExtraCost = (p.passives.magExtraCost || 0) + 1;
    }
  },
  {
    id: 'mage_focus', name: '精神集中', icon: '🧠', type: 'passive',
    onlyClass: 'mage',
    desc: '移動ごとにMP+2追加回復',
    apply: p => { p.passives.mpRegen = (p.passives.mpRegen || 0) + 2; }
  },
  {
    id: 'mage_chain', name: 'チェイン魔法', icon: '🌀', type: 'passive',
    onlyClass: 'mage',
    desc: '魔法攻撃後30%で追加魔法発動（MP消費なし）',
    apply: p => { p.passives.chainMag = (p.passives.chainMag || 0) + 0.3; }
  },
  {
    id: 'mage_drain', name: '吸魔の呪文', icon: '💜', type: 'passive',
    onlyClass: 'mage',
    desc: '魔法ダメージの20%をMPとして回収',
    apply: p => { p.passives.magDrain = (p.passives.magDrain || 0) + 0.2; }
  },
  {
    id: 'mage_arcane', name: '秘術の極み', icon: '✨', type: 'boost',
    onlyClass: 'mage',
    desc: '魔法ダメージ×1.5倍',
    apply: p => { p.passives.magBoost = (p.passives.magBoost || 1) * 1.5; }
  },
  {
    id: 'mage_shield', name: 'マナシールド', icon: '🔮', type: 'passive',
    onlyClass: 'mage',
    desc: 'HPの代わりにMPでダメージを肩代わり',
    apply: p => { p.passives.manaShield = true; }
  },
  {
    id: 'first_strike', name: '先手必勝', icon: '⚡', type: 'passive',
    desc: '戦闘開始時に必ず先制',
    apply: p => { p.passives.firstStrike = 1.0; }
  },
  {
    id: 'exp_up', name: '経験値UP', icon: '📈', type: 'passive',
    desc: '獲得EXP+20%',
    apply: p => { p.passives.expBoost = (p.passives.expBoost || 1) + 0.2; }
  },
  {
    id: 'item_boost', name: '節約術', icon: '🎒', type: 'passive',
    desc: 'アイテム使用時の効果+20%',
    apply: p => { p.passives.itemBoost = (p.passives.itemBoost || 1) + 0.2; }
  },
  {
    id: 'hawk_eye', name: '鷹の目', icon: '🦅', type: 'passive',
    desc: '会心率+10%',
    apply: p => { p.passives.critRate = (p.passives.critRate || 0) + 0.1; }
  },
  {
    id: 'treasure_hunter', name: '財宝探知', icon: '🗺', type: 'passive',
    desc: '宝箱の出現率+20%',
    apply: p => { p.passives.treasureBoost = (p.passives.treasureBoost || 0) + 0.2; }
  },

];

// dungeon.js に追加
const ROGUE_LEVELUP_SKILLS = [
  {
    id: 'r_lv_poison_up', name: '毒強化', icon: '🐍', type: 'boost',
    onlyClass: 'rogue',
    desc: '毒スタックのダメージ+2（毎ターンの毒ダメージが増加）',
    apply: p => { p.passives.poisonBonus = (p.passives.poisonBonus || 0) + 2; }
  },
  {
    id: 'r_lv_evade_up', name: '神速', icon: '💨', type: 'passive',
    onlyClass: 'rogue',
    desc: '基本回避率+15%',
    apply: p => { p.passives.dodge = (p.passives.dodge || 0) + 0.15; }
  },
  {
    id: 'r_lv_escape', name: '脱兎', icon: '🐇', type: 'passive',
    onlyClass: 'rogue',
    desc: '逃走成功率+20%',
    apply: p => { p.passives.escapeBonus = (p.passives.escapeBonus || 0) + 0.2; }
  },
  {
    id: 'r_lv_gold', name: '強奪', icon: '💰', type: 'passive',
    onlyClass: 'rogue',
    desc: '獲得ゴールド+40%',
    apply: p => { p.passives.luck = (p.passives.luck || 0) + 0.4; }
  },
  {
    id: 'r_lv_mp_up', name: '忍の呼吸', icon: '🔵', type: 'boost',
    onlyClass: 'rogue',
    desc: '最大MP+6、移動ごとにMP+1回復',
    apply: p => {
      p.maxMp += 6; p.mp = Math.min(p.mp + 6, p.maxMp);
      p.passives.mpRegen = (p.passives.mpRegen || 0) + 1;
    }
  },
];
const CLERIC_LEVELUP_SKILLS = [
  {
    id: 'c_lv_heal_up', name: '回復強化', icon: '💚', type: 'boost',
    onlyClass: 'cleric',
    desc: '回復アイテムの回復量+50%',
    apply: p => { p.passives.healBoost = (p.passives.healBoost || 1) * 1.5; }
  },
  {
    id: 'c_lv_holy', name: '聖光強化', icon: '☀', type: 'passive',
    onlyClass: 'cleric',
    desc: '魔法ダメージ+30%',
    apply: p => { p.passives.holyBoost = (p.passives.holyBoost || 0) + 0.3; }
  },
  {
    id: 'c_lv_bless', name: '祝福', icon: '🙏', type: 'passive',
    onlyClass: 'cleric',
    desc: '戦闘開始時にHP+10回復',
    apply: p => { p.passives.blessHeal = (p.passives.blessHeal || 0) + 10; }
  },
  {
    id: 'c_lv_smite', name: '神罰強化', icon: '⚡', type: 'passive',
    onlyClass: 'cleric',
    desc: '通常攻撃に追加聖ダメージ（ATKの40%）を付与',
    apply: p => { p.passives.smite = (p.passives.smite || 0) + 0.4; }
  },
  {
    id: 'c_lv_resurrection', name: '復活の祈り', icon: '✝', type: 'passive',
    onlyClass: 'cleric',
    desc: '一度だけ戦闘で倒れたとき、HP25%で蘇生（効果は一回のみ）',
    apply: p => { p.passives.resurrection = true; }
  },
  {
    id: 'c_lv_divine', name: '神の加護', icon: '👼', type: 'passive',
    onlyClass: 'cleric',
    desc: '受けるすべてのダメージ-20%',
    apply: p => { p.passives.divineGuard = (p.passives.divineGuard || 0) + 0.2; }
  },
];
const DARK_WARRIOR_LEVELUP_SKILLS = [
  {
    id: 'dw_lv_hp_drain', name: '闇の生命力', icon: '🖤', type: 'passive',
    onlyClass: 'warrior',
    desc: '通常攻撃ダメージの40%をHP回復',
    apply: p => { p.passives.leech = (p.passives.leech || 0) + 0.4; }
  },
  {
    id: 'dw_lv_dark_atk', name: '闇力覚醒', icon: '🌑', type: 'boost',
    onlyClass: 'warrior',
    desc: 'ATK+8、HP消費スキルのHP消費-2',
    apply: p => { p.atk += 8; p.passives.darkCostReduce = (p.passives.darkCostReduce || 0) + 2; }
  },
  {
    id: 'dw_lv_curse_master', name: '呪詛の極み', icon: '⛓', type: 'passive',
    onlyClass: 'warrior',
    desc: '呪い・恐怖・暗黒呪縛の継続ターン+2',
    apply: p => { p.passives.darkDebuffExtend = (p.passives.darkDebuffExtend || 0) + 2; }
  },
  {
    id: 'dw_lv_pain_feed', name: '苦痛の糧', icon: '💢', type: 'passive',
    onlyClass: 'warrior',
    desc: 'HP消費スキル使用時、消費量の50%をATKに一時加算（1ターン）',
    apply: p => { p.passives.painFeed = (p.passives.painFeed || 0) + 0.5; }
  },
  {
    id: 'dw_lv_dark_regen', name: '闇の再生(50歩まで)', icon: '🌿', type: 'passive',
    onlyClass: 'warrior',
    desc: '移動ごとにHP+3回復',
    apply: p => { p.passives.regen = (p.passives.regen || 0) + 3; }
  },
  {
    id: 'dw_lv_soul_armor', name: '魂の鎧', icon: '👁', type: 'boost',
    onlyClass: 'warrior',
    desc: '最大HP+20、被ダメージの15%を敵に反射',
    apply: p => {
      p.maxHp += 20; p.hp = Math.min(p.hp + 20, p.maxHp);
      p.passives.thorns = (p.passives.thorns || 0) + 0.15;
    }
  },
];

// 職業固有スキルコマンドのLvUP選択肢プール
const WARRIOR_LEVELUP_SKILLS = ['critical_thrust', 'multi_slash'];
const MAGE_LEVELUP_SKILLS = {
  fire: ['fire_small', 'fire_mid', 'fire_large'],
  ice: ['ice_small', 'ice_mid', 'ice_large'],
  wind: ['wind_small', 'wind_mid', 'wind_large'],
};




// ══════════════════════════════════════════════════════════
//  SHOP SYSTEM
// ══════════════════════════════════════════════════════════
const SHOP_WEAPONS = [
  { name: '銀の剣', atkBonus: 5, price: 40, floor: 1 },
  { name: 'フレイム刃', atkBonus: 8, price: 70, floor: 3 },
  { name: '魔法剣', atkBonus: 12, price: 110, floor: 5 },
  { name: '聖剣', atkBonus: 18, price: 160, floor: 7 },
  { name: 'デーモン刃', atkBonus: 25, price: 220, floor: 10 },
];
const SHOP_ARMORS = [
  { name: '革の鎧', defBonus: 3, price: 35, floor: 1 },
  { name: '鎖帷子', defBonus: 5, price: 60, floor: 3 },
  { name: '板金鎧', defBonus: 8, price: 100, floor: 5 },
  { name: '魔法鎧', defBonus: 11, price: 150, floor: 7 },
  { name: '神聖鎧', defBonus: 15, price: 210, floor: 10 },
];
const SHOP_ITEMS = [
  { name: '回復薬', type: 'heal', val: 20, price: 20 },
  { name: '上位回復薬', type: 'heal', val: 40, price: 45 },
  { name: 'エリクサー', type: 'heal', val: 999, price: 120 },
  { name: '魔法薬', type: 'mpheal', val: 10, price: 30 },
  { name: '煙玉', type: 'smoke', val: 0, price: 25 },
];

function generateShopStock(floor) {
  const stock = [];

  const shuffledItems = [...SHOP_ITEMS].sort(() => Math.random() - 0.5);
  for (let i = 0; i < 3; i++) {
    const it = shuffledItems[i % shuffledItems.length];
    stock.push({ kind: 'item', icon: '🧪', tag: 'itm', ...it, sold: false });
  }

  const availWpn = SHOP_WEAPONS.filter(w => w.floor <= floor + 1);
  const shuffledWpn = [...availWpn].sort(() => Math.random() - 0.5);
  for (let i = 0; i < 3; i++) {
    const w = shuffledWpn[i % Math.max(shuffledWpn.length, 1)];
    if (!w) continue;
    stock.push({
      kind: 'weapon', icon: '⚔', tag: 'wpn',
      name: w.name, desc: `ATK +${w.atkBonus}`, atkBonus: w.atkBonus,
      price: w.price + Math.floor(floor * 8), sold: false
    });
  }

  // 商売屋限定スキルプール（HP循環・魔力循環を含む）
  const SHOP_EXCLUSIVE_SKILLS = [
    {
      id: 'iron_wall_up', name: '鉄壁強化', icon: '🛡', type: 'passive',
      desc: '鉄壁の発動ターン+2',
      apply: p => { p.passives.ironWallBonus = (p.passives.ironWallBonus || 0) + 2; }
    },
    {
      id: 'fortress_body', name: '不屈の肉体', icon: '💪', type: 'boost',
      desc: '最大HP+20、DEF+3',
      apply: p => { p.maxHp += 20; p.hp = Math.min(p.hp + 20, p.maxHp); p.def += 3; }
    },
    {
      id: 'counter_will', name: '反撃の意志', icon: '⚔', type: 'passive',
      desc: '鉄壁反撃時にATK×0.3の追加ダメージ',
      apply: p => { p.passives.counterWill = (p.passives.counterWill || 0) + 0.3; }
    },

    {
      id: 'regen', name: '自然回復', icon: '🌿', type: 'passive',
      desc: '移動ごとにHP+1（100歩まで）',
      apply: p => { p.passives.regen = (p.passives.regen || 0) + 1; }
    },
    {
      id: 'mp_regen', name: '魔力循環', icon: '🔵', type: 'passive',
      desc: '移動ごとにMP+1（最大まで）',
      apply: p => { p.passives.mpRegen = (p.passives.mpRegen || 0) + 1; }
    },
  ];

  // 通常スキルプールからregen/mp_regenを除外し、商売屋限定を追加
  const generalSkillPool = ALL_SKILLS.filter(s =>
    s.id !== 'regen' && s.id !== 'mp_regen'
  );

  // 商売屋限定を必ず1〜2枠確保、残りを通常スキルで埋める
  const shuffledExclusive = [...SHOP_EXCLUSIVE_SKILLS].sort(() => Math.random() - 0.5);
  const shuffledGeneral = [...generalSkillPool].sort(() => Math.random() - 0.5);

  // 限定スキルの枠数をランダムに1〜2枠
  const exclusiveSlots = 1 + Math.floor(Math.random() * 2); // 1 or 2
  const skillPick = [];

  for (let i = 0; i < exclusiveSlots && i < shuffledExclusive.length; i++) {
    skillPick.push(shuffledExclusive[i]);
  }
  for (let i = 0; skillPick.length < 3 && i < shuffledGeneral.length; i++) {
    skillPick.push(shuffledGeneral[i]);
  }

  skillPick.forEach(s => {
    stock.push({
      kind: 'skill', icon: s.icon, tag: 'skill',
      name: s.name, desc: s.desc, skillRef: s,
      price: 60 + Math.floor(floor * 15), sold: false
    });
  });

  return stock.slice(0, 9);
}

function openShop() {
  if (!G.shopStock) G.shopStock = generateShopStock(G.floor);
  renderShopModal();
  document.getElementById('shop-modal').classList.add('active');
  G.inShop = true;
  log('商売屋に入った！', 'shop');
}

function closeShop() {
  document.getElementById('shop-modal').classList.remove('active');
  G.inShop = false;
}

function renderShopModal() {
  const p = G.player;
  document.getElementById('shop-gold-val').textContent = p.gold;
  const grid = document.getElementById('shop-items-grid');
  grid.innerHTML = G.shopStock.map((item, idx) => {
    const canAfford = p.gold >= item.price;
    const cls = item.sold ? 'sold-out' : !canAfford ? 'cant-afford' : '';
    return `<div class="shop-item-card ${cls}" onclick="buyShopItem(${idx})">
      <span class="shop-item-icon">${item.icon}</span>
      <span class="shop-item-tag shop-tag-${item.tag}">${item.tag === 'wpn' ? '武器' : item.tag === 'arm' ? '防具' : item.tag === 'skill' ? 'スキル' : 'アイテム'
      }</span>
      <span class="shop-item-name">${item.name}</span>
      <div class="shop-item-desc">${item.desc || ''}</div>
      <div class="shop-price">${item.price}G</div>
    </div>`;
  }).join('');
}

function buyShopItem(idx) {
  const item = G.shopStock[idx];
  if (!item || item.sold) return;
  const p = G.player;
  if (p.gold < item.price) { log('ゴールドが足りない！', 'warn'); return; }

  p.gold -= item.price;

  if (item.kind === 'weapon') {
    p.equip.wpn = item.name;
    const oldBonus = p.equip.wpnBonus || 0;
    p.equip.wpnBonus = item.atkBonus;
    p.atk = p.atk - oldBonus + item.atkBonus;
    updateEquipDisplay();
    log(`${item.name}を購入！ ATK+${item.atkBonus}`, 'loot');
  } else if (item.kind === 'armor') {
    p.equip.arm = item.name;
    const oldBonus = p.equip.armBonus || 0;
    p.equip.armBonus = item.defBonus;
    p.def = p.def - oldBonus + item.defBonus;
    updateEquipDisplay();
    log(`${item.name}を購入！ DEF+${item.defBonus}`, 'loot');
  } else if (item.kind === 'skill') {
    const skill = item.skillRef;
    skill.apply(p);
    p.skills.push(skill);
    renderSkillList();
    log(`スキル「${item.name}」を購入！`, 'warn');
  } else {
    addItem({ name: item.name, type: item.type, val: item.val });
    log(`${item.name}を購入！`, 'good');
  }

  item.sold = true;
  renderShopModal();
  updateUI();
}

// ══════════════════════════════════════════════════════════
//  ENEMY TYPES
// ══════════════════════════════════════════════════════════
const ENEMY_TYPES = [
  { name: 'スライム', hp: 15, atk: 4, def: 2, exp: 3, gold: 5, color: '#3ecc6f' },
  { name: 'コウモリ', hp: 13, atk: 5, def: 0, exp: 3, gold: 10, color: '#888888' },
  { name: 'スケルトン', hp: 9, atk: 9, def: 0, exp: 6, gold: 5, color: '#dddddd' },
  { name: 'オーク', hp: 23, atk: 8, def: 4, exp: 8, gold: 12, color: '#8fbc5a' },
  { name: 'ゴブリン', hp: 14, atk: 7, def: 2, exp: 5, gold: 5, color: '#ff9900' },
  { name: 'ゾンビ', hp: 27, atk: 8, def: 2, exp: 10, gold: 10, color: '#66cc88' },
  { name: 'デーモン', hp: 35, atk: 12, def: 4, exp: 15, gold: 20, color: '#cc0066' },
  { name: 'エンジェル', hp: 42, atk: 10, def: 5, exp: 18, gold: 22, color: '#ffffaa' },
  { name: 'リザードマン', hp: 37, atk: 15, def: 4, exp: 25, gold: 20, color: '#44bb44' },
  { name: 'ドラゴン', hp: 45, atk: 13, def: 7, exp: 30, gold: 22, color: '#ff4400' },
];
// 敵の行動パターン定義
const ENEMY_PATTERNS = {
  'スライム': { actions: ['atk', 'atk', 'buff'], phase2: null },
  'コウモリ': { actions: ['atk', 'atk', 'poison'], phase2: null },
  'スケルトン': { actions: ['atk', 'atk', 'defend'], phase2: null },
  'オーク': { actions: ['atk', 'slam', 'defend'], phase2: 'slam' },
  'ゴブリン': { actions: ['atk', 'poison', 'atk'], phase2: null },
  'ゾンビ': { actions: ['atk', 'atk', 'regen'], phase2: 'atk' },
  'デーモン': { actions: ['atk', 'slam', 'burn'], phase2: 'burn' },
  'エンジェル': { actions: ['atk', 'buff', 'heal'], phase2: 'heal' },
  'リザードマン': { actions: ['atk', 'slam', 'poison'], phase2: 'slam' },
  'ドラゴン': { actions: ['slam', 'burn', 'atk'], phase2: 'burn' },
};

const INTENT_INFO = {
  atk: { icon: '⚔', label: '攻撃してくる', cls: 'intent-atk' },
  slam: { icon: '💥', label: '強撃を放つ', cls: 'intent-atk' },
  burn: { icon: '🔥', label: '炎攻撃をしてくる', cls: 'intent-atk' },
  poison: { icon: '🐍', label: '毒を使ってくる', cls: 'intent-atk' },
  buff: { icon: '💪', label: '自己強化する', cls: 'intent-buff' },
  defend: { icon: '🛡', label: '防御態勢をとる', cls: 'intent-buff' },
  heal: { icon: '💚', label: '回復する', cls: 'intent-heal' },
  regen: { icon: '🌿', label: '再生する', cls: 'intent-heal' },
  drain: { icon: '💜', label: 'MPを吸収する', cls: 'intent-buff' },
};


const ELITE_TYPES = [
  { name: '死神騎士', hp: 35, atk: 10, def: 4, exp: 20, gold: 80, color: '#cc44ff', special: 'drain' },
  { name: '溶岩巨人', hp: 50, atk: 8, def: 6, exp: 25, gold: 80, color: '#ff6622', special: 'burn' },
  { name: '影の暗殺者', hp: 22, atk: 14, def: 2, exp: 22, gold: 80, color: '#8844ff', special: 'crit' },
  { name: '魔将軍', hp: 45, atk: 11, def: 5, exp: 28, gold: 80, color: '#ff44aa', special: 'buff' },
  // ハードモード専用エリート
  { name: '氷刃の狩人', hp: 38, atk: 8, def: 4, exp: 30, gold: 100, color: '#88ccff', special: 'skillweaken', hardOnly: true },
  { name: '雷光の剣士', hp: 32, atk: 7, def: 3, exp: 30, gold: 100, color: '#ffff44', special: 'multilow', hardOnly: true },
  { name: '闇の司祭', hp: 42, atk: 6, def: 3, exp: 30, gold: 100, color: '#8844aa', special: 'healdef', hardOnly: true },
  { name: '無属の釈迦', hp: 55, atk: 9, def: 6, exp: 35, gold: 100, color: '#ff8844', special: 'burnplus', hardOnly: true },
];

const BOSS_TYPES = [
  { name: '地下王 ゴーレム', hp: 80, atk: 12, def: 6, exp: 50, gold: 150, color: '#8899aa', special: 'slam', phase2Atk: 16 },
  { name: '炎王 イフリート', hp: 100, atk: 15, def: 5, exp: 70, gold: 200, color: '#ff4400', special: 'burn', phase2Atk: 20 },
  { name: '深淵龍 ヴォルグ', hp: 130, atk: 18, def: 8, exp: 100, gold: 300, color: '#aa22ff', special: 'drain', phase2Atk: 25 },
  { name: '魔王 ダルクロア', hp: 200, atk: 22, def: 10, exp: 150, gold: 10000000, color: '#ff2266', special: 'buff', phase2Atk: 30 },
];
const HARD_BOSS_TYPES = [
  {
    name: '岩王 グラニウス', hp: 90, atk: 13, def: 8, exp: 60, gold: 200,
    color: '#888866', special: 'slam', phase2Atk: 17
  },
  {
    name: '炎獣 イグナール', hp: 110, atk: 16, def: 6, exp: 80, gold: 250,
    color: '#ff6600', special: 'burn', phase2Atk: 20
  },
  {
    name: '雷皇 ザンヴォルト', hp: 140, atk: 18, def: 7, exp: 110, gold: 320,
    color: '#ffff44', special: 'multi', phase2Atk: 18
  },
  {
    name: '深淵神 アビサル', hp: 170, atk: 20, def: 9, exp: 140, gold: 400,
    color: '#4422aa', special: 'abyss', phase2Atk: 26
  },
  {
    name: '混沌王 カオスロード', hp: 220, atk: 24, def: 11, exp: 180, gold: 10000000,
    color: '#ff22ff', special: 'chaos', phase2Atk: 30
  },
];

function pickEnemyIntent(actions, lastIntent = null, secondLastIntent = null) {
  const pool = (actions && actions.length ? actions : ['atk']).filter(Boolean);
  let candidates = pool;

  if (lastIntent && secondLastIntent && lastIntent === secondLastIntent && pool.length > 1) {
    candidates = pool.filter(action => action !== lastIntent);
  }

  return candidates[Math.floor(Math.random() * candidates.length)] || 'atk';
}

function pickBossIntent(special) {
  const intentTable = {
    slam: ['atk', 'slam', 'atk'],
    burn: ['atk', 'burn', 'slam'],
    drain: ['atk', 'drain', 'slam'],
    buff: ['atk', 'buff', 'slam'],
    multi: ['atk', 'multi', 'atk'],
    abyss: ['atk', 'abyss_def', 'slam'],
    chaos: ['atk', 'burn', 'drain', 'multi', 'buff', 'slam'],
  };

  return pickEnemyIntent(intentTable[special] || ['atk']);
}

function makeBoss(x, y, floor, bossIdx) {
  const bossList = G.mode === 'hard' ? HARD_BOSS_TYPES : BOSS_TYPES;
  const base = bossList[Math.min(bossIdx, bossList.length - 1)] || BOSS_TYPES[0];
  const isHard = G.mode === 'hard';
  const scale = isHard ? 1 + Math.max(0, floor - 5) * 0.03 : 1;
  const hp = Math.ceil(base.hp * scale);

  return {
    ...base,
    x, y,
    hp,
    maxHp: hp,
    atk: Math.ceil(base.atk * scale),
    def: Math.ceil(base.def * scale),
    kind: 'boss',
    phase2: false,
    buffed: false,
    firstTurn: true,
    nextIntent: pickBossIntent(base.special),
  };
}

// ══════════════════════════════════════════════════════════
//  GAME STATE
// ══════════════════════════════════════════════════════════
let G = {};
let selectedClass = null;
let combatMenuIndex = 0;

// コマンドは2×2グリッド配置:
//   0:たたかう  1:まほう
//   2:アイテム  3:にげる
const combatCommands = ['atk', 'mag', 'itm', 'run'];
const COMBAT_COLS = 2; // グリッドの列数

// ══════════════════════════════════════════════════════════
//  ENEMY SPRITE RENDERER  (pixel art procedural)
// ══════════════════════════════════════════════════════════
// ─── スライム ───
function drawSprite_Slime(ctx, W, H, color, isBoss) {
  const cx = W / 2, cy = H / 2;
  const r = isBoss ? 30 : 20;
  // 体（楕円を矩形で近似）
  ctx.fillStyle = color;
  ctx.fillRect(cx - r, cy - r * 0.6, r * 2, r * 1.4);
  ctx.fillRect(cx - r * 0.8, cy - r, r * 1.6, r * 0.5);
  ctx.fillRect(cx - r * 0.5, cy - r * 1.2, r, r * 0.3);
  // ハイライト
  ctx.fillStyle = color + 'aa';
  ctx.fillRect(cx - r * 0.4, cy - r * 0.9, r * 0.5, r * 0.3);
  // 触手
  ctx.fillStyle = color;
  ctx.fillRect(cx - r - 4, cy - r * 0.2, 5, r * 0.8);
  ctx.fillRect(cx + r - 1, cy - r * 0.2, 5, r * 0.8);
  // 目（白）
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cx - r * 0.35, cy - r * 0.2, 8, 8);
  ctx.fillRect(cx + r * 0.1, cy - r * 0.2, 8, 8);
  // 瞳（黒）
  ctx.fillStyle = '#000000';
  ctx.fillRect(cx - r * 0.35 + 2, cy - r * 0.2 + 2, 4, 4);
  ctx.fillRect(cx + r * 0.1 + 2, cy - r * 0.2 + 2, 4, 4);
}

// ─── コウモリ ───
function drawSprite_Bat(ctx, W, H, color, isBoss) {
  const cx = W / 2, cy = H / 2;
  const s = isBoss ? 1.5 : 1;
  // 翼（左）
  ctx.fillStyle = color;
  ctx.fillRect(cx - 36 * s, cy - 10 * s, 22 * s, 14 * s);
  ctx.fillRect(cx - 38 * s, cy - 18 * s, 14 * s, 10 * s);
  ctx.fillRect(cx - 40 * s, cy - 26 * s, 8 * s, 10 * s);
  // 翼（右）
  ctx.fillRect(cx + 14 * s, cy - 10 * s, 22 * s, 14 * s);
  ctx.fillRect(cx + 24 * s, cy - 18 * s, 14 * s, 10 * s);
  ctx.fillRect(cx + 32 * s, cy - 26 * s, 8 * s, 10 * s);
  // 体
  ctx.fillRect(cx - 12 * s, cy - 8 * s, 24 * s, 22 * s);
  // 頭
  ctx.fillRect(cx - 10 * s, cy - 22 * s, 20 * s, 16 * s);
  // 耳
  ctx.fillRect(cx - 10 * s, cy - 32 * s, 6 * s, 12 * s);
  ctx.fillRect(cx + 4 * s, cy - 32 * s, 6 * s, 12 * s);
  // 目（赤）
  ctx.fillStyle = '#ff4444';
  ctx.fillRect(cx - 8 * s, cy - 18 * s, 6 * s, 5 * s);
  ctx.fillRect(cx + 2 * s, cy - 18 * s, 6 * s, 5 * s);
  // 牙
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cx - 5 * s, cy - 8 * s, 4 * s, 6 * s);
  ctx.fillRect(cx + 1 * s, cy - 8 * s, 4 * s, 6 * s);
}

// ─── スケルトン ───
function drawSprite_Skeleton(ctx, W, H, color, isBoss) {
  const cx = W / 2, cy = H / 2 + 4;
  const s = isBoss ? 1.4 : 1;
  ctx.fillStyle = '#dddddd';
  // 頭蓋骨
  ctx.fillRect(cx - 12 * s, cy - 34 * s, 24 * s, 20 * s);
  ctx.fillRect(cx - 14 * s, cy - 28 * s, 28 * s, 12 * s);
  // 顎
  ctx.fillRect(cx - 10 * s, cy - 16 * s, 20 * s, 6 * s);
  // 眼窩
  ctx.fillStyle = '#000033';
  ctx.fillRect(cx - 11 * s, cy - 31 * s, 8 * s, 9 * s);
  ctx.fillRect(cx + 3 * s, cy - 31 * s, 8 * s, 9 * s);
  ctx.fillStyle = '#3344ff88';
  ctx.fillRect(cx - 9 * s, cy - 29 * s, 4 * s, 5 * s);
  ctx.fillRect(cx + 5 * s, cy - 29 * s, 4 * s, 5 * s);
  // 脊椎
  ctx.fillStyle = '#cccccc';
  for (let i = 0; i < 5; i++) {
    ctx.fillRect(cx - 3 * s, cy - 8 * s + i * 6 * s, 6 * s, 4 * s);
  }
  // 肋骨
  for (let i = 0; i < 3; i++) {
    ctx.fillRect(cx - 14 * s, cy - 6 * s + i * 7 * s, 10 * s, 4 * s);
    ctx.fillRect(cx + 4 * s, cy - 6 * s + i * 7 * s, 10 * s, 4 * s);
  }
  // 腕
  ctx.fillRect(cx - 18 * s, cy - 8 * s, 6 * s, 22 * s);
  ctx.fillRect(cx + 12 * s, cy - 8 * s, 6 * s, 22 * s);
  // 剣
  ctx.fillStyle = '#aaaacc';
  ctx.fillRect(cx - 22 * s, cy + 10 * s, 4 * s, 18 * s);
  ctx.fillStyle = '#888899';
  ctx.fillRect(cx - 26 * s, cy + 14 * s, 12 * s, 3 * s);
  // 脚
  ctx.fillStyle = '#cccccc';
  ctx.fillRect(cx - 10 * s, cy + 20 * s, 7 * s, 16 * s);
  ctx.fillRect(cx + 3 * s, cy + 20 * s, 7 * s, 16 * s);
}

// ─── オーク ───
function drawSprite_Orc(ctx, W, H, color, isBoss) {
  const cx = W / 2, cy = H / 2 + 4;
  const s = isBoss ? 1.4 : 1;
  // 体（がっしり）
  ctx.fillStyle = color;
  ctx.fillRect(cx - 18 * s, cy - 18 * s, 36 * s, 30 * s);
  // 肩（広い）
  ctx.fillRect(cx - 24 * s, cy - 16 * s, 10 * s, 18 * s);
  ctx.fillRect(cx + 14 * s, cy - 16 * s, 10 * s, 18 * s);
  // 頭（大きい）
  ctx.fillRect(cx - 14 * s, cy - 36 * s, 28 * s, 20 * s);
  // 牙
  ctx.fillStyle = '#ffeecc';
  ctx.fillRect(cx - 8 * s, cy - 18 * s, 5 * s, 8 * s);
  ctx.fillRect(cx + 3 * s, cy - 18 * s, 5 * s, 8 * s);
  // 目
  ctx.fillStyle = '#ff4400';
  ctx.fillRect(cx - 10 * s, cy - 32 * s, 7 * s, 6 * s);
  ctx.fillRect(cx + 3 * s, cy - 32 * s, 7 * s, 6 * s);
  // 鼻
  ctx.fillStyle = color;
  ctx.fillRect(cx - 3 * s, cy - 26 * s, 6 * s, 6 * s);
  // こぶし
  ctx.fillStyle = color;
  ctx.fillRect(cx - 28 * s, cy - 2 * s, 10 * s, 10 * s);
  ctx.fillRect(cx + 18 * s, cy - 2 * s, 10 * s, 10 * s);
  // 脚
  ctx.fillRect(cx - 14 * s, cy + 12 * s, 11 * s, 18 * s);
  ctx.fillRect(cx + 3 * s, cy + 12 * s, 11 * s, 18 * s);
  // 鎧パーツ（胸当て）
  ctx.fillStyle = '#887755';
  ctx.fillRect(cx - 12 * s, cy - 14 * s, 24 * s, 18 * s);
  ctx.fillStyle = '#aA9966';
  ctx.fillRect(cx - 10 * s, cy - 12 * s, 20 * s, 4 * s);
}

// ─── ゴブリン ───
function drawSprite_Goblin(ctx, W, H, color, isBoss) {
  const cx = W / 2, cy = H / 2 + 8;
  const s = isBoss ? 1.4 : 1;
  // 体（小さく）
  ctx.fillStyle = color;
  ctx.fillRect(cx - 10 * s, cy - 14 * s, 20 * s, 20 * s);
  // 頭（大きめ）
  ctx.fillRect(cx - 12 * s, cy - 32 * s, 24 * s, 20 * s);
  // 大きな耳
  ctx.fillRect(cx - 20 * s, cy - 28 * s, 10 * s, 8 * s);
  ctx.fillRect(cx + 10 * s, cy - 28 * s, 10 * s, 8 * s);
  // 目（大きい黄色）
  ctx.fillStyle = '#ffff00';
  ctx.fillRect(cx - 9 * s, cy - 28 * s, 7 * s, 7 * s);
  ctx.fillRect(cx + 2 * s, cy - 28 * s, 7 * s, 7 * s);
  ctx.fillStyle = '#000000';
  ctx.fillRect(cx - 7 * s, cy - 26 * s, 3 * s, 3 * s);
  ctx.fillRect(cx + 4 * s, cy - 26 * s, 3 * s, 3 * s);
  // ナイフ
  ctx.fillStyle = '#aaaaaa';
  ctx.fillRect(cx + 14 * s, cy - 10 * s, 3 * s, 14 * s);
  ctx.fillStyle = '#888888';
  ctx.fillRect(cx + 11 * s, cy - 8 * s, 9 * s, 3 * s);
  // 脚
  ctx.fillStyle = color;
  ctx.fillRect(cx - 8 * s, cy + 6 * s, 7 * s, 12 * s);
  ctx.fillRect(cx + 1 * s, cy + 6 * s, 7 * s, 12 * s);
}

// ─── ゾンビ ───
function drawSprite_Zombie(ctx, W, H, color, isBoss) {
  const cx = W / 2, cy = H / 2 + 4;
  const s = isBoss ? 1.4 : 1;
  const sway = Math.sin(Date.now() * 0.001) * 2;
  // 体（腐敗した緑）
  ctx.fillStyle = color;
  ctx.fillRect(cx - 14 * s + sway, cy - 16 * s, 28 * s, 26 * s);
  // 頭
  ctx.fillRect(cx - 12 * s + sway, cy - 34 * s, 24 * s, 20 * s);
  // 傷口（赤）
  ctx.fillStyle = '#cc2222';
  ctx.fillRect(cx - 5 * s + sway, cy - 28 * s, 10 * s, 3 * s);
  ctx.fillRect(cx - 3 * s + sway, cy - 4 * s, 6 * s, 3 * s);
  // 目（濁った白）
  ctx.fillStyle = '#ccccaa';
  ctx.fillRect(cx - 9 * s + sway, cy - 30 * s, 6 * s, 5 * s);
  ctx.fillRect(cx + 3 * s + sway, cy - 30 * s, 6 * s, 5 * s);
  ctx.fillStyle = '#446644';
  ctx.fillRect(cx - 7 * s + sway, cy - 28 * s, 2 * s, 2 * s);
  ctx.fillRect(cx + 5 * s + sway, cy - 28 * s, 2 * s, 2 * s);
  // 腕（前に伸ばした）
  ctx.fillStyle = color;
  ctx.fillRect(cx - 22 * s + sway, cy - 12 * s, 10 * s, 8 * s);
  ctx.fillRect(cx + 12 * s + sway, cy - 16 * s, 10 * s, 8 * s);
  // 脚
  ctx.fillRect(cx - 11 * s + sway * 0.5, cy + 10 * s, 8 * s, 16 * s);
  ctx.fillRect(cx + 3 * s + sway * 0.5, cy + 14 * s, 8 * s, 16 * s);
}

// ─── デーモン ───
function drawSprite_Demon(ctx, W, H, color, isBoss) {
  const cx = W / 2, cy = H / 2 + 2;
  const s = isBoss ? 1.4 : 1;
  const pulse = Math.sin(Date.now() * 0.002) * 2;
  // 翼
  ctx.fillStyle = '#880022';
  ctx.fillRect(cx - 38 * s, cy - 20 * s, 20 * s, 30 * s);
  ctx.fillRect(cx - 32 * s, cy - 32 * s, 14 * s, 14 * s);
  ctx.fillRect(cx + 18 * s, cy - 20 * s, 20 * s, 30 * s);
  ctx.fillRect(cx + 18 * s, cy - 32 * s, 14 * s, 14 * s);
  // オーラ
  ctx.fillStyle = color + '44';
  ctx.fillRect(cx - 20 * s, cy - 38 * s - pulse, 40 * s, 58 * s + pulse * 2);
  // 体
  ctx.fillStyle = color;
  ctx.fillRect(cx - 16 * s, cy - 16 * s, 32 * s, 28 * s);
  // 頭
  ctx.fillRect(cx - 14 * s, cy - 34 * s, 28 * s, 20 * s);
  // 角（2本）
  ctx.fillStyle = '#ff4400';
  ctx.fillRect(cx - 12 * s, cy - 46 * s, 5 * s, 14 * s);
  ctx.fillRect(cx + 7 * s, cy - 46 * s, 5 * s, 14 * s);
  ctx.fillRect(cx - 14 * s, cy - 44 * s, 3 * s, 3 * s);
  ctx.fillRect(cx + 11 * s, cy - 44 * s, 3 * s, 3 * s);
  // 目（燃える）
  ctx.fillStyle = '#ff8800';
  ctx.fillRect(cx - 10 * s, cy - 30 * s, 7 * s, 6 * s);
  ctx.fillRect(cx + 3 * s, cy - 30 * s, 7 * s, 6 * s);
  ctx.fillStyle = '#ffff00';
  ctx.fillRect(cx - 8 * s, cy - 28 * s, 3 * s, 2 * s);
  ctx.fillRect(cx + 5 * s, cy - 28 * s, 3 * s, 2 * s);
  // 尻尾
  ctx.fillStyle = '#880022';
  ctx.fillRect(cx + 14 * s, cy + 8 * s, 6 * s, 6 * s);
  ctx.fillRect(cx + 18 * s, cy + 12 * s, 5 * s, 5 * s);
  ctx.fillRect(cx + 21 * s, cy + 15 * s, 4 * s, 4 * s);
  // 脚
  ctx.fillStyle = color;
  ctx.fillRect(cx - 12 * s, cy + 12 * s, 10 * s, 16 * s);
  ctx.fillRect(cx + 2 * s, cy + 12 * s, 10 * s, 16 * s);
}

// ─── エンジェル ───
function drawSprite_Angel(ctx, W, H, color, isBoss) {
  const cx = W / 2, cy = H / 2 + 2;
  const s = isBoss ? 1.4 : 1;
  const glow = Math.sin(Date.now() * 0.0015) * 0.2 + 0.3;
  // 後光
  ctx.fillStyle = `rgba(255,255,200,${glow})`;
  ctx.fillRect(cx - 24 * s, cy - 44 * s, 48 * s, 48 * s);
  // 翼（白）
  ctx.fillStyle = '#ffffee';
  ctx.fillRect(cx - 38 * s, cy - 24 * s, 22 * s, 30 * s);
  ctx.fillRect(cx - 36 * s, cy - 36 * s, 16 * s, 14 * s);
  ctx.fillRect(cx + 16 * s, cy - 24 * s, 22 * s, 30 * s);
  ctx.fillRect(cx + 20 * s, cy - 36 * s, 16 * s, 14 * s);
  // 羽の模様
  ctx.fillStyle = '#ddddcc';
  for (let i = 0; i < 3; i++) {
    ctx.fillRect(cx - 36 * s + i * 4 * s, cy - 20 * s + i * 6 * s, 18 * s, 2 * s);
    ctx.fillRect(cx + 18 * s + i * 4 * s, cy - 20 * s + i * 6 * s, 18 * s, 2 * s);
  }
  // ローブ（白）
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cx - 14 * s, cy - 16 * s, 28 * s, 30 * s);
  ctx.fillRect(cx - 16 * s, cy + 8 * s, 32 * s, 10 * s);
  // 頭
  ctx.fillStyle = '#ffe8cc';
  ctx.fillRect(cx - 12 * s, cy - 34 * s, 24 * s, 20 * s);
  // 光輪
  ctx.fillStyle = '#f5c842';
  ctx.fillRect(cx - 14 * s, cy - 42 * s, 28 * s, 5 * s);
  ctx.fillStyle = '#fff8aa';
  ctx.fillRect(cx - 12 * s, cy - 41 * s, 24 * s, 3 * s);
  // 目（穏やか）
  ctx.fillStyle = '#4488ff';
  ctx.fillRect(cx - 9 * s, cy - 29 * s, 6 * s, 5 * s);
  ctx.fillRect(cx + 3 * s, cy - 29 * s, 6 * s, 5 * s);
  ctx.fillStyle = '#000044';
  ctx.fillRect(cx - 7 * s, cy - 27 * s, 2 * s, 2 * s);
  ctx.fillRect(cx + 5 * s, cy - 27 * s, 2 * s, 2 * s);
  // 杖（光の）
  ctx.fillStyle = '#f5c842';
  ctx.fillRect(cx + 18 * s, cy - 14 * s, 3 * s, 30 * s);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cx + 14 * s, cy - 18 * s, 11 * s, 6 * s);
  ctx.fillRect(cx + 17 * s, cy - 22 * s, 5 * s, 10 * s);
}

// ─── リザードマン ───
function drawSprite_Lizard(ctx, W, H, color, isBoss) {
  const cx = W / 2, cy = H / 2 + 4;
  const s = isBoss ? 1.4 : 1;
  // 尻尾
  ctx.fillStyle = color;
  ctx.fillRect(cx + 14 * s, cy + 6 * s, 8 * s, 8 * s);
  ctx.fillRect(cx + 20 * s, cy + 10 * s, 7 * s, 6 * s);
  ctx.fillRect(cx + 25 * s, cy + 14 * s, 6 * s, 4 * s);
  // 体（鱗模様）
  ctx.fillRect(cx - 16 * s, cy - 16 * s, 32 * s, 28 * s);
  ctx.fillStyle = color + 'bb';
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 4; j++) {
      ctx.fillRect(cx - 12 * s + j * 8 * s, cy - 12 * s + i * 8 * s, 6 * s, 6 * s);
    }
  }
  // 頭（トカゲ）
  ctx.fillStyle = color;
  ctx.fillRect(cx - 12 * s, cy - 34 * s, 24 * s, 20 * s);
  ctx.fillRect(cx - 14 * s, cy - 28 * s, 28 * s, 6 * s); // 口元
  // トサカ
  ctx.fillStyle = '#ff4400';
  ctx.fillRect(cx - 4 * s, cy - 46 * s, 4 * s, 14 * s);
  ctx.fillRect(cx, cy - 44 * s, 4 * s, 12 * s);
  ctx.fillRect(cx + 4 * s, cy - 42 * s, 4 * s, 10 * s);
  // 目（縦スリット）
  ctx.fillStyle = '#ffff00';
  ctx.fillRect(cx - 9 * s, cy - 30 * s, 6 * s, 8 * s);
  ctx.fillRect(cx + 3 * s, cy - 30 * s, 6 * s, 8 * s);
  ctx.fillStyle = '#000000';
  ctx.fillRect(cx - 7 * s, cy - 29 * s, 2 * s, 6 * s);
  ctx.fillRect(cx + 5 * s, cy - 29 * s, 2 * s, 6 * s);
  // 槍
  ctx.fillStyle = '#aaaaaa';
  ctx.fillRect(cx - 24 * s, cy - 28 * s, 3 * s, 40 * s);
  ctx.fillStyle = '#ccccff';
  ctx.fillRect(cx - 26 * s, cy - 38 * s, 7 * s, 12 * s);
  // 脚
  ctx.fillStyle = color;
  ctx.fillRect(cx - 12 * s, cy + 12 * s, 9 * s, 18 * s);
  ctx.fillRect(cx + 3 * s, cy + 12 * s, 9 * s, 18 * s);
}

// ─── ドラゴン ───
function drawSprite_Dragon(ctx, W, H, color, isBoss) {
  const cx = W / 2, cy = H / 2;
  const s = isBoss ? 1.4 : 1;
  const breathe = Math.sin(Date.now() * 0.001) * 2;
  // 尻尾
  ctx.fillStyle = color;
  ctx.fillRect(cx + 20 * s, cy, 10 * s, 10 * s);
  ctx.fillRect(cx + 28 * s, cy + 6 * s, 8 * s, 8 * s);
  ctx.fillRect(cx + 34 * s, cy + 12 * s, 6 * s, 6 * s);
  ctx.fillRect(cx + 38 * s, cy + 16 * s, 4 * s, 4 * s);
  // 翼
  ctx.fillStyle = '#cc2200';
  ctx.fillRect(cx - 38 * s, cy - 28 * s, 24 * s, 36 * s);
  ctx.fillRect(cx - 36 * s, cy - 40 * s, 18 * s, 14 * s);
  ctx.fillRect(cx + 14 * s, cy - 28 * s, 24 * s, 36 * s);
  ctx.fillRect(cx + 18 * s, cy - 40 * s, 18 * s, 14 * s);
  // 翼の骨格線
  ctx.fillStyle = '#882200';
  ctx.fillRect(cx - 38 * s, cy - 30 * s, 2 * s, 34 * s);
  ctx.fillRect(cx + 36 * s, cy - 30 * s, 2 * s, 34 * s);
  // 体
  ctx.fillStyle = color;
  ctx.fillRect(cx - 20 * s, cy - 16 * s + breathe, 40 * s, 28 * s);
  // 腹（明るい）
  ctx.fillStyle = '#ff8844';
  ctx.fillRect(cx - 12 * s, cy - 10 * s + breathe, 24 * s, 18 * s);
  // 首
  ctx.fillStyle = color;
  ctx.fillRect(cx - 10 * s, cy - 34 * s, 20 * s, 20 * s);
  // 頭
  ctx.fillRect(cx - 14 * s, cy - 46 * s, 28 * s, 14 * s);
  ctx.fillRect(cx - 18 * s, cy - 40 * s, 36 * s, 8 * s); // 口
  // 角
  ctx.fillStyle = '#885500';
  ctx.fillRect(cx - 10 * s, cy - 56 * s, 4 * s, 12 * s);
  ctx.fillRect(cx + 6 * s, cy - 56 * s, 4 * s, 12 * s);
  // 目（炎色）
  ctx.fillStyle = '#ff8800';
  ctx.fillRect(cx - 11 * s, cy - 44 * s, 7 * s, 6 * s);
  ctx.fillRect(cx + 4 * s, cy - 44 * s, 7 * s, 6 * s);
  ctx.fillStyle = '#ffff00';
  ctx.fillRect(cx - 9 * s, cy - 42 * s, 3 * s, 2 * s);
  ctx.fillRect(cx + 6 * s, cy - 42 * s, 3 * s, 2 * s);
  // 炎ブレス（ボスのみ）
  if (isBoss) {
    ctx.fillStyle = '#ff440044';
    ctx.fillRect(cx - 22 * s, cy - 40 * s, 6 * s, 8 * s);
    ctx.fillStyle = '#ff880066';
    ctx.fillRect(cx - 26 * s, cy - 38 * s, 6 * s, 6 * s);
  }
  // 脚
  ctx.fillStyle = color;
  ctx.fillRect(cx - 16 * s, cy + 12 * s, 12 * s, 16 * s);
  ctx.fillRect(cx + 4 * s, cy + 12 * s, 12 * s, 16 * s);
  // 爪
  ctx.fillStyle = '#885500';
  ctx.fillRect(cx - 18 * s, cy + 26 * s, 5 * s, 6 * s);
  ctx.fillRect(cx - 13 * s, cy + 27 * s, 5 * s, 5 * s);
  ctx.fillRect(cx + 4 * s, cy + 26 * s, 5 * s, 6 * s);
  ctx.fillRect(cx + 13 * s, cy + 27 * s, 5 * s, 5 * s);
}

// ══════════════════════════════════════════════════════════
//  ELITE SPRITE DRAWERS
// ══════════════════════════════════════════════════════════

// ─── 死神騎士 ───
function drawSprite_DeathKnight(ctx, W, H, color, isBoss, isElite) {
  const cx = W / 2, cy = H / 2 + 2;
  const s = isBoss ? 1.4 : 1;
  const pulse = Math.sin(Date.now() * 0.002) * 2;
  // 死のオーラ
  ctx.fillStyle = color + '22';
  ctx.fillRect(cx - 20*s, cy - 40*s - pulse, 40*s, 60*s + pulse*2);
  // マント
  ctx.fillStyle = '#1a0030';
  ctx.fillRect(cx - 18*s, cy - 20*s, 36*s, 42*s);
  ctx.fillRect(cx - 14*s, cy + 18*s, 8*s,  10*s);
  ctx.fillRect(cx + 6*s,  cy + 18*s, 8*s,  10*s);
  // 鎧（体）
  ctx.fillStyle = '#2a1a44';
  ctx.fillRect(cx - 14*s, cy - 16*s, 28*s, 26*s);
  ctx.fillStyle = color;
  ctx.fillRect(cx - 12*s, cy - 14*s, 4*s,  20*s);
  ctx.fillRect(cx - 12*s, cy - 14*s, 24*s, 4*s);
  // 兜
  ctx.fillStyle = '#2a1a44';
  ctx.fillRect(cx - 12*s, cy - 34*s, 24*s, 20*s);
  ctx.fillStyle = color;
  ctx.fillRect(cx - 14*s, cy - 40*s, 5*s, 8*s);
  ctx.fillRect(cx + 9*s,  cy - 40*s, 5*s, 8*s);
  // バイザー
  ctx.fillStyle = '#0a0018';
  ctx.fillRect(cx - 9*s, cy - 30*s, 18*s, 8*s);
  ctx.fillStyle = color;
  ctx.fillRect(cx - 7*s, cy - 28*s, 5*s, 4*s);
  ctx.fillRect(cx + 2*s, cy - 28*s, 5*s, 4*s);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cx - 6*s, cy - 27*s, 2*s, 2*s);
  ctx.fillRect(cx + 3*s, cy - 27*s, 2*s, 2*s);
  // 大鎌
  ctx.fillStyle = '#555577';
  ctx.fillRect(cx - 22*s, cy - 32*s, 3*s, 50*s);
  ctx.fillStyle = '#aaaacc';
  ctx.fillRect(cx - 32*s, cy - 38*s, 14*s, 6*s);
  ctx.fillRect(cx - 30*s, cy - 32*s, 10*s, 4*s);
  ctx.fillStyle = color + 'aa';
  ctx.fillRect(cx - 34*s, cy - 40*s, 4*s, 8*s);
  // 脚
  ctx.fillStyle = '#2a1a44';
  ctx.fillRect(cx - 10*s, cy + 10*s, 8*s, 16*s);
  ctx.fillRect(cx + 2*s,  cy + 10*s, 8*s, 16*s);
}

// ─── 溶岩巨人 ───
function drawSprite_LavaGiant(ctx, W, H, color, isBoss, isElite) {
  const cx = W / 2, cy = H / 2 + 4;
  const s = isBoss ? 1.4 : 1;
  const glow = Math.sin(Date.now() * 0.003) * 0.15 + 0.25;
  // 溶岩オーラ
  ctx.fillStyle = `rgba(255,100,0,${glow})`;
  ctx.fillRect(cx - 22*s, cy - 24*s, 44*s, 54*s);
  // 体（岩）
  ctx.fillStyle = '#3a1a00';
  ctx.fillRect(cx - 20*s, cy - 20*s, 40*s, 36*s);
  // 溶岩の亀裂
  ctx.fillStyle = '#ff6600';
  ctx.fillRect(cx - 4*s,  cy - 18*s, 3*s, 30*s);
  ctx.fillRect(cx + 8*s,  cy - 10*s, 3*s, 20*s);
  ctx.fillRect(cx - 14*s, cy - 4*s,  24*s, 3*s);
  ctx.fillStyle = '#ff9900';
  ctx.fillRect(cx - 3*s,  cy - 17*s, 1*s, 28*s);
  // 頭
  ctx.fillStyle = '#3a1a00';
  ctx.fillRect(cx - 16*s, cy - 38*s, 32*s, 20*s);
  ctx.fillStyle = '#ff6600';
  ctx.fillRect(cx - 2*s,  cy - 36*s, 2*s,  16*s);
  // 目
  ctx.fillStyle = '#ff4400';
  ctx.fillRect(cx - 11*s, cy - 34*s, 8*s, 7*s);
  ctx.fillRect(cx + 3*s,  cy - 34*s, 8*s, 7*s);
  ctx.fillStyle = '#ffcc00';
  ctx.fillRect(cx - 9*s,  cy - 32*s, 4*s, 3*s);
  ctx.fillRect(cx + 5*s,  cy - 32*s, 4*s, 3*s);
  // 腕
  ctx.fillStyle = '#3a1a00';
  ctx.fillRect(cx - 32*s, cy - 18*s, 14*s, 20*s);
  ctx.fillRect(cx + 18*s, cy - 18*s, 14*s, 20*s);
  ctx.fillStyle = '#ff6600';
  ctx.fillRect(cx - 34*s, cy - 4*s,  16*s, 12*s);
  ctx.fillRect(cx + 18*s, cy - 4*s,  16*s, 12*s);
  // 脚
  ctx.fillStyle = '#3a1a00';
  ctx.fillRect(cx - 14*s, cy + 16*s, 11*s, 16*s);
  ctx.fillRect(cx + 3*s,  cy + 16*s, 11*s, 16*s);
  ctx.fillStyle = '#ff4400';
  ctx.fillRect(cx - 6*s,  cy + 12*s, 3*s,  6*s);
  ctx.fillRect(cx + 3*s,  cy + 10*s, 3*s,  8*s);
}

// ─── 影の暗殺者 ───
function drawSprite_ShadowAssassin(ctx, W, H, color, isBoss, isElite) {
  const cx = W / 2, cy = H / 2 + 2;
  const s = isBoss ? 1.4 : 1;
  const flicker = Math.sin(Date.now() * 0.005) * 1.5;
  // 影の残像
  ctx.fillStyle = color + '18';
  ctx.fillRect(cx - 14*s + flicker, cy - 32*s, 28*s, 48*s);
  ctx.fillStyle = color + '10';
  ctx.fillRect(cx - 12*s - flicker, cy - 28*s, 24*s, 44*s);
  // マント
  ctx.fillStyle = '#0a0a12';
  ctx.fillRect(cx - 16*s, cy - 24*s, 32*s, 44*s);
  ctx.fillRect(cx - 18*s, cy - 16*s, 4*s,  28*s);
  ctx.fillRect(cx + 14*s, cy - 16*s, 4*s,  28*s);
  // 体
  ctx.fillStyle = '#111122';
  ctx.fillRect(cx - 10*s, cy - 16*s, 20*s, 24*s);
  // 頭巾
  ctx.fillStyle = '#0a0a18';
  ctx.fillRect(cx - 10*s, cy - 34*s, 20*s, 20*s);
  ctx.fillStyle = color;
  ctx.fillRect(cx - 7*s, cy - 28*s, 5*s, 3*s);
  ctx.fillRect(cx + 2*s, cy - 28*s, 5*s, 3*s);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cx - 6*s, cy - 28*s, 2*s, 2*s);
  ctx.fillRect(cx + 3*s, cy - 28*s, 2*s, 2*s);
  // 短剣×2
  ctx.fillStyle = '#ccccee';
  ctx.fillRect(cx - 20*s, cy - 12*s, 2*s, 16*s);
  ctx.fillRect(cx - 22*s, cy - 12*s, 6*s,  3*s);
  ctx.fillRect(cx + 18*s, cy - 8*s,  2*s, 14*s);
  ctx.fillRect(cx + 16*s, cy - 4*s,  6*s,  3*s);
  ctx.fillStyle = color + 'cc';
  ctx.fillRect(cx - 20*s, cy - 12*s, 1*s, 16*s);
  ctx.fillRect(cx + 19*s, cy - 8*s,  1*s, 14*s);
  // 脚
  ctx.fillStyle = '#111122';
  ctx.fillRect(cx - 8*s, cy + 8*s, 6*s, 16*s);
  ctx.fillRect(cx + 2*s, cy + 8*s,  6*s, 16*s);
}

// ─── 魔将軍 ───
function drawSprite_MagicGeneral(ctx, W, H, color, isBoss, isElite) {
  const cx = W / 2, cy = H / 2 + 2;
  const s = isBoss ? 1.4 : 1;
  const pulse = Math.sin(Date.now() * 0.002) * 3;
  // オーラ
  ctx.fillStyle = color + '22';
  ctx.fillRect(cx - 24*s, cy - 42*s - pulse, 48*s, 64*s + pulse*2);
  // 体（鎧）
  ctx.fillStyle = '#1a0022';
  ctx.fillRect(cx - 18*s, cy - 18*s, 36*s, 28*s);
  ctx.fillStyle = color;
  ctx.fillRect(cx - 16*s, cy - 16*s, 4*s,  22*s);
  ctx.fillRect(cx + 12*s, cy - 16*s, 4*s,  22*s);
  ctx.fillRect(cx - 16*s, cy - 16*s, 32*s, 4*s);
  // 胸紋章
  ctx.fillStyle = '#ffddff';
  ctx.fillRect(cx - 4*s, cy - 12*s, 8*s, 8*s);
  ctx.fillStyle = '#0a0014';
  ctx.fillRect(cx - 2*s, cy - 10*s, 4*s, 4*s);
  ctx.fillStyle = color;
  ctx.fillRect(cx - 1*s, cy - 9*s,  2*s, 2*s);
  // 兜
  ctx.fillStyle = '#1a0022';
  ctx.fillRect(cx - 14*s, cy - 36*s, 28*s, 20*s);
  ctx.fillStyle = color;
  ctx.fillRect(cx - 2*s, cy - 50*s, 4*s, 16*s);
  ctx.fillRect(cx - 6*s, cy - 46*s, 3*s, 12*s);
  ctx.fillRect(cx + 3*s, cy - 46*s, 3*s, 12*s);
  ctx.fillStyle = '#ffddff';
  ctx.fillRect(cx - 14*s, cy - 36*s, 28*s, 3*s);
  ctx.fillRect(cx - 14*s, cy - 18*s, 28*s, 3*s);
  // 目
  ctx.fillStyle = color;
  ctx.fillRect(cx - 10*s, cy - 31*s, 7*s, 5*s);
  ctx.fillRect(cx + 3*s,  cy - 31*s, 7*s, 5*s);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cx - 8*s,  cy - 30*s, 3*s, 2*s);
  ctx.fillRect(cx + 5*s,  cy - 30*s, 3*s, 2*s);
  // 魔法杖（右）
  ctx.fillStyle = '#884499';
  ctx.fillRect(cx + 18*s, cy - 28*s, 4*s, 42*s);
  ctx.fillStyle = color;
  ctx.fillRect(cx + 14*s, cy - 36*s, 12*s, 12*s);
  ctx.fillStyle = '#0a0014';
  ctx.fillRect(cx + 16*s, cy - 34*s, 8*s,  8*s);
  ctx.fillStyle = '#ffddff';
  ctx.fillRect(cx + 18*s, cy - 32*s, 4*s,  4*s);
  // 盾（左）
  ctx.fillStyle = '#2a0044';
  ctx.fillRect(cx - 28*s, cy - 20*s, 12*s, 18*s);
  ctx.fillStyle = color;
  ctx.fillRect(cx - 26*s, cy - 18*s, 8*s, 3*s);
  ctx.fillRect(cx - 26*s, cy - 18*s, 3*s, 14*s);
  // 脚
  ctx.fillStyle = '#1a0022';
  ctx.fillRect(cx - 12*s, cy + 10*s, 10*s, 18*s);
  ctx.fillRect(cx + 2*s,  cy + 10*s, 10*s, 18*s);
}

// ─── 氷刃の狩人 ───
function drawSprite_IceHunter(ctx, W, H, color, isBoss, isElite) {
  const cx = W / 2, cy = H / 2 + 2;
  const s = isBoss ? 1.4 : 1;
  const shimmer = Math.sin(Date.now() * 0.003) * 2;
  // 氷オーラ
  ctx.fillStyle = '#88ccff18';
  ctx.fillRect(cx - 20*s, cy - 38*s + shimmer, 40*s, 58*s);
  // 体
  ctx.fillStyle = '#0a2244';
  ctx.fillRect(cx - 14*s, cy - 16*s, 28*s, 26*s);
  ctx.fillStyle = '#88ccff44';
  ctx.fillRect(cx - 4*s,  cy - 14*s, 3*s, 20*s);
  ctx.fillRect(cx - 12*s, cy - 6*s,  24*s, 3*s);
  // 頭
  ctx.fillStyle = '#0a2244';
  ctx.fillRect(cx - 12*s, cy - 34*s, 24*s, 20*s);
  ctx.fillStyle = '#06143a';
  ctx.fillRect(cx - 14*s, cy - 36*s, 28*s, 8*s);
  ctx.fillRect(cx - 16*s, cy - 28*s, 4*s,  8*s);
  ctx.fillRect(cx + 12*s, cy - 28*s, 4*s,  8*s);
  // 目
  ctx.fillStyle = color;
  ctx.fillRect(cx - 9*s, cy - 29*s, 6*s, 5*s);
  ctx.fillRect(cx + 3*s, cy - 29*s, 6*s, 5*s);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cx - 7*s, cy - 27*s, 2*s, 2*s);
  ctx.fillRect(cx + 5*s, cy - 27*s, 2*s, 2*s);
  // 氷弓
  ctx.fillStyle = '#aaddff';
  ctx.fillRect(cx + 18*s, cy - 28*s, 3*s, 40*s);
  ctx.fillRect(cx + 18*s, cy - 28*s, 10*s, 3*s);
  ctx.fillRect(cx + 18*s, cy + 12*s, 10*s, 3*s);
  ctx.fillStyle = '#cceeff88';
  ctx.fillRect(cx + 27*s, cy - 26*s, 2*s, 36*s);
  ctx.fillStyle = '#88ccff';
  ctx.fillRect(cx + 14*s, cy - 8*s,  16*s, 2*s);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cx + 28*s, cy - 10*s, 4*s,  6*s);
  // 氷短剣（左）
  ctx.fillStyle = '#aaddff';
  ctx.fillRect(cx - 22*s, cy - 10*s, 3*s, 14*s);
  ctx.fillRect(cx - 24*s, cy - 7*s,  7*s,  3*s);
  // 脚
  ctx.fillStyle = '#0a2244';
  ctx.fillRect(cx - 10*s, cy + 10*s, 8*s, 16*s);
  ctx.fillRect(cx + 2*s,  cy + 10*s, 8*s, 16*s);
}

// ─── 雷光の剣士 ───
function drawSprite_ThunderSwordsman(ctx, W, H, color, isBoss, isElite) {
  const cx = W / 2, cy = H / 2 + 2;
  const s = isBoss ? 1.4 : 1;
  const bolt = Math.sin(Date.now() * 0.008) > 0.5;
  // 雷オーラ（点滅）
  if (bolt) {
    ctx.fillStyle = color + '33';
    ctx.fillRect(cx - 22*s, cy - 40*s, 44*s, 60*s);
  }
  // 体（黄鎧）
  ctx.fillStyle = '#2a2200';
  ctx.fillRect(cx - 14*s, cy - 16*s, 28*s, 26*s);
  ctx.fillStyle = color;
  ctx.fillRect(cx - 12*s, cy - 14*s, 4*s,  22*s);
  ctx.fillRect(cx + 8*s,  cy - 14*s, 4*s,  22*s);
  ctx.fillRect(cx - 12*s, cy - 14*s, 24*s, 4*s);
  // 兜
  ctx.fillStyle = '#2a2200';
  ctx.fillRect(cx - 12*s, cy - 34*s, 24*s, 20*s);
  ctx.fillStyle = color;
  ctx.fillRect(cx - 12*s, cy - 34*s, 24*s, 4*s);
  ctx.fillRect(cx - 2*s,  cy - 42*s, 4*s,  10*s);
  ctx.fillRect(cx - 8*s,  cy - 38*s, 3*s,   6*s);
  ctx.fillRect(cx + 5*s,  cy - 38*s, 3*s,   6*s);
  // 目
  ctx.fillStyle = color;
  ctx.fillRect(cx - 8*s, cy - 29*s, 6*s, 5*s);
  ctx.fillRect(cx + 2*s, cy - 29*s, 6*s, 5*s);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cx - 6*s, cy - 28*s, 3*s, 3*s);
  ctx.fillRect(cx + 3*s, cy - 28*s, 3*s, 3*s);
  // 雷剣（左）
  ctx.fillStyle = '#aaaa44';
  ctx.fillRect(cx - 24*s, cy - 32*s, 4*s, 46*s);
  ctx.fillRect(cx - 28*s, cy - 32*s, 12*s, 4*s);
  ctx.fillStyle = color;
  ctx.fillRect(cx - 23*s, cy - 32*s, 2*s, 46*s);
  // 雷エフェクト（点滅）
  if (bolt) {
    ctx.fillStyle = '#ffffaa';
    ctx.fillRect(cx - 26*s, cy - 20*s, 3*s, 8*s);
    ctx.fillRect(cx - 24*s, cy - 12*s, 3*s, 8*s);
    ctx.fillRect(cx - 22*s, cy - 4*s,  3*s, 8*s);
  }
  // 脚
  ctx.fillStyle = '#2a2200';
  ctx.fillRect(cx - 10*s, cy + 10*s, 8*s, 16*s);
  ctx.fillRect(cx + 2*s,  cy + 10*s, 8*s, 16*s);
}

// ─── 闇の司祭 ───
function drawSprite_DarkPriest(ctx, W, H, color, isBoss, isElite) {
  const cx = W / 2, cy = H / 2 + 2;
  const s = isBoss ? 1.4 : 1;
  const pulse = Math.sin(Date.now() * 0.0015) * 2;
  // 紫オーラ
  ctx.fillStyle = color + '20';
  ctx.fillRect(cx - 20*s, cy - 44*s - pulse, 40*s, 64*s + pulse*2);
  // ローブ
  ctx.fillStyle = '#180028';
  ctx.fillRect(cx - 16*s, cy - 20*s, 32*s, 38*s);
  ctx.fillStyle = color;
  ctx.fillRect(cx - 16*s, cy - 20*s, 4*s, 36*s);
  ctx.fillRect(cx + 12*s, cy - 20*s, 4*s, 36*s);
  ctx.fillRect(cx - 2*s,  cy - 20*s, 4*s, 36*s);
  // フード
  ctx.fillStyle = '#180028';
  ctx.fillRect(cx - 14*s, cy - 38*s, 28*s, 20*s);
  ctx.fillRect(cx - 16*s, cy - 34*s, 4*s,  14*s);
  ctx.fillRect(cx + 12*s, cy - 34*s, 4*s,  14*s);
  // 顔（影）
  ctx.fillStyle = '#0a0014';
  ctx.fillRect(cx - 10*s, cy - 34*s, 20*s, 14*s);
  ctx.fillStyle = color;
  ctx.fillRect(cx - 7*s, cy - 30*s, 5*s, 4*s);
  ctx.fillRect(cx + 2*s, cy - 30*s, 5*s, 4*s);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cx - 5*s, cy - 29*s, 1*s, 2*s);
  ctx.fillRect(cx + 4*s, cy - 29*s, 1*s, 2*s);
  // 杖（右）
  ctx.fillStyle = '#4a1a66';
  ctx.fillRect(cx + 16*s, cy - 36*s, 4*s, 54*s);
  ctx.fillStyle = '#ccaadd';
  ctx.fillRect(cx + 12*s, cy - 44*s, 12*s, 10*s);
  ctx.fillStyle = '#0a0014';
  ctx.fillRect(cx + 14*s, cy - 42*s, 4*s, 4*s);
  ctx.fillRect(cx + 13*s, cy - 38*s, 6*s, 3*s);
  ctx.fillStyle = color;
  ctx.fillRect(cx + 14*s, cy - 40*s, 4*s, 4*s);
  // 魔法書（左）
  ctx.fillStyle = '#2a0044';
  ctx.fillRect(cx - 24*s, cy - 18*s, 14*s, 18*s);
  ctx.fillStyle = color;
  ctx.fillRect(cx - 22*s, cy - 16*s, 10*s, 2*s);
  ctx.fillRect(cx - 22*s, cy - 10*s, 10*s, 2*s);
  ctx.fillRect(cx - 22*s, cy - 4*s,  10*s, 2*s);
  // 脚
  ctx.fillStyle = '#180028';
  ctx.fillRect(cx - 10*s, cy + 18*s, 8*s, 14*s);
  ctx.fillRect(cx + 2*s,  cy + 18*s, 8*s, 14*s);
}

// ─── 無属の釈迦 ───
function drawSprite_AbyssMonk(ctx, W, H, color, isBoss, isElite) {
  const cx = W / 2, cy = H / 2 + 2;
  const s = isBoss ? 1.4 : 1;
  const breathe = Math.sin(Date.now() * 0.001) * 3;
  // 炎オーラ（強）
  ctx.fillStyle = '#ff884422';
  ctx.fillRect(cx - 24*s, cy - 44*s - breathe, 48*s, 66*s + breathe*2);
  ctx.fillStyle = '#ff440011';
  ctx.fillRect(cx - 28*s, cy - 48*s - breathe, 56*s, 74*s + breathe*2);
  // 袈裟（体）
  ctx.fillStyle = '#2a1400';
  ctx.fillRect(cx - 16*s, cy - 18*s, 32*s, 32*s);
  ctx.fillStyle = color;
  ctx.fillRect(cx - 14*s, cy - 18*s, 28*s, 4*s);
  ctx.fillRect(cx - 14*s, cy + 10*s, 28*s, 4*s);
  // 炎の模様
  ctx.fillStyle = '#ff6600';
  ctx.fillRect(cx - 2*s, cy - 14*s, 4*s, 24*s);
  ctx.fillStyle = '#ffaa00';
  ctx.fillRect(cx - 1*s, cy - 13*s, 2*s, 22*s);
  // 頭（禿げた老人）
  ctx.fillStyle = '#cc9966';
  ctx.fillRect(cx - 10*s, cy - 36*s, 20*s, 20*s);
  // 眉（険しい）
  ctx.fillStyle = '#663300';
  ctx.fillRect(cx - 8*s, cy - 32*s, 6*s,  3*s);
  ctx.fillRect(cx + 2*s, cy - 32*s, 6*s,  3*s);
  // 目（閉じて瞑想）
  ctx.fillStyle = '#332200';
  ctx.fillRect(cx - 7*s, cy - 28*s, 5*s, 2*s);
  ctx.fillRect(cx + 2*s, cy - 28*s, 5*s, 2*s);
  // 口（静かに笑む）
  ctx.fillRect(cx - 3*s, cy - 22*s, 6*s, 2*s);
  // 炎の掌（左右）
  ctx.fillStyle = '#ff6600';
  ctx.fillRect(cx - 26*s, cy - 10*s, 12*s, 10*s);
  ctx.fillRect(cx + 14*s, cy - 10*s, 12*s, 10*s);
  ctx.fillStyle = '#ffcc00';
  ctx.fillRect(cx - 24*s, cy - 8*s,  4*s,  6*s);
  ctx.fillRect(cx - 20*s, cy - 8*s,  4*s,  6*s);
  ctx.fillRect(cx + 16*s, cy - 8*s,  4*s,  6*s);
  ctx.fillRect(cx + 20*s, cy - 8*s,  4*s,  6*s);
  // 炎の柱（下）
  ctx.fillStyle = '#ff4400';
  ctx.fillRect(cx - 8*s,  cy + 14*s, 6*s,  8*s + breathe);
  ctx.fillRect(cx + 2*s,  cy + 14*s, 6*s,  8*s + breathe);
  ctx.fillStyle = '#ff9900';
  ctx.fillRect(cx - 6*s,  cy + 14*s, 2*s,  6*s + breathe);
  ctx.fillRect(cx + 4*s,  cy + 14*s, 2*s,  6*s + breathe);
  // 脚
  ctx.fillStyle = '#2a1400';
  ctx.fillRect(cx - 10*s, cy + 14*s, 8*s, 14*s);
  ctx.fillRect(cx + 2*s,  cy + 14*s, 8*s, 14*s);
}

// ══════════════════════════════════════════════════════════
//  BOSS SPRITE DRAWERS（ノーマルモード）
// ══════════════════════════════════════════════════════════

// ─── 地下王 ゴーレム ───
function drawSprite_Golem(ctx, W, H, color, isBoss, isElite) {
  const cx = W / 2, cy = H / 2 + 2;
  const s = isBoss ? 1.4 : 1;
  const shake = isBoss ? Math.sin(Date.now() * 0.004) * 1.5 : 0;
  // 石のオーラ
  ctx.fillStyle = color + '18';
  ctx.fillRect(cx - 26*s, cy - 40*s, 52*s, 66*s);
  // 体（巨大な岩）
  ctx.fillStyle = '#5a5a6a';
  ctx.fillRect(cx - 22*s + shake, cy - 20*s, 44*s, 38*s);
  // 体の石板模様
  ctx.fillStyle = '#3a3a4a';
  ctx.fillRect(cx - 20*s, cy - 18*s, 16*s, 14*s);
  ctx.fillRect(cx + 4*s,  cy - 18*s, 16*s, 14*s);
  ctx.fillRect(cx - 20*s, cy - 2*s,  40*s, 14*s);
  ctx.fillStyle = '#7a7a8a';
  ctx.fillRect(cx - 18*s, cy - 16*s, 6*s,  6*s);
  ctx.fillRect(cx + 12*s, cy - 16*s, 6*s,  6*s);
  // 頭（四角い岩）
  ctx.fillStyle = '#5a5a6a';
  ctx.fillRect(cx - 18*s, cy - 42*s, 36*s, 24*s);
  // 目（赤く光る）
  ctx.fillStyle = '#cc2200';
  ctx.fillRect(cx - 13*s, cy - 38*s, 10*s, 8*s);
  ctx.fillRect(cx + 3*s,  cy - 38*s, 10*s, 8*s);
  ctx.fillStyle = '#ff4400';
  ctx.fillRect(cx - 11*s, cy - 36*s, 6*s,  4*s);
  ctx.fillRect(cx + 5*s,  cy - 36*s, 6*s,  4*s);
  ctx.fillStyle = '#ffaa44';
  ctx.fillRect(cx - 10*s, cy - 35*s, 2*s,  2*s);
  ctx.fillRect(cx + 6*s,  cy - 35*s, 2*s,  2*s);
  // 口（岩の割れ目）
  ctx.fillStyle = '#1a1a2a';
  ctx.fillRect(cx - 8*s, cy - 26*s, 16*s, 4*s);
  ctx.fillStyle = '#cc2200';
  ctx.fillRect(cx - 6*s, cy - 25*s, 3*s,  2*s);
  ctx.fillRect(cx + 3*s, cy - 25*s, 3*s,  2*s);
  // 腕（巨大）
  ctx.fillStyle = '#5a5a6a';
  ctx.fillRect(cx - 40*s + shake, cy - 16*s, 20*s, 22*s);
  ctx.fillRect(cx + 20*s - shake, cy - 16*s, 20*s, 22*s);
  // 拳
  ctx.fillStyle = '#3a3a4a';
  ctx.fillRect(cx - 42*s, cy - 2*s, 22*s, 14*s);
  ctx.fillRect(cx + 20*s, cy - 2*s, 22*s, 14*s);
  // 脚
  ctx.fillStyle = '#5a5a6a';
  ctx.fillRect(cx - 16*s, cy + 18*s, 14*s, 18*s);
  ctx.fillRect(cx + 2*s,  cy + 18*s, 14*s, 18*s);
  // 王冠（岩）
  ctx.fillStyle = color;
  ctx.fillRect(cx - 14*s, cy - 44*s, 28*s, 4*s);
  ctx.fillRect(cx - 10*s, cy - 50*s, 4*s,  8*s);
  ctx.fillRect(cx - 2*s,  cy - 52*s, 4*s,  10*s);
  ctx.fillRect(cx + 6*s,  cy - 50*s, 4*s,  8*s);
}

// ─── 炎王 イフリート ───
function drawSprite_Ifrit(ctx, W, H, color, isBoss, isElite) {
  const cx = W / 2, cy = H / 2;
  const s = isBoss ? 1.4 : 1;
  const flame = Math.sin(Date.now() * 0.004) * 3;
  // 炎のオーラ（強烈）
  ctx.fillStyle = '#ff440033';
  ctx.fillRect(cx - 30*s, cy - 50*s, 60*s, 80*s);
  ctx.fillStyle = '#ff880022';
  ctx.fillRect(cx - 24*s, cy - 44*s - flame, 48*s, 68*s + flame*2);
  // 体（炎の悪魔）
  ctx.fillStyle = '#8a1a00';
  ctx.fillRect(cx - 18*s, cy - 20*s, 36*s, 32*s);
  // 溶岩の筋
  ctx.fillStyle = '#ff6600';
  ctx.fillRect(cx - 2*s,  cy - 18*s, 4*s,  26*s);
  ctx.fillRect(cx - 14*s, cy - 4*s,  28*s, 4*s);
  ctx.fillStyle = '#ffcc00';
  ctx.fillRect(cx - 1*s,  cy - 17*s, 2*s,  24*s);
  // 翼（炎）
  ctx.fillStyle = '#cc2200';
  ctx.fillRect(cx - 40*s, cy - 30*s + flame, 20*s, 36*s);
  ctx.fillRect(cx - 38*s, cy - 44*s + flame, 14*s, 16*s);
  ctx.fillRect(cx + 20*s, cy - 30*s + flame, 20*s, 36*s);
  ctx.fillRect(cx + 24*s, cy - 44*s + flame, 14*s, 16*s);
  ctx.fillStyle = '#ff4400';
  ctx.fillRect(cx - 36*s, cy - 28*s, 12*s, 28*s);
  ctx.fillRect(cx + 24*s, cy - 28*s, 12*s, 28*s);
  // 頭
  ctx.fillStyle = '#8a1a00';
  ctx.fillRect(cx - 16*s, cy - 40*s, 32*s, 22*s);
  // 角（炎）
  ctx.fillStyle = '#ff4400';
  ctx.fillRect(cx - 14*s, cy - 56*s + flame, 5*s, 18*s);
  ctx.fillRect(cx + 9*s,  cy - 56*s + flame, 5*s, 18*s);
  ctx.fillStyle = '#ffcc00';
  ctx.fillRect(cx - 13*s, cy - 54*s + flame, 3*s, 14*s);
  ctx.fillRect(cx + 10*s, cy - 54*s + flame, 3*s, 14*s);
  // 目（白熱）
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cx - 11*s, cy - 36*s, 8*s, 7*s);
  ctx.fillRect(cx + 3*s,  cy - 36*s, 8*s, 7*s);
  ctx.fillStyle = '#ffff00';
  ctx.fillRect(cx - 9*s,  cy - 34*s, 4*s, 3*s);
  ctx.fillRect(cx + 5*s,  cy - 34*s, 4*s, 3*s);
  // 口（炎を吐く）
  ctx.fillStyle = '#1a0000';
  ctx.fillRect(cx - 8*s, cy - 26*s, 16*s, 6*s);
  ctx.fillStyle = '#ff6600';
  ctx.fillRect(cx - 20*s, cy - 26*s, 14*s, 6*s);
  ctx.fillRect(cx - 26*s, cy - 24*s, 8*s,  4*s);
  ctx.fillStyle = '#ffcc00';
  ctx.fillRect(cx - 22*s, cy - 25*s, 4*s,  4*s);
  // 脚
  ctx.fillStyle = '#8a1a00';
  ctx.fillRect(cx - 14*s, cy + 12*s, 12*s, 18*s);
  ctx.fillRect(cx + 2*s,  cy + 12*s, 12*s, 18*s);
  ctx.fillStyle = '#ff4400';
  ctx.fillRect(cx - 16*s, cy + 28*s, 14*s, 4*s);
  ctx.fillRect(cx + 2*s,  cy + 28*s, 14*s, 4*s);
}

// ─── 深淵龍 ヴォルグ ───
function drawSprite_Volg(ctx, W, H, color, isBoss, isElite) {
  const cx = W / 2, cy = H / 2;
  const s = isBoss ? 1.4 : 1;
  const breathe = Math.sin(Date.now() * 0.002) * 3;
  // 深淵のオーラ
  ctx.fillStyle = color + '28';
  ctx.fillRect(cx - 32*s, cy - 50*s, 64*s, 84*s);
  ctx.fillStyle = '#8800aa18';
  ctx.fillRect(cx - 28*s, cy - 46*s - breathe, 56*s, 78*s + breathe*2);
  // 尻尾
  ctx.fillStyle = color;
  ctx.fillRect(cx + 22*s, cy - 4*s,  12*s, 10*s);
  ctx.fillRect(cx + 32*s, cy + 4*s,  10*s, 8*s);
  ctx.fillRect(cx + 40*s, cy + 10*s, 8*s,  6*s);
  ctx.fillRect(cx + 46*s, cy + 14*s, 5*s,  5*s);
  // 翼
  ctx.fillStyle = '#440066';
  ctx.fillRect(cx - 42*s, cy - 32*s, 24*s, 42*s);
  ctx.fillRect(cx - 40*s, cy - 48*s, 18*s, 18*s);
  ctx.fillRect(cx + 18*s, cy - 32*s, 24*s, 42*s);
  ctx.fillRect(cx + 22*s, cy - 48*s, 18*s, 18*s);
  ctx.fillStyle = color + 'aa';
  ctx.fillRect(cx - 42*s, cy - 34*s, 2*s, 40*s);
  ctx.fillRect(cx + 40*s, cy - 34*s, 2*s, 40*s);
  // 体
  ctx.fillStyle = color;
  ctx.fillRect(cx - 20*s, cy - 18*s + breathe, 40*s, 30*s);
  ctx.fillStyle = '#cc88ff';
  ctx.fillRect(cx - 12*s, cy - 12*s + breathe, 24*s, 20*s);
  // 首
  ctx.fillStyle = color;
  ctx.fillRect(cx - 12*s, cy - 36*s, 24*s, 20*s);
  // 頭
  ctx.fillRect(cx - 16*s, cy - 52*s, 32*s, 18*s);
  ctx.fillRect(cx - 20*s, cy - 46*s, 40*s, 10*s);
  // 角
  ctx.fillStyle = '#8800cc';
  ctx.fillRect(cx - 12*s, cy - 62*s, 5*s, 14*s);
  ctx.fillRect(cx + 7*s,  cy - 62*s, 5*s, 14*s);
  ctx.fillRect(cx - 18*s, cy - 58*s, 4*s, 10*s);
  ctx.fillRect(cx + 14*s, cy - 58*s, 4*s, 10*s);
  // 目
  ctx.fillStyle = '#ff44ff';
  ctx.fillRect(cx - 14*s, cy - 48*s, 9*s, 7*s);
  ctx.fillRect(cx + 5*s,  cy - 48*s, 9*s, 7*s);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cx - 12*s, cy - 46*s, 3*s, 3*s);
  ctx.fillRect(cx + 7*s,  cy - 46*s, 3*s, 3*s);
  // ブレス（深淵の光）
  ctx.fillStyle = color + '88';
  ctx.fillRect(cx - 24*s, cy - 46*s, 6*s, 8*s);
  ctx.fillStyle = '#cc44ff';
  ctx.fillRect(cx - 28*s, cy - 44*s, 6*s, 6*s);
  ctx.fillStyle = '#ffffff44';
  ctx.fillRect(cx - 30*s, cy - 42*s, 4*s, 4*s);
  // 脚
  ctx.fillStyle = color;
  ctx.fillRect(cx - 16*s, cy + 12*s, 12*s, 18*s);
  ctx.fillRect(cx + 4*s,  cy + 12*s, 12*s, 18*s);
}

// ─── 魔王 ダルクロア ───
function drawSprite_Darkroa(ctx, W, H, color, isBoss, isElite) {
  const cx = W / 2, cy = H / 2;
  const s = isBoss ? 1.4 : 1;
  const pulse = Math.sin(Date.now() * 0.003) * 4;
  const rot   = Math.sin(Date.now() * 0.001) * 2;
  // 最強のオーラ（多重）
  ctx.fillStyle = color + '33';
  ctx.fillRect(cx - 36*s, cy - 56*s, 72*s, 90*s);
  ctx.fillStyle = '#ff000022';
  ctx.fillRect(cx - 30*s, cy - 50*s - pulse, 60*s, 82*s + pulse*2);
  ctx.fillStyle = '#8800ff18';
  ctx.fillRect(cx - 24*s, cy - 44*s + pulse, 48*s, 74*s - pulse);
  // マント（漆黒）
  ctx.fillStyle = '#0a0010';
  ctx.fillRect(cx - 28*s, cy - 28*s, 56*s, 56*s);
  ctx.fillRect(cx - 22*s, cy + 24*s, 10*s, 14*s);
  ctx.fillRect(cx + 12*s, cy + 24*s, 10*s, 14*s);
  // 体（魔王鎧）
  ctx.fillStyle = '#1a0028';
  ctx.fillRect(cx - 18*s, cy - 20*s, 36*s, 30*s);
  ctx.fillStyle = color;
  ctx.fillRect(cx - 16*s, cy - 18*s, 5*s,  26*s);
  ctx.fillRect(cx + 11*s, cy - 18*s, 5*s,  26*s);
  ctx.fillRect(cx - 16*s, cy - 18*s, 32*s, 5*s);
  // 紋章（胸）
  ctx.fillStyle = '#ff2266';
  ctx.fillRect(cx - 5*s, cy - 12*s, 10*s, 10*s);
  ctx.fillStyle = '#0a0010';
  ctx.fillRect(cx - 3*s, cy - 10*s,  6*s,  6*s);
  ctx.fillStyle = color;
  ctx.fillRect(cx - 1*s, cy - 8*s,   2*s,  2*s);
  // 頭（魔王の兜）
  ctx.fillStyle = '#1a0028';
  ctx.fillRect(cx - 16*s, cy - 44*s, 32*s, 26*s);
  // 魔王の角（巨大、2対）
  ctx.fillStyle = '#cc0044';
  ctx.fillRect(cx - 18*s, cy - 60*s + rot, 6*s, 18*s);
  ctx.fillRect(cx + 12*s, cy - 60*s - rot, 6*s, 18*s);
  ctx.fillRect(cx - 22*s, cy - 54*s, 5*s, 12*s);
  ctx.fillRect(cx + 17*s, cy - 54*s, 5*s, 12*s);
  ctx.fillStyle = '#ff2266';
  ctx.fillRect(cx - 16*s, cy - 58*s + rot, 4*s, 14*s);
  ctx.fillRect(cx + 12*s, cy - 58*s - rot, 4*s, 14*s);
  // 兜の縁（金）
  ctx.fillStyle = '#ffddff';
  ctx.fillRect(cx - 16*s, cy - 44*s, 32*s, 4*s);
  // 目（禍々しく3つ）
  ctx.fillStyle = '#ff0044';
  ctx.fillRect(cx - 12*s, cy - 38*s, 8*s, 6*s);
  ctx.fillRect(cx + 4*s,  cy - 38*s, 8*s, 6*s);
  ctx.fillStyle = color;
  ctx.fillRect(cx - 3*s,  cy - 36*s, 6*s, 4*s);  // 額の第三の目
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cx - 10*s, cy - 37*s, 3*s, 2*s);
  ctx.fillRect(cx + 6*s,  cy - 37*s, 3*s, 2*s);
  ctx.fillRect(cx - 1*s,  cy - 35*s, 2*s, 2*s);
  // 魔剣（右）
  ctx.fillStyle = '#440066';
  ctx.fillRect(cx + 22*s, cy - 38*s, 5*s, 54*s);
  ctx.fillRect(cx + 16*s, cy - 38*s, 16*s, 5*s);
  ctx.fillStyle = color;
  ctx.fillRect(cx + 23*s, cy - 38*s, 3*s, 54*s);
  ctx.fillStyle = '#ff2266';
  ctx.fillRect(cx + 22*s, cy - 22*s, 5*s, 3*s);
  ctx.fillRect(cx + 22*s, cy - 6*s,  5*s, 3*s);
  ctx.fillRect(cx + 22*s, cy + 10*s, 5*s, 3*s);
  // 魔法陣（左手）
  ctx.fillStyle = color + 'aa';
  ctx.fillRect(cx - 30*s, cy - 18*s, 14*s, 14*s);
  ctx.fillStyle = '#0a0010';
  ctx.fillRect(cx - 28*s, cy - 16*s, 10*s, 10*s);
  ctx.fillStyle = '#ff2266';
  ctx.fillRect(cx - 26*s, cy - 14*s, 6*s,  6*s);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cx - 25*s, cy - 13*s, 4*s,  4*s);
  ctx.fillStyle = color;
  ctx.fillRect(cx - 24*s, cy - 12*s, 2*s,  2*s);
  // 脚
  ctx.fillStyle = '#1a0028';
  ctx.fillRect(cx - 14*s, cy + 10*s, 12*s, 22*s);
  ctx.fillRect(cx + 2*s,  cy + 10*s, 12*s, 22*s);
}

// ══════════════════════════════════════════════════════════
//  BOSS SPRITE DRAWERS（ハードモード）
// ══════════════════════════════════════════════════════════

// ─── 岩王 グラニウス ───
function drawSprite_Granius(ctx, W, H, color, isBoss, isElite) {
  const cx = W / 2, cy = H / 2 + 2;
  const s = isBoss ? 1.4 : 1;
  const shake = Math.sin(Date.now() * 0.005) * 2;
  // 岩のオーラ
  ctx.fillStyle = color + '20';
  ctx.fillRect(cx - 28*s, cy - 44*s, 56*s, 70*s);
  // 体（巨大岩盤）
  ctx.fillStyle = '#4a4a55';
  ctx.fillRect(cx - 24*s + shake, cy - 22*s, 48*s, 40*s);
  ctx.fillStyle = '#2a2a35';
  ctx.fillRect(cx - 22*s, cy - 20*s, 18*s, 16*s);
  ctx.fillRect(cx + 4*s,  cy - 20*s, 18*s, 16*s);
  ctx.fillRect(cx - 22*s, cy - 2*s,  44*s, 16*s);
  ctx.fillStyle = '#6a6a75';
  ctx.fillRect(cx - 14*s, cy - 16*s, 6*s,  6*s);
  ctx.fillRect(cx + 8*s,  cy - 16*s, 6*s,  6*s);
  // 頭
  ctx.fillStyle = '#4a4a55';
  ctx.fillRect(cx - 20*s, cy - 46*s, 40*s, 26*s);
  // 水晶の冠
  ctx.fillStyle = color;
  ctx.fillRect(cx - 16*s, cy - 48*s, 32*s, 4*s);
  ctx.fillRect(cx - 12*s, cy - 56*s, 5*s,  10*s);
  ctx.fillRect(cx - 2*s,  cy - 58*s, 4*s,  12*s);
  ctx.fillRect(cx + 7*s,  cy - 56*s, 5*s,  10*s);
  // 目
  ctx.fillStyle = '#4400aa';
  ctx.fillRect(cx - 14*s, cy - 42*s, 10*s, 8*s);
  ctx.fillRect(cx + 4*s,  cy - 42*s, 10*s, 8*s);
  ctx.fillStyle = color;
  ctx.fillRect(cx - 12*s, cy - 40*s, 6*s,  4*s);
  ctx.fillRect(cx + 6*s,  cy - 40*s, 6*s,  4*s);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cx - 11*s, cy - 39*s, 2*s,  2*s);
  ctx.fillRect(cx + 7*s,  cy - 39*s, 2*s,  2*s);
  // 口（岩の割れ目）
  ctx.fillStyle = '#1a1a25';
  ctx.fillRect(cx - 10*s, cy - 30*s, 20*s, 5*s);
  ctx.fillStyle = '#6600aa';
  ctx.fillRect(cx - 8*s,  cy - 29*s, 4*s,  3*s);
  ctx.fillRect(cx + 4*s,  cy - 29*s, 4*s,  3*s);
  // 腕（岩盤）
  ctx.fillStyle = '#4a4a55';
  ctx.fillRect(cx - 44*s + shake, cy - 18*s, 22*s, 24*s);
  ctx.fillRect(cx + 22*s - shake, cy - 18*s, 22*s, 24*s);
  ctx.fillStyle = '#2a2a35';
  ctx.fillRect(cx - 46*s, cy - 4*s,  24*s, 14*s);
  ctx.fillRect(cx + 22*s, cy - 4*s,  24*s, 14*s);
  // 脚
  ctx.fillStyle = '#4a4a55';
  ctx.fillRect(cx - 18*s, cy + 18*s, 14*s, 20*s);
  ctx.fillRect(cx + 4*s,  cy + 18*s, 14*s, 20*s);
}

// ─── 炎獣 イグナール ───
function drawSprite_Ignar(ctx, W, H, color, isBoss, isElite) {
  const cx = W / 2, cy = H / 2;
  const s = isBoss ? 1.4 : 1;
  const flame = Math.sin(Date.now() * 0.005) * 4;
  // 炎のオーラ（より激しく）
  ctx.fillStyle = '#ff330044';
  ctx.fillRect(cx - 32*s, cy - 52*s, 64*s, 84*s);
  ctx.fillStyle = '#ff660022';
  ctx.fillRect(cx - 26*s, cy - 46*s - flame, 52*s, 72*s + flame*2);
  // 4本脚の炎獣
  ctx.fillStyle = '#6a0000';
  ctx.fillRect(cx - 22*s, cy - 16*s, 44*s, 32*s);
  // 体の炎模様
  ctx.fillStyle = '#ff4400';
  ctx.fillRect(cx - 2*s,  cy - 14*s, 4*s,  26*s);
  ctx.fillRect(cx - 18*s, cy - 2*s,  36*s, 4*s);
  ctx.fillStyle = '#ffaa00';
  ctx.fillRect(cx - 1*s,  cy - 13*s, 2*s,  24*s);
  // 首と頭
  ctx.fillStyle = '#6a0000';
  ctx.fillRect(cx - 14*s, cy - 34*s, 28*s, 20*s);
  ctx.fillRect(cx - 18*s, cy - 44*s, 36*s, 14*s);
  ctx.fillRect(cx - 22*s, cy - 38*s, 44*s, 8*s);
  // 炎のたてがみ
  ctx.fillStyle = '#ff6600';
  for (let i = 0; i < 5; i++) {
    const h = 8 + (i % 2) * 4;
    ctx.fillRect(cx - 18*s + i*8*s, cy - 48*s - flame * (i%2+0.5), 5*s, h*s + flame);
  }
  ctx.fillStyle = '#ffcc00';
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(cx - 14*s + i*8*s, cy - 46*s - flame, 3*s, 6*s + flame);
  }
  // 目（4つ）
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cx - 14*s, cy - 40*s, 6*s, 5*s);
  ctx.fillRect(cx + 8*s,  cy - 40*s, 6*s, 5*s);
  ctx.fillRect(cx - 8*s,  cy - 40*s, 5*s, 4*s);
  ctx.fillRect(cx + 3*s,  cy - 40*s, 5*s, 4*s);
  ctx.fillStyle = '#ff4400';
  ctx.fillRect(cx - 12*s, cy - 38*s, 2*s, 2*s);
  ctx.fillRect(cx + 10*s, cy - 38*s, 2*s, 2*s);
  // 4本の脚
  ctx.fillStyle = '#6a0000';
  ctx.fillRect(cx - 20*s, cy + 16*s, 10*s, 16*s);
  ctx.fillRect(cx - 8*s,  cy + 16*s, 10*s, 16*s);
  ctx.fillRect(cx + 4*s,  cy + 16*s, 10*s, 16*s);
  ctx.fillRect(cx + 14*s, cy + 16*s, 10*s, 16*s);
  // 爪
  ctx.fillStyle = '#ff4400';
  for (let i = 0; i < 4; i++) {
    const bx = cx + (-20 + i*12)*s;
    ctx.fillRect(bx,       cy + 30*s, 3*s, 5*s);
    ctx.fillRect(bx + 4*s, cy + 30*s, 3*s, 5*s);
  }
}

// ─── 雷皇 ザンヴォルト ───
function drawSprite_Zanvolt(ctx, W, H, color, isBoss, isElite) {
  const cx = W / 2, cy = H / 2;
  const s = isBoss ? 1.4 : 1;
  const bolt = Math.sin(Date.now() * 0.008) > 0.3;
  const arc  = Math.sin(Date.now() * 0.012) > 0.5;
  // 雷のオーラ
  if (bolt) {
    ctx.fillStyle = color + '44';
    ctx.fillRect(cx - 30*s, cy - 50*s, 60*s, 80*s);
  }
  ctx.fillStyle = color + '18';
  ctx.fillRect(cx - 26*s, cy - 46*s, 52*s, 72*s);
  // 体（黄金の鎧）
  ctx.fillStyle = '#4a4400';
  ctx.fillRect(cx - 20*s, cy - 22*s, 40*s, 34*s);
  ctx.fillStyle = color;
  ctx.fillRect(cx - 18*s, cy - 20*s, 5*s,  30*s);
  ctx.fillRect(cx + 13*s, cy - 20*s, 5*s,  30*s);
  ctx.fillRect(cx - 18*s, cy - 20*s, 36*s, 5*s);
  ctx.fillRect(cx - 18*s, cy + 6*s,  36*s, 5*s);
  // 胸紋章（雷）
  ctx.fillStyle = '#ffffaa';
  ctx.fillRect(cx - 2*s,  cy - 18*s, 4*s,  18*s);
  ctx.fillRect(cx - 6*s,  cy - 10*s, 12*s, 4*s);
  // 頭（皇帝の兜）
  ctx.fillStyle = '#4a4400';
  ctx.fillRect(cx - 18*s, cy - 46*s, 36*s, 26*s);
  // 冠（雷）
  ctx.fillStyle = color;
  ctx.fillRect(cx - 18*s, cy - 48*s, 36*s, 4*s);
  ctx.fillRect(cx - 2*s,  cy - 58*s, 4*s,  12*s);
  ctx.fillRect(cx - 10*s, cy - 54*s, 3*s,  8*s);
  ctx.fillRect(cx + 7*s,  cy - 54*s, 3*s,  8*s);
  ctx.fillRect(cx - 14*s, cy - 52*s, 3*s,  6*s);
  ctx.fillRect(cx + 11*s, cy - 52*s, 3*s,  6*s);
  // 目（稲妻色）
  ctx.fillStyle = color;
  ctx.fillRect(cx - 13*s, cy - 40*s, 9*s, 7*s);
  ctx.fillRect(cx + 4*s,  cy - 40*s, 9*s, 7*s);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cx - 11*s, cy - 38*s, 4*s, 3*s);
  ctx.fillRect(cx + 6*s,  cy - 38*s, 4*s, 3*s);
  // 巨大な雷剣（両手）
  ctx.fillStyle = '#888822';
  ctx.fillRect(cx - 36*s, cy - 44*s, 5*s, 60*s);
  ctx.fillRect(cx - 40*s, cy - 44*s, 14*s, 5*s);
  ctx.fillStyle = color;
  ctx.fillRect(cx - 35*s, cy - 44*s, 3*s, 60*s);
  ctx.fillStyle = '#888822';
  ctx.fillRect(cx + 31*s, cy - 44*s, 5*s, 60*s);
  ctx.fillRect(cx + 27*s, cy - 44*s, 14*s, 5*s);
  ctx.fillStyle = color;
  ctx.fillRect(cx + 32*s, cy - 44*s, 3*s, 60*s);
  // 雷エフェクト（点滅）
  if (arc) {
    ctx.fillStyle = '#ffffaa';
    ctx.fillRect(cx - 38*s, cy - 30*s, 4*s, 8*s);
    ctx.fillRect(cx - 36*s, cy - 22*s, 4*s, 8*s);
    ctx.fillRect(cx - 34*s, cy - 14*s, 4*s, 8*s);
    ctx.fillRect(cx + 30*s, cy - 20*s, 4*s, 8*s);
    ctx.fillRect(cx + 32*s, cy - 12*s, 4*s, 8*s);
  }
  // 脚
  ctx.fillStyle = '#4a4400';
  ctx.fillRect(cx - 14*s, cy + 12*s, 12*s, 20*s);
  ctx.fillRect(cx + 2*s,  cy + 12*s, 12*s, 20*s);
}

// ─── 深淵神 アビサル ───
function drawSprite_Abyssal(ctx, W, H, color, isBoss, isElite) {
  const cx = W / 2, cy = H / 2;
  const s = isBoss ? 1.4 : 1;
  const pulse = Math.sin(Date.now() * 0.002) * 5;
  const swirl = Math.sin(Date.now() * 0.001) * 3;
  // 深淵の虚無（多重オーラ）
  ctx.fillStyle = '#00000088';
  ctx.fillRect(cx - 34*s, cy - 54*s, 68*s, 88*s);
  ctx.fillStyle = color + '30';
  ctx.fillRect(cx - 30*s, cy - 50*s + swirl, 60*s, 80*s - swirl);
  ctx.fillStyle = '#2200aa18';
  ctx.fillRect(cx - 26*s, cy - 46*s - pulse, 52*s, 76*s + pulse*2);
  // 触手（4本）
  ctx.fillStyle = '#1a0044';
  ctx.fillRect(cx - 36*s, cy - 10*s + swirl, 14*s, 6*s);
  ctx.fillRect(cx - 40*s, cy - 2*s + swirl,  10*s, 6*s);
  ctx.fillRect(cx + 22*s, cy - 10*s - swirl, 14*s, 6*s);
  ctx.fillRect(cx + 30*s, cy - 2*s - swirl,  10*s, 6*s);
  // 下の触手
  ctx.fillRect(cx - 28*s, cy + 16*s, 10*s, 6*s);
  ctx.fillRect(cx - 32*s, cy + 22*s,  8*s, 5*s);
  ctx.fillRect(cx + 18*s, cy + 16*s, 10*s, 6*s);
  ctx.fillRect(cx + 24*s, cy + 22*s,  8*s, 5*s);
  ctx.fillStyle = color;
  ctx.fillRect(cx - 40*s, cy - 2*s, 3*s, 3*s);
  ctx.fillRect(cx + 37*s, cy - 2*s, 3*s, 3*s);
  // 体（不定形）
  ctx.fillStyle = '#0a0020';
  ctx.fillRect(cx - 20*s, cy - 22*s, 40*s, 38*s);
  ctx.fillStyle = '#1a0044';
  ctx.fillRect(cx - 24*s, cy - 16*s, 48*s, 26*s);
  // 体の紋様
  ctx.fillStyle = color + '88';
  ctx.fillRect(cx - 4*s,  cy - 18*s, 8*s,  30*s);
  ctx.fillRect(cx - 16*s, cy - 4*s,  32*s, 8*s);
  ctx.fillStyle = color + 'aa';
  ctx.fillRect(cx - 2*s,  cy - 16*s, 4*s,  26*s);
  // 頭（巨大な眼球）
  ctx.fillStyle = '#0a0020';
  ctx.fillRect(cx - 18*s, cy - 50*s, 36*s, 30*s);
  // 中央の大きな目
  ctx.fillStyle = color;
  ctx.fillRect(cx - 14*s, cy - 46*s, 28*s, 20*s);
  ctx.fillStyle = '#000022';
  ctx.fillRect(cx - 10*s, cy - 44*s, 20*s, 16*s);
  ctx.fillStyle = '#ff00ff';
  ctx.fillRect(cx - 5*s,  cy - 40*s, 10*s, 8*s);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cx - 2*s,  cy - 38*s, 4*s,  4*s);
  ctx.fillStyle = '#000000';
  ctx.fillRect(cx - 1*s,  cy - 37*s, 2*s,  2*s);
  // 小さな目（複数）
  ctx.fillStyle = color;
  ctx.fillRect(cx - 16*s, cy - 44*s, 4*s, 3*s);
  ctx.fillRect(cx + 12*s, cy - 44*s, 4*s, 3*s);
  ctx.fillRect(cx - 14*s, cy - 32*s, 3*s, 3*s);
  ctx.fillRect(cx + 11*s, cy - 32*s, 3*s, 3*s);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cx - 15*s, cy - 43*s, 2*s, 2*s);
  ctx.fillRect(cx + 13*s, cy - 43*s, 2*s, 2*s);
  // 下部（霧）
  ctx.fillStyle = color + '22';
  ctx.fillRect(cx - 22*s, cy + 16*s, 44*s, 16*s);
  ctx.fillStyle = color + '11';
  ctx.fillRect(cx - 18*s, cy + 28*s, 36*s, 10*s);
}

// ─── 混沌王 カオスロード ───
function drawSprite_ChaosLord(ctx, W, H, color, isBoss, isElite) {
  const cx = W / 2, cy = H / 2;
  const s = isBoss ? 1.4 : 1;
  const t   = Date.now() * 0.001;
  const p1  = Math.sin(t) * 4;
  const p2  = Math.sin(t * 1.3 + 1) * 3;
  const p3  = Math.sin(t * 0.7 + 2) * 5;
  // 全属性のカオスオーラ
  ctx.fillStyle = '#ff000022'; ctx.fillRect(cx - 34*s, cy - 54*s + p1, 68*s, 88*s);
  ctx.fillStyle = '#0000ff18'; ctx.fillRect(cx - 30*s, cy - 50*s + p2, 60*s, 80*s);
  ctx.fillStyle = '#00ff0014'; ctx.fillRect(cx - 32*s, cy - 52*s + p3, 64*s, 84*s);
  ctx.fillStyle = '#ffff0010'; ctx.fillRect(cx - 28*s, cy - 48*s - p1, 56*s, 76*s);
  // マント（混沌の色変化）
  ctx.fillStyle = `hsl(${(t * 50) % 360}, 60%, 10%)`;
  ctx.fillRect(cx - 28*s, cy - 30*s, 56*s, 58*s);
  ctx.fillRect(cx - 22*s, cy + 24*s, 10*s, 16*s);
  ctx.fillRect(cx + 12*s, cy + 24*s, 10*s, 16*s);
  // 体（鎧）
  ctx.fillStyle = '#0a0010';
  ctx.fillRect(cx - 20*s, cy - 22*s, 40*s, 32*s);
  // 6色の鎧装飾（混沌）
  const colors6 = ['#ff2200','#ff8800','#ffff00','#00ff44','#4488ff','#cc44ff'];
  colors6.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(cx - 18*s + i*6*s, cy - 20*s, 5*s, 28*s);
  });
  // 頭（巨大）
  ctx.fillStyle = '#0a0010';
  ctx.fillRect(cx - 20*s, cy - 50*s, 40*s, 30*s);
  // 混沌の6本角
  colors6.forEach((c, i) => {
    ctx.fillStyle = c;
    const hx = cx - 18*s + i*7*s;
    const hy = cy - 50*s - (12 + (i%3)*6)*s + (i%2 ? p1 : p2);
    ctx.fillRect(hx, hy, 4*s, (14 + (i%3)*6)*s);
  });
  // 縁取り
  ctx.fillStyle = '#ffffff44';
  ctx.fillRect(cx - 20*s, cy - 50*s, 40*s, 4*s);
  // 目（7つ、それぞれ色が違う）
  const eyeColors = ['#ff0000','#ff8800','#ffff00','#00ff44','#4488ff','#cc44ff','#ffffff'];
  eyeColors.slice(0,3).forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(cx - 14*s + i*10*s, cy - 44*s, 7*s, 6*s);
    ctx.fillStyle = '#000000';
    ctx.fillRect(cx - 12*s + i*10*s, cy - 42*s, 3*s, 2*s);
  });
  // 額の目
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cx - 3*s, cy - 36*s, 6*s, 6*s);
  ctx.fillStyle = '#ff00ff';
  ctx.fillRect(cx - 1*s, cy - 34*s, 2*s, 2*s);
  // 武器（左：氷槍、右：炎剣）
  ctx.fillStyle = '#88ccff';
  ctx.fillRect(cx - 36*s, cy - 46*s, 4*s,  58*s);
  ctx.fillRect(cx - 36*s, cy - 46*s, 8*s,   4*s);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cx - 34*s, cy - 46*s, 2*s,  58*s);
  ctx.fillStyle = '#ff4400';
  ctx.fillRect(cx + 32*s, cy - 44*s, 4*s,  56*s);
  ctx.fillRect(cx + 28*s, cy - 44*s, 12*s,  4*s);
  ctx.fillStyle = '#ffcc00';
  ctx.fillRect(cx + 33*s, cy - 44*s, 2*s,  56*s);
  // 混沌エフェクト（フリッカー）
  if (Math.sin(t * 7) > 0.6) {
    ctx.fillStyle = `hsla(${(t*80)%360},100%,70%,0.3)`;
    ctx.fillRect(cx - 22*s, cy - 52*s, 44*s, 72*s);
  }
  // 脚
  ctx.fillStyle = '#0a0010';
  ctx.fillRect(cx - 14*s, cy + 10*s, 12*s, 22*s);
  ctx.fillRect(cx + 2*s,  cy + 10*s, 12*s, 22*s);
}

// ─── 汎用（ボス・エリートの名前一致しない場合） ───
function drawSprite_Generic(ctx, W, H, color, isBoss, isElite) {
  const scale = isBoss ? 3 : isElite ? 2.4 : 2;
  const S = 16 * scale;
  const ox = Math.floor((W - S) / 2);
  const oy = Math.floor((H - S) / 2) + (isBoss ? -4 : 0);
  ctx.fillStyle = color;
  ctx.fillRect(ox, oy + S * 0.25, S, S * 0.6);
  ctx.fillRect(ox + (S - S * 0.6) / 2, oy, S * 0.6, S * 0.4);
  ctx.fillStyle = '#ffffff';
  const es = Math.max(2, scale * 1.5);
  ctx.fillRect(ox + S * 0.2, oy + S * 0.1, es, es);
  ctx.fillRect(ox + S * 0.6, oy + S * 0.1, es, es);
  ctx.fillStyle = '#000000';
  ctx.fillRect(ox + S * 0.2 + 1, oy + S * 0.1 + 1, es - 1, es - 1);
  ctx.fillRect(ox + S * 0.6 + 1, oy + S * 0.1 + 1, es - 1, es - 1);
  if (isBoss) {
    ctx.fillStyle = '#f5c842';
    ctx.fillRect(ox + S * 0.1, oy - scale * 4, S * 0.8, scale * 2);
    for (let i = 0; i < 3; i++) ctx.fillRect(ox + S * (0.15 + i * 0.3), oy - scale * 6, scale * 2, scale * 3);
  }
}

function drawEnemySprite(enemy) {
  const W = spriteCanvas.width;
  const H = spriteCanvas.height;
  sctx.clearRect(0, 0, W, H);
  if (!enemy) return;

  const color = enemy.color || '#e84040';
  const isBoss = enemy.kind === 'boss';
  const isElite = enemy.kind === 'elite';

  // ボスオーラ
  if (isBoss) {
    sctx.fillStyle = color + '22';
    sctx.fillRect(0, 0, W, H);
    sctx.fillStyle = color + '11';
    sctx.fillRect(4, 4, W - 8, H - 8);
  }

 const spriteDrawers = {
    // ── 通常モンスター ──
    'スライム': drawSprite_Slime,
    'コウモリ': drawSprite_Bat,
    'スケルトン': drawSprite_Skeleton,
    'オーク': drawSprite_Orc,
    'ゴブリン': drawSprite_Goblin,
    'ゾンビ': drawSprite_Zombie,
    'デーモン': drawSprite_Demon,
    'エンジェル': drawSprite_Angel,
    'リザードマン': drawSprite_Lizard,
    'ドラゴン': drawSprite_Dragon,
    // ── エリート ──
    '死神騎士': drawSprite_DeathKnight,
    '溶岩巨人': drawSprite_LavaGiant,
    '影の暗殺者': drawSprite_ShadowAssassin,
    '魔将軍': drawSprite_MagicGeneral,
    '氷刃の狩人': drawSprite_IceHunter,
    '雷光の剣士': drawSprite_ThunderSwordsman,
    '闇の司祭': drawSprite_DarkPriest,
    '無属の釈迦': drawSprite_AbyssMonk,
    // ── ボス（ノーマル） ──
    '地下王 ゴーレム': drawSprite_Golem,
    '炎王 イフリート': drawSprite_Ifrit,
    '深淵龍 ヴォルグ': drawSprite_Volg,
    '魔王 ダルクロア': drawSprite_Darkroa,
    // ── ボス（ハード） ──
    '岩王 グラニウス': drawSprite_Granius,
    '炎獣 イグナール': drawSprite_Ignar,
    '雷皇 ザンヴォルト': drawSprite_Zanvolt,
    '深淵神 アビサル': drawSprite_Abyssal,
    '混沌王 カオスロード': drawSprite_ChaosLord,
  };

  const drawer = spriteDrawers[enemy.name];
  if (drawer) {
    drawer(sctx, W, H, color, isBoss, isElite);
  } else {
    drawSprite_Generic(sctx, W, H, color, isBoss, isElite);
  }

  // HPゲージ（共通）
  const barW = W - 8, barH = 6, barX = 4, barY = H - barH - 4;
  sctx.fillStyle = '#1a1a28';
  sctx.fillRect(barX, barY, barW, barH);
  const hpRatio = Math.max(0, enemy.hp / enemy.maxHp);
  sctx.fillStyle = hpRatio > 0.5 ? '#3ecc6f' : hpRatio > 0.25 ? '#f5c842' : '#e84040';
  sctx.fillRect(barX, barY, Math.floor(barW * hpRatio), barH);
  sctx.strokeStyle = '#3a3a5a';
  sctx.lineWidth = 1;
  sctx.strokeRect(barX, barY, barW, barH);
}
// ══════════════════════════════════════════════════════════
//  DAMAGE POPUP SYSTEM
// ══════════════════════════════════════════════════════════
const popups = [];

function spawnPopup(gridX, gridY, text, color = '#ffffff') {
  popups.push({
    x: gridX * TILE + TILE / 2, y: gridY * TILE,
    text, color, life: 60, maxLife: 60, vy: -1.2
  });
}

function updatePopups() {
  for (let i = popups.length - 1; i >= 0; i--) {
    const p = popups[i];
    p.x += (p.vx || 0); p.y += p.vy;
    p.vy *= 0.96; if (p.vx) p.vx *= 0.94;
    p.life--;
    if (p.life <= 0) popups.splice(i, 1);
  }
}

function renderPopups() {
  pctx.clearRect(0, 0, popupCanvas.width, popupCanvas.height);
  for (const p of popups) {
    const alpha = p.life / p.maxLife;
    pctx.globalAlpha = alpha;
    pctx.font = `bold 11px 'Press Start 2P', monospace`;
    pctx.textAlign = 'center';
    pctx.fillStyle = '#000000';
    pctx.fillText(p.text, p.x + 1, p.y + 1);
    pctx.fillStyle = p.color;
    pctx.fillText(p.text, p.x, p.y);
  }
  pctx.globalAlpha = 1;
  pctx.textAlign = 'left';
}

function popupLoop() {
  updatePopups(); renderPopups();
  requestAnimationFrame(popupLoop);
}
requestAnimationFrame(popupLoop);

// ══════════════════════════════════════════════════════════
//  INIT / START
// ══════════════════════════════════════════════════════════
function startGame(classId) {
  document.getElementById('overlay').classList.remove('active');
  const cls = CLASSES[classId] || CLASSES.warrior;
  const savedMode = G.mode || 'normal';
  G = {
    floor: 1,
    mode: savedMode,
    playerClass: cls,
    player: {
      hp: cls.hp, maxHp: cls.hp,
      mp: cls.mp, maxMp: cls.mp,
      atk: cls.atk, def: cls.def,
      lv: 1, exp: 0, expNext: 10,
      gold: 0, kills: 0,
      equip: { wpn: null, wpnBonus: 0, arm: null, armBonus: 0, acc: null },
      items: cls.startItems.map(i => ({ ...i })),
      skills: [],
      skillCommands: [...(cls.startSkillCommands || [])],
      passives: {},
    },
    map: null, rooms: [], enemies: [], items: [],
    px: 0, py: 0,
    explored: null,
    inCombat: false,
    inShop: false,
    currentEnemy: null,
    pendingSkillChoices: null,
    isBossFloor: false,
    shopStock: null,
    nextShopFloor: 1 + Math.floor(Math.random() * 3),
  };
  document.getElementById('class-badge').textContent = cls.icon + ' ' + cls.name;
  const mb = document.getElementById('mode-badge');
  if (mb) {
    if (savedMode === 'hard') {
      mb.textContent = '💀 HARD MODE';
      mb.style.display = 'block';
    } else {
      mb.style.display = 'none';
    }
  }
  generateFloor();
  log(`${cls.name}がダンジョンに足を踏み入れた…`, 'sys');
  updateItemList();
  renderSkillList();
  updateEquipDisplay();
}

// ══════════════════════════════════════════════════════════
//  MAP GENERATION
// ══════════════════════════════════════════════════════════

function generateFloor() {
  G._regenSteps = 0;
  if (G.mode === 'hard' && G.floor > 25) {
    gameWin();
    return;
  }
  // ノーマルモードの最終フロアチェック
  if (G.mode === 'normal' && G.floor > 20) {
    gameWin();
    return;
  }
  G.isBossFloor = G.floor % 5 === 0;
  // 以下既存のまま

  const map = Array.from({ length: ROWS }, () => new Array(COLS).fill(TILE_WALL));
  const explored = Array.from({ length: ROWS }, () => new Array(COLS).fill(false));
  const rooms = [];

  for (let i = 0; i < 30; i++) {
    const w = 4 + Math.floor(Math.random() * 6);
    const h = 3 + Math.floor(Math.random() * 5);
    const x = 1 + Math.floor(Math.random() * (COLS - w - 2));
    const y = 1 + Math.floor(Math.random() * (ROWS - h - 2));
    const room = { x, y, w, h, cx: x + Math.floor(w / 2), cy: y + Math.floor(h / 2) };
    if (!rooms.some(r => rectsOverlap(r, room, 1))) {
      rooms.push(room);
      for (let ry = y; ry < y + h; ry++)
        for (let rx = x; rx < x + w; rx++)
          map[ry][rx] = TILE_FLOOR;
    }
  }

  for (let i = 1; i < rooms.length; i++)
    carveCorridor(map, rooms[i - 1].cx, rooms[i - 1].cy, rooms[i].cx, rooms[i].cy);

  if (rooms.length === 0) {
    const fallback = { x: 10, y: 7, w: 10, h: 6, cx: 15, cy: 10 };
    rooms.push(fallback);
    for (let ry = fallback.y; ry < fallback.y + fallback.h; ry++)
      for (let rx = fallback.x; rx < fallback.x + fallback.w; rx++)
        map[ry][rx] = TILE_FLOOR;
  }

  G.px = rooms[0].cx;
  G.py = rooms[0].cy;

  const lr = rooms[rooms.length - 1];
  map[lr.cy][lr.cx] = TILE_STAIR;

  const isHard = G.mode === 'hard';
  const chestRate = (isHard ? 0.2 : 0.4) + (G.player ? (G.player.passives.treasureBoost || 0) : 0);
  rooms.slice(1, -1).forEach(r => {
    if (Math.random() < chestRate) {
      const fx = r.x + 1 + Math.floor(Math.random() * (r.w - 2));
      const fy = r.y + 1 + Math.floor(Math.random() * (r.h - 2));
      if (map[fy][fx] === TILE_FLOOR) map[fy][fx] = TILE_CHEST;
    }
  });

  G.shopStock = null;
  const isHardMode = G.mode === 'hard';
  const isShopFloor = isHardMode
    ? (G.floor % 5 === 0)
    : G.floor >= G.nextShopFloor;
  if (isShopFloor && rooms.length >= 3) {
    const shopRoomIdx = 1 + Math.floor(Math.random() * Math.max(1, rooms.length - 2));
    const sr = rooms[shopRoomIdx];
    map[sr.cy][sr.cx] = TILE_SHOP;
    if (!isHardMode) {
      G.nextShopFloor = G.floor + 1 + Math.floor(Math.random() * 3);
    }
    log(`🏪 このフロアに商売屋がある！`, 'shop');
  }

  const enemies = [];
  const fl = G.floor;

  if (G.isBossFloor) {
    const bossList = G.mode === 'hard' ? HARD_BOSS_TYPES : BOSS_TYPES;
    const bossIdx = Math.min(Math.floor(fl / 5) - 1, bossList.length - 1);
    const boss = makeBoss(lr.cx, lr.cy, fl, bossIdx);
    enemies.push(boss);
    log(`⚠ ${G.floor}Fはボスフロア！`, 'boss');
    rooms.slice(1, -1).forEach(r => {
      if (Math.random() < 0.5) {
        const ex = r.x + 1 + Math.floor(Math.random() * (r.w - 2));
        const ey = r.y + 1 + Math.floor(Math.random() * (r.h - 2));
        if (map[ey][ex] === TILE_FLOOR && !(ex === G.px && ey === G.py))
          enemies.push(makeEnemy(ex, ey, fl));
      }
    });
  } else {
    rooms.slice(1).forEach(r => {
      const count = 1 + (Math.random() < 0.4 ? 1 : 0);
      for (let i = 0; i < count; i++) {
        const ex = r.x + 1 + Math.floor(Math.random() * (r.w - 2));
        const ey = r.y + 1 + Math.floor(Math.random() * (r.h - 2));
        if (map[ey][ex] === TILE_FLOOR && !(ex === G.px && ey === G.py)) {
          const isHardElite = G.mode === 'hard';
          const eliteFloorMin = isHardElite ? 5 : 5;
          const isElite = Math.random() < 0.15 && fl >= eliteFloorMin;
          enemies.push(isElite ? makeElite(ex, ey, fl) : makeEnemy(ex, ey, fl));
        }
      }
    });
  }

  G.map = map; G.rooms = rooms; G.enemies = enemies;
  G.explored = explored; G.items = [];
  updateFOV(); renderAll(); updateUI();
}

function rectsOverlap(a, b, pad) {
  return !(b.x >= a.x + a.w + pad || b.x + b.w + pad <= a.x ||
    b.y >= a.y + a.h + pad || b.y + b.h + pad <= a.y);
}

function carveCorridor(map, x1, y1, x2, y2) {
  let x = x1, y = y1;
  while (x !== x2) { map[y][x] = TILE_FLOOR; x += x < x2 ? 1 : -1; }
  while (y !== y2) { map[y][x] = TILE_FLOOR; y += y < y2 ? 1 : -1; }
}

function makeEnemy(x, y, floor) {
  const isHard = G.mode === 'hard';
  const tier = Math.min(Math.floor(Math.random() * (floor + 2)), ENEMY_TYPES.length - 1);
  const base = ENEMY_TYPES[tier];
  const scale = Math.min((1 + (floor - 1) * 0.2) * (isHard ? 1.25 : 1), 2.0);
  const hp = Math.ceil(base.hp * scale);
  const pattern = ENEMY_PATTERNS[base.name] || { actions: ['atk'], phase2: null };
  const nextIntent = pickEnemyIntent(pattern.actions, null, null);
  return {
    ...base, x, y, hp, maxHp: hp,
    atk: Math.ceil(base.atk * scale),
    def: Math.ceil(base.def * scale),
    kind: 'normal',
    pattern,
    nextIntent,
    lastIntent: null,
    secondLastIntent: null,
  };
}

function makeElite(x, y, floor) {
  const isHard = G.mode === 'hard';
  let pool;
  if (isHard && floor >= 10) {
    pool = ELITE_TYPES.filter(e => e.hardOnly);
  } else {
    pool = ELITE_TYPES.filter(e => !e.hardOnly);
  }
  const base = pool[Math.floor(Math.random() * pool.length)];
  const scale = (1 + (floor - 1) * 0.25) * (isHard ? 1.25 : 1);
  const hp = Math.ceil(base.hp * scale);
  const pattern = { actions: [base.special, 'atk', 'atk'], phase2: base.special };
  const nextIntent = pickEnemyIntent(pattern.actions, null, null);
  return {
    ...base, x, y, hp, maxHp: hp,
    atk: Math.ceil(base.atk * scale),
    def: Math.ceil(base.def * scale),
    kind: 'elite', buffed: false, burnTurns: 0,
    pattern, nextIntent,
    lastIntent: null,
    secondLastIntent: null,
  };
}

// ══════════════════════════════════════════════════════════
//  FOV
// ══════════════════════════════════════════════════════════
function updateFOV() {
  const r = 5;
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++)
      if (dx * dx + dy * dy <= r * r) {
        const nx = G.px + dx, ny = G.py + dy;
        if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS) G.explored[ny][nx] = true;
      }
}

function drawPlayerSprite(targetCtx, x, y) {
  const clsId = Object.keys(CLASSES).find(k => CLASSES[k] === G.playerClass) || 'warrior';
  const cls = G.playerClass || CLASSES[clsId] || CLASSES.warrior;
  const color = cls.color || '#f5c842';
  const cx = x + TILE / 2;
  const top = y + 2;

  targetCtx.save();
  targetCtx.shadowColor = color;
  targetCtx.shadowBlur = 8;

  targetCtx.fillStyle = color + '33';
  targetCtx.fillRect(x + 2, y + 2, TILE - 4, TILE - 2);

  targetCtx.fillStyle = '#111118';
  targetCtx.fillRect(cx - 5, top + 6, 10, 7);
  targetCtx.fillStyle = color;
  targetCtx.fillRect(cx - 4, top + 5, 8, 8);

  targetCtx.fillStyle = '#ffd7aa';
  targetCtx.fillRect(cx - 4, top + 1, 8, 6);

  targetCtx.shadowBlur = 0;
  targetCtx.fillStyle = '#ffffff';
  targetCtx.fillRect(cx - 3, top + 3, 2, 2);
  targetCtx.fillRect(cx + 1, top + 3, 2, 2);
  targetCtx.fillStyle = '#000000';
  targetCtx.fillRect(cx - 2, top + 4, 1, 1);
  targetCtx.fillRect(cx + 2, top + 4, 1, 1);

  targetCtx.fillStyle = '#f5c842';
  if (clsId === 'warrior') {
    targetCtx.fillRect(x + 11, y + 4, 2, 9);
    targetCtx.fillRect(x + 10, y + 4, 4, 2);
  } else if (clsId === 'mage') {
    targetCtx.fillRect(x + 11, y + 4, 2, 9);
    targetCtx.fillStyle = '#4488ff';
    targetCtx.fillRect(x + 10, y + 2, 4, 4);
  } else if (clsId === 'rogue') {
    targetCtx.fillStyle = '#3ee8cc';
    targetCtx.fillRect(x + 2, y + 11, 5, 2);
    targetCtx.fillRect(x + 9, y + 11, 5, 2);
  } else if (clsId === 'cleric') {
    targetCtx.fillRect(cx - 1, y + 1, 2, 7);
    targetCtx.fillRect(cx - 4, y + 3, 8, 2);
  }

  targetCtx.fillStyle = '#00000066';
  targetCtx.fillRect(x + 4, y + 14, 8, 1);
  targetCtx.restore();
}

// ══════════════════════════════════════════════════════════
//  RENDER
// ══════════════════════════════════════════════════════════
function renderAll() {
  if (!G.map || !G.explored || !G.player) return;

  ctx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
  ctx.fillStyle = '#050508';
  ctx.fillRect(0, 0, mapCanvas.width, mapCanvas.height);
  const px = G.px, py = G.py, r = 5;

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (!G.explored[y][x]) continue;
      const vis = (x - px) * (x - px) + (y - py) * (y - py) <= r * r;
      const tile = G.map[y][x];
      const wx = x * TILE, wy = y * TILE;

      if (!vis) {
        ctx.fillStyle = tile === TILE_WALL ? '#111120' : '#0c0c14';
        ctx.fillRect(wx, wy, TILE, TILE);
        if (tile === TILE_WALL) {
          ctx.fillStyle = '#1a1a28';
          ctx.fillRect(wx, wy, TILE - 1, TILE - 1);
        }
        continue;
      }

      if (tile === TILE_WALL) {
        ctx.fillStyle = '#1a1a28'; ctx.fillRect(wx, wy, TILE, TILE);
        ctx.fillStyle = '#222235'; ctx.fillRect(wx, wy, TILE - 1, TILE - 1);
        ctx.fillStyle = '#2a2a3e'; ctx.fillRect(wx + 1, wy + 1, TILE - 3, TILE - 3);
      } else {
        // ハードモードの通路（部屋外）はダメージ床として赤みがかった色に
        const inRoom = G.rooms && G.rooms.some(r =>
          x >= r.x && x < r.x + r.w &&
          y >= r.y && y < r.y + r.h
        );
        const isHardCorridor = G.mode === 'hard' && G.floor >= 10 && !inRoom && tile === TILE_FLOOR;
        if (isHardCorridor) {
          ctx.fillStyle = (x + y) % 3 === 0 ? '#201010' : '#180c0c';
          ctx.fillRect(wx, wy, TILE, TILE);
          ctx.fillStyle = '#2a0808';
          ctx.fillRect(wx, wy, TILE, 1); ctx.fillRect(wx, wy, 1, TILE);
          // 小さな赤いドット（トゲ表現）
          ctx.fillStyle = '#5a1010';
          ctx.fillRect(wx + 4, wy + 4, 2, 2);
          ctx.fillRect(wx + 10, wy + 10, 2, 2);
          ctx.fillRect(wx + 10, wy + 4, 2, 2);
          ctx.fillRect(wx + 4, wy + 10, 2, 2);
        } else {
          ctx.fillStyle = (x + y) % 3 === 0 ? '#181820' : '#14141e';
          ctx.fillRect(wx, wy, TILE, TILE);
          ctx.fillStyle = '#0f0f18';
          ctx.fillRect(wx, wy, TILE, 1); ctx.fillRect(wx, wy, 1, TILE);
        }

        if (tile === TILE_STAIR) {
          ctx.fillStyle = '#f5c842';
          for (let i = 1; i < 4; i++) ctx.fillRect(wx + i * 2, wy + TILE - i * 3 - 2, TILE - i * 4, 2);
          ctx.fillStyle = '#ffd700'; ctx.fillRect(wx + 5, wy + 2, 6, 2);
        } else if (tile === TILE_CHEST) {
          ctx.fillStyle = '#7a3a00'; ctx.fillRect(wx + 2, wy + 5, 12, 8);
          ctx.fillStyle = '#b06aff'; ctx.fillRect(wx + 2, wy + 5, 12, 4);
          ctx.fillStyle = '#f5c842'; ctx.fillRect(wx + 6, wy + 8, 4, 2);
        } else if (tile === TILE_SHOP) {
          ctx.fillStyle = '#3a2e00'; ctx.fillRect(wx + 1, wy + 4, 14, 11);
          ctx.fillStyle = '#ffcc44'; ctx.fillRect(wx + 1, wy + 4, 14, 4);
          ctx.fillStyle = '#7a6200'; ctx.fillRect(wx + 5, wy + 8, 6, 7);
          ctx.fillStyle = '#ffcc44'; ctx.fillRect(wx + 4, wy + 3, 8, 2);
          ctx.shadowColor = '#ffcc44'; ctx.shadowBlur = 6;
          ctx.fillStyle = '#ffdd66'; ctx.fillRect(wx + 4, wy + 3, 8, 2);
          ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
        }
      }
    }
  }

  G.items.forEach(item => {
    if (!G.explored[item.y][item.x]) return;
    if ((item.x - px) * (item.x - px) + (item.y - py) * (item.y - py) > r * r) return;
    ctx.fillStyle = '#f5c842'; ctx.fillRect(item.x * TILE + 5, item.y * TILE + 5, 6, 6);
    ctx.fillStyle = '#fff8aa'; ctx.fillRect(item.x * TILE + 6, item.y * TILE + 6, 2, 2);
  });

  G.enemies.forEach(e => {
    if (!G.explored[e.y][e.x]) return;
    if ((e.x - px) * (e.x - px) + (e.y - py) * (e.y - py) > r * r) return;

    const isBoss = e.kind === 'boss';
    const isElite = e.kind === 'elite';

    if (isBoss) { ctx.shadowColor = e.color; ctx.shadowBlur = 10; }
    else if (isElite) { ctx.shadowColor = '#ff66aa'; ctx.shadowBlur = 6; }

    const sz = isBoss ? 14 : isElite ? 13 : 12;
    const ox = isBoss ? 1 : isElite ? 1 : 2;
    ctx.fillStyle = e.color || '#e84040';
    ctx.fillRect(e.x * TILE + ox, e.y * TILE + 3, sz, 10);
    ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';

    ctx.fillStyle = '#fff';
    ctx.fillRect(e.x * TILE + 4, e.y * TILE + 5, 2, 2);
    ctx.fillRect(e.x * TILE + 9, e.y * TILE + 5, 2, 2);
    ctx.fillStyle = '#000';
    ctx.fillRect(e.x * TILE + 5, e.y * TILE + 6, 1, 1);
    ctx.fillRect(e.x * TILE + 10, e.y * TILE + 6, 1, 1);

    if (isBoss) {
      ctx.fillStyle = '#f5c842';
      ctx.fillRect(e.x * TILE + 3, e.y * TILE + 1, 10, 2);
      ctx.fillRect(e.x * TILE + 3, e.y * TILE + 0, 2, 2);
      ctx.fillRect(e.x * TILE + 8, e.y * TILE + 0, 2, 2);
      ctx.fillRect(e.x * TILE + 13, e.y * TILE + 0, 2, 2);
    }
    if (isElite) {
      ctx.fillStyle = '#ff66aa';
      ctx.fillRect(e.x * TILE + 6, e.y * TILE + 1, 4, 2);
    }

    ctx.fillStyle = '#300'; ctx.fillRect(e.x * TILE + 1, e.y * TILE + 1, 14, 2);
    ctx.fillStyle = isBoss ? '#ff8c00' : isElite ? '#ff44aa' : '#e84040';
    ctx.fillRect(e.x * TILE + 1, e.y * TILE + 1, Math.round(14 * e.hp / e.maxHp), 2);
  });

  // 職業別プレイヤースプライト
  drawPlayerSprite(ctx, px * TILE, py * TILE);
}

// ══════════════════════════════════════════════════════════
//  MOVEMENT
// ══════════════════════════════════════════════════════════
function tryMove(dx, dy) {
  if (G.inCombat || G.pendingSkillChoices || G.inShop) return;
  const nx = G.px + dx, ny = G.py + dy;
  if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) return;
  const tile = G.map[ny][nx];
  if (tile === TILE_WALL) return;

  const enemy = G.enemies.find(e => e.x === nx && e.y === ny);
  if (enemy) {
    const adjacentAfterMove = G.enemies.filter(e => {
      if (e === enemy) return false;
      const dist = Math.abs(e.x - nx) + Math.abs(e.y - ny);
      return dist === 1;
    });
    if (adjacentAfterMove.length > 0) {
      const second = adjacentAfterMove[0];
      startCombat(enemy, true, second);
    } else {
      startCombat(enemy, true);
    }


    return;
  }

  G.px = nx; G.py = ny;
  updateFOV();

  const p = G.player;
  if (p.passives.regen) {
    // 自然回復（ALL_SKILLS由来）は100歩上限、戦士系regenは50歩上限
    const regenLimit = (p.skills && p.skills.some(s => s.id === 'regen')) ? 100 : 50;
    G._regenSteps = (G._regenSteps || 0) + 1;
    if (G._regenSteps <= regenLimit) {
      p.hp = Math.min(p.hp + p.passives.regen, p.maxHp);
    }
  }
  if (p.passives.mpRegen) { p.mp = Math.min(p.mp + p.passives.mpRegen, p.maxMp); }

  if (tile === TILE_STAIR) {
    G.floor++;
    log(`${G.floor}階へ降りた！`, 'sys');
    document.getElementById('floor-num').textContent = G.floor;
    generateFloor(); return;
  }
  if (tile === TILE_SHOP) {
    openShop(); renderAll(); updateUI(); return;
  }
  if (tile === TILE_CHEST) { openChest(nx, ny); G.map[ny][nx] = TILE_FLOOR; }

  const itemIdx = G.items.findIndex(i => i.x === nx && i.y === ny);
  if (itemIdx >= 0) pickItem(itemIdx);

  enemyTurn();
  renderAll(); updateUI();
}

function enemyTurn() {
  if (G.inCombat) return;
  G.enemies.forEach(e => {
    const dist = Math.abs(e.x - G.px) + Math.abs(e.y - G.py);
    if (e.locked) return;
    if (dist > 6) return;
    if (dist === 1) {
      doEnemyAttack(e);
    } else {
      const dx = G.px - e.x, dy = G.py - e.y;
      const moves = [];
      if (dx !== 0) moves.push([Math.sign(dx), 0]);
      if (dy !== 0) moves.push([0, Math.sign(dy)]);
      for (const [mx, my] of moves) {
        const nx = e.x + mx, ny = e.y + my;
        if (
          G.map[ny]?.[nx] !== TILE_WALL &&
          !G.enemies.some(o => o !== e && o.x === nx && o.y === ny) &&
          !(nx === G.px && ny === G.py)
        ) { e.x = nx; e.y = ny; break; }
      }
    }
  });
  updateUI();
}

// ══════════════════════════════════════════════════════════
//  COMBAT MENU
// ══════════════════════════════════════════════════════════
function updateCombatMenu() {
  document.querySelectorAll('.battle-command').forEach((el, i) => {
    el.classList.toggle('selected', i === combatMenuIndex);
  });
}

function executeSelectedCommand() {
  combatAction(combatCommands[combatMenuIndex]);
}

// ══════════════════════════════════════════════════════════
//  COMBAT
// ══════════════════════════════════════════════════════════
// ── 会心フラッシュ ──
function triggerCritFlash() {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position:fixed;inset:0;background:rgba(245,200,66,0.25);
    pointer-events:none;z-index:999;
    animation:critflash 0.35s ease-out forwards;
  `;
  document.body.appendChild(overlay);
  setTimeout(() => overlay.remove(), 400);
}

// ── ボス登場シェイク ──
function triggerBossShake() {
  const wrap = document.getElementById('map-container');
  if (!wrap) return;
  wrap.style.animation = 'none';
  wrap.offsetWidth; // reflow
  wrap.style.animation = 'bossshake 0.5s ease-out';
  setTimeout(() => wrap.style.animation = '', 600);
}

// ── 撃破パーティクル ──
function spawnDefeatParticles(gridX, gridY, color) {
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const speed = 0.8 + Math.random() * 1.2;
    popups.push({
      x: gridX * TILE + TILE / 2,
      y: gridY * TILE + TILE / 2,
      text: '★',
      color: color,
      life: 40 + Math.floor(Math.random() * 20),
      maxLife: 60,
      vy: Math.sin(angle) * speed - 1,
      vx: Math.cos(angle) * speed,
    });
  }
}

// ── スキルカラーエフェクト ──
function triggerSkillFlash(color) {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position:fixed;inset:0;background:${color}22;
    pointer-events:none;z-index:999;
    animation:critflash 0.4s ease-out forwards;
  `;
  document.body.appendChild(overlay);
  setTimeout(() => overlay.remove(), 450);
}

function startCombat(enemy, playerFirst = false, secondEnemy = null) {
  enemy.locked = true;
  G.inCombat = true;
  G.currentEnemy = enemy;
  G.secondEnemy = secondEnemy || null;
  if (secondEnemy) secondEnemy.locked = true;

  // SPD判定で先制/後攻を決める
  const playerSpd = 5 + (G.player.lv || 1) + Math.floor(Math.random() * 10);
  const enemySpd = 3 + (enemy.atk || 1) + Math.floor(Math.random() * 10);
  const playerGoesFirst = playerSpd >= enemySpd;
  G.playerFirst = playerGoesFirst;

  if (playerGoesFirst) {
    log(`先制！ あなたが先に動ける！（自SPD:${playerSpd} / 敵SPD:${enemySpd}）`, 'good');
  } else {
    log(`後攻… 敵に先手を取られた！（自SPD:${playerSpd} / 敵SPD:${enemySpd}）`, 'warn');
  }

  const panel = document.getElementById('combat-panel');
  panel.classList.add('active');
  panel.classList.remove('boss-fight', 'elite-fight');
  if (enemy.kind === 'boss') panel.classList.add('boss-fight');
  if (enemy.kind === 'elite') panel.classList.add('elite-fight');

  document.getElementById('enemy-name').textContent = secondEnemy
    ? enemy.name + ' & ' + secondEnemy.name
    : enemy.name;

  const badge = document.getElementById('enemy-type-badge');
  if (enemy.kind === 'boss') { badge.textContent = '★ BOSS'; badge.className = 'badge-boss'; }
  else if (enemy.kind === 'elite') { badge.textContent = '◆ ELITE'; badge.className = 'badge-elite'; }
  else if (secondEnemy) { badge.textContent = '⚠ 挟み撃ち！'; badge.className = 'badge-elite'; }
  else { badge.textContent = ''; badge.className = ''; }

  if (G.player.passives.barrier > 0) {
    G.player._barrierShield = G.player.passives.barrier;
  }

  drawEnemySprite(enemy);
  updateEnemyBar();
  updateBossIntent();
  updateBattlePlayerBars();

  const kindStr = enemy.kind === 'boss' ? 'ボス' : enemy.kind === 'elite' ? 'エリート' : '';
  const cls = enemy.kind === 'boss' ? 'boss' : enemy.kind === 'elite' ? 'elite' : 'combat';
  if (secondEnemy) {
    log(`挟み撃ち！ ${enemy.name} と ${secondEnemy.name} が同時に現れた！`, 'boss');
  } else {
    log(`${kindStr ? kindStr + '「' : ''}${enemy.name}${kindStr ? '」' : ''}が現れた！`, cls);
  }
  if (enemy.kind === 'boss') triggerBossShake();


  combatMenuIndex = 0;
  updateCombatMenu();
  updateUI();
}

function updateBossIntent() {
  const e = G.currentEnemy;
  const el = document.getElementById('enemy-intent');
  if (!e) { el.textContent = ''; el.className = ''; return; }

  const intentMap = {
    atk: { icon: '⚔', label: '攻撃してくる', cls: 'intent-atk' },
    slam: { icon: '💥', label: '強烈な一撃を準備中', cls: 'intent-atk' },
    burn: { icon: '🔥', label: '炎攻撃をしてくる', cls: 'intent-atk' },
    poison: { icon: '🐍', label: '毒攻撃をしてくる', cls: 'intent-atk' },
    drain: { icon: '💜', label: 'MP吸収攻撃をしてくる', cls: 'intent-buff' },
    buff: { icon: '💪', label: '自己強化する', cls: 'intent-buff' },
    defend: { icon: '🛡', label: '防御態勢をとる', cls: 'intent-buff' },
    heal: { icon: '💚', label: '回復している', cls: 'intent-heal' },
    regen: { icon: '🌿', label: '再生している', cls: 'intent-heal' },
    multi: { icon: '⚡', label: '連続攻撃を準備中', cls: 'intent-atk' },
    abyss_def: { icon: '💀', label: 'DEF無視の構えをとる', cls: 'intent-atk' },
  };

  const info = intentMap[e.nextIntent] || { icon: '？', label: '様子を見ている', cls: '' };

  // 攻撃系インテントのダメージ予測
  const atkIntents = ['atk', 'slam', 'burn', 'poison', 'multi'];
  let dmgHint = '';
  if (atkIntents.includes(e.nextIntent)) {
    const p = G.player;
    let raw;
    if (e.nextIntent === 'slam') raw = Math.floor(e.atk * 1.8);
    else if (e.nextIntent === 'multi') raw = Math.floor(e.atk * 0.6);
    else raw = e.atk;
    const predicted = Math.max(1, raw - p.def);
    const lo = Math.max(1, predicted - 3);
    const hi = predicted + 3;
    dmgHint = ` (予測${lo}〜${hi})`;
  }

  el.textContent = `${info.icon} ${info.label}${dmgHint}`;
  el.className = info.cls;
}

function endCombat() {
  if (G.currentEnemy) G.currentEnemy.locked = false;
  if (G.secondEnemy) G.secondEnemy.locked = false;
  G.inCombat = false;
  G.currentEnemy = null;
  if (G.player) G.player._miracleUsed = false;
  G.secondEnemy = null;

  if (typeof skillSubMenuActive !== 'undefined' && skillSubMenuActive) {
    skillSubMenuActive = false;
  }
  if (typeof itemSubMenuActive !== 'undefined' && itemSubMenuActive) {
    itemSubMenuActive = false;
    document.getElementById('item-submenu').classList.remove('active');
  }

  if (typeof renderCombatCommands === 'function') renderCombatCommands();
  combatMenuIndex = 0;
  updateCombatMenu();

  const panel = document.getElementById('combat-panel');
  panel.classList.remove('active', 'boss-fight', 'elite-fight');

  document.getElementById('enemy-intent').textContent = '';
  document.getElementById('enemy-intent').className = '';
  document.getElementById('enemy-type-badge').textContent = '';

  sctx.clearRect(0, 0, spriteCanvas.width, spriteCanvas.height);
}

/* 敵HPバー更新（数値付き）*/
function updateEnemyBar() {
  const e = G.currentEnemy;
  if (!e) return;
  const ratio = Math.max(0, e.hp / e.maxHp);
  const bar = document.getElementById('en-bar');
  bar.style.width = (ratio * 100) + '%';

  // 色変化
  bar.classList.remove('low', 'danger');
  if (ratio <= 0.25) bar.classList.add('danger');
  else if (ratio <= 0.5) bar.classList.add('low');

  document.getElementById('enemy-hp-nums').textContent = `${Math.max(0, e.hp)}/${e.maxHp}`;

  // スプライト内バーも更新
  drawEnemySprite(e);
}

/* プレイヤーHP/MPバー（戦闘パネル内）更新 */
function updateBattlePlayerBars() {
  const p = G.player;
  if (!p) return;
  const hpR = Math.max(0, p.hp / p.maxHp);
  const mpR = Math.max(0, p.mp / p.maxMp);
  document.getElementById('b-hp-bar').style.width = (hpR * 100) + '%';
  document.getElementById('b-mp-bar').style.width = (mpR * 100) + '%';
  document.getElementById('b-hp-text').textContent = `${Math.max(0, p.hp)}/${p.maxHp}`;
  document.getElementById('b-mp-text').textContent = `${p.mp}/${p.maxMp}`;
}

function combatAction(type) {
  if (!G.inCombat || !G.currentEnemy) return;
  const p = G.player, e = G.currentEnemy, cls = G.playerClass;

  if (type === 'atk') {
    // 毎ターンSPD判定
    const playerSpd = 5 + (p.lv || 1) + Math.floor(Math.random() * 10);
    const enemySpd = 3 + (e.atk || 1) + Math.floor(Math.random() * 10);
    const playerFirst = playerSpd >= enemySpd;

    if (!playerFirst) {
      // 敵が先行：先に敵が攻撃
      log(`敵の方が速い！（自SPD:${playerSpd} / 敵SPD:${enemySpd}）`, 'warn');
      doEnemyAttack(e);
      if (!G.inCombat || p.hp <= 0) return; // 敵の攻撃でやられた場合
    } else {
      log(`あなたが先手！（自SPD:${playerSpd} / 敵SPD:${enemySpd}）`, 'good');
    }

    // プレイヤーの攻撃処理
    let def = p.passives.pierce ? 0 : e.def;
    let dmg = Math.max(1, p.atk + Math.floor(Math.random() * 3) - def);
    let isCrit = false;
    const critRate = (cls.perk === 'crit' ? 0.3 : 0) + (p.passives.critRate || 0);
    const critMult = p.passives.critMult || 2;

    const effectiveCritMult = p.passives._kiaiReady ? (p.passives._kiaiMult || critMult) : critMult;
    if (p.passives._kiaiReady) { p.passives._kiaiReady = false; p.passives._kiaiMult = 0; }
    if (Math.random() < critRate) { dmg = Math.floor(dmg * effectiveCritMult); isCrit = true; }
    if (p.passives.aoe && Math.random() < 0.5) { dmg += Math.floor(p.atk * 0.5); }

    let dmg2 = 0;
    if (cls.perk === 'doubleAtk') { dmg2 = Math.max(1, p.atk + Math.floor(Math.random() * 3) - def); }
    if (p.passives.defToAtk) {
      dmg += Math.floor(p.def * p.passives.defToAtk);
    }
    const total = dmg + dmg2;
    e.hp -= total;

    if (p.passives.leech) {
      const leech = Math.floor(total * p.passives.leech);
      p.hp = Math.min(p.hp + leech, p.maxHp);
      if (leech > 0) spawnPopup(G.px, G.py - 1, `+${leech}HP`, '#3ecc6f');
    }

    spawnPopup(e.x, e.y, isCrit ? `💥${total}` : `-${total}`, isCrit ? '#f5c842' : '#ff4444');
    if (isCrit) {
      log(`会心一撃！ ${e.name}に${total}ダメージ！！`, 'warn');
      triggerCritFlash(); // ← 追加
    } else {
      log(`${e.name}に${dmg}${dmg2 ? `+${dmg2}` : ''}ダメージ！`, 'combat');
    }

    if (e.hp <= 0) {
      if (G.secondEnemy && G.secondEnemy.hp > 0) {
        G.enemies = G.enemies.filter(en => en !== e);
        G.currentEnemy.locked = false;
        G.currentEnemy = G.secondEnemy;
        G.secondEnemy = null;
        document.getElementById('enemy-name').textContent = G.currentEnemy.name;
        document.getElementById('enemy-type-badge').textContent = '';
        drawEnemySprite(G.currentEnemy);
        log(`${e.name}を倒した！ 次は${G.currentEnemy.name}だ！`, 'good');
        spawnPopup(e.x, e.y, '撃破！', '#f5c842');
        p.exp += e.exp;
        const luckMult = 1 + (p.passives.luck || 0);
        p.gold += Math.floor((e.gold + Math.floor(Math.random() * e.gold)) * luckMult);
        p.kills++;
        levelCheck();
        updateEnemyBar();
        updateUI();
        return;
      }
      defeatEnemy(e); return;
    }

    if (e.hp <= 0) { defeatEnemy(e); return; }
    updateEnemyBar();

    // プレイヤー先行の場合はここで敵が反撃
    if (playerFirst) {
      doEnemyAttack(e);
    }


  } else if (type === 'mag') {
    const cmds = G.player.skillCommands || [];
    if (cmds.length === 0) { log('使えるスキルがない！', 'warn'); return; }
    openSkillSubMenu();
    return;


  } else if (type === 'itm') {
    const hasSmoke = p.items.find(i => i.type === 'smoke');
    if (cls.perk === 'doubleAtk' && hasSmoke) {
      useItem(hasSmoke.name);
      log('煙玉を投げた！ 脱出！', 'sys');
      endCombat(); renderAll(); updateUI(); return;
    }
    const hasHeal = p.items.find(i => i.type === 'heal');
    if (!hasHeal) { log('回復アイテムがない！', 'warn'); return; }
    useItem(hasHeal.name); doEnemyAttack(e);

  } else if (type === 'run') {
    const rate = cls.perk === 'doubleAtk' ? 0.9 : 0.5;
    if (Math.random() < rate) { log('逃げた！', 'sys'); endCombat(); renderAll(); updateUI(); }
    else { log('逃げられない！', 'warn'); doEnemyAttack(e); }
  }

  updateBattlePlayerBars();
  renderAll(); updateUI();
}

function doEnemyAttack(e) {
  const p = G.player;

  if (e.kind === 'boss' && !e.phase2 && e.hp <= e.maxHp * 0.5) {
    e.phase2 = true;
    e.atk = e.phase2Atk;
    if (e.special === 'multi') {
      log(`${e.name}が激怒した！連続攻撃が激化する！`, 'boss');
    } else {
      log(`${e.name}が激怒した！ATKが上昇！`, 'boss');
    }
    spawnPopup(e.x, e.y, '激怒！', '#ff8c00');
  }


  if (e.kind === 'boss') {
    executeBossIntent(e);
    e.nextIntent = pickBossIntent(e.special);
    updateBossIntent();
  } else if (e.kind === 'elite') {
    executeEliteAction(e);
    if (e.pattern) {
      const actions = (e.hp <= e.maxHp * 0.5 && e.pattern.phase2)
        ? [e.pattern.phase2, 'atk']
        : e.pattern.actions;
      e.secondLastIntent = e.lastIntent;
      e.lastIntent = e.nextIntent;
      e.nextIntent = pickEnemyIntent(actions, e.lastIntent, e.secondLastIntent);
    }
  } else {
    executeNormalEnemyAction(e);
    if (e.pattern) {
      const actions = (e.hp <= e.maxHp * 0.5 && e.pattern.phase2)
        ? [e.pattern.phase2, 'atk']
        : e.pattern.actions;
      e.secondLastIntent = e.lastIntent;
      e.lastIntent = e.nextIntent;
      e.nextIntent = pickEnemyIntent(actions, e.lastIntent, e.secondLastIntent);
    }
  }


  // 2体目が生きていれば追加攻撃
  if (G.secondEnemy && G.secondEnemy.hp > 0 && G.inCombat && p.hp > 0) {
    const s = G.secondEnemy;
    log(`${s.name}も攻撃してきた！`, 'combat');
    if (s.kind === 'elite') { executeEliteAction(s); }
    else { normalEnemyHit(s, s.atk); }
  }
}
function normalEnemyHit(e, atkValue) {
  const p = G.player;
  let dmg = Math.max(1, atkValue - p.def);

  // バリアシールド
  if (p._barrierShield > 0) {
    const absorbed = Math.min(p._barrierShield, dmg);
    p._barrierShield -= absorbed;
    dmg -= absorbed;
    if (absorbed > 0) {
      spawnPopup(G.px, G.py, `🔮-${absorbed}`, '#4488ff');
    }
    if (dmg <= 0) {
      log(`魔法障壁が${absorbed}ダメージを防いだ！`, 'good');
      updateBattlePlayerBars();
      updateUI();
      return;
    }
  }

  // トゲ反射
  if (p.passives.thorns && dmg > 0) {
    const thornDmg = Math.floor(dmg * p.passives.thorns);
    if (thornDmg > 0 && e && e.hp > 0) {
      e.hp -= thornDmg;
      spawnPopup(e.x, e.y, `🌵${thornDmg}`, '#3ecc6f');
    }
  }

  p.hp -= dmg;
  spawnPopup(G.px, G.py, `-${dmg}`, '#ff4444');
  log(`${e.name}の攻撃！ ${dmg}ダメージ！`, 'combat');

  updateBattlePlayerBars();
  updateUI();
}

function executeNormalEnemyAction(e) {
  const p = G.player;
  const intent = e.nextIntent || 'atk';

  switch (intent) {
    case 'slam':
      normalEnemyHit(e, Math.floor(e.atk * 1.8));
      log(`${e.name}の強撃！`, 'combat');
      break;
    case 'burn':
      normalEnemyHit(e, e.atk);
      e.burnTurns = (e.burnTurns || 0) + 2;
      spawnPopup(e.x, e.y, '🔥燃焼！', '#ff6622');
      log(`${e.name}が炎をまとった！燃焼2ターン付与！`, 'combat');
      break;
    case 'poison':
      normalEnemyHit(e, Math.floor(e.atk * 0.5));
      e._poisonStacks = Math.min((e._poisonStacks || 0) + 1, 3);
      e._poisonPerTurn = e._poisonStacks * 4;
      e._poisonTurns = 999;
      spawnPopup(G.px, G.py, `🐍毒！`, '#3ecc6f');
      log(`${e.name}が毒を付与した！`, 'combat');
      break;
    case 'buff':
      if (!e.buffed) { e.atk = Math.floor(e.atk * 1.3); e.buffed = true; }
      spawnPopup(e.x, e.y, '💪強化！', '#ff8c00');
      log(`${e.name}が自己強化した！`, 'combat');
      break;
    case 'defend':
      e._defendTurns = 1;
      e._defendDef = e.def;
      e.def = Math.floor(e.def * 2);
      spawnPopup(e.x, e.y, '🛡防御！', '#4488ff');
      log(`${e.name}が防御態勢をとった！DEF2倍！`, 'combat');
      break;
    case 'heal':
      const heal = Math.min(Math.floor(e.maxHp * 0.15), e.maxHp - e.hp);
      e.hp += heal;
      spawnPopup(e.x, e.y, `+${heal}HP`, '#3ecc6f');
      log(`${e.name}が回復した！HP+${heal}！`, 'combat');
      updateEnemyBar();
      break;
    case 'regen':
      e._regenTurns = 3;
      e._regenVal = Math.floor(e.maxHp * 0.05);
      spawnPopup(e.x, e.y, '🌿再生！', '#3ecc6f');
      log(`${e.name}が再生を始めた！3ターンHP回復！`, 'combat');
      break;
    default:
      normalEnemyHit(e, e.atk);
      break;
  }

  // defend解除
  if ((e._defendTurns || 0) > 0) {
    e._defendTurns--;
    if (e._defendTurns === 0 && e._defendDef !== undefined) {
      e.def = e._defendDef;
      e._defendDef = undefined;
      log(`${e.name}の防御態勢が解けた`, 'entry');
    }
  }
  // regen処理
  if ((e._regenTurns || 0) > 0) {
    const rv = e._regenVal || 0;
    e.hp = Math.min(e.hp + rv, e.maxHp);
    e._regenTurns--;
    spawnPopup(e.x, e.y, `🌿+${rv}`, '#3ecc6f');
    updateEnemyBar();
  }
}


function executeEliteAction(e) {
  const p = G.player;
  const roll = Math.random();

  // ハードモード専用エリートの特殊行動
  if (e.special === 'skillweaken') {
    // 氷刃の狩人：30%でスキル威力半減デバフ
    if (roll < 0.3 && !p.passives._skillWeakened) {
      p.passives._skillWeakened = true;
      p.passives._skillWeakenTurns = 2;
      spawnPopup(G.px, G.py, '❄スキル弱体！', '#88ccff');
      log(`氷刃の狩人がスキルを封じた！2ターン間スキル威力半減！`, 'elite');
    }
    normalEnemyHit(e, e.atk);
    return;
  }

  if (e.special === 'multilow') {
    // 雷光の剣士：25%で2回攻撃（1発ダメージ低め）
    if (roll < 0.25) {
      const dmg1 = Math.max(1, Math.floor(e.atk * 0.6) - p.def);
      const dmg2 = Math.max(1, Math.floor(e.atk * 0.6) - p.def);
      normalEnemyHit(e, Math.floor(e.atk * 0.6));
      if (p.hp > 0) {
        normalEnemyHit(e, Math.floor(e.atk * 0.6));
        spawnPopup(e.x, e.y, '⚡2連撃！', '#ffff44');
        log(`雷光の剣士の2連撃！`, 'elite');
      }
    } else {
      normalEnemyHit(e, e.atk);
    }
    return;
  }

  if (e.special === 'healdef') {
    // 闇の司祭：20%で自己回復、25%でプレイヤーのDEF低下
    if (roll < 0.2) {
      const heal = Math.min(8, e.maxHp - e.hp);
      e.hp += heal;
      spawnPopup(e.x, e.y, `+${heal}HP`, '#8844aa');
      log(`闇の司祭が回復した！HP+${heal}！`, 'elite');
      updateEnemyBar();
    } else if (roll < 0.45) {
      p.passives._defDown = (p.passives._defDown || 0) + 2;
      p.passives._defDownTurns = 2;
      p.def = Math.max(0, p.def - 2);
      spawnPopup(G.px, G.py, '🌑DEF-2！', '#8844aa');
      log(`闇の司祭がDEFを下げた！2ターン間DEF-2！`, 'elite');
      normalEnemyHit(e, e.atk);
    } else {
      normalEnemyHit(e, e.atk);
    }
    return;
  }

  if (e.special === 'burnplus') {
    // 無属の釈迦：溶岩巨人の上位互換、燃焼ダメージ強化版
    if (roll < 0.3) {
      e.burnTurns = 3;
      normalEnemyHit(e, e.atk);
      log(`無属の釈迦が強烈な炎をまとった！次のターンから燃焼！`, 'elite');
    } else {
      normalEnemyHit(e, e.atk);
    }
    if (e.burnTurns > 0) {
      const burnDmg = 5;
      p.hp -= burnDmg;
      e.burnTurns--;
      spawnPopup(G.px, G.py, `🔥-${burnDmg}`, '#ff6622');
      log(`強烈な燃焼ダメージ${burnDmg}！`, 'elite');
      if (p.hp <= 0) gameOver();
    }
    return;
  }

  // 既存エリートの行動（変更なし）
  if (e.special === 'drain' && roll < 0.3 && p.mp > 0) {
    const drain = Math.min(3, p.mp);
    p.mp -= drain; e.hp = Math.min(e.hp + drain * 2, e.maxHp);
    spawnPopup(G.px, G.py, `-${drain}MP`, '#b06aff');
    log(`${e.name}がMPを${drain}吸収した！`, 'elite');
  } else if (e.special === 'burn' && roll < 0.3) {
    e.burnTurns = 3; normalEnemyHit(e, e.atk);
    log(`${e.name}が炎をまとった！次のターンから燃焼！`, 'elite');
  } else if (e.special === 'crit' && roll < 0.25) {
    const critMult = 2.0 + Math.random() * 0.3;
    const dmg = Math.floor(e.atk * critMult);
    normalEnemyHit(e, dmg);
    spawnPopup(e.x, e.y - 1, 'CRIT!', '#ff8c00');
    log(`${e.name}の会心攻撃！${dmg}ダメージ！（×${critMult.toFixed(2)}）`, 'elite');
  } else if (e.special === 'buff' && roll < 0.25 && !e.buffed) {
    e.atk = Math.floor(e.atk * 1.4); e.buffed = true;
    spawnPopup(e.x, e.y, '強化！', '#b06aff');
    log(`${e.name}が自己強化した！`, 'elite');
  } else {
    normalEnemyHit(e, e.atk);
  }
  if (e.burnTurns > 0) {
    const burnDmg = 3; p.hp -= burnDmg; e.burnTurns--;
    spawnPopup(G.px, G.py, `🔥-${burnDmg}`, '#ff6622');
    log(`燃焼ダメージ${burnDmg}！`, 'elite');
    if (p.hp <= 0) gameOver();
  }
  updateBattlePlayerBars();
}

function executeBossIntent(e) {
  const p = G.player;
  const intent = e.nextIntent;

  // 混沌王は1ターン目休み
  if (e.special === 'chaos' && e.firstTurn) {
    e.firstTurn = false;
    spawnPopup(e.x, e.y, '…', '#ff22ff');
    log(`${e.name}は力を溜めている…`, 'boss');
    updateEnemyBar(); updateBattlePlayerBars(); updateUI();
    return;
  }
  e.firstTurn = false;

  // 深淵神アビサル：1ターン目25%固定ダメージ
  if (e.special === 'abyss' && !e._abyssFirstDone) {
    e._abyssFirstDone = true;
    const fixedDmg = Math.floor(p.maxHp * 0.25);
    p.hp -= fixedDmg;
    spawnPopup(G.px, G.py, `💀-${fixedDmg}`, '#4422aa');
    log(`${e.name}の呪縛！最大HPの25%ダメージ！`, 'boss');
    if (p.hp <= 0) { gameOver(); return; }
    updateBattlePlayerBars(); updateUI();
    return;
  }

  // DEF無視ターン中
  if ((e.defIgnoreTurns || 0) > 0) {
    e.defIgnoreTurns--;
    const dmg = Math.max(1, e.atk);
    p.hp -= dmg;
    spawnPopup(G.px, G.py, `💀DEF無視-${dmg}`, '#4422aa');
    log(`${e.name}のDEF無視攻撃！${dmg}ダメージ！（残り${e.defIgnoreTurns}ターン）`, 'boss');
    if (p.hp <= 0) { gameOver(); return; }
    updateBattlePlayerBars(); updateUI();
    return;
  }

  if (intent === 'slam') {
    normalEnemyHit(e, Math.floor(e.atk * 1.8));
    log(`${e.name}の強烈な一撃！`, 'boss');
  } else if (intent === 'burn') {
    normalEnemyHit(e, e.atk);
    p.hp -= 5; spawnPopup(G.px, G.py, '🔥-5', '#ff6622');
    log(`${e.name}の炎が燃え続ける！追加5ダメージ！`, 'boss');
    if (p.hp <= 0) { gameOver(); return; }
  } else if (intent === 'multi') {
    // 雷皇ザンヴォルト：HP50%以下で連続攻撃増加
    const hits = (!e.phase2) ? 2 : 3 + Math.floor(Math.random() * 2);
    let total = 0;
    for (let i = 0; i < hits; i++) {
      if (p.hp <= 0) break;
      const dmg = Math.max(1, Math.floor(e.atk * 0.6) - p.def);
      p.hp -= dmg;
      total += dmg;
    }
    spawnPopup(G.px, G.py, `-${total}`, '#ffff44');
    spawnPopup(e.x, e.y, `⚡${hits}連撃！`, '#ffff44');
    log(`${e.name}の${hits}連撃！合計${total}ダメージ！`, 'boss');
    if (p.hp <= 0) { gameOver(); return; }
  } else if (intent === 'abyss_def') {
    // 深淵神アビサル：DEF無視デバフ（1ターン消費）
    e.defIgnoreTurns = 2;
    spawnPopup(e.x, e.y, '💀DEF無視準備！', '#4422aa');
    log(`${e.name}がDEF無視の構えをとった！次の2ターンDEFを無視して攻撃！`, 'boss');
  } else if (intent === 'drain') {
    const drain = Math.min(5, p.mp); p.mp -= drain;
    e.hp = Math.min(e.hp + drain * 3, e.maxHp);
    spawnPopup(G.px, G.py, `-${drain}MP`, '#b06aff');
    spawnPopup(e.x, e.y, `+${drain * 3}HP`, '#3ecc6f');
    log(`${e.name}がMP${drain}を吸収し体力を回復！`, 'boss');
    normalEnemyHit(e, e.atk);
  } else if (intent === 'buff') {
    if (!e.buffed) { e.atk = Math.floor(e.atk * 1.3); e.buffed = true; }
    spawnPopup(e.x, e.y, '強化！', '#ff8c00');
    log(`${e.name}が力を蓄えた！ATK上昇！`, 'boss');
  } else {
    normalEnemyHit(e, e.atk);
  }

  // 混沌王は通常攻撃も追加
  if (e.special === 'chaos' && intent !== 'atk') {
    normalEnemyHit(e, e.atk);
  }

  updateEnemyBar(); updateBattlePlayerBars(); updateUI();
}

function defeatEnemy(e) {
  const p = G.player;
  const isBoss = e.kind === 'boss';
  const isElite = e.kind === 'elite';
  const luckMult = 1 + (p.passives.luck || 0);
  const goldGain = Math.floor((e.gold + Math.floor(Math.random() * e.gold)) * luckMult);

  const expBoost = p.passives.expBoost || 1;
  p.exp += Math.floor(e.exp * expBoost); p.gold += goldGain; p.kills++;

  const tag = isBoss ? 'boss' : isElite ? 'elite' : 'good';
  log(`${e.name}を倒した！ EXP+${e.exp} G+${goldGain}`, tag);
  spawnPopup(e.x, e.y, isBoss ? '✦BOSS！' : '撃破！', isBoss ? '#ff8c00' : '#f5c842');
  spawnDefeatParticles(e.x, e.y, isBoss ? '#ff8c00' : '#f5c842');

  if (G.playerClass.perk === 'regen') {
    p.hp = Math.min(p.hp + 3, p.maxHp);
    log('聖なる加護でHP+3回復！', 'good');
  }

  const dropRate = isBoss ? 1 : isElite ? 0.6 : 0.25 * luckMult;
  if (Math.random() < dropRate) {
    const bigItem = isElite || isBoss;
    addItem({ name: bigItem ? '上位回復薬' : '回復薬', type: 'heal', val: bigItem ? 30 : 12 });
  }

  G.enemies = G.enemies.filter(en => en !== e);
  endCombat();
  levelCheck();
  renderAll();
  updateUI();
}

function getSkillChoices(p) {
  const classId = Object.keys(CLASSES).find(k => CLASSES[k] === G.playerClass) || 'warrior';
  const owned = new Set(p.skills.filter(s => {
    if (s.stackable) {
      const count = p.skills.filter(sk => sk.id === s.id).length;
      return s.maxStack && count >= s.maxStack;
    }
    return true;
  }).map(s => s.id));

  const warriorLvSkills = [
    {
      id: 'w_lv_hp_up', name: '戦士の肉体', icon: '💪', type: 'boost',
      desc: '最大HP+15、現在HPも+15',
      apply: p => { p.maxHp += 15; p.hp = Math.min(p.hp + 15, p.maxHp); }
    },
    {
      id: 'w_lv_atk_up', name: '剛腕', icon: '⚔', type: 'boost',
      desc: 'ATK+5',
      apply: p => { p.atk += 5; }
    },
    {
      id: 'w_lv_def_up', name: '鉄壁の守り', icon: '🛡', type: 'boost',
      desc: 'DEF+4',
      apply: p => { p.def += 4; }
    },
    {
      id: 'w_lv_crit', name: '会心の極意', icon: '⚡', type: 'passive',
      desc: '会心率+15%、会心ダメージ×0.5倍追加',
      apply: p => {
        p.passives.critRate = (p.passives.critRate || 0) + 0.15;
        p.passives.critMult = (p.passives.critMult || 2) + 0.5;
      }
    },
    {
      id: 'w_lv_leech', name: '血の渇望', icon: '🩸', type: 'passive',
      desc: '通常攻撃ダメージの30%をHP回復',
      apply: p => { p.passives.leech = (p.passives.leech || 0) + 0.3; }
    },
    {
      id: 'w_lv_thorns', name: '返し刃', icon: '🌵', type: 'passive',
      desc: '受けたダメージの25%を敵に反射',
      apply: p => { p.passives.thorns = (p.passives.thorns || 0) + 0.25; }
    },
    {
      id: 'w_lv_regen', name: '戦士の回復力', icon: '🌿', type: 'passive',
      desc: '移動ごとにHP+2回復(50歩まで)',
      apply: p => { p.passives.regen = (p.passives.regen || 0) + 2; }
    },
    {
      id: 'w_lv_pierce', name: '貫通撃', icon: '🏹', type: 'active',
      desc: '通常攻撃が敵のDEFを無視する',
      apply: p => { p.passives.pierce = true; }
    },
    {
      id: 'w_lv_undying', name: '不屈', icon: '💀', type: 'passive',
      desc: 'HP0になるとき20%の確率でHP1で耐える',
      apply: p => { p.passives.undying = (p.passives.undying || 0) + 0.2; }
    },
    {
      id: 'w_lv_heavy', name: '重厚', icon: '🗿', type: 'passive',
      desc: '通常攻撃にDEF×0.3の追加ダメージ',
      apply: p => { p.passives.defToAtk = (p.passives.defToAtk || 0) + 0.3; }
    },
    {
      id: 'w_lv_castle', name: '城壁', icon: '🏰', type: 'boost',
      desc: 'DEF+6',
      apply: p => { p.def += 6; }
    },
    {
      id: 'w_lv_pressure', name: '重圧', icon: '⚖', type: 'passive',
      desc: 'DEF参照ダメージを×1.5倍',
      apply: p => { p.passives.defDmgBoost = (p.passives.defDmgBoost || 1) * 1.5; }
    },
    {
      id: 'w_lv_steel_fist', name: '鋼の拳', icon: '🦾', type: 'passive',
      desc: '通常攻撃のDEF加算率+0.2',
      apply: p => { p.passives.defToAtk = (p.passives.defToAtk || 0) + 0.2; }
    },
    {
      id: 'w_lv_fortify', name: '堅陣', icon: '⛩', type: 'passive',
      desc: '被弾するたびにDEF÷4のHP回復',
      apply: p => { p.passives.fortify = true; }
    },
    {
      id: 'dark_heart', name: '魔剣士の心', icon: '🖤', type: 'special',
      desc: '⚠ 戦士の固有スキルをすべて失い、魔剣士に覚醒する。闇の力が目覚める。',
      apply: p => { /* 警告モーダルで処理 */ }
    },
  ];

  let pool = [];
  let classSpecificIds = new Set();

  if (classId === 'rogue') {
    classSpecificIds = new Set(ROGUE_LEVELUP_SKILLS.map(s => s.id));
    pool = ROGUE_LEVELUP_SKILLS.filter(s => !owned.has(s.id));
    if (pool.length < 3) {
      const generic = ALL_SKILLS.filter(s => !owned.has(s.id) && !s.onlyClass);
      pool = [...pool, ...generic];
    }
  } else if (classId === 'warrior') {
    if (G.isDarkWarrior) {
      const darkWarriorSpecific = DARK_WARRIOR_LEVELUP_SKILLS.filter(s => !owned.has(s.id));
      const generic = ALL_SKILLS.filter(s => !owned.has(s.id) && !s.onlyClass);
      classSpecificIds = new Set(darkWarriorSpecific.map(s => s.id));
      pool = [...darkWarriorSpecific, ...generic];
    }
    else {
      const normalWarrior = warriorLvSkills.filter(s => s.id !== 'dark_heart' && !owned.has(s.id));
      const generic = ALL_SKILLS.filter(s => !owned.has(s.id) && !s.onlyClass);
      classSpecificIds = new Set(normalWarrior.map(s => s.id));
      pool = [...normalWarrior, ...generic];
    }
  } else if (classId === 'cleric') {
    classSpecificIds = new Set(CLERIC_LEVELUP_SKILLS.map(s => s.id));
    pool = CLERIC_LEVELUP_SKILLS.filter(s => !owned.has(s.id));
    if (pool.length < 3) {
      const generic = ALL_SKILLS.filter(s => !owned.has(s.id) && !s.onlyClass);
      pool = [...pool, ...generic];
    }
  } else {
    pool = ALL_SKILLS.filter(s => {
      if (owned.has(s.id)) return false;
      if (s.onlyClass && s.onlyClass !== classId) return false;
      return true;
    });
  }

  const weighted = [];
  const specificPool = pool.filter(s => classSpecificIds.has(s.id));
  const genericPool = pool.filter(s => !classSpecificIds.has(s.id));
  for (const s of specificPool) weighted.push(s, s, s, s, s);
  for (const s of genericPool) weighted.push(s);

  const result = [];
  const used = new Set();

  if (specificPool.length > 0) {
    const pick = specificPool[Math.floor(Math.random() * specificPool.length)];
    used.add(pick.id);
    result.push(pick);
  }

  const shuffledWeighted = weighted.sort(() => Math.random() - 0.5);
  for (const s of shuffledWeighted) {
    if (!used.has(s.id)) {
      used.add(s.id);
      result.push(s);
    }
    if (result.length >= 3) break;
  }
  // 魔剣士の心を差し込む（デバッグ中1.0、確認後0.25に戻す）
  if (classId === 'warrior' && !G.isDarkWarrior && !p.classSkills?.includes('dark_heart_taken') && Math.random() < 0.25) {
    const darkHeart = warriorLvSkills.find(s => s.id === 'dark_heart');
    if (darkHeart) {
      if (result.length >= 3) result[2] = darkHeart;
      else result.push(darkHeart);
    }
  }

  return result.filter(s => s && s.id);
}

// ══════════════════════════════════════════════════════════
//  LEVELING & SKILL MODAL
// ══════════════════════════════════════════════════════════
function levelCheck() {
  const p = G.player;
  if (p.exp < p.expNext) return;
  p.exp -= p.expNext; p.lv++;
  p.expNext = Math.ceil(p.expNext * 1.5);
  p.maxHp += 4; p.hp = Math.min(p.hp + 4, p.maxHp);
  p.maxMp += 2; p.mp = Math.min(p.mp + 2, p.maxMp);
  p.atk += 1;
  log(`レベルアップ！ LV${p.lv}になった！`, 'warn');
  awardSP(2);



  // 全職業モーダル表示
  const choices = getSkillChoices(p);
  G.pendingSkillChoices = choices;
  showSkillModal(choices);
}

function showSkillModal(choices) {
  const modal = document.getElementById('skill-modal');
  const cards = document.getElementById('skill-cards');
  document.getElementById('skill-modal-title').textContent = `⬆ LV${G.player.lv} LEVEL UP!`;
  cards.innerHTML = choices.map((s, i) => `
    <div class="skill-choice-card" onclick="pickSkill(${i})">
      <span class="skill-choice-icon">${s.icon}</span>
      <span class="skill-choice-name">${s.name}</span>
      <div class="skill-choice-desc">${s.desc}</div>
      <span class="skill-choice-type type-${s.type}">${s.type === 'passive' ? 'パッシブ' : s.type === 'active' ? 'アクティブ' : '強化'
    }</span>
    </div>`).join('');
  modal.classList.add('active');
}

function pickSkill(idx) {
  const skill = G.pendingSkillChoices[idx];

  if (skill.id === 'dark_heart') {
    showDarkHeartWarning();
    return;
  }

  skill.apply(G.player);
  G.player.skills.push(skill);
  G.pendingSkillChoices = null;
  document.getElementById('skill-modal').classList.remove('active');
  log(`スキル「${skill.name}」を習得！`, 'warn');
  renderSkillList(); updateUI();
}


function showDarkHeartWarning() {
  document.getElementById('skill-modal-title').textContent = '🖤 魔剣士の覚醒';
  document.getElementById('skill-modal-sub').textContent = '';
  document.getElementById('skill-cards').innerHTML = `
    <div style="color:#666680;font-size:9px;text-align:center;margin:16px 0;letter-spacing:2px">— WARNING —</div>
    <div style="color:#e8e8f0;font-size:9px;line-height:2.4;text-align:center;margin-bottom:24px;border:2px solid #cc44ff;padding:16px;background:#0a0014">
      ⚠ これまでに習得した<br>
      <span style="color:#cc44ff">戦士の固有スキルはすべて失われる。</span><br><br>
      闇の力と引き換えに、<br>
      <span style="color:#8844ff">新たな魔剣士の力が目覚める。</span><br><br>
      <span style="color:#e84040">この選択は取り消せない。</span>
    </div>
    <div style="display:flex;gap:12px;justify-content:center">
      <button onclick="acceptDarkHeart()" style="padding:12px 20px;background:#0a0014;border:2px solid #cc44ff;color:#cc44ff;font-family:'Press Start 2P',monospace;font-size:9px;cursor:pointer;letter-spacing:1px">🖤 闇を受け入れる</button>
      <button onclick="rejectDarkHeart()" style="padding:12px 20px;background:#0a0a0a;border:2px solid #444;color:#666;font-family:'Press Start 2P',monospace;font-size:9px;cursor:pointer">やめておく</button>
    </div>
  `;
}
function acceptDarkHeart() {
  const p = G.player;

  // 戦士固有スキルを削除
  const warriorTreeIds = new Set(CLASS_SKILL_TREES.warrior.map(s => s.id));
  p.skillCommands = (p.skillCommands || []).filter(id => {
    const sc = SKILL_COMMANDS[id];
    return sc && !sc.availableFor?.includes('warrior') ||
      ['iron_wall', 'shield_bash', 'kiai_tame', 'multi_slash', 'blood_awakening',
        'armor_break', 'vampiric_slash', 'rage_burst', 'ultimate_slash'].indexOf(id) === -1;
  });
  p.classSkills = (p.classSkills || []).filter(id => !warriorTreeIds.has(id));
  p.skills = (p.skills || []).filter(s => !warriorTreeIds.has(s.id));

  // 魔剣士フラグを立てる
  p.classSkills.push('dark_heart_taken');
  p.passives.darkHeart = true;

  // スキルツリーを魔剣士に切り替え
  G.pendingSkillChoices = null;
  document.getElementById('skill-modal').classList.remove('active');
  G.isDarkWarrior = true;

  log('🖤 魔剣士に覚醒した…！戦士の力を捨て、闇の力を手に入れた！', 'warn');
  renderSkillList(); updateUI();
}

function rejectDarkHeart() {
  // モーダルを元の選択肢に戻す
  showSkillModal(G.pendingSkillChoices);
}

function renderSkillList() {
  const el = document.getElementById('skill-list');
  if (!G.player || !G.player.skills.length) {
    el.innerHTML = '<span style="color:#444;font-size:7px">まだなし</span>'; return;
  }
  el.innerHTML = G.player.skills.map(s =>
    `<div class="skill-tag">${s.icon} ${s.name}</div>`
  ).join('');
}

// ══════════════════════════════════════════════════════════
//  CHEST / ITEMS
// ══════════════════════════════════════════════════════════
const WEAPONS = ['木の剣+1', '鉄の剣+2', '魔法剣+3', '聖剣+5', 'デーモン刃+7'];
const ARMORS = ['革鎧+1', '鎖帷子+2', '板金鎧+3', '魔法鎧+4', '神聖鎧+6'];
const ACCS = ['守りの指輪', '力の腕輪', '魔力の冠', '加速の靴', '竜の鱗'];

function openChest(x, y) {
  const roll = Math.random();
  const p = G.player;
  if (roll < 0.3) {
    const wpnData = WEAPONS[Math.min(Math.floor(G.floor / 2), WEAPONS.length - 1)];
    const bonus = parseInt(wpnData.match(/\+(\d)/)?.[1] || 0);
    const oldBonus = p.equip.wpnBonus || 0;
    p.equip.wpn = wpnData;
    p.equip.wpnBonus = bonus;
    p.atk = p.atk - oldBonus + bonus;
    updateEquipDisplay();
    log(`宝箱！ ${wpnData} を入手！`, 'loot');
  } else if (roll < 0.55) {
    const armData = ARMORS[Math.min(Math.floor(G.floor / 2), ARMORS.length - 1)];
    const bonus = parseInt(armData.match(/\+(\d)/)?.[1] || 0);
    const oldBonus = p.equip.armBonus || 0;
    p.equip.arm = armData;
    p.equip.armBonus = bonus;
    p.def = p.def - oldBonus + bonus;
    updateEquipDisplay();
    log(`宝箱！ ${armData} を入手！`, 'loot');
  } else if (roll < 0.7) {
    const acc = ACCS[Math.floor(Math.random() * ACCS.length)];
    p.equip.acc = acc;
    updateEquipDisplay();
    log(`宝箱！ ${acc} を入手！`, 'loot');
  } else {
    const gold = 5 + Math.floor(Math.random() * G.floor * 5);
    p.gold += gold;
    log(`宝箱！ ${gold}G を入手！`, 'loot');
  }
  if (Math.random() < 0.4) addItem({ name: '回復薬', type: 'heal', val: 10 + G.floor * 2 });
  updateUI();
}

function addItem(item) {
  const ex = G.player.items.find(i => i.name === item.name);
  if (ex) ex.qty = (ex.qty || 1) + 1;
  else G.player.items.push({ ...item, qty: 1 });
  updateItemList();
}

function pickItem(idx) {
  const item = G.items[idx];
  G.items.splice(idx, 1);
  addItem(item);
  log(`${item.name} を拾った！`, 'loot');
}

function useItem(name) {
  const idx = G.player.items.findIndex(i => i.name === name);
  if (idx < 0) return false;
  const item = G.player.items[idx];
  const p = G.player;
  if (item.type === 'heal') {
    const boost = p.passives.itemBoost || 1;
    const heal = Math.min(Math.floor(item.val * boost), p.maxHp - p.hp);
    p.hp += heal;
    spawnPopup(G.px, G.py, `+${heal}HP`, '#3ecc6f');
    log(`${item.name} を使った！ HP+${heal}`, 'good');
  } else if (item.type === 'mpheal') {
    const boost = p.passives.itemBoost || 1;
    const mpHeal = Math.min(Math.floor(item.val * boost), p.maxMp - p.mp);
    p.mp += mpHeal;
    spawnPopup(G.px, G.py, `+${mpHeal}MP`, '#4488ff');
    log(`${item.name} を使った！ MP+${mpHeal}`, 'good');
  }
  item.qty--;
  if (item.qty <= 0) G.player.items.splice(idx, 1);
  updateItemList(); updateBattlePlayerBars(); updateUI();
  return true;
}

function updateItemList() {
  const el = document.getElementById('item-list');
  if (!G.player || !G.player.items.length) { el.innerHTML = '<span style="color:#444">アイテムなし</span>'; return; }
  el.innerHTML = G.player.items.map(i =>
    `<div class="item-row" onclick="useItem('${i.name}')"><span>${i.name}</span><span class="qty">x${i.qty}</span></div>`
  ).join('');
}

// ══════════════════════════════════════════════════════════
//  EQUIPMENT DISPLAY
// ══════════════════════════════════════════════════════════
function updateEquipDisplay() {
  if (!G.player) return;
  const p = G.player;
  const wpnEl = document.getElementById('eq-wpn');
  const wpnBonus = document.getElementById('eq-wpn-bonus');
  const armEl = document.getElementById('eq-arm');
  const armBonus = document.getElementById('eq-arm-bonus');
  const accEl = document.getElementById('eq-acc');

  if (p.equip.wpn) {
    wpnEl.textContent = p.equip.wpn; wpnEl.classList.remove('empty');
    wpnBonus.textContent = `ATK ${p.atk}`;
  } else {
    wpnEl.textContent = 'なし'; wpnEl.classList.add('empty');
    wpnBonus.textContent = '';
  }
  if (p.equip.arm) {
    armEl.textContent = p.equip.arm; armEl.classList.remove('empty');
    armBonus.textContent = `DEF ${p.def}`;
  } else {
    armEl.textContent = 'なし'; armEl.classList.add('empty');
    armBonus.textContent = '';
  }
  if (p.equip.acc) {
    accEl.textContent = p.equip.acc; accEl.classList.remove('empty');
  } else {
    accEl.textContent = 'なし'; accEl.classList.add('empty');
  }
}

// ══════════════════════════════════════════════════════════
//  UI
// ══════════════════════════════════════════════════════════
function updateUI() {
  if (!G.player) return;
  const p = G.player;
  document.getElementById('hp-bar').style.width = (Math.max(0, p.hp) / p.maxHp * 100) + '%';
  document.getElementById('hp-text').textContent = `${Math.max(0, p.hp)}/${p.maxHp}`;
  document.getElementById('mp-bar').style.width = (p.mp / p.maxMp * 100) + '%';
  document.getElementById('mp-text').textContent = `${p.mp}/${p.maxMp}`;
  document.getElementById('s-atk').textContent = p.atk;
  document.getElementById('s-def').textContent = p.def;
  document.getElementById('s-lv').textContent = p.lv;
  document.getElementById('s-exp').textContent = p.exp;
  document.getElementById('s-gold').textContent = p.gold;
  document.getElementById('s-kill').textContent = p.kills;
  updateEquipDisplay();
  updateItemList();
  updateEnemyBar();
  if (G.inCombat) updateBattlePlayerBars();
}

function log(msg, cls = 'entry') {
  const box = document.getElementById('log-box');
  const el = document.createElement('div');
  el.className = `entry ${cls}`; el.textContent = '> ' + msg;
  box.appendChild(el); box.scrollTop = box.scrollHeight;
  while (box.children.length > 50) box.removeChild(box.firstChild);
}

// ══════════════════════════════════════════════════════════
//  GAME OVER / RETRY
// ══════════════════════════════════════════════════════════
function gameOver() {
  G.inCombat = false; G.player.hp = 0; updateUI();
  document.getElementById('overlay-title').textContent = '☠ GAME OVER';
  document.getElementById('overlay-title').style.color = '#e84040';
  document.getElementById('overlay-sub').innerHTML =
    `到達フロア: ${G.floor}F<br>レベル: ${G.player.lv}<br>撃破数: ${G.player.kills}<br>所持金: ${G.player.gold}G`;
  document.getElementById('overlay').classList.add('active');
}

function retryGame() {
  // ゲーム状態を完全リセット
  G = {};
  selectedClass = null;
  combatMenuIndex = 0;

  // サブメニュー系フラグリセット
  if (typeof itemSubMenuActive !== 'undefined') itemSubMenuActive = false;
  if (typeof skillSubMenuActive !== 'undefined') skillSubMenuActive = false;

  // 戦闘パネルを閉じる
  const panel = document.getElementById('combat-panel');
  panel.classList.remove('active', 'boss-fight', 'elite-fight');

  // アイテムサブメニューを閉じる
  document.getElementById('item-submenu').classList.remove('active');

  // スプライトcanvasをクリア
  if (typeof sctx !== 'undefined') {
    sctx.clearRect(0, 0, spriteCanvas.width, spriteCanvas.height);
  }

  // 各オーバーレイを閉じる
  document.getElementById('overlay').classList.remove('active');
  document.getElementById('win-overlay').classList.remove('active');
  document.getElementById('skill-modal').classList.remove('active');
  document.getElementById('shop-modal').classList.remove('active');
  document.getElementById('classkill-modal').classList.remove('active');

  // フロア表示リセット
  document.getElementById('floor-num').textContent = '1';
  document.getElementById('class-badge').textContent = '';

  // SPバッジリセット
  const spVal = document.getElementById('sp-val');
  if (spVal) spVal.textContent = '0';
  const spBadge = document.getElementById('sp-badge');
  if (spBadge) spBadge.classList.remove('has-sp');

  // EXPバーリセット
  const expFill = document.getElementById('exp-bar-fill');
  if (expFill) expFill.style.width = '0%';
  const expText = document.getElementById('exp-bar-text');
  if (expText) expText.textContent = '0/10';

  // ログをクリア
  const logBox = document.getElementById('log-box');
  if (logBox) logBox.innerHTML = '';

  // クラス選択に戻す
  document.querySelectorAll('.cs-card').forEach(c => c.classList.remove('selected'));
  document.getElementById('cs-start').disabled = true;
  document.getElementById('class-select').classList.add('active');
}


// ══════════════════════════════════════════════════════════
//  CLASS SELECT
// ══════════════════════════════════════════════════════════
function selectClass(id) {
  selectedClass = id;
  document.querySelectorAll('.cs-card').forEach(c => c.classList.remove('selected'));
  document.getElementById('card-' + id).classList.add('selected');
  document.getElementById('cs-start').disabled = false;
}

function showModeSelect() {
  if (!selectedClass) return;
  // ハードモード解放チェック
  const cleared = JSON.parse(localStorage.getItem('dungeon_clears') || '[]');
  const hardUnlocked = cleared.some(c => c.mode === 'normal');
  const hardBtn = document.getElementById('btn-hard');
  if (hardUnlocked) {
    hardBtn.classList.remove('locked');
  } else {
    hardBtn.classList.add('locked');
  }
  document.getElementById('cs-mode-select').style.display = 'block';
  document.getElementById('cs-start').style.display = 'none';
}

function beginGame(mode) {
  if (!selectedClass) return;
  if (mode === 'hard') {
    const cleared = JSON.parse(localStorage.getItem('dungeon_clears') || '[]');
    const hardUnlocked = cleared.some(c => c.mode === 'normal');
    if (!hardUnlocked) return;
  }
  G = { mode: mode };
  document.getElementById('class-select').classList.remove('active');
  startGame(selectedClass);
}


// ══════════════════════════════════════════════════════════
//  INPUT
// ══════════════════════════════════════════════════════════
document.addEventListener('keydown', e => {
  if (!G.map || G.pendingSkillChoices || G.inShop) return;

  if (G.inCombat) {
    // ─── 戦闘中：↑↓←→ すべてでコマンド選択 ───
    // コマンドは2×2グリッド:
    //   [0: たたかう] [1: まほう  ]
    //   [2: アイテム] [3: にげる  ]
    // ↑↓で行移動、←→で列移動

    const row = Math.floor(combatMenuIndex / COMBAT_COLS);
    const col = combatMenuIndex % COMBAT_COLS;

    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
      e.preventDefault();
      const newRow = (row - 1 + 2) % 2;
      combatMenuIndex = newRow * COMBAT_COLS + col;
      updateCombatMenu();
    } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
      e.preventDefault();
      const newRow = (row + 1) % 2;
      combatMenuIndex = newRow * COMBAT_COLS + col;
      updateCombatMenu();
    } else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
      e.preventDefault();
      const newCol = (col - 1 + COMBAT_COLS) % COMBAT_COLS;
      combatMenuIndex = row * COMBAT_COLS + newCol;
      updateCombatMenu();
    } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
      e.preventDefault();
      const newCol = (col + 1) % COMBAT_COLS;
      combatMenuIndex = row * COMBAT_COLS + newCol;
      updateCombatMenu();
    } else if (e.key === 'Enter' || e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      executeSelectedCommand();
    }
    return;
  }

  // ─── 移動（戦闘外） ───
  const dirMap = {
    ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
    w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
    W: [0, -1], S: [0, 1], A: [-1, 0], D: [1, 0],
  };
  const mv = dirMap[e.key];
  if (!mv) return;
  e.preventDefault();
  tryMove(...mv);
});

// コマンドボタンクリック
document.querySelectorAll('.battle-command').forEach((btn, i) => {
  btn.addEventListener('click', () => {
    combatMenuIndex = i;
    updateCombatMenu();
    executeSelectedCommand();
  });
});

// タッチ操作
let touchStart = null;
mapCanvas.addEventListener('touchstart', e => {
  touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
});
mapCanvas.addEventListener('touchend', e => {
  if (!touchStart) return;
  const dx = e.changedTouches[0].clientX - touchStart.x;
  const dy = e.changedTouches[0].clientY - touchStart.y;
  if (Math.abs(dx) > Math.abs(dy)) tryMove(Math.sign(dx), 0);
  else tryMove(0, Math.sign(dy));
  touchStart = null;
});



// ══════════════════════════════════════════════════════════
//  dungeon_additions.js
//  既存の dungeon.js の末尾に貼り付けてください
// ══════════════════════════════════════════════════════════


// ══════════════════════════════════════════════════════════
//  CLASS SKILL TREES  各職業の固有スキルツリー定義
// ══════════════════════════════════════════════════════════
const CLASS_SKILL_TREES = {
  warrior: [
    {
      id: 'w_kyusho_tsuki', name: '急所突き', icon: '🎯', cost: 2, req: null,
      desc: '会心率+50%でATK×0.7の攻撃（MP5消費）',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('kyusho_tsuki')) p.skillCommands.push('kyusho_tsuki');
      }
    },

    {
      id: 'w_iron_wall', name: '鉄壁', icon: '🛡', cost: 1, req: null,
      desc: '3ターン間、被ダメ時にDEF÷4の反撃ダメージ（MP3消費）',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('iron_wall')) p.skillCommands.push('iron_wall');
      }
    },
    {
      id: 'w_kiai_tame', name: '気合ため', icon: '🎯', cost: 1, req: null,
      desc: '次の攻撃の会心ダメージ×1.5倍バフ（MP0消費）',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('kiai_tame')) p.skillCommands.push('kiai_tame');
      }
    },
    {
      id: 'w_shield_bash', name: 'シールドバッシュ', icon: '🛡', cost: 1, req: null,
      desc: 'DEFをATKとして扱って攻撃（MP0消費）',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('shield_bash')) p.skillCommands.push('shield_bash');
      }
    },
    {
      id: 'w_multi_slash', name: '乱れ切り', icon: '🌀', cost: 1, req: null,
      desc: 'ATK×0.75で1〜4回攻撃（MP5消費）',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('multi_slash')) p.skillCommands.push('multi_slash');
      }
    },
    {
      id: 'w_blood_awakening', name: '血の覚醒', icon: '🔴', cost: 2, req: null,
      desc: 'HP50%以下でATK+40%、HP25%以下でさらに+40%（MP2消費）',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('blood_awakening')) p.skillCommands.push('blood_awakening');
      }
    },
    {
      id: 'w_armor_break', name: '鎧砕き', icon: '🔨', cost: 2, req: 'w_multi_slash',
      desc: '敵のDEFを3ターン間−4する（MP4消費）',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('armor_break')) p.skillCommands.push('armor_break');
      }
    },
    {
      id: 'w_vampiric_slash', name: '吸血切り', icon: '🩸', cost: 2, req: 'w_multi_slash',
      desc: 'ATK×0.6のダメージ、与えたダメージを全回復（MP3消費）',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('vampiric_slash')) p.skillCommands.push('vampiric_slash');
      }
    },
    {
      id: 'w_rage_burst', name: '怒りの爆発', icon: '💢', cost: 2, req: null,
      desc: '怒りスタック×12ダメージ（被ダメごとスタック+1）（MP4消費）',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('rage_burst')) p.skillCommands.push('rage_burst');
      }
    },
    {
      id: 'w_ultimate_slash', name: '究極切り', icon: '👑', cost: 4,
      req: '__all_warrior__',
      desc: '【全スキル解放で使用可能】会心率70%、発動後ATK×2が3ターン継続（MP9消費）',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('ultimate_slash')) p.skillCommands.push('ultimate_slash');
      }
    },
  ],
  mage: [
    {
      id: 'fire_small', name: '炎魔法・小', icon: '🔥', cost: 1, req: null,
      desc: 'ATK×2の炎ダメージ（MP3消費）',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('fire_small')) p.skillCommands.push('fire_small');
      }
    },
    {
      id: 'fire_mid', name: '炎魔法・中', icon: '🔥', cost: 2, req: 'fire_small',
      desc: 'ATK×3の炎ダメージ（MP4消費）',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('fire_mid')) p.skillCommands.push('fire_mid');
      }
    },
    {
      id: 'fire_large', name: '炎魔法・大', icon: '🔥', cost: 3, req: 'fire_mid',
      desc: 'ATK×4.5の炎ダメージ（MP6消費）',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('fire_large')) p.skillCommands.push('fire_large');
      }
    },
    {
      id: 'ice_small', name: '氷魔法・小', icon: '❄', cost: 1, req: null,
      desc: 'ATK×2の氷ダメージ＋敵ATK-1（MP3消費）',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('ice_small')) p.skillCommands.push('ice_small');
      }
    },
    {
      id: 'ice_mid', name: '氷魔法・中', icon: '❄', cost: 2, req: 'ice_small',
      desc: 'ATK×3の氷ダメージ＋敵ATK-2（MP4消費）',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('ice_mid')) p.skillCommands.push('ice_mid');
      }
    },
    {
      id: 'ice_large', name: '氷魔法・大', icon: '❄', cost: 3, req: 'ice_mid',
      desc: 'ATK×4.5の氷ダメージ＋敵ATK-3（MP6消費）',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('ice_large')) p.skillCommands.push('ice_large');
      }
    },
    {
      id: 'wind_small', name: '風魔法・小', icon: '🌪', cost: 1, req: null,
      desc: 'ATK×2、DEF完全無視（MP3消費）',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('wind_small')) p.skillCommands.push('wind_small');
      }
    },
    {
      id: 'wind_mid', name: '風魔法・中', icon: '🌪', cost: 2, req: 'wind_small',
      desc: 'ATK×3、DEF無視＋20%で2連発（MP4消費）',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('wind_mid')) p.skillCommands.push('wind_mid');
      }
    },
    {
      id: 'wind_large', name: '風魔法・大', icon: '🌪', cost: 3, req: 'wind_mid',
      desc: 'ATK×4.5、DEF無視＋40%で2連発（MP6消費）',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('wind_large')) p.skillCommands.push('wind_large');
      }
    },
  ],

  rogue: [
    {
      id: 'r_poison_needle', name: '毒針', icon: '🐍', cost: 1, req: null,
      desc: '確定毒付与（毎ターン-4、最大3スタック）（MP2消費）',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('poison_needle')) p.skillCommands.push('poison_needle');
      }
    },
    {
      id: 'r_smoke_screen', name: '煙幕', icon: '💨', cost: 1, req: null,
      desc: '2ターン間、敵攻撃命中率-60%（MP2消費）',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('smoke_screen')) p.skillCommands.push('smoke_screen');
      }
    },
    {
      id: 'r_leg_sweep', name: '足払い', icon: '🦶', cost: 1, req: null,
      desc: '小ダメージ＋敵ATKを2ターン-3（MP2消費）',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('leg_sweep')) p.skillCommands.push('leg_sweep');
      }
    },
    {
      id: 'r_double_strike', name: '二連撃', icon: '🗡', cost: 1, req: null,
      desc: 'ATK×0.5で2回攻撃（MP3消費）',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('double_strike')) p.skillCommands.push('double_strike');
      }
    },
    {
      id: 'r_poison_mist', name: '毒霧', icon: '☠', cost: 2, req: null,
      desc: '強毒付与（毎ターン-8、2ターン）（MP3消費）',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('poison_mist')) p.skillCommands.push('poison_mist');
      }
    },
    {
      id: 'r_shadow_bind', name: '影縫い', icon: '🌑', cost: 2, req: null,
      desc: '敵を2ターン完全スタン（MP4消費）',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('shadow_bind')) p.skillCommands.push('shadow_bind');
      }
    },
    {
      id: 'r_rapid_poison', name: '連続毒針', icon: '💉', cost: 2, req: null,
      desc: '2〜3回毒針を連続で放つ（MP4消費）',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('rapid_poison')) p.skillCommands.push('rapid_poison');
      }
    },
    {
      id: 'r_poison_burst', name: '毒爆発', icon: '💥', cost: 2, req: null,
      desc: '毒スタック×15のダメージ（毒消去）（MP3消費）',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('poison_burst')) p.skillCommands.push('poison_burst');
      }
    },
    {
      id: 'r_death_dance', name: '死の舞踏', icon: '💀', cost: 4,
      req: '__all_rogue__',
      desc: '【全スキル解放】3ターン回避率+80%＋毎ターン自動毒針（MP6消費）',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('death_dance')) p.skillCommands.push('death_dance');
      }
    },
  ],
  cleric: [
    {
      id: 'c_holy_light', name: '聖光', icon: '☀', cost: 1, req: null,
      desc: 'ATK×1.8の聖属性ダメージ（MP3消費）',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('holy_light')) p.skillCommands.push('holy_light');
      }
    },
    {
      id: 'c_heal_self', name: '治癒', icon: '💚', cost: 1, req: null,
      desc: 'HP+20回復（MP3消費）',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('heal_self')) p.skillCommands.push('heal_self');
      }
    },
    {
      id: 'c_smite_evil', name: '神罰', icon: '⚡', cost: 2, req: 'c_holy_light',
      desc: 'ATK×2.5の聖ダメージ＋敵ATK-2（MP4消費）',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('smite_evil')) p.skillCommands.push('smite_evil');
      }
    },
    {
      id: 'c_holy_flame', name: '聖炎', icon: '🔥', cost: 2, req: 'c_holy_light',
      desc: '毎ターン-6の聖燃焼を3ターン付与（MP3消費）',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('holy_flame')) p.skillCommands.push('holy_flame');
      }
    },
    {
      id: 'c_holy_shield', name: '聖盾', icon: '🛡', cost: 2, req: 'c_heal_self',
      desc: '3ターン間ダメージ半減（MP3消費）',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('holy_shield')) p.skillCommands.push('holy_shield');
      }
    },
    {
      id: 'c_prayer', name: '祈り', icon: '🙏', cost: 2, req: 'c_heal_self',
      desc: '3ターン間毎ターンHP+8・MP+4回復（MP2消費）',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('prayer')) p.skillCommands.push('prayer');
      }
    },
    {
      id: 'c_miracle', name: '奇跡', icon: '✝', cost: 3, req: 'c_holy_shield',
      desc: '1戦闘1回限り、HP0時自動発動でHP30%復活（MP4消費）',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('miracle')) p.skillCommands.push('miracle');
      }
    },
    {
      id: 'c_sanctuary', name: '聖域', icon: '👼', cost: 3, req: 'c_prayer',
      desc: '2ターン完全無敵、終了時に反撃大ダメージ（MP5消費）',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('sanctuary')) p.skillCommands.push('sanctuary');
      }
    },
    {
      id: 'c_divine_judgment', name: '神の裁き', icon: '👑', cost: 4,
      req: '__all_cleric__',
      desc: '【全スキル解放】超大聖ダメージ＋HP全回復＋HP0時自動復活50%（MP8消費）',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('divine_judgment')) p.skillCommands.push('divine_judgment');
      }
    },
  ],
  dark_warrior: [
    {
      id: 'dw_dark_slash', name: '闇斬り', icon: '🌑', cost: 1, req: null,
      desc: 'HP5消費、ATK×1.8の闇ダメージ',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('dark_slash')) p.skillCommands.push('dark_slash');
      }
    },
    {
      id: 'dw_curse_slash', name: '呪縛斬り', icon: '⛓', cost: 1, req: null,
      desc: 'HP6消費、ATK×1.5＋3ターン呪い（ATK-3・DEF-2）',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('curse_slash')) p.skillCommands.push('curse_slash');
      }
    },
    {
      id: 'dw_soul_devour', name: '魂喰い', icon: '💜', cost: 2, req: 'dw_dark_slash',
      desc: 'HP8消費、ATK×2.5、与ダメ50%HP回収',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('soul_devour')) p.skillCommands.push('soul_devour');
      }
    },
    {
      id: 'dw_dark_wave', name: '暗黒波動', icon: '🌊', cost: 2, req: 'dw_dark_slash',
      desc: 'HP10消費、ATK×3のDEF無視ダメージ',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('dark_wave')) p.skillCommands.push('dark_wave');
      }
    },
    {
      id: 'dw_dark_bind', name: '闇縛り', icon: '🕸', cost: 2, req: 'dw_curse_slash',
      desc: 'HP4消費、敵を3ターン行動不能',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('dark_bind')) p.skillCommands.push('dark_bind');
      }
    },
    {
      id: 'dw_fear_mark', name: '恐怖の刻印', icon: '😱', cost: 2, req: 'dw_curse_slash',
      desc: 'HP4+MP4消費、敵のATKを3ターン-50%',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('fear_mark')) p.skillCommands.push('fear_mark');
      }
    },
    {
      id: 'dw_dark_curse', name: '暗黒呪縛', icon: '🌀', cost: 2, req: 'dw_dark_wave',
      desc: 'HP6消費、毎ターン敵HP-8を3ターン継続',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('dark_curse')) p.skillCommands.push('dark_curse');
      }
    },
    {
      id: 'dw_turbulence', name: '乱気流', icon: '🌪', cost: 3, req: 'dw_dark_wave',
      desc: 'HP15消費、ATK×0.7で3〜6回攻撃',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('turbulence')) p.skillCommands.push('turbulence');
      }
    },
    {
      id: 'dw_kill_strike', name: 'キル', icon: '💥', cost: 3, req: 'dw_dark_bind',
      desc: 'HP10消費、通常50%/エリート25%で即死（ボス無効）',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('kill_strike')) p.skillCommands.push('kill_strike');
      }
    },
    {
      id: 'dw_soul_release', name: '魂の解放', icon: '👁', cost: 4, req: '__all_dark_warrior__',
      desc: '【全スキル解放】HP30%以下でHP15消費、ATK×5の超大ダメージ',
      apply: p => {
        if (!p.skillCommands) p.skillCommands = [];
        if (!p.skillCommands.includes('soul_release')) p.skillCommands.push('soul_release');
      }
    },
  ],

};

// ══════════════════════════════════════════════════════════
//  SP ユーティリティ
// ══════════════════════════════════════════════════════════
function awardSP(amount) {
  if (!G.player) return;
  G.player.sp = (G.player.sp || 0) + amount;
  updateSPBadge();
  showSPPopup('+' + amount + ' SP');
  log('スキルポイント +' + amount + '！', 'sp');
}

function updateSPBadge() {
  const sp = G.player ? (G.player.sp || 0) : 0;
  const valEl = document.getElementById('sp-val');
  if (valEl) valEl.textContent = sp;
  const badge = document.getElementById('sp-badge');
  if (badge) badge.classList.toggle('has-sp', sp > 0);
  const ckSp = document.getElementById('classkill-sp-val');
  if (ckSp) ckSp.textContent = sp;
}

function showSPPopup(text) {
  const el = document.createElement('div');
  el.className = 'sp-popup';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1500);
}

// ══════════════════════════════════════════════════════════
//  CLASS SKILL TREE MODAL
// ══════════════════════════════════════════════════════════
function openClassSkillTree() {
  if (!G.player) return;
  updateSPBadge();
  renderClassSkillGrid();
  document.getElementById('classkill-modal').classList.add('active');
}
function closeClassSkillTree() {
  document.getElementById('classkill-modal').classList.remove('active');
}

function renderClassSkillGrid() {
  const p = G.player;
  const classId = Object.keys(CLASSES).find(k => CLASSES[k] === G.playerClass) || 'warrior';
  const treeKey = (classId === 'warrior' && G.isDarkWarrior) ? 'dark_warrior' : classId;
  const tree = CLASS_SKILL_TREES[treeKey] || [];

  const owned = new Set([...(p.classSkills || []), ...(p.skillCommands || [])]);
  const sp = p.sp || 0;

  document.getElementById('classkill-title').textContent =
    G.playerClass.icon + ' ' + G.playerClass.name + ' スキルツリー';
  document.getElementById('classkill-sp-val').textContent = sp;

  const grid = document.getElementById('classkill-grid');
  grid.innerHTML = tree.map(skill => {
    const isOwned = owned.has(skill.id);
    const reqMet = !skill.req || owned.has(skill.req);
    const canAfford = sp >= skill.cost;
    let isLocked = false;
    if (skill.req === '__all_warrior__' || skill.req === '__all_rogue__' || skill.req === '__all_cleric__') {
      const treeKey = skill.req === '__all_warrior__' ? 'warrior' : skill.req === '__all_rogue__' ? 'rogue' : 'cleric';
      const tree = CLASS_SKILL_TREES[treeKey];
      const allExcept = tree.filter(s => s.req !== '__all_warrior__' && s.req !== '__all_rogue__');
      const allOwned = allExcept.every(s => owned.has(s.id));
      if (!allOwned) { log('全スキルを習得してから解放される！', 'warn'); return; }
    } else if (classId === 'mage' && skill.req && !owned.has(skill.req)) {
      log('前提スキルが必要！', 'warn'); return;
    }



    const cantBuy = !isLocked && !isOwned && !canAfford;

    let cls = 'classkill-card';
    if (isOwned) cls += ' owned';
    else if (isLocked) cls += ' locked';
    else if (cantBuy) cls += ' cant-afford available';
    else cls += ' available';

    const reqName = skill.req
      ? (tree.find(s => s.id === skill.req) || {}).name || skill.req
      : null;

    return '<div class="' + cls + '" onclick="buyClassSkill(\'' + skill.id + '\')">' +
      '<span class="classkill-icon">' + skill.icon + '</span>' +
      '<span class="classkill-name">' + skill.name + '</span>' +
      '<div class="classkill-desc">' + skill.desc + '</div>' +
      '<div class="classkill-cost' + (cantBuy ? ' unaffordable' : '') + '">' +
      (isOwned ? '習得済' : skill.cost + ' SP') +
      '</div>' +
      (reqName && !isOwned ? '<div class="classkill-req">🔗 要: ' + reqName + '</div>' : '') +
      '</div>';
  }).join('');
}

// 修正後
function buyClassSkill(skillId) {
  const p = G.player;
  const classId = Object.keys(CLASSES).find(k => CLASSES[k] === G.playerClass) || 'warrior';
  const treeKey = (classId === 'warrior' && G.isDarkWarrior) ? 'dark_warrior' : classId;
  const tree = CLASS_SKILL_TREES[treeKey] || [];
  const skill = tree.find(s => s.id === skillId);
  if (!skill) return;

  const classSkills = new Set(p.classSkills || []);
  const ownedCmds = new Set(p.skillCommands || []);
  const owned = new Set([...classSkills, ...ownedCmds]);
  if (owned.has(skillId)) return;
  if (skill.req === '__all_warrior__' || skill.req === '__all_rogue__' || skill.req === '__all_cleric__' || skill.req === '__all_dark_warrior__') {
    const treeKey = skill.req === '__all_warrior__' ? 'warrior'
      : skill.req === '__all_rogue__' ? 'rogue'
        : skill.req === '__all_cleric__' ? 'cleric'
          : 'dark_warrior';

    const tree = CLASS_SKILL_TREES[treeKey];
    const allExcept = tree.filter(s => s.req !== '__all_warrior__' && s.req !== '__all_rogue__');
    const allOwned = allExcept.every(s => owned.has(s.id));
    if (!allOwned) { log('全スキルを習得してから解放される！', 'warn'); return; }
  } else if (classId === 'mage' && skill.req && !owned.has(skill.req)) {
    log('前提スキルが必要！', 'warn'); return;
  }

  // SPチェック
  if ((p.sp || 0) < skill.cost) { log('SPが足りない！', 'warn'); return; }

  // ここで初めて消費・習得
  p.sp -= skill.cost;
  if (!p.classSkills) p.classSkills = [];
  p.classSkills.push(skillId);
  skill.apply(p);

  log('固有スキル「' + skill.name + '」を習得！', 'warn');
  showSPPopup('-' + skill.cost + ' SP');
  updateSPBadge();
  renderClassSkillGrid();
  updateUI();

  log('固有スキル「' + skill.name + '」を習得！', 'warn');
  showSPPopup('-' + skill.cost + ' SP');
  updateSPBadge();
  renderClassSkillGrid();
  updateUI();
}

// ══════════════════════════════════════════════════════════
//  ITEM SUBMENU（戦闘中アイテム選択）
// ══════════════════════════════════════════════════════════
let itemSubMenuActive = false;
let itemSubMenuIndex = 0;

function openItemSubMenu() {
  const p = G.player;
  if (!p.items || p.items.length === 0) { log('アイテムがない！', 'warn'); return; }
  itemSubMenuActive = true;
  itemSubMenuIndex = 0;
  renderItemSubMenu();
  document.getElementById('item-submenu').classList.add('active');
}

function closeItemSubMenu() {
  itemSubMenuActive = false;
  document.getElementById('item-submenu').classList.remove('active');
}

function renderItemSubMenu() {
  const p = G.player;
  const submenu = document.getElementById('item-submenu');
  const rows = p.items.map((item, idx) => {
    const sel = idx === itemSubMenuIndex ? 'selected' : '';
    return '<div class="itm-sub-row ' + sel + '" onclick="selectItemSubRow(' + idx + ')">' +
      '<span class="itm-sub-arrow">▶</span>' +
      '<span class="itm-sub-name">' + item.name + '</span>' +
      '<span class="itm-sub-qty">x' + item.qty + '</span>' +
      '</div>';
  });
  const cancelIdx = p.items.length;
  const cancelSel = itemSubMenuIndex === cancelIdx ? 'selected' : '';
  rows.push(
    '<div class="itm-sub-row itm-sub-cancel ' + cancelSel + '" onclick="selectItemSubRow(' + cancelIdx + ')">' +
    '<span class="itm-sub-arrow">▶</span>' +
    '<span class="itm-sub-name">▶ キャンセル</span>' +
    '<span class="itm-sub-qty"></span>' +
    '</div>'
  );

  // タイトルを残して行を再描画
  const title = submenu.querySelector('#item-submenu-title');
  submenu.querySelectorAll('.itm-sub-row').forEach(el => el.remove());
  title.insertAdjacentHTML('afterend', rows.join(''));
}

function selectItemSubRow(idx) {
  itemSubMenuIndex = idx;
  renderItemSubMenu();
  executeItemSubMenu();
}

function executeItemSubMenu() {
  const p = G.player;
  if (itemSubMenuIndex >= p.items.length) {
    closeItemSubMenu();
    return;
  }
  const item = p.items[itemSubMenuIndex];
  if (!item) { closeItemSubMenu(); return; }

  // healBoost パッシブ適用
  let origVal = item.val;
  if (p.passives.healBoost && item.type === 'heal') {
    item.val = Math.floor(item.val * p.passives.healBoost);
  }
  const used = useItem(item.name);
  item.val = origVal; // 元に戻す

  if (used) {
    closeItemSubMenu();
    if (G.inCombat && G.currentEnemy && G.currentEnemy.hp > 0) {
      doEnemyAttack(G.currentEnemy);
      if (G.currentEnemy && G.currentEnemy.hp > 0) updateEnemyBar();
    }
    renderAll(); updateUI();
  }
}

// アイテムサブメニュー用キーボード（captureフェーズで先に捕捉）
document.addEventListener('keydown', function (e) {
  if (!itemSubMenuActive) return;
  const p = G.player;
  const maxIdx = (p.items ? p.items.length : 0);

  if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
    e.preventDefault(); e.stopPropagation();
    itemSubMenuIndex = (itemSubMenuIndex - 1 + maxIdx + 1) % (maxIdx + 1);
    renderItemSubMenu();
  } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
    e.preventDefault(); e.stopPropagation();
    itemSubMenuIndex = (itemSubMenuIndex + 1) % (maxIdx + 1);
    renderItemSubMenu();
  } else if (e.key === 'Enter' || e.key === 'f' || e.key === 'F') {
    e.preventDefault(); e.stopPropagation();
    executeItemSubMenu();
  } else if (e.key === 'Escape' || e.key === 'x' || e.key === 'X') {
    e.preventDefault(); e.stopPropagation();
    closeItemSubMenu();
  }
}, true);

// ══════════════════════════════════════════════════════════
//  combatAction の 'itm' をオーバーライド
// ══════════════════════════════════════════════════════════
(function () {
  const _orig = combatAction;
  combatAction = function (type) {
    if (type === 'itm') {
      if (!G.inCombat || !G.currentEnemy) return;
      openItemSubMenu();
      return;
    }
    _orig(type);
  };
})();

// ══════════════════════════════════════════════════════════
//  GAME CLEAR
// ══════════════════════════════════════════════════════════
function gameWin() {
  G.inCombat = false;
  endCombat();
  const p = G.player;

  // クリアデータを保存
  const clearData = {
    id: Date.now(),
    date: new Date().toLocaleDateString('ja-JP'),
    mode: G.mode || 'normal',
    className: G.playerClass.name,
    classIcon: G.playerClass.icon,
    floor: G.floor,
    lv: p.lv,
    kills: p.kills,
    gold: p.gold,
    isDarkWarrior: G.isDarkWarrior || false,
    skills: [
      ...p.skills.map(s => ({ name: s.name, icon: s.icon, type: s.type })),
      ...(p.classSkills || []).map(id => {
        const allTrees = [...CLASS_SKILL_TREES.warrior, ...CLASS_SKILL_TREES.dark_warrior,
        ...CLASS_SKILL_TREES.mage, ...CLASS_SKILL_TREES.rogue, ...CLASS_SKILL_TREES.cleric];
        const s = allTrees.find(t => t.id === id);
        return s ? { name: s.name, icon: s.icon, type: 'class' } : null;
      }).filter(Boolean),
    ],
  };

  const existing = JSON.parse(localStorage.getItem('dungeon_clears') || '[]');
  existing.unshift(clearData);
  if (existing.length > 20) existing.splice(20);
  localStorage.setItem('dungeon_clears', JSON.stringify(existing));

  document.getElementById('win-stats').innerHTML =
    '<div class="win-stat-row"><span class="win-stat-label">到達フロア</span><span class="win-stat-val">' + G.floor + 'F</span></div>' +
    '<div class="win-stat-row"><span class="win-stat-label">レベル</span><span class="win-stat-val">LV ' + p.lv + '</span></div>' +
    '<div class="win-stat-row"><span class="win-stat-label">撃破数</span><span class="win-stat-val">' + p.kills + ' 体</span></div>' +
    '<div class="win-stat-row"><span class="win-stat-label">所持金</span><span class="win-stat-val">' + p.gold + ' G</span></div>' +
    '<div class="win-stat-row"><span class="win-stat-label">習得スキル</span><span class="win-stat-val">' + (p.skills.length + (p.classSkills ? p.classSkills.length : 0)) + ' 個</span></div>';

  document.getElementById('win-message').innerHTML =
    G.playerClass.icon + ' ' + G.playerClass.name + 'よ、<br>ダンジョンを制覇した！<br>おめでとう！';

  document.getElementById('win-overlay').classList.add('active');
  log('★ GAME CLEAR ★ ダンジョンを制覇した！', 'clear');
}

// ══════════════════════════════════════════════════════════
//  defeatEnemy にSP付与・クリア判定をパッチ
// ══════════════════════════════════════════════════════════
(function () {
  const _orig = defeatEnemy;
  defeatEnemy = function (e) {
    _orig(e);

    if (e.kind === 'boss') {
      const isHard = G.mode === 'hard';
      const bossArr = isHard ? HARD_BOSS_TYPES : BOSS_TYPES;
      const bossIdx = Math.min(Math.floor(G.floor / 5) - 1, bossArr.length - 1);
      if (bossIdx >= bossArr.length - 1) {
        setTimeout(gameWin, 700);
        return;
      }
    }
    updateExpBar();
  };
})();


// ══════════════════════════════════════════════════════════
//  normalEnemyHit に 回避・神の加護・マナシールド・カウンターをパッチ
// ══════════════════════════════════════════════════════════
(function () {
  const _orig = normalEnemyHit;
  normalEnemyHit = function (e, atkValue) {
    const p = G.player;

    // 回避
    if (p.passives.dodge && Math.random() < p.passives.dodge) {
      spawnPopup(G.px, G.py, '回避！', '#3ee8cc');
      log(e.name + 'の攻撃を回避した！', 'good');
      updateBattlePlayerBars(); updateUI();
      return;
    }
    // 神の加護
    if (p.passives.divineGuard) {
      atkValue = Math.floor(atkValue * (1 - p.passives.divineGuard));
    }
    // マナシールド
    if (p.passives.manaShield && p.mp > 0) {
      const def = p.def;
      let dmg = Math.max(0, atkValue - def);
      if (dmg > 0 && p.mp >= dmg) {
        p.mp -= dmg;
        spawnPopup(G.px, G.py, '🔮-' + dmg + 'MP', '#4488ff');
        log('マナシールドが' + dmg + 'ダメージを肩代わり！', 'good');
        updateBattlePlayerBars(); updateUI();
        return;
      }
    }
    // 聖盾（ダメージ半減）
    if ((p.passives._holyShieldTurns || 0) > 0) {
      atkValue = Math.ceil(atkValue / 2);
      p.passives._holyShieldTurns--;
      spawnPopup(G.px, G.py, '🛡半減！', '#4488ff');
      log(`聖盾！ ダメージ半減！（残り${p.passives._holyShieldTurns}ターン）`, 'good');
    }

    const counterRate = p.passives.counter || 0;

    // 怒りスタック蓄積（戦士のみ）
    if (Object.keys(CLASSES).find(k => CLASSES[k] === G.playerClass) === 'warrior') {
      p.passives._rageStacks = (p.passives._rageStacks || 0) + 1;
      if (p.passives._rageStacks > 10) p.passives._rageStacks = 10;
    }

    // 鉄壁反撃
    if ((p.passives._ironWallTurns || 0) > 0) {
      const boost = p.passives.defDmgBoost || 1;
      let counterDmg = Math.max(1, Math.floor(p.def * boost));
      if (p.passives.counterWill) {
        counterDmg += Math.floor(p.atk * p.passives.counterWill);
      }
      e.hp -= counterDmg;
      spawnPopup(e.x, e.y, `🛡${counterDmg}`, '#4488ff');
      log(`鉄壁反撃！ ${e.name}に${counterDmg}ダメージ！`, 'good');
      if (e.hp <= 0 && G.inCombat) { defeatEnemy(e); return; }
      updateEnemyBar();
    }
    // 堅陣：被弾時HP回復
    if (p.passives.fortify) {
      const healAmt = Math.max(1, Math.floor(p.def / 4));
      p.hp = Math.min(p.hp + healAmt, p.maxHp);
      spawnPopup(G.px, G.py, `⛩+${healAmt}HP`, '#4488ff');
    }



    // 奇跡・神の裁き復活チェック用に呼び出し前HPを記録
    const hpBefore = p.hp;
    _orig(e, atkValue);

    if (p.hp <= 0 && hpBefore > 0) {
      if ((p.passives.undying || 0) > 0 && Math.random() < p.passives.undying) {
        p.hp = 1;
        spawnPopup(G.px, G.py, '💀不屈！', '#e84040');
        log('不屈！ 瀕死を乗り越えた！', 'warn');
        updateBattlePlayerBars(); updateUI();
        return;
      }
      if (p.passives._miracleReady && !p._miracleUsed) {
        p.hp = Math.floor(p.maxHp * 0.3);
        p.passives._miracleReady = false;
        p._miracleUsed = true;
        spawnPopup(G.px, G.py, '✝奇跡！', '#f5c842');
        log('奇跡発動！ HP30%で復活！', 'warn');
        updateBattlePlayerBars(); updateUI();
        return;
      }
      if (p.passives._divineRevive) {
        p.hp = Math.floor(p.maxHp * 0.5);
        delete p.passives._divineRevive;
        spawnPopup(G.px, G.py, '👑復活！', '#f5c842');
        log('神の裁き・復活発動！ HP50%で蘇った！', 'warn');
        updateBattlePlayerBars(); updateUI();
        return;
      }
      if (p.passives.resurrection && !p._resurrectionUsed) {
        p.hp = Math.floor(p.maxHp * 0.25);
        p._resurrectionUsed = true;
        delete p.passives.resurrection;
        spawnPopup(G.px, G.py, '復活！', '#ffcc44');
        log('復活の祈り！ HP25%で蘇生した！', 'warn');
        updateBattlePlayerBars(); updateUI();
        return;
      }
      gameOver();
      return;
    }

    // カウンター
    if (counterRate > 0 && e && e.hp > 0 && Math.random() < counterRate) {
      const dmg = Math.max(1, Math.floor(p.atk * 0.8));
      e.hp -= dmg;
      spawnPopup(e.x, e.y, '⚡' + dmg, '#f5c842');
      log('カウンター！ ' + e.name + 'に' + dmg + 'ダメージ！', 'warn');
      if (e.hp <= 0 && G.inCombat) { defeatEnemy(e); return; }
      updateEnemyBar();
    }
  };
})();


// ══════════════════════════════════════════════════════════
//  doEnemyAttack に 毒ダメージ・不屈・復活をパッチ
// ══════════════════════════════════════════════════════════
(function () {
  const _orig = doEnemyAttack;
  doEnemyAttack = function (e) {
    if (!e || e.hp <= 0) return;
    const p = G.player;

    // 毒ダメージ
    if (e._poisonTurns > 0) {
      const pd = 3;
      e.hp -= pd; e._poisonTurns--;
      spawnPopup(e.x, e.y, '🐍-' + pd, '#3ecc6f');
      if (e.hp <= 0 && G.inCombat) { defeatEnemy(e); return; }
      updateEnemyBar();
    }

    // 鉄壁ターン管理
    if ((p.passives._ironWallTurns || 0) > 0) {
      p.passives._ironWallTurns--;
      if (p.passives._ironWallTurns === 0) {
        log('鉄壁が解除された', 'entry');
      }
    }
    // 血の覚醒ターン管理
    if ((p.passives._bloodAwakeningTurns || 0) > 0) {
      p.passives._bloodAwakeningTurns--;
      if (p.passives._bloodAwakeningTurns === 0 && p.passives._bloodAwakeningBonus) {
        p.atk = Math.floor(p.atk / (1 + p.passives._bloodAwakeningBonus));
        p.passives._bloodAwakeningBonus = 0;
        log('血の覚醒が切れた…', 'entry');
      }
    }



    // 時空切りカウントダウン
    if (e._pendingTimeSlash > 0) {
      e._pendingTimeSlash--;
      if (e._pendingTimeSlash === 0) {
        const dmg = Math.max(1, Math.floor((e._timeSlashAtk || p.atk) * 2));
        e.hp -= dmg;
        spawnPopup(e.x, e.y, `⏳💥${dmg}`, '#b06aff');
        log(`時空切りが炸裂！ ${e.name}に${dmg}の遅延ダメージ！！`, 'warn');
        if (e.hp <= 0 && G.inCombat) { defeatEnemy(e); return; }
        updateEnemyBar();
      }
    }
    // 鎧砕きターン管理
    if (e._armorBreakTurns > 0) {
      e._armorBreakTurns--;
      if (e._armorBreakTurns === 0 && e._armorBreakReduce) {
        e.def += e._armorBreakReduce;
        e._armorBreakReduce = 0;
        log(`${e.name}のDEFが元に戻った`, 'entry');
      }
    }
    // 呪いターン管理
    if ((e._curseTurns || 0) > 0) {
      e._curseTurns--;
      if (e._curseTurns === 0) {
        e.atk += (e._curseAtkReduce || 0);
        e.def += (e._curseDefReduce || 0);
        e._curseAtkReduce = 0;
        e._curseDefReduce = 0;
        log(`${e.name}の呪いが解けた`, 'entry');
      }
    }
    // 恐怖の刻印ターン管理
    if ((e._fearTurns || 0) > 0) {
      e._fearTurns--;
      if (e._fearTurns === 0 && e._fearAtkOrig) {
        e.atk = e._fearAtkOrig;
        e._fearAtkOrig = 0;
        log(`${e.name}の恐怖が消えた…ATKが元に戻った`, 'entry');
      }
    }
    // 暗黒呪縛ダメージ
    if ((e._darkCurseTurns || 0) > 0) {
      const cd = e._darkCurseDmg || 8;
      e.hp -= cd;
      e._darkCurseTurns--;
      spawnPopup(e.x, e.y, `🌀-${cd}`, '#4400cc');
      log(`暗黒呪縛！ ${e.name}に${cd}ダメージ！（残り${e._darkCurseTurns}ターン）`, 'combat');
      if (e.hp <= 0 && G.inCombat) { defeatEnemy(e); return; }
      updateEnemyBar();
    }

    // 魂縛りターン管理
    if ((e._healSeal || 0) > 0) {
      e._healSeal--;
      if (e._healSeal === 0) log(`${e.name}の回復封印が解けた`, 'entry');
    }

    // 究極切りATK2倍バフ管理
    if (p.passives._ultimateBuffTurns > 0) {
      p.passives._ultimateBuffTurns--;
      if (p.passives._ultimateBuffTurns === 0 && p.passives._ultimateOrigAtk) {
        p.atk = p.passives._ultimateOrigAtk;
        delete p.passives._ultimateOrigAtk;
        log('究極切りの強化が切れた…', 'entry');
      }
    }
    // スタン中は攻撃しない
    if (e._stunTurns > 0) {
      e._stunTurns--;
      spawnPopup(e.x, e.y, '🌑スタン', '#8844ff');
      log(`${e.name}はスタンで動けない！（残り${e._stunTurns}ターン）`, 'entry');
      return;
    }
    // 煙幕・死の舞踏による回避判定
    const smokeEvade = (p.passives._smokeTurns > 0) ? 0.6 : 0;
    const danceEvade = (p.passives._deathDanceTurns > 0) ? 0.8 : 0;
    const totalEvade = Math.min(0.95, smokeEvade + danceEvade);
    if (totalEvade > 0 && Math.random() < totalEvade) {
      spawnPopup(G.px, G.py, '回避！', '#3ee8cc');
      log(`${e.name}の攻撃を回避した！`, 'good');
      // ターンカウント消費
      if (p.passives._smokeTurns > 0) p.passives._smokeTurns--;
      if (p.passives._deathDanceTurns > 0) {
        // 死の舞踏：自動毒針
        e._poisonStacks = Math.min((e._poisonStacks || 0) + 1, 3);
        e._poisonPerTurn = e._poisonStacks * 4;
        e._poisonTurns = 999;
        spawnPopup(e.x, e.y, `🐍自動毒針×${e._poisonStacks}`, '#3ecc6f');
        log(`死の舞踏！ 自動毒針！毒スタック${e._poisonStacks}！`, 'good');
        p.passives._deathDanceTurns--;
      }
      updateBattlePlayerBars(); updateUI();
      return;
    }
    // 煙幕・死の舞踏のターン消費（回避失敗時）
    if (p.passives._smokeTurns > 0) p.passives._smokeTurns--;
    if (p.passives._deathDanceTurns > 0) {
      e._poisonStacks = Math.min((e._poisonStacks || 0) + 1, 3);
      e._poisonPerTurn = e._poisonStacks * 4;
      e._poisonTurns = 999;
      spawnPopup(e.x, e.y, `🐍自動毒針×${e._poisonStacks}`, '#3ecc6f');
      log(`死の舞踏！ 自動毒針！毒スタック${e._poisonStacks}！`, 'good');
      p.passives._deathDanceTurns--;
    }
    // 毒ダメージ（スタック式）
    if ((e._poisonTurns || 0) > 0 && (e._poisonPerTurn || 0) > 0) {
      const pd = e._poisonPerTurn;
      e.hp -= pd;
      if (e._poisonTurns !== 999) e._poisonTurns--;
      if (e._poisonTurns === 0) { e._poisonStacks = 0; e._poisonPerTurn = 0; }
      spawnPopup(e.x, e.y, `🐍-${pd}`, '#3ecc6f');
      log(`毒ダメージ！ ${e.name}に${pd}！`, 'entry');
      if (e.hp <= 0 && G.inCombat) { defeatEnemy(e); return; }
      updateEnemyBar();
    }
    // スキル弱体ターン管理
    if ((p.passives._skillWeakenTurns || 0) > 0) {
      p.passives._skillWeakenTurns--;
      if (p.passives._skillWeakenTurns === 0) {
        p.passives._skillWeakened = false;
        log('スキル弱体が解除された', 'entry');
      }
    }
    // DEF低下ターン管理
    if ((p.passives._defDownTurns || 0) > 0) {
      p.passives._defDownTurns--;
      if (p.passives._defDownTurns === 0 && p.passives._defDown) {
        p.def += p.passives._defDown;
        p.passives._defDown = 0;
        log('DEF低下が解除された', 'entry');
      }
    }
    // 足払いターン管理
    if ((e._legSweepTurns || 0) > 0) {
      e._legSweepTurns--;
      if (e._legSweepTurns === 0 && e._legSweepReduce) {
        e.atk += e._legSweepReduce;
        e._legSweepReduce = 0;
        log(`${e.name}のATKが元に戻った`, 'entry');
      }
    }
    // 聖炎ダメージ
    if ((e._holyBurnTurns || 0) > 0) {
      const bd = e._holyBurnDmg || 6;
      e.hp -= bd;
      e._holyBurnTurns--;
      spawnPopup(e.x, e.y, `🔥-${bd}`, '#f5c842');
      log(`聖炎！ ${e.name}に${bd}ダメージ！（残り${e._holyBurnTurns}ターン）`, 'combat');
      if (e.hp <= 0 && G.inCombat) { defeatEnemy(e); return; }
      updateEnemyBar();
    }
    // 祈り回復
    if ((p.passives._prayerTurns || 0) > 0) {
      const ph = Math.min(8, p.maxHp - p.hp);
      const pm = Math.min(4, p.maxMp - p.mp);
      p.hp += ph; p.mp += pm;
      p.passives._prayerTurns--;
      if (ph > 0) spawnPopup(G.px, G.py, `+${ph}HP`, '#3ecc6f');
      if (pm > 0) spawnPopup(G.px, G.py - 1, `+${pm}MP`, '#4488ff');
      log(`祈り！ HP+${ph}・MP+${pm}回復！（残り${p.passives._prayerTurns}ターン）`, 'good');
      updateBattlePlayerBars();
    }
    // 聖域カウントダウン
    if ((p.passives._sanctuaryTurns || 0) > 0) {
      p.passives._sanctuaryTurns--;
      spawnPopup(G.px, G.py, '👼無敵！', '#ffffff');
      log(`聖域！ 無敵状態！（残り${p.passives._sanctuaryTurns}ターン）`, 'good');
      if (p.passives._sanctuaryTurns === 0) {
        // 無敵終了時に反撃
        const te = p.passives._sanctuaryEnemy;
        if (te && te.hp > 0) {
          const boost = p.passives.holyBoost || 0;
          const rdmg = Math.max(5, Math.floor(p.atk * 3 * (1 + boost)));
          te.hp -= rdmg;
          spawnPopup(te.x, te.y, `👼💥${rdmg}`, '#f5c842');
          log(`聖域解放！ ${te.name}に${rdmg}の反撃ダメージ！`, 'warn');
          if (te.hp <= 0 && G.inCombat) { defeatEnemy(te); return; }
          updateEnemyBar();
        }
        delete p.passives._sanctuaryEnemy;
      }
      updateBattlePlayerBars();
      return; // 無敵中は敵の攻撃を受けない
    }

    _orig(e);
  };
})();

// ══════════════════════════════════════════════════════════
//  startCombat に 祝福・雄叫び・先制攻撃をパッチ
// ══════════════════════════════════════════════════════════
(function () {
  const _orig = startCombat;
  startCombat = function (enemy) {
    _orig(enemy);
    const p = G.player;

    // 祝福
    if (p.passives.blessHeal) {
      const heal = Math.min(p.passives.blessHeal, p.maxHp - p.hp);
      if (heal > 0) {
        p.hp += heal;
        spawnPopup(G.px, G.py, '✝+' + heal + 'HP', '#f5c842');
        log('祝福でHP+' + heal + '回復！', 'good');
        updateBattlePlayerBars();
      }
    }
    // 雄叫び
    if (p.passives.warcry) {
      const r = enemy.kind === 'boss' ? 1 : 3;
      enemy.atk = Math.max(1, enemy.atk - r);
      spawnPopup(enemy.x, enemy.y, '雄叫び！', '#ff8c00');
      log('雄叫び！ ' + enemy.name + 'のATKが-' + r + '！', 'warn');
    }
    // 先制攻撃
    if (p.passives.firstStrike && Math.random() < p.passives.firstStrike) {
      const dmg = Math.max(1, p.atk - enemy.def);
      enemy.hp -= dmg;
      spawnPopup(enemy.x, enemy.y, '先制！-' + dmg, '#3ee8cc');
      log('先制攻撃！ ' + enemy.name + 'に' + dmg + 'ダメージ！', 'good');
      if (enemy.hp <= 0) { defeatEnemy(enemy); return; }
      updateEnemyBar();
    }
  };
})();

// ══════════════════════════════════════════════════════════
//  combatAction の atk に 毒・スマイト・バーサーク・チェインをパッチ
// ══════════════════════════════════════════════════════════
(function () {
  const _orig = combatAction;
  combatAction = function (type) {
    if (type === 'atk' && G.inCombat && G.currentEnemy) {
      const p = G.player;
      const e = G.currentEnemy;

      // バーサーク
      let tmpAtk = 0;
      if (p.passives.berserk && p.hp <= p.maxHp * 0.3) {
        tmpAtk = Math.floor(p.atk * p.passives.berserk);
        p.atk += tmpAtk;
      }
      // 怒りの魂
      let tmpRage = 0;
      if (p.passives.rageBonus && p.hp <= p.maxHp * 0.5) {
        tmpRage = p.passives.rageBonus;
        p.atk += tmpRage;
      }

      // 溜め切り確定会心フラグ
      if (p.passives._chargeReady) {
        p.passives.critRate = (p.passives.critRate || 0) + 99; // 確定会心
        p.passives._chargeReady = false;
      }

      _orig(type);

      // 確定会心フラグを戻す（+99した分を戻す）
      if (!p.passives._chargeReady && p.passives.critRate > 1) {
        p.passives.critRate = Math.max(0, p.passives.critRate - 99);
      }

      // ATKを戻す
      p.atk -= (tmpAtk + tmpRage);

      if (!G.inCombat || !e || e.hp <= 0) return;

      // 毒付与
      if (p.passives.poisonRate && Math.random() < p.passives.poisonRate) {
        e._poisonTurns = (e._poisonTurns || 0) + 3;
        spawnPopup(e.x, e.y, '毒！', '#3ecc6f');
        log(e.name + 'に毒を与えた！', 'good');
      }
      // スマイト
      if (p.passives.smite && e.hp > 0) {
        const sd = Math.floor(p.atk * p.passives.smite);
        if (sd > 0) { e.hp -= sd; spawnPopup(e.x, e.y, '☀' + sd, '#f5c842'); }
        if (e.hp <= 0 && G.inCombat) { defeatEnemy(e); return; }
        updateEnemyBar();
      }
      // チェイン魔法
      if (p.passives.chainMag && e.hp > 0 && Math.random() < p.passives.chainMag) {
        const cd = Math.max(1, p.atk * 2 - Math.floor(e.def / 2));
        e.hp -= cd;
        spawnPopup(e.x, e.y, '✦' + cd, '#b06aff');
        log('チェイン魔法！ 追加' + cd + 'ダメージ！', 'warn');
        if (e.hp <= 0 && G.inCombat) { defeatEnemy(e); return; }
        updateEnemyBar();
      }
      return;
    }
    _orig(type);
  };
})();

// ══════════════════════════════════════════════════════════
//  EXP バー更新
// ══════════════════════════════════════════════════════════
function updateExpBar() {
  const p = G.player;
  if (!p) return;
  const fill = document.getElementById('exp-bar-fill');
  const text = document.getElementById('exp-bar-text');
  if (!fill || !text) return;
  const pct = Math.min(100, Math.floor((p.exp / p.expNext) * 100));
  fill.style.width = pct + '%';
  text.textContent = p.exp + '/' + p.expNext;
}

// ══════════════════════════════════════════════════════════
//  FLOOR FLASH
// ══════════════════════════════════════════════════════════
function triggerFloorFlash() {
  const el = document.getElementById('floor-flash');
  if (!el) return;
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

// ══════════════════════════════════════════════════════════
//  tryMove にフラッシュ・itemSubMenu ガードをパッチ
// ══════════════════════════════════════════════════════════
(function () {
  const _orig = tryMove;
  tryMove = function (dx, dy) {
    if (itemSubMenuActive) return;
    const nx = G.px + dx, ny = G.py + dy;
    if (G.map && G.map[ny] && G.map[ny][nx] === TILE_STAIR) triggerFloorFlash();
    _orig(dx, dy);
    updateExpBar();
  };
})();

// ══════════════════════════════════════════════════════════
//  updateUI にEXPバー・SP更新をパッチ
// ══════════════════════════════════════════════════════════
(function () {
  const _orig = updateUI;
  updateUI = function () {
    _orig();
    updateExpBar();
    updateSPBadge();
  };
})();

// ══════════════════════════════════════════════════════════
//  startGame にSP・classSkills 初期化をパッチ
// ══════════════════════════════════════════════════════════
(function () {
  const _orig = startGame;
  startGame = function (classId) {
    _orig(classId);
    G.player.sp = 0;
    G.player.classSkills = [];
    updateSPBadge();
    updateExpBar();
  };
})();

// ══════════════════════════════════════════════════════════
//  DOM 自動挿入（HTML に追記し忘れた場合の保険）
// ══════════════════════════════════════════════════════════
(function () {
  // win-overlay
  if (!document.getElementById('win-overlay')) {
    const el = document.createElement('div');
    el.id = 'win-overlay';
    el.innerHTML =
      '<div id="win-title">★ GAME CLEAR ★</div>' +
      '<div id="win-subtitle">— DUNGEON CONQUERED —</div>' +
      '<div id="win-stars"><span>★</span><span>★</span><span>★</span></div>' +
      '<div id="win-stats"></div>' +
      '<div id="win-message"></div>' +
      '<button id="win-btn" onclick="retryGame()">▶ もう一度挑む</button>';
    document.body.appendChild(el);
  }
  // floor-flash
  if (!document.getElementById('floor-flash')) {
    const fl = document.createElement('div');
    fl.id = 'floor-flash';
    document.body.appendChild(fl);
  }
  // exp-bar（statグリッドの後ろに挿入）
  if (!document.getElementById('exp-bar-fill')) {
    const sg = document.querySelector('.stat-grid');
    if (sg) {
      const row = document.createElement('div');
      row.className = 'exp-bar-row';
      row.innerHTML =
        '<div class="exp-bar-label">EXP <span id="exp-bar-text">0/10</span></div>' +
        '<div class="exp-bar-track"><div class="exp-bar-fill" id="exp-bar-fill" style="width:0%"></div></div>';
      sg.after(row);
    }
  }
})();

// ══════════════════════════════════════════════════════════
//  SKILL SUBMENU（戦闘中スキル選択）
// ══════════════════════════════════════════════════════════
let skillSubMenuActive = false;
let skillSubMenuIndex = 0;

function openSkillSubMenu() {
  const p = G.player;
  const cmds = p.skillCommands || [];
  if (cmds.length === 0) { log('使えるスキルがない！', 'warn'); return; }
  skillSubMenuActive = true;
  skillSubMenuIndex = 0;
  renderSkillSubMenu();
}

function closeSkillSubMenu() {
  skillSubMenuActive = false;
  // 元のコマンドグリッドを復元
  renderCombatCommands();
  updateCombatMenu();
}

function renderSkillSubMenu() {
  const p = G.player;
  const cmds = p.skillCommands || [];
  const grid = document.getElementById('battle-commands');

  // スキル行 + キャンセル行をコマンドグリッドに上書き描画
  const rows = cmds.map((id, idx) => {
    const sc = SKILL_COMMANDS[id];
    if (!sc) return '';
    const sel = idx === skillSubMenuIndex ? 'selected' : '';
    const noMp = p.mp < sc.mpCost ? 'skl-no-mp' : '';
    return `<div class="battle-command ${sel} ${noMp}" onclick="selectSkillSubRow(${idx})">
      <span class="bcmd-arrow">▶</span>
      <span class="bcmd-text">${sc.icon} ${sc.name} <span style="color:var(--blue);font-size:6px">MP${sc.mpCost}</span></span>
    </div>`;
  });

  // キャンセル
  const cancelIdx = cmds.length;
  const cancelSel = skillSubMenuIndex === cancelIdx ? 'selected' : '';
  rows.push(`<div class="battle-command ${cancelSel}" onclick="selectSkillSubRow(${cancelIdx})" style="border-color:#3a1a1a">
    <span class="bcmd-arrow" style="color:var(--red)">▶</span>
    <span class="bcmd-text" style="color:var(--red)">↩ もどる</span>
  </div>`);

  grid.innerHTML = rows.join('');
}

// 元のコマンドグリッドを再描画する関数
function renderCombatCommands() {
  const grid = document.getElementById('battle-commands');
  grid.innerHTML = `
    <div class="battle-command" data-cmd="atk" onclick="clickCombatCmd(0)">
      <span class="bcmd-arrow">▶</span><span class="bcmd-text">たたかう</span>
    </div>
    <div class="battle-command" data-cmd="mag" onclick="clickCombatCmd(1)">
      <span class="bcmd-arrow">▶</span><span class="bcmd-text">スキル</span>
    </div>
    <div class="battle-command" data-cmd="itm" onclick="clickCombatCmd(2)">
      <span class="bcmd-arrow">▶</span><span class="bcmd-text">アイテム</span>
    </div>
    <div class="battle-command" data-cmd="run" onclick="clickCombatCmd(3)">
      <span class="bcmd-arrow">▶</span><span class="bcmd-text">にげる</span>
    </div>`;
}

function clickCombatCmd(idx) {
  combatMenuIndex = idx;
  updateCombatMenu();
  executeSelectedCommand();
}
function selectSkillSubRow(idx) {
  skillSubMenuIndex = idx;
  renderSkillSubMenu();
  executeSkillSubMenu();
}

function executeSkillSubMenu() {
  const p = G.player;
  const cmds = p.skillCommands || [];

  if (skillSubMenuIndex >= cmds.length) {
    closeSkillSubMenu();
    return;
  }

  const skillId = cmds[skillSubMenuIndex];
  const skill = SKILL_COMMANDS[skillId];
  if (!skill) { closeSkillSubMenu(); return; }

  if (p.mp < skill.mpCost) {
    log(`MPが足りない！（必要MP:${skill.mpCost}）`, 'warn');
    return;
  }

  // magExtraCost適用
  const extraCost = p.passives.magExtraCost || 0;
  const totalCost = skill.mpCost + extraCost;
  if (p.mp < totalCost) {
    log(`MPが足りない！（必要MP:${totalCost}）`, 'warn');
    return;
  }
  p.mp -= totalCost;
  // スキル弱体適用
  const skillBoostMult = p.passives._skillWeakened ? 0.5 : 1;
  // magBoost適用（実行前に一時的にATKを底上げする形で反映）
  const boost = (p.passives.magBoost || 1) * skillBoostMult;
  const origAtk = p.atk;
  if (boost !== 1) p.atk = Math.floor(p.atk * boost);

  const dmg = skill.execute(p, G.currentEnemy);
  p.atk = origAtk; // ATKを元に戻す

  if (skill.mpCost >= 4) {
  const flashColor =
    skill.id.includes('fire')  ? '#ff4400' :
    skill.id.includes('ice')   ? '#88ccff' :
    skill.id.includes('holy') || skill.id.includes('divine') ? '#f5c842' :
    skill.id.includes('dark') || skill.id.includes('soul')   ? '#8844ff' :
    '#b06aff';
  triggerSkillFlash(flashColor);
}

  // magDrain適用
  if (p.passives.magDrain && dmg > 0) {
    const drain = Math.floor(dmg * p.passives.magDrain);
    p.mp = Math.min(p.mp + drain, p.maxMp);
    if (drain > 0) {
      spawnPopup(G.px, G.py, `+${drain}MP`, '#4488ff');
      log(`MP${drain}吸収！`, 'good');
    }
  }

  closeSkillSubMenu();

  const e = G.currentEnemy;
  if (!e || e.hp <= 0) {
    if (e) {
      if (G.secondEnemy && G.secondEnemy.hp > 0) {
        G.enemies = G.enemies.filter(en => en !== e);
        G.currentEnemy.locked = false;
        G.currentEnemy = G.secondEnemy;
        G.secondEnemy = null;
        document.getElementById('enemy-name').textContent = G.currentEnemy.name;
        document.getElementById('enemy-type-badge').textContent = '';
        drawEnemySprite(G.currentEnemy);
        log(`${e.name}を倒した！ 次は${G.currentEnemy.name}だ！`, 'good');
        const p = G.player;
        p.exp += e.exp;
        const luckMult = 1 + (p.passives.luck || 0);
        p.gold += Math.floor((e.gold + Math.floor(Math.random() * e.gold)) * luckMult);
        p.kills++;
        levelCheck(); updateEnemyBar(); updateUI();
      } else {
        defeatEnemy(e);
      }
    }
    return;
  }

  updateEnemyBar();
  doEnemyAttack(e);
  updateBattlePlayerBars();
  renderAll();
  updateUI();
}

// スキルサブメニュー用キーボード（captureフェーズ）
document.addEventListener('keydown', function (e) {
  if (!skillSubMenuActive) return;
  const p = G.player;
  const maxIdx = (p.skillCommands ? p.skillCommands.length : 0);

  if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
    e.preventDefault(); e.stopPropagation();
    skillSubMenuIndex = (skillSubMenuIndex - 1 + maxIdx + 1) % (maxIdx + 1);
    renderSkillSubMenu();
  } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
    e.preventDefault(); e.stopPropagation();
    skillSubMenuIndex = (skillSubMenuIndex + 1) % (maxIdx + 1);
    renderSkillSubMenu();
  } else if (e.key === 'Enter' || e.key === 'f' || e.key === 'F') {
    e.preventDefault(); e.stopPropagation();
    executeSkillSubMenu();
  } else if (e.key === 'Escape' || e.key === 'x' || e.key === 'X') {
    e.preventDefault(); e.stopPropagation();
    closeSkillSubMenu();
  }
}, true);

// tryMove に skillSubMenu ガードを追加
(function () {
  const _origMove = tryMove;
  tryMove = function (dx, dy) {
    if (skillSubMenuActive) return;
    _origMove(dx, dy);
    // ハードモードのダメージ床
    if (G.mode === 'hard' && G.floor >= 10 && G.map && G.player && !G.inCombat) {
      const tile = G.map[G.py][G.px];
      if (tile === TILE_FLOOR) {
        // 部屋の中かどうか判定
        const inRoom = G.rooms.some(r =>
          G.px >= r.x && G.px < r.x + r.w &&
          G.py >= r.y && G.py < r.y + r.h
        );
        if (!inRoom) {
          G.player.hp -= 1;
          spawnPopup(G.px, G.py, '-1', '#ff4444');
          if (G.player.hp <= 0) {
            gameOver();
            return;
          }
          updateUI();
        }
      }
    }
  };
})();

document.addEventListener("touchstart", (e) => {
  const x = e.touches[0].clientX;
  const y = e.touches[0].clientY;

  console.log(x, y);
});

function openLibrary() {
  const clears = JSON.parse(localStorage.getItem('dungeon_clears') || '[]');
  const list = document.getElementById('library-list');
  const detail = document.getElementById('library-detail');
  detail.style.display = 'none';
  list.style.display = 'block';

  if (clears.length === 0) {
    list.innerHTML = '<div style="color:#444;font-size:9px;text-align:center;padding:20px">クリア履歴がありません</div>';
  } else {
    list.innerHTML = clears.map((c, i) => `
      <div class="library-card" onclick="openLibraryDetail(${i})">
        <span class="lib-icon">${c.classIcon}</span>
        <div class="lib-info">
          <div class="lib-name">${c.isDarkWarrior ? '🖤魔剣士' : c.className} &nbsp;<span style="color:#f5c842">LV${c.lv}</span></div>
          <div class="lib-sub">${c.date} &nbsp;|&nbsp; ${c.floor}F &nbsp;|&nbsp; ${c.kills}体撃破 &nbsp;|&nbsp; ${c.gold}G</div>
        </div>
        <span class="lib-arrow">▶</span>
      </div>
    `).join('');
  }
  document.getElementById('library-modal').classList.add('active');
}

function closeLibrary() {
  document.getElementById('library-modal').classList.remove('active');
}

function openLibraryDetail(idx) {
  const clears = JSON.parse(localStorage.getItem('dungeon_clears') || '[]');
  const c = clears[idx];
  if (!c) return;

  document.getElementById('library-list').style.display = 'none';
  const detail = document.getElementById('library-detail');
  detail.style.display = 'block';

  document.getElementById('library-detail-title').innerHTML = `
    <div style="font-size:11px;color:#f5c842;margin-bottom:8px">${c.classIcon} ${c.isDarkWarrior ? '🖤魔剣士' : c.className} &nbsp; LV${c.lv}</div>
    <div style="font-size:8px;color:#888;margin-bottom:16px">${c.date} &nbsp;|&nbsp; ${c.floor}F &nbsp;|&nbsp; ${c.kills}体撃破 &nbsp;|&nbsp; ${c.gold}G</div>
  `;

  document.getElementById('library-detail-skills').innerHTML = c.skills.length === 0
    ? '<div style="color:#444;font-size:8px">スキルなし</div>'
    : c.skills.map(s => `
        <div class="lib-skill-tag">
          ${s.icon} ${s.name}
          <span class="lib-skill-type">${s.type === 'class' ? '固有' : s.type === 'passive' ? 'P' : s.type === 'active' ? 'A' : '強化'}</span>
        </div>
      `).join('');
}

function closeLibraryDetail() {
  document.getElementById('library-detail').style.display = 'none';
  document.getElementById('library-list').style.display = 'block';
}
function switchRTab(tab) {
  document.getElementById('rtab-equip').style.display = tab === 'equip' ? 'block' : 'none';
  document.getElementById('rtab-skills').style.display = tab === 'skills' ? 'block' : 'none';
  document.getElementById('rtab-items').style.display = tab === 'items' ? 'block' : 'none';
  document.querySelectorAll('.rtab').forEach((el, i) => {
    el.classList.toggle('active', ['equip', 'skills', 'items'][i] === tab);
  });
}

let combatLogOpen = false;

function toggleCombatLog() {
  combatLogOpen = !combatLogOpen;
  const logBox = document.getElementById('log-box');
  const arrow = document.getElementById('combat-log-arrow');
  if (logBox) logBox.classList.toggle('combat-overlay', combatLogOpen);
  if (arrow) arrow.textContent = combatLogOpen ? '▼' : '▲';
  if (combatLogOpen && logBox) logBox.scrollTop = logBox.scrollHeight;
}

(function () {
  const _orig = startCombat;
  startCombat = function (...args) {
    _orig(...args);
    const toggle = document.getElementById('combat-log-toggle');
    const logBox = document.getElementById('log-box');
    const arrow = document.getElementById('combat-log-arrow');
    if (toggle) toggle.classList.add('active');
    combatLogOpen = false;
    if (logBox) logBox.classList.remove('combat-overlay');
    if (arrow) arrow.textContent = '▲';
  };
})();

(function () {
  const _orig = endCombat;
  endCombat = function (...args) {
    _orig(...args);
    const toggle = document.getElementById('combat-log-toggle');
    const logBox = document.getElementById('log-box');
    const arrow = document.getElementById('combat-log-arrow');
    if (logBox) logBox.classList.remove('combat-overlay');
    if (toggle) toggle.classList.remove('active');
    if (arrow) arrow.textContent = '▲';
    combatLogOpen = false;
  };
})();

document.addEventListener('keydown', function (e) {
  if (e.key === 'Tab') {
    e.preventDefault();
    if (G.inCombat) toggleCombatLog();
  }
});

// Combat log controls are intentionally centralized here because the log button
// was duplicated in older HTML, which made getElementById point at the wrong UI.
function setCombatLogOpen(open) {
  combatLogOpen = open;
  const logBox = document.getElementById('log-box');
  if (logBox) {
    logBox.classList.toggle('combat-overlay', open);
    if (open) logBox.scrollTop = logBox.scrollHeight;
  }
  document.querySelectorAll('#combat-log-toggle').forEach(toggle => {
    toggle.classList.toggle('open', open);
  });
  document.querySelectorAll('#combat-log-arrow').forEach(arrow => {
    arrow.textContent = open ? '▼' : '▲';
  });
}

toggleCombatLog = function () {
  setCombatLogOpen(!combatLogOpen);
};

(function () {
  const _startCombatWithLog = startCombat;
  startCombat = function (...args) {
    _startCombatWithLog(...args);
    document.querySelectorAll('#combat-log-toggle').forEach(toggle => {
      toggle.classList.add('active');
    });
    setCombatLogOpen(false);
  };
})();

(function () {
  const _endCombatWithLog = endCombat;
  endCombat = function (...args) {
    _endCombatWithLog(...args);
    setCombatLogOpen(false);
    document.querySelectorAll('#combat-log-toggle').forEach(toggle => {
      toggle.classList.remove('active');
    });
  };
})();

document.addEventListener('keydown', function (e) {
  if (e.key !== 'Tab') return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (G.inCombat) toggleCombatLog();
}, true);
