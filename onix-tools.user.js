// ==UserScript==
// @name         TribalWars - Onix Tools
// @namespace    http://tampermonkey.net/
// @version      1.9.16
// @description  Onix Tools
// @author       korba4
// @match        https://*.tribalwars.com.br/*
// @match        http://*.tribalwars.com.br/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/eduardo77L/onix-tools/main/onix-tools.user.js
// @downloadURL  https://raw.githubusercontent.com/eduardo77L/onix-tools/main/onix-tools.user.js
// ==/UserScript==

(function () {
  "use strict";

  const ROOT_ID  = "onix-root";
  const API_BASE = "https://tm-backend-y9wi.onrender.com";

  if (document.getElementById(ROOT_ID)) return;

  function getTribeTag() {
    try {
      if (window.game_data && game_data.player)
        return game_data.player.ally ? String(game_data.player.ally) : null;
    } catch (e) {}
    return null;
  }

  function getCurrentVillageId() {
    try {
      if (window.game_data && game_data.village) return game_data.village.id;
    } catch (e) {}
    return null;
  }

  async function checkLicense() {
    const tribeTag = getTribeTag();
    if (!tribeTag) return { valid: false, reason: "no_tribe" };
    try {
      const res  = await fetch(`${API_BASE}/license/check?tag=${encodeURIComponent(tribeTag)}`);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      return { ...data, tribeTag };
    } catch (e) {
      return { valid: false, reason: "network_error", tribeTag };
    }
  }

  const VILLAGE_BUILDING_POP_BONUS = 3600;

  function parseMembersFromDoc(doc) {
    const select = doc.querySelector('select[name="player_id"]');
    if (!select) return null;
    const members = [];
    select.querySelectorAll("option").forEach((opt) => {
      const id   = (opt.value || "").trim();
      const name = opt.textContent.trim();
      if (id && name && name !== "Selecionar membro" && name !== "") {
        members.push({ id, name });
      }
    });
    return members.length > 0 ? members : null;
  }

  function getMembersFromSelect() {
    return parseMembersFromDoc(document);
  }

  async function getMembersListForTroops(villageId) {
    const fromDom = getMembersFromSelect();
    if (fromDom) return fromDom;

    const modes = ["members_troops", "members_defense", "members"];
    for (const mode of modes) {
      try {
        const url  = `/game.php?village=${encodeURIComponent(villageId)}&screen=ally&mode=${mode}`;
        const res  = await fetch(url);
        const html = await res.text();
        const doc  = new DOMParser().parseFromString(html, "text/html");
        const parsed = parseMembersFromDoc(doc);
        if (parsed) return parsed;
      } catch (e) {
        console.error("Onix: falha ao listar membros", mode, e);
      }
    }
    return null;
  }

  const UNIT_ITEM_CLASS_MAP = {
    spear:    "spearman",
    sword:    "swordsman",
    axe:      "axeman",
    spy:      "scout",
    archer:   "archer",
    light:    "lightCavalry",
    marcher:  "mountedArcher",
    heavy:    "heavyCavalry",
    ram:      "ram",
    catapult: "catapult",
    knight:   "knight",
    snob:     "snob",
    militia:  "militia",
  };

  function thToTroopColumnKey(th) {
    const mClass = /unit-item-([a-z0-9_]+)/i.exec(th.className || "");
    if (mClass) {
      const key = UNIT_ITEM_CLASS_MAP[mClass[1].toLowerCase()];
      if (key) return key;
    }
    const img = th.querySelector("img[src]");
    if (!img) return null;
    const src = img.getAttribute("src") || "";
    const m = /unit_(spear|sword|axe|spy|archer|light|heavy|marcher|ram|catapult|knight|snob|militia)\.(?:webp|png|gif)/i.exec(src);
    if (!m) return null;
    return UNIT_ITEM_CLASS_MAP[m[1].toLowerCase()] || null;
  }

  function findTroopTable(doc) {
    let best = null;
    let bestScore = -1;
    doc.querySelectorAll("table").forEach((t) => {
      const villageLinksCount = t.querySelectorAll('td a[href*="info_village"]').length;
      if (villageLinksCount > bestScore) {
        bestScore = villageLinksCount;
        best = t;
      }
    });
    return best;
  }

  function findMembersTroopsTable(doc) {
    const t = doc.querySelector("table.vis.w100");
    if (t && t.querySelector("th") && t.querySelector('td a[href*="info_village"]')) return t;
    return findTroopTable(doc);
  }

  function emptyTroops() {
    return {
      spearman: 0, swordsman: 0, axeman: 0, scout: 0, archer: 0,
      lightCavalry: 0, mountedArcher: 0, heavyCavalry: 0,
      ram: 0, catapult: 0, knight: 0, snob: 0, militia: 0,
    };
  }

  function getUnitKeysFromTable(table) {
    const keysByIndex = {};
    const headerRow = Array.from(table.querySelectorAll("tr")).find((tr) =>
      Array.from(tr.querySelectorAll("th")).some((th) => thToTroopColumnKey(th) !== null),
    );
    if (!headerRow) return keysByIndex;

    headerRow.querySelectorAll("th").forEach((th) => {
      const key = thToTroopColumnKey(th);
      if (key) keysByIndex[th.cellIndex] = key;
    });
    return keysByIndex;
  }

  function parseMembersTroopsHtml(html, memberId, memberName) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const table = findMembersTroopsTable(doc);
    if (!table) return [];

    const keysByIndex = getUnitKeysFromTable(table);
    if (Object.keys(keysByIndex).length === 0) return [];

    const out = [];
    table.querySelectorAll("tr").forEach((row) => {
      const link = row.querySelector('td a[href*="info_village"]');
      if (!link) return;
      const linkText = (link.textContent || "").trim();
      const coordMatch = linkText.match(/\d{1,3}\|\d{1,3}/);
      const coord = coordMatch ? coordMatch[0] : linkText;
      const troops = emptyTroops();
      row.querySelectorAll("td").forEach((td) => {
        const key = keysByIndex[td.cellIndex];
        if (!key) return;
        const raw = (td.textContent || "").replace(/[^\d-]/g, "");
        const val = parseInt(raw || "0", 10);
        troops[key] = Number.isFinite(val) ? val : 0;
      });
      out.push({ villageCoord: coord, memberId, memberName, troops });
    });
    return out;
  }

  async function fetchMembersTroopsHtml(villageId, playerId) {
    const qs =
      playerId != null && playerId !== ""
        ? `village=${encodeURIComponent(villageId)}&screen=ally&mode=members_troops&player_id=${encodeURIComponent(playerId)}`
        : `village=${encodeURIComponent(villageId)}&screen=ally&mode=members_troops`;
    const res = await fetch(`/game.php?${qs}`);
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.text();
  }

  /**
   * Custos de população por unidade (milícia não consome pop neste cálculo).
   * Lanceiro, espada, bárbaro, arqueiro: 1 · Scout: 2 · Cav. leve: 4 · Cav. arqueira: 5 · Cav. pesada: 6 · Aríete: 5 · Catapulta: 8 · Paladino: 10 · Nobre: 100
   */
  function troopsPopulationCost(troops) {
    const t = troops || {};
    return (
      (t.spearman || 0) * 1 +
      (t.swordsman || 0) * 1 +
      (t.archer || 0) * 1 +
      (t.axeman || 0) * 1 +
      (t.scout || 0) * 2 +
      (t.lightCavalry || 0) * 4 +
      (t.mountedArcher || 0) * 5 +
      (t.heavyCavalry || 0) * 6 +
      (t.ram || 0) * 5 +
      (t.catapult || 0) * 8 +
      (t.knight || 0) * 10 +
      (t.snob || 0) * 100 +
      (t.militia || 0) * 0
    );
  }

  function sumTroopUnitCount(troops) {
    const t = troops || emptyTroops();
    let n = 0;
    Object.keys(emptyTroops()).forEach((k) => { n += t[k] || 0; });
    return n;
  }

  /** Pop usada por aldeia: 3600 + tropas (dados da aba Tribo → Membros → Tropas, incluindo fora da aldeia). */
  function villageUsedPopFromTotals(troops) {
    return VILLAGE_BUILDING_POP_BONUS + troopsPopulationCost(troops);
  }

  const FULL_POP_MIN = 22000;

  /**
   * Full Ataque: pop > 22k · bárbaros > 1000 · cav leve ≥ 500 · nobres = 0 · aríetes < 400
   * Full Defesa: pop > 22k · lanças > 500 · espadas > 500
   * Papa: pop > 22k · bárbaros > 500 · cav leve ≥ 500 · aríetes > 400
   */
  function classifyMemberTroopsRow(troops) {
    const t = troops || emptyTroops();
    const pop = villageUsedPopFromTotals(t);
    const spear = t.spearman || 0;
    const sword = t.swordsman || 0;
    const axe = t.axeman || 0;
    const light = t.lightCavalry || 0;
    const nob = t.snob || 0;
    const ram = t.ram || 0;

    const fullAtk =
      pop > FULL_POP_MIN &&
      axe > 1000 &&
      light >= 500 &&
      nob === 0 &&
      ram < 400;
    const fullDef =
      pop > FULL_POP_MIN &&
      spear > 500 &&
      sword > 500;
    const papaStrike =
      pop > FULL_POP_MIN &&
      axe > 500 &&
      light >= 500 &&
      ram > 400;

    return {
      pop,
      popTroopCost: troopsPopulationCost(t),
      unitCount: sumTroopUnitCount(t),
      total: t,
      fullAtk,
      fullDef,
      papaStrike,
    };
  }

  function analyzeVillageRecords(records) {
    const villages = records.length;
    let popTroopSum = 0;
    let popTotalSum = 0;
    let unitSum = 0;
    let fullAtk = 0;
    let fullDef = 0;
    let papaStrike = 0;
    let nobSum = 0;

    records.forEach((rec) => {
      const c = classifyMemberTroopsRow(rec.troops);
      popTroopSum += c.popTroopCost;
      popTotalSum += c.pop;
      unitSum += c.unitCount;
      nobSum += rec.troops.snob || 0;
      if (c.fullAtk) fullAtk++;
      if (c.fullDef) fullDef++;
      if (c.papaStrike) papaStrike++;
    });

    const sample = [];
    records.forEach((rec) => {
      const c = classifyMemberTroopsRow(rec.troops);
      const near = c.pop > FULL_POP_MIN - 4000 && c.pop < FULL_POP_MIN + 8000;
      if (c.fullAtk || c.fullDef || c.papaStrike || near) {
        const t = c.total;
        sample.push({
          coord: rec.villageCoord,
          pop: c.pop,
          fullAtk: c.fullAtk,
          fullDef: c.fullDef,
          papa: c.papaStrike,
          spear: t.spearman || 0,
          sword: t.swordsman || 0,
          axe: t.axeman || 0,
          light: t.lightCavalry || 0,
          ram: t.ram || 0,
          nob: t.snob || 0,
        });
      }
    });
    sample.sort((a, b) => b.pop - a.pop);

    const lines = [];
    lines.push(`Onix Tropas (members_troops) — aldeias: ${villages} · pop/aldeia: ${VILLAGE_BUILDING_POP_BONUS} + custo tropas · limite Full: >${FULL_POP_MIN}`);
    lines.push("coord | pop | FA | FD | P | lan esp bar cl ari nob");
    sample.slice(0, 50).forEach((r) => {
      lines.push(
        `${r.coord} | ${r.pop} | ${r.fullAtk ? "sim" : "não"} | ${r.fullDef ? "sim" : "não"} | ${r.papa ? "sim" : "não"} | ` +
        `${r.spear} ${r.sword} ${r.axe} ${r.light} ${r.ram} ${r.nob}`,
      );
    });
    if (sample.length === 0) lines.push("(nenhuma aldeia no recorte de debug)");

    const debugText = lines.join("\n");
    console.info("[Onix Tropas members_troops]", { villages, fullAtk, fullDef, papaStrike, popTotalSum });

    return {
      villages,
      popTroopSum,
      popTotalSum,
      unitSum,
      fullAtk,
      fullDef,
      papaStrike,
      nobSum,
      debugText,
    };
  }

  function formatTribeTroopsSummary(tribe) {
    return (
      `Fonte: Tribo → Membros → Tropas (fetch no jogo, inclui tropas fora da aldeia)\n` +
      `Membros analisados: ${tribe.memberCount} · Aldeias: ${tribe.villages}\n` +
      `Full Ataques (aldeias): ${tribe.fullAtk}\n` +
      `Full Defesas (aldeias): ${tribe.fullDef}\n` +
      `Papa Strikes (aldeias): ${tribe.papaStrike}`
    );
  }

  function renderMemberTroopsCard(name, a) {
    return `
      <div class="onix-troops-member-head">${name}</div>
      <div class="onix-troops-cards">
        <div class="onix-card">
          <div class="onix-card-title">Resumo</div>
          <div class="onix-card-sub">3600 + custo de tropas por aldeia (aba Tropas da tribo)</div>
          <div class="onix-card-row"><span>Aldeias</span><span class="value">${a.villages}</span></div>
          <div class="onix-card-row"><span>Pop. total (soma)</span><span class="value">${a.popTotalSum.toLocaleString("pt-BR")}</span></div>
          <div class="onix-card-row"><span>Tropas (soma unidades)</span><span class="value">${a.unitSum.toLocaleString("pt-BR")}</span></div>
          <div class="onix-card-row"><span>Nobres (total)</span><span class="value">${a.nobSum.toLocaleString("pt-BR")}</span></div>
          <div class="onix-card-row"><span>Full Ataques</span><span class="value">${a.fullAtk}</span></div>
          <div class="onix-card-row"><span>Full Defesas</span><span class="value">${a.fullDef}</span></div>
          <div class="onix-card-row"><span>Papa Strikes</span><span class="value">${a.papaStrike}</span></div>
        </div>
      </div>
      <label class="onix-debug-label">Debug (amostra)</label>
      <textarea id="onix-member-debug" class="onix-troops-debug" readonly spellcheck="false"></textarea>`;
  }

  function wireTroopsAnalysisSelect(state, selectEl, infoEl, tribeSummaryEl) {
    selectEl.innerHTML = "";
    if (tribeSummaryEl) tribeSummaryEl.value = formatTribeTroopsSummary(state.tribe);

    if (!state.members || state.members.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Nenhum membro analisado";
      selectEl.appendChild(opt);
      infoEl.innerHTML = "";
      return;
    }

    const def = document.createElement("option");
    def.value = "";
    def.textContent = "Selecione um membro";
    selectEl.appendChild(def);

    state.members
      .slice()
      .sort((a, b) => (a.memberName || "").localeCompare(b.memberName || "", "pt-BR"))
      .forEach((m) => {
        const opt = document.createElement("option");
        opt.value = String(m.memberId);
        opt.textContent = `${m.memberName} (${m.records.length} aldeias)`;
        selectEl.appendChild(opt);
      });

    infoEl.innerHTML = "";
    selectEl.onchange = () => {
      const id = selectEl.value;
      if (!id) {
        infoEl.innerHTML = "";
        return;
      }
      const m = state.members.find((x) => String(x.memberId) === id);
      if (!m) {
        infoEl.innerHTML = "";
        return;
      }
      infoEl.innerHTML = renderMemberTroopsCard(m.memberName, m.analyze);
      const dbg = infoEl.querySelector("#onix-member-debug");
      if (dbg) dbg.value = m.analyze.debugText;
    };
  }

  function waitForBody(cb) {
    if (document.body) return cb();
    const obs = new MutationObserver(() => {
      if (document.body) { obs.disconnect(); cb(); }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  }

  async function getVillageIdByCoord(coord) {
    try {
      const res  = await fetch(`/game.php?screen=api&ajax=target_selection&input=${coord}`);
      const data = await res.json();
      if (data && data.villages && data.villages.length > 0) {
        return data.villages[0].id;
      }
    } catch (e) {}
    return null;
  }

  async function fetchCommandsForVillage(villageId) {
    try {
      const res  = await fetch(`/game.php?village=${villageId}&screen=overview`);
      const html = await res.text();
      const doc  = new DOMParser().parseFromString(html, "text/html");
      const commands = [];
      doc.querySelectorAll('#show_incoming_units tr.command-row').forEach(tr => {
        const typeImg = tr.querySelector('td:first-child img');
        if (!typeImg) return;
        const src = typeImg.getAttribute('src') || '';
        let type = 'peq';
        if (src.includes('attack_medium')) type = 'med';
        else if (src.includes('attack_large')) type = 'grd';
        else if (src.includes('snob')) type = 'nob';

        const playerLink = tr.querySelector('td:nth-child(3) a');
        const player = playerLink ? playerLink.textContent.trim() : 'Desconhecido';
        commands.push({ type, player });
      });
      return commands;
    } catch (e) {
      return [];
    }
  }

  async function processOpVerification(coords, btn, resultsContainer, countReturns) {
    btn.disabled = true;
    btn.textContent = "Verificando...";
    resultsContainer.innerHTML = "<p style='color:#cbd5e1;'>Buscando dados...</p>";

    const allResults = {};
    for (const coord of coords) {
      const vid = await getVillageIdByCoord(coord);
      if (vid) {
        const cmds = await fetchCommandsForVillage(vid);
        cmds.forEach(c => {
          if (!allResults[c.player]) allResults[c.player] = { peq: 0, med: 0, grd: 0, nob: 0 };
          allResults[c.player][c.type]++;
        });
      }
      await new Promise(r => setTimeout(r, 300));
    }

    resultsContainer.innerHTML = "";
    const players = Object.keys(allResults).sort();
    if (players.length === 0) {
      resultsContainer.innerHTML = "<p style='color:#94a3b8;'>Nenhum ataque encontrado nestas coordenadas.</p>";
    } else {
      players.forEach(p => {
        const r = allResults[p];
        const div = document.createElement("div");
        div.className = "onix-result-item";
        div.innerHTML = `
          <div class="player-name">${p}</div>
          <div class="badges">
            <span class="badge badge-peq">Peq: ${r.peq}</span>
            <span class="badge badge-med">Méd: ${r.med}</span>
            <span class="badge badge-grd">Grd: ${r.grd}</span>
            <span class="badge badge-nob">Nob: ${r.nob}</span>
          </div>
        `;
        resultsContainer.appendChild(div);
      });
    }
    btn.disabled = false;
    btn.textContent = "Verificar OP";
  }

  function createApp() {
    const style = document.createElement("style");
    style.textContent = `
      #onix-root { position: fixed; z-index: 999999; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
      #onix-btn-open { position: fixed; bottom: 20px; left: 20px; background: #0f172a; color: #00e5ff; border: 2px solid #00e5ff; border-radius: 8px; padding: 10px 16px; font-weight: bold; cursor: pointer; box-shadow: 0 4px 12px rgba(0,229,255,0.2); transition: all 0.2s; }
      #onix-btn-open:hover { background: #00e5ff; color: #0f172a; }
      #onix-overlay { display: none; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.7); backdrop-filter: blur(4px); align-items: center; justify-content: center; }
      #onix-overlay.show { display: flex; }
      #onix-modal { background: #0f172a; width: 800px; max-width: 95vw; height: 600px; max-height: 90vh; border-radius: 12px; border: 1px solid #1e293b; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
      .onix-header { background: #1e293b; padding: 16px 24px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; }
      .onix-header h2 { margin: 0; color: #f8fafc; font-size: 18px; display: flex; align-items: center; gap: 8px; }
      .onix-header h2 span { color: #00e5ff; }
      .onix-close { background: transparent; border: none; color: #94a3b8; font-size: 24px; cursor: pointer; transition: color 0.2s; }
      .onix-close:hover { color: #ef4444; }
      .onix-tabs { display: flex; background: #1e293b; border-bottom: 1px solid #334155; }
      .onix-tab-btn { flex: 1; background: transparent; border: none; color: #94a3b8; padding: 12px; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s; border-bottom: 2px solid transparent; }
      .onix-tab-btn:hover:not(.locked) { color: #f8fafc; background: #334155; }
      .onix-tab-btn.active { color: #00e5ff; border-bottom-color: #00e5ff; background: #0f172a; }
      .onix-tab-btn.locked { opacity: 0.5; cursor: not-allowed; }
      .onix-content { flex: 1; overflow-y: auto; padding: 24px; color: #cbd5e1; }
      .onix-tab-pane { display: none; }
      .onix-tab-pane.active { display: block; }
      .onix-license-box { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 20px; text-align: center; }
      .onix-license-box h3 { margin: 0 0 12px 0; color: #f8fafc; }
      .onix-license-status-ok { color: #22c55e; font-weight: bold; font-size: 16px; }
      .onix-license-status-err { color: #ef4444; font-weight: bold; font-size: 16px; }
      .onix-form-group { margin-bottom: 16px; }
      .onix-form-group label { display: block; margin-bottom: 8px; color: #94a3b8; font-size: 13px; }
      .onix-textarea { width: 100%; height: 100px; background: #1e293b; border: 1px solid #334155; border-radius: 6px; color: #f8fafc; padding: 12px; font-family: monospace; resize: vertical; outline: none; }
      .onix-textarea:focus { border-color: #00e5ff; }
      .onix-checkbox-label { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #cbd5e1; cursor: pointer; }
      .onix-actions { display: flex; gap: 12px; margin-top: 16px; }
      .onix-btn { background: #334155; color: #f8fafc; border: none; border-radius: 6px; padding: 10px 20px; font-weight: 600; cursor: pointer; transition: background 0.2s; }
      .onix-btn:hover { background: #475569; }
      .onix-btn-primary { background: #00e5ff; color: #0f172a; }
      .onix-btn-primary:hover { background: #00c8e0; }
      .onix-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .onix-results { margin-top: 24px; display: grid; gap: 12px; }
      .onix-result-item { background: #1e293b; border: 1px solid #334155; border-radius: 6px; padding: 12px; display: flex; justify-content: space-between; align-items: center; }
      .onix-result-item .player-name { font-weight: bold; color: #f8fafc; }
      .onix-result-item .badges { display: flex; gap: 8px; }
      .badge { padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
      .badge-peq { background: rgba(34,197,94,0.2); color: #4ade80; }
      .badge-med { background: rgba(234,179,8,0.2); color: #facc15; }
      .badge-grd { background: rgba(239,68,68,0.2); color: #f87171; }
      .badge-nob { background: rgba(168,85,247,0.2); color: #c084fc; }
      .onix-troops-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; background: #1e293b; padding: 16px; border-radius: 8px; border: 1px solid #334155; }
      .onix-troops-header-left { display: flex; flex-direction: column; gap: 4px; }
      .onix-troops-status { font-size: 13px; color: #94a3b8; }
      .onix-troops-last-update { font-size: 12px; color: #64748b; }
      .onix-select { background: #1e293b; border: 1px solid #334155; color: #f8fafc; padding: 10px; border-radius: 6px; width: 100%; outline: none; margin-bottom: 20px; font-size: 14px; }
      .onix-select:focus { border-color: #00e5ff; }
      .onix-troops-member-head { font-size: 18px; font-weight: bold; color: #f8fafc; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 1px solid #334155; }
      .onix-troops-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
      .onix-card { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 16px; }
      .onix-card-title { font-weight: bold; color: #00e5ff; margin-bottom: 4px; font-size: 15px; }
      .onix-card-sub { font-size: 11px; color: #64748b; margin-bottom: 12px; line-height: 1.3; }
      .onix-card-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px; color: #cbd5e1; border-bottom: 1px dashed #334155; padding-bottom: 4px; }
      .onix-card-row:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
      .onix-card-row .value { font-weight: bold; color: #f8fafc; }
      .onix-progress-container { width: 100%; background: #334155; border-radius: 4px; height: 6px; margin-top: 8px; overflow: hidden; display: none; }
      .onix-progress-bar { height: 100%; background: #00e5ff; width: 0%; transition: width 0.3s; }
      .onix-criteria-box { background: #0f172a; border: 1px solid #1e293b; border-radius: 6px; padding: 12px; margin-bottom: 16px; font-size: 12px; color: #94a3b8; }
      .onix-criteria-box strong { color: #cbd5e1; }
      .onix-debug-label { display: block; margin-top: 16px; margin-bottom: 6px; font-size: 12px; color: #94a3b8; }
      .onix-troops-debug { width: 100%; min-height: 140px; max-height: 220px; resize: vertical; background: #020617; border: 1px solid #334155; border-radius: 6px; color: #e2e8f0; padding: 10px; font-family: ui-monospace, Consolas, monospace; font-size: 11px; line-height: 1.35; box-sizing: border-box; }
    `;
    document.head.appendChild(style);

    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.innerHTML = `
      <button id="onix-btn-open">Onix Tools</button>
      <div id="onix-overlay">
        <div id="onix-modal">
          <div class="onix-header">
            <h2><span>⚡</span> Onix Tools</h2>
            <button class="onix-close">&times;</button>
          </div>
          <div class="onix-tabs">
            <button class="onix-tab-btn active" data-tab="licenca">Licença</button>
            <button class="onix-tab-btn locked" data-tab="verificar">Verificar OP</button>
            <button class="onix-tab-btn locked" data-tab="tropas">Verificar Tropas</button>
          </div>
          <div class="onix-content">
            <div id="tab-licenca" class="onix-tab-pane active">
              <div class="onix-license-box" id="onix-license-info">
                <h3>Status da Licença</h3>
                <p>Verificando...</p>
              </div>
            </div>
            <div id="tab-verificar" class="onix-tab-pane">
              <div class="onix-form-group">
                <label>Coordenadas (cole o texto, o script extrai automaticamente)</label>
                <textarea id="onix-coords-input" class="onix-textarea" placeholder="Ex: 555|666 444|333"></textarea>
              </div>
              <div class="onix-form-group">
                <label class="onix-checkbox-label">
                  <input type="checkbox" id="onix-check-returns">
                  Contar retornos (ataques voltando)
                </label>
              </div>
              <div class="onix-actions">
                <button id="onix-btn-verificar" class="onix-btn onix-btn-primary">Verificar OP</button>
                <button id="onix-btn-clear" class="onix-btn">Limpar</button>
              </div>
              <div id="onix-results-container" class="onix-results"></div>
            </div>
            <div id="tab-tropas" class="onix-tab-pane">
              <div class="onix-criteria-box">
                <div><strong>Dados:</strong> fetch da aba <strong>Tribo → Membros → Tropas</strong> (totais por aldeia, incluindo tropas fora da aldeia, como no jogo).</div>
                <div><strong>Pop. usada (por aldeia):</strong> 3600 + custo das tropas da linha (lan/esp/bar/arq 1 · scout 2 · cl 4 · carq 5 · cpes 6 · ari 5 · cat 8 · pal 10 · nob 100 · milícia 0)</div>
                <div style="margin-top:6px;"><strong>Full Ataque:</strong> Pop. &gt; 22.000 · Bárbaros &gt; 1000 · Cav. leve ≥ 500 · Nobres = 0 · Aríetes &lt; 400</div>
                <div style="margin-top:4px;"><strong>Full Defesa:</strong> Pop. &gt; 22.000 · Lanças &gt; 500 · Espadas &gt; 500</div>
                <div style="margin-top:4px;"><strong>Papa Strike:</strong> Pop. &gt; 22.000 · Bárbaros &gt; 500 · Cav. leve ≥ 500 · Aríetes &gt; 400</div>
              </div>
              <div class="onix-troops-header">
                <div class="onix-troops-header-left">
                  <div class="onix-troops-status" id="onix-troops-status">Clique em analisar para buscar no jogo.</div>
                  <div class="onix-troops-last-update" id="onix-troops-last-update"></div>
                  <div class="onix-progress-container" id="onix-progress-container">
                    <div class="onix-progress-bar" id="onix-progress-bar"></div>
                  </div>
                </div>
                <button id="onix-btn-fetch-troops" class="onix-btn onix-btn-primary">Analisar tropas (tribo)</button>
              </div>
              <label class="onix-debug-label" style="margin-top:0;">Totais da tribo (somente leitura)</label>
              <textarea id="onix-tribe-summary" class="onix-troops-debug" readonly spellcheck="false" style="min-height:88px;max-height:120px;margin-bottom:12px;"></textarea>
              <select id="onix-member-select" class="onix-select">
                <option value="">Execute a análise para listar membros</option>
              </select>
              <div id="onix-member-info"></div>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(root);

    const btnOpen          = document.getElementById("onix-btn-open");
    const overlay          = document.getElementById("onix-overlay");
    const btnClose         = overlay.querySelector(".onix-close");
    const tabBtns          = overlay.querySelectorAll(".onix-tab-btn");
    const tabContents      = overlay.querySelectorAll(".onix-tab-pane");
    const licenseBox       = document.getElementById("onix-license-info");
    const tabLicencaBtn    = overlay.querySelector('[data-tab="licenca"]');
    const coordsInput      = document.getElementById("onix-coords-input");
    const btnVerificar     = document.getElementById("onix-btn-verificar");
    const btnClear         = document.getElementById("onix-btn-clear");
    const checkReturns     = document.getElementById("onix-check-returns");
    const resultsContainer = document.getElementById("onix-results-container");
    const btnFetchTroops   = document.getElementById("onix-btn-fetch-troops");
    const troopsStatus     = document.getElementById("onix-troops-status");
    const troopsLastUpdate = document.getElementById("onix-troops-last-update");
    const memberSelect     = document.getElementById("onix-member-select");
    const memberInfo       = document.getElementById("onix-member-info");
    const tribeSummaryEl   = document.getElementById("onix-tribe-summary");

    let licenseValid = false;
    let troopsAnalysisState = null;

    function lockTabs() {
      tabBtns.forEach((b) => {
        if (b.dataset.tab !== "licenca") b.classList.add("locked");
      });
    }

    function unlockTabs() {
      tabBtns.forEach((b) => b.classList.remove("locked"));
    }

    function renderLicenseBox(info) {
      if (info.valid) {
        const exp = new Date(info.expiresAt).toLocaleDateString("pt-BR");
        licenseBox.innerHTML = `
          <h3>Status da Licença</h3>
          <p class="onix-license-status-ok">✓ Licença Ativa</p>
          <p>Válida até: <strong>${exp}</strong></p>
          <p style="margin-top:8px;">Tribo ID: <strong>${info.tribeTag}</strong></p>`;
      } else {
        const msgs = {
          no_tribe: "Você precisa estar em uma tribo para usar o Onix Tools.",
          not_found: "Sua tribo não possui uma licença ativa.",
          expired: "A licença da sua tribo expirou. Entre em contato para renovar.",
          network_error: "Erro ao conectar ao servidor. Verifique sua conexão e tente novamente.",
        };
        const msg = msgs[info.reason] || "Licença inválida ou não configurada.";
        licenseBox.innerHTML = `
          <h3>Status da Licença</h3>
          <p class="onix-license-status-err">✗ Sem licença ativa</p>
          <p>${msg}</p>
          ${info.tribeTag ? `<p style="margin-top:8px;">Tribo ID: <strong>${info.tribeTag}</strong></p>` : ""}`;
      }
    }

    tabBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.classList.contains("locked")) return;
        tabBtns.forEach((b) => b.classList.remove("active"));
        tabContents.forEach((c) => c.classList.remove("active"));
        btn.classList.add("active");
        root.querySelector(`#tab-${btn.dataset.tab}`).classList.add("active");
      });
    });

    btnOpen.addEventListener("click", async () => {
      overlay.classList.add("show");
      tabBtns.forEach((b) => b.classList.remove("active"));
      tabContents.forEach((c) => c.classList.remove("active"));
      tabLicencaBtn.classList.add("active");
      root.querySelector("#tab-licenca").classList.add("active");
      lockTabs();
      licenseBox.innerHTML = `<h3>Status da Licença</h3><p>Verificando...</p>`;

      const info = await checkLicense();
      licenseValid = info.valid;
      renderLicenseBox(info);

      if (licenseValid) {
        unlockTabs();
        memberSelect.innerHTML = `<option value="">Execute &quot;Analisar tropas (tribo)&quot; nesta aba</option>`;
        memberInfo.innerHTML = "";
        if (tribeSummaryEl) tribeSummaryEl.value = "";
        troopsLastUpdate.textContent = "";
      } else {
        lockTabs();
      }
    });

    btnClose.addEventListener("click", () => overlay.classList.remove("show"));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.classList.remove("show");
    });

    coordsInput.addEventListener("paste", () => {
      setTimeout(() => {
        const coords = coordsInput.value.match(/\d{3}\|\d{3}/g);
        coordsInput.value = coords ? [...new Set(coords)].join(" ") : "";
      }, 50);
    });

    btnClear.addEventListener("click", () => {
      coordsInput.value          = "";
      resultsContainer.innerHTML = "";
      checkReturns.checked       = false;
    });

    btnVerificar.addEventListener("click", () => {
      const coords       = coordsInput.value.match(/\d{3}\|\d{3}/g);
      const countReturns = checkReturns.checked;
      if (!coords || coords.length === 0) {
        alert("Nenhuma coordenada válida encontrada.");
        return;
      }
      const uniqueCoords = [...new Set(coords)];
      coordsInput.value  = uniqueCoords.join(" ");
      processOpVerification(uniqueCoords, btnVerificar, resultsContainer, countReturns);
    });

    btnFetchTroops.addEventListener("click", async () => {
      const villageId = getCurrentVillageId();
      if (!villageId) {
        troopsStatus.style.color = "#ef4444";
        troopsStatus.textContent = "Erro ao obter ID da aldeia atual.";
        return;
      }

      troopsStatus.style.color = "#cbd5e1";
      troopsStatus.textContent = "Obtendo lista de membros...";

      const members = await getMembersListForTroops(villageId);

      if (!members || members.length === 0) {
        troopsStatus.style.color = "#ef4444";
        troopsStatus.textContent =
          "Nenhum membro encontrado. Abra Tribo → Membros → Tropas no jogo e tente de novo.";
        return;
      }

      btnFetchTroops.disabled = true;
      btnFetchTroops.textContent = "Analisando...";

      const progressContainer = document.getElementById("onix-progress-container");
      const progressBar = document.getElementById("onix-progress-bar");
      progressContainer.style.display = "block";
      progressBar.style.width = "0%";

      const memberRows = [];
      let parseErrors = 0;
      const tribe = {
        memberCount: 0,
        villages: 0,
        fullAtk: 0,
        fullDef: 0,
        papaStrike: 0,
      };

      for (let i = 0; i < members.length; i++) {
        const member = members[i];
        troopsStatus.style.color = "#cbd5e1";
        troopsStatus.textContent = `Membro ${i + 1}/${members.length}: ${member.name}...`;

        let records = [];
        try {
          const html = await fetchMembersTroopsHtml(villageId, member.id);
          records = parseMembersTroopsHtml(html, member.id, member.name);
        } catch (e) {
          console.error("Onix members_troops fetch", member.id, e);
        }
        if (records.length === 0) parseErrors++;

        const analyze = analyzeVillageRecords(records);
        memberRows.push({
          memberId: member.id,
          memberName: member.name,
          records,
          analyze,
        });

        tribe.memberCount++;
        tribe.villages += analyze.villages;
        tribe.fullAtk += analyze.fullAtk;
        tribe.fullDef += analyze.fullDef;
        tribe.papaStrike += analyze.papaStrike;

        progressBar.style.width = `${((i + 1) / members.length) * 100}%`;
        await new Promise((r) => setTimeout(r, 350));
      }

      setTimeout(() => {
        progressContainer.style.display = "none";
        progressBar.style.width = "0%";
      }, 400);

      troopsAnalysisState = { members: memberRows, tribe, analyzedAt: Date.now() };
      wireTroopsAnalysisSelect(troopsAnalysisState, memberSelect, memberInfo, tribeSummaryEl);

      troopsStatus.style.color = "#22c55e";
      troopsStatus.textContent =
        `Concluído: ${tribe.villages} aldeias em ${tribe.memberCount} membros.` +
        (parseErrors > 0 ? ` (${parseErrors} sem tabela/sem aldeias)` : "");
      troopsLastUpdate.textContent = `Analisado em: ${new Date().toLocaleString("pt-BR")}`;

      btnFetchTroops.disabled = false;
      btnFetchTroops.textContent = "Analisar tropas (tribo)";
    });
  }

  waitForBody(createApp);
})();