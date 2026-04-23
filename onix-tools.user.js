// ==UserScript==
// @name         TribalWars - Onix Tools
// @namespace    http://tampermonkey.net/
// @version      1.9.7
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

  /** Bônus fixo de população dos edifícios (fazenda) somado em cada aldeia, como no jogo. */
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

  /**
   * Lista de membros: select da página atual (uso oficial: Tribo → Membros → Defesa), ou fetch de fallback.
   */
  async function getMembersListForTroops(villageId) {
    const fromDom = getMembersFromSelect();
    if (fromDom) return fromDom;

    const modes = ["members_defense", "members_troops", "members"];
    for (const mode of modes) {
      try {
        const url = `/game.php?village=${encodeURIComponent(villageId)}&screen=ally&mode=${mode}`;
        const res   = await fetch(url);
        const html  = await res.text();
        const doc   = new DOMParser().parseFromString(html, "text/html");
        const parsed = parseMembersFromDoc(doc);
        if (parsed) return parsed;
      } catch (e) {
        console.error("Onix: falha ao listar membros", mode, e);
      }
    }
    return null;
  }

  function normalizeCellText(s) {
    return (s || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  /** Rótulo da linha de tropas que estão na aldeia (varia por tradução / layout do TW BR). */
  function isHomeVillageTroopRowLabel(text) {
    const n = normalizeCellText(text);
    if (!n) return false;
    if (n === "na aldeia" || n === "na vila") return true;
    if (n.includes("na aldeia") || n.includes("na vila")) return true;
    if (n.includes("tropas na aldeia") || n.includes("tropas na vila")) return true;
    if (n.includes("em casa") || n === "presente") return true;
    return false;
  }

  /** Segunda linha de tropas por aldeia (em marcha / retorno). */
  function isTravelingTroopRowLabel(text) {
    const n = normalizeCellText(text);
    if (!n) return false;
    if (n === "a caminho" || n === "à caminho") return true;
    if (n.includes("a caminho") || n.includes("à caminho")) return true;
    if (n.includes("em caminho")) return true;
    if (n.includes("trânsito") || n.includes("transito")) return true;
    return false;
  }

  function findTroopTable(doc) {
    let best = null;
    doc.querySelectorAll("table").forEach((t) => {
      const low = normalizeCellText(t.textContent);
      if (
        low.includes("na aldeia") ||
        low.includes("na vila") ||
        low.includes("tropas na aldeia") ||
        low.includes("a caminho") ||
        low.includes("à caminho")
      ) {
        best = t;
      }
    });
    return best;
  }

  function emptyTroops() {
    return {
      spearman:      0,
      swordsman:     0,
      axeman:        0,
      scout:         0,
      archer:        0,
      lightCavalry:  0,
      mountedArcher: 0,
      heavyCavalry:  0,
      ram:           0,
      catapult:      0,
      knight:        0,
      snob:          0,
    };
  }

  function sumTroops(a, b) {
    const o = emptyTroops();
    Object.keys(o).forEach((k) => {
      o[k] = (a[k] || 0) + (b[k] || 0);
    });
    return o;
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
  };

  /** Usa cabeçalhos unit-item-* do TW quando existirem (colunas alinham com a linha de dados). */
  function tryParseTroopRowFromUnitHeaders(table, cells) {
    const headerRow = Array.from(table.querySelectorAll("tr")).find(
      (tr) => tr.querySelectorAll("th[class*='unit-item']").length >= 8,
    );
    if (!headerRow) return null;

    const colToKey = {};
    headerRow.querySelectorAll("th").forEach((th) => {
      const m = /unit-item-([a-z0-9_]+)/i.exec(th.className || "");
      if (!m) return;
      const token = m[1].toLowerCase();
      const key   = UNIT_ITEM_CLASS_MAP[token];
      if (key) colToKey[th.cellIndex] = key;
    });
    if (Object.keys(colToKey).length < 8) return null;
    if (!Object.values(colToKey).includes("snob")) return null;

    const o     = emptyTroops();
    let matched = 0;
    for (let i = 0; i < cells.length; i++) {
      const td = cells[i];
      const key = colToKey[td.cellIndex];
      if (!key) continue;
      const txt = (td.textContent || "").trim().replace(/\D/g, "");
      o[key] = parseInt(txt || "0") || 0;
      matched++;
    }
    if (matched < 6) return null;
    return o;
  }

  /** Layout clássico: colunas 1–10 = lança, espada, bárbaro, batedor, CL, CP, aríete, catapulta, paladino, nobre. */
  function parseTroopNumbersFixedLegacy(cells, labelIdx) {
    const getVal = (offsetFromFirstNumber) => {
      const idx = labelIdx + offsetFromFirstNumber;
      const txt = (cells[idx]?.textContent || "").trim().replace(/\D/g, "");
      return parseInt(txt || "0") || 0;
    };
    return {
      spearman:      getVal(1),
      swordsman:     getVal(2),
      axeman:        getVal(3),
      scout:         getVal(4),
      archer:        0,
      lightCavalry:  getVal(5),
      mountedArcher: 0,
      heavyCavalry:  getVal(6),
      ram:           getVal(7),
      catapult:      getVal(8),
      knight:        getVal(9),
      snob:          getVal(10),
    };
  }

  /**
   * Extrai contagens da linha da tabela TW (Membros/Defesa).
   * Preferência: classes unit-item-* no cabeçalho. Senão: cauda fixa (… HC, aríete, catapulta, paladino, nobre)
   * + prefixo por quantidade de colunas (mundos com batedor/arqueiro/cav. montada).
   */
  function parseTroopNumbersFromRow(cells, labelIdx) {
    const nums = [];
    for (let i = labelIdx + 1; i < cells.length; i++) {
      const txt = (cells[i]?.textContent || "").trim().replace(/\D/g, "");
      nums.push(parseInt(txt || "0") || 0);
    }
    const n = nums.length;
    const o = emptyTroops();
    if (n === 0) return o;

    const table = cells[0] && cells[0].closest("table");
    if (table) {
      const fromHdr = tryParseTroopRowFromUnitHeaders(table, cells);
      if (fromHdr) return fromHdr;
    }

    if (n < 9) return parseTroopNumbersFixedLegacy(cells, labelIdx);

    o.snob          = nums[n - 1];
    o.knight        = nums[n - 2];
    o.catapult      = nums[n - 3];
    o.ram           = nums[n - 4];
    o.heavyCavalry  = nums[n - 5];
    const prefix    = nums.slice(0, n - 5);
    const m         = prefix.length;

    if (m === 7) {
      o.spearman = prefix[0];
      o.swordsman = prefix[1];
      o.axeman = prefix[2];
      o.scout = prefix[3];
      o.archer = prefix[4];
      o.lightCavalry = prefix[5];
      o.mountedArcher = prefix[6];
    } else if (m === 6) {
      o.spearman = prefix[0];
      o.swordsman = prefix[1];
      o.axeman = prefix[2];
      o.scout = prefix[3];
      o.archer = prefix[4];
      o.lightCavalry = prefix[5];
    } else if (m === 5) {
      o.spearman = prefix[0];
      o.swordsman = prefix[1];
      o.axeman = prefix[2];
      o.scout = prefix[3];
      o.lightCavalry = prefix[4];
    } else if (m === 4) {
      o.spearman = prefix[0];
      o.swordsman = prefix[1];
      o.axeman = prefix[2];
      o.lightCavalry = prefix[3];
    } else {
      return parseTroopNumbersFixedLegacy(cells, labelIdx);
    }
    return o;
  }

  function parseTroopTable(table, playerId, playerName) {
    const rows    = table.querySelectorAll("tr");
    const byCoord = new Map();
    let currentCoord = "";

    rows.forEach((row) => {
      const cells = row.querySelectorAll("td");
      if (cells.length < 2) return;

      const villageLink = row.querySelector('a[href*="info_village"]');
      if (villageLink) {
        const coordMatch = villageLink.textContent.match(/\((\d{1,3}\|\d{1,3})\)/);
        currentCoord = coordMatch ? coordMatch[1] : villageLink.textContent.trim();
      }

      if (!currentCoord) return;

      let labelIdx = -1;
      let rowKind  = null;
      for (let i = 0; i < Math.min(cells.length, 6); i++) {
        const raw = cells[i]?.textContent;
        if (isHomeVillageTroopRowLabel(raw)) {
          labelIdx = i;
          rowKind  = "home";
          break;
        }
        if (isTravelingTroopRowLabel(raw)) {
          labelIdx = i;
          rowKind  = "travel";
          break;
        }
      }
      if (labelIdx < 0 || !rowKind) return;

      const counts = parseTroopNumbersFromRow(cells, labelIdx);
      if (!byCoord.has(currentCoord)) {
        byCoord.set(currentCoord, {
          memberId:          playerId,
          memberName:        playerName,
          villageCoord:      currentCoord,
          troopsHome:        emptyTroops(),
          troopsTraveling:   emptyTroops(),
        });
      }
      const slot = byCoord.get(currentCoord);
      if (rowKind === "home") slot.troopsHome = counts;
      else slot.troopsTraveling = counts;
    });

    return Array.from(byCoord.values()).map((v) => ({
      ...v,
      troops: sumTroops(v.troopsHome, v.troopsTraveling),
    }));
  }

  async function fetchMemberTroops(playerId, playerName, villageId) {
    const modes = ["members_troops", "members_defense"];
    for (const mode of modes) {
      try {
        const url =
          `/game.php?village=${villageId}&screen=ally&mode=${mode}&player_id=${encodeURIComponent(playerId)}`;
        const res  = await fetch(url);
        const html = await res.text();
        const doc  = new DOMParser().parseFromString(html, "text/html");

        const table = findTroopTable(doc);
        if (!table) continue;

        const villages = parseTroopTable(table, playerId, playerName);
        if (villages.length > 0) return villages;
      } catch (e) {
        console.error("Erro ao buscar tropas do membro:", playerId, mode, e);
      }
    }
    return [];
  }

  async function uploadTroops(payload) {
    try {
      const res = await fetch(`${API_BASE}/troops/update`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          ok:    false,
          error: data.error || `HTTP ${res.status}`,
        };
      }
      return data;
    } catch (e) {
      console.error("Erro ao enviar tropas:", e);
      return { ok: false, error: e.message };
    }
  }

  async function getTroopsData(tribeId) {
    try {
      const res = await fetch(`${API_BASE}/troops/tribe/${encodeURIComponent(tribeId)}`);
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } catch (e) {
      return { troops: [], lastUpdated: null };
    }
  }

  /**
   * Pop. total usada por aldeia = 3.600 (edifícios) + todas as tropas (Na aldeia + A caminho), custos TW:
   * lança/espada/arqueiro/bárbaro ×1 · batedor ×2 · CL ×4 · cav. arqueira ×5 · CP ×6 · aríete ×5 · catapulta ×8 · paladino ×10 · nobre ×100.
   */
  function totalUsedPopulation(troops) {
    const t = troops || {};
    const fromUnits =
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
      (t.snob || 0) * 100;
    return fromUnits + VILLAGE_BUILDING_POP_BONUS;
  }

  /** Full Ataque (por aldeia): pop. usada > 23k, critérios nas tropas totais (na aldeia + a caminho). */
  function isFullAttackVillageTotal(troops) {
    const t = troops || {};
    const pop = totalUsedPopulation(t);
    return (
      pop > 23000 &&
      (t.axeman || 0) >= 1000 &&
      (t.lightCavalry || 0) >= 500 &&
      (t.snob || 0) === 0 &&
      (t.ram || 0) < 400
    );
  }

  /** Full Defesa (por aldeia): pop. usada > 23k, lança/espada > 1000. */
  function isFullDefenseVillageTotal(troops) {
    const t = troops || {};
    const pop = totalUsedPopulation(t);
    return (
      pop > 23000 &&
      (t.spearman || 0) > 1000 &&
      (t.swordsman || 0) > 1000
    );
  }

  /** Papa Strike (por aldeia): como Full Ataque, mas aríetes &gt; 600 em vez de &lt; 400. */
  function isPapaStrikeVillageTotal(troops) {
    const t = troops || {};
    const pop = totalUsedPopulation(t);
    return (
      pop > 23000 &&
      (t.axeman || 0) >= 1000 &&
      (t.lightCavalry || 0) >= 500 &&
      (t.snob || 0) === 0 &&
      (t.ram || 0) > 600
    );
  }

  function troopsHomeFromRecord(v) {
    if (v.troopsHome != null && typeof v.troopsHome === "object") return v.troopsHome;
    if (v.troops != null && typeof v.troops === "object") return v.troops;
    return emptyTroops();
  }

  function troopsTravelFromRecord(v) {
    return v.troopsTraveling != null && typeof v.troopsTraveling === "object"
      ? v.troopsTraveling
      : emptyTroops();
  }

  function troopsTotalFromRecord(v) {
    return sumTroops(troopsHomeFromRecord(v), troopsTravelFromRecord(v));
  }

  function aggregateMemberStats(list, getTroopsForVillage) {
    let popUsada = 0;
    let fullAtk  = 0;
    let fullDef  = 0;
    let papaStrike = 0;
    list.forEach((v) => {
      const slice = getTroopsForVillage(v);
      popUsada += totalUsedPopulation(slice);
      const totalT = troopsTotalFromRecord(v);
      if (isFullAttackVillageTotal(totalT)) fullAtk++;
      if (isFullDefenseVillageTotal(totalT)) fullDef++;
      if (isPapaStrikeVillageTotal(totalT)) papaStrike++;
    });
    return {
      villages: list.length,
      popUsada,
      fullAtk,
      fullDef,
      papaStrike,
    };
  }

  function sumNobresTotal(list) {
    let n = 0;
    list.forEach((v) => {
      n += troopsTotalFromRecord(v).snob || 0;
    });
    return n;
  }

  function renderTroopsMetricCard(title, subtitle, s, showFull, nobresTotal) {
    const sub = subtitle
      ? `<div class="onix-card-sub">${subtitle}</div>`
      : "";
    const nobleRow =
      showFull && nobresTotal != null
        ? `<div class="onix-card-row"><span>Nobres</span><span class="value">${nobresTotal.toLocaleString("pt-BR")}</span></div>`
        : "";
    const fullRows = showFull
      ? `<div class="onix-card-row"><span>Full Ataques</span><span class="value">${s.fullAtk}</span></div>
            <div class="onix-card-row"><span>Full Defesas</span><span class="value">${s.fullDef}</span></div>
            <div class="onix-card-row"><span>Papa Strike</span><span class="value">${s.papaStrike}</span></div>`
      : "";
    return `
          <div class="onix-card">
            <div class="onix-card-title">${title}</div>
            ${sub}
            <div class="onix-card-row"><span>Aldeias</span><span class="value">${s.villages}</span></div>
            <div class="onix-card-row"><span>Pop. usada (soma)</span><span class="value">${s.popUsada.toLocaleString("pt-BR")}</span></div>
            ${nobleRow}
            ${fullRows}
          </div>`;
  }

  function renderTroopsMemberSelect(troops, selectEl, infoEl) {
    selectEl.innerHTML = "";

    if (!troops || troops.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Nenhum dado disponível";
      selectEl.appendChild(opt);
      infoEl.innerHTML = "";
      return;
    }

    const byMember = {};
    troops.forEach((t) => {
      if (!byMember[t.memberName]) byMember[t.memberName] = [];
      byMember[t.memberName].push(t);
    });

    const defaultOpt = document.createElement("option");
    defaultOpt.value = "";
    defaultOpt.textContent = "Selecione um membro";
    selectEl.appendChild(defaultOpt);

    Object.keys(byMember).sort((a, b) => a.localeCompare(b)).forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      selectEl.appendChild(opt);
    });

    infoEl.innerHTML = "";

    selectEl.onchange = () => {
      const name = selectEl.value;
      if (!name) {
        infoEl.innerHTML = "";
        return;
      }

      const list     = byMember[name];
      const home     = aggregateMemberStats(list, troopsHomeFromRecord);
      const travel   = aggregateMemberStats(list, troopsTravelFromRecord);
      const total    = aggregateMemberStats(list, troopsTotalFromRecord);
      const nobTotal = sumNobresTotal(list);

      infoEl.innerHTML = `
        <div class="onix-troops-member-head">${name}</div>
        <div class="onix-troops-cards">
          ${renderTroopsMetricCard("Na aldeia", "Só tropas estacionadas na aldeia", home, false, null)}
          ${renderTroopsMetricCard("A caminho", "Em marcha / retorno", travel, false, null)}
          ${renderTroopsMetricCard(
            "Total",
            "Na aldeia + A caminho · cada aldeia: +3600 + custos das tropas (ver caixa acima)",
            total,
            true,
            nobTotal,
          )}
        </div>`;
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
      if (data && data.villages && data.villages.length > 0) return data.villages[0].id;
    } catch (e) {}
    return null;
  }

  async function fetchCommandsForVillage(villageId, countReturns) {
    try {
      const res  = await fetch(`/game.php?screen=info_village&id=${villageId}`);
      const html = await res.text();
      const doc  = new DOMParser().parseFromString(html, "text/html");
      const commandRows  = doc.querySelectorAll("#commands_outgoings tr.command-row");
      const commandsData = [];

      commandRows.forEach((row) => {
        const isReturning =
          row.querySelector("img[src*='return']") !== null ||
          row.querySelector("img[src*='cancel']") !== null;
        if (!countReturns && isReturning) return;

        let playerName   = game_data.player.name;
        const playerLink = row.querySelector("a[href*='screen=info_player']");
        if (playerLink) {
          playerName = playerLink.textContent.trim();
        } else {
          const cmdLink = row.querySelector("a[href*='screen=info_command']");
          if (cmdLink) {
            const text = cmdLink.textContent.trim();
            const idx  = text.indexOf(":");
            if (idx > 0 && idx < 25) playerName = text.substring(0, idx).trim();
          }
        }

        let type   = "unknown";
        const icon = row.querySelector("img[src*='attack']");
        if (icon) {
          const src = icon.getAttribute("src");
          if (src.includes("attack_small"))                            type = "peq";
          else if (src.includes("attack_medium"))                      type = "med";
          else if (src.includes("attack_large"))                       type = "grd";
          else if (src.includes("snob") || src.includes("attack_snob")) type = "nob";
        }
        commandsData.push({ player: playerName, type });
      });
      return commandsData;
    } catch (e) {
      return [];
    }
  }

  async function processOpVerification(coordsArray, btnElement, containerElement, countReturns) {
    btnElement.style.opacity   = "0.7";
    btnElement.disabled        = true;
    containerElement.innerHTML = "";

    const progressContainer = document.getElementById("onix-progress-container");
    const progressBar       = document.getElementById("onix-progress-bar");
    progressContainer.style.display = "block";
    progressBar.style.width         = "0%";

    let resultados = {};

    for (let i = 0; i < coordsArray.length; i++) {
      const coord = coordsArray[i];
      btnElement.textContent = `Lendo ${i + 1} de ${coordsArray.length}...`;
      const villageId = await getVillageIdByCoord(coord);
      if (villageId) {
        const commands = await fetchCommandsForVillage(villageId, countReturns);
        commands.forEach((cmd) => {
          if (!resultados[cmd.player]) resultados[cmd.player] = { peq: 0, med: 0, grd: 0, nob: 0 };
          if (resultados[cmd.player][cmd.type] !== undefined) resultados[cmd.player][cmd.type]++;
        });
      }
      progressBar.style.width = `${((i + 1) / coordsArray.length) * 100}%`;
      await new Promise((r) => setTimeout(r, 300));
    }

    renderResults(resultados, containerElement);
    btnElement.textContent     = "Verificar";
    btnElement.style.opacity   = "1";
    btnElement.disabled        = false;

    setTimeout(() => {
      progressContainer.style.display = "none";
      progressBar.style.width         = "0%";
    }, 600);
  }

  function renderResults(resultsMap, container) {
    const players = Object.keys(resultsMap);
    if (players.length === 0) {
      container.innerHTML = `<div style="color:#cbd5e1;grid-column:1/-1;text-align:center;padding:20px;">Nenhum comando encontrado para estas coordenadas.</div>`;
      return;
    }
    container.innerHTML = players.map((player) => {
      const d = resultsMap[player];
      return `
        <div class="onix-card">
          <div class="onix-card-title">${player}</div>
          <div class="onix-card-row"><span>🪃 Pequeno ataque</span><span class="value">${d.peq || 0}</span></div>
          <div class="onix-card-row"><span>🐴 Médio ataque</span><span class="value">${d.med || 0}</span></div>
          <div class="onix-card-row"><span>⚔️ Grande ataque</span><span class="value">${d.grd || 0}</span></div>
          <div class="onix-card-row"><span>👑 Ataque nobre</span><span class="value">${d.nob || 0}</span></div>
        </div>`;
    }).join("");
  }

  function createApp() {
    const root = document.createElement("div");
    root.id = ROOT_ID;
    document.body.appendChild(root);

    root.innerHTML = `
      <style>
        #${ROOT_ID} * { box-sizing: border-box; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }

        #${ROOT_ID} .onix-btn-open {
          position: fixed; top: 50px; left: 20px; z-index: 999999;
          background: #0b0f19; color: #00f2fe;
          border: 1px solid #00f2fe; border-radius: 12px;
          padding: 14px 20px; font-weight: bold; font-size: 14px; cursor: pointer;
          box-shadow: 0 0 15px rgba(0,242,254,0.2); transition: all 0.3s ease;
        }
        #${ROOT_ID} .onix-btn-open:hover {
          background: #00f2fe; color: #0b0f19;
          box-shadow: 0 0 25px rgba(0,242,254,0.5); transform: translateY(-2px);
        }

        #${ROOT_ID} .onix-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.75); z-index: 999998; display: none; align-items: center; justify-content: center; padding: 20px; backdrop-filter: blur(4px); }
        #${ROOT_ID} .onix-overlay.show { display: flex; }

        #${ROOT_ID} .onix-modal { width: min(900px, 100%); max-height: 90vh; display: flex; flex-direction: column; background: #121a28; color: #f1f5f9; border-radius: 16px; border: 1px solid #2a3548; box-shadow: 0 25px 50px rgba(0,0,0,0.65); overflow: hidden; }

        #${ROOT_ID} .onix-header { display: flex; justify-content: space-between; align-items: center; padding: 14px 20px; background: #0a101c; border-bottom: 1px solid #2a3548; flex-wrap: wrap; gap: 8px; }
        #${ROOT_ID} .onix-tabs { display: flex; gap: 8px; flex-wrap: wrap; }
        #${ROOT_ID} .onix-tab-btn { background: transparent; color: #9aa8bc; border: 1px solid transparent; border-radius: 8px; padding: 8px 14px; cursor: pointer; font-weight: 600; font-size: 13px; transition: all 0.2s; }
        #${ROOT_ID} .onix-tab-btn:hover:not(.locked) { background: #161f2e; color: #f8fafc; }
        #${ROOT_ID} .onix-tab-btn.active { background: #2a3548; color: #f8fafc; border-color: #3d4f66; }
        #${ROOT_ID} .onix-tab-btn.locked { opacity: 0.4; cursor: not-allowed; }
        #${ROOT_ID} .onix-tab-btn.locked::after { content: " 🔒"; }

        #${ROOT_ID} .onix-btn-close { background: #2a3548; color: #d8dee9; border: 1px solid #3d4f66; padding: 7px 14px; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 13px; }
        #${ROOT_ID} .onix-btn-close:hover { background: #ef4444; color: #fff; border-color: #dc2626; }

        #${ROOT_ID} .onix-progress-container { width: 100%; height: 3px; background: #2a3548; display: none; }
        #${ROOT_ID} .onix-progress-bar { height: 100%; width: 0%; background: #7c3aed; transition: width 0.3s ease; }

        #${ROOT_ID} .onix-body { padding: 20px; overflow-y: auto; max-height: calc(90vh - 60px); }
        #${ROOT_ID} .onix-tab-content { display: none; animation: onixFade 0.2s ease; }
        #${ROOT_ID} .onix-tab-content.active { display: block; }
        @keyframes onixFade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }

        #${ROOT_ID} label.onix-main-label { display: block; font-size: 11px; font-weight: 700; letter-spacing: 1.2px; color: #aeb9ca; margin-bottom: 8px; text-transform: uppercase; }
        #${ROOT_ID} textarea { width: 100%; background: #080d16; color: #eef2f7; border: 1px solid #2a3548; border-radius: 8px; padding: 10px 12px; outline: none; min-height: 90px; resize: vertical; font-family: monospace; font-size: 13px; }
        #${ROOT_ID} textarea:focus { border-color: #4b5d78; }

        #${ROOT_ID} .onix-checkbox-container { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
        #${ROOT_ID} .onix-checkbox-container input[type="checkbox"] { width: 15px; height: 15px; cursor: pointer; accent-color: #7c3aed; }
        #${ROOT_ID} .onix-checkbox-container label { color: #d8dee9; font-size: 13px; cursor: pointer; }

        #${ROOT_ID} .onix-actions-row { display: flex; gap: 10px; margin-top: 14px; flex-wrap: wrap; align-items: center; }
        #${ROOT_ID} .onix-btn-action { padding: 7px 18px; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 13px; background: #7c3aed; color: #fff; border: 1px solid #6d28d9; transition: all 0.2s; }
        #${ROOT_ID} .onix-btn-action:hover { background: #6d28d9; }
        #${ROOT_ID} .onix-btn-action:disabled { background: #2a3548; color: #9aa8bc; cursor: not-allowed; border-color: #2a3548; }
        #${ROOT_ID} .onix-btn-clear { padding: 7px 18px; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 13px; background: #0f1624; color: #d8dee9; border: 1px solid #2a3548; }
        #${ROOT_ID} .onix-btn-clear:hover { background: #1a2434; }

        #${ROOT_ID} .onix-results-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; margin-top: 20px; }
        #${ROOT_ID} .onix-card { background: #080d16; border: 1px solid #2a3548; border-radius: 12px; padding: 14px; }
        #${ROOT_ID} .onix-card-title { font-size: 13px; font-weight: 700; color: #f8fafc; margin-bottom: 10px; border-bottom: 1px solid #2a3548; padding-bottom: 8px; }
        #${ROOT_ID} .onix-card-row { display: flex; justify-content: space-between; align-items: center; font-size: 13px; margin-bottom: 6px; color: #cbd5e1; }
        #${ROOT_ID} .onix-card-row span.value { color: #f8fafc; font-weight: 700; background: #121a28; padding: 2px 8px; border-radius: 4px; border: 1px solid #2a3548; min-width: 28px; text-align: center; }

        #${ROOT_ID} .onix-license-box { background: #080d16; padding: 30px; border-radius: 10px; border: 1px dashed #2a3548; text-align: center; }
        #${ROOT_ID} .onix-license-box h3 { color: #f8fafc; margin: 0 0 12px; text-transform: uppercase; font-size: 15px; letter-spacing: 1px; }
        #${ROOT_ID} .onix-license-box p { color: #aeb9ca; margin: 4px 0; font-size: 13px; }
        #${ROOT_ID} .onix-license-box p strong { color: #f1f5f9; }
        #${ROOT_ID} .onix-license-status-ok  { color: #22c55e !important; font-weight: 700; font-size: 14px !important; margin-bottom: 10px !important; }
        #${ROOT_ID} .onix-license-status-err { color: #ef4444 !important; font-weight: 700; font-size: 14px !important; margin-bottom: 10px !important; }

        #${ROOT_ID} .onix-start-notice {
          margin-top: 16px;
          padding: 12px 14px;
          border-radius: 8px;
          border: 1px solid #2a3548;
          background: #0a101c;
          font-size: 12px;
          color: #94a3b8;
          line-height: 1.5;
          text-align: center;
        }

        #${ROOT_ID} .onix-info-box { background: #1a2332; border-left: 3px solid #7c3aed; padding: 12px 14px; border-radius: 4px; margin-bottom: 14px; }
        #${ROOT_ID} .onix-info-box p { margin: 2px 0; font-size: 12px; color: #aeb9ca; line-height: 1.5; }

        #${ROOT_ID} .onix-last-update { font-size: 12px; color: #64748b; align-self: center; }
        #${ROOT_ID} .onix-troops-status { font-size: 13px; margin: 10px 0; min-height: 18px; }
        #${ROOT_ID} .onix-troops-label { font-size: 13px; color: #e5e7eb; align-self: center; }
        #${ROOT_ID} .onix-member-select { padding: 6px 10px; border-radius: 6px; border: 1px solid #2a3548; background: #020617; color: #e5e7eb; font-size: 13px; min-width: 200px; outline: none; }
        #${ROOT_ID} .onix-member-select:focus { border-color: #7c3aed; }

        #${ROOT_ID} .onix-troops-filter-panel {
          margin-top: 14px;
          padding: 12px 14px;
          border-radius: 10px;
          border: 1px dashed #3d4f66;
          background: #0a101c;
        }
        #${ROOT_ID} .onix-troops-filter-head {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 1px;
          text-transform: uppercase;
          color: #64748b;
          margin-bottom: 6px;
        }
        #${ROOT_ID} .onix-troops-filter-msg { margin: 0; font-size: 13px; color: #94a3b8; font-style: italic; }

        #${ROOT_ID} .onix-troops-member-head {
          margin-top: 14px;
          font-size: 14px;
          font-weight: 700;
          color: #f8fafc;
          letter-spacing: 0.02em;
        }
        #${ROOT_ID} .onix-troops-cards {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
          margin-top: 10px;
        }
        #${ROOT_ID} .onix-card-sub {
          font-size: 11px;
          color: #64748b;
          margin: -4px 0 10px;
          line-height: 1.35;
        }
        @media (max-width: 780px) {
          #${ROOT_ID} .onix-troops-cards { grid-template-columns: 1fr; }
        }
      </style>

      <button class="onix-btn-open" id="onix-btn-open">Onix Tools</button>

      <div class="onix-overlay" id="onix-overlay">
        <div class="onix-modal">
          <div class="onix-header">
            <div class="onix-tabs">
              <button class="onix-tab-btn active" data-tab="licenca">Licença</button>
              <button class="onix-tab-btn" data-tab="verificar">Verificar OP</button>
              <button class="onix-tab-btn" data-tab="organizar">Organizar OP</button>
              <button class="onix-tab-btn" data-tab="tropas">Verificar Tropas</button>
            </div>
            <button class="onix-btn-close" id="onix-btn-close">Fechar</button>
          </div>

          <div class="onix-progress-container" id="onix-progress-container">
            <div class="onix-progress-bar" id="onix-progress-bar"></div>
          </div>

          <div class="onix-body">
            <div class="onix-tab-content active" id="tab-licenca">
              <div class="onix-license-box" id="onix-license-box">
                <h3>Status da Licença</h3>
                <p>Verificando...</p>
              </div>
              <p class="onix-start-notice">
                O carregamento inicial pode demorar até 50 segundos se o servidor estiver 'desacordado', como é um projeto hospedado gratuitamente em fase de testes.
              </p>
            </div>

            <div class="onix-tab-content" id="tab-verificar">
              <label class="onix-main-label">Coordenadas verificadas</label>
              <textarea id="onix-coords-input" placeholder="Cole as coordenadas aqui"></textarea>
              <div class="onix-checkbox-container">
                <input type="checkbox" id="onix-check-returns">
                <label for="onix-check-returns">Contar comandos retornando (ignorados por padrão)</label>
              </div>
              <div class="onix-actions-row">
                <button class="onix-btn-action" id="onix-btn-verificar">Verificar</button>
                <button class="onix-btn-clear" id="onix-btn-clear">Limpar</button>
              </div>
              <div class="onix-results-grid" id="onix-results-container"></div>
            </div>

            <div class="onix-tab-content" id="tab-organizar">
              <div class="onix-info-box">
                <p><strong style="color:#f1f5f9;">Organizar OP</strong> — Funcionalidade em desenvolvimento.</p>
              </div>
            </div>

            <div class="onix-tab-content" id="tab-tropas">
              <div class="onix-info-box">
                <p><strong style="color:#f1f5f9;">Critérios p/ Full Ataque:</strong><br>
                Pop. usada &gt; 23.000 · Bárbaros ≥ 1.000 · Cav. leve ≥ 500 · 0 nobres · Aríetes &lt; 400</p>
                <p style="margin-top:10px;"><strong style="color:#f1f5f9;">Critérios p/ Full Defesa:</strong><br>
                Pop. usada &gt; 23.000 · Lanceiros &gt; 1000 · Espadachins &gt; 1000</p>
                <p style="margin-top:10px;"><strong style="color:#f1f5f9;">Critérios p/ Papa Strike:</strong><br>
                Pop. usada &gt; 23.000 · Bárbaros ≥ 1.000 · Cav. leve ≥ 500 · 0 nobres · Aríetes &gt; 600</p>
                <p style="margin-top:10px;color:#94a3b8;font-size:12px;">
                  <strong style="color:#e2e8f0;">Pop. usada</strong> (por aldeia, Na aldeia + A caminho): <strong style="color:#e2e8f0;">3600</strong> (edifícios) + soma de <strong style="color:#e2e8f0;">todas</strong> as unidades:
                  lança · espadachim · arqueiro · bárbaro <strong>1</strong> · batedor <strong>2</strong> · cav. leve <strong>4</strong> · cav. arqueira <strong>5</strong> · cav. pesada <strong>6</strong> · aríete <strong>5</strong> · catapulta <strong>8</strong> · paladino <strong>10</strong> · nobre <strong>100</strong>.
                  Nos cards, <strong style="color:#e2e8f0;">Pop. usada (soma)</strong> = soma dessa pop. em todas as aldeias do recorte (na aldeia / a caminho / total).
                </p>
                <p style="margin-top:10px;color:#fbbf24;font-size:12px;">
                  <strong style="color:#fef3c7;">Obrigatório:</strong> abra <strong style="color:#fef3c7;">Tribo → Membros → Defesa</strong> no jogo antes de usar <strong style="color:#fef3c7;">Buscar Tropas</strong>.
                </p>
              </div>
              <div class="onix-actions-row">
                <button class="onix-btn-action" id="onix-btn-fetch-troops">🔄 Buscar Tropas</button>
                <span class="onix-last-update" id="onix-troops-last-update">Nunca atualizado</span>
              </div>
              <div class="onix-troops-status" id="onix-troops-status"></div>
              <div class="onix-actions-row" style="margin-top:8px;">
                <label for="onix-member-select" class="onix-troops-label">Selecionar membro:</label>
                <select id="onix-member-select" class="onix-member-select"></select>
              </div>
              <div class="onix-troops-filter-panel" aria-label="Filtros (em construção)">
                <div class="onix-troops-filter-head">Filtros</div>
                <p class="onix-troops-filter-msg">Em construção.</p>
              </div>
              <div id="onix-member-info"></div>
            </div>
          </div>
        </div>
      </div>`;

    const overlay          = root.querySelector("#onix-overlay");
    const btnOpen          = root.querySelector("#onix-btn-open");
    const btnClose         = root.querySelector("#onix-btn-close");
    const tabBtns          = root.querySelectorAll(".onix-tab-btn");
    const tabContents      = root.querySelectorAll(".onix-tab-content");
    const btnVerificar     = root.querySelector("#onix-btn-verificar");
    const btnClear         = root.querySelector("#onix-btn-clear");
    const resultsContainer = root.querySelector("#onix-results-container");
    const coordsInput      = root.querySelector("#onix-coords-input");
    const checkReturns     = root.querySelector("#onix-check-returns");
    const licenseBox       = root.querySelector("#onix-license-box");
    const tabLicencaBtn    = root.querySelector('.onix-tab-btn[data-tab="licenca"]');
    const btnFetchTroops   = root.querySelector("#onix-btn-fetch-troops");
    const troopsStatus     = root.querySelector("#onix-troops-status");
    const troopsLastUpdate = root.querySelector("#onix-troops-last-update");
    const memberSelect     = root.querySelector("#onix-member-select");
    const memberInfo       = root.querySelector("#onix-member-info");

    let licenseValid    = false;
    let lastTroopsCache = [];

    function lockTabs() {
      tabBtns.forEach((b) => { if (b.dataset.tab !== "licenca") b.classList.add("locked"); });
    }

    function unlockTabs() {
      tabBtns.forEach((b) => b.classList.remove("locked"));
    }

    function renderLicenseBox(info) {
      if (info.valid) {
        const expDate = new Date(info.expiresAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
        licenseBox.innerHTML = `
          <h3>Status da Licença</h3>
          <p class="onix-license-status-ok">✓ Licença ativa</p>
          <p>Tribo ID: <strong>${info.tribeTag}</strong></p>
          <p>Válida até: <strong>${expDate}</strong></p>`;
      } else {
        const msgs = {
          no_tribe:      "Não foi possível identificar a tribo. Abra uma aldeia e recarregue a página.",
          not_found:     "Nenhuma licença encontrada para esta tribo. Entre em contato para adquirir.",
          expired:       "A licença desta tribo está expirada. Entre em contato para renovar.",
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
        const tribeId = getTribeTag();
        if (tribeId) {
          const data = await getTroopsData(tribeId);
          lastTroopsCache = data.troops || [];
          if (data.lastUpdated) {
            troopsLastUpdate.textContent = `Última atualização: ${new Date(data.lastUpdated).toLocaleString("pt-BR")}`;
          }
          renderTroopsMemberSelect(lastTroopsCache, memberSelect, memberInfo);
        }
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
          "Nenhum membro encontrado. Você precisa estar em Tribo → Membros → Defesa para esta busca.";
        return;
      }

      const tribeId = getTribeTag();
      if (!tribeId) {
        troopsStatus.style.color = "#ef4444";
        troopsStatus.textContent = "Erro ao obter ID da tribo.";
        return;
      }

      btnFetchTroops.disabled    = true;
      btnFetchTroops.textContent = "⏳ Buscando...";

      const progressContainer = document.getElementById("onix-progress-container");
      const progressBar       = document.getElementById("onix-progress-bar");
      progressContainer.style.display = "block";
      progressBar.style.width         = "0%";

      const allTroopsData = [];
      let erros = 0;

      for (let i = 0; i < members.length; i++) {
        const member = members[i];
        troopsStatus.style.color = "#cbd5e1";
        troopsStatus.textContent = `Buscando ${i + 1}/${members.length}: ${member.name}...`;

        const villages = await fetchMemberTroops(member.id, member.name, villageId);
        if (villages.length === 0) erros++;
        allTroopsData.push(...villages);

        progressBar.style.width = `${((i + 1) / members.length) * 100}%`;
        await new Promise((r) => setTimeout(r, 400));
      }

      troopsStatus.textContent = `Enviando ${allTroopsData.length} aldeias para o servidor...`;

      const result = await uploadTroops({ tribeId, troopsData: allTroopsData });

      setTimeout(() => {
        progressContainer.style.display = "none";
        progressBar.style.width         = "0%";
      }, 600);

      if (result.ok) {
        troopsStatus.style.color = "#22c55e";
        troopsStatus.textContent = `✓ ${result.count} aldeias atualizadas.${erros > 0 ? ` (${erros} membros sem dados)` : ""}`;
        troopsLastUpdate.textContent = `Última atualização: ${new Date().toLocaleString("pt-BR")}`;
        const data = await getTroopsData(tribeId);
        lastTroopsCache = data.troops || [];
        renderTroopsMemberSelect(lastTroopsCache, memberSelect, memberInfo);
      } else {
        troopsStatus.style.color = "#ef4444";
        troopsStatus.textContent = `✗ Erro ao salvar: ${result.error || "desconhecido"}`;
      }

      btnFetchTroops.disabled    = false;
      btnFetchTroops.textContent = "🔄 Buscar Tropas";
    });
  }

  waitForBody(createApp);
})();