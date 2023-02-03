#!usr/bin/env python
import os
import time
import datetime
#import pandas as pd 
import dataframe_image as dfi
import fpdf
from fpdf import FPDF



def printHeader():
    print("""
                                    ▐▄• ▄ .▄▄ · .▄▄ ·                       
             .* ./,                  █▌█▌▪▐█ ▀. ▐█ ▀.                
             ,    ,,,                ·██· ▄▀▀▀█▄▄▀▀▀█▄                                           
            *     .,.*              ▪▐█·█▌▐█▄▪▐█▐█▄▪▐█                                           
           ,*      ,. *.            •▀▀ ▀▀ ▀▀▀▀  ▀▀▀▀         .(/,#/            
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
                                     •██  ▐█ ▀█ ▐█ ▄█        IПƬΣᄂ
                                      ▐█.▪▄█▀▀█  ██▀·        ЯΣPӨЯƬ
                                      ▐█▌·▐█ ▪▐▌▐█▪·•        GΣПΣЯΛƬӨЯ
                                      ▀▀▀  ▀  ▀ .▀   
                                    by ＠ｈｏｏｄｏｅｒ
        """)



def create_title(title, pdf):

	# Add main title
	pdf.set_font('Helvetica', 'b', 30)  
	pdf.ln(40)
	pdf.write(5, title)
	pdf.ln(10)
	
	# Add date of report
	pdf.set_font('Helvetica', '', 14)
	pdf.set_text_color(r=128,g=128,b=128)
	today = time.strftime("%d/%m/%Y")
	pdf.write(4, "Report Generated: " + f'{today}')
	
	# Add line break
	pdf.ln(10)


def write_to_pdf(pdf, words, bold):
	# Set text colour, font size, and font type
	pdf.set_text_color(r=0,g=0,b=0)
	if (bold):
		pdf.set_font('Helvetica', 'b', 12)
	else:
		pdf.set_font('Helvetica', '', 12)
	
	# pdf.set_font('Helvetica', '', 12)
	
	pdf.write(5, words)
	#pdf.ln(6)




def readSession():
	print("Reading spy notes...")


	directories = os.listdir("./loot")

	#print("Directories: " + str(directories))


	for lootDir in directories:
		path = "./loot/" + lootDir
		if (os.path.isdir(path)):
			# Ok, we have a client loot directory
			# This will be one report per loop
			sessionFile = open(path + "/sessionLog.txt", "r")
			sessionLines = sessionFile.readlines()

			# Generate PDF
			Title = "TrustedSec XSS-TAP\n\nIntel Report"

			# A4 size in mm
			Width = 210
			Height = 297

			pdf = FPDF()

			# First page
			pdf.add_page()
			create_title(Title, pdf)
			# write_to_pdf(pdf, "Client: ")


			for line in sessionLines:
				print("thunking on spy notes...")
				if ("Session identifier:" in line):
					splitLine = line.split(": ")
					sessionID = splitLine[1]
					print("Pulled client ID: " + sessionID)
					# write_to_pdf(pdf, "Client: " + sessionID)

					pdf.set_text_color(r=0,g=0,b=0)
					pdf.set_font('Helvetica', 'b', 16)

					pdf.write(5, "Client: \n" + sessionID)
					pdf.ln(5)
					pdf.image("./reportSplash.png", w=170)



				else:
					# Normal line, we need to parse the type of event and 
					# timestamps
					splitLine = line.split(": ")
					timeStamp = splitLine[0]
					date_conv = time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(float(timeStamp)))

					# Ok, now handle the event type:
					eventType = splitLine[1]
					#print("Got event type: " + eventType)

					if (eventType == "URL Visited"):
						# New URL, let's break the page
						pdf.add_page()

					#print("Cleaned up time: " + date_conv)
					writeLine = date_conv + " UTC:\n"
					pdf.ln(5)
					write_to_pdf(pdf, writeLine, False)

					if (eventType == "URL Visited"):
						write_to_pdf(pdf, eventType + ":\n", False)
						write_to_pdf(pdf, splitLine[2] + "\n", True)
					elif (eventType == "User input field"):
						values = splitLine[2].split(", ")
						write_to_pdf(pdf, eventType + ": ", False)
						write_to_pdf(pdf, values[0] + "\n", True)
						write_to_pdf(pdf, values[1] + ": ", False)
						write_to_pdf(pdf, splitLine[3] + "\n", True)
					elif (eventType == "Cookie Name"):
						values = splitLine[2].split(", ")
						write_to_pdf(pdf, eventType + ": ", False)
						write_to_pdf(pdf, values[0] + "\n", True)
						write_to_pdf(pdf, values[1] + ": ", False)
						write_to_pdf(pdf, splitLine[3] + "\n", True)
					elif (eventType == "Local Storage Entry"):
						values = splitLine[2].split(", ")
						write_to_pdf(pdf, eventType + ": ", False)
						write_to_pdf(pdf, values[0] + "\n", True)
						write_to_pdf(pdf, values[1] + ": ", False)
						write_to_pdf(pdf, splitLine[3] + "\n", True)
					elif (eventType == "Screenshot"):
						write_to_pdf(pdf, eventType + "\n", False)
						imageFile = path + "/" + splitLine[2]
						imageFile = imageFile[:-1]
						pdf.image(imageFile, w=170)
						pdf.ln(10)
					else:
						print("ERROR: Unhandled event type in generator")


			print("Intel report file: " + path + ".pdf")
			pdf.output(path + ".pdf")




if __name__ == '__main__':
	printHeader()

	readSession()

