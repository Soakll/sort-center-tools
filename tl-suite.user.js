// ==UserScript==
// @name         TL All-in-One Suite
// @namespace    http://tampermonkey.net/
// @version      1.1.10
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
// @updateURL    https://raw.githubusercontent.com/Soakll/sort-center-tools/main/tl-suite.user.js
// @downloadURL  https://raw.githubusercontent.com/Soakll/sort-center-tools/main/tl-suite.user.js
// ==/UserScript==
(function () {
    'use strict';

    const VERSION = "1.1.10";
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

    (function loadModuleVridInfo() {
        if (!_SUITE.isDock && !_SUITE.isYMS && !_SUITE.isRTT && !_SUITE.isVista) return;
        'use strict';

        var _openObPanel = null;

        var _openIbPanel = null;

        const href = location.href;
        const isVista = href.includes('/sortcenter/flowrate');
        const isOutbound = href.includes('/ssp/dock/hrz/ob');
        const isIB = href.includes('/ssp/dock/hrz/ib');
        const isYMS = location.hostname === 'trans-logistics.amazon.com' && location.pathname.includes('/yms/');
        const isRTT = location.hostname === 'track.relay.amazon.dev';

        if (isYMS) {
            try {
                let t = window.ymsSecurityToken || (typeof ymsSecurityToken !== 'undefined' ? ymsSecurityToken : '');
                if (!t && window.ymsStaticAssetsBaseUrl) {
                    const m = window.ymsStaticAssetsBaseUrl.match(/"([^"]{50,})"/);
                    if (m) t = m[1];
                }
                if (t && t.length > 20) {
                    GM_setValue('yms_token', t);
                    GM_setValue('yms_token_ts', Date.now());
                    _SUITE.ymsToken = t;
                }
            } catch (e) { }
        }
        const isDock = isOutbound || isIB;

        const CURRENT_NODE = _SUITE.utils.detectNode();

        var BASE = _SUITE.BASE;

        var MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
        var MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

        var fetchTokenFallback = _SUITE.utils.fetchAntiCsrfToken;

        function getLocationTimestamps() {
            var locs = [], now = new Date();
            var today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
            for (var i = -4; i <= 4; i++) locs.push((today.getTime() + i * 86400000) + ':LOADED');
            return locs;
        }

        function fetchContainerIds(token, lane, destination, callback) {
            var containerTypes = ['BAG', 'GAYLORD', 'PALLET'];
            var businessTypes = ['EMPTY', 'TRANSSHIPMENT'];

            var stackingFilters = /^[A-Z0-9]+-(B|BUS)$/i.test(destination)
                ? [destination]
                : destination.split('-').filter(function (p) { return p.length > 0; });
            var filterCriteria = [];
            stackingFilters.forEach(function (sf) {
                containerTypes.forEach(function (ct) {
                    businessTypes.forEach(function (bt) {
                        filterCriteria.push({ nodeId: CURRENT_NODE, container_type: ct, stacking_filter: sf, business_type: bt, is_enclosed: 'false' });
                    });
                });
            });
            var payload = {
                filterCriteria: filterCriteria,
                nodeId: CURRENT_NODE,
                segmentId: 'COMPOUND_CONTAINERS',
                locationGroups: { NON_DEPARTED: { locations: getLocationTimestamps(), filterInWindow: null } },
                lane: lane,
                containerTypes: containerTypes,
                adhoc: true,
                entity: 'getContainerIds'
            };
            GM_xmlhttpRequest({
                method: 'POST',
                url: BASE + 'sortcenter/vista/controller/getContainerIds',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest', 'anti-csrftoken-a2z': token },
                data: 'jsonObj=' + encodeURIComponent(JSON.stringify(payload)),
                withCredentials: true,
                onload: function (resp) {
                    var ids = [];
                    try {
                        var json = JSON.parse(resp.responseText);
                        var entities = (json.ret && json.ret.getContainerIdsOutput && json.ret.getContainerIdsOutput.entities) || [];
                        entities.forEach(function (e) { ids.push(e.entityId); });
                    } catch (e) { }
                    callback(ids);
                },
                onerror: function () { callback([]); }
            });
        }

        function fetchContainerDetails(token, ids, callback) {
            var chunks = [], allDetails = {};
            for (var i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
            if (!chunks.length) { callback({}); return; }
            var pending = chunks.length;
            chunks.forEach(function (chunk) {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: BASE + 'sortcenter/vista/controller/getContainerDetails',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest', 'anti-csrftoken-a2z': token },
                    data: 'jsonObj=' + encodeURIComponent(JSON.stringify({ nodeId: CURRENT_NODE, containerIds: chunk, entity: 'getContainersDetail' })),
                    withCredentials: true,
                    onload: function (resp) {
                        try {
                            var json = JSON.parse(resp.responseText);
                            var map = (json.ret && json.ret.getContainersDetailOutput && json.ret.getContainersDetailOutput.containerDetailMap) || {};
                            Object.keys(map).forEach(function (k) { allDetails[k] = map[k]; });
                        } catch (e) { }
                        if (--pending === 0) callback(allDetails);
                    },
                    onerror: function () { if (--pending === 0) callback(allDetails); }
                });
            });
        }

        function cm3ToFt3(cm3) {
            return (cm3 * 0.0000353147).toFixed(2);
        }

        var BUS_WHITELIST = ['DRJ3', 'SRP9', 'SFC9', 'STJ9', 'SJO9'];

        function normalizeDestination(dest) {
            var m = dest.match(/^([A-Z0-9]+)-BUS$/i);
            if (!m) return dest;
            return BUS_WHITELIST.indexOf(m[1].toUpperCase()) !== -1 ? dest : m[1] + '-B';
        }

        function laneToDestination(lane) {
            var parts = lane.split('->');
            return normalizeDestination((parts[1] || lane).trim());
        }

        const SETTINGS = {
            theme: GM_getValue('rd_theme', 'light'),
            lang: GM_getValue('rd_lang', 'pt'),
        };
        function saveSetting(key, val) { SETTINGS[key] = val; GM_setValue('rd_' + key, val); }

        const LANG_STRINGS = {
            pt: {

                total: '📦 Total',
                tabRemaining: '🔄 Restante',
                xdock: '🔀 X-Dock',
                cptPriority: '📅 Prioridade CPT',
                byPallet: '📦 Por Pallet',
                byCpt: '📅 Por CPT',

                settingsTitle: '⚙️ Configurações',
                themeLabel: 'Tema',
                themeLight: '☀️ Claro',
                themeDark: '🌙 Escuro',
                langLabel: 'Idioma',
                saveClose: '✓ Salvar e Fechar',

                pkgs: 'pkgs',
                restantes: 'restantes',
                xdockRemain: 'X-Dock restante',
                routes: 'rotas',
                trucks: 'caminhões',
                packages: 'pacotes',

                cuft: '📦',
                arrival: 'Chegada',
                delay: '⚠ Atraso',
                docking: 'Docagem',
                dockDoors: 'Doca',
                ibStarted: 'Inicio do Descarregamento',
                ibDone: 'Finalização do Descarregamento',
                obStarted: 'Inicio do Carregamento',
                obDone: 'Finalização do Carregamento',
                checkout: 'Liberação',
                late: '🚨 Atrasado',
                sat: 'SAT',

                getInfo: 'Info',
                routesBtn: '📊 Rotas',
                routesDone: '📊 Rotas',
                concluded: '✓ Concluído',

                checkInLabel: 'Chegada (Check-In)',
                arrivalDelayLabel: 'Atraso na Chegada',
                tdrDockLabel: 'Docagem (TDR-Dock)',
                dockDoorsLabel: 'Doca(s)',
                ibStartedLabel: 'Início do Descarregamento',
                ibDoneLabel: 'Finalização do Descarregamento',
                obStartedLabel: 'Início do Carregamento',
                obDoneLabel: 'Finalização do Carregamento',
                checkoutLabel: 'Liberação (Check-Out)',
                lateDepartureLabel: 'Atraso na Saída',
                cubeLabel: 'Cube (ft³/pkg)',

                fetchingYms: '⏳ Buscando dados YMS...',
                fetchingContainers: '⏳ Buscando containers...',
                fetchingRoutes: '⏳ Lendo distribuição de rotas...',
                analyzingPkgs: '⏳ Analisando pacotes...',
                scanningPages: 'Escaneando páginas...',
                runningExport: 'Executando Rotas + Busca de Info...',
                generatingXlsx: 'Gerando XLSX...',
                fetchingAllInfo: 'Buscando info de todos os VRIDs...',

                noYmsData: '⚠ Nenhum dado YMS encontrado.',
                noData: 'Sem dados disponíveis.',
                noContainersFound: 'Nenhum container encontrado.',
                noContainersDock: 'Nenhum container nesta doca.',
                noContainersLane: 'Nenhum container encontrado para essa lane.',
                noContainersLoaded: 'Sem containers carregados ainda',
                afterRelease: 'Disponível após liberação do caminhão',
                waitingPackages: 'Aguardando carregamento dos pacotes...',
                routeError: '⚠ Erro ao ler distribuição de rotas.',
                networkError: '⚠ Erro de rede',
                tokenNotFound: '❌ Token não encontrado. Interaja com a página primeiro.',
                parseError: '⚠ Parse error',

                cptExpired: 'CPT Expirado 🚨',
                onTime: '✓ On time',
                lastHour: '⏰ Última hora',
                lateLabel: '🚨 Late',
                earlyLabel: '📅 Adiantado',
                latePkgsWord: 'atrasados',
                earlyPkgsWord: 'adiantados',
                onTimeTitle: 'Pacotes dentro da janela normal (CPT entre SAT e SAT+24h)',
                lateTitle: 'Pacotes cujo CPT é anterior à chegada do caminhão — clique para expandir',
                earlyTitle: 'Pacotes cujo CPT é mais de 24h após a chegada do caminhão — clique para expandir',
                noCptFound: 'Nenhum CPT encontrado.',
                noPalletFound: 'Nenhum pallet encontrado.',

                updatedAt: 'Atualizado',
                containerIn: 'container(s) em',
                docksWord: 'doca(s)',
                ibBarLabel: 'IB Routes:',
                obBarLabel: 'OB:',

                checkUpdates: 'Verificar atualizações',
                versionLabel: 'Versão',
                lastUpdateLabel: 'Última atualização',

                vistaLoading: 'Carregando...',
                vistaSearching: '⏳ Buscando dados...',
                showExpired: '👁 Mostrar expirados',
                hideExpired: '🙈 Ocultar expirados',
            },
            en: {
                total: '📦 Total',
                tabRemaining: '🔄 Remaining',
                xdock: '🔀 X-Dock',
                cptPriority: '📅 CPT Priority',
                byPallet: '📦 Por Pallet',
                byCpt: '📅 Por CPT',
                settingsTitle: '⚙️ Settings',
                themeLabel: 'Theme',
                themeLight: '☀️ Light',
                themeDark: '🌙 Dark',
                langLabel: 'Language',
                saveClose: '✓ Save & Close',
                pkgs: 'pkgs',
                restantes: 'remaining',
                xdockRemain: 'X-Dock remaining',
                routes: 'routes',
                trucks: 'trucks',
                packages: 'packages',
                cuft: '📦',
                arrival: 'Arrival',
                delay: '⚠ Delay',
                docking: 'Docking',
                dockDoors: 'Dock',
                ibStarted: 'Started Unloading',
                ibDone: 'Done Unloading',
                obStarted: 'Started Loading',
                obDone: 'Done Loading',
                checkout: 'Release',
                late: '🚨 Late',
                sat: 'SAT',
                getInfo: 'Info',
                routesBtn: '📊 Routes',
                routesDone: '📊 Routes',
                concluded: '✓ Done',
                checkInLabel: 'Arrival (Check-In)',
                arrivalDelayLabel: 'Arrival Delay',
                tdrDockLabel: 'Docking (TDR-Dock)',
                dockDoorsLabel: 'Dock(s)',
                ibStartedLabel: 'Started Unloading',
                ibDoneLabel: 'Done Unloading',
                obStartedLabel: 'Started Loading',
                obDoneLabel: 'Done Loading',
                checkoutLabel: 'Release (Check-Out)',
                lateDepartureLabel: 'Departure Delay',
                cubeLabel: 'Cube (ft³/pkg)',
                fetchingYms: '⏳ Fetching YMS data...',
                fetchingContainers: '⏳ Fetching containers...',
                fetchingRoutes: '⏳ Reading route distribution...',
                analyzingPkgs: '⏳ Analyzing packages...',
                scanningPages: 'Scanning pages...',
                runningExport: 'Running All Routes + Fetch All Info...',
                generatingXlsx: 'Generating XLSX...',
                fetchingAllInfo: 'Fetching Get Info for all VRIDs...',
                noYmsData: '⚠ No YMS data found.',
                noData: 'No data available.',
                noContainersFound: 'No containers found.',
                noContainersDock: 'No containers in this dock.',
                noContainersLane: 'No containers found for this lane.',
                noContainersLoaded: 'No containers loaded yet',
                afterRelease: 'Available after truck release',
                waitingPackages: 'Waiting for package data...',
                routeError: '⚠ Error reading route distribution.',
                networkError: '⚠ Network error',
                tokenNotFound: '❌ Token not found. Interact with the page first.',
                parseError: '⚠ Parse error',
                cptExpired: 'CPT Expired 🚨',
                onTime: '✓ On time',
                lastHour: '⏰ Last hour',
                lateLabel: '🚨 Late',
                earlyLabel: '📅 Early',
                latePkgsWord: 'late',
                earlyPkgsWord: 'early',
                onTimeTitle: 'Packages within normal window (CPT between SAT and SAT+24h)',
                lateTitle: 'Packages whose CPT is before truck arrival — click to expand',
                earlyTitle: 'Packages whose CPT is more than 24h after truck arrival — click to expand',
                noCptFound: 'No CPT found.',
                noPalletFound: 'No pallets found.',
                updatedAt: 'Updated',
                containerIn: 'container(s) in',
                docksWord: 'dock(s)',
                ibBarLabel: 'IB Routes:',
                obBarLabel: 'OB:',
                checkUpdates: 'Check for updates',
                versionLabel: 'Version',
                lastUpdateLabel: 'Last update',
                vistaLoading: 'Loading...',
                vistaSearching: '⏳ Searching...',
                showExpired: '👁 Show expired',
                hideExpired: '🙈 Hide expired',
            },
        };
        function L(key) { return (LANG_STRINGS[SETTINGS.lang] || LANG_STRINGS.pt)[key] || key; }

        const styleEl = document.createElement('style');
        styleEl.textContent = `
        .tl-btn {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 3px 10px;
            border: none;
            border-radius: 20px;
            font-size: 11px;
            font-family: 'Amazon Ember', Arial, sans-serif;
            font-weight: 700;
            letter-spacing: 0.3px;
            cursor: pointer;
            vertical-align: middle;
            white-space: nowrap;
            transition: filter 0.15s ease, transform 0.1s ease, box-shadow 0.15s ease;
            box-shadow: 0 1px 3px rgba(0,0,0,0.2);
            line-height: 1.6;
        }
        .tl-btn:hover:not(:disabled) {
            filter: brightness(1.12);
            transform: translateY(-1px);
            box-shadow: 0 3px 7px rgba(0,0,0,0.25);
        }
        .tl-btn:active:not(:disabled) { transform: translateY(0px); filter: brightness(0.95); }
        .tl-btn:disabled { cursor: default; opacity: 0.85; }
        .tl-btn-orange  { background: #c47000 !important; color: #fff !important; border: none !important; }
        .tl-btn-blue    { background: #0d47a1 !important; color: #fff !important; border: none !important; }
        .tl-btn-red     { background: #c0392b !important; color: #fff !important; border: none !important; }
        .tl-btn-gray    { background: #555    !important; color: #fff !important; border: none !important; }
        .tl-btn-green   { background: #2e7d32 !important; color: #fff !important; border: none !important; }
        .tl-btn-purple  { background: #6a1b9a !important; color: #fff !important; border: none !important; }
        .tl-split-wrap  { display: inline-flex; vertical-align: middle; margin-left: 6px; }
        .tl-split-main  { border-radius: 20px 0 0 20px !important; }
        .tl-split-refresh {
            border-radius: 0 20px 20px 0 !important;
            border-left: 1px solid rgba(0,0,0,0.18) !important;
            padding: 3px 9px !important;
            font-size: 13px !important;
        }
        .tl-badge-row {
            display: flex;
            flex-wrap: wrap;
            gap: 5px;
            margin-bottom: 10px;
            padding: 8px;
            background: rgba(0,0,0,0.04);
            border-radius: 8px;
            border: 1px solid rgba(0,0,0,0.07);
        }
        .tl-vista-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: #FF9900;
            color: #1a1200;
            font-size: 11px;
            font-weight: 700;
            font-family: 'Amazon Ember', Arial, sans-serif;
            padding: 3px 11px;
            border-radius: 20px;
            box-shadow: 0 1px 4px rgba(0,0,0,0.2);
            white-space: nowrap;
        }
        .tl-vista-badge .tl-dock-name { opacity: 0.6; font-weight: 600; font-size: 10px; }
        .tl-vista-badge .tl-dock-val  { font-size: 12px; }
        .tl-info-card {
            display: inline-flex;
            flex-wrap: wrap;
            gap: 3px;
            align-items: center;
            vertical-align: middle;
            margin-right: 4px;
            max-width: 600px;
        }
        .tl-info-row { display: contents; }
        .tl-chip {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 2px 9px;
            border-radius: 20px;
            font-size: 10.5px;
            font-weight: 700;
            font-family: 'Amazon Ember', Arial, sans-serif;
            white-space: nowrap;
            line-height: 1.7;
            box-shadow: 0 1px 3px rgba(0,0,0,0.15);
        }
        .tl-chip-label { font-weight: 600; margin-right: 2px; opacity: 0.85; }
        .tl-chip-val   { font-weight: 800; }
        .tl-chip-cuft    { background: #FFB300; color: #3d2600; }
        .tl-chip-arrival { background: #00C853; color: #003319; }
        .tl-chip-delay   { background: #FF6D00; color: #fff; }
        .tl-chip-docking { background: #2979FF; color: #fff; }
        .tl-chip-done    { background: #D500F9; color: #fff; }
        .tl-chip-time    { background: #00BCD4; color: #00272d; }
        .tl-chip-release { background: #607D8B; color: #fff; }
        .tl-chip-nodata  { background: #FF1744; color: #fff; }
        .tl-chip-late    { background: #B71C1C; color: #fff; }
        .tl-chip-late    { background: #B71C1C; color: #fff; }
        @keyframes tl-pulse { 0%,100%{opacity:1} 50%{opacity:0.45} }
        .tl-loading { animation: tl-pulse 1.2s ease-in-out infinite; }

        #rd-global-bar {
            position: fixed;
            top: 0; left: 0; right: 0;
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 6px 16px;
            background: #1b5e20;
            border-bottom: 2px solid #a5d6a7;
            z-index: 9999;
            flex-wrap: wrap;
            box-shadow: 0 2px 6px rgba(0,0,0,0.25);
        }
        #rd-global-bar .rd-global-label {
            font-size: 12px; font-weight: 700; color: #fff;
            font-family: 'Amazon Ember', Arial, sans-serif;
        }
        #rd-global-bar .rd-global-status {
            font-size: 11px; color: #c8e6c9;
            font-family: 'Amazon Ember', Arial, sans-serif;
        }
        body { padding-top: 36px !important; }

        .rd-popup-overlay {
            position: fixed; inset: 0;
            background: rgba(0,0,0,0.45);
            z-index: 99998;
        }
        .rd-popup {
            background: rgba(10, 22, 40, 0.75);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 12px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.4);
            width: 860px; height: 72vh;
            min-width: 320px; min-height: 200px;
            display: flex; flex-direction: column;
            overflow: hidden;
            font-family: 'Amazon Ember', Arial, sans-serif;
            z-index: 99999;
            position: fixed;
            top: 50%; left: 50%;
            transform: translate(-50%, -50%);
        }
        .rd-resize-handle {
            position: absolute; z-index: 100000;
        }
        .rd-resize-n  { top:-4px;    left:8px;    right:8px;  height:8px;  cursor:n-resize; }
        .rd-resize-s  { bottom:-4px; left:8px;    right:8px;  height:8px;  cursor:s-resize; }
        .rd-resize-w  { left:-4px;   top:8px;     bottom:8px; width:8px;   cursor:w-resize; }
        .rd-resize-e  { right:-4px;  top:8px;     bottom:8px; width:8px;   cursor:e-resize; }
        .rd-resize-nw { top:-4px;    left:-4px;   width:16px; height:16px; cursor:nw-resize; }
        .rd-resize-ne { top:-4px;    right:-4px;  width:16px; height:16px; cursor:ne-resize; }
        .rd-resize-sw { bottom:-4px; left:-4px;   width:16px; height:16px; cursor:sw-resize; }
        .rd-resize-se { bottom:-4px; right:-4px;  width:16px; height:16px; cursor:se-resize; }
        .rd-popup-header {
            display: flex; align-items: center; justify-content: space-between;
            padding: 12px 16px 10px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            background: rgba(255, 255, 255, 0.03); flex-shrink: 0;
            cursor: grab;
            user-select: none;
        }
        .rd-popup-header:active { cursor: grabbing; }
        .rd-popup-title { font-size: 13px; font-weight: 700; color: #fff; }
        .rd-popup-sub   { font-size: 11px; font-weight: 600; color: #aaa; margin-top: 2px; }
        .rd-popup-close { background: none; border: none; cursor: pointer; font-size: 18px; color: #aaa; line-height: 1; padding: 0 2px; }
        .rd-popup-close:hover { color: #ff5252; }
        .rd-popup-body  { display: flex; gap: 0; overflow: hidden; flex: 1; min-height: 0; }
        .rd-panel { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-width: 0; }
        .rd-panel + .rd-panel { border-left: 1px solid rgba(255, 255, 255, 0.1); }
        .rd-panel-header { padding: 7px 12px 6px; font-size: 11.5px; font-weight: 700; flex-shrink: 0; }
        .rd-panel-header-total { background: rgba(232, 245, 233, 0.5); color: #1b5e20; }
        .rd-panel-header-rest  { background: rgba(227, 242, 253, 0.5); color: #0d47a1; }
        .rd-panel-header-xd    { background: rgba(255, 243, 224, 0.5); color: #e65100; }
        .rd-panel-scroll { overflow-y: auto; padding: 6px 12px 12px; flex: 1; }
        .rd-route-row {
            display: flex; align-items: center; gap: 6px;
            padding: 5px 0; border-bottom: 1px solid #f0f0f0;
        }
        .rd-route-row:last-child { border-bottom: none; }
        .rd-route-name  { flex: 1; font-size: 11px; font-weight: 600; color: #334155; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .rd-route-pkgs  { font-size: 11px; font-weight: 700; color: #64748b; white-space: nowrap; min-width: 44px; text-align: right; }
        .rd-bar-wrap    { width: 80px; height: 10px; background: #e2e8f0; border-radius: 5px; overflow: hidden; flex-shrink: 0; }
        .rd-bar-fill    { height: 100%; border-radius: 5px; transition: width 0.3s ease; }
        .rd-pct-label   { font-size: 11px; font-weight: 700; color: #475569; min-width: 38px; text-align: right; white-space: nowrap; }
        .rd-cpt-list    { display: flex; flex-wrap: wrap; gap: 4px; padding: 3px 0 5px 8px; border-bottom: 1px solid #f0f0f0; }
        .rd-cpt-chip    { display: inline-flex; align-items: center; gap: 4px; padding: 1px 7px; border-radius: 20px; background: #f0f4ff; border: 1px solid #c5cae9; font-size: 10px; font-family: 'Amazon Ember', Arial, sans-serif; white-space: nowrap; }
        .rd-cpt-name    { font-weight: 700; color: #283593; }
        .rd-cpt-pkgs    { font-weight: 600; color: #444; }
        .rd-cpt-pct     { font-weight: 700; }

        .rd-dark.rd-popup            { background: rgba(10, 22, 40, 0.75) !important; backdrop-filter: blur(12px) !important; -webkit-backdrop-filter: blur(12px) !important; border: 1px solid rgba(255, 255, 255, 0.1) !important; }
        .rd-dark .rd-popup-header    { background: rgba(255, 255, 255, 0.03) !important; border-bottom-color: rgba(255, 255, 255, 0.1) !important; }
        .rd-dark .rd-popup-title     { color: #fff !important; }
        .rd-dark .rd-popup-sub       { color: #aaa !important; }
        .rd-dark .rd-popup-close     { color: #aaa !important; }
        .rd-dark .rd-tab-bar         { background: rgba(255, 255, 255, 0.02) !important; border-bottom-color: rgba(255, 255, 255, 0.08) !important; }
        .rd-dark .rd-panel-scroll    { background: transparent !important; }
        .rd-dark .rd-panel-header-total { background: rgba(13, 43, 16, 0.6) !important; color: #a5d6a7 !important; }
        .rd-dark .rd-panel-header-rest  { background: rgba(10, 25, 41, 0.6) !important; color: #90caf9 !important; }
        .rd-dark .rd-panel-header-xd    { background: rgba(43, 18, 0, 0.6) !important; color: #ffcc80 !important; }
        .rd-dark .rd-route-row       { border-bottom-color: #2e2e45 !important; }
        .rd-dark .rd-route-name      { color: #d0d0e8 !important; }
        .rd-dark .rd-route-pkgs      { color: #b0b0cc !important; }
        .rd-dark .rd-bar-wrap        { background: #3a3a5e !important; }
        .rd-dark .rd-pct-label       { color: #ddd !important; }
        .rd-dark .rd-cpt-list        { border-bottom-color: #2e2e45 !important; }
        .rd-dark .rd-cpt-chip        { background: #252545 !important; border-color: #4a4a8e !important; }
        .rd-dark .rd-cpt-name        { color: #90a0ff !important; }
        .rd-dark .rd-cpt-pkgs        { color: #b0b0cc !important; }
        .rd-dark .rd-vrid-sub        { border-top-color: #2e2e45 !important; }
        .rd-dark .rd-vrid-sub-item   { background: #1e2040 !important; border-color: #3a3a6e !important; color: #c5cae9 !important; }
        .rd-dark .rd-vrid-sub-lane   { color: #7878a8 !important; }
        .rd-dark .rd-vrid-sub-pkgs   { color: #90caf9 !important; }

        .rd-vrid-sub      { padding: 3px 4px 5px 8px; border-top: 1px dashed #e0e0e0; display: flex; flex-wrap: wrap; gap: 4px; }
        .rd-vrid-sub-item { display: inline-flex; align-items: center; gap: 4px; padding: 1px 8px; border-radius: 20px; background: #f3f4ff; border: 1px solid #c5cae9; font-size: 10px; font-family: 'Amazon Ember', Arial, sans-serif; white-space: nowrap; cursor: default; }
        .rd-vrid-sub-lane { font-weight: 400; color: #777; font-size: 9.5px; }
        .rd-vrid-sub-pkgs { font-weight: 700; color: #0d47a1; }

        .rd-settings-overlay { position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:999999;display:flex;align-items:center;justify-content:center; }
        .rd-settings-panel   { background:#fff;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,0.4);padding:20px 24px;min-width:280px;font-family:'Amazon Ember',Arial,sans-serif; }
        .rd-settings-panel.rd-dark-panel { background:#1a1a2e;color:#e0e0f0; }
        .rd-settings-title   { font-size:14px;font-weight:800;margin-bottom:16px; }
        .rd-settings-row     { margin-bottom:14px; }
        .rd-settings-label   { font-size:11px;font-weight:700;color:#555;margin-bottom:6px; }
        .rd-dark-panel .rd-settings-label { color:#9090b0; }
        .rd-settings-options { display:flex;gap:8px;flex-wrap:wrap; }
        .rd-settings-opt     { padding:5px 14px;border-radius:20px;border:2px solid #ddd;font-size:11px;font-weight:700;cursor:pointer;background:#f5f5f5;transition:all 0.15s; }
        .rd-settings-opt:hover { border-color:#aaa; }
        .rd-settings-opt.active { border-color:#0d47a1;background:#e3f2fd;color:#0d47a1; }
        .rd-dark-panel .rd-settings-opt { background:#252545;border-color:#3a3a6e;color:#c0c0e0; }
        .rd-dark-panel .rd-settings-opt.active { border-color:#5060ff;background:#2a2a5e;color:#90a0ff; }
    `;
        document.head.appendChild(styleEl);

        function makeBtn(text, extraClass, disabled) {
            const b = document.createElement('button');
            b.className = 'tl-btn ' + (extraClass || '');
            b.textContent = text;
            if (disabled) b.disabled = true;
            return b;
        }

        function getOrCreateBtnGroup(row) {
            var cell = row.querySelector('td.loadIdCol');
            if (!cell) return null;
            var g = cell.querySelector('.tl-btn-group');
            if (!g) {
                g = document.createElement('span');
                g.className = 'tl-btn-group';
                g.style.cssText = 'display:inline-flex;align-items:center;gap:4px;flex-wrap:wrap;margin-left:4px;vertical-align:middle;';
                cell.appendChild(g);
            }
            return g;
        }

        if (isVista) {

            var vpHost = document.createElement('div');
            vpHost.style.cssText = 'all:initial;position:fixed;bottom:80px;right:24px;z-index:2147483647;width:0;height:0;overflow:visible;pointer-events:none';
            document.body.appendChild(vpHost);
            var vpShadow = vpHost.attachShadow({ mode: 'open' });

            var vpStyle = document.createElement('style');
            vpStyle.textContent = [
                '* { box-sizing: border-box; font-family: "Amazon Ember", Arial, sans-serif; }',
                '#vp-overlay { display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.45);z-index:2147483645;pointer-events:all; }',
                '#vp-overlay.open { display:block; }',
                '#vp-popup { display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2147483646;width:820px;max-width:96vw;max-height:80vh;background:#fff;border-radius:12px;box-shadow:0 8px 36px rgba(0,0,0,.32);flex-direction:column;overflow:hidden;font-size:13px;pointer-events:all; }',
                '#vp-popup.open { display:flex; }',
                '#vp-header { background:#e65100;color:#fff;padding:10px 14px;font-weight:700;font-size:14px;display:flex;align-items:center;gap:8px;cursor:grab;user-select:none;flex-shrink:0; }',
                '#vp-header:active { cursor:grabbing; }',
                '.vp-title { flex:1;color:#fff;font-size:13px; }',
                '#vp-status { font-size:11px;font-weight:400;opacity:.8; }',
                '#vp-close { background:rgba(255,255,255,.15);border:none;color:#fff;border-radius:6px;padding:3px 10px;cursor:pointer;font-size:14px; }',
                '#vp-close:hover { background:rgba(255,255,255,.28); }',
                '#vp-body { overflow-y:auto;flex:1;min-height:0; }',
                '#vp-body table { width:100%;border-collapse:collapse; }',
                '#vp-body thead th { position:sticky;top:0;background:#fbe9e7;padding:7px 10px;text-align:left;font-size:11px;font-weight:700;color:#e65100;border-bottom:2px solid #ffccbc;white-space:nowrap; }',
                '#vp-body tbody tr:nth-child(even) { background:#fff8f5; }',
                '#vp-body tbody tr:hover { background:#ffe0cc; }',
                '#vp-body tbody td { padding:6px 10px;border-bottom:1px solid #e0e0e0;color:#212121; }',
                '#vp-footer { padding:6px 14px;font-size:11px;color:#757575;border-top:1px solid #e0e0e0;background:#fafafa;display:flex;justify-content:space-between;flex-shrink:0; }',
                '.vp-loading { padding:24px;text-align:center;color:#757575; }',
                '.td-right { text-align:right; }'
            ].join('\n');
            vpShadow.appendChild(vpStyle);

            var vpOverlay = document.createElement('div');
            vpOverlay.id = 'vp-overlay';
            vpShadow.appendChild(vpOverlay);

            var vpPopup = document.createElement('div');
            vpPopup.id = 'vp-popup';
            vpPopup.innerHTML =
                '<div id="vp-header">' +
                '<span class="vp-title">\uD83C\uDFED Pallets Loaded</span>' +
                '<span id="vp-status"></span>' +
                '<button id="vp-download" type="button" title="Download CSV" style="background:rgba(255,255,255,0.15);border:none;color:#fff;border-radius:6px;padding:3px 8px;cursor:pointer;font-size:12px;margin-right:5px;">📥 CSV</button>' +
                '<button id="vp-close" type="button">\u2715</button>' +
                '</div>' +
                '<div id="vp-body"><div class="vp-loading">' + L("vistaLoading") + '</div></div>' +
                '<div id="vp-footer"><span id="vp-info"></span><span id="vp-count"></span></div>';
            vpShadow.appendChild(vpPopup);

            var vpDragX = 0, vpDragY = 0, vpDragging = false;
            vpPopup.querySelector('#vp-header').addEventListener('mousedown', function (e) {
                if (e.target.closest('button')) return;
                vpDragging = true;
                var r = vpPopup.getBoundingClientRect();
                vpPopup.style.transform = 'none';
                vpPopup.style.left = r.left + 'px';
                vpPopup.style.top = r.top + 'px';
                vpDragX = e.clientX - r.left;
                vpDragY = e.clientY - r.top;
                e.preventDefault();
            });
            document.addEventListener('mousemove', function (e) {
                if (!vpDragging) return;
                vpPopup.style.left = (e.clientX - vpDragX) + 'px';
                vpPopup.style.top = (e.clientY - vpDragY) + 'px';
            });
            document.addEventListener('mouseup', function () { vpDragging = false; });

            function vpOpen() { vpPopup.classList.add('open'); vpOverlay.classList.add('open'); }
            function vpClose() { vpPopup.classList.remove('open'); vpOverlay.classList.remove('open'); }

            vpOverlay.addEventListener('click', function (e) { e.stopPropagation(); vpClose(); });
            vpPopup.addEventListener('click', function (e) { e.stopPropagation(); });
            document.addEventListener('keydown', function (e) { if (e.key === 'Escape') vpClose(); });
            vpPopup.querySelector('#vp-close').addEventListener('click', function (e) { e.stopPropagation(); vpClose(); });

            var currentContainers = [];
            var currentLane = '';

            function vpDownloadCSV() {
                if (!currentContainers.length) return;
                var csv = ['Scannable ID,Rota,Doca,CPT,Pacotes,Volume (ft3)'];
                currentContainers.sort(function (a, b) {
                    var docaA = (a.locationLabel || '').toUpperCase();
                    var docbB = (b.locationLabel || '').toUpperCase();
                    return docaA.localeCompare(docbB) || (a.scannableId || '').localeCompare(b.scannableId || '');
                }).forEach(function (c) {
                    var cpt = c.cpt ? new Date(Number(c.cpt)).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', '') : '—';
                    var pkgs = (c.contentCountMap && c.contentCountMap.PACKAGE) || 0;
                    var vol = c.packageVolume ? cm3ToFt3(c.packageVolume) : '0';
                    var row = [
                        '"' + (c.scannableId || '') + '"',
                        '"' + (c.sfName || '') + '"',
                        '"' + (c.locationLabel || '').toUpperCase() + '"',
                        '"' + cpt + '"',
                        pkgs,
                        vol
                    ];
                    csv.push(row.join(','));
                });

                var blob = new Blob(['\ufeff' + csv.join('\n')], { type: 'text/csv;charset=utf-8;' });
                var link = document.createElement('a');
                var url = URL.createObjectURL(blob);
                link.setAttribute('href', url);
                link.setAttribute('download', 'pallets_' + currentLane.replace(/[^a-z0-9]/gi, '_') + '.csv');
                link.style.visibility = 'hidden';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            }
            vpPopup.querySelector('#vp-download').addEventListener('click', function (e) { e.stopPropagation(); vpDownloadCSV(); });
            function vpRenderTable(containers, lane) {
                currentContainers = containers;
                currentLane = lane;
                var titleEl = vpShadow.getElementById('vp-header').querySelector('.vp-title');
                var body = vpShadow.getElementById('vp-body');
                var count = vpShadow.getElementById('vp-count');
                if (titleEl) titleEl.textContent = '\uD83C\uDFED Loaded \u2014 ' + lane;

                var docas = {};
                containers.forEach(function (c) {
                    if (!c.locationLabel) return;
                    var doca = c.locationLabel.toUpperCase();
                    if (!docas[doca]) docas[doca] = { containers: [], totalVol: 0, totalPkgs: 0 };
                    docas[doca].containers.push(c);
                    docas[doca].totalVol += c.packageVolume || 0;
                    docas[doca].totalPkgs += (c.contentCountMap && c.contentCountMap.PACKAGE) || 0;
                });

                if (!Object.keys(docas).length) {
                    body.innerHTML = '<div class="vp-loading">' + L('noContainersFound') + '</div>';
                    if (count) count.textContent = '0 containers';
                    return;
                }

                var html = '<table><thead><tr>' +
                    '<th>Doca</th><th>Rota</th><th>Scannable ID</th><th>CPT</th><th>Pacotes</th><th>Volume (ft\u00B3)</th>' +
                    '</tr></thead><tbody>';

                Object.keys(docas).sort().forEach(function (doca) {
                    var group = docas[doca];
                    html += '<tr style="background:#fff3e0;font-weight:700;">' +
                        '<td>\uD83D\uDCE6 ' + doca + '</td>' +
                        '<td colspan="3" style="color:#e65100">' + group.containers.length + ' container(s)</td>' +
                        '<td class="td-right">' + group.totalPkgs + '</td>' +
                        '<td class="td-right">' + cm3ToFt3(group.totalVol) + ' ft\u00B3</td>' +
                        '</tr>';
                    group.containers.sort(function (a, b) { return (a.scannableId || '').localeCompare(b.scannableId || ''); });
                    group.containers.forEach(function (c) {
                        var cpt = c.cpt ? new Date(Number(c.cpt)).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
                        var pkgs = (c.contentCountMap && c.contentCountMap.PACKAGE) || 0;
                        var vol = c.packageVolume ? cm3ToFt3(c.packageVolume) : '\u2014';
                        html += '<tr>' +
                            '<td style="padding-left:20px">' + doca + '</td>' +
                            '<td>' + (c.sfName || '\u2014') + '</td>' +
                            '<td>' + (c.scannableId || '\u2014') + '</td>' +
                            '<td>' + cpt + '</td>' +
                            '<td class="td-right">' + pkgs + '</td>' +
                            '<td class="td-right">' + vol + '</td>' +
                            '</tr>';
                    });
                });
                html += '</tbody></table>';
                body.innerHTML = html;
                var total = containers.length;
                if (count) count.textContent = total + ' ' + L('containerIn') + ' ' + Object.keys(docas).length + ' ' + L('docksWord');
            }

            function vpLoadData(lane) {
                var destination = laneToDestination(lane);
                var status = vpShadow.getElementById('vp-status');
                var body = vpShadow.getElementById('vp-body');
                var info = vpShadow.getElementById('vp-info');
                var titleEl = vpShadow.getElementById('vp-header').querySelector('.vp-title');

                if (titleEl) titleEl.textContent = '\uD83C\uDFED Loaded \u2014 ' + lane;
                if (status) status.textContent = L('vistaSearching');
                body.innerHTML = '<div class="vp-loading">' + L('vistaSearching') + '</div>';
                vpOpen();

                if (!_SUITE.vsm) {
                    body.innerHTML = '<div class="vp-loading" style="color:#c62828">⚠ VSM Module not loaded</div>';
                    return;
                }
                _SUITE.vsm.fetchByRoute(destination, function (containers) {
                    if (!containers || containers.length === 0) {
                        body.innerHTML = '<div class="vp-loading">' + L('noContainersLane') + '</div>';
                        if (status) status.textContent = '';
                        return;
                    }
                    vpRenderTable(containers, lane);
                    if (status) status.textContent = '';
                    if (info) info.textContent = L('updatedAt') + ': ' + new Date().toLocaleTimeString('pt-BR', { hour12: false });
                });
            }

            function addVistaButtons() {
                var rows = document.querySelectorAll('tr.route-level-row');
                for (var i = 0; i < rows.length; i++) {
                    var row = rows[i];
                    if (row.querySelector('.vista-route-btn')) continue;
                    var routeSpan = row.querySelector('span.route.float-left');
                    if (!routeSpan) continue;

                    var fullRoute = '';
                    var rowId = row.id || '';
                    var match = rowId.match(/CURRENT(.+)$/);
                    if (match) {
                        fullRoute = match[1].replace('--', '->');
                    } else {
                        routeSpan.childNodes.forEach(function (node) {
                            if (node.nodeType === Node.TEXT_NODE) fullRoute += node.textContent.trim();
                        });
                    }
                    if (!fullRoute) continue;

                    var lane = fullRoute.includes('->') ? fullRoute : CURRENT_NODE + '->' + fullRoute;

                    var btn = makeBtn('\uD83C\uDFED ' + (fullRoute.split('->')[1] || fullRoute), 'tl-btn-orange vista-route-btn');
                    btn.style.marginLeft = '8px';
                    btn.title = 'Ver containers loaded \u2014 ' + lane;
                    (function (l) {
                        btn.addEventListener('click', function (e) {
                            e.stopPropagation();
                            e.preventDefault();
                            vpLoadData(l);
                        });
                    })(lane);
                    routeSpan.insertAdjacentElement('afterend', btn);
                }
            }

            var debounceVista = null;
            new MutationObserver(function () {
                clearTimeout(debounceVista);
                debounceVista = setTimeout(addVistaButtons, 300);
            }).observe(document.body, { childList: true, subtree: true });
            setTimeout(addVistaButtons, 2000);
        }

        if (isOutbound) {
            function getDock(row) {
                var label = row.querySelector('span.locLabel');
                if (!label) return null;
                var text = label.textContent.trim();
                return /^DD\d+$/i.test(text) ? text : null;
            }

            function getLane(row) {
                var lane = row.querySelector('span.floatL[class*="lane"]');
                return lane ? lane.textContent.trim() : '';
            }

            function getLoadedContainers(row) {
                var planid = row.getAttribute('planid');
                if (!planid) return 0;
                var cell = document.getElementById('loadedCCell_' + planid);
                if (!cell) return 0;
                var link = cell.querySelector('a.trailerCount');
                if (!link) return 0;
                return parseInt(link.textContent.trim(), 10) || 0;
            }

            function isFinished(row) {
                var statusEl = row.querySelector('.originalStatusCheck[data-status]');
                return statusEl && statusEl.getAttribute('data-status') === 'FINISHED_LOADING';
            }

            function fetchCuft(dock, lane, wrapper) {
                wrapper.innerHTML = '';
                wrapper.appendChild(makeBtn('⏳ ' + dock, 'tl-btn-gray tl-loading', true));
                var destination = laneToDestination(lane);
                _SUITE.vsm.fetchByRoute(destination, function (containers) {
                    if (!containers || containers.length === 0) { renderError(dock, lane, wrapper); return; }
                    var totalVol = 0;
                    containers.forEach(function (c) {
                        if (c.locationLabel && c.locationLabel.toUpperCase() === dock.toUpperCase())
                            totalVol += c.packageVolume || 0;
                    });
                    var cuft = cm3ToFt3(totalVol);
                    if (parseFloat(cuft) <= 0) {
                        renderError(dock, lane, wrapper);
                    } else {
                        renderResult(dock, lane, wrapper, cuft);
                    }
                });
            }

            function renderResult(dock, lane, wrapper, cuft) {
                wrapper.innerHTML = '';
                var split = document.createElement('span');
                split.className = 'tl-split-wrap';
                var main = makeBtn('📦 ' + dock + '  ' + cuft + ' cu ft', 'tl-btn-orange tl-split-main', true);
                var ref = makeBtn('↺', 'tl-btn-orange tl-split-refresh');
                ref.title = 'Refresh cu ft';
                ref.addEventListener('click', function (e) { e.stopPropagation(); fetchCuft(dock, lane, wrapper); });
                split.appendChild(main);
                split.appendChild(ref);
                wrapper.appendChild(split);
            }

            function renderError(dock, lane, wrapper) {
                wrapper.innerHTML = '';
                var split = document.createElement('span');
                split.className = 'tl-split-wrap';
                var err = makeBtn('⚠ ' + dock + ' — error', 'tl-btn-red tl-split-main', true);
                var ref = makeBtn('↺', 'tl-btn-red tl-split-refresh');
                ref.title = 'Try again';
                ref.addEventListener('click', function (e) { e.stopPropagation(); fetchCuft(dock, lane, wrapper); });
                split.appendChild(err);
                split.appendChild(ref);
                wrapper.appendChild(split);
            }

        }

        if (isRTT) {

            if (location.href.includes('relay_token_init=1')) {
                var _checkClose = setInterval(function () {
                    var t = GM_getValue('relay_token', '');
                    var ts = GM_getValue('relay_token_ts', 0);
                    if (t && t.length > 30 && ts > Date.now() - 5000) {
                        clearInterval(_checkClose);
                        setTimeout(function () { window.close(); }, 300);
                    }
                }, 200);
                setTimeout(function () { clearInterval(_checkClose); window.close(); }, 14000);
            }
            return;
        }

        if (isYMS && !window.opener) {
            function parseYmsTimestamp(raw) {
                const m = raw.trim().match(/^([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s+(AM|PM)$/i);
                if (!m) return { formatted: raw, ms: null };
                const monthStr = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
                const day = m[2].padStart(2, '0'), year = m[3].slice(2);
                let hour = parseInt(m[4], 10);
                const min = m[5], ampm = m[7].toUpperCase();
                if (ampm === 'PM' && hour !== 12) hour += 12;
                if (ampm === 'AM' && hour === 12) hour = 0;
                const formatted = `${day}-${monthStr}-${year} ${String(hour).padStart(2, '0')}:${min}`;
                const ms = Date.UTC(2000 + parseInt(year, 10), MONTHS[monthStr], parseInt(day, 10), hour + 3, parseInt(min, 10), parseInt(m[6], 10));
                return { formatted, ms };
            }

            function waitFor(condFn, timeoutMs, intervalMs, onReady, onTimeout) {
                const deadline = Date.now() + timeoutMs;
                const iv = setInterval(() => {
                    if (condFn()) { clearInterval(iv); onReady(); }
                    else if (Date.now() > deadline) { clearInterval(iv); onTimeout(); }
                }, intervalMs);
            }

            function extractAndSaveYMS() {
                const vridMatch = location.href.match(/loadIdentifier=([A-Z0-9]{6,15})/i);
                if (!vridMatch) return false;
                const vrid = vridMatch[1].toUpperCase();
                const isIbVehicle = location.href.includes('isib=1');

                let checkIn = null, checkInMs = null, tdrDock = null, tdrDockMs = null;
                let dockStarted = null, dockCompleted = null, checkOut = null;
                const docksSet = new Set();
                document.querySelectorAll('tr[ng-repeat-start]').forEach(row => {
                    const tds = row.querySelectorAll('td');
                    const dockSpan = tds[0] ? tds[0].querySelector('span.ng-binding') : null;
                    if (dockSpan) {
                        const dockMatch = dockSpan.textContent.replace(/\s+/g, ' ').trim().match(/\b(DD\d+)\b/);
                        if (dockMatch) docksSet.add(dockMatch[1]);
                    }
                    const eventTypeTd = row.querySelector('td#eventType');
                    if (!eventTypeTd) return;
                    const spanEl = eventTypeTd.querySelector('span.ng-binding');
                    const spanText = spanEl ? spanEl.textContent.trim() : '';
                    const titleAttr = (eventTypeTd.getAttribute('title') || '').trim();
                    const rawTs = tds[2] ? tds[2].textContent.trim() : null;
                    if (!rawTs) return;
                    const parsed = parseYmsTimestamp(rawTs);
                    if (!checkIn && titleAttr === 'CHECK_IN' && spanText === 'Check In') { checkIn = parsed.formatted; checkInMs = parsed.ms; }
                    if (spanText === 'TDR - Dock' && (!tdrDockMs || (parsed.ms && parsed.ms < tdrDockMs))) { tdrDock = parsed.formatted; tdrDockMs = parsed.ms; }
                    const isDockStarted = (titleAttr === 'OB_DOCK_STARTED' && spanText === 'OB Dock Started') ||
                        (titleAttr === 'IB_DOCK_STARTED' && spanText === 'IB Dock Started');
                    if (isDockStarted && (!dockStarted || (parsed.ms && parsed.ms < dockStarted))) dockStarted = parsed.ms;
                    const isDockCompleted = (titleAttr === 'OB_DOCK_COMPLETED' && spanText === 'OB Dock Completed') || (isIbVehicle && spanText === 'Detach Load');
                    if (isDockCompleted && (!dockCompleted || (parsed.ms && parsed.ms > dockCompleted.ms))) dockCompleted = parsed;
                    if (!checkOut && titleAttr === 'CHECK_OUT' && spanText === 'Check Out') checkOut = parsed.ms;
                });
                if (!checkIn && !tdrDock && !dockCompleted) return false;
                let dockStartedFormatted = null, checkOutFormatted = null;
                if (dockStarted) {
                    const d2 = new Date(dockStarted - 3 * 3600000);
                    dockStartedFormatted = String(d2.getUTCDate()).padStart(2, '0') + '-' + MONTH_ABBR[d2.getUTCMonth()] + '-' +
                        String(d2.getUTCFullYear()).slice(2) + ' ' + String(d2.getUTCHours()).padStart(2, '0') + ':' + String(d2.getUTCMinutes()).padStart(2, '0');
                }
                if (checkOut) {
                    const d3 = new Date(checkOut - 3 * 3600000);
                    checkOutFormatted = String(d3.getUTCDate()).padStart(2, '0') + '-' + MONTH_ABBR[d3.getUTCMonth()] + '-' +
                        String(d3.getUTCFullYear()).slice(2) + ' ' + String(d3.getUTCHours()).padStart(2, '0') + ':' + String(d3.getUTCMinutes()).padStart(2, '0');
                }
                const now = Date.now();
                if (checkIn) { GM_setValue('yms_checkin_' + vrid, checkIn); GM_setValue('yms_checkin_ts_' + vrid, now); }
                if (checkInMs) { GM_setValue('yms_checkin_ms_' + vrid, checkInMs); }
                if (tdrDock) { GM_setValue('yms_tdrdock_' + vrid, tdrDock); GM_setValue('yms_tdrdock_ts_' + vrid, now); }
                if (dockStartedFormatted) { GM_setValue('yms_dockstarted_' + vrid, dockStartedFormatted); GM_setValue('yms_dockstarted_ts_' + vrid, now); }
                if (dockCompleted) { GM_setValue('yms_obdone_' + vrid, dockCompleted.formatted); GM_setValue('yms_obdone_ts_' + vrid, now); }
                if (checkOutFormatted) { GM_setValue('yms_checkout_' + vrid, checkOutFormatted); GM_setValue('yms_checkout_ts_' + vrid, now); }
                if (checkOut) { GM_setValue('yms_checkout_ms_' + vrid, checkOut); }
                if (docksSet.size > 0) { GM_setValue('yms_docks_' + vrid, Array.from(docksSet).join(', ')); }
                GM_setValue('yms_done_' + vrid, '1');
                GM_setValue('yms_done_ts_' + vrid, now);
                if (location.href.includes('yms_autoclose=1')) setTimeout(() => window.close(), 300);
                return true;
            }

            function ymsInit() {
                const vridMatch = location.href.match(/loadIdentifier=([A-Z0-9]{6,15})/i);
                if (!vridMatch) return;
                const vrid = vridMatch[1].toUpperCase();
                const nodeParam = (location.href + location.hash).match(/[?&#]yms_node=([A-Z0-9]+)/i);
                const expectedNode = nodeParam ? nodeParam[1].toUpperCase() : null;
                const isIbVehicle = location.href.includes('isib=1');

                waitFor(
                    () => !!document.querySelector('#availableNodeName'),
                    8000, 100,
                    () => stepSelectNode(),
                    () => stepOutboundTab()
                );

                function stepSelectNode() {
                    if (!expectedNode) { stepOutboundTab(); return; }
                    const nodeSelect = document.querySelector('#availableNodeName');
                    const currentVal = (nodeSelect.value || '').trim().toUpperCase();
                    if (currentVal === expectedNode) { stepOutboundTab(); return; }

                    let targetOpt = null;
                    nodeSelect.querySelectorAll('option').forEach(opt => {
                        const id = (opt.id || '').trim().toUpperCase();
                        const val = (opt.value || '').trim().toUpperCase();
                        const txt = (opt.textContent || '').trim().toUpperCase();
                        if (id === expectedNode || val === expectedNode || txt === expectedNode) targetOpt = opt;
                    });
                    if (!targetOpt) { stepOutboundTab(); return; }

                    nodeSelect.value = targetOpt.value || targetOpt.id || expectedNode;
                    nodeSelect.dispatchEvent(new Event('change', { bubbles: true }));

                    const prevCount = document.querySelectorAll('tr[ng-repeat-start]').length;
                    waitFor(
                        () => {
                            const newCount = document.querySelectorAll('tr[ng-repeat-start]').length;

                            return newCount !== prevCount || document.querySelector('li.OUTBOUND.ui-tabs-selected');
                        },
                        4000, 150,
                        () => stepOutboundTab(),
                        () => stepOutboundTab()
                    );
                }

                function stepOutboundTab() {
                    const tabLink = document.querySelector('li.OUTBOUND a[tab="OUTBOUND"]');
                    if (tabLink) tabLink.click();
                    setTimeout(() => stepExtract(), 1500);
                }

                function stepExtract() {

                    if (extractAndSaveYMS()) return;
                    let tries = 0;
                    const iv = setInterval(() => {
                        tries++;
                        if (extractAndSaveYMS() || tries >= 20) {
                            clearInterval(iv);

                            if (!GM_getValue('yms_done_ts_' + vrid, 0)) {
                                GM_setValue('yms_done_' + vrid, '0');
                                GM_setValue('yms_done_ts_' + vrid, Date.now());
                            }
                        }
                    }, 250);
                }
            }

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', ymsInit);
            } else {
                setTimeout(ymsInit, 300);
            }
            return;
        }

        if (isDock) {
            function parseSdtToMs(sdtText) {

                const m = sdtText.trim().match(/^(\d{2})[- ]([A-Za-z]{3})[- ](\d{2})\s+(\d{2}):(\d{2})$/);
                if (!m) return null;
                const month = MONTHS[m[2].charAt(0).toUpperCase() + m[2].slice(1).toLowerCase()];
                if (month === undefined) return null;
                return Date.UTC(2000 + parseInt(m[3], 10), month, parseInt(m[1], 10), parseInt(m[4], 10) + 3, parseInt(m[5], 10), 0);
            }

            function getYmsDateRange(sdtMs) {
                const DAY_MS = 86400000;
                const sd = new Date(sdtMs);
                const mid = Date.UTC(sd.getUTCFullYear(), sd.getUTCMonth(), sd.getUTCDate(), 3, 0, 0);
                return { fromDate: mid - 3 * DAY_MS, toDate: mid + 3 * DAY_MS - 1 };
            }

            function waitForResults(vrid, timeout, onResult, skipRtt) {
                const start = Date.now();
                let rttDone = !!skipRtt, ymsDone = false;
                const iv = setInterval(() => {
                    if (!rttDone && GM_getValue('cuft_ts_' + vrid, 0) > start) rttDone = true;
                    if (!ymsDone && GM_getValue('yms_done_ts_' + vrid, 0) > start) ymsDone = true;
                    if ((rttDone && ymsDone) || Date.now() - start >= timeout) {
                        clearInterval(iv);
                        onResult();
                    }
                }, 80);
            }

            function chip(cssClass, lkey, value) {
                const c = document.createElement('span');
                c.className = 'tl-chip ' + cssClass;
                c.innerHTML = '<span class="tl-chip-label" data-lkey="' + lkey + '">' + L(lkey) + ':</span> <span class="tl-chip-val">' + value + '</span>';
                return c;
            }

            function cubeChip(cubeVal) {
                let bg, color;
                if (cubeVal <= 0.35) { bg = '#66BB6A'; color = '#1a3a1a'; }
                else if (cubeVal <= 0.59) { bg = '#FFA726'; color = '#3a2000'; }
                else { bg = '#F44336'; color = '#fff'; }
                const c = document.createElement('span');
                c.className = 'tl-chip';
                c.style.cssText = `background:${bg} !important;color:${color} !important;box-shadow:0 1px 3px rgba(0,0,0,0.2);`;
                c.innerHTML = '<span class="tl-chip-label" style="color:inherit;">Cube:</span> <span class="tl-chip-val" style="color:inherit;">' + cubeVal.toFixed(2) + '</span>';
                return c;
            }

            function createInfoBadge(vrid, cuft, checkIn, arrivalDelay, tdrDock, dockStarted, dockCompleted, checkOut, lateDeparture, cube, dockDoors) {
                const card = document.createElement('span');
                card.className = 'tl-info-card';
                card.setAttribute('data-vrid-badge', vrid);
                card.title = 'VRID ' + vrid;
                const row1 = document.createElement('span');
                row1.className = 'tl-info-row';
                const row2 = document.createElement('span');
                row2.className = 'tl-info-row';
                if (cuft) row1.appendChild(chip('tl-chip-cuft', 'cuft', cuft));
                if (isIB && cube !== null && cube !== undefined) row1.appendChild(cubeChip(cube));
                if (checkIn) row1.appendChild(chip('tl-chip-arrival', 'arrival', checkIn));
                if (arrivalDelay) row1.appendChild(chip('tl-chip-delay', 'delay', arrivalDelay));
                if (tdrDock) row1.appendChild(chip('tl-chip-docking', 'docking', tdrDock));
                if (dockDoors) row1.appendChild(chip('tl-chip-docking', 'dockDoors', dockDoors));
                if (!isIB && lateDeparture) row1.appendChild(chip('tl-chip-late', 'late', lateDeparture));
                if (isIB) {
                    if (dockStarted) row2.appendChild(chip('tl-chip-done', 'ibStarted', dockStarted));
                    if (dockCompleted) row2.appendChild(chip('tl-chip-time', 'ibDone', dockCompleted));
                } else {
                    if (dockStarted) row2.appendChild(chip('tl-chip-time', 'obStarted', dockStarted));
                    if (dockCompleted) row2.appendChild(chip('tl-chip-done', 'obDone', dockCompleted));
                }
                if (checkOut) row2.appendChild(chip('tl-chip-release', 'checkout', checkOut));
                if (!row1.children.length && !row2.children.length)
                    row1.appendChild(chip('tl-chip-nodata', '⚠', 'No data'));
                if (row1.children.length) card.appendChild(row1);
                if (row2.children.length) card.appendChild(row2);
                return card;
            }

            const infoStore = {};

            const routeStore = {};

            function mergeRoutesIntoStore(accumObj) {
                Object.entries(accumObj).forEach(([route, v]) => {
                    if (route === '_xdock') return;
                    if (!routeStore[route]) {
                        routeStore[route] = { pkgs: 0, remaining: 0, cpts: {} };
                    }
                    routeStore[route].pkgs += v.pkgs;
                    routeStore[route].remaining += v.remaining;
                    Object.entries(v.cpts || {}).forEach(([cpt, c]) => {
                        if (!routeStore[route].cpts[cpt]) {
                            routeStore[route].cpts[cpt] = { pkgs: 0, remaining: 0 };
                        }
                        routeStore[route].cpts[cpt].pkgs += c.pkgs;
                        routeStore[route].cpts[cpt].remaining += c.remaining;
                    });
                });
                updateFullExportBtn();
            }

            function updateFullExportBtn() {
                const btn = document.getElementById('rd-full-export-btn');
                if (!btn) return;
                const hasInfo = Object.keys(infoStore).length > 0;
                const hasRoutes = Object.keys(routeStore).length > 0;
                btn.disabled = !hasInfo && !hasRoutes;
                btn.title = hasInfo || hasRoutes
                    ? `Export: ${Object.keys(infoStore).length} VRIDs (Get Info) · ${Object.keys(routeStore).length} routes`
                    : 'No data collected yet';
            }

            function downloadFullExcel() {
                if (typeof XLSX === 'undefined') {
                    alert('SheetJS (XLSX) not loaded. Check @require in the script header.');
                    return;
                }
                const wb = XLSX.utils.book_new();

                function autoColWidths(rows) {
                    if (!rows.length) return [];
                    const widths = rows[0].map((_, ci) =>
                        Math.min(40, Math.max(10, ...rows.map(r => String(r[ci] || '').length)))
                    );
                    return widths.map(w => ({ wch: w + 2 }));
                }

                const infoHeaders = isIB
                    ? ['VRID', 'Pacotes', 'CuFt', 'Cube (ft³/pkg)', 'Check-In', 'Atraso Chegada', 'TDR-Dock', 'Doca(s)', 'Início Descarreg.', 'Fim Descarreg.', 'Check-Out']
                    : ['VRID', 'Pacotes', 'CuFt', 'Check-In', 'TDR-Dock', 'Doca(s)', 'Início Carreg.', 'Fim Carreg.', 'Check-Out', 'Atraso Saída'];
                const infoRows = [infoHeaders];
                Object.values(infoStore).sort((a, b) => (a.vrid || '').localeCompare(b.vrid || '')).forEach(d => {
                    const cubeVal = (d.cube !== null && d.cube !== '' && d.cube !== undefined)
                        ? Number(d.cube).toFixed(2) : '';
                    if (isIB) {
                        infoRows.push([
                            d.vrid || '',
                            d.packages || '',
                            d.cuft || '',
                            cubeVal,
                            d.checkIn || '',
                            d.arrivalDelay || '',
                            d.tdrDock || '',
                            d.dockDoors || '',
                            d.dockStarted || '',
                            d.dockCompleted || '',
                            d.checkOut || '',
                        ]);
                    } else {
                        infoRows.push([
                            d.vrid || '',
                            d.packages || '',
                            d.cuft || '',
                            d.checkIn || '',
                            d.tdrDock || '',
                            d.dockDoors || '',
                            d.dockStarted || '',
                            d.dockCompleted || '',
                            d.checkOut || '',
                            d.lateDeparture || '',
                        ]);
                    }
                });
                if (infoRows.length === 1) infoRows.push(['(nenhum dado coletado ainda)']);
                const wsInfo = XLSX.utils.aoa_to_sheet(infoRows);
                wsInfo['!cols'] = autoColWidths(infoRows);
                wsInfo['!freeze'] = { xSplit: 0, ySplit: 1 };
                XLSX.utils.book_append_sheet(wb, wsInfo, isIB ? 'Info IB' : 'Info OB');

                const hasRoutes = Object.keys(routeStore).length > 0;
                if (hasRoutes) {
                    const routeHeaders = [
                        'Rota', 'Total Pkgs', 'Total %', 'Restante Pkgs', 'Restante %',
                        'CPT', 'CPT Pkgs', '% do CPT na Rota', 'CPT Restante'
                    ];
                    const routeRows = [routeHeaders];
                    const allRoutes = Object.entries(routeStore).map(([route, v]) => ({
                        route,
                        pkgs: v.pkgs,
                        remaining: v.remaining,
                        cpts: Object.entries(v.cpts || {}).map(([cpt, c]) => ({
                            cpt, pkgs: c.pkgs, remaining: c.remaining
                        }))
                    }));
                    const grandTotal = allRoutes.reduce((s, r) => s + r.pkgs, 0);
                    const grandRemaining = allRoutes.reduce((s, r) => s + r.remaining, 0);
                    allRoutes.sort((a, b) => b.pkgs - a.pkgs).forEach(r => {
                        const totalPct = grandTotal > 0 ? (r.pkgs / grandTotal * 100).toFixed(1) + '%' : '0.0%';
                        const remainPct = grandRemaining > 0 ? (r.remaining / grandRemaining * 100).toFixed(1) + '%' : '0.0%';
                        const cpts = (r.cpts || []).slice().sort((a, b) => b.pkgs - a.pkgs);
                        if (cpts.length === 0) {
                            routeRows.push([r.route, r.pkgs, totalPct, r.remaining, remainPct, '', '', '', '']);
                        } else {
                            cpts.forEach((c, i) => {
                                const cptPct = r.pkgs > 0 ? (c.pkgs / r.pkgs * 100).toFixed(1) + '%' : '0.0%';
                                routeRows.push(i === 0
                                    ? [r.route, r.pkgs, totalPct, r.remaining, remainPct, c.cpt, c.pkgs, cptPct, c.remaining]
                                    : ['', '', '', '', '', c.cpt, c.pkgs, cptPct, c.remaining]
                                );
                            });
                        }
                    });
                    routeRows.push(['TOTAL', grandTotal, '100%', grandRemaining, '100%', '', '', '', '']);
                    const wsRoutes = XLSX.utils.aoa_to_sheet(routeRows);
                    wsRoutes['!cols'] = autoColWidths(routeRows);
                    wsRoutes['!freeze'] = { xSplit: 0, ySplit: 1 };
                    XLSX.utils.book_append_sheet(wb, wsRoutes, 'Rotas');
                }

                const ts = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', 'h').replace(':', 'm');
                const name = `${isIB ? 'IB' : 'OB'}_export_${ts}.xlsx`;
                XLSX.writeFile(wb, name);
            }

            function getRowMeta(row) {
                const vrid = getVridFromRow(row);
                if (!vrid) return null;
                let sdt, yard, routeName = null;
                if (isIB) {
                    const satEl = row.querySelector('[data-sat]');
                    sdt = satEl ? satEl.getAttribute('data-sat').trim() : null;
                    yard = CURRENT_NODE;
                    const laneEl = row.querySelector('[class*="lane"]');
                    if (laneEl) {
                        const raw = laneEl.textContent.trim();
                        const m = raw.match(/->([A-Z0-9]{3,6})/);
                        if (m) yard = m[1];

                        routeName = raw.replace(/^[A-Z0-9]{2,6}\s*->\s*/i, '').trim() || raw;
                    }
                } else {
                    const sdtCell = row.querySelector('td.scheduledArrivalTimeCol');
                    sdt = sdtCell ? sdtCell.textContent.trim() : null;
                    yard = CURRENT_NODE;
                    const laneEl = row.querySelector('[class*="lane"]');
                    if (laneEl) {
                        const raw = laneEl.textContent.trim();
                        const m = raw.match(/^([A-Z0-9]{3,6})/);
                        if (m) yard = m[1];
                        routeName = raw.replace(/^[A-Z0-9]{2,6}\s*->\s*/i, '').trim() || raw;
                    } else {
                        for (const cell of row.querySelectorAll('td')) {
                            const m = cell.textContent.trim().match(/^([A-Z0-9]{3,6})\s*->/);
                            if (m) { yard = m[1]; break; }
                        }
                    }
                }
                const pkgEl = row.querySelector('.totalLoadedP');
                const packages = pkgEl ? parseInt(pkgEl.textContent.trim(), 10) || 0 : 0;
                return { vrid, sdt, yard, packages, routeName };
            }

            const infoQueue = [];
            let infoRunning = false;

            function fetchInfo(vrid, sdt, yard, btn, packages, row, status) {
                btn.textContent = '⏸ ' + vrid;
                btn.className = 'tl-btn tl-btn-gray';
                btn.disabled = true;
                infoQueue.push({ vrid, sdt, yard, btn, packages, row, status });
                processInfoQueue();
            }

            function showInfoPanel(vrid, data) {
                document.querySelectorAll('.tl-info-overlay').forEach(e => e.remove());
                const { cuft, checkIn, arrivalDelay, tdrDock, dockStarted, dockCompleted, checkOut, lateDeparture, cube, dockDoors } = data;

                const overlay = document.createElement('div');
                overlay.className = 'tl-info-overlay';
                overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:99998;';

                const popup = document.createElement('div');
                popup.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#fff;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.3);padding:18px 22px;min-width:320px;max-width:520px;font-family:"Amazon Ember",Arial,sans-serif;z-index:99999;';

                const hdr = document.createElement('div');
                hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;';
                hdr.innerHTML = `<span style="font-size:13px;font-weight:700;color:#1a1a1a;">ℹ️ Info — ${vrid}</span>`;
                const closeBtn = document.createElement('button');
                closeBtn.textContent = '✕';
                closeBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:16px;color:#666;padding:0 2px;';
                closeBtn.onclick = () => overlay.remove();
                hdr.appendChild(closeBtn);
                popup.appendChild(hdr);

                const badge = createInfoBadge(vrid, cuft, checkIn, arrivalDelay, tdrDock, dockStarted, dockCompleted, checkOut, lateDeparture, cube, dockDoors);
                badge.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
                popup.appendChild(badge);

                overlay.appendChild(popup);
                overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
                document.addEventListener('keydown', function onEsc(e) { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onEsc); } });
                document.body.appendChild(overlay);
            }

            function processInfoQueue() {
                if (infoRunning || infoQueue.length === 0) return;
                infoRunning = true;
                const { vrid, sdt, yard, btn, packages, row, status } = infoQueue.shift();
                const skipRtt = !isIB && status !== 'COMPLETED';
                btn.textContent = '⏳ Fetching...';
                btn.className = 'tl-btn tl-btn-gray tl-loading';
                btn.disabled = true;
                fetchInfoCore(vrid, sdt, yard, packages, (data) => {
                    infoRunning = false;
                    if (!data) {
                        btn.textContent = '⚠ Try again';
                        btn.className = 'tl-btn tl-btn-red';
                        btn.disabled = false;
                        btn.addEventListener('click', () => fetchInfo(vrid, sdt, yard, btn, packages, row, status), { once: true });
                    } else {
                        btn.textContent = L('getInfo');
                        btn.className = 'tl-btn tl-btn-blue';
                        btn.disabled = false;
                        btn.onclick = () => showInfoPanel(vrid, data);
                        if (!isIB && runRoutesForBadge && row && row.querySelector('a.packageDetails')) {
                            runRoutesForBadge(vrid, row, btn);
                        }
                    }
                    processInfoQueue();
                }, skipRtt);
            }

            function buildResult(vrid, sdt, packages) {
                const cuft = GM_getValue('cuft_' + vrid, null);
                const checkIn = GM_getValue('yms_checkin_' + vrid, null);
                const checkInMs = GM_getValue('yms_checkin_ms_' + vrid, 0);
                const tdrDock = GM_getValue('yms_tdrdock_' + vrid, null);
                const dockStarted = GM_getValue('yms_dockstarted_' + vrid, null);
                const dockCompleted = GM_getValue('yms_obdone_' + vrid, null);
                const checkOut = GM_getValue('yms_checkout_' + vrid, null);
                const dockDoors = GM_getValue('yms_docks_' + vrid, null);
                let arrivalDelay = null;
                if (isIB && sdt && checkIn) {
                    const satMs = parseSdtToMs(sdt);
                    if (satMs && checkInMs && checkInMs > satMs)
                        arrivalDelay = Math.round((checkInMs - satMs) / 60000) + 'min';
                }
                let cube = null;
                if (isIB && cuft && packages > 0) {
                    const cuftVal = parseFloat(cuft);
                    if (!isNaN(cuftVal)) cube = cuftVal / packages;
                }
                const hasData = cuft || checkIn || tdrDock || dockStarted || dockCompleted || checkOut || dockDoors;
                let lateDeparture = null;
                if (!isIB && sdt) {
                    const sdtMs = parseSdtToMs(sdt);
                    const LATE_THRESHOLD = 29 * 60000;
                    if (sdtMs) {
                        const checkoutMs = GM_getValue('yms_checkout_ms_' + vrid, 0);
                        if (checkoutMs && checkoutMs > sdtMs + LATE_THRESHOLD) {
                            lateDeparture = '+' + Math.round((checkoutMs - sdtMs) / 60000) + 'min';
                        } else if (!checkoutMs && Date.now() > sdtMs + LATE_THRESHOLD) {
                            lateDeparture = '+' + Math.round((Date.now() - sdtMs) / 60000) + 'min (no checkout)';
                        }
                    }
                }
                if (hasData || lateDeparture) {
                    infoStore[vrid] = { vrid, packages, cuft, checkIn, arrivalDelay, tdrDock, dockStarted, dockCompleted, checkOut, lateDeparture, dockDoors, cube: cube !== null ? cube : '' };
                    updateFullExportBtn();
                }
                return (hasData || lateDeparture) ? { cuft, checkIn, checkInMs, arrivalDelay, tdrDock, dockStarted, dockCompleted, checkOut, lateDeparture, dockDoors, cube } : null;
            }

            const YMS_API = 'https://ii51s3lexd.execute-api.us-east-1.amazonaws.com/call/getEventReport';

            function tsToYmsFmt(unixSec) {
                var d = new Date((unixSec - 3 * 3600) * 1000);
                return String(d.getUTCDate()).padStart(2, '0') + '-' + MONTH_ABBR[d.getUTCMonth()] + '-' +
                    String(d.getUTCFullYear()).slice(2) + ' ' +
                    String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
            }

            function parseAndStoreYmsEvents(vrid, events, isIbVehicle) {
                var now = Date.now();
                var checkIn = null, checkInMs = null;
                var tdrDock = null, tdrDockMs = null;
                var dockStartedMs = null, dockStartedFmt = null;
                var dockCompleted = null;
                var checkOutFmt = null, checkOutMs = null;
                var docksSet = {};

                events.forEach(function (ev) {
                    var ts = ev.timestamp;
                    var ms = ts * 1000;
                    var fmt = tsToYmsFmt(ts);
                    var loc = ev.location || '';
                    var et = ev.eventType || '';

                    var ddMatch = loc.match(/(DD\d+)/);
                    if (ddMatch) docksSet[ddMatch[1]] = true;
                    var ddMatch2 = (ev.locationPlanId || '').match(/(DD\d+)/);
                    if (ddMatch2) docksSet[ddMatch2[1]] = true;

                    if (et === 'CHECK_IN' && !checkIn) {
                        checkIn = fmt;
                        checkInMs = ms;
                    }
                    if (et === 'TDR_DOCK' && (!tdrDockMs || ms < tdrDockMs)) {
                        tdrDock = fmt;
                        tdrDockMs = ms;
                    }
                    var isStarted = et === 'OB_DOCK_STARTED' || et === 'IB_DOCK_STARTED';
                    if (isStarted && (!dockStartedMs || ms < dockStartedMs)) {
                        dockStartedMs = ms;
                        dockStartedFmt = fmt;
                    }
                    var isCompleted = et === 'OB_DOCK_COMPLETED' ||
                        (isIbVehicle && (et === 'IB_DOCK_COMPLETED' || et === 'DETACH_LOAD'));
                    if (isCompleted && (!dockCompleted || ms > dockCompleted.ms)) {
                        dockCompleted = { fmt: fmt, ms: ms };
                    }
                    if (et === 'CHECK_OUT' && !checkOutFmt) {
                        checkOutFmt = fmt;
                        checkOutMs = ms;
                    }
                });

                if (checkIn) { GM_setValue('yms_checkin_' + vrid, checkIn); GM_setValue('yms_checkin_ts_' + vrid, now); }
                if (checkInMs) GM_setValue('yms_checkin_ms_' + vrid, checkInMs);
                if (tdrDock) { GM_setValue('yms_tdrdock_' + vrid, tdrDock); GM_setValue('yms_tdrdock_ts_' + vrid, now); }
                if (dockStartedFmt) { GM_setValue('yms_dockstarted_' + vrid, dockStartedFmt); GM_setValue('yms_dockstarted_ts_' + vrid, now); }
                if (dockCompleted) { GM_setValue('yms_obdone_' + vrid, dockCompleted.fmt); GM_setValue('yms_obdone_ts_' + vrid, now); }
                if (checkOutFmt) { GM_setValue('yms_checkout_' + vrid, checkOutFmt); GM_setValue('yms_checkout_ts_' + vrid, now); }
                if (checkOutMs) GM_setValue('yms_checkout_ms_' + vrid, checkOutMs);
                var dockKeys = Object.keys(docksSet);
                if (dockKeys.length) GM_setValue('yms_docks_' + vrid, dockKeys.join(', '));

                GM_setValue('yms_done_' + vrid, checkIn || tdrDock || dockCompleted ? '1' : '0');
                GM_setValue('yms_done_ts_' + vrid, now);
            }

            var _ymsPending = false, _ymsQueue = [];
            function ensureYmsToken(cb) {
                var t = _SUITE.ymsToken || GM_getValue('yms_token', '');
                var ts = GM_getValue('yms_token_ts', 0);
                var isExpired = (Date.now() - ts) > (12 * 60 * 60 * 1000);

                if (t && t.length > 20 && !isExpired) {
                    _SUITE.ymsToken = t; cb(t); return;
                }
                _ymsQueue.push(cb);
                if (_ymsPending) return;
                _ymsPending = true;
                var win = null;
                try { win = window.open(BASE + 'yms/eventHistory', 'yms_token_popup', 'width=1,height=1,left=-300,top=-300,toolbar=no,menubar=no'); } catch (e) { }
                if (!win) {
                    console.warn('[YMS] popup bloqueado ou erro ao abrir');
                    _ymsPending = false;
                    _ymsQueue.splice(0).forEach(function (c) { c(''); });
                    return;
                }
                console.log('[YMS] Aguardando token do YMS (popup aberto)...');
                var start = Date.now();
                var iv = setInterval(function () {
                    var t2 = _SUITE.ymsToken || GM_getValue('yms_token', '');
                    if (t2 && t2.length > 20) {
                        console.log('[YMS] Token capturado com sucesso.');
                        clearInterval(iv); try { win.close(); } catch (e) { }
                        _SUITE.ymsToken = t2; _ymsPending = false;
                        _ymsQueue.splice(0).forEach(function (c) { c(t2); });
                    } else if (Date.now() - start > 15000) {
                        clearInterval(iv); try { win.close(); } catch (e) { }
                        console.warn('[YMS] Timeout ao aguardar token do YMS.');
                        _ymsPending = false;
                        _ymsQueue.splice(0).forEach(function (c) { c(''); });
                    }
                }, 200);
            }

            var _relayPending = false, _relayQueue = [];
            function ensureRelayToken(cb) {
                var t = GM_getValue('relay_token', '');
                var ts = GM_getValue('relay_token_ts', 0);
                if (t && t.length > 30 && (Date.now() - ts) < 840000) { cb(t); return; }
                _relayQueue.push(cb);
                if (_relayPending) return;
                _relayPending = true;
                var win = null;
                try {
                    win = window.open('https://track.relay.amazon.dev/?relay_token_init=1', 'relay_token_popup',
                        'width=1,height=1,left=-300,top=-300,toolbar=no,menubar=no,scrollbars=no,resizable=no,status=no');
                } catch (e) { }
                if (!win) {
                    console.warn('[Relay] popup bloqueado');
                    _relayPending = false;
                    _relayQueue.splice(0).forEach(function (c) { c(''); });
                    return;
                }
                var start = Date.now();
                var iv = setInterval(function () {
                    var t2 = GM_getValue('relay_token', '');
                    var ts2 = GM_getValue('relay_token_ts', 0);
                    if (t2 && t2.length > 30 && ts2 > start) {
                        clearInterval(iv); try { win.close(); } catch (e) { }
                        _relayPending = false;
                        _relayQueue.splice(0).forEach(function (c) { c(t2); });
                    } else if (Date.now() - start > 15000) {
                        clearInterval(iv); try { win.close(); } catch (e) { }
                        console.warn('[Relay] timeout');
                        _relayPending = false;
                        _relayQueue.splice(0).forEach(function (c) { c(''); });
                    }
                }, 200);
            }

            function parseRelayResponse(resp, vrid, onDone) {
                try {
                    var data = JSON.parse(resp.responseText);
                    var item = data && data[0];
                    if (!item) { GM_setValue('cuft_ts_' + vrid, Date.now()); onDone(null); return; }
                    var stop1 = null;
                    if (item.stops) {
                        for (var i = 0; i < item.stops.length; i++) {
                            if (item.stops[i].stopSequenceNumber === 1) { stop1 = item.stops[i]; break; }
                        }
                    }
                    var cuft = null;
                    if (stop1 && stop1.stopManifest && stop1.stopManifest.totalVolume) {
                        var v = stop1.stopManifest.totalVolume;
                        if (v.unit === 'CM3') cuft = (parseFloat(v.value) * 0.0000353147).toFixed(2) + ' Cuft';
                        if (v.unit === 'cuft') cuft = parseFloat(v.value).toFixed(2) + ' Cuft';
                    }
                    if (cuft) GM_setValue('cuft_' + vrid, cuft);
                    GM_setValue('cuft_ts_' + vrid, Date.now());
                    onDone(cuft);
                } catch (e) {
                    console.warn('[Relay] parse error:', e.message);
                    GM_setValue('cuft_ts_' + vrid, Date.now());
                    onDone(null);
                }
            }

            function fetchCuftFromRelay(vrid, onDone) {
                ensureRelayToken(function (token) {
                    if (!token) { GM_setValue('cuft_ts_' + vrid, Date.now()); onDone(null); return; }
                    var url = 'https://track.relay.amazon.dev/api/v2/transport-views'
                        + '?searchId[]=' + vrid
                        + '&module=trip&type[]=vehicleRun&view=detail&sortCol=sent&ascending=true';
                    function doRequest(t) {
                        GM_xmlhttpRequest({
                            method: 'GET', url: url,
                            headers: { 'Authorization': t },
                            onload: function (resp) {
                                if (resp.status === 401) {
                                    GM_setValue('relay_token', ''); GM_setValue('relay_token_ts', 0);
                                    ensureRelayToken(function (t2) {
                                        if (!t2) { GM_setValue('cuft_ts_' + vrid, Date.now()); onDone(null); return; }
                                        GM_xmlhttpRequest({
                                            method: 'GET', url: url, headers: { 'Authorization': t2 },
                                            onload: function (r2) { parseRelayResponse(r2, vrid, onDone); },
                                            onerror: function () { GM_setValue('cuft_ts_' + vrid, Date.now()); onDone(null); },
                                            ontimeout: function () { GM_setValue('cuft_ts_' + vrid, Date.now()); onDone(null); },
                                        });
                                    });
                                    return;
                                }
                                parseRelayResponse(resp, vrid, onDone);
                            },
                            onerror: function () { GM_setValue('cuft_ts_' + vrid, Date.now()); onDone(null); },
                            ontimeout: function () { GM_setValue('cuft_ts_' + vrid, Date.now()); onDone(null); },
                        });
                    }
                    doRequest(token);
                });
            }

            function fetchYmsViaApi(vrid_raw, yard_raw, sdt, isIbVehicle) {
                var vrid = String(vrid_raw).trim().toUpperCase();
                var yard = String(yard_raw).trim().toUpperCase();
                var now = Math.floor(Date.now() / 1000);
                var fromDate = now - 7 * 86400;
                var toDate = now + 86400;
                if (sdt) {
                    var sdtMs = parseSdtToMs(sdt);
                    if (sdtMs) {
                        var range = getYmsDateRange(sdtMs);
                        fromDate = Math.floor(range.fromDate / 1000);
                        toDate = Math.floor(range.toDate / 1000);
                    }
                }

                console.log('[YMS-API] Buscando VRID:', vrid, 'em:', yard, 'Range:', fromDate, '-', toDate);

                var payload = JSON.stringify({
                    firstRow: 0, rowCount: 1000, yard: yard,
                    loadIdentifier: vrid, loadIdentifierType: 'VRID',
                    fromDate: fromDate, toDate: toDate,
                    eventType: '', location: '', vehicleType: '', vehicleOwner: '',
                    vehicleNumber: '', seal: '', userId: '', visitReason: '',
                    licensePlateNumber: '', annotation: '', systemName: '',
                    visitId: '', locationPlanId: '',
                    requester: { system: 'YMSWebApp' }
                });
                var _retried = false;
                function doPost(t) {
                    GM_xmlhttpRequest({
                        method: 'POST',
                        url: YMS_API,
                        headers: {
                            'Content-Type': 'application/json;charset=utf-8',
                            'Accept': 'application/json, text/plain, */*',
                            'api': 'getEventReport',
                            'method': 'POST',
                            'token': t
                        },
                        data: payload,
                        withCredentials: true,
                        onload: function (resp) {
                            console.log('[YMS-API] Resposta recebida, Status:', resp.status);
                            if (resp.status === 401 && !_retried) {
                                console.warn('[YMS-API] Token expirado ou inválido (401), tentando refresh...');
                                _retried = true; _SUITE.ymsToken = ''; GM_setValue('yms_token', '');
                                ensureYmsToken(function (t2) { doPost(t2); }); return;
                            }
                            try {
                                if (resp.status !== 200) throw new Error('HTTP ' + resp.status);
                                var json = JSON.parse(resp.responseText);
                                if (json.events && json.events.length > 0) {
                                    const filtered = json.events.filter(e => {

                                        const evVrid = String(e.vrId || e.vrid || '').trim().toUpperCase();
                                        return evVrid === vrid || evVrid.includes(vrid) || vrid.includes(evVrid) || evVrid.startsWith(vrid + '_');
                                    });

                                    var finalEvents = filtered.length > 0 ? filtered : (json.events.length <= 15 ? json.events : []);

                                    if (finalEvents.length > 0) {
                                        parseAndStoreYmsEvents(vrid, finalEvents, isIbVehicle);
                                    } else if (!_retried) {
                                        console.warn('[YMS-API] VRID não encontrado nos eventos (Filtro Zero)');

                                        GM_setValue('yms_done_' + vrid, '0');
                                        GM_setValue('yms_done_ts_' + vrid, Date.now());
                                    } else {

                                        const msg = document.getElementById('yms-status-msg-' + vrid);
                                        if (msg) {
                                            msg.innerHTML = '<span style="color:#ff4444">Nenhum dado YMS encontrado para este VRID. </span>' +
                                                '<button id="retry-yms-' + vrid + '" style="background:#FF9900;border:none;color:white;padding:2px 8px;border-radius:4px;cursor:pointer;font-size:11px;margin-left:10px;">🔄 Atualizar YMS</button>';
                                            const btn = document.getElementById('retry-yms-' + vrid);
                                            if (btn) btn.onclick = function () {
                                                btn.disabled = true; btn.textContent = '...';
                                                GM_setValue('yms_token', ''); _SUITE.ymsToken = '';
                                                ensureYmsToken(function (t) { msg.textContent = 'Recarregando...'; doPost(t); });
                                            };
                                        }
                                        throw new Error('no match');
                                    }
                                } else {
                                    console.warn('[YMS-API] Lista de eventos vazia returned pela API');
                                    throw new Error('no events');
                                }
                            } catch (e) {
                                console.warn('[YMS-API] Erro no processamento:', e.message);
                                GM_setValue('yms_done_' + vrid, '0');
                                GM_setValue('yms_done_ts_' + vrid, Date.now());
                            }
                        },
                        onerror: function (err) {
                            console.error('[YMS-API] Erro de rede (onerror):', err);
                            GM_setValue('yms_done_' + vrid, '0');
                            GM_setValue('yms_done_ts_' + vrid, Date.now());
                        },
                        ontimeout: function () {
                            console.error('[YMS-API] Timeout na requisição API');
                            GM_setValue('yms_done_' + vrid, '0');
                            GM_setValue('yms_done_ts_' + vrid, Date.now());
                        }
                    });
                }
                ensureYmsToken(function (t) { doPost(t); });
            }

            function fetchInfoCore(vrid, sdt, yard, packages, onDone, skipRtt) {
                const now = Date.now();

                if (!skipRtt) {
                    GM_setValue('cuft_' + vrid, '');
                    GM_setValue('cuft_ts_' + vrid, 0);
                }
                ['yms_checkin_', 'yms_tdrdock_', 'yms_dockstarted_', 'yms_obdone_', 'yms_checkout_', 'yms_done_', 'yms_docks_'].forEach(function (p) {
                    GM_setValue(p + vrid, '');
                    GM_setValue(p + 'ts_' + vrid, 0);
                });
                GM_setValue('yms_checkin_ms_' + vrid, 0);

                if (!skipRtt) fetchCuftFromRelay(vrid, function () { });
                fetchYmsViaApi(vrid, yard, sdt, isIB);

                waitForResults(vrid, 18000, () => {
                    onDone(buildResult(vrid, sdt, packages));
                }, skipRtt);
            }

            function fetchAllInfo(onDone, statusEl) {

                if (isIB) {
                    const candidates = [];
                    document.querySelectorAll('tr[vrid]').forEach(row => {
                        const meta = getRowMeta(row);
                        if (!meta) return;
                        if (infoStore[meta.vrid]) return;
                        const statusElRow = row.querySelector('[class*="originalStatusCheck"][data-status]');
                        const status = statusElRow ? statusElRow.getAttribute('data-status') : '';
                        if (!status) return;
                        const bar = row.querySelector('.progressbarDashboard');
                        if (!bar || !bar.querySelector('.progressLoaded') || bar.querySelector('.width100')) return;
                        candidates.push({ meta, row, status });
                    });
                    if (candidates.length === 0) { onDone(); return; }
                    runInfoBatch(candidates, onDone, statusEl);
                    return;
                }

                if (statusEl) statusEl.textContent = L('scanningPages');

                const firstBtn = document.querySelector('#dashboard_paginate .first');
                if (firstBtn && !firstBtn.classList.contains('ui-state-disabled')) firstBtn.click();

                const allMetas = [];

                function waitForPageLoad(expectedDifferentVrid, cb) {
                    let attempts = 0;
                    const iv = setInterval(() => {
                        attempts++;
                        const firstRow = document.querySelector('tr[vrid]');
                        const v = firstRow ? firstRow.getAttribute('vrid') : null;
                        if ((v && v !== expectedDifferentVrid) || attempts >= 150) {
                            clearInterval(iv); cb();
                        }
                    }, 50);
                }

                function collectPage() {
                    document.querySelectorAll('tr[vrid]').forEach(row => {
                        const meta = getRowMeta(row);
                        if (!meta) return;
                        if (infoStore[meta.vrid]) return;

                        if (allMetas.some(m => m.vrid === meta.vrid)) return;
                        const statusElRow = row.querySelector('[data-status]');
                        const status = statusElRow ? statusElRow.getAttribute('data-status') : '';
                        if (!status || status === 'SCHEDULED') return;
                        allMetas.push({ meta, status });
                    });
                }

                function nextPage(cb) {
                    const nextBtn = document.querySelector('#dashboard_next');
                    if (!nextBtn || nextBtn.classList.contains('ui-state-disabled')) { cb(false); return; }
                    const prevVrid = (document.querySelector('tr[vrid]') || {}).getAttribute
                        ? document.querySelector('tr[vrid]').getAttribute('vrid') : null;
                    nextBtn.click();
                    waitForPageLoad(prevVrid, () => cb(true));
                }

                function scanPages() {
                    collectPage();
                    nextPage(hasNext => {
                        if (hasNext) { scanPages(); return; }

                        if (allMetas.length === 0) { onDone(); return; }
                        if (statusEl) statusEl.textContent = 'Fetching info 0 / ' + allMetas.length + '…';
                        runInfoBatch(allMetas, onDone, statusEl);
                    });
                }

                setTimeout(scanPages, firstBtn && !firstBtn.classList.contains('ui-state-disabled') ? 300 : 0);
            }

            function runInfoBatch(candidates, onDone, statusEl) {
                const CONCURRENCY = 3;
                let started = 0, finished = 0;

                const updateStatus = () => {
                    if (statusEl) statusEl.textContent = 'Fetching info ' + finished + ' / ' + candidates.length + '…';
                };
                updateStatus();

                function startNext() {
                    if (started >= candidates.length) return;
                    const idx = started++;
                    const { meta, row, status } = candidates[idx];
                    const skipRtt = !isIB && status !== 'COMPLETED';

                    const rowBtn = row ? row.querySelector('[data-vrid-getinfo="' + meta.vrid + '"]') : null;
                    if (rowBtn) {
                        rowBtn.textContent = '⏳';
                        rowBtn.className = 'tl-btn tl-btn-gray tl-loading';
                        rowBtn.disabled = true;
                    }
                    fetchInfoCore(meta.vrid, meta.sdt, meta.yard, meta.packages, (data) => {
                        if (rowBtn) {
                            if (data) {
                                rowBtn.textContent = L('getInfo');
                                rowBtn.className = 'tl-btn tl-btn-blue';
                                rowBtn.disabled = false;
                                if (isIB) {
                                    rowBtn.onclick = () => { if (_openIbPanel) _openIbPanel(meta.vrid, meta.sdt, meta.yard, meta.packages, row, status, rowBtn); };
                                } else {
                                    rowBtn.onclick = () => showInfoPanel(meta.vrid, data);
                                }
                            } else {
                                rowBtn.textContent = '⚠ No data';
                                rowBtn.className = 'tl-btn tl-btn-red';
                                rowBtn.disabled = false;
                            }
                        }
                        finished++;
                        updateStatus();
                        if (finished >= candidates.length) { onDone(); return; }
                        startNext();
                    }, skipRtt);
                }

                for (let i = 0; i < Math.min(CONCURRENCY, candidates.length); i++) startNext();
            }

            let fetchSingleRoutes = null;
            let runRoutesForBadge = null;

            function showSettingsPanel() {
                document.querySelectorAll('.rd-settings-overlay').forEach(e => e.remove());
                const isDark = SETTINGS.theme === 'dark';
                const overlay = document.createElement('div');
                overlay.className = 'rd-settings-overlay';
                const panel = document.createElement('div');
                panel.className = 'rd-settings-panel' + (isDark ? ' rd-dark-panel' : '');

                const title = document.createElement('div');
                title.className = 'rd-settings-title';
                title.textContent = L('settingsTitle');
                panel.appendChild(title);

                function makeRow(labelKey, options, currentVal, onPick) {
                    const row = document.createElement('div'); row.className = 'rd-settings-row';
                    const lbl = document.createElement('div'); lbl.className = 'rd-settings-label'; lbl.textContent = L(labelKey);
                    const opts = document.createElement('div'); opts.className = 'rd-settings-options';
                    options.forEach(({ val, label }) => {
                        const btn = document.createElement('button');
                        btn.className = 'rd-settings-opt' + (val === currentVal ? ' active' : '');
                        btn.textContent = label;
                        btn.addEventListener('click', () => {
                            opts.querySelectorAll('.rd-settings-opt').forEach(b => b.classList.remove('active'));
                            btn.classList.add('active');
                            onPick(val);
                        });
                        opts.appendChild(btn);
                    });
                    row.appendChild(lbl); row.appendChild(opts);
                    return row;
                }

                panel.appendChild(makeRow('themeLabel',
                    [{ val: 'light', label: L('themeLight') }, { val: 'dark', label: L('themeDark') }],
                    SETTINGS.theme, val => saveSetting('theme', val)
                ));
                panel.appendChild(makeRow('langLabel',
                    [{ val: 'pt', label: '🇧🇷 Português' }, { val: 'en', label: '🇺🇸 English' }],
                    SETTINGS.lang, val => saveSetting('lang', val)
                ));

                const saveBtn = document.createElement('button');
                saveBtn.className = 'tl-btn tl-btn-blue';
                saveBtn.style.cssText = 'margin-top:8px;width:100%;justify-content:center;';
                saveBtn.textContent = L('saveClose');
                saveBtn.addEventListener('click', () => {
                    overlay.remove();

                    document.querySelectorAll('[data-rd-settings-btn]').forEach(b => {
                        b.textContent = L('settingsTitle');
                        b.title = L('settingsTitle');
                    });

                    document.querySelectorAll('[data-vrid-getinfo]').forEach(b => {
                        if (!b.disabled && !b.textContent.startsWith('⏳') && !b.textContent.startsWith('⏸') && !b.textContent.startsWith('⚠')) {
                            b.textContent = L('getInfo');
                        }
                    });

                    document.querySelectorAll('[data-rd-btn]').forEach(b => {
                        b.textContent = L('routesBtn');
                    });

                    document.querySelectorAll('[data-lkey]').forEach(el => {
                        el.textContent = L(el.getAttribute('data-lkey')) + ':';
                    });
                });
                panel.appendChild(saveBtn);
                overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
                overlay.appendChild(panel);
                document.body.appendChild(overlay);
            }

            if (isIB) {
                function pctColor(pct) {
                    if (pct >= 30) return '#c0392b';
                    if (pct >= 15) return '#e67e22';
                    if (pct >= 5) return '#f1c40f';
                    return '#27ae60';
                }

                function pctColorDark(pct) {
                    if (pct >= 30) return '#ff6b6b';
                    if (pct >= 15) return '#ffaa57';
                    if (pct >= 5) return '#ffe066';
                    return '#69f0ae';
                }

                function resolvedPctColor(pct) {
                    return SETTINGS.theme === 'dark' ? pctColorDark(pct) : pctColor(pct);
                }

                function makePanel(headerClass, headerText, totalVal, rows, sortKey, routeVridMap) {
                    const dark = SETTINGS.theme === 'dark';
                    const panel = document.createElement('div');
                    panel.className = 'rd-panel';
                    const ph = document.createElement('div');
                    ph.className = 'rd-panel-header ' + headerClass;
                    ph.innerHTML = `${headerText} <span style="float:right">${totalVal.toLocaleString('en-US')}</span>`;
                    panel.appendChild(ph);
                    const scroll = document.createElement('div');
                    scroll.className = 'rd-panel-scroll';
                    rows.slice().sort((a, b) => b[sortKey] - a[sortKey]).forEach(r => {
                        const val = r[sortKey];
                        const pct = totalVal > 0 ? (val / totalVal) * 100 : 0;

                        const row = document.createElement('div');
                        row.className = 'rd-route-row';
                        const name = document.createElement('div');
                        name.className = 'rd-route-name';
                        name.textContent = r.route;
                        name.title = r.route;
                        const pkgs = document.createElement('div');
                        pkgs.className = 'rd-route-pkgs';
                        pkgs.textContent = val.toLocaleString('en-US');
                        const barWrap = document.createElement('div');
                        barWrap.className = 'rd-bar-wrap';
                        const barFill = document.createElement('div');
                        barFill.className = 'rd-bar-fill';
                        barFill.style.width = pct.toFixed(1) + '%';
                        barFill.style.background = resolvedPctColor(pct);
                        barWrap.appendChild(barFill);
                        const pctLabel = document.createElement('div');
                        pctLabel.className = 'rd-pct-label';
                        pctLabel.textContent = pct.toFixed(1) + '%';
                        pctLabel.style.color = resolvedPctColor(pct);
                        row.appendChild(name); row.appendChild(pkgs); row.appendChild(barWrap); row.appendChild(pctLabel);
                        scroll.appendChild(row);

                        if (r.cpts && r.cpts.length > 0) {
                            const cptList = document.createElement('div');
                            cptList.className = 'rd-cpt-list';
                            r.cpts.slice().sort((a, b) => b[sortKey] - a[sortKey]).forEach(c => {
                                const cVal = c[sortKey];
                                if (!cVal) return;
                                const cPct = val > 0 ? (cVal / val) * 100 : 0;
                                const chip = document.createElement('span');
                                chip.className = 'rd-cpt-chip';
                                chip.title = `${c.cpt}: ${cVal.toLocaleString('en-US')} pkgs (${cPct.toFixed(1)}% of route)`;
                                chip.innerHTML = `<span class="rd-cpt-name">${c.cpt}</span><span class="rd-cpt-pkgs">${cVal.toLocaleString('en-US')}</span><span class="rd-cpt-pct" style="color:${resolvedPctColor(cPct)}">${cPct.toFixed(1)}%</span>`;
                                cptList.appendChild(chip);
                            });
                            scroll.appendChild(cptList);
                        }

                        if (sortKey === 'remaining' && routeVridMap && routeVridMap[r.route]) {
                            const vridEntries = Object.entries(routeVridMap[r.route])
                                .map(([vrid, v]) => ({ vrid, pkgs: v.pkgs, lane: v.lane }))
                                .filter(v => v.pkgs > 0)
                                .sort((a, b) => b.pkgs - a.pkgs)
                                .slice(0, 4);
                            if (vridEntries.length > 0) {
                                const subRow = document.createElement('div');
                                subRow.className = 'rd-vrid-sub';
                                vridEntries.forEach(v => {
                                    const chip = document.createElement('span');
                                    chip.className = 'rd-vrid-sub-item' + (dark ? ' rd-vrid-sub-dark' : '');
                                    chip.title = `${v.vrid} · ${v.pkgs.toLocaleString('en-US')} pkgs restantes`;
                                    chip.innerHTML = `🚛 <strong style="color:${dark ? '#c5cae9' : '#1a237e'}">${v.vrid}</strong>${v.lane ? `<span class="rd-vrid-sub-lane">${v.lane}</span>` : ''}<span class="rd-vrid-sub-pkgs" style="color:${dark ? '#90caf9' : '#0d47a1'}">${v.pkgs.toLocaleString('en-US')}</span>`;
                                    subRow.appendChild(chip);
                                });
                                scroll.appendChild(subRow);
                            }
                        }
                    });
                    panel.appendChild(scroll);
                    return panel;
                }

                function downloadExcel(title, routes, total, xdData, cptAnalysis, routeVridMap, vridSdtMap) {
                    if (typeof XLSX === 'undefined') { alert('SheetJS not loaded.'); return; }
                    const wb = XLSX.utils.book_new();
                    const totalRemaining = routes.reduce((s, r) => s + r.remaining, 0);
                    const sorted = routes.slice().sort((a, b) => b.pkgs - a.pkgs);

                    function routeSheet(sortKey, grandTotal) {
                        const rows = [['Route', 'Pkgs', '%', 'CPT', 'CPT Pkgs', 'CPT %']];
                        sorted.slice().sort((a, b) => b[sortKey] - a[sortKey]).forEach(r => {
                            const val = r[sortKey];
                            const pct = grandTotal > 0 ? (val / grandTotal * 100).toFixed(1) + '%' : '0.0%';
                            const cpts = (r.cpts || []).slice().sort((a, b) => b[sortKey] - a[sortKey]);
                            if (cpts.length === 0) {
                                rows.push([r.route, val, pct, '', '', '']);
                            } else {
                                cpts.forEach((c, i) => {
                                    const cv = sortKey === 'pkgs' ? c.pkgs : c.remaining;
                                    const cpct = val > 0 ? (cv / val * 100).toFixed(1) + '%' : '0.0%';
                                    rows.push(i === 0 ? [r.route, val, pct, c.cpt, cv, cpct] : ['', '', '', c.cpt, cv, cpct]);
                                });
                            }
                        });
                        rows.push(['TOTAL', grandTotal, '100%', '', '', '']);
                        const ws = XLSX.utils.aoa_to_sheet(rows);
                        ws['!cols'] = [{ wch: 20 }, { wch: 10 }, { wch: 8 }, { wch: 22 }, { wch: 10 }, { wch: 8 }];
                        return ws;
                    }

                    XLSX.utils.book_append_sheet(wb, routeSheet('pkgs', total), 'Total');

                    XLSX.utils.book_append_sheet(wb, routeSheet('remaining', totalRemaining), L('tabRemaining').replace(/[^a-zA-Z0-9 ]/g, ''));

                    if (xdData && xdData.vrids && Object.keys(xdData.vrids).length > 0) {
                        const rows = [['VRID', 'Lane', 'Pkgs', 'Pallets', 'Route', 'Route Pkgs', 'Route Pallets']];
                        Object.entries(xdData.vrids).sort((a, b) => b[1].pkgs - a[1].pkgs).forEach(([vrid, d]) => {
                            const routeList = Object.entries(d.routes || {}).sort((a, b) => b[1].pkgs - a[1].pkgs);
                            if (routeList.length === 0) {
                                rows.push([vrid, d.lane || '', d.pkgs, d.pallets, '', '', '']);
                            } else {
                                routeList.forEach(([r, rv], i) => {
                                    rows.push(i === 0 ? [vrid, d.lane || '', d.pkgs, d.pallets, r, rv.pkgs, rv.pallets]
                                        : ['', '', '', '', r, rv.pkgs, rv.pallets]);
                                });
                            }
                        });
                        const ws = XLSX.utils.aoa_to_sheet(rows);
                        ws['!cols'] = [{ wch: 16 }, { wch: 14 }, { wch: 8 }, { wch: 8 }, { wch: 20 }, { wch: 10 }, { wch: 12 }];
                        XLSX.utils.book_append_sheet(wb, ws, 'X-Dock');
                    }

                    if (cptAnalysis && Object.keys(cptAnalysis).length > 0) {
                        const rows = [['CPT', 'VRID', 'Lane', L('restantes'), 'Route', 'Route Pkgs']];
                        Object.keys(cptAnalysis).sort().forEach(cpt => {
                            const vridMap = cptAnalysis[cpt];
                            Object.entries(vridMap).sort((a, b) => b[1].pkgs - a[1].pkgs).forEach(([vrid, data], vi) => {
                                const routeList = Object.entries(data.routes || {}).sort((a, b) => b[1] - a[1]);
                                if (routeList.length === 0) {
                                    rows.push([vi === 0 ? cpt : '', vrid, data.lane || '', data.pkgs, '', '']);
                                } else {
                                    routeList.forEach(([r, rp], ri) => {
                                        rows.push([(vi === 0 && ri === 0) ? cpt : '', ri === 0 ? vrid : '', ri === 0 ? (data.lane || '') : '', ri === 0 ? data.pkgs : '', r, rp]);
                                    });
                                }
                            });
                        });
                        const ws = XLSX.utils.aoa_to_sheet(rows);
                        ws['!cols'] = [{ wch: 20 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 20 }, { wch: 10 }];
                        XLSX.utils.book_append_sheet(wb, ws, L('cptPriority').replace(/[^a-zA-Z0-9 ]/g, ''));
                    }

                    if (cptAnalysis && vridSdtMap && Object.keys(vridSdtMap).length > 0) {
                        function parseDtLocal(s) {
                            if (!s) return 0;
                            const mo = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11, Fev: 1, Abr: 3, Mai: 4, Ago: 7, Set: 8, Out: 9, Dez: 11 };
                            const m = s.trim().match(/(\d{2})-([A-Za-z]{3})-(\d{2,4})\s+(\d{2}):(\d{2})/);
                            if (!m) return 0;
                            const yr = parseInt(m[3]) < 100 ? 2000 + parseInt(m[3]) : parseInt(m[3]);
                            const mon = mo[m[2]]; if (mon === undefined) return 0;
                            return new Date(yr, mon, parseInt(m[1]), parseInt(m[4]), parseInt(m[5])).getTime();
                        }
                        const lateRows = [['VRID', 'SAT', 'CPT', 'Pkgs', 'Tipo']];
                        let hasData = false;
                        Object.entries(cptAnalysis).forEach(([cpt, vridMap]) => {
                            const cptMs = parseDtLocal(cpt);
                            if (!cptMs) return;
                            Object.entries(vridMap).forEach(([vrid, data]) => {
                                const sdtMs = parseDtLocal(vridSdtMap[vrid]);
                                if (!sdtMs) return;
                                const pkgs = data.pkgs || 0;
                                let tipo = null;
                                if (cptMs < sdtMs) tipo = 'Atrasado';
                                else if (cptMs > sdtMs + 24 * 3600 * 1000) tipo = 'Adiantado';
                                if (tipo) { lateRows.push([vrid, vridSdtMap[vrid] || '', cpt, pkgs, tipo]); hasData = true; }
                            });
                        });
                        if (hasData) {
                            lateRows.slice(1).sort((a, b) => {
                                if (a[4] !== b[4]) return a[4] === 'Atrasado' ? -1 : 1;
                                return a[0].localeCompare(b[0]);
                            });
                            const ws = XLSX.utils.aoa_to_sheet(lateRows);
                            ws['!cols'] = [{ wch: 16 }, { wch: 18 }, { wch: 20 }, { wch: 8 }, { wch: 12 }];
                            XLSX.utils.book_append_sheet(wb, ws, L('latePkgsWord') + ' & ' + L('earlyPkgsWord'));
                        }
                    }

                    const ts = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', 'h').replace(':', 'm');
                    XLSX.writeFile(wb, `routes_${ts}.xlsx`);
                }

                function showRoutesPopup(title, subtitle, routes, total, xdData, cptAnalysis, routeVridMap, vridSdtMap) {
                    document.querySelectorAll('.rd-popup-overlay').forEach(el => el.remove());
                    const isDark = SETTINGS.theme === 'dark';
                    const overlay = document.createElement('div');
                    overlay.className = 'rd-popup-overlay';
                    const popup = document.createElement('div');
                    popup.className = 'rd-popup' + (isDark ? ' rd-dark' : '');

                    const header = document.createElement('div');
                    header.className = 'rd-popup-header';
                    header.innerHTML = `
                    <div>
                        <div class="rd-popup-title">${title}</div>
                        <div class="rd-popup-sub">${subtitle}</div>
                    </div>
                    <div style="display:flex;gap:6px;align-items:center;">
                        <button class="tl-btn tl-btn-green rd-export-btn" title="Download Excel">⬇ Excel</button>
                        <button class="rd-popup-close" title="Close">✕</button>
                    </div>`;
                    header.querySelector('.rd-popup-close').addEventListener('click', () => overlay.remove());
                    header.querySelector('.rd-export-btn').addEventListener('click', () => downloadExcel(subtitle, routes, total, xdData, cptAnalysis, routeVridMap, vridSdtMap));
                    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
                    const onEsc = e => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onEsc); } };
                    document.addEventListener('keydown', onEsc);
                    ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se'].forEach(dir => {
                        const h = document.createElement('div');
                        h.className = `rd-resize-handle rd-resize-${dir}`;
                        popup.appendChild(h);
                        h.addEventListener('mousedown', e => {
                            e.preventDefault();
                            e.stopPropagation();
                            const r = popup.getBoundingClientRect();
                            popup.style.transform = 'none';
                            popup.style.left = r.left + 'px';
                            popup.style.top = r.top + 'px';
                            popup.style.width = r.width + 'px';
                            popup.style.height = r.height + 'px';
                            const startX = e.clientX, startY = e.clientY;
                            const startL = r.left, startT = r.top, startW = r.width, startH = r.height;
                            function onMove(ev) {
                                const dx = ev.clientX - startX, dy = ev.clientY - startY;
                                if (dir.includes('e')) popup.style.width = Math.max(320, startW + dx) + 'px';
                                if (dir.includes('s')) popup.style.height = Math.max(200, startH + dy) + 'px';
                                if (dir.includes('w')) { const w = Math.max(320, startW - dx); popup.style.width = w + 'px'; popup.style.left = (startL + startW - w) + 'px'; }
                                if (dir.includes('n')) { const h = Math.max(200, startH - dy); popup.style.height = h + 'px'; popup.style.top = (startT + startH - h) + 'px'; }
                            }
                            function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }
                            document.addEventListener('mousemove', onMove);
                            document.addEventListener('mouseup', onUp);
                        });
                    });
                    let dragX = 0, dragY = 0, dragging = false;
                    header.addEventListener('mousedown', e => {
                        if (e.target.closest('button')) return;
                        dragging = true;
                        const r = popup.getBoundingClientRect();
                        popup.style.transform = 'none';
                        popup.style.left = r.left + 'px';
                        popup.style.top = r.top + 'px';
                        dragX = e.clientX - r.left;
                        dragY = e.clientY - r.top;
                        e.preventDefault();
                    });
                    document.addEventListener('mousemove', e => {
                        if (!dragging) return;
                        popup.style.left = (e.clientX - dragX) + 'px';
                        popup.style.top = (e.clientY - dragY) + 'px';
                    });
                    document.addEventListener('mouseup', () => { dragging = false; });

                    const totalRemaining = routes.reduce((s, r) => s + r.remaining, 0);

                    function parseDateLocalMs(s) {
                        if (!s) return 0;
                        const mo = {
                            Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
                            Fev: 1, Abr: 3, Mai: 4, Ago: 7, Set: 8, Out: 9, Dez: 11
                        };
                        const m = s.trim().match(/(\d{2})-([A-Za-z]{3})-(\d{2,4})\s+(\d{2}):(\d{2})/);
                        if (!m) return 0;
                        const yr = parseInt(m[3]) < 100 ? 2000 + parseInt(m[3]) : parseInt(m[3]);
                        const mon = mo[m[2]];
                        if (mon === undefined) return 0;
                        return new Date(yr, mon, parseInt(m[1]), parseInt(m[4]), parseInt(m[5])).getTime();
                    }

                    let latePkgs = 0, earlyPkgs = 0;
                    const lateByVrid = {};
                    const earlyByVrid = {};
                    if (cptAnalysis && vridSdtMap && Object.keys(vridSdtMap).length > 0) {
                        Object.entries(cptAnalysis).forEach(([cpt, vridMap]) => {
                            const cptMs = parseDateLocalMs(cpt);
                            if (!cptMs) return;
                            Object.entries(vridMap).forEach(([vrid, data]) => {
                                const sdtMs = parseDateLocalMs(vridSdtMap[vrid]);
                                if (!sdtMs) return;
                                const pkgs = data.pkgs || 0;
                                if (cptMs < sdtMs) {
                                    latePkgs += pkgs;
                                    if (!lateByVrid[vrid]) lateByVrid[vrid] = { pkgs: 0, sdt: vridSdtMap[vrid], lane: data.lane || null, cpts: [] };
                                    lateByVrid[vrid].pkgs += pkgs;
                                    lateByVrid[vrid].cpts.push({ cpt, pkgs });
                                } else if (cptMs > sdtMs + 24 * 3600 * 1000) {
                                    earlyPkgs += pkgs;
                                    if (!earlyByVrid[vrid]) earlyByVrid[vrid] = { pkgs: 0, sdt: vridSdtMap[vrid], lane: data.lane || null, cpts: [] };
                                    earlyByVrid[vrid].pkgs += pkgs;
                                    earlyByVrid[vrid].cpts.push({ cpt, pkgs });
                                }
                            });
                        });
                    }

                    const paneTotal = makePanel('rd-panel-header-total', L('total'), total, routes, 'pkgs', null);
                    paneTotal.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden;min-height:0;';

                    if (latePkgs > 0 || earlyPkgs > 0) {
                        const ph = paneTotal.querySelector('.rd-panel-header');
                        if (ph) {
                            ph.style.cssText += ';display:block;';
                            const onTimePkgs = total - latePkgs - earlyPkgs;
                            const latePct = total > 0 ? (latePkgs / total * 100).toFixed(1) : '0.0';
                            const earlyPct = total > 0 ? (earlyPkgs / total * 100).toFixed(1) : '0.0';
                            const onTimePct = total > 0 ? (onTimePkgs / total * 100).toFixed(1) : '0.0';
                            const badges = document.createElement('div');
                            badges.style.cssText = 'display:flex;gap:6px;margin-top:4px;flex-wrap:wrap;align-items:center;';
                            const onTimeB = document.createElement('span');
                            onTimeB.title = L('onTimeTitle');
                            onTimeB.style.cssText = 'font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;background:#2e7d32;color:#fff;white-space:nowrap;';
                            onTimeB.textContent = `🟢 ${onTimePkgs.toLocaleString('en-US')} on-time (${onTimePct}%)`;
                            badges.appendChild(onTimeB);
                            if (latePkgs > 0) {
                                const lateBadgeEl = document.createElement('span');
                                lateBadgeEl.title = L('lateTitle');
                                lateBadgeEl.style.cssText = 'font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;background:#c62828;color:#fff;white-space:nowrap;cursor:pointer;user-select:none;';
                                lateBadgeEl.textContent = '🔴 ' + latePkgs.toLocaleString('en-US') + ' ' + L('latePkgsWord') + ' (' + latePct + '%) ▾';
                                badges.appendChild(lateBadgeEl);
                            }
                            if (earlyPkgs > 0) {
                                const earlyBadge = document.createElement('span');
                                earlyBadge.title = L('earlyTitle');
                                earlyBadge.style.cssText = 'font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;background:#e65100;color:#fff;white-space:nowrap;cursor:pointer;user-select:none;';
                                earlyBadge.textContent = '🟡 ' + earlyPkgs.toLocaleString('en-US') + ' ' + L('earlyPkgsWord') + ' (' + earlyPct + '%) ▾';
                                badges.appendChild(earlyBadge);
                            }

                            ph.appendChild(badges);

                            if (latePkgs > 0) {
                                const lateBadgeEl = Array.from(badges.querySelectorAll('span')).find(s => s.textContent.includes(L('latePkgsWord')));
                                const lateList = document.createElement('div');
                                lateList.style.cssText = 'display:none;margin-top:8px;';
                                const lC = isDark
                                    ? { row: '1px solid rgba(255,255,255,0.1)', vrid: '#fff', lane: '#ffcdd2', sat: '#ef9a9a', pkgs: '#ffcdd2', chipBg: 'rgba(255,255,255,0.15)', chipTxt: '#fff' }
                                    : { row: '1px solid rgba(0,0,0,0.08)', vrid: '#b71c1c', lane: '#c62828', sat: '#c62828', pkgs: '#b71c1c', chipBg: '#ffcdd2', chipTxt: '#b71c1c' };
                                Object.entries(lateByVrid).sort((a, b) => b[1].pkgs - a[1].pkgs).forEach(([vrid, info]) => {
                                    const lrow = document.createElement('div');
                                    lrow.style.cssText = `display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:${lC.row};flex-wrap:wrap;`;
                                    const vl = document.createElement('span'); vl.style.cssText = `font-size:11px;font-weight:800;color:${lC.vrid};min-width:105px;white-space:nowrap;`;
                                    vl.innerHTML = vrid + (info.lane ? `<span style="font-weight:400;font-size:10px;color:${lC.lane};opacity:0.7;margin-left:6px;">${info.lane}</span>` : '');
                                    const sl = document.createElement('span'); sl.style.cssText = `font-size:10px;color:${lC.sat};min-width:115px;`; sl.textContent = `${L('sat')}: ${info.sdt}`;
                                    const pl = document.createElement('span'); pl.style.cssText = `font-size:10px;font-weight:700;color:${lC.pkgs};min-width:65px;`; pl.textContent = `${info.pkgs.toLocaleString('en-US')} pkgs`;
                                    const cc = document.createElement('div'); cc.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';
                                    info.cpts.sort((a, b) => parseDateLocalMs(a.cpt) - parseDateLocalMs(b.cpt)).forEach(c => {
                                        const chip = document.createElement('span');
                                        chip.style.cssText = `font-size:9px;padding:1px 6px;border-radius:8px;background:${lC.chipBg};color:${lC.chipTxt};white-space:nowrap;font-weight:600;`;
                                        chip.textContent = `${c.cpt} (${c.pkgs})`; cc.appendChild(chip);
                                    });
                                    lrow.appendChild(vl);
                                    lrow.appendChild(sl); lrow.appendChild(pl); lrow.appendChild(cc);
                                    lateList.appendChild(lrow);
                                });
                                ph.appendChild(lateList);
                                let lateExp = false;
                                lateBadgeEl.addEventListener('click', () => {
                                    lateExp = !lateExp;
                                    lateList.style.display = lateExp ? 'block' : 'none';
                                    lateBadgeEl.textContent = '🔴 ' + latePkgs.toLocaleString('en-US') + ' ' + L('latePkgsWord') + ' (' + latePct + '%) ' + (lateExp ? '▴' : '▾');
                                });
                            }

                            if (earlyPkgs > 0) {
                                const earlyBadge = Array.from(badges.querySelectorAll('span')).find(s => s.textContent.includes(L('earlyPkgsWord')));
                                const earlyList = document.createElement('div');
                                earlyList.style.cssText = 'display:none;margin-top:8px;';
                                const eC = isDark
                                    ? { row: '1px solid rgba(255,255,255,0.1)', vrid: '#fff', lane: '#ffe082', sat: '#ffcc80', pkgs: '#ffe082', chipBg: 'rgba(255,255,255,0.15)', chipTxt: '#fff' }
                                    : { row: '1px solid rgba(0,0,0,0.08)', vrid: '#e65100', lane: '#bf360c', sat: '#bf360c', pkgs: '#e65100', chipBg: '#ffe0b2', chipTxt: '#bf360c' };
                                Object.entries(earlyByVrid).sort((a, b) => b[1].pkgs - a[1].pkgs).forEach(([vrid, info]) => {
                                    const erow = document.createElement('div');
                                    erow.style.cssText = `display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:${eC.row};flex-wrap:wrap;`;
                                    const vl = document.createElement('span'); vl.style.cssText = `font-size:11px;font-weight:800;color:${eC.vrid};min-width:105px;white-space:nowrap;`;
                                    vl.innerHTML = vrid + (info.lane ? `<span style="font-weight:400;font-size:10px;color:${eC.lane};opacity:0.7;margin-left:6px;">${info.lane}</span>` : '');
                                    const sl = document.createElement('span'); sl.style.cssText = `font-size:10px;color:${eC.sat};min-width:115px;`; sl.textContent = `${L('sat')}: ${info.sdt}`;
                                    const pl = document.createElement('span'); pl.style.cssText = `font-size:10px;font-weight:700;color:${eC.pkgs};min-width:65px;`; pl.textContent = `${info.pkgs.toLocaleString('en-US')} pkgs`;
                                    const cc = document.createElement('div'); cc.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';
                                    info.cpts.sort((a, b) => parseDateLocalMs(a.cpt) - parseDateLocalMs(b.cpt)).forEach(c => {
                                        const chip = document.createElement('span');
                                        chip.style.cssText = `font-size:9px;padding:1px 6px;border-radius:8px;background:${eC.chipBg};color:${eC.chipTxt};white-space:nowrap;font-weight:600;`;
                                        chip.textContent = `${c.cpt} (${c.pkgs})`; cc.appendChild(chip);
                                    });
                                    erow.appendChild(vl);
                                    erow.appendChild(sl); erow.appendChild(pl); erow.appendChild(cc);
                                    earlyList.appendChild(erow);
                                });
                                ph.appendChild(earlyList);
                                let earlyExp = false;
                                earlyBadge.addEventListener('click', () => {
                                    earlyExp = !earlyExp;
                                    earlyList.style.display = earlyExp ? 'block' : 'none';
                                    earlyBadge.textContent = '🟡 ' + earlyPkgs.toLocaleString('en-US') + ' ' + L('earlyPkgsWord') + ' (' + earlyPct + '%) ' + (earlyExp ? '▴' : '▾');
                                });
                            }
                        }
                    }

                    const paneRemaining = makePanel('rd-panel-header-rest', L('tabRemaining'), totalRemaining, routes, 'remaining', routeVridMap || null);
                    paneRemaining.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden;min-height:0;';

                    const xdTotalPkgs = xdData ? (xdData.pkgs || 0) : 0;
                    const xdTotalPallets = xdData ? (xdData.pallets || 0) : 0;
                    const xdVrids = xdData && xdData.vrids
                        ? Object.entries(xdData.vrids)
                            .map(([v, d]) => ({ vrid: v, pkgs: d.pkgs, pallets: d.pallets, lane: d.lane, routes: Object.entries(d.routes || {}).map(([r, rv]) => ({ route: r, pkgs: rv.pkgs, pallets: rv.pallets })).sort((a, b) => b.pkgs - a.pkgs) }))
                            .filter(v => v.pallets > 0)
                            .sort((a, b) => b.pkgs - a.pkgs)
                        : [];
                    let paneXd = null;
                    if (xdVrids.length > 0) {
                        paneXd = document.createElement('div');
                        paneXd.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden;min-height:0;';
                        const xdScroll = document.createElement('div');
                        xdScroll.className = 'rd-panel-scroll';
                        xdScroll.style.flex = '1';

                        const xdC = isDark
                            ? { title: '#ffcc80', info: '#ffaa57', border: '#4a2800', vridName: '#d0d0e8', lane: '#8080a8', vridInfo: '#ffaa57', routeName: '#b0b0cc', pallet: '#ffaa57', bar: '#ff8c42', pct: '#ffaa57' }
                            : { title: '#e65100', info: '#bf360c', border: '#ffe0b2', vridName: '#333', lane: '#888', vridInfo: '#e65100', routeName: '#555', pallet: '#e65100', bar: '#e65100', pct: '#e65100' };

                        const xdTotalHeader = document.createElement('div');
                        xdTotalHeader.style.cssText = `padding:6px 0 4px;border-bottom:2px solid ${xdC.border};display:flex;align-items:center;gap:6px;margin-bottom:4px;`;
                        const xdTotalTitle = document.createElement('div'); xdTotalTitle.style.cssText = `flex:1;font-size:11px;font-weight:800;color:${xdC.title};`; xdTotalTitle.textContent = 'X-Dock restante';
                        const xdTotalInfo = document.createElement('div'); xdTotalInfo.style.cssText = `font-size:11px;font-weight:700;color:${xdC.info};white-space:nowrap;`; xdTotalInfo.textContent = `${xdTotalPkgs.toLocaleString('en-US')} pkgs · ${xdTotalPallets} Pallets`;
                        xdTotalHeader.appendChild(xdTotalTitle); xdTotalHeader.appendChild(xdTotalInfo);
                        xdScroll.appendChild(xdTotalHeader);

                        xdVrids.forEach(v => {

                            const vridRow = document.createElement('div');
                            vridRow.style.cssText = 'padding:5px 0 2px;display:flex;align-items:center;gap:6px;margin-top:6px;';
                            const vridName = document.createElement('div'); vridName.style.cssText = `flex:1;font-size:11px;font-weight:800;color:${xdC.vridName};`;
                            vridName.innerHTML = `<span>${v.vrid}</span>${v.lane ? `<span style="font-weight:400;color:${xdC.lane};font-size:10px;margin-left:5px">${v.lane}</span>` : ''}`;
                            const vridInfo = document.createElement('div'); vridInfo.style.cssText = `font-size:11px;font-weight:700;color:${xdC.vridInfo};white-space:nowrap;`;
                            vridInfo.textContent = `${v.pkgs.toLocaleString('en-US')} pkgs · ${v.pallets} Pallets`;
                            vridRow.appendChild(vridName); vridRow.appendChild(vridInfo);
                            xdScroll.appendChild(vridRow);

                            v.routes.forEach(r => {
                                const pct = v.pkgs > 0 ? (r.pkgs / v.pkgs) * 100 : 0;
                                const routeRow = document.createElement('div'); routeRow.className = 'rd-route-row'; routeRow.style.paddingLeft = '10px';
                                const routeName = document.createElement('div'); routeName.className = 'rd-route-name'; routeName.style.color = xdC.routeName; routeName.textContent = r.route; routeName.title = r.route;
                                const routePkgs = document.createElement('div'); routePkgs.className = 'rd-route-pkgs'; routePkgs.textContent = r.pkgs.toLocaleString('en-US');
                                const palletBadge = document.createElement('div'); palletBadge.style.cssText = `font-size:10px;color:${xdC.pallet};white-space:nowrap;min-width:52px;text-align:right`; palletBadge.textContent = r.pallets + ' Pallets';
                                const barWrap = document.createElement('div'); barWrap.className = 'rd-bar-wrap';
                                const barFill = document.createElement('div'); barFill.className = 'rd-bar-fill'; barFill.style.cssText = `width:${pct.toFixed(1)}%;background:${xdC.bar};`; barWrap.appendChild(barFill);
                                const pctLabel = document.createElement('div'); pctLabel.className = 'rd-pct-label'; pctLabel.style.color = xdC.pct; pctLabel.textContent = pct.toFixed(1) + '%';
                                routeRow.appendChild(routeName); routeRow.appendChild(routePkgs); routeRow.appendChild(palletBadge); routeRow.appendChild(barWrap); routeRow.appendChild(pctLabel);
                                xdScroll.appendChild(routeRow);
                            });
                        });

                        paneXd.appendChild(xdScroll);
                    }

                    let paneCpt = null;
                    if (cptAnalysis && Object.keys(cptAnalysis).length > 0) {
                        const parseCptDate = s => {
                            const m = s.match(/(\d{2})-([A-Za-z]{3})-(\d{2,4})\s+(\d{2}):(\d{2})/);
                            if (!m) return 0;
                            const mo = {
                                Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
                                Fev: 2, Abr: 4, Mai: 5, Ago: 8, Set: 9, Out: 10, Dez: 12
                            };
                            const yr = parseInt(m[3]) < 100 ? 2000 + parseInt(m[3]) : parseInt(m[3]);
                            const mon = mo[m[2]];
                            if (!mon) return 0;

                            return yr * 100000000 + mon * 1000000 + parseInt(m[1]) * 10000 + parseInt(m[4]) * 100 + parseInt(m[5]);
                        };
                        const _n = new Date();
                        const nowNaive = _n.getFullYear() * 100000000 + (_n.getMonth() + 1) * 1000000 + _n.getDate() * 10000 + _n.getHours() * 100 + _n.getMinutes();
                        const sortedCpts = Object.keys(cptAnalysis).sort((a, b) => parseCptDate(a) - parseCptDate(b)); paneCpt = document.createElement('div');
                        paneCpt.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden;min-height:0;';

                        let hideExpired = false;
                        const toggleBar = document.createElement('div');
                        toggleBar.style.cssText = `display:flex;align-items:center;gap:8px;padding:5px 12px;border-bottom:1px solid ${isDark ? '#3a3a5e' : '#e0e0e0'};flex-shrink:0;background:${isDark ? '#252535' : '#f9f9f9'};`;
                        const toggleBtn = document.createElement('button');
                        toggleBtn.style.cssText = `font-size:10px;font-weight:700;font-family:'Amazon Ember',Arial,sans-serif;padding:2px 10px;border-radius:20px;border:1px solid ${isDark ? '#4a4a6e' : '#bbb'};background:${isDark ? '#2a2a4e' : '#fff'};color:${isDark ? '#c0c0e0' : '#444'};cursor:pointer;`;
                        const updateToggle = () => {
                            toggleBtn.textContent = hideExpired ? L('showExpired') : L('hideExpired');
                        };
                        updateToggle();
                        toggleBar.appendChild(toggleBtn);
                        paneCpt.appendChild(toggleBar);

                        const cptScroll = document.createElement('div');
                        cptScroll.className = 'rd-panel-scroll';
                        cptScroll.style.flex = '1';

                        const cptC = isDark
                            ? {
                                border: '#3a1a4a', cptName: '#ce93d8', cptTotal: '#ba68c8', vridName: '#d0d0e8', lane: '#8080a8', bar: '#ab47bc', pct: '#ce93d8',
                                expiredBg: '#2a0a0a', expiredBorder: '#7a1a1a', expiredName: '#ff8a80', expiredTotal: '#ff5252', expiredBadge: '#ff1744'
                            }
                            : {
                                border: '#e1bee7', cptName: '#4a148c', cptTotal: '#6a1b9a', vridName: '#333', lane: '#888', bar: '#9c27b0', pct: '#7b1fa2',
                                expiredBg: '#fff3f3', expiredBorder: '#f44336', expiredName: '#b71c1c', expiredTotal: '#c62828', expiredBadge: '#f44336'
                            };

                        const cptBlocks = [];

                        sortedCpts.forEach(cpt => {
                            const vrids = Object.entries(cptAnalysis[cpt])
                                .map(([vrid, v]) => ({ vrid, pkgs: v.pkgs, lane: v.lane, routes: v.routes || {} }))
                                .filter(v => v.pkgs > 0)
                                .sort((a, b) => b.pkgs - a.pkgs);
                            if (vrids.length === 0) return;
                            const cptTotal = vrids.reduce((s, v) => s + v.pkgs, 0);
                            const cptMs = parseCptDate(cpt);
                            const expired = cptMs > 0 && nowNaive > cptMs;

                            const block = document.createElement('div');
                            block.dataset.expired = expired ? '1' : '0';

                            const cptRow = document.createElement('div');
                            const rowBg = expired ? cptC.expiredBg : 'transparent';
                            cptRow.style.cssText = `padding:6px 8px 3px;border-bottom:2px solid ${expired ? cptC.expiredBorder : cptC.border};border-radius:${expired ? '4px 4px 0 0' : '0'};display:flex;align-items:center;gap:6px;margin-top:4px;background:${rowBg};`;

                            const cptName = document.createElement('div');
                            cptName.style.cssText = `flex:1;font-size:11px;font-weight:800;color:${expired ? cptC.expiredName : cptC.cptName};`;
                            cptName.textContent = cpt;

                            if (expired) {
                                const badge = document.createElement('span');
                                badge.style.cssText = `font-size:10px;font-weight:700;color:${cptC.expiredBadge};white-space:nowrap;margin-left:6px;`;
                                badge.textContent = L('cptExpired');
                                cptName.appendChild(badge);
                            }

                            const cptTotalEl = document.createElement('div');
                            cptTotalEl.style.cssText = `font-size:11px;font-weight:700;color:${expired ? cptC.expiredTotal : cptC.cptTotal};white-space:nowrap;`;
                            cptTotalEl.textContent = cptTotal.toLocaleString('en-US') + ' ' + L('restantes');
                            cptRow.appendChild(cptName); cptRow.appendChild(cptTotalEl);
                            block.appendChild(cptRow);

                            vrids.forEach(({ vrid, pkgs, lane, routes }) => {
                                const pct = cptTotal > 0 ? (pkgs / cptTotal) * 100 : 0;
                                const vridRow = document.createElement('div');
                                vridRow.className = 'rd-route-row';
                                vridRow.style.cssText = `padding-left:10px;background:${expired ? cptC.expiredBg : 'transparent'};`;
                                const vridName = document.createElement('div'); vridName.className = 'rd-route-name'; vridName.style.color = expired ? cptC.expiredName : cptC.vridName;
                                vridName.innerHTML = `<span style="font-weight:700">${vrid}</span>${lane ? `<span style="font-weight:400;color:${cptC.lane};font-size:10px;margin-left:5px">${lane}</span>` : ''}`;
                                const vridPkgs = document.createElement('div'); vridPkgs.className = 'rd-route-pkgs'; vridPkgs.textContent = pkgs.toLocaleString('en-US');
                                const barWrap = document.createElement('div'); barWrap.className = 'rd-bar-wrap';
                                const barFill = document.createElement('div'); barFill.className = 'rd-bar-fill'; barFill.style.cssText = `width:${pct.toFixed(1)}%;background:${expired ? cptC.expiredBadge : cptC.bar};`; barWrap.appendChild(barFill);
                                const pctLabel = document.createElement('div'); pctLabel.className = 'rd-pct-label'; pctLabel.style.color = expired ? cptC.expiredTotal : cptC.pct; pctLabel.textContent = pct.toFixed(1) + '%';
                                vridRow.appendChild(vridName); vridRow.appendChild(vridPkgs); vridRow.appendChild(barWrap); vridRow.appendChild(pctLabel);
                                block.appendChild(vridRow);

                                if (routes && Object.keys(routes).length > 0) {
                                    const routeChipRow = document.createElement('div');
                                    routeChipRow.style.cssText = `display:flex;flex-wrap:wrap;gap:3px;padding:2px 8px 5px 20px;background:${expired ? cptC.expiredBg : 'transparent'};`;
                                    Object.entries(routes)
                                        .sort((a, b) => b[1] - a[1])
                                        .forEach(([routeName, routePkgs]) => {
                                            const chip = document.createElement('span');
                                            const chipBg = isDark ? (expired ? '#3a0808' : '#252545') : (expired ? '#ffe5e5' : '#f0f4ff');
                                            const chipBorder = isDark ? (expired ? '#7a1a1a' : '#4a4a8e') : (expired ? '#f44336' : '#c5cae9');
                                            const chipColor = isDark ? (expired ? '#ff8a80' : '#90a0ff') : (expired ? '#b71c1c' : '#283593');
                                            const pkgColor = isDark ? (expired ? '#ff5252' : '#b0b0cc') : (expired ? '#c62828' : '#444');
                                            chip.style.cssText = `display:inline-flex;align-items:center;gap:3px;padding:1px 7px;border-radius:20px;background:${chipBg};border:1px solid ${chipBorder};font-size:10px;font-family:'Amazon Ember',Arial,sans-serif;white-space:nowrap;`;
                                            chip.innerHTML = `<span style="font-weight:700;color:${chipColor}">${routeName}</span><span style="font-weight:600;color:${pkgColor}">${routePkgs.toLocaleString('en-US')}</span>`;
                                            routeChipRow.appendChild(chip);
                                        });
                                    block.appendChild(routeChipRow);
                                }
                            });

                            cptBlocks.push(block);
                            cptScroll.appendChild(block);
                        });

                        const applyHideExpired = () => {
                            cptBlocks.forEach(b => {
                                b.style.display = (hideExpired && b.dataset.expired === '1') ? 'none' : '';
                            });
                        };

                        toggleBtn.addEventListener('click', () => {
                            hideExpired = !hideExpired;
                            updateToggle();
                            applyHideExpired();
                        });

                        paneCpt.appendChild(cptScroll);
                    }

                    const tabs = [
                        { label: L('total'), pane: paneTotal, color: '#1b5e20' },
                        { label: L('tabRemaining'), pane: paneRemaining, color: '#0d47a1' },
                        ...(paneXd ? [{ label: L('xdock'), pane: paneXd, color: '#e65100' }] : []),
                        ...(paneCpt ? [{ label: L('cptPriority'), pane: paneCpt, color: '#4a148c' }] : []),
                    ];

                    const tabBar = document.createElement('div');
                    tabBar.className = 'rd-tab-bar';
                    tabBar.style.cssText = `display:flex;gap:0;border-bottom:2px solid ${isDark ? '#3a3a5e' : '#e0e0e0'};background:${isDark ? '#252535' : '#f5f5f5'};flex-shrink:0;`;

                    const body = document.createElement('div');
                    body.style.cssText = `flex:1;display:flex;flex-direction:column;overflow:hidden;min-height:0;background:${isDark ? '#1a1a2e' : '#fff'};`;

                    function activateTab(idx) {
                        tabBar.querySelectorAll('.rd-tab-btn').forEach((btn, i) => {
                            const isActive = i === idx;
                            btn.style.borderBottom = isActive ? `3px solid ${tabs[i].color}` : '3px solid transparent';
                            btn.style.color = isActive ? tabs[i].color : (isDark ? '#8080a0' : '#666');
                            btn.style.fontWeight = isActive ? '800' : '600';
                            btn.style.background = isActive ? (isDark ? '#1e1e38' : '#fff') : 'transparent';
                        });
                        body.innerHTML = '';
                        body.appendChild(tabs[idx].pane);
                    }

                    tabs.forEach((t, i) => {
                        const btn = document.createElement('button');
                        btn.className = 'rd-tab-btn';
                        btn.textContent = t.label;
                        btn.style.cssText = `border:none;border-bottom:3px solid transparent;padding:8px 14px;font-size:11px;font-family:'Amazon Ember',Arial,sans-serif;cursor:pointer;background:transparent;color:${isDark ? '#8080a0' : '#666'};font-weight:600;white-space:nowrap;transition:color 0.15s,border-color 0.15s;`;
                        btn.addEventListener('click', () => activateTab(i));
                        tabBar.appendChild(btn);
                    });

                    activateTab(0);

                    popup.appendChild(header);
                    popup.appendChild(tabBar);
                    popup.appendChild(body);
                    overlay.appendChild(popup);
                    document.body.appendChild(overlay);
                }

                function closePackagesModal() {
                    const closeBtn = document.querySelector('#viewPackages')?.closest('.ui-dialog')?.querySelector('.ui-dialog-titlebar-close');
                    if (closeBtn) closeBtn.click();
                }

                function readAllPages(accum, callback) {
                    function getFirstCellText() {
                        const first = document.querySelector('#tableViewCPTMix tbody tr:first-child td:first-child');
                        return first ? first.textContent.trim() : '';
                    }
                    function readCurrentPage() {
                        const tbody = document.querySelector('#tableViewCPTMix tbody');
                        if (!tbody) return;
                        tbody.querySelectorAll('tr').forEach(row => {
                            const cells = row.querySelectorAll('td');
                            if (cells.length < 9) return;
                            const cpt = cells[0].textContent.trim();
                            const pkgs = parseInt(cells[2].textContent.trim(), 10) || 0;
                            const remaining = parseInt(cells[4].textContent.trim(), 10) || 0;
                            const noReboqueC = parseInt(cells[5].textContent.trim(), 10) || 0;
                            const rawRoute = cells[8].textContent.trim();
                            const route = rawRoute.replace(/^[A-Z0-9]{2,6}\s*->\s*/i, '').trim() || rawRoute;
                            if (!route) return;

                            if (noReboqueC > 0) {
                                if (!accum._xdock) accum._xdock = { pkgs: 0, pallets: 0, routes: {} };
                                accum._xdock.pkgs += remaining;
                                accum._xdock.pallets += noReboqueC;
                                if (!accum._xdock.routes[route]) accum._xdock.routes[route] = { pkgs: 0, pallets: 0 };
                                accum._xdock.routes[route].pkgs += remaining;
                                accum._xdock.routes[route].pallets += noReboqueC;
                            }
                            if (!accum[route]) accum[route] = { pkgs: 0, remaining: 0, cpts: {} };
                            accum[route].pkgs += pkgs;
                            if (noReboqueC === 0) accum[route].remaining += remaining;
                            if (cpt) {
                                if (!accum[route].cpts[cpt]) accum[route].cpts[cpt] = { pkgs: 0, remaining: 0 };
                                accum[route].cpts[cpt].pkgs += pkgs;
                                if (noReboqueC === 0) accum[route].cpts[cpt].remaining += remaining;
                            }
                        });
                    }
                    function waitForChange(previousFirstCell, onChanged) {
                        var attempts = 0;
                        var iv = setInterval(function () {
                            attempts++;
                            var current = getFirstCellText();
                            if (current !== previousFirstCell && current !== '') { clearInterval(iv); onChanged(); }
                            else if (attempts >= 50) { clearInterval(iv); onChanged(); }
                        }, 50);
                    }
                    function goNextOrFinish() {
                        readCurrentPage();
                        const nextBtn = document.querySelector('#tableViewCPTMix_next');
                        if (nextBtn && !nextBtn.classList.contains('ui-state-disabled')) {
                            const before = getFirstCellText();
                            nextBtn.click();
                            waitForChange(before, goNextOrFinish);
                        } else {
                            callback();
                        }
                    }
                    const firstBtn = document.querySelector('#tableViewCPTMix_paginate .first');
                    if (firstBtn && !firstBtn.classList.contains('ui-state-disabled')) {
                        const before = getFirstCellText();
                        firstBtn.click();
                        waitForChange(before, goNextOrFinish);
                    } else {
                        goNextOrFinish();
                    }
                }

                function openAndRead(link, accum, onDone, onError) {
                    var _onError = typeof onError === 'function' ? onError : function () { };
                    var MAX_RETRIES = 3;

                    function countAccumRows(a) {
                        return Object.keys(a).filter(function (k) { return k !== '_xdock'; }).length;
                    }

                    function attempt(retriesLeft) {
                        link.click();
                        var attempts = 0;
                        var wait = setInterval(function () {
                            attempts++;
                            if (document.querySelector('#tableViewCPTMix tbody tr')) {
                                clearInterval(wait);
                                readAllPages(accum, function () {

                                    if (countAccumRows(accum) === 0 && retriesLeft > 0) {
                                        closePackagesModal();
                                        attempt(retriesLeft - 1);
                                    } else {
                                        mergeRoutesIntoStore(accum);
                                        closePackagesModal();
                                        onDone();
                                    }
                                });
                            } else if (attempts >= 100) {
                                clearInterval(wait);
                                if (retriesLeft > 0) {
                                    closePackagesModal();
                                    attempt(retriesLeft - 1);
                                } else {
                                    closePackagesModal();
                                    _onError();
                                }
                            }
                        }, 1);
                    }

                    attempt(MAX_RETRIES);
                }

                fetchSingleRoutes = function (vrid, row, btn) {
                    btn.textContent = '⏳ API...';
                    btn.className = 'tl-btn tl-btn-gray tl-loading';
                    btn.disabled = true;

                    const cParams = _SUITE._capturedParams[vrid] || {};
                    const planId = cParams.planId || row.getAttribute('planid') || row.getAttribute('planId');

                    if (!planId) {
                        btn.textContent = '⚠ No PlanID';
                        btn.className = 'tl-btn tl-btn-red';
                        btn.disabled = false;
                        return;
                    }

                    const laneEl = row.querySelector('[class*="lane"]');
                    const laneText = laneEl ? laneEl.textContent.trim() : vrid;
                    const sdtEl = row.querySelector('[data-sat]');
                    const sdtCell = row.querySelector('td.scheduledArrivalTimeCol');
                    const sdt = (sdtEl ? sdtEl.getAttribute('data-sat').trim() : null) || (sdtCell ? sdtCell.textContent.trim() : null);

                    _SUITE.API.fetchContainers(planId, (err, data) => {
                        if (err || !data || !data.containers) {
                            btn.textContent = '⚠ API Error';
                            btn.className = 'tl-btn tl-btn-red';
                            btn.disabled = false;
                            return;
                        }

                        const accum = _SUITE.API.mapToAccum(data.containers);
                        const routeVridMap = {};
                        Object.entries(accum).forEach(([route, v]) => {
                            if (v.remaining > 0) routeVridMap[route] = { [vrid]: { pkgs: v.remaining, lane: laneText } };
                        });

                        const cptAnalysis = {};
                        Object.entries(accum).forEach(([route, v]) => {
                            Object.entries(v.cpts || {}).forEach(([cpt, c]) => {
                                if (!c.remaining) return;
                                if (!cptAnalysis[cpt]) cptAnalysis[cpt] = {};
                                if (!cptAnalysis[cpt][vrid]) cptAnalysis[cpt][vrid] = { pkgs: 0, lane: laneText, routes: {} };
                                cptAnalysis[cpt][vrid].pkgs += c.remaining;
                                if (!cptAnalysis[cpt][vrid].routes[route]) cptAnalysis[cpt][vrid].routes[route] = 0;
                                cptAnalysis[cpt][vrid].routes[route] += c.remaining;
                            });
                        });

                        const vridSdtMap = sdt ? { [vrid]: sdt } : {};
                        const routes = Object.entries(accum).map(([route, v]) => ({
                            route,
                            pkgs: v.pkgs,
                            remaining: v.remaining,
                            cpts: Object.entries(v.cpts || {}).map(([cpt, c]) => ({ cpt, pkgs: c.pkgs, remaining: c.remaining }))
                        }));

                        const total = routes.reduce((s, r) => s + r.pkgs, 0);
                        btn.textContent = '📊 Routes';
                        btn.className = 'tl-btn tl-btn-green';
                        btn.disabled = false;
                        showRoutesPopup('📊 Route Distribution', `${vrid} — ${laneText} · ${routes.length} routes`, routes, total, null, cptAnalysis, routeVridMap, vridSdtMap);
                    });
                }

                runRoutesForBadge = function (vrid, row, badgeCard) {
                    const cParams = _SUITE._capturedParams[vrid] || {};
                    const planId = cParams.planId || row.getAttribute('planid');
                    if (!planId) return;

                    _SUITE.API.fetchContainers(planId, (err, data) => {
                        if (err || !data || !data.containers) return;
                        const accum = _SUITE.API.mapToAccum(data.containers);
                        mergeRoutesIntoStore(accum);
                    });
                }

                function collectAllPagesRows(statusEl, callback) {

                    const firstBtn = document.querySelector('#dashboard_paginate .first');
                    if (firstBtn && !firstBtn.classList.contains('ui-state-disabled')) {
                        firstBtn.click();
                    }

                    const allRowData = [];

                    function collectCurrentPage() {
                        document.querySelectorAll('tr[vrid]').forEach(row => {
                            const statusEl = row.querySelector('[class*="originalStatusCheck"][data-status]') || row.querySelector('[data-status]');
                            const status = statusEl ? statusEl.getAttribute('data-status') : '';
                            if (status === 'FINISHED_LOADING') return;
                            const bar = row.querySelector('.progressbarDashboard');
                            if (!bar || !bar.querySelector('.progressLoaded') || bar.querySelector('.width100')) return;
                            const link = row.querySelector('a.packageDetails');
                            if (!link) return;
                            const vrid = (row.getAttribute('vrid') || '').toUpperCase();
                            if (!vrid) return;
                            const laneEl = row.querySelector('[class*="lane"]');
                            const laneText = laneEl ? laneEl.textContent.trim() : vrid;
                            allRowData.push({ vrid, laneText, href: link.href });
                        });
                    }

                    function goNextPage(onDone) {
                        const nextBtn = document.querySelector('#dashboard_next');
                        if (!nextBtn || nextBtn.classList.contains('ui-state-disabled')) { onDone(false); return; }
                        const prevVrid = (document.querySelector('tr[vrid]') || {}).getAttribute ? document.querySelector('tr[vrid]').getAttribute('vrid') : null;
                        nextBtn.click();
                        let attempts = 0;
                        const wait = setInterval(() => {
                            attempts++;
                            const firstRow = document.querySelector('tr[vrid]');
                            const newVrid = firstRow ? firstRow.getAttribute('vrid') : null;
                            if ((newVrid && newVrid !== prevVrid) || attempts >= 100) {
                                clearInterval(wait);
                                onDone(true);
                            }
                        }, 50);
                    }

                    function processPages() {
                        collectCurrentPage();
                        goNextPage(hasNext => {
                            if (!hasNext) { callback(allRowData); }
                            else { processPages(); }
                        });
                    }

                    processPages();
                }

                function fetchAllRoutes(globalBtn, statusEl, onDone) {
                    globalBtn.disabled = true;
                    globalBtn.className = 'tl-btn tl-btn-gray tl-loading';
                    statusEl.textContent = L('scanningPages');

                    const firstBtn = document.querySelector('#dashboard_paginate .first');
                    if (firstBtn && !firstBtn.classList.contains('ui-state-disabled')) firstBtn.click();

                    const accum = {};
                    const cptAnalysis = {};
                    const routeVridMap = {};
                    const vridSdtMap = {};
                    let totalProcessed = 0;
                    let totalFound = 0;

                    function waitForPageLoad(expectedDifferentVrid, callback) {
                        let attempts = 0;
                        const wait = setInterval(() => {
                            attempts++;
                            const firstRow = document.querySelector('tr[vrid]');
                            const vrid = firstRow ? firstRow.getAttribute('vrid') : null;
                            if ((vrid && vrid !== expectedDifferentVrid) || attempts >= 150) {
                                clearInterval(wait);
                                callback();
                            }
                        }, 50);
                    }

                    function finish() {
                        globalBtn.disabled = false;
                        globalBtn.className = 'tl-btn tl-btn-blue';
                        globalBtn.textContent = L('allRoutes');
                        const routes = Object.entries(accum)
                            .filter(([k]) => k !== '_xdock')
                            .map(([route, v]) => ({ route, pkgs: v.pkgs, remaining: v.remaining, cpts: Object.entries(v.cpts || {}).map(([cpt, c]) => ({ cpt, pkgs: c.pkgs, remaining: c.remaining })) }));
                        const total = routes.reduce((s, r) => s + r.pkgs, 0);
                        if (onDone) {
                            onDone();
                        } else {
                            statusEl.textContent = '';
                            showRoutesPopup(
                                '🌐 Global Route Distribution',
                                `${totalProcessed} ${L('trucks')} · ${routes.length} ${L('routes')} · ${total.toLocaleString('en-US')} ${L('packages')}`,
                                routes, total, accum._xdock || null, cptAnalysis, routeVridMap, vridSdtMap
                            );
                        }
                    }

                    function processRowsOnPage(vrids, onPageDone) {
                        const validVrids = vrids.map(v => {
                            const params = _SUITE._capturedParams[v.vrid] || {};
                            const row = document.querySelector(`tr[vrid="${v.vridAttr}"]`);
                            const pid = params.planId || (row ? row.getAttribute('planid') || row.getAttribute('planId') : null);
                            return { ...v, pid };
                        }).filter(v => !!v.pid);

                        if (validVrids.length === 0) { onPageDone(); return; }

                        let completed = 0;
                        let active = 0;
                        let queue = validVrids.slice();

                        function next() {
                            while (active < 5 && queue.length > 0) {
                                const v = queue.shift();
                                active++;
                                _SUITE.API.fetchContainers(v.pid, (err, data) => {
                                    active--;
                                    completed++;
                                    statusEl.textContent = `API Fetching ${completed}/${validVrids.length} trucks on this page...`;

                                    if (!err && data && data.containers) {
                                        totalProcessed++;
                                        const truckAccum = _SUITE.API.mapToAccum(data.containers);

                                        Object.entries(truckAccum).forEach(([k, val]) => {
                                            if (!accum[k]) accum[k] = { pkgs: 0, remaining: 0, cpts: {} };
                                            accum[k].pkgs += val.pkgs;
                                            accum[k].remaining += val.remaining;
                                            Object.entries(val.cpts || {}).forEach(([cpt, c]) => {
                                                if (!accum[k].cpts[cpt]) accum[k].cpts[cpt] = { pkgs: 0, remaining: 0 };
                                                accum[k].cpts[cpt].pkgs += c.pkgs;
                                                accum[k].cpts[cpt].remaining += c.remaining;
                                            });
                                        });

                                        Object.entries(truckAccum).forEach(([route, val]) => {
                                            if (val.remaining > 0) {
                                                if (!routeVridMap[route]) routeVridMap[route] = {};
                                                routeVridMap[route][v.vrid] = { pkgs: val.remaining, lane: v.laneText };
                                            }
                                            Object.entries(val.cpts || {}).forEach(([cpt, c]) => {
                                                if (!c.remaining) return;
                                                if (!cptAnalysis[cpt]) cptAnalysis[cpt] = {};
                                                if (!cptAnalysis[cpt][v.vrid]) cptAnalysis[cpt][v.vrid] = { pkgs: 0, lane: v.laneText, routes: {} };
                                                cptAnalysis[cpt][v.vrid].pkgs += c.remaining;
                                                if (!cptAnalysis[cpt][v.vrid].routes[route]) cptAnalysis[cpt][v.vrid].routes[route] = 0;
                                                cptAnalysis[cpt][v.vrid].routes[route] += c.remaining;
                                            });
                                        });
                                    }

                                    if (completed === validVrids.length) {
                                        onPageDone();
                                    } else {
                                        next();
                                    }
                                });
                            }
                        }

                        statusEl.textContent = `API Fetching ${completed}/${validVrids.length} trucks on this page...`;
                        next();
                    }

                    function processNextPage() {

                        const vrids = [];
                        document.querySelectorAll('tr[vrid]').forEach(row => {
                            const vridAttr = row.getAttribute('vrid') || '';
                            if (!vridAttr) return;

                            const cParams = _SUITE._capturedParams[vridAttr.toUpperCase()] || {};
                            const planId = cParams.planId || row.getAttribute('planid') || row.getAttribute('planId');
                            if (!planId) return;

                            const laneEl = row.querySelector('[class*="lane"]');
                            const laneText = laneEl ? laneEl.textContent.trim() : vridAttr.toUpperCase();

                            const sdtCell = row.querySelector('td.scheduledArrivalTimeCol');
                            const sdt = sdtCell ? sdtCell.textContent.trim() : null;
                            if (sdt) vridSdtMap[vridAttr.toUpperCase()] = sdt;
                            vrids.push({ vrid: vridAttr.toUpperCase(), vridAttr, laneText });
                        });
                        totalFound += vrids.length;

                        if (vrids.length === 0) {
                            const nextBtn = document.querySelector('#dashboard_next');
                            if (!nextBtn || nextBtn.classList.contains('ui-state-disabled')) { finish(); return; }
                            const prevVrid = (document.querySelector('tr[vrid]') || document.createElement('tr')).getAttribute('vrid');
                            nextBtn.click();
                            waitForPageLoad(prevVrid, processNextPage);
                            return;
                        }

                        processRowsOnPage(vrids, () => {
                            const nextBtn = document.querySelector('#dashboard_next');
                            if (!nextBtn || nextBtn.classList.contains('ui-state-disabled')) { finish(); return; }
                            const prevVrid = (document.querySelector('tr[vrid]') || document.createElement('tr')).getAttribute('vrid');
                            nextBtn.click();
                            waitForPageLoad(prevVrid, processNextPage);
                        });
                    }

                    setTimeout(processNextPage, 100);
                }

                function injectGlobalBar() {
                    if (document.getElementById('rd-global-bar')) return;
                    const bar = document.createElement('div');
                    bar.id = 'rd-global-bar';

                    const label = document.createElement('span');
                    label.className = 'rd-global-label';
                    label.textContent = L('ibBarLabel');

                    const settingsBtn = document.createElement('button');
                    settingsBtn.className = 'tl-btn tl-btn-gray';
                    settingsBtn.setAttribute('data-rd-settings-btn', '1');
                    settingsBtn.textContent = L('settingsTitle');
                    settingsBtn.title = L('settingsTitle');
                    settingsBtn.addEventListener('click', () => showSettingsPanel());

                    const statusEl = document.createElement('span');
                    statusEl.className = 'rd-global-status';

                    const creditEl = document.createElement('span');
                    creditEl.style.cssText = 'margin-left:auto;font-size:10px;font-weight:600;color:rgba(255,255,255,0.45);font-family:"Amazon Ember",Arial,sans-serif;white-space:nowrap;letter-spacing:0.3px;';
                    creditEl.textContent = 'By emanunec@';

                    const updateStatus = () => {
                        const lastCheck = GM_getValue("suite_last_check_ts", 0);
                        statusEl.innerHTML = ` <span style="opacity:0.6;margin-left:8px;font-size:10px;">${L('versionLabel')} ${VERSION} · ${lastCheck ? L('lastUpdateLabel') + ': ' + new Date(lastCheck).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}</span>`;
                    };

                    const checkUpdateBtn = document.createElement('button');
                    checkUpdateBtn.className = 'tl-btn tl-btn-orange';
                    checkUpdateBtn.style.marginLeft = '8px';
                    checkUpdateBtn.innerHTML = `🔄 ${L('checkUpdates')}`;
                    checkUpdateBtn.onclick = () => {
                        checkUpdateBtn.disabled = true;
                        checkUpdateBtn.innerHTML = '⏳...';
                        _SUITE.checkForUpdates(true, () => {
                            checkUpdateBtn.disabled = false;
                            checkUpdateBtn.innerHTML = `🔄 ${L('checkUpdates')}`;
                            updateStatus();
                        });
                    };

                    bar.appendChild(label);
                    bar.appendChild(settingsBtn);
                    bar.appendChild(checkUpdateBtn);
                    bar.appendChild(statusEl);
                    bar.appendChild(creditEl);
                    document.body.appendChild(bar);
                    updateStatus();
                }

                injectGlobalBar();

                _openIbPanel = function openIbPanel(vrid, sdt, yard, packages, row, status, btn) {
                    document.querySelectorAll('.ib-panel-overlay').forEach(function (e) { e.remove(); });

                    const isDark = SETTINGS.theme === 'dark';
                    const laneEl = row.querySelector('[class*="lane"]');
                    const lane = laneEl ? laneEl.textContent.trim() : '';

                    const overlay = document.createElement('div');
                    overlay.className = 'ib-panel-overlay rd-popup-overlay';
                    const popup = document.createElement('div');
                    popup.className = 'rd-popup' + (isDark ? ' rd-dark' : '');

                    ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se'].forEach(function (dir) {
                        const h = document.createElement('div');
                        h.className = 'rd-resize-handle rd-resize-' + dir;
                        popup.appendChild(h);
                        h.addEventListener('mousedown', function (e) {
                            e.preventDefault(); e.stopPropagation();
                            const r = popup.getBoundingClientRect();
                            popup.style.transform = 'none'; popup.style.left = r.left + 'px'; popup.style.top = r.top + 'px'; popup.style.width = r.width + 'px'; popup.style.height = r.height + 'px';
                            const sx = e.clientX, sy = e.clientY, sl = r.left, st = r.top, sw = r.width, sh = r.height;
                            function onMove(ev) { const dx = ev.clientX - sx, dy = ev.clientY - sy; if (dir.includes('e')) popup.style.width = Math.max(320, sw + dx) + 'px'; if (dir.includes('s')) popup.style.height = Math.max(200, sh + dy) + 'px'; if (dir.includes('w')) { const w = Math.max(320, sw - dx); popup.style.width = w + 'px'; popup.style.left = (sl + sw - w) + 'px'; } if (dir.includes('n')) { const hh = Math.max(200, sh - dy); popup.style.height = hh + 'px'; popup.style.top = (st + sh - hh) + 'px'; } }
                            function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }
                            document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
                        });
                    });

                    const header = document.createElement('div');
                    header.className = 'rd-popup-header';
                    header.innerHTML = '<div><div class="rd-popup-title">🚛 ' + esc(vrid) + '</div><div class="rd-popup-sub">' + esc(lane) + '</div></div><button class="rd-popup-close" title="Fechar">✕</button>';
                    header.querySelector('.rd-popup-close').addEventListener('click', function () { overlay.remove(); });
                    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
                    const onEsc = function (e) { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onEsc); } };
                    document.addEventListener('keydown', onEsc);
                    let dragX = 0, dragY = 0, dragging = false;
                    header.addEventListener('mousedown', function (e) { if (e.target.closest('button')) return; dragging = true; const r = popup.getBoundingClientRect(); popup.style.transform = 'none'; popup.style.left = r.left + 'px'; popup.style.top = r.top + 'px'; dragX = e.clientX - r.left; dragY = e.clientY - r.top; e.preventDefault(); });
                    document.addEventListener('mousemove', function (e) { if (!dragging) return; popup.style.left = (e.clientX - dragX) + 'px'; popup.style.top = (e.clientY - dragY) + 'px'; });
                    document.addEventListener('mouseup', function () { dragging = false; });

                    const tabBar = document.createElement('div');
                    tabBar.className = 'rd-tab-bar';
                    tabBar.style.cssText = 'display:flex;gap:0;border-bottom:2px solid ' + (isDark ? '#3a3a5e' : '#e0e0e0') + ';background:' + (isDark ? '#252535' : '#f5f5f5') + ';flex-shrink:0;';
                    const body = document.createElement('div');
                    body.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden;min-height:0;background:' + (isDark ? '#1a1a2e' : '#fff') + ';';

                    const paneInfo = document.createElement('div');
                    paneInfo.style.cssText = 'flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:8px;';
                    paneInfo.innerHTML = '<div style="font-size:11px;color:' + (isDark ? '#8080a0' : '#888') + ';" class="tl-loading">' + L('fetchingYms') + '</div>';

                    const hasLink = !!row.querySelector('a.packageDetails');
                    const paneRoutes = document.createElement('div');
                    paneRoutes.style.cssText = 'flex:1;overflow:hidden;display:flex;flex-direction:column;';
                    if (!hasLink) {
                        paneRoutes.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:8px;color:' + (isDark ? '#8080a0' : '#888') + ';font-size:12px;padding:20px;text-align:center;"><span style="font-size:28px;">📦</span><span style="font-weight:700;">' + L('waitingPackages') + '</span></div>';
                    } else {
                        paneRoutes.innerHTML = '<div style="font-size:11px;color:' + (isDark ? '#8080a0' : '#888') + ';padding:14px 16px;" class="tl-loading">' + L('fetchingRoutes') + '</div>';
                    }

                    const tabDefs = [
                        { label: '🔍 Info', pane: paneInfo, color: '#0d47a1', enabled: true },
                        { label: '📊 Rotas', pane: paneRoutes, color: '#2e7d32', enabled: hasLink },
                    ];

                    function activateTabIb(idx) {
                        tabBar.querySelectorAll('.rd-tab-btn').forEach(function (b, i) {
                            const a = i === idx;
                            b.style.borderBottom = a ? '3px solid ' + tabDefs[i].color : '3px solid transparent';
                            b.style.color = !tabDefs[i].enabled ? (isDark ? '#555' : '#bbb') : (a ? tabDefs[i].color : (isDark ? '#8080a0' : '#666'));
                            b.style.fontWeight = a ? '800' : '600';
                            b.style.background = a ? (isDark ? '#1e1e38' : '#fff') : 'transparent';
                        });
                        body.innerHTML = ''; body.appendChild(tabDefs[idx].pane);
                    }
                    tabDefs.forEach(function (t, i) {
                        const b = document.createElement('button'); b.className = 'rd-tab-btn'; b.textContent = t.label; b.disabled = !t.enabled;
                        b.title = !t.enabled ? '' + L('waitingPackages') + '' : '';
                        b.style.cssText = 'border:none;border-bottom:3px solid transparent;padding:8px 14px;font-size:11px;font-family:"Amazon Ember",Arial,sans-serif;cursor:' + (t.enabled ? 'pointer' : 'not-allowed') + ';background:transparent;color:' + (t.enabled ? (isDark ? '#8080a0' : '#666') : (isDark ? '#555' : '#bbb')) + ';font-weight:600;white-space:nowrap;opacity:' + (t.enabled ? '1' : '0.5') + ';';
                        if (t.enabled) b.addEventListener('click', function () { activateTabIb(i); });
                        tabBar.appendChild(b);
                    });
                    activateTabIb(0);
                    popup.appendChild(header); popup.appendChild(tabBar); popup.appendChild(body);
                    overlay.appendChild(popup); document.body.appendChild(overlay);

                    fetchInfoCore(vrid, sdt, yard, packages, function (data) {
                        paneInfo.innerHTML = '';
                        if (!data) {
                            paneInfo.innerHTML = '<div style="font-size:12px;color:#c62828;">' + L('noYmsData') + '</div>';
                        } else {
                            var _dcm = { "#c47000": { b: "#FFB300", bg: "rgba(255,179,0,0.08)", br: "#FFB300" }, "#0d47a1": { b: "#64B5F6", bg: "rgba(100,181,246,0.08)", br: "#64B5F6" }, "#2e7d32": { b: "#66BB6A", bg: "rgba(102,187,106,0.08)", br: "#66BB6A" }, "#6a1b9a": { b: "#CE93D8", bg: "rgba(206,147,216,0.08)", br: "#CE93D8" }, "#283593": { b: "#7986CB", bg: "rgba(121,134,203,0.08)", br: "#7986CB" }, "#880e4f": { b: "#F48FB1", bg: "rgba(244,143,177,0.08)", br: "#F48FB1" }, "#c62828": { b: "#EF5350", bg: "rgba(239,83,80,0.08)", br: "#EF5350" } };
                            const fields = [
                                ['CuFt', data.cuft ? data.cuft + ' ft³' : null, '#FFF8E1', '#c47000'],
                                [L('cubeLabel'), data.cube !== null && data.cube !== '' && data.cube !== undefined ? Number(data.cube).toFixed(2) : null, '#FFF8E1', '#c47000'],
                                [L('checkInLabel'), data.checkIn, '#e3f2fd', '#0d47a1'],
                                [L('arrivalDelayLabel'), data.arrivalDelay, '#ffebee', '#c62828'],
                                [L('tdrDockLabel'), data.tdrDock, '#e8f5e9', '#2e7d32'],
                                [L('dockDoorsLabel'), data.dockDoors, '#f3e5f5', '#6a1b9a'],
                                [L('ibStartedLabel'), data.dockStarted, '#e8eaf6', '#283593'],
                                [L('ibDoneLabel'), data.dockCompleted, '#e8eaf6', '#283593'],
                                [L('checkoutLabel'), data.checkOut, '#fce4ec', '#880e4f'],
                            ];
                            fields.forEach(function (f) {
                                if (!f[1]) return;
                                const el = document.createElement('div');
                                var _dk = isDark && _dcm[f[3]];
                                el.style.cssText = 'display:flex;align-items:center;gap:10px;padding:7px 12px;background:' + (_dk ? _dk.bg : f[2]) + ';border-radius:8px;border:1px solid ' + (_dk ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)') + ';' + (isDark ? 'border-left:3px solid ' + (_dk ? _dk.br : '#555') + ';' : '');
                                el.innerHTML = '<span style="font-size:11px;font-weight:600;color:' + (isDark ? '#b0b0c8' : '#666') + ';min-width:220px;flex-shrink:0;">' + esc(f[0]) + '</span><span style="font-size:12px;font-weight:800;color:' + (isDark ? '#fff' : f[3]) + ';' + (isDark && _dk ? 'text-shadow:0 0 10px ' + _dk.bright + ',0 0 2px ' + _dk.bright + ';' : '') + ' ">' + esc(f[1]) + '</span>';
                                paneInfo.appendChild(el);
                            });
                            if (!paneInfo.children.length) paneInfo.innerHTML = '<div style="font-size:12px;color:' + (isDark ? '#8080a0' : '#888') + ';">' + L('noData') + '</div>';
                        }
                        btn.textContent = 'Info'; btn.className = 'tl-btn tl-btn-blue'; btn.disabled = false;
                        btn.onclick = function (e) { e.stopPropagation(); if (_openIbPanel) _openIbPanel(vrid, sdt, yard, packages, row, status, btn); };
                    }, false);

                    if (hasLink) {
                        const link = row.querySelector('a.packageDetails');
                        const laneText = lane;
                        const accumR = {};
                        const sdtEl2 = row.querySelector('[data-sat]');
                        const sdtCell2 = row.querySelector('td.scheduledArrivalTimeCol');
                        const sdtR = (sdtEl2 ? sdtEl2.getAttribute('data-sat').trim() : null) || (sdtCell2 ? sdtCell2.textContent.trim() : null) || sdt;

                        openAndRead(link, accumR, function () {
                            if (accumR._xdock && accumR._xdock.pallets > 0) {
                                accumR._xdock.vrids = { [vrid]: { pkgs: accumR._xdock.pkgs, pallets: accumR._xdock.pallets, lane: laneText, routes: accumR._xdock.routes || {} } };
                            }
                            const rvm = {};
                            Object.entries(accumR).forEach(([rt, v]) => { if (rt === '_xdock') return; if (v.remaining > 0) rvm[rt] = { [vrid]: { pkgs: v.remaining, lane: laneText } }; });
                            const cptA = {};
                            Object.entries(accumR).forEach(([rt, v]) => {
                                if (rt === '_xdock') return;
                                Object.entries(v.cpts || {}).forEach(([cpt, c]) => {
                                    if (!c.remaining) return;
                                    if (!cptA[cpt]) cptA[cpt] = {};
                                    if (!cptA[cpt][vrid]) cptA[cpt][vrid] = { pkgs: 0, lane: laneText, routes: {} };
                                    cptA[cpt][vrid].pkgs += c.remaining;
                                    if (!cptA[cpt][vrid].routes[rt]) cptA[cpt][vrid].routes[rt] = 0;
                                    cptA[cpt][vrid].routes[rt] += c.remaining;
                                });
                            });
                            const vsdtM = sdtR ? { [vrid]: sdtR } : {};
                            const routes = Object.entries(accumR).filter(([k]) => k !== '_xdock').map(([rt, v]) => ({ route: rt, pkgs: v.pkgs, remaining: v.remaining, cpts: Object.entries(v.cpts || {}).map(([cpt, c]) => ({ cpt, pkgs: c.pkgs, remaining: c.remaining })) }));
                            const totPkgs = routes.reduce((s, r) => s + r.pkgs, 0);
                            const totRem = routes.reduce((s, r) => s + r.remaining, 0);
                            const xdD = accumR._xdock || null;

                            mergeRoutesIntoStore(accumR);

                            paneRoutes.innerHTML = '';
                            paneRoutes.style.cssText = 'flex:1;overflow:hidden;display:flex;flex-direction:column;';

                            const rHdr = document.createElement('div');
                            rHdr.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 14px;background:' + (isDark ? '#252535' : '#f9f9f9') + ';border-bottom:1px solid ' + (isDark ? '#3a3a5e' : '#e0e0e0') + ';flex-shrink:0;flex-wrap:wrap;';
                            rHdr.innerHTML = '<span style="font-size:11px;font-weight:700;color:' + (isDark ? '#d0d0e8' : '#333') + ';">' + esc(vrid) + ' — ' + esc(laneText) + ' · ' + routes.length + ' rotas · ' + totPkgs.toLocaleString('en-US') + ' pkgs</span>';
                            const xlBtn = document.createElement('button');
                            xlBtn.className = 'tl-btn tl-btn-green';
                            xlBtn.textContent = '⬇ Excel';
                            xlBtn.style.marginLeft = 'auto';
                            xlBtn.addEventListener('click', function () { downloadExcel(vrid + ' — ' + laneText, routes, totPkgs, xdD, cptA, rvm, vsdtM); });
                            rHdr.appendChild(xlBtn);
                            paneRoutes.appendChild(rHdr);

                            const stBar = document.createElement('div');
                            stBar.style.cssText = 'display:flex;border-bottom:2px solid ' + (isDark ? '#3a3a5e' : '#e0e0e0') + ';background:' + (isDark ? '#252535' : '#f5f5f5') + ';flex-shrink:0;';
                            const stBody = document.createElement('div');
                            stBody.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden;min-height:0;background:' + (isDark ? '#1a1a2e' : '#fff') + ';';

                            const pTot = makePanel('rd-panel-header-total', L('total'), totPkgs, routes, 'pkgs', null);
                            pTot.style.flex = '1';
                            const pRem = makePanel('rd-panel-header-rest', L('tabRemaining'), totRem, routes, 'remaining', rvm);
                            pRem.style.flex = '1';

                            let pXd = null;
                            if (xdD && xdD.pallets > 0) {
                                const xdC = isDark
                                    ? { title: '#ffcc80', info: '#ffaa57', border: '#4a2800', routeName: '#b0b0cc', pallet: '#ffaa57', bar: '#ff8c42', pct: '#ffaa57' }
                                    : { title: '#e65100', info: '#bf360c', border: '#ffe0b2', routeName: '#555', pallet: '#e65100', bar: '#e65100', pct: '#e65100' };
                                pXd = document.createElement('div'); pXd.className = 'rd-panel'; pXd.style.flex = '1';
                                const xHdr = document.createElement('div'); xHdr.className = 'rd-panel-header rd-panel-header-xd';
                                xHdr.innerHTML = L('xdock') + ' <span style="float:right;font-weight:700;color:' + xdC.info + ';">' + xdD.pkgs.toLocaleString('en-US') + ' pkgs · ' + xdD.pallets + ' Pallets</span>';
                                pXd.appendChild(xHdr);
                                const xScroll = document.createElement('div'); xScroll.className = 'rd-panel-scroll';
                                if (xdD.routes) {
                                    Object.entries(xdD.routes).sort((a, b) => b[1].pkgs - a[1].pkgs).forEach(([rt2, v2]) => {
                                        const pct2 = xdD.pkgs > 0 ? (v2.pkgs / xdD.pkgs) * 100 : 0;
                                        const rr = document.createElement('div'); rr.className = 'rd-route-row';
                                        const rName = document.createElement('div'); rName.className = 'rd-route-name'; rName.style.color = xdC.routeName; rName.textContent = rt2; rName.title = rt2;
                                        const rPkgs = document.createElement('div'); rPkgs.className = 'rd-route-pkgs'; rPkgs.textContent = v2.pkgs.toLocaleString('en-US');
                                        const rPallets = document.createElement('div'); rPallets.style.cssText = 'font-size:10px;color:' + xdC.pallet + ';white-space:nowrap;min-width:52px;text-align:right;'; rPallets.textContent = (v2.pallets || 0) + ' Pallets';
                                        const bWrap = document.createElement('div'); bWrap.className = 'rd-bar-wrap';
                                        const bFill = document.createElement('div'); bFill.className = 'rd-bar-fill'; bFill.style.cssText = 'width:' + pct2.toFixed(1) + '%;background:' + xdC.bar + ';'; bWrap.appendChild(bFill);
                                        const rPct = document.createElement('div'); rPct.className = 'rd-pct-label'; rPct.style.color = xdC.pct; rPct.textContent = pct2.toFixed(1) + '%';
                                        rr.appendChild(rName); rr.appendChild(rPkgs); rr.appendChild(rPallets); rr.appendChild(bWrap); rr.appendChild(rPct);
                                        xScroll.appendChild(rr);
                                    });
                                }
                                pXd.appendChild(xScroll);
                            }

                            let pCpt = null;
                            if (cptA && Object.keys(cptA).length > 0) {
                                pCpt = document.createElement('div'); pCpt.style.cssText = 'flex:1;overflow-y:auto;';
                                const parseCptD = s => { const mm = s.match(/(\d{2})-([A-Za-z]{3})-(\d{2,4})\s+(\d{2}):(\d{2})/); if (!mm) return 0; const mo = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12, Fev: 2, Abr: 4, Mai: 5, Ago: 8, Set: 9, Out: 10, Dez: 12 }; const yr = parseInt(mm[3]) < 100 ? 2000 + parseInt(mm[3]) : parseInt(mm[3]); const mn = mo[mm[2]]; if (!mn) return 0; return yr * 100000000 + mn * 1000000 + parseInt(mm[1]) * 10000 + parseInt(mm[4]) * 100 + parseInt(mm[5]); };
                                const nnow = new Date(), nowN = nnow.getFullYear() * 100000000 + (nnow.getMonth() + 1) * 1000000 + nnow.getDate() * 10000 + nnow.getHours() * 100 + nnow.getMinutes();
                                const cC = isDark ? { border: '#3a1a4a', cName: '#ce93d8', cTot: '#ba68c8', vName: '#d0d0e8', lnC: '#8080a8', bar: '#ab47bc', pct: '#ce93d8', eBg: '#2a0a0a', eBorder: '#7a1a1a', eName: '#ff8a80', eTot: '#ff5252', eBdg: '#ff1744' } : { border: '#e1bee7', cName: '#4a148c', cTot: '#6a1b9a', vName: '#333', lnC: '#888', bar: '#9c27b0', pct: '#7b1fa2', eBg: '#fff3f3', eBorder: '#f44336', eName: '#b71c1c', eTot: '#c62828', eBdg: '#f44336' };
                                Object.keys(cptA).sort((a, b) => parseCptD(a) - parseCptD(b)).forEach(cpt => {
                                    const vlist = Object.entries(cptA[cpt]).map(([vv, dd]) => ({ vrid: vv, pkgs: dd.pkgs, lane: dd.lane })).filter(vv => vv.pkgs > 0).sort((a, b) => b.pkgs - a.pkgs);
                                    if (!vlist.length) return;
                                    const cTot = vlist.reduce((s, vv) => s + vv.pkgs, 0);
                                    const exp = parseCptD(cpt) > 0 && nowN > parseCptD(cpt);
                                    const blk = document.createElement('div');
                                    const cRow = document.createElement('div');
                                    cRow.style.cssText = 'padding:6px 8px 3px;border-bottom:2px solid ' + (exp ? cC.eBorder : cC.border) + ';display:flex;align-items:center;gap:6px;margin-top:4px;background:' + (exp ? cC.eBg : 'transparent') + ';';
                                    cRow.innerHTML = '<div style="flex:1;font-size:11px;font-weight:800;color:' + (exp ? cC.eName : cC.cName) + ';">' + esc(cpt) + (exp ? '<span style="font-size:10px;font-weight:700;color:' + cC.eBdg + ';margin-left:6px;">' + L('cptExpired') + '</span>' : '') + '</div><div style="font-size:11px;font-weight:700;color:' + (exp ? cC.eTot : cC.cTot) + ';white-space:nowrap;">' + cTot.toLocaleString('en-US') + ' pkgs</div>';
                                    blk.appendChild(cRow);
                                    vlist.forEach(({ vrid: vv, pkgs: pp, lane: ll }) => {
                                        const ppct = cTot > 0 ? (pp / cTot) * 100 : 0;
                                        const vRow = document.createElement('div'); vRow.className = 'rd-route-row'; vRow.style.cssText = 'padding-left:10px;background:' + (exp ? cC.eBg : 'transparent') + ';';
                                        vRow.innerHTML = '<div class="rd-route-name" style="color:' + (exp ? cC.eName : cC.vName) + ';"><span style="font-weight:700;">' + esc(vv) + '</span>' + (ll ? '<span style="font-weight:400;color:' + cC.lnC + ';font-size:10px;margin-left:5px;">' + esc(ll) + '</span>' : '') + '</div><div class="rd-route-pkgs">' + pp.toLocaleString('en-US') + '</div><div class="rd-bar-wrap"><div class="rd-bar-fill" style="width:' + ppct.toFixed(1) + '%;background:' + (exp ? cC.eBdg : cC.bar) + ';"></div></div><div class="rd-pct-label" style="color:' + (exp ? cC.eTot : cC.pct) + '">' + ppct.toFixed(1) + '%</div>';
                                        blk.appendChild(vRow);
                                    });
                                    pCpt.appendChild(blk);
                                });
                            }

                            const stTabs = [
                                { label: L('total'), pane: pTot, color: '#1b5e20' },
                                { label: L('tabRemaining'), pane: pRem, color: '#0d47a1' },
                                ...(pXd ? [{ label: L('xdock'), pane: pXd, color: '#e65100' }] : []),
                                ...(pCpt ? [{ label: L('cptPriority'), pane: pCpt, color: '#4a148c' }] : []),
                            ];
                            function activateSt(idx) {
                                stBar.querySelectorAll('.rd-tab-btn').forEach((bb, ii) => { const aa = ii === idx; bb.style.borderBottom = aa ? '3px solid ' + stTabs[ii].color : '3px solid transparent'; bb.style.color = aa ? stTabs[ii].color : (isDark ? '#8080a0' : '#666'); bb.style.fontWeight = aa ? '800' : '600'; bb.style.background = aa ? (isDark ? '#1e1e38' : '#fff') : 'transparent'; });
                                stBody.innerHTML = ''; stBody.appendChild(stTabs[idx].pane);
                            }
                            stTabs.forEach((tt, ii) => { const bb = document.createElement('button'); bb.className = 'rd-tab-btn'; bb.textContent = tt.label; bb.style.cssText = 'border:none;border-bottom:3px solid transparent;padding:8px 14px;font-size:11px;font-family:"Amazon Ember",Arial,sans-serif;cursor:pointer;background:transparent;color:' + (isDark ? '#8080a0' : '#666') + ';font-weight:600;white-space:nowrap;transition:color 0.15s,border-color 0.15s;'; bb.addEventListener('click', () => activateSt(ii)); stBar.appendChild(bb); });
                            activateSt(0);
                            paneRoutes.appendChild(stBar);
                            paneRoutes.appendChild(stBody);

                        }, function () {
                            paneRoutes.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#c62828;font-size:12px;padding:20px;">' + L('routeError') + '</div>';
                        });
                    }
                };

            }

            if (isOutbound) {
                function injectOBBar() {
                    if (document.getElementById('rd-global-bar')) return;
                    const bar = document.createElement('div');
                    bar.id = 'rd-global-bar';
                    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;height:40px;background:#0d47a1;border-bottom:2px solid #90caf9;z-index:9999;display:flex;align-items:center;padding:0 20px;gap:15px;color:#fff;box-shadow:0 2px 10px rgba(0,0,0,0.3);';

                    const label = document.createElement('span');
                    label.className = 'rd-global-label';
                    label.textContent = L('obBarLabel');

                    const statusEl = document.createElement('span');
                    statusEl.className = 'rd-global-status';

                    const fullExportBtn = document.createElement('button');
                    fullExportBtn.id = 'rd-full-export-btn';
                    fullExportBtn.className = 'tl-btn tl-btn-purple';
                    fullExportBtn.textContent = L('Full Export');
                    fullExportBtn.title = 'Fetch Get Info for all eligible VRIDs, then download XLSX';

                    fullExportBtn.addEventListener('click', () => {
                        fullExportBtn.disabled = true;
                        fullExportBtn.className = 'tl-btn tl-btn-gray tl-loading';
                        fullExportBtn.textContent = '⏳ Collecting...';
                        statusEl.textContent = L('fetchingAllInfo');

                        fetchAllInfo(() => {
                            statusEl.textContent = L('generatingXlsx');
                            setTimeout(() => {
                                downloadFullExcel();
                                fullExportBtn.disabled = false;
                                fullExportBtn.className = 'tl-btn tl-btn-purple';
                                fullExportBtn.textContent = L('fullExport');
                                statusEl.textContent = `Exported — ${Object.keys(infoStore).length} VRIDs`;
                            }, 200);
                        }, statusEl);
                    });

                    const settingsBtn = document.createElement('button');
                    settingsBtn.className = 'tl-btn tl-btn-gray';
                    settingsBtn.setAttribute('data-rd-settings-btn', '1');
                    settingsBtn.textContent = L('settingsTitle');
                    settingsBtn.title = L('settingsTitle');
                    settingsBtn.addEventListener('click', () => showSettingsPanel());

                    const creditEl = document.createElement('span');
                    creditEl.style.cssText = 'margin-left:auto;font-size:10px;font-weight:600;color:rgba(255,255,255,0.45);font-family:"Amazon Ember",Arial,sans-serif;white-space:nowrap;letter-spacing:0.3px;';
                    creditEl.textContent = 'By emanunec@';

                    const updateStatus = () => {
                        const lastCheck = GM_getValue("suite_last_check_ts", 0);
                        statusEl.innerHTML = ` <span style="opacity:0.6;margin-left:8px;font-size:10px;">${L('versionLabel')} ${VERSION} · ${lastCheck ? L('lastUpdateLabel') + ': ' + new Date(lastCheck).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}</span>`;
                    };

                    const checkUpdateBtn = document.createElement('button');
                    checkUpdateBtn.className = 'tl-btn tl-btn-orange';
                    checkUpdateBtn.style.marginLeft = '8px';
                    checkUpdateBtn.innerHTML = `🔄 ${L('checkUpdates')}`;
                    checkUpdateBtn.onclick = () => {
                        checkUpdateBtn.disabled = true;
                        checkUpdateBtn.innerHTML = '⏳...';
                        _SUITE.checkForUpdates(true, () => {
                            checkUpdateBtn.disabled = false;
                            checkUpdateBtn.innerHTML = `🔄 ${L('checkUpdates')}`;
                            updateStatus();
                        });
                    };

                    bar.appendChild(label);
                    bar.appendChild(fullExportBtn);
                    bar.appendChild(settingsBtn);
                    bar.appendChild(checkUpdateBtn);
                    bar.appendChild(statusEl);
                    bar.appendChild(creditEl);
                    document.body.appendChild(bar);
                    updateStatus();
                }

                injectOBBar();
            }

            function getVridFromRow(row) {
                if (isIB) return (row.getAttribute('vrid') || '').trim().toUpperCase() || null;
                const span = row.querySelector('span.loadId[data-vrid]');
                return span ? span.getAttribute('data-vrid').trim().toUpperCase() : null;
            }

            function processRows() {
                const selector = isIB ? 'tr[vrid]' : 'tr';
                const allRows = document.querySelectorAll(selector);
                allRows.forEach(row => {
                    const statusEl = isIB
                        ? row.querySelector('[class*="originalStatusCheck"][data-status]')
                        : row.querySelector('[data-status]');
                    const status = statusEl ? statusEl.getAttribute('data-status') : '';
                    if (isIB) { if (!status) return; }
                    else { if (!status || status === 'SCHEDULED') return; }

                    const meta = getRowMeta(row);
                    if (!meta) return;
                    const { vrid, sdt, yard, packages } = meta;

                    if (row.querySelector(`[data-vrid-getinfo="${vrid}"]`)) return;
                    if (row.querySelector(`[data-vrid-badge="${vrid}"]`)) return;

                    const finished = status === 'FINISHED_LOADING';

                    if (isIB) {
                        const bar = row.querySelector('.progressbarDashboard');

                        if (!finished) {
                            if (!bar) return;
                            if (!bar.querySelector('.progressLoaded') || bar.querySelector('.width100')) return;
                        }

                        const ibBtn = makeBtn('Info', finished ? 'tl-btn-gray' : 'tl-btn-blue');
                        ibBtn.setAttribute('data-vrid-getinfo', vrid);
                        ibBtn.disabled = finished;
                        ibBtn.title = finished ? L('concluded') : `Info — ${vrid}`;
                        if (!finished) {
                            ibBtn.addEventListener('click', e => {
                                e.stopPropagation();
                                if (_openIbPanel) _openIbPanel(vrid, sdt, yard, packages, row, status, ibBtn);
                            });
                        }
                        const insertBefore = row.querySelector('span.loadId') || row.querySelectorAll('td')[7];
                        if (insertBefore) insertBefore.parentNode.insertBefore(ibBtn, insertBefore);
                    } else {

                        const obBtn = makeBtn('Info', finished ? 'tl-btn-gray' : 'tl-btn-blue');
                        obBtn.setAttribute('data-vrid-getinfo', vrid);
                        obBtn.disabled = finished;
                        obBtn.title = finished ? L('concluded') : `Info — ${vrid}`;
                        if (!finished) {
                            obBtn.addEventListener('click', e => {
                                e.stopPropagation();
                                if (_openObPanel) _openObPanel(vrid, sdt, yard, packages, row, status, obBtn);
                            });
                        }
                        const group = getOrCreateBtnGroup(row);
                        if (group) group.insertBefore(obBtn, group.firstChild);
                    }
                });
            }

            new MutationObserver(processRows).observe(document.body, { childList: true, subtree: true });
            window.addEventListener('load', () => setTimeout(processRows, 2500));

            _openObPanel = function openObPanel(vrid, sdt, yard, packages, row, status, btn) {
                document.querySelectorAll('.ob-panel-overlay').forEach(function (e) { e.remove(); });

                var isDark = SETTINGS.theme === 'dark';

                var laneEl = row.querySelector('span.floatL[class*="lane"]');
                var lane = laneEl ? laneEl.textContent.trim() : '';
                var dockEl = row.querySelector('span.locLabel');
                var dock = dockEl && /^DD\d+$/i.test(dockEl.textContent.trim()) ? dockEl.textContent.trim() : null;
                var _planid = row.getAttribute('planid');
                var _lCell = _planid ? document.getElementById('loadedCCell_' + _planid) : null;
                var _lLink = _lCell ? _lCell.querySelector('a.trailerCount') : null;
                var loadedCount = _lLink ? (parseInt(_lLink.textContent.trim(), 10) || 0) : 0;

                var canCuft = !!(dock && loadedCount > 0);
                var pRow = extractParamsFromRow(row, vrid);
                var canCpt = !!(pRow.trailerId && !/^OTHR/i.test(pRow.trailerId));

                var overlay = document.createElement('div');
                overlay.className = 'ob-panel-overlay rd-popup-overlay';
                var popup = document.createElement('div');
                popup.className = 'rd-popup' + (isDark ? ' rd-dark' : '');

                ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se'].forEach(function (dir) {
                    var h = document.createElement('div');
                    h.className = 'rd-resize-handle rd-resize-' + dir;
                    popup.appendChild(h);
                    h.addEventListener('mousedown', function (e) {
                        e.preventDefault(); e.stopPropagation();
                        var r = popup.getBoundingClientRect();
                        popup.style.transform = 'none'; popup.style.left = r.left + 'px'; popup.style.top = r.top + 'px'; popup.style.width = r.width + 'px'; popup.style.height = r.height + 'px';
                        var sx = e.clientX, sy = e.clientY, sl = r.left, st = r.top, sw = r.width, sh = r.height;
                        function onMove(ev) { var dx = ev.clientX - sx, dy = ev.clientY - sy; if (dir.includes('e')) popup.style.width = Math.max(320, sw + dx) + 'px'; if (dir.includes('s')) popup.style.height = Math.max(200, sh + dy) + 'px'; if (dir.includes('w')) { var w = Math.max(320, sw - dx); popup.style.width = w + 'px'; popup.style.left = (sl + sw - w) + 'px'; } if (dir.includes('n')) { var hh = Math.max(200, sh - dy); popup.style.height = hh + 'px'; popup.style.top = (st + sh - hh) + 'px'; } }
                        function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }
                        document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
                    });
                });

                var header = document.createElement('div');
                header.className = 'rd-popup-header';
                header.innerHTML = '<div><div class="rd-popup-title">📋 ' + esc(vrid) + (dock ? ' — ' + esc(dock) : '') + ' </div><div class="rd-popup-sub">' + esc(lane) + '</div></div><button class="rd-popup-close" title="Fechar">✕</button>';
                header.querySelector('.rd-popup-close').addEventListener('click', function () { overlay.remove(); });
                overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
                var onEsc = function (e) { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onEsc); } };
                document.addEventListener('keydown', onEsc);
                var dragX = 0, dragY = 0, dragging = false;
                header.addEventListener('mousedown', function (e) { if (e.target.closest('button')) return; dragging = true; var r = popup.getBoundingClientRect(); popup.style.transform = 'none'; popup.style.left = r.left + 'px'; popup.style.top = r.top + 'px'; dragX = e.clientX - r.left; dragY = e.clientY - r.top; e.preventDefault(); });
                document.addEventListener('mousemove', function (e) { if (!dragging) return; popup.style.left = (e.clientX - dragX) + 'px'; popup.style.top = (e.clientY - dragY) + 'px'; });
                document.addEventListener('mouseup', function () { dragging = false; });

                var tabBar = document.createElement('div');
                tabBar.className = 'rd-tab-bar'; tabBar.style.cssText = 'display:flex;gap:0;border-bottom:2px solid ' + (isDark ? '#3a3a5e' : '#e0e0e0') + ';background:' + (isDark ? '#252535' : '#f5f5f5') + ';flex-shrink:0;';
                var body = document.createElement('div');
                body.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden;min-height:0;background:' + (isDark ? '#1a1a2e' : '#fff') + ';';

                var paneInfo = document.createElement('div'); paneInfo.style.cssText = 'flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:8px;';
                paneInfo.innerHTML = '<div style="font-size:11px;color:' + (isDark ? '#8080a0' : '#888') + ';" class="tl-loading">' + L('fetchingYms') + '</div>';

                var paneCuft = document.createElement('div'); paneCuft.style.cssText = 'flex:1;overflow:hidden;display:flex;flex-direction:column;';
                if (!canCuft) paneCuft.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:8px;color:' + (isDark ? '#8080a0' : '#888') + ';font-size:12px;padding:20px;text-align:center;"><span style="font-size:28px;">🚛</span><span style="font-weight:700;">' + L('noContainersLoaded') + '</span></div>';
                else paneCuft.innerHTML = '<div style="font-size:11px;color:' + (isDark ? '#8080a0' : '#888') + ';padding:14px 16px;" class="tl-loading">' + L('fetchingContainers') + '</div>';

                var paneCpt = document.createElement('div'); paneCpt.style.cssText = 'flex:1;overflow:hidden;display:flex;flex-direction:column;';
                if (!canCpt) paneCpt.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:8px;color:' + (isDark ? '#8080a0' : '#888') + ';font-size:12px;padding:20px;text-align:center;"><span style="font-size:28px;">🚛</span><span style="font-weight:700;">' + L('afterRelease') + '</span></div>';
                else paneCpt.innerHTML = '<div style="font-size:11px;color:' + (isDark ? '#8080a0' : '#888') + ';padding:14px 16px;" class="tl-loading">' + L('analyzingPkgs') + '</div>';

                var tabDefs = [
                    { label: '🔍 Info', pane: paneInfo, color: '#0d47a1', enabled: true },
                    { label: '📦 CuFt', pane: paneCuft, color: '#c47000', enabled: canCuft },
                    { label: '📦 Pallets', pane: paneCpt, color: '#7b1fa2', enabled: canCpt },
                ];

                function activateTab(idx) {
                    tabBar.querySelectorAll('.rd-tab-btn').forEach(function (b, i) { var a = i === idx; b.style.borderBottom = a ? '3px solid ' + tabDefs[i].color : '3px solid transparent'; b.style.color = !tabDefs[i].enabled ? (isDark ? '#555' : '#bbb') : (a ? tabDefs[i].color : (isDark ? '#8080a0' : '#666')); b.style.fontWeight = a ? '800' : '600'; b.style.background = a ? (isDark ? '#1e1e38' : '#fff') : 'transparent'; });
                    body.innerHTML = ''; body.appendChild(tabDefs[idx].pane);
                }
                tabDefs.forEach(function (t, i) {
                    var b = document.createElement('button'); b.className = 'rd-tab-btn'; b.textContent = t.label; b.disabled = !t.enabled;
                    b.title = !t.enabled ? (i === 1 ? L('noContainersLoaded') : L('afterRelease')) : '';
                    b.style.cssText = 'border:none;border-bottom:3px solid transparent;padding:8px 14px;font-size:11px;font-family:"Amazon Ember",Arial,sans-serif;cursor:' + (t.enabled ? 'pointer' : 'not-allowed') + ';background:transparent;color:' + (t.enabled ? (isDark ? '#8080a0' : '#666') : (isDark ? '#555' : '#bbb')) + ';font-weight:600;white-space:nowrap;opacity:' + (t.enabled ? '1' : '0.5') + ';';
                    if (t.enabled) b.addEventListener('click', function () { activateTab(i); });
                    tabBar.appendChild(b);
                });
                activateTab(0);
                popup.appendChild(header); popup.appendChild(tabBar); popup.appendChild(body);
                overlay.appendChild(popup); document.body.appendChild(overlay);

                var skipRtt = status !== 'COMPLETED';
                fetchInfoCore(vrid, sdt, yard, packages, function (data) {
                    paneInfo.innerHTML = '';
                    if (!data) {
                        paneInfo.innerHTML = '<div style="font-size:12px;color:#c62828;">' + L('noYmsData') + '</div>';
                    } else {
                        var _dcm2 = { "#c47000": { b: "#FFB300", bg: "rgba(255,179,0,0.08)", br: "#FFB300" }, "#0d47a1": { b: "#64B5F6", bg: "rgba(100,181,246,0.08)", br: "#64B5F6" }, "#2e7d32": { b: "#66BB6A", bg: "rgba(102,187,106,0.08)", br: "#66BB6A" }, "#6a1b9a": { b: "#CE93D8", bg: "rgba(206,147,216,0.08)", br: "#CE93D8" }, "#283593": { b: "#7986CB", bg: "rgba(121,134,203,0.08)", br: "#7986CB" }, "#880e4f": { b: "#F48FB1", bg: "rgba(244,143,177,0.08)", br: "#F48FB1" }, "#c62828": { b: "#EF5350", bg: "rgba(239,83,80,0.08)", br: "#EF5350" } };
                        var fields = [
                            [L('checkInLabel'), data.checkIn, '#e3f2fd', '#0d47a1'],
                            [L('tdrDockLabel'), data.tdrDock, '#e8f5e9', '#2e7d32'],
                            [L('dockDoorsLabel'), data.dockDoors, '#f3e5f5', '#6a1b9a'],
                            [L('obStartedLabel'), data.dockStarted, '#e8eaf6', '#283593'],
                            [L('obDoneLabel'), data.dockCompleted, '#e8eaf6', '#283593'],
                            [L('checkoutLabel'), data.checkOut, '#fce4ec', '#880e4f'],
                            [L('lateDepartureLabel'), data.lateDeparture, '#ffebee', '#c62828'],
                            ['CuFt', data.cuft ? data.cuft + ' ft³' : null, '#FFF8E1', '#c47000'],
                        ];
                        fields.forEach(function (f) { if (!f[1]) return; var el = document.createElement('div'); var _dk2 = isDark && _dcm2[f[3]]; el.style.cssText = 'display:flex;align-items:center;gap:10px;padding:7px 12px;background:' + (_dk2 ? _dk2.bg : f[2]) + ';border-radius:8px;border:1px solid ' + (_dk2 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)') + ';' + (isDark ? 'border-left:3px solid ' + (_dk2 ? _dk2.br : '#555') + ';' : ''); el.innerHTML = '<span style="font-size:11px;font-weight:600;color:' + (isDark ? '#b0b0c8' : '#666') + ';min-width:200px;flex-shrink:0;">' + esc(f[0]) + '</span><span style="font-size:12px;font-weight:800;color:' + (isDark ? '#fff' : f[3]) + ';' + (isDark && _dk2 ? 'text-shadow:0 0 10px ' + _dk2.bright + ',0 0 2px ' + _dk2.bright + ';' : '') + ' ">' + esc(f[1]) + '</span>'; paneInfo.appendChild(el); });
                        if (!paneInfo.children.length) paneInfo.innerHTML = '<div style="font-size:12px;color:' + (isDark ? '#8080a0' : '#888') + ';">' + L('noData') + '</div>';
                    }
                    btn.textContent = 'Info'; btn.className = 'tl-btn tl-btn-blue'; btn.disabled = false;
                }, skipRtt);

                if (canCuft) {
                    function loadCuft() {
                        paneCuft.innerHTML = '<div style="font-size:11px;color:' + (isDark ? '#8080a0' : '#888') + ';padding:14px 16px;" class="tl-loading">' + L('fetchingContainers') + '</div>';
                        var destination = laneToDestination(lane);
                        if (!_SUITE.vsm) {
                            paneCuft.innerHTML = '<div style="font-size:12px;color:#c62828;padding:14px;">⚠ VSM Module not loaded</div>';
                            return;
                        }
                        _SUITE.vsm.fetchByRoute(destination, function (containers) {
                            if (!containers || !containers.length) {
                                paneCuft.innerHTML = '<div style="font-size:12px;color:' + (isDark ? '#8080a0' : '#888') + ';padding:14px;">' + L('noContainersFound') + '</div>';
                                return;
                            }
                            var dockContainers = containers.filter(function (c) {
                                return c.locationLabel && c.locationLabel.toUpperCase() === dock.toUpperCase();
                            });
                            var allVol = dockContainers.reduce(function (s, c) { return s + (c.packageVolume || 0); }, 0);
                            var allPkgs = dockContainers.reduce(function (s, c) { return s + ((c.contentCountMap && c.contentCountMap.PACKAGE) || 0); }, 0);
                            paneCuft.innerHTML = '';

                            if (!dockContainers.length) {
                                paneCuft.innerHTML = '<div style="font-size:12px;color:' + (isDark ? '#8080a0' : '#888') + ';padding:14px;">' + L('noContainersDock') + '</div>';
                                return;
                            }

                            var hdrCuft = document.createElement('div');
                            hdrCuft.style.cssText = 'display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 16px;background:#e65100;color:#fff;flex-shrink:0;';
                            var refreshBtn = document.createElement('button');
                            refreshBtn.textContent = '↺';
                            refreshBtn.title = 'Atualizar';
                            refreshBtn.style.cssText = 'margin-left:auto;background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.5);color:#fff;border-radius:6px;cursor:pointer;font-size:14px;padding:2px 8px;font-weight:700;flex-shrink:0;';
                            refreshBtn.addEventListener('click', loadCuft);
                            hdrCuft.innerHTML = '<span style="font-size:13px;font-weight:800;">🚛 Loaded — ' + esc(lane) + '</span><span style="font-size:12px;font-weight:600;opacity:.85;">' + cm3ToFt3(allVol) + ' ft³ · ' + allPkgs + ' pkgs · ' + dockContainers.length + ' containers</span>';
                            hdrCuft.appendChild(refreshBtn);
                            paneCuft.appendChild(hdrCuft);

                            var dHdr = document.createElement('div');
                            dHdr.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:6px 16px;background:' + (isDark ? '#2b1200' : '#fff3e0') + ';border-bottom:1px solid ' + (isDark ? '#5a2800' : '#ffe0b2') + ';flex-shrink:0;';
                            dHdr.innerHTML = '<span style="font-size:12px;font-weight:800;color:#e65100;">🔶 ' + esc(dock) + ' — ' + dockContainers.length + ' container(s)</span><span style="font-size:12px;font-weight:700;color:' + (isDark ? '#d0d0e8' : '#333') + ';">' + cm3ToFt3(allVol) + ' ft³ · ' + allPkgs + ' pkgs</span>';
                            paneCuft.appendChild(dHdr);

                            var tblWrap = document.createElement('div');
                            tblWrap.style.cssText = 'overflow-y:auto;flex:1;background:' + (isDark ? '#1a1a2e' : '#fff') + ';';
                            var tbl = document.createElement('table');
                            tbl.style.cssText = 'width:100%;border-collapse:collapse;font-size:11px;';
                            var thBg = isDark ? '#1e0e00' : '#fbe9e7', thBorder = isDark ? '#5a2800' : '#ffccbc';
                            tbl.innerHTML = '<thead><tr style="background:' + thBg + ';"><th style="position:sticky;top:0;padding:7px 10px;text-align:left;font-weight:700;color:#e65100;border-bottom:2px solid ' + thBorder + ';background:' + thBg + ';">Doca</th><th style="position:sticky;top:0;padding:7px 10px;text-align:left;font-weight:700;color:#e65100;border-bottom:2px solid ' + thBorder + ';background:' + thBg + ';">Rota</th><th style="position:sticky;top:0;padding:7px 10px;text-align:left;font-weight:700;color:#e65100;border-bottom:2px solid ' + thBorder + ';background:' + thBg + ';">Scannable ID</th><th style="position:sticky;top:0;padding:7px 10px;text-align:left;font-weight:700;color:#e65100;border-bottom:2px solid ' + thBorder + ';background:' + thBg + ';">CPT</th><th style="position:sticky;top:0;padding:7px 10px;text-align:right;font-weight:700;color:#e65100;border-bottom:2px solid ' + thBorder + ';background:' + thBg + ';">Pacotes</th><th style="position:sticky;top:0;padding:7px 10px;text-align:right;font-weight:700;color:#e65100;border-bottom:2px solid ' + thBorder + ';background:' + thBg + ';">Volume (ft³)</th></tr></thead><tbody></tbody>';
                            var tbody = tbl.querySelector('tbody');
                            var rowBase = isDark ? 'color:#d0d0e8;border-bottom:1px solid #2e2e45;' : 'border-bottom:1px solid #e0e0e0;';
                            var rowAlt = isDark ? 'background:#1e0e00;' : 'background:#fff8f5;';
                            dockContainers.sort(function (a, b) { return (a.scannableId || '').localeCompare(b.scannableId || ''); }).forEach(function (c, ci) {
                                var cptFmt = c.cpt ? new Date(Number(c.cpt)).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
                                var pkgs2 = (c.contentCountMap && c.contentCountMap.PACKAGE) || 0;
                                var vol2 = c.packageVolume ? cm3ToFt3(c.packageVolume) : '—';
                                var tr = document.createElement('tr');
                                tr.style.cssText = rowBase + (ci % 2 ? rowAlt : '');
                                tr.innerHTML = '<td style="padding:6px 10px;">' + esc(dock) + '</td><td style="padding:6px 10px;">' + esc(c.sfName || '—') + '</td><td style="padding:6px 10px;font-weight:700;">' + esc(c.scannableId || '—') + '</td><td style="padding:6px 10px;">' + esc(cptFmt) + '</td><td style="padding:6px 10px;text-align:right;">' + pkgs2 + '</td><td style="padding:6px 10px;text-align:right;">' + esc(vol2) + '</td>';
                                tbody.appendChild(tr);
                            });
                            tblWrap.appendChild(tbl);
                            paneCuft.appendChild(tblWrap);
                            var footer = document.createElement('div');
                            footer.style.cssText = 'padding:6px 14px;font-size:11px;color:' + (isDark ? '#8080a0' : '#757575') + ';border-top:1px solid ' + (isDark ? '#2e2e45' : '#e0e0e0') + ';background:' + (isDark ? '#16213e' : '#fafafa') + ';display:flex;justify-content:space-between;flex-shrink:0;';
                            footer.innerHTML = '<span>Atualizado: ' + new Date().toLocaleTimeString('pt-BR', { hour12: false }) + '</span><span>' + dockContainers.length + ' ' + L('containerIn') + ' ' + esc(dock) + '</span>';
                            paneCuft.appendChild(footer);
                        });
                    }
                    loadCuft();
                }

                if (canCpt) {
                    var formBody = ['entity=getOutboundLoadContainerDetails', 'nodeId=' + encodeURIComponent(pRow.nodeId), 'loadGroupId=' + encodeURIComponent(pRow.loadGroupId), 'planId=' + encodeURIComponent(pRow.planId), 'vrid=' + encodeURIComponent(vrid), 'status=', 'trailerId=' + encodeURIComponent(pRow.trailerId), 'trailerNumber=' + encodeURIComponent(pRow.trailerNumber)].join('&');
                    GM_xmlhttpRequest({
                        method: 'POST', url: location.origin + '/ssp/dock/hrz/ob/fetchdata',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
                        data: formBody, withCredentials: true,
                        onload: function (resp) {
                            if (resp.status !== 200) { paneCpt.innerHTML = '<div style="font-size:12px;color:#c62828;padding:14px;">⚠ HTTP ' + resp.status + '</div>'; return; }
                            var truckCptTime = getCptFromRow(row);
                            var result = processFetchData(resp.responseText, truckCptTime);
                            if (!result) { paneCpt.innerHTML = '<div style="font-size:12px;color:#c62828;padding:14px;">⚠ Parse error</div>'; return; }
                            paneCpt.innerHTML = '';
                            var t2 = result.totals, tot2 = result.total;
                            var sBar = document.createElement('div'); sBar.style.cssText = 'display:flex;gap:8px;padding:10px 16px;background:' + (isDark ? '#252535' : '#fafafa') + ';border-bottom:1px solid ' + (isDark ? '#3a3a5e' : '#e0e0e0') + ';flex-shrink:0;flex-wrap:wrap;align-items:center;';
                            function mkChip2(bg, color, label, count) { var pct = tot2 > 0 ? (count / tot2 * 100).toFixed(1) : '0.0'; var s = document.createElement('span'); s.style.cssText = 'display:inline-flex;align-items:center;gap:5px;padding:3px 11px;border-radius:20px;font-size:11px;font-weight:700;background:' + bg + ';color:' + color + ';white-space:nowrap;'; s.textContent = label + ' ' + count + ' (' + pct + '%)'; return s; }
                            sBar.appendChild(mkChip2(isDark ? '#0d2b10' : '#e8f5e9', isDark ? '#69f0ae' : '#1b5e20', L('onTime'), t2.inCpt));
                            sBar.appendChild(mkChip2(isDark ? '#2b1200' : '#fff3e0', isDark ? '#ffcc80' : '#e65100', L('lastHour'), t2.preHour));
                            sBar.appendChild(mkChip2(isDark ? '#2a0a0a' : '#ffebee', isDark ? '#ff8a80' : '#b71c1c', L('lateLabel'), t2.late));
                            sBar.appendChild(mkChip2(isDark ? '#0a1929' : '#e3f2fd', isDark ? '#90caf9' : '#0d47a1', L('earlyLabel'), t2.early || 0));
                            paneCpt.appendChild(sBar);
                            var stBar = document.createElement('div'); stBar.style.cssText = 'display:flex;border-bottom:2px solid ' + (isDark ? '#3a3a5e' : '#e0e0e0') + ';background:' + (isDark ? '#252535' : '#f5f5f5') + ';flex-shrink:0;';
                            var stBody = document.createElement('div'); stBody.style.cssText = 'flex:1;overflow:hidden;display:flex;flex-direction:column;min-height:0;background:' + (isDark ? '#1a1a2e' : '#fff') + ';';
                            var stPanes = [buildPalletPane(result, isDark), buildCptPane(result, isDark)];
                            var stBtns = [];
                            [L('byPallet'), L('byCpt')].forEach(function (label, i) { var b = document.createElement('button'); b.textContent = label; b.style.cssText = 'border:none;border-bottom:3px solid transparent;padding:8px 16px;font-size:11px;font-family:"Amazon Ember",Arial,sans-serif;cursor:pointer;background:transparent;color:' + (isDark ? '#8080a0' : '#666') + ';font-weight:600;white-space:nowrap;'; b.addEventListener('click', function () { stBtns.forEach(function (sb, j) { sb.style.borderBottom = j === i ? '3px solid #7b1fa2' : '3px solid transparent'; sb.style.color = j === i ? '#ce93d8' : '#8080a0'; sb.style.fontWeight = j === i ? '800' : '600'; sb.style.background = j === i ? (isDark ? '#1e1e38' : '#fff') : 'transparent'; }); stBody.innerHTML = ''; stBody.appendChild(stPanes[i]); }); stBar.appendChild(b); stBtns.push(b); });
                            stBtns[0].click();
                            paneCpt.appendChild(stBar); paneCpt.appendChild(stBody);
                        },
                        onerror: function () { paneCpt.innerHTML = '<div style="font-size:12px;color:#c62828;padding:14px;">' + L('networkError') + '</div>'; }
                    });
                }
            }
        }


        var _logLines = [];

        function log(msg, level) {
            var ts = new Date().toLocaleTimeString('pt-BR', { hour12: false });
            _logLines.push({ ts: ts, msg: msg, level: level || 'info' });
            if (_logLines.length > 400) _logLines.shift();
            console.log('[LPD ' + ts + '] ' + msg);
        }

        function parseApiDate(str) {
            if (!str) return null;
            var m = str.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})\s+(\d{1,2}):(\d{2})/);
            if (!m) return null;
            var year = parseInt(m[3], 10);
            if (year < 100) year += 2000;
            var mon = MONTHS[m[2]];
            if (mon === undefined) return null;
            return new Date(year, mon, parseInt(m[1], 10), parseInt(m[4], 10), parseInt(m[5], 10));
        }

        function walkNodes(nodes, palletLabel, cptMap, palletMap, satTime) {
            if (!Array.isArray(nodes)) return;
            nodes.forEach(function (node) {
                var c = node.container || {};
                if (c.contType === 'PACKAGE') {
                    var cpt = c.scheduleDepartureTime || 'N/A';
                    var assStr = c.parentChildAssTime || '';
                    var assTime = parseApiDate(assStr);
                    var cptTime = parseApiDate(cpt);

                    var category = 'inCpt';
                    if (!assTime || !cptTime) {
                        category = 'inCpt';
                    } else if (assTime > cptTime) {
                        category = 'late';
                    } else if (assTime > new Date(cptTime - 3600000)) {
                        category = 'preHour';
                    }

                    var pkgEntry = { label: c.label || '?', assTime: assStr, cpt: cpt, cptTime: cptTime, category: category, pallet: palletLabel };

                    if (!cptMap[cpt]) cptMap[cpt] = { inCpt: 0, preHour: 0, late: 0, early: 0, pkgs: [] };
                    cptMap[cpt][category]++;
                    cptMap[cpt].pkgs.push(pkgEntry);

                    if (!palletMap[palletLabel]) palletMap[palletLabel] = { inCpt: 0, preHour: 0, late: 0, early: 0, pkgs: [] };
                    palletMap[palletLabel][category]++;
                    palletMap[palletLabel].pkgs.push(pkgEntry);
                }
                if (node.childNodes && node.childNodes.length) {
                    walkNodes(node.childNodes, palletLabel, cptMap, palletMap, satTime);
                }
            });
        }

        function processFetchData(responseText, satTime) {
            if (!responseText || !responseText.trim()) {
                log('Resposta vazia da API', 'error'); return null;
            }

            var text = responseText.replace(/^\uFEFF/, '').trim();

            if (text.charAt(0) === '<') {
                log('Resposta e HTML — sessao expirada ou redirecionamento. Recarregue a pagina.', 'error');
                return null;
            }

            var data;
            try { data = JSON.parse(text); }
            catch (e) {
                log('JSON parse error: ' + e.message + ' — inicio da resposta: ' + text.slice(0, 120), 'error');
                return null;
            }

            var aaData = data && data.ret && (typeof data.ret.aaData === 'object') ? data.ret.aaData : null;
            if (!aaData) {
                log('aaData ausente — chaves em data.ret: [' + Object.keys((data && data.ret) || {}).join(', ') + ']', 'error');
                return null;
            }

            var rootNodes = aaData.ROOT_NODE;

            if (!Array.isArray(rootNodes)) {
                log('ROOT_NODE nao e array — aaData keys: [' + Object.keys(aaData).join(', ') + ']', 'warn');
                return { cptMap: {}, palletMap: {}, totals: { inCpt: 0, preHour: 0, late: 0, early: 0 }, total: 0 };
            }

            if (rootNodes.length === 0) {
                log('ROOT_NODE vazio — nenhum pacote carregado ainda', 'info');
                return { cptMap: {}, palletMap: {}, totals: { inCpt: 0, preHour: 0, late: 0, early: 0 }, total: 0 };
            }

            log('ROOT_NODE entries: ' + rootNodes.length, 'info');

            var cptMap = {};
            var palletMap = {};
            var total = 0;

            rootNodes.forEach(function (rootNode) {
                var pallets = rootNode.childNodes || [];
                pallets.forEach(function (palletNode, pi) {
                    var pc = palletNode.container || {};
                    var palletLabel = pc.label || ('Pallet ' + (pi + 1));
                    var children = palletNode.childNodes || [];
                    total += children.length;
                    log('Pallet "' + palletLabel + '" — ' + children.length + ' pkgs', 'info');
                    walkNodes(children, palletLabel, cptMap, palletMap, satTime);
                });
            });

            var refCptTime = satTime;
            if (!refCptTime) {

                Object.keys(cptMap).forEach(function (cptStr) {
                    var t = parseApiDate(cptStr);
                    if (t && (!refCptTime || t < refCptTime)) refCptTime = t;
                });
            }

            if (refCptTime) {

                var mainDay = refCptTime.getFullYear() * 10000 + (refCptTime.getMonth() + 1) * 100 + refCptTime.getDate();

                Object.keys(cptMap).forEach(function (cptStr) {
                    var cptT = parseApiDate(cptStr);
                    if (!cptT) return;
                    var cptDay = cptT.getFullYear() * 10000 + (cptT.getMonth() + 1) * 100 + cptT.getDate();
                    if (cptDay <= mainDay) return;

                    var bucket = cptMap[cptStr];
                    bucket.pkgs.forEach(function (pkg) {
                        if (pkg.category === 'late') return;
                        var oldCat = pkg.category;
                        pkg.category = 'early';

                        if (oldCat !== 'early') {
                            bucket[oldCat]--;
                            bucket.early++;
                        }

                        var pm = palletMap[pkg.pallet];
                        if (pm && oldCat !== 'early') {
                            pm[oldCat]--;
                            pm.early++;
                        }
                    });
                });
            }

            var totals = { inCpt: 0, preHour: 0, late: 0, early: 0 };
            Object.values(cptMap).forEach(function (v) {
                totals.inCpt += v.inCpt;
                totals.preHour += v.preHour;
                totals.late += v.late;
                totals.early += v.early;
            });

            log('CPT ref do caminhão: ' + (refCptTime ? refCptTime.toLocaleString() : 'desconhecido') +
                ' — Scan done — total=' + total + ' inCpt=' + totals.inCpt + ' preHour=' + totals.preHour + ' late=' + totals.late + ' early=' + totals.early,
                totals.late > 0 ? 'warn' : 'ok');

            return { cptMap: cptMap, palletMap: palletMap, totals: totals, total: total };
        }

        function getVridFromRow(row) {
            var span = row.querySelector('span.loadId[data-vrid]');
            return span ? span.getAttribute('data-vrid').trim().toUpperCase() : '';
        }

        function getTrailerIdFromRow(row) {

            var fromAttr = row.getAttribute('data-trailerid') || row.getAttribute('data-trailer-id') || '';
            if (fromAttr) return fromAttr;

            var trailerCell = row.querySelector('td.trailerNumberCol, td[class*="trailer"]');
            if (trailerCell) {
                var txt = trailerCell.textContent.trim();
                if (txt && txt.length > 4) return txt;
            }

            var el = row.querySelector('[data-trailerid]');
            if (el) return el.getAttribute('data-trailerid');

            var loadIdCell = row.querySelector('td.loadIdCol');
            if (loadIdCell) {

                var m = loadIdCell.textContent.match(/\b([A-Z0-9]{9,})\b/);
                if (m) return m[1];

                var raw = loadIdCell.textContent.trim();
                if (raw.length >= 9 && raw.length <= 15) return raw;
            }

            return '';
        }

        var esc = _SUITE.utils.esc;

        function extractParamsFromRow(row, vrid) {
            var captured = _SUITE._capturedParams[vrid] || {};

            var loadGroupId = captured.loadGroupId || row.getAttribute('data-loadgroupid') || '';
            var trailerId = captured.trailerId || getTrailerIdFromRow(row);
            var trailerNumber = captured.trailerNumber || '';
            var planId = captured.planId || row.getAttribute('planid') || '';
            var nodeId = captured.nodeId || CURRENT_NODE;

            log('  DOM trailerId="' + getTrailerIdFromRow(row) + '"' +
                ' captured.trailerId="' + (captured.trailerId || '') + '"' +
                ' → usando="' + trailerId + '"', 'debug');

            return { nodeId, loadGroupId, planId, vrid, trailerId, trailerNumber };
        }

        function openCptPanelLoading(vrid, lane) {
            var _D = SETTINGS.theme === 'dark';
            document.querySelectorAll('.lpd-panel-overlay').forEach(function (e) { e.remove(); });

            var overlay = document.createElement('div');
            overlay.className = 'lpd-panel-overlay';
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:99998;';

            var popup = document.createElement('div');
            popup.style.cssText = [
                'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%)',
                'width:820px;max-width:96vw;height:72vh',
                'background:' + (_D ? '#1a1a2e' : '#fff') + ';border-radius:10px',
                'box-shadow:0 8px 32px rgba(0,0,0,.35)',
                'display:flex;flex-direction:column;overflow:hidden',
                'font-family:"Amazon Ember",Arial,sans-serif;z-index:99999'
            ].join(';');

            var hdr = document.createElement('div');
            hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px 16px 10px;border-bottom:1px solid ' + (_D ? '#2e2e45' : '#e0e0e0') + ';background:' + (_D ? '#16213e' : '#f5f5f5') + ';flex-shrink:0;cursor:grab;user-select:none;';
            var hdrInfo = document.createElement('div');
            hdrInfo.innerHTML =
                '<div style="font-size:13px;font-weight:700;color:' + (_D ? '#e0e0f0' : '#1a1a1a') + ';">📦 CPT Analysis — ' + esc(vrid) + '</div>' +
                '<div class="lpd-hdr-sub" style="font-size:11px;font-weight:600;color:' + (_D ? '#8080a0' : '#555') + ';margin-top:2px;">' + esc(lane) + ' · ' + L('loading') + '</div>';
            var closeBtn = document.createElement('button');
            closeBtn.textContent = '✕';
            closeBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:18px;color:' + (_D ? '#8080a0' : '#666') + ';line-height:1;padding:0 2px;';
            closeBtn.onclick = function () { overlay.remove(); };
            hdr.appendChild(hdrInfo);
            hdr.appendChild(closeBtn);
            popup.appendChild(hdr);

            var dragX = 0, dragY = 0, dragging = false;
            hdr.addEventListener('mousedown', function (e) {
                if (e.target.closest('button')) return;
                dragging = true;
                var r = popup.getBoundingClientRect();
                popup.style.transform = 'none';
                popup.style.left = r.left + 'px'; popup.style.top = r.top + 'px';
                dragX = e.clientX - r.left; dragY = e.clientY - r.top;
                e.preventDefault();
            });
            document.addEventListener('mousemove', function (e) { if (!dragging) return; popup.style.left = (e.clientX - dragX) + 'px'; popup.style.top = (e.clientY - dragY) + 'px'; });
            document.addEventListener('mouseup', function () { dragging = false; });

            var summaryBar = document.createElement('div');
            summaryBar.style.cssText = 'display:flex;gap:8px;padding:10px 16px;background:' + (_D ? '#252535' : '#fafafa') + ';border-bottom:1px solid ' + (_D ? '#2e2e45' : '#e0e0e0') + ';flex-shrink:0;flex-wrap:wrap;align-items:center;min-height:40px;';
            popup.appendChild(summaryBar);

            var tabBar = document.createElement('div');
            tabBar.style.cssText = 'display:flex;border-bottom:2px solid ' + (_D ? '#2e2e45' : '#e0e0e0') + ';background:' + (_D ? '#252535' : '#f5f5f5') + ';flex-shrink:0;';
            popup.appendChild(tabBar);

            var bodyEl = document.createElement('div');
            bodyEl.style.cssText = 'flex:1;overflow:hidden;display:flex;flex-direction:column;min-height:0;background:' + (_D ? '#1a1a2e' : '#fff') + ';';

            var skeletonStyle = '@keyframes lpd-shimmer{0%{background-position:-600px 0}100%{background-position:600px 0}}';
            if (!document.getElementById('lpd-skeleton-style')) {
                var st = document.createElement('style'); st.id = 'lpd-skeleton-style'; st.textContent = skeletonStyle;
                document.head.appendChild(st);
            }
            var skeletonWrap = document.createElement('div');
            skeletonWrap.style.cssText = 'padding:20px 20px;display:flex;flex-direction:column;gap:12px;';
            for (var si = 0; si < 5; si++) {
                var skRow = document.createElement('div');
                var _sk1 = _D ? '#252535' : '#f0f0f0', _sk2 = _D ? '#1e1e38' : '#e0e0e0';
                skRow.style.cssText = 'height:' + (si === 0 ? 32 : 52) + 'px;border-radius:8px;' +
                    'background:linear-gradient(90deg,' + _sk1 + ' 25%,' + _sk2 + ' 50%,' + _sk1 + ' 75%);' +
                    'background-size:600px 100%;animation:lpd-shimmer 1.4s infinite linear;' +
                    'width:' + [100, 92, 85, 95, 78][si] + '%;';
                skeletonWrap.appendChild(skRow);
            }
            bodyEl.appendChild(skeletonWrap);
            popup.appendChild(bodyEl);

            overlay.appendChild(popup);
            overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
            document.addEventListener('keydown', function onEsc(e) { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onEsc); } });
            document.body.appendChild(overlay);

            function populate(result) {

                var sub = hdrInfo.querySelector('.lpd-hdr-sub');
                if (sub) { sub.textContent = esc(lane) + ' · ' + result.total + ' packages'; sub.style.color = _D ? '#8080a0' : '#555'; }

                summaryBar.innerHTML = '';
                var t = result.totals, tot = result.total;
                function summaryChip(bg, color, label, count) {
                    var pct = tot > 0 ? (count / tot * 100).toFixed(1) : '0.0';
                    var s = document.createElement('span');
                    s.style.cssText = 'display:inline-flex;align-items:center;gap:5px;padding:3px 11px;border-radius:20px;font-size:11px;font-weight:700;background:' + bg + ';color:' + color + ';white-space:nowrap;';
                    s.textContent = label + ' ' + count + ' (' + pct + '%)';
                    return s;
                }
                var _sc = _D
                    ? [['#0d2b10', '#69f0ae'], ['#2b1200', '#ffcc80'], ['#2a0a0a', '#ff8a80'], ['#0a1929', '#90caf9']]
                    : [['#e8f5e9', '#1b5e20'], ['#fff3e0', '#e65100'], ['#ffebee', '#b71c1c'], ['#e3f2fd', '#0d47a1']];
                summaryBar.appendChild(summaryChip(_sc[0][0], _sc[0][1], L('onTime'), t.inCpt));
                summaryBar.appendChild(summaryChip(_sc[1][0], _sc[1][1], L('lastHour'), t.preHour));
                summaryBar.appendChild(summaryChip(_sc[2][0], _sc[2][1], L('lateLabel'), t.late));
                if (t.early > 0) summaryBar.appendChild(summaryChip(_sc[3][0], _sc[3][1], L('earlyLabel'), t.early));

                tabBar.innerHTML = '';
                bodyEl.innerHTML = '';
                var tabs = [L('byPallet'), L('byCpt')];
                var panes = [buildPalletPane(result, SETTINGS.theme === 'dark'), buildCptPane(result, SETTINGS.theme === 'dark')];
                var tabBtns = [];
                tabs.forEach(function (label, i) {
                    var tb = document.createElement('button');
                    tb.textContent = label;
                    tb.style.cssText = 'border:none;border-bottom:3px solid transparent;padding:8px 16px;font-size:11px;font-family:"Amazon Ember",Arial,sans-serif;cursor:pointer;background:transparent;color:' + (_D ? '#8080a0' : '#666') + ';font-weight:600;white-space:nowrap;transition:color .15s,border-color .15s;';
                    tb.addEventListener('click', function () { activateTab(i); });
                    tabBar.appendChild(tb);
                    tabBtns.push(tb);
                });
                function activateTab(idx) {
                    tabBtns.forEach(function (b, i) {
                        var active = i === idx;
                        b.style.borderBottom = active ? '3px solid #7b1fa2' : '3px solid transparent';
                        b.style.color = active ? '#ce93d8' : (_D ? '#8080a0' : '#666');
                        b.style.fontWeight = active ? '800' : '600';
                        b.style.background = active ? (_D ? '#1e1e38' : '#fff') : 'transparent';
                    });
                    bodyEl.innerHTML = '';
                    bodyEl.appendChild(panes[idx]);
                }
                activateTab(0);
            }

            function showError(msg) {
                summaryBar.innerHTML = '';
                tabBar.innerHTML = '';
                bodyEl.innerHTML = '';
                var errDiv = document.createElement('div');
                errDiv.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:10px;color:#c62828;font-size:13px;font-weight:600;';
                errDiv.innerHTML = '<span style="font-size:28px;">⚠</span><span>' + esc(msg) + '</span>';
                bodyEl.appendChild(errDiv);
                var sub = hdrInfo.querySelector('.lpd-hdr-sub');
                if (sub) sub.textContent = esc(lane) + ' · erro';
            }

            return { populate: populate, showError: showError };
        }

        function showCptPanel(vrid, lane, result) {
            var handle = openCptPanelLoading(vrid, lane);
            handle.populate(result);
        }

        function buildCptPane(result, isDark) {
            var D = isDark || SETTINGS.theme === 'dark';
            var pane = document.createElement('div');
            pane.style.cssText = 'overflow-y:auto;flex:1;padding:12px 16px;background:' + (D ? '#1a1a2e' : '#fff') + ';';

            var cptEntries = Object.keys(result.cptMap).sort(function (a, b) {
                var da = parseApiDate(a), db = parseApiDate(b);
                return (da && db) ? da - db : 0;
            });

            var now = new Date();

            cptEntries.forEach(function (cpt) {
                var v = result.cptMap[cpt];
                var tot = v.inCpt + v.preHour + v.late + (v.early || 0);
                var cptT = parseApiDate(cpt);
                var expired = cptT && cptT < now;

                var blockBorder = D ? (expired ? '#5a1a1a' : '#2e2e45') : (expired ? '#ffcdd2' : '#e0e0e0');
                var hdrBg = D ? (expired ? '#2a0a0a' : '#252535') : (expired ? '#fff3f3' : '#f5f5f5');
                var hdrColor = D ? (expired ? '#ff8a80' : '#d0d0e8') : (expired ? '#b71c1c' : '#333');
                var pkgsColor = D ? '#8080a0' : '#555';
                var barBg = D ? '#2e2e45' : '#eee';

                var block = document.createElement('div');
                block.style.cssText = 'margin-bottom:14px;border-radius:8px;border:1px solid ' + blockBorder + ';overflow:hidden;';

                var rowHdr = document.createElement('div');
                rowHdr.style.cssText = 'display:flex;align-items:center;gap:8px;padding:7px 12px;background:' + hdrBg + ';';
                rowHdr.innerHTML = '<span style="flex:1;font-size:12px;font-weight:800;color:' + hdrColor + ';">' +
                    esc(cpt) + (expired ? ' <span style="font-size:10px;font-weight:700;color:#f44336;">' + L('cptExpired') + '</span>' : '') + '</span>' +
                    '<span style="font-size:12px;font-weight:700;color:' + pkgsColor + ';">' + tot + ' pkgs</span>';

                var barWrap = document.createElement('div');
                barWrap.style.cssText = 'display:flex;height:6px;border-radius:3px;overflow:hidden;margin:0 12px 8px;background:' + barBg + ';';
                function seg(w, bg) {
                    if (!w) return;
                    var s = document.createElement('div');
                    s.style.cssText = 'height:100%;background:' + bg + ';width:' + w + '%;transition:width .3s;';
                    barWrap.appendChild(s);
                }
                seg(tot > 0 ? (v.inCpt / tot * 100) : 0, '#4caf50');
                seg(tot > 0 ? (v.preHour / tot * 100) : 0, '#ff9800');
                seg(tot > 0 ? (v.late / tot * 100) : 0, '#f44336');
                seg(tot > 0 ? ((v.early || 0) / tot * 100) : 0, '#1976d2');

                var chips = document.createElement('div');
                chips.style.cssText = 'display:flex;gap:6px;padding:0 12px 10px;flex-wrap:wrap;';
                function countChip(bgLight, bgDark, colorLight, colorDark, label, count) {
                    if (!count) return;
                    var c = document.createElement('span');
                    c.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:2px 9px;border-radius:20px;font-size:10.5px;font-weight:700;background:' + (D ? bgDark : bgLight) + ';color:' + (D ? colorDark : colorLight) + ';white-space:nowrap;';
                    c.textContent = label + ' ' + count;
                    chips.appendChild(c);
                }
                countChip('#e8f5e9', '#0d2b10', '#2e7d32', '#69f0ae', L('onTime'), v.inCpt);
                countChip('#fff3e0', '#2b1200', '#e65100', '#ffcc80', L('lastHour'), v.preHour);
                countChip('#ffebee', '#2a0a0a', '#c62828', '#ff8a80', L('lateLabel'), v.late);
                countChip('#e3f2fd', '#0a1929', '#0d47a1', '#90caf9', L('earlyLabel'), v.early || 0);

                block.appendChild(rowHdr);
                block.appendChild(barWrap);
                block.appendChild(chips);
                pane.appendChild(block);
            });

            if (!cptEntries.length) {
                pane.style.color = D ? '#8080a0' : '#888';
                pane.textContent = L('noCptFound');
            }
            return pane;
        }

        function buildPalletPane(result, isDark) {
            var D = isDark || SETTINGS.theme === 'dark';
            var pane = document.createElement('div');
            pane.style.cssText = 'overflow-y:auto;flex:1;padding:12px 16px;background:' + (D ? '#1a1a2e' : '#fff') + ';';

            var palletEntries = Object.keys(result.palletMap).sort(function (a, b) {
                var ta = result.palletMap[a], tb = result.palletMap[b];
                return (tb.inCpt + tb.preHour + tb.late + (tb.early || 0)) - (ta.inCpt + ta.preHour + ta.late + (ta.early || 0));
            });

            palletEntries.forEach(function (palletLabel) {
                var v = result.palletMap[palletLabel];
                var tot = v.inCpt + v.preHour + v.late + (v.early || 0);

                var block = document.createElement('div');
                block.style.cssText = 'margin-bottom:14px;border-radius:8px;border:1px solid ' + (D ? '#2e2e45' : '#e0e0e0') + ';overflow:hidden;';

                var rowHdr = document.createElement('div');
                rowHdr.style.cssText = 'display:flex;align-items:center;gap:8px;padding:7px 12px;background:' + (D ? '#252535' : '#f5f5f5') + ';cursor:pointer;user-select:none;';
                rowHdr.innerHTML =
                    '<span style="font-size:18px;">📦</span>' +
                    '<span style="flex:1;font-size:12px;font-weight:800;color:' + (D ? '#d0d0e8' : '#333') + ';">' + esc(palletLabel) + '</span>' +
                    '<span style="font-size:12px;font-weight:700;color:' + (D ? '#8080a0' : '#555') + ';">' + tot + ' pkgs</span>' +
                    '<span class="lpd-chevron" style="font-size:13px;color:' + (D ? '#6060a0' : '#999') + ';margin-left:6px;">▾</span>';

                var barWrap = document.createElement('div');
                barWrap.style.cssText = 'display:flex;height:6px;overflow:hidden;margin:0 12px 8px;background:' + (D ? '#2e2e45' : '#eee') + ';border-radius:3px;';
                function seg(w, bg) {
                    if (!w) return;
                    var s = document.createElement('div');
                    s.style.cssText = 'height:100%;background:' + bg + ';width:' + w + '%;';
                    barWrap.appendChild(s);
                }
                seg(tot > 0 ? (v.inCpt / tot * 100) : 0, '#4caf50');
                seg(tot > 0 ? (v.preHour / tot * 100) : 0, '#ff9800');
                seg(tot > 0 ? (v.late / tot * 100) : 0, '#f44336');
                seg(tot > 0 ? ((v.early || 0) / tot * 100) : 0, '#1976d2');

                var chips = document.createElement('div');
                chips.style.cssText = 'display:flex;gap:6px;padding:0 12px 10px;flex-wrap:wrap;';
                function countChip(bgLight, bgDark, colorLight, colorDark, label, count) {
                    if (!count) return;
                    var c = document.createElement('span');
                    c.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:2px 9px;border-radius:20px;font-size:10.5px;font-weight:700;background:' + (D ? bgDark : bgLight) + ';color:' + (D ? colorDark : colorLight) + ';';
                    c.textContent = label + ' ' + count;
                    chips.appendChild(c);
                }
                countChip('#e8f5e9', '#0d2b10', '#2e7d32', '#69f0ae', L('onTime'), v.inCpt);
                countChip('#fff3e0', '#2b1200', '#e65100', '#ffcc80', L('lastHour'), v.preHour);
                countChip('#ffebee', '#2a0a0a', '#c62828', '#ff8a80', L('lateLabel'), v.late);
                countChip('#e3f2fd', '#0a1929', '#0d47a1', '#90caf9', L('earlyLabel'), v.early || 0);

                var dropdown = document.createElement('div');
                dropdown.style.cssText = 'display:none;border-top:1px solid ' + (D ? '#2e2e45' : '#e0e0e0') + ';max-height:200px;overflow-y:auto;background:' + (D ? '#1a1a2e' : '#fff') + ';';

                var thBg = D ? '#1e1e38' : '#fafafa';
                var thBorder = D ? '#2e2e45' : '#eee';
                var thColor = D ? '#8080a0' : '#888';
                var table = document.createElement('table');
                table.style.cssText = 'width:100%;border-collapse:collapse;font-size:11px;';
                table.innerHTML = '<thead><tr style="background:' + thBg + ';border-bottom:1px solid ' + thBorder + ';">' +
                    '<th style="text-align:left;padding:4px 12px;color:' + thColor + ';font-weight:600;">Package</th>' +
                    '<th style="text-align:left;padding:4px 8px;color:' + thColor + ';font-weight:600;">CPT</th>' +
                    '<th style="text-align:left;padding:4px 8px;color:' + thColor + ';font-weight:600;">Scan</th>' +
                    '<th style="text-align:center;padding:4px 8px;color:' + thColor + ';font-weight:600;">Status</th>' +
                    '</tr></thead>';
                var tbody = document.createElement('tbody');

                var catOrder = { late: 0, preHour: 1, early: 2, inCpt: 3 };
                v.pkgs.slice().sort(function (a, b) { return (catOrder[a.category] || 3) - (catOrder[b.category] || 3); })
                    .forEach(function (p, i) {
                        var catColors = D ? {
                            late: { bg: '#2a0a0a', badge: '#ff8a80', text: L('lateLabel') },
                            preHour: { bg: '#2b1200', badge: '#ffcc80', text: L('lastHour') },
                            early: { bg: '#0a1929', badge: '#90caf9', text: L('earlyLabel') },
                            inCpt: { bg: 'transparent', badge: '#69f0ae', text: '✓ Ok' }
                        } : {
                            late: { bg: '#ffebee', badge: '#c62828', text: L('lateLabel') },
                            preHour: { bg: '#fff3e0', badge: '#e65100', text: L('lastHour') },
                            early: { bg: '#e3f2fd', badge: '#0d47a1', text: L('earlyLabel') },
                            inCpt: { bg: 'transparent', badge: '#2e7d32', text: '✓ Ok' }
                        };
                        var cc = catColors[p.category];
                        var rowBg = D ? (i % 2 ? '#1e1e38' : '#1a1a2e') : (i % 2 ? '#fafafa' : '#fff');
                        var cellColor = D ? '#b0b0cc' : '#555';
                        var tr = document.createElement('tr');
                        tr.style.cssText = 'border-bottom:1px solid ' + (D ? '#2e2e45' : '#f5f5f5') + ';background:' + rowBg + ';';
                        tr.innerHTML =
                            '<td style="padding:4px 12px;font-family:monospace;font-size:10.5px;color:' + (D ? '#d0d0e8' : '#222') + ';">' + esc(p.label) + '</td>' +
                            '<td style="padding:4px 8px;color:' + cellColor + ';">' + esc(p.cpt) + '</td>' +
                            '<td style="padding:4px 8px;color:' + cellColor + ';">' + esc(p.assTime) + '</td>' +
                            '<td style="padding:4px 8px;text-align:center;"><span style="padding:1px 7px;border-radius:10px;background:' + cc.bg + ';color:' + cc.badge + ';font-size:10px;font-weight:700;">' + cc.text + '</span></td>';
                        tbody.appendChild(tr);
                    });
                table.appendChild(tbody);
                dropdown.appendChild(table);

                var open = false;
                rowHdr.addEventListener('click', function () {
                    open = !open;
                    dropdown.style.display = open ? 'block' : 'none';
                    rowHdr.querySelector('.lpd-chevron').textContent = open ? '▴' : '▾';
                });

                block.appendChild(rowHdr);
                block.appendChild(barWrap);
                block.appendChild(chips);
                block.appendChild(dropdown);
                pane.appendChild(block);
            });

            if (!palletEntries.length) {
                pane.style.color = D ? '#8080a0' : '#888';
                pane.textContent = L('noPalletFound');
            }
            return pane;
        }

        function getCptFromRow(row) {
            if (!row) return null;
            var candidates = [
                row.querySelector('td.sorting_2'),
                row.querySelector('td[class*="cpt"]'),
                row.querySelector('td.cptCol'),
            ];
            for (var i = 0; i < candidates.length; i++) {
                var el = candidates[i];
                if (el) {
                    var txt = el.textContent.trim();
                    var t = parseApiDate(txt);
                    if (t) return t;
                }
            }

            var tds = row.querySelectorAll('td');
            for (var j = 0; j < tds.length; j++) {
                var txt2 = tds[j].textContent.trim();
                if (/^\d{2}-[A-Za-z]{3}-\d{2,4}\s+\d{2}:\d{2}/.test(txt2)) {
                    var t2 = parseApiDate(txt2);
                    if (t2) return t2;
                }
            }
            return null;
        }

        function runCheck(row, btn) {
            var vrid = getVridFromRow(row);
            if (!vrid) { log('Não foi possível determinar VRID', 'error'); return; }

            var _p0 = extractParamsFromRow(row, vrid);
            if (!_p0.loadGroupId) {
                btn.textContent = '⏳ Aguardando dados...';
                btn.disabled = true;
                btn.style.background = '#555';
                var _waitAttempts = 0;
                var _waitIv = setInterval(function () {
                    _waitAttempts++;
                    var _p1 = extractParamsFromRow(row, vrid);
                    if (_p1.loadGroupId) {
                        clearInterval(_waitIv);
                        log('loadGroupId capturado após ' + (_waitAttempts * 200) + 'ms — continuando', 'info');
                        runCheckCore(row, btn, vrid, _p1);
                    } else if (_waitAttempts >= 40) {
                        clearInterval(_waitIv);
                        log('loadGroupId não capturado após 8s — o Angular ainda não fez o XHR para este VRID', 'warn');
                        btn.textContent = '⚠ Sem dados';
                        btn.style.background = '#e65100';
                        btn.disabled = false;
                        setTimeout(function () { btn.textContent = '📦 CPT'; btn.style.background = '#7b1fa2'; }, 4000);
                    }
                }, 200);
                return;
            }

            runCheckCore(row, btn, vrid, _p0);
        }

        function runCheckCore(row, btn, vrid, p) {

            var truckCptTime = getCptFromRow(row);

            log('--- Check VRID: ' + vrid, 'info');
            log('loadGroupId="' + p.loadGroupId + '" trailerId="' + p.trailerId + '" planId="' + p.planId + '" truckCpt="' + (truckCptTime ? truckCptTime.toLocaleString() : 'null') + '"', 'info');

            if (!p.loadGroupId) {
                log('loadGroupId vazio — XHR não capturado', 'warn');
                btn.textContent = '⚠ Sem loadGroupId';
                btn.style.background = '#e65100';
                btn.disabled = false;
                setTimeout(function () { btn.textContent = '📦 CPT'; btn.style.background = '#7b1fa2'; }, 4000);
                return;
            }

            if (!p.trailerId || /^OTHR/i.test(p.trailerId)) {
                var reason = /^OTHR/i.test(p.trailerId)
                    ? 'Caminhão ainda em doca (trailerId virtual "' + p.trailerId + '") — disponível apenas após liberação'
                    : 'trailerId vazio — disponível apenas após liberação do caminhão';
                log(reason, 'warn');
                btn.textContent = '🚛 Em doca';
                btn.style.background = '#546e7a';
                btn.disabled = false;
                setTimeout(function () { btn.textContent = '📦 CPT'; btn.style.background = '#7b1fa2'; }, 3000);
                return;
            }

            btn.textContent = '⏳ Checking...';
            btn.disabled = true;
            btn.style.background = '#555';

            var laneEl = row.querySelector('td.routeCol, td[class*="route"], span[class*="stackFilter"]');
            var lane = (laneEl && laneEl.textContent.trim()) || vrid;
            var panelHandle = openCptPanelLoading(vrid, lane);

            var formBody = [
                'entity=getOutboundLoadContainerDetails',
                'nodeId=' + encodeURIComponent(p.nodeId),
                'loadGroupId=' + encodeURIComponent(p.loadGroupId),
                'planId=' + encodeURIComponent(p.planId),
                'vrid=' + encodeURIComponent(vrid),
                'status=',
                'trailerId=' + encodeURIComponent(p.trailerId),
                'trailerNumber=' + encodeURIComponent(p.trailerNumber)
            ].join('&');

            log('POST body: ' + formBody, 'debug');

            GM_xmlhttpRequest({
                method: 'POST',
                url: location.origin + '/ssp/dock/hrz/ob/fetchdata',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                data: formBody,
                withCredentials: true,
                onload: function (resp) {
                    log('HTTP ' + resp.status + ' — ' + resp.responseText.length + ' chars', resp.status === 200 ? 'info' : 'error');
                    if (resp.status !== 200) {
                        log('Body: ' + resp.responseText.slice(0, 400), 'error');
                        panelHandle.showError('HTTP ' + resp.status);
                        btn.textContent = '⚠ HTTP ' + resp.status;
                        btn.style.background = '#c62828';
                        btn.disabled = false;
                        return;
                    }

                    var result = processFetchData(resp.responseText, truckCptTime);
                    if (!result) {
                        panelHandle.showError('Parse error — resposta inesperada da API');
                        btn.textContent = '⚠ Parse error';
                        btn.style.background = '#c62828';
                        btn.disabled = false;
                        return;
                    }

                    var btnBg = '#2e7d32';
                    if (result.totals.preHour > 0) btnBg = '#e65100';
                    if (result.totals.late > 0) btnBg = '#c62828';

                    var lateLabel = result.totals.late > 0 ? '🚨 ' + result.totals.late + ' late' : '';
                    var preLabel = result.totals.preHour > 0 ? '⏰ ' + result.totals.preHour + ' última h' : '';
                    var okLabel = !result.totals.late && !result.totals.preHour ? L('onTime') : '';
                    btn.textContent = lateLabel || preLabel || okLabel;
                    btn.style.background = btnBg;
                    btn.disabled = false;
                    btn.onclick = function (e) { e.stopPropagation(); showCptPanel(vrid, lane, result); };

                    panelHandle.populate(result);
                },
                onerror: function () {
                    log('Network error', 'error');
                    panelHandle.showError('Network error');
                    btn.textContent = '⚠ Network error';
                    btn.style.background = '#c62828';
                    btn.disabled = false;
                }
            });
        }


    })();

    if (_SUITE.isDock || _SUITE.isVista) {
        (function loadModuleMapaVSM() {
            if (!_SUITE.isDock && !_SUITE.isVista) return;
            'use strict';

            const BASE = _SUITE.BASE;

            const CSRF_TTL = 15 * 60 * 1000;
            const FETCH_CONCURRENCY = 50;

            let _csrf = '';

            const DEFAULT_VSM_SEGMENT_MAP = {
                'SCP9': ['AA11'], 'SOG9': ['AA12'], 'DBS5': ['AA21'], 'SJO9': ['AA22'], 'STA9': ['AA31'],
                'SBP9': ['AA32'],
                'SUA9': ['AA42'], 'SVA9': ['AA51'], 'SSD9': ['AA52'], 'SBT9': ['AA53'], 'XSP2': ['AB31'], 'SPC9': ['AB32'], 'SSP9': ['AB41'], 'SBZ1_C2': ['AB42'],
                'SSO9': ['AB51'], 'SSC9': ['AB52'], 'SRG9': ['AB53'], 'DSA8': ['AB61'],
                'SDI9_C2': ['CC11'], 'DSP4': ['CC12'], 'DBR9_EF': ['CC13'], 'SLI9_C2': ['CC21'], 'SCG9': ['CC22'],
                'DBR9': ['CC23'], 'SCZ9': ['CC31'], 'SDA9': ['CC32'], 'SBZ1': ['CC34'],
                'SDI9': ['CC35'], 'SLI9': ['CC36'], 'SLO9': ['CC41'],
                'SBZ2': ['CC61'], 'DSP2': ['CD11'], 'SQA9': ['CD12'], 'SFC9': ['CD13'], 'SFI9': ['CD21'],
                'DFR2': ['CD23'], 'SRP9': ['CD31'], 'SAE9': ['CD32'], 'SCB9': ['CD33'], 'DBS5_EF': ['CD41'],
                'SBL9': ['CD51'], 'SFM9': ['CD52'], 'DRS5': ['CD53'], 'SPM9': ['CD61'], 'TBAV': ['H-11'],
                'STJ9': ['H-31'], 'SSJ9': ['H-32'], 'SUB9': ['H-41'], 'DSP5': ['H-51'],
                'GIG7': ['H-61'], 'CNF7': ['X-12'], 'DGO2': ['X-21'], 'SSV9': ['X-22'],
                'REC9': ['X-31'], 'DPR2': ['X-41'], 'SBU9': ['X-51'], 'DSP2_EF': ['X-53'], 'DRS5_EF': ['X-61'],
                'DSP4_EF': ['X-62']
            };

            const DEFAULT_BELT_GROUPS = [
                { id: 1, vsms: ['H-12', 'H-11', 'H-31', 'H-32'] },
                { id: 2, vsms: ['H-41', 'H-51', 'H-61'] },
                { id: 3, vsms: ['CD12', 'CD13', 'CD11'] },
                { id: 4, vsms: ['CD23', 'CD31', 'CD32', 'CD33', 'CD21'] },
                { id: 5, vsms: ['CC12', 'CC11', 'CC13', 'CC14'] },
                { id: 6, vsms: ['CC23', 'CC22', 'CC21'] },
                { id: 7, vsms: ['CC36', 'CC35', 'CC34', 'CC32', 'CC31'] },
                { id: 8, vsms: ['CC61', 'CC41'] },
                { id: 9, vsms: ['X-22', 'X-21', 'X-12'] },
                { id: 10, vsms: ['X-41', 'X-32', 'X-31'] },
                { id: 11, vsms: ['X-53', 'X-52', 'X-51'] },
                { id: 12, vsms: ['X-61', 'X-62'] },
                { id: 13, vsms: ['AA11', 'AA12', 'AA21', 'AA22'] },
                { id: 14, vsms: ['AA31', 'AA32', 'AA42', 'AA52', 'AA51', 'AA53'] },
                { id: 15, vsms: ['AB31', 'AB32', 'AB41', 'AB42'] },
                { id: 16, vsms: ['AB51', 'AB52', 'AB53', 'AB61'] },
                { id: 17, vsms: ['CD51', 'CD52', 'CD53', 'CD61'] }
            ];

            const DEFAULT_MAP_MATRIX = [
                ["", "", "", "", "", "", "", "", "", "[F1]", "[L_F1]", "", "", "[L_TS]", "[SKIP]", "", "", "[L_F2]", "[F2]", "", "", "", "", "", "", "", "", "", ""],
                ["", "", "", "", "", "", "", "", "", "", "", "", "", "[TS_V]", "[SKIP]", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
                ["", "", "", "", "", "[B17]", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
                ["0", "0", "0", "0", "0", "0", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
                ["-", "CD51", "CD52", "CD53", "CD61", "CD61", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
                ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
                ["0", "0", "0", "0", "0", "0", "", "0", "0", "0", "0", "0", "0", "", "", "0", "0", "0", "0", "0", "0", "", "0", "0", "0", "0", "0", "0", "0"],
                ["H-12", "H-11", "H-31", "H-31", "H-32", "H-32", "", "CC12", "CC11", "CC11", "CC13", "CC14", "-", "", "", "X-22", "X-22", "X-21", "X-21", "X-12", "X-12", "", "AA11", "AA11", "AA12", "AA12", "AA21", "AA21", "AA22"],
                ["", "", "", "", "", "[B1]", "", "[B5]", "", "", "", "", "", "", "", "", "", "", "", "", "[B9]", "", "[B13]", "", "", "", "", "", ""],
                ["-", "H-11", "H-31", "H-32", "H-32", "H-32", "", "CC12", "CC12", "CC12", "CC13", "CC14", "-", "", "", "X-22", "X-22", "X-21", "X-21", "X-12", "X-12", "", "AA11", "AA11", "AA12", "AA12", "AA21", "AA21", "AA22"],
                ["0", "0", "0", "0", "0", "0", "", "0", "0", "0", "0", "0", "0", "", "", "0", "0", "0", "0", "0", "0", "", "0", "0", "0", "0", "0", "0", "0"],
                ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
                ["0", "0", "0", "0", "0", "0", "", "0", "0", "0", "0", "0", "0", "", "", "0", "0", "0", "0", "0", "0", "", "0", "0", "0", "0", "0", "0", ""],
                ["H-41", "H-41", "H-51", "H-61", "H-61", "H-61", "", "CC23", "CC23", "CC22", "CC22", "CC22", "CC21", "", "", "-", "X-41", "X-41", "X-32", "X-31", "X-31", "", "AA31", "AA31", "AA32", "AA42", "AA52", "-", ""],
                ["", "", "", "", "", "[B2]", "", "[B6]", "", "", "", "", "", "", "", "", "", "", "", "", "[B10]", "", "[B14]", "", "", "", "", "", ""],
                ["H-41", "H-41", "H-41", "H-51", "H-61", "H-61", "", "CC23", "CC23", "CC23", "CC22", "CC22", "CC21", "", "", "-", "-", "X-41", "X-41", "X-31", "X-31", "", "AA31", "AA31", "AA32", "AA51", "AA53", "-", ""],
                ["0", "0", "0", "0", "0", "0", "", "0", "0", "0", "0", "0", "0", "", "", "0", "0", "0", "0", "0", "0", "", "0", "0", "0", "0", "0", "0", ""],
                ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
                ["0", "0", "0", "0", "0", "0", "", "0", "0", "0", "0", "0", "0", "", "", "0", "0", "0", "0", "0", "0", "", "0", "0", "0", "0", "0", "0", ""],
                ["CD12", "CD12", "CD13", "CD13", "CD11", "CD11", "", "CC36", "CC35", "CC34", "CC34", "CC32", "CC31", "", "", "", "X-53", "X-52", "X-51", "X-51", "X-51", "", "AB31", "AB31", "AB32", "AB32", "AB41", "-", ""],
                ["", "", "", "", "", "[B3]", "", "[B7]", "", "", "", "", "", "", "", "", "", "", "", "", "[B11]", "", "[B15]", "", "", "", "", "", ""],
                ["CD12", "CD12", "CD13", "CD13", "CD11", "CD11", "", "CC36", "CC35", "CC34", "CC34", "CC32", "CC31", "", "", "-", "-", "-", "-", "X-51", "X-51", "", "AB31", "AB32", "AB32", "AB41", "AB41", "AB42", ""],
                ["0", "0", "0", "0", "0", "0", "", "0", "0", "0", "0", "0", "0", "", "", "0", "0", "0", "0", "0", "0", "", "0", "0", "0", "0", "0", "0", ""],
                ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
                ["0", "0", "0", "0", "0", "0", "", "0", "0", "0", "0", "0", "0", "", "", "0", "0", "0", "0", "0", "0", "", "0", "0", "0", "0", "0", "0", "0"],
                ["CD23", "CD23", "CD31", "CD31", "CD32", "CD33", "", "CC61", "CC61", "CC61", "CC41", "CC41", "CC41", "", "", "", "", "", "X-61", "X-61", "X-61", "", "AB51", "AB52", "AB52", "AB53", "AB61", "AB61", "AIR"],
                ["", "", "", "", "", "[B4]", "", "[B8]", "", "", "", "", "", "", "", "", "", "", "", "", "[B12]", "", "[B16]", "", "", "", "", "", ""],
                ["CD21", "CD23", "CD23", "CD31", "CD31", "CD32", "", "CC61", "CC61", "CC61", "CC41", "CC41", "CC41", "", "", "-", "-", "-", "X-62", "X-61", "X-61", "", "AB52", "AB52", "AB53", "AB61", "AB61", "AB61", ""],
                ["0", "0", "0", "0", "0", "0", "", "0", "0", "0", "0", "0", "0", "", "", "0", "0", "0", "0", "0", "0", "", "0", "0", "0", "0", "0", "0", ""]
            ];

            const DEFAULT_FINGERS = [
                { id: 1, name: "Finger 1", belts: [1, 2, 3, 4, 5, 6, 7, 8, 17] },
                { id: 2, name: "Finger 2", belts: [9, 10, 11, 12, 13, 14, 15, 16] }
            ];

            let ALL_VSMS = [];
            let VSM_SEGMENT_MAP = {};
            let BELT_GROUPS = [];
            let activeMapMatrix = [];
            let activeFingers = [];

            let activeMappings = [];
            let configIsDirty = false;

            let currentCountMode = 'totalCount';
            let currentVsmTotals = {};
            let currentVsmMatrix = {};
            let staticMaxPkgsPerHour = 400;
            let staticFingerRate = 4000;
            let staticSelectedHour = -1;
            let cbRate = 500;
            let poRate = 1000;
            let activeNodeId = _SUITE.utils.detectNode() || 'CGH7';
            let lastExportData = [];
            // Expose VSM module to the suite for external data retrieval
            _SUITE.vsm = {
                getCache: () => lastExportData,
                fetchByRoute: function (routes, callback) {
                    if (!routes || routes.length === 0) { callback([]); return; }
                    let routeArr = [];
                    if (Array.isArray(routes)) {
                        routes.forEach(r => { routeArr = routeArr.concat(String(r).split('-')); });
                    } else {
                        routeArr = String(routes).split('-');
                    }
                    routeArr = routeArr.map(r => r.trim()).filter(r => r);

                    // 1. Try Cache First
                    const cached = lastExportData.filter(v => routeArr.includes(v.route) || routeArr.includes(v.vrid));
                    if (cached.length > 0) {
                        const allContainers = [].concat(...cached.map(v => v.containers || []));
                        if (allContainers.length > 0) {
                            callback(allContainers);
                            return;
                        }
                    }

                    // 2. Headless Fetch (Reliable VSM style)
                    const ts = getLocalDayTs(new Date());
                    fetchVRIData(ts.start, ts.end, (err, res) => {
                        if (err || !res) { callback([]); return; }
                        const src = res?.ret?.aaData ?? {};
                        const arr = Array.isArray(src) ? src : Object.values(src);
                        const vridList = arr.map(item => {
                            const l = getLoadObject(item);
                            return {
                                vrid: l.vrid || l.vrId || l.vId || '',
                                planId: l.planId || l.planForOrderId || '',
                                route: l.route || ''
                            };
                        }).filter(v => v.vrid && (routeArr.includes(v.route) || routeArr.includes(v.vrid)));

                        if (!vridList.length) { callback([]); return; }

                        const planIds = vridList.map(v => v.planId).filter(id => id);
                        fetchContainers(planIds, (errC, resC) => {
                            if (errC || !resC) { callback([]); return; }
                            const countMap = resC?.ret?.inboundCDTContainerCount ?? {};
                            let allResult = [];
                            planIds.forEach(pid => {
                                const conts = countMap[pid] || [];
                                allResult = allResult.concat(conts);
                            });
                            callback(allResult);
                        });
                    });
                }
            };

            let autoRefreshTimer = null;
            let autoRefreshCountdownInterval = null;
            let autoRefreshNextTimestamp = 0;
            let lastSearch = null;
            let isRefreshing = false;

            let selectedVrids = new Set();
            let hideZeroPkgs = true;

            function initializeConfig() {
                const savedNode = GM_getValue('vsm_custom_node');
                if (savedNode) activeNodeId = savedNode;

                const savedMap = GM_getValue('vsm_custom_map_matrix');
                if (savedMap) {
                    try { activeMapMatrix = JSON.parse(savedMap); }
                    catch (e) { activeMapMatrix = structuredClone(DEFAULT_MAP_MATRIX); }
                } else {
                    activeMapMatrix = JSON.parse(JSON.stringify(DEFAULT_MAP_MATRIX));
                }

                const saved = GM_getValue('vsm_custom_config');
                if (saved) {
                    try { activeMappings = JSON.parse(saved); }
                    catch (e) { buildDefaultMappings(); }
                } else {
                    buildDefaultMappings();
                }

                const savedFingers = GM_getValue('vsm_custom_fingers');
                if (savedFingers) {
                    try { activeFingers = JSON.parse(savedFingers); }
                    catch (e) { activeFingers = JSON.parse(JSON.stringify(DEFAULT_FINGERS)); }
                } else {
                    activeFingers = JSON.parse(JSON.stringify(DEFAULT_FINGERS));
                }

                rebuildDictionaries();
            }

            function buildDefaultMappings() {
                activeMappings = [];
                const vsmToGroup = {};
                for (const group of DEFAULT_BELT_GROUPS) {
                    for (const vsm of group.vsms) vsmToGroup[vsm] = group.id;
                }

                for (const route in DEFAULT_VSM_SEGMENT_MAP) {
                    const vsms = DEFAULT_VSM_SEGMENT_MAP[route];
                    for (const vsm of vsms) {
                        activeMappings.push({
                            route: route,
                            vsm: vsm,
                            group: vsmToGroup[vsm] || 99
                        });
                    }
                }
            }

            function rebuildDictionaries() {
                VSM_SEGMENT_MAP = {};
                const vsmSet = new Set(['AIR']);

                BELT_GROUPS = JSON.parse(JSON.stringify(DEFAULT_BELT_GROUPS));
                BELT_GROUPS.forEach(g => { g.vsms = []; });

                activeMappings.forEach(m => {
                    const routeUpper = m.route.toUpperCase();
                    const vsmUpper = m.vsm.toUpperCase();
                    const groupId = parseInt(m.group, 10);

                    if (!VSM_SEGMENT_MAP[routeUpper]) VSM_SEGMENT_MAP[routeUpper] = [];
                    if (!VSM_SEGMENT_MAP[routeUpper].includes(vsmUpper)) {
                        VSM_SEGMENT_MAP[routeUpper].push(vsmUpper);
                    }

                    vsmSet.add(vsmUpper);

                    let groupObj = BELT_GROUPS.find(bg => bg.id === groupId);
                    if (!groupObj && !isNaN(groupId)) {
                        groupObj = { id: groupId, vsms: [] };
                        BELT_GROUPS.push(groupObj);
                    }
                    if (groupObj) {
                        if (!groupObj.vsms.includes(vsmUpper)) groupObj.vsms.push(vsmUpper);
                    }
                });

                ALL_VSMS = Array.from(vsmSet).sort();
            }

            function saveConfig() {
                const nodeInput = document.getElementById('cfg-node-input');
                if (nodeInput) {
                    const val = nodeInput.value.trim().toUpperCase();
                    if (val) {
                        activeNodeId = val;
                        GM_setValue('vsm_custom_node', activeNodeId);
                    }
                }

                const tbody = document.getElementById('config-table-body');
                if (tbody) {
                    const rows = tbody.querySelectorAll('tr.cfg-row');
                    const newMappings = [];
                    rows.forEach(row => {
                        const r = row.querySelector('.cfg-route').value.trim();
                        const v = row.querySelector('.cfg-vsm-input').value.trim();
                        const g = row.querySelector('.cfg-group').value.trim();
                        if (r && v && g) newMappings.push({ route: r, vsm: v, group: g });
                    });
                    activeMappings = newMappings;
                    GM_setValue('vsm_custom_config', JSON.stringify(activeMappings));
                }

                const fTbody = document.getElementById('config-finger-body');
                if (fTbody) {
                    const fRows = fTbody.querySelectorAll('tr.cfg-finger-row');
                    const newFingers = [];
                    fRows.forEach(row => {
                        const id = parseInt(row.querySelector('.cfg-f-id').value, 10);
                        const name = row.querySelector('.cfg-f-name').value.trim();
                        const beltsStr = row.querySelector('.cfg-f-belts').value;
                        if (!isNaN(id)) {
                            const belts = beltsStr.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
                            newFingers.push({ id, name, belts });
                        }
                    });
                    activeFingers = newFingers;
                    GM_setValue('vsm_custom_fingers', JSON.stringify(activeFingers));
                }

                rebuildDictionaries();
                configIsDirty = false;

                renderConfigTable();
                if (lastExportData.length > 0) computeAndRenderAll();
            }

            function resetConfigToDefault() {
                if (confirm("Tem certeza que deseja restaurar as configurações padrão (Node, Rotas, VSM, Grupos e Fingers)?")) {
                    activeNodeId = detectCurrentNode() || GM_getValue('tl_node', 'Node não selecionado');
                    buildDefaultMappings();
                    activeFingers = JSON.parse(JSON.stringify(DEFAULT_FINGERS));

                    GM_setValue('vsm_custom_node', activeNodeId);
                    GM_setValue('vsm_custom_config', JSON.stringify(activeMappings));
                    GM_setValue('vsm_custom_fingers', JSON.stringify(activeFingers));

                    const nodeInput = document.getElementById('cfg-node-input');
                    if (nodeInput) nodeInput.value = activeNodeId;

                    rebuildDictionaries();
                    configIsDirty = false;
                    renderConfigTable();
                    if (lastExportData.length > 0) computeAndRenderAll();
                }
            }

            function loadCsrfFromStorage() {
                try {
                    const t = localStorage.getItem('gql_csrf_token');
                    const ts = parseInt(localStorage.getItem('gql_csrf_ts') || '0', 10);
                    if (t && t.length > 10 && (Date.now() - ts) < CSRF_TTL) {
                        _csrf = t;
                        return true;
                    }
                } catch (e) { }
                return false;
            }

            function saveCsrf(t) {
                if (!t || t.length <= 10) return;
                _csrf = t;
                try {
                    localStorage.setItem('gql_csrf_token', t);
                    localStorage.setItem('gql_csrf_ts', String(Date.now()));
                } catch (e) { }
            }

            // Sync local _csrf with the central interceptor (avoiding redundant XHR prototype patch)
            (function syncCsrfFromCentral() {
                // Listen for CSRF changes from the central patchXHR via polling _SUITE.antiCsrfToken
                setInterval(function () {
                    if (_SUITE.antiCsrfToken && _SUITE.antiCsrfToken.length > 10 && _SUITE.antiCsrfToken !== _csrf) {
                        _csrf = _SUITE.antiCsrfToken;
                        saveCsrf(_SUITE.antiCsrfToken);
                    }
                }, 2000);

                // Keep fetch interception (unique to VSM — no other module does this)
                const originalFetch = window.fetch;
                if (originalFetch && !window._tlFetchPatched) {
                    window._tlFetchPatched = true;
                    window.fetch = async function () {
                        if (arguments[1] && arguments[1].headers) {
                            try {
                                const headers = new Headers(arguments[1].headers);
                                const token = headers.get('anti-csrftoken-a2z');
                                if (token) {
                                    _csrf = token;
                                    _SUITE.antiCsrfToken = token;
                                    saveCsrf(token);
                                }
                            } catch (e) { }
                        }
                        return originalFetch.apply(this, arguments);
                    };
                }
            })();

            loadCsrfFromStorage();
            initializeConfig();

            function parseLocalDateTime(s) {
                if (!s) return null;
                const m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})\s+(\d{2}):(\d{2})/);
                if (!m) return null;
                const months = {
                    Jan: 0, Fev: 1, Feb: 1, Mar: 2, Abr: 3, Apr: 3, Mai: 4, May: 4,
                    Jun: 5, Jul: 6, Ago: 7, Aug: 7, Set: 8, Sep: 8, Out: 9, Oct: 9,
                    Nov: 10, Dez: 11, Dec: 11
                };
                let year = parseInt(m[3], 10);
                if (year < 100) year += 2000;
                return new Date(year, months[m[2]], parseInt(m[1], 10), parseInt(m[4], 10), parseInt(m[5], 10));
            }

            function getLocalDayTs(date) {
                const s = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
                const e = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59);
                return { start: String(s.getTime()), end: String(e.getTime()) };
            }

            var esc = _SUITE.utils.esc;

            function getLoadObject(item) {
                if (!item) return {};
                if (item.load) return item.load;
                const found = Object.values(item).find(v => v && typeof v === 'object' && (v.vrid || v.vrId || v.vId || v.planId || v.planForOrderId));
                return found || item;
            }

            function fetchVRIData(startTimestamp, endTimestamp, callback) {
                if (!activeNodeId || activeNodeId.includes('selecionado')) {
                    activeNodeId = _SUITE.utils.detectNode() || 'CGH7';
                }

                _SUITE.utils.fetchAntiCsrfToken(function (token) {
                    const finalToken = token || _csrf;
                    if (!finalToken) {
                        callback('Erro: Token de segurança não encontrado. Recarregue a página.', null);
                        return;
                    }

                    const params = new URLSearchParams({
                        entity: 'getInboundDockView',
                        nodeId: activeNodeId,
                        startDate: startTimestamp,
                        endDate: endTimestamp,
                        loadCategories: 'inboundScheduled,inboundArrived,inboundCompleted',
                        shippingPurposeType: 'TRANSSHIPMENT,NON-TRANSSHIPMENT,SHIP_WITH_AMAZON'
                    });
                    GM_xmlhttpRequest({
                        method: 'POST',
                        url: BASE + 'ssp/dock/hrz/ib/fetchdata',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'X-Requested-With': 'XMLHttpRequest',
                            'anti-csrftoken-a2z': finalToken
                        },
                        data: params.toString(),
                        withCredentials: true,
                        timeout: 20000,
                        onload: function (response) {
                            if (response.finalUrl && (response.finalUrl.includes('midway-auth') || response.finalUrl.includes('/SSO/'))) {
                                callback('SESSAO_EXPIRADA', null);
                                return;
                            }
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
                });
            }

            function fetchContainers(planIds, callback) {
                if (!planIds || planIds.length === 0) { callback(null, {}); return; }
                const idsParam = planIds.join(',');

                _SUITE.utils.fetchAntiCsrfToken(function (token) {
                    const finalToken = token || _csrf;
                    const params = new URLSearchParams({
                        entity: 'getCDTBasedContainerCount',
                        inboundLoadIds: idsParam,
                        nodeId: activeNodeId
                    });
                    GM_xmlhttpRequest({
                        method: 'POST',
                        url: BASE + 'ssp/dock/hrz/ib/fetchdata',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'X-Requested-With': 'XMLHttpRequest',
                            'anti-csrftoken-a2z': finalToken
                        },
                        data: params.toString(),
                        withCredentials: true,
                        timeout: 20000,
                        onload: function (response) {
                            if (response.finalUrl && (response.finalUrl.includes('midway-auth') || response.finalUrl.includes('/SSO/'))) {
                                callback('SESSAO_EXPIRADA', null);
                                return;
                            }
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
                });
            }

            function fetchCompletePercent(planIds, callback) {
                if (!planIds || planIds.length === 0) { callback(null, {}); return; }
                const idsParam = planIds.join(',');
                const params = new URLSearchParams({
                    entity: 'getInboundContainerCount',
                    inboundLoadIds: idsParam,
                    nodeId: activeNodeId
                });
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: BASE + 'ssp/dock/hrz/ib/fetchdata',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'X-Requested-With': 'XMLHttpRequest',
                        'anti-csrftoken-a2z': _csrf
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
            }

            function getVRIDsFromData(data, startDate, startHour, endDate, endHour) {
                if (!data || !data.ret || !data.ret.aaData) return [];

                const dataArray = Array.isArray(data.ret.aaData) ? data.ret.aaData : Object.values(data.ret.aaData);
                const results = [];

                const startDateTime = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), startHour - 1, 0, 0);
                const endDateTime = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), endHour, 59, 59);

                if (startDateTime.getTime() >= endDateTime.getTime()) return [];

                for (let i = 0; i < dataArray.length; i++) {
                    const item = dataArray[i];
                    const load = getLoadObject(item);

                    const scheduledTimeStr = load.scheduledArrivalTime;
                    if (!scheduledTimeStr) continue;

                    const scheduledDate = parseLocalDateTime(scheduledTimeStr);
                    if (!scheduledDate) continue;

                    const scheduledMs = scheduledDate.getTime();
                    if (scheduledMs >= startDateTime.getTime() && scheduledMs <= endDateTime.getTime()) {
                        results.push({
                            vrid: load.vrid || load.vrId || load.vId,
                            planId: load.planId || load.planForOrderId,
                            scheduledArrivalTime: load.scheduledArrivalTime,
                            route: load.route,
                            actualArrivalTime: load.actualArrivalTime || load.actualDepartureTime || 'N/A'
                        });
                    }
                }
                return results;
            }

            function getCounts(container) {
                let counts = container[currentCountMode];
                if (!counts) {
                    const struct = container.loadGroupCountStruct;
                    if (struct && struct[currentCountMode]) counts = struct[currentCountMode];
                }
                if (!counts) counts = { P: 0, C: 0 };
                return { P: counts.P !== undefined ? counts.P : 0, C: counts.C !== undefined ? counts.C : 0 };
            }

            function simplifyLane(lane) {
                if (!lane) return '—';
                if (lane.indexOf('->') === -1) return lane;
                const parts = lane.split('->');
                if (parts[0] === activeNodeId) return parts[1];
                if (parts[1] === activeNodeId) return parts[0];
                return lane;
            }

            function splitLaneSegments(lane) {
                if (!lane) return [''];
                if (lane.indexOf('->') === -1) return [lane];
                const parts = lane.split('->');
                const afterArrow = parts[1];
                if (afterArrow.indexOf('-') === -1) return [afterArrow];
                if (/-(BUS|B)$/i.test(afterArrow)) return [afterArrow];
                const segments = afterArrow.split('-');
                const allNodes = segments.every(p => /^[A-Z]{2,4}\d[A-Z0-9]{0,4}$/i.test(p));
                if (allNodes) return segments;
                return [afterArrow];
            }

            function segmentToVSM(segment) {
                if (!segment) return [];
                const upper = segment.toUpperCase();
                if (VSM_SEGMENT_MAP[upper]) return VSM_SEGMENT_MAP[upper];
                return [];
            }

            function computeVsmHourlyMatrixFromExportData(exportDataList) {
                const matrix = {};
                for (const vsm of ALL_VSMS) {
                    matrix[vsm] = new Array(25).fill(0);
                }

                for (const vridData of exportDataList) {
                    const timeStr = vridData.actualArrivalTime && vridData.actualArrivalTime !== 'N/A' ? vridData.actualArrivalTime : vridData.scheduledArrivalTime;
                    if (!timeStr) continue;
                    const vridDate = parseLocalDateTime(timeStr);
                    if (!vridDate) continue;

                    const hour = vridDate.getHours();
                    const minute = vridDate.getMinutes();
                    const currentRatio = (60 - minute) / 60;

                    const route = vridData.route || '';
                    const isMMRoute = route.toUpperCase().endsWith('_MM');

                    const containers = vridData.containers || [];
                    for (const container of containers) {
                        const counts = getCounts(container);
                        if (counts.C > 0 || counts.P === 0) continue;

                        if (isMMRoute) {
                            const curP = Math.round(counts.P * currentRatio);
                            const nextP = counts.P - curP;

                            if (matrix['AIR']) {
                                matrix['AIR'][hour] += curP;
                                let nextIndex = hour + 1;
                                if (nextIndex >= 24) nextIndex = 24;
                                matrix['AIR'][nextIndex] += nextP;
                            }
                            continue;
                        }

                        const originalLane = container.lane || '';
                        const segments = splitLaneSegments(originalLane);
                        const nSeg = segments.length;
                        if (nSeg === 0) continue;

                        const baseP = Math.floor(counts.P / nSeg);
                        const remP = counts.P % nSeg;

                        for (let i = 0; i < nSeg; i++) {
                            const seg = segments[i];
                            const addP = baseP + (i < remP ? 1 : 0);
                            if (addP === 0) continue;

                            const targetVsms = segmentToVSM(seg);
                            if (targetVsms && targetVsms.length > 0) {
                                const subBaseP = Math.floor(addP / targetVsms.length);
                                const subRemP = addP % targetVsms.length;

                                for (let j = 0; j < targetVsms.length; j++) {
                                    const vsm = targetVsms[j];
                                    if (ALL_VSMS.includes(vsm)) {
                                        const finalAddP = subBaseP + (j < subRemP ? 1 : 0);
                                        if (finalAddP === 0) continue;

                                        const curP = Math.round(finalAddP * currentRatio);
                                        const nextP = finalAddP - curP;

                                        matrix[vsm][hour] += curP;
                                        let nextIndex = hour + 1;
                                        if (nextIndex >= 24) nextIndex = 24;
                                        matrix[vsm][nextIndex] += nextP;
                                    }
                                }
                            }
                        }
                    }
                }
                return matrix;
            }

            function getVsmCellStyle(count) {
                if (count === 0) return { bg: '#141f2c', fg: '#2a3a4a' };
                if (count <= 50) return { bg: '#1a3a2a', fg: '#4dbb7a' };
                if (count <= 150) return { bg: '#1e5c32', fg: '#a8edbe' };
                if (count <= 350) return { bg: '#7a5c00', fg: '#ffd454' };
                if (count <= 600) return { bg: '#8a3d00', fg: '#ffaa55' };
                return { bg: '#6a1020', fg: '#ff7090' };
            }

            function renderVsmHourlyTable(matrix, container) {
                const hourTotals = new Array(25).fill(0);
                let grandTotal = 0;
                const activeVsms = [];

                for (const vsm of ALL_VSMS) {
                    const row = matrix[vsm];
                    const total = row.reduce((a, b) => a + b, 0);
                    if (total === 0) continue;
                    activeVsms.push(vsm);
                    for (let h = 0; h <= 24; h++) hourTotals[h] += row[h];
                    grandTotal += total;
                }

                const showExtraHour = hourTotals[24] > 0;

                let html = '<div class="vsm-tbl-wrap"><table class="vsm-hourly-table" id="vsm-ht">';
                html += '<thead>';
                html += '<th class="vsm-label-hdr">VSM</th>';
                for (let h = 0; h < 24; h++) {
                    const hdrStyle = getVsmCellStyle(hourTotals[h]);
                    html += `<th class="hour-col" data-col="${h}" style="background:${hdrStyle.bg};color:${hdrStyle.fg};">${h}:00</th>`;
                }
                if (showExtraHour) {
                    const hdrStyle = getVsmCellStyle(hourTotals[24]);
                    html += `<th class="hour-col" data-col="24" style="background:${hdrStyle.bg};color:${hdrStyle.fg};">00:00 (+1)</th>`;
                }

                const grandHdrStyle = getVsmCellStyle(grandTotal);
                html += `<th class="total-col" style="background:${grandHdrStyle.bg};color:${grandHdrStyle.fg};">Total</th>`;
                html += '</thead><tbody>';

                for (const vsm of activeVsms) {
                    const row = matrix[vsm];
                    const total = row.reduce((a, b) => a + b, 0);
                    html += `<tr data-row="${esc(vsm)}">`;
                    html += `<td class="vsm-label" data-row="${esc(vsm)}">${esc(vsm)}</td>`;
                    for (let h = 0; h < 24; h++) {
                        const val = row[h];
                        const style = getVsmCellStyle(val);
                        html += `<td class="hour-cell" data-row="${esc(vsm)}" data-col="${h}" style="background:${style.bg};color:${style.fg};">${val || 0}</td>`;
                    }
                    if (showExtraHour) {
                        const val = row[24];
                        const style = getVsmCellStyle(val);
                        html += `<td class="hour-cell" data-row="${esc(vsm)}" data-col="24" style="background:${style.bg};color:${style.fg};">${val || 0}</td>`;
                    }
                    const totalStyle = getVsmCellStyle(total);
                    html += `<td class="total-cell" data-row="${esc(vsm)}" style="background:${totalStyle.bg};color:${totalStyle.fg};font-weight:700;">${total}</td>`;
                    html += '</tr>';
                }

                html += '<tr class="hour-total-row">';
                html += '<td class="vsm-label"><strong>Total por hora</strong></td>';
                for (let h = 0; h < 24; h++) {
                    const val = hourTotals[h];
                    const style = getVsmCellStyle(val);
                    html += `<td class="hour-cell" data-col="${h}" style="background:${style.bg};color:${style.fg};font-weight:700;">${val || 0}</td>`;
                }
                if (showExtraHour) {
                    const val = hourTotals[24];
                    const style = getVsmCellStyle(val);
                    html += `<td class="hour-cell" data-col="24" style="background:${style.bg};color:${style.fg};font-weight:700;">${val || 0}</td>`;
                }
                const grandStyle = getVsmCellStyle(grandTotal);
                html += `<td class="total-cell" style="background:${grandStyle.bg};color:${grandStyle.fg};font-weight:700;">${grandTotal}</td>`;
                html += '</tr>';
                html += '</tbody></table></div>';

                container.innerHTML = html;

                const tbl = container.querySelector('#vsm-ht');
                if (tbl) {
                    let hoverCss = document.getElementById('vsm-ht-hovercss');
                    if (!hoverCss) {
                        hoverCss = document.createElement('style');
                        hoverCss.id = 'vsm-ht-hovercss';
                        document.head.appendChild(hoverCss);
                    }

                    let lastRow = null, lastCol = null, hraf = null;
                    tbl.addEventListener('mouseover', e => {
                        const td = e.target.closest('[data-row],[data-col]');
                        if (!td) return;
                        const row = td.dataset.row || null;
                        const col = td.dataset.col !== undefined ? td.dataset.col : null;
                        if (lastRow === row && lastCol === col) return;
                        lastRow = row; lastCol = col;

                        if (hraf) cancelAnimationFrame(hraf);
                        hraf = requestAnimationFrame(() => {
                            let css = '';
                            if (row) css += `#vsm-ht td[data-row="${row.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"] { filter: brightness(1.35) !important; outline: 1px solid rgba(255,153,0,.35); z-index: 10; position:relative; }\n`;
                            if (col !== null) css += `#vsm-ht td[data-col="${col}"] { filter: brightness(1.35) !important; outline: 1px solid rgba(255,153,0,.35); z-index: 10; position:relative; }\n`;
                            hoverCss.textContent = css;
                            hraf = null;
                        });
                    });
                    tbl.addEventListener('mouseleave', () => {
                        lastRow = null; lastCol = null;
                        if (hraf) cancelAnimationFrame(hraf);
                        hraf = requestAnimationFrame(() => { hoverCss.textContent = ''; hraf = null; });
                    });
                }
            }

            function computeAndRenderAll() {
                let filtered = getFilteredExportData();
                if (hideZeroPkgs) {
                    filtered = filtered.filter(v => {
                        const totalP = (v.containers || []).reduce((sum, c) => sum + getCounts(c).P, 0);
                        return totalP > 0;
                    });
                }
                const matrix = computeVsmHourlyMatrixFromExportData(filtered);
                currentVsmMatrix = matrix;
                const totals = {};
                let hasExtraSpillover = false;

                for (const vsm of ALL_VSMS) {
                    totals[vsm] = matrix[vsm].reduce((a, b) => a + b, 0);
                    if (matrix[vsm][24] > 0) hasExtraSpillover = true;
                }
                currentVsmTotals = totals;

                const mapContainer = document.getElementById('vsm-map-container');
                if (mapContainer) {
                    if (!filtered.length) {
                        mapContainer.innerHTML = '<div class="vsm-map-empty">Nenhum dado disponível para o mapa.</div>';
                    } else {
                        renderVsmHourlyTable(matrix, mapContainer);
                    }
                }

                const pillNextDay = document.getElementById('pill-next-day');
                if (pillNextDay) {
                    pillNextDay.style.display = hasExtraSpillover ? 'inline-block' : 'none';
                    if (!hasExtraSpillover && staticSelectedHour === 24) {
                        staticSelectedHour = -1;
                        document.querySelectorAll('.hour-pill').forEach(b => b.classList.remove('active'));
                        document.querySelector('.hour-pill[data-hour="-1"]').classList.add('active');
                    }
                }

                renderStaticVsmMap();
            }

            function isMeaningful(value) {
                if (!value || value === "") return false;
                const upper = String(value).toUpperCase();
                if (upper === "0") return true;
                if (/^\[.*\]$/.test(upper)) return true;
                if (/^[HX][-]/.test(upper)) return true;
                if (/^CC/.test(upper)) return true;
                if (/^AA/.test(upper)) return true;
                if (/^AB/.test(upper)) return true;
                if (/^CD/.test(upper)) return true;
                if (upper === "AIR") return true;
                return false;
            }

            function getBoundingBox(matrix) {
                let minRow = Infinity, maxRow = -Infinity, minCol = Infinity, maxCol = -Infinity;
                for (let r = 0; r < matrix.length; r++) {
                    for (let c = 0; c < matrix[r].length; c++) {
                        if (isMeaningful(matrix[r][c])) {
                            if (r < minRow) minRow = r;
                            if (r > maxRow) maxRow = r;
                            if (c < minCol) minCol = c;
                            if (c > maxCol) maxCol = c;
                        }
                    }
                }
                if (minRow === Infinity) return null;
                return { minRow, maxRow, minCol, maxCol };
            }

            function cropWithMargin(matrix, margin = 1) {
                const bbox = getBoundingBox(matrix);
                if (!bbox) return [];
                let startRow = Math.max(0, bbox.minRow - margin);
                let endRow = Math.min(matrix.length - 1, bbox.maxRow + margin);
                let startCol = Math.max(0, bbox.minCol - margin);
                let endCol = Math.min(matrix[0].length - 1, bbox.maxCol + margin);
                const cropped = [];
                for (let r = startRow; r <= endRow; r++) {
                    const row = [];
                    for (let c = startCol; c <= endCol; c++) {
                        row.push(matrix[r][c]);
                    }
                    cropped.push(row);
                }
                return cropped;
            }

            function getCellCategory(value) {
                if (!value || value === "") return "default";
                if (value === "0") return "ZERO";
                if (value.startsWith("H-")) return "H";
                if (value.startsWith("CC")) return "CC";
                if (value.startsWith("X-")) return "X";
                if (value.startsWith("AA")) return "AA";
                if (value.startsWith("AB")) return "AB";
                if (value.startsWith("CD")) return "CD";
                if (value === "AIR") return "AIR";
                return "default";
            }

            function findVsmForZero(croppedMatrix, row, col, allVsmsSet) {
                if (row > 0) {
                    const above = croppedMatrix[row - 1][col];
                    if (above && above !== "0" && allVsmsSet.has(above)) return above;
                }
                if (row < croppedMatrix.length - 1) {
                    const below = croppedMatrix[row + 1][col];
                    if (below && below !== "0" && allVsmsSet.has(below)) return below;
                }
                return null;
            }

            function getStaticVsmTotals() {
                if (staticSelectedHour === -1) return currentVsmTotals;
                const result = {};
                for (const vsm of ALL_VSMS) {
                    result[vsm] = (currentVsmMatrix[vsm] && currentVsmMatrix[vsm][staticSelectedHour]) || 0;
                }
                return result;
            }

            function getFilteredExportData() {
                if (!lastExportData.length) return [];
                return lastExportData.filter(v => selectedVrids.has(v.vrid));
            }

            function updateLayoutFromSelection() {
                computeAndRenderAll();
            }

            function renderStaticVsmMap(vsmTotals) {
                const container = document.getElementById('vsm-layout-container');
                if (!container) return;

                const vsmTotalsLocal = vsmTotals || getStaticVsmTotals();
                const croppedMatrix = cropWithMargin(activeMapMatrix, 1);
                if (!croppedMatrix.length) {
                    container.innerHTML = '<div class="vsm-map-empty">Nenhum dado disponível para o layout físico.</div>';
                    return;
                }

                const allVsmsSet = new Set(ALL_VSMS);
                const beltSums = {};

                for (const group of BELT_GROUPS) {
                    const sum = group.vsms.reduce((acc, vsm) => acc + (vsmTotalsLocal[vsm] || 0), 0);
                    if (sum > 0) {
                        const cbNeed = Math.max(1, Math.ceil(sum / cbRate));
                        let poNeed = Math.max(1, Math.ceil(sum / poRate));
                        const poExceeded = poNeed > 2;
                        if (poExceeded) poNeed = 2;
                        beltSums[group.id] = { sum, cbNeed, poNeed, poExceeded };
                    }
                }

                const fingerSums = {};
                let totalSortation = 0;

                for (const f of activeFingers) {
                    let sum = 0;
                    for (const bId of f.belts) {
                        if (beltSums[bId]) sum += beltSums[bId].sum;
                    }
                    fingerSums[f.id] = { sum, name: f.name };
                    totalSortation += sum;
                }

                let html = '<div class="vsm-static-wrap"><table class="vsm-static-table">';

                for (let r = 0; r < croppedMatrix.length; r++) {
                    html += '<tr>';
                    for (let c = 0; c < croppedMatrix[r].length; c++) {
                        let cellValue = String(croppedMatrix[r][c]).trim();

                        if (cellValue === '[SKIP]') {
                            continue;
                        }
                        if (cellValue === '[L_TS]') {
                            html += `<td colspan="2" class="total-finger-label" style="text-align:center;">Total Sortation</td>`;
                            continue;
                        }
                        if (cellValue === '[TS_V]') {
                            const blinkClass = totalSortation > staticFingerRate * 2 ? 'blink-red-finger' : '';
                            html += `<td colspan="2" class="belt-sum-cell ${blinkClass}" style="text-align:center;">
                                <span class="belt-sum-total">${totalSortation.toLocaleString('pt-BR')}</span>
                                <span class="belt-sum-label">pkgs/h</span>
                             </td>`;
                            continue;
                        }

                        const lfMatch = cellValue.match(/^\[L_F(\d+)\]$/);
                        if (lfMatch) {
                            const fId = parseInt(lfMatch[1], 10);
                            const fName = fingerSums[fId] ? fingerSums[fId].name : `Finger ${fId}`;
                            html += `<td class="total-finger-label">${esc(fName)}</td>`;
                            continue;
                        }

                        const fMatch = cellValue.match(/^\[F(\d+)\]$/);
                        if (fMatch) {
                            const fId = parseInt(fMatch[1], 10);
                            const fData = fingerSums[fId] || { sum: 0 };
                            const blinkClass = (fData.sum > staticFingerRate) ? 'blink-red-finger' : '';
                            html += `<td class="belt-sum-cell ${blinkClass}">
                                <span class="belt-sum-total">${fData.sum.toLocaleString('pt-BR')}</span>
                                <span class="belt-sum-label">pkgs/h</span>
                             </td>`;
                            continue;
                        }

                        const beltMatch = cellValue.match(/^\[B(\d+)\]$/);
                        if (beltMatch) {
                            const beltId = parseInt(beltMatch[1], 10);
                            const beltSumData = beltSums[beltId];
                            if (beltSumData && beltSumData.sum > 0) {
                                const poClass = beltSumData.poExceeded ? 'belt-po-need belt-po-warning' : 'belt-po-need';
                                html += `<td class="belt-sum-cell">
                                    <span class="belt-sum-total">${beltSumData.sum.toLocaleString('pt-BR')}</span>
                                    <span class="belt-sum-label">pkgs/h</span>
                                    <span class="belt-cb-need"><span class="belt-need-val">${beltSumData.cbNeed}</span><span class="belt-need-lbl">CB</span></span>
                                    <span class="${poClass}"><span class="belt-need-val">${beltSumData.poNeed}</span><span class="belt-need-lbl">PO</span></span>
                                 </td>`;
                            } else {
                                html += `<td class="belt-sum-cell" style="opacity: 0.3;">
                                    <span class="belt-sum-total">0</span>
                                    <span class="belt-sum-label">pkgs/h</span>
                                 </td>`;
                            }
                            continue;
                        }

                        let content = cellValue;
                        let cellClass = '';
                        let dataCat = '';

                        if (cellValue === '') {
                            cellClass = 'empty-cell';
                        } else if (cellValue === '0' || cellValue === 0) {
                            const associatedVsm = findVsmForZero(croppedMatrix, r, c, allVsmsSet);
                            if (associatedVsm && vsmTotalsLocal && vsmTotalsLocal[associatedVsm] !== undefined) {
                                content = vsmTotalsLocal[associatedVsm].toLocaleString('pt-BR');
                                cellClass = 'value-cell';
                                if (staticMaxPkgsPerHour > 0) {
                                    const ratio = vsmTotalsLocal[associatedVsm] / staticMaxPkgsPerHour;
                                    if (ratio >= 1) dataCat = 'ZERO_RED';
                                    else if (ratio >= 0.8) dataCat = 'ZERO_YELLOW';
                                    else if (ratio > 0) dataCat = 'VALUE_LOW';
                                    else dataCat = 'ZERO';
                                } else {
                                    if (vsmTotalsLocal[associatedVsm] > 0) dataCat = 'VALUE_LOW';
                                    else dataCat = 'ZERO';
                                }
                            } else {
                                content = '0';
                                cellClass = 'value-cell';
                                dataCat = 'ZERO';
                            }
                        } else {
                            const cat = getCellCategory(cellValue);
                            if (cat !== 'default') {
                                dataCat = cat;
                                cellClass = 'vsm-code';
                            }
                        }

                        content = String(content).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

                        if (dataCat) {
                            html += `<td class="${cellClass}" data-cat="${dataCat}">${content}</td>`;
                        } else if (cellClass) {
                            html += `<td class="${cellClass}">${content}</td>`;
                        } else {
                            html += `<td class="empty-cell">${content}</td>`;
                        }
                    }
                    html += '</tr>';
                }
                html += '</table></div>';

                container.innerHTML = html;
                updateNeedSummary();
            }

            function updateStaticMapWithTotals() {
                const staticContainer = document.getElementById('vsm-layout-container');
                if (staticContainer && staticContainer.innerHTML !== '') {
                    renderStaticVsmMap(getStaticVsmTotals());
                }
            }

            function updateNeedSummary() {
                const summaryEl = document.getElementById('static-need-summary');
                if (!summaryEl) return;
                const totals = getStaticVsmTotals();
                const totalPkgs = Object.values(totals).reduce((a, b) => a + b, 0);
                if (totalPkgs === 0) {
                    summaryEl.style.display = 'none';
                    return;
                }
                summaryEl.style.display = 'flex';

                let cbTotal = 0;
                let poTotal = 0;
                for (const group of BELT_GROUPS) {
                    const sum = group.vsms.reduce((acc, vsm) => acc + (totals[vsm] || 0), 0);
                    if (sum > 0) {
                        cbTotal += Math.max(1, Math.ceil(sum / cbRate));
                        poTotal += Math.max(1, Math.ceil(sum / poRate));
                    }
                }
                cbTotal = Math.max(17, cbTotal);
                poTotal = Math.max(17, poTotal);

                const cbEl = document.getElementById('need-cb-total');
                const poEl = document.getElementById('need-po-total');
                if (cbEl) cbEl.textContent = cbTotal;
                if (poEl) poEl.textContent = poTotal;
            }

            function getStatusInfo(percent) {
                if (percent === undefined || percent === null) return { text: 'N/A', color: '#aaa', order: 4 };
                if (percent <= 2) return { text: 'Não processado', color: '#ff6b6b', order: 2 };
                if (percent < 93) return { text: 'Em processamento', color: '#aad4ff', order: 1 };
                return { text: 'Concluído', color: '#88cc99', order: 3 };
            }

            function renderVridList() {
                const container = document.getElementById('vrid-list-container');
                if (!container) return;

                if (!lastExportData || lastExportData.length === 0) {
                    container.innerHTML = '<div class="vsm-map-empty">Nenhum VRID carregado.</div>';
                    return;
                }

                const enriched = lastExportData.map(v => {
                    const totalP = (v.containers || []).reduce((s, c) => s + getCounts(c).P, 0);
                    const percent = v.completePercent !== undefined ? v.completePercent : null;
                    const status = getStatusInfo(percent);
                    return { ...v, totalP, status };
                }).filter(v => !hideZeroPkgs || v.totalP > 0);

                enriched.sort((a, b) => {
                    if (a.status.order !== b.status.order) return a.status.order - b.status.order;
                    return b.totalP - a.totalP;
                });

                let html = `
            <div class="vrid-list-controls" style="flex-wrap: wrap;">
                <input type="text" id="vrid-search-input" placeholder="Filtrar por VRID, rota ou horário..." class="vrid-search" style="min-width: 150px;">
                <div style="display:flex; gap:6px; flex-wrap: wrap;">
                    <button id="btn-sel-all" class="vl-btn-small">Todos</button>
                    <button id="btn-sel-proc" class="vl-btn-small" style="background:#1a2a4a; color:#aad4ff; border: 1px solid #2a4a6a;">Processamento</button>
                    <button id="btn-sel-unproc" class="vl-btn-small" style="background:#4a0a14; color:#ff8888; border: 1px solid #8a1a2a;">Não proc.</button>
                    <button id="btn-sel-done" class="vl-btn-small" style="background:#1a3a2a; color:#88cc99; border: 1px solid #2a5a3a;">Concluídos</button>
                    <button id="toggle-zero-pkgs-btn" class="vl-btn-small" style="background: ${hideZeroPkgs ? '#ff9900' : '#2a3a4a'}; color: ${hideZeroPkgs ? '#0f1923' : '#99a'};">Ocultar zeros ${hideZeroPkgs ? '✔' : '✘'}</button>
                </div>
            </div>
            <div id="vrid-list-items" class="vrid-badge-grid">
        `;

                for (const v of enriched) {
                    const checked = selectedVrids.has(v.vrid);
                    const sat = v.scheduledArrivalTime || 'N/A';
                    const aat = v.actualArrivalTime && v.actualArrivalTime !== 'N/A' ? v.actualArrivalTime : '—';
                    const route = v.route || 'N/A';
                    const percent = v.completePercent !== undefined ? v.completePercent : null;
                    const status = v.status;

                    html += `
                <div class="vrid-badge ${checked ? 'selected' : ''}" data-vrid="${esc(v.vrid)}" data-status-order="${status.order}">
                    <div class="vrid-badge-content">
                        <div class="vrid-badge-header">
                            <span class="vrid-badge-vrid">🚛 ${esc(v.vrid)}</span>
                            <span class="vrid-badge-pkgs">📦 ${v.totalP} / ${(v.containers || []).reduce((s, c) => s + getCounts(c).C, 0)}</span>
                        </div>
                        <div class="vrid-badge-times">
                            <span>⏰ SAT: ${esc(sat)}</span>
                            <span>🛬 AAT: ${esc(aat)}</span>
                        </div>
                        <div class="vrid-badge-route">🛣 ${esc(route)}</div>
                        <div class="vrid-badge-status" style="color: ${status.color}; font-weight: bold;">
                            ${percent !== null ? `📊 ${percent}% ` : ''}${status.text}
                        </div>
                    </div>
                </div>
            `;
                }
                html += `</div>`;
                container.innerHTML = html;

                const searchInput = document.getElementById('vrid-search-input');
                const itemsContainer = document.getElementById('vrid-list-items');

                let filterraf = null;
                function filterList() {
                    if (filterraf) cancelAnimationFrame(filterraf);
                    filterraf = requestAnimationFrame(() => {
                        const searchTerm = searchInput.value.trim().toLowerCase();
                        itemsContainer.querySelectorAll('.vrid-badge').forEach(badge => {
                            const text = badge.textContent.toLowerCase();
                            badge.style.display = (searchTerm === '' || text.includes(searchTerm)) ? '' : 'none';
                        });
                        filterraf = null;
                    });
                }
                searchInput.addEventListener('input', filterList);

                itemsContainer.querySelectorAll('.vrid-badge').forEach(badge => {
                    badge.addEventListener('click', () => {
                        const vrid = badge.dataset.vrid;
                        if (selectedVrids.has(vrid)) {
                            selectedVrids.delete(vrid);
                            badge.classList.remove('selected');
                        } else {
                            selectedVrids.add(vrid);
                            badge.classList.add('selected');
                        }
                        computeAndRenderAll();
                    });
                });

                function filterSelectionByStatus(targetOrder) {
                    itemsContainer.querySelectorAll('.vrid-badge:not([style*="display: none"])').forEach(b => {
                        const vrid = b.dataset.vrid;
                        const statusOrder = parseInt(b.dataset.statusOrder, 10);
                        if (statusOrder === targetOrder) {
                            selectedVrids.add(vrid);
                            b.classList.add('selected');
                        } else {
                            selectedVrids.delete(vrid);
                            b.classList.remove('selected');
                        }
                    });
                    computeAndRenderAll();
                }

                document.getElementById('btn-sel-all').addEventListener('click', () => {
                    const visibleBadges = Array.from(itemsContainer.querySelectorAll('.vrid-badge:not([style*="display: none"])'));

                    const allSelected = visibleBadges.length > 0 && visibleBadges.every(b => b.classList.contains('selected'));

                    visibleBadges.forEach(b => {
                        const vrid = b.dataset.vrid;
                        if (allSelected) {

                            selectedVrids.delete(vrid);
                            b.classList.remove('selected');
                        } else {

                            selectedVrids.add(vrid);
                            b.classList.add('selected');
                        }
                    });
                    computeAndRenderAll();
                });

                document.getElementById('btn-sel-proc').addEventListener('click', () => filterSelectionByStatus(1));
                document.getElementById('btn-sel-unproc').addEventListener('click', () => filterSelectionByStatus(2));
                document.getElementById('btn-sel-done').addEventListener('click', () => filterSelectionByStatus(3));

                document.getElementById('toggle-zero-pkgs-btn').addEventListener('click', () => {
                    hideZeroPkgs = !hideZeroPkgs;
                    renderVridList();
                    computeAndRenderAll();
                });

                filterList();
            }

            function renderContainersWithControls(containerData, containerDiv, totalsSpan) {
                const containers = containerData.ret && containerData.ret.inboundCDTContainerCount ? Object.values(containerData.ret.inboundCDTContainerCount)[0] : null;
                if (!containers || containers.length === 0) {
                    containerDiv.innerHTML = '<small>Nenhum container encontrado.</small>';
                    if (totalsSpan) totalsSpan.innerText = ' (P:0, C:0)';
                    return;
                }
                let totals = { totalP: 0, totalC: 0 };
                for (const c of containers) {
                    const counts = getCounts(c);
                    totals.totalP += counts.P;
                    totals.totalC += counts.C;
                }
                if (totalsSpan) totalsSpan.innerText = ` (P:${totals.totalP}, C:${totals.totalC})`;

                let mode = 'detailed';
                function refreshDisplay() {
                    let html = '';
                    if (mode === 'detailed') {
                        html += '<div><strong>📦 Detalhado:</strong></div>';
                        for (const c of containers) {
                            const lane = simplifyLane(c.lane || 'N/A');
                            const counts = getCounts(c);
                            if (counts.P === 0) continue;
                            const cpt = c.criticalPullTime || 'N/A';
                            const suffix = counts.C > 0 ? ' - Xdock' : '';
                            html += `<div style="margin-left:12px; font-size:11px;">⏱️ ${cpt} | 🚚 ${lane} | 📦 ${counts.P} P / ${counts.C} C${suffix}</div>`;
                        }
                    } else {
                        const consolidated = consolidateContainers(containers);
                        html += '<div><strong>📦 Consolidado por rota:</strong></div>';
                        for (const entry of consolidated) {
                            const suffix = entry.hasXdock ? ' - Xdock' : '';
                            html += `<div style="margin-left:12px; font-size:11px;">🚚 ${entry.lane} | 📦 ${entry.P} P / ${entry.C} C${suffix}</div>`;
                        }
                    }
                    html += `<div class="container-control"><button class="toggle-mode-btn">${mode === 'detailed' ? 'Consolidar' : 'Detalhado'}</button></div>`;
                    containerDiv.innerHTML = html;
                    const btn = containerDiv.querySelector('.toggle-mode-btn');
                    if (btn) {
                        btn.addEventListener('click', e => {
                            e.stopPropagation();
                            mode = (mode === 'detailed' ? 'consolidated' : 'detailed');
                            refreshDisplay();
                        });
                    }
                }
                refreshDisplay();
            }

            function consolidateContainers(containers) {
                const nonXdock = new Map();
                const xdock = new Map();
                for (const c of containers) {
                    const lane = simplifyLane(c.lane || 'N/A');
                    const counts = getCounts(c);
                    if (counts.C === 0) {
                        if (!nonXdock.has(lane)) nonXdock.set(lane, { P: 0, C: 0 });
                        const entry = nonXdock.get(lane);
                        entry.P += counts.P;
                        entry.C += counts.C;
                    } else {
                        if (!xdock.has(lane)) xdock.set(lane, { P: 0, C: 0 });
                        const entry = xdock.get(lane);
                        entry.P += counts.P;
                        entry.C += counts.C;
                    }
                }
                const result = [];
                nonXdock.forEach((value, lane) => {
                    if (value.P > 0) result.push({ lane, P: value.P, C: value.C, hasXdock: false });
                });
                xdock.forEach((value, lane) => {
                    if (value.P > 0) result.push({ lane, P: value.P, C: value.C, hasXdock: true });
                });
                result.sort((a, b) => a.lane.localeCompare(b.lane));
                return result;
            }

            function renderCardsFromCache() {
                if (!lastExportData || lastExportData.length === 0) return;
                const resultDiv = document.getElementById('vl-result');
                if (!resultDiv) return;
                resultDiv.innerHTML = '';

                const sorted = [...lastExportData].sort((a, b) => {
                    const sumP = v => (v.containers || []).reduce((s, c) => s + getCounts(c).P, 0);
                    return sumP(b) - sumP(a);
                });

                for (let i = 0; i < sorted.length; i++) {
                    const v = sorted[i];
                    const cardId = `vl-card-${i}`;
                    resultDiv.insertAdjacentHTML('beforeend', `
                <div class="vl-card" id="${cardId}">
                    <div class="vl-card-head" data-idx="${i}">
                        <span class="vl-card-vrid">🚛 ${esc(v.vrid)}</span>
                        <span class="vl-card-meta">
                            ${v.scheduledArrivalTime ? `⏰ ${esc(v.scheduledArrivalTime)}` : ''}
                            ${v.route ? ` &nbsp;·&nbsp; 🛣 ${esc(v.route)}` : ''}
                        </span>
                        <span class="vl-card-count" id="vl-count-${i}"></span>
                        <span class="vl-chevron" id="vl-chev-${i}">▸</span>
                    </div>
                    <div class="vl-card-body" id="vl-body-${i}">
                    </div>
                </div>`);

                    const bodyEl = document.getElementById(`vl-body-${i}`);
                    const countEl = document.getElementById(`vl-count-${i}`);

                    const tempContainer = document.createElement('div');
                    renderContainersWithControls(
                        { ret: { inboundCDTContainerCount: { [v.planId]: v.containers } } },
                        tempContainer, countEl
                    );
                    bodyEl.innerHTML = '';
                    bodyEl.appendChild(tempContainer);

                    document.getElementById(cardId)?.querySelector('.vl-card-head')
                        ?.addEventListener('click', () => {
                            bodyEl.classList.toggle('show');
                            const chev = document.getElementById(`vl-chev-${i}`);
                            chev.textContent = bodyEl.classList.contains('show') ? '▾' : '▸';
                        });
                }
            }

            function promiseFetchContainers(planIds) {
                return new Promise((resolve, reject) => {
                    fetchContainers(planIds, (err, data) => {
                        if (err) reject(err); else resolve(data);
                    });
                });
            }

            function promiseFetchCompletePercent(planIds) {
                return new Promise((resolve, reject) => {
                    fetchCompletePercent(planIds, (err, data) => {
                        if (err) reject(err); else resolve(data);
                    });
                });
            }

            async function processVRIDs(vridList, label) {
                const resultDiv = document.getElementById('vl-result');
                const progressDiv = document.getElementById('vl-progress');
                resultDiv.innerHTML = '';

                const allExportData = [];
                const total = vridList.length;

                function setProgress(n, text) {
                    progressDiv.style.display = 'block';
                    progressDiv.querySelector('.vl-prog-text').textContent = text;
                    progressDiv.querySelector('.vl-prog-fill').style.width = `${Math.round((n / total) * 100)}%`;
                }

                setProgress(0, `Processando VRIDs… 0 / ${total}`);

                for (let i = 0; i < total; i++) {
                    const v = vridList[i];
                    resultDiv.insertAdjacentHTML('beforeend', `
                <div class="vl-card" id="vl-card-${i}">
                    <div class="vl-card-head" data-idx="${i}">
                        <span class="vl-card-vrid">🚛 ${esc(v.vrid)}</span>
                        <span class="vl-card-meta">
                            ${v.scheduledArrivalTime ? `⏰ ${esc(v.scheduledArrivalTime)}` : ''}
                            ${v.route ? ` &nbsp;·&nbsp; 🛣 ${esc(v.route)}` : ''}
                        </span>
                        <span class="vl-card-count" id="vl-count-${i}"></span>
                        <span class="vl-chevron" id="vl-chev-${i}">▸</span>
                    </div>
                    <div class="vl-card-body" id="vl-body-${i}">
                        <div class="skel-block">
                            <div class="skel-row-flex">
                                <div class="skeleton skel-circle"></div>
                                <div style="flex:1">
                                    <div class="skeleton skel-bar" style="width: 70%; margin-bottom: 6px;"></div>
                                    <div class="skeleton skel-bar" style="width: 40%;"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>`);

                    const bodyEl = document.getElementById(`vl-body-${i}`);
                    document.getElementById(`vl-card-${i}`)?.querySelector('.vl-card-head')
                        ?.addEventListener('click', () => {
                            bodyEl.classList.toggle('show');
                            const chev = document.getElementById(`vl-chev-${i}`);
                            if (chev) chev.textContent = bodyEl.classList.contains('show') ? '▾' : '▸';
                        });
                }

                let done = 0;
                for (let start = 0; start < total; start += FETCH_CONCURRENCY) {
                    const batch = vridList.slice(start, start + FETCH_CONCURRENCY);
                    const planIds = batch.map(v => v.planId).filter(id => id);

                    let containersMap = {};
                    let percentMap = {};
                    try {
                        const [containersData, percentData] = await Promise.all([
                            promiseFetchContainers(planIds),
                            promiseFetchCompletePercent(planIds)
                        ]);
                        containersMap = containersData.ret?.inboundCDTContainerCount || {};
                        percentMap = percentData.ret?.inboundContainerCount || {};
                    } catch (err) {
                        console.error('Error fetching data:', err);
                    }

                    for (let bi = 0; bi < batch.length; bi++) {
                        const v = batch[bi];
                        const i = start + bi;
                        const bodyEl = document.getElementById(`vl-body-${i}`);
                        const countEl = document.getElementById(`vl-count-${i}`);

                        const planId = v.planId;
                        if (!planId) {
                            countEl.innerHTML = `<span class="badge-err">sem Plan ID</span>`;
                            bodyEl.innerHTML = `<div class="vl-err">Plan ID não disponível.</div>`;
                            done++;
                            setProgress(done, `Processando VRIDs… ${done} / ${total}`);
                            continue;
                        }

                        const containers = containersMap[planId] || [];
                        const percentInfo = percentMap[planId] || {};
                        const completePercent = percentInfo.completePercent !== undefined ? percentInfo.completePercent : null;

                        const tempContainer = document.createElement('div');
                        renderContainersWithControls({ ret: { inboundCDTContainerCount: { [planId]: containers } } }, tempContainer, countEl);
                        bodyEl.innerHTML = '';
                        bodyEl.appendChild(tempContainer);

                        allExportData.push({
                            vrid: v.vrid,
                            planId: v.planId,
                            scheduledArrivalTime: v.scheduledArrivalTime,
                            route: v.route,
                            actualArrivalTime: v.actualArrivalTime,
                            containers: containers,
                            completePercent: completePercent
                        });

                        done++;
                        setProgress(done, `Processando VRIDs… ${done} / ${total}`);
                    }
                }

                setProgress(total, `Concluído: ${allExportData.length} VRIDs`);
                progressDiv.querySelector('.vl-prog-fill').style.background = '#2d8a4e';
                setTimeout(() => { progressDiv.style.display = 'none'; }, 2000);

                if (!resultDiv.children.length) {
                    resultDiv.innerHTML = '<div class="vl-err">Nenhum VRID encontrado.</div>';
                }

                const isRefresh = lastExportData.length > 0;
                const oldKnownVrids = new Set(lastExportData.map(v => v.vrid));
                const newSelectedVrids = new Set();

                allExportData.forEach(v => {
                    if (isRefresh && oldKnownVrids.has(v.vrid)) {
                        if (selectedVrids.has(v.vrid)) newSelectedVrids.add(v.vrid);
                    } else {
                        newSelectedVrids.add(v.vrid);
                    }
                });

                selectedVrids = newSelectedVrids;
                lastExportData = allExportData;
                if (_SUITE.vsm) _SUITE.vsm.lastUpdate = Date.now();

                computeAndRenderAll();
                renderVridList();
                renderCardsFromCache();

                const csvBtn = document.getElementById('vl-vsm-export-csv-btn');
                if (csvBtn) {
                    csvBtn.onclick = function () { vsmDownloadExportDataCSV(); };
                    csvBtn.style.display = lastExportData.length > 0 ? 'block' : 'none';
                }
            }

            function vsmDownloadExportDataCSV() {
                const data = getFilteredExportData();
                if (!data.length) return;

                const csv = ['VRID,Plan ID,Scheduled Arrival,Route,Actual Arrival,Total Pkgs,Total Containers,Percent Complete'];
                data.forEach(v => {
                    const totalP = (v.containers || []).reduce((s, c) => s + getCounts(c).P, 0);
                    const totalC = (v.containers || []).reduce((s, c) => s + getCounts(c).C, 0);
                    const row = [
                        '"' + (v.vrid || '') + '"',
                        '"' + (v.planId || '') + '"',
                        '"' + (v.scheduledArrivalTime || '') + '"',
                        '"' + (v.route || '') + '"',
                        '"' + (v.actualArrivalTime || '') + '"',
                        totalP,
                        totalC,
                        (v.completePercent !== null ? v.completePercent + '%' : '—')
                    ];
                    csv.push(row.join(','));
                });

                const blob = new Blob(['\ufeff' + csv.join('\n')], { type: 'text/csv;charset=utf-8;' });
                const link = document.createElement('a');
                const url = URL.createObjectURL(blob);
                link.setAttribute('href', url);
                const ts = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '_');
                link.setAttribute('download', `vrid_vsm_export_${ts}.csv`);
                link.click();
            }

            async function doSingleSearch(vrid) {
                const resultDiv = document.getElementById('vl-result');
                const progDiv = document.getElementById('vl-progress');
                resultDiv.innerHTML = '';
                progDiv.querySelector('.vl-prog-text').textContent = 'Buscando VRIDs…';
                progDiv.querySelector('.vl-prog-fill').style.width = '0';
                progDiv.style.display = 'block';

                let data;
                try {
                    const ts = getLocalDayTs(new Date());
                    data = await new Promise((resolve, reject) => {
                        fetchVRIData(ts.start, ts.end, (err, res) => {
                            if (err) reject(err); else resolve(res);
                        });
                    });
                } catch (e) {
                    let msg = esc(String(e));
                    if (e === 'SESSAO_EXPIRADA') msg = '🔐 Sessão expirada. <a href="' + location.href + '" style="color:#388bfd">Recarregue a página</a>.';
                    resultDiv.innerHTML = `<div class="vl-err">Erro ao buscar VRIDs: ${msg}</div>`;
                    progDiv.style.display = 'none';
                    return;
                }

                const all = (function () {
                    const src = data?.ret?.aaData ?? {};
                    const arr = Array.isArray(src) ? src : Object.values(src);
                    return arr.map(item => {
                        const l = getLoadObject(item);
                        return {
                            vrid: l.vrid || l.vrId || l.vId || '',
                            planId: l.planId || l.planForOrderId || '',
                            scheduledArrivalTime: l.scheduledArrivalTime || '',
                            route: l.route || '',
                            actualArrivalTime: l.actualArrivalTime || l.actualDepartureTime || ''
                        };
                    }).filter(v => v.vrid);
                })();

                const found = all.find(v => v.vrid.toUpperCase() === vrid);
                if (!found) {
                    resultDiv.innerHTML = '<div class="vl-err">VRID não encontrado no período de hoje.</div>';
                    progDiv.style.display = 'none';
                    return;
                }

                lastSearch = { mode: 'single', vrid: found.vrid };
                await processVRIDs([found], `VRID_${found.vrid}`);
            }

            async function doRangeSearch(startDate, endDate, startHour, endHour) {
                const resultDiv = document.getElementById('vl-result');
                const progDiv = document.getElementById('vl-progress');
                resultDiv.innerHTML = '';
                progDiv.querySelector('.vl-prog-text').textContent = 'Buscando VRIDs…';
                progDiv.querySelector('.vl-prog-fill').style.width = '0';
                progDiv.style.display = 'block';

                let data;
                try {
                    const queryStart = new Date(startDate);
                    if (startHour === 0) {
                        queryStart.setDate(queryStart.getDate() - 1);
                    }

                    const tsStart = getLocalDayTs(queryStart);
                    const tsEnd = getLocalDayTs(endDate);

                    data = await new Promise((resolve, reject) => {
                        fetchVRIData(tsStart.start, tsEnd.end, (err, res) => {
                            if (err) reject(err); else resolve(res);
                        });
                    });
                } catch (e) {
                    let msg = esc(String(e));
                    if (e === 'SESSAO_EXPIRADA') msg = '🔐 Sessão expirada. <a href="' + location.href + '" style="color:#388bfd">Recarregue a página</a>.';
                    resultDiv.innerHTML = `<div class="vl-err">Erro ao buscar VRIDs: ${msg}</div>`;
                    progDiv.style.display = 'none';
                    return;
                }

                const filtered = getVRIDsFromData(data, startDate, startHour, endDate, endHour);
                if (!filtered.length) {
                    resultDiv.innerHTML = '<div class="vl-err">Nenhum VRID encontrado neste período.</div>';
                    progDiv.style.display = 'none';
                    return;
                }

                const lbl = `${startDate.toISOString().slice(0, 10)}_${endDate.toISOString().slice(0, 10)}_${startHour}-${endHour}h`;

                lastSearch = { mode: 'range', startDate, endDate, startHour, endHour };
                await processVRIDs(filtered, lbl);
            }

            function updateCountdownDisplay() {
                const statusSpan = document.getElementById('auto-refresh-status');
                const toggleEl = document.getElementById('auto-refresh-toggle');
                if (!statusSpan) return;

                if (autoRefreshNextTimestamp > 0) {
                    const remainingMs = Math.max(0, autoRefreshNextTimestamp - Date.now());
                    const remainingSec = Math.floor(remainingMs / 1000);
                    const minutes = Math.floor(remainingSec / 60);
                    const seconds = remainingSec % 60;
                    statusSpan.textContent = ` (próximo em ${minutes}:${seconds.toString().padStart(2, '0')})`;
                    statusSpan.style.color = '#4dbb7a';
                } else {
                    if (toggleEl && toggleEl.checked) {
                        statusSpan.textContent = ' (aguardando busca...)';
                        statusSpan.style.color = '#ffaa55';
                    } else {
                        statusSpan.textContent = ' (desligado)';
                        statusSpan.style.color = '#778';
                    }
                }
            }

            function stopAutoRefresh() {
                if (autoRefreshTimer) {
                    clearTimeout(autoRefreshTimer);
                    autoRefreshTimer = null;
                }
                if (autoRefreshCountdownInterval) {
                    clearInterval(autoRefreshCountdownInterval);
                    autoRefreshCountdownInterval = null;
                }
                autoRefreshNextTimestamp = 0;
                updateCountdownDisplay();
            }

            function startAutoRefresh(intervalMinutes) {
                stopAutoRefresh();

                if (!lastSearch) {
                    updateCountdownDisplay();
                    return;
                }

                const intervalMs = intervalMinutes * 60 * 1000;

                function scheduleNext() {
                    autoRefreshTimer = setTimeout(refreshNow, intervalMs);
                    autoRefreshNextTimestamp = Date.now() + intervalMs;
                    updateCountdownDisplay();
                }

                async function refreshNow() {
                    if (isRefreshing) return;
                    isRefreshing = true;
                    try {
                        if (lastSearch.mode === 'single') {
                            await doSingleSearch(lastSearch.vrid);
                        } else if (lastSearch.mode === 'range') {
                            await doRangeSearch(lastSearch.startDate, lastSearch.endDate, lastSearch.startHour, lastSearch.endHour);
                        }
                    } catch (e) {
                        console.error('Auto refresh error:', e);
                    } finally {
                        isRefreshing = false;
                        scheduleNext();
                    }
                }

                scheduleNext();

                if (!autoRefreshCountdownInterval) {
                    autoRefreshCountdownInterval = setInterval(() => {
                        updateCountdownDisplay();
                    }, 1000);
                }
            }

            GM_addStyle(`
        @keyframes shimmer {
            0% { background-position: -200px 0; }
            100% { background-position: calc(200px + 100%) 0; }
        }
        .skeleton {
            background: #1a2a3a;
            background-image: linear-gradient(90deg, #1a2a3a 0px, #2a3a4a 40px, #1a2a3a 80px);
            background-size: 200px 100%;
            animation: shimmer 1.5s infinite linear;
            border-radius: 4px;
        }
        .skel-block {
            padding: 4px 0;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .skel-row-flex { display: flex; gap: 10px; align-items: center; }
        .skel-circle { width: 24px; height: 24px; border-radius: 50%; flex-shrink: 0; }
        .skel-bar { height: 10px; border-radius: 4px; }

        #vl-panel {
            position: fixed !important;
            inset: 0 !important;
            top: 0 !important; left: 0 !important; right: 0 !important; bottom: 0 !important;
            width: 100vw !important; height: 100vh !important;
            max-width: 100vw !important; max-height: 100vh !important;
            background: rgba(10, 22, 40, 0.85);
            backdrop-filter: blur(14px);
            -webkit-backdrop-filter: blur(14px);
            border: none;
            overflow: hidden;
            box-shadow: 0 20px 60px rgba(0,0,0,.6);
            font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
            font-size: 13px;
            color: #e8eaed;
            z-index: 2147483647;
            display: none;
            transition: all .2s ease;
        }

        #vl-panel-head {
            background: rgba(255, 255, 255, 0.03);
            border-bottom: 1px solid rgba(255, 255, 255, 0.1); color: #e8eaed; padding: 0 16px;
            height: 52px; display: flex; align-items: center; gap: 12px; cursor: grab; user-select: none;
        }
        #vl-panel-head:active { cursor: grabbing; }
        #vl-panel-head h3 { margin: 0; font-size: 14px; font-weight: 700; flex: 1; letter-spacing: .5px; color: #fff; }
        #vl-panel-head h3 span { color: #ff9900; }
        #vl-head-actions { display: flex; gap: 6px; align-items: center; }
        .vl-head-btn {
            background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.1); color: #aab;
            font-size: 13px; width: 30px; height: 30px; border-radius: 6px; cursor: pointer;
            display: flex; align-items: center; justify-content: center; transition: all .15s; padding: 0; line-height: 1;
        }
        .vl-head-btn:hover { background: rgba(255,153,0,.2); color: #ff9900; border-color: rgba(255,153,0,.4); }
        #vl-close-btn { font-size: 18px; }
        #vl-panel-body {
            padding: 14px 16px; overflow-y: auto; height: calc(100% - 52px);
            background: transparent; scrollbar-width: thin; scrollbar-color: #2a3a4a rgba(0,0,0,0);
        }
        #vl-panel-body::-webkit-scrollbar { width: 6px; }
        #vl-panel-body::-webkit-scrollbar-track { background: #0f1923; }
        #vl-panel-body::-webkit-scrollbar-thumb { background: #2a3a4a; border-radius: 3px; }
        .vl-controls-bar { display: flex; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
        .vl-ctrl-chip {
            display: flex; align-items: center; gap: 8px; background: #1a2a3a;
            border: 1px solid #2a3a4a; border-radius: 8px; padding: 6px 12px; font-size: 12px; color: #aab;
        }
        .vl-ctrl-chip label { font-size: 12px; font-weight: 600; color: #ccd; white-space: nowrap; }
        .vl-ctrl-chip select, .vl-ctrl-chip input[type="checkbox"] {
            background: #0f1923; color: #e8eaed; border: 1px solid #3a4a5a;
            border-radius: 5px; padding: 3px 8px; font-size: 12px; cursor: pointer;
        }
        .vl-ctrl-chip input[type="checkbox"] { width: 15px; height: 15px; accent-color: #ff9900; padding: 0; }
        #auto-refresh-status { font-size: 11px; font-weight: 600; transition: color 0.2s; }
        .vl-tabs { display: flex; gap: 4px; margin-bottom: 16px; border-bottom: 1px solid #2a3a4a; }
        .vl-tab {
            background: none; border: none; padding: 8px 16px; font-size: 13px; font-weight: 600;
            color: #99a; cursor: pointer; border-radius: 8px 8px 0 0; transition: all .15s;
        }
        .vl-tab.active { color: #ff9900; background: #1a2a3a; border-bottom: 2px solid #ff9900; }
        .vl-tab:hover:not(.active) { color: #ccd; background: #1a2a3a; }
        .vl-tab-content { display: none; }
        .vl-tab-content.active { display: block; }
        .vl-section {
            margin-bottom: 16px; border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 10px;
            padding: 12px 14px; background: rgba(20, 31, 44, 0.4);
        }
        .vl-section-title { font-weight: 700; font-size: 12px; margin-bottom: 10px; color: #ff9900; letter-spacing: .8px; text-transform: uppercase; }
        .vl-row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
        .vl-row input[type="text"], .vl-row input[type="date"], .vl-row select {
            flex: 1; padding: 7px 10px; border: 1px solid #2a3a4a; border-radius: 6px;
            font-size: 12px; background: #0f1923; color: #e8eaed; outline: none; transition: border-color .15s; min-width: 80px;
        }
        .vl-row input:focus, .vl-row select:focus { border-color: #ff9900; }
        .vl-row span { color: #556; font-size: 12px; }
        .vl-hint { font-size: 10px; color: #445; margin-top: 2px; }
        .vl-btn {
            background: #ff9900; color: #0f1923; border: none; padding: 7px 16px;
            border-radius: 6px; font-weight: 700; font-size: 12px; cursor: pointer; white-space: nowrap;
            letter-spacing: .3px; transition: background .15s, transform .1s;
        }
        .vl-btn:hover { background: #ffb340; transform: translateY(-1px); }
        .vl-btn:active { transform: translateY(0); }
        .vl-btn-full { width: 100%; }
        .vl-btn-small { background: #ff9900; color: #0f1923; border: none; padding: 4px 12px; border-radius: 6px; font-weight: 600; font-size: 11px; cursor: pointer; transition: background .15s; }
        .vl-btn-small:hover { background: #ffb340; }
        #vl-progress { display: none; margin-bottom: 12px; }
        .vl-prog-text { font-size: 11px; color: #778; margin-bottom: 5px; }
        .vl-prog-track { height: 4px; background: #1a2a3a; border-radius: 2px; overflow: hidden; }
        .vl-prog-fill { height: 100%; width: 0; background: linear-gradient(90deg, #ff9900, #ffb340); border-radius: 2px; transition: width .25s, background .3s; }
        .vl-card {
            background: rgba(20, 31, 44, 0.4); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 8px;
            margin-bottom: 8px; overflow: hidden; transition: border-color .15s;
        }
        .vl-card:hover { border-color: #3a4a5a; }
        .vl-card-head {
            display: flex; align-items: center; gap: 8px; padding: 9px 12px;
            background: rgba(255, 255, 255, 0.03); cursor: pointer; border-bottom: 1px solid rgba(255, 255, 255, 0.05); transition: background .15s;
        }
        .vl-card-head:hover { background: #1e3040; }
        .vl-card-vrid { font-weight: 700; color: #ff9900; font-size: 13px; }
        .vl-card-meta { font-size: 11px; color: #667; flex: 1; }
        .vl-card-count { font-size: 11px; color: #99a; }
        .vl-chevron { color: #445; font-size: 12px; margin-left: 2px; transition: transform .15s; }
        .vl-card-body { display: none; padding: 10px 12px; font-size: 11px; color: #99a; }
        .vl-card-body.show { display: block; }
        .vl-loading { color: #445; font-size: 11px; font-style: italic; padding: 4px 0; }
        .vl-err { color: #e05; font-size: 12px; padding: 4px 0; }
        .container-control { text-align: right; margin-top: 8px; }
        .container-control button {
            background: #1a2a3a; border: 1px solid #2a3a4a; border-radius: 4px;
            color: #99a; font-size: 10px; padding: 3px 9px; cursor: pointer; transition: all .15s;
        }
        .container-control button:hover { background: #2a3a4a; color: #ccd; }
        .badge-err { background: rgba(220,53,69,.2); color: #f66; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; border: 1px solid rgba(220,53,69,.3); }
        .vsm-map-empty {
            padding: 32px 24px; text-align: center; color: #445; font-size: 12px;
            border: 2px dashed #2a3a4a; border-radius: 10px; margin-top: 8px;
        }
        .vsm-tbl-wrap {
            overflow-x: auto; margin-top: 10px; border-radius: 8px;
            border: 1px solid #2a3a4a; scrollbar-width: thin; scrollbar-color: #2a3a4a #0f1923;
        }
        .vsm-tbl-wrap::-webkit-scrollbar { height: 5px; }
        .vsm-tbl-wrap::-webkit-scrollbar-thumb { background: #2a3a4a; border-radius: 3px; }
        .vsm-hourly-table { border-collapse: collapse; font-size: 11px; width: 100%; white-space: nowrap; }
        .vsm-hourly-table thead tr { border-bottom: 2px solid #2a3a4a; }
        .vsm-hourly-table th, .vsm-hourly-table td { border: 1px solid rgba(42,58,74,.6); padding: 5px 7px; text-align: center; transition: filter .12s; }
        .vsm-hourly-table th { font-weight: 700; font-size: 10px; letter-spacing: .3px; }
        .vsm-label-hdr { background: #1a2a3a !important; color: #778 !important; font-size: 10px !important; text-align: left !important; position: sticky; left: 0; z-index: 2; min-width: 52px; }
        .vsm-hourly-table .vsm-label { font-weight: 700; text-align: left; position: sticky; left: 0; z-index: 1; background: #141f2c; color: #ccd; border-right: 2px solid #2a3a4a; min-width: 52px; }
        .hour-col { min-width: 46px; font-size: 10px; }
        .total-col { font-weight: 700; border-left: 2px solid #2a3a4a !important; min-width: 50px; }
        .hour-cell { font-size: 10px; font-weight: 600; }
        .total-cell { font-size: 11px; font-weight: 700; border-left: 2px solid #2a3a4a !important; }
        .hour-total-row td { border-top: 2px solid #2a3a4a !important; font-weight: 700; }
        .vsm-row-hl { filter: brightness(1.35) !important; outline: 1px solid rgba(255,153,0,.35); }
        .vsm-col-hl { filter: brightness(1.35) !important; outline: 1px solid rgba(255,153,0,.35); }
        .vsm-static-wrap { overflow-x: auto; border-radius: 12px; border: 1px solid #2a3a4a; background: #0f1923; margin-top: 12px; }
        .vsm-static-table { border-collapse: collapse; font-family: 'SF Mono', monospace; font-size: 0.7rem; width: 100%; background: #0f1923; }
        .vsm-static-table td { padding: 6px 5px; text-align: center; border: 1px solid #2a3a4a; min-width: 44px; background-color: #141f2c; }
        .vsm-static-table td.empty-cell { background-color: #0f1923; border-color: #0f1923; }
        .vsm-static-table td.vsm-code { font-weight: 700; }
        .vsm-static-table td.belt-sum-cell { background-color: #1a1040; border: 1px solid #6655cc; border-radius: 3px; padding: 4px 5px; cursor: default; }
        .belt-sum-total { display: block; font-size: 13px; font-weight: 800; color: #c8b8ff; line-height: 1.2; }
        .belt-sum-label { display: block; font-size: 10px; font-weight: 600; color: #7766aa; letter-spacing: 0.5px; text-transform: uppercase; line-height: 1.2; }
        .belt-cb-need, .belt-po-need { display: inline-flex; align-items: center; justify-content: center; gap: 3px; margin-top: 4px; margin-right: 4px; padding: 2px 5px; border-radius: 4px; font-size: 10px; font-weight: 700; line-height: 1.2; }
        .belt-cb-need { background: rgba(0, 180, 120, 0.18); border: 1px solid rgba(0, 180, 120, 0.35); color: #4dddaa; }
        .belt-po-need { background: rgba(255, 153, 0, 0.15); border: 1px solid rgba(255, 153, 0, 0.35); color: #ffbb44; }
        .belt-po-warning { background: rgba(255, 0, 0, 0.6) !important; border: 1px solid #ff0000 !important; animation: po-blink 0.8s step-start infinite; color: #fff !important; }
        @keyframes po-blink { 50% { opacity: 0.5; } }
        .blink-red-finger { animation: pulse-red-finger-anim 1.5s ease-in-out infinite !important; font-weight: bold !important; }
        @keyframes pulse-red-finger-anim { 0% { background-color: #1a1040; color: #c8b8ff; border-color: #6655cc; box-shadow: none; } 50% { background-color: #8a0b1c; color: #ffffff; border-color: #ff3333; box-shadow: inset 0 0 10px rgba(255,51,51,0.8); } 100% { background-color: #1a1040; color: #c8b8ff; border-color: #6655cc; box-shadow: none; } }
        .belt-need-val { font-size: 12px; font-weight: 800; }
        .belt-need-lbl { font-size: 8px; font-weight: 600; letter-spacing: 0.4px; opacity: 0.85; }

        .vsm-static-table td[data-cat="ZERO"] { background-color: #141f2c; color: #445566; font-weight: 600; }
        .vsm-static-table td[data-cat="VALUE_LOW"] { background-color: #1a3a2a; color: #88cc99; font-weight: 700; border: 1px solid #2a5a3a !important; }
        .vsm-static-table td.value-cell { font-weight: 600; }
        .vsm-static-table td[data-cat="H"] { background-color: #5a3a2a; color: #ffb085; }
        .vsm-static-table td[data-cat="CC"] { background-color: #2a4a6a; color: #aad4ff; }
        .vsm-static-table td[data-cat="X"] { background-color: #2a5a3a; color: #aaffaa; }
        .vsm-static-table td[data-cat="AA"] { background-color: #6a5a2a; color: #ffe5aa; }
        .vsm-static-table td[data-cat="AB"] { background-color: #6a4a6a; color: #ffc0ff; }
        .vsm-static-table td[data-cat="CD"] { background-color: #4a5a6a; color: #ccddff; }
        .vsm-static-table td[data-cat="AIR"] { background-color: #3a4a5a; color: #e8eaed; }
        .vsm-static-table td[data-cat="ZERO_YELLOW"] { background-color: #4a3d00; color: #ffe066; font-weight: 700; border: 1px solid #cc9900 !important; }
        .vsm-static-table td[data-cat="ZERO_RED"] { background-color: #4a0a14; color: #ff6b6b; font-weight: 700; border: 1px solid #cc2233 !important; animation: vsm-pulse 1.4s ease-in-out infinite; }
        @keyframes vsm-pulse { 0%,100%{opacity:1} 50%{opacity:.7} }
        .vsm-legend { display: flex; flex-wrap: wrap; gap: 12px; padding: 0.6rem 0; margin-top: 10px; border-top: 1px solid #2a3a4a; font-size: 0.65rem; color: #b0c4de; }
        .legend-item { display: flex; align-items: center; gap: 6px; }
        .legend-color { width: 14px; height: 14px; border-radius: 3px; }
        .total-finger-label { background-color: #2a3a4a; color: #ffd966; font-weight: bold; text-align: center; font-size: 0.8rem; }
        .vsm-need-summary { display: flex; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
        .need-card { display: flex; flex-direction: column; align-items: center; padding: 8px 18px; border-radius: 8px; min-width: 110px; }
        .need-card.need-cb { background: rgba(0, 180, 120, 0.12); border: 1px solid rgba(0, 180, 120, 0.35); }
        .need-card.need-po { background: rgba(255, 153, 0, 0.10); border: 1px solid rgba(255, 153, 0, 0.35); }
        .need-val { font-size: 24px; font-weight: 800; line-height: 1.1; }
        .need-card.need-cb .need-val { color: #4dddaa; }
        .need-card.need-po .need-val { color: #ffbb44; }
        .need-label { font-size: 10px; font-weight: 700; letter-spacing: 0.4px; color: #99a; margin-top: 2px; }
        .need-sub { font-size: 9px; color: #556; margin-top: 1px; }
        .vsm-static-controls { display: flex; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; align-items: center; }
        .mode-pill-group { display: flex; gap: 3px; }
        .mode-pill { background: #1a2a3a; border: 1px solid #2a3a4a; color: #778; font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 5px; cursor: pointer; transition: all .15s; white-space: nowrap; }
        .mode-pill:hover { background: #233040; color: #ccd; }
        .mode-pill.active { background: #ff9900; color: #0f1923; border-color: #ff9900; }
        .hour-pill-group { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 10px; padding: 8px 10px; background: #141f2c; border: 1px solid #2a3a4a; border-radius: 8px; }
        .hour-pill { background: #1a2a3a; border: 1px solid #2a3a4a; color: #778; font-size: 11px; font-weight: 700; padding: 4px 9px; border-radius: 5px; cursor: pointer; transition: all .12s; min-width: 32px; text-align: center; font-family: 'SF Mono', monospace; }
        .hour-pill:hover { background: #233040; color: #ccd; border-color: #3a4a5a; }
        .hour-pill.active { background: #ff9900; color: #0f1923; border-color: #ff9900; font-weight: 800; }
        .hour-pill[data-hour="-1"] { min-width: 48px; letter-spacing: .3px; }
        .vsm-meta-input { background: #0f1923; color: #e8eaed; border: 1px solid #3a4a5a; border-radius: 5px; padding: 4px 8px; font-size: 12px; font-weight: 700; width: 72px; text-align: center; }
        .vsm-meta-input:focus { outline: none; border-color: #ff9900; }
        .vrid-list-container { margin-top: 16px; border-top: 1px solid #2a3a4a; padding-top: 12px; }
        .vrid-list-controls { display: flex; gap: 8px; margin-bottom: 10px; align-items: center; }
        .vrid-search { flex: 1; background: #0f1923; border: 1px solid #2a3a4a; border-radius: 6px; padding: 6px 10px; color: #e8eaed; font-size: 12px; }
        .vrid-badge-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 10px; max-height: 400px; overflow-y: auto; padding: 4px; }
        .vrid-badge { background: #141f2c; border: 2px solid #2a3a4a; border-radius: 10px; padding: 8px 12px; display: flex; flex-direction: column; transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1); cursor: pointer; opacity: 0.45; transform: scale(0.98); user-select: none; }
        .vrid-badge:hover { opacity: 0.75; background: #1a2a3a; }
        .vrid-badge.selected { opacity: 1; transform: scale(1); border-color: #ff9900; background: #1a2a3a; box-shadow: 0 6px 12px rgba(0,0,0,0.4); }
        .vrid-badge:active { transform: scale(0.95); }
        .vrid-badge-content { width: 100%; font-size: 14px; line-height: 1.4; }
        .vrid-badge-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 5px; }
        .vrid-badge-vrid { font-weight: 700; color: #ff9900; font-size: 16px; }
        .vrid-badge-pkgs { background: rgba(0, 180, 120, 0.15); padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 13px; font-weight: 600; color: #4dddaa; }
        .vrid-badge-times { display: flex; gap: 14px; margin-bottom: 3px; color: #99a; font-size: 13px; }
        .vrid-badge-route { color: #668; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .vrid-badge-status { font-size: 12px; margin-top: 4px; }
        #vl-toggle { position: fixed; bottom: 80px; right: 20px; background: linear-gradient(135deg, #1a2a3a 0%, #232f3e 100%); color: #ff9900; border: 1px solid rgba(255,153,0,.3); border-radius: 10px; padding: 9px 16px; font-size: 13px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,.4); z-index: 99998; transition: all .2s; letter-spacing: .3px; }
        #vl-toggle:hover { background: linear-gradient(135deg, #232f3e 0%, #2a3a4a 100%); box-shadow: 0 6px 20px rgba(0,0,0,.5); transform: translateY(-2px); }

        .vsm-config-table { width: 100%; border-collapse: collapse; font-size: 12px; text-align: left; }
        .vsm-config-table th, .vsm-config-table td { border: 1px solid #2a3a4a; padding: 8px 12px; }
        .vsm-config-table th { background: #1a2a3a; color: #ff9900; font-weight: 700; position: sticky; top: 0; z-index: 1;}
        .vsm-config-table tr:nth-child(even) { background: #141f2c; }
        .vsm-config-table tr:hover { background: #1e3040; }
        .cfg-input { background: #0f1923; border: 1px solid #3a4a5a; color: #e8eaed; padding: 4px 8px; border-radius: 4px; width: 100%; font-size: 12px; transition: border-color 0.2s; }
        .cfg-input:focus { outline: none; border-color: #ff9900; }
        .cfg-del-btn { opacity: 0.6; transition: opacity 0.2s; }
        .cfg-del-btn:hover { opacity: 1; }
    `);

            function generateHourOpts(def) {
                return Array.from({ length: 24 }, (_, i) =>
                    `<option value="${i}"${i === def ? ' selected' : ''}>${String(i).padStart(2, '0')}:00</option>`
                ).join('');
            }

            function renderConfigTable() {
                const tbody = document.getElementById('config-table-body');
                if (!tbody) return;

                const rows = [...activeMappings];

                rows.sort((a, b) => {
                    const gA = parseInt(a.group, 10) || 999;
                    const gB = parseInt(b.group, 10) || 999;
                    if (gA !== gB) return gA - gB;
                    return a.route.localeCompare(b.route);
                });

                let html = '';
                for (let i = 0; i < rows.length; i++) {
                    const row = rows[i];
                    html += `<tr class="cfg-row">
                <td><input type="text" class="cfg-input cfg-route" value="${esc(row.route)}" placeholder="Rota"></td>
                <td><input type="text" class="cfg-input cfg-vsm-input" value="${esc(row.vsm)}" placeholder="VSM"></td>
                <td style="width: 100px;"><input type="number" class="cfg-input cfg-group" value="${esc(row.group)}" placeholder="ID Grupo"></td>
                <td style="width: 40px; text-align: center;"><button class="vl-btn-small cfg-del-btn" style="background:#e05;">X</button></td>
            </tr>`;
                }

                tbody.innerHTML = html;

                tbody.addEventListener('input', () => { configIsDirty = true; });
                tbody.querySelectorAll('.cfg-del-btn').forEach(btn => {
                    btn.addEventListener('click', e => {
                        e.target.closest('tr').remove();
                        configIsDirty = true;
                    });
                });

                const fTbody = document.getElementById('config-finger-body');
                if (fTbody) {
                    let fHtml = '';
                    activeFingers.forEach(f => {
                        fHtml += `<tr class="cfg-finger-row">
                    <td style="width: 120px;"><input type="number" class="cfg-input cfg-f-id" value="${f.id}" placeholder="ID"></td>
                    <td><input type="text" class="cfg-input cfg-f-name" value="${esc(f.name)}" placeholder="Ex: Finger 1"></td>
                    <td><input type="text" class="cfg-input cfg-f-belts" value="${f.belts.join(',')}" placeholder="Ex: 1,2,3"></td>
                    <td style="width: 40px; text-align: center;"><button class="vl-btn-small cfg-f-del-btn" style="background:#e05;">X</button></td>
                </tr>`;
                    });
                    fTbody.innerHTML = fHtml;

                    fTbody.addEventListener('input', () => { configIsDirty = true; });
                    fTbody.querySelectorAll('.cfg-f-del-btn').forEach(btn => {
                        btn.addEventListener('click', e => {
                            e.target.closest('tr').remove();
                            configIsDirty = true;
                        });
                    });
                }

                document.getElementById('cfg-search').dispatchEvent(new Event('input'));
            }

            function createPanel() {
                if (document.getElementById('vl-panel')) return;

                const today = new Date();
                const todayStr = today.toISOString().slice(0, 10);

                const panel = document.createElement('div');
                panel.id = 'vl-panel';

                panel.style.display = 'none';
                panel.innerHTML = `
            <div id="vl-panel-head">
                <h3>🔍 <span>VRID</span> Lookup — Mapa VSM</h3>
                <div id="vl-head-actions">
                    <button class="vl-head-btn" id="vl-close-btn" title="Minimizar">−</button>
                </div>
            </div>
            <div id="vl-panel-body" class="tl-morph-target">

                <div class="vl-controls-bar">
                    <div class="vl-ctrl-chip">
                        <label>📊 Exibir:</label>
                        <div class="mode-pill-group" id="count-mode-pills">
                            <button class="mode-pill active" data-mode="totalCount">Total</button>
                            <button class="mode-pill" data-mode="inTrailerCount">Não proc.</button>
                        </div>
                    </div>
                    <div class="vl-ctrl-chip">
                        <input type="checkbox" id="auto-refresh-toggle">
                        <label for="auto-refresh-toggle">Auto Refresh</label>
                        <select id="auto-refresh-interval">
                            <option value="5" selected>5 min</option>
                            <option value="10">10 min</option>
                            <option value="15">15 min</option>
                        </select>
                        <span id="auto-refresh-status" style="margin-left:4px;"> (desligado)</span>
                    </div>
                </div>

                <div class="vl-tabs">
                    <button class="vl-tab active" data-tab="hourly">Horas x VSM</button>
                    <button class="vl-tab" data-tab="static">Layout Físico</button>
                    <button class="vl-tab" data-tab="config">⚙️ Configurações</button>
                    <button id="vl-clear-cache-btn" style="background:#e05; color:white; border:none; padding:4px 10px; border-radius:12px; font-size:10px; margin-left:auto; cursor:pointer;" title="Limpa tokens e dados salvos do YMS/Relay">🧹 Limpar Cache</button>
                </div>

                <div id="tab-hourly" class="vl-tab-content active">
                    <div class="vl-section">
                        <div class="vl-section-title">VRID Único</div>
                        <div class="vl-row">
                            <input id="vl-vrid-input" type="text" placeholder="Digite o VRID…">
                            <button class="vl-btn" id="vl-search-btn">Buscar</button>
                        </div>
                    </div>

                    <div class="vl-section">
                        <div class="vl-section-title">Por Horário</div>
                        <div class="vl-row">
                            <input type="date" id="range-start-date" value="${todayStr}">
                            <span>até</span>
                            <input type="date" id="range-end-date"   value="${todayStr}">
                        </div>
                        <div class="vl-row">
                            <select id="range-start-hour">${generateHourOpts(0)}</select>
                            <span>até</span>
                            <select id="range-end-hour">${generateHourOpts(23)}</select>
                        </div>
                        <div class="vl-row">
                            <button class="vl-btn vl-btn-full" id="vl-range-btn">Buscar VRIDs</button>
                        </div>
                        <div class="vl-hint">Máximo 7 dias entre as datas</div>
                    </div>

                    <div class="vl-section">
                        <div class="vl-section-title" style="display:flex; justify-content:space-between; align-items:center;">
                            <span>🗺 Mapa VSM (Horas x VSM)</span>
                            <button class="vl-btn" id="vl-vsm-export-csv-btn" style="padding: 2px 8px; font-size: 11px; margin: 0;">📥 Exportar VRIDs (CSV)</button>
                        </div>
                        <div id="vsm-map-container">
                            <div class="vsm-map-empty">Carregue VRIDs para visualizar o mapa.</div>
                        </div>
                    </div>
                </div>

                <div id="tab-static" class="vl-tab-content">
                    <div class="vl-section">
                        <div class="vl-section-title">🗺 Layout Físico (Mapa Estático)</div>
                        <div class="vsm-static-controls">
                            <div class="vl-ctrl-chip">
                                <label>🎯 Meta pkgs/h:</label>
                                <input type="number" id="static-max-pkgs" class="vsm-meta-input" value="400" min="1" max="99999">
                                <span style="font-size:11px;color:#667;">pkgs/h</span>
                            </div>
                            <div class="vl-ctrl-chip">
                                <label>✋ Rate Finger:</label>
                                <input type="number" id="static-finger-rate" class="vsm-meta-input" value="4000" min="1" max="99999">
                                <span style="font-size:11px;color:#667;">pkgs/h</span>
                            </div>
                            <div class="vl-ctrl-chip">
                                <label>🏗 Rate CB:</label>
                                <input type="number" id="static-cb-rate" class="vsm-meta-input" value="500" min="1" max="99999">
                                <span style="font-size:11px;color:#667;">/h</span>
                            </div>
                            <div class="vl-ctrl-chip">
                                <label>🔄 Rate PO:</label>
                                <input type="number" id="static-po-rate" class="vsm-meta-input" value="1000" min="1" max="99999">
                                <span style="font-size:11px;color:#667;">/h</span>
                            </div>
                        </div>
                        <div id="static-need-summary" class="vsm-need-summary" style="display:none;">
                            <div class="need-card need-cb">
                                <span class="need-val" id="need-cb-total">—</span>
                                <span class="need-label">Container Builders</span>
                                <span class="need-sub">(mín. 17)</span>
                            </div>
                            <div class="need-card need-po">
                                <span class="need-val" id="need-po-total">—</span>
                                <span class="need-label">Pickoffs</span>
                                <span class="need-sub">(mín. 17)</span>
                            </div>
                        </div>
                        <div class="vl-section-title" style="margin-top:10px;">🕐 Hora</div>
                        <div class="hour-pill-group" id="static-hour-pills">
                            <button class="hour-pill active" data-hour="-1">Total</button>
                            ${Array.from({ length: 24 }, (_, i) => `<button class="hour-pill" data-hour="${i}">${String(i).padStart(2, '0')}</button>`).join('')}
                            <button class="hour-pill" data-hour="24" id="pill-next-day" style="display:none; min-width: 60px;">00h (+1)</button>
                        </div>
                        <div id="vsm-layout-container">
                            <div class="vsm-map-empty">Carregando mapa estático...</div>
                        </div>
                    </div>

                    <div class="vrid-list-container" id="vrid-list-container">
                        <div class="vsm-map-empty">Carregando lista de VRIDs...</div>
                    </div>
                </div>

                <div id="tab-config" class="vl-tab-content">

                    <div class="vl-section" style="background: #1a2a3a; border-color: #ff9900; padding: 12px 14px; box-shadow: 0 4px 10px rgba(0,0,0,0.3);">
                        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <span style="font-weight: 700; color: #ff9900; font-size: 14px;">⚙️ Configurações Gerais</span>
                                <div class="vl-ctrl-chip" style="background: #0f1923; border-color: #3a4a5a; padding: 6px 10px;">
                                    <label style="font-size: 12px;">📍 Site (Node):</label>
                                    <input type="text" id="cfg-node-input" class="vsm-meta-input" style="text-transform: uppercase; width: 75px; font-weight: 700; border: 1px solid #ff9900;" value="${activeNodeId || 'CGH7'}" maxlength="8">
                                </div>
                            </div>
                            <button id="cfg-save-btn" class="vl-btn" style="background:#ff9900; color:#0f1923; font-size: 13px; padding: 8px 20px; box-shadow: 0 2px 8px rgba(255,153,0,0.4);">💾 Salvar Todas as Alterações</button>
                        </div>
                    </div>

                    <div class="vl-section">
                        <div class="vl-section-title" style="display:flex; justify-content:space-between; align-items:center;">
                            <span>Configuração dos Fingers (Agrupamento de Belts)</span>
                            <button id="cfg-add-finger-btn" class="vl-btn-small" style="background:#2d8a4e;">+ Novo Finger</button>
                        </div>
                        <div class="vsm-tbl-wrap" style="max-height: 25vh;">
                            <table class="vsm-config-table">
                                <thead>
                                    <tr><th>ID (Ex: pra Tag [F3] use 3)</th><th>Nome de Exibição</th><th>Belts (Separe por vírgula)</th><th>Ação</th></tr>
                                </thead>
                                <tbody id="config-finger-body">
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div class="vl-section" style="border-color: #3a6a8a; background: #121822;">
                        <div class="vl-section-title" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; color: #aad4ff;">
                            <span>Matriz do Mapa (Layout Físico)</span>
                            <div style="display:flex; gap: 8px;">
                                <button id="cfg-map-export-btn" class="vl-btn-small" style="background:#1a4a2a; color:#aaffaa; border: 1px solid #2a6a3a;">📥 Baixar Mapa (.xlsx)</button>
                                <button id="cfg-map-import-btn" class="vl-btn-small" style="background:#2a4a6a; color:#aad4ff; border: 1px solid #3a6a8a;">📤 Subir Mapa (.xlsx)</button>
                                <input type="file" id="cfg-map-file-input" accept=".xlsx, .xls" style="display:none;">
                                <button id="cfg-map-reset-btn" class="vl-btn-small" style="background:#4a5a6a; color:#fff;">🔄 Restaurar Mapa Padrão</button>
                            </div>
                        </div>
                        <p style="font-size: 11px; color: #889; margin: 0; line-height: 1.5;">
                            Ao baixar o mapa, você verá TAGS especiais para as somas. Edite no Excel e faça upload novamente. <br>
                            <strong>Tags:</strong> <code>[B1]</code> a <code>[B17]</code> (Soma das Belts) | <code>[F1]</code> e <code>[F2]</code> (Soma dos Fingers) | <code>[TS_V]</code> (Total Sortation) | <code>[L_F1]</code>, <code>[L_F2]</code>, <code>[L_TS]</code> (Títulos das seções) | <code>[SKIP]</code> (Pula a renderização da célula)
                        </p>
                    </div>

                    <div class="vl-section">
                        <div class="vl-section-title" style="display:flex; flex-direction:column; gap:10px;">
                            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                                <span>Mapeamento Base (Rotas -> VSM -> Grupos)</span>
                                <div style="display:flex; gap: 8px;">
                                    <button id="cfg-export-btn" class="vl-btn-small" style="background:#1a4a2a; color:#aaffaa; border: 1px solid #2a6a3a;">📥 Baixar Mapeamento (.xlsx)</button>
                                    <button id="cfg-import-btn" class="vl-btn-small" style="background:#2a4a6a; color:#aad4ff; border: 1px solid #3a6a8a;">📤 Subir Mapeamento (.xlsx)</button>
                                    <input type="file" id="cfg-file-input" accept=".xlsx, .xls" style="display:none;">
                                </div>
                            </div>
                            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                                <input type="text" id="cfg-search" class="cfg-input" style="width:280px;" placeholder="🔍 Pesquisar Rota, VSM ou Grupo...">
                                <div style="display:flex; gap: 8px;">
                                    <button id="cfg-add-btn" class="vl-btn-small" style="background:#2d8a4e;">+ Nova Linha</button>
                                    <button id="cfg-reset-btn" class="vl-btn-small" style="background:#4a5a6a; color:#fff;">🔄 Restaurar Mapeamento Padrão</button>
                                </div>
                            </div>
                        </div>
                        <div class="vsm-tbl-wrap" style="max-height: 45vh;">
                            <table class="vsm-config-table">
                                <thead>
                                    <tr><th>Rota</th><th>VSM</th><th>Grupo de VSMs (Belt)</th><th>Ação</th></tr>
                                </thead>
                                <tbody id="config-table-body">
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <div id="vl-progress">
                    <div class="vl-prog-text"></div>
                    <div class="vl-prog-track"><div class="vl-prog-fill"></div></div>
                </div>

                <div id="vl-result"></div>
            </div>
        `;
                document.body.appendChild(panel);

                const nodeInputEl = document.getElementById('cfg-node-input');
                if (nodeInputEl) {
                    nodeInputEl.addEventListener('input', (e) => {
                        e.target.value = e.target.value.toUpperCase();
                        configIsDirty = true;
                    });
                }

                document.getElementById('cfg-add-btn').addEventListener('click', () => {
                    const tbody = document.getElementById('config-table-body');
                    const tr = document.createElement('tr');
                    tr.className = 'cfg-row';
                    tr.innerHTML = `
                <td><input type="text" class="cfg-input cfg-route" value="" placeholder="NOVA_ROTA"></td>
                <td><input type="text" class="cfg-input cfg-vsm-input" value="" placeholder="NOVA_VSM"></td>
                <td style="width: 100px;"><input type="number" class="cfg-input cfg-group" value="99" placeholder="ID Grupo"></td>
                <td style="width: 40px; text-align: center;"><button class="vl-btn-small cfg-del-btn" style="background:#e05;">X</button></td>
            `;
                    tr.querySelector('.cfg-del-btn').addEventListener('click', e => {
                        e.target.closest('tr').remove();
                        configIsDirty = true;
                    });
                    tbody.insertBefore(tr, tbody.firstChild);
                    configIsDirty = true;
                });

                document.getElementById('cfg-add-finger-btn')?.addEventListener('click', () => {
                    const fTbody = document.getElementById('config-finger-body');
                    const tr = document.createElement('tr');
                    tr.className = 'cfg-finger-row';
                    tr.innerHTML = `
                <td style="width: 120px;"><input type="number" class="cfg-input cfg-f-id" value="" placeholder="ID"></td>
                <td><input type="text" class="cfg-input cfg-f-name" value="" placeholder="Nome do Finger"></td>
                <td><input type="text" class="cfg-input cfg-f-belts" value="" placeholder="1,2,3..."></td>
                <td style="width: 40px; text-align: center;"><button class="vl-btn-small cfg-f-del-btn" style="background:#e05;">X</button></td>
            `;
                    tr.querySelector('.cfg-f-del-btn').addEventListener('click', e => {
                        e.target.closest('tr').remove();
                        configIsDirty = true;
                    });
                    fTbody.appendChild(tr);
                    configIsDirty = true;
                });

                document.getElementById('cfg-save-btn').addEventListener('click', saveConfig);
                document.getElementById('cfg-reset-btn').addEventListener('click', resetConfigToDefault);

                document.getElementById('cfg-search').addEventListener('input', (e) => {
                    const term = e.target.value.toLowerCase();
                    const rows = document.querySelectorAll('#config-table-body tr.cfg-row');
                    rows.forEach(row => {
                        const r = row.querySelector('.cfg-route').value.toLowerCase();
                        const v = row.querySelector('.cfg-vsm-input').value.toLowerCase();
                        const g = row.querySelector('.cfg-group').value.toLowerCase();
                        if (r.includes(term) || v.includes(term) || g.includes(term)) {
                            row.style.display = '';
                        } else {
                            row.style.display = 'none';
                        }
                    });
                });

                document.getElementById('cfg-export-btn').addEventListener('click', () => {
                    if (typeof XLSX === 'undefined') { alert("A biblioteca XLSX ainda não carregou. Tente novamente em alguns segundos."); return; }
                    const rows = document.querySelectorAll('#config-table-body tr.cfg-row');
                    const exportData = [];
                    rows.forEach(row => {
                        const r = row.querySelector('.cfg-route').value.trim();
                        const v = row.querySelector('.cfg-vsm-input').value.trim();
                        const g = row.querySelector('.cfg-group').value.trim();
                        if (r && v && g) exportData.push({ "Rota": r, "VSM": v, "Grupo": g });
                    });
                    if (exportData.length === 0) { alert("Não há dados para exportar."); return; }
                    const worksheet = XLSX.utils.json_to_sheet(exportData);
                    const workbook = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(workbook, worksheet, "VSM_Config");
                    XLSX.writeFile(workbook, `Configuracoes_VSM_${new Date().toISOString().slice(0, 10)}.xlsx`);
                });

                document.getElementById('cfg-import-btn').addEventListener('click', () => {
                    if (typeof XLSX === 'undefined') { alert("A biblioteca XLSX ainda não carregou. Tente novamente em alguns segundos."); return; }
                    document.getElementById('cfg-file-input').click();
                });

                document.getElementById('vl-clear-cache-btn').addEventListener('click', () => {
                    if (confirm("Deseja limpar o cache de tokens (YMS/Relay) e dados salvos dos VRIDs? Isso pode forçar novos popups de validação.")) {
                        const keys = GM_listValues();
                        let count = 0;
                        keys.forEach(k => {
                            if (k.startsWith('yms_') || k.startsWith('relay_') || k.startsWith('cuft_')) {
                                GM_deleteValue(k);
                                count++;
                            }
                        });
                        _SUITE.ymsToken = '';
                        _SUITE.antiCsrfToken = '';
                        alert(`Cache limpo! ${count} itens removidos. Recarregue a página.`);
                        location.reload();
                    }
                });

                document.getElementById('cfg-file-input').addEventListener('change', (e) => {
                    const file = e.target.files[0];
                    if (!file) return;

                    const reader = new FileReader();
                    reader.onload = function (evt) {
                        try {
                            const data = new Uint8Array(evt.target.result);
                            const workbook = XLSX.read(data, { type: 'array' });
                            const firstSheetName = workbook.SheetNames[0];
                            const worksheet = workbook.Sheets[firstSheetName];
                            const json = XLSX.utils.sheet_to_json(worksheet);

                            const newMappings = [];
                            json.forEach(row => {
                                const r = row['Rota'] || row['rota'] || row['route'];
                                const v = row['VSM'] || row['vsm'];
                                const g = row['Grupo'] || row['grupo'] || row['group'] || 99;
                                if (r && v) {
                                    newMappings.push({ route: String(r).trim(), vsm: String(v).trim(), group: String(g).trim() });
                                }
                            });

                            if (newMappings.length > 0) {
                                activeMappings = newMappings;
                                GM_setValue('vsm_custom_config', JSON.stringify(activeMappings));
                                rebuildDictionaries();
                                configIsDirty = false;
                                renderConfigTable();
                                if (lastExportData.length > 0) computeAndRenderAll();
                                alert(`Sucesso! ${newMappings.length} mapeamentos importados.`);
                            } else {
                                alert('Nenhum dado válido encontrado no arquivo. Certifique-se de manter as colunas "Rota", "VSM" e "Grupo".');
                            }
                        } catch (err) {
                            console.error(err);
                            alert('Erro ao processar o arquivo Excel.');
                        }
                        document.getElementById('cfg-file-input').value = '';
                    };
                    reader.readAsArrayBuffer(file);
                });

                document.getElementById('cfg-map-export-btn').addEventListener('click', () => {
                    if (typeof XLSX === 'undefined') { alert("A biblioteca XLSX ainda não carregou."); return; }

                    const worksheet = XLSX.utils.aoa_to_sheet(activeMapMatrix);
                    const workbook = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(workbook, worksheet, "Layout_Mapa");
                    XLSX.writeFile(workbook, `Layout_Mapa_VSM_${new Date().toISOString().slice(0, 10)}.xlsx`);
                });

                document.getElementById('cfg-map-import-btn').addEventListener('click', () => {
                    if (typeof XLSX === 'undefined') { alert("A biblioteca XLSX ainda não carregou."); return; }
                    document.getElementById('cfg-map-file-input').click();
                });

                document.getElementById('cfg-map-file-input').addEventListener('change', (e) => {
                    const file = e.target.files[0];
                    if (!file) return;

                    const reader = new FileReader();
                    reader.onload = function (evt) {
                        try {
                            const data = new Uint8Array(evt.target.result);
                            const workbook = XLSX.read(data, { type: 'array' });
                            const firstSheetName = workbook.SheetNames[0];
                            const worksheet = workbook.Sheets[firstSheetName];

                            const aoa = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });

                            if (aoa.length > 0) {
                                activeMapMatrix = aoa;
                                GM_setValue('vsm_custom_map_matrix', JSON.stringify(activeMapMatrix));
                                if (lastExportData.length > 0) computeAndRenderAll(); else renderStaticVsmMap();
                                alert('Layout do mapa importado e atualizado com sucesso!');
                            } else {
                                alert('Arquivo de mapa vazio ou inválido.');
                            }
                        } catch (err) {
                            console.error(err);
                            alert('Erro ao processar o arquivo de mapa.');
                        }
                        document.getElementById('cfg-map-file-input').value = '';
                    };
                    reader.readAsArrayBuffer(file);
                });

                document.getElementById('cfg-map-reset-btn').addEventListener('click', () => {
                    if (confirm("Tem certeza que deseja restaurar o layout visual do mapa para o padrão original?")) {
                        activeMapMatrix = structuredClone(DEFAULT_MAP_MATRIX);
                        GM_setValue('vsm_custom_map_matrix', JSON.stringify(activeMapMatrix));
                        if (lastExportData.length > 0) computeAndRenderAll(); else renderStaticVsmMap();
                        alert('Mapa restaurado para o padrão.');
                    }
                });
            }

            function checkDirtyConfig() {
                if (configIsDirty) {
                    if (confirm('Você tem alterações não salvas nas Configurações. Deseja salvar agora?')) {
                        saveConfig();
                    } else {
                        renderConfigTable();
                        configIsDirty = false;
                    }
                }
            }

            function init() {
                const toggle = document.createElement('button');
                toggle.id = 'vl-toggle';
                toggle.textContent = '🔍 Layout Digital';

                toggle.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    const p = document.getElementById('vl-panel');
                    const isHidden = window.getComputedStyle(p).display === 'none';

                    if (!isHidden) {
                        checkDirtyConfig();
                        p.style.display = 'none';
                        toggle.style.display = 'block';
                    } else {
                        p.style.display = 'block';
                        toggle.style.display = 'none';
                    }
                };
                document.body.appendChild(toggle);

                createPanel();

                const panel = document.getElementById('vl-panel');
                if (panel) {
                    // Fullscreen disabled by request
                }

                const staticFingerRateInput = document.getElementById('static-finger-rate');
                if (staticFingerRateInput) {
                    staticFingerRateInput.addEventListener('change', () => {
                        const v = parseInt(staticFingerRateInput.value, 10);
                        if (!isNaN(v) && v > 0) {
                            staticFingerRate = v;
                            renderStaticVsmMap(getStaticVsmTotals());
                        }
                    });
                    staticFingerRateInput.addEventListener('input', () => {
                        const v = parseInt(staticFingerRateInput.value, 10);
                        if (!isNaN(v) && v > 0) {
                            staticFingerRate = v;
                            renderStaticVsmMap(getStaticVsmTotals());
                        }
                    });
                }

                const resultDiv = document.getElementById('vl-result');
                const progDiv = document.getElementById('vl-progress');

                const modePillGroup = document.getElementById('count-mode-pills');
                const modeSelect = { value: currentCountMode };

                modePillGroup.addEventListener('click', e => {
                    const btn = e.target.closest('.mode-pill');
                    if (!btn) return;
                    modePillGroup.querySelectorAll('.mode-pill').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    currentCountMode = btn.dataset.mode;
                    modeSelect.value = currentCountMode;

                    renderCardsFromCache();
                    renderVridList();
                    computeAndRenderAll();
                });

                const autoRefreshToggle = document.getElementById('auto-refresh-toggle');
                const autoRefreshIntervalSelect = document.getElementById('auto-refresh-interval');

                function updateAutoRefreshState() {
                    if (autoRefreshToggle.checked) {
                        if (lastSearch) {
                            const intervalMinutes = parseInt(autoRefreshIntervalSelect.value, 10);
                            startAutoRefresh(intervalMinutes);
                        } else {
                            updateCountdownDisplay();
                        }
                    } else {
                        stopAutoRefresh();
                    }
                }

                autoRefreshToggle.addEventListener('change', updateAutoRefreshState);
                autoRefreshIntervalSelect.addEventListener('change', updateAutoRefreshState);

                document.getElementById('vl-close-btn').onclick = () => {
                    checkDirtyConfig();
                    const p = document.getElementById('vl-panel');
                    p.style.display = 'none';
                    toggle.style.display = 'block';
                };



                const rangeStartDate = document.getElementById('range-start-date');
                const rangeEndDate = document.getElementById('range-end-date');
                function clampRangeDates() {
                    const start = new Date(rangeStartDate.value);
                    if (isNaN(start.getTime())) return;
                    const max = new Date(start);
                    max.setDate(start.getDate() + 7);
                    rangeEndDate.max = max.toISOString().slice(0, 10);
                    if (new Date(rangeEndDate.value) < start) rangeEndDate.value = rangeStartDate.value;
                    if (new Date(rangeEndDate.value) > max) rangeEndDate.value = max.toISOString().slice(0, 10);
                }
                rangeStartDate.addEventListener('change', clampRangeDates);
                rangeEndDate.addEventListener('change', clampRangeDates);
                clampRangeDates();

                const head = document.getElementById('vl-panel-head');
                let drag = false, ox, oy;
                head.addEventListener('mousedown', e => {
                    if (e.target.closest('button')) return;
                    drag = true;
                    const r = panel.getBoundingClientRect();
                    ox = e.clientX - r.left;
                    oy = e.clientY - r.top;
                    panel.style.right = 'auto';
                    panel.style.top = r.top + 'px';
                    panel.style.left = r.left + 'px';
                    e.preventDefault();
                });
                document.addEventListener('mousemove', e => {
                    if (!drag) return;
                    panel.style.left = (e.clientX - ox) + 'px';
                    panel.style.top = (e.clientY - oy) + 'px';
                });
                document.addEventListener('mouseup', () => { drag = false; });

                const tabs = document.querySelectorAll('.vl-tab');
                const contents = {
                    hourly: document.getElementById('tab-hourly'),
                    static: document.getElementById('tab-static'),
                    config: document.getElementById('tab-config')
                };

                function switchTab(tabId) {
                    const activeTabBefore = document.querySelector('.vl-tab.active')?.dataset.tab;
                    if (activeTabBefore === 'config' && tabId !== 'config') {
                        checkDirtyConfig();
                    }

                    const body = document.getElementById('vl-panel-body');
                    body.classList.add('updating');

                    setTimeout(() => {
                        tabs.forEach(tab => {
                            if (tab.dataset.tab === tabId) {
                                tab.classList.add('active');
                            } else {
                                tab.classList.remove('active');
                            }
                        });
                        Object.keys(contents).forEach(id => {
                            if (id === tabId) {
                                contents[id].classList.add('active');
                            } else {
                                contents[id].classList.remove('active');
                            }
                        });
                        if (resultDiv) {
                            if (tabId === 'static' || tabId === 'config') {
                                resultDiv.style.display = 'none';
                            } else if (tabId === 'hourly') {
                                resultDiv.style.display = '';
                            }
                        }
                        if (tabId === 'static') {
                            renderStaticVsmMap(getStaticVsmTotals());
                        }
                        body.classList.remove('updating');
                    }, 60);
                }

                tabs.forEach(tab => {
                    tab.addEventListener('click', () => {
                        const tabId = tab.dataset.tab;
                        if (tabId === 'hourly' || tabId === 'static' || tabId === 'config') {
                            switchTab(tabId);
                        }
                    });
                });

                renderConfigTable();
                renderStaticVsmMap({});

                const staticMaxPkgsInput = document.getElementById('static-max-pkgs');
                const staticHourPills = document.getElementById('static-hour-pills');
                const staticCbRateInput = document.getElementById('static-cb-rate');
                const staticPoRateInput = document.getElementById('static-po-rate');

                staticMaxPkgsInput.addEventListener('change', () => {
                    const v = parseInt(staticMaxPkgsInput.value, 10);
                    if (!isNaN(v) && v > 0) {
                        staticMaxPkgsPerHour = v;
                        renderStaticVsmMap(getStaticVsmTotals());
                    }
                });
                staticMaxPkgsInput.addEventListener('input', () => {
                    const v = parseInt(staticMaxPkgsInput.value, 10);
                    if (!isNaN(v) && v > 0) {
                        staticMaxPkgsPerHour = v;
                        renderStaticVsmMap(getStaticVsmTotals());
                    }
                });

                function applyRateInput(inputEl, setter) {
                    const v = parseInt(inputEl.value, 10);
                    if (!isNaN(v) && v > 0) {
                        setter(v);
                        renderStaticVsmMap(getStaticVsmTotals());
                    }
                }
                staticCbRateInput.addEventListener('change', () => applyRateInput(staticCbRateInput, v => { cbRate = v; }));
                staticCbRateInput.addEventListener('input', () => applyRateInput(staticCbRateInput, v => { cbRate = v; }));
                staticPoRateInput.addEventListener('change', () => applyRateInput(staticPoRateInput, v => { poRate = v; }));
                staticPoRateInput.addEventListener('input', () => applyRateInput(staticPoRateInput, v => { poRate = v; }));
                staticHourPills.addEventListener('click', e => {
                    const btn = e.target.closest('.hour-pill');
                    if (!btn) return;
                    staticHourPills.querySelectorAll('.hour-pill').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    staticSelectedHour = parseInt(btn.dataset.hour, 10);

                    const body = document.getElementById('vl-panel-body');
                    body.classList.add('updating');
                    setTimeout(() => {
                        renderStaticVsmMap(getStaticVsmTotals());
                        body.classList.remove('updating');
                    }, 60);
                });

                const searchBtn = document.getElementById('vl-search-btn');
                const vridInput = document.getElementById('vl-vrid-input');

                async function doSingleSearchHandler() {
                    const vrid = vridInput.value.trim().toUpperCase();
                    if (!vrid) {
                        resultDiv.innerHTML = '<div class="vl-err">Digite um VRID.</div>';
                        return;
                    }
                    const body = document.getElementById('vl-panel-body');
                    body.classList.add('updating');
                    await doSingleSearch(vrid);
                    body.classList.remove('updating');
                    if (autoRefreshToggle.checked && lastSearch) {
                        const intervalMinutes = parseInt(autoRefreshIntervalSelect.value, 10);
                        startAutoRefresh(intervalMinutes);
                    }
                    const activeTab = document.querySelector('.vl-tab.active');
                    if (activeTab && activeTab.dataset.tab === 'hourly') {
                        resultDiv.style.display = '';
                    } else if (activeTab && (activeTab.dataset.tab === 'static' || activeTab.dataset.tab === 'config')) {
                        resultDiv.style.display = 'none';
                    }
                }

                searchBtn.addEventListener('click', doSingleSearchHandler);
                vridInput.addEventListener('keypress', e => { if (e.key === 'Enter') doSingleSearchHandler(); });

                const rangeBtn = document.getElementById('vl-range-btn');
                const rangeStartHour = document.getElementById('range-start-hour');
                const rangeEndHour = document.getElementById('range-end-hour');

                async function doRangeSearchHandler() {
                    const startStr = rangeStartDate.value;
                    const endStr = rangeEndDate.value;
                    const startHour = parseInt(rangeStartHour.value, 10);
                    const endHour = parseInt(rangeEndHour.value, 10);

                    if (!startStr || !endStr) {
                        resultDiv.innerHTML = '<div class="vl-err">Selecione as datas.</div>';
                        return;
                    }
                    const sd = new Date(startStr + 'T00:00:00');
                    const ed = new Date(endStr + 'T00:00:00');
                    if (ed < sd) {
                        resultDiv.innerHTML = '<div class="vl-err">Data final menor que inicial.</div>';
                        return;
                    }
                    if ((ed - sd) / 86400000 > 7) {
                        resultDiv.innerHTML = '<div class="vl-err">Intervalo máximo de 7 dias.</div>';
                        return;
                    }

                    const body = document.getElementById('vl-panel-body');
                    body.classList.add('updating');
                    await doRangeSearch(sd, ed, startHour, endHour);
                    body.classList.remove('updating');
                    if (autoRefreshToggle.checked && lastSearch) {
                        const intervalMinutes = parseInt(autoRefreshIntervalSelect.value, 10);
                        startAutoRefresh(intervalMinutes);
                    }
                    const activeTab = document.querySelector('.vl-tab.active');
                    if (activeTab && activeTab.dataset.tab === 'hourly') {
                        resultDiv.style.display = '';
                    } else if (activeTab && (activeTab.dataset.tab === 'static' || activeTab.dataset.tab === 'config')) {
                        resultDiv.style.display = 'none';
                    }
                }

                rangeBtn.addEventListener('click', doRangeSearchHandler);
            }

            if (_SUITE.isDock) {
                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', init);
                } else {
                    init();
                }
            }
        })();
    }

    (function loadModuleCptTracker() {
        if (!_SUITE.isDock) return;
        'use strict';

        var BASE = _SUITE.BASE;

        var isStemPage = location.hostname === 'stem-na.corp.amazon.com';

        // _csrfToken now reads from the central interceptor set by patchXHR()
        var _csrfToken = '';
        Object.defineProperty(window, '__tlCptCsrf__', {
            get: function () { return _SUITE.antiCsrfToken || _csrfToken; }
        });

        if (isStemPage) {
            var LSKEY_RESULT = 'obdv_vsm_result';
            var LSKEY_TS = 'obdv_vsm_ts';

            function injectPageScript() {
                var node = GM_getValue('obdv_vsm_node', 'CGH7');
                var asOfTime = String(Date.now());
                var payload = JSON.stringify([{
                    operationName: 'VisualSortationMarkers',
                    variables: { nodeId: node, asOfTime: asOfTime },
                    query: 'query VisualSortationMarkers($nodeId:String!,$asOfTime:String!){visualSortationMarkers(nodeId:$nodeId,asOfTime:$asOfTime){stackingFilter visualMarkers{visualMarker}}}'
                }]);

                var code = '(function(){'
                    + 'var _res="' + LSKEY_RESULT + '";'
                    + 'var _ts="' + LSKEY_TS + '";'
                    + 'var _done=false;'
                    + 'var _payload=' + payload + ';'
                    + 'var _oFetch=window.fetch;'
                    + 'window.fetch=function(input,init){'
                    + 'var hdrs=init&&init.headers||{};'
                    + 'var tok=typeof hdrs.get==="function"?hdrs.get("anti-csrftoken-a2z"):hdrs["anti-csrftoken-a2z"];'
                    + 'if(!tok){Object.keys(hdrs).forEach(function(k){if(/anti-csrftoken/i.test(k))tok=hdrs[k];});}'
                    + 'if(tok&&tok.length>10&&!_done){'
                    + '_done=true;'
                    + '_oFetch("https://stem-na.corp.amazon.com/sortcenter/equipmentmanagement/graphql",{'
                    + 'method:"POST",credentials:"include",'
                    + 'headers:{"Content-Type":"application/json","anti-csrftoken-a2z":tok,"Accept":"application/json"},'
                    + 'body:JSON.stringify(_payload)'
                    + '}).then(function(r){return r.text().then(function(t){'
                    + 'localStorage.setItem(_res,JSON.stringify({status:r.status,body:t,ts:Date.now()}));'
                    + 'localStorage.setItem(_ts,Date.now());'
                    + '});}).catch(function(e){'
                    + 'localStorage.setItem(_res,JSON.stringify({status:0,body:String(e),ts:Date.now()}));'
                    + '});'
                    + '}'
                    + 'return _oFetch.apply(this,arguments);'
                    + '};'
                    + 'var _oSet=XMLHttpRequest.prototype.setRequestHeader;'
                    + 'XMLHttpRequest.prototype.setRequestHeader=function(n,v){'
                    + 'if(/anti-csrftoken/i.test(n)&&v&&v.length>10&&!_done){'
                    + '_done=true;'
                    + 'var _x=new XMLHttpRequest();'
                    + '_x.open("POST","https://stem-na.corp.amazon.com/sortcenter/equipmentmanagement/graphql");'
                    + '_x.setRequestHeader("Content-Type","application/json");'
                    + '_x.setRequestHeader("anti-csrftoken-a2z",v);'
                    + '_x.withCredentials=true;'
                    + '_x.onload=function(){localStorage.setItem(_res,JSON.stringify({status:_x.status,body:_x.responseText,ts:Date.now()}));localStorage.setItem(_ts,Date.now());};'
                    + '_x.onerror=function(){localStorage.setItem(_res,JSON.stringify({status:0,body:"XHR error",ts:Date.now()}));};'
                    + '_x.send(JSON.stringify(_payload));'
                    + '}'
                    + 'return _oSet.apply(this,arguments);'
                    + '};'
                    + '})();';
                var s = document.createElement('script');
                s.textContent = code;
                (document.head || document.documentElement).appendChild(s);
                try { s.remove(); } catch (e) { }
            }

            try { localStorage.removeItem(LSKEY_RESULT); } catch (e) { }
            injectPageScript();

            var attempts = 0;
            var iv = setInterval(function () {
                attempts++;
                try {
                    var raw = localStorage.getItem(LSKEY_RESULT);
                    if (raw) {
                        var parsed = JSON.parse(raw);
                        if (parsed && parsed.ts && parsed.ts > Date.now() - 30000) {
                            clearInterval(iv);
                            GM_setValue('obdv_vsm_body', parsed.body || '');
                            GM_setValue('obdv_vsm_status', parsed.status === 200 ? 'done' : 'error');
                            GM_setValue('obdv_vsm_ts', Date.now());
                            try { localStorage.removeItem(LSKEY_RESULT); } catch (e) { }
                            setTimeout(function () { try { window.close(); } catch (e) { } }, 300);
                            return;
                        }
                    }
                } catch (e) { }
                if (attempts >= 200) {
                    clearInterval(iv);
                    GM_setValue('obdv_vsm_status', 'error');
                    GM_setValue('obdv_vsm_body', 'Timeout: token não capturado');
                    GM_setValue('obdv_vsm_ts', Date.now());
                    try { window.close(); } catch (e) { }
                }
            }, 200);
            return;
        }

        function apiWindow(customWin) {
            if (customWin) {
                return { start: customWin.start - 3 * 3600000, end: customWin.end + 3 * 3600000 };
            }
            var now = new Date();
            var dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0).getTime();
            var dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2, 23, 30, 0).getTime();
            return { start: dayStart, end: dayEnd };
        }

        function todayWindow() {
            var now = new Date();
            var start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).getTime();
            var end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 23, 30, 0).getTime();
            return { start: start, end: end };
        }

        var MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
        function parseMs(s) {
            if (!s) return null;
            var m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})\s+(\d{2}):(\d{2})/);
            if (!m) return null;
            var yr = parseInt(m[3]); if (yr < 100) yr += 2000;
            var mon = MONTHS[m[2].charAt(0).toUpperCase() + m[2].slice(1).toLowerCase()];
            if (mon === undefined) return null;
            return new Date(yr, mon, parseInt(m[1]), parseInt(m[4]), parseInt(m[5])).getTime();
        }
        function cptHHMM(s) {
            if (!s) return '—';
            var m = s.match(/(\d{2}):(\d{2})$/);
            return m ? m[1] + ':' + m[2] : s;
        }
        function cleanRoute(r) { return (r || '').replace(/^[A-Z0-9]{2,6}\s*->\s*/i, '').trim() || r; }

        function splitRoute(route) {
            if (/_MM$/i.test(route)) return [route];
            if (/-(BUS|B)$/i.test(route)) return [route];
            var parts = route.split('-');
            if (parts.length >= 2) {
                var allNodes = parts.every(function (p) { return /^[A-Z]{2,4}\d[A-Z0-9]{0,4}$/i.test(p); });
                if (allNodes) return parts.map(function (p) { return p.toUpperCase(); });
            }
            return [route];
        }

        var VSM_CACHE_KEY = 'obdv_vsm_cache';
        var VSM_CACHE_TTL = 7 * 24 * 3600 * 1000;

        function loadVsmCache() {
            try {
                var raw = GM_getValue(VSM_CACHE_KEY, '');
                if (!raw) return {};
                var parsed = JSON.parse(raw);
                if (!parsed || Date.now() - (parsed.ts || 0) > VSM_CACHE_TTL) return {};
                return parsed.map || {};
            } catch (e) { return {}; }
        }

        function saveVsmCache(map) {
            try { GM_setValue(VSM_CACHE_KEY, JSON.stringify({ ts: Date.now(), map: map })); } catch (e) { }
        }

        var STATUS_MAP = {
            'outboundscheduled': { label: 'Agendado', color: '#64748b', bg: 'rgba(100,116,139,0.15)' },
            'outboundinprogress': { label: 'Em carregamento', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
            'outboundreadytodepart': { label: 'Em doca', color: '#eab308', bg: 'rgba(234,179,8,0.15)' },
            'outbounddeparted': { label: 'Partiu', color: '#94a3b8', bg: 'rgba(148,163,184,0.12)' },
            'outboundcompleted': { label: 'Finalizado', color: '#22c55e', bg: 'rgba(34,197,94,0.15)' },
            'outboundcancelled': { label: 'Cancelado', color: '#ef4444', bg: 'rgba(239,68,68,0.15)' },
            'scheduled': { label: 'Agendado', color: '#64748b', bg: 'rgba(100,116,139,0.15)' },
            'trailerattached': { label: 'Em espera', color: '#38bdf8', bg: 'rgba(56,189,248,0.15)' },
            'loadinginprogress': { label: 'Em carregamento', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
            'finishedloading': { label: 'Em doca', color: '#eab308', bg: 'rgba(234,179,8,0.15)' },
            'completed': { label: 'Finalizado', color: '#22c55e', bg: 'rgba(34,197,94,0.15)' },
            'readytodepart': { label: 'Em doca', color: '#eab308', bg: 'rgba(234,179,8,0.15)' },
            'readyforloading': { label: 'Em doca', color: '#eab308', bg: 'rgba(234,179,8,0.15)' },
            'outboundreadyforloading': { label: 'Em doca', color: '#eab308', bg: 'rgba(234,179,8,0.15)' },
            'departed': { label: 'Partiu', color: '#94a3b8', bg: 'rgba(148,163,184,0.12)' },
            'cancelled': { label: 'Cancelado', color: '#ef4444', bg: 'rgba(239,68,68,0.15)' },
        };
        function getStatus(raw) {
            var key = (raw || '').toLowerCase().replace(/[_\s]/g, '');
            return STATUS_MAP[key] || { label: raw || '—', color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' };
        }

        var STATUS_PRIORITY = (function () {
            var p = {};
            ['loadinginprogress', 'outboundinprogress'].forEach(function (k) { p[k] = 1; });
            ['trailerattached'].forEach(function (k) { p[k] = 2; });
            ['readytodepart', 'outboundreadytodepart', 'readyforloading', 'outboundreadyforloading', 'finishedloading'].forEach(function (k) { p[k] = 3; });
            ['completed', 'outboundcompleted'].forEach(function (k) { p[k] = 4; });
            ['scheduled', 'outboundscheduled'].forEach(function (k) { p[k] = 5; });
            ['departed', 'outbounddeparted'].forEach(function (k) { p[k] = 6; });
            ['cancelled', 'outboundcancelled'].forEach(function (k) { p[k] = 7; });
            return p;
        })();
        function statusPriority(raw) {
            var key = (raw || '').toLowerCase().replace(/_/g, '');
            return STATUS_PRIORITY[key] || 99;
        }

        var _vsmMap = loadVsmCache();

        var _containerMap = {};
        var _containerFetchQueue = [];
        var _containerFetchActive = 0;
        var _containerFetchGen = 0;
        var MAX_CONTAINER_CONCURRENT = 3;

        function _isValidContainerLabel(label) {
            if (!label) return false;
            var vp = ['BAG', 'PALLET', 'GAYLORD', 'XBRA'];
            var u = label.toUpperCase();
            return vp.some(function (p) { return u.indexOf(p) === 0; });
        }

        function _sameDay(msA, msB) {
            var a = new Date(msA), b = new Date(msB);
            return a.getFullYear() === b.getFullYear() &&
                a.getMonth() === b.getMonth() &&
                a.getDate() === b.getDate();
        }

        function _extractContainerTimeMs(container) {
            if (!container) return null;
            var fields = ['scheduleDepartureTime', 'cpt', 'criticalPullTime', 'sdt', 'shipDate',
                'estimatedShipDate', 'expiryTime', 'departureTime',
                'estimatedDepartureTime', 'expectedShipDate'];
            for (var i = 0; i < fields.length; i++) {
                var val = container[fields[i]];
                if (!val) continue;
                if (typeof val === 'number' && val > 1e12) return val;
                if (typeof val === 'string' && /^\d{13,}$/.test(val.trim())) return parseInt(val, 10);
                var ms = parseMs(String(val));
                if (ms) return ms;
            }
            return null;
        }

        function _countPkgsInNode(node, routeCptMs) {
            var matched = 0, total = 0, foundAnyTime = false;
            function walk(n) {
                if (!n) return;
                if (n.container && n.container.label && n.container.label.indexOf('SP') === 0) {
                    total++;
                    if (routeCptMs) {
                        var t = _extractContainerTimeMs(n.container);
                        if (t !== null) {
                            foundAnyTime = true;
                            if (_sameDay(t, routeCptMs)) matched++;
                        }
                    }
                }
                if (n.childNodes && Array.isArray(n.childNodes)) n.childNodes.forEach(walk);
            }
            walk(node);
            if (!foundAnyTime || !routeCptMs) matched = total;
            return { matched: matched, total: total, foundAnyTime: foundAnyTime };
        }

        function _palletMatchesRoute(container, routeCptMs) {
            if (!routeCptMs) return true;
            var t = _extractContainerTimeMs(container);
            if (t === null) return true;
            return _sameDay(t, routeCptMs);
        }

        function _analyzeContainerNodes(nodes, routeCptMs, routeCode) {
            var palletCount = 0, positionsData = [];
            if (!nodes || !Array.isArray(nodes)) return { palletCount: 0, positionsData: [] };

            function _findStackFilter(node, vsmSet) {
                if (!node) return false;
                var c = node.container;
                if (c && c.stackFilter) {

                    return vsmSet[c.stackFilter.toUpperCase()] === true;
                }
                var children = node.childNodes || [];
                for (var i = 0; i < children.length; i++) {
                    if (_findStackFilter(children[i], vsmSet)) return true;
                }
                return false;
            }

            function _hasAnyStackFilter(node) {
                if (!node) return false;
                var c = node.container;
                if (c && c.stackFilter) return true;
                var children = node.childNodes || [];
                for (var i = 0; i < children.length; i++) {
                    if (_hasAnyStackFilter(children[i])) return true;
                }
                return false;
            }

            function _palletBelongsToRoute(palletNode) {
                if (!routeCode) return true;
                var vsmRaw = _vsmMap[routeCode] || '';
                var vsmSet = {};
                vsmRaw.split(',').forEach(function (v) {
                    var t = v.trim().toUpperCase();
                    if (t) vsmSet[t] = true;
                });
                vsmSet[routeCode.toUpperCase()] = true;

                if (!_hasAnyStackFilter(palletNode)) return false;
                return _findStackFilter(palletNode, vsmSet);
            }

            nodes.forEach(function (node) {
                if (!node.container || !node.container.label) return;

                if (node.container.contType === 'STACKING_AREA') {

                    var areaTime = _extractContainerTimeMs(node.container);
                    if (areaTime !== null && routeCptMs && !_sameDay(areaTime, routeCptMs)) return;

                    var areaCount = 0;
                    (node.childNodes || []).forEach(function (child) {
                        if (child.container && child.container.label &&
                            _isValidContainerLabel(child.container.label) &&
                            _palletBelongsToRoute(child)) {
                            areaCount++;
                        }
                    });

                    if (areaCount > 0) {
                        palletCount += areaCount;
                        positionsData.push({ label: node.container.label });
                    }
                    return;
                }

                if (_isValidContainerLabel(node.container.label) && _palletMatchesRoute(node.container, routeCptMs)) {
                    palletCount++;
                }
            });
            return { palletCount: palletCount, positionsData: positionsData };
        }

        function _processContainerQueue(gen, onProgress) {
            while (_containerFetchActive < MAX_CONTAINER_CONCURRENT && _containerFetchQueue.length > 0) {
                var task = _containerFetchQueue.shift();
                _containerFetchActive++;
                (function (t) {
                    var params = [
                        'entity=getContainerDetailsForLoadGroupId',
                        'nodeId=' + encodeURIComponent(t.nodeId),
                        'loadGroupId=' + encodeURIComponent(t.loadGroupId),
                        'planId=' + encodeURIComponent(t.planId),
                        'vrId=' + encodeURIComponent(t.vrId),
                        'status=stacked',
                        'trailerId=' + encodeURIComponent(t.trailerId),
                        'trailerNumber='
                    ].join('&');
                    var hdrs = { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' };
                    var _activeCsrf = _SUITE.antiCsrfToken || _csrfToken;
                    if (_activeCsrf) hdrs['anti-csrftoken-a2z'] = _activeCsrf;
                    GM_xmlhttpRequest({
                        method: 'POST', url: BASE + 'ssp/dock/hrz/ob/fetchdata',
                        headers: hdrs, data: params, withCredentials: true, timeout: 15000,
                        onload: function (resp) {
                            _containerFetchActive--;
                            if (gen === _containerFetchGen) {
                                try {
                                    var d = JSON.parse(resp.responseText.replace(/^\uFEFF/, ''));
                                    if (d.ok && d.ret && d.ret.aaData && d.ret.aaData.ROOT_NODE) {
                                        _containerMap[t.routeKey] = _analyzeContainerNodes(d.ret.aaData.ROOT_NODE, t.cptMs || null, t.route);
                                    } else {
                                        _containerMap[t.routeKey] = null;
                                    }
                                } catch (e) { _containerMap[t.routeKey] = null; }
                                onProgress();
                            }
                            _processContainerQueue(gen, onProgress);
                        },
                        onerror: function () { _containerFetchActive--; if (gen === _containerFetchGen) { _containerMap[t.routeKey] = null; onProgress(); } _processContainerQueue(gen, onProgress); },
                        ontimeout: function () { _containerFetchActive--; if (gen === _containerFetchGen) { _containerMap[t.routeKey] = null; onProgress(); } _processContainerQueue(gen, onProgress); }
                    });
                })(task);
            }
        }

        function fetchContainersForRoutes(routes, nodeId, onProgress) {
            _containerFetchGen++;
            var gen = _containerFetchGen;
            _containerFetchQueue = [];
            _containerMap = {};
            routes.forEach(function (r) {
                var routeKey = r.route + '|' + (r.cptMs || 0);
                if (r.vrId && r.loadGroupId) {
                    _containerMap[routeKey] = undefined;
                    _containerFetchQueue.push({
                        routeKey: routeKey, route: r.route, nodeId: nodeId,
                        vrId: r.vrId, loadGroupId: r.loadGroupId,
                        planId: r.planId || '', trailerId: r.trailerId || '',
                        cptMs: r.cptMs || null
                    });
                } else {
                    _containerMap[routeKey] = null;
                }
            });
            _processContainerQueue(gen, onProgress);
        }

        var _vsmPending = false;

        function fetchVSM(node, onDone) {
            if (_vsmPending) { onDone(); return; }
            _vsmPending = true;

            GM_setValue('obdv_vsm_node', node);
            GM_setValue('obdv_vsm_status', '');
            GM_setValue('obdv_vsm_body', '');
            GM_setValue('obdv_vsm_ts', 0);

            var popupUrl = 'https://stem-na.corp.amazon.com/node/' + node + '/equipment';
            var win = null;
            try { win = window.open(popupUrl, 'obdv_vsm_popup', 'width=1,height=1,left=-300,top=-300,toolbar=no,menubar=no,scrollbars=no,resizable=no'); } catch (e) { }

            if (!win) {
                console.warn('[OBDockView] VSM popup bloqueado');
                _vsmPending = false;
                onDone();
                return;
            }

            var start = Date.now();
            var iv = setInterval(function () {
                var status = GM_getValue('obdv_vsm_status', '');
                var ts = GM_getValue('obdv_vsm_ts', 0);
                if ((status === 'done' || status === 'error') && ts > start) {
                    clearInterval(iv);
                    try { win.close(); } catch (e) { }
                    _vsmPending = false;
                    if (status === 'done') {
                        try {
                            var body = GM_getValue('obdv_vsm_body', '');
                            var json = JSON.parse(body);
                            var arr = Array.isArray(json) ? json : [json];
                            var vsms = (arr[0] && arr[0].data && arr[0].data.visualSortationMarkers) || [];
                            _vsmMap = {};
                            vsms.forEach(function (entry) {
                                var sf = (entry.stackingFilter || '').trim();
                                if (!sf) return;
                                var markers = (entry.visualMarkers || []);
                                if (markers.length) {
                                    _vsmMap[sf] = markers.map(function (v) { return v.visualMarker; }).join(', ');
                                }
                            });
                            console.log('[OBDockView] VSM loaded:', Object.keys(_vsmMap).length, 'rotas');
                        } catch (e) {
                            console.warn('[OBDockView] VSM parse error:', e.message);
                        }
                    }
                    onDone();
                } else if (Date.now() - start > 45000) {
                    clearInterval(iv);
                    try { win.close(); } catch (e) { }
                    _vsmPending = false;
                    console.warn('[OBDockView] VSM popup timeout');
                    onDone();
                }
            }, 200);
        }

        function injectStyles() {
            if (document.getElementById('obdv-styles')) return;
            var st = document.createElement('style');
            st.id = 'obdv-styles';
            st.textContent = `
            @keyframes obdv-blink { 0%,100%{opacity:1} 50%{opacity:0.15} }
            @keyframes obdv-pulse { 0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,0.6)} 70%{box-shadow:0 0 0 8px rgba(239,68,68,0)} }
            @keyframes obdv-spin  { to{transform:rotate(360deg)} }
            .obdv-card {
                background: #111827; border: 1px solid #1f2937; border-radius: 10px;
                overflow: hidden; display: flex; flex-direction: column;
                transition: transform 0.15s, box-shadow 0.15s; cursor: default;
            }
            .obdv-card:hover    { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(0,0,0,0.5); }
            .obdv-card.urgent   { border-color: #dc2626; animation: obdv-pulse 1.8s ease-out infinite; }
            .obdv-card.warning  { border-color: #d97706; }
            .obdv-card.expired  { opacity: 0.5; border-color: #374151; }
            .obdv-card-header   { padding: 10px 12px 8px; border-bottom: 1px solid rgba(255,255,255,0.06); }
            .obdv-route         { font-size: 13px; font-weight: 800; color: #f1f5f9; letter-spacing: 0.3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 4px; }
            .obdv-vsm           { font-size: 16px; font-weight: 700; color: #818cf8; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; letter-spacing: 0.5px; }
            .obdv-vsm.loading   { color: #4b5563; animation: obdv-blink 1.2s ease-in-out infinite; }
            .obdv-card-body     { padding: 10px 12px; flex: 1; display: flex; flex-direction: column; gap: 6px; }
            .obdv-cpt-time      { font-size: 28px; font-weight: 900; color: #f8fafc; font-family: monospace; letter-spacing: 1px; line-height: 1; }
            .obdv-cpt-time.urgent  { color: #ef4444; animation: obdv-blink 0.9s ease-in-out infinite; }
            .obdv-cpt-time.warning { color: #f59e0b; }
            .obdv-cpt-time.expired { color: #4b5563; }
            .obdv-remaining     { font-size: 11px; font-weight: 700; }
            .obdv-cpt-date      { font-size: 13px; font-weight: 800; color: #8b949e; letter-spacing: 0.3px; line-height: 1.2; margin-top: 2px; }
            .obdv-status-badge  { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 20px; font-size: 10px; font-weight: 700; white-space: nowrap; margin-top: auto; align-self: flex-start; }
            .obdv-container-section { border-top: 1px solid rgba(255,255,255,0.06); padding-top: 6px; margin-top: 6px; display: flex; flex-direction: column; gap: 3px; }
            .obdv-pallets   { font-size: 11px; font-weight: 800; color: #34d399; }
            .obdv-positions { font-size: 10px; color: #818cf8; line-height: 1.5; word-break: break-word; }
            .obdv-container-loading { font-size: 10px; color: #4b5563; animation: obdv-blink 1.2s ease-in-out infinite; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 6px; margin-top: 6px; }
        `;
            document.head.appendChild(st);
        }

        var _panel = null;

        function buildPanel() {
            if (_panel) { _panel.style.display = 'flex'; return; }
            injectStyles();

            _panel = document.createElement('div');
            _panel.id = 'tl-dock-view-panel';
            _panel.style.cssText = [
                'position:fixed;top:0;left:0;width:100vw;height:100vh',
                'background:rgba(10, 22, 40, 0.75);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)',
                'border:1px solid rgba(255,255,255,0.1);box-shadow:0 16px 48px rgba(0,0,0,.9)',
                'display:flex;flex-direction:column;overflow:hidden;resize:both',
                'font-family:"Amazon Ember",Arial,sans-serif;z-index:2147483647'
            ].join(';');

            var hdr = document.createElement('div');
            hdr.style.cssText = 'display:flex;align-items:center;gap:10px;padding:12px 16px;background:rgba(255,255,255,0.03);border-bottom:1px solid rgba(255,255,255,0.1);flex-shrink:0;cursor:grab;user-select:none;';
            hdr.innerHTML = '<span style="font-size:16px;font-weight:900;color:#f0f6ff;flex:1;letter-spacing:0.5px;">🚛 OB — Rotas, CPT &amp; VSM</span>';
            var closeBtn = document.createElement('button');
            closeBtn.textContent = '✕';
            closeBtn.style.cssText = 'background:none;border:none;color:#6e7681;cursor:pointer;font-size:20px;padding:0 4px;line-height:1;transition:color 0.15s;';
            closeBtn.onmouseover = function () { closeBtn.style.color = '#f85149'; };
            closeBtn.onmouseout = function () { closeBtn.style.color = '#6e7681'; };
            closeBtn.onclick = function () { _panel.style.display = 'none'; _panel.classList.remove('open'); };
            hdr.appendChild(closeBtn);
            var dX = 0, dY = 0, dragging = false;
            hdr.addEventListener('mousedown', function (e) { if (e.target.closest('button')) return; dragging = true; var r = _panel.getBoundingClientRect(); _panel.style.position = 'fixed'; _panel.style.top = r.top + 'px'; _panel.style.left = r.left + 'px'; _panel.style.width = r.width + 'px'; _panel.style.height = r.height + 'px'; dX = e.clientX - r.left; dY = e.clientY - r.top; e.preventDefault(); });
            document.addEventListener('mousemove', function (e) { if (!dragging) return; _panel.style.left = (e.clientX - dX) + 'px'; _panel.style.top = (e.clientY - dY) + 'px'; });
            document.addEventListener('mouseup', function () { dragging = false; });

            var toolbar = document.createElement('div');
            toolbar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 14px;background:transparent;border-bottom:1px solid rgba(255,255,255,0.08);flex-shrink:0;flex-wrap:wrap;';

            var nodeInput = document.createElement('input');
            nodeInput.value = detectNode() || 'CGH7';
            nodeInput.style.cssText = 'background:#161b22;border:2px solid #58a6ff;color:#f0f6ff;border-radius:6px;padding:5px 9px;font-size:12px;width:75px;font-family:monospace;outline:none;font-weight:bold;text-align:center;';

            var fetchBtn = document.createElement('button');
            fetchBtn.textContent = '🔄 Buscar';
            fetchBtn.style.cssText = 'padding:5px 14px;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;background:#1f6feb;color:#fff;white-space:nowrap;transition:background 0.15s;';
            fetchBtn.onmouseover = function () { fetchBtn.style.background = '#388bfd'; };
            fetchBtn.onmouseout = function () { fetchBtn.style.background = '#1f6feb'; };

            var filterInput = document.createElement('input');
            filterInput.placeholder = '🔍 Filtrar rota ou VSM...';
            filterInput.style.cssText = 'background:#161b22;border:1px solid #30363d;color:#f0f6ff;border-radius:6px;padding:5px 10px;font-size:11px;flex:1;min-width:140px;font-family:monospace;outline:none;';

            var hideExpiredBtn = document.createElement('button');
            hideExpiredBtn.textContent = '👁 Mostrar expirados';
            var _hideExp = true;
            hideExpiredBtn.style.cssText = 'padding:5px 10px;border:1px solid #58a6ff;border-radius:6px;font-size:10px;font-weight:700;cursor:pointer;background:#161b22;color:#58a6ff;white-space:nowrap;';
            hideExpiredBtn.onclick = function () {
                _hideExp = !_hideExp;
                hideExpiredBtn.textContent = _hideExp ? '👁 Mostrar expirados' : '🙈 Ocultar expirados';
                hideExpiredBtn.style.color = _hideExp ? '#58a6ff' : '#8b949e';
                hideExpiredBtn.style.borderColor = _hideExp ? '#58a6ff' : '#30363d';
                renderCards(filterInput.value.trim());
            };

            var routesPanelBtn = document.createElement('button');
            routesPanelBtn.textContent = '⚙ Rotas';
            routesPanelBtn.style.cssText = 'padding:5px 10px;border:1px solid #30363d;border-radius:6px;font-size:10px;font-weight:700;cursor:pointer;background:#161b22;color:#8b949e;white-space:nowrap;';
            routesPanelBtn.onmouseover = function () { routesPanelBtn.style.color = '#f0f6ff'; routesPanelBtn.style.borderColor = '#58a6ff'; };
            routesPanelBtn.onmouseout = function () { if (!routePanel.classList.contains('open')) { routesPanelBtn.style.color = '#8b949e'; routesPanelBtn.style.borderColor = '#30363d'; } };

            var calBtn = document.createElement('button');
            calBtn.textContent = '📅 Janela';
            calBtn.style.cssText = 'padding:5px 10px;border:1px solid #30363d;border-radius:6px;font-size:10px;font-weight:700;cursor:pointer;background:#161b22;color:#8b949e;white-space:nowrap;';
            calBtn.onmouseover = function () { calBtn.style.color = '#f0f6ff'; calBtn.style.borderColor = '#58a6ff'; };
            calBtn.onmouseout = function () { if (!calPanel.classList.contains('open')) { calBtn.style.color = '#8b949e'; calBtn.style.borderColor = '#30363d'; } };

            var countEl = document.createElement('span');
            countEl.style.cssText = 'font-size:10px;color:#6e7681;white-space:nowrap;';

            var vsmStatusEl = document.createElement('span');
            vsmStatusEl.style.cssText = 'font-size:10px;color:#818cf8;white-space:nowrap;';

            toolbar.appendChild(nodeInput);
            toolbar.appendChild(fetchBtn);
            toolbar.appendChild(filterInput);
            toolbar.appendChild(hideExpiredBtn);
            toolbar.appendChild(routesPanelBtn);
            toolbar.appendChild(calBtn);
            toolbar.appendChild(countEl);
            toolbar.appendChild(vsmStatusEl);

            var routePanel = document.createElement('div');
            routePanel.style.cssText = 'flex-shrink:0;background:#0d1117;border-bottom:1px solid #21262d;overflow:hidden;max-height:0;transition:max-height 0.25s ease;';
            var routePanelInner = document.createElement('div');
            routePanelInner.style.cssText = 'padding:10px 16px;display:flex;flex-wrap:wrap;gap:6px;max-height:180px;overflow-y:auto;';
            routePanel.appendChild(routePanelInner);

            var DEFAULT_DISABLED = ['XCV9', 'GRU9', 'GRU5', 'SBKP', 'SBGR', 'XBRA', 'XBS1', 'ELP8', 'CNF1', 'CNF5', 'GIG1', 'GIG2', 'POA1'];
            var _disabledRoutes = {};
            function isDefaultDisabled(route) {
                if (!route) return false;
                if (/^E/i.test(route)) return true;
                return DEFAULT_DISABLED.indexOf(route.toUpperCase()) !== -1;
            }
            function buildRoutePanel() {
                routePanelInner.innerHTML = '';
                if (!_routes.length) { routePanelInner.innerHTML = '<span style="font-size:11px;color:#6e7681;">Faça uma busca primeiro.</span>'; return; }
                var allBtn = document.createElement('button'); allBtn.textContent = 'Todos';
                allBtn.style.cssText = 'padding:3px 10px;border:1px solid #388bfd;border-radius:20px;font-size:10px;font-weight:700;cursor:pointer;background:rgba(56,139,253,0.15);color:#58a6ff;';
                allBtn.onclick = function () { _disabledRoutes = {}; buildRoutePanel(); renderCards(filterInput.value.trim()); };
                routePanelInner.appendChild(allBtn);
                var noneBtn = document.createElement('button'); noneBtn.textContent = 'Nenhum';
                noneBtn.style.cssText = 'padding:3px 10px;border:1px solid #30363d;border-radius:20px;font-size:10px;font-weight:700;cursor:pointer;background:#161b22;color:#6e7681;';
                noneBtn.onclick = function () { _routes.forEach(function (r) { _disabledRoutes[r.route] = true; }); buildRoutePanel(); renderCards(filterInput.value.trim()); };
                routePanelInner.appendChild(noneBtn);
                _routes.forEach(function (r) {
                    var en = !_disabledRoutes[r.route];
                    var vsm = _vsmMap[r.route] || '';
                    var chip = document.createElement('button');
                    chip.textContent = r.route + (vsm ? ' · ' + vsm : '');
                    chip.style.cssText = 'padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700;cursor:pointer;border:1px solid ' + (en ? '#388bfd' : '#30363d') + ';background:' + (en ? 'rgba(56,139,253,0.15)' : '#161b22') + ';color:' + (en ? '#58a6ff' : '#6e7681') + ';transition:all 0.12s;white-space:nowrap;';
                    chip.onclick = function () { if (_disabledRoutes[r.route]) delete _disabledRoutes[r.route]; else _disabledRoutes[r.route] = true; buildRoutePanel(); renderCards(filterInput.value.trim()); };
                    routePanelInner.appendChild(chip);
                });
            }
            routesPanelBtn.onclick = function () {
                var isOpen = routePanel.style.maxHeight !== '0px' && routePanel.style.maxHeight !== '';
                if (isOpen) { routePanel.style.maxHeight = '0'; routePanel.classList.remove('open'); routesPanelBtn.style.color = '#8b949e'; routesPanelBtn.style.borderColor = '#30363d'; }
                else { buildRoutePanel(); routePanel.style.maxHeight = '200px'; routePanel.classList.add('open'); routesPanelBtn.style.color = '#58a6ff'; routesPanelBtn.style.borderColor = '#58a6ff'; }
            };

            setTimeout(function () { buildRoutePanel(); }, 0);

            var calPanel = document.createElement('div');
            calPanel.style.cssText = 'flex-shrink:0;background:#0d1117;border-bottom:1px solid #21262d;overflow:hidden;max-height:0;transition:max-height 0.3s ease;';
            var calInner = document.createElement('div');
            calInner.style.cssText = 'padding:8px 14px;display:flex;align-items:center;gap:8px;';
            calPanel.appendChild(calInner);

            if (!document.getElementById('obdv-cal-styles')) {
                var _calStyle = document.createElement('style'); _calStyle.id = 'obdv-cal-styles';
                _calStyle.textContent =
                    '.obdv-dc{background:#161b22;border:1px solid #21262d;border-radius:8px;padding:6px 12px;cursor:pointer;transition:border-color .15s;min-width:112px;user-select:none;display:inline-flex;flex-direction:column;gap:2px;}'
                    + '.obdv-dc:hover{border-color:#30363d;}'
                    + '.obdv-dc.active{border-color:#388bfd!important;box-shadow:0 0 0 2px rgba(56,139,253,.15);}'
                    + '.obdv-dc-lbl{font-size:9px;font-weight:700;color:#4b5563;letter-spacing:1px;text-transform:uppercase;}'
                    + '.obdv-dc-date{font-size:12px;font-weight:800;color:#f0f6ff;font-family:monospace;}'
                    + '.obdv-dc-time{font-size:11px;color:#58a6ff;font-family:monospace;font-weight:700;}'
                    + '.obdv-pop{position:fixed;z-index:2147483647;background:#1c2128;border:1px solid #30363d;border-radius:10px;width:264px;box-shadow:0 8px 32px rgba(0,0,0,.8);overflow:hidden;display:none;}'
                    + '.obdv-pop-hdr{display:flex;align-items:center;justify-content:space-between;padding:10px 12px 8px;border-bottom:1px solid #21262d;}'
                    + '.obdv-nav{background:none;border:1px solid #30363d;color:#8b949e;font-size:14px;cursor:pointer;padding:2px 9px;border-radius:6px;line-height:1.4;}'
                    + '.obdv-nav:hover{color:#f0f6ff;border-color:#58a6ff;}'
                    + '.obdv-mon-lbl{font-size:12px;font-weight:700;color:#f0f6ff;font-family:monospace;}'
                    + '.obdv-grid-wrap{padding:8px;}'
                    + '.obdv-dow{display:grid;grid-template-columns:repeat(7,1fr);margin-bottom:4px;}'
                    + '.obdv-dow span{text-align:center;font-size:10px;font-weight:700;color:#4b5563;padding:2px 0;}'
                    + '.obdv-days{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;}'
                    + '.obdv-d{text-align:center;padding:6px 2px;font-size:12px;font-weight:600;color:#8b949e;border-radius:6px;cursor:pointer;user-select:none;}'
                    + '.obdv-d:hover:not(.obdv-other):not(.obdv-disabled){background:#21262d;color:#f0f6ff;}'
                    + '.obdv-other{color:#2d333b!important;pointer-events:none;}'
                    + '.obdv-disabled{color:#2d333b!important;pointer-events:none;}'
                    + '.obdv-sun{color:#ef4444;}'
                    + '.obdv-sat{color:#818cf8;}'
                    + '.obdv-today{background:#21262d;color:#f0f6ff;}'
                    + '.obdv-in-range{background:rgba(31,111,235,.18);color:#a5c8ff!important;border-radius:0;}'
                    + '.obdv-rs{background:#1f6feb!important;color:#fff!important;border-radius:6px 0 0 6px;}'
                    + '.obdv-re{background:#1f6feb!important;color:#fff!important;border-radius:0 6px 6px 0;}'
                    + '.obdv-sole{background:#1f6feb!important;color:#fff!important;border-radius:6px;}'
                    + '.obdv-time-row{border-top:1px solid #21262d;padding:8px 12px;display:flex;align-items:center;gap:8px;}'
                    + '.obdv-time-lbl{font-size:10px;color:#6e7681;flex:1;}'
                    + '.obdv-time-inp{background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#58a6ff;font-family:monospace;font-size:12px;font-weight:700;padding:4px 8px;outline:none;width:76px;}'
                    + '.obdv-ok{background:#1f6feb;color:#fff;border:none;border-radius:6px;padding:5px 12px;font-size:10px;font-weight:700;cursor:pointer;}';
                document.head.appendChild(_calStyle);
            }

            var _DOW = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
            var _MON = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

            function _localDate(offsetDays) {
                var d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offsetDays); return d;
            }
            function _makeS(offsetDays, hh, mm) {
                var d = _localDate(offsetDays);
                return { y: d.getFullYear(), mo: d.getMonth(), d: d.getDate(), hh: hh, mm: mm };
            }
            function _toMs(s) { return new Date(s.y, s.mo, s.d, s.hh, s.mm).getTime(); }
            function _fmt(s) { return ('0' + s.d).slice(-2) + '/' + ('0' + (s.mo + 1)).slice(-2) + '/' + s.y; }
            function _fmtT(s) { return ('0' + s.hh).slice(-2) + ':' + ('0' + s.mm).slice(-2); }

            function _allowed(y, mo, d) { var t = new Date(y, mo, d).getTime(); return t === _localDate(0).getTime() || t === _localDate(1).getTime(); }

            var _cs = {
                start: _makeS(0, 0, 0), end: _makeS(1, 23, 30), which: null,
                viewY: new Date().getFullYear(), viewMo: new Date().getMonth()
            };

            function _makeCard(lbl) {
                var el = document.createElement('div'); el.className = 'obdv-dc';
                var lb = document.createElement('div'); lb.className = 'obdv-dc-lbl'; lb.textContent = lbl;
                var dd = document.createElement('div'); dd.className = 'obdv-dc-date';
                var dt = document.createElement('div'); dt.className = 'obdv-dc-time';
                el.appendChild(lb); el.appendChild(dd); el.appendChild(dt);
                return { el: el, dd: dd, dt: dt };
            }
            var _sc = _makeCard('Início'), _ec = _makeCard('Fim');

            function _refreshCards() {
                _sc.dd.textContent = _fmt(_cs.start); _sc.dt.textContent = _fmtT(_cs.start);
                _ec.dd.textContent = _fmt(_cs.end); _ec.dt.textContent = _fmtT(_cs.end);
                _sc.el.classList.toggle('active', _cs.which === 'start');
                _ec.el.classList.toggle('active', _cs.which === 'end');
            }

            var _pop = document.createElement('div'); _pop.className = 'obdv-pop';

            var _ph = document.createElement('div'); _ph.className = 'obdv-pop-hdr';
            var _pv = document.createElement('button'); _pv.className = 'obdv-nav'; _pv.textContent = '‹';
            var _ml = document.createElement('span'); _ml.className = 'obdv-mon-lbl';
            var _pn = document.createElement('button'); _pn.className = 'obdv-nav'; _pn.textContent = '›';
            _ph.appendChild(_pv); _ph.appendChild(_ml); _ph.appendChild(_pn);

            var _gw = document.createElement('div'); _gw.className = 'obdv-grid-wrap';
            var _dr = document.createElement('div'); _dr.className = 'obdv-dow';
            _DOW.forEach(function (d) { var s = document.createElement('span'); s.textContent = d; _dr.appendChild(s); });
            var _dg = document.createElement('div'); _dg.className = 'obdv-days';
            _gw.appendChild(_dr); _gw.appendChild(_dg);

            var _tr = document.createElement('div'); _tr.className = 'obdv-time-row';
            var _tl = document.createElement('span'); _tl.className = 'obdv-time-lbl';
            var _ti = document.createElement('input'); _ti.type = 'time'; _ti.className = 'obdv-time-inp';
            var _ok = document.createElement('button'); _ok.className = 'obdv-ok'; _ok.textContent = 'OK';
            _tr.appendChild(_tl); _tr.appendChild(_ti); _tr.appendChild(_ok);

            _pop.appendChild(_ph); _pop.appendChild(_gw); _pop.appendChild(_tr);

            function _renderDays() {
                _ml.textContent = _MON[_cs.viewMo] + ' ' + _cs.viewY;
                _dg.innerHTML = '';
                var y = _cs.viewY, mo = _cs.viewMo;
                var fd = new Date(y, mo, 1).getDay();
                var dim = new Date(y, mo + 1, 0).getDate();
                var prev = new Date(y, mo, 0).getDate();
                var today = new Date(); today.setHours(0, 0, 0, 0);
                var sMs = _toMs(_cs.start), eMs = _toMs(_cs.end);
                var same = (_cs.start.y === _cs.end.y && _cs.start.mo === _cs.end.mo && _cs.start.d === _cs.end.d);

                for (var i = 0; i < fd; i++) { var s = document.createElement('span'); s.className = 'obdv-d obdv-other'; s.textContent = prev - fd + 1 + i; _dg.appendChild(s); }
                for (var day = 1; day <= dim; day++) {
                    var sp = document.createElement('span'); sp.className = 'obdv-d';
                    var dow = new Date(y, mo, day).getDay();
                    if (dow === 0) sp.classList.add('obdv-sun');
                    if (dow === 6) sp.classList.add('obdv-sat');
                    var dayMs = new Date(y, mo, day).getTime();
                    if (!_allowed(y, mo, day)) { sp.classList.add('obdv-disabled'); }
                    if (dayMs === today.getTime()) sp.classList.add('obdv-today');
                    var dayEnd = dayMs + 86399999;
                    if (same && _cs.start.y === y && _cs.start.mo === mo && _cs.start.d === day) { sp.classList.add('obdv-sole'); }
                    else if (_cs.start.y === y && _cs.start.mo === mo && _cs.start.d === day) { sp.classList.add('obdv-rs'); }
                    else if (_cs.end.y === y && _cs.end.mo === mo && _cs.end.d === day) { sp.classList.add('obdv-re'); }
                    else if (dayMs > sMs && dayEnd < eMs) { sp.classList.add('obdv-in-range'); }
                    sp.textContent = day;
                    (function (dy) { if (_allowed(y, mo, dy)) { sp.onclick = function () { _pickDay(dy); }; }; })(day);
                    _dg.appendChild(sp);
                }
                var tot = fd + dim, rem = (Math.ceil(tot / 7) * 7) - tot;
                for (var j = 1; j <= rem; j++) { var s2 = document.createElement('span'); s2.className = 'obdv-d obdv-other'; s2.textContent = j; _dg.appendChild(s2); }
            }

            function _pickDay(day) {
                if (_cs.which === 'start') { _cs.start.y = _cs.viewY; _cs.start.mo = _cs.viewMo; _cs.start.d = day; }
                else { _cs.end.y = _cs.viewY; _cs.end.mo = _cs.viewMo; _cs.end.d = day; }
                if (_toMs(_cs.start) > _toMs(_cs.end)) {
                    if (_cs.which === 'start') { _cs.end = { y: _cs.start.y, mo: _cs.start.mo, d: _cs.start.d, hh: _cs.end.hh, mm: _cs.end.mm }; }
                    else { _cs.start = { y: _cs.end.y, mo: _cs.end.mo, d: _cs.end.d, hh: _cs.start.hh, mm: _cs.start.mm }; }
                }
                _renderDays(); _refreshCards();
            }

            function _openPop(which, anchorEl) {
                _cs.which = which;
                var _anchor = which === 'start' ? _cs.start : _cs.end;
                _cs.viewY = _anchor.y;
                _cs.viewMo = _anchor.mo;
                _tl.textContent = which === 'start' ? 'Horário de início' : 'Horário de fim';
                _ti.value = which === 'start' ? _fmtT(_cs.start) : _fmtT(_cs.end);
                _renderDays(); _refreshCards();
                _pop.style.display = 'block';
                var r = anchorEl.getBoundingClientRect();
                _pop.style.left = Math.min(r.left, window.innerWidth - 274) + 'px';
                _pop.style.top = (r.bottom + 6) + 'px';
            }

            function _closePop() { _pop.style.display = 'none'; _cs.which = null; _refreshCards(); }

            _ok.onclick = function () {
                var tp = _ti.value.split(':');
                if (tp.length === 2) {
                    var hh = parseInt(tp[0]), mm = parseInt(tp[1]);
                    if (_cs.which === 'start') { _cs.start.hh = hh; _cs.start.mm = mm; }
                    else { _cs.end.hh = hh; _cs.end.mm = mm; }
                }
                _closePop();
            };
            _pv.onclick = function (e) { e.stopPropagation(); _cs.viewMo--; if (_cs.viewMo < 0) { _cs.viewMo = 11; _cs.viewY--; } _renderDays(); };
            _pn.onclick = function (e) { e.stopPropagation(); _cs.viewMo++; if (_cs.viewMo > 11) { _cs.viewMo = 0; _cs.viewY++; } _renderDays(); };

            document.addEventListener('mousedown', function (e) {
                if (_pop.style.display === 'block' && !_pop.contains(e.target) && !_sc.el.contains(e.target) && !_ec.el.contains(e.target)) { _closePop(); }
            });

            _sc.el.onclick = function () { if (_cs.which === 'start') { _closePop(); } else { _openPop('start', _sc.el); } };
            _ec.el.onclick = function () { if (_cs.which === 'end') { _closePop(); } else { _openPop('end', _ec.el); } };

            var calApplyBtn = document.createElement('button');
            calApplyBtn.textContent = '✓ Aplicar';
            calApplyBtn.style.cssText = 'padding:5px 12px;border-radius:6px;font-size:10px;font-weight:700;cursor:pointer;border:1px solid #1f6feb;background:rgba(31,111,235,0.2);color:#58a6ff;white-space:nowrap;';

            var calAutoBtn = document.createElement('button');
            calAutoBtn.textContent = '⟳ Auto';
            calAutoBtn.style.cssText = 'padding:5px 12px;border-radius:6px;font-size:10px;font-weight:700;cursor:pointer;border:1px solid #22c55e;background:rgba(34,197,94,0.1);color:#22c55e;white-space:nowrap;';

            var calStatusLbl = document.createElement('span');
            calStatusLbl.style.cssText = 'font-size:10px;color:#818cf8;';

            function updateCalStatus() {
                if (!_activeWindow) {
                    calStatusLbl.textContent = '● Auto: 22/03 00:00 → 23/03 23:30';
                    calStatusLbl.style.color = '#22c55e';
                    calAutoBtn.style.opacity = '1';
                    calAutoBtn.style.background = 'rgba(34,197,94,0.2)';
                    calAutoBtn.style.borderColor = '#22c55e';
                    calApplyBtn.style.opacity = '0.6';
                } else {
                    calStatusLbl.textContent = '● ' + _fmt(_cs.start) + ' ' + _fmtT(_cs.start) + ' → ' + _fmt(_cs.end) + ' ' + _fmtT(_cs.end);
                    calStatusLbl.style.color = '#818cf8';
                    calAutoBtn.style.opacity = '0.5';
                    calAutoBtn.style.background = 'rgba(34,197,94,0.05)';
                    calAutoBtn.style.borderColor = 'rgba(34,197,94,0.3)';
                    calApplyBtn.style.opacity = '1';
                }
            }

            calApplyBtn.onclick = function () {
                _closePop();
                var sMs = _toMs(_cs.start), eMs = _toMs(_cs.end);
                if (eMs <= sMs) { calStatusLbl.textContent = '⚠ Fim deve ser após o início'; calStatusLbl.style.color = '#ef4444'; return; }
                _activeWindow = { start: sMs, end: eMs }; updateCalStatus(); doFetch();
            };

            calAutoBtn.onclick = function () {
                _closePop(); _activeWindow = null;
                _cs.start = _makeS(0, 0, 0); _cs.end = _makeS(1, 23, 30);
                _refreshCards(); updateCalStatus(); doFetch();
            };

            var _arr = document.createElement('span'); _arr.textContent = '→'; _arr.style.cssText = 'color:#4b5563;font-size:14px;';
            calInner.appendChild(_sc.el); calInner.appendChild(_arr); calInner.appendChild(_ec.el);
            calInner.appendChild(calApplyBtn); calInner.appendChild(calAutoBtn); calInner.appendChild(calStatusLbl);

            calBtn.onclick = function () {
                var isOpen = calPanel.classList.contains('open');
                if (isOpen) { _closePop(); calPanel.style.maxHeight = '0'; calPanel.classList.remove('open'); calBtn.style.color = '#8b949e'; calBtn.style.borderColor = '#30363d'; }
                else { calPanel.style.maxHeight = '80px'; calPanel.classList.add('open'); calBtn.style.color = '#58a6ff'; calBtn.style.borderColor = '#58a6ff'; updateCalStatus(); }
            };
            setTimeout(function () {
                _refreshCards(); updateCalStatus();
                calPanel.style.maxHeight = '80px'; calPanel.classList.add('open');
                calBtn.style.color = '#58a6ff'; calBtn.style.borderColor = '#58a6ff';
            }, 50);

            var gridWrap = document.createElement('div');
            gridWrap.style.cssText = 'flex:1;overflow-y:auto;padding:14px 16px;background:#0d1117;min-height:0;';
            var grid = document.createElement('div');
            grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(175px,1fr));gap:10px;';
            gridWrap.appendChild(grid);

            var statusBar = document.createElement('div');
            statusBar.style.cssText = 'padding:5px 14px;font-size:10px;color:#6e7681;border-top:1px solid #21262d;background:#0d1117;flex-shrink:0;';
            statusBar.textContent = 'Pronto — clique em 🔄 Buscar';

            _panel.style.cssText = 'position:fixed;inset:0;background:rgba(10, 22, 40, 0.85);backdrop-filter:blur(16px);z-index:2147483645;display:none;flex-direction:column;overflow:hidden;font-family:"Amazon Ember",Arial,sans-serif;color:#fff;';
            _panel.classList.remove('open'); // Ensure it starts closed
            _panel.appendChild(hdr); _panel.appendChild(toolbar); _panel.appendChild(routePanel);
            _panel.appendChild(calPanel);
            gridWrap.id = 'ob-dock-grid-wrap';
            gridWrap.classList.add('tl-morph-target');
            _panel.appendChild(gridWrap); _panel.appendChild(statusBar);
            document.body.appendChild(_panel);
            _panel.appendChild(_pop);
            document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && _panel) _panel.style.display = 'none'; });

            var _routes = [];
            var _vsmLoading = false;
            var _activeWindow = null;
            var _defaultsApplied = false;

            function _isCompleted(status) {
                return ['completed', 'outboundcompleted', 'finishedloading']
                    .indexOf((status || '').toLowerCase().replace(/[_\s]/g, '')) !== -1;
            }

            function makeCard(r) {
                var now = Date.now(), diff = r.cptMs ? r.cptMs - now : null;
                var isCompleted = _isCompleted(r.status);
                var expired = (diff !== null && diff < 0) || isCompleted;
                var urgent = !expired && diff !== null && diff >= 0 && diff < 90 * 60000;
                var warning = !expired && diff !== null && diff >= 90 * 60000 && diff < 2 * 3600000;

                var card = document.createElement('div');
                card.className = 'obdv-card' + (urgent ? ' urgent' : warning ? ' warning' : expired ? ' expired' : '');

                var headerBg = expired ? '#1c2128' : urgent ? '#2d0f0f' : warning ? '#2b1d0e' : '#161b22';
                var hdrDiv = document.createElement('div');
                hdrDiv.className = 'obdv-card-header';
                hdrDiv.style.background = headerBg;

                var routeEl = document.createElement('div');
                routeEl.className = 'obdv-route';
                routeEl.title = r.route;
                routeEl.textContent = r.route;

                var vsmEl = document.createElement('div');
                var isMMRoute = /_MM$/i.test(r.route);
                var vsm = isMMRoute ? null : _vsmMap[r.route];
                if (isMMRoute) {
                    vsmEl.className = 'obdv-vsm';
                    vsmEl.style.color = '#374151';
                    vsmEl.textContent = '';
                } else if (_vsmLoading && vsm === undefined) {
                    vsmEl.className = 'obdv-vsm loading';
                    vsmEl.textContent = 'Buscando VSM...';
                } else if (vsm) {
                    vsmEl.className = 'obdv-vsm';
                    vsmEl.textContent = vsm;
                    vsmEl.title = 'Visual Sortation Marker: ' + vsm;
                } else if (!_vsmLoading) {
                    vsmEl.className = 'obdv-vsm';
                    vsmEl.style.color = '#374151';
                    vsmEl.textContent = 'Sem VSM';
                }
                hdrDiv.appendChild(vsmEl);
                hdrDiv.appendChild(routeEl);
                card.appendChild(hdrDiv);

                var body = document.createElement('div');
                body.className = 'obdv-card-body';

                var cptClass = urgent ? 'urgent' : warning ? 'warning' : expired ? 'expired' : '';
                var cptEl = document.createElement('div');
                cptEl.className = 'obdv-cpt-time' + (cptClass ? ' ' + cptClass : '');
                cptEl.textContent = r.cpt || '—';
                body.appendChild(cptEl);

                var cptDateEl = document.createElement('div');
                cptDateEl.className = 'obdv-cpt-date';
                if (r.cptMs) {
                    var _cd = new Date(r.cptMs);
                    var _today = new Date();
                    var _isTodayCpt = _cd.getDate() === _today.getDate() && _cd.getMonth() === _today.getMonth() && _cd.getFullYear() === _today.getFullYear();
                    var _tomorrow = new Date(_today); _tomorrow.setDate(_today.getDate() + 1);
                    var _isTomorrow = _cd.getDate() === _tomorrow.getDate() && _cd.getMonth() === _tomorrow.getMonth() && _cd.getFullYear() === _tomorrow.getFullYear();
                    cptDateEl.textContent = _isTodayCpt ? 'Hoje' : _isTomorrow ? 'Amanhã' : (('0' + (_cd.getMonth() + 1)).slice(-2) + '/' + ('0' + _cd.getDate()).slice(-2));
                } else { cptDateEl.textContent = ''; }
                body.appendChild(cptDateEl);

                var remEl = document.createElement('div');
                remEl.className = 'obdv-remaining';
                if (diff === null) { remEl.style.color = '#6e7681'; remEl.textContent = 'Sem CPT'; }
                else if (expired) { remEl.style.color = '#6e7681'; remEl.textContent = isCompleted ? 'Finalizado' : 'Expirado ' + Math.abs(Math.round(diff / 60000)) + 'min'; }
                else if (urgent) { remEl.style.color = '#ef4444'; remEl.textContent = '🚨 ' + Math.round(diff / 60000) + 'min restantes'; }
                else if (warning) { var m3 = Math.round(diff / 60000); remEl.style.color = '#f59e0b'; remEl.textContent = Math.floor(m3 / 60) + 'h ' + (m3 % 60) + 'min'; }
                else { var m4 = Math.round(diff / 60000); remEl.style.color = '#22c55e'; remEl.textContent = Math.floor(m4 / 60) + 'h ' + (m4 % 60) + 'min'; }
                body.appendChild(remEl);

                var st = getStatus(r.status);
                var badge = document.createElement('span');
                badge.className = 'obdv-status-badge';
                badge.style.cssText = 'background:' + st.bg + ';color:' + st.color + ';border:1px solid ' + st.color + '44;margin-top:6px;';
                badge.textContent = st.label;
                body.appendChild(badge);

                var cdata = _containerMap[r.route + '|' + (r.cptMs || 0)];
                if (!expired) {
                    if (cdata === undefined) {
                        var loadingEl = document.createElement('div');
                        loadingEl.className = 'obdv-container-loading';
                        loadingEl.textContent = '⏳ Carregando posições...';
                        body.appendChild(loadingEl);
                    } else if (cdata && (cdata.palletCount > 0 || cdata.positionsData.length > 0)) {
                        var csect = document.createElement('div');
                        csect.className = 'obdv-container-section';
                        var pallEl = document.createElement('div');
                        pallEl.className = 'obdv-pallets';
                        pallEl.textContent = '📦 ' + cdata.palletCount + ' pallet' + (cdata.palletCount !== 1 ? 's' : '');
                        csect.appendChild(pallEl);
                        if (cdata.positionsData.length > 0) {
                            var posEl = document.createElement('div');
                            posEl.className = 'obdv-positions';
                            var posText = cdata.positionsData.slice(0, 6)
                                .map(function (p) { return p.label; })
                                .join(' · ');
                            if (cdata.positionsData.length > 6) posText += ' +' + (cdata.positionsData.length - 6) + ' pos';
                            posEl.textContent = posText;
                            csect.appendChild(posEl);
                        }
                        body.appendChild(csect);
                    }
                }

                card.appendChild(body);
                return card;
            }

            function renderCards(term, skipMorph) {
                var now = Date.now();
                var rows = _routes.filter(function (r) {
                    if (_disabledRoutes[r.route]) return false;
                    var isCompleted = _isCompleted(r.status);
                    if (_hideExp && ((r.cptMs && r.cptMs < now) || isCompleted)) return false;
                    if (!term) return true;
                    var t = term.toLowerCase();
                    return r.route.toLowerCase().includes(t) || (_vsmMap[r.route] || '').toLowerCase().includes(t);
                });
                if (skipMorph) {
                    grid.innerHTML = '';
                    rows.forEach(function (r) { grid.appendChild(makeCard(r)); });
                } else {
                    gridWrap.classList.add('updating');
                    setTimeout(function () {
                        grid.innerHTML = '';
                        rows.forEach(function (r) { grid.appendChild(makeCard(r)); });
                        gridWrap.classList.remove('updating');
                    }, 60);
                }
                countEl.textContent = rows.length + ' / ' + _routes.length + ' rotas';
            }

            filterInput.addEventListener('input', function () { renderCards(filterInput.value.trim()); });
            setInterval(function () { if (_routes.length) renderCards(filterInput.value.trim(), true); }, 30000);

            function doFetch() {
                fetchBtn.disabled = true; fetchBtn.textContent = '⏳ Buscando...';
                statusBar.textContent = 'Consultando API OB...';
                grid.innerHTML = '<div style="padding:24px;color:#6e7681;font-size:13px;grid-column:1/-1;text-align:center;"><span style="display:inline-block;width:20px;height:20px;border:2px solid #30363d;border-top-color:#58a6ff;border-radius:50%;animation:obdv-spin 0.8s linear infinite;vertical-align:middle;margin-right:8px;"></span>Carregando rotas OB...</div>';
                _routes = []; _vsmLoading = false; countEl.textContent = ''; vsmStatusEl.textContent = '';

                var node = (nodeInput.value || 'CGH7').trim().toUpperCase();
                var win = apiWindow(_activeWindow);
                var params = ['entity=getOutboundDockView', 'nodeId=' + encodeURIComponent(node), 'startDate=' + win.start, 'endDate=' + win.end,
                    'loadCategories=outboundScheduled,outboundInProgress,outboundReadyToDepart,outboundDeparted,outboundCancelled',
                    'shippingPurposeType=TRANSSHIPMENT,NON-TRANSSHIPMENT,SHIP_WITH_AMAZON'].join('&');

                GM_xmlhttpRequest({
                    method: 'POST', url: BASE + 'ssp/dock/hrz/ob/fetchdata',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
                    data: params, withCredentials: true, timeout: 20000,
                    onload: function (resp) {
                        fetchBtn.disabled = false; fetchBtn.textContent = '🔄 Buscar';
                        if (resp.status !== 200) { statusBar.textContent = '⚠ HTTP ' + resp.status; grid.innerHTML = ''; return; }
                        var data; try { data = JSON.parse(resp.responseText.replace(/^\uFEFF/, '')); } catch (e) { statusBar.textContent = '⚠ JSON parse error'; grid.innerHTML = ''; return; }
                        var aaData = data && data.ret && data.ret.aaData;
                        if (!Array.isArray(aaData)) { statusBar.textContent = '⚠ aaData não encontrado'; grid.innerHTML = ''; return; }

                        var routeMap = {};
                        var _win = _activeWindow || todayWindow(), _winStart = _win.start, _winEnd = _win.end;

                        aaData.forEach(function (item) {
                            var load = item.load || {};
                            var rawRoute = cleanRoute(load.route || item.route || '');
                            if (!rawRoute) return;
                            var cpt = load.criticalPullTime || '', cptMs = parseMs(cpt), status = item.status || load.status || '';
                            if (!cptMs) return;
                            if (cptMs < _winStart || cptMs > _winEnd) return;
                            var _dateKey = (function () { var d = new Date(cptMs); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); })();
                            splitRoute(rawRoute).forEach(function (route) {
                                var key = route + '|' + _dateKey;
                                var vrId = load.vrId || '';
                                var loadGroupId = load.loadGroupId || '';
                                var planId = load.planId || '';
                                var trailerId = (item.trailer && item.trailer.trailerId) || '';
                                if (routeMap[key]) {
                                    var existing = routeMap[key];
                                    if (cptMs && (!existing.cptMs || cptMs < existing.cptMs)) { existing.cpt = cptHHMM(cpt); existing.cptMs = cptMs; }
                                    if (statusPriority(status) < statusPriority(existing.status)) { existing.status = status; }
                                    if (!existing.vrId && vrId) { existing.vrId = vrId; existing.loadGroupId = loadGroupId; existing.planId = planId; existing.trailerId = trailerId; }
                                } else {
                                    routeMap[key] = { route: route, cpt: cptHHMM(cpt), cptMs: cptMs, status: status, vrId: vrId, loadGroupId: loadGroupId, planId: planId, trailerId: trailerId };
                                }
                            });
                        });

                        _routes = Object.values(routeMap).sort(function (a, b) {
                            if (!a.cptMs && !b.cptMs) return a.route.localeCompare(b.route);
                            if (!a.cptMs) return 1; if (!b.cptMs) return -1; return a.cptMs - b.cptMs;
                        });

                        if (!_defaultsApplied) {
                            _defaultsApplied = true;
                            _routes.forEach(function (r) { if (isDefaultDisabled(r.route)) _disabledRoutes[r.route] = true; });
                        }

                        var hasVsm = Object.keys(_vsmMap).length > 0;
                        _vsmLoading = !hasVsm;

                        renderCards(filterInput.value.trim());
                        if (routePanel.classList.contains('open')) buildRoutePanel();

                        var now0 = Date.now();
                        var activeRoutes = _routes.filter(function (r) {
                            return !_isCompleted(r.status) && (!r.cptMs || r.cptMs >= now0);
                        });
                        fetchContainersForRoutes(activeRoutes, node, function () {
                            renderCards(filterInput.value.trim(), true);
                        });

                        var ts = new Date().toLocaleTimeString('pt-BR', { hour12: false });
                        var _wFmt = function (ms) { var d = new Date(ms); var today = new Date(); var isToday = d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear(); var day = isToday ? '' : ((d.getMonth() + 1) + '/' + d.getDate() + ' '); return day + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); };
                        var _winLabel = ' · Janela ' + _wFmt(_winStart) + '→' + _wFmt(_winEnd);

                        if (hasVsm) {
                            var vsmCount0 = Object.keys(_vsmMap).length;
                            statusBar.textContent = 'OB OK (' + ts + ') — ' + _routes.length + ' rotas · ' + vsmCount0 + ' VSMs' + _winLabel;
                            vsmStatusEl.textContent = '✅ ' + vsmCount0 + ' VSMs';
                        } else {
                            statusBar.textContent = 'OB OK (' + ts + ') — ' + _routes.length + ' rotas — Buscando VSM...' + _winLabel;
                            vsmStatusEl.textContent = '⏳ VSM...';

                            fetchVSM(node, function () {
                                _vsmLoading = false;
                                saveVsmCache(_vsmMap);
                                renderCards(filterInput.value.trim(), true);
                                if (routePanel.classList.contains('open')) buildRoutePanel();
                                var ts2 = new Date().toLocaleTimeString('pt-BR', { hour12: false });
                                var vsmCount = Object.keys(_vsmMap).length;
                                statusBar.textContent = 'Atualizado ' + ts2 + ' — ' + _routes.length + ' rotas · ' + vsmCount + ' VSMs' + _winLabel;
                                vsmStatusEl.textContent = vsmCount > 0 ? '✅ ' + vsmCount + ' VSMs' : '⚠ VSM sem dados';
                            });
                        }
                    },
                    onerror: function () { fetchBtn.disabled = false; fetchBtn.textContent = '🔄 Buscar'; statusBar.textContent = '⚠ Erro de rede'; grid.innerHTML = ''; },
                    ontimeout: function () { fetchBtn.disabled = false; fetchBtn.textContent = '🔄 Buscar'; statusBar.textContent = '⚠ Timeout (20s)'; grid.innerHTML = ''; }
                });
            }

            fetchBtn.onclick = doFetch;
            setTimeout(doFetch, 100);

            var _autoRefreshIv = setInterval(function () {
                if (!fetchBtn.disabled && _panel && _panel.style.display !== 'none') doFetch();
            }, 5 * 60 * 1000);
        }

        var detectNode = _SUITE.utils.detectNode;

        function injectToggle() {
            if (document.getElementById('ob-dock-view-toggle')) return;
            var btn = document.createElement('button');
            btn.id = 'ob-dock-view-toggle'; btn.textContent = '🚛 Dock View';
            btn.style.cssText = ['position:fixed;bottom:130px;right:20px;z-index:2147483646', 'background:#1f6feb;color:#fff;border:none;border-radius:8px', 'padding:7px 16px;font-size:11px;font-weight:700;cursor:pointer', 'font-family:"Amazon Ember",Arial,sans-serif;box-shadow:0 4px 12px rgba(31,111,235,0.4)', 'transition:background 0.15s,transform 0.1s'].join(';');
            btn.onmouseover = function () { btn.style.background = '#388bfd'; btn.style.transform = 'translateY(-1px)'; };
            btn.onmouseout = function () { btn.style.background = '#1f6feb'; btn.style.transform = ''; };
            btn.onclick = function () {
                buildPanel();
                _panel.style.display = 'flex';
                _panel.classList.add('open');
            };
            document.body.appendChild(btn);
        }

        if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', injectToggle); }
        else { setTimeout(injectToggle, 500); }

    })();

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

            // --- Auto-scroll logic ---
            var autoScrollInterval = null;
            var autoTimer = null;
            var scrollDirection = 1; // 1 = down, -1 = up

            function stopAutoScroll() {
                if (autoScrollInterval) {
                    clearInterval(autoScrollInterval);
                    autoScrollInterval = null;
                }
                if (autoTimer) {
                    clearTimeout(autoTimer);
                    autoTimer = null;
                }
            }

            function startAutoScroll() {
                stopAutoScroll();
                autoScrollInterval = setInterval(function () {
                    var bodyEl = document.getElementById('tl-prod-body');
                    if (!bodyEl || !popupOpen) {
                        stopAutoScroll();
                        return;
                    }

                    var maxScroll = bodyEl.scrollHeight - bodyEl.clientHeight;

                    // Limit scroll to the 25th row if it exists
                    var rows = bodyEl.querySelectorAll('tbody tr');
                    if (rows.length >= 25) {
                        var row25 = rows[24];
                        // Calculate scroll position to keep the 25th row visible at the bottom
                        var limit = row25.offsetTop + row25.offsetHeight - bodyEl.clientHeight + 10; // +10 for a bit of padding
                        if (limit < maxScroll) maxScroll = limit;
                    }

                    if (maxScroll <= 5) { // No need to scroll if it's too small
                        stopAutoScroll();
                        return;
                    }

                    bodyEl.scrollTop += scrollDirection; // Slow scroll

                    if (bodyEl.scrollTop >= maxScroll) {
                        scrollDirection = -1;
                    } else if (bodyEl.scrollTop <= 0) {
                        scrollDirection = 1;
                    }
                }, 35);
            }

            function resetAutoScrollTimer(delay) {
                stopAutoScroll();
                if (!popupOpen) return;
                autoTimer = setTimeout(function () {
                    if (popupOpen) startAutoScroll();
                }, delay || 15000);
            }

            function handleUserInteraction() {
                if (!popupOpen) return;
                resetAutoScrollTimer(15000);
            }


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
                    resetAutoScrollTimer(5000);
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
                stopAutoScroll();
            }

            popup.addEventListener('click', function (e) { e.stopPropagation(); });
            popup.addEventListener('mousedown', function (e) { e.stopPropagation(); handleUserInteraction(); });
            popup.addEventListener('mousemove', handleUserInteraction);
            popup.addEventListener('wheel', handleUserInteraction);

            fab.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); });
            fab.addEventListener('click', function (e) {
                e.preventDefault(); e.stopPropagation();
                if (popupOpen) closePopup(); else openPopup();
            });
            overlay.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); closePopup(); });
            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape' && popupOpen) closePopup();
                else if (popupOpen) handleUserInteraction();
            });

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
