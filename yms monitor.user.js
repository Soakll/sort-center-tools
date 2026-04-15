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
            input[type=number]::-webkit-inner-spin-button, input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none !important; margin: 0 !important; }
            input[type=number] { -moz-appearance: textfield !important; }
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
            .yms-map-container { padding: 15px; overflow: auto; display: none; gap: 15px; flex-direction: column; align-items: center; height: 100%; width: 100%; flex: 1; box-sizing: border-box; background: rgba(10, 15, 25, 0.4); }
            .yms-map-container.active { display: flex; }
            .yms-list-container { display: none; height: 100%; width: 100%; }
            .yms-list-container.active { display: flex; }
            .yms-map-body { display: flex; flex-direction: column; gap: 8px; align-items: center; width: 100%; margin: 0 auto; position: relative; }
            .yms-map-site-summary { display: flex; gap: 40px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); padding: 8px 30px; border-radius: 50px; font-size: 13px; font-weight: 800; margin-bottom: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.3); backdrop-filter: blur(10px); text-transform: uppercase; letter-spacing: 1px; }
            .yms-map-block { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); padding: 6px 15px; border-radius: 12px; width: fit-content; min-width: 300px; display: flex; flex-direction: column; align-items: center; box-shadow: 0 4px 15px rgba(0,0,0,0.2); backdrop-filter: blur(12px); margin: 0 auto; }
            .yms-map-box { border: 1px solid rgba(255,255,255,0.12); border-radius: 4px; font-size: 10px; font-family: "JetBrains Mono", monospace; text-align: center; padding: 4px; background: rgba(255,255,255,0.02); color: #8b949e; transition: all 0.2s; white-space: nowrap; user-select: none; width: 42px; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 50px; box-sizing: border-box; }
            .yms-map-box.occupied { background: rgba(248,81,73,0.18); border-color: rgba(248,81,73,0.6); color: #ff7b72; font-weight: bold; box-shadow: 0 0 10px rgba(248,81,73,0.25); transform: scale(1.02); width: auto; min-width: 65px; height: 50px; }
            .yms-map-grid-of { display: flex; gap: 4px; justify-content: center; flex-wrap: nowrap; overflow-x: auto; width: 100%; padding-bottom: 3px; }
            .yms-map-row-ps { display: flex; gap: 6px; justify-content: center; align-items: center; flex-wrap: nowrap; overflow-x: auto; width: 100%; padding: 2px 0; min-height: 85px; }
            .yms-map-row-dd { display: flex; gap: 6px; justify-content: center; align-items: center; flex-wrap: wrap; width: 100%; min-height: 85px; }
            .yms-map-label { text-align: center; font-size: 10px; font-weight: 900; color: #a89dff; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 2px; background: rgba(168,157,255,0.05); padding: 2px 12px; border-radius: 50px; border: 1px solid rgba(168,157,255,0.1); }
            .yms-map-sublabel { text-align: center; font-size: 9px; color: #8b949e; font-weight: 600; margin: 4px auto 0 auto; padding-top: 2px; border-top: 1px solid rgba(255,255,255,0.1); width: fit-content; min-width: 150px; }
            #yms-occupied-panel *::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); border-radius: 4px; }
            #yms-occupied-panel *::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 4px; }
            #yms-occupied-panel *::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.3); }
        `;
        document.head.appendChild(style);
    }

    let lastYmsData = null;
    let autoRefreshTimer = null;
    let nextRefreshTime = null;
    let lastYardStateUrl = null;
    let lastYardStateHeaders = null;
    let lastYardStateMethod = 'GET';
    let lastYardStateBody = null;
    let cptMap = new Map();

    function formatCpt(cptStr) {
        if (!cptStr) return '-';
        // Entrada: "14-Apr-26 01:00"
        // Saída esperada: "14/04 01:00"
        const months = {
            'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04', 'May': '05', 'Jun': '06',
            'Jul': '07', 'Aug': '08', 'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
        };
        const parts = cptStr.split(/[-\s:]/);
        if (parts.length >= 4) {
            const day = parts[0].padStart(2, '0');
            const month = months[parts[1]] || '00';
            const hours = parts[3].padStart(2, '0');
            const minutes = parts[4].padStart(2, '0');
            return `${day}/${month} ${hours}:${minutes}`;
        }
        return cptStr;
    }

    async function fetchExtraData() {
        const nodeId = window.location.pathname.split('/')[3] || 'CGH7';
        const obUrl = 'https://trans-logistics.amazon.com/ssp/dock/hrz/ob/fetchdata';
        const ibUrl = 'https://trans-logistics.amazon.com/ssp/dock/hrz/ib/fetchdata';
        
        const today = new Date();
        today.setHours(0,0,0,0);
        const startDate = today.getTime();
        today.setHours(23,30,0,0);
        const endDate = today.getTime();

        const headers = {
            'Content-Type': 'application/x-www-form-urlencoded',
            ...(lastYardStateHeaders || {})
        };

        const createBody = (entity, categories) => {
            const body = new URLSearchParams();
            body.append('entity', entity);
            body.append('nodeId', nodeId);
            body.append('startDate', startDate);
            body.append('endDate', endDate);
            body.append('loadCategories', categories);
            body.append('shippingPurposeType', 'TRANSSHIPMENT,NON-TRANSSHIPMENT,SHIP_WITH_AMAZON');
            return body.toString();
        };

        try {
            // Outbound (CPT)
            const obResp = await fetch(obUrl, {
                method: 'POST',
                headers,
                body: createBody('getOutboundDockView', 'outboundScheduled,outboundInProgress,outboundReadyToDepart,outboundDeparted,outboundCancelled')
            });
            const obJson = await obResp.json();
            (obJson.ret?.aaData || []).forEach(item => {
                if (item.load && item.load.vrId) {
                    cptMap.set(item.load.vrId, formatCpt(item.load.criticalPullTime));
                }
            });

            // Inbound (SAT)
            const ibResp = await fetch(ibUrl, {
                method: 'POST',
                headers,
                body: createBody('getInboundDockView', 'inboundScheduled,inboundArrived,inboundCompleted')
            });
            const ibJson = await ibResp.json();
            (ibJson.ret?.aaData || []).forEach(item => {
                if (item.load && item.load.vrId) {
                    // Só adiciona se não tiver CPT já definido ou se o CPT for vazio
                    const vrId = item.load.vrId;
                    const sat = formatCpt(item.load.scheduledArrivalTime);
                    if (!cptMap.has(vrId) || cptMap.get(vrId) === '-') {
                        cptMap.set(vrId, sat);
                    }
                }
            });
        } catch (e) {
            console.error('YMS Monitor: Erro ao buscar dados extras (CPT/SAT)', e);
        }
    }

    async function triggerDataRefresh() {
        if (!lastYardStateUrl) {
            const refreshBtn = document.querySelector('button[data-testid="refresh-button"]');
            if (refreshBtn) refreshBtn.click();
            else location.reload();
            return;
        }

        try {
            const refreshBtn = document.getElementById('yms-refresh-btn');
            if (refreshBtn) {
                refreshBtn.innerText = 'Atualizando...';
                refreshBtn.style.opacity = '0.5';
            }

            // Busca dados extras em paralelo
            fetchExtraData();

            const fetchOptions = {
                method: lastYardStateMethod || 'GET',
                headers: lastYardStateHeaders || {}
            };
            
            if (lastYardStateMethod === 'POST' && lastYardStateBody) {
                fetchOptions.body = lastYardStateBody;
            }

            const response = await fetch(lastYardStateUrl, fetchOptions);
            const data = await response.json();
            
            if (data) {
                updateDashboard(data);
            }

            if (refreshBtn) {
                refreshBtn.innerText = 'Atualizar';
                refreshBtn.style.opacity = '1';
            }
        } catch (e) {
            console.error('YMS Monitor: Erro no refresh silencioso', e);
            const refreshBtnNative = document.querySelector('button[data-testid="refresh-button"]');
            if (refreshBtnNative) refreshBtnNative.click();
        }
    }

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

    if (!panel) {
        panel = document.createElement('div');
        panel.id = panelId;
        panel.innerHTML = `
            <div id="yms-panel-header" class="yms-glass-header" style="display: grid; grid-template-columns: 250px 1fr 250px; align-items: center; padding: 0 20px;">
                <!-- ESQUERDA: Título -->
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="font-size:16px;">🚚</span>
                    <span style="font-weight:bold; letter-spacing:1px; white-space: nowrap;">YMS Monitor - Planta</span>
                </div>

                <!-- CENTRO: Controles Principais -->
                <div style="display:flex; align-items:center; gap:15px; justify-content: center;">
                    <!-- Tabs -->
                    <div style="display:flex; gap: 4px; background: rgba(255,255,255,0.05); padding: 2px; border-radius: 8px;">
                        <button id="yms-tab-list" class="yms-glass-btn active" style="padding: 4px 12px; font-size: 11px; border: none;">Lista</button>
                        <button id="yms-tab-map" class="yms-glass-btn" style="padding: 4px 12px; font-size: 11px; border: none;">Mapa Físico</button>
                    </div>

                    <!-- Zoom -->
                    <div style="display:flex; gap: 2px; align-items:center; background: rgba(255,255,255,0.05); padding: 2px; border-radius: 8px;">
                        <button id="yms-zoom-out" class="yms-glass-btn" style="padding: 2px 10px; font-weight: bold; border: none; background: transparent;">-</button>
                        <button id="yms-zoom-reset" class="yms-glass-btn" style="padding: 4px 8px; font-size: 10px; border: none; background: rgba(255,255,255,0.05);">100%</button>
                        <button id="yms-zoom-in" class="yms-glass-btn" style="padding: 2px 10px; font-weight: bold; border: none; background: transparent;">+</button>
                    </div>

                    <!-- Search -->
                    <div style="position: relative; display: flex; align-items: center;">
                        <input type="text" id="yms-search" class="yms-glass-input" placeholder="Pesquisar..." style="width: 180px; height: 28px; font-size: 11px; margin: 0; padding-left: 25px; background: rgba(0,0,0,0.2);">
                        <span style="position: absolute; left: 8px; font-size: 10px; opacity: 0.5;">🔍</span>
                    </div>

                    <!-- Auto-Refresh -->
                    <div style="display:flex; align-items:center; gap: 8px; background: rgba(0,0,0,0.2); padding: 2px 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
                        <select id="yms-auto-refresh" class="yms-glass-select" style="height: 24px; font-size: 10px; background: transparent; border: none; padding-right: 5px; cursor: pointer;">
                            <option value="0">Off</option>
                            <option value="1">1m</option>
                            <option value="2">2m</option>
                            <option value="5">5m</option>
                            <option value="10">10m</option>
                        </select>
                        <span id="yms-refresh-countdown" style="font-size: 11px; color: #a89dff; min-width: 35px; font-family: monospace; font-weight: bold;">--:--</span>
                    </div>
                </div>

                <!-- DIREITA: Ações -->
                <div style="display:flex; gap:10px; justify-content: flex-end;">
                    <button id="yms-refresh-btn" class="yms-glass-btn" style="background: rgba(168,157,255,0.1); color: #a89dff; font-size: 11px; height: 28px; border: 1px solid rgba(168,157,255,0.2);">Atualizar</button>
                    <button id="yms-close-btn" class="yms-glass-btn" style="height: 28px; width: 28px; padding: 0; display: flex; align-items: center; justify-content: center;">✕</button>
                </div>
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
                                    <th>CPT</th>
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
                                <tr><td colspan="9" style="text-align:center; padding:30px; color:#8b949e;">Aguardando dados da API...</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <div id="yms-view-map" class="yms-map-container">
                    <div class="yms-map-body">
                        <div id="yms-site-summary" class="yms-map-site-summary"></div>
                        <div class="yms-map-block" style="width: fit-content; max-width: 95vw;">
                            <div id="yms-label-ps" class="yms-map-label">VAGAS DE ESPERA</div>
                            <div id="yms-map-row-ps" class="yms-map-row-ps"></div>
                            <div class="yms-map-sublabel">PS501 a PS529</div>
                        </div>
                        <div class="yms-map-block">
                            <div id="yms-label-in" class="yms-map-label">INBOUND</div>
                            <div id="yms-map-row-in" class="yms-map-row-dd"></div>
                            <div class="yms-map-sublabel">DD95 a DD86</div>
                        </div>
                        <div class="yms-map-block">
                            <div id="yms-label-out" class="yms-map-label">OUTBOUND</div>
                            <div id="yms-map-row-out" class="yms-map-row-dd"></div>
                            <div class="yms-map-sublabel">DD85 a DD63</div>
                        </div>
                        <div class="yms-map-block">
                            <div id="yms-label-rev" class="yms-map-label">REVERSA</div>
                            <div id="yms-map-row-rev" class="yms-map-row-dd"></div>
                            <div class="yms-map-sublabel">DD62 a DD59</div>
                        </div>
                        <div class="yms-map-block">
                            <div id="yms-label-of" class="yms-map-label">EXTERNO (OF)</div>
                            <div id="yms-map-grid-externo" class="yms-map-grid-of"></div>
                            <div class="yms-map-sublabel">OF-01 a OF-83</div>
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
            display: 'none',
            flexDirection: 'column'
        });

        document.body.appendChild(panel);

        minBtn.addEventListener('click', () => {
            panel.style.display = 'flex';
            minBtn.style.display = 'none';
        });

        function updateCountdownUI() {
            const el = document.getElementById('yms-refresh-countdown');
            if (!el) return;
            if (!nextRefreshTime) {
                el.innerText = '--:--';
                return;
            }
            const remaining = Math.max(0, Math.floor((nextRefreshTime - Date.now()) / 1000));
            const m = Math.floor(remaining / 60);
            const s = remaining % 60;
            el.innerText = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        }

        document.getElementById('yms-tab-list').addEventListener('click', () => {
            document.getElementById('yms-view-list').classList.add('active');
            document.getElementById('yms-view-map').classList.remove('active');
            document.getElementById('yms-tab-list').classList.add('active');
            document.getElementById('yms-tab-map').classList.remove('active');
        });

        document.getElementById('yms-tab-map').addEventListener('click', () => {
            document.getElementById('yms-view-list').classList.remove('active');
            document.getElementById('yms-view-map').classList.add('active');
            document.getElementById('yms-tab-list').classList.remove('active');
            document.getElementById('yms-tab-map').classList.add('active');
            setTimeout(updateZoomUI, 50);
        });

        document.getElementById('yms-refresh-btn').addEventListener('click', () => {
            triggerDataRefresh();
            const mins = parseInt(document.getElementById('yms-auto-refresh').value, 10);
            if (mins > 0) {
                nextRefreshTime = Date.now() + (mins * 60 * 1000);
                updateCountdownUI();
            }
        });

        document.getElementById('yms-close-btn').addEventListener('click', () => {
            document.getElementById('yms-occupied-panel').style.display = 'none';
            minBtn.style.display = 'block';
        });

        document.getElementById('yms-search').addEventListener('input', (e) => {
            applySearchFilter(e.target.value);
        });

        document.getElementById('yms-auto-refresh').addEventListener('change', function (e) {
            const mins = parseInt(e.target.value, 10);
            if (autoRefreshTimer) clearInterval(autoRefreshTimer);

            if (mins > 0) {
                nextRefreshTime = Date.now() + (mins * 60 * 1000);
                updateCountdownUI();
                autoRefreshTimer = setInterval(() => {
                    const now = Date.now();
                    if (now >= nextRefreshTime) {
                        triggerDataRefresh();
                        nextRefreshTime = now + (mins * 60 * 1000);
                    }
                    updateCountdownUI();
                }, 1000);
            } else {
                nextRefreshTime = null;
                updateCountdownUI();
            }
        });

        let ymsZoomLevel = 1.0;
        function updateZoomUI() {
            const mapBody = document.querySelector('.yms-map-body');
            if (mapBody) {
                mapBody.style.transform = `scale(${ymsZoomLevel})`;
                mapBody.style.transformOrigin = 'top center';
            }
            document.getElementById('yms-zoom-reset').innerText = `${Math.round(ymsZoomLevel * 100)}%`;
        }

        document.getElementById('yms-zoom-in').addEventListener('click', () => {
            ymsZoomLevel = Math.min(2.0, ymsZoomLevel + 0.05);
            updateZoomUI();
        });

        document.getElementById('yms-zoom-out').addEventListener('click', () => {
            ymsZoomLevel = Math.max(0.3, ymsZoomLevel - 0.05);
            updateZoomUI();
        });

        document.getElementById('yms-zoom-reset').addEventListener('click', () => {
            ymsZoomLevel = 1.0;
            updateZoomUI();
        });

        // Garantir que o contador inicie se já houver algo selecionado
        document.getElementById('yms-auto-refresh').dispatchEvent(new Event('change'));

        // Busca CPT/SAT inicial
        fetchExtraData();
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

    function getElapsedTimeHM(start, end = null) {
        if (!start) return '-';
        const endTime = end ? end : (Date.now() / 1000);
        const diff = Math.floor(Math.max(0, endTime - start));

        const hours = Math.floor(diff / 3600);
        const minutes = Math.floor((diff % 3600) / 60);

        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    }

    function updateLiveTimers() {
        const now = Date.now() / 1000;
        document.querySelectorAll('.yms-live-timer').forEach(el => {
            const start = parseFloat(el.getAttribute('data-start'));
            el.innerText = getElapsedTime(start, now);
        });
        document.querySelectorAll('.yms-live-timer-hm').forEach(el => {
            const start = parseFloat(el.getAttribute('data-start'));
            el.innerText = getElapsedTimeHM(start, now);
        });
    }

    setInterval(updateLiveTimers, 1000);

    function getPctColorGlass(pct) {
        if (pct >= 85) return '#ff7b72'; // red
        if (pct >= 50) return '#e3b341'; // yellow
        return '#56d364'; // green
    }

    // --- 3. PROCESSAMENTO DOS DADOS ---
    function renderYmsMap(occupiedMap) {
        const createBox = (code) => {
            const info = occupiedMap.get(code);
            if (info) {
                const timerColor = code.startsWith('DD') ? '#ff7b72' : '#58a6ff';
                const cpt = cptMap.get(info.vrid) || '--/-- --:--';
                return `
                    <div style="display: flex; flex-direction: column; align-items: center; gap: 2px;">
                        <div style="height: 12px; display: flex; align-items: center; justify-content: center;">
                            <span style="font-size: 9px; color: #e3b341; font-weight: 800; font-family: monospace; white-space: nowrap;">${cpt}</span>
                        </div>
                        <div class="yms-map-box occupied">
                            <div style="font-size: 8px; color: #a89dff; line-height: 1; font-weight: 800;">${info.vrid}</div>
                            <div style="font-size: 8px; color: #56d364; line-height: 1.1; font-weight: 600;">${info.lane}</div>
                            <div style="font-size: 8px; color: #58a6ff; margin-bottom: 1px; font-weight: 700;">${info.placa}</div>
                            <div style="font-size: 9px;">${code}</div>
                        </div>
                        <div style="height: 12px; display: flex; align-items: center; justify-content: center;">
                            <div class="yms-live-timer-hm" data-start="${info.startTime}" style="font-size: 10px; font-weight: 800; color: ${timerColor}; font-family: monospace;">${getElapsedTimeHM(info.startTime)}</div>
                        </div>
                    </div>
                `;
            }
            return `
                <div style="display: flex; flex-direction: column; align-items: center; gap: 2px;">
                    <div style="height: 12px; opacity: 0; pointer-events: none;">--/-- --:--</div>
                    <div class="yms-map-box">${code}</div>
                    <div style="height: 12px; opacity: 0; pointer-events: none;">00:00</div>
                </div>
            `;
        };

        let htmlOf = '';
        for (let i = 1; i <= 83; i++) {
            const code = 'OF-' + String(i).padStart(2, '0');
            if (occupiedMap.has(code)) {
                htmlOf += createBox(code);
            }
        }
        if (htmlOf === '') {
            htmlOf = '<div style="color: #8b949e; font-size: 11px; font-style: italic; padding: 5px;">Nenhuma unidade externa ativa</div>';
        }
        document.getElementById('yms-map-grid-externo').innerHTML = htmlOf;

        let htmlPs = '';
        for (let i = 501; i <= 529; i++) {
            htmlPs += createBox('PS' + i);
        }
        document.getElementById('yms-map-row-ps').innerHTML = htmlPs;

        const fillRow = (start, end, elementId) => {
            let html = '';
            for (let i = start; i >= end; i--) {
                html += createBox('DD' + i);
            }
            const el = document.getElementById(elementId);
            if (el) el.innerHTML = html;
        };

        fillRow(95, 86, 'yms-map-row-in');
        fillRow(85, 63, 'yms-map-row-out');
        fillRow(62, 59, 'yms-map-row-rev');

        const updateAreaLabel = (id, start, end, prefix, text) => {
            let total = 0;
            let occupied = 0;
            const s = Math.min(start, end);
            const e = Math.max(start, end);
            for (let i = s; i <= e; i++) {
                total++;
                const code = prefix === 'OF' ? ('OF-' + String(i).padStart(2, '0')) : (prefix + i);
                if (occupiedMap.has(code)) occupied++;
            }
            const free = total - occupied;
            const occPct = total > 0 ? Math.round((occupied / total) * 100) : 0;
            const freePct = 100 - occPct;

            const el = document.getElementById(id);
            if (el) {
                el.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 15px;">
                        <span style="color: #56d364; font-size: 10px; font-weight: 800; min-width: 90px; text-align: left; opacity: 0.9;">${free} Livres (${freePct}%)</span>
                        <span style="letter-spacing: 2px; flex: 1;">${text}</span>
                        <span style="color: #f85149; font-size: 10px; font-weight: 800; min-width: 90px; text-align: right; opacity: 0.9;">${occupied} Ocupadas (${occPct}%)</span>
                    </div>
                `;
            }
        };

        updateAreaLabel('yms-label-ps', 501, 529, 'PS', 'VAGAS DE ESPERA');
        updateAreaLabel('yms-label-in', 95, 86, 'DD', 'INBOUND');
        updateAreaLabel('yms-label-out', 85, 63, 'DD', 'OUTBOUND');
        updateAreaLabel('yms-label-rev', 62, 59, 'DD', 'REVERSA');
        updateAreaLabel('yms-label-of', 1, 83, 'OF', 'EXTERNO (OF)');

        // Sumário Global do Site
        let siteTotal = 0;
        let siteOccupied = 0;
        const areas = [
            { s: 501, e: 529, p: 'PS' },
            { s: 59, e: 95, p: 'DD' },
            { s: 1, e: 83, p: 'OF' }
        ];
        areas.forEach(area => {
            for (let i = area.s; i <= area.e; i++) {
                siteTotal++;
                const code = area.p === 'OF' ? ('OF-' + String(i).padStart(2, '0')) : (area.p + i);
                if (occupiedMap.has(code)) siteOccupied++;
            }
        });
        const siteFree = siteTotal - siteOccupied;
        const sitePct = siteTotal > 0 ? Math.round((siteOccupied / siteTotal) * 100) : 0;

        const summaryEl = document.getElementById('yms-site-summary');
        if (summaryEl) {
            summaryEl.innerHTML = `
                <span style="color: #a89dff;">TOTAL: <strong style="color: #fff; margin-left: 5px;">${siteTotal}</strong></span>
                <span style="color: #56d364;">LIVRES: <strong style="color: #fff; margin-left: 5px;">${siteFree}</strong></span>
                <span style="color: #f85149;">OCUPADAS: <strong style="color: #fff; margin-left: 5px;">${siteOccupied}</strong></span>
                <span style="color: #e3b341;">OCUPAÇÃO: <strong style="color: #fff; margin-left: 5px;">${sitePct}%</strong></span>
            `;
        }
    }

    function updateDashboard(jsonData) {
        if (!jsonData) return;
        lastYmsData = jsonData;

        const tbody = document.getElementById('yms-table-body');
        const sidebar = document.getElementById('yms-sidebar');

        let htmlTable = '';
        let occupiedMap = new Map();
        let stats = {
            DD: { total: 0, occupied: 0, freeList: [], occupiedList: [] },
            PS: { total: 0, occupied: 0, freeList: [], occupiedList: [] }
        };

        try {
            // Tenta extrair summaries de diferentes caminhos possíveis
            let summaries = jsonData.locationsSummaries;
            if (!summaries && jsonData.body) summaries = jsonData.body.locationsSummaries;
            if (!summaries && jsonData.data) summaries = jsonData.data.locationsSummaries;
            if (!summaries) summaries = [];

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

                    // Limitar PS do 501 até o 529
                    if (code.startsWith('PS')) {
                        const psNum = parseInt(code.replace('PS', ''), 10);
                        if (psNum < 501 || psNum > 529) return;
                    }

                    const isOccupied = loc.yardAssets && loc.yardAssets.length > 0;
                    const isDD = code.startsWith('DD');
                    const isPS = code.startsWith('PS');

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
                        const lane = primaryAsset.load?.lane || '-';

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

                        const startTime = code.startsWith('DD') ? (primaryAsset.datetimeOfArrivalAtLocation || primaryAsset.datetimeOfArrivalInYard) : primaryAsset.datetimeOfArrivalInYard;
                        occupiedMap.set(code, { vrid, lane, placa: placaCavalo || '-', startTime });

                        let displayVrid = `<strong style="color:#e6edf3;">${vrid}</strong>`;
                        if (placaCavalo && plateToVrids[placaCavalo] && plateToVrids[placaCavalo].size > 1) {
                            displayVrid += `<br><span class="yms-badge purple" style="display:inline-block; margin-top:4px;">Bi-Trem</span>`;
                        }

                        let displayPlacas = placaCavalo ? `<strong style="color:#58a6ff;">${placaCavalo}</strong>` : '<strong style="color:#8b949e;">-</strong>';
                        if (placaBau && placaBau !== placaCavalo) {
                            displayPlacas += `<br><span style="color:#8b949e; font-size:11px;">${placaBau}</span>`;
                        }

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

                        const cptValue = cptMap.get(vrid) || '-';

                        htmlTable += `
                            <tr>
                                <td>${displayVrid}</td>
                                <td style="color:#e3b341; font-weight:bold;">${cptValue}</td>
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

            renderYmsMap(occupiedMap);
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
        const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
        if (url.includes('getYardStateWithPendingMoves')) {
            lastYardStateUrl = url;
            if (args[1]) {
                lastYardStateMethod = args[1].method || 'GET';
                lastYardStateHeaders = args[1].headers;
                lastYardStateBody = args[1].body;
            }
        }

        const response = await originalFetch.apply(this, args);
        try {
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
        const originalOpen = xhr.open;
        const originalSend = xhr.send;
        const originalSetRequestHeader = xhr.setRequestHeader;
        xhr._headers = {};

        xhr.setRequestHeader = function (header, value) {
            xhr._headers[header] = value;
            return originalSetRequestHeader.apply(this, arguments);
        };

        xhr.open = function (method, url) {
            xhr._method = method;
            xhr._url = url;
            if (typeof url === 'string' && url.includes('getYardStateWithPendingMoves')) {
                lastYardStateUrl = url;
                lastYardStateMethod = method;
                setTimeout(() => { lastYardStateHeaders = xhr._headers; }, 0);
            }
            return originalOpen.apply(this, arguments);
        };

        xhr.send = function (body) {
            if (xhr._url && xhr._url.includes('getYardStateWithPendingMoves')) {
                lastYardStateBody = body;
            }
            return originalSend.apply(this, arguments);
        };
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