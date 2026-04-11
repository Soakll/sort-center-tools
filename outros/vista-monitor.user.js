// ==UserScript==
// @name         VISTA Monitor & Dashboard
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  Monitor de métricas em tempo real para o VISTA (Inbound/SLAM) com UI Premium
// @author       emanunec
// @match        https://trans-logistics.amazon.com/sortcenter/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const UI_CONFIG = {
        refreshInterval: 15000,
        accentColor: '#FF9900',
        glassBg: 'rgba(12, 12, 28, 0.85)',
        glassBorder: 'rgba(80, 96, 255, 0.2)',
        fontFamily: "'Amazon Ember', Arial, sans-serif"
    };

    const filters = { day: 'Todos', hour: 'Todos', route: 'Todos', shift: 'Todos', search: '' };
    let hiddenRoutes = GM_getValue('vd_hidden_routes', []);
    const MONTHS_MAP = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

    GM_addStyle(`
        #vd-launch-btn {
            position: fixed;
            bottom: 25px;
            right: 25px;
            width: 50px;
            height: 50px;
            background: #1e2040;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            z-index: 10001;
            box-shadow: 0 4px 15px rgba(0,0,0,0.5);
            transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            font-size: 24px;
            border: 2px solid #5060ff;
        }
        #vd-launch-btn:hover { transform: scale(1.1); box-shadow: 0 6px 20px rgba(80, 96, 255, 0.4); border-color: #FF9900; }

        #vista-dashboard-root {
            position: fixed;
            top: 20px;
            right: 20px;
            width: 820px;
            height: 620px;
            min-width: 450px;
            min-height: 300px;
            z-index: 10000;
            font-family: ${UI_CONFIG.fontFamily};
            color: white;
            background: ${UI_CONFIG.glassBg};
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border: 1px solid ${UI_CONFIG.glassBorder};
            border-radius: 12px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.5);
            padding: 0;
            display: none;
            flex-direction: column;
            transition: opacity 0.3s ease;
            resize: both;
            overflow: hidden;
        }

        #vista-dashboard-root.vd-fullscreen {
            top: 0 !important;
            left: 0 !important;
            width: 100vw !important;
            height: 100vh !important;
            border-radius: 0 !important;
            resize: none !important;
        }

        .vd-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid rgba(80, 96, 255, 0.15);
            padding: 12px 16px 10px;
            cursor: grab;
            background: rgba(80, 96, 255, 0.05);
            flex-shrink: 0;
            user-select: none;
        }
        .vd-header:active { cursor: grabbing; }

        .vd-header-actions {
            display: flex;
            gap: 12px;
            align-items: center;
        }

        .vd-action-icon {
            cursor: pointer;
            color: #889;
            transition: all 0.2s;
            font-size: 18px;
            line-height: 1;
        }
        .vd-action-icon:hover { color: #90a0ff; }
        .vd-action-close:hover { color: #ff5252; }

        .vd-title {
            font-size: 13px;
            font-weight: 700;
            color: #fff;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .vd-content {
            padding: 12px;
            display: flex;
            flex-direction: column;
            gap: 12px;
            overflow-y: auto;
            flex: 1;
            background: rgba(12, 12, 28, 0.2);
        }

        .vd-summary-cards {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 10px;
            flex-shrink: 0;
        }
        .vd-metric-card {
            background: #1e2040;
            border: 1px solid #3a3a6e;
            border-radius: 8px;
            padding: 10px;
            text-align: center;
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .vd-metric-label { font-size: 10px; font-weight: 700; color: #aaa; text-transform: uppercase; }
        .vd-metric-val { font-size: 18px; font-weight: 800; color: #FF9900; }
        .vd-metric-val.vd-metric-danger { color: #ff5252; }

        .vd-filters-bar {
            background: #1a1a2e;
            padding: 10px 14px;
            border: 1px solid #3a3a6e;
            border-radius: 8px;
            display: flex;
            gap: 12px;
            align-items: flex-end;
            flex-wrap: wrap;
        }

        .vd-filter-group { flex: 1; min-width: 80px; }
        .vd-filter-label { font-size: 10px; font-weight: 700; color: #7878a8; margin-bottom: 4px; padding-left: 2px; }

        .vd-input {
            background: #252545;
            border: 1px solid #3a3a6e;
            border-radius: 6px;
            color: #c5cae9;
            padding: 6px 10px;
            font-size: 11px;
            outline: none;
            width: 100%;
            transition: border-color 0.2s;
        }
        .vd-input:focus { border-color: #5060ff; }

        .vd-table-container {
            flex: 1;
            background: rgba(255,255,255,0.01);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 8px;
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }

        .vd-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 11px;
        }

        .vd-table thead th {
            text-align: center;
            padding: 12px 6px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            background: rgba(255, 255, 255, 0.05);
            color: #ccc;
            font-weight: 700;
            white-space: nowrap;
            position: sticky;
            top: 0;
            z-index: 5;
        }

        .vd-table td {
            padding: 10px 6px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.04);
            vertical-align: middle;
            text-align: center;
            color: #ddd;
        }
        .vd-table tbody tr:hover { background: rgba(255, 255, 255, 0.03); }

        .vd-row-delayed { background: rgba(200, 30, 30, 0.15) !important; }
        .vd-row-delayed td { color: #ff9e9e !important; }

        .vd-shift-tag {
            font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 20px;
        }
        .vd-shift-t1 { background: #2e7d32; color: #fff; }
        .vd-shift-t2 { background: #1565c0; color: #fff; }

        .vd-delay-badge { color: #ff5252; font-size: 10px; font-weight: 700; display: block; margin-top: 2px; }

        .vd-settings-modal {
            position: absolute; inset: 0; background: rgba(12, 12, 28, 0.95);
            z-index: 10005; display: none; flex-direction: column; padding: 25px;
            backdrop-filter: blur(12px);
        }

        .vd-btn {
            display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px;
            border: none; border-radius: 20px; font-size: 11px; font-weight: 700;
            cursor: pointer; transition: all 0.2s; white-space: nowrap;
            box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        }
        .vd-btn-orange { background: #c47000; color: #fff; }
        .vd-btn-orange:hover { filter: brightness(1.2); transform: translateY(-1px); }
        .vd-btn-gray { background: #444; color: #fff; }
        .vd-btn-green { background: #2e7d32; color: #fff; }
    `);

    function parseVistaDate(str) {
        if (!str || str.trim() === '--' || str.trim() === '') return null;
        let clean = str.replace(/Arrived|Late|Risk|Missed|Plan|Sort|Cross|Dock/gi, ' ').replace(/\s+/g, ' ').trim();
        let m = clean.match(/^(\d{1,2})[- ]([A-Za-z]{3})(?:[- ](\d{2,4}))?\s+(\d{1,2}):(\d{2})/);
        if (m) {
            const day = parseInt(m[1], 10);
            const month = MONTHS_MAP[m[2].charAt(0).toUpperCase() + m[2].slice(1).toLowerCase()];
            const year = m[3] ? (m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10)) : new Date().getFullYear();
            if (month !== undefined) return new Date(year, month, day, parseInt(m[4], 10), parseInt(m[5], 10));
        }
        m = clean.match(/^(\d{1,2}):(\d{2})\s+(\d{1,2})[- ]([A-Za-z]{3})(?:[- ](\d{2,4}))?/);
        if (m) {
            const hour = parseInt(m[1], 10), min = parseInt(m[2], 10), day = parseInt(m[3], 10);
            const month = MONTHS_MAP[m[4].charAt(0).toUpperCase() + m[4].slice(1).toLowerCase()];
            const year = m[5] ? (m[5].length === 2 ? 2000 + parseInt(m[5], 10) : parseInt(m[5], 10)) : new Date().getFullYear();
            if (month !== undefined) return new Date(year, month, day, hour, min);
        }
        return null;
    }

    function getShiftLabel(date) {
        if (!date) return '??';
        const hour = date.getHours();
        return (hour >= 5 && hour < 17) ? 't1' : 't2';
    }

    function formatTime(date) {
        if (!date) return '--:--';
        return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
    }

    function formatDate(date) {
        if (!date) return '';
        return String(date.getDate()).padStart(2, '0') + ' ' + Object.keys(MONTHS_MAP)[date.getMonth()];
    }

    function makeDraggable(el, handle) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        handle.onmousedown = dragMouseDown;

        function dragMouseDown(e) {
            if (el.classList.contains('vd-fullscreen')) return; // Bloqueia arrastar no Fullscreen
            e = e || window.event;
            // Ignora se clicar nos ícones de ação
            if (e.target.closest('.vd-header-actions')) return;

            e.preventDefault();
            pos3 = e.clientX;
            pos4 = e.clientY;
            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
        }

        function elementDrag(e) {
            e = e || window.event;
            e.preventDefault();
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;
            el.style.top = (el.offsetTop - pos2) + "px";
            el.style.left = (el.offsetLeft - pos1) + "px";
            el.style.right = 'auto';
            GM_setValue('vd_pos', { top: el.style.top, left: el.style.left });
        }

        function closeDragElement() {
            document.onmouseup = null;
            document.onmousemove = null;
        }
    }

    function calculateDelay(sat, aat) {
        if (!sat) return null;
        const compareDate = aat || new Date();
        const diffMs = compareDate - sat;
        if (diffMs <= 60000) return null;
        const totalMinutes = Math.floor(diffMs / 60000);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        let str = '';
        if (hours > 0) str += `${hours}h`;
        if (minutes > 0) str += `${minutes}m`;
        return { str, totalMinutes, isPending: !aat };
    }

    function createDashboard() {
        if (document.getElementById('vista-dashboard-root')) return;

        // Botão de Lançamento
        const launchBtn = document.createElement('div');
        launchBtn.id = 'vd-launch-btn';
        launchBtn.innerHTML = '🚚';
        launchBtn.title = 'Abrir Monitor de Chegadas';
        document.body.appendChild(launchBtn);

        const root = document.createElement('div');
        root.id = 'vista-dashboard-root';

        const savedPos = GM_getValue('vd_pos', { top: '20px', left: 'auto' });
        if (savedPos.left !== 'auto') {
            root.style.top = savedPos.top;
            root.style.left = savedPos.left;
            root.style.right = 'auto';
        }

        root.innerHTML = `
            <div id="vd-settings-modal" class="vd-settings-modal">
                <div class="vd-title" style="font-size: 16px;">⚙️ CONFIGURAÇÕES DE LANES</div>
                <div style="font-size: 11px; opacity: 0.6; margin: 8px 0 20px;">Desmarque as lanes que você deseja ocultar do painel.</div>
                <div class="vd-settings-list" id="vd-settings-list"></div>
                <div style="display: flex; gap: 12px; margin-top: auto; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.1);">
                    <button class="vd-btn vd-btn-gray" id="vd-settings-all">💻 Marcar Todas</button>
                    <button class="vd-btn vd-btn-gray" id="vd-settings-none">❌ Desmarcar Todas</button>
                    <button class="vd-btn vd-btn-green" id="vd-settings-save" style="margin-left:auto;">✓ Salvar e Fechar</button>
                </div>
            </div>

            <div class="vd-header" id="vd-drag-handle">
                <div class="vd-title">🚚 ARRIVAL MONITOR</div>
                <div class="vd-header-actions">
                    <div style="font-size: 11px; opacity: 0.5; font-family: monospace; letter-spacing: 1px;" id="vd-last-update">--:--:--</div>
                    <span class="vd-action-icon" id="vd-settings-btn" title="Configurar Lanes">⚙️</span>
                    <span class="vd-action-icon" id="vd-fs-toggle" title="Tela Cheia">⛶</span>
                    <span class="vd-action-icon vd-action-close" id="vd-close-btn" title="Fechar">✕</span>
                </div>
            </div>

            <div class="vd-content">
                <div class="vd-summary-cards">
                    <div class="vd-metric-card">
                        <span class="vd-metric-label">Volume Total</span>
                        <span class="vd-metric-val" id="vd-total-vol">0</span>
                    </div>
                    <div class="vd-metric-card">
                        <span class="vd-metric-label">Remaining Sort</span>
                        <span class="vd-metric-val" id="vd-total-srt">0</span>
                    </div>
                    <div class="vd-metric-card">
                        <span class="vd-metric-label">Remaining Xdk</span>
                        <span class="vd-metric-val" id="vd-total-xdk">0</span>
                    </div>
                    <div class="vd-metric-card">
                        <span class="vd-metric-label">Cargas Atrasadas</span>
                        <span class="vd-metric-val vd-metric-danger" id="vd-total-delays-summary">0</span>
                    </div>
                </div>

                <div class="vd-filters-bar">
                    <div class="vd-filter-group" style="flex: 0.8;">
                        <div class="vd-filter-label">Dia</div>
                        <select id="vd-filter-day" class="vd-input"></select>
                    </div>
                    <div class="vd-filter-group" style="flex: 0.8;">
                        <div class="vd-filter-label">Hora</div>
                        <select id="vd-filter-hour" class="vd-input"></select>
                    </div>
                    <div class="vd-filter-group" style="flex: 1;">
                        <div class="vd-filter-label">Shift</div>
                        <select id="vd-filter-shift" class="vd-input">
                            <option value="Todos">Todos</option>
                            <option value="t1">T1 (05:00 - 17:00)</option>
                            <option value="t2">T2 (17:00 - 05:00)</option>
                        </select>
                    </div>
                    <div class="vd-filter-group" style="flex: 1.5;">
                        <div class="vd-filter-label">Lane</div>
                        <select id="vd-filter-route" class="vd-input"></select>
                    </div>
                    <div class="vd-filter-group" style="flex: 2;">
                        <div class="vd-filter-label">Busca Rápida (Load ID)</div>
                        <input type="text" id="vd-filter-search" class="vd-input" placeholder="Digite para filtrar...">
                    </div>
                </div>

                <div class="vd-table-container">
                    <div id="vd-schedule-container" style="flex: 1; overflow-y: auto;">
                        <table class="vd-table">
                            <thead>
                                <tr>
                                    <th style="width: 80px;">Shift</th>
                                    <th style="text-align: left; padding-left: 20px;">Lane / Destino</th>
                                    <th style="width: 100px;">Total</th>
                                    <th style="width: 110px;">Rem. Sort</th>
                                    <th style="width: 110px;">Rem. Xdk</th>
                                    <th style="width: 90px;">SAT</th>
                                    <th style="width: 90px;">AAT</th>
                                </tr>
                            </thead>
                            <tbody id="vd-schedule-body"></tbody>
                        </table>
                    </div>
                </div>
            </div>

            <div class="vd-footer">
                <button class="vd-btn vd-btn-orange" id="vd-copy-btn">📋 Copiar Relatório</button>
            </div>
        `;
        document.body.appendChild(root);

        makeDraggable(root, document.getElementById('vd-drag-handle'));

        // Interações
        launchBtn.onclick = () => {
            root.style.display = root.style.display === 'flex' ? 'none' : 'flex';
            if (root.style.display === 'flex') updateDashboard();
        };

        document.getElementById('vd-close-btn').onclick = () => { root.style.display = 'none'; };

        document.getElementById('vd-fs-toggle').onclick = () => {
            const isFs = root.classList.toggle('vd-fullscreen');
            document.getElementById('vd-fs-toggle').textContent = isFs ? '❐' : '⛶';
            if (isFs) {
                root.style.top = '0';
                root.style.left = '0';
            } else {
                const savedPos = GM_getValue('vd_pos', { top: '20px', left: 'auto' });
                root.style.top = savedPos.top;
                root.style.left = savedPos.left;
            }
        };

        document.getElementById('vd-settings-btn').onclick = openSettings;
        document.getElementById('vd-settings-save').onclick = closeSettings;
        document.getElementById('vd-settings-all').onclick = () => toggleAllSettings(true);
        document.getElementById('vd-settings-none').onclick = () => toggleAllSettings(false);

        document.getElementById('vd-copy-btn').onclick = copySummary;

        const daySel = document.getElementById('vd-filter-day');
        const hourSel = document.getElementById('vd-filter-hour');
        const shiftSel = document.getElementById('vd-filter-shift');
        const routeSel = document.getElementById('vd-filter-route');
        const searchInp = document.getElementById('vd-filter-search');

        daySel.onchange = (e) => { filters.day = e.target.value; updateDashboard(); };
        hourSel.onchange = (e) => { filters.hour = e.target.value; updateDashboard(); };
        shiftSel.onchange = (e) => { filters.shift = e.target.value; updateDashboard(); };
        routeSel.onchange = (e) => { filters.route = e.target.value; updateDashboard(); };
        searchInp.oninput = (e) => { filters.search = e.target.value; updateDashboard(); };
    }

    function openSettings() {
        const modal = document.getElementById('vd-settings-modal');
        const list = document.getElementById('vd-settings-list');
        const routes = [...new Set([...document.querySelectorAll('#inboundDataTables .IBRoute'), ...document.querySelectorAll('#outsideSortPlanDataTables .IBRoute')].map(el => el.textContent.trim()))].sort();

        list.innerHTML = routes.map(route => `
            <label class="vd-settings-item">
                <input type="checkbox" value="${route}" ${!hiddenRoutes.includes(route) ? 'checked' : ''}>
                <span>${route}</span>
            </label>
        `).join('');
        modal.style.display = 'flex';
    }

    function closeSettings() {
        const list = document.getElementById('vd-settings-list');
        const checked = [...list.querySelectorAll('input:checked')].map(i => i.value);
        const all = [...list.querySelectorAll('input')].map(i => i.value);
        hiddenRoutes = all.filter(r => !checked.includes(r));
        GM_setValue('vd_hidden_routes', hiddenRoutes);
        document.getElementById('vd-settings-modal').style.display = 'none';
        updateDashboard();
    }

    function toggleAllSettings(check) {
        document.querySelectorAll('#vd-settings-list input').forEach(i => i.checked = check);
    }

    function updateSelectOptions(id, options, current) {
        const el = document.getElementById(id);
        if (!el) return;
        const val = current || el.value;
        el.innerHTML = options.map(opt => `<option value="${opt}" ${opt === val ? 'selected' : ''}>${opt}</option>`).join('');
    }

    function updateDashboard() {
        if (document.getElementById('vista-dashboard-root').style.display === 'none') return;

        const inboundRows = document.querySelectorAll('#inboundDataTables tbody tr:not(.group):not(.slamCountBar)');
        const outsideRows = document.querySelectorAll('#outsideSortPlanDataTables tbody tr:not(.group)');
        const allScrapedData = [];

        const scrapeRows = (rows) => {
            rows.forEach(row => {
                const cells = row.querySelectorAll('td');
                if (cells.length < 8) return;

                const route = row.querySelector('.IBRoute')?.textContent?.replace(/\s+/g, ' ').trim() || '';
                if (hiddenRoutes.includes(route)) return; // Filtro de Lane personalizado

                const loadId = row.querySelector('.LoadID')?.textContent?.trim() || '';
                const satText = cells[6]?.textContent || '';
                const aatText = cells[7]?.textContent || '';

                const volTotal = row.querySelector('.total-remaining-count')?.textContent?.trim()?.replace(/,/g, '') || '0';
                const volSort = (row.querySelector('.sort-pkg-count') || row.querySelector('.sort.count'))?.textContent?.trim()?.replace(/,/g, '') || '0';
                const volXdock = (row.querySelector('.xDock-pkg-count') || row.querySelector('.xdock-pkt-count'))?.textContent?.trim()?.replace(/,/g, '') || '0';

                const satDate = parseVistaDate(satText);
                if (satDate) {
                    const aatDate = parseVistaDate(aatText);
                    const delay = calculateDelay(satDate, aatDate);
                    allScrapedData.push({
                        sat: satDate, aat: aatDate, shift: getShiftLabel(satDate),
                        loadId: loadId, route: route, dayStr: formatDate(satDate),
                        hourStr: formatTime(satDate), delay: delay,
                        vol: { total: parseInt(volTotal), sort: parseInt(volSort), xdock: parseInt(volXdock) }
                    });
                }
            });
        };

        scrapeRows(inboundRows); scrapeRows(outsideRows);

        const uniqueDays = ['Todos', ...([...new Set(allScrapedData.map(d => d.dayStr))].sort())];
        const uniqueHours = ['Todos', ...([...new Set(allScrapedData.map(d => d.hourStr))].sort())];
        const uniqueRoutes = ['Todos', ...([...new Set(allScrapedData.map(d => d.route))].sort())];

        updateSelectOptions('vd-filter-day', uniqueDays, filters.day);
        updateSelectOptions('vd-filter-hour', uniqueHours, filters.hour);
        updateSelectOptions('vd-filter-route', uniqueRoutes, filters.route);

        const filteredData = allScrapedData.filter(item => {
            if (filters.day !== 'Todos' && item.dayStr !== filters.day) return false;
            if (filters.hour !== 'Todos' && item.hourStr !== filters.hour) return false;
            if (filters.shift !== 'Todos' && item.shift !== filters.shift) return false;
            if (filters.route !== 'Todos' && item.route !== filters.route) return false;
            if (filters.search && !item.loadId.toLowerCase().includes(filters.search.toLowerCase())) return false;
            return true;
        });

        filteredData.sort((a, b) => a.sat - b.sat);
        const tbody = document.getElementById('vd-schedule-body');
        if (!tbody) return;

        // Totais e Atrasos
        let totalVol = 0, totalSrt = 0, totalXdk = 0, delayCount = 0;
        filteredData.forEach(d => {
            totalVol += d.vol.total; totalSrt += d.vol.sort; totalXdk += d.vol.xdock;
            if (d.delay) delayCount++;
        });

        document.getElementById('vd-total-vol').textContent = totalVol.toLocaleString();
        document.getElementById('vd-total-srt').textContent = totalSrt.toLocaleString();
        document.getElementById('vd-total-xdk').textContent = totalXdk.toLocaleString();
        document.getElementById('vd-total-delays-summary').textContent = delayCount;
        
        const delaySummaryCard = document.getElementById('vd-total-delays-summary');
        if (delayCount > 0) {
            delaySummaryCard.classList.add('vd-metric-danger');
        } else {
            delaySummaryCard.classList.remove('vd-metric-danger');
        }

        if (allScrapedData.length === 0) {
            tbody.innerHTML = Array(12).fill(`<tr>${Array(7).fill('<td><div class="vd-skeleton"></div></td>').join('')}</tr>`).join('');
            document.getElementById('vd-last-update').textContent = 'Carregando...';
            return;
        }

        if (filteredData.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="padding: 40px; opacity: 0.5;">Filtros sem resultados ou Lanes ocultas nas configurações.</td></tr>';
        } else {
            tbody.innerHTML = filteredData.map(item => {
                const isDelayed = item.delay !== null;
                const rowClass = isDelayed ? 'vd-row-delayed' : '';
                const delayText = isDelayed ? `<span class="vd-delay-badge">${item.delay.isPending ? '⚠️ PENDING: ' : '⚠️ DELAY: '}${item.delay.str}</span>` : '';
                
                const satDisplay = `<div style="font-size:9px; opacity:0.6">${item.dayStr}</div><div>${item.hourStr}</div>`;
                const aatDisplay = item.aat ? `<div style="font-size:9px; opacity:0.6">${formatDate(item.aat)}</div><div>${formatTime(item.aat)}</div>` : '—';
                
                return `
                    <tr class="${rowClass}">
                        <td><span class="vd-shift-tag vd-shift-${item.shift}">${item.shift.toUpperCase()}</span></td>
                        <td style="text-align: left; padding-left: 20px;">
                            <div style="font-weight: 700; color: #fff;">${item.route}</div>
                            ${delayText}
                        </td>
                        <td style="font-weight: 800; color: #FF9900;">${item.vol.total.toLocaleString()}</td>
                        <td style="opacity: 0.8;">${item.vol.sort.toLocaleString()}</td>
                        <td style="opacity: 0.8;">${item.vol.xdock.toLocaleString()}</td>
                        <td style="font-family: monospace; font-size: 12px; font-weight: 600;">${satDisplay}</td>
                        <td style="font-family: monospace; font-size: 12px; color: ${isDelayed ? '#ff5252' : '#00C853'};">${aatDisplay}</td>
                    </tr>
                `;
            }).join('');
        }
        document.getElementById('vd-last-update').textContent = new Date().toLocaleTimeString('pt-BR');
    }

    function copySummary() {
        const node = document.querySelector('#availableNodeName')?.value || 'N/A';
        let summary = `📋 *Logística Inbound VISTA - ${node}*\n\n`;
        const rows = document.querySelectorAll('#vd-schedule-body tr');
        rows.forEach((row, i) => {
            const shift = row.querySelector('.vd-shift-tag')?.textContent;
            if (!shift) return;
            const cells = row.querySelectorAll('td');
            const route = cells[1].querySelector('div')?.textContent || 'N/A';
            const delay = cells[1].querySelector('.vd-delay-badge')?.textContent || '';
            const volTot = cells[2].textContent;
            const volSrt = cells[3].textContent;
            const volXdk = cells[4].textContent;
            const sat = cells[5].innerText.replace(/\s+/g, ' ').trim();
            const aat = cells[6].innerText.replace(/\s+/g, ' ').trim();
            summary += `[${shift}] ${route} | Total: ${volTot} (Sort: ${volSrt} | XD: ${volXdk}) | SAT: ${sat} | AAT: ${aat} ${delay ? `(${delay})` : ''}\n`;
        });

        const totVol = document.getElementById('vd-total-vol').textContent;
        const totSrt = document.getElementById('vd-total-srt').textContent;
        const totXdk = document.getElementById('vd-total-xdk').textContent;
        const totDel = document.getElementById('vd-total-delays-summary').textContent;
        summary += `\n📊 *Resumo Filtrado*\nTotal: ${totVol} | Sort: ${totSrt} | XD: ${totXdk} | Atrasos: ${totDel}`;

        navigator.clipboard.writeText(summary).then(() => {
            const btn = document.getElementById('vd-copy-btn');
            const original = btn.textContent;
            btn.textContent = '✅ Copiado!';
            setTimeout(() => btn.textContent = original, 2000);
        });
    }

    const checkReady = setInterval(() => {
        if (document.querySelector('#inboundDataTables tbody tr')) {
            clearInterval(checkReady);
            createDashboard();
            setInterval(updateDashboard, UI_CONFIG.refreshInterval);
        }
    }, 1000);

})();
