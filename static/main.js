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


var cookies = [];
var localStores = [];
var sessionStores = [];
var urlsVisited = [];


//  Back to my code

function getEventDetails(event)
{
	console.log("Fetting event details for: " + event.eventType);

	switch(event.eventType)
	{
	case 'COOKIE':
		console.log("cookie...");
		var req = new XMLHttpRequest();
		req.responseType = 'json';
		req.open('GET', "/api/clientCookies/" + event.eventID, true);
		req.onload  = function() {
			var jsonResponse = req.response;
			cookies.push(jsonResponse);
		};
		req.send(null);

		break;

	case 'LOCALSTORAGE':
		console.log("localstorage...");
		var req = new XMLHttpRequest();
		req.responseType = 'json';
		req.open('GET', "/api/clientLocalStorage/" + event.eventID, true);
		req.onload  = function() {
			var jsonResponse = req.response;
			localStores.push(jsonResponse);
		};
		req.send(null);
		// cardTitle.innerHTML = "Local Storage Value";


		break;

	case 'SESSIONSTORAGE':
		console.log("sessionstorage...");
		var req = new XMLHttpRequest();
		req.responseType = 'json';
		req.open('GET', "/api/clientSessionStorage/" + event.eventID, true);
		req.onload  = function() {
			var jsonResponse = req.response;
			sessionStores.push(jsonResponse);
		};
		req.send(null);
		// cardTitle.innerHTML = "Local Storage Value";
		// cardTitle.innerHTML = "Session Storage Value";


		break;

	case 'URLVISITED':
		console.log("urlvisited...");
		// cardTitle.innerHTML = "URL Location Change";


		break;

	case 'HTML':
		console.log("HTML...");
		// cardTitle.innerHTML = "HTML Code Scraped";


		break;

	case 'SCREENSHOT':
		console.log("screenshot...");
		// cardTitle.innerHTML = "Screenshot Captured";


		break;

	case 'USERINPUT':
		console.log("userinput...");
		// cardTitle.innerHTML = "User Input Captured";


		break;

	default:
		alert('!!!!Switch default-No good');
	}



}



function getClientDetails(id)
{
	console.log("** Fetching details for client: " + id);

	var req = new XMLHttpRequest();
	req.responseType = 'json';
	req.open('GET', "/api/clientEvents/" + id, true);
	req.onload  = function() {
		var jsonResponse = req.response;

		// console.log("Got client event response");
		// console.log(req.response);

		var new_clientDetailsTable = document.createElement('tbody');
		new_clientDetailsTable.setAttribute("id", "client-details-table");

		for (let i = 0; i < jsonResponse.length; i++)
		{
			event = jsonResponse[i];
			getEventDetails(event);

			console.log("** Event loop: " + i);
			//  Working but very boring rows
			// var row = new_clientDetailsTable.insertRow(-1);
			// var cell1 = row.insertCell(0);
			// var cell2 = row.insertCell(1);
			// var cell3 = row.insertCell(2);

			// // console.log("^^^^^ Nice timing output: " + humanized_time_span(jsonResponse[i].timeStamp))
			// cell1.innerHTML = humanized_time_span(jsonResponse[i].timeStamp);
			// cell2.innerHTML = jsonResponse[i].eventType;
			// cell3.innerHTML = "stub"


			// Need to fetch all the information first
			// Then build up UI
			// 

			// Cards
			// var cardStack = document.getElementById('detail-stack');

			// var card = document.createElement('div');
			// card.className ='card';
			
			// var cardBody = document.createElement('div');
			// cardBody.className = 'card-body';
			
			// var cardTitle = document.createElement('h5');
			// cardTitle.className = "card-title";

			// var cardSubtitle = document.createElement('h6');
			// cardSubtitle.className = "card-subtitle mb-2 text-muted";

			// var cardText = document.createElement('p');
			// cardText.className = 'card-text';

			// // Time will be the same across events
			// cardSubtitle.innerHTML = humanized_time_span(jsonResponse[i].timeStamp);

			// cardText.innerHTML = "DB Key is " + jsonResponse[i].eventID;

			// var eventKey = jsonResponse[i].eventID;

			// We'll want different layouts for
			// different event types
			// switch(jsonResponse[i].eventType)
			// {
			// case 'COOKIE':
			// 	console.log("cookie...");
			// 	cardTitle.innerHTML = "Cookie Value";

			// 	var cookieReq = new XMLHttpRequest();
			// 	cookieReq.responseType = 'json';
			// 	cookieReq.open('GET', "/api/clientCookies/" + eventKey, true);
			// 	cookieReq.onload  = function() {
			// 		var cookieJsonResponse = cookieReq.response;
			// 		cardText.innerHTML = "Cookie Name: " + cookieJsonResponse.cookieName;
			// 	};
			// 	cookieReq.send(null);

			// 	break;

			// case 'LOCALSTORAGE':
			// 	console.log("localstorage...");
			// 	cardTitle.innerHTML = "Local Storage Value";


			// 	break;

			// case 'SESSIONSTORAGE':
			// 	console.log("sessionstorage...");
			// 	cardTitle.innerHTML = "Session Storage Value";


			// 	break;

			// case 'URLVISITED':
			// 	console.log("urlvisited...");
			// 	cardTitle.innerHTML = "URL Location Change";


			// 	break;

			// case 'HTML':
			// 	console.log("HTML...");
			// 	cardTitle.innerHTML = "HTML Code Scraped";


			// 	break;

			// case 'SCREENSHOT':
			// 	console.log("screenshot...");
			// 	cardTitle.innerHTML = "Screenshot Captured";


			// 	break;

			// case 'USERINPUT':
			// 	console.log("userinput...");
			// 	cardTitle.innerHTML = "User Input Captured";


			// 	break;

			// default:
			// 	alert('!!!!Switch default-No good');
			// }




			// cardTitle.innerHTML = jsonResponse[i].eventType;

			// cardSubtitle.innerHTML = humanized_time_span(jsonResponse[i].timeStamp);

			// cardText.innerHTML = "Detail Stub";


			// cardBody.appendChild(cardTitle);
			// cardBody.appendChild(cardSubtitle);
			// cardBody.appendChild(cardText);

			// card.appendChild(cardBody);

			// cardStack.appendChild(card);
		}

		var old_clientDetailTable = document.getElementById('client-details-table');
		old_clientDetailTable.parentNode.replaceChild(new_clientDetailsTable, old_clientDetailTable);


	};
	req.send(null);

}



function unselectAllClients()
{
	let clientTable = document.getElementById('client-table');
	let rows = clientTable.rows;

	for (let i = 0; i < rows.length; i++)
	{
		rows[i].classList.remove("table-active");
	}
}


function updateClients()
{
	var req = new XMLHttpRequest();
	req.responseType = 'json';
	req.open('GET', "/api/getClients", true);
	req.onload  = function() {
		var jsonResponse = req.response;

		var new_clientTable = document.createElement('tbody');
		new_clientTable.setAttribute("id", "client-table");

		for (let i = 0; i < jsonResponse.length; i++)
		{
			var row = new_clientTable.insertRow(-1);
			var cell1 = row.insertCell(0);
			var cell2 = row.insertCell(1);
			var cell3 = row.insertCell(2);   

			cell1.innerHTML = jsonResponse[i].id;
			cell2.innerHTML = jsonResponse[i].nickname;
			cell3.innerHTML = humanized_time_span(jsonResponse[i].lastSeen);

		   // Keep the selected client selected on refresh
			if (jsonResponse[i].id == selectedClientId)
			{
				row.classList.add("table-active");
			}
		}

		var old_clientTable = document.getElementById('client-table');
		old_clientTable.parentNode.replaceChild(new_clientTable, old_clientTable);


	   	// Add click interaction
		let clientTable = document.getElementById('client-table');

		let rows = clientTable.rows;

		for (let i = 0; i < rows.length; i++)
		{
			// console.log("loop... " + i);
			rows[i].addEventListener("click", function() {
				unselectAllClients();
				rows[i].classList.add("table-active");
				selectedClientId = rows[i].cells[0].innerHTML;
				getClientDetails(selectedClientId);
			})
		}
	};
	req.send(null);
}



// Every 2 seconds...
setInterval(updateClients, 2000);

updateClients();