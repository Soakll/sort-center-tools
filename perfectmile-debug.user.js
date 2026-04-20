// ==UserScript==
// @name         PerfectMile Debug Tool
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Log de requisições e retorno do PerfectMile
// @author       Antigravity
// @match        https://perfectmile-na.amazon.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    GM_addStyle(`
            @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Space+Grotesk:wght@400;500;600;700&display=swap');

            :root {
                --bg-deep:    #070b10;
                --bg-panel:   rgba(9, 14, 22, 0.97);
                --bg-card:    #0c1420;
                --bg-surface: #111d2e;
                --border:     rgba(56, 139, 253, 0.15);
                --border-hi:  rgba(56, 139, 253, 0.4);
                --accent:     #388bfd;
                --accent-2:   #3fb950;
                --accent-3:   #d29922;
                --danger:     #f85149;
                --text-1:     #e6edf3;
                --text-2:     #8b949e;
                --text-3:     #484f58;
                --mono:       'JetBrains Mono', monospace;
                --sans:       'Space Grotesk', sans-serif;
            }

            #pm-debug-panel {
                position: fixed;
                top: 0; right: 0; bottom: 0; left: 0;
                background: var(--bg-panel);
                backdrop-filter: blur(20px) saturate(180%);
                border: none;
                box-shadow: none;
                color: var(--text-1);
                font-family: var(--sans);
                display: flex;
                flex-direction: column;
                z-index: 999999;
                overflow: hidden;
            }

            /* ─── Header ─── */
            #pm-debug-header {
                padding: 10px 16px;
                background: rgba(255,255,255,0.025);
                border-bottom: 1px solid var(--border);
                cursor: move;
                display: flex;
                justify-content: space-between;
                align-items: center;
                flex-shrink: 0;
            }
            .pm-header-left { display: flex; align-items: center; gap: 12px; }
            .pm-logo {
                width: 28px; height: 28px;
                background: linear-gradient(135deg, #388bfd, #1f6feb);
                border-radius: 7px;
                display: flex; align-items: center; justify-content: center;
                font-size: 11px; font-weight: 700; color: #fff;
                letter-spacing: -0.5px;
            }
            #pm-debug-header h3 {
                margin: 0;
                font-size: 13px; font-weight: 700;
                letter-spacing: 1.5px;
                color: var(--text-1);
                text-transform: uppercase;
            }
            .pm-header-right { display: flex; align-items: center; gap: 10px; }
            .pm-date-group {
                display: flex; align-items: center; gap: 6px;
                background: rgba(255,255,255,0.04);
                padding: 5px 10px; border-radius: 7px;
                border: 1px solid var(--border);
            }
            .pm-date-group label { font-size: 10px; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.5px; }
            .pm-date-input {
                background: transparent; border: none;
                color: var(--accent); font-size: 12px;
                font-family: var(--mono);
                outline: none; cursor: pointer;
            }
            .pm-progress-text { font-size: 11px; font-weight: 600; color: var(--accent-2); font-family: var(--mono); }
            .pm-btn-close {
                background: none; border: none;
                color: var(--text-3); cursor: pointer;
                font-size: 16px; padding: 2px 6px; border-radius: 5px;
                transition: all 0.15s;
                line-height: 1;
            }
            .pm-btn-close:hover { background: rgba(248,81,73,0.15); color: var(--danger); }

            /* ─── Progress ─── */
            #pm-progress-container { height: 3px; background: rgba(255,255,255,0.04); width: 100%; display: none; flex-shrink: 0; }
            #pm-progress-bar { height: 100%; background: linear-gradient(90deg, #388bfd, #3fb950); width: 0%; transition: width 0.4s ease; box-shadow: 0 0 12px rgba(56,139,253,0.5); }

            /* ─── Tabs ─── */
            .pm-tabs {
                display: flex; gap: 2px;
                background: rgba(0,0,0,0.2);
                padding: 0 12px;
                border-bottom: 1px solid var(--border);
                flex-shrink: 0;
            }
            .pm-tab {
                padding: 9px 14px;
                font-size: 11px; font-weight: 600;
                color: var(--text-3); cursor: pointer;
                border-bottom: 2px solid transparent;
                transition: all 0.2s; letter-spacing: 0.5px;
                text-transform: uppercase;
            }
            .pm-tab:hover { color: var(--text-1); }
            .pm-tab.active { color: var(--accent); border-bottom-color: var(--accent); }

            /* ─── Tab Content ─── */
            .pm-tab-content { display: none; flex: 1; flex-direction: column; overflow: hidden; min-height: 0; }
            .pm-tab-content.active { display: flex; }

            /* ─── Log Tab ─── */
            /*.pm-tab-content.active { display: flex; }*/

            .pm-btn {
                background: #1f6feb;
                color: #fff; border: 1px solid rgba(56,139,253,0.3);
                border-radius: 7px; padding: 6px 14px;
                font-size: 12px; font-weight: 600;
                font-family: var(--sans);
                cursor: pointer; transition: all 0.2s; letter-spacing: 0.3px;
            }
            .pm-btn:hover { background: #388bfd; box-shadow: 0 0 16px rgba(56,139,253,0.3); }
            .pm-btn:disabled { background: #1a2233; color: var(--text-3); cursor: not-allowed; box-shadow: none; }
            .pm-btn-secondary { background: #161d29; border-color: var(--border); }
            .pm-btn-secondary:hover { background: #1e2a3a; box-shadow: none; }

            #pm-debug-toggle {
                position: fixed; bottom: 20px; right: 20px;
                width: 38px; height: 38px;
                background: linear-gradient(135deg, #1f6feb, #388bfd);
                color: white; border-radius: 10px;
                display: flex; align-items: center; justify-content: center;
                cursor: pointer;
                box-shadow: 0 4px 20px rgba(56,139,253,0.35);
                z-index: 999998; font-weight: 700; font-size: 11px;
                border: none; transition: all 0.2s;
                letter-spacing: -0.5px;
            }
            #pm-debug-toggle:hover { transform: scale(1.08); box-shadow: 0 6px 24px rgba(56,139,253,0.5); }

            .log-timestamp { color: var(--text-3); font-size: 10px; margin-right: 6px; }

            /* ─── Explorer Tab ─── */
            .pm-input {
                background: var(--bg-card); border: 1px solid var(--border);
                border-radius: 7px; color: var(--text-1);
                padding: 5px 10px; font-size: 12px; flex: 1;
                font-family: var(--sans); outline: none; transition: border-color 0.2s;
            }
            .pm-input:focus { border-color: var(--border-hi); }
            .pm-table-container { flex: 1; overflow: auto; background: var(--bg-deep); min-height: 0; }
            .pm-table { width: 100%; border-collapse: collapse; font-size: 11px; color: var(--text-2); font-family: var(--mono); }
            .pm-table th {
                position: sticky; top: 0;
                background: #0e1724;
                padding: 7px 10px; text-align: left;
                border-bottom: 1px solid var(--border);
                z-index: 10; white-space: nowrap;
                font-family: var(--sans); font-size: 10px;
                letter-spacing: 0.8px; text-transform: uppercase;
                color: var(--text-3);
            }
            .pm-table th:hover { color: var(--text-1); }
            .pm-table td { padding: 6px 10px; border-bottom: 1px solid rgba(255,255,255,0.03); white-space: nowrap; max-width: 180px; overflow: hidden; text-overflow: ellipsis; }
            .pm-table tr:hover td { background: rgba(56,139,253,0.04); }
            .pm-badge { padding: 2px 7px; border-radius: 20px; font-size: 10px; font-weight: 600; font-family: var(--sans); }
            .badge-miss { background: rgba(248,81,73,0.15); color: #f85149; border: 1px solid rgba(248,81,73,0.2); }
            .badge-ok { background: rgba(63,185,80,0.1); color: var(--accent-2); border: 1px solid rgba(63,185,80,0.15); }

            /* ─── Analyses Tab ─── */
            .pm-analyses-toolbar {
                padding: 10px 14px;
                border-bottom: 1px solid var(--border);
                display: flex; gap: 10px; align-items: center; flex-shrink: 0;
                flex-wrap: wrap;
            }
            .pm-threshold-group {
                display: flex; align-items: center; gap: 8px;
                background: rgba(255,255,255,0.04);
                padding: 5px 12px; border-radius: 7px;
                border: 1px solid var(--border);
            }
            .pm-threshold-group label { font-size: 10px; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap; }
            .pm-threshold-input {
                background: transparent; border: none;
                color: var(--accent-3); font-size: 13px; font-weight: 600;
                font-family: var(--mono);
                outline: none; width: 70px;
                text-align: right;
            }
            .pm-threshold-hint { font-size: 10px; color: var(--text-3); }

            .pm-analyses-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(440px, 1fr));
                gap: 12px; padding: 14px;
                overflow-y: auto; flex: 1; min-height: 0;
            }
            .pm-card {
                background: var(--bg-card);
                border: 1px solid var(--border);
                border-radius: 10px;
                overflow: hidden;
                display: flex; flex-direction: column;
                transition: border-color 0.2s;
            }
            .pm-card:hover { border-color: var(--border-hi); }
            .pm-card-header {
                padding: 12px 14px 10px;
                border-bottom: 1px solid var(--border);
                display: flex; justify-content: space-between; align-items: center;
            }
            .pm-card-title { font-size: 11px; font-weight: 700; color: var(--accent); letter-spacing: 1px; text-transform: uppercase; }
            .pm-card-count { font-size: 10px; color: var(--text-3); font-family: var(--mono); }

            .pm-card-body { display: flex; flex-direction: row; overflow: hidden; flex: 1; }
            .pm-pie-container { width: 160px; min-width: 160px; padding: 14px; display: flex; flex-direction: column; align-items: center; gap: 8px; }
            .pm-pie-total { font-size: 10px; color: var(--text-3); text-align: center; font-family: var(--mono); }
            .pm-analysis-list { flex: 1; overflow-y: auto; padding: 8px 0; }
            .pm-analysis-row {
                display: flex; align-items: center; gap: 8px;
                padding: 5px 12px; cursor: default;
                transition: background 0.15s;
            }
            .pm-analysis-row:hover { background: rgba(56,139,253,0.05); }
            .pm-color-dot { width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0; }
            .pm-analysis-name { flex: 1; font-size: 11px; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: var(--mono); }
            .pm-analysis-right { display: flex; flex-direction: column; align-items: flex-end; flex-shrink: 0; }
            .pm-analysis-value { font-size: 12px; font-weight: 600; color: var(--text-1); font-family: var(--mono); }
            .pm-analysis-perc { font-size: 10px; color: #ffffff; font-family: var(--mono); }
            .pm-analysis-bar-wrap { width: 100%; height: 2px; background: rgba(255,255,255,0.06); border-radius: 1px; margin-top: 3px; }
            .pm-analysis-bar { height: 100%; border-radius: 1px; transition: width 0.4s ease; }

            .pm-empty-state { padding: 24px; text-align: center; color: var(--text-3); font-size: 12px; }
            .pm-threshold-excluded { font-size: 10px; color: var(--text-3); font-style: italic; padding: 4px 12px 8px; }

            /* JSON coloring */
            .json-key { color: #79c0ff; }
            .json-string { color: #a5d6ff; }
            .json-number { color: #ffab70; }
            .json-boolean { color: #ff7b72; }

            /* Scrollbar */
            ::-webkit-scrollbar { width: 5px; height: 5px; }
            ::-webkit-scrollbar-track { background: transparent; }
            ::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }
            ::-webkit-scrollbar-thumb:hover { background: #484f58; }

            /* Hide Number Arrows */
            input::-webkit-outer-spin-button,
            input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
            input[type=number] { -moz-appearance: textfield; }

            .pm-card-threshold {
                background: rgba(255,255,255,0.03);
                border: 1px solid var(--border);
                border-radius: 4px;
                color: var(--accent-3);
                font-size: 10px;
                font-weight: 600;
                font-family: var(--mono);
                width: 35px;
                text-align: center;
                outline: none;
                padding: 1px 0;
            }
            .pm-card-threshold:focus { border-color: var(--accent-3); background: rgba(210,153,34,0.05); }

            @keyframes pm-spin { to { transform: rotate(360deg); } }
            .pm-spinner {
                width: 12px; height: 12px;
                border: 2px solid rgba(255,255,255,0.3);
                border-top-color: #fff;
                border-radius: 50%;
                animation: pm-spin 0.8s linear infinite;
                display: inline-block;
                margin-right: 8px;
                vertical-align: middle;
            }
            .pm-btn-details {
                background: linear-gradient(135deg, #f59e0b, #d97706);
                border: none; border-radius: 6px;
                width: 24px; height: 24px;
                display: flex; align-items: center; justify-content: center;
                cursor: pointer; color: #fff; font-size: 11px;
                transition: all 0.2s;
                opacity: 0.6;
            }
            .pm-analysis-row:hover .pm-btn-details { opacity: 1; }
            .pm-btn-details:hover { transform: scale(1.15) rotate(5deg); box-shadow: 0 0 10px rgba(245, 158, 11, 0.4); }
        `);

    // ─── Pie chart colors ───
    const PALETTE = [
        '#388bfd', '#3fb950', '#d29922', '#f85149', '#a371f7',
        '#39d3dd', '#e3b341', '#ff7b72', '#56d364', '#79c0ff',
        '#ffa657', '#bc8cff', '#67e3f9', '#f97583', '#85e89d',
    ];

    // ─── UI Build ───
    const panel = document.createElement('div');
    panel.id = 'pm-debug-panel';

    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = yesterdayDate.toISOString().split('T')[0];

    panel.innerHTML = `
            <div id="pm-debug-header">
                <div class="pm-header-left">
                    <div class="pm-logo">PM</div>
                    <h3>PerfectMile Debugger</h3>
                </div>
                <div style="flex: 1; display: flex; justify-content: center; padding: 0 20px;">
                    <input type="text" id="pm-search" class="pm-input" placeholder="🔍 Filtrar por TID, VRID, Bucket..." style="max-width: 400px; height: 30px;">
                </div>
                <div class="pm-header-right">
                    <span id="pm-progress-text" class="pm-progress-text" style="display:none;">0%</span>
                    <div class="pm-date-group">
                        <label>De</label>
                        <input type="date" id="pm-date-start" class="pm-date-input" value="${yesterday}" max="${yesterday}">
                    </div>
                    <div class="pm-date-group">
                        <label>Até</label>
                        <input type="date" id="pm-date-end" class="pm-date-input" value="${yesterday}" max="${yesterday}">
                    </div>
                    <div class="pm-date-group" style="border-color: var(--accent-3); gap: 4px;">
                        <label style="color:var(--accent-3)">Vol</label>
                        <input type="text" id="pm-total-volume" class="pm-date-input" style="width: 75px; color: var(--text-1); font-weight: 700; text-align: right;" value="0">
                        <button id="pm-sync-volume" style="background:none; border:none; cursor:pointer; color:var(--text-3); font-size:12px; padding: 0 2px;" title="Sincronizar volume">🔄</button>
                    </div>
                    <button id="pm-run" class="pm-btn" style="background: var(--accent); color: white; border: none; font-weight: 700;" disabled>⏳ Carregando módulos...</button>
                    <button class="pm-btn-close" title="Esconder">×</button>
                </div>
            </div>
            <div id="pm-progress-container"><div id="pm-progress-bar"></div></div>

            <div class="pm-tabs">
                <div class="pm-tab active" data-tab="explorer">Explorador <span id="pm-count-badge">(0)</span></div>
                <div class="pm-tab" data-tab="analyses">Análises</div>
            </div>

            <!-- Tab Explorer -->
            <div id="pm-tab-explorer" class="pm-tab-content active">
                <div id="pm-filter-status" style="background: rgba(56,139,253,0.06); padding: 8px 14px; font-size: 11px; display: none; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border);">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span style="color: var(--text-3); text-transform: uppercase; font-size: 10px; font-weight: 700; letter-spacing: 0.5px;">Filtro de Análise:</span>
                        <span id="pm-filter-text" style="color: var(--accent); font-weight: 700; font-family: var(--mono); background: rgba(56,139,253,0.1); padding: 2px 8px; border-radius: 4px;"></span>
                    </div>
                    <button id="pm-clear-filter" style="background: rgba(248,81,73,0.1); border: 1px solid rgba(248,81,73,0.2); color: var(--danger); cursor: pointer; font-size: 10px; font-weight: 700; text-transform: uppercase; padding: 4px 10px; border-radius: 5px; transition: all 0.2s;">Limpar Filtro</button>
                </div>
                <div id="pm-table-area" class="pm-table-container">
                    <table class="pm-table">
                        <thead id="pm-table-thead"></thead>
                        <tbody id="pm-table-tbody">
                            <tr><td colspan="62" class="pm-empty-state">Nenhum dado capturado ainda.</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Tab Analyses -->
            <div id="pm-tab-analyses" class="pm-tab-content">
                <div id="pm-analyses-grid" class="pm-analyses-grid">
                    <!-- KPI Summary Card -->
                    <div class="pm-card" style="grid-column: 1 / -1; margin-bottom: 8px;">
                        <div class="pm-card-header">
                            <span class="pm-card-title">Resumo de Indicadores</span>
                            <span style="font-size: 10px; color: var(--text-3); font-family:var(--mono);">Apenas Buckets</span>
                        </div>
                        <div class="pm-card-body" style="padding: 20px;">
                            <div id="pm-kpi-container" style="display: flex; flex-wrap: wrap; gap: 15px; justify-content: center; width: 100%;">
                                <div class="pm-empty-state">Informe o Volume Total para ver os KPIs...</div>
                            </div>
                        </div>
                    </div>

                    <!-- Analysis Cards -->
                    <div class="pm-card" id="pm-card-buckets">
                        <div class="pm-card-header">
                            <span class="pm-card-title">Buckets</span>
                            <div style="display:flex; align-items:center; gap:8px;">
                                <input type="number" class="pm-card-threshold" value="0" min="0" title="Ignorar abaixo de...">
                                <span class="pm-card-count">—</span>
                            </div>
                        </div>
                        <div class="pm-card-body">
                            <div class="pm-pie-container" id="pm-pie-buckets"></div>
                            <div id="pm-analysis-buckets" class="pm-analysis-list"></div>
                        </div>
                    </div>
                    <div class="pm-card" id="pm-card-lanes">
                        <div class="pm-card-header">
                            <span class="pm-card-title">OB Lanes</span>
                            <div style="display:flex; align-items:center; gap:8px;">
                                <input type="number" class="pm-card-threshold" value="0" min="0" title="Ignorar abaixo de...">
                                <span class="pm-card-count">—</span>
                            </div>
                        </div>
                        <div class="pm-card-body">
                            <div class="pm-pie-container" id="pm-pie-lanes"></div>
                            <div id="pm-analysis-lanes" class="pm-analysis-list"></div>
                        </div>
                    </div>
                    <!-- VRIDs Section -->
                    <div class="pm-card" id="pm-card-ibvrids">
                        <div class="pm-card-header">
                            <span class="pm-card-title">IB VRIDs Detail</span>
                            <div style="display:flex; align-items:center; gap:8px;">
                                <input type="number" class="pm-card-threshold" value="0" min="0" title="Ignorar abaixo de...">
                                <span class="pm-card-count">—</span>
                            </div>
                        </div>
                        <div class="pm-card-body">
                            <div class="pm-pie-container" id="pm-pie-ibvrids"></div>
                            <div id="pm-analysis-ibvrids" class="pm-analysis-list"></div>
                        </div>
                    </div>
                    <div class="pm-card" id="pm-card-obvrids">
                        <div class="pm-card-header">
                            <span class="pm-card-title">OB VRIDs Detail</span>
                            <div style="display:flex; align-items:center; gap:8px;">
                                <input type="number" class="pm-card-threshold" value="0" min="0" title="Ignorar abaixo de...">
                                <span class="pm-card-count">—</span>
                            </div>
                        </div>
                        <div class="pm-card-body">
                            <div class="pm-pie-container" id="pm-pie-obvrids"></div>
                            <div id="pm-analysis-obvrids" class="pm-analysis-list"></div>
                        </div>
                    </div>
                    <!-- Pallets Section -->
                    <div class="pm-card" id="pm-card-parentcontainers">
                        <div class="pm-card-header">
                            <span class="pm-card-title">Outbound Pallets</span>
                            <div style="display:flex; align-items:center; gap:8px;">
                                <input type="number" class="pm-card-threshold" value="0" min="0" title="Ignorar abaixo de...">
                                <span class="pm-card-count">—</span>
                            </div>
                        </div>
                        <div class="pm-card-body">
                            <div class="pm-pie-container" id="pm-pie-parentcontainers"></div>
                            <div id="pm-analysis-parentcontainers" class="pm-analysis-list"></div>
                        </div>
                    </div>
                    <div class="pm-card" id="pm-card-ibparentcontainers">
                        <div class="pm-card-header">
                            <span class="pm-card-title">Inbound Pallets</span>
                            <div style="display:flex; align-items:center; gap:8px;">
                                <input type="number" class="pm-card-threshold" value="0" min="0" title="Ignorar abaixo de...">
                                <span class="pm-card-count">—</span>
                            </div>
                        </div>
                        <div class="pm-card-body">
                            <div class="pm-pie-container" id="pm-pie-ibparentcontainers"></div>
                            <div id="pm-analysis-ibparentcontainers" class="pm-analysis-list"></div>
                        </div>
                    </div>
                    <div class="pm-card" id="pm-card-xdock" style="grid-column: span 1;">
                        <div class="pm-card-header">
                            <span class="pm-card-title">Pallets XDOCK</span>
                            <div style="display:flex; align-items:center; gap:8px;">
                                <input type="number" class="pm-card-threshold" value="0" min="0" title="Ignorar abaixo de...">
                                <span class="pm-card-count">—</span>
                            </div>
                        </div>
                        <div class="pm-card-body">
                            <div class="pm-pie-container" id="pm-pie-xdock"></div>
                            <div id="pm-analysis-xdock" class="pm-analysis-list"></div>
                        </div>
                    </div>
                    <!-- Origin Down here -->
                    <div class="pm-card" id="pm-card-origins" style="grid-column: span 1;">
                        <div class="pm-card-header">
                            <span class="pm-card-title">Origin Nodes</span>
                            <div style="display:flex; align-items:center; gap:8px;">
                                <input type="number" class="pm-card-threshold" value="0" min="0" title="Ignorar abaixo de...">
                                <span class="pm-card-count">—</span>
                            </div>
                        </div>
                        <div class="pm-card-body">
                            <div class="pm-pie-container" id="pm-pie-origins"></div>
                            <div id="pm-analysis-origins" class="pm-analysis-list"></div>
                        </div>
                    </div>
                    <div class="pm-card" id="pm-card-shifts">
                        <div class="pm-card-header">
                            <span class="pm-card-title">Turnos</span>
                            <div style="display:flex; align-items:center; gap:8px;">
                                <input type="number" class="pm-card-threshold" value="0" min="0" title="Ignorar abaixo de...">
                                <span class="pm-card-count">—</span>
                            </div>
                        </div>
                        <div class="pm-card-body">
                            <div class="pm-pie-container" id="pm-pie-shifts"></div>
                            <div id="pm-analysis-shifts" class="pm-analysis-list"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;

    const toggle = document.createElement('div');
    toggle.id = 'pm-debug-toggle';
    toggle.innerHTML = 'PM';
    toggle.title = 'Abrir Painel Debug';

    panel.style.display = 'none'; // Iniciar oculto
    document.body.appendChild(panel);
    document.body.appendChild(toggle);

    const logArea = panel.querySelector('#pm-debug-log');
    const btnRun = panel.querySelector('#pm-run');
    const btnClose = panel.querySelector('.pm-btn-close');
    const explorerTabLink = panel.querySelector('[data-tab="explorer"]');
    const explorerTab = panel.querySelector('#pm-tab-explorer');
    const tableThead = panel.querySelector('#pm-table-thead');
    const tableTbody = panel.querySelector('#pm-table-tbody');
    const searchInput = panel.querySelector('#pm-search');
    const inputStart = panel.querySelector('#pm-date-start');
    const inputEnd = panel.querySelector('#pm-date-end');
    const progressBar = panel.querySelector('#pm-progress-bar');
    const progressContainer = panel.querySelector('#pm-progress-container');
    const progressText = panel.querySelector('#pm-progress-text');
    const totalVolumeInput = panel.querySelector('#pm-total-volume');
    const btnSyncVolume = panel.querySelector('#pm-sync-volume');
    const countBadge = panel.querySelector('#pm-count-badge');
    const filterStatus = panel.querySelector('#pm-filter-status');
    const filterText = panel.querySelector('#pm-filter-text');
    const btnClearFilter = panel.querySelector('#pm-clear-filter');

    let capturedData = [];
    let currentSort = { col: null, asc: true };
    let bucketFilter = null;
    let analysisFilter = null; // { col: string, value: string, shift: string, label: string }

    window.setBucketFilter = (bucket) => {
        bucketFilter = (bucket === 'TOTAL' || bucketFilter === bucket) ? null : bucket;
        renderAnalyses();
        if (bucketFilter) {
            log(`Filtro aplicado: Bucket = ${bucketFilter}`, 'info');
        } else {
            log(`Filtro de bucket removido.`, 'info');
        }
    };

    // ─── Toggle ───
    function togglePanel() {
        panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
    }

    // ─── Progress ───
    function setProgress(percent) {
        if (percent === 0) { progressContainer.style.display = 'block'; progressText.style.display = 'block'; }
        if (percent >= 100) { setTimeout(() => { progressContainer.style.display = 'none'; progressText.style.display = 'none'; }, 1200); }
        progressBar.style.width = percent + '%';
        progressText.innerText = Math.round(percent) + '%';
    }

    // ─── Tabs ───
    panel.querySelectorAll('.pm-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            panel.querySelectorAll('.pm-tab, .pm-tab-content').forEach(el => el.classList.remove('active'));
            tab.classList.add('active');
            panel.querySelector(`#pm-tab-${tab.dataset.tab}`).classList.add('active');
            if (tab.dataset.tab === 'explorer') renderTable(capturedData);
            if (tab.dataset.tab === 'analyses') renderAnalyses();
        });
    });

    // ─── Pie chart SVG ───
    function buildPieSVG(items, size = 130) {
        if (!items || items.length === 0) return '<svg width="' + size + '" height="' + size + '"><text x="50%" y="50%" text-anchor="middle" fill="#484f58" font-size="10" dy=".3em">Sem dados</text></svg>';

        const total = items.reduce((s, i) => s + i.qty, 0);
        if (total === 0) return '';

        const cx = size / 2, cy = size / 2;
        const r = (size / 2) - 8;
        const rInner = r * 0.52; // donut hole

        let currentAngle = -Math.PI / 2;
        const segments = [];

        items.forEach((item, idx) => {
            const ratio = item.qty / total;
            const angle = ratio * Math.PI * 2;
            const startAngle = currentAngle;
            const endAngle = currentAngle + angle;

            const x1 = cx + r * Math.cos(startAngle);
            const y1 = cy + r * Math.sin(startAngle);
            const x2 = cx + r * Math.cos(endAngle);
            const y2 = cy + r * Math.sin(endAngle);
            const ix1 = cx + rInner * Math.cos(endAngle);
            const iy1 = cy + rInner * Math.sin(endAngle);
            const ix2 = cx + rInner * Math.cos(startAngle);
            const iy2 = cy + rInner * Math.sin(startAngle);

            const largeArc = angle > Math.PI ? 1 : 0;
            const color = PALETTE[idx % PALETTE.length];

            const d = [
                `M ${x1} ${y1}`,
                `A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`,
                `L ${ix1} ${iy1}`,
                `A ${rInner} ${rInner} 0 ${largeArc} 0 ${ix2} ${iy2}`,
                'Z'
            ].join(' ');

            segments.push(`<path d="${d}" fill="${color}" stroke="var(--bg-card)" stroke-width="1.5" opacity="0.9"><title>${item.name}: ${item.qty.toLocaleString()} (${item.perc}%)</title></path>`);
            currentAngle = endAngle;
        });

        return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="overflow:visible">
                <g style="animation: pm-spin-in 0.5s ease both">${segments.join('')}</g>
            </svg>`;
    }

    // ─── Analyses ───
    function calculateShift(row) {
        const isValid = (v) => v && v !== '-' && v !== 'null' && String(v).trim().length > 0;
        const findVal = (queries) => {
            const keys = Object.keys(row);
            for (const q of queries) {
                const foundKey = keys.find(k => k.toLowerCase().replace(/\s/g, '_') === q.toLowerCase());
                if (foundKey && isValid(row[foundKey])) return row[foundKey];
            }
            return null;
        };

        let date = null;
        // Priority: Stacking -> Staging -> Departure (Actual or Scheduled)
        const vStack = findVal(['stacking_time_utc', 'stacking_time']);
        const vStage = findVal(['staging_time_local', 'staging_time']);
        const vDepart = findVal(['ob_actual_departure_time_utc', 'ob_scheduled_departure_time_utc', 'ob_actual_departure_time']);

        if (vStack) {
            date = new Date(String(vStack).replace(' ', 'T'));
            if (!isNaN(date.getTime())) date.setHours(date.getHours() - 3);
        } else if (vStage) {
            date = new Date(String(vStage).replace(' ', 'T'));
            if (!isNaN(date.getTime())) date.setHours(date.getHours() + 4);
        } else if (vDepart) {
            date = new Date(String(vDepart).replace(' ', 'T'));
            if (!isNaN(date.getTime())) date.setHours(date.getHours() - 3);
        }

        if (!date || isNaN(date.getTime())) return 'Unknown';
        const h = date.getHours();
        return (h >= 6 && h < 18) ? 'T1' : 'T2';
    }

    function groupAndSum(key, data = capturedData, useShift = false, extraKey = null) {
        const groups = {};
        data.forEach(row => {
            const rawValue = row[key] || 'Unknown';
            const shift = row.shift;
            // Só adiciona o prefixo se o turno for T1 ou T2. Se for Unknown ou nulo, deixa só o valor original.
            const val = (useShift && (shift === 'T1' || shift === 'T2'))
                ? `[${shift}] ${rawValue}`
                : rawValue;
            const qty = parseFloat(row.quantity) || 0;

            if (!groups[val]) {
                groups[val] = { qty: 0, extra: null, rawValue: rawValue, shift: (useShift && (shift === 'T1' || shift === 'T2')) ? shift : null };
            }
            groups[val].qty += qty;
            if (extraKey && !groups[val].extra && row[extraKey] && row[extraKey] !== '-') {
                groups[val].extra = row[extraKey];
            }
        });
        return Object.entries(groups)
            .map(([name, info]) => ({ name, qty: info.qty, extra: info.extra, rawValue: info.rawValue, shift: info.shift }))
            .sort((a, b) => b.qty - a.qty);
    }

    function renderAnalyses() {
        // Parser robusto para volume total (aceita 7.102.342, 7,102,342 ou 7102342)
        const rawVol = totalVolumeInput.value.replace(/\./g, '').replace(/,/g, '').trim();
        const totalVolManual = parseFloat(rawVol) || 0;

        // ─── Render KPI Summary Card (Top) ───
        const kpiContainer = panel.querySelector('#pm-kpi-container');
        const bucketItems = groupAndSum('bucket');

        if (kpiContainer) {
            if (totalVolManual <= 0) {
                kpiContainer.innerHTML = '<div class="pm-empty-state">Informe o Volume Total para calcular os indicadores econométricos.</div>';
            } else {
                let totalQty = 0;
                let totalIdx = 0;
                const items = bucketItems.map(item => {
                    const idx = (item.qty / totalVolManual) * 10000;
                    totalQty += item.qty;
                    totalIdx += idx;
                    return { ...item, idx };
                });

                // Helper para cor (Verde -> Amarelo -> Vermelho)
                const getHeatColor = (val, min, max) => {
                    if (max === min) return '#10b981';
                    const ratio = (val - min) / (max - min);
                    const r = Math.round(16 + ratio * (239 - 16));
                    const g = Math.round(185 + ratio * (68 - 185));
                    const b = Math.round(129 + ratio * (68 - 129));
                    return `rgb(${r},${g},${b})`;
                };

                const indices = items.map(i => i.idx);
                const minI = Math.min(...indices);
                const maxI = Math.max(...indices);

                const bucketsHtml = items.map(item => {
                    const color = getHeatColor(item.idx, minI, maxI);
                    const isActive = bucketFilter === item.name;
                    return `
                            <div class="pm-kpi-card" data-bucket="${item.name}" style="background: linear-gradient(var(--bg-card), var(--bg-card)) padding-box, ${isActive ? 'var(--accent)' : color} border-box; border: ${isActive ? '4px' : '2px'} solid transparent; border-radius: 10px; padding: 12px; min-width: 120px; width: 140px; text-align: center; cursor: pointer; transition: all 0.2s; transform: ${isActive ? 'scale(1.05)' : 'scale(1)'}; box-shadow: ${isActive ? '0 0 20px var(--accent)' : 'none'};">
                                <div style="pointer-events:none; font-size: 10px; color: #ffffff; text-transform: uppercase; margin-bottom: 8px; font-weight: 700; opacity: 0.9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${item.name}">${item.name}</div>
                                <div style="pointer-events:none; font-size: 16px; font-weight: 700; color: #ffffff;">${item.qty.toLocaleString()}</div>
                                <div style="pointer-events:none; height: 1px; background: rgba(255,255,255,0.1); margin: 8px 0;"></div>
                                <div style="pointer-events:none; font-size: 18px; font-weight: 900; color: ${color};">${item.idx.toFixed(1)}</div>
                            </div>
                        `;
                }).join('');

                // TOTAL logic: Green < 6.95, Red >= 6.95
                const totalColor = totalIdx < 6.95 ? '#10b981' : '#ef4444';
                const totalCardHtml = `
                        <div class="pm-kpi-card" data-bucket="TOTAL" style="background: linear-gradient(var(--bg-card), var(--bg-card)) padding-box, ${totalColor} border-box; border: 3px solid transparent; border-radius: 10px; padding: 12px; min-width: 120px; width: 140px; text-align: center; box-shadow: 0 4px 15px rgba(0,0,0,0.3); cursor: pointer; transition: transform 0.2s;">
                            <div style="pointer-events:none; font-size: 11px; color: #ffffff; text-transform: uppercase; margin-bottom: 8px; font-weight: 900; letter-spacing: 1px;">TOTAL</div>
                            <div style="pointer-events:none; font-size: 18px; font-weight: 800; color: #ffffff;">${totalQty.toLocaleString()}</div>
                            <div style="pointer-events:none; height: 1px; background: rgba(255,255,255,0.2); margin: 8px 0;"></div>
                            <div style="pointer-events:none; font-size: 20px; font-weight: 950; color: ${totalColor}; text-shadow: 0 0 10px ${totalColor}44;">${totalIdx.toFixed(1)}</div>
                            ${bucketFilter ? '<div style="pointer-events:none; font-size:9px; color:var(--text-3); margin-top:4px;">(Clique para limpar filtro)</div>' : ''}
                        </div>
                    `;

                // Cálculo do Projetado: Total - Missing Info
                const missingInfoItem = items.find(i => i.name.toUpperCase() === 'MISSING INFO');
                const missingInfoQty = missingInfoItem ? missingInfoItem.qty : 0;
                const projetadoQty = totalQty - missingInfoQty;
                const projetadoIdx = (projetadoQty / totalVolManual) * 10000;

                const arrowHtml = `
                        <div style="display: flex; align-items: center; justify-content: center; color: var(--text-3); padding: 0 4px; opacity: 0.7;">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                                <line x1="5" y1="12" x2="19" y2="12"></line>
                                <polyline points="12 5 19 12 12 19"></polyline>
                            </svg>
                        </div>
                    `;

                const projetadoCardHtml = `
                        <div class="pm-kpi-card" style="background: linear-gradient(var(--bg-card), var(--bg-card)) padding-box, var(--accent-3) border-box; border: 3px solid transparent; border-radius: 10px; padding: 12px; min-width: 120px; width: 140px; text-align: center; box-shadow: 0 0 15px rgba(210, 153, 34, 0.15); cursor: default;">
                            <div style="font-size: 11px; color: #ffffff; text-transform: uppercase; margin-bottom: 8px; font-weight: 900; letter-spacing: 1px;">PROJETADO</div>
                            <div style="font-size: 18px; font-weight: 800; color: #ffffff;">${projetadoQty.toLocaleString()}</div>
                            <div style="height: 1px; background: rgba(255,255,255,0.2); margin: 8px 0;"></div>
                            <div style="font-size: 20px; font-weight: 950; color: var(--accent-3); text-shadow: 0 0 10px rgba(210, 153, 34, 0.4);">${projetadoIdx.toFixed(1)}</div>
                        </div>
                    `;

                kpiContainer.innerHTML = bucketsHtml + totalCardHtml + arrowHtml + projetadoCardHtml;

                // Delegated listener for the cards
                kpiContainer.onclick = (e) => {
                    const card = e.target.closest('.pm-kpi-card');
                    if (card) {
                        const bucket = card.dataset.bucket;
                        bucketFilter = (bucket === 'TOTAL' || bucketFilter === bucket) ? null : bucket;
                        renderAnalyses();
                        if (bucketFilter) {
                            log(`Filtro aplicado: Bucket = ${bucketFilter}`, 'info');
                        } else {
                            log(`Filtro de bucket removido.`, 'info');
                        }
                    }
                };
            }
        }

        const renderCard = (listId, pieId, cardId, rawItems, transform, columnKey) => {
            const allItems = transform ? rawItems.map(transform) : rawItems;

            // Local threshold
            const card = panel.querySelector(`#pm-card-${cardId}`);
            const threshold = card ? (parseFloat(card.querySelector('.pm-card-threshold').value) || 0) : 0;

            const shown = allItems.filter(i => i.qty >= threshold);
            const excluded = allItems.filter(i => i.qty < threshold);
            const totalShown = shown.reduce((s, i) => s + i.qty, 0);

            // Update card count
            if (card) {
                const countEl = card.querySelector('.pm-card-count');
                countEl.textContent = `${shown.length} itens` + (excluded.length ? ` · ${excluded.length} ocultos` : '');
            }

            // Add perc after filtering
            const itemsWithPerc = shown.map((item, idx) => ({
                ...item,
                perc: totalShown > 0 ? ((item.qty / totalShown) * 100).toFixed(1) : '0.0',
                color: PALETTE[idx % PALETTE.length]
            }));

            // Pie
            const pieContainer = panel.querySelector(`#${pieId}`);
            if (pieContainer) {
                pieContainer.innerHTML = buildPieSVG(itemsWithPerc) +
                    `<div class="pm-pie-total">${totalShown.toLocaleString()} total</div>`;
            }

            // List
            const listContainer = panel.querySelector(`#${listId}`);
            if (!listContainer) return;
            const maxQty = itemsWithPerc[0]?.qty || 1;

            listContainer.innerHTML = itemsWithPerc.map((item, idx) => `
                    <div class="pm-analysis-row" data-raw-value="${item.rawValue}" data-shift="${item.shift || ''}" data-label="${item.name}">
                        <div class="pm-color-dot" style="background:${item.color}"></div>
                        <div style="display:flex; flex-direction:column; flex:1; overflow:hidden;">
                            <span class="pm-analysis-name" style="font-weight: 500;">${item.name}</span>
                            ${item.extra ? `<span style="font-size: 9px; color: var(--text-2); font-family: var(--mono); opacity: 0.8;">${item.extra}</span>` : ''}
                        </div>
                        <div class="pm-analysis-right" style="flex-direction: row; align-items: center; gap: 10px;">
                            <div style="display: flex; flex-direction: column; align-items: flex-end; min-width: 45px;">
                                <span class="pm-analysis-value">${item.qty.toLocaleString()}</span>
                                <span class="pm-analysis-perc" style="color:var(--text-3); font-size: 9px;">${item.perc}%</span>
                            </div>
                            ${columnKey !== 'bucket' ? `
                                <button class="pm-btn-details" title="Ver pacotes detalhados" data-action="filter">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                                        <circle cx="11" cy="11" r="8"></circle>
                                        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                                    </svg>
                                </button>
                            ` : ''}
                        </div>
                    </div>
                    <div style="padding: 0 12px 4px;">
                        <div class="pm-analysis-bar-wrap">
                            <div class="pm-analysis-bar" style="width:${(item.qty / maxQty * 100).toFixed(1)}%; background:${item.color};"></div>
                        </div>
                    </div>
                `).join('') + (excluded.length ? `<div class="pm-threshold-excluded">+ ${excluded.length} item(s) abaixo do limite (${threshold.toLocaleString()})</div>` : '');

            // Click button for deep filter
            listContainer.onclick = (e) => {
                const btn = e.target.closest('.pm-btn-details');
                if (btn) {
                    const row = btn.closest('.pm-analysis-row');
                    if (row && columnKey !== 'bucket') {
                        analysisFilter = {
                            col: columnKey,
                            value: row.dataset.rawValue,
                            shift: row.dataset.shift || null,
                            label: row.dataset.label
                        };

                        // UI Update
                        filterStatus.style.display = 'flex';
                        filterText.textContent = analysisFilter.label;
                        searchInput.value = '';

                        panel.querySelector('[data-tab="explorer"]').click();
                    }
                }
            };
        };

        if (!capturedData || capturedData.length === 0) {
            ['pm-analysis-buckets', 'pm-analysis-lanes', 'pm-analysis-origins', 'pm-analysis-ibvrids', 'pm-analysis-obvrids', 'pm-analysis-parentcontainers', 'pm-analysis-ibparentcontainers', 'pm-analysis-xdock', 'pm-analysis-shifts'].forEach(id => {
                const el = panel.querySelector(`#${id}`);
                if (el) el.innerHTML = '<div class="pm-empty-state">Nenhum dado capturado.</div>';
            });
            ['pm-pie-buckets', 'pm-pie-lanes', 'pm-pie-origins', 'pm-pie-ibvrids', 'pm-pie-obvrids', 'pm-pie-parentcontainers', 'pm-pie-ibparentcontainers', 'pm-pie-xdock', 'pm-pie-shifts'].forEach(id => {
                const el = panel.querySelector(`#${id}`);
                if (el) el.innerHTML = '';
            });
            return;
        }

        const filteredData = bucketFilter ? capturedData.filter(d => d.bucket === bucketFilter) : capturedData;
        const bucketCard = panel.querySelector('#pm-card-buckets');
        if (bucketCard) bucketCard.style.display = bucketFilter ? 'none' : 'flex';

        renderCard('pm-analysis-buckets', 'pm-pie-buckets', 'buckets', groupAndSum('bucket', filteredData), null, 'bucket');
        renderCard('pm-analysis-lanes', 'pm-pie-lanes', 'lanes', groupAndSum('ob_lane', filteredData), item => ({
            ...item,
            name: item.name.includes('->') ? item.name.split('->')[1].trim() : item.name
        }), 'ob_lane');
        renderCard('pm-analysis-origins', 'pm-pie-origins', 'origins', groupAndSum('fulfillment_origin_node', filteredData), null, 'fulfillment_origin_node');
        renderCard('pm-analysis-ibvrids', 'pm-pie-ibvrids', 'ibvrids', groupAndSum('ib_vrid', filteredData, true, 'fulfillment_origin_node'), item => ({
            ...item,
            extra: item.name.includes('Unknown') ? null : item.extra
        }), 'ib_vrid');
        renderCard('pm-analysis-obvrids', 'pm-pie-obvrids', 'obvrids', groupAndSum('ob_vrid', filteredData, true, 'ob_lane'), item => ({
            ...item,
            extra: (item.name.includes('Unknown') || !item.extra) ? null : (item.extra.includes('->') ? item.extra.split('->')[1].trim() : item.extra)
        }), 'ob_vrid');
        renderCard('pm-analysis-shifts', 'pm-pie-shifts', 'shifts', groupAndSum('shift', filteredData), null, 'shift');

        const xdockRows = filteredData.filter(r => r.parent_container_label && r.parent_container_label === r.ib_parent_container_label);
        const nonXdockRows = filteredData.filter(r => r.parent_container_label !== r.ib_parent_container_label);

        renderCard('pm-analysis-parentcontainers', 'pm-pie-parentcontainers', 'parentcontainers', groupAndSum('parent_container_label', nonXdockRows, true), null, 'parent_container_label');
        renderCard('pm-analysis-ibparentcontainers', 'pm-pie-ibparentcontainers', 'ibparentcontainers', groupAndSum('ib_parent_container_label', nonXdockRows, true), null, 'ib_parent_container_label');
        renderCard('pm-analysis-xdock', 'pm-pie-xdock', 'xdock', groupAndSum('parent_container_label', xdockRows, true), null, 'parent_container_label');
    }

    // ─── Log ───
    function log(message, type = 'info') {
        console.log(`[PM-${type.toUpperCase()}] ${message}`);
        if (!logArea) return;
        const entry = document.createElement('div');
        entry.className = `log-entry log-${type}`;
        const ts = new Date().toLocaleTimeString();
        entry.innerHTML = `<span class="log-timestamp">[${ts}]</span> ${message}`;
        logArea.appendChild(entry);
        logArea.scrollTop = logArea.scrollHeight;
    }

    // ─── Explorer update ───
    function updateExplorer(data, append = false) {
        if (data && data.pages) {
            let rows = [];
            Object.values(data.pages).forEach(pageArray => {
                pageArray.forEach(r => r.shift = calculateShift(r));
                rows = rows.concat(pageArray);
            });
            if (rows.length > 0) {
                capturedData = append ? capturedData.concat(rows) : rows;
                countBadge.textContent = `(${capturedData.length})`;
                if (explorerTab.classList.contains('active')) renderTable(capturedData);
            }
        }
    }

    // ─── Utility: Promise-based XHR ───
    function fetchPage(page, node, start, end) {
        return new Promise((resolve, reject) => {
            const url = new URL('https://perfectmile-na.amazon.com/blue_sky/dive_deep/bulk.json');
            url.searchParams.set('metric_name', 'total_misses_global_dea_ats_sc');
            url.searchParams.set('datetime_start', `${start}T00:00:00.000Z`);
            url.searchParams.set('datetime_end', `${end}T23:59:59.000Z`);
            url.searchParams.set('filters', JSON.stringify({
                "IsInstock": ["IN_STOCK"], "Country": ["BR"],
                "IsPreorder": ["NOT_PRE_ORDER"], "IsDDU": ["NON-DDU"],
                "WWDEAFulfillmentCountry": ["BR", "Other"], "Node": [node]
            }));
            url.searchParams.set('exclude_filters', JSON.stringify({ "Country": ["XX"] }));
            url.searchParams.set('mapping', 'perfectmile-node-mapping-prod');
            url.searchParams.set('page_range', `${page}..${page}`);
            url.searchParams.set('page_size', '10000');
            url.searchParams.set('columns', COLS.join(','));
            url.searchParams.set('is_display_restricted_columns', 'false');

            GM_xmlhttpRequest({
                method: 'GET',
                url: url.toString(),
                onload: (res) => {
                    if (res.status === 200) {
                        try {
                            const data = JSON.parse(res.responseText);
                            resolve(data);
                        } catch (e) { reject('Erro ao parsear página ' + page); }
                    } else { reject('HTTP ' + res.status + ' na página ' + page); }
                },
                onerror: () => reject('Erro de rede na página ' + page)
            });
        });
    }

    // ─── Bulk Request (Enhanced to 100k) ───
    async function runBulkRequest() {
        const start = inputStart.value;
        const end = inputEnd.value;

        // Validação de 7 dias
        const dScore = (new Date(end) - new Date(start)) / (1000 * 60 * 60 * 24);
        if (dScore > 7) {
            log(`⚠️ Intervalo muito longo (${Math.round(dScore)} dias). O máximo permitido é 7 dias.`, 'error');
            return;
        }
        if (dScore < 0) {
            log(`⚠️ A data de início deve ser anterior à data de fim.`, 'error');
            return;
        }

        btnRun.disabled = true;
        btnRun.innerHTML = '<span class="pm-spinner"></span> Capturando...';
        capturedData = [];
        if (logArea) logArea.innerHTML = '';
        countBadge.textContent = '(0)';
        tableTbody.innerHTML = `<tr><td colspan="${COLS.length}" class="pm-empty-state">Buscando dados...</td></tr>`;

        const node = getParam('node') || 'CGH7';
        const maxPages = 10; // 10 x 10k = 100k

        log(`🚀 Iniciando captura de alta capacidade (Limite: 100.000) Node: ${node}`, 'info');

        // Sincroniza o volume no começo para agilizar
        await syncVolume();

        for (let p = 1; p <= maxPages; p++) {
            const currentProgress = Math.round((p / maxPages) * 100);
            setProgress(currentProgress);

            let success = false;
            let retries = 3;

            while (retries > 0 && !success) {
                log(`Buscando página ${p}/${maxPages} (Tentativa ${4 - retries}/3)...`, 'info');
                try {
                    const data = await fetchPage(p, node, start, end);

                    let pageRows = [];
                    if (data && data.pages) {
                        Object.values(data.pages).forEach(arr => { pageRows = pageRows.concat(arr); });
                    }

                    if (pageRows.length === 0) {
                        log(`Nenhum dado adicional na página ${p}. Processo finalizado.`, 'success');
                        p = maxPages + 1; // Break outer loop
                        success = true;
                        break;
                    }

                    pageRows.forEach(r => r.shift = calculateShift(r));
                    capturedData = capturedData.concat(pageRows);
                    countBadge.textContent = `(${capturedData.length})`;
                    log(`✓ Página ${p} carregada: +${pageRows.length} registros.`, 'success');

                    if (pageRows.length < 10000) {
                        log(`Fim dos resultados na página ${p}.`, 'success');
                        p = maxPages + 1; // Break outer loop
                    }
                    success = true;
                } catch (err) {
                    retries--;
                    log(`⚠️ Falha na página ${p}: ${err}. ${retries > 0 ? 'Tentando novamente em 1.5s...' : 'Abortando.'}`, 'warn');
                    if (retries > 0) await new Promise(r => setTimeout(r, 1500));
                    else {
                        log(`❌ Falha definitiva na página ${p} após 3 tentativas.`, 'error');
                        p = maxPages + 1; // Stop everything
                    }
                }
            }
        }

        btnRun.disabled = false;
        btnRun.innerHTML = '🚀 Capturar Dados';
        setProgress(100);
        log(`✓ Total capturado: ${capturedData.length.toLocaleString()} registros.`, 'success');

        renderTable(capturedData);
        renderAnalyses();
    }

    // ─── Automated Volume Capture ───
    function formatDateForPM(dateStr) {
        const d = new Date(dateStr + 'T12:00:00');
        const day = String(d.getDate()).padStart(2, '0');
        const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
        const month = months[d.getMonth()];
        return `${day}-${month}`;
    }

    function getVolumesFromCurrentPage(daysToFindPM) {
        const table = document.querySelector('table.pm-table-sticky-column');
        if (!table) return {};

        const headers = Array.from(table.querySelectorAll('thead th'));
        const bodyRows = Array.from(table.querySelectorAll('tbody tr'));
        const volumeRow = bodyRows.find(tr => tr.querySelector('.metric-name')?.innerText.includes('DEA Volume (units) - Total AFN'));

        if (!volumeRow) return {};

        const results = {};
        daysToFindPM.forEach(day => {
            const idx = headers.findIndex(th => th.innerText.toUpperCase().includes(day.toUpperCase()));
            if (idx !== -1) {
                const cell = volumeRow.cells[idx + 1];
                const text = cell ? cell.innerText.replace(/[^0-9]/g, '') : '';
                if (text) {
                    results[day] = parseInt(text, 10);
                }
            }
        });
        return results;
    }

    async function navigateToDay(dateStr) {
        const targetDate = new Date(dateStr + 'T12:00:00');
        const pickerText = document.querySelector('.daterange-picker .date')?.innerText || "";
        const weekMatch = pickerText.match(/(\d{4})-W(\d+)/);

        if (weekMatch) {
            const currentWeek = parseInt(weekMatch[2]);
            const d = new Date(Date.UTC(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate()));
            const dayNum = d.getUTCDay() || 7;
            d.setUTCDate(d.getUTCDate() + 4 - dayNum);
            const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
            const targetWeek = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);

            if (targetWeek === currentWeek) return true;

            const goLeft = targetWeek < currentWeek;
            const btn = document.querySelector(`.time-selector .glyphicon-triangle-${goLeft ? 'left' : 'right'}`)?.parentElement;

            if (btn) {
                btn.click();
                await new Promise(r => setTimeout(r, 3000)); // Wait for PM to load
                return true;
            }
        }
        return false;
    }

    async function syncVolume() {
        log('⏳ Sincronizando volume total (percorrendo semanas se necessário)...', 'info');

        const startRaw = inputStart.value;
        const endRaw = inputEnd.value;
        const startDate = new Date(startRaw + 'T12:00:00');
        const endDate = new Date(endRaw + 'T12:00:00');

        const daysToFindMap = {}; // PM Format -> ISO Format
        for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
            const iso = d.toISOString().split('T')[0];
            const pmFormat = formatDateForPM(iso);
            daysToFindMap[pmFormat] = iso;
        }

        const allDaysPM = Object.keys(daysToFindMap);
        const collectedVolumes = {};

        let attempts = 6;
        while (attempts > 0 && Object.keys(collectedVolumes).length < allDaysPM.length) {
            const missingDaysPM = allDaysPM.filter(day => !collectedVolumes[day]);

            // Coleta o que estiver na tela atual
            const batch = getVolumesFromCurrentPage(missingDaysPM);
            Object.assign(collectedVolumes, batch);

            if (Object.keys(collectedVolumes).length >= allDaysPM.length) break;

            // Navega para buscar o próximo dia faltando
            const nextDayPM = allDaysPM.find(day => !collectedVolumes[day]);
            const nextDayISO = daysToFindMap[nextDayPM];

            log(`Navegando na tabela para buscar volume de ${nextDayPM}...`, 'info');
            const moved = await navigateToDay(nextDayISO);
            if (!moved) break;

            attempts--;
        }

        const totalValue = Object.values(collectedVolumes).reduce((a, b) => a + b, 0);
        const missingDays = allDaysPM.filter(day => !collectedVolumes[day]);

        if (Object.keys(collectedVolumes).length > 0) {
            totalVolumeInput.value = totalValue.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
            if (panel.querySelector('#pm-tab-analyses').classList.contains('active')) renderAnalyses();

            if (missingDays.length === 0) {
                log(`✓ Volume total sincronizado: ${totalValue.toLocaleString('pt-BR')}`, 'success');
            } else {
                log(`⚠️ Sincronização parcial (${totalValue.toLocaleString('pt-BR')}). Não encontrados: ${missingDays.join(', ')}`, 'warn');
            }
        } else {
            log(`❌ Não foi possível sincronizar o volume. Certifique-se de estar no "Network Summary".`, 'error');
        }
    }

    // ─── Table ───
    const COLS = [
        'ordering_order_id', 'tracking_id', 'ib_vrid', 'fulfillment_shipment_id', 'amazon_barcode',
        'transship_trailer_id', 'ib_truck_route', 'node_id', 'ob_vrid', 'ob_lane',
        'comp_shipment_id', 'is_instock', 'is_fba_shipment', 'is_swa', 'ship_option_group',
        'ship_option_group_2', 'route', 'owner', 'bucket', 'sub_bucket',
        'package_id', 'asin', 'customer_shipment_item_id', 'quantity', 'external_promised_delivery_date_item',
        'external_promised_delivery_date_package', 'scac', 'fulfillment_origin_node', 'shipping_address_country_code', 'last_known_destination_node',
        'delivery_station_code', 'customer_ship_option', 'shipment_ship_option', 'outer_ship_method', 'first_inner_ship_method',
        'stacking_filter', 'expected_pickup_date', 'actual_unloaded_time_utc', 'auto_sorter_divert_time_utc', 'stacking_time_utc',
        'staging_time_local', 'parent_container_label', 'slam_station', 'ssp_slam_datetime_utc', 'ob_adhoc',
        'ob_adhoc_request_time_utc', 'planned_orig_checkin_time_utc', 'positionning_time_utc', 'ob_scheduled_departure_time_utc', 'ob_actual_departure_time_utc',
        'ob_planned_dest_checkin_time_utc', 'ob_arrival_time_utc', 'ob_sweep_event_time_utc', 'ob_dropzone_event_time_utc', 'first_amzl_induct_utc',
        'cycle_name', 'pfsd_slot', 'was_unshipped', 'provider_type', 'clock_stop_event_datetime_utc',
        'actual_delivery_date_utc', 'ib_parent_container_label'
    ];

    function renderTable(rows) {
        if (!explorerTab.classList.contains('active')) return;

        let filtered = rows;

        // 1. Apply Analysis Filter (Deep Filter)
        if (analysisFilter) {
            filtered = filtered.filter(row => {
                const rowVal = row[analysisFilter.col] || 'Unknown';
                const isUnknown = (analysisFilter.value === 'Unknown' || analysisFilter.value === '-');

                let matchValue = false;
                if (isUnknown) {
                    matchValue = !row[analysisFilter.col] || row[analysisFilter.col] === 'Unknown' || row[analysisFilter.col] === '-' || row[analysisFilter.col] === 'null';
                } else {
                    matchValue = String(rowVal) === String(analysisFilter.value);
                }

                if (analysisFilter.shift) {
                    return matchValue && row.shift === analysisFilter.shift;
                }
                return matchValue;
            });
        }

        // 2. Apply Search Filter
        const term = searchInput.value.toLowerCase();
        if (term) {
            filtered = filtered.filter(row => Object.values(row).some(v => String(v).toLowerCase().includes(term)));
        }

        // 3. Sorting
        if (currentSort.col) {
            filtered = [...filtered].sort((a, b) => {
                let vA = a[currentSort.col] || '', vB = b[currentSort.col] || '';
                const nA = parseFloat(vA), nB = parseFloat(vB);
                if (!isNaN(nA) && !isNaN(nB)) { vA = nA; vB = nB; }
                if (vA < vB) return currentSort.asc ? -1 : 1;
                if (vA > vB) return currentSort.asc ? 1 : -1;
                return 0;
            });
        }

        tableThead.innerHTML = `<tr>${COLS.map(c => {
            const label = c.replace(/_id$/, '').replace(/_/g, ' ').toUpperCase();
            const arrow = currentSort.col === c ? (currentSort.asc ? ' ▴' : ' ▾') : '';
            return `<th data-col="${c}" style="cursor:pointer">${label}${arrow}</th>`;
        }).join('')}</tr>`;

        tableThead.querySelectorAll('th').forEach(th => {
            th.onclick = () => {
                const col = th.dataset.col;
                currentSort = { col, asc: currentSort.col === col ? !currentSort.asc : true };
                renderTable(capturedData);
            };
        });

        if (rows.length === 0) {
            tableTbody.innerHTML = `<tr><td colspan="${COLS.length}" class="pm-empty-state">Nenhum resultado.</td></tr>`;
            return;
        }

        tableTbody.innerHTML = filtered.map(row => `<tr>${COLS.map(c => {
            let val = row[c] ?? '-';
            if (c === 'bucket') {
                const isMiss = String(val).toLowerCase().includes('miss') || String(val).toLowerCase().includes('late');
                return `<td><span class="pm-badge ${isMiss ? 'badge-miss' : 'badge-ok'}">${val}</span></td>`;
            }
            if (c === 'quantity' && String(val).includes('.')) val = String(val).split('.')[0];
            if (c === 'ob_lane' && String(val).includes('->')) val = String(val).split('->')[1].trim();
            return `<td title="${val}">${val}</td>`;
        }).join('')}</tr>`).join('');
    }

    // ─── Search ───
    searchInput.addEventListener('input', e => {
        const term = e.target.value.toLowerCase();

        // Se estiver em outra aba e começar a digitar, muda para o Explorador
        const explorerTab = panel.querySelector('[data-tab="explorer"]');
        if (term && !explorerTab.classList.contains('active')) {
            explorerTab.click();
        }

        renderTable(term ? capturedData.filter(row => Object.values(row).some(v => String(v).toLowerCase().includes(term))) : capturedData);
    });

    totalVolumeInput.addEventListener('input', () => {
        if (panel.querySelector('#pm-tab-analyses').classList.contains('active')) renderAnalyses();
    });

    // ─── Thresholds live update ───
    panel.querySelectorAll('.pm-card-threshold').forEach(input => {
        input.addEventListener('input', () => {
            if (panel.querySelector('#pm-tab-analyses').classList.contains('active')) renderAnalyses();
        });
    });

    // ─── Date Range Sync & Constraints ───
    function updateDateConstraints() {
        const s = new Date(inputStart.value);
        const e = new Date(inputEnd.value);
        const yesterdayLimit = new Date(); yesterdayLimit.setDate(yesterdayLimit.getDate() - 1);
        const yStr = yesterdayLimit.toISOString().split('T')[0];

        // Se o range for > 7 dias, corrigimos o valor primeiro
        if ((e - s) / (1000 * 60 * 60 * 24) > 7) {
            // Ajustar o que não foi alterado por último (lógica simples)
            const newEnd = new Date(s);
            newEnd.setDate(s.getDate() + 7);
            const finalEnd = newEnd > yesterdayLimit ? yesterdayLimit : newEnd;
            inputEnd.value = finalEnd.toISOString().split('T')[0];
        }

        // Aplicar restrições visuais no calendário
        // O Início não pode ser depois do Fim
        inputStart.max = inputEnd.value;

        // O Fim não pode ser antes do Início, nem depois de ontem, nem mais que 7 dias do início
        inputEnd.min = inputStart.value;
        inputEnd.max = yStr;

        const maxFromStart = new Date(s);
        maxFromStart.setDate(s.getDate() + 7);
        const maxStr = maxFromStart > yesterdayLimit ? yStr : maxFromStart.toISOString().split('T')[0];
        inputEnd.max = maxStr;

        const minFromEnd = new Date(e);
        minFromEnd.setDate(e.getDate() - 7);
        inputStart.min = minFromEnd.toISOString().split('T')[0];
    }

    inputStart.addEventListener('change', updateDateConstraints);
    inputEnd.addEventListener('change', updateDateConstraints);
    updateDateConstraints(); // Init

    // ─── Interceptors ───
    function formatJSON(obj) {
        return JSON.stringify(obj, null, 2).replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, match => {
            let cls = 'json-number';
            if (/^"/.test(match)) cls = /:$/.test(match) ? 'json-key' : 'json-string';
            else if (/true|false/.test(match)) cls = 'json-boolean';
            return `<span class="${cls}">${match}</span>`;
        });
    }

    function getParam(name) { return new URLSearchParams(window.location.search).get(name); }

    function setupInterceptors() {
        const oldXOpen = window.XMLHttpRequest.prototype.open;
        window.XMLHttpRequest.prototype.open = function (method, url) {
            this._url = url; this._method = method;
            return oldXOpen.apply(this, arguments);
        };
        const oldXSend = window.XMLHttpRequest.prototype.send;
        window.XMLHttpRequest.prototype.send = function () {
            const xhr = this;
            const handler = function () {
                if (xhr.readyState === 4 && (xhr._url.includes('bulk.json') || xhr._url.includes('blue_sky'))) {
                    log(`[XHR] ${xhr._method} ${xhr._url.split('?')[0]}`, 'warn');
                    log(`Status: ${xhr.status}`, xhr.status < 400 ? 'success' : 'error');
                    try {
                        const data = JSON.parse(xhr.responseText);
                        updateExplorer(data);
                        const pre = document.createElement('pre');
                        pre.style.margin = '0';
                        pre.innerHTML = formatJSON(data);
                        const entry = document.createElement('div');
                        entry.className = 'log-entry';
                        entry.appendChild(pre);
                        logArea.appendChild(entry);
                    } catch (e) {
                        log('Body (non-JSON): ' + xhr.responseText.substring(0, 120) + '…', 'info');
                    }
                }
            };
            this.addEventListener ? this.addEventListener('readystatechange', handler, false) : (this.onreadystatechange = handler);
            return oldXSend.apply(this, arguments);
        };

        const oldFetch = window.fetch;
        window.fetch = async function (...args) {
            const url = typeof args[0] === 'string' ? args[0] : args[0].url;
            const method = (args[1] && args[1].method) || 'GET';
            if (url.includes('bulk.json') || url.includes('blue_sky')) {
                log(`[FETCH] ${method} ${url.split('?')[0]}`, 'warn');
                try {
                    const response = await oldFetch(...args);
                    const clone = response.clone();
                    log(`Status: ${response.status}`, response.status < 400 ? 'success' : 'error');
                    const data = await clone.json();
                    updateExplorer(data);
                    const pre = document.createElement('pre');
                    pre.style.margin = '0';
                    pre.innerHTML = formatJSON(data);
                    const entry = document.createElement('div');
                    entry.className = 'log-entry';
                    entry.appendChild(pre);
                    logArea.appendChild(entry);
                    return response;
                } catch (e) {
                    log(`Fetch error: ${e.message}`, 'error');
                }
            }
            return oldFetch(...args);
        };
        log('Interceptadores ativos.', 'success');
    }

    // ─── Events ───
    btnRun.addEventListener('click', runBulkRequest);
    btnSyncVolume.addEventListener('click', syncVolume);
    btnClearFilter.addEventListener('click', () => {
        analysisFilter = null;
        filterStatus.style.display = 'none';
        renderTable(capturedData);
    });
    btnClose.addEventListener('click', () => panel.style.display = 'none');
    toggle.addEventListener('click', () => panel.style.display = panel.style.display === 'none' ? 'flex' : 'none');

    log('Painel v2 inicializado.', 'success');
    setupInterceptors();
    log('Aguardando comando ou tráfego…', 'info');

    // Delay de 10s para habilitar a captura
    setTimeout(() => {
        btnRun.disabled = false;
        btnRun.innerHTML = '🚀 Capturar Dados';
        log('Módulos carregados. Captura disponível.', 'success');
    }, 10000);

})();