// ==UserScript==
// @name         TL TPH Chart
// @namespace    http://tampermonkey.net/
// @version      1.1.9
// @description  Suite unificada: VRID Info, Mapa VSM, CPT Tracker, Painel Prod, TPH Chart
// @author       emanunec
// @match        https://trans-logistics.amazon.com/ssp/dock/hrz/ob*
// @match        https://trans-logistics.amazon.com/ssp/dock/hrz/ib*
// @match        https://trans-logistics.amazon.com/yms/*
// @match        https://track.relay.amazon.dev/*
// @run-at       document-start
// @require      https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_listValues
// @grant        GM_deleteValue
// @connect      ii51s3lexd.execute-api.us-east-1.amazonaws.com
// @connect      trans-logistics.amazon.com
// @connect      trans-logistics-fe.amazon.com
// @connect      trans-logistics-eu.amazon.com
// @connect      track.relay.amazon.dev
// @connect      *.amazon.com
// @connect      *.amazon.dev
// @connect      *.amazonaws.com
// @connect      stem-na.corp.amazon.com
// @connect      api.github.com
// @connect      raw.githubusercontent.com
// @connect      githubusercontent.com

// ==/UserScript==
(function () {
    'use strict';

    const VERSION = "1.1.9";
    var _SUITE = {};

    // ═══════════════════════════════════════════════════════════════
    // _SUITE.utils — Centralized utility functions (Phase 1 Refactor)
    // ═══════════════════════════════════════════════════════════════
    _SUITE.utils = {
        /** Escape HTML to prevent XSS in innerHTML contexts */
        esc: function (s) {
            return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        },

        /** Detect current Amazon node ID from DOM, URL, or cookie */
        detectNode: function () {
            var fns = [
                function () { var el = document.querySelector('#nodeId'); return el ? el.value || el.textContent.trim() : null; },
                function () { var el = document.querySelector('select[name="nodeId"] option:checked'); return el ? el.value.trim() : null; },
                function () { var el = document.querySelector('.node-selector, .nodeSelector, [class*="nodeId"]'); return el ? el.textContent.trim() : null; },
                function () { var m = document.body ? document.body.innerHTML.match(/\bNode[:\s]+([A-Z]{2,4}\d[A-Z0-9]{0,4})\b/) : null; return m ? m[1] : null; },
                function () { var m = location.href.match(/[?&]node=([A-Z]{2,4}\d[A-Z0-9]{0,4})/i); return m ? m[1].toUpperCase() : null; },
                function () { var m = document.cookie.match(/currentNode=([A-Z]{2,4}\d[A-Z0-9]{0,4})/i); return m ? m[1].toUpperCase() : null; },
            ];
            for (var i = 0; i < fns.length; i++) {
                try { var v = fns[i](); if (v && /^[A-Z]{2,4}\d[A-Z0-9]{0,4}$/i.test(v)) return v.toUpperCase(); } catch (_) { }
            }
            return GM_getValue('tl_node', 'CGH7');
        },

        /** Centralized anti-CSRF token fetcher — single implementation for all modules */
        fetchAntiCsrfToken: function (callback) {
            if (_SUITE.antiCsrfToken) { callback(_SUITE.antiCsrfToken); return; }
            GM_xmlhttpRequest({
                method: 'GET', url: _SUITE.BASE + 'sortcenter/vista',
                onload: function (response) {
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
                    } catch (e) { }
                    callback(_SUITE.antiCsrfToken || '');
                },
                onerror: function () { callback(''); }
            });
        },

        /**
         * Make an element draggable by a handle. Uses AbortController for cleanup.
         * @returns {function} cleanup — call to remove all listeners
         */
        makeDraggable: function (handleEl, panelEl) {
            var ac = new AbortController();
            var dX = 0, dY = 0, dragging = false;
            handleEl.addEventListener('mousedown', function (e) {
                if (e.target.closest('button') || e.target.closest('input') || e.target.closest('select')) return;
                dragging = true;
                var r = panelEl.getBoundingClientRect();
                panelEl.style.position = 'fixed';
                panelEl.style.transform = 'none';
                panelEl.style.left = r.left + 'px';
                panelEl.style.top = r.top + 'px';
                panelEl.style.width = r.width + 'px';
                panelEl.style.height = r.height + 'px';
                dX = e.clientX - r.left;
                dY = e.clientY - r.top;
                e.preventDefault();
            }, { signal: ac.signal });
            document.addEventListener('mousemove', function (e) {
                if (!dragging) return;
                panelEl.style.left = (e.clientX - dX) + 'px';
                panelEl.style.top = (e.clientY - dY) + 'px';
            }, { signal: ac.signal });
            document.addEventListener('mouseup', function () {
                dragging = false;
            }, { signal: ac.signal });
            return function cleanup() { ac.abort(); };
        }
    };

    _SUITE.checkForUpdates = function (manual, cb) {
        const now = Date.now();
        GM_setValue("suite_last_check_ts", now);

        const fail = () => {
            if (manual) alert("TL-Suite: Falha ao verificar atualizações. Verifique sua conexão ou se há bloqueios de rede.");
            if (cb) cb();
        };

        GM_xmlhttpRequest({
            method: "GET",
            url: "https://api.github.com/repos/Soakll/sort-center-tools/commits/main",
            timeout: 8000,
            onload: function (resp) {
                let latestVer = VERSION;
                let commitMsg = "Novas melhorias e correções no TL-Suite.";
                try {
                    const json = JSON.parse(resp.responseText);
                    commitMsg = json.commit.message || commitMsg;
                } catch (e) { }

                GM_xmlhttpRequest({
                    method: "GET",
                    url: "https://raw.githubusercontent.com/Soakll/sort-center-tools/main/tl-suite.user.js",
                    timeout: 8000,
                    onload: function (resp2) {
                        const m = resp2.responseText.match(/\/\/\s*@version\s+([\d\.]+)/);
                        if (m && m[1]) {
                            latestVer = m[1];
                        }

                        if (latestVer !== VERSION) {
                            showUpdateModal(latestVer, commitMsg);
                        } else if (manual) {
                            const isPt = GM_getValue('rd_lang', 'pt') === 'pt';
                            alert("TL-Suite: " + (isPt ? "Você já usa a versão mais recente! 😁" : "You are already up to date! 😁"));
                        }
                        if (cb) cb();
                    },
                    onerror: fail,
                    ontimeout: fail
                });
            },
            onerror: fail,
            ontimeout: fail
        });
    };

    function showUpdateModal(newVer, msg) {
        if (document.getElementById('tl-update-modal')) return;
        const modal = document.createElement('div');
        modal.id = 'tl-update-modal';
        modal.style = "position:fixed;top:20px;right:20px;background:#1a1a2e;color:white;padding:20px;border-radius:10px;z-index:100000;box-shadow:0 10px 30px rgba(0,0,0,0.5);border-left:5px solid #FF9900;font-family:sans-serif;max-width:350px;animation:slideIn 0.5s ease;";
        modal.innerHTML = `
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
                <span style="font-size:24px;">🚀</span>
                <b style="font-size:16px;">Nova Versão Disponível: ` + _SUITE.utils.esc(newVer) + `</b>
            </div>
            <div style="background:rgba(255,255,255,0.05);padding:10px;border-radius:6px;font-size:12px;margin-bottom:15px;max-height:150px;overflow-y:auto;line-height:1.4;color:#ccc;">
                ` + _SUITE.utils.esc(msg).replace(/\n/g, '<br>') + `
            </div>
            <div style="display:flex;gap:10px;">
                <button id="update-now" style="flex:1;background:#FF9900;border:none;color:white;padding:10px;border-radius:6px;cursor:pointer;font-weight:700;">Atualizar Agora</button>
                <button id="update-later" style="background:transparent;border:1px solid #444;color:#888;padding:8px;border-radius:6px;cursor:pointer;font-size:12px;">Depois</button>
            </div>
        `;
        document.body.appendChild(modal);

        document.getElementById('update-now').onclick = () => {
            GM_setValue("suite_last_version", newVer);
            location.href = "https://raw.githubusercontent.com/Soakll/sort-center-tools/main/tl-suite.user.js";
        };
        document.getElementById('update-later').onclick = () => {
            modal.style.animation = "slideOut 0.5s ease forwards";
            setTimeout(() => modal.remove(), 500);
        };
    }

    (function initUpdateScheduling() {
        const lastSlot = GM_getValue("suite_last_check_slot", "");
        const now = new Date();
        const hour = now.getHours();
        const todayStr = now.toISOString().split('T')[0];
        const currentSlot = (hour < 12 ? "00_" : "12_") + todayStr;

        if (lastSlot !== currentSlot) {
            GM_setValue("suite_last_check_slot", currentSlot);
            setTimeout(() => { if (_SUITE.checkForUpdates) _SUITE.checkForUpdates(false); }, 5000 * (Math.random() + 0.5));
        }
    })();

    _SUITE.BASE = location.hostname.includes('-fe.') ? 'https://trans-logistics-fe.amazon.com/'
        : location.hostname.includes('-eu.') ? 'https://trans-logistics-eu.amazon.com/'
            : 'https://trans-logistics.amazon.com/';

    _SUITE.href = location.href;
    _SUITE.isStemPage = location.hostname === 'stem-na.corp.amazon.com';
    _SUITE.isRTT = location.hostname === 'track.relay.amazon.dev';
    _SUITE.isYMS = location.hostname === 'trans-logistics.amazon.com' && location.pathname.includes('/yms/');
    _SUITE.isVista = _SUITE.href.includes('/sortcenter/flowrate');
    _SUITE.isOutbound = _SUITE.href.includes('/ssp/dock/hrz/ob');
    _SUITE.isIB = _SUITE.href.includes('/ssp/dock/hrz/ib');
    _SUITE.isDock = _SUITE.isOutbound || _SUITE.isIB;
    _SUITE.isSortCenter = _SUITE.href.includes('/sortcenter/');

    _SUITE.antiCsrfToken = '';
    _SUITE.ymsToken = '';
    _SUITE._capturedParams = {};
    _SUITE.API = {
        fetchContainers: function (planIds, callback) {
            if (!planIds || (Array.isArray(planIds) && planIds.length === 0)) { callback(null, {}); return; }
            const idsParam = Array.isArray(planIds) ? planIds.join(',') : planIds;
            const nodeId = GM_getValue('tl_node', 'CGH7');
            const params = new URLSearchParams({
                entity: 'getCDTBasedContainerCount',
                inboundLoadIds: idsParam,
                nodeId: nodeId
            });
            const token = _SUITE.antiCsrfToken || GM_getValue('gql_csrf_token', '');
            GM_xmlhttpRequest({
                method: 'POST',
                url: _SUITE.BASE + 'ssp/dock/hrz/ib/fetchdata',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-Requested-With': 'XMLHttpRequest',
                    'anti-csrftoken-a2z': token
                },
                data: params.toString(),
                withCredentials: true,
                timeout: 20000,
                onload: function (response) {
                    try {
                        const data = JSON.parse(response.responseText.replace(/^\uFEFF/, ''));
                        callback(null, data);
                    } catch (e) {
                        callback(e, null);
                    }
                },
                onerror: function (error) { callback(error, null); },
                ontimeout: function () { callback('Timeout', null); }
            });
        },
        mapToAccum: function (containers) {
            const accum = {};
            if (!containers || !Array.isArray(containers)) return accum;
            containers.forEach(c => {
                const route = c.stacking_filter || 'Unmapped';
                if (!accum[route]) accum[route] = { pkgs: 0, remaining: 0, cpts: {} };
                accum[route].pkgs += (c.package_count || 0);
                accum[route].remaining += (c.remaining_package_count || 0);
                if (c.inboundContainerCountCPTMix) {
                    c.inboundContainerCountCPTMix.forEach(cpt => {
                        const label = cpt.cptTime || 'N/A';
                        if (!accum[route].cpts[label]) accum[route].cpts[label] = { pkgs: 0, remaining: 0 };
                        accum[route].cpts[label].pkgs += (cpt.packageCount || 0);
                        accum[route].cpts[label].remaining += (cpt.remainingPackageCount || 0);
                    });
                }
            });
            return accum;
        }
    };

    (function patchXHR() {
        if (_SUITE.isStemPage) return;
        var oOpen = XMLHttpRequest.prototype.open;
        var oSet = XMLHttpRequest.prototype.setRequestHeader;
        var oSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (m, u) { this._u = u || ''; return oOpen.apply(this, arguments); };
        XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
            if (/anti-csrftoken-a2z/i.test(name) && value && value.length > 10) {
                _SUITE.antiCsrfToken = value;
                if (typeof _SUITE.antiCsrfToken !== 'undefined') _SUITE.antiCsrfToken = value;
            }
            if (/^token$/i.test(name) && value && value.length > 20) {
                _SUITE.ymsToken = value;
                GM_setValue('yms_token', value);
                GM_setValue('yms_token_ts', Date.now());
            }
            if (/^authorization$/i.test(name) && /^Bearer /i.test(value) && value.length > 30) {
                GM_setValue('relay_token', value);
                GM_setValue('relay_token_ts', Date.now());
            }
            return oSet.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function (body) {
            if (this._u && this._u.includes('/ssp/dock/hrz/ob/fetchdata') && body) {
                try {
                    var _lpdP = {};
                    String(body).split('&').forEach(function (pair) {
                        var i2 = pair.indexOf('='); if (i2 === -1) return;
                        _lpdP[decodeURIComponent(pair.slice(0, i2))] = decodeURIComponent(pair.slice(i2 + 1));
                    });
                    var _lv = (_lpdP.vrid || '').toUpperCase();
                    if (_lv) {
                        if (!_SUITE._capturedParams[_lv]) _SUITE._capturedParams[_lv] = {};
                        var _lc = _SUITE._capturedParams[_lv];
                        if (_lpdP.loadGroupId) _lc.loadGroupId = _lpdP.loadGroupId;
                        if (_lpdP.trailerId) _lc.trailerId = _lpdP.trailerId;
                        if (_lpdP.trailerNumber) _lc.trailerNumber = _lpdP.trailerNumber;
                        if (_lpdP.planId) _lc.planId = _lpdP.planId;
                        if (_lpdP.nodeId) _lc.nodeId = _lpdP.nodeId;
                    }
                } catch (e) { }
            }
            if (!_SUITE.antiCsrfToken && body && typeof body === 'string' && body.includes('nti-csrftoken-a2z=')) {
                try { var ex = decodeURIComponent(body.split('nti-csrftoken-a2z=')[1].split('&json')[0]); if (ex && ex.length > 10) _SUITE.antiCsrfToken = ex; } catch (e) { }
            }
            return oSend.apply(this, arguments);
        };
    })();

    function _onReady(fn) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
        else fn();
    }

    _onReady(function () {
        (function loadModuleTPH() {
            if (!_SUITE.isDock) return;
            'use strict';

            if (location.pathname.includes('/yms/')) return;

            const CONFIG = {
                baseUrls: {
                    fe: 'https://trans-logistics-fe.amazon.com/',
                    eu: 'https://trans-logistics-eu.amazon.com/',
                    us: 'https://trans-logistics.amazon.com/'
                },
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
        .tl-v5-refresh-select { background:transparent; border:none; color:rgba(255,255,255,0.6); font-size:10px; cursor:pointer; outline:none; border-left: 1px solid rgba(255,255,255,0.1); padding-left: 6px; font-family:'DM Sans', sans-serif; }

        .tl-v5-metrics { display:flex; gap:1rem; margin-bottom:1rem; flex-shrink:0; justify-content: space-between; }
        .tl-v5-metric { background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:12px 14px; flex:1; min-width: 0; }
        .tl-v5-metric-label { font-size:0.65rem; color:rgba(255,255,255,0.4); margin-bottom:4px; text-transform:uppercase; display:block; font-weight:600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .tl-v5-metric-val { font-size:1.6rem; font-weight:700; color:#fff; display:block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        .tl-v5-canvas-container { position:relative; flex:1; width:100%; overflow-x:auto; overflow-y:hidden; min-height:250px; border-radius:8px; opacity:1; transition:opacity 0.2s, transform 0.2s; }
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
            fab.title = 'Painel Gráfico Global V5';
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
            <div class="tl-v5-header-title">📈 Throughput · ${CONFIG.time.blockMs / 60000} Min Periods</div>
            <div class="tl-v5-header-actions">
                <button class="tl-v5-btn-icon" id="tl-v5-btn-close" title="Fechar">✕</button>
            </div>
        </div>

        <div class="tl-v5-rh tl-v5-rh-e"></div><div class="tl-v5-rh tl-v5-rh-s"></div><div class="tl-v5-rh tl-v5-rh-se"></div>

        <div class="tl-v5-body">
            <div id="tl-v5-loader">
                <span class="tl-v5-loader-text" id="tl-v5-loader-msg">Aguardando...</span>
                <div class="tl-v5-loader-bar" id="tl-v5-loader-wrap"><div class="tl-v5-loader-fill" id="tl-v5-loader-fill"></div></div>
            </div>

            <div class="tl-v5-controls-bar">
                <div class="tl-v5-inp-group">
                    <label class="tl-v5-inp-label">Node</label>
                    <input type="text" id="tl-v5-node" class="tl-v5-inp" value="${CURRENT_NODE}" maxlength="8" style="width:60px; text-align:center;">
                </div>
                <div class="tl-v5-inp-group">
                    <label class="tl-v5-inp-label">Início (Turno)</label>
                    <div style="display:flex; gap:4px;">
                        <input type="date" id="tl-v5-date-start" class="tl-v5-inp" value="${fmtDate(startRoundedDate)}" lang="pt-BR" style="width:120px;">
                        <input type="text" id="tl-v5-time-start" class="tl-v5-inp" value="${fmtTime(startRoundedDate)}" placeholder="HH:MM" maxlength="5" style="width:55px; text-align:center;">
                    </div>
                </div>
                <div class="tl-v5-inp-group">
                    <label class="tl-v5-inp-label">Fim (Turno)</label>
                    <div style="display:flex; gap:4px;">
                        <input type="date" id="tl-v5-date-end" class="tl-v5-inp" value="${fmtDate(endRoundedDate)}" lang="pt-BR" style="width:120px;">
                        <input type="text" id="tl-v5-time-end" class="tl-v5-inp" value="${fmtTime(endRoundedDate)}" placeholder="HH:MM" maxlength="5" style="width:55px; text-align:center;">
                    </div>
                </div>

                <div class="sep-line"></div>

                <div class="tl-v5-inp-group">
                    <label class="tl-v5-inp-label label-green">Volume Total</label>
                    <input type="number" id="tl-v5-vol" class="tl-v5-inp" value="${VOL_TOTAL}" style="width:75px;">
                </div>
                <div class="tl-v5-inp-group">
                    <label class="tl-v5-inp-label label-green">Horário de Almoço</label>
                    <div style="display:flex; gap:4px;">
                        <input type="text" id="tl-v5-pausa-start" class="tl-v5-inp" value="${PAUSA_START}" placeholder="HH:MM" maxlength="5" style="width:55px; text-align:center;">
                        <span style="color:rgba(255,255,255,0.4); align-self:center;">-</span>
                        <input type="text" id="tl-v5-pausa-end" class="tl-v5-inp" value="${PAUSA_END}" placeholder="HH:MM" maxlength="5" style="width:55px; text-align:center;">
                    </div>
                </div>
                <div class="tl-v5-inp-group">
                    <label class="tl-v5-inp-label label-green">Pausa</label>
                    <div style="display:flex; gap:4px;">
                        <input type="text" id="tl-v5-pausa2-start" class="tl-v5-inp" value="${PAUSA2_START}" placeholder="HH:MM" maxlength="5" style="width:55px; text-align:center;">
                        <span style="color:rgba(255,255,255,0.4); align-self:center;">-</span>
                        <input type="text" id="tl-v5-pausa2-end" class="tl-v5-inp" value="${PAUSA2_END}" placeholder="HH:MM" maxlength="5" style="width:55px; text-align:center;">
                    </div>
                </div>
                <div class="tl-v5-inp-group">
                    <label class="tl-v5-inp-label label-red">Meta Fixa</label>
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
                    <button class="tl-v5-btn-primary" id="tl-v5-btn-search">Buscar Dados</button>
                </div>
            </div>

            <div class="tl-v5-metrics">
                <div class="tl-v5-metric"><span class="tl-v5-metric-label">Total do Período</span><span class="tl-v5-metric-val" id="tl-v5-val-total">--</span></div>
                <div class="tl-v5-metric"><span class="tl-v5-metric-label">Média / Hora</span><span class="tl-v5-metric-val" id="tl-v5-val-avg-hr">--</span></div>
                <div class="tl-v5-metric"><span class="tl-v5-metric-label">Média / 5 min</span><span class="tl-v5-metric-val" id="tl-v5-val-avg">--</span></div>
                <div class="tl-v5-metric" style="border-color:${CONFIG.ui.needColor}44;"><span class="tl-v5-metric-label" style="color:${CONFIG.ui.needColor};">Nec. Atual / 5 min</span><span class="tl-v5-metric-val" id="tl-v5-val-need">--</span></div>
                <div class="tl-v5-metric"><span class="tl-v5-metric-label">Atingimento (vs Nec.)</span><span class="tl-v5-metric-val" id="tl-v5-val-achv" style="color:${CONFIG.ui.realColor};">--%</span></div>
                <div class="tl-v5-metric" id="tl-v5-metric-trend" style="border-color:rgba(168,157,255,0.3);"><span class="tl-v5-metric-label" style="color:#c4b5fd;">📈 Tendência</span><span class="tl-v5-metric-val" id="tl-v5-val-trend" style="color:#c4b5fd;">--</span></div>
            </div>

            <div class="tl-v5-canvas-container" id="tl-v5-container">
                <div class="tl-v5-canvas-inner" id="tl-v5-canvas-inner"></div>
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
                inputEl.addEventListener('input', function () {
                    let v = this.value.replace(/\D/g, '');
                    if (v.length > 2) this.value = v.substring(0, 2) + ':' + v.substring(2, 4);
                    else this.value = v;
                });
                inputEl.addEventListener('blur', function () {
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

                if (!startTime || !endTime) { alert("Preencha Data e Hora de Início e Fim."); return null; }
                if (endTime <= startTime) { alert("Erro: A data/hora final deve ser MAIOR que a inicial."); return null; }

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
                        onload: function (response) {
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
                CURRENT_NODE = inputs.node.value.trim().toUpperCase() || (typeof CURRENT_NODE !== 'undefined' ? CURRENT_NODE : GM_getValue('tl_node', 'CGH7'));
                GM_setValue('tl_v5_chart_node', CURRENT_NODE);

                GM_setValue('tl_v5_vol_total', parseInt(inputs.vol.value) || 0);
                GM_setValue('tl_v5_pausa_start', inputs.pausaStart.value || '11:00');
                GM_setValue('tl_v5_pausa_end', inputs.pausaEnd.value || '12:15');
                GM_setValue('tl_v5_pausa2_start', inputs.pausa2Start.value || '15:00');
                GM_setValue('tl_v5_pausa2_end', inputs.pausa2End.value || '15:15');

                ui.loaderMsg.innerHTML = `Buscando ${timeBlocks.length} blocos...`;
                ui.loaderMsg.style.color = CONFIG.ui.realColor;
                ui.loaderBarWrap.style.display = 'block';
                ui.loaderFill.style.width = '0%';
                ui.loader.style.display = 'flex';

                _SUITE.utils.fetchAntiCsrfToken(async (token) => {
                    if (!token) return showError('Falha ao obter Token. Recarregue a página.');

                    try {
                        let completed = 0;
                        const requests = timeBlocks.map((block, index) => {
                            return new Promise(async (resolve) => {
                                await new Promise(r => setTimeout(r, index * CONFIG.time.apiDelayMs));
                                try {
                                    block.value = await fetchSingleBlock(CURRENT_NODE, token, block.start, block.end);
                                } catch (e) {
                                    if (e.message === 'Sessão expirada.') throw e;
                                    block.value = 0;
                                }
                                completed++;
                                ui.loaderFill.style.width = Math.round((completed / timeBlocks.length) * 100) + '%';
                                resolve();
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
                    const needDataset = data.datasets.find(ds => ds.label === 'Necessidade');
                    const needMeta = needDataset
                        ? chart.getDatasetMeta(data.datasets.indexOf(needDataset))
                        : null;

                    ctx.save();
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'bottom';
                    ctx.shadowColor = 'rgba(0,0,0,0.5)';
                    ctx.shadowBlur = 3;
                    ctx.shadowOffsetX = 1;
                    ctx.shadowOffsetY = 1;

                    metaReal.data.forEach((point, index) => {
                        const val = data.datasets[0].data[index];
                        if (val > 0) {

                            ctx.font = 'bold 16px "DM Sans", sans-serif';
                            ctx.fillStyle = '#fff';
                            ctx.fillText(val, point.x, point.y - 12);

                            let target = GOAL_5MIN;
                            if (needDataset && needDataset.data[index] > 0) {
                                target = needDataset.data[index];
                            }

                            if (target > 0) {
                                const diffPct = ((val - target) / target) * 100;
                                const diffRounded = Math.round(diffPct);
                                let pctText = '', pctColor = '';

                                if (diffRounded > 0) { pctText = `▲ ${diffRounded}%`; pctColor = CONFIG.ui.upColor; }
                                else if (diffRounded < 0) { pctText = `▼ ${Math.abs(diffRounded)}%`; pctColor = CONFIG.ui.downColor; }
                                else { pctText = `- 0%`; pctColor = 'rgba(255,255,255,0.4)'; }

                                ctx.font = 'bold 13px "DM Sans", sans-serif';
                                ctx.fillStyle = pctColor;
                                ctx.fillText(pctText, point.x, point.y - 30);
                            }
                        }
                    });

                    if (needDataset && needMeta) {
                        needMeta.data.forEach((point, index) => {
                            const needVal = needDataset.data[index];
                            const realVal = data.datasets[0].data[index];

                            if (needVal > 0) {

                                const yPos = point.y + 18;

                                ctx.font = 'bold 13px "DM Sans", sans-serif';
                                ctx.fillStyle = CONFIG.ui.needColor;
                                ctx.textBaseline = 'top';
                                ctx.fillText(needVal, point.x, yPos);

                                if (realVal > 0) {
                                    const diffPct = ((realVal - needVal) / needVal) * 100;
                                    const diffRounded = Math.round(diffPct);
                                    let pctText = '', pctColor = '';

                                    if (diffRounded > 0) { pctText = `▲ ${diffRounded}%`; pctColor = CONFIG.ui.upColor; }
                                    else if (diffRounded < 0) { pctText = `▼ ${Math.abs(diffRounded)}%`; pctColor = CONFIG.ui.downColor; }
                                    else { pctText = `- 0%`; pctColor = 'rgba(255,255,255,0.4)'; }

                                    ctx.font = 'bold 11px "DM Sans", sans-serif';
                                    ctx.fillStyle = pctColor;
                                    ctx.fillText(pctText, point.x, yPos + 16);
                                }
                                ctx.textBaseline = 'bottom';
                            }
                        });
                    }

                    ctx.restore();
                }
            };

            function renderChart() {
                ui.container.classList.add('updating');
                setTimeout(() => {
                    executeChartRender();
                    ui.container.classList.remove('updating');
                }, 60);
            }

            function executeChartRender() {
                const labels = timeBlocks.map(b => b.label);
                const dataValues = timeBlocks.map(b => b.value);
                const metaValues = Array(labels.length).fill(GOAL_5MIN);

                const initialVol = parseInt(inputs.vol.value) || 0;
                const pMin = getTotalPauseMinutes();

                const startTimeMs = getMsFromInputs(inputs.dateStart, inputs.timeStart);
                const endTimeMs = getMsFromInputs(inputs.dateEnd, inputs.timeEnd);
                const turnoTotalMin = startTimeMs && endTimeMs
                    ? Math.max(0, (endTimeMs - startTimeMs) / 60000)
                    : 0;

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

                    if (isP) {
                        needValues.push(0);
                    } else {
                        if (isShiftActive) {
                            // Se o turno está ativo, usa a lógica de rebalanceamento (catch-up) para a linha
                            let currentNeed = dynamicRemBlocks > 0 ? Math.round(dynamicRemVol / dynamicRemBlocks) : averageNeed;
                            if (currentNeed < 0) currentNeed = 0;
                            needValues.push(currentNeed);

                            if (block.start <= nowMs && block.end > nowMs) {
                                currentNeedMetric = currentNeed;
                            }
                        } else {
                            // Se o turno já encerrou (ou é futuro), usamos a média equilibrada fixa
                            needValues.push(averageNeed);
                        }

                        if (block.end <= nowMs) {
                            dynamicRemVol -= dataValues[i];
                            dynamicRemBlocks -= 1;
                        }
                    }
                }

                // Se o período já encerrou, garante que o box mostre a média
                if (endTimeMs < nowMs) {
                    currentNeedMetric = averageNeed;
                }



                const totalPkgs = dataValues.reduce((a, b) => a + b, 0);
                const validValues = dataValues.filter(v => v > 0);
                const avg = validValues.length > 0 ? Math.round(validValues.reduce((a, b) => a + b, 0) / validValues.length) : 0;
                const avgHr = avg * 12;

                const comparisonTarget = currentNeedMetric > 0 ? currentNeedMetric : GOAL_5MIN;
                const achv = comparisonTarget > 0 ? Math.round((avg / comparisonTarget) * 100) : 0;

                document.getElementById('tl-v5-val-total').innerText = totalPkgs.toLocaleString('pt-BR');
                document.getElementById('tl-v5-val-avg-hr').innerText = avgHr.toLocaleString('pt-BR');
                document.getElementById('tl-v5-val-avg').innerText = avg.toLocaleString('pt-BR');

                const needEl = document.getElementById('tl-v5-val-need');
                if (needEl) needEl.innerText = currentNeedMetric > 0 ? currentNeedMetric.toLocaleString('pt-BR') : '--';

                document.getElementById('tl-v5-val-achv').innerText = achv + '%';

                const achvEl = document.getElementById('tl-v5-val-achv');
                if (achv >= 95) achvEl.style.color = '#60a5fa'; else if (achv >= 80) achvEl.style.color = '#34d399';
                else if (achv >= 50) achvEl.style.color = '#fcd34d'; else achvEl.style.color = '#f87171';

                // ── Tendência (Trend Projection) ──
                const trendEl = document.getElementById('tl-v5-val-trend');
                const trendCard = document.getElementById('tl-v5-metric-trend');
                if (trendEl && trendCard) {
                    if (isShiftActive && avg > 0 && endTimeMs > nowMs) {
                        // Count remaining non-pause 5-min blocks from now until shift end
                        let remainingBlocks = 0;
                        for (let i = 0; i < timeBlocks.length; i++) {
                            if (timeBlocks[i].start >= nowMs && !isAnyPauseBlock(timeBlocks[i].start)) {
                                remainingBlocks++;
                            }
                        }
                        const projected = totalPkgs + (avg * remainingBlocks);
                        trendEl.innerText = projected.toLocaleString('pt-BR');

                        // Color based on comparison with volume target
                        if (initialVol > 0) {
                            const pct = (projected / initialVol) * 100;
                            if (pct >= 100) {
                                trendEl.style.color = '#34d399'; // green — on/above target
                                trendCard.style.borderColor = 'rgba(52,211,153,0.4)';
                            } else if (pct >= 85) {
                                trendEl.style.color = '#fcd34d'; // yellow — close
                                trendCard.style.borderColor = 'rgba(252,211,77,0.4)';
                            } else {
                                trendEl.style.color = '#f87171'; // red — below target
                                trendCard.style.borderColor = 'rgba(248,113,113,0.4)';
                            }
                        } else {
                            trendEl.style.color = '#c4b5fd';
                            trendCard.style.borderColor = 'rgba(168,157,255,0.3)';
                        }
                    } else {
                        trendEl.innerText = '--';
                        trendEl.style.color = '#c4b5fd';
                        trendCard.style.borderColor = 'rgba(168,157,255,0.3)';
                    }
                }

                const neededWidth = timeBlocks.length * CONFIG.ui.pixelsPerPoint;
                ui.canvasInner.style.minWidth = `max(100%, ${neededWidth}px)`;

                if (chartInstance) { chartInstance.destroy(); }
                ui.canvasInner.innerHTML = '<canvas id="tl-v5-c5"></canvas>';
                const ctx = document.getElementById('tl-v5-c5').getContext('2d');

                const datasets = [
                    {
                        label: 'Real', data: dataValues, borderColor: CONFIG.ui.realColor, borderWidth: 3, pointRadius: 5, fill: true, tension: 0.3, pointBackgroundColor: CONFIG.ui.realColor,
                        backgroundColor: (c) => {
                            if (!c.chartArea) return 'rgba(168,157,255,0.2)';
                            const g = c.ctx.createLinearGradient(0, c.chartArea.top, 0, c.chartArea.bottom);
                            g.addColorStop(0, 'rgba(168,157,255,0.6)');
                            g.addColorStop(1, 'rgba(168,157,255,0.0)');
                            return g;
                        }
                    },
                    {
                        label: 'Meta Fixa', data: metaValues, borderColor: CONFIG.ui.metaColor, borderWidth: 3, borderDash: [], pointRadius: 0, fill: false
                    }
                ];

                if (currentNeedMetric > 0 || initialVol !== 0) {
                    datasets.splice(1, 0, {
                        label: 'Necessidade', data: needValues, borderColor: CONFIG.ui.needColor, borderWidth: 2, borderDash: [5, 5], pointRadius: 0, fill: false
                    });
                }

                const bottomPadding = (currentNeedMetric > 0 || initialVol !== 0) ? 55 : 10;

                chartInstance = new Chart(ctx, {
                    type: 'line',
                    data: { labels, datasets },
                    plugins: [labelsPlugin],
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        layout: { padding: { top: 60, right: 30, bottom: bottomPadding, left: 20 } },
                        interaction: { mode: 'index', intersect: false },
                        plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(20,10,50,0.9)', titleColor: '#fff', bodyColor: '#aaa' } },
                        scales: {
                            x: { ticks: { color: 'rgba(255,255,255,0.6)', font: { size: 14, family: "'DM Sans', sans-serif", weight: 'bold' } }, grid: { color: 'rgba(255,255,255,0.03)' }, border: { display: false } },
                            y: { min: 0, max: Math.max(...dataValues, GOAL_5MIN, ...needValues) + 200, ticks: { color: 'rgba(255,255,255,0.6)', font: { size: 14, family: "'DM Sans', sans-serif", weight: 'bold' } }, grid: { color: 'rgba(255,255,255,0.03)' }, border: { display: false } }
                        }
                    }
                });

                setTimeout(() => {
                    if (isManualSearch) {
                        ui.container.scrollLeft = 0;
                    } else {
                        const finalActiveIdx = dataValues.reduce((res, val, idx) => val > 0 ? idx : res, -1);
                        if (finalActiveIdx !== -1) {
                            const targetX = (finalActiveIdx + 1) * CONFIG.ui.pixelsPerPoint;
                            ui.container.scrollLeft = Math.max(0, targetX - ui.container.clientWidth + (CONFIG.ui.pixelsPerPoint * 2));
                        } else { ui.container.scrollLeft = ui.container.scrollWidth; }
                    }
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

            inputs.autoToggle.addEventListener('click', function (e) {
                e.preventDefault(); AUTO_REFRESH_ON = !AUTO_REFRESH_ON;
                GM_setValue('tl_v5_auto_on', AUTO_REFRESH_ON); this.classList.toggle('on', AUTO_REFRESH_ON);
            });

            inputs.refresh.addEventListener('change', () => {
                REFRESH_MS = parseInt(inputs.refresh.value);
                GM_setValue('tl_v5_refresh_ms', REFRESH_MS); startCountdownTimer();
            });

            [inputs.goal, inputs.vol, inputs.pausaStart, inputs.pausaEnd, inputs.pausa2Start, inputs.pausa2End].forEach(el => {
                el.addEventListener('change', () => {
                    GOAL_5MIN = parseInt(inputs.goal.value) || 800;
                    VOL_TOTAL = parseInt(inputs.vol.value) || 0;
                    PAUSA_START = inputs.pausaStart.value || '11:00';
                    PAUSA_END = inputs.pausaEnd.value || '12:15';
                    PAUSA2_START = inputs.pausa2Start.value || '15:00';
                    PAUSA2_END = inputs.pausa2End.value || '15:15';

                    GM_setValue('tl_v5_chart_goal', GOAL_5MIN);
                    GM_setValue('tl_v5_vol_total', VOL_TOTAL);
                    GM_setValue('tl_v5_pausa_start', PAUSA_START);
                    GM_setValue('tl_v5_pausa_end', PAUSA_END);
                    GM_setValue('tl_v5_pausa2_start', PAUSA2_START);
                    GM_setValue('tl_v5_pausa2_end', PAUSA2_END);

                    if (chartInstance) renderChart();
                });
            });
        })();
    });

})();
