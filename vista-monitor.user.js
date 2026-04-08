// ==UserScript==
// @name         VISTA Monitor & Dashboard
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  Monitor de métricas em tempo real para o VISTA (Inbound/SLAM) com UI Premium
// @author       emanunec
// @match        https://trans-logistics.amazon.com/sortcenter/vista/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const UI_CONFIG = {
        refreshInterval: 15000, 
        accentColor: '#f39c12',
        glassBg: 'rgba(30, 39, 46, 0.85)',
        glassBorder: 'rgba(255, 255, 255, 0.1)',
        fontFamily: "'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
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
            background: ${UI_CONFIG.accentColor};
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            z-index: 10001;
            box-shadow: 0 4px 15px rgba(0,0,0,0.4);
            transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            font-size: 24px;
            border: 2px solid rgba(255,255,255,0.2);
        }
        #vd-launch-btn:hover { transform: scale(1.1) rotate(5deg); box-shadow: 0 6px 20px rgba(0,0,0,0.6); }

        #vista-dashboard-root {
            position: fixed;
            top: 20px;
            right: 20px;
            width: 800px;
            height: 600px;
            min-width: 450px;
            min-height: 250px;
            z-index: 10000;
            font-family: ${UI_CONFIG.fontFamily};
            color: white;
            background: ${UI_CONFIG.glassBg};
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border: 1px solid ${UI_CONFIG.glassBorder};
            border-radius: 12px;
            box-shadow: 0 12px 40px rgba(0,0,0,0.5);
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
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            padding: 12px 15px;
            cursor: move;
            background: rgba(0, 0, 0, 0.4);
            user-select: none;
        }

        .vd-header-actions {
            display: flex;
            gap: 12px;
            align-items: center;
        }

        .vd-action-icon {
            cursor: pointer;
            opacity: 0.7;
            transition: all 0.2s;
            font-size: 16px;
        }
        .vd-action-icon:hover { opacity: 1; transform: scale(1.1); }

        .vd-title {
            font-size: 13px;
            font-weight: 900;
            color: ${UI_CONFIG.accentColor};
            display: flex;
            align-items: center;
            gap: 8px;
            letter-spacing: 0.5px;
        }

        .vd-content {
            padding: 15px;
            display: flex;
            flex-direction: column;
            gap: 10px;
            overflow-y: auto;
            flex: 1;
        }

        .vd-summary-bar {
            display: flex;
            background: rgba(0,0,0,0.2);
            padding: 5px 0;
            border-bottom: 1px solid rgba(255,255,255,0.05);
            font-size: 11px;
            font-weight: 800;
        }
        .vd-summary-item { flex: 1; text-align: center; color: ${UI_CONFIG.accentColor}; }
        .vd-summary-delay { color: #ff7675; }

        .vd-filters {
            background: rgba(255, 255, 255, 0.05);
            padding: 8px;
            border-radius: 8px;
            display: flex;
            gap: 8px;
            align-items: center;
        }

        .vd-input {
            background: rgba(0,0,0,0.3);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 4px;
            color: white;
            padding: 4px 8px;
            font-size: 11px;
            outline: none;
            width: 100%;
        }
        .vd-input:focus { border-color: ${UI_CONFIG.accentColor}; }

        .vd-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 11px;
        }

        .vd-table th {
            text-align: center;
            padding: 10px 4px;
            border-bottom: 2px solid rgba(255, 255, 255, 0.1);
            background: rgba(0, 0, 0, 0.4);
            color: #ffffff;
            font-weight: 800;
            font-size: 9px;
            text-transform: uppercase;
            white-space: nowrap;
        }

        .vd-table td {
            padding: 12px 6px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
            vertical-align: middle;
            text-align: center;
        }

        .vd-skeleton {
            background: linear-gradient(90deg, rgba(255,255,255,0.05) 25%, rgba(255,255,255,0.1) 50%, rgba(255,255,255,0.05) 75%);
            background-size: 200% 100%;
            animation: vd-shimmer 1.5s infinite;
            border-radius: 4px;
            height: 14px;
            width: 80%;
            display: inline-block;
        }
        @keyframes vd-shimmer {
            0% { background-position: 200% 0; }
            100% { background-position: -200% 0; }
        }

        .vd-row-delayed {
            background: rgba(192, 57, 43, 0.25) !important;
            border-left: 4px solid #ff4d4d !important;
        }
        
        .vd-delay-badge {
            color: #ff7675;
            font-size: 10px;
            font-weight: 900;
            display: block;
            margin-top: 3px;
            text-shadow: 0 1px 2px rgba(0,0,0,0.5);
        }

        .vd-shift-tag {
            font-size: 10px;
            font-weight: 900;
            padding: 3px 6px;
            border-radius: 4px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }
        .vd-shift-t1 { background: #2ecc71; color: #003311; }
        .vd-shift-t2 { background: #3498db; color: #001a33; }

        .vd-time-cell { font-family: monospace; font-size: 12px; }
        .vd-time-sched { font-weight: bold; color: #fff; }
        .vd-time-actual { color: #f1c40f; }
        .vd-time-delayed { color: #ff7675; font-weight: bold; }

        #vd-settings-modal {
            position: absolute;
            top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.85);
            z-index: 10002;
            display: none;
            flex-direction: column;
            padding: 20px;
            backdrop-filter: blur(10px);
        }
        .vd-settings-list {
            flex: 1;
            overflow-y: auto;
            margin: 15px 0;
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
            gap: 10px;
        }
        .vd-settings-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px;
            background: rgba(255,255,255,0.05);
            border-radius: 4px;
            font-size: 11px;
            cursor: pointer;
        }
        .vd-settings-item:hover { background: rgba(255,255,255,0.1); }
        .vd-settings-item input { cursor: pointer; }

        .vd-footer { display: flex; gap: 10px; padding: 10px 15px; border-top: 1px solid rgba(255,255,255,0.05); }
        .vd-btn {
            flex: 1; background: ${UI_CONFIG.accentColor}; color: #1a1200;
            border: none; padding: 8px; border-radius: 6px; font-weight: 800;
            font-size: 11px; cursor: pointer; transition: all 0.2s;
        }
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
            <div id="vd-settings-modal">
                <div class="vd-title" style="font-size: 16px;">⚙️ CONFIGURAÇÕES DE LANES</div>
                <div style="font-size: 11px; opacity: 0.6; margin-top: 5px;">Desmarque as lanes que você deseja ocultar do painel.</div>
                <div class="vd-settings-list" id="vd-settings-list"></div>
                <div style="display: flex; gap: 10px; margin-top: auto;">
                    <button class="vd-btn" id="vd-settings-all">Marcar Todas</button>
                    <button class="vd-btn" id="vd-settings-none">Desmarcar Todas</button>
                    <button class="vd-btn" id="vd-settings-save" style="background:#2ecc71; color:white;">Salvar e Fechar</button>
                </div>
            </div>

            <div class="vd-header" id="vd-drag-handle">
                <div class="vd-title">🚚 ARRIVAL MONITOR</div>
                <div class="vd-header-actions">
                    <div style="font-size: 10px; opacity: 0.5; margin-right: 10px;" id="vd-last-update">--:--:--</div>
                    <span class="vd-action-icon" id="vd-settings-btn" title="Configurar Lanes">⚙️</span>
                    <span class="vd-action-icon" id="vd-fs-toggle" title="Tela Cheia">⛶</span>
                    <span class="vd-action-icon" id="vd-close-btn" title="Fechar">✕</span>
                </div>
            </div>

            <div class="vd-content">
                <div class="vd-filters" style="flex-wrap: wrap;">
                    <div style="flex: 1; min-width: 60px;">
                        <div class="vd-label" style="font-size:9px; margin-bottom:4px; opacity:0.5;">Dia</div>
                        <select id="vd-filter-day" class="vd-input"></select>
                    </div>
                    <div style="flex: 1; min-width: 60px;">
                        <div class="vd-label" style="font-size:9px; margin-bottom:4px; opacity:0.5;">Hora</div>
                        <select id="vd-filter-hour" class="vd-input"></select>
                    </div>
                    <div style="flex: 1; min-width: 60px;">
                        <div class="vd-label" style="font-size:9px; margin-bottom:4px; opacity:0.5;">Shift</div>
                        <select id="vd-filter-shift" class="vd-input">
                            <option value="Todos">Todos</option>
                            <option value="t1">T1 (05:00 - 17:00)</option>
                            <option value="t2">T2 (17:00 - 05:00)</option>
                        </select>
                    </div>
                    <div style="flex: 2; min-width: 120px;">
                        <div class="vd-label" style="font-size:9px; margin-bottom:4px; opacity:0.5;">Lane</div>
                        <select id="vd-filter-route" class="vd-input"></select>
                    </div>
                    <div style="width: 100%;">
                        <input type="text" id="vd-filter-search" class="vd-input" placeholder="Buscar ID da Carga...">
                    </div>
                </div>
                
                <div id="vd-schedule-container" style="flex: 1; overflow-y: auto;">
                    <table class="vd-table">
                        <thead style="position: sticky; top: 0; z-index: 10; background: ${UI_CONFIG.glassBg};">
                            <tr style="background: rgba(243, 156, 18, 0.1);">
                                <th colspan="2"></th>
                                <th id="vd-total-vol" style="color: ${UI_CONFIG.accentColor}; font-size: 11px;">0</th>
                                <th id="vd-total-srt" style="color: ${UI_CONFIG.accentColor}; font-size: 11px;">0</th>
                                <th id="vd-total-xdk" style="color: ${UI_CONFIG.accentColor}; font-size: 11px;">0</th>
                                <th colspan="2" id="vd-total-delays-summary" style="color: #ff7675; font-size: 10px; text-align: center;">Atrasos: 0</th>
                            </tr>
                            <tr>
                                <th style="width: 60px;">Shift</th>
                                <th style="min-width: 120px;">Lane</th>
                                <th style="width: 100px;">Total</th>
                                <th style="width: 120px;">Remaining Sortation</th>
                                <th style="width: 120px;">Remaining Xdock</th>
                                <th style="width: 80px;">SAT</th>
                                <th style="width: 80px;">AAT</th>
                            </tr>
                        </thead>
                        <tbody id="vd-schedule-body">
                        </tbody>
                    </table>
                </div>
            </div>

            <div class="vd-footer">
                <button class="vd-btn" id="vd-copy-btn">📋 Copiar Tabela</button>
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
        document.getElementById('vd-total-delays-summary').textContent = `Atrasos: ${delayCount}`;

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
                const delayText = isDelayed ? `<span class="vd-delay-badge">${item.delay.isPending ? 'Sem CheckIn: ' : 'atraso de: '}${item.delay.str}</span>` : '';
                const aatStyle = isDelayed ? 'vd-time-delayed' : 'vd-time-actual';
                return `
                    <tr class="${rowClass}">
                        <td><span class="vd-shift-tag vd-shift-${item.shift}">${item.shift.toUpperCase()}</span></td>
                        <td><span style="font-size: 11px; opacity: 0.95; font-weight:800; color:#fff;">${item.route}</span>${delayText}</td>
                        <td style="font-weight: 800; color: ${UI_CONFIG.accentColor};">${item.vol.total.toLocaleString()}</td>
                        <td style="opacity: 0.9;">${item.vol.sort.toLocaleString()}</td>
                        <td style="opacity: 0.9;">${item.vol.xdock.toLocaleString()}</td>
                        <td class="vd-time-cell vd-time-sched"><span style="display:block; font-size:9px; opacity:0.6">${item.dayStr}</span>${item.hourStr}</td>
                        <td class="vd-time-cell ${aatStyle}"><span style="display:block; font-size:9px; opacity:0.6">${formatDate(item.aat)}</span>${formatTime(item.aat)}</td>
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
            const routeCell = row.querySelectorAll('td')[1];
            const route = routeCell.querySelector('span').textContent;
            const delay = routeCell.querySelector('.vd-delay-badge')?.textContent || '';
            const volTot = row.querySelectorAll('td')[2].textContent;
            const volSrt = row.querySelectorAll('td')[3].textContent;
            const volXdk = row.querySelectorAll('td')[4].textContent;
            const sat = row.querySelector('.vd-time-sched').textContent.replace(/\s+/g, ' ').trim();
            const aat = row.querySelector('.vd-time-actual, .vd-time-delayed')?.textContent?.replace(/\s+/g, ' ')?.trim() || '--:--';
            summary += `[${shift}] ${route} | Total: ${volTot} (Sort: ${volSrt} | XD: ${volXdk}) | SAT: ${sat} | AAT: ${aat} ${delay ? `(${delay})` : ''}\n`;
        });

        const totVol = document.getElementById('vd-total-vol').textContent;
        const totSrt = document.getElementById('vd-total-srt').textContent;
        const totXdk = document.getElementById('vd-total-xdk').textContent;
        const totDel = document.getElementById('vd-total-delays-summary').textContent;
        summary += `\n📊 *Resumo Filtrado*\nTotal: ${totVol} | Sort: ${totSrt} | XD: ${totXdk} | ${totDel}`;

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
