
//  "App" JavaScript
function xhrGetAnswer()
{
	// console.log("Sending XHR request...");

	request = new XMLHttpRequest();
	request.open("POST", "/api/xhrAnswer");
	request.responseType = "json";
	request.setRequestHeader("Content-type", "application/json; charset=UTF-8");
	request.setRequestHeader("Authorization", "ABCXYZSLEEVELESSINSEATTLEFTW");

	var jsonData = new Object();
	jsonData["request"] = "answer";
	var jsonString = JSON.stringify(jsonData);
	request.send(jsonString);

	request.onload = function() {
		var jsonResponse = request.response;

		var answer = jsonResponse.answer;

		// console.log("Get XHR answer: " + answer);

		var answerSpot = document.getElementById("answerHeader");
		answerSpot.innerHTML = "Answer: <i>" + answer + "</i>";
	};
}



async function fetchGetAnswer()
{
	// console.log("Sending Fetch request...");

	var req = await fetch('/api/fetchAnswer', {
		method:"POST",
		body: JSON.stringify({
			'request': 'answer'
		}),
		headers: {
			"Content-type": "application/json; charset=UTF-8",
			"Authorization": "ABCXYZSLEEVELESSINSEATTLEFTW"
		}
	});

	var jsonResponse = await req.json();
	var answer = jsonResponse.answer;

	// console.log("Got fetch answer: " + answer);

	var answerSpot = document.getElementById("answerHeader");
	answerSpot.innerHTML = "Answer: <i>" + answer + "</i>";
}






//  Payload simulated code below
const originalOpen = XMLHttpRequest.prototype.open;
const originalSend = XMLHttpRequest.prototype.send;

function monkeyPatch()
{
	console.log("!! Throwing monkey wrenches");


	//Monkey patch open
	XMLHttpRequest.prototype.open = function(method, url, async, user, password) 
	{
		var method = arguments[0];
		var url = arguments[1];
		uri = url;

		console.log(method);
		console.log(url);
		originalOpen.apply(this, arguments);;
	}



  	// Monkey patch send
	XMLHttpRequest.prototype.send = function(data) 
	{
		console.log(data);
		originalSend.apply(this, arguments);
	}

}