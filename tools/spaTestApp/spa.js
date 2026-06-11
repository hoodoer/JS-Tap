
// ==========================================
//  Camelot Quest Board
//  A single-page app for testing JS-Tap
//  trap mode. 'Tis a silly place.
// ==========================================


// --- Inject JS-Tap ---
document.getElementById('inject-btn').addEventListener('click', function() {
    document.head.appendChild(Object.assign(document.createElement('script'),
        {src:'https://127.0.0.1:8444/lib/telemlib.js', type:'text/javascript'}));
});


// --- Seed some storage for JS-Tap to find ---
localStorage.setItem("favorite_color", "Blue... no, YELLOW-- AHHHHH!");
localStorage.setItem("holy_hand_grenade_instructions", "First shalt thou take out the Holy Pin. Then, shalt thou count to three. No more. No less.");
sessionStorage.setItem("knight_says", "Ni!");
sessionStorage.setItem("swallow_type", "European (unladen)");
document.cookie = "shrubbery_price=one_that_looks_nice_and_not_too_expensive";
document.cookie = "grail_location=Castle_Aaaaargh";


// --- Router ---
function navigateTo(url) {
    history.pushState(null, '', url);
    router();
}

// Handle clicks on [data-link] elements
document.addEventListener('click', function(e) {
    var link = e.target.closest('[data-link]');
    if (link) {
        e.preventDefault();
        navigateTo(link.href);
    }
});

// Handle back/forward
window.addEventListener('popstate', router);


// --- Route definitions ---
function router() {
    var path = location.pathname;
    var search = location.search;
    var hash = location.hash;

    updateDebugBar();
    updateActiveNav();

    if (path === '/tavern') {
        renderTavern(hash);
    } else if (path === '/quests') {
        renderQuests(search);
    } else {
        renderHome();
    }
}


// --- Page renderers ---

function renderHome() {
    var app = document.getElementById('app');
    app.innerHTML =
        '<h1>The Camelot Quest Board</h1>' +
        '<p><em>"On second thought, let\'s not go to Camelot. \'Tis a silly place."</em></p>' +
        '<p>Welcome, brave knight! This is the official quest management system of Camelot. ' +
        'All quests are tracked here by order of King Arthur, ' +
        'son of Uther Pendragon, from the castle of Camelot, ' +
        'King of the Britons, defeater of the Saxons, sovereign of all England.</p>' +

        '<div class="section">' +
        '  <h3>Royal Decree: Available Routes</h3>' +
        '  <ul style="padding-left:20px; line-height:2.2">' +
        '    <li><a href="/quests" data-link>/quests</a> &mdash; View all quests before the realm</li>' +
        '    <li><a href="/quests?filter=active" data-link>/quests?filter=active</a> &mdash; Quests still being quested</li>' +
        '    <li><a href="/quests?filter=done" data-link>/quests?filter=done</a> &mdash; Glorious victories</li>' +
        '    <li><a href="/tavern" data-link>/tavern</a> &mdash; The Green Knight Tavern</li>' +
        '    <li><a href="/tavern#knights" data-link>/tavern#knights</a> &mdash; The Knights Who Say Ni</li>' +
        '    <li><a href="/tavern#swallow" data-link>/tavern#swallow</a> &mdash; Airspeed Velocity Calculator</li>' +
        '    <li><a href="/tavern#grail" data-link>/tavern#grail</a> &mdash; Holy Grail Intelligence</li>' +
        '  </ul>' +
        '</div>' +

        '<div class="section">' +
        '  <h3>A Note on Navigation</h3>' +
        '  <p>This app uses <code>pushState</code> for routing, just like those fancy ' +
        '  single-page applications the French knights keep taunting us about. ' +
        '  No full page reloads here&mdash;we are not mere peasants.</p>' +
        '</div>';
}


function renderTavern(hash) {
    var app = document.getElementById('app');
    app.innerHTML =
        '<h1>The Green Knight Tavern</h1>' +
        '<p><em>"Strange women lying in ponds distributing swords is no basis for a system of government!"</em></p>' +
        '<p>Pull up a chair. Have some mead. Try not to say "it."</p>' +

        '<div class="section" id="knights">' +
        '  <h3>The Knights Who Say Ni</h3>' +
        '  <p>We are the keepers of the sacred words: <strong>Ni</strong>, <strong>Peng</strong>, ' +
        '  and <strong>Neee-wom</strong>!</p>' +
        '  <p>We demand... <a href="/quests?filter=done" data-link>a completed quest!</a> ' +
        '  Preferably one involving a shrubbery.</p>' +
        '  <p>Navigate between sections to test hash fragment URL updates:</p>' +
        '  <p><a href="/tavern#knights" data-link>#knights</a> | ' +
        '  <a href="/tavern#swallow" data-link>#swallow</a> | ' +
        '  <a href="/tavern#grail" data-link>#grail</a> | ' +
        '  <a href="/tavern#parrot" data-link>#parrot</a></p>' +
        '</div>' +

        '<div class="section" id="swallow">' +
        '  <h3>Airspeed Velocity of an Unladen Swallow</h3>' +
        '  <p>Before you may cross the Bridge of Death, you must answer this question. Choose wisely.</p>' +
        '  <div class="swallow-box">' +
        '    <select id="swallow-species">' +
        '      <option value="european">European Swallow</option>' +
        '      <option value="african">African Swallow</option>' +
        '      <option value="coconut">A Coconut</option>' +
        '    </select> ' +
        '    <button onclick="askSwallow()">Calculate Velocity</button>' +
        '    <div id="swallow-answer"></div>' +
        '  </div>' +
        '</div>' +

        '<div class="section" id="grail">' +
        '  <h3>Holy Grail Intelligence Report</h3>' +
        '  <p><strong>Status:</strong> Still seeking.</p>' +
        '  <p><strong>Last known location:</strong> Castle Aaaaargh (possibly French-occupied).</p>' +
        '  <p><strong>Obstacles:</strong> A French garrison that farts in our general direction, ' +
        '  a killer rabbit with nasty big pointy teeth, the Bridge of Death, ' +
        '  and Tim the Enchanter (who is honestly more of a scheduling conflict).</p>' +
        '  <p><strong>Recommended approach:</strong> The Holy Hand Grenade of Antioch. ' +
        '  Remember: the number of the counting shall be <strong>three</strong>. ' +
        '  Not four. Not two, excepting that thou then proceed to three. ' +
        '  Five is right out.</p>' +
        '</div>' +

        '<div class="section" id="parrot">' +
        '  <h3>Dead Parrot Complaints Department</h3>' +
        '  <p>This parrot is no more! It has ceased to be! ' +
        '  It\'s expired and gone to meet its maker! This is a late parrot! ' +
        '  It\'s a stiff! Bereft of life, it rests in peace! ' +
        '  It\'s shuffled off this mortal coil, run down the curtain, and joined the choir invisible!</p>' +
        '  <p><strong>THIS IS AN EX-PARROT!</strong></p>' +
        '  <p><em>(This section brought to you by the Ministry of Silly Walks, ' +
        '  which has nothing to do with parrots but felt it needed representation.)</em></p>' +
        '</div>';

    // Scroll to hash target if present
    if (hash) {
        var el = document.querySelector(hash);
        if (el) el.scrollIntoView({behavior: 'smooth'});
    }
}


function renderQuests(search) {
    var params = new URLSearchParams(search);
    var filter = params.get('filter') || 'all';

    var app = document.getElementById('app');

    // Fetch quests from API
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/quests', true);
    xhr.setRequestHeader('Authorization', 'Bearer ' + localStorage.getItem('favorite_color'));
    xhr.onload = function() {
        if (xhr.status !== 200) return;

        var allQuests = JSON.parse(xhr.responseText);
        var filtered = allQuests;
        if (filter === 'active') filtered = allQuests.filter(function(q) { return !q.done; });
        if (filter === 'done') filtered = allQuests.filter(function(q) { return q.done; });

        var activeCount = allQuests.filter(function(q){return !q.done;}).length;
        var doneCount = allQuests.filter(function(q){return q.done;}).length;

        var filterLabel = filter === 'active' ? 'Currently Questing' : filter === 'done' ? 'Glorious Victories' : 'All Quests';

        var html =
            '<h1>The Quest Board</h1>' +
            '<p><em>"' + getQuestQuote(filter) + '"</em></p>' +
            '<div class="filters">' +
            '  <a href="/quests" data-link class="' + (filter === 'all' ? 'active' : '') + '">All (' + allQuests.length + ')</a>' +
            '  <a href="/quests?filter=active" data-link class="' + (filter === 'active' ? 'active' : '') + '">Questing (' + activeCount + ')</a>' +
            '  <a href="/quests?filter=done" data-link class="' + (filter === 'done' ? 'active' : '') + '">Completed (' + doneCount + ')</a>' +
            '</div>';

        if (filtered.length === 0) {
            html += '<p style="color:#666; margin-top:15px;">No quests here. ' +
                (filter === 'done' ? 'None completed yet. Rather embarrassing for knights of the Round Table.' :
                 'All quests completed! The peasants rejoice (briefly).') + '</p>';
        } else {
            html += '<ul class="quest-list">';
            for (var i = 0; i < filtered.length; i++) {
                var q = filtered[i];
                html += '<li class="' + (q.done ? 'done' : '') + '">' +
                    '<button onclick="toggleQuest(' + q.id + ')" title="' + (q.done ? 'Uncomplete' : 'Complete') + '">' + (q.done ? '&#9876;' : '&#9744;') + '</button>' +
                    '<span class="title">' + escapeHtml(q.title) + '</span>' +
                    '<button class="del" onclick="deleteQuest(' + q.id + ')" title="Run Away!">&#10005;</button>' +
                    '</li>';
            }
            html += '</ul>';
        }

        html += '<div class="add-form">' +
            '<input type="text" id="new-quest" placeholder="Add a new quest, brave knight...">' +
            '<button onclick="addQuest()">Decree!</button>' +
            '</div>';

        // replaceState test section
        html += '<div class="section">' +
            '<h3>replaceState Test (The French Taunt)</h3>' +
            '<p>These buttons use <code>replaceState</code> instead of <code>pushState</code>. ' +
            'They update the URL without adding to browser history, you silly English kn-ighhhts:</p>' +
            '<div class="filters" style="margin-top:8px">' +
            '  <a href="#" onclick="replaceFilter(\'all\'); return false;">All (replace)</a>' +
            '  <a href="#" onclick="replaceFilter(\'active\'); return false;">Questing (replace)</a>' +
            '  <a href="#" onclick="replaceFilter(\'done\'); return false;">Completed (replace)</a>' +
            '</div>' +
            '</div>';

        app.innerHTML = html;

        // Handle enter key in input
        var input = document.getElementById('new-quest');
        if (input) {
            input.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') addQuest();
            });
        }
    };
    xhr.send();
}


function getQuestQuote(filter) {
    var quotes = {
        'all': "We want... a SHRUBBERY!",
        'active': "It's only a model.",
        'done': "Well, I got better."
    };
    return quotes[filter] || quotes['all'];
}


// --- Quest actions ---

function toggleQuest(id) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/quests/' + id + '/toggle', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = function() { router(); };
    xhr.send();
}

function deleteQuest(id) {
    var xhr = new XMLHttpRequest();
    xhr.open('DELETE', '/api/quests/' + id, true);
    xhr.onload = function() { router(); };
    xhr.send();
}

function addQuest() {
    var input = document.getElementById('new-quest');
    var title = input ? input.value.trim() : '';
    if (!title) return;

    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/quests', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = function() { router(); };
    xhr.send(JSON.stringify({title: title}));
}


// --- Swallow velocity calculator ---
function askSwallow() {
    var species = document.getElementById('swallow-species').value;
    var answerEl = document.getElementById('swallow-answer');

    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/swallow', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = function() {
        if (xhr.status === 200) {
            var data = JSON.parse(xhr.responseText);
            answerEl.textContent = data.velocity;
        }
    };
    xhr.send(JSON.stringify({species: species}));
}


// --- replaceState filter ---
function replaceFilter(filter) {
    var url = '/quests';
    if (filter !== 'all') url += '?filter=' + filter;
    history.replaceState(null, '', url);
    router();
}


// --- Helpers ---

function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

function updateDebugBar() {
    var el = document.getElementById('debug-url');
    if (el) el.textContent = location.pathname + location.search + location.hash;
}

function updateActiveNav() {
    var links = document.querySelectorAll('nav [data-link]');
    var current = location.pathname + location.search + location.hash;
    for (var i = 0; i < links.length; i++) {
        var link = links[i];
        var linkUrl = new URL(link.href);
        var linkPath = linkUrl.pathname + linkUrl.search + linkUrl.hash;
        if (linkPath === current) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    }
}


// --- Boot ---
router();
