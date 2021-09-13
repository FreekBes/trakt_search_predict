var spPort = chrome.runtime.connect({ name: "searcher" });
// spPort.postMessage({action: "ping"});
spPort.onMessage.addListener(function(msg) {
	switch (msg["action"]) {
		case "pong":
			console.log("pong");
			break;
		case "results":
			searchPredict.predicting = false;
			searchPredict.listPredictions(msg["results"]);
			break;
		case "aborted":
			searchPredict.predicting = false;
			break;
		case "error":
			console.error(msg["message"]);
			break;
	}
});

var searchPredict = {
	predicting: false,

	cancelPredict: function() {
		spPort.postMessage({action: "abort"});
	},

	doPredict: function(q) {
		if (q == null || q == "") {
			searchPredict.unlistPredictions();
			return;
		}
		// console.log("Searching for ", q);
		searchPredict.predicting = true;
		var searchType = document.getElementById("header-search").getAttribute("action").split("/").pop();
		switch (searchType) {
			case "shows":
				searchType = "show";
				break;
			case "movies":
				searchType = "movie";
				break;
			case "search":
				searchType = "movie,show";
				break;
			case "episodes":
				searchType = "episode";
				break;
			case "lists":
				searchType = "list";
				break;
			case "people":
				searchType = "person";
				break;
		}
		spPort.postMessage({ action: "search", query: q, type: searchType });
	},

	listPredictions: function(predictions) {
		console.log(predictions);
		searchPredict.unlistPredictions();
		var predictionBox = document.getElementById("header-search-predictions");
		if (predictions.length > 0 && document.getElementById("header-search-query").value.trim() != "")
		for (var i = 0; i < predictions.length; i++) {
			var pItem = document.createElement("a");
			pItem.setAttribute("class", "header-search-prediction-item");
			pItem.setAttribute("target", "_self");
			pItem.setAttribute("onclick", "event.preventDefault(); redirect(this.href); return false;");
			var pItemInnerHTML = '<img class="header-search-prediction-item-poster" src="https://trakt.tv/assets/placeholders/thumb/poster-78214cfcef8495a39d297ce96ddecea1.png"';
			switch (predictions[i]["type"]) {
				case "movie":
					if (predictions[i]["movie"]["ids"]["tmdb"] != null) {
						pItemInnerHTML += ' data-type="movie" data-traktid="'+predictions[i]["movie"]["ids"]["trakt"]+'" data-postersrc="tmdb" data-id="'+predictions[i]["movie"]["ids"]["tmdb"]+'">';
					}
					else {
						pItemInnerHTML += ' data-type="movie" data-traktid="'+predictions[i]["movie"]["ids"]["trakt"]+'">';
					}
					pItemInnerHTML += '<div class="header-search-prediction-item-text"><span class="header-search-prediction-item-type">Movie</span><span>' + predictions[i]["movie"]["title"];
					if (predictions[i]["movie"]["year"] != null) {
						pItemInnerHTML += " <small>(" + predictions[i]["movie"]["year"] + ")</small>";
					}
					pItemInnerHTML += "</span></div>";
					pItem.setAttribute("href", "/movies/"+predictions[i]["movie"]["ids"]["slug"]);
					break;
				case "show":
					if (predictions[i]["show"]["ids"]["tmdb"] != null) {
						pItemInnerHTML += ' data-type="show" data-traktid="'+predictions[i]["show"]["ids"]["trakt"]+'" data-postersrc="tmdb" data-id="'+predictions[i]["show"]["ids"]["tmdb"]+'">';
					}
					else {
						pItemInnerHTML += ' data-type="show" data-traktid="'+predictions[i]["show"]["ids"]["trakt"]+'">';
					}
					pItemInnerHTML += '<div class="header-search-prediction-item-text"><span class="header-search-prediction-item-type">Show</span><span>' + predictions[i]["show"]["title"];
					if (predictions[i]["show"]["year"] != null) {
						pItemInnerHTML += " <small>(" + predictions[i]["show"]["year"] + ")</small>";
					}
					pItemInnerHTML += "</span></div>";
					pItem.setAttribute("href", "/shows/"+predictions[i]["show"]["ids"]["slug"]);
					break;
				default:
					continue;
			}
			pItem.innerHTML = pItemInnerHTML;
			predictionBox.appendChild(pItem);
		}

		searchPredict.lastPosterFetched = 0;
		searchPredict.postersToFetch = predictions.length;
		searchPredict.fetchNextPoster();
	},

	postersToFetch: 0,
	lastPosterFetched: 0,
	fetchNextPoster: function() {
		if (searchPredict.lastPosterFetched < searchPredict.postersToFetch) {
			// console.log("Fetching poster " + (searchPredict.lastPosterFetched+1) + " / " + searchPredict.postersToFetch);
			var posters = document.getElementsByClassName("header-search-prediction-item-poster");
			var i = searchPredict.lastPosterFetched;
			searchPredict.lastPosterFetched += 1;
			if (posters[i] != undefined) {
				var cacheId = 'poster_'+posters[i].getAttribute("data-traktid");
				chrome.storage.local.get(cacheId, function(data) {
					if (typeof data[cacheId] === 'undefined') {
						if (posters[i].hasAttribute("data-postersrc")) {
							// console.log("Contacting API...");
							switch (posters[i].getAttribute("data-postersrc")) {
								case "tmdb":
									var fetchUrl = 'https://api.themoviedb.org/3/';
									switch (posters[i].getAttribute("data-type")) {
										case "show":
											fetchUrl += 'tv';
											break;
										case "movie":
											fetchUrl += 'movie';
											break;
										default:
											searchPredict.fetchNextPoster();
											return;
									}
									fetchUrl += '/'+posters[i].getAttribute("data-id")+'/images?api_key=6b45603c4da06c53ba2f6735015ef5a6';
									var imgFetcher = new XMLHttpRequest();
									imgFetcher.open('GET', fetchUrl);
									imgFetcher.poster = posters[i];
									imgFetcher.setRequestHeader('Content-type', 'application/json');
									imgFetcher.onload = function() {
										try {
											var imgRes = JSON.parse(imgFetcher.responseText);
											if (imgRes["posters"] != null && imgRes["posters"].length > 0 && this.poster != undefined) {
												var posterUrl = "https://image.tmdb.org/t/p/w92" + imgRes["posters"][0]["file_path"];
												this.poster.src = posterUrl;
												var cacheId = 'poster_'+this.poster.getAttribute("data-traktid");
												chrome.storage.local.set({[cacheId]: posterUrl});
											}
											searchPredict.fetchNextPoster();
										}
										catch (e) {
											console.error(e);
											searchPredict.fetchNextPoster();
										}
									};
									imgFetcher.onerror = function() {
										console.error("Could not load poster " + i);
									};
									imgFetcher.send();
									break;
							}
						}
						else {
							// console.log("No poster source found, using placeholder");
							searchPredict.fetchNextPoster();
						}
					}
					else {
						// console.log("Poster was stored in cache, no need to contact the API");
						posters[i].src = data[cacheId];
						searchPredict.fetchNextPoster();
					}
				});
			}
		}
	},

	unlistPredictions: function() {
		document.getElementById("header-search-predictions").innerHTML = "";
	}
};

function resizeSearchPredictBox() {
	setTimeout(function() {
		var searchPredictWidth = 0;
		searchPredictWidth += document.getElementById("header-search-button").offsetWidth;
		searchPredictWidth += document.getElementById("header-search-query").offsetWidth;
		searchPredictWidth += document.getElementById("header-search-type").offsetWidth;
		if (isNaN(searchPredictWidth) || searchPredictWidth < 100) {
			searchPredictWidth = "auto";
		}
		else {
			searchPredictWidth += "px";
		}
		document.getElementById("header-search-predictions").style.width = searchPredictWidth;
	}, 500);
}

function addSearchPredict() {
	if (document.getElementById("header-search-query") != null) {
		document.getElementById("header-search-query").addEventListener("input", function(event) {
			if (searchPredict.predicting) {
				searchPredict.cancelPredict();
			}
			resizeSearchPredictBox();
			var q = event.target.value;
			if (q != "" && q != null && q.trim() != "") {
				searchPredict.doPredict(q);
			}
			else {
				searchPredict.unlistPredictions();
			}
		});

		var searchTypeDropdown = document.getElementById("header-search-type").children[1];
		for (var stdi = 0; stdi < searchTypeDropdown.children.length; stdi++) {
			searchTypeDropdown.children[stdi].addEventListener("click", function() {
				searchPredict.doPredict(document.getElementById("header-search-query").value.trim());
			});
		}

		var predictionBox = document.createElement('div');
		predictionBox.setAttribute("id", "header-search-predictions");
		document.getElementById("header-search").appendChild(predictionBox);

		window.addEventListener("resize", resizeSearchPredictBox);
		resizeSearchPredictBox();

		console.log("Search Predict extension loaded successfully");
	}
	else {
		console.warn("Could not load Search Predict, as no search box has been found on this page.");
	}

	document.addEventListener("turbolinks:load", function() {
		// add the search predict functions every time turbolinks loads a new page
		addSearchPredict();
	});
}

addSearchPredict();