// JS-Tap Conductor - Popup Logic

const ticketInput = document.getElementById('ticketInput');
const importBtn = document.getElementById('importBtn');
const statusBar = document.getElementById('statusBar');
const ticketList = document.getElementById('ticketList');

function showStatus(message, isError) {
  statusBar.textContent = message;
  statusBar.className = 'status ' + (isError ? 'error' : 'success');
  statusBar.style.display = 'block';
  setTimeout(() => { statusBar.style.display = 'none'; }, 4000);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Pick the best URL from a session ticket for the Open button.
// SPAs make tons of API/asset requests so urls[0] is often a bad choice.
// Prefer short path, non-API, non-asset URLs.  Fall back to domain root.
function pickBestUrl(ticket) {
  const urls = ticket.urls || [];
  const domain = ticket.domain || '';

  // Patterns that indicate API/asset endpoints rather than navigable pages
  const apiPatterns = /\/(api|graphql|_next|__webpack|static|assets|sockjs|ws)\b/i;
  const assetExts = /\.(js|css|json|map|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot)(\?|$)/i;

  // Score each URL — lower is better
  function score(urlStr) {
    try {
      const u = new URL(urlStr);
      if (apiPatterns.test(u.pathname)) return 100;
      if (assetExts.test(u.pathname)) return 100;
      // Prefer shorter paths (closer to a real page)
      return u.pathname.split('/').filter(Boolean).length;
    } catch (_) {
      return 200;
    }
  }

  if (urls.length > 0) {
    const sorted = [...urls].sort((a, b) => score(a) - score(b));
    if (score(sorted[0]) < 100) return sorted[0];
  }

  // All URLs are API endpoints — just open the domain root
  const proto = domain.includes('localhost') ? 'http' : 'https';
  return proto + '://' + domain + '/';
}

function refreshTickets() {
  browser.runtime.sendMessage({ type: 'GET_TICKET_HISTORY' }).then(response => {
    const history = response.history || [];

    if (history.length === 0) {
      ticketList.innerHTML = '<p class="empty">No saved tickets</p>';
      return;
    }

    ticketList.innerHTML = '';

    for (const entry of history) {
      const card = document.createElement('div');
      card.className = 'ticket-card';
      if (entry.active) card.classList.add('active');
      if (entry.type === 'proxy') card.classList.add('proxy-card');

      const ticket = entry.ticket;

      // Type badge
      const typeBadgeClass = entry.type === 'proxy' ? 'badge-type-proxy' : 'badge-type-session';
      let typeBadge = '<span class="badge badge-type ' + typeBadgeClass + '">' + entry.type + '</span>';

      // Active badge
      let activeBadge = entry.active ? '<span class="badge badge-active">active</span>' : '';

      // Header row
      let headerHtml = '<div class="card-header-row">';
      headerHtml += '<span class="domain">' + escapeHtml(entry.label) + '</span>';
      headerHtml += typeBadge + activeBadge;
      headerHtml += '</div>';

      // Info line
      let infoHtml = '';
      if (entry.type === 'proxy') {
        const port = ticket.proxy ? ticket.proxy.port : '?';
        const beacon = ticket.beaconNickname || '';
        const parts = [];
        parts.push('Port ' + port);
        if (beacon) parts.push(beacon);
        if (ticket.domains && ticket.domains.length > 0) {
          parts.push(ticket.domains.join(', '));
        }
        infoHtml = '<div class="card-info">' + escapeHtml(parts.join(' | ')) + '</div>';
      } else {
        const badges = [];
        if (ticket.cookies && ticket.cookies.length > 0) badges.push(ticket.cookies.length + ' cookies');
        if (ticket.headers && ticket.headers.length > 0) badges.push(ticket.headers.length + ' headers');
        const infoLine = [ticket.browser, ticket.platform].filter(Boolean).join(' / ');

        let badgeHtml = badges.map(b => '<span class="badge">' + b + '</span>').join('');
        infoHtml = '';
        if (infoLine) {
          infoHtml += '<div class="card-info">' + escapeHtml(infoLine) + '</div>';
        }
        if (badgeHtml) {
          infoHtml += '<div class="badges">' + badgeHtml + '</div>';
        }
      }

      // Actions
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'actions';

      // Open button (session tickets only — navigate to the best page URL)
      if (entry.type === 'session') {
        const openBtn = document.createElement('button');
        openBtn.className = 'btn btn-open';
        openBtn.textContent = 'Open';
        openBtn.addEventListener('click', () => {
          browser.tabs.create({ url: pickBestUrl(ticket) });
        });
        actionsDiv.appendChild(openBtn);
      }

      // Activate/Deactivate button
      if (entry.active) {
        const deactivateBtn = document.createElement('button');
        deactivateBtn.className = 'btn btn-deactivate';
        deactivateBtn.textContent = 'Deactivate';
        deactivateBtn.addEventListener('click', () => {
          browser.runtime.sendMessage({ type: 'DEACTIVATE_TICKET', key: entry.key }).then(resp => {
            if (resp && resp.success) {
              showStatus('Deactivated ' + entry.type + ' ticket', false);
              refreshTickets();
            }
          });
        });
        actionsDiv.appendChild(deactivateBtn);
      } else {
        const activateBtn = document.createElement('button');
        activateBtn.className = 'btn btn-activate';
        activateBtn.textContent = 'Activate';
        activateBtn.addEventListener('click', () => {
          browser.runtime.sendMessage({ type: 'ACTIVATE_TICKET', key: entry.key }).then(resp => {
            if (resp && resp.success) {
              showStatus('Activated ' + resp.ticketType + ' ticket', false);
              refreshTickets();
            }
          });
        });
        actionsDiv.appendChild(activateBtn);
      }

      // Delete button
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn btn-delete';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', () => {
        browser.runtime.sendMessage({ type: 'DELETE_TICKET_HISTORY', key: entry.key }).then(resp => {
          if (resp && resp.success) {
            showStatus('Ticket removed', false);
            refreshTickets();
          }
        });
      });
      actionsDiv.appendChild(deleteBtn);

      card.innerHTML = headerHtml + infoHtml;
      card.appendChild(actionsDiv);
      ticketList.appendChild(card);
    }
  });
}

importBtn.addEventListener('click', () => {
  const data = ticketInput.value.trim();
  if (!data) {
    showStatus('Please paste a JS-Tap ticket first', true);
    return;
  }

  browser.runtime.sendMessage({ type: 'IMPORT_TICKET', data: data }).then(response => {
    if (response && response.success) {
      const ticketType = response.ticketType || 'session';
      if (ticketType === 'proxy') {
        showStatus('Proxy ticket imported (port ' + response.port + ')', false);
      } else {
        showStatus('Session ticket imported for ' + response.domain, false);
      }
      ticketInput.value = '';
      refreshTickets();
    } else {
      showStatus('Import failed: ' + (response ? response.error : 'unknown error'), true);
    }
  }).catch(err => {
    showStatus('Import failed: ' + err.message, true);
  });
});

// Load state on popup open
refreshTickets();
