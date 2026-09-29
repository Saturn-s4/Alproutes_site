/*
 * support.js — a small standalone runtime for the *.dc.html screens.
 *
 * Supports the subset of the Design Component format the screens use:
 *   <x-dc> root, <helmet> (moved into <head>), {{path}} holes in text and
 *   attributes, on*="{{fn}}" handlers, <sc-for list as>, <sc-if value>,
 *   <dc-import name ...props> and a `class Component extends DCLogic` script
 *   with props / state / setState / renderVals().
 *
 * Top-level props come from data-props defaults, then localStorage
 * (last chosen theme / language), then the URL query (?theme=light&lang=en).
 */
(function () {
  'use strict';

  var STORE_KEYS = ['theme', 'lang'];
  var HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  var WHOLE_HOLE = /^\{\{\s*([^}]+?)\s*\}\}$/;

  // Hide the raw template until it is rendered.
  var hide = document.createElement('style');
  hide.textContent = 'x-dc{display:none!important}';
  document.head.appendChild(hide);

  function storeGet(k) { try { return localStorage.getItem('alproutes.' + k); } catch (e) { return null; } }
  function storeSet(k, v) { try { localStorage.setItem('alproutes.' + k, v); } catch (e) {} }

  function DCLogic(props) {
    this.props = props || {};
    this.state = {};
  }
  DCLogic.prototype.renderVals = function () { return {}; };
  DCLogic.prototype.setState = function (patch) {
    var s = Object.assign({}, this.state, typeof patch === 'function' ? patch(this.state) : patch);
    this.state = s;
    if (this.__persist) STORE_KEYS.forEach(function (k) { if (patch && patch[k] != null) storeSet(k, patch[k]); });
    if (this.__rerender) this.__rerender();
  };
  window.DCLogic = DCLogic;

  function lookup(path, scopes) {
    path = path.trim();
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    var parts = path.split('.');
    for (var i = scopes.length - 1; i >= 0; i--) {
      var sc = scopes[i];
      if (sc && Object.prototype.hasOwnProperty.call(sc, parts[0])) {
        var v = sc[parts[0]];
        for (var j = 1; j < parts.length && v != null; j++) v = v[parts[j]];
        return v;
      }
    }
    return undefined;
  }

  function interp(str, scopes) {
    return str.replace(HOLE, function (_, p) {
      var v = lookup(p, scopes);
      return v == null ? '' : String(v);
    });
  }

  // Parse a .dc.html source (string or Document) into {template, helmet, Component, defaults}.
  function parseDoc(doc) {
    var root = doc.querySelector('x-dc');
    var helmet = root && root.querySelector(':scope > helmet');
    var script = doc.querySelector('script[data-dc-script]');
    var defaults = {};
    var Component = DCLogic;
    if (script) {
      try {
        var decl = JSON.parse(script.getAttribute('data-props') || '{}');
        Object.keys(decl).forEach(function (k) {
          if (k.charAt(0) !== '$' && decl[k] && 'default' in decl[k]) defaults[k] = decl[k].default;
        });
      } catch (e) { console.warn('[dc] bad data-props', e); }
      Component = new Function('DCLogic', script.textContent + '\n;return Component;')(DCLogic);
    }
    if (helmet) helmet.remove();
    return { template: root, helmet: helmet, Component: Component, defaults: defaults };
  }

  var helmetDone = {};
  function applyHelmet(key, helmet) {
    if (!helmet || helmetDone[key]) return;
    helmetDone[key] = true;
    Array.prototype.forEach.call(helmet.children, function (el) {
      document.head.appendChild(document.importNode(el, true));
    });
  }

  var importCache = {};
  function loadImport(name) {
    if (!importCache[name]) {
      importCache[name] = fetch(name + '.dc.html')
        .then(function (r) { if (!r.ok) throw new Error(r.status + ' ' + name); return r.text(); })
        .then(function (html) {
          var parsed = parseDoc(new DOMParser().parseFromString(html, 'text/html'));
          applyHelmet(name, parsed.helmet);
          return parsed;
        });
    }
    return importCache[name];
  }

  function mount(parsed, props, host, persist) {
    var inst = new parsed.Component(Object.assign({}, parsed.defaults, props));
    inst.__persist = persist;
    var queued = false;
    function render() {
      queued = false;
      var vals = inst.renderVals() || {};
      var frag = document.createDocumentFragment();
      renderChildren(parsed.template, [vals], frag);
      host.replaceChildren(frag);
    }
    inst.__rerender = function () {
      if (!queued) { queued = true; Promise.resolve().then(render); }
    };
    render();
    return inst;
  }

  function renderChildren(parent, scopes, out) {
    for (var n = parent.firstChild; n; n = n.nextSibling) renderNode(n, scopes, out);
  }

  function renderNode(node, scopes, out) {
    if (node.nodeType === 3) {
      out.appendChild(document.createTextNode(interp(node.nodeValue, scopes)));
      return;
    }
    if (node.nodeType !== 1) return;
    var tag = node.localName;

    if (tag === 'sc-for') {
      var list = lookup((node.getAttribute('list') || '').replace(/^\{\{|\}\}$/g, ''), scopes) || [];
      var as = node.getAttribute('as') || 'item';
      Array.prototype.forEach.call(list, function (item, i) {
        var s = {}; s[as] = item; s[as + 'Index'] = i;
        renderChildren(node, scopes.concat([s]), out);
      });
      return;
    }
    if (tag === 'sc-if') {
      var v = lookup((node.getAttribute('value') || '').replace(/^\{\{|\}\}$/g, ''), scopes);
      if (v) renderChildren(node, scopes, out);
      return;
    }
    if (tag === 'dc-import') {
      var box = document.createElement('div');
      box.style.display = 'contents';
      var props = {};
      Array.prototype.forEach.call(node.attributes, function (a) {
        if (a.name === 'name' || a.name.indexOf('hint-') === 0) return;
        var m = a.value.match(WHOLE_HOLE);
        props[a.name] = m ? lookup(m[1], scopes) : interp(a.value, scopes);
      });
      var name = node.getAttribute('name');
      loadImport(name).then(function (parsed) { mount(parsed, props, box, false); })
        .catch(function (e) {
          box.textContent = 'Не удалось загрузить ' + name + '.dc.html (' + e.message + '). Откройте сайт через HTTP-сервер.';
        });
      out.appendChild(box);
      return;
    }

    var el = node.namespaceURI && node.namespaceURI !== 'http://www.w3.org/1999/xhtml'
      ? document.createElementNS(node.namespaceURI, node.tagName)
      : document.createElement(tag);
    Array.prototype.forEach.call(node.attributes, function (a) {
      if (a.name.indexOf('hint-') === 0) return;
      var m = a.value.match(WHOLE_HOLE);
      if (/^on/i.test(a.name)) {
        if (m) {
          var fn = lookup(m[1], scopes);
          if (typeof fn === 'function') el.addEventListener(a.name.slice(2).toLowerCase(), fn);
        }
        return;
      }
      var val = m ? lookup(m[1], scopes) : interp(a.value, scopes);
      if (m && (val === false || val == null) && a.name.indexOf('aria-') !== 0) return;
      try {
        if (a.namespaceURI) el.setAttributeNS(a.namespaceURI, a.name, String(val));
        else el.setAttribute(a.name, String(val));
      } catch (e) {}
    });
    renderChildren(node.localName === 'template' ? node.content : node, scopes, el);
    out.appendChild(el);
  }

  function boot() {
    var root = document.querySelector('x-dc');
    if (!root) return;
    var parsed = parseDoc(document);
    applyHelmet('__page', parsed.helmet);
    var host = document.createElement('div');
    host.className = 'dc-root';
    root.parentNode.insertBefore(host, root);
    root.remove();

    var props = {};
    STORE_KEYS.forEach(function (k) { var v = storeGet(k); if (v) props[k] = v; });
    new URLSearchParams(location.search).forEach(function (v, k) { props[k] = v; });
    mount(parsed, props, host, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
