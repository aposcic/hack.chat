function $(query) {return document.querySelector(query)}

function localStorageGet(key) {
	try {
		return window.localStorage[key]
	}
	catch(e) {}
}

function localStorageSet(key, val) {
	try {
		window.localStorage[key] = val
	}
	catch(e) {}
}


var ws
var myNick = localStorageGet('my-nick')
var myChannel = window.location.search.replace(/^\?/, '')
var lastSent = [""]
var lastSentPos = 0
var log = ""

// Notifications related stuff
var notificationSound = new Audio('notification.mp3');
var lastNotificationTimestamp = null;


// Ping server every 50 seconds to retain WebSocket connection
window.setInterval(function() {
	send({cmd: 'ping'})
}, 50000)


function join(channel) {
	wsAddress = ""
	if (document.domain == 'hack.chat') {
		// For https://hack.chat/
		wsAddress = 'wss://hack.chat/chat-ws';
	} else {
		if (document.location.protocol == 'https:') {
			wsAddress = 'wss://' + document.domain;
		} else {
			wsAddress = 'ws://' + document.domain;
		}

		// for local installs, connect to a specific port
		// otherwise assume deployment behind reverse proxy
		if (validator.isFQDN(document.domain + "") && !validator.isIP(document.domain)) {
			wsAddress = wsAddress + '/chat-ws';
		} else {
			wsAddress = wsAddress + ':6060';
		}
	}
	ws = new WebSocket(wsAddress);

	var wasConnected = false

	ws.onopen = function() {
		if (!wasConnected) {
			if (location.hash) {
				myNick = location.hash.substr(1)
			}
			else {
				myNick = prompt('Nickname:', myNick)
			}
		}
		if (myNick) {
			localStorageSet('my-nick', myNick)
			send({cmd: 'join', channel: channel, nick: myNick})
		}
		wasConnected = true
	}

	ws.onclose = function() {
		if (wasConnected) {
			pushMessage({nick: '!', text: "Server disconnected. Attempting to reconnect..."})
		}
		window.setTimeout(function() {
			join(channel)
		}, 2000)
	}

	ws.onmessage = function(message) {
		var args = JSON.parse(message.data)
		var cmd = args.cmd
		var command = COMMANDS[cmd]
		command.call(null, args)
	}
}


var COMMANDS = {
	chat: function(args) {
		if (ignoredUsers.indexOf(args.nick) >= 0) {
			return
		}
		pushMessage(args)
		if (!windowActive) {
			if (($('#notify-chat').checked && args.nick != myNick) 
					|| ($('#notify-mentions').checked && args.text.indexOf('@' + myNick) !== -1)) {
				showNotification('<' + args.nick + '> ' + args.text)
			}
		}
	},
	info: function(args) {
		args.nick = '*'
		pushMessage(args)
		if (!windowActive && $('#notify-info').checked) {
			showNotification('<' + args.nick + '> ' + args.text)
		}
	},
	warn: function(args) {
		args.nick = '!'
		pushMessage(args)
		if (!windowActive && $('#notify-info').checked) {
			showNotification('<' + args.nick + '> ' + args.text)
		}
	},
	onlineSet: function(args) {
		var nicks = args.nicks
		usersClear()
		nicks.forEach(function(nick) {
			userAdd(nick)
		})
		pushMessage({nick: '*', text: "Users online: " + nicks.join(", ")})
	},
	onlineAdd: function(args) {
		var nick = args.nick
		userAdd(nick)
		if ($('#joined-left').checked) {
			pushMessage({nick: '*', text: nick + " joined"})
		}
		if (!windowActive && $('#notify-info').checked) {
			showNotification('<*> ' + args.nick + " joined")
		}
	},
	onlineRemove: function(args) {
		var nick = args.nick
		userRemove(nick)
		if ($('#joined-left').checked) {
			pushMessage({nick: '*', text: nick + " left"})
		}
		if (!windowActive && $('#notify-info').checked) {
			showNotification('<*> ' + args.nick + " left")
		}
	},
}


function pushMessage(args) {
	// Message container
	var messageEl = document.createElement('div')
	messageEl.classList.add('message')

	if (args.nick == myNick) {
		messageEl.classList.add('me')
	}
	else if (args.nick == '!') {
		messageEl.classList.add('warn')
	}
	else if (args.nick == '*') {
		messageEl.classList.add('info')
	}
	else if (args.admin) {
		messageEl.classList.add('admin')
	}
	else if (args.mod) {
		messageEl.classList.add('mod')
	}

	// Nickname
	var nickSpanEl = document.createElement('span')
	nickSpanEl.classList.add('nick')
	messageEl.appendChild(nickSpanEl)

	if (args.trip) {
		var tripEl = document.createElement('span')
		tripEl.textContent = args.trip + " "
		tripEl.classList.add('trip')
		nickSpanEl.appendChild(tripEl)
	}

	if (args.nick) {
		var nickLinkEl = document.createElement('a')
		nickLinkEl.textContent = args.nick
		nickLinkEl.onclick = function() {
			insertAtCursor("@" + args.nick + " ")
			$('#chatinput').focus()
		}
		var date = new Date(args.time || Date.now())
		nickLinkEl.title = date.toLocaleString()
		nickSpanEl.appendChild(nickLinkEl)
	}

	// Text
	var textEl = document.createElement('pre')
	textEl.classList.add('text')

	textEl.textContent = args.text || ''
	textEl.innerHTML = textEl.innerHTML.replace(/(\?|https?:\/\/)\S+?(?=[,.!?:)]?\s|$)/g, parseLinks)

	if ($('#parse-latex').checked) {
		// Temporary hotfix for \rule spamming, see https://github.com/Khan/KaTeX/issues/109
		textEl.innerHTML = textEl.innerHTML.replace(/\\rule|\\\\\s*\[.*?\]/g, '')
		try {
			renderMathInElement(textEl, {delimiters: [
				{left: "$$", right: "$$", display: true},
				{left: "$", right: "$", display: false},
			]})
		}
		catch (e) {
			console.warn(e)
		}
	}

	messageEl.appendChild(textEl)

	// Prepare and append simple log entry
	if (args.nick && args.text && date) {
		log += '[' + date.toLocaleString(undefined, { hour12: false }) + '] '
		log += "<" + args.nick + "> "
		log += args.text + "\r\n"
	}

	// Scroll to bottom
	var atBottom = isAtBottom()
	$('#messages').appendChild(messageEl)
	if (atBottom) {
		window.scrollTo(0, document.body.scrollHeight)
	}

	unread += 1
	updateTitle()
}


function showNotification(message) {
	if (window.Notification && Notification.permission === 'granted') {
		var options = {
			body: message,
			tag: myChannel,
			icon: 'favicon.ico'
		}
		if ($('#enable-sound').checked && 
			(lastNotificationTimestamp == null || 
				Date.now() - lastNotificationTimestamp > 10000)) {
			notificationSound.play();
		}
		lastNotificationTimestamp = Date.now();
		var n = new Notification('hack.chat/?' + myChannel, options);
		setTimeout(n.close.bind(n), 10000); 
	}
}


function insertAtCursor(text) {
	var input = $('#chatinput')
	var start = input.selectionStart || 0
	var before = input.value.substr(0, start)
	var after = input.value.substr(start)
	before += text
	input.value = before + after
	input.selectionStart = input.selectionEnd = before.length
	updateInputSize()
}


function send(data) {
	if (ws && ws.readyState == ws.OPEN) {
		ws.send(JSON.stringify(data))
	}
}


function parseLinks(g0) {
	var a = document.createElement('a')
	a.innerHTML = g0
	var url = a.textContent
	a.href = url
	a.target = '_blank'
	return a.outerHTML
}


var windowActive = true
var unread = 0

window.onfocus = function() {
	windowActive = true
	updateTitle()
}

window.onblur = function() {
	windowActive = false
}

window.onscroll = function() {
	if (isAtBottom()) {
		updateTitle()
	}
}

window.onbeforeunload = function(e) {
	if ($('#warn-close').checked || unread > 0) {
		var confirmClose = 'You might have unread messages. Are you sure you want to close the chat?';
		e.returnValue = confirmClose;
		return confirmClose;
	}
}

function isAtBottom() {
	return (window.innerHeight + window.scrollY) >= (document.body.scrollHeight - 1)
}

function updateTitle() {
	if (windowActive && isAtBottom()) {
		unread = 0
	}

	var title
	if (myChannel) {
		title = "?" + myChannel
	}
	else {
		title = "hack.chat"
	}
	if (unread > 0) {
		title = '(' + unread + ') ' + title
	}
	document.title = title
}

/* footer */

$('#footer').onclick = function() {
	$('#chatinput').focus()
}

$('#chatinput').onkeydown = function(e) {
	if (e.keyCode == 13 /* ENTER */ && !e.shiftKey) {
		e.preventDefault()
		// Submit message
		if (e.target.value != '') {
			var text = e.target.value
			e.target.value = ''
			send({cmd: 'chat', text: text})
			lastSent[0] = text
			lastSent.unshift("")
			lastSentPos = 0
			updateInputSize()
		}
	}
	else if (e.keyCode == 38 /* UP */) {
		// Restore previous sent messages
		if (e.target.selectionStart === 0 && lastSentPos < lastSent.length - 1) {
			e.preventDefault()
			if (lastSentPos == 0) {
				lastSent[0] = e.target.value
			}
			lastSentPos += 1
			e.target.value = lastSent[lastSentPos]
			e.target.selectionStart = e.target.selectionEnd = e.target.value.length
			updateInputSize()
		}
	}
	else if (e.keyCode == 40 /* DOWN */) {
		if (e.target.selectionStart === e.target.value.length && lastSentPos > 0) {
			e.preventDefault()
			lastSentPos -= 1
			e.target.value = lastSent[lastSentPos]
			e.target.selectionStart = e.target.selectionEnd = 0
			updateInputSize()
		}
	}
	else if (e.keyCode == 27 /* ESC */) {
		e.preventDefault()
		// Clear input field
		e.target.value = ""
		lastSentPos = 0
		lastSent[lastSentPos] = ""
		updateInputSize()
	}
	else if (e.keyCode == 9 /* TAB */ && !e.ctrlKey) {
		// Tab complete nicknames starting with @
		e.preventDefault()
		var pos = e.target.selectionStart || 0
		var text = e.target.value
		var index = text.lastIndexOf('@', pos)
		if (index >= 0) {
			var stub = text.substring(index + 1, pos).toLowerCase()
			// Search for nick beginning with stub
			var nicks = onlineUsers.filter(function(nick) {
				return nick.toLowerCase().indexOf(stub) == 0
			})
			if (nicks.length == 1) {
				insertAtCursor(nicks[0].substr(stub.length) + " ")
			}
		}
	}
}


function updateInputSize() {
	var atBottom = isAtBottom()

	var input = $('#chatinput')
	input.style.height = 0
	input.style.height = input.scrollHeight + 'px'
	document.body.style.marginBottom = $('#footer').offsetHeight + 'px'

	if (atBottom) {
		window.scrollTo(0, document.body.scrollHeight)
	}
}

$('#chatinput').oninput = function() {
	updateInputSize()
}

updateInputSize()


/* sidebar */

$('#sidebar').onmouseenter = $('#sidebar').ontouchstart = function(e) {
	$('#sidebar-content').classList.remove('hidden')
	e.stopPropagation()
}

$('#sidebar').onmouseleave = document.ontouchstart = function() {
	if (!$('#pin-sidebar').checked) {
		$('#sidebar-content').classList.add('hidden')
	}
}

$('#clear-messages').onclick = function() {
	// Delete children elements
	var messages = $('#messages')
	while (messages.firstChild) {
		messages.removeChild(messages.firstChild)
	}
	log = ""
}

$('#save-messages').onclick = function() {
	// Save message log to file
	var blob = new Blob([log], {type: 'data:text/plain;charset=utf-8'});
	date = new Date(Date.now())
	saveAs(blob, myChannel + "_" + date.toISOString() + ".txt");
}

// Restore settings from localStorage

if (localStorageGet('pin-sidebar') == 'true') {
	$('#pin-sidebar').checked = true
	$('#sidebar-content').classList.remove('hidden')
}
if (localStorageGet('joined-left') == 'false') {
	$('#joined-left').checked = false
}
if (localStorageGet('parse-latex') == 'false') {
	$('#parse-latex').checked = false
}
if (localStorageGet('warn-close') == 'true') {
	$('#warn-close').checked = true
}
if (Notification.permission == 'granted') {
	if (localStorageGet('notify-chat') == 'true') {
		$('#notify-chat').checked = true
	}
	if (localStorageGet('notify-mentions') == 'true') {
		$('#notify-mentions').checked = true
	}
	if (localStorageGet('notify-info') == 'true') {
		$('#notify-info').checked = true
	}
}
if (localStorageGet('enable-sound') == 'true') {
	$('#enable-sound').checked = true
}

// Disable browser notifications toggle if notifications denied or not available
if (!window.Notification || Notification.permission === 'denied') {
	$('#notify-chat').disabled = true
	$('#notify-chat').checked = false
	$('#notify-mentions').disabled = true
	$('#notify-mentions').checked = false
	$('#notify-info').disabled = true
	$('#notify-info').checked = false
}

$('#pin-sidebar').onchange = function(e) {
	localStorageSet('pin-sidebar', !!e.target.checked)
}
$('#joined-left').onchange = function(e) {
	localStorageSet('joined-left', !!e.target.checked)
}
$('#parse-latex').onchange = function(e) {
	localStorageSet('parse-latex', !!e.target.checked)
}
$('#warn-close').onchange = function(e) {
	localStorageSet('warn-close', !!e.target.checked)
}
$('#enable-sound').onchange = function(e) {
	localStorageSet('enable-sound', !!e.target.checked)
}

// Notifications

function updateNotifications(e)
{
	// Check if notifications already enabled, otherwise ask for permission
	if (e.checked) {
		if (window.Notification && Notification.permission !== "granted") {
			Notification.requestPermission(function (status) {
				if (Notification.permission !== status) {
					Notification.permission = status;
				}
				if (status === 'granted') {
					localStorageSet(e.id, true)
				}
				else {
					$('#notify-chat').checked = false
					localStorageSet('notify-chat', false)
					$('#notify-mentions').checked = false
					localStorageSet('notify-mentions', false)
					$('#notify-info').checked = false
					localStorageSet('notify-info', false)
				}
				if (status === 'denied') {
					$('#notify-chat').disabled = true
					$('#notify-mentions').disabled = true
					$('#notify-info').disabled = true
				}
			});
		} else if (window.Notification) {
			localStorageSet(e.id, true)
		}
	} else {
		localStorageSet(e.id, false)
	}
}

// User list

var onlineUsers = []
var ignoredUsers = []

function userAdd(nick) {
	var user = document.createElement('a')
	user.textContent = nick
	user.onclick = function(e) {
		userInvite(nick)
	}
	var userLi = document.createElement('li')
	userLi.appendChild(user)
	$('#users').appendChild(userLi)
	onlineUsers.push(nick)
}

function userRemove(nick) {
	var users = $('#users')
	var children = users.children
	for (var i = 0; i < children.length; i++) {
		var user = children[i]
		if (user.textContent == nick) {
			users.removeChild(user)
		}
	}
	var index = onlineUsers.indexOf(nick)
	if (index >= 0) {
		onlineUsers.splice(index, 1)
	}
}

function usersClear() {
	var users = $('#users')
	while (users.firstChild) {
		users.removeChild(users.firstChild)
	}
	onlineUsers.length = 0
}

function userInvite(nick) {
	send({cmd: 'invite', nick: nick})
}

function userIgnore(nick) {
	ignoredUsers.push(nick)
}

/* color scheme switcher */

var schemes = [
	'android',
	'atelier-dune',
	'atelier-forest',
	'atelier-heath',
	'atelier-lakeside',
	'atelier-seaside',
	'bright',
	'chalk',
	'default',
	'eighties',
	'greenscreen',
	'mocha',
	'monokai',
	'nese',
	'ocean',
	'pop',
	'railscasts',
	'solarized',
	'tomorrow',
]

var currentScheme = 'atelier-dune'

function setScheme(scheme) {
	currentScheme = scheme
	$('#scheme-link').href = "/schemes/" + scheme + ".css"
	localStorageSet('scheme', scheme)
}

// Add scheme options to dropdown selector
schemes.forEach(function(scheme) {
	var option = document.createElement('option')
	option.textContent = scheme
	option.value = scheme
	$('#scheme-selector').appendChild(option)
})

$('#scheme-selector').onchange = function(e) {
	setScheme(e.target.value)
}

// Load sidebar configaration values from local storage if available
if (localStorageGet('scheme')) {
	setScheme(localStorageGet('scheme'))
}

$('#scheme-selector').value = currentScheme


/* main */

if (myChannel == '') {
	pushMessage({text: frontpage})
	$('#footer').classList.add('hidden')
	$('#sidebar').classList.add('hidden')
}
else {
	join(myChannel)
}
