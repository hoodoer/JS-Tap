var scrapedHtmlCode = "";

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



function showHtmlCode()
{
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



function showReqRespViewer(requestBody, responseBody)
{
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

			// Dump it in a variable. So many issues trying to pass this code in generated HTML lol
    		scrapedHtmlCode = htmlScrapeJson.code;

    		cardTitle.innerHTML = "HTML Scraped";
    		cardText.innerHTML  = "URL: <b>" + htmlScrapeJson.url + "</b><br><br>";
    		cardText.innerHTML += '<button type="button" class="btn btn-primary" onclick="showHtmlCode()">View Code</button>';
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
    		cardText.innerHTML += "Method: <b>" + xhrHeaderJson.value + "</b>";
    	}
    	break;

    case 'XHRCALL':
    	if (document.getElementById('apiEvents').checked == true)
    	{
    		activeEvent = true;
    		xhrCallReq  = await fetch('/api/clientXhrCall/' + eventKey);
    		xhrCallJson = await xhrCallReq.json();

    		requestData  = xhrCallJson.requestBody;
    		responseData = xhrCallJson.responseBody;

    		cardTitle.innerHTML = "API - XHR Call";
    		cardText.innerHTML += '<br><button type="button" class="btn btn-primary" onclick=showReqRespViewer(' + `'` 
    		+ xhrCallJson.requestBody + `','` + xhrCallJson.responseBody  + `'`+ ')>View API Call</button>';
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
    		cardText.innerHTML += "Method: <b>" + fetchHeaderJson.value + "</b>";
    	}
    	break;

    case 'FETCHCALL':
    	if (document.getElementById('apiEvents').checked == true)
    	{
    		activeEvent = true;
    		fetchCallReq  = await fetch('/api/clientFetchCall/' + eventKey);
    		fetchCallJson = await fetchCallReq.json();

    		requestData  = fetchCallJson.requestBody;
    		responseData = fetchCallJson.responseBody;

    		cardTitle.innerHTML = "API - Fetch Call";
    		cardText.innerHTML += '<br><button type="button" class="btn btn-primary" onclick=showReqRespViewer(' + `'` 
    		+ fetchCallJson.requestBody + `','` + fetchCallJson.responseBody  + `'`+ ')>View API Call</button>';
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

    cardTitle.innerHTML = "<u>" + client.nickname + "</u>";

    if (client.isStarred)
    {
    	cardTitle.innerHTML += '<img src="/protectedStatic/star-fill.svg" style="float: right;" onclick="toggleStar(this, event,' + `'` + client.id + `','` + client.nickname + `')">`;
    }
    else
    {
    	cardTitle.innerHTML += '<img src="/protectedStatic/star.svg" style="float: right;" onclick="toggleStar(this, event,' + `'` + client.id + `','` + client.nickname + `')">`;
    }



    cardText.innerHTML  = "IP:<b>&nbsp;&nbsp;&nbsp;" + client.ip + "</b><br>";
		//What to do about client notes?
    if (client.notes.length > 0)
    {
    	cardText.innerHTML += '<button type="button" class="btn btn-primary" style="float: right;" onclick=showNoteEditor(event,' + `'` 
    	+ client.id + `','` + client.nickname  + `','` + client.notes + `'`+ ')>Edit Notes</button>';
    }
    else
    {
    	cardText.innerHTML += '<button type="button" class="btn btn-primary" style="float: right;" onclick=showNoteEditor(event,' + `'` 
    	+ client.id + `','` + client.nickname  + `','` + client.notes + `'`+ ')>Add Notes</button>';
    }

    cardText.innerHTML += "Platform:<b>&nbsp;&nbsp;&nbsp;" + client.platform + "</b><br>";
    cardText.innerHTML += "Browser:<b>&nbsp;&nbsp;&nbsp;" + client.browser + "</b>";

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
}




// Every 2 seconds...
setInterval(updateClients, 5000);

updateClients();