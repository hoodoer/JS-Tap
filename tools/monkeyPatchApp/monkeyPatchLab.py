#!usr/bin/env python
from flask import Flask, request, make_response, jsonify



app = Flask(__name__)





@app.route('/', methods=['GET'])
def index():
	with open('./monkeyPatchLab.html', 'r') as file:
		index = file.read()
		response = make_response(index, 200)

		return response



@app.route('/main.js', methods=['GET'])
def sendJavaScript():
	with open('./main.js', 'r') as file:
		code = file.read()
		response = make_response(code, 200)

		return response



@app.route('/api/xhrAnswer', methods=['POST'])
def sendXhrAnswer():
	requestContent = request.json

	responseData = {'answer':'42 of course!'}

	return jsonify(responseData)


@app.route('/api/fetchAnswer', methods=['POST'])
def sendFetchAnswer():
	requestContent = request.json

	responseData = {'answer':'Definitely vegemite.'}

	return jsonify(responseData)


@app.route('/api/jqueryAnswer', methods=['POST'])
def sendjQueryAnswer():
	requestContent = request.json

	responseData = {'answer':'Blue. No..wait-AHHHHHHH'}

	return jsonify(responseData)


@app.route('/submit', methods=['POST'])
def catchFormPost():
    try:
	    # Try to get JSON data from the request
	    data = request.get_json()
	    if data:
	        print("Received JSON data:", data)
	        secret_value = data.get("secret", "No secret provided")
	    else:
	        # If no JSON data, try form-encoded data
	        secret_value = request.form.get("secret", "No secret provided")
	        print("Received Form Data:", request.form)

	    # Respond to the client
	    return jsonify({"message": f"Received: {secret_value}"}), 200

    except Exception as e:
        print("Error handling request:", e)
        return jsonify({"error": "Something went wrong"}), 500




if __name__ == '__main__':
	app.run(debug=False, host='0.0.0.0', port=8443, ssl_context='adhoc')


