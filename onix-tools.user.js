// ==UserScript==
// @name         TribalWars - Onix Tools
// @namespace    http://tampermonkey.net/
// @version      1.0
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

    const ROOT_ID = "onix-root";
    if (document.getElementById(ROOT_ID)) return;

    function waitForBody(cb) {
        if (document.body) return cb();
        const obs = new MutationObserver(() => {
            if (document.body) { obs.disconnect(); cb(); }
        });
        obs.observe(document.documentElement, { childList: true, subtree: true });
    }

    async function getVillageIdByCoord(coord) {
        try {
            const url = `/game.php?screen=api&ajax=target_selection&input=${coord}`;
            const response = await fetch(url);
            const data = await response.json();
            if (data && data.villages && data.villages.length > 0) return data.villages[0].id;
        } catch (e) { console.error("Erro ao buscar ID:", coord, e); }
        return null;
    }

    async function fetchCommandsForVillage(villageId, countReturns) {
        try {
            const url = `/game.php?screen=info_village&id=${villageId}`;
            const response = await fetch(url);
            const html = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");
            const commandRows = doc.querySelectorAll("#commands_outgoings tr.command-row");
            const commandsData = [];

            commandRows.forEach(row => {
                const isReturning = row.querySelector("img[src*='return']") !== null
                                 || row.querySelector("img[src*='cancel']") !== null;
                if (!countReturns && isReturning) return;

                let playerName = game_data.player.name;
                const playerLink = row.querySelector("a[href*='screen=info_player']");
                if (playerLink) {
                    playerName = playerLink.textContent.trim();
                } else {
                    const cmdLink = row.querySelector("a[href*='screen=info_command']");
                    if (cmdLink) {
                        const text = cmdLink.textContent.trim();
                        const colonIndex = text.indexOf(":");
                        if (colonIndex > 0 && colonIndex < 25)
                            playerName = text.substring(0, colonIndex).trim();
                    }
                }

                let type = "unknown";
                const icon = row.querySelector("img[src*='attack']");
                if (icon) {
                    const src = icon.getAttribute("src");
                    if (src.includes("attack_small")) type = "peq";
                    else if (src.includes("attack_medium")) type = "med";
                    else if (src.includes("attack_large")) type = "grd";
                    else if (src.includes("snob") || src.includes("attack_snob")) type = "nob";
                }
                commandsData.push({ player: playerName, type });
            });
            return commandsData;
        } catch (e) { console.error("Erro ao ler aldeia:", villageId, e); return []; }
    }

    async function processOpVerification(coordsArray, btnElement, containerElement, countReturns) {
        btnElement.style.opacity = "0.7";
        btnElement.disabled = true;
        containerElement.innerHTML = "";

        const progressContainer = document.getElementById("onix-progress-container");
        const progressBar = document.getElementById("onix-progress-bar");
        progressContainer.style.display = "block";
        progressBar.style.width = "0%";

        let resultados = {};

        for (let i = 0; i < coordsArray.length; i++) {
            const coord = coordsArray[i];
            btnElement.textContent = `Lendo ${i + 1} de ${coordsArray.length}...`;

            const villageId = await getVillageIdByCoord(coord);
            if (villageId) {
                const commands = await fetchCommandsForVillage(villageId, countReturns);
                commands.forEach(cmd => {
                    if (!resultados[cmd.player]) resultados[cmd.player] = { peq: 0, med: 0, grd: 0, nob: 0 };
                    if (resultados[cmd.player][cmd.type] !== undefined) resultados[cmd.player][cmd.type]++;
                });
            }

            progressBar.style.width = `${((i + 1) / coordsArray.length) * 100}%`;
            await new Promise(r => setTimeout(r, 300));
        }

        renderResults(resultados, containerElement);
        btnElement.textContent = "Verificar";
        btnElement.style.opacity = "1";
        btnElement.disabled = false;

        setTimeout(() => {
            progressContainer.style.display = "none";
            progressBar.style.width = "0%";
        }, 600);
    }

    function renderResults(resultsMap, container) {
        const players = Object.keys(resultsMap);
        if (players.length === 0) {
            container.innerHTML = `<div style="color:#94a3b8;grid-column:1/-1;text-align:center;padding:20px;">Nenhum comando encontrado para estas coordenadas.</div>`;
            return;
        }
        let html = "";
        players.forEach(player => {
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

    function createApp() {
        const root = document.createElement("div");
        root.id = ROOT_ID;
        document.body.appendChild(root);

        root.innerHTML = `
        <style>
            #${ROOT_ID} * { box-sizing: border-box; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }

            /* Botão Flutuante — mantido igual ao original */
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

            /* Overlay */
            #${ROOT_ID} .onix-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.75); z-index: 999998; display: none; align-items: center; justify-content: center; padding: 20px; backdrop-filter: blur(4px); }
            #${ROOT_ID} .onix-overlay.show { display: flex; }

            /* Modal — tons mais claros de ardósia */
            #${ROOT_ID} .onix-modal { width: min(1000px, 100%); max-height: 90vh; display: flex; flex-direction: column; background: #1e293b; color: #e2e8f0; border-radius: 16px; border: 1px solid #334155; box-shadow: 0 25px 50px rgba(0,0,0,0.6); overflow: hidden; }

            /* Header */
            #${ROOT_ID} .onix-header { display: flex; justify-content: space-between; align-items: center; padding: 14px 20px; background: #0f172a; border-bottom: 1px solid #334155; }
            #${ROOT_ID} .onix-tabs { display: flex; gap: 8px; }
            #${ROOT_ID} .onix-tab-btn { background: transparent; color: #64748b; border: 1px solid transparent; border-radius: 8px; padding: 8px 14px; cursor: pointer; font-weight: 600; font-size: 13px; transition: all 0.2s; }
            #${ROOT_ID} .onix-tab-btn:hover { background: #1e293b; color: #e2e8f0; }
            #${ROOT_ID} .onix-tab-btn.active { background: #334155; color: #f1f5f9; border-color: #475569; }
            #${ROOT_ID} .onix-btn-close { background: #334155; color: #94a3b8; border: 1px solid #475569; padding: 7px 14px; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 13px; transition: all 0.2s; }
            #${ROOT_ID} .onix-btn-close:hover { background: #ef4444; color: #fff; border-color: #dc2626; }

            /* Barra de Progresso */
            #${ROOT_ID} .onix-progress-container { width: 100%; height: 3px; background: #334155; display: none; }
            #${ROOT_ID} .onix-progress-bar { height: 100%; width: 0%; background: #7c3aed; transition: width 0.3s ease; }

            /* Body */
            #${ROOT_ID} .onix-body { padding: 20px; overflow-y: auto; }
            #${ROOT_ID} .onix-tab-content { display: none; animation: onixFade 0.25s ease; }
            #${ROOT_ID} .onix-tab-content.active { display: block; }
            @keyframes onixFade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }

            /* Label e Textarea */
            #${ROOT_ID} label.onix-main-label { display: block; font-size: 11px; font-weight: 700; letter-spacing: 1.2px; color: #64748b; margin-bottom: 8px; text-transform: uppercase; }
            #${ROOT_ID} textarea { width: 100%; background: #0f172a; color: #cbd5e1; border: 1px solid #334155; border-radius: 8px; padding: 10px 12px; outline: none; min-height: 90px; resize: vertical; font-family: monospace; font-size: 13px; }
            #${ROOT_ID} textarea:focus { border-color: #475569; }

            /* Checkbox */
            #${ROOT_ID} .onix-checkbox-container { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
            #${ROOT_ID} .onix-checkbox-container input[type="checkbox"] { width: 15px; height: 15px; cursor: pointer; accent-color: #7c3aed; }
            #${ROOT_ID} .onix-checkbox-container label { color: #64748b; font-size: 13px; cursor: pointer; margin: 0; }

            /* Botões de Ação — mesmo tamanho */
            #${ROOT_ID} .onix-actions-row { display: flex; gap: 10px; margin-top: 14px; }
            #${ROOT_ID} .onix-btn-action,
            #${ROOT_ID} .onix-btn-clear {
                padding: 7px 18px; border-radius: 8px; cursor: pointer;
                font-weight: 600; font-size: 13px; transition: all 0.2s;
                white-space: nowrap;
            }
            #${ROOT_ID} .onix-btn-action { background: #7c3aed; color: #fff; border: 1px solid #6d28d9; }
            #${ROOT_ID} .onix-btn-action:hover { background: #6d28d9; }
            #${ROOT_ID} .onix-btn-action:disabled { background: #334155; color: #64748b; cursor: not-allowed; border-color: #334155; }
            #${ROOT_ID} .onix-btn-clear { background: #1e293b; color: #94a3b8; border: 1px solid #334155; }
            #${ROOT_ID} .onix-btn-clear:hover { background: #334155; color: #e2e8f0; }

            /* Cards */
            #${ROOT_ID} .onix-results-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px; margin-top: 20px; }
            #${ROOT_ID} .onix-card { background: #0f172a; border: 1px solid #334155; border-radius: 12px; padding: 14px; transition: border-color 0.2s; }
            #${ROOT_ID} .onix-card:hover { border-color: #475569; }
            #${ROOT_ID} .onix-card-title { font-size: 14px; font-weight: 700; color: #f1f5f9; margin-bottom: 10px; border-bottom: 1px solid #334155; padding-bottom: 8px; text-transform: uppercase; letter-spacing: 0.8px; }
            #${ROOT_ID} .onix-card-row { display: flex; justify-content: space-between; align-items: center; font-size: 13px; margin-bottom: 6px; color: #94a3b8; }
            #${ROOT_ID} .onix-card-row span.value { color: #f1f5f9; font-weight: 700; background: #1e293b; padding: 2px 8px; border-radius: 4px; border: 1px solid #334155; min-width: 28px; text-align: center; }

            /* Licença */
            #${ROOT_ID} .onix-license-box { background: #0f172a; padding: 30px; border-radius: 10px; border: 1px dashed #334155; text-align: center; }
            #${ROOT_ID} .onix-license-box h3 { color: #f1f5f9; margin-top: 0; text-transform: uppercase; font-size: 15px; letter-spacing: 1px; }
            #${ROOT_ID} .onix-license-box p { color: #64748b; margin: 0; font-size: 13px; }
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
                        <div class="onix-license-box">
                            <h3>Status da Licença</h3>
                            <p>Módulo de licença será implementado aqui.</p>
                        </div>
                    </div>
                    <div class="onix-tab-content" id="tab-verificar">
                        <label class="onix-main-label">Coordenadas verificadas</label>
                        <textarea id="onix-coords-input" placeholder="Cole as coordenadas ou a tabela do jogo aqui..."></textarea>
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

        const overlay      = root.querySelector("#onix-overlay");
        const btnOpen      = root.querySelector("#onix-btn-open");
        const btnClose     = root.querySelector("#onix-btn-close");
        const tabBtns      = root.querySelectorAll(".onix-tab-btn");
        const tabContents  = root.querySelectorAll(".onix-tab-content");
        const btnVerificar = root.querySelector("#onix-btn-verificar");
        const btnClear     = root.querySelector("#onix-btn-clear");
        const resultsContainer = root.querySelector("#onix-results-container");
        const coordsInput  = root.querySelector("#onix-coords-input");
        const checkReturns = root.querySelector("#onix-check-returns");

        coordsInput.addEventListener("paste", () => {
            setTimeout(() => {
                const coords = coordsInput.value.match(/\d{3}\|\d{3}/g);
                coordsInput.value = coords ? [...new Set(coords)].join(" ") : "";
            }, 50);
        });

        btnClear.addEventListener("click", () => {
            coordsInput.value = "";
            resultsContainer.innerHTML = "";
            checkReturns.checked = false;
        });

        btnOpen.addEventListener("click", () => overlay.classList.toggle("show"));
        btnClose.addEventListener("click", () => overlay.classList.remove("show"));
        overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.classList.remove("show"); });

        tabBtns.forEach(btn => {
            btn.addEventListener("click", () => {
                tabBtns.forEach(b => b.classList.remove("active"));
                tabContents.forEach(c => c.classList.remove("active"));
                btn.classList.add("active");
                root.querySelector(`#tab-${btn.dataset.tab}`).classList.add("active");
            });
        });

        btnVerificar.addEventListener("click", () => {
            const coords = coordsInput.value.match(/\d{3}\|\d{3}/g);
            const countReturns = checkReturns.checked;
            if (!coords || coords.length === 0) { alert("Nenhuma coordenada válida encontrada."); return; }
            const uniqueCoords = [...new Set(coords)];
            coordsInput.value = uniqueCoords.join(" ");
            processOpVerification(uniqueCoords, btnVerificar, resultsContainer, countReturns);
        });
    }

    waitForBody(createApp);
})();