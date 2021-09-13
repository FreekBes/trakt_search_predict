'use strict';

function addWordIndex(str, wrd, pos) {
	return [str.slice(0, pos), wrd, str.slice(pos)].join("");
}

// omnibox default search
chrome.omnibox.setDefaultSuggestion({
	description: "Search Trakt.tv for %s"
});

// omnibox search suggestions
chrome.omnibox.onInputChanged.addListener(function(text, suggest) {
	text = text.trim();
	console.log(text);
	if (typeof suggest == "function") {
		traktSearch(text, null)
			.then(function(results) {
				if (results.length > 0)
				{
					var url = "https://trakt.tv/";
					var suggestions = [];
					var textWords = text.split(" ");
					for (var i = 0; i < results.length; i++) {
						var desc = results[i][results[i]["type"]]["title"];
						desc = desc.replaceAll("\"", "&quot;");
						desc = desc.replaceAll("'", "&apos;");
						desc = desc.replaceAll("<", "&lt;");
						desc = desc.replaceAll(">", "&gt;");
						desc = desc.replaceAll("&", "&amp;");
						for (var j = 0; j < textWords.length; j++) {
							textWords[j] = textWords[j].replace(/\W/g, '');
							var matchIndex = desc.toLowerCase().indexOf(textWords[j]);
							if (matchIndex > -1) {
								desc = addWordIndex(desc, "<match>", matchIndex);
								desc = addWordIndex(desc, "</match>", 7 + matchIndex + textWords[j].length);
							}
						}
						desc += " <dim> - View " + results[i]["type"] + " on Trakt</dim>";
						suggestions.push({
							content: url + results[i]["type"] + "s/" + results[i][results[i]["type"]]["ids"]["slug"],
							description: desc
						});
					}
					suggest(suggestions);
				}
			})
			.catch(function(error) {
				// do nothing
			});
	}
});

// omnibox suggestion chosen or enter hit
chrome.omnibox.onInputEntered.addListener(function(text, disposition) {
	var url = "https://trakt.tv/";
	if (text.indexOf(url) == 0) {
		url = text;
	}
	else if ((text != null || text != undefined) && text.trim() != "") {
		url += "search?query=" + encodeURIComponent(text);
	}
	if (disposition == "newForegroundTab") {
		chrome.tabs.create({
			url: url,
			active: true
		});
	}
	else if (disposition == "newBackgroundTab") {
		chrome.tabs.create({
			url: url,
			active: false
		});
	}
	else {
		// disposition == "currentTab"
		chrome.tabs.update(null, {url: url});
	}
});

var controller = new AbortController();

function traktSearch(query, type) {
	return new Promise(function(resolve, reject) {
		controller = new AbortController();
		if (type == null || type == "" || type == "null") {
			type = "movie,show";
		}
		// var possibles = ["movie,show", "movie", "show", "episode", "person", "list"];
		var possibles = ["movie,show", "movie", "show"];
		if (possibles.includes(type)) {
			fetch('https://api.trakt.tv/search/'+type+'?query='+encodeURIComponent(query)+'&page=1&limit=4', {
				method: 'get',
				headers: {
					"Content-type": "application/json",
					"trakt-api-key": "ed96d295201996718aca1c862da917cd55f05775122863e3405d6ad4de5407a6",
					"trakt-api-version": "2"
				},
				signal: controller.signal
			})
				.then(function(response) {
					response.json().then(function(results) {
						resolve(results);
					})
					.catch(function(error) {
						reject(error);
					});
				})
				.catch(function(error) {
					if (error.message.indexOf("abort") == -1) {
						reject(error);
					}
				});
		}
		else {
			// requested type is not supported by this extension
			resolve([]);
		}
	});
}

// messenger between browser extension and trakt.tv website (background.js and search_predict.js)
chrome.runtime.onConnect.addListener(function(port) {
	port.onMessage.addListener(function(msg) {
		switch (msg["action"]) {
			case "ping":
				port.postMessage({action: "pong"});
				break;
			case "search":
				traktSearch(msg["query"], msg["type"])
					.then(function(response) {
						port.postMessage({action: "results", results: response});
					})
					.catch(function(error) {
						port.postMessage({action: "error", message: error.message});
					});
				break;
			case "abort":
				controller.abort();
				port.postMessage({action: "aborted"});
				break;
		}
	})
});