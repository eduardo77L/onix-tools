// ==UserScript==
// @name         TribalWars - Onix Tools
// @namespace    http://tampermonkey.net/
// @version      1.1
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
  
    // ==========================================
    // LICENÇA
    // ==========================================
  
    function getTribeTag() {
      try {
        if (window.game_data && game_data.player) {
          return game_data.player.ally ? String(game_data.player.ally) : null;
        }
      } catch (e) {
        console.error("Onix: erro ao ler tribo:", e);
      }
      return null;
    }
  
    async function checkLicense() {
      const tribeTag = getTribeTag();
      if (!tribeTag) {
        return { valid: false, reason: "no_tribe" };
      }
      try {
        const res  = await fetch(`${API_BASE}/license/check?tag=${encodeURIComponent(tribeTag)}`);
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        return { ...data, tribeTag };
      } catch (e) {
        console.error("Onix: erro ao verificar licença:", e);
        return { valid: false, reason: "network_error", tribeTag };
      }
    }
  
    // ==========================================
    // UTILITÁRIOS
    // ==========================================
  
    function waitForBody(cb) {
      if (document.body) return cb();
      const obs = new MutationObserver(() => {
        if (document.body) { obs.disconnect(); cb(); }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
    }
  
    async function getVillageIdByCoord(coord) {
      try {
        const url      = `/game.php?screen=api&ajax=target_selection&input=${coord}`;
        const response = await fetch(url);
        const data     = await response.json();
        if (data && data.villages && data.villages.length > 0)
          return data.villages[0].id;
      } catch (e) {
        console.error("Erro ao buscar ID:", coord, e);
      }
      return null;
    }
  
    async function fetchCommandsForVillage(villageId, countReturns) {
      try {
        const url      = `/game.php?screen=info_village&id=${villageId}`;
        const response = await fetch(url);
        const html     = await response.text();
        const parser   = new DOMParser();
        const doc      = parser.parseFromString(html, "text/html");
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
              const text       = cmdLink.textContent.trim();
              const colonIndex = text.indexOf(":");
              if (colonIndex > 0 && colonIndex < 25)
                playerName = text.substring(0, colonIndex).trim();
            }
          }
  
          let type   = "unknown";
          const icon = row.querySelector("img[src*='attack']");
          if (icon) {
            const src = icon.getAttribute("src");
            if (src.includes("attack_small"))                        type = "peq";
            else if (src.includes("attack_medium"))                  type = "med";
            else if (src.includes("attack_large"))                   type = "grd";
            else if (src.includes("snob") || src.includes("attack_snob")) type = "nob";
          }
          commandsData.push({ player: playerName, type });
        });
        return commandsData;
      } catch (e) {
        console.error("Erro ao ler aldeia:", villageId, e);
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
            if (!resultados[cmd.player])
              resultados[cmd.player] = { peq: 0, med: 0, grd: 0, nob: 0 };
            if (resultados[cmd.player][cmd.type] !== undefined)
              resultados[cmd.player][cmd.type]++;
          });
        }
  
        progressBar.style.width = `${((i + 1) / coordsArray.length) * 100}%`;
        await new Promise((r) => setTimeout(r, 300));
      }
  
      renderResults(resultados, containerElement);
      btnElement.textContent   = "Verificar";
      btnElement.style.opacity = "1";
      btnElement.disabled      = false;
  
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
      let html = "";
      players.forEach((player) => {
        const data = resultsMap[player];
        html += `
          <div class="onix-card">
            <div class="onix-card-title">${player}</div>
            <div class="onix-card-row"><span>🪓 Pequeno ataque</span><span class="value">${data.peq || 0}</span></div>
            <div class="onix-card-row"><span>🐎 Médio ataque</span><span class="value">${data.med || 0}</span></div>
            <div class="onix-card-row"><span>⚔️ Grande ataque</span><span class="value">${data.grd || 0}</span></div>
            <div class="onix-card-row"><span>👑 Ataque nobre</span><span class="value">${data.nob || 0}</span></div>
          </div>`;
      });
      container.innerHTML = html;
    }
  
    // ==========================================
    // APP
    // ==========================================
  
    function createApp() {
      const root = document.createElement("div");
      root.id    = ROOT_ID;
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
  
          #${ROOT_ID} .onix-modal { width: min(1000px, 100%); max-height: 90vh; display: flex; flex-direction: column; background: #121a28; color: #f1f5f9; border-radius: 16px; border: 1px solid #2a3548; box-shadow: 0 25px 50px rgba(0,0,0,0.65); overflow: hidden; }
  
          #${ROOT_ID} .onix-header { display: flex; justify-content: space-between; align-items: center; padding: 14px 20px; background: #0a101c; border-bottom: 1px solid #2a3548; }
          #${ROOT_ID} .onix-tabs { display: flex; gap: 8px; }
          #${ROOT_ID} .onix-tab-btn { background: transparent; color: #9aa8bc; border: 1px solid transparent; border-radius: 8px; padding: 8px 14px; cursor: pointer; font-weight: 600; font-size: 13px; transition: all 0.2s; }
          #${ROOT_ID} .onix-tab-btn:hover:not(.locked) { background: #161f2e; color: #f8fafc; }
          #${ROOT_ID} .onix-tab-btn.active { background: #2a3548; color: #f8fafc; border-color: #3d4f66; }
          #${ROOT_ID} .onix-btn-close { background: #2a3548; color: #d8dee9; border: 1px solid #3d4f66; padding: 7px 14px; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 13px; transition: all 0.2s; }
          #${ROOT_ID} .onix-btn-close:hover { background: #ef4444; color: #fff; border-color: #dc2626; }
  
          /* Bloqueio de aba */
          #${ROOT_ID} .onix-tab-btn.locked { opacity: 0.4; cursor: not-allowed; position: relative; }
          #${ROOT_ID} .onix-tab-btn.locked::after { content: " 🔒"; }
          #${ROOT_ID} .onix-tab-btn.locked:hover::before {
            content: "Licença necessária para esta tribo";
            position: absolute; left: 0; top: 110%;
            white-space: nowrap; background: #0a101c; color: #f1f5f9;
            border: 1px solid #2a3548; border-radius: 6px;
            padding: 4px 10px; font-size: 11px; z-index: 9999999;
          }
  
          #${ROOT_ID} .onix-progress-container { width: 100%; height: 3px; background: #2a3548; display: none; }
          #${ROOT_ID} .onix-progress-bar { height: 100%; width: 0%; background: #7c3aed; transition: width 0.3s ease; }
  
          #${ROOT_ID} .onix-body { padding: 20px; overflow-y: auto; }
          #${ROOT_ID} .onix-tab-content { display: none; animation: onixFade 0.25s ease; }
          #${ROOT_ID} .onix-tab-content.active { display: block; }
          @keyframes onixFade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
  
          #${ROOT_ID} label.onix-main-label { display: block; font-size: 11px; font-weight: 700; letter-spacing: 1.2px; color: #aeb9ca; margin-bottom: 8px; text-transform: uppercase; }
          #${ROOT_ID} textarea { width: 100%; background: #080d16; color: #eef2f7; border: 1px solid #2a3548; border-radius: 8px; padding: 10px 12px; outline: none; min-height: 90px; resize: vertical; font-family: monospace; font-size: 13px; }
          #${ROOT_ID} textarea::placeholder { color: #8b98ae; opacity: 1; }
          #${ROOT_ID} textarea:focus { border-color: #4b5d78; }
  
          #${ROOT_ID} .onix-checkbox-container { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
          #${ROOT_ID} .onix-checkbox-container input[type="checkbox"] { width: 15px; height: 15px; cursor: pointer; accent-color: #7c3aed; }
          #${ROOT_ID} .onix-checkbox-container label { color: #d8dee9; font-size: 13px; cursor: pointer; margin: 0; }
  
          #${ROOT_ID} .onix-actions-row { display: flex; gap: 10px; margin-top: 14px; }
          #${ROOT_ID} .onix-btn-action,
          #${ROOT_ID} .onix-btn-clear { padding: 7px 18px; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 13px; transition: all 0.2s; white-space: nowrap; }
          #${ROOT_ID} .onix-btn-action { background: #7c3aed; color: #fff; border: 1px solid #6d28d9; }
          #${ROOT_ID} .onix-btn-action:hover { background: #6d28d9; }
          #${ROOT_ID} .onix-btn-action:disabled { background: #2a3548; color: #9aa8bc; cursor: not-allowed; border-color: #2a3548; }
          #${ROOT_ID} .onix-btn-clear { background: #0f1624; color: #d8dee9; border: 1px solid #2a3548; }
          #${ROOT_ID} .onix-btn-clear:hover { background: #1a2434; color: #f8fafc; }
  
          #${ROOT_ID} .onix-results-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px; margin-top: 20px; }
          #${ROOT_ID} .onix-card { background: #080d16; border: 1px solid #2a3548; border-radius: 12px; padding: 14px; transition: border-color 0.2s; }
          #${ROOT_ID} .onix-card:hover { border-color: #4b5d78; }
          #${ROOT_ID} .onix-card-title { font-size: 14px; font-weight: 700; color: #f8fafc; margin-bottom: 10px; border-bottom: 1px solid #2a3548; padding-bottom: 8px; text-transform: uppercase; letter-spacing: 0.8px; }
          #${ROOT_ID} .onix-card-row { display: flex; justify-content: space-between; align-items: center; font-size: 13px; margin-bottom: 6px; color: #cbd5e1; }
          #${ROOT_ID} .onix-card-row span.value { color: #f8fafc; font-weight: 700; background: #121a28; padding: 2px 8px; border-radius: 4px; border: 1px solid #2a3548; min-width: 28px; text-align: center; }
  
          #${ROOT_ID} .onix-license-box { background: #080d16; padding: 30px; border-radius: 10px; border: 1px dashed #2a3548; text-align: center; }
          #${ROOT_ID} .onix-license-box h3 { color: #f8fafc; margin-top: 0; text-transform: uppercase; font-size: 15px; letter-spacing: 1px; margin-bottom: 12px; }
          #${ROOT_ID} .onix-license-box p { color: #aeb9ca; margin: 4px 0; font-size: 13px; }
          #${ROOT_ID} .onix-license-box p strong { color: #f1f5f9; }
          #${ROOT_ID} .onix-license-status-ok  { color: #22c55e !important; font-weight: 700; font-size: 14px !important; margin-bottom: 10px !important; }
          #${ROOT_ID} .onix-license-status-err { color: #ef4444 !important; font-weight: 700; font-size: 14px !important; margin-bottom: 10px !important; }
        </style>
  
        <button class="onix-btn-open" id="onix-btn-open">Onix Tools</button>
  
        <div class="onix-overlay" id="onix-overlay">
          <div class="onix-modal">
            <div class="onix-header">
              <div class="onix-tabs">
                <button class="onix-tab-btn active" data-tab="licenca">Licença</button>
                <button class="onix-tab-btn" data-tab="verificar">Verificar OP</button>
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
            </div>
          </div>
        </div>`;
  
      // referências
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
      const tabVerificarBtn  = root.querySelector('.onix-tab-btn[data-tab="verificar"]');
      const tabLicencaBtn    = root.querySelector('.onix-tab-btn[data-tab="licenca"]');
  
      // ---- estado de licença ----
      let licenseValid = false;
  
      function lockTabs() {
        tabVerificarBtn.classList.add("locked");
      }
  
      function unlockTabs() {
        tabVerificarBtn.classList.remove("locked");
      }
  
      function renderLicenseBox(info) {
        if (info.valid) {
          const expDate = new Date(info.expiresAt).toLocaleDateString("pt-BR", {
            day: "2-digit", month: "2-digit", year: "numeric"
          });
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
  
      // ---- clique nas abas (respeita licença) ----
      tabBtns.forEach((btn) => {
        btn.addEventListener("click", () => {
          if (btn.classList.contains("locked")) return;
          tabBtns.forEach((b) => b.classList.remove("active"));
          tabContents.forEach((c) => c.classList.remove("active"));
          btn.classList.add("active");
          root.querySelector(`#tab-${btn.dataset.tab}`).classList.add("active");
        });
      });
  
      // ---- abre modal e verifica licença ----
      btnOpen.addEventListener("click", async () => {
        overlay.classList.add("show");
  
        // força aba licença enquanto verifica
        tabBtns.forEach((b) => b.classList.remove("active"));
        tabContents.forEach((c) => c.classList.remove("active"));
        tabLicencaBtn.classList.add("active");
        root.querySelector("#tab-licenca").classList.add("active");
        lockTabs();
        licenseBox.innerHTML = `<h3>Status da Licença</h3><p>Verificando...</p>`;
  
        const info   = await checkLicense();
        licenseValid = info.valid;
        renderLicenseBox(info);
  
        if (licenseValid) {
          unlockTabs();
        } else {
          lockTabs();
        }
      });
  
      btnClose.addEventListener("click", () => overlay.classList.remove("show"));
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) overlay.classList.remove("show");
      });
  
      // ---- inputs ----
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
        const uniqueCoords    = [...new Set(coords)];
        coordsInput.value     = uniqueCoords.join(" ");
        processOpVerification(uniqueCoords, btnVerificar, resultsContainer, countReturns);
      });
    }
  
    waitForBody(createApp);
  })();