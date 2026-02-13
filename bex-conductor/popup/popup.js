// BEX Conductor - Popup Logic

const ticketInput = document.getElementById('ticketInput');
const importBtn = document.getElementById('importBtn');
const statusBar = document.getElementById('statusBar');
const ticketList = document.getElementById('ticketList');
const proxyToggle = document.getElementById('proxyToggle');
const proxyModeLabel = document.getElementById('proxyModeLabel');
const proxyAddr = document.getElementById('proxyAddr');
const proxyPort = document.getElementById('proxyPort');
const proxyFields = document.getElementById('proxyFields');

function showStatus(message, isError) {
  statusBar.textContent = message;
  statusBar.className = 'status ' + (isError ? 'error' : 'success');
  statusBar.style.display = 'block';
  setTimeout(() => { statusBar.style.display = 'none'; }, 4000);
}

function updateProxyUI(enabled) {
  if (enabled) {
    proxyModeLabel.textContent = 'Proxy Mode (victim IP)';
    proxyModeLabel.classList.add('proxy-active');
  } else {
    proxyModeLabel.textContent = 'Ticket Mode (your IP)';
    proxyModeLabel.classList.remove('proxy-active');
  }
}

function refreshTickets() {
  browser.runtime.sendMessage({ type: 'GET_TICKETS' }).then(response => {
    const tickets = response.tickets || {};
    const domains = Object.keys(tickets);

    if (domains.length === 0) {
      ticketList.innerHTML = '<p class="empty">No active tickets</p>';
      return;
    }

    ticketList.innerHTML = '';
    for (const domain of domains) {
      const t = tickets[domain];
      const card = document.createElement('div');
      card.className = 'ticket-card';

      const badges = [];
      if (t.cookieCount > 0)          badges.push(t.cookieCount + ' cookies');
      if (t.headerCount > 0)          badges.push(t.headerCount + ' headers');
      if (t.localStorageCount > 0)    badges.push(t.localStorageCount + ' localStorage');
      if (t.sessionStorageCount > 0)  badges.push(t.sessionStorageCount + ' sessionStorage');

      const badgeHtml = badges.map(b => '<span class="badge">' + b + '</span>').join('');
      const infoLine = [t.browser, t.platform].filter(Boolean).join(' / ');

      // Show routing indicator
      const routeIndicator = proxyToggle.checked
        ? '<span class="badge badge-proxy">via proxy</span>'
        : '<span class="badge badge-direct">direct</span>';

      card.innerHTML =
        '<div class="domain">' + escapeHtml(domain) + ' ' + routeIndicator + '</div>' +
        (infoLine ? '<div style="font-size:11px;color:#777;margin-bottom:4px;">' + escapeHtml(infoLine) + '</div>' : '') +
        '<div class="badges">' + badgeHtml + '</div>' +
        '<div class="actions"></div>';

      const actions = card.querySelector('.actions');

      if (t.urls && t.urls.length > 0) {
        const openBtn = document.createElement('button');
        openBtn.className = 'btn btn-open';
        openBtn.textContent = 'Open';
        openBtn.addEventListener('click', () => {
          browser.tabs.create({ url: t.urls[0] });
        });
        actions.appendChild(openBtn);
      }

      const clearBtn = document.createElement('button');
      clearBtn.className = 'btn btn-clear';
      clearBtn.textContent = 'Clear';
      clearBtn.addEventListener('click', () => {
        browser.runtime.sendMessage({ type: 'CLEAR_TICKET', domain: domain }).then(() => {
          showStatus('Cleared ticket for ' + domain, false);
          refreshTickets();
        });
      });
      actions.appendChild(clearBtn);

      ticketList.appendChild(card);
    }
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

importBtn.addEventListener('click', () => {
  const data = ticketInput.value.trim();
  if (!data) {
    showStatus('Please paste a BEX ticket first', true);
    return;
  }

  browser.runtime.sendMessage({ type: 'IMPORT_TICKET', data: data }).then(response => {
    if (response && response.success) {
      showStatus('Ticket imported for ' + response.domain, false);
      ticketInput.value = '';
      refreshTickets();
    } else {
      showStatus('Import failed: ' + (response ? response.error : 'unknown error'), true);
    }
  }).catch(err => {
    showStatus('Import failed: ' + err.message, true);
  });
});

// Proxy toggle handler
proxyToggle.addEventListener('change', () => {
  const enabled = proxyToggle.checked;
  const address = proxyAddr.value.trim() || '127.0.0.1';
  const port = parseInt(proxyPort.value, 10) || 8445;

  browser.runtime.sendMessage({
    type: 'SET_PROXY',
    enabled: enabled,
    address: address,
    port: port
  }).then(response => {
    if (response && response.success) {
      updateProxyUI(enabled);
      showStatus(enabled ? 'Proxy mode enabled' : 'Ticket mode enabled', false);
      refreshTickets();
    }
  });
});

// Update proxy settings when address/port fields change (while proxy is active)
function onProxyFieldChange() {
  if (!proxyToggle.checked) return;
  const address = proxyAddr.value.trim() || '127.0.0.1';
  const port = parseInt(proxyPort.value, 10) || 8445;
  browser.runtime.sendMessage({
    type: 'SET_PROXY',
    enabled: true,
    address: address,
    port: port
  });
}

proxyAddr.addEventListener('change', onProxyFieldChange);
proxyPort.addEventListener('change', onProxyFieldChange);

// Load state on popup open
browser.runtime.sendMessage({ type: 'GET_PROXY_STATUS' }).then(response => {
  proxyToggle.checked = response.proxyEnabled;
  proxyAddr.value = response.proxyAddress || '127.0.0.1';
  proxyPort.value = response.proxyPort || 8445;
  updateProxyUI(response.proxyEnabled);
  refreshTickets();
});
