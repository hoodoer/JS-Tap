#!usr/bin/env python
import json
import threading
import time
import random
import requests


# Script to simulate clients sending in loot
# To stress test the system, see how well it
# holds up


numClients = 10


randStartRange = 1
randEndRange   = 10


apiServer = "https://127.0.0.1"
victimApp = "https://vulnerableapp.com"



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
		"conesnail"
}



class Client(threading.Thread):
	def __init__(self, client_id):
		super().__init__()
		self.client_id = client_id

		randomAdjective = random.choice(list(AdjectiveList))
		randomColor     = random.choice(list(ColorList))
		randomCritter   = random.choice(list(MurderCritter))

		self.nickname = randomAdjective + '-' + randomColor + '-' + randomCritter
		print("Client " + str(self.client_id) + " nickname: " + self.nickname)

		self._running  = True


	def run(self):
		while self._running:
			print("Client " + str(self.client_id) + " run loop")


			# Need a pattern of behavior here
			# URL change
			# Storage/cookie change
			# Screenshot
			# HTML Scrape
			# User Inputs
			# API Calls





			sleepAmount = random.randint(randStartRange, randEndRange)
			print("Client " + str(self.client_id) + " waiting: " + str(sleepAmount))
			time.sleep(sleepAmount)



	def stop(self):
		print("Stopping client thread...")
		self._running = False


	def cookieEvent():
		print("Sending cookie...")


	def localStorageEvent():
		print("Sending local storage event...")


	def sessionStorageEvent():
		print("Sending session storage event...")


	def urlEvent():
		print("Sending URL event...")


	def htmlEvent():
		print("Sending HTML event...")


	def screenshotEvent():
		print("Sending screenshot event...")


	def userInputEvent():
		print("Sending user input event...")


	def xhrOpenEvent():
		print("Sending XHR Open event...")


	def xhrSetHeaderEvent():
		print("Sending XHR Header Event...")


	def xhrCallEvent():
		print("Sending XHR call event...")


	def fetchSetupEvent():
		print("Sending Fetch Setup Event...")


	def fetchHeaderEvent():
		print("Sending Fetch Header Event...")


	def fetchCallEvent():
		print("Sending Fetch Call Event...")






if __name__ == "__main__":
	clientThreads = []

	for i in range(numClients):
		clientThread = Client(client_id=i)
		clientThread.start()
		clientThreads.append(clientThread)


	try:
		while True:
			time.sleep(5)
	except KeyboardInterrupt:
		for clientThread in clientThreads:
			clientThread.stop()

		for clientThread in clientThreads:
			clientThread.join()