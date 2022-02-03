// for communication between search_predict.js and background.js.
var spPort = chrome.runtime.connect({ name: "searcher" });
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

	// abort currently running prediction in background.js.
	cancelPredict: function() {
		spPort.postMessage({action: "abort"});
	},

	// get the current value of the search query input, trim it and start the prediction.
	// if q seems empty, unlist all current predictions.
	initPredict: function() {
		if (searchPredict.predicting) {
			searchPredict.cancelPredict();
		}
		var q = document.getElementById("header-search-query").value;
		if (q != null) {
			q = q.trim();
			if (q != "") {
				searchPredict.doPredict(q);
			}
		}
		else {
			searchPredict.unlistPredictions();
		}
	},

	// start the prediction process.
	// includes extra protection against empty query values.
	// the prediction type is retrieved from the header-search form action on Trakt.tv.
	doPredict: function(q) {
		if (q == null || q == "") {
			searchPredict.unlistPredictions();
			return;
		}
		searchPredict.predicting = true;
		var searchType = document.getElementById("header-search").getAttribute("action");
		switch (searchType) {
			case "/search/shows":
			case "/search/shows/":
				searchType = "show";
				break;
			case "/search/movies":
			case "/search/movies/":
				searchType = "movie";
				break;
			case "/search":
			case "/search/":
				searchType = "movie,show";
				break;
			case "/search/episodes":
			case "/search/episodes/":
				searchType = "episode";
				break;
			case "/search/lists":
			case "/search/lists/":
				searchType = "list";
				break;
			case "/search/people":
			case "/search/people/":
				searchType = "person";
				break;
		}
		// search prediction actually happens in background.js, results are shared over spPort.
		spPort.postMessage({ action: "search", query: q, type: searchType });
	},

	// list prediction results. this function is a bit messy due to HTML work going on.
	// start by unlisting the current ones, then check if there's actually still a value in the query field.
	// if there is, we create a HTML A element for every prediction, listed in a UL tag, which is added to
	// the prediction box. if there is a TMDB id included in the suggestion results, add that to the element.
	// This will be of use later, when retrieving the poster or image for each of the results.
	// the A tag will feature a href attribute, linking to the page of the show or movie that's been predicted.
	// at the end of the function, we fetch the "next" (so actually the first) poster listed by calling fetchNextPoster().
	listPredictions: function(predictions) {
		console.log(predictions);
		searchPredict.unlistPredictions();
		var predictionBox = document.getElementById("header-search-predictions");
		if (predictions.length > 0 && document.getElementById("header-search-query").value.trim() != "") {
			for (var i = 0; i < predictions.length; i++) {
				var pItem = document.createElement("a");
				pItem.setAttribute("class", "header-search-prediction-item");
				pItem.setAttribute("target", "_self");
				pItem.setAttribute("title", predictions[i][predictions[i]["type"]]["title"] + " (" + predictions[i][predictions[i]["type"]]["year"] + ")");
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
		}
	},

	// below function (and variables) handle the poster or image fetching for shows and movies.
	// these images are not given by Trakt.tv's API, so we fetch them from other sources instead.
	// currently, they're only fetched from TMDB (TheMovieDataBase). but first, we check the cache.
	// all previously fetched images are stored in the local storage of the extension under a certain
	// cacheId, which is made up by the movie or show's Trakt ID. If no image was found in cache,
	// we start fetching them from the sources using their APIs instead.
	// in case no image has been found after all, we use a placeholder image and start with the next
	// prediction's image, for which this same function is called once more.
	// as soon as postersToFetch == 0, the function stops running.
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
							searchPredict.fetchNextPoster();
						}
					}
					else {
						posters[i].src = data[cacheId];
						searchPredict.fetchNextPoster();
					}
				});
			}
		}
	},

	// remove all previous predictions from the prediction list.
	unlistPredictions: function() {
		document.getElementById("header-search-predictions").innerHTML = "";
	},

	// resize the search prediction box based on the width of elements above it.
	// very useful for when the window gets resized
	resizeSearchPredictBox: function(timeoutms) {
		if (timeoutms == null) {
			timeoutms = 500;
		}
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
		}, timeoutms);
	},

	// capture keydown events for traversing the prediction list. only certain keys get caught (see switch statement).
	// we look at which element is currently focused in the browser. if that was one of "ours", we get the index of that
	// element based on its parent, and based on which key has been pressed, we focus on the previous or next prediction listed.
	// by using JS's focus function, we don't have to worry about actually selecting the prediction, since it's an A element that
	// has focus, which is usually already handled well by the browser (by pressing enter, for example).
	keyboardControls: function(e) {
		if (e.target.id == "header-search-query" || (e.target.type != 'text' && e.target.nodeName != 'TEXTAREA' && e.target.getAttribute("contenteditable") == null)) {
			var key = e.keyCode || e.which;
			var predictAmount = document.getElementById("header-search-predictions").children.length;
			var predictActiveIndex = -1;
			if (document.activeElement.className.indexOf("header-search-prediction-item") > -1) {
				predictActiveIndex = Array.prototype.indexOf.call(document.activeElement.parentNode.children, document.activeElement);
			}
			var prevPredictIndex = (predictActiveIndex <= 0 ? predictAmount - 1 : predictActiveIndex - 1);
			var nextPredictIndex = (predictActiveIndex == predictAmount - 1 ? 0 : predictActiveIndex + 1);
			switch(key) {
				case 27:		// [ESC]
					e.preventDefault();
					searchPredict.unlistPredictions();
					if (searchPredict.predicting) {
						searchPredict.cancelPredict();
					}
					document.getElementById("header-search-query").focus();
					return true;
				case 38:		// [ARROW_UP]
					e.preventDefault();
					document.getElementsByClassName("header-search-prediction-item")[prevPredictIndex].focus();
					return true;
				case 40:		// [ARROW_DOWN]
					e.preventDefault();
					document.getElementsByClassName("header-search-prediction-item")[nextPredictIndex].focus();
					return true;
			}
		}
		return false;
	}
};

// add the necessary event handlers and elements to the current page for use with the search predict functions.
// this means disabling the regular autocomplete for and adding an input listener to the search query field.
// we also add click listeners to the dropdown list of all searchable types (movies, shows, episodes, etc).
// when the search button gets clicked, we need to resize the suggestions box, since sometimes the search
// button expands or resizes the whole form.
// could have used some CSS for the resizing, but that doesn't allow for proper text-overflow.
// we capture the keydown event for the whole page for keyboard controls. see the comment above the
// searchPredict.keyboardControls function for an explanation on how this works.
// we also capture mouseclicks to remove the list of predictions if clicked outside of the list container.
// in case there's no search query field found on the page, we don't actually do anything.
// there's no search query to predict in this case.
function addSearchPredict() {
	var headerSearchQuery = document.getElementById("header-search-query");
	if (headerSearchQuery != null) {
		headerSearchQuery.setAttribute("autocomplete", "off");
		headerSearchQuery.addEventListener("input", searchPredict.initPredict);

		var searchTypeDropdown = document.getElementById("header-search-type").children[1];
		for (var stdi = 0; stdi < searchTypeDropdown.children.length; stdi++) {
			searchTypeDropdown.children[stdi].addEventListener("click", function() {
				searchPredict.resizeSearchPredictBox(10);
				searchPredict.initPredict();
			});
		}
		document.getElementById("header-search-button").addEventListener("click", function() {
			searchPredict.resizeSearchPredictBox(1000);
		});

		var predictionBox = document.createElement('div');
		predictionBox.setAttribute("id", "header-search-predictions");
		document.getElementById("header-search").appendChild(predictionBox);

		window.addEventListener("resize", searchPredict.resizeSearchPredictBox);
		searchPredict.resizeSearchPredictBox();

		window.addEventListener("keydown", searchPredict.keyboardControls);
		window.addEventListener("click", function(event) {
			var elem = event.target;
			while (elem) {
				if (elem.id == "header-search") {
					return;
				}
				elem = elem.parentNode;
			}
			searchPredict.unlistPredictions();
			if (searchPredict.predicting) {
				searchPredict.cancelPredict();
			}
		});

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
