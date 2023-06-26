let selectedClientId = "";



function unselectAllClients()
{
	let clientTable = document.getElementById('client-table');
	let rows = clientTable.rows;

	for (let i = 0; i < rows.length; i++)
	{
		rows[i].classList.remove("table-active");
	}
}



function getClientDetails(id)
{
	console.log("** Fetching details for client: " + id);

	var req = new XMLHttpRequest();
	req.responseType = 'json';
	req.open('GET', "/api/clientScreenshots/" + id, true);
	req.onload  = function() {
		console.log("Got client screenshot response");

	};
	req.send(null);

}


function updateClients()
{
	var req = new XMLHttpRequest();
	req.responseType = 'json';
	req.open('GET', "/api/getClients", true);
	req.onload  = function() {
		var jsonResponse = req.response;

		var new_clientTable = document.createElement('tbody');
		new_clientTable.setAttribute("id", "client-table");

		for (let i = 0; i < jsonResponse.length; i++)
		{
			var row = new_clientTable.insertRow(-1);
			var cell1 = row.insertCell(0);
			var cell2 = row.insertCell(1);
			var cell3 = row.insertCell(2);   

			cell1.innerHTML = jsonResponse[i].id;
			cell2.innerHTML = jsonResponse[i].nickname;
			cell3.innerHTML = jsonResponse[i].lastSeen;

		   // Keep the selected client selected on refresh
			if (jsonResponse[i].id == selectedClientId)
			{
				row.classList.add("table-active");
			}
		}

		var old_clientTable = document.getElementById('client-table');
		old_clientTable.parentNode.replaceChild(new_clientTable, old_clientTable);


	   	// Add click interaction
		let clientTable = document.getElementById('client-table');

		let rows = clientTable.rows;

		for (let i = 0; i < rows.length; i++)
		{
			// console.log("loop... " + i);
			rows[i].addEventListener("click", function() {
				unselectAllClients();
				rows[i].classList.add("table-active");
				selectedClientId = rows[i].cells[0].innerHTML;
				getClientDetails(selectedClientId);
			})
		}
	};
	req.send(null);
}



// Every 2 seconds...
setInterval(updateClients, 2000);

updateClients();