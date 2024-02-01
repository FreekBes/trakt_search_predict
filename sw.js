'use strict';

function addWordIndex(str, wrd, pos) {
	return [str.slice(0, pos), wrd, str.slice(pos)].join("");
}

const omniSuggestions = {
	browser: [],
	urls: [],
	contents: [],
	clear: function() {
		omniSuggestions.browser = [];
		omniSuggestions.urls = [];
		omniSuggestions.contents = [];
	}
};

let controller = new AbortController();
let sPort = null;

// Omnibox default search, not on firefox.
// Firefox is buggy with this function,
// not supporting %s and when set in the onInputChanged event
// with the "text" parameter from that function,
// it won't include the last letter from the "text" string.
// Kinda weird. Just don't include it then.
if (navigator.userAgent.indexOf("Firefox") == -1) {
	chrome.omnibox.setDefaultSuggestion({
		description: "Search Trakt.tv for %s"
	});
}

// Omnibox search suggestions. suggest parameter should be a function.
// First, we abort any currently ongoing request to Trakt's API, useful for people who
// type very quickly (the API call takes a while and it would clog up otherwise).
// We also let all instances of search_predict.js know for just in case.
// We store all results from the search predict in the global omniSuggestions object,
// for future use (retrieving the URL from the chosen prediction).
// On any browser that's not Firefox, we add XML styling to the search prediction,
// as seen on https://developer.chrome.com/docs/extensions/reference/omnibox/#type-SuggestResult
// Mozilla Firefox doesn't seem to support this XML styling.
// We add all the suggestions to the object and let the browser know this list is ready.
chrome.omnibox.onInputChanged.addListener(function(text, suggest) {
	text = text.trim();
	if (typeof suggest == "function") {
		controller.abort();
		if (sPort != null) {
			sPort.postMessage({action: "aborted"});
		}
		traktSearch(text, null)
			.then(function(results) {
				omniSuggestions.clear();
				if (results.length > 0)
				{
					const url = "https://trakt.tv/";
					const textWords = text.split(" ");
					for (let i = 0; i < results.length; i++) {
						let desc = results[i][results[i]["type"]]["title"];
						const descCon = desc;
						if (navigator.userAgent.indexOf("Firefox") == -1) {
							desc = desc.replaceAll("<", "&lt;");
							desc = desc.replaceAll(">", "&gt;");
							for (let j = 0; j < textWords.length; j++) {
								textWords[j] = textWords[j].replace(/\W/g, '');
								const matchIndex = desc.toLowerCase().indexOf(textWords[j]);
								if (matchIndex > -1) {
									desc = addWordIndex(desc, "<match>", matchIndex);
									desc = addWordIndex(desc, "</match>", 7 + matchIndex + textWords[j].length);
								}
							}
							desc += " <dim> - View " + results[i]["type"] + " on Trakt.tv</dim>";
						}
						else {
							desc += " - View " + results[i]["type"] + " on Trakt.tv";
						}
						omniSuggestions.browser.push({
							content: descCon,
							description: desc
						});
						omniSuggestions.contents.push(descCon);
						omniSuggestions.urls.push(url + results[i]["type"] + "s/" + results[i][results[i]["type"]]["ids"]["slug"]);
					}
				}
				suggest(omniSuggestions.browser);
			})
			.catch(function(error) {
				console.error(error);
			});
	}
});

// This is the function that's run when the user has chosen one of our extension's
// search suggestions. It first checks if it was any of our suggestions from
// onInputChanged event's function above, if it was we get the url from there.
// In case not, we create a new search on the Trakt.tv website with the query
// given to us in the address bar.
// Based on the disposition, we create a new browser tab for this. If none has
// been given (currentTab), we update the current one.
chrome.omnibox.onInputEntered.addListener(function(text, disposition) {
	let url = "https://trakt.tv/";
	const omniSugIndex = omniSuggestions.contents.indexOf(text);
	if (omniSugIndex > -1) {
		url = omniSuggestions.urls[omniSugIndex];
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

// This function is the backbone of this whole extension.
// It uses Trakt.tv's API to retrieve search predictions for a search on their website.
// They don't actually have an API for this, nor have they implemented it themselves, so
// we end up using the search function itself for this. There's many possible search types,
// like movies, shows, episodes, persons, etc. This extension currently only supports
// movies and shows. Once a search query has been completed, we return its results to the caller
// using Javascript's Promises.
function traktSearch(query, type) {
	return new Promise(function(resolve, reject) {
		controller = new AbortController();
		if (type == null || type == "" || type == "null") {
			type = "movie,show";
		}
		// const possibles = ["movie,show", "movie", "show", "episode", "person", "list"];
		const possibles = ["movie,show", "movie", "show"];
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
			// Requested type is not supported by this extension
			resolve([]);
		}
	});
}

// Messenger between browser extension and trakt.tv website (sw.js and search_predict.js)
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
	});
	sPort = port;
});
