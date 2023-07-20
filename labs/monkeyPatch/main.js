
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

		var status = request.status;

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





// ****************************************************************
//  Payload simulated code below

function monkeyPatch()
{

	// XHR Part
	const xhrOriginalOpen      = XMLHttpRequest.prototype.open;
	const xhrOriginalSetHeader = XMLHttpRequest.prototype.setRequestHeader;
	const xhrOriginalSend      = XMLHttpRequest.prototype.send;

	console.log("!! Throwing monkey wrenches");


	//Monkey patch open
	XMLHttpRequest.prototype.open = function(method, url, async, user, password) 
	{
		var method = arguments[0];
		var url = arguments[1];

		console.log("Intercepted XHR open: " + method + ", " + url);
		xhrOriginalOpen.apply(this, arguments);
	}



	// Monkey patch setRequestHeader
	XMLHttpRequest.prototype.setRequestHeader = function (header, value)
	{
		var header = arguments[0];
		var value  = arguments[1];

		console.log("Intercepted Header = " + header + ": " + value);

		xhrOriginalSetHeader.apply(this, arguments);
	}


  	// Monkey patch send
	XMLHttpRequest.prototype.send = function(data) 
	{
		console.log("Intercepted request body: " + data);


		this.onreadystatechange = function()
		{
			if (this.readyState === 4)
			{
				var data;

				if (!this.responseType || this.responseType === "text") 
				{
					data = this.responseText;
				} 
				else if (this.responseType === "document") 
				{
					data = this.responseXML;
				} 
				else if (this.responseType === "json") 
				{
					data = JSON.stringify(this.response);
				} 
				else 
				{
					data = xhr.response;
				}

				// var response = read_body(this);
				console.log("Intercepted response: " + data);
			}
		};

		xhrOriginalSend.apply(this, arguments);
	}



	// Fetch part
}