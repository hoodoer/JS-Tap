let selectedClientId = "";




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
		});
	} 
	else 
	{
		alert('Invalid IPv4 address. Please enter a valid IPv4 address.');
	}

	inputField.value = "";
	refreshBlockedIPList();
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


async function deleteBlockedIP(button)
{
	await fetch('/api/deleteBlockedIP/' + button.id);

	refreshBlockedIPList();
}



async function showSessionModal()
{
	var modal = new bootstrap.Modal(document.getElementById("clientSessionModal"));

		// Let's figure out if new sessions are allowed right now
	var req = await fetch('/api/app/allowNewClientSessions');
	var jsonResponse = await req.json()

	var checkBox = document.getElementById('allowNewClientSessions');

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

	refreshBlockedIPList();


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
	var payloadCode        = document.getElementById('payload-editor');

	payloadNameInput.value   = payload.name;
	payloadDescription.value = description;
	payloadCode.value        = code;
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
		executePayloadButton.textContent = 'Run Payload';
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
		repeatPayloadToggle.textContent = 'Repeat Payload';
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
		executePayloadButton.textContent = 'Run Payload';
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
		repeatPayloadToggle.textContent = 'Repeat Payload';
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




async function showCustomPayloadModal()
{
	var modal = new bootstrap.Modal(document.getElementById('customPayloadModal'));

	var saveButton      = document.getElementById('payload-save-button');
	var importButton    = document.getElementById('payload-import-button');
	var exportButton    = document.getElementById('payload-export-button');
	var clearJobsButton = document.getElementById('payload-clear-button');
	var closeButton     = document.getElementById('payload-close-button');


	var payloadNameInput   = document.getElementById('payloadName');
	var payloadDescription = document.getElementById('payloadDescription');
	var payloadCode        = document.getElementById('payload-editor');

	var savedPayloadsList = document.getElementById('savedPayloadsList');

	payloadNameInput.value   = "";
	payloadDescription.value = "";
	payloadCode.value        = "";


	// Editor toggle stuff
	var codeEditor = document.getElementById('payloadEditor');
	saveButton.disabled      = false;


	refreshSavedPayloadList();

	// Detect unsaved changes
	var unsavedChanges = false;

	payloadNameInput.addEventListener('input', function() 
	{
		unsavedChanges = true;
		console.log("Unsaved changes!");
	});

	payloadDescription.addEventListener('input', function() 
	{
		unsavedChanges = true;
		console.log("Unsaved changes!");
	});


	payloadCode.addEventListener('input', function() 
	{
		unsavedChanges = true;
		console.log("Unsaved changes!");
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

			// Ok, now make sure we actually have some code...
			if (payloadCode.value === "")
			{
				console.log("Forget the code?");
				event.preventDefault();
				payloadCode.classList.add('is-invalid');
			}
			else
			{
				payloadCode.classList.remove('is-invalid');
				console.log("Got code: " + payloadCode.value);

				unsavedChanges = false;

				// send payload to server
				fetch('/api/savePayload', {
					method:"POST",
					body: JSON.stringify({
						name: payloadNameInput.value,
						description: btoa(payloadDescription.value),
						code: btoa(payloadCode.value)
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

	// console.log("!!!! Request: " + prettyRequest);
	// console.log("!!!! Response: " + prettyResponse);

	requestContent = document.getElementById("requestBox");
	requestContent.innerHTML = prettyRequest;

	responseContent = document.getElementById("responseBox");
	responseContent.innerHTML = prettyResponse;



	var modal = new bootstrap.Modal(document.getElementById('requestResponseModal'));
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




async function getClientDetails(id) 
{
	// console.log("** Fetching details for client: " + id);

	// Get high level event stack for client
	var req = await fetch('/api/clientEvents/' + id);
	var jsonResponse = await req.json();

	// Start setting up our cards
	var cardStack = document.getElementById('detail-stack');


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
  		sessiontorageJson  = await sessionStorageReq.json();

  		cardTitle.innerHTML = "Session Storage";
  		cardText.innerHTML  = "Key: <b>" + sessiontorageJson.sessionStorageKey + "</b>";
  		cardText.innerHTML += "<br>";
  		cardText.innerHTML += "Value: <b>" + sessiontorageJson.sessionStorageValue + "</b>";
  	}
  	break;

  case 'URLVISITED':
  	if (document.getElementById('urlEvents').checked == true)
  	{
  		activeEvent = true;
  		urlVisitedReq  = await fetch('/api/clientUrl/' + eventKey);
  		urlVisitedJson = await urlVisitedReq.json();

  		cardTitle.innerHTML = "<u>URL Visited</u>";
  		cardText.innerHTML  = "URL: <b>" + urlVisitedJson.url + "</b>";
  	}
  	break;

  case 'HTML':
  	if (document.getElementById('htmlScrapeEvents').checked == true)
  	{
  		activeEvent = true;
  		htmlScrapeReq  = await fetch('/api/clientHtml/' + eventKey);
  		htmlScrapeJson = await htmlScrapeReq.json();

  		cardTitle.innerHTML = "HTML Scraped";
  		cardText.innerHTML  = "URL: <b>" + htmlScrapeJson.url + "</b><br><br>";
  		cardText.innerHTML += '<button type="button" class="btn btn-primary" onclick="showHtmlCode(' + eventKey + ')">View Code</button>';
  		cardText.innerHTML += '&nbsp;<button type="button" class="btn btn-primary" onclick=downloadHtmlCode(' + `'` + htmlScrapeJson.fileName + `'`+ ')>Download Code</button>';
  	}
  	break;

  case 'SCREENSHOT':
  	if (document.getElementById('screenshotEvents').checked == true)
  	{
  		activeEvent = true;
  		screenshotReq  = await fetch('/api/clientScreenshot/' + eventKey);
  		screenshotJson = await screenshotReq.json();

  		cardTitle.innerHTML = "Screenshot Captured";
  		cardText.innerHTML  = '<a href="'  + screenshotJson.fileName + '" target="_blank"><img src="' + screenshotJson.fileName + '" class="img-thumbnail"></a>';
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
  		cardText.innerHTML += "Typed Value: <b>" + userInputJson.inputValue + "</b>";
  	}
  	break;


  case 'XHROPEN':
  	if (document.getElementById('apiEvents').checked == true)
  	{
  		activeEvent = true;
  		xhrOpenReq  = await fetch('/api/clientXhrOpen/' + eventKey);
  		xhrOpenJson = await xhrOpenReq.json();

  		cardTitle.innerHTML = "API - XHR Open";
  		cardText.innerHTML  = "URL: <b>" + xhrOpenJson.url + "</b>";
  		cardText.innerHTML += "<br>";
  		cardText.innerHTML += "Method: <b>" + xhrOpenJson.method + "</b>";
  	}
  	break;

  case 'XHRSETHEADER':
  	if (document.getElementById('apiEvents').checked == true)
  	{
  		activeEvent = true;
  		xhrHeaderReq  = await fetch('/api/clientXhrSetHeader/' + eventKey);
  		xhrHeaderJson = await xhrHeaderReq.json();

  		cardTitle.innerHTML = "API - XHR Set Header";
  		cardText.innerHTML  = "Header: <b>" + xhrHeaderJson.header + "</b>";
  		cardText.innerHTML += "<br>";
  		cardText.innerHTML += "Value: <b>" + xhrHeaderJson.value + "</b>";
  	}
  	break;

  case 'XHRCALL':
  	if (document.getElementById('apiEvents').checked == true)
  	{
  		activeEvent = true;

  		cardTitle.innerHTML = "API - XHR Call";
  		cardText.innerHTML += '<br><button type="button" class="btn btn-primary" onclick=showReqRespViewer(' 
  		+ eventKey + ',"XHR")>View API Call</button>';
  	}
  	break;

  case 'FETCHSETUP':
  	if (document.getElementById('apiEvents').checked == true)
  	{
  		activeEvent = true;
  		fetchSetupReq  = await fetch('/api/clientFetchSetup/' + eventKey);
  		fetchSetupJson = await fetchSetupReq.json();

  		cardTitle.innerHTML = "API - Fetch Setup";
  		cardText.innerHTML  = "URL: <b>" + fetchSetupJson.url + "</b>";
  		cardText.innerHTML += "<br>";
  		cardText.innerHTML += "Method: <b>" + fetchSetupJson.method + "</b>";
  	}
  	break;

  case 'FETCHHEADER':
  	if (document.getElementById('apiEvents').checked == true)
  	{
  		activeEvent = true;
  		fetchHeaderReq  = await fetch('/api/clientFetchHeader/' + eventKey);
  		fetchHeaderJson = await fetchHeaderReq.json();

  		cardTitle.innerHTML = "API - Fetch Header";
  		cardText.innerHTML  = "Header: <b>" + fetchHeaderJson.header + "</b>";
  		cardText.innerHTML += "<br>";
  		cardText.innerHTML += "Value: <b>" + fetchHeaderJson.value + "</b>";
  	}
  	break;

  case 'FETCHCALL':
  	if (document.getElementById('apiEvents').checked == true)
  	{
  		activeEvent = true;

  		cardTitle.innerHTML = "API - Fetch Call";
  		cardText.innerHTML += '<br><button type="button" class="btn btn-primary" onclick=showReqRespViewer(' 
  		+ eventKey + ',"FETCH")>View API Call</button>';
  	}
  	break;

  default:
  	alert('!!!!Switch default-No good');
  }


    // Only need the bottom part of the card
    // if the event in the loop is active
  if (activeEvent)
  {
  	cardSubtitle.innerHTML = humanized_time_span(event.timeStamp);

  	cardBody.appendChild(cardTitle);
  	cardBody.appendChild(cardSubtitle);
  	cardBody.appendChild(cardText);

  	card.appendChild(cardBody);

  	cardStack.appendChild(card);    	
  }
}
}





function unselectAllClients()
{
	// Remove detail cards
	detailCardStack = document.getElementById('detail-stack');
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



// Search bar filtering. Shows any card 
// whose innterHTML contains the string
function filterClients()
{
	var searchBar   = document.getElementById('searchClientInput');
	var searchTerm  = searchBar.value.toLowerCase();
	var cardStack   = document.getElementById('client-stack');
	var clientCards = cardStack.getElementsByClassName('card');

	// Regular expressions to extract data
	const titleRegex    = /<u>(.*?)<\/u>/;
	const ipRegex       = /ip:<b>\s*(.*?)\s*<\/b>/;
	const platformRegex = /platform:<b>\s*(.*?)\s*<\/b>/;
	const browserRegex  = /browser:<b>\s*(.*?)\s*<\/b>/;


	for (let i = 0; i < clientCards.length; i++)
	{
		const card = clientCards[i];
		clientText = card.innerHTML.toLowerCase();

		// Extract data using regex
		const titleMatch    = clientText.match(titleRegex);
		const ipMatch       = clientText.match(ipRegex);
		const platformMatch = clientText.match(platformRegex);
		const browserMatch  = clientText.match(browserRegex);

		// Extracted data
		var cardTitle = titleMatch ? titleMatch[1] : '';
		var ip        = ipMatch ? ipMatch[1] : '';
		var platform  = platformMatch ? platformMatch[1] : '';
		var browser   = browserMatch ? browserMatch[1] : '';

		ip       = ip.replace(/&nbsp;/g, '');
		platform = platform.replace(/&nbsp;/g, '');
		browser  = browser.replace(/&nbsp;/g, '');
		
		var cleanedString = cardTitle + ip + platform + browser;

		if (cleanedString.indexOf(searchTerm) !== -1)
		{
			card.style.display="block";
		}
		else
		{
			card.style.display="none";
		}
	}
}




async function updateClients()
{
	// Get client info
	var req = await fetch('/api/getClients');
	var clientsJson = await req.json();

	// Start setting up the client cards
	var cardStack = document.getElementById('client-stack');

	// First clear out our existing cards
	while (cardStack.firstChild)
	{
		cardStack.firstChild.remove();
	}


	var jsonResponse = await sortClients(clientsJson);


	// let's layout our clients
	for (let i = 0; i < jsonResponse.length; i++)
	{
		client = jsonResponse[i];

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

  cardText.innerHTML += "<br>Platform:<b>&nbsp;&nbsp;&nbsp;" + client.platform + "</b><br>";
  cardText.innerHTML += "Browser:<b>&nbsp;&nbsp;&nbsp;" + client.browser + "</b>";

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


  cardSubtitle.innerHTML  = "First Seen: " + humanized_time_span(client.firstSeen) + "&nbsp;&nbsp;&nbsp;";
  cardSubtitle.innerHTML += "Last Seen: <b>" + humanized_time_span(client.lastSeen) + "</b>";


  cardBody.appendChild(cardTitle);
  cardBody.appendChild(cardSubtitle);
  cardBody.appendChild(cardText);

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

filterClients();
}




setInterval(updateClients, 5000);

updateClients();