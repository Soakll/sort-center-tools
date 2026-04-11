// ==UserScript==
// @name         YMS - Monitor de Docas e Pátio (Completo v9.1)
// @namespace    http://tampermonkey.net/
// @version      9.1
// @description  Botão Flutuante (Minimizado), sem auto-abrir, Bi-Trem, Placas e Live Timers.
// @match        https://trans-logistics.amazon.com/yms/shipclerk/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    if (!document.getElementById('yms-glass-style')) {
        const style = document.createElement('style');
        style.id = 'yms-glass-style';
        style.textContent = `
            .yms-glass-btn { background: rgba(88, 166, 255, 0.15); border: 1px solid rgba(88, 166, 255, 0.3); color: #58a6ff; border-radius: 6px; padding: 6px 12px; cursor: pointer; font-weight: 600; transition: all 0.2s; backdrop-filter: blur(4px); }
            .yms-glass-btn:hover { background: rgba(88, 166, 255, 0.25); box-shadow: 0 0 8px rgba(88,166,255,0.4); }
            .yms-glass-btn.active { background: rgba(168, 157, 255, 0.25); border-color: #a89dff; color: #d2a8ff; box-shadow: 0 0 10px rgba(168,157,255,0.3); }
            .yms-glass-panel { background: rgba(10, 22, 40, 0.85); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); border: 1px solid rgba(255, 255, 255, 0.1); color: #e6edf3; box-shadow: 0 8px 32px rgba(0,0,0,0.5); font-family: "Inter", "Amazon Ember", Arial, sans-serif; }
            .yms-glass-header { background: rgba(0,0,0,0.3); border-bottom: 1px solid rgba(255,255,255,0.1); padding: 12px 16px; cursor: move; display: flex; justify-content: space-between; align-items: center; border-radius: 8px 8px 0 0; }
            .yms-glass-title { font-size: 15px; font-weight: 800; background: linear-gradient(90deg, #a89dff, #58a6ff); -webkit-background-clip: text; -webkit-text-fill-color: transparent; letter-spacing: 0.5px; }
            .yms-glass-toolbar { display: flex; gap: 15px; padding: 12px 16px; background: rgba(0,0,0,0.2); border-bottom: 1px solid rgba(255,255,255,0.05); align-items: center; }
            .yms-glass-input { flex: 1; padding: 8px 12px; border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; font-size: 13px; background: rgba(0,0,0,0.3); color: #fff; outline: none; transition: border 0.2s; }
            .yms-glass-input:focus { border-color: #a89dff; box-shadow: 0 0 5px rgba(168,157,255,0.3); }
            .yms-glass-select { padding: 8px 12px; border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; font-size: 13px; background: rgba(0,0,0,0.3); color: #fff; cursor: pointer; outline: none; }
            .yms-glass-select option { background: #161b22; color: #fff; }
            .yms-table-container { flex: 1; overflow-y: auto; padding: 12px; min-width: 900px; display: block; }
            .yms-glass-table { width: 100%; border-collapse: separate; border-spacing: 0 4px; text-align: left; font-size: 12px; }
            .yms-glass-table th { padding: 8px 10px; color: #8b949e; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid rgba(255,255,255,0.1); }
            .yms-glass-table td { padding: 10px; background: rgba(255,255,255,0.02); border-top: 1px solid rgba(255,255,255,0.05); border-bottom: 1px solid rgba(255,255,255,0.05); vertical-align: middle; }
            .yms-glass-table tr:hover td { background: rgba(168,157,255,0.08); }
            .yms-glass-table td:first-child { border-left: 1px solid rgba(255,255,255,0.05); border-radius: 6px 0 0 6px; }
            .yms-glass-table td:last-child { border-right: 1px solid rgba(255,255,255,0.05); border-radius: 0 6px 6px 0; }
            .yms-sidebar { width: 280px; border-right: 1px solid rgba(255,255,255,0.1); padding: 16px; overflow-y: auto; font-size: 12px; background: rgba(0,0,0,0.15); }
            .yms-stat-card { margin-bottom: 16px; padding: 12px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; box-shadow: inset 0 0 20px rgba(0,0,0,0.2); }
            .yms-stat-card h4 { margin: 0 0 10px 0; padding-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.05); color: #a89dff; font-size: 14px; font-weight: 700; }
            .yms-stat-row { display: flex; justify-content: space-between; padding: 3px 0; color: #c9d1d9; }
            .yms-badge { padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 800; text-transform: uppercase; }
            .yms-badge.red { background: rgba(248,81,73,0.15); color: #ff7b72; border: 1px solid rgba(248,81,73,0.3); }
            .yms-badge.blue { background: rgba(88,166,255,0.15); color: #79c0ff; border: 1px solid rgba(88,166,255,0.3); }
            .yms-badge.purple { background: rgba(168,157,255,0.15); color: #d2a8ff; border: 1px solid rgba(168,157,255,0.3); }
            .yms-badge.green { background: rgba(46,160,67,0.15); color: #56d364; border: 1px solid rgba(46,160,67,0.3); }
            .yms-badge.orange { background: rgba(235,163,54,0.15); color: #e3b341; border: 1px solid rgba(235,163,54,0.3); }
            .yms-time-patio { color: #58a6ff; font-weight: 700; font-family: monospace; font-size: 13px; }
            .yms-time-doca { color: #ff7b72; font-weight: 700; font-family: monospace; font-size: 13px; }
            .yms-fab { position: fixed; bottom: 30px; right: 30px; padding: 12px 24px; background: rgba(10, 22, 40, 0.85); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border: 1px solid rgba(168,157,255,0.4); border-radius: 50px; color: #e6edf3; font-weight: 800; cursor: pointer; box-shadow: 0 4px 15px rgba(0,0,0,0.5), 0 0 15px rgba(168,157,255,0.2); z-index: 999999; display: flex; align-items: center; gap: 8px; transition: all 0.25s; }
            .yms-fab:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(0,0,0,0.6), 0 0 20px rgba(168,157,255,0.4); border-color: rgba(168,157,255,0.8); }
            
            /* Custom scrollbars */
            #yms-occupied-panel *::-webkit-scrollbar { width: 8px; height: 8px; }
            #yms-occupied-panel *::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); border-radius: 4px; }
            #yms-occupied-panel *::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 4px; }
            #yms-occupied-panel *::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.3); }

            /* Map Styles */
            .yms-map-container { padding: 20px; overflow: auto; display: none; gap: 30px; flex-direction: row; height: 100%; box-sizing: border-box; background: rgba(0,0,0,0.1); }
            .yms-map-container.active { display: flex; }
            .yms-list-container { display: none; height: 100%; width: 100%; }
            .yms-list-container.active { display: flex; }
            .yms-map-col-left { display: flex; flex-direction: column; width: 160px; flex-shrink: 0; }
            .yms-map-body { display: flex; flex-direction: column; gap: 30px; flex: 1; min-width: max-content; }
            .yms-map-box { border: 1px solid rgba(255,255,255,0.15); border-radius: 3px; font-size: 10px; font-family: monospace; text-align: center; padding: 4px 2px; background: rgba(255,255,255,0.03); color: #8b949e; transition: all 0.2s; white-space: nowrap; user-select: none; }
            .yms-map-box.occupied { background: rgba(248,81,73,0.15); border-color: rgba(248,81,73,0.5); color: #ff7b72; font-weight: bold; box-shadow: 0 0 10px rgba(248,81,73,0.2); }
            .yms-map-grid-of { display: grid; grid-template-rows: repeat(40, auto); grid-auto-flow: column; gap: 1px; }
            .yms-map-grid-of .yms-map-box { padding: 1px 2px; font-size: 9px; line-height: 1.1; }
            .yms-map-row-ps { display: flex; gap: 3px; justify-content: center; }
            .yms-map-row-dd { display: flex; gap: 3px; align-items: stretch; }
            .yms-map-divider { width: 3px; background: #a89dff; margin: 0 6px; border-radius: 2px; box-shadow: 0 0 5px rgba(168,157,255,0.8); }
            .yms-map-row-ps .yms-map-box { width: 45px; }
            .yms-map-row-dd .yms-map-box { width: 40px; }
            .yms-map-label { text-align: center; font-size: 11px; font-weight: bold; color: #a89dff; margin-bottom: 6px; text-transform: uppercase; background: rgba(168,157,255,0.1); padding: 4px; border-radius: 4px; }
            .yms-map-sublabel { text-align: center; font-size: 10px; color: #8b949e; font-weight: bold; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 4px; margin-top: 4px; }
            #yms-occupied-panel *::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); border-radius: 4px; }
            #yms-occupied-panel *::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 4px; }
            #yms-occupied-panel *::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.3); }
        `;
        document.head.appendChild(style);
    }

    let lastYmsData = null;
    let autoRefreshTimer = null;

    // --- 1. CRIAÇÃO DO PAINEL E BOTÃO FLUTUANTE (UI) ---
    const panelId = 'yms-occupied-panel';
    const minBtnId = 'yms-min-btn';

    let panel = document.getElementById(panelId);
    let minBtn = document.getElementById(minBtnId);

    // Criação do Botão Minimizado
    if (!minBtn) {
        minBtn = document.createElement('button');
        minBtn.id = minBtnId;
        minBtn.innerHTML = '<span style="font-size:16px;">🚚</span> <span style="background: linear-gradient(90deg, #a89dff, #58a6ff); -webkit-background-clip: text; -webkit-text-fill-color: transparent; letter-spacing:0.5px;">YMS Monitor</span>';
        minBtn.className = 'yms-fab';

        minBtn.onmouseover = () => minBtn.style.transform = 'scale(1.05)';
        minBtn.onmouseout = () => minBtn.style.transform = 'scale(1)';

        document.body.appendChild(minBtn);
    }


    // Hard-reset do painel caso ele seja da versão antiga (sem tabs) para forçar o reinjetamento
    if (panel && !document.getElementById('yms-tab-list')) {
        panel.remove();
        panel = null;
    }

    // Criação do Painel Principal
    if (!panel) {
        panel = document.createElement('div');
        panel.id = panelId;
        panel.innerHTML = `
            <div class="yms-glass-header" id="yms-panel-header">
                <span class="yms-glass-title">🚚 YMS Monitor - Planta</span>
                <div style="display:flex; gap: 10px; align-items: center;">
                    <button id="yms-refresh-btn" class="yms-glass-btn">↻ Atualizar</button>
                    <button id="yms-close-btn" style="background:none; border:none; color:#8b949e; font-size:16px; cursor:pointer; transition: color 0.2s;" onmouseover="this.style.color='#fff'" onmouseout="this.style.color='#8b949e'">✖</button>
                </div>
            </div>

            <div class="yms-glass-toolbar">
                <div style="display:flex; gap: 8px; margin-right: 15px;">
                    <button id="yms-tab-list" class="yms-glass-btn active">Lista</button>
                    <button id="yms-tab-map" class="yms-glass-btn">Mapa Físico</button>
                </div>
                <input type="text" id="yms-search" class="yms-glass-input" placeholder="🔍 Pesquisar placa, doca, lane, vrid...">
                <select id="yms-auto-refresh" class="yms-glass-select">
                    <option value="0">Auto-Refresh: Desativado</option>
                    <option value="5">A cada 5 min</option>
                    <option value="10">A cada 10 min</option>
                    <option value="15">A cada 15 min</option>
                </select>
            </div>

            <div style="display: flex; flex: 1; overflow: hidden; position: relative; width: 100%;">

                <div id="yms-view-list" class="yms-list-container active">
                    <div id="yms-sidebar" class="yms-sidebar">
                        <div style="text-align:center; padding:20px; color:#8b949e;">Aguardando dados...</div>
                    </div>

                    <div id="yms-panel-content" class="yms-table-container">
                        <table class="yms-glass-table">
                            <thead>
                                <tr>
                                    <th>VRID</th>
                                    <th>Placas (Cav/Baú)</th>
                                    <th>Lane</th>
                                    <th>Posição</th>
                                    <th>Chegada Doca</th>
                                    <th>Chegada Pátio</th>
                                    <th>⏳ Tempo Pátio</th>
                                    <th>⏱️ Tempo Doca</th>
                                </tr>
                            </thead>
                            <tbody id="yms-table-body">
                                <tr><td colspan="8" style="text-align:center; padding:30px; color:#8b949e;">Aguardando dados da API...</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <div id="yms-view-map" class="yms-map-container">
                    <div class="yms-map-col-left">
                        <div class="yms-map-label">Externo</div>
                        <div id="yms-map-grid-externo" class="yms-map-grid-of"></div>
                    </div>
                    <div class="yms-map-body">
                        <div>
                            <div class="yms-map-label">Vagas de Espera</div>
                            <div id="yms-map-row-ps" class="yms-map-row-ps"></div>
                        </div>
                        <div>
                            <div class="yms-map-label" style="display:flex;">
                                <div style="flex:10;">INBOUND</div>
                                <div style="flex:23;">OUTBOUND</div>
                                <div style="flex:4;">REVERSA</div>
                            </div>
                            <div id="yms-map-row-dd" class="yms-map-row-dd"></div>
                            <div style="display:flex; margin-top:2px;">
                                <div class="yms-map-sublabel" style="flex:10;">DD95 a DD86</div>
                                <div class="yms-map-sublabel" style="flex:23;">DD85 a DD63</div>
                                <div class="yms-map-sublabel" style="flex:4;">DD62 a DD59</div>
                            </div>
                        </div>
                    </div>
                </div>

            </div>
        `;

        panel.className = 'yms-glass-panel';
        Object.assign(panel.style, {
            position: 'fixed',
            top: '0px',
            left: '0px',
            width: '100vw',
            height: '100vh',
            zIndex: '999999',
            borderRadius: '0px',
            display: 'none', // <--- COMEÇA ESCONDIDO
            flexDirection: 'column'
        });

        document.body.appendChild(panel);

        // Interações de Abrir e Fechar
        minBtn.addEventListener('click', () => {
            panel.style.display = 'flex';
            minBtn.style.display = 'none';
        });

        document.getElementById('yms-close-btn').addEventListener('click', () => {
            panel.style.display = 'none';
            minBtn.style.display = 'block';
        });

        // Lógica de arrastar o painel
        const header = document.getElementById('yms-panel-header');
        let isDragging = false, startX, startY, initialX, initialY;

        header.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            initialX = panel.offsetLeft;
            initialY = panel.offsetTop;
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            panel.style.left = `${initialX + (e.clientX - startX)}px`;
            panel.style.top = `${initialY + (e.clientY - startY)}px`;
            panel.style.right = 'auto';
        });

        document.addEventListener('mouseup', () => { isDragging = false; });

        // Ações de Botões e Inputs
        function triggerNativeRefresh() {
            const refreshNodes = Array.from(document.querySelectorAll('*')).filter(el =>
                el.textContent && el.textContent.trim() === 'Refresh data' &&
                (el.tagName === 'A' || el.tagName === 'BUTTON' || el.tagName === 'SPAN')
            );
            if (refreshNodes.length > 0) {
                refreshNodes[refreshNodes.length - 1].click();
            } else if (lastYmsData) {
                updateDashboard(lastYmsData);
                updateLiveTimers();
            }
        }

        document.getElementById('yms-refresh-btn').addEventListener('click', () => {
            triggerNativeRefresh();
            const btn = document.getElementById('yms-refresh-btn');
            btn.innerText = "Atualizado!";
            setTimeout(() => btn.innerText = "↻ Forçar Atualização", 1500);
        });

        document.getElementById('yms-search').addEventListener('input', function (e) {
            applySearchFilter(e.target.value);
        });

        document.getElementById('yms-tab-list').addEventListener('click', () => {
            document.getElementById('yms-tab-list').classList.add('active');
            document.getElementById('yms-tab-map').classList.remove('active');
            document.getElementById('yms-view-list').classList.add('active');
            document.getElementById('yms-view-map').classList.remove('active');
        });

        document.getElementById('yms-tab-map').addEventListener('click', () => {
            document.getElementById('yms-tab-map').classList.add('active');
            document.getElementById('yms-tab-list').classList.remove('active');
            document.getElementById('yms-view-map').classList.add('active');
            document.getElementById('yms-view-list').classList.remove('active');
        });

        document.getElementById('yms-auto-refresh').addEventListener('change', function (e) {
            const mins = parseInt(e.target.value, 10);
            if (autoRefreshTimer) clearInterval(autoRefreshTimer);

            if (mins > 0) {
                autoRefreshTimer = setInterval(() => {
                    triggerNativeRefresh();
                }, mins * 60 * 1000);
            }
        });
    }

    // --- 2. FUNÇÕES DE FILTRO E TEMPO ---
    function applySearchFilter(term) {
        const lowerTerm = term.toLowerCase();
        const rows = document.querySelectorAll('#yms-table-body tr');
        rows.forEach(row => {
            if (row.cells.length <= 1) return;
            const text = row.textContent.toLowerCase();
            row.style.display = text.includes(lowerTerm) ? '' : 'none';
        });
    }

    function formatTime(epochSeconds) {
        if (!epochSeconds) return '-';
        const date = new Date(epochSeconds * 1000);
        return date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    }

    function getElapsedTime(start, end = null) {
        if (!start) return '-';
        const endTime = end ? end : (Date.now() / 1000);
        const diff = Math.floor(Math.max(0, endTime - start));

        const hours = Math.floor(diff / 3600);
        const minutes = Math.floor((diff % 3600) / 60);
        const seconds = diff % 60;

        const m = minutes.toString().padStart(2, '0');
        const s = seconds.toString().padStart(2, '0');

        return `${hours}h ${m}m ${s}s`;
    }

    function updateLiveTimers() {
        const now = Date.now() / 1000;
        document.querySelectorAll('.yms-live-timer').forEach(el => {
            const start = parseFloat(el.getAttribute('data-start'));
            el.innerText = getElapsedTime(start, now);
        });
    }

    setInterval(updateLiveTimers, 1000);

    function getPctColorGlass(pct) {
        if (pct >= 85) return '#ff7b72'; // red
        if (pct >= 50) return '#e3b341'; // yellow
        return '#56d364'; // green
    }

    // --- 3. PROCESSAMENTO DOS DADOS ---
    function renderYmsMap(occupiedSet) {
        let htmlOf = '';
        for (let i = 1; i <= 83; i++) {
            const code = 'OF-' + String(i).padStart(2, '0');
            const occ = occupiedSet.has(code) ? ' occupied' : '';
            htmlOf += `<div class="yms-map-box${occ}">${code}</div>`;
        }
        document.getElementById('yms-map-grid-externo').innerHTML = htmlOf;

        let htmlPs = '';
        for (let i = 501; i <= 529; i++) {
            const code = 'PS' + i;
            const occ = occupiedSet.has(code) ? ' occupied' : '';
            htmlPs += `<div class="yms-map-box${occ}">${code}</div>`;
        }
        document.getElementById('yms-map-row-ps').innerHTML = htmlPs;

        let htmlDd = '';
        for (let i = 95; i >= 59; i--) {
            if (i === 85 || i === 62) {
                htmlDd += `<div class="yms-map-divider"></div>`;
            }
            const code = 'DD' + i;
            const occ = occupiedSet.has(code) ? ' occupied' : '';
            htmlDd += `<div class="yms-map-box${occ}">${code}</div>`;
        }
        document.getElementById('yms-map-row-dd').innerHTML = htmlDd;
    }

    function updateDashboard(jsonData) {
        lastYmsData = jsonData;

        const tbody = document.getElementById('yms-table-body');
        const sidebar = document.getElementById('yms-sidebar');

        let htmlTable = '';
        let occupiedSet = new Set();
        let stats = {
            DD: { total: 0, occupied: 0, freeList: [], occupiedList: [] },
            PS: { total: 0, occupied: 0, freeList: [], occupiedList: [] }
        };

        try {
            const summaries = jsonData.locationsSummaries || [];

            // --- PASSO 1: MAPEAMENTO DE BI-TREM ---
            const plateToVrids = {};
            summaries.forEach(summary => {
                (summary.locations || []).forEach(loc => {
                    if (loc.yardAssets && loc.yardAssets.length > 0) {
                        let tempVrid = '-';
                        if (loc.yardAssets[0].load?.identifiers) {
                            const vObj = loc.yardAssets[0].load.identifiers.find(id => id.type === 'VR_ID');
                            if (vObj) tempVrid = vObj.identifier;
                        }

                        let tempPlacaCavalo = null;
                        loc.yardAssets.forEach(asset => {
                            const p = asset.licensePlateIdentifier?.registrationIdentifier || asset.vehicleNumber;
                            if (asset.type === 'TRACTOR' || asset.type === 'BOX_TRUCK') tempPlacaCavalo = p;
                            else if (!tempPlacaCavalo && asset.type !== 'TRAILER') tempPlacaCavalo = p;
                        });

                        if (tempPlacaCavalo && tempVrid !== '-') {
                            if (!plateToVrids[tempPlacaCavalo]) plateToVrids[tempPlacaCavalo] = new Set();
                            plateToVrids[tempPlacaCavalo].add(tempVrid);
                        }
                    }
                });
            });

            // --- PASSO 2: MONTAGEM DA TABELA ---
            summaries.forEach(summary => {
                const locations = summary.locations || [];

                locations.forEach(loc => {
                    const code = loc.code || loc.name;
                    const isOccupied = loc.yardAssets && loc.yardAssets.length > 0;
                    const isDD = code.startsWith('DD');
                    const isPS = code.startsWith('PS');

                    if (isOccupied) occupiedSet.add(code);

                    if (isDD) {
                        stats.DD.total++;
                        if (isOccupied) { stats.DD.occupied++; stats.DD.occupiedList.push(code); }
                        else { stats.DD.freeList.push(code); }
                    } else if (isPS) {
                        stats.PS.total++;
                        if (isOccupied) { stats.PS.occupied++; stats.PS.occupiedList.push(code); }
                        else { stats.PS.freeList.push(code); }
                    }

                    if (isOccupied) {
                        const primaryAsset = loc.yardAssets[0];

                        let vrid = '-';
                        if (primaryAsset.load && primaryAsset.load.identifiers) {
                            const vridObj = primaryAsset.load.identifiers.find(id => id.type === 'VR_ID');
                            if (vridObj) vrid = vridObj.identifier;
                        }

                        let placaCavalo = null;
                        let placaBau = null;

                        loc.yardAssets.forEach(asset => {
                            const placaExtraida = asset.licensePlateIdentifier?.registrationIdentifier || asset.vehicleNumber;

                            if (asset.type === 'TRACTOR' || asset.type === 'BOX_TRUCK') {
                                placaCavalo = placaExtraida;
                            } else if (asset.type === 'TRAILER') {
                                placaBau = placaExtraida;
                            } else {
                                if (!placaCavalo) placaCavalo = placaExtraida;
                            }
                        });

                        let displayVrid = `<strong style="color:#e6edf3;">${vrid}</strong>`;
                        if (placaCavalo && plateToVrids[placaCavalo] && plateToVrids[placaCavalo].size > 1) {
                            displayVrid += `<br><span class="yms-badge purple" style="display:inline-block; margin-top:4px;">Bi-Trem</span>`;
                        }

                        let displayPlacas = placaCavalo ? `<strong style="color:#58a6ff;">${placaCavalo}</strong>` : '<strong style="color:#8b949e;">-</strong>';
                        if (placaBau && placaBau !== placaCavalo) {
                            displayPlacas += `<br><span style="color:#8b949e; font-size:11px;">${placaBau}</span>`;
                        }

                        const lane = primaryAsset.load?.lane || '-';
                        const arrivalLoc = primaryAsset.datetimeOfArrivalAtLocation;
                        const arrivalYard = primaryAsset.datetimeOfArrivalInYard;

                        const codeBadge = `<span class="yms-badge ${isDD ? 'red' : 'blue'}">${code}</span>`;

                        let strTempoPatio = '-';
                        let strTempoDoca = '-';

                        if (isDD) {
                            strTempoPatio = `<span style="color: #8b949e; font-size:11px;">${getElapsedTime(arrivalYard, arrivalLoc)}</span>`;
                            strTempoDoca = `<span class="yms-live-timer yms-time-doca" data-start="${arrivalLoc}">--h --m --s</span>`;
                        } else {
                            strTempoPatio = `<span class="yms-live-timer yms-time-patio" data-start="${arrivalYard}">--h --m --s</span>`;
                            strTempoDoca = `<span style="color: #484f58;">-</span>`;
                        }

                        htmlTable += `
                            <tr>
                                <td>${displayVrid}</td>
                                <td>${displayPlacas}</td>
                                <td><span style="color:#e6edf3; font-weight:600;">${lane}</span></td>
                                <td>${codeBadge}</td>
                                <td style="color:#c9d1d9;">${formatTime(arrivalLoc)}</td>
                                <td style="color:#c9d1d9;">${formatTime(arrivalYard)}</td>
                                <td>${strTempoPatio}</td>
                                <td>${strTempoDoca}</td>
                            </tr>
                        `;
                    }
                });
            });

            if (htmlTable === '') {
                htmlTable = '<tr><td colspan="8" style="text-align:center; padding:30px; color:#8b949e;">Nenhum caminhão alocado no momento.</td></tr>';
            }
            tbody.innerHTML = htmlTable;

            const pctDD = stats.DD.total > 0 ? ((stats.DD.occupied / stats.DD.total) * 100).toFixed(1) : 0;
            const pctPS = stats.PS.total > 0 ? ((stats.PS.occupied / stats.PS.total) * 100).toFixed(1) : 0;

            sidebar.innerHTML = `
                <div class="yms-stat-card">
                    <h4>Docas (DD)</h4>
                    <div class="yms-stat-row"><span>Total:</span> <strong style="color:#e6edf3;">${stats.DD.total}</strong></div>
                    <div class="yms-stat-row"><span>Livres:</span> <span style="color:#56d364; font-weight:bold;">${stats.DD.freeList.length}</span></div>
                    <div class="yms-stat-row">
                        <span>Ocupadas:</span>
                        <span><strong style="color:#ff7b72;">${stats.DD.occupied}</strong> <span style="color:${getPctColorGlass(pctDD)}; font-weight:bold; font-size:10px;">(${pctDD}%)</span></span>
                    </div>
                </div>

                <div class="yms-stat-card">
                    <h4>Pátio (PS)</h4>
                    <div class="yms-stat-row"><span>Total:</span> <strong style="color:#e6edf3;">${stats.PS.total}</strong></div>
                    <div class="yms-stat-row"><span>Livres:</span> <span style="color:#56d364; font-weight:bold;">${stats.PS.freeList.length}</span></div>
                    <div class="yms-stat-row">
                        <span>Ocupados:</span>
                        <span><strong style="color:#ff7b72;">${stats.PS.occupied}</strong> <span style="color:${getPctColorGlass(pctPS)}; font-weight:bold; font-size:10px;">(${pctPS}%)</span></span>
                    </div>
                </div>

                <div class="yms-stat-card" style="border-color: rgba(46,160,67,0.3); background: rgba(46,160,67,0.05);">
                    <h4 style="color:#56d364; border-bottom-color: rgba(46,160,67,0.2);">✅ Posições Livres</h4>
                    <div style="max-height:80px; overflow-y:auto; margin-bottom:6px; font-size:11px; color:#c9d1d9;">
                        <strong style="color:#8b949e;">DD:</strong> ${stats.DD.freeList.join(', ') || '-'}
                    </div>
                    <div style="max-height:80px; overflow-y:auto; font-size:11px; color:#c9d1d9;">
                        <strong style="color:#8b949e;">PS:</strong> ${stats.PS.freeList.join(', ') || '-'}
                    </div>
                </div>

                <div class="yms-stat-card" style="border-color: rgba(248,81,73,0.3); background: rgba(248,81,73,0.05);">
                    <h4 style="color:#ff7b72; border-bottom-color: rgba(248,81,73,0.2);">🚫 Posições Ocupadas</h4>
                    <div style="max-height:80px; overflow-y:auto; margin-bottom:6px; font-size:11px; color:#c9d1d9;">
                        <strong style="color:#8b949e;">DD:</strong> ${stats.DD.occupiedList.join(', ') || '-'}
                    </div>
                    <div style="max-height:80px; overflow-y:auto; font-size:11px; color:#c9d1d9;">
                        <strong style="color:#8b949e;">PS:</strong> ${stats.PS.occupiedList.join(', ') || '-'}
                    </div>
                </div>
            `;

            // Removemos a linha que forçava abrir (panel.style.display = 'flex')

            renderYmsMap(occupiedSet);
            updateLiveTimers();

            const currentSearch = document.getElementById('yms-search').value;
            if (currentSearch) applySearchFilter(currentSearch);

        } catch (error) {
            console.error("Erro ao processar dados do YMS:", error);
        }
    }

    // --- 4. INTERCEPTADOR DE REDE ---
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
        const response = await originalFetch.apply(this, args);
        try {
            const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
            if (url.includes('getYardStateWithPendingMoves')) {
                const clone = response.clone();
                clone.json().then(data => updateDashboard(data)).catch(e => { });
            }
        } catch (e) { }
        return response;
    };

    const originalXHR = window.XMLHttpRequest;
    function newXHR() {
        const xhr = new originalXHR();
        xhr.addEventListener('load', function () {
            try {
                if (xhr.responseURL && xhr.responseURL.includes('getYardStateWithPendingMoves')) {
                    updateDashboard(JSON.parse(xhr.responseText));
                }
            } catch (e) { }
        });
        return xhr;
    }
    window.XMLHttpRequest = newXHR;

})();