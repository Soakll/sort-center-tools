// ==UserScript==
// @name         YMS - Event Report (Premium v1.0)
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Painel de Histórico de Eventos YMS com ajuste automático de data e seleção de Yard.
// @author       Antigravity
// @match        https://trans-logistics.amazon.com/yms/eventHistory*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      ii51s3lexd.execute-api.us-east-1.amazonaws.com
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // Settings & State
    const CONFIG = {
        apiEndpoint: 'https://ii51s3lexd.execute-api.us-east-1.amazonaws.com/call/getEventReport',
        defaultYard: 'CGH7',
        defaultInterval: 5 // minutes
    };

    // --- Helpers ---
    const getLocalISOString = (date) => {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        const h = String(date.getHours()).padStart(2, '0');
        const min = String(date.getMinutes()).padStart(2, '0');
        return `${d}/${m}/${y} ${h}:${min}`;
    };

    let state = {
        selectedYard: localStorage.getItem('yms-report-yard') || CONFIG.defaultYard,
        // Default range: Today (Local Time)
        fromDate: getLocalISOString(new Date(new Date().setHours(0,0,0,0))),
        toDate: getLocalISOString(new Date(new Date().setHours(23,59,59,999))),
        events: [],
        isLoading: false,
        loadingProgress: 0,
        lastUpdate: null,
        searchTerm: '',
        refreshTimer: null,
        showConfig: false,
        enabledTypes: JSON.parse(localStorage.getItem('yms-enabled-types')) || {},
        enabledDescs: JSON.parse(localStorage.getItem('yms-enabled-descs')) || {},
        searchTimeout: null,
        currentPage: 1
    };

    // --- 1. STYLES (Glassmorphism) ---
    const injectStyles = () => {
        if (document.getElementById('yms-report-style')) return;
        const style = document.createElement('style');
        style.id = 'yms-report-style';
        style.textContent = `
            :root {
                --primary: #818cf8;
                --secondary: #3b82f6;
                --bg-glass: #000000;
                --header-bg: #111111;
                --border-glass: #333333;
                --text-main: #ffffff;
                --text-muted: #cccccc;
                --success: #22c55e;
                --error: #ef4444;
                --warning: #f59e0b;
                --row-hover: #111111;
            }

            .yms-report-panel {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100vh;
                background: var(--bg-glass);
                backdrop-filter: blur(25px);
                -webkit-backdrop-filter: blur(25px);
                border: none;
                z-index: 2147483647 !important;
                display: flex;
                flex-direction: column;
                color: var(--text-main);
                font-family: "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                overflow: hidden;
                padding-right: 15px; /* Traz o scroll interno para dentro */
                transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.4s;
                box-sizing: border-box;
            }

            .yms-report-panel.hidden {
                transform: translateX(100%);
                opacity: 0;
                pointer-events: none;
            }

            .yms-report-header {
                padding: 20px 40px;
                background: var(--header-bg);
                border-bottom: 1px solid var(--border-glass);
                display: flex;
                justify-content: space-between;
                align-items: center;
                cursor: move;
            }

            .yms-report-title {
                font-weight: 700;
                font-size: 18px;
                display: flex;
                align-items: center;
                gap: 10px;
                letter-spacing: -0.5px;
            }

            .yms-report-controls {
                padding: 20px 40px;
                display: flex;
                gap: 10px;
                align-items: center;
                background: rgba(255,255,255,0.05);
                border-bottom: 1px solid var(--border-glass);
            }

            .yms-report-select {
                background: #222222;
                border: 1px solid #444444;
                color: #ffffff !important;
                padding: 12px 18px;
                border-radius: 8px;
                font-size: 16px;
                font-weight: 600;
                outline: none;
                transition: all 0.2s;
            }

            .yms-report-select::placeholder {
                color: #888888;
            }

            .yms-report-select:focus {
                background: #333333;
                border-color: #ffffff;
            }

            .yms-report-btn {
                background: rgba(255, 255, 255, 0.1);
                border: 1px solid var(--border-glass);
                color: #fff;
                padding: 8px 16px;
                border-radius: 8px;
                cursor: pointer;
                font-weight: 600;
                font-size: 14px;
                transition: all 0.2s;
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .yms-report-btn:hover {
                background: rgba(255, 255, 255, 0.2);
                transform: translateY(-1px);
            }

            .yms-report-btn.primary {
                background: #ffffff;
                border-color: #ffffff;
                color: #000000;
            }

            .yms-report-btn.primary:hover {
                background: #cccccc;
                transform: scale(1.05);
            }

            .yms-report-content {
                flex: 1;
                overflow-y: auto;
                padding: 0 40px 40px 40px; /* Remove top padding */
            }

            .yms-report-table {
                width: 100%;
                border-collapse: collapse;
                font-size: 14px;
                /* Remove table-layout: fixed for more flexibility */
            }

            .yms-report-table th {
                text-align: left;
                padding: 20px 40px;
                color: #ffffff;
                font-weight: 800;
                font-size: 13px;
                letter-spacing: 1px;
                background: #000000 !important;
                position: sticky;
                top: 0;
                z-index: 1000;
                border-bottom: 2px solid #333333;
                border-right: 1px solid #222222;
                white-space: nowrap;
            }
            
            .yms-report-table th:last-child { border-right: none; }
            
            .yms-report-table th:nth-child(1) { min-width: 120px; } /* Hora */
            .yms-report-table th:nth-child(2) { min-width: 220px; } /* Tipo */
            .yms-report-table th:nth-child(3) { min-width: 450px; } /* Evento */
            .yms-report-table th:nth-child(4) { min-width: 150px; } /* Placa */
            .yms-report-table th:nth-child(5) { min-width: 180px; } /* VRID */
            .yms-report-table th:nth-child(6) { min-width: 160px; } /* Login */
            .yms-report-table th:nth-child(7) { min-width: 200px; } /* Local */

            .yms-report-table td {
                padding: 16px 40px;
                border-bottom: 1px solid #222222;
                border-right: 1px solid #222222;
                vertical-align: middle;
            }

            .yms-report-table td:last-child { border-right: none; }

            .yms-report-table tr:hover td {
                background: var(--row-hover);
            }

            .yms-badge {
                padding: 8px 16px;
                border-radius: 4px;
                font-size: 12px;
                font-weight: 900;
                letter-spacing: 0.5px;
                white-space: nowrap;
                color: #ffffff !important;
                display: block; /* Garante que ocupe o espaço mas respeite o padding do TD */
            }

            .badge-checkin { background: #15803d; border: 1px solid #22c55e; }
            .badge-checkout { background: #b91c1c; border: 1px solid #ef4444; }
            .badge-move { background: #1d4ed8; border: 1px solid #3b82f6; }
            .badge-default { background: #374151; border: 1px solid #6b7280; }

            .yms-fab {
                position: fixed !important;
                bottom: 30px !important;
                right: 30px !important;
                width: 65px !important;
                height: 65px !important;
                background: #818cf8 !important; /* Indigo mais brilhante */
                border: 3px solid #ffffff !important;
                border-radius: 50% !important;
                color: #ffffff !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                cursor: pointer !important;
                box-shadow: 0 10px 30px rgba(0,0,0,0.8) !important;
                z-index: 2147483646 !important;
                font-size: 30px !important;
                transition: all 0.3s !important;
            }

            .yms-fab:hover {
                transform: scale(1.1) rotate(5deg);
                box-shadow: 0 0 30px rgba(121, 192, 255, 0.4);
                background: #2d3e50;
            }

            .yms-tooltip { 
                padding: 10px 20px; 
                color: var(--text-muted); 
                font-size: 12px; 
                border-top: 1px solid var(--border-glass); 
                background: rgba(0,0,0,0.2);
            }

            ::-webkit-scrollbar { width: 8px; }
            ::-webkit-scrollbar-track { background: transparent; }
            ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 10px; }
            ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.25); }

            .yms-config-popover {
                position: absolute;
                top: 155px; /* Abaixo dos controles */
                right: 40px;
                background: #111111;
                border: 1px solid #333333;
                border-radius: 12px;
                padding: 15px;
                width: 250px;
                max-height: 400px;
                overflow-y: auto;
                z-index: 2000;
                box-shadow: 0 10px 30px rgba(0,0,0,0.8);
                display: none;
            }

            .yms-config-popover.visible { display: block; }
            
            .yms-config-item {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 8px 0;
                border-bottom: 1px solid #222222;
                font-size: 13px;
                cursor: pointer;
            }

            .yms-config-item:last-child { border-bottom: none; }
            .yms-config-item input { width: 16px; height: 16px; cursor: pointer; }
        `;
        document.head.appendChild(style);
    };

    // --- 2. UTILS ---
    const getTodayRange = () => {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
        return {
            from: Math.floor(start.getTime() / 1000),
            to: Math.floor(end.getTime() / 1000)
        };
    };


    const formatTime = (ts) => {
        if (!ts) return '';
        const date = new Date(ts > 10000000000 ? ts : ts * 1000);
        const datePart = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        const timePart = date.toLocaleTimeString('pt-BR', { 
            hour: '2-digit', 
            minute: '2-digit', 
            second: '2-digit',
            hour12: false
        });
        return `<span style="color: #64748b; font-size: 11px;">${datePart}</span><br><span style="color: #ffffff; font-weight: 500;">${timePart}</span>`;
    };

    const formatEventName = (str) => {
        if (!str || str === 'N/A') return 'N/A';
        
        // 1. Separa CamelCase e trata underscores
        let res = str
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
            .replace(/_/g, ' ')
            .trim()
            .toLowerCase();

        // 2. Capitaliza a primeira letra de cada palavra (Title Case)
        return res.replace(/\b\w/g, l => l.toUpperCase());
    };

    const formatLogin = (userId) => {
        if (!userId) return '-';
        const login = userId.split('@')[0];
        if (login.toUpperCase() === 'SSP') return '-';
        return login;
    };

    // --- 3. API CALL ---
    const getToken = () => {
        // Prioriza variáveis globais onde o token costuma ser injetado
        return window.ymsSecurityToken || 
               window.token || 
               (typeof ymsSecurityToken !== 'undefined' ? ymsSecurityToken : null);
    };

    const fetchEvents = (isSilent = false) => {
        if (state.isLoading) return;
        
        const token = getToken();
        if (!token) {
            if (!isSilent) {
                console.error('[YMS Report] Token não encontrado na página.');
                state.lastUpdate = new Error('Token não encontrado');
                updateUI();
            }
            return;
        }

        if (!isSilent) {
            state.isLoading = true;
            updateUI();
        }

        const parseDateTime = (str) => {
            try {
                const [datePart, timePart] = str.split(' ');
                const [d, m, y] = datePart.split('/').map(Number);
                const [hh, mm] = timePart.split(':').map(Number);
                return Math.floor(new Date(y, m - 1, d, hh, mm).getTime() / 1000);
            } catch (e) {
                return Math.floor(Date.now() / 1000);
            }
        };

        const fromTs = parseDateTime(state.fromDate);
        const toTs = parseDateTime(state.toDate);

        const payload = {
            annotation: "",
            eventType: "",
            firstRow: 0,
            fromDate: fromTs,
            licensePlateNumber: "",
            loadIdentifier: "",
            loadIdentifierType: "",
            location: "",
            locationPlanId: "",
            requester: { system: "YMSWebApp" },
            system: "YMSWebApp",
            rowCount: 50000,
            seal: "",
            systemName: "",
            toDate: toTs,
            userId: "",
            vehicleNumber: "",
            vehicleOwner: "",
            vehicleType: "",
            visitId: "",
            visitReason: "",
            yard: state.selectedYard
        };

        console.log(`[YMS Report] Chamando API YMS para ${state.selectedYard}...`, {
            api: 'getEventReport',
            token: token.substring(0, 10) + '...'
        });

        GM_xmlhttpRequest({
            method: 'POST',
            url: CONFIG.apiEndpoint,
            headers: {
                'Content-Type': 'application/json;charset=utf-8',
                'Accept': 'application/json, text/plain, */*',
                'api': 'getEventReport',
                'method': 'POST',
                'token': token
            },
            data: JSON.stringify(payload),
            timeout: 60000, // Aumentado para 50k rows
            onprogress: function(event) {
                if (event.lengthComputable) {
                    state.loadingProgress = Math.round((event.loaded / event.total) * 100);
                    updateUI();
                } else {
                    // Se não souber o total, mostra o tamanho baixado em KB
                    state.loadingProgress = `${Math.round(event.loaded / 1024)}KB`;
                    updateUI();
                }
            },
            onload: function(response) {
                try {
                    if (response.status !== 200) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }
                    const data = JSON.parse(response.responseText);
                    console.log('[YMS Report] Sucesso:', data);
                    
                    state.events = data.events || (data.body && data.body.events) || (data.ret && data.ret.aaData) || [];
                    
                    // Populate and persist types and descriptions
                    state.events.forEach(ev => {
                        const t = ev.eventType || 'N/A';
                        let d = ev.eventDescription || 'N/A';
                        
                        // Simplify dynamic descriptions (Seals and Notes)
                        if (d.startsWith('Seals:')) d = 'Seals';
                        if (d.startsWith('Note:')) d = 'Note';
                        
                        if (state.enabledTypes[t] === undefined) {
                            state.enabledTypes[t] = true;
                        }
                        if (state.enabledDescs[d] === undefined) {
                            state.enabledDescs[d] = true;
                        }
                    });
                    localStorage.setItem('yms-enabled-types', JSON.stringify(state.enabledTypes));
                    localStorage.setItem('yms-enabled-descs', JSON.stringify(state.enabledDescs));

                    state.lastUpdate = new Date();
                } catch (err) {
                    console.error('[YMS Report] Erro no processamento:', err);
                    state.lastUpdate = err;
                } finally {
                    state.isLoading = false;
                    state.loadingProgress = 0;
                    updateUI();
                }
            },
            onerror: function(err) {
                console.error('[YMS Report] Erro de rede:', err);
                state.lastUpdate = new Error('Erro de conexão');
                state.isLoading = false;
                updateUI();
            },
            ontimeout: function() {
                console.error('[YMS Report] Timeout na API');
                state.lastUpdate = new Error('Tempo esgotado');
                state.isLoading = false;
                updateUI();
            }
        });
    };

    // --- 4. UI COMPONENTS ---
    let panel;
    let fab;

    const createUI = () => {
        injectStyles();

        fab = document.createElement('div');
        fab.className = 'yms-fab';
        fab.innerHTML = '📋';
        fab.title = 'Abrir Relatório de Eventos';
        document.body.appendChild(fab);

        panel = document.createElement('div');
        panel.className = 'yms-report-panel hidden';
        document.body.appendChild(panel);

        fab.onclick = () => {
            const isHidden = panel.classList.toggle('hidden');
            document.body.style.overflow = isHidden ? '' : 'hidden'; // Trava o scroll da página
            if (!isHidden) {
                fetchEvents();
            }
        };

        updateUI();
    };

    const getBadgeClass = (type) => {
        const t = type?.toUpperCase() || '';
        if (t.includes('CHECK_IN') || t.includes('ARR')) return 'badge-checkin';
        if (t.includes('CHECK_OUT') || t.includes('DEP')) return 'badge-checkout';
        if (t.includes('MOVE')) return 'badge-move';
        return 'badge-default';
    };

    const updateTableResults = () => {
        const tbody = panel?.querySelector('.yms-report-table tbody');
        const statsEl = panel?.querySelector('#yms-row-stats');
        if (!tbody) return;

        const filtered = state.events
            .filter(ev => {
                const type = ev.eventType || 'N/A';
                let desc = ev.eventDescription || 'N/A';
                
                if (desc.startsWith('Seals:')) desc = 'Seals';
                if (desc.startsWith('Note:')) desc = 'Note';

                if (state.enabledTypes[type] === false) return false;
                if (state.enabledDescs[desc] === false) return false;

                const term = state.searchTerm.toLowerCase();
                if (!term) return true;

                const time = formatTime(ev.timestamp || ev.eventTimestamp || ev.datetime).toLowerCase();
                const plate = (ev.licensePlate?.registrationIdentifier || ev.vehicleNumber || '').toLowerCase();
                const loc = (ev.location || ev.toLocationCode || '').toLowerCase();
                const event = (ev.eventDescription || ev.eventType || '').toLowerCase();
                const vr = (ev.vrId || ev.loadIdentifier || '').toLowerCase();
                const user = (ev.userId || '').toLowerCase();

                return (time.includes(term) ||
                        plate.includes(term) || 
                        loc.includes(term) ||
                        event.includes(term) ||
                        user.includes(term) ||
                        vr.includes(term));
            });

        const totalMatches = filtered.length;
        const pageSize = 100;
        const totalPages = Math.max(1, Math.ceil(totalMatches / pageSize));
        
        if (state.currentPage > totalPages) state.currentPage = totalPages;

        const start = (state.currentPage - 1) * pageSize;
        const toDisplay = filtered.slice(start, start + pageSize);

        if (statsEl) {
            statsEl.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                    <span>Resultados: <b>${totalMatches}</b> | Página <b>${state.currentPage}</b> de <b>${totalPages}</b></span>
                    <div style="display: flex; gap: 10px;">
                        <button class="yms-report-btn" id="yms-prev-page" ${state.currentPage === 1 ? 'disabled style="opacity:0.3;"' : ''}>◀ Anterior</button>
                        <button class="yms-report-btn" id="yms-next-page" ${state.currentPage === totalPages ? 'disabled style="opacity:0.3;"' : ''}>Próxima ▶</button>
                    </div>
                </div>
            `;

            statsEl.querySelector('#yms-prev-page').onclick = () => {
                if (state.currentPage > 1) {
                    state.currentPage--;
                    updateTableResults();
                    panel.querySelector('.yms-report-content').scrollTop = 0;
                }
            };
            statsEl.querySelector('#yms-next-page').onclick = () => {
                if (state.currentPage < totalPages) {
                    state.currentPage++;
                    updateTableResults();
                    panel.querySelector('.yms-report-content').scrollTop = 0;
                }
            };
        }

        tbody.innerHTML = toDisplay
            .map(ev => {
                const desc = formatEventName(ev.eventDescription || 'N/A');
                const type = formatEventName(ev.eventType || 'N/A');
                const badgeClass = getBadgeClass(ev.eventType);
                
                return `
                <tr title="Visit ID: ${ev.visitId || 'N/A'}\nUser: ${ev.userId || 'N/A'}">
                    <td>${formatTime(ev.timestamp || ev.eventTimestamp || ev.datetime)}</td>
                    <td><span class="yms-badge ${badgeClass}" style="width: 100%; text-align: center;">${type}</span></td>
                    <td><span class="yms-badge ${badgeClass}" style="width: 100%; text-align: center; opacity: 0.9;">${desc}</span></td>
                    <td style="font-weight: bold; color: var(--secondary);">${ev.licensePlate?.registrationIdentifier || ev.vehicleNumber || '-'}</td>
                    <td style="color: var(--primary); font-family: monospace;">${ev.vrId || ev.loadIdentifier || '-'}</td>
                    <td style="color: #4ade80;">${formatLogin(ev.userId)}</td>
                    <td>${ev.location || ev.toLocationCode || '-'}</td>
                </tr>
                `;
            }).join('');
    };

    const updateUI = () => {
        if (!panel) return;

        const dateStr = new Date().toLocaleDateString('pt-BR');

        panel.innerHTML = `
            <div class="yms-report-header" id="yms-draggable">
                <div class="yms-report-title">
                    <span>📋</span> Relatório de Eventos
                </div>
                <button class="yms-report-btn" id="yms-close-btn" style="padding: 4px 8px;">✕</button>
            </div>
            
            <div class="yms-report-controls" style="flex-wrap: wrap; height: auto; gap: 12px;">
                <div style="display: flex; gap: 8px; align-items: center;">
                    <span style="font-size: 11px; font-weight: bold; color: #888;">YARD</span>
                    <input type="text" class="yms-report-select" id="yms-yard-input" value="${state.selectedYard}" style="width: 80px; text-transform: uppercase; text-align: center;">
                </div>
                
                <div style="display: flex; gap: 8px; align-items: center;">
                    <span style="font-size: 11px; font-weight: bold; color: #888;">DE</span>
                    <input type="text" class="yms-report-select" id="yms-from-input" value="${state.fromDate}" style="width: 160px; text-align: center;" placeholder="DD/MM/YYYY HH:mm">
                    <span style="font-size: 11px; font-weight: bold; color: #888;">até</span>
                    <input type="text" class="yms-report-select" id="yms-to-input" value="${state.toDate}" style="width: 160px; text-align: center;" placeholder="DD/MM/YYYY HH:mm">
                </div>

                <input type="text" class="yms-report-select" style="flex: 1; min-width: 200px; cursor: text;" placeholder="🔍 Pesquisar em tudo..." id="yms-search-input" value="${state.searchTerm}">
                
                <button class="yms-report-btn" id="yms-config-btn" title="Filtrar Tipos de Eventos">⚙️</button>

                <button class="yms-report-btn primary" id="yms-refresh-btn" style="min-width: 80px;">
                    ${state.isLoading ? (state.loadingProgress ? `${state.loadingProgress}` : '...') : '↻'}
                </button>
            </div>

            <div style="padding: 10px 40px; background: rgba(0,0,0,0.3); font-size: 11px; color: #888; border-bottom: 1px solid #222;" id="yms-row-stats">
                Aguardando dados...
            </div>

            <div class="yms-config-popover" id="yms-config-popover">
                <div style="font-weight: bold; margin-bottom: 5px; color: var(--primary); font-size: 11px; letter-spacing: 1px;">TIPOS DE EVENTO</div>
                <div style="margin-bottom: 15px;">
                ${Object.keys(state.enabledTypes).sort().map(type => {
                    const badgeClass = getBadgeClass(type);
                    return `
                    <label class="yms-config-item">
                        <input type="checkbox" data-type="${type}" data-mode="type" ${state.enabledTypes[type] ? 'checked' : ''}>
                        <span class="yms-badge ${badgeClass}" style="flex: 1; padding: 4px 8px; font-size: 11px;">${formatEventName(type)}</span>
                    </label>
                    `;
                }).join('')}
                </div>

                <div style="font-weight: bold; margin-bottom: 5px; color: var(--secondary); font-size: 11px; letter-spacing: 1px;">DESCRIÇÕES</div>
                <div>
                ${Object.keys(state.enabledDescs).sort().map(desc => {
                    // Try to guess color based on common desc prefixes or just use default
                    return `
                    <label class="yms-config-item">
                        <input type="checkbox" data-desc="${desc}" data-mode="desc" ${state.enabledDescs[desc] ? 'checked' : ''}>
                        <span style="color: #ccc; font-size: 11px; margin-left: 5px;">${formatEventName(desc)}</span>
                    </label>
                    `;
                }).join('')}
                </div>

                ${Object.keys(state.enabledTypes).length === 0 && Object.keys(state.enabledDescs).length === 0 ? '<div style="font-size: 11px; color: #666;">Cache de filtros vazio.</div>' : ''}
            </div>

            <div class="yms-report-content">
                ${state.events.length === 0 ? `
                    <div style="text-align: center; padding: 40px; color: var(--text-muted);">
                        ${state.isLoading ? 'Buscando dados...' : 'Nenhum evento encontrado para hoje.'}
                    </div>
                ` : `
                    <table class="yms-report-table">
                        <thead>
                            <tr>
                                <th>Hora</th>
                                <th>Tipo</th>
                                <th>Evento</th>
                                <th>Placa</th>
                                <th>VRID</th>
                                <th>Login</th>
                                <th>Local</th>
                            </tr>
                        </thead>
                        <tbody>
                            <!-- Rows injected by updateTableResults -->
                        </tbody>
                    </table>
                `}
            </div>
        `;

        updateTableResults();

        // Re-attach listeners
        panel.querySelector('#yms-close-btn').onclick = () => panel.classList.add('hidden');
        panel.querySelector('#yms-refresh-btn').onclick = fetchEvents;
        
        const searchInput = panel.querySelector('#yms-search-input');
        searchInput.oninput = (e) => {
            state.searchTerm = e.target.value;
            state.currentPage = 1; // Reseta para a primeira página na pesquisa
            if (state.searchTimeout) clearTimeout(state.searchTimeout);
            state.searchTimeout = setTimeout(() => {
                updateTableResults();
            }, 300);
        };

        panel.querySelector('#yms-yard-input').onchange = (e) => {
            state.selectedYard = e.target.value.toUpperCase();
            localStorage.setItem('yms-report-yard', state.selectedYard);
            fetchEvents();
        };

        panel.querySelector('#yms-from-input').onchange = (e) => {
            state.fromDate = e.target.value;
            fetchEvents();
        };

        panel.querySelector('#yms-to-input').onchange = (e) => {
            state.toDate = e.target.value;
            fetchEvents();
        };

        // Config Popover logic
        const configBtn = panel.querySelector('#yms-config-btn');
        const popover = panel.querySelector('#yms-config-popover');
        configBtn.onclick = (e) => {
            e.stopPropagation();
            popover.classList.toggle('visible');
        };

        popover.querySelectorAll('input').forEach(input => {
            input.onchange = (e) => {
                const mode = e.target.dataset.mode;
                if (mode === 'type') {
                    const type = e.target.dataset.type;
                    state.enabledTypes[type] = e.target.checked;
                    localStorage.setItem('yms-enabled-types', JSON.stringify(state.enabledTypes));
                } else {
                    const desc = e.target.dataset.desc;
                    state.enabledDescs[desc] = e.target.checked;
                    localStorage.setItem('yms-enabled-descs', JSON.stringify(state.enabledDescs));
                }
                updateTableResults();
            };
        });

        document.addEventListener('click', (e) => {
            if (!popover.contains(e.target) && e.target !== configBtn) {
                popover.classList.remove('visible');
            }
        });

        // Drag logic removed (Full screen panel)
    };

    // --- 5. INITIALIZATION ---
    const syncURL = () => {
        const range = getTodayRange();
        const fromDateMS = range.from * 1000;
        const toDateMS = (range.to * 1000) + 999;
        
        const newHash = `#/eventReport?yard=${state.selectedYard}&fromDate=${fromDateMS}&toDate=${toDateMS}`;
        if (window.location.hash !== newHash) {
            window.location.hash = newHash;
        }
    };

    const startAutoRefresh = () => {
        if (state.refreshTimer) clearInterval(state.refreshTimer);
        // Atualização em background a cada 1 minuto
        state.refreshTimer = setInterval(() => {
            fetchEvents(true); // Chamada silenciosa
        }, 60000);
    };

    // Initialize
    setTimeout(() => {
        createUI();
        syncURL();
        startAutoRefresh();
    }, 2000);

})();
