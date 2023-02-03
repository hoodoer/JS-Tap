#!usr/bin/env python
import os
import time
import datetime
#import pandas as pd 
import dataframe_image as dfi
import fpdf
from fpdf import FPDF



def printHeader():
	print("Header stuffs...")



def create_title(title, pdf):

	# Add main title
	pdf.set_font('Helvetica', 'b', 20)  
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
	pdf.ln(6)




def readSession():
	print("Reading session file...")


	directories = os.listdir("./loot")

	print("Directories: " + str(directories))


	for lootDir in directories:
		path = "./loot/" + lootDir
		if (os.path.isdir(path)):
			# Ok, we have a client loot directory
			# This will be one report per loop
			sessionFile = open(path + "/sessionLog.txt", "r")
			sessionLines = sessionFile.readlines()

			# Generate PDF
			Title = "TrustedSec Intel Report"

			# A4 size in mm
			Width = 210
			Height = 297

			pdf = FPDF()

			# First page
			pdf.add_page()
			create_title(Title, pdf)
			# write_to_pdf(pdf, "Client: ")


			for line in sessionLines:
				print("--- " + line)
				if ("Session identifier:" in line):
					splitLine = line.split(": ")
					sessionID = splitLine[1]
					print("Pulled client ID: " + sessionID)
					# write_to_pdf(pdf, "Client: " + sessionID)

					pdf.set_text_color(r=0,g=0,b=0)
					pdf.set_font('Helvetica', 'b', 16)

					pdf.write(5, "Client: " + sessionID)
					pdf.ln(5)

				else:
					# Normal line, we need to parse the type of event and 
					# timestamps
					splitLine = line.split(": ")
					timeStamp = splitLine[0]
					# print("Timestamp is: " + timeStamp)
					date_conv = time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(float(timeStamp)))

					# print("Timestamp: " + timeStamp)
					# intTime = timeStamp.split(".")[0]
					# date_conv = time.localtime(int(intTime))
					# # cleanTime = datetime.datetime.fromtimestamp(int(intTime))
					print("Cleaned up time: " + date_conv)
					writeLine = date_conv + " UTC:"
					pdf.ln(5)
					write_to_pdf(pdf, writeLine, True)

					# Ok, now handle the event type:
					eventType = splitLine[1]
					print("Got event type: " + eventType)

					if (eventType == "URL Visited"):
						write_to_pdf(pdf, eventType + "\n" + splitLine[2], False)
					elif (eventType == "User input field"):
						write_to_pdf(pdf, eventType + "\n" + splitLine[2], False)
					elif (eventType == "Cookie Name"):
						write_to_pdf(pdf, eventType + "\n" + splitLine[2], False)
					elif (eventType == "Local Storage Entry"):
						write_to_pdf(pdf, eventType + "\n" + splitLine[2], False)
					elif (eventType == "Screenshot"):
						write_to_pdf(pdf, eventType, False)
						imageFile = path + "/" + splitLine[2]
						imageFile = imageFile[:-1]
						pdf.image(imageFile, w=170)
						#pdf.image("./loot/client_1/1_Screenshot.png", w=170)

						pdf.ln(10)
					else:
						print("ERROR: Unhandled event type in generator")






			print("Output path is: " + path)
			pdf.output(path + ".pdf")



			return

	# # Generate PDF
	# Title = "TrustedSec Intel Report"

	# # A4 size in mm
	# Width = 210
	# Height = 297

	# pdf = FPDF()

	# # First page
	# pdf.add_page()
	# create_title(Title, pdf)


	# write_to_pdf(pdf, "TrustedSec Intel Report")
	# pdf.image("./loot/client_1/1_Screenshot.png", w=170)
	# pdf.ln(15)


	# pdf.output("./testReport.pdf", 'F')





if __name__ == '__main__':
	printHeader()

	readSession()

