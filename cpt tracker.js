// ==UserScript==
// @name         OB Dock View — Route & CPT Explorer
// @namespace    http://tampermonkey.net/
// @version      3.8.5
// @description  Rotas OB com CPT + VSM integrado + posições/pallets por rota (Container Viewer)
// @author       emanunec
// @match        https://trans-logistics.amazon.com/ssp/dock/hrz/ob*
// @match        https://trans-logistics.amazon.com/*
// @match        https://stem-na.corp.amazon.com/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      trans-logistics.amazon.com
// @connect      stem-na.corp.amazon.com
// ==/UserScript==

(function () {
    'use strict';

    var BASE = location.hostname.includes('-fe.') ? 'https://trans-logistics-fe.amazon.com/'
             : location.hostname.includes('-eu.') ? 'https://trans-logistics-eu.amazon.com/'
             : 'https://trans-logistics.amazon.com/';

    var isStemPage = location.hostname === 'stem-na.corp.amazon.com';

    // ── Token capture (trans-logistics only) ──────────────────────────────────
    var _csrfToken = '';
    if (!isStemPage) {
        (function patchXhr() {
            var oOpen = XMLHttpRequest.prototype.open;
            var oSet  = XMLHttpRequest.prototype.setRequestHeader;
            var oSend = XMLHttpRequest.prototype.send;
            XMLHttpRequest.prototype.open = function (m, u) { this._url = u || ''; return oOpen.apply(this, arguments); };
            XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
                if (/anti-csrftoken-a2z/i.test(name) && value && value.length > 10) _csrfToken = value;
                return oSet.apply(this, arguments);
            };
            XMLHttpRequest.prototype.send = function (body) {
                if (!_csrfToken && body && typeof body === 'string' && body.includes('nti-csrftoken-a2z=')) {
                    try { var ex = decodeURIComponent(body.split('nti-csrftoken-a2z=')[1].split('&json')[0]); if (ex && ex.length > 10) _csrfToken = ex; } catch (e) {}
                }
                return oSend.apply(this, arguments);
            };
        })();
    }

    // ════════════════════════════════════════════════════════════════════════════
    // STEM PAGE LOGIC — roda na popup oculta do stem-na
    // ════════════════════════════════════════════════════════════════════════════
    if (isStemPage) {
        var LSKEY_RESULT = 'obdv_vsm_result';
        var LSKEY_TS     = 'obdv_vsm_ts';

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
                + 'var _ts="'  + LSKEY_TS    + '";'
                + 'var _done=false;'
                + 'var _payload=' + payload + ';'
                + 'var _oFetch=window.fetch;'
                + 'window.fetch=function(input,init){'
                +   'var hdrs=init&&init.headers||{};'
                +   'var tok=typeof hdrs.get==="function"?hdrs.get("anti-csrftoken-a2z"):hdrs["anti-csrftoken-a2z"];'
                +   'if(!tok){Object.keys(hdrs).forEach(function(k){if(/anti-csrftoken/i.test(k))tok=hdrs[k];});}'
                +   'if(tok&&tok.length>10&&!_done){'
                +     '_done=true;'
                +     '_oFetch("https://stem-na.corp.amazon.com/sortcenter/equipmentmanagement/graphql",{'
                +       'method:"POST",credentials:"include",'
                +       'headers:{"Content-Type":"application/json","anti-csrftoken-a2z":tok,"Accept":"application/json"},'
                +       'body:JSON.stringify(_payload)'
                +     '}).then(function(r){return r.text().then(function(t){'
                +       'localStorage.setItem(_res,JSON.stringify({status:r.status,body:t,ts:Date.now()}));'
                +       'localStorage.setItem(_ts,Date.now());'
                +     '});}).catch(function(e){'
                +       'localStorage.setItem(_res,JSON.stringify({status:0,body:String(e),ts:Date.now()}));'
                +     '});'
                +   '}'
                +   'return _oFetch.apply(this,arguments);'
                + '};'
                + 'var _oSet=XMLHttpRequest.prototype.setRequestHeader;'
                + 'XMLHttpRequest.prototype.setRequestHeader=function(n,v){'
                +   'if(/anti-csrftoken/i.test(n)&&v&&v.length>10&&!_done){'
                +     '_done=true;'
                +     'var _x=new XMLHttpRequest();'
                +     '_x.open("POST","https://stem-na.corp.amazon.com/sortcenter/equipmentmanagement/graphql");'
                +     '_x.setRequestHeader("Content-Type","application/json");'
                +     '_x.setRequestHeader("anti-csrftoken-a2z",v);'
                +     '_x.withCredentials=true;'
                +     '_x.onload=function(){localStorage.setItem(_res,JSON.stringify({status:_x.status,body:_x.responseText,ts:Date.now()}));localStorage.setItem(_ts,Date.now());};'
                +     '_x.onerror=function(){localStorage.setItem(_res,JSON.stringify({status:0,body:"XHR error",ts:Date.now()}));};'
                +     '_x.send(JSON.stringify(_payload));'
                +   '}'
                +   'return _oSet.apply(this,arguments);'
                + '};'
                + '})();';
            var s = document.createElement('script');
            s.textContent = code;
            (document.head || document.documentElement).appendChild(s);
            try { s.remove(); } catch(e) {}
        }

        try { localStorage.removeItem(LSKEY_RESULT); } catch(e) {}
        injectPageScript();

        var attempts = 0;
        var iv = setInterval(function() {
            attempts++;
            try {
                var raw = localStorage.getItem(LSKEY_RESULT);
                if (raw) {
                    var parsed = JSON.parse(raw);
                    if (parsed && parsed.ts && parsed.ts > Date.now() - 30000) {
                        clearInterval(iv);
                        GM_setValue('obdv_vsm_body',   parsed.body   || '');
                        GM_setValue('obdv_vsm_status',  parsed.status === 200 ? 'done' : 'error');
                        GM_setValue('obdv_vsm_ts',      Date.now());
                        try { localStorage.removeItem(LSKEY_RESULT); } catch(e) {}
                        setTimeout(function(){ try { window.close(); } catch(e) {} }, 300);
                        return;
                    }
                }
            } catch(e) {}
            if (attempts >= 200) { // 40s
                clearInterval(iv);
                GM_setValue('obdv_vsm_status', 'error');
                GM_setValue('obdv_vsm_body',   'Timeout: token não capturado');
                GM_setValue('obdv_vsm_ts',     Date.now());
                try { window.close(); } catch(e) {}
            }
        }, 200);
        return; // ← fim da lógica STEM, não executa nada mais
    }

    // ════════════════════════════════════════════════════════════════════════════
    // TRANS-LOGISTICS PAGE LOGIC
    // ════════════════════════════════════════════════════════════════════════════

    // ── Helpers ───────────────────────────────────────────────────────────────
    function apiWindow(customWin) {
        if (customWin) {
            return { start: customWin.start - 3 * 3600000, end: customWin.end + 3 * 3600000 };
        }
        var now = new Date();
        var dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0).getTime();
        var dayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2, 23, 30, 0).getTime();
        return { start: dayStart, end: dayEnd };
    }

    function todayWindow() {
        var now = new Date();
        var start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).getTime();
        var end   = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 23, 30, 0).getTime();
        return { start: start, end: end };
    }

    var MONTHS = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
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
            var allNodes = parts.every(function(p) { return /^[A-Z]{2,4}\d[A-Z0-9]{0,4}$/i.test(p); });
            if (allNodes) return parts.map(function(p) { return p.toUpperCase(); });
        }
        return [route];
    }

    // ── VSM Cache (1 week via GM_setValue) ───────────────────────────────────
    var VSM_CACHE_KEY = 'obdv_vsm_cache';
    var VSM_CACHE_TTL = 7 * 24 * 3600 * 1000;

    function loadVsmCache() {
        try {
            var raw = GM_getValue(VSM_CACHE_KEY, '');
            if (!raw) return {};
            var parsed = JSON.parse(raw);
            if (!parsed || Date.now() - (parsed.ts || 0) > VSM_CACHE_TTL) return {};
            return parsed.map || {};
        } catch(e) { return {}; }
    }

    function saveVsmCache(map) {
        try { GM_setValue(VSM_CACHE_KEY, JSON.stringify({ ts: Date.now(), map: map })); } catch(e) {}
    }

    // ── Status config ─────────────────────────────────────────────────────────
    var STATUS_MAP = {
        'outboundscheduled':      { label: 'Agendado',        color: '#64748b', bg: 'rgba(100,116,139,0.15)' },
        'outboundinprogress':     { label: 'Em carregamento', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)'  },
        'outboundreadytodepart':  { label: 'Em doca',         color: '#eab308', bg: 'rgba(234,179,8,0.15)'   },
        'outbounddeparted':       { label: 'Partiu',          color: '#94a3b8', bg: 'rgba(148,163,184,0.12)' },
        'outboundcompleted':      { label: 'Finalizado',      color: '#22c55e', bg: 'rgba(34,197,94,0.15)'   },
        'outboundcancelled':      { label: 'Cancelado',       color: '#ef4444', bg: 'rgba(239,68,68,0.15)'   },
        'scheduled':              { label: 'Agendado',        color: '#64748b', bg: 'rgba(100,116,139,0.15)' },
        'trailerattached':        { label: 'Em espera',       color: '#38bdf8', bg: 'rgba(56,189,248,0.15)'  },
        'loadinginprogress':      { label: 'Em carregamento', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)'  },
        'finishedloading':        { label: 'Em doca',         color: '#eab308', bg: 'rgba(234,179,8,0.15)'   },
        'completed':              { label: 'Finalizado',      color: '#22c55e', bg: 'rgba(34,197,94,0.15)'   },
        'readytodepart':          { label: 'Em doca',         color: '#eab308', bg: 'rgba(234,179,8,0.15)'   },
        'readyforloading':        { label: 'Em doca',         color: '#eab308', bg: 'rgba(234,179,8,0.15)'   },
        'outboundreadyforloading':{ label: 'Em doca',         color: '#eab308', bg: 'rgba(234,179,8,0.15)'   },
        'departed':               { label: 'Partiu',          color: '#94a3b8', bg: 'rgba(148,163,184,0.12)' },
        'cancelled':              { label: 'Cancelado',       color: '#ef4444', bg: 'rgba(239,68,68,0.15)'   },
    };
    function getStatus(raw) {
        var key = (raw || '').toLowerCase().replace(/[_\s]/g, '');
        return STATUS_MAP[key] || { label: raw || '—', color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' };
    }

    var STATUS_PRIORITY = (function(){
        var p={};
        ['loadinginprogress','outboundinprogress'].forEach(function(k){p[k]=1;});
        ['trailerattached'].forEach(function(k){p[k]=2;});
        ['readytodepart','outboundreadytodepart','readyforloading','outboundreadyforloading','finishedloading'].forEach(function(k){p[k]=3;});
        ['completed','outboundcompleted'].forEach(function(k){p[k]=4;});
        ['scheduled','outboundscheduled'].forEach(function(k){p[k]=5;});
        ['departed','outbounddeparted'].forEach(function(k){p[k]=6;});
        ['cancelled','outboundcancelled'].forEach(function(k){p[k]=7;});
        return p;
    })();
    function statusPriority(raw){
        var key=(raw||'').toLowerCase().replace(/_/g,'');
        return STATUS_PRIORITY[key]||99;
    }

    // ── Module-level VSM map ──────────────────────────────────────────────────
    var _vsmMap = loadVsmCache();

    // ── Container positions ───────────────────────────────────────────────────
    var _containerMap = {};
    var _containerFetchQueue = [];
    var _containerFetchActive = 0;
    var _containerFetchGen = 0;
    var MAX_CONTAINER_CONCURRENT = 3;

    function _isValidContainerLabel(label) {
        if (!label) return false;
        var vp = ['BAG', 'PALLET', 'GAYLORD', 'XBRA'];
        var u = label.toUpperCase();
        return vp.some(function(p) { return u.indexOf(p) === 0; });
    }

    // ── Compara dois timestamps por dia calendário (local) ────────────────────
    function _sameDay(msA, msB) {
        var a = new Date(msA), b = new Date(msB);
        return a.getFullYear() === b.getFullYear() &&
               a.getMonth()    === b.getMonth()    &&
               a.getDate()     === b.getDate();
    }

    // Prioriza scheduleDepartureTime para comparação de CPT do pallet
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

        // Busca stackFilter recursivamente em todos os descendentes do pallet
        function _findStackFilter(node, vsmSet) {
            if (!node) return false;
            var c = node.container;
            if (c && c.stackFilter) {
                // achou um stackFilter — verifica se bate com a rota
                return vsmSet[c.stackFilter.toUpperCase()] === true;
            }
            var children = node.childNodes || [];
            for (var i = 0; i < children.length; i++) {
                if (_findStackFilter(children[i], vsmSet)) return true;
            }
            return false;
        }

        // Verifica se um pallet (ou algum descendente) tem stackFilter que bate com a rota
        // Se nenhum descendente tiver stackFilter → não mostra (não usa fallback de CPT)
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
            vsmRaw.split(',').forEach(function(v) {
                var t = v.trim().toUpperCase();
                if (t) vsmSet[t] = true;
            });
            vsmSet[routeCode.toUpperCase()] = true;

            if (!_hasAnyStackFilter(palletNode)) return false; // sem stackFilter → não mostra
            return _findStackFilter(palletNode, vsmSet);
        }

        nodes.forEach(function(node) {
            if (!node.container || !node.container.label) return;

            if (node.container.contType === 'STACKING_AREA') {
                // Filtra por data da área (se existir)
                var areaTime = _extractContainerTimeMs(node.container);
                if (areaTime !== null && routeCptMs && !_sameDay(areaTime, routeCptMs)) return;

                // Conta pallets dentro desta stacking area que pertencem à rota
                var areaCount = 0;
                (node.childNodes || []).forEach(function(child) {
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
                return; // não processa a área como pallet direto
            }

            // Pallet solto (não dentro de STACKING_AREA)
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
            (function(t) {
                var params = [
                    'entity=getContainerDetailsForLoadGroupId',
                    'nodeId='       + encodeURIComponent(t.nodeId),
                    'loadGroupId='  + encodeURIComponent(t.loadGroupId),
                    'planId='       + encodeURIComponent(t.planId),
                    'vrId='         + encodeURIComponent(t.vrId),
                    'status=stacked',
                    'trailerId='    + encodeURIComponent(t.trailerId),
                    'trailerNumber='
                ].join('&');
                var hdrs = { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' };
                if (_csrfToken) hdrs['anti-csrftoken-a2z'] = _csrfToken;
                GM_xmlhttpRequest({
                    method: 'POST', url: BASE + 'ssp/dock/hrz/ob/fetchdata',
                    headers: hdrs, data: params, withCredentials: true, timeout: 15000,
                    onload: function(resp) {
                        _containerFetchActive--;
                        if (gen === _containerFetchGen) {
                            try {
                                var d = JSON.parse(resp.responseText.replace(/^\uFEFF/, ''));
                                if (d.ok && d.ret && d.ret.aaData && d.ret.aaData.ROOT_NODE) {
                                    _containerMap[t.routeKey] = _analyzeContainerNodes(d.ret.aaData.ROOT_NODE, t.cptMs || null, t.route);
                                } else {
                                    _containerMap[t.routeKey] = null;
                                }
                            } catch(e) { _containerMap[t.routeKey] = null; }
                            onProgress();
                        }
                        _processContainerQueue(gen, onProgress);
                    },
                    onerror:   function() { _containerFetchActive--; if(gen===_containerFetchGen){_containerMap[t.routeKey]=null;onProgress();} _processContainerQueue(gen,onProgress); },
                    ontimeout: function() { _containerFetchActive--; if(gen===_containerFetchGen){_containerMap[t.routeKey]=null;onProgress();} _processContainerQueue(gen,onProgress); }
                });
            })(task);
        }
    }

    function fetchContainersForRoutes(routes, nodeId, onProgress) {
        _containerFetchGen++;
        var gen = _containerFetchGen;
        _containerFetchQueue = [];
        _containerMap = {};
        routes.forEach(function(r) {
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

    // ── VSM popup mechanism ───────────────────────────────────────────────────
    var _vsmPending = false;

    function fetchVSM(node, onDone) {
        if (_vsmPending) { onDone(); return; }
        _vsmPending = true;

        GM_setValue('obdv_vsm_node',   node);
        GM_setValue('obdv_vsm_status', '');
        GM_setValue('obdv_vsm_body',   '');
        GM_setValue('obdv_vsm_ts',     0);

        var popupUrl = 'https://stem-na.corp.amazon.com/node/' + node + '/equipment';
        var win = null;
        try { win = window.open(popupUrl, 'obdv_vsm_popup', 'width=1,height=1,left=-300,top=-300,toolbar=no,menubar=no,scrollbars=no,resizable=no'); } catch(e) {}

        if (!win) {
            console.warn('[OBDockView] VSM popup bloqueado');
            _vsmPending = false;
            onDone();
            return;
        }

        var start = Date.now();
        var iv = setInterval(function() {
            var status = GM_getValue('obdv_vsm_status', '');
            var ts     = GM_getValue('obdv_vsm_ts', 0);
            if ((status === 'done' || status === 'error') && ts > start) {
                clearInterval(iv);
                try { win.close(); } catch(e) {}
                _vsmPending = false;
                if (status === 'done') {
                    try {
                        var body = GM_getValue('obdv_vsm_body', '');
                        var json = JSON.parse(body);
                        var arr  = Array.isArray(json) ? json : [json];
                        var vsms = (arr[0] && arr[0].data && arr[0].data.visualSortationMarkers) || [];
                        _vsmMap = {};
                        vsms.forEach(function(entry) {
                            var sf = (entry.stackingFilter || '').trim();
                            if (!sf) return;
                            var markers = (entry.visualMarkers || []);
                            if (markers.length) {
                                _vsmMap[sf] = markers.map(function(v){ return v.visualMarker; }).join(', ');
                            }
                        });
                        console.log('[OBDockView] VSM loaded:', Object.keys(_vsmMap).length, 'rotas');
                    } catch(e) {
                        console.warn('[OBDockView] VSM parse error:', e.message);
                    }
                }
                onDone();
            } else if (Date.now() - start > 45000) {
                clearInterval(iv);
                try { win.close(); } catch(e) {}
                _vsmPending = false;
                console.warn('[OBDockView] VSM popup timeout');
                onDone();
            }
        }, 200);
    }

    // ── Inject CSS once ───────────────────────────────────────────────────────
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

    // ── UI ────────────────────────────────────────────────────────────────────
    var _panel = null;

    function buildPanel() {
        if (_panel) { _panel.style.display = 'flex'; return; }
        injectStyles();

        _panel = document.createElement('div');
        _panel.style.cssText = [
            'position:fixed;top:0;left:0;width:100vw;height:100vh',
            'background:#0d1117;border-radius:0',
            'border:1px solid #21262d;box-shadow:0 16px 48px rgba(0,0,0,.9)',
            'display:flex;flex-direction:column;overflow:hidden;resize:both',
            'font-family:"Amazon Ember",Arial,sans-serif;z-index:2147483647'
        ].join(';');

        // Header
        var hdr = document.createElement('div');
        hdr.style.cssText = 'display:flex;align-items:center;gap:10px;padding:12px 16px;background:#161b22;border-bottom:1px solid #21262d;flex-shrink:0;cursor:grab;user-select:none;';
        hdr.innerHTML = '<span style="font-size:16px;font-weight:900;color:#f0f6ff;flex:1;letter-spacing:0.5px;">🚛 OB — Rotas, CPT &amp; VSM</span>';
        var closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        closeBtn.style.cssText = 'background:none;border:none;color:#6e7681;cursor:pointer;font-size:20px;padding:0 4px;line-height:1;transition:color 0.15s;';
        closeBtn.onmouseover=function(){closeBtn.style.color='#f85149';};
        closeBtn.onmouseout=function(){closeBtn.style.color='#6e7681';};
        closeBtn.onclick=function(){ _panel.style.display='none'; };
        hdr.appendChild(closeBtn);
        var dX=0,dY=0,dragging=false;
        hdr.addEventListener('mousedown',function(e){if(e.target.closest('button'))return;dragging=true;var r=_panel.getBoundingClientRect();_panel.style.position='fixed';_panel.style.top=r.top+'px';_panel.style.left=r.left+'px';_panel.style.width=r.width+'px';_panel.style.height=r.height+'px';dX=e.clientX-r.left;dY=e.clientY-r.top;e.preventDefault();});
        document.addEventListener('mousemove',function(e){if(!dragging)return;_panel.style.left=(e.clientX-dX)+'px';_panel.style.top=(e.clientY-dY)+'px';});
        document.addEventListener('mouseup',function(){dragging=false;});

        // Toolbar
        var toolbar = document.createElement('div');
        toolbar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 14px;background:#0d1117;border-bottom:1px solid #21262d;flex-shrink:0;flex-wrap:wrap;';

        var nodeInput = document.createElement('input');
        nodeInput.value = detectNode();
        nodeInput.style.cssText = 'background:#161b22;border:1px solid #30363d;color:#f0f6ff;border-radius:6px;padding:5px 9px;font-size:11px;width:64px;font-family:monospace;outline:none;';

        var fetchBtn = document.createElement('button');
        fetchBtn.textContent = '🔄 Buscar';
        fetchBtn.style.cssText = 'padding:5px 14px;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;background:#1f6feb;color:#fff;white-space:nowrap;transition:background 0.15s;';
        fetchBtn.onmouseover=function(){fetchBtn.style.background='#388bfd';};
        fetchBtn.onmouseout=function(){fetchBtn.style.background='#1f6feb';};

        var filterInput = document.createElement('input');
        filterInput.placeholder = '🔍 Filtrar rota ou VSM...';
        filterInput.style.cssText = 'background:#161b22;border:1px solid #30363d;color:#f0f6ff;border-radius:6px;padding:5px 10px;font-size:11px;flex:1;min-width:140px;font-family:monospace;outline:none;';

        var hideExpiredBtn = document.createElement('button');
        hideExpiredBtn.textContent = '👁 Mostrar expirados';
        var _hideExp = true;
        hideExpiredBtn.style.cssText = 'padding:5px 10px;border:1px solid #58a6ff;border-radius:6px;font-size:10px;font-weight:700;cursor:pointer;background:#161b22;color:#58a6ff;white-space:nowrap;';
        hideExpiredBtn.onclick=function(){
            _hideExp=!_hideExp;
            hideExpiredBtn.textContent=_hideExp?'👁 Mostrar expirados':'🙈 Ocultar expirados';
            hideExpiredBtn.style.color=_hideExp?'#58a6ff':'#8b949e';
            hideExpiredBtn.style.borderColor=_hideExp?'#58a6ff':'#30363d';
            renderCards(filterInput.value.trim());
        };

        var routesPanelBtn = document.createElement('button');
        routesPanelBtn.textContent = '⚙ Rotas';
        routesPanelBtn.style.cssText = 'padding:5px 10px;border:1px solid #30363d;border-radius:6px;font-size:10px;font-weight:700;cursor:pointer;background:#161b22;color:#8b949e;white-space:nowrap;';
        routesPanelBtn.onmouseover=function(){routesPanelBtn.style.color='#f0f6ff';routesPanelBtn.style.borderColor='#58a6ff';};
        routesPanelBtn.onmouseout=function(){if(!routePanel.classList.contains('open')){routesPanelBtn.style.color='#8b949e';routesPanelBtn.style.borderColor='#30363d';}};

        var calBtn = document.createElement('button');
        calBtn.textContent = '📅 Janela';
        calBtn.style.cssText = 'padding:5px 10px;border:1px solid #30363d;border-radius:6px;font-size:10px;font-weight:700;cursor:pointer;background:#161b22;color:#8b949e;white-space:nowrap;';
        calBtn.onmouseover=function(){calBtn.style.color='#f0f6ff';calBtn.style.borderColor='#58a6ff';};
        calBtn.onmouseout=function(){if(!calPanel.classList.contains('open')){calBtn.style.color='#8b949e';calBtn.style.borderColor='#30363d';}};

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

        // Routes drawer — fechado por padrão
        var routePanel = document.createElement('div');
        routePanel.style.cssText = 'flex-shrink:0;background:#0d1117;border-bottom:1px solid #21262d;overflow:hidden;max-height:0;transition:max-height 0.25s ease;';
        var routePanelInner = document.createElement('div');
        routePanelInner.style.cssText = 'padding:10px 16px;display:flex;flex-wrap:wrap;gap:6px;max-height:180px;overflow-y:auto;';
        routePanel.appendChild(routePanelInner);

        var DEFAULT_DISABLED = ['XCV9','GRU9','GRU5','SBKP','SBGR','XBRA','XBS1','ELP8','CNF1','CNF5','GIG1','GIG2','POA1'];
        var _disabledRoutes = {};
        function isDefaultDisabled(route) {
            if (!route) return false;
            if (/^E/i.test(route)) return true;
            return DEFAULT_DISABLED.indexOf(route.toUpperCase()) !== -1;
        }
        function buildRoutePanel() {
            routePanelInner.innerHTML = '';
            if (!_routes.length) { routePanelInner.innerHTML='<span style="font-size:11px;color:#6e7681;">Faça uma busca primeiro.</span>'; return; }
            var allBtn=document.createElement('button'); allBtn.textContent='Todos';
            allBtn.style.cssText='padding:3px 10px;border:1px solid #388bfd;border-radius:20px;font-size:10px;font-weight:700;cursor:pointer;background:rgba(56,139,253,0.15);color:#58a6ff;';
            allBtn.onclick=function(){_disabledRoutes={};buildRoutePanel();renderCards(filterInput.value.trim());};
            routePanelInner.appendChild(allBtn);
            var noneBtn=document.createElement('button'); noneBtn.textContent='Nenhum';
            noneBtn.style.cssText='padding:3px 10px;border:1px solid #30363d;border-radius:20px;font-size:10px;font-weight:700;cursor:pointer;background:#161b22;color:#6e7681;';
            noneBtn.onclick=function(){_routes.forEach(function(r){_disabledRoutes[r.route]=true;});buildRoutePanel();renderCards(filterInput.value.trim());};
            routePanelInner.appendChild(noneBtn);
            _routes.forEach(function(r){
                var en=!_disabledRoutes[r.route];
                var vsm=_vsmMap[r.route]||'';
                var chip=document.createElement('button');
                chip.textContent=r.route+(vsm?' · '+vsm:'');
                chip.style.cssText='padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700;cursor:pointer;border:1px solid '+(en?'#388bfd':'#30363d')+';background:'+(en?'rgba(56,139,253,0.15)':'#161b22')+';color:'+(en?'#58a6ff':'#6e7681')+';transition:all 0.12s;white-space:nowrap;';
                chip.onclick=function(){if(_disabledRoutes[r.route])delete _disabledRoutes[r.route];else _disabledRoutes[r.route]=true;buildRoutePanel();renderCards(filterInput.value.trim());};
                routePanelInner.appendChild(chip);
            });
        }
        routesPanelBtn.onclick=function(){
            var isOpen=routePanel.style.maxHeight!=='0px'&&routePanel.style.maxHeight!=='';
            if(isOpen){routePanel.style.maxHeight='0';routePanel.classList.remove('open');routesPanelBtn.style.color='#8b949e';routesPanelBtn.style.borderColor='#30363d';}
            else{buildRoutePanel();routePanel.style.maxHeight='200px';routePanel.classList.add('open');routesPanelBtn.style.color='#58a6ff';routesPanelBtn.style.borderColor='#58a6ff';}
        };
        // Apenas popula o painel, não abre
        setTimeout(function(){ buildRoutePanel(); }, 0);

        // ── Calendar / Window Panel ─────────────────────────────────────────────
        var calPanel = document.createElement('div');
        calPanel.style.cssText = 'flex-shrink:0;background:#0d1117;border-bottom:1px solid #21262d;overflow:visible;max-height:0;transition:max-height 0.3s ease;';
        var calInner = document.createElement('div');
        calInner.style.cssText = 'padding:8px 14px;display:flex;align-items:center;gap:8px;';
        calPanel.appendChild(calInner);

        if(!document.getElementById('obdv-cal-styles')){
            var _calStyle=document.createElement('style'); _calStyle.id='obdv-cal-styles';
            _calStyle.textContent=
                '.obdv-dc{background:#161b22;border:1px solid #21262d;border-radius:8px;padding:6px 12px;cursor:pointer;transition:border-color .15s;min-width:112px;user-select:none;display:inline-flex;flex-direction:column;gap:2px;}'
               +'.obdv-dc:hover{border-color:#30363d;}'
               +'.obdv-dc.active{border-color:#388bfd!important;box-shadow:0 0 0 2px rgba(56,139,253,.15);}'
               +'.obdv-dc-lbl{font-size:9px;font-weight:700;color:#4b5563;letter-spacing:1px;text-transform:uppercase;}'
               +'.obdv-dc-date{font-size:12px;font-weight:800;color:#f0f6ff;font-family:monospace;}'
               +'.obdv-dc-time{font-size:11px;color:#58a6ff;font-family:monospace;font-weight:700;}'
               +'.obdv-pop{position:fixed;z-index:2147483647;background:#1c2128;border:1px solid #30363d;border-radius:10px;width:264px;box-shadow:0 8px 32px rgba(0,0,0,.8);overflow:hidden;display:none;}'
               +'.obdv-pop-hdr{display:flex;align-items:center;justify-content:space-between;padding:10px 12px 8px;border-bottom:1px solid #21262d;}'
               +'.obdv-nav{background:none;border:1px solid #30363d;color:#8b949e;font-size:14px;cursor:pointer;padding:2px 9px;border-radius:6px;line-height:1.4;}'
               +'.obdv-nav:hover{color:#f0f6ff;border-color:#58a6ff;}'
               +'.obdv-mon-lbl{font-size:12px;font-weight:700;color:#f0f6ff;font-family:monospace;}'
               +'.obdv-grid-wrap{padding:8px;}'
               +'.obdv-dow{display:grid;grid-template-columns:repeat(7,1fr);margin-bottom:4px;}'
               +'.obdv-dow span{text-align:center;font-size:10px;font-weight:700;color:#4b5563;padding:2px 0;}'
               +'.obdv-days{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;}'
               +'.obdv-d{text-align:center;padding:6px 2px;font-size:12px;font-weight:600;color:#8b949e;border-radius:6px;cursor:pointer;user-select:none;}'
               +'.obdv-d:hover:not(.obdv-other):not(.obdv-disabled){background:#21262d;color:#f0f6ff;}'
               +'.obdv-other{color:#2d333b!important;pointer-events:none;}'
               +'.obdv-disabled{color:#2d333b!important;pointer-events:none;}'
               +'.obdv-sun{color:#ef4444;}'
               +'.obdv-sat{color:#818cf8;}'
               +'.obdv-today{background:#21262d;color:#f0f6ff;}'
               +'.obdv-in-range{background:rgba(31,111,235,.18);color:#a5c8ff!important;border-radius:0;}'
               +'.obdv-rs{background:#1f6feb!important;color:#fff!important;border-radius:6px 0 0 6px;}'
               +'.obdv-re{background:#1f6feb!important;color:#fff!important;border-radius:0 6px 6px 0;}'
               +'.obdv-sole{background:#1f6feb!important;color:#fff!important;border-radius:6px;}'
               +'.obdv-time-row{border-top:1px solid #21262d;padding:8px 12px;display:flex;align-items:center;gap:8px;}'
               +'.obdv-time-lbl{font-size:10px;color:#6e7681;flex:1;}'
               +'.obdv-time-inp{background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#58a6ff;font-family:monospace;font-size:12px;font-weight:700;padding:4px 8px;outline:none;width:76px;}'
               +'.obdv-ok{background:#1f6feb;color:#fff;border:none;border-radius:6px;padding:5px 12px;font-size:10px;font-weight:700;cursor:pointer;}';
            document.head.appendChild(_calStyle);
        }

        var _DOW = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
        var _MON = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

        function _localDate(offsetDays) {
            var d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()+offsetDays); return d;
        }
        function _makeS(offsetDays, hh, mm) {
            var d = _localDate(offsetDays);
            return {y:d.getFullYear(), mo:d.getMonth(), d:d.getDate(), hh:hh, mm:mm};
        }
        function _toMs(s) { return new Date(s.y, s.mo, s.d, s.hh, s.mm).getTime(); }
        function _fmt(s)  { return ('0'+s.d).slice(-2)+'/'+('0'+(s.mo+1)).slice(-2)+'/'+s.y; }
        function _fmtT(s) { return ('0'+s.hh).slice(-2)+':'+('0'+s.mm).slice(-2); }

        function _allowed(y,mo,d){ var t=new Date(y,mo,d).getTime(); return t===_localDate(0).getTime()||t===_localDate(1).getTime(); }

        var _cs = { start:_makeS(0,0,0), end:_makeS(1,23,30), which:null,
                    viewY:new Date().getFullYear(), viewMo:new Date().getMonth() };

        function _makeCard(lbl){
            var el=document.createElement('div'); el.className='obdv-dc';
            var lb=document.createElement('div'); lb.className='obdv-dc-lbl'; lb.textContent=lbl;
            var dd=document.createElement('div'); dd.className='obdv-dc-date';
            var dt=document.createElement('div'); dt.className='obdv-dc-time';
            el.appendChild(lb); el.appendChild(dd); el.appendChild(dt);
            return {el:el,dd:dd,dt:dt};
        }
        var _sc=_makeCard('Início'), _ec=_makeCard('Fim');

        function _refreshCards(){
            _sc.dd.textContent=_fmt(_cs.start); _sc.dt.textContent=_fmtT(_cs.start);
            _ec.dd.textContent=_fmt(_cs.end);   _ec.dt.textContent=_fmtT(_cs.end);
            _sc.el.classList.toggle('active',_cs.which==='start');
            _ec.el.classList.toggle('active',_cs.which==='end');
        }

        var _pop = document.createElement('div'); _pop.className='obdv-pop';

        var _ph=document.createElement('div'); _ph.className='obdv-pop-hdr';
        var _pv=document.createElement('button'); _pv.className='obdv-nav'; _pv.textContent='‹';
        var _ml=document.createElement('span');   _ml.className='obdv-mon-lbl';
        var _pn=document.createElement('button'); _pn.className='obdv-nav'; _pn.textContent='›';
        _ph.appendChild(_pv); _ph.appendChild(_ml); _ph.appendChild(_pn);

        var _gw=document.createElement('div'); _gw.className='obdv-grid-wrap';
        var _dr=document.createElement('div'); _dr.className='obdv-dow';
        _DOW.forEach(function(d){var s=document.createElement('span');s.textContent=d;_dr.appendChild(s);});
        var _dg=document.createElement('div'); _dg.className='obdv-days';
        _gw.appendChild(_dr); _gw.appendChild(_dg);

        var _tr=document.createElement('div');  _tr.className='obdv-time-row';
        var _tl=document.createElement('span'); _tl.className='obdv-time-lbl';
        var _ti=document.createElement('input');_ti.type='time'; _ti.className='obdv-time-inp';
        var _ok=document.createElement('button');_ok.className='obdv-ok';_ok.textContent='OK';
        _tr.appendChild(_tl); _tr.appendChild(_ti); _tr.appendChild(_ok);

        _pop.appendChild(_ph); _pop.appendChild(_gw); _pop.appendChild(_tr);

        function _renderDays(){
            _ml.textContent=_MON[_cs.viewMo]+' '+_cs.viewY;
            _dg.innerHTML='';
            var y=_cs.viewY,mo=_cs.viewMo;
            var fd=new Date(y,mo,1).getDay();
            var dim=new Date(y,mo+1,0).getDate();
            var prev=new Date(y,mo,0).getDate();
            var today=new Date(); today.setHours(0,0,0,0);
            var sMs=_toMs(_cs.start),eMs=_toMs(_cs.end);
            var same=(_cs.start.y===_cs.end.y&&_cs.start.mo===_cs.end.mo&&_cs.start.d===_cs.end.d);

            for(var i=0;i<fd;i++){var s=document.createElement('span');s.className='obdv-d obdv-other';s.textContent=prev-fd+1+i;_dg.appendChild(s);}
            for(var day=1;day<=dim;day++){
                var sp=document.createElement('span'); sp.className='obdv-d';
                var dow=new Date(y,mo,day).getDay();
                if(dow===0)sp.classList.add('obdv-sun');
                if(dow===6)sp.classList.add('obdv-sat');
                var dayMs=new Date(y,mo,day).getTime();
                if(!_allowed(y,mo,day)){sp.classList.add('obdv-disabled');}
                if(dayMs===today.getTime())sp.classList.add('obdv-today');
                var dayEnd=dayMs+86399999;
                if(same&&_cs.start.y===y&&_cs.start.mo===mo&&_cs.start.d===day){sp.classList.add('obdv-sole');}
                else if(_cs.start.y===y&&_cs.start.mo===mo&&_cs.start.d===day){sp.classList.add('obdv-rs');}
                else if(_cs.end.y===y&&_cs.end.mo===mo&&_cs.end.d===day){sp.classList.add('obdv-re');}
                else if(dayMs>sMs&&dayEnd<eMs){sp.classList.add('obdv-in-range');}
                sp.textContent=day;
                (function(dy){if(_allowed(y,mo,dy)){sp.onclick=function(){_pickDay(dy);};};})(day);
                _dg.appendChild(sp);
            }
            var tot=fd+dim, rem=(Math.ceil(tot/7)*7)-tot;
            for(var j=1;j<=rem;j++){var s2=document.createElement('span');s2.className='obdv-d obdv-other';s2.textContent=j;_dg.appendChild(s2);}
        }

        function _pickDay(day){
            if(_cs.which==='start'){_cs.start.y=_cs.viewY;_cs.start.mo=_cs.viewMo;_cs.start.d=day;}
            else{_cs.end.y=_cs.viewY;_cs.end.mo=_cs.viewMo;_cs.end.d=day;}
            if(_toMs(_cs.start)>_toMs(_cs.end)){
                if(_cs.which==='start'){_cs.end={y:_cs.start.y,mo:_cs.start.mo,d:_cs.start.d,hh:_cs.end.hh,mm:_cs.end.mm};}
                else{_cs.start={y:_cs.end.y,mo:_cs.end.mo,d:_cs.end.d,hh:_cs.start.hh,mm:_cs.start.mm};}
            }
            _renderDays(); _refreshCards();
        }

        function _openPop(which, anchorEl){
            _cs.which=which;
            var _anchor = which==='start'?_cs.start:_cs.end;
            _cs.viewY  = _anchor.y;
            _cs.viewMo = _anchor.mo;
            _tl.textContent=which==='start'?'Horário de início':'Horário de fim';
            _ti.value=which==='start'?_fmtT(_cs.start):_fmtT(_cs.end);
            _renderDays(); _refreshCards();
            _pop.style.display='block';
            var r=anchorEl.getBoundingClientRect();
            _pop.style.left=Math.min(r.left,window.innerWidth-274)+'px';
            _pop.style.top=(r.bottom+6)+'px';
        }

        function _closePop(){ _pop.style.display='none'; _cs.which=null; _refreshCards(); }

        _ok.onclick=function(){
            var tp=_ti.value.split(':');
            if(tp.length===2){var hh=parseInt(tp[0]),mm=parseInt(tp[1]);
                if(_cs.which==='start'){_cs.start.hh=hh;_cs.start.mm=mm;}
                else{_cs.end.hh=hh;_cs.end.mm=mm;}
            }
            _closePop();
        };
        _pv.onclick=function(e){e.stopPropagation();_cs.viewMo--;if(_cs.viewMo<0){_cs.viewMo=11;_cs.viewY--;}_renderDays();};
        _pn.onclick=function(e){e.stopPropagation();_cs.viewMo++;if(_cs.viewMo>11){_cs.viewMo=0;_cs.viewY++;}_renderDays();};

        document.addEventListener('mousedown',function(e){
            if(_pop.style.display==='block'&&!_pop.contains(e.target)&&!_sc.el.contains(e.target)&&!_ec.el.contains(e.target)){_closePop();}
        });

        _sc.el.onclick=function(){if(_cs.which==='start'){_closePop();}else{_openPop('start',_sc.el);}};
        _ec.el.onclick=function(){if(_cs.which==='end'){_closePop();}else{_openPop('end',_ec.el);}};

        var calApplyBtn=document.createElement('button');
        calApplyBtn.textContent='✓ Aplicar';
        calApplyBtn.style.cssText='padding:5px 12px;border-radius:6px;font-size:10px;font-weight:700;cursor:pointer;border:1px solid #1f6feb;background:rgba(31,111,235,0.2);color:#58a6ff;white-space:nowrap;';

        var calAutoBtn=document.createElement('button');
        calAutoBtn.textContent='⟳ Auto';
        calAutoBtn.style.cssText='padding:5px 12px;border-radius:6px;font-size:10px;font-weight:700;cursor:pointer;border:1px solid #22c55e;background:rgba(34,197,94,0.1);color:#22c55e;white-space:nowrap;';

        var calStatusLbl=document.createElement('span');
        calStatusLbl.style.cssText='font-size:10px;color:#818cf8;';

        function updateCalStatus(){
            if(!_activeWindow){
                calStatusLbl.textContent='● Auto: 22/03 00:00 → 23/03 23:30';
                calStatusLbl.style.color='#22c55e';
                calAutoBtn.style.opacity='1';
                calAutoBtn.style.background='rgba(34,197,94,0.2)';
                calAutoBtn.style.borderColor='#22c55e';
                calApplyBtn.style.opacity='0.6';
            } else {
                calStatusLbl.textContent='● '+_fmt(_cs.start)+' '+_fmtT(_cs.start)+' → '+_fmt(_cs.end)+' '+_fmtT(_cs.end);
                calStatusLbl.style.color='#818cf8';
                calAutoBtn.style.opacity='0.5';
                calAutoBtn.style.background='rgba(34,197,94,0.05)';
                calAutoBtn.style.borderColor='rgba(34,197,94,0.3)';
                calApplyBtn.style.opacity='1';
            }
        }

        calApplyBtn.onclick=function(){
            _closePop();
            var sMs=_toMs(_cs.start),eMs=_toMs(_cs.end);
            if(eMs<=sMs){calStatusLbl.textContent='⚠ Fim deve ser após o início';calStatusLbl.style.color='#ef4444';return;}
            _activeWindow={start:sMs,end:eMs}; updateCalStatus(); doFetch();
        };

        calAutoBtn.onclick=function(){
            _closePop(); _activeWindow=null;
            _cs.start=_makeS(0,0,0); _cs.end=_makeS(1,23,30);
            _refreshCards(); updateCalStatus(); doFetch();
        };

        var _arr=document.createElement('span'); _arr.textContent='→'; _arr.style.cssText='color:#4b5563;font-size:14px;';
        calInner.appendChild(_sc.el); calInner.appendChild(_arr); calInner.appendChild(_ec.el);
        calInner.appendChild(calApplyBtn); calInner.appendChild(calAutoBtn); calInner.appendChild(calStatusLbl);

        calBtn.onclick=function(){
            var isOpen=calPanel.classList.contains('open');
            if(isOpen){_closePop();calPanel.style.maxHeight='0';calPanel.classList.remove('open');calBtn.style.color='#8b949e';calBtn.style.borderColor='#30363d';}
            else{calPanel.style.maxHeight='80px';calPanel.classList.add('open');calBtn.style.color='#58a6ff';calBtn.style.borderColor='#58a6ff';updateCalStatus();}
        };
        setTimeout(function(){
            _refreshCards(); updateCalStatus();
            calPanel.style.maxHeight='80px'; calPanel.classList.add('open');
            calBtn.style.color='#58a6ff'; calBtn.style.borderColor='#58a6ff';
        }, 50);

        // Grid
        var gridWrap = document.createElement('div');
        gridWrap.style.cssText = 'flex:1;overflow-y:auto;padding:14px 16px;background:#0d1117;min-height:0;';
        var grid = document.createElement('div');
        grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(175px,1fr));gap:10px;';
        gridWrap.appendChild(grid);

        // Status bar
        var statusBar = document.createElement('div');
        statusBar.style.cssText = 'padding:5px 14px;font-size:10px;color:#6e7681;border-top:1px solid #21262d;background:#0d1117;flex-shrink:0;';
        statusBar.textContent = 'Pronto — clique em 🔄 Buscar';

        _panel.appendChild(hdr); _panel.appendChild(toolbar); _panel.appendChild(routePanel);
        _panel.appendChild(calPanel); _panel.appendChild(gridWrap); _panel.appendChild(statusBar);
        document.body.appendChild(_panel);
        _panel.appendChild(_pop);
        document.addEventListener('keydown',function(e){if(e.key==='Escape'&&_panel)_panel.style.display='none';});

        // ── State ──────────────────────────────────────────────────────────────
        var _routes = [];
        var _vsmLoading = false;
        var _activeWindow = null;
        var _defaultsApplied = false;

        function _isCompleted(status) {
            return ['completed','outboundcompleted','finishedloading']
                .indexOf((status || '').toLowerCase().replace(/[_\s]/g, '')) !== -1;
        }

        function makeCard(r) {
            var now=Date.now(), diff=r.cptMs?r.cptMs-now:null;
            var isCompleted = _isCompleted(r.status);
            var expired = (diff !== null && diff < 0) || isCompleted;
            var urgent  = !expired && diff !== null && diff >= 0 && diff < 90*60000;
            var warning = !expired && diff !== null && diff >= 90*60000 && diff < 2*3600000;

            var card=document.createElement('div');
            card.className='obdv-card'+(urgent?' urgent':warning?' warning':expired?' expired':'');

            var headerBg=expired?'#1c2128':urgent?'#2d0f0f':warning?'#2b1d0e':'#161b22';
            var hdrDiv=document.createElement('div');
            hdrDiv.className='obdv-card-header';
            hdrDiv.style.background=headerBg;

            var routeEl=document.createElement('div');
            routeEl.className='obdv-route';
            routeEl.title=r.route;
            routeEl.textContent=r.route;

            var vsmEl=document.createElement('div');
            var isMMRoute=/_MM$/i.test(r.route);
            var vsm=isMMRoute ? null : _vsmMap[r.route];
            if(isMMRoute){
                vsmEl.className='obdv-vsm';
                vsmEl.style.color='#374151';
                vsmEl.textContent='';
            } else if(_vsmLoading&&vsm===undefined){
                vsmEl.className='obdv-vsm loading';
                vsmEl.textContent='Buscando VSM...';
            } else if(vsm){
                vsmEl.className='obdv-vsm';
                vsmEl.textContent=vsm;
                vsmEl.title='Visual Sortation Marker: '+vsm;
            } else if(!_vsmLoading){
                vsmEl.className='obdv-vsm';
                vsmEl.style.color='#374151';
                vsmEl.textContent='Sem VSM';
            }
            hdrDiv.appendChild(vsmEl);
            hdrDiv.appendChild(routeEl);
            card.appendChild(hdrDiv);

            var body=document.createElement('div');
            body.className='obdv-card-body';

            var cptClass=urgent?'urgent':warning?'warning':expired?'expired':'';
            var cptEl=document.createElement('div');
            cptEl.className='obdv-cpt-time'+(cptClass?' '+cptClass:'');
            cptEl.textContent=r.cpt||'—';
            body.appendChild(cptEl);

            var cptDateEl=document.createElement('div');
            cptDateEl.className='obdv-cpt-date';
            if(r.cptMs){
                var _cd=new Date(r.cptMs);
                var _today=new Date();
                var _isTodayCpt=_cd.getDate()===_today.getDate()&&_cd.getMonth()===_today.getMonth()&&_cd.getFullYear()===_today.getFullYear();
                var _tomorrow=new Date(_today); _tomorrow.setDate(_today.getDate()+1);
                var _isTomorrow=_cd.getDate()===_tomorrow.getDate()&&_cd.getMonth()===_tomorrow.getMonth()&&_cd.getFullYear()===_tomorrow.getFullYear();
                cptDateEl.textContent=_isTodayCpt?'Hoje':_isTomorrow?'Amanhã':(('0'+(_cd.getMonth()+1)).slice(-2)+'/'+('0'+_cd.getDate()).slice(-2));
            } else { cptDateEl.textContent=''; }
            body.appendChild(cptDateEl);

            var remEl=document.createElement('div');
            remEl.className='obdv-remaining';
            if(diff===null){remEl.style.color='#6e7681';remEl.textContent='Sem CPT';}
            else if(expired){remEl.style.color='#6e7681';remEl.textContent=isCompleted?'Finalizado':'Expirado '+Math.abs(Math.round(diff/60000))+'min';}
            else if(urgent){remEl.style.color='#ef4444';remEl.textContent='🚨 '+Math.round(diff/60000)+'min restantes';}
            else if(warning){var m3=Math.round(diff/60000);remEl.style.color='#f59e0b';remEl.textContent=Math.floor(m3/60)+'h '+(m3%60)+'min';}
            else{var m4=Math.round(diff/60000);remEl.style.color='#22c55e';remEl.textContent=Math.floor(m4/60)+'h '+(m4%60)+'min';}
            body.appendChild(remEl);

            var st=getStatus(r.status);
            var badge=document.createElement('span');
            badge.className='obdv-status-badge';
            badge.style.cssText='background:'+st.bg+';color:'+st.color+';border:1px solid '+st.color+'44;margin-top:6px;';
            badge.textContent=st.label;
            body.appendChild(badge);

            // Container section — só para rotas ativas
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
                            .map(function(p){ return p.label; })
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

        function renderCards(term) {
            var now=Date.now();
            var rows=_routes.filter(function(r){
                if(_disabledRoutes[r.route])return false;
                var isCompleted = _isCompleted(r.status);
                if(_hideExp&&((r.cptMs&&r.cptMs<now)||isCompleted))return false;
                if(!term)return true;
                var t=term.toLowerCase();
                return r.route.toLowerCase().includes(t)||(_vsmMap[r.route]||'').toLowerCase().includes(t);
            });
            grid.innerHTML='';
            rows.forEach(function(r){grid.appendChild(makeCard(r));});
            countEl.textContent=rows.length+' / '+_routes.length+' rotas';
        }

        filterInput.addEventListener('input',function(){renderCards(filterInput.value.trim());});
        setInterval(function(){if(_routes.length)renderCards(filterInput.value.trim());},30000);

        // ── Fetch OB + VSM ─────────────────────────────────────────────────────
        function doFetch() {
            fetchBtn.disabled=true; fetchBtn.textContent='⏳ Buscando...';
            statusBar.textContent='Consultando API OB...';
            grid.innerHTML='<div style="padding:24px;color:#6e7681;font-size:13px;grid-column:1/-1;text-align:center;"><span style="display:inline-block;width:20px;height:20px;border:2px solid #30363d;border-top-color:#58a6ff;border-radius:50%;animation:obdv-spin 0.8s linear infinite;vertical-align:middle;margin-right:8px;"></span>Carregando rotas OB...</div>';
            _routes=[]; _vsmLoading=false; countEl.textContent=''; vsmStatusEl.textContent='';

            var node=(nodeInput.value||'CGH7').trim().toUpperCase();
            var win=apiWindow(_activeWindow);
            var params=['entity=getOutboundDockView','nodeId='+encodeURIComponent(node),'startDate='+win.start,'endDate='+win.end,
                'loadCategories=outboundScheduled,outboundInProgress,outboundReadyToDepart,outboundDeparted,outboundCancelled',
                'shippingPurposeType=TRANSSHIPMENT,NON-TRANSSHIPMENT,SHIP_WITH_AMAZON'].join('&');

            GM_xmlhttpRequest({
                method:'POST', url:BASE+'ssp/dock/hrz/ob/fetchdata',
                headers:{'Content-Type':'application/x-www-form-urlencoded','X-Requested-With':'XMLHttpRequest'},
                data:params, withCredentials:true, timeout:20000,
                onload:function(resp){
                    fetchBtn.disabled=false; fetchBtn.textContent='🔄 Buscar';
                    if(resp.status!==200){statusBar.textContent='⚠ HTTP '+resp.status;grid.innerHTML='';return;}
                    var data; try{data=JSON.parse(resp.responseText.replace(/^\uFEFF/,''));}catch(e){statusBar.textContent='⚠ JSON parse error';grid.innerHTML='';return;}
                    var aaData=data&&data.ret&&data.ret.aaData;
                    if(!Array.isArray(aaData)){statusBar.textContent='⚠ aaData não encontrado';grid.innerHTML='';return;}

                    var routeMap={};
                    var _win=_activeWindow||todayWindow(),_winStart=_win.start,_winEnd=_win.end;

                    aaData.forEach(function(item){
                        var load=item.load||{};
                        var rawRoute=cleanRoute(load.route||item.route||'');
                        if(!rawRoute)return;
                        var cpt=load.criticalPullTime||'', cptMs=parseMs(cpt), status=item.status||load.status||'';
                        if(!cptMs)return;
                        if(cptMs<_winStart||cptMs>_winEnd)return;
                        var _dateKey = (function(){ var d=new Date(cptMs); return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate(); })();
                        splitRoute(rawRoute).forEach(function(route){
                            var key = route+'|'+_dateKey;
                            var vrId       = load.vrId        || '';
                            var loadGroupId= load.loadGroupId || '';
                            var planId     = load.planId      || '';
                            var trailerId  = (item.trailer && item.trailer.trailerId) || '';
                            if(routeMap[key]){
                                var existing=routeMap[key];
                                if(cptMs&&(!existing.cptMs||cptMs<existing.cptMs)){existing.cpt=cptHHMM(cpt);existing.cptMs=cptMs;}
                                if(statusPriority(status)<statusPriority(existing.status)){existing.status=status;}
                                if(!existing.vrId&&vrId){existing.vrId=vrId;existing.loadGroupId=loadGroupId;existing.planId=planId;existing.trailerId=trailerId;}
                            } else {
                                routeMap[key]={route:route,cpt:cptHHMM(cpt),cptMs:cptMs,status:status,vrId:vrId,loadGroupId:loadGroupId,planId:planId,trailerId:trailerId};
                            }
                        });
                    });

                    _routes=Object.values(routeMap).sort(function(a,b){
                        if(!a.cptMs&&!b.cptMs)return a.route.localeCompare(b.route);
                        if(!a.cptMs)return 1;if(!b.cptMs)return-1;return a.cptMs-b.cptMs;
                    });

                    if (!_defaultsApplied) {
                        _defaultsApplied = true;
                        _routes.forEach(function(r){ if(isDefaultDisabled(r.route)) _disabledRoutes[r.route]=true; });
                    }

                    var hasVsm = Object.keys(_vsmMap).length > 0;
                    _vsmLoading = !hasVsm;

                    renderCards(filterInput.value.trim());
                    if(routePanel.classList.contains('open'))buildRoutePanel();

                    // Busca containers só para rotas ativas (não expiradas e não finalizadas)
                    var now0 = Date.now();
                    var activeRoutes = _routes.filter(function(r) {
                        return !_isCompleted(r.status) && (!r.cptMs || r.cptMs >= now0);
                    });
                    fetchContainersForRoutes(activeRoutes, node, function() {
                        renderCards(filterInput.value.trim());
                    });

                    var ts=new Date().toLocaleTimeString('pt-BR',{hour12:false});
                    var _wFmt=function(ms){var d=new Date(ms);var today=new Date();var isToday=d.getDate()===today.getDate()&&d.getMonth()===today.getMonth()&&d.getFullYear()===today.getFullYear();var day=isToday?'':((d.getMonth()+1)+'/'+d.getDate()+' ');return day+('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2);};
                    var _winLabel=' · Janela '+_wFmt(_winStart)+'→'+_wFmt(_winEnd);

                    if (hasVsm) {
                        var vsmCount0=Object.keys(_vsmMap).length;
                        statusBar.textContent='OB OK ('+ts+') — '+_routes.length+' rotas · '+vsmCount0+' VSMs'+_winLabel;
                        vsmStatusEl.textContent='✅ '+vsmCount0+' VSMs';
                    } else {
                        statusBar.textContent='OB OK ('+ts+') — '+_routes.length+' rotas — Buscando VSM...'+_winLabel;
                        vsmStatusEl.textContent='⏳ VSM...';

                        fetchVSM(node, function(){
                            _vsmLoading=false;
                            saveVsmCache(_vsmMap);
                            renderCards(filterInput.value.trim());
                            if(routePanel.classList.contains('open'))buildRoutePanel();
                            var ts2=new Date().toLocaleTimeString('pt-BR',{hour12:false});
                            var vsmCount=Object.keys(_vsmMap).length;
                            statusBar.textContent='Atualizado '+ts2+' — '+_routes.length+' rotas · '+vsmCount+' VSMs'+_winLabel;
                            vsmStatusEl.textContent=vsmCount>0?'✅ '+vsmCount+' VSMs':'⚠ VSM sem dados';
                        });
                    }
                },
                onerror:function(){fetchBtn.disabled=false;fetchBtn.textContent='🔄 Buscar';statusBar.textContent='⚠ Erro de rede';grid.innerHTML='';},
                ontimeout:function(){fetchBtn.disabled=false;fetchBtn.textContent='🔄 Buscar';statusBar.textContent='⚠ Timeout (20s)';grid.innerHTML='';}
            });
        }

        fetchBtn.onclick=doFetch;
        setTimeout(doFetch, 100);

        var _autoRefreshIv = setInterval(function(){
            if(!fetchBtn.disabled && _panel && _panel.style.display !== 'none') doFetch();
        }, 5 * 60 * 1000);
    }

    // ── detectNode ────────────────────────────────────────────────────────────
    function detectNode() {
        var m=location.href.match(/[?&]node=([A-Z]{2,4}\d[A-Z0-9]{0,4})/i);
        if(m)return m[1].toUpperCase();
        var el=document.querySelector('#nodeId, select[name="nodeId"] option:checked');
        if(el)return(el.value||el.textContent||'').trim().toUpperCase();
        return 'CGH7';
    }

    // ── Toggle button ─────────────────────────────────────────────────────────
    function injectToggle() {
        if(document.getElementById('ob-dock-view-toggle'))return;
        var btn=document.createElement('button');
        btn.id='ob-dock-view-toggle'; btn.textContent='🚛 Dock View';
        btn.style.cssText=['position:fixed;bottom:20px;right:20px;z-index:2147483646','background:#1f6feb;color:#fff;border:none;border-radius:8px','padding:7px 16px;font-size:11px;font-weight:700;cursor:pointer','font-family:"Amazon Ember",Arial,sans-serif;box-shadow:0 4px 12px rgba(31,111,235,0.4)','transition:background 0.15s,transform 0.1s'].join(';');
        btn.onmouseover=function(){btn.style.background='#388bfd';btn.style.transform='translateY(-1px)';};
        btn.onmouseout=function(){btn.style.background='#1f6feb';btn.style.transform='';};
        btn.onclick=buildPanel;
        document.body.appendChild(btn);
    }

    if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',injectToggle);}
    else{setTimeout(injectToggle,500);}

})();

