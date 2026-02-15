// Example Plugin — ui.js
// Runs in the JS-Tap dashboard. 'pluginUI' object is provided with:
//   pluginUI.pluginId   — this plugin's ID
//   pluginUI.clientId   — the selected client's ID
//   pluginUI.container  — DOM element containing ui.html content
//   pluginUI.fetchData(dataType, limit, offset) — returns Promise of {total, rows}
//   pluginUI.deleteData() — clears all plugin data for this client

function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str || ''));
    return div.innerHTML;
}

function loadData() {
    pluginUI.fetchData('window_info', 50, 0).then(function(result) {
        var tbody = pluginUI.container.querySelector('#example-data-body');
        if (!tbody) return;

        if (!result.rows || result.rows.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-muted">No data yet</td></tr>';
            return;
        }

        var html = '';
        for (var i = 0; i < result.rows.length; i++) {
            var row = result.rows[i];
            var d = row.data || {};
            var ts = row.timeStamp ? new Date(row.timeStamp).toLocaleString() : '';
            html += '<tr>' +
                '<td class="small">' + escapeHtml(ts) + '</td>' +
                '<td>' + escapeHtml(String(d.windowId || '')) + '</td>' +
                '<td>' + escapeHtml(d.title || '') + '</td>' +
                '<td class="small" style="max-width:250px;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(d.url || '') + '</td>' +
                '</tr>';
        }
        tbody.innerHTML = html;
    });
}

var refreshBtn = pluginUI.container.querySelector('#example-refresh-btn');
if (refreshBtn) {
    refreshBtn.onclick = function() { loadData(); };
}

var clearBtn = pluginUI.container.querySelector('#example-clear-btn');
if (clearBtn) {
    clearBtn.onclick = function() {
        pluginUI.deleteData().then(function() { loadData(); });
    };
}

// Initial load
loadData();
