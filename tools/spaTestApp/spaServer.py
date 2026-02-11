#!usr/bin/env python
from flask import Flask, request, make_response, jsonify


app = Flask(__name__)


# In-memory quest storage
quests = [
    {"id": 1, "title": "Seek the Holy Grail", "done": False},
    {"id": 2, "title": "Bring me a shrubbery", "done": True},
    {"id": 3, "title": "Answer the Bridge Keeper's three questions", "done": False},
    {"id": 4, "title": "Defeat the Black Knight ('tis but a scratch)", "done": False},
    {"id": 5, "title": "Run away from the Killer Rabbit of Caerbannog", "done": True},
    {"id": 6, "title": "Count to three (not five)", "done": False},
]
next_id = 7


@app.route('/spa.html', methods=['GET'])
def sendHtml():
    with open('./spa.html', 'r') as file:
        html = file.read()
        return make_response(html, 200)


@app.route('/spa.js', methods=['GET'])
def sendJavaScript():
    with open('./spa.js', 'r') as file:
        code = file.read()
        response = make_response(code, 200)
        response.headers['Content-Type'] = 'application/javascript'
        return response


# Catch-all: serve the SPA shell for any path
# This lets pushState routes like /tavern, /quests work on refresh
@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def catch_all(path):
    # Don't catch API routes
    if path.startswith('api/'):
        return make_response("Not found", 404)
    with open('./spa.html', 'r') as file:
        html = file.read()
        return make_response(html, 200)


# --- API endpoints ---

@app.route('/api/quests', methods=['GET'])
def get_quests():
    return jsonify(quests)


@app.route('/api/quests', methods=['POST'])
def add_quest():
    global next_id
    data = request.json
    quest = {"id": next_id, "title": data.get("title", ""), "done": False}
    next_id += 1
    quests.append(quest)
    return jsonify(quest), 201


@app.route('/api/quests/<int:quest_id>/toggle', methods=['POST'])
def toggle_quest(quest_id):
    for quest in quests:
        if quest["id"] == quest_id:
            quest["done"] = not quest["done"]
            return jsonify(quest)
    return make_response("None shall pass", 404)


@app.route('/api/quests/<int:quest_id>', methods=['DELETE'])
def delete_quest(quest_id):
    global quests
    quests = [q for q in quests if q["id"] != quest_id]
    return jsonify({"deleted": quest_id, "message": "Run away! Run away!"})


@app.route('/api/swallow', methods=['POST'])
def swallow_velocity():
    data = request.json
    species = data.get("species", "european")
    if species.lower() == "african":
        return jsonify({"velocity": "Oh yeah, an African swallow maybe, but not a European swallow.", "mph": "~24"})
    elif species.lower() == "european":
        return jsonify({"velocity": "An unladen swallow? About 11 meters per second.", "mph": "~24"})
    else:
        return jsonify({"velocity": "Are you suggesting coconuts migrate?", "mph": "N/A"})


if __name__ == '__main__':
    app.run(debug=False, host='0.0.0.0', port=8443, ssl_context='adhoc')
