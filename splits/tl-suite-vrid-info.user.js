// ==UserScript==
// @name         TL VRID Info
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

})();
