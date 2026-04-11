// ==UserScript==
// @name         TL Productivity Panel
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
        (function loadModulePainelProd() {
            if (!_SUITE.isDock) return;
            'use strict';

            if (location.pathname.includes('/yms/')) return;

            var BASE = _SUITE.BASE;

            var CURRENT_NODE = GM_getValue('tl_node', _SUITE.utils.detectNode()) || 'CGH7';

            var AUTO_INTERVALS = [
                { label: '1 min', ms: 1 * 60 * 1000 },
                { label: '2 min', ms: 2 * 60 * 1000 },
                { label: '5 min', ms: 5 * 60 * 1000 },
                { label: '10 min', ms: 10 * 60 * 1000 },
                { label: '15 min', ms: 15 * 60 * 1000 },
                { label: '30 min', ms: 30 * 60 * 1000 },
                { label: '1 hora', ms: 60 * 60 * 1000 },
            ];
            var autoRefreshOn = GM_getValue('tl_auto_on', false);
            var autoRefreshInterval = GM_getValue('tl_auto_ms', 5 * 60 * 1000);
            var autoRefreshTimer = null;
            var countdownTimer = null;
            var nextRefreshAt = 0;

            var blurErrors = GM_getValue('tl_blur_errors', false);

            var goalPph = GM_getValue('tl_goal_pph', 300);

            var fetchAntiCsrfToken = _SUITE.utils.fetchAntiCsrfToken;

            GM_addStyle([

                '#tl-prod-fab{position:fixed;bottom:20px;right:20px;z-index:99999;width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg, #1a0533 0%, #0a1628 100%);color:#a89dff;font-size:20px;border:2px solid rgba(255,255,255,0.1);cursor:pointer;box-shadow:0 4px 15px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;transition:box-shadow .2s,transform .2s;padding:0}',
                '#tl-prod-fab:hover{box-shadow:0 6px 20px rgba(168,157,255,0.3);transform:scale(1.07)}',

                '#tl-prod-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:99998;display:none;backdrop-filter:blur(4px);opacity:0;transition:opacity .22s ease}',
                '#tl-prod-overlay.open{display:block;opacity:1}',

                '#tl-prod-popup{position:fixed;inset:0;z-index:99999;width:100vw;height:100vh;background:rgba(10, 22, 40, 0.85);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);display:flex;flex-direction:column;overflow:hidden;font-family:"Amazon Ember",Helvetica,Arial,sans-serif;font-size:13px;border:none;transition:none;color:#fff}',

                '.tl-rh{position:absolute;z-index:100000}',
                '.tl-rh-n{top:-4px;left:8px;right:8px;height:8px;cursor:n-resize}',
                '.tl-rh-s{bottom:-4px;left:8px;right:8px;height:8px;cursor:s-resize}',
                '.tl-rh-w{left:-4px;top:8px;bottom:8px;width:8px;cursor:w-resize}',
                '.tl-rh-e{right:-4px;top:8px;bottom:8px;width:8px;cursor:e-resize}',
                '.tl-rh-nw{top:-4px;left:-4px;width:16px;height:16px;cursor:nw-resize}',
                '.tl-rh-ne{top:-4px;right:-4px;width:16px;height:16px;cursor:ne-resize}',
                '.tl-rh-sw{bottom:-4px;left:-4px;width:16px;height:16px;cursor:sw-resize}',
                '.tl-rh-se{bottom:-4px;right:-4px;width:16px;height:16px;cursor:se-resize}',

                '#tl-prod-header{background:rgba(255,255,255,0.03);color:#fff;padding:14px 16px 0;flex-shrink:0;cursor:grab;user-select:none;border-bottom:1px solid rgba(255,255,255,0.1)}',
                '#tl-prod-header:active{cursor:grabbing}',
                '#tl-prod-header-row{display:flex;align-items:center;gap:8px;margin-bottom:10px}',
                '#tl-prod-icon{font-size:18px;line-height:1}',
                '#tl-prod-title{flex:1;font-weight:700;font-size:14px;color:#fff;letter-spacing:-.01em}',
                '#tl-prod-node-badge{font-size:11px;font-weight:600;color:#9ca3af;background:rgba(255,255,255,0.05);border-radius:4px;padding:2px 7px}',
                '#tl-prod-status{font-size:11px;color:#6b7280}',
                '#tl-prod-close{background:none;border:none;color:#9ca3af;font-size:18px;cursor:pointer;line-height:1;padding:2px 4px;border-radius:4px;transition:background .15s}',
                '#tl-prod-close:hover{background:rgba(255,255,255,0.1);color:#fff}',
                '#tl-node-input{font-size:12px;font-weight:700;padding:3px 7px;border:1.5px solid rgba(255,255,255,0.1);border-radius:6px;color:#fff;background:rgba(0,0,0,0.2);width:68px;text-align:center;text-transform:uppercase;cursor:text}',
                '#tl-node-input:focus{outline:none;border-color:#1a56db;background:rgba(0,0,0,0.3)}',



                '#tl-custom-row{display:flex;align-items:center;gap:6px;padding:8px 16px;background:rgba(255,255,255,0.02);border-bottom:1px solid rgba(255,255,255,0.05);flex-shrink:0}',
                '#tl-custom-row.hidden{display:none}',
                '#tl-time-start,#tl-time-end{font-size:12px;padding:4px 7px;border:1.5px solid rgba(255,255,255,0.1);border-radius:6px;color:#fff;background:rgba(0,0,0,0.2);width:80px;height:28px;box-sizing:border-box}',
                '#tl-date-pick,#tl-date-pick-end{font-size:12px;padding:4px 7px;border:1.5px solid rgba(255,255,255,0.1);border-radius:6px;color:#fff;background:rgba(0,0,0,0.2);width:115px;height:28px;box-sizing:border-box}',
                '#tl-date-pick:focus,#tl-date-pick-end:focus,#tl-time-start:focus,#tl-time-end:focus{outline:none;border-color:#3b82f6}',
                '.tl-arrow{color:#6b7280;font-size:13px}',
                '#tl-apply-btn{font-size:11px;font-weight:700;padding:4px 12px;border-radius:6px;border:none;background:#2563eb;color:#fff;cursor:pointer;margin-left:4px}',
                '#tl-apply-btn:hover{background:#1d4ed8}',

                '#tl-auto-bar{display:flex;align-items:center;gap:8px;padding:7px 16px;background:rgba(255,255,255,0.02);border-bottom:1px solid rgba(255,255,255,0.05);flex-shrink:0}',
                '#tl-auto-label{font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:.04em;flex-shrink:0}',
                '#tl-auto-toggle{position:relative;width:34px;height:19px;border:none;background:none;padding:0;cursor:pointer;flex-shrink:0}',
                '#tl-auto-toggle .track{position:absolute;inset:0;border-radius:10px;background:rgba(255,255,255,0.1);transition:background .25s cubic-bezier(.4,0,.2,1)}',
                '#tl-auto-toggle.on .track{background:#3b82f6}',
                '#tl-auto-toggle .thumb{position:absolute;top:3px;left:3px;width:13px;height:13px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:left .25s cubic-bezier(.4,0,.2,1)}',
                '#tl-auto-toggle.on .thumb{left:18px}',
                '#tl-auto-select{font-size:11px;padding:3px 6px;border:1.5px solid rgba(255,255,255,0.1);border-radius:6px;color:#fff;background:rgba(0,0,0,0.2);cursor:pointer}',
                '#tl-auto-select:focus{outline:none;border-color:#3b82f6}',
                '#tl-auto-countdown{font-size:11px;font-family:monospace;color:#3b82f6;font-weight:700;min-width:48px}',
                '#tl-goal-bar{display:flex;align-items:center;gap:12px;padding:8px 20px;background:transparent;border-bottom:1px solid rgba(255,255,255,0.05);flex-shrink:0}',
                '#tl-goal-label{font-size:13px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.04em;flex-shrink:0}',
                '#tl-goal-input{width:86px;font-size:16px;font-weight:800;padding:4px 8px;border:2px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;background:rgba(0,0,0,0.3);text-align:center;-moz-appearance:textfield}',
                '#tl-goal-input::-webkit-outer-spin-button,#tl-goal-input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}',
                '#tl-goal-input:focus{outline:none;border-color:#3b82f6;box-shadow:0 0 10px rgba(59,130,246,0.3)}',
                '#tl-goal-unit{font-size:13px;color:#9ca3af;flex-shrink:0}',
                '#tl-goal-legend{margin-left:12px;display:flex;gap:12px;align-items:center}',
                '.tl-goal-chip{font-size:12px;font-weight:700;padding:3px 10px;border-radius:12px;white-space:nowrap}',

                '#tl-prod-body{overflow:auto;flex:1;min-height:0;background:transparent}',
                '#tl-prod-body table{width:100%;border-collapse:collapse;border-spacing:0}',

                '#tl-prod-body thead th{position:sticky;top:0;background:rgba(30, 41, 59, 0.98);padding:10px 16px;text-align:center;font-size:13px;font-weight:800;color:#cbd5e1;text-transform:uppercase;letter-spacing:.04em;border:1.5px solid rgba(255,255,255,0.2);cursor:pointer;user-select:none;white-space:nowrap;z-index:2}',
                '#tl-prod-body thead th:hover{color:#fff;background:rgba(51, 65, 85, 0.95)}',
                '#tl-prod-body thead th.sort-asc::after{content:" ▴"}',
                '#tl-prod-body thead th.sort-desc::after{content:" ▾"}',

                '#tl-prod-body tbody tr{border-bottom:1.5px solid rgba(255,255,255,0.2);transition:background .15s ease}',
                '#tl-prod-body tbody tr:hover td{background:rgba(255,255,255,0.05)!important}',
                '#tl-prod-body tbody td{padding:8px 12px;font-size:13px;color:#f1f5f9;text-align:center;border:1.5px solid rgba(255,255,255,0.2)}',
                '#tl-prod-body tbody td.td-label{font-weight:700;color:#fff!important;white-space:nowrap;font-size:14px;text-align:left;border-right:2px solid rgba(255,255,255,0.3)}',
                '#tl-prod-body tbody td.td-num{font-variant-numeric:tabular-nums;font-weight:700;font-size:14px}',
                '#tl-prod-body tbody td.td-err{font-weight:700;color:#f87171}',
                '#tl-prod-body tbody td.td-na{color:#64748b;font-style:italic}',
                '#tl-prod-body tbody td.td-pph{font-weight:800;border-radius:0}',

                'td.tier-top{background:rgba(21, 128, 61, 0.45);color:#fff!important}',
                'td.tier-good{background:rgba(234, 179, 8, 0.45);color:#000!important}',
                'td.tier-mid{background:rgba(220, 38, 38, 0.45);color:#fff!important}',
                'td.tier-low{background:rgba(0, 0, 0, 0.85);color:#fff!important}',
                'td.tier-none{background:transparent}',

                '#tl-prod-footer{padding:12px 20px;font-size:14px;color:#94a3b8;border-top:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.03);display:flex;justify-content:space-between;align-items:center;flex-shrink:0}',

                '.tl-prod-loading{padding:48px;text-align:center;color:#94a3b8;font-size:16px}',
                '.tl-prod-error{padding:20px 24px;color:#f87171;font-size:14px;line-height:1.8}',
                '.tl-prod-error a{color:#60a5fa;font-weight:700}',

                'body.tl-blur-errors .tl-err-col{filter:blur(6px);color:#64748b!important;transition:filter .2s ease,color .2s ease;cursor:default;user-select:none}',
                'body.tl-blur-errors .tl-err-col:hover{filter:none;color:inherit!important}',

                '#tl-blur-toggle{background:none;border:1.5px solid #d1d5db;color:#d1d5db;border-radius:8px;padding:4px 12px;cursor:pointer;font-size:13px;font-weight:700;display:flex;align-items:center;gap:4px;transition:all .15s}',
                '#tl-blur-toggle:hover{border-color:#3b82f6;color:#3b82f6;background:rgba(59,130,246,0.1)}',
                '#tl-blur-toggle.on{background:#fef3c7;border-color:#f59e0b;color:#92400e}',

                '#tl-hourly-summary{display:none}',
                '.tl-matrix-col{text-align:center!important;font-family:monospace;font-size:13px;color:#cbd5e1;min-width:64px!important;border-left:1px solid rgba(255,255,255,0.08);padding:6px 2px!important}',
                '.tl-hour-label{font-size:13px;font-weight:900;color:#fff!important;margin-bottom:6px;white-space:nowrap;letter-spacing:-0.4px;text-shadow:0 1px 2px rgba(0,0,0,0.8)}',
                '.tl-matrix-col-header{display:inline-flex;flex-direction:column;align-items:center;justify-content:center;padding:4px 2px!important;line-height:1.1;background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.15);border-radius:6px;cursor:pointer;transition:all 0.2s ease;min-width:60px!important;margin:0;position:relative;overflow:hidden;height:32px}',
                '.tl-matrix-col-header span{font-size:14px;color:#000!important;font-weight:900;text-shadow:none!important}',
                '.tl-matrix-col-header.active span{color:#fff!important}',
                '.tl-matrix-col-header:hover{background:rgba(255,255,255,0.15);border-color:#3b82f6}',
                '.tl-matrix-col-header.active{background:#2563eb;border-color:#3b82f6;box-shadow:0 0 12px rgba(37,99,235,0.5)}',
                '.tl-matrix-col-header::after{content:"";position:absolute;inset:0;background:linear-gradient(rgba(255,255,255,0.1),transparent);opacity:0;transition:opacity 0.3s}',
                '.tl-matrix-col-header.active::after{opacity:1}',
                '.tl-matrix-cell{color:#f1f5f9;font-weight:700;border-radius:4px;transition:background 0.3s, color 0.3s}',
                '.tl-matrix-cell.zero{color:rgba(255,255,255,0.03);font-weight:400}',

                '#tl-prod-body tr{opacity:1;transition:opacity 0.2s, transform 0.2s}',
                '#tl-prod-body.updating tr{opacity:0;transform:translateY(4px)}',
                '.tl-row-anim{animation:tl-row-fade-in 0.3s ease-out backwards}',
                '@keyframes tl-row-fade-in{from{opacity:0;transform:translateX(-8px)}to{opacity:1;transform:translateX(0)}}',
                '@keyframes tl-popup-in{from{opacity:0;transform:scale(0.98)}to{opacity:1;transform:scale(1)}}',

                '.tl-morph-target{opacity:1;transition:opacity 0.2s, transform 0.2s}',
                '.tl-morph-target.updating{opacity:0;transform:translateY(4px)}',
            ].join(''));

            var fab = document.createElement('button');
            fab.id = 'tl-prod-fab';
            fab.type = 'button';
            fab.title = 'Produtividade';
            fab.textContent = '👥';
            document.body.appendChild(fab);

            var overlay = document.createElement('div');
            overlay.id = 'tl-prod-overlay';
            document.body.appendChild(overlay);

            var popup = document.createElement('div');
            popup.id = 'tl-prod-popup';

            ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se'].forEach(function (dir) {
                var h = document.createElement('div');
                h.className = 'tl-rh tl-rh-' + dir;
                h.addEventListener('mousedown', function (e) {
                    e.preventDefault(); e.stopPropagation();
                    var r = popup.getBoundingClientRect();
                    popup.style.transform = 'none';
                    popup.style.left = r.left + 'px'; popup.style.top = r.top + 'px';
                    popup.style.width = r.width + 'px'; popup.style.maxHeight = r.height + 'px';
                    var sx = e.clientX, sy = e.clientY, sl = r.left, st = r.top, sw = r.width, sh = r.height;
                    function onMove(ev) {
                        var dx = ev.clientX - sx, dy = ev.clientY - sy;
                        if (dir.includes('e')) popup.style.width = Math.max(400, sw + dx) + 'px';
                        if (dir.includes('s')) popup.style.maxHeight = Math.max(220, sh + dy) + 'px';
                        if (dir.includes('w')) { var w = Math.max(400, sw - dx); popup.style.width = w + 'px'; popup.style.left = (sl + sw - w) + 'px'; }
                        if (dir.includes('n')) { var hh = Math.max(220, sh - dy); popup.style.maxHeight = hh + 'px'; popup.style.top = (st + sh - hh) + 'px'; }
                    }
                    function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }
                    document.addEventListener('mousemove', onMove);
                    document.addEventListener('mouseup', onUp);
                });
                popup.appendChild(h);
            });

            var header = document.createElement('div');
            header.id = 'tl-prod-header';

            var customMode = true;

            header.innerHTML =
                '<div id="tl-prod-header-row">' +
                '<span id="tl-prod-icon">👥</span>' +
                '<span id="tl-prod-title">Produtividade</span>' +
                '<input type="text" id="tl-node-input" value="' + CURRENT_NODE + '" maxlength="10" title="Node ID">' +
                '<span id="tl-prod-status"></span>' +
                '<button id="tl-prod-close" type="button" title="Fechar">✕</button>' +
                '</div>';

            popup.appendChild(header);

            var dragX = 0, dragY = 0, dragging = false;
            header.addEventListener('mousedown', function (e) {
                if (e.target.closest('button') || e.target.closest('.tl-tab') || e.target.closest('input')) return;
                dragging = true;
                var r = popup.getBoundingClientRect();
                popup.style.transform = 'none';
                popup.style.left = r.left + 'px'; popup.style.top = r.top + 'px';
                dragX = e.clientX - r.left; dragY = e.clientY - r.top;
                e.preventDefault();
            });
            document.addEventListener('mousemove', function (e) {
                if (dragging) {
                    popup.style.left = (e.clientX - dragX) + 'px';
                    popup.style.top = (e.clientY - dragY) + 'px';
                }
            });
            document.addEventListener('mouseup', function () { dragging = false; });

            function getDateLimits() {
                var today = new Date();
                var min = new Date(today); min.setDate(today.getDate() - 6);
                var fmt = function (d) { return d.toISOString().slice(0, 10); };
                return { min: fmt(min), max: fmt(today), today: fmt(today) };
            }

            var dl = getDateLimits();

            var customRow = document.createElement('div');
            customRow.id = 'tl-custom-row';
            customRow.className = '';
            customRow.setAttribute('lang', 'pt-BR');
            customRow.innerHTML =
                '<span style="font-size:11px;font-weight:600;color:#6b7280;">De</span>' +
                '<input type="date" id="tl-date-pick" value="' + dl.today + '" min="' + dl.min + '" max="' + dl.max + '">' +
                '<input type="text" id="tl-time-start" value="06:00" placeholder="HH:MM" maxlength="5" style="width:45px; text-align:center; border:1px solid #d1d5db; border-radius:4px; padding:2px 4px; font-size:12px;">' +
                '<span class="tl-arrow">→</span>' +
                '<span style="font-size:11px;font-weight:600;color:#6b7280;">Até</span>' +
                '<input type="date" id="tl-date-pick-end" value="' + dl.today + '" min="' + dl.min + '" max="' + dl.max + '">' +
                '<input type="text" id="tl-time-end" value="18:00" placeholder="HH:MM" maxlength="5" style="width:45px; text-align:center; border:1px solid #d1d5db; border-radius:4px; padding:2px 4px; font-size:12px;">' +
                '<button type="button" id="tl-apply-btn">▶ Aplicar</button>';
            popup.appendChild(customRow);

            var autoBar = document.createElement('div');
            autoBar.id = 'tl-auto-bar';

            var selectOpts = AUTO_INTERVALS.map(function (iv) {
                var sel = iv.ms === autoRefreshInterval ? ' selected' : '';
                return '<option value="' + iv.ms + '"' + sel + '>' + iv.label + '</option>';
            }).join('');

            autoBar.innerHTML =
                '<span id="tl-auto-label">Auto</span>' +
                '<button type="button" id="tl-auto-toggle" class="' + (autoRefreshOn ? 'on' : '') + '" title="Ligar/desligar atualização automática">' +
                '<span class="track"></span><span class="thumb"></span>' +
                '</button>' +
                '<select id="tl-auto-select">' + selectOpts + '</select>' +
                '<span id="tl-auto-countdown"></span>' +
                '<button type="button" id="tl-refresh-btn">↺ Atualizar</button>';
            popup.appendChild(autoBar);

            var goalBar = document.createElement('div');
            goalBar.id = 'tl-goal-bar';
            goalBar.innerHTML =
                '<span id="tl-goal-label">META PKGS/H</span>' +
                '<input type="number" id="tl-goal-input" value="' + goalPph + '" min="1" step="5">' +
                '<span id="tl-goal-unit">pkgs/h</span>' +
                '<div style="flex:1"></div>' +
                '🔍 <input type="text" id="tl-prod-search" placeholder="Procurar associado..." style="width:200px;font-size:12px;padding:6px 10px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:#fff;outline:none;transition:border-color 0.2s">' +
                '<div id="tl-goal-legend">' +
                '<span class="tl-goal-chip" style="background:rgba(21, 128, 61, 0.2);border:1px solid #15803d;color:#4ade80">≥90%</span>' +
                '<span class="tl-goal-chip" style="background:rgba(234, 179, 8, 0.2);border:1px solid #ca8a04;color:#facc15">≥75%</span>' +
                '<span class="tl-goal-chip" style="background:rgba(220, 38, 38, 0.2);border:1px solid #b91c1c;color:#f87171">≥40%</span>' +
                '<span class="tl-goal-chip" style="background:rgba(0, 0, 0, 0.4);border:1px solid #333;color:#999">&lt;40%</span>' +
                '</div>';
            popup.appendChild(goalBar);

            var hourlySummary = document.createElement('div');
            hourlySummary.id = 'tl-hourly-summary';
            hourlySummary.style.display = 'none';
            popup.appendChild(hourlySummary);

            var body = document.createElement('div');
            body.id = 'tl-prod-body';
            body.innerHTML = '<div class="tl-prod-loading">Selecione um período e clique em ↺ Atualizar.</div>';
            popup.appendChild(body);

            var footer = document.createElement('div');
            footer.id = 'tl-prod-footer';
            footer.innerHTML = '<span id="tl-prod-range"></span><span id="tl-prod-total"></span>';
            popup.appendChild(footer);

            document.body.appendChild(popup);

            var popupOpen = false;
            var sortCol = 'successfulScans';
            var sortAsc = false;
            var lastData = [];
            var hourlyData = {};
            var currentSlots = [];
            var selectedHour = 'total';
            var searchQuery = '';

            document.getElementById('tl-prod-search').addEventListener('input', function (e) {
                searchQuery = e.target.value.toLowerCase().trim();
                renderTable();
            });

            function getTimeRange() {

                var startInput = document.getElementById('tl-time-start');
                var endInput = document.getElementById('tl-time-end');
                var datePick = document.getElementById('tl-date-pick');
                var datePickEnd = document.getElementById('tl-date-pick-end');

                var dStart = datePick && datePick.value ? datePick.value : new Date().toISOString().slice(0, 10);
                var dEnd = datePickEnd && datePickEnd.value ? datePickEnd.value : dStart;

                var startMs = new Date(dStart + 'T' + (startInput ? startInput.value : '06:00') + ':00').getTime();
                var endMs = new Date(dEnd + 'T' + (endInput ? endInput.value : '18:00') + ':00').getTime();

                return { start: startMs, end: endMs };
            }

            function stopAutoRefresh() {
                clearInterval(autoRefreshTimer);
                clearInterval(countdownTimer);
                autoRefreshTimer = null;
                countdownTimer = null;
                var cd = document.getElementById('tl-auto-countdown');
                if (cd) cd.textContent = '';
            }

            function startAutoRefresh() {
                stopAutoRefresh();
                nextRefreshAt = Date.now() + autoRefreshInterval;

                autoRefreshTimer = setInterval(function () {
                    nextRefreshAt = Date.now() + autoRefreshInterval;
                    fetchProductivity();
                }, autoRefreshInterval);

                countdownTimer = setInterval(function () {
                    var cd = document.getElementById('tl-auto-countdown');
                    if (!cd) return;
                    var secs = Math.max(0, Math.round((nextRefreshAt - Date.now()) / 1000));
                    var m = String(Math.floor(secs / 60)).padStart(2, '0');
                    var s = String(secs % 60).padStart(2, '0');
                    cd.textContent = m + ':' + s;
                }, 1000);
            }

            function applyAutoRefresh() {
                var toggle = document.getElementById('tl-auto-toggle');
                if (autoRefreshOn) {
                    if (toggle) toggle.classList.add('on');
                    startAutoRefresh();
                } else {
                    if (toggle) toggle.classList.remove('on');
                    stopAutoRefresh();
                }
            }

            function applyBlurErrors() {
                if (blurErrors) document.body.classList.add('tl-blur-errors');
                else document.body.classList.remove('tl-blur-errors');
                var btn = document.getElementById('tl-blur-toggle');
                if (btn) btn.classList.toggle('on', blurErrors);
            }

            GM_addStyle([
                '@keyframes tl-shimmer{0%{background-position:-400px 0}100%{background-position:400px 0}}',
                '.tl-sk{background:linear-gradient(90deg,rgba(255,255,255,0.05) 25%,rgba(255,255,255,0.1) 50%,rgba(255,255,255,0.05) 75%);background-size:800px 100%;animation:tl-shimmer 1.4s infinite linear;border-radius:4px}',
            ].join(''));

            function showSkeleton() {
                var bodyEl = document.getElementById('tl-prod-body');
                if (!bodyEl) return;
                var html = '<table style="width:100%;border-collapse:collapse;table-layout:fixed">' +
                    '<thead><tr>' +
                    '<th style="width:34px;padding:12px 6px"></th>' +
                    '<th style="text-align:left!important;min-width:360px;padding:12px 14px"><div class="tl-sk" style="width:100px;height:12px"></div></th>' +
                    '<th style="width:110px;padding:12px 14px"><div class="tl-sk" style="width:70px;height:35px;border-radius:8px;margin:0 auto"></div></th>' +
                    '<th style="width:100px;padding:12px 14px"><div class="tl-sk" style="width:60px;height:12px;margin:0 auto"></div></th>' +
                    '</tr></thead><tbody>';
                for (var i = 0; i < 12; i++) {
                    var nw = 140 + Math.random() * 100;
                    html += '<tr style="border-bottom:1px solid rgba(255,255,255,0.03)">' +
                        '<td style="padding:14px 6px;text-align:center;width:34px"><div class="tl-sk" style="width:14px;height:10px;margin:0 auto"></div></td>' +
                        '<td style="padding:14px 14px"><div class="tl-sk" style="width:' + nw + 'px;height:14px"></div></td>' +
                        '<td style="padding:14px 14px;text-align:center"><div class="tl-sk" style="width:50px;height:14px;margin:0 auto"></div></td>' +
                        '<td style="padding:14px 14px;text-align:center"><div class="tl-sk" style="width:40px;height:14px;margin:0 auto"></div></td>' +
                        '</tr>';
                }
                html += '</tbody></table>';
                bodyEl.innerHTML = html;
            }

            function fetchProductivity() {
                var nodeInp = document.getElementById('tl-node-input');
                if (nodeInp && nodeInp.value.trim()) CURRENT_NODE = nodeInp.value.trim().toUpperCase();

                showSkeleton();
                var statusEl = document.getElementById('tl-prod-status');
                var bodyEl = document.getElementById('tl-prod-body');
                var summaryEl = document.getElementById('tl-hourly-summary');
                if (statusEl) statusEl.textContent = '⏳ buscando...';

                var range = getTimeRange();
                var start = range.start, end = range.end;

                var slots = [];
                var cursor = new Date(start);
                cursor.setMinutes(0, 0, 0);
                if (cursor.getTime() < start) cursor.setTime(cursor.getTime() + 3600000);

                if (start < cursor.getTime()) {
                    slots.push({ s: start, e: Math.min(cursor.getTime(), end), label: 'Início' });
                }

                while (cursor.getTime() < end) {
                    var next = new Date(cursor.getTime() + 3600000);
                    slots.push({
                        s: cursor.getTime(),
                        e: Math.min(next.getTime(), end),
                        label: cursor.getHours().toString().padStart(2, '0') + ':00'
                    });
                    cursor = next;
                }
                currentSlots = slots.map(function (s) { return s.label; });

                _SUITE.utils.fetchAntiCsrfToken(function (token) {
                    if (!token) return;

                    var totalPayload = {
                        nodeId: CURRENT_NODE, nodeType: 'SC',
                        entity: 'getQualityMetricDetails',
                        metricType: 'PRODUCTIVITY_REPORT',
                        containerTypes: ['PACKAGE'],
                        startTime: start, endTime: end,
                        metricsData: { nodeId: CURRENT_NODE, pageType: 'OUTBOUND', refreshType: '', device: 'DESKTOP', nodeType: 'SC', userAction: 'FAILED_MOVES_SUBMIT_CLICK' }
                    };

                    var tasks = [];
                    tasks.push(new Promise(function (resolve) {
                        GM_xmlhttpRequest({
                            method: 'POST',
                            url: BASE + 'sortcenter/vista/controller/getQualityMetricDetails',
                            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest', 'anti-csrftoken-a2z': token },
                            data: 'jsonObj=' + encodeURIComponent(JSON.stringify(totalPayload)),
                            withCredentials: true,
                            onload: function (r) {
                                try {
                                    var finalUrl = r.finalUrl || '';
                                    if (finalUrl.includes('midway-auth') || finalUrl.includes('/SSO/') || r.status === 401 || r.status === 403) {
                                        _SUITE.antiCsrfToken = '';
                                        if (statusEl) statusEl.textContent = '⚠ sessão expirada';
                                        if (bodyEl) bodyEl.innerHTML = '<div class="tl-prod-error">🔐 <b>Sessão expirada.</b><br><a href="' + location.href + '">Recarregue a página</a> e tente novamente.</div>';
                                        return;
                                    }
                                    var j = JSON.parse(r.responseText);
                                    lastData = (j && j.ret && j.ret.getQualityMetricDetailsOutput && j.ret.getQualityMetricDetailsOutput.qualityMetrics) || [];
                                    resolve();
                                } catch (e) { resolve(); }
                            },
                            onerror: function () { resolve(); }
                        });
                    }));

                    hourlyData = {};
                    if (slots.length > 1) {
                        slots.forEach(function (slot) {
                            tasks.push(new Promise(function (resolve) {
                                var p = {
                                    nodeId: CURRENT_NODE, nodeType: 'SC',
                                    entity: 'getQualityMetricDetails',
                                    metricType: 'PRODUCTIVITY_REPORT',
                                    containerTypes: ['PACKAGE'],
                                    startTime: slot.s, endTime: slot.e,
                                    metricsData: { nodeId: CURRENT_NODE, pageType: 'OUTBOUND', refreshType: '', device: 'DESKTOP', nodeType: 'SC', userAction: 'FAILED_MOVES_SUBMIT_CLICK' }
                                };
                                GM_xmlhttpRequest({
                                    method: 'POST',
                                    url: BASE + 'sortcenter/vista/controller/getQualityMetricDetails',
                                    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest', 'anti-csrftoken-a2z': token },
                                    data: 'jsonObj=' + encodeURIComponent(JSON.stringify(p)),
                                    withCredentials: true,
                                    onload: function (r) {
                                        try {
                                            var j = JSON.parse(r.responseText);
                                            hourlyData[slot.label] = (j && j.ret && j.ret.getQualityMetricDetailsOutput && j.ret.getQualityMetricDetailsOutput.qualityMetrics) || [];
                                        } catch (e) { }
                                        resolve();
                                    },
                                    onerror: function () { resolve(); }
                                });
                            }));
                        });
                    }

                    Promise.all(tasks).then(function () {
                        if (statusEl) statusEl.textContent = '';
                        var fmt = function (ms) { return new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false }); };
                        var rangeEl = document.getElementById('tl-prod-range');
                        if (rangeEl) rangeEl.textContent = fmt(start) + ' → ' + fmt(end);
                        selectedHour = 'total';
                        renderTable();
                    });
                });
            }

            var LOWER_WORDS = { de: 1, da: 1, do: 1, das: 1, dos: 1, e: 1, em: 1 };
            function normalizeName(raw) {
                if (!raw || raw === '—') return raw;
                return raw
                    .split(',').reverse()
                    .map(function (s) { return s.trim(); })
                    .join(' ')
                    .toLowerCase()
                    .replace(/\S+/g, function (word, offset) {
                        if (offset > 0 && LOWER_WORDS[word]) return word;
                        return word.charAt(0).toUpperCase() + word.slice(1);
                    });
            }

            function tierClass(pph) {
                if (!pph || !goalPph) return 'tier-none';
                var ratio = pph / goalPph;
                if (ratio >= 0.90) return 'tier-top';
                if (ratio >= 0.75) return 'tier-good';
                if (ratio >= 0.40) return 'tier-mid';
                return 'tier-low';
            }

            function renderTable() {
                var bodyEl = document.getElementById('tl-prod-body');
                if (!bodyEl) return;
                bodyEl.classList.add('updating');
                setTimeout(function () {
                    executeRender(bodyEl);
                    bodyEl.classList.remove('updating');
                }, 60);
            }

            function executeRender(bodyEl) {
                var pphTotal = 0, pkgTotal = 0, errTotal = 0, workTotal = 0;
                lastData.forEach(function (d) {
                    pkgTotal += (d.successfulScans || 0);
                    errTotal += (d.errorScans || 0);
                    workTotal += (d.workInSeconds || 0);
                });

                // Pre-index hourly data for Matrix lookup
                var hourlyMaps = {};
                currentSlots.forEach(function (h) {
                    hourlyMaps[h] = {};
                    (hourlyData[h] || []).forEach(function (r) {
                        hourlyMaps[h][r.login || r.userLogin || r.userName] = r;
                    });
                });

                var totalsPerSlot = {};
                var maxSlotVol = 0;
                var minSlotVol = Infinity;

                currentSlots.forEach(function (h) {
                    var vol = 0;
                    Object.values(hourlyMaps[h]).forEach(function (r) { vol += (r.successfulScans || 0); });
                    totalsPerSlot[h] = vol;
                    if (vol > maxSlotVol) maxSlotVol = vol;
                    if (vol < minSlotVol) minSlotVol = vol;
                });

                function getHeatColor(val) {
                    if (maxSlotVol === minSlotVol) return 'rgba(56, 189, 248, 0.4)';
                    // Usar escala não-linear para maior distinção entre picos
                    var ratio = Math.pow((val - minSlotVol) / (maxSlotVol - minSlotVol), 1.2);
                    var hue = ratio * 125;
                    return 'hsla(' + hue + ', 90%, 38%, 1)';
                }

                function getTierColor(pph) {
                    if (!pph || !goalPph) return 'transparent';
                    var ratio = pph / goalPph;
                    if (ratio >= 0.90) return 'hsla(142, 69%, 36%, 1)'; // Verde (Ex-Azul)
                    if (ratio >= 0.75) return 'hsla(48, 96%, 43%, 1)';  // Amarelo (Ex-Verde)
                    if (ratio >= 0.40) return 'hsla(0, 72%, 41%, 1)';   // Vermelho (Ex-Amarelo)
                    return 'hsla(0, 0%, 10%, 1)';                      // Preto (Ex-Vermelho)
                }

                var html = '<table><thead><tr>' +
                    '<th style="width:34px">#</th>' +
                    '<th style="text-align:left!important;min-width:360px">ASSOCIADO</th>' +
                    '<th style="width:70px;vertical-align:bottom;padding-bottom:12px">' +
                    '<div class="tl-matrix-col-header ' + (selectedHour === 'total' ? 'active' : '') + '" data-hour="total" style="height:54px;justify-content:center;background:#1e40af;border-color:#3b82f6">' +
                    '<span style="font-size:10px;opacity:0.9;font-weight:800;color:rgba(255,255,255,0.8);text-shadow:none">TOTAL</span>' +
                    '<span style="font-size:17px;font-weight:900;color:#fff;text-shadow:none">' + pkgTotal.toLocaleString('pt-BR') + '</span>' +
                    '</div>' +
                    '</th>' +
                    '<th style="width:100px">Rating</th>';

                if (selectedHour === 'total' && currentSlots.length > 0) {
                    currentSlots.forEach(function (h) {
                        var vol = totalsPerSlot[h];
                        var bg = getHeatColor(vol);
                        var startH = h.split(':')[0];
                        var endH = (parseInt(startH, 10) + 1).toString().padStart(2, '0');
                        var label = startH + 'h->' + endH + 'h';

                        html += '<th class="tl-matrix-col">' +
                            '<div class="tl-hour-label">' + label + '</div>' +
                            '<div class="tl-matrix-col-header ' + (selectedHour === h ? 'active' : '') + '" data-hour="' + h + '" style="background:' + bg + ';border-color:rgba(255,255,255,0.3);box-shadow:inset 0 1px 0 rgba(255,255,255,0.1)">' +
                            '<span>' + vol.toLocaleString('pt-BR') + '</span>' +
                            '</div>' +
                            '</th>';
                    });
                }

                var winners = { total: 0 };
                currentSlots.forEach(function (h) { winners[h] = 0; });

                lastData.forEach(function (d) {
                    var login = d.login || d.userLogin || d.userName;
                    var total = d.successfulScans || 0;
                    if (total > winners.total) winners.total = total;

                    currentSlots.forEach(function (h) {
                        var hr = hourlyMaps[h][login];
                        var pkgs = hr ? (hr.successfulScans || 0) : 0;
                        if (pkgs > winners[h]) winners[h] = pkgs;
                    });
                });

                html += '</tr></thead><tbody>';

                var sorted = lastData.slice().filter(function (d) {
                    if (!searchQuery) return true;
                    var name = (d.userName || '').toLowerCase();
                    var login = (d.login || d.userLogin || '').toLowerCase();
                    return name.includes(searchQuery) || login.includes(searchQuery);
                }).sort(function (a, b) {
                    var ka = sortCol;
                    if (ka === 'userName') {
                        var va = (a.userName || '').toLowerCase(), vb = (b.userName || '').toLowerCase();
                        return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
                    }
                    var va = Number(a[ka]) || 0, vb = Number(b[ka]) || 0;
                    return sortAsc ? va - vb : vb - va;
                });

                sorted.forEach(function (d, i) {
                    var login = d.login || d.userLogin || d.userName;
                    var name = normalizeName(d.userName || login);

                    var totalPkgs = d.successfulScans || 0;
                    var totalErr = d.errorScans || 0;
                    var totalWork = d.workInSeconds || 0;

                    var shownPkgs = totalPkgs;
                    var shownErr = totalErr;
                    var shownWork = totalWork;
                    var isFilteredOut = false;

                    if (selectedHour !== 'total') {
                        var hr = (hourlyMaps[selectedHour] && hourlyMaps[selectedHour][login]);
                        if (!hr) {
                            isFilteredOut = true;
                        } else {
                            shownPkgs = hr.successfulScans || 0;
                            shownErr = hr.errorScans || 0;
                            shownWork = hr.workInSeconds || 0;
                        }
                    }

                    if (!isFilteredOut) {
                        var pph = shownWork > 0 ? Math.round(shownPkgs / (shownWork / 3600)) : (shownPkgs > 0 ? shownPkgs : null);
                        var pphCell = pph !== null
                            ? '<td class="td-pph" style="background:' + getTierColor(pph) + ';color:#fff;font-weight:900;text-shadow:0 1px 2px rgba(0,0,0,0.5)">' + pph.toLocaleString('pt-BR') + '</td>'
                            : '<td class="td-na">—</td>';

                        var errCell = shownErr > 0
                            ? '<td class="td-err tl-err-col">' + shownErr + '</td>'
                            : '<td class="td-num tl-err-col" style="color:#64748b">0</td>';

                        var delay = Math.min(i * 12, 220);
                        var totalPct = winners.total > 0 ? (shownPkgs / winners.total) * 100 : 0;
                        var totalStyle = 'font-weight:900;color:#fff;font-size:15px;position:relative;background:linear-gradient(90deg, rgba(59, 130, 246, 0.25) ' + totalPct + '%, transparent ' + totalPct + '%)';

                        html += '<tr class="tl-row-anim" style="animation-delay:' + delay + 'ms">' +
                            '<td style="color:#64748b;font-size:12px;width:34px">' + (i + 1) + '</td>' +
                            '<td class="td-label">' +
                            '<div style="display:flex;align-items:center;min-width:340px;gap:15px">' +
                            '<span>' + name + '</span>' +
                            '</div>' +
                            '</td>' +
                            '<td class="td-num" style="' + totalStyle + '">' +
                            shownPkgs.toLocaleString('pt-BR') + (shownPkgs > 0 && shownPkgs === winners.total ? ' <span title="Melhor Total" style="filter:drop-shadow(0 0 2px gold)">🥇</span>' : '') +
                            '</td>' +
                            pphCell;

                        if (selectedHour === 'total' && currentSlots.length > 0) {
                            currentSlots.forEach(function (h) {
                                var slotRec = hourlyMaps[h][login];
                                var slotPkgs = slotRec ? (slotRec.successfulScans || 0) : 0;
                                var slotSecs = slotRec ? (slotRec.workInSeconds || 0) : 0;
                                var slotPph = slotSecs > 0 ? Math.round(slotPkgs / (slotSecs / 3600)) : (slotPkgs > 0 ? slotPkgs : null);

                                var cellBg = slotPkgs > 0 ? getTierColor(slotPph) : 'transparent';
                                var isWinner = slotPkgs > 0 && slotPkgs === winners[h];
                                var cellShadow = slotPkgs > 0 ? 'text-shadow:0 1px 2px rgba(0,0,0,0.5);font-weight:800;color:#fff' : 'color:rgba(255,255,255,0.05)';
                                var winnerEmoji = isWinner ? '<span style="display:inline-block;margin-left:2px;filter:drop-shadow(0 0 2px gold)">🥇</span>' : '';
                                html += '<td class="tl-matrix-col tl-matrix-cell" style="background:' + cellBg + ';' + cellShadow + '">' + (slotPkgs > 0 ? slotPkgs.toLocaleString('pt-BR') + winnerEmoji : '0') + '</td>';
                            });
                        }
                        html += '</tr>';
                    }
                });

                html += '</tbody></table>';
                bodyEl.innerHTML = html;

                var totalEl = document.getElementById('tl-prod-total');
                if (totalEl) totalEl.textContent = sorted.length + ' associados · ' + pkgTotal.toLocaleString('pt-BR') + ' pkgs';

                bodyEl.querySelectorAll('thead th').forEach(function (th) {
                    th.addEventListener('click', function (e) {
                        var badge = e.target.closest('.tl-matrix-col-header');
                        if (badge) {
                            e.stopPropagation();
                            selectedHour = badge.dataset.hour;
                            renderTable();
                            return;
                        }
                        var col = th.dataset.col;
                        if (col) {
                            if (sortCol === col) sortAsc = !sortAsc;
                            else { sortCol = col; sortAsc = (col === 'userName' || col === 'rank'); }
                            renderTable();
                        }
                    });
                });
            }

            var lastSorted = [];

            function openPopup() {
                popupOpen = true;
                overlay.classList.add('open');
                popup.style.display = 'flex';
                popup.style.animation = 'tl-popup-in .2s ease-out';
                if (!lastData.length) fetchProductivity();
                applyAutoRefresh();
            }

            function closePopup() {
                popupOpen = false;
                overlay.classList.remove('open');
                popup.style.display = 'none';
            }

            popup.addEventListener('click', function (e) { e.stopPropagation(); });
            popup.addEventListener('mousedown', function (e) { e.stopPropagation(); });

            fab.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); });
            fab.addEventListener('click', function (e) {
                e.preventDefault(); e.stopPropagation();
                if (popupOpen) closePopup(); else openPopup();
            });
            overlay.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); closePopup(); });
            document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && popupOpen) closePopup(); });

            setTimeout(function () {

                var closeBtn = document.getElementById('tl-prod-close');
                if (closeBtn) closeBtn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); closePopup(); });

                var refreshBtn = document.getElementById('tl-refresh-btn');
                if (refreshBtn) refreshBtn.addEventListener('click', function (e) {
                    e.preventDefault(); e.stopPropagation();
                    _SUITE.antiCsrfToken = '';
                    fetchProductivity();
                    if (autoRefreshOn) {
                        stopAutoRefresh();
                        startAutoRefresh();
                    }
                });



                var applyBtn = document.getElementById('tl-apply-btn');
                if (applyBtn) applyBtn.addEventListener('click', function (e) {
                    e.preventDefault(); e.stopPropagation();
                    fetchProductivity();
                });

                function applyTimeMask(el) {
                    if (!el) return;
                    el.addEventListener('input', function () {
                        var v = this.value.replace(/\D/g, '');
                        if (v.length > 2) this.value = v.substring(0, 2) + ':' + v.substring(2, 4);
                        else this.value = v;
                    });
                    el.addEventListener('blur', function () {
                        if (!/^([0-1]\d|2[0-3]):([0-5]\d)$/.test(this.value)) {
                            this.value = this.id === 'tl-time-start' ? '06:00' : '18:00';
                        }
                    });
                }
                applyTimeMask(document.getElementById('tl-time-start'));
                applyTimeMask(document.getElementById('tl-time-end'));

                var nodeInput = document.getElementById('tl-node-input');
                if (nodeInput) {
                    nodeInput.addEventListener('change', function () {
                        var v = nodeInput.value.trim().toUpperCase();
                        if (v) {
                            CURRENT_NODE = v;
                            GM_setValue('tl_node', CURRENT_NODE);
                            _SUITE.antiCsrfToken = '';
                        }
                        nodeInput.value = CURRENT_NODE;
                    });
                }

                var datePick = document.getElementById('tl-date-pick');
                var datePickEnd = document.getElementById('tl-date-pick-end');
                if (datePick || datePickEnd) {
                    var dl2 = getDateLimits();
                    if (datePick) { datePick.min = dl2.min; datePick.max = dl2.max; }
                    if (datePickEnd) { datePickEnd.min = dl2.min; datePickEnd.max = dl2.max; }
                }

                var goalInp = document.getElementById('tl-goal-input');
                if (goalInp) goalInp.addEventListener('input', function () {
                    var v = parseInt(this.value);
                    if (v > 0) {
                        goalPph = v;
                        GM_setValue('tl_goal_pph', goalPph);
                        // Debounce renderTable to avoid flicker while typing
                        if (this._timer) clearTimeout(this._timer);
                        this._timer = setTimeout(function () {
                            if (lastData.length) renderTable();
                        }, 500);
                    }
                });

                var toggle = document.getElementById('tl-auto-toggle');
                if (toggle) toggle.addEventListener('click', function (e) {
                    e.preventDefault(); e.stopPropagation();
                    autoRefreshOn = !autoRefreshOn;
                    GM_setValue('tl_auto_on', autoRefreshOn);
                    applyAutoRefresh();
                });

                var blurBtn = document.getElementById('tl-blur-toggle');
                if (blurBtn) blurBtn.addEventListener('click', function (e) {
                    e.preventDefault(); e.stopPropagation();
                    blurErrors = !blurErrors;
                    GM_setValue('tl_blur_errors', blurErrors);
                    applyBlurErrors();
                });

                function applyProdTimeMask(inputEl) {
                    if (!inputEl) return;
                    inputEl.addEventListener('input', function () {
                        let v = this.value.replace(/\D/g, '');
                        if (v.length > 2) this.value = v.substring(0, 2) + ':' + v.substring(2, 4);
                        else this.value = v;
                    });
                    inputEl.addEventListener('blur', function () {
                        if (this.value && !/^([0-1]\d|2[0-3]):([0-5]\d)$/.test(this.value)) {

                            if (this.value.length > 5) this.value = "12:00";
                        }
                    });
                }
                applyProdTimeMask(document.getElementById('tl-time-start'));
                applyProdTimeMask(document.getElementById('tl-time-end'));

                var sel = document.getElementById('tl-auto-select');
                if (sel) sel.addEventListener('change', function () {
                    autoRefreshInterval = parseInt(sel.value);
                    GM_setValue('tl_auto_ms', autoRefreshInterval);
                    if (autoRefreshOn) {
                        stopAutoRefresh();
                        startAutoRefresh();
                    }
                });

            }, 0);

            popup.style.display = 'none';

            if (autoRefreshOn) {
                setTimeout(function () { applyAutoRefresh(); }, 100);
            }

            if (blurErrors) applyBlurErrors();

        })();
    });

    var updateFabVisibility = function () {
        const panels = [
            document.getElementById('tl-dock-view-panel'),
            document.getElementById('tl-v5-popup'),
            document.getElementById('tl-prod-popup'),
            document.getElementById('vl-panel')
        ];

        const anyOpen = panels.some(function (p) {
            if (!p) return false;
            // Checagem universal e imune a CSS complexo: 
            // se o elemento ou seu pai imediato estiver display:none, offsetWidth é 0.
            return p.isConnected && p.offsetWidth > 0 && p.offsetHeight > 0;
        });

        let fabLeft = document.getElementById('tl-fab-left');
        if (!fabLeft) {
            fabLeft = document.createElement('div');
            fabLeft.id = 'tl-fab-left';
            fabLeft.style.cssText = 'position:fixed; bottom:24px; left:24px; display:flex; gap:14px; align-items:center; z-index:2147483646; transition:opacity 0.3s ease, transform 0.3s ease; transform-origin:bottom left;';
            document.body.appendChild(fabLeft);
        }

        let fabRight = document.getElementById('tl-fab-right');
        if (!fabRight) {
            fabRight = document.createElement('div');
            fabRight.id = 'tl-fab-right';
            fabRight.style.cssText = 'position:fixed; bottom:24px; right:24px; display:flex; gap:14px; align-items:center; flex-wrap:wrap; justify-content:flex-end; z-index:2147483646; transition:opacity 0.3s ease, transform 0.3s ease; transform-origin:bottom right;';
            document.body.appendChild(fabRight);
        }

        const btnLeft = [
            document.getElementById('tl-v5-fab'),
            document.getElementById('tl-prod-fab')
        ];

        const btnRight = [
            document.getElementById('vl-toggle'),
            document.getElementById('ob-dock-view-toggle')
        ];

        function assignBtns(btns, container) {
            btns.forEach(function (btn) {
                if (btn && btn.parentElement !== container) {
                    btn.style.position = 'static';
                    btn.style.bottom = 'auto';
                    btn.style.right = 'auto';
                    btn.style.left = 'auto';
                    btn.style.margin = '0';
                    btn.style.transition = '';
                    btn.style.transform = '';
                    btn.style.opacity = '';
                    btn.style.pointerEvents = '';
                    container.appendChild(btn);
                }
            });
        }

        assignBtns(btnLeft, fabLeft);
        assignBtns(btnRight, fabRight);

        if (anyOpen) {
            fabLeft.style.opacity = '0';
            fabLeft.style.pointerEvents = 'none';
            fabLeft.style.transform = 'scale(0.85) translateY(10px)';
            fabRight.style.opacity = '0';
            fabRight.style.pointerEvents = 'none';
            fabRight.style.transform = 'scale(0.85) translateY(10px)';
        } else {
            fabLeft.style.opacity = '1';
            fabLeft.style.pointerEvents = 'auto';
            fabLeft.style.transform = 'scale(1) translateY(0)';
            fabRight.style.opacity = '1';
            fabRight.style.pointerEvents = 'auto';
            fabRight.style.transform = 'scale(1) translateY(0)';
        }
    };

    // Replace 300ms interval with a MutationObserver to react only when it matters
    var _tlFabObserver = new MutationObserver(function (mutations) {
        // Debounce slightly to avoid triggering 100 times during an animation
        if (_tlFabObserver._timer) clearTimeout(_tlFabObserver._timer);
        _tlFabObserver._timer = setTimeout(updateFabVisibility, 50);
    });

    _tlFabObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class']
    });

    // Initial evaluation
    setTimeout(updateFabVisibility, 500);

})();
