'use strict';

var searchXhr = null;

// omnibox search
chrome.omnibox.onInputChanged.addListener(function(text, suggest) {
    text = text.trim();
    if (text != "") {
        traktSearch(text, null)
            .then(function(results) {
                var suggestResults = [];
                for (var i = 0; i < results.length; i++) {
                    var tempRes = {};
                    switch (results[i]["type"]) {
                        case "movie":
                            tempRes.description = results[i]["movie"]["title"] + (results[i]["movie"]["year"] != null ? " ("+results[i]["movie"]["year"]+")" : "");
                            tempRes.content = "https://trakt.tv/movies/" + results[i]["movie"]["ids"]["slug"];
                            break;
                        case "show":
                            tempRes.description = results[i]["show"]["title"] + (results[i]["show"]["year"] != null ? " ("+results[i]["show"]["year"]+")" : "");
                            tempRes.content = "https://trakt.tv/shows/" + results[i]["show"]["ids"]["slug"];
                            break;
                        default:
                            continue;
                    }
                    suggestResults.push(tempRes);
                }
                suggest(suggestResults);
            })
            .catch(function(error) {
                suggest([]);
            });
    }
    else {
        suggest([]);
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