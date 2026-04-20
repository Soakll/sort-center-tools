// ==UserScript==
// @name         TPH Chart Standalone
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  Standalone TPH Chart - Real-Time Throughput & Dynamic Target Dashboard
// @author       Antigravity (Pair Programming with USER)
// @match        https://trans-logistics.amazon.com/ssp/dock/hrz/ob*
// @match        https://trans-logistics.amazon.com/ssp/dock/hrz/ib*
// @match        https://trans-logistics-fe.amazon.com/ssp/dock/hrz/ob*
// @match        https://trans-logistics-fe.amazon.com/ssp/dock/hrz/ib*
// @match        https://trans-logistics-eu.amazon.com/ssp/dock/hrz/ob*
// @match        https://trans-logistics-eu.amazon.com/ssp/dock/hrz/ib*
// @run-at       document-start
// @require      https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      trans-logistics.amazon.com
// @connect      trans-logistics-fe.amazon.com
// @connect      trans-logistics-eu.amazon.com
// @connect      *.amazon.com
// ==/UserScript==

(function() {
    'use strict';

    // --- Minimal Suite Environment ---
    const _SUITE = {
        _lang: 'pt',
        antiCsrfToken: '',
        BASE: location.hostname.includes('-fe.') ? 'https://trans-logistics-fe.amazon.com/'
            : location.hostname.includes('-eu.') ? 'https://trans-logistics-eu.amazon.com/'
            : 'https://trans-logistics.amazon.com/',
        LANG: {
            pt: {
                close: 'Fechar',
                waiting: 'Aguardando...',
                fillDates: 'Preencha Data e Hora de Início e Fim.',
                endAfterStart: 'Erro: A data/hora final deve ser MAIOR que a inicial.',
                tphTitle: 'Real-Time Throughput & Dynamic Target Dashboard',
                tphShiftStart: 'Início (Turno)',
                tphShiftEnd: 'Fim (Turno)',
                tphTotalVol: 'Volume Total',
                tphLunchBreak: 'Almoço/Janta',
                tphBreak: 'Pausa',
                tphRaiseBar: 'Raise the bar',
                tphFetchData: 'Buscar Dados',
                tphTotalPeriod: 'Total do Período',
                tphAvgHour: 'Média / Hora',
                tphAvg5min: 'Média / 5 min',
                tphCurrentNeed: 'Nec. Atual / 5 min',
                tphNeedHour: 'Nec. Atual / Hora',
                tphAchievement: 'Atingimento (vs Nec.)',
                tphTrend: '📈 Tendência',
                tphFetching: 'Buscando',
                tphBlocks: 'blocos',
                tphNeedLine: 'Necessidade',
                tphRealLine: 'Real',
            }
        }
    };

    _SUITE.L = function(key) {
        return _SUITE.LANG.pt[key] || key;
    };

    _SUITE.utils = {
        esc: function(s) {
            return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        },
        detectNode: function() {
            var fns = [
                function() { var el = document.querySelector('#nodeId'); return el ? el.value || el.textContent.trim() : null; },
                function() { var el = document.querySelector('select[name="nodeId"] option:checked'); return el ? el.value.trim() : null; },
                function() { var el = document.querySelector('.node-selector, .nodeSelector, [class*="nodeId"]'); return el ? el.textContent.trim() : null; },
                function() { var m = document.body ? document.body.innerHTML.match(/\bNode[:\s]+([A-Z]{2,4}\d[A-Z0-9]{0,4})\b/) : null; return m ? m[1] : null; },
                function() { var m = location.href.match(/[?&]node=([A-Z]{2,4}\d[A-Z0-9]{0,4})/i); return m ? m[1].toUpperCase() : null; },
                function() { var m = document.cookie.match(/currentNode=([A-Z]{2,4}\d[A-Z0-9]{0,4})/i); return m ? m[1].toUpperCase() : null; },
            ];
            for (var i = 0; i < fns.length; i++) {
                try { var v = fns[i](); if (v && /^[A-Z]{2,4}\d[A-Z0-9]{0,4}$/i.test(v)) return v.toUpperCase(); } catch (_) {}
            }
            return GM_getValue('tl_node', 'CGH7');
        },
        fetchAntiCsrfToken: function(callback) {
            if (_SUITE.antiCsrfToken) { callback(_SUITE.antiCsrfToken); return; }
            GM_xmlhttpRequest({
                method: 'GET', url: _SUITE.BASE + 'sortcenter/vista',
                onload: function(response) {
                    try {
                        var div = document.createElement('div');
                        div.innerHTML = response.responseText;
                        var inputs = div.querySelectorAll('input');
                        for (var i = 0; i < inputs.length; i++) {
                            if (/csrf|token|anti/i.test(inputs[i].name || '') && inputs[i].value) {
                                _SUITE.antiCsrfToken = inputs[i].value; break;
                            }
                        }
                        if (!_SUITE.antiCsrfToken) {
                            var m = response.responseText.match(/"anti-csrftoken-a2z"\s*[,:]?\s*"([^"]{10,})"/);
                            if (!m) m = response.responseText.match(/anti.csrftoken.a2z[^"]*"([^"]{10,})"/i);
                            if (m) _SUITE.antiCsrfToken = m[1];
                        }
                    } catch (e) {}
                    callback(_SUITE.antiCsrfToken || '');
                },
                onerror: function() { callback(''); }
            });
        }
    };

    const href = location.href;
    _SUITE.isOutbound = href.includes('/ssp/dock/hrz/ob');
    _SUITE.isIB = href.includes('/ssp/dock/hrz/ib');
    _SUITE.isDock = _SUITE.isOutbound || _SUITE.isIB;

    function _onReady(fn) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
        else fn();
    }

    // --- TPH Module ---
    _onReady(function() {
        (function loadModuleTPH() {
            if (!_SUITE.isDock) return;
            'use strict';
            if (location.pathname.includes('/yms/')) return;

            const CONFIG = {
                baseUrls: _SUITE.BASE,
                time: {
                    blockMs: 5 * 60 * 1000,
                    apiDelayMs: 50,
                },
                ui: {
                    pixelsPerPoint: 65,
                    minWidth: 400,
                    minHeight: 300,
                    metaColor: '#ff2a5f',
                    realColor: '#a89dff',
                    needColor: '#39ff14',
                    upColor: '#34d399',
                    downColor: '#f87171'
                }
            };

            const BASE = _SUITE.BASE;
            let CURRENT_NODE = GM_getValue('tl_v5_chart_node', _SUITE.utils.detectNode());
            let GOAL_5MIN = GM_getValue('tl_v5_chart_goal', 800);
            let REFRESH_MS = GM_getValue('tl_v5_refresh_ms', 5 * 60 * 1000);
            let VOL_TOTAL = GM_getValue('tl_v5_vol_total', 60000);
            let PAUSA_START = GM_getValue('tl_v5_pausa_start', '11:00');
            let PAUSA_END = GM_getValue('tl_v5_pausa_end', '12:15');
            let PAUSA2_START = GM_getValue('tl_v5_pausa2_start', '15:00');
            let PAUSA2_END = GM_getValue('tl_v5_pausa2_end', '15:15');
            let AUTO_REFRESH_ON = GM_getValue('tl_v5_auto_on', true);

            let chartInstance = null;
            let timeBlocks = [];
            let isFetching = false;
            let isManualSearch = false;
            let countdownInterval = null;
            let nextRefreshTime = 0;

            function pad(n) { return n < 10 ? '0' + n : n; }
            function fmtDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
            function fmtTime(d) { return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }

            function getMsFromInputs(dateEl, timeEl) {
                if (!dateEl.value || !timeEl.value) return null;
                return new Date(`${dateEl.value}T${timeEl.value}:00`).getTime();
            }

            function getPauseDuration(startStr, endStr) {
                const [h1, m1] = startStr.split(':').map(Number);
                const [h2, m2] = endStr.split(':').map(Number);
                let diff = (h2 * 60 + m2) - (h1 * 60 + m1);
                if (diff < 0) diff += 24 * 60;
                return diff;
            }

            function isPauseBlock(blockStartMs, startStr, endStr) {
                const d = new Date(blockStartMs);
                const blockTime = pad(d.getHours()) + ':' + pad(d.getMinutes());
                if (startStr <= endStr) {
                    return blockTime >= startStr && blockTime < endStr;
                } else {
                    return blockTime >= startStr || blockTime < endStr;
                }
            }

            function isAnyPauseBlock(blockStartMs) {
                const p1s = inputs.pausaStart.value || '11:00';
                const p1e = inputs.pausaEnd.value || '12:15';
                const p2s = inputs.pausa2Start.value || '15:00';
                const p2e = inputs.pausa2End.value || '15:15';
                return isPauseBlock(blockStartMs, p1s, p1e) || isPauseBlock(blockStartMs, p2s, p2e);
            }

            function getTotalPauseMinutes() {
                const p1s = inputs.pausaStart.value || '11:00';
                const p1e = inputs.pausaEnd.value || '12:15';
                const p2s = inputs.pausa2Start.value || '15:00';
                const p2e = inputs.pausa2End.value || '15:15';
                return getPauseDuration(p1s, p1e) + getPauseDuration(p2s, p2e);
            }

            GM_addStyle(`
                @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&family=Space+Mono&family=Syne:wght@600&display=swap');
                #tl-v5-fab { position:fixed; bottom:24px; left:24px; z-index:99999; width:50px; height:50px; border-radius:50%; background:linear-gradient(135deg, #1a0533 0%, #0a1628 100%); color:#a89dff; font-size:22px; border:2px solid rgba(255,255,255,0.1); cursor:pointer; box-shadow:0 8px 24px rgba(0,0,0,0.4); display:flex; align-items:center; justify-content:center; transition:transform 0.2s; }
                #tl-v5-fab:hover { transform:scale(1.1); box-shadow:0 12px 30px rgba(168,157,255,0.3); }
                #tl-v5-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.6); z-index:99998; display:none; backdrop-filter:blur(4px); opacity:0; transition:opacity 0.2s ease; }
                #tl-v5-overlay.open { display:block; opacity:1; }
                #tl-v5-popup { position:fixed; inset:0; z-index:99999; background:rgba(10, 22, 40, 0.85); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); display:none; flex-direction:column; font-family:'DM Sans', sans-serif; border:none; transition:none; color:#fff; overflow:hidden; }
                #tl-v5-popup.open { display:flex; }
                .tl-v5-header { padding:12px 20px; cursor:grab; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.08); background:rgba(255,255,255,0.02); user-select:none; }
                .tl-v5-header:active { cursor:grabbing; }
                .tl-v5-header-title { font-family:'Syne', sans-serif; font-weight:600; font-size:15px; color:#fff; display:flex; align-items:center; gap:8px; }
                .tl-v5-header-actions { display:flex; gap:12px; align-items:center; }
                .tl-v5-btn-icon { background:none; border:none; color:rgba(255,255,255,0.4); font-size:16px; cursor:pointer; transition:color 0.2s; }
                .tl-v5-btn-icon:hover { color:#fff; }
                .tl-v5-rh { position:absolute; z-index:100000; }
                .tl-v5-rh-e { right:-4px; top:0; bottom:0; width:8px; cursor:e-resize; }
                .tl-v5-rh-s { bottom:-4px; left:0; right:0; height:8px; cursor:s-resize; }
                .tl-v5-rh-se { bottom:-4px; right:-4px; width:16px; height:16px; cursor:se-resize; }
                #tl-v5-popup.fullscreen .tl-v5-rh { display:none; }
                .tl-v5-body { padding:20px; flex:1; display:flex; flex-direction:column; overflow:hidden; position:relative; }
                .tl-v5-controls-bar { display:flex; flex-wrap:wrap; gap:12px; align-items:flex-end; margin-bottom:1.5rem; background:rgba(255,255,255,0.03); padding:12px 16px; border-radius:8px; border:1px solid rgba(255,255,255,0.05); }
                .tl-v5-inp-group { display:flex; flex-direction:column; gap:4px; }
                .tl-v5-inp-label { font-size:10px; color:rgba(255,255,255,0.5); text-transform:uppercase; letter-spacing:0.5px; }
                .tl-v5-inp-label.label-green { color:${CONFIG.ui.needColor}; }
                .tl-v5-inp-label.label-red { color:${CONFIG.ui.metaColor}; }
                .tl-v5-inp { background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.1); color:#fff; border-radius:6px; padding:6px 10px; font-size:12px; font-family:'Space Mono', monospace; outline:none; transition:border 0.2s; }
                .tl-v5-inp:focus { border-color:${CONFIG.ui.realColor}; }
                .tl-v5-inp[type="date"]::-webkit-calendar-picker-indicator { filter: invert(1); cursor:pointer; }
                .tl-v5-btn-primary { background:${CONFIG.ui.realColor}; color:#000; border:none; border-radius:6px; padding:6px 16px; font-weight:600; font-size:12px; font-family:'DM Sans', sans-serif; cursor:pointer; height:29px; transition:opacity 0.2s; }
                .tl-v5-btn-primary:hover { opacity:0.8; }
                .tl-v5-toggle { position:relative; width:36px; height:20px; border:none; background:none; padding:0; cursor:pointer; flex-shrink:0; }
                .tl-v5-toggle .track { position:absolute; inset:0; border-radius:10px; background:rgba(255,255,255,0.1); transition:background .25s; }
                .tl-v5-toggle.on .track { background:${CONFIG.ui.realColor}; }
                .tl-v5-toggle .thumb { position:absolute; top:3px; left:3px; width:14px; height:14px; border-radius:50%; background:#fff; box-shadow:0 1px 3px rgba(0,0,0,.25); transition:left .25s; }
                .tl-v5-toggle.on .thumb { left:19px; }
                .tl-v5-timer-wrap { display:flex; align-items:center; gap:8px; background:rgba(0,0,0,0.2); padding:4px 10px; border-radius:6px; border:1px solid rgba(255,255,255,0.05); height: 29px; }
                .tl-v5-timer-text { font-family:'Space Mono', monospace; font-size:12px; color:${CONFIG.ui.realColor}; font-weight:bold; min-width:40px; }
                .tl-v5-refresh-select { background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.1); color:#fff; border-radius:4px; font-size:10px; cursor:pointer; outline:none; border-left: 1px solid rgba(255,255,255,0.1); padding-left: 6px; font-family:'DM Sans', sans-serif; }
                .tl-v5-refresh-select option { background:#161b22; color:#fff; }
                .tl-v5-metrics { display:flex; gap:1rem; margin-bottom:1rem; flex-shrink:0; justify-content: space-between; }
                .tl-v5-metric { background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:12px 14px; flex:1; min-width: 0; }
                .tl-v5-metric-label { font-size:0.65rem; color:rgba(255,255,255,0.4); margin-bottom:4px; text-transform:uppercase; display:block; font-weight:600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .tl-v5-metric-val { font-size:1.6rem; font-weight:700; color:#fff; display:block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .tl-v5-canvas-container { flex:1; width:100%; overflow-x:auto; overflow-y:hidden; border-radius:8px; opacity:1; transition:opacity 0.2s, transform 0.2s; }
                .tl-v5-canvas-container.updating { opacity:0; transform:translateY(4px); }
                .tl-v5-canvas-container::-webkit-scrollbar { height: 8px; }
                .tl-v5-canvas-container::-webkit-scrollbar-track { background: rgba(255,255,255,0.02); border-radius: 4px; }
                .tl-v5-canvas-container::-webkit-scrollbar-thumb { background: rgba(168,157,255,0.3); border-radius: 4px; }
                .tl-v5-canvas-inner { position:relative; height:100%; min-width:100%; transition:width 0.2s; }
                #tl-v5-loader { position:absolute; inset:0; background:rgba(10,22,40,0.8); z-index:10; display:none; flex-direction:column; align-items:center; justify-content:center; backdrop-filter:blur(5px); color:#fff; }
                .tl-v5-loader-text { font-family:'DM Sans', sans-serif; font-size:14px; font-weight:bold; margin-bottom:15px; color:${CONFIG.ui.realColor}; text-align:center; }
                .tl-v5-loader-bar { width:200px; height:4px; background:rgba(255,255,255,0.1); border-radius:2px; overflow:hidden; }
                .tl-v5-loader-fill { height:100%; background:${CONFIG.ui.realColor}; width:0%; transition:width 0.1s linear; }
                .sep-line { width: 1px; height: 30px; background: rgba(255,255,255,0.1); margin: 0 4px; }
            `);

            const fab = document.createElement('button');
            fab.id = 'tl-v5-fab';
            fab.title = 'TPH Chart Standalone';
            fab.innerHTML = '📈';
            document.body.appendChild(fab);

            const overlay = document.createElement('div');
            overlay.id = 'tl-v5-overlay';
            document.body.appendChild(overlay);

            const coeff = CONFIG.time.blockMs;
            const endRoundedDate = new Date(Math.floor(Date.now() / CONFIG.time.blockMs) * CONFIG.time.blockMs);
            const startRoundedDate = new Date(endRoundedDate.getTime() - 3600000);

            const popup = document.createElement('div');
            popup.id = 'tl-v5-popup';
            popup.innerHTML = `
                <div class="tl-v5-header" id="tl-v5-header">
                    <div class="tl-v5-header-title">📈 ${CURRENT_NODE} ${_SUITE.L('tphTitle')}</div>
                    <div class="tl-v5-header-actions">
                        <button class="tl-v5-btn-icon" id="tl-v5-btn-close" title="${_SUITE.L('close')}">✕</button>
                    </div>
                </div>
                <div class="tl-v5-rh tl-v5-rh-e"></div><div class="tl-v5-rh tl-v5-rh-s"></div><div class="tl-v5-rh tl-v5-rh-se"></div>
                <div class="tl-v5-body">
                    <div id="tl-v5-loader">
                        <span class="tl-v5-loader-text" id="tl-v5-loader-msg">${_SUITE.L('waiting')}</span>
                        <div class="tl-v5-loader-bar" id="tl-v5-loader-wrap"><div class="tl-v5-loader-fill" id="tl-v5-loader-fill"></div></div>
                    </div>
                    <div class="tl-v5-controls-bar">
                        <div class="tl-v5-inp-group">
                            <label class="tl-v5-inp-label">Node</label>
                            <input type="text" id="tl-v5-node" class="tl-v5-inp" value="${CURRENT_NODE}" maxlength="8" style="width:60px; text-align:center;">
                        </div>
                        <div class="tl-v5-inp-group">
                            <label class="tl-v5-inp-label">${_SUITE.L('tphShiftStart')}</label>
                            <div style="display:flex; gap:4px;">
                                <input type="date" id="tl-v5-date-start" class="tl-v5-inp" value="${fmtDate(startRoundedDate)}" lang="pt-BR" style="width:120px;">
                                <input type="text" id="tl-v5-time-start" class="tl-v5-inp" value="${fmtTime(startRoundedDate)}" placeholder="HH:MM" maxlength="5" style="width:55px; text-align:center;">
                            </div>
                        </div>
                        <div class="tl-v5-inp-group">
                            <label class="tl-v5-inp-label">${_SUITE.L('tphShiftEnd')}</label>
                            <div style="display:flex; gap:4px;">
                                <input type="date" id="tl-v5-date-end" class="tl-v5-inp" value="${fmtDate(endRoundedDate)}" lang="pt-BR" style="width:120px;">
                                <input type="text" id="tl-v5-time-end" class="tl-v5-inp" value="${fmtTime(endRoundedDate)}" placeholder="HH:MM" maxlength="5" style="width:55px; text-align:center;">
                            </div>
                        </div>
                        <div class="sep-line"></div>
                        <div class="tl-v5-inp-group">
                            <label class="tl-v5-inp-label label-green">${_SUITE.L('tphTotalVol')}</label>
                            <input type="number" id="tl-v5-vol" class="tl-v5-inp" value="${VOL_TOTAL}" style="width:75px;">
                        </div>
                        <div class="tl-v5-inp-group">
                            <label class="tl-v5-inp-label label-green">${_SUITE.L('tphLunchBreak')}</label>
                            <div style="display:flex; gap:4px;">
                                <input type="text" id="tl-v5-pausa-start" class="tl-v5-inp" value="${PAUSA_START}" placeholder="HH:MM" maxlength="5" style="width:55px; text-align:center;">
                                <span style="color:rgba(255,255,255,0.4); align-self:center;">-</span>
                                <input type="text" id="tl-v5-pausa-end" class="tl-v5-inp" value="${PAUSA_END}" placeholder="HH:MM" maxlength="5" style="width:55px; text-align:center;">
                            </div>
                        </div>
                        <div class="tl-v5-inp-group">
                            <label class="tl-v5-inp-label label-green">${_SUITE.L('tphBreak')}</label>
                            <div style="display:flex; gap:4px;">
                                <input type="text" id="tl-v5-pausa2-start" class="tl-v5-inp" value="${PAUSA2_START}" placeholder="HH:MM" maxlength="5" style="width:55px; text-align:center;">
                                <span style="color:rgba(255,255,255,0.4); align-self:center;">-</span>
                                <input type="text" id="tl-v5-pausa2-end" class="tl-v5-inp" value="${PAUSA2_END}" placeholder="HH:MM" maxlength="5" style="width:55px; text-align:center;">
                            </div>
                        </div>
                        <div class="tl-v5-inp-group">
                            <label class="tl-v5-inp-label label-red">${_SUITE.L('tphRaiseBar')}</label>
                            <input type="number" id="tl-v5-goal" class="tl-v5-inp" value="${GOAL_5MIN}" style="width:65px;">
                        </div>
                        <div class="tl-v5-inp-group" style="padding-bottom:1px; margin-left: auto; display:flex; flex-direction:row; align-items:center; gap: 10px;">
                            <div class="tl-v5-timer-wrap">
                                <div style="display:flex; align-items:center; gap:4px; border-right: 1px solid rgba(255,255,255,0.1); padding-right: 6px;">
                                    <span style="font-size:9px; color:rgba(255,255,255,0.5); font-weight:bold;">AUTO</span>
                                    <button type="button" id="tl-v5-auto-toggle" class="tl-v5-toggle ${AUTO_REFRESH_ON ? 'on' : ''}"><span class="track"></span><span class="thumb"></span></button>
                                </div>
                                <span id="tl-v5-timer" class="tl-v5-timer-text">05:00</span>
                                <select id="tl-v5-refresh-select" class="tl-v5-refresh-select">
                                    <option value="300000">5m</option>
                                    <option value="600000">10m</option>
                                    <option value="900000">15m</option>
                                    <option value="1800000">30m</option>
                                    <option value="3600000">1h</option>
                                </select>
                            </div>
                            <button class="tl-v5-btn-primary" id="tl-v5-btn-search">${_SUITE.L('tphFetchData')}</button>
                        </div>
                    </div>
                    <div class="tl-v5-metrics">
                        <div class="tl-v5-metric"><span class="tl-v5-metric-label">${_SUITE.L('tphTotalPeriod')}</span><span class="tl-v5-metric-val" id="tl-v5-val-total">--</span></div>
                        <div class="tl-v5-metric"><span class="tl-v5-metric-label">${_SUITE.L('tphAvgHour')}</span><span class="tl-v5-metric-val" id="tl-v5-val-avg-hr">--</span></div>
                        <div class="tl-v5-metric"><span class="tl-v5-metric-label">${_SUITE.L('tphAvg5min')}</span><span class="tl-v5-metric-val" id="tl-v5-val-avg">--</span></div>
                        <div class="tl-v5-metric" style="border-color:${CONFIG.ui.needColor}44;"><span class="tl-v5-metric-label" style="color:${CONFIG.ui.needColor};">${_SUITE.L('tphNeedHour')}</span><span class="tl-v5-metric-val" id="tl-v5-val-need-hr">--</span></div>
                        <div class="tl-v5-metric" style="border-color:${CONFIG.ui.needColor}44;"><span class="tl-v5-metric-label" style="color:${CONFIG.ui.needColor};">${_SUITE.L('tphCurrentNeed')}</span><span class="tl-v5-metric-val" id="tl-v5-val-need">--</span></div>
                        <div class="tl-v5-metric"><span class="tl-v5-metric-label">${_SUITE.L('tphAchievement')}</span><span class="tl-v5-metric-val" id="tl-v5-val-achv" style="color:${CONFIG.ui.realColor};">--%</span></div>
                        <div class="tl-v5-metric" id="tl-v5-metric-trend" style="border-color:rgba(168,157,255,0.3);"><span class="tl-v5-metric-label" style="color:#c4b5fd;">${_SUITE.L('tphTrend')}</span><span class="tl-v5-metric-val" id="tl-v5-val-trend" style="color:#c4b5fd;">--</span></div>
                    </div>
                    <div style="display:flex; flex:1; position:relative; min-height:250px;">
                        <div id="tl-v5-yaxis-wrap" style="position:absolute; left:0; top:0; bottom:8px; z-index:10; background:transparent; pointer-events:none; width:45px; display:none;">
                        </div>
                        <div id="tl-v5-mask-wrap" style="flex:1; width:100%; position:relative; overflow:hidden; display:flex;">
                            <div class="tl-v5-canvas-container" id="tl-v5-container" style="flex:1;">
                                <div class="tl-v5-canvas-inner" id="tl-v5-canvas-inner"></div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(popup);

            const inputs = {
                node: document.getElementById('tl-v5-node'),
                dateStart: document.getElementById('tl-v5-date-start'),
                timeStart: document.getElementById('tl-v5-time-start'),
                dateEnd: document.getElementById('tl-v5-date-end'),
                timeEnd: document.getElementById('tl-v5-time-end'),
                goal: document.getElementById('tl-v5-goal'),
                vol: document.getElementById('tl-v5-vol'),
                pausaStart: document.getElementById('tl-v5-pausa-start'),
                pausaEnd: document.getElementById('tl-v5-pausa-end'),
                pausa2Start: document.getElementById('tl-v5-pausa2-start'),
                pausa2End: document.getElementById('tl-v5-pausa2-end'),
                search: document.getElementById('tl-v5-btn-search'),
                autoToggle: document.getElementById('tl-v5-auto-toggle'),
                refresh: document.getElementById('tl-v5-refresh-select')
            };

            inputs.refresh.value = REFRESH_MS;

            const ui = {
                loader: document.getElementById('tl-v5-loader'),
                loaderFill: document.getElementById('tl-v5-loader-fill'),
                loaderMsg: document.getElementById('tl-v5-loader-msg'),
                loaderBarWrap: document.getElementById('tl-v5-loader-wrap'),
                canvasInner: document.getElementById('tl-v5-canvas-inner'),
                container: document.getElementById('tl-v5-container'),
                timerText: document.getElementById('tl-v5-timer')
            };

            function applyTimeMask(inputEl) {
                inputEl.addEventListener('input', function() {
                    let v = this.value.replace(/\D/g, '');
                    if (v.length > 2) this.value = v.substring(0, 2) + ':' + v.substring(2, 4);
                    else this.value = v;
                });
                inputEl.addEventListener('blur', function() {
                    if (!/^([0-1]\d|2[0-3]):([0-5]\d)$/.test(this.value)) this.value = "12:00";
                });
            }

            applyTimeMask(inputs.timeStart);
            applyTimeMask(inputs.timeEnd);
            applyTimeMask(inputs.pausaStart);
            applyTimeMask(inputs.pausaEnd);
            applyTimeMask(inputs.pausa2Start);
            applyTimeMask(inputs.pausa2End);

            let isDragging = false, isResizing = false;
            let startX, startY, startW, startH, currentHandle;

            document.getElementById('tl-v5-header').addEventListener('mousedown', (e) => {
                if (e.target.closest('button') || popup.classList.contains('fullscreen')) return;
                isDragging = true;
                const rect = popup.getBoundingClientRect();
                startX = e.clientX - rect.left; startY = e.clientY - rect.top;
                popup.style.transform = 'none'; popup.style.left = rect.left + 'px'; popup.style.top = rect.top + 'px';
            });

            document.querySelectorAll('.tl-v5-rh').forEach(handle => {
                handle.addEventListener('mousedown', (e) => {
                    if (popup.classList.contains('fullscreen')) return;
                    isResizing = true; currentHandle = handle.className;
                    const rect = popup.getBoundingClientRect();
                    startW = rect.width; startH = rect.height;
                    startX = e.clientX; startY = e.clientY;
                    popup.style.transform = 'none'; popup.style.left = rect.left + 'px'; popup.style.top = rect.top + 'px';
                    e.preventDefault();
                });
            });

            let tphraf = null;
            document.addEventListener('mousemove', (e) => {
                if (!isDragging && !isResizing) return;
                if (tphraf) cancelAnimationFrame(tphraf);
                tphraf = requestAnimationFrame(() => {
                    if (isDragging) {
                        popup.style.left = `${e.clientX - startX}px`; popup.style.top = `${e.clientY - startY}px`;
                    } else if (isResizing) {
                        if (currentHandle.includes('e')) popup.style.width = `${Math.max(CONFIG.ui.minWidth, startW + (e.clientX - startX))}px`;
                        if (currentHandle.includes('s')) popup.style.height = `${Math.max(CONFIG.ui.minHeight, startH + (e.clientY - startY))}px`;
                    }
                    tphraf = null;
                });
            });

            document.addEventListener('mouseup', () => {
                isDragging = false; isResizing = false;
                if (tphraf) { cancelAnimationFrame(tphraf); tphraf = null; }
            });

            function startCountdownTimer() {
                clearInterval(countdownInterval);
                nextRefreshTime = Date.now() + REFRESH_MS;
                countdownInterval = setInterval(() => {
                    const timeLeft = Math.max(0, Math.floor((nextRefreshTime - Date.now()) / 1000));
                    const m = String(Math.floor(timeLeft / 60)).padStart(2, '0');
                    const s = String(timeLeft % 60).padStart(2, '0');
                    ui.timerText.innerText = `${m}:${s}`;
                    if (timeLeft === 0) {
                        nextRefreshTime = Date.now() + REFRESH_MS;
                        if (AUTO_REFRESH_ON) {
                            syncData(false);
                        }
                    }
                }, 1000);
            }

            function generateTimeBlocks() {
                let startTime = getMsFromInputs(inputs.dateStart, inputs.timeStart);
                let endTime = getMsFromInputs(inputs.dateEnd, inputs.timeEnd);
                if (!startTime || !endTime) { alert(_SUITE.L('fillDates')); return null; }
                if (endTime <= startTime) { alert(_SUITE.L('endAfterStart')); return null; }
                const coeff = CONFIG.time.blockMs;
                startTime = Math.floor(startTime / coeff) * coeff;
                endTime = Math.floor(endTime / coeff) * coeff;
                const blocks = [];
                for (let t = startTime; t <= endTime; t += coeff) {
                    const d = new Date(t);
                    blocks.push({ start: t, end: t + coeff, label: fmtTime(d), value: 0 });
                }
                return blocks;
            }

            function fetchSingleBlock(node, token, startMs, endMs) {
                return new Promise((resolve, reject) => {
                    const payload = {
                        nodeId: node, nodeType: 'SC', entity: 'getQualityMetricDetails',
                        metricType: 'PRODUCTIVITY_REPORT', containerTypes: ['PACKAGE'],
                        startTime: startMs, endTime: endMs,
                        metricsData: { nodeId: node, pageType: 'OUTBOUND', refreshType: '', device: 'DESKTOP', nodeType: 'SC', userAction: 'FAILED_MOVES_SUBMIT_CLICK' }
                    };
                    GM_xmlhttpRequest({
                        method: 'POST',
                        url: BASE + 'sortcenter/vista/controller/getQualityMetricDetails',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest', 'anti-csrftoken-a2z': token },
                        data: 'jsonObj=' + encodeURIComponent(JSON.stringify(payload)),
                        withCredentials: true,
                        onload: function(response) {
                            const finalUrl = response.finalUrl || '';
                            if (finalUrl.includes('midway-auth') || finalUrl.includes('/SSO/') || response.status === 401 || response.status === 403) {
                                _SUITE.antiCsrfToken = ''; return reject(new Error('Sessão expirada.'));
                            }
                            try {
                                const json = typeof response.responseText === 'object' ? response.responseText : JSON.parse(response.responseText);
                                const metrics = (json && json.ret && json.ret.getQualityMetricDetailsOutput && json.ret.getQualityMetricDetailsOutput.qualityMetrics) || [];
                                resolve(metrics.reduce((acc, row) => acc + (row.successfulScans || 0), 0));
                            } catch (e) { resolve(0); }
                        },
                        onerror: () => resolve(0)
                    });
                });
            }

            function showError(msg) {
                ui.loaderMsg.innerHTML = `⚠️<br><br>` + _SUITE.utils.esc(msg);
                ui.loaderMsg.style.color = '#f87171';
                ui.loaderBarWrap.style.display = 'none';
                ui.loader.style.display = 'flex';
                isFetching = false;
            }

            async function syncData(manualClick = true) {
                if (isFetching) return;
                isManualSearch = manualClick;
                const newBlocks = generateTimeBlocks();
                if (!newBlocks || newBlocks.length === 0) return;
                isFetching = true;
                timeBlocks = newBlocks;
                CURRENT_NODE = inputs.node.value.trim().toUpperCase() || 'CGH7';
                GM_setValue('tl_v5_chart_node', CURRENT_NODE);
                GM_setValue('tl_v5_vol_total', parseInt(inputs.vol.value) || 0);
                GM_setValue('tl_v5_pausa_start', inputs.pausaStart.value || '11:00');
                GM_setValue('tl_v5_pausa_end', inputs.pausaEnd.value || '12:15');
                GM_setValue('tl_v5_pausa2_start', inputs.pausa2Start.value || '15:00');
                GM_setValue('tl_v5_pausa2_end', inputs.pausa2End.value || '15:15');
                ui.loaderMsg.innerHTML = `${_SUITE.L('tphFetching')} ${timeBlocks.length} ${_SUITE.L('tphBlocks')}...`;
                ui.loaderMsg.style.color = CONFIG.ui.realColor;
                ui.loaderBarWrap.style.display = 'block';
                ui.loaderFill.style.width = '0%';
                ui.loader.style.display = 'flex';
                _SUITE.utils.fetchAntiCsrfToken(async (token) => {
                    if (!token) return showError('Falha ao obter Token. Recarregue a página.');
                    try {
                        let completed = 0;
                        let delayIndex = 0;
                        let cacheHits = 0;
                        let skipped = 0;
                        const now = Date.now();
                        const updateStatus = () => {
                            const needed = timeBlocks.length - cacheHits - skipped;
                            ui.loaderMsg.innerHTML = `${_SUITE.L('tphFetching')} ${needed} ${_SUITE.L('tphBlocks')} <small>(${cacheHits} cache, ${skipped} skip)</small>`;
                            ui.loaderFill.style.width = Math.round((completed / timeBlocks.length) * 100) + '%';
                        };
                        const requests = timeBlocks.map((block) => {
                            return new Promise(async (resolve) => {
                                if (block.start > now) {
                                    completed++; skipped++; updateStatus(); resolve(); return;
                                }
                                const cacheKey = `tph_v2_${CURRENT_NODE}_${block.start}_${block.end}`;
                                const cachedStr = GM_getValue(cacheKey);
                                if (cachedStr) {
                                    try {
                                        const parsed = JSON.parse(cachedStr);
                                        if (now - parsed.ts < 24 * 60 * 60 * 1000) {
                                            block.value = parsed.value; completed++; cacheHits++; updateStatus(); resolve(); return;
                                        }
                                    } catch (e) {}
                                }
                                const currentIndex = delayIndex++;
                                await new Promise(r => setTimeout(r, currentIndex * CONFIG.time.apiDelayMs));
                                try {
                                    block.value = await fetchSingleBlock(CURRENT_NODE, token, block.start, block.end);
                                    if (now - block.end > 15 * 60 * 1000) {
                                        GM_setValue(cacheKey, JSON.stringify({ value: block.value, ts: now }));
                                    }
                                } catch (e) {
                                    if (e.message === 'Sessão expirada.') throw e;
                                    block.value = 0;
                                }
                                completed++; updateStatus(); resolve();
                            });
                        });
                        await Promise.all(requests);
                        ui.loader.style.display = 'none';
                        isFetching = false;
                        renderChart();
                        startCountdownTimer();
                    } catch (error) {
                        showError(_SUITE.utils.esc(error.message) + `<br>Faça login novamente.`);
                        isFetching = false;
                    }
                });
            }

            const labelsPlugin = {
                id: 'alwaysShowLabels',
                afterDatasetsDraw(chart) {
                    const { ctx, data } = chart;
                    const metaReal = chart.getDatasetMeta(0);
                    const needDataset = data.datasets.find(ds => ds.label === _SUITE.L('tphNeedLine'));
                    const needMeta = needDataset ? chart.getDatasetMeta(data.datasets.indexOf(needDataset)) : null;
                    ctx.save();
                    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
                    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 3; ctx.shadowOffsetX = 1; ctx.shadowOffsetY = 1;
                    metaReal.data.forEach((point, index) => {
                        const val = data.datasets[0].data[index];
                        if (val > 0) {
                            ctx.font = 'bold 16px "DM Sans", sans-serif'; ctx.fillStyle = '#fff';
                            ctx.fillText(val, point.x, point.y - 12);
                            let target = GOAL_5MIN;
                            if (needDataset && needDataset.data[index] > 0) target = needDataset.data[index];
                            if (target > 0) {
                                const diffPct = ((val - target) / target) * 100;
                                const diffRounded = Math.round(diffPct);
                                let pctText = '', pctColor = '';
                                if (diffRounded > 0) { pctText = `▲ ${diffRounded}%`; pctColor = CONFIG.ui.upColor; }
                                else if (diffRounded < 0) { pctText = `▼ ${Math.abs(diffRounded)}%`; pctColor = CONFIG.ui.downColor; }
                                else { pctText = `- 0%`; pctColor = 'rgba(255,255,255,0.4)'; }
                                ctx.font = 'bold 13px "DM Sans", sans-serif'; ctx.fillStyle = pctColor;
                                ctx.fillText(pctText, point.x, point.y - 30);
                            }
                        }
                    });
                    if (needDataset && needMeta) {
                        needMeta.data.forEach((point, index) => {
                            const needVal = needDataset.data[index];
                            if (needVal > 0) {
                                const yPos = point.y + 18;
                                ctx.font = 'bold 13px "DM Sans", sans-serif'; ctx.fillStyle = CONFIG.ui.needColor;
                                ctx.textBaseline = 'top'; ctx.fillText(needVal, point.x, yPos); ctx.textBaseline = 'bottom';
                            }
                        });
                    }
                    ctx.restore();
                }
            };

            function renderChart() {
                ui.container.classList.add('updating');
                setTimeout(() => { executeChartRender(); ui.container.classList.remove('updating'); }, 60);
            }

            function executeChartRender() {
                const labels = timeBlocks.map(b => b.label);
                const dataValues = timeBlocks.map(b => b.value);
                const metaValues = Array(labels.length).fill(GOAL_5MIN);
                const initialVol = parseInt(inputs.vol.value) || 0;
                const pMin = getTotalPauseMinutes();
                const startTimeMs = getMsFromInputs(inputs.dateStart, inputs.timeStart);
                const endTimeMs = getMsFromInputs(inputs.dateEnd, inputs.timeEnd);
                const turnoTotalMin = startTimeMs && endTimeMs ? Math.max(0, (endTimeMs - startTimeMs) / 60000) : 0;
                const totalNonPauseBlocks = Math.floor((turnoTotalMin - pMin) / 5);
                const averageNeed = totalNonPauseBlocks > 0 ? Math.round(initialVol / totalNonPauseBlocks) : 0;
                let needValues = [];
                let currentNeedMetric = averageNeed;
                const nowMs = Date.now();
                const isShiftActive = (nowMs >= startTimeMs && nowMs <= endTimeMs);
                let dynamicRemVol = initialVol;
                let dynamicRemBlocks = totalNonPauseBlocks;
                for (let i = 0; i < timeBlocks.length; i++) {
                    let block = timeBlocks[i];
                    let isP = isAnyPauseBlock(block.start);
                    if (isP) { needValues.push(0); } else {
                        if (isShiftActive) {
                            let currentNeed = dynamicRemBlocks > 0 ? Math.round(dynamicRemVol / dynamicRemBlocks) : averageNeed;
                            if (currentNeed < 0) currentNeed = 0;
                            needValues.push(currentNeed);
                            if (block.start <= nowMs && block.end > nowMs) currentNeedMetric = currentNeed;
                        } else { needValues.push(averageNeed); }
                        if (block.end <= nowMs) { dynamicRemVol -= dataValues[i]; dynamicRemBlocks -= 1; }
                    }
                }
                if (endTimeMs < nowMs) currentNeedMetric = averageNeed;
                const totalPkgs = dataValues.reduce((a, b) => a + b, 0);
                const validValues = dataValues.filter(v => v > 0);
                const avg = validValues.length > 0 ? Math.round(validValues.reduce((a, b) => a + b, 0) / validValues.length) : 0;
                const avgHr = avg * 12;
                const comparisonTarget = currentNeedMetric > 0 ? currentNeedMetric : GOAL_5MIN;
                const achv = comparisonTarget > 0 ? Math.round((avg / comparisonTarget) * 100) : 0;
                document.getElementById('tl-v5-val-total').innerText = totalPkgs.toLocaleString('pt-BR');
                document.getElementById('tl-v5-val-avg-hr').innerText = avgHr.toLocaleString('pt-BR');
                document.getElementById('tl-v5-val-avg').innerText = avg.toLocaleString('pt-BR');
                const needHr = currentNeedMetric * 12;
                const needHrEl = document.getElementById('tl-v5-val-need-hr');
                if (needHrEl) needHrEl.innerText = needHr > 0 ? needHr.toLocaleString('pt-BR') : '--';
                const needEl = document.getElementById('tl-v5-val-need');
                if (needEl) needEl.innerText = currentNeedMetric > 0 ? currentNeedMetric.toLocaleString('pt-BR') : '--';
                document.getElementById('tl-v5-val-achv').innerText = achv + '%';
                const achvEl = document.getElementById('tl-v5-val-achv');
                if (achv >= 95) achvEl.style.color = '#60a5fa'; else if (achv >= 80) achvEl.style.color = '#34d399';
                else if (achv >= 50) achvEl.style.color = '#fcd34d'; else achvEl.style.color = '#f87171';
                const trendEl = document.getElementById('tl-v5-val-trend');
                const trendCard = document.getElementById('tl-v5-metric-trend');
                if (trendEl && trendCard) {
                    if (isShiftActive && avg > 0 && endTimeMs > nowMs) {
                        let remainingBlocks = 0;
                        for (let i = 0; i < timeBlocks.length; i++) {
                            if (timeBlocks[i].start >= nowMs && !isAnyPauseBlock(timeBlocks[i].start)) remainingBlocks++;
                        }
                        const projected = totalPkgs + (avg * remainingBlocks);
                        trendEl.innerText = projected.toLocaleString('pt-BR');
                        if (initialVol > 0) {
                            const pct = (projected / initialVol) * 100;
                            if (pct >= 100) { trendEl.style.color = '#34d399'; trendCard.style.borderColor = 'rgba(52,211,153,0.4)'; }
                            else if (pct >= 85) { trendEl.style.color = '#fcd34d'; trendCard.style.borderColor = 'rgba(252,211,77,0.4)'; }
                            else { trendEl.style.color = '#f87171'; trendCard.style.borderColor = 'rgba(248,113,113,0.4)'; }
                        } else { trendEl.style.color = '#c4b5fd'; trendCard.style.borderColor = 'rgba(168,157,255,0.3)'; }
                    } else { trendEl.innerText = '--'; trendEl.style.color = '#c4b5fd'; trendCard.style.borderColor = 'rgba(168,157,255,0.3)'; }
                }
                const neededWidth = timeBlocks.length * CONFIG.ui.pixelsPerPoint;
                ui.canvasInner.style.minWidth = `max(100%, ${neededWidth}px)`;
                if (chartInstance) chartInstance.destroy();
                ui.canvasInner.innerHTML = '<canvas id="tl-v5-c5"></canvas>';
                const ctx = document.getElementById('tl-v5-c5').getContext('2d');
                const datasets = [
                    {
                        label: _SUITE.L('tphRealLine'), data: dataValues, borderColor: CONFIG.ui.realColor, borderWidth: 3, pointRadius: 5, fill: true, tension: 0.3, pointBackgroundColor: CONFIG.ui.realColor,
                        backgroundColor: (c) => {
                            if (!c.chartArea) return 'rgba(168,157,255,0.2)';
                            const g = c.ctx.createLinearGradient(0, c.chartArea.top, 0, c.chartArea.bottom);
                            g.addColorStop(0, 'rgba(168,157,255,0.6)'); g.addColorStop(1, 'rgba(168,157,255,0.0)');
                            return g;
                        }
                    },
                    { label: _SUITE.L('tphRaiseBar'), data: metaValues, borderColor: CONFIG.ui.metaColor, borderWidth: 3, pointRadius: 0, fill: false }
                ];
                if (currentNeedMetric > 0 || initialVol !== 0) {
                    datasets.splice(1, 0, { label: _SUITE.L('tphNeedLine'), data: needValues, borderColor: CONFIG.ui.needColor, borderWidth: 2, borderDash: [5, 5], pointRadius: 0, fill: false });
                }
                let rawMax = Math.max(...dataValues, GOAL_5MIN, ...needValues);
                let roundedMax = Math.ceil((rawMax + 200) / 100) * 100;
                const bottomPadding = (currentNeedMetric > 0 || initialVol !== 0) ? 55 : 10;
                chartInstance = new Chart(ctx, {
                    type: 'line', data: { labels, datasets },
                    plugins: [labelsPlugin, {
                        id: 'htmlYAxis',
                        afterDraw: (chart) => {
                            const yAxisWrap = document.getElementById('tl-v5-yaxis-wrap');
                            if (!yAxisWrap || !chart.scales.y) return;
                            yAxisWrap.style.display = 'block';
                            const yScale = chart.scales.y;
                            const yWidth = Math.ceil(yScale.right) || 45;
                            yAxisWrap.style.width = yWidth + 'px';
                            const maskWrap = document.getElementById('tl-v5-mask-wrap');
                            if (maskWrap) {
                                const maskStr = `linear-gradient(to right, transparent ${yWidth}px, black ${yWidth}px)`;
                                maskWrap.style.maskImage = maskStr; maskWrap.style.webkitMaskImage = maskStr;
                            }
                            let html = '';
                            yScale.ticks.forEach(tick => {
                                if (tick.label === undefined || tick.label === '') return;
                                const yPos = yScale.getPixelForValue(tick.value);
                                html += `<div style="position:absolute; right:10px; top:${yPos}px; transform:translateY(-50%); color:rgba(255,255,255,0.6); font-family:'DM Sans', sans-serif; font-size:14px; font-weight:bold; white-space:nowrap; text-shadow:1px 1px 2px rgba(10,22,40,0.8);">${tick.label}</div>`;
                            });
                            yAxisWrap.innerHTML = html;
                        }
                    }],
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        layout: { padding: { top: 60, right: 30, bottom: bottomPadding, left: 20 } },
                        interaction: { mode: 'index', intersect: false },
                        plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(20,10,50,0.9)', titleColor: '#fff', bodyColor: '#aaa' } },
                        scales: {
                            x: { offset: true, ticks: { color: 'rgba(255,255,255,0.6)', font: { size: 14, family: "'DM Sans', sans-serif", weight: 'bold' } }, grid: { color: 'rgba(255,255,255,0.03)' }, border: { display: false } },
                            y: { min: 0, max: roundedMax, ticks: { color: 'transparent', font: { size: 14, family: "'DM Sans', sans-serif", weight: 'bold' } }, grid: { color: 'rgba(255,255,255,0.03)' }, border: { display: false } }
                        }
                    }
                });
                setTimeout(() => {
                    const now = Date.now();
                    const currentIdx = timeBlocks.findIndex(b => b.start <= now && b.end > now);
                    const lastDataIdx = dataValues.reduce((res, val, idx) => val > 0 ? idx : res, -1);
                    let targetIdx = currentIdx !== -1 ? currentIdx : lastDataIdx;
                    if (targetIdx !== -1) {
                        const targetX = targetIdx * CONFIG.ui.pixelsPerPoint;
                        const container = ui.container;
                        const scrollPos = Math.max(0, targetX - (container.clientWidth / 2) + (CONFIG.ui.pixelsPerPoint / 2));
                        container.scrollTo({ left: scrollPos, behavior: isManualSearch ? 'auto' : 'smooth' });
                    } else ui.container.scrollLeft = ui.container.scrollWidth;
                }, 100);
            }

            fab.addEventListener('click', () => {
                popup.classList.add('open'); overlay.classList.add('open');
                if (ui.loaderMsg.style.color === 'rgb(248, 113, 113)') ui.loader.style.display = 'none';
                if (timeBlocks.length === 0) syncData(false);
            });

            document.getElementById('tl-v5-btn-close').addEventListener('click', () => { popup.classList.remove('open'); overlay.classList.remove('open'); });
            overlay.addEventListener('click', () => { popup.classList.remove('open'); overlay.classList.remove('open'); });
            inputs.search.addEventListener('click', (e) => { e.preventDefault(); syncData(true); });
            inputs.autoToggle.addEventListener('click', function(e) { e.preventDefault(); AUTO_REFRESH_ON = !AUTO_REFRESH_ON; GM_setValue('tl_v5_auto_on', AUTO_REFRESH_ON); this.classList.toggle('on', AUTO_REFRESH_ON); });
            inputs.refresh.addEventListener('change', () => { REFRESH_MS = parseInt(inputs.refresh.value); GM_setValue('tl_v5_refresh_ms', REFRESH_MS); startCountdownTimer(); });

            [inputs.goal, inputs.vol, inputs.pausaStart, inputs.pausaEnd, inputs.pausa2Start, inputs.pausa2End].forEach(el => {
                el.addEventListener('change', () => {
                    GOAL_5MIN = parseInt(inputs.goal.value) || 800; VOL_TOTAL = parseInt(inputs.vol.value) || 0;
                    PAUSA_START = inputs.pausaStart.value || '11:00'; PAUSA_END = inputs.pausaEnd.value || '12:15';
                    PAUSA2_START = inputs.pausa2Start.value || '15:00'; PAUSA2_END = inputs.pausa2End.value || '15:15';
                    GM_setValue('tl_v5_chart_goal', GOAL_5MIN); GM_setValue('tl_v5_vol_total', VOL_TOTAL);
                    GM_setValue('tl_v5_pausa_start', PAUSA_START); GM_setValue('tl_v5_pausa_end', PAUSA_END);
                    GM_setValue('tl_v5_pausa2_start', PAUSA2_START); GM_setValue('tl_v5_pausa2_end', PAUSA2_END);
                    if (chartInstance) renderChart();
                });
            });
        })();
    });
})();
