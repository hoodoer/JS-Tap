apiServer = "https://127.0.0.1:8444";


function getClients()
{
	var req = new XMLHttpRequest();
	req.responseType = 'json';
	req.open('GET', apiServer + "/api/getClients", true);
	req.onload  = function() {
	   var jsonResponse = req.response;
	   // console.log(JSON.stringify(jsonResponse));


	   var new_clientTable = document.createElement('tbody');
	   new_clientTable.setAttribute("id", "client-table");

	   // var table = document.getElementById('client-table');
	   // table.remove();

	   for (let i = 0; i < jsonResponse.length; i++)
	   {
		   var row = new_clientTable.insertRow(-1);
		   var cell1 = row.insertCell(0);
		   var cell2 = row.insertCell(1);
		   var cell3 = row.insertCell(2);   

		   cell1.innerHTML = jsonResponse[i].id;
		   cell2.innerHTML = jsonResponse[i].nickname;
		   cell3.innerHTML = jsonResponse[i].lastSeen;	
	   }

	   	var old_clientTable = document.getElementById('client-table');
	   	old_clientTable.parentNode.replaceChild(new_clientTable, old_clientTable);
	};
	req.send(null);
}

// Every 2 seconds...
setInterval(getClients, 2000);
