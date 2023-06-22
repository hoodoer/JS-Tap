apiServer = "https://127.0.0.1:8444";


function getClients()
{


	var req = new XMLHttpRequest();
	req.responseType = 'json';
	req.open('GET', apiServer + "/api/getClients", true);
	req.onload  = function() {
	   var jsonResponse = req.response;
	   console.log(JSON.stringify(jsonResponse));


	   $(document).ready(function() {
	   	$('table').bootstrapTable({
	   		data: clientData
	   	});
	   });

	   var clientData = 
	   [
	   {
	   	"id": "test",
	   	"nickname": "testNickname",
	   	"lastSeen": "42 seconds"
	   }];

	   // do something with jsonResponse
	};
	req.send(null);
}



getClients();